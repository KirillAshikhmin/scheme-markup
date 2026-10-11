// Мастерская чертежа: чистая половина окна, в котором рисуют стены (таск 125,
// требование G174, третий этап).
//
// DOM, холст и мышь тестами не покрываются намеренно — их проверяет живой
// прогон. Проверяется здесь то, что в окне **не видно глазом** и чего живой
// прогон не поймает:
//
//   1. **Концы соседних стен совпадают точно.** Один росчерк — цепочка
//      отрезков (G177), и соседство выражено равенством целых миллиметров, без
//      допуска. На этом держится будущая развёртка: «почти сходится» в данных
//      превратилось бы в щель в стене, которую никто не заметил бы сегодня.
//   2. **Подложка ложится под чертёж тем же мостом, что у модели.** Окно
//      рисует картинку одним преобразованием холста, а не вызовом
//      `planMmToFraction` на каждый пиксель. Разойдись эти две арифметики —
//      чертёж лёг бы поперёк плана, и увидеть это можно было бы только глазами.
//      Поэтому преобразование сверяется с мостом модели на всех четырёх
//      поворотах подложки.
//   3. **Три случая с началом координат не молчат.** Подложка с калибровкой,
//      подложка без калибровки и схема без подложки — у каждого свой ответ, и
//      строка состояния обязана его назвать.
//   4. **Магниты — прежние, холстовые.** Притяжка считается `render.draftSnap`
//      по «схеме», у которой пиксель плана равен миллиметру; проверяется, что
//      угол кратно 15° и сетка не спорят друг с другом, а сменяются.
//   5. **G68.** Пустой росчерк и нулевой сдвиг не трогают объект — тот же
//      объект по ссылке, ни одного шага истории на пустом месте.
import test from "node:test";
import assert from "node:assert/strict";

import {
  OPENING_KINDS,
  SCHEME_OBJECT_SHAPES,
  addOpening,
  addRoom,
  addScheme,
  addSchemeObject,
  createProject,
  drawingBoundsMm,
  ensureSchemeObjectKinds,
  findSchemeObject,
  findScheme,
  openingsInWall,
  planFractionToMm,
  planMmToFraction,
  planOriginOf,
  planPixelsPerMeter,
  planSizeMeters,
  schemeObjectKindsInOrder,
  setPlanOrigin,
  setPlanScale,
  setSchemeWallHeight,
  schemeObjectCorners,
  segmentDistanceMm,
  updateSchemeObject,
  wallVectors,
  wallsOnScheme,
} from "../src/model.js";
import {
  drawingDoorLeaf,
  drawingHitObject,
  planToScreen,
} from "../src/render.js";
import { identityTransform, rotateTransform } from "../src/imagePrep.js";
import { applyPlanEdit } from "../src/panels/schemes.js";
import {
  WORKSHOP_CONTOUR_MIN,
  WORKSHOP_EMPTY_MM,
  WORKSHOP_GRID_STEPS_MM,
  WORKSHOP_OBJECT_FALLBACK,
  WORKSHOP_OBJECT_WAYS,
  WORKSHOP_OPENING_DEFAULTS,
  WORKSHOP_ADDING,
  WORKSHOP_MODES,
  WORKSHOP_ORIGIN_AT,
  WORKSHOP_PLAN_ZOOM_MAX,
  WORKSHOP_SHEET,
  WORKSHOP_SUBJECTS,
  WORKSHOP_TOOL_ELEVATION,
  WORKSHOP_TOOL_SCALE,
  WORKSHOP_UNIT,
  WORKSHOP_ZOOM_MAX,
  WORKSHOP_ZOOM_MIN,
  workshopAddChain,
  workshopAlongWall,
  workshopAttachOrigin,
  workshopChain,
  workshopClampZoom,
  workshopEnsureSheet,
  workshopExtentMm,
  workshopFitView,
  workshopGridDrawStepMm,
  workshopHint,
  workshopInitialTool,
  workshopLengthAt,
  workshopModeOf,
  workshopMoveVertex,
  workshopMoveWall,
  workshopObjectDefaultsByName,
  workshopObjectHandles,
  workshopObjectPatch,
  workshopOpeningAt,
  workshopPathAnchor,
  workshopPathSources,
  workshopPick,
  workshopPointsExtend,
  workshopPointsInsert,
  workshopPointsMove,
  workshopPointsRemove,
  workshopRectCornerPatch,
  workshopRectFromContour,
  workshopSelectionOf,
  workshopShapeOfWay,
  workshopTryOpening,
  workshopPlacement,
  workshopPlanExtent,
  workshopPlanFraction,
  workshopPlanPointScreen,
  workshopRoundMm,
  workshopSnapMm,
  workshopStatus,
  workshopToolOf,
  workshopVertexEnds,
  workshopWayOfShape,
} from "../src/panels/workshop.js";
import { strings } from "../src/strings.js";

// План 1200 × 800 точек, в метре ровно 100 точек — как в тестах модели
// чертежа: миллиметр равен десятой доле точки, и доли считаются в уме.
function planProject() {
  const added = addScheme(createProject(), { name: "1 этаж", imageId: "plan-1", width: 1200, height: 800 });
  const project = setPlanScale(added.project, added.scheme.id, {
    a: { x: 0.1, y: 0.5 },
    b: { x: 0.6, y: 0.5 },
    meters: 6,
  }).project;
  return { project, schemeId: added.scheme.id };
}

function blankProject() {
  const added = addScheme(createProject(), { name: "от руки" });
  return { project: added.project, schemeId: added.scheme.id };
}

const viewOf = (patch) => ({ zoom: 0.1, offsetX: 400, offsetY: 300, ...patch });

// Цепочка «как рисуют комнату»: четыре клика по углам и пятый в первый угол.
const ROOM = [
  { x: 0, y: 0 },
  { x: 4000, y: 0 },
  { x: 4000, y: 3000 },
  { x: 0, y: 3000 },
  { x: 0, y: 0 },
];

// ——— росчерк в цепочку стен ————————————————————————————————————————————

test("один росчерк — цепочка отрезков с общими концами", () => {
  const walls = workshopChain(ROOM);
  assert.equal(walls.length, 4, "пять вершин дают четыре стены");
  for (let index = 1; index < walls.length; index += 1) {
    assert.deepEqual(
      walls[index].aMm,
      walls[index - 1].bMm,
      "конец стены и начало следующей — одна и та же точка, без допуска",
    );
  }
  assert.deepEqual(walls[3].bMm, walls[0].aMm, "замкнутая цепочка сходится в первую вершину");
});

test("два клика в одну точку — один клик, а не стена нулевой длины", () => {
  const walls = workshopChain([
    { x: 0, y: 0 },
    { x: 0, y: 0 },
    { x: 1000, y: 0 },
  ]);
  assert.equal(walls.length, 1);
  assert.deepEqual(walls[0], { aMm: { x: 0, y: 0 }, bMm: { x: 1000, y: 0 } });
});

test("одной вершины на стену не хватает", () => {
  assert.deepEqual(workshopChain([{ x: 10, y: 10 }]), []);
  assert.deepEqual(workshopChain([]), []);
  assert.deepEqual(workshopChain(null), []);
});

test("записанная цепочка сходится концами и в самом объекте", () => {
  const base = planProject();
  const result = workshopAddChain(base.project, base.schemeId, ROOM, 100);
  assert.equal(result.added, 4);
  const walls = wallsOnScheme(result.project, base.schemeId);
  assert.equal(walls.length, 4);
  for (let index = 1; index < walls.length; index += 1) {
    assert.deepEqual(walls[index].aMm, walls[index - 1].bMm, "модель переписала обе копии точки одинаково");
  }
  for (const wall of walls) {
    assert.equal(wall.thicknessMm, 100);
    assert.ok(Number.isInteger(wall.aMm.x) && Number.isInteger(wall.aMm.y), "координаты — целые миллиметры");
  }
});

test("привязка ставится тем же шагом, что первая стена, — в середину подложки", () => {
  const base = planProject();
  assert.equal(planOriginOf(base.project, base.schemeId), null, "до росчерка привязки нет");
  const result = workshopAddChain(base.project, base.schemeId, ROOM, 100);
  assert.equal(result.origin, true, "про привязку сказано вслух — окно показывает это известием");
  assert.deepEqual(planOriginOf(result.project, base.schemeId), { at: WORKSHOP_ORIGIN_AT, turn: 0 });
});

test("вторая цепочка привязку не переставляет — чертёж уехал бы целиком", () => {
  const base = planProject();
  const first = workshopAddChain(base.project, base.schemeId, ROOM, 100);
  const moved = setPlanOrigin(first.project, base.schemeId, { at: { x: 0.2, y: 0.3 }, turn: 90 }).project;
  const second = workshopAddChain(moved, base.schemeId, [{ x: 0, y: 0 }, { x: 500, y: 0 }], 80);
  assert.equal(second.origin, false);
  assert.deepEqual(planOriginOf(second.project, base.schemeId), { at: { x: 0.2, y: 0.3 }, turn: 90 });
});

test("схема без подложки получает лист — тем же шагом, что первая стена", () => {
  // Привязывать не к чему, и «начало координат на подложке» здесь не
  // ставится: ставится **лист** — система координат, без которой доля метки
  // не от чего считаться (таск 127). Про подложку известие молчит.
  const base = blankProject();
  const result = workshopAddChain(base.project, base.schemeId, ROOM, 100);
  assert.equal(result.origin, false, "про привязку к подложке не говорится — подложки нет");
  const scheme = findScheme(result.project, base.schemeId);
  assert.equal(scheme.width, WORKSHOP_SHEET.width);
  assert.equal(scheme.height, WORKSHOP_SHEET.height);
  assert.deepEqual(planOriginOf(result.project, base.schemeId), { at: WORKSHOP_ORIGIN_AT, turn: 0 });
  assert.equal(
    planPixelsPerMeter(result.project, base.schemeId),
    1000 / WORKSHOP_SHEET.mmPerPx,
    "сантиметр на пиксель плана",
  );
  assert.deepEqual(drawingBoundsMm(result.project, base.schemeId), {
    minX: 0,
    minY: 0,
    maxX: 4000,
    maxY: 3000,
    widthMm: 4000,
    heightMm: 3000,
  });
});

test("лист заводится один раз и не переставляется второй цепочкой", () => {
  const base = blankProject();
  const first = workshopAddChain(base.project, base.schemeId, ROOM, 100).project;
  const moved = setPlanOrigin(first, base.schemeId, { at: { x: 0.2, y: 0.3 }, turn: 90 }).project;
  const again = workshopEnsureSheet(moved, base.schemeId);
  assert.equal(again.added, false);
  assert.equal(again.project, moved, "тот же объект по ссылке — ни шага истории, ни updatedAt");
});

test("лист не трогает схему с подложкой", () => {
  const base = planProject();
  assert.equal(workshopEnsureSheet(base.project, base.schemeId).project, base.project);
});

test("метка на листе доезжает до тех же миллиметров, что стена", () => {
  // Это и есть смысл листа: доля метки и миллиметр стены меряются одним
  // планом. Промах здесь значил бы, что метка стоит не на той стене.
  const base = blankProject();
  const sheet = workshopEnsureSheet(base.project, base.schemeId).project;
  for (const mm of [{ x: 0, y: 0 }, { x: 3500, y: -2000 }, { x: -12000, y: 9000 }]) {
    const fraction = planMmToFraction(sheet, base.schemeId, mm);
    assert.ok(fraction, "мост листа обязан работать");
    assert.deepEqual(planFractionToMm(sheet, base.schemeId, fraction), mm);
  }
  // Сорок на тридцать метров вокруг нуля — граница листа названа числом.
  assert.deepEqual(planMmToFraction(sheet, base.schemeId, { x: -20000, y: -15000 }), { x: 0, y: 0 });
  assert.deepEqual(planMmToFraction(sheet, base.schemeId, { x: 20000, y: 15000 }), { x: 1, y: 1 });
});

test("G68: пустой росчерк не трогает объект — тот же объект по ссылке", () => {
  const base = planProject();
  const result = workshopAddChain(base.project, base.schemeId, [{ x: 5, y: 5 }], 100);
  assert.equal(result.project, base.project, "ни нового объекта, ни привязки на пустом месте");
  assert.equal(result.added, 0);
});

// ——— правка нарисованного ——————————————————————————————————————————————

function drawnRoom() {
  const base = planProject();
  const result = workshopAddChain(base.project, base.schemeId, ROOM, 100);
  return { project: result.project, schemeId: base.schemeId };
}

test("вершину держат все стены, что в ней сошлись, — и едут вместе", () => {
  const base = drawnRoom();
  const corner = { x: 4000, y: 0 };
  assert.equal(workshopVertexEnds(wallsOnScheme(base.project, base.schemeId), corner).length, 2);
  const result = workshopMoveVertex(base.project, base.schemeId, corner, { x: 4500, y: -200 });
  assert.equal(result.moved, 2, "угол держат два конца — переехать обязаны оба");
  const walls = wallsOnScheme(result.project, base.schemeId);
  assert.deepEqual(walls[0].bMm, { x: 4500, y: -200 });
  assert.deepEqual(walls[1].aMm, { x: 4500, y: -200 });
  assert.deepEqual(walls[1].aMm, walls[0].bMm, "цепочка осталась цепочкой");
  assert.deepEqual(walls[2].aMm, { x: 4000, y: 3000 }, "чужие углы не тронуты");
});

test("в точке, где нет ни одного конца, двигать нечего", () => {
  const base = drawnRoom();
  const result = workshopMoveVertex(base.project, base.schemeId, { x: 123, y: 456 }, { x: 0, y: 0 });
  assert.equal(result.moved, 0);
  assert.equal(result.project, base.project);
});

test("стена едет целиком — оба конца на один целый сдвиг", () => {
  const base = drawnRoom();
  const wall = wallsOnScheme(base.project, base.schemeId)[0];
  const result = workshopMoveWall(base.project, wall.id, { x: 250, y: -40 });
  assert.equal(result.moved, true);
  const moved = wallsOnScheme(result.project, base.schemeId)[0];
  assert.deepEqual(moved.aMm, { x: 250, y: -40 });
  assert.deepEqual(moved.bMm, { x: 4250, y: -40 });
});

test("нулевой сдвиг объект не трогает — шага истории на дрожание руки не бывает", () => {
  const base = drawnRoom();
  const wall = wallsOnScheme(base.project, base.schemeId)[0];
  const result = workshopMoveWall(base.project, wall.id, { x: 0.4, y: -0.4 });
  assert.equal(result.moved, false);
  assert.equal(result.project, base.project);
});

test("минус нуля в сдвиге приводится к нулю — иначе равенство концов разошлось бы", () => {
  assert.deepEqual(workshopRoundMm({ x: -0.4, y: -0.2 }), { x: 0, y: 0 });
  assert.ok(Object.is(workshopRoundMm({ x: -0.4, y: 0 }).x, 0), "именно 0, а не -0");
});

test("координату за потолком модели прижимаем, а не роняем ошибкой", () => {
  const far = workshopRoundMm({ x: 5e9, y: -5e9 });
  assert.equal(far.x, 1000000);
  assert.equal(far.y, -1000000);
});

// ——— что под курсором ——————————————————————————————————————————————————

test("вершина старше тела стены: ею правят угол", () => {
  const base = drawnRoom();
  const view = viewOf({ zoom: 0.05 });
  const pick = workshopPick(base.project, base.schemeId, { x: 10, y: 10 }, view);
  assert.equal(pick.kind, "vertex");
  assert.deepEqual(pick.atMm, { x: 0, y: 0 });
});

test("толстую стену ловят по её ширине, а не по осевой линии", () => {
  const base = planProject();
  const thick = workshopAddChain(base.project, base.schemeId, [{ x: 0, y: 0 }, { x: 4000, y: 0 }], 400);
  const view = viewOf({ zoom: 0.02 });
  // 150 мм от оси — внутри стены толщиной 400, но дальше порога в 6 экранных
  // пикселей (на этом масштабе это 300 мм)… проверяем именно толщину: берём
  // точку, которая ближе половины толщины и дальше середины.
  const inside = workshopPick(thick.project, base.schemeId, { x: 2000, y: 190 }, viewOf({ zoom: 1 }));
  assert.equal(inside && inside.kind, "wall");
  const outside = workshopPick(thick.project, base.schemeId, { x: 2000, y: 260 }, viewOf({ zoom: 1 }));
  assert.equal(outside, null, "за краем стены брать нечего");
  assert.ok(view.zoom > 0);
});

test("мимо всего — ничего: клик по пустому месту снимает выделение", () => {
  const base = drawnRoom();
  assert.equal(workshopPick(base.project, base.schemeId, { x: 2000, y: 1500 }, viewOf({ zoom: 1 })), null);
});

// ——— подложка под чертежом —————————————————————————————————————————————

test("три случая подложки, и ни один не «просто не рисуем»", () => {
  assert.equal(workshopPlacement(createProject(), "нет такой").kind, "noScheme");
  const blank = blankProject();
  assert.equal(workshopPlacement(blank.project, blank.schemeId).kind, "noImage");
  const noScale = addScheme(createProject(), { name: "без масштаба", imageId: "p", width: 1000, height: 1000 });
  assert.equal(workshopPlacement(noScale.project, noScale.scheme.id).kind, "noScale");
});

// Заказчик открыл чертёж на своём доме и не увидел загруженной картинки:
// слой «Подложка» стоял погашенным. Причина была в замкнутом круге — привязка
// записывается первой стеной, а подложка показывалась только при записанной
// привязке. То есть картинку не показывали, пока по ней не обведут стену.
test("подложка видна до первой стены — место известно заранее", () => {
  const base = planProject();
  const pending = workshopPlacement(base.project, base.schemeId);
  assert.equal(pending.kind, "ready", "картинку показываем сразу, иначе обводить нечего");
  assert.equal(pending.pending, true, "но в объекте привязки ещё нет");
  assert.deepEqual(pending.at, WORKSHOP_ORIGIN_AT);
  assert.equal(pending.turn, 0);
  // Записанная привязка ставит картинку ровно туда же — обводка не прыгнет
  // в тот миг, когда первая стена запишет привязку в объект.
  const attached = workshopAttachOrigin(base.project, base.schemeId).project;
  const ready = workshopPlacement(attached, base.schemeId);
  assert.equal(ready.kind, "ready");
  assert.equal(ready.pending, false);
  assert.equal(ready.mmPerPx, 10, "в точке плана десять миллиметров — сто точек на метр");
  assert.deepEqual(ready.at, pending.at);
  assert.equal(ready.turn, pending.turn);
});

test("преобразование подложки совпадает с мостом модели — на всех четырёх поворотах", () => {
  const base = planProject();
  const view = viewOf({});
  for (const turn of [0, 90, 180, 270]) {
    const project = setPlanOrigin(base.project, base.schemeId, { at: { x: 0.3, y: 0.6 }, turn }).project;
    const placement = workshopPlacement(project, base.schemeId);
    assert.equal(placement.kind, "ready");
    for (const point of [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 0.3, y: 0.6 }, { x: 0.75, y: 0.2 }]) {
      const mine = workshopPlanPointScreen(point, placement, view);
      const mm = planFractionToMm(project, base.schemeId, point);
      const theirs = planToScreen(mm, WORKSHOP_UNIT, view);
      // Миллиметры модель округляет, экранный пиксель этого округления стоит
      // десятой доли точки на этом масштабе — поэтому сверка с допуском.
      assert.ok(
        Math.hypot(mine.x - theirs.x, mine.y - theirs.y) < 0.2,
        "поворот " + turn + ": окно рисует подложку не там, где её видит модель",
      );
    }
  }
});

test("поворот подложки довозит чертёж: та же точка плана — те же миллиметры", () => {
  // Это свойство модели (таск 123), но увидеть его можно впервые здесь: до
  // мастерской чертёж не показывался нигде. Если бы привязка не получала
  // прибавку поворота, нарисованная стена легла бы поперёк той, по которой её
  // обводили, — и прогон про это молчал бы.
  const base = planProject();
  const project = workshopAttachOrigin(base.project, base.schemeId).project;
  const spot = { x: 0.72, y: 0.25 };
  const before = planFractionToMm(project, base.schemeId, spot);
  const transform = rotateTransform(identityTransform(), 90);
  const turned = applyPlanEdit(project, base.schemeId, {
    imageId: "plan-2",
    width: 800,
    height: 1200,
    transform,
  }).project;
  // Доля той же точки плана после поворота — та же арифметика, что у меток.
  const moved = { x: 1 - spot.y, y: spot.x };
  const after = planFractionToMm(turned, base.schemeId, moved);
  assert.ok(
    Math.hypot(after.x - before.x, after.y - before.y) <= 2,
    "миллиметры той же точки плана разошлись: " + JSON.stringify({ before, after }),
  );
  assert.equal(planOriginOf(turned, base.schemeId).turn, 90, "привязка получила прибавку поворота");
});

// ——— притяжка: прежние магниты холста ——————————————————————————————————

test("сетка включена — узел сетки, и угол её не сдвигает", () => {
  const snap = workshopSnapMm([{ x: 0, y: 0 }], { x: 1240, y: 87 }, viewOf({ zoom: 1 }), {
    gridMm: 500,
    gridSnap: true,
  });
  assert.deepEqual(snap.point, { x: 1000, y: 0 });
  assert.equal(snap.grid, true);
});

test("сетка выключена — работает прежний магнит угла кратно 15°", () => {
  // Второй конец почти горизонтален: промах на пару миллиметров забирает тот
  // же `render.draftSnap`, которым рисуют ломаную на холсте.
  const snap = workshopSnapMm([{ x: 0, y: 0 }], { x: 3000, y: 40 }, viewOf({ zoom: 1 }), {
    gridMm: 500,
    gridSnap: false,
  });
  assert.equal(snap.point.y, 0, "почти горизонталь дотянута до горизонтали");
  assert.equal(snap.point.x, 3000, "продольная координата осталась под курсором");
  assert.equal(snap.snapped, true);
});

test("Alt снимает всё разом — косую стену по чужому плану рисуют свободной рукой", () => {
  const snap = workshopSnapMm([{ x: 0, y: 0 }], { x: 3000, y: 40 }, viewOf({ zoom: 1 }), {
    gridMm: 500,
    gridSnap: true,
    free: true,
  });
  assert.deepEqual(snap.point, { x: 3000, y: 40 });
  assert.equal(snap.grid, false);
  assert.equal(snap.snapped, false);
});

test("первая вершина садится той же дверью — без предыдущей точки угла нет", () => {
  const free = workshopSnapMm([], { x: 1234.6, y: -87.4 }, viewOf({ zoom: 1 }), { gridMm: 500, gridSnap: false });
  assert.deepEqual(free.point, { x: 1235, y: -87 }, "дробные миллиметры округляются на границе модели");
  const node = workshopSnapMm([], { x: 1234.6, y: -87.4 }, viewOf({ zoom: 1 }), { gridMm: 500, gridSnap: true });
  assert.deepEqual(node.point, { x: 1000, y: 0 });
});

test("шаги сетки идут по возрастанию и начинаются с толщины перегородки", () => {
  assert.deepEqual([...WORKSHOP_GRID_STEPS_MM].sort((a, b) => a - b), WORKSHOP_GRID_STEPS_MM);
  assert.equal(WORKSHOP_GRID_STEPS_MM[0], 50);
});

test("мелкую сетку рисуем кратным шагом, а притягиваем выбранным", () => {
  // Сто миллиметров при 0,01 пикселя на миллиметр — это один пиксель на линию:
  // такая гребёнка читается заливкой.
  assert.equal(workshopGridDrawStepMm(100, 1), 100, "на крупном масштабе шаг свой");
  const drawn = workshopGridDrawStepMm(100, 0.01);
  assert.ok(drawn > 100 && drawn % 100 === 0, "шаг отрисовки кратен выбранному: " + drawn);
  assert.ok(drawn * 0.01 >= 5, "и даёт разборчивый просвет");
  assert.equal(workshopGridDrawStepMm(0, 1), 0, "шага нет — сетки нет");
});

// ——— вид окна ——————————————————————————————————————————————————————————

test("пустая схема без подложки получает лист вокруг нуля, а не бесконечность", () => {
  const base = blankProject();
  const extent = workshopExtentMm(base.project, base.schemeId, workshopPlacement(base.project, base.schemeId));
  assert.equal(extent.maxX - extent.minX, WORKSHOP_EMPTY_MM.widthMm);
  assert.equal(extent.maxY - extent.minY, WORKSHOP_EMPTY_MM.heightMm);
  assert.equal(extent.minX + extent.maxX, 0, "лист стоит вокруг нуля — первая вершина попадёт на него");
});

test("нарисованное и подложка влезают в окно вместе", () => {
  const base = drawnRoom();
  const placement = workshopPlacement(base.project, base.schemeId);
  const extent = workshopExtentMm(base.project, base.schemeId, placement);
  // План 1200 × 800 точек по 10 мм — 12 × 8 метров вокруг середины; комната
  // 4 × 3 метра от нуля целиком внутри него.
  assert.ok(extent.minX <= -6000 && extent.maxX >= 6000, "ширина плана попала в габарит");
  assert.ok(extent.maxY >= 4000);
  const view = workshopFitView(extent, { width: 800, height: 600 });
  const middle = planToScreen(
    { x: (extent.minX + extent.maxX) / 2, y: (extent.minY + extent.maxY) / 2 },
    WORKSHOP_UNIT,
    view,
  );
  assert.ok(Math.abs(middle.x - 400) < 0.001 && Math.abs(middle.y - 300) < 0.001, "середина габарита — середина окна");
});

test("масштаб окна зажат с двух сторон", () => {
  assert.equal(workshopClampZoom(0), WORKSHOP_ZOOM_MIN);
  assert.equal(workshopClampZoom(-5), WORKSHOP_ZOOM_MIN);
  assert.equal(workshopClampZoom(1e6), WORKSHOP_ZOOM_MAX);
  assert.equal(workshopClampZoom(0.5), 0.5);
  const tiny = workshopFitView({ minX: 0, minY: 0, maxX: 1e6, maxY: 1e6 }, { width: 10, height: 10 });
  assert.equal(tiny.zoom, WORKSHOP_ZOOM_MIN, "километровый чертёж в окошко не вписывается глубже предела");
});

// ——— строка состояния: три случая, и ни один не молчит ————————————————

test("подложка с калибровкой: сказан размер плана в метрах", () => {
  const base = drawnRoom();
  const line = workshopStatus(base.project, base.schemeId, workshopPlacement(base.project, base.schemeId));
  assert.match(line, /12/, "размер плана в метрах назван");
  assert.match(line, /4000 × 3000/, "и размер самого чертежа");
  assert.ok(line.includes("4"), "и число стен");
  assert.ok(!line.includes(strings.workshop.caseNoScale));
});

test("подложка без калибровки: сказано, что масштаба нет", () => {
  const noScale = addScheme(createProject(), { name: "без масштаба", imageId: "p", width: 1000, height: 1000 });
  const line = workshopStatus(noScale.project, noScale.scheme.id, workshopPlacement(noScale.project, noScale.scheme.id));
  assert.ok(line.includes(strings.workshop.caseNoScale), "молча рисовать в никуда нельзя: " + line);
  assert.ok(line.includes(strings.workshop.sizeEmpty));
});

test("подложки нет вовсе: сказано, что размер берётся из чертежа", () => {
  const base = blankProject();
  const line = workshopStatus(base.project, base.schemeId, workshopPlacement(base.project, base.schemeId));
  assert.ok(line.includes(strings.workshop.caseNoImage));
});

test("повёрнутую подложку состояние называет вслух — иначе это читается как поломка", () => {
  const base = planProject();
  const straight = workshopAttachOrigin(base.project, base.schemeId).project;
  assert.ok(!workshopStatus(straight, base.schemeId, workshopPlacement(straight, base.schemeId)).includes("90°"));
  const turned = setPlanOrigin(base.project, base.schemeId, { at: WORKSHOP_ORIGIN_AT, turn: 90 }).project;
  const line = workshopStatus(turned, base.schemeId, workshopPlacement(turned, base.schemeId));
  assert.match(line, /90°/, line);
});

test("подложка есть, калибровка есть, привязки нет — состояние названо своим словом", () => {
  const base = planProject();
  const line = workshopStatus(base.project, base.schemeId, workshopPlacement(base.project, base.schemeId));
  assert.ok(line.includes(strings.workshop.caseNoOrigin), line);
});

// ——— высоты ————————————————————————————————————————————————————————————

test("высота помещения перебивает общую, пустая — не перебивает", () => {
  const base = drawnRoom();
  let project = setSchemeWallHeight(base.project, base.schemeId, 2700).project;
  const room = addRoom(project, "Кухня");
  project = room.project;
  assert.equal(findScheme(project, base.schemeId).wallHeightMm, 2700);
  assert.ok(!Object.prototype.hasOwnProperty.call(room.room, "wallHeightMm"), "своей высоты у комнаты нет");
});

// ——— ничего лишнего в объекте ——————————————————————————————————————————

test("окно не заводит справочника видов объектов — объектов в этом таске нет", () => {
  const base = drawnRoom();
  assert.ok(
    !Object.prototype.hasOwnProperty.call(base.project, "schemeObjectKinds"),
    "справочник видов заводится по первой надобности, а не рисованием стен",
  );
  assert.ok(!Object.prototype.hasOwnProperty.call(base.project, "openings"));
  assert.ok(!Object.prototype.hasOwnProperty.call(base.project, "schemeObjects"));
});

// ——— таск 126: проёмы в стенах ————————————————————————————————————————
//
// Проверяется то, чего не видно глазом на снимке: что окно **не переписывает
// проверки модели** (призрак и клик считаются одной попыткой записи), что
// створка двери различает все четыре сочетания, и что умолчания по виду
// существуют и не врут.

test("проём садится серединой под курсор и прижимается к концу стены", () => {
  const wall = { aMm: { x: 0, y: 0 }, bMm: { x: 4000, y: 0 }, thicknessMm: 100 };
  assert.equal(workshopOpeningAt(wall, { x: 2000, y: 0 }, 1500), 1250, "середина проёма под курсором");
  assert.equal(workshopOpeningAt(wall, { x: 100, y: 0 }, 1500), 0, "у начала прижат к началу, а не отказ");
  assert.equal(workshopOpeningAt(wall, { x: 3900, y: 0 }, 1500), 2500, "у конца прижат к концу");
  assert.equal(workshopOpeningAt(wall, { x: 2000, y: 0 }, 9000), 0, "шире стены — прижат к началу, откажет модель");
});

test("отступ вдоль стены считается по проекции и не выходит за её концы", () => {
  const wall = { aMm: { x: 0, y: 0 }, bMm: { x: 0, y: 3000 }, thicknessMm: 100 };
  assert.equal(workshopAlongWall(wall, { x: 500, y: 1200 }), 1200, "поперечный промах не считается");
  assert.equal(workshopAlongWall(wall, { x: 0, y: -500 }), 0);
  assert.equal(workshopAlongWall(wall, { x: 0, y: 9000 }), 3000);
});

test("левая нормаль стены — та, что слева, если идти от начала к концу", () => {
  // Экранный `y` растёт вниз: идём вправо — слева оказывается верх.
  const right = wallVectors({ aMm: { x: 0, y: 0 }, bMm: { x: 1000, y: 0 } });
  assert.deepEqual(right.u, { x: 1, y: 0 });
  assert.deepEqual(right.n, { x: 0, y: -1 });
  const down = wallVectors({ aMm: { x: 0, y: 0 }, bMm: { x: 0, y: 1000 } });
  assert.deepEqual(down.n, { x: 1, y: 0 }, "идём вниз — слева восток");
  assert.equal(wallVectors({ aMm: { x: 5, y: 5 }, bMm: { x: 5, y: 5 } }), null);
});

test("четыре сочетания петель и стороны — четыре разные створки", () => {
  const wall = { aMm: { x: 0, y: 0 }, bMm: { x: 4000, y: 0 }, thicknessMm: 100 };
  const base = { kind: "door", atMm: 1000, widthMm: 900, heightMm: 2100, heightAboveFloorMm: 0 };
  const tips = new Set();
  const hinges = new Set();
  for (const hinge of ["start", "end"]) {
    for (const swing of ["left", "right"]) {
      const leaf = drawingDoorLeaf(wall, { ...base, hinge, swing });
      tips.add(leaf.tip.x + "/" + leaf.tip.y);
      hinges.add(leaf.hinge.x + "/" + leaf.hinge.y);
      assert.equal(
        Math.round(Math.hypot(leaf.tip.x - leaf.hinge.x, leaf.tip.y - leaf.hinge.y)),
        900,
        "полотно длиной в проём",
      );
      assert.equal(
        Math.round(Math.hypot(leaf.closed.x - leaf.hinge.x, leaf.closed.y - leaf.hinge.y)),
        900,
        "закрытое положение — второй косяк",
      );
    }
  }
  assert.equal(tips.size, 4, "четыре разных кончика полотна — четыре разные двери");
  assert.equal(hinges.size, 2, "петли бывают у двух косяков");
});

test("петли у начала — у ближнего к началу стены косяка, сторона — левая нормаль", () => {
  const wall = { aMm: { x: 0, y: 0 }, bMm: { x: 4000, y: 0 }, thicknessMm: 100 };
  const leaf = drawingDoorLeaf(wall, {
    kind: "door",
    atMm: 1000,
    widthMm: 900,
    hinge: "start",
    swing: "left",
  });
  assert.deepEqual(leaf.hinge, { x: 1000, y: 0 });
  assert.deepEqual(leaf.closed, { x: 1900, y: 0 });
  assert.deepEqual(leaf.tip, { x: 1000, y: -900 }, "налево от направления стены — вверх по экрану");
});

test("призрак и клик считаются одной попыткой: проверки модели не переписаны", () => {
  const base = drawnRoom();
  const wall = wallsOnScheme(base.project, base.schemeId)[0];
  const good = workshopTryOpening(
    base.project,
    { wallId: wall.id, kind: "window", atMm: 1000, widthMm: 1500, heightMm: 1400, heightAboveFloorMm: 800 },
    null,
  );
  assert.equal(good.ok, true);
  assert.equal(openingsInWall(good.project, wall.id).length, 1);

  const wide = workshopTryOpening(
    base.project,
    { wallId: wall.id, kind: "window", atMm: 0, widthMm: 99000, heightMm: 1400, heightAboveFloorMm: 800 },
    null,
  );
  assert.equal(wide.ok, false);
  assert.match(wide.message, /шире стены/, "слова берутся у модели, а не придумываются заново: " + wide.message);

  const overlap = workshopTryOpening(
    good.project,
    { wallId: wall.id, kind: "door", atMm: 1200, widthMm: 900, heightMm: 2100, heightAboveFloorMm: 0 },
    null,
  );
  assert.equal(overlap.ok, false);
  assert.match(overlap.message, /налезают/, overlap.message);

  // Встык — законно, и окно обязано это пропустить.
  const touching = workshopTryOpening(
    good.project,
    { wallId: wall.id, kind: "door", atMm: 2500, widthMm: 900, heightMm: 2100, heightAboveFloorMm: 0 },
    null,
  );
  assert.equal(touching.ok, true, touching.message);
});

test("проём выше потолка не проходит, и сказано это высотой схемы", () => {
  const base = drawnRoom();
  const low = setSchemeWallHeight(base.project, base.schemeId, 2000).project;
  const wall = wallsOnScheme(low, base.schemeId)[0];
  const attempt = workshopTryOpening(
    low,
    { wallId: wall.id, kind: "window", atMm: 500, widthMm: 1500, heightMm: 1400, heightAboveFloorMm: 800 },
    null,
  );
  assert.equal(attempt.ok, false);
  assert.match(attempt.message, /2200/, attempt.message);
});

test("умолчания по виду заведены на все четыре и похожи на то, что ставят", () => {
  for (const kind of OPENING_KINDS) {
    const sizes = WORKSHOP_OPENING_DEFAULTS[kind];
    assert.ok(sizes, "у вида «" + kind + "» нет умолчаний");
    assert.ok(sizes.widthMm > 0 && sizes.heightMm > 0 && sizes.heightAboveFloorMm >= 0);
    // Под потолок 2700 должно влезать всё: иначе первое же умолчание упрётся в
    // отказ модели «проём выше помещения».
    assert.ok(sizes.heightAboveFloorMm + sizes.heightMm <= 2700, kind + " не влезает под потолок 2700");
  }
  assert.equal(WORKSHOP_OPENING_DEFAULTS.door.heightAboveFloorMm, 0, "дверь стоит на полу");
  assert.ok(WORKSHOP_OPENING_DEFAULTS.window.heightAboveFloorMm > 0, "у окна есть подоконник");
});

// ——— таск 126: объекты на полу ————————————————————————————————————————

test("умолчания объектов заведены на все девять стартовых видов", () => {
  for (const [key, name] of Object.entries(strings.schemeObjectKinds)) {
    const defaults = workshopObjectDefaultsByName(name);
    assert.ok(defaults, "у вида «" + name + "» нет умолчаний");
    assert.ok(SCHEME_OBJECT_SHAPES.includes(defaults.shape), key + ": форма неизвестна");
    assert.ok(defaults.depthMm > 0, key + ": глубина должна быть положительной");
    if (defaults.shape === "rect") assert.ok(defaults.widthMm > 0, key + ": ширина должна быть положительной");
  }
});

test("радиатор и столешница выражают то, ради чего объекты заведены", () => {
  const radiator = workshopObjectDefaultsByName(strings.schemeObjectKinds.radiator);
  assert.ok(radiator.heightMm > 0 && radiator.heightAboveFloorMm > 0, "радиатор висит, а не лежит");
  const counter = workshopObjectDefaultsByName(strings.schemeObjectKinds.counter);
  assert.equal(counter.shape, "polyline", "кухонный фронт идёт полосой по стене");
  assert.equal(
    counter.heightAboveFloorMm + counter.heightMm,
    900,
    "верх столешницы на 900 — от этого числа отмеряют розетки над ней",
  );
});

test("незнакомому виду достаётся квадрат, а не пустота", () => {
  const own = workshopObjectDefaultsByName("Аквариум");
  assert.deepEqual(own, { ...WORKSHOP_OBJECT_FALLBACK });
  assert.equal(workshopObjectDefaultsByName(null).shape, "rect");
});

test("углы прямоугольного объекта поворачиваются вокруг середины", () => {
  const object = { shape: "rect", atMm: { x: 1000, y: 500 }, widthMm: 1200, depthMm: 100, turnDeg: 0 };
  const corners = schemeObjectCorners(object);
  assert.equal(corners.length, 4);
  assert.deepEqual(corners[0], { x: 400, y: 450 });
  assert.deepEqual(corners[2], { x: 1600, y: 550 });
  const turned = schemeObjectCorners({ ...object, turnDeg: 90 });
  // Поворот вокруг середины оставляет вещь там, где её поставили.
  const middle = turned.reduce((sum, point) => ({ x: sum.x + point.x / 4, y: sum.y + point.y / 4 }), { x: 0, y: 0 });
  assert.ok(Math.abs(middle.x - 1000) < 0.001 && Math.abs(middle.y - 500) < 0.001);
  assert.ok(Math.abs(turned[0].x - 1050) < 0.001 && Math.abs(turned[0].y + 100) < 0.001);
});

test("попадание в объект: внутрь прямоугольника и в полосу ломаной", () => {
  const rect = { shape: "rect", atMm: { x: 0, y: 0 }, widthMm: 1000, depthMm: 400, turnDeg: 0 };
  assert.equal(drawingHitObject(rect, { x: 100, y: 100 }, 0), true);
  assert.equal(drawingHitObject(rect, { x: 100, y: 400 }, 0), false);
  assert.equal(drawingHitObject(rect, { x: 100, y: 240 }, 50), true, "край ловится с припуском");
  const band = { shape: "polyline", pointsMm: [{ x: 0, y: 0 }, { x: 2000, y: 0 }], depthMm: 600 };
  assert.equal(drawingHitObject(band, { x: 1000, y: 250 }, 0), true);
  assert.equal(drawingHitObject(band, { x: 1000, y: 400 }, 0), false);
});

test("под курсором выигрывает проём, а не стена, в которой он стоит", () => {
  const base = drawnRoom();
  const wall = wallsOnScheme(base.project, base.schemeId)[0];
  const added = addOpening(base.project, {
    wallId: wall.id,
    kind: "window",
    atMm: 1000,
    widthMm: 1500,
    heightMm: 1400,
    heightAboveFloorMm: 800,
  });
  const view = viewOf({ zoom: 1 });
  const onOpening = workshopPick(added.project, base.schemeId, { x: wall.aMm.x + 1700, y: wall.aMm.y }, view, null);
  assert.equal(onOpening.kind, "opening");
  assert.equal(onOpening.id, added.opening.id);
  const onWall = workshopPick(added.project, base.schemeId, { x: wall.aMm.x + 3000, y: wall.aMm.y }, view, null);
  assert.equal(onWall.kind, "wall");
});

test("у выделенной двери ручки створки старше всего остального", () => {
  const base = drawnRoom();
  const wall = wallsOnScheme(base.project, base.schemeId)[0];
  const added = addOpening(base.project, {
    wallId: wall.id,
    kind: "door",
    atMm: 1000,
    widthMm: 900,
    heightMm: 2100,
    heightAboveFloorMm: 0,
    hinge: "start",
    swing: "left",
  });
  const leaf = drawingDoorLeaf(wall, added.opening);
  const view = viewOf({ zoom: 1 });
  const chosen = { kind: "opening", id: added.opening.id };
  assert.equal(workshopPick(added.project, base.schemeId, leaf.hinge, view, chosen).kind, "hinge");
  assert.equal(workshopPick(added.project, base.schemeId, leaf.tip, view, chosen).kind, "swing");
  // Без выделения ручек нет вовсе — кончик полотна висит в воздухе посреди
  // комнаты, и ловить там нечего.
  assert.equal(workshopPick(added.project, base.schemeId, leaf.tip, view, null), null);
});

test("состояние называет проёмы и объекты, когда они есть", () => {
  const base = drawnRoom();
  const wall = wallsOnScheme(base.project, base.schemeId)[0];
  const quiet = workshopStatus(base.project, base.schemeId, workshopPlacement(base.project, base.schemeId));
  assert.ok(!quiet.includes("проёмов"), "пустого счёта в строке нет: " + quiet);
  const added = addOpening(base.project, {
    wallId: wall.id,
    kind: "window",
    atMm: 1000,
    widthMm: 1500,
    heightMm: 1400,
    heightAboveFloorMm: 800,
  });
  const line = workshopStatus(added.project, base.schemeId, workshopPlacement(added.project, base.schemeId));
  assert.match(line, /проёмов 1/, line);
});

test("G68: объект с чертежом, но без проёмов, пустого списка не заводит", () => {
  const base = drawnRoom();
  assert.ok(!Object.prototype.hasOwnProperty.call(base.project, "openings"));
  assert.ok(!Object.prototype.hasOwnProperty.call(base.project, "schemeObjects"));
  assert.ok(!Object.prototype.hasOwnProperty.call(base.project, "schemeObjectKinds"));
});

test("подсказка под полем своя у каждого занятия — чужих слов не показывает", () => {
  const seen = new Set();
  for (const tool of ["walls", "openings", "objects", "edit"]) {
    const line = workshopHint(tool);
    assert.ok(line && line.length > 20, tool + ": подсказки нет");
    seen.add(line);
  }
  assert.equal(seen.size, 4, "у каждого занятия своя подсказка");
  assert.match(workshopHint("openings"), /стену/, "проёмы говорят про стену, а не про вершину цепочки");
  assert.match(workshopHint("walls"), /вершина стены/);
  // Незнакомое занятие не оставляет человека без слов.
  assert.equal(workshopHint("какое-то"), workshopHint("walls"));
});

// ——— масштаб задаётся в мастерской (таск 132, дефект D22) ——————————————
//
// Чем здесь легко соврать: показать картинку, подразумевая миллиметры, которых
// нет. Поэтому проверяется не «видно ли» — это дело живого прогона, — а **чем
// меряется кадр**: габарит в точках подложки, доли из тех же точек и согласие
// этих долей с моделью.

test("окно открывается тем, что в нём есть что делать", () => {
  // Подложка без калибровки — масштабом: без него не нарисовать ни стены, и
  // человек, пришедший обводить план, первым делом обязан увидеть сам план.
  const noScale = addScheme(createProject(), { name: "без масштаба", imageId: "p", width: 1200, height: 800 });
  assert.equal(workshopInitialTool(noScale.project, noScale.scheme.id), WORKSHOP_TOOL_SCALE);
  // Чертёж уже есть — **выделением** (таск 133): холст открывается в нём по
  // той же причине. Прежде окно открывалось прямо в рисовании стен, и ровно на
  // это заказчик и пожаловался: «рисую стены, а как мне выбрать текущую».
  const drawn = drawnRoom();
  assert.equal(workshopInitialTool(drawn.project, drawn.schemeId), "edit");
  assert.equal(workshopModeOf(workshopInitialTool(drawn.project, drawn.schemeId)), "select");
  // Чертежа ещё нет — добавлением: выделять нечего, и окно со словами «клик
  // выделяет» над пустым полем читалось бы сломанным.
  const ready = planProject();
  assert.equal(workshopModeOf(workshopInitialTool(ready.project, ready.schemeId)), "add");
  const blank = blankProject();
  assert.equal(workshopModeOf(workshopInitialTool(blank.project, blank.schemeId)), "add");
});

test("кадр занятия «Масштаб» меряется точками подложки, а не миллиметрами", () => {
  const noScale = addScheme(createProject(), { name: "без масштаба", imageId: "p", width: 1200, height: 800 });
  const extent = workshopPlanExtent(noScale.project, noScale.scheme.id);
  // Габарит — ровно картинка: левый верхний угол в нуле, правый нижний в её
  // размере. Миллиметров в этом габарите нет ни одного.
  assert.deepEqual(extent, { minX: 0, minY: 0, maxX: 1200, maxY: 800 });
  // Вписывается целиком и попадает серединой в середину поля.
  const view = workshopFitView(extent, { width: 600, height: 400 }, WORKSHOP_PLAN_ZOOM_MAX);
  const middle = planToScreen({ x: 600, y: 400 }, WORKSHOP_UNIT, view);
  assert.ok(Math.abs(middle.x - 300) < 0.001 && Math.abs(middle.y - 200) < 0.001, "середина картинки — середина поля");
  const corner = planToScreen({ x: 1200, y: 800 }, WORKSHOP_UNIT, view);
  assert.ok(corner.x <= 600 && corner.y <= 400, "картинка влезла целиком: " + JSON.stringify(corner));
  // У схемы без подложки кадра нет вовсе — калибровать нечего.
  const blank = blankProject();
  assert.equal(workshopPlanExtent(blank.project, blank.schemeId), null);
});

test("точка подложки превращается в долю плана и зажимается её краем", () => {
  const noScale = addScheme(createProject(), { name: "без масштаба", imageId: "p", width: 1200, height: 800 });
  const id = noScale.scheme.id;
  assert.deepEqual(workshopPlanFraction(noScale.project, id, { x: 600, y: 400 }), { x: 0.5, y: 0.5 });
  assert.deepEqual(workshopPlanFraction(noScale.project, id, { x: 300, y: 200 }), { x: 0.25, y: 0.25 });
  // Конец отрезка, выведенный за край картинки, принадлежит краю: доли живут
  // в 0…1 (ADR 002), и выпускать их за эти границы нельзя.
  assert.deepEqual(workshopPlanFraction(noScale.project, id, { x: -50, y: 2000 }), { x: 0, y: 1 });
});

test("отрезок, проведённый в окне, даёт тот же масштаб, что калибровка на холсте", () => {
  const noScale = addScheme(createProject(), { name: "без масштаба", imageId: "p", width: 1200, height: 800 });
  const id = noScale.scheme.id;
  // Полширины картинки объявлены шестью метрами: 600 точек на 6 м — сто точек
  // на метр, как в остальных тестах этого файла.
  const a = workshopPlanFraction(noScale.project, id, { x: 300, y: 400 });
  const b = workshopPlanFraction(noScale.project, id, { x: 900, y: 400 });
  const scaled = setPlanScale(noScale.project, id, { a, b, meters: 6 }).project;
  assert.ok(Math.abs(planPixelsPerMeter(scaled, id) - 100) < 1e-6, planPixelsPerMeter(scaled, id));
  const size = planSizeMeters(scaled, id);
  assert.ok(Math.abs(size.width - 12) < 1e-6 && Math.abs(size.height - 8) < 1e-6, JSON.stringify(size));
  // Масштаб задан — подложку теперь есть на что положить, и слой доступен.
  const spot = workshopPlacement(scaled, id);
  assert.equal(spot.kind, "ready");
  assert.equal(spot.pending, true, "привязку всё так же ставит первая стена, а не калибровка");
  // До калибровки — отказ, и он не изменился: это и есть честное ограничение.
  assert.equal(workshopPlacement(noScale.project, id).kind, "noScale");
});

test("подсказка занятия «Масштаб» — та же, что над холстом: второго описания жеста нет", () => {
  assert.equal(workshopHint(WORKSHOP_TOOL_SCALE), strings.scale.hint);
  assert.notEqual(workshopHint(WORKSHOP_TOOL_SCALE), workshopHint("walls"));
});

test("потолок увеличения свой у каждого кадра: точка плана крупнее миллиметра", () => {
  // Один предел на оба кадра не годится: в миллиметровом полтора пикселя на
  // миллиметр — это уже некуда, а в кадре подложки это полтора пикселя на
  // точку фотографии, и конец стены на ней не поймать.
  assert.equal(workshopClampZoom(1e6), WORKSHOP_ZOOM_MAX);
  assert.equal(workshopClampZoom(1e6, WORKSHOP_PLAN_ZOOM_MAX), WORKSHOP_PLAN_ZOOM_MAX);
  assert.ok(WORKSHOP_PLAN_ZOOM_MAX > WORKSHOP_ZOOM_MAX);
  // Снизу предел общий: километровый план в окошко глубже не вписывается.
  assert.equal(workshopClampZoom(0, WORKSHOP_PLAN_ZOOM_MAX), WORKSHOP_ZOOM_MIN);
});

// ——— два уровня: режим и что добавляем (таск 133, G184 и G185) —————————
//
// Проверяется сам шов: снаружи окна уровня два, внутри поле одно, и перевод
// между ними обязан сходиться в обе стороны. Разойдись он — нашлась бы пара
// «режим добавления, а добавлять нечего», и кнопка горела бы не та.

test("режим и занятие — два взгляда на одно поле, и перевод сходится в обе стороны", () => {
  for (const adding of WORKSHOP_ADDING) {
    assert.equal(workshopModeOf(adding), "add", adding + " читается добавлением");
    assert.equal(workshopToolOf("add", adding), adding);
  }
  assert.equal(workshopModeOf("edit"), "select");
  assert.equal(workshopToolOf("select", "walls"), "edit");
  assert.equal(workshopModeOf(WORKSHOP_TOOL_SCALE), WORKSHOP_TOOL_SCALE);
  assert.equal(workshopToolOf(WORKSHOP_TOOL_SCALE, "walls"), WORKSHOP_TOOL_SCALE);
  assert.equal(workshopModeOf(WORKSHOP_TOOL_ELEVATION), WORKSHOP_TOOL_ELEVATION);
  assert.equal(workshopToolOf(WORKSHOP_TOOL_ELEVATION, "objects"), WORKSHOP_TOOL_ELEVATION);
  // Каждый режим из списка отзывается занятием, и занятие читается тем же
  // режимом: пустых клеток в этой таблице нет.
  for (const mode of WORKSHOP_MODES) {
    assert.equal(workshopModeOf(workshopToolOf(mode, "walls")), mode, mode + " не вернулся собой");
  }
  // Мусор вместо «что добавляем» не оставляет окно без занятия.
  assert.equal(workshopToolOf("add", "чепуха"), "walls");
  assert.equal(workshopToolOf("add", undefined), "walls");
});

test("у каждого режима своя подсказка, и развёртка не зовёт править", () => {
  const seen = new Set();
  for (const tool of ["edit", "walls", "openings", "objects", WORKSHOP_TOOL_SCALE, WORKSHOP_TOOL_ELEVATION]) {
    const line = workshopHint(tool);
    assert.ok(line && line.length > 20, tool + ": подсказки нет");
    seen.add(line);
  }
  assert.equal(seen.size, 6, "подсказки режимов не повторяются");
  // В развёртке смотрят: про перетаскивание и удаление в ней нет ни слова, а
  // дорога к правке названа.
  const elevation = workshopHint(WORKSHOP_TOOL_ELEVATION);
  assert.ok(!/Delete|тянется/.test(elevation), "развёртка зовёт править: " + elevation);
  assert.match(elevation, /Выделение/);
});

// ——— объекты рисуются контуром и правятся вершинами (таск 137) ——————————
//
// Требования G193–G195. Слова заказчика: «при добавлении объектов типа
// „Прямоугольник“ позволь не просто выставлять размеры, а просто рисовать его,
// как сейчас метки — линии, только что бы обязательно надо было завершить
// контур. А так же позволь редактировать их таская за края… в процессе
// рисования над текущей линией указывай ей длину».
//
// Проверяется здесь то, чего живой прогон не поймает:
//
//   1. **Приведение контура к прямоугольнику.** Контур даёт многоугольник, а
//      форма модели — `rect` (середина, ширина, глубина, поворот). Правило
//      одно и названо: габарит в осях **первой нарисованной стороны**. Для
//      настоящего прямоугольника оно точное — туда и обратно без потерь.
//   2. **Правка за угол держит противоположный угол на месте.** Иначе вещь
//      уезжала бы из-под руки, и заметить это можно было бы только глазами.
//   3. **Одна дверь для предпросмотра и для записи** (`workshopObjectPatch`):
//      разойдись они — призрак обещал бы одно, а в объект уходило бы другое.
//   4. **G68:** объект, поставленный кликом, остаётся прежним — правка угла не
//      трогает ни вид, ни высоты, ни форму.

function withObject(base, fields) {
  const ready = ensureSchemeObjectKinds(base.project);
  const kindId = schemeObjectKindsInOrder(ready.project)[0].id;
  const added = addSchemeObject(ready.project, {
    schemeId: base.schemeId,
    kindId,
    heightMm: 500,
    heightAboveFloorMm: 150,
    ...fields,
  });
  return { project: added.project, schemeId: base.schemeId, object: added.schemeObject, kindId };
}

const boxOf = (points) => ({
  minX: Math.min(...points.map((point) => point.x)),
  minY: Math.min(...points.map((point) => point.y)),
  maxX: Math.max(...points.map((point) => point.x)),
  maxY: Math.max(...points.map((point) => point.y)),
});

test("замкнутый контур становится прямоугольником: габарит в осях первой стороны", () => {
  const rect = workshopRectFromContour([
    { x: 1000, y: 1000 },
    { x: 3400, y: 1000 },
    { x: 3400, y: 1600 },
    { x: 1000, y: 1600 },
  ]);
  assert.deepEqual(rect, { atMm: { x: 2200, y: 1300 }, widthMm: 2400, depthMm: 600, turnDeg: 0 });
});

test("контур прямоугольника возвращает тот же прямоугольник — и под углом тоже", () => {
  const source = { shape: "rect", atMm: { x: 5000, y: 4000 }, widthMm: 2400, depthMm: 600, turnDeg: 15 };
  const rect = workshopRectFromContour(schemeObjectCorners(source));
  assert.equal(rect.turnDeg, 15, "поворот взят у первой нарисованной стороны");
  // Углы модель округляет до целых миллиметров, поэтому обратный ход сходится
  // с точностью до миллиметра, а не до нуля.
  assert.ok(Math.abs(rect.widthMm - 2400) <= 1, "ширина: " + rect.widthMm);
  assert.ok(Math.abs(rect.depthMm - 600) <= 1, "глубина: " + rect.depthMm);
  assert.ok(Math.abs(rect.atMm.x - 5000) <= 1 && Math.abs(rect.atMm.y - 4000) <= 1);
});

test("первая сторона решает, что ширина: обвёл с короткой — она и ширина", () => {
  const along = workshopRectFromContour([
    { x: 1000, y: 1000 },
    { x: 1000, y: 1600 },
    { x: 3400, y: 1600 },
    { x: 3400, y: 1000 },
  ]);
  assert.equal(along.turnDeg, 90);
  assert.equal(along.widthMm, 600, "первой нарисована короткая сторона");
  assert.equal(along.depthMm, 2400);
  // На плане это тот же прямоугольник: середина и габарит совпадают с тем,
  // что вышло из обхода с длинной стороны.
  assert.deepEqual(along.atMm, { x: 2200, y: 1300 });
  assert.deepEqual(boxOf(schemeObjectCorners({ shape: "rect", ...along })), {
    minX: 1000,
    minY: 1000,
    maxX: 3400,
    maxY: 1600,
  });
});

test("замыкающая вершина ничего не меняет: контур замкнут и так", () => {
  const points = [
    { x: 0, y: 0 },
    { x: 2000, y: 0 },
    { x: 2000, y: 1000 },
    { x: 0, y: 1000 },
  ];
  assert.deepEqual(workshopRectFromContour([...points, { x: 0, y: 0 }]), workshopRectFromContour(points));
});

test("незамкнутым контуром объект не становится: двух вершин и прямой линии мало", () => {
  assert.equal(WORKSHOP_CONTOUR_MIN, 3);
  assert.equal(workshopRectFromContour([{ x: 0, y: 0 }, { x: 1000, y: 0 }]), null);
  assert.equal(workshopRectFromContour([]), null);
  // Три вершины на одной линии площади не дают — и прямоугольника тоже.
  assert.equal(
    workshopRectFromContour([{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 2000, y: 0 }]),
    null,
    "контур без площади",
  );
  // Два клика в одну точку — один клик, как у цепочки стен.
  assert.equal(
    workshopRectFromContour([{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 1000, y: 0 }]),
    null,
  );
});

test("кривой контур приводится габаритом — и накрывает всё, что обвели", () => {
  // Буква «Г»: человек обвёл кухонный фронт с заворотом. Прямоугольником это
  // не является, и приведение названо вслух — габарит в осях первой стороны.
  const points = [
    { x: 0, y: 0 },
    { x: 3000, y: 0 },
    { x: 3000, y: 600 },
    { x: 600, y: 600 },
    { x: 600, y: 2000 },
    { x: 0, y: 2000 },
  ];
  const rect = workshopRectFromContour(points);
  assert.equal(rect.turnDeg, 0);
  assert.equal(rect.widthMm, 3000);
  assert.equal(rect.depthMm, 2000);
  const box = boxOf(schemeObjectCorners({ shape: "rect", ...rect }));
  for (const point of points) {
    assert.ok(
      point.x >= box.minX && point.x <= box.maxX && point.y >= box.minY && point.y <= box.maxY,
      "вершина контура осталась снаружи габарита",
    );
  }
});

test("правка за угол держит противоположный угол на месте", () => {
  const object = { shape: "rect", atMm: { x: 2000, y: 1000 }, widthMm: 1000, depthMm: 400, turnDeg: 0 };
  const corners = schemeObjectCorners(object);
  assert.deepEqual(corners[0], { x: 1500, y: 800 });
  const patch = workshopRectCornerPatch(object, 0, { x: 1000, y: 500 });
  assert.deepEqual(patch, { atMm: { x: 1750, y: 850 }, widthMm: 1500, depthMm: 700 });
  const after = schemeObjectCorners({ ...object, ...patch });
  assert.deepEqual(after[2], corners[2], "угол напротив не сдвинулся ни на миллиметр");
  assert.deepEqual(after[0], { x: 1000, y: 500 }, "взятый угол встал под руку");
});

test("повёрнутый прямоугольник правится за угол по своим осям", () => {
  const object = { shape: "rect", atMm: { x: 4000, y: 3000 }, widthMm: 2000, depthMm: 800, turnDeg: 90 };
  const corners = schemeObjectCorners(object);
  const patch = workshopRectCornerPatch(object, 1, { x: corners[1].x + 300, y: corners[1].y + 500 });
  const after = schemeObjectCorners({ ...object, ...patch });
  assert.deepEqual(after[3], corners[3], "угол напротив держится");
  // Поворот правка угла не трогает: вещь растянули, а не повернули.
  assert.equal(patch.turnDeg, undefined);
});

test("угол, сведённый в точку, оставляет миллиметр, а не нуль", () => {
  const object = { shape: "rect", atMm: { x: 1000, y: 1000 }, widthMm: 600, depthMm: 600, turnDeg: 0 };
  const corners = schemeObjectCorners(object);
  const patch = workshopRectCornerPatch(object, 0, corners[2]);
  assert.equal(patch.widthMm, 1);
  assert.equal(patch.depthMm, 1);
  // Модель прямоугольник нулевого размера не принимает — значит и окно не
  // должно его предлагать.
  assert.doesNotThrow(() => schemeObjectCorners({ ...object, ...patch }));
});

test("ломаная объекта правится теми же четырьмя движениями, что ломаная метки", () => {
  const points = [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 1000, y: 800 }];
  assert.deepEqual(workshopPointsMove(points, 1, { x: 1200, y: 100 }), [
    { x: 0, y: 0 },
    { x: 1200, y: 100 },
    { x: 1000, y: 800 },
  ]);
  // Вершина от ручки на середине встаёт **за** своим отрезком, как на холсте.
  assert.deepEqual(workshopPointsInsert(points, 0, { x: 500, y: -200 }), [
    { x: 0, y: 0 },
    { x: 500, y: -200 },
    { x: 1000, y: 0 },
    { x: 1000, y: 800 },
  ]);
  assert.deepEqual(workshopPointsExtend(points, "start", { x: -500, y: 0 })[0], { x: -500, y: 0 });
  assert.deepEqual(workshopPointsExtend(points, "end", { x: 1000, y: 1500 })[3], { x: 1000, y: 1500 });
  assert.deepEqual(workshopPointsRemove(points, 1), [{ x: 0, y: 0 }, { x: 1000, y: 800 }]);
  // Исходный список не меняется ни одним из движений: правит объект только
  // модель, а здесь считают новый список.
  assert.deepEqual(points, [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 1000, y: 800 }]);
  // Мимо списка — ничего: промах по индексу не роняет и не выдумывает вершину.
  assert.equal(workshopPointsMove(points, 7, { x: 0, y: 0 }), null);
  assert.equal(workshopPointsInsert(points, -1, { x: 0, y: 0 }), null);
  assert.equal(workshopPointsExtend(points, "середина", { x: 0, y: 0 }), null);
});

test("из полосы в две вершины вершину не убрать — и отказывает это модель", () => {
  const base = planProject();
  const made = withObject(base, {
    shape: "polyline",
    pointsMm: [{ x: 0, y: 0 }, { x: 2000, y: 0 }],
    depthMm: 600,
  });
  const short = workshopPointsRemove(made.object.pointsMm, 0);
  assert.deepEqual(short, [{ x: 2000, y: 0 }], "список считается, а запрет живёт в модели");
  assert.throws(
    () => updateSchemeObject(made.project, made.object.id, { pointsMm: short }),
    (error) => error.message === strings.errors.schemeObjectShortLine,
  );
});

test("ручки объекта взяты у холста: вершины, середины отрезков и концы полосы", () => {
  const view = viewOf({ zoom: 1 });
  const band = {
    shape: "polyline",
    pointsMm: [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 1000, y: 800 }],
    depthMm: 600,
  };
  const handles = workshopObjectHandles(band, view);
  const kinds = handles.map((handle) => handle.kind);
  assert.equal(kinds.filter((kind) => kind === "vertex").length, 3);
  assert.equal(kinds.filter((kind) => kind === "insert").length, 2, "по ручке на каждый отрезок");
  assert.equal(kinds.filter((kind) => kind === "extend").length, 2, "полоса не замкнута — у неё два конца");
  // Вершина в списке раньше середины и конца: спор за клик решается порядком,
  // ровно как у холста (`render.pathEditHandles`).
  assert.equal(handles[0].kind, "vertex");
  // У прямоугольника ручек ровно четыре — это углы, а не путь: вставлять в
  // прямоугольник пятый угол и продолжать его некуда.
  const rect = workshopObjectHandles(
    { shape: "rect", atMm: { x: 2000, y: 1000 }, widthMm: 1000, depthMm: 400, turnDeg: 0 },
    view,
  );
  assert.equal(rect.length, 4);
  assert.deepEqual([...new Set(rect.map((handle) => handle.kind))], ["vertex"]);
});

test("ручка выделенного объекта старше его тела — ею и правят", () => {
  const base = drawnRoom();
  const made = withObject(
    { project: base.project, schemeId: base.schemeId },
    { shape: "rect", atMm: { x: 2000, y: 1500 }, widthMm: 1000, depthMm: 600, turnDeg: 0 },
  );
  const view = viewOf({ zoom: 1 });
  const chosen = { kind: "object", id: made.object.id };
  const corner = schemeObjectCorners(made.object)[0];
  const onHandle = workshopPick(made.project, made.schemeId, corner, view, chosen);
  assert.equal(onHandle.kind, "objectHandle");
  assert.equal(onHandle.id, made.object.id);
  assert.equal(onHandle.handle.kind, "vertex");
  assert.equal(onHandle.handle.index, 0);
  // Тело объекта берётся как прежде — целиком (G68: прежняя рука цела).
  const onBody = workshopPick(made.project, made.schemeId, { x: 2000, y: 1500 }, view, chosen);
  assert.equal(onBody.kind, "object");
  // Без выделения ручек нет: угол объекта — такое же пустое место, как и был.
  assert.equal(workshopPick(made.project, made.schemeId, corner, view, null).kind, "object");
});

test("предпросмотр и запись — одна дверь: патч считается один раз", () => {
  const base = planProject();
  const made = withObject(base, {
    shape: "polyline",
    pointsMm: [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 1000, y: 800 }],
    depthMm: 600,
  });
  const view = viewOf({ zoom: 1 });
  const handles = workshopObjectHandles(made.object, view);
  const vertex = handles.find((handle) => handle.kind === "vertex" && handle.index === 1);
  const insert = handles.find((handle) => handle.kind === "insert" && handle.index === 0);
  const extend = handles.find((handle) => handle.kind === "extend" && handle.end === "start");
  const moved = workshopObjectPatch(made.object, vertex, { x: 1200, y: 100 });
  assert.deepEqual(moved.pointsMm[1], { x: 1200, y: 100 });
  assert.equal(workshopObjectPatch(made.object, insert, { x: 500, y: -300 }).pointsMm.length, 4);
  assert.deepEqual(workshopObjectPatch(made.object, extend, { x: -400, y: 0 }).pointsMm[0], { x: -400, y: 0 });
  // Патч ложится в модель как есть — иначе предпросмотр обещал бы одно, а в
  // объект уходило бы другое.
  const after = updateSchemeObject(made.project, made.object.id, moved).schemeObject;
  assert.deepEqual(after.pointsMm, moved.pointsMm);
  assert.equal(after.shape, "polyline");
  // Прямоугольник той же дверью правится за угол, а середины и концы ему не
  // полагаются — у него их нет.
  const rect = { shape: "rect", atMm: { x: 0, y: 0 }, widthMm: 1000, depthMm: 400, turnDeg: 0 };
  assert.deepEqual(
    workshopObjectPatch(rect, { kind: "vertex", index: 2 }, { x: 800, y: 300 }),
    workshopRectCornerPatch(rect, 2, { x: 800, y: 300 }),
  );
  assert.equal(workshopObjectPatch(rect, { kind: "insert", index: 0 }, { x: 0, y: 0 }), null);
});

test("опора магнита у правимой вершины — соседняя, и сама с собой она не равняется", () => {
  const points = [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 1000, y: 800 }];
  // Правило взято у холста (`canvasPathSnap`): опора идёт последней, правимая
  // вершина в источники не попадает.
  assert.deepEqual(workshopPathSources(points, 0, 1), [{ x: 1000, y: 800 }, { x: 0, y: 0 }]);
  assert.deepEqual(workshopPathSources(points, 1, 2), [{ x: 0, y: 0 }, { x: 1000, y: 0 }]);
  // У новой вершины опора — та, от которой она растёт, и пропускать нечего.
  assert.deepEqual(workshopPathSources(points, 2, -1), [
    { x: 0, y: 0 },
    { x: 1000, y: 0 },
    { x: 1000, y: 800 },
  ]);
});

test("длина стоит над отрезком, а не под ним и не в стороне", () => {
  const gap = 12;
  const flat = workshopLengthAt({ x: 100, y: 200 }, { x: 300, y: 200 }, gap);
  assert.equal(flat.x, 200, "середина отрезка");
  assert.equal(flat.y, 200 - gap, "над отрезком");
  // Отрезок, нарисованный в обратную сторону, подпись не переворачивает.
  assert.deepEqual(workshopLengthAt({ x: 300, y: 200 }, { x: 100, y: 200 }, gap), flat);
  const steep = workshopLengthAt({ x: 100, y: 100 }, { x: 100, y: 500 }, gap);
  assert.equal(steep.y, 300);
  assert.equal(Math.abs(steep.x - 100), gap, "у вертикали подпись уходит в сторону");
  // Нулевой отрезок подписи не получает — её некуда повернуть.
  assert.equal(workshopLengthAt({ x: 10, y: 10 }, { x: 10, y: 10 }, gap), null);
});

test("три способа поставить объект, и у каждого своя форма в модели", () => {
  assert.deepEqual(WORKSHOP_OBJECT_WAYS, ["rect", "contour", "polyline"]);
  assert.equal(workshopShapeOfWay("rect"), "rect");
  assert.equal(workshopShapeOfWay("contour"), "rect", "контур даёт прямоугольник");
  assert.equal(workshopShapeOfWay("polyline"), "polyline");
  // Форм в модели по-прежнему две, и каждая достижима.
  for (const shape of SCHEME_OBJECT_SHAPES) {
    assert.ok(
      WORKSHOP_OBJECT_WAYS.some((way) => workshopShapeOfWay(way) === shape),
      shape + ": формы не поставить ни одним способом",
    );
    assert.equal(workshopShapeOfWay(workshopWayOfShape(shape)), shape);
  }
  // Поставленный объект не помнит, каким способом его нарисовали, — и врать об
  // этом нельзя: у прямоугольника способ читается прямоугольником.
  assert.equal(workshopWayOfShape("rect"), "rect");
  assert.equal(workshopWayOfShape("polyline"), "polyline");
});

test("G68: объект, поставленный кликом, правка угла не меняет ни в чём остальном", () => {
  const base = planProject();
  const made = withObject(base, {
    shape: "rect",
    atMm: { x: 1000, y: 500 },
    widthMm: 1200,
    depthMm: 100,
    turnDeg: 30,
  });
  const patch = workshopRectCornerPatch(made.object, 0, { x: 300, y: 300 });
  const after = updateSchemeObject(made.project, made.object.id, patch).schemeObject;
  assert.equal(after.shape, "rect");
  assert.equal(after.kindId, made.kindId);
  assert.equal(after.turnDeg, 30, "поворот прежний");
  assert.equal(after.heightMm, 500);
  assert.equal(after.heightAboveFloorMm, 150);
  // И числами он правится как прежде: правка угла прежней правки не отменяет.
  const typed = updateSchemeObject(made.project, made.object.id, {
    widthMm: 1300,
    depthMm: 120,
    turnDeg: 45,
  }).schemeObject;
  assert.equal(typed.widthMm, 1300);
  assert.equal(typed.depthMm, 120);
  assert.equal(typed.turnDeg, 45);
  assert.deepEqual(findSchemeObject(made.project, made.object.id).atMm, { x: 1000, y: 500 });
});

test("у каждого способа своя подсказка: про замыкание контура читает тот, кто его обводит", () => {
  const click = workshopHint("objects", "rect");
  const contour = workshopHint("objects", "contour");
  const band = workshopHint("objects", "polyline");
  assert.equal(new Set([click, contour, band]).size, 3, "подсказки способов повторяются");
  assert.match(contour, /амкн/, "про обязательное замыкание не сказано");
  assert.ok(!/амкн/.test(click), "клик зовёт замыкать контур: " + click);
  // Длина при рисовании названа там, где рисуют (G195).
  assert.match(contour, /[Дд]лина/);
  assert.match(band, /[Дд]лина/);
  // Способ не назван — подсказка та же, что у клика: умолчание способа — он.
  assert.equal(workshopHint("objects"), click);
  // Правка называет и ручки полосы, и углы объекта (G194).
  const edit = workshopHint("edit");
  assert.match(edit, /угл/);
  assert.match(edit, /середине отрезка/);
});

test("опора угла у прямоугольника — соседний угол по кольцу, а у полосы — предыдущая вершина", () => {
  const corners = schemeObjectCorners({
    shape: "rect",
    atMm: { x: 0, y: 0 },
    widthMm: 1000,
    depthMm: 400,
    turnDeg: 0,
  });
  // У прямоугольника углы — кольцо: у первого опора последний, а не второй.
  assert.deepEqual(workshopPathAnchor(corners, { kind: "vertex", index: 0, ring: true }), {
    anchorIndex: 3,
    skipIndex: 0,
  });
  assert.deepEqual(workshopPathAnchor(corners, { kind: "vertex", index: 2, ring: true }), {
    anchorIndex: 1,
    skipIndex: 2,
  });
  // У полосы концов два, и у первой вершины опорой служит вторая.
  const points = [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 1000, y: 800 }];
  assert.deepEqual(workshopPathAnchor(points, { kind: "vertex", index: 0 }), { anchorIndex: 1, skipIndex: 0 });
  // Новая вершина растёт от своей ручки, и пропускать нечего.
  assert.deepEqual(workshopPathAnchor(points, { kind: "insert", index: 1 }), { anchorIndex: 1, skipIndex: -1 });
  assert.deepEqual(workshopPathAnchor(points, { kind: "extend", index: 2, end: "end" }), {
    anchorIndex: 2,
    skipIndex: -1,
  });
});

test("жест выделяет вещь, а не ручку: иначе колонка свойств остаётся без предмета", () => {
  // Найдено живым прогоном: первая же правка угла выделяла «ручку», и в
  // колонке пропадали и вид, и размеры — править стало нечем.
  assert.deepEqual(workshopSelectionOf({ kind: "objectHandle", id: "o1", handle: { kind: "vertex", index: 0 } }), {
    kind: "object",
    id: "o1",
  });
  assert.deepEqual(workshopSelectionOf({ kind: "vertex", id: "w1", wallId: "w1" }), { kind: "wall", id: "w1" });
  assert.deepEqual(workshopSelectionOf({ kind: "object", id: "o2" }), { kind: "object", id: "o2" });
  assert.deepEqual(workshopSelectionOf({ kind: "opening", id: "p1" }), { kind: "opening", id: "p1" });
  assert.equal(workshopSelectionOf(null), null);
  // Чем выделение бывает — список один на всех, и всё, что из жеста выходит,
  // в нём есть: колонка свойств и проверка «живо ли выделенное» смотрят туда же.
  for (const pick of [
    { kind: "objectHandle", id: "o1" },
    { kind: "vertex", id: "w1", wallId: "w1" },
    { kind: "wall", id: "w1" },
    { kind: "opening", id: "p1" },
    { kind: "object", id: "o2" },
  ]) {
    const selection = workshopSelectionOf(pick);
    assert.ok(WORKSHOP_SUBJECTS.includes(selection.kind), pick.kind + " выделяет не предмет: " + selection.kind);
  }
});
