// Тащишь знак связанного прибора — едет вещь (требование G390, таск 252).
//
// Слова заказчика, прочитавшего отчёт сборки «связь метки и вещи»: «"тащишь
// метку — едет вещь" - сделай». До этого жест был закрыт отказом словом:
// `mark.points` у связанной метки не переписывается (ADR 032), и сдвиг
// записанной точки не двигал картинку ни на пиксель.
//
// Правило вышло одно и чужое: **едет тот, чьё место знак на плане и держит**
// (`markPlaceHolder`). Из него следуют все четыре случая — вещь, точка метки
// без моста мм ↔ доли, точки линии и блока многих точек, метка без связи, — и
// из него же привязка к стене с помещением, потому что и они следствие места.
//
// Обработчик DOM отсюда не поднимается (его проверяет живой прогон):
// проверяются чистые правила и то, что жест пишет в историю один раз.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  addMark,
  addOutline,
  addRoom,
  addScheme,
  addSchemeObject,
  addToGroup,
  addWall,
  applyMarkWalls,
  applyRoomOutlines,
  createProject,
  findMark,
  findSchemeObject,
  markOnWall,
  markPlace,
  markPlaceHolder,
  markWall,
  markWallSide,
  moveMarkPlace,
  moveSchemeObject,
  planShiftToMm,
  setMarkObject,
  setMarkWall,
  setPlanOrigin,
  setPlanScale,
  updateSchemeObject,
  updateType,
  wallElevation,
} from "../src/model.js";
import {
  canvasCommitAllowed,
  canvasEditAllowed,
  canvasMoveIds,
  canvasMoveMarks,
  canvasMoveStepLabel,
} from "../src/canvas.js";
import { visibleMark } from "../src/render.js";
import { projectsMigrateStored } from "../src/panels/projects.js";
import { strings } from "../src/strings.js";

const WIDTH = 1200;
const HEIGHT = 800;

// План 1200 × 800 точек, в метре 100 точек. Значит доля 0,1 по ширине — это
// 120 точек, то есть 1200 мм; доля 0,05 по высоте — 40 точек, то есть 400 мм.
// Эти числа ниже стоят в ответах руками: перевод обязан быть проверяемым.
function scene({ bridge = true } = {}) {
  const added = addScheme(createProject({ name: "Прибор" }), {
    name: "1 этаж",
    imageId: "plan-1",
    width: WIDTH,
    height: HEIGHT,
  });
  const schemeId = added.scheme.id;
  let project = setPlanScale(added.project, schemeId, { a: { x: 0.1, y: 0.5 }, b: { x: 0.6, y: 0.5 }, meters: 6 }).project;
  if (bridge) project = setPlanOrigin(project, schemeId, { at: { x: 0, y: 0 }, turn: 0 }).project;
  project = addWall(project, { schemeId, aMm: { x: 0, y: 0 }, bMm: { x: 6000, y: 0 }, thicknessMm: 100 }).project;
  const thing = addSchemeObject(project, {
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
  project = thing.project;
  const type = project.markTypes.find((item) => item.code === "ТВ");
  const put = addMark(project, { schemeId, typeId: type.id, kind: "point", points: [{ x: 0.1, y: 0.1 }] });
  return { project: put.project, schemeId, object: thing.schemeObject, mark: put.mark, typeId: type.id };
}

const linkedScene = (options) => {
  const base = scene(options);
  return { ...base, project: setMarkObject(base.project, base.mark.id, base.object.id).project };
};

const thingOf = (project, id) => findSchemeObject(project, id);

// ——— мост сдвига: доли → миллиметры ——————————————————————————————————————

test("сдвиг в долях переводится в миллиметры тем же мостом, что и точка", () => {
  const base = scene();
  assert.deepEqual(planShiftToMm(base.project, base.schemeId, { x: 0.1, y: 0 }), { x: 1200, y: 0 });
  assert.deepEqual(planShiftToMm(base.project, base.schemeId, { x: 0.1, y: 0.05 }), { x: 1200, y: 400 });
  // Обратный ход — такой же вектор со знаком минус: сдвиг не зависит от того,
  // откуда его отсчитывают.
  assert.deepEqual(planShiftToMm(base.project, base.schemeId, { x: -0.1, y: -0.05 }), { x: -1200, y: -400 });
  // Повёрнутая привязка поворачивает и вектор: чертёж едет вместе с подложкой.
  const turned = setPlanOrigin(base.project, base.schemeId, { at: { x: 0, y: 0 }, turn: 90 }).project;
  assert.deepEqual(planShiftToMm(turned, base.schemeId, { x: 0.1, y: 0 }), { x: 0, y: -1200 });
  // Нет привязки — нет и моста: выдумывать миллиметры нельзя.
  const bare = scene({ bridge: false });
  assert.equal(planShiftToMm(bare.project, bare.schemeId, { x: 0.1, y: 0 }), null);
  assert.equal(planShiftToMm(base.project, base.schemeId, null), null);
  assert.equal(planShiftToMm(base.project, base.schemeId, { x: Number.NaN, y: 0 }), null);
});

// ——— кто держит место знака ———————————————————————————————————————————

test("место знака держит вещь только у точечной связанной метки на калиброванной схеме", () => {
  const linked = linkedScene();
  const held = markPlaceHolder(linked.project, findMark(linked.project, linked.mark.id));
  assert.equal(held.object && held.object.id, linked.object.id);
  assert.deepEqual(held.points, markPlace(linked.project, findMark(linked.project, linked.mark.id)).points);

  // Метка без связи отдаёт **тот же массив** по ссылке: читатель узнаёт
  // «ничего не изменилось» равенством, и кадр объекта без связей не меняется.
  const free = scene();
  const raw = findMark(free.project, free.mark.id);
  const own = markPlaceHolder(free.project, raw);
  assert.equal(own.object, null);
  assert.equal(own.points, raw.points);

  // Нет моста — вещь на плане не нарисована, место держит сама метка.
  const bare = linkedScene({ bridge: false });
  const bareHeld = markPlaceHolder(bare.project, findMark(bare.project, bare.mark.id));
  assert.equal(bareHeld.object, null, "без калибровки место знака отдали вещи");
  assert.equal(bareHeld.points, findMark(bare.project, bare.mark.id).points);
});

// ——— главный жест ——————————————————————————————————————————————————————

test("тащишь знак связанного прибора — едет вещь, а точка метки стоит", () => {
  const linked = linkedScene();
  const before = findMark(linked.project, linked.mark.id);
  const after = canvasMoveMarks(linked.project, [linked.mark.id], { x: 0.1, y: 0.05 });
  assert.notEqual(after, linked.project, "жест ничего не сделал");

  // Поехала вещь — ровно на переведённый сдвиг.
  assert.deepEqual(thingOf(after, linked.object.id).atMm, { x: 3200, y: 600 });
  // Точка метки не переписана (ADR 032): место не зависит от того, кого
  // тащили последним, и после «Отвязать» метка вернётся туда, где стояла.
  assert.deepEqual(findMark(after, linked.mark.id).points, before.points);

  // А резолвер даёт новое место, и знак на плане стоит на вещи.
  const place = markPlace(after, findMark(after, linked.mark.id));
  assert.equal(place.from, "object");
  assert.deepEqual(place.atMm, { x: 3200, y: 600 });
  const shown = visibleMark(after, findMark(after, linked.mark.id));
  assert.ok(Math.abs(shown.points[0].x - 320 / WIDTH) < 1e-9, "x знака " + shown.points[0].x);
  assert.ok(Math.abs(shown.points[0].y - 60 / HEIGHT) < 1e-9, "y знака " + shown.points[0].y);

  // Снимок «до» цел целиком: отмена возвращает и вещь, и точку одним шагом,
  // потому что возвращается весь объект «до».
  assert.deepEqual(thingOf(linked.project, linked.object.id).atMm, { x: 2000, y: 200 });
  assert.deepEqual(findMark(linked.project, linked.mark.id).points, before.points);
});

test("вещь переставили, а не повернули: угол, отражение и габарит целы", () => {
  const linked = linkedScene();
  const was = thingOf(linked.project, linked.object.id);
  const after = canvasMoveMarks(linked.project, [linked.mark.id], { x: 0.1, y: 0 });
  const now = thingOf(after, linked.object.id);
  // «К стене» — команда руки в «Чертеже», а не хранимая привязка: переносу о
  // ней знать нечего, и правило одно с ручным переносом вещи (`movedObject`).
  assert.deepEqual({ ...now, atMm: was.atMm }, was, "перенос тронул у вещи не только место");
});

test("полоса (ломаная вещь) едет всеми вершинами, а нулевой сдвиг не правит ничего", () => {
  const base = scene();
  const strip = addSchemeObject(base.project, {
    schemeId: base.schemeId,
    catalogKey: "counter",
    shape: "polyline",
    pointsMm: [
      { x: 1000, y: 300 },
      { x: 2600, y: 300 },
    ],
    depthMm: 600,
    heightMm: 40,
    heightAboveFloorMm: 850,
  });
  const linked = setMarkObject(strip.project, base.mark.id, strip.schemeObject.id).project;
  const after = canvasMoveMarks(linked, [base.mark.id], { x: 0.1, y: 0.05 });
  assert.deepEqual(thingOf(after, strip.schemeObject.id).pointsMm, [
    { x: 2200, y: 700 },
    { x: 3800, y: 700 },
  ]);
  // Нулевой сдвиг — тот же объект по ссылке: `updatedAt` на пустом месте не
  // двигается (та же тишина, что у `setMarkObject` на прежней связи).
  assert.equal(moveSchemeObject(linked, strip.schemeObject.id, { x: 0, y: 0 }).project, linked);
});

test("без калибровки едут точки метки, а вещь стоит, и слова об этом не говорится", () => {
  // Решение таска: жест везёт того, чьё место видно. Моста нет — вещь на плане
  // не нарисована вовсе, знак стоит на своей точке, её и везёт рука. Отказ
  // здесь был бы неправдой: человек тащит то, что видит.
  const bare = linkedScene({ bridge: false });
  const was = thingOf(bare.project, bare.object.id);
  const after = canvasMoveMarks(bare.project, [bare.mark.id], { x: 0.1, y: 0.05 });
  assert.deepEqual(thingOf(after, bare.object.id), was, "вещь поехала без моста мм ↔ доли");
  const moved = findMark(after, bare.mark.id).points[0];
  assert.ok(Math.abs(moved.x - 0.2) < 1e-12 && Math.abs(moved.y - 0.15) < 1e-12, JSON.stringify(moved));
  // Связь при этом цела: везли точку, а не рвали пару.
  assert.equal(markPlaceHolder(after, findMark(after, bare.mark.id)).object, null);
  assert.equal(moveMarkPlace(bare.project, bare.mark.id, { x: 0.1, y: 0 }).moved, "mark");
});

test("линия и блок многих точек везут свои точки: форму провела рука", () => {
  const base = scene();
  // Блок «одна метка на блок» (ADR 004): две точки в одной метке.
  const single = updateType(base.project, base.typeId, { blockMode: "single" }).project;
  const grown = addToGroup(single, base.mark.id, "right", { step: 24 });
  const linked = setMarkObject(grown.project, base.mark.id, base.object.id).project;
  const host = findMark(linked, base.mark.id);
  assert.equal(host.points.length, 2, "пример не тот: блок не собрался одной меткой");
  // Резолвер не сводит нарисованную форму к середине вещи — значит и везутся
  // точки. Габарит, угол и высоту такая метка по-прежнему берёт у вещи.
  assert.equal(markPlaceHolder(linked, host).object, null);
  assert.equal(markPlace(linked, host).from, "object", "габарит перестал приходить от вещи");
  const after = canvasMoveMarks(linked, [base.mark.id], { x: 0.05, y: 0 });
  assert.deepEqual(thingOf(after, base.object.id).atMm, { x: 2000, y: 200 }, "вещь поехала за точками блока");
  findMark(after, base.mark.id).points.forEach((point, index) => {
    assert.ok(Math.abs(point.x - (host.points[index].x + 0.05)) < 1e-12, "точка блока уехала не на тот сдвиг");
  });
});

// ——— край плана держит знак (ремонт по ревью) ————————————————————————————
//
// Правило в сборке старше жеста: точка метки зажимается долями 0…1 (дефект
// D73), вставленная копия едет целиком, пока не войдёт в план (таск 222). До
// ремонта связанный прибор был единственным, кто из него вышел: метка без
// связи вставала у кромки, а вещь уезжала на три плана и пропадала с листа —
// в перечень неразмещённых она при этом не попадала, потому что точки метки
// целы.

test("сдвиг в три плана оставляет знак прибора на плане, как и точку метки", () => {
  const base = scene();
  const linked = linkedScene();
  // План 1200 × 800 точек по 100 точек в метре: прямоугольник 12 000 × 8 000 мм.
  const far = { x: 3, y: 3 };
  const free = canvasMoveMarks(base.project, [base.mark.id], far);
  assert.deepEqual(findMark(free, base.mark.id).points[0], { x: 1, y: 1 }, "метка без связи перестала зажиматься кромкой");

  const after = canvasMoveMarks(linked.project, [linked.mark.id], far);
  assert.deepEqual(thingOf(after, linked.object.id).atMm, { x: 12000, y: 8000 }, "вещь уехала за план");
  const shown = visibleMark(after, findMark(after, linked.mark.id));
  assert.deepEqual(shown.points[0], { x: 1, y: 1 }, "знак прибора ушёл с плана: " + JSON.stringify(shown.points[0]));

  // И в другую сторону — к нулю, а не в минус.
  const back = canvasMoveMarks(linked.project, [linked.mark.id], { x: -3, y: -3 });
  assert.deepEqual(thingOf(back, linked.object.id).atMm, { x: 0, y: 0 });
  assert.deepEqual(visibleMark(back, findMark(back, linked.mark.id)).points[0], { x: 0, y: 0 });
});

test("вещь, уже стоящая за планом, рывком внутрь не втягивается", () => {
  const linked = linkedScene();
  // Вещь начерчена за подложкой: в «Чертеже» так можно — он подложкой не
  // ограничен. Жест плана обязан её не дёргать.
  const out = updateSchemeObject(linked.project, linked.object.id, { atMm: { x: 15000, y: 200 } }).project;
  const away = canvasMoveMarks(out, [linked.mark.id], { x: 1, y: 0 });
  assert.deepEqual(thingOf(away, linked.object.id).atMm, { x: 15000, y: 200 }, "вещь за планом уехала ещё дальше");
  // А к плану она едет свободно: сдвиг на ширину плана (12 000 мм) доезжает
  // весь, потому что приезжает внутрь.
  const home = canvasMoveMarks(out, [linked.mark.id], { x: -1, y: 0 });
  assert.equal(thingOf(home, linked.object.id).atMm.x, 3000, "вещь к плану не поехала");
  // Длинный сдвиг к плану довозит её до дальнего края и не дальше.
  const across = canvasMoveMarks(out, [linked.mark.id], { x: -3, y: 0 });
  assert.equal(thingOf(across, linked.object.id).atMm.x, 0, "вещь проехала план насквозь");
});

test("зажим стоит у жеста плана, а не у вещи: «Чертёж» подложкой не ограничен", () => {
  const linked = linkedScene();
  // Ручной перенос вещи в мастерской идёт той же дверью `moveSchemeObject` —
  // и края плана не знает. Иначе стену и вещь нельзя было бы начертить за
  // подложкой, а чертят там обычно.
  const far = moveSchemeObject(linked.project, linked.object.id, { x: 40000, y: 0 }).project;
  assert.deepEqual(thingOf(far, linked.object.id).atMm, { x: 42000, y: 200 });
});

// ——— привязка, выбранная рукой, переживает резолвер (ремонт по ревью) ———————

test("стену, названную рукой, резолвер не отбирает — пересчитывается только отступ", () => {
  const base = scene();
  const wallId = base.project.walls[0].id;
  // Телевизор на тумбе в 800 мм от стены: автоматике он уже не настенный.
  const stand = updateSchemeObject(base.project, base.object.id, { atMm: { x: 3200, y: 800 } }).project;
  const linked = setMarkObject(stand, base.mark.id, base.object.id).project;
  assert.equal(markWall(findMark(applyMarkWalls(linked).project, base.mark.id)), null, "пример не тот: автопривязка уцелела");

  // Инженер назвал стену сам (G202) — и автоматика её не трогает.
  const byHand = setMarkWall(linked, base.mark.id, { wallId, atMm: 3200 }, { manual: true }).project;
  const kept = findMark(applyMarkWalls(byHand).project, base.mark.id);
  assert.deepEqual(markWall(kept), { wallId, atMm: 3200, toMm: null }, "рука инженера потеряна");

  // Отступ вдоль выбранной стены — следствие места прибора, и он едет за вещью.
  const slid = updateSchemeObject(byHand, base.object.id, { atMm: { x: 4500, y: 800 } }).project;
  assert.equal(markWall(findMark(applyMarkWalls(slid).project, base.mark.id)).atMm, 4500);
});

// ——— вещь ровно на оси стены (ремонт по ревью) ————————————————————————————
//
// Довод прежней шапки `markWallSide` («доли плана дробные, точное попадание на
// ось почти невозможно») держался ровно до связи: у прибора на вход приходит
// записанное целое число миллиметров, которое магнит сетки чертежа сажает на
// круглые значения. Ответ `null` уносил такой прибор с **обеих** развёрток.

function onAxis() {
  const base = scene();
  const room = addRoom(base.project, { name: "Комната" });
  // Контур лежит ниже стены (y = 0) и доходит до неё: «своя сторона» одна.
  const outline = addOutline(room.project, {
    schemeId: base.schemeId,
    roomId: room.room.id,
    points: [
      { x: 0, y: 0 },
      { x: 0.5, y: 0 },
      { x: 0.5, y: 0.4 },
      { x: 0, y: 0.4 },
    ],
  });
  // Вещь серединой ровно на оси стены: колонна, ниша, короб — обычное дело.
  const project = updateSchemeObject(outline.project, base.object.id, { atMm: { x: 2000, y: 0 } }).project;
  return { ...base, project: setMarkObject(project, base.mark.id, base.object.id).project, roomId: room.room.id };
}

test("прибор ровно на оси стены получает сторону, а не пропадает с обеих развёрток", () => {
  const made = onAxis();
  const bound = applyMarkWalls(applyRoomOutlines(made.project).project).project;
  const mark = findMark(bound, made.mark.id);
  const side = markWallSide(bound, mark);
  assert.ok(side === "left" || side === "right", "сторона снова null: прибор пропал с обеих развёрток");
  assert.equal(markOnWall(bound, mark), true, "прибор на стене перестал считаться настенным");
  // Ответ устойчив: второй зов даёт то же слово.
  assert.equal(markWallSide(bound, mark), side);
  // И на развёртке он виден — ровно на одной стороне.
  const wallId = bound.walls[0].id;
  const seen = ["left", "right"].filter((view) =>
    wallElevation(bound, wallId, view).marks.some((item) => item.id === made.mark.id),
  );
  assert.deepEqual(seen, [side], "прибор виден не на той стороне: " + JSON.stringify(seen));
});

test("ничью разнимает помещение: сторона с комнатой старше запасного «слева»", () => {
  const made = onAxis();
  const bound = applyMarkWalls(applyRoomOutlines(made.project).project).project;
  // Контур лежит под стеной, то есть со стороны «right» (левая нормаль
  // смотрит вверх, в сторону улицы). Туда прибор и уходит.
  assert.equal(markWallSide(bound, findMark(bound, made.mark.id)), "right");

  // Убрали контур — обе стороны стали равны, и ничья достаётся «слева».
  const bare = applyMarkWalls({ ...bound, outlines: [], marks: bound.marks.map((item) => ({ ...item, roomId: null })) }).project;
  assert.equal(markWallSide(bare, findMark(bare, made.mark.id)), "left");
});

// ——— блок ——————————————————————————————————————————————————————————————

test("блок со связанной меткой едет целиком: связанная везёт вещь, соседи — свои точки", () => {
  const linked = linkedScene();
  const grown = addToGroup(linked.project, linked.mark.id, "right", { step: 24 });
  const project = grown.project;
  const ids = canvasMoveIds(project, linked.mark.id, grown.group.id, false);
  assert.equal(ids.length, 2, "пример не тот: блок не собрался");
  const neighbour = ids.find((id) => id !== linked.mark.id);
  const wasNeighbour = findMark(project, neighbour).points[0];
  const wasOwn = findMark(project, linked.mark.id).points;

  const after = canvasMoveMarks(project, ids, { x: 0.1, y: 0.05 });
  // Связанная метка увезла вещь, своей точки не тронув.
  assert.deepEqual(thingOf(after, linked.object.id).atMm, { x: 3200, y: 600 });
  assert.deepEqual(findMark(after, linked.mark.id).points, wasOwn);
  // Сосед поехал на тот же сдвиг — блок не разъехался.
  const now = findMark(after, neighbour).points[0];
  assert.ok(Math.abs(now.x - (wasNeighbour.x + 0.1)) < 1e-12 && Math.abs(now.y - (wasNeighbour.y + 0.05)) < 1e-12, JSON.stringify(now));
  // Группа цела: переехали только координаты.
  assert.deepEqual(after.groups, project.groups);

  // Соседа поодиночке по-прежнему возят с Ctrl, и вещь при этом стоит.
  const solo = canvasMoveMarks(project, canvasMoveIds(project, neighbour, grown.group.id, true), { x: 0.1, y: 0 });
  assert.deepEqual(thingOf(solo, linked.object.id).atMm, { x: 2000, y: 200 });
});

// ——— привязка к стене и помещение — следствие места ———————————————————————

test("привязка метки к стене и её помещение едут за вещью", () => {
  const linked = linkedScene();
  // Стена вдоль y = 0, вещь в 200 мм от её оси, записанная точка метки — в 800
  // мм (дальше порога 600). Привязку обязана дать вещь: знак нарисован на ней.
  const bound = applyMarkWalls(linked.project).project;
  const wallId = linked.project.walls[0].id;
  assert.deepEqual(markWall(findMark(bound, linked.mark.id)), { wallId, atMm: 2000, toMm: null });

  // Увезли знак — поехала и привязка: план и развёртка показывают один прибор
  // в одном месте. Прежде привязка оставалась на прежнем метре стены.
  const moved = applyMarkWalls(canvasMoveMarks(bound, [linked.mark.id], { x: 0.1, y: 0 })).project;
  assert.equal(markWall(findMark(moved, linked.mark.id)).atMm, 3200);

  // Помещение — такое же следствие места. Контур обведён вокруг вещи, а не
  // вокруг записанной точки метки.
  const room = addRoom(linked.project, { name: "Гостиная" });
  const outline = addOutline(room.project, {
    schemeId: linked.schemeId,
    roomId: room.room.id,
    points: [
      { x: 150 / WIDTH, y: 0 },
      { x: 250 / WIDTH, y: 0 },
      { x: 250 / WIDTH, y: 100 / HEIGHT },
      { x: 150 / WIDTH, y: 100 / HEIGHT },
    ],
  });
  const inRoom = applyRoomOutlines(outline.project).project;
  assert.equal(findMark(inRoom, linked.mark.id).roomId, room.room.id, "помещение взято у записанной точки");
});

test("G68: у объекта без связей обе автоматики возвращают тот же объект по ссылке", () => {
  const free = scene();
  assert.equal(applyRoomOutlines(free.project).project, free.project);
  // Метка стоит дальше порога от стены, привязки нет и не заводится.
  assert.equal(applyMarkWalls(free.project).project, free.project);

  // И на настоящем объекте прежней разметки: у каждой метки на вход автоматик
  // приходит **тот же массив точек** по ссылке, что приходил до правки, —
  // значит и привязка со помещением считаются ровно из тех же чисел. Это и
  // есть вся гарантия G68 для этой правки: вход автоматик меняется только там,
  // где у метки есть связь, а у прежней разметки её нет ни у одной.
  const legacy = JSON.parse(
    readFileSync(join(dirname(fileURLToPath(import.meta.url)), "legacy-project.json"), "utf8"),
  );
  const opened = projectsMigrateStored(legacy);
  assert.ok(opened.marks.length > 0, "фикстура без меток — проверять нечего");
  for (const mark of opened.marks) {
    assert.equal(markPlaceHolder(opened, mark).points, mark.points, "вход автоматик у метки прежней разметки сменился");
  }
});

// ——— ярлык шага и один шаг на жест ————————————————————————————————————————

test("ярлык шага называет, что вернёт Ctrl+Z: прибор, блок или метку", () => {
  const linked = linkedScene();
  const drag = (patch) => ({ kind: "mark", markId: linked.mark.id, moving: [linked.mark.id], ...patch });
  assert.equal(canvasMoveStepLabel(linked.project, drag()), strings.history.moveDevice);
  // Метка без связи — прежнее слово до буквы (G68: список отмены не меняется).
  const free = scene();
  assert.equal(
    canvasMoveStepLabel(free.project, { kind: "mark", markId: free.mark.id, moving: [free.mark.id] }),
    strings.history.move,
  );
  // Блок назван блоком: что в нём поехало, в списке отмены разбирать нечего.
  assert.equal(canvasMoveStepLabel(linked.project, drag({ moving: [linked.mark.id, "other"] })), strings.history.moveBlock);
  // Подпись и точка комментария — прежние ярлыки.
  assert.equal(canvasMoveStepLabel(linked.project, drag({ kind: "label" })), strings.history.moveLabel);
  assert.equal(canvasMoveStepLabel(linked.project, drag({ commentPoint: true })), strings.history.moveCommentPoint);
});

const SOURCE = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "src", "canvas.js"), "utf8");
const withoutComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, "");
const bodyOf = (name) => {
  const rest = SOURCE.slice(SOURCE.indexOf(name));
  return withoutComments(rest.slice(0, rest.indexOf("\nfunction ")));
};

test("жест пишет в историю один раз, и объект правит только модель", () => {
  // Один жест человека — один Ctrl+Z, и он возвращает и вещь, и соседей по
  // блоку: «после» собирается одним проходом, в историю уходит одним вызовом.
  const branch = bodyOf("function canvasPointerUp(");
  const inner = branch.slice(branch.indexOf('drag.kind === "mark" || drag.kind === "label"'));
  assert.equal(inner.slice(0, inner.indexOf("}")).split("canvasCommit(").length - 1, 1, "перенос пишет в историю дважды");
  // Своего мутатора у холста нет: правит дверь модели.
  const move = bodyOf("export function canvasMoveMarks(");
  assert.ok(move.includes("moveMarkPlace("), "перенос перестал ходить в модель");
  assert.ok(!move.includes("updateSchemeObject("), "холст правит вещь сам, мимо модели");
  // Притяжка считается по знаку, каким его видно: иначе вещь встала бы мимо
  // направляющей на то расстояние, на которое записанная точка от знака отстала.
  assert.ok(bodyOf("function canvasDragTo(").includes("markPlaceHolder(before, mark)"), "притяжка вернулась к записанной точке");
});

test("в просмотре и при запущенном доме жеста нет", () => {
  const linked = linkedScene();
  const after = canvasMoveMarks(linked.project, [linked.mark.id], { x: 0.1, y: 0 });
  const viewing = { project: linked.project, layout: "mobile", mode: "select", selectedMarkIds: [] };
  const running = { project: linked.project, layout: "desktop", mode: "select", selectedMarkIds: [], simRunning: true, screen: "scheme" };
  assert.equal(canvasEditAllowed(viewing), false);
  assert.equal(canvasEditAllowed(running), false);
  // Перенос вещи — правка разметки, а не сценария: последняя дверь его не
  // пускает ни в просмотре, ни при идущем доме.
  assert.equal(canvasCommitAllowed(viewing, linked.project, after), false);
  assert.equal(canvasCommitAllowed(running, linked.project, after), false);
  // И до двери дело не доходит: нажатие на метку без права правки уходит в
  // панораму, а не в перенос.
  const down = bodyOf("function canvasPointerDown(");
  assert.ok(down.includes("if (!editable) {"), "нажатие по метке больше не спрашивает право правки");
});
