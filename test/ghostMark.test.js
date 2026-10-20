// Метка-призрак под рукой (таск 176, G263).
//
// Слова заказчика: «При добавлении метки так же рисуй под курсором её». «Так
// же» — как у вещи чертежа, и там же (таск 168) найдено главное: призрак
// обязан считаться **из той точки, из которой пойдёт постановка**. У вещи это
// стоило полметра — узел сетки 500 мм менялся от двух точек дрожи между
// движением руки и отпусканием кнопки. На плане магнит мельче, но он есть:
// направляющая ловит точку в семи экранных пикселях (`GUIDE_SNAP_PX`), и
// дрогнувшая рука сажает метку мимо перекрестия, ради которого направляющие и
// ставят.
//
// Проверяется поэтому двумя швами:
//
//   1. **кадр призрака** — тот же, что у поставленной метки, кроме двух
//      названных примет (полсилы и пунктир). Холста в Node нет, и сверяется не
//      картинка, а то, из чего она сложилась;
//   2. **точка** — клик берёт её у призрака, а не у своего события.
import test from "node:test";
import assert from "node:assert/strict";

import { canvasGhostMark, canvasPlaceSpot } from "../src/canvas.js";
import { addMark, addScheme, createProject } from "../src/model.js";
import { DRAWING_GHOST_ALPHA, DRAWING_GHOST_DASH, drawMarkSign } from "../src/render.js";

const viewOf = (patch) => ({ zoom: 1, offsetX: 0, offsetY: 0, markSize: 10, labelSize: 12, ...patch });

// Холст-писец: записывает каждый вызов и каждое присваивание.
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

function scene(code = "Р") {
  const added = addScheme(createProject(), { name: "1 этаж", imageId: "картинка", width: 1000, height: 800 });
  const typeId = added.project.markTypes.find((type) => type.code === code).id;
  return { project: added.project, scheme: added.scheme, schemeId: added.scheme.id, typeId };
}

function frameOf(made, mark, options) {
  const probe = scribe();
  drawMarkSign(probe.ctx, made.project, made.scheme, mark, viewOf({}), options);
  return probe.log;
}

// Раскладка в состоянии значащая: правка меток есть только на большом экране
// (`LAYOUT_ABILITIES.editMarks`), и призрак обязан спрашивать о ней — клик,
// который ничего не поставит, обещать нельзя.
const stateOf = (made, patch) => ({
  project: made.project,
  schemeId: made.schemeId,
  mode: "add",
  activeTypeId: made.typeId,
  layout: "desktop",
  ...patch,
});

// Приметы призрака — и только они. Всё остальное обязано совпасть.
const ghostMarks = (line) =>
  line === "save()" ||
  line === "restore()" ||
  line === "globalAlpha=" + DRAWING_GHOST_ALPHA ||
  line === "setLineDash(" + JSON.stringify(DRAWING_GHOST_DASH) + ")";

test("призрак метки и поставленная метка — один кадр с точностью до пунктира", () => {
  const made = scene();
  const added = addMark(made.project, { schemeId: made.schemeId, typeId: made.typeId, points: [{ x: 0.4, y: 0.6 }] });
  const mark = added.mark;
  const placed = frameOf({ ...made, project: added.project }, mark, {});
  const ghost = frameOf({ ...made, project: added.project }, mark, { ghost: true });
  assert.ok(placed.length > 4, "знак метки не нарисовался вовсе — пример не тот");
  assert.notDeepEqual(placed, ghost, "призрак ничем не отличается от метки — его не отличить и глазом");
  assert.deepEqual(
    ghost.filter((line) => !ghostMarks(line)),
    placed.filter((line) => !ghostMarks(line)),
    "призрак рисуется не тем же кодом, что метка",
  );
  assert.ok(ghost.includes("globalAlpha=" + DRAWING_GHOST_ALPHA), "призрак не вполсилы");
  assert.ok(ghost.includes("save()") && ghost.includes("restore()"), "призрак не вернул холст как было");
  assert.ok(ghost.includes("setLineDash(" + JSON.stringify(DRAWING_GHOST_DASH) + ")"), "знак призрака не пунктирный");
});

test("призрак рисуется ровно в своей точке — в той, что ему дали", () => {
  const made = scene();
  const mark = canvasGhostMark(stateOf(made), { x: 0.25, y: 0.5 });
  assert.ok(mark, "призрака нет вовсе");
  const frame = frameOf(made, mark, { ghost: true });
  // План 1000 × 800 при zoom 1 без сдвига: доли 0,25 и 0,5 — это 250 и 400.
  assert.ok(
    frame.some((line) => line.startsWith("arc(250,400,")),
    "знак призрака встал не в свою точку: " + frame.filter((line) => line.startsWith("arc(")).join(" | "),
  );
});

// ——— чем призрак бывает и чем не бывает ———————————————————————————————

test("призрак есть только у точки и только в добавлении", () => {
  const made = scene();
  const point = { x: 0.3, y: 0.3 };
  assert.ok(canvasGhostMark(stateOf(made), point), "в добавлении точки призрака нет");
  assert.equal(canvasGhostMark(stateOf(made, { mode: "select" }), point), null, "в выделении призрак обещает лишнее");
  assert.equal(canvasGhostMark(stateOf(made, { mode: "room" }), point), null, "в обводке помещения призрак лишний");
  assert.equal(canvasGhostMark(stateOf(made), null), null, "курсора над планом нет, а призрак есть");
  assert.equal(canvasGhostMark(stateOf(made, { activeTypeId: null }), point), null, "тип не выбран, а призрак есть");
  assert.equal(
    canvasGhostMark(stateOf(made, { activeTypeId: "его-нет" }), point),
    null,
    "тип из справочника убрали, а призрак остался",
  );
  assert.equal(canvasGhostMark(null, point), null);
});

test("у метки-линии призрака нет: её ведут вершинами, и обещать до клика нечего", () => {
  const made = scene("ТР");
  const line = made.project.markTypes.find((type) => type.code === "ТР");
  assert.equal(line.kind, "line", "пример не тот: ТР перестал быть линейным");
  assert.equal(canvasGhostMark(stateOf({ ...made, typeId: line.id }), { x: 0.3, y: 0.3 }), null);
});

test("призрак берёт тип и схему из состояния — и ничего больше не выдумывает", () => {
  const made = scene();
  const mark = canvasGhostMark(stateOf(made), { x: 0.1, y: 0.2 });
  assert.equal(mark.typeId, made.typeId);
  assert.equal(mark.schemeId, made.schemeId);
  assert.equal(mark.kind, "point");
  assert.deepEqual(mark.points, [{ x: 0.1, y: 0.2 }]);
  // Номера у призрака нет: его выдаст модель при постановке.
  assert.equal(mark.number, 0);
  assert.equal(mark.id, "");
});

test("в просмотре призрака нет: клик там ничего не поставит", () => {
  const made = scene();
  // Раскладка телефона — правка меток запрещена (`layoutAllows`).
  assert.equal(canvasGhostMark(stateOf(made, { layout: "mobile" }), { x: 0.3, y: 0.3 }), null);
});

// ——— точка постановки берётся у призрака (вслед за таском 168) ——————————

test("клик ставит метку в точку призрака, а не в свою", () => {
  const ghost = { point: { x: 0.5, y: 0.5 }, schemeId: "схема" };
  // Рука дрогнула между движением и отпусканием — точка события другая.
  const shaken = { x: 0.502, y: 0.503 };
  assert.deepEqual(canvasPlaceSpot(ghost, shaken, "схема"), ghost.point);
});

test("призрака нет — остаётся сырой курсор, и это нарочно", () => {
  const plan = { x: 0.2, y: 0.9 };
  assert.deepEqual(canvasPlaceSpot(null, plan, "схема"), plan, "палец, коснувшийся не наведя, остался без точки");
  assert.deepEqual(canvasPlaceSpot({ schemeId: "схема" }, plan, "схема"), plan);
});

test("призрак с чужой схемы не целится: лист сменился — точка больше ничего не значит", () => {
  const ghost = { point: { x: 0.5, y: 0.5 }, schemeId: "первая" };
  const plan = { x: 0.1, y: 0.1 };
  assert.deepEqual(canvasPlaceSpot(ghost, plan, "вторая"), plan);
  // Схему не спросили — верим призраку: так кадр спрашивает, где его рисовать.
  assert.deepEqual(canvasPlaceSpot(ghost, plan), ghost.point);
});
