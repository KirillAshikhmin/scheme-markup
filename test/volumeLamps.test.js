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
  addSchemeObject,
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
  VOLUME_LAMP_SOFT_STEPS,
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

// ——— «странная тень» и светлый откос (правка после сборки сценариев) ————————
//
// Слова заказчика: «В проёмах и у стены какая странная тень и почему
// подсвечивается справа стена с проёмом… При чем даже с закрытой дверью».
// Откос, полотно и полоса пола под стеной брали более светлую из двух сторон
// или помещение одной стороны на обе; клин сквозь проём срезался из точки, и у
// нескольких ламп в углу проёма сходился веер резких рёбер.

/** Помещение стенда по стороне перегородки `x = 0`: гостиная слева, коридор справа. */
const sideRoom = (box, x) => (x < 0 ? box.rooms.living : box.rooms.hall);

test("откосы, перемычка и порог — пополам по стене, и половина светлеет своей комнатой", () => {
  const box = stand();
  for (const open of [false, true]) {
    const scene = sceneOf(box, open);
    // Откосы и перемычка проёма (рамка двери): у каждой половины помещение её
    // стороны, обе стороны есть.
    const frame = scene.faces.filter((face) => face.doorway === box.doorId);
    assert.ok(frame.length >= 4, "у проёма нет половин откосов: " + frame.length);
    for (const face of frame) {
      const middle = face.p.reduce((sum, point) => sum + point.x, 0) / face.p.length;
      assert.equal(face.room, sideRoom(box, middle), "половина откоса не своей стороны");
      assert.equal(face.sides, undefined, "откос снова светлеет по более светлой стороне");
    }
    assert.deepEqual(new Set(frame.map((face) => face.room)), new Set([box.rooms.living, box.rooms.hall]));
    // Полоса пола под перегородкой с напуском: половина у коридора — коридора,
    // и в гостиную она не заходит.
    const strip = scene.faces.filter(
      (face) => face.rgb === VOLUME_FLOOR_RGB && face.n.z > 0 && face.p.every((point) => Math.abs(point.x) <= 150 + 0.01),
    );
    assert.equal(strip.length, 2, "полоса под перегородкой не двумя половинами");
    for (const face of strip) {
      const xs = face.p.map((point) => point.x);
      assert.ok(Math.min(...xs) >= -0.01 || Math.max(...xs) <= 0.01, "половина полосы перешла середину стены");
      assert.equal(face.room, sideRoom(box, (Math.min(...xs) + Math.max(...xs)) / 2), "половина полосы не своей стороны");
    }
  }
  // Полотно закрытой двери — лицом в одну комнату, изнанкой в другую.
  const leaf = sceneOf(box, false).faces.find((face) => face.doorId === box.doorId && face.both && face.rgb !== VOLUME_WALL_RGB);
  assert.ok(leaf, "у закрытой двери нет полотна");
  assert.deepEqual(new Set([leaf.room, leaf.backRoom]), new Set([box.rooms.living, box.rooms.hall]));
});

test("закрытая дверь в коридор не светит: из коридора свет гостиной не виден ничем", () => {
  const box = stand();
  const scene = sceneOf(box, false);
  // Из коридора на дверь: полотно, откосы, порог и пол у стены — всё в кадре.
  const camera = { at: { x: 1700, y: 1200, z: 1600 }, yaw: Math.atan2(-1300, -1700), pitch: -0.3 };
  const frameBox = { width: 800, height: 500 };
  const hallOnly = volumeLiveLight(scene, liveOf(box, { hallLamp: 0.3 }), { physical: true });
  const withLiving = volumeLiveLight(scene, liveOf(box, { hallLamp: 0.3, lamp: 1 }), { physical: true });
  // Что **видно** — по пикселям: кадр выкладывается в порядке рисования, и
  // спрятанное за полотном и стеной закрывается тем, что ближе. Из коридора
  // при закрытой двери не меняется ни один пиксель. Было — полотно, откос и
  // полоса пола у стены светлели по гостиной.
  const seen = (light) => volumeRaster(volumeFrame(scene, camera, frameBox, null, NIGHT, light), frameBox);
  const hall = seen(hallOnly);
  assert.ok(volumeFrame(scene, camera, frameBox, null, NIGHT, hallOnly).some((polygon) => polygon.door === box.doorId), "дверь не в кадре");
  const changed = seen(withLiving).filter((pixel, index) => pixel !== hall[index]).length;
  assert.equal(changed, 0, "лампа гостиной видна из коридора сквозь закрытую дверь: пикселей " + changed);
  // А из гостиной та же дверь светлеет её лампой.
  const living = { at: { x: -3000, y: 1000, z: 1600 }, yaw: Math.atan2(-1000, 3000), pitch: -0.25 };
  const fromLiving = (light) => volumeRaster(volumeFrame(scene, living, frameBox, null, NIGHT, light), frameBox);
  const dark = fromLiving(hallOnly);
  assert.ok(fromLiving(withLiving).some((pixel, index) => pixel !== dark[index]), "своя лампа не светит гостиную");
});

/**
 * Кадр в пиксели — грубо, шагом в четыре точки: многоугольники по порядку
 * рисования, прозрачные смешиваются с тем, что под ними. Ответ — список
 * цветов `"r,g,b"` по точкам.
 */
function volumeRaster(polygons, frameBox, step = 4) {
  const width = Math.ceil(frameBox.width / step);
  const height = Math.ceil(frameBox.height / step);
  const pixels = Array.from({ length: width * height }, () => [0, 0, 0]);
  for (const polygon of polygons) {
    if (polygon.stroke || !polygon.fill) continue;
    const parts = polygon.fill.match(/[\d.]+/g).map(Number);
    const alpha = parts.length > 3 ? parts[3] : 1;
    const xy = polygon.xy;
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (let index = 0; index < xy.length; index += 2) {
      minX = Math.min(minX, xy[index]);
      maxX = Math.max(maxX, xy[index]);
      minY = Math.min(minY, xy[index + 1]);
      maxY = Math.max(maxY, xy[index + 1]);
    }
    for (let row = Math.max(0, Math.floor(minY / step)); row < Math.min(height, Math.ceil(maxY / step) + 1); row += 1) {
      for (let column = Math.max(0, Math.floor(minX / step)); column < Math.min(width, Math.ceil(maxX / step) + 1); column += 1) {
        const x = column * step + step / 2;
        const y = row * step + step / 2;
        let hit = false;
        for (let i = 0, j = xy.length / 2 - 1; i < xy.length / 2; j = i++) {
          const yi = xy[2 * i + 1];
          const yj = xy[2 * j + 1];
          if (yi > y !== yj > y && x < ((xy[2 * j] - xy[2 * i]) * (y - yi)) / (yj - yi) + xy[2 * i]) hit = !hit;
        }
        if (!hit) continue;
        const pixel = pixels[row * width + column];
        for (let channel = 0; channel < 3; channel += 1) pixel[channel] = pixel[channel] * (1 - alpha) + parts[channel] * alpha;
      }
    }
  }
  return pixels.map((pixel) => pixel.map((value) => Math.round(value)).join(","));
}

test("сторона длинной стены — своей комнаты в каждой: наружная стена гостиной не красится коридором", () => {
  const box = stand();
  const scene = sceneOf(box, false);
  // Южная наружная стена (y = −1500) идёт вдоль гостиной и коридора разом.
  const inner = scene.faces.filter(
    (face) => face.rgb === VOLUME_WALL_RGB && face.n.y > 0.9 && face.p.every((point) => Math.abs(point.y + 1400) < 0.01),
  );
  assert.ok(inner.length >= 2, "внутренняя сторона наружной стены не поделена по комнатам: " + inner.length);
  for (const face of inner) {
    const xs = face.p.map((point) => point.x);
    const middle = (Math.min(...xs) + Math.max(...xs)) / 2;
    if (Math.abs(middle) < 300) continue;
    assert.equal(face.room, sideRoom(box, middle), "кусок стороны стены в чужой комнате");
  }
  // Пятно лампы гостиной ложится на свою стену у себя — и не ложится у соседки.
  const light = volumeLiveLight(scene, liveOf(box, { lamp: 1 }), { physical: true });
  const lit = [...light.decals.keys()].filter((host) => inner.includes(host) || (host.rgb === VOLUME_WALL_RGB && host.n.y > 0.9));
  assert.ok(lit.some((host) => host.room === box.rooms.living), "на стену гостиной пятно её лампы не легло");
});

test("клин сквозь открытую дверь — с мягким краем: у нескольких ламп нет веера резких рёбер", () => {
  const box = stand();
  const scene = sceneOf(box, true);
  const light = volumeLiveLight(scene, liveOf(box, { lamp: 1 }), { physical: true });
  const rings = [];
  for (const [host, list] of light.decals) {
    if (host.room !== box.rooms.hall || host.rgb !== VOLUME_FLOOR_RGB) continue;
    for (const ring of list) if (ring.markId === box.marks.lamp) rings.push(ring);
  }
  const inside = (polygon, x, y) => {
    let hit = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const a = polygon[i];
      const b = polygon[j];
      if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) hit = !hit;
    }
    return hit;
  };
  const at = (x, y) => 1 - rings.filter((ring) => inside(ring.p, x, y)).reduce((keep, ring) => keep * (1 - ring.alpha), 1);
  // Поперёк клина на полу коридора: свет нарастает ступенями не больше
  // четверти своей силы. Из точки край был ножом — весь свет одним шагом в
  // сантиметр (замер до правки: ступень в 100 % силы).
  for (const x of [400, 800]) {
    let peak = 0;
    let worst = 0;
    let prev = null;
    for (let y = -1400; y <= 1400; y += 10) {
      const value = at(x, y);
      peak = Math.max(peak, value);
      if (prev !== null) worst = Math.max(worst, Math.abs(value - prev));
      prev = value;
    }
    assert.ok(peak > 0.15, "клина в коридоре нет: " + peak);
    assert.ok(worst <= peak * 0.25, "край клина резкий: ступень " + worst.toFixed(3) + " при силе " + peak.toFixed(3));
  }
  assert.ok(VOLUME_LAMP_SOFT_STEPS >= 4);
});

test("порог открытой двери светится сквозь проём: половина у коридора — не тёмная полоса", () => {
  const box = stand();
  const scene = sceneOf(box, true);
  const light = volumeLiveLight(scene, liveOf(box, { lamp: 1 }), { physical: true });
  const threshold = [...light.decals.keys()].find(
    (host) => host.room === box.rooms.hall && host.rgb === VOLUME_FLOOR_RGB && host.p.every((point) => point.x >= -0.01 && point.x <= 150.01),
  );
  assert.ok(threshold, "на половину порога у коридора свет гостиной не лёг");
  // Свет лежит и внутри толщины стены (0…100), а не только за ней.
  const rings = light.decals.get(threshold).filter((ring) => ring.markId === box.marks.lamp);
  assert.ok(rings.some((ring) => Math.min(...ring.p.map((point) => point.x)) < 50), "порог внутри проёма остался без света");
});

// «А сделай что бы физический свет подсвечивал объекты (мебель)» (правка
// после сборки сценариев): пятна лампы ложатся и на вещи её комнаты.
test("физический свет светит мебель: пятна на диване под лампой, не на светящемся теле и не за закрытой дверью", () => {
  const box = stand();
  let project = box.project;
  const sofa = (x, y) => {
    const made = addSchemeObject(project, { schemeId: box.schemeId, catalogKey: "sofa", shape: "rect", atMm: { x, y }, widthMm: 2200, depthMm: 900, heightMm: 850 });
    project = made.project;
    return made.schemeObject.id;
  };
  sofa(-2000, -700);
  sofa(1000, -900);
  const scene = volumeScene(project, box.schemeId, { roofOff: true, openDoorIds: new Set() });
  const light = volumeLiveLight(scene, liveOf(box, { lamp: 1 }), { physical: true });
  const mine = [...light.decals.entries()].filter(([host, list]) => list.some((ring) => ring.markId === box.marks.lamp));
  const things = mine.filter(([host]) => host.thing);
  assert.ok(things.length > 0, "лампа не светит мебель");
  assert.ok(things.every(([host]) => host.room === box.rooms.living), "лампа гостиной светит вещь за закрытой дверью");
  const top = things.find(([host]) => host.n.z > 0.9);
  assert.ok(top, "у дивана под лампой не светится верх");
  for (const ring of top[1]) assert.ok(ring.alpha > 0 && ring.alpha < 1);
  // Внешние кольца, накрывшие кусок целиком, — одним многоугольником, а не
  // стопкой одинаковых.
  for (const [, list] of things) {
    const shapes = list.filter((ring) => ring.markId === box.marks.lamp).map((ring) => JSON.stringify(ring.p));
    assert.equal(new Set(shapes).size, shapes.length, "на куске вещи стопка одинаковых колец");
  }
  // Тело лампы светится само: чужое пятно его бы притушило.
  assert.ok(![...light.decals.keys()].some((host) => host.lit), "пятно легло на светящееся тело");
  // Ночью пятна на вещах — в кадре.
  const camera = { at: { x: -2000, y: 1200, z: 1600 }, yaw: -Math.PI / 2, pitch: -0.4 };
  const frame = volumeFrame(scene, camera, { width: 800, height: 500 }, null, NIGHT, light);
  assert.ok(frame.length > volumeFrame(scene, camera, { width: 800, height: 500 }, null, NIGHT, null).length, "пятен в кадре нет");
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
