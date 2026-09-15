// Чистая часть панели меток: порядок списка, фильтры и галочки.
// DOM здесь не участвует — окно и строки проверяются приёмкой.
import { test } from "node:test";
import assert from "node:assert/strict";
import { addMark, addRoom, addScheme, createProject, updateMark } from "../src/model.js";
import {
  filtersCategoryChecked,
  filtersMarkRows,
  filtersSetAllTypes,
  filtersToggleCategory,
  filtersToggleType,
  filtersTypeChecked,
} from "../src/panels/filters.js";

function fixture() {
  let project = createProject({ name: "Тест" });
  const scheme = addScheme(project, { name: "1 этаж", width: 1000, height: 800 });
  project = scheme.project;
  const schemeId = scheme.scheme.id;
  const typeOf = (code) => project.markTypes.find((type) => type.code === code).id;
  const put = (code, x) => {
    const result = addMark(project, { schemeId, typeId: typeOf(code), kind: "point", points: [{ x, y: 0.5 }] });
    project = result.project;
    return result.mark.id;
  };
  const socket = put("Р", 0.1);
  const secondSocket = put("Р", 0.2);
  const spot = put("Т", 0.3);
  return { get project() { return project; }, set project(value) { project = value; }, schemeId, socket, secondSocket, spot, typeOf };
}

test("список идёт в порядке справочника: свет раньше розеток, внутри — по номеру", () => {
  const box = fixture();
  const rows = filtersMarkRows(box.project, box.schemeId, null);
  assert.deepEqual(rows.map((row) => row.label), ["Т1", "Р1", "Р2"]);
  assert.equal(rows[0].category.name, "Свет");
  assert.equal(rows[1].type.code, "Р");
});

test("поиск идёт по обозначению, расположению и оригиналу, фильтр — по помещению", () => {
  const box = fixture();
  const room = addRoom(box.project, "Спальная Оли");
  box.project = updateMark(room.project, box.socket, {
    roomId: room.room.id,
    location: "над тумбой слева",
    original: "В31",
  }).project;

  const byLabel = filtersMarkRows(box.project, box.schemeId, { query: "т1" });
  assert.deepEqual(byLabel.map((row) => row.label), ["Т1"]);
  const byLocation = filtersMarkRows(box.project, box.schemeId, { query: "тумбой" });
  assert.deepEqual(byLocation.map((row) => row.label), ["Р1"]);
  const byOriginal = filtersMarkRows(box.project, box.schemeId, { query: "в31" });
  assert.deepEqual(byOriginal.map((row) => row.label), ["Р1"]);
  const byRoom = filtersMarkRows(box.project, box.schemeId, { roomId: room.room.id });
  assert.deepEqual(byRoom.map((row) => row.label), ["Р1"]);
});

test("снятая галочка категории убирает её типы, возвращённая — возвращает; всё отмечено — фильтра нет", () => {
  const box = fixture();
  const project = box.project;
  const sockets = project.categories.find((category) => category.name === "Розетки");
  const all = { categoryIds: null, typeIds: null, roomId: null, query: "" };

  const hidden = filtersToggleCategory(project, all, sockets.id, false);
  assert.equal(filtersCategoryChecked(project, hidden, sockets.id), "off");
  assert.equal(filtersTypeChecked(project, hidden, box.typeOf("Р")), false);
  assert.equal(filtersTypeChecked(project, hidden, box.typeOf("Т")), true);
  assert.deepEqual(filtersMarkRows(project, box.schemeId, hidden).map((row) => row.label), ["Т1"]);
  assert.equal(hidden.query, "");

  const back = filtersToggleCategory(project, hidden, sockets.id, true);
  assert.equal(back.categoryIds, null);
  assert.equal(back.typeIds, null);
});

test("последний снятый тип гасит категорию, возвращённый — зажигает её обратно", () => {
  const box = fixture();
  const project = box.project;
  const light = project.categories.find((category) => category.name === "Свет");
  const all = { categoryIds: null, typeIds: null, roomId: null, query: "" };

  let filter = all;
  for (const type of project.markTypes.filter((type) => type.categoryId === light.id)) {
    filter = filtersToggleType(project, filter, type.id, false);
  }
  assert.equal(filtersCategoryChecked(project, filter, light.id), "off");

  const withSpot = filtersToggleType(project, filter, box.typeOf("Т"), true);
  assert.equal(filtersCategoryChecked(project, withSpot, light.id), "mixed");
  assert.deepEqual(filtersMarkRows(project, box.schemeId, withSpot).map((row) => row.label), ["Т1", "Р1", "Р2"]);

  const nothing = filtersSetAllTypes(project, all, false);
  assert.deepEqual(filtersMarkRows(project, box.schemeId, nothing), []);
});
