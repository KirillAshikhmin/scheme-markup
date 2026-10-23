// Свет неба при физическом свете, луна и ночь, ярче лампы, оси джойстиков
// (правки после сборки сценариев).
//
// Слова заказчика: «Для солнца и Луны тоже примени физический свет»; «От луны
// должно быть тоже освещение, но слабое, и чем полнее луна, тем сильнее, ну и
// белым светом»; «сделай ночь темнее процентов на 40»; «А с полной луной можно
// на 20% темнее текущего уровня. Динамически от фазы менять»; «Свет от
// светильников сделай ярче, днём сейчас их вообще не видно»; «яркость ламп не
// только днём увеличить надо, но и ночью, всегда»; «Поменяй местами
// вертикальные оси между левым и правым… Но это сделай опцией» (эту отметку
// потом сменило управление «как стандарт в отрасли» — см. `volume.test.js`).
//
// Проверяются чистые швы: свет комнат (`volumeLiveLight` с тоном часа), пятна
// окон и луны, снимок часа (`volumeMood`) и кадр (`volumeFrame`). Холст с
// окном — живым прогоном.
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
  setPlanOrigin,
  setPlanScale,
  setSchemeWallHeight,
} from "../src/model.js";
import {
  VOLUME_FLOOR_RGB,
  VOLUME_MOON_NIGHT_SHARE,
  VOLUME_NIGHT_RGB,
  VOLUME_NIGHT_SHARE,
  volumeFrame,
  volumeIndoorTint,
  volumeMood,
  volumeMoonSpotFaces,
  volumeMoonTint,
  volumeLiveLight,
  volumeRoomTint,
  volumeScene,
  volumeTintRgb,
} from "../src/volume.js";

// ——— стенд: гостиная с окном и коридор без окон ——————————————————————————
//
// Гостиная −4000…0 по x, коридор 0…2000, обе 3 м в глубину; дверь в
// перегородке x = 0, окно 1500 × 1400 — в северной стене гостиной.

function skyStand() {
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
  const outerIds = outer.map((point, index) => wall(point, outer[(index + 1) % outer.length]));
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
  // Северная стена идёт от x = −4000 на восток: окно на 1300…2800 вдоль неё —
  // посреди гостиной.
  project = addOpening(project, {
    wallId: outerIds[0],
    kind: "window",
    atMm: 1300,
    widthMm: 1500,
    heightMm: 1400,
    heightAboveFloorMm: 800,
  }).project;
  const marks = {};
  const type = project.markTypes.find((item) => item.code === "С");
  const made = addMark(project, { schemeId, typeId: type.id, kind: "point", points: [fr({ x: 1000, y: 0 })] });
  project = applyMarkWalls(made.project, schemeId).project;
  marks.hallLamp = made.marks[0].id;
  return { project, schemeId, rooms, marks, doorId: door.opening.id };
}

let standMemo = null;
const stand = () => standMemo || (standMemo = skyStand());
const sceneOf = (box, open = false) =>
  volumeScene(box.project, box.schemeId, { roofOff: true, openDoorIds: open ? new Set([box.doorId]) : new Set() });

const NOON = { rgb: VOLUME_NIGHT_RGB, share: 0 };
const NIGHT = { rgb: VOLUME_NIGHT_RGB, share: VOLUME_NIGHT_SHARE };
const lightOf = (fill) => {
  const [r, g, b] = String(fill).match(/[\d.]+/g).map(Number);
  return r + g + b;
};

// ——— небо при физическом свете ————————————————————————————————————————————

test("солнце: днём комнату светят её окна, комната без окон темна", () => {
  const box = stand();
  const scene = sceneOf(box);
  assert.equal(volumeLiveLight(scene, null, { physical: false, tint: NOON }), null, "без физического света небо считается");
  const light = volumeLiveLight(scene, null, { physical: true, tint: NOON });
  assert.ok(light, "без дома физический свет неба не дал ответа");
  assert.ok(light.day.get(box.rooms.living) > 0.4, "гостиную с окном небо не светит: " + light.day.get(box.rooms.living));
  assert.equal(light.day.get(box.rooms.hall), 0, "коридор без окон светит небо");
  // Тон комнаты: у гостиной тьмы мало, у коридора — как ночью.
  const living = volumeIndoorTint(NOON, light.day.get(box.rooms.living));
  const hall = volumeIndoorTint(NOON, 0);
  assert.equal(hall.share, VOLUME_NIGHT_SHARE, "коридор без окон днём не темнее ночи");
  assert.ok(living.share < hall.share / 2, "гостиная с окном не светлее коридора: " + living.share);
  // Днём тьма серая, а не синяя: синева у ночи от неба.
  assert.ok(Math.abs(hall.rgb[2] - hall.rgb[0]) < 10, "дневная тьма коридора синяя: " + hall.rgb.join(","));
  // Ночью свет окон гаснет: доля неба ноль.
  const night = volumeLiveLight(scene, null, { physical: true, tint: NIGHT });
  assert.equal(night.day.get(box.rooms.living), 0, "ночью окно светит, как днём");
  assert.equal(night.skyDecals, null, "ночью у окна пятно");
});

test("солнце: открытая дверь отдаёт коридору долю света и клин пятна окна", () => {
  const box = stand();
  const shut = volumeLiveLight(sceneOf(box, false), null, { physical: true, tint: NOON });
  const open = volumeLiveLight(sceneOf(box, true), null, { physical: true, tint: NOON });
  assert.equal(shut.day.get(box.rooms.hall), 0);
  const spill = open.day.get(box.rooms.hall);
  assert.ok(spill > 0 && spill < open.day.get(box.rooms.living), "доля коридора не та: " + spill);
  const wedge = [...open.skyDecals.entries()].filter(([host]) => host.room === box.rooms.hall);
  assert.ok(wedge.length > 0, "сквозь открытую дверь свет окна не лёг");
});

test("солнце: у окна светлее, в глубине комнаты темнее — пятно окна кольцами", () => {
  const box = stand();
  const scene = sceneOf(box);
  const light = volumeLiveLight(scene, null, { physical: true, tint: NOON });
  const floors = [...light.skyDecals.entries()].filter(([host]) => host.rgb === VOLUME_FLOOR_RGB && host.room === box.rooms.living);
  assert.ok(floors.length > 0, "у окна на полу нет пятна");
  const rings = floors.flatMap(([, list]) => list);
  assert.ok(rings.length >= 4, "у пятна окна нет перехода: " + rings.length);
  assert.ok([...light.windows.values()].every((strength) => strength === 1), "днём окно светит не в полную силу");
  // Середина пятна — у окна (северная стена, y = −1500), а не посреди комнаты.
  const ys = rings.flatMap((ring) => ring.p.map((point) => point.y));
  assert.ok(Math.min(...ys) < -1000, "пятно окна не дошло до окна");
  // Кадр: пол у окна светлее пола у южной стены.
  const camera = { at: { x: -2000, y: 1200, z: 1600 }, yaw: -Math.PI / 2, pitch: -0.5 };
  const frame = volumeFrame(scene, camera, { width: 800, height: 500 }, null, NOON, light);
  assert.ok(frame.some((polygon) => String(polygon.fill).startsWith("rgba(")), "колец окна в кадре нет");
});

test("лампа ярче всегда: днём в комнате видна, ночью освещает", () => {
  // «Свет от светильников сделай ярче, днём сейчас их вообще не видно»;
  // «не только днём, но и ночью, всегда».
  const day = volumeRoomTint(NOON, 1);
  assert.ok(day.share > 0.1, "днём горящая лампа не меняет комнату");
  assert.ok(lightOf("rgb(" + volumeTintRgb([200, 200, 200], day).join(",") + ")") > 600, "днём лампа темнит комнату");
  const night = volumeRoomTint(NIGHT, 1);
  const dark = lightOf("rgb(" + volumeTintRgb([200, 200, 200], NIGHT).join(",") + ")");
  const lit = lightOf("rgb(" + volumeTintRgb([200, 200, 200], night).join(",") + ")");
  // Комната под полной лампой ночью — почти дневная (пятно под лампой — светлее дня).
  assert.ok(lit > 570, "ночью полная лампа не освещает комнату до дневной светлоты: " + lit);
  assert.ok(lit > dark * 1.8, "ночью лампа светит приглушённо: " + dark + " → " + lit);
  // Коридор без окон днём с лампой — светлее, чем без неё.
  const box = stand();
  const scene = sceneOf(box);
  const live = new Map([[box.marks.hallLamp, { on: true, level: 1, kind: "light", roomId: null }]]);
  const light = volumeLiveLight(scene, live, { physical: true, tint: NOON });
  assert.ok(light.rooms.get(box.rooms.hall) > 0.4, "лампа коридора светит слабо: " + light.rooms.get(box.rooms.hall));
  assert.ok(light.decals, "днём у лампы нет пятна");
  const camera = { at: { x: 1000, y: 1200, z: 1600 }, yaw: -Math.PI / 2, pitch: -0.6 };
  const frameBox = { width: 800, height: 500 };
  const off = volumeFrame(scene, camera, frameBox, null, NOON, volumeLiveLight(scene, null, { physical: true, tint: NOON }));
  const on = volumeFrame(scene, camera, frameBox, null, NOON, light);
  const sum = (frame) => frame.filter((polygon) => polygon.fill && !polygon.pick).reduce((total, polygon) => total + lightOf(polygon.fill), 0);
  assert.ok(on.length > off.length, "днём пятна лампы в кадре нет");
  assert.ok(sum(on) > sum(off), "днём горящая лампа коридор не светлит");
});

// ——— луна ——————————————————————————————————————————————————————————————————

test("ночь темнее на 40 %, а под полной луной — только на 20 %, и по фазе", () => {
  assert.ok(Math.abs(VOLUME_NIGHT_SHARE - 0.45 * 1.4) < 1e-9, "ночь не на 40 % темнее прежней");
  assert.ok(Math.abs(VOLUME_MOON_NIGHT_SHARE - 0.45 * 1.2) < 1e-9, "под полной луной ночь не на 20 % темнее прежней");
  // Месяц полуночей подряд: чем полнее луна в небе, тем светлее ночь.
  const nights = [];
  const day0 = Math.floor(Date.UTC(2026, 9, 1) / 86400000);
  for (let index = 0; index < 30; index += 1) {
    const mood = volumeMood({ minutes: 0, times: { riseMin: 480, setMin: 1080, dayNumber: day0 + index } });
    nights.push(mood);
  }
  const shares = nights.map((mood) => mood.tint.share);
  assert.ok(Math.max(...shares) <= VOLUME_NIGHT_SHARE + 1e-9 && Math.max(...shares) > VOLUME_NIGHT_SHARE - 0.01, "безлунной ночи нет");
  assert.ok(Math.min(...shares) < VOLUME_MOON_NIGHT_SHARE + 0.02, "в полнолуние ночь не светлеет: " + Math.min(...shares));
  assert.ok(Math.min(...shares) >= VOLUME_MOON_NIGHT_SHARE - 1e-9, "луна светлее полной");
  const fullest = nights.reduce((best, mood) => (mood.moonLight.fade > best.moonLight.fade ? mood : best));
  assert.ok(fullest.moon.lit > 0.9, "самая светлая ночь — не полнолуние: " + fullest.moon.lit);
  // Свет луны белый: под полной луной ночь тянется не к синему.
  const tint = fullest.tint.rgb;
  assert.ok(tint[2] - tint[0] < VOLUME_NIGHT_RGB[2] - VOLUME_NIGHT_RGB[0], "лунная ночь такая же синяя: " + tint.join(","));
  // Днём луна ничего не меняет.
  const noon = volumeMood({ minutes: 780, times: { riseMin: 480, setMin: 1080, dayNumber: day0 } });
  assert.equal(noon.tint.share, 0);
});

test("луна кладёт в окно пятно — слабым белым светом, тем ярче, чем полнее", () => {
  const box = stand();
  const scene = sceneOf(box);
  // Луна на севере, невысоко: свет идёт в окно северной стены на юг.
  const full = volumeMoonSpotFaces(scene.sunSpots, { az: -90, rise: 30, fade: 1 }, scene.rooms);
  const half = volumeMoonSpotFaces(scene.sunSpots, { az: -90, rise: 30, fade: 0.5 }, scene.rooms);
  const none = volumeMoonSpotFaces(scene.sunSpots, { az: -90, rise: 30, fade: 0 }, scene.rooms);
  assert.equal(none.length, 0, "новолуние кладёт пятно");
  assert.ok(full.length > 0, "полная луна не кладёт пятна в окно");
  assert.ok(full.every((face) => face.room === box.rooms.living), "пятно луны не знает своей комнаты");
  assert.ok(full[0].moon > half[0].moon, "полная луна светит не сильнее половины");
  // Пятно светлее своей грани, но слабо — и белее её.
  const base = NIGHT;
  const moon = volumeMoonTint(base, full[0].moon);
  const grey = [200, 200, 200];
  const dark = volumeTintRgb(grey, base);
  const lit = volumeTintRgb(grey, moon);
  assert.ok(lightOf("rgb(" + lit.join(",") + ")") > lightOf("rgb(" + dark.join(",") + ")"), "пятно луны не светлее пола");
  assert.ok(moon.share > 0.15, "луна светит, как лампа: " + moon.share);
  assert.ok(lit[2] - lit[0] < dark[2] - dark[0], "свет луны синий, а не белый");
  // В кадре пятно луны идёт через тон комнаты: светлее пола под ним.
  const light = volumeLiveLight(scene, null, { physical: true, tint: NIGHT });
  const camera = { at: { x: -2000, y: 1200, z: 1600 }, yaw: -Math.PI / 2, pitch: -0.5 };
  const frame = volumeFrame(scene, camera, { width: 800, height: 500 }, full, NIGHT, light);
  assert.ok(frame.length > volumeFrame(scene, camera, { width: 800, height: 500 }, null, NIGHT, light).length, "пятна луны нет в кадре");
});
