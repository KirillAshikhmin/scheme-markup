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
  extendMarkLine,
  findMark,
  insertMarkPoint,
  insertOutlinePoint,
  moveMarkPoint,
  moveOutlinePoint,
  removeMarkPoint,
  removeOutlinePoint,
  updateMark,
} from "../src/model.js";
import { canvasHintText } from "../src/canvas.js";
import {
  hitPathHandle,
  markRadius,
  outlineHandles,
  pathEditHandles,
  pathExtendHandles,
  pathInsertHandles,
  pathVertexHandles,
  samePathHandle,
} from "../src/render.js";
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
  assert.equal(canvasHintText(stateOf({ editPathId: base.markId })), strings.canvas.hintLineEdit);
  // Линии уже нет — подсказка возвращается к обычной: обещать правку нечему.
  // Сверяется начало: к обычной подсказке приписаны жесты копирования (таск 90).
  assert.ok(canvasHintText(stateOf({ editPathId: "нет-такой-метки" })).startsWith(strings.canvas.hintSelect));
  // В просмотре правки нет вовсе.
  assert.equal(canvasHintText(stateOf({ editPathId: base.markId, layout: "mobile" })), strings.mobile.viewOnly);
});

// G95: «двойной клик по контуру комнаты — тоже давай править его». Жест один на
// оба объекта, и разница между ними осталась ровно одна — предел вершин.
test("у контура те же три действия, но меньше трёх вершин он не живёт", () => {
  const made = addScheme(createProject(), { name: "1 этаж", width: 1000, height: 500 });
  const room = addRoom(made.project, "Гостиная");
  const outlined = addOutline(room.project, {
    schemeId: made.scheme.id,
    roomId: room.room.id,
    points: [
      { x: 0.1, y: 0.1 },
      { x: 0.6, y: 0.1 },
      { x: 0.6, y: 0.5 },
      { x: 0.1, y: 0.5 },
    ],
  });
  const id = outlined.outline.id;
  const pointsOfOutline = (project) => project.outlines[0].points;

  const moved = moveOutlinePoint(outlined.project, id, 1, { x: 0.7, y: 0.12 }).project;
  assert.deepEqual(pointsOfOutline(moved)[1], { x: 0.7, y: 0.12 });

  const added = insertOutlinePoint(moved, id, 0, { x: 0.35, y: 0.1 }).project;
  assert.equal(pointsOfOutline(added).length, 5);

  let shorter = removeOutlinePoint(added, id, 0).project;
  shorter = removeOutlinePoint(shorter, id, 0).project;
  assert.equal(pointsOfOutline(shorter).length, 3);
  // Дальше нельзя: линия живёт от двух вершин, контур от трёх.
  assert.throws(() => removeOutlinePoint(shorter, id, 0), { code: "shortOutline" });
});

test("ручки вершин у контура и у линии считаются одним кодом", () => {
  const base = scene();
  const view = { zoom: 1, offsetX: 0, offsetY: 0, markSize: 10, labelSize: 12 };
  const points = findMark(base.project, base.markId).points;
  const handles = pathVertexHandles(base.scheme, points, view);
  assert.equal(handles.length, points.length, "ручек не по вершине на каждую");
  assert.deepEqual(
    handles.map((handle) => handle.kind),
    points.map(() => "vertex"),
  );
  // Контур спрашивает те же ручки — его собственных больше нет.
  const outlinePoints = [
    { x: 0.1, y: 0.1 },
    { x: 0.6, y: 0.1 },
    { x: 0.6, y: 0.5 },
  ];
  assert.deepEqual(
    outlineHandles(base.scheme, { points: outlinePoints }, view),
    pathVertexHandles(base.scheme, outlinePoints, view),
  );
  // Ручка ловится по своему квадрату и не ловит клик в стороне.
  const first = handles[0];
  assert.equal(hitPathHandle(handles, { x: first.x + 1, y: first.y - 1 }), first);
  assert.equal(hitPathHandle(handles, { x: first.x + first.r * 4, y: first.y }), null);
});

// Подсказка у контура своя: предел вершин у него другой, и обещать «от двух»
// было бы враньём.
test("в правке контура подсказка своя", () => {
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
  const state = {
    project: outlined.project,
    schemeId: made.scheme.id,
    activeTypeId: null,
    activeRoomId: null,
    mode: "select",
    layout: "desktop",
    editPathId: outlined.outline.id,
  };
  assert.equal(canvasHintText(state), strings.canvas.hintOutlineEdit);
  assert.notEqual(strings.canvas.hintOutlineEdit, strings.canvas.hintLineEdit);
});

// ——— таск 92: разбить отрезок и продлить конец ————————————————————————
//
// Заказчик: «надо добавить возможность разбивать прямую на несколько сегментов,
// а так же, если линия не замкнутая, то по концам добавить возможность
// продлить, добавив ещё точку». Вершину в отрезок двойной клик добавлял и
// раньше (таск 58) — жеста было не видно; теперь на середине отрезка стоит
// ручка, а за концами незамкнутой линии — ещё две.

const VIEW = { zoom: 1, offsetX: 0, offsetY: 0, markSize: 10, labelSize: 12 };

test("линия продолжается с конца: вершина дописывается в хвост", () => {
  const base = scene();
  const grown = extendMarkLine(base.project, base.markId, "end", { x: 0.8, y: 0.9 }).project;
  assert.deepEqual(pointsOf(grown, base.markId), [...LINE, { x: 0.8, y: 0.9 }]);
  // Снимок «до» цел: одна отмена возвращает линию, какой она была.
  assert.deepEqual(pointsOf(base.project, base.markId), LINE);
});

// Главная ловушка продолжения: порядок вершин у линии значащий — по первому
// сегменту уходит подпись, за первую вершину держится стрелка связи. Значит,
// продолжение с головы обязано дописывать вершину в голову, а не переворачивать
// линию, чтобы дописать в хвост.
test("продолжение с начала не переворачивает линию", () => {
  const base = scene();
  const grown = extendMarkLine(base.project, base.markId, "start", { x: 0.05, y: 0.1 }).project;
  assert.deepEqual(pointsOf(grown, base.markId), [{ x: 0.05, y: 0.1 }, ...LINE]);
  // Хвост остался хвостом, голова — головой: ни одна прежняя вершина местами
  // не поменялась.
  const after = pointsOf(grown, base.markId);
  assert.deepEqual(after.slice(1), LINE);
  assert.deepEqual(after[after.length - 1], LINE[LINE.length - 1]);
});

test("замкнутой линии и точке продолжения нет, а конец бывает только двух родов", () => {
  const ring = scene(LINE, true);
  assert.throws(() => extendMarkLine(ring.project, ring.markId, "end", { x: 0.1, y: 0.1 }), {
    code: "extendClosedLine",
  });
  const made = addScheme(createProject(), { name: "1 этаж", width: 1000, height: 500 });
  const socket = made.project.markTypes.find((type) => type.kind !== "line");
  const point = addMark(made.project, {
    schemeId: made.scheme.id,
    typeId: socket.id,
    kind: "point",
    points: [{ x: 0.3, y: 0.3 }],
  });
  assert.throws(() => extendMarkLine(point.project, point.mark.id, "end", { x: 0.4, y: 0.4 }), {
    code: "extendOnlyLine",
  });
  const base = scene();
  assert.throws(() => extendMarkLine(base.project, base.markId, "middle", { x: 0.4, y: 0.4 }), {
    code: "markEndUnknown",
  });
});

test("на каждом отрезке — по ручке, и стоит она ровно на середине", () => {
  const base = scene();
  const handles = pathInsertHandles(base.scheme, LINE, VIEW, false);
  assert.equal(handles.length, LINE.length - 1, "ручек не по отрезку на каждый");
  assert.deepEqual(
    handles.map((handle) => handle.index),
    [0, 1],
  );
  const first = handles[0];
  assert.equal(first.kind, "insert");
  assert.equal(first.x, ((0.2 + 0.5) / 2) * 1000);
  assert.equal(first.y, ((0.2 + 0.2) / 2) * 500);
});

test("у замкнутой линии ручка есть и на замыкающем отрезке", () => {
  const base = scene(LINE, true);
  const open = pathInsertHandles(base.scheme, LINE, VIEW, false);
  const ring = pathInsertHandles(base.scheme, LINE, VIEW, true);
  assert.equal(ring.length, open.length + 1, "замыкающий отрезок остался без ручки");
  assert.equal(ring[ring.length - 1].index, LINE.length - 1);
});

// Ленту по периметру рисуют двумя десятками вершин. Если ручка вставала бы на
// каждый отрезок, у коротких она села бы прямо на вершины — вместо выбора вышла
// бы каша из трёх ручек в одной точке. Двойной клик по такому отрезку остаётся.
test("короткий отрезок ручки середины не получает", () => {
  const base = scene();
  const tight = [
    { x: 0.2, y: 0.2 },
    { x: 0.205, y: 0.2 },
    { x: 0.6, y: 0.2 },
  ];
  const handles = pathInsertHandles(base.scheme, tight, VIEW, false);
  assert.deepEqual(
    handles.map((handle) => handle.index),
    [1],
    "ручка села на пятипиксельный отрезок",
  );
});

test("ручки продолжения — по одной на каждый конец, и стоят они за концом", () => {
  const base = scene();
  const handles = pathExtendHandles(base.scheme, LINE, VIEW, false);
  assert.equal(handles.length, 2);
  assert.deepEqual(
    handles.map((handle) => handle.end),
    ["start", "end"],
  );
  // Номера концов — те, что понадобятся модели: голова и хвост списка.
  assert.deepEqual(
    handles.map((handle) => handle.index),
    [0, LINE.length - 1],
  );
  const head = pathVertexHandles(base.scheme, LINE, VIEW)[0];
  const tail = pathVertexHandles(base.scheme, LINE, VIEW)[LINE.length - 1];
  // Ручка стоит не на вершине, а за ней: на вершине уже сидит своя, и две в
  // одной точке означали бы «непонятно, что потащат». Отступ — не меньше того,
  // каким разведены ручки «+» блока от метки.
  assert.ok(Math.hypot(handles[0].x - head.x, handles[0].y - head.y) >= markRadius(VIEW));
  assert.ok(Math.hypot(handles[1].x - tail.x, handles[1].y - tail.y) >= markRadius(VIEW));
  // Продолжение уходит наружу: от первой вершины влево (линия идёт вправо), от
  // последней вниз (последний отрезок идёт вниз).
  assert.ok(handles[0].x < head.x, "ручка начала смотрит внутрь линии");
  assert.ok(handles[1].y > tail.y, "ручка конца смотрит внутрь линии");
});

test("замкнутой линии и контуру помещения ручек продолжения не полагается", () => {
  const base = scene(LINE, true);
  assert.deepEqual(pathExtendHandles(base.scheme, LINE, VIEW, true), []);
  // Контур замкнут по своей природе — у него разбивка есть, продолжения нет.
  const outline = { points: [...LINE, { x: 0.2, y: 0.6 }], closed: true };
  const handles = pathEditHandles(base.scheme, outline, VIEW);
  assert.equal(handles.filter((handle) => handle.kind === "extend").length, 0);
  assert.ok(handles.some((handle) => handle.kind === "insert"), "контур остался без разбивки");
});

// Ручки стоят близко — вершина, середина соседнего отрезка, конец, — и спор за
// клик разрешается порядком списка, один раз и в одном месте.
test("вершины в списке ручек первые: по ним и попадают раньше прочих", () => {
  const base = scene();
  const handles = pathEditHandles(base.scheme, { points: LINE, closed: false }, VIEW);
  const kinds = handles.map((handle) => handle.kind);
  assert.deepEqual(kinds.slice(0, LINE.length), LINE.map(() => "vertex"));
  assert.ok(kinds.includes("insert") && kinds.includes("extend"));
  // Попадание считается по списку: под точкой вершины отвечает вершина.
  const vertex = handles[0];
  assert.equal(hitPathHandle(handles, { x: vertex.x, y: vertex.y }).kind, "vertex");
  const insert = handles.find((handle) => handle.kind === "insert");
  assert.equal(hitPathHandle(handles, { x: insert.x, y: insert.y }), insert);
});

test("ручки сравниваются по роду, номеру и концу, а не по ссылке", () => {
  const base = scene();
  const first = pathEditHandles(base.scheme, { points: LINE, closed: false }, VIEW);
  const second = pathEditHandles(base.scheme, { points: LINE, closed: false }, VIEW);
  // Кадр считает ручки заново, и подсветка обязана пережить пересчёт.
  assert.ok(samePathHandle(first[0], second[0]));
  assert.ok(!samePathHandle(first[0], second[1]));
  const ends = second.filter((handle) => handle.kind === "extend");
  assert.ok(!samePathHandle(ends[0], ends[1]), "оба конца линии сочлись за одну ручку");
  assert.ok(!samePathHandle(null, second[0]));
});
