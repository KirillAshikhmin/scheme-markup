// Правила объекта: справочники, метки, группы, нумерация.
// Чистый модуль: ни DOM, ни хранилища. Все функции возвращают новый объект,
// исходный не меняется.
import { strings, text } from "./strings.js";

export const FORMAT_VERSION = 1;

export const SHAPE_NAMES = ["circle", "circle-cross", "square", "triangle", "star", "diamond", "hexagon"];
export const BLOCK_MODES = ["each", "single"];
export const MARK_KINDS = ["point", "line"];

// Шаг соседней точки блока в пикселях плана (доля считается от размера схемы).
export const BLOCK_STEP_PX = 28;
// Размер плана, по которому считается шаг, пока схема не знает своих пикселей.
const BLOCK_FALLBACK_SIZE_PX = 1000;
// Цвет метки, когда категория недоступна.
const FALLBACK_COLOR = "#8B949E";
export const BLOCK_SIDES = ["left", "right", "up", "down"];

const DEFAULT_VIEW = { markSize: 10, labelSize: 12 };

const TEMPLATE_CATEGORIES = [
  { key: "light", name: strings.categories.light, color: "#1F6FEB", shape: "circle-cross" },
  { key: "switches", name: strings.categories.switches, color: "#2DA44E", shape: "circle" },
  { key: "sockets", name: strings.categories.sockets, color: "#D1242F", shape: "square" },
  { key: "climate", name: strings.categories.climate, color: "#E36209", shape: "triangle" },
  { key: "network", name: strings.categories.network, color: "#8250DF", shape: "star" },
];

const TEMPLATE_TYPES = [
  { category: "light", code: "Т", name: strings.types.spot },
  { category: "light", code: "С", name: strings.types.lamp },
  { category: "light", code: "ПК", name: strings.types.bedLight },
  { category: "light", code: "ТР", name: strings.types.track },
  { category: "light", code: "П", name: strings.types.backlight },
  { category: "light", code: "Л", name: strings.types.strip },
  { category: "light", code: "ПШ", name: strings.types.wardrobeLight },
  { category: "switches", code: "В", name: strings.types.switch },
  { category: "switches", code: "ВВ", name: strings.types.switchDouble },
  { category: "sockets", code: "Р", name: strings.types.socket },
  { category: "climate", code: "Б", name: strings.types.breezer },
  { category: "climate", code: "К", name: strings.types.conditioner },
  { category: "network", code: "W", name: strings.types.wifi },
];

function newId() {
  return globalThis.crypto.randomUUID();
}

function nowIso() {
  return new Date().toISOString();
}

function modelError(key, vars) {
  const error = new Error(text("errors." + key, vars));
  error.code = key;
  return error;
}

function clone(value) {
  return value == null ? value : structuredClone(value);
}

// Новый объект проекта с обновлённым updatedAt; списки подменяются поштучно.
function withProject(project, patch) {
  return { ...project, ...patch, updatedAt: nowIso() };
}

export function defaultTemplate() {
  // Идентификаторы новые на каждый вызов: два объекта не делят ни категорию, ни тип.
  const categoryIds = new Map(TEMPLATE_CATEGORIES.map((category) => [category.key, newId()]));
  const categories = TEMPLATE_CATEGORIES.map((category, index) => ({
    id: categoryIds.get(category.key),
    name: category.name,
    color: category.color,
    shape: category.shape,
    order: index,
  }));
  const markTypes = TEMPLATE_TYPES.map((type, index) => ({
    id: newId(),
    categoryId: categoryIds.get(type.category),
    code: type.code,
    name: type.name,
    shape: null,
    blockMode: "each",
    order: index,
  }));
  return { categories, markTypes };
}

export function createProject(template) {
  const source = template && template.categories && template.markTypes ? clone(template) : defaultTemplate();
  const stamp = nowIso();
  return {
    formatVersion: FORMAT_VERSION,
    id: newId(),
    name: (template && template.name) || strings.project.untitled,
    createdAt: stamp,
    updatedAt: stamp,
    categories: source.categories.map((category, index) => ({ ...category, order: index })),
    markTypes: source.markTypes.map((type, index) => ({
      shape: null,
      blockMode: "each",
      ...type,
      order: index,
    })),
    rooms: source.rooms ? clone(source.rooms) : [],
    schemes: [],
    marks: [],
    groups: [],
    counters: {},
    view: { ...DEFAULT_VIEW, ...(source.view || {}) },
  };
}

// ——— поиск ———————————————————————————————————————————————————————————

export function findScheme(project, schemeId) {
  return project.schemes.find((scheme) => scheme.id === schemeId) || null;
}

export function findType(project, typeId) {
  return project.markTypes.find((type) => type.id === typeId) || null;
}

export function findCategory(project, categoryId) {
  return project.categories.find((category) => category.id === categoryId) || null;
}

export function findMark(project, markId) {
  return project.marks.find((mark) => mark.id === markId) || null;
}

export function findGroup(project, groupId) {
  return project.groups.find((group) => group.id === groupId) || null;
}

export function findRoom(project, roomId) {
  return project.rooms.find((room) => room.id === roomId) || null;
}

export function markByCode(project, code, number) {
  return (
    project.marks.find((mark) => {
      const type = findType(project, mark.typeId);
      return type && type.code === code && mark.number === number;
    }) || null
  );
}

function requireScheme(project, schemeId) {
  const scheme = findScheme(project, schemeId);
  if (!scheme) throw modelError("schemeNotFound");
  return scheme;
}

function requireType(project, typeId) {
  const type = findType(project, typeId);
  if (!type) throw modelError("typeNotFound");
  return type;
}

function requireMark(project, markId) {
  const mark = findMark(project, markId);
  if (!mark) throw modelError("markNotFound");
  return mark;
}

// ——— схемы ———————————————————————————————————————————————————————————

export function addScheme(project, { name, imageId = null, width = 0, height = 0 } = {}) {
  const scheme = {
    id: newId(),
    name: String(name || "").trim() || strings.project.defaultSchemeName,
    imageId,
    width,
    height,
    order: project.schemes.length,
  };
  return { project: withProject(project, { schemes: [...project.schemes, scheme] }), scheme };
}

export function updateScheme(project, schemeId, patch) {
  requireScheme(project, schemeId);
  const allowed = ["name", "imageId", "width", "height", "order"];
  const schemes = project.schemes.map((scheme) =>
    scheme.id === schemeId ? { ...scheme, ...pick(patch, allowed) } : scheme,
  );
  return { project: withProject(project, { schemes }), scheme: schemes.find((s) => s.id === schemeId) };
}

export function deleteScheme(project, schemeId) {
  requireScheme(project, schemeId);
  const marks = project.marks.filter((mark) => mark.schemeId !== schemeId);
  const groups = project.groups.filter((group) => group.schemeId !== schemeId);
  const schemes = project.schemes
    .filter((scheme) => scheme.id !== schemeId)
    .map((scheme, index) => ({ ...scheme, order: index }));
  return { project: withProject(project, { schemes, marks, groups }) };
}

function pick(source, allowed) {
  const result = {};
  if (!source) return result;
  for (const key of allowed) {
    if (Object.prototype.hasOwnProperty.call(source, key)) result[key] = clone(source[key]);
  }
  return result;
}

// ——— метки ———————————————————————————————————————————————————————————

function normalizePoints(points) {
  if (!Array.isArray(points) || points.length === 0) throw modelError("noPoints");
  return points.map((point) => ({ x: Number(point.x), y: Number(point.y) }));
}

function nextNumber(counters, code) {
  return (counters[code] || 0) + 1;
}

function makeMark({ schemeId, typeId, kind, points, number, groupId = null }) {
  return {
    id: newId(),
    schemeId,
    typeId,
    number,
    kind,
    points,
    closed: false,
    groupId,
    labelOffset: null,
    roomId: null,
    location: "",
    original: "",
  };
}

export function addMark(project, { schemeId, typeId, kind = "point", points, blockMode } = {}) {
  requireScheme(project, schemeId);
  const type = requireType(project, typeId);
  if (!MARK_KINDS.includes(kind)) throw modelError("unknownKind");
  const vertices = normalizePoints(points);
  if (kind === "line" && vertices.length < 2) throw modelError("shortLine");

  const mode = blockMode || type.blockMode || "each";
  if (!BLOCK_MODES.includes(mode)) throw modelError("unknownBlockMode");

  const counters = { ...project.counters };
  const created = [];

  if (kind === "point" && vertices.length > 1 && mode === "each") {
    for (const point of vertices) {
      const number = nextNumber(counters, type.code);
      counters[type.code] = number;
      created.push(makeMark({ schemeId, typeId, kind, points: [point], number }));
    }
  } else {
    const number = nextNumber(counters, type.code);
    counters[type.code] = number;
    created.push(makeMark({ schemeId, typeId, kind, points: vertices, number }));
  }

  let groups = project.groups;
  let group = null;
  if (created.length > 1) {
    group = {
      id: newId(),
      schemeId,
      markIds: created.map((mark) => mark.id),
      labelOffset: null,
    };
    for (const mark of created) mark.groupId = group.id;
    groups = [...groups, group];
  }

  const next = withProject(project, { marks: [...project.marks, ...created], groups, counters });
  return { project: next, mark: created[0], marks: created, group };
}

// ——— обозначения —————————————————————————————————————————————————————

export function labelOf(project, id) {
  const mark = findMark(project, id);
  if (mark) return markLabel(project, mark);
  const group = findGroup(project, id);
  if (group) return groupLabel(project, group);
  return "";
}

function markLabel(project, mark) {
  const type = findType(project, mark.typeId);
  return (type ? type.code : "?") + mark.number;
}

// Подряд идущие номера одного типа склеиваются слитно, остальное — через запятую.
function groupLabel(project, group) {
  const members = group.markIds
    .map((markId) => findMark(project, markId))
    .filter(Boolean)
    .map((mark) => ({ mark, type: findType(project, mark.typeId) }))
    .sort((a, b) => {
      const orderA = a.type ? a.type.order : 0;
      const orderB = b.type ? b.type.order : 0;
      return orderA === orderB ? a.mark.number - b.mark.number : orderA - orderB;
    });

  const runs = [];
  let previous = null;
  for (const member of members) {
    const code = member.type ? member.type.code : "?";
    const sameRun =
      previous && previous.code === code && member.mark.number === previous.number + 1;
    if (sameRun) runs[runs.length - 1] += code + member.mark.number;
    else runs.push(code + member.mark.number);
    previous = { code, number: member.mark.number };
  }
  return runs.join(", ");
}

// Соседняя точка блока: сдвиг на шаг плана в долях от размера схемы.
export function addToGroup(project, markId, side, options = {}) {
  const mark = requireMark(project, markId);
  if (mark.kind !== "point") throw modelError("blockOnlyForPoints");
  if (!BLOCK_SIDES.includes(side)) throw modelError("unknownSide");
  const scheme = requireScheme(project, mark.schemeId);
  const type = requireType(project, mark.typeId);
  const stepPx = options.step || BLOCK_STEP_PX;
  const dx = stepPx / (scheme.width > 0 ? scheme.width : BLOCK_FALLBACK_SIZE_PX);
  const dy = stepPx / (scheme.height > 0 ? scheme.height : BLOCK_FALLBACK_SIZE_PX);
  const from = mark.points[mark.points.length - 1];
  const point = {
    x: clampFraction(from.x + (side === "left" ? -dx : side === "right" ? dx : 0)),
    y: clampFraction(from.y + (side === "up" ? -dy : side === "down" ? dy : 0)),
  };

  // Метка, уже собранная как «одна на блок», растёт точками независимо от
  // умолчания типа: её собственная форма важнее справочника.
  const alreadySingle = mark.kind === "point" && mark.points.length > 1;
  const mode = options.blockMode || (alreadySingle ? "single" : type.blockMode || "each");
  if (mode === "single") {
    const grown = updateMark(project, markId, { points: [...mark.points, point] });
    return { project: grown.project, mark: grown.mark, group: findGroup(project, mark.groupId) };
  }

  const counters = { ...project.counters };
  const number = nextNumber(counters, type.code);
  counters[type.code] = number;
  const created = makeMark({
    schemeId: mark.schemeId,
    typeId: mark.typeId,
    kind: "point",
    points: [point],
    number,
    groupId: mark.groupId,
  });

  let groups = project.groups;
  let group = findGroup(project, mark.groupId);
  let marks = [...project.marks, created];
  if (group) {
    groups = groups.map((item) =>
      item.id === group.id ? { ...item, markIds: [...item.markIds, created.id] } : item,
    );
    group = groups.find((item) => item.id === group.id);
  } else {
    group = { id: newId(), schemeId: mark.schemeId, markIds: [markId, created.id], labelOffset: null };
    created.groupId = group.id;
    groups = [...groups, group];
    marks = marks.map((item) => (item.id === markId ? { ...item, groupId: group.id } : item));
  }
  return { project: withProject(project, { marks, groups, counters }), mark: created, group };
}

function clampFraction(value) {
  return Math.min(1, Math.max(0, value));
}

const MARK_PATCH_FIELDS = ["points", "closed", "labelOffset", "roomId", "location", "original"];

export function updateMark(project, markId, patch) {
  requireMark(project, markId);
  const changes = pick(patch, MARK_PATCH_FIELDS);
  if (Object.prototype.hasOwnProperty.call(changes, "points")) {
    changes.points = normalizePoints(changes.points);
  }
  const marks = project.marks.map((mark) => (mark.id === markId ? { ...mark, ...changes } : mark));
  return { project: withProject(project, { marks }), mark: marks.find((mark) => mark.id === markId) };
}

// Счётчик не трогаем: номер остаётся дырой, чтобы распечатка не протухла.
export function deleteMark(project, markId) {
  const mark = requireMark(project, markId);
  const marks = project.marks.filter((item) => item.id !== markId);
  const groups = [];
  const dissolved = [];
  for (const group of project.groups) {
    if (!group.markIds.includes(markId)) {
      groups.push(group);
      continue;
    }
    const markIds = group.markIds.filter((id) => id !== markId);
    if (markIds.length >= 2) groups.push({ ...group, markIds });
    else dissolved.push({ ...group, markIds });
  }
  const freed = new Set(dissolved.flatMap((group) => group.markIds));
  const cleaned = marks.map((item) => (freed.has(item.id) ? { ...item, groupId: null } : item));
  return { project: withProject(project, { marks: cleaned, groups }), deleted: mark };
}

// ——— нумерация ———————————————————————————————————————————————————————

// Порядок обхода: схемы по order, внутри схемы — порядок постановки меток.
function marksInOrder(project, filter) {
  const schemeOrder = new Map(project.schemes.map((scheme, index) => [scheme.id, scheme.order ?? index]));
  return project.marks
    .map((mark, index) => ({ mark, index }))
    .filter((item) => (filter ? filter(item.mark) : true))
    .sort((a, b) => {
      const orderA = schemeOrder.has(a.mark.schemeId) ? schemeOrder.get(a.mark.schemeId) : Number.MAX_SAFE_INTEGER;
      const orderB = schemeOrder.has(b.mark.schemeId) ? schemeOrder.get(b.mark.schemeId) : Number.MAX_SAFE_INTEGER;
      return orderA === orderB ? a.index - b.index : orderA - orderB;
    })
    .map((item) => item.mark);
}

// Возвращает список замен и уже уплотнённый объект; применять или нет —
// решает вызывающий: исходный project не меняется.
export function compactNumbers(project, typeId) {
  const type = requireType(project, typeId);
  const ordered = marksInOrder(project, (mark) => mark.typeId === typeId);
  const changes = [];
  const numbers = new Map();
  ordered.forEach((mark, index) => {
    const number = index + 1;
    numbers.set(mark.id, number);
    if (mark.number !== number) {
      changes.push({
        markId: mark.id,
        code: type.code,
        from: mark.number,
        to: number,
        fromLabel: type.code + mark.number,
        toLabel: type.code + number,
      });
    }
  });
  const marks = project.marks.map((mark) =>
    numbers.has(mark.id) ? { ...mark, number: numbers.get(mark.id) } : mark,
  );
  const counters = { ...project.counters, [type.code]: ordered.length };
  return { changes, project: withProject(project, { marks, counters }) };
}

// Новый номер по новому типу; старый номер остаётся дырой.
export function changeMarkType(project, markId, typeId) {
  const mark = requireMark(project, markId);
  const type = requireType(project, typeId);
  if (mark.typeId === typeId) return { project, mark };
  const counters = { ...project.counters };
  const number = nextNumber(counters, type.code);
  counters[type.code] = number;
  const marks = project.marks.map((item) =>
    item.id === markId ? { ...item, typeId, number } : item,
  );
  return { project: withProject(project, { marks, counters }), mark: marks.find((m) => m.id === markId) };
}

// ——— справочник ———————————————————————————————————————————————————————

function normalizeCode(code, project, exceptTypeId) {
  const value = String(code == null ? "" : code).trim();
  if (!value) throw modelError("codeRequired");
  if (value.length > 2) throw modelError("codeTooLong");
  if (!/^[A-Za-zА-Яа-яЁё]{1,2}$/u.test(value)) throw modelError("codeLetters");
  const taken = project.markTypes.some(
    (type) => type.id !== exceptTypeId && type.code.toUpperCase() === value.toUpperCase(),
  );
  if (taken) throw modelError("codeTaken", { code: value });
  return value;
}

function normalizeName(name) {
  const value = String(name == null ? "" : name).trim();
  if (!value) throw modelError("nameRequired");
  return value;
}

function checkShape(shape, { allowNull }) {
  if (shape == null) {
    if (allowNull) return null;
    throw modelError("unknownShape");
  }
  if (!SHAPE_NAMES.includes(shape)) throw modelError("unknownShape");
  return shape;
}

function checkBlockMode(mode) {
  if (!BLOCK_MODES.includes(mode)) throw modelError("unknownBlockMode");
  return mode;
}

export function addType(project, { code, name, categoryId, shape = null, blockMode = "each" } = {}) {
  const type = {
    id: newId(),
    categoryId,
    code: normalizeCode(code, project),
    name: normalizeName(name),
    shape: checkShape(shape, { allowNull: true }),
    blockMode: checkBlockMode(blockMode),
    order: project.markTypes.length,
  };
  if (!findCategory(project, categoryId)) throw modelError("categoryNotFound");
  return { project: withProject(project, { markTypes: [...project.markTypes, type] }), type };
}

export function updateType(project, typeId, patch = {}) {
  const current = requireType(project, typeId);
  const next = { ...current };
  if (Object.prototype.hasOwnProperty.call(patch, "code")) next.code = normalizeCode(patch.code, project, typeId);
  if (Object.prototype.hasOwnProperty.call(patch, "name")) next.name = normalizeName(patch.name);
  if (Object.prototype.hasOwnProperty.call(patch, "shape")) next.shape = checkShape(patch.shape, { allowNull: true });
  if (Object.prototype.hasOwnProperty.call(patch, "blockMode")) next.blockMode = checkBlockMode(patch.blockMode);
  if (Object.prototype.hasOwnProperty.call(patch, "categoryId")) {
    if (!findCategory(project, patch.categoryId)) throw modelError("categoryNotFound");
    next.categoryId = patch.categoryId;
  }
  if (Object.prototype.hasOwnProperty.call(patch, "order")) next.order = patch.order;

  const markTypes = project.markTypes.map((type) => (type.id === typeId ? next : type));
  let counters = project.counters;
  if (next.code !== current.code) {
    counters = { ...counters };
    const carried = counters[current.code] || 0;
    counters[next.code] = Math.max(counters[next.code] || 0, carried);
    delete counters[current.code];
  }
  return { project: withProject(project, { markTypes, counters }), type: next };
}

export function deleteType(project, typeId) {
  const type = requireType(project, typeId);
  const used = project.marks.filter((mark) => mark.typeId === typeId).length;
  if (used > 0) throw modelError("typeHasMarks", { code: type.code, count: used });
  const markTypes = project.markTypes
    .filter((item) => item.id !== typeId)
    .map((item, index) => ({ ...item, order: index }));
  return { project: withProject(project, { markTypes }), deleted: type };
}

export function addCategory(project, { name, color, shape } = {}) {
  const category = {
    id: newId(),
    name: normalizeName(name),
    color: String(color || FALLBACK_COLOR),
    shape: checkShape(shape, { allowNull: false }),
    order: project.categories.length,
  };
  return { project: withProject(project, { categories: [...project.categories, category] }), category };
}

export function updateCategory(project, categoryId, patch = {}) {
  const current = findCategory(project, categoryId);
  if (!current) throw modelError("categoryNotFound");
  const next = { ...current };
  if (Object.prototype.hasOwnProperty.call(patch, "name")) next.name = normalizeName(patch.name);
  if (Object.prototype.hasOwnProperty.call(patch, "color")) next.color = String(patch.color);
  if (Object.prototype.hasOwnProperty.call(patch, "shape")) next.shape = checkShape(patch.shape, { allowNull: false });
  if (Object.prototype.hasOwnProperty.call(patch, "order")) next.order = patch.order;
  const categories = project.categories.map((item) => (item.id === categoryId ? next : item));
  return { project: withProject(project, { categories }), category: next };
}

export function deleteCategory(project, categoryId) {
  const current = findCategory(project, categoryId);
  if (!current) throw modelError("categoryNotFound");
  if (project.markTypes.some((type) => type.categoryId === categoryId)) throw modelError("categoryHasTypes");
  const categories = project.categories
    .filter((item) => item.id !== categoryId)
    .map((item, index) => ({ ...item, order: index }));
  return { project: withProject(project, { categories }), deleted: current };
}

export function addRoom(project, room) {
  const name = normalizeName(typeof room === "string" ? room : room && room.name);
  const created = { id: newId(), name };
  return { project: withProject(project, { rooms: [...project.rooms, created] }), room: created };
}

export function updateRoom(project, roomId, patch = {}) {
  if (!findRoom(project, roomId)) throw modelError("roomNotFound");
  const rooms = project.rooms.map((room) =>
    room.id === roomId && Object.prototype.hasOwnProperty.call(patch, "name")
      ? { ...room, name: normalizeName(patch.name) }
      : room,
  );
  return { project: withProject(project, { rooms }), room: rooms.find((room) => room.id === roomId) };
}

export function deleteRoom(project, roomId) {
  const room = findRoom(project, roomId);
  if (!room) throw modelError("roomNotFound");
  const rooms = project.rooms.filter((item) => item.id !== roomId);
  const marks = project.marks.map((mark) => (mark.roomId === roomId ? { ...mark, roomId: null } : mark));
  return { project: withProject(project, { rooms, marks }), deleted: room };
}

export function updateProject(project, patch = {}) {
  const next = {};
  if (Object.prototype.hasOwnProperty.call(patch, "name")) next.name = normalizeName(patch.name);
  if (Object.prototype.hasOwnProperty.call(patch, "view")) next.view = { ...project.view, ...patch.view };
  return { project: withProject(project, next) };
}

// Цвет — всегда у категории; форма у типа, если задана, иначе у категории.
export function styleOf(project, typeId) {
  const type = findType(project, typeId);
  const category = type ? findCategory(project, type.categoryId) : null;
  return {
    color: category ? category.color : FALLBACK_COLOR,
    shape: (type && type.shape) || (category && category.shape) || "circle",
  };
}

// ——— проверка объекта —————————————————————————————————————————————————

function problem(code, vars, ref) {
  return { code, message: text("problems." + code, vars), ref: ref || null };
}

export function validate(project) {
  const problems = [];

  const seenCodes = new Map();
  for (const type of project.markTypes) {
    const key = type.code.toUpperCase();
    if (seenCodes.has(key)) problems.push(problem("duplicateCode", { code: type.code }, type.id));
    else seenCodes.set(key, type.id);
    if (!findCategory(project, type.categoryId)) problems.push(problem("typeWithoutCategory", null, type.id));
  }

  const used = new Map();
  const behindTypes = new Map();
  for (const mark of project.marks) {
    const type = findType(project, mark.typeId);
    if (!type) problems.push(problem("markWithoutType", null, mark.id));
    if (!findScheme(project, mark.schemeId)) problems.push(problem("markWithoutScheme", null, mark.id));
    if (mark.roomId && !findRoom(project, mark.roomId)) problems.push(problem("markWithoutRoom", null, mark.id));
    if (!Array.isArray(mark.points) || mark.points.length === 0) problems.push(problem("emptyPoints", null, mark.id));
    else if (mark.kind === "line" && mark.points.length < 2) problems.push(problem("shortLine", null, mark.id));

    if (type) {
      const label = type.code + mark.number;
      if (used.has(label)) problems.push(problem("duplicateNumber", { label }, mark.id));
      else used.set(label, mark.id);
      const counter = project.counters[type.code] || 0;
      if (mark.number > counter) behindTypes.set(type.id, type.code);
    }
  }

  // Отставший счётчик — свойство типа, а не каждой его метки.
  for (const [id, code] of behindTypes) problems.push(problem("counterBehind", { code }, id));

  for (const group of project.groups) {
    const members = group.markIds.map((markId) => findMark(project, markId)).filter(Boolean);
    if (members.length < 2) problems.push(problem("smallGroup", null, group.id));
    if (new Set(members.map((mark) => mark.schemeId)).size > 1) {
      problems.push(problem("groupAcrossSchemes", null, group.id));
    }
  }

  return problems;
}
