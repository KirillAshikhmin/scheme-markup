import test from "node:test";
import assert from "node:assert/strict";

import {
  acceptProblem,
  acceptedProblems,
  addCategory,
  BLOCK_STEP_PX,
  CODE_MAX_LENGTH,
  LABEL_ANGLES,
  codeProblem,
  addMark,
  addRoom,
  addScheme,
  addToGroup,
  addType,
  addTypesFromCatalog,
  catalogOffer,
  categoryNameKey,
  addEquipment,
  addPlacement,
  changeMarkType,
  findCategoryByName,
  compactAllNumbers,
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
  findPlacement,
  findScheme,
  markControls,
  labelOf,
  markByCode,
  MARK_DIMENSION_FIELDS,
  MARK_DIMENSION_MAX,
  markDimensionValue,
  markDimensions,
  markHasDimensions,
  setMarkDimensions,
  problemAccepted,
  repeatedNumbers,
  setMarkControls,
  setMarkNumber,
  SHAPE_NAMES,
  styleOf,
  typesInOrder,
  updateCategory,
  updateMark,
  updateProject,
  updateRoom,
  unacceptProblem,
  updateScheme,
  updateType,
  validate,
} from "../src/model.js";

test("стартовый справочник: типы из брифа, переключатель, витая пара и категория датчиков", () => {
  const template = defaultTemplate();
  assert.equal(template.categories.length, 8);
  assert.equal(template.markTypes.length, 28);

  const byName = Object.fromEntries(template.categories.map((c) => [c.name, c]));
  assert.deepEqual(
    { color: byName["Свет"].color, shape: byName["Свет"].shape },
    { color: "#1F6FEB", shape: "circle-cross" },
  );
  assert.deepEqual(
    { color: byName["Выключатели"].color, shape: byName["Выключатели"].shape },
    // Квадрат — знак выключателя: клавиши делят его чертами.
    { color: "#2DA44E", shape: "square" },
  );
  assert.deepEqual(
    { color: byName["Розетки"].color, shape: byName["Розетки"].shape },
    // Круг с двумя точками — евророзетка, как её и рисуют.
    { color: "#D1242F", shape: "circle-socket" },
  );
  assert.deepEqual(
    { color: byName["Климат"].color, shape: byName["Климат"].shape },
    { color: "#E36209", shape: "triangle" },
  );
  assert.deepEqual(
    { color: byName["Сетевое оборудование"].color, shape: byName["Сетевое оборудование"].shape },
    { color: "#8250DF", shape: "star" },
  );
  // Датчики заведены по просьбе заказчика: свой цвет, своя форма по умолчанию.
  assert.deepEqual(
    { color: byName["Датчики"].color, shape: byName["Датчики"].shape },
    { color: "#164E63", shape: "circle-ring" },
  );
  // Щит — своя категория по просьбе заказчика: узел питания, а не устройство
  // в комнате. Коричневый — цвет фазного провода; отличимость от шести прежних
  // считает test/colors.test.js, здесь пришпилены сами значения.
  assert.deepEqual(
    { color: byName["Щит"].color, shape: byName["Щит"].shape },
    { color: "#6E4B1F", shape: "square-bolt" },
  );

  assert.deepEqual(
    template.markTypes.map((t) => t.code),
    // «ВП» — проходной переключатель, добавлен по просьбе заказчика и стоит
    // в своей категории, рядом с выключателями. «ЛВ», «ПКШ» и «КШ» — тоже по
    // просьбе заказчика, и тоже в своей категории: рядом с лентой и подсветкой
    // шкафа, а не в хвосте списка. Остальные тринадцать — из брифа.
    // prettier-ignore
    ["Т", "С", "ПК", "ТР", "П", "Л", "ЛВ", "ПШ", "ПКШ", "КШ",
     "В", "ВВ", "ВВВ", "ВП", "Р", "Б", "К", "W", "RJ", "ДВ", "ДО", "ДП", "ДД", "Щ", "ЩС",
     "ВР", "КН", "КВ"],
  );
  // Названия — данные заказчика, поэтому пришпилены целиком: правка форм и
  // добавление типов не должны их задеть ни на букву.
  assert.deepEqual(
    Object.fromEntries(template.markTypes.map((t) => [t.code, t.name])),
    {
      Т: "Точечный светильник",
      С: "Светильник",
      ПК: "Подсветка кровати",
      ТР: "Трек",
      П: "Подсветка",
      Л: "Лента",
      ЛВ: "Лента вертикальная",
      ПШ: "Подсветка шкафа",
      ПКШ: "Подсветка карниза",
      КШ: "Карниз штор",
      В: "Выключатель",
      ВВ: "Выключатель двойной",
      ВВВ: "Выключатель тройной",
      ВП: "Переключатель проходной",
      Р: "Розетка",
      Б: "Бризер",
      К: "Кондиционер",
      W: "WiFi точка",
      RJ: "Вывод витой пары (розетка RJ45)",
      ДВ: "Датчик движения",
      ДО: "Датчик открытия",
      ДП: "Датчик протечки",
      ДД: "Датчик дыма",
      Щ: "Электрощит",
      ЩС: "Слаботочный щит",
      ВР: "Водорозетка",
      КН: "Выход канализации",
      КВ: "Кран воды с электроприводом",
    },
  );
  assert.ok(template.markTypes.every((t) => t.blockMode === "each"));
  // Типы света сидят в одном синем цвете, поэтому у каждого своя форма:
  // иначе тип читается только по букве. Цвета категорий при этом прежние —
  // они проверены выше.
  // prettier-ignore
  const lightCodes = ["Т", "С", "ПК", "ТР", "П", "Л", "ЛВ", "ПШ", "ПКШ", "КШ"];
  const lightShapes = template.markTypes.filter((t) => lightCodes.includes(t.code)).map((t) => t.shape);
  // prettier-ignore
  assert.deepEqual(lightShapes, [
    "circle-cross", "circle-fill", "circle-dot", "plus", "diamond",
    "triangle", "rect-vertical", "triangle-down", "diamond-dot", "diamond-cross",
  ]);
  assert.equal(new Set(lightShapes).size, lightCodes.length, "два типа света рисуются одинаково");
  // Своей формы нет у типа, которому хватает формы категории: в своей
  // категории он один такой. «Р» вернулась в этот список — её знаком стал
  // круг с двумя точками, и он же стал формой категории «Розетки»;
  // «В» ушёл туда же по той же причине: квадрат теперь форма выключателей.
  assert.deepEqual(
    template.markTypes.filter((t) => t.shape === null).map((t) => t.code),
    ["В", "Р", "Б", "W", "ДД", "Щ", "ВР"],
  );
  // Выключатели и климат — разными знаками, как просил заказчик. У «В» своего
  // знака нет: он берёт квадрат категории, а клавиши на нём считают по чертам.
  // Что знаки и на бумаге не сливаются, проверяет отпечаток в test/shapes.test.js.
  assert.deepEqual(
    template.markTypes.filter((t) => ["В", "ВВ", "ВВВ", "ВП"].includes(t.code)).map((t) => t.shape),
    [null, "square-bar", "square-bar-two", "square-chevron"],
  );
  assert.equal(template.markTypes.find((t) => t.code === "К").shape, "square-wave");
});

test("новый объект создаётся из стартового справочника и пуст по меткам", () => {
  const project = createProject();
  // Версия 3: контуры помещений, ручная правка помещения, цвет помещения и
  // вид типа — точка или линия.
  assert.equal(project.formatVersion, 3);
  assert.equal(project.categories.length, 8);
  assert.equal(project.markTypes.length, 28);
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

// Порядок обхода задаёт поле order, а не порядок добавления схем: панель схем
// умеет их переставлять, и уплотнение обязано идти по новому порядку.
test("уплотнение следует полю order схем, а не порядку их добавления", () => {
  const { project: base, first, second } = projectWithSchemes();
  let step = putPoint(base, first.id, "Т");
  const onFirst = step.mark.id;
  step = putPoint(step.project, second.id, "Т");
  const onSecond = step.mark.id;
  assert.equal(labelOf(step.project, onFirst), "Т1");
  assert.equal(labelOf(step.project, onSecond), "Т2");

  // Вторую схему подняли над первой; в самом массиве порядок прежний.
  let project = updateScheme(step.project, second.id, { order: 0 }).project;
  project = updateScheme(project, first.id, { order: 1 }).project;
  assert.equal(project.schemes[0].id, first.id);

  const result = compactNumbers(project, typeId(project, "Т"));
  assert.deepEqual(
    result.changes.map((change) => [change.fromLabel, change.toLabel]),
    [
      ["Т2", "Т1"],
      ["Т1", "Т2"],
    ],
  );
  assert.equal(labelOf(result.project, onSecond), "Т1");
  assert.equal(labelOf(result.project, onFirst), "Т2");
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

test("код типа — от одной до шестнадцати букв и не повторяется", () => {
  const project = createProject();
  const light = project.categories.find((c) => c.name === "Свет").id;
  assert.throws(() => addType(project, { code: "В", name: "Ещё выключатель", categoryId: light }), {
    message: "Код В уже занят",
  });
  // прежний предел в две буквы снят заказчиком: «АБВ» теперь законный код
  const three = addType(project, { code: "АБВ", name: "Три буквы", categoryId: light });
  assert.equal(three.type.code, "АБВ");
  assert.equal(CODE_MAX_LENGTH, 16);
  const sixteen = "ПОДСВЕТКАПОЛОВАЯ"; // ровно 16 букв
  assert.equal(sixteen.length, 16);
  assert.equal(addType(project, { code: sixteen, name: "Граница", categoryId: light }).type.code, sixteen);
  assert.throws(() => addType(project, { code: sixteen + "Я", name: "За границей", categoryId: light }), {
    code: "codeTooLong",
  });
  assert.throws(() => addType(project, { code: "  ", name: "Пустой", categoryId: light }), {
    code: "codeRequired",
  });

  const added = addType(project, { code: "Ш", name: "Шинопровод", categoryId: light });
  assert.equal(added.project.markTypes.length, 29);
  assert.equal(added.type.blockMode, "each");
  assert.equal(added.type.shape, null);
  assert.equal(project.markTypes.length, 28);
});

test("тип с метками не удаляется, свободный удаляется", () => {
  const { project: base, first } = projectWithSchemes();
  const step = putPoint(base, first.id, "К");
  assert.throws(() => deleteType(step.project, typeId(step.project, "К")), { code: "typeHasMarks" });

  const freed = deleteMark(step.project, step.mark.id).project;
  const after = deleteType(freed, typeId(freed, "К")).project;
  assert.equal(after.markTypes.length, 27);
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
  assert.deepEqual(styleOf(project, spot), { color: "#1F6FEB", shape: "circle-cross", lineStyle: "solid" });

  const shaped = updateType(project, spot, { shape: "diamond" }).project;
  assert.deepEqual(styleOf(shaped, spot), { color: "#1F6FEB", shape: "diamond", lineStyle: "solid" });

  const light = project.categories.find((c) => c.name === "Свет").id;
  const repainted = updateCategory(shaped, light, { color: "#000000", shape: "hexagon" }).project;
  assert.deepEqual(styleOf(repainted, spot), { color: "#000000", shape: "diamond", lineStyle: "solid" });
  // Тип без своей формы берёт форму категории. У света и выключателей формы
  // теперь у всех — наследование видно на розетке: она в своей категории одна,
  // и форма категории ей и достаётся.
  const sockets = project.categories.find((c) => c.name === "Розетки").id;
  const reshaped = updateCategory(project, sockets, { shape: "hexagon" }).project;
  assert.deepEqual(styleOf(reshaped, typeId(reshaped, "Р")), { color: "#D1242F", shape: "hexagon", lineStyle: "solid" });
  assert.throws(() => updateCategory(repainted, light, { shape: "cloud" }), { code: "unknownShape" });
});

test("категории и помещения заводятся своими функциями", () => {
  const project = createProject();
  const withCategory = addCategory(project, { name: "Шторы", color: "#123456", shape: "square" });
  assert.equal(withCategory.project.categories.length, 9);
  assert.equal(withCategory.category.order, 8);

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
  assert.equal(new Set(ids).size, 36);
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
  assert.equal(after.categories.length, 8);
});

test("имя объекта, вид и помещения правятся", () => {
  const { project: base, first } = projectWithSchemes();
  const named = updateProject(base, { name: "Квартира на Ленина", view: { markSize: 24 } }).project;
  assert.equal(named.name, "Квартира на Ленина");
  // Правка вида частичная: названное поле меняется, соседнее остаётся своим,
  // а не подменяется умолчанием (числа умолчания проверяет отдельный тест).
  assert.deepEqual(named.view, { markSize: 24, labelSize: base.view.labelSize });

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

// Настоящий подрозетник: в одной рамке рядом стоят выключатель и розетка.
test("«+» ставит метку выбранного типа: в блоке рядом с выключателем встаёт розетка", () => {
  const { project: base, first } = projectWithSchemes();
  const step = putPoint(base, first.id, "В", { x: 0.5, y: 0.5 });
  const socket = addToGroup(step.project, step.mark.id, "right", { typeId: typeId(base, "Р") });

  assert.equal(socket.mark.typeId, typeId(base, "Р"));
  assert.equal(labelOf(socket.project, socket.mark.id), "Р1");
  assert.equal(socket.project.counters["В"], 1);
  assert.equal(socket.project.counters["Р"], 1);
  assert.equal(labelOf(socket.project, socket.group.id), "В1, Р1");
  assert.deepEqual(findGroup(socket.project, socket.group.id).markIds, [step.mark.id, socket.mark.id]);
  assert.equal(findMark(socket.project, socket.mark.id).groupId, socket.group.id);
  assert.equal(findMark(socket.project, socket.mark.id).schemeId, first.id);
  assert.deepEqual(socket.mark.points[0], { x: 0.5 + 28 / 1000, y: 0.5 });
  // Цвет и форма — свои у каждой метки блока: он и должен быть разноцветным.
  assert.notDeepEqual(styleOf(socket.project, typeId(base, "Р")), styleOf(socket.project, typeId(base, "В")));

  // Вторая розетка в том же блоке — свой следующий номер по своему счётчику.
  const second = addToGroup(socket.project, socket.mark.id, "right", { typeId: typeId(base, "Р") });
  assert.equal(labelOf(second.project, second.mark.id), "Р2");
  assert.equal(second.project.counters["В"], 1);
  assert.equal(labelOf(second.project, socket.group.id), "В1, Р1Р2");

  // Удаление одной метки смешанного блока соседей не трогает, а распад блока
  // до одной метки распускает группу и возвращает метке собственную подпись.
  const withoutFirst = deleteMark(second.project, socket.mark.id).project;
  assert.equal(labelOf(withoutFirst, socket.group.id), "В1, Р2");
  const alone = deleteMark(withoutFirst, second.mark.id).project;
  assert.deepEqual(alone.groups, []);
  assert.equal(findMark(alone, step.mark.id).groupId, null);
  assert.equal(labelOf(alone, step.mark.id), "В1");
});

test("режим блока берётся у типа ставящейся метки, а не у соседней", () => {
  const { project: base, first } = projectWithSchemes();
  // Розетки — «одна метка на блок», выключатели — «каждая своя».
  const tuned = updateType(base, typeId(base, "Р"), { blockMode: "single" }).project;
  const step = putPoint(tuned, first.id, "В", { x: 0.5, y: 0.5 });

  // Своей розетки в блоке ещё нет — появляется первая, со своим номером.
  const socket = addToGroup(step.project, step.mark.id, "right", { typeId: typeId(base, "Р") });
  assert.equal(socket.project.marks.length, 2);
  assert.equal(socket.mark.points.length, 1);
  assert.equal(labelOf(socket.project, socket.mark.id), "Р1");

  // Вторая розетка того же блока дописывается точкой к первой: номер один.
  const more = addToGroup(socket.project, socket.mark.id, "right", { typeId: typeId(base, "Р") });
  assert.equal(more.project.marks.length, 2);
  assert.equal(findMark(more.project, socket.mark.id).points.length, 2);
  assert.equal(more.project.counters["Р"], 1);
  assert.equal(labelOf(more.project, socket.group.id), "В1, Р1");

  // «+» у выключателя с активной розеткой находит розетку блока, а не соседку.
  const fromSwitch = addToGroup(more.project, step.mark.id, "down", { typeId: typeId(base, "Р") });
  assert.equal(fromSwitch.project.marks.length, 2);
  assert.equal(findMark(fromSwitch.project, socket.mark.id).points.length, 3);

  // Обратно: у розетки «одна на блок» выключатель всё равно встаёт своей меткой.
  const back = addToGroup(fromSwitch.project, socket.mark.id, "up", { typeId: typeId(base, "В") });
  assert.equal(back.project.marks.length, 3);
  assert.equal(labelOf(back.project, back.mark.id), "В2");
  assert.equal(findMark(back.project, socket.mark.id).points.length, 3);
  assert.equal(labelOf(back.project, socket.group.id), "В1В2, Р1");
});

// ——— ручной номер ————————————————————————————————————————————————————
// Несколько одинаковых светильников, подключённых к одной группе, носят на
// схеме один номер. Номер выдаёт счётчик, но последнее слово — за инженером.
test("номер метки ставится вручную, мусор отвергается", () => {
  const { project: base, first } = projectWithSchemes();
  const { project: filled, ids } = putSeries(base, first.id, "Т", 2);

  const result = setMarkNumber(filled, ids[1], 7);
  assert.equal(labelOf(result.project, ids[1]), "Т7");
  assert.equal(result.mark.number, 7);
  // исходный объект не тронут: правка возвращается новым объектом
  assert.equal(labelOf(filled, ids[1]), "Т2");

  for (const bad of [0, -3, 2.5, "", "восемь", null]) {
    assert.throws(
      () => setMarkNumber(filled, ids[0], bad),
      (error) => error.code === "badNumber",
      "принят мусор вместо номера: " + String(bad),
    );
  }
  assert.throws(() => setMarkNumber(filled, ids[0], 100000), (error) => error.code === "numberTooBig");
});

// Повтор номера — осознанный приём: три точечных светильника одной группы
// подписаны Т1. Счётчик при этом обязан остаться впереди занятых номеров,
// иначе следующая новая метка молча заберёт чужое обозначение.
test("повтор номера разрешён, а счётчик типа не выдаёт дубль следующей метке", () => {
  const { project: base, first } = projectWithSchemes();
  const { project: filled, ids } = putSeries(base, first.id, "Т", 3);

  let project = setMarkNumber(filled, ids[1], 1).project;
  project = setMarkNumber(project, ids[2], 1).project;
  assert.deepEqual(ids.map((id) => labelOf(project, id)), ["Т1", "Т1", "Т1"]);

  const next = putPoint(project, first.id, "Т");
  assert.equal(labelOf(next.project, next.mark.id), "Т4");

  // Номер выше счётчика двигает счётчик вперёд — иначе Т20 выдадут второй раз.
  const ahead = setMarkNumber(next.project, next.mark.id, 20).project;
  assert.equal(ahead.counters["Т"], 20);
  const afterAhead = putPoint(ahead, first.id, "Т");
  assert.equal(labelOf(afterAhead.project, afterAhead.mark.id), "Т21");

  // Счётчики, потерянные при переносе объекта, не заставляют выдать дубль.
  const lost = structuredClone(afterAhead.project);
  lost.counters = {};
  const rescued = putPoint(lost, first.id, "Т");
  assert.equal(labelOf(rescued.project, rescued.mark.id), "Т22");
});

// Уплотнение смыкает ряд номеров, но намеренный повтор — часть разметки:
// метки с одним номером обязаны остаться с одним и после уплотнения.
test("уплотнение сохраняет повторы: одинаковые номера остаются одинаковыми", () => {
  const { project: base, first } = projectWithSchemes();
  const { project: filled, ids } = putSeries(base, first.id, "Т", 4);
  let project = setMarkNumber(filled, ids[1], 1).project; // Т1 Т1 Т3 Т4
  project = deleteMark(project, ids[2]).project; // Т1 Т1 Т4
  project = setMarkNumber(project, ids[3], 9).project; // Т1 Т1 Т9

  const result = compactNumbers(project, typeId(project, "Т"));
  assert.deepEqual(result.changes.map((change) => [change.fromLabel, change.toLabel]), [["Т9", "Т2"]]);
  assert.deepEqual(
    [ids[0], ids[1], ids[3]].map((id) => labelOf(result.project, id)),
    ["Т1", "Т1", "Т2"],
  );
  assert.equal(result.project.counters["Т"], 2);
  // После уплотнения новая метка идёт следующим номером, а не третьим Т1.
  const next = putPoint(result.project, first.id, "Т");
  assert.equal(labelOf(next.project, next.mark.id), "Т3");
});

// Повторы не обязаны стоять рядом: номер выдаётся первому появлению в порядке
// обхода, а вернувшийся тот же номер забирает его же.
test("уплотнение узнаёт повтор, даже когда между метками стоит чужой номер", () => {
  const { project: base, first } = projectWithSchemes();
  const { project: filled, ids } = putSeries(base, first.id, "Т", 3);
  let project = setMarkNumber(filled, ids[0], 5).project;
  project = setMarkNumber(project, ids[1], 2).project;
  project = setMarkNumber(project, ids[2], 5).project;

  const result = compactNumbers(project, typeId(project, "Т"));
  assert.deepEqual(ids.map((id) => labelOf(result.project, id)), ["Т1", "Т2", "Т1"]);
  assert.equal(result.project.counters["Т"], 2);
});

// Повтор разрешён, но не молчит: случайный дубль обязан быть виден. Это
// предупреждение, а не ошибка — «Т1 — таких меток 3».
test("validate предупреждает о повторе номера и считает метки", () => {
  const { project: base, first } = projectWithSchemes();
  const { project: filled, ids } = putSeries(base, first.id, "Т", 4);
  let project = setMarkNumber(filled, ids[1], 1).project;
  project = setMarkNumber(project, ids[2], 1).project;

  const problems = validate(project);
  assert.deepEqual(problems.map((problem) => problem.code), ["repeatedNumber"]);
  assert.equal(problems[0].kind, "warning");
  assert.equal(problems[0].message, "Т1 — таких меток 3");
  assert.equal(problems[0].ref, ids[0]);
  assert.deepEqual(
    repeatedNumbers(project).map((item) => [item.label, item.count, item.markIds.length]),
    [["Т1", 3, 3]],
  );

  // Один номер у разных типов — не повтор: Т1 и В1 живут каждый в своём ряду.
  const mixed = putPoint(project, first.id, "В").project;
  assert.deepEqual(validate(mixed).map((problem) => problem.code), ["repeatedNumber"]);

  // Настоящая поломка объекта остаётся ошибкой, а не предупреждением.
  const broken = structuredClone(project);
  broken.marks[3].schemeId = "нет-такой-схемы";
  const scheme = validate(broken).find((problem) => problem.code === "markWithoutScheme");
  assert.equal(scheme.kind, "error");
});

// Подпись блока перечисляет обозначения, а обозначение — не метка: два Т1
// в одной рамке названы одним «Т1», а не «Т1, Т1» и тем более не «Т1Т1».
test("подпись блока называет обозначение один раз, даже если номер повторили", () => {
  const { project: base, first } = projectWithSchemes();
  const step = addMark(base, {
    schemeId: first.id,
    typeId: typeId(base, "Т"),
    kind: "point",
    points: [
      { x: 0.2, y: 0.3 },
      { x: 0.25, y: 0.3 },
      { x: 0.3, y: 0.3 },
    ],
  });
  assert.equal(labelOf(step.project, step.group.id), "Т1Т2Т3");

  let project = setMarkNumber(step.project, step.marks[1].id, 1).project; // Т1 Т1 Т3
  assert.equal(labelOf(project, step.group.id), "Т1, Т3");

  project = setMarkNumber(project, step.marks[2].id, 2).project; // Т1 Т1 Т2
  assert.equal(labelOf(project, step.group.id), "Т1Т2");

  project = setMarkNumber(project, step.marks[2].id, 1).project; // Т1 Т1 Т1
  assert.equal(labelOf(project, step.group.id), "Т1");
});

// Смена типа — дорогая операция по ADR 003: она всегда выдаёт новый номер по
// новому типу. Ручной номер этого не меняет, а повтор в старом типе становится
// на метку меньше — и предупреждение считает по факту, а не по памяти.
test("смена типа у метки с ручным номером берёт свободный номер нового типа", () => {
  const { project: base, first } = projectWithSchemes();
  const { project: filled, ids } = putSeries(base, first.id, "Т", 3);
  let project = setMarkNumber(filled, ids[1], 1).project;
  project = setMarkNumber(project, ids[2], 1).project; // Т1 Т1 Т1

  const moved = changeMarkType(project, ids[2], typeId(project, "С")).project;
  assert.equal(labelOf(moved, ids[2]), "С1");
  assert.deepEqual(validate(moved).map((problem) => problem.message), ["Т1 — таких меток 2"]);

  // Номер, поставленный руками выше счётчика, не уезжает в новый тип.
  const manual = setMarkNumber(moved, ids[0], 40).project;
  const again = changeMarkType(manual, ids[0], typeId(manual, "С")).project;
  assert.equal(labelOf(again, ids[0]), "С2");
  assert.equal(again.counters["Т"], 40);
});

test("длинный код даёт обозначение целиком, а блок из него — диапазон", () => {
  const { project: base, first } = projectWithSchemes();
  const light = base.categories.find((c) => c.name === "Свет").id;
  const withLong = addType(base, { code: "ПОДСВЕТКА", name: "Подсветка ниши", categoryId: light });
  const longId = withLong.type.id;

  const single = addMark(withLong.project, {
    schemeId: first.id,
    typeId: longId,
    kind: "point",
    points: [{ x: 0.2, y: 0.2 }],
  });
  assert.equal(labelOf(single.project, single.mark.id), "ПОДСВЕТКА1");

  const block = addMark(single.project, {
    schemeId: first.id,
    typeId: longId,
    kind: "point",
    points: [
      { x: 0.3, y: 0.3 },
      { x: 0.35, y: 0.3 },
      { x: 0.4, y: 0.3 },
    ],
  });
  // подряд идущие сворачиваются в диапазон, а не склеиваются в «ПОДСВЕТКА2ПОДСВЕТКА3ПОДСВЕТКА4»
  assert.equal(labelOf(block.project, block.group.id), "ПОДСВЕТКА2–4");

  const gapped = deleteMark(block.project, block.marks[1].id).project;
  assert.equal(labelOf(gapped, block.group.id), "ПОДСВЕТКА2, ПОДСВЕТКА4");
});

test("короткий код по-прежнему склеивается слитно рядом с длинным", () => {
  const { project: base, first } = projectWithSchemes();
  const light = base.categories.find((c) => c.name === "Свет").id;
  const withLong = addType(base, { code: "ЛЕНТА", name: "Лента в нише", categoryId: light });

  const block = addMark(withLong.project, {
    schemeId: first.id,
    typeId: typeId(withLong.project, "В"),
    kind: "point",
    points: [
      { x: 0.2, y: 0.2 },
      { x: 0.25, y: 0.2 },
      { x: 0.3, y: 0.2 },
    ],
  });
  assert.equal(labelOf(block.project, block.group.id), "В1В2В3");

  // порядок в подписи блока — по справочнику: «Свет» идёт раньше «Выключателей»
  const mixed = changeMarkType(block.project, block.marks[2].id, withLong.type.id).project;
  assert.equal(labelOf(mixed, block.group.id), "ЛЕНТА1, В1В2");
});

test("переименование короткого кода в длинный переносит счётчик и подписи", () => {
  const { project: base, first } = projectWithSchemes();
  const { project: filled, ids } = putSeries(base, first.id, "П", 3);
  const renamed = updateType(filled, typeId(filled, "П"), { code: "ПОДСВЕТКА" }).project;

  assert.equal(labelOf(renamed, ids[2]), "ПОДСВЕТКА3");
  assert.equal(renamed.counters["ПОДСВЕТКА"], 3);
  assert.equal(renamed.counters["П"], undefined);
  assert.deepEqual(validate(renamed), []);
});

// Годность кода спрашивают у модели. Копия правила в окне выбора типа уже
// подвела однажды: она пережила снятие предела в две буквы и отказывалась
// заводить «ПОДСВЕТКА», хотя модель такой код принимала.
test("годен ли код — отвечает модель, одной функцией", () => {
  const project = createProject();
  assert.equal(codeProblem(project, "ПОДСВЕТКА"), null);
  assert.equal(codeProblem(project, "  ").code, "codeRequired");
  assert.equal(codeProblem(project, "П1").code, "codeLetters");
  assert.equal(codeProblem(project, "П-2").code, "codeLetters");
  assert.equal(codeProblem(project, "Я".repeat(CODE_MAX_LENGTH + 1)).code, "codeTooLong");
  assert.equal(codeProblem(project, "В").code, "codeTaken");

  // Свой же код у типа не занят: справочник правит название, не трогая код.
  const sw = project.markTypes.find((type) => type.code === "В");
  assert.equal(codeProblem(project, "В", sw.id), null);
});

// ——— поворот подписи и умолчания размера ——————————————————————————————

// На рукописном эталоне подписи написаны вдоль стены: в узком коридоре
// горизонтальная подпись не влезает. Угол — свойство метки, значит живёт в
// объекте и уезжает в файл проекта вместе с ним.
test("подпись метки поворачивается на 90° и обратно, чужие углы модель не берёт", () => {
  const project = addScheme(createProject(), { name: "1", width: 1000, height: 500 });
  const type = project.project.markTypes.find((item) => item.code === "Р");
  const added = addMark(project.project, {
    schemeId: project.scheme.id,
    typeId: type.id,
    points: [{ x: 0.5, y: 0.5 }],
  });
  assert.equal(added.mark.labelAngle, undefined, "у новой метки угла нет — подпись лежит как лежала");

  const turned = updateMark(added.project, added.mark.id, { labelAngle: 90 });
  assert.equal(turned.mark.labelAngle, 90);
  assert.equal(updateMark(turned.project, added.mark.id, { labelAngle: 0 }).mark.labelAngle, 0);

  // Угол — не произвольное число: 45° или строка означали бы, что подпись
  // нарисована в одном месте, а ловится в другом.
  assert.throws(() => updateMark(turned.project, added.mark.id, { labelAngle: 45 }), { code: "labelAngleUnknown" });
  assert.throws(() => updateMark(turned.project, added.mark.id, { labelAngle: "90" }), { code: "labelAngleUnknown" });
  assert.deepEqual(LABEL_ANGLES, [0, 90]);
});

// Проверяющий прошёл всю разметку и выгрузил схему, не узнав, что регулятор
// размера существует: на листе 2568×4000 подпись «Т1» вышла около 12 пикселей —
// меньше полутора миллиметров на бумаге, читать нечем.
test("размер меток и подписей по умолчанию читается на распечатке", () => {
  const view = createProject().view;
  // План 2500 пикселей по большей стороне на A3 — это 0,16 мм на пиксель.
  // Монтажник читает с расстояния вытянутой руки: подпись должна быть не
  // мельче 2,5 мм, то есть от 16 пикселей плана.
  assert.ok(view.labelSize * 0.16 >= 2.5, "подпись на A3 выходит " + view.labelSize * 0.16 + " мм");
  // И не крупнее сантиметра — иначе подписи съедят план.
  assert.ok(view.labelSize * 0.16 <= 10, "подпись раздута: " + view.labelSize * 0.16 + " мм");
  // Значок метки — круг радиусом markSize: на бумаге не меньше трёх миллиметров.
  assert.ok(view.markSize * 2 * 0.16 >= 3, "значок метки на A3 всего " + view.markSize * 2 * 0.16 + " мм");
});

// ——— общая база типов ————————————————————————————————————————————————
//
// Справочник объекта живёт своей жизнью, но стартовый пополняется: сперва
// проходной переключатель и витая пара, потом целая категория датчиков.
// Уже размеченные объекты о них не узнают, а «Вернуть стандартный шаблон»
// стирает правки пользователя. Общая база — способ донести новое, не тронув
// старого, поэтому проверяется в обе стороны: что предлагается и что при этом
// не меняется.

// Объект с пустым справочником: у него нет ни одной категории и ни одного типа.
function withoutDictionary() {
  return { ...createProject(), categories: [], markTypes: [] };
}

function offeredCodes(groups) {
  return groups.flatMap((group) => group.types.map((type) => type.code));
}

test("общая база: пустому справочнику предлагается всё, полному — ничего", () => {
  const offer = catalogOffer(withoutDictionary(), null);
  assert.deepEqual(
    offer.map((group) => group.category.name),
    ["Свет", "Выключатели", "Розетки", "Климат", "Сетевое оборудование", "Датчики", "Щит", "Сантехника"],
  );
  assert.equal(offeredCodes(offer).length, 28);
  assert.equal(offer[0].types[0].code, "Т");
  assert.equal(offer[0].category.existingId, null, "чужой категории в объекте ещё нет");

  // Объект, созданный со стартового справочника, уже знает всю базу: окно
  // должно сказать это строкой, а не показать пустой список.
  assert.deepEqual(catalogOffer(createProject(), null), []);
});

test("общая база предлагает только незанятые коды — при любом названии и раскладке", () => {
  const project = createProject();
  const light = project.categories.find((category) => category.name === "Свет").id;
  const older = { ...project, markTypes: project.markTypes.filter((type) => type.code !== "ВП" && type.code !== "RJ") };
  assert.deepEqual(offeredCodes(catalogOffer(older, null)), ["ВП", "RJ"]);

  // Код занят — строки нет вовсе, даже когда за кодом стоит совсем другой тип:
  // подменять чужой «ВП» базовым переключателем нельзя.
  const mine = addType(older, { code: "ВП", name: "Верхний прожектор", categoryId: light }).project;
  assert.deepEqual(offeredCodes(catalogOffer(mine, null)), ["RJ"]);

  // Занятость кода считается так же, как её считает `addType`: по верхнему
  // регистру. Иначе окно предложило бы «RJ» поверх собственного «rj».
  const lower = addType(older, { code: "rj", name: "Витая пара", categoryId: light }).project;
  assert.deepEqual(offeredCodes(catalogOffer(lower, null)), ["ВП"]);
});

test("из общей базы добавляются только отмеченные типы, остальной справочник не шевелится", () => {
  const project = createProject();
  const older = { ...project, markTypes: project.markTypes.filter((type) => type.code !== "ВП" && type.code !== "RJ") };
  const result = addTypesFromCatalog(older, null, ["ВП"]);

  assert.deepEqual(result.types.map((type) => type.code), ["ВП"]);
  assert.equal(result.types[0].name, "Переключатель проходной");
  assert.equal(result.types[0].shape, "square-chevron", "форма приезжает из базы");
  assert.equal(result.types[0].blockMode, "each");
  assert.deepEqual(result.categories, [], "все категории у объекта уже есть");
  assert.equal(result.project.markTypes.length, older.markTypes.length + 1);
  assert.equal(result.project.markTypes.some((type) => type.code === "RJ"), false, "неотмеченный тип не добавился");
  // Категории — тот же массив: добавление типов их не переписывает, а значит
  // и цвета с формами остались как были.
  assert.equal(result.project.categories, older.categories);

  // Новый тип встаёт в конец своей категории, а не в начало справочника.
  const switches = typesInOrder(result.project).find((group) => group.category.name === "Выключатели");
  assert.deepEqual(switches.types.map((type) => type.code), ["В", "ВВ", "ВВВ", "ВП"]);

  // Добавлять нечего — тот же объект: пустого шага истории быть не должно.
  assert.equal(addTypesFromCatalog(older, null, []).project, older);
  assert.equal(addTypesFromCatalog(older, null, ["Т"]).project, older, "код занят — строки в базе нет");
  assert.equal(addTypesFromCatalog(older, null, ["ЫЫ"]).project, older, "ключа в базе нет");
});

test("недостающая категория заводится вместе с типом, знакомая переиспользуется без перекраски", () => {
  const added = addTypesFromCatalog(withoutDictionary(), null, ["дв", "ДО"]);
  assert.deepEqual(added.categories.map((category) => category.name), ["Датчики"]);
  assert.deepEqual(
    { color: added.categories[0].color, shape: added.categories[0].shape },
    { color: "#164E63", shape: "circle-ring" },
  );
  assert.deepEqual(added.types.map((type) => type.code), ["ДВ", "ДО"], "строчный ключ ловится тем же кодом");
  assert.equal(added.project.categories.length, 1, "лишних категорий не завелось");

  // Имя совпало — тип кладётся в чужую категорию как есть: перекрасить её
  // значило бы переписать цвета уже расставленных меток.
  const own = addCategory(withoutDictionary(), { name: "датчики", color: "#123456", shape: "square" });
  const into = addTypesFromCatalog(own.project, null, ["ДД"]);
  assert.deepEqual(into.categories, []);
  assert.equal(into.project.categories.length, 1);
  assert.deepEqual(
    { color: into.project.categories[0].color, shape: into.project.categories[0].shape },
    { color: "#123456", shape: "square" },
  );
  assert.equal(into.types[0].categoryId, own.category.id);
  assert.deepEqual(styleOf(into.project, into.types[0].id), { color: "#123456", shape: "square", lineStyle: "solid" });

  // И в окне видно будущий цвет, а не цвет базы: точка рядом с категорией
  // обязана совпасть с тем, что выйдет на план.
  const group = catalogOffer(own.project, null).find((item) => item.category.name === "датчики");
  assert.deepEqual(
    { color: group.category.color, shape: group.category.shape, existingId: group.category.existingId },
    { color: "#123456", shape: "square", existingId: own.category.id },
  );
});

test("сохранённый шаблон побеждает встроенный и приносит свои строки", () => {
  const saved = {
    categories: [
      { id: "c-light", name: "Свет", color: "#000000", shape: "square" },
      { id: "c-blinds", name: "Шторы", color: "#8250DF", shape: "square-fill" },
    ],
    markTypes: [
      { categoryId: "c-light", code: "Т", name: "Точка своя", shape: "star", blockMode: "single" },
      { categoryId: "c-blinds", code: "Ш", name: "Штора", shape: "triangle-down", blockMode: "single" },
    ],
  };
  const offer = catalogOffer(withoutDictionary(), saved);
  // Порядок остаётся порядком встроенной базы: правка в шаблоне меняет строку,
  // а не место — привычный справочник не перетасовывается.
  assert.deepEqual(
    offer.map((group) => group.category.name),
    ["Свет", "Выключатели", "Розетки", "Климат", "Сетевое оборудование", "Датчики", "Щит", "Сантехника", "Шторы"],
  );
  const light = offer.find((group) => group.category.name === "Свет");
  assert.deepEqual(light.types[0], {
    key: "Т",
    code: "Т",
    name: "Точка своя",
    // Шаблон сохранён до того, как у типа появился вид: строка базы берёт
    // умолчание, а не уезжает в справочник с пустым полем.
    kind: "point",
    shape: "star",
    lineStyle: null,
    blockMode: "single",
  });
  assert.equal(light.category.color, "#000000", "цвет категории тоже от сохранённого шаблона");

  const added = addTypesFromCatalog(withoutDictionary(), saved, ["Т", "Ш"]);
  assert.deepEqual(added.types.map((type) => type.name), ["Точка своя", "Штора"]);
  assert.deepEqual(added.categories.map((category) => category.name), ["Свет", "Шторы"]);
  assert.equal(added.types[0].blockMode, "single");
});

test("шаблон с мусором не ломает общую базу, а теряет только мусор", () => {
  const stale = {
    categories: [{ id: "c", name: "Шторы", color: "не цвет", shape: "cloud" }],
    markTypes: [
      { categoryId: "c", code: "Ш", name: "Штора", shape: "cloud", blockMode: "often" },
      { categoryId: "нет такой", code: "Я", name: "Потеряшка" },
    ],
  };
  const group = catalogOffer(withoutDictionary(), stale).find((item) => item.category.name === "Шторы");
  assert.deepEqual(group.types.map((type) => type.code), ["Ш"], "тип без своей категории не предлагается");
  assert.equal(group.types[0].shape, null, "неизвестная форма — это «как у категории»");
  assert.equal(group.types[0].blockMode, "each");
  assert.ok(/^#[0-9A-F]{6}$/.test(group.category.color), "цвет категории остаётся цветом: " + group.category.color);
  assert.ok(SHAPE_NAMES.includes(group.category.shape));

  const added = addTypesFromCatalog(withoutDictionary(), stale, ["Ш", "Я"]);
  assert.deepEqual(added.types.map((type) => type.code), ["Ш"]);
  assert.equal(added.project.categories.length, 1);
});

test("испорченный код из шаблона до окна не доходит, а не падает при добавлении", () => {
  // Шаблон, сохранённый до правила «код — только буквы», несёт «Ш1». Покажи
  // его окно — пользователь отметит его вместе с исправными, и `addType`
  // уронит весь пакет. Годность строки решает та же функция, что разбирает
  // код, введённый руками.
  const stale = {
    categories: [{ id: "c", name: "Шторы", color: "#8250DF", shape: "square" }],
    markTypes: [
      { categoryId: "c", code: "Ш1", name: "Штора с цифрой" },
      { categoryId: "c", code: "  ", name: "Без кода" },
      { categoryId: "c", code: "ОЧЕНЬДЛИННЫЙКОДТИПА", name: "Длиннее предела" },
      { categoryId: "c", code: "Ш", name: "Штора" },
    ],
  };
  const project = withoutDictionary();
  const groups = catalogOffer(project, stale);
  assert.deepEqual(groups.find((group) => group.category.name === "Шторы").types.map((type) => type.code), ["Ш"]);
  // Ни одной строки, которую справочник откажется принять: окно и `addType`
  // обязаны отвечать на вопрос о коде одинаково.
  for (const group of groups) {
    for (const type of group.types) {
      assert.equal(codeProblem(project, type.code), null, "окно предлагает код, который модель не примет: " + type.code);
    }
  }
});

test("негодная строка выпадает из пакета одна и называется, годные добавляются", () => {
  const stale = {
    categories: [{ id: "c", name: "Шторы", color: "#8250DF", shape: "square" }],
    markTypes: [
      { categoryId: "c", code: "Ш", name: "Штора" },
      { categoryId: "c", code: "Ш1", name: "Штора с цифрой" },
      { categoryId: "c", code: "ШТ", name: "Штора вторая" },
    ],
  };
  const result = addTypesFromCatalog(withoutDictionary(), stale, ["Ш", "Ш1", "ШТ"]);
  assert.deepEqual(result.types.map((type) => type.code), ["Ш", "ШТ"], "бросок на негодной строке уносил весь набор");
  assert.deepEqual(
    result.skipped.map((row) => ({ code: row.code, reason: row.reason })),
    [{ code: "Ш1", reason: "codeLetters" }],
    "пропущенное должно быть названо — молчание читается как «добавил, а его нет»",
  );
  assert.equal(result.project.markTypes.length, 2);
  assert.deepEqual(result.categories.map((category) => category.name), ["Шторы"]);

  // Занятый код — не беда, а «такой тип и так есть»: в жалобы он не попадает.
  const again = addTypesFromCatalog(result.project, stale, ["Ш"]);
  assert.deepEqual(again.skipped, []);
  assert.equal(again.project, result.project, "повторное добавление не должно ставить шаг истории");

  // Категория, заведённая под тип, который так и не добавился, не остаётся.
  const onlyBad = addTypesFromCatalog(withoutDictionary(), stale, ["Ш1"]);
  assert.deepEqual(onlyBad.types, []);
  assert.deepEqual(onlyBad.categories, []);
  assert.deepEqual(onlyBad.project.categories, []);
});

test("правило «та же категория» одно на модель", () => {
  const project = addCategory(withoutDictionary(), { name: " Датчики ", color: "#123456", shape: "square" }).project;
  assert.equal(categoryNameKey("  ДаТчИкИ  "), categoryNameKey("датчики"));
  assert.equal(findCategoryByName(project, "датчики"), project.categories[0]);
  assert.equal(findCategoryByName(project, "Датчик"), null);
  assert.equal(findCategoryByName(null, "Датчики"), null);
  // Общая база кладёт типы в неё же, а не заводит шестую категорию.
  assert.equal(addTypesFromCatalog(project, null, ["ДВ"]).project.categories.length, 1);
});

// Стартовый справочник пополняется, а справочник размеченного объекта — его
// собственный. Щит и новые значки обязаны доезжать до такого объекта через
// общую базу, и ровно в одну сторону: категория заводится, а форма типа,
// который в объекте уже есть, остаётся той, какой её видел монтажник.
test("щит доезжает до размеченного объекта, а его значки при этом не трогает", () => {
  const fresh = createProject();
  const panel = fresh.categories.find((category) => category.name === "Щит");
  // Объект, размеченный до этой правки: щита в справочнике нет, у выключателя
  // и кондиционера своей формы ещё не было, а метки уже расставлены.
  const older = {
    ...fresh,
    categories: fresh.categories.filter((category) => category.id !== panel.id),
    markTypes: fresh.markTypes
      .filter((type) => type.categoryId !== panel.id)
      .map((type) => (["В", "К"].includes(type.code) ? { ...type, shape: null } : type)),
  };
  const scheme = addScheme(older, { name: "План", width: 1000, height: 800 });
  const marked = addMark(scheme.project, {
    schemeId: scheme.scheme.id,
    typeId: scheme.project.markTypes.find((type) => type.code === "В").id,
    points: [{ x: 0.4, y: 0.4 }],
  });
  const before = styleOf(marked.project, marked.mark.typeId);

  const offer = catalogOffer(marked.project, null);
  assert.deepEqual(offer.map((group) => group.category.name), ["Щит"], "предлагается только то, чего в объекте нет");
  assert.deepEqual(offer[0].types.map((type) => type.code), ["Щ", "ЩС"]);

  const added = addTypesFromCatalog(marked.project, null, ["Щ", "ЩС"]);
  const grown = added.project;
  assert.deepEqual(added.categories.map((category) => category.name), ["Щит"]);
  assert.deepEqual(
    { color: added.categories[0].color, shape: added.categories[0].shape },
    { color: "#6E4B1F", shape: "square-bolt" },
  );
  assert.deepEqual(
    styleOf(grown, grown.markTypes.find((type) => type.code === "Щ").id),
    { color: "#6E4B1F", shape: "square-bolt", lineStyle: "solid" },
  );
  assert.equal(styleOf(grown, grown.markTypes.find((type) => type.code === "ЩС").id).shape, "square-cross");

  // Главное: свои значки объекта остались своими. Новая форма выключателя из
  // стартового справочника в размеченный объект не переезжает — распечатка на
  // руках у монтажника не должна разойтись с экраном.
  assert.deepEqual(styleOf(grown, marked.mark.typeId), before);
  assert.equal(grown.markTypes.find((type) => type.code === "В").shape, null);
  assert.equal(grown.markTypes.find((type) => type.code === "К").shape, null);
  assert.equal(grown.marks.length, 1);
  assert.equal(labelOf(grown, marked.mark.id), "В1");
});

// ——— смыкание номеров по всем типам ——————————————————————————————————

// Объект с дырами в трёх типах сразу: так он выглядит после месяца правок —
// метки удаляли, типы меняли, номера ставили руками.
function holesFixture() {
  let project = createProject({ name: "Квартира" });
  const added = addScheme(project, { name: "1 этаж", width: 1000, height: 800 });
  project = added.project;
  const schemeId = added.scheme.id;
  const typeOf = (code) => project.markTypes.find((type) => type.code === code).id;
  const ids = {};
  const put = (code, count) => {
    ids[code] = [];
    for (let i = 0; i < count; i += 1) {
      const step = addMark(project, {
        schemeId,
        typeId: typeOf(code),
        kind: "point",
        points: [{ x: 0.1 * (i + 1), y: 0.2 }],
      });
      project = step.project;
      ids[code].push(step.mark.id);
    }
  };
  put("Т", 4); // Т1 Т2 Т3 Т4
  put("В", 3); // В1 В2 В3
  put("Р", 2); // Р1 Р2 — этот тип оставим без дыр
  return { project, schemeId, typeOf, ids };
}

test("смыкание по всем типам: дыры уходят, типы без дыр не трогаются", () => {
  const box = holesFixture();
  let project = deleteMark(box.project, box.ids["Т"][1]).project; // Т1 Т3 Т4
  project = deleteMark(project, box.ids["В"][0]).project; // В2 В3

  const result = compactAllNumbers(project);
  assert.deepEqual(
    result.groups.map((group) => group.code),
    ["Т", "В"],
    "тип без дыр попал в уплотнение",
  );
  assert.equal(result.changes, 4);
  const labels = (p, code) =>
    p.marks.filter((mark) => mark.typeId === box.typeOf(code)).map((mark) => labelOf(p, mark.id));
  assert.deepEqual(labels(result.project, "Т"), ["Т1", "Т2", "Т3"]);
  assert.deepEqual(labels(result.project, "В"), ["В1", "В2"]);
  // Розетки не трогали — ни номера, ни счётчик.
  assert.deepEqual(labels(result.project, "Р"), ["Р1", "Р2"]);
  assert.equal(result.project.counters["Р"], project.counters["Р"]);
  assert.deepEqual(validate(result.project), []);
});

test("смыкать нечего — возвращается тот же объект", () => {
  const box = holesFixture();
  const result = compactAllNumbers(box.project);
  assert.equal(result.project, box.project, "объект пересобрали без единой замены");
  assert.equal(result.changes, 0);
  assert.deepEqual(result.groups, []);
});

test("намеренный повтор номера переживает смыкание по всем типам", () => {
  const box = holesFixture();
  let project = setMarkNumber(box.project, box.ids["Т"][1], 1).project; // Т1 Т1 Т3 Т4
  project = deleteMark(project, box.ids["Т"][2]).project; // Т1 Т1 Т4

  const result = compactAllNumbers(project);
  const numbers = result.project.marks
    .filter((mark) => mark.typeId === box.typeOf("Т"))
    .map((mark) => mark.number);
  assert.deepEqual(numbers, [1, 1, 2], "повтор рассыпался на разные номера");
  assert.equal(result.project.counters["Т"], 2);
});

test("связи меток и размещения оборудования переживают смыкание всех типов", () => {
  const box = holesFixture();
  let project = deleteMark(box.project, box.ids["Т"][1]).project; // Т1 Т3 Т4 -> Т1 Т2 Т3
  project = deleteMark(project, box.ids["В"][0]).project; // В2 В3 -> В1 В2

  const lamp = box.ids["Т"][3];
  const lampTwo = box.ids["Т"][2];
  const switchMark = box.ids["В"][2];
  const socket = box.ids["Р"][0];
  // Выключатель управляет двумя светильниками — связь по идентификаторам.
  project = setMarkControls(project, switchMark, [lamp, lampTwo]).project;
  const added = addEquipment(project, { name: "Реле", vendor: "Shelly" });
  project = added.project;
  const placed = addPlacement(project, {
    equipmentId: added.equipment.id,
    markId: socket,
    links: [lamp],
  });
  project = placed.project;

  const before = {
    controls: markControls(project, switchMark).map((mark) => mark.id),
    placementMark: findPlacement(project, placed.placement.id).markId,
    placementLinks: findPlacement(project, placed.placement.id).links,
  };
  const result = compactAllNumbers(project);
  const after = {
    controls: markControls(result.project, switchMark).map((mark) => mark.id),
    placementMark: findPlacement(result.project, placed.placement.id).markId,
    placementLinks: findPlacement(result.project, placed.placement.id).links,
  };
  assert.deepEqual(after, before, "связь или размещение переехали на чужую метку");
  // Те же метки, но уже под новыми обозначениями — связь осталась связью.
  assert.deepEqual(
    markControls(result.project, switchMark).map((mark) => labelOf(result.project, mark.id)),
    ["Т2", "Т3"],
  );
  assert.deepEqual(validate(result.project), [], "после смыкания объект должен быть чист");
});

test("поля «Расположение» и «В оригинале» смыкание не правит", () => {
  const box = holesFixture();
  let project = updateMark(box.project, box.ids["Т"][3], {
    location: "над тумбой слева",
    original: "Т4 по проекту электрика",
  }).project;
  project = deleteMark(project, box.ids["Т"][1]).project;

  const mark = findMark(compactAllNumbers(project).project, box.ids["Т"][3]);
  assert.equal(mark.number, 3, "номер не сомкнулся");
  assert.equal(mark.location, "над тумбой слева");
  assert.equal(mark.original, "Т4 по проекту электрика", "текстовое поле правили — там обозначение из чужого проекта");
});

// Заказчик: «сантехнику отдельной категорией». Водорозетка и выход канализации
// нарисованы в палитре, но в электрике им не место: цвет у нас читается как
// категория, и в «Розетках» они красились бы красным силовой розетки.
test("сантехника — своя категория шаблона с водорозеткой, канализацией и краном", () => {
  const template = defaultTemplate();
  const plumbing = template.categories.find((category) => category.name === "Сантехника");
  assert.ok(plumbing, "категории сантехники нет в шаблоне");
  assert.equal(plumbing.shape, "drop-dot", "у категории не тот знак");
  // Стоит последней: прежние категории не перетасованы, привычный порядок цел.
  assert.equal(template.categories[template.categories.length - 1].name, "Сантехника");

  const types = template.markTypes.filter((type) => type.categoryId === plumbing.id);
  assert.deepEqual(
    types.map((type) => [type.code, type.name, type.shape]),
    [
      ["ВР", "Водорозетка", null],
      ["КН", "Выход канализации", "circle-drain"],
      // Кран воды с электроприводом — по просьбе заказчика («кран в
      // сантехнику»). Знак в палитре уже был: круг с бабочкой — так рисуют
      // запорный кран.
      ["КВ", "Кран воды с электроприводом", "circle-valve"],
    ],
  );
  // Коды свободны: «К» занят кондиционером, «В» и «ВВ» — выключателями,
  // «КШ» — карнизом штор.
  assert.equal(template.markTypes.filter((type) => type.code === "ВР").length, 1);
  assert.equal(template.markTypes.filter((type) => type.code === "КН").length, 1);
  assert.equal(template.markTypes.filter((type) => type.code === "КВ").length, 1);
  // Все три типа точечные: сантехнику ставят точкой, а не тянут линией.
  assert.deepEqual(types.map((type) => type.kind), ["point", "point", "point"]);
});

// Правка стартового шаблона не доезжает до размеченного объекта сама — справочник
// копируется при создании. Новая категория попадает туда кнопкой «Добавить из
// общей базы», и вместе с типом заводится сама категория со своим цветом.
test("сантехника доезжает до прежнего объекта через общую базу", () => {
  const project = createProject();
  const plumbing = project.categories.find((category) => category.name === "Сантехника");
  // Объект прежней разметки: сантехники в справочнике нет вовсе.
  const older = {
    ...project,
    categories: project.categories.filter((category) => category.id !== plumbing.id),
    markTypes: project.markTypes.filter((type) => type.categoryId !== plumbing.id),
  };
  assert.equal(older.markTypes.length, 25, "пример не тот: в прежнем объекте 25 типов");

  const offered = catalogOffer(older, null).find((group) => group.category.name === "Сантехника");
  assert.ok(offered, "общая база не предлагает сантехнику объекту, где её нет");
  assert.deepEqual(offered.types.map((type) => type.code), ["ВР", "КН", "КВ"]);
  assert.equal(offered.category.existingId, null, "категории в объекте ещё нет");

  const result = addTypesFromCatalog(older, null, ["ВР", "КН", "КВ"]);
  const added = result.project.categories.find((category) => category.name === "Сантехника");
  assert.ok(added, "категория не завелась вместе с типами");
  assert.equal(added.color, "#E80098", "категория приехала с чужим цветом");
  assert.deepEqual(
    result.project.markTypes.filter((type) => type.categoryId === added.id).map((type) => type.code),
    ["ВР", "КН", "КВ"],
  );
  // Прежний справочник не тронут: ни один старый тип не поехал.
  assert.deepEqual(
    result.project.markTypes.slice(0, older.markTypes.length).map((type) => type.code),
    older.markTypes.map((type) => type.code),
  );
});

// Цвет категории в шаблоне сменили — но шаблон правит только новые объекты.
// Слова заказчика: «все изменения не должны ломать текущий проект». У кого
// сантехника уже заведена, тот открывает объект в своём прежнем цвете, и
// кнопка «Добавить из общей базы» приносит новый тип, ничего не перекрашивая.
test("новый цвет сантехники не трогает объект, где она уже заведена", () => {
  const { project: base, first } = projectWithSchemes();
  const plumbing = findCategoryByName(base, "Сантехника");
  // Объект прежней разметки: сантехника заведена тёмным морским, крана в
  // справочнике ещё нет, водорозетка уже поставлена на план.
  let older = updateCategory(base, plumbing.id, { color: "#0A6E52" }).project;
  older = { ...older, markTypes: older.markTypes.filter((type) => type.code !== "КВ") };
  const placed = putPoint(older, first.id, "ВР");
  older = placed.project;
  assert.equal(styleOf(older, typeId(older, "ВР")).color, "#0A6E52");

  const after = addTypesFromCatalog(older, null, ["КВ"]).project;
  const category = findCategoryByName(after, "Сантехника");
  assert.equal(category.id, plumbing.id, "категория завелась второй раз");
  assert.equal(category.color, "#0A6E52", "объект перекрасило вслед за шаблоном");
  assert.equal(styleOf(after, typeId(after, "ВР")).color, "#0A6E52", "водорозетка сменила цвет");
  assert.equal(labelOf(after, placed.mark.id), "ВР1", "подпись метки поехала");

  // Кран приехал в ту же категорию и красится её цветом, а не шаблонным.
  const valve = after.markTypes.find((type) => type.code === "КВ");
  assert.equal(valve.categoryId, category.id);
  assert.deepEqual(styleOf(after, valve.id), { color: "#0A6E52", shape: "circle-valve", lineStyle: "solid" });

  // А новый объект заводится уже с новым цветом: шаблон и объект живут порознь.
  assert.equal(findCategoryByName(createProject(), "Сантехника").color, "#E80098");
});

// ——— принятые предупреждения ————————————————————————————————————————
//
// «Повтор номера это не предупреждение тут, а специально сделано» — слова
// заказчика. Ответ на такое живёт в объекте, а ключ ответа выбран так, чтобы
// четвёртая метка в группе не вернула уже закрытую строку.

test("ключ принятия у повтора номера — тип и номер, а не первая метка", () => {
  const { project: base, first } = projectWithSchemes();
  const { project: filled, ids } = putSeries(base, first.id, "Т", 4);
  let project = setMarkNumber(filled, ids[1], 1).project;
  project = setMarkNumber(project, ids[2], 1).project; // Т1 Т1 Т1 Т4

  const problem = validate(project).find((item) => item.code === "repeatedNumber");
  assert.equal(problem.key, "repeatedNumber:" + typeId(project, "Т") + "#1");
  // Ссылка на виновника — по-прежнему метка: по ней панель ведёт на план.
  assert.equal(problem.ref, ids[0]);

  // Четвёртый светильник в той же группе: меток стало больше, ключ тот же.
  const more = setMarkNumber(project, ids[3], 1).project;
  const grown = validate(more).find((item) => item.code === "repeatedNumber");
  assert.equal(grown.message, "Т1 — таких меток 4");
  assert.equal(grown.key, problem.key);

  // Первую метку убрали — ключ и это переживает: принимали приём, а не метку.
  const shorter = deleteMark(more, ids[0]).project;
  assert.equal(validate(shorter).find((item) => item.code === "repeatedNumber").key, problem.key);

  // Другой номер того же типа — другое предупреждение и другой ключ.
  let other = setMarkNumber(shorter, ids[1], 7).project;
  other = setMarkNumber(other, ids[2], 7).project;
  assert.notEqual(validate(other).find((item) => item.code === "repeatedNumber").key, problem.key);
});

test("принятое предупреждение помнится в объекте и возвращается в работу", () => {
  const { project: base, first } = projectWithSchemes();
  const { project: filled, ids } = putSeries(base, first.id, "Т", 3);
  let project = setMarkNumber(filled, ids[1], 1).project;
  project = setMarkNumber(project, ids[2], 1).project;

  const problem = validate(project).find((item) => item.code === "repeatedNumber");
  assert.equal(problemAccepted(project, problem.key), false);

  const accepted = acceptProblem(project, problem).project;
  assert.equal(problemAccepted(accepted, problem.key), true);
  const records = acceptedProblems(accepted);
  assert.equal(records.length, 1);
  assert.equal(records[0].key, problem.key);
  assert.equal(records[0].code, "repeatedNumber");
  assert.equal(records[0].kind, "warning");
  // Текст запоминается тот, который пользователь видел, когда отвечал.
  assert.equal(records[0].label, "Т1 — таких меток 3");
  assert.ok(records[0].at);
  // Сам объект не тронут: принятие ничего не чинит и меток не правит.
  assert.deepEqual(accepted.marks, project.marks);
  // `validate` осталась таблицей правил: она по-прежнему называет повтор,
  // а прячет его панель — по ключу.
  assert.ok(validate(accepted).some((item) => item.key === problem.key));

  // Принято повторно — тот же объект: ни второй записи, ни лишнего шага истории.
  assert.equal(acceptProblem(accepted, problem).project, accepted);
  assert.equal(acceptProblem(accepted, { code: "repeatedNumber" }).project, accepted);

  // Вернули в работу — записи нет.
  const back = unacceptProblem(accepted, problem.key).project;
  assert.deepEqual(acceptedProblems(back), []);
  assert.equal(problemAccepted(back, problem.key), false);
  // Возвращать нечего — тот же объект.
  assert.equal(unacceptProblem(back, problem.key).project, back);
  assert.equal(unacceptProblem(back, "нет-такого-ключа").project, back);
});

test("принять можно и ошибку, но вид ответа запоминается", () => {
  const { project: base, first } = projectWithSchemes();
  const step = putPoint(base, first.id, "Т");
  const broken = {
    ...step.project,
    marks: step.project.marks.map((mark) => ({ ...mark, roomId: "помещения-нет" })),
  };
  const problem = validate(broken).find((item) => item.code === "markWithoutRoom");
  const accepted = acceptProblem(broken, problem).project;
  assert.equal(acceptedProblems(accepted)[0].kind, "error");
  assert.equal(acceptedProblems(accepted)[0].key, "markWithoutRoom:" + step.mark.id);
});

// G97, слова заказчика: «по метке, типо Т4 — корректно. Но это тоже должно
// переживать уплотнение меток». Смыкание меняет Т4 на Т2 — принятое обязано
// переехать вместе с обозначением, иначе тот же вопрос задастся заново.
function houseWithAcceptedRepeat() {
  const { project: base, first } = projectWithSchemes();
  const { project: filled, ids } = putSeries(base, first.id, "Т", 5);
  // Т4 Т4 Т4 плюс дыры до них: удаляем первые две метки и повторяем номер.
  let project = setMarkNumber(filled, ids[3], 4).project;
  project = setMarkNumber(project, ids[4], 4).project;
  project = deleteMark(project, ids[0]).project;
  project = deleteMark(project, ids[1]).project; // Т3 Т4 Т4 → после смыкания Т1 Т2 Т2
  const problem = validate(project).find((item) => item.code === "repeatedNumber");
  assert.equal(problem.message, "Т4 — таких меток 2");
  return { project: acceptProblem(project, problem).project, problem, ids };
}

test("смыкание номеров переносит принятое на новый номер", () => {
  const { project, problem } = houseWithAcceptedRepeat();
  const code = typeId(project, "Т");

  const compacted = compactNumbers(project, code).project;
  assert.deepEqual(validate(compacted).map((item) => item.message), ["Т2 — таких меток 2"]);
  const records = acceptedProblems(compacted);
  assert.equal(records.length, 1);
  assert.equal(records[0].key, "repeatedNumber:" + code + "#2");
  // Запомненный текст читается по новому обозначению, а не по исчезнувшему.
  assert.equal(records[0].label, "Т2 — таких меток 2");
  // Принято по-прежнему то же самое: повтор после смыкания не всплывает заново.
  assert.equal(problemAccepted(compacted, validate(compacted)[0].key), true);
  assert.equal(problemAccepted(compacted, problem.key), false, "старый ключ не остаётся висеть");

  // Отмена смыкания — это прежний объект целиком: в нём и номера, и принятия
  // те, что были. Ctrl+Z возвращает его одним шагом.
  assert.equal(acceptedProblems(project)[0].key, problem.key);
  assert.deepEqual(validate(project).map((item) => item.message), ["Т4 — таких меток 2"]);
});

test("смыкание по всем типам переносит принятое так же", () => {
  const { project, problem } = houseWithAcceptedRepeat();
  const code = typeId(project, "Т");

  const result = compactAllNumbers(project);
  assert.ok(result.changes > 0);
  assert.deepEqual(validate(result.project).map((item) => item.message), ["Т2 — таких меток 2"]);
  assert.equal(problemAccepted(result.project, "repeatedNumber:" + code + "#2"), true);
  assert.equal(problemAccepted(result.project, problem.key), false);
});

test("смыкание чужого типа принятого не трогает", () => {
  const { project } = houseWithAcceptedRepeat();
  const before = acceptedProblems(project);
  const other = compactNumbers(project, typeId(project, "В")).project;
  assert.deepEqual(acceptedProblems(other), before);
});

// G68: старый объект открывается как раньше. Списка принятых в нём нет вовсе —
// и это не ошибка, а обычный объект, размеченный до этого таска.
test("объект без списка принятых открывается как раньше", () => {
  const { project: base, first } = projectWithSchemes();
  const { project: filled, ids } = putSeries(base, first.id, "Т", 2);
  const project = setMarkNumber(filled, ids[1], 1).project;
  const old = { ...project };
  delete old.accepted;

  assert.deepEqual(acceptedProblems(old), []);
  assert.equal(problemAccepted(old, "repeatedNumber:что-угодно"), false);
  assert.deepEqual(validate(old).map((item) => item.code), validate(project).map((item) => item.code));
  // Смыкание такого объекта — как раньше: переносить нечего, поля не заводится.
  const compacted = compactNumbers(old, typeId(old, "Т")).project;
  assert.equal(compacted.accepted, undefined);
  assert.deepEqual(acceptedProblems(compacted), []);

  // Первое же принятие заводит список, и остальное в объекте не меняется.
  const problem = validate(old).find((item) => item.code === "repeatedNumber");
  const accepted = acceptProblem(old, problem).project;
  assert.equal(acceptedProblems(accepted).length, 1);
  assert.deepEqual(accepted.marks, old.marks);
  assert.deepEqual(accepted.counters, old.counters);
});

// ——— размеры метки: длина, ширина и высота над полом ——————————————————
//
// Три необязательных числа в миллиметрах. Проверяется здесь не «поле
// записалось», а три решения таска: пустое — не задано, ноль — значение,
// мусор не принимается.

test("размеры метки пишутся и читаются; порядок полей — порядок окна", () => {
  const { project: base, first } = projectWithSchemes();
  const step = putPoint(base, first.id, "Р");
  assert.deepEqual(MARK_DIMENSION_FIELDS, ["length", "width", "heightAboveFloor"]);

  const after = setMarkDimensions(step.project, step.mark.id, {
    length: 600,
    width: "400",
    heightAboveFloor: 300,
  }).project;
  assert.deepEqual(markDimensions(findMark(after, step.mark.id)), {
    length: 600,
    width: 400,
    heightAboveFloor: 300,
  });
  assert.equal(markHasDimensions(findMark(after, step.mark.id)), true);
  // Объект прежний не тронут: команда чистая, как все остальные.
  assert.equal(markHasDimensions(findMark(step.project, step.mark.id)), false);
});

test("пустое — «не задано», ноль — значение", () => {
  const { project: base, first } = projectWithSchemes();
  const step = putPoint(base, first.id, "Р");

  // Метка в полу: высота над полом ноль — это ответ, а не пустота.
  const zero = setMarkDimensions(step.project, step.mark.id, { heightAboveFloor: 0 }).project;
  assert.equal(findMark(zero, step.mark.id).heightAboveFloor, 0);
  assert.equal(markHasDimensions(findMark(zero, step.mark.id)), true);
  assert.equal(markDimensions(findMark(zero, step.mark.id)).length, null);

  // Пустая строка стирает обратно в «не задано» — и метка снова ничем не
  // отличается от той, которой размеров не ставили.
  const cleared = setMarkDimensions(zero, step.mark.id, { heightAboveFloor: "" }).project;
  assert.equal(findMark(cleared, step.mark.id).heightAboveFloor, null);
  assert.equal(markHasDimensions(findMark(cleared, step.mark.id)), false);

  // Ноль и пустота — разные вещи и для самого разбора значения.
  assert.equal(markDimensionValue(0), 0);
  assert.equal(markDimensionValue("0"), 0);
  assert.equal(markDimensionValue(""), null);
  assert.equal(markDimensionValue("  "), null);
  assert.equal(markDimensionValue(null), null);
  assert.equal(markDimensionValue(undefined), null);
  // Запятую набирают чаще точки — принимается и она.
  assert.equal(markDimensionValue("1,5"), 1.5);
});

test("отрицательное, нечисловое и запредельное не принимаются", () => {
  const { project: base, first } = projectWithSchemes();
  const step = putPoint(base, first.id, "Р");
  const markId = step.mark.id;

  for (const bad of [-1, "-1", "абв", "12abc", NaN, Infinity]) {
    assert.throws(
      () => setMarkDimensions(step.project, markId, { length: bad }),
      (error) => error.code === "badDimension",
      "принято негодное значение: " + String(bad),
    );
  }
  assert.throws(
    () => setMarkDimensions(step.project, markId, { length: MARK_DIMENSION_MAX + 1 }),
    (error) => error.code === "dimensionTooBig",
  );
  // Ровно потолок — законный размер.
  assert.equal(
    findMark(setMarkDimensions(step.project, markId, { length: MARK_DIMENSION_MAX }).project, markId).length,
    MARK_DIMENSION_MAX,
  );

  // Правка через общий `updateMark` идёт по тем же правилам: второго входа
  // для размеров в метку нет.
  assert.throws(() => updateMark(step.project, markId, { width: -5 }), (error) => error.code === "badDimension");
  assert.equal(findMark(updateMark(step.project, markId, { width: "70" }).project, markId).width, 70);
});

test("поля, которых в правке нет, остаются как были", () => {
  const { project: base, first } = projectWithSchemes();
  const step = putPoint(base, first.id, "Р");
  const filled = setMarkDimensions(step.project, step.mark.id, { length: 600, width: 400 }).project;
  const after = setMarkDimensions(filled, step.mark.id, { heightAboveFloor: 900 }).project;
  assert.deepEqual(markDimensions(findMark(after, step.mark.id)), {
    length: 600,
    width: 400,
    heightAboveFloor: 900,
  });
});

// G68: старый объект открывается как раньше. Полей размеров у его меток нет
// вовсе — и это не ошибка, а обычная разметка, сделанная до этого таска.
test("метка без полей размеров открывается как раньше", () => {
  const { project: base, first } = projectWithSchemes();
  const { project: filled, ids } = putSeries(base, first.id, "Т", 3);
  const project = updateMark(filled, ids[0], { location: "над тумбой", original: "В31" }).project;

  // Объект прежней разметки: полей размеров у меток нет физически.
  const old = {
    ...project,
    marks: project.marks.map((mark) => {
      const copy = { ...mark };
      for (const field of MARK_DIMENSION_FIELDS) delete copy[field];
      return copy;
    }),
  };

  for (const mark of old.marks) {
    assert.deepEqual(markDimensions(mark), { length: null, width: null, heightAboveFloor: null });
    assert.equal(markHasDimensions(mark), false);
  }
  // Ни одна метка, ни один номер, ни одна подпись не изменились.
  assert.deepEqual(old.marks.map((mark) => mark.number), project.marks.map((mark) => mark.number));
  assert.deepEqual(old.marks.map((mark) => labelOf(old, mark.id)), project.marks.map((mark) => labelOf(project, mark.id)));
  assert.deepEqual(validate(old).map((item) => item.code), validate(project).map((item) => item.code));
  assert.equal(labelOf(old, ids[2]), "Т3");
  assert.equal(findMark(old, ids[0]).location, "над тумбой");

  // Правка соседнего поля полей размеров не заводит: старая метка остаётся
  // ровно такой, какой была.
  const edited = updateMark(old, ids[1], { location: "у окна" }).project;
  const untouched = findMark(edited, ids[1]);
  for (const field of MARK_DIMENSION_FIELDS) {
    assert.equal(Object.prototype.hasOwnProperty.call(untouched, field), false, "поле " + field + " завелось само");
  }

  // Первая же запись размеров заводит поля — и больше в метке не меняет ничего.
  const sized = setMarkDimensions(old, ids[0], { heightAboveFloor: 300 }).project;
  assert.equal(findMark(sized, ids[0]).heightAboveFloor, 300);
  assert.deepEqual(
    { ...findMark(sized, ids[0]), heightAboveFloor: undefined },
    { ...findMark(old, ids[0]), heightAboveFloor: undefined },
  );
  assert.deepEqual(sized.counters, old.counters);
});
