// Ссылка на библиотечный скрипт в объекте: формат записи, версия файла и
// команды (таск 06 просмотра; требования G24, G24.1, G27).
//
// Проверяется шов «объект ↔ файл»: что лежит в записи сценария, какой версией
// пишется файл, что переводится на ссылку и что — никогда. Главное правило
// здесь одно: **на ссылку переводится только побайтовое совпадение**. Скрипт,
// поправленный своей рукой, остаётся текстом в объекте, и подменять его
// библиотечным нельзя ни при каких обстоятельствах.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  FORMAT_VERSION,
  FORMAT_VERSION_LIB,
  FORMAT_VERSION_MAX,
  FORMAT_VERSION_SCENARIOS,
  addLogicBinding,
  addScenario,
  deleteScenario,
  findScenario,
  migrateScenarioLib,
  projectFormatVersion,
  scenarioLibOf,
  updateScenario,
} from "../src/model.js";
import { PROJECT_ENTRY, packProject, readZip, unpackProject, writeZip } from "../src/projectFile.js";
import {
  SCENARIO_LIB_VERSION,
  scenarioLibFileName,
  scenarioLibHash,
  scenarioLibIndexRead,
  scenarioLibNewer,
  scenarioLibRefOf,
} from "../src/scenarioLib.js";
import { scenariosUpdateLib } from "../src/panels/scenarios.js";
import { simHouse } from "./fixtures/simHome.js";

import { legacyIdsBefore } from "./fixtures/legacyIds.js";
const SPRUT = new URL("./fixtures/sprut/", import.meta.url);
const WEB = new URL("../web/scenarios/", import.meta.url);

function sprutSource(name) {
  return readFileSync(new URL(name, SPRUT), "utf8");
}

/**
 * Поддельная библиотека: реестр и дверь узнавания из готовых исходников.
 * Отпечатки считает та же `scenarioLibHash`, которой считает их сборщик
 * библиотеки, — значит тест не повторяет правило узнавания своими руками.
 */
function library(items) {
  const scripts = items.map((item) => {
    const hash = scenarioLibHash(item.source);
    return {
      name: item.name,
      version: item.version === undefined ? "1.0" : item.version,
      kind: item.kind || "logic",
      hash,
      size: item.source.length,
      file: scenarioLibFileName(item.key, hash),
    };
  });
  const json = { version: SCENARIO_LIB_VERSION, scripts };
  const index = scenarioLibIndexRead(json);
  return { json, index, door: { refOf: (source) => scenarioLibRefOf(source, index) } };
}

function logicProject(sources) {
  const box = simHouse();
  let project = box.project;
  const ids = [];
  for (const item of sources) {
    const added = addScenario(project, { kind: item.kind || "logic", name: item.name, source: item.source });
    project = added.project;
    ids.push(added.scenario.id);
  }
  return { project, ids };
}

async function jsonOf(project) {
  const blob = await packProject(project, new Map());
  return JSON.parse(new TextDecoder().decode((await readZip(blob)).get(PROJECT_ENTRY)));
}

// ——— версия формата ————————————————————————————————————————————————————————

test("версия файла: 7 — ступень ссылки на библиотеку, у пронумерованного по видам объекта — 9", async () => {
  assert.equal(FORMAT_VERSION, 5);
  assert.equal(FORMAT_VERSION_SCENARIOS, 6);
  assert.equal(FORMAT_VERSION_LIB, 7);
  assert.equal(FORMAT_VERSION_MAX, 9);

  const source = sprutSource("HideIfTurnOn.js");
  const lib = library([{ key: "HideIfTurnOn", name: "Скрыть при включении", source }]);
  const made = logicProject([{ name: "Скрыть при включении", source }]);
  // Ступени 6 и 7 считаются по содержимому и отвечают объекту **до**
  // перенумерации: файл прежней сборки читается ими как читался.
  assert.equal(projectFormatVersion(legacyIdsBefore(made.project)), 6, "объект с текстом сценария — версия 6");

  const pinned = migrateScenarioLib(made.project, lib.door);
  assert.equal(pinned.changed, true);
  assert.equal(projectFormatVersion(legacyIdsBefore(pinned.project)), 7, "объект со ссылкой — версия 7");
  // Ссылки больше нет — версия возвращается на 5: её считает содержимое, а не
  // отметка в поле.
  assert.equal(projectFormatVersion(legacyIdsBefore(deleteScenario(pinned.project, made.ids[0]).project)), 5);
  // А объект этой сборки пронумерован по видам, и версия у него одна — девятая
  // (ADR 038).
  assert.equal(projectFormatVersion(pinned.project), 9);

  const written = await jsonOf(pinned.project);
  assert.equal(written.formatVersion, 9, "файл пишется версией 9");
  assert.equal(written.scenarios[0].source, undefined, "текста скрипта в файле больше нет");
  assert.ok(JSON.stringify(written).length < JSON.stringify(await jsonOf(made.project)).length - source.length / 2, "файл стал короче");
});

test("файл версии 9 читается, версии 10 — честный отказ futureVersion", async () => {
  const source = sprutSource("MotionLightAutomation.js");
  const lib = library([{ key: "MotionLightAutomation", name: "Свет по движению", source }]);
  const made = logicProject([{ name: "Свет по движению", source }]);
  const pinned = migrateScenarioLib(made.project, lib.door).project;
  const text = JSON.stringify(await jsonOf(pinned), null, 2);

  const nine = await unpackProject(await writeZip([{ name: PROJECT_ENTRY, data: text }]));
  assert.equal(nine.project.formatVersion, 9);
  assert.deepEqual(scenarioLibOf(nine.project.scenarios[0]), scenarioLibOf(pinned.scenarios[0]));

  const ten = await writeZip([{ name: PROJECT_ENTRY, data: text.replace('"formatVersion": 9', '"formatVersion": 10') }]);
  await assert.rejects(unpackProject(ten), (error) => error.code === "futureVersion" && error.message.includes("10"));
});

// ——— только побайтовое совпадение ———————————————————————————————————————————

test("исходник, отличающийся от библиотечного хоть на байт, на ссылку не переводится", () => {
  // Две версии одного скрипта: библиотечная и поправленная своей рукой (у
  // заказчика такая есть). Отличие — один знак в числе.
  const own = sprutSource("SwitchCallbackControl.Logic.js");
  const mine = own.replace("info", "info ");
  assert.notEqual(mine, own);
  assert.equal(mine.length, own.length + 1);

  const lib = library([{ key: "SwitchCallbackControl.Logic", name: "Выключатель по обратному вызову", source: own }]);
  const made = logicProject([
    { name: "библиотечный", source: own },
    { name: "свой", source: mine },
  ]);
  const pinned = migrateScenarioLib(made.project, lib.door);
  assert.equal(pinned.changed, true);

  const first = findScenario(pinned.project, made.ids[0]);
  const second = findScenario(pinned.project, made.ids[1]);
  assert.equal(scenarioLibOf(first).hash, scenarioLibHash(own));
  assert.equal(first.source, undefined, "у библиотечного текста в объекте не осталось");
  assert.equal(scenarioLibOf(second), null, "свой скрипт ссылкой не стал");
  assert.equal(second.source, mine, "свой скрипт остался текстом байт в байт");
});

test("миграция не копирует прежний `lib` поверх новой ссылки", () => {
  // Запись не из этой сборки: текст есть, а `lib` негодный — отпечатком модель
  // его не принимает. До ремонта ветки (F1) обход ключей ставил новую ссылку на
  // место `source`, а следующий ключ `lib` затирал её прежним значением: объект
  // оставался и без текста, и со ссылкой в никуда.
  const source = sprutSource("HideIfTurnOn.js");
  const lib = library([{ key: "HideIfTurnOn", name: "Скрыть при включении", source }]);
  const made = logicProject([{ name: "Скрыть при включении", source }]);
  const broken = { name: "Скрыть при включении", version: "1.0", hash: "h1" };
  const project = {
    ...made.project,
    scenarios: made.project.scenarios.map((item) => ({ ...item, lib: broken })),
  };
  assert.equal(scenarioLibOf(project.scenarios[0]), null, "негодная ссылка ссылкой не считается");

  const pinned = migrateScenarioLib(project, lib.door);
  assert.equal(pinned.changed, true);
  const now = findScenario(pinned.project, made.ids[0]);
  assert.equal(scenarioLibOf(now).hash, scenarioLibHash(source), "ссылка — та, которую дал реестр");
  assert.equal(now.source, undefined, "текст снят против принятой ссылки");
});

test("без реестра и у блочного сценария миграция отдаёт тот же объект, второй проход — тоже", () => {
  const source = sprutSource("HideIfTurnOn.js");
  const lib = library([{ key: "HideIfTurnOn", name: "Скрыть при включении", source }]);
  const made = logicProject([{ name: "Скрыть при включении", source }]);

  for (const door of [null, undefined, {}, { refOf: "нет" }]) {
    const out = migrateScenarioLib(made.project, door);
    assert.equal(out.changed, false);
    assert.equal(out.project, made.project, "объект тот же по ссылке — открытие ничего не меняет");
  }

  const block = addScenario(made.project, { kind: "block", name: "блочный", targets: [] });
  const pinned = migrateScenarioLib(block.project, lib.door);
  assert.equal(findScenario(pinned.project, block.scenario.id).lib, undefined, "у блочного сценария ссылки не бывает");

  const again = migrateScenarioLib(pinned.project, lib.door);
  assert.equal(again.changed, false);
  assert.equal(again.project, pinned.project, "миграция идемпотентна");
});

test("запись сценария хранит либо текст, либо ссылку: одно снимает другое", () => {
  const source = sprutSource("HideIfTurnOn.js");
  const made = logicProject([{ name: "Скрыть при включении", source }]);
  const id = made.ids[0];
  const lib = { name: "Скрыть при включении", version: "1.0", hash: scenarioLibHash(source) };

  const pinned = updateScenario(made.project, id, { lib }).project;
  assert.deepEqual(scenarioLibOf(findScenario(pinned, id)), lib);
  assert.equal(findScenario(pinned, id).source, undefined, "ссылка снимает текст");

  const typed = updateScenario(pinned, id, { source: "info = {name: 'своё'}" }).project;
  assert.equal(findScenario(typed, id).lib, undefined, "правка текста снимает ссылку — скрипт стал своим");
  assert.equal(findScenario(typed, id).source, "info = {name: 'своё'}");

  // Кривой отпечаток ссылкой не считается: объект не должен стоять на ссылке
  // в никуда и остаться вовсе без текста.
  for (const bad of [{ hash: "нет" }, { hash: scenarioLibHash(source).slice(0, 10) }, { name: "x" }, null, "строка"]) {
    assert.equal(findScenario(updateScenario(pinned, id, { lib: bad }).project, id).lib, undefined, JSON.stringify(bad));
  }
});

// ——— «есть версия новее» (G27) ——————————————————————————————————————————————

test("обновление до новой версии — шаг истории; чужой текст библиотечным не подменяется", () => {
  const own = sprutSource("SwitchCallbackControl.Logic.js");
  const mine = own + "\n// своя правка\n";
  const name = "Выключатель по обратному вызову";
  const lib = library([{ key: "SwitchCallbackControl.Logic", name, source: own, version: "1.0" }]);
  const made = logicProject([
    { name, source: own },
    { name: "свой", source: mine },
  ]);
  const pinned = migrateScenarioLib(made.project, lib.door).project;

  // Реестр обновился: та же вещь, версия новее.
  const next = library([
    { key: "SwitchCallbackControl.Logic", name, source: own, version: "1.0" },
    { key: "SwitchCallbackControl.Logic", name, source: own + "\n// 1.1\n", version: "1.1" },
  ]);
  const newer = scenarioLibNewer(scenarioLibOf(findScenario(pinned, made.ids[0])), next.index);
  assert.equal(newer.version, "1.1");

  // Сам по себе объект на новую версию не переходит: его держит отпечаток.
  const quiet = migrateScenarioLib(pinned, next.door);
  assert.equal(quiet.changed, false);
  assert.equal(scenarioLibOf(findScenario(pinned, made.ids[0])).version, "1.0");

  const step = scenariosUpdateLib(pinned, made.ids[0], newer);
  assert.ok(step && step.label, "шаг истории назван — Ctrl+Z скажет, что отменяет");
  assert.equal(scenarioLibOf(findScenario(step.project, made.ids[0])).version, "1.1");
  assert.equal(scenarioLibOf(findScenario(pinned, made.ids[0])).version, "1.0", "прежний объект цел — отмена вернёт его");
  assert.equal(scenariosUpdateLib(step.project, made.ids[0], newer), null, "та же версия — менять нечего");

  // Сценарий со своим текстом «обновлению» не поддаётся ни под каким видом.
  assert.equal(scenariosUpdateLib(pinned, made.ids[1], newer), null);
  assert.equal(findScenario(pinned, made.ids[1]).source, mine);
});

// ——— файл ——————————————————————————————————————————————————————————————————

test("упаковано = распаковано: ссылка, привязки и свой текст рядом", async () => {
  const own = sprutSource("MotionLightAutomation.js");
  const lib = library([{ key: "MotionLightAutomation", name: "Свет по движению", source: own }]);
  const made = logicProject([
    { name: "Свет по движению", source: own },
    { name: "свой", source: own.replace("const", "const ") },
  ]);
  let project = migrateScenarioLib(made.project, lib.door).project;
  project = addLogicBinding(project, { scenarioId: made.ids[0], markId: project.marks[0].id, service: 0 }).project;

  const blob = await packProject(project, new Map());
  const restored = (await unpackProject(blob)).project;
  assert.deepEqual(restored.scenarios, project.scenarios, "сценарии вернулись поле в поле");
  assert.deepEqual(restored.logicBindings, project.logicBindings);
  assert.equal(restored.formatVersion, 9);
});

test("unpackProject отдаёт writtenAt из writer.json, а битую отметку не выдумывает", async () => {
  const made = logicProject([]);
  const date = new Date("2026-11-07T10:20:30.000Z");
  const withWriter = await packProject(made.project, new Map(), { member: "m-1", date });
  const read = await unpackProject(withWriter);
  assert.equal(read.writtenAt, date.toISOString(), "дата выгрузки — из файла, не из project.updatedAt");
  assert.equal(read.member, "m-1");

  const bare = await unpackProject(await packProject(made.project, new Map()));
  assert.equal(bare.writtenAt, null, "писателя в архиве нет — даты нет");

  const entries = await readZip(withWriter);
  const files = [...entries.entries()].map(([name, data]) => ({ name, data: name === "writer.json" ? '{"member": "m-1", "writtenAt": "вчера"}' : data }));
  const broken = await unpackProject(await writeZip(files));
  assert.equal(broken.writtenAt, null, "непохожее на дату в шапку не едет");
});

// ——— выложенная библиотека —————————————————————————————————————————————————

test("скрипт выложенной библиотеки узнаётся её же реестром", () => {
  const index = scenarioLibIndexRead(readFileSync(new URL("index.json", WEB), "utf8"));
  assert.ok(index.size > 0, "реестр библиотеки собран");
  const entry = [...index.values()][0];
  const source = readFileSync(new URL(entry.file, WEB), "utf8");
  const ref = scenarioLibRefOf(source, index);
  assert.equal(ref.hash, entry.hash, "файл и его отпечаток в реестре сходятся");

  const made = logicProject([{ name: entry.name, source }]);
  const pinned = migrateScenarioLib(made.project, { refOf: (text) => scenarioLibRefOf(text, index) });
  assert.equal(pinned.changed, true);
  assert.equal(scenarioLibOf(pinned.project.scenarios[0]).hash, entry.hash);
});
