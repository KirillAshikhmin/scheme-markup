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
  equipmentInOrder,
  findCategory,
  findEquipment,
  findEquipmentType,
  findMark,
  findRoom,
  findType,
  labelOf,
  markControlIds,
  markControlledBy,
  markControls,
  placementLinkIds,
  placementsInOrder,
  roomsInOrder,
  schemesInOrder,
  styleOf,
  typeKindOf,
  typesInOrder,
} from "./model.js";
import { colorNameHex } from "./colorName.js";
import { visibleMarks } from "./render.js";
import { strings, text } from "./strings.js";

export const TABLE_GROUP_BY = ["category", "type", "room"];

// Колонки списка меток — дословно из спецификации.
function tableMarkColumns() {
  return [
    strings.tables.label,
    strings.tables.points,
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

// Строка — на метку, а не на блок. Блок «Р1 Р2 Р3» заказчик читает как три
// позиции и требует три строки: в таблице метки блока не сводятся.
// Сводятся только метки с одинаковым **обозначением** — тот же тип и тот же
// номер: несколько светильников одной группы, которым проставлен Т1, остаются
// одной позицией «Т1», где бы они ни стояли. Подпись блока на плане это не
// трогает — там она по-прежнему одна на блок (model.blockLabel).
function tableEntries(project, filter) {
  const marks = tableVisibleMarks(project, filter);
  const order = tableTypeOrder(project);
  const byLabel = new Map();
  const entries = [];

  for (const mark of marks) {
    // Ключ — обозначение: тип (код у типов не повторяется) и номер.
    const key = mark.typeId + "\u0000" + mark.number;
    let entry = byLabel.get(key);
    if (!entry) {
      entry = { id: mark.id, marks: [] };
      byLabel.set(key, entry);
      entries.push(entry);
    }
    entry.marks.push(mark);
  }

  for (const entry of entries) {
    const [head] = entry.marks;
    entry.head = head;
    entry.order = [order.has(head.typeId) ? order.get(head.typeId) : 999, head.number];
  }

  entries.sort((a, b) => (a.order[0] === b.order[0] ? a.order[1] - b.order[1] : a.order[0] - b.order[0]));
  return entries;
}

// Сколько физических точек стоит за меткой. «Одна метка на блок» — это одна
// запись с несколькими точками: три розетки в одной рамке под общим
// обозначением, и без счёта строка неотличима от одиночной розетки.
// Линия — всегда одна: у ленты из четырёх вершин не четыре ленты.
function tableMarkCount(mark) {
  if (!mark) return 0;
  if (mark.kind === "line") return 1;
  return Array.isArray(mark.points) && mark.points.length > 0 ? mark.points.length : 1;
}

function tableEntryCount(entry) {
  return entry.marks.reduce((sum, mark) => sum + tableMarkCount(mark), 0);
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

// Обозначение строки — обозначение метки. У сведённых меток оно одно на всех
// (на том и сведены), поэтому берётся у ведущей.
function tableEntryLabel(project, entry) {
  return labelOf(project, entry.head.id);
}

// Тип у строки один: обозначение назвало его однозначно. Склейка осталась
// там, где сведённые метки правда расходятся, — помещение, расположение
// и «в оригинале» у одного обозначения бывают разные.
function tableEntryRow(project, entry) {
  const type = findType(project, entry.head.typeId);
  const category = type ? findCategory(project, type.categoryId) : null;
  const count = tableEntryCount(entry);
  const cells = [
    tableEntryLabel(project, entry),
    String(count),
    type ? type.name : "",
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
  return {
    id: entry.id,
    cells,
    count,
    // Категория строкой: в CSV она становится колонкой, и заголовки-строки
    // между данными исчезают — фильтр Excel их больше не подхватывает.
    group: category ? category.name : "",
    color: styleOf(project, entry.head.typeId).color,
  };
}

// Итоги «сколько чего»: точки по типам и категориям. Считать по последнему
// номеру нельзя — он врёт после удалений и при ручной правке номеров.
// Итоги живут подвалом таблицы меток, а не отдельным листом: вопрос «сколько
// розеток закупать» задают тому же листу, который уже сужен помещением и
// фильтром, и второй лист пришлось бы сужать теми же руками ещё раз.
function tableTotals(project, entries) {
  const counts = new Map();
  for (const entry of entries) {
    counts.set(entry.head.typeId, (counts.get(entry.head.typeId) || 0) + tableEntryCount(entry));
  }
  const rows = [];
  let total = 0;
  for (const { category, types } of typesInOrder(project)) {
    const used = types.filter((type) => counts.get(type.id));
    if (used.length === 0) continue;
    const sum = used.reduce((acc, type) => acc + counts.get(type.id), 0);
    rows.push({
      id: category.id,
      level: 1,
      title: category.name,
      category: category.name,
      count: sum,
      color: category.color || null,
    });
    for (const type of used) {
      rows.push({
        id: type.id,
        level: 2,
        title: type.code + " — " + type.name,
        category: category.name,
        count: counts.get(type.id),
        color: styleOf(project, type.id).color,
      });
    }
    total += sum;
  }
  return { rows, total };
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
    // Цвет помещения — тот же, которым обведён его контур на плане: лист
    // и схема должны узнаваться одним цветом.
    return room
      ? { key: room.id, title: room.name, color: room.color || null }
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

// Один уровень разбивки: категории, типы или помещения — как было и как
// остаётся, когда галка «по помещениям» снята.
function tableFlatGroups(project, entries, kind) {
  const buckets = new Map();
  for (const entry of entries) {
    const group = tableGroupOf(project, entry, kind);
    if (!buckets.has(group.key)) {
      buckets.set(group.key, { id: group.key, title: group.title, color: group.color, rows: [], level: 1 });
    }
    buckets.get(group.key).rows.push(tableEntryRow(project, entry));
  }
  return tableGroupOrder(project, kind)
    .map((key) => buckets.get(key))
    .filter(Boolean);
}

// Два уровня: помещение, внутри — прежняя разбивка. Список остаётся плоским,
// уровень написан в `level` — так его одинаково читают и печать, и PNG, и
// текстовые форматы, и ни один из них не учит обход вложенности.
// Заголовок помещения строк не несёт: строки живут во внутренних группах.
// Метки без помещения — последней группой «Без помещения»: потерять их на
// листе хуже, чем показать отдельно, и на плане они тоже никуда не делись.
function tableRoomGroups(project, entries, kind) {
  const byRoomKey = new Map();
  for (const entry of entries) {
    const room = entry.head.roomId ? findRoom(project, entry.head.roomId) : null;
    const key = room ? room.id : "none";
    if (!byRoomKey.has(key)) byRoomKey.set(key, []);
    byRoomKey.get(key).push(entry);
  }

  const groups = [];
  for (const key of [...roomsInOrder(project).map((room) => room.id), "none"]) {
    const list = byRoomKey.get(key);
    if (!list || list.length === 0) continue;
    const room = key === "none" ? null : findRoom(project, key);
    groups.push({
      id: key,
      title: room ? room.name : strings.tables.noRoom,
      color: room ? room.color || null : null,
      rows: [],
      level: 1,
    });
    for (const inner of tableFlatGroups(project, list, kind)) {
      groups.push({ ...inner, id: key + ":" + inner.id, level: 2 });
    }
  }
  return groups;
}

/**
 * Таблица меток. `groupBy` — разбивка (`category` | `type` | `room`);
 * `options.byRoom` поднимает над ней второй уровень — помещения, и тогда
 * `groupBy` задаёт разбивку **внутри** помещения. С `groupBy: "room"` галка
 * не складывается (помещения уже и есть разбивка) и молча гасится.
 */
export function marksTable(project, filter, groupBy, options = {}) {
  const kind = TABLE_GROUP_BY.includes(groupBy) ? groupBy : "category";
  const byRoom = Boolean(options.byRoom) && kind !== "room";
  const columns = tableMarkColumns();
  if (!project) {
    return {
      kind: "marks",
      groupBy: kind,
      byRoom,
      groupColumn: strings.tables.category,
      totals: [],
      totalsColumns: [strings.tables.category, strings.tables.type, strings.tables.points],
      totalLabel: strings.tables.totalAll,
      totalCount: 0,
      title: "",
      room: "",
      note: "",
      columns,
      groups: [],
    };
  }

  const entries = tableEntries(project, filter);
  const groups = byRoom ? tableRoomGroups(project, entries, kind) : tableFlatGroups(project, entries, kind);
  const totals = tableTotals(project, entries);
  return {
    kind: "marks",
    groupBy: kind,
    byRoom,
    // Колонка, которой в CSV заменяются заголовки-строки: помещение и тип
    // уже стоят колонками, категория — нет.
    groupColumn: strings.tables.category,
    totals: totals.rows,
    totalsColumns: [strings.tables.category, strings.tables.type, strings.tables.points],
    totalLabel: strings.tables.totalAll,
    totalCount: totals.total,
    title: project.name || strings.tables.marksTitle,
    room: tableRoomTitle(project, filter),
    note: tableFilterNote(project, filter),
    columns,
    groups,
  };
}

// ——— связи ————————————————————————————————————————————————————————————

// Ссылка на метку: обозначение, а для метки из другого помещения — ещё и
// помещение. На объекте в три этажа «С1» само по себе не говорит ничего.
function tableLinkLabel(project, mark, roomId) {
  const label = labelOf(project, mark.id);
  if (!mark.roomId || mark.roomId === roomId) return label;
  const room = findRoom(project, mark.roomId);
  return room ? label + " (" + room.name + ")" : label;
}

function tableLinkRow(project, mark, related, broken, side) {
  const type = findType(project, mark.typeId);
  const room = mark.roomId ? findRoom(project, mark.roomId) : null;
  const linked = related.map((item) => tableLinkLabel(project, item, mark.roomId));
  // Ссылка в никуда не должна выглядеть обычной строкой: её видно словами,
  // а не только в проверке объекта.
  if (broken) linked.push(strings.tables.brokenLink);
  return {
    id: mark.id,
    cells: [
      labelOf(project, mark.id),
      type ? type.name : "",
      room ? room.name : "",
      mark.location || "",
      linked.join(", "),
    ],
    color: styleOf(project, mark.typeId).color,
    // Сторона листа колонкой: в CSV заголовки-строки не выживают.
    group: side || "",
    problem: Boolean(broken),
  };
}

// Сторона листа: «Управляет» или «Управляется от». С галкой «по помещениям»
// внутри стороны появляются помещения — вторым уровнем, как в таблице меток.
function tableLinkSide(project, id, title, items, byRoom) {
  if (items.length === 0) return [];
  if (!byRoom) return [{ id, title, color: null, rows: items.map((item) => item.row), level: 1 }];

  const groups = [{ id, title, color: null, rows: [], level: 1 }];
  const byRoomKey = new Map();
  for (const item of items) {
    const room = item.mark.roomId ? findRoom(project, item.mark.roomId) : null;
    const key = room ? room.id : "none";
    if (!byRoomKey.has(key)) byRoomKey.set(key, []);
    byRoomKey.get(key).push(item);
  }
  for (const key of [...roomsInOrder(project).map((room) => room.id), "none"]) {
    const list = byRoomKey.get(key);
    if (!list || list.length === 0) continue;
    const room = key === "none" ? null : findRoom(project, key);
    groups.push({
      id: id + ":" + key,
      title: room ? room.name : strings.tables.noRoom,
      color: room ? room.color || null : null,
      rows: list.map((item) => item.row),
      level: 2,
    });
  }
  return groups;
}

/**
 * Таблица связей: чем метка управляет и от чего управляется.
 *
 * Лист читают у щита или у выключателя, поэтому сторон две: «В1 → Т1, Т2» и
 * обратная «Т1 → В1». Строки — только у меток, которые в связях участвуют:
 * светильники без связей утопили бы лист, а сколько их, сказано числом
 * `unlinked`. Разбивка внутри стороны (категории или типы) здесь не нужна —
 * верхний уровень уже занят направлением, и по такому листу ищут обозначение,
 * а не категорию; помещения вторым уровнем, наоборот, помогают.
 *
 * Связанные метки перечисляются целиком, даже если фильтр их скрыл: строка
 * «В1 →» без продолжения хуже, чем строка с меткой, которой сейчас не видно.
 */
export function linksTable(project, filter, options = {}) {
  const byRoom = Boolean(options.byRoom);
  const columns = [
    strings.tables.label,
    strings.tables.type,
    strings.tables.room,
    strings.tables.location,
    strings.tables.linked,
  ];
  if (!project) {
    return {
      kind: "links",
      byRoom,
      groupColumn: strings.tables.linkSide,
      title: "",
      room: "",
      note: "",
      unlinked: 0,
      columns,
      groups: [],
    };
  }

  const order = tableTypeOrder(project);
  const marks = [...tableVisibleMarks(project, filter)].sort((a, b) => {
    const orderA = order.has(a.typeId) ? order.get(a.typeId) : 999;
    const orderB = order.has(b.typeId) ? order.get(b.typeId) : 999;
    return orderA === orderB ? a.number - b.number : orderA - orderB;
  });

  const forward = [];
  const back = [];
  let unlinked = 0;
  for (const mark of marks) {
    const wanted = markControlIds(mark);
    const controls = wanted.length > 0 ? markControls(project, mark.id) : [];
    const controlledBy = markControlledBy(project, mark.id);
    if (wanted.length > 0) {
      forward.push({
        mark,
        row: tableLinkRow(project, mark, controls, wanted.length > controls.length, strings.tables.controls),
      });
    }
    if (controlledBy.length > 0) {
      back.push({ mark, row: tableLinkRow(project, mark, controlledBy, false, strings.tables.controlledBy) });
    }
    if (wanted.length === 0 && controlledBy.length === 0) unlinked += 1;
  }

  return {
    kind: "links",
    byRoom,
    groupColumn: strings.tables.linkSide,
    title: project.name || strings.tables.linksTitle,
    room: tableRoomTitle(project, filter),
    note: tableFilterNote(project, filter),
    unlinked,
    columns,
    groups: [
      ...tableLinkSide(project, "controls", strings.tables.controls, forward, byRoom),
      ...tableLinkSide(project, "controlledBy", strings.tables.controlledBy, back, byRoom),
    ],
  };
}

// ——— оборудование —————————————————————————————————————————————————————

// Название модели для закупки: с артикулом, если он заведён, — по нему заказ
// и оформляют.
function tableEquipmentName(item) {
  if (!item) return "";
  return item.code ? item.name + " (" + item.code + ")" : item.name;
}

// Сужен ли лист чем-нибудь, кроме схемы объекта. Размещение с потерянной
// меткой отнести к помещению или категории нечем, поэтому на сужённом листе
// его нет, а на полном — есть: чинить его всё равно придётся.
function tableFilterNarrows(filter) {
  if (!filter) return false;
  return Boolean(
    filter.roomId ||
      filter.schemeId ||
      (filter.query || "").trim() ||
      Array.isArray(filter.typeIds) ||
      Array.isArray(filter.categoryIds),
  );
}

/**
 * Таблица оборудования: строка на размещение — что и куда ставить, с чем
 * связывать, — а подвал «Итого» отвечает на второй вопрос заказчика, сколько
 * каких моделей закупать.
 *
 * Лист плоский, как лист меток: модель стоит **колонкой** в каждой строке, а не
 * заголовком группы. Так просил заказчик — «не объединяй по устройству, а так
 * же как в таблице Метки, отдельным столбцом». Объединение по модели прятало
 * то, ради чего лист и печатают: подряд шли три строки одного реле, и чтобы
 * узнать, что стоит в этой точке, приходилось искать заголовок выше. Закупку
 * по моделям при этом никто не отменял — она в подвале, и считается по тем же
 * размещениям, а не по группам.
 *
 * Одна таблица, а не две: закупка — это те же размещения, посчитанные по
 * моделям, и отдельным листом она разошлась бы с монтажным, как только лист
 * сузили помещением. Подвал уже умеет доезжать в CSV, Markdown, PNG и печать,
 * и сужение фильтром доезжает вместе с ним.
 */
export function equipmentTable(project, filter, options = {}) {
  const byRoom = Boolean(options.byRoom);
  // Модель — вторым столбцом, как «Тип» в листе меток: сперва обозначение,
  // которым метку зовут на плане, сразу за ним — что именно там стоит.
  // Тип стоит сразу за моделью: он про неё и отвечает на вопрос «что это
  // вообще за железка» раньше, чем «где она стоит». В подвале «Итого» типа
  // нет намеренно — там закупка, и она разложена по производителям: заказ
  // оформляют у поставщика, а не у «реле на два канала».
  const columns = [
    strings.tables.label,
    strings.tables.model,
    strings.tables.equipmentType,
    strings.tables.room,
    strings.tables.location,
    strings.tables.linked,
  ];
  const empty = {
    kind: "equipment",
    byRoom,
    // Колонки группы у этого листа нет: и модель, и помещение стоят столбцами,
    // а `groupColumn` добавил бы в CSV шестую, пустую.
    groupColumn: "",
    totals: [],
    totalsColumns: [strings.tables.vendor, strings.tables.model, strings.tables.pieces],
    totalLabel: strings.tables.totalItems,
    totalCount: 0,
    title: "",
    room: "",
    note: "",
    columns,
    groups: [],
  };
  if (!project) return empty;

  const order = tableTypeOrder(project);
  const visible = new Set(tableVisibleMarks(project, filter).map((mark) => mark.id));
  const keepLost = !tableFilterNarrows(filter);
  const counts = new Map();
  const items = [];

  for (const placement of placementsInOrder(project)) {
    const mark = findMark(project, placement.markId);
    if (mark ? !visible.has(mark.id) : !keepLost) continue;
    const item = findEquipment(project, placement.equipmentId);
    const room = mark && mark.roomId ? findRoom(project, mark.roomId) : null;
    const links = [];
    let broken = !mark || !item;
    for (const id of placementLinkIds(placement)) {
      const linked = findMark(project, id);
      if (linked) links.push(tableLinkLabel(project, linked, mark ? mark.roomId : null));
      else broken = true;
    }
    if (placementLinkIds(placement).length > links.length) links.push(strings.tables.brokenLink);
    const kind = item ? findEquipmentType(project, item.typeId) : null;
    const row = {
      id: placement.id,
      cells: [
        mark ? labelOf(project, mark.id) : strings.tables.brokenLink,
        // Модель потеряна — так и написано в строке: пустая ячейка читалась бы
        // как «оборудования тут нет», а оно есть, просто его запись пропала.
        item ? item.name : strings.tables.equipmentLost,
        // Пустой тип — пустая ячейка, а не пометка: у моделей, заведённых до
        // появления справочника, типа нет, и это не поломка.
        kind ? kind.name : "",
        room ? room.name : "",
        mark ? mark.location || "" : "",
        links.join(", "),
      ],
      color: mark ? styleOf(project, mark.typeId).color : null,
      problem: broken,
    };
    items.push({
      row,
      mark,
      item,
      roomId: room ? room.id : "none",
      sort: mark ? [order.has(mark.typeId) ? order.get(mark.typeId) : 999, mark.number] : [1e6, 0],
    });
    if (item) counts.set(item.id, (counts.get(item.id) || 0) + 1);
  }

  items.sort((a, b) => (a.sort[0] === b.sort[0] ? a.sort[1] - b.sort[1] : a.sort[0] - b.sort[0]));

  // Разбивка осталась одна — по помещениям, и работает она как в листе меток:
  // секция на помещение, метки без помещения последней секцией. Выключена —
  // один список без заголовков, в порядке типов справочника.
  const groups = [];
  if (byRoom) {
    const byRoomKey = new Map();
    for (const entry of items) {
      if (!byRoomKey.has(entry.roomId)) byRoomKey.set(entry.roomId, []);
      byRoomKey.get(entry.roomId).push(entry);
    }
    for (const roomKey of [...roomsInOrder(project).map((room) => room.id), "none"]) {
      const list = byRoomKey.get(roomKey);
      if (!list || list.length === 0) continue;
      const room = roomKey === "none" ? null : findRoom(project, roomKey);
      groups.push({
        id: roomKey,
        title: room ? room.name : strings.tables.noRoom,
        color: room ? room.color || null : null,
        rows: list.map((entry) => entry.row),
        level: 1,
      });
    }
  } else {
    groups.push({ id: "all", title: "", color: null, rows: items.map((entry) => entry.row), level: 1 });
  }

  // Закупка: производитель — заголовком, модели под ним. Размещения с
  // потерянной моделью в закупку не попадают: заказывать по ним нечего,
  // их видно строкой-проблемой.
  const byVendor = new Map();
  for (const item of equipmentInOrder(project)) {
    const count = counts.get(item.id) || 0;
    if (count === 0) continue;
    const vendor = (item.vendor || "").trim() || strings.tables.noVendor;
    if (!byVendor.has(vendor)) byVendor.set(vendor, []);
    byVendor.get(vendor).push({ item, count });
  }
  const totals = [];
  let totalCount = 0;
  for (const [vendor, list] of byVendor) {
    const sum = list.reduce((acc, entry) => acc + entry.count, 0);
    totals.push({ id: "vendor:" + vendor, level: 1, title: vendor, category: vendor, count: sum, color: null });
    for (const entry of list) {
      totals.push({
        id: entry.item.id,
        level: 2,
        title: tableEquipmentName(entry.item),
        category: vendor,
        count: entry.count,
        color: null,
      });
    }
    totalCount += sum;
  }

  return {
    ...empty,
    title: project.name || strings.tables.equipmentTitle,
    room: tableRoomTitle(project, filter),
    note: tableFilterNote(project, filter),
    totals,
    totalCount,
    groups,
  };
}

// Знак типа одной строкой — то, чем тип узнают на плане.
//
// Что именно знак, решает вид типа, и спрашивается он у `typeKindOf`: у
// объекта прежнего формата поля `kind` нет вовсе. У точечного знак — фигура,
// у линейного — начертание, и к нему приписано слово «линия»: иначе
// «Двойная» в колонке «Форма» читалась бы как ещё одна фигура.
//
// Унаследованный знак назван унаследованным. Без этого правка формы категории
// молча меняла бы восемь строк листа из двадцати восьми, а по распечатке было
// бы не понять, какие именно.
//
// Сам знак идёт первым, пометка — следом в скобках: «Квадрат (как у
// категории)». Слова заказчика: «пусть название будет первым». Колонку
// читают сверху вниз, ища знак, и приставка отодвигала бы его вправо на
// восьми строках из двадцати восьми — столбец переставал быть столбцом.
// В сетке выбора справочника порядок обратный, и это не разнобой: там клетка
// и есть наследование, а название объясняет, чем оно обернулось.
function tableTypeSign(project, type) {
  const style = styleOf(project, type.id);
  const line = typeKindOf(project, type.id) === "line";
  const own = line ? type.lineStyle : type.shape;
  const name = line
    ? text("tables.lineSign", { name: strings.lineStyles[style.lineStyle] || style.lineStyle })
    : strings.shapes[style.shape] || style.shape;
  return own ? name : text("tables.inheritSign", { name });
}

// Справочник разбит по категориям, как остальные листы: категория —
// заголовок секции, а не колонка в каждой строке. Колонка её дублировала —
// двадцать восемь строк подряд повторяли «Свет», «Свет», «Свет».
//
// В заголовке рядом с названием стоит цвет категории словами и кодом —
// «Розетки · красный (#D1242F)». Так просил заказчик: один hex читателю
// листа ничего не говорил, а по слову цвет узнаётся и на чёрно-белой
// распечатке, где цветной полосы попросту нет. Имя считает `colorName.js` —
// оно находится и для цвета, который пользователь завёл сам.
//
// Отдельной колонки «Цвет» по-прежнему нет: у строки цвет остался полосой
// слева (`row.color`), а у секции — полосой и чертой заголовка.
//
// Колонка знака одна, и это не экономия места. Слова заказчика: «зачем в
// таблице справочника типов указывать у типа и форму и тип линии, если оно
// что-то одно?» У типа либо вид «точка» — и работает фигура, либо «линия» —
// и работает начертание; при двух колонках одна в каждой строке пустовала.
export function typesTable(project) {
  const columns = [strings.tables.code, strings.tables.name, strings.tables.shape];
  const groups = [];
  if (project) {
    for (const { category, types } of typesInOrder(project)) {
      const color = category.color || null;
      const named = colorNameHex(color);
      groups.push({
        id: category.id,
        title: named ? text("tables.groupColor", { title: category.name, color: named }) : category.name,
        color,
        level: 1,
        rows: types.map((type) => {
          const style = styleOf(project, type.id);
          return {
            id: type.id,
            cells: [type.code, type.name, tableTypeSign(project, type)],
            // Категория строкой — для CSV: там заголовков-секций нет, и
            // категория возвращается колонкой. Название без цвета: в таблице
            // Excel по ней фильтруют и сортируют, а «Свет · синий (#1F6FEB)»
            // фильтровать неудобно.
            group: category.name,
            color: style.color,
            shape: style.shape,
          };
        }),
      });
    }
  }
  return {
    kind: "types",
    title: strings.tables.typesTitle,
    byRoom: false,
    room: "",
    note: "",
    groupColumn: strings.tables.category,
    columns,
    groups,
  };
}

// Обе таблицы читаются одинаково: список секций с заголовком и строками.
// У справочника секция одна и без заголовка.
export function tableSections(table) {
  if (!table) return [];
  if (Array.isArray(table.groups)) return table.groups;
  return [{ id: "all", title: "", color: null, rows: table.rows || [], level: 1 }];
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

// CSV — не документ, а таблица: человек её сортирует, фильтрует и суммирует.
// Поэтому заголовков групп между строками здесь нет (фильтр Excel утаскивал
// «Свет» в данные) — вместо них колонка: категория у меток, сторона у связей.
// Название объекта, помещение и пометка о сужении остаются сверху, но
// отделены пустой строкой: так область данных начинается ровно с шапки.
// Итоги идут после данных, тоже за пустой строкой, — фильтр их не захватывает.
export function toCsv(table) {
  const lines = [];
  if (table && table.title) lines.push(tableCsvCell(table.title));
  if (table && table.room) lines.push(tableCsvCell(table.room));
  if (table && table.note) lines.push(tableCsvCell(table.note));
  if (lines.length > 0) lines.push("");

  const groupColumn = (table && table.groupColumn) || "";
  const header = groupColumn ? [groupColumn, ...table.columns] : [...table.columns];
  lines.push(header.map(tableCsvCell).join(TABLE_CSV_SEPARATOR));
  for (const section of tableSections(table)) {
    for (const row of section.rows) {
      const cells = groupColumn ? [row.group || section.title || "", ...row.cells] : row.cells;
      lines.push(cells.map(tableCsvCell).join(TABLE_CSV_SEPARATOR));
    }
  }

  if (table && Array.isArray(table.totals) && table.totals.length > 0) {
    lines.push("", tableCsvCell(strings.tables.totals));
    const totalsColumns = table.totalsColumns || [
      strings.tables.category,
      strings.tables.type,
      strings.tables.points,
    ];
    lines.push(totalsColumns.map(tableCsvCell).join(TABLE_CSV_SEPARATOR));
    // В Excel строками идут типы: по ним считают закупку, а подытог категории
    // там собирают сами. Двухуровневый список — для бумаги.
    for (const row of table.totals) {
      if (row.level !== 2) continue;
      lines.push([row.category, row.title, row.count].map(tableCsvCell).join(TABLE_CSV_SEPARATOR));
    }
    lines.push(
      [table.totalLabel || strings.tables.totalAll, "", table.totalCount]
        .map(tableCsvCell)
        .join(TABLE_CSV_SEPARATOR),
    );
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
    if (section.title) out.push("#".repeat(1 + (section.level || 1)) + " " + tableMarkdownCell(section.title), "");
    // Заголовок помещения строк не несёт — пустая шапка таблицы под ним
    // выглядела бы как потерянные строки.
    if (section.rows.length === 0) continue;
    out.push(header, divider);
    for (const row of section.rows) out.push("| " + row.cells.map(tableMarkdownCell).join(" | ") + " |");
    out.push("");
  }
  if (table && Array.isArray(table.totals) && table.totals.length > 0) {
    out.push("## " + strings.tables.totals, "");
    // Заголовок счётной колонки — у таблицы: у меток это точки, у оборудования штуки.
    const countTitle = (table.totalsColumns && table.totalsColumns[2]) || strings.tables.points;
    out.push("| " + strings.tables.name + " | " + countTitle + " |", "| --- | --- |");
    for (const row of table.totals) {
      const title = row.level === 2 ? "— " + row.title : row.title;
      out.push("| " + tableMarkdownCell(title) + " | " + row.count + " |");
    }
    out.push("| " + (table.totalLabel || strings.tables.totalAll) + " | " + table.totalCount + " |", "");
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
