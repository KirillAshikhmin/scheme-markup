// Шаг блока: метки в одной рамке стоят вплотную, но не сливаются.
//
// Заказчик: «При добавлении метки по кнопке + возле текущей — добавляй метку
// прям рядом с текущей, а то сейчас на большом расстоянии». Шаг считается от
// величины знака метки (её задаёт пользователь ползунком), а не абсолютным
// числом пикселей: у мелкой метки прежний порог в 28 пикселей разносил блок
// на семь радиусов.
import test from "node:test";
import assert from "node:assert/strict";
import {
  BLOCK_STEP_PX,
  BLOCK_STEP_RATIO,
  DEFAULT_MARK_SIZE,
  addMark,
  addScheme,
  addToGroup,
  blockStepPx,
  createProject,
  findMark,
  labelOf,
} from "../src/model.js";
import { packProject, unpackProject } from "../src/projectFile.js";
import {
  hitHandle,
  hitTest,
  labelBounds,
  labelBox,
  labelTargetOf,
  markRadius,
  planToScreen,
  renderInternals,
} from "../src/render.js";

const WIDTH = 1600;
const HEIGHT = 1000;
const SIZES = [4, 10, 16, 36];

function flat() {
  let project = createProject({ name: "Блок" });
  const scheme = addScheme(project, { name: "1 этаж", width: WIDTH, height: HEIGHT });
  project = scheme.project;
  return { project, scheme: scheme.scheme };
}

const typeId = (project, code) => project.markTypes.find((type) => type.code === code).id;

// Блок из `count` меток: первая ставится, остальные — как ставит их холст,
// шагом от величины знака.
function block(markSize, count, code = "Р") {
  const base = flat();
  let project = base.project;
  const placed = addMark(project, {
    schemeId: base.scheme.id,
    typeId: typeId(project, code),
    kind: "point",
    points: [{ x: 0.3, y: 0.5 }],
  });
  project = placed.project;
  const ids = [placed.mark.id];
  for (let index = 1; index < count; index += 1) {
    const grown = addToGroup(project, ids[ids.length - 1], "right", { step: blockStepPx(markSize) });
    project = grown.project;
    ids.push(grown.mark.id);
  }
  return { project, scheme: base.scheme, ids, view: { zoom: 1, offsetX: 0, offsetY: 0, markSize, labelSize: 20 } };
}

test("шаг блока считается от величины знака метки, а не абсолютным числом", () => {
  for (const size of SIZES) assert.equal(blockStepPx(size), size * BLOCK_STEP_RATIO);
  // Величина мельче — шаг мельче: прежний нижний порог в пикселях это ломал.
  assert.ok(blockStepPx(4) < blockStepPx(10), "мелкая метка получила шаг крупной");
  // Величины нет (объект прежнего формата, вызов без настройки) — шаг по
  // умолчанию, и он же объявлен константой.
  assert.equal(BLOCK_STEP_PX, blockStepPx(DEFAULT_MARK_SIZE));
  assert.equal(blockStepPx(), BLOCK_STEP_PX);
  assert.equal(blockStepPx(0), BLOCK_STEP_PX);
  assert.equal(blockStepPx("крупные"), BLOCK_STEP_PX);
});

test("знаки блока не сливаются и не разбегаются", () => {
  // Знак рисуется радиусом `markSize`, обводка добавляет 0,11 радиуса: два
  // соседних знака касаются на 2,22 радиуса. Дальше трёх радиусов между
  // знаками уже просвет в целый знак — это не одна рамка.
  assert.ok(BLOCK_STEP_RATIO > 2.22, "знаки блока наезжают друг на друга");
  assert.ok(BLOCK_STEP_RATIO < 3, "метки блока стоят слишком далеко");

  for (const size of SIZES) {
    const built = block(size, 4);
    const points = built.ids.map((id) => findMark(built.project, id).points[0].x * WIDTH);
    for (let index = 1; index < points.length; index += 1) {
      const gap = points[index] - points[index - 1] - 2 * size;
      assert.ok(gap > 0, `знаки слиплись при величине ${size}: просвет ${gap}`);
      assert.ok(gap < size, `знаки разбежались при величине ${size}: просвет ${gap}`);
    }
  }
});

test("новая метка блока встаёт ровно туда, где нарисована ручка «+»", () => {
  for (const size of SIZES) {
    const built = block(size, 2);
    const first = findMark(built.project, built.ids[0]);
    const second = findMark(built.project, built.ids[1]);
    const handles = renderInternals.handlePositions(built.scheme, first, built.view);
    const right = handles.find((handle) => handle.side === "right");
    const at = planToScreen(second.points[0], built.scheme, built.view);
    assert.ok(Math.abs(right.x - at.x) < 1e-6, `ручка и метка разошлись при величине ${size}`);
    assert.ok(Math.abs(right.y - at.y) < 1e-6, `ручка и метка разошлись по вертикали при величине ${size}`);
    // То же самое со стороны попадания: точка новой метки — это правая ручка.
    assert.equal(hitHandle(built.scheme, first, at, built.view), "right");
  }
});

test("по каждой метке блока можно попасть кликом", () => {
  for (const size of SIZES) {
    const built = block(size, 4);
    for (const id of built.ids) {
      const mark = findMark(built.project, id);
      const at = planToScreen(mark.points[0], built.scheme, built.view);
      const hit = hitTest(built.project, built.scheme, at, built.view, null);
      assert.ok(hit, `клик по метке блока никуда не попал при величине ${size}`);
      assert.equal(hit.part, "mark");
      assert.equal(hit.markId, id, `клик по метке блока попал в соседа при величине ${size}`);
    }
  }
});

test("ручка «+» накрывает соседа по блоку — холст обязан отдавать клик метке", () => {
  // Шаг равен вылету ручки, значит ручка выделенной метки стоит ровно на
  // соседе. Без оговорки в холсте («ручка важнее всего, кроме уже стоящей под
  // ней метки») клик по соседу ставил бы третью метку поверх него.
  const built = block(16, 3);
  const last = findMark(built.project, built.ids[2]);
  const neighbour = findMark(built.project, built.ids[1]);
  const at = planToScreen(neighbour.points[0], built.scheme, built.view);
  assert.equal(hitHandle(built.scheme, last, at, built.view), "left", "ручка перестала накрывать соседа");
  const hit = hitTest(built.project, built.scheme, at, built.view, null);
  assert.equal(hit.markId, neighbour.id, "под ручкой нет метки, которой холст мог бы отдать клик");
});

test("подпись блока не наезжает на метки", () => {
  for (const size of SIZES) {
    const built = block(size, 4);
    const target = labelTargetOf(built.project, built.scheme, built.ids[0], null);
    assert.ok(target, "у блока нет подписи");
    const box = labelBounds(labelBox(built.project, built.scheme, target, built.view, null));
    assert.ok(box.text !== "", "подпись блока пуста");
    const radius = markRadius(built.view);
    for (const id of built.ids) {
      const mark = findMark(built.project, id);
      const at = planToScreen(mark.points[0], built.scheme, built.view);
      const overlapX = Math.min(box.x + box.width, at.x + radius) - Math.max(box.x, at.x - radius);
      const overlapY = Math.min(box.y + box.height, at.y + radius) - Math.max(box.y, at.y - radius);
      assert.ok(overlapX <= 0 || overlapY <= 0, `подпись блока легла на метку при величине ${size}`);
    }
  }
});

// G68: старый объект открывается как закрывался.
test("уже размеченный блок не двигается: шаг меняется только для новых меток", async () => {
  const old = {
    formatVersion: 1,
    id: "old-project",
    name: "Объект прежнего формата",
    createdAt: "2026-01-01T00:00:00+03:00",
    updatedAt: "2026-01-01T00:00:00+03:00",
    categories: [{ id: "cat-1", name: "Розетки", color: "#D1242F", shape: "circle-socket", order: 0 }],
    markTypes: [{ id: "type-1", categoryId: "cat-1", code: "Р", name: "Розетка", shape: null, blockMode: "each", order: 0 }],
    rooms: [],
    schemes: [{ id: "scheme-1", name: "1 этаж", imageId: null, width: 1000, height: 1000, order: 0 }],
    // Блок, собранный прежним шагом в 28 пикселей плана.
    marks: [
      { id: "mark-1", schemeId: "scheme-1", typeId: "type-1", number: 1, kind: "point", points: [{ x: 0.5, y: 0.5 }], groupId: "group-1", labelOffset: null },
      { id: "mark-2", schemeId: "scheme-1", typeId: "type-1", number: 2, kind: "point", points: [{ x: 0.528, y: 0.5 }], groupId: "group-1", labelOffset: null },
      { id: "mark-3", schemeId: "scheme-1", typeId: "type-1", number: 3, kind: "point", points: [{ x: 0.556, y: 0.5 }], groupId: "group-1", labelOffset: null },
    ],
    groups: [{ id: "group-1", schemeId: "scheme-1", markIds: ["mark-1", "mark-2", "mark-3"], labelOffset: null }],
    counters: { Р: 3 },
    view: { markSize: 10, labelSize: 12 },
  };
  const blob = await packProject(old, new Map());
  const opened = (await unpackProject(blob)).project;

  assert.deepEqual(
    opened.marks.map((mark) => ({ id: mark.id, number: mark.number, point: mark.points[0] })),
    old.marks.map((mark) => ({ id: mark.id, number: mark.number, point: mark.points[0] })),
    "метки старого блока переехали",
  );
  assert.deepEqual(opened.groups, old.groups, "группа старого блока изменилась");
  assert.equal(labelOf(opened, "group-1"), "Р1Р2Р3");
  // Своя величина знака у старого объекта осталась своей.
  assert.equal(opened.view.markSize, 10);

  // Новая метка в том же блоке встаёт новым шагом — от величины этого объекта.
  const grown = addToGroup(opened, "mark-3", "right", { step: blockStepPx(opened.view.markSize) });
  assert.equal(grown.mark.points[0].x, 0.556 + blockStepPx(10) / 1000);
  for (const id of ["mark-1", "mark-2", "mark-3"]) {
    assert.deepEqual(findMark(grown.project, id).points, findMark(opened, id).points, "старая метка блока сдвинулась");
  }
});
