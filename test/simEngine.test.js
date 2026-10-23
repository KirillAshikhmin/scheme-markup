// Движок имитации умного дома (таск 04 сценариев): дом, состояния, прямые
// связи клавиш, датчики, поведения «как настоящие», запуск и остановка,
// цепочки причин и дверь для хозяев сценариев. Истории 1.17, 2.3, 2.5–2.10,
// 2.15, 2.17, 2.18, 6.1; `interfaces.md` — строка `sim/engine.js`, «Действия»,
// «Запись журнала». Дом — фикстура `test/fixtures/simHome.js`.
import test from "node:test";
import assert from "node:assert/strict";

import { SIM_CHAIN_MAX, createSimEngine } from "../src/sim/engine.js";
import { buildHomeSpec } from "../src/sim/home.js";
import { addScenario, createProject, setMarkDevice, setTypeDevice } from "../src/model.js";
import { simBigHouse, simHouse, simHouseSpec, simLegacySwitchProject, simLink, simPut, simRecorder } from "./fixtures/simHome.js";

// Полдень 23 октября 2026 года в местных миллисекундах часов имитации.
const T0 = Date.UTC(2026, 9, 23, 12, 0, 0);
const SEC = 1000;
const MIN = 60 * SEC;

function setup({ owners = [], box = simHouse(), start = true } = {}) {
  const recorder = simRecorder();
  const engine = createSimEngine({ emit: recorder.emit, owners });
  engine.load(simHouseSpec(box));
  engine.setClock({ simMs: T0 });
  if (start) engine.start();
  const id = (label) => box.marks[label];
  return {
    box,
    recorder,
    engine,
    id,
    value: (label, char, service = 0) => engine.value(id(label), service, char),
    set: (label, char, value, service = 0) => engine.act({ kind: "set", markId: id(label), service, char, value }),
    press: (label, press = "single", service = 0) => engine.act({ kind: "press", markId: id(label), service, press }),
    // Записи журнала про метку (по умолчанию — изменения).
    entries: (label, char, kind = "change") =>
      recorder.log().filter((entry) => entry.kind === kind && entry.markId === id(label) && (!char || entry.char === char)),
  };
}

function kinds(chain) {
  return chain.map((cause) => cause.k);
}

// Выключатели с профилем G11: сначала «Выключатель» на каждый канал, затем
// кнопки. В1: 0 — «Выключатель», 1 — кнопка; ВВ1: 0, 1 — «Выключатели»,
// 2, 3 — кнопки клавиш 1 и 2.
const B1_RELAY = 0;
const B1_KEY = 1;
const DUO_KEY1 = 2;
const DUO_KEY2 = 3;

// Дом, где типы В и ВВ хранят профиль, сохранённый до G11: вид `switch`, одни
// кнопки — сервис 0 у В1, 0 и 1 у ВВ1.
function legacyHouse() {
  const box = simHouse();
  for (const code of ["В", "ВВ"]) {
    const type = box.project.markTypes.find((item) => item.code === code);
    box.project = setTypeDevice(box.project, type.id, { kind: "switch" }).project;
  }
  return box;
}

// ——— состояние и значения ——————————————————————————————————————————————

test("значение вне диапазона зажимается по метаданным, запись того же значения — без события", () => {
  const home = setup();
  assert.equal(home.set("С1", "Brightness", 40), true);
  assert.equal(home.value("С1", "Brightness"), 40);
  home.set("С1", "Brightness", 400);
  assert.equal(home.value("С1", "Brightness"), 100, "яркость выше 100 %");
  home.set("С1", "Brightness", -5);
  assert.equal(home.value("С1", "Brightness"), 0);
  home.set("С1", "Brightness", 33.4);
  assert.equal(home.value("С1", "Brightness"), 33, "целое с шагом 1 не округлено");
  home.set("ДТВ1", "CurrentTemperature", 22.34);
  assert.equal(home.value("ДТВ1", "CurrentTemperature"), 22.3, "шаг 0,1");
  home.set("ДТВ1", "CurrentTemperature", -100);
  assert.equal(home.value("ДТВ1", "CurrentTemperature"), -40);
  // Перечисление принимает и числовой код Sprut.
  home.set("ДО1", "ContactSensorState", 1);
  assert.equal(home.value("ДО1", "ContactSensorState"), "CONTACT_NOT_DETECTED");

  home.recorder.clear();
  assert.equal(home.set("С1", "On", false), false, "запись того же значения — изменение");
  assert.equal(home.set("С1", "Brightness", 33), false);
  assert.deepEqual(home.recorder.changes(), [], "то же значение ушло в изменения");
  assert.deepEqual(home.recorder.log(), [], "то же значение попало в журнал");
});

test("изменения уходят наружу сообщением changes, журнал — сообщением log", () => {
  const home = setup();
  home.recorder.clear();
  home.set("С1", "On", true);
  const [changes, log] = home.recorder.messages;
  assert.equal(changes.type, "changes");
  assert.deepEqual(changes.list, [{ markId: home.id("С1"), service: 0, char: "On", value: true, at: T0 }]);
  assert.equal(log.type, "log");
  const [entry] = log.entries;
  assert.equal(entry.kind, "change");
  assert.equal(entry.at, T0);
  assert.equal(entry.markId, home.id("С1"));
  assert.equal(entry.service, 0);
  assert.equal(entry.char, "On");
  assert.equal(entry.from, false);
  assert.equal(entry.to, true);
  assert.equal(typeof entry.text, "string");
  assert.deepEqual(structuredClone(home.recorder.messages), home.recorder.messages, "сообщение не передать в Worker");
});

// ——— привязанная и отвязанная клавиша —————————————————————————————————————

test("привязанная клавиша (G11): щелчок переключает «Выключатель» канала, свет следует за ним; кнопка событий не шлёт", () => {
  const home = setup();
  assert.equal(home.press("В1", "single", B1_KEY), true);
  assert.equal(home.value("В1", "On", B1_RELAY), true, "«Выключатель» клавиши не включился");
  assert.equal(home.value("С1", "On"), true, "свет не включился");
  home.press("В1", "single", B1_KEY);
  assert.equal(home.value("В1", "On", B1_RELAY), false);
  assert.equal(home.value("С1", "On"), false, "свет не выключился");
  // Щелчок по выключателю без выбора клавиши — первая клавиша.
  home.engine.act({ kind: "toggle", markId: home.id("В1") });
  assert.equal(home.value("С1", "On"), true);
  home.engine.act({ kind: "toggle", markId: home.id("В1"), service: B1_KEY });
  assert.equal(home.value("С1", "On"), false);
  assert.deepEqual(home.entries("В1", null, "press"), [], "кнопка привязанной клавиши прислала нажатие");
  assert.equal(home.entries("В1", "On").length, 4, "«Выключатель» переключился не по щелчку");
});

test("профиль до G11 (одни кнопки): щелчок включает нагрузки канала, следующий выключает; нажатие — в события", () => {
  const home = setup({ box: legacyHouse() });
  assert.equal(home.press("В1"), true);
  assert.equal(home.value("С1", "On"), true, "свет не включился");
  const [press] = home.entries("В1", null, "press");
  assert.equal(press.char, "ProgrammableSwitchEvent");
  assert.equal(press.to, "SINGLE_PRESS");
  home.press("В1");
  assert.equal(home.value("С1", "On"), false, "свет не выключился");
  // Щелчок по выключателю без выбора клавиши — одиночное нажатие первой.
  home.engine.act({ kind: "toggle", markId: home.id("В1") });
  assert.equal(home.value("С1", "On"), true);
  assert.equal(home.entries("В1", null, "press").length, 3);
});

test("нагрузки следуют за «Выключателем» (G11): включился — все вкл, выключился — все выкл; штора — открыть и закрыть", () => {
  const home = setup();
  home.set("Т1", "On", true);
  home.press("ВВ1", "single", DUO_KEY1);
  assert.deepEqual([home.value("С2", "On"), home.value("Т1", "On")], [true, true], "включённый «Выключатель» не включил всё");
  home.press("ВВ1", "single", DUO_KEY1);
  assert.deepEqual([home.value("С2", "On"), home.value("Т1", "On")], [false, false], "выключенный «Выключатель» не выключил всё");
  // Вторая клавиша — свой канал: штора открывается и закрывается.
  home.press("ВВ1", "single", DUO_KEY2);
  assert.equal(home.value("ВВ1", "On", 1), true);
  assert.equal(home.value("КШ1", "TargetPosition"), 100);
  assert.deepEqual([home.value("С2", "On"), home.value("Т1", "On")], [false, false], "вторая клавиша тронула первый канал");
  home.press("ВВ1", "single", DUO_KEY2);
  assert.equal(home.value("КШ1", "TargetPosition"), 0);
});

test("профиль до G11: в канале что-то включено — щелчок выключает все нагрузки, иначе включает все", () => {
  const home = setup({ box: legacyHouse() });
  home.set("С2", "On", true);
  home.press("ВВ1", "single", 0);
  assert.deepEqual([home.value("С2", "On"), home.value("Т1", "On")], [false, false], "включённое в канале не погасило всё");
  home.press("ВВ1", "single", 0);
  assert.deepEqual([home.value("С2", "On"), home.value("Т1", "On")], [true, true]);
  // Вторая клавиша — свой канал: штора открывается и закрывается.
  home.press("ВВ1", "single", 1);
  assert.equal(home.value("КШ1", "TargetPosition"), 100);
  assert.deepEqual([home.value("С2", "On"), home.value("Т1", "On")], [true, true], "вторая клавиша тронула первый канал");
  home.press("ВВ1", "single", 1);
  assert.equal(home.value("КШ1", "TargetPosition"), 0);
});

test("нагрузки клавиши: свет, реле, розетка, вентилятор, телевизор — On/Active", () => {
  const box = simHouse();
  simLink(box, "В1", [
    ["С1", 1],
    ["ТВ1", 1],
    ["Р1", 1],
    ["Б1", 1],
  ]);
  const home = setup({ box });
  home.press("В1", "single", B1_KEY);
  assert.deepEqual(
    [home.value("С1", "On"), home.value("ТВ1", "Active"), home.value("Р1", "On"), home.value("Б1", "Active")],
    [true, "ACTIVE", true, "ACTIVE"],
  );
  home.set("ТВ1", "Active", "INACTIVE");
  home.press("В1", "single", B1_KEY);
  assert.deepEqual(
    [home.value("С1", "On"), home.value("ТВ1", "Active"), home.value("Р1", "On"), home.value("Б1", "Active")],
    [false, "INACTIVE", false, "INACTIVE"],
  );
});

test("«Выключатель», поставленный сценарием или логикой, ведёт нагрузки так же — и у отвязанной клавиши", () => {
  // Хозяин-зонд пишет «Выключатель» так, как пишут блочные и логические
  // сценарии: `host.write` со своим звеном в цепочке.
  const probeHome = (box) => {
    let host = null;
    const home = setup({ owners: [{ name: "probe", load: (spec, own) => (host = own) }], box });
    home.write = (label, service, value) => {
      const done = host.write({ markId: home.id(label), service, char: "On", value, chain: [{ k: "scenario", scenarioId: "s1" }] });
      home.engine.advanceTo(home.engine.now());
      return done;
    };
    return home;
  };
  const home = probeHome(simHouse());
  assert.equal(home.write("В1", B1_RELAY, true), true);
  assert.equal(home.value("С1", "On"), true, "запись сценария в «Выключатель» не включила свет");
  const [lit] = home.entries("С1", "On");
  assert.deepEqual(kinds(lit.chain), ["char", "scenario"], "свет без причины «Выключатель ← сценарий»");
  home.write("ВВ1", 1, true);
  assert.equal(home.value("КШ1", "TargetPosition"), 100, "штора не поехала за «Выключателем»");
  home.write("ВВ1", 1, false);
  assert.equal(home.value("КШ1", "TargetPosition"), 0);
  // Карточка аксессуара: «Выключатель» напрямую — как у реле.
  home.engine.act({ kind: "toggle", markId: home.id("В1"), service: B1_RELAY });
  assert.equal(home.value("С1", "On"), false);
  // Отвязанная клавиша: «Выключатель» остаётся сценариям и ведёт нагрузки.
  const box = simHouse();
  box.project = setMarkDevice(box.project, box.marks["В1"], { decoupled: [1] }).project;
  const loose = probeHome(box);
  loose.write("В1", B1_RELAY, true);
  assert.equal(loose.value("С1", "On"), true, "у отвязанной клавиши «Выключатель» не ведёт нагрузки");
  assert.deepEqual(loose.entries("В1", null, "press"), [], "запись «Выключателя» прислала нажатие");
});

test("двойное и долгое на привязанной клавише — ничего; отвязанная (G11) — события кнопки, «Выключатель» не меняется", () => {
  const home = setup();
  assert.equal(home.press("В1", "double", B1_KEY), false);
  assert.equal(home.press("В1", "long", B1_KEY), false);
  assert.equal(home.value("В1", "On", B1_RELAY), false, "двойное или долгое переключило «Выключатель»");
  assert.equal(home.value("С1", "On"), false, "двойное или долгое переключило нагрузку");
  assert.deepEqual(home.entries("В1", null, "press"), [], "привязанная клавиша прислала нажатие");

  const box = simHouse();
  box.project = setMarkDevice(box.project, box.marks["В1"], { decoupled: [1] }).project;
  const loose = setup({ box });
  assert.equal(loose.press("В1", "single", B1_KEY), true);
  loose.press("В1", "double", B1_KEY);
  loose.press("В1", "long", B1_KEY);
  loose.engine.act({ kind: "toggle", markId: loose.id("В1") });
  assert.deepEqual(
    loose.entries("В1", null, "press").map((entry) => [entry.service, entry.to]),
    [
      [B1_KEY, "SINGLE_PRESS"],
      [B1_KEY, "DOUBLE_PRESS"],
      [B1_KEY, "LONG_PRESS"],
      [B1_KEY, "SINGLE_PRESS"],
    ],
  );
  assert.equal(loose.value("В1", "On", B1_RELAY), false, "щелчок по отвязанной клавише переключил «Выключатель»");
  assert.equal(loose.value("С1", "On"), false, "отвязанная клавиша переключила нагрузку");
});

test("профиль до G11: двойное и долгое на привязанной клавише — только события; отвязанная — только события", () => {
  const home = setup({ box: legacyHouse() });
  home.press("В1", "double");
  home.press("В1", "long");
  assert.equal(home.value("С1", "On"), false, "двойное или долгое переключило нагрузку");
  assert.deepEqual(
    home.entries("В1", null, "press").map((entry) => entry.to),
    ["DOUBLE_PRESS", "LONG_PRESS"],
  );
  // В2 отвязана: связь со С3 есть, но щелчок её не трогает.
  assert.equal(home.press("В2"), true);
  assert.equal(home.value("С3", "On"), false, "отвязанная клавиша переключила нагрузку");
  assert.deepEqual(home.entries("В2", null, "press").map((entry) => entry.to), ["SINGLE_PRESS"]);
});

test("G68: объект с профилем до G11 работает как прежде — щелчок переключает нагрузки и шлёт одиночное нажатие", () => {
  const legacy = simLegacySwitchProject();
  const recorder = simRecorder();
  const engine = createSimEngine({ emit: recorder.emit });
  engine.load(buildHomeSpec(legacy.project));
  engine.setClock({ simMs: T0 });
  engine.start();
  const at = (label) => legacy.marks[label];
  const presses = (label) =>
    recorder.log().filter((entry) => entry.kind === "press" && entry.markId === at(label)).map((entry) => [entry.service, entry.to]);
  engine.act({ kind: "press", markId: at("В1"), service: 0, press: "single" });
  assert.equal(engine.value(at("Т1"), 0, "On"), true, "щелчок по клавише до G11 не включил свет");
  assert.deepEqual(presses("В1"), [[0, "SINGLE_PRESS"]], "щелчок по клавише до G11 не прислал нажатие");
  engine.act({ kind: "toggle", markId: at("В1") });
  assert.equal(engine.value(at("Т1"), 0, "On"), false);
  engine.act({ kind: "press", markId: at("ВВ1"), service: 0, press: "single" });
  assert.equal(engine.value(at("Р1"), 0, "On"), true);
  // Клавиша 2 ВВ1 отвязана у типа, клавиша В2 — своей настройкой: только нажатия.
  engine.act({ kind: "press", markId: at("ВВ1"), service: 1, press: "double" });
  engine.act({ kind: "press", markId: at("В2"), service: 0, press: "single" });
  assert.equal(engine.value(at("Л1"), 0, "On"), false, "отвязанная клавиша переключила ленту");
  assert.equal(engine.value(at("Т1"), 0, "On"), false, "отвязанная В2 переключила свет");
  assert.deepEqual(presses("ВВ1"), [[0, "SINGLE_PRESS"], [1, "DOUBLE_PRESS"]]);
  assert.deepEqual(presses("В2"), [[0, "SINGLE_PRESS"]]);
});

test("связь без номера канала: у одной клавиши — её, у нескольких — ничья", () => {
  const box = simHouse();
  simLink(box, "В1", [["С1", null]]);
  simLink(box, "ВВ1", [["С2", null]]);
  const home = setup({ box });
  home.press("В1", "single", B1_KEY);
  assert.equal(home.value("С1", "On"), true, "единственная клавиша не взяла связь без номера");
  home.press("ВВ1", "single", DUO_KEY1);
  home.press("ВВ1", "single", DUO_KEY2);
  assert.equal(home.value("С2", "On"), false, "связь без номера досталась клавише многоклавишного");
});

test("щелчок по устройству: свет и реле переключаются, штора открывается и закрывается", () => {
  const home = setup();
  const toggle = (label) => home.engine.act({ kind: "toggle", markId: home.id(label) });
  toggle("С1");
  toggle("Р1");
  toggle("ТВ1");
  toggle("КВ1");
  assert.deepEqual(
    [home.value("С1", "On"), home.value("Р1", "On"), home.value("ТВ1", "Active"), home.value("КВ1", "Active")],
    [true, true, "ACTIVE", "ACTIVE"],
  );
  toggle("С1");
  assert.equal(home.value("С1", "On"), false);
  toggle("КШ1");
  assert.equal(home.value("КШ1", "TargetPosition"), 100);
  toggle("КШ1");
  assert.equal(home.value("КШ1", "TargetPosition"), 0);
});

// ——— датчики ——————————————————————————————————————————————————————————————

test("датчик движения: щелчок — движение, сброс через время сброса виртуального времени", () => {
  const home = setup();
  home.engine.act({ kind: "sensor", markId: home.id("ДД1") });
  assert.equal(home.value("ДД1", "MotionDetected"), true);
  assert.equal(home.engine.nextAt(), T0 + 60 * SEC, "сброс не через 60 с");
  home.engine.advanceTo(T0 + 60 * SEC - 1);
  assert.equal(home.value("ДД1", "MotionDetected"), true, "сбросился раньше времени");
  home.engine.advanceTo(T0 + 60 * SEC);
  assert.equal(home.value("ДД1", "MotionDetected"), false, "не сбросился");
  const [reset] = home.entries("ДД1", "MotionDetected").filter((entry) => entry.to === false);
  assert.equal(reset.at, T0 + 60 * SEC, "сброс записан не своим временем");

  // Время сброса правится в устройстве.
  const box = simHouse();
  box.project = setMarkDevice(box.project, box.marks["ДД2"], { params: { resetSec: 5 } }).project;
  const tuned = setup({ box });
  tuned.engine.act({ kind: "sensor", markId: tuned.id("ДД2") });
  tuned.engine.advanceTo(T0 + 5 * SEC);
  assert.equal(tuned.value("ДД2", "MotionDetected"), false, "своё время сброса не взялось");
});

test("ходьба: датчики помещения видят человека; вышел — присутствие сразу, движение через время сброса", () => {
  const home = setup();
  const walk = (...rooms) => home.engine.act({ kind: "presence", roomIds: rooms.map((key) => home.box.rooms[key]) });
  walk("living");
  assert.equal(home.value("ДП1", "OccupancyDetected"), "OCCUPANCY_DETECTED");
  assert.equal(home.value("ДД1", "MotionDetected"), false, "датчик коридора увидел гостиную");
  walk("hall");
  assert.equal(home.value("ДП1", "OccupancyDetected"), "OCCUPANCY_NOT_DETECTED", "присутствие не сбросилось сразу");
  assert.equal(home.value("ДД1", "MotionDetected"), true);
  // Пока человек в коридоре, движение не сбрасывается.
  home.engine.advanceTo(T0 + 10 * MIN);
  assert.equal(home.value("ДД1", "MotionDetected"), true, "движение сбросилось, пока человек в помещении");
  walk();
  home.engine.advanceTo(T0 + 10 * MIN + 59 * SEC);
  assert.equal(home.value("ДД1", "MotionDetected"), true);
  home.engine.advanceTo(T0 + 11 * MIN);
  assert.equal(home.value("ДД1", "MotionDetected"), false, "движение не сбросилось после ухода");
  // Датчик без помещения при ходьбе не срабатывает.
  assert.equal(home.entries("ДД2", "MotionDetected").length, 0);
  const [seen] = home.entries("ДП1", "OccupancyDetected");
  assert.deepEqual(kinds(seen.chain), ["walk"]);
});

test("датчик открытия ходит с дверью и щелчком; протечка, присутствие — щелчком; климат — set", () => {
  const home = setup();
  home.engine.act({ kind: "door", openingId: home.box.doors.front, open: true });
  assert.equal(home.value("ДО1", "ContactSensorState"), "CONTACT_NOT_DETECTED", "открытая дверь не открыла датчик");
  assert.deepEqual(kinds(home.entries("ДО1", "ContactSensorState")[0].chain), ["door"]);
  home.engine.act({ kind: "door", openingId: home.box.doors.front, open: false });
  assert.equal(home.value("ДО1", "ContactSensorState"), "CONTACT_DETECTED");
  home.engine.act({ kind: "sensor", markId: home.id("ДО1") });
  assert.equal(home.value("ДО1", "ContactSensorState"), "CONTACT_NOT_DETECTED", "щелчок не открыл датчик");

  home.engine.act({ kind: "sensor", markId: home.id("ДПр1") });
  assert.equal(home.value("ДПр1", "LeakDetected"), "LEAK_DETECTED");
  home.engine.act({ kind: "sensor", markId: home.id("ДПр1") });
  assert.equal(home.value("ДПр1", "LeakDetected"), "LEAK_NOT_DETECTED");
  home.engine.act({ kind: "sensor", markId: home.id("ДПр1"), value: true });
  home.engine.act({ kind: "sensor", markId: home.id("ДПр1"), value: true });
  assert.equal(home.value("ДПр1", "LeakDetected"), "LEAK_DETECTED", "явное значение переключило");

  home.engine.act({ kind: "sensor", markId: home.id("ДП1") });
  assert.equal(home.value("ДП1", "OccupancyDetected"), "OCCUPANCY_DETECTED");
  home.engine.act({ kind: "sensor", markId: home.id("ДП1") });
  assert.equal(home.value("ДП1", "OccupancyDetected"), "OCCUPANCY_NOT_DETECTED");

  home.set("ДТВ1", "CurrentTemperature", 25.5, 0);
  home.set("ДТВ1", "CurrentRelativeHumidity", 60, 1);
  assert.deepEqual([home.value("ДТВ1", "CurrentTemperature", 0), home.value("ДТВ1", "CurrentRelativeHumidity", 1)], [25.5, 60]);
});

// ——— поведения «как настоящие» ——————————————————————————————————————————————

test("штора доезжает до цели за время хода, PositionState — ход и остановка", () => {
  const home = setup();
  home.set("КШ1", "TargetPosition", 100);
  assert.equal(home.value("КШ1", "PositionState"), "INCREASING");
  assert.equal(home.value("КШ1", "CurrentPosition"), 0, "штора приехала мгновенно");
  home.engine.advanceTo(T0 + 10 * SEC);
  const half = home.value("КШ1", "CurrentPosition");
  assert.ok(half >= 40 && half <= 60, "за половину хода не половина пути: " + half);
  home.engine.advanceTo(T0 + 20 * SEC - 1);
  assert.ok(home.value("КШ1", "CurrentPosition") < 100, "доехала раньше времени хода");
  assert.equal(home.value("КШ1", "PositionState"), "INCREASING");
  home.engine.advanceTo(T0 + 20 * SEC);
  assert.equal(home.value("КШ1", "CurrentPosition"), 100, "не доехала за 20 с");
  assert.equal(home.value("КШ1", "PositionState"), "STOPPED");
  // Новая цель посреди хода — штора разворачивается.
  home.set("КШ1", "TargetPosition", 0);
  assert.equal(home.value("КШ1", "PositionState"), "DECREASING");
  home.engine.advanceTo(T0 + 30 * SEC);
  home.set("КШ1", "TargetPosition", 100);
  assert.equal(home.value("КШ1", "PositionState"), "INCREASING");
  home.engine.advanceTo(T0 + 60 * SEC);
  assert.equal(home.value("КШ1", "CurrentPosition"), 100);
  assert.equal(home.value("КШ1", "PositionState"), "STOPPED");
  assert.ok(home.engine.nextAt() === null, "после остановки что-то ждёт");

  // Время хода правится в устройстве.
  const box = simHouse();
  box.project = setMarkDevice(box.project, box.marks["КШ1"], { params: { travelSec: 10 } }).project;
  const quick = setup({ box });
  quick.set("КШ1", "TargetPosition", 100);
  quick.engine.advanceTo(T0 + 10 * SEC);
  assert.equal(quick.value("КШ1", "CurrentPosition"), 100, "своё время хода не взялось");
});

test("замок — текущее за целевым; термостат греет, пока текущая ниже целевой; низкий заряд < 20 %", () => {
  const home = setup();
  home.set("ЗМ1", "LockTargetState", "UNSECURED");
  assert.equal(home.value("ЗМ1", "LockCurrentState"), "UNSECURED", "замок не открылся");
  home.engine.act({ kind: "toggle", markId: home.id("ЗМ1") });
  assert.equal(home.value("ЗМ1", "LockTargetState"), "SECURED");
  assert.equal(home.value("ЗМ1", "LockCurrentState"), "SECURED");

  home.set("ТС1", "TargetHeatingCoolingState", "HEAT");
  assert.equal(home.value("ТС1", "CurrentHeatingCoolingState"), "OFF", "греет при равных температурах");
  home.set("ТС1", "TargetTemperature", 25);
  assert.equal(home.value("ТС1", "CurrentHeatingCoolingState"), "HEAT", "не греет, хотя холоднее цели");
  home.set("ТС1", "CurrentTemperature", 25);
  assert.equal(home.value("ТС1", "CurrentHeatingCoolingState"), "OFF", "греет, догнав цель");
  home.set("ТС1", "CurrentTemperature", 24.5);
  assert.equal(home.value("ТС1", "CurrentHeatingCoolingState"), "HEAT");
  home.set("ТС1", "TargetHeatingCoolingState", "OFF");
  assert.equal(home.value("ТС1", "CurrentHeatingCoolingState"), "OFF", "выключенный термостат греет");

  home.set("ДТВ1", "BatteryLevel", 19, 2);
  assert.equal(home.value("ДТВ1", "StatusLowBattery", 2), "BATTERY_LEVEL_LOW");
  home.set("ДТВ1", "BatteryLevel", 20, 2);
  assert.equal(home.value("ДТВ1", "StatusLowBattery", 2), "BATTERY_LEVEL_NORMAL");

  // Кран: вода идёт, пока он открыт.
  home.engine.act({ kind: "toggle", markId: home.id("КВ1") });
  assert.equal(home.value("КВ1", "InUse"), "IN_USE");
});

// ——— запуск, остановка, сброс ———————————————————————————————————————————————

test("до запуска дом не слушается; запуск — «Дом запущен», остановка снимает таймеры, состояния остаются", () => {
  const home = setup({ start: false });
  assert.equal(home.engine.running(), false);
  assert.equal(home.press("В1", "single", B1_KEY), false, "незапущенный дом переключил свет");
  assert.equal(home.value("С1", "On"), false);
  home.engine.start();
  assert.equal(home.engine.running(), true);
  assert.deepEqual(
    home.recorder.log().map((entry) => [entry.kind, entry.code]),
    [["system", "started"]],
  );
  home.engine.act({ kind: "sensor", markId: home.id("ДД1") });
  home.set("КШ1", "TargetPosition", 100);
  home.engine.advanceTo(T0 + 5 * SEC);
  const moving = home.value("КШ1", "CurrentPosition");
  home.engine.stop();
  assert.equal(home.engine.running(), false);
  assert.equal(home.recorder.log().at(-1).code, "stopped");
  assert.equal(home.engine.nextAt(), null, "после остановки что-то ждёт");
  home.engine.advanceTo(T0 + 10 * MIN);
  assert.equal(home.value("ДД1", "MotionDetected"), true, "остановка не сохранила состояние");
  assert.equal(home.value("КШ1", "CurrentPosition"), moving, "штора ехала в выключенном доме");
  // Новый запуск: штора доезжает, датчик сбрасывается от нового времени.
  home.engine.start();
  home.engine.advanceTo(T0 + 11 * MIN);
  assert.equal(home.value("КШ1", "CurrentPosition"), 100);
  assert.equal(home.value("ДД1", "MotionDetected"), false);
});

test("«Сбросить дом» — умолчания: выключено, закрыто, не обнаружено, 22 °C, 45 %, позиции 0", () => {
  const home = setup();
  home.press("В1", "single", B1_KEY);
  home.set("КШ1", "TargetPosition", 100);
  home.engine.advanceTo(T0 + 30 * SEC);
  home.engine.act({ kind: "door", openingId: home.box.doors.front, open: true });
  home.engine.act({ kind: "sensor", markId: home.id("ДД1") });
  home.set("ДТВ1", "CurrentTemperature", 30, 0);
  home.set("ДТВ1", "CurrentRelativeHumidity", 80, 1);
  home.recorder.clear();
  home.engine.reset();
  assert.deepEqual(
    [
      home.value("С1", "On"),
      home.value("В1", "On", B1_RELAY),
      home.value("КШ1", "CurrentPosition"),
      home.value("КШ1", "TargetPosition"),
      home.value("ДО1", "ContactSensorState"),
      home.value("ДД1", "MotionDetected"),
      home.value("ДТВ1", "CurrentTemperature", 0),
      home.value("ДТВ1", "CurrentRelativeHumidity", 1),
    ],
    [false, false, 0, 0, "CONTACT_DETECTED", false, 22, 45],
  );
  assert.deepEqual(home.recorder.log().map((entry) => entry.code), ["reset"], "сброс не записан или записан по строке на значение");
  const changed = home.recorder.changes().map((item) => item.markId + "." + item.char);
  assert.ok(changed.includes(home.id("С1") + ".On"), "сброс не сообщил странице");
  assert.equal(home.engine.nextAt(), null, "после сброса ждёт сброс датчика");
});

test("пустой дом: запуск доступен, журнал говорит, что устройств нет", () => {
  const recorder = simRecorder();
  const engine = createSimEngine({ emit: recorder.emit });
  engine.load(buildHomeSpec(createProject()));
  assert.equal(engine.start(), true);
  assert.deepEqual(recorder.log().map((entry) => [entry.kind, entry.code]), [
    ["system", "started"],
    ["system", "empty"],
  ]);
});

test("состояние дома снимается values() и поднимается start(values) без журнала изменений", () => {
  const first = setup();
  first.press("В1", "single", B1_KEY);
  first.engine.act({ kind: "sensor", markId: first.id("ДД1") });
  first.set("КШ1", "TargetPosition", 100);
  first.engine.advanceTo(T0 + 30 * SEC);
  const values = first.engine.values();
  assert.deepEqual(structuredClone(values), values);
  assert.equal(values[first.id("С1")]["0.On"], true);
  assert.equal(values[first.id("В1")][B1_RELAY + ".On"], true, "«Выключатель» клавиши не в состоянии");
  assert.equal(
    Object.prototype.hasOwnProperty.call(values[first.id("В1")], B1_KEY + ".ProgrammableSwitchEvent"),
    false,
    "событие кнопки попало в состояние",
  );

  const second = setup({ box: first.box, start: false });
  second.recorder.clear();
  second.engine.start(values);
  assert.equal(second.value("С1", "On"), true);
  assert.equal(second.value("КШ1", "CurrentPosition"), 100);
  assert.deepEqual(second.recorder.log().map((entry) => entry.code), ["started"], "восстановление расписано в журнале");
  assert.ok(second.recorder.changes().some((item) => item.markId === second.id("С1") && item.value === true), "странице не сказали");
  // Таймеры не переживают перезагрузку, но датчик со «движением» сбросится от запуска.
  second.engine.advanceTo(T0 + 60 * SEC);
  assert.equal(second.value("ДД1", "MotionDetected"), false);
});

// ——— цепочки причин ————————————————————————————————————————————————————————

test("цепочка причин: щелчок, связь клавиши, ходьба, дверь, таймер", () => {
  const home = setup();
  home.set("С2", "On", true);
  assert.deepEqual(home.entries("С2", "On")[0].chain, [{ k: "web", at: T0 }]);

  home.press("В1", "single", B1_KEY);
  const [lit] = home.entries("С1", "On");
  assert.deepEqual(kinds(lit.chain), ["char", "web"], "свет от клавиши без причины");
  const key = simHouseSpec(home.box).accessories.find((item) => item.markId === home.id("В1"));
  const cause = lit.chain[0];
  assert.equal(cause.markId, home.id("В1"));
  assert.equal(cause.service, B1_RELAY);
  assert.equal(cause.serviceType, "Switch");
  assert.equal(cause.char, "On");
  assert.equal(cause.value, true);
  assert.equal(cause.address, key.services[B1_RELAY].chars[0].address, "адрес характеристики не aid.sid.cid");

  home.engine.act({ kind: "sensor", markId: home.id("ДД1") });
  home.engine.advanceTo(T0 + MIN);
  const reset = home.entries("ДД1", "MotionDetected").find((entry) => entry.to === false);
  assert.deepEqual(kinds(reset.chain), ["timer", "char", "web"]);
});

test("предохранитель: цепочка глубже 50 обрывается записью в журнал", () => {
  // Два хозяина гоняют свет друг другу: С1 включился — переключи С2, С2
  // переключился — переключи С1. Без предохранителя это навсегда.
  const owner = {
    name: "pingpong",
    start(info, host) {
      host.subscribe({ char: "On", serviceTypes: ["Lightbulb"] }, (event) => {
        const other = event.markId === ids.С1 ? ids.С2 : event.markId === ids.С2 ? ids.С1 : null;
        if (!other) return;
        const now = host.value(other, 0, "On");
        host.write({ markId: other, service: 0, char: "On", value: !now, chain: [{ k: "scenario", scenarioId: "loop" }, ...event.chain] });
      });
    },
  };
  const ids = {};
  const home = setup({ owners: [owner], start: false });
  ids.С1 = home.id("С1");
  ids.С2 = home.id("С2");
  home.engine.start();
  home.set("С1", "On", true);
  const errors = home.recorder.log().filter((entry) => entry.kind === "error");
  assert.deepEqual(errors.map((entry) => entry.code), ["loop"], "петля не оборвана одной записью");
  // Каждый круг удлиняет цепочку на два звена (сценарий и характеристика):
  // запись с цепочкой 1, 3, …, 49 проходит, 51 — уже нет. Итого 25 изменений.
  const changes = home.recorder.log().filter((entry) => entry.kind === "change");
  assert.equal(changes.length, 25);
  assert.ok(changes.every((entry) => entry.chain.length <= SIM_CHAIN_MAX));
  assert.equal(SIM_CHAIN_MAX, 50);
});

// ——— дверь для хозяев сценариев ——————————————————————————————————————————————

// Тестовый хозяин: «движение в коридоре → свет на минуту», как блочный
// сценарий 2.4, но без блоков — через дверь движка.
function lightOwner(log) {
  return {
    name: "test",
    kinds: ["block"],
    load(home) {
      log.push(["load", home.accessories.length]);
    },
    start(info, host) {
      log.push(["start", info.reload, kinds(info.chain)]);
      const hall = host.home().accessories.find((item) => item.label === "ДД1").markId;
      const lamp = host.home().accessories.find((item) => item.label === "С1").markId;
      host.subscribe({ markId: hall, char: "MotionDetected" }, (event) => {
        log.push(["event", event.value, event.at]);
        if (event.value !== true) return;
        const chain = [{ k: "scenario", scenarioId: "s1" }, ...event.chain];
        host.log({ kind: "run", scenarioId: "s1", result: true, chain: event.chain, text: "Свет по движению" });
        host.write({ markId: lamp, service: 0, char: "On", value: true, chain });
        host.cancelTimers("off");
        host.timer(
          event.at + MIN,
          (at) => host.write({ markId: lamp, service: 0, char: "On", value: false, chain: [{ k: "timer", at }, ...chain] }),
          "off",
        );
      });
    },
    stop() {
      log.push(["stop"]);
    },
    reset() {
      log.push(["reset"]);
    },
    run(scenarioId, info, host) {
      log.push(["run", scenarioId, info.manual, kinds(info.chain)]);
    },
    setActive(scenarioId, on, host) {
      log.push(["active", scenarioId, on]);
      host.scenariosChanged();
    },
    clock(info) {
      log.push(["clock", info.from, info.to]);
    },
    scenarios: () => [{ id: "s1", active: true, running: false, fault: null }],
  };
}

test("дверь: хозяин получает старт, подписку на события, пишет значение со своей причиной, ставит таймер, пишет в журнал", () => {
  const log = [];
  const owner = lightOwner(log);
  const home = setup({ owners: [owner] });
  assert.deepEqual(log.slice(0, 2), [
    ["load", home.box.project.marks.length],
    ["start", false, ["hub"]],
  ]);
  home.engine.act({ kind: "sensor", markId: home.id("ДД1") });
  assert.equal(home.value("С1", "On"), true, "хозяин не включил свет");
  const [lit] = home.entries("С1", "On");
  assert.deepEqual(kinds(lit.chain), ["scenario", "char", "web"], "у записи хозяина нет его причины");
  assert.equal(lit.chain[1].markId, home.id("ДД1"));
  const [run] = home.recorder.log().filter((entry) => entry.kind === "run");
  assert.equal(run.scenarioId, "s1");
  assert.equal(run.at, T0);
  assert.equal(run.text, "Свет по движению");
  // Таймер хозяина — в виртуальном времени.
  assert.equal(home.engine.nextAt(), T0 + MIN);
  home.engine.advanceTo(T0 + MIN - 1);
  assert.equal(home.value("С1", "On"), true);
  home.engine.advanceTo(T0 + MIN);
  assert.equal(home.value("С1", "On"), false, "таймер хозяина не сработал");
  assert.equal(home.entries("С1", "On").at(-1).at, T0 + MIN);
  // Подписка с фильтром: сброс датчика пришёл, свет — нет.
  assert.deepEqual(
    log.filter((item) => item[0] === "event").map((item) => item[1]),
    [true, false],
  );
});

test("дверь: остановка снимает подписки и таймеры хозяина, новый запуск подписывает заново", () => {
  const log = [];
  const home = setup({ owners: [lightOwner(log)] });
  home.engine.act({ kind: "sensor", markId: home.id("ДД1") });
  home.engine.stop();
  assert.deepEqual(log.at(-1), ["stop"]);
  home.engine.advanceTo(T0 + 5 * MIN);
  assert.equal(home.value("С1", "On"), true, "таймер хозяина пережил остановку");
  home.engine.start();
  home.set("ДД1", "MotionDetected", false);
  home.set("ДД1", "MotionDetected", true);
  const events = log.filter((item) => item[0] === "event");
  assert.deepEqual(events.slice(-2).map((item) => item[1]), [false, true], "событие пришло дважды или не пришло");
  assert.equal(events.length, 3);
});

test("дверь: фильтры подписки, отписка, запись того же значения, вычисление до записи", () => {
  const seen = [];
  let off = null;
  const owner = {
    name: "filters",
    start(info, host) {
      host.subscribe({ serviceTypes: ["Lightbulb"], charTypes: ["On"] }, (event) => seen.push(["light", event.markId]));
      host.subscribe({ service: 1 }, (event) => seen.push(["second", event.char]));
      off = host.subscribe({}, (event) => seen.push(["all", event.char]));
    },
    compute(write) {
      return write.char === "Brightness" && write.value > 80 ? 80 : undefined;
    },
  };
  const home = setup({ owners: [owner] });
  home.set("С1", "On", true);
  home.set("ДТВ1", "CurrentRelativeHumidity", 50, 1);
  assert.deepEqual(seen, [
    ["light", home.id("С1")],
    ["all", "On"],
    ["second", "CurrentRelativeHumidity"],
    ["all", "CurrentRelativeHumidity"],
  ]);
  off();
  seen.length = 0;
  home.set("С1", "On", false);
  assert.deepEqual(seen, [["light", home.id("С1")]], "отписка не сработала");
  home.set("С1", "Brightness", 95);
  assert.equal(home.value("С1", "Brightness"), 80, "вычисление до записи не применилось");
});

test("дверь: исполнитель кода одного хозяина доступен другому; ручной запуск и активность — хозяину вида", () => {
  const log = [];
  let blocks = null;
  const runner = {
    name: "hub",
    kinds: ["logic", "global"],
    runCode(request) {
      if (request.code === "throw") return { ok: false, error: "boom", line: 1 };
      return { ok: true, value: request.code === "return true" };
    },
  };
  const owner = lightOwner(log);
  const start = owner.start;
  owner.start = (info, host) => {
    blocks = host;
    start(info, host);
  };
  const box = simHouse();
  const added = addScenario(box.project, { kind: "block", name: "Свет" });
  box.project = added.project;
  const home = setup({ owners: [runner, owner], box });
  const chain = [{ k: "scenario", scenarioId: added.scenario.id }];
  assert.deepEqual(blocks.runCode({ code: "return true", kind: "condition", scenarioId: added.scenario.id, blockId: "b1", chain }), {
    ok: true,
    value: true,
  });
  assert.deepEqual(blocks.runCode({ code: "throw", kind: "action", chain }), { ok: false, error: "boom", line: 1 });

  home.recorder.clear();
  assert.equal(home.engine.runScenario(added.scenario.id), true);
  assert.deepEqual(log.at(-1), ["run", added.scenario.id, true, ["web"]]);
  assert.equal(home.engine.runScenario("нет-такого"), false);
  home.engine.setScenarioActive(added.scenario.id, false);
  assert.deepEqual(log.at(-1), ["active", added.scenario.id, false]);
  const lists = home.recorder.messages.filter((message) => message.type === "scenarios");
  assert.ok(lists.length >= 1, "список сценариев не отправлен");
  assert.deepEqual(lists.at(-1).list, [{ id: "s1", active: true, running: false, fault: null }]);

  // Без исполнителя — честный отказ, а не исключение.
  let door = null;
  const lone = {
    name: "lone",
    start(info, host) {
      door = host;
    },
  };
  const solo = setup({ owners: [lone] });
  assert.equal(solo.engine.running(), true);
  assert.deepEqual(door.runCode({ code: "return 1", kind: "condition", chain: [] }), {
    ok: false,
    error: null,
    line: null,
    code: "noRunner",
  });
});

test("дверь: ошибка хозяина не роняет дом и пишется в журнал; перевод часов — хозяину", () => {
  const log = [];
  const broken = {
    name: "broken",
    start(info, host) {
      host.subscribe({}, () => {
        throw new Error("сломался");
      });
    },
  };
  const home = setup({ owners: [broken, lightOwner(log)] });
  home.engine.act({ kind: "sensor", markId: home.id("ДД1") });
  assert.equal(home.value("С1", "On"), true, "ошибка одного хозяина остановила другого");
  const errors = home.recorder.log().filter((entry) => entry.kind === "error");
  assert.ok(errors.length >= 1);
  assert.equal(errors[0].code, "ownerError");
  assert.equal(errors[0].vars.owner, "broken");

  // Время назад ничего не запускает, хозяин узнаёт о переводе часов.
  home.engine.setClock({ simMs: T0 - 3600 * SEC });
  assert.deepEqual(log.at(-1), ["clock", T0, T0 - 3600 * SEC]);
  assert.equal(home.value("С1", "On"), true, "перевод назад запустил таймер");
  assert.equal(home.engine.now(), T0 - 3600 * SEC);
});

test("дверь: перестройка дома на ходу сохраняет состояния и заново заводит хозяев", () => {
  const log = [];
  const home = setup({ owners: [lightOwner(log)] });
  home.press("В1", "single", B1_KEY);
  const added = simPut(home.box, "С", { x: 0.9, y: 0.9 }, "bedroom");
  home.recorder.clear();
  home.engine.load(simHouseSpec(home.box));
  assert.equal(home.value("С1", "On"), true, "перестройка погасила свет");
  assert.equal(home.engine.value(added, 0, "On"), false);
  assert.ok(home.recorder.changes().some((item) => item.markId === added), "новое устройство не сообщено странице");
  assert.ok(!home.recorder.changes().some((item) => item.markId === home.id("С1")), "старое значение сообщено как изменение");
  assert.deepEqual(log.slice(-2).map((item) => item.slice(0, 2)), [
    ["load", home.box.project.marks.length],
    ["start", true],
  ]);
  // Подписка одна, а не две.
  home.engine.act({ kind: "sensor", markId: home.id("ДД1") });
  assert.equal(log.filter((item) => item[0] === "event").length, 1);
});

test("хозяева стартуют по порядку списка: сначала скрипты, потом блоки", () => {
  const order = [];
  const make = (name) => ({ name, start: () => order.push(name) });
  setup({ owners: [make("hub"), make("blocks")] });
  assert.deepEqual(order, ["hub", "blocks"]);
});

// ——— нормы скорости (история 2.18) ——————————————————————————————————————————

// Норма по часам стены — медиана повторов после прогрева (ревью ветки, F1):
// `npm test` открывает выкладку и идёт файлами параллельно, и одиночный замер
// под чужой нагрузкой валил прогон («1000 нажатий заняли 102.6 мс»). Пороги —
// с запасом больше ×10 к обычному времени (запуск ≈ 5 мс, 1000 нажатий ≈ 5 мс).
function medianMs(fn, { runs = 7, warmup = 2 } = {}) {
  for (let index = 0; index < warmup; index += 1) fn();
  const times = [];
  for (let index = 0; index < runs; index += 1) {
    const started = performance.now();
    fn();
    times.push(performance.now() - started);
  }
  times.sort((first, second) => first - second);
  return times[Math.floor(times.length / 2)];
}

test("большой дом: 500 устройств запускаются быстрее 1 с, 1000 событий — быстрее 100 мс", () => {
  const box = simBigHouse(100);
  let delivered = 0;
  const owner = {
    name: "counter",
    start(info, host) {
      host.subscribe({}, () => {
        delivered += 1;
      });
    },
  };
  let engine = null;
  let spec = null;
  const launch = () => {
    spec = buildHomeSpec(box.project);
    engine = createSimEngine({ emit: simRecorder().emit, owners: [owner] });
    engine.load(spec);
    engine.setClock({ simMs: T0 });
    engine.start();
  };
  const startMs = medianMs(launch, { runs: 5, warmup: 1 });
  assert.equal(spec.accessories.length, 500);
  assert.ok(startMs < 1000, "запуск занял " + startMs.toFixed(1) + " мс (медиана)");

  const switches = box.groups.map((group) => group.switch);
  const presses = () => {
    for (let index = 0; index < 1000; index += 1) {
      engine.act({ kind: "press", markId: switches[index % switches.length], service: B1_KEY, press: "single" });
    }
  };
  delivered = 0;
  presses();
  // Каждое нажатие — событие «Выключателя» клавиши и переключение света.
  assert.equal(delivered, 2000);
  const eventsMs = medianMs(presses);
  assert.ok(eventsMs < 100, "1000 нажатий заняли " + eventsMs.toFixed(1) + " мс (медиана)");
});
