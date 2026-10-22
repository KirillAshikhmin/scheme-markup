// Блочные сценарии во времени (таск 05): задержки «один / новый таймер»,
// «Сбросить задержку», «Тогда — каждые N» до «Сбросить» сценария, планировщик
// («в ЧЧ:ММ», «каждые N», восход/закат со смещением, дни недели), период с
// галкой и без, через полночь, удержание «Более / Менее», перевод часов,
// «Сбросить дом» и остановка. Всё в виртуальном времени движка. Истории 2.4,
// 3.3–3.6, 4.8–4.10, 4.18, 4.19, 4.23; `research/spruthub-wiki.md` §2.4, §2.9.
import test from "node:test";
import assert from "node:assert/strict";

import { createSimEngine } from "../src/sim/engine.js";
import { buildHomeSpec } from "../src/sim/home.js";
import { sunTimes } from "../src/sim/schedule.js";
import { blocksOwner } from "../src/sim/blocks.js";
import { addScenario } from "../src/model.js";
import { simHouse, simRecorder } from "./fixtures/simHome.js";

const SEC = 1000;
const MIN = 60 * SEC;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
// Пятница 23 октября 2026 года: полночь и полдень на часах имитации.
const FRI = Date.UTC(2026, 9, 23);
const T0 = FRI + 12 * HOUR;
const SAT = FRI + DAY;
const ALL = [1, 2, 3, 4, 5, 6, 7];
const MOSCOW = { latDeg: 55.7558, lonDeg: 37.6173 };

// ——— сборка блоков ————————————————————————————————————————————————————————

let seq = 0;
const nid = (prefix) => prefix + (seq += 1);

const ref = (markId, char, service = 0) => ({ markId, service, char });
const cond = (at, op, value, extra = {}) => ({ type: "device", id: nid("c"), ref: at, op, value, trigger: false, ...extra });
const trig = (at, op, value, extra = {}) => cond(at, op, value, { trigger: true, ...extra });
const when = (conditions, then, other = null, { id = nid("if"), mode = "OR", every = null } = {}) => ({
  type: "if",
  id,
  if: { type: "group", id: nid("g"), mode, conditions },
  then,
  else: other,
  every,
});
const put = (at, value) => ({ type: "device", id: nid("a"), ref: { markId: at.markId, service: at.service }, items: [{ char: at.char, verb: "set", value }] });
const step = (at, by) => ({ type: "device", id: nid("a"), ref: { markId: at.markId, service: at.service }, items: [{ char: at.char, verb: "increase", step: by }] });
const note = (text) => ({ type: "notify", id: nid("n"), text });
const delay = (no, sec, timer, blocks) => ({ type: "delay", id: nid("d"), no, sec, timer, blocks });
const resetDelay = (no) => ({ type: "resetDelay", id: nid("r"), no });
const schedule = (fields) => ({ type: "schedule", id: nid("t"), days: ALL, ...fields });
const period = (from, to, trigger, days = ALL) => ({ type: "period", id: nid("p"), days, from, to, trigger });

function house({ scenarios = () => [], box = simHouse(), site = null, at = T0, start = true } = {}) {
  const id = (label) => box.marks[label];
  for (const scenario of scenarios(id, box)) box.project = addScenario(box.project, { kind: "block", ...scenario }).project;
  const recorder = simRecorder();
  const engine = createSimEngine({ emit: recorder.emit, owners: [blocksOwner()] });
  engine.load({ ...buildHomeSpec(box.project), site });
  engine.setClock({ simMs: at });
  if (start) engine.start();
  return {
    box,
    engine,
    recorder,
    id,
    value: (label, char, service = 0) => engine.value(id(label), service, char),
    set: (label, char, value, service = 0) => engine.act({ kind: "set", markId: id(label), service, char, value }),
    press: (label, press = "single", service = 0) => engine.act({ kind: "press", markId: id(label), service, press }),
    sensor: (label, value) => engine.act({ kind: "sensor", markId: id(label), value }),
    notes: () => recorder.log().filter((entry) => entry.kind === "notify").map((entry) => entry.vars.text),
    noteTimes: (text) => recorder.log().filter((entry) => entry.kind === "notify" && entry.vars.text === text).map((entry) => entry.at),
    running: (scenarioId) => engine.scenarios().find((item) => item.id === scenarioId).running,
    to: (ms) => engine.advanceTo(ms),
  };
}

// ——— задержки ————————————————————————————————————————————————————————————————

test("2.4: свет по движению включается и гаснет через минуту виртуального времени; повторное движение продлевает", () => {
  const scenarios = (id) => [
    {
      id: "hall",
      name: "Свет в коридоре",
      targets: [
        when(
          [trig(ref(id("ДД1"), "MotionDetected"), "eq", true)],
          [put(ref(id("С1"), "On"), true), delay(1, 60, "one", [put(ref(id("С1"), "On"), false)])],
        ),
      ],
    },
  ];
  let home = house({ scenarios });
  home.sensor("ДД1");
  assert.equal(home.value("С1", "On"), true);
  assert.equal(home.running("hall"), true, "задержка идёт, а сценарий не «выполняется»");
  home.to(T0 + 59 * SEC);
  assert.equal(home.value("С1", "On"), true);
  home.to(T0 + MIN);
  assert.equal(home.value("С1", "On"), false, "через минуту свет не погас");
  assert.equal(home.running("hall"), false);

  home = house({ scenarios });
  home.sensor("ДД1");
  home.to(T0 + 30 * SEC);
  home.sensor("ДД1", false);
  home.to(T0 + 40 * SEC);
  home.sensor("ДД1");
  home.to(T0 + MIN);
  assert.equal(home.value("С1", "On"), true, "повторное движение не продлило задержку («один таймер»)");
  home.to(T0 + 99 * SEC);
  assert.equal(home.value("С1", "On"), true);
  home.to(T0 + 100 * SEC);
  assert.equal(home.value("С1", "On"), false);
});

test("«Один таймер» перезапускает отсчёт, «Новый таймер» — параллельные", () => {
  const home = house({
    scenarios: (id) => [
      { id: "one", name: "Один", targets: [when([trig(ref(id("ДД2"), "MotionDetected"), "eq", true)], [delay(1, 60, "one", [note("один")])])] },
      { id: "new", name: "Новый", targets: [when([trig(ref(id("ДД2"), "MotionDetected"), "eq", true)], [delay(1, 60, "new", [note("новый")])])] },
    ],
  });
  home.sensor("ДД2");
  home.to(T0 + 10 * SEC);
  home.sensor("ДД2", false);
  home.to(T0 + 20 * SEC);
  home.sensor("ДД2");
  home.to(T0 + 5 * MIN);
  assert.deepEqual(home.noteTimes("новый"), [T0 + MIN, T0 + 80 * SEC]);
  assert.deepEqual(home.noteTimes("один"), [T0 + 80 * SEC]);
});

test("«Сбросить задержку»: №N — только её, «все» — все задержки сценария", () => {
  const key = (id, press) => trig(ref(id("В2"), "ProgrammableSwitchEvent"), "eq", press);
  const home = house({
    scenarios: (id) => [
      {
        id: "delays",
        name: "Задержки",
        targets: [
          when([key(id, "SINGLE_PRESS")], [delay(1, 60, "one", [note("1")]), delay(2, 60, "one", [note("2")])]),
          when([key(id, "DOUBLE_PRESS")], [resetDelay(1)]),
          when([key(id, "LONG_PRESS")], [resetDelay(null)]),
        ],
      },
    ],
  });
  home.press("В2");
  home.to(T0 + 10 * SEC);
  home.press("В2", "double");
  home.to(T0 + 90 * SEC);
  assert.deepEqual(home.notes(), ["2"], "сброшена не та задержка");
  home.press("В2");
  home.to(T0 + 100 * SEC);
  home.press("В2", "long");
  home.to(T0 + 10 * MIN);
  assert.deepEqual(home.notes(), ["2"], "«все задержки» не сброшены");
  assert.equal(home.running("delays"), false);
});

test("«Тогда — каждые N» повторяет действия до «Сбросить» сценария другим сценарием", () => {
  const home = house({
    scenarios: (id) => [
      {
        id: "dim",
        name: "Плавно",
        targets: [
          when([trig(ref(id("В2"), "ProgrammableSwitchEvent"), "eq", "SINGLE_PRESS")], [step(ref(id("Т1"), "Brightness"), -10)], null, {
            every: { sec: 10 },
          }),
        ],
      },
      {
        id: "stop",
        name: "Стоп",
        targets: [when([trig(ref(id("В2"), "ProgrammableSwitchEvent"), "eq", "DOUBLE_PRESS")], [{ type: "scenario", id: "x1", verb: "reset", scenarioId: "dim" }])],
      },
    ],
  });
  home.press("В2");
  assert.equal(home.value("Т1", "Brightness"), 90, "«Тогда» не выполнилось сразу");
  home.to(T0 + 10 * SEC);
  assert.equal(home.value("Т1", "Brightness"), 80);
  home.to(T0 + 30 * SEC);
  assert.equal(home.value("Т1", "Brightness"), 60);
  assert.equal(home.running("dim"), true);
  home.press("В2", "double");
  home.to(T0 + 10 * MIN);
  assert.equal(home.value("Т1", "Brightness"), 60, "цикл пережил «Сбросить»");
  assert.equal(home.running("dim"), false);
  const [reset] = home.recorder.log().filter((entry) => entry.code === "blockReset");
  assert.equal(reset.scenarioId, "dim");
});

test("«Сбросить» сценария снимает его задержки; новое событие триггера запускает заново", () => {
  const home = house({
    scenarios: (id) => [
      { id: "late", name: "Позже", targets: [when([trig(ref(id("ДД2"), "MotionDetected"), "eq", true)], [delay(1, 60, "one", [note("позже")])])] },
      { id: "cut", name: "Сброс", targets: [when([trig(ref(id("В2"), "ProgrammableSwitchEvent"), "eq", "SINGLE_PRESS")], [{ type: "scenario", id: "x2", verb: "reset", scenarioId: "late" }])] },
    ],
  });
  home.sensor("ДД2");
  home.press("В2");
  home.to(T0 + 5 * MIN);
  assert.deepEqual(home.notes(), []);
  home.sensor("ДД2", false);
  home.sensor("ДД2");
  home.to(T0 + 7 * MIN);
  assert.deepEqual(home.notes(), ["позже"]);
});

// ——— планировщик ——————————————————————————————————————————————————————————————

test("планировщик «в 07:00» по дням недели срабатывает в своё виртуальное время", () => {
  const home = house({
    scenarios: () => [{ id: "morning", name: "Утро", targets: [when([schedule({ mode: "time", at: "07:00", days: [6, 7] })], [note("утро")])] }],
  });
  assert.equal(home.engine.nextAt(), SAT + 7 * HOUR, "следующее событие дома — не утро субботы");
  home.to(SAT + 7 * HOUR - 1);
  assert.deepEqual(home.notes(), []);
  home.to(SAT + 7 * HOUR);
  home.to(SAT + DAY + 7 * HOUR);
  home.to(SAT + 2 * DAY + 7 * HOUR);
  home.to(SAT + 7 * DAY + 7 * HOUR);
  assert.deepEqual(home.noteTimes("утро"), [SAT + 7 * HOUR, SAT + DAY + 7 * HOUR, SAT + 7 * DAY + 7 * HOUR]);
  const [run] = home.recorder.log().filter((entry) => entry.code === "blockRun");
  assert.equal(run.chain[0].k, "timer");
});

test("планировщик «каждые N» идёт от запуска дома, ручной запуск начинает отсчёт заново", () => {
  const home = house({
    scenarios: () => [{ id: "tick", name: "Тик", targets: [when([schedule({ mode: "every", everySec: 600 })], [note("тик")])] }],
  });
  home.to(T0 + 20 * MIN);
  assert.deepEqual(home.noteTimes("тик"), [T0 + 10 * MIN, T0 + 20 * MIN]);
  home.to(T0 + 25 * MIN);
  home.engine.runScenario("tick");
  assert.equal(home.notes().length, 2, "ручной запуск сработал как планировщик");
  home.to(T0 + 30 * MIN);
  assert.equal(home.notes().length, 2, "отсчёт не начался заново от ручного запуска");
  home.to(T0 + 35 * MIN);
  assert.deepEqual(home.noteTimes("тик").at(-1), T0 + 35 * MIN);
});

test("восход и закат со смещением: без координат 9:00 и 21:00, с координатами — счёт солнца «Объёма»", () => {
  const scenarios = () => [
    {
      id: "sun",
      name: "Солнце",
      targets: [
        when([schedule({ mode: "sunset", offsetSec: -30 * 60 })], [note("закат")]),
        when([schedule({ mode: "sunrise", offsetSec: 15 * 60 })], [note("восход")]),
      ],
    },
  ];
  let home = house({ scenarios });
  home.to(SAT + 12 * HOUR);
  assert.deepEqual(home.noteTimes("закат"), [FRI + 20 * HOUR + 30 * MIN]);
  assert.deepEqual(home.noteTimes("восход"), [SAT + 9 * HOUR + 15 * MIN]);

  home = house({ scenarios, site: MOSCOW });
  home.to(SAT + 12 * HOUR);
  const friday = sunTimes(FRI, MOSCOW);
  const saturday = sunTimes(SAT, MOSCOW);
  assert.notEqual(friday.setAt, FRI + 21 * HOUR, "координаты не дошли до планировщика");
  assert.deepEqual(home.noteTimes("закат"), [friday.setAt - 30 * MIN]);
  assert.deepEqual(home.noteTimes("восход"), [saturday.riseAt + 15 * MIN]);
});

test("ручной запуск: планировщик не срабатывает, условия проверяются", () => {
  const home = house({
    scenarios: () => [
      { id: "plan", name: "План", targets: [when([schedule({ mode: "time", at: "07:00" })], [note("утро")], [note("не утро")])] },
    ],
  });
  home.engine.runScenario("plan");
  assert.deepEqual(home.notes(), ["не утро"]);
});

// ——— период ————————————————————————————————————————————————————————————————————

test("период с галкой через полночь: в начале — «Тогда», в конце — «Иначе»; без галки — проверка «сейчас внутри»", () => {
  const home = house({
    scenarios: (id) => [
      { id: "night", name: "Ночь", targets: [when([period("22:00", "06:00", true)], [note("ночь")], [note("день")])] },
      {
        id: "quiet",
        name: "Тихо",
        targets: [
          when(
            [trig(ref(id("В2"), "ProgrammableSwitchEvent"), "eq", "SINGLE_PRESS"), period("22:00", "06:00", false)],
            [note("тихо")],
            [note("громко")],
            { mode: "AND" },
          ),
        ],
      },
    ],
  });
  home.press("В2");
  home.to(FRI + 22 * HOUR);
  home.to(SAT + HOUR);
  home.press("В2");
  home.to(SAT + 6 * HOUR);
  assert.deepEqual(home.notes(), ["громко", "ночь", "тихо", "день"]);
  assert.deepEqual(home.noteTimes("ночь"), [FRI + 22 * HOUR]);
  assert.deepEqual(home.noteTimes("день"), [SAT + 6 * HOUR]);
});

// ——— удержание ————————————————————————————————————————————————————————————————

test("удержание «Более N»: запуск, когда условие продержалось N; прервалось раньше — нет", () => {
  const home = house({
    scenarios: (id) => [
      {
        id: "hot",
        name: "Долго жарко",
        targets: [when([trig(ref(id("ДТВ1"), "CurrentTemperature"), "gt", 25, { hold: { mode: "more", sec: 60 } })], [note("держится")])],
      },
      {
        id: "plug",
        name: "Розетка давно",
        targets: [
          when(
            [trig(ref(id("В2"), "ProgrammableSwitchEvent"), "eq", "SINGLE_PRESS"), cond(ref(id("Р1"), "On"), "eq", true, { hold: { mode: "more", sec: 60 } })],
            [note("долго")],
            [note("недолго")],
            { mode: "AND" },
          ),
        ],
      },
    ],
  });
  home.set("ДТВ1", "CurrentTemperature", 26);
  assert.deepEqual(home.notes(), [], "условие с удержанием сработало сразу");
  home.to(T0 + 59 * SEC);
  assert.deepEqual(home.notes(), []);
  home.to(T0 + MIN);
  assert.deepEqual(home.noteTimes("держится"), [T0 + MIN]);
  home.set("ДТВ1", "CurrentTemperature", 27);
  home.to(T0 + 80 * SEC);
  home.set("ДТВ1", "CurrentTemperature", 20);
  home.to(T0 + 90 * SEC);
  home.set("ДТВ1", "CurrentTemperature", 26);
  home.to(T0 + 120 * SEC);
  home.set("ДТВ1", "CurrentTemperature", 24);
  home.to(T0 + 10 * MIN);
  assert.deepEqual(home.noteTimes("держится"), [T0 + MIN], "прерванное удержание сработало");

  home.set("Р1", "On", true);
  home.to(T0 + 10 * MIN + 30 * SEC);
  home.press("В2");
  home.to(T0 + 11 * MIN);
  home.press("В2");
  assert.deepEqual(home.notes().slice(-2), ["недолго", "долго"]);
});

test("удержание «Менее N»: истинно, когда держалось меньше N и перестало", () => {
  const home = house({
    scenarios: (id) => [
      {
        id: "blink",
        name: "Мигнула",
        targets: [when([trig(ref(id("ДО1"), "ContactSensorState"), "eq", "CONTACT_NOT_DETECTED", { hold: { mode: "less", sec: 10 } })], [note("мигнула")])],
      },
    ],
  });
  home.sensor("ДО1", true);
  assert.deepEqual(home.notes(), [], "открытие запустило «Менее»");
  home.to(T0 + 5 * SEC);
  home.sensor("ДО1", false);
  assert.deepEqual(home.noteTimes("мигнула"), [T0 + 5 * SEC]);
  home.to(T0 + 20 * SEC);
  home.sensor("ДО1", true);
  home.to(T0 + 40 * SEC);
  home.sensor("ДО1", false);
  assert.deepEqual(home.notes(), ["мигнула"], "долгое открытие дало «Менее»");
});

// ——— часы, сброс, остановка ——————————————————————————————————————————————————————

test("время назад ничего не запускает: задержки ждут своего времени, расписания пересчитываются", () => {
  const home = house({
    scenarios: (id) => [
      { id: "seven", name: "Семь", targets: [when([schedule({ mode: "time", at: "07:00" })], [note("семь")])] },
      { id: "wait", name: "Ждёт", targets: [when([trig(ref(id("ДД2"), "MotionDetected"), "eq", true)], [delay(1, 60, "one", [note("ждал")])])] },
    ],
  });
  home.sensor("ДД2");
  home.engine.setClock({ simMs: FRI + 6 * HOUR });
  assert.deepEqual(home.notes(), [], "перевод назад запустил сценарий");
  assert.equal(home.engine.nextAt(), FRI + 7 * HOUR, "расписание не пересчитано от нового времени");
  home.to(FRI + 7 * HOUR);
  assert.deepEqual(home.notes(), ["семь"]);
  home.to(T0 + MIN - 1);
  assert.deepEqual(home.notes(), ["семь"]);
  home.to(T0 + MIN);
  assert.deepEqual(home.notes(), ["семь", "ждал"]);
});

test("«Сбросить дом» забывает память ∞ и заново заводит расписания; остановка снимает всё до нового запуска", () => {
  const home = house({
    scenarios: (id) => [
      { id: "edge", name: "Граница", targets: [when([trig(ref(id("ДТВ1"), "CurrentTemperature"), "gt", 25, { repeat: false })], [note("жарко")])] },
      { id: "tick", name: "Тик", targets: [when([schedule({ mode: "every", everySec: 600 })], [note("тик")])] },
    ],
  });
  home.set("ДТВ1", "CurrentTemperature", 26);
  home.to(T0 + 5 * MIN);
  home.engine.reset();
  assert.equal(home.value("ДТВ1", "CurrentTemperature"), 22);
  assert.equal(home.engine.nextAt(), T0 + 15 * MIN, "«каждые» не заведены от сброса");
  home.set("ДТВ1", "CurrentTemperature", 26);
  assert.deepEqual(home.notes(), ["жарко", "жарко"], "память ∞ пережила «Сбросить дом»");

  home.engine.stop();
  home.to(T0 + HOUR);
  assert.deepEqual(home.notes(), ["жарко", "жарко"], "остановленный дом исполнил расписание");
  home.engine.start();
  home.to(T0 + HOUR + 10 * MIN);
  assert.deepEqual(home.notes(), ["жарко", "жарко", "тик"]);
});
