// Дом из объекта: адреса устройств, аксессуары меток, дверь датчика открытия и
// живое состояние для рисования (таск 01 сценариев, истории 1.1, 1.16;
// `interfaces.md` — «Адреса устройств», строки `sim/home.js` и `sim/live.js`).
import test from "node:test";
import assert from "node:assert/strict";

import {
  addMark,
  addOpening,
  addScenario,
  addScheme,
  addWall,
  createProject,
  planMmToFraction,
  setMarkControls,
  setMarkDevice,
  setPlanOrigin,
  setPlanScale,
} from "../src/model.js";
import {
  DEVICE_AID_MAX,
  DEVICE_AID_MIN,
  buildHomeSpec,
  deviceAid,
  deviceAids,
  deviceKeyIndex,
  homeAccessories,
  markAccessory,
  markDoorOf,
} from "../src/sim/home.js";
import { simLiveOf, simValueKey } from "../src/sim/live.js";
import { packProject, unpackProject } from "../src/projectFile.js";
import { adoptLoadedProject } from "../src/autosave.js";

function house() {
  const added = addScheme(createProject(), { name: "1 этаж", imageId: null, width: 1000, height: 800 });
  return { project: added.project, schemeId: added.scheme.id, marks: {} };
}

function put(box, name, code, at) {
  const type = box.project.markTypes.find((item) => item.code === code);
  const line = type.kind === "line";
  const added = addMark(box.project, {
    schemeId: box.schemeId,
    typeId: type.id,
    kind: line ? "line" : "point",
    points: line ? [at, { x: at.x + 0.1, y: at.y }] : [at],
  });
  box.project = added.project;
  box.marks[name] = added.mark.id;
  return box;
}

// ——— адрес аксессуара ————————————————————————————————————————————————————

test("aid — FNV-1a 32 по строке id в диапазоне 100000000…999999999", () => {
  // Контрольные значения FNV-1a 32 (опорные векторы алгоритма): «a» —
  // 0xe40c292c, «foobar» — 0xbf9cf968, пустая строка — смещение 0x811c9dc5.
  assert.equal(deviceAid("a"), DEVICE_AID_MIN + (0xe40c292c % 900000000));
  assert.equal(deviceAid("foobar"), DEVICE_AID_MIN + (0xbf9cf968 % 900000000));
  assert.equal(deviceAid(""), DEVICE_AID_MIN + (0x811c9dc5 % 900000000));
  assert.equal(deviceAid("a"), 326002220);
  for (const id of ["a", "foobar", crypto.randomUUID(), crypto.randomUUID()]) {
    const aid = deviceAid(id);
    assert.ok(Number.isInteger(aid) && aid >= DEVICE_AID_MIN && aid <= DEVICE_AID_MAX, String(aid));
    assert.equal(deviceAid(id), aid, "адрес разный в двух вызовах");
  }
});

test("совпавшие адреса двух меток объекта разводятся пробой по порядку markId", () => {
  // Ищем пару id с одним адресом — по дням рождения хватает десятков тысяч.
  const seen = new Map();
  let pair = null;
  for (let index = 0; !pair; index += 1) {
    const id = "метка-" + index;
    const aid = deviceAid(id);
    if (seen.has(aid)) pair = [seen.get(aid), id];
    else seen.set(aid, id);
  }
  const box = put(put(house(), "first", "Т", { x: 0.2, y: 0.2 }), "second", "Т", { x: 0.4, y: 0.2 });
  const [low, high] = [...pair].sort();
  const ids = [box.marks.first, box.marks.second];
  const project = {
    ...box.project,
    // Метка с большим id стоит первой: порядок объекта значения не имеет.
    marks: box.project.marks.map((mark) => ({ ...mark, id: mark.id === ids[0] ? high : low })),
  };
  const aids = deviceAids(project);
  assert.equal(aids.get(low), deviceAid(low), "меньший id теряет свой адрес");
  assert.equal(aids.get(high), deviceAid(low) + 1, "больший id не получил следующий свободный");
  assert.notEqual(markAccessory(project, low).aid, markAccessory(project, high).aid);
});

test("адреса различны у меток объекта и не меняются после упаковки и приёмки файла", async () => {
  const box = house();
  for (let index = 0; index < 12; index += 1) put(box, "m" + index, index % 2 ? "Т" : "ДД", { x: 0.05 + index / 20, y: 0.3 });
  const before = homeAccessories(box.project).map((item) => [item.markId, item.aid]);
  assert.equal(new Set(before.map(([, aid]) => aid)).size, before.length, "два устройства с одним адресом");

  const restored = (await unpackProject(await packProject(box.project, new Map()))).project;
  assert.deepEqual(homeAccessories(restored).map((item) => [item.markId, item.aid]), before, "адрес уехал после файла");
  const adopted = adoptLoadedProject({ project: restored, images: new Map() }, { mode: "new" }).project;
  assert.deepEqual(homeAccessories(adopted).map((item) => [item.markId, item.aid]), before, "адрес уехал после приёмки");
});

// ——— аксессуар метки ————————————————————————————————————————————————————

test("аксессуар выключателя (G11): «Выключатель» на канал, затем кнопки; sid и cid подряд с 13, номер клавиши — константа", () => {
  const box = put(house(), "switch", "ВВ", { x: 0.5, y: 0.5 });
  const accessory = markAccessory(box.project, box.marks.switch);
  assert.equal(accessory.aid, deviceAid(box.marks.switch));
  assert.equal(accessory.kind, "switchRelay");
  assert.equal(accessory.label, "ВВ1");
  assert.deepEqual(
    accessory.services.map((service) => [service.sid, service.type, service.channel, service.chars.map((char) => [char.cid, char.type])]),
    [
      [13, "Switch", 1, [[14, "On"]]],
      [15, "Switch", 2, [[16, "On"]]],
      [17, "StatelessProgrammableSwitch", 1, [[18, "ProgrammableSwitchEvent"], [19, "ServiceLabelIndex"]]],
      [20, "StatelessProgrammableSwitch", 2, [[21, "ProgrammableSwitchEvent"], [22, "ServiceLabelIndex"]]],
    ],
  );
  assert.deepEqual(accessory.services.slice(2).map((service) => service.chars[1].value), [1, 2], "номер клавиши не по каналу");
  assert.equal(accessory.services[3].address, accessory.aid + ".20");
  assert.equal(accessory.services[3].chars[0].address, accessory.aid + ".20.21");
  // Метаданные характеристики — из словаря: событие с тремя нажатиями.
  const press = accessory.services[2].chars[0].meta;
  assert.equal(press.format, "event");
  assert.deepEqual(press.values.map((value) => value.key), ["SINGLE_PRESS", "DOUBLE_PRESS", "LONG_PRESS"]);
  assert.equal(accessory.services[2].decoupled, false);
  assert.equal(accessory.services[0].chars[0].value, false, "«Выключатель» стартует выключенным");
});

test("выключатели шаблона В, П, МВ, ВВ, ПП, ВВВ: N × «Выключатель» (On), затем N × кнопка с номерами 1…N", () => {
  const channels = { В: 1, П: 1, МВ: 1, ВВ: 2, ПП: 2, ВВВ: 3 };
  let box = house();
  for (const code of Object.keys(channels)) box = put(box, code, code, { x: 0.1 + Object.keys(box.marks).length / 20, y: 0.5 });
  for (const [code, count] of Object.entries(channels)) {
    const accessory = markAccessory(box.project, box.marks[code]);
    const numbers = Array.from({ length: count }, (unused, at) => at + 1);
    assert.deepEqual(
      accessory.services.map((service) => [service.type, service.channel]),
      [...numbers.map((n) => ["Switch", n]), ...numbers.map((n) => ["StatelessProgrammableSwitch", n])],
      code,
    );
    for (const service of accessory.services.slice(0, count)) {
      assert.deepEqual(service.chars.map((char) => char.type), ["On"], code + ": у «Выключателя» только On");
    }
    assert.deepEqual(
      accessory.services.slice(count).map((service) => service.chars.find((char) => char.type === "ServiceLabelIndex").value),
      numbers,
      code + ": ServiceLabelIndex не 1…N",
    );
  }
});

test("deviceKeyIndex: щелчок по клавише канала — в её кнопку, а не в «Выключатель»; у профиля до G11 — та же кнопка", () => {
  let box = put(house(), "duo", "ВВ", { x: 0.5, y: 0.5 });
  box = put(box, "lamp", "Т", { x: 0.2, y: 0.2 });
  const duo = markAccessory(box.project, box.marks.duo);
  assert.deepEqual([deviceKeyIndex(duo, 1), deviceKeyIndex(duo, 2), deviceKeyIndex(duo, 3), deviceKeyIndex(duo)], [2, 3, null, 2]);
  assert.equal(deviceKeyIndex(markAccessory(box.project, box.marks.lamp), 1), null);
  assert.equal(deviceKeyIndex(null, 1), null);
  const legacy = setMarkDevice(box.project, box.marks.duo, { kind: "switch" }).project;
  const old = markAccessory(legacy, box.marks.duo);
  assert.deepEqual([deviceKeyIndex(old, 1), deviceKeyIndex(old, 2)], [0, 1]);
});

test("аксессуар светильника — один сервис с метаданными; не-устройство и комментарий — без аксессуара", () => {
  const box = put(put(house(), "lamp", "Т", { x: 0.2, y: 0.2 }), "panel", "Щ", { x: 0.3, y: 0.3 });
  const lamp = markAccessory(box.project, box.marks.lamp);
  assert.deepEqual(lamp.services.map((service) => service.sid), [13]);
  assert.deepEqual(lamp.services[0].chars.map((char) => [char.cid, char.type, char.meta.format]), [
    [14, "On", "bool"],
    [15, "Brightness", "int"],
  ]);
  assert.equal(lamp.services[0].chars[1].meta.max, 100);
  assert.equal(markAccessory(box.project, box.marks.panel), null);
  assert.equal(markAccessory(box.project, "нет-метки"), null);
  assert.deepEqual(homeAccessories(box.project).map((item) => item.markId), [box.marks.lamp], "щит попал в дом");
  // Своя настройка меняет аксессуар — и адреса сервисов следом за профилем.
  const tuned = setMarkDevice(box.project, box.marks.lamp, { services: [{ type: "Lightbulb", chars: ["ColorTemperature"] }] }).project;
  assert.deepEqual(markAccessory(tuned, box.marks.lamp).services[0].chars.map((char) => [char.cid, char.type]), [
    [14, "On"],
    [15, "ColorTemperature"],
  ]);
});

// ——— дверь датчика открытия ————————————————————————————————————————————————

function doorHouse() {
  const added = addScheme(createProject(), { name: "1", imageId: "p", width: 1200, height: 800 });
  let project = setPlanScale(added.project, added.scheme.id, { a: { x: 0.1, y: 0.5 }, b: { x: 0.6, y: 0.5 }, meters: 6 }).project;
  project = setPlanOrigin(project, added.scheme.id, { at: { x: 0.2, y: 0.8 }, turn: 0 }).project;
  const wall = addWall(project, { schemeId: added.scheme.id, aMm: { x: 0, y: 0 }, bMm: { x: 6000, y: 0 }, thicknessMm: 100 });
  project = wall.project;
  const front = addOpening(project, { wallId: wall.wall.id, kind: "door", atMm: 2000, widthMm: 900, heightMm: 2100, hinge: "start", swing: "left" });
  project = front.project;
  const back = addOpening(project, { wallId: wall.wall.id, kind: "door", atMm: 4500, widthMm: 900, heightMm: 2100, hinge: "end", swing: "right" });
  project = back.project;
  const box = { project, schemeId: added.scheme.id, marks: {}, front: front.opening.id, back: back.opening.id };
  const at = (mm) => planMmToFraction(box.project, box.schemeId, mm);
  put(box, "near", "ДО", at({ x: 2450, y: -300 }));
  put(box, "far", "ДО", at({ x: 3700, y: -1500 }));
  put(box, "motion", "ДД", at({ x: 2450, y: -200 }));
  return box;
}

test("дверь датчика открытия: ближайшая дверь не дальше 600 мм, своя, снятая рукой", () => {
  const box = doorHouse();
  assert.equal(markDoorOf(box.project, box.marks.near), box.front, "датчик над дверью двери не нашёл");
  assert.equal(markDoorOf(box.project, box.marks.far), null, "дверь дальше порога");
  assert.equal(markDoorOf(box.project, box.marks.motion), null, "датчик движения — не датчик открытия");
  const own = setMarkDevice(box.project, box.marks.near, { doorId: box.back }).project;
  assert.equal(markDoorOf(own, box.marks.near), box.back, "своя дверь не победила ближайшую");
  const cut = setMarkDevice(box.project, box.marks.near, { doorId: null }).project;
  assert.equal(markDoorOf(cut, box.marks.near), null, "снятая связь вернулась автоматикой");
  // «Вернуть как у типа» дверь не снимает: это место, а не устройство.
  assert.equal(markDoorOf(setMarkDevice(own, box.marks.near, undefined).project, box.marks.near), box.back);
});

test("спецификация дома — клонируемое значение с прямыми связями клавиш и дверями", () => {
  const box = doorHouse();
  put(box, "switch", "В", { x: 0.3, y: 0.3 });
  put(box, "lamp", "Т", { x: 0.35, y: 0.3 });
  box.project = setMarkControls(box.project, box.marks.switch, [{ id: box.marks.lamp, channel: 1 }]).project;
  box.project = addScenario(box.project, { kind: "block", name: "Пусто" }).project;
  const spec = buildHomeSpec(box.project);
  assert.deepEqual(structuredClone(spec), spec, "спецификацию не передать в Worker");
  assert.deepEqual(spec.links, [{ markId: box.marks.switch, channel: 1, targets: [box.marks.lamp] }]);
  assert.deepEqual(spec.doors, [{ markId: box.marks.near, openingId: box.front }]);
  assert.deepEqual(spec.scenarios.map((item) => item.name), ["Пусто"]);
  assert.deepEqual(spec.logicBindings, []);
  assert.equal(spec.accessories.length, homeAccessories(box.project).length);
});

// ——— живое состояние ————————————————————————————————————————————————————

test("живое состояние светильника, датчиков, шторы и телевизора", () => {
  const box = house();
  put(box, "lamp", "Т", { x: 0.1, y: 0.1 });
  put(box, "motion", "ДД", { x: 0.2, y: 0.1 });
  put(box, "contact", "ДО", { x: 0.3, y: 0.1 });
  put(box, "curtain", "КШ", { x: 0.4, y: 0.1 });
  put(box, "tv", "ТВ", { x: 0.5, y: 0.1 });
  put(box, "switch", "ВВ", { x: 0.6, y: 0.1 });
  const of = (name) => markAccessory(box.project, box.marks[name]);
  // `lamps`, `heat`, `climate` — правки после сборки сценариев: яркость каждой
  // лампы по её сервису, нагрев и показания датчиков климата.
  const dark = {
    on: false,
    level: 0,
    alert: false,
    open: 0,
    pressedAt: null,
    keys: null,
    flow: null,
    locked: false,
    lamps: null,
    heat: false,
    climate: null,
    color: null,
  };

  assert.deepEqual(simLiveOf(of("lamp"), {}), { ...dark, lamps: { 0: 0 } }, "дом со старта не тёмный");
  assert.deepEqual(simLiveOf(of("lamp"), { [simValueKey(0, "On")]: true, "0.Brightness": 40 }), { ...dark, on: true, level: 0.4, lamps: { 0: 0.4 } });
  assert.deepEqual(simLiveOf(of("lamp"), new Map([["0.On", true]])), { ...dark, on: true, level: 1, lamps: { 0: 1 } }, "Map не читается");
  assert.deepEqual(simLiveOf(of("motion"), { "0.MotionDetected": true }), { ...dark, alert: true });
  // Перечисление читается и кодом: 1 — CONTACT_NOT_DETECTED, «открыто».
  assert.deepEqual(simLiveOf(of("contact"), { "0.ContactSensorState": 1 }), { ...dark, alert: true, open: 1 });
  assert.deepEqual(simLiveOf(of("contact"), { "0.ContactSensorState": "CONTACT_DETECTED" }), dark);
  assert.deepEqual(simLiveOf(of("curtain"), { "0.CurrentPosition": 75 }), { ...dark, open: 0.75 });
  assert.deepEqual(simLiveOf(of("tv"), { "0.Active": "ACTIVE" }), { ...dark, on: true, level: 1 });
  assert.deepEqual(simLiveOf(of("tv"), { "0.Active": 0 }), dark);
  // Значение вне диапазона зажимается, а не ломает картинку.
  assert.equal(simLiveOf(of("lamp"), { "0.On": true, "0.Brightness": 400 }).level, 1);
  // Клавиши — по каналам (правка после сборки сценариев): у ВВ реле двух клавиш
  // по отдельности, по ним «Объём» зажигает диод под каждой.
  assert.deepEqual(simLiveOf(of("switch"), { pressedAt: 1234 }), { ...dark, pressedAt: 1234, keys: { 1: false, 2: false } });
  assert.deepEqual(simLiveOf(of("switch"), { "1.On": true }).keys, { 1: false, 2: true });
  assert.deepEqual(simLiveOf(null, {}), dark);
});

test("живое состояние: что дует, что звучит, что заперто (правка после сборки сценариев)", () => {
  const box = house();
  put(box, "breezer", "Б", { x: 0.1, y: 0.2 });
  put(box, "ac", "К", { x: 0.2, y: 0.2 });
  put(box, "speaker", "УК", { x: 0.3, y: 0.2 });
  const of = (name) => markAccessory(box.project, box.marks[name]);
  assert.equal(simLiveOf(of("breezer"), {}).flow, null, "выключенный бризер дует");
  const fan = simLiveOf(of("breezer"), { "0.Active": "ACTIVE", "0.RotationSpeed": 50 });
  assert.deepEqual(fan.flow, { kind: "air", level: 0.5 });
  // Вытяжка и вентиляция воздух забирают (правка 2026-10-27): поток у них —
  // «в себя», как и в климате, где они вытяжка, а приток — только у бризера.
  put(box, "hood", "ВЫТ", { x: 0.4, y: 0.2 });
  put(box, "vent", "ВЕНТ", { x: 0.5, y: 0.2 });
  for (const name of ["hood", "vent"]) {
    const accessory = of(name);
    const index = accessory.services.find((service) => service.type === "Fan").index;
    assert.deepEqual(simLiveOf(accessory, { [index + ".Active"]: "ACTIVE", [index + ".RotationSpeed"]: 100 }).flow, { kind: "intake", level: 1 }, name);
  }
  // Кондиционер — термостат (правка после сборки сценариев): дует, пока режим
  // не «Выкл»; в «Авто» — тем, что делает сейчас.
  assert.deepEqual(simLiveOf(of("ac"), { "0.TargetHeatingCoolingState": "COOL" }).flow, { kind: "cool", level: 1 });
  assert.deepEqual(simLiveOf(of("ac"), { "0.TargetHeatingCoolingState": "HEAT" }).flow, { kind: "heat", level: 1 });
  assert.deepEqual(simLiveOf(of("ac"), { "0.TargetHeatingCoolingState": "AUTO", "0.CurrentHeatingCoolingState": "COOL" }).flow, { kind: "cool", level: 1 });
  assert.deepEqual(simLiveOf(of("ac"), { "0.TargetHeatingCoolingState": "AUTO", "0.CurrentHeatingCoolingState": "OFF" }).flow, { kind: "air", level: 1 });
  assert.equal(simLiveOf(of("ac"), { "0.TargetHeatingCoolingState": "OFF" }).flow, null);
  const speaker = of("speaker");
  const index = speaker.services.find((service) => service.type === "Speaker").index;
  assert.equal(simLiveOf(speaker, { [index + ".Mute"]: false }).flow.kind, "sound");
});
