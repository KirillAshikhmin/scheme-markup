// Реальные сценарии Sprut.Hub_Tools на доме-фикстуре (таск 06 сценариев,
// история 5.12): SwitchCallbackControl (логический + глобальный),
// HideIfTurnOn, MotionLightAutomation. Копии исходников и их «домов»
// `.tests/preset.json` лежат в `test/fixtures/sprut/`; поведение проверяется
// так, как его проверяют `.tests` самих сценариев, но на доме объекта:
// устройства — метки фикстуры, адреса — `aid.sid` их аксессуаров.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { addType } from "../src/model.js";
import { hubScriptRead } from "../src/sim/hubApi.js";
import { simHouse, simPut } from "./fixtures/simHome.js";
import { MIN, SEC, T0, hubHome } from "./fixtures/sprut/hubHome.js";

const SPRUT = new URL("./fixtures/sprut/", import.meta.url);

function sprut(name) {
  const read = hubScriptRead(readFileSync(new URL(name, SPRUT), "utf8"), name);
  assert.equal(read.error, undefined, name + ": " + read.error);
  assert.equal(read.syntax, null, name + ": синтаксис");
  return read;
}

function preset(name) {
  return JSON.parse(readFileSync(new URL(name, SPRUT), "utf8"));
}

function noErrors(home) {
  const errors = home.recorder.log().filter((entry) => entry.code === "hubError" || entry.code === "hubSyntax");
  assert.deepEqual(errors.map((entry) => entry.vars), []);
}

// ——— SwitchCallbackControl ————————————————————————————————————————————————

// Как в preset.json: три обычных выключателя (реле `Switch.On`) в трёх комнатах.
function callbackHome() {
  const box = simHouse();
  const rooms = preset("SwitchCallbackControl.preset.json").accessories.length;
  assert.equal(rooms, 3);
  simPut(box, "ОВ", { x: 0.26, y: 0.4 }, "hall");
  simPut(box, "ОВ", { x: 0.5, y: 0.4 }, "living");
  simPut(box, "ОВ", { x: 0.8, y: 0.4 }, "bedroom");
  const global = sprut("SwitchCallbackControl.Global.json");
  const logic = sprut("SwitchCallbackControl.Logic.js");
  assert.equal(global.kind, "global");
  assert.equal(global.origin, "json");
  assert.equal(logic.kind, "logic");
  const home = hubHome({
    box,
    scripts: [
      { key: "g", kind: "global", name: global.template.name, source: global.source },
      { key: "l", kind: "logic", source: logic.source },
    ],
    bindings: ["ОВ1", "ОВ2", "ОВ3"].map((mark) => ({ script: "l", mark })),
  });
  return home;
}

test("SwitchCallbackControl: глобальный заводит реестр и выставляет fire/broadcast/unregister в global", () => {
  const home = callbackHome();
  assert.equal(
    home.code(
      "var gv = GlobalVariables.SwitchCallbackControl_Callbacks; return [typeof gv, typeof gv.handlers, typeof global.switchCallbackControlFire, typeof global.switchCallbackControlBroadcast, typeof global.switchCallbackControlUnregister].join(',')",
    ).value,
    "object,object,function,function,function",
  );
  noErrors(home);
});

test("SwitchCallbackControl: onStart логического регистрирует handler по UUID сервиса каждой привязки", () => {
  const home = callbackHome();
  const keys = home.code("return Object.keys(GlobalVariables.SwitchCallbackControl_Callbacks.handlers).sort()").value;
  assert.deepEqual(keys, [home.address("ОВ1"), home.address("ОВ2"), home.address("ОВ3")].sort());
  noErrors(home);
});

test("SwitchCallbackControl: fire по UUID включает и выключает реле; broadcast переключает все", () => {
  const home = callbackHome();
  const fire = (mark, action, data) =>
    home.code("return global.switchCallbackControlFire(" + JSON.stringify(home.address(mark)) + ", " + JSON.stringify(action) + ", " + JSON.stringify(data || {}) + ")").value;
  assert.equal(fire("ОВ1", "on"), true);
  assert.equal(home.value("ОВ1", "On"), true);
  assert.equal(home.value("ОВ2", "On"), false);
  // Уже включено — setValue не вызывается: изменения нет.
  home.recorder.clear();
  assert.equal(fire("ОВ1", "on"), true);
  assert.deepEqual(home.recorder.log().filter((entry) => entry.kind === "change"), []);
  assert.equal(fire("ОВ1", "set", { on: false }), true);
  assert.equal(home.value("ОВ1", "On"), false);
  assert.equal(fire("ОВ2", "toggle"), true);
  assert.equal(home.value("ОВ2", "On"), true);
  assert.equal(home.code("return global.switchCallbackControlBroadcast('toggle', {})").value, 3);
  assert.deepEqual(["ОВ1", "ОВ2", "ОВ3"].map((mark) => home.value(mark, "On")), [true, false, true]);
  // Каждое изменение реле после сброса журнала зовёт trigger логического: 1 + 1 + 3.
  assert.equal(home.log("hubTrigger").length, 5);
  noErrors(home);
});

test("SwitchCallbackControl на настенных выключателях (G11): fire ставит «Выключатель» клавиши, свет канала следует за ним", () => {
  // Выключатели фикстуры с профилем G11: сервис 0 у В1 и 0, 1 у ВВ1 —
  // «Выключатели» (`Switch.On`), к ним логика и привязывается.
  const global = sprut("SwitchCallbackControl.Global.json");
  const logic = sprut("SwitchCallbackControl.Logic.js");
  const home = hubHome({
    scripts: [
      { key: "g", kind: "global", name: global.template.name, source: global.source },
      { key: "l", kind: "logic", source: logic.source },
    ],
    bindings: [
      { key: "hall", script: "l", mark: "В1", service: 0 },
      { key: "duo", script: "l", mark: "ВВ1", service: 1 },
    ],
  });
  const fire = (mark, service, action) =>
    home.code("return global.switchCallbackControlFire(" + JSON.stringify(home.address(mark, service)) + ", " + JSON.stringify(action) + ", {})").value;
  assert.equal(home.accessory("В1").services[0].type, "Switch");
  assert.equal(fire("В1", 0, "on"), true);
  assert.equal(home.value("В1", "On", 0), true);
  assert.equal(home.value("С1", "On"), true, "свет не пошёл за «Выключателем», включённым логикой");
  assert.equal(fire("ВВ1", 1, "toggle"), true);
  assert.equal(home.value("КШ1", "TargetPosition"), 100, "штора второй клавиши не поехала");
  assert.equal(home.value("С2", "On"), false, "вторая клавиша тронула первый канал");
  assert.equal(fire("В1", 0, "off"), true);
  assert.equal(home.value("С1", "On"), false);
  noErrors(home);
});

test("SwitchCallbackControl: мёртвый ключ «aid.sid» вычищается; ошибка handler — в журнал, fire — false", () => {
  const home = callbackHome();
  assert.equal(
    home.code(
      "var gv = GlobalVariables.SwitchCallbackControl_Callbacks; gv.handlers['99999.1'] = function () {}; var r = global.switchCallbackControlFire('99999.1', 'on', {}); return [r, typeof gv.handlers['99999.1']].join(',')",
    ).value,
    "false,undefined",
  );
  assert.equal(
    home.code("GlobalVariables.SwitchCallbackControl_Callbacks.handlers['a'] = function () { throw new Error('boom'); }; return global.switchCallbackControlFire('a', 'on', {})").value,
    false,
  );
  const logged = home.log("hubLog").filter((entry) => entry.vars.level === "error");
  assert.equal(logged.length, 1);
  assert.equal(logged[0].kind, "error");
  assert.match(logged[0].vars.message, /\[SwitchCallbackControl\] a: boom/);
  home.code("global.switchCallbackControlUnregister('a')");
  assert.equal(home.code("return global.switchCallbackControlFire('a', 'on', {})").value, false);
});

// ——— HideIfTurnOn ———————————————————————————————————————————————————————

function visibleOf(home, mark) {
  const accessory = home.accessory(mark);
  return home.code("return Hub.getAccessory(" + accessory.aid + ").getService(" + accessory.services[0].sid + ").isVisible()").value;
}

test("HideIfTurnOn: выключенное скрыто с запуска, включённое видно — свет, ТВ, дверь, штора", () => {
  const read = sprut("HideIfTurnOn.json");
  assert.equal(read.kind, "logic");
  assert.equal(read.template.onStart, true);
  const marks = ["С1", "ТВ1", "ДО1", "КШ1"];
  const home = hubHome({ scripts: [{ key: "h", name: read.template.name, source: read.source }], bindings: marks.map((mark) => ({ script: "h", mark })) });
  assert.deepEqual(marks.map((mark) => visibleOf(home, mark)), [false, false, false, false]);
  home.set("С1", "On", true);
  home.engine.act({ kind: "toggle", markId: home.id("ТВ1") });
  home.engine.act({ kind: "door", openingId: home.box.doors.front, open: true });
  home.set("КШ1", "TargetPosition", 100);
  assert.deepEqual(marks.map((mark) => visibleOf(home, mark)), [true, true, true, false], "штора ещё едет");
  home.engine.advanceTo(T0 + 20 * SEC);
  assert.equal(home.value("КШ1", "CurrentPosition"), 100);
  assert.equal(visibleOf(home, "КШ1"), true);
  home.set("С1", "On", false);
  assert.equal(visibleOf(home, "С1"), false);
  const shown = home.log("hubVisible").map((entry) => [entry.vars.label, entry.vars.visible]);
  assert.deepEqual(shown.slice(0, 4), [["С1", false], ["ТВ1", false], ["ДО1", false], ["КШ1", false]]);
  assert.deepEqual(shown.at(-1), ["С1", false]);
  noErrors(home);
});

test("HideIfTurnOn: исходник .js и экспорт JSON — один и тот же логический сценарий", () => {
  const js = sprut("HideIfTurnOn.js");
  const json = sprut("HideIfTurnOn.json");
  assert.equal(js.kind, "logic");
  assert.equal(json.source.trim(), js.source.trim());
});

// ——— MotionLightAutomation ——————————————————————————————————————————————

// Как в preset.json: кухня с лампой (привязка), датчиком движения, датчиком
// освещённости, настенным выключателем и датчиком открытия двери. На доме
// фикстуры это коридор: С1, ДД1, ДО1; датчик освещённости — свой тип,
// настенный выключатель — реле ОВ1; отвязанная клавиша В2 — кнопка.
function motion(overrides = {}, { lux } = {}) {
  const box = simHouse();
  const base = box.project.markTypes.find((type) => type.code === "ДД");
  box.project = addType(box.project, { code: "ДОС", name: "Датчик освещённости", categoryId: base.categoryId, device: { kind: "lightSensor" } }).project;
  simPut(box, "ДОС", { x: 0.31, y: 0.32 }, "hall");
  simPut(box, "ОВ", { x: 0.26, y: 0.36 }, "hall");
  const read = sprut("MotionLightAutomation.js");
  const probe = hubHome({ box: { ...box }, start: false });
  const options = { ...preset("MotionLightAutomation.preset.json").options };
  for (const [key, value] of Object.entries(overrides)) {
    options[key] = typeof value === "string" && value.startsWith("@") ? probe.address(value.slice(1)) : value;
  }
  const home = hubHome({ box, scripts: [{ key: "m", source: read.source }], bindings: [{ script: "m", mark: "С1", options }], start: false });
  if (lux !== undefined) home.engine.start({ [home.id("ДОС1")]: { "0.CurrentAmbientLightLevel": lux } });
  else home.engine.start();
  return home;
}


test("MotionLightAutomation: движение включает лампу; спад движения и задержка выключения — гасят", () => {
  const home = motion({ motion1: "@ДД1" });
  assert.equal(home.value("С1", "On"), false);
  home.engine.act({ kind: "sensor", markId: home.id("ДД1") });
  assert.equal(home.value("С1", "On"), true, "лампа не включилась по движению");
  // Датчик сбрасывается через 60 с, лампа гаснет ещё через 30 с (offDelaySeconds).
  home.engine.advanceTo(T0 + 60 * SEC);
  assert.equal(home.value("ДД1", "MotionDetected"), false);
  home.engine.advanceTo(T0 + 89 * SEC);
  assert.equal(home.value("С1", "On"), true);
  home.engine.advanceTo(T0 + 90 * SEC);
  assert.equal(home.value("С1", "On"), false, "лампа не погасла после задержки");
  noErrors(home);
});

test("MotionLightAutomation: своё включение — эхо, не ручное удержание (иначе свет не гас бы)", () => {
  // С «не гасить после ручного включения» эхо, принятое за внешнее включение,
  // поставило бы ручное удержание на 4 часа.
  const home = motion({ motion1: "@ДД1", noAutoOffWhenManualOn: true });
  home.engine.act({ kind: "sensor", markId: home.id("ДД1") });
  assert.equal(home.value("С1", "On"), true);
  const triggers = home.log("hubTrigger");
  assert.equal(triggers.length, 2, "onStart и эхо включения");
  assert.deepEqual(triggers[1].chain.map((cause) => cause.k), ["logic", "char", "logic", "char", "web"]);
  home.engine.advanceTo(T0 + 90 * SEC);
  assert.equal(home.value("С1", "On"), false);
  noErrors(home);
});

test("MotionLightAutomation: повторное движение отменяет выключение", () => {
  const home = motion({ motion1: "@ДД1" });
  home.engine.act({ kind: "sensor", markId: home.id("ДД1") });
  home.engine.advanceTo(T0 + 75 * SEC);
  home.engine.act({ kind: "sensor", markId: home.id("ДД1") });
  home.engine.advanceTo(T0 + 100 * SEC);
  assert.equal(home.value("С1", "On"), true, "таймер выключения не отменился");
  home.engine.advanceTo(T0 + 75 * SEC + 90 * SEC);
  assert.equal(home.value("С1", "On"), false);
});

test("MotionLightAutomation: кнопка переключает свет; 5 с после включения по датчику — игнорируется", () => {
  const home = motion({ motion1: "@ДД1", manualControl1: "@В2" });
  const press = () => home.engine.act({ kind: "press", markId: home.id("В2"), press: "single" });
  home.engine.act({ kind: "sensor", markId: home.id("ДД1") });
  assert.equal(home.value("С1", "On"), true);
  home.engine.advanceTo(T0 + 3 * SEC);
  press();
  assert.equal(home.value("С1", "On"), true, "антидребезг 5 с не сработал");
  home.engine.advanceTo(T0 + 6 * SEC);
  press();
  assert.equal(home.value("С1", "On"), false, "кнопка не погасила свет");
  press();
  assert.equal(home.value("С1", "On"), true, "кнопка не включила свет");
  noErrors(home);
});

test("MotionLightAutomation: настенный выключатель держит свет; освещённость выше порога — без автовключения", () => {
  const home = motion({ motion1: "@ДД1", manualControl1: "@ОВ1", luxSensor: "@ДОС1" }, { lux: 300 });
  home.engine.act({ kind: "sensor", markId: home.id("ДД1") });
  assert.equal(home.value("С1", "On"), false, "светло (300 лк > 50) — включаться не должна");
  home.set("ДОС1", "CurrentAmbientLightLevel", 15);
  assert.equal(home.value("С1", "On"), true, "стемнело при движении — должна включиться");
  home.engine.advanceTo(T0 + 30 * MIN);
  assert.equal(home.value("С1", "On"), false);
  home.set("ОВ1", "On", true);
  assert.equal(home.value("С1", "On"), true, "лампа не следует за выключателем");
  home.engine.advanceTo(T0 + 60 * MIN);
  assert.equal(home.value("С1", "On"), true, "пока выключатель в On, свет не гаснет");
  home.set("ОВ1", "On", false);
  assert.equal(home.value("С1", "On"), false);
  noErrors(home);
});

test("MotionLightAutomation: дверь как датчик активности — «Открыто» включает свет", () => {
  const home = motion({ motion1: "@ДО1" });
  home.engine.act({ kind: "door", openingId: home.box.doors.front, open: true });
  assert.equal(home.value("ДО1", "ContactSensorState"), "CONTACT_NOT_DETECTED");
  assert.equal(home.value("С1", "On"), true);
  home.engine.act({ kind: "door", openingId: home.box.doors.front, open: false });
  home.engine.advanceTo(T0 + 30 * SEC);
  assert.equal(home.value("С1", "On"), false);
  noErrors(home);
});

test("MotionLightAutomation: списки устройств в опциях строит скрипт на доме объекта", () => {
  const home = motion();
  const form = home.forms().find((message) => message.bindingId === null).form;
  assert.equal(form.name, "💡 Автоматизация света по движению");
  const motionField = form.fields.find((field) => field.key === "motion1");
  const values = motionField.values.map((item) => item.value);
  assert.equal(values[0], "");
  assert.deepEqual(
    values.slice(1).sort(),
    [home.address("ДД1"), home.address("ДД2"), home.address("ДП1"), home.address("ДО1")].sort(),
  );
  const label = motionField.values.find((item) => item.value === home.address("ДД1")).label;
  assert.equal(label, "Коридор -> ДД1 (" + home.address("ДД1") + ")");
  const manual = form.fields.find((field) => field.key === "manualControl1").values.map((item) => item.value);
  assert.ok(manual.includes(home.address("ОВ1")) && manual.includes(home.address("В2")));
  const lux = form.fields.find((field) => field.key === "luxSensor").values.map((item) => item.value);
  assert.deepEqual(lux, ["", home.address("ДОС1")]);
  assert.deepEqual(form.fields.find((field) => field.key === "offDelaySeconds").value, 30);
});
