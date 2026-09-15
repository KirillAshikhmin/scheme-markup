import test from "node:test";
import assert from "node:assert/strict";

import {
  addCategory,
  BLOCK_STEP_PX,
  addMark,
  addRoom,
  addScheme,
  addToGroup,
  addType,
  changeMarkType,
  compactNumbers,
  createProject,
  defaultTemplate,
  deleteCategory,
  deleteMark,
  deleteRoom,
  deleteScheme,
  deleteType,
  findGroup,
  findMark,
  findScheme,
  labelOf,
  markByCode,
  styleOf,
  updateCategory,
  updateMark,
  updateProject,
  updateRoom,
  updateScheme,
  updateType,
  validate,
} from "../src/model.js";

test("стартовый справочник: 5 категорий и 13 типов из брифа", () => {
  const template = defaultTemplate();
  assert.equal(template.categories.length, 5);
  assert.equal(template.markTypes.length, 13);

  const byName = Object.fromEntries(template.categories.map((c) => [c.name, c]));
  assert.deepEqual(
    { color: byName["Свет"].color, shape: byName["Свет"].shape },
    { color: "#1F6FEB", shape: "circle-cross" },
  );
  assert.deepEqual(
    { color: byName["Выключатели"].color, shape: byName["Выключатели"].shape },
    { color: "#2DA44E", shape: "circle" },
  );
  assert.deepEqual(
    { color: byName["Розетки"].color, shape: byName["Розетки"].shape },
    { color: "#D1242F", shape: "square" },
  );
  assert.deepEqual(
    { color: byName["Климат"].color, shape: byName["Климат"].shape },
    { color: "#E36209", shape: "triangle" },
  );
  assert.deepEqual(
    { color: byName["Сетевое оборудование"].color, shape: byName["Сетевое оборудование"].shape },
    { color: "#8250DF", shape: "star" },
  );

  assert.deepEqual(
    template.markTypes.map((t) => t.code),
    ["Т", "С", "ПК", "ТР", "П", "Л", "ПШ", "В", "ВВ", "Р", "Б", "К", "W"],
  );
  assert.equal(template.markTypes.find((t) => t.code === "ПК").name, "Подсветка кровати");
  assert.ok(template.markTypes.every((t) => t.blockMode === "each"));
  assert.ok(template.markTypes.every((t) => t.shape === null));
});

test("новый объект создаётся из стартового справочника и пуст по меткам", () => {
  const project = createProject();
  assert.equal(project.formatVersion, 1);
  assert.equal(project.categories.length, 5);
  assert.equal(project.markTypes.length, 13);
  assert.deepEqual(project.marks, []);
  assert.deepEqual(project.groups, []);
  assert.deepEqual(project.counters, {});
  assert.ok(project.id);
  assert.ok(project.name);
  const light = project.categories.find((c) => c.name === "Свет");
  assert.ok(project.markTypes.find((t) => t.code === "Т").categoryId === light.id);
});

function projectWithSchemes() {
  let project = createProject();
  let result = addScheme(project, { name: "1 этаж", width: 1000, height: 2000 });
  const first = result.scheme;
  result = addScheme(result.project, { name: "2 этаж", width: 1000, height: 2000 });
  return { project: result.project, first, second: result.scheme };
}

function typeId(project, code) {
  return project.markTypes.find((t) => t.code === code).id;
}

function putPoint(project, schemeId, code, point) {
  return addMark(project, {
    schemeId,
    typeId: typeId(project, code),
    kind: "point",
    points: [point || { x: 0.5, y: 0.5 }],
  });
}

test("обозначение метки — код типа и номер, счётчики типов независимы", () => {
  const { project: base, first } = projectWithSchemes();
  let step = putPoint(base, first.id, "В");
  assert.equal(labelOf(step.project, step.mark.id), "В1");

  step = putPoint(step.project, first.id, "Т");
  assert.equal(labelOf(step.project, step.mark.id), "Т1");

  step = putPoint(step.project, first.id, "В");
  assert.equal(labelOf(step.project, step.mark.id), "В2");
  assert.equal(step.mark.number, 2);
  assert.equal(step.mark.kind, "point");
  assert.equal(step.mark.points.length, 1);
  assert.equal(step.mark.groupId, null);
});

test("нумерация сквозная по объекту, а не по схеме", () => {
  const { project: base, first, second } = projectWithSchemes();
  let step = putPoint(base, first.id, "ПК");
  step = putPoint(step.project, second.id, "ПК");
  assert.equal(labelOf(step.project, step.mark.id), "ПК2");
  assert.equal(step.mark.schemeId, second.id);
  assert.equal(step.project.counters["ПК"], 2);
  assert.equal(markByCode(step.project, "ПК", 1).schemeId, first.id);
});

test("постановка метки не меняет исходный объект", () => {
  const { project: base, first } = projectWithSchemes();
  const step = putPoint(base, first.id, "В");
  assert.equal(base.marks.length, 0);
  assert.equal(step.project.marks.length, 1);
  assert.notEqual(step.project, base);
});

function putSeries(project, schemeId, code, count) {
  const ids = [];
  let current = project;
  for (let i = 0; i < count; i += 1) {
    const step = putPoint(current, schemeId, code, { x: 0.1 * (i + 1), y: 0.2 });
    current = step.project;
    ids.push(step.mark.id);
  }
  return { project: current, ids };
}

test("удаление метки оставляет дыру: В3 уходит, В4 и В5 не двигаются", () => {
  const { project: base, first } = projectWithSchemes();
  const { project: filled, ids } = putSeries(base, first.id, "В", 5);
  const after = deleteMark(filled, ids[2]).project;

  assert.equal(after.marks.length, 4);
  assert.equal(findMark(after, ids[2]), null);
  assert.equal(labelOf(after, ids[3]), "В4");
  assert.equal(labelOf(after, ids[4]), "В5");

  const next = putPoint(after, first.id, "В");
  assert.equal(labelOf(next.project, next.mark.id), "В6");
});

test("номер не переиспользуется даже после удаления последней метки типа", () => {
  const { project: base, first } = projectWithSchemes();
  const { project: filled, ids } = putSeries(base, first.id, "Р", 3);
  let after = deleteMark(filled, ids[2]).project;
  after = deleteMark(after, ids[1]).project;
  after = deleteMark(after, ids[0]).project;
  assert.equal(after.marks.length, 0);
  assert.equal(after.counters["Р"], 3);

  const next = putPoint(after, first.id, "Р");
  assert.equal(labelOf(next.project, next.mark.id), "Р4");
});

test("поля метки правятся, номер и тип через patch не подменяются", () => {
  const { project: base, first } = projectWithSchemes();
  const step = putPoint(base, first.id, "В");
  const after = updateMark(step.project, step.mark.id, {
    location: "над тумбой слева",
    original: "В34",
    number: 99,
    typeId: typeId(base, "Р"),
  }).project;
  const mark = findMark(after, step.mark.id);
  assert.equal(mark.location, "над тумбой слева");
  assert.equal(mark.original, "В34");
  assert.equal(mark.number, 1);
  assert.equal(labelOf(after, mark.id), "В1");
});

test("блок «каждая своя»: три точки дают три метки, группу и слитную подпись", () => {
  const { project: base, first } = projectWithSchemes();
  const step = addMark(base, {
    schemeId: first.id,
    typeId: typeId(base, "В"),
    kind: "point",
    points: [
      { x: 0.2, y: 0.3 },
      { x: 0.25, y: 0.3 },
      { x: 0.3, y: 0.3 },
    ],
  });
  assert.equal(step.marks.length, 3);
  assert.equal(step.project.marks.length, 3);
  assert.ok(step.group);
  assert.deepEqual(
    step.marks.map((m) => labelOf(step.project, m.id)),
    ["В1", "В2", "В3"],
  );
  assert.ok(step.marks.every((m) => m.groupId === step.group.id));
  assert.equal(labelOf(step.project, step.group.id), "В1В2В3");
});

test("блок «одна метка на блок»: один номер и несколько точек", () => {
  const { project: base, first } = projectWithSchemes();
  const step = addMark(base, {
    schemeId: first.id,
    typeId: typeId(base, "Р"),
    kind: "point",
    blockMode: "single",
    points: [
      { x: 0.2, y: 0.3 },
      { x: 0.25, y: 0.3 },
    ],
    });
  assert.equal(step.marks.length, 1);
  assert.equal(step.mark.points.length, 2);
  assert.equal(step.group, null);
  assert.equal(labelOf(step.project, step.mark.id), "Р1");
  assert.equal(step.project.counters["Р"], 1);

  const grown = addToGroup(step.project, step.mark.id, "right");
  assert.equal(grown.project.marks.length, 1);
  assert.equal(findMark(grown.project, step.mark.id).points.length, 3);
  assert.equal(grown.project.counters["Р"], 1);
});

test("соседняя точка блока встаёт рядом по выбранной стороне", () => {
  const { project: base, first } = projectWithSchemes();
  const step = putPoint(base, first.id, "В", { x: 0.5, y: 0.5 });
  const right = addToGroup(step.project, step.mark.id, "right");
  assert.equal(right.project.marks.length, 2);
  assert.deepEqual(right.mark.points[0], { x: 0.5 + 28 / 1000, y: 0.5 });
  assert.equal(labelOf(right.project, right.group.id), "В1В2");

  const up = addToGroup(right.project, right.mark.id, "up");
  assert.deepEqual(up.mark.points[0], { x: 0.5 + 28 / 1000, y: 0.5 - 28 / 2000 });
  assert.equal(findGroup(up.project, right.group.id).markIds.length, 3);
  assert.equal(labelOf(up.project, right.group.id), "В1В2В3");
});

test("разрыв в номерах внутри группы рвёт подпись запятой", () => {
  const { project: base, first } = projectWithSchemes();
  const step = addMark(base, {
    schemeId: first.id,
    typeId: typeId(base, "В"),
    kind: "point",
    points: [
      { x: 0.2, y: 0.3 },
      { x: 0.25, y: 0.3 },
      { x: 0.3, y: 0.3 },
    ],
  });
  const after = deleteMark(step.project, step.marks[1].id).project;
  assert.equal(labelOf(after, step.group.id), "В1, В3");
});

test("compactNumbers показывает замены и не применяет их молча", () => {
  const { project: base, first } = projectWithSchemes();
  const { project: filled, ids } = putSeries(base, first.id, "В", 5);
  let project = deleteMark(filled, ids[1]).project;
  project = deleteMark(project, ids[3]).project;

  const result = compactNumbers(project, typeId(project, "В"));
  assert.deepEqual(
    result.changes.map((change) => [change.fromLabel, change.toLabel]),
    [
      ["В3", "В2"],
      ["В5", "В3"],
    ],
  );
  // исходный объект остался нетронутым
  assert.equal(labelOf(project, ids[2]), "В3");
  assert.equal(project.counters["В"], 5);
  // в возвращённом — уплотнено
  assert.equal(labelOf(result.project, ids[0]), "В1");
  assert.equal(labelOf(result.project, ids[2]), "В2");
  assert.equal(labelOf(result.project, ids[4]), "В3");
  assert.equal(result.project.counters["В"], 3);
});

test("уплотнение идёт по порядку схем и не трогает другие типы", () => {
  const { project: base, first, second } = projectWithSchemes();
  let step = putPoint(base, second.id, "Т");
  const onSecond = step.mark.id;
  step = putPoint(step.project, first.id, "Т");
  const onFirst = step.mark.id;
  step = putPoint(step.project, first.id, "Р");
  const socket = step.mark.id;

  assert.equal(labelOf(step.project, onSecond), "Т1");
  const result = compactNumbers(step.project, typeId(step.project, "Т"));
  assert.equal(labelOf(result.project, onFirst), "Т1");
  assert.equal(labelOf(result.project, onSecond), "Т2");
  assert.equal(labelOf(result.project, socket), "Р1");
  assert.equal(result.project.counters["Р"], 1);
});

test("смена типа выдаёт номер по новому типу, старый остаётся дырой", () => {
  const { project: base, first } = projectWithSchemes();
  const { project: filled, ids } = putSeries(base, first.id, "В", 3);
  const result = changeMarkType(filled, ids[1], typeId(filled, "Р"));

  assert.equal(labelOf(result.project, ids[1]), "Р1");
  assert.equal(labelOf(result.project, ids[2]), "В3");
  assert.equal(result.project.counters["В"], 3);
  const next = putPoint(result.project, first.id, "В");
  assert.equal(labelOf(next.project, next.mark.id), "В4");
});

test("разнородная группа перечисляется через запятую", () => {
  const { project: base, first } = projectWithSchemes();
  const block = addMark(base, {
    schemeId: first.id,
    typeId: typeId(base, "В"),
    kind: "point",
    points: [
      { x: 0.2, y: 0.3 },
      { x: 0.25, y: 0.3 },
      { x: 0.3, y: 0.3 },
    ],
  });
  const mixed = changeMarkType(block.project, block.marks[1].id, typeId(base, "Р")).project;
  assert.equal(labelOf(mixed, block.group.id), "В1, В3, Р1");
});

test("код типа — одна–две буквы и не повторяется", () => {
  const project = createProject();
  const light = project.categories.find((c) => c.name === "Свет").id;
  assert.throws(() => addType(project, { code: "В", name: "Ещё выключатель", categoryId: light }), {
    message: "Код В уже занят",
  });
  assert.throws(() => addType(project, { code: "АБВ", name: "Длинный", categoryId: light }), {
    code: "codeTooLong",
  });
  assert.throws(() => addType(project, { code: "  ", name: "Пустой", categoryId: light }), {
    code: "codeRequired",
  });

  const added = addType(project, { code: "Ш", name: "Шинопровод", categoryId: light });
  assert.equal(added.project.markTypes.length, 14);
  assert.equal(added.type.blockMode, "each");
  assert.equal(added.type.shape, null);
  assert.equal(project.markTypes.length, 13);
});

test("тип с метками не удаляется, свободный удаляется", () => {
  const { project: base, first } = projectWithSchemes();
  const step = putPoint(base, first.id, "К");
  assert.throws(() => deleteType(step.project, typeId(step.project, "К")), { code: "typeHasMarks" });

  const freed = deleteMark(step.project, step.mark.id).project;
  const after = deleteType(freed, typeId(freed, "К")).project;
  assert.equal(after.markTypes.length, 12);
  assert.equal(after.markTypes.find((t) => t.code === "К"), undefined);
});

test("переименование кода типа переносит счётчик и обозначения меток", () => {
  const { project: base, first } = projectWithSchemes();
  const { project: filled, ids } = putSeries(base, first.id, "В", 2);
  const renamed = updateType(filled, typeId(filled, "В"), { code: "ВК" }).project;

  assert.equal(labelOf(renamed, ids[1]), "ВК2");
  assert.equal(renamed.counters["ВК"], 2);
  assert.equal(renamed.counters["В"], undefined);
  const next = putPoint(renamed, first.id, "ВК");
  assert.equal(labelOf(next.project, next.mark.id), "ВК3");
  assert.throws(() => updateType(renamed, typeId(renamed, "Р"), { code: "ВК" }), { code: "codeTaken" });
});

test("цвет берётся у категории, форма — у типа, если задана", () => {
  const project = createProject();
  const spot = typeId(project, "Т");
  assert.deepEqual(styleOf(project, spot), { color: "#1F6FEB", shape: "circle-cross" });

  const shaped = updateType(project, spot, { shape: "diamond" }).project;
  assert.deepEqual(styleOf(shaped, spot), { color: "#1F6FEB", shape: "diamond" });

  const light = project.categories.find((c) => c.name === "Свет").id;
  const repainted = updateCategory(shaped, light, { color: "#000000", shape: "hexagon" }).project;
  assert.deepEqual(styleOf(repainted, spot), { color: "#000000", shape: "diamond" });
  assert.deepEqual(styleOf(repainted, typeId(repainted, "С")), { color: "#000000", shape: "hexagon" });
  assert.throws(() => updateCategory(repainted, light, { shape: "cloud" }), { code: "unknownShape" });
});

test("категории и помещения заводятся своими функциями", () => {
  const project = createProject();
  const withCategory = addCategory(project, { name: "Шторы", color: "#123456", shape: "square" });
  assert.equal(withCategory.project.categories.length, 6);
  assert.equal(withCategory.category.order, 5);

  const withRoom = addRoom(withCategory.project, { name: "Спальная Оли" });
  assert.equal(withRoom.room.name, "Спальная Оли");
  assert.equal(withRoom.project.rooms.length, 1);
  assert.throws(() => addRoom(withRoom.project, { name: " " }), { code: "nameRequired" });
});

test("линия хранится вершинами, из одной вершины не создаётся", () => {
  const { project: base, first } = projectWithSchemes();
  assert.throws(
    () =>
      addMark(base, {
        schemeId: first.id,
        typeId: typeId(base, "Л"),
        kind: "line",
        points: [{ x: 0.1, y: 0.1 }],
      }),
    { code: "shortLine" },
  );

  const step = addMark(base, {
    schemeId: first.id,
    typeId: typeId(base, "Л"),
    kind: "line",
    points: [
      { x: 0.1, y: 0.1 },
      { x: 0.4, y: 0.1 },
      { x: 0.4, y: 0.5 },
    ],
  });
  assert.equal(step.mark.kind, "line");
  assert.equal(step.mark.points.length, 3);
  assert.equal(step.mark.closed, false);
  assert.equal(labelOf(step.project, step.mark.id), "Л1");

  const closed = updateMark(step.project, step.mark.id, { closed: true }).project;
  assert.equal(findMark(closed, step.mark.id).closed, true);
});

test("validate молчит на здоровом объекте и называет проблемы на битом", () => {
  const { project: base, first } = projectWithSchemes();
  const { project: healthy } = putSeries(base, first.id, "В", 2);
  assert.deepEqual(validate(healthy), []);

  const broken = structuredClone(healthy);
  broken.markTypes[1].code = "В";
  broken.marks[1].schemeId = "нет-такой-схемы";
  broken.counters["В"] = 1;
  broken.groups.push({ id: "g1", schemeId: first.id, markIds: [broken.marks[0].id], labelOffset: null });

  const codes = validate(broken).map((problem) => problem.code);
  assert.ok(codes.includes("duplicateCode"), codes.join(","));
  assert.ok(codes.includes("markWithoutScheme"), codes.join(","));
  assert.ok(codes.includes("counterBehind"), codes.join(","));
  assert.ok(codes.includes("smallGroup"), codes.join(","));
  assert.ok(validate(broken).every((problem) => typeof problem.message === "string" && problem.message));
});

test("удаление схемы уносит её метки и группы, чужие не трогает", () => {
  const { project: base, first, second } = projectWithSchemes();
  let step = putPoint(base, first.id, "В");
  const kept = step.mark.id;
  step = addMark(step.project, {
    schemeId: second.id,
    typeId: typeId(step.project, "В"),
    kind: "point",
    points: [
      { x: 0.2, y: 0.2 },
      { x: 0.3, y: 0.2 },
    ],
  });

  const renamed = updateScheme(step.project, first.id, { name: "Цоколь", width: 800 }).project;
  assert.equal(findScheme(renamed, first.id).name, "Цоколь");
  assert.equal(findScheme(renamed, first.id).width, 800);

  const after = deleteScheme(renamed, second.id).project;
  assert.equal(after.schemes.length, 1);
  assert.deepEqual(after.marks.map((m) => m.id), [kept]);
  assert.deepEqual(after.groups, []);
  assert.equal(after.counters["В"], 3);
  assert.deepEqual(validate(after), []);
});

test("идентификаторы стартового справочника уникальны у каждого объекта", () => {
  const first = createProject();
  const second = createProject();
  const ids = [...first.categories.map((c) => c.id), ...first.markTypes.map((t) => t.id)];
  assert.equal(new Set(ids).size, 18);
  const otherIds = new Set([...second.categories.map((c) => c.id), ...second.markTypes.map((t) => t.id)]);
  assert.deepEqual(ids.filter((id) => otherIds.has(id)), []);
});

test("блок собирается только из точек и только по известной стороне", () => {
  const { project: base, first } = projectWithSchemes();
  const line = addMark(base, {
    schemeId: first.id,
    typeId: typeId(base, "Л"),
    kind: "line",
    points: [
      { x: 0.1, y: 0.1 },
      { x: 0.4, y: 0.1 },
    ],
  });
  assert.throws(() => addToGroup(line.project, line.mark.id, "right"), { code: "blockOnlyForPoints" });

  const point = putPoint(base, first.id, "В");
  assert.throws(() => addToGroup(point.project, point.mark.id, "вбок"), { code: "unknownSide" });
});

test("код типа — только буквы, кириллица или латиница", () => {
  const project = createProject();
  const light = project.categories.find((c) => c.name === "Свет").id;
  assert.throws(() => addType(project, { code: "12", name: "Цифры", categoryId: light }), { code: "codeLetters" });
  assert.throws(() => addType(project, { code: "#!", name: "Мусор", categoryId: light }), { code: "codeLetters" });
  assert.throws(() => addType(project, { code: "В1", name: "Смесь", categoryId: light }), { code: "codeLetters" });
  const latin = addType(project, { code: "SW", name: "Switch", categoryId: light });
  assert.equal(latin.type.code, "SW");
});

test("постановка метки отвергает пустые точки и незнакомый вид", () => {
  const { project: base, first } = projectWithSchemes();
  assert.throws(() => addMark(base, { schemeId: first.id, typeId: typeId(base, "В"), kind: "point", points: [] }), {
    code: "noPoints",
  });
  assert.throws(
    () => addMark(base, { schemeId: first.id, typeId: typeId(base, "В"), kind: "зигзаг", points: [{ x: 0.1, y: 0.1 }] }),
    { code: "unknownKind" },
  );
});

test("категория удаляется только пустой, тип без категории не заводится", () => {
  const project = createProject();
  const light = project.categories.find((c) => c.name === "Свет").id;
  assert.throws(() => deleteCategory(project, light), { code: "categoryHasTypes" });
  assert.throws(() => addType(project, { code: "Ш", name: "Шина", categoryId: "нет-такой" }), {
    code: "categoryNotFound",
  });

  const added = addCategory(project, { name: "Шторы", color: "#123456", shape: "square" });
  const after = deleteCategory(added.project, added.category.id).project;
  assert.equal(after.categories.length, 5);
});

test("имя объекта, вид и помещения правятся", () => {
  const { project: base, first } = projectWithSchemes();
  const named = updateProject(base, { name: "Квартира на Ленина", view: { markSize: 16 } }).project;
  assert.equal(named.name, "Квартира на Ленина");
  assert.deepEqual(named.view, { markSize: 16, labelSize: 12 });

  const withRoom = addRoom(named, { name: "Спальная" });
  const renamed = updateRoom(withRoom.project, withRoom.room.id, { name: "Спальная Оли" }).project;
  assert.equal(renamed.rooms[0].name, "Спальная Оли");

  const step = putPoint(renamed, first.id, "В");
  const linked = updateMark(step.project, step.mark.id, { roomId: withRoom.room.id }).project;
  assert.deepEqual(validate(linked), []);

  const dropped = deleteRoom(linked, withRoom.room.id).project;
  assert.deepEqual(dropped.rooms, []);
  assert.equal(findMark(dropped, step.mark.id).roomId, null);
  assert.deepEqual(validate(dropped), []);
});

test("отставший счётчик — одна проблема на тип", () => {
  const { project: base, first } = projectWithSchemes();
  const { project: filled } = putSeries(base, first.id, "В", 3);
  const broken = structuredClone(filled);
  broken.counters["В"] = 0;

  const behind = validate(broken).filter((problem) => problem.code === "counterBehind");
  assert.equal(behind.length, 1);
  assert.equal(behind[0].ref, filled.markTypes.find((t) => t.code === "В").id);
});

test("у схемы без размеров шаг блока считается от запасного размера плана", () => {
  const project = createProject();
  const created = addScheme(project, { name: "План ещё не загружен" });
  assert.equal(created.scheme.width, 0);

  const step = addMark(created.project, {
    schemeId: created.scheme.id,
    typeId: typeId(created.project, "Р"),
    kind: "point",
    points: [{ x: 0.5, y: 0.5 }],
  });

  // запасной размер плана — 1000 px, шаг BLOCK_STEP_PX = 28 px, то есть 0,028 доли
  assert.equal(BLOCK_STEP_PX, 28);
  const right = addToGroup(step.project, step.mark.id, "right");
  assert.ok(Math.abs(right.mark.points[0].x - 0.528) < 1e-12, String(right.mark.points[0].x));
  assert.equal(right.mark.points[0].y, 0.5);

  const down = addToGroup(right.project, right.mark.id, "down");
  assert.ok(Math.abs(down.mark.points[0].y - 0.528) < 1e-12, String(down.mark.points[0].y));
});
