// Библиотека сценариев внутри продукта (таск 05 просмотра; истории 45, 48, 49;
// требования G23, G25, G26).
//
// Что держит файл:
//   — отпечаток скрипта считается тем же SHA-256, что `node:crypto`: иначе
//     команда сборки библиотеки и страница назвали бы один текст по-разному;
//   — **узнавание только по точному совпадению** (G24.1): подправленная своей
//     рукой копия настоящего скрипта библиотечной не считается;
//   — скачиваются **только** скрипты открытого объекта, и второй раз сети не
//     трогают (G25): ни реестр, ни файлы;
//   — скрипт не доехал — об этом говорят списком `missing`, а сценарий уходит
//     в дом помеченным (G26);
//   — команда `tools/scenario-lib.mjs` повторным запуском даёт то же самое
//     байт в байт, а без внешней папки ничего не портит.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { buildPage, listScenarioLib } from "../build.js";
import {
  SCENARIO_LIB_DIR,
  SCENARIO_LIB_INDEX,
  SCENARIO_LIB_SETTING,
  scenarioLibFetch,
  scenarioLibForget,
  scenarioLibHash,
  scenarioLibIndex,
  scenarioLibIndexRead,
  scenarioLibNewer,
  scenarioLibRef,
  scenarioLibRefOf,
  scenarioLibResolve,
} from "../src/scenarioLib.js";
import {
  scenarioLibBuild,
  scenarioLibCollect,
  scenarioLibIndexText,
  scenarioLibSlug,
  scenarioLibVersionOf,
} from "../tools/scenario-lib.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SPRUT = join(HERE, "fixtures", "sprut");
const LIB_DIR = join(HERE, "..", "web", SCENARIO_LIB_DIR);
// Соседний репозиторий владельца продукта: его нет у всякого клона, и тест о
// совпадении собранного с закоммиченным тогда пропускается (как `simHub`).
const TOOLS = join(HERE, "..", "..", "..", "Sprut.Hub_Tools");

const sha256 = (text) => createHash("sha256").update(text, "utf8").digest("hex");
const read = (file) => readFileSync(file, "utf8");

// Настоящий скрипт библиотеки и его копия, в которой человек поправил одно
// число: 99,99 % того же текста — и всё-таки не библиотечный скрипт.
const MOTION = read(join(SPRUT, "MotionLightAutomation.js"));
const MOTION_TUNED = MOTION.replace("DEBOUNCE_MANUAL_AFTER_SENSOR_MS = 5000", "DEBOUNCE_MANUAL_AFTER_SENSOR_MS = 5001");
const SWITCH_GLOBAL = read(join(SPRUT, "SwitchCallbackControl.Global.js"));

function libEntry(name, version, kind, source) {
  const hash = sha256(source);
  return { name, version, kind, hash, size: source.length, file: name.replace(/\W+/g, "") + "@" + hash.slice(0, 16) + ".js" };
}

const MOTION_ENTRY = libEntry("Автоматизация света по движению", "1.2", "logic", MOTION);
const GLOBAL_ENTRY = libEntry("SwitchCallbackControl. Глобальный", "1.0", "global", SWITCH_GLOBAL);
const INDEX_TEXT = JSON.stringify({ version: 1, scripts: [MOTION_ENTRY, GLOBAL_ENTRY] }, null, 2) + "\n";

/** Подставная сеть: отдаёт только то, что в `files`, и помнит, о чём спросили. */
function libNet(files) {
  const asked = [];
  const fetch = async (url) => {
    asked.push(String(url));
    if (!Object.prototype.hasOwnProperty.call(files, String(url))) return { ok: false, status: 404, text: async () => "" };
    return { ok: true, status: 200, text: async () => files[String(url)] };
  };
  return { fetch, asked };
}

/** Сеть, которой нет: любой запрос — отказ (и тест видит, что её трогали). */
function libNoNet() {
  const asked = [];
  return {
    asked,
    fetch: async (url) => {
      asked.push(String(url));
      throw new TypeError("fetch failed");
    },
  };
}

function libStore(initial = null) {
  const kept = new Map(initial ? [[SCENARIO_LIB_SETTING, initial]] : []);
  return {
    get: async (key) => (kept.has(key) ? structuredClone(kept.get(key)) : null),
    set: async (key, value) => {
      kept.set(key, structuredClone(value));
      return { ok: true };
    },
    saved: () => kept.get(SCENARIO_LIB_SETTING) || null,
  };
}

const INDEX_URL = SCENARIO_LIB_DIR + "/" + SCENARIO_LIB_INDEX;
const libFiles = () => ({
  [INDEX_URL]: INDEX_TEXT,
  [SCENARIO_LIB_DIR + "/" + MOTION_ENTRY.file]: MOTION,
  [SCENARIO_LIB_DIR + "/" + GLOBAL_ENTRY.file]: SWITCH_GLOBAL,
});

/** Объект со ссылками на библиотеку: `lib` у записей сценария — поле таска 06. */
function libProject({ second = null } = {}) {
  const scenarios = [
    { id: "s-block", kind: "block", name: "Клавиша → свет", order: 0, active: true, targets: [] },
    {
      id: "s-motion",
      kind: "logic",
      name: "Свет по движению",
      order: 1,
      active: true,
      source: "",
      lib: { name: MOTION_ENTRY.name, version: MOTION_ENTRY.version, hash: MOTION_ENTRY.hash },
    },
  ];
  if (second) scenarios.push({ id: "s-second", kind: "global", name: "Второй", order: 2, active: true, source: "", lib: second });
  return { id: "p1", key: "k1", schemes: [], marks: [], types: [], rooms: [], scenarios };
}

// ——— отпечаток ————————————————————————————————————————————————————————————

test("отпечаток скрипта — тот же SHA-256, что у node:crypto", () => {
  for (const text of ["", "a", "Скрипт «Мастер-выключатель» 💡\n", MOTION, SWITCH_GLOBAL]) {
    assert.equal(scenarioLibHash(text), sha256(text), "отпечаток длиной " + text.length);
  }
});

test("отпечаток не зависит от того, как текст пришёл: байты те же — хэш тот же", () => {
  assert.equal(scenarioLibHash(MOTION), scenarioLibHash(String(MOTION)));
  assert.notEqual(scenarioLibHash(MOTION), scenarioLibHash(MOTION_TUNED));
});

// ——— реестр ———————————————————————————————————————————————————————————————

test("реестр читается в карту по отпечатку", () => {
  const index = scenarioLibIndexRead(INDEX_TEXT);
  assert.equal(index.size, 2);
  const entry = index.get(MOTION_ENTRY.hash);
  assert.equal(entry.name, MOTION_ENTRY.name);
  assert.equal(entry.version, "1.2");
  assert.equal(entry.kind, "logic");
  assert.equal(entry.file, MOTION_ENTRY.file);
  assert.equal(index.get(GLOBAL_ENTRY.hash).kind, "global");
});

test("мусор в реестре выбрасывается, а не роняет чтение", () => {
  const index = scenarioLibIndexRead(
    JSON.stringify({ version: 1, scripts: [MOTION_ENTRY, null, { name: "без хэша", file: "x.js" }, { hash: "короткий", file: "y.js" }, { hash: MOTION_ENTRY.hash }] }),
  );
  assert.equal(index.size, 1);
  assert.equal(scenarioLibIndexRead("это не JSON").size, 0);
  assert.equal(scenarioLibIndexRead(null).size, 0);
});

// ——— узнавание по точному совпадению (G24.1) ———————————————————————————————

test("библиотечный скрипт узнаётся по точному совпадению", () => {
  const index = scenarioLibIndexRead(INDEX_TEXT);
  assert.deepEqual(scenarioLibRefOf(MOTION, index), {
    name: MOTION_ENTRY.name,
    version: "1.2",
    hash: MOTION_ENTRY.hash,
  });
});

test("поправленная своей рукой копия — не библиотечный скрипт", () => {
  const index = scenarioLibIndexRead(INDEX_TEXT);
  // Одна цифра из 56 тысяч знаков: похожесть 99,99 %, совпадения нет.
  assert.notEqual(MOTION_TUNED, MOTION);
  assert.equal(MOTION_TUNED.length, MOTION.length);
  // Та же копия, но реестр собран по ней: узнаётся — значит молчание выше про
  // текст, а не про сломанное узнавание.
  const tunedIndex = scenarioLibIndexRead(JSON.stringify({ version: 1, scripts: [libEntry("Поправленный", "1.2", "logic", MOTION_TUNED)] }));
  assert.ok(scenarioLibRefOf(MOTION_TUNED, tunedIndex), "по своему реестру копия узнаётся");
  assert.equal(scenarioLibRefOf(MOTION, tunedIndex), null);
  assert.equal(scenarioLibRefOf(MOTION_TUNED, index), null);
  assert.equal(scenarioLibRefOf(MOTION + "\n", index), null);
  assert.equal(scenarioLibRefOf("", index), null);
  assert.equal(scenarioLibRefOf(null, index), null);
});

test("ссылка записи сценария читается, кривой отпечаток не принимается", () => {
  assert.deepEqual(scenarioLibRef({ lib: { name: "Имя", version: "1.0", hash: MOTION_ENTRY.hash.toUpperCase() } }), {
    name: "Имя",
    version: "1.0",
    hash: MOTION_ENTRY.hash,
  });
  assert.equal(scenarioLibRef({ lib: { name: "Имя", hash: "деадбиф" } }), null);
  assert.equal(scenarioLibRef({ source: "текст" }), null);
  assert.equal(scenarioLibRef(null), null);
});

// ——— версия новее (G27: предложение, не подмена) ————————————————————————————

test("версия новее находится по имени, а числа сравниваются числами", () => {
  const next = { ...MOTION_ENTRY, version: "1.10", hash: sha256(MOTION + "// правка\n"), file: "m@2.js" };
  const index = scenarioLibIndexRead(JSON.stringify({ version: 1, scripts: [MOTION_ENTRY, next] }));
  const found = scenarioLibNewer({ name: MOTION_ENTRY.name, version: "1.2", hash: MOTION_ENTRY.hash }, index);
  assert.equal(found && found.version, "1.10");
  assert.equal(scenarioLibNewer({ name: MOTION_ENTRY.name, version: "1.10", hash: next.hash }, index), null);
  assert.equal(scenarioLibNewer({ name: "чужой", version: "1.0", hash: MOTION_ENTRY.hash }, index), null);
  // Версии нет (глобальный скрипт без `info`) — и предлагать нечего.
  assert.equal(scenarioLibNewer({ name: MOTION_ENTRY.name, version: "", hash: MOTION_ENTRY.hash }, index), null);
});

// ——— разрешение перед домом (G25, G26) ——————————————————————————————————————

test("разрешаются только скрипты открытого объекта, остальные файлы не трогаются", async () => {
  scenarioLibForget();
  const net = libNet(libFiles());
  const store = libStore();
  const project = libProject();
  const result = await scenarioLibResolve(project, { fetch: net.fetch, store });

  const motion = result.scenarios.find((scenario) => scenario.id === "s-motion");
  assert.equal(motion.source, MOTION);
  assert.deepEqual(result.missing, []);
  // Блочный сценарий возвращается той же записью: разрешение его не касается.
  assert.equal(result.scenarios.find((scenario) => scenario.id === "s-block"), project.scenarios[0]);
  assert.deepEqual(net.asked, [INDEX_URL, SCENARIO_LIB_DIR + "/" + MOTION_ENTRY.file]);
  assert.ok(!net.asked.includes(SCENARIO_LIB_DIR + "/" + GLOBAL_ENTRY.file), "глобальный скрипт объекту не нужен");
});

test("второе открытие сети не трогает: скрипты лежат в кэше сеанса", async () => {
  scenarioLibForget();
  const net = libNet(libFiles());
  const store = libStore();
  await scenarioLibResolve(libProject(), { fetch: net.fetch, store });
  const dead = libNoNet();
  const again = await scenarioLibResolve(libProject(), { fetch: dead.fetch, store });
  assert.equal(again.scenarios.find((scenario) => scenario.id === "s-motion").source, MOTION);
  assert.deepEqual(dead.asked, []);
});

test("кэш переживает перезагрузку страницы: сети нет, а скрипт есть", async () => {
  scenarioLibForget();
  const store = libStore();
  const net = libNet(libFiles());
  await scenarioLibResolve(libProject(), { fetch: net.fetch, store });
  assert.ok(store.saved(), "кэш записан в настройки браузера");

  scenarioLibForget();
  const dead = libNoNet();
  const after = await scenarioLibResolve(libProject(), { fetch: dead.fetch, store });
  assert.equal(after.scenarios.find((scenario) => scenario.id === "s-motion").source, MOTION);
  assert.deepEqual(after.missing, []);
  assert.deepEqual(dead.asked, []);
});

test("скрипт не доехал: сценарий помечен, остальные записи целы", async () => {
  scenarioLibForget();
  const net = libNet(libFiles());
  const gone = { name: "Мастер-выключатель", version: "1.0", hash: sha256("этого в библиотеке нет") };
  const result = await scenarioLibResolve(libProject({ second: gone }), { fetch: net.fetch, store: libStore() });

  assert.deepEqual(result.missing, [{ id: "s-second", name: "Мастер-выключатель", version: "1.0", hash: gone.hash }]);
  const second = result.scenarios.find((scenario) => scenario.id === "s-second");
  assert.equal(second.source, "");
  assert.equal(second.libMissing, true);
  assert.equal(second.active, false);
  // Доехавший сценарий работает как ни в чём не бывало.
  assert.equal(result.scenarios.find((scenario) => scenario.id === "s-motion").source, MOTION);
});

test("подменённый файл библиотечным не считается: отпечаток сверяется", async () => {
  scenarioLibForget();
  const files = libFiles();
  files[SCENARIO_LIB_DIR + "/" + MOTION_ENTRY.file] = MOTION_TUNED;
  const result = await scenarioLibResolve(libProject(), { fetch: libNet(files).fetch, store: libStore() });
  assert.equal(result.missing.length, 1);
  assert.equal(result.scenarios.find((scenario) => scenario.id === "s-motion").source, "");
});

test("объект без библиотечных ссылок сети не касается и записи отдаёт как есть", async () => {
  scenarioLibForget();
  const dead = libNoNet();
  const plain = { id: "p2", scenarios: [{ id: "s1", kind: "logic", name: "Своя логика", order: 0, source: "info = {};" }] };
  const result = await scenarioLibResolve(plain, { fetch: dead.fetch, store: libStore() });
  assert.deepEqual(result.missing, []);
  assert.equal(result.scenarios[0], plain.scenarios[0]);
  assert.deepEqual(dead.asked, []);
});

test("один скрипт по ссылке: дверь `scenarioLibFetch` и отказ без сети", async () => {
  scenarioLibForget();
  const net = libNet(libFiles());
  const ref = { name: GLOBAL_ENTRY.name, version: "1.0", hash: GLOBAL_ENTRY.hash };
  assert.equal(await scenarioLibFetch(ref, { fetch: net.fetch, store: libStore() }), SWITCH_GLOBAL);
  scenarioLibForget();
  assert.equal(await scenarioLibFetch(ref, { fetch: libNoNet().fetch, store: libStore() }), null);
  assert.equal(await scenarioLibFetch({ hash: "кривой" }, { fetch: net.fetch }), null);
});

test("реестр берётся из кэша, когда сети нет", async () => {
  scenarioLibForget();
  const store = libStore();
  await scenarioLibIndex({ fetch: libNet(libFiles()).fetch, store });
  scenarioLibForget();
  const index = await scenarioLibIndex({ fetch: libNoNet().fetch, store });
  assert.equal(index.size, 2);
});

// ——— команда сборки библиотеки ——————————————————————————————————————————————

test("версия скрипта читается из `info`, а у глобального её нет", () => {
  assert.equal(scenarioLibVersionOf(MOTION), "1.2");
  assert.equal(scenarioLibVersionOf(SWITCH_GLOBAL), "");
  assert.equal(scenarioLibVersionOf(""), "");
  // `version` вне `info` версией скрипта не считается.
  assert.equal(scenarioLibVersionOf('const meta = { version: "9.9" };\n'), "");
});

test("имя файла библиотеки — латиница, цифры и точка", () => {
  assert.equal(scenarioLibSlug("MotionLightAutomation"), "MotionLightAutomation");
  assert.equal(scenarioLibSlug("SwitchCallbackControl.Global"), "SwitchCallbackControl.Global");
  assert.equal(scenarioLibSlug("Скрыть устройство"), "");
  assert.equal(scenarioLibSlug("💡 Авто light 2"), "light-2");
});

test("реестр собирается одним и тем же текстом: порядок задан, времени в нём нет", () => {
  const entries = [GLOBAL_ENTRY, MOTION_ENTRY];
  const first = scenarioLibIndexText(entries);
  const second = scenarioLibIndexText([MOTION_ENTRY, GLOBAL_ENTRY]);
  assert.equal(first, second, "порядок записей не зависит от порядка чтения папки");
  assert.ok(first.endsWith("\n"));
  const parsed = JSON.parse(first);
  assert.equal(parsed.version, 1);
  assert.deepEqual(
    parsed.scripts.map((entry) => entry.file),
    [...entries].map((entry) => entry.file).sort(),
  );
  assert.equal(scenarioLibIndexRead(first).size, 2);
});

test("без внешней папки команда ничего не портит", async () => {
  const out = mkdtempSync(join(tmpdir(), "scenario-lib-none-"));
  const result = await scenarioLibBuild({ root: join(out, "нет-такой-папки"), out });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "noSource");
  assert.deepEqual(result.written, []);
  assert.deepEqual(readdirSync(out), [], "в папке выкладки не появилось ни одного файла");
  assert.equal(await scenarioLibCollect(join(out, "нет-такой-папки")), null);
  // Папка есть, скриптов в ней нет — это не «папки нет»: пустой список, не отказ.
  assert.deepEqual(await scenarioLibCollect(out), []);
});

test("команда собирает папку и реестр, а повторный запуск даёт то же байт в байт", async () => {
  const root = mkdtempSync(join(tmpdir(), "scenario-lib-src-"));
  const out = mkdtempSync(join(tmpdir(), "scenario-lib-out-"));
  mkdirSync(join(root, "MotionLightAutomation", "source"), { recursive: true });
  writeFileSync(join(root, "MotionLightAutomation", "source", "MotionLightAutomation.js"), MOTION);
  writeFileSync(
    join(root, "MotionLightAutomation", "MotionLightAutomation.json"),
    JSON.stringify({ scenarioTemplate: { name: MOTION_ENTRY.name, type: "LOGIC", data: MOTION } }),
  );
  mkdirSync(join(root, "SwitchCallbackControl", "source"), { recursive: true });
  writeFileSync(join(root, "SwitchCallbackControl", "source", "SwitchCallbackControl.Global.js"), SWITCH_GLOBAL);
  writeFileSync(join(root, "LICENSE"), "MIT License\n");
  // Мусор прошлой сборки: команда убирает за собой.
  writeFileSync(join(out, "stale@0000000000000000.js"), "старое");

  const first = await scenarioLibBuild({ root, out });
  assert.equal(first.ok, true);
  assert.equal(first.entries.length, 2);
  assert.ok(first.removed.includes("stale@0000000000000000.js"), "мусор убран");
  assert.ok(existsSync(join(out, SCENARIO_LIB_INDEX)), "реестр записан");
  assert.ok(existsSync(join(out, "LICENSE")), "лицензия едет вместе с копией");

  const index = scenarioLibIndexRead(read(join(out, SCENARIO_LIB_INDEX)));
  const entry = index.get(sha256(MOTION));
  assert.equal(entry.name, MOTION_ENTRY.name, "имя берётся из экспорта хаба");
  assert.equal(entry.version, "1.2");
  assert.equal(entry.kind, "logic");
  assert.equal(entry.size, Buffer.byteLength(MOTION, "utf8"));
  assert.equal(read(join(out, entry.file)), MOTION, "файл библиотеки — тот же текст байт в байт");
  assert.equal(index.get(sha256(SWITCH_GLOBAL)).kind, "global");

  const before = new Map(readdirSync(out).map((name) => [name, read(join(out, name))]));
  const again = await scenarioLibBuild({ root, out });
  assert.equal(again.ok, true);
  const after = new Map(readdirSync(out).map((name) => [name, read(join(out, name))]));
  assert.deepEqual([...after.keys()].sort(), [...before.keys()].sort());
  for (const [name, text] of before) assert.equal(after.get(name), text, "повторный запуск: " + name);
});

// ——— выкладка ———————————————————————————————————————————————————————————————

test("закоммиченная библиотека на месте и читается тем же чтением, что в странице", () => {
  const index = scenarioLibIndexRead(read(join(LIB_DIR, SCENARIO_LIB_INDEX)));
  assert.ok(index.size >= 10, "в библиотеке меньше десяти скриптов — это не она");
  for (const entry of index.values()) {
    const file = join(LIB_DIR, entry.file);
    assert.ok(existsSync(file), "нет файла библиотеки: " + entry.file);
    const source = read(file);
    assert.equal(scenarioLibHash(source), entry.hash, "отпечаток разошёлся: " + entry.file);
    assert.equal(Buffer.byteLength(source, "utf8"), entry.size, "размер разошёлся: " + entry.file);
    assert.deepEqual(scenarioLibRefOf(source, index), { name: entry.name, version: entry.version, hash: entry.hash });
  }
  assert.ok(existsSync(join(LIB_DIR, "LICENSE")), "лицензия Sprut.Hub_Tools лежит рядом с копией");
});

test("сборка кладёт библиотеку рядом со страницами", async () => {
  const files = await listScenarioLib();
  const names = files.map((file) => file.name);
  // Та же раскладка приезжает из самой сборки: `build()` пишет этот список в
  // `dist/` побайтово рядом со страницами.
  assert.deepEqual((await buildPage()).library.map((file) => file.name), names);
  assert.ok(names.includes(SCENARIO_LIB_DIR + "/" + SCENARIO_LIB_INDEX), "реестра нет в выкладке");
  const index = scenarioLibIndexRead(read(join(LIB_DIR, SCENARIO_LIB_INDEX)));
  for (const entry of index.values()) {
    assert.ok(names.includes(SCENARIO_LIB_DIR + "/" + entry.file), "нет в выкладке: " + entry.file);
  }
  for (const name of names) assert.ok(name.startsWith(SCENARIO_LIB_DIR + "/"), "чужое имя в библиотеке: " + name);
});

// Соседнего репозитория нет у всякого клона — тогда пропускается (как `simHub`).
test("собранное из Sprut.Hub_Tools совпадает с закоммиченным", { skip: !existsSync(TOOLS) }, async () => {
  const collected = await scenarioLibCollect(TOOLS);
  assert.ok(collected.length >= 10, "в соседнем репозитории нашлось меньше десяти скриптов");
  const text = scenarioLibIndexText(collected.map((item) => item.entry));
  assert.equal(text, read(join(LIB_DIR, SCENARIO_LIB_INDEX)), "реестр в git разошёлся с Sprut.Hub_Tools — перезапусти tools/scenario-lib.mjs");
  for (const item of collected) {
    assert.equal(read(join(LIB_DIR, item.entry.file)), item.source, "файл в git разошёлся: " + item.entry.file);
  }
  // Два текста одного скрипта (исходник и экспорт хаба) в библиотеке один:
  // второй — «похожий», и ссылкой он не становится (G24.1).
  const index = scenarioLibIndexRead(text);
  const master = join(TOOLS, "TurnOffAllLight", "MasterSwitch.js");
  const exported = join(TOOLS, "TurnOffAllLight", "MasterSwitch.json");
  if (existsSync(master) && existsSync(exported)) {
    const js = read(master);
    const data = JSON.parse(read(exported)).scenarioTemplate.data;
    assert.notEqual(js, data, "фикстура потеряла смысл: тексты совпали");
    assert.ok(scenarioLibRefOf(js, index), "исходник MasterSwitch в библиотеке есть");
    assert.equal(scenarioLibRefOf(data, index), null, "экспорт хаба отличается двумя байтами — и ссылкой не становится");
  }
});
