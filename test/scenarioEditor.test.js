// Редактор блоков «Если — Тогда — Иначе» (таск 11 сценариев): чистая половина.
// Экран проверяется живым прогоном; здесь — выбор характеристик, виды значений,
// операторы по формату, ∞ и «⏱», действия и их глаголы, планировщик, восход,
// перетаскивание, проблемы словами и запись шагом истории. Собранные редактором
// сценарии исполняются движком — тем же путём, что и в странице.
import test from "node:test";
import assert from "node:assert/strict";

import {
  scenarioEditorBlockClass,
  scenarioEditorCharChoices,
  scenarioEditorCommit,
  scenarioEditorConditionFix,
  scenarioEditorConditionRef,
  scenarioEditorDropIndex,
  scenarioEditorDuration,
  scenarioEditorHoldAllowed,
  scenarioEditorItemChar,
  scenarioEditorItemFix,
  scenarioEditorNeed,
  scenarioEditorOpLabel,
  scenarioEditorParseNumber,
  scenarioEditorProblems,
  scenarioEditorSchedulePatch,
  scenarioEditorSeconds,
  scenarioEditorSunText,
  scenarioEditorValueSpec,
  scenarioEditorVerbs,
} from "../src/panels/scenarioEditor.js";
import { addScenario, findScenario, projectFormatVersion, setProjectSite } from "../src/model.js";
import { createSimEngine } from "../src/sim/engine.js";
import { blocksOwner } from "../src/sim/blocks.js";
import { simCharMeta } from "../src/sim/catalog.js";
import { buildHomeSpec, homeAccessories } from "../src/sim/home.js";
import { scenarioAddBlock, scenarioBlank, scenarioFind, scenarioPatch } from "../src/scenarioTree.js";
import { strings } from "../src/strings.js";
import { readFileSync } from "node:fs";
import { scenarioMenu } from "../src/scenarioTree.js";
import { simHouse, simRecorder } from "./fixtures/simHome.js";

const house = simHouse();
const { project, marks } = house;
const accessories = homeAccessories(project);
const accessoryOf = (label) => accessories.find((item) => item.markId === marks[label]);

// ——— характеристики устройства ————————————————————————————————————————

test("выбор характеристики: сервис и характеристика одним списком, служебные не теряются", () => {
  const light = scenarioEditorCharChoices(accessoryOf("С1"));
  assert.deepEqual(
    light.map((item) => [item.service, item.char]),
    [
      [0, "On"],
      [0, "Brightness"],
    ],
  );
  assert.equal(light[0].label, `${strings.sim.services.Lightbulb} · ${strings.sim.chars.On}`);
  assert.equal(light[0].key, "0:On");
  assert.ok(light[0].meta && light[0].meta.format === "bool");
  assert.deepEqual(scenarioEditorCharChoices(null), []);
});

test("для действия — все характеристики, у «только чтение» пометка, записываемые первыми (правка 2026-10-27)", () => {
  // «Позволь блочными сценариями управлять характеристиками только для чтения
  // у устройств, просто делай пометку что они только для чтения, но менять
  // можно». Было: у датчика список действия пустой.
  const sensor = scenarioEditorCharChoices(accessoryOf("ДД1"), { write: true });
  assert.deepEqual(
    sensor.map((item) => [item.char, item.readOnly]),
    [["MotionDetected", true]],
  );
  assert.match(sensor[0].label, /только чтение/);
  const read = scenarioEditorCharChoices(accessoryOf("ДД1"));
  assert.deepEqual(
    read.map((item) => item.char),
    ["MotionDetected"],
  );
  assert.doesNotMatch(read[0].label, /только чтение/, "в условии пометка не нужна: читать можно всё");
  const lamp = scenarioEditorCharChoices(accessoryOf("С1"), { write: true });
  assert.deepEqual(lamp.map((item) => item.readOnly), [false, false]);
  // У выключателя «Выключатель» записывается, номер клавиши — нет: он в конце.
  const duo = scenarioEditorCharChoices(accessoryOf("ВВ1"), { write: true });
  const firstRead = duo.findIndex((item) => item.readOnly);
  assert.ok(firstRead > 0 && duo.slice(firstRead).every((item) => item.readOnly), "записываемые не первыми");
});

test("клавиши выключателя различаются номером: «Кнопка 1», «Кнопка 2»", () => {
  const duo = scenarioEditorCharChoices(accessoryOf("ВВ1"));
  const labels = duo.filter((item) => item.char === "ProgrammableSwitchEvent").map((item) => item.label);
  assert.equal(labels.length, 2);
  assert.notEqual(labels[0], labels[1]);
  assert.match(labels[0], /1/);
  assert.match(labels[1], /2/);
});

// ——— значение ————————————————————————————————————————————————————————

test("вид значения: да/нет, подписи, число с единицей и подсказкой диапазона", () => {
  const bool = scenarioEditorValueSpec(simCharMeta("On"), "On");
  assert.equal(bool.kind, "options");
  assert.deepEqual(
    bool.options.map((item) => [item.value, item.label]),
    [
      [true, strings.scenarios.phrase.yes],
      [false, strings.scenarios.phrase.no],
    ],
  );
  const press = scenarioEditorValueSpec(simCharMeta("ProgrammableSwitchEvent"), "ProgrammableSwitchEvent");
  assert.deepEqual(
    press.options.map((item) => item.label),
    ["Одиночное", "Двойное", "Долгое"],
  );
  assert.deepEqual(
    press.options.map((item) => item.value),
    ["SINGLE_PRESS", "DOUBLE_PRESS", "LONG_PRESS"],
  );
  const level = scenarioEditorValueSpec(simCharMeta("Brightness"), "Brightness");
  assert.equal(level.kind, "number");
  assert.equal(level.unit, "%");
  assert.equal(level.min, 0);
  assert.equal(level.max, 100);
  assert.match(level.hint, /0/);
  assert.match(level.hint, /100/);
  const temp = scenarioEditorValueSpec(simCharMeta("CurrentTemperature"), "CurrentTemperature");
  assert.equal(temp.unit, "°C");
  assert.equal(scenarioEditorValueSpec(null, "On").kind, "none");
});

test("разбор числа в поле: запятая, пробелы; не число — null", () => {
  assert.equal(scenarioEditorParseNumber("22,5"), 22.5);
  assert.equal(scenarioEditorParseNumber(" 30 "), 30);
  assert.equal(scenarioEditorParseNumber("-4"), -4);
  assert.equal(scenarioEditorParseNumber(""), null);
  assert.equal(scenarioEditorParseNumber("abc"), null);
  assert.equal(scenarioEditorParseNumber("1e999"), null);
});

// ——— условие по устройству ——————————————————————————————————————————

const lightRef = (char) => ({ markId: marks.С1, service: 0, char });
const motionRef = { markId: marks.ДД1, service: 0, char: "MotionDetected" };

test("оператор по формату: у логики и перечисления три, у числа семь", () => {
  const onCond = { type: "device", id: "c", ref: lightRef("On"), op: "gt", value: true, trigger: true };
  const fixed = scenarioEditorConditionFix(onCond, simCharMeta("On"));
  assert.equal(fixed.op, "eq", "«>» у логики недопустимо — становится «=»");
  const level = { type: "device", id: "c", ref: lightRef("Brightness"), op: "gt", value: 30, trigger: true };
  assert.equal(scenarioEditorConditionFix(level, simCharMeta("Brightness")).op, "gt");
});

test("смена характеристики сбрасывает значение, оператор и лишние отметки", () => {
  const was = { type: "device", id: "c", ref: lightRef("Brightness"), op: "gt", value: 50, trigger: true, repeat: false, hold: { mode: "more", sec: 60 } };
  const next = scenarioEditorConditionRef(was, motionRef, simCharMeta("MotionDetected"));
  assert.deepEqual(next.ref, motionRef);
  assert.equal(next.op, "eq");
  assert.equal(next.value, true, "для да/нет значение сразу выбрано");
  assert.equal("repeat" in next, false, "∞ только у числовых сравнений");
  assert.equal(next.trigger, true, "триггер остаётся");
  const press = scenarioEditorConditionRef(was, { markId: marks.В2, service: 0, char: "ProgrammableSwitchEvent" }, simCharMeta("ProgrammableSwitchEvent"));
  assert.equal(press.value, "SINGLE_PRESS");
  const number = scenarioEditorConditionRef({ ...was, ref: motionRef, op: "eq", value: true }, lightRef("Brightness"), simCharMeta("Brightness"));
  assert.equal("value" in number, false, "число вводят сами — до этого блок неполный");
});

test("та же характеристика: правка не трогает значение", () => {
  const was = { type: "device", id: "c", ref: lightRef("Brightness"), op: "ge", value: 50, trigger: true, repeat: false };
  const next = scenarioEditorConditionRef(was, { ...lightRef("Brightness") }, simCharMeta("Brightness"));
  assert.equal(next.value, 50);
  assert.equal(next.repeat, false);
});

test("«Изменено» без значения; вернули «=» — значение снова выбрано", () => {
  const cond = { type: "device", id: "c", ref: motionRef, op: "eq", value: true, trigger: true };
  const changed = scenarioEditorConditionFix({ ...cond, op: "changed" }, simCharMeta("MotionDetected"));
  assert.equal("value" in changed, false);
  const back = scenarioEditorConditionFix({ ...changed, op: "eq" }, simCharMeta("MotionDetected"));
  assert.equal(back.value, true);
});

test("∞ остаётся у числового сравнения и уходит при «Изменено»", () => {
  const meta = simCharMeta("CurrentTemperature");
  const cond = { type: "device", id: "c", ref: { markId: marks.ДТВ1, service: 0, char: "CurrentTemperature" }, op: "gt", value: 25, trigger: true, repeat: false };
  assert.equal(scenarioEditorConditionFix(cond, meta).repeat, false);
  assert.equal("repeat" in scenarioEditorConditionFix({ ...cond, op: "changed" }, meta), false);
});

test("«⏱ Более/Менее» не для «Изменено» и не для нажатий", () => {
  const cond = { type: "device", id: "c", ref: motionRef, op: "eq", value: true, trigger: true, hold: { mode: "more", sec: 90 } };
  assert.equal(scenarioEditorHoldAllowed(cond, simCharMeta("MotionDetected")), true);
  assert.equal(scenarioEditorHoldAllowed({ ...cond, op: "changed" }, simCharMeta("MotionDetected")), false);
  assert.equal(scenarioEditorHoldAllowed(cond, simCharMeta("ProgrammableSwitchEvent")), false);
  assert.equal("hold" in scenarioEditorConditionFix({ ...cond, op: "changed" }, simCharMeta("MotionDetected")), false);
  assert.deepEqual(scenarioEditorConditionFix(cond, simCharMeta("MotionDetected")).hold, { mode: "more", sec: 90 });
});

test("подписи операторов как в Sprut", () => {
  assert.equal(scenarioEditorOpLabel("changed"), strings.scenarios.editor.opChanged);
  assert.deepEqual(["eq", "ne", "gt", "ge", "lt", "le"].map(scenarioEditorOpLabel), ["=", "≠", ">", "≥", "<", "≤"]);
});

test("часы-минуты-секунды в длительность и обратно", () => {
  assert.deepEqual(scenarioEditorDuration(3725), { h: 1, m: 2, s: 5 });
  assert.deepEqual(scenarioEditorDuration(0), { h: 0, m: 0, s: 0 });
  assert.equal(scenarioEditorSeconds(1, 2, 5), 3725);
  assert.equal(scenarioEditorSeconds(0, 15, 8), 908);
  assert.equal(scenarioEditorSeconds(-1, 0, "x"), 0);
});

// ——— действие над устройством ———————————————————————————————————————

test("глаголы действия по формату: установить всегда, инвертировать и увеличить — где есть смысл", () => {
  assert.deepEqual(scenarioEditorVerbs(simCharMeta("On")), ["set", "invert", "setFrom"]);
  assert.deepEqual(scenarioEditorVerbs(simCharMeta("Brightness")), ["set", "invert", "increase", "setFrom"]);
  assert.deepEqual(scenarioEditorVerbs(simCharMeta("ContactSensorState")), ["set", "invert", "setFrom"]);
  assert.deepEqual(scenarioEditorVerbs(simCharMeta("TargetHeaterCoolerState")), ["set", "setFrom"], "три значения — не переключатель");
  assert.deepEqual(scenarioEditorVerbs(simCharMeta("ProgrammableSwitchEvent")), ["set"], "нажатие — только событие");
});

test("позиция действия: смена глагола чистит лишнее, значение подбирается", () => {
  const set = { char: "Brightness", verb: "set", value: 40 };
  assert.deepEqual(scenarioEditorItemFix({ ...set, verb: "invert" }, simCharMeta("Brightness")), { char: "Brightness", verb: "invert" });
  assert.deepEqual(scenarioEditorItemFix({ ...set, verb: "increase" }, simCharMeta("Brightness")), { char: "Brightness", verb: "increase" });
  assert.deepEqual(scenarioEditorItemFix({ ...set, verb: "increase", step: -5 }, simCharMeta("Brightness")), { char: "Brightness", verb: "increase", step: -5 });
  assert.equal(scenarioEditorItemFix({ char: "On", verb: "set" }, simCharMeta("On")).value, true);
  assert.equal(scenarioEditorItemFix({ char: "On", verb: "increase" }, simCharMeta("On")).verb, "set", "«Увеличить» у да/нет недопустимо");
  const from = scenarioEditorItemFix({ ...set, verb: "setFrom" }, simCharMeta("Brightness"));
  assert.deepEqual(from, { char: "Brightness", verb: "setFrom", from: {} });
});

test("другая характеристика в позиции: глагол «Установить» и значение по новому формату", () => {
  const was = { char: "Brightness", verb: "increase", step: 5 };
  const next = scenarioEditorItemChar(was, "On", simCharMeta("On"));
  assert.deepEqual(next, { char: "On", verb: "set", value: true });
  const same = scenarioEditorItemChar(was, "Brightness", simCharMeta("Brightness"));
  assert.deepEqual(same, was);
});

// ——— планировщик ————————————————————————————————————————————————————

test("планировщик: режимы меняют набор полей, дни остаются", () => {
  const time = { type: "schedule", id: "s", mode: "time", days: [1, 2, 3], at: "07:30" };
  const every = scenarioEditorSchedulePatch(time, { mode: "every" });
  assert.equal(every.mode, "every");
  assert.equal(every.everySec, 600);
  assert.equal("at" in every, false);
  assert.deepEqual(every.days, [1, 2, 3]);
  const sun = scenarioEditorSchedulePatch(every, { mode: "sunset" });
  assert.equal(sun.offsetSec, 0);
  assert.equal("everySec" in sun, false);
  const back = scenarioEditorSchedulePatch(sun, { mode: "time" });
  assert.equal(back.at, "07:00");
  const days = scenarioEditorSchedulePatch(time, { days: [6, 7] });
  assert.deepEqual(days.days, [6, 7]);
  assert.equal(days.at, "07:30");
});

test("восход и закат на сегодня: время видно; без координат — 9:00 и 21:00 и подсказка", () => {
  const noon = Date.UTC(2026, 9, 23, 12, 0, 0);
  const plain = scenarioEditorSunText(project, noon, { mode: "sunrise", offsetSec: 0 });
  assert.match(plain.text, /09:00/);
  assert.equal(plain.site, false);
  assert.equal(plain.note, strings.scenarios.editor.sunNoSite);
  const set = scenarioEditorSunText(project, noon, { mode: "sunset", offsetSec: -1800 });
  assert.match(set.text, /21:00/);
  assert.match(set.text, /20:30/, "со смещением видно время срабатывания");
  const located = setProjectSite(project, { coords: "51.67, 39.18" }).project;
  const withSite = scenarioEditorSunText(located, noon, { mode: "sunrise", offsetSec: 0 });
  assert.equal(typeof withSite.text, "string");
  assert.ok(withSite.text.length > 0);
});

// ——— перетаскивание ————————————————————————————————————————————————

test("перетаскивание: место вставки считается в списке уже без самого блока", () => {
  assert.equal(scenarioEditorDropIndex(["a", "b", "c"], "a", 2), 1);
  assert.equal(scenarioEditorDropIndex(["a", "b", "c"], "c", 0), 0);
  assert.equal(scenarioEditorDropIndex(["a", "b", "c"], "b", 3), 2);
  assert.equal(scenarioEditorDropIndex(["a", "b"], "x", 1), 1, "чужой блок — как есть");
});

test("условие и действие различаются: в «Если» не положить «Тогда», и наоборот", () => {
  assert.equal(scenarioEditorBlockClass({ type: "device", ref: {}, op: "eq" }), "condition");
  assert.equal(scenarioEditorBlockClass({ type: "device", ref: {}, items: [] }), "action");
  assert.equal(scenarioEditorBlockClass({ type: "group" }), "condition");
  assert.equal(scenarioEditorBlockClass({ type: "code", code: "" }), "action");
  assert.equal(scenarioEditorBlockClass({ type: "if" }), "action");
  assert.equal(scenarioEditorBlockClass({ type: "schedule" }), "condition");
  assert.equal(scenarioEditorBlockClass({ type: "command" }), "condition");
  assert.equal(scenarioEditorBlockClass({ type: "delay" }), "action");
});

// ——— проблемы словами ————————————————————————————————————————————————

const withBlocks = (targets) => ({ ...scenarioBlank("block"), id: "s1", targets });

test("неполный блок: что именно не заполнено", () => {
  assert.equal(scenarioEditorNeed({ type: "device", ref: {}, op: "eq", trigger: false }), strings.scenarios.editor.need.device);
  assert.equal(scenarioEditorNeed({ type: "device", ref: { markId: marks.С1, service: 0 }, op: "eq", trigger: false }), strings.scenarios.editor.need.char);
  assert.equal(scenarioEditorNeed({ type: "device", ref: motionRef, op: "eq", trigger: false }), strings.scenarios.editor.need.value);
  assert.equal(scenarioEditorNeed({ type: "device", ref: motionRef, op: "changed", trigger: false }), "");
  assert.equal(scenarioEditorNeed({ type: "device", ref: { markId: marks.С1, service: 0 }, items: [] }), strings.scenarios.editor.need.item);
  assert.equal(scenarioEditorNeed({ type: "device", ref: {}, items: [] }), strings.scenarios.editor.need.device);
  assert.equal(scenarioEditorNeed({ type: "command", text: "  " }), strings.scenarios.editor.need.text);
  assert.equal(scenarioEditorNeed({ type: "code", code: "" }), strings.scenarios.editor.need.code);
  assert.equal(scenarioEditorNeed({ type: "scenario", verb: "run", scenarioId: "" }), strings.scenarios.editor.need.scenario);
  assert.equal(scenarioEditorNeed({ type: "http", method: "GET", url: "" }), strings.scenarios.editor.need.url);
  assert.equal(scenarioEditorNeed({ type: "notify", text: "" }), "");
});

test("проблемы по блокам: красная рамка, удалённое устройство, петля", () => {
  const motion = { type: "device", id: "c1", ref: motionRef, op: "eq", value: true, trigger: true };
  const half = { type: "device", id: "c2", ref: {}, op: "eq", trigger: false };
  const gone = { type: "device", id: "a1", ref: { markId: "no-such-mark", service: 0 }, items: [{ char: "On", verb: "set", value: true }] };
  const loop = { type: "device", id: "a2", ref: { markId: marks.ДД1, service: 0 }, items: [{ char: "MotionDetected", verb: "set", value: true }] };
  const scenario = withBlocks([
    { type: "if", id: "i1", if: { type: "group", id: "g1", mode: "OR", conditions: [motion, half] }, then: [gone, loop], else: null, every: null },
  ]);
  const found = scenarioEditorProblems(project, scenario);
  assert.deepEqual(found.get("c2"), ["incomplete"]);
  assert.deepEqual(found.get("a1"), ["deviceMissing"]);
  assert.deepEqual(found.get("a2"), ["loop"]);
  assert.equal(found.has("c1"), false);
  assert.equal(found.noTrigger, false);
  const none = scenarioEditorProblems(project, withBlocks([{ type: "if", id: "i1", if: { type: "group", id: "g1", mode: "OR", conditions: [{ ...motion, trigger: false }] }, then: [], else: null, every: null }]));
  assert.equal(none.noTrigger, true);
  assert.equal(scenarioEditorProblems(project, null).size, 0);
});

// ——— запись шагом истории ————————————————————————————————————————————

test("правка уходит в объект одним шагом со своим ярлыком; без изменений — ничего", () => {
  const base = addScenario(project, { ...scenarioBlank("block"), name: "Свет", targets: [] });
  const scenario = base.scenario;
  const next = scenarioAddBlock(scenario, null, "root", "notify").scenario;
  const result = scenarioEditorCommit(base.project, scenario, next, strings.history.editScenario);
  assert.equal(result.label, strings.history.editScenario);
  assert.equal(findScenario(result.project, scenario.id).targets.length, 1);
  assert.equal(findScenario(base.project, scenario.id).targets.length, 0, "прежний объект не тронут");
  assert.equal(scenarioEditorCommit(base.project, scenario, scenario, "x"), null);
  assert.equal(scenarioEditorCommit(base.project, { ...scenario, id: "нет-такого" }, next, "x"), null);
});

// ——— сборка редактором и исполнение (критерий приёмки 1) ———————————————

const T0 = Date.UTC(2026, 9, 23, 12, 0, 0);

function runnable(box, scenario) {
  const made = addScenario(box.project, scenario);
  const recorder = simRecorder();
  const engine = createSimEngine({ emit: recorder.emit, owners: [blocksOwner()] });
  engine.load(buildHomeSpec(made.project));
  engine.setClock({ simMs: T0 });
  engine.start();
  return { engine, recorder, project: made.project };
}

// Сценарий 2.4 собирается теми же шагами, что делает человек в редакторе:
// «+ → блок условий», «+ → сервис» в «Если» и в «Тогда», «+ → задержка».
function buildMotionLight(box) {
  const { project: p, marks: m } = box;
  const metaOf = (markId, service, char) => {
    const accessory = homeAccessories(p).find((item) => item.markId === markId);
    return accessory.services[service].chars.find((item) => item.type === char).meta;
  };
  let scenario = { ...scenarioBlank("block"), name: "Свет по движению" };
  let made = scenarioAddBlock(scenario, null, "root", "if");
  scenario = made.scenario;
  const top = made.block;
  made = scenarioAddBlock(scenario, top.if.id, "conditions", "device");
  scenario = made.scenario;
  const motion = scenarioEditorConditionRef(made.block, { markId: m.ДД1, service: 0, char: "MotionDetected" }, metaOf(m.ДД1, 0, "MotionDetected"));
  scenario = scenarioPatch(scenario, made.block.id, motion);
  made = scenarioAddBlock(scenario, top.id, "then", "device");
  scenario = made.scenario;
  scenario = scenarioPatch(scenario, made.block.id, {
    ref: { markId: m.С1, service: 0 },
    items: [scenarioEditorItemChar({ char: "", verb: "set" }, "On", metaOf(m.С1, 0, "On"))],
  });
  made = scenarioAddBlock(scenario, top.id, "then", "delay");
  scenario = made.scenario;
  const delay = made.block;
  scenario = scenarioPatch(scenario, delay.id, { sec: 60, timer: "one" });
  made = scenarioAddBlock(scenario, delay.id, "blocks", "device");
  scenario = scenarioPatch(made.scenario, made.block.id, {
    ref: { markId: m.С1, service: 0 },
    items: [{ char: "On", verb: "set", value: false }],
  });
  return scenario;
}

test("сценарий 2.4, собранный шагами редактора, исполняется: движение включает свет, через минуту гасит", () => {
  const box = simHouse();
  const scenario = buildMotionLight(box);
  assert.deepEqual([...scenarioEditorProblems(box.project, scenario)], [], "собранный сценарий без проблем");
  const run = runnable(box, scenario);
  const lamp = () => run.engine.value(box.marks.С1, 0, "On");
  assert.equal(lamp(), false);
  run.engine.act({ kind: "sensor", markId: box.marks.ДД1 });
  assert.equal(lamp(), true);
  run.engine.advanceTo(T0 + 61000);
  assert.equal(lamp(), false);
});

test("вложенное «Если» в «Иначе» и в задержке собирается и исполняется", () => {
  const box = simHouse();
  const m = box.marks;
  let scenario = { ...scenarioBlank("block"), name: "Вложенные" };
  let made = scenarioAddBlock(scenario, null, "root", "if");
  scenario = made.scenario;
  const top = made.block;
  const metaOn = simCharMeta("On");
  made = scenarioAddBlock(scenario, top.if.id, "conditions", "device");
  scenario = scenarioPatch(
    made.scenario,
    made.block.id,
    scenarioEditorConditionRef(made.block, { markId: m.ДД1, service: 0, char: "MotionDetected" }, simCharMeta("MotionDetected")),
  );
  // «Иначе» (движение пропало) → задержка 30 с → вложенное «Если» ДО открыт → свет выкл
  scenario = scenarioPatch(scenario, top.id, { else: [] });
  made = scenarioAddBlock(scenario, top.id, "else", "delay");
  scenario = scenarioPatch(made.scenario, made.block.id, { sec: 30 });
  const delay = made.block;
  made = scenarioAddBlock(scenario, delay.id, "blocks", "if");
  scenario = made.scenario;
  const inner = made.block;
  made = scenarioAddBlock(scenario, inner.if.id, "conditions", "device");
  assert.equal(made.block.trigger, false, "во вложенном «Если» триггера нет");
  scenario = scenarioPatch(
    made.scenario,
    made.block.id,
    scenarioEditorConditionRef(made.block, { markId: m.ДО1, service: 0, char: "ContactSensorState" }, simCharMeta("ContactSensorState")),
  );
  made = scenarioAddBlock(scenario, inner.id, "then", "device");
  scenario = scenarioPatch(made.scenario, made.block.id, {
    ref: { markId: m.С1, service: 0 },
    items: [{ char: "On", verb: "set", value: false }],
  });
  // «Тогда» верхнего: свет вкл
  made = scenarioAddBlock(scenario, top.id, "then", "device");
  scenario = scenarioPatch(made.scenario, made.block.id, {
    ref: { markId: m.С1, service: 0 },
    items: [scenarioEditorItemChar({ char: "", verb: "set" }, "On", metaOn)],
  });
  assert.deepEqual([...scenarioEditorProblems(box.project, scenario)], []);
  assert.equal(scenarioFind(scenario, inner.id).slot, "blocks");
  const run = runnable(box, scenario);
  const lamp = () => run.engine.value(m.С1, 0, "On");
  run.engine.act({ kind: "set", markId: m.ДД1, service: 0, char: "MotionDetected", value: true });
  assert.equal(lamp(), true);
  run.engine.act({ kind: "set", markId: m.ДД1, service: 0, char: "MotionDetected", value: false });
  run.engine.advanceTo(T0 + 31000);
  // ДО1 закрыт (CONTACT_DETECTED) — условие «= Закрыто» по умолчанию (первое значение) истинно
  assert.equal(lamp(), false);
  assert.ok(projectFormatVersion(addScenario(box.project, scenario).project) === 6);
});

// ——— строки ———————————————————————————————————————————————————————

test("каждая строка редактора, названная в коде, есть в словаре (иначе человек увидел бы сырой ключ)", () => {
  const source = readFileSync(new URL("../src/panels/scenarioEditor.js", import.meta.url), "utf8");
  const missing = [];
  const at = (path) => path.split(".").reduce((node, key) => (node === undefined || node === null ? undefined : node[key]), strings);
  for (const match of source.matchAll(/WORDS\.([A-Za-z]+(?:\.[A-Za-z]+)*)/g)) {
    if (at("scenarios.editor." + match[1]) === undefined) missing.push("SED_WORDS." + match[1]);
  }
  for (const match of source.matchAll(/"(scenarios\.editor\.[A-Za-z.]+)"/g)) {
    if (typeof at(match[1]) !== "string") missing.push(match[1]);
  }
  assert.deepEqual(missing, []);
  // Пункты меню «+» берутся по ключу из набора `scenarioMenu`.
  for (const kind of scenarioMenu("conditions")) assert.equal(typeof strings.scenarios.editor.menu.cond[kind], "string", kind);
  for (const kind of scenarioMenu("actions")) assert.equal(typeof strings.scenarios.editor.menu.act[kind], "string", kind);
  assert.equal(typeof strings.scenarios.editor.menu.root.if, "string");
  for (const verb of ["set", "invert", "increase", "setFrom"]) assert.equal(typeof strings.scenarios.editor.verbs[verb], "string");
  for (const verb of ["run", "activate", "activateRun", "deactivate", "reset"]) assert.equal(typeof strings.scenarios.editor.scenarioVerbs[verb], "string");
  for (const op of ["eq", "ne", "gt", "ge", "lt", "le"]) assert.equal(typeof scenarioEditorOpLabel(op), "string");
});

test("редактор подключён к режиму «Сценарии» дверью editor и не тянет циклов", () => {
  const source = readFileSync(new URL("../src/panels/scenarioEditor.js", import.meta.url), "utf8");
  assert.match(source, /scenariosHook\("editor",\s*scenarioEditorRender\)/);
});
