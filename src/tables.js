// Таблицы объекта: список меток и справочник типов.
//
// Чистый модуль без DOM — это тот шов, по которому проверяется, что в таблице
// у заказчика окажется ровно то же, что инженер написал бы от руки: строка
// «ПК1 — подсв. кровати — В31», разбивка цветными заголовками категорий,
// справочник типов отдельным списком.
//
// Видимость меток берётся у `render.visibleMarks` — тем же кодом, что решает,
// рисовать метку на холсте или нет. Своего фильтра здесь нет намеренно:
// разойдись они, на картинке и в таблице оказалось бы разное.
import {
  findCategory,
  findRoom,
  findType,
  labelOf,
  roomsInOrder,
  schemesInOrder,
  styleOf,
  typesInOrder,
} from "./model.js";
import { visibleMarks } from "./render.js";
import { strings, text } from "./strings.js";

export const TABLE_GROUP_BY = ["category", "type", "room"];

// Колонки списка меток — дословно из спецификации.
function tableMarkColumns() {
  return [
    strings.tables.label,
    strings.tables.type,
    strings.tables.room,
    strings.tables.location,
    strings.tables.original,
  ];
}

// Плоский порядок типов: индекс типа в справочнике задаёт порядок строк
// внутри любой группы. Порядок один на всё приложение — model.typesInOrder.
function tableTypeOrder(project) {
  const order = new Map();
  let index = 0;
  for (const { types } of typesInOrder(project)) {
    for (const type of types) order.set(type.id, index++);
  }
  return order;
}

// Метки, прошедшие фильтр, по всем схемам объекта — или по одной, если
// в фильтре назван `schemeId` (панель зовёт так для «только текущая схема»).
function tableVisibleMarks(project, filter) {
  const only = filter && filter.schemeId ? String(filter.schemeId) : null;
  const marks = [];
  for (const scheme of schemesInOrder(project)) {
    if (only && scheme.id !== only) continue;
    marks.push(...visibleMarks(project, scheme, filter));
  }
  return marks;
}

// Блок — одна строка. На рукописном листе «Р1,Р2 — розетки у кресла» стоит
// одной строкой, и подпись у блока на плане тоже одна. Когда фильтр оставил
// от блока часть, подпись собирается из оставшихся меток.
function tableEntries(project, filter) {
  const marks = tableVisibleMarks(project, filter);
  const order = tableTypeOrder(project);
  const byGroup = new Map();
  const entries = [];

  const sortKey = (mark) => [order.has(mark.typeId) ? order.get(mark.typeId) : 999, mark.number];

  for (const mark of marks) {
    if (!mark.groupId) {
      entries.push({ id: mark.id, marks: [mark], groupId: null });
      continue;
    }
    let entry = byGroup.get(mark.groupId);
    if (!entry) {
      entry = { id: mark.groupId, marks: [], groupId: mark.groupId };
      byGroup.set(mark.groupId, entry);
      entries.push(entry);
    }
    entry.marks.push(mark);
  }

  for (const entry of entries) {
    entry.marks.sort((a, b) => {
      const [orderA, numberA] = sortKey(a);
      const [orderB, numberB] = sortKey(b);
      return orderA === orderB ? numberA - numberB : orderA - orderB;
    });
    const [head] = entry.marks;
    entry.head = head;
    entry.order = sortKey(head);
    entry.whole = entry.groupId
      ? (project.groups.find((group) => group.id === entry.groupId) || { markIds: [] }).markIds.length ===
        entry.marks.length
      : true;
  }

  entries.sort((a, b) => (a.order[0] === b.order[0] ? a.order[1] - b.order[1] : a.order[0] - b.order[0]));
  return entries;
}

// Несколько значений в одной ячейке (блок из разных типов или комнат) —
// перечисление без повторов: пустая ячейка лучше, чем «, , ».
function tableJoin(values, separator) {
  const seen = [];
  for (const value of values) {
    const clean = (value || "").trim();
    if (clean && !seen.includes(clean)) seen.push(clean);
  }
  return seen.join(separator);
}

function tableEntryLabel(project, entry) {
  if (entry.groupId && entry.whole) return labelOf(project, entry.groupId);
  return entry.marks.map((mark) => labelOf(project, mark.id)).join(", ");
}

function tableEntryRow(project, entry) {
  const cells = [
    tableEntryLabel(project, entry),
    tableJoin(
      entry.marks.map((mark) => {
        const type = findType(project, mark.typeId);
        return type ? type.name : "";
      }),
      ", ",
    ),
    tableJoin(
      entry.marks.map((mark) => {
        const room = mark.roomId ? findRoom(project, mark.roomId) : null;
        return room ? room.name : "";
      }),
      ", ",
    ),
    tableJoin(entry.marks.map((mark) => mark.location), "; "),
    tableJoin(entry.marks.map((mark) => mark.original), ", "),
  ];
  return { id: entry.id, cells, color: styleOf(project, entry.head.typeId).color };
}

function tableGroupOf(project, entry, groupBy) {
  const type = findType(project, entry.head.typeId);
  if (groupBy === "type") {
    return type
      ? { key: type.id, title: `${type.code} — ${type.name}`, color: styleOf(project, type.id).color }
      : { key: "none", title: strings.tables.type, color: null };
  }
  if (groupBy === "room") {
    const room = entry.head.roomId ? findRoom(project, entry.head.roomId) : null;
    return room
      ? { key: room.id, title: room.name, color: null }
      : { key: "none", title: strings.tables.noRoom, color: null };
  }
  const category = type ? findCategory(project, type.categoryId) : null;
  return category
    ? { key: category.id, title: category.name, color: category.color }
    : { key: "none", title: strings.tables.category, color: null };
}

// Порядок групп — порядок справочника и помещений объекта; группа без строк
// на бумагу не попадает.
function tableGroupOrder(project, groupBy) {
  const keys = [];
  if (groupBy === "room") {
    for (const room of roomsInOrder(project)) keys.push(room.id);
  } else {
    for (const { category, types } of typesInOrder(project)) {
      if (groupBy === "type") for (const type of types) keys.push(type.id);
      else keys.push(category.id);
    }
  }
  keys.push("none");
  return keys;
}

// Помещение, по которому сужен лист. На рукописном листе заказчика комната
// стоит сверху, и без неё распечатка по одной комнате внешне не отличается от
// полной — монтажник не увидит, что лист неполный.
function tableRoomTitle(project, filter) {
  if (!filter || !filter.roomId) return "";
  const room = findRoom(project, filter.roomId);
  return room ? room.name : "";
}

function tableTypeAllowed(filter, type) {
  if (Array.isArray(filter.typeIds) && !filter.typeIds.includes(type.id)) return false;
  if (Array.isArray(filter.categoryIds) && !filter.categoryIds.includes(type.categoryId)) return false;
  return true;
}

// Та же беда, что и с комнатой: лист, сужённый галочками или поиском, внешне
// не отличается от полного, и монтажник не узнает, что часть меток скрыта.
// Когда скрыты целые категории — лист называет оставшиеся; когда выключена
// часть типов внутри категории или идёт поиск, перечислять нечестно, и лист
// просто признаётся, что он неполный.
function tableFilterNote(project, filter) {
  if (!filter) return "";
  const query = (filter.query || "").trim();
  const byLists = Array.isArray(filter.typeIds) || Array.isArray(filter.categoryIds);
  if (!query && !byLists) return "";
  if (!query && byLists) {
    const all = typesInOrder(project);
    const names = [];
    let whole = true;
    for (const { category, types } of all) {
      const shown = types.filter((type) => tableTypeAllowed(filter, type));
      if (shown.length === 0) continue;
      if (shown.length < types.length) whole = false;
      names.push(category.name);
    }
    if (whole && names.length === all.length) return "";
    if (whole && names.length > 0) return text("tables.onlyShown", { names: names.join(", ") });
  }
  return strings.tables.partial;
}

export function marksTable(project, filter, groupBy) {
  const kind = TABLE_GROUP_BY.includes(groupBy) ? groupBy : "category";
  const columns = tableMarkColumns();
  if (!project) return { kind: "marks", groupBy: kind, title: "", room: "", note: "", columns, groups: [] };

  const buckets = new Map();
  for (const entry of tableEntries(project, filter)) {
    const group = tableGroupOf(project, entry, kind);
    if (!buckets.has(group.key)) buckets.set(group.key, { id: group.key, title: group.title, color: group.color, rows: [] });
    buckets.get(group.key).rows.push(tableEntryRow(project, entry));
  }

  const groups = tableGroupOrder(project, kind)
    .map((key) => buckets.get(key))
    .filter(Boolean);
  return {
    kind: "marks",
    groupBy: kind,
    title: project.name || strings.tables.marksTitle,
    room: tableRoomTitle(project, filter),
    note: tableFilterNote(project, filter),
    columns,
    groups,
  };
}

export function typesTable(project) {
  const columns = [
    strings.tables.code,
    strings.tables.name,
    strings.tables.category,
    strings.tables.color,
    strings.tables.shape,
  ];
  const rows = [];
  if (project) {
    for (const { category, types } of typesInOrder(project)) {
      for (const type of types) {
        const style = styleOf(project, type.id);
        rows.push({
          id: type.id,
          cells: [type.code, type.name, category.name, style.color, strings.shapes[style.shape] || style.shape],
          color: style.color,
          shape: style.shape,
        });
      }
    }
  }
  return { kind: "types", title: strings.tables.typesTitle, room: "", note: "", columns, rows };
}

// Обе таблицы читаются одинаково: список секций с заголовком и строками.
// У справочника секция одна и без заголовка.
export function tableSections(table) {
  if (!table) return [];
  if (Array.isArray(table.groups)) return table.groups;
  return [{ id: "all", title: "", color: null, rows: table.rows || [] }];
}

export function tableRowCount(table) {
  return tableSections(table).reduce((total, section) => total + section.rows.length, 0);
}

// ——— текстовые форматы ————————————————————————————————————————————————

// CSV для русского Excel: BOM, точка с запятой, переводы строк CRLF.
// Без BOM Excel читает кириллицу как «ÐŸÐš1», без «;» — валит строку в одну
// колонку: обе пляски с кодировкой пользователь и просил убрать.
const TABLE_CSV_BOM = "\uFEFF";
const TABLE_CSV_SEPARATOR = ";";

function tableCsvCell(value) {
  const cell = value == null ? "" : String(value);
  if (!/[;"\n\r]/.test(cell) && cell.trim() === cell) return cell;
  return '"' + cell.split('"').join('""') + '"';
}

export function toCsv(table) {
  const lines = [];
  if (table && table.title) lines.push(tableCsvCell(table.title));
  if (table && table.room) lines.push(tableCsvCell(table.room));
  if (table && table.note) lines.push(tableCsvCell(table.note));
  lines.push(table.columns.map(tableCsvCell).join(TABLE_CSV_SEPARATOR));
  for (const section of tableSections(table)) {
    if (section.title) lines.push(tableCsvCell(section.title));
    for (const row of section.rows) lines.push(row.cells.map(tableCsvCell).join(TABLE_CSV_SEPARATOR));
  }
  return TABLE_CSV_BOM + lines.join("\r\n") + "\r\n";
}

function tableMarkdownCell(value) {
  return (value == null ? "" : String(value)).split("|").join("\\|").split("\n").join(" ");
}

export function toMarkdown(table) {
  const out = [];
  if (table && table.title) out.push("# " + table.title, "");
  if (table && table.room) out.push("**" + tableMarkdownCell(table.room) + "**", "");
  if (table && table.note) out.push("_" + tableMarkdownCell(table.note) + "_", "");
  const header = "| " + table.columns.map(tableMarkdownCell).join(" | ") + " |";
  const divider = "| " + table.columns.map(() => "---").join(" | ") + " |";
  for (const section of tableSections(table)) {
    if (section.title) out.push("## " + tableMarkdownCell(section.title), "");
    out.push(header, divider);
    for (const row of section.rows) out.push("| " + row.cells.map(tableMarkdownCell).join(" | ") + " |");
    out.push("");
  }
  return out.join("\n");
}

// Ячейка буфера — одна строка без табуляций: и перевод строки, и табуляция
// внутри «Расположения» разорвали бы вставку в Таблицы на лишнюю строку
// или на лишнюю колонку.
function tableTsvCell(value) {
  return (value == null ? "" : String(value)).replace(/[\t\r\n]+/g, " ").trim();
}

// Буфер обмена: табуляции вставляются в Google Таблицы колонками.
export function toTsv(table) {
  const lines = [table.columns.join("\t")];
  for (const section of tableSections(table)) {
    if (section.title) lines.push(section.title);
    for (const row of section.rows) {
      lines.push(row.cells.map(tableTsvCell).join("\t"));
    }
  }
  return lines.join("\n");
}
