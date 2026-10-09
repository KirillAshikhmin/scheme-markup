// Правка плана: поворот и обрезка подложки.
//
// Поворот загруженной подложки — живое поведение (G178): две кнопки в строке
// схемы, без окна и без вопроса. Обрезка размеченного плана, наоборот, закрыта
// (G175) — окно с рамкой открывается только на новую картинку. Разбор здесь
// общий: обе правки идут одной функцией, и тесты обрезки описывают запас, по
// которому вход вернётся, если понадобится.
//
// Это самая разрушительная правка в сборке: она двигает координаты **всех**
// меток схемы разом. Двести размеченных точек, поворот оказался не в ту
// сторону — и вернуть их может только отмена, поэтому шаг истории здесь
// обязателен, а «до» обязано остаться нетронутым объектом.
//
// Отсюда и то, что проверяется ниже: пересчёт считается на снимке, а не в
// объекте пользователя; вместе с метками едут контуры помещений (иначе
// автопривязка, которая срабатывает на каждом шаге истории, молча раздаст
// меткам чужие комнаты); прижатые рамкой к краю метки сосчитаны и названы.
//
// Хранилище и DOM сюда не поднимаются — как и в остальных тестах панелей.
// Что прежняя картинка остаётся в хранилище ради отмены, проверяет ручная
// приёмка: Ctrl+Z после поворота обязан вернуть и координаты, и картинку.
import test from "node:test";
import assert from "node:assert/strict";

import {
  addMark,
  addOutline,
  addRoom,
  addScheme,
  applyRoomOutlines,
  createProject,
  findMark,
  findOutline,
  findScheme,
  planOriginOf,
  planScaleOf,
  setPlanOrigin,
  setPlanScale,
  updateMark,
} from "../src/model.js";
import { applyPlanEdit } from "../src/panels/schemes.js";

const PLAN = { width: 1000, height: 500 };
const close = (value, expected, what) =>
  assert.ok(Math.abs(value - expected) < 1e-9, what + ": " + value + " вместо " + expected);

// Контур спальни — левая половина плана; в нём метка, за ним вторая.
const BEDROOM = [
  { x: 0.05, y: 0.1 },
  { x: 0.45, y: 0.1 },
  { x: 0.45, y: 0.9 },
  { x: 0.05, y: 0.9 },
];

function scene() {
  let step = createProject();
  const scheme = addScheme(step, { name: "1 этаж", imageId: "старая", width: PLAN.width, height: PLAN.height });
  step = scheme.project;
  const room = addRoom(step, { name: "Спальная Оли" });
  step = room.project;
  const outline = addOutline(step, { schemeId: scheme.scheme.id, roomId: room.room.id, points: BEDROOM });
  step = outline.project;
  const typeId = step.markTypes.find((type) => type.code === "В").id;
  const inside = addMark(step, {
    schemeId: scheme.scheme.id,
    typeId,
    kind: "point",
    points: [{ x: 0.25, y: 0.5 }],
  });
  step = updateMark(inside.project, inside.mark.id, {
    labelOffset: { dx: 12, dy: -10 },
    location: "у двери",
  }).project;
  const outside = addMark(step, {
    schemeId: scheme.scheme.id,
    typeId,
    kind: "point",
    points: [{ x: 0.8, y: 0.5 }],
  });
  return {
    project: applyRoomOutlines(outside.project).project,
    schemeId: scheme.scheme.id,
    roomId: room.room.id,
    outlineId: outline.outline.id,
    insideId: inside.mark.id,
    outsideId: outside.mark.id,
  };
}

const TURN = { rotate: 90, crop: null };

test("поворот двигает метки, подписи и размер плана — и всё это одним снимком", () => {
  const base = scene();
  const result = applyPlanEdit(base.project, base.schemeId, {
    imageId: "новая",
    width: PLAN.height,
    height: PLAN.width,
    transform: TURN,
  });
  const scheme = findScheme(result.project, base.schemeId);

  assert.equal(scheme.imageId, "новая");
  assert.equal(scheme.width, 500);
  assert.equal(scheme.height, 1000);
  assert.equal(result.pushed, 0, "поворот никого за край не выносит");

  // Доли по правилу поворота вправо: (x, y) -> (1 − y, x).
  const mark = findMark(result.project, base.insideId);
  close(mark.points[0].x, 0.5, "x метки");
  close(mark.points[0].y, 0.25, "y метки");
  // Смещение подписи — в пикселях плана, и поворачивается вместе с ним.
  assert.deepEqual(mark.labelOffset, { dx: 10, dy: 12 });
  // Разметка остаётся разметкой: номер, поля и тип не трогаются.
  assert.equal(mark.number, findMark(base.project, base.insideId).number);
  assert.equal(mark.location, "у двери");
});

// Шаг истории — это пара снимков. Правка «на месте» в объекте пользователя
// сделала бы «до» и «после» одним и тем же объектом, и отменять было бы нечем.
test("объект пользователя не трогается: «до» остаётся тем, чем было", () => {
  const base = scene();
  const snapshot = JSON.parse(JSON.stringify(base.project));
  applyPlanEdit(base.project, base.schemeId, {
    imageId: "новая",
    width: PLAN.height,
    height: PLAN.width,
    transform: TURN,
  });
  assert.deepEqual(JSON.parse(JSON.stringify(base.project)), snapshot);
  assert.equal(findScheme(base.project, base.schemeId).imageId, "старая");
});

// Контур помещения живёт в тех же долях плана, что и метка. Оставь его на
// месте — и после поворота комната ляжет поперёк стен, а автопривязка (она
// считается на каждом шаге истории) перепишет меткам помещения по этой каше.
test("контуры помещений едут вместе с метками, и помещение метки не меняется", () => {
  const base = scene();
  assert.equal(findMark(base.project, base.insideId).roomId, base.roomId, "пример не тот: метка должна быть в комнате");
  assert.equal(findMark(base.project, base.outsideId).roomId, null);

  const turned = applyPlanEdit(base.project, base.schemeId, {
    imageId: "новая",
    width: PLAN.height,
    height: PLAN.width,
    transform: TURN,
  }).project;
  const outline = findOutline(turned, base.outlineId);
  const corners = [
    [0.9, 0.05],
    [0.9, 0.45],
    [0.1, 0.45],
    [0.1, 0.05],
  ];
  assert.equal(outline.points.length, corners.length);
  corners.forEach(([x, y], index) => {
    close(outline.points[index].x, x, "x вершины контура " + index);
    close(outline.points[index].y, y, "y вершины контура " + index);
  });

  // И главное: автопривязка после поворота отвечает то же самое.
  const bound = applyRoomOutlines(turned);
  assert.deepEqual(bound.changed, [], "после поворота помещения меток переписались");
  assert.equal(findMark(bound.project, base.insideId).roomId, base.roomId);
  assert.equal(findMark(bound.project, base.outsideId).roomId, null);
});

test("обрезка прижимает метку к краю и говорит, скольких это коснулось", () => {
  const base = scene();
  // Рамка по правой половине: метка слева за неё не попадает.
  const result = applyPlanEdit(base.project, base.schemeId, {
    imageId: "новая",
    width: 500,
    height: 500,
    transform: { rotate: 0, crop: { x: 0.5, y: 0, width: 0.5, height: 1 } },
  });
  assert.equal(result.pushed, 1, "прижатая к краю метка не сосчитана");
  const clamped = findMark(result.project, base.insideId);
  close(clamped.points[0].x, 0, "метка прижата к левому краю");
  close(clamped.points[0].y, 0.5, "y метки");
  // Метка внутри рамки просто пересчитана в доли нового плана.
  const kept = findMark(result.project, base.outsideId);
  close(kept.points[0].x, 0.6, "x метки внутри рамки");
  // Метка не потеряна и не переименована — она прижата.
  assert.equal(result.project.marks.length, 2);
});

// Объект прежней разметки контуров не знает вовсе — и это не ошибка.
test("объект без контуров правится так же", () => {
  const base = scene();
  const { outlines, ...legacy } = base.project;
  assert.equal(outlines.length, 1, "пример не тот: контур должен быть");
  const result = applyPlanEdit(legacy, base.schemeId, {
    imageId: "новая",
    width: PLAN.height,
    height: PLAN.width,
    transform: TURN,
  });
  close(findMark(result.project, base.insideId).points[0].x, 0.5, "x метки");
  assert.equal(result.project.outlines, undefined);
});

// ——— чистый поворот: за это его и пустили к размеченному плану ——————————
//
// Кнопка поворота в строке схемы ничего не спрашивает перед работой, и это
// решение держится ровно на одном: поворот не теряет **ничего**. Проверяем не
// на удобном примере, а на том, где терять есть что: метки по всем четырём
// углам и по краям, калибровка от угла до угла, привязка чертежа.
function cornerScene() {
  let step = createProject();
  const scheme = addScheme(step, { name: "1 этаж", imageId: "старая", width: PLAN.width, height: PLAN.height });
  step = scheme.project;
  const schemeId = scheme.scheme.id;
  const typeId = step.markTypes.find((type) => type.code === "В").id;
  const corners = [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
    { x: 0, y: 1 },
    { x: 0.5, y: 0 },
    { x: 0.1, y: 0.9 },
  ];
  const ids = [];
  for (const point of corners) {
    const added = addMark(step, { schemeId, typeId, kind: "point", points: [point] });
    step = added.project;
    ids.push(added.mark.id);
  }
  step = setPlanScale(step, schemeId, { a: { x: 0, y: 0 }, b: { x: 1, y: 1 }, meters: 20 }).project;
  step = setPlanOrigin(step, schemeId, { at: { x: 0.2, y: 0.8 }, turn: 90 }).project;
  return { project: step, schemeId, ids, corners };
}

test("чистый поворот не прижимает ни одной метки и не снимает калибровку", () => {
  const base = cornerScene();
  for (const rotate of [90, 180, 270]) {
    const result = applyPlanEdit(base.project, base.schemeId, {
      imageId: "новая",
      width: rotate === 180 ? PLAN.width : PLAN.height,
      height: rotate === 180 ? PLAN.height : PLAN.width,
      transform: { rotate, crop: null },
    });
    assert.equal(result.pushed, 0, "поворот на " + rotate + "° прижал метку к краю");
    assert.equal(result.scaleLost, false, "поворот на " + rotate + "° снял калибровку");
    assert.equal(planScaleOf(result.project, base.schemeId).meters, 20, "метры калибровки изменились");
    // Привязка чертежа переносится вместе с планом и получает прибавку угла:
    // стены нарисованы по подложке и обязаны повернуться с ней (ADR 008).
    const origin = planOriginOf(result.project, base.schemeId);
    assert.ok(origin, "привязка чертежа потерялась при повороте на " + rotate + "°");
    assert.equal(origin.turn, (90 + rotate) % 360, "угол привязки чертежа не прибавился");
  }
});

test("четыре поворота по кругу возвращают разметку туда, где она была", () => {
  const base = cornerScene();
  let step = base.project;
  for (let turn = 0; turn < 4; turn += 1) {
    const size = turn % 2 === 0 ? { width: PLAN.height, height: PLAN.width } : PLAN;
    step = applyPlanEdit(step, base.schemeId, {
      imageId: "круг-" + turn,
      width: size.width,
      height: size.height,
      transform: { rotate: 90, crop: null },
    }).project;
  }
  const scheme = findScheme(step, base.schemeId);
  assert.equal(scheme.width, PLAN.width);
  assert.equal(scheme.height, PLAN.height);
  base.ids.forEach((id, index) => {
    const point = findMark(step, id).points[0];
    // Доли не возвращаются ровно: `1 − y` четыре раза подряд даёт 0,1 как
    // 0,09999999999999998. Для метки это меньше пикселя, и сверка идёт с
    // допуском — но сверка обязана быть: поворот, уводящий метку, бесполезен.
    close(point.x, base.corners[index].x, "x метки " + index);
    close(point.y, base.corners[index].y, "y метки " + index);
  });
  const origin = planOriginOf(step, base.schemeId);
  assert.equal(origin.turn, 90, "угол привязки чертежа не вернулся");
  assert.equal(planScaleOf(step, base.schemeId).meters, 20);
});
