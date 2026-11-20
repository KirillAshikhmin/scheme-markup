// Скаты — наклонный потолок мансарды (ADR 043, правка 2026-11-21). Слова
// заказчика: «делать второй вариант однозначно» (свойством помещения), ввод —
// «участок и две высоты», мансардные окна — «сразу вместе».
//
// Проверяются чистые швы: одна дверь высоты, раскладка потолка, срез стены,
// сцена со скатом и без, развёртка, посадка метки, слияние, отказы.
import test from "node:test";
import assert from "node:assert/strict";
import {
  addMark,
  addOpening,
  addOutline,
  addOutlineSlope,
  addRoom,
  addScheme,
  addSchemeObject,
  addWall,
  ceilingHeightAt,
  createProject,
  deleteOutlineSlope,
  moveSchemeObject,
  outlineSlopes,
  planMmToFraction,
  schemeHasSlopes,
  setPlanOrigin,
  setPlanScale,
  setSchemeWallHeight,
  slopeAtPoint,
  updateOutlineSlope,
  wallElevation,
  wallSideProfile,
  wallTopProfile,
} from "../src/model.js";
import { mergeProjects } from "../src/merge.js";
import {
  slopeCeilingPieces,
  slopePiecesCut,
  slopePlane,
  slopeProfile,
  slopeProfileAt,
  slopeProfileClip,
  slopeProfileMax,
  slopesHeightAt,
} from "../src/slopes.js";
import { volumeScene } from "../src/volume.js";
import { drawElevation } from "../src/render.js";

// Комната 6 × 4 м по осям стен (1000…7000 × 1000…5000), стены 200, высота 3000.
// Север — y = 1000 (стена с окном), юг — y = 5000.
function attic() {
  let project = createProject();
  const added = addScheme(project, { name: "Мансарда", imageId: "i", width: 1000, height: 1000 });
  project = added.project;
  const schemeId = added.scheme.id;
  project = setPlanScale(project, schemeId, { a: { x: 0, y: 0 }, b: { x: 1, y: 0 }, meters: 10 }).project;
  project = setPlanOrigin(project, schemeId, { at: { x: 0, y: 0 }, turn: 0 }).project;
  project = setSchemeWallHeight(project, schemeId, 3000).project;
  const wall = (a, b) => {
    const made = addWall(project, { schemeId, aMm: a, bMm: b, thicknessMm: 200 });
    project = made.project;
    return made.wall.id;
  };
  const north = wall({ x: 1000, y: 1000 }, { x: 7000, y: 1000 });
  const east = wall({ x: 7000, y: 1000 }, { x: 7000, y: 5000 });
  const south = wall({ x: 7000, y: 5000 }, { x: 1000, y: 5000 });
  const west = wall({ x: 1000, y: 5000 }, { x: 1000, y: 1000 });
  const room = addRoom(project, { name: "Кабинет" });
  project = room.project;
  const outline = addOutline(project, {
    schemeId,
    roomId: room.room.id,
    points: [{ x: 0.11, y: 0.11 }, { x: 0.69, y: 0.11 }, { x: 0.69, y: 0.49 }, { x: 0.11, y: 0.49 }],
  });
  project = outline.project;
  return { project, schemeId, outlineId: outline.outline.id, walls: { north, east, south, west } };
}

// Один скат на всю комнату: 1000 у южной стены, 3000 у северной.
const WHOLE = {
  pointsMm: [{ x: 1100, y: 1100 }, { x: 6900, y: 1100 }, { x: 6900, y: 4900 }, { x: 1100, y: 4900 }],
  edge: 2,
  lowMm: 1000,
  highMm: 3000,
};

const near = (actual, expected, message, eps = 1) => assert.ok(Math.abs(actual - expected) <= eps, message + ": " + actual + " вместо " + expected);

// ——— чистая геометрия ——————————————————————————————————————————————————————

test("плоскость ската линейна от кромки отсчёта до самой дальней вершины", () => {
  const plane = slopePlane(WHOLE);
  const at = (x, y) => plane.ax * x + plane.ay * y + plane.c;
  near(at(3000, 4900), 1000, "у кромки");
  near(at(3000, 1100), 3000, "в дальней вершине");
  near(at(5000, 3000), 2000, "посередине");
  assert.equal(slopePlane({ ...WHOLE, edge: 7 }), null, "кромки с таким номером нет");
  assert.equal(slopePlane({ pointsMm: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }], edge: 0, lowMm: 1, highMm: 2 }), null, "вершины на одной прямой");
});

test("одна дверь высоты: под скатом — плоскость, под двумя — наименьшая, вне — плоский потолок", () => {
  near(slopesHeightAt([WHOLE], { x: 3000, y: 3000 }, 2700), 2000, "под скатом");
  assert.equal(slopesHeightAt([WHOLE], { x: 9000, y: 3000 }, 2700), 2700, "вне ската — высота помещения");
  assert.equal(slopesHeightAt([], { x: 3000, y: 3000 }, 2700), 2700, "скатов нет");
  // Второй скат ниже первого на своей половине: побеждает меньшая высота.
  const low = { pointsMm: [{ x: 1100, y: 1100 }, { x: 4000, y: 1100 }, { x: 4000, y: 4900 }, { x: 1100, y: 4900 }], edge: 3, lowMm: 500, highMm: 1500 };
  near(slopesHeightAt([WHOLE, low], { x: 1100, y: 2000 }, 2700), 500, "под двумя — наименьшая");
  near(slopesHeightAt([WHOLE, low], { x: 6000, y: 3000 }, 2700), 2000, "под одним — он");
  // Скат выше помещения потолок не срезает до плоского: под скатом говорит скат.
  near(slopesHeightAt([{ ...WHOLE, highMm: 3400 }], { x: 3000, y: 1100 }, 3000), 3400, "скат выше помещения");
  // Высота у кромки может быть и больше дальней — тогда скат от кромки падает.
  near(slopesHeightAt([{ ...WHOLE, lowMm: 3000, highMm: 1000 }], { x: 3000, y: 1100 }, 2700), 1000, "обратный скат");
});

test("потолок кусками: без скатов — сам контур, со скатом — наклонные куски и плоский остаток той же площади", () => {
  const room = [{ x: 0, y: 0 }, { x: 6000, y: 0 }, { x: 6000, y: 4000 }, { x: 0, y: 4000 }];
  const flat = slopeCeilingPieces(room, [], 2700);
  assert.equal(flat.length, 1);
  assert.deepEqual(flat[0].points.map((point) => point.z), [2700, 2700, 2700, 2700]);
  const half = { pointsMm: [{ x: 0, y: 0 }, { x: 3000, y: 0 }, { x: 3000, y: 4000 }, { x: 0, y: 4000 }], edge: 3, lowMm: 1000, highMm: 2700 };
  const pieces = slopeCeilingPieces(room, [half], 2700);
  const area = (points) => {
    let sum = 0;
    for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) sum += points[j].x * points[i].y - points[i].x * points[j].y;
    return Math.abs(sum) / 2;
  };
  near(pieces.reduce((sum, piece) => sum + area(piece.points), 0), 24e6, "куски закрывают весь контур", 10);
  const sloped = pieces.filter((piece) => piece.slope === 0);
  const level = pieces.filter((piece) => piece.slope === -1);
  near(sloped.reduce((sum, piece) => sum + area(piece.points), 0), 12e6, "под скатом — его участок", 10);
  assert.ok(level.every((piece) => piece.points.every((point) => point.z === 2700)), "плоская часть на высоте помещения");
  for (const piece of sloped) for (const point of piece.points) near(point.z, 1000 + (1700 * point.x) / 3000, "высота куска по плоскости");
  // Невыпуклое помещение (Г-образное) режется на выпуклые куски без потерь.
  const corner = [{ x: 0, y: 0 }, { x: 6000, y: 0 }, { x: 6000, y: 2000 }, { x: 3000, y: 2000 }, { x: 3000, y: 4000 }, { x: 0, y: 4000 }];
  const bent = slopeCeilingPieces(corner, [{ pointsMm: corner, edge: 0, lowMm: 1000, highMm: 3000 }], 2700);
  near(bent.reduce((sum, piece) => sum + area(piece.points), 0), 18e6, "Г-образный потолок целиком", 10);
  assert.ok(bent.every((piece) => piece.slope === 0));
  // Отверстие мансардного окна: вырезанное и остаток вместе — прежняя площадь.
  const hole = [{ x: 1000, y: 1000 }, { x: 1800, y: 1000 }, { x: 1800, y: 2400 }, { x: 1000, y: 2400 }];
  const cut = slopePiecesCut(sloped, hole);
  near(cut.cut.reduce((sum, piece) => sum + area(piece.points), 0), 800 * 1400, "вырезано ровно окно", 10);
  near(cut.pieces.reduce((sum, piece) => sum + area(piece.points), 0), 12e6 - 800 * 1400, "остаток", 10);
  for (const piece of cut.cut) for (const point of piece.points) near(point.z, 1000 + (1700 * point.x) / 3000, "окно лежит в плоскости ската");
});

test("профиль потолка вдоль стены: трапеция у боковой, ровно у нижней, ломаная под коньком", () => {
  // Боковая стена вдоль уклона: от северной (3000) к южной (1000).
  const side = slopeProfile([WHOLE], { x: 6900, y: 1100 }, { x: 6900, y: 4900 }, 2700);
  assert.equal(side.length, 1);
  near(side[0].fromZ, 3000, "у высокой стены");
  near(side[0].toZ, 1000, "у низкой стены");
  near(slopeProfileAt(side, 1900), 2000, "посередине");
  // Конёк: два ската навстречу — у торцевой стены треугольник.
  const left = { pointsMm: [{ x: 0, y: 0 }, { x: 3000, y: 0 }, { x: 3000, y: 4000 }, { x: 0, y: 4000 }], edge: 3, lowMm: 1000, highMm: 3400 };
  const right = { pointsMm: [{ x: 3000, y: 0 }, { x: 6000, y: 0 }, { x: 6000, y: 4000 }, { x: 3000, y: 4000 }], edge: 1, lowMm: 1000, highMm: 3400 };
  const gable = slopeProfile([left, right], { x: 0, y: 0 }, { x: 6000, y: 0 }, 2700);
  assert.deepEqual(gable.map((part) => [Math.round(part.fromMm), Math.round(part.toMm), Math.round(part.fromZ), Math.round(part.toZ)]), [
    [0, 3000, 1000, 3400],
    [3000, 6000, 3400, 1000],
  ]);
  // Вне скатов — плоская высота; запас за краем участка дотягивает скат до стены.
  const beside = slopeProfile([left], { x: 0, y: -100 }, { x: 6000, y: -100 }, 2700);
  near(slopeProfileAt(beside, 1500), 2200, "скат дотянулся до грани стены за своим краем");
  near(slopeProfileAt(beside, 5000), 2700, "дальше — плоский потолок");
  // Больший из двух профилей — верх стены между двумя помещениями.
  const top = slopeProfileMax(gable, [{ fromMm: 0, toMm: 6000, fromZ: 2200, toZ: 2200 }]);
  near(slopeProfileAt(top, 0), 2200, "у края выше ровная сторона");
  near(slopeProfileAt(top, 3000), 3400, "под коньком выше скат");
  // Обрезка многоугольника стены профилем: окно выше среза становится трапецией.
  const window = [
    { alongMm: 1000, zMm: 800 },
    { alongMm: 2000, zMm: 800 },
    { alongMm: 2000, zMm: 3000 },
    { alongMm: 1000, zMm: 3000 },
  ];
  const clipped = slopeProfileClip(gable, window);
  assert.equal(clipped.length, 1);
  const zs = clipped[0].map((point) => Math.round(point.zMm));
  assert.equal(Math.max(...zs), 2600, "верх окна лёг на скат в его высокой точке");
  assert.ok(zs.includes(1800), "и в низкой");
  const under = [
    { alongMm: 2800, zMm: 0 },
    { alongMm: 3200, zMm: 0 },
    { alongMm: 3200, zMm: 2000 },
    { alongMm: 2800, zMm: 2000 },
  ];
  assert.equal(slopeProfileClip(gable, under)[0], under, "что целиком под срезом — тем же многоугольником по ссылке");
});

// ——— модель —————————————————————————————————————————————————————————————————

test("скат лежит у контура помещения: добавить, поправить, снять — и ключ уходит с последним", () => {
  const base = attic();
  assert.equal(schemeHasSlopes(base.project, base.schemeId), false);
  assert.deepEqual(outlineSlopes(base.project.outlines[0]), []);
  const added = addOutlineSlope(base.project, base.outlineId, WHOLE);
  assert.equal(added.index, 0);
  assert.deepEqual(added.outline.slopes, [WHOLE]);
  assert.notEqual(added.project, base.project, "объект не меняется на месте");
  assert.equal(Object.prototype.hasOwnProperty.call(base.project.outlines[0], "slopes"), false);
  assert.equal(schemeHasSlopes(added.project, base.schemeId), true);
  const same = updateOutlineSlope(added.project, base.outlineId, 0, { lowMm: 1000 });
  assert.equal(same.changed, false);
  assert.equal(same.project, added.project);
  const raised = updateOutlineSlope(added.project, base.outlineId, 0, { lowMm: "1200", edge: 0 });
  assert.equal(raised.changed, true);
  assert.deepEqual([raised.slope.lowMm, raised.slope.edge], [1200, 0]);
  const removed = deleteOutlineSlope(raised.project, base.outlineId, 0);
  assert.equal(Object.prototype.hasOwnProperty.call(removed.outline, "slopes"), false, "последний снятый скат удаляет ключ");
  assert.deepEqual(removed.project.outlines, base.project.outlines, "объект вернулся к прежнему поле в поле (G68)");
});

test("плохой вход отвергается словами, а не молча", () => {
  const base = attic();
  const code = (run) => {
    try {
      run();
    } catch (error) {
      return error.code;
    }
    return null;
  };
  const add = (slope) => () => addOutlineSlope(base.project, base.outlineId, slope);
  assert.equal(code(add({ ...WHOLE, pointsMm: WHOLE.pointsMm.slice(0, 2) })), "slopeShort");
  assert.equal(code(add({ ...WHOLE, edge: 4 })), "slopeEdgeUnknown");
  assert.equal(code(add({ ...WHOLE, edge: 1.5 })), "slopeEdgeUnknown");
  assert.equal(code(add({ ...WHOLE, lowMm: -5 })), "drawingMmNegative");
  assert.equal(code(add({ ...WHOLE, highMm: "высоко" })), "drawingMmInvalid");
  assert.equal(code(add({ ...WHOLE, highMm: 100001 })), "drawingHeightTooBig");
  assert.equal(code(add({ ...WHOLE, pointsMm: [{ x: 0, y: 0 }, { x: 5000, y: 0 }, { x: 9000, y: 0 }] })), "slopeDegenerate");
  assert.equal(code(add({ ...WHOLE, pointsMm: [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 50 }] })), "slopeDegenerate");
  assert.equal(code(() => addOutlineSlope(base.project, "нет", WHOLE)), "outlineNotFound");
  assert.equal(code(() => updateOutlineSlope(base.project, base.outlineId, 0, { lowMm: 1 })), "slopeNotFound");
  assert.equal(code(() => deleteOutlineSlope(base.project, base.outlineId, 3)), "slopeNotFound");
});

test("высота потолка в точке чертежа и скат над точкой — у модели", () => {
  const base = attic();
  assert.equal(ceilingHeightAt(base.project, base.schemeId, { x: 3000, y: 3000 }), 3000, "без скатов — высота помещения");
  assert.equal(slopeAtPoint(base.project, base.schemeId, { x: 3000, y: 3000 }), null);
  const project = addOutlineSlope(base.project, base.outlineId, WHOLE).project;
  near(ceilingHeightAt(project, base.schemeId, { x: 3000, y: 3000 }), 2000, "под скатом");
  assert.equal(ceilingHeightAt(project, base.schemeId, { x: 9000, y: 9000 }), 3000, "вне помещений — высота схемы");
  const found = slopeAtPoint(project, base.schemeId, { x: 3000, y: 3000 });
  assert.equal(found.index, 0);
  assert.equal(found.outline.id, base.outlineId);
});

test("срез стены: наружная стена под скатом опускается с ним, боковая — трапеция, без скатов профиля нет", () => {
  const base = attic();
  for (const id of Object.values(base.walls)) assert.equal(wallTopProfile(base.project, id), null, "без скатов стена ровная");
  const project = addOutlineSlope(base.project, base.outlineId, WHOLE).project;
  const shape = (id) => wallTopProfile(project, id).map((part) => [Math.round(part.fromMm), Math.round(part.toMm), Math.round(part.fromZ), Math.round(part.toZ)]);
  assert.deepEqual(shape(base.walls.south), [[0, 6000, 1000, 1000]], "низкая стена — ровно по низу ската");
  assert.deepEqual(shape(base.walls.north), [[0, 6000, 3000, 3000]], "высокая — по его верху");
  const east = shape(base.walls.east);
  assert.equal(east.length, 1);
  // Плоскость продолжается за участок до осей стен: 100 мм — это 53 мм высоты.
  near(east[0][2], 3053, "торец у высокой стены", 2);
  near(east[0][3], 947, "торец у низкой стены", 2);
  // Сторона стены — та, что видна из комнаты; снаружи помещения нет.
  assert.ok(wallSideProfile(project, base.walls.east, "left") || wallSideProfile(project, base.walls.east, "right"));
  assert.equal(
    [wallSideProfile(project, base.walls.east, "left"), wallSideProfile(project, base.walls.east, "right")].filter(Boolean).length,
    1,
    "скат говорит только со стороны комнаты",
  );
});

// ——— «Объём» ————————————————————————————————————————————————————————————————

const isCeiling = (face) => face.n && face.n.z < -0.5 && face.room && face.p.every((point) => point.z > 500);

test("G68: сцена объекта без скатов прежняя грань в грань, и снятый скат возвращает её", () => {
  const base = attic();
  const before = volumeScene(base.project, base.schemeId, {});
  const sloped = addOutlineSlope(base.project, base.outlineId, WHOLE).project;
  const back = deleteOutlineSlope(sloped, base.outlineId, 0).project;
  const after = volumeScene(back, base.schemeId, {});
  assert.deepEqual(
    after.faces.map((face) => [face.p, face.n, face.rgb, face.room, face.both]),
    before.faces.map((face) => [face.p, face.n, face.rgb, face.room, face.both]),
  );
  assert.equal(Object.prototype.hasOwnProperty.call(before.rooms[0], "slopes"), false, "у помещения без скатов нет и ключа");
});

test("сцена со скатом: потолок наклонный и двусторонний, стены срезаны, «Снять крышу» снимает и скат", () => {
  const base = attic();
  const project = addOutlineSlope(base.project, base.outlineId, WHOLE).project;
  const scene = volumeScene(project, base.schemeId, {});
  const ceiling = scene.faces.filter(isCeiling);
  assert.ok(ceiling.length >= 1, "потолка нет");
  for (const face of ceiling) {
    assert.ok(face.both, "изнанка ската — крыша");
    assert.ok(Math.abs(face.n.y) > 0.1, "грань потолка не наклонена");
    for (const point of face.p) near(point.z, 1000 + ((4900 - point.y) * 2000) / 3800, "потолок лежит в плоскости ската");
  }
  // Ни одна грань стены не выше ската над своим местом (с запасом на толщину).
  const tallest = Math.max(...scene.faces.filter((face) => !face.line && face.n && Math.abs(face.n.z) < 0.5).flatMap((face) => face.p.map((point) => point.z)));
  assert.ok(tallest <= 3060, "стена торчит над скатом: " + tallest);
  const southTop = Math.max(
    ...scene.faces
      .filter((face) => face.n && Math.abs(face.n.y) > 0.9 && face.p.every((point) => Math.abs(point.y - 5000) <= 101))
      .flatMap((face) => face.p.map((point) => point.z)),
  );
  near(southTop, 1000, "низкая стена — по низу ската", 60);
  const open = volumeScene(project, base.schemeId, { roofOff: true });
  assert.ok(open.faces.filter(isCeiling).every((face) => !face.both), "со снятой крышей у ската одна сторона");
});

test("проём выше среза обрезается по скату, а не пропадает", () => {
  const base = attic();
  // Окно во всю высоту в боковой (восточной) стене: 1000…2000 вдоль, 500…2900.
  let project = addOpening(base.project, { wallId: base.walls.east, kind: "window", atMm: 1500, widthMm: 1000, heightMm: 2400, heightAboveFloorMm: 500 }).project;
  const flat = volumeScene(project, base.schemeId, {});
  project = addOutlineSlope(project, base.outlineId, WHOLE).project;
  const scene = volumeScene(project, base.schemeId, {});
  const profile = wallTopProfile(project, base.walls.east);
  const inWall = (face) => face.p.every((point) => Math.abs(point.x - 7000) <= 101 && point.y > 2400 && point.y < 3600);
  const frame = scene.faces.filter((face) => !face.line && inWall(face));
  assert.ok(frame.length > 0, "рама окна пропала");
  for (const face of frame) for (const point of face.p) assert.ok(point.z <= slopeProfileAt(profile, point.y - 1000) + 1, "грань проёма выше среза");
  const top = Math.max(...frame.flatMap((face) => face.p.map((point) => point.z)));
  assert.ok(top > 1800 && top < 2900, "окно не обрезано по скату: верх " + top);
  assert.ok(Math.max(...flat.faces.filter((face) => !face.line && inWall(face)).flatMap((face) => face.p.map((point) => point.z))) >= 2899, "без ската окно целое");
});

test("потолочная метка под скатом садится на его плоскость, без ската — под потолок помещения", () => {
  const base = attic();
  const type = base.project.markTypes.find((item) => item.code === "Т");
  assert.ok(type, "в шаблоне нет точечного светильника");
  const at = { x: 3000, y: 4000 };
  const put = addMark(base.project, { schemeId: base.schemeId, typeId: type.id, points: [planMmToFraction(base.project, base.schemeId, at)] });
  const topOf = (project) => {
    const place = volumeScene(project, base.schemeId, {}).marks.find((item) => item.markId === put.marks[0].id);
    return Math.max(...place.prisms.map((prism) => prism.topMm));
  };
  near(topOf(put.project), 3000, "без ската — под потолком помещения", 5);
  const sloped = addOutlineSlope(put.project, base.outlineId, WHOLE).project;
  const top = topOf(sloped);
  const ceiling = ceilingHeightAt(sloped, base.schemeId, at);
  assert.ok(top <= ceiling && top > ceiling - 120, "метка не на скате: верх " + top + " при потолке " + ceiling);
});

test("мансардное окно: в скате — отверстие со стеклом в его плоскости, без ската — отказ словами", () => {
  const base = attic();
  const window = { schemeId: base.schemeId, catalogKey: "skylight", shape: "rect", atMm: { x: 3000, y: 3000 }, widthMm: 780, depthMm: 1400, heightMm: 60, heightAboveFloorMm: 0 };
  assert.throws(() => addSchemeObject(base.project, window), (error) => error.code === "skylightNoSlope");
  const half = { ...WHOLE, pointsMm: [{ x: 1100, y: 1100 }, { x: 4000, y: 1100 }, { x: 4000, y: 4900 }, { x: 1100, y: 4900 }] };
  const project = addOutlineSlope(base.project, base.outlineId, half).project;
  const put = addSchemeObject(project, window);
  // Сдвиг под плоский потолок отвергается, сдвиг по скату — проходит.
  assert.throws(() => moveSchemeObject(put.project, put.schemeObject.id, { x: 2500, y: 0 }), (error) => error.code === "skylightNoSlope");
  assert.equal(moveSchemeObject(put.project, put.schemeObject.id, { x: -500, y: 0 }).schemeObject.atMm.x, 2500);
  const bare = volumeScene(project, base.schemeId, {});
  const scene = volumeScene(put.project, base.schemeId, {});
  const glass = scene.faces.filter((face) => face.thing === put.schemeObject.id && face.clear);
  assert.ok(glass.length > 0, "стекла нет");
  for (const face of glass) {
    assert.ok(face.both && face.alpha < 1, "стекло прозрачное и двустороннее");
    for (const point of face.p) near(point.z, ceilingHeightAt(put.project, base.schemeId, point), "стекло не в плоскости ската");
  }
  const area = (faces) =>
    faces.reduce((sum, face) => {
      let part = 0;
      for (let i = 0, j = face.p.length - 1; i < face.p.length; j = i, i += 1) part += face.p[j].x * face.p[i].y - face.p[i].x * face.p[j].y;
      return sum + Math.abs(part) / 2;
    }, 0);
  near(area(bare.faces.filter(isCeiling)) - area(scene.faces.filter((face) => isCeiling(face) && !face.thing)), 780 * 1400, "в потолке нет отверстия под окно", 20);
  // Телом окно не ставится: ни препятствия, ни тени от ламп.
  assert.equal(scene.occluders.length, bare.occluders.length);
  assert.equal(scene.objectBoxes.length, bare.objectBoxes.length);
});

test("у каждой грани сцены свои точки: стопка этажей двигает их на месте", () => {
  // Найдено на объекте заказчика: вершина конуса (крона цветка) была общей на
  // все его бока, перенос этажа сдвигал её по разу на грань, и «Все этажи»
  // зацикливали дерево порядка. Скаты режут грани на куски — те же грабли.
  const base = attic();
  let project = addOutlineSlope(base.project, base.outlineId, WHOLE).project;
  project = addOpening(project, { wallId: base.walls.east, kind: "window", atMm: 1500, widthMm: 1000, heightMm: 2400, heightAboveFloorMm: 500 }).project;
  for (const key of ["plant", "treePot"]) {
    project = addSchemeObject(project, { schemeId: base.schemeId, catalogKey: key, shape: "rect", atMm: { x: 3000, y: 2000 }, widthMm: 500, depthMm: 500, heightMm: 1500, heightAboveFloorMm: 0 }).project;
  }
  project = addSchemeObject(project, { schemeId: base.schemeId, catalogKey: "skylight", shape: "rect", atMm: { x: 5000, y: 3000 }, widthMm: 780, depthMm: 1400, heightMm: 60, heightAboveFloorMm: 0 }).project;
  const scene = volumeScene(project, base.schemeId, {});
  const seen = new Map();
  for (const face of scene.faces) {
    for (const point of face.p || []) {
      const owner = seen.get(point);
      assert.ok(!owner || owner === face, "точка общая у двух граней: " + JSON.stringify(point) + " (вещь " + face.thing + ")");
      seen.set(point, face);
    }
  }
});

// ——— развёртка ——————————————————————————————————————————————————————————————

test("развёртка: верх стороны под скатом — ломаная, лист ровной стены прежний", () => {
  const base = attic();
  const side = wallSideProfile(addOutlineSlope(base.project, base.outlineId, WHOLE).project, base.walls.east, "left") ? "left" : "right";
  const flat = wallElevation(base.project, base.walls.east, side);
  assert.equal(Object.prototype.hasOwnProperty.call(flat, "topProfile"), false, "у ровной стены ключа нет (G68)");
  const project = addOutlineSlope(base.project, base.outlineId, WHOLE).project;
  const sheet = wallElevation(project, base.walls.east, side);
  assert.ok(Array.isArray(sheet.topProfile) && sheet.topProfile.length === 1);
  const part = sheet.topProfile[0];
  assert.deepEqual([part.fromMm, part.toMm], [0, 4000]);
  assert.deepEqual([part.fromZ, part.toZ].sort((a, b) => a - b).map((z) => Math.round(z / 100)), [9, 31], "трапеция от низа до верха ската");
  assert.ok(sheet.heightShownMm >= 3000);
  // Кадр: ровная стена не получает ни одного нового вызова, скат рисуется ломаной и обрезкой.
  const calls = (elevation) => {
    const log = [];
    const ctx = new Proxy({}, { get: (target, key) => (key === "measureText" ? undefined : (...args) => log.push(String(key))), set: () => true });
    drawElevation(ctx, elevation, { x: 0, y: 0, width: 800, height: 400 });
    return log;
  };
  const plain = calls(flat);
  assert.ok(!plain.includes("clip"), "ровная стена обрезку не зовёт");
  assert.ok(plain.includes("strokeRect"));
  const drawn = calls(sheet);
  assert.ok(drawn.includes("lineTo") && drawn.includes("fill"), "скат не нарисован ломаной");
  // Мансардное окно на развёртку стены не попадает: оно в скате.
  const window = addSchemeObject(project, { schemeId: base.schemeId, catalogKey: "skylight", shape: "rect", atMm: { x: 6500, y: 3000 }, widthMm: 780, depthMm: 1400, heightMm: 60, heightAboveFloorMm: 0 });
  assert.equal(wallElevation(window.project, base.walls.east, side).objects.length, sheet.objects.length);
});

// ——— слияние ————————————————————————————————————————————————————————————————

test("слияние: скат, начерченный одним участником, приезжает ко второму; без скатов ключ не заводится", () => {
  const base = attic();
  const mine = addOutlineSlope(base.project, base.outlineId, WHOLE).project;
  const stamp = (project, at) => ({ ...project, updatedAt: at });
  const merged = mergeProjects(stamp(base.project, "2026-01-01"), stamp(mine, "2026-01-02"), stamp(base.project, "2026-01-01")).project;
  assert.deepEqual(merged.outlines[0].slopes, [WHOLE]);
  const other = mergeProjects(stamp(mine, "2026-01-02"), stamp(base.project, "2026-01-01"), stamp(base.project, "2026-01-01")).project;
  assert.deepEqual(other.outlines[0].slopes, [WHOLE]);
  const none = mergeProjects(base.project, base.project, base.project).project;
  assert.equal(Object.prototype.hasOwnProperty.call(none.outlines[0], "slopes"), false);
});
