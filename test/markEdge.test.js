// Край плана: точка метки — доля 0…1 и ничего кроме (таск 222, дефект D73).
//
// Нашлось в живом прогоне таска 220: метка, поставленная за краем плана,
// получила долю (2,01; 1,46) и легла **за планом**. `normalizePoints` только
// приводила к числу.
//
// Чем это плохо, если видно её всё равно: такая метка **не печатается**. Лист
// ГОСТ, PNG и архив рисуют прямоугольник плана — метка остаётся в таблице, в
// CSV и в нумерации, а на бумаге её нет. Монтажник получает лист, на котором
// розетки Р7 не существует, и это ровно та тихая потеря работы, из-за которой
// в сборке и заведено правило «доля — это доля плана».
//
// Выбран **зажим на входе**, а не запрет клика за планом. Довод: на схеме с
// подложкой край виден, и отказ был бы честен, а на схеме без подложки не
// нарисовано ничего — край запасного квадрата невидим, и поле молча отказывало
// бы в клике по пустому месту. Зажатая метка стоит у края, её видно и её можно
// утащить рукой, а о том, что её прижало, сказано словом.
//
// G68: зажим стоит **на входе**, а не проходом по объекту. Чужая метка, уже
// лежащая за планом, остаётся лежать, пока человек сам её не возьмёт.
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
  createProject,
  findMark,
  findOutline,
  moveMarkPoint,
  pasteMark,
  markSnapshot,
} from "../src/model.js";
import { packProject, unpackProject } from "../src/projectFile.js";
import { strings } from "../src/strings.js";

const SRC_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
const read = (name) => readFileSync(join(SRC_DIR, name), "utf8");

function scene() {
  const added = addScheme(createProject(), { name: "1 этаж", imageId: "plan-1", width: 1200, height: 800 });
  return { project: added.project, schemeId: added.scheme.id, typeId: added.project.markTypes[0].id };
}

test("метка за планом прижимается к краю и говорит об этом", () => {
  const base = scene();
  const far = addMark(base.project, {
    schemeId: base.schemeId,
    typeId: base.typeId,
    points: [{ x: 2.01, y: 1.46 }],
  });
  assert.deepEqual(far.mark.points[0], { x: 1, y: 1 }, "метка осталась за планом");
  assert.equal(far.pinned, true, "о прижатой метке нечем сказать — вызывающий промолчит");
  const near = addMark(base.project, {
    schemeId: base.schemeId,
    typeId: base.typeId,
    points: [{ x: -0.2, y: 0.4 }],
  });
  assert.deepEqual(near.mark.points[0], { x: 0, y: 0.4 }, "зажимается только та ось, что вышла");
});

test("метка внутри плана не трогается и молчит", () => {
  const base = scene();
  const inside = addMark(base.project, {
    schemeId: base.schemeId,
    typeId: base.typeId,
    points: [{ x: 0.25, y: 0.75 }],
  });
  assert.deepEqual(inside.mark.points[0], { x: 0.25, y: 0.75 });
  assert.ok(!inside.pinned, "обычная постановка не имеет права звать плашку");
  // Края — часть плана, а не «за ним»: ноль и единица молчат.
  for (const point of [{ x: 0, y: 0 }, { x: 1, y: 1 }]) {
    assert.ok(!addMark(base.project, { schemeId: base.schemeId, typeId: base.typeId, points: [point] }).pinned);
  }
});

test("перенос вершины за план тоже упирается в край", () => {
  const base = scene();
  const placed = addMark(base.project, {
    schemeId: base.schemeId,
    typeId: base.typeId,
    points: [{ x: 0.5, y: 0.5 }],
  });
  const dragged = moveMarkPoint(placed.project, placed.mark.id, 0, { x: 1.8, y: -0.3 });
  assert.deepEqual(findMark(dragged.project, placed.mark.id).points[0], { x: 1, y: 0 });
});

test("вставка копии входит в план целиком — своё правило, и оно старше", () => {
  // `markShapeAt` двигает копию целиком, пока она не войдёт в план: форма
  // многоточечной метки от этого не плющится, в отличие от поточечного зажима.
  // Поэтому за краем копия не оказывается никогда, и своих слов ей не нужно.
  const base = scene();
  const placed = addMark(base.project, {
    schemeId: base.schemeId,
    typeId: base.typeId,
    kind: "line",
    points: [
      { x: 0.5, y: 0.5 },
      { x: 0.7, y: 0.5 },
    ],
  });
  const snapshot = markSnapshot(placed.project, placed.mark.id);
  const pasted = pasteMark(placed.project, snapshot, { schemeId: base.schemeId, point: { x: 1.4, y: 0.5 } });
  assert.deepEqual(pasted.mark.points, [
    { x: 0.8, y: 0.5 },
    { x: 1, y: 0.5 },
  ]);
  assert.ok(!pasted.pinned, "у вставки нет своего слова о зажиме — и не должно быть");
});

test("контур помещения ходит через ту же дверь", () => {
  const base = scene();
  const room = addRoom(base.project, "Зал");
  const outline = addOutline(room.project, {
    schemeId: base.schemeId,
    roomId: room.room.id,
    points: [
      { x: -0.5, y: 0.2 },
      { x: 0.8, y: 0.2 },
      { x: 0.8, y: 1.9 },
    ],
  });
  assert.deepEqual(findOutline(outline.project, outline.outline.id).points, [
    { x: 0, y: 0.2 },
    { x: 0.8, y: 0.2 },
    { x: 0.8, y: 1 },
  ]);
});

test("G68: чужая метка, уже лежащая за планом, остаётся лежать", async () => {
  // Объект прежней разметки: метка с долей 2,01 — ровно та, что нашлась в
  // живом прогоне. Открыть такой объект — не повод его править: догадку
  // показывают, а не применяют, и файл обязан открыться байт в байт.
  const base = scene();
  const placed = addMark(base.project, {
    schemeId: base.schemeId,
    typeId: base.typeId,
    points: [{ x: 0.5, y: 0.5 }],
  });
  const legacy = {
    ...placed.project,
    marks: placed.project.marks.map((mark) => ({ ...mark, points: [{ x: 2.010171137835338, y: 1.463365518038853 }] })),
  };
  const before = JSON.stringify(legacy.marks);
  const restored = (await unpackProject(await packProject(legacy, new Map()))).project;
  assert.equal(JSON.stringify(restored.marks), before, "файл прежней разметки открылся другим");
  assert.deepEqual(findMark(restored, placed.mark.id).points[0], {
    x: 2.010171137835338,
    y: 1.463365518038853,
  });
});

test("слова о прижатой метке есть и доезжают до обеих постановок", () => {
  assert.match(strings.canvas.markPinned, /кра/, "в словах нет главного: метка встала у края");
  const canvas = read("canvas.js");
  // Дверь одна на точку и линию: две копии правила разошлись бы.
  assert.equal(
    (canvas.match(/canvasSayPinned\(/g) || []).length,
    3,
    "постановок, которые молчат о зажиме, стало больше или меньше двух (точка и линия)",
  );
  // Память «уже сказали» снимается сменой занятия — той же меркой, что
  // молчаливый клик таска 217.
  const sync = canvas.slice(canvas.indexOf('if ("mode" in changed)'));
  assert.ok(sync.includes("canvasPinnedSaid = false"), "слова о зажиме говорятся один раз и больше никогда");
});
