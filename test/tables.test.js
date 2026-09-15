// Шов таблиц: что окажется на бумаге у монтажника. Чистые функции от объекта
// модели — ни DOM, ни canvas. Проверяются группировки, сортировка и три
// текстовых формата; картинку и печать проверяет приёмка.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addMark,
  addRoom,
  addScheme,
  addToGroup,
  addType,
  createProject,
  labelOf,
  setMarkControls,
  setMarkNumber,
  updateMark,
} from "../src/model.js";
import { linksTable, marksTable, toCsv, toMarkdown, toTsv, typesTable } from "../src/tables.js";

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

// Цвет помещения виден на плане контуром; на бумаге тем же цветом красится
// заголовок его группы — лист и схема должны узнаваться одним цветом.
test("заголовок группы по помещению взят из цвета помещения", () => {
  const box = tablesFixture();
  box.put("В");
  const byRoom = marksTable(box.project, null, "room");
  const bedroom = box.project.rooms.find((room) => room.id === box.rooms.bedroom);
  const hall = box.project.rooms.find((room) => room.id === box.rooms.hall);
  assert.equal(byRoom.groups[0].color, bedroom.color);
  assert.equal(byRoom.groups[1].color, hall.color);
  assert.notEqual(bedroom.color, hall.color);
  // «Без помещения» красить нечем.
  assert.equal(byRoom.groups[2].color, null);
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

test("блок даёт строку на каждую метку; от урезанного фильтром блока остаются видимые", () => {
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
  assert.deepEqual(sockets.rows.map((row) => row.cells[0]), ["Р1", "Р2", "Р3"]);
  assert.equal(sockets.rows[1].cells[1], "Розетка");
  assert.equal(sockets.rows[1].cells[3], "розетки у кровати слева");
  assert.equal(sockets.rows[2].cells[3], "розетки у кровати справа");

  const half = marksTable(box.project, { query: "кровати справа" }, "category");
  assert.deepEqual(half.groups[0].rows.map((row) => row.cells[0]), ["Р3"]);
});

test("смешанный блок — строка на каждую метку, у каждой свой тип", () => {
  const box = tablesFixture();
  const sw = addMark(box.project, {
    schemeId: box.schemeId,
    typeId: box.typeOf("В"),
    kind: "point",
    points: [{ x: 0.6, y: 0.6 }],
  });
  box.project = sw.project;
  const socket = addToGroup(box.project, sw.mark.id, "right", { typeId: box.typeOf("Р") });
  box.project = socket.project;
  const twin = addToGroup(box.project, socket.mark.id, "right", { typeId: box.typeOf("Р") });
  box.project = twin.project;
  box.project = updateMark(box.project, sw.mark.id, { location: "у двери" }).project;

  const table = marksTable(box.project, null, "category");
  const rows = table.groups.flatMap((group) => group.rows.map((row) => ({ title: group.title, cells: row.cells })));
  const switches = rows.filter((row) => row.cells[0] === "В1");
  assert.equal(switches.length, 1);
  assert.equal(switches[0].title, "Выключатели");
  assert.equal(switches[0].cells[1], "Выключатель");
  assert.equal(switches[0].cells[3], "у двери");

  // Розетки из того же блока стоят своими строками в своей категории:
  // общей строки «В1, Р2Р3» на листе больше нет.
  assert.deepEqual(
    rows.filter((row) => row.title === "Розетки").map((row) => [row.cells[0], row.cells[1]]),
    [["Р1", "Розетка"], ["Р2", "Розетка"], ["Р3", "Розетка"]],
  );

  // Лист розеток: от смешанного блока остаются видимые метки, каждая строкой.
  const sockets = box.project.categories.find((category) => category.name === "Розетки");
  const onlySockets = marksTable(box.project, { categoryIds: [sockets.id] }, "category");
  assert.deepEqual(onlySockets.groups.map((group) => group.title), ["Розетки"]);
  assert.deepEqual(onlySockets.groups[0].rows.map((row) => row.cells[0]), ["Р1", "Р2", "Р3"]);
  assert.equal(onlySockets.groups[0].rows[1].cells[1], "Розетка");
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

// Повтор номера — приём заказчика: несколько точечных светильников одной группы
// подписаны Т1. Обозначение у них одно — значит, и строка одна, а расположение
// каждой склеивается в её ячейке.
test("метки блока с повторённым номером дают одну строку и одно обозначение", () => {
  const box = tablesFixture();
  const added = addToGroup(box.project, box.marks.spot1, "right");
  box.project = setMarkNumber(added.project, added.mark.id, 1).project;
  box.project = updateMark(box.project, added.mark.id, { location: "вторая в группе" }).project;

  const table = marksTable(box.project, null, "category");
  assert.deepEqual(
    table.groups[0].rows.map((row) => row.cells[0]),
    ["Т1", "Т2", "С1"],
  );
  assert.deepEqual(table.groups[0].rows[0].cells.slice(1, 4), [
    "Точечный светильник",
    "Спальная Оли",
    "точка под зеркалом; вторая в группе",
  ]);
});

// Обозначение — это то, что написано на плане: две метки с одним обозначением
// монтажник читает как одну позицию, и строка у них одна — даже когда они
// стоят в разных комнатах и в блок не собраны.
test("метки с совпадающим обозначением сводятся в одну строку и вне блока", () => {
  const box = tablesFixture();
  box.project = setMarkNumber(box.project, box.marks.spot2, 1).project;
  box.project = updateMark(box.project, box.marks.spot2, { roomId: box.rooms.hall }).project;

  const light = marksTable(box.project, null, "category").groups[0];
  assert.deepEqual(light.rows.map((row) => row.cells[0]), ["Т1", "С1"]);
  assert.deepEqual(light.rows[0].cells, [
    "Т1",
    "Точечный светильник",
    "Спальная Оли, Холл",
    "точка под зеркалом; над кроватью",
    "В33",
  ]);
});

// Длинный код («ПОДСВЕТКА» вместо «П») доезжает в колонку целиком: сворачивать
// в таблице нечего — строка на метку, и обозначение у каждой своё.
test("длинный код виден в колонке «Обозначение» целиком, а на плане блок свёрнут", () => {
  const box = tablesFixture();
  const light = box.project.categories.find((category) => category.name === "Свет");
  const added = addType(box.project, { code: "ПОДСВЕТКА", name: "Подсветка ниши", categoryId: light.id });
  box.project = added.project;
  const block = addMark(box.project, {
    schemeId: box.schemeId,
    typeId: added.type.id,
    kind: "point",
    points: [{ x: 0.5, y: 0.5 }, { x: 0.55, y: 0.5 }, { x: 0.6, y: 0.5 }],
    blockMode: "each",
  });
  box.project = block.project;

  const group = marksTable(box.project, null, "type").groups.find(
    (item) => item.title === "ПОДСВЕТКА — Подсветка ниши",
  );
  assert.deepEqual(group.rows.map((row) => row.cells[0]), ["ПОДСВЕТКА1", "ПОДСВЕТКА2", "ПОДСВЕТКА3"]);
  // Подпись блока на плане заказчик не трогал: она одна и свёрнута в диапазон.
  assert.equal(labelOf(box.project, block.group.id), "ПОДСВЕТКА1–3");
});

// ——— двухуровневая разбивка: помещение, внутри — категории или типы ————

test("галка «по помещениям» даёт два уровня: помещение, внутри — прежняя разбивка", () => {
  const box = tablesFixture();
  box.put("В");
  const table = marksTable(box.project, null, "category", { byRoom: true });

  assert.equal(table.byRoom, true);
  assert.deepEqual(
    table.groups.map((group) => [group.level, group.title]),
    [
      [1, "Спальная Оли"],
      [2, "Свет"],
      [1, "Холл"],
      [2, "Розетки"],
      [1, "Без помещения"],
      [2, "Выключатели"],
    ],
  );
  // Строки живут только во внутренних группах; заголовок помещения их не несёт.
  assert.deepEqual(table.groups[0].rows, []);
  assert.deepEqual(table.groups[1].rows.map((row) => row.cells[0]), ["Т1", "Т2", "С1"]);
  assert.deepEqual(table.groups[3].rows.map((row) => row.cells[0]), ["Р1"]);
  assert.deepEqual(table.groups[5].rows.map((row) => row.cells[0]), ["В1"]);

  // Цвет помещения — у его заголовка, цвет категории — у внутренней группы.
  const bedroom = box.project.rooms.find((room) => room.id === box.rooms.bedroom);
  assert.equal(table.groups[0].color, bedroom.color);
  assert.equal(table.groups[1].color, "#1F6FEB");
  assert.equal(table.groups[4].color, null);
  // Идентификаторы внутренних групп не сталкиваются между помещениями.
  assert.equal(new Set(table.groups.map((group) => group.id)).size, table.groups.length);
});

test("внутри помещений разбивка переключается на типы; «по помещениям» в списке не задваивает уровень", () => {
  const box = tablesFixture();
  const byType = marksTable(box.project, null, "type", { byRoom: true });
  assert.deepEqual(
    byType.groups.map((group) => [group.level, group.title]),
    [
      [1, "Спальная Оли"],
      [2, "Т — Точечный светильник"],
      [2, "С — Светильник"],
      [1, "Холл"],
      [2, "Р — Розетка"],
    ],
  );
  assert.deepEqual(byType.groups[1].rows.map((row) => row.cells[0]), ["Т1", "Т2"]);

  const twice = marksTable(box.project, null, "room", { byRoom: true });
  assert.equal(twice.byRoom, false);
  assert.deepEqual(
    twice.groups.map((group) => [group.level, group.title]),
    [
      [1, "Спальная Оли"],
      [1, "Холл"],
    ],
  );
  assert.deepEqual(twice.groups[0].rows.map((row) => row.cells[0]), ["Т1", "Т2", "С1"]);
});

test("два уровня видны и в тексте: помещение — заголовок, разбивка внутри — подзаголовок", () => {
  const box = tablesFixture();
  const table = marksTable(box.project, { roomId: box.rooms.hall }, "category", { byRoom: true });
  assert.deepEqual(toMarkdown(table).split("\n").slice(0, 8), [
    "# Квартира на Ленина",
    "",
    "**Холл**",
    "",
    "## Холл",
    "",
    "### Розетки",
    "",
  ]);
  assert.deepEqual(toCsv(table).split("\r\n").slice(0, 5), [
    "﻿Квартира на Ленина",
    "Холл",
    "Обозначение;Тип;Помещение;Расположение;В оригинале",
    "Холл",
    "Розетки",
  ]);
});

// ——— таблица связей: что чем управляет ————————————————————————————————

// К меткам примера добавлены два выключателя: В1 в спальне управляет точками
// Т1 и Т2, В2 из холла — светильником С1 в спальне («В3 → Т1, Т2, Т3»
// с рукописного листа).
function tablesLinksFixture() {
  const box = tablesFixture();
  const switchOne = box.put("В", { roomId: box.rooms.bedroom, location: "у входа" });
  const switchTwo = box.put("В", { roomId: box.rooms.hall });
  box.project = setMarkControls(box.project, switchOne, [box.marks.spot1, box.marks.spot2]).project;
  box.project = setMarkControls(box.project, switchTwo, [box.marks.lamp1]).project;
  return { box, switchOne, switchTwo };
}

test("таблица связей: обе стороны, обозначение с помещением, чужая комната в скобках", () => {
  const { box } = tablesLinksFixture();
  const table = linksTable(box.project, null);

  assert.deepEqual(table.columns, ["Обозначение", "Тип", "Помещение", "Расположение", "Связанные метки"]);
  assert.deepEqual(
    table.groups.map((group) => [group.level, group.title]),
    [
      [1, "Управляет"],
      [1, "Управляется от"],
    ],
  );

  const forward = table.groups[0];
  assert.deepEqual(forward.rows.map((row) => row.cells[0]), ["В1", "В2"]);
  assert.deepEqual(forward.rows[0].cells, ["В1", "Выключатель", "Спальная Оли", "у входа", "Т1, Т2"]);
  // Метка из другой комнаты названа вместе с комнатой: на объекте в три этажа
  // «С1» без помещения ничего не говорит.
  assert.deepEqual(forward.rows[1].cells, ["В2", "Выключатель", "Холл", "", "С1 (Спальная Оли)"]);

  const back = table.groups[1];
  assert.deepEqual(back.rows.map((row) => row.cells[0]), ["Т1", "Т2", "С1"]);
  assert.equal(back.rows[0].cells[4], "В1");
  assert.equal(back.rows[2].cells[4], "В2 (Холл)");
});

test("в таблице связей нет меток без связей, а висящая ссылка не выглядит нормальной строкой", () => {
  const { box, switchOne } = tablesLinksFixture();
  const table = linksTable(box.project, null);
  // Р1 ничем не управляет и никем не управляется — строки у неё нет,
  // но лист говорит, сколько таких меток осталось за бортом.
  assert.equal(
    table.groups.every((group) => group.rows.every((row) => row.cells[0] !== "Р1")),
    true,
  );
  assert.equal(table.unlinked, 1);

  // Ссылка в никуда: метку удалили мимо модели, ссылка осталась.
  const broken = {
    ...box.project,
    marks: box.project.marks.map((mark) =>
      mark.id === switchOne ? { ...mark, controls: [...mark.controls, "нет-такой-метки"] } : mark,
    ),
  };
  const row = linksTable(broken, null).groups[0].rows[0];
  assert.equal(row.cells[4], "Т1, Т2, ссылка потеряна");
  assert.equal(row.problem, true);
});

test("галка «по помещениям» разводит связи по комнатам внутри каждой стороны", () => {
  const { box } = tablesLinksFixture();
  const table = linksTable(box.project, null, { byRoom: true });
  assert.deepEqual(
    table.groups.map((group) => [group.level, group.title]),
    [
      [1, "Управляет"],
      [2, "Спальная Оли"],
      [2, "Холл"],
      [1, "Управляется от"],
      [2, "Спальная Оли"],
    ],
  );
  assert.deepEqual(table.groups[1].rows.map((row) => row.cells[0]), ["В1"]);
  assert.deepEqual(table.groups[2].rows.map((row) => row.cells[0]), ["В2"]);
  assert.deepEqual(table.groups[4].rows.map((row) => row.cells[0]), ["Т1", "Т2", "С1"]);
  assert.deepEqual(table.groups[0].rows, []);
});
