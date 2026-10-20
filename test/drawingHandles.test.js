// Ручки правки — последний слой чертежа (таск 176, дефект D45).
//
// Слова заказчика со снимком: «на чертеже точки, за которые можно менять размер
// объекта, рисуются под линией стены, а должны быть поверх». Причина была в
// слоях: углы вещи рисовал сам `drawDrawingObject`, а вещи лежат **под**
// стенами — так и задумано, стена на чертеже главная. Выходило, что у всего,
// что к стене приставлено (ванна, столешница, радиатор), ручка пропадала ровно
// под той линией, от которой вещь надо оттащить.
//
// Холста в Node нет, и проверяется не картинка, а порядок вызовов: ручка
// обязана идти после последнего штриха стены, после проёмов и после букв углов.
import test from "node:test";
import assert from "node:assert/strict";

import {
  addOpening,
  addScheme,
  addSchemeObject,
  addWall,
  createProject,
  setSchemeWallHeight,
} from "../src/model.js";
import { drawDrawing, drawingUnitBridge } from "../src/render.js";

// Холст-писец: записывает каждый вызов и каждое присваивание.
function scribe(log) {
  const impl = { measureText: (value) => ({ width: String(value).length * 6 }) };
  return new Proxy(impl, {
    get: (target, key) =>
      key in target ? target[key] : (...args) => log.push(String(key) + "(" + args.join(",") + ")"),
    set: (target, key, value) => ((target[key] = value), log.push(String(key) + "=" + String(value)), true),
  });
}

// Комната 4000 × 3000 с вещью, приставленной к нижней стене: ровно тот случай,
// на который пришла жалоба.
function scene() {
  const added = addScheme(createProject(), { name: "1 этаж", imageId: null, width: 0, height: 0 });
  let project = setSchemeWallHeight(added.project, added.scheme.id, 2700).project;
  const schemeId = added.scheme.id;
  const walls = [];
  for (const [aMm, bMm] of [
    [{ x: 0, y: 0 }, { x: 4000, y: 0 }],
    [{ x: 4000, y: 0 }, { x: 4000, y: 3000 }],
    [{ x: 4000, y: 3000 }, { x: 0, y: 3000 }],
    [{ x: 0, y: 3000 }, { x: 0, y: 0 }],
  ]) {
    const wall = addWall(project, { schemeId, aMm, bMm, thicknessMm: 200 });
    project = wall.project;
    walls.push(wall.wall.id);
  }
  const door = addOpening(project, { wallId: walls[0], kind: "door", atMm: 1000, widthMm: 900, heightMm: 2100 });
  project = door.project;
  // Ванна у нижней стены: её верхний край лежит ровно на линии стены.
  const thing = addSchemeObject(project, {
    schemeId,
    catalogKey: "bathtub",
    shape: "rect",
    atMm: { x: 1200, y: 2800 },
    widthMm: 1700,
    depthMm: 700,
    turnDeg: 0,
  });
  return { project: thing.project, schemeId, walls, objectId: thing.schemeObject.id, openingId: door.opening.id };
}

const bridge = () => drawingUnitBridge({ zoom: 0.1, offsetX: 0, offsetY: 0 });

// Ручка рисовальщику приходит доводом: отмечаем в общем журнале, где она была.
const handle = (log) => (ctx, at) => log.push("handle(" + Math.round(at.x) + "," + Math.round(at.y) + ")");

test("углы выделенной вещи рисуются поверх стен, проёмов и букв углов", () => {
  const made = scene();
  const log = [];
  drawDrawing(scribe(log), {
    project: made.project,
    schemeId: made.schemeId,
    bridge: bridge(),
    active: { kind: "object", id: made.objectId },
    handle: handle(log),
  });
  const handles = log.map((line, at) => (line.startsWith("handle(") ? at : -1)).filter((at) => at >= 0);
  assert.equal(handles.length, 4, "у прямоугольника четыре угла, а в журнале: " + handles.length);
  const lastWall = log.map((line, at) => (line.startsWith("stroke(") ? at : -1)).filter((at) => at >= 0).pop();
  const lastLetter = log.map((line, at) => (/^fillText\([А-Я],/.test(line) ? at : -1)).filter((at) => at >= 0).pop();
  assert.ok(lastWall >= 0 && lastLetter >= 0, "чертёж нарисовался не весь — пример не тот");
  assert.ok(handles[0] > lastWall, "ручка нарисована до последнего штриха чертежа — значит под ним");
  assert.ok(handles[0] > lastLetter, "ручка ушла под букву угла");
});

test("ручки створки двери тоже идут последними", () => {
  const made = scene();
  const log = [];
  drawDrawing(scribe(log), {
    project: made.project,
    schemeId: made.schemeId,
    bridge: bridge(),
    active: { kind: "opening", id: made.openingId },
    handle: handle(log),
  });
  const handles = log.map((line, at) => (line.startsWith("handle(") ? at : -1)).filter((at) => at >= 0);
  assert.equal(handles.length, 2, "у створки ручки петли и края: " + handles.length);
  const lastLetter = log.map((line, at) => (/^fillText\([А-Я],/.test(line) ? at : -1)).filter((at) => at >= 0).pop();
  assert.ok(handles[0] > lastLetter, "ручка створки ушла под кружок буквы угла");
});

test("концы выделенной стены — там же, в последнем слое", () => {
  const made = scene();
  const log = [];
  drawDrawing(scribe(log), {
    project: made.project,
    schemeId: made.schemeId,
    bridge: bridge(),
    active: { kind: "wall", id: made.walls[0] },
    handle: handle(log),
  });
  const handles = log.map((line, at) => (line.startsWith("handle(") ? at : -1)).filter((at) => at >= 0);
  assert.deepEqual(handles.length, 2);
  const lastLetter = log.map((line, at) => (/^fillText\([А-Я],/.test(line) ? at : -1)).filter((at) => at >= 0).pop();
  assert.ok(handles[0] > lastLetter, "конец стены ушёл под букву своего же угла");
});

test("без выделенного ручек нет вовсе, и рисовальщик не зовётся", () => {
  const made = scene();
  const log = [];
  drawDrawing(scribe(log), {
    project: made.project,
    schemeId: made.schemeId,
    bridge: bridge(),
    handle: handle(log),
  });
  assert.deepEqual(log.filter((line) => line.startsWith("handle(")), []);
});

test("вещь, спрятанную с экрана, за ручки не возьмёшь: её нет в кадре", () => {
  const made = scene();
  const log = [];
  drawDrawing(scribe(log), {
    project: made.project,
    schemeId: made.schemeId,
    bridge: bridge(),
    active: { kind: "object", id: made.objectId },
    hiddenObjectIds: [made.objectId],
    handle: handle(log),
  });
  assert.deepEqual(log.filter((line) => line.startsWith("handle(")), []);
});

test("вещь тащат за угол — ручки стоят на показанном габарите, а не на записанном", () => {
  const made = scene();
  const log = [];
  drawDrawing(scribe(log), {
    project: made.project,
    schemeId: made.schemeId,
    bridge: bridge(),
    active: { kind: "object", id: made.objectId },
    objectAt: (object) => ({ ...object, atMm: { x: object.atMm.x + 1000, y: object.atMm.y } }),
    handle: handle(log),
  });
  const handles = log.filter((line) => line.startsWith("handle("));
  // Габарит 1700 × 700 с серединой в (2200, 2800) при zoom 0,1 — углы по x в
  // 135 и 305 точках.
  assert.deepEqual(handles.sort(), [
    "handle(135,245)",
    "handle(135,315)",
    "handle(305,245)",
    "handle(305,315)",
  ]);
});
