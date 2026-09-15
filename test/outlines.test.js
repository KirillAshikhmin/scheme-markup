// Контуры помещений на схеме: обводка комнаты многоугольником, попадание точки
// внутрь и автопривязка метки к помещению.
//
// Вся суть таска — сложная форма: Г-образная комната, эркер, ниша. Поэтому
// точки для проверок взяты руками по чертежу, а не посчитаны тем же кодом,
// который проверяется.
import test from "node:test";
import assert from "node:assert/strict";

import {
  addMark,
  addOutline,
  addRoom,
  addScheme,
  applyRoomOutlines,
  createProject,
  deleteRoom,
  deleteScheme,
  findMark,
  insertOutlinePoint,
  markRoomManual,
  moveOutlinePoint,
  outlineArea,
  outlinesInOrder,
  removeOutlinePoint,
  roomAtPoint,
  updateMark,
  updateOutline,
  updateRoom,
} from "../src/model.js";
import { marksTable } from "../src/tables.js";

// Г-образная комната: квадрат 0…0.6 с вырезанным правым нижним углом.
//
//   0.0 ┌───────────┐ 0.6
//       │           │
//   0.3 │     ┌─────┘ 0.6
//       │     │
//   0.6 └─────┘ 0.3
const L_SHAPE = [
  { x: 0.0, y: 0.0 },
  { x: 0.6, y: 0.0 },
  { x: 0.6, y: 0.3 },
  { x: 0.3, y: 0.3 },
  { x: 0.3, y: 0.6 },
  { x: 0.0, y: 0.6 },
];

function scene() {
  const project = createProject({ name: "Объект" });
  const withScheme = addScheme(project, { name: "Этаж 1", width: 1000, height: 1000 });
  const withRoom = addRoom(withScheme.project, "Гостиная");
  return { project: withRoom.project, scheme: withScheme.scheme, room: withRoom.room };
}

function anyTypeId(project) {
  return project.markTypes[0].id;
}

test("точка в вырезе Г-образной комнаты — снаружи контура", () => {
  const { project, scheme, room } = scene();
  const drawn = addOutline(project, { schemeId: scheme.id, roomId: room.id, points: L_SHAPE });

  // В левом верхнем крыле — внутри.
  assert.equal(roomAtPoint(drawn.project, scheme.id, { x: 0.15, y: 0.15 }), room.id);
  // В нижнем крыле — тоже внутри.
  assert.equal(roomAtPoint(drawn.project, scheme.id, { x: 0.15, y: 0.5 }), room.id);
  // В вырезе (правый нижний угол квадрата) — снаружи, хотя рамка его накрывает.
  assert.equal(roomAtPoint(drawn.project, scheme.id, { x: 0.5, y: 0.5 }), null);
  // Совсем в стороне — снаружи.
  assert.equal(roomAtPoint(drawn.project, scheme.id, { x: 0.9, y: 0.9 }), null);
});

// Площадь считается по чертежу руками, а не тем же кодом, что под тестом:
// Г-образная комната — квадрат 0,6 × 0,6 без выреза 0,3 × 0,3.
function near(actual, expected, what) {
  assert.ok(Math.abs(actual - expected) < 1e-12, what + ": " + actual + ", ждали " + expected);
}

test("площадь контура — площадь фигуры, а не число вершин", () => {
  near(outlineArea(L_SHAPE), 0.36 - 0.09, "площадь Г-образной комнаты");
  near(
    outlineArea([
      { x: 0.1, y: 0.1 },
      { x: 0.9, y: 0.1 },
      { x: 0.9, y: 0.9 },
      { x: 0.1, y: 0.9 },
    ]),
    0.64,
    "площадь квадрата 0,8 × 0,8",
  );
  // Обход против часовой стрелки даёт ту же площадь: знак не важен.
  near(outlineArea([...L_SHAPE].reverse()), 0.27, "площадь при обратном обходе");
  // Двумя точками комнату не обвести — площади нет.
  assert.equal(outlineArea(L_SHAPE.slice(0, 2)), 0);
});

test("вложенные контуры: побеждает меньший по площади, а не простой по форме", () => {
  const { project, scheme, room } = scene();
  const inner = addRoom(project, "Ниша в зале");
  // Зал — простой квадрат из четырёх вершин, площадь 0,64.
  const big = addOutline(inner.project, {
    schemeId: scheme.id,
    roomId: room.id,
    points: [
      { x: 0.1, y: 0.1 },
      { x: 0.9, y: 0.1 },
      { x: 0.9, y: 0.9 },
      { x: 0.1, y: 0.9 },
    ],
  });
  // Ниша внутри зала — Г-образная, из шести вершин, площадь 0,0675: вершин
  // больше, а комната меньше. Так обычно и бывает на настоящем плане.
  const nichePoints = [
    { x: 0.2, y: 0.2 },
    { x: 0.5, y: 0.2 },
    { x: 0.5, y: 0.35 },
    { x: 0.35, y: 0.35 },
    { x: 0.35, y: 0.5 },
    { x: 0.2, y: 0.5 },
  ];
  const small = addOutline(big.project, { schemeId: scheme.id, roomId: inner.room.id, points: nichePoints });
  near(outlineArea(nichePoints), 0.09 - 0.0225, "площадь ниши");
  assert.ok(nichePoints.length > big.outline.points.length, "у меньшей комнаты вершин больше");

  // Точка внутри обоих — это ниша, комната внутри комнаты.
  assert.equal(roomAtPoint(small.project, scheme.id, { x: 0.25, y: 0.25 }), inner.room.id);
  // Точка в вырезе ниши — уже зал, хотя рамка ниши её накрывает.
  assert.equal(roomAtPoint(small.project, scheme.id, { x: 0.45, y: 0.45 }), room.id);
  // Только в зале.
  assert.equal(roomAtPoint(small.project, scheme.id, { x: 0.8, y: 0.8 }), room.id);
  // Меньший контур лежит в порядке последним: по нему же он рисуется поверх.
  const order = outlinesInOrder(small.project, scheme.id).map((outline) => outline.roomId);
  assert.deepEqual(order, [room.id, inner.room.id]);
});

test("контур принадлежит схеме: на соседней схеме та же точка ничего не находит", () => {
  const { project, scheme, room } = scene();
  const second = addScheme(project, { name: "Этаж 2", width: 1000, height: 1000 });
  const drawn = addOutline(second.project, { schemeId: scheme.id, roomId: room.id, points: L_SHAPE });
  assert.equal(roomAtPoint(drawn.project, scheme.id, { x: 0.15, y: 0.15 }), room.id);
  assert.equal(roomAtPoint(drawn.project, second.scheme.id, { x: 0.15, y: 0.15 }), null);
});

test("метка внутри контура получает помещение сама, вне контуров — пустое поле", () => {
  const { project, scheme, room } = scene();
  const drawn = addOutline(project, { schemeId: scheme.id, roomId: room.id, points: L_SHAPE });
  const typeId = anyTypeId(drawn.project);
  const inside = addMark(drawn.project, { schemeId: scheme.id, typeId, points: [{ x: 0.15, y: 0.15 }] });
  const outside = addMark(inside.project, { schemeId: scheme.id, typeId, points: [{ x: 0.9, y: 0.9 }] });

  const applied = applyRoomOutlines(outside.project, scheme.id);
  assert.deepEqual(applied.changed, [inside.mark.id]);
  assert.equal(findMark(applied.project, inside.mark.id).roomId, room.id);
  assert.equal(findMark(applied.project, outside.mark.id).roomId, null);
});

test("вписанное руками помещение не трогает ни перемещение метки, ни перерисовка контура", () => {
  const { project, scheme, room } = scene();
  const other = addRoom(project, "Кухня");
  const drawn = addOutline(other.project, { schemeId: scheme.id, roomId: room.id, points: L_SHAPE });
  const typeId = anyTypeId(drawn.project);
  const placed = addMark(drawn.project, { schemeId: scheme.id, typeId, points: [{ x: 0.15, y: 0.15 }] });
  // Пользователь вписал «Кухню» поверх подставленной «Гостиной».
  const manual = updateMark(placed.project, placed.mark.id, { roomId: other.room.id, roomManual: true });

  // Метку двигают внутрь того же контура — помещение остаётся вписанным.
  const moved = updateMark(manual.project, placed.mark.id, { points: [{ x: 0.1, y: 0.5 }] });
  const afterMove = applyRoomOutlines(moved.project, scheme.id);
  assert.deepEqual(afterMove.changed, []);
  assert.equal(findMark(afterMove.project, placed.mark.id).roomId, other.room.id);

  // Контур перерисовали так, что метка оказалась снаружи, — тоже не трогаем.
  const outline = outlinesInOrder(afterMove.project, scheme.id)[0];
  const redrawn = updateOutline(afterMove.project, outline.id, {
    points: [
      { x: 0.7, y: 0.7 },
      { x: 0.9, y: 0.7 },
      { x: 0.9, y: 0.9 },
      { x: 0.7, y: 0.9 },
    ],
  });
  const afterRedraw = applyRoomOutlines(redrawn.project, scheme.id);
  assert.equal(findMark(afterRedraw.project, placed.mark.id).roomId, other.room.id);
});

test("вершины контура двигаются, добавляются и удаляются", () => {
  const { project, scheme, room } = scene();
  const drawn = addOutline(project, {
    schemeId: scheme.id,
    roomId: room.id,
    points: [
      { x: 0.1, y: 0.1 },
      { x: 0.5, y: 0.1 },
      { x: 0.5, y: 0.5 },
      { x: 0.1, y: 0.5 },
    ],
  });
  const id = drawn.outline.id;

  const moved = moveOutlinePoint(drawn.project, id, 1, { x: 0.8, y: 0.1 });
  assert.deepEqual(moved.outline.points[1], { x: 0.8, y: 0.1 });
  // Точка за правым краем прежнего квадрата теперь внутри — стена уехала.
  assert.equal(roomAtPoint(moved.project, scheme.id, { x: 0.7, y: 0.12 }), room.id);

  const inserted = insertOutlinePoint(moved.project, id, 1, { x: 0.8, y: 0.3 });
  assert.equal(inserted.outline.points.length, 5);
  assert.deepEqual(inserted.outline.points[2], { x: 0.8, y: 0.3 });

  const removed = removeOutlinePoint(inserted.project, id, 2);
  assert.equal(removed.outline.points.length, 4);

  // Треугольник — предел: четвёртой вершины у контура уже не остаётся.
  const triangle = removeOutlinePoint(removed.project, id, 3);
  assert.equal(triangle.outline.points.length, 3);
  assert.throws(() => removeOutlinePoint(triangle.project, id, 0), { code: "shortOutline" });
  assert.throws(() => addOutline(triangle.project, { schemeId: scheme.id, roomId: room.id, points: L_SHAPE.slice(0, 2) }), {
    code: "shortOutline",
  });
});

test("удаление помещения уносит его контуры, удаление схемы — все свои", () => {
  const { project, scheme, room } = scene();
  const second = addScheme(project, { name: "Этаж 2", width: 1000, height: 1000 });
  const first = addOutline(second.project, { schemeId: scheme.id, roomId: room.id, points: L_SHAPE });
  const upstairs = addOutline(first.project, { schemeId: second.scheme.id, roomId: room.id, points: L_SHAPE });
  assert.equal(upstairs.project.outlines.length, 2);

  const withoutScheme = deleteScheme(upstairs.project, scheme.id);
  assert.deepEqual(
    withoutScheme.project.outlines.map((outline) => outline.schemeId),
    [second.scheme.id],
  );

  const withoutRoom = deleteRoom(upstairs.project, room.id);
  assert.deepEqual(withoutRoom.project.outlines, []);
});

test("цвет комнаты назначается сам и правится руками", () => {
  const { project } = scene();
  const second = addRoom(project, "Кухня");
  const third = addRoom(second.project, "Спальная");
  const colors = third.project.rooms.map((room) => room.color);
  assert.equal(new Set(colors).size, 3, "цвета комнат разошлись не по всем: " + colors.join(", "));
  for (const color of colors) assert.match(color, /^#[0-9A-F]{6}$/);

  const painted = updateRoom(third.project, second.room.id, { color: "#123abc" });
  assert.equal(painted.room.color, "#123ABC");
  // Мусор вместо цвета не стирает прежний.
  const kept = updateRoom(painted.project, second.room.id, { color: "не цвет" });
  assert.equal(kept.room.color, "#123ABC");
});

test("объект, размеченный до контуров, не теряет вписанные помещения", () => {
  const { project, scheme, room } = scene();
  const typeId = anyTypeId(project);
  const placed = addMark(project, { schemeId: scheme.id, typeId, points: [{ x: 0.9, y: 0.9 }] });
  // Метка из старого объекта: помещение есть, признака ручной правки нет вовсе —
  // до этого таска вписать его можно было только руками.
  const legacy = {
    ...placed.project,
    marks: placed.project.marks.map((mark) => {
      const copy = { ...mark, roomId: room.id };
      delete copy.roomManual;
      return copy;
    }),
  };
  assert.equal(markRoomManual(legacy.marks[0]), true);

  const applied = applyRoomOutlines(legacy, scheme.id);
  assert.deepEqual(applied.changed, []);
  assert.equal(findMark(applied.project, placed.mark.id).roomId, room.id);
});

test("разбивка «По помещениям» наполняется подставленными помещениями", () => {
  const { project, scheme, room } = scene();
  const drawn = addOutline(project, { schemeId: scheme.id, roomId: room.id, points: L_SHAPE });
  const typeId = anyTypeId(drawn.project);
  const inside = addMark(drawn.project, { schemeId: scheme.id, typeId, points: [{ x: 0.15, y: 0.15 }] });
  const outside = addMark(inside.project, { schemeId: scheme.id, typeId, points: [{ x: 0.9, y: 0.9 }] });
  const applied = applyRoomOutlines(outside.project, scheme.id);

  const table = marksTable(applied.project, null, "room");
  const filled = table.groups.find((group) => group.title === "Гостиная");
  assert.equal(filled.rows.length, 1);
  // Вторая метка стоит вне контуров — она в группе «без помещения».
  const rest = table.groups.find((group) => group.id === "none");
  assert.equal(rest.rows.length, 1);
});
