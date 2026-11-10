// Магнит «от угла до угла» (таск 266, G386).
//
// Ответ заказчика на открытый вопрос таска 237 — «делаем». Проверяется пять
// вещей, и первые две главные:
//
// 1. **Мера одна на оба занятия.** И линейка, и рисование стен спрашивают одну
//    дверь `render.snapToCorners`; у чертежа и у плана своих порогов нет.
// 2. **Порядок притяжек такой, как написан в шапках:** угол, узел сетки,
//    направляющая, ровный угол. Угол занимает обе оси, поэтому, поймав его,
//    остальные молчат.
// 3. **Что считается углом** — тот же узел, что носит букву (`wallCorners`):
//    концы цепочки, стыки и торец упёртой перегородки. Перекрестие двух стен,
//    прошедших одна сквозь другую, углом не считается — буквы у него нет.
// 4. **Радиус в точках экрана, а не в миллиметрах:** на мелком масштабе
//    дальний угол не ловится, на крупном ловится тот же самый.
// 5. **Alt снимает** тем же `free`, которым снимает сетку и направляющие, а в
//    объект магнит не пишет ничего (G68).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  addScheme,
  addWall,
  createProject,
  findScheme,
  planMmToFraction,
  setPlanOrigin,
  setPlanScale,
  wallCornerTargets,
  wallsOnScheme,
} from "../src/model.js";
import { GUIDE_CROSS_PX, draftSnap, snapToCorners } from "../src/render.js";
import {
  WORKSHOP_CORNER_DRAGS,
  WORKSHOP_UNIT,
  workshopDragSkipWallIds,
  workshopHint,
  workshopMoveAnchorMm,
  workshopMoveDeltaMm,
  workshopMoveVertex,
  workshopSnapMm,
} from "../src/panels/workshop.js";
import { strings } from "../src/strings.js";
import { canvasCornerTargets, canvasDraftAims, canvasDraftPoint, canvasHintText } from "../src/canvas.js";
// Магнит в «Объёме» (таск 283): сцена из стенда, обратная проекция и сам
// магнит. Мерка расстояния — та же, что у линейки, своей здесь не заводится.
import { volumeScene, volumeScreenAt, volumeSurfaceAt, volumeSurfaceCorner, volumeSurfaceHolds } from "../src/volume.js";
import { measureSpan } from "../src/measure.js";
import { benchFlat } from "../tools/bench/scenes.mjs";

const viewOf = (patch) => ({ zoom: 1, offsetX: 0, offsetY: 0, markSize: 10, labelSize: 12, ...patch });

// Комната 4000 × 3000 от нуля — та же, что в тестах имён стен.
const ROOM = [
  [{ x: 0, y: 0 }, { x: 4000, y: 0 }],
  [{ x: 4000, y: 0 }, { x: 4000, y: 3000 }],
  [{ x: 4000, y: 3000 }, { x: 0, y: 3000 }],
  [{ x: 0, y: 3000 }, { x: 0, y: 0 }],
];

// План 1200 × 800 точек, в метре ровно 100 точек: миллиметр чертежа — одна
// десятая точки плана, и доли считает тот же мост, которым их считает чертёж.
function planScene() {
  const added = addScheme(createProject(), { name: "1 этаж", imageId: "plan-1", width: 1200, height: 800 });
  let project = setPlanScale(added.project, added.scheme.id, {
    a: { x: 0.1, y: 0.5 },
    b: { x: 0.6, y: 0.5 },
    meters: 6,
  }).project;
  project = setPlanOrigin(project, added.scheme.id, { at: { x: 0.2, y: 0.2 }, turn: 0 }).project;
  return { project, schemeId: added.scheme.id };
}

function bareScene() {
  const added = addScheme(createProject(), { name: "1 этаж" });
  return { project: added.project, schemeId: added.scheme.id };
}

function withWalls(scene, segments, thicknessMm = 200) {
  let project = scene.project;
  const wallIds = [];
  for (const [aMm, bMm] of segments) {
    const added = addWall(project, { schemeId: scene.schemeId, aMm, bMm, thicknessMm });
    project = added.project;
    wallIds.push(added.wall.id);
  }
  return { ...scene, project, wallIds };
}

const cornersMm = (scene, options) => wallCornerTargets(scene.project, scene.schemeId, options);
const at = (x, y) => ({ x, y });

// ——— что считается углом ——————————————————————————————————————————————

test("угол магнита — тот же узел, что носит букву", () => {
  const scene = withWalls(bareScene(), ROOM);
  const corners = cornersMm(scene);
  assert.deepEqual(
    corners.map((corner) => [corner.letter, corner.x, corner.y]),
    [
      ["А", 0, 0],
      ["Б", 4000, 0],
      ["В", 4000, 3000],
      ["Г", 0, 3000],
    ],
    "четыре стены сошлись в четырёх углах, и порядок — порядок букв",
  );
  assert.equal(cornersMm(bareScene()).length, 0, "стен нет — углов нет, и магниту не за что держаться");
});

test("торец упёртой перегородки — угол, перекрестие двух стен — нет", () => {
  // Перегородка приходит в середину верхней стены: её конец — свой узел, и
  // буква у него своя.
  const tee = withWalls(bareScene(), [...ROOM, [{ x: 2000, y: 0 }, { x: 2000, y: 1500 }]]);
  const ends = cornersMm(tee).map((corner) => corner.x + ":" + corner.y);
  assert.ok(ends.includes("2000:0"), "конец перегородки на грани чужой стены — угол");
  assert.ok(ends.includes("2000:1500"), "свободный конец перегородки — тоже угол");
  // Две стены, прошедшие одна сквозь другую: концов в точке (2000, 1500) нет
  // ни у одной, буквы там нет, и магнит её не придумывает.
  const cross = withWalls(bareScene(), [
    [{ x: 2000, y: 0 }, { x: 2000, y: 3000 }],
    [{ x: 0, y: 1500 }, { x: 4000, y: 1500 }],
  ]);
  assert.equal(
    cornersMm(cross).some((corner) => corner.x === 2000 && corner.y === 1500),
    false,
    "перекрестие углом не считается: на чертеже оно не нарисовано кружком",
  );
  assert.equal(cornersMm(cross).length, 4, "у двух стен четыре конца, и все четыре — углы");
});

test("свои углы названных стен магниту не отдаются", () => {
  const scene = withWalls(bareScene(), ROOM);
  const own = cornersMm(scene, { skipWallIds: [scene.wallIds[0]] });
  // Первая стена — АБ: её концы (0, 0) и (4000, 0) держат ещё и соседки,
  // поэтому убираются целиком — иначе вершину тянуло бы к собственной стене.
  assert.deepEqual(
    own.map((corner) => corner.letter),
    ["В", "Г"],
    "остались углы, за которые эта стена не держится",
  );
  // Список, а не одно имя (таск 271): в узле цепочки с рукой едет не одна
  // стена, и каждая уходит из целей целиком.
  assert.deepEqual(
    cornersMm(scene, { skipWallIds: [scene.wallIds[0], scene.wallIds[1]] }).map((corner) => corner.letter),
    ["Г"],
  );
  // Пустой список и мусор фильтром не считаются: цели остаются все.
  for (const options of [{}, { skipWallIds: [] }, { skipWallIds: [null] }, { skipWallIds: "АБ" }]) {
    assert.equal(cornersMm(scene, options).length, 4, JSON.stringify(options));
  }
});

// ——— мера одна, и она в точках экрана ————————————————————————————————

test("ловит ближайший угол и только в своём радиусе", () => {
  const corners = [at(0, 0), at(1000, 0)];
  const view = viewOf({ zoom: 1 });
  // Зум 1: миллиметр — точка экрана, и радиус читается числом.
  const inside = snapToCorners(corners, at(8, 5), WORKSHOP_UNIT, view);
  assert.deepEqual(inside.point, { x: 0, y: 0 }, "в радиусе — точка садится в угол");
  assert.equal(inside.corner.x, 0);
  const outside = snapToCorners(corners, at(40, 40), WORKSHOP_UNIT, view);
  assert.deepEqual(outside.point, { x: 40, y: 40 }, "дальше радиуса магнита нет");
  assert.equal(outside.corner, null);
  // Между двумя углами берётся ближний.
  const near = snapToCorners([at(0, 0), at(10, 0)], at(9, 0), WORKSHOP_UNIT, view);
  assert.equal(near.corner.x, 10);
  // Ровно на пороге — ещё ловит, на волос дальше — уже нет.
  assert.ok(snapToCorners(corners, at(GUIDE_CROSS_PX, 0), WORKSHOP_UNIT, view).corner);
  assert.equal(snapToCorners(corners, at(GUIDE_CROSS_PX + 0.5, 0), WORKSHOP_UNIT, view).corner, null);
});

test("радиус считается по экрану: мелкий масштаб дальний угол не ловит", () => {
  const corners = [at(0, 0)];
  // Сто миллиметров от угла. При зуме 1 это 100 точек экрана — мимо; при
  // зуме 0,1 те же сто миллиметров дают 10 точек — попадание.
  const far = at(100, 0);
  assert.equal(snapToCorners(corners, far, WORKSHOP_UNIT, viewOf({ zoom: 1 })).corner, null);
  assert.ok(
    snapToCorners(corners, far, WORKSHOP_UNIT, viewOf({ zoom: 0.1 })).corner,
    "на мелком масштабе те же сто миллиметров лежат под рукой",
  );
  // И наоборот: на крупном масштабе магнит не хватает соседний угол в метре.
  assert.equal(snapToCorners([at(0, 0)], at(1000, 0), WORKSHOP_UNIT, viewOf({ zoom: 4 })).corner, null);
});

test("Alt снимает магнит, а пустой список и нулевой порог его выключают", () => {
  const view = viewOf({ zoom: 1 });
  assert.equal(snapToCorners([at(0, 0)], at(3, 3), WORKSHOP_UNIT, view, { free: true }).corner, null);
  assert.deepEqual(
    snapToCorners([at(0, 0)], at(3, 3), WORKSHOP_UNIT, view, { free: true }).point,
    { x: 3, y: 3 },
    "с Alt точка остаётся там, куда её довела рука",
  );
  assert.equal(snapToCorners([], at(0, 0), WORKSHOP_UNIT, view).corner, null);
  assert.equal(snapToCorners([at(0, 0)], at(3, 3), WORKSHOP_UNIT, view, { corner: 0 }).corner, null);
});

// ——— линейка и рисование: одна дверь ——————————————————————————————————

test("конец отрезка линейки на плане липнет к углу стены", () => {
  const scene = withWalls(planScene(), ROOM);
  const scheme = findScheme(scene.project, scene.schemeId);
  const view = viewOf({ zoom: 1 });
  const corners = canvasCornerTargets({ project: scene.project, drawingShown: true }, scheme);
  assert.equal(corners.length, 4, "углы чертежа видны и на плане — слой включён");
  const corner = corners[2];
  // Промах рукой: три точки экрана мимо угла. План 1200 × 800, зум 1 — доля
  // переводится в точки экрана тем же `planToScreen`.
  const miss = { x: corner.x + 3 / 1200, y: corner.y - 2 / 800 };
  const snap = draftSnap([], miss, scheme, view, { corners });
  assert.deepEqual(snap.point, { x: corner.x, y: corner.y }, "конец сел ровно в угол");
  assert.equal(snap.corner.letter, "В", "пойманный угол назван — по нему рисуется кольцо");
  // Второй конец идёт той же дверью, и цепочка магнита ему не мешает.
  const second = draftSnap([{ x: corners[0].x, y: corners[0].y }], miss, scheme, view, { corners });
  assert.deepEqual(second.point, { x: corner.x, y: corner.y });
  assert.equal(second.corner.letter, "В");
  // Мерка «от угла до угла» повторяема: оба конца — ровно углы чертежа, а не
  // доли под рукой, значит и число между ними каждый раз одно.
  const start = draftSnap([], { x: corners[0].x - 2 / 1200, y: corners[0].y + 1 / 800 }, scheme, view, { corners });
  assert.deepEqual(start.point, { x: corners[0].x, y: corners[0].y });
  assert.equal(start.corner.letter, "А");
});

test("вершина рисуемой стены липнет к углу — и угол старше узла сетки", () => {
  const scene = withWalls(bareScene(), ROOM);
  const corners = cornersMm(scene);
  const view = viewOf({ zoom: 1 });
  const options = { gridMm: 500, gridSnap: true, corners };
  // Угол (4000, 3000) в узел сетки 500 мм попадает, поэтому проверяется угол
  // (4000, 0) рядом с узлом и промах к углу, который узлом не является.
  const tilted = withWalls(bareScene(), [[{ x: 0, y: 0 }, { x: 1230, y: 870 }]]);
  const odd = cornersMm(tilted).find((corner) => corner.x === 1230);
  const snap = workshopSnapMm([], at(odd.x + 4, odd.y - 3), view, { ...options, corners: cornersMm(tilted) });
  assert.deepEqual(snap.point, { x: 1230, y: 870 }, "вершина села в угол, а не в узел сетки 1000/1000");
  assert.equal(snap.grid, false, "сетка молчит: угол занял обе оси");
  assert.ok(snap.corner, "пойманный угол назван — по нему рисуется кольцо");
  // Тот же жест без углов — прежний узел сетки: старое поведение цело.
  const grid = workshopSnapMm([], at(odd.x + 4, odd.y - 3), view, { gridMm: 500, gridSnap: true });
  assert.deepEqual(grid.point, { x: 1000, y: 1000 });
  assert.equal(grid.grid, true);
  assert.equal(grid.corner, null);
  // Alt — миллиметр под курсором, и ни угла, ни узла.
  const free = workshopSnapMm([], at(odd.x + 4, odd.y - 3), view, { ...options, corners: cornersMm(tilted), free: true });
  assert.deepEqual(free.point, { x: 1234, y: 867 });
  assert.equal(free.corner, null);
  // Стена от угла существующей: первая вершина в углу, вторая тоже.
  const first = workshopSnapMm([], at(corners[0].x + 5, corners[0].y + 5), view, options);
  const second = workshopSnapMm([first.point], at(corners[3].x - 6, corners[3].y + 2), view, options);
  assert.deepEqual([first.point, second.point], [{ x: 0, y: 0 }, { x: 0, y: 3000 }]);
});

test("пойманный угол перебивает направляющую, направление и подсказку «ровно»", () => {
  const scene = withWalls(planScene(), ROOM);
  const scheme = findScheme(scene.project, scene.schemeId);
  const view = viewOf({ zoom: 1 });
  const corners = canvasCornerTargets({ project: scene.project, drawingShown: true }, scheme);
  const corner = corners[1];
  // Направляющая человека — через точку чуть выше угла: порог перекрестия она
  // перекрывает, и без магнита точка села бы на неё.
  const guides = [{ id: "g1", axis: "h", at: corner.y - 2 / 800 }];
  const miss = { x: corner.x + 2 / 1200, y: corner.y - 3 / 800 };
  const onGuide = draftSnap([], miss, scheme, view, { planGuides: guides });
  assert.equal(onGuide.point.y, guides[0].at, "без магнита направляющая держит ось — правило таска 262 цело");
  const snap = draftSnap([], miss, scheme, view, { planGuides: guides, corners });
  assert.deepEqual(snap.point, { x: corner.x, y: corner.y }, "угол занял обе оси, и направляющая молчит");
  assert.equal(snap.held.h, null, "подсвечивать направляющую, которая не сработала, нельзя");
  assert.deepEqual(snap.guides, [], "направляющих по вершинам у пойманного угла тоже нет");
  // Направление кратно 15° у пойманного угла не обещается: точка уже точная —
  // тем же приёмом молчит узел сетки чертежа.
  const slanted = draftSnap([{ x: corners[0].x, y: corners[0].y + 0.01 }], miss, scheme, view, { corners });
  assert.deepEqual(slanted.point, { x: corner.x, y: corner.y });
  assert.equal(slanted.snapped, false);
});

// ——— поле отдаёт углы только там, где они видны ————————————————————————

test("выключенный слой чертежа и некалиброванный план углов не дают", () => {
  const scene = withWalls(planScene(), ROOM);
  const scheme = findScheme(scene.project, scene.schemeId);
  assert.equal(canvasCornerTargets({ project: scene.project, drawingShown: false }, scheme).length, 0);
  assert.equal(canvasCornerTargets({ project: scene.project }, scheme).length, 4, "умолчание — слой показан");
  // Углы на плане стоят ровно там, куда их кладёт мост модели: своего счёта у
  // магнита нет.
  const corners = canvasCornerTargets({ project: scene.project, drawingShown: true }, scheme);
  for (const corner of corners) {
    const mm = wallCornerTargets(scene.project, scene.schemeId).find((item) => item.letter === corner.letter);
    assert.deepEqual(corner, { ...planMmToFraction(scene.project, scene.schemeId, mm), letter: corner.letter });
  }
  // Без привязки миллиметра на плане не существует, и целей у магнита нет.
  const noOrigin = withWalls(
    (() => {
      const added = addScheme(createProject(), { name: "без привязки", imageId: "p", width: 1000, height: 1000 });
      const project = setPlanScale(added.project, added.scheme.id, {
        a: { x: 0.1, y: 0.5 },
        b: { x: 0.6, y: 0.5 },
        meters: 6,
      }).project;
      return { project, schemeId: added.scheme.id };
    })(),
    ROOM,
  );
  assert.equal(
    canvasCornerTargets({ project: noOrigin.project, drawingShown: true }, findScheme(noOrigin.project, noOrigin.schemeId))
      .length,
    0,
  );
  assert.equal(canvasCornerTargets(null, scheme).length, 0);
  assert.equal(canvasCornerTargets({ project: scene.project }, null).length, 0);
});

test("подсказки называют новый магнит — правило таска 213", () => {
  // Занятия, где точку ставят рукой, получают строку о магните; проём и
  // «Выделение» — нет: там его нет и самого.
  // «Выделение» получило ту же строку с таска 271: вершину, стену и вещь под
  // рукой магнит ловит, и умолчать об этом нельзя. Своих слов для этого не
  // заведено — правило у магнита одно, и строка остаётся одна.
  for (const tool of ["walls", "objects", "edit"]) {
    assert.ok(workshopHint(tool, "rect").includes(strings.workshop.hintCorner), tool);
  }
  assert.equal(
    workshopHint("openings", "rect").includes(strings.workshop.hintCorner),
    false,
    "проём садится серединой в стену под курсором — угла ему не надо",
  );
  // У линейки про магнит сказано своими словами — и в обоих полях.
  assert.ok(strings.measure.hintPlan.includes("угол чертежа"));
  assert.ok(strings.measure.hintDrawing.includes("угол чертежа"));
  assert.equal(workshopHint("walls", "rect", true).includes(strings.workshop.hintCorner), false, "линейка не повторяет дважды");
  assert.ok(workshopHint("walls", "rect", true).includes(strings.measure.hintDrawing));
  // Alt назван там же, где магнит: второй клавиши «без притяжки» не заведено.
  assert.ok(strings.workshop.hintCorner.includes("Alt"));
  assert.ok(strings.workshop.anchorPickHint.includes("углу чертежа"));
});

test("магнит ничего не пишет в объект (G68)", () => {
  const scene = withWalls(planScene(), ROOM);
  const scheme = findScheme(scene.project, scene.schemeId);
  const before = JSON.stringify(scene.project);
  const corners = canvasCornerTargets({ project: scene.project, drawingShown: true }, scheme);
  const view = viewOf({ zoom: 1 });
  for (const corner of corners) {
    draftSnap([], { x: corner.x + 0.001, y: corner.y }, scheme, view, { corners });
    workshopSnapMm([], at(corner.x, corner.y), view, { corners: cornersMm(scene), gridMm: 500, gridSnap: true });
  }
  assert.equal(JSON.stringify(scene.project), before, "притяжка — про руку, в объекте от неё ни одного знака");
});

// ——— магнит у того, что ведут рукой (таск 271, долг таска 266) ——————————
//
// Жест правки шёл мимо разрешителя притяжки: вершину стены тянули, стену и вещь
// переносили — и ни одна из них угла не ловила. Проверяется три вещи:
//
// 1. **Едущая стена своего угла не ловит.** Иначе вершина стояла бы приклеенной
//    к месту, с которого её повели, а дальний конец схлопнул бы стену в точку.
//    Кто едет — одна дверь `workshopDragSkipWallIds`, и у вершины это **все**
//    стены узла, те же, что переставит `workshopMoveVertex`.
// 2. **Липнет опора переноса** — та же точка, которой взятое садится на узел
//    сетки (дефект D40) и которой вещь встаёт по клику. Второго правила в этом
//    жесте нет.
// 3. **Прежние притяжки целы:** угла рядом нет — прежний узел сетки, Alt —
//    миллиметр под курсором.

// Одинокая стена не в узлах сетки: по ней видно, что сработал угол, а не сетка.
const LOOSE = [{ x: 1230, y: 870 }, { x: 1230, y: 1870 }];

function dragScene() {
  const scene = withWalls(bareScene(), [...ROOM, LOOSE]);
  return { ...scene, looseId: scene.wallIds[4] };
}

test("кто едет с рукой, тот своих углов магниту не отдаёт", () => {
  const scene = dragScene();
  const walls = wallsOnScheme(scene.project, scene.schemeId);
  // Одинокая стена: едет она одна.
  assert.deepEqual(
    workshopDragSkipWallIds(walls, { kind: "vertex", wallId: scene.looseId, fromMm: at(1230, 870) }),
    [scene.looseId],
  );
  // Узел цепочки: едут **все** стены, чей конец в нём стоит — ровно те, что
  // переставит `workshopMoveVertex`.
  const node = at(4000, 0);
  const riding = workshopDragSkipWallIds(walls, { kind: "vertex", wallId: scene.wallIds[0], fromMm: node });
  assert.deepEqual(riding.slice().sort(), [scene.wallIds[0], scene.wallIds[1]].slice().sort());
  assert.equal(workshopMoveVertex(scene.project, scene.schemeId, node, at(3900, 100)).moved, riding.length);
  // Перенос стены — она сама; вещь не стена, и углы чертежа ей все чужие.
  assert.deepEqual(workshopDragSkipWallIds(walls, { kind: "wall", wallId: scene.looseId }), [scene.looseId]);
  assert.deepEqual(workshopDragSkipWallIds(walls, { kind: "object", id: "вещь" }), []);
  // Кого магнит не касается вовсе — назван списком, а не веткой по месту.
  assert.deepEqual(WORKSHOP_CORNER_DRAGS, ["vertex", "wall", "object"]);
  for (const kind of ["opening", "objectHandle"]) {
    assert.equal(WORKSHOP_CORNER_DRAGS.includes(kind), false, kind);
    assert.deepEqual(workshopDragSkipWallIds(walls, { kind, wallId: scene.looseId, fromMm: at(1230, 870) }), []);
  }
  assert.deepEqual(workshopDragSkipWallIds(walls, null), []);
  assert.deepEqual(workshopDragSkipWallIds(walls, { kind: "vertex", wallId: scene.looseId }), []);
});

test("ведомая вершина садится в угол соседней стены", () => {
  const scene = dragScene();
  const walls = wallsOnScheme(scene.project, scene.schemeId);
  const view = viewOf({ zoom: 1 });
  const drag = { kind: "vertex", wallId: scene.looseId, fromMm: at(1230, 870) };
  const corners = cornersMm(scene, { skipWallIds: workshopDragSkipWallIds(walls, drag) });
  const options = { gridMm: 500, gridSnap: true, corners };
  // Опора направления (кратно 15°) — второй конец своей стены: тот же список,
  // что собирает `vertexAnchor` в поле.
  const anchor = [at(1230, 1870)];
  // Рука в пяти миллиметрах от угла «А»: на зуме 1 это пять точек экрана.
  const snap = workshopSnapMm(anchor, at(5, 4), view, options);
  assert.deepEqual(snap.point, { x: 0, y: 0 }, "вершина села в угол соседней стены");
  assert.equal(snap.corner.letter, "А", "пойманный угол назван — по нему рисуется кольцо");
  assert.equal(snap.grid, false, "узел сетки молчит: угол занял обе оси");
  // Прежние притяжки целы: угла рядом нет — прежний узел сетки.
  const grid = workshopSnapMm(anchor, at(1004, 1003), view, options);
  assert.deepEqual(grid.point, { x: 1000, y: 1000 });
  assert.equal(grid.grid, true);
  assert.equal(grid.corner, null);
  // Alt — миллиметр под курсором, и ни угла, ни узла.
  const free = workshopSnapMm(anchor, at(5, 4), view, { ...options, free: true });
  assert.deepEqual(free.point, { x: 5, y: 4 });
  assert.equal(free.corner, null);
});

test("свой угол в цели не идёт, и стена сама в себя не схлопывается", () => {
  const scene = dragScene();
  const walls = wallsOnScheme(scene.project, scene.schemeId);
  const view = viewOf({ zoom: 1 });
  const drag = { kind: "vertex", wallId: scene.looseId, fromMm: at(1230, 870) };
  const options = { gridMm: 500, gridSnap: true };
  // Без фильтра рука в четырёх миллиметрах от **своего** угла возвращает его
  // же: вершина стояла бы приклеенной к месту, с которого её повели.
  const stuck = workshopSnapMm([], at(1234, 867), view, { ...options, corners: cornersMm(scene) });
  assert.deepEqual(stuck.point, { x: 1230, y: 870 }, "так выглядел бы магнит без фильтра");
  // С фильтром тот же ход руки даёт прежний узел сетки.
  const corners = cornersMm(scene, { skipWallIds: workshopDragSkipWallIds(walls, drag) });
  const loose = workshopSnapMm([], at(1234, 867), view, { ...options, corners });
  assert.deepEqual(loose.point, { x: 1000, y: 1000 });
  assert.equal(loose.corner, null);
  // И ни одна цель, оставшаяся у ведомого узла цепочки, не делает едущую стену
  // точкой: длина у всех едущих остаётся положительной.
  const node = at(4000, 0);
  const chain = { kind: "vertex", wallId: scene.wallIds[0], fromMm: node };
  const riding = workshopDragSkipWallIds(walls, chain);
  assert.equal(riding.length, 2, "в узле «Б» едут две стены, и обе из целей выходят");
  const targets = cornersMm(scene, { skipWallIds: riding });
  assert.deepEqual(
    targets.map((corner) => corner.letter),
    ["Г", "Д", "Е"],
    "у ведомого узла «Б» остаются дальний угол комнаты и концы стены, которая стоит на месте",
  );
  for (const target of targets) {
    const moved = workshopMoveVertex(scene.project, scene.schemeId, node, at(target.x, target.y)).project;
    for (const wall of wallsOnScheme(moved, scene.schemeId)) {
      assert.ok(
        wall.aMm.x !== wall.bMm.x || wall.aMm.y !== wall.bMm.y,
        "угол «" + target.letter + "» схлопнул стену в точку",
      );
    }
  }
});

test("перенос ловит угол опорой — той же, которой садится на узел сетки", () => {
  const scene = dragScene();
  const walls = wallsOnScheme(scene.project, scene.schemeId);
  const view = viewOf({ zoom: 1 });
  const wall = walls.find((item) => item.id === scene.looseId);
  const anchor = workshopMoveAnchorMm(wall);
  assert.deepEqual(anchor, { x: 1230, y: 870 }, "опора стены — её первая вершина");
  const drag = { kind: "wall", wallId: scene.looseId };
  const corners = cornersMm(scene, { skipWallIds: workshopDragSkipWallIds(walls, drag) });
  const options = { gridMm: 500, gridSnap: true, corners };
  // Ход руки такой, что опора приходит в пяти точках от угла «В» (4000, 3000).
  const press = at(2000, 2000);
  const cursor = at(press.x + (4005 - anchor.x), press.y + (2996 - anchor.y));
  const snap = workshopMoveDeltaMm(anchor, press, cursor, view, options);
  assert.deepEqual(snap.deltaMm, { x: 2770, y: 2130 });
  assert.equal(snap.corner.letter, "В");
  assert.deepEqual(
    { x: anchor.x + snap.deltaMm.x, y: anchor.y + snap.deltaMm.y },
    { x: 4000, y: 3000 },
    "опора села ровно в угол, а не рядом с ним",
  );
  // Своих углов везомая стена не ловит: без фильтра она прилипала бы к месту,
  // с которого её повезли.
  const near = at(press.x + 4, press.y - 3);
  assert.deepEqual(workshopMoveDeltaMm(anchor, press, near, view, { ...options, corners: cornersMm(scene) }).deltaMm, {
    x: 0,
    y: 0,
  });
  assert.deepEqual(workshopMoveDeltaMm(anchor, press, near, view, options).deltaMm, { x: -230, y: 130 });
  // Alt — чистый ход руки: ни угла, ни узла.
  const free = workshopMoveDeltaMm(anchor, press, cursor, view, { ...options, free: true });
  assert.deepEqual(free.deltaMm, { x: 2775, y: 2126 });
  assert.equal(free.corner, null);
});

test("вещь переносом встаёт в угол тем же местом, которым её кладёт клик", () => {
  const scene = dragScene();
  const walls = wallsOnScheme(scene.project, scene.schemeId);
  const view = viewOf({ zoom: 1 });
  const object = { shape: "rect", atMm: { x: 1230, y: 870 }, widthMm: 600, depthMm: 400, turnDeg: 0 };
  const anchor = workshopMoveAnchorMm(object);
  assert.deepEqual(anchor, { x: 1230, y: 870 }, "опора прямоугольника — его середина (дефект D40)");
  // Вещь не стена: из целей не уходит ни один угол.
  const corners = cornersMm(scene, { skipWallIds: workshopDragSkipWallIds(walls, { kind: "object", id: "вещь" }) });
  assert.equal(corners.length, 6, "четыре угла комнаты и два конца одинокой стены");
  const press = at(2000, 2000);
  const cursor = at(press.x + (4 - anchor.x), press.y + (3 - anchor.y));
  const snap = workshopMoveDeltaMm(anchor, press, cursor, view, { gridMm: 500, gridSnap: true, corners });
  assert.deepEqual(
    { x: anchor.x + snap.deltaMm.x, y: anchor.y + snap.deltaMm.y },
    { x: 0, y: 0 },
    "середина вещи села в угол — туда же, куда её кладёт клик",
  );
  assert.equal(snap.corner.letter, "А");
});

test("магнит ведомого в объект не пишет ни знака (G68)", () => {
  const scene = dragScene();
  const walls = wallsOnScheme(scene.project, scene.schemeId);
  const view = viewOf({ zoom: 1 });
  const before = JSON.stringify(scene.project);
  for (const drag of [
    { kind: "vertex", wallId: scene.looseId, fromMm: at(1230, 870) },
    { kind: "wall", wallId: scene.looseId },
    { kind: "object", id: "вещь" },
  ]) {
    const corners = cornersMm(scene, { skipWallIds: workshopDragSkipWallIds(walls, drag) });
    workshopSnapMm([], at(5, 4), view, { gridMm: 500, gridSnap: true, corners });
    workshopMoveDeltaMm(at(1230, 870), at(2000, 2000), at(775, 1130), view, { gridMm: 500, gridSnap: true, corners });
  }
  assert.equal(JSON.stringify(scene.project), before, "притяжка — про руку, в объекте от неё ни одного знака");
});

// ——— таск 283: магнит угла в «Объёме» ———————————————————————————————————
//
// Ответ заказчика на пункт, оставленный таском 266 открытым, — «Делай». Мера,
// порог и Alt те же; новое здесь одно — **что считается углом в трёх
// измерениях**: вершина той грани, на которую садится конец мерки. Проверяется
// то, из-за чего это правило и выбрано:
//
//   осевой узел плана (`wallCornerTargets`) ни одной грани не принадлежит — он
//     внутри кладки, и концом мерки быть не может (G356, G358);
//   порог — те же `GUIDE_CROSS_PX` точек экрана: ровно 13 ловится, на волос
//     дальше — нет, а в миллиметрах это издалека и вблизи разные расстояния;
//   **видно — ловится**: спрятанная в толще чужой стены вершина не берётся,
//     хотя на экране она ближе порога;
//   Alt снимает, поверхность без углов рядом отвечает ровно как до таска, и в
//     объект магнит не пишет ни знака.
//
// Сцена — стенд «квартира с мебелью» (`tools/bench/scenes.mjs`): стены 200 мм,
// высота 2700, перегородки с дверями. Числа комнаты взяты из неё, а не выдуманы.

const BOX283 = Object.freeze({ width: 900, height: 600 });
// Угол гостиной у пола: оси наружных стен (−4500, −1800), толщина 200 — значит
// видимый угол комнаты стоит на (−4400, −1700), в полтолщины от каждой оси.
const CORNER283 = Object.freeze({ x: -4400, y: -1700, z: 0 });
const NODE283 = Object.freeze({ x: -4500, y: -1800, z: 0 });

function volumeScene283() {
  const box = benchFlat();
  return { box, scene: volumeScene(box.project, box.schemeId) };
}

/** Камера, смотрящая из точки `from` ровно в точку `to`. */
function lookAt283(from, to) {
  return {
    at: { ...from },
    yaw: Math.atan2(to.y - from.y, to.x - from.x),
    pitch: Math.atan2(to.z - from.z, Math.hypot(to.x - from.x, to.y - from.y)),
  };
}

const sameMm283 = (a, b, slack = 0.001) =>
  Boolean(a) && Math.abs(a.x - b.x) < slack && Math.abs(a.y - b.y) < slack && Math.abs(a.z - b.z) < slack;

test("угол в объёме — вершина грани, а осевой узел плана ею не бывает", () => {
  const { box, scene } = volumeScene283();
  // Узел плана на месте и носит букву — на плане магнит ловит его.
  const letters = wallCornerTargets(box.project, box.schemeId);
  assert.ok(
    letters.some((corner) => corner.x === NODE283.x && corner.y === NODE283.y),
    "узел плана у этой комнаты есть: " + JSON.stringify(letters),
  );
  // А в сцене его нет ни у одной грани: он внутри кладки, и концу мерки там не
  // место (правило «только на поверхность», G356). Видимый угол комнаты,
  // наоборот, — вершина сразу нескольких граней.
  const holders = (point) => scene.faces.filter((face) => (face.p || []).some((spot) => sameMm283(spot, point, 1)));
  assert.equal(holders(NODE283).length, 0, "осевой узел не лежит ни на одной грани");
  assert.ok(holders(CORNER283).length >= 3, "видимый угол держат пол и обе стены: " + holders(CORNER283).length);
});

test("конец мерки садится в угол стены — и в низ ребра, и в верх", () => {
  const { scene } = volumeScene283();
  const eye = { x: -2750, y: 0, z: 1600 };
  for (const corner of [CORNER283, { ...CORNER283, z: 2700 }]) {
    const camera = lookAt283(eye, corner);
    const screen = volumeScreenAt(corner, camera, BOX283);
    const found = volumeSurfaceAt(scene, camera, BOX283, screen.x + 9, screen.y, { corner: GUIDE_CROSS_PX });
    assert.equal(found.kind, "wall", "целились в стену: " + JSON.stringify(found));
    assert.ok(sameMm283(found.corner, corner), "поймался угол " + JSON.stringify(found.corner));
    assert.ok(sameMm283(found.point, corner), "конец сел ровно в него: " + JSON.stringify(found.point));
    // Без магнита тот же прицел даёт точку рядом — промах руки в девять точек
    // экрана, то есть десятки миллиметров.
    const plain = volumeSurfaceAt(scene, camera, BOX283, screen.x + 9, screen.y);
    assert.equal(plain.corner, null);
    assert.ok(measureSpan(plain.point, corner) > 20, "промах без магнита: " + measureSpan(plain.point, corner));
    // И `kind` магнитом не меняется: вершина принадлежит той же грани.
    assert.equal(plain.kind, found.kind);
  }
});

test("порог — те же 13 точек экрана: ровно 13 ловится, на волос дальше нет", () => {
  const { scene } = volumeScene283();
  const camera = lookAt283({ x: -2750, y: 0, z: 1600 }, CORNER283);
  const screen = volumeScreenAt(CORNER283, camera, BOX283);
  const atPx = (gap) => volumeSurfaceAt(scene, camera, BOX283, screen.x + gap, screen.y, { corner: GUIDE_CROSS_PX });
  assert.ok(sameMm283(atPx(GUIDE_CROSS_PX).corner, CORNER283), "ровно порог — ловится");
  assert.equal(atPx(GUIDE_CROSS_PX + 0.5).corner, null, "на волос дальше — нет");
  assert.equal(atPx(40).corner, null);
  // Ноль и отсутствие довода выключают магнит вовсе: ответ тот же, что до таска.
  assert.equal(volumeSurfaceAt(scene, camera, BOX283, screen.x + 9, screen.y, { corner: 0 }).corner, null);
  assert.equal(volumeSurfaceAt(scene, camera, BOX283, screen.x + 9, screen.y).corner, null);
});

test("порог экранный, а не миллиметровый: одни и те же 60 мм издалека ловятся, вблизи нет", () => {
  const { scene } = volumeScene283();
  // Прицел стоит в шестидесяти миллиметрах от угла вдоль стены — ровно в этой
  // точке и кончается луч, как ни отходи. Меняется только одно: сколько это в
  // точках экрана. Та же проверка, что у плана на мелком и крупном масштабе.
  const spot = { x: CORNER283.x, y: CORNER283.y + 60, z: 0 };
  const aimOf = (awayMm) => {
    const step = awayMm / Math.SQRT2;
    const camera = lookAt283({ x: CORNER283.x + step, y: CORNER283.y + step, z: 1600 }, spot);
    const middle = { x: BOX283.width / 2, y: BOX283.height / 2 };
    const screen = volumeScreenAt(CORNER283, camera, BOX283);
    return {
      px: Math.hypot(screen.x - middle.x, screen.y - middle.y),
      plain: volumeSurfaceAt(scene, camera, BOX283, middle.x, middle.y),
      found: volumeSurfaceAt(scene, camera, BOX283, middle.x, middle.y, { corner: GUIDE_CROSS_PX }),
    };
  };
  const far = aimOf(4000);
  const near = aimOf(1000);
  // Луч упирается в одну и ту же точку с обоих мест — спорить тут не о чем.
  assert.ok(sameMm283(far.plain.point, spot, 0.01), JSON.stringify(far.plain.point));
  assert.ok(sameMm283(near.plain.point, far.plain.point, 0.01), JSON.stringify(near.plain.point));
  assert.ok(far.px < GUIDE_CROSS_PX && near.px > GUIDE_CROSS_PX, "с четырёх метров угол в пороге, с одного — нет: " + far.px + " / " + near.px);
  assert.ok(sameMm283(far.found.corner, CORNER283), "издалека те же 60 мм — это угол");
  assert.equal(near.found.corner, null, "вблизи 60 мм — уже не угол, а место на стене");
  assert.deepEqual(near.found.point, near.plain.point);
});

test("видно — ловится: вершина, спрятанная в толще чужой стены, не берётся", () => {
  const { scene } = volumeScene283();
  // Перегородка (ось x = −1000) упёрта в наружную стену (ось y = −1800). Её бок
  // идёт **до оси** чужой стены, то есть его вершина (−1100, −1800) лежит на
  // сто миллиметров внутри кладки, а видимый угол комнаты — (−1100, −1700).
  const hidden = { x: -1100, y: -1800, z: 0 };
  const shown = { x: -1100, y: -1700, z: 0 };
  const side = scene.faces.find((face) => (face.p || []).some((spot) => sameMm283(spot, hidden, 1)) && face.n.x === -1);
  assert.ok(side, "бок перегородки со спрятанной вершиной в сцене есть");
  // Смотрим из дальнего угла гостиной: сто миллиметров превращаются в семь
  // точек экрана, то есть спрятанная вершина — внутри порога.
  const camera = lookAt283({ x: -4200, y: 1500, z: 1600 }, shown);
  const screen = volumeScreenAt(shown, camera, BOX283);
  const ghost = volumeScreenAt(hidden, camera, BOX283);
  const gap = Math.hypot(ghost.x - screen.x, ghost.y - screen.y);
  assert.ok(gap < GUIDE_CROSS_PX, "спрятанная вершина внутри порога: " + gap + " px");
  assert.equal(
    volumeSurfaceCorner(scene, side, camera, BOX283, screen.x, screen.y - 6, GUIDE_CROSS_PX),
    null,
    "её не видно — значит и не ловится",
  );
  // Угол этого примыкания ловится полом: вершина контура помещения стоит ровно
  // в нём, и прицел, опущенный в угол, её берёт.
  const floorCam = lookAt283({ x: -2500, y: -300, z: 1600 }, shown);
  const floorScreen = volumeScreenAt(shown, floorCam, BOX283);
  const onFloor = volumeSurfaceAt(scene, floorCam, BOX283, floorScreen.x, floorScreen.y + 4, {
    corner: GUIDE_CROSS_PX,
  });
  assert.equal(onFloor.kind, "floor");
  assert.ok(sameMm283(onFloor.corner, shown), "угол примыкания ловится полом: " + JSON.stringify(onFloor.corner));
});

test("Alt снимает магнит, а поверхность без углов рядом отвечает как до таска", () => {
  const { scene } = volumeScene283();
  const camera = lookAt283({ x: -2750, y: 0, z: 1600 }, CORNER283);
  const screen = volumeScreenAt(CORNER283, camera, BOX283);
  const free = volumeSurfaceAt(scene, camera, BOX283, screen.x + 9, screen.y, {
    corner: GUIDE_CROSS_PX,
    free: true,
  });
  const plain = volumeSurfaceAt(scene, camera, BOX283, screen.x + 9, screen.y);
  assert.equal(free.corner, null, "Alt — свободно");
  assert.deepEqual(free.point, plain.point, "и точка ровно под прицелом, как без магнита");
  // Середина стены: углов рядом нет, и ответ совпадает с прежним до знака.
  const middle = { x: -4400, y: 0, z: 1200 };
  const midCam = lookAt283({ x: -2750, y: 0, z: 1600 }, middle);
  const midScreen = volumeScreenAt(middle, midCam, BOX283);
  const was = volumeSurfaceAt(scene, midCam, BOX283, midScreen.x, midScreen.y);
  const now = volumeSurfaceAt(scene, midCam, BOX283, midScreen.x, midScreen.y, { corner: GUIDE_CROSS_PX });
  assert.equal(now.corner, null);
  assert.deepEqual(now.point, was.point);
  assert.equal(now.kind, was.kind);
  // Негодная поверхность остаётся негодной: решает это вызывающий, и магнит
  // ответа не меняет.
  assert.equal(volumeSurfaceHolds("other"), false);
});

test("подсказка «Объёма» называет магнит — правило таска 213", () => {
  // Угол тут не плановый кружок с буквой, и сказано это своими словами: иначе
  // человек ждал бы осевого узла чертежа.
  assert.ok(strings.measure.hintVolume.includes("угол той поверхности"));
  assert.ok(strings.measure.hintVolume.includes("кольцом"));
  assert.ok(strings.measure.hintVolume.includes("Alt"));
});

test("магнит в объёме не пишет в объект ни знака (G68)", () => {
  const { box, scene } = volumeScene283();
  const before = JSON.stringify(box.project);
  const camera = lookAt283({ x: -2750, y: 0, z: 1600 }, CORNER283);
  const screen = volumeScreenAt(CORNER283, camera, BOX283);
  for (const gap of [0, 5, 9, 13, 20]) {
    volumeSurfaceAt(scene, camera, BOX283, screen.x + gap, screen.y, { corner: GUIDE_CROSS_PX });
    volumeSurfaceAt(scene, camera, BOX283, screen.x + gap, screen.y, { corner: GUIDE_CROSS_PX, free: true });
  }
  assert.equal(JSON.stringify(box.project), before, "магнит — про прицел, в объекте от него ни одного знака");
});

// ——— магнит угла остальным занятиям плана (таск 282, G417) ——————————————
//
// Ответ заказчика на пункт, оставленный таском 266, — «делай». Магнита по
// углам не было у трёх занятий «Схемы», и все трое ходят через одну притяжку
// (`canvasDraftPoint` → `render.draftSnap`): ломаная метка, контур помещения и
// калибровка. С ними заодно его получила **правка вершины** того же пути: один
// и тот же угол не может ловиться при рисовании и не ловиться при правке.
//
// Проверяется пять вещей:
//
// 1. **Мера та же.** Своего счёта у плана не появилось: цели — `wallCornerTargets`
//    через мост `canvasCornerTargets`, порог — `GUIDE_CROSS_PX`, порядок —
//    «угол старше направляющей» (всё это закрыто разделами тасков 266 и 271 выше).
// 2. **Кто спрашивает магнит** — одна чистая дверь `canvasDraftAims`, и в ней
//    названы ровно три занятия; линейка забирает руку себе.
// 3. **Калибровка** получает магнит только там, где у плана есть миллиметр:
//    до первой калибровки целей нет вовсе, и это не ловушка.
// 4. **Сетка блока и угол не встречаются**: сетка живёт в ведении метки, угол —
//    в постановке точки рукой. Ни одного общего вызова.
// 5. **Подсказки называют магнит** у каждого занятия, где он появился (213), и
//    в объект магнит не пишет ни знака (G68).

const CANVAS_SOURCE = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "src", "canvas.js"), "utf8");

// Тот же план с комнатой, что у линейки: доли считает модельный мост.
function planRoom() {
  const scene = withWalls(planScene(), ROOM);
  const scheme = findScheme(scene.project, scene.schemeId);
  return { ...scene, scheme, corners: canvasCornerTargets({ project: scene.project, drawingShown: true }, scheme) };
}

// Промах рукой: три точки экрана мимо угла (план 1200 × 800, зум 1).
const missBy = (corner, dx = 3, dy = -2) => ({ x: corner.x + dx / 1200, y: corner.y + dy / 800 });

test("вершина ломаной метки и контура помещения садится в угол стены", () => {
  const scene = planRoom();
  const view = viewOf({ zoom: 1 });
  const corner = scene.corners[2];
  const options = { corners: scene.corners };
  // Первая вершина — черновика ещё нет вовсе, и дверь та же (таск 176).
  const first = canvasDraftPoint(null, missBy(corner), scene.scheme, view, options);
  assert.deepEqual(first.point, { x: corner.x, y: corner.y }, "первая вершина села ровно в угол");
  assert.equal(first.corner.letter, "В", "пойманный угол назван — по нему рисуется кольцо");
  // Следующая вершина — от предыдущей, и магнит угла старше ровного угла.
  const next = canvasDraftPoint(
    { points: [{ x: scene.corners[0].x, y: scene.corners[0].y }] },
    missBy(scene.corners[3], 2, 2),
    scene.scheme,
    view,
    options,
  );
  assert.deepEqual(next.point, { x: scene.corners[3].x, y: scene.corners[3].y });
  assert.equal(next.snapped, false, "точка уже точная — «ровно» ей не обещают");
  // Контур помещения обводят той же рукой и той же дверью: своих притяжек у
  // него нет (`canvasDraftClick` на обоих режимах один).
  const outline = canvasDraftPoint({ points: [] }, missBy(corner), scene.scheme, view, options);
  assert.deepEqual(outline.point, first.point, "у контура и у ломаной притяжка одна");
  // Alt снимает всё тем же `free`: второй клавиши «без магнита» не заведено.
  const free = canvasDraftPoint(null, missBy(corner), scene.scheme, view, { ...options, free: true });
  assert.deepEqual(free.point, missBy(corner), "с Alt точка легла туда, куда довела рука");
  assert.equal(free.corner, null, "кольцу с Alt взяться негде");
  // Углов нет — прежнее поведение цело до доли.
  assert.deepEqual(canvasDraftPoint(null, missBy(corner), scene.scheme, view, {}).point, missBy(corner));
});

test("три занятия черновика берут цели одной дверью поля", () => {
  // Своего списка целей ни у ломаной, ни у контура, ни у калибровки нет:
  // `canvasDraftSnap` — одна дверь на все три, и углы в неё приходят мостом.
  const from = CANVAS_SOURCE.indexOf("function canvasDraftSnap(");
  assert.ok(from > 0, "пропала дверь притяжки черновика");
  const body = CANVAS_SOURCE.slice(from, CANVAS_SOURCE.indexOf("\n}", from));
  assert.ok(body.includes("corners: canvasCornerTargets(state, scheme)"), "черновик перестал спрашивать углы");
  // Правка вершины идёт своей опорой, но целями — теми же (`canvasPathSnap`).
  const edit = CANVAS_SOURCE.indexOf("function canvasPathSnap(");
  const editBody = CANVAS_SOURCE.slice(edit, CANVAS_SOURCE.indexOf("\n}", edit));
  assert.ok(editBody.includes("corners: canvasCornerTargets(state, scheme)"), "ведомая вершина углов не получила");
  assert.ok(!editBody.includes("skipWallIds"), "цели — углы стен, а ведут вершину метки: исключать нечего");
});

test("магнит спрашивают ровно три занятия, и линейка забирает руку себе", () => {
  const made = addScheme(createProject(), { name: "1 этаж", width: 1000, height: 500 });
  const project = made.project;
  const idOf = (code) => project.markTypes.find((item) => item.code === code).id;
  const stateOf = (patch) => ({
    project,
    schemeId: made.scheme.id,
    activeTypeId: null,
    activeRoomId: null,
    mode: "select",
    layout: "desktop",
    ...patch,
  });
  // «Л» — лента, тип линейный; «Р» — розетка, точечный.
  assert.equal(canvasDraftAims(stateOf({ mode: "add", activeTypeId: idOf("Л") })), true, "ломаная метка");
  assert.equal(canvasDraftAims(stateOf({ mode: "room" })), true, "контур помещения");
  assert.equal(canvasDraftAims(stateOf({ mode: "scale" })), true, "калибровка");
  // Точечная метка и комментарий встают одним кликом и идут мимо черновика:
  // слова заказчика о них не было (открытый вопрос таска 282).
  assert.equal(canvasDraftAims(stateOf({ mode: "add", activeTypeId: idOf("Р") })), false, "точечная метка");
  assert.equal(canvasDraftAims(stateOf({ mode: "add", activeTypeId: null })), false, "тип не выбран");
  assert.equal(canvasDraftAims(stateOf({})), false, "«Выделение»");
  // Линейка стоит первой везде — в подсказке, в разборе нажатия и здесь:
  // кольцо на поле одно, и в эту минуту оно её.
  assert.equal(canvasDraftAims(stateOf({ mode: "room", measuring: true })), false, "линейка");
  // В просмотре правок нет вовсе, и в чужом режиме экрана рука не над планом.
  assert.equal(canvasDraftAims(stateOf({ mode: "room", layout: "mobile" })), false, "просмотр");
  assert.equal(canvasDraftAims(stateOf({ mode: "room", screen: "volume" })), false, "чужое поле");
  assert.equal(canvasDraftAims(null), false);
});

test("калибровка ловит угол там, где у плана есть миллиметр, — и нигде больше", () => {
  // До первой калибровки миллиметра на плане не существует: мост отвечает
  // `null`, целей нет, и магнит молчит сам — отдельного запрета ему не надо.
  const raw = withWalls(
    (() => {
      const added = addScheme(createProject(), { name: "без масштаба", imageId: "p", width: 1200, height: 800 });
      return { project: added.project, schemeId: added.scheme.id };
    })(),
    ROOM,
  );
  const rawScheme = findScheme(raw.project, raw.schemeId);
  assert.equal(
    canvasCornerTargets({ project: raw.project, drawingShown: true }, rawScheme).length,
    0,
    "первая калибровка целиться не во что: углы на плане ещё не стоят",
  );
  assert.ok(wallCornerTargets(raw.project, raw.schemeId).length > 0, "в чертеже углы при этом есть");
  // А повторная калибровка идёт по плану, на котором чертёж уже нарисован, —
  // и тот же угол ловит та же дверь.
  const scene = planRoom();
  const corner = scene.corners[1];
  const snap = canvasDraftPoint(null, missBy(corner), scene.scheme, viewOf({ zoom: 1 }), { corners: scene.corners });
  assert.deepEqual(snap.point, { x: corner.x, y: corner.y }, "конец отрезка калибровки сел в угол");
  // Слой чертежа выключен — углов нет и здесь: ловить то, чего не видно,
  // человек не может (правило таска 266).
  assert.equal(canvasCornerTargets({ project: scene.project, drawingShown: false }, scene.scheme).length, 0);
});

test("сетка блока и угол не встречаются: у них разные жесты", () => {
  // Сетка ведёт **метку** (таск 262), угол ловит точку, которую ставят рукой.
  // Ни один жест не спрашивает обеих, и порядок между ними поэтому не нужен.
  const drag = CANVAS_SOURCE.indexOf("function canvasDragTo(");
  const dragBody = CANVAS_SOURCE.slice(drag, CANVAS_SOURCE.indexOf("\nfunction canvasHoverAt(", drag));
  assert.ok(dragBody.includes("canvasGuideSnap(canvasBlockSnap("), "порядок таска 262 тронут");
  assert.ok(!dragBody.includes("canvasDraftSnap("), "ведение метки полезло в притяжку черновика");
  const draft = CANVAS_SOURCE.indexOf("function canvasDraftSnap(");
  assert.ok(
    !CANVAS_SOURCE.slice(draft, CANVAS_SOURCE.indexOf("\n}", draft)).includes("canvasBlockSnap"),
    "черновик полез в сетку блока",
  );
  const path = CANVAS_SOURCE.indexOf("function canvasPathSnap(");
  assert.ok(
    !CANVAS_SOURCE.slice(path, CANVAS_SOURCE.indexOf("\n}", path)).includes("canvasBlockSnap"),
    "правка вершины полезла в сетку блока",
  );
});

test("кольцо на поле помнит одна дверь, и гасит её тот, кто кончил жест", () => {
  // Второй памяти «пойманный угол» на плане быть не должно: два кольца
  // обещали бы две притяжки, которых нет.
  assert.equal(CANVAS_SOURCE.split("let canvasSnapCorner").length - 1, 1, "у кольца появилась вторая память");
  assert.equal(CANVAS_SOURCE.split("drawSnapCorner(").length - 1, 1, "кольцо рисуется не в одном месте");
  // Кольцо уходит с рукой и с занятием: ушла мышь, кончилось ведение,
  // сменились режим, схема, видимость чертежа или линейка.
  const leave = CANVAS_SOURCE.indexOf("function canvasPointerLeave(");
  assert.ok(CANVAS_SOURCE.slice(leave, leave + 600).includes("canvasSnapCornerSet(null)"), "кольцо осталось без руки");
  const up = CANVAS_SOURCE.indexOf("function canvasPointerUp(");
  assert.ok(
    CANVAS_SOURCE.slice(up, up + 800).includes('drag.kind === "pathVertex"'),
    "кольцо ведения не гаснет по отпусканию",
  );
  for (const key of ["measuring", "mode", "schemeId", "drawingShown"]) {
    assert.ok(CANVAS_SOURCE.includes('"' + key + '" in changed'), "кольцо не гаснет на смене " + key);
  }
});

test("подсказки называют магнит у каждого занятия, где он появился (таск 213)", () => {
  const scene = planRoom();
  const idOf = (code) => scene.project.markTypes.find((item) => item.code === code).id;
  const stateOf = (patch) => ({
    project: scene.project,
    schemeId: scene.schemeId,
    activeTypeId: null,
    activeRoomId: null,
    mode: "select",
    layout: "desktop",
    ...patch,
  });
  const said = (patch) => canvasHintText(stateOf(patch)) || "";
  for (const patch of [{ mode: "add", activeTypeId: idOf("Л") }, { mode: "room" }, { mode: "scale" }]) {
    assert.ok(said(patch).includes(strings.canvas.hintCorner), "магнит не назван: " + JSON.stringify(patch));
  }
  // Постановка точки и «Выделение» его не получают — там магнита нет самого.
  assert.equal(said({ mode: "add", activeTypeId: idOf("Р") }).includes(strings.canvas.hintCorner), false);
  assert.equal(said({ activeTypeId: idOf("Р") }).includes(strings.canvas.hintCorner), false);
  // Линейка говорит о магните своими словами и чужой строки не повторяет.
  assert.ok(said({ measuring: true }).includes("угол чертежа"));
  assert.equal(said({ measuring: true }).includes(strings.canvas.hintCorner), false);
  // Условие названо словом: углы приходят из чертежа, и на плане их нет, пока
  // слой выключен или масштаб не задан.
  assert.ok(strings.canvas.hintCorner.includes("масштаб"));
  assert.ok(strings.canvas.hintCorner.includes("кольцом"), "кольцо названо: молчащий магнит читается как сбой");
});

test("магнит плана в объект не пишет ни знака (G68)", () => {
  const scene = planRoom();
  const view = viewOf({ zoom: 1 });
  const before = JSON.stringify(scene.project);
  for (const corner of scene.corners) {
    canvasDraftPoint(null, missBy(corner), scene.scheme, view, { corners: scene.corners });
    canvasDraftPoint({ points: [missBy(corner, 20, 20)] }, missBy(corner), scene.scheme, view, {
      corners: scene.corners,
    });
  }
  canvasCornerTargets({ project: scene.project, drawingShown: true }, scene.scheme);
  assert.equal(JSON.stringify(scene.project), before, "притяжка — про руку, в объекте от неё ни одного знака");
});
