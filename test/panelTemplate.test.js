// Шаблон справочника: новый объект создаётся сразу из сохранённого снимка —
// копией, а не ссылкой. Два объекта не должны делить ни одну запись.
import test from "node:test";
import assert from "node:assert/strict";
import { createProject, styleOf } from "../src/model.js";
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
