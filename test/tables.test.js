// Шов таблиц: что окажется на бумаге у монтажника. Чистые функции от объекта
// модели — ни DOM, ни canvas. Проверяются группировки, сортировка и три
// текстовых формата; картинку и печать проверяет приёмка.
import { test } from "node:test";
import assert from "node:assert/strict";
import { addMark, addRoom, addScheme, createProject, updateMark } from "../src/model.js";
import { marksTable, toCsv, toMarkdown, toTsv, typesTable } from "../src/tables.js";

// Комната с рукописного листа: свет, выключатели и розетки одной спальни.
function tablesFixture() {
  let project = createProject({ name: "Квартира на Ленина" });
  const scheme = addScheme(project, { name: "1 этаж", width: 1000, height: 800 });
  project = scheme.project;
  const schemeId = scheme.scheme.id;
  const bedroom = addRoom(project, "Спальная Оли");
  project = bedroom.project;
  const hall = addRoom(project, "Холл");
  project = hall.project;

  const typeOf = (code) => project.markTypes.find((type) => type.code === code).id;
  const put = (code, patch) => {
    const added = addMark(project, {
      schemeId,
      typeId: typeOf(code),
      kind: "point",
      points: [{ x: 0.2, y: 0.3 }],
    });
    project = patch ? updateMark(added.project, added.mark.id, patch).project : added.project;
    return added.mark.id;
  };

  const room = bedroom.room.id;
  const spot1 = put("Т", { roomId: room, location: "точка под зеркалом", original: "В33" });
  const spot2 = put("Т", { roomId: room, location: "над кроватью", original: "В33" });
  const lamp1 = put("С", { roomId: room, location: "светильник над тумбой слева", original: "В34" });
  const socket1 = put("Р", { roomId: hall.room.id, location: "розетки у кресла" });

  return {
    get project() {
      return project;
    },
    set project(value) {
      project = value;
    },
    schemeId,
    typeOf,
    put,
    rooms: { bedroom: room, hall: hall.room.id },
    marks: { spot1, spot2, lamp1, socket1 },
  };
}

test("таблица меток: пять колонок, группы по категориям в порядке справочника, внутри — по типу и номеру", () => {
  const box = tablesFixture();
  const table = marksTable(box.project, null, "category");

  assert.deepEqual(table.columns, ["Обозначение", "Тип", "Помещение", "Расположение", "В оригинале"]);
  assert.deepEqual(
    table.groups.map((group) => group.title),
    ["Свет", "Розетки"],
  );
  assert.equal(table.groups[0].color, "#1F6FEB");
  assert.equal(table.groups[1].color, "#D1242F");
  assert.deepEqual(
    table.groups[0].rows.map((row) => row.cells[0]),
    ["Т1", "Т2", "С1"],
  );
  assert.deepEqual(table.groups[0].rows[0].cells, [
    "Т1",
    "Точечный светильник",
    "Спальная Оли",
    "точка под зеркалом",
    "В33",
  ]);
  assert.equal(table.groups[1].rows[0].color, "#D1242F");
});

test("разбивка переключается: по типам, по помещениям; метка без помещения уходит в последнюю группу", () => {
  const box = tablesFixture();
  const byType = marksTable(box.project, null, "type");
  assert.deepEqual(
    byType.groups.map((group) => group.title),
    ["Т — Точечный светильник", "С — Светильник", "Р — Розетка"],
  );
  assert.deepEqual(byType.groups[0].rows.map((row) => row.cells[0]), ["Т1", "Т2"]);

  box.put("В");
  const byRoom = marksTable(box.project, null, "room");
  assert.deepEqual(
    byRoom.groups.map((group) => group.title),
    ["Спальная Оли", "Холл", "Без помещения"],
  );
  assert.deepEqual(byRoom.groups[0].rows.map((row) => row.cells[0]), ["Т1", "Т2", "С1"]);
  assert.deepEqual(byRoom.groups[2].rows.map((row) => row.cells[0]), ["В1"]);
});

test("скрытое фильтром в таблицу не попадает: категории, поиск и отдельная схема", () => {
  const box = tablesFixture();
  const sockets = box.project.categories.find((category) => category.name === "Розетки");
  const onlySockets = marksTable(box.project, { categoryIds: [sockets.id] }, "category");
  assert.deepEqual(onlySockets.groups.map((group) => group.title), ["Розетки"]);

  const byQuery = marksTable(box.project, { query: "в33" }, "category");
  assert.deepEqual(byQuery.groups[0].rows.map((row) => row.cells[0]), ["Т1", "Т2"]);

  const second = addScheme(box.project, { name: "2 этаж", width: 1000, height: 800 });
  box.project = second.project;
  const alien = addMark(box.project, {
    schemeId: second.scheme.id,
    typeId: box.typeOf("Т"),
    kind: "point",
    points: [{ x: 0.5, y: 0.5 }],
  });
  box.project = alien.project;
  const whole = marksTable(box.project, null, "category");
  assert.deepEqual(whole.groups[0].rows.map((row) => row.cells[0]), ["Т1", "Т2", "Т3", "С1"]);
  const onlySecond = marksTable(box.project, { schemeId: second.scheme.id }, "category");
  assert.deepEqual(onlySecond.groups[0].rows.map((row) => row.cells[0]), ["Т3"]);
});

test("блок — одна строка с общей подписью; от урезанного фильтром блока остаются видимые метки", () => {
  const box = tablesFixture();
  const block = addMark(box.project, {
    schemeId: box.schemeId,
    typeId: box.typeOf("Р"),
    kind: "point",
    points: [{ x: 0.4, y: 0.4 }, { x: 0.45, y: 0.4 }],
    blockMode: "each",
  });
  box.project = block.project;
  box.project = updateMark(box.project, block.marks[0].id, { location: "розетки у кровати слева" }).project;
  box.project = updateMark(box.project, block.marks[1].id, { location: "розетки у кровати справа" }).project;

  const table = marksTable(box.project, null, "category");
  const sockets = table.groups.find((group) => group.title === "Розетки");
  assert.deepEqual(sockets.rows.map((row) => row.cells[0]), ["Р1", "Р2Р3"]);
  assert.equal(sockets.rows[1].cells[1], "Розетка");
  assert.equal(sockets.rows[1].cells[3], "розетки у кровати слева; розетки у кровати справа");

  const half = marksTable(box.project, { query: "кровати справа" }, "category");
  assert.deepEqual(half.groups[0].rows.map((row) => row.cells[0]), ["Р3"]);
});

// Маленькая таблица на одну строку: её текстовый вид выписан вручную, чтобы
// сверять не «то же, что считает код», а то, что увидит Excel и Markdown.
function tablesOneRow(box) {
  const sockets = box.project.categories.find((category) => category.name === "Розетки");
  return marksTable(box.project, { categoryIds: [sockets.id] }, "category");
}

test("CSV для русского Excel: BOM, точка с запятой, CRLF, кавычки вокруг разделителя", () => {
  const box = tablesFixture();
  const csv = toCsv(tablesOneRow(box));
  assert.equal(
    csv,
    "﻿" +
      [
        "Квартира на Ленина",
        "Показаны только: Розетки",
        "Обозначение;Тип;Помещение;Расположение;В оригинале",
        "Розетки",
        "Р1;Розетка;Холл;розетки у кресла;",
      ].join("\r\n") +
      "\r\n",
  );

  box.project = updateMark(box.project, box.marks.socket1, { location: 'слева; справа "у окна"' }).project;
  const quoted = toCsv(tablesOneRow(box));
  assert.ok(quoted.includes(';"слева; справа ""у окна""";'));
});

test("Markdown читается как документ: заголовок объекта, подзаголовок группы, таблица", () => {
  const box = tablesFixture();
  assert.equal(
    toMarkdown(tablesOneRow(box)),
    [
      "# Квартира на Ленина",
      "",
      "_Показаны только: Розетки_",
      "",
      "## Розетки",
      "",
      "| Обозначение | Тип | Помещение | Расположение | В оригинале |",
      "| --- | --- | --- | --- | --- |",
      "| Р1 | Розетка | Холл | розетки у кресла |  |",
      "",
    ].join("\n"),
  );

  box.project = updateMark(box.project, box.marks.socket1, { location: "слева | справа" }).project;
  assert.ok(toMarkdown(tablesOneRow(box)).includes("| слева \\| справа |"));
});

test("буфер обмена — табуляции без BOM: вставляется в Таблицы колонками", () => {
  const box = tablesFixture();
  assert.equal(
    toTsv(tablesOneRow(box)),
    [
      "Обозначение\tТип\tПомещение\tРасположение\tВ оригинале",
      "Розетки",
      "Р1\tРозетка\tХолл\tрозетки у кресла\t",
    ].join("\n"),
  );
});

test("справочник типов — легенда листа: код, название, категория, цвет и форма", () => {
  const box = tablesFixture();
  const table = typesTable(box.project);
  assert.deepEqual(table.columns, ["Код", "Название", "Категория", "Цвет", "Форма"]);
  assert.equal(table.rows.length, 13);
  assert.deepEqual(table.rows[0].cells, ["Т", "Точечный светильник", "Свет", "#1F6FEB", "Круг с крестом"]);
  assert.deepEqual(
    table.rows.map((row) => row.cells[0]),
    ["Т", "С", "ПК", "ТР", "П", "Л", "ПШ", "В", "ВВ", "Р", "Б", "К", "W"],
  );
  assert.equal(toTsv(table).split("\n")[1], "Т\tТочечный светильник\tСвет\t#1F6FEB\tКруг с крестом");
});

test("лист, сужённый фильтром по помещению, называет это помещение — как на рукописном листе", () => {
  const box = tablesFixture();
  const table = marksTable(box.project, { roomId: box.rooms.bedroom }, "category");
  assert.equal(table.title, "Квартира на Ленина");
  assert.equal(table.room, "Спальная Оли");
  assert.deepEqual(table.groups.map((group) => group.title), ["Свет"]);
  assert.equal(marksTable(box.project, null, "category").room, "");

  // Комната идёт отдельной строкой сразу под заголовком объекта, а не только
  // в колонке «Помещение»: по распечатке должно быть видно, что лист — по комнате.
  assert.equal(toCsv(table).split("\r\n")[1], "Спальная Оли");
  assert.deepEqual(toMarkdown(table).split("\n").slice(0, 3), ["# Квартира на Ленина", "", "**Спальная Оли**"]);
});

test("перевод строки в ячейке не разрывает вставку в Таблицы", () => {
  const box = tablesFixture();
  box.project = updateMark(box.project, box.marks.socket1, { location: "слева\nи справа\tу окна" }).project;
  const lines = toTsv(tablesOneRow(box)).split("\n");
  assert.equal(lines.length, 3);
  assert.equal(lines[2], "Р1\tРозетка\tХолл\tслева и справа у окна\t");
});

test("лист, сужённый галочками или поиском, говорит об этом строкой; полный лист молчит", () => {
  const box = tablesFixture();
  const sockets = box.project.categories.find((category) => category.name === "Розетки");

  const onlySockets = marksTable(box.project, { categoryIds: [sockets.id] }, "category");
  assert.equal(onlySockets.note, "Показаны только: Розетки");
  // Строка идёт рядом с комнатой — сразу под заголовком объекта.
  assert.equal(toCsv(onlySockets).split("\r\n")[1], "Показаны только: Розетки");

  const partialType = marksTable(box.project, { typeIds: [box.typeOf("Т")] }, "category");
  assert.equal(partialType.note, "Часть меток скрыта фильтром — лист неполный");
  assert.equal(marksTable(box.project, { query: "в33" }, "category").note, "Часть меток скрыта фильтром — лист неполный");

  assert.equal(marksTable(box.project, null, "category").note, "");
  assert.equal(
    marksTable(box.project, { categoryIds: null, typeIds: null, roomId: null, query: "" }, "category").note,
    "",
  );
  assert.equal(marksTable(box.project, { roomId: box.rooms.bedroom }, "category").note, "");
});
