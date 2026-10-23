// Дерево блочного сценария: правка, фраза, проблемы, заготовки (таск 10
// сценариев). Модуль чистый — работает над значением сценария, а не над
// объектом; объект нужен только для обозначений меток и метаданных
// характеристик.
import test from "node:test";
import assert from "node:assert/strict";

import {
  SCENARIO_TEMPLATES,
  scenarioBlank,
  scenarioAddBlock,
  scenarioBlockMarks,
  scenarioDelayNumber,
  scenarioDelayNumbers,
  scenarioFind,
  scenarioFromTemplate,
  scenarioInsert,
  scenarioIssues,
  scenarioMenu,
  scenarioMove,
  scenarioNewBlock,
  scenarioPatch,
  scenarioOps,
  scenarioPhrase,
  scenarioPhraseParts,
  scenarioRemove,
  scenarioReplace,
  scenarioRepeatAllowed,
  scenarioSetElse,
  scenarioShift,
  scenarioTemplatesFrom,
  scenarioToTemplate,
} from "../src/scenarioTree.js";
import { simCharMeta } from "../src/sim/catalog.js";
import { simHouse } from "./fixtures/simHome.js";

const house = simHouse();
const { project, marks } = house;

const ifBlock = (id, conditions, then, extra = {}) => ({
  type: "if",
  id,
  if: { type: "group", id: id + "g", mode: "OR", conditions },
  then,
  else: null,
  every: null,
  ...extra,
});
const motion = (id, extra = {}) => ({
  type: "device",
  id,
  ref: { markId: marks.ДД1, service: 0, char: "MotionDetected" },
  op: "eq",
  value: true,
  trigger: true,
  ...extra,
});
const lightOn = (id, items = [{ char: "On", verb: "set", value: true }], mark = marks.С1) => ({
  type: "device",
  id,
  ref: { markId: mark, service: 0 },
  items,
});
const scenarioOf = (targets, extra = {}) => ({ id: "s1", kind: "block", name: "Свет", targets, ...extra });

// ——— правка дерева ————————————————————————————————————————————————————

test("вставка: в корень, в «Тогда», в «Иначе», в задержку и в группу условий", () => {
  let scenario = scenarioOf([ifBlock("i1", [motion("c1")], [lightOn("a1")])]);
  scenario = scenarioInsert(scenario, null, "root", 1, lightOn("a2"));
  assert.deepEqual(scenario.targets.map((block) => block.id), ["i1", "a2"]);
  scenario = scenarioInsert(scenario, "i1", "then", 0, lightOn("a3"));
  assert.deepEqual(scenario.targets[0].then.map((block) => block.id), ["a3", "a1"]);
  // «Иначе» было пустым (null): вставка заводит его.
  scenario = scenarioInsert(scenario, "i1", "else", 0, lightOn("a4"));
  assert.deepEqual(scenario.targets[0].else.map((block) => block.id), ["a4"]);
  scenario = scenarioInsert(scenario, "i1g", "conditions", 1, motion("c2"));
  assert.deepEqual(scenario.targets[0].if.conditions.map((block) => block.id), ["c1", "c2"]);
  const delay = { type: "delay", id: "d1", no: 1, sec: 60, timer: "one", blocks: [] };
  scenario = scenarioInsert(scenario, "i1", "then", 99, delay);
  assert.equal(scenario.targets[0].then.at(-1).id, "d1", "индекс за краем — в конец");
  scenario = scenarioInsert(scenario, "d1", "blocks", 0, lightOn("a5"));
  assert.deepEqual(scenarioFind(scenario, "d1").block.blocks.map((block) => block.id), ["a5"]);
});

test("правка не трогает исходный сценарий, а неудачная отдаёт его же", () => {
  const scenario = scenarioOf([ifBlock("i1", [motion("c1")], [lightOn("a1")])]);
  const before = JSON.stringify(scenario);
  const next = scenarioInsert(scenario, "i1", "then", 0, lightOn("a2"));
  assert.notEqual(next, scenario);
  assert.equal(JSON.stringify(scenario), before);
  // Нет такого родителя / слота — ничего не меняется, ссылка та же.
  assert.equal(scenarioInsert(scenario, "нет", "then", 0, lightOn("a2")), scenario);
  assert.equal(scenarioInsert(scenario, "i1", "blocks", 0, lightOn("a2")), scenario, "у «Если» нет слота blocks");
  assert.equal(scenarioRemove(scenario, "нет"), scenario);
  assert.equal(scenarioReplace(scenario, "нет", lightOn("x")), scenario);
});

test("удаление: из любого места дерева, вместе с вложенным", () => {
  let scenario = scenarioOf([
    ifBlock("i1", [motion("c1"), motion("c2")], [{ type: "delay", id: "d1", no: 1, sec: 5, timer: "one", blocks: [lightOn("a1")] }], {
      else: [lightOn("a2")],
    }),
  ]);
  scenario = scenarioRemove(scenario, "a1");
  assert.equal(scenarioFind(scenario, "a1"), null);
  assert.ok(scenarioFind(scenario, "d1"), "задержка осталась");
  scenario = scenarioRemove(scenario, "c2");
  assert.deepEqual(scenario.targets[0].if.conditions.map((block) => block.id), ["c1"]);
  scenario = scenarioRemove(scenario, "d1");
  assert.deepEqual(scenario.targets[0].then, []);
  scenario = scenarioRemove(scenario, "i1");
  assert.deepEqual(scenario.targets, []);
});

test("перенос: между списками, внутри списка и нельзя внутрь самого себя", () => {
  const scenario = scenarioOf([
    ifBlock("i1", [motion("c1")], [lightOn("a1"), lightOn("a2"), lightOn("a3")]),
    ifBlock("i2", [motion("c2")], []),
  ]);
  // Внутри списка: индекс считается в списке без самого блока.
  let moved = scenarioMove(scenario, "a1", "i1", "then", 2);
  assert.deepEqual(moved.targets[0].then.map((block) => block.id), ["a2", "a3", "a1"]);
  // Из «Тогда» одного «Если» в «Тогда» другого.
  moved = scenarioMove(scenario, "a2", "i2", "then", 0);
  assert.deepEqual(moved.targets[0].then.map((block) => block.id), ["a1", "a3"]);
  assert.deepEqual(moved.targets[1].then.map((block) => block.id), ["a2"]);
  // Целый «Если» — в «Иначе» другого.
  moved = scenarioMove(scenario, "i2", "i1", "else", 0);
  assert.deepEqual(moved.targets.map((block) => block.id), ["i1"]);
  assert.equal(moved.targets[0].else[0].id, "i2");
  // Блок нельзя сунуть в самого себя или в своего потомка.
  const nested = scenarioInsert(scenario, "i1", "then", 0, ifBlock("i3", [motion("c3")], []));
  assert.equal(scenarioMove(nested, "i1", "i3", "then", 0), nested);
  assert.equal(scenarioMove(nested, "i1", "i1", "else", 0), nested);
});

test("замена блока: на то же место, соседи на месте", () => {
  const scenario = scenarioOf([ifBlock("i1", [motion("c1")], [lightOn("a1"), lightOn("a2")])]);
  const next = scenarioReplace(scenario, "a1", { type: "notify", id: "n1", text: "Привет" });
  assert.deepEqual(next.targets[0].then.map((block) => block.id), ["n1", "a2"]);
  assert.equal(scenarioFind(next, "n1").block.text, "Привет");
});

test("поиск: родитель, слот и место блока", () => {
  const scenario = scenarioOf([ifBlock("i1", [motion("c1")], [lightOn("a1")], { else: [lightOn("a2")] })]);
  assert.deepEqual(
    { parent: scenarioFind(scenario, "a2").parentId, slot: scenarioFind(scenario, "a2").slot, index: scenarioFind(scenario, "a2").index },
    { parent: "i1", slot: "else", index: 0 },
  );
  assert.deepEqual(
    { parent: scenarioFind(scenario, "c1").parentId, slot: scenarioFind(scenario, "c1").slot },
    { parent: "i1g", slot: "conditions" },
  );
  assert.equal(scenarioFind(scenario, "i1").slot, "root");
  assert.equal(scenarioFind(scenario, "нет"), null);
});

test("номер задержки: следующий за наибольшим, по всему дереву", () => {
  assert.equal(scenarioDelayNumber(scenarioOf([])), 1);
  const scenario = scenarioOf([
    ifBlock("i1", [motion("c1")], [
      { type: "delay", id: "d1", no: 1, sec: 5, timer: "one", blocks: [{ type: "delay", id: "d2", no: 4, sec: 5, timer: "new", blocks: [] }] },
    ]),
  ]);
  assert.equal(scenarioDelayNumber(scenario), 5);
});

test("пустые сценарии трёх видов и новые блоки получают свои id", () => {
  assert.equal(scenarioBlank("block").kind, "block");
  assert.deepEqual(scenarioBlank("block").targets, []);
  assert.equal(scenarioBlank("logic").kind, "logic");
  assert.equal(scenarioBlank("logic").source, "");
  assert.equal(scenarioBlank("global").kind, "global");
  const first = scenarioNewBlock("if");
  const second = scenarioNewBlock("if");
  assert.notEqual(first.id, second.id);
  assert.equal(first.if.type, "group");
  assert.notEqual(first.if.id, first.id);
  assert.deepEqual(first.then, []);
  assert.equal(first.else, null);
  assert.equal(scenarioNewBlock("command").text, "");
});

// ——— операторы и ∞ ————————————————————————————————————————————————————

test("операторы по формату: логика и перечисления — три, числа — семь", () => {
  assert.deepEqual(scenarioOps(simCharMeta("MotionDetected")), ["changed", "eq", "ne"]);
  assert.deepEqual(scenarioOps(simCharMeta("LeakDetected")), ["changed", "eq", "ne"]);
  assert.deepEqual(scenarioOps(simCharMeta("ProgrammableSwitchEvent")), ["changed", "eq", "ne"]);
  assert.deepEqual(scenarioOps(simCharMeta("Brightness")), ["changed", "eq", "ne", "gt", "ge", "lt", "le"]);
  assert.deepEqual(scenarioOps(simCharMeta("CurrentTemperature")), ["changed", "eq", "ne", "gt", "ge", "lt", "le"]);
  // Метаданных нет (устройство удалено) — осторожные три.
  assert.deepEqual(scenarioOps(null), ["changed", "eq", "ne"]);
});

test("∞ только у числовых сравнений — то же правило, что у движка (G07)", () => {
  const brightness = simCharMeta("Brightness");
  assert.equal(scenarioRepeatAllowed({ op: "gt" }, brightness), true);
  assert.equal(scenarioRepeatAllowed({ op: "eq" }, brightness), true);
  assert.equal(scenarioRepeatAllowed({ op: "changed" }, brightness), false);
  assert.equal(scenarioRepeatAllowed({ op: "eq" }, simCharMeta("MotionDetected")), false);
  assert.equal(scenarioRepeatAllowed({ op: "eq" }, simCharMeta("LeakDetected")), false);
});

// ——— фраза-описание (spec 4.3, 4.31) ————————————————————————————————————

test("фраза: условие по устройству с триггером, период и действие с задержкой", () => {
  const scenario = scenarioOf([
    {
      type: "if",
      id: "i1",
      if: {
        type: "group",
        id: "g1",
        mode: "AND",
        conditions: [motion("c1"), { type: "period", id: "p1", days: [1, 2, 3, 4, 5, 6, 7], from: "22:00", to: "06:00", trigger: false }],
      },
      then: [
        lightOn("a1", [
          { char: "On", verb: "set", value: true },
          { char: "Brightness", verb: "set", value: 30 },
        ]),
        { type: "delay", id: "d1", no: 1, sec: 300, timer: "one", blocks: [lightOn("a2", [{ char: "On", verb: "set", value: false }])] },
      ],
      else: null,
      every: null,
    },
  ]);
  assert.equal(scenarioPhrase(project, scenario), "Если ДД1 движение (триггер) и с 22:00 до 06:00 — С1 вкл 30 %, через 5 мин С1 выкл");
});

test("фраза: «ИЛИ», вложенная группа, «Иначе» и вложенное «Если»", () => {
  const inner = {
    type: "group",
    id: "g2",
    mode: "AND",
    conditions: [
      { type: "device", id: "c2", ref: { markId: marks.С1, service: 0, char: "On" }, op: "eq", value: true, trigger: false },
      { type: "device", id: "c3", ref: { markId: marks.С2, service: 0, char: "On" }, op: "eq", value: false, trigger: false },
    ],
  };
  const scenario = scenarioOf([
    {
      type: "if",
      id: "i1",
      if: { type: "group", id: "g1", mode: "OR", conditions: [motion("c1"), inner] },
      then: [lightOn("a1")],
      else: [ifBlock("i2", [motion("c4", { trigger: false })], [lightOn("a2", [{ char: "On", verb: "set", value: false }])])],
      every: null,
    },
  ]);
  assert.equal(
    scenarioPhrase(project, scenario),
    "Если ДД1 движение (триггер) или (С1 вкл и С2 выкл) — С1 вкл, иначе если ДД1 движение — С1 выкл",
  );
});

test("фраза: условия числом, перечислением и удержанием", () => {
  const scenario = scenarioOf([
    ifBlock(
      "i1",
      [
        { type: "device", id: "c1", ref: { markId: marks.С1, service: 0, char: "Brightness" }, op: "gt", value: 50, trigger: true, repeat: true },
        { type: "device", id: "c2", ref: { markId: marks.ДПр1, service: 0, char: "LeakDetected" }, op: "eq", value: "LEAK_DETECTED", trigger: false },
        { type: "device", id: "c3", ref: { markId: marks.ДД1, service: 0, char: "MotionDetected" }, op: "changed", trigger: false },
        { ...motion("c4", { trigger: false }), hold: { mode: "more", sec: 90 } },
      ],
      [],
    ),
  ]);
  assert.equal(
    scenarioPhrase(project, scenario),
    "Если С1 яркость > 50 % (триггер) или ДПр1 протечка = Протечка или ДД1 движение изменено или ДД1 движение дольше 1 мин 30 с",
  );
});

test("фраза: планировщик, восход и закат, дни недели", () => {
  const sched = (mode, extra) => ({ type: "schedule", id: "s" + mode, mode, days: [1, 2, 3, 4, 5, 6, 7], ...extra });
  const phrase = (condition) => scenarioPhrase(project, scenarioOf([ifBlock("i1", [condition], [])]));
  assert.equal(phrase(sched("time", { at: "07:00" })), "Если в 07:00");
  assert.equal(phrase(sched("every", { everySec: 600 })), "Если каждые 10 мин");
  assert.equal(phrase(sched("sunrise", { offsetSec: 0 })), "Если на восходе");
  assert.equal(phrase(sched("sunset", { offsetSec: -1800 })), "Если на закате −30 мин");
  assert.equal(phrase(sched("sunset", { offsetSec: 1800 })), "Если на закате +30 мин");
  assert.equal(phrase(sched("time", { at: "07:00", days: [1, 2, 3, 4, 5] })), "Если в 07:00 (пн–пт)");
  assert.equal(phrase(sched("time", { at: "07:00", days: [6, 7] })), "Если в 07:00 (сб, вс)");
});

test("фраза: условие «Команда» — «по команде «…»» (G16), код и неполные места", () => {
  const phrase = (condition) => scenarioPhrase(project, scenarioOf([ifBlock("i1", [condition], [])]));
  assert.equal(phrase({ type: "command", id: "k1", text: "Ёлочка гори" }), "Если по команде «Ёлочка гори»");
  assert.equal(phrase({ type: "command", id: "k1", text: "" }), "Если по команде «…»");
  assert.equal(phrase({ type: "code", id: "k2", code: "return true" }), "Если условие-код");
  // Устройство не выбрано — скобки, а не пустота.
  assert.equal(phrase({ type: "device", id: "k3", ref: {}, op: "eq", value: true, trigger: true }), "Если [устройство] (триггер)");
});

test("фраза: действия всех видов", () => {
  const phrase = (...actions) => scenarioPhrase(project, scenarioOf(actions));
  assert.equal(phrase(lightOn("a1", [{ char: "On", verb: "invert" }])), "С1 инвертировать");
  assert.equal(phrase(lightOn("a1", [{ char: "Brightness", verb: "increase", step: 10 }])), "С1 яркость +10 %");
  assert.equal(
    phrase(lightOn("a1", [{ char: "Brightness", verb: "setFrom", from: { markId: marks.С2, service: 0, char: "Brightness" } }])),
    "С1 яркость как у С2 яркость",
  );
  assert.equal(phrase({ type: "resetDelay", id: "r1", no: null }), "сбросить задержки");
  assert.equal(phrase({ type: "resetDelay", id: "r1", no: 2 }), "сбросить задержку №2");
  const other = { id: "s2", kind: "block", name: "Ночь", targets: [] };
  const withOther = { ...project, scenarios: [other] };
  assert.equal(scenarioPhrase(withOther, scenarioOf([{ type: "scenario", id: "q1", verb: "run", scenarioId: "s2" }])), "запустить сценарий «Ночь»");
  assert.equal(scenarioPhrase(withOther, scenarioOf([{ type: "scenario", id: "q1", verb: "deactivate", scenarioId: "s2" }])), "деактивировать сценарий «Ночь»");
  assert.equal(phrase({ type: "scenario", id: "q1", verb: "reset", scenarioId: "нет" }), "сбросить сценарий [нет сценария]");
  assert.equal(phrase({ type: "notify", id: "n1", text: "Дверь" }), "уведомить «Дверь»");
  assert.equal(phrase({ type: "http", id: "h1", method: "POST", url: "http://x" }), "HTTP POST");
  assert.equal(phrase({ type: "code", id: "c1", code: "x" }), "выполнить код");
  // «Тогда каждые N» у «Если»: цикл.
  assert.equal(
    scenarioPhrase(project, scenarioOf([ifBlock("i1", [motion("c1")], [lightOn("a1")], { every: { sec: 600 } })])),
    "Если ДД1 движение (триггер) — каждые 10 мин С1 вкл",
  );
});

test("фраза: пустой сценарий и сценарии на JS", () => {
  assert.equal(scenarioPhrase(project, scenarioOf([])), "Пока пусто — добавьте первый блок");
  const logic = { id: "l1", kind: "logic", name: "Свет в коридоре", description: "", template: { name: "Свет по движению", desc: "Включает свет" } };
  assert.equal(scenarioPhrase(project, logic), "Включает свет");
  assert.equal(scenarioPhrase(project, { ...logic, description: "Моё описание" }), "Моё описание");
  assert.equal(scenarioPhrase(project, { ...logic, template: undefined }), "Свет в коридоре");
});

test("части фразы: пустые места заготовки помечены, а склейка даёт ту же фразу", () => {
  const scenario = scenarioFromTemplate(SCENARIO_TEMPLATES[0]);
  const parts = scenarioPhraseParts(project, scenario);
  assert.ok(parts.some((part) => part.slot === "motion"));
  assert.ok(parts.some((part) => part.slot === "light"));
  assert.equal(parts.map((part) => part.text).join(""), scenarioPhrase(project, scenario));
  assert.match(scenarioPhrase(project, scenario), /\[место: Датчик движения\]/);
});

// ——— проблемы ——————————————————————————————————————————————————————————

test("проблемы: неполный блок, удалённое устройство, петля, нет триггеров", () => {
  const gone = lightOn("a9", undefined, "нет-такой-метки");
  const scenario = scenarioOf([
    ifBlock("i1", [motion("c1", { trigger: false }), { type: "device", id: "c2", ref: {}, op: "eq", value: true, trigger: false }], [lightOn("a1"), gone]),
  ]);
  const issues = scenarioIssues(project, scenario);
  const has = (code, blockId) => issues.some((item) => item.code === code && item.blockId === blockId);
  assert.ok(has("incomplete", "c2"), "условие без устройства");
  assert.ok(has("deviceMissing", "a9"), "метки больше нет");
  assert.ok(has("noTrigger", null), "ни одной галки");
  assert.equal(issues.some((item) => item.blockId === "a1"), false, "целый блок чист");
});

test("проблемы: петля — «Тогда» управляет тем, что стоит триггером", () => {
  const loop = scenarioOf([
    ifBlock("i1", [{ type: "device", id: "c1", ref: { markId: marks.С1, service: 0, char: "On" }, op: "eq", value: true, trigger: true }], [
      lightOn("a1", [{ char: "On", verb: "set", value: false }]),
    ]),
  ]);
  assert.deepEqual(
    scenarioIssues(project, loop).filter((item) => item.code === "loop"),
    [{ blockId: "a1", code: "loop" }],
  );
  // Другая характеристика или другое устройство — не петля.
  const fine = scenarioOf([ifBlock("i1", [motion("c1")], [lightOn("a1"), lightOn("a2", undefined, marks.С2)])]);
  assert.deepEqual(scenarioIssues(project, fine), []);
});

test("проблемы: триггером считаются планировщик, команда и период с галкой; без «Если» — нет предупреждения", () => {
  const codes = (conditions) => scenarioIssues(project, scenarioOf([ifBlock("i1", conditions, [lightOn("a1")])])).map((item) => item.code);
  assert.deepEqual(codes([{ type: "schedule", id: "s1", mode: "time", days: [1], at: "07:00" }]), []);
  assert.deepEqual(codes([{ type: "command", id: "k1", text: "Привет" }]), []);
  assert.deepEqual(codes([{ type: "period", id: "p1", days: [1], from: "01:00", to: "02:00", trigger: true }]), []);
  assert.deepEqual(codes([{ type: "period", id: "p1", days: [1], from: "01:00", to: "02:00", trigger: false }]), ["noTrigger"]);
  assert.deepEqual(scenarioIssues(project, scenarioOf([lightOn("a1")])), []);
  // Сценарии на JS блочных проблем не имеют.
  assert.deepEqual(scenarioIssues(project, { id: "l", kind: "logic", name: "x" }), []);
});

test("проблемы: пустой текст команды — неполный блок (G16)", () => {
  const issues = scenarioIssues(project, scenarioOf([ifBlock("i1", [{ type: "command", id: "k1", text: "  " }], [lightOn("a1")])]));
  assert.ok(issues.some((item) => item.code === "incomplete" && item.blockId === "k1"));
});

// ——— заготовки (spec 4.24, 4.25) ———————————————————————————————————————

test("шесть заготовок с пустыми местами под устройства", () => {
  assert.deepEqual(
    SCENARIO_TEMPLATES.map((template) => template.key),
    ["motionLight", "nightDim", "leakValve", "curtainsSun", "leaveHome", "doublePress"],
  );
  for (const template of SCENARIO_TEMPLATES) {
    const scenario = scenarioFromTemplate(template);
    assert.equal(scenario.kind, "block");
    assert.ok(scenario.name.length > 0);
    assert.ok(scenario.targets.length > 0);
    const slots = scenarioBlockMarks(scenario.targets, { slots: true });
    assert.ok(slots.length > 0, template.key + ": нет пустых мест");
    for (const slot of template.slots) assert.ok(slots.includes(slot.key), template.key + ": место " + slot.key + " нигде не стоит");
    // Каждое место в блоке объявлено в заготовке, а у каждого блока — свой id.
    for (const key of slots) assert.ok(template.slots.some((slot) => slot.key === key));
    const ids = JSON.stringify(scenario).match(/"id":"[^"]+"/g);
    assert.equal(new Set(ids).size, ids.length, template.key + ": id блоков повторяются");
  }
});

test("заготовка при каждом создании — новые id, а исходная не портится", () => {
  const template = SCENARIO_TEMPLATES[0];
  const before = JSON.stringify(template);
  const first = scenarioFromTemplate(template);
  const second = scenarioFromTemplate(template);
  assert.equal(JSON.stringify(template), before);
  assert.notEqual(first.targets[0].id, second.targets[0].id);
});

test("заготовки дают сценарий без проблем-ловушек: пустые места — неполные блоки, триггер есть", () => {
  for (const template of SCENARIO_TEMPLATES) {
    const issues = scenarioIssues(project, scenarioFromTemplate(template));
    assert.equal(issues.some((item) => item.code === "noTrigger"), false, template.key + ": нет триггера");
    assert.equal(issues.some((item) => item.code === "loop"), false, template.key + ": петля");
    assert.ok(issues.some((item) => item.code === "incomplete"), template.key + ": пустые места не красные");
  }
});

test("«Сохранить как заготовку»: устройства становятся пустыми местами, остальное сохраняется", () => {
  const scenario = scenarioOf(
    [
      ifBlock("i1", [motion("c1")], [
        lightOn("a1"),
        { type: "delay", id: "d1", no: 1, sec: 120, timer: "one", blocks: [lightOn("a2", [{ char: "On", verb: "set", value: false }])] },
        lightOn("a3", undefined, marks.С2),
      ]),
    ],
    { description: "Моё", sequential: true },
  );
  const template = scenarioToTemplate(scenario, project);
  assert.equal(template.name, "Свет");
  assert.deepEqual(template.slots.map((slot) => slot.key), ["device1", "device2", "device3"].slice(0, 3));
  const text = JSON.stringify(template.scenario);
  assert.equal(text.includes(marks.ДД1), false, "метка осталась в заготовке");
  assert.equal(text.includes(marks.С1), false);
  // Одна метка — одно место, даже когда она стоит в нескольких блоках.
  const refs = [];
  const walk = (value) => {
    if (Array.isArray(value)) return value.forEach(walk);
    if (value && typeof value === "object") {
      if (value.slot) refs.push(value);
      Object.values(value).forEach(walk);
    }
  };
  walk(template.scenario);
  assert.equal(refs.filter((ref) => ref.slot === refs[1].slot).length, 2, "С1 стоит в двух блоках — место одно");
  assert.equal(refs[0].char, "MotionDetected", "характеристика условия осталась");
  assert.equal(template.scenario.sequential, true);
  // Из сохранённой заготовки получается живой сценарий с пустыми местами и новыми id.
  const again = scenarioFromTemplate(template);
  assert.equal(again.name, "Свет");
  assert.notEqual(again.targets[0].id, "i1");
  assert.deepEqual(scenarioBlockMarks(again.targets, { slots: true }).sort(), ["device1", "device2", "device3"]);
});

test("список своих заготовок из браузера: мусор отбрасывается, годные остаются", () => {
  const good = { id: "t1", name: "Моя", slots: [], scenario: { kind: "block", name: "Моя", targets: [] } };
  assert.deepEqual(scenarioTemplatesFrom([good, null, 5, { id: "t2" }, { ...good, id: "t3", name: "" }]).map((item) => item.id), ["t1"]);
  assert.deepEqual(scenarioTemplatesFrom(undefined), []);
  assert.deepEqual(scenarioTemplatesFrom({ a: 1 }), []);
});

test("метки блока: для подсветки на мини-плане", () => {
  const block = ifBlock("i1", [motion("c1")], [lightOn("a1"), lightOn("a2", undefined, marks.С2)]);
  assert.deepEqual(scenarioBlockMarks(block).sort(), [marks.ДД1, marks.С1, marks.С2].sort());
  assert.deepEqual(scenarioBlockMarks({ type: "notify", id: "n", text: "x" }), []);
  const setFrom = lightOn("a3", [{ char: "Brightness", verb: "setFrom", from: { markId: marks.С2, service: 0, char: "Brightness" } }]);
  assert.deepEqual(scenarioBlockMarks(setFrom).sort(), [marks.С1, marks.С2].sort());
});

// ——— правка из редактора (таск 11) ————————————————————————————————————

const fresh = () => ({ ...scenarioBlank("block"), targets: [] });

test("меню «+»: условия, действия и верхний уровень — наборы как в Sprut", () => {
  assert.deepEqual(scenarioMenu("conditions"), ["device", "group", "schedule", "period", "code", "command"]);
  assert.deepEqual(scenarioMenu("actions"), ["device", "if", "delay", "resetDelay", "scenario", "code", "notify", "http"]);
  assert.deepEqual(scenarioMenu("root"), ["if", ...scenarioMenu("actions").filter((kind) => kind !== "if")]);
  assert.deepEqual(scenarioMenu("nonsense"), []);
});

test("новое «Если» верхнего уровня: условие с триггером, вложенное — без", () => {
  let scenario = scenarioAddBlock(fresh(), null, "root", "if").scenario;
  const top = scenario.targets[0];
  assert.equal(top.type, "if");
  const made = scenarioAddBlock(scenario, top.if.id, "conditions", "device");
  assert.equal(made.block.type, "device");
  assert.equal(made.block.trigger, true, "верхнее «Если» — триггер по умолчанию");
  scenario = made.scenario;
  const inner = scenarioAddBlock(scenario, top.id, "then", "if");
  scenario = inner.scenario;
  const nested = scenarioAddBlock(scenario, inner.block.if.id, "conditions", "device");
  assert.equal(nested.block.trigger, false, "вложенное — без триггера");
  const group = scenarioAddBlock(scenario, top.if.id, "conditions", "group");
  const inGroup = scenarioAddBlock(group.scenario, group.block.id, "conditions", "device");
  assert.equal(inGroup.block.trigger, false, "в группе условий — следующий уровень, без триггера");
  const period = scenarioAddBlock(scenario, top.if.id, "conditions", "period");
  assert.equal(period.block.trigger, true);
});

test("новые действия: номер задержки ставится сам, остальное по умолчанию из newBlock", () => {
  let scenario = scenarioAddBlock(fresh(), null, "root", "delay").scenario;
  assert.equal(scenario.targets[0].no, 1);
  const second = scenarioAddBlock(scenario, scenario.targets[0].id, "blocks", "delay");
  assert.equal(second.block.no, 2, "внутри задержки — следующий номер по всему дереву");
  scenario = second.scenario;
  const reset = scenarioAddBlock(scenario, null, "root", "resetDelay");
  assert.equal(reset.block.no, null, "сброс — все задержки");
  const action = scenarioAddBlock(scenario, null, "root", "device");
  assert.deepEqual(action.block.items, [], "действие над устройством несёт items");
  assert.equal(action.block.trigger, undefined);
  assert.equal(scenarioDelayNumbers(scenario).join(), "1,2");
});

test("вставка на место и неверный слот: ничего не меняется", () => {
  let scenario = scenarioAddBlock(fresh(), null, "root", "notify").scenario;
  scenario = scenarioAddBlock(scenario, null, "root", "code", 0).scenario;
  assert.deepEqual(scenario.targets.map((block) => block.type), ["code", "notify"]);
  const bad = scenarioAddBlock(scenario, scenario.targets[0].id, "then", "notify");
  assert.equal(bad.scenario, scenario);
  assert.equal(bad.block, null);
  assert.equal(scenarioAddBlock(scenario, null, "root", "no-such-kind").scenario, scenario);
  assert.equal(scenarioAddBlock(scenario, null, "root", "group").scenario, scenario, "группа в корень не кладётся");
});

test("правка полей блока: слияние, undefined убирает ключ, то же — тот же сценарий", () => {
  const scenario = { ...fresh(), targets: [{ type: "notify", id: "n1", text: "a" }] };
  const next = scenarioPatch(scenario, "n1", { text: "b" });
  assert.equal(scenarioFind(next, "n1").block.text, "b");
  assert.equal(scenarioFind(scenario, "n1").block.text, "a", "исходный не тронут");
  assert.equal(scenarioPatch(scenario, "n1", { text: "a" }), scenario);
  assert.equal(scenarioPatch(scenario, "no-such", { text: "b" }), scenario);
  const cleared = scenarioPatch(next, "n1", { text: undefined });
  assert.equal("text" in scenarioFind(cleared, "n1").block, false);
});

test("правка группы условий «Если» сохраняет её условия", () => {
  const scenario = { ...fresh(), targets: [ifBlock("i1", [motion("c1")], [])] };
  const next = scenarioPatch(scenario, "i1g", { mode: "AND" });
  const block = scenarioFind(next, "i1").block;
  assert.equal(block.if.mode, "AND");
  assert.equal(block.if.conditions[0].id, "c1");
});

test("«Иначе»: добавить и удалить, повтор — то же", () => {
  const scenario = { ...fresh(), targets: [ifBlock("i1", [motion("c1")], [lightOn("a1")])] };
  const withElse = scenarioSetElse(scenario, "i1", true);
  assert.deepEqual(scenarioFind(withElse, "i1").block.else, []);
  assert.equal(scenarioSetElse(withElse, "i1", true), withElse);
  const without = scenarioSetElse(withElse, "i1", false);
  assert.equal(scenarioFind(without, "i1").block.else, null);
  assert.equal(scenarioSetElse(scenario, "i1", false), scenario);
  assert.equal(scenarioSetElse(scenario, "c1", true), scenario, "не «Если» — ничего");
});

test("кнопки ↑↓: сдвиг на место, у края — то же, условия тоже переставляются", () => {
  const scenario = { ...fresh(), targets: [ifBlock("i1", [motion("c1"), motion("c2"), motion("c3")], [lightOn("a1"), lightOn("a2")])] };
  const down = scenarioShift(scenario, "a1", 1);
  assert.deepEqual(scenarioFind(down, "i1").block.then.map((block) => block.id), ["a2", "a1"]);
  assert.equal(scenarioShift(scenario, "a1", -1), scenario);
  assert.equal(scenarioShift(down, "a1", 1), down);
  const conditions = scenarioShift(scenario, "c3", -1);
  assert.deepEqual(scenarioFind(conditions, "i1").block.if.conditions.map((block) => block.id), ["c1", "c3", "c2"]);
  assert.equal(scenarioShift(scenario, "i1g", 1), scenario, "группа «Если» не двигается");
  const roots = { ...fresh(), targets: [ifBlock("i1", [], []), ifBlock("i2", [], [])] };
  assert.deepEqual(scenarioShift(roots, "i1", 1).targets.map((block) => block.id), ["i2", "i1"]);
});
