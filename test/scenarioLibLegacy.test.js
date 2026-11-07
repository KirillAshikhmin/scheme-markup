// G68 для ссылки на библиотечный скрипт: готовый объект не ломается (таск 06
// просмотра; требования G24, G24.1, G27).
//
// Здесь проверяется самое дорогое — что перевод текста сценария на ссылку
// ничего не меняет ни в прежних объектах, ни в поведении дома:
//
//   1. объект прежней разметки проходит **оба** конвейера открытия (файл и
//      база браузера) при живом реестре и остаётся тем же объектом;
//   2. объект со сценариями переводится обоими конвейерами одинаково, а скрипт,
//      поправленный своей рукой, остаётся текстом;
//   3. дом после перевода — тот же: журнал и значения совпадают, в том числе
//      после записи в файл и повторного открытия;
//   4. реестр с версией новее поведение готового объекта не меняет — объект
//      идёт на своей версии.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { addLogicBinding, addScenario, findScenario, migrateScenarioLib, scenarioLibOf } from "../src/model.js";
import { PROJECT_ENTRY, packProject, readZip, unpackProject } from "../src/projectFile.js";
import { projectsMigrateStored } from "../src/panels/projects.js";
import {
  SCENARIO_LIB_DIR,
  SCENARIO_LIB_INDEX,
  SCENARIO_LIB_VERSION,
  scenarioLibFileName,
  scenarioLibForget,
  scenarioLibHash,
  scenarioLibIndexRead,
  scenarioLibNewer,
  scenarioLibRefOf,
  scenarioLibResolve,
} from "../src/scenarioLib.js";
import { scenariosUpdateLib } from "../src/panels/scenarios.js";
import { scenarioLibBuild } from "../tools/scenario-lib.mjs";
import { createSimEngine } from "../src/sim/engine.js";
import { buildHomeSpec } from "../src/sim/home.js";
import { createHubOwner } from "../src/sim/hubApi.js";
import { hubScriptRead } from "../src/sim/hubApi.js";
import { simHouse, simPut, simRecorder } from "./fixtures/simHome.js";

const SPRUT = new URL("./fixtures/sprut/", import.meta.url);
const T0 = Date.UTC(2026, 9, 23, 12, 0, 0);

function read(name) {
  return readFileSync(new URL("./" + name, import.meta.url), "utf8");
}

function sprut(name) {
  const got = hubScriptRead(readFileSync(new URL(name, SPRUT), "utf8"), name);
  assert.equal(got.error, undefined, name);
  return got;
}

/**
 * Поддельная библиотека со своим реестром и своей сетью: файлы — настоящие
 * сценарии Sprut.Hub из `test/fixtures/sprut/`, отпечатки считает та же
 * `scenarioLibHash`. Отдаёт дверь узнавания для миграций и `opts` для
 * `scenarioLibResolve` (своя `fetch`, своё хранилище).
 */
function library(items) {
  const scripts = [];
  const files = new Map();
  for (const item of items) {
    const hash = scenarioLibHash(item.source);
    const file = scenarioLibFileName(item.key, hash);
    scripts.push({ name: item.name, version: item.version === undefined ? "1.0" : item.version, kind: item.kind || "logic", hash, size: item.source.length, file });
    files.set(file, item.source);
  }
  const json = JSON.stringify({ version: SCENARIO_LIB_VERSION, scripts });
  const index = scenarioLibIndexRead(json);
  const saved = new Map();
  const fetch = async (url) => {
    if (url === SCENARIO_LIB_DIR + "/" + SCENARIO_LIB_INDEX) return { ok: true, text: async () => json };
    const name = url.startsWith(SCENARIO_LIB_DIR + "/") ? url.slice(SCENARIO_LIB_DIR.length + 1) : "";
    if (!files.has(name)) return { ok: false, text: async () => "" };
    return { ok: true, text: async () => files.get(name) };
  };
  return {
    index,
    door: { refOf: (source) => scenarioLibRefOf(source, index) },
    opts: { fetch, store: { get: (key) => saved.get(key), set: (key, value) => saved.set(key, value) } },
  };
}

// ——— дом с хозяином скриптов ————————————————————————————————————————————————

/**
 * Дом объекта: журнал и значения после одних и тех же действий. `resolved` —
 * разрешённые сценарии (`scenarioLibResolve`) или `null`.
 */
function homeRun(project, marks, resolved) {
  const recorder = simRecorder();
  const engine = createSimEngine({ emit: recorder.emit, owners: [createHubOwner()] });
  engine.load({ ...buildHomeSpec(project, resolved), rooms: project.rooms, site: null });
  engine.setClock({ simMs: T0 });
  engine.start();
  for (const mark of ["ОВ1", "ОВ2"]) {
    engine.act({ kind: "set", markId: marks[mark], service: 0, char: "On", value: true });
    engine.advanceTo(engine.now());
  }
  return {
    log: recorder.log().map((entry) => ({ kind: entry.kind, code: entry.code, vars: entry.vars || null })),
    values: ["ОВ1", "ОВ2", "ОВ3"].map((mark) => engine.value(marks[mark], 0, "On")),
  };
}

/**
 * Объект версии 6 с тремя скриптами: два библиотечных (глобальный и
 * логический, привязанный к трём выключателям) и один поправленный своей
 * рукой. Ровно тот случай, которого боится G24.1.
 */
function houseWithScripts() {
  const box = simHouse();
  simPut(box, "ОВ", { x: 0.26, y: 0.4 }, "hall");
  simPut(box, "ОВ", { x: 0.5, y: 0.4 }, "living");
  simPut(box, "ОВ", { x: 0.8, y: 0.4 }, "bedroom");
  const global = sprut("SwitchCallbackControl.Global.js");
  const logic = sprut("SwitchCallbackControl.Logic.js");
  const own = sprut("HideIfTurnOn.js");
  const mine = own.source + "\n// своя правка под объект\n";

  let project = box.project;
  const ids = {};
  for (const [key, record] of [
    ["global", { kind: "global", name: "Реестр обратных вызовов", source: global.source }],
    ["logic", { kind: "logic", name: "Выключатель по обратному вызову", source: logic.source }],
    ["mine", { kind: "logic", name: "Свой скрипт", source: mine }],
  ]) {
    const added = addScenario(project, record);
    project = added.project;
    ids[key] = added.scenario.id;
  }
  for (const mark of ["ОВ1", "ОВ2", "ОВ3"]) {
    project = addLogicBinding(project, { scenarioId: ids.logic, markId: box.marks[mark], service: 0 }).project;
  }
  const lib = library([
    { key: "SwitchCallbackControl.Global", name: "Реестр обратных вызовов", kind: "global", version: "", source: global.source },
    { key: "SwitchCallbackControl.Logic", name: "Выключатель по обратному вызову", source: logic.source },
  ]);
  return { project, marks: box.marks, ids, lib, mine, sources: { global: global.source, logic: logic.source } };
}

// ——— 1. прежний объект проходит оба конвейера и не меняется ———————————————

const LEGACY = ["legacy-project.json", "legacy-views-project.json", "legacy-openings-project.json", "legacy-drawing-project.json"];

for (const name of LEGACY) {
  test("G68: " + name + " при живом реестре открывается обоими конвейерами без единой правки", async () => {
    scenarioLibForget();
    const legacy = JSON.parse(read(name));
    const lib = library([{ key: "HideIfTurnOn", name: "Скрыть при включении", source: sprut("HideIfTurnOn.js").source }]);

    // База браузера: объект прежней разметки сценариев не знает вовсе, и
    // миграция ссылок обязана отдать **тот же** объект.
    const withDoor = projectsMigrateStored(legacy, lib.door);
    const without = projectsMigrateStored(legacy);
    assert.equal(JSON.stringify(withDoor), JSON.stringify(without), "реестр изменил открытие объекта без сценариев");

    // Файл: тот же текст и та же версия, что без реестра.
    const blob = await packProject(legacy, new Map(), { date: new Date("2026-10-22T10:00:00Z") });
    const plain = (await unpackProject(blob)).project;
    const pinned = (await unpackProject(blob, { library: lib.door })).project;
    assert.equal(JSON.stringify(pinned), JSON.stringify(plain));
    assert.ok(pinned.formatVersion < 7, "объекту без сценариев версия 7 не нужна");
    const text = new TextDecoder().decode((await readZip(blob)).get(PROJECT_ENTRY));
    assert.ok(!text.includes('"lib"'), "в файл прежнего объекта дописано поле lib");
  });
}

// ——— 2. оба конвейера переводят одинаково ————————————————————————————————

test("объект со сценариями: файл и база браузера переводят на ссылку одинаково, свой скрипт остаётся текстом", async () => {
  scenarioLibForget();
  const box = houseWithScripts();

  const stored = projectsMigrateStored(box.project, box.lib.door);
  const blob = await packProject(box.project, new Map(), { date: new Date("2026-11-07T10:00:00Z") });
  const fromFile = (await unpackProject(blob, { library: box.lib.door })).project;

  for (const project of [stored, fromFile]) {
    assert.equal(findScenario(project, box.ids.global).source, undefined, "глобальный остался текстом");
    assert.equal(findScenario(project, box.ids.logic).source, undefined, "логический остался текстом");
    assert.ok(scenarioLibOf(findScenario(project, box.ids.global)), "глобальный не стал ссылкой");
    assert.ok(scenarioLibOf(findScenario(project, box.ids.logic)), "логический не стал ссылкой");
    // Своя рука неприкосновенна.
    assert.equal(scenarioLibOf(findScenario(project, box.ids.mine)), null);
    assert.equal(findScenario(project, box.ids.mine).source, box.mine);
  }
  assert.equal(JSON.stringify(stored.scenarios), JSON.stringify(fromFile.scenarios), "конвейеры разошлись");
  assert.equal(fromFile.formatVersion, 7);

  // Файл стал короче почти на все выброшенные тексты: вместо каждого в записи
  // осталась ссылка (имя, версия, 64 знака отпечатка) — около двух сотен байт
  // на сценарий. У настоящих скриптов библиотеки (15–38 КБ) это и есть «втрое
  // и больше», у коротких фикстур — доля ниже.
  const long = new TextDecoder().decode((await readZip(blob)).get(PROJECT_ENTRY));
  const short = new TextDecoder().decode((await readZip(await packProject(fromFile, new Map()))).get(PROJECT_ENTRY));
  const dropped = box.sources.global.length + box.sources.logic.length;
  assert.ok(long.length - short.length > dropped * 0.8, "файл похудел на " + (long.length - short.length) + " из " + dropped);
});

// ——— 3. дом тот же ————————————————————————————————————————————————————————

test("дом после перевода на ссылку тот же: журнал и значения совпадают, и после записи в файл тоже", async () => {
  scenarioLibForget();
  const box = houseWithScripts();
  const before = homeRun(box.project, box.marks, null);
  assert.ok(before.log.length > 0, "журнал пуст — сравнивать нечего");
  assert.deepEqual(before.values, [true, true, false]);

  // Перевод, запись в файл, повторное открытие — и скрипты из библиотеки.
  const pinned = projectsMigrateStored(box.project, box.lib.door);
  const reopened = (await unpackProject(await packProject(pinned, new Map()))).project;
  assert.equal(scenarioLibOf(findScenario(reopened, box.ids.logic)).hash, scenarioLibOf(findScenario(pinned, box.ids.logic)).hash);

  const resolved = await scenarioLibResolve(reopened, box.lib.opts);
  assert.deepEqual(resolved.missing, [], "скрипты не доехали");
  const after = homeRun(reopened, box.marks, resolved);
  assert.deepEqual(after.values, before.values, "значения дома разошлись");
  assert.deepEqual(after.log, before.log, "журнал дома разошёлся");
});

test("реестр с версией новее поведение готового объекта не меняет: дом идёт на своей версии", async () => {
  scenarioLibForget();
  const box = houseWithScripts();
  const before = homeRun(box.project, box.marks, null);
  const pinned = projectsMigrateStored(box.project, box.lib.door);

  // Та же библиотека, но у логического появилась версия 1.1 с другим текстом.
  const logic = sprut("SwitchCallbackControl.Logic.js");
  const global = sprut("SwitchCallbackControl.Global.js");
  const next = library([
    { key: "SwitchCallbackControl.Global", name: "Реестр обратных вызовов", kind: "global", version: "", source: global.source },
    { key: "SwitchCallbackControl.Logic", name: "Выключатель по обратному вызову", source: logic.source },
    { key: "SwitchCallbackControl.Logic", name: "Выключатель по обратному вызову", version: "1.1", source: logic.source + "\nfunction broken() { return 1; }\n" },
  ]);
  scenarioLibForget();
  const resolved = await scenarioLibResolve(pinned, next.opts);
  assert.deepEqual(resolved.missing, []);
  const own = resolved.scenarios.find((item) => item.id === box.ids.logic);
  assert.equal(own.source, logic.source, "дом получил чужую новую версию вместо своей");
  assert.deepEqual(homeRun(pinned, box.marks, resolved).log, before.log);

  // И сама миграция новую версию не подставляет.
  assert.equal(migrateScenarioLib(pinned, next.door).changed, false);
  assert.equal(scenarioLibOf(findScenario(pinned, box.ids.logic)).version, "1.0");
});

// ——— 4. библиотека только прирастает ——————————————————————————————————————
//
// Самое опасное место всей затеи: после перевода **единственная** копия текста
// скрипта — файл библиотеки. Обновили библиотеку из `Sprut.Hub_Tools` —
// отпечаток сменился; если файл прежнего отпечатка исчезнет, переведённый
// месяц назад объект останется без текста навсегда. Поэтому сборка
// прирастающая, и это проверяется настоящей командой на настоящем скрипте.

// Сеть поддельной библиотеки, читающая собранную папку с диска.
function libFolder(out) {
  return {
    fetch: async (url) => {
      const name = url === SCENARIO_LIB_DIR + "/" + SCENARIO_LIB_INDEX ? SCENARIO_LIB_INDEX : url.slice(SCENARIO_LIB_DIR.length + 1);
      const file = join(out, name);
      if (!existsSync(file)) return { ok: false, text: async () => "" };
      return { ok: true, text: async () => readFileSync(file, "utf8") };
    },
    store: { get: () => null, set: () => {} },
  };
}

test("обновление библиотеки не отбирает текст у переведённого объекта: прежний отпечаток остаётся разрешимым", async () => {
  const root = mkdtempSync(join(tmpdir(), "scenario-lib-grow-src-"));
  const out = mkdtempSync(join(tmpdir(), "scenario-lib-grow-out-"));
  const where = join(root, "SwitchCallbackControl", "source");
  mkdirSync(where, { recursive: true });
  // Глобальный скрипт: версии в нём нет вовсе — ровно тот случай, которого
  // большинство в живом объекте заказчика.
  const was = sprut("SwitchCallbackControl.Global.js").source;
  writeFileSync(join(where, "SwitchCallbackControl.Global.js"), was);
  assert.equal((await scenarioLibBuild({ root, out })).ok, true);

  const first = scenarioLibIndexRead(readFileSync(join(out, SCENARIO_LIB_INDEX), "utf8"));
  const wasHash = scenarioLibHash(was);
  assert.equal(first.get(wasHash).version, "", "у глобального скрипта версии нет");
  assert.equal(first.get(wasHash).current, true);

  // Объект переведён на эту сборку.
  const made = (() => {
    const box = simHouse();
    const added = addScenario(box.project, { kind: "global", name: first.get(wasHash).name, source: was });
    return { project: migrateScenarioLib(added.project, { refOf: (source) => scenarioLibRefOf(source, first) }).project, id: added.scenario.id };
  })();
  assert.equal(scenarioLibOf(findScenario(made.project, made.id)).hash, wasHash);

  // Библиотека обновилась: текст другой, имя то же, версии по-прежнему нет.
  const now = was + "\n// правка в Sprut.Hub_Tools\n";
  writeFileSync(join(where, "SwitchCallbackControl.Global.js"), now);
  const again = await scenarioLibBuild({ root, out });
  assert.deepEqual(again.lost, [], "файл прежнего отпечатка пропал — объекты остались без текста");
  assert.equal(again.kept.length, 1, "прежняя запись не переехала в новый реестр");
  assert.deepEqual(again.removed, [], "сборка удалила файл скрипта");

  const second = scenarioLibIndexRead(readFileSync(join(out, SCENARIO_LIB_INDEX), "utf8"));
  assert.ok(second.has(wasHash), "прежний отпечаток выпал из реестра — ссылку не разрешить");
  assert.ok(existsSync(join(out, second.get(wasHash).file)), "файл прежнего отпечатка удалён");
  assert.equal(second.get(wasHash).current, false);
  assert.equal(second.get(scenarioLibHash(now)).current, true);

  // Объект разрешается **своим** текстом, а не новым.
  scenarioLibForget();
  const kept = await scenarioLibResolve(made.project, libFolder(out));
  assert.deepEqual(kept.missing, []);
  assert.equal(kept.scenarios.find((item) => item.id === made.id).source, was);

  // И предложение обновиться приходит, хотя версий нет ни у одной записи.
  const newer = scenarioLibNewer(scenarioLibOf(findScenario(made.project, made.id)), second);
  assert.equal(newer.hash, scenarioLibHash(now), "безверсионному скрипту не пришло «обновить?»");

  const step = scenariosUpdateLib(made.project, made.id, newer);
  assert.ok(step && step.label);
  scenarioLibForget();
  const fresh = await scenarioLibResolve(step.project, libFolder(out));
  assert.equal(fresh.scenarios.find((item) => item.id === made.id).source, now, "после обновления дом не взял новый текст");
  assert.equal(scenarioLibOf(findScenario(made.project, made.id)).hash, wasHash, "прежний объект цел — отмена вернёт его");
});

// ——— 5. скрипт не доехал (G26) ————————————————————————————————————————————

test("скрипта в библиотеке нет: дом идёт без него, запись помечена, текст не выдуман", async () => {
  scenarioLibForget();
  const box = houseWithScripts();
  const pinned = projectsMigrateStored(box.project, box.lib.door);
  // Пустая библиотека и сеть, которая ничего не отдаёт.
  const nothing = { fetch: async () => ({ ok: false, text: async () => "" }), store: { get: () => null, set: () => {} } };
  const resolved = await scenarioLibResolve(pinned, nothing);
  assert.equal(resolved.missing.length, 2, "о каждом пропавшем скрипте сказано");
  for (const item of resolved.scenarios) {
    if (!scenarioLibOf(item)) continue;
    assert.equal(item.source, "", "выдуманный текст вместо библиотечного");
    assert.equal(item.active, false);
    assert.equal(item.libMissing, true);
  }
  // Свой скрипт при этом работает как работал.
  const mine = resolved.scenarios.find((item) => item.id === box.ids.mine);
  assert.equal(mine.source, box.mine);
});
