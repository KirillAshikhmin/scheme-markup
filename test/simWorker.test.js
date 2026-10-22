// Вход потока имитации (таск 07 сценариев): `simWorkerMain(scope)` на
// заглушке `scope` — протокол страница ↔ Worker (`interfaces.md`, «Протокол»),
// время по часам приложения, подсказки сторожу (`trace`) перед кодом
// сценариев. Истории 2.3, 3.2–3.4, 5.4; движок и хозяева — свои тесты.
import test from "node:test";
import assert from "node:assert/strict";

import { clockMsStamp, volumeClockFixed } from "../src/clockMath.js";
import { addLogicBinding, addScenario } from "../src/model.js";
import { buildHomeSpec, markAccessory } from "../src/sim/home.js";
import { simWorkerMain } from "../src/sim/worker.js";
import { simHouse } from "./fixtures/simHome.js";

// Полдень пятницы 23 октября 2026 года в местных миллисекундах имитации.
const T0 = Date.UTC(2026, 9, 23, 12, 0, 0);

// ——— заглушка потока ———————————————————————————————————————————————————————

function stubScope({ now = () => 0 } = {}) {
  const sent = [];
  const timers = [];
  let listener = null;
  const scope = {
    postMessage: (message) => sent.push(structuredClone(message)),
    addEventListener: (type, fn) => {
      if (type === "message") listener = fn;
    },
    setTimeout: (fn, ms) => {
      timers.push({ fn, ms });
      return timers.length;
    },
    clearTimeout: (id) => {
      if (timers[id - 1]) timers[id - 1].fn = null;
    },
    now,
  };
  simWorkerMain(scope);
  return {
    sent,
    timers,
    send: (message) => listener({ data: structuredClone(message) }),
    of: (type) => sent.filter((message) => message.type === type),
    log: () => sent.filter((message) => message.type === "log").flatMap((message) => message.entries),
    changes: () => sent.filter((message) => message.type === "changes" && message.live).flatMap((message) => message.list),
    clear: () => {
      sent.length = 0;
    },
  };
}

function fixedAt(simMs) {
  const { day, minutes } = clockMsStamp(simMs);
  return volumeClockFixed(minutes, 60, day);
}

// ——— блоки ———————————————————————————————————————————————————————————————————

let seq = 0;
const nid = (prefix) => prefix + (seq += 1);
const ref = (markId, char, service = 0) => ({ markId, service, char });
const trig = (at, op, value) => ({ type: "device", id: nid("c"), ref: at, op, value, trigger: true });
const when = (conditions, then) => ({ type: "if", id: nid("if"), if: { type: "group", id: nid("g"), mode: "OR", conditions }, then, else: null, every: null });
const put = (at, value) => ({ type: "device", id: nid("a"), ref: { markId: at.markId, service: at.service }, items: [{ char: at.char, verb: "set", value }] });
const delay = (sec, blocks) => ({ type: "delay", id: nid("d"), no: 1, sec, timer: "one", blocks });

// Отвязанная клавиша В2 одиночным нажатием включает С3 (и, если `off`, через минуту гасит).
function pressScenario(box, { off = false } = {}) {
  const id = (label) => box.marks[label];
  const then = [put(ref(id("С3"), "On"), true)];
  if (off) then.push(delay(60, [put(ref(id("С3"), "On"), false)]));
  box.project = addScenario(box.project, {
    kind: "block",
    name: "Клавиша → свет",
    targets: [when([trig(ref(id("В2"), "ProgrammableSwitchEvent"), "eq", "SINGLE_PRESS")], then)],
  }).project;
}

function specOf(box) {
  return { ...buildHomeSpec(box.project), site: null, rooms: [] };
}

function boot(box, { clock = fixedAt(T0), now } = {}) {
  const worker = stubScope({ now });
  worker.send({ type: "clock", clock });
  worker.send({ type: "load", spec: specOf(box) });
  return worker;
}

// ——— протокол ————————————————————————————————————————————————————————————————

test("ping → pong с тем же номером, даже до загрузки дома", () => {
  const worker = stubScope();
  worker.send({ type: "ping", n: 7 });
  assert.deepEqual(worker.sent, [{ type: "pong", n: 7 }]);
});

test("load → start → act: изменения, журнал и сценарии по протоколу", () => {
  const box = simHouse();
  pressScenario(box);
  const worker = boot(box);
  assert.ok(worker.of("scenarios").length > 0, "после загрузки нет списка сценариев");
  worker.send({ type: "start", values: {} });
  assert.ok(worker.log().some((entry) => entry.code === "started"), "нет «Дом запущен»");
  worker.clear();
  worker.send({ type: "act", action: { kind: "press", markId: box.marks["В2"], service: 0, press: "single" } });
  const lit = worker.changes().find((change) => change.markId === box.marks["С3"] && change.char === "On");
  assert.equal(lit && lit.value, true, "сценарий не включил свет");
  assert.ok(worker.log().some((entry) => entry.code === "blockRun"), "журнал без запуска сценария");
  const pressed = worker.changes().find((change) => change.markId === box.marks["В2"]);
  assert.equal(pressed.event, true);
  assert.equal(pressed.at, T0);
});

test("пока дом остановлен, изменения потока помечены live: false — правда в зеркале страницы", () => {
  const box = simHouse();
  const worker = stubScope();
  worker.send({ type: "load", spec: specOf(box) });
  const loaded = worker.of("changes");
  assert.ok(loaded.length > 0);
  assert.ok(loaded.every((message) => message.live === false));
  worker.send({ type: "start", values: { [box.marks["С1"]]: { "0.On": true } } });
  const started = worker.of("changes").at(-1);
  assert.equal(started.live, true);
  assert.deepEqual(
    started.list.filter((change) => change.markId === box.marks["С1"]).map((change) => [change.char, change.value]),
    [["On", true]],
  );
});

test("start {restore: true} поднимает дом без «Дом запущен» — это перезапуск потока, не человек", () => {
  const box = simHouse();
  const worker = boot(box);
  worker.send({ type: "start", values: {}, restore: true });
  assert.equal(worker.log().some((entry) => entry.code === "started"), false);
  worker.send({ type: "stop" });
  worker.send({ type: "start", values: {} });
  assert.ok(worker.log().some((entry) => entry.code === "started"));
});

test("advance: событие ровно на границе шага срабатывает, раньше — нет", () => {
  const box = simHouse();
  pressScenario(box, { off: true });
  const worker = boot(box);
  worker.send({ type: "start", values: {} });
  worker.send({ type: "act", action: { kind: "press", markId: box.marks["В2"], service: 0, press: "single" } });
  const light = () => worker.changes().filter((change) => change.markId === box.marks["С3"] && change.char === "On").at(-1).value;
  assert.equal(light(), true);
  assert.deepEqual(worker.of("next").at(-1), { type: "next", at: T0 + 60000 });
  worker.send({ type: "advance", toMs: T0 + 59999 });
  assert.equal(light(), true, "задержка сработала раньше времени");
  worker.send({ type: "advance", toMs: T0 + 60000 });
  assert.equal(light(), false, "задержка не сработала на границе шага");
  assert.deepEqual(worker.of("next").at(-1), { type: "next", at: null });
  // Назад шаг ничего не двигает.
  worker.send({ type: "advance", toMs: T0 });
  worker.send({ type: "next" });
  assert.deepEqual(worker.of("next").at(-1), { type: "next", at: null });
});

test("clock: часы назад ничего не запускают, идущие часы будят поток к ближайшему событию", () => {
  const box = simHouse();
  pressScenario(box, { off: true });
  let real = 1000;
  const { day, minutes } = clockMsStamp(T0);
  const running = { fixed: false, fromDay: day, fromMin: minutes, atMs: real, speed: 60 };
  const worker = boot(box, { clock: running, now: () => real });
  worker.send({ type: "start", values: {} });
  worker.send({ type: "act", action: { kind: "press", markId: box.marks["В2"], service: 0, press: "single" } });
  // Минута имитации при ×60 — секунда настоящего времени; дольше секунды поток не спит.
  const wake = worker.timers.filter((timer) => timer.fn).at(-1);
  assert.equal(wake.ms, 1000);
  real += 1000;
  wake.fn();
  const light = () => worker.changes().filter((change) => change.markId === box.marks["С3"] && change.char === "On").at(-1).value;
  assert.equal(light(), false, "поток не догнал часы по пробуждению");

  // Перевод назад: ничего не срабатывает.
  worker.send({ type: "act", action: { kind: "press", markId: box.marks["В2"], service: 0, press: "single" } });
  assert.equal(light(), true);
  worker.clear();
  worker.send({ type: "clock", clock: fixedAt(T0 - 3600000) });
  assert.equal(worker.changes().length, 0, "перевод назад что-то запустил");
});

test("неизвестное действие не роняет поток: запись workerError, дальше работает", () => {
  const box = simHouse();
  const worker = boot(box);
  worker.send({ type: "start", values: {} });
  worker.send({ type: "act", action: { kind: "щелчок" } });
  const failed = worker.log().find((entry) => entry.code === "workerError");
  assert.ok(failed, "нет записи об ошибке");
  assert.equal(failed.kind, "error");
  assert.match(failed.vars.message, /unknown action/);
  worker.send({ type: "act", action: { kind: "toggle", markId: box.marks["С1"] } });
  assert.ok(worker.changes().some((change) => change.markId === box.marks["С1"] && change.value === true));
});

// ——— подсказки сторожу ——————————————————————————————————————————————————————

function onSource(box, label) {
  const char = markAccessory(box.project, box.marks[label]).services[0].chars.find((item) => item.type === "On");
  return "Hub.getCharacteristic(" + char.address.split(".")[0] + ", " + char.cid + ")";
}

function logic(name, body) {
  return [
    "info = {",
    "  name: " + JSON.stringify(name) + ",",
    "  sourceServices: [HS.StatelessProgrammableSwitch],",
    "  sourceCharacteristics: [HC.ProgrammableSwitchEvent],",
    "  options: {},",
    "  variables: {}",
    "};",
    "function trigger(source, value, variables, options, context) {",
    body,
    "}",
  ].join("\n");
}

function withScript(box, kind, name, source) {
  const added = addScenario(box.project, { kind, name, source });
  box.project = added.project;
  return added.scenario.id;
}

function bind(box, scenarioId, label) {
  const added = addLogicBinding(box.project, { scenarioId, markId: box.marks[label], service: 0, options: {}, active: true });
  box.project = added.project;
  return added.binding.id;
}

test("trace: перед trigger поток называет сценарий и привязку, после кода — пустой trace", () => {
  const box = simHouse();
  const scenarioId = withScript(box, "logic", "Свет по клавише", logic("Свет по клавише", "  " + onSource(box, "С1") + ".setValue(true);"));
  const bindingId = bind(box, scenarioId, "В2");
  const worker = boot(box);
  worker.send({ type: "start", values: {} });
  worker.clear();
  worker.send({ type: "act", action: { kind: "press", markId: box.marks["В2"], service: 0, press: "single" } });
  const traces = worker.of("trace");
  const named = worker.sent.findIndex((message) => message.type === "trace" && message.where === "trigger");
  assert.ok(named >= 0, "нет подсказки перед trigger");
  assert.deepEqual(worker.sent[named], { type: "trace", where: "trigger", scenarioId, bindingId });
  // Подсказка ушла раньше, чем пачка изменений этого действия.
  assert.ok(named < worker.sent.findIndex((message) => message.type === "changes"));
  assert.deepEqual(traces.at(-1), { type: "trace" });
  assert.ok(worker.changes().some((change) => change.markId === box.marks["С1"] && change.value === true));
});

test("trace: верхний уровень скриптов при запуске — список возможных виновников в порядке исполнения", () => {
  const box = simHouse();
  const logicId = withScript(box, "logic", "Логика", logic("Логика", ""));
  const globalId = withScript(box, "global", "Утилиты", "global.helper = function () { return 1; };");
  const worker = boot(box);
  const loaded = worker.of("trace").find((message) => message.where === "load");
  assert.deepEqual(loaded, { type: "trace", where: "load", candidates: [globalId, logicId] });
  worker.clear();
  worker.send({ type: "start", values: {} });
  assert.deepEqual(worker.of("trace")[0], { type: "trace", where: "start", candidates: [globalId, logicId] });
});

test("trace: таймер скрипта знает свой сценарий", () => {
  const box = simHouse();
  const body = "  setTimeout(function () { " + onSource(box, "С1") + ".setValue(true); }, 60000);";
  const scenarioId = withScript(box, "logic", "Потом", logic("Потом", body));
  bind(box, scenarioId, "В2");
  const worker = boot(box);
  worker.send({ type: "start", values: {} });
  worker.send({ type: "act", action: { kind: "press", markId: box.marks["В2"], service: 0, press: "single" } });
  worker.clear();
  worker.send({ type: "advance", toMs: T0 + 60000 });
  assert.deepEqual(worker.of("trace")[0], { type: "trace", where: "timer", scenarioId });
  assert.ok(worker.changes().some((change) => change.markId === box.marks["С1"] && change.value === true));
});

test("trace: блок-код блочного сценария — его сценарий", () => {
  const box = simHouse();
  const added = addScenario(box.project, { kind: "block", name: "Код", targets: [{ type: "code", id: "k1", code: "return 1;" }] });
  box.project = added.project;
  const worker = boot(box);
  worker.send({ type: "start", values: {} });
  worker.clear();
  worker.send({ type: "run", scenarioId: added.scenario.id });
  assert.deepEqual(worker.of("trace")[0], { type: "trace", where: "code", scenarioId: added.scenario.id });
  assert.deepEqual(worker.of("trace").at(-1), { type: "trace" });
});

test("active: выключенный на ходу логический сценарий не отвечает на нажатие", () => {
  const box = simHouse();
  const scenarioId = withScript(box, "logic", "Свет", logic("Свет", "  " + onSource(box, "С1") + ".setValue(true);"));
  bind(box, scenarioId, "В2");
  const worker = boot(box);
  worker.send({ type: "start", values: {} });
  worker.send({ type: "active", scenarioId, on: false });
  worker.clear();
  worker.send({ type: "act", action: { kind: "press", markId: box.marks["В2"], service: 0, press: "single" } });
  assert.equal(worker.changes().some((change) => change.markId === box.marks["С1"]), false);
  const listed = worker.of("scenarios").at(-1);
  assert.equal(listed === undefined || listed.list.find((item) => item.id === scenarioId).active === false, true);
});

test("trace: compute привязки — до записи поток называет её; привязки без compute не называются", () => {
  const box = simHouse();
  const source = [
    "info = {",
    '  name: "Яркость",',
    "  sourceServices: [HS.Lightbulb],",
    "  sourceCharacteristics: [HC.On],",
    "  options: {},",
    "  variables: {}",
    "};",
    "function trigger(source, value, variables, options, context) {}",
    "function compute(source, value, variables, options, context) { return value; }",
  ].join("\n");
  const scenarioId = withScript(box, "logic", "Яркость", source);
  const bindingId = bind(box, scenarioId, "С1");
  const plain = withScript(box, "logic", "Без compute", logic("Без compute", ""));
  bind(box, plain, "В2");
  const worker = boot(box);
  worker.send({ type: "start", values: {} });
  worker.clear();
  worker.send({ type: "act", action: { kind: "toggle", markId: box.marks["С1"] } });
  assert.deepEqual(worker.of("trace")[0], { type: "trace", where: "compute", scenarioId, bindingId });
  worker.clear();
  worker.send({ type: "act", action: { kind: "press", markId: box.marks["В2"], service: 0, press: "single" } });
  assert.equal(worker.of("trace").some((message) => message.where === "compute"), false);
});
