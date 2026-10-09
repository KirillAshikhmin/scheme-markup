// Чертёж на основном холсте и в выгрузке (таск 127, требование G174).
//
// Холста в Node нет, поэтому проверяется не картинка, а то, что до картинки:
//
//   1. **Мост миллиметров** на холсте считается своей арифметикой — один раз
//      на кадр, а не вызовом `planMmToFraction` на каждую точку. Разойдись он
//      с мостом модели — чертёж лёг бы мимо подложки, и заметили бы это
//      глазами на бумаге. Поэтому он сверяется с моделью на всех четырёх
//      поворотах подложки и на листе схемы без подложки.
//   2. **G68 буквально**: кадр объекта, которого не чертили, обязан состоять
//      из тех же вызовов холста, что и прежде. Проверяется не обещанием, а
//      записью каждого вызова — слой чертежа не смеет добавить ни одного.
//   3. **Чёрно-белый лист**: краска чертежа проходит через ту же подставку
//      `mono.js`, что и всё остальное, и своей развилки «рисуй без цвета» у
//      него нет.
//   4. **Подгонка схемы без подложки** идёт по нарисованному, а не по листу:
//      лист вчетверо больше квартиры, и вписанный целиком он показал бы её
//      маркой на поле.
import test from "node:test";
import assert from "node:assert/strict";

import {
  addMark,
  addScheme,
  addWall,
  createProject,
  findScheme,
  planMmToFraction,
  setPlanOrigin,
  setPlanScale,
  validate,
} from "../src/model.js";
import { drawScheme, drawingBridge, planToScreen } from "../src/render.js";
import { MONO_CLEAR, MONO_INK, MONO_PAPER, monoContext } from "../src/mono.js";
import { canvasFitDrawing } from "../src/canvas.js";
import { warningPlace } from "../src/panels/warnings.js";
import { workshopEnsureSheet, WORKSHOP_SHEET } from "../src/panels/workshop.js";

const viewOf = (patch) => ({ zoom: 1, offsetX: 0, offsetY: 0, markSize: 10, labelSize: 12, ...patch });

// План 1200 × 800 точек, в метре ровно 100 точек — та же сцена, что в тестах
// модели чертежа и мастерской.
function planProject() {
  const added = addScheme(createProject(), { name: "1 этаж", imageId: "plan-1", width: 1200, height: 800 });
  const project = setPlanScale(added.project, added.scheme.id, {
    a: { x: 0.1, y: 0.5 },
    b: { x: 0.6, y: 0.5 },
    meters: 6,
  }).project;
  return { project, schemeId: added.scheme.id };
}

function withWalls(base, count) {
  let project = base.project;
  for (let index = 0; index < count; index += 1) {
    project = addWall(project, {
      schemeId: base.schemeId,
      aMm: { x: index * 100, y: 0 },
      bMm: { x: index * 100, y: 3000 },
      thicknessMm: 100,
    }).project;
  }
  return project;
}

// ——— мост миллиметров —————————————————————————————————————————————————

test("мост холста совпадает с мостом модели — на всех четырёх поворотах", () => {
  const base = planProject();
  const view = viewOf({ zoom: 0.8, offsetX: 37, offsetY: -19 });
  for (const turn of [0, 90, 180, 270]) {
    const project = setPlanOrigin(base.project, base.schemeId, { at: { x: 0.3, y: 0.6 }, turn }).project;
    const scheme = findScheme(project, base.schemeId);
    const bridge = drawingBridge(project, scheme, view);
    assert.ok(bridge, "мост обязан быть: калибровка и привязка на месте");
    for (const mm of [{ x: 0, y: 0 }, { x: 4000, y: -2500 }, { x: -1234, y: 777 }]) {
      const mine = bridge.toScreen(mm);
      const theirs = planToScreen(planMmToFraction(project, base.schemeId, mm), scheme, view);
      assert.ok(
        Math.hypot(mine.x - theirs.x, mine.y - theirs.y) < 0.001,
        "поворот " + turn + ": холст рисует чертёж не там, где его видит модель",
      );
    }
    // Пикселей на миллиметр: сто точек плана на метр при зуме 0,8.
    assert.ok(Math.abs(bridge.pxPerMm - 0.1 * 0.8) < 1e-9, String(bridge.pxPerMm));
  }
});

test("без калибровки или без привязки моста нет — и чертёж не рисуется мимо", () => {
  const base = planProject();
  const scheme = findScheme(base.project, base.schemeId);
  assert.equal(drawingBridge(base.project, scheme, viewOf({})), null, "нет привязки — нет моста");
  const noScale = addScheme(createProject(), { name: "без масштаба", imageId: "p", width: 1000, height: 1000 });
  const origin = setPlanOrigin(noScale.project, noScale.scheme.id, { at: { x: 0.5, y: 0.5 }, turn: 0 }).project;
  assert.equal(drawingBridge(origin, findScheme(origin, noScale.scheme.id), viewOf({})), null);
});

test("лист схемы без подложки держит тот же мост, что подложка с калибровкой", () => {
  const blank = addScheme(createProject(), { name: "от руки" });
  const project = workshopEnsureSheet(blank.project, blank.scheme.id).project;
  const scheme = findScheme(project, blank.scheme.id);
  const view = viewOf({ zoom: 0.3, offsetX: 11, offsetY: 5 });
  const bridge = drawingBridge(project, scheme, view);
  assert.ok(bridge);
  for (const mm of [{ x: 0, y: 0 }, { x: 8000, y: 4500 }, { x: -15000, y: -9000 }]) {
    const mine = bridge.toScreen(mm);
    const theirs = planToScreen(planMmToFraction(project, scheme.id, mm), scheme, view);
    assert.ok(Math.hypot(mine.x - theirs.x, mine.y - theirs.y) < 0.001, JSON.stringify({ mm, mine, theirs }));
  }
  assert.equal(scheme.width, WORKSHOP_SHEET.width);
});

// ——— G68: кадр без чертежа не меняется ни одним вызовом ————————————————

// Холст-писец: записывает каждый вызов и каждое присваивание. Этого хватает,
// чтобы сказать «кадр тот же»: холст рисует только тем, что здесь записано.
function scribe() {
  const log = [];
  const impl = {
    canvas: { width: 1200, height: 900 },
    measureText: (value) => ({ width: String(value).length * 7 }),
    getTransform: () => ({ a: 1 }),
  };
  return {
    log,
    ctx: new Proxy(impl, {
      get(target, key) {
        if (key in target) return target[key];
        return (...args) => log.push(String(key) + "(" + args.map((value) => JSON.stringify(value)).join(",") + ")");
      },
      set(target, key, value) {
        log.push(String(key) + "=" + String(value));
        target[key] = value;
        return true;
      },
    }),
  };
}

function paint(project, scheme, options) {
  const probe = scribe();
  drawScheme(probe.ctx, {
    project,
    scheme,
    filter: null,
    view: viewOf({ zoom: 0.7, offsetX: 10, offsetY: 20 }),
    ...options,
  });
  return probe.log;
}

function markedPlan() {
  const base = planProject();
  let project = base.project;
  const spot = project.markTypes.find((type) => type.code === "Т").id;
  for (const point of [{ x: 0.2, y: 0.3 }, { x: 0.6, y: 0.7 }]) {
    project = addMark(project, { schemeId: base.schemeId, typeId: spot, points: [point] }).project;
  }
  return { project, scheme: findScheme(project, base.schemeId) };
}

test("G68: у объекта без чертежа кадр состоит из тех же вызовов, что прежде", () => {
  const scene = markedPlan();
  const withLayer = paint(scene.project, scene.scheme, {});
  const without = paint(scene.project, scene.scheme, { drawing: false });
  assert.ok(withLayer.length > 20, "сцена пустая — проверять нечего: " + withLayer.length);
  assert.deepEqual(withLayer, without, "слой чертежа тронул кадр объекта, которого не чертили");
});

test("у объекта без чертежа кадр не спрашивает про калибровку вовсе", () => {
  const scene = markedPlan();
  // Поля чертежа у такого объекта нет: `project.walls` отсутствует, и условие
  // в `drawScheme` до моста не доходит. Проверяется это тем, что объект
  // действительно без полей, — иначе проверка выше зелена по другой причине.
  assert.ok(!Object.prototype.hasOwnProperty.call(scene.project, "walls"));
  assert.ok(!Object.prototype.hasOwnProperty.call(scene.project, "schemeObjects"));
});

test("чертёж добавляет вызовы, и выключатель убирает ровно их", () => {
  const base = planProject();
  const project = setPlanOrigin(withWalls(base, 4), base.schemeId, { at: { x: 0.5, y: 0.5 }, turn: 0 }).project;
  const scheme = findScheme(project, base.schemeId);
  const shown = paint(project, scheme, {});
  const hidden = paint(project, scheme, { drawing: false });
  assert.ok(shown.length > hidden.length, "чертёж обязан что-то нарисовать");
  // Выключенный чертёж даёт ровно тот же кадр, что объект без чертежа вовсе.
  const bare = paint(base.project, findScheme(base.project, base.schemeId), {});
  assert.deepEqual(hidden, bare);
});

test("чертёж без привязки не рисуется и кадр не портит", () => {
  const base = planProject();
  const project = withWalls(base, 3);
  const scheme = findScheme(project, base.schemeId);
  assert.deepEqual(paint(project, scheme, {}), paint(project, scheme, { drawing: false }));
});

// ——— чёрно-белый лист ——————————————————————————————————————————————————

test("в чёрно-белом листе у чертежа нет ни одной цветной краски", () => {
  const base = planProject();
  let project = setPlanOrigin(withWalls(base, 3), base.schemeId, { at: { x: 0.5, y: 0.5 }, turn: 0 }).project;
  const scheme = findScheme(project, base.schemeId);
  const probe = scribe();
  drawScheme(monoContext(probe.ctx), {
    project,
    scheme,
    filter: null,
    view: viewOf({ zoom: 0.7 }),
  });
  const paints = probe.log
    .filter((entry) => entry.startsWith("fillStyle=") || entry.startsWith("strokeStyle="))
    .map((entry) => entry.slice(entry.indexOf("=") + 1));
  assert.ok(paints.length > 4, "краска на лист не ложилась — проверять нечего");
  const allowed = new Set([MONO_INK, MONO_PAPER, MONO_CLEAR]);
  assert.deepEqual([...new Set(paints)].filter((paint) => !allowed.has(paint)), []);
});

test("без подставки тот же чертёж красится своим цветом — иначе проверка слепа", () => {
  const base = planProject();
  const project = setPlanOrigin(withWalls(base, 3), base.schemeId, { at: { x: 0.5, y: 0.5 }, turn: 0 }).project;
  const scheme = findScheme(project, base.schemeId);
  const probe = scribe();
  drawScheme(probe.ctx, { project, scheme, filter: null, view: viewOf({ zoom: 0.7 }) });
  assert.ok(
    probe.log.some((entry) => entry === "strokeStyle=#30363d"),
    "стена обязана краситься своим цветом, когда подставки нет",
  );
});

// ——— подгонка схемы без подложки ———————————————————————————————————————

test("вписывается нарисованное, а не лист", () => {
  const blank = addScheme(createProject(), { name: "от руки" });
  let project = workshopEnsureSheet(blank.project, blank.scheme.id).project;
  project = addWall(project, {
    schemeId: blank.scheme.id,
    aMm: { x: -2000, y: -1000 },
    bMm: { x: 6000, y: 5000 },
    thicknessMm: 100,
  }).project;
  const scheme = findScheme(project, blank.scheme.id);
  const box = { width: 800, height: 600 };
  const view = canvasFitDrawing(project, scheme, box);
  const middle = planToScreen(
    planMmToFraction(project, scheme.id, { x: 2000, y: 2000 }),
    scheme,
    { ...view, markSize: 10, labelSize: 12 },
  );
  assert.ok(Math.abs(middle.x - 400) < 0.001 && Math.abs(middle.y - 300) < 0.001, JSON.stringify(middle));
  // Восемь метров по широкой стороне в восемьсот точек — около сотни точек на
  // метр, а не двадцать, как дал бы вписанный лист в сорок метров.
  const sheetFit = Math.min(box.width / scheme.width, box.height / scheme.height) * 0.96;
  assert.ok(view.zoom > sheetFit * 3, "лист вписался вместо чертежа: " + view.zoom + " против " + sheetFit);
});

test("нарисовать нечего — вписывается лист, а не пустота", () => {
  const blank = addScheme(createProject(), { name: "от руки" });
  const project = workshopEnsureSheet(blank.project, blank.scheme.id).project;
  const scheme = findScheme(project, blank.scheme.id);
  const view = canvasFitDrawing(project, scheme, { width: 800, height: 600 });
  assert.ok(view.zoom > 0 && Number.isFinite(view.offsetX) && Number.isFinite(view.offsetY));
});

// ——— чертёж, который не лёг на план, назван вслух ——————————————————————

test("чертёж без привязки и без масштаба — находка в панели, а не молчание", () => {
  const base = planProject();
  const project = withWalls(base, 2);
  const codes = validate(project).map((item) => item.code);
  assert.ok(codes.includes("drawingNotPlaced"), JSON.stringify(codes));

  const attached = setPlanOrigin(project, base.schemeId, { at: { x: 0.5, y: 0.5 }, turn: 0 }).project;
  assert.ok(!validate(attached).some((item) => item.code.indexOf("drawing") === 0), "привязанный чертёж молчит");

  const noScale = addScheme(createProject(), { name: "без масштаба", imageId: "p", width: 1000, height: 1000 });
  const walls = addWall(noScale.project, {
    schemeId: noScale.scheme.id,
    aMm: { x: 0, y: 0 },
    bMm: { x: 1000, y: 0 },
    thicknessMm: 100,
  }).project;
  assert.ok(validate(walls).some((item) => item.code === "drawingNoScale"));
});

test("G68: у объекта без чертежа находок про чертёж не бывает", () => {
  const scene = markedPlan();
  assert.ok(!validate(scene.project).some((item) => item.code.indexOf("drawing") === 0));
});

test("находка ведёт к самой схеме — править там больше нечего", () => {
  const base = planProject();
  const project = withWalls(base, 2);
  const found = validate(project).find((item) => item.code === "drawingNotPlaced");
  assert.deepEqual(warningPlace(project, found), {
    markId: null,
    typeId: null,
    schemeId: base.schemeId,
    point: null,
  });
});
