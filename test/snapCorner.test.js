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

import {
  addScheme,
  addWall,
  createProject,
  findScheme,
  planMmToFraction,
  setPlanOrigin,
  setPlanScale,
  wallCornerTargets,
} from "../src/model.js";
import { GUIDE_CROSS_PX, draftSnap, snapToCorners } from "../src/render.js";
import { WORKSHOP_UNIT, workshopHint, workshopSnapMm } from "../src/panels/workshop.js";
import { strings } from "../src/strings.js";
import { canvasCornerTargets } from "../src/canvas.js";

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

test("свои углы названной стены магниту не отдаются", () => {
  const scene = withWalls(bareScene(), ROOM);
  const own = cornersMm(scene, { skipWallId: scene.wallIds[0] });
  // Первая стена — АБ: её концы (0, 0) и (4000, 0) держат ещё и соседки,
  // поэтому убираются целиком — иначе вершину тянуло бы к собственной стене.
  assert.deepEqual(
    own.map((corner) => corner.letter),
    ["В", "Г"],
    "остались углы, за которые эта стена не держится",
  );
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
  for (const tool of ["walls", "objects"]) {
    assert.ok(workshopHint(tool, "rect").includes(strings.workshop.hintCorner), tool);
  }
  for (const tool of ["openings", "edit"]) {
    assert.equal(workshopHint(tool, "rect").includes(strings.workshop.hintCorner), false, tool);
  }
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
