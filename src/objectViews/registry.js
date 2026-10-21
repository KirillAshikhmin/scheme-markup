// Реестр изображений объектов для развёртки (таск 135, требование G187;
// описания данными — таск 139, G198).
//
// Слова заказчика: «указывать на развёртке стен объекты на месте меток… найти
// для всех типов меток изображения минималистично схематические — контурные и
// располагать их на схеме цветом метки и рядом или прям поверх объекта, если
// большой (например кондиционер). То есть что бы схема была уже живая».
//
// На **плане** остаются условные знаки: там знак читают как обозначение, и его
// различимость выверена отпечатками (`shapes.test.js`). На **развёртке**
// человек смотрит на стену так, как она будет выглядеть, и кружок вместо
// кондиционера эту картину не достраивает.
//
// ——— почему контуры в коде, а не файлы рядом ———
//
// Заказчик разрешил файлы («svg файлы»), а потом уточнил: «не обязательно SVG —
// делай оптимально, но не зашивай все в один файл, что бы можно было легко
// менять и расширять список». Считаю по трём статьям:
//
//   **Цвет.** Контур обязан краситься цветом метки. У внешнего `<img>` цвет не
//   меняется ничем: пришлось бы либо тянуть файл текстом и разбирать его (то
//   есть всё равно рисовать кодом, только через загрузку), либо держать по
//   файлу на каждый цвет — а цвет у категории произвольный. Здесь это
//   `ctx.strokeStyle = color`, одна строка на все изображения.
//
//   **Выгрузка синхронная.** Лист развёрток рисуется одним проходом по холсту.
//   Внешняя картинка требует ожидания — ровно та беда, которую решали со
//   шрифтом (`drawFontReady`), и решать её пришлось бы в четырёх местах: PNG,
//   PDF, печать, архив. Нарисованный код ждать нечего.
//
//   **Сборка.** Каждый файл рядом — строка в офлайн-кэше `sw.js`, имя в
//   `assertLocalLinks` и повод для опечатки, которая молча оставит стену без
//   изображения. Тридцать изображений — тридцать таких поводов.
//
// А «легко менять и расширять» решается не форматом, а **раскладкой**: они
// лежат семьями по отдельным файлам (`power`, `light`, `climate`, `sense`,
// `net`, `things`), и добавить изображение — дописать запись в один файл.
// Привязка к форме знака лежит в самой записи (`shapes`), поэтому второго
// места, куда надо не забыть вписаться, нет.
//
// ——— откуда у типа изображение ———
//
// Лестница та же, что у цвета и формы (ADR 005), и третьего механизма не
// заводится:
//
//   1. `type.view` — имя изображения, записанное у типа. Стоит там же, где
//      умолчания размеров (G192), и заполнено в шаблоне ровно там, где форма
//      знака двусмысленна: ночник и выход канализации делят `circle-drain`,
//      осушитель и водорозетка — `drop-dot`.
//   2. форма знака (`style.shape`) — ключ, который уже есть **у чужого
//      объекта**. У заказчика в его 592 метках нет ни одного имени, но
//      форма проставлена: розетка `circle-socket`, кондиционер `circle-thermo`,
//      щит `square-hatch`. Поэтому его объект оживает без миграции.
//   3. ничего — развёртка рисует условный знак. Тип, заведённый руками, — это
//      не исключение, а обычная жизнь: справочник у каждого объекта свой.
//
// **Цена решения названа**: двенадцать типов света стартового справочника
// делят одну форму `circle-cross` и получают одно изображение светильника. Бра от
// точечного на развёртке не отличить — ровно настолько, насколько их не
// отличить и на плане.
import { VIEWS_CLIMATE } from "./climate.js";
import { VIEWS_LIGHT } from "./light.js";
import { VIEWS_NET } from "./net.js";
import { VIEWS_OBJECTS } from "./objects.js";
import { VIEWS_POWER } from "./power.js";
import { VIEWS_SENSE } from "./sense.js";
import { VIEWS_THINGS } from "./things.js";

// Семейство `objects` — вещи чертежа (таск 154): они живут в том же реестре,
// что изображения меток, и по той же причине, по какой в одном реестре живут
// их модели (`objectModels/registry.js`). Имя записи там и тут одно — ключ
// встроенного каталога, — и ни одного ключа два семейства не делят.
//
// **Семья названа ключом** (таск 218): по ней сетка выбора изображения
// раскладывает реестр разделами, и порядок разделов — порядок этого списка.
// Второго списка семей в сборке быть не должно: реестр — хозяин того, какие
// изображения есть и в каком они порядке.
const VIEW_FAMILIES = [
  ["power", VIEWS_POWER],
  ["light", VIEWS_LIGHT],
  ["climate", VIEWS_CLIMATE],
  ["sense", VIEWS_SENSE],
  ["net", VIEWS_NET],
  ["things", VIEWS_THINGS],
  ["objects", VIEWS_OBJECTS],
];

/** Ключи семей в порядке реестра. `objects` — вещи чертежа, остальные — метки. */
export const OBJECT_VIEW_FAMILIES = VIEW_FAMILIES.map(([family]) => family);

/** Семья вещей чертежа: её имена — ключи встроенного каталога, а не метки. */
export const OBJECT_VIEW_FAMILY_OBJECTS = "objects";

const ICONS = {};
const VIEW_CLASHES = [];
const BY_SHAPE = {};
const BY_FAMILY = {};
for (const [family, icons] of VIEW_FAMILIES) {
  BY_FAMILY[family] = [];
  for (const [name, icon] of Object.entries(icons)) {
    // Два семейства, занявшие одно имя, молча затёрли бы друг друга — и у
    // метки оказалось бы изображение дивана. Список пустой держит тест.
    if (ICONS[name]) VIEW_CLASHES.push(name);
    ICONS[name] = { name, family, ...icon };
    BY_FAMILY[family].push(name);
    for (const shape of icon.shapes || []) BY_SHAPE[shape] = name;
  }
}

/** Изображение по имени. `null` — такого имени нет. */
export function objectViewByName(name) {
  return name && ICONS[name] ? ICONS[name] : null;
}

/** Изображение по форме знака. `null` — у этой формы изображения нет. */
export function objectViewForShape(shape) {
  return objectViewByName(BY_SHAPE[shape]);
}

/** Все имена изображений — для справочника типов и для сверки отпечатками. */
export function objectViewNames() {
  return Object.keys(ICONS).sort();
}

/** Имена, занятые дважды. Пусто — иначе тест красный. */
export function objectViewClashes() {
  return [...VIEW_CLASHES];
}

/** Какие формы знаков уже разобраны по изображениям. */
export function objectViewShapes() {
  return Object.keys(BY_SHAPE).sort();
}

/**
 * Имена семьи в порядке объявления — для сетки выбора изображения (таск 218).
 *
 * Порядок именно объявления, а не алфавита: записи внутри файла семьи сложены
 * смыслом (розетки, выключатели, щиты), и алфавит эту раскладку перетасовал бы.
 */
export function objectViewFamily(family) {
  return [...(BY_FAMILY[family] || [])];
}

// Толщина контура — доля размера изображения, как у знаков на плане: тонкая линия
// на крупном кондиционере выглядела бы случайной царапиной.
const VIEW_LINE_SHARE = 0.055;
const VIEW_LINE_MIN = 0.9;

// Доля → точка холста. Радиусы меряются по короткой стороне: круг обязан
// остаться кругом на любом прямоугольнике.
const atX = (box, value) => box.x + (0.5 + value) * box.width;
const atY = (box, value) => box.y + (0.5 + value) * box.height;
const atR = (box, value) => value * Math.min(box.width, box.height);

/**
 * **Плоский интерпретатор описаний** (таск 139, G198): один проход по списку
 * примитивов изображения.
 *
 * Второй интерпретатор — объёмный — читает те же записи и ни одной из них не
 * требует переписывать: в этом вся затея. Поэтому здесь нет ни одной ветки
 * «а для такого-то изображения по-особенному»: разбор идёт по виду примитива,
 * и видов пять.
 */
function drawPart(ctx, box, part) {
  if (part.kind === "rect") {
    const left = atX(box, part.x);
    const top = atY(box, part.y);
    const right = atX(box, part.x + part.width);
    const bottom = atY(box, part.y + part.height);
    const r = Math.max(
      0,
      Math.min(atR(box, part.radius || 0), Math.min(Math.abs(right - left), Math.abs(bottom - top)) / 2),
    );
    ctx.beginPath();
    ctx.moveTo(left + r, top);
    ctx.lineTo(right - r, top);
    ctx.arcTo(right, top, right, top + r, r);
    ctx.lineTo(right, bottom - r);
    ctx.arcTo(right, bottom, right - r, bottom, r);
    ctx.lineTo(left + r, bottom);
    ctx.arcTo(left, bottom, left, bottom - r, r);
    ctx.lineTo(left, top + r);
    ctx.arcTo(left, top, left + r, top, r);
    ctx.closePath();
    ctx.stroke();
    return;
  }
  if (part.kind === "circle") {
    ctx.beginPath();
    ctx.arc(atX(box, part.cx), atY(box, part.cy), atR(box, part.r), 0, Math.PI * 2);
    ctx.stroke();
    return;
  }
  if (part.kind === "line") {
    ctx.beginPath();
    ctx.moveTo(atX(box, part.x1), atY(box, part.y1));
    ctx.lineTo(atX(box, part.x2), atY(box, part.y2));
    ctx.stroke();
    return;
  }
  if (part.kind === "arc") {
    ctx.beginPath();
    ctx.arc(atX(box, part.cx), atY(box, part.cy), atR(box, part.r), part.from, part.to);
    if (part.close) ctx.closePath();
    ctx.stroke();
    return;
  }
  if (part.kind === "poly") {
    ctx.beginPath();
    part.points.forEach(([x, y], index) => {
      if (index === 0) ctx.moveTo(atX(box, x), atY(box, y));
      else ctx.lineTo(atX(box, x), atY(box, y));
    });
    if (part.close) ctx.closePath();
    ctx.stroke();
  }
}

/**
 * Нарисовать изображение объекта в прямоугольник цветом метки.
 *
 * Контур и только контур: заливки нет нарочно. В чёрно-белом листе краска
 * становится тушью (`mono.js`), и залитое изображение превратилось бы в
 * чёрное пятно, из которого не читается ничего, — а контур остаётся контуром.
 *
 * Холст при этом **не масштабируется**: доли переводит в точки сам
 * интерпретатор, и толщина линии остаётся в точках, одинаковая во всех
 * направлениях даже у кондиционера три к одному.
 */
export function drawObjectView(ctx, icon, box, color) {
  if (!icon || !box || !(box.width > 0) || !(box.height > 0)) return;
  const size = Math.min(box.width, box.height);
  ctx.save();
  ctx.lineWidth = Math.max(VIEW_LINE_MIN, size * VIEW_LINE_SHARE);
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  for (const part of icon.parts || []) drawPart(ctx, box, part);
  ctx.restore();
}
