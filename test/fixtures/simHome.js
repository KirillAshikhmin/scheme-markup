// Дом-фикстура имитации умного дома (таск 04 сценариев) — общая для тестов
// движка, блочных сценариев (таск 05) и логических сценариев (таск 06).
//
// Дом собирается настоящими командами модели и `buildHomeSpec`, а не руками:
// тест видит те же адреса, профили, каналы и связи, что увидит страница.
//
// `simHouse()` — небольшая квартира; ключи `marks` — обозначения меток, какими
// их выдаёт нумерация объекта («С1», «ВВ1»…):
//   Коридор  — С1 (свет), В1 (клавиша → С1), ДД1 (движение), ДО1 (дверь `front`);
//   Гостиная — С2, Т1 (свет), ВВ1 (клавиша 1 → С2 и Т1, клавиша 2 → КШ1),
//              КШ1 (штора), ДП1 (присутствие), ТВ1, Р1 (розетка), Б1 (бризер),
//              К1 (кондиционер);
//   Спальня  — С3 (свет), В2 (клавиша → С3, **отвязана**), ТС1 (термостат),
//              ДТВ1 (температура, влажность, батарея);
// Выключатели В1 и ВВ1 — с выведенным профилем G11: сначала «Выключатель» на
// каждый канал (`Switch`, сервисы 0…N−1), затем кнопки (N…2N−1). В1: 0 —
// «Выключатель», 1 — кнопка; ВВ1: 0, 1 — «Выключатели», 2, 3 — кнопки.
// В2 — своя настройка, сохранённая **до G11** (вид `switch`, одни кнопки,
// клавиша 1 отвязана): сервис 0 — кнопка. Так дом держит и прежний профиль,
// который обязан работать как раньше.
//   без помещения — ДД2 (движение), ДПр1 (протечка), КВ1 (кран), ЗМ1 (замок).
// ТС, ДТВ, ЗМ — свои типы человека с заданным профилем (их в стартовом
// справочнике нет).
import {
  addMark,
  addOpening,
  addRoom,
  addScheme,
  addType,
  addWall,
  createProject,
  labelOf,
  planMmToFraction,
  setMarkControls,
  setMarkDevice,
  setPlanOrigin,
  setPlanScale,
  updateMark,
} from "../../src/model.js";
import { buildHomeSpec } from "../../src/sim/home.js";
import { readFileSync } from "node:fs";

function simFixtureScheme() {
  const added = addScheme(createProject(), { name: "1 этаж", imageId: "plan", width: 1200, height: 800 });
  let project = setPlanScale(added.project, added.scheme.id, { a: { x: 0.1, y: 0.5 }, b: { x: 0.6, y: 0.5 }, meters: 6 }).project;
  project = setPlanOrigin(project, added.scheme.id, { at: { x: 0.2, y: 0.8 }, turn: 0 }).project;
  return { project, schemeId: added.scheme.id, marks: {}, rooms: {}, doors: {} };
}

function simFixtureType(box, code) {
  const type = box.project.markTypes.find((item) => item.code === code);
  if (!type) throw new Error("simHome: no type " + code);
  return type;
}

/** Поставить метку типа `code` в точку плана `at` (доли 0…1); `room` — ключ помещения. */
export function simPut(box, code, at, room) {
  const type = simFixtureType(box, code);
  const line = type.kind === "line";
  const added = addMark(box.project, {
    schemeId: box.schemeId,
    typeId: type.id,
    kind: line ? "line" : "point",
    points: line ? [at, { x: at.x + 0.05, y: at.y }] : [at],
  });
  box.project = added.project;
  const id = added.mark.id;
  if (room) box.project = updateMark(box.project, id, { roomId: box.rooms[room], roomManual: true }).project;
  box.marks[labelOf(box.project, id)] = id;
  return id;
}

/** Связь «чем управляет» целиком: `[[обозначение, канал | null], …]`. */
export function simLink(box, from, targets) {
  box.project = setMarkControls(
    box.project,
    box.marks[from],
    targets.map(([name, channel]) => ({ id: box.marks[name], channel })),
  ).project;
}

function simRoom(box, key, name) {
  const added = addRoom(box.project, { name });
  box.project = added.project;
  box.rooms[key] = added.room.id;
}

function simOwnType(box, code, name, device) {
  const base = simFixtureType(box, "ДД");
  box.project = addType(box.project, { code, name, categoryId: base.categoryId, device }).project;
}

/**
 * Небольшая квартира (см. шапку файла): `{project, schemeId, marks, rooms, doors}`.
 * `marks` — `{обозначение: markId}`, `rooms` — `{hall, living, bedroom}`,
 * `doors` — `{front}` (id проёма-двери у ДО1).
 */
export function simHouse() {
  const box = simFixtureScheme();
  simRoom(box, "hall", "Коридор");
  simRoom(box, "living", "Гостиная");
  simRoom(box, "bedroom", "Спальня");
  const wall = addWall(box.project, { schemeId: box.schemeId, aMm: { x: 0, y: 0 }, bMm: { x: 6000, y: 0 }, thicknessMm: 100 });
  box.project = wall.project;
  const front = addOpening(box.project, {
    wallId: wall.wall.id,
    kind: "door",
    atMm: 2000,
    widthMm: 900,
    heightMm: 2100,
    hinge: "start",
    swing: "left",
  });
  box.project = front.project;
  box.doors.front = front.opening.id;
  const mm = (x, y) => planMmToFraction(box.project, box.schemeId, { x, y });

  simOwnType(box, "ТС", "Термостат", { kind: "thermostat" });
  simOwnType(box, "ЗМ", "Замок", { kind: "lock" });
  simOwnType(box, "ДТВ", "Датчик климата", {
    kind: "climateSensor",
    services: [
      { type: "TemperatureSensor", chars: ["CurrentTemperature"] },
      { type: "HumiditySensor", chars: ["CurrentRelativeHumidity"] },
      { type: "BatteryService", chars: ["BatteryLevel", "ChargingState", "StatusLowBattery"] },
    ],
  });

  // Коридор
  simPut(box, "С", { x: 0.25, y: 0.3 }, "hall");
  simPut(box, "В", { x: 0.27, y: 0.35 }, "hall");
  simPut(box, "ДД", { x: 0.3, y: 0.3 }, "hall");
  simPut(box, "ДО", mm(2450, -300), "hall");
  // Гостиная
  simPut(box, "С", { x: 0.5, y: 0.3 }, "living");
  simPut(box, "Т", { x: 0.55, y: 0.3 }, "living");
  simPut(box, "ВВ", { x: 0.52, y: 0.35 }, "living");
  simPut(box, "КШ", { x: 0.6, y: 0.2 }, "living");
  simPut(box, "ДП", { x: 0.58, y: 0.3 }, "living");
  simPut(box, "ТВ", { x: 0.62, y: 0.4 }, "living");
  simPut(box, "Р", { x: 0.63, y: 0.45 }, "living");
  simPut(box, "Б", { x: 0.64, y: 0.25 }, "living");
  simPut(box, "К", { x: 0.65, y: 0.2 }, "living");
  // Спальня
  simPut(box, "С", { x: 0.8, y: 0.3 }, "bedroom");
  simPut(box, "В", { x: 0.82, y: 0.35 }, "bedroom");
  simPut(box, "ТС", { x: 0.84, y: 0.3 }, "bedroom");
  simPut(box, "ДТВ", { x: 0.86, y: 0.3 }, "bedroom");
  // Без помещения
  simPut(box, "ДД", { x: 0.1, y: 0.7 });
  simPut(box, "ДПр", { x: 0.12, y: 0.7 });
  simPut(box, "КВ", { x: 0.14, y: 0.7 });
  simPut(box, "ЗМ", { x: 0.16, y: 0.7 });

  simLink(box, "В1", [["С1", 1]]);
  simLink(box, "ВВ1", [
    ["С2", 1],
    ["Т1", 1],
    ["КШ1", 2],
  ]);
  simLink(box, "В2", [["С3", 1]]);
  box.project = setMarkDevice(box.project, box.marks["В2"], { kind: "switch", decoupled: [1] }).project;
  return box;
}

/** Спецификация дома для движка: `buildHomeSpec` объекта фикстуры. */
export function simHouseSpec(box = simHouse()) {
  return buildHomeSpec(box.project);
}

/**
 * Большой дом (история 2.18): `groups` комнат по пять устройств — выключатель
 * В со связью на светильник С, датчик движения ДД, розетка Р, штора КШ.
 * 100 групп — 500 устройств. `{project, schemeId, marks, rooms, groups:
 * [{room, switch, light, motion, outlet, curtain}]}` (id меток).
 */
export function simBigHouse(groups = 100) {
  const box = simFixtureScheme();
  const list = [];
  for (let index = 0; index < groups; index += 1) {
    const key = "room" + index;
    simRoom(box, key, "Комната " + (index + 1));
    const x = 0.05 + (index % 10) * 0.09;
    const y = 0.05 + Math.floor(index / 10) * 0.09;
    const group = {
      room: box.rooms[key],
      switch: simPut(box, "В", { x, y }, key),
      light: simPut(box, "С", { x: x + 0.01, y }, key),
      motion: simPut(box, "ДД", { x: x + 0.02, y }, key),
      outlet: simPut(box, "Р", { x, y: y + 0.01 }, key),
      curtain: simPut(box, "КШ", { x: x + 0.01, y: y + 0.01 }, key),
    };
    box.project = setMarkControls(box.project, group.switch, [{ id: group.light, channel: 1 }]).project;
    list.push(group);
  }
  box.groups = list;
  return box;
}

/**
 * Запись того, что движок отправил наружу: `emit` — отдать движку;
 * `messages` — все сообщения; `changes()`, `log()` — склеенные списки
 * изменений и записей журнала; `clear()` — забыть.
 */
export function simRecorder() {
  const messages = [];
  return {
    messages,
    emit: (message) => messages.push(message),
    changes: () => messages.filter((message) => message.type === "changes").flatMap((message) => message.list),
    log: () => messages.filter((message) => message.type === "log").flatMap((message) => message.entries),
    clear: () => {
      messages.length = 0;
    },
  };
}

// ——— объект, сохранённый до G11 ————————————————————————————————————————————

// Что сборка до G11 (окно «Устройство» на проде) дописала к объекту
// `g68-legacy-project.packed.json`: два типа выключателей с профилем «одни
// кнопки» (вид `switch`; у ВВ отвязана клавиша 2) и три метки — В1 → Т1, ВВ1
// (клавиша 1 → Р1, клавиша 2 → Л1), В2 → Т1 со своей настройкой окна (полный
// снимок, клавиша 1 отвязана). Снято той сборкой с её `packProject` — не
// командами модели этой: так тест сверяет текст, который она записала.
const SIM_LEGACY_SWITCH_TYPES = [
  {"id":"199c3b5d-b0f6-4d18-954d-89e6f8c3ca2b","categoryId":"c-power","code":"В","name":"Выключатель","kind":"point","shape":null,"lineStyle":null,"blockMode":"each","channels":1,"order":3,"device":{"kind":"switch"},"sizes":{"length":80,"width":80,"depth":10,"heightAboveFloor":900}},
  {"id":"92adcf10-6c64-4b77-9674-2f5e9d2e0276","categoryId":"c-power","code":"ВВ","name":"Выключатель двойной","kind":"point","shape":null,"lineStyle":null,"blockMode":"each","channels":2,"order":4,"device":{"kind":"switch","decoupled":[2]},"sizes":{"length":80,"width":80,"depth":10,"heightAboveFloor":900}},
];
const SIM_LEGACY_SWITCH_MARKS = [
  {"id":"4dc2fa27-9c5f-4cf9-8753-1f497db4883e","schemeId":"1578fd44-4527-4628-915f-7365fc9beb04","typeId":"199c3b5d-b0f6-4d18-954d-89e6f8c3ca2b","number":1,"kind":"point","points":[{"x":0.3,"y":0.3}],"closed":false,"groupId":null,"labelOffset":null,"roomId":null,"roomManual":false,"location":"","original":"","length":null,"width":null,"heightAboveFloor":null,"controls":[{"id":"e90fbf81-7d0f-4cae-a07b-c32036187f6e","channel":1}]},
  {"id":"f4b6fe64-7723-4f9f-bb49-be842915f831","schemeId":"1578fd44-4527-4628-915f-7365fc9beb04","typeId":"92adcf10-6c64-4b77-9674-2f5e9d2e0276","number":1,"kind":"point","points":[{"x":0.4,"y":0.3}],"closed":false,"groupId":null,"labelOffset":null,"roomId":null,"roomManual":false,"location":"","original":"","length":null,"width":null,"heightAboveFloor":null,"controls":[{"id":"e8b6facf-dd4c-499d-bd7e-3f20087798af","channel":1},{"id":"02876802-6bd8-4b41-9fe0-41eb091396fc","channel":2}]},
  {"id":"7b7ae1a5-4130-4b34-9499-499199be5d49","schemeId":"1578fd44-4527-4628-915f-7365fc9beb04","typeId":"199c3b5d-b0f6-4d18-954d-89e6f8c3ca2b","number":2,"kind":"point","points":[{"x":0.5,"y":0.3}],"closed":false,"groupId":null,"labelOffset":null,"roomId":null,"roomManual":false,"location":"","original":"","length":null,"width":null,"heightAboveFloor":null,"controls":[{"id":"e90fbf81-7d0f-4cae-a07b-c32036187f6e","channel":1}],"device":{"kind":"switch","services":[{"type":"StatelessProgrammableSwitch","chars":["ProgrammableSwitchEvent","ServiceLabelIndex"],"perChannel":true}],"decoupled":[1]}},
];

/**
 * Объект с профилями выключателей, сохранёнными до G11 (одни кнопки):
 * `{project, text, marks: {В1, ВВ1, В2, Т1, Р1, Л1}, types: {В, ВВ}}`, где
 * `text` — `project.json`, который записала та сборка (байт в байт).
 */
export function simLegacySwitchProject() {
  const base = JSON.parse(readFileSync(new URL("./g68-legacy-project.packed.json", import.meta.url), "utf8"));
  const project = {
    ...base,
    updatedAt: "2026-10-22T23:25:34.152Z",
    markTypes: [...base.markTypes, ...structuredClone(SIM_LEGACY_SWITCH_TYPES)],
    marks: [...base.marks, ...structuredClone(SIM_LEGACY_SWITCH_MARKS)],
    counters: { ...base.counters, В: 2, ВВ: 1 },
  };
  const markOf = (typeId) => base.marks.find((mark) => mark.typeId === typeId).id;
  return {
    project,
    text: JSON.stringify(project, null, 2),
    marks: {
      В1: SIM_LEGACY_SWITCH_MARKS[0].id,
      ВВ1: SIM_LEGACY_SWITCH_MARKS[1].id,
      В2: SIM_LEGACY_SWITCH_MARKS[2].id,
      Т1: markOf("t-lamp"),
      Р1: markOf("t-socket"),
      Л1: markOf("t-tape"),
    },
    types: { В: SIM_LEGACY_SWITCH_TYPES[0].id, ВВ: SIM_LEGACY_SWITCH_TYPES[1].id },
  };
}
