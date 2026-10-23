// Свет ламп в «Объёме» и плавный свет (правка после сборки сценариев).
//
// Слова заказчика: «давай для всего света сделаем плавное включение и
// отключение. Так же что бы чем больше света включено, тем ярче в комнате, и
// опциональный, включенный по умолчанию физический свет, что бы светил и в
// проёмах и чуть передавал в соседнюю комнату»; «физический свет, если
// возможно, что бы не заполнял всю комнату сразу, а светил в своей области.
// Например, Подсветка картины не должна заливать светом всю комнату»; «границы
// что бы плавные были, с переходом. Можно несколько пятен, каждое из который
// больше и менее яркое».
//
// Проверяются чистые швы: плавность (`lightFadeLive`), сила лампы и светлота
// комнаты, пятна (`volumeLampDecals`) и кадр (`volumeFrame`). Окно с холстом —
// живым прогоном.
import test from "node:test";
import assert from "node:assert/strict";

import {
  addMark,
  addOpening,
  addOutline,
  addRoom,
  addScheme,
  addWall,
  applyMarkWalls,
  createProject,
  planMmToFraction,
  setMarkDimensions,
  setPlanOrigin,
  setPlanScale,
  setSchemeWallHeight,
} from "../src/model.js";
import {
  VOLUME_FLOOR_RGB,
  VOLUME_LAMP_BOUNCE,
  VOLUME_LAMP_RINGS,
  VOLUME_NIGHT_RGB,
  VOLUME_WALL_RGB,
  volumeFrame,
  volumeLampDecals,
  volumeLampPower,
  volumeLampSources,
  volumeLiveLight,
  volumeMarkPlace,
  volumeRoomShare,
  volumeScene,
} from "../src/volume.js";
import { LIGHT_FADE_MS, lightFadeLive, lightFadeMemo, lightFadeOf } from "../src/lightFade.js";
import { simLiveFrame, simLiveMemo } from "../src/render.js";

// ——— стенд: гостиная и коридор через дверь ——————————————————————————————
//
// Гостиная −4000…0 по x, коридор 0…2000, обе 3 м в глубину; дверь в
// перегородке x = 0. Под потолком гостиной — светильник, на её западной стене —
// подсветка картины, в коридоре — свой светильник.

function lampStand(options = {}) {
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
  outer.forEach((point, index) => wall(point, outer[(index + 1) % outer.length]));
  const middle = wall({ x: 0, y: -1500 }, { x: 0, y: 1500 });
  const rooms = {};
  const room = (key, name, from, to) => {
    const made = addRoom(project, name);
    project = made.project;
    rooms[key] = made.room.id;
    project = addOutline(project, {
      schemeId,
      roomId: made.room.id,
      points: [
        { x: from, y: -1400 },
        { x: to, y: -1400 },
        { x: to, y: 1400 },
        { x: from, y: 1400 },
      ].map(fr),
    }).project;
  };
  room("living", "Гостиная", -3900, -100);
  room("hall", "Коридор", 100, 1900);
  const door = addOpening(project, {
    wallId: middle,
    kind: "door",
    atMm: 1000,
    widthMm: 900,
    heightMm: 2100,
    heightAboveFloorMm: 0,
    hinge: "start",
    swing: "left",
  });
  project = door.project;
  const marks = {};
  const put = (key, code, at, heightAboveFloor = null) => {
    const type = project.markTypes.find((item) => item.code === code);
    const made = addMark(project, { schemeId, typeId: type.id, kind: "point", points: [fr(at)] });
    project = made.project;
    if (heightAboveFloor !== null) project = setMarkDimensions(project, made.marks[0].id, { heightAboveFloor }).project;
    project = applyMarkWalls(project, schemeId).project;
    marks[key] = made.marks[0].id;
  };
  put("lamp", "С", { x: -2000, y: 0 });
  // Подсветка картины — на западной стене, над картиной.
  put("picture", "ПС", { x: -3900, y: 0 }, 1800);
  put("hallLamp", "С", { x: 1000, y: 0 });
  const openDoorIds = options.doorOpen ? new Set([door.opening.id]) : new Set();
  return { project, schemeId, rooms, marks, doorId: door.opening.id, openDoorIds };
}

let standMemo = null;
const stand = () => standMemo || (standMemo = lampStand());

const sceneOf = (box, open = false) =>
  volumeScene(box.project, box.schemeId, { roofOff: true, openDoorIds: open ? new Set([box.doorId]) : new Set() });

/** Состояние дома: `{ключ: яркость 0…1}` — горит, остальные лампы выключены. */
function liveOf(box, lit) {
  const map = new Map();
  for (const [key, id] of Object.entries(box.marks)) {
    const on = lit[key] !== undefined;
    map.set(id, { on, level: on ? lit[key] : 1, kind: "light", roomId: null });
  }
  return map;
}

const NIGHT = { rgb: VOLUME_NIGHT_RGB, share: 0.8 };

// ——— плавность ———————————————————————————————————————————————————————————

test("плавный свет: увиденный впервые встаёт сразу, переключённый разгорается и гаснет", () => {
  const memo = lightFadeMemo();
  const on = new Map([["a", { on: true, level: 0.5, kind: "light" }]]);
  // Открыли «Объём» с горящей лампой — она горит, а не разгорается заново.
  const first = lightFadeLive(on, memo, 0);
  assert.equal(first.busy, false);
  assert.equal(first.live, on, "улёгшийся свет — та же карта");
  // Выключили — гаснет: на полпути ещё виден и тусклее, яркость не падает к нулю.
  const off = new Map([["a", { on: false, level: 0, kind: "light" }]]);
  assert.equal(lightFadeLive(off, memo, 1000).live.get("a").fade, 1, "погасла в миг выключения");
  const mid = lightFadeLive(off, memo, 1000 + LIGHT_FADE_MS / 2);
  assert.equal(mid.busy, true);
  const shown = mid.live.get("a");
  assert.equal(shown.on, true, "гаснущая лампа пропала сразу");
  assert.ok(shown.fade > 0.3 && shown.fade < 0.7, "на полпути не полпути: " + shown.fade);
  assert.equal(shown.level, 0.5, "яркость гаснущей лампы упала к нулю");
  assert.ok(lightFadeOf(shown) === shown.fade);
  const end = lightFadeLive(off, memo, 1000 + LIGHT_FADE_MS);
  assert.equal(end.busy, false);
  assert.equal(end.live, off, "погасшая — та же карта, что пришла");
  // Включили и тут же выключили — гаснет с той яркости, до которой дошла.
  lightFadeLive(on, memo, 10000);
  const part = lightFadeLive(on, memo, 10000 + LIGHT_FADE_MS / 4).live.get("a").fade;
  const back = lightFadeLive(off, memo, 10000 + LIGHT_FADE_MS / 4).live.get("a").fade;
  assert.ok(Math.abs(back - part) < 1e-9, "выключение на полпути прыгнуло: " + part + " → " + back);
  // Не свет и не экран — без плавности.
  const outlet = new Map([["r", { on: true, kind: "outlet" }]]);
  assert.equal(lightFadeLive(outlet, lightFadeMemo(), 0).live, outlet);
});

test("плавный свет на «Схеме»: ореол гаснет плавно, и кадр просит продолжения", () => {
  const memo = simLiveMemo();
  const kinds = new Map([["a", { kind: "light" }]]);
  const on = new Map([["a", { on: true, level: 1 }]]);
  simLiveFrame(on, kinds, memo, 0);
  const off = new Map([["a", { on: false, level: 0 }]]);
  simLiveFrame(off, kinds, memo, 1000);
  const mid = simLiveFrame(off, kinds, memo, 1000 + LIGHT_FADE_MS / 2);
  assert.equal(mid.animate, true, "гаснущий ореол не просит кадра");
  assert.equal(mid.live.get("a").on, true);
  assert.ok(mid.live.get("a").fade < 1);
  const end = simLiveFrame(off, kinds, memo, 1000 + LIGHT_FADE_MS);
  assert.equal(end.animate, false);
  assert.equal(end.live.get("a").on, false);
});

// ——— сила и светлота ——————————————————————————————————————————————————————

test("сила лампы — по её размеру: подсветка слабее точечного, точечный слабее плафона", () => {
  const box = stand();
  const scene = sceneOf(box);
  const picture = volumeLampPower(volumeMarkPlace(scene, box.marks.picture));
  const lamp = volumeLampPower(volumeMarkPlace(scene, box.marks.lamp));
  assert.ok(picture < 0.3, "подсветка картины светит как плафон: " + picture);
  assert.ok(lamp > 0.8 && lamp < 1.2, "плафон 200 × 120 — не около единицы: " + lamp);
  // Подсветка на стене светит от стены, плафон — вниз.
  const [wallSource] = volumeLampSources(volumeMarkPlace(scene, box.marks.picture));
  assert.ok(wallSource.wall, "подсветка на стене не знает своей стены");
  const [ceilingSource] = volumeLampSources(volumeMarkPlace(scene, box.marks.lamp));
  assert.deepEqual(ceilingSource.dir, { x: 0, y: 0, z: -1 });
});

test("«чем больше света включено, тем ярче в комнате» — и светлее полной не бывает", () => {
  let was = 0;
  for (let lamps = 1; lamps <= 8; lamps += 1) {
    const share = volumeRoomShare(lamps, 16e6);
    assert.ok(share > was, "лампа " + lamps + " не добавила света");
    assert.ok(share < 1);
    was = share;
  }
  // Одна лампа в маленькой комнате светлит больше, чем в большой.
  assert.ok(volumeRoomShare(1, 4e6) > volumeRoomShare(1, 25e6));
  const box = stand();
  const scene = sceneOf(box);
  const one = volumeLiveLight(scene, liveOf(box, { lamp: 1 })).rooms.get(box.rooms.living);
  const two = volumeLiveLight(scene, liveOf(box, { lamp: 1, picture: 1 })).rooms.get(box.rooms.living);
  assert.ok(two > one, "вторая лампа не прибавила света: " + one + " → " + two);
  // Пока лампа разгорается, комната светлеет вместе с ней.
  const half = new Map(liveOf(box, { lamp: 1 }));
  half.set(box.marks.lamp, { ...half.get(box.marks.lamp), fade: 0.5 });
  const rising = volumeLiveLight(scene, half).rooms.get(box.rooms.living);
  assert.ok(rising > 0 && rising < one, "разгорающаяся лампа светит как горящая");
});

// ——— физический свет ——————————————————————————————————————————————————————

test("физический свет: комнату светлит только отражённый, а лампа светит пятном", () => {
  const box = stand();
  const scene = sceneOf(box);
  const live = liveOf(box, { lamp: 1 });
  const plain = volumeLiveLight(scene, live);
  const physical = volumeLiveLight(scene, live, { physical: true });
  assert.equal(plain.decals, null, "без отметки пятна есть");
  const ambient = physical.rooms.get(box.rooms.living);
  assert.ok(ambient < plain.rooms.get(box.rooms.living), "отражённый свет не слабее полного");
  assert.ok(Math.abs(ambient - volumeRoomShare(volumeLampPower(volumeMarkPlace(scene, box.marks.lamp)) * VOLUME_LAMP_BOUNCE, 3800 * 2800)) < 1e-9);
  // Пятна лежат на кусках пола гостиной, и колец у пятна несколько — каждое
  // шире и тусклее: на пол под плафоном легли все.
  const floors = [...physical.decals.entries()].filter(([host]) => host.rgb === VOLUME_FLOOR_RGB && host.room === box.rooms.living);
  assert.ok(floors.length > 0, "под плафоном нет пятна на полу");
  const rings = floors.flatMap(([, list]) => list).filter((ring) => ring.markId === box.marks.lamp);
  assert.ok(rings.length >= VOLUME_LAMP_RINGS.length, "колец меньше, чем ступеней перехода: " + rings.length);
  for (const ring of rings) assert.ok(ring.alpha > 0 && ring.alpha < 1);
  // Закрытая дверь в коридор пятна не пропускает.
  const hall = [...physical.decals.entries()].filter(([host, list]) => host.room === box.rooms.hall && list.some((ring) => ring.markId === box.marks.lamp));
  assert.equal(hall.length, 0, "сквозь закрытую дверь светит пятно");
});

test("физический свет: открытая дверь пропускает клин пятна и долю света в коридор", () => {
  const box = stand();
  const closed = sceneOf(box, false);
  const open = sceneOf(box, true);
  const live = liveOf(box, { lamp: 1 });
  const shut = volumeLiveLight(closed, live, { physical: true });
  const through = volumeLiveLight(open, live, { physical: true });
  assert.equal(shut.rooms.get(box.rooms.hall) || 0, 0, "в коридор светит сквозь закрытую дверь");
  const spill = through.rooms.get(box.rooms.hall);
  assert.ok(spill > 0 && spill < through.rooms.get(box.rooms.living) * 0.5, "доля коридора не «чуть»: " + spill);
  const wedge = [...through.decals.entries()].filter(
    ([host, list]) => host.room === box.rooms.hall && list.some((ring) => ring.markId === box.marks.lamp),
  );
  assert.ok(wedge.length > 0, "сквозь открытую дверь пятно не легло");
  // Клин узкий: на пол коридора он ложится полосой у двери, а не на весь пол.
  const floor = wedge
    .filter(([host]) => host.rgb === VOLUME_FLOOR_RGB)
    .flatMap(([, list]) => list)
    .filter((ring) => ring.markId === box.marks.lamp);
  assert.ok(floor.length > 0, "на пол коридора клин не лёг");
  for (const ring of floor) {
    const ys = ring.p.map((point) => point.y);
    assert.ok(Math.max(...ys) - Math.min(...ys) < 2800, "клин сквозь дверь залил коридор во всю ширину");
  }
});

test("подсветка картины светит свою стену, а не всю комнату", () => {
  const box = stand();
  const scene = sceneOf(box);
  const light = volumeLiveLight(scene, liveOf(box, { picture: 1 }), { physical: true });
  const strongest = (filter) => {
    let best = 0;
    for (const [host, list] of light.decals) {
      if (!filter(host)) continue;
      let sum = 1;
      for (const ring of list) if (ring.markId === box.marks.picture) sum *= 1 - ring.alpha;
      best = Math.max(best, 1 - sum);
    }
    return best;
  };
  const wall = strongest((host) => host.rgb === VOLUME_WALL_RGB && host.n.x > 0.9);
  const floor = strongest((host) => host.rgb === VOLUME_FLOOR_RGB);
  assert.ok(wall > 0.5, "своя стена у подсветки почти не светится: " + wall);
  assert.ok(floor < wall / 3, "подсветка залила пол: " + floor + " против стены " + wall);
  // Отражённого света от неё — малость.
  assert.ok(light.rooms.get(box.rooms.living) < 0.1);
});

test("откосы и полотно двери — между двумя помещениями и светлеют по светлой стороне", () => {
  const box = stand();
  const scene = sceneOf(box, true);
  const jambs = scene.faces.filter((face) => face.sides);
  assert.ok(jambs.length > 0, "у проёма нет граней со сторонами");
  const sides = jambs[0].sides;
  assert.deepEqual(new Set([sides.a, sides.b]), new Set([box.rooms.living, box.rooms.hall]));
});

test("кадр ночью: кольца пятна идут сразу за своим куском, днём их нет", () => {
  const box = stand();
  const scene = sceneOf(box);
  const camera = { at: { x: -3000, y: -1000, z: 1600 }, yaw: 0.3, pitch: -0.35 };
  const frameBox = { width: 800, height: 500 };
  const live = volumeLiveLight(scene, liveOf(box, { lamp: 1 }), { physical: true });
  const plain = volumeFrame(scene, camera, frameBox, null, NIGHT, null);
  const night = volumeFrame(scene, camera, frameBox, null, NIGHT, live);
  assert.ok(night.length > plain.length, "ночью пятен в кадре нет");
  const translucent = night.filter((polygon) => polygon.fill.startsWith("rgba(") && !polygon.pick);
  assert.ok(translucent.length > 0, "колец прозрачностью нет");
  // Кольцо стоит в очереди с местом своего куска — не раньше его.
  for (const ring of translucent) {
    const at = night.indexOf(ring);
    const host = night.slice(0, at).reverse().find((polygon) => polygon.order === ring.order && !polygon.fill.startsWith("rgba("));
    assert.ok(host, "кольцо легло в кадр раньше своей грани");
  }
  const day = volumeFrame(scene, camera, frameBox, null, null, live);
  assert.equal(day.filter((polygon) => polygon.fill.startsWith("rgba(") && !polygon.pick).length, 0, "днём пятна лампы рисуются");
});
