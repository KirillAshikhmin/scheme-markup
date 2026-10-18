// Меню выгрузок под значком принтера (таск 163, G242).
//
// Слова заказчика: «кнопки Таблица, схема, развёртки спрячь в меню по
// иконке-кнопке с принтером». Сами кнопки при этом никуда не делись — делась
// их видимость, и единственное, что человек узнаёт о недоступной выгрузке, —
// причина, по которой пункт погас.
//
// Проверяется ровно этот шов: **состав меню и причины гашения**. Разойдись он
// с выгрузкой — пункт жив, а окно пустое, или наоборот, — поймать это глазами
// труднее всего: надо зайти в объект без меток, без схемы и без стен по
// отдельности. Само меню (раскрытие, нажатие мимо, Escape) проверяет приёмка.
import test from "node:test";
import assert from "node:assert/strict";

import {
  addMark,
  addScheme,
  addWall,
  createProject,
  setPlanOrigin,
  setPlanScale,
  setSchemeWallHeight,
  typesInOrder,
} from "../src/model.js";
import { exportMenuItems } from "../src/panels/export.js";
import { strings } from "../src/strings.js";

// Объект с одной схемой: лист 4000 × 3000 точек, масштаб и нуль заданы — без
// них стена не ляжет в миллиметры.
function world() {
  const added = addScheme(createProject({ name: "Объект" }), {
    name: "1 этаж",
    imageId: null,
    width: 4000,
    height: 3000,
  });
  let project = added.project;
  const schemeId = added.scheme.id;
  project = setPlanScale(project, schemeId, { a: { x: 0, y: 0.5 }, b: { x: 1, y: 0.5 }, meters: 40 }).project;
  project = setPlanOrigin(project, schemeId, { at: { x: 0.5, y: 0.5 }, turn: 0 }).project;
  project = setSchemeWallHeight(project, schemeId, 2700).project;
  return { project, schemeId };
}

function withMark(project, schemeId) {
  const typeId = typesInOrder(project)[0].types[0].id;
  return addMark(project, { schemeId, typeId, kind: "point", points: [{ x: 0.5, y: 0.5 }] }).project;
}

function withWall(project, schemeId) {
  return addWall(project, {
    schemeId,
    aMm: { x: -2000, y: -1000 },
    bMm: { x: 2000, y: -1000 },
    thicknessMm: 200,
  }).project;
}

function items(state) {
  const map = new Map(exportMenuItems(state).map((item) => [item.id, item]));
  return map;
}

test("меню всегда перечисляет те же три выгрузки, и порядок у них свой", () => {
  const { project, schemeId } = world();
  const ids = exportMenuItems({ project, schemeId }).map((item) => item.id);
  assert.deepEqual(ids, ["table", "scheme", "elevation"]);
  // Пустое состояние не укорачивает меню: пункт исчезнувший и пункт погасший
  // отвечают на разные вопросы, а ответ нужен именно на «почему нельзя».
  assert.deepEqual(exportMenuItems(null).map((item) => item.id), ids);
  for (const item of exportMenuItems(null)) {
    assert.ok(item.label, item.id + ": пункт без имени");
    assert.ok(item.hint, item.id + ": пункт без подсказки");
  }
});

test("без меток таблица и схема гаснут, и каждая говорит почему", () => {
  const { project, schemeId } = world();
  const map = items({ project, schemeId });
  assert.equal(map.get("table").reason, strings.exportPanel.noMarks);
  assert.equal(map.get("scheme").reason, strings.exportPanel.noMarks);
});

test("схема не выбрана — это другая причина, чем пустая разметка", () => {
  const { project, schemeId } = world();
  const marked = withMark(project, schemeId);
  // Метки есть, а схемы на экране нет: про метки говорить нечего, сказать надо
  // про схему.
  assert.equal(items({ project: marked, schemeId: null }).get("scheme").reason, strings.exportPanel.noScheme);
  assert.equal(items({ project: marked, schemeId: null }).get("table").reason, null);
});

test("метки оживляют таблицу и схему, стены — развёртки", () => {
  const { project, schemeId } = world();
  const marked = withMark(project, schemeId);
  const alive = items({ project: marked, schemeId });
  assert.equal(alive.get("table").reason, null);
  assert.equal(alive.get("scheme").reason, null);
  // Развёрткам метки не нужны — нужны стены, и без них причина своя.
  assert.equal(alive.get("elevation").reason, strings.elevationSheet.noWalls);
  const walled = items({ project: withWall(marked, schemeId), schemeId });
  assert.equal(walled.get("elevation").reason, null);
});

test("стены оживляют развёртки и без единой метки", () => {
  const { project, schemeId } = world();
  const walled = items({ project: withWall(project, schemeId), schemeId });
  assert.equal(walled.get("elevation").reason, null);
  // А таблица и схема при этом остаются погасшими: пустая стена — чертёж для
  // монтажника, пустая таблица — пустой лист.
  assert.equal(walled.get("table").reason, strings.exportPanel.noMarks);
  assert.equal(walled.get("scheme").reason, strings.exportPanel.noMarks);
});
