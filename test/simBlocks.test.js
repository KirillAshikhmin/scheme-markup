// Блочные сценарии (таск 05): хозяин блоков на двери движка — триггеры,
// поправка заказчика G08 (событие триггера на любом уровне запускает весь
// сценарий со всеми проверками), «Одно из / Все сразу» и группы условий,
// ∞ у числовых сравнений (G07), «Иначе», действия над характеристиками,
// другие сценарии, «Последовательное выполнение», код через исполнитель,
// уведомление и HTTP, неполные блоки и удалённые метки, журнал условий.
// Истории 4.4–4.8, 4.11–4.17, 4.19–4.21, 4.23, 4.26; `research/spruthub-wiki.md`
// §2.5–§2.9 (поправки G07, G08 важнее вики). Время, задержки, расписания,
// период и удержание — `simBlocksTime.test.js`.
import test from "node:test";
import assert from "node:assert/strict";

import { createSimEngine } from "../src/sim/engine.js";
import { buildHomeSpec } from "../src/sim/home.js";
import { simCharMeta } from "../src/sim/catalog.js";
import { blocksCommandTexts, blocksOwner, blocksPrepare, blocksRepeatAllowed, commandKey } from "../src/sim/blocks.js";
import { addScenario, addType, deleteMark, moveScenario, setMarkDevice } from "../src/model.js";
import { simBigHouse, simHouse, simPut, simRecorder } from "./fixtures/simHome.js";

// Полдень пятницы 23 октября 2026 года в местных миллисекундах часов имитации.
const T0 = Date.UTC(2026, 9, 23, 12, 0, 0);

// ——— сборка блоков ————————————————————————————————————————————————————————

let seq = 0;
const nid = (prefix) => prefix + (seq += 1);

const ref = (markId, char, service = 0) => ({ markId, service, char });
const cond = (at, op, value, extra = {}) => ({ type: "device", id: nid("c"), ref: at, op, value, trigger: false, ...extra });
const trig = (at, op, value, extra = {}) => cond(at, op, value, { trigger: true, ...extra });
const group = (mode, conditions, id = nid("g")) => ({ type: "group", id, mode, conditions });
const when = (conditions, then, other = null, { id = nid("if"), mode = "OR", every = null } = {}) => ({
  type: "if",
  id,
  if: group(mode, conditions),
  then,
  else: other,
  every,
});
const act = (at, items, id = nid("a")) => ({ type: "device", id, ref: { markId: at.markId, service: at.service }, items });
const put = (at, value, id) => act(at, [{ char: at.char, verb: "set", value }], id);
const note = (text, id = nid("n")) => ({ type: "notify", id, text });
const command = (text, id = nid("k")) => ({ type: "command", id, text });
const other = (verb, scenarioId, id = nid("s")) => ({ type: "scenario", id, verb, scenarioId });

// ——— дом с хозяином блоков ———————————————————————————————————————————————————

/**
 * Дом-фикстура с блочными сценариями: `scenarios(id, box)` — список
 * сценариев (`{id, name, targets, …}`), `id(обозначение)` — `markId`.
 */
function house({ scenarios = () => [], owners = [], box = simHouse(), start = true, prepare } = {}) {
  const id = (label) => box.marks[label];
  if (prepare) prepare(box, id);
  for (const scenario of scenarios(id, box)) box.project = addScenario(box.project, { kind: "block", ...scenario }).project;
  const recorder = simRecorder();
  const engine = createSimEngine({ emit: recorder.emit, owners: [...owners, blocksOwner()] });
  engine.load(buildHomeSpec(box.project));
  engine.setClock({ simMs: T0 });
  if (start) engine.start();
  return {
    box,
    engine,
    recorder,
    id,
    value: (label, char, service = 0) => engine.value(id(label), service, char),
    set: (label, char, value, service = 0) => engine.act({ kind: "set", markId: id(label), service, char, value }),
    press: (label, press = "single", service = 0) => engine.act({ kind: "press", markId: id(label), service, press }),
    say: (text) => engine.act({ kind: "command", text, cause: "web" }),
    sensor: (label, value) => engine.act({ kind: "sensor", markId: id(label), value }),
    notes: () => recorder.log().filter((entry) => entry.kind === "notify").map((entry) => entry.vars.text),
    entries: (code) => recorder.log().filter((entry) => entry.code === code),
  };
}

function kinds(chain) {
  return chain.map((cause) => cause.k);
}

// Нажатия шлёт только отвязанная клавиша (G11): у ВВ1 отвязывается клавиша 2 —
// её кнопка стоит после двух «Выключателей», сервис 3.
const DUO_KEY2 = 3;
function decoupleDuoKey2(box, id) {
  box.project = setMarkDevice(box.project, id("ВВ1"), { decoupled: [2] }).project;
}

// Дом с датчиком освещённости в спальне (свой тип человека): дерево §2.5 вики.
function withLux(box) {
  const base = box.project.markTypes.find((type) => type.code === "ДД");
  box.project = addType(box.project, {
    code: "ДОС",
    name: "Датчик освещённости",
    categoryId: base.categoryId,
    device: { kind: "lightSensor" },
  }).project;
  simPut(box, "ДОС", { x: 0.88, y: 0.3 }, "bedroom");
}

// ——— триггер ————————————————————————————————————————————————————————————————

test("триггер: условие без галки только проверяется; без единой галки сценарий от устройств не стартует", () => {
  const home = house({
    scenarios: (id) => [
      {
        id: "s1",
        name: "Розетка по движению",
        targets: [
          when(
            [trig(ref(id("ДД1"), "MotionDetected"), "eq", true), cond(ref(id("ДП1"), "OccupancyDetected"), "eq", "OCCUPANCY_DETECTED")],
            [put(ref(id("Р1"), "On"), true)],
            null,
            { mode: "AND" },
          ),
        ],
      },
      {
        id: "s2",
        name: "Без галок",
        targets: [when([cond(ref(id("ДД2"), "MotionDetected"), "eq", true)], [put(ref(id("С3"), "On"), true)])],
      },
    ],
  });
  home.sensor("ДП1", true);
  assert.equal(home.value("ДП1", "OccupancyDetected"), "OCCUPANCY_DETECTED");
  assert.equal(home.value("Р1", "On"), false, "условие без галки запустило сценарий");
  home.sensor("ДД1");
  assert.equal(home.value("Р1", "On"), true, "триггер не запустил сценарий");

  home.sensor("ДД2");
  assert.equal(home.value("С3", "On"), false, "сценарий без единой галки стартовал от устройства");
  assert.equal(home.engine.runScenario("s2"), true);
  assert.equal(home.value("С3", "On"), true, "ручной запуск не проверил условие по состоянию");
});

test("G08: дерево §2.5 вики — событие триггера на любом уровне запускает весь сценарий со всеми проверками", () => {
  // Если [Движение = да] Тогда
  //    Если [Освещённость < 200 лк] Тогда [Лампа := вкл]
  //    Если [Присутствие = да]       Тогда [Розетка := вкл]
  const tree = (id, triggers) => [
    when(
      [cond(ref(id("ДД1"), "MotionDetected"), "eq", true, { trigger: triggers.includes("motion") })],
      [
        when(
          [cond(ref(id("ДОС1"), "CurrentAmbientLightLevel"), "lt", 200, { trigger: triggers.includes("lux") })],
          [put(ref(id("С3"), "On"), true)],
        ),
        when(
          [cond(ref(id("ДП1"), "OccupancyDetected"), "eq", "OCCUPANCY_DETECTED", { trigger: triggers.includes("presence") })],
          [put(ref(id("Р1"), "On"), true)],
        ),
      ],
    ),
  ];
  const make = (triggers) =>
    house({ prepare: withLux, scenarios: (id) => [{ id: "tree", name: "Дерево", targets: tree(id, triggers) }] });
  const lit = (home) => [home.value("С3", "On"), home.value("Р1", "On")];

  // Пример 1: триггер — только движение. Освещённость и присутствие — условия.
  let home = make(["motion"]);
  home.set("ДОС1", "CurrentAmbientLightLevel", 100);
  home.sensor("ДП1", true);
  assert.deepEqual(lit(home), [false, false], "пример 1: простое условие запустило сценарий");
  home.sensor("ДД1");
  assert.deepEqual(lit(home), [true, true], "пример 1: движение не проверило вложенные «Если»");

  // Пример 2: движение и освещённость. Освещённость запускает весь сценарий:
  // верхнее «Если» по состоянию, соседнее «Если» тоже проверяется (вики: «включится
  // только лампочка» — поправка G08).
  home = make(["motion", "lux"]);
  home.sensor("ДД1");
  assert.deepEqual(lit(home), [false, false], "пример 2: при 300 лк и без присутствия ничего не включается");
  home.sensor("ДП1", true);
  assert.deepEqual(lit(home), [false, false], "пример 2: присутствие без галки запустило сценарий");
  home.set("ДОС1", "CurrentAmbientLightLevel", 100);
  assert.deepEqual(lit(home), [true, true], "пример 2 (G08): освещённость не запустила весь сценарий");
  home = make(["motion", "lux"]);
  home.set("ДОС1", "CurrentAmbientLightLevel", 100);
  assert.deepEqual(lit(home), [false, false], "пример 2: без движения верхнее «Если» ложно");

  // Пример 3: только освещённость. Движение ничего не запускает; по
  // освещённости при движении включаются обе (вики: «выключатель не включится
  // никогда» — поправка G08).
  home = make(["lux"]);
  home.set("ДОС1", "CurrentAmbientLightLevel", 100);
  home.sensor("ДП1", true);
  home.sensor("ДД1");
  assert.deepEqual(lit(home), [false, false], "пример 3: движение без галки запустило сценарий");
  home.set("ДОС1", "CurrentAmbientLightLevel", 150);
  assert.deepEqual(lit(home), [true, true], "пример 3 (G08): освещённость не проверила соседнее «Если»");

  // Пример 4: только присутствие (вики: «датчик освещённости лампочку уже
  // никогда не включит» — поправка G08: включит, весь сценарий проверяется).
  home = make(["presence"]);
  home.set("ДОС1", "CurrentAmbientLightLevel", 100);
  home.sensor("ДД1");
  assert.deepEqual(lit(home), [false, false], "пример 4: движение без галки запустило сценарий");
  home.sensor("ДП1", true);
  assert.deepEqual(lit(home), [true, true], "пример 4 (G08): присутствие не запустило весь сценарий");
});

// ——— И / ИЛИ ————————————————————————————————————————————————————————————————

test("«Одно из / Все сразу» и вложенная группа (A и B) или C", () => {
  const home = house({
    scenarios: (id) => [
      {
        id: "mix",
        name: "Смешанная логика",
        targets: [
          when(
            [
              group("AND", [
                trig(ref(id("ДП1"), "OccupancyDetected"), "eq", "OCCUPANCY_DETECTED"),
                cond(ref(id("Р1"), "On"), "eq", true),
              ]),
              trig(ref(id("ДО1"), "ContactSensorState"), "eq", "CONTACT_NOT_DETECTED"),
            ],
            [note("да")],
            [note("нет")],
            { mode: "OR" },
          ),
        ],
      },
    ],
  });
  home.sensor("ДП1", true);
  assert.deepEqual(home.notes(), ["нет"], "A без B — группа «Все сразу» ложна");
  home.set("Р1", "On", true);
  assert.deepEqual(home.notes(), ["нет"], "B без галки запустило сценарий");
  home.sensor("ДП1", false);
  home.sensor("ДП1", true);
  assert.deepEqual(home.notes(), ["нет", "нет", "да"], "A и B — истина");
  home.set("Р1", "On", false);
  home.sensor("ДО1", true);
  assert.deepEqual(home.notes(), ["нет", "нет", "да", "да"], "C — «Одно из» истинно");
  home.sensor("ДО1", false);
  assert.deepEqual(home.notes().at(-1), "нет");
});

test("условие-нажатие истинно только в момент своего события; «Изменено» — любое изменение", () => {
  const home = house({
    prepare: decoupleDuoKey2,
    scenarios: (id) => [
      {
        id: "press",
        name: "Нажатие при движении",
        targets: [
          when(
            [trig(ref(id("В2"), "ProgrammableSwitchEvent"), "eq", "SINGLE_PRESS"), cond(ref(id("ДД2"), "MotionDetected"), "eq", true)],
            [note("свет")],
            null,
            { mode: "AND" },
          ),
        ],
      },
      {
        id: "two",
        name: "Две кнопки сразу",
        targets: [
          when(
            [
              trig(ref(id("В2"), "ProgrammableSwitchEvent"), "eq", "SINGLE_PRESS"),
              trig(ref(id("ВВ1"), "ProgrammableSwitchEvent", DUO_KEY2), "eq", "SINGLE_PRESS"),
            ],
            [note("оба")],
            null,
            { mode: "AND" },
          ),
        ],
      },
      {
        id: "changed",
        name: "Движение изменилось",
        targets: [
          when(
            [trig(ref(id("ДД2"), "MotionDetected"), "changed"), cond(ref(id("В2"), "ProgrammableSwitchEvent"), "eq", "SINGLE_PRESS")],
            [note("изменилось")],
            [note("кнопки нет")],
            { mode: "AND" },
          ),
        ],
      },
    ],
  });
  home.press("В2");
  assert.deepEqual(home.notes(), [], "нажатие без движения прошло «Все сразу»");
  home.sensor("ДД2");
  assert.deepEqual(home.notes(), ["кнопки нет"], "«Изменено» не запустило; нажатие без своего события истинно");
  home.press("В2");
  assert.deepEqual(home.notes(), ["кнопки нет", "свет"]);
  home.press("В2", "double");
  home.press("ВВ1", "single", DUO_KEY2);
  assert.deepEqual(home.notes(), ["кнопки нет", "свет"], "«Все сразу» с двумя кнопками сработало от одной");
  home.sensor("ДД2", false);
  assert.deepEqual(home.notes(), ["кнопки нет", "свет", "кнопки нет"], "«Изменено» — и на сброс движения");
});

// ——— ∞ (G07) и «Иначе» ——————————————————————————————————————————————————————

function warmth(repeat) {
  return house({
    scenarios: (id) => [
      {
        id: "warm",
        name: "Жарко",
        targets: [
          when(
            [trig(ref(id("ДТВ1"), "CurrentTemperature"), "gt", 25, repeat === undefined ? {} : { repeat })],
            [note("жарко")],
            [note("прохладно")],
          ),
        ],
      },
    ],
  });
}

test("∞ включена (умолчание): каждое изменение значения запускает — истинно «Тогда», ложно «Иначе»", () => {
  const home = warmth(undefined);
  home.set("ДТВ1", "CurrentTemperature", 26);
  home.set("ДТВ1", "CurrentTemperature", 27);
  home.set("ДТВ1", "CurrentTemperature", 24);
  home.set("ДТВ1", "CurrentTemperature", 23);
  home.set("ДТВ1", "CurrentTemperature", 23);
  assert.deepEqual(home.notes(), ["жарко", "жарко", "прохладно", "прохладно"]);
});

test("∞ выключена: один запуск при переходе в истину и один при переходе в ложь", () => {
  const home = warmth(false);
  home.set("ДТВ1", "CurrentTemperature", 24);
  assert.deepEqual(home.notes(), [], "изменение по ложную сторону границы запустило сценарий");
  home.set("ДТВ1", "CurrentTemperature", 26);
  home.set("ДТВ1", "CurrentTemperature", 27);
  home.set("ДТВ1", "CurrentTemperature", 24);
  home.set("ДТВ1", "CurrentTemperature", 23);
  home.set("ДТВ1", "CurrentTemperature", 30);
  assert.deepEqual(home.notes(), ["жарко", "прохладно", "жарко"]);
});

test("∞ только у числовых сравнений: у перечисления выключенная ∞ не гасит запуски", () => {
  const home = house({
    scenarios: (id) => [
      {
        id: "mode",
        name: "Режим",
        targets: [
          when([trig(ref(id("ТС1"), "TargetHeatingCoolingState"), "eq", "HEAT", { repeat: false })], [note("греет")], [note("не греет")]),
        ],
      },
    ],
  });
  home.set("ТС1", "TargetHeatingCoolingState", "COOL");
  home.set("ТС1", "TargetHeatingCoolingState", "AUTO");
  home.set("ТС1", "TargetHeatingCoolingState", "HEAT");
  assert.deepEqual(home.notes(), ["не греет", "не греет", "греет"]);

  const int = simCharMeta("Brightness");
  const bool = simCharMeta("On");
  const enumeration = simCharMeta("TargetHeatingCoolingState");
  assert.equal(blocksRepeatAllowed({ type: "device", op: "gt" }, int), true);
  assert.equal(blocksRepeatAllowed({ type: "device", op: "eq", value: 30 }, int), true);
  assert.equal(blocksRepeatAllowed({ type: "device", op: "ne", value: 30 }, simCharMeta("CurrentTemperature")), true);
  assert.equal(blocksRepeatAllowed({ type: "device", op: "changed" }, int), false);
  assert.equal(blocksRepeatAllowed({ type: "device", op: "eq", value: true }, bool), false);
  assert.equal(blocksRepeatAllowed({ type: "device", op: "eq", value: "HEAT" }, enumeration), false);
});

test("«Иначе» — только когда запуск пришёл, а условия ложны; «Если» без условий — сразу «Тогда»", () => {
  const home = house({
    scenarios: (id) => [
      {
        id: "else",
        name: "Иначе",
        targets: [
          when([trig(ref(id("ДД2"), "MotionDetected"), "eq", true)], [note("тогда")], [note("иначе")]),
          when([], [note("без условий")]),
        ],
      },
    ],
  });
  home.set("Р1", "On", true);
  assert.deepEqual(home.notes(), [], "«Иначе» без запуска");
  home.sensor("ДД2");
  home.sensor("ДД2", false);
  assert.deepEqual(home.notes(), ["тогда", "без условий", "иначе", "без условий"]);
});

// ——— действия ————————————————————————————————————————————————————————————————

test("действия: «Установить», «Инвертировать», «Увеличить на шаг», «Установить из»; то же значение — без события", () => {
  const home = house({
    scenarios: (id) => [
      {
        id: "acts",
        name: "Действия",
        targets: [
          act(
            ref(id("С1"), "On"),
            [
              { char: "On", verb: "set", value: true },
              { char: "Brightness", verb: "set", value: 30 },
            ],
            "a-set",
          ),
          act(ref(id("С2"), "On"), [{ char: "On", verb: "invert" }], "a-invert"),
          act(ref(id("Т1"), "Brightness"), [{ char: "Brightness", verb: "increase", step: -20 }], "a-step"),
          act(ref(id("Р1"), "On"), [{ char: "On", verb: "setFrom", from: ref(id("ДД2"), "MotionDetected") }], "a-from"),
          act(ref(id("ТВ1"), "Active"), [{ char: "Active", verb: "invert" }], "a-tv"),
        ],
      },
    ],
  });
  home.sensor("ДД2");
  home.recorder.clear();
  home.engine.runScenario("acts");
  assert.equal(home.value("С1", "On"), true);
  assert.equal(home.value("С1", "Brightness"), 30);
  assert.equal(home.value("С2", "On"), true);
  assert.equal(home.value("Т1", "Brightness"), 80);
  assert.equal(home.value("Р1", "On"), true);
  assert.equal(home.value("ТВ1", "Active"), "ACTIVE");
  const lit = home.recorder.log().find((entry) => entry.kind === "change" && entry.markId === home.id("С1") && entry.char === "On");
  assert.deepEqual(kinds(lit.chain), ["scenario", "web"], "у записи нет звена сценария");
  assert.deepEqual(lit.chain[0], { k: "scenario", scenarioId: "acts", blockId: "a-set" });

  home.recorder.clear();
  home.sensor("ДД2", false);
  home.engine.runScenario("acts");
  assert.equal(home.value("С2", "On"), false, "«Инвертировать» не вернул назад");
  assert.equal(home.value("Т1", "Brightness"), 60);
  assert.equal(home.value("Р1", "On"), false, "«Установить из» не взял нового значения");
  assert.equal(home.value("ТВ1", "Active"), "INACTIVE");
  const again = home.recorder.log().filter((entry) => entry.kind === "change" && entry.markId === home.id("С1"));
  assert.deepEqual(again, [], "запись того же значения дала изменение");
});

test("другие сценарии: «Запустить», «Активировать», «Активировать и запустить», «Деактивировать»; неактивный не запускается", () => {
  const key = (id, press, service = 0) => trig(ref(id("В2"), "ProgrammableSwitchEvent", service), "eq", press);
  const home = house({
    prepare: decoupleDuoKey2,
    scenarios: (id) => [
      { id: "target", name: "Цель", targets: [note("цель")] },
      {
        id: "remote",
        name: "Пульт",
        targets: [
          when([key(id, "SINGLE_PRESS")], [other("run", "target")]),
          when([key(id, "DOUBLE_PRESS")], [other("deactivate", "target")]),
          when([key(id, "LONG_PRESS")], [other("activateRun", "target")]),
          when([trig(ref(id("ВВ1"), "ProgrammableSwitchEvent", DUO_KEY2), "eq", "SINGLE_PRESS")], [other("activate", "target")]),
          when([trig(ref(id("ВВ1"), "ProgrammableSwitchEvent", DUO_KEY2), "eq", "DOUBLE_PRESS")], [other("run", "gone", "s-gone")]),
        ],
      },
      {
        id: "sleepy",
        name: "Выключенный",
        active: false,
        targets: [when([trig(ref(id("ДД2"), "MotionDetected"), "eq", true)], [note("спящий")])],
      },
    ],
  });
  const active = (scenarioId) => home.engine.scenarios().find((item) => item.id === scenarioId).active;
  home.press("В2");
  assert.deepEqual(home.notes(), ["цель"]);
  home.press("В2", "double");
  assert.equal(active("target"), false);
  home.press("В2");
  assert.deepEqual(home.notes(), ["цель"], "неактивный сценарий запустился");
  assert.equal(home.entries("blockNotActive").length, 1, "отказ неактивному не записан в журнал");
  home.press("ВВ1", "single", DUO_KEY2);
  assert.equal(active("target"), true, "«Активировать» не включил сценарий");
  home.press("В2");
  assert.deepEqual(home.notes(), ["цель", "цель"]);
  home.press("В2", "double");
  home.press("В2", "long");
  assert.equal(active("target"), true);
  assert.deepEqual(home.notes(), ["цель", "цель", "цель"], "«Активировать и запустить» не запустил");

  home.press("ВВ1", "double", DUO_KEY2);
  const [missing] = home.entries("blockScenarioMissing");
  assert.equal(missing.blockId, "s-gone", "ссылка на удалённый сценарий не записана");

  home.sensor("ДД2");
  assert.deepEqual(home.notes().filter((text) => text === "спящий"), [], "неактивный сценарий запустился от триггера");
  home.engine.runScenario("sleepy");
  assert.deepEqual(home.notes().filter((text) => text === "спящий"), [], "неактивный сценарий запустился вручную");
  home.engine.setScenarioActive("sleepy", true);
  home.sensor("ДД2", false);
  home.sensor("ДД2");
  assert.deepEqual(home.notes().filter((text) => text === "спящий"), ["спящий"]);
});

test("«Последовательное выполнение»: сценарии на одно событие идут в порядке списка (order)", () => {
  const home = house({
    scenarios: (id) =>
      ["А", "Б", "В"].map((name) => ({
        id: "q" + name,
        name,
        sequential: true,
        targets: [when([trig(ref(id("ДД2"), "MotionDetected"), "eq", true)], [note(name)])],
      })),
    prepare: () => {},
  });
  home.sensor("ДД2");
  assert.deepEqual(home.notes(), ["А", "Б", "В"]);

  const box = simHouse();
  for (const name of ["А", "Б", "В"]) {
    box.project = addScenario(box.project, {
      kind: "block",
      id: "q" + name,
      name,
      sequential: true,
      targets: [when([trig(ref(box.marks["ДД2"], "MotionDetected"), "eq", true)], [note(name)])],
    }).project;
  }
  box.project = moveScenario(box.project, "qВ", 0).project;
  const moved = house({ box });
  moved.sensor("ДД2");
  assert.deepEqual(moved.notes(), ["В", "А", "Б"], "порядок не из order");
});

// ——— код ————————————————————————————————————————————————————————————————————

function codeRunner(requests) {
  return {
    name: "hub",
    kinds: ["logic", "global"],
    runCode(request) {
      requests.push(request);
      if (request.code === "boom") return { ok: false, error: "boom", line: 3 };
      return { ok: true, value: request.code === "return true" };
    },
  };
}

test("условие-код и блок-код идут через исполнитель движка: вид, код, сценарий, блок, цепочка", () => {
  const requests = [];
  const home = house({
    owners: [codeRunner(requests)],
    scenarios: (id) => [
      {
        id: "code",
        name: "Код",
        targets: [
          when(
            [{ type: "code", id: "cc1", code: "return true" }, trig(ref(id("ДД2"), "MotionDetected"), "eq", true)],
            [{ type: "code", id: "ca1", code: "act()" }],
            null,
            { mode: "AND" },
          ),
        ],
      },
    ],
  });
  home.sensor("ДД2");
  assert.equal(requests.length, 2);
  const [condition, action] = requests;
  assert.equal(condition.kind, "condition");
  assert.equal(condition.code, "return true");
  assert.equal(condition.scenarioId, "code");
  assert.equal(condition.blockId, "cc1");
  assert.deepEqual(condition.chain[0], { k: "scenario", scenarioId: "code", blockId: "cc1" });
  assert.deepEqual(kinds(condition.chain), ["scenario", "char", "web"]);
  assert.equal(action.kind, "action");
  assert.equal(action.code, "act()");
  assert.equal(action.blockId, "ca1");
  assert.deepEqual(kinds(action.chain), ["scenario", "char", "web"]);
});

test("ошибка кода: условие ложно, блок пропущен, запись в журнал; без исполнителя — так же", () => {
  const scenarios = () => [
    {
      id: "bad",
      name: "Сломанный",
      targets: [
        when([{ type: "code", id: "cc-bad", code: "boom" }], [note("да")], [note("нет")]),
        { type: "code", id: "ca-bad", code: "boom" },
        note("после"),
      ],
    },
  ];
  const home = house({ owners: [codeRunner([])], scenarios });
  home.engine.runScenario("bad");
  assert.deepEqual(home.notes(), ["нет", "после"]);
  const errors = home.entries("blockCodeError");
  assert.deepEqual(errors.map((entry) => entry.blockId), ["cc-bad", "ca-bad"]);
  assert.equal(errors[0].kind, "error");
  assert.equal(errors[0].scenarioId, "bad");
  assert.deepEqual([errors[0].vars.message, errors[0].vars.line], ["boom", 3]);

  const lone = house({ scenarios });
  lone.engine.runScenario("bad");
  assert.deepEqual(lone.notes(), ["нет", "после"]);
  assert.equal(lone.entries("blockCodeError").length, 2, "без исполнителя ошибка не записана");
  assert.equal(lone.engine.running(), true);
});

// ——— неполное, удалённое, ручной запуск, журнал ————————————————————————————————

test("неполный блок и ссылка на удалённую метку пропускаются с записью в журнал", () => {
  const home = house({
    scenarios: (id) => [
      {
        id: "holes",
        name: "С дырами",
        targets: [
          when(
            [
              trig(ref(id("ДД2"), "MotionDetected"), "eq", true),
              cond(ref(id("ДД1"), "MotionDetected"), "eq", true, { id: "c-gone" }),
              { type: "device", id: "c-empty", ref: null, op: "eq", value: true, trigger: false },
            ],
            [
              { type: "device", id: "a-slot", ref: { slot: "lamp" }, items: [{ char: "On", verb: "set", value: true }] },
              put(ref(id("С2"), "On"), true, "a-gone"),
              put(ref(id("С1"), "On"), true, "a-ok"),
            ],
            null,
            { mode: "AND" },
          ),
        ],
      },
    ],
    prepare: () => {},
  });
  // Метки удаляются после того, как сценарий на них сослался.
  const box = home.box;
  const lamp = home.id("С2");
  box.project = deleteMark(box.project, home.id("ДД1")).project;
  box.project = deleteMark(box.project, lamp).project;
  home.engine.load(buildHomeSpec(box.project));
  home.recorder.clear();
  home.sensor("ДД2");
  assert.equal(home.value("С1", "On"), true, "пропущенные блоки остановили сценарий");
  assert.deepEqual(
    home.entries("blockDeviceMissing").map((entry) => entry.blockId),
    ["c-gone", "a-gone"],
  );
  assert.deepEqual(
    home.entries("blockIncomplete").map((entry) => entry.blockId),
    ["c-empty", "a-slot"],
  );
  assert.ok(home.entries("blockDeviceMissing").every((entry) => entry.kind === "error" && entry.scenarioId === "holes"));
});

test("ручной запуск проверяет условия по состоянию", () => {
  const home = house({
    scenarios: (id) => [
      {
        id: "manual",
        name: "Вручную",
        targets: [when([trig(ref(id("ДД2"), "MotionDetected"), "eq", true)], [note("есть")], [note("нет")])],
      },
    ],
  });
  home.engine.runScenario("manual");
  assert.deepEqual(home.notes(), ["нет"]);
  home.sensor("ДД2");
  home.engine.runScenario("manual");
  assert.deepEqual(home.notes(), ["нет", "есть", "есть"]);
  const runs = home.entries("blockRun");
  assert.deepEqual(kinds(runs.at(-1).chain), ["web"], "ручной запуск без звена «щелчок»");
  assert.deepEqual(kinds(runs[1].chain), ["char", "web"], "запуск от триггера без звена характеристики");
});

test("каждый запуск пишет в журнал результат условий с blockId: какое истинно, какое ложно", () => {
  const home = house({
    scenarios: (id) => [
      {
        id: "log",
        name: "Журнал",
        targets: [
          when(
            [trig(ref(id("ДД2"), "MotionDetected"), "eq", true, { id: "c-motion" }), cond(ref(id("Р1"), "On"), "eq", true, { id: "c-plug" })],
            [put(ref(id("С1"), "On"), true)],
            null,
            { id: "if-log", mode: "OR" },
          ),
        ],
      },
    ],
  });
  home.recorder.clear();
  home.sensor("ДД2");
  const log = home.recorder.log().filter((entry) => entry.scenarioId === "log");
  const [run] = log.filter((entry) => entry.code === "blockRun");
  assert.equal(run.kind, "run");
  assert.equal(run.vars.name, "Журнал");
  const results = log.filter((entry) => entry.kind === "cond").map((entry) => [entry.blockId, entry.result]);
  assert.deepEqual(results, [
    ["c-motion", true],
    ["c-plug", false],
    ["if-log", true],
  ]);
  const motion = log.find((entry) => entry.blockId === "c-motion");
  assert.equal(motion.markId, home.id("ДД2"), "у условия по устройству нет метки");
  assert.equal(motion.char, "MotionDetected");
  assert.ok(log.indexOf(run) < log.indexOf(motion), "результат условий раньше запуска");
});

test("уведомление и HTTP-запрос — строки журнала, в сеть ничего не уходит", () => {
  const home = house({
    scenarios: () => [
      {
        id: "say",
        name: "Сообщить",
        targets: [note("Привет", "n-hi"), { type: "http", id: "h1", method: "POST", url: "http://192.168.1.10/api" }],
      },
    ],
  });
  home.engine.runScenario("say");
  const [notify] = home.entries("blockNotify");
  assert.equal(notify.kind, "notify");
  assert.equal(notify.blockId, "n-hi");
  assert.equal(notify.vars.text, "Привет");
  const [http] = home.entries("blockHttp");
  assert.equal(http.kind, "http");
  assert.deepEqual([http.vars.method, http.vars.url, http.blockId], ["POST", "http://192.168.1.10/api", "h1"]);
});

test("«Выполнить на старте» — при запуске дома, не при перестройке; неактивный — нет", () => {
  const home = house({
    scenarios: () => [
      { id: "boot", name: "Старт", onStart: true, targets: [note("старт")] },
      { id: "quiet", name: "Тихий", targets: [note("тихий")] },
      { id: "off", name: "Выключен", onStart: true, active: false, targets: [note("выключен")] },
    ],
  });
  assert.deepEqual(home.notes(), ["старт"]);
  assert.deepEqual(kinds(home.entries("blockRun")[0].chain), ["hub"]);
  home.engine.load(buildHomeSpec(home.box.project));
  assert.deepEqual(home.notes(), ["старт"], "перестройка дома повторила старт");
});

test("петля: сценарий, запускающий сам себя, обрывается записью в журнал, дом идёт", () => {
  const home = house({
    scenarios: () => [{ id: "self", name: "Сам себя", targets: [other("run", "self")] }],
  });
  home.engine.runScenario("self");
  assert.equal(home.entries("blockLoop").length, 1);
  assert.ok(home.entries("blockRun").length <= 51, "цепочка не оборвана");
  assert.equal(home.engine.running(), true);
});

test("blocksPrepare: проблемы блоков — неполный и удалённое устройство", () => {
  const box = simHouse();
  const lamp = box.marks["С1"];
  const scenario = {
    id: "p",
    kind: "block",
    name: "Проверка",
    targets: [
      when(
        [cond(ref(lamp, "On"), "eq", true, { id: "c-ok" }), cond(ref("нет-метки", "On"), "eq", true, { id: "c-gone" })],
        [{ type: "device", id: "a-empty", ref: { markId: lamp, service: 0 }, items: [] }],
      ),
    ],
  };
  const compiled = blocksPrepare(scenario, buildHomeSpec(box.project));
  assert.deepEqual(compiled.issues, [
    { blockId: "c-gone", code: "deviceMissing" },
    { blockId: "a-empty", code: "incomplete" },
  ]);
});

test("большой дом: 500 устройств и 50 сценариев запускаются быстрее 1 с, событие со сценарием — быстрее 100 мс", () => {
  const box = simBigHouse(100);
  for (const [index, group] of box.groups.slice(0, 50).entries()) {
    box.project = addScenario(box.project, {
      kind: "block",
      id: "big" + index,
      name: "Свет " + (index + 1),
      targets: [
        when(
          [trig(ref(group.motion, "MotionDetected"), "eq", true)],
          [put(ref(group.light, "On"), true), { type: "delay", id: nid("d"), no: 1, sec: 60, timer: "one", blocks: [put(ref(group.light, "On"), false)] }],
        ),
      ],
    }).project;
  }
  // Норма по часам стены — медиана повторов после прогрева (ревью ветки, F1):
  // одиночный замер под параллельным `npm test` валил прогон. Запас больше
  // ×10: запуск ≈ 6 мс, худшее событие прогона ≈ 0,5 мс.
  let engine = null;
  const launch = () => {
    engine = createSimEngine({ emit: simRecorder().emit, owners: [blocksOwner()] });
    engine.load(buildHomeSpec(box.project));
    engine.setClock({ simMs: T0 });
    engine.start();
  };
  const startMs = medianMs(launch, { runs: 5, warmup: 1 });
  assert.ok(startMs < 1000, "запуск занял " + startMs.toFixed(1) + " мс (медиана)");
  // Худшее из 200 событий одного прогона; норма — медиана таких прогонов.
  const worstOfRun = () => {
    let worst = 0;
    for (let index = 0; index < 200; index += 1) {
      const group = box.groups[index % 50];
      const at = performance.now();
      engine.act({ kind: "sensor", markId: group.motion, value: index % 100 < 50 });
      worst = Math.max(worst, performance.now() - at);
    }
    return worst;
  };
  for (let index = 0; index < 2; index += 1) worstOfRun();
  const worsts = Array.from({ length: 7 }, worstOfRun).sort((first, second) => first - second);
  const worst = worsts[3];
  assert.ok(worst < 100, "событие со сценарием заняло " + worst.toFixed(1) + " мс (медиана худших)");
  assert.equal(engine.value(box.groups[0].light, 0, "On"), true, "сценарии большого дома не сработали");
});

// Медиана замеров после прогрева (см. выше): `fn` — один прогон.
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

// ——— условие «Команда» (G16) ——————————————————————————————————————————————

test("commandKey: регистр, «ё»/«е» и латинская «Ë», лишние пробелы и знаки по краям не важны", () => {
  for (const said of ["Ёлочка гори", "Ëлочка гори", "ёлочка ГОРИ", "  Елочка   гори! ", "«Ёлочка гори»", "ёлочка гори...", "е\u0308лочка гори"]) {
    assert.equal(commandKey(said), "елочка гори", JSON.stringify(said));
  }
  assert.notEqual(commandKey("Ёлочка, гори"), commandKey("Ёлочка гори"), "знак внутри — часть команды");
  assert.notEqual(commandKey("Ёлочка погасни"), commandKey("Ёлочка гори"));
  for (const empty of ["", "   ", "?!", null, undefined]) assert.equal(commandKey(empty), "");
});

test("команда (G16): «Ëлочка гори» включает розетку гирлянды по сценарию с командой «Ёлочка гори»", () => {
  const home = house({
    scenarios: (id) => [
      { id: "tree", name: "Ёлочка", targets: [when([command("Ёлочка гори", "k-tree")], [put(ref(id("Р1"), "On"), true, "a-tree")])] },
      { id: "off", name: "Ёлочка спать", targets: [when([command("Ёлочка, спать")], [put(ref(id("Р1"), "On"), false)])] },
    ],
  });
  assert.equal(home.say("Ëлочка гори"), true);
  assert.equal(home.value("Р1", "On"), true, "команда не включила розетку гирлянды");
  const [said] = home.entries("command");
  assert.equal(said.kind, "system");
  assert.deepEqual(said.vars, { text: "Ëлочка гори" });
  assert.deepEqual(kinds(said.chain), ["web"]);
  const [run] = home.entries("blockRun");
  assert.equal(run.scenarioId, "tree");
  assert.deepEqual(run.chain[0], { k: "command", at: T0, text: "Ëлочка гори" }, "запуск без причины «команда»");
  assert.deepEqual(kinds(run.chain), ["command", "web"]);
  const cond = home.entries("blockCond").find((entry) => entry.blockId === "k-tree");
  assert.equal(cond.result, true);
  const lit = home.recorder.log().find((entry) => entry.kind === "change" && entry.markId === home.id("Р1"));
  assert.deepEqual(kinds(lit.chain), ["scenario", "command", "web"], "розетка без причины «сценарий ← команда ← щелчок»");
  // Знаки, пробелы и регистр не важны; другая команда — другой сценарий.
  home.say(" ЁЛОЧКА, спать! ");
  assert.equal(home.value("Р1", "On"), false);
  assert.deepEqual(home.entries("commandUnknown"), [], "понятую команду записали непонятой");
});

test("команду не понял ни один сценарий — запись commandUnknown; пустая — ничего; неактивный — отказ", () => {
  const home = house({
    scenarios: (id) => [
      { id: "tree", name: "Ёлочка", targets: [when([command("Ёлочка гори")], [put(ref(id("Р1"), "On"), true)])] },
      { id: "sleep", name: "Спит", active: false, targets: [when([command("Спокойной ночи")], [note("ночь")])] },
      { id: "blank", name: "Пустая", targets: [when([command("  ")], [note("пусто")])] },
    ],
  });
  assert.equal(home.say("Ёлочка погасни"), false);
  const [unknown] = home.entries("commandUnknown");
  assert.equal(unknown.kind, "system");
  assert.deepEqual(unknown.vars, { text: "Ёлочка погасни" });
  assert.deepEqual(home.entries("blockRun"), []);
  assert.equal(home.value("Р1", "On"), false);
  // Неактивный сценарий команду услышал, но не запустился — это не «не понял».
  home.say("спокойной ночи");
  assert.deepEqual(home.notes(), []);
  assert.equal(home.entries("blockNotActive").length, 1);
  assert.equal(home.entries("commandUnknown").length, 1);
  // Пустая команда — ни журнала, ни запуска; пустой текст условия — неполный блок.
  home.recorder.clear();
  assert.equal(home.say("   "), false);
  assert.deepEqual(home.recorder.log(), []);
  const blank = blocksPrepare(home.box.project.scenarios.find((item) => item.id === "blank"), buildHomeSpec(home.box.project));
  assert.deepEqual(blank.issues.map((issue) => issue.code), ["incomplete"]);
  // Остановленный дом команд не слушает.
  home.engine.stop();
  home.recorder.clear();
  assert.equal(home.say("Ёлочка гори"), false);
  assert.deepEqual(home.recorder.log(), []);
});

test("команда — всегда триггер и истинна только в миг команды; в «Все сразу» остальное — по текущему состоянию", () => {
  const home = house({
    scenarios: (id) => [
      {
        id: "night",
        name: "Свет при движении",
        targets: [
          when([command("Свет"), cond(ref(id("ДД2"), "MotionDetected"), "eq", true)], [note("да")], [note("нет")], { mode: "AND" }),
        ],
      },
    ],
  });
  home.say("свет");
  assert.deepEqual(home.notes(), ["нет"], "без движения «Все сразу» не дало «Иначе»");
  home.sensor("ДД2");
  assert.deepEqual(home.notes(), ["нет"], "движение без галки запустило сценарий");
  home.say("Свет!");
  assert.deepEqual(home.notes(), ["нет", "да"]);
  // Ручной запуск: команды не было — условие ложно.
  home.engine.runScenario("night");
  assert.deepEqual(home.notes(), ["нет", "да", "нет"]);
});

test("blocksCommandTexts: тексты команд из «Если», групп, вложенных «Если» и задержек — без пустых", () => {
  const scenario = {
    targets: [
      when([command("Ёлочка гори"), group("AND", [command("Свет")])], [
        { type: "delay", id: nid("d"), no: 1, sec: 5, timer: "one", blocks: [when([command("Позже")], [])] },
      ], [when([command("  ")], [])]),
    ],
  };
  assert.deepEqual(blocksCommandTexts(scenario), ["Ёлочка гори", "Свет", "Позже"]);
  assert.deepEqual(blocksCommandTexts({}), []);
});

// ——— выключатель G11 в блочных сценариях ——————————————————————————————————

test("блочный сценарий ставит «Выключатель» клавиши — нагрузки канала следуют за ним (G11)", () => {
  // В1: сервис 0 — «Выключатель», 1 — кнопка; ВВ1: 0, 1 — «Выключатели».
  const home = house({
    scenarios: (id) => [
      { id: "on", name: "Движение — свет", targets: [when([trig(ref(id("ДД2"), "MotionDetected"), "eq", true)], [put(ref(id("В1"), "On", 0), true)], [put(ref(id("В1"), "On", 0), false)])] },
      { id: "curtain", name: "Протечка — штора", targets: [when([trig(ref(id("ДПр1"), "LeakDetected"), "eq", "LEAK_DETECTED")], [put(ref(id("ВВ1"), "On", 1), true)])] },
    ],
  });
  home.sensor("ДД2");
  assert.equal(home.value("В1", "On", 0), true);
  assert.equal(home.value("С1", "On"), true, "свет не пошёл за «Выключателем» из сценария");
  home.sensor("ДД2", false);
  assert.equal(home.value("С1", "On"), false);
  home.sensor("ДПр1", true);
  assert.equal(home.value("КШ1", "TargetPosition"), 100);
  // Кнопка привязанной клавиши событий не шлёт: сценарий на её нажатие молчит.
  const quiet = house({
    scenarios: (id) => [{ id: "press", name: "Нажатие", targets: [when([trig(ref(id("В1"), "ProgrammableSwitchEvent", 1), "eq", "SINGLE_PRESS")], [note("нажата")])] }],
  });
  quiet.press("В1", "single", 1);
  assert.equal(quiet.value("С1", "On"), true, "щелчок по привязанной клавише не включил свет");
  assert.deepEqual(quiet.notes(), [], "кнопка привязанной клавиши прислала нажатие в сценарий");
  // Отвязали — щелчок уходит нажатием в сценарий, свет не трогается.
  const loose = house({
    prepare: (box, id) => {
      box.project = setMarkDevice(box.project, id("В1"), { decoupled: [1] }).project;
    },
    scenarios: (id) => [{ id: "press", name: "Нажатие", targets: [when([trig(ref(id("В1"), "ProgrammableSwitchEvent", 1), "eq", "DOUBLE_PRESS")], [note("двойное")])] }],
  });
  loose.press("В1", "single", 1);
  loose.press("В1", "double", 1);
  assert.deepEqual(loose.notes(), ["двойное"]);
  assert.equal(loose.value("С1", "On"), false, "отвязанная клавиша включила свет");
});
