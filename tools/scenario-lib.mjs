// Библиотека сценариев рядом со страницей: `web/scenarios/` из
// `Sprut.Hub_Tools` (таск 05 просмотра, G23).
//
//   node tools/scenario-lib.mjs [папка Sprut.Hub_Tools]
//
// Папка по умолчанию — `../../Sprut.Hub_Tools` от `scheme_image/`: отдельный
// репозиторий владельца продукта (MIT, Copyright 2025 Kirill Ashikhmin).
// Приём тот же, что у `tools/hub-types.mjs`: команда запускается **руками**,
// итог лежит в git, сборка о команде не знает и внешних папок не читает, сети
// нет нигде. Лицензия едет вместе с копией.
//
// Что собирается:
//   `web/scenarios/<ключ>@<16 знаков отпечатка>.js` — исходник скрипта **байт
//   в байт** так, как его прочтёт страница (`hubScriptRead`: срезан только
//   BOM), и
//   `web/scenarios/index.json` — реестр `{version, scripts: [{name, version,
//   kind, hash, size, file}]}`, отсортированный по имени файла. Времени в
//   реестре нет: повторный запуск на тех же исходниках даёт тот же текст байт
//   в байт.
//
// Берутся только файлы из папок `source/` (у одного инструмента их может быть
// несколько) и только то, что `hubScriptRead` признал логическим или
// глобальным сценарием. Собранные `*.json` экспорта хаба в библиотеку **не**
// идут: у части инструментов их текст отстал от исходника на пару байтов, а
// совпадение здесь только точное (G24.1) — два почти одинаковых текста в
// библиотеке значили бы, что объект стоит неизвестно на каком.
//
// Имя скрипта — человеческое: из `publish.json` или из экспорта хаба
// (`scenarioTemplate.name`), и лишь затем из самого текста. Версия — `version`
// из `info` (у глобальных скриптов `info` нет, и версия пустая: врать
// «1.0» здесь нельзя — по версии предлагается обновление).
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { hubScriptRead } from "../src/sim/hubApi.js";
import { SCENARIO_LIB_INDEX, SCENARIO_LIB_VERSION, scenarioLibFileName, scenarioLibHash } from "../src/scenarioLib.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE_DEFAULT = join(HERE, "..", "..", "..", "Sprut.Hub_Tools");
const OUT_DEFAULT = join(HERE, "..", "web", "scenarios");
// Папки, в которые ходить незачем: служебные, зависимости и чужие фикстуры
// (`ScenarioSimulator/packages/**/test/publish/fixtures/*/source/*.js` — тоже
// `source/`, но это не сценарии библиотеки).
const SKIP_DIRS = new Set(["node_modules", "packages", "dist", "build"]);
const README_NAME = "README.md";

/**
 * Ключ имени файла: латиница, цифры, точка, дефис и подчёркивание. Остальное
 * (кириллица, эмодзи) срезается — имя файла едет в адрес, и переносить туда
 * «Скрыть устройство если выключено» значило бы проценты в ссылке.
 */
export function scenarioLibSlug(text) {
  return String(text || "")
    .replace(/\s+/g, "-")
    .replace(/[^A-Za-z0-9._-]+/g, "")
    .replace(/-{2,}/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "");
}

/**
 * Версия скрипта: `version` внутри `info = {…}`. Вне `info` поле `version`
 * версией сценария не считается (это может быть что угодно чужое), а у
 * глобального скрипта `info` нет вовсе — тогда версии нет.
 */
export function scenarioLibVersionOf(source) {
  const text = String(source || "");
  const head = /(^|\n)[ \t]*(?:var |let |const )?info\s*=\s*\{/.exec(text);
  if (!head) return "";
  const from = head.index + head[0].length;
  const rest = text.slice(from);
  // Конец `info` — закрывающая скобка объявления (`};`) на своей строке;
  // вложенные объекты закрываются `}` или `},`, и под это не попадают.
  const end = rest.search(/\n[ \t]*\};/);
  const body = end < 0 ? rest : rest.slice(0, end);
  const found = /(^|\n)[ \t]*version\s*:\s*["']([^"']*)["']/.exec(body);
  return found ? found[2].trim() : "";
}

/** Текст реестра: порядок задан именем файла, времени в нём нет. */
export function scenarioLibIndexText(entries) {
  const scripts = [...(entries || [])]
    .map((entry) => ({
      name: String(entry.name || ""),
      version: String(entry.version || ""),
      kind: entry.kind === "global" ? "global" : "logic",
      hash: String(entry.hash || ""),
      size: Number(entry.size || 0),
      file: String(entry.file || ""),
    }))
    .sort((a, b) => (a.file === b.file ? (a.hash < b.hash ? -1 : 1) : a.file < b.file ? -1 : 1));
  return JSON.stringify({ version: SCENARIO_LIB_VERSION, scripts }, null, 2) + "\n";
}

function libWalk(dir, out) {
  let entries = [];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) libWalk(full, out);
    } else if (entry.isFile() && entry.name.endsWith(".js") && basename(dir).toLowerCase() === "source") {
      out.push(full);
    }
  }
  return out;
}

// Экспорты хаба рядом со скриптом: `{файл: {name, kind}}`. Берутся из папки
// инструмента (той, в которой лежит `source/`).
function libExports(dir) {
  const out = new Map();
  let entries = [];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json") || entry.name === "publish.json") continue;
    let template = null;
    try {
      template = JSON.parse(readFileSync(join(dir, entry.name), "utf8")).scenarioTemplate;
    } catch {
      template = null;
    }
    if (!template || typeof template !== "object" || typeof template.name !== "string") continue;
    const type = String(template.type || "").toUpperCase();
    out.set(entry.name, { name: template.name.trim(), kind: type === "GLOBAL" ? "global" : type === "LOGIC" ? "logic" : null });
  }
  return out;
}

function libPublish(dir) {
  const file = join(dir, "publish.json");
  if (!existsSync(file)) return [];
  try {
    const data = JSON.parse(readFileSync(file, "utf8"));
    return Array.isArray(data.files) ? data.files : [];
  } catch {
    return [];
  }
}

// Человеческое имя скрипта: `publish.json` → экспорт хаба с тем же именем
// файла → единственный экспорт того же вида → имя из текста (`info.name` или
// имя файла, как его читает страница).
function libNameOf(file, read) {
  const toolDir = dirname(dirname(file));
  const own = relative(toolDir, file).split(sep).join("/");
  const exports = libExports(toolDir);
  for (const entry of libPublish(toolDir)) {
    if (String(entry.source || "").split(sep).join("/") !== own) continue;
    if (typeof entry.name === "string" && entry.name.trim()) return entry.name.trim();
    const named = exports.get(String(entry.json || ""));
    if (named && named.name) return named.name;
  }
  const base = basename(file).replace(/\.js$/i, "");
  const byName = exports.get(base + ".json");
  if (byName && byName.name) return byName.name;
  const sameKind = [...exports.values()].filter((entry) => entry.kind === read.kind);
  if (sameKind.length === 1 && sameKind[0].name) return sameKind[0].name;
  return typeof read.name === "string" && read.name ? read.name : base;
}

// Ключ имени файла: инструмент и, если он что-то добавляет, имя скрипта.
// Кириллица слугом не переживает — тогда ключ говорит вид сценария, а
// различает файлы отпечаток.
function libKeyOf(file, root, kind) {
  const parts = relative(root, file).split(sep);
  const tool = scenarioLibSlug(parts[0] || "") || "script";
  const base = scenarioLibSlug(basename(file).replace(/\.js$/i, ""));
  if (!base) return tool + "." + kind;
  if (base === tool || base.startsWith(tool)) return base;
  return tool + "." + base;
}

/**
 * Что нашлось в соседнем репозитории: `[{path, source, entry}]`, отсортировано
 * по пути. Папки нет — `null` (команда об этом говорит и ничего не портит);
 * папка есть, а скриптов в ней нет — пустой список.
 */
export async function scenarioLibCollect(root) {
  const dir = resolve(root);
  try {
    if (!statSync(dir).isDirectory()) return null;
  } catch {
    return null;
  }
  const out = [];
  for (const file of libWalk(dir, []).sort()) {
    const read = hubScriptRead(readFileSync(file, "utf8"), basename(file));
    if (read.error || (read.kind !== "logic" && read.kind !== "global")) continue;
    const source = read.source;
    const hash = scenarioLibHash(source);
    out.push({
      path: relative(dir, file).split(sep).join("/"),
      source,
      entry: {
        name: libNameOf(file, read),
        version: scenarioLibVersionOf(source),
        kind: read.kind,
        hash,
        size: Buffer.byteLength(source, "utf8"),
        file: scenarioLibFileName(libKeyOf(file, dir, read.kind), hash),
      },
    });
  }
  return out;
}

function libReadme(root, entries) {
  return [
    "# Библиотека сценариев",
    "",
    "**ПАПКА СОБРАНА `tools/scenario-lib.mjs` — руками не править.**",
    "",
    "Копия логических и глобальных сценариев из репозитория `Sprut.Hub_Tools`",
    "(MIT, Copyright (c) 2025 Kirill Ashikhmin; лицензия рядом — `LICENSE`).",
    "Файл `index.json` — реестр: имя, версия, вид, отпечаток SHA-256 текста,",
    "размер в байтах и имя файла. Имя файла несёт первые 16 знаков отпечатка:",
    "новая версия скрипта — новый файл, и объект, стоящий на прежней, не",
    "меняется сам (G24.1, G27).",
    "",
    "Объект хранит ссылку `scenario.lib = {name, version, hash}`, а страница",
    "скачивает отсюда только те скрипты, на которые он ссылается, и держит их",
    "в кэше браузера (`src/scenarioLib.js`).",
    "",
    "Собрано из `" + basename(resolve(root)) + "`, скриптов: " + entries.length + ".",
    "",
    "Пересобрать:",
    "",
    "```bash",
    "node tools/scenario-lib.mjs [папка Sprut.Hub_Tools]",
    "```",
    "",
  ].join("\n");
}

/**
 * Собрать `web/scenarios/`: файлы скриптов, реестр, лицензию и памятку о
 * происхождении; лишнее от прошлой сборки убрать. Внешней папки нет — `{ok:
 * false, reason: "noSource"}` и ни одной записи на диск.
 */
export async function scenarioLibBuild({ root = SOURCE_DEFAULT, out = OUT_DEFAULT } = {}) {
  const collected = await scenarioLibCollect(root);
  if (collected === null) return { ok: false, reason: "noSource", root: resolve(root), out: resolve(out), written: [], removed: [], entries: [] };

  const entries = collected.map((item) => item.entry);
  mkdirSync(out, { recursive: true });
  const written = [];
  const keep = new Set([SCENARIO_LIB_INDEX, "LICENSE", README_NAME]);
  for (const item of collected) {
    writeFileSync(join(out, item.entry.file), item.source, "utf8");
    written.push(item.entry.file);
    keep.add(item.entry.file);
  }
  writeFileSync(join(out, SCENARIO_LIB_INDEX), scenarioLibIndexText(entries), "utf8");
  written.push(SCENARIO_LIB_INDEX);
  const license = join(resolve(root), "LICENSE");
  if (existsSync(license)) {
    writeFileSync(join(out, "LICENSE"), readFileSync(license, "utf8"), "utf8");
    written.push("LICENSE");
  }
  writeFileSync(join(out, README_NAME), libReadme(root, entries), "utf8");
  written.push(README_NAME);

  const removed = [];
  for (const name of readdirSync(out)) {
    if (name.startsWith(".") || keep.has(name)) continue;
    rmSync(join(out, name), { recursive: true, force: true });
    removed.push(name);
  }
  return { ok: true, reason: null, root: resolve(root), out: resolve(out), written, removed, entries };
}

const runDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (runDirectly) {
  const result = await scenarioLibBuild({ root: process.argv[2] ? resolve(process.argv[2]) : SOURCE_DEFAULT });
  if (!result.ok) {
    console.error("scenario-lib: нет папки " + result.root);
    console.error("Библиотека не собрана, в " + result.out + " ничего не тронуто.");
    console.error("Укажи папку Sprut.Hub_Tools аргументом: node tools/scenario-lib.mjs <папка>");
    process.exitCode = 1;
  } else {
    const bytes = result.entries.reduce((sum, entry) => sum + entry.size, 0);
    console.log("скриптов: " + result.entries.length + ", " + (bytes / 1024).toFixed(1) + " КБ, реестр: " + SCENARIO_LIB_INDEX);
    const noVersion = result.entries.filter((entry) => !entry.version).map((entry) => entry.file);
    if (noVersion.length > 0) console.log("без версии в `info` (" + noVersion.length + "): " + noVersion.join(", "));
    if (result.removed.length > 0) console.log("убрано от прошлой сборки: " + result.removed.join(", "));
    console.log("папка: " + result.out);
  }
}
