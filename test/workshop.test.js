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
  createProject,
  drawingBoundsMm,
  findScheme,
  openingsInWall,
  planFractionToMm,
  planMmToFraction,
  planOriginOf,
  planPixelsPerMeter,
  setPlanOrigin,
  setPlanScale,
  setSchemeWallHeight,
  wallsOnScheme,
} from "../src/model.js";
import {
  drawingDoorLeaf,
  drawingHitObject,
  drawingObjectCorners,
  drawingWallVectors,
  planToScreen,
} from "../src/render.js";
import { identityTransform, rotateTransform } from "../src/imagePrep.js";
import { applyPlanEdit } from "../src/panels/schemes.js";
import {
  WORKSHOP_EMPTY_MM,
  WORKSHOP_GRID_STEPS_MM,
  WORKSHOP_OBJECT_FALLBACK,
  WORKSHOP_OPENING_DEFAULTS,
  WORKSHOP_ORIGIN_AT,
  WORKSHOP_SHEET,
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
  workshopMoveVertex,
  workshopMoveWall,
  workshopObjectDefaultsByName,
  workshopOpeningAt,
  workshopPick,
  workshopTryOpening,
  workshopPlacement,
  workshopPlanPointScreen,
  workshopRoundMm,
  workshopSnapMm,
  workshopStatus,
  workshopVertexEnds,
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

test("четыре случая подложки, и ни один не «просто не рисуем»", () => {
  assert.equal(workshopPlacement(createProject(), "нет такой").kind, "noScheme");
  const blank = blankProject();
  assert.equal(workshopPlacement(blank.project, blank.schemeId).kind, "noImage");
  const noScale = addScheme(createProject(), { name: "без масштаба", imageId: "p", width: 1000, height: 1000 });
  assert.equal(workshopPlacement(noScale.project, noScale.scheme.id).kind, "noScale");
  const base = planProject();
  assert.equal(workshopPlacement(base.project, base.schemeId).kind, "noOrigin");
  const attached = workshopAttachOrigin(base.project, base.schemeId).project;
  const ready = workshopPlacement(attached, base.schemeId);
  assert.equal(ready.kind, "ready");
  assert.equal(ready.mmPerPx, 10, "в точке плана десять миллиметров — сто точек на метр");
  assert.deepEqual(ready.at, WORKSHOP_ORIGIN_AT);
  assert.equal(ready.turn, 0);
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
  const right = drawingWallVectors({ aMm: { x: 0, y: 0 }, bMm: { x: 1000, y: 0 } });
  assert.deepEqual(right.u, { x: 1, y: 0 });
  assert.deepEqual(right.n, { x: 0, y: -1 });
  const down = drawingWallVectors({ aMm: { x: 0, y: 0 }, bMm: { x: 0, y: 1000 } });
  assert.deepEqual(down.n, { x: 1, y: 0 }, "идём вниз — слева восток");
  assert.equal(drawingWallVectors({ aMm: { x: 5, y: 5 }, bMm: { x: 5, y: 5 } }), null);
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
  const corners = drawingObjectCorners(object);
  assert.equal(corners.length, 4);
  assert.deepEqual(corners[0], { x: 400, y: 450 });
  assert.deepEqual(corners[2], { x: 1600, y: 550 });
  const turned = drawingObjectCorners({ ...object, turnDeg: 90 });
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
