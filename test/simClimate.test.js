// Климат дома (правка после сборки сценариев).
//
// Слова заказчика: «Симуляция температуры и влажности. Температура на улице в
// зависимости от сезона, даты и времени дня. Температура в помещении.
// Воздухообмен по помещениям и с улицей при открытых дверях, работа
// кондиционера, вытяжки, бризера. При чем у бризера должен быть выключатель
// подогрева»; «эти параметры у каждого помещения должны быть, как и уровень
// углекислого газа. Их тоже можно задавать». Ответы: отопление — «Центральное»,
// CO₂ — «Число людей в комнате».
//
// Швы: шаг климата (`climateStep`) — чистая функция; хозяин климата в движке
// (`climateOwner`) — на доме-фикстуре без Worker; геометрия
// (`volumeClimateGeometry`) и сведения об устройствах (`simClimateOf`).
import test from "node:test";
import assert from "node:assert/strict";

import {
  CLIMATE_BREEZER_HEAT_C,
  CLIMATE_CO2_OUT,
  CLIMATE_HEAT_TARGET_C,
  climateAbsolute,
  climateLux,
  climateOwner,
  CLIMATE_LAMP_LM,
  CLIMATE_NIGHT_LUX,
  CLIMATE_SKY_LUX,
  climateRelative,
  climateStep,
} from "../src/sim/climate.js";
import { createSimEngine } from "../src/sim/engine.js";
import { simClimateOf } from "../src/simulation.js";
import { volumeClimateGeometry } from "../src/volume.js";
import { addOpening, addOutline, addRoom, addScheme, addWall, createProject, planMmToFraction, setPlanOrigin, setPlanScale, setSchemeWallHeight } from "../src/model.js";
import { simHouse, simHouseSpec, simPut, simRecorder } from "./fixtures/simHome.js";

const HOUR = 3600;
const room = (t, rh = 45, co2 = 450, people = 0) => ({ t, ah: climateAbsolute(t, rh), co2, people });
const GEO = {
  rooms: [
    { id: "living", areaMm2: 16e6, heightMm: 2700, windowsMm2: 2e6 },
    { id: "hall", areaMm2: 6e6, heightMm: 2700, windowsMm2: 0 },
  ],
  ways: [
    { id: "door", a: "living", b: "hall", areaMm2: 1.9e6, window: false, leaf: true },
    { id: "front", a: "hall", b: null, areaMm2: 1.9e6, window: false, leaf: true },
  ],
};
const WINTER = { tempC: -15, humidity: 85, sun: 0 };
const SUMMER = { tempC: 28, humidity: 55, sun: 1 };
const run = (state, outdoor, open, effects, heating, hours) => {
  for (let index = 0; index < hours * 60; index += 1) climateStep(state, outdoor, GEO, open, effects, heating, 60, 0);
  return state;
};

test("влажность: абсолютная и относительная сходятся, больше 100 % не бывает", () => {
  for (const [t, rh] of [[22, 45], [-10, 80], [30, 60]]) {
    assert.ok(Math.abs(climateRelative(t, climateAbsolute(t, rh)) - rh) < 0.01);
  }
  assert.ok(Math.abs(climateAbsolute(20, 100) - 17.3) < 0.2, "при 20 °C насыщение не 17,3 г/м³: " + climateAbsolute(20, 100));
  assert.equal(climateRelative(10, 50), 100, "перенасыщенный воздух показал больше 100 %");
});

test("зимой отопление держит +22, а открытая на улицу дверь выстужает коридор", () => {
  const closed = run(new Map([["living", room(22)], ["hall", room(22)]]), WINTER, new Set(), new Map(), true, 6);
  assert.ok(Math.abs(closed.get("living").t - CLIMATE_HEAT_TARGET_C) < 0.5, "отопление не держит: " + closed.get("living").t);
  const open = run(new Map([["living", room(22)], ["hall", room(22)]]), WINTER, new Set(["front"]), new Map(), true, 1);
  assert.ok(open.get("hall").t < 19, "открытая на мороз дверь не выстудила коридор: " + open.get("hall").t);
  // Без отопления (центральное не идёт) комната остывает к улице.
  const cold = run(new Map([["living", room(22)], ["hall", room(22)]]), WINTER, new Set(), new Map(), false, 12);
  assert.ok(cold.get("living").t < 12, "без отопления зимой тепло: " + cold.get("living").t);
});

test("открытая дверь между комнатами выравнивает их, закрытая — нет", () => {
  const shut = run(new Map([["living", room(26, 45, 1500)], ["hall", room(18, 45, 450)]]), SUMMER, new Set(), new Map(), false, 0.5);
  const open = run(new Map([["living", room(26, 45, 1500)], ["hall", room(18, 45, 450)]]), SUMMER, new Set(["door"]), new Map(), false, 0.5);
  const gap = (state) => Math.abs(state.get("living").t - state.get("hall").t);
  assert.ok(gap(open) < gap(shut) - 1, "открытая дверь не выравнивает температуру");
  assert.ok(open.get("hall").co2 > shut.get("hall").co2 + 50, "CO₂ не переходит через открытую дверь");
});

test("люди дышат: CO₂ растёт по числу людей; бризер и вытяжка его снимают", () => {
  const two = run(new Map([["living", room(22, 45, 450, 2)], ["hall", room(22)]]), WINTER, new Set(), new Map(), true, 3);
  const none = run(new Map([["living", room(22, 45, 450, 0)], ["hall", room(22)]]), WINTER, new Set(), new Map(), true, 3);
  assert.ok(two.get("living").co2 > 900, "двое за три часа не надышали: " + two.get("living").co2);
  assert.ok(Math.abs(none.get("living").co2 - 450) < 40, "без людей CO₂ растёт: " + none.get("living").co2);
  const breezer = new Map([["living", { exhaust: 0, supply: [{ flow: 0.035, tempC: 20 }], cool: null, warm: null, heat: [], dry: false }]]);
  const fresh = run(new Map([["living", room(22, 45, 450, 2)], ["hall", room(22)]]), WINTER, new Set(), breezer, true, 3);
  assert.ok(fresh.get("living").co2 < two.get("living").co2 - 200, "бризер не снимает CO₂");
  assert.ok(fresh.get("living").co2 >= CLIMATE_CO2_OUT);
  const hood = new Map([["living", { exhaust: 0.03, supply: [], cool: null, warm: null, heat: [], dry: false }]]);
  const vented = run(new Map([["living", room(22, 45, 450, 2)], ["hall", room(22)]]), WINTER, new Set(), hood, true, 3);
  assert.ok(vented.get("living").co2 < two.get("living").co2 - 150, "вытяжка не снимает CO₂");
});

test("вытяжка тянет воздух из соседей: ванная в мороз не остывает, влагу и CO₂ уносит (правка 2026-10-27)", () => {
  // Вопрос заказчика: «физика верно рассчитана для них?». Было: на место
  // вытянутого в ту же комнату сразу шёл уличный, и маленькая ванная с
  // вентилятором в мороз остывала к нескольким градусам тепла.
  // Квартира: ванная, коридор и гостиная — вытяжка в 108 м³/ч для неё
  // обычный обмен, а не сквозняк.
  const geo = {
    rooms: [
      { id: "bath", areaMm2: 5e6, heightMm: 2700, windowsMm2: 0 },
      { id: "hall", areaMm2: 10e6, heightMm: 2700, windowsMm2: 0 },
      { id: "living", areaMm2: 40e6, heightMm: 2700, windowsMm2: 5e6 },
    ],
    ways: [
      { id: "bathDoor", a: "bath", b: "hall", areaMm2: 1.6e6, window: false, leaf: true },
      { id: "livingDoor", a: "hall", b: "living", areaMm2: 1.6e6, window: false, leaf: true },
      { id: "front", a: "hall", b: null, areaMm2: 1.9e6, window: false, leaf: true },
    ],
  };
  const frost = { tempC: -20, humidity: 85, sun: 0 };
  const fan = new Map([["bath", { exhaust: 0.03, supply: [], cool: null, warm: null, heat: [], dry: false }]]);
  const state = new Map([["bath", room(24, 90, 600)], ["hall", room(22)], ["living", room(22)]]);
  for (let minute = 0; minute < 60; minute += 1) climateStep(state, frost, geo, new Set(), fan, true, 60, 0);
  const bath = state.get("bath");
  assert.ok(bath.t > 18, "ванная с вытяжкой выстыла: " + bath.t.toFixed(1));
  assert.ok(climateRelative(bath.t, bath.ah) < 70, "вытяжка не сняла влажность: " + climateRelative(bath.t, bath.ah).toFixed(0));
  assert.ok(bath.co2 < 520, "вытяжка не сменила воздух: " + bath.co2.toFixed(0));
  // Дом добирает воздух с улицы неплотностями всех помещений — батареи это
  // покрывают: ни коридор, ни гостиная не выстывают.
  for (const id of ["hall", "living"]) assert.ok(state.get(id).t > 20, id + " выстыл: " + state.get(id).t.toFixed(1));
  // Но уличный воздух в дом пришёл: CO₂ у соседей ниже, чем без вытяжки.
  const still = new Map([["bath", room(24, 90, 600)], ["hall", room(22, 45, 600)], ["living", room(22, 45, 600)]]);
  const aired = new Map([["bath", room(24, 90, 600)], ["hall", room(22, 45, 600)], ["living", room(22, 45, 600)]]);
  for (let minute = 0; minute < 60; minute += 1) {
    climateStep(still, frost, geo, new Set(), new Map(), true, 60, 0);
    climateStep(aired, frost, geo, new Set(), fan, true, 60, 0);
  }
  assert.ok(aired.get("living").co2 < still.get("living").co2, "уличный воздух в доме ниоткуда не пришёл");
  // Комната без соседей, только на улицу, — замещает улица, как прежде.
  const alone = { rooms: [geo.rooms[0]], ways: [] };
  const lone = new Map([["bath", room(24, 90, 600)]]);
  for (let minute = 0; minute < 60; minute += 1) climateStep(lone, frost, alone, new Set(), fan, true, 60, 0);
  assert.ok(lone.get("bath").t < bath.t - 3, "одинокая комната с вытяжкой не холоднее: " + lone.get("bath").t.toFixed(1));
});

test("бризер зимой: без подогрева холодит, с подогревом — нет", () => {
  const cold = new Map([["living", { exhaust: 0, supply: [{ flow: 0.035, tempC: WINTER.tempC }], cool: null, warm: null, heat: [], dry: false }]]);
  const warm = new Map([["living", { exhaust: 0, supply: [{ flow: 0.035, tempC: CLIMATE_BREEZER_HEAT_C }], cool: null, warm: null, heat: [], dry: false }]]);
  // Отопления нет — видно чистое действие приточки.
  const a = run(new Map([["living", room(22)], ["hall", room(22)]]), WINTER, new Set(), cold, false, 1);
  const b = run(new Map([["living", room(22)], ["hall", room(22)]]), WINTER, new Set(), warm, false, 1);
  assert.ok(b.get("living").t > a.get("living").t + 3, "подогрев бризера ничего не греет: " + a.get("living").t + " / " + b.get("living").t);
});

test("кондиционер охлаждает до уставки и сушит, обогрев — греет до своей", () => {
  const ac = new Map([["living", { exhaust: 0, supply: [], cool: 24, warm: null, heat: [], dry: false }]]);
  const cooled = run(new Map([["living", room(30, 60)], ["hall", room(30, 60)]]), SUMMER, new Set(), ac, false, 1);
  assert.ok(Math.abs(cooled.get("living").t - 24) < 0.6, "кондиционер не довёл до уставки: " + cooled.get("living").t);
  assert.ok(cooled.get("hall").t > 27, "кондиционер охладил чужую комнату");
  const floor = new Map([["hall", { exhaust: 0, supply: [], cool: null, warm: null, heat: [27], dry: false }]]);
  const heated = run(new Map([["living", room(20)], ["hall", room(20)]]), SUMMER, new Set(), floor, false, 4);
  assert.ok(heated.get("hall").t > 25, "тёплый пол не греет: " + heated.get("hall").t);
});

// ——— в движке ————————————————————————————————————————————————————————————

function climateHome() {
  const box = simHouse();
  const spec = simHouseSpec(box);
  spec.site = { latDeg: 55.75, lonDeg: 37.6 };
  spec.climate = {
    rooms: [
      { id: box.rooms.living, areaMm2: 16e6, heightMm: 2700, windowsMm2: 2e6 },
      { id: box.rooms.bedroom, areaMm2: 12e6, heightMm: 2700, windowsMm2: 1.5e6 },
      { id: box.rooms.hall, areaMm2: 6e6, heightMm: 2700, windowsMm2: 0 },
    ],
    ways: [],
    devices: spec.accessories.map((accessory) => ({
      markId: accessory.markId,
      roomId: accessory.roomId,
      role: accessory.kind === "breezer" ? "supply" : accessory.kind === "fan" ? "exhaust" : null,
      controls: [],
    })),
  };
  return { box, spec };
}

test("в движке: датчики получают климат своей комнаты тихо, «ближайшего события» климат не заводит", () => {
  const { box, spec } = climateHome();
  const recorder = simRecorder();
  const engine = createSimEngine({ emit: recorder.emit, owners: [climateOwner()] });
  const t0 = Math.floor(Date.UTC(2026, 0, 15) / 86400000) * 86400000 + 10 * 3600000;
  engine.load(spec);
  engine.setClock({ simMs: t0 });
  engine.start();
  engine.tell("climate", { kind: "weather", choice: { season: "auto", sky: "overcast", tempC: -12, humidity: null } });
  engine.tell("climate", { kind: "set", roomId: box.rooms.bedroom, patch: { t: 16, people: 2 } });
  recorder.clear();
  engine.advanceTo(t0 + 2 * 3600000);
  const sensor = box.marks["ДТВ1"];
  const t = engine.value(sensor, 0, "CurrentTemperature");
  assert.ok(t > 16 && t <= 22.5, "датчик спальни не видит, как батареи её греют: " + t);
  const rh = engine.value(sensor, 1, "CurrentRelativeHumidity");
  assert.ok(rh > 0 && rh < 100);
  assert.ok(
    recorder.log().every((entry) => entry.markId !== sensor),
    "климат засыпал журнал строками датчика",
  );
  assert.ok(recorder.changes().some((change) => change.markId === sensor), "изменения датчика не ушли странице");
  assert.equal(engine.nextAt(), null, "шаг климата встал «ближайшим событием»");
  const posts = recorder.messages.filter((message) => message.type === "climate");
  assert.ok(posts.length > 0, "климат не ушёл странице");
  const last = posts.at(-1);
  assert.equal(last.outdoor.tempC, -12, "выбранная температура улицы не держится");
  assert.equal(last.rooms[box.rooms.bedroom].people, 2);
  assert.ok(last.rooms[box.rooms.bedroom].co2 > 600, "двое в спальне не надышали");
  // Кондиционер гостиной видит её температуру.
  const ac = box.marks["К1"];
  assert.ok(Number.isFinite(engine.value(ac, 0, "CurrentTemperature")));
});

test("в движке: бризер с подогревом — второй сервис «Выключатель», и он греет приток", () => {
  const { box, spec } = climateHome();
  const breezer = spec.accessories.find((accessory) => accessory.markId === box.marks["Б1"]);
  assert.equal(breezer.kind, "breezer");
  assert.deepEqual(breezer.services.map((service) => service.type), ["Fan", "Switch"]);
  const temps = [];
  for (const heat of [false, true]) {
    const engine = createSimEngine({ emit: () => {}, owners: [climateOwner()] });
    const t0 = Math.floor(Date.UTC(2026, 0, 15) / 86400000) * 86400000 + 10 * 3600000;
    engine.load(spec);
    engine.setClock({ simMs: t0 });
    engine.start();
    engine.tell("climate", { kind: "weather", choice: { season: "auto", sky: "overcast", tempC: -20, humidity: null } });
    engine.act({ kind: "set", markId: box.marks["Б1"], service: 0, char: "Active", value: "ACTIVE" });
    engine.act({ kind: "set", markId: box.marks["Б1"], service: 0, char: "RotationSpeed", value: 100 });
    engine.act({ kind: "set", markId: box.marks["Б1"], service: 1, char: "On", value: heat });
    engine.advanceTo(t0 + 3600000);
    temps.push(engine.value(box.marks["К1"], 0, "CurrentTemperature"));
  }
  assert.ok(temps[1] > temps[0], "подогрев бризера не греет гостиную: " + temps.join(" / "));
});

// ——— геометрия ——————————————————————————————————————————————————————————

test("геометрия климата: помещения с площадью и окнами, двери между ними и на улицу", () => {
  const added = addScheme(createProject(), { name: "1 этаж", imageId: "plan-1", width: 1200, height: 800 });
  let project = setPlanScale(added.project, added.scheme.id, { a: { x: 0.1, y: 0.5 }, b: { x: 0.6, y: 0.5 }, meters: 6 }).project;
  project = setPlanOrigin(project, added.scheme.id, { at: { x: 0.5, y: 0.5 }, turn: 0 }).project;
  project = setSchemeWallHeight(project, added.scheme.id, 2700).project;
  const schemeId = added.scheme.id;
  const fr = (point) => planMmToFraction(project, schemeId, point);
  const wall = (a, b) => {
    const put = addWall(project, { schemeId, aMm: a, bMm: b, thicknessMm: 200 });
    project = put.project;
    return put.wall.id;
  };
  const outer = [
    { x: -4000, y: -1500 },
    { x: 2000, y: -1500 },
    { x: 2000, y: 1500 },
    { x: -4000, y: 1500 },
  ];
  const ids = outer.map((point, index) => wall(point, outer[(index + 1) % outer.length]));
  const middle = wall({ x: 0, y: -1500 }, { x: 0, y: 1500 });
  const rooms = {};
  for (const [key, from, to] of [
    ["living", -3900, -100],
    ["hall", 100, 1900],
  ]) {
    const made = addRoom(project, key);
    project = made.project;
    rooms[key] = made.room.id;
    project = addOutline(project, {
      schemeId,
      roomId: made.room.id,
      points: [{ x: from, y: -1400 }, { x: to, y: -1400 }, { x: to, y: 1400 }, { x: from, y: 1400 }].map(fr),
    }).project;
  }
  project = addOpening(project, { wallId: middle, kind: "door", atMm: 1000, widthMm: 900, heightMm: 2100, heightAboveFloorMm: 0, hinge: "start", swing: "left" }).project;
  project = addOpening(project, { wallId: ids[0], kind: "window", atMm: 1300, widthMm: 1500, heightMm: 1400, heightAboveFloorMm: 800 }).project;
  project = addOpening(project, { wallId: ids[1], kind: "door", atMm: 1000, widthMm: 900, heightMm: 2100, heightAboveFloorMm: 0, hinge: "start", swing: "left" }).project;
  const geometry = volumeClimateGeometry(project);
  const living = geometry.rooms.find((item) => item.id === rooms.living);
  const hall = geometry.rooms.find((item) => item.id === rooms.hall);
  assert.ok(Math.abs(living.areaMm2 - 3800 * 2800) < 1, "площадь гостиной не та");
  assert.equal(living.heightMm, 2700);
  assert.ok(Math.abs(living.windowsMm2 - 1500 * 1400) < 1, "окна гостиной не посчитаны");
  assert.equal(hall.windowsMm2, 0);
  const inner = geometry.ways.find((way) => way.a && way.b);
  assert.deepEqual(new Set([inner.a, inner.b]), new Set([rooms.living, rooms.hall]));
  assert.equal(inner.leaf, true);
  const front = geometry.ways.find((way) => !way.window && (!way.a || !way.b));
  assert.ok(front, "входная дверь на улицу не найдена");
  assert.equal(front.a || front.b, rooms.hall);
  // Устройства климата: бризер — приток, кондиционер — без роли.
  const box = simHouse();
  const spec = simHouseSpec(box);
  const devices = simClimateOf(box.project, spec.accessories).devices;
  const byMark = (key) => devices.find((device) => device.markId === box.marks[key]);
  assert.equal(byMark("Б1").role, "supply");
  assert.equal(byMark("К1").role, null);
  assert.equal(byMark("Б1").roomId, box.rooms.living);
});

test("окно воздух не пропускает: открывать окна сборка не умеет", () => {
  const geometry = {
    rooms: [{ id: "living", areaMm2: 16e6, heightMm: 2700, windowsMm2: 2e6 }],
    ways: [{ id: "window", a: "living", b: null, areaMm2: 2e6, window: true, leaf: false }],
  };
  const state = new Map([["living", room(22, 45, 1200)]]);
  const without = new Map([["living", room(22, 45, 1200)]]);
  for (let index = 0; index < 30; index += 1) {
    climateStep(state, WINTER, geometry, new Set(["window"]), new Map(), true, 60, 0);
    climateStep(without, WINTER, { ...geometry, ways: [] }, new Set(), new Map(), true, 60, 0);
  }
  assert.ok(Math.abs(state.get("living").t - 22) < 0.5, "окно выстудило комнату: " + state.get("living").t);
  // Неплотности проветривают и так — окно сверх них не добавляет ничего.
  assert.equal(state.get("living").co2, without.get("living").co2, "окно проветрило комнату");
});

// ——— освещённость (правка после сборки сценариев) ——————————————————————
//
// «Датчик освещённости добавь ещё в виде метки»: метке нужен свет её
// помещения — окна, час, облака и горящие лампы.

test("освещённость: улица днём и ночью, комната — доля улицы по окнам и лампы на площадь", () => {
  const rooms = [
    { id: "living", areaMm2: 16e6, windowsMm2: 2e6 },
    { id: "hall", areaMm2: 6e6, windowsMm2: 0 },
  ];
  const noon = climateLux(rooms, new Map(), 1);
  assert.equal(noon.outdoor, CLIMATE_NIGHT_LUX + CLIMATE_SKY_LUX);
  const living = noon.rooms.get("living");
  assert.ok(living > 1000 && living < 10000, "в комнате с окнами днём не светло: " + living);
  assert.ok(noon.rooms.get("hall") < 1, "в коридоре без окон днём светло без ламп");
  const night = climateLux(rooms, new Map([["hall", 1]]), 0);
  assert.equal(night.outdoor, CLIMATE_NIGHT_LUX);
  assert.ok(Math.abs(night.rooms.get("hall") - CLIMATE_LAMP_LM / 6) < 1e-9, "лампа в коридоре светит не на его площадь");
  assert.ok(night.rooms.get("living") < 1, "ночью гостиная светла без ламп");
  // Половина яркости — половина света.
  assert.ok(Math.abs(climateLux(rooms, new Map([["hall", 0.5]]), 0).rooms.get("hall") - CLIMATE_LAMP_LM / 12) < 1e-9);
});

test("в движке: датчик освещённости ночью — темно, включили лампу — светло сразу, днём — светло от окон", () => {
  const box = simHouse();
  simPut(box, "ДОС", { x: 0.88, y: 0.3 }, "bedroom");
  const sensor = box.marks["ДОС1"];
  const spec = simHouseSpec(box);
  spec.site = { latDeg: 55.75, lonDeg: 37.6 };
  spec.climate = {
    rooms: [{ id: box.rooms.bedroom, areaMm2: 12e6, heightMm: 2700, windowsMm2: 1.5e6 }],
    ways: [],
    devices: spec.accessories.map((accessory) => ({ markId: accessory.markId, roomId: accessory.roomId, role: null, controls: [] })),
  };
  const engine = createSimEngine({ emit: () => {}, owners: [climateOwner()] });
  const midnight = Math.floor(Date.UTC(2026, 5, 15) / 86400000) * 86400000;
  engine.load(spec);
  engine.setClock({ simMs: midnight + 23 * 3600000 });
  engine.start();
  engine.tell("climate", { kind: "weather", choice: { season: "auto", sky: "clear", tempC: null, humidity: null } });
  engine.advanceTo(midnight + 23 * 3600000 + 120000);
  assert.ok(engine.value(sensor, 0, "CurrentAmbientLightLevel") < 5, "ночью в спальне светло без ламп");
  // Лампа спальни — без ожидания шага климата.
  engine.act({ kind: "set", markId: box.marks["С3"], service: 0, char: "On", value: true });
  const lit = engine.value(sensor, 0, "CurrentAmbientLightLevel");
  assert.ok(lit > 50, "лампа включена, а датчик не видит света: " + lit);
  engine.act({ kind: "set", markId: box.marks["С3"], service: 0, char: "On", value: false });
  assert.ok(engine.value(sensor, 0, "CurrentAmbientLightLevel") < 5, "лампу выключили, а свет остался");
  // Полдень следующего дня: светло от окон.
  engine.advanceTo(midnight + 36 * 3600000);
  assert.ok(engine.value(sensor, 0, "CurrentAmbientLightLevel") > 500, "в полдень в спальне темно");
  engine.stop();
});

