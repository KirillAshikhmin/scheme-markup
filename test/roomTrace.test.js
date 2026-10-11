// Помещение по чертежу (таск 138). Проверять тут надо не «что-то нашлось», а
// **числа**: контур обязан лечь по внутренней грани стены миллиметр в
// миллиметр, а не «примерно по комнате». Поэтому почти каждый тест сравнивает
// вершины с посчитанными в уме координатами, а не только площадь.
//
// Отказы проверяются так же пристально, как успехи: заливка отвечает всегда, и
// шесть её отказов — это шесть разных советов человеку.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ROOM_TRACE_AREA_MAX_MM2,
  ROOM_TRACE_CELL_MM,
  ringAreaMm2,
  roomTraceAt,
  roomTraceLines,
  roomTraceReady,
  roomTraceRegion,
} from "../src/roomTrace.js";
import {
  addOutline,
  addRoom,
  addScheme,
  addWall,
  addOpening,
  createProject,
  outlineArea,
  planFractionToMm,
  setPlanOrigin,
  setPlanScale,
  setSchemeWallHeight,
} from "../src/model.js";
import { strings } from "../src/strings.js";
import {
  CANVAS_MODE_NOTES,
  CANVAS_MODE_ROOM_TRACE,
  canvasGrabKind,
  canvasHintText,
  canvasRoomTraceSaid,
  canvasTapKind,
} from "../src/canvas.js";

// ——— оснастка —————————————————————————————————————————————————————————

// Цепочка стен по кольцу: концы совпадают точно, как их заводит росчерк
// (ADR 008). Толщина у всех одна.
function wallRing(points, thicknessMm) {
  const walls = [];
  for (let index = 0; index < points.length; index += 1) {
    walls.push({ aMm: points[index], bMm: points[(index + 1) % points.length], thicknessMm });
  }
  return walls;
}

const corners = (x0, y0, x1, y1) => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];

// Вершины по кругу сравниваются без оглядки на то, с какой начался обход и в
// какую сторону он пошёл: ни то ни другое ответом не является.
function sameRing(found, wanted) {
  if (found.length !== wanted.length) return false;
  const key = (list) => list.map((point) => point.x + ":" + point.y).join(" ");
  for (const order of [wanted, [...wanted].reverse()]) {
    for (let shift = 0; shift < order.length; shift += 1) {
      if (key([...order.slice(shift), ...order.slice(0, shift)]) === key(found)) return true;
    }
  }
  return false;
}

function ringIs(found, wanted, note) {
  assert.ok(
    sameRing(found, wanted),
    (note || "контур не тот") + ": ждали " + JSON.stringify(wanted) + ", получили " + JSON.stringify(found),
  );
}

// ——— простая комната ——————————————————————————————————————————————————

test("комната из четырёх стен обводится по внутренней грани, миллиметр в миллиметр", () => {
  // Осевые линии 4000 × 3000, стены 100 — значит внутренняя грань это
  // 50…3950 по x и 50…2950 по y. Площадь 3900 × 2900 = 11,31 м².
  const found = roomTraceRegion({
    seedMm: { x: 2000, y: 1500 },
    walls: wallRing(corners(0, 0, 4000, 3000), 100),
    rings: [],
  });
  assert.equal(found.ok, true, "контур не нашёлся: " + found.reason);
  ringIs(found.pointsMm, corners(50, 50, 3950, 2950));
  assert.equal(found.areaMm2, 3900 * 2900);
  assert.equal(found.cell, ROOM_TRACE_CELL_MM);
});

test("толщина стены видна в контуре: толще стена — меньше комната", () => {
  const thin = roomTraceRegion({ seedMm: { x: 2000, y: 1500 }, walls: wallRing(corners(0, 0, 4000, 3000), 100), rings: [] });
  const thick = roomTraceRegion({ seedMm: { x: 2000, y: 1500 }, walls: wallRing(corners(0, 0, 4000, 3000), 400), rings: [] });
  ringIs(thick.pointsMm, corners(200, 200, 3800, 2800), "грань толстой стены");
  assert.ok(thick.areaMm2 < thin.areaMm2);
});

test("Г-образная комната даёт шесть вершин, и внутренний угол не скошен", () => {
  // Нижняя полка 4000 × 2000 плюс левая 2000 × 2000, стены 100. Внутренний
  // угол — ровно (1950, 1950): фаску стыка снимает `dropArtifacts`.
  const found = roomTraceRegion({
    seedMm: { x: 500, y: 500 },
    walls: wallRing(
      [
        { x: 0, y: 0 },
        { x: 4000, y: 0 },
        { x: 4000, y: 2000 },
        { x: 2000, y: 2000 },
        { x: 2000, y: 4000 },
        { x: 0, y: 4000 },
      ],
      100,
    ),
    rings: [],
  });
  assert.equal(found.ok, true, "контур не нашёлся: " + found.reason);
  ringIs(found.pointsMm, [
    { x: 50, y: 50 },
    { x: 3950, y: 50 },
    { x: 3950, y: 1950 },
    { x: 1950, y: 1950 },
    { x: 1950, y: 3950 },
    { x: 50, y: 3950 },
  ]);
});

test("косая стена: контур садится на её грань, а не на лестницу растра", () => {
  // Эркер под 45°: стена от (4000, 2000) к (3000, 3000), толщина 100.
  // Внутренняя грань пересекает грань правой стены (x = 3950) в y = 1979.
  const found = roomTraceRegion({
    seedMm: { x: 2000, y: 1500 },
    walls: wallRing(
      [
        { x: 0, y: 0 },
        { x: 4000, y: 0 },
        { x: 4000, y: 2000 },
        { x: 3000, y: 3000 },
        { x: 0, y: 3000 },
      ],
      100,
    ),
    rings: [],
  });
  assert.equal(found.ok, true, "контур не нашёлся: " + found.reason);
  assert.equal(found.pointsMm.length, 5, "лестница растра не упростилась: " + JSON.stringify(found.pointsMm));
  ringIs(found.pointsMm, [
    { x: 50, y: 50 },
    { x: 3950, y: 50 },
    { x: 3950, y: 1979 },
    { x: 2979, y: 2950 },
    { x: 50, y: 2950 },
  ]);
});

// ——— занятую часть не захватывать ——————————————————————————————————————

test("кухня-столовая: размеченная половина не захватывается, шов общий", () => {
  // Комната 6000 × 3000 без перегородки. Левая половина уже помещение —
  // контур до x = 3000. Показ справа обязан дать ровно остаток: 3000…5950.
  const walls = wallRing(corners(0, 0, 6000, 3000), 100);
  const kitchen = corners(50, 50, 3000, 2950);
  const found = roomTraceRegion({ seedMm: { x: 4500, y: 1500 }, walls, rings: [kitchen] });
  assert.equal(found.ok, true, "контур не нашёлся: " + found.reason);
  ringIs(found.pointsMm, corners(3000, 50, 5950, 2950));
  // Шов общий: ни зазора, ни наложения — обе половины держатся за x = 3000.
  assert.equal(
    found.pointsMm.filter((point) => point.x === 3000).length,
    2,
    "вершины не встали на шов: " + JSON.stringify(found.pointsMm),
  );
});

test("комната переходит в коридор: без стены между ними берётся всё, с размеченным коридором — только комната", () => {
  const walls = wallRing(corners(0, 0, 5200, 3000), 100);
  const whole = roomTraceRegion({ seedMm: { x: 2000, y: 1500 }, walls, rings: [] });
  ringIs(whole.pointsMm, corners(50, 50, 5150, 2950), "стены между комнатой и коридором нет");
  const corridor = corners(4000, 50, 5150, 2950);
  const room = roomTraceRegion({ seedMm: { x: 2000, y: 1500 }, walls, rings: [corridor] });
  ringIs(room.pointsMm, corners(50, 50, 4000, 2950), "коридор размечен");
  assert.ok(room.areaMm2 < whole.areaMm2);
});

test("показ в уже размеченном помещении — отказ с номером контура, а не второй контур", () => {
  const walls = wallRing(corners(0, 0, 6000, 3000), 100);
  const rings = [corners(50, 50, 3000, 2950)];
  const found = roomTraceRegion({ seedMm: { x: 1500, y: 1500 }, walls, rings });
  assert.deepEqual({ ok: found.ok, reason: found.reason, ringIndex: found.ringIndex }, { ok: false, reason: "taken", ringIndex: 0 });
});

test("показ вплотную к шву соседнего контура — тоже «занято», и назван тот самый контур", () => {
  // Точка вне кольца, но ближе клетки к его ребру: встать тут нечему, и ответ
  // обязан называть соседа, а не отдавать контур шириной в клетку.
  const walls = wallRing(corners(0, 0, 6000, 3000), 100);
  const rings = [corners(50, 50, 2000, 2950), corners(4000, 50, 5950, 2950)];
  const found = roomTraceRegion({ seedMm: { x: 4000 - 5, y: 1500 }, walls, rings });
  assert.equal(found.reason, "taken");
  assert.equal(found.ringIndex, 1, "назван не тот контур");
});

// ——— проёмы ——————————————————————————————————————————————————————————

test("проём для заливки — глухая стена: через дверь в соседнюю комнату не утекает", () => {
  const scene = drawnPair();
  const found = roomTraceAt(scene.project, scene.schemeId, fraction(scene, { x: 2000, y: 1500 }));
  assert.equal(found.ok, true, "контур не нашёлся: " + found.reason);
  const ring = found.points.map((point) => planFractionToMm(scene.project, scene.schemeId, point));
  ringIs(ring, corners(50, 50, 3950, 2950), "дверь пропустила заливку в соседнюю комнату");
});

// ——— незамкнутая область, предел, мелочь ———————————————————————————————

test("стены не сошлись — отказ «не замкнуто», а не контур во всю квартиру", () => {
  const walls = wallRing(corners(0, 0, 4000, 3000), 100).slice(0, 3);
  const found = roomTraceRegion({ seedMm: { x: 2000, y: 1500 }, walls, rings: [] });
  assert.equal(found.ok, false);
  assert.equal(found.reason, "open");
});

test("стен нет вовсе — отказ «нечем считать»", () => {
  assert.equal(roomTraceRegion({ seedMm: { x: 0, y: 0 }, walls: [], rings: [] }).reason, "noWalls");
});

test("показали внутрь стены — так и сказано", () => {
  const found = roomTraceRegion({ seedMm: { x: 2000, y: 0 }, walls: wallRing(corners(0, 0, 4000, 3000), 100), rings: [] });
  assert.equal(found.reason, "inWall");
});

test("предел сверху: зал больше 200 м² контуром не отдаётся", () => {
  const found = roomTraceRegion({ seedMm: { x: 10000, y: 7500 }, walls: wallRing(corners(0, 0, 20000, 15000), 200), rings: [] });
  assert.equal(found.reason, "tooBig");
  assert.ok(found.areaMm2 > ROOM_TRACE_AREA_MAX_MM2, "предел назван, а площадь не отдана");
});

test("большой дом считается грубее, а не отвергается", () => {
  // 100 × 80 м: при клетке 20 мм буфер не влез бы в предел, и клетка грубеет.
  // Точность при этом держит посадка на линии — комната 5 × 5 м выходит точной.
  const walls = [];
  for (let i = 0; i <= 20; i += 1) walls.push({ aMm: { x: i * 5000, y: 0 }, bMm: { x: i * 5000, y: 80000 }, thicknessMm: 200 });
  for (let j = 0; j <= 16; j += 1) walls.push({ aMm: { x: 0, y: j * 5000 }, bMm: { x: 100000, y: j * 5000 }, thicknessMm: 200 });
  const found = roomTraceRegion({ seedMm: { x: 2500, y: 2500 }, walls, rings: [] });
  assert.equal(found.ok, true, "большой дом отвергнут: " + found.reason);
  assert.ok(found.cell > ROOM_TRACE_CELL_MM, "клетка не загрубела: " + found.cell);
  ringIs(found.pointsMm, corners(100, 100, 4900, 4900), "комната большого дома");
});

test("линии для посадки: у стены четыре — две грани и два торца", () => {
  const lines = roomTraceLines([{ aMm: { x: 0, y: 0 }, bMm: { x: 1000, y: 0 }, thicknessMm: 100 }], []);
  assert.equal(lines.length, 4);
  const across = lines.filter((line) => Math.abs(line.dy) > 0.9);
  assert.equal(across.length, 2, "торцов не два");
  assert.deepEqual(
    lines.filter((line) => Math.abs(line.dx) > 0.9).map((line) => line.y).sort((one, two) => one - two),
    [-50, 50],
    "грани не по обе стороны осевой",
  );
});

test("площадь кольца считается той же формулой, что у контура помещения", () => {
  // Контур живёт в долях, а заливка в миллиметрах — но площадь обе считают
  // шнурками, и разойтись им нельзя: по ней человек и сверяет ответ.
  const ring = corners(0, 0, 2000, 1000);
  assert.equal(ringAreaMm2(ring), 2000 * 1000);
  assert.equal(ringAreaMm2(ring.slice(0, 2)), 0);
  const fractions = ring.map((point) => ({ x: point.x / 4000, y: point.y / 4000 }));
  assert.ok(Math.abs(outlineArea(fractions) * 4000 * 4000 - ringAreaMm2(ring)) < 1);
});

// ——— то же, но об объекте ——————————————————————————————————————————————

// План 1200 × 800 точек при 100 точках на метр, начало координат чертежа в
// доле (0,1; 0,1) — та же оснастка, что в тестах чертежа.
function planProject() {
  const added = addScheme(createProject(), { name: "1 этаж", imageId: "plan-1", width: 1200, height: 800 });
  const scaled = setPlanScale(added.project, added.scheme.id, {
    a: { x: 0.1, y: 0.5 },
    b: { x: 0.6, y: 0.5 },
    meters: 6,
  });
  return { project: scaled.project, schemeId: added.scheme.id };
}

function fraction(scene, pointMm) {
  return { x: 0.1 + pointMm.x / 10 / 1200, y: 0.1 + pointMm.y / 10 / 800 };
}

function drawn(ring, thicknessMm = 100) {
  const base = planProject();
  let project = setPlanOrigin(base.project, base.schemeId, { at: { x: 0.1, y: 0.1 }, turn: 0 }).project;
  const wallIds = [];
  for (const wall of wallRing(ring, thicknessMm)) {
    const added = addWall(project, { schemeId: base.schemeId, ...wall });
    project = added.project;
    wallIds.push(added.wall.id);
  }
  project = setSchemeWallHeight(project, base.schemeId, 2700).project;
  return { project, schemeId: base.schemeId, wallIds };
}

// Две комнаты 4 × 3 м рядом, между ними стена с дверью: заливка обязана
// остановиться на двери, потому что проём для неё — глухая стена.
function drawnPair() {
  const scene = drawn(corners(0, 0, 8000, 3000));
  let project = scene.project;
  const middle = addWall(project, {
    schemeId: scene.schemeId,
    aMm: { x: 4000, y: 0 },
    bMm: { x: 4000, y: 3000 },
    thicknessMm: 100,
  });
  project = middle.project;
  project = addOpening(project, {
    wallId: middle.wall.id,
    kind: "door",
    atMm: 1000,
    widthMm: 900,
    heightMm: 2100,
    heightAboveFloorMm: 0,
  }).project;
  return { project, schemeId: scene.schemeId, wallId: middle.wall.id };
}

test("без чертежа варианта нет, и сказано чего не хватает", () => {
  // Объект без стен — G68: он не меняется ни на поле, и ответ про него честный.
  const bare = planProject();
  assert.deepEqual(roomTraceReady(bare.project, bare.schemeId), { ok: false, reason: "noWalls" });
  assert.equal(roomTraceAt(bare.project, bare.schemeId, { x: 0.5, y: 0.5 }).reason, "noWalls");
  assert.equal(canvasRoomTraceSaid(bare.project, { reason: "noWalls" }), strings.roomTrace.noWalls);
});

test("чертёж есть, а привязки нет — отказ «чертёж не положен на план»", () => {
  const base = planProject();
  const added = addWall(base.project, {
    schemeId: base.schemeId,
    aMm: { x: 0, y: 0 },
    bMm: { x: 4000, y: 0 },
    thicknessMm: 100,
  });
  assert.deepEqual(roomTraceReady(added.project, base.schemeId), { ok: false, reason: "noBridge" });
  assert.equal(canvasRoomTraceSaid(added.project, { reason: "noBridge" }), strings.roomTrace.noBridge);
});

test("чертёж и привязка есть — вариант доступен, а контур приходит долями плана", () => {
  const scene = drawn(corners(0, 0, 4000, 3000));
  assert.deepEqual(roomTraceReady(scene.project, scene.schemeId), { ok: true, reason: null });
  const found = roomTraceAt(scene.project, scene.schemeId, fraction(scene, { x: 2000, y: 1500 }));
  assert.equal(found.ok, true, "контур не нашёлся: " + found.reason);
  // Доли, а не миллиметры: контур ложится рядом с нарисованными руками.
  for (const point of found.points) {
    assert.ok(point.x > 0 && point.x < 1 && point.y > 0 && point.y < 1, "вершина вне плана: " + JSON.stringify(point));
  }
  // И обратный перевод возвращает ту же внутреннюю грань.
  const ring = found.points.map((point) => planFractionToMm(scene.project, scene.schemeId, point));
  ringIs(ring, corners(50, 50, 3950, 2950));
  assert.equal(found.areaMm2, 3900 * 2900);
});

test("контур уже размеченного помещения уносится в отказ вместе с его названием", () => {
  const scene = drawn(corners(0, 0, 6000, 3000));
  const room = addRoom(scene.project, "Кухня");
  const outline = addOutline(room.project, {
    schemeId: scene.schemeId,
    roomId: room.room.id,
    points: corners(50, 50, 3000, 2950).map((point) => fraction(scene, point)),
  });
  const found = roomTraceAt(outline.project, scene.schemeId, fraction(scene, { x: 1500, y: 1500 }));
  assert.equal(found.ok, false);
  assert.equal(found.reason, "taken");
  assert.equal(found.roomId, room.room.id);
  assert.equal(found.outlineId, outline.outline.id);
  assert.match(canvasRoomTraceSaid(outline.project, found), /Кухня/);
});

test("контур соседа ушёл в модель — и тем же проходом перестал захватываться", () => {
  const scene = drawn(corners(0, 0, 6000, 3000));
  const room = addRoom(scene.project, "Кухня");
  const outline = addOutline(room.project, {
    schemeId: scene.schemeId,
    roomId: room.room.id,
    points: corners(50, 50, 3000, 2950).map((point) => fraction(scene, point)),
  });
  const found = roomTraceAt(outline.project, scene.schemeId, fraction(scene, { x: 4500, y: 1500 }));
  assert.equal(found.ok, true, "контур не нашёлся: " + found.reason);
  const ring = found.points.map((point) => planFractionToMm(outline.project, scene.schemeId, point));
  ringIs(ring, corners(3000, 50, 5950, 2950));
});

test("объект не правится: автоопределение только считает", () => {
  const scene = drawn(corners(0, 0, 4000, 3000));
  const before = JSON.stringify(scene.project);
  roomTraceAt(scene.project, scene.schemeId, fraction(scene, { x: 2000, y: 1500 }));
  assert.equal(JSON.stringify(scene.project), before, "`roomTraceAt` тронул объект");
});

// ——— режим холста ——————————————————————————————————————————————————————

test("режим забирает клик себе: ручка метки под курсором его не отбирает", () => {
  const scene = drawn(corners(0, 0, 4000, 3000));
  const room = addRoom(scene.project, "Кухня");
  const state = {
    project: room.project,
    schemeId: scene.schemeId,
    activeRoomId: room.room.id,
    activeTypeId: null,
    selectedMarkIds: [],
    mode: CANVAS_MODE_ROOM_TRACE,
    layout: "desktop",
    view: { scale: 1, offsetX: 0, offsetY: 0 },
  };
  // Ручки поворота подписи, поводка и вершины пути — всё мимо: клик один, и он
  // показывает точку внутри комнаты.
  assert.equal(canvasTapKind(state, { labelTurn: true, markId: "m-1" }), "roomTrace");
  assert.equal(canvasTapKind(state, { pathHandle: { kind: "vertex", index: 0 } }), "roomTrace");
  // Долгое нажатие не берёт ничего: палец здесь тоже показывает точку.
  assert.equal(canvasGrabKind(state, { markId: "m-1" }), null);
  // Подсказка называет помещение, занятую часть и разовость определения.
  const hint = canvasHintText(state);
  assert.match(hint, /Кухня/);
  assert.match(hint, /разово/);
  assert.notEqual(hint, canvasHintText({ ...state, mode: "room" }), "подсказки обводки и чертежа совпали");
  // И о входе в режим говорит плашка: своей кнопки в ряду «Режим» у него нет.
  assert.equal(CANVAS_MODE_NOTES[CANVAS_MODE_ROOM_TRACE], strings.canvas.modeRoomTraceSaid);
  assert.equal(typeof strings.tools.mode_roomTrace, "string");
  assert.equal(typeof strings.tools.modeNow_roomTrace, "string");
});

// ——— G68: объект без чертежа ———————————————————————————————————————————

test("G68: объект прежней сборки не меняется и варианта по чертежу не получает", () => {
  // Те же байты, которые выдала опубликованная сборка: объект со схемой,
  // калибровкой, комнатой, контуром и метками, но без единой стены.
  const path = join(dirname(fileURLToPath(import.meta.url)), "legacy-project.json");
  const was = readFileSync(path, "utf8").replace(/\n$/, "");
  const project = JSON.parse(was);
  const schemeId = project.schemes[0].id;
  assert.deepEqual(roomTraceReady(project, schemeId), { ok: false, reason: "noWalls" });
  const found = roomTraceAt(project, schemeId, { x: 0.5, y: 0.5 });
  assert.equal(found.ok, false);
  assert.equal(found.reason, "noWalls");
  assert.equal(JSON.stringify(project, null, 2), was, "объект прежней сборки тронут");
});

test("у каждого отказа своя строка, и ни одна не вышла ключом", () => {
  const scene = drawn(corners(0, 0, 4000, 3000));
  const said = new Set();
  for (const reason of ["noWalls", "noBridge", "inWall", "open", "tooSmall", "tooBig", "tooComplex", "taken"]) {
    const value = canvasRoomTraceSaid(scene.project, { reason, areaMm2: 300e6, points: 400 });
    assert.ok(value && !value.includes("roomTrace."), "отказ «" + reason + "» вышел ключом: " + value);
    assert.ok(!value.includes("{"), "в строке осталась подстановка: " + value);
    said.add(value);
  }
  assert.equal(said.size, 8, "два отказа говорят одно и то же");
});
