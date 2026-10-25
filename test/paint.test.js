// Покраска стен, пола и потолка (правка без автопилота, 2026-10-25). Слова
// заказчика: «Сделай функцию покраски пола стен, и потолка, при чем каждый
// отрезок стены отдельно. Пол и потолок один цвет на помещение, включая их
// проёмы». Красят полями в «Чертеже» и «Помещениях», у стены каждая сторона —
// своим цветом. Рисует краску только «Объём»; некрашеный объект собирается
// грань в грань прежним (G68).
import test from "node:test";
import assert from "node:assert/strict";

import {
  PAINT_PALETTE,
  findRoom,
  findWall,
  paintColorValue,
  roomPaintOf,
  roomPaintSides,
  roomWallsPaint,
  setRoomPaint,
  setRoomWallsPaint,
  setWallPaint,
  splitWall,
  wallPaintOf,
} from "../src/model.js";
import {
  VOLUME_CEILING_RGB,
  VOLUME_FLOOR_RGB,
  VOLUME_WALL_RGB,
  volumeFrame,
  volumeIsCeiling,
  volumeIsFloor,
  volumeIsWall,
  volumeLiveLight,
  volumePaintRgb,
  volumeScene,
  volumeSunSpotFaces,
} from "../src/volume.js";
import { benchFlat, benchLive } from "../tools/bench/scenes.mjs";

// Квартира стенда: гостиная (x < −1000), коридор, спальня (x > 1000);
// перегородки по x = ±1000 начерчены снизу вверх, их левая сторона смотрит
// в +x. В левой перегородке дверь, в нижней наружной стене — окно гостиной.
function flat() {
  const box = benchFlat();
  const { project } = box;
  const roomId = (name) => project.rooms.find((room) => room.name === name).id;
  const wallId = (test) => project.walls.find(test).id;
  return {
    ...box,
    living: roomId("Гостиная"),
    hall: roomId("Коридор"),
    bedroom: roomId("Спальня"),
    left: wallId((wall) => wall.aMm.x === -1000 && wall.bMm.x === -1000),
    right: wallId((wall) => wall.aMm.x === 1000 && wall.bMm.x === 1000),
    top: wallId((wall) => wall.aMm.y === -1800 && wall.bMm.y === -1800),
  };
}

const BLUE = "#336699";
const SAND = "#CFC1A8";
const GREEN = "#8A9268";

test("краска стороны стены: верхний регистр, повтор без шага, сброс снимает ключ и опустевший paint", () => {
  const box = flat();
  const one = setWallPaint(box.project, box.left, "left", "#aabbcc");
  assert.equal(one.changed, true);
  assert.deepEqual(findWall(one.project, box.left).paint, { left: "#AABBCC" });
  assert.equal(wallPaintOf(findWall(one.project, box.left), "left"), "#AABBCC");
  assert.equal(wallPaintOf(findWall(one.project, box.left), "right"), null);
  assert.equal(setWallPaint(one.project, box.left, "left", "#AABBCC").changed, false, "тот же цвет — пустой шаг истории");
  const two = setWallPaint(one.project, box.left, "right", BLUE).project;
  assert.deepEqual(findWall(two, box.left).paint, { left: "#AABBCC", right: BLUE });
  const back = setWallPaint(setWallPaint(two, box.left, "left", null).project, box.left, "right", "").project;
  assert.equal("paint" in findWall(back, box.left), false, "опустевшая краска осталась ключом");
  assert.deepEqual(findWall(back, box.left), findWall(box.project, box.left));
  assert.throws(() => setWallPaint(box.project, box.left, "left", "красный"), { code: "paintColorInvalid" });
  assert.throws(() => setWallPaint(box.project, box.left, "top", "#FFFFFF"), { code: "paintPartInvalid" });
  assert.equal(paintColorValue("  "), null);
  // Объект, который не красили, ключа не получает ни у одной стены и комнаты.
  assert.equal(JSON.stringify(box.project).includes('"paint"'), false);
});

test("пол и потолок — один цвет на помещение; сброс возвращает помещение байт в байт", () => {
  const box = flat();
  const floor = setRoomPaint(box.project, box.hall, "floor", SAND);
  assert.equal(floor.changed, true);
  const both = setRoomPaint(floor.project, box.hall, "ceiling", "#ffffff").project;
  assert.deepEqual(findRoom(both, box.hall).paint, { floor: SAND, ceiling: "#FFFFFF" });
  assert.equal(roomPaintOf(findRoom(both, box.hall), "ceiling"), "#FFFFFF");
  assert.equal(roomPaintOf(findRoom(both, box.living), "floor"), null);
  // Имя, цвет контура и прочее у помещения не тронуты.
  const { paint, ...rest } = findRoom(both, box.hall);
  assert.deepEqual(rest, findRoom(box.project, box.hall));
  const back = setRoomPaint(setRoomPaint(both, box.hall, "floor", null).project, box.hall, "ceiling", null).project;
  assert.deepEqual(findRoom(back, box.hall), findRoom(box.project, box.hall));
  assert.throws(() => setRoomPaint(box.project, box.hall, "wall", SAND), { code: "paintPartInvalid" });
  assert.throws(() => setRoomPaint(box.project, "нет", "floor", SAND), { code: "roomNotFound" });
});

test("деление стены отдаёт краску обоим кускам", () => {
  const box = flat();
  const painted = setWallPaint(box.project, box.top, "right", GREEN).project;
  const split = splitWall(painted, box.top, 3000);
  assert.equal(wallPaintOf(split.first, "right"), GREEN);
  assert.equal(wallPaintOf(split.second, "right"), GREEN);
  assert.equal(wallPaintOf(split.second, "left"), null);
});

test("все стены помещения разом: стороны те же, что у развёртки помещения", () => {
  const box = flat();
  const sides = roomPaintSides(box.project, box.hall);
  // Перегородки смотрят в коридор: левая — левой стороной, правая — правой.
  assert.ok(sides.some((item) => item.wallId === box.left && item.side === "left"));
  assert.ok(sides.some((item) => item.wallId === box.right && item.side === "right"));
  assert.ok(!sides.some((item) => item.wallId === box.left && item.side === "right"), "сторона гостиной досталась коридору");
  assert.deepEqual(roomWallsPaint(box.project, box.hall), { color: null, mixed: false, count: sides.length });
  const all = setRoomWallsPaint(box.project, box.hall, SAND);
  assert.equal(all.changed, true);
  assert.equal(all.count, sides.length);
  for (const { wallId, side } of sides) assert.equal(wallPaintOf(findWall(all.project, wallId), side), SAND);
  // Сторона гостиной у той же перегородки не тронута.
  assert.equal(wallPaintOf(findWall(all.project, box.left), "right"), null);
  assert.deepEqual(roomWallsPaint(all.project, box.hall), { color: SAND, mixed: false, count: sides.length });
  const mixed = setWallPaint(all.project, box.left, "left", BLUE).project;
  assert.equal(roomWallsPaint(mixed, box.hall).mixed, true);
  const cleared = setRoomWallsPaint(mixed, box.hall, null).project;
  assert.equal(JSON.stringify(cleared.walls).includes('"paint"'), false);
});

test("палитра краски — двадцать четыре кода, как сетка окна цвета", () => {
  assert.equal(PAINT_PALETTE.length, 24);
  for (const color of PAINT_PALETTE) assert.match(color, /^#[0-9A-F]{6}$/);
  assert.equal(new Set(PAINT_PALETTE).size, 24);
});

function paintedFlat() {
  const box = flat();
  let project = setRoomPaint(box.project, box.hall, "floor", SAND).project;
  project = setRoomPaint(project, box.hall, "ceiling", BLUE).project;
  project = setWallPaint(project, box.left, "left", GREEN).project;
  return { ...box, plain: box.project, project };
}

test("«Объём»: краска ложится на свою комнату и свою сторону, геометрия та же грань в грань", () => {
  const box = paintedFlat();
  const plain = volumeScene(box.plain, box.schemeId);
  const scene = volumeScene(box.project, box.schemeId);
  assert.ok(plain.faces.every((face) => !face.paint), "некрашеный объект получил краску");
  assert.equal(scene.faces.length, plain.faces.length);
  assert.deepEqual(
    scene.faces.map((face) => face.p),
    plain.faces.map((face) => face.p),
  );
  const sand = volumePaintRgb(SAND);
  const blue = volumePaintRgb(BLUE);
  const green = volumePaintRgb(GREEN);
  // Пол коридора и его половины полос под стенами — пол в проёмах.
  const floors = scene.faces.filter((face) => face.paint === "floor");
  assert.ok(floors.length >= 3, "крашены только пол и меньше двух полос под стенами: " + floors.length);
  for (const face of floors) {
    assert.equal(face.rgb, sand);
    assert.equal(face.room, box.hall, "крашеный пол не коридора");
    assert.ok(volumeIsFloor(face));
  }
  // Пол гостиной — краской сборки.
  assert.ok(scene.faces.some((face) => face.room === box.living && face.rgb === VOLUME_FLOOR_RGB && face.n.z > 0.9));
  // Потолок: снизу краска, изнанка — крыша прежнего цвета.
  const ceiling = scene.faces.find((face) => face.paint === "ceiling");
  assert.ok(ceiling, "потолок не крашен");
  assert.equal(ceiling.rgb, blue);
  assert.equal(ceiling.backRgb, VOLUME_CEILING_RGB);
  assert.ok(volumeIsCeiling(ceiling));
  // Стена: только сторона коридора левой перегородки, вместе с половинами
  // откосов двери и торцов, — и ни миллиметра со стороны гостиной.
  const walls = scene.faces.filter((face) => face.paint === "wall");
  assert.ok(walls.length > 4, "у стороны с дверью кусков мало: " + walls.length);
  for (const face of walls) {
    assert.equal(face.rgb, green);
    assert.ok(volumeIsWall(face));
    for (const point of face.p) assert.ok(point.x >= -1000 - 0.5, "краска ушла на сторону гостиной: x = " + point.x);
  }
  assert.ok(walls.some((face) => face.doorway), "откосы двери не крашены");
  assert.ok(
    scene.faces.some((face) => face.rgb === VOLUME_WALL_RGB && face.n.x < -0.9 && face.p.every((point) => Math.abs(point.x + 1100) < 1)),
    "сторона гостиной перекрашена",
  );
});

test("«Объём»: пятна ламп ложатся на крашеное, как на некрашеное", () => {
  const box = paintedFlat();
  const live = benchLive(box);
  const count = (project) => {
    const light = volumeLiveLight(volumeScene(project, box.schemeId), live, { physical: true });
    // Пятна лежат картой «грань-хозяин → кольца»: хозяев столько же.
    return light && light.decals ? light.decals.size : 0;
  };
  assert.ok(count(box.plain) > 0);
  assert.equal(count(box.project), count(box.plain), "крашеные пол, потолок и стена потеряли пятна ламп");
});

test("«Объём»: солнечное пятно светлеет из краски пола и стены, а не из бежевого сборки", () => {
  const box = flat();
  let project = setRoomPaint(box.project, box.living, "floor", BLUE).project;
  project = setWallPaint(project, box.top, "right", GREEN).project;
  // Солнце с юга чертежа (+y) светит в окно гостиной на север, к верхней
  // стене: `fade` 1 поднимает пятно ровно до цвета поверхности.
  const sun = { az: 90, rise: 30, fade: 1 };
  const plainSpots = volumeSunSpotFaces(volumeScene(box.project, box.schemeId).sunSpots, sun);
  const spots = volumeSunSpotFaces(volumeScene(project, box.schemeId).sunSpots, sun);
  assert.equal(spots.length, plainSpots.length);
  const same = (rgb, hex) => rgb.join() === volumePaintRgb(hex).join();
  assert.ok(plainSpots.some((face) => face.n.z > 0.9 && face.rgb.join() === VOLUME_FLOOR_RGB.join()), "у некрашеного пятна не цвет пола");
  assert.ok(spots.some((face) => face.n.z > 0.9 && same(face.rgb, BLUE)), "пятно на полу не из его краски");
  assert.ok(spots.some((face) => Math.abs(face.n.z) < 0.1 && same(face.rgb, GREEN)), "пятно на стене не из её краски");
});

test("«Объём»: сверху крашеный потолок не перекрашивает крышу", () => {
  const box = flat();
  const project = setRoomPaint(box.project, box.hall, "ceiling", BLUE).project;
  const box2 = { width: 640, height: 400 };
  const camera = { at: { x: 0, y: 6000, z: 9000 }, yaw: -Math.PI / 2, pitch: -0.9 };
  const fills = (item) => volumeFrame(volumeScene(item, box.schemeId), camera, box2).map((polygon) => polygon.fill);
  assert.deepEqual(fills(project), fills(box.project));
});
