// Развёртка выделенной стены (таск 129, требование G179).
//
// Три дыры таска 128 закрыты здесь же, и проверяются они первыми: развёртка,
// которая берёт высоту не той комнаты, не показывает радиатор и теряет ленту
// вдоль стены, — это не развёртка.
//
// Главное, что проверяется дальше: **сторона решает всё**. У стены их две, на
// них разные метки, разные комнаты и, бывает, разная высота потолка; отсчёт
// вдоль стены при взгляде с другой стороны зеркалится, и вместе с ним
// переворачивается сторона открывания двери.
//
// И отдельно — что **рисование отделено от места показа**: `drawElevation`
// рисует в любой прямоугольник любого холста, и будущей выгрузке достанется
// тот же вызов.
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
  ensureSchemeObjectKinds,
  findWall,
  planMmToFraction,
  schemeObjectKindsInOrder,
  setPlanOrigin,
  setPlanScale,
  setRoomWallHeight,
  setSchemeWallHeight,
  wallElevation,
  wallHeightOnSide,
  wallObjectsOn,
  wallRoomId,
} from "../src/model.js";
import { drawElevation } from "../src/render.js";
import {
  ELEVATION_HEIGHT_PX,
  elevationHeight,
  elevationNote,
  elevationPlace,
  elevationTitle,
} from "../src/panels/elevation.js";

// План 1200 × 800 точек, сто точек на метр, нуль чертежа в середине.
function planProject() {
  const added = addScheme(createProject(), { name: "1 этаж", imageId: "plan-1", width: 1200, height: 800 });
  let project = setPlanScale(added.project, added.scheme.id, {
    a: { x: 0.1, y: 0.5 },
    b: { x: 0.6, y: 0.5 },
    meters: 6,
  }).project;
  project = setPlanOrigin(project, added.scheme.id, { at: { x: 0.5, y: 0.5 }, turn: 0 }).project;
  return { project, schemeId: added.scheme.id };
}

const fraction = (project, schemeId, mm) => planMmToFraction(project, schemeId, mm);

/**
 * Нижняя стена комнаты 4 × 3 м: идёт **справа налево**, от (2000, 1500) к
 * (−2000, 1500). Значит её левая сторона (по направлению) — наружу, вниз по
 * экрану; правая — внутрь комнаты.
 */
function wallScene() {
  const base = planProject();
  let project = addWall(base.project, {
    schemeId: base.schemeId,
    aMm: { x: 2000, y: 1500 },
    bMm: { x: -2000, y: 1500 },
    thicknessMm: 200,
  });
  const wallId = project.wall.id;
  project = setSchemeWallHeight(project.project, base.schemeId, 2700).project;
  return { project, schemeId: base.schemeId, wallId };
}

// Комната с контуром по внутренней стороне нижней стены и своей высотой.
function withRoom(scene, heightMm) {
  const room = addRoom(scene.project, "Кухня");
  let project = room.project;
  project = addOutline(project, {
    schemeId: scene.schemeId,
    roomId: room.room.id,
    points: [
      { x: -2000, y: -1500 },
      { x: 2000, y: -1500 },
      { x: 2000, y: 1400 },
      { x: -2000, y: 1400 },
    ].map((point) => fraction(project, scene.schemeId, point)),
  }).project;
  if (heightMm) project = setRoomWallHeight(project, room.room.id, heightMm).project;
  return { ...scene, project, roomId: room.room.id };
}

// ——— дыра 1: высота комнаты доходит до стены ——————————————————————————

test("у каждой стороны стены своя комната и своя высота", () => {
  const scene = withRoom(wallScene(), 3100);
  // Контур лежит сверху от стены (y < 1500), то есть на её правой стороне:
  // стена идёт справа налево, и «справа» от направления — это вверх.
  assert.equal(wallRoomId(scene.project, scene.wallId, "right"), scene.roomId);
  assert.equal(wallRoomId(scene.project, scene.wallId, "left"), null, "снаружи комнаты нет");
  assert.equal(wallHeightOnSide(scene.project, scene.wallId, "right"), 3100, "высота кухни");
  assert.equal(wallHeightOnSide(scene.project, scene.wallId, "left"), 2700, "снаружи — высота этажа");
});

test("без переопределения обе стороны берут высоту схемы", () => {
  const scene = withRoom(wallScene(), null);
  assert.equal(wallHeightOnSide(scene.project, scene.wallId, "right"), 2700);
  assert.equal(wallHeightOnSide(scene.project, scene.wallId, "left"), 2700);
});

// ——— дыра 2: объекты попадают на стену ————————————————————————————————

function withRadiator(scene) {
  const kinds = ensureSchemeObjectKinds(scene.project);
  let project = kinds.project;
  const radiator = schemeObjectKindsInOrder(project).find((kind) => kind.name === "Радиатор");
  project = addSchemeObject(project, {
    schemeId: scene.schemeId,
    kindId: radiator.id,
    shape: "rect",
    // Внутри комнаты, то есть на правой стороне стены.
    atMm: { x: 700, y: 1330 },
    widthMm: 1200,
    depthMm: 100,
    heightMm: 500,
    heightAboveFloorMm: 150,
  }).project;
  return { ...scene, project };
}

test("радиатор виден с той стороны, где стоит, и спроецирован на стену", () => {
  const scene = withRadiator(wallScene());
  const inside = wallObjectsOn(scene.project, scene.wallId, "right");
  assert.equal(inside.length, 1);
  assert.equal(inside[0].name, "Радиатор");
  // Стена идёт справа налево: середина радиатора (x = 700) это 1300 от её
  // начала, края — 700 и 1900.
  assert.deepEqual({ from: inside[0].fromMm, to: inside[0].toMm }, { from: 700, to: 1900 });
  assert.deepEqual({ floor: inside[0].floorMm, top: inside[0].topMm }, { floor: 150, top: 650 });
  assert.deepEqual(wallObjectsOn(scene.project, scene.wallId, "left"), [], "снаружи радиатора нет");
});

test("колонна внутри стены видна с обеих сторон", () => {
  const scene = wallScene();
  const kinds = ensureSchemeObjectKinds(scene.project);
  let project = kinds.project;
  const column = schemeObjectKindsInOrder(project).find((kind) => kind.name === "Колонна");
  project = addSchemeObject(project, {
    schemeId: scene.schemeId,
    kindId: column.id,
    shape: "rect",
    atMm: { x: 0, y: 1500 },
    widthMm: 400,
    depthMm: 400,
    heightMm: null,
    heightAboveFloorMm: 0,
  }).project;
  assert.equal(wallObjectsOn(project, scene.wallId, "left").length, 1);
  assert.equal(wallObjectsOn(project, scene.wallId, "right").length, 1);
});

// ——— дыра 3: лента вдоль стены на развёртке ———————————————————————————

test("лента вдоль стены приходит на развёртку отрезком", () => {
  const scene = wallScene();
  const typeId = scene.project.markTypes.find((type) => type.code === "ТР").id;
  const line = addMark(scene.project, {
    schemeId: scene.schemeId,
    typeId,
    kind: "line",
    points: [
      fraction(scene.project, scene.schemeId, { x: 1500, y: 1330 }),
      fraction(scene.project, scene.schemeId, { x: -1500, y: 1330 }),
    ],
  });
  const project = applyMarkWalls(line.project).project;
  const right = wallElevation(project, scene.wallId, "right");
  assert.equal(right.marks.length, 1);
  assert.equal(right.marks[0].kind, "line");
  assert.deepEqual({ from: right.marks[0].fromMm, to: right.marks[0].toMm }, { from: 500, to: 3500 });
});

// ——— сторона решает всё ———————————————————————————————————————————————

function fullScene() {
  const scene = withRadiator(withRoom(wallScene(), 3100));
  let project = addOpening(scene.project, {
    wallId: scene.wallId,
    kind: "window",
    atMm: 600,
    widthMm: 1400,
    heightMm: 1400,
    heightAboveFloorMm: 800,
  }).project;
  project = addOpening(project, {
    wallId: scene.wallId,
    kind: "door",
    atMm: 2600,
    widthMm: 900,
    heightMm: 2100,
    heightAboveFloorMm: 0,
    hinge: "start",
    swing: "right",
  }).project;
  // Розетка внутри комнаты и розетка снаружи — на разных сторонах.
  const socket = project.markTypes.find((type) => type.code === "Р").id;
  const inside = addMark(project, {
    schemeId: scene.schemeId,
    typeId: socket,
    points: [fraction(project, scene.schemeId, { x: 700, y: 1330 })],
  });
  project = inside.project;
  const outside = addMark(project, {
    schemeId: scene.schemeId,
    typeId: socket,
    points: [fraction(project, scene.schemeId, { x: -1000, y: 1670 })],
  });
  project = applyMarkWalls(outside.project).project;
  return { ...scene, project, insideId: inside.mark.id, outsideId: outside.mark.id };
}

test("на каждой стороне свои метки, и чужих там нет", () => {
  const scene = fullScene();
  const right = wallElevation(scene.project, scene.wallId, "right");
  const left = wallElevation(scene.project, scene.wallId, "left");
  assert.deepEqual(right.marks.map((mark) => mark.id), [scene.insideId]);
  assert.deepEqual(left.marks.map((mark) => mark.id), [scene.outsideId]);
  assert.equal(right.roomName, "Кухня");
  assert.equal(left.roomName, "", "снаружи комнаты нет");
  assert.equal(right.heightMm, 3100);
  assert.equal(left.heightMm, 2700);
});

test("отсчёт зеркалится вместе со стороной — и у проёмов, и у меток", () => {
  const scene = fullScene();
  const right = wallElevation(scene.project, scene.wallId, "right");
  const left = wallElevation(scene.project, scene.wallId, "left");
  assert.deepEqual(
    right.openings.map((opening) => [opening.kind, opening.fromMm, opening.toMm]),
    [["window", 600, 2000], ["door", 2600, 3500]],
  );
  // Длина 4000: окно 600…2000 с другой стороны это 2000…3400.
  assert.deepEqual(
    left.openings.map((opening) => [opening.kind, opening.fromMm, opening.toMm]),
    [["door", 500, 1400], ["window", 2000, 3400]],
  );
  assert.equal(right.marks[0].fromMm + left.lengthMm - right.lengthMm, right.marks[0].fromMm);
});

test("дверь с другой стороны открывается в другую сторону", () => {
  const scene = fullScene();
  const right = wallElevation(scene.project, scene.wallId, "right").openings.find((item) => item.kind === "door");
  const left = wallElevation(scene.project, scene.wallId, "left").openings.find((item) => item.kind === "door");
  assert.deepEqual({ hinge: right.hinge, swing: right.swing }, { hinge: "start", swing: "right" });
  // Петли и сторона названы от направления стены: при взгляде с обратной
  // стороны переворачиваются обе, иначе дверь на развёртке открывалась бы не
  // в тот косяк.
  assert.deepEqual({ hinge: left.hinge, swing: left.swing }, { hinge: "end", swing: "left" });
});

test("у окна стороны открывания не бывает — и выдумывать её нечем", () => {
  const scene = fullScene();
  const window = wallElevation(scene.project, scene.wallId, "left").openings.find((item) => item.kind === "window");
  assert.deepEqual({ hinge: window.hinge, swing: window.swing }, { hinge: null, swing: null });
});

test("высота не задана — развёртка не врёт числом, а говорит, откуда оно", () => {
  const bare = wallScene();
  const scene = addOpening(bare.project, {
    wallId: bare.wallId,
    kind: "door",
    atMm: 500,
    widthMm: 900,
    heightMm: 2100,
    heightAboveFloorMm: 0,
  }).project;
  const noHeight = setSchemeWallHeight(scene, bare.schemeId, "").project;
  const view = wallElevation(noHeight, bare.wallId, "left");
  assert.equal(view.heightMm, null);
  assert.equal(view.heightKnown, false);
  assert.equal(view.heightShownMm, 2400, "верх самого высокого плюс триста воздуха");
  assert.match(elevationNote(view), /Высота стен не задана/);
});

test("развёртки несуществующей стены не бывает", () => {
  const scene = wallScene();
  assert.equal(wallElevation(scene.project, "нет-такой", "left"), null);
});

// ——— полоса: где встать и что сказать ————————————————————————————————

test("полоса встаёт у дальнего от стены края", () => {
  assert.equal(elevationPlace(700, 800), "top", "стена внизу — полоса сверху");
  assert.equal(elevationPlace(100, 800), "bottom");
  assert.equal(elevationPlace(Number.NaN, 800), "bottom", "стены не видно — полоса на своём месте");
});

test("полоса не съедает поле целиком", () => {
  assert.equal(elevationHeight(1000), ELEVATION_HEIGHT_PX, "в большом поле — своя высота");
  assert.ok(elevationHeight(400) < 400 * 0.5, "в коротком поле — доля, а не полная высота");
  assert.ok(elevationHeight(10) >= 120, "и не схлопывается в ничто");
});

test("заголовок называет стену и комнату, а подпись — находки", () => {
  const scene = fullScene();
  const right = wallElevation(scene.project, scene.wallId, "right");
  assert.equal(elevationTitle(right), "Стена 4000 мм · Кухня");
  // У розетки высота не задана — об этом сказано, а не выдумано.
  assert.match(elevationNote(right), /Меток без высоты: 1/);
  const bare = wallScene();
  assert.match(elevationNote(wallElevation(bare.project, bare.wallId, "left")), /ничего нет/);
});

// ——— рисование отделено от места показа ——————————————————————————————

test("развёртка рисуется в любой прямоугольник любого холста", () => {
  const scene = fullScene();
  const view = wallElevation(scene.project, scene.wallId, "right");
  const log = [];
  const ctx = new Proxy(
    { measureText: (value) => ({ width: String(value).length * 6 }) },
    {
      get: (target, key) => (key in target ? target[key] : (...args) => log.push(String(key) + ":" + args.length)),
      set: (target, key, value) => ((target[key] = value), log.push(String(key) + "=" + String(value)), true),
    },
  );
  const first = drawElevation(ctx, view, { x: 0, y: 0, width: 600, height: 200 });
  assert.ok(log.length > 30, "развёртка ничего не нарисовала: " + log.length);
  assert.ok(first.width > 0 && first.height > 0);
  // Тот же кадр в другую рамку — другой масштаб и другое место, и ни одной
  // новой строки отрисовки: ровно это нужно будущей выгрузке.
  const second = drawElevation(ctx, view, { x: 40, y: 10, width: 1200, height: 400 });
  assert.ok(second.scale > first.scale);
  assert.ok(second.x > first.x);
});

test("G68: развёртка ничего не пишет в объект", () => {
  const scene = fullScene();
  const before = JSON.stringify(scene.project);
  wallElevation(scene.project, scene.wallId, "left");
  wallElevation(scene.project, scene.wallId, "right");
  wallObjectsOn(scene.project, scene.wallId, "left");
  assert.equal(JSON.stringify(scene.project), before);
});
