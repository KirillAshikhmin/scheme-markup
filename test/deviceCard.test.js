// Карточка устройства и щелчок по метке в имитации (таск 08 сценариев;
// истории 2.5–2.7, 2.10, 2.13).
//
// Что держит этот файл:
//   1. **План щелчка** (`deviceClickPlan`) на доме-фикстуре: что делает щелчок
//      по светильнику, датчику, шторе, ТВ, замку, одноклавишному, двухклавишному
//      и отвязанному выключателю.
//   2. **Клавиши** (`deviceKeysOf`): привязанная клавиша с «Выключателем»
//      отвечает сразу, отвязанная и кнопка без реле — нажатиями; профиль до G11
//      (одни кнопки) работает как прежде.
//   3. **Модель карточки** (`deviceCardModel`): орган управления по формату,
//      три нажатия у клавиши, «двойное» и «долгое» выключены у привязанной.
//   4. **Нажатия** (`deviceKeyPresser`) — одно правило для мыши, пальца и `E`:
//      одиночное не раньше окна двойного, двойное сразу, долгое — пока зажато.
import test from "node:test";
import assert from "node:assert/strict";

import { markAccessory } from "../src/sim/home.js";
import { setMarkDevice, updateMark } from "../src/model.js";
import { PRESS_DOUBLE_MS, PRESS_LONG_MS } from "../src/sim/presses.js";
import {
  deviceCardModel,
  deviceClickAct,
  deviceClickPlan,
  deviceKeyPresser,
  deviceKeysOf,
  deviceLiveKinds,
  devicePresserOf,
  devicePressers,
  deviceValueText,
} from "../src/panels/deviceCard.js";
import { simCharMeta } from "../src/sim/catalog.js";
import { simHouse } from "./fixtures/simHome.js";

const box = simHouse();
const accessory = (label) => markAccessory(box.project, box.marks[label]);
const plan = (label) => deviceClickPlan(accessory(label));

// ——— план щелчка ————————————————————————————————————————————————————

test("щелчок по светильнику, шторе, ТВ, розетке и замку — переключение", () => {
  for (const label of ["С1", "Т1", "КШ1", "ТВ1", "Р1", "ЗМ1", "КВ1", "Б1", "К1"]) {
    assert.equal(plan(label).kind, "toggle", label);
  }
});

test("щелчок по датчику — срабатывание его сервиса", () => {
  for (const label of ["ДД1", "ДП1", "ДО1", "ДПр1"]) {
    const found = plan(label);
    assert.equal(found.kind, "sensor", label);
    assert.equal(found.service, 0, label);
  }
});

test("датчик температуры и влажности щёлкать нечем: его значения — в карточке", () => {
  assert.equal(plan("ДТВ1").kind, "none");
  assert.equal(deviceClickPlan(null).kind, "none");
});

test("одна клавиша — нажатие по ней; несколько — щелчок только выделяет", () => {
  const single = plan("В1");
  assert.equal(single.kind, "key");
  assert.equal(single.key.index, 1, "кнопка идёт после «Выключателя»");
  const several = plan("ВВ1");
  assert.equal(several.kind, "keys");
  assert.deepEqual(
    several.keys.map((key) => key.index),
    [2, 3],
  );
});

// ——— клавиши ————————————————————————————————————————————————————————

test("привязанная клавиша с «Выключателем» отвечает сразу, без распознавателя", () => {
  const [key] = deviceKeysOf(accessory("В1"));
  assert.equal(key.relay, 0);
  assert.equal(key.decoupled, false);
  assert.equal(key.detect, false);
});

test("отвязанная клавиша шлёт нажатия через распознаватель, привязанная соседка — нет", () => {
  const house = simHouse();
  house.project = setMarkDevice(house.project, house.marks["ВВ1"], { decoupled: [2] }).project;
  const keys = deviceKeysOf(markAccessory(house.project, house.marks["ВВ1"]));
  assert.deepEqual(
    keys.map((key) => [key.channel, key.decoupled, key.detect]),
    [
      [1, false, false],
      [2, true, true],
    ],
  );
});

test("профиль до G11 (одни кнопки, отвязанная клавиша): нажатия через распознаватель, реле нет", () => {
  const [key] = deviceKeysOf(accessory("В2"));
  assert.equal(key.relay, null);
  assert.equal(key.decoupled, true);
  assert.equal(key.detect, true);
});

test("отдельная кнопка (нет «Выключателя», клавиша не отвязана) тоже шлёт нажатия через распознаватель", () => {
  const house = simHouse();
  // Профиль «одни кнопки» без отметки «отвязана»: кнопка без пары — не привязана ни к чему.
  house.project = setMarkDevice(house.project, house.marks["В2"], { decoupled: [] }).project;
  const [key] = deviceKeysOf(markAccessory(house.project, house.marks["В2"]));
  assert.equal(key.relay, null);
  assert.equal(key.decoupled, false);
  assert.equal(key.detect, true, "двойное и долгое у отдельной кнопки пропали бы");
});

// ——— исполнение щелчка ———————————————————————————————————————————————

function recorder() {
  const calls = [];
  return {
    calls,
    io: {
      press: (markId, index, press) => calls.push(["press", markId, index, press]) && true,
      act: (action) => calls.push(["act", action]) && true,
    },
  };
}

test("щелчок немедленно: клавиша — одиночное, датчик — срабатывание, остальное — переключение", () => {
  const { calls, io } = recorder();
  deviceClickAct(box.marks["В1"], plan("В1"), io);
  deviceClickAct(box.marks["ДД1"], plan("ДД1"), io);
  deviceClickAct(box.marks["С1"], plan("С1"), io);
  assert.deepEqual(calls, [
    ["press", box.marks["В1"], 1, "single"],
    ["act", { kind: "sensor", markId: box.marks["ДД1"], service: 0 }],
    ["act", { kind: "toggle", markId: box.marks["С1"] }],
  ]);
});

test("многоклавишный выключатель и «нечем щёлкать» немедленно ничего не шлют", () => {
  const { calls, io } = recorder();
  assert.equal(deviceClickAct(box.marks["ВВ1"], plan("ВВ1"), io), false);
  assert.equal(deviceClickAct(box.marks["ДТВ1"], plan("ДТВ1"), io), false);
  assert.deepEqual(calls, []);
});

// ——— модель карточки ——————————————————————————————————————————————————

const readOf = (values) => (service, char) => values[service + "." + char];

test("светильник: «Включено» — переключатель, «Яркость» — ползунок 0…100 с процентами", () => {
  const model = deviceCardModel(box.project, box.marks["С1"], readOf({ "0.On": true, "0.Brightness": 40 }));
  assert.equal(model.label, "С1");
  assert.equal(model.keys.length, 0);
  assert.equal(model.services.length, 1);
  const [on, level] = model.services[0].chars;
  assert.equal(on.control.kind, "toggle");
  assert.equal(on.text, "да");
  assert.deepEqual(level.control, { kind: "range", min: 0, max: 100, step: 1 });
  assert.equal(level.text, "40%");
});

test("выключатель на два канала: две клавиши, сервисы «Выключатель 1» и «Выключатель 2»", () => {
  const model = deviceCardModel(box.project, box.marks["ВВ1"], readOf({}));
  assert.equal(model.keys.length, 2);
  assert.deepEqual(
    model.services.map((service) => service.name),
    ["Выключатель 1", "Выключатель 2"],
  );
  assert.ok(model.services.every((service) => service.chars.every((char) => char.type !== "ProgrammableSwitchEvent")));
});

test("три кнопки нажатий: у привязанной клавиши «двойное» и «долгое» выключены, у отвязанной — все", () => {
  const bound = deviceCardModel(box.project, box.marks["В1"], readOf({})).keys[0];
  assert.deepEqual(
    bound.presses.map((item) => [item.press, item.enabled]),
    [
      ["single", true],
      ["double", false],
      ["long", false],
    ],
  );
  const free = deviceCardModel(box.project, box.marks["В2"], readOf({})).keys[0];
  assert.deepEqual(
    free.presses.map((item) => item.enabled),
    [true, true, true],
  );
});

test("состояние «Выключателя» канала читается из значений: клавиша знает, включена ли она", () => {
  const off = deviceCardModel(box.project, box.marks["В1"], readOf({ "0.On": false })).keys[0];
  const on = deviceCardModel(box.project, box.marks["В1"], readOf({ "0.On": true })).keys[0];
  assert.equal(off.on, false);
  assert.equal(on.on, true);
  assert.equal(deviceCardModel(box.project, box.marks["В2"], readOf({})).keys[0].on, null, "у кнопки без реле состояния нет");
});

test("орган управления по формату: перечисление — список, чтение — значение, число — ползунок", () => {
  const thermostat = deviceCardModel(box.project, box.marks["ТС1"], readOf({ "0.CurrentTemperature": 21.5, "0.TargetTemperature": 23 }));
  const kinds = Object.fromEntries(thermostat.services[0].chars.map((char) => [char.type, char.control.kind]));
  assert.equal(kinds.CurrentTemperature, "readout");
  assert.equal(kinds.TargetTemperature, "range");
  assert.equal(kinds.TargetHeatingCoolingState, "select");
  const select = thermostat.services[0].chars.find((char) => char.type === "TargetHeatingCoolingState").control;
  assert.ok(select.options.includes("HEAT") && select.options.includes("OFF"));
  const curtain = deviceCardModel(box.project, box.marks["КШ1"], readOf({}));
  const position = curtain.services[0].chars.find((char) => char.type === "CurrentPosition");
  assert.equal(position.control.kind, "readout", "текущее положение шторы только читается");
});

test("метка без устройства — модели нет", () => {
  assert.equal(deviceCardModel(box.project, "нет-такой", readOf({})), null);
});

test("значения словами: да/нет, константы по-русски, числа с единицей, нажатие — подписью", () => {
  assert.equal(deviceValueText(simCharMeta("On"), "On", true), "да");
  assert.equal(deviceValueText(simCharMeta("On"), "On", false), "нет");
  assert.equal(deviceValueText(simCharMeta("Active"), "Active", "ACTIVE"), "Включено");
  assert.equal(deviceValueText(simCharMeta("CurrentTemperature"), "CurrentTemperature", 22), "22°C");
  assert.equal(deviceValueText(simCharMeta("ProgrammableSwitchEvent"), "ProgrammableSwitchEvent", "DOUBLE_PRESS"), "Двойное");
  assert.equal(deviceValueText(simCharMeta("ContactSensorState"), "ContactSensorState", "CONTACT_NOT_DETECTED"), "Открыто");
  assert.equal(deviceValueText(simCharMeta("On"), "On", null), "—");
});

// ——— нажатия ———————————————————————————————————————————————————————

// Часы и таймеры тесту: время движется, только когда он сам скажет.
function presserRig() {
  let now = 1000;
  const timers = new Map();
  let next = 1;
  const fired = [];
  const presser = deviceKeyPresser({
    fire: (press) => fired.push([press, now]),
    now: () => now,
    later: (fn, ms) => {
      timers.set(next, { fn, at: now + ms });
      return next++;
    },
    clear: (id) => timers.delete(id),
  });
  return {
    presser,
    fired,
    at: () => now,
    wait(ms) {
      const end = now + ms;
      for (;;) {
        const due = [...timers].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        timers.delete(due[0]);
        now = Math.max(now, due[1].at);
        due[1].fn();
      }
      now = end;
    },
  };
}

test("одиночное приходит, когда истекло окно двойного, и не раньше", () => {
  const rig = presserRig();
  rig.presser.down();
  rig.wait(80);
  rig.presser.up();
  rig.wait(PRESS_DOUBLE_MS - 20);
  assert.deepEqual(rig.fired, [], "окно двойного ещё открыто");
  rig.wait(40);
  assert.deepEqual(
    rig.fired.map((item) => item[0]),
    ["single"],
  );
  assert.equal(rig.fired[0][1], 1000 + 80 + PRESS_DOUBLE_MS, "одиночное пришло не в миг, когда истекло окно двойного");
});

test("двойное — на втором нажатии, одиночное при этом не уходит", () => {
  const rig = presserRig();
  rig.presser.down();
  rig.wait(60);
  rig.presser.up();
  rig.wait(120);
  rig.presser.down();
  rig.wait(60);
  rig.presser.up();
  rig.wait(PRESS_DOUBLE_MS + 100);
  assert.deepEqual(
    rig.fired.map((item) => item[0]),
    ["double"],
  );
});

test("долгое приходит в порог, пока клавиша ещё зажата; отпускание ничего не добавляет", () => {
  const rig = presserRig();
  rig.presser.down();
  rig.wait(PRESS_LONG_MS - 1);
  assert.deepEqual(rig.fired, []);
  rig.wait(2);
  assert.deepEqual(
    rig.fired.map((item) => item[0]),
    ["long"],
  );
  assert.equal(rig.fired[0][1], 1000 + PRESS_LONG_MS, "долгое пришло не в порог");
  rig.presser.up();
  rig.wait(PRESS_DOUBLE_MS + 100);
  assert.equal(rig.fired.length, 1);
  assert.equal(rig.presser.idle(), true);
});

test("жест оказался панорамой: начатое нажатие брошено — ни долгого, ни одиночного", () => {
  const rig = presserRig();
  rig.presser.down();
  rig.wait(100);
  rig.presser.abort();
  rig.wait(PRESS_LONG_MS + PRESS_DOUBLE_MS);
  assert.deepEqual(rig.fired, []);
  assert.equal(rig.presser.idle(), true);
});

// ——— раздел «Логика» (таск 12 сценариев; история 5.7) ——————————————————

test("модель карточки: раздел «Логика» — привязки метки и подходящие сервису сценарии", async () => {
  const { addScenario, addLogicBinding } = await import("../src/model.js");
  const source = 'info = {name: "Свет", sourceServices: [HS.Lightbulb], sourceCharacteristics: [HC.On], options: {delay: {name: "Пауза", type: "Integer", value: 5, minValue: 1, maxValue: 60}}};\nfunction trigger(){}\n';
  const added = addScenario(box.project, { kind: "logic", name: "Свет", source });
  const bound = addLogicBinding(added.project, { scenarioId: added.scenario.id, markId: box.marks.С1, service: 0, options: { delay: 9 } });
  const form = { name: "Свет", description: "", fields: [{ key: "delay", type: "Integer", formType: null, label: "Пауза", value: 9, min: 1, max: 60 }], sourceServices: ["Lightbulb"], sourceCharacteristics: ["On"] };
  const reader = (bindingId) => ({ form, fault: bindingId ? { code: "hung", line: null, message: "" } : null });
  const lamp = deviceCardModel(bound.project, box.marks.С1, null, reader).logic;
  assert.equal(lamp.bindings.length, 1);
  assert.equal(lamp.bindings[0].fields[0].value, 9);
  assert.equal(lamp.bindings[0].fault.code, "hung");
  assert.deepEqual(lamp.available.map((item) => item.scenarioId), [added.scenario.id]);
  // Датчик движения сервису «Лампочка» не подходит: раздел пуст.
  const sensor = deviceCardModel(bound.project, box.marks.ДД1, null, reader).logic;
  assert.deepEqual(sensor.bindings, []);
  assert.deepEqual(sensor.available, []);
});

// ——— общие на «Схему», мини-план и «Объём» (ревью ветки, F1) ———————————————

test("вид знака по объекту: свет, штора, ТВ, розетка, прочее — с помещением метки; один ответ на объект", () => {
  const kinds = deviceLiveKinds(box.project);
  assert.equal(kinds.get(box.marks.С1).kind, "light");
  assert.equal(kinds.get(box.marks.КШ1).kind, "curtain");
  assert.equal(kinds.get(box.marks.ТВ1).kind, "tv");
  assert.equal(kinds.get(box.marks.Р1).kind, "outlet");
  assert.equal(kinds.get(box.marks.ДД1).kind, "other");
  assert.equal(kinds.get(box.marks.С1).roomId, box.rooms.hall);
  assert.equal(kinds.get(box.marks.ДД2).roomId, null, "датчик без помещения");
  assert.equal(deviceLiveKinds(box.project), kinds, "тот же объект — та же карта");
  const moved = updateMark(box.project, box.marks.С1, { points: [{ x: 0.26, y: 0.3 }] }).project;
  assert.notEqual(deviceLiveKinds(moved), kinds, "правка объекта — новая карта");
  assert.equal(deviceLiveKinds(null).size, 0);
});

test("распознаватели нажатий: один на клавишу «метка|сервис» — и у мыши, и у пальца, и у E", () => {
  const fired = [];
  const registry = devicePressers({
    fire: (markId, index, press) => fired.push([markId, index, press]),
    now: () => 0,
    later: () => 1,
    clear: () => {},
  });
  const first = registry.of("m1", 3);
  assert.equal(registry.of("m1", 3), first, "второй раз — тот же распознаватель");
  assert.notEqual(registry.of("m1", 4), first);
  assert.notEqual(registry.of("m2", 3), first);
  // Общий распознаватель сеанса — тоже один на клавишу.
  assert.equal(devicePresserOf("общий", 1), devicePresserOf("общий", 1));
  assert.notEqual(devicePresserOf("общий", 1), devicePresserOf("общий", 2));
});
