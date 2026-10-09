// Чистая часть панели меток: порядок списка, фильтры и галочки.
// DOM здесь не участвует — окно и строки проверяются приёмкой.
import { test } from "node:test";
import assert from "node:assert/strict";
import { addMark, addRoom, addScheme, createProject, updateMark } from "../src/model.js";
import {
  filtersActive,
  filtersCategoryChecked,
  filtersMarkRows,
  filtersSetAllTypes,
  filtersToggleCategory,
  filtersToggleType,
  filtersTypeChecked,
  filtersTypeCounts,
} from "../src/panels/filters.js";
import { marksFiltersHead } from "../src/panels/marks.js";
import { strings } from "../src/strings.js";

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

// ——— «Показать все» и «Скрыть все» ————————————————————————————————————
//
// Слова заказчика: «в фильтрах меток есть кнопка „Показать все“, сделай рядом
// с ней обратную кнопку „Скрыть все“» — снять все галочки разом, чтобы потом
// включить одну-две и смотреть только их. Кнопки горят и гаснут по одному и
// тому же счёту: разойдись он — кнопка осталась бы нажимаемой там, где она
// ничего не делает.

const ALL = { categoryIds: null, typeIds: null, roomId: null, query: "" };

test("счёт показанных типов: всё видно, половина снята, не видно ничего", () => {
  const box = fixture();
  const project = box.project;
  // Комментарии считаются наравне с типами, одной позицией: в справочнике их
  // нет (G173), но на плане они есть, и «Скрыть все» обязана это знать.
  const total = project.markTypes.length + 1;
  assert.ok(total > 1, "в шаблоне должно быть несколько типов");

  const everything = filtersTypeCounts(project, ALL);
  assert.deepEqual(everything, { total, shown: total, hidden: 0 });

  const oneOff = filtersToggleType(project, ALL, box.typeOf("Р"), false);
  assert.deepEqual(filtersTypeCounts(project, oneOff), { total, shown: total - 1, hidden: 1 });

  const nothing = filtersSetAllTypes(project, ALL, false);
  assert.deepEqual(filtersTypeCounts(project, nothing), { total, shown: 0, hidden: total });
  assert.equal(nothing.comments, false, "«Скрыть все» оставила плашки на плане");

  // Объекта ещё нет (панель смонтирована раньше, чем он открыт) — скрывать
  // нечего, и обе кнопки обязаны быть погашены.
  assert.deepEqual(filtersTypeCounts(null, null), { total: 0, shown: 0, hidden: 0 });
});

test("«Скрыть все» снимает галочки и не трогает помещение с поиском", () => {
  const box = fixture();
  const room = addRoom(box.project, "Спальная Оли");
  const project = room.project;
  const picked = { ...ALL, roomId: room.room.id, query: "т1" };

  const nothing = filtersSetAllTypes(project, picked, false);
  assert.equal(filtersTypeCounts(project, nothing).shown, 0);
  for (const type of project.markTypes) {
    assert.equal(filtersTypeChecked(project, nothing, type.id), false, "тип остался отмеченным: " + type.code);
  }
  for (const category of project.categories) {
    const own = project.markTypes.filter((type) => type.categoryId === category.id);
    const mode = filtersCategoryChecked(project, nothing, category.id);
    // Категория без типов отмечена всегда — прятать в ней нечего.
    assert.equal(mode, own.length === 0 ? "on" : "off", "категория: " + category.name);
  }
  // Поле помещения и строка поиска — отдельные поля фильтра, их пользователь
  // ставил сам; «Скрыть все» про галочки, а не про них.
  assert.equal(nothing.roomId, room.room.id);
  assert.equal(nothing.query, "т1");

  // Обратно — одна кнопка «Показать все»: ни одного снятого типа не остаётся.
  const back = filtersSetAllTypes(project, nothing, true);
  assert.equal(filtersTypeCounts(project, back).hidden, 0);
  assert.equal(back.typeIds, null);
  assert.equal(back.categoryIds, null);
});

test("полностью снятый фильтр — это фильтр: заголовок списка красится и объясняется", () => {
  const box = fixture();
  const project = box.project;
  const nothing = filtersSetAllTypes(project, ALL, false);

  // Тот же признак, по которому гаснет «Показать все», красит заголовок блока
  // фильтров: пустой список обязан объяснить себя, а не просто опустеть.
  assert.equal(filtersActive(nothing), true);
  const head = marksFiltersHead({ collapsed: true, filter: nothing, shown: 0, total: 3 });
  assert.equal(head.narrowed, true);
  assert.equal(head.count, "Показано 0 из 3");
  assert.ok(head.hint.includes(strings.filters.narrowed), "свёрнутый блок молчит про сужение");
  // И в самом блоке фильтров стоит строка про снятые галочки.
  assert.equal(typeof strings.filters.allHidden, "string");
  assert.ok(strings.filters.allHidden.length > 0);
});
