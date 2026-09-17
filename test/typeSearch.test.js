// Поиск типов в окне «Тип метки»: чистая часть окна — что за чем показывать.
// Ошибается молча: список остаётся списком, просто нужный тип оказывается
// не первым, и заказчик листает вместо того, чтобы кликнуть.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addCategory,
  addType,
  createProject,
  matchTypeExactly,
  searchTypes,
  typesInOrder,
} from "../src/model.js";

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
  // Категории без совпадений в списке не появляются. «ВВ» — это и двойной
  // выключатель, и тройной: код ищется с начала, и оба начинаются с «ВВ».
  const byCode = searchTypes(project, "ВВ");
  assert.deepEqual(codes(byCode), [["Выключатели", ["ВВ", "ВВВ"]]]);
  assert.deepEqual(searchTypes(project, "зззз"), []);
});

test("новая категория и длинный код находятся наравне с шаблонными", () => {
  const added = addCategory(createProject({ name: "Тест" }), { name: "Шторы", color: "#123456", shape: "square" });
  const withType = addType(added.project, { code: "ПОДСВЕТКА", name: "Лента в карнизе", categoryId: added.category.id });
  // «ПОДСВЕТКА» — точное совпадение кода, поэтому своя категория идёт первой.
  // В «Свете» вперёд выходит «П»: его название совпадает с запросом целиком,
  // а у «ПК» и «ПШ» запрос — только начало названия.
  assert.deepEqual(codes(searchTypes(withType.project, "подсветка")), [
    ["Шторы", ["ПОДСВЕТКА"]],
    ["Свет", ["П", "ПК", "ПШ", "ПКШ"]],
  ]);
  // «Карниз» есть и в шаблоне («Карниз штор», «Подсветка карниза»), и у
  // пользователя: находится и то и другое, и своя категория не теряется.
  assert.deepEqual(codes(searchTypes(withType.project, "карниз")), [
    ["Свет", ["КШ", "ПКШ"]],
    ["Шторы", ["ПОДСВЕТКА"]],
  ]);
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
  // С начала кода — находится. Рядом встают шаблонные типы, у которых
  // «карниз» стоит в названии: правило для названия другое — в любом месте.
  assert.deepEqual(codes(searchTypes(project, "КАРНИЗ")), [
    ["Свет", ["КШ", "ПКШ"]],
    ["Шторы", ["КАРНИЗЛЕНТА"]],
  ]);
  // Название по-прежнему ищется в середине.
  assert.equal(searchTypes(project, "коробе")[0].types[0].code, "КАРНИЗЛЕНТА");
});

// Живая проверка: вводишь «Светильник», жмёшь Enter — и получаешь «Точечный
// светильник», потому что точным считалось только совпадение кода. Две метки
// не того типа замечают потом по таблице.
test("точное название стоит первым, а не то, где запрос сидит в середине", () => {
  const project = createProject({ name: "Тест" });
  const light = searchTypes(project, "Светильник")[0];
  assert.equal(light.category.name, "Свет");
  assert.deepEqual(light.types.map((type) => type.code), ["С", "Т"]);
  // Регистр и пробелы по краям не мешают.
  assert.equal(searchTypes(project, "  светильник ")[0].types[0].code, "С");
});

test("точное название сильнее совпадения в середине, точный код — сильнее названия", () => {
  const added = addCategory(createProject({ name: "Тест" }), { name: "Шторы", color: "#9C931A", shape: "square" });
  // Код «ЛЕНТА» у одного типа и название «Лента» у другого: по запросу «лента»
  // первым идёт код — его вводят, чтобы попасть в тип с одного слова.
  const project = addType(added.project, { code: "ЛЕНТА", name: "Лента в карнизе", categoryId: added.category.id }).project;
  const groups = searchTypes(project, "лента");
  assert.equal(groups[0].types[0].code, "ЛЕНТА");
  assert.equal(groups[1].types[0].code, "Л");
});

// Заказчик держит в «Свете» несколько подсветок. Запрос целиком совпал с одной
// из них — она первая; недопечатанный запрос никого не выделяет, и порядок
// остаётся порядком справочника, который у заказчика перед глазами.
test("«Подсветка» находит саму себя, а не тёзок с приставками", () => {
  const base = createProject({ name: "Тест" });
  const light = base.categories.find((category) => category.name === "Свет");
  const project = addType(base, { code: "ПП", name: "Подсветка пола", categoryId: light.id }).project;
  const whole = searchTypes(project, "подсветка")[0];
  assert.equal(whole.types[0].code, "П");
  assert.deepEqual(whole.types.map((type) => type.code), ["П", "ПК", "ПШ", "ПКШ", "ПП"]);
  // Недопечатанное «подсветк» точным ни для кого не стало.
  const part = searchTypes(project, "подсветк")[0];
  assert.deepEqual(part.types.map((type) => type.code), ["ПК", "П", "ПШ", "ПКШ", "ПП"]);
});

test("тип с таким же названием или кодом находится точным совпадением", () => {
  const project = createProject({ name: "Тест" });
  assert.equal(matchTypeExactly(project, "Светильник").code, "С");
  assert.equal(matchTypeExactly(project, "  выключатель  ").code, "В");
  assert.equal(matchTypeExactly(project, "ПК").name, "Подсветка кровати");
  assert.equal(matchTypeExactly(project, "Розетка в полу"), null);
  assert.equal(matchTypeExactly(project, ""), null);
  assert.equal(matchTypeExactly(project, "   "), null);
});
