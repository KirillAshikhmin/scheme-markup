// Связанный прибор на плане и в «Объёме» (таск 02, R03–R05).
//
// Проверяется чистое, без DOM: место знака в `visibleMarks` (одна дверь для
// кадра, клика и выгрузок), попадание клика, тело в «Объёме» и то, что объект
// без связей даёт прежний кадр по журналу вызовов `ctx` (G68).
import test from "node:test";
import assert from "node:assert/strict";

import {
  addMark,
  addToGroup,
  addScheme,
  addSchemeObject,
  addWall,
  createProject,
  findMark,
  setMarkObject,
  setMarkWall,
  setPlanOrigin,
  setPlanScale,
  updateSchemeObject,
} from "../src/model.js";
import { drawScheme, hitHandle, hitTest, planToScreen, visibleMark, visibleMarks } from "../src/render.js";
import { volumeMarks } from "../src/volume.js";
import { canvasBlockFromPx } from "../src/canvas.js";

function scene() {
  const added = addScheme(createProject({ name: "Связь" }), { name: "1 этаж", imageId: "plan-1", width: 1200, height: 800 });
  const schemeId = added.scheme.id;
  let project = added.project;
  project = setPlanScale(project, schemeId, { a: { x: 0.1, y: 0.5 }, b: { x: 0.6, y: 0.5 }, meters: 6 }).project;
  project = setPlanOrigin(project, schemeId, { at: { x: 0, y: 0 }, turn: 0 }).project;
  project = addWall(project, { schemeId, aMm: { x: 0, y: 0 }, bMm: { x: 4000, y: 0 }, thicknessMm: 100 }).project;
  const object = addSchemeObject(project, {
    schemeId,
    catalogKey: "tv",
    shape: "rect",
    atMm: { x: 2000, y: 200 },
    widthMm: 1240,
    depthMm: 80,
    heightMm: 720,
    heightAboveFloorMm: 500,
    turnDeg: 90,
  });
  project = object.project;
  const type = project.markTypes.find((item) => item.code === "ТВ");
  const mark = addMark(project, { schemeId, typeId: type.id, kind: "point", points: [{ x: 0.1, y: 0.1 }] });
  return { project: mark.project, schemeId, object: object.schemeObject, mark: mark.mark };
}

const VIEW = { zoom: 1, offsetX: 0, offsetY: 0, markSize: 10, labelSize: 12 };

function recorder() {
  const log = [];
  const impl = { log };
  const ctx = new Proxy(impl, {
    get(target, key) {
      if (key === "log") return log;
      if (key === "measureText") return (value) => ({ width: String(value).length * 6 });
      return (...args) => log.push([String(key), ...args.map((arg) => (typeof arg === "object" ? "obj" : arg))]);
    },
    set(target, key, value) {
      log.push(["=" + String(key), value]);
      return true;
    },
  });
  return { ctx, log };
}

test("знак связанной метки стоит на месте вещи, а точки метки в объекте не меняются", () => {
  const base = scene();
  const linked = setMarkObject(base.project, base.mark.id, base.object.id);
  const scheme = linked.project.schemes[0];
  const [shown] = visibleMarks(linked.project, scheme);
  // Вещь на (2000, 200) мм при 100 точках на метр и начале в (0, 0): 200 × 20 точек
  // плана, то есть доли 200/1200 и 20/800 — не там, где записана метка (0,1 · 0,1).
  assert.ok(Math.abs(shown.points[0].x - 200 / 1200) < 1e-9, "x знака " + shown.points[0].x);
  assert.ok(Math.abs(shown.points[0].y - 20 / 800) < 1e-9, "y знака " + shown.points[0].y);
  assert.deepEqual(findMark(linked.project, base.mark.id).points, [{ x: 0.1, y: 0.1 }], "точки метки переписаны");
  // Вещь подвинули — знак поехал с ней.
  const moved = updateSchemeObject(linked.project, base.object.id, { atMm: { x: 3000, y: 400 } });
  const [after] = visibleMarks(moved.project, moved.project.schemes[0]);
  assert.ok(Math.abs(after.points[0].x - 300 / 1200) < 1e-9);
});

test("клик попадает в знак на месте вещи, а не в старую точку метки", () => {
  const base = scene();
  const linked = setMarkObject(base.project, base.mark.id, base.object.id);
  const scheme = linked.project.schemes[0];
  const [shown] = visibleMarks(linked.project, scheme);
  const at = planToScreen(shown.points[0], scheme, VIEW);
  assert.equal(hitTest(linked.project, scheme, at, VIEW).markId, base.mark.id);
  const old = planToScreen({ x: 0.1, y: 0.1 }, scheme, VIEW);
  assert.equal(hitTest(linked.project, scheme, old, VIEW), null, "клик попал в пустое место метки");
});

test("объект без связи и объект со снятой связью дают один и тот же кадр", () => {
  const base = scene();
  const plain = recorder();
  drawScheme(plain.ctx, { project: base.project, scheme: base.project.schemes[0], view: VIEW });
  const linked = setMarkObject(base.project, base.mark.id, base.object.id);
  const off = setMarkObject(linked.project, base.mark.id, null);
  const again = recorder();
  drawScheme(again.ctx, { project: off.project, scheme: off.project.schemes[0], view: VIEW });
  assert.deepEqual(again.log, plain.log);
  // А со связью кадр другой: знак уехал на вещь.
  const moved = recorder();
  drawScheme(moved.ctx, { project: linked.project, scheme: linked.project.schemes[0], view: VIEW });
  assert.notDeepEqual(moved.log, plain.log);
});

test("в «Объёме» тело связанной метки стоит на вещи и развёрнуто её углом", () => {
  const base = scene();
  const linked = setMarkObject(base.project, base.mark.id, base.object.id);
  const result = volumeMarks(linked.project, base.schemeId, { rooms: [], walls: [] });
  const place = result.placed.find((item) => item.markId === base.mark.id);
  assert.ok(place, "тело не размещено: " + JSON.stringify(result.unplaced));
  assert.deepEqual(place.frame.at, { x: 2000, y: 200 });
  // Поворот 90°: ось «вдоль» легла по оси y чертежа.
  assert.ok(Math.abs(place.frame.u.x) < 1e-9 && Math.abs(place.frame.u.y - 1) < 1e-9, JSON.stringify(place.frame.u));
  assert.equal(place.frame.widthMm, 1240);
  assert.equal(place.frame.depthMm, 80);
  assert.equal(place.frame.heightMm, 720);
  assert.equal(place.frame.bottomMm, 500);
  assert.equal(place.heightMm, 860);
  // Без связи тело стоит на точке метки и повёрнутым не бывает.
  const free = volumeMarks(base.project, base.schemeId, { rooms: [], walls: [] }).placed.find((item) => item.markId === base.mark.id);
  assert.notDeepEqual(free ? free.frame && free.frame.at : null, { x: 2000, y: 200 });
});

test("на развёртке изображение связанной метки повёрнуто углом вещи, без связи кадр прежний", async () => {
  const { drawElevation } = await import("../src/render.js");
  const { wallElevation } = await import("../src/model.js");
  const base = scene();
  const wallId = base.project.walls[0].id;
  const draw = (project) => {
    const rec = recorder();
    const elevation = wallElevation(project, wallId, "right");
    drawElevation(rec.ctx, elevation, { x: 0, y: 0, width: 800, height: 400 }, { views: true });
    return rec.log;
  };
  const bound = setMarkWall(base.project, base.mark.id, { wallId, atMm: 2000, toMm: null }).project;
  const linked = setMarkObject(bound, base.mark.id, base.object.id).project;
  const turned = draw(linked).filter((call) => call[0] === "rotate");
  const free = draw(bound).filter((call) => call[0] === "rotate");
  assert.equal(free.length, 0, "без связи появился поворот");
  assert.equal(turned.length, 1, "не повёрнуто " + JSON.stringify(wallElevation(linked, wallId, "right").marks.map((m) => [m.turnDeg, m.heightMm, m.view, m.fromMm])));
});

// Место связанной метки читается **только** через резолвер. До этой правки
// ручки «+», их попадание, кольцо подсветки, подводка холста из списка и
// поиска и подъём плана из-под карточки брали сырую `mark.points`: знак стоял
// на вещи, а ручки висели у записанной точки — после миграции в 0…300 мм, а
// после сдвига вещи (R04) на любом расстоянии.
test("ручки «+» связанной метки стоят у знака, а не у записанной точки", () => {
  const base = scene();
  const linked = setMarkObject(base.project, base.mark.id, base.object.id).project;
  const scheme = linked.schemes[0];
  const raw = findMark(linked, base.mark.id);
  const shown = visibleMark(linked, raw);
  assert.notDeepEqual(shown.points, raw.points, "пример не тот: знак не уехал на вещь");

  // Ручка «слева» считается от знака: по этой точке и щёлкают.
  const atSign = planToScreen(shown.points[0], scheme, VIEW);
  const atOwn = planToScreen(raw.points[0], scheme, VIEW);
  const gap = Math.hypot(atSign.x - atOwn.x, atSign.y - atOwn.y);
  assert.ok(gap > 40, "пример не тот: точки слишком близко — " + gap);
  const handle = { x: atSign.x - 18, y: atSign.y };
  assert.equal(hitHandle(scheme, shown, handle, VIEW), "left", "ручка не нашлась у знака");
  assert.equal(hitHandle(scheme, raw, handle, VIEW), null, "у сырой метки ручка оказалась там же — пример не тот");

  // И метка без связи проходит дверь **собой**: кадр объекта без связей не
  // меняется ни на вызов (G68).
  const free = findMark(base.project, base.mark.id);
  assert.equal(visibleMark(base.project, free), free, "метка без связи вернулась копией");
});

// Ручка «+» нарисована у знака и ловится у знака, а новая метка блока вставала
// у **записанной** точки: сразу после миграции в 849 мм от ручки, а после
// сдвига вещи — в 2214 мм. Смещение знака передаётся модели тем же `fromPx`,
// которым передаётся смещение стопки.
test("ручка «+» связанной метки ставит новую метку под ручку, а не у записанной точки", () => {
  const base = scene();
  const linked = setMarkObject(base.project, base.mark.id, base.object.id).project;
  const scheme = linked.schemes[0];
  const state = { project: linked, schemeId: scheme.id, filter: {}, view: VIEW, selectedMarkIds: [base.mark.id] };
  const raw = findMark(linked, base.mark.id);
  const shown = visibleMark(linked, raw);

  // Смещение знака — в пикселях плана, как ждёт `addToGroup`.
  const shift = canvasBlockFromPx(state, scheme, base.mark.id);
  assert.ok(shift, "смещение знака не посчитано");
  assert.ok(Math.abs(shift.x - (shown.points[0].x - raw.points[0].x) * 1200) < 1e-6, JSON.stringify(shift));
  assert.ok(Math.abs(shift.y - (shown.points[0].y - raw.points[0].y) * 800) < 1e-6, JSON.stringify(shift));

  // И новая метка встаёт у знака: шаг отсчитан от него, а не от точки метки.
  const step = 24;
  const added = addToGroup(linked, base.mark.id, "right", { step, fromPx: shift });
  const put = added.mark.points[0];
  assert.ok(Math.abs(put.x - (shown.points[0].x + step / 1200)) < 1e-9, "метка встала не под ручкой");
  assert.ok(Math.abs(put.y - shown.points[0].y) < 1e-9, "метка уехала по второй оси");
  const gapToSign = Math.hypot((put.x - shown.points[0].x) * 1200, (put.y - shown.points[0].y) * 800);
  const gapToOwn = Math.hypot((put.x - raw.points[0].x) * 1200, (put.y - raw.points[0].y) * 800);
  assert.ok(Math.abs(gapToSign - step) < 1e-6, "до знака не шаг: " + gapToSign);
  assert.ok(gapToOwn > step * 2, "пример не тот: знак и точка слишком близко");

  // У метки без связи и без стопки смещения нет вовсе — всё считается как
  // считалось (G68).
  const free = { ...state, project: base.project };
  assert.equal(canvasBlockFromPx(free, scheme, base.mark.id), null, "несвязанной метке завелось смещение");
});
