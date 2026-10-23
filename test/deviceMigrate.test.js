// Перевод аксессуаров старых объектов (правка после сборки сценариев, G68).
//
// Слова заказчика: «У всех выключателей считаем что есть реле на каждую
// клавишу. По факту это может быть как умный выключатель, так и реле в
// подрозетнике» и «У термостатов в режиме Авто есть не пороги нагрева и
// охлаждения, а одна характеристика — целевая температура» с выбором
// «Кондиционер → Термостат».
import test from "node:test";
import assert from "node:assert/strict";

import { addLogicBinding, addScenario, markDeviceOf, setMarkDevice, typeDeviceOf } from "../src/model.js";
import { MIGRATE_CONDITIONER_LEGACY, migrateDevices } from "../src/deviceMigrate.js";
import { createSimEngine } from "../src/sim/engine.js";
import { buildHomeSpec, deviceAids, deviceIdsOf } from "../src/sim/home.js";
import { deviceWindowModel } from "../src/panels/deviceSettings.js";
import { simHouse, simLink, simRecorder } from "./fixtures/simHome.js";

let seq = 0;
const nid = (prefix) => prefix + (seq += 1);
const ref = (markId, char, service = 0) => ({ markId, service, char });
const cond = (at, op, value, extra = {}) => ({ type: "device", id: nid("c"), ref: at, op, value, trigger: false, ...extra });
const group = (mode, conditions) => ({ type: "group", id: nid("g"), mode, conditions });
const when = (conditions, then) => ({ type: "if", id: nid("if"), if: group("OR", conditions), then, else: null, every: null });
const act = (markId, service, items) => ({ type: "device", id: nid("a"), ref: { markId, service }, items });

function blocks(project, name, targets) {
  const added = addScenario(project, { kind: "block", name, targets });
  return { project: added.project, id: added.scenario.id };
}

function walk(value, out = []) {
  if (Array.isArray(value)) value.forEach((item) => walk(item, out));
  else if (value && typeof value === "object") {
    if (value.type === "device") out.push(value);
    for (const key of Object.keys(value)) walk(value[key], out);
  }
  return out;
}

test("выключатель без реле: «Выключатель» на каждую клавишу, ссылки и привязки на кнопки — на новые номера", () => {
  const box = simHouse();
  const В2 = box.marks["В2"];
  // До перевода у В2 одни кнопки: сервис 0 — кнопка канала 1.
  assert.deepEqual(markDeviceOf(box.project, В2).services.map((service) => service.type), ["StatelessProgrammableSwitch"]);
  let project = blocks(box.project, "По нажатию", [
    when([cond(ref(В2, "ProgrammableSwitchEvent", 0), "eq", "SINGLE_PRESS", { trigger: true })], [
      act(box.marks["С3"], 0, [{ char: "On", verb: "invert" }]),
    ]),
  ]).project;
  const logic = addScenario(project, { kind: "logic", name: "Кнопка", source: "info = {name: 'Кнопка'};\nfunction trigger(){}" });
  project = logic.project;
  const aid = deviceAids(project).get(В2);
  const keySid = deviceIdsOf(markDeviceOf(project, В2).services)[0].sid;
  const bound = addLogicBinding(project, { scenarioId: logic.scenario.id, markId: В2, service: 0, options: { key: aid + "." + keySid } });
  project = bound.project;

  const moved = migrateDevices(project);
  assert.equal(moved.changed, true);
  assert.equal(moved.switches, 1);
  const after = moved.project;
  const services = markDeviceOf(after, В2).services;
  assert.deepEqual(services.map((service) => [service.type, service.channel]), [["Switch", 1], ["StatelessProgrammableSwitch", 1]]);
  assert.equal(services[1].decoupled, true, "клавиша со сценарием на нажатие осталась привязанной и замолчала бы");
  // Ссылка условия и привязка логики — на кнопку, она теперь второй.
  const scenario = after.scenarios.find((item) => item.name === "По нажатию");
  const trigger = walk(scenario.targets).find((block) => block.ref && block.ref.markId === В2);
  assert.equal(trigger.ref.service, 1);
  assert.equal(trigger.ref.char, "ProgrammableSwitchEvent");
  const binding = after.logicBindings.find((item) => item.id === bound.binding.id);
  assert.equal(binding.service, 1);
  const newSid = deviceIdsOf(services)[1].sid;
  assert.equal(binding.options.key, aid + "." + newSid, "адрес кнопки в опциях логики не переехал");
  // Чужие ссылки (С3) не тронуты, второе открытие ничего не меняет.
  const lamp = walk(scenario.targets).find((block) => block.ref && block.ref.markId === box.marks["С3"]);
  assert.equal(lamp.ref.service, 0);
  assert.equal(migrateDevices(after).project, after, "второй проход снова переводит");
});

test("справочник: тип «без реле» переводится и без меток, вид «без реле» в окне аксессуара не выбрать", () => {
  const box = simHouse();
  const typeId = box.project.marks.find((mark) => mark.id === box.marks["В1"]).typeId;
  const project = {
    ...box.project,
    markTypes: box.project.markTypes.map((type) => (type.id === typeId ? { ...type, device: { kind: "switch" } } : type)),
    marks: [],
  };
  const moved = migrateDevices(project);
  assert.equal(moved.changed, true);
  assert.equal(typeDeviceOf(moved.project, typeId).kind, "switchRelay");
  const kinds = deviceWindowModel({ kind: "switchRelay", services: [], decoupled: [], params: {} }).kinds.map((item) => item.key);
  assert.ok(!kinds.includes("switch"), "вид «без реле» снова предлагается");
  assert.ok(kinds.includes("switchRelay"));
});

test("кондиционер: «Нагреватель-охладитель» — «Термостат»; «Активен», режимы и два порога в сценариях — его характеристики", () => {
  const box = simHouse();
  const К1 = box.marks["К1"];
  assert.equal(markDeviceOf(box.project, К1).services[0].type, "Thermostat", "выведенный кондиционер уже термостат");
  let project = blocks(box.project, "Кондиционер", [
    when(
      [cond(ref(К1, "Active"), "eq", "ACTIVE"), cond(ref(К1, "CurrentHeaterCoolerState"), "eq", "COOLING"), cond(ref(К1, "Active"), "ne", "INACTIVE")],
      [
        act(К1, 0, [
          { char: "TargetHeaterCoolerState", verb: "set", value: "COOL" },
          { char: "CoolingThresholdTemperature", verb: "set", value: 23 },
          { char: "HeatingThresholdTemperature", verb: "set", value: 21 },
        ]),
        act(К1, 0, [{ char: "Active", verb: "set", value: "INACTIVE" }]),
        act(box.marks["С1"], 0, [{ char: "Brightness", verb: "setFrom", from: { markId: К1, service: 0, char: "CoolingThresholdTemperature" } }]),
      ],
    ),
  ]).project;
  const moved = migrateDevices(project);
  assert.equal(moved.changed, true);
  const scenario = moved.project.scenarios.find((item) => item.name === "Кондиционер");
  const found = walk(scenario.targets);
  const conditions = found.filter((block) => !block.items);
  assert.deepEqual(
    conditions.map((block) => [block.ref.char, block.op, block.value]),
    [
      ["TargetHeatingCoolingState", "ne", "OFF"],
      ["CurrentHeatingCoolingState", "eq", "COOL"],
      ["TargetHeatingCoolingState", "ne", "OFF"],
    ],
  );
  const actions = found.filter((block) => block.items);
  assert.deepEqual(
    actions[0].items.map((item) => [item.char, item.value]),
    [
      ["TargetHeatingCoolingState", "COOL"],
      ["TargetTemperature", 23],
    ],
    "два порога одной правкой — одна целевая температура",
  );
  assert.deepEqual(actions[1].items.map((item) => [item.char, item.value]), [["TargetHeatingCoolingState", "OFF"]]);
  assert.equal(actions[2].items[0].from.char, "TargetTemperature");
  assert.equal(migrateDevices(moved.project).project, moved.project, "второй проход снова переводит");
});

test("кондиционер со своими сервисами: термостат на том же месте, скорость — ступенями, адреса в опциях логики — новые", () => {
  const box = simHouse();
  const К1 = box.marks["К1"];
  const heater = {
    type: "HeaterCooler",
    chars: ["Active", "CurrentTemperature", "CurrentHeaterCoolerState", "TargetHeaterCoolerState", "CoolingThresholdTemperature", "HeatingThresholdTemperature", "RotationSpeed"],
  };
  // Объект прежней сборки: свой профиль метки с нагревателем.
  let project = {
    ...box.project,
    marks: box.project.marks.map((mark) => (mark.id === К1 ? { ...mark, device: { kind: "conditioner", services: [heater] } } : mark)),
  };
  assert.equal(markDeviceOf(project, К1).services[0].type, "HeaterCooler");
  const logic = addScenario(project, { kind: "logic", name: "Датчик", source: "info = {name: 'Датчик'};\nfunction trigger(){}" });
  project = logic.project;
  const aid = deviceAids(project).get(К1);
  const old = deviceIdsOf(markDeviceOf(project, К1).services)[0];
  // Опция — «Текущая температура» кондиционера (второй характеристикой нагревателя).
  project = addLogicBinding(project, {
    scenarioId: logic.scenario.id,
    markId: box.marks["С1"],
    service: 0,
    options: { sensor: aid + "." + old.sid + "." + old.cids[1] },
  }).project;
  const moved = migrateDevices(project);
  const services = markDeviceOf(moved.project, К1).services;
  assert.equal(services[0].type, "Thermostat");
  assert.ok(services[0].chars.includes("C_FanSpeed"), "скорость не стала ступенями термостата");
  assert.ok(!services[0].chars.includes("RotationSpeed"));
  const now = deviceIdsOf(services)[0];
  const at = services[0].chars.indexOf("CurrentTemperature");
  assert.equal(moved.project.logicBindings[0].options.sensor, aid + "." + now.sid + "." + now.cids[at]);
  assert.equal(migrateDevices(moved.project).project, moved.project);
  // Нагреватель, добавленный руками рядом с термостатом, — решение человека.
  const both = setMarkDevice(moved.project, К1, { services: [...services.map(({ type, chars }) => ({ type, chars })), heater] }).project;
  assert.equal(migrateDevices(both).project, both, "перевод тронул нагреватель, добавленный после него");
});

test("прежний вид кондиционера описан тем составом, что выводился до перевода", () => {
  assert.deepEqual(MIGRATE_CONDITIONER_LEGACY[0].chars, [
    "Active",
    "CurrentTemperature",
    "CurrentHeaterCoolerState",
    "TargetHeaterCoolerState",
    "CoolingThresholdTemperature",
    "HeatingThresholdTemperature",
  ]);
});

test("кондиционер-термостат в имитации: щелчок — «Выкл» и обратно к прежнему режиму, клавиша выключателя им управляет", () => {
  const box = simHouse();
  simLink(box, "В1", [["К1", 1]]);
  const recorder = simRecorder();
  const engine = createSimEngine({ emit: recorder.emit });
  engine.load(buildHomeSpec(box.project));
  engine.setClock({ simMs: Date.UTC(2026, 9, 23, 12) });
  engine.start();
  const К1 = box.marks["К1"];
  const mode = () => engine.value(К1, 0, "TargetHeatingCoolingState");
  engine.act({ kind: "set", markId: К1, service: 0, char: "TargetHeatingCoolingState", value: "COOL" });
  engine.act({ kind: "toggle", markId: К1 });
  assert.equal(mode(), "OFF");
  engine.act({ kind: "toggle", markId: К1 });
  assert.equal(mode(), "COOL", "включённый кондиционер забыл свой режим");
  // Реле В1 выключили — кондиционер выключился; включили — вернулся к своему.
  engine.act({ kind: "set", markId: box.marks["В1"], service: 0, char: "On", value: true });
  assert.equal(mode(), "COOL", "включение реле сбило выбранный режим");
  engine.act({ kind: "set", markId: box.marks["В1"], service: 0, char: "On", value: false });
  assert.equal(mode(), "OFF");
  engine.act({ kind: "set", markId: box.marks["В1"], service: 0, char: "On", value: true });
  assert.equal(mode(), "COOL");
  // Одна целевая температура: в «Авто» греет ниже неё и охлаждает выше.
  engine.act({ kind: "set", markId: К1, service: 0, char: "TargetHeatingCoolingState", value: "AUTO" });
  engine.act({ kind: "set", markId: К1, service: 0, char: "CurrentTemperature", value: 26 });
  engine.act({ kind: "set", markId: К1, service: 0, char: "TargetTemperature", value: 22 });
  assert.equal(engine.value(К1, 0, "CurrentHeatingCoolingState"), "COOL");
  engine.act({ kind: "set", markId: К1, service: 0, char: "CurrentTemperature", value: 19 });
  assert.equal(engine.value(К1, 0, "CurrentHeatingCoolingState"), "HEAT");
});
