// Журнал имитации на экране (таск 08 сценариев; истории 6.1–6.3, 6.5).
//
// Главное, что держит файл: **ни одна строка журнала не показывает сырой
// ключ словаря**. Текст записи собирается по `strings.sim.journal.<код>`, а код
// без строки молча выходил бы наружу как «sim.journal.blockRun» — так же, как
// `text()` отдаёт сам ключ. Поэтому тест перебирает:
//   — все коды, перечисленные в `interfaces.md` («Из таска 04» и следующих);
//   — все коды `block*`/`hub*`, которые встречаются в исходниках движка и
//     хозяев сценариев (новый код без строки — красный тест);
//   — записи, которые настоящий движок и настоящие хозяева выдают на доме-
//     фикстуре.
// Остальное — правила журнала без DOM: цепочка причин словами, фильтры по
// сценарию и устройству, порядок «новые сверху», пустые состояния.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { addScenario } from "../src/model.js";
import { createSimEngine } from "../src/sim/engine.js";
import { blocksOwner } from "../src/sim/blocks.js";
import { buildHomeSpec } from "../src/sim/home.js";
import { strings } from "../src/strings.js";
import {
  SIM_JOURNAL_SHOWN,
  simJournalChain,
  simJournalEmpty,
  simJournalFilters,
  simJournalResult,
  simJournalRows,
  simJournalText,
  simJournalTime,
} from "../src/panels/simJournal.js";
import { simHouse, simRecorder } from "./fixtures/simHome.js";
import { hubHome } from "./fixtures/sprut/hubHome.js";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src");

// Коды журнала из договора модулей — по разделам «Из таска 04…07, 13».
const CONTRACT_CODES = [
  // движок (таск 04)
  "started", "stopped", "reset", "empty", "change", "press", "loop", "eventsCut", "timersCut", "ownerError",
  // блочные сценарии (таск 05)
  "blockRun", "blockCond", "blockIf", "blockIncomplete", "blockDeviceMissing", "blockCodeError", "blockNotify",
  "blockHttp", "blockScenarioMissing", "blockNotActive", "blockActivated", "blockDeactivated", "blockReset", "blockLoop",
  // логические и глобальные сценарии (таск 06)
  "hubTrigger", "hubError", "hubSyntax", "hubLog", "hubNotify", "hubHttp", "hubMail", "hubSsh", "hubNet",
  "hubVisible", "hubGlobalWrite", "hubBindingMissing", "hubLogicManual",
  // страница и поток (таск 07)
  "pageReloaded", "editReset", "noWorker", "scenarioHung", "hungUnknown", "workerError",
  // команды (таск 13)
  "command", "commandUnknown",
];

// Ключи `hub*`, которые не коды журнала, а ошибки чтения файла сценария.
const NOT_JOURNAL = new Set(["hubBlocks", "hubFileUnknown", "hubFileEmpty", "hubCodeError", "hubCodeMissing"]);

function sourceFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (entry.name.endsWith(".js")) out.push(full);
  }
  return out;
}

const journal = strings.sim.journal;

test("в словаре есть строка на каждый код из договора модулей", () => {
  for (const code of CONTRACT_CODES) assert.equal(typeof journal[code], "string", "нет строки журнала: " + code);
});

test("в словаре нет мёртвых строк: каждая нужна коду из договора", () => {
  const known = new Set(CONTRACT_CODES);
  for (const code of Object.keys(journal)) assert.ok(known.has(code), "лишняя строка журнала: " + code);
});

test("коды block* и hub*, найденные в исходниках, все имеют строку (или это не журнал)", () => {
  const found = new Set();
  for (const file of sourceFiles(join(SRC, "sim"))) {
    for (const match of readFileSync(file, "utf8").matchAll(/"((?:block|hub)[A-Z][A-Za-z]*)"/g)) found.add(match[1]);
  }
  assert.ok(found.size >= 20, "сканер ничего не нашёл — тест пуст");
  for (const code of found) {
    if (NOT_JOURNAL.has(code)) continue;
    assert.equal(typeof journal[code], "string", "код встречается в исходниках, а строки нет: " + code);
  }
});

test("каждая строка собирается без сырого ключа и без остатка подстановок", () => {
  for (const code of CONTRACT_CODES) {
    // Подстановки берутся из самого шаблона: что он просит, то и подано.
    const vars = {};
    for (const [, name] of journal[code].matchAll(/\{(\w+)\}/g)) vars[name] = "X";
    const shown = simJournalText({ kind: "system", code, vars, chain: [], text: "sim.journal." + code });
    assert.ok(shown.length > 0, code);
    assert.ok(!shown.includes("sim.journal"), "сырой ключ в строке " + code + ": " + shown);
    assert.ok(!/[{}]/.test(shown), "остались фигурные скобки в " + code + ": " + shown);
  }
});

test("запись без подстановок не показывает ни ключ, ни фигурные скобки", () => {
  for (const code of CONTRACT_CODES) {
    const shown = simJournalText({ kind: "system", code, chain: [], text: "sim.journal." + code });
    assert.ok(!shown.includes("sim.journal"), code);
    assert.ok(!/[{}]/.test(shown), code + ": " + shown);
  }
});

test("код, которого нет в словаре, — «Событие имитации», а не ключ", () => {
  assert.equal(simJournalText({ kind: "system", code: "noSuchCode", text: "sim.journal.noSuchCode", chain: [] }), strings.sim.log.unknown);
  assert.equal(simJournalText({ kind: "system", chain: [] }), strings.sim.log.unknown);
});

test("результат условия подставляется словами: истинно, ложно, пропущено", () => {
  const base = { kind: "cond", code: "blockCond", vars: { name: "Свет" }, chain: [] };
  assert.equal(simJournalText({ ...base, result: true }), "«Свет»: условие — истинно");
  assert.equal(simJournalText({ ...base, result: false }), "«Свет»: условие — ложно");
  assert.equal(simJournalText({ ...base, code: "blockIf", result: null }), "«Свет»: «Если» — пропущено");
  assert.equal(simJournalResult(true), "истинно");
});

test("пустой дом: строка «В объекте нет устройств…» читается как есть", () => {
  assert.equal(
    simJournalText({ kind: "system", code: "empty", chain: [], text: "" }),
    "В объекте нет устройств — поставьте метки или задайте профиль типу",
  );
});

test("логические значения подстановок — словами, а не true/false", () => {
  const shown = simJournalText({ kind: "system", code: "hubVisible", vars: { label: "С1", service: "Лампочка", visible: false }, chain: [] });
  assert.equal(shown, "С1: видимость сервиса «Лампочка» — скрыт");
});

// ——— записи настоящих хозяев ————————————————————————————————————————

function everyText(entries, project) {
  assert.ok(entries.length > 0, "записей нет — проверять нечего");
  for (const entry of entries) {
    const shown = simJournalText(entry, project);
    assert.ok(shown.length > 0, JSON.stringify(entry.code));
    assert.ok(!shown.includes("sim.journal."), "сырой ключ: " + shown);
    assert.ok(!/\{\w+\}/.test(shown), "остались подстановки: " + shown);
  }
}

test("настоящий движок и блочные сценарии: все выданные строки читаются без ключей", () => {
  const box = simHouse();
  const id = (label) => box.marks[label];
  const ref = (label, char) => ({ markId: id(label), service: 0, char });
  box.project = addScenario(box.project, {
    kind: "block",
    name: "Проверка",
    active: true,
    targets: [
      {
        type: "if",
        id: "if1",
        if: { type: "group", id: "g1", mode: "OR", conditions: [{ type: "device", id: "c1", ref: ref("ДД1", "MotionDetected"), op: "eq", value: true, trigger: true }] },
        then: [
          { type: "device", id: "a1", ref: { markId: id("С1"), service: 0 }, items: [{ char: "On", verb: "set", value: true }] },
          { type: "notify", id: "n1", text: "Привет" },
          { type: "http", id: "h1", method: "GET", url: "http://example.test" },
          { type: "scenario", id: "s1", verb: "run", scenarioId: "нет-такого" },
          { type: "device", id: "a2", ref: { markId: id("С2"), service: 0 }, items: [] },
        ],
        else: null,
        every: null,
      },
    ],
  }).project;
  box.project = addScenario(box.project, { kind: "block", name: "Спящий", active: false, targets: [] }).project;
  const recorder = simRecorder();
  const engine = createSimEngine({ emit: recorder.emit, owners: [blocksOwner()] });
  engine.load(buildHomeSpec(box.project));
  engine.setClock({ simMs: Date.UTC(2026, 9, 23, 12) });
  engine.start();
  engine.act({ kind: "sensor", markId: id("ДД1") });
  engine.act({ kind: "press", markId: id("В2"), service: 0, press: "double" });
  engine.act({ kind: "command", text: "никто не слушает", cause: "web" });
  const sleeper = box.project.scenarios.find((scenario) => scenario.name === "Спящий");
  engine.runScenario(sleeper.id);
  engine.stop();
  const entries = recorder.log();
  const codes = new Set(entries.map((entry) => entry.code));
  for (const code of ["started", "change", "press", "blockRun", "blockCond", "blockIf", "blockNotify", "blockHttp", "blockScenarioMissing", "blockIncomplete", "commandUnknown", "blockNotActive", "stopped"]) {
    assert.ok(codes.has(code), "в прогоне не вышел код " + code);
  }
  everyText(entries, box.project);
});

test("логические сценарии на хозяине скриптов: записи читаются без ключей", () => {
  const home = hubHome({
    scripts: [
      {
        key: "t",
        name: "Лог",
        source: [
          "info = { name: 'Лог', sourceServices: [HS.Lightbulb], sourceCharacteristics: [HC.On] };",
          "function trigger(source, value, variables, options, context) {",
          "  console.info('получили {}', value);",
          "  Notify.text('Привет').send();",
          "  throw new Error('boom');",
          "}",
        ].join("\n"),
      },
    ],
    bindings: [{ script: "t", mark: "С1" }],
  });
  home.set("С1", "On", true);
  const entries = home.recorder.log();
  const codes = new Set(entries.map((entry) => entry.code));
  for (const code of ["hubTrigger", "hubLog", "hubNotify", "hubError"]) assert.ok(codes.has(code), "в прогоне не вышел код " + code);
  everyText(entries, home.box.project);
});

// ——— изменение устройства: слова вместо сырых значений ———————————————————

test("изменение читается словами: метка из объекта, «нет → да», подпись константы", () => {
  const box = simHouse();
  const light = box.marks["С1"];
  const raw = { kind: "change", code: "change", markId: light, service: 0, char: "On", from: false, to: true, chain: [], text: "С1: Включено — false → true" };
  assert.equal(simJournalText(raw, box.project), "С1: Включено — нет → да");
  const press = { kind: "press", code: "press", markId: box.marks["В2"], service: 0, char: "ProgrammableSwitchEvent", from: null, to: "DOUBLE_PRESS", chain: [], text: "" };
  assert.equal(simJournalText(press, box.project), "В2: Нажатие — Двойное");
});

// ——— цепочка причин ———————————————————————————————————————————————————

test("цепочка причин: от ближайшей к исходной, словами и стрелкой «←»", () => {
  const box = simHouse();
  const sensor = box.marks["ДД1"];
  const scenario = addScenario(box.project, { kind: "block", name: "Свет в коридоре", active: true, targets: [] });
  const project = scenario.project;
  const entry = {
    chain: [
      { k: "scenario", scenarioId: scenario.scenario.id, blockId: "b" },
      { k: "char", markId: sensor, service: 0, char: "MotionDetected", value: true },
      { k: "web", at: 0 },
    ],
  };
  assert.equal(simJournalChain(project, entry), "сценарий «Свет в коридоре» ← ДД1 Движение → да ← щелчок");
  assert.equal(simJournalChain(project, { chain: [{ k: "timer", at: 0, what: "delay" }, { k: "command", text: "Ёлочка гори" }, { k: "walk" }] }), "таймер (задержка) ← команда «Ёлочка гори» ← ходьба");
  assert.equal(simJournalChain(project, { chain: [] }), "");
  assert.equal(simJournalChain(project, {}), "");
});

// ——— строки, фильтры, пустые состояния ——————————————————————————————

test("время строки — время имитации, местное: «12:05:09» без пояса", () => {
  assert.equal(simJournalTime(Date.UTC(2026, 9, 23, 12, 5, 9)), "12:05:09");
});

function lines() {
  const box = simHouse();
  const first = addScenario(box.project, { kind: "block", name: "Первый", active: true, targets: [] });
  const second = addScenario(first.project, { kind: "block", name: "Второй", active: true, targets: [] });
  const project = second.project;
  const entries = [
    { at: 1000, kind: "system", code: "started", chain: [] },
    { at: 2000, kind: "change", code: "change", markId: box.marks["С1"], char: "On", from: false, to: true, chain: [{ k: "scenario", scenarioId: first.scenario.id }] },
    { at: 3000, kind: "run", code: "blockRun", scenarioId: second.scenario.id, vars: { name: "Второй" }, chain: [] },
    { at: 4000, kind: "change", code: "change", markId: box.marks["С2"], char: "On", from: false, to: true, chain: [{ k: "scenario", scenarioId: second.scenario.id }] },
  ];
  return { box, project, entries, first: first.scenario, second: second.scenario };
}

test("строки — новые сверху, не больше предела; у каждой своё время и текст", () => {
  const { project, entries } = lines();
  const rows = simJournalRows(entries, project);
  assert.deepEqual(rows.map((row) => row.at), [4000, 3000, 2000, 1000]);
  assert.equal(rows[3].text, "Дом запущен");
  assert.deepEqual(simJournalRows(entries, project, {}, 2).map((row) => row.at), [4000, 3000]);
  assert.equal(SIM_JOURNAL_SHOWN, 300);
});

test("фильтр по сценарию: запись проходит, если сценарий назван в ней самой или в её цепочке", () => {
  const { project, entries, second } = lines();
  const rows = simJournalRows(entries, project, { scenarioId: second.id });
  assert.deepEqual(rows.map((row) => row.at), [4000, 3000]);
});

test("фильтр по устройству: запись об устройстве и записи, где оно в цепочке причин", () => {
  const { box, project, entries } = lines();
  assert.deepEqual(simJournalRows(entries, project, { markId: box.marks["С1"] }).map((row) => row.at), [2000]);
});

test("щёлкнуть можно по строке с устройством: метка берётся из записи или из цепочки", () => {
  const { box, project } = lines();
  const own = simJournalRows([{ at: 1, kind: "change", markId: box.marks["С1"], chain: [] }], project)[0];
  assert.equal(own.markId, box.marks["С1"]);
  const viaChain = simJournalRows([{ at: 1, kind: "cond", chain: [{ k: "char", markId: box.marks["ДД1"], char: "MotionDetected", value: true }] }], project)[0];
  assert.equal(viaChain.markId, box.marks["ДД1"]);
  const none = simJournalRows([{ at: 1, kind: "system", code: "started", chain: [] }], project)[0];
  assert.equal(none.markId, null);
});

test("варианты фильтров — только то, что есть в ленте, сценарии в порядке объекта", () => {
  const { box, project, entries, first, second } = lines();
  const variants = simJournalFilters(entries, project);
  assert.deepEqual(variants.scenarios.map((item) => item.id), [first.id, second.id]);
  assert.deepEqual(variants.marks.map((item) => item.label), ["С1", "С2"]);
  assert.deepEqual(simJournalFilters([], project), { scenarios: [], marks: [] });
  assert.ok(box);
});

test("пустые состояния: «ещё не запускали», «событий пока нет», «по фильтру нет»", () => {
  assert.equal(simJournalEmpty(0, 0, false), "Дом ещё не запускали");
  assert.equal(simJournalEmpty(0, 0, true), "Событий пока нет");
  assert.equal(simJournalEmpty(5, 0, true), "По фильтру записей нет");
  assert.equal(simJournalEmpty(5, 3, true), null);
});
