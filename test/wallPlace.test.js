// Чьё место в толще стены (правка после сборки сценариев).
//
// Слова заказчика: «Стою в дверном проеме внутри квартиры, а оно считает что я
// на улице, что видно по температуре и по снегу. Дверные проемы и прочие — это
// часть квартиры. И они должны относиться к одному из смежных помещений. За
// исключением помещений без крыши, как ранее озвученный балкон… исправь их
// сразу и координально. Что бы не сталкивались больше».
import test from "node:test";
import assert from "node:assert/strict";

import {
  WALL_PLACE_PROBE_MM,
  addMark,
  addOpening,
  addOutline,
  addRoom,
  addScheme,
  addWall,
  applyRoomOutlines,
  createProject,
  outlineAtPlace,
  planMmToFraction,
  roomAtPlace,
  roomAtPoint,
  setPlanOrigin,
  setPlanScale,
  setRoomCeiling,
  setSchemeWallHeight,
  wallPlaceBands,
  wallPlaceRoom,
} from "../src/model.js";
import { volumeRoomAt, volumeRoomKeyAt, volumeScene } from "../src/volume.js";
import { volumeSimRooms, volumeWhere } from "../src/panels/volume.js";
import { simClimateOf } from "../src/simulation.js";
import { strings, text } from "../src/strings.js";

// ——— правило на голых полосах ———————————————————————————————————————————
//
// Стена по оси x = 0 толщиной 200, слева (x < 0) — комната A, справа — B;
// контуры обведены по граням (|x| ≥ 100), за стеной по y — ничего.
const BAND = wallPlaceBands([{ aMm: { x: 0, y: 0 }, bMm: { x: 0, y: 3000 }, thicknessMm: 200 }]);

function contours(left, right) {
  return (point) => {
    if (point.y < 0 || point.y > 3000) return null;
    if (point.x <= -100) return left;
    if (point.x >= 100) return right;
    return null;
  };
}
const roofed = (room) => room.roof !== false;
const A = { id: "A" };
const B = { id: "B" };
const BALCONY = { id: "balcony", roof: false };

test("толща стены — помещение своей половины; ось — одна из сторон, не улица", () => {
  const at = contours(A, B);
  assert.equal(wallPlaceRoom(BAND, { x: -40, y: 1500 }, at, roofed), A);
  assert.equal(wallPlaceRoom(BAND, { x: 40, y: 1500 }, at, roofed), B);
  assert.ok([A, B].includes(wallPlaceRoom(BAND, { x: 0, y: 1500 }, at, roofed)), "ось стены стала улицей");
});

test("проём на улицу, на лестницу и на балкон — комнатный; у балконной стены без комнат — балкон", () => {
  // Справа улица: и наружная половина стены — комната.
  assert.equal(wallPlaceRoom(BAND, { x: 60, y: 1500 }, contours(A, null), roofed), A);
  // Справа балкон без крыши: проём — комнаты, а не балкона.
  assert.equal(wallPlaceRoom(BAND, { x: 60, y: 1500 }, contours(A, BALCONY), roofed), A);
  // Парапет балкона: по другую сторону улица — балкон, под небом.
  assert.equal(wallPlaceRoom(BAND, { x: -60, y: 1500 }, contours(BALCONY, null), roofed), BALCONY);
  assert.equal(wallPlaceRoom(BAND, { x: 60, y: 1500 }, contours(BALCONY, null), roofed), BALCONY);
});

test("у грани — только своя сторона: улица у наружной стены в дом не попадает", () => {
  const at = contours(A, null);
  // На улице в пяти сантиметрах от наружной грани — улица.
  assert.equal(wallPlaceRoom(BAND, { x: 150, y: 1500 }, at, roofed), null);
  // В комнате у стены, где контур недотянут до грани, — комната.
  const short = (point) => (point.x <= -100 - WALL_PLACE_PROBE_MM / 2 && point.y >= 0 && point.y <= 3000 ? A : null);
  assert.equal(wallPlaceRoom(BAND, { x: -160, y: 1500 }, short, roofed), A);
  // Дальше щупа — не дело стены.
  assert.equal(wallPlaceRoom(BAND, { x: -100 - WALL_PLACE_PROBE_MM - 10, y: 1500 }, contours(A, B), roofed), null);
  // За торцом стены — тоже.
  assert.equal(wallPlaceRoom(BAND, { x: 0, y: -50 }, contours(A, B), roofed), null);
});

// ——— квартира: гостиная, коридор, балкон, проёмы ——————————————————————————
//
// Стены 200 мм. Перегородка по x = 0 с дверью (y −500…400) между гостиной
// (x < 0) и коридором; в северной стене (y = −1500) дверь из коридора на
// улицу (x 500…1400); в восточной (x = 2000) дверь на балкон без крыши.
function flat() {
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
    ["balcony", 2100, 3000],
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
  project = setRoomCeiling(project, rooms.balcony, false, schemeId).project;
  const door = { kind: "door", widthMm: 900, heightMm: 2100, heightAboveFloorMm: 0, hinge: "start", swing: "left" };
  project = addOpening(project, { wallId: middle, atMm: 1000, ...door }).project;
  project = addOpening(project, { wallId: ids[0], atMm: 4500, ...door }).project;
  project = addOpening(project, { wallId: ids[1], atMm: 1000, ...door }).project;
  return { project, schemeId, rooms, fr };
}

test("«Объём»: в проёме между комнатами, на улицу и на балкон человек — в квартире; шаг за порог — улица", () => {
  const { project, schemeId, rooms } = flat();
  const scene = volumeScene(project, schemeId);
  assert.equal(scene.walls.length, 5, "стены сцены не дошли до вопроса «где стоит»");
  const at = (x, y) => {
    const room = volumeRoomAt(scene, { x, y });
    return room ? room.roomId : null;
  };
  assert.equal(at(-50, 0), rooms.living, "в проёме гостиной — улица");
  assert.equal(at(50, 0), rooms.hall);
  // Дверь из коридора на улицу: обе половины проёма — коридор.
  assert.equal(at(900, -1450), rooms.hall);
  assert.equal(at(900, -1560), rooms.hall, "наружная половина проёма — улица");
  assert.equal(at(900, -1650), null, "за порогом входной двери — не улица");
  assert.equal(at(900, -3000), null);
  // Дверь на балкон: проём — коридор, сам балкон — балкон под небом.
  assert.equal(at(2060, 0), rooms.hall, "проём на балкон отдан балкону");
  assert.equal(at(2500, 0), rooms.balcony);
  // Ключ помещения для света и меток — тот же ответ.
  assert.equal(volumeRoomKeyAt(scene, { x: 900, y: -1560 }), rooms.hall);
  // Голый список контуров — щуп за гранью: толщу стены он не присваивает.
  assert.equal(volumeRoomKeyAt(scene.rooms, { x: 900, y: -1560 }), null);
  // Датчики присутствия и полоса «где я» — по тому же месту.
  assert.deepEqual(volumeSimRooms(scene, { x: 900, y: -1560 }), [rooms.hall]);
  assert.ok(
    volumeWhere(project, scene, { x: -50, y: 0 }).startsWith(text("volume.inRoom", { name: "living" })),
    "полоса «где я» в проёме говорит «вне помещений»",
  );
  assert.ok(!volumeWhere(project, scene, { x: 900, y: -1650 }).startsWith(strings.volume.inRoom.slice(0, 5)));
});

test("план: метка на стене — помещения своей стороны; щупы за гранью по-прежнему спрашивают контур", () => {
  const { project, schemeId, rooms, fr } = flat();
  // Выключатель в толще перегородки со стороны коридора.
  const placed = addMark(project, { schemeId, typeId: project.markTypes[0].id, points: [fr({ x: 60, y: 900 })] });
  const mark = placed.mark;
  assert.equal(roomAtPoint(placed.project, schemeId, mark.points[0]), null, "точка в стене вдруг в контуре — тест ничего не проверяет");
  assert.equal(roomAtPlace(placed.project, schemeId, mark.points[0]), rooms.hall);
  assert.equal(outlineAtPlace(placed.project, schemeId, fr({ x: -60, y: 900 })).roomId, rooms.living);
  const bound = applyRoomOutlines(placed.project).project;
  assert.equal(bound.marks.find((item) => item.id === mark.id).roomId, rooms.hall, "метка на стене осталась без помещения");
  // Устройство без вписанного помещения — тоже по месту: датчик в стене меряет коридор.
  const [own] = simClimateOf(placed.project, [{ markId: mark.id, kind: "sensor", services: [] }]).devices;
  assert.equal(own.roomId, rooms.hall, "датчик в стене меряет улицу");
});
