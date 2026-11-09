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
  WALL_HEIGHT_FALLBACK_MM,
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
  joinToBlock,
  planMmToFraction,
  schemeObjectKindsInOrder,
  setPlanOrigin,
  setPlanScale,
  setMarkObject,
  setMarkWall,
  setRoomWallHeight,
  setSchemeWallHeight,
  wallElevation,
  wallHeightOnSide,
  wallObjectsOn,
  wallRoomId,
} from "../src/model.js";
import {
  DRAWING_OBJECT_FILL,
  drawElevation,
  elevationLabelFit,
  elevationLabelRooms,
  elevationNameFit,
  visibleMarks,
} from "../src/render.js";
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
  assert.equal(view.heightShownMm, WALL_HEIGHT_FALLBACK_MM, "умолчание, а не выведенные 2400");
  assert.equal(WALL_HEIGHT_FALLBACK_MM, 2800, "слово заказчика (G255)");
  assert.match(elevationNote(view), /Высота стен не задана/);
  assert.match(elevationNote(view), /2800/, "в строке стоит то, во что нарисовано");
});

test("дверь выше умолчания поднимает лист, а не упирается в его потолок", () => {
  const bare = wallScene();
  // Проём ростом в умолчание: будь высота листа плоским числом, верхний косяк
  // встал бы ровно на потолок. Запасной путь поднимает лист на воздух сверху.
  const noHeight = setSchemeWallHeight(bare.project, bare.schemeId, "").project;
  const tall = addOpening(noHeight, {
    wallId: bare.wallId,
    kind: "door",
    atMm: 500,
    widthMm: 900,
    heightMm: WALL_HEIGHT_FALLBACK_MM,
    heightAboveFloorMm: 0,
  }).project;
  const view = wallElevation(tall, bare.wallId, "left");
  assert.equal(view.heightKnown, false);
  assert.equal(view.heightShownMm, WALL_HEIGHT_FALLBACK_MM + 300, "верх проёма плюс триста воздуха");
});

test("заданная высота умолчанием не перебивается — ни схемы, ни комнаты (G68)", () => {
  const bare = wallScene();
  const own = setSchemeWallHeight(bare.project, bare.schemeId, 2400).project;
  const view = wallElevation(own, bare.wallId, "left");
  assert.equal(view.heightKnown, true);
  assert.equal(view.heightShownMm, 2400, "у кого высота задана — у того ничего не меняется");
  // Даже если задана ниже того, что на стене стоит: это число человека.
  const low = setSchemeWallHeight(bare.project, bare.schemeId, 1800).project;
  assert.equal(wallElevation(low, bare.wallId, "left").heightShownMm, 1800);
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
  // Имя стены в заголовке (таск 142, G200): стена одна, и её углы — первые два
  // в обходе.
  assert.equal(elevationTitle(right), "Стена АБ · 4000 мм · Кухня");
  // У розетки своя высота не задана — она наследует умолчание типа (таск 135,
  // G192), и об этом сказано вслух: догадка сборки не выдаётся за введённое
  // число.
  assert.match(elevationNote(right), /Высот по умолчанию типа: 1/);
  assert.ok(!/Меток без высоты/.test(elevationNote(right)), "унаследованная высота — не «без высоты»");
  const bare = wallScene();
  assert.match(elevationNote(wallElevation(bare.project, bare.wallId, "left")), /ничего нет/);
});

test("D25: подпись говорит о вещах, подтянутых до различимого размера", () => {
  // Подтянута вещь или нет, зависит от масштаба развёртки, а масштаб знает
  // только отрисовка: одна и та же розетка на короткой стене нарисована почти
  // в масштабе, на длинной — крупнее. Поэтому эта часть подписи приходит от
  // отрисовки, а не считается заново по данным.
  const scene = fullScene();
  const view = wallElevation(scene.project, scene.wallId, "right");
  assert.ok(!/Увеличено/.test(elevationNote(view)), "без отрисовки сказать об этом нечего");
  assert.match(elevationNote(view, { grown: 2 }), /Увеличено до различимого размера: 2/);
  assert.ok(!/Увеличено/.test(elevationNote(view, { grown: 0 })), "всё в масштабе — и говорить не о чем");
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
// ——— подпись не шире, чем до соседа (таск 273) ————————————————————————
//
// Подпись связанного прибора — пара «ТВ1 · Телевизор» плюс высота, и на
// плотной стене она налезала на соседнюю. Правило одно и названное: подпись
// сдаёт части, пока не влезет в промежуток до ближайшего соседа, — сперва имя
// вещи, потом высоту; обозначение остаётся всегда.

test("запас подписи — до ближайшего соседа, у края стены предела нет", () => {
  assert.deepEqual(elevationLabelRooms([]), []);
  assert.deepEqual(elevationLabelRooms([120]), [Infinity], "соседа нет — предела нет");
  assert.deepEqual(elevationLabelRooms([0, 100, 250]), [100, 100, 150]);
  // Порядок ответа — порядок мест, а не отсортированный.
  assert.deepEqual(elevationLabelRooms([250, 0, 100]), [150, 100, 100]);
});

test("соседка — та, что стоит на той же строке (таск 279)", () => {
  // Место подписи — отступ и полоса высот; строка приходит доводом. Число
  // вместо места значит «строка одна на всех» — так меряется полоса под полом.
  const line = 11;
  const at = (value, top, bottom = top) => ({ at: value, top, bottom });
  assert.deepEqual(elevationLabelRooms([at(0, 0), at(100, 0), at(250, 0)], line), [100, 100, 150]);
  // Средняя подпись ушла на две строки вверх — крайние её не замечают и меряются
  // друг о друга, а сама она свободна.
  assert.deepEqual(
    elevationLabelRooms([at(0, 0), at(100, -40), at(250, 0)], line),
    [250, Infinity, 250],
    "подпись с другой строки отняла место",
  );
  // Полоса высот столбика: соседка пересекает её верх — значит она соседка.
  assert.deepEqual(elevationLabelRooms([at(0, -40, 0), at(100, -40)], line), [100, 100]);
  // Число вместо места — «строка одна на всех»: так меряется полоса под полом,
  // где подписи и правда стоят в ряд.
  assert.deepEqual(elevationLabelRooms([0, 100, 250], line), [100, 100, 150]);
});

test("подпись сдаёт имя вещи, потом высоту, а обозначение остаётся", () => {
  const parts = { label: "ТВ1 · Телевизор", name: "Телевизор", heightMm: 1200 };
  const measure = (value) => String(value).length * 6;
  // «ТВ1 · Телевизор · 1200» — 22 знака, 132 точки.
  assert.equal(elevationLabelFit(parts, 200, measure), "ТВ1 · Телевизор · 1200");
  assert.equal(elevationLabelFit(parts, 100, measure), "ТВ1 · 1200", "имя вещи уходит первым");
  assert.equal(elevationLabelFit(parts, 40, measure), "ТВ1", "высота уходит второй");
  assert.equal(elevationLabelFit(parts, 5, measure), "ТВ1", "обозначение сдавать некуда");
  // Мерки нет — сокращать нечем: подпись остаётся целой.
  assert.equal(elevationLabelFit(parts, 5, null), "ТВ1 · Телевизор · 1200");
  assert.equal(elevationLabelFit(parts, Infinity, measure), "ТВ1 · Телевизор · 1200");
  // Метка без связи: сдавать нечего, кроме высоты.
  const plain = { label: "Р1", name: "", heightMm: 300 };
  assert.equal(elevationLabelFit(plain, 100, measure), "Р1 · 300");
  assert.equal(elevationLabelFit(plain, 30, measure), "Р1");
  // Полоса под полом: высоты у метки нет вовсе.
  assert.equal(elevationLabelFit({ label: "ТВ1 · Телевизор", name: "Телевизор", heightMm: null }, 40, measure), "ТВ1");
});

/**
 * Два связанных телевизора на одной стене, в `gapMm` друг от друга. Высота у
 * прибора приходит от вещи (`markPlace`), поэтому своей ей задавать не надо.
 */
function linkedPair(gapMm) {
  const scene = wallScene();
  let project = scene.project;
  for (const x of [gapMm / 2, -gapMm / 2]) {
    const thing = addSchemeObject(project, {
      schemeId: scene.schemeId,
      catalogKey: "tv",
      shape: "rect",
      atMm: { x, y: 1380 },
      widthMm: 600,
      depthMm: 80,
      heightMm: 400,
      heightAboveFloorMm: 1200,
      turnDeg: 0,
    });
    project = thing.project;
    const typeId = project.markTypes.find((type) => type.code === "ТВ").id;
    const mark = addMark(project, {
      schemeId: scene.schemeId,
      typeId,
      kind: "point",
      points: [fraction(project, scene.schemeId, { x, y: 1380 })],
    });
    project = setMarkObject(mark.project, mark.mark.id, thing.schemeObject.id).project;
  }
  project = applyMarkWalls(project).project;
  return { ...scene, project };
}

// Подписи ловятся на `fillText`: подложка под буквами рисуется `strokeText`
// тем же текстом, и считать её второй подписью незачем.
function elevationLabels(elevation, box, options = { views: true }) {
  const texts = [];
  const ctx = new Proxy(
    { measureText: (value) => ({ width: String(value).length * 6 }) },
    {
      get: (target, key) =>
        key in target
          ? target[key]
          : (...args) => {
              if (key === "fillText") texts.push(String(args[0]));
            },
      set: () => true,
    },
  );
  const field = drawElevation(ctx, elevation, box, options);
  return { texts, field };
}

test("на плотной стене подпись прибора укладывается, а на свободной стоит целой", () => {
  const box = { x: 0, y: 0, width: 700, height: 400 };
  const roomy = linkedPair(2600);
  const far = elevationLabels(wallElevation(roomy.project, roomy.wallId, "right"), box);
  assert.ok(
    far.texts.includes("ТВ1 · Телевизор · 1400"),
    "на свободной стене подпись сократилась: " + JSON.stringify(far.texts),
  );

  // 800 мм при масштабе развёртки — около девяноста точек: пара не влезает,
  // обозначение с высотой влезает.
  const tight = linkedPair(800);
  const near = elevationLabels(wallElevation(tight.project, tight.wallId, "right"), box);
  assert.ok(near.texts.includes("ТВ1 · 1400"), "имя вещи не ушло: " + JSON.stringify(near.texts));
  assert.equal(
    near.texts.some((value) => value.includes("ТВ1 · Телевизор")),
    false,
    "подпись прибора осталась длинной: " + JSON.stringify(near.texts),
  );

  // Совсем вплотную — остаётся обозначение, и оно остаётся всегда.
  const dense = linkedPair(300);
  const packed = elevationLabels(wallElevation(dense.project, dense.wallId, "right"), box);
  assert.ok(packed.texts.includes("ТВ1"), "обозначение пропало: " + JSON.stringify(packed.texts));
  assert.ok(packed.texts.includes("ТВ2"), "обозначение соседки пропало: " + JSON.stringify(packed.texts));
  assert.equal(
    packed.texts.some((value) => value.startsWith("ТВ1 ·")),
    false,
    "на плотной стене подпись не уложилась: " + JSON.stringify(packed.texts),
  );
});

// ——— имя прибора печатается один раз (таск 276) ————————————————————————
//
// Дефект, найденный на снимке приёмки таска 273: у связанного прибора имя
// стояло на листе дважды — вещь подписывала себя сама (`elevation.objects`), а
// подпись её метки несла то же имя в паре «ТВ1 · Телевизор» (таск 255), и обе
// ложились в одно место.
//
// Правило одно: **вещь подписывает себя, если на этом листе её имени не
// напечатала подпись метки.** Связь приносит модель (`objectId` у записи
// метки), а не сличение имён и мест.

// Та же пара связанных телевизоров плюс **несвязанная** вещь между ними: её
// лист обязан называть как называл.
function linkedPairAndRadiator(gapMm, atX = 0, heightMm = 500) {
  const scene = linkedPair(gapMm);
  const kinds = ensureSchemeObjectKinds(scene.project);
  let project = kinds.project;
  const radiator = schemeObjectKindsInOrder(project).find((kind) => kind.name === "Радиатор");
  project = addSchemeObject(project, {
    schemeId: scene.schemeId,
    kindId: radiator.id,
    shape: "rect",
    // Внутри комнаты (правая сторона стены), по умолчанию **ровно посередине**
    // между телевизорами. Середина здесь нарочно: с таска 279 подпись вещи
    // стоит в той же мере тесноты, что подписи меток, и радиатор, сдвинутый к
    // одному из приборов, отбирает у него имя. Эти тесты — о таске 276 («имя
    // печатается один раз»), а мера тесноты проверяется своим тестом ниже, и
    // сдвигается радиатор ради него.
    atMm: { x: atX, y: 1380 },
    widthMm: 800,
    depthMm: 100,
    // Верх вещи — это строка её подписи: 150 + 500 = 650 мм стоит у пола,
    // далеко от подписей телевизоров (их знаки кончаются на 1600).
    heightMm,
    heightAboveFloorMm: 150,
  }).project;
  return { ...scene, project };
}

test("имя связанного прибора на листе одно, а несвязанная вещь подписана как была", () => {
  const box = { x: 0, y: 0, width: 700, height: 400 };
  const scene = linkedPairAndRadiator(2600);
  const view = wallElevation(scene.project, scene.wallId, "right");
  // В данных листа имя вещи остаётся: пропадает подпись, а не запись — по ней
  // живут список стены, таблицы и `tools/scheme.mjs walls`.
  assert.deepEqual(
    view.objects.map((item) => item.name).sort(),
    ["Радиатор", "Телевизор", "Телевизор"],
    JSON.stringify(view.objects),
  );
  // И связь у записи метки названа моделью — рисующий её не угадывает.
  assert.deepEqual(
    view.marks.map((mark) => mark.objectId),
    view.objects.filter((item) => item.name === "Телевизор").map((item) => item.id),
    JSON.stringify(view.marks.map((mark) => [mark.label, mark.objectId])),
  );

  const { texts } = elevationLabels(view, box);
  // Имя телевизора напечатано один раз на прибор — в паре.
  assert.deepEqual(
    texts.filter((value) => value.includes("Телевизор")),
    ["ТВ1 · Телевизор · 1400", "ТВ2 · Телевизор · 1400"],
    JSON.stringify(texts),
  );
  // Несвязанная вещь называет себя сама, и ровно один раз.
  assert.equal(texts.filter((value) => value === "Радиатор").length, 1, JSON.stringify(texts));
});

test("вещь, чью метку этот лист не показывает, называет себя сама", () => {
  const box = { x: 0, y: 0, width: 700, height: 400 };
  const scene = linkedPair(2600);
  // Привязку к стене у первой метки снимаем: прибор с листа ушёл, вещь на нём
  // осталась — значит имя обязано вернуться к вещи, иначе она безымянна.
  const first = scene.project.marks[0];
  const loose = setMarkWall(scene.project, first.id, null).project;
  const view = wallElevation(loose, scene.wallId, "right");
  assert.equal(view.marks.length, 1, "пример не тот: метка осталась на листе");
  const { texts } = elevationLabels(view, box);
  assert.equal(
    texts.filter((value) => value === "Телевизор").length,
    1,
    "вещь ушедшей метки осталась безымянной: " + JSON.stringify(texts),
  );
  assert.ok(texts.includes("ТВ2 · Телевизор · 1400"), JSON.stringify(texts));
});

test("на листе обратной стороны вещь внутри стены называет себя сама", () => {
  const box = { x: 0, y: 0, width: 700, height: 400 };
  const scene = wallScene();
  const kinds = ensureSchemeObjectKinds(scene.project);
  let project = kinds.project;
  const column = schemeObjectKindsInOrder(project).find((kind) => kind.name === "Колонна");
  const thing = addSchemeObject(project, {
    schemeId: scene.schemeId,
    kindId: column.id,
    shape: "rect",
    // Середина внутри самой стены (её половина — 100 мм): такая вещь видна с
    // обеих сторон. Чуть в сторону комнаты — чтобы у знака была сторона: ровно
    // на оси стены она решается ничьей (`wallTieSide`), а тест здесь не о том.
    atMm: { x: 0, y: 1450 },
    widthMm: 400,
    depthMm: 400,
    heightMm: 600,
    heightAboveFloorMm: 1000,
  });
  project = thing.project;
  const typeId = project.markTypes.find((type) => type.code === "ТВ").id;
  const mark = addMark(project, {
    schemeId: scene.schemeId,
    typeId,
    kind: "point",
    points: [fraction(project, scene.schemeId, { x: 0, y: 1450 })],
  });
  project = setMarkObject(mark.project, mark.mark.id, thing.schemeObject.id).project;
  project = applyMarkWalls(project).project;

  // Метка привязана к стене со стороны комнаты — её лист прибор и называет.
  const inside = wallElevation(project, scene.wallId, "right");
  assert.equal(inside.marks.length, 1, "метка не встала на свою сторону");
  const insideTexts = elevationLabels(inside, box).texts;
  assert.equal(
    insideTexts.filter((value) => value.includes("Колонна")).length,
    1,
    JSON.stringify(insideTexts),
  );
  // А на обратной стороне метки нет, вещь нарисована — и называет себя.
  const outside = wallElevation(project, scene.wallId, "left");
  assert.equal(outside.marks.length, 0, "метка попала на обе стороны");
  assert.equal(outside.objects.length, 1, "вещь внутри стены не видна снаружи");
  assert.ok(elevationLabels(outside, box).texts.includes("Колонна"), JSON.stringify(elevationLabels(outside, box).texts));
});

test("фильтр плана до развёртки не доходит: прибор на листе назван и со снятой галочкой", () => {
  const box = { x: 0, y: 0, width: 700, height: 400 };
  const scene = linkedPairAndRadiator(2600);
  const scheme = scene.project.schemes[0];
  const tvType = scene.project.markTypes.find((type) => type.code === "ТВ").id;
  const others = scene.project.markTypes.filter((type) => type.id !== tvType).map((type) => type.id);
  // На плане галочка типа «ТВ» снята — метки нет ни в кадре, ни под кликом.
  assert.deepEqual(visibleMarks(scene.project, scheme, { typeIds: others }), []);
  // На развёртке фильтра нет вовсе: лист стены — документ монтажнику, а не вид
  // экрана, и метки на нём стоят все. Поэтому прибор назван подписью метки, а
  // не вещью, при любой галочке.
  const view = wallElevation(scene.project, scene.wallId, "right");
  assert.equal(view.marks.length, 2);
  const { texts } = elevationLabels(view, box);
  assert.deepEqual(
    texts.filter((value) => value.includes("Телевизор")),
    ["ТВ1 · Телевизор · 1400", "ТВ2 · Телевизор · 1400"],
    JSON.stringify(texts),
  );
});

test("у блока подпись общая, и вещи его меток называют себя сами", () => {
  const box = { x: 0, y: 0, width: 700, height: 400 };
  const scene = linkedPair(2600);
  const [first, second] = scene.project.marks;
  const joined = joinToBlock(scene.project, first.id, second.id).project;
  const view = wallElevation(joined, scene.wallId, "right");
  const { texts } = elevationLabels(view, box);
  // Подпись ряда — одна на блок (`blockLabelOf`), имени пары в ней не бывает.
  assert.ok(
    texts.some((value) => value.includes("ТВ1") && !value.includes("Телевизор")),
    JSON.stringify(texts),
  );
  // Значит обе вещи блока остаются названными сами: безымянным прибор на листе
  // не бывает ни в одном случае.
  assert.equal(texts.filter((value) => value === "Телевизор").length, 2, JSON.stringify(texts));
});

test("лист бумаги называет прибор теми же словами, что экран", () => {
  const scene = linkedPairAndRadiator(2600);
  const view = wallElevation(scene.project, scene.wallId, "right");
  const screen = elevationLabels(view, { x: 0, y: 0, width: 700, height: 400 });
  // Бумага (лист ГОСТ, печать, ч/б, архив) — тот же `drawElevation` с единицей
  // бумаги: второго счёта подписей у листа нет и не заводится.
  const paper = elevationLabels(view, { x: 0, y: 0, width: 1400, height: 800 }, { views: true, unit: 2 });
  assert.deepEqual(paper.texts, screen.texts);
});

// ——— прибор нарисован один раз, и мера тесноты одна на всех (таск 279) ————
//
// Два долга со снимков приёмки таска 276. Первый: у связанного прибора на листе
// рисовались **и** прямоугольник вещи, **и** изображение её метки — в том же
// месте и тем же габаритом (телевизор внутри светлого прямоугольника). Второй:
// подписи вещей не стояли в мере «не шире, чем до соседа» (таск 273), и имя
// вещи наезжало на соседнюю подпись.
//
// Правило первого — то же, что в «Объёме» (таск 255), только лист выбирает
// другого: рисует прибор тот, у кого он **нарисован** (изображение метки), а
// уступает тот, чей рисунок — один габарит (прямоугольник вещи). Уступает
// только изображению: знак, отрезок линейной метки и полоса под полом вещь не
// изображают, и её габарит при них остаётся.

/**
 * Журнал габаритов вещей на листе: прямоугольники, залитые краской вещи
 * (`DRAWING_OBJECT_FILL`). Изображение метки заливки не знает вовсе
 * (`drawObjectView` рисует контур), поэтому один этот журнал и отвечает на
 * «сколько раз прибор нарисован».
 */
function elevationObjectRects(elevation, box, options = { views: true }) {
  const rects = [];
  const now = { fillStyle: "" };
  const ctx = new Proxy(
    { measureText: (value) => ({ width: String(value).length * 6 }) },
    {
      get: (target, key) =>
        key in target
          ? target[key]
          : (...args) => {
              if (key === "fillRect" && now.fillStyle === DRAWING_OBJECT_FILL) rects.push(args);
            },
      set: (target, key, value) => {
        now[key] = value;
        return true;
      },
    },
  );
  const field = drawElevation(ctx, elevation, box, options);
  // Ширина прямоугольника обратно в миллиметры: по ней видно, **чей** габарит
  // на листе остался (радиатор 800, телевизор 600).
  return { field, widthsMm: rects.map((rect) => Math.round(rect[2] / field.scale)) };
}

test("связанный прибор нарисован на листе один раз: изображением метки, а не внутри габарита вещи", () => {
  const box = { x: 0, y: 0, width: 700, height: 400 };
  const scene = linkedPairAndRadiator(2600);
  const view = wallElevation(scene.project, scene.wallId, "right");
  assert.equal(view.objects.length, 3, "пример не тот: вещей на листе не три");

  // С изображениями габарит остаётся только у несвязанного радиатора: два
  // телевизора нарисованы изображениями своих меток.
  const withViews = elevationObjectRects(view, box, { views: true });
  assert.deepEqual(withViews.widthsMm, [800], "габарит связанного прибора нарисован вторым разом");

  // Без изображений метка — условный знак: он вещь не изображает и масштаба не
  // обещает, поэтому габариты всех трёх вещей на листе остаются.
  const noViews = elevationObjectRects(view, box, { views: false });
  assert.deepEqual(noViews.widthsMm.sort(), [600, 600, 800], "знак отобрал у вещи габарит");
});

test("метки на листе нет — вещь рисуется, как рисовалась", () => {
  const box = { x: 0, y: 0, width: 700, height: 400 };
  const scene = linkedPair(2600);
  // Привязку к стене у первой метки снимаем: прибор с листа ушёл, вещь на нём
  // осталась — и рисует её вещь, как рисовала. У заказчика это 20 случаев из
  // 27 связанных вещей на листах.
  const loose = setMarkWall(scene.project, scene.project.marks[0].id, null).project;
  const view = wallElevation(loose, scene.wallId, "right");
  assert.equal(view.marks.length, 1, "пример не тот: метка осталась на листе");
  assert.deepEqual(elevationObjectRects(view, box).widthsMm, [600], "вещь ушедшей метки не нарисована");
});

test("знаку, отрезку и полосе под полом вещь габарит не уступает", () => {
  const box = { x: 0, y: 0, width: 700, height: 400 };
  const scene = withRoom(wallScene(), null);
  const kinds = ensureSchemeObjectKinds(scene.project);
  const kindOf = (name) => schemeObjectKindsInOrder(kinds.project).find((kind) => kind.name === name).id;
  // Вещь **без своей высоты** («во всю высоту помещения»): середины у неё нет,
  // значит нет её и у связанной метки — такая метка стоит в полосе под полом
  // знаком, а не изображением на стене.
  const tall = addSchemeObject(kinds.project, {
    schemeId: scene.schemeId,
    kindId: kindOf("Колонна"),
    shape: "rect",
    atMm: { x: 1200, y: 1300 },
    widthMm: 900,
    depthMm: 600,
    heightAboveFloorMm: 0,
  });
  let project = tall.project;
  const typeId = project.markTypes.find((type) => type.code === "ТВ").id;
  const high = addMark(project, {
    schemeId: scene.schemeId,
    typeId,
    kind: "point",
    points: [fraction(project, scene.schemeId, { x: 1200, y: 1300 })],
  });
  project = setMarkObject(high.project, high.mark.id, tall.schemeObject.id).project;

  // И вещь с линейной меткой: столешница с подсветкой — обычное дело
  // (`markPlace`), а отрезок ленты её габарита не изображает.
  const top = addSchemeObject(project, {
    schemeId: scene.schemeId,
    kindId: kindOf("Столешница"),
    shape: "rect",
    atMm: { x: -1200, y: 1300 },
    widthMm: 1600,
    depthMm: 600,
    heightMm: 40,
    heightAboveFloorMm: 850,
  });
  project = top.project;
  const tapeId = project.markTypes.find((type) => type.code === "ТР").id;
  const tape = addMark(project, {
    schemeId: scene.schemeId,
    typeId: tapeId,
    kind: "line",
    points: [
      fraction(project, scene.schemeId, { x: -400, y: 1330 }),
      fraction(project, scene.schemeId, { x: -2000, y: 1330 }),
    ],
  });
  project = setMarkObject(tape.project, tape.mark.id, top.schemeObject.id).project;
  project = applyMarkWalls(project).project;

  const view = wallElevation(project, scene.wallId, "right");
  assert.deepEqual(
    view.marks.map((mark) => mark.kind).sort(),
    ["line", "point"],
    JSON.stringify(view.marks.map((mark) => [mark.label, mark.kind, mark.heightMm])),
  );
  assert.equal(view.marks.every((mark) => mark.objectId), true, "связь у записей листа не названа");
  // Обе вещи нарисованы, хотя обе связаны: ни отрезок, ни знак в полосе под
  // полом вещь не изображают.
  assert.deepEqual(elevationObjectRects(view, box).widthsMm.sort(), [1600, 900]);
});

test("имя вещи встаёт целиком или не встаёт вовсе", () => {
  const measure = (value) => String(value).length * 6;
  assert.equal(elevationNameFit("Радиатор", 100, measure), "Радиатор");
  assert.equal(elevationNameFit("Радиатор", 40, measure), "", "имя не спряталось");
  // Сокращения у имени нет нарочно: «Радиато…» не найти ни в списке стены, ни в
  // таблице. Мерки нет — имя остаётся целым, как у подписи метки.
  assert.equal(elevationNameFit("Радиатор", 40, null), "Радиатор");
  assert.equal(elevationNameFit("Радиатор", Infinity, measure), "Радиатор");
  assert.equal(elevationNameFit("", 10, measure), "");
});

test("подпись вещи стоит в той же мере тесноты, что подписи меток", () => {
  const box = { x: 0, y: 0, width: 700, height: 400 };
  // Вещь ближе к одному телевизору, чем телевизоры друг к другу, и верх у неё
  // тот же (1600), то есть подпись встаёт **на той же строке**: до таска её
  // место меры не занимало, и «ТВ2 · Телевизор · 1400» ложилась на имя вещи.
  // Теперь имя вещи уходит у метки первым (порядок сдачи таска 273).
  const scene = linkedPairAndRadiator(2600, -200, 1450);
  const view = wallElevation(scene.project, scene.wallId, "right");
  const { texts } = elevationLabels(view, box);
  assert.ok(texts.includes("Радиатор"), JSON.stringify(texts));
  assert.ok(texts.includes("ТВ1 · Телевизор · 1400"), "далёкой соседке тесноты прибавилось");
  assert.ok(texts.includes("ТВ2 · 1400"), "подпись метки радиатора не заметила: " + JSON.stringify(texts));
});

test("подписи, разошедшиеся по высоте, друг другу не мешают", () => {
  const box = { x: 0, y: 0, width: 700, height: 400 };
  // Та же вещь на том же месте, но низкая: её верх 650, подписи телевизоров
  // стоят над 1600 — пересечься они не могут **ни при какой ширине**, и
  // отнимать друг у друга место им не за что. Иначе лист терял бы имена вещей,
  // которые ни на что не налезают: на объектах заказчика это 81 имя из 86.
  const scene = linkedPairAndRadiator(2600, -200, 500);
  const view = wallElevation(scene.project, scene.wallId, "right");
  const { texts } = elevationLabels(view, box);
  assert.ok(texts.includes("Радиатор"), JSON.stringify(texts));
  assert.ok(texts.includes("ТВ2 · Телевизор · 1400"), "подпись сдала имя соседке с другой строки: " + JSON.stringify(texts));
});

/** Три радиатора 300 мм на своих местах вдоль стены, все несвязанные. */
function threeThings(places) {
  const scene = wallScene();
  const kinds = ensureSchemeObjectKinds(scene.project);
  let project = kinds.project;
  const radiator = schemeObjectKindsInOrder(project).find((kind) => kind.name === "Радиатор");
  for (const x of places) {
    project = addSchemeObject(project, {
      schemeId: scene.schemeId,
      kindId: radiator.id,
      shape: "rect",
      atMm: { x, y: 1380 },
      widthMm: 300,
      depthMm: 100,
      heightMm: 500,
      heightAboveFloorMm: 150,
    }).project;
  }
  return { ...scene, project };
}

test("на тесной стене имя вещи прячется, а у дальней соседки остаётся", () => {
  const box = { x: 0, y: 0, width: 700, height: 400 };
  const roomy = threeThings([-1200, 0, 1200]);
  const far = elevationLabels(wallElevation(roomy.project, roomy.wallId, "right"), box);
  assert.equal(far.texts.filter((value) => value === "Радиатор").length, 3, JSON.stringify(far.texts));

  // Две вещи встали в 350 мм друг от друга — имени там не стоит, а третья
  // далеко, и её имя на месте: мера у каждой подписи своя, прячется не всё
  // разом.
  const tight = threeThings([-1700, 0, 350]);
  const view = wallElevation(tight.project, tight.wallId, "right");
  const near = elevationLabels(view, box);
  assert.equal(near.texts.filter((value) => value === "Радиатор").length, 1, JSON.stringify(near.texts));
  // Нарисованы при этом все три, и верх подписан у каждой.
  assert.equal(elevationObjectRects(view, box).widthsMm.length, 3);
  assert.equal(near.texts.filter((value) => value === "650").length, 3, JSON.stringify(near.texts));
});

test("лист бумаги рисует прибор столько же раз, сколько экран", () => {
  const scene = linkedPairAndRadiator(2600);
  const view = wallElevation(scene.project, scene.wallId, "right");
  const screen = elevationObjectRects(view, { x: 0, y: 0, width: 700, height: 400 }, { views: true });
  // Лист ГОСТ, печать, ч/б и архив — тот же `drawElevation` с единицей бумаги.
  const paper = elevationObjectRects(view, { x: 0, y: 0, width: 1400, height: 800 }, { views: true, unit: 2 });
  assert.deepEqual(paper.widthsMm, screen.widthsMm);
});
