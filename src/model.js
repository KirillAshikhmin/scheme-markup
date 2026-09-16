// Правила объекта: справочники, метки, группы, нумерация.
// Чистый модуль: ни DOM, ни хранилища. Все функции возвращают новый объект,
// исходный не меняется.
import { strings, text } from "./strings.js";

// Версия формата объекта. Поднимается, когда в project.json появляются поля,
// без которых работа теряется. История:
//   1 — схемы, метки, блоки, группы, помещения списком;
//   2 — контуры помещений (`project.outlines`), признак ручной правки
//       помещения у метки (`mark.roomManual`) и цвет помещения (`room.color`).
// Совместимости вперёд нет сознательно: страница версии 1 не знает о контурах
// и, открыв такой файл, молча потеряла бы их вместе с ручной правкой —
// поэтому она честно откажется («файл сделан более новой версией»).
// Назад совместимость обязательна: файл версии 1 читается и дополняется
// умолчаниями в `projectFile.migrateProject`, а метка без `roomManual`
// считается правленной руками (`markRoomManual`).
export const FORMAT_VERSION = 2;

// Условные обозначения, которые предлагает сетка выбора. Их различают на
// чёрно-белой распечатке в размере метки, поэтому семейства разведены контуром,
// а внутри семейства — засечкой: перекрестье, точка, сплошная заливка.
// Порядок — порядок сетки. Различимость проверяет test/shapes.test.js:
// фигура, которая сливается с соседкой в размере метки, красит его.
export const SHAPE_PALETTE = [
  "circle",
  "circle-cross",
  "circle-dot",
  "circle-fill",
  // Узнаваемые значки: клавиша выключателя, две клавиши, переключатель на два
  // направления, беспроводная точка. Рисуются своим кодом на холсте — ни шрифта,
  // ни эмодзи, иначе распечатка разойдётся с экраном на чужой системе.
  "circle-slash",
  "circle-slash-two",
  "circle-chevron",
  "circle-wave",
  "square",
  "square-cross",
  "square-fill",
  "square-jack",
  "triangle",
  "triangle-down",
  "diamond",
  "star",
  "plus",
];

// Начертание линейной метки. Сплошная и пунктирная значат разное, поэтому
// начертание — часть условного обозначения и живёт там же, где форма:
// у категории, с перебивкой у типа. Третьего правила в сборке нет.
export const LINE_STYLES = ["solid", "dashed"];

// Фигуры, которые ещё встречаются в объектах, но сетка их больше не предлагает:
// в размере метки шестиугольник неотличим от круга, залитый ромб — от залитого
// квадрата, а круг, залитый наполовину, — от залитого целиком. Рисоваться они
// продолжают как раньше: объекты с ними уже существуют.
export const SHAPE_LEGACY = ["hexagon", "diamond-fill", "circle-half"];

// Допустимые значения поля формы: палитра плюс старые значения.
export const SHAPE_NAMES = [...SHAPE_PALETTE, ...SHAPE_LEGACY];
export const BLOCK_MODES = ["each", "single"];
export const MARK_KINDS = ["point", "line"];

// Код типа: от одной буквы до шестнадцати. Заказчик снял прежний предел в две
// буквы, чтобы писать «ПОДСВЕТКА», а не «П».
export const CODE_MAX_LENGTH = 16;
// До двух букв подпись блока склеивается слитно — «В1В2В3», как на рукописном
// листе; длинный код так превращается в кашу и сворачивается в диапазон.
const CODE_GLUE_MAX = 2;

// Шаг соседней точки блока в пикселях плана (доля считается от размера схемы).
export const BLOCK_STEP_PX = 28;
// Размер плана, по которому считается шаг, пока схема не знает своих пикселей.
const BLOCK_FALLBACK_SIZE_PX = 1000;
// Цвет метки, когда категория недоступна.
const FALLBACK_COLOR = "#8B949E";
export const BLOCK_SIDES = ["left", "right", "up", "down"];

// Цвета помещений и категорий: цветом комнаты обводится её контур на плане,
// цветом категории красятся метки и заголовки групп в таблицах. На одном
// плане контуров бывает под десяток, поэтому палитра подобрана числами,
// а не на глаз:
//   — любые два цвета расходятся не меньше чем на 22 ΔE (CIE76) — тонкую
//     линию одного не спутать с линией другого;
//   — контраст к белому не ниже 2,9 (цвет не теряется на белом плане)
//     и к чёрному не ниже 2,4 (не сливается с карандашными стенами);
//   — насыщенность ограничена сверху: кислотный цвет поверх плана режет глаз;
//   — каждый цвет разведён с цветами категорий шаблона при любой плотности
//     заливки, вплоть до сплошной: метка рисуется поверх заливки своей же
//     комнаты и не должна в ней раствориться (собственные категории
//     пользователя стережёт `colorsInUse` — окно выбора считает их занятыми).
// Порядок не случайный: каждый следующий цвет максимально далёк от всех
// предыдущих, поэтому первые шесть комнат получают самые несхожие контуры,
// а запаса хватает на квартиру целиком.
export const ROOM_PALETTE = [
  "#0F766E",
  "#B45309",
  "#7E22CE",
  "#BE123C",
  "#15803D",
  "#2A78D1",
  "#D169B9",
  "#9C931A",
  "#664733",
  "#1DAB1D",
  "#374F6E",
  "#852E51",
  "#633894",
  "#289EC9",
  "#D17669",
  "#D124C0",
  "#5B6624",
  "#B38F59",
  "#D1247A",
  "#4141C4",
  "#8C2F20",
  "#689C2D",
  "#8C1875",
  "#A856D1",
];

// ——— арифметика цвета ——————————————————————————————————————————————————
//
// Переводы нужны окну выбора цвета: поле «насыщенность/яркость» живёт в HSV,
// поля R, G, B — в байтах, а хранится и рисуется всё в hex. Отдельно —
// расстояние между цветами: сравнивать сырые байты бесполезно, два далёких
// по числам цвета глаз читает как один. Поэтому цвета переводятся в CIE Lab
// (sRGB, D65) и меряются по ΔE76: ΔE ≈ 2 — предел различимости рядом,
// ΔE > 20 — «явно разные цвета».

export function hexToRgb(value) {
  const hex = String(value == null ? "" : value).trim();
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return null;
  return {
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16),
  };
}

function colorByte(value) {
  const number = Math.round(Number(value));
  if (!Number.isFinite(number)) return 0;
  return Math.min(255, Math.max(0, number));
}

export function rgbToHex(rgb) {
  const parts = [colorByte(rgb && rgb.r), colorByte(rgb && rgb.g), colorByte(rgb && rgb.b)];
  return "#" + parts.map((part) => part.toString(16).padStart(2, "0").toUpperCase()).join("");
}

// Оттенок — градусы 0…360 (360 сворачивается в 0), насыщенность и яркость — доли.
export function rgbToHsv(rgb) {
  const r = colorByte(rgb && rgb.r) / 255;
  const g = colorByte(rgb && rgb.g) / 255;
  const b = colorByte(rgb && rgb.b) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const span = max - min;
  let h = 0;
  if (span > 0) {
    if (max === r) h = 60 * (((g - b) / span) % 6);
    else if (max === g) h = 60 * ((b - r) / span + 2);
    else h = 60 * ((r - g) / span + 4);
  }
  if (h < 0) h += 360;
  return { h, s: max === 0 ? 0 : span / max, v: max };
}

export function hsvToRgb(hsv) {
  const h = ((Number(hsv && hsv.h) || 0) % 360 + 360) % 360;
  const s = Math.min(1, Math.max(0, Number(hsv && hsv.s) || 0));
  const v = Math.min(1, Math.max(0, Number(hsv && hsv.v) || 0));
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  const sector = Math.floor(h / 60) % 6;
  const table = [
    [c, x, 0],
    [x, c, 0],
    [0, c, x],
    [0, x, c],
    [x, 0, c],
    [c, 0, x],
  ][sector];
  return {
    r: Math.round((table[0] + m) * 255),
    g: Math.round((table[1] + m) * 255),
    b: Math.round((table[2] + m) * 255),
  };
}

function colorLinear(byte) {
  const channel = byte / 255;
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

// sRGB → XYZ (D65) → Lab. Константы — из определения пространства.
function colorToLab(rgb) {
  const r = colorLinear(rgb.r);
  const g = colorLinear(rgb.g);
  const b = colorLinear(rgb.b);
  const x = (r * 0.4124564 + g * 0.3575761 + b * 0.1804375) / 0.95047;
  const y = r * 0.2126729 + g * 0.7151522 + b * 0.072175;
  const z = (r * 0.0193339 + g * 0.119192 + b * 0.9503041) / 1.08883;
  const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (841 / 108) * t + 4 / 29);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}

// Неизвестный цвет ничего не ограничивает: расстояние до него бесконечно,
// и проверка «занят ли цвет» такой цвет просто не замечает.
export function colorDistance(first, second) {
  const a = hexToRgb(first);
  const b = hexToRgb(second);
  if (!a || !b) return Number.POSITIVE_INFINITY;
  const left = colorToLab(a);
  const right = colorToLab(b);
  return Math.hypot(left[0] - right[0], left[1] - right[1], left[2] - right[2]);
}

// Ближе этого расстояния два цвета читаются как один и тот же: цвет палитры,
// рядом с которым уже стоит чужой, свободным не считается.
export const COLOR_SAME_DISTANCE = 10;

// Свободный цвет: первый в палитре, рядом с которым ещё ничего не покрашено.
// Палитра кончилась — берём тот, что стоит дальше всех от занятых, а при
// равенстве самый редкий: слепой круг «следующий по счёту» повторял бы цвет
// соседней комнаты, даже когда в палитре есть менее ходовой.
export function freeColor(used, options = {}) {
  const palette = Array.isArray(options.palette) && options.palette.length > 0 ? options.palette : ROOM_PALETTE;
  const limit = Number.isFinite(options.minDistance) ? options.minDistance : COLOR_SAME_DISTANCE;
  const taken = (Array.isArray(used) ? used : [])
    .map((value) => (hexToRgb(value) ? String(value).trim().toUpperCase() : null))
    .filter(Boolean);
  let best = null;
  for (const color of palette) {
    const key = String(color).trim().toUpperCase();
    let nearest = Number.POSITIVE_INFINITY;
    let count = 0;
    for (const other of taken) {
      const distance = colorDistance(color, other);
      if (distance < nearest) nearest = distance;
      if (other === key) count += 1;
    }
    if (nearest >= limit) return color;
    if (!best || nearest > best.nearest || (nearest === best.nearest && count < best.count)) {
      best = { color, nearest, count };
    }
  }
  return best ? best.color : palette[0];
}

// Заливка контура комнаты — её цвет, разведённый белизной плана. Метка
// рисуется поверх этой заливки цветом своей категории, поэтому смешивание
// нужно и окну выбора (показать, как цвет ляжет на план), и проверке
// «не потеряется ли метка в заливке».
export function colorBlend(color, base, alpha) {
  const over = hexToRgb(color);
  const under = hexToRgb(base);
  if (!over || !under) return rgbToHex(over || under || { r: 0, g: 0, b: 0 });
  const share = Math.min(1, Math.max(0, Number(alpha) || 0));
  return rgbToHex({
    r: over.r * share + under.r * (1 - share),
    g: over.g * share + under.g * (1 - share),
    b: over.b * share + under.b * (1 - share),
  });
}

// Поле «насыщенность/яркость» окна выбора цвета: курсор ходит по прямоугольнику
// в долях от его размера — слева направо растёт насыщенность, сверху вниз
// падает яркость. Перевод в обе стороны живёт здесь, а не в панели: от него
// зависит, какой цвет получит пользователь, а ошибается он молча — цвет просто
// оказывается не тем, куда щёлкнули.
export function colorFieldToHsv({ h, x, y }) {
  return {
    h: (((Number(h) || 0) % 360) + 360) % 360,
    s: Math.min(1, Math.max(0, Number(x) || 0)),
    v: 1 - Math.min(1, Math.max(0, Number(y) || 0)),
  };
}

export function colorHsvToField(hsv) {
  return {
    x: Math.min(1, Math.max(0, Number(hsv && hsv.s) || 0)),
    y: 1 - Math.min(1, Math.max(0, Number(hsv && hsv.v) || 0)),
  };
}

// «Цвет уже занят»: не побайтное совпадение, а близость на глаз — иначе
// сосед, отличающийся на единицу в последнем разряде, считался бы свободным.
export function colorTaken(color, used, minDistance = COLOR_SAME_DISTANCE) {
  return (Array.isArray(used) ? used : []).some((other) => colorDistance(color, other) < minDistance);
}

// Цвет, который глаз читает как «другой»: ΔE ниже — уже оттенок того же.
export const COLOR_FAR_DISTANCE = 22;
// Границы яркости, в которых цвет виден и на белом плане, и на карандашных
// стенах (те же, по которым подобрана палитра).
const COLOR_MIN_LUMINANCE = 0.075;
const COLOR_MAX_LUMINANCE = 0.3;
const COLOR_RANDOM_TRIES = 60;

function colorLuminance(rgb) {
  return 0.2126 * colorLinear(rgb.r) + 0.7152 * colorLinear(rgb.g) + 0.0722 * colorLinear(rgb.b);
}

// Случайный цвет для кнопки «Случайный цвет»: наугад берётся оттенок, но
// годится не любой — слишком светлый потеряется на плане, слишком тёмный
// сольётся со стенами, а похожий на занятый не отличить от соседней комнаты.
// Не нашлось за отведённые попытки — отдаём свободный цвет палитры: лучше
// предсказуемый цвет, чем похожий на чужой.
export function randomColor(used, options = {}) {
  const random = typeof options.random === "function" ? options.random : Math.random;
  const goal = Number.isFinite(options.minDistance) ? options.minDistance : COLOR_FAR_DISTANCE;
  const taken = (Array.isArray(used) ? used : []).filter((value) => hexToRgb(value));
  for (let attempt = 0; attempt < COLOR_RANDOM_TRIES; attempt += 1) {
    const rgb = hsvToRgb({ h: random() * 360, s: 0.5 + random() * 0.35, v: 0.42 + random() * 0.42 });
    const light = colorLuminance(rgb);
    if (light < COLOR_MIN_LUMINANCE || light > COLOR_MAX_LUMINANCE) continue;
    const color = rgbToHex(rgb);
    if (taken.every((other) => colorDistance(color, other) >= goal)) return color;
  }
  return freeColor(taken, { ...options, minDistance: goal });
}

// Наименьшее число вершин замкнутого контура: двумя точками комнату не обвести.
export const OUTLINE_MIN_POINTS = 3;

// Углы подписи. Девяносто градусов — подпись вдоль стены: в узком коридоре и у
// простенка горизонтальная не влезает, на рукописном эталоне заказчик поворачивал
// её от руки. Третьего угла нет нарочно: 180° читается вверх ногами, а 270°
// от 90° отличается только направлением чтения.
export const LABEL_ANGLES = [0, 90];

// Размер метки и подписи в пикселях плана — с них начинается новый объект.
// Считано от бумаги: план в 2500 пикселей по большей стороне на листе A3 это
// 0,16 мм на пиксель, монтажник читает с расстояния вытянутой руки, значит
// подпись должна быть от двух с половиной миллиметров. Прежние 12 пикселей
// давали 1,9 мм, и проверяющий выгрузил схему, так и не узнав, что регулятор
// вообще есть. Двадцать пикселей — это 3,2 мм подписи и 5 мм значка.
// Регулятор никуда не делся: это только начальное значение нового объекта,
// у размеченных объектов свои числа уже записаны.
const DEFAULT_VIEW = { markSize: 16, labelSize: 20 };

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
  // Проходной переключатель: свет из двух мест — в квартире вещь обычная.
  // Свой значок нужен сразу: без него он рисуется тем же зелёным кругом,
  // что и соседние два выключателя.
  { category: "switches", code: "ВП", name: strings.types.switchWay, shape: "circle-chevron" },
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
    lineStyle: null,
    order: index,
  }));
  const markTypes = TEMPLATE_TYPES.map((type, index) => ({
    id: newId(),
    categoryId: categoryIds.get(type.category),
    code: type.code,
    name: type.name,
    shape: type.shape || null,
    lineStyle: null,
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
    // Контуры помещений на схемах: у одной комнаты на разных схемах свои
    // обводки или ни одной. Объект старого формата их не знает — читается
    // список везде через `outlinesOf`, поэтому пустого поля здесь достаточно.
    outlines: [],
    // Оборудование: справочник моделей объекта и размещённые единицы.
    // Объект старого формата их не знает — читают списки через `equipmentOf`
    // и `placementsOf`, поэтому пустых полей здесь достаточно.
    equipment: [],
    placements: [],
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

export function findOutline(project, outlineId) {
  return outlinesOf(project).find((outline) => outline.id === outlineId) || null;
}

export function findRoom(project, roomId) {
  return project.rooms.find((room) => room.id === roomId) || null;
}

// Первая метка с таким обозначением. Номер может повторяться намеренно
// (три светильника одной группы — Т1), и тогда это первая из них в порядке
// объекта; все повторы перечисляет `repeatedNumbers`.
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

// Смена подложки: картинка другая, разметка та же. Доли меток и контуров не
// трогаются — при той же пропорции всё встаёт на свои места само, при другой
// разметка поедет, и спросить об этом обязан вызывающий, до правки.
// Пересчитывается только то, что задано в пикселях плана, — смещения подписей:
// на картинке вдвое крупнее прежние 12 px означали бы вдвое меньший отступ.
export function replaceSchemeImage(project, schemeId, { imageId, width, height } = {}) {
  const scheme = requireScheme(project, schemeId);
  if (typeof imageId !== "string" || imageId === "") throw modelError("imageRequired");
  const nextWidth = Math.round(Number(width));
  const nextHeight = Math.round(Number(height));
  if (!(nextWidth > 0) || !(nextHeight > 0)) throw modelError("planSizeInvalid");
  const scaleX = scheme.width > 0 ? nextWidth / scheme.width : 1;
  const scaleY = scheme.height > 0 ? nextHeight / scheme.height : 1;
  const scaleOffset = (offset) =>
    offset ? { dx: roundOffset(offset.dx * scaleX), dy: roundOffset(offset.dy * scaleY) } : offset;
  const schemes = project.schemes.map((item) =>
    item.id === schemeId ? { ...item, imageId, width: nextWidth, height: nextHeight } : item,
  );
  const marks = project.marks.map((mark) =>
    mark.schemeId === schemeId && mark.labelOffset ? { ...mark, labelOffset: scaleOffset(mark.labelOffset) } : mark,
  );
  const groups = project.groups.map((group) =>
    group.schemeId === schemeId && group.labelOffset
      ? { ...group, labelOffset: scaleOffset(group.labelOffset) }
      : group,
  );
  return {
    project: withProject(project, { schemes, marks, groups }),
    scheme: schemes.find((item) => item.id === schemeId),
  };
}

function roundOffset(value) {
  return Math.round(Number(value) * 100) / 100;
}

// Какие картинки объекту нужны: по этому списку хранилище понимает, что в нём
// осталось от прежних подложек и больше никому не принадлежит.
export function usedImageIds(project) {
  const ids = new Set();
  for (const scheme of (project && project.schemes) || []) {
    if (scheme.imageId) ids.add(scheme.imageId);
  }
  return ids;
}

export function deleteScheme(project, schemeId) {
  requireScheme(project, schemeId);
  const removed = new Set(project.marks.filter((mark) => mark.schemeId === schemeId).map((mark) => mark.id));
  const marks = dropControls(
    project.marks.filter((mark) => mark.schemeId !== schemeId),
    removed,
  );
  const groups = project.groups.filter((group) => group.schemeId !== schemeId);
  // Контуры помещений живут на схеме — вместе с ней и уходят.
  const outlines = outlinesOf(project).filter((outline) => outline.schemeId !== schemeId);
  const schemes = project.schemes
    .filter((scheme) => scheme.id !== schemeId)
    .map((scheme, index) => ({ ...scheme, order: index }));
  const placements = dropPlacements(project, removed);
  return { project: withProject(project, { schemes, marks, groups, outlines, placements }) };
}

// Единственный порядок справочника: категории по своему order, типы внутри —
// по своему. Им пользуются и окно выбора типа, и легенда в выгрузке, и таблицы:
// разойдись они — на бумаге окажется не тот порядок, что на экране.
export function typesInOrder(project) {
  if (!project) return [];
  return project.categories
    .map((category, index) => ({ category, order: category.order == null ? index : category.order }))
    .sort((a, b) => a.order - b.order)
    .map(({ category }) => ({
      category,
      types: project.markTypes
        .filter((type) => type.categoryId === category.id)
        .map((type, index) => ({ type, order: type.order == null ? index : type.order }))
        .sort((a, b) => a.order - b.order)
        .map((item) => item.type),
    }))
    .filter((group) => group.types.length > 0);
}

// Поиск типа по строке из окна «Тип метки»: по коду с начала и по названию
// в любом месте, без учёта регистра. Точное совпадение кода идёт первым —
// и в своей категории, и среди категорий: «Р» — это Розетка, а не «Подсветка
// кровати», где та же буква стоит в середине названия. Порядок всего
// остального — порядок справочника, своей сортировки здесь нет.
// Пустой запрос отдаёт справочник целиком.
function typeMatchesQuery(type, needle) {
  if (!needle) return true;
  return type.code.toLowerCase().startsWith(needle) || type.name.toLowerCase().includes(needle);
}

// Сила совпадения. Точным считается не только код, но и название целиком:
// «Светильник» — это тип «С», а не «Точечный светильник», где запрос сидит
// в середине. Код сильнее названия: его вводят, чтобы попасть в тип одним
// словом. Ниже — совпадение с начала названия, ещё ниже — в середине;
// внутри одной силы порядок остаётся порядком справочника.
function typeExactRank(type, needle) {
  if (!type || !needle) return 0;
  const code = type.code.toLowerCase();
  const name = type.name.toLowerCase();
  if (code === needle) return 3;
  if (name === needle) return 2;
  if (code.startsWith(needle) || name.startsWith(needle)) return 1;
  return 0;
}

// Тип, у которого код или название совпадают с запросом целиком. Нужен окну
// выбора: пока такой тип есть, заводить второй с тем же названием незачем —
// на этом проверяющий и поставил две метки не того типа.
export function matchTypeExactly(project, query) {
  const needle = String(query == null ? "" : query).trim().toLowerCase();
  if (!needle || !project) return null;
  return (
    (project.markTypes || []).find(
      (type) => type.code.toLowerCase() === needle || type.name.toLowerCase() === needle,
    ) || null
  );
}

export function searchTypes(project, query) {
  const needle = String(query == null ? "" : query).trim().toLowerCase();
  const groups = typesInOrder(project)
    .map(({ category, types }) => ({
      category,
      types: types
        .filter((type) => typeMatchesQuery(type, needle))
        .sort((a, b) => typeExactRank(b, needle) - typeExactRank(a, needle)),
    }))
    .filter((group) => group.types.length > 0);
  return groups.sort((a, b) => typeExactRank(b.types[0], needle) - typeExactRank(a.types[0], needle));
}

// Порядок помещений — порядок появления: их заводят по ходу разметки, и этот
// порядок пользователю знаком. Живёт рядом со schemesInOrder и typesInOrder:
// порядок сущностей объекта — правило объекта, а не панели.
export function roomsInOrder(project) {
  return project && Array.isArray(project.rooms) ? [...project.rooms] : [];
}

// Порядок схем объекта — одно правило на всех: нумерация, панели и выгрузки
// обходят схемы одинаково.
export function schemesInOrder(project) {
  return project.schemes
    .map((scheme, index) => ({ scheme, index }))
    .sort((a, b) => {
      const orderA = a.scheme.order ?? a.index;
      const orderB = b.scheme.order ?? b.index;
      return orderA === orderB ? a.index - b.index : orderA - orderB;
    })
    .map((item) => item.scheme);
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

// Самый большой номер, выданный меткам этого кода типа.
function highestNumber(project, code) {
  let top = 0;
  for (const mark of project.marks) {
    const type = findType(project, mark.typeId);
    if (type && type.code === code && mark.number > top) top = mark.number;
  }
  return top;
}

// Следующий свободный номер типа. Счётчик ведёт нумерацию и только растёт, но
// выше него может оказаться номер, поставленный вручную, или счётчик, потерянный
// при переносе объекта, — поэтому на занятые номера смотрим тоже: новая метка
// получает свободный номер, а не молчаливый дубль.
function nextNumber(project, counters, code) {
  return Math.max(counters[code] || 0, highestNumber(project, code)) + 1;
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
    // Помещение проставляет автоматика по контуру, пока пользователь не вписал
    // его руками: после этого метка принадлежит ему, а не сервису.
    roomManual: false,
    location: "",
    original: "",
    // Чем управляет: ссылки на другие метки объекта. Именно ссылки, а не текст, —
    // смена типа и уплотнение номеров переписывают обозначения, а связь должна
    // это пережить.
    controls: [],
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
      const number = nextNumber(project, counters, type.code);
      counters[type.code] = number;
      created.push(makeMark({ schemeId, typeId, kind, points: [point], number }));
    }
  } else {
    const number = nextNumber(project, counters, type.code);
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
  if (group) return blockLabel(project, group.markIds);
  return "";
}

function markLabel(project, mark) {
  const type = findType(project, mark.typeId);
  return (type ? type.code : "?") + mark.number;
}

// Порядок меток внутри блока — один на всё приложение: сперва порядок типа
// в справочнике (тот же typesInOrder, что у легенды и таблиц), потом номер.
// По нему собирается подпись и по нему же берут ведущую метку блока — ту,
// с которой подпись начинается. В смешанном блоке это не обязательно та,
// которую поставили первой.
export function blockMembers(project, markIds) {
  const order = new Map();
  let index = 0;
  for (const { types } of typesInOrder(project)) for (const type of types) order.set(type.id, index++);
  const rank = (mark) => (order.has(mark.typeId) ? order.get(mark.typeId) : Number.MAX_SAFE_INTEGER);
  return (markIds || [])
    .map((markId, position) => ({ mark: findMark(project, markId), position }))
    .filter((item) => item.mark)
    .sort((a, b) => {
      if (rank(a.mark) !== rank(b.mark)) return rank(a.mark) - rank(b.mark);
      if (a.mark.number !== b.mark.number) return a.mark.number - b.mark.number;
      return a.position - b.position;
    })
    .map((item) => item.mark);
}

// Подпись блока: подряд идущие номера одного типа склеиваются слитно,
// разнородные — через запятую («В1, Р1» — выключатель и розетка в одной рамке).
// Список меток задаёт вызывающий: у группы это её метки, а на плане под
// фильтром — только видимые, иначе подпись обещает то, чего на листе нет.
export function blockLabel(project, markIds) {
  const runs = [];
  let previous = null;
  // Повторённый номер называется один раз: подпись перечисляет обозначения,
  // а не метки, и «Т1, Т1» на плане говорит о двух точках ровно то же, что «Т1».
  const named = new Set();
  for (const mark of blockMembers(project, markIds)) {
    const type = findType(project, mark.typeId);
    const code = type ? type.code : "?";
    const key = code + "\u0000" + mark.number;
    if (named.has(key)) continue;
    named.add(key);
    const sameRun = previous && previous.code === code && mark.number === previous.number + 1;
    if (sameRun) runs[runs.length - 1].numbers.push(mark.number);
    else runs.push({ code, numbers: [mark.number] });
    previous = { code, number: mark.number };
  }
  return runs.map(blockRunLabel).join(", ");
}

// Подряд идущие номера одного типа: короткий код склеивается слитно («В1В2В3»),
// длинный сворачивается в диапазон («ПОДСВЕТКА1–3») — иначе подпись блока на
// плане нечитаема.
function blockRunLabel(run) {
  if ([...run.code].length <= CODE_GLUE_MAX) return run.numbers.map((number) => run.code + number).join("");
  if (run.numbers.length === 1) return run.code + run.numbers[0];
  return run.code + run.numbers[0] + "–" + run.numbers[run.numbers.length - 1];
}

// Хозяин новой точки в режиме «одна метка на блок» — метка того же типа:
// сама соседка, если тип совпал, иначе первая метка этого типа в блоке.
// Своей метки этого типа в блоке может и не быть — тогда её ставят первой.
function blockHost(project, mark, typeId) {
  if (mark.typeId === typeId) return mark;
  const group = findGroup(project, mark.groupId);
  if (!group) return null;
  for (const id of group.markIds) {
    const member = findMark(project, id);
    if (member && member.typeId === typeId && member.kind === "point") return member;
  }
  return null;
}

// Режим блока берётся у типа ставящейся метки, а не у соседней: в смешанном
// блоке выключатели могут идти «каждая своя», а розетки — «одна на блок».
// Исключение одно: метка, уже собранная как «одна на блок», растёт точками
// независимо от умолчания типа — её собственная форма важнее справочника.
function blockModeOf(mark, type) {
  if (mark.typeId === type.id && mark.kind === "point" && mark.points.length > 1) return "single";
  return type.blockMode || "each";
}

// Соседняя точка блока: сдвиг на шаг плана в долях от размера схемы.
// `options.typeId` — тип ставящейся метки (в одной рамке подрозетника рядом
// с выключателем стоит розетка); по умолчанию — тип соседней метки.
// Номер новая метка получает по счётчику своего типа.
// ——— «чем управляет» —————————————————————————————————————————————————

// Поле появилось не сразу: у метки из старого файла или из браузерного
// хранилища его просто нет, и это не поломка. Читают связь только отсюда.
export function markControlIds(mark) {
  return mark && Array.isArray(mark.controls) ? mark.controls : [];
}

// Метки, которыми управляет эта, — в порядке объекта, а не в порядке кликов:
// строка списка и таблица должны читаться одинаково после каждой правки.
export function markControls(project, markId) {
  const mark = findMark(project, markId);
  if (!mark) return [];
  const wanted = new Set(markControlIds(mark));
  return wanted.size === 0 ? [] : marksInOrder(project, (item) => wanted.has(item.id));
}

// Обратная сторона: кто управляет этой меткой. Отдельного поля у неё нет —
// хранить связь с двух концов значит однажды их разойтись.
export function markControlledBy(project, markId) {
  if (!findMark(project, markId)) return [];
  return marksInOrder(project, (item) => markControlIds(item).includes(markId));
}

// Список переписывается целиком: окно выбора отдаёт то, что отмечено галочками.
export function setMarkControls(project, markId, controlled) {
  requireMark(project, markId);
  const wanted = [];
  for (const id of Array.isArray(controlled) ? controlled : []) {
    if (id === markId) throw modelError("controlsSelf");
    requireMark(project, id);
    if (!wanted.includes(id)) wanted.push(id);
  }
  // Хранится в порядке объекта — тогда и файл, и таблица, и строка списка
  // показывают одно и то же независимо от того, в каком порядке щёлкали.
  const order = new Map(marksInOrder(project).map((mark, index) => [mark.id, index]));
  wanted.sort((first, second) => order.get(first) - order.get(second));
  const marks = project.marks.map((mark) => (mark.id === markId ? { ...mark, controls: wanted } : mark));
  return { project: withProject(project, { marks }), mark: marks.find((mark) => mark.id === markId) };
}

// Ссылки на исчезнувшие метки снимаются одним проходом: висячая связь — это
// пустое место в таблице и вопрос «а что это было».
function dropControls(marks, removed) {
  if (removed.size === 0) return marks;
  return marks.map((mark) => {
    const ids = markControlIds(mark);
    if (!ids.some((id) => removed.has(id))) return mark;
    return { ...mark, controls: ids.filter((id) => !removed.has(id)) };
  });
}

export function addToGroup(project, markId, side, options = {}) {
  const mark = requireMark(project, markId);
  if (mark.kind !== "point") throw modelError("blockOnlyForPoints");
  if (!BLOCK_SIDES.includes(side)) throw modelError("unknownSide");
  const scheme = requireScheme(project, mark.schemeId);
  const type = requireType(project, options.typeId || mark.typeId);
  const stepPx = options.step || BLOCK_STEP_PX;
  const dx = stepPx / (scheme.width > 0 ? scheme.width : BLOCK_FALLBACK_SIZE_PX);
  const dy = stepPx / (scheme.height > 0 ? scheme.height : BLOCK_FALLBACK_SIZE_PX);
  const from = mark.points[mark.points.length - 1];
  const point = {
    x: clampFraction(from.x + (side === "left" ? -dx : side === "right" ? dx : 0)),
    y: clampFraction(from.y + (side === "up" ? -dy : side === "down" ? dy : 0)),
  };

  const mode = options.blockMode || blockModeOf(mark, type);
  const host = mode === "single" ? blockHost(project, mark, type.id) : null;
  if (host) {
    const grown = updateMark(project, host.id, { points: [...host.points, point] });
    return { project: grown.project, mark: grown.mark, group: findGroup(project, mark.groupId) };
  }

  const counters = { ...project.counters };
  const number = nextNumber(project, counters, type.code);
  counters[type.code] = number;
  const created = makeMark({
    schemeId: mark.schemeId,
    typeId: type.id,
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

const MARK_PATCH_FIELDS = [
  "points",
  "closed",
  "labelOffset",
  "labelAngle",
  "roomId",
  "roomManual",
  "location",
  "original",
];

export function updateMark(project, markId, patch) {
  requireMark(project, markId);
  const changes = pick(patch, MARK_PATCH_FIELDS);
  if (Object.prototype.hasOwnProperty.call(changes, "points")) {
    changes.points = normalizePoints(changes.points);
  }
  // Угол подписи — из списка и числом. Сорок пять градусов или строка «90»
  // означали бы, что подпись нарисована в одном месте, а ловится в другом:
  // габарит и попадание по клику считаются по этому же числу.
  if (Object.prototype.hasOwnProperty.call(changes, "labelAngle")) {
    if (!LABEL_ANGLES.includes(changes.labelAngle)) throw modelError("labelAngleUnknown");
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
  // Метка ушла — и из чужих списков «чем управляет» тоже: висячая ссылка
  // доехала бы до файла и до таблицы связей.
  const gone = new Set([markId]);
  const linked = dropControls(cleaned, gone);
  const placements = dropPlacements(project, gone);
  return { project: withProject(project, { marks: linked, groups, placements }), deleted: mark };
}

// ——— поиск по объекту ————————————————————————————————————————————————
//
// Ищем по всему объекту, а не по открытой схеме: «где Р14» — вопрос про дом,
// а не про лист. Четыре поля, которые человек и держит в голове: обозначение,
// расположение словами, обозначение из оригинального проекта и помещение.
// Помещение отдельной строкой не выдаётся: выбор строки ведёт к метке, и
// «показать метки комнаты» — это просто её метки в списке.
const SEARCH_FIELDS = [
  { field: "label", rank: 0 },
  { field: "location", rank: 3 },
  { field: "original", rank: 6 },
  { field: "room", rank: 9 },
];

export function searchProject(project, query) {
  const needle = String(query == null ? "" : query).trim().toLowerCase();
  if (!project || needle === "") return [];
  const order = new Map(schemesInOrder(project).map((scheme, index) => [scheme.id, index]));
  const last = order.size;
  const rows = [];
  for (const mark of project.marks) {
    const room = mark.roomId ? findRoom(project, mark.roomId) : null;
    const values = {
      label: labelOf(project, mark.id) || "",
      location: mark.location || "",
      original: mark.original || "",
      room: room ? room.name : "",
    };
    let best = null;
    for (const item of SEARCH_FIELDS) {
      const value = values[item.field];
      const lower = value.toLowerCase();
      if (!lower || !lower.includes(needle)) continue;
      // Точное совпадение сильнее начала строки, начало — сильнее середины.
      const closeness = lower === needle ? 0 : lower.startsWith(needle) ? 1 : 2;
      const rank = item.rank + closeness;
      if (!best || rank < best.rank) best = { field: item.field, rank, value };
    }
    if (!best) continue;
    const type = findType(project, mark.typeId);
    const scheme = findScheme(project, mark.schemeId);
    rows.push({
      markId: mark.id,
      schemeId: mark.schemeId,
      schemeName: scheme ? scheme.name : "",
      typeId: mark.typeId,
      typeName: type ? type.name : "",
      roomName: room ? room.name : "",
      label: values.label,
      field: best.field,
      value: best.value,
      rank: best.rank,
      order: order.has(mark.schemeId) ? order.get(mark.schemeId) : last,
    });
  }
  return rows.sort((a, b) => {
    if (a.rank !== b.rank) return a.rank - b.rank;
    if (a.order !== b.order) return a.order - b.order;
    return a.label.localeCompare(b.label, "ru", { numeric: true });
  });
}

// ——— нумерация ———————————————————————————————————————————————————————

// Верхняя граница ручного номера: опечатка в поле не должна унести счётчик типа
// в тысячи и выдать следующей метке Т100001.
export const MARK_NUMBER_MAX = 9999;

function normalizeNumber(value) {
  const number = typeof value === "string" ? Number(value.trim()) : Number(value);
  if (!Number.isInteger(number) || number < 1) throw modelError("badNumber");
  if (number > MARK_NUMBER_MAX) throw modelError("numberTooBig", { max: MARK_NUMBER_MAX });
  return number;
}

// Номер ставится руками: несколько одинаковых светильников, подключённых к одной
// группе, носят на схеме один номер — Т1, Т1, Т1. Повтор здесь приём, а не
// ошибка, поэтому он не запрещён; видимым его делает `validate`.
export function setMarkNumber(project, markId, number) {
  const mark = requireMark(project, markId);
  const value = normalizeNumber(number);
  if (mark.number === value) return { project, mark };
  const marks = project.marks.map((item) => (item.id === markId ? { ...item, number: value } : item));
  // Счётчик не опускается ниже занятого номера: следующая новая метка типа
  // должна получить свободный номер, а не повторить поставленный вручную.
  const type = findType(project, mark.typeId);
  const counters = type
    ? { ...project.counters, [type.code]: Math.max(project.counters[type.code] || 0, value) }
    : project.counters;
  return { project: withProject(project, { marks, counters }), mark: marks.find((item) => item.id === markId) };
}

// Порядок обхода: схемы по order, внутри схемы — порядок постановки меток.
function marksInOrder(project, filter) {
  const schemeOrder = new Map(schemesInOrder(project).map((scheme, index) => [scheme.id, index]));
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
  // Номер выдаётся не метке, а номеру: первое появление старого номера в порядке
  // обхода забирает следующий свободный, а всякий его повтор получает тот же
  // новый. Так намеренный повтор (три светильника одной группы — Т1) переживает
  // уплотнение, а ряд номеров смыкается без дыр.
  const renumbered = new Map();
  for (const mark of ordered) {
    let number = renumbered.get(mark.number);
    if (number === undefined) {
      number = renumbered.size + 1;
      renumbered.set(mark.number, number);
    }
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
  }
  const marks = project.marks.map((mark) =>
    numbers.has(mark.id) ? { ...mark, number: numbers.get(mark.id) } : mark,
  );
  const counters = { ...project.counters, [type.code]: renumbered.size };
  return { changes, project: withProject(project, { marks, counters }) };
}

// Повторяющиеся обозначения: метки одного типа с одним номером. Повтор
// разрешён — три точечных светильника одной группы носят Т1, — но собирается
// сюда, чтобы список меток и `validate` показали его, а случайный дубль не
// остался незамеченным. Порядок — порядок справочника, потом номер.
export function repeatedNumbers(project) {
  const order = new Map();
  let index = 0;
  for (const { types } of typesInOrder(project)) for (const type of types) order.set(type.id, index++);
  const rank = (typeId) => (order.has(typeId) ? order.get(typeId) : Number.MAX_SAFE_INTEGER);

  const byNumber = new Map();
  for (const mark of project.marks) {
    const type = findType(project, mark.typeId);
    if (!type) continue;
    const key = mark.typeId + "#" + mark.number;
    let item = byNumber.get(key);
    if (!item) {
      item = { typeId: type.id, code: type.code, number: mark.number, label: type.code + mark.number, markIds: [] };
      byNumber.set(key, item);
    }
    item.markIds.push(mark.id);
  }
  return [...byNumber.values()]
    .filter((item) => item.markIds.length > 1)
    .map((item) => ({ ...item, count: item.markIds.length }))
    .sort((a, b) => (rank(a.typeId) === rank(b.typeId) ? a.number - b.number : rank(a.typeId) - rank(b.typeId)));
}

// Новый номер по новому типу; старый номер остаётся дырой.
export function changeMarkType(project, markId, typeId) {
  const mark = requireMark(project, markId);
  const type = requireType(project, typeId);
  if (mark.typeId === typeId) return { project, mark };
  const counters = { ...project.counters };
  const number = nextNumber(project, counters, type.code);
  counters[type.code] = number;
  const marks = project.marks.map((item) =>
    item.id === markId ? { ...item, typeId, number } : item,
  );
  return { project: withProject(project, { marks, counters }), mark: marks.find((m) => m.id === markId) };
}

// ——— справочник ———————————————————————————————————————————————————————

/**
 * Годится ли строка в код типа: тот же разбор, что у `addType` и `updateType`
 * (буквы, длина, занятость), только ошибка возвращается, а не бросается.
 * Это единственный ответ на вопрос во всей сборке — панелям своей копии
 * правила держать нельзя: прежняя копия в окне выбора типа пережила снятие
 * предела в две буквы и отказывалась заводить длинные коды.
 */
export function codeProblem(project, code, exceptTypeId) {
  try {
    normalizeCode(code, project, exceptTypeId);
    return null;
  } catch (failure) {
    return failure;
  }
}

function normalizeCode(code, project, exceptTypeId) {
  const value = String(code == null ? "" : code).trim();
  const limit = { max: CODE_MAX_LENGTH };
  if (!value) throw modelError("codeRequired", limit);
  if ([...value].length > CODE_MAX_LENGTH) throw modelError("codeTooLong", limit);
  if (!/^[A-Za-zА-Яа-яЁё]+$/u.test(value)) throw modelError("codeLetters", limit);
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

function checkLineStyle(style, { allowNull }) {
  if (style == null) {
    if (allowNull) return null;
    throw modelError("lineStyleUnknown");
  }
  if (!LINE_STYLES.includes(style)) throw modelError("lineStyleUnknown");
  return style;
}

function checkBlockMode(mode) {
  if (!BLOCK_MODES.includes(mode)) throw modelError("unknownBlockMode");
  return mode;
}

export function addType(project, { code, name, categoryId, shape = null, lineStyle = null, blockMode = "each" } = {}) {
  const type = {
    id: newId(),
    categoryId,
    code: normalizeCode(code, project),
    name: normalizeName(name),
    shape: checkShape(shape, { allowNull: true }),
    lineStyle: checkLineStyle(lineStyle, { allowNull: true }),
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
  if (Object.prototype.hasOwnProperty.call(patch, "lineStyle")) {
    next.lineStyle = checkLineStyle(patch.lineStyle, { allowNull: true });
  }
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

export function addCategory(project, { name, color, shape, lineStyle = null } = {}) {
  const category = {
    id: newId(),
    name: normalizeName(name),
    color: String(color || FALLBACK_COLOR),
    shape: checkShape(shape, { allowNull: false }),
    lineStyle: checkLineStyle(lineStyle, { allowNull: true }),
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
  if (Object.prototype.hasOwnProperty.call(patch, "lineStyle")) {
    next.lineStyle = checkLineStyle(patch.lineStyle, { allowNull: true });
  }
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

// Все цвета объекта, которые уже чем-то заняты: и комнаты, и категории.
// Одним списком, потому что на плане они встречаются — метка категории лежит
// поверх заливки комнаты, и повтор цвета там означает потерянную метку.
// `exceptRoomId` и `exceptCategoryId` убирают из списка ту строку, цвет
// которой правят: свой же цвет не должен выглядеть чужим.
export function colorsInUse(project, options = {}) {
  if (!project) return [];
  const colors = [];
  for (const category of project.categories || []) {
    if (category.id === options.exceptCategoryId) continue;
    if (category.color) colors.push(category.color);
  }
  for (const room of project.rooms || []) {
    if (room.id === options.exceptRoomId) continue;
    if (room.color) colors.push(room.color);
  }
  return colors;
}

// Цвет новой комнаты: незанятый цвет палитры — незанятый и комнатами,
// и категориями. Перекрашенная вручную комната освобождает свой цвет,
// он снова первый в очереди.
function nextRoomColor(project) {
  return freeColor(colorsInUse(project));
}

function normalizeColor(value, fallback) {
  const color = String(value == null ? "" : value).trim();
  return /^#[0-9a-fA-F]{6}$/.test(color) ? color.toUpperCase() : fallback;
}

export function addRoom(project, room) {
  const name = normalizeName(typeof room === "string" ? room : room && room.name);
  const wanted = typeof room === "object" && room ? room.color : null;
  const created = { id: newId(), name, color: normalizeColor(wanted, nextRoomColor(project)) };
  return { project: withProject(project, { rooms: [...project.rooms, created] }), room: created };
}

export function updateRoom(project, roomId, patch = {}) {
  const current = findRoom(project, roomId);
  if (!current) throw modelError("roomNotFound");
  const rooms = project.rooms.map((room) => {
    if (room.id !== roomId) return room;
    const next = { ...room };
    if (Object.prototype.hasOwnProperty.call(patch, "name")) next.name = normalizeName(patch.name);
    if (Object.prototype.hasOwnProperty.call(patch, "color")) {
      next.color = normalizeColor(patch.color, room.color || nextRoomColor(project));
    }
    return next;
  });
  return { project: withProject(project, { rooms }), room: rooms.find((room) => room.id === roomId) };
}

export function deleteRoom(project, roomId) {
  const room = findRoom(project, roomId);
  if (!room) throw modelError("roomNotFound");
  const rooms = project.rooms.filter((item) => item.id !== roomId);
  // Метка теряет помещение, но не признак ручной правки: вписанное руками
  // «без помещения» остаётся решением пользователя, и контур его не перебьёт.
  const marks = project.marks.map((mark) => (mark.roomId === roomId ? { ...mark, roomId: null } : mark));
  const outlines = outlinesOf(project).filter((outline) => outline.roomId !== roomId);
  return { project: withProject(project, { rooms, marks, outlines }), deleted: room };
}

// ——— контуры помещений ————————————————————————————————————————————————
//
// План загружается на весь объект одной картинкой, а комната обводится по
// стенам замкнутым многоугольником — с эркерами, нишами и Г-образной формой.
// Контур принадлежит схеме: у одной комнаты на разных этажах свои обводки.

function outlinesOf(project) {
  return project && Array.isArray(project.outlines) ? project.outlines : [];
}

// Площадь многоугольника (формула шнурков) в долях плана. Знак обхода не важен:
// сравнивать площади надо и у контура, нарисованного по часовой, и против.
export function outlineArea(points) {
  const list = Array.isArray(points) ? points : [];
  if (list.length < OUTLINE_MIN_POINTS) return 0;
  let sum = 0;
  for (let i = 0, j = list.length - 1; i < list.length; j = i, i += 1) {
    sum += (list[j].x + list[i].x) * (list[j].y - list[i].y);
  }
  return Math.abs(sum) / 2;
}

// Точка внутри многоугольника — луч вправо и счёт пересечений. Форма любая:
// для невыпуклой комнаты вырез считается наружной частью, ради чего всё и
// затевалось (рамка Г-образной комнаты накрывает вырез, контур — нет).
export function pointInOutline(point, points) {
  const list = Array.isArray(points) ? points : [];
  if (!point || list.length < OUTLINE_MIN_POINTS) return false;
  let inside = false;
  for (let i = 0, j = list.length - 1; i < list.length; j = i, i += 1) {
    const a = list[i];
    const b = list[j];
    const crosses = a.y > point.y !== b.y > point.y;
    if (crosses && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

// Порядок контуров схемы — от большего к меньшему. Один порядок на всё:
// рисование (меньший ложится поверх большего) и попадание точки (комната
// внутри комнаты выигрывает). Своей сортировки заводить негде.
export function outlinesInOrder(project, schemeId) {
  return outlinesOf(project)
    .filter((outline) => !schemeId || outline.schemeId === schemeId)
    .map((outline) => ({ outline, area: outlineArea(outline.points) }))
    .sort((a, b) => b.area - a.area)
    .map((item) => item.outline);
}

// Контур под точкой: последний из порядка, то есть наименьший по площади.
export function outlineAtPoint(project, schemeId, point) {
  const found = outlinesInOrder(project, schemeId).filter((outline) => pointInOutline(point, outline.points));
  return found.length > 0 ? found[found.length - 1] : null;
}

export function roomAtPoint(project, schemeId, point) {
  const outline = outlineAtPoint(project, schemeId, point);
  return outline ? outline.roomId : null;
}

function normalizeOutlinePoints(points) {
  const list = normalizePoints(points);
  if (list.length < OUTLINE_MIN_POINTS) throw modelError("shortOutline");
  return list;
}

export function addOutline(project, { schemeId, roomId, points } = {}) {
  requireScheme(project, schemeId);
  if (!findRoom(project, roomId)) throw modelError("roomNotFound");
  const outline = { id: newId(), schemeId, roomId, points: normalizeOutlinePoints(points) };
  return { project: withProject(project, { outlines: [...outlinesOf(project), outline] }), outline };
}

const OUTLINE_PATCH_FIELDS = ["points", "roomId"];

export function updateOutline(project, outlineId, patch) {
  if (!findOutline(project, outlineId)) throw modelError("outlineNotFound");
  const changes = pick(patch, OUTLINE_PATCH_FIELDS);
  if (Object.prototype.hasOwnProperty.call(changes, "points")) {
    changes.points = normalizeOutlinePoints(changes.points);
  }
  if (Object.prototype.hasOwnProperty.call(changes, "roomId") && !findRoom(project, changes.roomId)) {
    throw modelError("roomNotFound");
  }
  const outlines = outlinesOf(project).map((outline) =>
    outline.id === outlineId ? { ...outline, ...changes } : outline,
  );
  return { project: withProject(project, { outlines }), outline: outlines.find((item) => item.id === outlineId) };
}

export function deleteOutline(project, outlineId) {
  const outline = findOutline(project, outlineId);
  if (!outline) throw modelError("outlineNotFound");
  const outlines = outlinesOf(project).filter((item) => item.id !== outlineId);
  return { project: withProject(project, { outlines }), deleted: outline };
}

// ——— правка вершин контура ————————————————————————————————————————————
//
// Обводка по стенам с первого раза не выходит: вершину двигают, добавляют
// между соседними и удаляют. Всё через updateOutline — второго места, где
// меняются точки контура, нет.

function outlinePointsAt(project, outlineId) {
  const outline = findOutline(project, outlineId);
  if (!outline) throw modelError("outlineNotFound");
  return [...outline.points];
}

export function moveOutlinePoint(project, outlineId, index, point) {
  const points = outlinePointsAt(project, outlineId);
  if (!(index >= 0 && index < points.length)) throw modelError("outlinePointNotFound");
  points[index] = { x: point.x, y: point.y };
  return updateOutline(project, outlineId, { points });
}

// Новая вершина встаёт после `index` — на сегменте от неё к следующей,
// замыкающий сегмент считается таким же (последняя → первая).
export function insertOutlinePoint(project, outlineId, index, point) {
  const points = outlinePointsAt(project, outlineId);
  if (!(index >= 0 && index < points.length)) throw modelError("outlinePointNotFound");
  points.splice(index + 1, 0, { x: point.x, y: point.y });
  return updateOutline(project, outlineId, { points });
}

export function removeOutlinePoint(project, outlineId, index) {
  const points = outlinePointsAt(project, outlineId);
  if (!(index >= 0 && index < points.length)) throw modelError("outlinePointNotFound");
  if (points.length <= OUTLINE_MIN_POINTS) throw modelError("shortOutline");
  points.splice(index, 1);
  return updateOutline(project, outlineId, { points });
}

// ——— автопривязка метки к помещению ——————————————————————————————————
//
// Решение заказчика: «Подставлять автоматически, ручная правка главнее».
// Метка внутри контура получает его помещение сама, вне всех контуров — поле
// пустое. Метку, которой помещение вписали руками (`roomManual`), автоматика
// не трогает больше никогда: ни при перемещении, ни при перерисовке контура.
// Вписано ли помещение метки руками. Объекты, размеченные до появления
// контуров, признака не знают вовсе — и там помещение могло взяться только
// из рук: такую метку автоматика тоже не трогает, иначе первая же правка
// старого объекта стёрла бы всю работу со списком меток.
export function markRoomManual(mark) {
  if (!mark) return false;
  return mark.roomManual === undefined ? Boolean(mark.roomId) : Boolean(mark.roomManual);
}

export function applyRoomOutlines(project, schemeId) {
  const changed = [];
  const marks = project.marks.map((mark) => {
    if (markRoomManual(mark)) return mark;
    if (schemeId && mark.schemeId !== schemeId) return mark;
    const point = Array.isArray(mark.points) && mark.points.length > 0 ? mark.points[0] : null;
    const roomId = point ? roomAtPoint(project, mark.schemeId, point) : null;
    if ((mark.roomId || null) === roomId) return mark;
    changed.push(mark.id);
    return { ...mark, roomId };
  });
  if (changed.length === 0) return { project, changed };
  return { project: withProject(project, { marks }), changed };
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
    // Пунктир — свойство обозначения, а не отдельной метки: по нему легенда и
    // отличает условную линию от трека.
    lineStyle: (type && type.lineStyle) || (category && category.lineStyle) || "solid",
  };
}

// ——— оборудование ————————————————————————————————————————————————————
//
// Две разные вещи, и заказчик их разделил сам. Модель — это товар в справочнике
// объекта: «Shelly 1PM», одна модель стоит на многих метках, и по ней считается
// закупка. Размещённая единица — «одна штука тут»: модель, метка места и связи
// с другими метками (реле стоит в щите, а связано со светильниками и
// выключателем). Поля модели — только то, чем заказывают: название,
// производитель, артикул.

function equipmentOf(project) {
  return project && Array.isArray(project.equipment) ? project.equipment : [];
}

function placementsOf(project) {
  return project && Array.isArray(project.placements) ? project.placements : [];
}

export function equipmentInOrder(project) {
  return equipmentOf(project)
    .map((item, index) => ({ item, order: item.order == null ? index : item.order, index }))
    .sort((a, b) => (a.order === b.order ? a.index - b.index : a.order - b.order))
    .map((entry) => entry.item);
}

export function findEquipment(project, equipmentId) {
  return equipmentOf(project).find((item) => item.id === equipmentId) || null;
}

export function findPlacement(project, placementId) {
  return placementsOf(project).find((item) => item.id === placementId) || null;
}

function requireEquipment(project, equipmentId) {
  const item = findEquipment(project, equipmentId);
  if (!item) throw modelError("equipmentNotFound");
  return item;
}

function requirePlacement(project, placementId) {
  const item = findPlacement(project, placementId);
  if (!item) throw modelError("placementNotFound");
  return item;
}

// Необязательное поле — пустая строка, а не «иногда undefined»: его печатают
// в таблице закупки.
function equipmentText(value) {
  return String(value == null ? "" : value).trim();
}

export function addEquipment(project, { name, vendor, code } = {}) {
  const item = {
    id: newId(),
    name: normalizeName(name),
    vendor: equipmentText(vendor),
    code: equipmentText(code),
    order: equipmentOf(project).length,
  };
  return { project: withProject(project, { equipment: [...equipmentOf(project), item] }), equipment: item };
}

export function updateEquipment(project, equipmentId, patch = {}) {
  const current = requireEquipment(project, equipmentId);
  const next = { ...current };
  if (Object.prototype.hasOwnProperty.call(patch, "name")) next.name = normalizeName(patch.name);
  if (Object.prototype.hasOwnProperty.call(patch, "vendor")) next.vendor = equipmentText(patch.vendor);
  if (Object.prototype.hasOwnProperty.call(patch, "code")) next.code = equipmentText(patch.code);
  if (Object.prototype.hasOwnProperty.call(patch, "order")) next.order = patch.order;
  const equipment = equipmentOf(project).map((item) => (item.id === equipmentId ? next : item));
  return { project: withProject(project, { equipment }), equipment: next };
}

// Сколько штук этой модели размещено — это же и число к закупке.
export function equipmentUsage(project, equipmentId) {
  return placementsOf(project).filter((item) => item.equipmentId === equipmentId).length;
}

export function deleteEquipment(project, equipmentId) {
  const item = requireEquipment(project, equipmentId);
  const used = equipmentUsage(project, equipmentId);
  if (used > 0) throw modelError("equipmentInUse", { name: item.name, count: used });
  const equipment = equipmentOf(project)
    .filter((entry) => entry.id !== equipmentId)
    .map((entry, index) => ({ ...entry, order: index }));
  return { project: withProject(project, { equipment }), deleted: item };
}

// Связи единицы читают только отсюда: у единицы из старого файла поля нет.
export function placementLinkIds(placement) {
  return placement && Array.isArray(placement.links) ? placement.links : [];
}

export function placementsInOrder(project) {
  return placementsOf(project);
}

// Что стоит на этой метке и что с ней связано — два разных вопроса.
export function placementsAt(project, markId) {
  return placementsOf(project).filter((item) => item.markId === markId);
}

export function placementsLinkedTo(project, markId) {
  return placementsOf(project).filter((item) => placementLinkIds(item).includes(markId));
}

function placementLinks(project, links, markId) {
  const wanted = [];
  for (const id of Array.isArray(links) ? links : []) {
    requireMark(project, id);
    if (id !== markId && !wanted.includes(id)) wanted.push(id);
  }
  return wanted;
}

export function addPlacement(project, { equipmentId, markId, links } = {}) {
  requireEquipment(project, equipmentId);
  requireMark(project, markId);
  const placement = {
    id: newId(),
    equipmentId,
    markId,
    links: placementLinks(project, links, markId),
  };
  return {
    project: withProject(project, { placements: [...placementsOf(project), placement] }),
    placement,
  };
}

export function updatePlacement(project, placementId, patch = {}) {
  const current = requirePlacement(project, placementId);
  const next = { ...current };
  if (Object.prototype.hasOwnProperty.call(patch, "equipmentId")) {
    requireEquipment(project, patch.equipmentId);
    next.equipmentId = patch.equipmentId;
  }
  if (Object.prototype.hasOwnProperty.call(patch, "markId")) {
    requireMark(project, patch.markId);
    next.markId = patch.markId;
  }
  if (Object.prototype.hasOwnProperty.call(patch, "links")) {
    next.links = placementLinks(project, patch.links, next.markId);
  }
  const placements = placementsOf(project).map((item) => (item.id === placementId ? next : item));
  return { project: withProject(project, { placements }), placement: next };
}

export function deletePlacement(project, placementId) {
  const placement = requirePlacement(project, placementId);
  const placements = placementsOf(project).filter((item) => item.id !== placementId);
  return { project: withProject(project, { placements }), deleted: placement };
}

// Метка ушла — с ней уходят стоящие на ней единицы (стоять им негде) и ссылки
// на неё в связях соседних единиц.
function dropPlacements(project, removed) {
  if (removed.size === 0) return placementsOf(project);
  return placementsOf(project)
    .filter((item) => !removed.has(item.markId))
    .map((item) => {
      const links = placementLinkIds(item);
      if (!links.some((id) => removed.has(id))) return item;
      return { ...item, links: links.filter((id) => !removed.has(id)) };
    });
}

// ——— проверка объекта —————————————————————————————————————————————————

// Вид проблемы: «error» — объект поломан, «warning» — сделано намеренно, но
// стоит увидеть. Повтор номера — единственное предупреждение: запрещать его
// нельзя, молчать о нём тоже.
function problem(code, vars, ref, kind) {
  return { code, message: text("problems." + code, vars), ref: ref || null, kind: kind || "error" };
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

  const behindTypes = new Map();
  for (const mark of project.marks) {
    const type = findType(project, mark.typeId);
    if (!type) problems.push(problem("markWithoutType", null, mark.id));
    if (!findScheme(project, mark.schemeId)) problems.push(problem("markWithoutScheme", null, mark.id));
    if (mark.roomId && !findRoom(project, mark.roomId)) problems.push(problem("markWithoutRoom", null, mark.id));
    if (!Array.isArray(mark.points) || mark.points.length === 0) problems.push(problem("emptyPoints", null, mark.id));
    else if (mark.kind === "line" && mark.points.length < 2) problems.push(problem("shortLine", null, mark.id));

    for (const controlled of markControlIds(mark)) {
      if (!findMark(project, controlled)) problems.push(problem("controlsMissing", null, mark.id));
    }

    if (type) {
      const counter = project.counters[type.code] || 0;
      if (mark.number > counter) behindTypes.set(type.id, type.code);
    }
  }

  // Отставший счётчик — свойство типа, а не каждой его метки.
  for (const [id, code] of behindTypes) problems.push(problem("counterBehind", { code }, id));

  // Повтор номера — приём заказчика, а не поломка: одно предупреждение на
  // обозначение, с числом меток, чтобы случайный дубль было видно.
  for (const item of repeatedNumbers(project)) {
    problems.push(problem("repeatedNumber", { label: item.label, count: item.count }, item.markIds[0], "warning"));
  }

  for (const outline of outlinesOf(project)) {
    if (!findScheme(project, outline.schemeId)) problems.push(problem("outlineWithoutScheme", null, outline.id));
    if (!findRoom(project, outline.roomId)) problems.push(problem("outlineWithoutRoom", null, outline.id));
    if (!Array.isArray(outline.points) || outline.points.length < OUTLINE_MIN_POINTS) {
      problems.push(problem("shortOutline", null, outline.id));
    }
  }

  for (const placement of placementsOf(project)) {
    if (!findEquipment(project, placement.equipmentId)) {
      problems.push(problem("placementWithoutEquipment", null, placement.id));
    }
    if (!findMark(project, placement.markId)) problems.push(problem("placementWithoutMark", null, placement.id));
    for (const link of placementLinkIds(placement)) {
      if (!findMark(project, link)) problems.push(problem("placementLinkMissing", null, placement.id));
    }
  }

  for (const group of project.groups) {
    const members = group.markIds.map((markId) => findMark(project, markId)).filter(Boolean);
    if (members.length < 2) problems.push(problem("smallGroup", null, group.id));
    if (new Set(members.map((mark) => mark.schemeId)).size > 1) {
      problems.push(problem("groupAcrossSchemes", null, group.id));
    }
  }

  return problems;
}
