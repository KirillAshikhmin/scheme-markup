// Поиск типов в окне «Тип метки»: чистая часть окна — что за чем показывать.
// Ошибается молча: список остаётся списком, просто нужный тип оказывается
// не первым, и заказчик листает вместо того, чтобы кликнуть.
import { test } from "node:test";
import assert from "node:assert/strict";
import { addCategory, addType, createProject, searchTypes, typesInOrder } from "../src/model.js";

const codes = (groups) => groups.map((group) => [group.category.name, group.types.map((type) => type.code)]);

test("пустой запрос отдаёт весь справочник в порядке справочника", () => {
  const project = createProject({ name: "Тест" });
  assert.deepEqual(codes(searchTypes(project, "")), codes(typesInOrder(project)));
  assert.deepEqual(codes(searchTypes(project, "   ")), codes(typesInOrder(project)));
});

test("точное совпадение кода идёт первым — и в своей категории, и среди категорий", () => {
  const project = createProject({ name: "Тест" });
  // «П» — это Подсветка из категории «Свет»; «ПК» и «ПШ» начинаются с той же
  // буквы, но точное совпадение кода должно стоять раньше них.
  const light = searchTypes(project, "П")[0];
  assert.equal(light.category.name, "Свет");
  assert.equal(light.types[0].code, "П");
  // «Р» — Розетка: её категория выходит вперёд «Света», где «Р» встречается
  // только в середине названий.
  assert.equal(searchTypes(project, "Р")[0].category.name, "Розетки");
  assert.equal(searchTypes(project, "р")[0].types[0].code, "Р");
});

test("ищется и по коду с начала, и по названию в середине", () => {
  const project = createProject({ name: "Тест" });
  const byName = searchTypes(project, "кров");
  assert.deepEqual(codes(byName), [["Свет", ["ПК"]]]);
  // Категории без совпадений в списке не появляются.
  const byCode = searchTypes(project, "ВВ");
  assert.deepEqual(codes(byCode), [["Выключатели", ["ВВ"]]]);
  assert.deepEqual(searchTypes(project, "зззз"), []);
});

test("новая категория и длинный код находятся наравне с шаблонными", () => {
  const added = addCategory(createProject({ name: "Тест" }), { name: "Шторы", color: "#123456", shape: "square" });
  const withType = addType(added.project, { code: "ПОДСВЕТКА", name: "Лента в карнизе", categoryId: added.category.id });
  // «ПОДСВЕТКА» — точное совпадение кода, поэтому своя категория идёт первой,
  // а подсветки из «Света», найденные по названию, — следом.
  assert.deepEqual(codes(searchTypes(withType.project, "подсветка")), [
    ["Шторы", ["ПОДСВЕТКА"]],
    ["Свет", ["ПК", "П", "ПШ"]],
  ]);
  assert.equal(searchTypes(withType.project, "карниз")[0].types[0].code, "ПОДСВЕТКА");
});

// Правило поиска: код — с начала, название — в любом месте. Иначе
// шестнадцатибуквенные коды начинают совпадать серединой со случайными
// запросами, и заказчик снова стоит перед длинным перечнем, который
// окно колонками и убирало.
test("код ищется с начала: совпадение в середине кода не считается", () => {
  const added = addCategory(createProject({ name: "Тест" }), { name: "Шторы", color: "#9C931A", shape: "square" });
  const project = addType(added.project, { code: "КАРНИЗЛЕНТА", name: "Лента в коробе", categoryId: added.category.id }).project;
  // «НИЗЛ» стоит в середине кода и ни в одном названии справочника.
  assert.deepEqual(searchTypes(project, "НИЗЛ"), []);
  assert.deepEqual(searchTypes(project, "ризле"), []);
  // С начала кода — находится.
  assert.deepEqual(codes(searchTypes(project, "КАРНИЗ")), [["Шторы", ["КАРНИЗЛЕНТА"]]]);
  // Название по-прежнему ищется в середине.
  assert.equal(searchTypes(project, "коробе")[0].types[0].code, "КАРНИЗЛЕНТА");
});
