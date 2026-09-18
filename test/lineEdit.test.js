// Правка нарисованной ломаной: вершину двигают, добавляют и убирают.
//
// Заказчик: «у линий при выделении позволь редактировать её, например двойным
// кликом на линию». До этого ломаную можно было нарисовать, выделить и
// удалить — но не поправить: ошибся на третьей вершине из десяти, перерисовывай
// всю.
//
// Механику правки контуров помещений не изобретали заново — её повторили: те
// же три чистые функции модели, та же рука на холсте. Поэтому здесь же
// проверяется, что правка контуров от этого не разошлась с правкой линий.
import test from "node:test";
import assert from "node:assert/strict";

import {
  MARK_LINE_MIN_POINTS,
  addMark,
  addOutline,
  addRoom,
  addScheme,
  createProject,
  findMark,
  insertMarkPoint,
  moveMarkPoint,
  moveOutlinePoint,
  removeMarkPoint,
  updateMark,
} from "../src/model.js";
import { canvasHintText } from "../src/canvas.js";
import { strings } from "../src/strings.js";

const LINE = [
  { x: 0.2, y: 0.2 },
  { x: 0.5, y: 0.2 },
  { x: 0.5, y: 0.6 },
];

function scene(points = LINE, closed = false) {
  const made = addScheme(createProject(), { name: "1 этаж", width: 1000, height: 500 });
  const tape = made.project.markTypes.find((type) => type.code === "Л");
  const added = addMark(made.project, { schemeId: made.scheme.id, typeId: tape.id, kind: "line", points });
  const project = closed ? updateMark(added.project, added.mark.id, { closed: true }).project : added.project;
  return { project, scheme: project.schemes[0], markId: added.mark.id };
}

const pointsOf = (project, markId) => findMark(project, markId).points;

test("вершина двигается, а остальные остаются на месте", () => {
  const base = scene();
  const moved = moveMarkPoint(base.project, base.markId, 1, { x: 0.55, y: 0.25 }).project;
  assert.deepEqual(pointsOf(moved, base.markId), [
    { x: 0.2, y: 0.2 },
    { x: 0.55, y: 0.25 },
    { x: 0.5, y: 0.6 },
  ]);
  // Объект чистый: снимок «до» не тронут, и Ctrl+Z возвращает прежнюю линию.
  assert.deepEqual(pointsOf(base.project, base.markId), LINE);
});

test("новая вершина встаёт на том сегменте, по которому щёлкнули", () => {
  const base = scene();
  const added = insertMarkPoint(base.project, base.markId, 0, { x: 0.35, y: 0.22 }).project;
  assert.deepEqual(
    pointsOf(added, base.markId).map((point) => point.x),
    [0.2, 0.35, 0.5, 0.5],
    "вершина встала не между первой и второй",
  );
});

test("вершина убирается, а последние две убрать нельзя", () => {
  const base = scene();
  const short = removeMarkPoint(base.project, base.markId, 1).project;
  assert.deepEqual(pointsOf(short, base.markId), [LINE[0], LINE[2]]);
  assert.equal(pointsOf(short, base.markId).length, MARK_LINE_MIN_POINTS);

  // Линия короче двух вершин не существует — модель её и не отдаст.
  assert.throws(() => removeMarkPoint(short, base.markId, 0), { code: "shortLine" });
  assert.throws(() => removeMarkPoint(short, base.markId, 1), { code: "shortLine" });
});

test("чужая вершина не правится: индекс мимо линии — отказ, а не тихая порча", () => {
  const base = scene();
  for (const index of [-1, 3, 99]) {
    assert.throws(() => moveMarkPoint(base.project, base.markId, index, { x: 0.1, y: 0.1 }), {
      code: "markPointNotFound",
    });
    assert.throws(() => insertMarkPoint(base.project, base.markId, index, { x: 0.1, y: 0.1 }), {
      code: "markPointNotFound",
    });
    assert.throws(() => removeMarkPoint(base.project, base.markId, index), { code: "markPointNotFound" });
  }
});

test("замкнутая линия остаётся замкнутой после любой правки", () => {
  const base = scene([...LINE, { x: 0.2, y: 0.6 }], true);
  const closedAfter = (project) => findMark(project, base.markId).closed;
  assert.equal(closedAfter(base.project), true, "пример не тот: линия должна быть замкнутой");
  assert.equal(closedAfter(moveMarkPoint(base.project, base.markId, 0, { x: 0.25, y: 0.25 }).project), true);
  assert.equal(closedAfter(insertMarkPoint(base.project, base.markId, 3, { x: 0.2, y: 0.4 }).project), true);
  assert.equal(closedAfter(removeMarkPoint(base.project, base.markId, 2).project), true);
});

// Правка вершины ничего не знает о подписи, помещении и номере метки: она
// трогает только точки. Объект прежней разметки от появления правки не меняется
// вовсе — ни одного нового поля у метки не завелось.
test("правка вершины не трогает ничего, кроме точек", () => {
  const base = scene();
  const before = findMark(base.project, base.markId);
  const after = findMark(moveMarkPoint(base.project, base.markId, 2, { x: 0.6, y: 0.7 }).project, base.markId);
  for (const key of Object.keys(before)) {
    if (key === "points") continue;
    assert.deepEqual(after[key], before[key], "правка вершины задела поле " + key);
  }
  assert.deepEqual(Object.keys(after).sort(), Object.keys(before).sort(), "у метки завелось новое поле");
});

test("правка контуров помещений от правки линий не пострадала", () => {
  const made = addScheme(createProject(), { name: "1 этаж", width: 1000, height: 500 });
  const room = addRoom(made.project, "Гостиная");
  const outlined = addOutline(room.project, {
    schemeId: made.scheme.id,
    roomId: room.room.id,
    points: [
      { x: 0.1, y: 0.1 },
      { x: 0.6, y: 0.1 },
      { x: 0.6, y: 0.5 },
    ],
  });
  const moved = moveOutlinePoint(outlined.project, outlined.outline.id, 1, { x: 0.7, y: 0.2 }).project;
  assert.deepEqual(moved.outlines[0].points[1], { x: 0.7, y: 0.2 });
  assert.equal(moved.outlines[0].points.length, 3);
});

// Подсказка внизу холста — чистая функция от состояния, и в правке она обязана
// говорить о вершинах: двойной клик здесь занят ими, а не выделением.
test("в правке линии подсказка рассказывает про вершины", () => {
  const base = scene();
  const stateOf = (patch) => ({
    project: base.project,
    schemeId: base.scheme.id,
    activeTypeId: null,
    activeRoomId: null,
    mode: "select",
    layout: "desktop",
    ...patch,
  });
  assert.equal(canvasHintText(stateOf({ editLineId: base.markId })), strings.canvas.hintLineEdit);
  // Линии уже нет — подсказка возвращается к обычной: обещать правку нечему.
  assert.equal(canvasHintText(stateOf({ editLineId: "нет-такой-метки" })), strings.canvas.hintSelect);
  // В просмотре правки нет вовсе.
  assert.equal(canvasHintText(stateOf({ editLineId: base.markId, layout: "mobile" })), strings.mobile.viewOnly);
});
