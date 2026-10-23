// Имитация в странице (таск 07 сценариев): зеркало состояния, журнал, запуск
// и остановка, синхронизация с объектом и часами, память дома в настройках
// браузера, сторож зависания и запасной путь без Worker. Истории 2.3,
// 2.14–2.16, 3.2–3.4, 5.4, 6.4; `interfaces.md` — строки `simulation.js`,
// `sim/bridge.js`, «Протокол».
//
// Поток здесь — тот же `simWorkerMain`: в странице (без Worker), на
// поддельном потоке, который умеет «зависнуть», и в настоящем потоке
// `worker_threads` с настоящим `while(true)` из собранного бандла.
import test from "node:test";
import assert from "node:assert/strict";
import { Worker } from "node:worker_threads";

import { workerBundle } from "../build.js";
import { clockMsStamp, clockSimMs, volumeClockFixed } from "../src/clockMath.js";
import { addLogicBinding, addMark, addScenario, createProject, deleteMark, setMarkControls, setMarkNumber } from "../src/model.js";
import { createSimBridge } from "../src/sim/bridge.js";
import { markAccessory } from "../src/sim/home.js";
import { simWorkerMain } from "../src/sim/worker.js";
import {
  SIM_JOURNAL_MAX,
  SIM_STATE_MAX,
  SIM_STATE_SAVE_MS,
  SIM_STATE_SETTING,
  createSimulation,
  simAct,
  simCommand,
  simCommands,
  simDoor,
  simJournal,
  simJournalClear,
  simLive,
  simNextEvent,
  simOptionForms,
  simPresence,
  simPress,
  simReset,
  simRunning,
  simScenarioRun,
  simStart,
  simStep,
  simStop,
  simSync,
  simValue,
  simWatch,
} from "../src/simulation.js";
import { simHouse, simPut } from "./fixtures/simHome.js";

// Полдень пятницы 23 октября 2026 года в местных миллисекундах имитации.
const T0 = Date.UTC(2026, 9, 23, 12, 0, 0);

// ——— подставные двери ————————————————————————————————————————————————————

const settle = async (rounds = 6) => {
  for (let i = 0; i < rounds; i += 1) await new Promise((resolve) => setImmediate(resolve));
};

function fakeTimers() {
  let now = 1000000;
  let seq = 0;
  const queue = new Map();
  return {
    now: () => now,
    setTimeout: (fn, ms) => {
      seq += 1;
      queue.set(seq, { at: now + Math.max(0, Number(ms) || 0), fn });
      return seq;
    },
    clearTimeout: (id) => queue.delete(id),
    setInterval: (fn, ms) => {
      seq += 1;
      queue.set(seq, { at: now + ms, fn, every: ms });
      return seq;
    },
    clearInterval: (id) => queue.delete(id),
    defer: (fn) => queueMicrotask(fn),
    // Страница стояла: время ушло, а таймеры не срабатывали — догонят разом.
    jump(ms) {
      now += ms;
      for (const timer of queue.values()) if (timer.at < now) timer.at = now;
    },
    advance(ms) {
      const to = now + ms;
      for (;;) {
        let best = null;
        for (const [id, timer] of queue) if (timer.at <= to && (!best || timer.at < best[1].at)) best = [id, timer];
        if (!best) break;
        const [id, timer] = best;
        now = timer.at;
        if (timer.every) timer.at += timer.every;
        else queue.delete(id);
        timer.fn();
      }
      now = to;
    },
  };
}

// Часы стоят (пауза), как `appClock` с остановленным временем: переводятся
// только шагом и прыжком — той же формулой, что настоящие.
function fakeClock(start = T0) {
  let simMs = start;
  const watchers = new Set();
  const formula = () => {
    const { day, minutes } = clockMsStamp(simMs);
    return volumeClockFixed(minutes, 60, day);
  };
  const tell = () => {
    for (const watcher of [...watchers]) watcher({ speed: 60, clock: formula() });
  };
  return {
    now: () => formula(),
    simMs: () => clockSimMs(formula(), 0),
    watch: (fn) => {
      watchers.add(fn);
      return () => watchers.delete(fn);
    },
    jump: (ms) => {
      simMs = ms;
      tell();
    },
    step: (by) => {
      simMs = clockSimMs(formula(), 0) + by;
      tell();
    },
    at: () => simMs,
  };
}

function memorySettings(initial = {}) {
  const store = new Map(Object.entries(initial));
  const writes = [];
  return {
    get: async (key) => (store.has(key) ? structuredClone(store.get(key)) : null),
    set: async (key, value) => {
      writes.push(structuredClone(value));
      store.set(key, structuredClone(value));
      return { ok: true };
    },
    writes,
    saved: () => store.get(SIM_STATE_SETTING) || null,
  };
}

const noWorker = () => {
  throw new TypeError("Worker is not a constructor");
};

function session({ settings = memorySettings(), timers = fakeTimers(), clock = fakeClock(), spawn = noWorker, bridge = {} } = {}) {
  const sim = createSimulation({
    bridge: (options) => createSimBridge({ ...options, spawn, timers, ...bridge }),
    settings,
    clock,
    timers,
  });
  return { sim, settings, timers, clock };
}

async function until(cond, timers, { step = 250, limit = 200 } = {}) {
  for (let i = 0; i < limit; i += 1) {
    await settle();
    if (cond()) return true;
    if (timers) timers.advance(step);
  }
  await settle();
  return cond();
}

// ——— дом ——————————————————————————————————————————————————————————————————

let seq = 0;
const nid = (prefix) => prefix + (seq += 1);
const ref = (markId, char, service = 0) => ({ markId, service, char });
const trig = (at, op, value) => ({ type: "device", id: nid("c"), ref: at, op, value, trigger: true });
const when = (conditions, then) => ({ type: "if", id: nid("if"), if: { type: "group", id: nid("g"), mode: "OR", conditions }, then, else: null, every: null });
const put = (at, value) => ({ type: "device", id: nid("a"), ref: { markId: at.markId, service: at.service }, items: [{ char: at.char, verb: "set", value }] });
const delay = (sec, blocks) => ({ type: "delay", id: nid("d"), no: 1, sec, timer: "one", blocks });

// «Щелчок по выключателю → свет»: отвязанная клавиша В2 одиночным нажатием
// включает С3, с `off` — через минуту гасит.
function pressHouse({ off = false } = {}) {
  const box = simHouse();
  const id = (label) => box.marks[label];
  const then = [put(ref(id("С3"), "On"), true)];
  if (off) then.push(delay(60, [put(ref(id("С3"), "On"), false)]));
  const added = addScenario(box.project, {
    kind: "block",
    name: "Клавиша → свет",
    targets: [when([trig(ref(id("В2"), "ProgrammableSwitchEvent"), "eq", "SINGLE_PRESS")], then)],
  });
  box.project = added.project;
  box.scenarioId = added.scenario.id;
  return box;
}

function onSource(box, label) {
  const char = markAccessory(box.project, box.marks[label]).services[0].chars.find((item) => item.type === "On");
  return "Hub.getCharacteristic(" + char.address.split(".")[0] + ", " + char.cid + ")";
}

function logicSource(name, body) {
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

function addScript(box, kind, name, source) {
  const added = addScenario(box.project, { kind, name, source });
  box.project = added.project;
  return added.scenario.id;
}

function bindTo(box, scenarioId, label) {
  const added = addLogicBinding(box.project, { scenarioId, markId: box.marks[label], service: 0, options: {}, active: true });
  box.project = added.project;
  return added.binding.id;
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const inner of Object.values(value)) deepFreeze(inner);
  }
  return value;
}

// ——— запасной путь и основное ————————————————————————————————————————————

test("без Worker (конструктор бросает) — движок в странице и честно говорит «без защиты от зависания»", async () => {
  const box = pressHouse();
  const { sim } = session({ spawn: noWorker });
  sim.sync(box.project);
  assert.equal(sim.inPage(), true);
  const told = sim.journal().filter((entry) => entry.code === "noWorker");
  assert.equal(told.length, 1);
  assert.equal(told[0].kind, "system");
  sim.start();
  await settle();
  sim.press(box.marks["В2"], 0, "single");
  await settle();
  assert.equal(sim.value(box.marks["С3"], 0, "On"), true, "движок в странице не исполнил сценарий");
});

test("щелчок по выключателю → свет: зеркало, живое состояние и подписчик", async () => {
  const box = pressHouse();
  const { sim } = session();
  const seen = [];
  const unwatch = sim.watch((payload) => seen.push(payload));
  sim.sync(box.project);
  assert.equal(sim.value(box.marks["С3"], 0, "On"), false, "до запуска — начальное значение");
  assert.equal(sim.start(), true);
  assert.equal(sim.running(), true);
  await settle();
  assert.equal(sim.press(box.marks["В2"], 0, "single"), true);
  await settle();
  assert.equal(sim.value(box.marks["С3"], 0, "On"), true);
  const live = sim.live(box.project);
  assert.equal(live.get(box.marks["С3"]).on, true);
  assert.equal(live.get(box.marks["В2"]).pressedAt, T0);
  assert.equal(live.get(box.marks["С1"]).on, false);
  const changed = seen.flatMap((payload) => payload.changes).find((change) => change.markId === box.marks["С3"]);
  assert.equal(changed && changed.value, true);
  assert.ok(seen.some((payload) => payload.log.some((entry) => entry.code === "blockRun")));
  assert.ok(seen.every((payload) => typeof payload.running === "boolean" && Array.isArray(payload.scenarios)));
  assert.ok(sim.scenarios().some((scenario) => scenario.id === box.scenarioId));
  unwatch();
  const count = seen.length;
  sim.press(box.marks["В2"], 0, "single");
  await settle();
  assert.equal(seen.length, count, "отписанный подписчик получил сообщение");
  assert.equal(sim.stop(), true);
  assert.equal(sim.running(), false);
  await settle();
  assert.ok(sim.journal().some((entry) => entry.code === "stopped"));
});

test("четыре Т с одним номером — одно устройство: клавиша на вторую зажигает все, щелчок по третьей гасит", async () => {
  // Правка после сборки сценариев: «4 точечных светильника с идентификатором
  // Т1, в сценариях она должны быть одной сущностью».
  const box = simHouse();
  const type = box.project.markTypes.find((item) => item.code === "Т");
  const added = addMark(box.project, {
    schemeId: box.schemeId,
    typeId: type.id,
    points: [
      { x: 0.3, y: 0.3 },
      { x: 0.35, y: 0.3 },
      { x: 0.4, y: 0.3 },
      { x: 0.45, y: 0.3 },
    ],
  });
  const lamps = added.marks.map((mark) => mark.id);
  let project = added.project;
  const number = project.marks.find((mark) => mark.id === lamps[0]).number;
  for (const id of lamps.slice(1)) project = setMarkNumber(project, id, number).project;
  box.project = setMarkControls(project, box.marks["В1"], [{ id: lamps[1], channel: null }]).project;
  const { sim } = session();
  sim.sync(box.project);
  sim.start();
  await settle();
  // В1: сервис 0 — «Выключатель», 1 — кнопка (G11); нажатие кнопки
  // переключает «Выключатель», за ним — подопечные.
  sim.press(box.marks["В1"], 1, "single");
  await settle();
  const live = sim.live(box.project);
  for (const lamp of lamps) assert.equal(live.get(lamp) && live.get(lamp).on, true, "одна из Т не горит");
  assert.equal(sim.value(lamps[2], 0, "On"), true, "ведомая спрашивает не общий аксессуар");
  sim.act({ kind: "toggle", markId: lamps[2], service: 0 });
  await settle();
  for (const lamp of lamps) assert.equal(sim.live(box.project).get(lamp).on, false, "Т погасли не все");
  sim.stop();
});

test("журнал хранит 2000 последних строк, старые уходят", async () => {
  const box = pressHouse();
  const { sim } = session();
  sim.sync(box.project);
  sim.start();
  await settle();
  for (let i = 0; i < SIM_JOURNAL_MAX + 100; i += 1) sim.act({ kind: "toggle", markId: box.marks["С1"] });
  await settle();
  const journal = sim.journal();
  assert.equal(SIM_JOURNAL_MAX, 2000);
  assert.equal(journal.length, 2000);
  const last = journal.at(-1);
  assert.equal(last.code, "change");
  assert.equal(last.to, sim.value(box.marks["С1"], 0, "On"));
  sim.journalClear();
  assert.equal(sim.journal().length, 0);
});

// ——— память в браузере ——————————————————————————————————————————————————

test("состояние пишется по project.key не чаще раза в 0,5 с; в project ничего не пишется", async () => {
  const box = pressHouse();
  const project = deepFreeze(structuredClone(box.project));
  const before = JSON.stringify(project);
  const { sim, settings, timers } = session();
  sim.sync(project);
  sim.start();
  await settle();
  timers.advance(SIM_STATE_SAVE_MS);
  await settle();
  const base = settings.writes.length;
  for (let i = 0; i < 5; i += 1) {
    sim.act({ kind: "toggle", markId: box.marks["С1"] });
    await settle();
    timers.advance(80);
    await settle();
  }
  // Пять изменений за 400 мс — одна запись, вторая не раньше, чем через 0,5 с.
  assert.equal(settings.writes.length - base, 1);
  timers.advance(SIM_STATE_SAVE_MS);
  await settle();
  assert.equal(settings.writes.length - base, 2);
  const saved = settings.saved();
  assert.deepEqual(Object.keys(saved), [project.key]);
  assert.notEqual(project.key, project.id);
  assert.equal(saved[project.key].values[box.marks["С1"]]["0.On"], true);
  assert.equal(saved[project.key].running, true);
  sim.stop();
  sim.reset();
  await settle();
  assert.equal(JSON.stringify(project), before, "имитация что-то записала в объект");
});

test("не больше 20 объектов в памяти: самые давние уходят, свой остаётся", async () => {
  const box = pressHouse();
  const old = {};
  for (let i = 0; i < 25; i += 1) old["старый-" + i] = { values: {}, at: i, running: false };
  const { sim, settings, timers } = session({ settings: memorySettings({ [SIM_STATE_SETTING]: old }) });
  sim.sync(box.project);
  await settle();
  sim.start();
  await settle();
  timers.advance(SIM_STATE_SAVE_MS);
  await settle();
  const keys = Object.keys(settings.saved());
  assert.equal(SIM_STATE_MAX, 20);
  assert.equal(keys.length, 20);
  assert.ok(keys.includes(box.project.key));
  for (let i = 0; i <= 5; i += 1) assert.equal(keys.includes("старый-" + i), false, "остался давний старый-" + i);
  assert.ok(keys.includes("старый-24"));
});

test("перезагрузка страницы и свой файл: состояния подняты по key, таймеров нет, журнал говорит об этом", async () => {
  const box = pressHouse({ off: true });
  const settings = memorySettings();
  const first = session({ settings });
  first.sim.sync(box.project);
  first.sim.start();
  await settle();
  first.sim.act({ kind: "toggle", markId: box.marks["С1"] });
  first.sim.press(box.marks["В2"], 0, "single");
  await settle();
  assert.equal(first.sim.nextAt(), T0 + 60000, "задержка не завелась");
  first.timers.advance(SIM_STATE_SAVE_MS);
  await settle();

  // Новая страница — новая имитация; файл объекта открыт заново: id новый, key тот же.
  const reopened = { ...box.project, id: "открыт-из-файла" };
  const second = session({ settings });
  second.sim.sync(reopened);
  await settle();
  assert.equal(second.sim.value(box.marks["С1"], 0, "On"), true, "свет не поднялся из памяти");
  assert.equal(second.sim.value(box.marks["С3"], 0, "On"), true);
  assert.equal(second.sim.running(), false, "после перезагрузки дом остановлен");
  const reloaded = second.sim.journal().filter((entry) => entry.code === "pageReloaded");
  assert.equal(reloaded.length, 1);
  second.sim.start();
  await settle();
  assert.equal(second.sim.nextAt(), null, "таймер пережил перезагрузку");
  assert.equal(second.sim.value(box.marks["С3"], 0, "On"), true, "запуск потерял поднятые значения");
});

test("удалённые метки и мусор в памяти отсеиваются", async () => {
  const box = pressHouse();
  const gone = box.marks["С2"];
  box.project = deleteMark(box.project, gone).project;
  const settings = memorySettings({
    [SIM_STATE_SETTING]: {
      [box.project.key]: {
        values: {
          [box.marks["С1"]]: { "0.On": true, "0.Brightness": 1000, "7.Ghost": 1 },
          [gone]: { "0.On": true },
          "нет-такой": { "0.On": true },
        },
        at: 1,
        running: false,
      },
    },
  });
  const { sim, timers } = session({ settings });
  sim.sync(box.project);
  await settle();
  assert.equal(sim.value(box.marks["С1"], 0, "On"), true);
  assert.equal(sim.value(box.marks["С1"], 0, "Brightness"), 100, "значение вне диапазона не зажато");
  assert.equal(sim.value(gone, 0, "On"), undefined);
  assert.equal(sim.live(box.project).has(gone), false);
  assert.equal(sim.journal().some((entry) => entry.code === "pageReloaded"), false, "дом не был запущен — таймеров не было");
  sim.act({ kind: "toggle", markId: box.marks["С1"] });
  sim.start();
  await settle();
  timers.advance(SIM_STATE_SAVE_MS);
  await settle();
  const values = settings.saved()[box.project.key].values;
  assert.equal(values[gone], undefined);
  assert.equal(values["нет-такой"], undefined);
  assert.equal(values[box.marks["С1"]]["7.Ghost"], undefined);
});

// ——— объект и часы ————————————————————————————————————————————————————————

test("simSync: новая метка, профиль, сценарий — дом перестроен, живые устройства не потеряли состояния", async () => {
  const box = pressHouse();
  const { sim } = session();
  sim.sync(box.project);
  sim.start();
  await settle();
  sim.act({ kind: "toggle", markId: box.marks["С1"] });
  sim.act({ kind: "set", markId: box.marks["С2"], service: 0, char: "Brightness", value: 40 });
  await settle();

  const lamp = simPut(box, "С", { x: 0.4, y: 0.6 }, "living");
  const id = (label) => box.marks[label];
  box.project = addScenario(box.project, {
    kind: "block",
    name: "Протечка → розетка",
    targets: [when([trig(ref(id("ДПр1"), "LeakDetected"), "eq", "LEAK_DETECTED")], [put(ref(id("Р1"), "On"), true)])],
  }).project;
  sim.sync(box.project);
  await settle();
  assert.equal(sim.value(id("С1"), 0, "On"), true, "правка погасила живой свет");
  assert.equal(sim.value(id("С2"), 0, "Brightness"), 40);
  assert.equal(sim.value(lamp, 0, "On"), false);
  sim.act({ kind: "toggle", markId: lamp });
  sim.act({ kind: "sensor", markId: id("ДПр1"), value: true });
  await settle();
  assert.equal(sim.value(lamp, 0, "On"), true, "новая метка не управляется");
  assert.equal(sim.value(id("Р1"), 0, "On"), true, "новый сценарий не работает");
  assert.equal(sim.journal().some((entry) => entry.code === "editReset"), false, "задержек не было — сбрасывать нечего");
});

test("правка объекта при идущей задержке — журнал «таймеры сброшены правкой»", async () => {
  const box = pressHouse({ off: true });
  const { sim } = session();
  sim.sync(box.project);
  sim.start();
  await settle();
  sim.press(box.marks["В2"], 0, "single");
  await settle();
  assert.ok(sim.scenarios().some((scenario) => scenario.id === box.scenarioId && scenario.running));
  simPut(box, "Т", { x: 0.3, y: 0.6 }, "hall");
  sim.sync(box.project);
  await settle();
  const told = sim.journal().filter((entry) => entry.code === "editReset");
  assert.equal(told.length, 1);
  assert.equal(sim.value(box.marks["С3"], 0, "On"), true);
});

// Слепая приёмка (F2): правка мимо логического сценария его не перезапускает —
// и таймер, который он поставил, переживает перестройку дома. Сказать
// «таймеры сброшены правкой» про него значило бы соврать.
test("правка мимо логического сценария с ждущим таймером: таймер жив, «таймеры сброшены правкой» молчит, trigger не зовётся", async () => {
  // Блочный сценарий того же нажатия задержек не ставит: идёт только логика.
  const box = pressHouse();
  const later = addScript(box, "logic", "Позже", logicSource("Позже", "  setTimeout(function () { " + onSource(box, "С1") + ".setValue(true); }, 60000);"));
  bindTo(box, later, "В2");
  const { sim } = session();
  sim.sync(box.project);
  sim.start();
  await settle();
  sim.press(box.marks["В2"], 0, "single");
  await settle();
  // Список сценариев с отметкой «идёт» приходит от дома по его поводу — здесь
  // повод даёт отметка «Активный» блочного сценария.
  sim.scenarioActive(box.scenarioId, true);
  await settle();
  assert.ok(sim.scenarios().some((scenario) => scenario.id === later && scenario.running), "таймер не поставлен");
  const triggers = () => sim.journal().filter((entry) => entry.code === "hubTrigger").length;
  const before = triggers();
  box.project = addScenario(box.project, { kind: "block", name: "Чужой" }).project;
  sim.sync(box.project);
  await settle();
  assert.deepEqual(sim.journal().filter((entry) => entry.code === "editReset"), [], "сказано про сброс таймера, которого не было");
  assert.equal(triggers(), before, "чужая правка позвала trigger");
  assert.equal(sim.step(60 * 1000), true);
  await settle();
  assert.equal(sim.value(box.marks["С1"], 0, "On"), true, "таймер логики пропал от чужой правки");
});

test("шаг часов: задержка на минуту срабатывает ровно шагом в минуту, на паузе — только шагом", async () => {
  const box = pressHouse({ off: true });
  const { sim, clock, timers } = session();
  sim.sync(box.project);
  sim.start();
  await settle();
  sim.press(box.marks["В2"], 0, "single");
  await settle();
  timers.advance(10 * 60 * 1000);
  await settle();
  assert.equal(sim.value(box.marks["С3"], 0, "On"), true, "на паузе задержка сработала сама");
  assert.equal(sim.step(59 * 1000), true);
  await settle();
  assert.equal(sim.value(box.marks["С3"], 0, "On"), true);
  sim.step(1000);
  await settle();
  assert.equal(sim.value(box.marks["С3"], 0, "On"), false, "событие на границе шага не сработало");
  assert.equal(clock.at(), T0 + 60000);
  const steps = sim.journal().filter((entry) => entry.markId === box.marks["С3"] && entry.code === "change");
  assert.deepEqual(steps.map((entry) => [entry.to, entry.at]), [[true, T0], [false, T0 + 60000]]);
});

test("«К следующему событию»: часы перематываются к задержке, она срабатывает; ничего не ждёт — false", async () => {
  const box = pressHouse({ off: true });
  const { sim, clock } = session();
  sim.sync(box.project);
  sim.start();
  await settle();
  assert.equal(sim.nextAt(), null);
  assert.equal(sim.nextEvent(), false);
  sim.press(box.marks["В2"], 0, "single");
  await settle();
  assert.equal(sim.nextAt(), T0 + 60000);
  assert.equal(sim.nextEvent(), true);
  await settle();
  assert.equal(clock.at(), T0 + 60000);
  assert.equal(sim.value(box.marks["С3"], 0, "On"), false);
  assert.equal(sim.nextAt(), null);
  assert.equal(sim.nextEvent(), false);
});

test("«Сбросить дом» у остановленного дома: умолчания в зеркале, запись в журнале, запуск — с умолчаниями", async () => {
  const box = pressHouse();
  const { sim } = session();
  sim.sync(box.project);
  sim.start();
  await settle();
  sim.act({ kind: "toggle", markId: box.marks["С1"] });
  await settle();
  sim.stop();
  await settle();
  assert.equal(sim.value(box.marks["С1"], 0, "On"), true, "остановка потеряла состояние");
  assert.equal(sim.reset(), true);
  assert.equal(sim.value(box.marks["С1"], 0, "On"), false);
  assert.equal(sim.journal().at(-1).code, "reset");
  sim.start();
  await settle();
  assert.equal(sim.value(box.marks["С1"], 0, "On"), false, "поток вернул старое значение");
  sim.act({ kind: "toggle", markId: box.marks["С1"] });
  await settle();
  sim.reset();
  await settle();
  assert.equal(sim.value(box.marks["С1"], 0, "On"), false, "сброс запущенного дома не дошёл");
});

// ——— сторож ————————————————————————————————————————————————————————————————

// Поддельный поток: тот же `simWorkerMain`, но «зависает» по правилу — с
// этого мига не принимает и не отдаёт ни одного сообщения, как настоящий
// поток в `while(true)`.
function freezable(timers, rule) {
  const made = [];
  const spawn = () => {
    const outs = [];
    let listener = null;
    let frozen = false;
    let dead = false;
    let spec = null;
    const scope = {
      postMessage: (message) => {
        if (frozen || dead) return;
        // Сообщение, после которого поток встаёт, ещё доезжает — как `trace`
        // настоящего потока перед вечным циклом.
        const hit = Boolean(rule.onPost && rule.onPost(message, spec));
        const copy = structuredClone(message);
        queueMicrotask(() => {
          if (!dead) for (const fn of outs) fn({ data: copy });
        });
        if (hit) frozen = true;
      },
      addEventListener: (type, fn) => {
        if (type === "message") listener = fn;
      },
      setTimeout: (fn, ms) => timers.setTimeout(fn, ms),
      clearTimeout: (id) => timers.clearTimeout(id),
      now: () => timers.now(),
    };
    simWorkerMain(scope);
    const worker = {
      postMessage: (message) => {
        const copy = structuredClone(message);
        queueMicrotask(() => {
          if (dead || frozen) return;
          if (copy.type === "load") spec = copy.spec;
          listener({ data: copy });
        });
      },
      terminate: () => {
        dead = true;
      },
      addEventListener: (type, fn) => {
        if (type === "message") outs.push(fn);
      },
      frozen: () => frozen,
    };
    made.push(worker);
    return worker;
  };
  return { spawn, made };
}

test("сторож: зависший trigger — через 3 с поток перезапущен из зеркала, привязка выключена, остальные сценарии отработали", async () => {
  const box = pressHouse();
  const hungId = addScript(box, "logic", "Вечный цикл", logicSource("Вечный цикл", "  " + onSource(box, "С1") + ".setValue(true);"));
  const bindingId = bindTo(box, hungId, "В2");
  const timers = fakeTimers();
  const fake = freezable(timers, { onPost: (message) => message.type === "trace" && message.where === "trigger" && message.scenarioId === hungId });
  const { sim } = session({ timers, spawn: fake.spawn });
  sim.sync(box.project);
  sim.start();
  sim.act({ kind: "toggle", markId: box.marks["С2"] });
  assert.ok(await until(() => sim.value(box.marks["С2"], 0, "On") === true, timers, { limit: 4 }));
  sim.press(box.marks["В2"], 0, "single");
  await settle();
  assert.equal(fake.made[0].frozen(), true, "поток не завис");
  timers.advance(2900);
  await settle();
  assert.equal(fake.made.length, 1, "перезапуск раньше 3 с");
  assert.ok(await until(() => sim.value(box.marks["С3"], 0, "On") === true, timers, { step: 100, limit: 10 }));
  assert.equal(fake.made.length, 2);
  assert.equal(sim.value(box.marks["С2"], 0, "On"), true, "перезапуск потерял состояние из зеркала");
  assert.equal(sim.value(box.marks["С1"], 0, "On"), false, "виновник отработал после перезапуска");
  assert.equal(sim.running(), true);
  const hung = sim.journal().filter((entry) => entry.code === "scenarioHung");
  assert.equal(hung.length, 1);
  assert.equal(hung[0].kind, "error");
  assert.equal(hung[0].scenarioId, hungId);
  assert.equal(hung[0].bindingId, bindingId);
  assert.equal(hung[0].vars.name, "Вечный цикл");
  assert.equal(hung[0].vars.label, "В2");
  assert.equal(hung[0].vars.where, "trigger");
  assert.deepEqual(sim.hung().bindings, [bindingId]);
  assert.equal(sim.optionForms(bindingId).fault.code, "hung");
  assert.equal(sim.journal().filter((entry) => entry.code === "started").length, 1, "перезапуск потока — не «Дом запущен»");
  // Дальше дом живёт: следующее нажатие — без зависания.
  sim.act({ kind: "toggle", markId: box.marks["С3"] });
  assert.ok(await until(() => sim.value(box.marks["С3"], 0, "On") === false, timers, { limit: 4 }));
  assert.equal(fake.made.length, 2);
  // Повторная активация возвращает сценарий вместе с выключенной привязкой.
  sim.scenarioActive(hungId, true);
  assert.deepEqual(sim.hung(), { scenarios: [], bindings: [] });
  assert.equal(sim.optionForms(bindingId).fault, null);
});

test("сторож: верхний уровень скрипта завис на загрузке — проба находит виновника среди нескольких", async () => {
  const box = pressHouse();
  const globalId = addScript(box, "global", "Утилиты", "global.helper = function () { return 1; };");
  const hungId = addScript(box, "logic", "Зависает сразу", logicSource("Зависает сразу", "") + "\n/*HANG*/");
  const timers = fakeTimers();
  // Зависает остановленный дом на загрузке и запуск — когда в доме есть текст с меткой.
  const marked = (spec) => Boolean(spec) && spec.scenarios.some((scenario) => typeof scenario.source === "string" && scenario.source.includes("/*HANG*/"));
  const fake = freezable(timers, { onPost: (message, spec) => message.type === "trace" && (message.where === "load" || message.where === "start") && marked(spec) });
  const { sim } = session({ timers, spawn: fake.spawn });
  sim.sync(box.project);
  assert.ok(await until(() => sim.hung().scenarios.length > 0, timers, { step: 250, limit: 80 }), "виновник не найден");
  assert.deepEqual(sim.hung().scenarios, [hungId]);
  assert.ok(fake.made.length >= 3, "проб не было");
  const listed = await until(() => sim.scenarios().some((scenario) => scenario.id === hungId), timers, { limit: 8 });
  assert.ok(listed);
  const view = sim.scenarios().find((scenario) => scenario.id === hungId);
  assert.equal(view.fault.code, "hung");
  assert.equal(view.active, false);
  assert.equal(sim.scenarios().find((scenario) => scenario.id === globalId).fault, null);
  const told = sim.journal().filter((entry) => entry.code === "scenarioHung");
  assert.equal(told.length, 1);
  assert.equal(told[0].scenarioId, hungId);
  // Остальное работает.
  sim.start();
  sim.press(box.marks["В2"], 0, "single");
  assert.ok(await until(() => sim.value(box.marks["С3"], 0, "On") === true, timers, { limit: 8 }));
  // Правка текста снимает пометку: сценарию — ещё одна попытка.
  box.project = { ...box.project, scenarios: box.project.scenarios.map((item) => (item.id === hungId ? { ...item, source: logicSource("Исправлен", "") } : item)) };
  sim.sync(box.project);
  assert.deepEqual(sim.hung().scenarios, []);
});

test("сторож в настоящем потоке: while(true) в trigger из собранного бандла — поток погашен и поднят, свет включён", { timeout: 30000 }, async () => {
  const { source } = await workerBundle();
  const threads = [];
  const spawn = (text) => {
    const shim =
      "const { parentPort } = require('node:worker_threads');\n" +
      "const self = { postMessage: (m) => parentPort.postMessage(m), addEventListener: (t, fn) => { if (t === 'message') parentPort.on('message', (data) => fn({ data })); } };\n";
    const thread = new Worker(shim + text, { eval: true });
    threads.push(thread);
    return {
      postMessage: (message) => thread.postMessage(message),
      terminate: () => thread.terminate(),
      addEventListener: (type, fn) => {
        if (type === "message") thread.on("message", (data) => fn({ data }));
        else if (type === "error") thread.on("error", fn);
      },
    };
  };
  const box = pressHouse();
  const hungId = addScript(box, "logic", "while(true)", logicSource("while(true)", "  while (true) {}"));
  const bindingId = bindTo(box, hungId, "В2");
  const sim = createSimulation({
    bridge: (options) => createSimBridge({ ...options, source, spawn, hangMs: 500, checkMs: 50, pulseMs: 100 }),
    settings: memorySettings(),
    clock: fakeClock(),
  });
  try {
    sim.sync(box.project);
    sim.start();
    const wait = async (cond, ms = 15000) => {
      const end = Date.now() + ms;
      while (Date.now() < end) {
        if (cond()) return true;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      return cond();
    };
    assert.ok(await wait(() => sim.journal().some((entry) => entry.code === "started")), "поток не поднялся");
    assert.equal(sim.inPage(), false);
    const started = Date.now();
    sim.press(box.marks["В2"], 0, "single");
    assert.ok(await wait(() => sim.value(box.marks["С3"], 0, "On") === true), "после зависания свет не включился");
    assert.ok(Date.now() - started >= 450, "перезапуск раньше срока сторожа");
    assert.deepEqual(sim.hung().bindings, [bindingId]);
    assert.equal(threads.length, 2);
    const told = sim.journal().find((entry) => entry.code === "scenarioHung");
    assert.equal(told.kind, "error");
    assert.equal(told.vars.where, "trigger");
  } finally {
    sim.close();
    await Promise.all(threads.map((thread) => thread.terminate()));
  }
});

test("сторож не гасит живой поток, пока стояла сама страница; зависший — гасит через 3 с", async () => {
  const timers = fakeTimers();
  const made = [];
  // Поток отвечает на `ping` сам, пока не «застрял»; застрявший копит входящие.
  const spawn = () => {
    const worker = {
      inbox: [],
      received: [],
      outs: [],
      dead: false,
      stuck: false,
      postMessage: (message) => {
        worker.received.push(message);
        worker.inbox.push(message);
        if (!worker.stuck) queueMicrotask(() => worker.answer());
      },
      terminate: () => {
        worker.dead = true;
      },
      addEventListener: (type, fn) => {
        if (type === "message") worker.outs.push(fn);
      },
      answer: () => {
        if (worker.dead) return;
        for (const message of worker.inbox.splice(0)) {
          if (message.type === "ping") for (const fn of worker.outs) fn({ data: { type: "pong", n: message.n } });
        }
      },
    };
    made.push(worker);
    return worker;
  };
  const hangs = [];
  const bridge = createSimBridge({ spawn, timers, onHang: (info) => hangs.push(info), restore: () => [{ type: "load", spec: {} }] });
  await settle();
  // Страница простояла 5 с, пока ответ потока ждал своей очереди.
  made[0].stuck = true;
  bridge.post({ type: "act", action: { kind: "toggle", markId: "м" } });
  await settle();
  timers.jump(5000);
  timers.advance(0);
  await settle();
  assert.equal(hangs.length, 0, "поток погашен за то, что стояла страница");
  made[0].stuck = false;
  made[0].answer();
  for (let i = 0; i < 20; i += 1) {
    timers.advance(250);
    await settle();
  }
  assert.equal(hangs.length, 0);
  // Настоящее зависание.
  made[0].stuck = true;
  bridge.post({ type: "act", action: { kind: "toggle", markId: "м" } });
  await settle();
  timers.advance(2750);
  await settle();
  assert.equal(hangs.length, 0, "раньше 3 с");
  timers.advance(500);
  await settle();
  assert.equal(hangs.length, 1);
  assert.equal(made[0].dead, true);
  assert.deepEqual(hangs[0].pending.map((message) => message.type), ["act"]);
  assert.equal(made.length, 2, "новый поток не поднят");
  assert.deepEqual(made[1].received.map((message) => message.type).filter((type) => type !== "ping"), ["load", "act"]);
  bridge.close();
});

// ——— двери модуля ——————————————————————————————————————————————————————

test("двери sim* — одна имитация на сеанс", async () => {
  for (const fn of [simStart, simStop, simReset, simRunning, simAct, simPress, simValue, simLive, simWatch, simJournal, simJournalClear, simSync, simNextEvent, simStep, simPresence, simDoor, simScenarioRun, simOptionForms]) {
    assert.equal(typeof fn, "function");
  }
  const box = pressHouse();
  const seen = [];
  const unwatch = simWatch((payload) => seen.push(payload));
  try {
    assert.equal(simSync(box.project), true);
    assert.equal(simSync(box.project), false, "тот же объект — синхронизировать нечего");
    assert.equal(simStart(), true);
    assert.equal(simRunning(), true);
    await settle();
    simPress(box.marks["В2"], 0, "single");
    simAct({ kind: "toggle", markId: box.marks["С1"] });
    simPresence([]);
    simDoor("нет-двери", true);
    simScenarioRun(box.scenarioId);
    await settle();
    assert.equal(simValue(box.marks["С3"], 0, "On"), true);
    assert.equal(simLive(box.project).get(box.marks["С1"]).on, true);
    assert.ok(simJournal().some((entry) => entry.code === "blockRun"));
    assert.ok(seen.length > 0);
    assert.equal(simOptionForms("нет-привязки"), null);
    assert.equal(simNextEvent(), false);
  } finally {
    unwatch();
    simStop();
    simJournalClear();
  }
  assert.equal(simRunning(), false);
  assert.equal(simJournal().length, 0);
  assert.equal(typeof simStep, "function");
});

// ——— «Выполнить команду» (G17) ————————————————————————————————————————————

function commandHouse() {
  const box = simHouse();
  const id = (label) => box.marks[label];
  const said = (text) => ({ type: "command", id: nid("k"), text });
  const add = (scenario) => {
    const added = addScenario(box.project, { kind: "block", ...scenario });
    box.project = added.project;
    return added.scenario.id;
  };
  box.tree = add({ name: "Гирлянда", targets: [{ ...when([said("Ёлочка гори")], [put(ref(id("Р1"), "On"), true)]) }] });
  box.again = add({ name: "Гирлянда ещё", targets: [when([said("  ёлочка  ГОРИ! ")], [put(ref(id("С2"), "On"), true)])] });
  box.night = add({ name: "Ночь", active: false, targets: [when([said("Спокойной ночи")], [put(ref(id("С1"), "On"), false)])] });
  add({ name: "Пустая", targets: [when([said("   ")], [])] });
  addScript(box, "logic", "Логика", logicSource("Логика", "  return;"));
  return box;
}

test("simCommands: все команды сценариев без повторов, по алфавиту; неактивный помечен; без команд — пусто", () => {
  const box = commandHouse();
  assert.deepEqual(simCommands(box.project), [
    { text: "Ёлочка гори", scenarioIds: [box.tree, box.again], active: true },
    { text: "Спокойной ночи", scenarioIds: [box.night], active: false },
  ]);
  assert.deepEqual(simCommands(createProject()), []);
  assert.deepEqual(simCommands(simHouse().project), []);
});

test("«Выполнить команду»: «Ëлочка гори» уходит в имитацию — гирлянда включена, журнал говорит о команде", async () => {
  const box = commandHouse();
  const { sim } = session();
  sim.sync(box.project);
  sim.start();
  await settle();
  assert.equal(sim.command("Ëлочка гори"), true);
  await settle();
  assert.equal(sim.value(box.marks["Р1"], 0, "On"), true, "команда не включила гирлянду");
  assert.equal(sim.value(box.marks["С2"], 0, "On"), true, "второй сценарий с той же командой не запустился");
  const journal = sim.journal();
  const said = journal.find((entry) => entry.code === "command");
  assert.deepEqual(said && said.vars, { text: "Ëлочка гори" });
  assert.deepEqual(
    journal.filter((entry) => entry.code === "blockRun").map((entry) => entry.scenarioId),
    [box.tree, box.again],
  );
  sim.command("Ёлочка погасни");
  await settle();
  assert.deepEqual(journal.length < sim.journal().length, true);
  assert.deepEqual(sim.journal().find((entry) => entry.code === "commandUnknown").vars, { text: "Ёлочка погасни" });
  assert.equal(typeof simCommand, "function");
  sim.stop();
});
