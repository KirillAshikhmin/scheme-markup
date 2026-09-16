// Шаблон справочника: новый объект создаётся сразу из сохранённого снимка —
// копией, а не ссылкой. Два объекта не должны делить ни одну запись.
import test from "node:test";
import assert from "node:assert/strict";
import { addCategory, addTypesFromCatalog, createProject, styleOf } from "../src/model.js";
import { typesTemplateFrom } from "../src/panels/types.js";

const snapshot = {
  categories: [
    { id: "c-light", name: "Свет", color: "#1F6FEB", shape: "circle-cross" },
    { id: "c-blinds", name: "Шторы", color: "#8250DF", shape: "square-fill" },
  ],
  // Снимок несёт идентификаторы и у категорий, и у типов — их пишет
  // `typesSnapshot`. Если шаблон начнёт переносить чужие id вместо новых,
  // это должно быть видно тесту.
  markTypes: [
    { id: "t-spot", categoryId: "c-light", code: "Т", name: "Точечный светильник", shape: null, blockMode: "each" },
    { id: "t-blind", categoryId: "c-blinds", code: "Ш", name: "Штора", shape: "triangle-down", blockMode: "single" },
  ],
};

test("объект из шаблона повторяет справочник и получает свои идентификаторы", () => {
  const template = typesTemplateFrom(snapshot);
  const first = createProject({ name: "Первый", ...template });
  const second = createProject({ name: "Второй", ...typesTemplateFrom(snapshot) });

  assert.deepEqual(first.categories.map((category) => category.name), ["Свет", "Шторы"]);
  assert.deepEqual(first.markTypes.map((type) => type.code), ["Т", "Ш"]);
  assert.equal(first.markTypes[1].blockMode, "single");
  const blinds = first.markTypes[1].id;
  assert.deepEqual(styleOf(first, blinds), { color: "#8250DF", shape: "triangle-down", lineStyle: "solid" });

  // Ни одного общего идентификатора: правка справочника одного объекта не
  // должна ни при каких обстоятельствах указывать на записи другого.
  const ids = new Set([...first.categories, ...first.markTypes].map((item) => item.id));
  for (const item of [...second.categories, ...second.markTypes]) {
    assert.ok(!ids.has(item.id), "идентификатор общий у двух объектов: " + item.id);
  }
  for (const item of [...snapshot.categories, ...snapshot.markTypes]) {
    assert.ok(!ids.has(item.id), "объект унёс идентификатор из шаблона: " + item.id);
  }
  assert.notEqual(template.markTypes[0].id, snapshot.markTypes[0].id);
  assert.notEqual(template.categories[0].id, snapshot.categories[0].id);
});

test("шаблон с неизвестной формой не ломает объект, а откатывается на известную", () => {
  const stale = {
    categories: [{ id: "c", name: "Свет", color: "#1F6FEB", shape: "cloud" }],
    markTypes: [{ categoryId: "c", code: "Т", name: "Точечный", shape: "cloud", blockMode: "often" }],
  };
  const project = createProject({ name: "Объект", ...typesTemplateFrom(stale) });
  const style = styleOf(project, project.markTypes[0].id);
  assert.equal(style.shape, "circle");
  assert.equal(project.markTypes[0].blockMode, "each");
});

test("пустой или чужой шаблон — это «шаблона нет», а не половина справочника", () => {
  assert.equal(typesTemplateFrom(null), null);
  assert.equal(typesTemplateFrom({ categories: [], markTypes: [] }), null);
  assert.equal(typesTemplateFrom({ name: "не шаблон" }), null);
  // Тип без своей категории не переезжает: ссылаться ему будет не на что.
  assert.equal(typesTemplateFrom({ categories: snapshot.categories, markTypes: [{ categoryId: "нет", code: "Т", name: "Т" }] }), null);
});

// «Добавил из общей базы → создал объект по шаблону» — два пути к одному
// справочнику. Понимай они совпадение имён по-разному, объект из шаблона
// получил бы двойника той категории, в которую база кладёт типы: две строки
// «Датчики» с разными цветами, и метки смотрят в разные.
test("категория из общей базы и категория из шаблона — одна и та же, а не двойник", () => {
  const bare = { ...createProject(), categories: [], markTypes: [] };
  const own = addCategory(bare, { name: "датчики", color: "#123456", shape: "square" });
  const filled = addTypesFromCatalog(own.project, null, ["ДВ"]).project;
  assert.equal(filled.categories.length, 1, "база кладёт тип в знакомую категорию");

  // Снимок такого справочника плюс строка «Датчики» из общей базы: имена
  // совпадают, регистр разный.
  const snapshot = {
    categories: [
      ...filled.categories.map((category) => ({
        id: category.id,
        name: category.name,
        color: category.color,
        shape: category.shape,
        lineStyle: category.lineStyle,
      })),
      { id: "from-catalog", name: "Датчики", color: "#164E63", shape: "circle-ring" },
    ],
    markTypes: [
      ...filled.markTypes.map((type) => ({
        categoryId: type.categoryId,
        code: type.code,
        name: type.name,
        shape: type.shape,
        lineStyle: type.lineStyle,
        blockMode: type.blockMode,
      })),
      { categoryId: "from-catalog", code: "ДО", name: "Датчик открытия", shape: "square-split" },
    ],
  };

  const next = createProject({ name: "Следующий", ...typesTemplateFrom(snapshot) });
  assert.deepEqual(next.categories.map((category) => category.name), ["датчики"]);
  assert.deepEqual(next.markTypes.map((type) => type.code), ["ДВ", "ДО"]);
  assert.equal(new Set(next.markTypes.map((type) => type.categoryId)).size, 1, "типы разъехались по двойникам");
  assert.equal(next.categories[0].color, "#123456", "выжившая категория — первая, со своим цветом");

  // И общая база по-прежнему видит её своей: шестой категории не заводится.
  assert.equal(addTypesFromCatalog(next, null, ["ДП"]).project.categories.length, 1);
});
