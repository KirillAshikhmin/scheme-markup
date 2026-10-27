// Рисование схемы и попадание по метке.
//
// Две системы координат. В объекте метки лежат долями плана (0…1) — так поворот
// и обрезка картинки не двигают разметку. На экране (и в экспорте) точка плана
// превращается в пиксели одной формулой planToScreen: смещение плюс доля,
// умноженная на размер плана и на масштаб.
//
// `view` для рисования — это `{zoom, offsetX, offsetY, markSize, labelSize}`:
// первые три приходят из состояния сеанса (`state.view`), последние два — из
// объекта (`project.view`), их двигает ползунок в панели инструментов. Размер
// метки задан в пикселях плана, поэтому метка живёт на плане как наклейка:
// приближение увеличивает и её, а экспорт в двойном разрешении даёт тот же вид.
import {
  BLOCK_LABEL_SEPARATOR,
  BLOCK_STEP_RATIO,
  DEFAULT_VIEW,
  LINE_STYLES,
  OPENING_GLASS_FRAME_MM,
  SHAPE_NAMES,
  blockLabel,
  blockLabelParts,
  blockMembers,
  findMark,
  findRoom,
  findWall,
  markDimensions,
  markWallNearest,
  markWallSideOn,
  repeatedNumbers,
  findType,
  findGroup,
  markControlIds,
  markCommentText,
  markControlLinks,
  markIsComment,
  markLabelLeader,
  markPointer,
  listedTypes,
  openingArchGeometry,
  openingFaceGrid,
  openingFamilyOf,
  openingFoldLinks,
  openingGlazed,
  openingHasLeaf,
  openingLeavesOf,
  openingMotionOf,
  openingsInWall,
  outlinesInOrder,
  planFractionToMm,
  planOriginOf,
  planPixelsPerMeter,
  pointInOutline,
  queryHit,
  queryNeedle,
  roomHasFloor,
  schemeHeightPx,
  schemeObjectCorners,
  schemeObjectKeyOf,
  schemeObjectNameOf,
  schemeObjectTopMm,
  schemeObjectsOnScheme,
  schemeWidthPx,
  segmentDistanceMm,
  styleOf,
  labelOf,
  typeKindOf,
  typesInOrder,
  wallGlassOf,
  wallHeightShownMm,
  wallNames,
  wallVectors,
  wallOwnHeightMm,
  wallsOnScheme,
} from "./model.js";
import { strings, text } from "./strings.js";
import { markBoxMm } from "./markBox.js";
import { lightFadeLive, lightFadeMemo, lightFadeOf } from "./lightFade.js";
import { markSpareLine } from "./markSpare.js";
import { drawObjectView, objectViewByName, objectViewForShape } from "./objectViews/registry.js";
import { objectStairKey, objectStairModel } from "./objectModels/stairs.js";

export const SHAPES = SHAPE_NAMES;

// ——— шрифт холста —————————————————————————————————————————————————————
//
// Ответов на «каким шрифтом» теперь два, и оба объявлены в `styles.css`
// переменными — своего списка семейств здесь нет ни одного (G172):
//
//   `draft`  — чертёжный ГОСТ (`--font-gost`). Бумага и выгрузка всегда он:
//              это чертёж по стандарту, выбора у него нет.
//   `system` — системный (`--font-ui`). Им живёт интерфейс, и его же человек
//              может поставить схеме на экране.
//
// **Умолчание — чертёжный, и это несущая часть замысла.** Выгрузка, печать и
// лист по ГОСТ зовут `drawFont(size, weight)` без третьего довода и получают
// чертёжный, ничего не зная про настройку. Чтобы бумага поехала за выбором
// глаз, пришлось бы дописать довод руками в каждом месте — а не забыть его
// вернуть, как было бы с глобальным переключателем.
export const FONT_DRAFT = "draft";
export const FONT_SYSTEM = "system";
export const FONT_KINDS = [FONT_DRAFT, FONT_SYSTEM];

// Вид шрифта -> переменная стилей. Больше имён семейств в коде нет.
const FONT_VARIABLE = {
  [FONT_DRAFT]: "--font-gost",
  [FONT_SYSTEM]: "--font-ui",
};

// Запасной список нужен там, где переменной взять негде: в Node (тесты
// геометрии холста не имеют) и до того, как стили применились. Текст в этом
// случае рисуется системным шрифтом, а не пропадает.
const DRAW_FONT_FALLBACK = 'system-ui, -apple-system, "Segoe UI", Arial, sans-serif';

/**
 * Семейства для `ctx.font` — значение переменной вида как есть.
 *
 * Ответ не запоминается: кадр спрашивает его один раз (`renderView` кладёт
 * результат во `view`, и дальше по кадру идёт уже готовая строка), а
 * запомненный намертво промах пережил бы и смену настройки, и дозагрузку
 * стилей. Незнакомый вид — чертёжный: чужое слово в настройке не должно
 * оставлять схему без шрифта.
 */
export function fontFamilyOf(kind) {
  const variable = FONT_VARIABLE[kind] || FONT_VARIABLE[FONT_DRAFT];
  if (typeof document === "undefined" || !document.documentElement) return DRAW_FONT_FALLBACK;
  if (typeof getComputedStyle !== "function") return DRAW_FONT_FALLBACK;
  const value = getComputedStyle(document.documentElement).getPropertyValue(variable).trim();
  return value || DRAW_FONT_FALLBACK;
}

/**
 * Строка для `ctx.font`: `drawFont(12)`, `drawFont(12, 600)` или
 * `drawFont(12, 600, family)`.
 *
 * Третий довод — **уже разобранные семейства**, а не вид: кадр разбирает их
 * один раз, а не на каждую подпись. Без него — чертёжный.
 */
export function drawFont(size, weight, family) {
  return (weight ? weight + " " : "") + size + "px " + (family || fontFamilyOf(FONT_DRAFT));
}

/**
 * Готовность файла шрифта.
 *
 * Холсту `@font-face` сам по себе не помогает: пока файл не дошёл, `ctx.font`
 * молча берёт запасной шрифт, и первый кадр плана остался бы системным до
 * первого движения мышью. Поэтому и холст, и выгрузка ждут этого обещания —
 * холст, чтобы перерисовать кадр, выгрузка, чтобы не положить в PNG не тот
 * шрифт. Не дождались (старый браузер, файла нет) — `false` и прежний вид:
 * падать из-за шрифта нельзя.
 *
 * Ждут всегда чертёжный: системный — это отказ от файла, ждать там нечего.
 */
export function drawFontReady() {
  const fonts = typeof document !== "undefined" && document ? document.fonts : null;
  if (!fonts || typeof fonts.load !== "function") return Promise.resolve(false);
  try {
    // `load` разбирает строку как сокращение `font` и на кривой бросает сразу,
    // не возвращая обещания, — отсюда try, а не только catch.
    return fonts
      .load(drawFont(16))
      .then(() => fonts.ready)
      .then(() => true)
      .catch(() => false);
  } catch {
    return Promise.resolve(false);
  }
}

// Доля радиуса, на которую внутренние вершины звезды ближе к центру.
const STAR_INNER = 0.45;
// Запас в пикселях вокруг метки, чтобы попадать по ней не идеально точно.
// Запас попадания мыши. Пальцу его мало: подушечка накрывает вчетверо больше
// экрана, чем остриё курсора, и ручка вершины под ней просто не видна. Поэтому
// каждая функция попадания берёт необязательный `slack` — сколько пикселей
// добавить сверх своей меры; сколько именно, решает холст по роду указателя
// (`canvasHitSlack`). Ноль по умолчанию — мышь считает как считала.
const HIT_SLACK_PX = 4;
// Доля кегля на знак — **запасная** оценка ширины подписи, для тестов в Node,
// где холста нет и мерить нечем. В браузере ширину меряет `labelTextWidth`.
// Оценка с запасом: 0,62 — про строчную латиницу, а коды заказчик пишет
// прописной кириллицей, которая шире примерно на шестую часть.
const LABEL_CHAR_RATIO = 0.75;
// Кегль замера. Строка меряется один раз на этом кегле, а ширина на любом
// другом — пропорцией: раскладка считает подписи в пикселях плана, рамка — в
// пикселях экрана, и разойтись им нельзя.
const LABEL_MEASURE_PX = 100;
// Замер на 100 px → доля кегля, по шрифту и строке.
const labelMeasureCache = new Map();
// Семейства, файл которых уже дошёл: дальше `fonts.check` их не спрашивают.
const labelMeasureLoaded = new Set();
let labelMeasureCtx = null;

// Контекст для замера — свой, не кадра: подписи меряют и попадание по клику, и
// раскладка, у которых холста на руках нет. Нет ни `OffscreenCanvas`, ни
// `document` (Node) — `null`, и ширина берётся оценкой.
function labelMeasureContext() {
  if (labelMeasureCtx) return labelMeasureCtx;
  try {
    let ctx = null;
    if (typeof OffscreenCanvas === "function") ctx = new OffscreenCanvas(1, 1).getContext("2d");
    else if (typeof document !== "undefined" && document && typeof document.createElement === "function") {
      const canvas = document.createElement("canvas");
      ctx = canvas && typeof canvas.getContext === "function" ? canvas.getContext("2d") : null;
    }
    if (ctx && typeof ctx.measureText === "function") labelMeasureCtx = ctx;
  } catch {
    labelMeasureCtx = null;
  }
  return labelMeasureCtx;
}

/**
 * Дошёл ли файл шрифта. Пока нет, `measureText` меряет запасным шрифтом: такой
 * замер не запоминается, а раскладка подписей держит этот признак в ключе —
 * иначе первая раскладка, посчитанная до прихода шрифта, пережила бы его.
 */
export function labelMeasureReady(family) {
  const key = family || "";
  if (labelMeasureLoaded.has(key)) return true;
  const fonts = typeof document !== "undefined" && document ? document.fonts : null;
  if (!fonts || typeof fonts.check !== "function") return true;
  let ready = true;
  try {
    ready = fonts.check(drawFont(LABEL_MEASURE_PX, null, family));
  } catch {
    ready = true;
  }
  if (ready) labelMeasureLoaded.add(key);
  return ready;
}

/**
 * Ширина строки подписи на кегле `font`, тем шрифтом, которым она рисуется.
 *
 * Было по числу знаков (`LABEL_CHAR_RATIO`) — и рамка выходила почти вдвое
 * шире текста узкого чертёжного шрифта. Слова заказчика: «у текста меток место
 * под текст выделяется больше, чем сам текст занимает» — ручки поворота и
 * поводка стояли у края пустой рамки, плашка комментария была «сильно больше»
 * текста, а подпись слева от метки отходила от неё на лишнюю ширину.
 */
export function labelTextWidth(text, font, family, weight) {
  const value = String(text == null ? "" : text);
  const ctx = labelMeasureContext();
  if (!ctx) return [...value].length * font * LABEL_CHAR_RATIO;
  const key = (weight || "") + "|" + (family || "") + "|" + value;
  let unit = labelMeasureCache.get(key);
  if (unit === undefined) {
    ctx.font = drawFont(LABEL_MEASURE_PX, weight, family);
    unit = ctx.measureText(value).width / LABEL_MEASURE_PX;
    if (labelMeasureReady(family)) labelMeasureCache.set(key, unit);
  }
  return unit * font;
}
// Насколько далеко от метки стоит подпись, если её не оттаскивали. Отдан
// наружу: холст ставит подпись на то же место, когда её берут мышью.
export const LABEL_GAP = 1.5;

/**
 * Кегль чертёжного шрифта по ГОСТ 2.304 — 3,5 мм. Одно число на всё, что
 * уходит на бумагу: подписи развёртки, графы штампа и таблица на листе.
 *
 * Живёт здесь, а не в `gostSheet.js`, где остальная бумажная метрика, потому
 * что `gostSheet` тянет из `render.js`, а не наоборот: обратная ссылка была бы
 * кольцом, а кольца сборка не терпит. До таска 173 это число стояло в трёх
 * файлах порознь — и расхождение попало бы на бумагу заказчика.
 */
export const GOST_TEXT_MM = 3.5;
// Ручки «+» стоят от центра метки на столько её радиусов — ровно на шаг блока,
// потому что новая метка встаёт **туда, где нарисована ручка**. Мера одна, и
// живёт она в модели (`BLOCK_STEP_RATIO`): свои 2,4 здесь однажды уже
// расходились с шагом, и метка садилась не под палец. Теперь это не обещание
// в комментарии, а одна константа на два места.
const HANDLE_GAP = BLOCK_STEP_RATIO;
const HANDLE_RADIUS = 9;

// Подсказка угла у курсора: кегль в экранных пикселях (это не часть плана, а
// подсказка руке), отступ от курсора и цвет для свободного направления.
const DRAFT_ANGLE_FONT = 12;
const DRAFT_ANGLE_GAP = 14;
const DRAFT_ANGLE_FREE = "#57606a";
// Короче этого отрезок ещё не направление, и градус у него случайный. Наружу
// — ради чертежа: он рисует свой черновик сам (свои миллиметры, своя толщина
// стены), а порог «отрезок ещё не направление» обязан быть один на две
// поверхности.
export const DRAFT_ANGLE_MIN_PX = 8;

// ——— чем курсор отвечает на вопрос «что случится, если я сейчас нажму» ——————
//
// **Одно правило на две плоские поверхности** (находка 6 разбора механик). Их
// ответы были противоположны: план знал только про режим (`default` в
// «Выделении», `crosshair` во всём остальном) и не спрашивал, что под рукой, —
// наведение на метку ничем не отличалось от пустого места, и что метку можно
// тащить, человек узнавал, только потащив. Чертёж наоборот: лестница по
// `workshopPick` и ни слова о занятии в наведении.
//
// Выбран ответ **и про режим, и про то, что под рукой**, в таком порядке:
//
// 1. панорама зажата (пробел, Shift, средняя кнопка) — `grab`: рука возит лист,
//    и что под ней, не значит ничего;
// 2. ждут точку (постановка, привязка, калибровка) — `crosshair`: клик
//    поставит точку, и что под ней, тоже не значит ничего. Поэтому попадание
//    в «Добавлении» не спрашивается — там оно не меняет ответа;
// 3. «Выделение» — отвечает то, что под рукой: вершина и ручка-кольцо тянутся
//    (`grab`), ручка и створка откликаются (`pointer`), тело едет (`move`);
// 4. пусто — `default`.
//
// Объёма это не касается: там курсор отдан прицелу, и это другое дело.
export const CURSOR_PAN = "grab";
export const CURSOR_PLACE = "crosshair";
export const CURSOR_PULL = "grab";
export const CURSOR_PRESS = "pointer";
export const CURSOR_MOVE = "move";
export const CURSOR_IDLE = "default";

/**
 * Имя курсора по тому, что сейчас под рукой и чем занята рука.
 *
 * Чистая и одна на холст и мастерскую: правило, записанное внутри двух
 * обработчиков, уже разошлось один раз.
 *
 * `pan` — панорама зажата; `place` — ждут точку; `pull`/`press`/`move` — что
 * под рукой в «Выделении».
 */
export function cursorFor(what = {}) {
  if (what.pan) return CURSOR_PAN;
  if (what.place) return CURSOR_PLACE;
  if (what.pull) return CURSOR_PULL;
  if (what.press) return CURSOR_PRESS;
  if (what.move) return CURSOR_MOVE;
  return CURSOR_IDLE;
}

// Направляющая: мелкий пунктир в волос толщиной и вполсилы. Узор мельче любого
// начертания метки — на пунктирной линии подсказку иначе не отличить от самого
// черновика.
const GUIDE_DASH = [2, 5];
// Направляющая пользователя: тонкая сплошная, приглушённая. Взятая под руку —
// ярче: двенадцать штук на плане не должны спорить с самим планом.
const GUIDE_LINE = "rgba(9, 105, 218, 0.38)";
const GUIDE_LINE_ACTIVE = "rgba(9, 105, 218, 0.85)";
// Направляющая, утащенная обратно на линейку: гаснет и рвётся — её снимут.
const GUIDE_DROP_DASH = [3, 4];
const GUIDE_DROP_ALPHA = 0.45;
const GUIDE_WIDTH = 1;
const GUIDE_ALPHA = 0.5;

// Размеры знака и подписи берутся у модели (`DEFAULT_VIEW`) — своих чисел тут
// быть не должно: стояли свои, и объект без поля `view` рисовался прежним,
// отвергнутым заказчиком кеглем (находка 3 разбора механик).
const RENDER_VIEW_DEFAULTS = {
  zoom: 1,
  offsetX: 0,
  offsetY: 0,
  markSize: DEFAULT_VIEW.markSize,
  labelSize: DEFAULT_VIEW.labelSize,
};

// Рамка легенды в высотах строки: отступ до текста, минимальная и предельная
// ширина. Предел — чтобы длинный код не растянул легенду на полплана.
const LEGEND_TEXT_EM = 2.2;
const LEGEND_MIN_EM = 16;
const LEGEND_MAX_EM = 34;

// Строка легенды по ширине рамки: остаток обрезается многоточием. Мерить
// нужно тем же `ctx`, которым будем рисовать, — шрифт уже выставлен.
function legendClip(ctx, value, limit) {
  if (ctx.measureText(value).width <= limit) return value;
  let cut = value;
  while (cut.length > 1 && ctx.measureText(cut + "…").width > limit) cut = cut.slice(0, -1);
  return cut + "…";
}

// Контур помещения: тонкая линия цветом комнаты и полупрозрачная заливка.
// На бумаге («pale») и линия, и заливка бледнее — контур там подсказка,
// а не главное на листе: главное — метки.
const OUTLINE_STYLE = {
  normal: { line: 1.6, fill: 0.1, label: 0.95 },
  pale: { line: 1, fill: 0.05, label: 0.6 },
};
// Шаг косой штриховки помещения **без пола** (таск 209, G317) и толщина её
// штриха — в экранных точках: это пометка на плане, а не величина объекта, и
// расти с масштабом ей незачем. Шаг крупный нарочно: мелкая сетка на бледной
// заливке читается грязью, а должна читаться «здесь дыра».
const OUTLINE_HATCH_PX = 14;
const OUTLINE_HATCH_LINE_PX = 1.2;
// Запас в пикселях, с которым попадают по стенке контура.
const OUTLINE_HIT_PX = 6;
// Радиус ручки вершины и ручки «+» на середине стенки.
const OUTLINE_HANDLE_PX = 6;
// Ручка на середине отрезка — та, что разбивает его. Меньше вершинной: она
// подсказка, а не вершина.
const PATH_INSERT_HANDLE_PX = 6;
// Короче этого отрезок ручки середины не получает — иначе три ручки сели бы
// друг на друга.
const PATH_INSERT_MIN_PX = 34;
// Ручка продолжения: за концом линии, на длину поводка от него. Отступ берётся
// тем же правилом, что у ручек «+» блока (`HANDLE_GAP` от размера метки), и не
// меньше своего минимума: у выделенной метки вокруг вершины нарисован пунктирный
// ореол, и ручка обязана выйти за него, а он растёт вместе с размером метки.
const PATH_EXTEND_HANDLE_PX = 7;
const PATH_EXTEND_GAP_PX = 26;
// Бледность ручки, на которую не навели. Бледнеет только рисунок ручки — белая
// подложка остаётся плотной, иначе на толстой линии ручку было бы не разглядеть.
const PATH_HANDLE_PALE = 0.55;
const OUTLINE_COLOR_FALLBACK = "#57606a";

// Полуширина узкого прямоугольника в градусах от полюса окружности.
const RECT_VERTICAL_ANGLE = 18;

// Углы вершин, градусы от «вверх». Все фигуры вписаны в окружность радиуса size.
const SHAPE_ANGLES = {
  square: [-135, -45, 45, 135],
  triangle: [-90, 30, 150],
  "triangle-down": [90, 210, 330],
  diamond: [-90, 0, 90, 180],
  hexagon: [-90, -30, 30, 90, 150, 210],
  // Узкий прямоугольник стоймя: те же четыре вершины на окружности, но
  // разведённые к полюсам. Угол в 18° даёт ширину примерно в треть высоты —
  // в размере метки просвет между длинными сторонами ещё виден, а знак уже
  // читается полосой, а не квадратом.
  "rect-vertical": [-90 - RECT_VERTICAL_ANGLE, -90 + RECT_VERTICAL_ANGLE, 90 - RECT_VERTICAL_ANGLE, 90 + RECT_VERTICAL_ANGLE],
  // Тот же прямоугольник лёжа: настенный блок — кондиционер, корпус техники.
  "rect-horizontal": [-RECT_VERTICAL_ANGLE, RECT_VERTICAL_ANGLE, 180 - RECT_VERTICAL_ANGLE, 180 + RECT_VERTICAL_ANGLE],
};

// Трапеция раструбом вниз: зонт вытяжки, луч проектора. Доли радиуса —
// полуширина верха, полуширина низа и половина высоты.
const TRAPEZOID_TOP = 0.42;
const TRAPEZOID_BOTTOM = 0.98;
const TRAPEZOID_HEIGHT = 0.72;

// Капля: остриё вверху, круглое тело внизу. Тело — окружность доли радиуса,
// касательные к ней из острия сходятся в точку, поэтому знак читается каплей,
// а не кругом с шипом.
const DROP_BODY = 0.72;
const DROP_STEPS = 16;

// Полукруг плоской стороной вниз: бра на стене. Центр дуги опущен, чтобы
// пятно стояло в середине знака, а не висело в его верхней половине.
const DOME_BASE = 0.35;

// Родня фигур: контур берётся у базовой, а отличает их засечка внутри.
// Так «розетка» и «розетка двойная» различаются в 14 пикселях, а на плане
// по-прежнему рисуются одним `drawShape`.
const SHAPE_BASE = {
  "circle-cross": "circle",
  "circle-slash": "circle",
  "circle-slash-two": "circle",
  "circle-chevron": "circle",
  "circle-wave": "circle",
  "circle-ring": "circle",
  "circle-socket": "circle",
  "square-jack": "square",
  "square-bolt": "square",
  "square-split": "square",
  "square-hatch": "square",
  "square-bar": "square",
  "square-bar-two": "square",
  "square-chevron": "square",
  "square-wave": "square",
  "triangle-dot": "triangle",
  "triangle-down-fill": "triangle-down",
  "diamond-dot": "diamond",
  "diamond-cross": "diamond",
  "circle-dot": "circle",
  "circle-fill": "circle",
  "circle-half": "circle",
  "square-cross": "square",
  "square-fill": "square",
  "diamond-fill": "diamond",
  // Оборудование: те же контуры, новая засечка внутри.
  "circle-bolt": "circle",
  "circle-triple": "circle",
  "circle-antenna": "circle",
  "circle-valve": "circle",
  "circle-drain": "circle",
  "circle-thermo": "circle",
  "circle-fan": "circle",
  "circle-rays": "circle",
  "circle-bar": "circle",
  "dome-dot": "dome",
  "rect-vertical-ticks": "rect-vertical",
  "rect-horizontal-ticks": "rect-horizontal",
  "square-ring": "square",
  "square-grid": "square",
  "drop-dot": "drop",
  "diamond-ring": "diamond",
  "trapezoid-dot": "trapezoid",
  "trapezoid-bar": "trapezoid",
};

// Засечка внутри: перекрестье, точка, сплошная заливка, залитая нижняя половина.
const SHAPE_DECOR = {
  "circle-cross": "cross",
  "circle-slash": "slash",
  "circle-slash-two": "slash-two",
  "circle-chevron": "chevron",
  "circle-wave": "wave",
  "circle-ring": "ring",
  "circle-socket": "socket",
  "square-jack": "jack",
  "square-bolt": "bolt",
  "square-split": "split",
  "square-hatch": "hatch",
  "square-bar": "bar",
  "square-bar-two": "bar-two",
  "square-chevron": "chevron-square",
  "square-wave": "wave",
  "triangle-dot": "dot",
  "triangle-down-fill": "fill",
  "diamond-dot": "dot",
  "diamond-cross": "cross",
  "square-cross": "cross",
  "circle-dot": "dot",
  "circle-fill": "fill",
  "square-fill": "fill",
  "diamond-fill": "fill",
  "circle-half": "half",
  "circle-bolt": "bolt",
  "circle-triple": "triple",
  "circle-antenna": "antenna",
  "circle-valve": "valve",
  "circle-drain": "drain",
  "circle-thermo": "thermo",
  "circle-fan": "fan",
  "circle-rays": "rays",
  "circle-bar": "bar-flat",
  "dome-dot": "dot",
  "rect-vertical-ticks": "ticks-horizontal",
  "rect-horizontal-ticks": "ticks-vertical",
  "square-ring": "ring",
  "square-grid": "grid",
  "drop-dot": "dot",
  "diamond-ring": "ring",
  "trapezoid-dot": "dot",
  "trapezoid-bar": "bar-flat",
};

// Засечки оборудования в долях радиуса. Числа подобраны по отпечатку в размере
// метки: мельче — знак сливается с соседом по палитре, крупнее — упирается в
// контур.
// Три отверстия трёхфазной розетки: по кругу, чтобы не спорить с двумя
// отверстиями обычной.
const TRIPLE_REACH = 0.46;
const TRIPLE_DOT = 0.3;
// Антенна телевизионной розетки: мачта и два уса.
const ANTENNA_FORK = -0.26;
const ANTENNA_BOTTOM = 0.66;
const ANTENNA_ARM = 0.54;
const ANTENNA_LIFT = 0.5;
// Бабочка запорного крана: два треугольника, сходящиеся в центре.
const VALVE_REACH = 0.62;
const VALVE_HALF = 0.46;
// Сток канализации: мачта и стрелка вниз.
const DRAIN_TOP = -0.7;
const DRAIN_BOTTOM = 0.3;
const DRAIN_ARM = 0.6;
// Термометр: столбик и колба.
const THERMO_TOP = -0.62;
const THERMO_BOTTOM = 0.02;
const THERMO_BULB = 0.4;
// Лопасти вентилятора: три луча из центра.
const FAN_REACH = 0.72;
const FAN_ANGLES = [-90, 30, 150];
// Люстра: подвес и три рожка.
const RAYS_BAR = -0.34;
const RAYS_REACH = 0.58;
const RAYS_DROP = 0.42;
// Черта поперёк знака: база робота, сушка.
const BAR_FLAT_REACH = 0.72;
const BAR_FLAT_WIDTH = 2.4;
const BAR_FLAT_DROP = 0.34;
// Четыре кнопки сценарной панели.
const GRID_REACH = 0.36;
const GRID_DOT = 0.22;
// Две засечки поперёк узкого корпуса: решётка колонки, лоток медиацентра.
const TICKS_REACH = 0.56;
const TICKS_HALF = 0.3;
const TICKS_WIDTH = 1.9;

// Доля радиуса, на которую отступает от края «талия» плюса.
const PLUS_WAIST = 0.36;
// Точка внутри знака: меньше — сливается с пустым кругом на распечатке.
const DOT_RADIUS = 0.42;

// Штрих и просвет пунктирной линии в долях радиуса метки: короче — на бумаге
// пунктир сливается в сплошную, длиннее — линия рвётся на отдельные палки.
const DASH_STROKE = 1.7;
const DASH_GAP = 1.1;

export function dashPattern(radius) {
  return [Math.max(2, radius * DASH_STROKE), Math.max(2, radius * DASH_GAP)];
}

// ——— начертания линии ————————————————————————————————————————————————
//
// Начертание выбирают по изображению, а значит различать его должен глаз, и
// не на экране, а на чёрно-белой распечатке в толщине линии метки. Поэтому
// каждое начертание описано числами в долях радиуса метки — и растёт вместе с
// ней, как пунктир: на выгрузке в двойном разрешении штрих остаётся тем же,
// что на экране.
//
// Описание — одно на всю сборку: по нему рисует холст и по нему же снимает
// отпечаток `test/lineStyle.test.js`. Это тот же приём, что у фигур
// (`shapeInternals`): правила закраски записаны один раз, и тест проверяет
// ровно то, что увидит бумага.
//
//   dash  — узор пунктира в долях радиуса (null — сплошная нитка);
//   rails — поперечные смещения ниток: одна нитка по центру или две у двойной;
//   wave  — деформация нитки: синус или пила, амплитуда и период в радиусах;
//   pen   — толщина пера в долях радиуса.
const LINE_STYLE_PLANS = {
  solid: { dash: null },
  // Прежний пунктир не трогается ни на волос: объекты с ним уже нарисованы,
  // и узор берётся из того же `dashPattern`.
  dashed: { dash: [DASH_STROKE, DASH_GAP] },
  // Длинный штрих вдвое длиннее обычного — на бумаге это видно сразу.
  "long-dash": { dash: [3.6, 2.1] },
  // Точка — штрих нулевой длины: круглый торец пера рисует её сам.
  dotted: { dash: [0, 1.4] },
  "dash-dot": { dash: [2, 1.2, 0, 1.2] },
  "dash-dot-dot": { dash: [2, 1.1, 0, 1.1, 0, 1.1] },
  // Двойная: две тонкие нитки с просветом между ними.
  double: { dash: null, rails: [-0.5, 0.5], pen: 0.26 },
  // Волна и зигзаг разведены нарочно: волна редкая и высокая, зигзаг частый и
  // низкий. Сблизь их — и на бумаге останется одна мохнатая линия.
  wave: { dash: null, wave: { kind: "sine", amplitude: 1.05, period: 4.4 } },
  zigzag: { dash: null, wave: { kind: "zigzag", amplitude: 0.5, period: 1.5 } },
  // Жирная: та же сплошная, но перо почти вдвое толще. На бумаге она читается
  // как «главная» линия — ствол трассы, магистраль.
  bold: { dash: null, pen: 0.95 },
  // Змейка: прямоугольная волна — греющий контур, уложенный петлями. От пилы
  // её отличает ступень, от синусоиды — угол; на распечатке это три разных
  // рисунка, а не один мохнатый.
  meander: { dash: null, wave: { kind: "meander", amplitude: 1.0, period: 3.2 } },
};

// Толщина пера линейной метки: половина радиуса, но не тоньше двух пикселей —
// иначе на отдалении линия исчезает.
const LINE_PEN = 0.5;
const LINE_PEN_MIN = 2;
// У двойной нитки тоньше и минимум свой: две нитки по два пикселя с просветом
// в один слились бы в жирную полосу.
const LINE_PEN_MIN_THIN = 1.2;

/** Начертание в пикселях: узор, нитки и волна для метки радиуса `radius`. */
export function lineStylePlan(style, radius) {
  const base = LINE_STYLE_PLANS[style] || LINE_STYLE_PLANS.solid;
  const rails = base.rails || [0];
  const pen = Math.max(rails.length > 1 ? LINE_PEN_MIN_THIN : LINE_PEN_MIN, radius * (base.pen || LINE_PEN));
  return {
    // Пунктир считается тем же `dashPattern`, что и прежде: у «dashed» это
    // буквально он, у остальных — тот же пересчёт долей в пиксели.
    dash: base.dash ? base.dash.map((part) => (part === 0 ? 0 : Math.max(2, radius * part))) : null,
    rails: rails.map((offset) => offset * radius),
    wave: base.wave
      ? { kind: base.wave.kind, amplitude: base.wave.amplitude * radius, period: base.wave.period * radius }
      : null,
    pen,
  };
}

// Длина ломаной и точка на ней по пройденному пути — обе нужны и волне, и
// отпечатку, поэтому считаются один раз.
function pathLength(points, closed) {
  let total = 0;
  const last = closed ? points.length : points.length - 1;
  for (let index = 0; index < last; index += 1) {
    const from = points[index];
    const to = points[(index + 1) % points.length];
    total += Math.hypot(to.x - from.x, to.y - from.y);
  }
  return total;
}

// Точка на ломаной по пройденному пути плюс направление в ней: по направлению
// откладывается поперечное смещение нитки.
function pathAt(points, closed, distance) {
  let left = Math.max(0, distance);
  const last = closed ? points.length : points.length - 1;
  for (let index = 0; index < last; index += 1) {
    const from = points[index];
    const to = points[(index + 1) % points.length];
    const length = Math.hypot(to.x - from.x, to.y - from.y);
    if (length === 0) continue;
    if (left <= length || index === last - 1) {
      const t = length === 0 ? 0 : left / length;
      return {
        x: from.x + (to.x - from.x) * t,
        y: from.y + (to.y - from.y) * t,
        nx: -(to.y - from.y) / length,
        ny: (to.x - from.x) / length,
      };
    }
    left -= length;
  }
  const only = points[0];
  return { x: only.x, y: only.y, nx: 0, ny: 1 };
}

// Сколько проб на период волнистой линии: реже — и синус превращается в ломаную.
const LINE_WAVE_STEPS = 12;

/**
 * Нитки начертания: по каждой холст ведёт перо одним `stroke`. Волна и зигзаг
 * — не узор пера, а деформация самой нитки, поэтому считаются здесь, а не
 * в `setLineDash`. Период подгоняется под длину линии целым числом волн:
 * иначе линия обрывалась бы на полугорбе, и две одинаковые метки выглядели бы
 * по-разному только оттого, что одну провели на пиксель длиннее.
 */
export function lineStyleThreads(points, closed, plan) {
  const list = (points || []).filter(Boolean);
  if (list.length < 2) return [];
  const spine = plan && plan.wave ? waveSpine(list, closed, plan.wave) : list;
  const rails = (plan && plan.rails) || [0];
  if (rails.length === 1 && rails[0] === 0) return [spine];
  return rails.map((offset) => railOf(spine, closed, offset));
}

function waveSpine(points, closed, wave) {
  const total = pathLength(points, closed);
  if (total <= 0 || wave.period <= 0) return points;
  const waves = Math.max(1, Math.round(total / wave.period));
  if (wave.kind === "meander") {
    // Прямоугольная волна: петля греющего контура. Каждый полупериод ведётся
    // отдельным отрезком на своём уровне, а между ними перо идёт поперёк —
    // отсюда ступень вместо пилы.
    const steps = waves * 2;
    const spine = [];
    for (let index = 0; index < steps; index += 1) {
      const level = (index % 2 === 0 ? 1 : -1) * wave.amplitude;
      const from = pathAt(points, closed, (total * index) / steps);
      const to = pathAt(points, closed, (total * (index + 1)) / steps);
      spine.push({ x: from.x + from.nx * level, y: from.y + from.ny * level });
      spine.push({ x: to.x + to.nx * level, y: to.y + to.ny * level });
    }
    return spine;
  }
  const period = total / waves;
  // У зигзага пробы стоят ровно в вершинах пилы — иначе углы срезаются.
  const steps = wave.kind === "zigzag" ? waves * 2 : waves * LINE_WAVE_STEPS;
  const spine = [];
  for (let index = 0; index <= steps; index += 1) {
    const distance = (total * index) / steps;
    const at = pathAt(points, closed, distance);
    const phase = (distance / period) * Math.PI * 2;
    const shift =
      wave.kind === "zigzag"
        ? wave.amplitude * (index % 2 === 0 ? 0 : 1) * (Math.floor(index / 2) % 2 === 0 ? 1 : -1)
        : wave.amplitude * Math.sin(phase);
    spine.push({ x: at.x + at.nx * shift, y: at.y + at.ny * shift });
  }
  return spine;
}

// Нитка, сдвинутая поперёк на `offset`: вершина двигается по усреднённой
// нормали соседних отрезков, поэтому на изломе нитки не расходятся.
function railOf(points, closed, offset) {
  if (offset === 0) return points;
  const normals = [];
  const last = closed ? points.length : points.length - 1;
  for (let index = 0; index < last; index += 1) {
    const from = points[index];
    const to = points[(index + 1) % points.length];
    const length = Math.hypot(to.x - from.x, to.y - from.y) || 1;
    normals.push({ nx: -(to.y - from.y) / length, ny: (to.x - from.x) / length });
  }
  return points.map((point, index) => {
    const before = normals[(index - 1 + normals.length) % normals.length];
    const after = normals[Math.min(index, normals.length - 1)];
    const first = index === 0 && !closed ? after : before;
    const nx = (first.nx + after.nx) / 2;
    const ny = (first.ny + after.ny) / 2;
    const length = Math.hypot(nx, ny) || 1;
    return { x: point.x + (nx / length) * offset, y: point.y + (ny / length) * offset };
  });
}

// Линейная метка и её черновик рисуются одним кодом: начертание на плане, в
// PNG и на распечатке обязано быть одним и тем же.
function strokeStyledLine(ctx, points, closed, style, radius, color) {
  const plan = lineStylePlan(style, radius);
  const threads = lineStyleThreads(points, closed, plan);
  if (threads.length === 0) return;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = plan.pen;
  // Пунктир задан в пикселях плана и растёт с масштабом вместе с меткой:
  // на выгрузке в двойном разрешении штрих остаётся тем же, что на экране.
  if (plan.dash) ctx.setLineDash(plan.dash);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const thread of threads) {
    ctx.beginPath();
    thread.forEach((point, index) => (index === 0 ? ctx.moveTo(point.x, point.y) : ctx.lineTo(point.x, point.y)));
    // Волна замыкается сама: её последняя проба совпала с первой, поэтому
    // замыкание здесь ничего не дорисовывает, а у прямой нитки — дорисовывает.
    if (closed) ctx.closePath();
    ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.restore();
}

/**
 * Образец начертания для сетки выбора и строки справочника: тот же код, что
 * рисует линию на плане, на маленьком холсте. Одна функция на весь интерфейс —
 * в справочнике видно ровно то, что попадёт на план.
 */
export function lineStyleIcon(style, color, size = 22, length = size * 3) {
  const canvas = document.createElement("canvas");
  canvas.className = "line-icon";
  canvas.width = length;
  canvas.height = size;
  const ctx = canvas.getContext ? canvas.getContext("2d") : null;
  if (!ctx) return canvas;
  const radius = size * 0.34;
  const pad = Math.max(3, radius * 0.6);
  strokeStyledLine(
    ctx,
    [
      { x: pad, y: size / 2 },
      { x: length - pad, y: size / 2 },
    ],
    false,
    style,
    radius,
    color,
  );
  return canvas;
}

// Узнаваемые значки собраны из тех же кирпичей, что и старые засечки: отрезки,
// круг, прямоугольник. Ни шрифтов, ни эмодзи — знак обязан выглядеть одинаково
// на экране, в PNG и на распечатке, а чужой шрифт этого не обещает.
// Числа подобраны под настоящий размер метки (радиус около пяти пикселей на
// бумаге): в этом размере их и различает отпечаток из test/shapes.test.js.
// Клавиша выключателя: наклонный рычаг во весь знак. Короче — и на бумаге
// он перестаёт отличаться от пустого круга: отпечаток считает это слиянием.
const LEVER_REACH = 1;
// Наклон рычага, градусы от горизонтали.
const LEVER_ANGLE = 70;
// Две клавиши: два рычага короче, разведённые поперёк на столько радиусов.
const LEVER_PAIR_GAP = 0.34;
const LEVER_PAIR_REACH = 0.62;
// Переключатель: уголок, раскрытый вправо.
const CHEVRON_REACH = 0.62;
// Тот же уголок внутри квадрата. Числа свои и заданы в долях полустороны
// (r/√2), а не радиуса: в квадрате места меньше, чем в круге, и уголок круга
// упирался бы концами прямо в углы квадрата. Уголок квадрата короче, толще и
// с просветом до края — на бумаге он читается знаком внутри рамки, а не
// заливкой, которая срослась с контуром.
const SQUARE_CHEVRON_BACK_X = 0.6;
const SQUARE_CHEVRON_TIP_X = 0.62;
const SQUARE_CHEVRON_REACH_Y = 0.64;
const SQUARE_CHEVRON_WIDTH = 1.45;
// Беспроводная точка: волны над точкой у нижнего края знака.
const WAVE_BASE = 0.5;
const WAVE_RADII = [0.5, 0.92];
const WAVE_FROM = 205;
const WAVE_TO = 335;
const WAVE_STEPS = 5;
// Кольцо внутри знака: доля радиуса, на которой оно идёт.
const RING_SHARE = 0.55;
const RING_POINTS = 12;
// Молния: полуразмах и полувысота в долях радиуса.
const BOLT_WIDE = 0.72;
const BOLT_TALL = 0.82;
// Пара контактов: полудлина черты и просвет между ними в долях радиуса.
const SPLIT_REACH = 0.62;
const SPLIT_GAP = 0.22;
// Штриховка: полудлина черты и её ряды в долях радиуса.
const HATCH_REACH = 0.46;
const HATCH_ROWS = [-0.3, 0, 0.3];
// Клавиши выключателя: вертикальные черты, делящие квадрат. Одна черта — две
// клавиши, две черты — три; так выключатель и выглядит в жизни. Черта идёт от
// края до края квадрата (полусторона — r/√2) и толще обычной засечки: в
// размере метки тонкая короткая черта добавляет к пустому квадрату меньше
// краски, чем нужно отпечатку, чтобы счесть знаки разными.
const BAR_REACH = Math.SQRT1_2;
const BAR_WIDTH = 1.6;
// Пара клавиш рисуется тоньше одиночной: двум толстым чертам в размере метки
// не остаётся просветов, и квадрат с двумя чертами сливается в полосатое пятно,
// неотличимое от квадрата с одной. Краски у пары и так вдвое больше, поэтому
// тонкая черта отпечатку не мешает — на распечатке знаки расходятся.
const BAR_TWO_WIDTH = 1.0;
// Евророзетка: два контактных отверстия по сторонам от центра.
const SOCKET_GAP = 0.46;
const SOCKET_DOT = 0.3;
// Разъём Ethernet: корпус вилки и шнур вниз.
const JACK_WIDTH = 0.52;
const JACK_TOP = -0.55;
const JACK_HEIGHT = 0.75;

/**
 * `view` для рисования, приведённый к полному виду.
 *
 * Здесь же вид шрифта превращается в семейства — один раз на кадр: `drawScheme`
 * зовёт `renderView` в начале и дальше передаёт готовый `state` вниз, а не
 * спрашивает стили на каждую подпись. Уже разобранный `view` второй раз не
 * разбирается (`fontFamily` на месте), поэтому вложенные вызовы бесплатны.
 *
 * `fontKind` — поле кадра, а не объекта: его кладёт холст из личных настроек
 * браузера. Выгрузка его не передаёт и получает чертёжный.
 */
function renderView(view) {
  const merged = { ...RENDER_VIEW_DEFAULTS, ...(view || {}) };
  if (!(merged.zoom > 0)) merged.zoom = 1;
  // Негодный размер — это умолчание, а не `NaN`: растекание чужого `view`
  // приносило `markSize: undefined`, и радиус знака отвечал `NaN` — обводка
  // контура переставала замыкаться двойным кликом (таск 138). Холст от этого
  // защищается у себя (`canvasViewOf`), но защита обязана стоять и здесь:
  // выгрузка, лист ГОСТ и развёртка собирают `view` сами.
  if (!(merged.markSize > 0)) merged.markSize = RENDER_VIEW_DEFAULTS.markSize;
  if (!(merged.labelSize > 0)) merged.labelSize = RENDER_VIEW_DEFAULTS.labelSize;
  if (!merged.fontFamily) merged.fontFamily = fontFamilyOf(merged.fontKind || FONT_DRAFT);
  return merged;
}

function polarPoint(x, y, radius, degrees) {
  const angle = (degrees * Math.PI) / 180;
  return { x: x + radius * Math.cos(angle), y: y + radius * Math.sin(angle) };
}

// Геометрия фигуры в экранных пикселях: круг или список вершин плюс засечка,
// которую рисуют поверх контура.
function shapeGeometry(shape, x, y, size) {
  const radius = Math.max(1, size);
  const base = SHAPE_BASE[shape] || shape;
  const decor = SHAPE_DECOR[shape] || null;
  const shell = {
    cx: x,
    cy: y,
    r: radius,
    line: Math.max(1, radius * 0.22),
    cross: decor === "cross",
    decor: decor === "cross" ? null : decor,
  };

  if (base === "star") {
    const points = [];
    for (let index = 0; index < 10; index += 1) {
      const long = index % 2 === 0;
      points.push(polarPoint(x, y, long ? radius : radius * STAR_INNER, -90 + index * 36));
    }
    return { kind: "polygon", points, ...shell };
  }
  if (base === "plus") {
    // Двенадцать вершин: четыре конца по осям и «талия» между ними.
    const arm = radius;
    const waist = radius * PLUS_WAIST;
    const points = [
      { x: x - waist, y: y - arm },
      { x: x + waist, y: y - arm },
      { x: x + waist, y: y - waist },
      { x: x + arm, y: y - waist },
      { x: x + arm, y: y + waist },
      { x: x + waist, y: y + waist },
      { x: x + waist, y: y + arm },
      { x: x - waist, y: y + arm },
      { x: x - waist, y: y + waist },
      { x: x - arm, y: y + waist },
      { x: x - arm, y: y - waist },
      { x: x - waist, y: y - waist },
    ];
    return { kind: "polygon", points, ...shell };
  }
  if (base === "drop") {
    // Остриё вверху и круглое тело внизу: касательные из острия к телу сходятся
    // в точку, поэтому знак читается каплей, а не кругом с шипом.
    const body = radius * DROP_BODY;
    const center = { x, y: y + radius - body };
    const apex = { x, y: y - radius };
    const reach = center.y - apex.y;
    const touch = (Math.asin(Math.min(1, body / reach)) * 180) / Math.PI;
    const from = -90 + (90 - touch);
    const to = from + (360 - 2 * (90 - touch));
    const points = [apex];
    for (let step = 0; step <= DROP_STEPS; step += 1) {
      points.push(polarPoint(center.x, center.y, body, from + ((to - from) * step) / DROP_STEPS));
    }
    return { kind: "polygon", points, ...shell };
  }
  if (base === "dome") {
    // Полукруг плоской стороной вниз: бра на стене.
    const base_y = y + radius * DOME_BASE;
    const points = [];
    for (let step = 0; step <= DROP_STEPS; step += 1) {
      points.push(polarPoint(x, base_y, radius, 180 + (180 * step) / DROP_STEPS));
    }
    return { kind: "polygon", points, ...shell };
  }
  if (base === "trapezoid") {
    const top = radius * TRAPEZOID_TOP;
    const bottom = radius * TRAPEZOID_BOTTOM;
    const half = radius * TRAPEZOID_HEIGHT;
    return {
      kind: "polygon",
      points: [
        { x: x - top, y: y - half },
        { x: x + top, y: y - half },
        { x: x + bottom, y: y + half },
        { x: x - bottom, y: y + half },
      ],
      ...shell,
    };
  }
  const angles = SHAPE_ANGLES[base];
  if (angles) {
    return { kind: "polygon", points: angles.map((degrees) => polarPoint(x, y, radius, degrees)), ...shell };
  }
  return { kind: "circle", points: [], ...shell };
}

// Начинка знака: что закрашивается внутри контура и чем. Единственное описание
// закраски в сборке — по нему рисует `drawShape`, по нему же тест снимает
// отпечаток, так что разойтись правилам негде.
// `role` — смысл («сплошная», «половина», «точка», «крест»), `mask` — область
// краски: вся внутренность, прямоугольник, круг или линии заданной толщины.
// Кольцо ломаной: настоящей дуги в описании начинки нет, а отрезков хватает —
// на бумаге в размере метки двенадцать звеньев читаются кругом.
function ringSegments(geometry, share) {
  const radius = geometry.r * share;
  const segments = [];
  let previous = polarPoint(geometry.cx, geometry.cy, radius, 0);
  for (let step = 1; step <= RING_POINTS; step += 1) {
    const next = polarPoint(geometry.cx, geometry.cy, radius, (360 * step) / RING_POINTS);
    segments.push([previous, next]);
    previous = next;
  }
  return segments;
}

// Отрезок рычага: длина в долях радиуса, сдвиг поперёк. Наклон намеренно не
// сорок пять градусов — под ним рычаг ложится на луч креста, и на бумаге
// «круг с клавишей» перестаёт отличаться от «круга с крестом».
function leverSegment(geometry, reach, shift) {
  const angle = (LEVER_ANGLE * Math.PI) / 180;
  const along = { x: Math.cos(angle), y: -Math.sin(angle) };
  const across = { x: -along.y, y: along.x };
  const cx = geometry.cx + across.x * geometry.r * shift;
  const cy = geometry.cy + across.y * geometry.r * shift;
  const reachPx = geometry.r * reach;
  return [
    { x: cx - along.x * reachPx, y: cy - along.y * reachPx },
    { x: cx + along.x * reachPx, y: cy + along.y * reachPx },
  ];
}

function shapeInternals(geometry) {
  const parts = [];
  if (geometry.decor === "fill") {
    parts.push({ role: "fill", mask: "interior" });
  } else if (geometry.decor === "half") {
    // Залита нижняя половина: прямоугольник от центра вниз, обрезанный контуром.
    parts.push({
      role: "half",
      mask: "rect",
      x: geometry.cx - geometry.r,
      y: geometry.cy,
      width: geometry.r * 2,
      height: geometry.r,
    });
  } else if (geometry.decor === "dot") {
    parts.push({
      role: "dot",
      mask: "disc",
      cx: geometry.cx,
      cy: geometry.cy,
      r: Math.max(1, geometry.r * DOT_RADIUS),
    });
  }
  if (geometry.decor === "slash" || geometry.decor === "slash-two") {
    // Клавиша выключателя: наклонный рычаг. Две клавиши — два рычага рядом,
    // и на бумаге видно, одна их или две, без чтения буквы.
    const segments =
      geometry.decor === "slash"
        ? [leverSegment(geometry, LEVER_REACH, 0)]
        : [
            leverSegment(geometry, LEVER_PAIR_REACH, -LEVER_PAIR_GAP),
            leverSegment(geometry, LEVER_PAIR_REACH, LEVER_PAIR_GAP),
          ];
    parts.push({ role: geometry.decor, mask: "lines", width: geometry.line, segments });
  } else if (geometry.decor === "chevron") {
    // Переключатель: свет из двух мест, и знак показывает две стороны.
    const reach = geometry.r * CHEVRON_REACH;
    parts.push({
      role: "chevron",
      mask: "lines",
      width: geometry.line,
      segments: [
        [
          { x: geometry.cx - reach, y: geometry.cy - reach },
          { x: geometry.cx + reach, y: geometry.cy },
        ],
        [
          { x: geometry.cx + reach, y: geometry.cy },
          { x: geometry.cx - reach, y: geometry.cy + reach },
        ],
      ],
    });
  } else if (geometry.decor === "chevron-square") {
    // Тот же переключатель, вписанный в квадрат: уголок на две стороны.
    const half = geometry.r * Math.SQRT1_2;
    const back = half * SQUARE_CHEVRON_BACK_X;
    const tip = half * SQUARE_CHEVRON_TIP_X;
    const reach = half * SQUARE_CHEVRON_REACH_Y;
    parts.push({
      role: "chevron-square",
      mask: "lines",
      width: geometry.line * SQUARE_CHEVRON_WIDTH,
      segments: [
        [
          { x: geometry.cx - back, y: geometry.cy - reach },
          { x: geometry.cx + tip, y: geometry.cy },
        ],
        [
          { x: geometry.cx + tip, y: geometry.cy },
          { x: geometry.cx - back, y: geometry.cy + reach },
        ],
      ],
    });
  } else if (geometry.decor === "wave") {
    // Беспроводная точка: точка у нижнего края и волны над ней.
    const base = { x: geometry.cx, y: geometry.cy + geometry.r * WAVE_BASE };
    const segments = [];
    for (const share of WAVE_RADII) {
      const radius = geometry.r * share;
      let previous = polarPoint(base.x, base.y, radius, WAVE_FROM);
      for (let step = 1; step <= WAVE_STEPS; step += 1) {
        const angle = WAVE_FROM + ((WAVE_TO - WAVE_FROM) * step) / WAVE_STEPS;
        const next = polarPoint(base.x, base.y, radius, angle);
        segments.push([previous, next]);
        previous = next;
      }
    }
    parts.push({ role: "wave", mask: "lines", width: geometry.line, segments });
    parts.push({ role: "wave-dot", mask: "disc", cx: base.x, cy: base.y, r: Math.max(1, geometry.r * 0.22) });
  } else if (geometry.decor === "ring") {
    // Кольцо внутри круга: потолочный датчик — дыма, движения, присутствия.
    parts.push({ role: "ring", mask: "lines", width: geometry.line, segments: ringSegments(geometry, RING_SHARE) });
  } else if (geometry.decor === "bolt") {
    // Молния: силовая линия, автомат, вывод под мощную нагрузку.
    const wide = geometry.r * BOLT_WIDE;
    const tall = geometry.r * BOLT_TALL;
    parts.push({
      role: "bolt",
      mask: "lines",
      width: geometry.line,
      segments: [
        [
          { x: geometry.cx + wide, y: geometry.cy - tall },
          { x: geometry.cx - wide * 0.55, y: geometry.cy },
        ],
        [
          { x: geometry.cx - wide * 0.55, y: geometry.cy },
          { x: geometry.cx + wide * 0.55, y: geometry.cy },
        ],
        [
          { x: geometry.cx + wide * 0.55, y: geometry.cy },
          { x: geometry.cx - wide, y: geometry.cy + tall },
        ],
      ],
    });
  } else if (geometry.decor === "split") {
    // Знак разделён надвое: пара контактов — датчик открытия, геркон.
    const reach = geometry.r * SPLIT_REACH;
    const gap = geometry.r * SPLIT_GAP;
    parts.push({
      role: "split",
      mask: "lines",
      width: geometry.line,
      segments: [
        [
          { x: geometry.cx - reach, y: geometry.cy - gap },
          { x: geometry.cx + reach, y: geometry.cy - gap },
        ],
        [
          { x: geometry.cx - reach, y: geometry.cy + gap },
          { x: geometry.cx + reach, y: geometry.cy + gap },
        ],
      ],
    });
  } else if (geometry.decor === "bar" || geometry.decor === "bar-two") {
    // Клавиши выключателя: черта делит квадрат пополам, две черты — на три
    // равные части. Ровно так их и видят на стене, поэтому знак читается без
    // буквы рядом.
    const reach = geometry.r * BAR_REACH;
    const width = geometry.line * (geometry.decor === "bar" ? BAR_WIDTH : BAR_TWO_WIDTH);
    // Две черты делят квадрат на три равные части — равные по просвету, а не по
    // расстоянию между осями черт: считать от осей значило бы оставить средний
    // просвет уже крайних, а именно он и схлопывается первым.
    const third = (reach + width / 2) / 3;
    const offsets = geometry.decor === "bar" ? [0] : [-third, third];
    parts.push({
      role: geometry.decor,
      mask: "lines",
      width,
      segments: offsets.map((offset) => [
        { x: geometry.cx + offset, y: geometry.cy - reach },
        { x: geometry.cx + offset, y: geometry.cy + reach },
      ]),
    });
  } else if (geometry.decor === "socket") {
    // Евророзетка: два отверстия под контакты. Знак узнают по ним, а не по
    // букве рядом.
    const gap = geometry.r * SOCKET_GAP;
    const dot = Math.max(1, geometry.r * SOCKET_DOT);
    parts.push({ role: "socket", mask: "disc", cx: geometry.cx - gap, cy: geometry.cy, r: dot });
    parts.push({ role: "socket", mask: "disc", cx: geometry.cx + gap, cy: geometry.cy, r: dot });
  } else if (geometry.decor === "hatch") {
    // Штриховка: греющая площадь — тёплый пол, обогрев.
    const reach = geometry.r * HATCH_REACH;
    const segments = [];
    for (const share of HATCH_ROWS) {
      const y = geometry.cy + geometry.r * share;
      segments.push([
        { x: geometry.cx - reach, y },
        { x: geometry.cx + reach, y },
      ]);
    }
    parts.push({ role: "hatch", mask: "lines", width: geometry.line, segments });
  } else if (geometry.decor === "jack") {
    // Разъём: корпус вилки и шнур вниз — знак сетевой розетки.
    parts.push({
      role: "jack",
      mask: "rect",
      x: geometry.cx - geometry.r * JACK_WIDTH,
      y: geometry.cy + geometry.r * JACK_TOP,
      width: geometry.r * JACK_WIDTH * 2,
      height: geometry.r * JACK_HEIGHT,
    });
    parts.push({
      role: "jack-cord",
      mask: "lines",
      width: geometry.line,
      segments: [
        [
          { x: geometry.cx, y: geometry.cy + geometry.r * (JACK_TOP + JACK_HEIGHT) },
          { x: geometry.cx, y: geometry.cy + geometry.r * 0.72 },
        ],
      ],
    });
  } else if (geometry.decor === "triple") {
    // Трёхфазная розетка: три отверстия по кругу. Обычная евророзетка — два в
    // ряд, и на бумаге эти знаки не спутать.
    const reach = geometry.r * TRIPLE_REACH;
    const dot = Math.max(1, geometry.r * TRIPLE_DOT);
    for (const angle of [-90, 30, 150]) {
      const at = polarPoint(geometry.cx, geometry.cy, reach, angle);
      parts.push({ role: "triple", mask: "disc", cx: at.x, cy: at.y, r: dot });
    }
  } else if (geometry.decor === "antenna") {
    // Телевизионная розетка: мачта с усами.
    // Вилка усов смотрит вверх — так рисуют антенну. Вниз она читалась бы
    // стрелкой и спорила бы со стоком.
    const fork = geometry.cy + geometry.r * ANTENNA_FORK;
    const arm = geometry.r * ANTENNA_ARM;
    const lift = geometry.r * ANTENNA_LIFT;
    parts.push({
      role: "antenna",
      mask: "lines",
      width: geometry.line,
      segments: [
        [
          { x: geometry.cx, y: geometry.cy + geometry.r * ANTENNA_BOTTOM },
          { x: geometry.cx, y: fork },
        ],
        [
          { x: geometry.cx, y: fork },
          { x: geometry.cx - arm, y: fork - lift },
        ],
        [
          { x: geometry.cx, y: fork },
          { x: geometry.cx + arm, y: fork - lift },
        ],
      ],
    });
  } else if (geometry.decor === "valve") {
    // Бабочка запорного крана: два треугольника, сошедшиеся в центре.
    const reach = geometry.r * VALVE_REACH;
    const half = geometry.r * VALVE_HALF;
    parts.push({
      role: "valve",
      mask: "lines",
      width: geometry.line,
      segments: [
        [
          { x: geometry.cx - reach, y: geometry.cy - half },
          { x: geometry.cx - reach, y: geometry.cy + half },
        ],
        [
          { x: geometry.cx - reach, y: geometry.cy - half },
          { x: geometry.cx + reach, y: geometry.cy + half },
        ],
        [
          { x: geometry.cx - reach, y: geometry.cy + half },
          { x: geometry.cx + reach, y: geometry.cy - half },
        ],
        [
          { x: geometry.cx + reach, y: geometry.cy - half },
          { x: geometry.cx + reach, y: geometry.cy + half },
        ],
      ],
    });
  } else if (geometry.decor === "drain") {
    // Сток канализации: мачта со стрелкой вниз.
    const bottom = geometry.cy + geometry.r * DRAIN_BOTTOM;
    const arm = geometry.r * DRAIN_ARM;
    parts.push({
      role: "drain",
      mask: "lines",
      width: geometry.line,
      segments: [
        [
          { x: geometry.cx, y: geometry.cy + geometry.r * DRAIN_TOP },
          { x: geometry.cx, y: bottom },
        ],
        [
          { x: geometry.cx - arm, y: bottom - arm },
          { x: geometry.cx, y: bottom },
        ],
        [
          { x: geometry.cx + arm, y: bottom - arm },
          { x: geometry.cx, y: bottom },
        ],
      ],
    });
  } else if (geometry.decor === "thermo") {
    // Термометр: столбик и колба.
    parts.push({
      role: "thermo",
      mask: "lines",
      width: geometry.line,
      segments: [
        [
          { x: geometry.cx, y: geometry.cy + geometry.r * THERMO_TOP },
          { x: geometry.cx, y: geometry.cy + geometry.r * THERMO_BOTTOM },
        ],
      ],
    });
    parts.push({
      role: "thermo-bulb",
      mask: "disc",
      cx: geometry.cx,
      cy: geometry.cy + geometry.r * (THERMO_BOTTOM + THERMO_BULB * 0.7),
      r: Math.max(1, geometry.r * THERMO_BULB),
    });
  } else if (geometry.decor === "fan") {
    // Три лопасти из центра: вентилятор.
    const reach = geometry.r * FAN_REACH;
    parts.push({
      role: "fan",
      mask: "lines",
      width: geometry.line,
      segments: FAN_ANGLES.map((angle) => [
        { x: geometry.cx, y: geometry.cy },
        polarPoint(geometry.cx, geometry.cy, reach, angle),
      ]),
    });
  } else if (geometry.decor === "rays") {
    // Люстра: подвес и три рожка вниз.
    const bar = geometry.cy + geometry.r * RAYS_BAR;
    const reach = geometry.r * RAYS_REACH;
    const drop = geometry.cy + geometry.r * RAYS_DROP;
    parts.push({
      role: "rays",
      mask: "lines",
      width: geometry.line,
      segments: [
        [
          { x: geometry.cx - reach, y: bar },
          { x: geometry.cx + reach, y: bar },
        ],
        [
          { x: geometry.cx - reach, y: bar },
          { x: geometry.cx - reach, y: drop },
        ],
        [
          { x: geometry.cx, y: bar },
          { x: geometry.cx, y: drop },
        ],
        [
          { x: geometry.cx + reach, y: bar },
          { x: geometry.cx + reach, y: drop },
        ],
      ],
    });
  } else if (geometry.decor === "bar-flat") {
    // Черта поперёк знака: база робота-пылесоса, сушка.
    const reach = geometry.r * BAR_FLAT_REACH;
    parts.push({
      role: "bar-flat",
      mask: "lines",
      width: geometry.line * BAR_FLAT_WIDTH,
      segments: [
        [
          { x: geometry.cx - reach, y: geometry.cy + geometry.r * BAR_FLAT_DROP },
          { x: geometry.cx + reach, y: geometry.cy + geometry.r * BAR_FLAT_DROP },
        ],
      ],
    });
  } else if (geometry.decor === "ticks-vertical" || geometry.decor === "ticks-horizontal") {
    // Две засечки поперёк узкого корпуса: решётка колонки, лоток медиацентра.
    // Идут поперёк длинной стороны, поэтому засечка у лежачего корпуса стоит
    // стоймя, а у стоячего — лёжа.
    const reach = geometry.r * TICKS_REACH;
    const half = geometry.r * TICKS_HALF;
    const upright = geometry.decor === "ticks-vertical";
    parts.push({
      role: geometry.decor,
      mask: "lines",
      width: geometry.line * TICKS_WIDTH,
      segments: [-reach, 0, reach].map((offset) =>
        upright
          ? [
              { x: geometry.cx + offset, y: geometry.cy - half },
              { x: geometry.cx + offset, y: geometry.cy + half },
            ]
          : [
              { x: geometry.cx - half, y: geometry.cy + offset },
              { x: geometry.cx + half, y: geometry.cy + offset },
            ],
      ),
    });
  } else if (geometry.decor === "grid") {
    // Четыре кнопки сценарной панели.
    const reach = geometry.r * GRID_REACH;
    const dot = Math.max(1, geometry.r * GRID_DOT);
    for (const dx of [-reach, reach]) {
      for (const dy of [-reach, reach]) {
        parts.push({ role: "grid", mask: "disc", cx: geometry.cx + dx, cy: geometry.cy + dy, r: dot });
      }
    }
  }
  if (geometry.cross) {
    const arm = geometry.r * Math.SQRT1_2;
    parts.push({
      role: "cross",
      mask: "lines",
      width: geometry.line,
      segments: [
        [
          { x: geometry.cx - arm, y: geometry.cy - arm },
          { x: geometry.cx + arm, y: geometry.cy + arm },
        ],
        [
          { x: geometry.cx + arm, y: geometry.cy - arm },
          { x: geometry.cx - arm, y: geometry.cy + arm },
        ],
      ],
    });
  }
  return parts;
}

// Одна фигура — одним кодом и на экране, и в экспорте.
export function drawShape(ctx, shape, x, y, size, color) {
  const geometry = shapeGeometry(shape, x, y, size);
  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineWidth = geometry.line;
  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = color;
  ctx.beginPath();
  if (geometry.kind === "circle") {
    ctx.arc(geometry.cx, geometry.cy, geometry.r, 0, Math.PI * 2);
  } else {
    geometry.points.forEach((point, index) => {
      if (index === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    });
    ctx.closePath();
  }
  ctx.fill();
  ctx.stroke();
  // Заливка и засечка идут поверх белой подложки, контур — поверх них: так
  // фигура читается и на тёмной линии плана, и на чёрно-белой распечатке.
  for (const part of shapeInternals(geometry)) {
    if (part.mask === "interior") {
      ctx.fillStyle = color;
      ctx.fill();
      ctx.stroke();
    } else if (part.mask === "rect") {
      ctx.save();
      ctx.clip();
      ctx.fillStyle = color;
      ctx.fillRect(part.x, part.y, part.width, part.height);
      ctx.restore();
      ctx.stroke();
    } else if (part.mask === "disc") {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(part.cx, part.cy, part.r, 0, Math.PI * 2);
      ctx.fill();
    } else if (part.mask === "lines") {
      ctx.lineWidth = part.width;
      ctx.beginPath();
      for (const [from, to] of part.segments) {
        ctx.moveTo(from.x, from.y);
        ctx.lineTo(to.x, to.y);
      }
      ctx.stroke();
    }
  }
  ctx.restore();
}

// Значок фигуры для списков и сеток: тот же `drawShape` на маленьком холсте.
// Одна функция на весь интерфейс — в справочнике, в списке меток и в сетке
// выбора видно ровно то, что попадёт на план и на распечатку.
export function shapeIcon(shape, color, size = 22) {
  const canvas = document.createElement("canvas");
  canvas.className = "shape-icon";
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext ? canvas.getContext("2d") : null;
  if (ctx) drawShape(ctx, shape, size / 2, size / 2, size * 0.34, color);
  return canvas;
}

// Знак без цвета бывает у одной строки на всю сборку — у черновика нового
// типа, которому ещё не выбрали категорию. Тот же приглушённый серый, которым
// рисует его справочник: цвет знак всегда берёт у категории.
const SIGN_COLOR_FALLBACK = "#57606A";

/**
 * **Знак типа в интерфейсе — одна лестница на все окна** (дефект D31).
 *
 * У точечного типа обозначение — фигура, у линейного — начертание, и это
 * решает не окно, а вид типа. Пока каждое окно звало `shapeIcon` само,
 * линейные типы в окне выбора рисовались точками: заказчик увидел это как «тип
 * Линия не поддерживается» — у ПКШ в справочнике волна, а в окне выбора круг.
 *
 * Поэтому план знака считается здесь и только здесь: справочник, окно выбора
 * типа, плашка выбранного типа и окно общей базы берут его отсюда. Второго
 * места, где вид превращается в рисунок, быть не должно — именно на нём они и
 * разошлись.
 *
 * Вид спрашивается у `typeKindOf`, а не у `type.kind`: у объекта прежнего
 * формата поля нет вовсе, и вид выводится по его меткам.
 */
export function typeIconPlan(project, typeId) {
  const style = styleOf(project, typeId);
  return typeSignPlan({ kind: typeKindOf(project, typeId), ...style });
}

/**
 * То же, но по записи типа, которой в объекте ещё нет: строка окна «Добавить
 * из общей базы» и черновик строки справочника. Спросить `typeKindOf` о них
 * нельзя — их типа в объекте нет, — а рисоваться они обязаны так же.
 *
 * Третий вид (комментарий) здесь становится точкой: плашку комментария в
 * списках рисует её знак, а начертания у неё нет.
 */
export function typeSignPlan({ kind, shape, lineStyle, color }) {
  return {
    kind: kind === "line" ? "line" : "point",
    shape: shape || "circle",
    lineStyle: lineStyle || LINE_STYLES[0],
    color: color || SIGN_COLOR_FALLBACK,
  };
}

/** Нарисовать знак по плану: фигура точечного или образец линии линейного. */
export function typeSignIcon(plan, size = 22, length = size * 2) {
  return plan.kind === "line"
    ? lineStyleIcon(plan.lineStyle, plan.color, size, length)
    : shapeIcon(plan.shape, plan.color, size);
}

/** Знак типа объекта: план и рисунок одним вызовом — так его и зовут окна. */
export function typeIcon(project, typeId, size = 22, length = size * 2) {
  return typeSignIcon(typeIconPlan(project, typeId), size, length);
}

// ——— координаты —————————————————————————————————————————————————————

export function planToScreen(point, scheme, view) {
  const state = renderView(view);
  return {
    x: state.offsetX + point.x * schemeWidthPx(scheme) * state.zoom,
    y: state.offsetY + point.y * schemeHeightPx(scheme) * state.zoom,
  };
}

export function screenToPlan(point, scheme, view) {
  const state = renderView(view);
  return {
    x: (point.x - state.offsetX) / (schemeWidthPx(scheme) * state.zoom),
    y: (point.y - state.offsetY) / (schemeHeightPx(scheme) * state.zoom),
  };
}

// Радиус метки на экране: размер задан в пикселях плана и растёт с масштабом.
export function markRadius(view) {
  const state = renderView(view);
  return Math.max(2, state.markSize * state.zoom);
}

// Высота подписи метки в пикселях плана — пара к `markRadius`. Наружу она
// нужна листу по ГОСТ: формат бумаги подбирается по тому, останется ли подпись
// на ней читаемой (не мельче 2,5 мм).
export function labelFontSize(view) {
  const state = renderView(view);
  return Math.max(6, state.labelSize * state.zoom);
}

// Вписать план в прямоугольник холста.
export function fitView(scheme, viewport) {
  const width = schemeWidthPx(scheme);
  const height = schemeHeightPx(scheme);
  const boxWidth = Math.max(1, viewport.width);
  const boxHeight = Math.max(1, viewport.height);
  const zoom = Math.min(boxWidth / width, boxHeight / height) * 0.96;
  return {
    zoom,
    offsetX: (boxWidth - width * zoom) / 2,
    offsetY: (boxHeight - height * zoom) / 2,
  };
}

// ——— магнит направления и направляющие ————————————————————————————————
//
// Линиями рисуют ленту по периметру комнаты и треки, контурами — сами комнаты.
// Стены в квартире прямые, и от руки инженер каждый раз промахивается мимо
// горизонтали на пару градусов — на распечатке это видно. Магнит дотягивает
// почти ровное направление до ровного.
//
// Ровных направлений двенадцать пар: шаг 15°. Горизонталь и вертикаль — только
// часть работы, скосы в квартире идут через 45°, а эркер — через 15°, и
// рисовать их от руки так же неточно, как горизонталь. Порог — 4°: промах «на
// пару градусов» он забирает, а между соседними ровными направлениями остаётся
// 7° свободной руки, так что поставить отрезок мимо сетки по-прежнему можно.
// Совсем косые стены рисуются при снятом магните — это `free`, холст поднимает
// его с зажатого Alt.

// Шаг сетки ровных направлений, градусы.
export const SNAP_STEP_DEG = 15;

// Порог притяжения к ровному направлению, градусы.
export const SNAP_ANGLE_DEG = 4;

// Разброс, в пределах которого угол считается ровно ровным: проекция попадает
// в него с точностью плавающей арифметики, а не буква в букву.
const SNAP_ROUND_EPS = 0.01;

// Направляющая ловит курсор в этом радиусе — в пикселях экрана, а не в долях
// плана: иначе на разном масштабе притяжка вела бы себя по-разному.
export const GUIDE_SNAP_PX = 7;

// Угол направления в градусах: 0 — вправо, 90 — вверх, дальше против часовой.
// Экранный `y` растёт вниз, поэтому знак вертикали переворачивается здесь один
// раз — тот же угол читает и подсказка у курсора.
function segmentAngle(dx, dy) {
  const degrees = (Math.atan2(-dy, dx) * 180) / Math.PI;
  return (degrees + 360) % 360;
}

// Ровный ли это угол — с точностью до плавающей ошибки.
function roundAngle(angle) {
  const step = Math.abs(angle - Math.round(angle / SNAP_STEP_DEG) * SNAP_STEP_DEG);
  return step < SNAP_ROUND_EPS || Math.abs(step - SNAP_STEP_DEG) < SNAP_ROUND_EPS;
}

// Ортогональная проекция курсора на луч заданного направления, в пикселях
// плана. Притяжение — это проекция, а не поворот с сохранением длины: поворот
// увёл бы конец отрезка из-под руки.
function rayProject(from, to, scheme, degrees) {
  const straight = ((degrees % 360) + 360) % 360;
  // Горизонталь и вертикаль считаются присваиванием: та же проекция, но без
  // плавающей ошибки — продольная координата остаётся ровно под курсором.
  if (straight % 180 === 0) return { x: to.x, y: from.y };
  if (straight % 180 === 90) return { x: from.x, y: to.y };
  const width = schemeWidthPx(scheme);
  const height = schemeHeightPx(scheme);
  const radians = (straight * Math.PI) / 180;
  const ux = Math.cos(radians);
  const uy = -Math.sin(radians);
  const along = (to.x - from.x) * width * ux + (to.y - from.y) * height * uy;
  return { x: from.x + (along * ux) / width, y: from.y + (along * uy) / height };
}

// Направление отрезка `from → to` и точка, притянутая к ровному направлению.
// Считается в пикселях плана: план бывает 1000×500, доли по осям стоят там
// разных пикселей, и угол по долям — не тот угол, который видит инженер.
// `options.free` — магнит снят; `options.limit` — свой порог.
export function snapSegment(from, to, scheme, options = {}) {
  const dx = (to.x - from.x) * schemeWidthPx(scheme);
  const dy = (to.y - from.y) * schemeHeightPx(scheme);
  if (dx === 0 && dy === 0) return { point: to, angle: 0, snapped: false };
  const angle = segmentAngle(dx, dy);
  const limit = options.limit === undefined ? SNAP_ANGLE_DEG : options.limit;
  if (options.free || !(limit > 0)) return { point: to, angle, snapped: false };
  const straight = Math.round(angle / SNAP_STEP_DEG) * SNAP_STEP_DEG;
  if (Math.abs(angle - straight) > limit) return { point: to, angle, snapped: false };
  return { point: rayProject(from, to, scheme, straight), angle: straight % 360, snapped: true };
}

/**
 * Направляющие: пока ломаная рисуется, курсор ловится вершинами, которые в ней
 * уже стоят. Ровно под прежней вершиной — значит через неё идёт направляющая, и
 * точка садится на неё. Этим замыкают квадрат (направляющая от первой вершины) и
 * ровняют верхи зигзага (направляющие от вершин прежних зубцов).
 *
 * Источник вершин — только текущая ломаная: на плане с сотней меток притяжка к
 * чужим точкам превратилась бы в кашу. Последняя вершина в источники не входит —
 * горизонталь и вертикаль от неё держит магнит направления, и вторая подсказка
 * о том же только мигала бы под рукой в миг постановки точки.
 *
 * Направляющих не больше двух: ближайшая горизонтальная и ближайшая
 * вертикальная. Возвращается `{point, guides}`, где `guides` — `{axis, at}`:
 * `h` — горизонтальная через вершину `at`, `v` — вертикальная.
 */
export function draftGuides(points, cursor, scheme, view, options = {}) {
  const limit = options.guide === undefined ? GUIDE_SNAP_PX : options.guide;
  const sources = Array.isArray(points) ? points.slice(0, -1) : [];
  if (!(limit > 0) || sources.length === 0) return { point: cursor, guides: [] };
  const state = renderView(view);
  const at = planToScreen(cursor, scheme, state);
  let horizontal = null;
  let vertical = null;
  for (const vertex of sources) {
    const screen = planToScreen(vertex, scheme, state);
    const gapY = Math.abs(screen.y - at.y);
    if (gapY <= limit && (!horizontal || gapY < horizontal.gap)) horizontal = { gap: gapY, at: vertex };
    const gapX = Math.abs(screen.x - at.x);
    if (gapX <= limit && (!vertical || gapX < vertical.gap)) vertical = { gap: gapX, at: vertex };
  }
  const guides = [];
  const point = { x: cursor.x, y: cursor.y };
  if (horizontal) {
    point.y = horizontal.at.y;
    guides.push({ axis: "h", at: horizontal.at });
  }
  if (vertical) {
    point.x = vertical.at.x;
    guides.push({ axis: "v", at: vertical.at });
  }
  return { point, guides };
}

/**
 * Куда сядет следующая вершина ломаной: свои направляющие, направляющие по
 * вершинам и магнит направления. Одна дверь и для предпросмотра, и для клика —
 * разойтись им негде. `points` — уже поставленные вершины, `cursor` — точка под
 * курсором в долях плана. `options.free` снимает всё разом, `options.planGuides`
 * — направляющие схемы, которые пользователь поставил с линейки.
 *
 * **Порядок разрешения споров — один на всю сборку: занятую ось не двигает
 * никто, а старшинство идёт сверху вниз.**
 *
 *   1. Направляющие пользователя — он поставил их руками, это точное намерение.
 *   2. Направляющие по вершинам текущей ломаной — подсказка программы.
 *   3. Угол кратно 15° — самое приблизительное из трёх.
 *
 * Угол при этом применяется целиком или молчит: сдвинуть точку с пунктира,
 * который пользователь перед собой видит, он не может.
 *
 * `snapped` — итоговое направление ровное. Считается по готовой точке, а не по
 * тому, кто её подвинул: квадрат, замкнутый направляющей, стоит ровно на 180°,
 * и подсказка у курсора обязана это сказать.
 */
export function draftSnap(points, cursor, scheme, view, options = {}) {
  const from = Array.isArray(points) && points.length > 0 ? points[points.length - 1] : null;
  if (options.free) {
    const angle = from ? snapSegment(from, cursor, scheme, { free: true }).angle : 0;
    return { point: cursor, angle, snapped: false, guides: [], held: { h: null, v: null } };
  }
  // 1. Своя направляющая старше всех: она уже нарисована на плане.
  const own = snapToSchemeGuides(options.planGuides, cursor, scheme, view, options);
  let point = own.point;
  const heldX = Boolean(own.held.v);
  const heldY = Boolean(own.held.h);
  if (!from) return { point, angle: 0, snapped: false, guides: [], held: own.held };

  // 2. Направляющие по вершинам — только по осям, которые ещё свободны.
  const vertex = draftGuides(points, point, scheme, view, options).guides.filter(
    (guide) => (guide.axis === "h" ? !heldY : !heldX),
  );
  const takenX = heldX || vertex.some((guide) => guide.axis === "v");
  const takenY = heldY || vertex.some((guide) => guide.axis === "h");
  for (const guide of vertex) {
    if (guide.axis === "h") point = { x: point.x, y: guide.at.y };
    else point = { x: guide.at.x, y: point.y };
  }

  // 3. Угол — по тому, что осталось свободным, и целиком или никак.
  if (!(takenX && takenY)) {
    const snap = snapSegment(from, point, scheme, options);
    const disturbs = (takenX && snap.point.x !== point.x) || (takenY && snap.point.y !== point.y);
    if (snap.snapped && !disturbs) point = snap.point;
  }

  const shown = snapSegment(from, point, scheme, { free: true });
  const moved = point.x !== from.x || point.y !== from.y;
  return {
    point,
    angle: shown.angle,
    snapped: moved && roundAngle(shown.angle),
    guides: vertex,
    held: own.held,
  };
}

// ——— линейка и направляющие схемы ————————————————————————————————————
//
// Заказчик: «добавь „линейку“ по бокам у схемы, просто шкала с метками, без
// единиц измерения». Единиц у плана и правда нет: подложка — картинка,
// масштаба она не знает, и подписать деления метрами значило бы соврать.
// Шкала нужна, чтобы **ставить направляющие** и видеть, что они стоят ровно.
//
// Рисуется всё это только холстом: `drawScheme` о линейке и направляющих не
// знает вовсе, поэтому в PNG, в печать и в лист «Схема» они не попадают —
// монтажнику на бумаге они не нужны.

// Ширина полосы линейки в пикселях экрана.
export const RULER_SIZE = 18;
// Реже этого деления на экране не ставятся: частая гребёнка читается заливкой.
const RULER_STEP_MIN_PX = 48;
// Каждое пятое деление — длинное: по ним глаз считает.
const RULER_MAJOR_EVERY = 5;
const RULER_TICK = 5;
const RULER_TICK_MAJOR = 10;

// Попадание по направляющей и порог притяжки — в пикселях экрана, как у
// направляющих черновика: иначе на разном зуме всё ведёт себя по-разному.
export const GUIDE_HIT_PX = 5;
// Перекрестие ловит шире одиночной направляющей: главный приём пользователя —
// ставить точки в перекрестия, и промахиваться по ним обидно.
export const GUIDE_CROSS_PX = 13;

// Шаг делений в пикселях плана: 1, 2, 5 и их десятки. Берётся самый мелкий, у
// которого на экране остаётся разборчивый просвет.
export function rulerStep(zoom) {
  const scale = zoom > 0 ? zoom : 1;
  let step = 1;
  let guard = 0;
  while (step * scale < RULER_STEP_MIN_PX && guard < 40) {
    const digit = Number(String(step)[0]);
    step = digit === 1 ? step * 2 : digit === 2 ? (step / 2) * 5 : step * 2;
    guard += 1;
  }
  return step;
}

/**
 * Деления линейки для видимой части холста. `box` — размер холста в его
 * собственных пикселях. Возвращает `{step, top, left}`; в списках — экранная
 * координата деления и признак длинного.
 */
export function rulerTicks(scheme, view, box, options = {}) {
  const state = renderView(view);
  const step = rulerStep(state.zoom);
  // У подложки деления стоят только там, где есть картинка: за её краем мерить
  // нечего. У чертежа краёв нет вовсе — лист бесконечен в обе стороны, и
  // миллиметры там бывают отрицательными (таск 193). Поэтому границы
  // необязательны, а не выведены из «схемы»: подставь мастерская свою мерку в
  // один миллиметр — линейка в чертеже показала бы одно деление.
  const bounded = options.bounded !== false;
  const ticks = (size, offset, planSize) => {
    const list = [];
    const first = Math.floor(-offset / (step * state.zoom));
    const last = Math.ceil((size - offset) / (step * state.zoom));
    for (let index = first; index <= last; index += 1) {
      const at = index * step;
      if (bounded && (at < 0 || at > planSize)) continue;
      list.push({ at, screen: offset + at * state.zoom, major: index % RULER_MAJOR_EVERY === 0 });
    }
    return list;
  };
  return {
    step,
    top: ticks(box.width, state.offsetX, schemeWidthPx(scheme)),
    left: ticks(box.height, state.offsetY, schemeHeightPx(scheme)),
  };
}

// Линейка: полоса с делениями сверху и слева. Без чисел — подписывать деления
// нечем, план масштаба не знает.
export function drawRuler(ctx, scheme, view, box, options = {}) {
  const state = renderView(view);
  const ticks = rulerTicks(scheme, state, box, options);
  ctx.save();
  ctx.fillStyle = "rgba(246, 248, 250, 0.94)";
  ctx.fillRect(0, 0, box.width, RULER_SIZE);
  ctx.fillRect(0, 0, RULER_SIZE, box.height);
  ctx.strokeStyle = "#d0d7de";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, RULER_SIZE + 0.5);
  ctx.lineTo(box.width, RULER_SIZE + 0.5);
  ctx.moveTo(RULER_SIZE + 0.5, 0);
  ctx.lineTo(RULER_SIZE + 0.5, box.height);
  ctx.stroke();
  ctx.strokeStyle = "#8c959f";
  ctx.beginPath();
  for (const tick of ticks.top) {
    const x = Math.round(tick.screen) + 0.5;
    if (x < RULER_SIZE) continue;
    ctx.moveTo(x, RULER_SIZE);
    ctx.lineTo(x, RULER_SIZE - (tick.major ? RULER_TICK_MAJOR : RULER_TICK));
  }
  for (const tick of ticks.left) {
    const y = Math.round(tick.screen) + 0.5;
    if (y < RULER_SIZE) continue;
    ctx.moveTo(RULER_SIZE, y);
    ctx.lineTo(RULER_SIZE - (tick.major ? RULER_TICK_MAJOR : RULER_TICK), y);
  }
  ctx.stroke();
  ctx.restore();
}

/**
 * Какая линейка лежит под точкой экрана и какую направляющую она ставит.
 *
 * **Левая (вертикальная) линейка задаёт высоту — значит ставит горизонтальную
 * направляющую; верхняя задаёт положение по ширине — значит вертикальную.**
 * Слова заказчика: «по вертикальной линейке горизонтальную линию, а по
 * горизонтальной — вертикальную». Угол, где полосы сходятся, отдан верхней:
 * решать его пополам было бы гаданием, а так правило одно и предсказуемое.
 *
 * `null` — точка не на линейке.
 */
export function rulerAxis(point) {
  if (!point) return null;
  if (point.y <= RULER_SIZE) return "v";
  if (point.x <= RULER_SIZE) return "h";
  return null;
}

// Экранная координата направляющей: у горизонтальной это `y`, у вертикальной `x`.
export function guideScreen(guide, scheme, view) {
  const state = renderView(view);
  return guide.axis === "h"
    ? state.offsetY + guide.at * schemeHeightPx(scheme) * state.zoom
    : state.offsetX + guide.at * schemeWidthPx(scheme) * state.zoom;
}

// Доля плана из экранной координаты — обратный ход для перетаскивания.
export function guideFraction(axis, screen, scheme, view) {
  const state = renderView(view);
  const size = (axis === "h" ? schemeHeightPx(scheme) : schemeWidthPx(scheme)) * state.zoom;
  const offset = axis === "h" ? state.offsetY : state.offsetX;
  return size > 0 ? (screen - offset) / size : 0;
}

// Направляющие: тонкая приглушённая линия через весь холст, взятая под руку —
// заметнее. Двенадцать штук не должны превратить план в сетку.
export function drawSchemeGuides(ctx, guides, scheme, view, box, options = {}) {
  if (!guides || guides.length === 0) return;
  const state = renderView(view);
  const active = options.activeId || null;
  const dropping = options.dropId || null;
  ctx.save();
  for (const guide of guides) {
    const at = Math.round(guideScreen(guide, scheme, state)) + 0.5;
    const live = guide.id === active;
    const drop = guide.id === dropping;
    // Утащенная обратно на линейку гаснет и рвётся пунктиром: по отпусканию её
    // снимут, и знать об этом надо до, а не после.
    ctx.setLineDash(drop ? GUIDE_DROP_DASH : []);
    ctx.strokeStyle = drop ? GUIDE_LINE : live ? GUIDE_LINE_ACTIVE : GUIDE_LINE;
    ctx.globalAlpha = drop ? GUIDE_DROP_ALPHA : 1;
    ctx.lineWidth = live && !drop ? 1.6 : 1;
    ctx.beginPath();
    if (guide.axis === "h") {
      ctx.moveTo(0, at);
      ctx.lineTo(box.width, at);
    } else {
      ctx.moveTo(at, 0);
      ctx.lineTo(at, box.height);
    }
    ctx.stroke();
  }
  ctx.restore();
}

// Направляющая под точкой экрана: по ней холст решает, что взяли под руку.
export function hitSchemeGuide(guides, point, scheme, view, extra = 0) {
  const state = renderView(view);
  let best = null;
  for (const guide of guides || []) {
    const at = guideScreen(guide, scheme, state);
    const gap = Math.abs((guide.axis === "h" ? point.y : point.x) - at);
    if (gap <= GUIDE_HIT_PX + extra && (!best || gap < best.gap)) best = { guide, gap };
  }
  return best ? best.guide : null;
}

/**
 * Притяжка к направляющим схемы. Возвращает `{point, held}`; `held` — какие
 * оси заняты и какими направляющими, по нему холст подсвечивает сработавшую.
 *
 * **Перекрестие тянет сильнее одиночной направляющей**: если рядом есть и
 * горизонтальная, и вертикальная, ловятся обе по широкому порогу
 * (`GUIDE_CROSS_PX`), а поодиночке — по обычному (`GUIDE_HIT_PX`). Главный приём
 * пользователя — ставить точки в перекрестия, и промах по ним обиднее лишнего
 * притяжения.
 */
export function snapToSchemeGuides(guides, point, scheme, view, options = {}) {
  const empty = { point, held: { h: null, v: null } };
  if (!guides || guides.length === 0 || options.free) return empty;
  const state = renderView(view);
  const at = planToScreen(point, scheme, state);
  let horizontal = null;
  let vertical = null;
  for (const guide of guides) {
    const screen = guideScreen(guide, scheme, state);
    if (guide.axis === "h") {
      const gap = Math.abs(screen - at.y);
      if (!horizontal || gap < horizontal.gap) horizontal = { guide, gap };
    } else {
      const gap = Math.abs(screen - at.x);
      if (!vertical || gap < vertical.gap) vertical = { guide, gap };
    }
  }
  const cross =
    horizontal && vertical && horizontal.gap <= GUIDE_CROSS_PX && vertical.gap <= GUIDE_CROSS_PX;
  const limit = cross ? GUIDE_CROSS_PX : GUIDE_HIT_PX;
  const next = { x: point.x, y: point.y };
  const held = { h: null, v: null };
  if (horizontal && horizontal.gap <= limit) {
    next.y = horizontal.guide.at;
    held.h = horizontal.guide.id;
  }
  if (vertical && vertical.gap <= limit) {
    next.x = vertical.guide.at;
    held.v = vertical.guide.id;
  }
  return { point: next, held };
}

// ——— связи меток ——————————————————————————————————————————————————————
//
// «Чем управляет» (`mark.controls`) — единственное место в объекте, где одна
// метка знает про другую. На плане это разбор, а не чертёж: выключатель у двери
// и лента в нише — вещи в разных концах комнаты, и по одному плану не видно,
// что они про один сценарий.
//
// **Главная опасность — спутать связь с меткой-линией.** Начертаний у линий
// девять, и десятое ничего бы не решило: любая прямая на плане читается как
// проложенная трасса. Поэтому связь говорит на другом языке сразу по четырём
// признакам, и каждый из них по отдельности линии недоступен:
//
// 1. **Дуга, а не ломаная.** Метка-линия состоит из прямых отрезков — она
//    повторяет стену или кабель. Плавный лук между двумя метками ни одной
//    линией нарисовать нельзя (волнистое начертание — это частая рябь вдоль
//    прямой, а не один прогиб).
// 2. **Свой служебный цвет** (`LINK_COLOR`), малиновый: он не принадлежит ни
//    одной категории справочника и в легенде его нет. Цвет метки говорит
//    «свет», «розетки», «щит»; цвет связи не говорит ни о чём, кроме связи.
// 3. **Волос толщиной и вполсилы** — и, в отличие от метки, **не растёт с
//    масштабом**: метка задана в пикселях плана и на приближении толстеет,
//    связь остаётся ниткой. На любом зуме она тоньше самой тонкой линии.
// 4. **Наконечник у управляемого и точка у управляющего.** У метки-линии концы
//    одинаковы: у неё нет направления. У связи направление есть, и оно и есть
//    её содержание — «эта включает ту».
//
// **Связь бывает не парой.** Проходная схема — В1 и ВП1 на одном Т1, и в одну
// метку приходит несколько дуг. Слова заказчика: «может быть связь не только
// выключатель-лампочка, но ещё и несколько дополнительных переключателей».
// Поэтому дуги к общей метке разводятся: каждая следующая выгибается сильнее и
// приходит чуть дальше от знака (`LINK_SPREAD`, `LINK_SPREAD_PAD`). Без этого
// два выключателя, стоящие в одной рамке, дали бы две дуги одна под другой —
// и три связи читались бы как одна.
const LINK_COLOR = "#BF3989";
// Полупрозрачность: связь лежит поверх плана и меток, и перебивать их она не
// должна — читается поверху, а не вместо.
const LINK_ALPHA = 0.72;
// Толщина в пикселях экрана. Не в пикселях плана: см. признак 3 выше.
const LINK_WIDTH = 1.6;
// Прогиб дуги — доля длины хорды, с потолком в пикселях экрана: у короткой
// связи лук должен быть заметен, у длинной — не улетать через полплана.
const LINK_BOW = 0.16;
const LINK_BOW_MAX_PX = 54;
// Разведение дуг, приходящих в одну метку: насколько сильнее выгибается каждая
// следующая и насколько дальше от знака садится её наконечник.
const LINK_SPREAD = 0.62;
const LINK_SPREAD_PAD = 2.5;
// Просвет между меткой и концом связи: наконечник не должен прятаться под
// знаком, а точка начала — сливаться с ним.
const LINK_GAP_PX = 3;
// Наконечник и точка начала в пикселях экрана.
const LINK_ARROW_PX = 7.5;
const LINK_DOT_PX = 2.4;
// Обрывок «связь уходит на другую схему»: длина всего знака, длина первого
// куска и разрыв после него — по этому разрыву знак и читается как обрыв.
const LINK_AWAY_PX = 17;
const LINK_AWAY_HEAD = 6;
const LINK_AWAY_BREAK = 4;
// Куда смотрит обрывок: вверх-вправо, туда же, куда уходит подпись метки.
const LINK_AWAY_DEG = -45;

// Общее управление — отношение равных: ни стрелки, ни точки, засечки на обоих
// концах. Тоньше и бледнее управления: это следствие связей, а не своя запись.
//
// **Свой цвет, тёмно-синий.** Прежнее «один служебный цвет на все роды» было
// ставкой, и заказчик её снял: «цепь другим цветом сделай». Цвет посчитан, а не
// подобран на глаз, по тому же `colorDistance`, что цвета категорий: до
// ближайшей категории (Свет `#1F6FEB`) 35,6, до управления 56,5, до заливок
// помещений при рабочей плотности 63,5 и не меньше 21,3 при любой, до туши
// плана 47,9. Контраст к белому листу 12,4 — волосок в полтора пикселя
// держится светлотой, а не оттенком, и жёлтый с бирюзовым отпали именно здесь.
//
// **Смысл разделения цветов — сторона, а не род.** Малиновый это всё, что про
// нагрузку: дуга к управляемому и оболочка вокруг группы, которая включается
// как одно. Тёмно-синий — цепь **управляющих** между собой. Поэтому оболочка
// третьего цвета не получила: она на стороне нагрузки, а не рядом с цепью, и
// третий оттенок вернул бы ту самую паутину.
const LINK_TIE_COLOR = "#0F2E7A";
const LINK_TIE_ALPHA = 0.62;
const LINK_TIE_WIDTH = 1.2;
const LINK_TIE_TICK = 4.5;

// Общий номер — не линия, а оболочка: тождество, а не отношение. Пунктир,
// самая бледная из трёх, отступ от знака метки — чтобы обойти его, а не
// перечеркнуть.
const LINK_HULL_ALPHA = 0.45;
const LINK_HULL_WIDTH = 1.1;
const LINK_HULL_DASH = [5, 4];
const LINK_HULL_PAD = 7;

// Канал связи у основания дуги: маленькая цифра возле управляющей метки.
// Целиком «ВВ3.1» не подписывается — дуга и так начинается у своей метки, и
// обозначение рядом с ней стояло бы дважды. Кегль в пикселях экрана, как и
// толщина связи: это разбор поверх плана, а не часть чертежа.
const LINK_CHANNEL_FONT = 10;
// Куда цифра садится от начала дуги: чуть вперёд по ходу и вбок — в ту
// сторону, куда дуга не выгибается. На самой линии цифра читалась бы как
// часть знака метки.
const LINK_CHANNEL_ALONG = 7;
const LINK_CHANNEL_ASIDE = 7;
// Светлая обводка под цифрой: волосок в десять пикселей на тёмном месте
// картинки плана пропадает без неё.
const LINK_CHANNEL_HALO = 2.5;
const LINK_CHANNEL_HALO_COLOR = "#FFFFFF";

// Насколько глушится то, что в связной группе есть, но выделенной метки не
// касается. Человек выделил одну, а поднялось двенадцать — и по яркости должно
// быть видно, с чего началось: от самой метки связи идут в полную силу.
const LINK_FAR_FADE = 0.4;

// Точка, к которой связь приходит. У точечной метки — середина её точек (у
// блока «одна метка на блок» их несколько), у ломаной — середина серединного
// отрезка: она всегда лежит **на** линии, а центр тяжести вершин у Г-образного
// трека оказался бы в стороне от неё.
export function markLinkAnchor(mark) {
  const points = (mark && mark.points) || [];
  if (points.length === 0) return { x: 0, y: 0 };
  if (mark.kind === "line" && points.length >= 2) {
    const index = Math.floor((points.length - 1) / 2);
    const from = points[index];
    const to = points[index + 1];
    return { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
  }
  const sum = points.reduce((acc, point) => ({ x: acc.x + point.x, y: acc.y + point.y }), { x: 0, y: 0 });
  return { x: sum.x / points.length, y: sum.y / points.length };
}

/**
 * Связи, которые можно показать на этой схеме. Чистая: доли плана, как точки
 * меток, — ни зума, ни экрана.
 *
 * Родов связи три, и различаются они **природой отношения**, а не цветом:
 *
 * - `lines` — **управление**, `{fromId, toId, from, to, spread}`. Отношение
 *   направленное: кто кем. Рисуется дугой со стрелкой.
 * - `ties` — **общее управление**, `{fromId, toId, from, to}`. В1 и ВП1 оба
 *   управляют Т1 — значит они в одной цепи. Отношение **равных**: направления
 *   нет, и стрелка тут была бы враньём. Рисуется прямой с засечками на концах.
 * - `groups` — **общий номер**, `{key, label, markIds, points}`. Это вообще не
 *   отношение, а **тождество**: шесть светильников с одним Т16 — в учёте
 *   заказчика один светильник, разнесённый по потолку (G25, G96). Рисуется не
 *   линией, а замкнутой оболочкой вокруг своих меток.
 * - `offScheme` — `{markId, at, count}` для меток, чей собеседник любого из
 *   трёх родов лежит на **другой схеме**: линию через границу листа не
 *   провести, но и промолчать нельзя — пустота у метки читается как «эта ни с
 *   чем не связана». Такая метка помечается обрывком (`drawMarkLinks`), и
 *   способ этот один на все три рода.
 *
 * Метка, спрятанная **фильтром**, — случай другой: её убрала рука
 * пользователя, и рассказывать ему о том, что он сам только что скрыл, незачем.
 * Такие связи пропускаются молча.
 *
 * Показываются **все** связи схемы, а не только выделенной метки. Так решил
 * заказчик: «если на объекте не из щита связи, а через умные реле и т.д. то
 * мешанины не будет» — в его работе связь короткая, от выключателя к
 * светильнику в той же комнате, а не через весь план в щит.
 *
 * **Полного графа здесь нет нигде.** Трое управляющих одним объектом дали бы
 * три линии, шестеро — пятнадцать: это не «показать цепь», а закрасить план.
 * Равные соединяются **цепочкой** (n−1 звеньев, порядок — слева направо и
 * сверху вниз, чтобы цепь читалась как обход), а тождество — **одной
 * оболочкой** на всю группу.
 *
 * `spread` у линии управления — её очередь среди дуг, приходящих в **ту же**
 * метку. Считается здесь, а не при рисовании: разведение проходной схемы
 * обязано проверяться без холста.
 */
export function markLinks(project, scheme, filter) {
  const result = { lines: [], ties: [], groups: [], offScheme: [] };
  if (!project || !scheme) return result;
  const shown = visibleMarks(project, scheme, filter);
  const here = new Map(shown.map((mark) => [mark.id, mark]));
  // Собеседники, оказавшиеся на другой схеме, — по метке и без повторов: у
  // метки один обрывок, сколько бы родов связи через границу ни ушло.
  const away = new Map();
  const noteAway = (markId, otherId) => {
    const other = findMark(project, otherId);
    if (!other || !other.schemeId || other.schemeId === scheme.id) return;
    let set = away.get(markId);
    if (!set) away.set(markId, (set = new Set()));
    set.add(otherId);
  };

  // ——— управление ———
  // Сколько дуг уже пришло в эту метку: порядок обхода — порядок объекта,
  // поэтому одна и та же схема разводится одинаково при каждой отрисовке.
  const incoming = new Map();
  for (const mark of shown) {
    for (const link of markControlLinks(mark)) {
      const target = here.get(link.id);
      if (!target) {
        noteAway(mark.id, link.id);
        continue;
      }
      const spread = incoming.get(link.id) || 0;
      incoming.set(link.id, spread + 1);
      result.lines.push({
        fromId: mark.id,
        toId: link.id,
        from: markLinkAnchor(mark),
        to: markLinkAnchor(target),
        spread,
        // Канал — свойство связи, и на плане он стоит у её основания: у метки
        // с двумя клавишами две дуги, и без цифры не видно, какая куда.
        // `null` — канал не указан: так размечали до сих пор, и дуга рисуется
        // ровно как раньше.
        channel: link.channel,
      });
    }
  }

  // ——— общее управление ———
  // Управляющие собираются по подопечному, а сам подопечный при этом не нужен
  // видимым: выключатель и переключатель остаются одной цепью и тогда, когда
  // светильник спрятан фильтром или лежит на другом этаже.
  const byTarget = new Map();
  for (const mark of project.marks) {
    for (const id of markControlIds(mark)) {
      let list = byTarget.get(id);
      if (!list) byTarget.set(id, (list = []));
      list.push(mark);
    }
  }
  const tied = new Set();
  for (const [, controllers] of byTarget) {
    if (controllers.length < 2) continue;
    const mine = controllers.filter((mark) => here.has(mark.id));
    for (const mark of mine) {
      for (const other of controllers) {
        if (other.id !== mark.id) noteAway(mark.id, other.id);
      }
    }
    if (mine.length < 2) continue;
    // Цепочка, а не каждый с каждым: слева направо, сверху вниз.
    const chain = mine
      .map((mark) => ({ mark, at: markLinkAnchor(mark) }))
      .sort((a, b) => a.at.x - b.at.x || a.at.y - b.at.y || (a.mark.id < b.mark.id ? -1 : 1));
    for (let index = 0; index + 1 < chain.length; index += 1) {
      const a = chain[index];
      const b = chain[index + 1];
      const key = a.mark.id < b.mark.id ? a.mark.id + "|" + b.mark.id : b.mark.id + "|" + a.mark.id;
      if (tied.has(key)) continue;
      tied.add(key);
      result.ties.push({ fromId: a.mark.id, toId: b.mark.id, from: a.at, to: b.at });
    }
  }

  // ——— общий номер ———
  // Группировку считает модель (`repeatedNumbers`): что считать повтором —
  // правило объекта, а не рисования. Здесь остаётся выбрать своих.
  for (const repeat of repeatedNumbers(project)) {
    const mine = repeat.markIds.filter((id) => here.has(id));
    for (const id of mine) {
      for (const other of repeat.markIds) {
        if (other !== id) noteAway(id, other);
      }
    }
    if (mine.length < 2) continue;
    result.groups.push({
      key: repeat.typeId + "#" + repeat.number,
      label: repeat.label,
      markIds: mine,
      points: mine.map((id) => markLinkAnchor(here.get(id))),
    });
  }

  for (const mark of shown) {
    const set = away.get(mark.id);
    if (set && set.size > 0) {
      result.offScheme.push({ markId: mark.id, at: markLinkAnchor(mark), count: set.size });
    }
  }
  return result;
}

/**
 * Выпуклая оболочка набора точек (обход Эндрю). Возвращает вершины по кругу;
 * при одной точке — её саму, при двух и при лежащих на одной прямой — только
 * концы. Чистая и вынесенная наружу ради теста: оболочка группы считается по
 * ней, и ошибка здесь видна только глазами.
 */
export function convexHull(points) {
  const list = (points || []).filter((point) => point && Number.isFinite(point.x) && Number.isFinite(point.y));
  if (list.length <= 2) return list.slice();
  const sorted = list.slice().sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const half = (source) => {
    const out = [];
    for (const point of source) {
      while (out.length >= 2 && cross(out[out.length - 2], out[out.length - 1], point) <= 0) out.pop();
      out.push(point);
    }
    out.pop();
    return out;
  };
  const hull = [...half(sorted), ...half(sorted.slice().reverse())];
  return hull.length >= 3 ? hull : [sorted[0], sorted[sorted.length - 1]];
}

/**
 * Оболочка группы одного номера: выпуклая оболочка её меток, отодвинутая
 * наружу на `pad` и скруглённая по углам, — замкнутая ломаная в тех же
 * единицах, что пришли.
 *
 * Отодвинутый контур с круглыми углами — это сумма Минковского оболочки с
 * кругом: у двух меток выходит капсула, у трёх и больше — скруглённый
 * многоугольник, и в обоих случаях линия обходит знаки, а не режет их.
 * Считается ломаной, а не дугами холста, ровно затем, чтобы проверяться без
 * холста.
 */
export function linkHullOutline(points, pad, options = {}) {
  const hull = convexHull(points);
  const radius = Math.max(1, pad);
  const step = Math.max(2, Math.min(24, Math.round(options.corner || 6)));
  if (hull.length === 0) return [];
  if (hull.length === 1) {
    const out = [];
    for (let i = 0; i < step * 4; i += 1) {
      const angle = (i / (step * 4)) * Math.PI * 2;
      out.push({ x: hull[0].x + Math.cos(angle) * radius, y: hull[0].y + Math.sin(angle) * radius });
    }
    return out;
  }
  // Обход по кругу; у двух вершин рёбер тоже два — туда и обратно, и из этого
  // сам собой выходит капсула.
  const out = [];
  const count = hull.length;
  const normals = [];
  for (let i = 0; i < count; i += 1) {
    const a = hull[i];
    const b = hull[(i + 1) % count];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const span = Math.hypot(dx, dy) || 1;
    // Наружу — вправо от хода обхода: `convexHull` отдаёт вершины по часовой
    // стрелке в экранных осях (ось Y вниз).
    normals.push({ x: dy / span, y: -dx / span });
  }
  for (let i = 0; i < count; i += 1) {
    const a = hull[i];
    const b = hull[(i + 1) % count];
    const n = normals[i];
    out.push({ x: a.x + n.x * radius, y: a.y + n.y * radius });
    out.push({ x: b.x + n.x * radius, y: b.y + n.y * radius });
    // Угол: дуга радиусом `pad` от нормали этого ребра до нормали следующего.
    const next = normals[(i + 1) % count];
    let from = Math.atan2(n.y, n.x);
    let to = Math.atan2(next.y, next.x);
    while (to < from) to += Math.PI * 2;
    const turns = Math.max(1, Math.ceil(((to - from) / (Math.PI / 2)) * step));
    for (let k = 1; k <= turns; k += 1) {
      const angle = from + ((to - from) * k) / turns;
      out.push({ x: b.x + Math.cos(angle) * radius, y: b.y + Math.sin(angle) * radius });
    }
  }
  return out;
}

// Дуга связи в экранных пикселях: концы отодвинуты от знаков меток, середина
// уведена вбок от хорды. Сторона прогиба — всегда слева по ходу движения,
// поэтому встречная пара (A управляет B, B управляет A) расходится двумя
// луками и обе стрелки видны.
function linkCurve(from, to, pad, spread = 0) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const span = Math.hypot(dx, dy);
  if (!(span > 0)) return null;
  const ux = dx / span;
  const uy = dy / span;
  const trim = Math.min(pad, (span - 1) / 2);
  // Наконечники дуг, сходящихся в одну метку, садятся на разном отдалении от
  // знака: у проходной схемы иначе три стрелки упёрлись бы в одну точку.
  const tail = Math.min(pad + spread * LINK_SPREAD_PAD, (span - 1) / 2);
  const start = { x: from.x + ux * trim, y: from.y + uy * trim };
  const end = { x: to.x - ux * tail, y: to.y - uy * tail };
  const bow = Math.min(span * LINK_BOW, LINK_BOW_MAX_PX) * (1 + spread * LINK_SPREAD);
  const control = {
    x: (start.x + end.x) / 2 + uy * bow,
    y: (start.y + end.y) / 2 - ux * bow,
  };
  return { start, end, control };
}

// Цифра канала у основания дуги. Канал не указан — не рисуется ничего: план
// объекта, размеченного до появления каналов, обязан остаться прежним.
function drawLinkChannel(ctx, curve, channel, color, alpha, family) {
  if (!Number.isInteger(channel) || channel < 1) return;
  const dx = curve.end.x - curve.start.x;
  const dy = curve.end.y - curve.start.y;
  const span = Math.hypot(dx, dy);
  if (!(span > 0)) return;
  const ux = dx / span;
  const uy = dy / span;
  // Дуга выгибается в сторону `(uy, -ux)` (см. `linkCurve`), поэтому цифра
  // садится в противоположную — она не ляжет на линию ни при каком прогибе.
  const at = {
    x: curve.start.x + ux * LINK_CHANNEL_ALONG - uy * LINK_CHANNEL_ASIDE,
    y: curve.start.y + uy * LINK_CHANNEL_ALONG + ux * LINK_CHANNEL_ASIDE,
  };
  const value = String(channel);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.font = drawFont(LINK_CHANNEL_FONT, 700, family);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  ctx.lineWidth = LINK_CHANNEL_HALO;
  ctx.strokeStyle = LINK_CHANNEL_HALO_COLOR;
  ctx.strokeText(value, at.x, at.y);
  ctx.fillStyle = color;
  ctx.fillText(value, at.x, at.y);
  ctx.restore();
}

function drawLinkArrow(ctx, at, dx, dy, size) {
  const span = Math.hypot(dx, dy);
  if (!(span > 0)) return;
  const ux = dx / span;
  const uy = dy / span;
  const back = { x: at.x - ux * size, y: at.y - uy * size };
  const wing = size * 0.42;
  ctx.beginPath();
  ctx.moveTo(at.x, at.y);
  ctx.lineTo(back.x - uy * wing, back.y + ux * wing);
  ctx.lineTo(back.x + uy * wing, back.y - ux * wing);
  ctx.closePath();
  ctx.fill();
}

/**
 * Связи на плане. Зовётся из `drawScheme` — и на экране, и в выгрузке, но в
 * выгрузке только по отметке: `drawScheme` получает `links` и без него не
 * рисует ничего. Заказчик: «для печати надо галкой разрешать показ связей» —
 * значит на бумаге они бывают нужны, но по умолчанию лист остаётся чертежом.
 */
export function drawMarkLinks(ctx, links, scheme, view, options = {}) {
  if (!links) return;
  const lines = links.lines || [];
  const ties = links.ties || [];
  const groups = links.groups || [];
  const away = links.offScheme || [];
  if (lines.length === 0 && ties.length === 0 && groups.length === 0 && away.length === 0) return;
  const state = renderView(view);
  const pad = markRadius(state) + LINK_GAP_PX;
  const color = options.color || LINK_COLOR;
  const tieColor = options.tieColor || LINK_TIE_COLOR;
  // `near === false` ставит холст, когда поднята связная группа: всё, что не
  // касается выделенной метки, глушится, и видно, с чего началось.
  const fade = (item, alpha) => (item && item.near === false ? alpha * LINK_FAR_FADE : alpha);
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  // Тождество — в самом низу и без заливки: оболочка обводит свои метки, а не
  // закрывает то, что под ней.
  ctx.lineWidth = LINK_HULL_WIDTH;
  ctx.setLineDash(LINK_HULL_DASH);
  for (const group of groups) {
    ctx.globalAlpha = fade(group, LINK_HULL_ALPHA);
    const screen = (group.points || []).map((point) => planToScreen(point, scheme, state));
    const outline = linkHullOutline(screen, markRadius(state) + LINK_HULL_PAD);
    if (outline.length < 2) continue;
    ctx.beginPath();
    ctx.moveTo(outline[0].x, outline[0].y);
    for (let i = 1; i < outline.length; i += 1) ctx.lineTo(outline[i].x, outline[i].y);
    ctx.closePath();
    ctx.stroke();
  }

  // Равные — прямой с засечками на обоих концах, своим цветом. Ни стрелки, ни
  // точки: у этой связи нет начала и конца, и любой знак направления был бы
  // враньём.
  ctx.strokeStyle = tieColor;
  ctx.lineWidth = LINK_TIE_WIDTH;
  ctx.setLineDash([]);
  for (const tie of ties) {
    ctx.globalAlpha = fade(tie, LINK_TIE_ALPHA);
    const from = planToScreen(tie.from, scheme, state);
    const to = planToScreen(tie.to, scheme, state);
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const span = Math.hypot(dx, dy);
    if (!(span > 0)) continue;
    const ux = dx / span;
    const uy = dy / span;
    const trim = Math.min(pad, (span - 1) / 2);
    const a = { x: from.x + ux * trim, y: from.y + uy * trim };
    const b = { x: to.x - ux * trim, y: to.y - uy * trim };
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    for (const end of [a, b]) {
      ctx.beginPath();
      ctx.moveTo(end.x - uy * LINK_TIE_TICK, end.y + ux * LINK_TIE_TICK);
      ctx.lineTo(end.x + uy * LINK_TIE_TICK, end.y - ux * LINK_TIE_TICK);
      ctx.stroke();
    }
  }

  ctx.strokeStyle = color;
  ctx.lineWidth = LINK_WIDTH;
  ctx.setLineDash([]);
  // Цифра канала — **одна на клавишу**, а не на дугу. Клавиша на группу из
  // шести светильников — обычное дело, и шесть одинаковых цифр у одного знака
  // легли бы друг на друга кляксой. Кому принадлежат остальные дуги той же
  // клавиши, видно по тому, что они выходят из одной точки.
  const channelsShown = new Set();
  for (const line of lines) {
    ctx.globalAlpha = fade(line, LINK_ALPHA);
    const curve = linkCurve(
      planToScreen(line.from, scheme, state),
      planToScreen(line.to, scheme, state),
      pad,
      line.spread || 0,
    );
    if (!curve) continue;
    ctx.beginPath();
    ctx.moveTo(curve.start.x, curve.start.y);
    ctx.quadraticCurveTo(curve.control.x, curve.control.y, curve.end.x, curve.end.y);
    ctx.stroke();
    // Точка у управляющей метки: с какого конца читать дугу.
    ctx.beginPath();
    ctx.arc(curve.start.x, curve.start.y, LINK_DOT_PX, 0, Math.PI * 2);
    ctx.fill();
    // Наконечник смотрит по касательной к дуге в её конце — от опорной точки к
    // концу, иначе стрелка у выгнутой связи целится мимо метки.
    drawLinkArrow(ctx, curve.end, curve.end.x - curve.control.x, curve.end.y - curve.control.y, LINK_ARROW_PX);
    // Канал — у основания дуги, а не у наконечника: он свойство управляющей
    // стороны («вторая клавиша этого выключателя»), и у метки с тремя дугами
    // цифры стоят рядом, где их и сравнивают.
    const channelKey = line.fromId + "#" + line.channel;
    if (!channelsShown.has(channelKey)) {
      channelsShown.add(channelKey);
      drawLinkChannel(ctx, curve, line.channel, color, fade(line, 1), state.fontFamily);
    }
  }
  // Связь на другую схему: обрывок с разрывом посередине. Линию через границу
  // листа не провести, но пустота у метки соврала бы.
  for (const item of away) {
    ctx.globalAlpha = fade(item, LINK_ALPHA);
    const at = planToScreen(item.at, scheme, state);
    const angle = (LINK_AWAY_DEG * Math.PI) / 180;
    const ux = Math.cos(angle);
    const uy = Math.sin(angle);
    const base = pad;
    const breakAt = base + LINK_AWAY_PX - LINK_AWAY_HEAD - LINK_AWAY_BREAK;
    const tail = base + LINK_AWAY_PX - LINK_AWAY_HEAD;
    const tip = base + LINK_AWAY_PX;
    ctx.beginPath();
    ctx.moveTo(at.x + ux * base, at.y + uy * base);
    ctx.lineTo(at.x + ux * breakAt, at.y + uy * breakAt);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(at.x + ux * tail, at.y + uy * tail);
    ctx.lineTo(at.x + ux * tip, at.y + uy * tip);
    ctx.stroke();
    drawLinkArrow(ctx, { x: at.x + ux * tip, y: at.y + uy * tip }, ux, uy, LINK_ARROW_PX);
  }
  ctx.restore();
}

// ——— видимость ———————————————————————————————————————————————————————

// Фильтр панели меток: скрытая метка не рисуется и по ней не кликается.
function markVisible(project, mark, filter) {
  if (!filter) return true;
  // Только эти метки (правка после сборки сценариев): схема в окне выбора
  // устройства показывает те, что можно выбрать, и ничего лишнего.
  if (filter.markIds instanceof Set && !filter.markIds.has(mark.id)) return false;
  // Комментарий прячется своей галочкой, а не галочками справочника (G173):
  // встроенного типа нет ни в `typeIds`, ни в `categoryIds`, и без этой ветки
  // плашки исчезали бы с плана от любого сужения по типу — например стоило
  // снять одну категорию.
  if (markIsComment(mark)) {
    if (filter.comments === false) return false;
  } else {
    if (Array.isArray(filter.typeIds) && !filter.typeIds.includes(mark.typeId)) return false;
    if (Array.isArray(filter.categoryIds)) {
      const type = findType(project, mark.typeId);
      if (!type || !filter.categoryIds.includes(type.categoryId)) return false;
    }
  }
  if (filter.roomId && mark.roomId !== filter.roomId) return false;
  const query = queryNeedle(filter.query);
  if (!query) return true;
  const haystack = [labelOf(project, mark.id), mark.location, mark.original]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  // Правило одно на все окна (`queryHit`, находка 7): с начала слова. Поле
  // фильтра сужает **и план, и список меток**, и искало оно серединой строки —
  // пятое место в сборке, где один и тот же вопрос решался по-своему, и в
  // разборе оно не названо.
  return queryHit(haystack, query);
}

export function visibleMarks(project, scheme, filter) {
  if (!project || !scheme) return [];
  return project.marks.filter((mark) => mark.schemeId === scheme.id && markVisible(project, mark, filter));
}

// ——— стопка совпавших меток ———————————————————————————————————————————
//
// Случай заказчика (G181): «бывает, например у зоны ТВ когда снизу блок
// розеток расположен, и сверху под ТВ ещё один блок, в горизонтали они на
// одной оси, а по вертикали на разной. На развёртке стен всё корректно будет,
// а вот на основной схеме как это сделать?»
//
// На плане, который смотрит сверху, «на разной высоте» не видно вовсе: знаки
// лежат один на другом, и **верхняя метка просто невидима**. Разводились до
// сих пор только подписи (`labelPlaceAll`), а знаки рисовались там, где стоят.
//
// Из трёх предложенных решений заказчик выбрал: **стопкой, с высотой у каждой,
// без схлопывания в счётчик** — «сразу на каких высотах, и стопкой без
// счётчика». Счётчика поэтому здесь нет ни при каком числе меток.
//
// Высоты у каждой он потом снял сам (G188): «на схеме при расстановке в
// колонку не указывай их высоту». Осталась стопка и порядок по высоте —
// число у знака не рисуется, а читается в карточке метки и на развёртке.
//
// Три свойства, ради которых всё считается именно так:
//
// 1. **Координаты меток не меняются** (G68). Стопка — отрисовка: смещение
//    живёт один кадр и в объект не попадает. Выгруженный файл до и после
//    показа стопки побайтно один.
// 2. **Считается в пикселях плана, а не экрана и не в миллиметрах чертежа.**
//    Знак рисуется радиусом `markSize` в пикселях плана и растёт с
//    приближением — значит и «наезжают ли знаки друг на друга» от приближения
//    не зависит: стопка на распечатке повторяет ту, что видел инженер (то же
//    правило, что у раскладки подписей). Миллиметры здесь не годятся вовсе:
//    они есть только у откалиброванного и привязанного чертежа (ADR 008), а
//    знаки наезжают и на плане, которого никто не чертил. У привязки метки к
//    стене мера обратная (миллиметры) и по той же причине: там это **данные**,
//    которые не должны зависеть от взгляда, а здесь — рисование.
// 3. **Попадание по клику считается тем же смещением.** `hitTest` и
//    `drawMarkBody` берут точку знака из одной функции `markStackPoints`:
//    разойдись они — клик попадал бы в пустое место.

// Порог совпадения — в радиусах знака. Полрадиуса от центра до центра значит,
// что верхний знак накрывает центр нижнего: на плане это один знак, а не два.
// Больше брать нельзя: шаг блока — 2,22 радиуса (знаки вплотную, G182), и
// порог от него обязан остаться в стороне, иначе каждый блок розеток в одной
// рамке превращался бы в стопку.
const MARK_STACK_REACH_RATIO = 1;
// Шаг стопки — в радиусах знака. Втрое больше радиуса: знаки расходятся с
// просветом примерно в треть знака. Вплотную (2,22) стопка читалась бы как
// блок в одной рамке, а блок — это другое: там метки стоят рядом на самом
// плане. Просвет и тонкая линия к настоящей точке говорят «это одно место».
const MARK_STACK_STEP_RATIO = 3;

// В стопку идут только **одиночные точки**. Линия видна сама по себе: её трек
// уходит от вершины в сторону, и под чужим знаком она не пропадает. Плашка
// комментария — не знак, её разводит раскладка подписей. Метка с несколькими
// точками — это блок «одна метка на блок» (ADR 004): отодвинь её целиком, и
// соврут остальные её точки, а отодвинуть одну из них стопка не умеет — она
// двигает метку, а не точку.
function markStackable(mark) {
  return Boolean(mark) && mark.kind === "point" && !markIsComment(mark) && (mark.points || []).length === 1;
}

function markStackHeight(mark) {
  return markDimensions(mark).heightAboveFloor;
}

/**
 * Направление стопки — единичный вектор в пикселях плана.
 *
 * Там, где у метки есть стена, — **перпендикуляр стене, в сторону самой
 * метки**. Так отступ вдоль стены (`wallAtMm`) остаётся честным: знак едет
 * поперёк стены и его проекция на стену не меняется, то есть развёртка и план
 * говорят об одном и том же месте. Вдоль стены ехать нельзя — знак оказался бы
 * на другом метре стены; внутрь стены тоже: там тело стены на чертеже и
 * соседняя комната.
 *
 * **Стена берётся по месту метки (`markWallNearest`), а не из её привязки, и
 * это починка дефекта D26.** Пока направление читалось из записанных полей,
 * оно переворачивалось в тот самый миг, когда автопривязка их дописывала:
 * человек подводил стопку к стене, порог срабатывал — и знак, который он вёл,
 * прыгал на два шага (с «вверх» на «поперёк»), то есть улетал из-под курсора.
 * Привязка — следствие места (G68), и рисованию незачем знать, записана она
 * уже или нет: место то же, направление то же, знак стоит.
 *
 * Где стен нет вовсе — **вверх**. Выбрано так: подпись у метки уходит в первую
 * очередь вбок (`labelSlots`), значит вертикаль свободнее; а порядок в стопке —
 * по возрастанию высоты над полом, и вверх по листу оказывается то, что выше
 * над полом. Направление не зависит ни от соседей, ни от приближения — одна и
 * та же схема раскладывается одинаково при каждой отрисовке.
 *
 * Поворот чертежа относительно подложки (G178) учитывается: нормаль стены
 * живёт в миллиметрах чертежа, и в пиксели плана она переводится тем же
 * поворотом, что весь чертёж (`drawingTurn`).
 */
function markStackDirection(project, scheme, marks) {
  for (const mark of marks) {
    const near = markWallNearest(project, mark);
    if (!near) continue;
    const side = markWallSideOn(project, mark, near.wallId);
    if (!side) continue;
    const vectors = wallVectors(findWall(project, near.wallId));
    const origin = planOriginOf(project, scheme.id);
    if (!vectors || !origin) continue;
    // `n` — левая нормаль стены в осях чертежа, та же, которой `markWallSide`
    // считает сторону. Метке справа достаётся обратная.
    const n = side === "left" ? vectors.n : { x: -vectors.n.x, y: -vectors.n.y };
    const turned = drawingTurn(n, origin.turn);
    // `|| 0` — от **минус нуля**: поворот и смена знака дают `-0`, и дальше он
    // поехал бы в смещение знака и в сравнения направления. Та же оговорка, что
    // у `wallVectors` в модели.
    return { x: turned.x || 0, y: turned.y || 0 };
  }
  return { x: 0, y: -1 };
}

/**
 * Куда встают знаки стопки: `markId → {index, count, px, at, dir, stepPx,
 * heightMm}`. `px` — смещение знака в пикселях плана, `at` — то же в долях
 * плана (ими живут точки метки), `index` 0 — знак остался на настоящей точке.
 *
 * Метки в стопке **не перемешиваются случайно**:
 *
 * — совпавшие собираются от затравки, а не цепочкой. Затравка — первая по
 *   порядку объекта метка, не попавшая в чужую стопку; к ней притягиваются те,
 *   что ближе порога **к ней самой**. Цепочкой плотный ряд розеток съехался бы
 *   в одну стопку через весь план, хотя соседи в нём различимы;
 * — порядок в стопке — **метки без высоты, затем по возрастанию высоты над
 *   полом**, при равенстве — порядок объекта (порядок постановки). Читается
 *   стопка от настоящей точки наружу, и читается она так же, как развёртка
 *   снизу вверх: у пола — ближе к точке, выше над полом — дальше. Метки без
 *   высоты стоят там, где на развёртке стоит их полоса, — перед полом
 *   (таск 129): высоты у них нет, и места в порядке высот им не придумано;
 * — на настоящей точке остаётся первый знак стопки, а не середина: у двух
 *   меток уезжает ровно одна, и на плане заказчика разъедется минимум из
 *   возможного.
 */
function markStackPlaceAll(project, scheme, filter, sizes) {
  const result = new Map();
  const list = visibleMarks(project, scheme, filter).filter(markStackable);
  if (list.length < 2) return result;
  const width = schemeWidthPx(scheme);
  const height = schemeHeightPx(scheme);
  const reach = sizes.radius * MARK_STACK_REACH_RATIO;
  const stepPx = sizes.radius * MARK_STACK_STEP_RATIO;
  const order = new Map(list.map((mark, index) => [mark.id, index]));
  const taken = new Set();
  for (const seed of list) {
    if (taken.has(seed.id)) continue;
    taken.add(seed.id);
    const at = seed.points[0];
    const members = [seed];
    for (const other of list) {
      if (taken.has(other.id)) continue;
      const dx = (other.points[0].x - at.x) * width;
      const dy = (other.points[0].y - at.y) * height;
      if (Math.hypot(dx, dy) > reach) continue;
      taken.add(other.id);
      members.push(other);
    }
    if (members.length < 2) continue;
    members.sort((first, second) => {
      const a = markStackHeight(first);
      const b = markStackHeight(second);
      if (a === null && b !== null) return -1;
      if (b === null && a !== null) return 1;
      if (a !== null && b !== null && a !== b) return a - b;
      return order.get(first.id) - order.get(second.id);
    });
    const dir = markStackDirection(project, scheme, members);
    const span = stepPx * (members.length - 1);
    // Непривязанная стопка уходит вверх, а у метки под верхним краем плана
    // вверху места нет: уехавший за край знак на выгрузке «весь план» просто
    // отрезан. Тогда она уходит вниз — а если не влезает ни туда, ни туда (две
    // дюжины меток в одной точке длиннее плана), то в ту сторону, где места
    // больше: потерять меньше лучше, чем потерять больше.
    //
    // Разворачивается только **непривязанная** стопка: у привязанной сторону
    // решает стена, и разворот поставил бы знаки внутрь стены и в соседнюю
    // комнату — соврал бы о месте, а не о красоте.
    const free = dir.x === 0 && dir.y === -1;
    const above = at.y * height;
    const below = height - above;
    const flip = free && above - span < 0 && (below >= span || below > above);
    const step = flip ? { x: 0, y: 1 } : dir;
    members.forEach((mark, index) => {
      const px = { x: step.x * stepPx * index, y: step.y * stepPx * index };
      result.set(mark.id, {
        index,
        count: members.length,
        px,
        at: { x: px.x / width, y: px.y / height },
        dir: step,
        stepPx,
        // Высота знака на плане не подписана (G188), но порядок в стопке
        // решает она — поле остаётся ключом этого порядка.
        heightMm: markStackHeight(mark),
      });
    });
  }
  return result;
}

// Кэш стопок — тот же приём, что у раскладки подписей: объект после любой
// правки новый, поэтому `WeakMap` сам забывает устаревшее. Внутри — по схеме,
// величине знака и фильтру: спрашивают стопку и кадр холста, и попадание по
// клику на каждое движение мыши.
const markStackCache = new WeakMap();

/** Стопки схемы. Фильтр учитывается: спрятанная метка никого не накрывает. */
export function markStacks(project, scheme, filter, view) {
  if (!project || !scheme) return new Map();
  const state = renderView(view);
  const sizes = labelPlanSizes(state);
  const key = [scheme.id, sizes.radius, labelFilterKey(filter)].join("|");
  let byKey = markStackCache.get(project);
  if (!byKey) {
    byKey = new Map();
    markStackCache.set(project, byKey);
  }
  let value = byKey.get(key);
  if (!value) {
    value = markStackPlaceAll(project, scheme, filter, sizes);
    byKey.set(key, value);
  }
  return value;
}

/**
 * Точки знака метки в долях плана — **единственная дверь** к тому, где знак
 * нарисован. Её спрашивают и рисование, и попадание по клику, и подпись: пока
 * дверь одна, клик не может разойтись с рисунком.
 */
export function markStackPoints(mark, stacks) {
  const points = (mark && mark.points) || [];
  const shift = stacks && mark ? stacks.get(mark.id) : null;
  if (!shift) return points;
  return points.map((point) => ({ x: point.x + shift.at.x, y: point.y + shift.at.y }));
}

// ——— высота в стопке больше не подписывается (G188) ———————————————————
//
// Таск 131 рисовал у каждого знака стопки бледное «h=900» — так заказчик
// просил тогда: «сразу на каких высотах». Посмотрев на готовый план, он эту
// часть своего же требования снял: «на схеме при расстановке в колонку не
// указывай их высоту». Числа загромождали план, а стопка он оставил.
//
// Высота не потерялась: она лежит в метке (`heightAboveFloor`), видна в
// карточке метки и в строке списка («В 900 мм»), а на развёртке стен у каждой
// метки подписана рядом со знаком. Порядок стопки её по-прежнему решает —
// `heightMm` в записи стопки остался ключом порядка, просто не рисуется.

// ——— подписи —————————————————————————————————————————————————————————

// Точка привязки подписи: для одиночной метки — её точка, для группы — середина
// между входящими метками. Смещение подписи хранится в пикселях плана, поэтому
// поворот плана уносит её вместе с меткой.
//
// Точка берётся **там, где нарисован знак** (`markStackPoints`): метку, уехавшую
// в стопку совпавших, подпись обязана догнать, иначе «Р1» осталось бы у чужого
// знака. Стопки нет — точка та же, что была всегда.
function labelOrigin(project, target, stacks) {
  if (target.markIds) {
    const points = labelMemberIds(target)
      .map((id) => project.marks.find((mark) => mark.id === id))
      .filter(Boolean)
      .map((mark) => markStackPoints(mark, stacks)[0]);
    if (points.length === 0) return { x: 0, y: 0 };
    const sum = points.reduce((acc, point) => ({ x: acc.x + point.x, y: acc.y + point.y }), { x: 0, y: 0 });
    return { x: sum.x / points.length, y: sum.y / points.length };
  }
  return markStackPoints(target, stacks)[0];
}

// Метки блока, по которым собирается подпись: под фильтром — только видимые
// (`shownIds` кладёт labelTargets), иначе весь блок. Смещение подписи это не
// трогает: его держит первая метка блока, видимая она или нет.
function labelMemberIds(target) {
  return target.shownIds || target.markIds;
}

// Ведущая метка подписи: у блока — та, с которой подпись начинается,
// у одиночной метки — она сама. По ней берётся цвет подписи: подпись
// «В1, Р1» красится зелёным выключателя, а не красным розетки.
export function labelLead(project, target) {
  if (!target) return null;
  if (!target.markIds) return target;
  const [lead] = blockMembers(project, labelMemberIds(target));
  return lead || null;
}

/**
 * Куда встаёт подпись, минуя раскладку: `null` — раскладка решает сама.
 *
 * Два случая. Оттащенная рукой подпись стоит по своему `labelOffset` — это
 * задал пользователь. **Плашка комментария без указателя стоит на своей
 * точке** и своего смещения не слушает вовсе: «У простого комментария можно
 * точку просто привязать к подписи». Смещение при этом не стирается — включат
 * указатель, и плашка вернётся туда, где её оставили рукой.
 *
 * Единственное место, где это решается: раскладка (`labelPlaceAll`) обязана
 * считать место плашки занятым ровно там, где его потом покажет `labelPlaceOf`.
 */
function labelFixedPlace(project, target, sizes) {
  if (markIsComment(target) && !markPointer(target)) {
    const size = commentPlateSize(labelTextOf(project, target), sizes.font, sizes.family);
    return { dx: -size.width / 2, dy: 0 };
  }
  return labelOffsetOf(project, target);
}

// Смещение подписи. У группы своего поля модель не заводит — её подпись стоит
// по смещению первой метки блока (собственной подписи у этой метки нет,
// подпись у блока одна), и правится оно обычным updateMark.
export function labelOffsetOf(project, target) {
  if (!target.markIds) return target.labelOffset || null;
  if (target.labelOffset) return target.labelOffset;
  const first = project.marks.find((mark) => mark.id === target.markIds[0]);
  return first && first.labelOffset ? first.labelOffset : null;
}

// Текст подписи: у блока — свёрнутый в диапазон список, у одиночной метки — её
// обозначение, у комментария — его текст.
//
// Плашка комментария — это его подпись, и второго текста у метки нет: поле
// «Комментарий» (`mark.original`) и плашка — одно и то же. Пустая плашка
// показывает название поля, как пустое поле ввода: иначе комментарий без
// текста стал бы невидимым и его нельзя было бы ни выделить, ни дописать, ни
// удалить. О самой пустоте говорит `validate` — находкой, а не молчанием.
function labelTextOf(project, target) {
  if (markIsComment(target)) return markCommentText(target) || strings.marks.comment;
  return (target.markIds ? blockLabel(project, labelMemberIds(target)) : labelOf(project, target.id)) || "";
}

// ——— потолок длины подписи ————————————————————————————————————————————
//
// Свёртки в диапазон мало. На снимке заказчика блок из трёх розеток и витой
// пары подписан «Р8Р9Р10, RJ2»; свёртка делает из этого «Р8–10, RJ2» — на три
// знака короче, но всё ещё вдвое шире самого блока. Поэтому у подписи есть
// потолок, и при переполнении она **переносится**, а не обрезается: каждый
// номер в ней — адрес розетки, и спрятанный многоточием номер делает план
// врущим. Прятать нечего — можно только сложить.

/**
 * Потолок строки подписи в знаках.
 *
 * Восемь — это самый частый смешанный блок целиком: «В1, Р1Р2» (выключатель и
 * две розетки в одной рамке) остаётся одной строкой, какой и был, вместе со
 * всеми подписями короче. Переносится то, что длиннее: «Р8–10, RJ2» ложится в
 * два этажа по пять знаков вместо одной строки в десять.
 *
 * В пикселях плана при обычном кегле 12 это около семидесяти — ширина блока из
 * четырёх розеток. Подпись перестаёт быть заметно длиннее того, что подписывает,
 * и это весь смысл числа: мерить подпись шириной блока точнее (блок бывает и в
 * шесть точек), но тогда одна и та же подпись переползала бы с этажа на этаж от
 * ползунка величины метки.
 *
 * Мера — знаки, а не пиксели, как и перенос плашки комментария: ширину рамки
 * меряет шрифт (`labelTextWidth`), а складывать ли подпись — нет, иначе одна
 * и та же подпись складывалась бы по-разному на экране и в выгрузке.
 */
const LABEL_WRAP_CHARS = 8;
// Высота строки подписи в долях кегля. Та же, что у габарита одной строки:
// одной строкой подпись обязана занимать ровно то, что занимала всегда.
const LABEL_LINE = 1.2;

/**
 * Куски подписи, разложенные по строкам: `[{text, from, to}]`.
 *
 * Перенос идёт **только по запятым** — тем самым разделителям, которые склеила
 * `blockLabelParts`. Внутри куска строка не рубится никогда: «Р8–10» — одно
 * обозначение, и разорванное посередине оно читается как два других.
 *
 * Запятая остаётся на строке слева, как пунктуация в наборе, а пробел после
 * неё на переносе съедается. В потолок она не считается — висит за ним, как
 * знак в наборе свисает на поле: иначе «В1, Р1–3, RJ1» пришлось бы рвать перед
 * «Р1–3», где строка ещё не кончилась. `from`/`to` — границы кусков: по ним
 * рисование раздаёт строкам цвета, не пересчитывая разбивку во второй раз.
 *
 * Кусок длиннее потолка (код типа бывает в шестнадцать букв) строку
 * переполняет — и остаётся целым: перенос обещает сложить подпись, а не
 * уложиться во что бы ни стало.
 */
function labelWrap(parts, limit = LABEL_WRAP_CHARS) {
  const lines = [];
  let from = 0;
  let line = "";
  const flush = (to) => {
    if (to <= from) return;
    lines.push({ text: line.trimEnd(), from, to });
    from = to;
    line = "";
  };
  for (let index = 0; index < parts.length; index += 1) {
    const piece = parts[index].text;
    const separator = piece === BLOCK_LABEL_SEPARATOR;
    if (!separator && line !== "" && line.length + piece.length > limit) flush(index);
    line += piece;
  }
  flush(parts.length);
  return lines;
}

/**
 * Строки подписи цели. Одна строка — у всех, кроме переполнившего потолок
 * блока: у одиночной метки кусков нет вовсе, а плашка комментария переносится
 * своим правилом (`commentPlateLines`) и сюда не заходит.
 *
 * Склейка строк обязана совпасть с самой подписью — разойдись они, обводка
 * легла бы по одной строке, а буквы по другой. Разошлись — подпись остаётся
 * одной строкой, какой была: лучше длинная, чем рваная.
 */
function labelLinesOf(project, target, value) {
  const whole = [{ text: value, from: 0, to: 0 }];
  if (!target || !target.markIds || markIsComment(target)) return whole;
  const parts = blockLabelParts(project, labelMemberIds(target));
  if (parts.length === 0) return whole;
  const lines = labelWrap(parts);
  // Сравнение без пробелов: перенос съедает ровно пробел после запятой, и
  // только его.
  const joined = lines.map((line) => line.text).join("");
  if (joined.replace(/\s+/g, "") !== value.replace(/\s+/g, "")) return whole;
  return lines;
}

// Куски одной строки подписи. Последний теряет пробел после запятой — ровно
// тот, который съел перенос: иначе буквы разошлись бы с обводкой на ширину
// пробела.
function labelLineRuns(runs, line) {
  if (!runs || line.to <= line.from) return null;
  const pieces = runs.slice(line.from, line.to).map((run) => ({ ...run }));
  const last = pieces[pieces.length - 1];
  if (last) last.text = last.text.trimEnd();
  if (pieces.map((piece) => piece.text).join("") !== line.text) return null;
  return pieces;
}

// ——— плашка комментария ———————————————————————————————————————————————
//
// Плашка — прямоугольник со скруглёнными углами и текстом внутри (G163).
// Размер — по тексту, но с потолком: заказчик пишет на плане замечание, а не
// письмо, и длинный комментарий одной строкой закрыл бы полплана. Поэтому
// строка переносится по словам на `COMMENT_PLATE_CHARS` знаков, а выше
// `COMMENT_PLATE_ROWS` строк текст обрезается многоточием — целиком он
// по-прежнему в поле и в карточке метки.
//
// Перенос — по знакам, а ширина рамки — по самой длинной строке, измеренной
// шрифтом (`labelTextWidth`): «сделай что бы комментарий растягивался по
// ширине текста, а то сейчас сильно больше».
const COMMENT_PLATE_CHARS = 26;
const COMMENT_PLATE_ROWS = 6;
// Поля внутри плашки и высота строки — в долях кегля.
const COMMENT_PLATE_PAD = 0.5;
const COMMENT_PLATE_LINE = 1.25;
// Скругление углов — в долях кегля, но не больше половины высоты плашки.
const COMMENT_PLATE_RADIUS = 0.5;
// Во сколько раз плашка с указателем отходит от своей точки дальше обычной
// подписи. Слова заказчика про указатель: «соединительная линия между точкой и
// подписью чтобы была… более очевидная». Встань плашка вплотную, как
// обозначение, — линия вышла бы в десяток пикселей, и указателя было бы не
// разглядеть. Отодвинутую рукой плашку это не трогает: у неё своё смещение.
const COMMENT_POINTER_GAP = 3.5;
// Радиус точки комментария — в долях радиуса знака. Точка не знак: это место на
// плане, в которое смотрит указатель, и рисуется она мелкой кляксой, чтобы не
// спорить с обозначениями вокруг.
const COMMENT_POINT_RATIO = 0.4;

/**
 * Радиус точки комментария на экране — одна дверь на рисование и на попадание.
 *
 * Нужна она с таска 141: точку комментария возят отдельно от плашки (G199),
 * значит по ней кликают, — а мерить это попадание знаком типа (`style.shape`)
 * нельзя. Знак у встроенного типа — `rect-horizontal`, то есть сама плашка:
 * клик ловился бы прямоугольником размером со знак вокруг точки, которая
 * нарисована вчетверо меньше. Правило «попадание считается тем же кодом, что
 * отрисовка» для точки комментария — это и есть.
 */
export function commentPointRadius(view) {
  return Math.max(2, markRadius(view) * COMMENT_POINT_RATIO);
}

/**
 * Текст плашки, разложенный по строкам. Перенос по словам; слово длиннее
 * строки рубится, иначе плашка расползлась бы ради одного «ЩС-вводной-кабель».
 */
export function commentPlateLines(value, limit = COMMENT_PLATE_CHARS, rows = COMMENT_PLATE_ROWS) {
  const source = String(value == null ? "" : value).trim();
  if (!source) return [""];
  const words = source.split(/\s+/);
  const lines = [];
  let line = "";
  const push = () => {
    lines.push(line);
    line = "";
  };
  for (const word of words) {
    let rest = word;
    // Длинное слово рубится по месту: сперва добивается начатая строка, потом
    // кусками по целой строке.
    while (rest.length > limit) {
      const room = limit - (line ? line.length + 1 : 0);
      if (room <= 0) {
        push();
        continue;
      }
      line = (line ? line + " " : "") + rest.slice(0, room);
      rest = rest.slice(room);
      push();
    }
    if (!rest) continue;
    if (!line) {
      line = rest;
      continue;
    }
    if (line.length + 1 + rest.length <= limit) {
      line += " " + rest;
      continue;
    }
    push();
    line = rest;
  }
  if (line) push();
  if (lines.length <= rows) return lines;
  const kept = lines.slice(0, rows);
  const last = kept[rows - 1];
  kept[rows - 1] = (last.length >= limit ? last.slice(0, Math.max(0, limit - 1)) : last) + "…";
  return kept;
}

/**
 * Габарит плашки в тех же единицах, в каких дан кегль: `labelPlanBox` считает
 * её в пикселях плана, `labelBoxIn` — в пикселях экрана. Одна функция на оба
 * счёта намеренно: разойдись они, плашка рисовалась бы одного размера, а
 * ловилась бы другого.
 */
function commentPlateSize(value, font, family) {
  const lines = commentPlateLines(value);
  const longest = lines.reduce((max, line) => Math.max(max, labelTextWidth(line, font, family)), 0);
  const pad = font * COMMENT_PLATE_PAD;
  return {
    lines,
    width: Math.max(font, longest) + pad * 2,
    height: lines.length * font * COMMENT_PLATE_LINE + pad * 2,
    pad,
  };
}

// Ключ цели в раскладке. Группа и метка живут в разных пространствах
// идентификаторов, но в одной таблице — отсюда приставка.
function labelKeyOf(target) {
  return (target.markIds ? "g:" : "m:") + target.id;
}

// Технический код ошибки контракта — как в `store.js`, наружу он не выходит:
// это промах вызывающего, а не сообщение пользователю.
const LABEL_FILTER_ERROR = "label-layout-instead-of-filter";

// Пятый аргумент — **фильтр**, ровно тот же, что у `hitTest`, `drawScheme` и
// `visibleMarks`: раскладка считается по тем подписям, которые видит
// вызывающий. Передать сюда готовую раскладку нельзя — `Map` молча сошла бы за
// «фильтра нет», подписи разделили бы места со скрытыми, и клик разошёлся бы с
// картинкой. Внутри модуля для уже посчитанной раскладки есть `labelBoxIn`.
// Угол подписи: 0 — лежит, 90 — стоит вдоль стены. Хранится там же, где
// смещение: у группы своего поля модель не заводит, поэтому поворот блока
// живёт у его первой метки.
export function labelAngleOf(project, target) {
  if (!target) return 0;
  // Плашка комментария не поворачивается: вдоль стены пишут обозначение в две
  // буквы, а не абзац текста в рамке. Ручку поворота у неё холст и не рисует.
  if (markIsComment(target)) return 0;
  if (target.labelAngle === 90 || target.labelAngle === 0) return target.labelAngle;
  if (!target.markIds) return 0;
  const first = project.marks.find((mark) => mark.id === target.markIds[0]);
  return first && first.labelAngle === 90 ? 90 : 0;
}

// Габарит подписи от точки привязки текста. Лежачая идёт вправо и висит на
// середине строки; повёрнутая читается снизу вверх, поэтому растёт вверх, а
// вширь занимает высоту строки.
export function labelSpan(width, height, angle) {
  if (angle === 90) return { left: -height / 2, right: height / 2, top: -width, bottom: 0 };
  return { left: 0, right: width, top: -height / 2, bottom: height / 2 };
}

// Прямоугольник подписи на экране: левый верхний угол и размеры. По нему
// считаются и попадание по клику, и разведение — расходиться им нельзя.
export function labelBounds(box) {
  const span = labelSpan(box.width, box.height, box.angle);
  return {
    x: box.x + span.left,
    y: box.y + span.top,
    width: span.right - span.left,
    height: span.bottom - span.top,
  };
}

export function labelBox(project, scheme, target, view, filter) {
  if (filter instanceof Map) {
    const error = new Error(LABEL_FILTER_ERROR);
    error.code = LABEL_FILTER_ERROR;
    throw error;
  }
  const state = renderView(view);
  return labelBoxIn(
    project,
    scheme,
    target,
    state,
    labelLayout(project, scheme, filter, state),
    markStacks(project, scheme, filter, state),
  );
}

// То же самое с уже посчитанной раскладкой: кадр холста и попадание по клику
// считают её один раз на все подписи схемы, а не заново на каждую.
function labelBoxIn(project, scheme, target, state, layout, stacks) {
  const font = labelFontSize(state);
  const anchor = planToScreen(labelOrigin(project, target, stacks), scheme, state);
  const value = labelTextOf(project, target);
  const plate = markIsComment(target) ? commentPlateSize(value, font, state.fontFamily) : null;
  // Строки подписи — те же, что мерила раскладка: переполнившая потолок
  // подпись блока переносится по запятым (D29). Одна строка — `lines` из
  // одного куска, и всё считается как раньше.
  const lines = plate ? null : labelLinesOf(project, target, value);
  const size = plate || labelLinesSize(lines, font, state.fontFamily);
  const place = labelPlaceOf(project, scheme, target, state, layout);
  return {
    text: value,
    lines,
    x: anchor.x + place.dx * state.zoom,
    y: anchor.y + place.dy * state.zoom,
    width: size.width,
    height: size.height,
    font,
    // Семейства едут вместе с кеглем: рисует подпись тот, у кого на руках
    // только `box`. Габарит меряется тем же шрифтом (`labelTextWidth`), и
    // раскладка держит семейство в ключе.
    family: state.fontFamily,
    // Плашка комментария: строки и поля внутри рамки — рисованию и попаданию
    // по клику достаётся один и тот же габарит. У обычной подписи этих полей
    // нет вовсе, и `plate: null` значит «рисуй как рисовал».
    plate,
    pointer: markPointer(target),
    // Смещение подписи в пикселях плана — в тех же единицах, что `labelOffset`
    // у метки. Отсюда его берёт перетаскивание: подпись, которую разводка
    // отодвинула, не прыгает обратно, когда за неё взялись мышью.
    dx: place.dx,
    dy: place.dy,
    row: place.row,
    crowded: place.crowded,
    angle: labelAngleOf(project, target),
  };
}

// Где стоит подпись. Оттащенная руками — строго по своему смещению: его задал
// пользователь, и трогать его нельзя. Остальные — по месту из раскладки.
function labelPlaceOf(project, scheme, target, state, layout) {
  const manual = labelFixedPlace(project, target, labelPlanSizes(state));
  if (manual) return { dx: manual.dx, dy: manual.dy, row: 0, crowded: false };
  const place = layout.get(labelKeyOf(target));
  if (place) return place;
  // Цели в раскладке нет — значит она в неё и не входила: метку спрятал фильтр
  // или она с другой схемы. Такая подпись не рисуется; место ей даётся
  // стандартное, то самое, где подпись стояла всегда.
  const [slot] = labelSlots(
    labelPlanSizes(state).gap * (markPointer(target) ? COMMENT_POINTER_GAP : 1),
    labelSpan(0, 0, 0),
    0,
    { left: 0, right: 0 },
    labelLeadSide(project, scheme, target),
  );
  return { dx: slot.dx, dy: slot.dy, row: 0, crowded: false };
}

// Подписи рисуются у меток без группы и по одной на группу. Цель группы несёт
// `shownIds` — метки блока, прошедшие фильтр: на листе розеток от смешанного
// блока остаётся «Р1», а не «В1, Р1» с невидимым выключателем.
function labelTargets(project, scheme, filter) {
  const marks = visibleMarks(project, scheme, filter);
  const targets = [];
  const byGroup = new Map();
  for (const mark of marks) {
    if (!mark.groupId) {
      targets.push(mark);
      continue;
    }
    let target = byGroup.get(mark.groupId);
    if (!target) {
      const group = findGroup(project, mark.groupId);
      if (!group) {
        targets.push(mark);
        continue;
      }
      target = { ...group, shownIds: [] };
      byGroup.set(mark.groupId, target);
      targets.push(target);
    }
    target.shownIds.push(mark.id);
  }
  return targets;
}

// ——— разведение подписей ——————————————————————————————————————————————
//
// Метка стоит там, где стоит железка на стене, и двигать её нельзя. Двигать
// можно только подпись — а подписи соседних меток запросто перекрывают друг
// друга: код типа бывает в шестнадцать букв, а розетки стоят в сорока
// пикселях одна от другой. Перекрытая подпись съедает номер, а номер —
// единственное, ради чего подпись на плане и стоит.
//
// Раскладка перебирает для каждой подписи короткий список мест вокруг её
// метки и берёт первое свободное. Три свойства, ради которых всё считается
// именно так:
//
// 1. Считается в пикселях плана, а не экрана. Экран и выгрузка отличаются
//    только масштабом, и подпись уезжает на `dx × zoom` — значит распечатка
//    повторяет то, что видел инженер, знак в знак.
// 2. Порядок обхода — сверху вниз, слева направо, при равенстве по ключу.
//    Одна и та же схема, открытая дважды, раскладывается одинаково.
// 3. Жадность вместо оптимума: перебор мест у каждой подписи ограничен, чужие
//    подписи уже расставлены и не переставляются. Полсотни меток — это полсотни
//    коротких переборов, а не поиск идеальной раскладки.

// Сколько рядов вверх и вниз пробует раскладка, прежде чем сдаться. Ряд — это
// высота подписи: дальше подпись уже не читается как «эта, у этой метки».
const LABEL_ROWS = 3;
// Просвет между соседними подписями в пикселях плана: вплотную поставленные
// строки читаются как одна.
const LABEL_PAD = 2;

// Кегль и отступ в пикселях плана. Те же нижние границы, что у экранных
// `labelFontSize` и `markRadius` при единичном масштабе. Семейства — те же,
// что у кадра: ширина подписи меряется тем шрифтом, которым она рисуется.
function labelPlanSizes(state) {
  const radius = Math.max(2, state.markSize);
  return { font: Math.max(6, state.labelSize), gap: radius * LABEL_GAP, radius, family: state.fontFamily };
}

// Куда уходить подписи линии. У точки подпись встаёт справа и ни с чем не
// спорит, а у ломаной справа от первой вершины лежит она сама: линия, идущая
// вправо, проходит ровно под своей подписью. Заказчик: «по направлению первого
// сегмента» — значит подпись уходит **поперёк** этого направления.
//
// Почти вертикальная первая сторона правила не меняет: подпись справа от неё
// и так в стороне от линии. Почти горизонтальная уводит подпись по вертикали —
// вверх, а если сегмент сам идёт вверх, то вниз: в обе стороны от линии
// одинаково свободно, и выбирается та, куда линия не пошла.
//
// Считается в пикселях плана: план бывает 1000×500, и «горизонтальнее ли»
// решается тем же счётом, что угол отрезка.
function labelLeadSide(project, scheme, target) {
  const lead = labelLead(project, target);
  const points = (lead && lead.kind === "line" && lead.points) || [];
  if (points.length < 2) return null;
  const dx = (points[1].x - points[0].x) * schemeWidthPx(scheme);
  const dy = (points[1].y - points[0].y) * schemeHeightPx(scheme);
  if (Math.abs(dx) < Math.abs(dy)) return null;
  if (dx === 0 && dy === 0) return null;
  return { sign: dy >= 0 ? -1 : 1 };
}

// Места вокруг метки в порядке убывания желанности.
//
// Первое — **справа, на уровне метки**: заказчик просил подпись «не сверху
// справа, а просто справа». Ряд обозначений на одной высоте так и читается
// строкой, а не лесенкой. Второе — слева на том же уровне, для метки у правого
// края плана. Дальше — те же две стороны ряд за рядом вверх и вниз, для тех,
// кому на своём уровне не хватило места.
//
// `dx` — смещение левого края подписи, `dy` — её середины: слева подпись
// отодвигается на всю свою ширину.
function labelSlots(gap, span, angle, reach = { left: 0, right: 0 }, lead = null) {
  const tall = span.bottom - span.top;
  // Шаг ряда — высота подписи и два просвета: соседние ряды обязаны разойтись
  // с запасом, иначе проверка наложения упирается в ноль и решает исход по
  // погрешности последнего разряда.
  const step = tall + LABEL_PAD * 2;
  // Подпись отсчитывается от края цели, а не от её середины: у блока точка
  // привязки — середина между метками, и подпись «В1В2В3», встав на уровень
  // меток, легла бы поверх крайней из них.
  const right = reach.right + gap - span.left;
  const left = -reach.left - gap - span.right;
  // Лежачая подпись висит серединой строки у точки привязки, повёрнутая растёт
  // от неё вверх — её середина на полстолбца выше, и уровень метки для неё
  // считается отсюда.
  const middle = angle === 90 ? tall / 2 : 0;
  const slots = [
    { dx: right, dy: middle, row: 0 },
    { dx: left, dy: middle, row: 0 },
  ];
  // У линии первыми пробуются места над началом и под ним: вбок от первой
  // вершины идёт сама линия. Ближний край подписи отстоит от точки привязки на
  // тот же просвет `gap`, что и у боковых мест, — мера одна.
  if (lead) {
    const away = { dy: lead.sign < 0 ? -gap - span.bottom : gap - span.top };
    const back = { dy: lead.sign < 0 ? gap - span.top : -gap - span.bottom };
    slots.unshift(
      { dx: right, dy: away.dy, row: 0 },
      { dx: left, dy: away.dy, row: 0 },
      { dx: right, dy: back.dy, row: 0 },
      { dx: left, dy: back.dy, row: 0 },
    );
  }
  for (let row = 1; row <= LABEL_ROWS; row += 1) {
    const up = middle - row * step;
    const down = middle + row * step;
    slots.push({ dx: right, dy: up, row });
    slots.push({ dx: right, dy: down, row });
    slots.push({ dx: left, dy: up, row });
    slots.push({ dx: left, dy: down, row });
  }
  return slots;
}

// Насколько метки цели расходятся от точки привязки вправо и влево, в долях
// плана. У одиночной точки это ноль, у блока — половина его ширины: подпись
// обязана встать за крайней меткой блока, а не поверх неё. Вершины ломаной в
// счёт не идут: её подпись стоит у первой вершины, и тянуть её за весь трек
// через полплана незачем.
function labelReach(project, target, stacks) {
  const origin = labelOrigin(project, target, stacks);
  const ids = target.markIds ? labelMemberIds(target) : null;
  const marks = ids
    ? ids.map((id) => project.marks.find((mark) => mark.id === id)).filter(Boolean)
    : [target];
  let left = 0;
  let right = 0;
  for (const mark of marks) {
    if (!mark || mark.kind === "line") continue;
    for (const point of markStackPoints(mark, stacks)) {
      right = Math.max(right, point.x - origin.x);
      left = Math.max(left, origin.x - point.x);
    }
  }
  return { left, right };
}

// Габарит подписи по её строкам: ширина — самая длинная строка, высота — их
// число. Одной строкой выходит ровно то, что выходило всегда.
function labelLinesSize(lines, font, family) {
  const longest = lines.reduce((max, line) => Math.max(max, labelTextWidth(line.text, font, family, 600)), 0);
  return {
    width: Math.max(font * 0.8, longest),
    height: lines.length * font * LABEL_LINE,
  };
}

// Подпись в пикселях плана: `x`, `y` — точка привязки (сама метка), размеры —
// оценка по числу знаков, та же, что у экранного `labelBox`.
function labelPlanBox(project, scheme, target, sizes, stacks) {
  const origin = labelOrigin(project, target, stacks);
  const text = labelTextOf(project, target);
  const reach = labelReach(project, target, stacks);
  const lead = labelLeadSide(project, scheme, target);
  const width = schemeWidthPx(scheme);
  // Плашка комментария шире и выше строки: её габарит считает `commentPlateSize`
  // по тем же знакам и тому же кеглю. Раскладке она от этого не чужая — место
  // ей ищется тем же перебором, и соседние подписи её обходят.
  const plate = markIsComment(target) ? commentPlateSize(text, sizes.font, sizes.family) : null;
  // Перенесённая подпись блока занимает две строки и половину прежней ширины —
  // раскладка обязана мерить то же, что рисуется, иначе подписи наедут.
  const lines = plate ? null : labelLinesOf(project, target, text);
  const size = plate || labelLinesSize(lines, sizes.font, sizes.family);
  return {
    text,
    lines,
    x: origin.x * width,
    y: origin.y * schemeHeightPx(scheme),
    width: size.width,
    height: size.height,
    angle: labelAngleOf(project, target),
    reach: { left: reach.left * width, right: reach.right * width },
    lead,
  };
}

function labelRect(box, offset) {
  const span = labelSpan(box.width, box.height, box.angle);
  return {
    x: box.x + offset.dx + span.left,
    y: box.y + offset.dy + span.top,
    width: span.right - span.left,
    height: span.bottom - span.top,
  };
}

// Площадь наложения двух подписей с учётом обязательного просвета. Ноль — место
// свободно; иначе число тем больше, чем хуже: по нему выбирается наименее
// плохое место, когда свободных не осталось.
function labelOverlap(a, b) {
  const wide = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) + LABEL_PAD;
  const tall = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) + LABEL_PAD;
  return wide > 0 && tall > 0 ? wide * tall : 0;
}

// Подпись целиком на плане. Выгрузка «весь план» рисует ровно прямоугольник
// плана — всё, что за его краем, на картинке просто отрезано.
function labelInsidePlan(rect, width, height) {
  return rect.x >= 0 && rect.x + rect.width <= width && rect.y >= 0 && rect.y + rect.height <= height;
}

// Фильтр меняет состав подписей, а значит и раскладку: ключ кэша обязан его
// учитывать.
function labelFilterKey(filter) {
  if (!filter) return "-";
  return [
    Array.isArray(filter.categoryIds) ? filter.categoryIds.join(",") : "*",
    Array.isArray(filter.typeIds) ? filter.typeIds.join(",") : "*",
    // Скрытые комментарии меняют состав подписей так же, как снятая галочка
    // типа: ключ кэша раскладки обязан их учитывать, иначе плашки исчезли бы
    // с плана, а их места остались бы занятыми.
    filter.comments === false ? "nc" : "*",
    filter.roomId || "",
    (filter.query || "").trim().toLowerCase(),
  ].join("|");
}

function labelPlaceAll(project, scheme, filter, sizes, stacks) {
  const planWidth = schemeWidthPx(scheme);
  const planHeight = schemeHeightPx(scheme);
  const layout = new Map();
  const entries = labelTargets(project, scheme, filter)
    .map((target) => ({
      key: labelKeyOf(target),
      box: labelPlanBox(project, scheme, target, sizes, stacks),
      offset: labelFixedPlace(project, target, sizes),
      gap: markPointer(target) ? sizes.gap * COMMENT_POINTER_GAP : sizes.gap,
    }))
    .filter((entry) => entry.box.text);
  entries.sort((a, b) => a.box.y - b.box.y || a.box.x - b.box.x || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

  // Оттащенные руками подписи в раскладку не попадают, но остаются на плане:
  // их места заняты, и остальные их обходят.
  const placed = entries.filter((entry) => entry.offset).map((entry) => labelRect(entry.box, entry.offset));

  // Сами метки — тоже занятые места. Подпись встала на уровень своей метки, и
  // у плотно поставленных точек соседний знак оказывается ровно там, куда
  // просится строка: без этого «Р6» легла бы на соседнюю розетку.
  //
  // Места занимают знаки **там, где они нарисованы**: уехавший в стопку знак
  // освобождает своё прежнее место и занимает новое. Подписи высот в этом
  // списке были до G188 — теперь их на плане нет, и место рядом со знаком
  // снова свободно для обозначений.
  for (const mark of visibleMarks(project, scheme, filter)) {
    for (const point of markStackPoints(mark, stacks)) {
      placed.push({
        x: point.x * planWidth - sizes.radius,
        y: point.y * planHeight - sizes.radius,
        width: sizes.radius * 2,
        height: sizes.radius * 2,
      });
    }
  }

  for (const entry of entries) {
    if (entry.offset) continue;
    const slots = labelSlots(
      entry.gap,
      labelSpan(entry.box.width, entry.box.height, entry.box.angle),
      entry.box.angle,
      entry.box.reach,
      entry.box.lead,
    );
    let best = null;
    for (const slot of slots) {
      const rect = labelRect(entry.box, slot);
      const inside = labelInsidePlan(rect, planWidth, planHeight);
      let overlap = 0;
      for (const other of placed) overlap += labelOverlap(rect, other);
      if (overlap === 0 && inside) {
        best = { slot, rect, overlap, inside };
        break;
      }
      // Свободного и целиком помещающегося места пока нет — запоминаем лучшее
      // из виденных: сперва по наложению, при равном наложении — то, что не
      // свешивается с плана.
      if (!best || overlap < best.overlap || (overlap === best.overlap && inside && !best.inside)) {
        best = { slot, rect, overlap, inside };
      }
    }
    placed.push(best.rect);
    layout.set(entry.key, { dx: best.slot.dx, dy: best.slot.dy, row: best.slot.row, crowded: best.overlap > 0 });
  }
  return layout;
}

// Кэш раскладки: объект после любой правки — новый (все функции модели чистые),
// поэтому WeakMap по объекту сам забывает устаревшее. Внутри — по схеме,
// размерам и фильтру: раскладка считается один раз, а зовут её и кадр холста,
// и попадание по клику на каждое движение мыши.
const labelLayoutCache = new WeakMap();

// Раскладка подписей схемы: ключ цели → смещение в пикселях плана.
// Оттащенных руками подписей в ней нет — у них своё смещение, и оно главнее.
export function labelLayout(project, scheme, filter, view) {
  if (!project || !scheme) return new Map();
  const state = renderView(view);
  const sizes = labelPlanSizes(state);
  // Шрифт в ключе: ширина подписи меряется им, а до прихода файла шрифта —
  // запасным, и такая раскладка обязана смениться, когда файл дойдёт.
  const key = [scheme.id, sizes.font, sizes.gap, sizes.family, labelMeasureReady(sizes.family), labelFilterKey(filter)].join("|");
  let byKey = labelLayoutCache.get(project);
  if (!byKey) {
    byKey = new Map();
    labelLayoutCache.set(project, byKey);
  }
  let value = byKey.get(key);
  if (!value) {
    value = labelPlaceAll(project, scheme, filter, sizes, markStacks(project, scheme, filter, state));
    byKey.set(key, value);
  }
  return value;
}

// ——— ручка поворота подписи ———————————————————————————————————————————
//
// Кнопка живёт на холсте, у самой подписи выделенной метки, а не в панели:
// поворачивают подпись, глядя на план — влезает она вдоль стены или нет, —
// и уводить руку в колонку ради этого незачем. Панель к тому же скрыта на
// узком экране, а холст виден всегда.

// Радиус ручки: как у ручек блока, чтобы попадать по ней не целясь. Вынесен
// наружу — им же меряется ручка поворота вещи чертежа (таск 168): ручка одна
// и та же, и мера у неё одна.
export const LABEL_TURN_RADIUS = 9;

// Цель подписи, которой принадлежит метка: у блока — его группа (подпись одна
// на всех), у одиночной метки — она сама. Скрытая фильтром метка цели не имеет.
export function labelTargetOf(project, scheme, markId, filter) {
  if (!project || !scheme || !markId) return null;
  for (const target of labelTargets(project, scheme, filter)) {
    if (target.markIds) {
      if (labelMemberIds(target).includes(markId)) return target;
    } else if (target.id === markId) {
      return target;
    }
  }
  return null;
}

// Ручка стоит у верхнего правого угла подписи — того самого, который не
// заслоняет текст ни лежачей подписи, ни стоячей. Считается от габарита, а не
// от метки: подпись комнаты берёт ту же ручку и тот же угол.
function turnHandleAt(rect, view) {
  const radius = Math.max(7, Math.min(LABEL_TURN_RADIUS, markRadius(view) * 0.8));
  return { x: rect.x + rect.width + radius * 0.6, y: rect.y - radius * 0.6, r: radius };
}

export function labelTurnHandle(project, scheme, target, view, filter) {
  if (!target) return null;
  // У плашки комментария поворота нет (`labelAngleOf` держит её лежачей), и
  // ручки у неё быть не должно: мёртвая кнопка хуже отсутствующей. Место
  // первой ручки занимает переключатель указателя — см. `labelLeaderHandle`.
  if (markIsComment(target)) return null;
  const box = labelBox(project, scheme, target, view, filter);
  if (!box.text) return null;
  return turnHandleAt(labelBounds(box), view);
}

export function hitLabelTurn(project, scheme, target, point, view, filter, extra = 0) {
  const handle = labelTurnHandle(project, scheme, target, view, filter);
  if (!handle) return false;
  return Math.hypot(point.x - handle.x, point.y - handle.y) <= handle.r + HIT_SLACK_PX + extra;
}

// ——— переключатель поводка ————————————————————————————————————————————
//
// Вторая ручка того же ряда, сразу за поворотом. Место у неё то же по той же
// причине: смотрят на поводок, глядя на план, — виден он на этом фоне или
// теряется, дотягивается до своей метки или упирается в соседнюю.
//
// **Переключатель на метку, а не на схему.** Поводок — часть чертежа: он
// рисуется `drawScheme`, значит уезжает в PNG, в печать и в лист «Схема».
// Общая настройка вида (как линейка) живёт в браузере и в файл не попадает —
// значит, распечатка у второго участника вышла бы другой. И жалоба заказчика
// адресная: пропадает поводок у той подписи, которую он только что оттащил, —
// вернуть его нужно ей, а не всем сразу.

// Держатель перебивки — там же, где смещение и угол подписи: у блока подпись
// одна на всех, и поле ей держит первая метка.
export function labelLeaderHolder(target) {
  if (!target) return null;
  return target.markIds ? target.markIds[0] : target.id;
}

/**
 * Рисуется ли поводок у этой подписи.
 *
 * Правило по умолчанию — прежнее: поводок есть у той подписи, которую
 * раскладка увела на ряд и дальше (`row > 0`), и его нет ни у стоящей вплотную,
 * ни у оттащенной рукой. Перебивка метки (`markLabelLeader`) отвечает раньше
 * правила — и `true`, и `false`.
 */
export function labelLeaderShown(project, target, box) {
  // У комментария поводок — это указатель, и спорить с ним нечему: «но
  // соединительная линия между точкой и подписью чтобы была всегда и более
  // очевидная». Включён указатель — линия есть всегда, выключен — плашка стоит
  // на точке, и соединять нечего. Перебивка поводка (`labelLeader`) тут не
  // спрашивается нарочно: второго выключателя у одной линии быть не должно.
  if (markIsComment(target)) return markPointer(target);
  const holder = labelLeaderHolder(target);
  const mark = holder ? findMark(project, holder) : null;
  const forced = markLabelLeader(mark);
  if (forced !== null) return forced;
  return Boolean(box && box.row > 0);
}

// Ручка стоит справа от поворота, вплотную: две кнопки одного ряда у одного
// угла подписи. Считается от ручки поворота, чтобы ряд не разъехался, когда у
// поворота поменяется радиус.
export function labelLeaderHandle(project, scheme, target, view, filter) {
  // У комментария эта кнопка одна — она включает указатель, — и стоит она на
  // месте первой ручки: ряда из двух у плашки нет, а дырка от поворота
  // читалась бы как пропавшая кнопка.
  if (markIsComment(target)) {
    const box = labelBox(project, scheme, target, view, filter);
    if (!box.text) return null;
    return turnHandleAt(labelBounds(box), view);
  }
  const turn = labelTurnHandle(project, scheme, target, view, filter);
  if (!turn) return null;
  return { x: turn.x + turn.r * 2.35, y: turn.y, r: turn.r };
}

export function hitLabelLeader(project, scheme, target, point, view, filter, extra = 0) {
  const handle = labelLeaderHandle(project, scheme, target, view, filter);
  if (!handle) return false;
  return Math.hypot(point.x - handle.x, point.y - handle.y) <= handle.r + HIT_SLACK_PX + extra;
}

// Значок — сам поводок: точка метки слева и пологая черта от неё к подписи.
// Выключенный приглушён и перечёркнут косой чертой сверху вниз — тем же знаком
// запрета, что на дорожных. Черта поводка нарочно **пологая**: будь она под
// 45°, запрет лёг бы к ней перпендикуляром и вместе они читались бы крестиком
// «закрыть», а не «поводка нет».
//
// Кнопка показывает, **что сейчас**, а не что случится по нажатию: это
// отметка, а не действие, — и соседний поворот подписи тут ей не пример.
export function drawLabelLeaderSwitch(ctx, handle, color, shown) {
  if (!handle) return;
  ctx.save();
  ctx.beginPath();
  ctx.arc(handle.x, handle.y, handle.r, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255, 255, 255, 0.95)";
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = color;
  ctx.stroke();
  const inner = handle.r * 0.56;
  const dot = { x: handle.x - inner, y: handle.y + inner * 0.42 };
  ctx.globalAlpha = shown ? 1 : 0.4;
  ctx.lineWidth = Math.max(1.2, handle.r * 0.17);
  ctx.beginPath();
  ctx.moveTo(dot.x, dot.y);
  ctx.lineTo(handle.x + inner, handle.y - inner * 0.42);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(dot.x, dot.y, Math.max(1.2, handle.r * 0.2), 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  if (!shown) {
    ctx.globalAlpha = 1;
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(1.3, handle.r * 0.22);
    ctx.beginPath();
    ctx.moveTo(handle.x - handle.r * 0.62, handle.y - handle.r * 0.62);
    ctx.lineTo(handle.x + handle.r * 0.62, handle.y + handle.r * 0.62);
    ctx.stroke();
  }
  ctx.restore();
}

// Значок — дуга со стрелкой: поворот, а не «плюс» и не «крест». Буквы здесь
// нельзя: строки живут в словаре, а на холсте рисуется фигура.
export function drawLabelTurn(ctx, handle, color) {
  if (!handle) return;
  ctx.save();
  ctx.beginPath();
  ctx.arc(handle.x, handle.y, handle.r, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255, 255, 255, 0.95)";
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = color;
  ctx.stroke();
  const inner = handle.r * 0.5;
  ctx.beginPath();
  ctx.arc(handle.x, handle.y, inner, Math.PI * 0.75, Math.PI * 2.1);
  ctx.lineWidth = Math.max(1.4, handle.r * 0.2);
  ctx.stroke();
  // Наконечник на конце дуги.
  const tip = polarPoint(handle.x, handle.y, inner, 135);
  ctx.beginPath();
  ctx.moveTo(tip.x, tip.y - inner * 0.55);
  ctx.lineTo(tip.x + inner * 0.55, tip.y);
  ctx.lineTo(tip.x, tip.y + inner * 0.55);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.restore();
}

// ——— контуры помещений ————————————————————————————————————————————————

// Цвет комнаты с прозрачностью: заливка контура не должна перебивать план,
// поэтому она всегда полупрозрачна, а линия — нет.
function outlineTint(color, alpha) {
  const hex = /^#[0-9a-fA-F]{6}$/.test(String(color || "")) ? color : OUTLINE_COLOR_FALLBACK;
  const value = parseInt(hex.slice(1), 16);
  return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`;
}

function outlineScreen(scheme, outline, view) {
  return outline.points.map((point) => planToScreen(point, scheme, view));
}

/**
 * Косая штриховка по контуру — **«пола нет»** (таск 209, G317).
 *
 * Снятый пол обязан быть виден на плане: человек, снявший его и забывший,
 * пойдёт искать причину в объёме. Выбрана штриховка, а не цвет и не подпись:
 * цвет у контура свой (его выбирает человек) и перекрашивать его значило бы
 * отнять выбор, подпись занимает место и спорит с именем помещения, а штриховка
 * ложится поверх любой заливки и на чёрно-белой распечатке остаётся собой.
 *
 * Рисуется она **тем же цветом**, что контур, и по его отсечке: наклон 45°,
 * шаг экранный.
 */
function drawOutlineHatch(ctx, screen, color) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of screen) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  if (!(maxX > minX) || !(maxY > minY)) return;
  ctx.save();
  // Отсечка — **свой** путь по тем же точкам: на чужой путь полагаться нельзя,
  // он один на холст и живёт до следующего `beginPath()`.
  ctx.beginPath();
  screen.forEach((point, index) => (index === 0 ? ctx.moveTo(point.x, point.y) : ctx.lineTo(point.x, point.y)));
  ctx.closePath();
  ctx.clip();
  ctx.lineWidth = OUTLINE_HATCH_LINE_PX;
  ctx.strokeStyle = outlineTint(color, 0.75);
  ctx.beginPath();
  // Косая под 45°: прямая `x + y = c` проходит по диагонали, и одного прохода
  // от левого верхнего угла до суммы сторон хватает на весь прямоугольник.
  const from = minX + minY;
  const to = maxX + maxY;
  for (let at = Math.ceil(from / OUTLINE_HATCH_PX) * OUTLINE_HATCH_PX; at <= to; at += OUTLINE_HATCH_PX) {
    ctx.moveTo(at - maxY, maxY);
    ctx.lineTo(at - minY, minY);
  }
  ctx.stroke();
  ctx.restore();
}

// Середина многоугольника для подписи: центр по площади, а не по вершинам, —
// у Г-образной комнаты он ближе к её телу, чем среднее углов.
function outlineCenter(points) {
  let area = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    const cross = points[j].x * points[i].y - points[i].x * points[j].y;
    area += cross;
    cx += (points[j].x + points[i].x) * cross;
    cy += (points[j].y + points[i].y) * cross;
  }
  if (Math.abs(area) < 1e-9) {
    const sum = points.reduce((acc, point) => ({ x: acc.x + point.x, y: acc.y + point.y }), { x: 0, y: 0 });
    return { x: sum.x / points.length, y: sum.y / points.length };
  }
  return { x: cx / (3 * area), y: cy / (3 * area) };
}

// Контуры схемы, прошедшие фильтр: сужение списка меток до одного помещения
// оставляет на плане и его контур — иначе лист по комнате обещает не ту комнату.
export function visibleOutlines(project, scheme, filter) {
  if (!project || !scheme) return [];
  const roomId = filter && filter.roomId ? filter.roomId : null;
  return outlinesInOrder(project, scheme.id).filter((outline) => !roomId || outline.roomId === roomId);
}

function outlineColor(project, outline) {
  const room = findRoom(project, outline.roomId);
  return (room && room.color) || OUTLINE_COLOR_FALLBACK;
}

// Ручки вершин пути: квадрат на каждой вершине. Одна мера и один вид у контура
// помещения и у ломаной метки — правит их одна и та же рука.
export function pathVertexHandles(scheme, points, view) {
  const state = renderView(view);
  return (points || []).map((point, index) => {
    const at = planToScreen(point, scheme, state);
    return { kind: "vertex", index, x: at.x, y: at.y, r: OUTLINE_HANDLE_PX };
  });
}

// Ручки середины отрезка: по одной на каждый отрезок, который на экране
// достаточно длинный, чтобы ручка не села на вершины.
//
// Добавить вершину двойным кликом по отрезку можно было и раньше (таск 58) —
// но об этом жесте на плане ничего не говорило, и заказчик просил «добавить
// возможность», которая у него уже была. Ручка честнее двойного клика: её
// видно, и по ней понятно, что будет. Бледная, пока на неё не навели: у ленты
// по периметру их два десятка, и в полную силу они закрыли бы план.
export function pathInsertHandles(scheme, points, view, closed) {
  const state = renderView(view);
  const list = points || [];
  if (list.length < 2) return [];
  const last = closed ? list.length : list.length - 1;
  const handles = [];
  for (let index = 0; index < last; index += 1) {
    const a = planToScreen(list[index], scheme, state);
    const b = planToScreen(list[(index + 1) % list.length], scheme, state);
    // Короткий отрезок ручку не получает: она налезла бы на вершины, и вместо
    // выбора вышла бы каша из трёх ручек в одной точке. Двойной клик по такому
    // отрезку никуда не делся.
    if (Math.hypot(b.x - a.x, b.y - a.y) < PATH_INSERT_MIN_PX) continue;
    handles.push({
      kind: "insert",
      index,
      x: (a.x + b.x) / 2,
      y: (a.y + b.y) / 2,
      r: PATH_INSERT_HANDLE_PX,
    });
  }
  return handles;
}

// Ручки продолжения — по одной за каждым концом незамкнутой линии. Стоят не на
// самой вершине, а за ней, по направлению последнего отрезка: на вершине уже
// сидит своя ручка, и две в одной точке означали бы «непонятно, что потащат».
//
// Замкнутой линии и контуру помещения такие ручки не полагаются: у кольца
// концов нет. Именно поэтому `closed` сюда и передаётся.
export function pathExtendHandles(scheme, points, view, closed) {
  const state = renderView(view);
  const list = points || [];
  if (closed || list.length < 2) return [];
  const gap = Math.max(PATH_EXTEND_GAP_PX, markRadius(state) * HANDLE_GAP);
  const beyond = (from, to, fallback) => {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length = Math.hypot(dx, dy);
    const step = length > 0.001 ? { x: dx / length, y: dy / length } : fallback;
    return { x: to.x + step.x * gap, y: to.y + step.y * gap };
  };
  const head = planToScreen(list[0], scheme, state);
  const second = planToScreen(list[1], scheme, state);
  const tailIndex = list.length - 1;
  const tail = planToScreen(list[tailIndex], scheme, state);
  const previous = planToScreen(list[tailIndex - 1], scheme, state);
  const first = beyond(second, head, { x: -1, y: 0 });
  const lastOne = beyond(previous, tail, { x: 1, y: 0 });
  return [
    { kind: "extend", end: "start", index: 0, x: first.x, y: first.y, r: PATH_EXTEND_HANDLE_PX, from: head },
    {
      kind: "extend",
      end: "end",
      index: tailIndex,
      x: lastOne.x,
      y: lastOne.y,
      r: PATH_EXTEND_HANDLE_PX,
      from: tail,
    },
  ];
}

/**
 * Все ручки правимого пути разом и в том порядке, в каком по ним попадают:
 * вершины важнее середин, середины важнее продолжений.
 *
 * Порядок здесь — правило, а не мелочь. Ручки стоят близко (вершина, середина
 * соседнего отрезка, конец), и спор за клик разрешается один раз и в одном
 * месте: тем, что вершина в списке первая. Рисование идёт обратным порядком —
 * см. `drawPathHandles`.
 */
export function pathEditHandles(scheme, path, view) {
  const points = (path && path.points) || [];
  const closed = Boolean(path && path.closed);
  return [
    ...pathVertexHandles(scheme, points, view),
    ...pathInsertHandles(scheme, points, view, closed),
    ...pathExtendHandles(scheme, points, view, closed),
  ];
}

// Одна ручка равна другой: сравнение по роду, номеру и концу, а не по ссылке, —
// кадр пересчитывает ручки каждый раз заново.
export function samePathHandle(a, b) {
  if (!a || !b) return false;
  return a.kind === b.kind && a.index === b.index && (a.end || null) === (b.end || null);
}

// Ручка пути под точкой экрана — по ней холст решает, что потащили.
export function hitPathHandle(handles, point, extra = 0) {
  for (const handle of handles) {
    if (Math.hypot(point.x - handle.x, point.y - handle.y) <= handle.r + 2 + extra) return handle;
  }
  return null;
}

// Ручки правки контура — те же квадраты на вершинах, что у ломаной метки:
// после того, как правка свелась в один жест, своих ручек у контура нет.
export function outlineHandles(scheme, outline, view) {
  return pathVertexHandles(scheme, outline.points, renderView(view));
}

/**
 * Попадание по контуру. Клик по метке всегда важнее — поэтому холст зовёт
 * сперва `hitTest`, и только потом это. Внутренность контура не ловится:
 * иначе заливка комнаты перехватывала бы клики по пустому плану.
 * `selectedOutlineId` — у выделенного контура ловятся ещё и ручки вершин.
 */
export function hitOutline(project, scheme, point, view, filter, selectedOutlineId, extra = 0) {
  if (!project || !scheme) return null;
  const state = renderView(view);
  const outlines = visibleOutlines(project, scheme, filter);
  const selected = outlines.find((outline) => outline.id === selectedOutlineId);
  if (selected) {
    const handle = hitPathHandle(outlineHandles(scheme, selected, state), point, extra);
    if (handle) return { outlineId: selected.id, part: handle.kind, index: handle.index };
  }
  // Меньший контур лежит в порядке последним и ловится первым: у комнаты
  // внутри комнаты стенки могут совпасть со стенками большей.
  for (let index = outlines.length - 1; index >= 0; index -= 1) {
    const outline = outlines[index];
    const screen = outlineScreen(scheme, outline, state);
    for (let i = 0; i < screen.length; i += 1) {
      const a = screen[i];
      const b = screen[(i + 1) % screen.length];
      if (distanceToSegment(point, a, b) <= OUTLINE_HIT_PX + extra) {
        return { outlineId: outline.id, part: "edge", index: i };
      }
    }
    const label = outlineLabelBox(project, scheme, outline, state);
    if (label && insideBox(point, label)) return { outlineId: outline.id, part: "label", index: 0 };
  }
  return null;
}

// Смещение подписи комнаты — в пикселях плана, ровно как `labelOffset` у метки
// и у блока. Поля нет у контуров, размеченных до этого: «нет смещения» — это и
// есть прежняя подпись в середине контура.
export function outlineLabelOffsetOf(outline) {
  return (outline && outline.labelOffset) || null;
}

// Угол подписи комнаты: 0 — лежит, 90 — стоит вдоль стены. Тот же список
// углов, что у метки; всё, что не 90, читается как 0.
export function outlineLabelAngleOf(outline) {
  return outline && outline.labelAngle === 90 ? 90 : 0;
}

/**
 * Габарит подписи комнаты. Кегль — тем же правилом, что у подписи метки: своего
 * коэффициента и своего минимума у комнаты нет, иначе на одном плане стояли бы
 * две разные меры.
 *
 * Подпись стоит **серединой** на своей точке — в середине контура или там, куда
 * её оттащили руками. У метки точка привязки — сама метка, и подпись идёт от
 * неё вбок; у комнаты привязка — её середина, и подпись обязана остаться на ней
 * посередине, как бы её ни повернули. Отсюда и пересчёт в точку начала текста:
 * `x`, `y` здесь — то же, что у подписи метки, и `labelBounds` считает габарит
 * обоих одной формулой.
 */
export function outlineLabelBox(project, scheme, outline, view) {
  const room = findRoom(project, outline.roomId);
  if (!room || !room.name) return null;
  const state = renderView(view);
  const font = labelFontSize(state);
  const angle = outlineLabelAngleOf(outline);
  const offset = outlineLabelOffsetOf(outline);
  const dx = offset ? offset.dx : 0;
  const dy = offset ? offset.dy : 0;
  const center = planToScreen(outlineCenter(outline.points), scheme, state);
  const at = { x: center.x + dx * state.zoom, y: center.y + dy * state.zoom };
  const width = Math.max(font * 0.8, labelTextWidth(room.name, font, state.fontFamily, 600));
  const anchor = angle === 90 ? { x: at.x, y: at.y + width / 2 } : { x: at.x - width / 2, y: at.y };
  return {
    text: room.name,
    x: anchor.x,
    y: anchor.y,
    width,
    height: font * 1.2,
    font,
    family: state.fontFamily,
    angle,
    dx,
    dy,
  };
}

// Ручка поворота у подписи комнаты — та же, что у подписи метки, и стоит там же
// относительно габарита.
export function outlineLabelTurn(project, scheme, outline, view) {
  if (!outline) return null;
  const box = outlineLabelBox(project, scheme, outline, renderView(view));
  if (!box) return null;
  return turnHandleAt(labelBounds(box), renderView(view));
}

export function hitOutlineLabelTurn(project, scheme, outline, point, view, extra = 0) {
  const handle = outlineLabelTurn(project, scheme, outline, view);
  if (!handle) return false;
  return Math.hypot(point.x - handle.x, point.y - handle.y) <= handle.r + HIT_SLACK_PX + extra;
}

// Подпись комнаты рисуется серединой на своей точке — так она стояла всегда,
// так же ложится и повёрнутая. Габарит для клика считает `labelBounds` того же
// прямоугольника, поэтому подпись ловится там, где нарисована.
function drawOutlineLabel(ctx, box, color) {
  const rect = labelBounds(box);
  ctx.save();
  ctx.font = drawFont(box.font, 600, box.family);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  // Обводка-подложка: подпись читается и поверх линий плана.
  ctx.lineWidth = Math.max(2, box.font * 0.3);
  ctx.lineJoin = "round";
  ctx.strokeStyle = "rgba(255, 255, 255, 0.85)";
  ctx.fillStyle = color;
  ctx.translate(rect.x + rect.width / 2, rect.y + rect.height / 2);
  // Повёрнутая читается снизу вверх — так подписывают вдоль стен на чертежах.
  if (box.angle === 90) ctx.rotate(-Math.PI / 2);
  ctx.strokeText(box.text, 0, 0);
  ctx.fillText(box.text, 0, 0);
  ctx.restore();
}

/**
 * Контуры помещений под метками: тонкая линия цветом комнаты, полупрозрачная
 * заливка и название внутри. `mode` — `"pale"` для бумаги.
 */
export function drawOutlines(ctx, { project, scheme, filter, view, mode, selectedOutlineId }) {
  const outlines = visibleOutlines(project, scheme, filter);
  if (outlines.length === 0) return;
  const state = renderView(view);
  const style = OUTLINE_STYLE[mode === "pale" ? "pale" : "normal"];
  for (const outline of outlines) {
    const color = outlineColor(project, outline);
    const screen = outlineScreen(scheme, outline, state);
    ctx.save();
    ctx.beginPath();
    screen.forEach((point, index) => (index === 0 ? ctx.moveTo(point.x, point.y) : ctx.lineTo(point.x, point.y)));
    ctx.closePath();
    ctx.fillStyle = outlineTint(color, style.fill);
    ctx.fill();
    ctx.lineJoin = "round";
    ctx.lineWidth = style.line;
    ctx.strokeStyle = outline.id === selectedOutlineId ? "#0969da" : outlineTint(color, 0.9);
    if (outline.id === selectedOutlineId) ctx.setLineDash([6, 4]);
    ctx.stroke();
    ctx.restore();
    // Пола нет (таск 209) — поверх заливки и линии ложится косая штриховка.
    // **После** обводки и своим путём: путь у холста один, и штриховка, взятая
    // под отсечку до `stroke()`, этим же `stroke()` и рисовалась бы второй раз
    // — уже без отсечки, через весь план. Так это и выглядело в первом живом
    // прогоне: параллелограмм косых линий в пол-этажа.
    if (!roomHasFloor(project, outline.roomId)) drawOutlineHatch(ctx, screen, color);

    const label = outlineLabelBox(project, scheme, outline, state);
    if (!label) continue;
    drawOutlineLabel(ctx, label, outlineTint(color, style.label));
  }
}

function drawHandleSquare(ctx, handle, tint) {
  ctx.beginPath();
  ctx.rect(handle.x - handle.r, handle.y - handle.r, handle.r * 2, handle.r * 2);
  ctx.fillStyle = "rgba(255, 255, 255, 0.95)";
  ctx.strokeStyle = tint;
  ctx.lineWidth = 1.5;
  ctx.fill();
  ctx.stroke();
}

// Кружок с «+». Подложка всегда плотная, бледнеет только рисунок: ручка сидит
// на линии, и полупрозрачная насквозь она сливалась бы с ней.
function drawHandlePlus(ctx, handle, tint, alpha) {
  const arm = handle.r * 0.55;
  ctx.save();
  ctx.beginPath();
  ctx.arc(handle.x, handle.y, handle.r, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255, 255, 255, 0.95)";
  ctx.fill();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = tint;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(handle.x - arm, handle.y);
  ctx.lineTo(handle.x + arm, handle.y);
  ctx.moveTo(handle.x, handle.y - arm);
  ctx.lineTo(handle.x, handle.y + arm);
  ctx.stroke();
  ctx.restore();
}

/**
 * Кольцо ожидания под пальцем: отклик на долгое нажатие.
 *
 * Палец не умеет «навести и нажать», поэтому перенос метки начинается с
 * выдержки — а выдержку надо показать, иначе человек уберёт палец раньше
 * времени и решит, что не сработало. Кольцо замыкается за то же время, что
 * отведено на нажатие (`progress` 0…1), и рисуется **только там, где есть что
 * взять**: обещать перенос над пустым планом нельзя.
 *
 * Рисуется поверх всего, включая линейку: это ответ руке, а не часть чертежа.
 * В PNG, в печать и в лист «Схема» не попадает — `drawScheme` о нём не знает.
 */
export function drawPressRing(ctx, at, progress, color) {
  if (!ctx || !at) return;
  const radius = at.r || 22;
  const part = Math.max(0, Math.min(1, Number(progress) || 0));
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineWidth = 3;
  ctx.strokeStyle = "rgba(1, 4, 9, 0.16)";
  ctx.beginPath();
  ctx.arc(at.x, at.y, radius, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = color || "#0969da";
  ctx.beginPath();
  ctx.arc(at.x, at.y, radius, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * part);
  ctx.stroke();
  ctx.restore();
}

/**
 * Рисование ручек пути.
 *
 * Квадрат — вершина, кружок с «+» на середине отрезка — разбивка, кружок с «+»
 * на поводке за концом — продолжение линии.
 *
 * **Бледное становится точкой под рукой.** Ручка разбивки нарисована вполсилы,
 * пока на неё не навели, а под курсором превращается в такой же квадрат, какой
 * встанет на её место: жест видно, и видно, что будет. Ручек на плане много —
 * вершины, середины, концы, — и полная сила у всех сразу закрыла бы разметку.
 *
 * Порядок обратный порядку попадания (`pathEditHandles`): бледное рисуется
 * первым, вершины ложатся поверх.
 */
export function drawPathHandles(ctx, handles, color, hovered) {
  const tint = color || "#0969da";
  const list = handles || [];
  ctx.save();
  for (const handle of list) {
    if (handle.kind === "vertex") continue;
    const under = samePathHandle(handle, hovered);
    const alpha = under ? 1 : PATH_HANDLE_PALE;
    if (handle.kind === "extend" && handle.from) {
      // Поводок от конца линии к ручке: по нему видно, чей это конец и куда
      // линия пойдёт.
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      ctx.setLineDash([3, 3]);
      ctx.strokeStyle = tint;
      ctx.lineWidth = 1;
      ctx.moveTo(handle.from.x, handle.from.y);
      ctx.lineTo(handle.x, handle.y);
      ctx.stroke();
      ctx.restore();
    }
    // Под рукой ручка показывает будущую вершину — тем же квадратом, каким она
    // и встанет: жест видно, и видно, что будет.
    if (under) drawHandleSquare(ctx, { ...handle, r: OUTLINE_HANDLE_PX }, tint);
    else drawHandlePlus(ctx, handle, tint, alpha);
  }
  for (const handle of list) {
    if (handle.kind !== "vertex") continue;
    drawHandleSquare(ctx, handle, tint);
  }
  ctx.restore();
}

// ——— попадание ———————————————————————————————————————————————————————

function pointInPolygon(point, points) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    const a = points[i];
    const b = points[j];
    const crosses = a.y > point.y !== b.y > point.y;
    if (crosses && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function distanceToSegment(point, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) return Math.hypot(point.x - a.x, point.y - a.y);
  let t = ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy));
}

function insideBox(point, box) {
  const rect = labelBounds(box);
  return (
    point.x >= rect.x - 2 &&
    point.x <= rect.x + rect.width + 2 &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.height
  );
}

// Точка — в экранных пикселях холста. Возвращает `{markId, part, index}`:
// `part` — `label` (подпись, её таскают отдельно), `mark` (точка или вершина
// линии), `line` (сегмент ломаной). Сверху вниз: подписи, потом метки в обратном
// порядке постановки — поздняя метка лежит выше ранней.
//
// У комментария с указателем это **две разные ручки одной метки**: плашка
// отвечает `label` (едет смещение), точка — `mark` (едут координаты). Третьего
// значения `part` ради этого не заведено: точка комментария и есть тело метки,
// а что плашка при её переносе остаётся на месте — дело холста (G199).
export function hitTest(project, scheme, point, view, filter, extra = 0) {
  if (!project || !scheme) return null;
  const state = renderView(view);
  const radius = markRadius(state);
  const slack = radius + HIT_SLACK_PX + extra;

  const targets = labelTargets(project, scheme, filter);
  const layout = labelLayout(project, scheme, filter, state);
  const stacks = markStacks(project, scheme, filter, state);
  for (let index = targets.length - 1; index >= 0; index -= 1) {
    const target = targets[index];
    const box = labelBoxIn(project, scheme, target, state, layout, stacks);
    if (box.text && insideBox(point, box)) {
      // Подпись блока выбирает первую из тех меток, что в ней перечислены:
      // под фильтром скрытая метка в подписи не стоит и выбираться не должна.
      const markId = target.markIds ? labelMemberIds(target)[0] : target.id;
      // Плашка без указателя — это и есть метка: отдельной подписи у
      // комментария нет, и тащить её от своей точки некуда — точка пришита к
      // плашке. Поэтому попадание в неё — `mark`, и ведение двигает весь
      // комментарий, как двигают розетку. С указателем плашка и точка живут
      // раздельно, и плашка снова обычная подпись: её таскают поводком.
      if (box.plate && !box.pointer) {
        return { markId, part: "mark", groupId: null, index: 0 };
      }
      return { markId, part: "label", groupId: target.markIds ? target.id : null, index: 0 };
    }
  }

  const marks = visibleMarks(project, scheme, filter);
  for (let index = marks.length - 1; index >= 0; index -= 1) {
    const mark = marks[index];
    const style = styleOf(project, mark.typeId);
    // Точка знака — из той же двери, что у рисования (`markStackPoints`):
    // стопка совпавших меток обязана отдавать клик там, где знак виден.
    const screen = markStackPoints(mark, stacks).map((item) => planToScreen(item, scheme, state));
    // Комментарий: плашку поймал проход подписей выше, а здесь ловится его
    // **точка** — та, в которую смотрит указатель, и её возят отдельно от
    // плашки (G199). Запас вокруг точки — тот же, что у ручек подписи
    // (`HIT_SLACK_PX`), и мерится он от нарисованной кляксы, а не от знака
    // типа: знак у комментария — прямоугольник плашки.
    //
    // **Без указателя точки нет вовсе.** Плашка стоит на ней сама, рисовать
    // там нечего — значит и ловить нечего: клик по этому месту уже забрала
    // плашка и отдала его как `mark` (двигается весь комментарий).
    if (markIsComment(mark)) {
      if (!markPointer(mark)) continue;
      const at = screen[0];
      const reach = commentPointRadius(state) + HIT_SLACK_PX + extra;
      if (Math.hypot(point.x - at.x, point.y - at.y) <= reach) {
        return { markId: mark.id, part: "mark", groupId: null, index: 0 };
      }
      continue;
    }
    for (let vertex = 0; vertex < screen.length; vertex += 1) {
      const geometry = shapeGeometry(style.shape, screen[vertex].x, screen[vertex].y, radius);
      const near =
        geometry.kind === "circle"
          ? Math.hypot(point.x - geometry.cx, point.y - geometry.cy) <= slack
          : pointInPolygon(point, geometry.points) ||
            Math.hypot(point.x - geometry.cx, point.y - geometry.cy) <= slack;
      if (near) return { markId: mark.id, part: "mark", groupId: mark.groupId, index: vertex };
    }
    if (mark.kind === "line" && screen.length > 1) {
      const last = mark.closed ? screen.length : screen.length - 1;
      for (let segment = 0; segment < last; segment += 1) {
        const a = screen[segment];
        const b = screen[(segment + 1) % screen.length];
        if (distanceToSegment(point, a, b) <= Math.max(4, radius * 0.6) + extra) {
          return { markId: mark.id, part: "line", groupId: mark.groupId, index: segment };
        }
      }
    }
  }
  return null;
}

// ——— ручки блока —————————————————————————————————————————————————————

// Четыре «+» вокруг выделенной точки: клик ставит соседнюю точку блока.
// Ради них таск и существует: два десятка розеток ставятся без диалогов.
//
// `stacks` — стопки схемы: у метки, которую стопка отодвинула, ручки стоят
// вокруг **знака**, а не вокруг настоящей точки, над которой сейчас стоит
// чужой знак. То же смещение холст передаёт модели (`addToGroup options.fromPx`),
// поэтому метка по-прежнему встаёт ровно туда, где нарисована ручка.
function handlePositions(scheme, mark, view, stacks) {
  if (!mark || mark.kind !== "point") return [];
  const state = renderView(view);
  const radius = markRadius(state);
  const gap = radius * HANDLE_GAP;
  const points = markStackPoints(mark, stacks);
  const base = planToScreen(points[points.length - 1], scheme, state);
  const handleRadius = Math.max(7, Math.min(HANDLE_RADIUS, radius));
  return [
    { side: "left", x: base.x - gap, y: base.y, r: handleRadius },
    { side: "right", x: base.x + gap, y: base.y, r: handleRadius },
    { side: "up", x: base.x, y: base.y - gap, r: handleRadius },
    { side: "down", x: base.x, y: base.y + gap, r: handleRadius },
  ];
}

export function hitHandle(scheme, mark, point, view, extra = 0, stacks = null) {
  for (const handle of handlePositions(scheme, mark, view, stacks)) {
    if (Math.hypot(point.x - handle.x, point.y - handle.y) <= handle.r + 2 + extra) return handle.side;
  }
  return null;
}

// ——— рисование ———————————————————————————————————————————————————————

// Поводок к отведённой подписи: тонкая линия от метки к ближнему краю текста.
// Рисуется только тем, кого раскладка увела на ряд и дальше, — у подписи
// вплотную к метке и так видно, чья она.
function drawLabelLeader(ctx, anchor, box, color) {
  if (!box.text) return;
  // Указатель комментария — тот же поводок, но заметный: не волосяная линия в
  // полпрозрачности, а сплошная черта со стрелкой в точку. Слова заказчика:
  // «соединительная линия между точкой и подписью чтобы была всегда и более
  // очевидная». Рисуется он тем же проходом и тем же кодом — второго
  // механизма у плашки нет.
  if (box.plate) {
    drawCommentPointer(ctx, anchor, box, color);
    return;
  }
  ctx.save();
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.5;
  ctx.lineWidth = Math.max(1, box.font * 0.08);
  const rect = labelBounds(box);
  ctx.beginPath();
  ctx.moveTo(anchor.x, anchor.y);
  ctx.lineTo(
    rect.x + rect.width < anchor.x ? rect.x + rect.width : Math.max(rect.x, Math.min(anchor.x, rect.x + rect.width)),
    anchor.y < rect.y ? rect.y : rect.y + rect.height,
  );
  ctx.stroke();
  ctx.restore();
}

// Ближняя к точке сторона плашки: откуда тянуть указатель, чтобы он не лёг
// поверх текста. Та же выжимка, что у обычного поводка, только вынесена —
// её спрашивают и черта, и стрелка.
function commentPlateEdge(anchor, rect) {
  return {
    x: Math.max(rect.x, Math.min(anchor.x, rect.x + rect.width)),
    y: Math.max(rect.y, Math.min(anchor.y, rect.y + rect.height)),
  };
}

// Указатель: черта от края плашки к точке и стрелка в самой точке. Стрелка
// ровно на точке, а не у плашки: показывает она место на плане, и упереться
// обязана в него.
function drawCommentPointer(ctx, anchor, box, color) {
  const rect = labelBounds(box);
  const from = commentPlateEdge(anchor, rect);
  const dx = anchor.x - from.x;
  const dy = anchor.y - from.y;
  const span = Math.hypot(dx, dy);
  const head = Math.max(4, box.font * 0.7);
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineCap = "round";
  ctx.lineWidth = Math.max(1.5, box.font * 0.16);
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(anchor.x, anchor.y);
  ctx.stroke();
  // Выродившийся указатель (плашка накрыла свою точку) стрелки не получает:
  // направления у него нет, и стрелка показала бы случайную сторону.
  if (span > head * 0.5) drawLinkArrow(ctx, anchor, dx, dy, head);
  ctx.restore();
}

// Скруглённый прямоугольник своим путём, а не `ctx.roundRect`: тот есть не во
// всяком движке, а молча пропавшая рамка плашки — это пропавший комментарий.
function platePath(ctx, rect, radius) {
  const r = Math.max(0, Math.min(radius, rect.width / 2, rect.height / 2));
  ctx.beginPath();
  ctx.moveTo(rect.x + r, rect.y);
  ctx.lineTo(rect.x + rect.width - r, rect.y);
  ctx.arcTo(rect.x + rect.width, rect.y, rect.x + rect.width, rect.y + r, r);
  ctx.lineTo(rect.x + rect.width, rect.y + rect.height - r);
  ctx.arcTo(rect.x + rect.width, rect.y + rect.height, rect.x + rect.width - r, rect.y + rect.height, r);
  ctx.lineTo(rect.x + r, rect.y + rect.height);
  ctx.arcTo(rect.x, rect.y + rect.height, rect.x, rect.y + rect.height - r, r);
  ctx.lineTo(rect.x, rect.y + r);
  ctx.arcTo(rect.x, rect.y, rect.x + r, rect.y, r);
  ctx.closePath();
}

/**
 * Плашка комментария: рамка со скруглёнными углами, внутри — строки текста.
 *
 * Подложка сплошная белая, а не обводка по буквам, как у подписи: внутри
 * плашки лежит целый абзац, и белая обводка каждой буквы на плане читалась бы
 * грязью. Пустая плашка (текст — название поля) рисуется приглушённо: так
 * видно, что это заготовка, а не надпись.
 */
function drawCommentPlate(ctx, box, color, selected) {
  const rect = labelBounds(box);
  const empty = box.text === strings.marks.comment;
  ctx.save();
  platePath(ctx, rect, box.font * COMMENT_PLATE_RADIUS);
  ctx.fillStyle = "rgba(255, 255, 255, 0.94)";
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1, box.font * 0.1);
  if (empty) ctx.setLineDash([box.font * 0.4, box.font * 0.3]);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.font = drawFont(box.font, null, box.family);
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillStyle = color;
  if (empty) ctx.globalAlpha = 0.55;
  const step = box.font * COMMENT_PLATE_LINE;
  const lines = box.plate.lines;
  lines.forEach((line, index) => {
    ctx.fillText(line, rect.x + box.plate.pad, rect.y + box.plate.pad + step * (index + 0.5));
  });
  ctx.restore();
  if (!selected) return;
  // Выделение рисуется вокруг плашки, а не вокруг точки: точка под плашкой, и
  // обводка по ней была бы не видна из-под подложки.
  ctx.save();
  ctx.strokeStyle = "#0969da";
  ctx.setLineDash([4, 3]);
  ctx.lineWidth = 2;
  const gap = Math.max(2, box.font * 0.25);
  platePath(
    ctx,
    { x: rect.x - gap, y: rect.y - gap, width: rect.width + gap * 2, height: rect.height + gap * 2 },
    box.font * COMMENT_PLATE_RADIUS + gap,
  );
  ctx.stroke();
  ctx.restore();
}

/**
 * Куски подписи со своими цветами: `[{text, color}]`.
 *
 * У одиночной метки кусок один — её обозначение. У блока их столько, сколько
 * склеила `blockLabelParts`: смешанный блок (выключатель и розетка в одной
 * рамке, G22) читается «В37, Р77Р78», и красился он целиком цветом первого
 * типа. Слова заказчика: «если в группе метки разных типов, то цвет группы
 * целиком первого типа, а должны быть так же разным».
 *
 * **Разделитель берёт цвет куска слева.** Своего типа у запятой нет, и выбор
 * тут между нейтральным цветом и цветом соседа. Сосед слева выигрывает по двум
 * причинам. Во-первых, так работает пунктуация в наборе: знак принадлежит тому
 * слову, которое заканчивает, а не тому, что начинается. Во-вторых и главное —
 * запятая стоит **и в одноцветном блоке** («В1, В5» — тот же тип, номера не
 * подряд), и нейтральный серый перекрасил бы то, что заказчик не просил
 * трогать: самый частый блок обязан выглядеть ровно как раньше.
 *
 * Склейка кусков обязана совпасть с самой подписью — иначе обводка ляжет по
 * одной строке, а буквы по другой. Разошлись — возвращается один кусок,
 * прежним цветом: лучше прежний вид, чем рваная подпись.
 */
export function labelRuns(project, target, fallback) {
  if (!target || !target.markIds) return null;
  const parts = blockLabelParts(project, labelMemberIds(target));
  if (parts.length === 0) return null;
  const runs = [];
  let previous = fallback;
  for (const part of parts) {
    const color = part.typeId ? styleOf(project, part.typeId).color : previous;
    runs.push({ text: part.text, color });
    if (part.typeId) previous = color;
  }
  return runs;
}

// Обводка одна на всю строку, буквы — кусками. Порядок именно такой: обведи
// каждый кусок по отдельности, и белая подложка легла бы поверх соседней буквы,
// разорвав подпись на плане.
function paintLine(ctx, value, runs, x, y) {
  ctx.strokeText(value, x, y);
  // Одноцветная подпись рисуется одним вызовом — ровно тем же, что и до правки.
  if (!runs || runs.every((run) => run.color === runs[0].color)) {
    if (runs && runs.length > 0) ctx.fillStyle = runs[0].color;
    ctx.fillText(value, x, y);
    return;
  }
  // Сдвиг куска меряется по **накопленной строке**, а не суммой кусков: так
  // учитывается подгонка пар букв, и части встают вплотную, как в одном вызове.
  let done = "";
  for (const run of runs) {
    ctx.fillStyle = run.color;
    ctx.fillText(run.text, x + (done ? ctx.measureText(done).width : 0), y);
    done += run.text;
  }
}

// Подпись целиком. Одна строка — один проход, тот же, что был всегда;
// перенесённая (D29) идёт строка за строкой от середины габарита, и обводка у
// каждой своя: это разные строки, и склеивать их нечем.
function paintLabel(ctx, box, runs, x, y) {
  const lines = box.lines && box.lines.length > 1 ? box.lines : null;
  if (!lines) {
    paintLine(ctx, box.text, runs, x, y);
    return;
  }
  const step = box.font * LABEL_LINE;
  const first = y - (step * (lines.length - 1)) / 2;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    paintLine(ctx, line.text, labelLineRuns(runs, line), x, first + step * index);
  }
}

function drawLabel(ctx, box, color, runs, selected) {
  if (!box.text) return;
  if (box.plate) {
    drawCommentPlate(ctx, box, color, selected);
    return;
  }
  const parts = runs && runs.map((run) => run.text).join("") === box.text ? runs : null;
  ctx.save();
  ctx.font = drawFont(box.font, 600, box.family);
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  // Обводка-подложка: подпись читается и поверх тёмных линий плана.
  ctx.lineWidth = Math.max(2, box.font * 0.3);
  ctx.lineJoin = "round";
  ctx.strokeStyle = "rgba(255, 255, 255, 0.92)";
  ctx.fillStyle = color;
  // Повёрнутая подпись читается снизу вверх — так её пишут вдоль стен на
  // чертежах. Рисование и габарит берут один и тот же угол, поэтому клик
  // попадает туда, где текст виден. Куски красятся тем же кодом: после поворота
  // сдвиг куска идёт по той же оси, что и сама строка.
  if (box.angle === 90) {
    ctx.translate(box.x, box.y);
    ctx.rotate(-Math.PI / 2);
    paintLabel(ctx, box, parts, 0, 0);
    ctx.restore();
    return;
  }
  paintLabel(ctx, box, parts, box.x, box.y);
  ctx.restore();
}

/**
 * Знак метки: фигура точки, нитка линии, точка комментария — и пунктир
 * выделения вокруг. Одна дверь на кадр плана, выгрузку и **призрака под рукой**.
 *
 * `options.selected` — метка выделена; `options.stacks` — расклад стопки
 * совпавших.
 *
 * `options.ghost` — та же метка **до** клика (таск 176, G263). Слова
 * заказчика: «При добавлении метки так же рисуй под курсором её». Приём взят у
 * призрака вещи чертежа целиком (таск 168, `drawDrawingObject`): рисует
 * призрака **этот же код**, своего у него только две приметы — полсилы цвета и
 * пунктир, и те же две, что у чертежа (`DRAWING_GHOST_ALPHA`,
 * `DRAWING_GHOST_DASH`): мерка призрака в сборке одна. Второго рисовальщика
 * знака не заводится — разойдись они, под рукой была бы одна фигура, а по
 * клику вставала другая.
 */
export function drawMarkSign(ctx, project, scheme, mark, view, options = {}) {
  if (options.ghost) {
    ctx.save();
    ctx.globalAlpha = DRAWING_GHOST_ALPHA;
    ctx.setLineDash(DRAWING_GHOST_DASH);
    drawMarkSign(ctx, project, scheme, mark, view, { ...options, ghost: false });
    ctx.restore();
    return;
  }
  drawMarkBody(ctx, project, scheme, mark, view, Boolean(options.selected), options.stacks || null);
}

function drawMarkBody(ctx, project, scheme, mark, view, selected, stacks) {
  const style = styleOf(project, mark.typeId);
  const radius = markRadius(view);
  // Знак рисуется там, куда его поставила стопка совпавших, — и ровно там же
  // считается попадание по клику: точка берётся одной функцией на оба случая.
  const screen = markStackPoints(mark, stacks).map((point) => planToScreen(point, scheme, view));
  // Комментарий рисуется плашкой, а не знаком (G163), и плашку рисует проход
  // подписей. Здесь остаётся только точка, в которую смотрит указатель: без
  // указателя плашка стоит на ней сама, и рисовать под ней нечего.
  if (markIsComment(mark)) {
    if (!markPointer(mark)) return;
    const at = screen[0];
    drawShape(ctx, "circle-fill", at.x, at.y, commentPointRadius(view), style.color);
    if (!selected) return;
    ctx.save();
    ctx.strokeStyle = "#0969da";
    ctx.setLineDash([4, 3]);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(at.x, at.y, radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    return;
  }
  if (mark.kind === "line" && screen.length > 1) {
    strokeStyledLine(ctx, screen, mark.closed, style.lineStyle, radius, style.color);
    for (const point of screen) drawShape(ctx, "circle", point.x, point.y, Math.max(2, radius * 0.45), style.color);
  } else {
    for (const point of screen) drawShape(ctx, style.shape, point.x, point.y, radius, style.color);
  }
  if (!selected) return;
  ctx.save();
  ctx.strokeStyle = "#0969da";
  ctx.setLineDash([4, 3]);
  ctx.lineWidth = 2;
  for (const point of screen) {
    ctx.beginPath();
    ctx.arc(point.x, point.y, radius * 1.6, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

// ——— состояние дома на «Схеме» (таск 08 сценариев, история 2.11) ———————
//
// Пока дом запущен, метка показывает, что с устройством: включённый свет —
// ореол по яркости, сработавший датчик — красный пульс, открытая штора,
// включённый телевизор и розетка — свой знак, нажатая клавиша — вспышка.
// Это **только экран**: рисует всё это один необязательный аргумент
// `drawScheme({…, live, liveFx})`, и передаёт его только холст. Без него кадр
// не меняется ни на один вызов `ctx` (G68) — PNG, лист ГОСТ и печать его не
// получают.
//
// `live` — `Map<markId, Live>` (`simLiveOf`) с видом знака: `kind` — один из
// `SIM_LIVE_KINDS`. `liveFx` — `{pulse: 0…1, flash: Map<markId, 0…1>}`: фаза
// пульса и затухание вспышки считает холст по своему времени, чтобы здесь
// кадр оставался чистой функцией аргументов.

/** Виды знака состояния: свет, штора, телевизор, розетка, прочее. */
export const SIM_LIVE_KINDS = Object.freeze(["light", "curtain", "tv", "outlet", "other"]);
/** Цвет ореола включённого света. */
export const SIM_LIVE_GLOW_RGB = "255, 196, 64";
/** Цвет сработавшего датчика. */
export const SIM_LIVE_ALERT_COLOR = "#d1242f";
/** Цвет знака «включено». */
export const SIM_LIVE_ON_COLOR = "#1a7f37";

/**
 * Вид знака состояния по аксессуару метки (`markAccessory`): штора, телевизор,
 * розетка и свет — по сервисам, остальное — «прочее».
 */
export function simLiveKindOf(accessory) {
  const types = new Set(((accessory && accessory.services) || []).map((service) => service.type));
  if (types.has("WindowCovering")) return "curtain";
  if (types.has("Television")) return "tv";
  if (types.has("Outlet")) return "outlet";
  if (types.has("Lightbulb")) return "light";
  return "other";
}

/** Период пульса сработавшего датчика, мс — один на «Схему» и мини-план. */
export const SIM_LIVE_PULSE_MS = 1400;
/** Сколько гаснет вспышка нажатия, мс — одна на «Схему» и мини-план. */
export const SIM_LIVE_FLASH_MS = 700;

/**
 * Память кадров одной поверхности для `simLiveFrame`: когда началась вспышка
 * каждой метки и последний собранный кадр (`live` пересобирается, только
 * когда сменилось зеркало или виды знаков).
 */
export function simLiveMemo() {
  return { flash: new Map(), source: null, kinds: null, live: null, fade: lightFadeMemo() };
}

/**
 * Кадр состояния дома для `drawScheme` (ревью ветки, F1: один на «Схему» и
 * мини-план): `{live, fx, animate}`. `source` — `simLive(project)`; `kinds` —
 * `Map<markId, {kind}>` (`deviceLiveKinds`), метка без записи — «прочее»;
 * `memo` — `simLiveMemo()` поверхности; `now` — её часы, мс. `fx` — фаза
 * пульса и угасание вспышек; `animate` — кадр нужен снова (идёт пульс,
 * вспышка или свет разгорается и гаснет — `lightFadeLive`, правка после
 * сборки сценариев: «для всего света сделаем плавное включение и отключение»).
 */
export function simLiveFrame(source, kinds, memo, now) {
  const own = memo || simLiveMemo();
  if (!own.live || own.source !== source || own.kinds !== kinds) {
    const live = new Map();
    for (const [markId, item] of source || []) {
      const meta = kinds ? kinds.get(markId) : null;
      live.set(markId, { ...item, kind: (meta && meta.kind) || "other" });
    }
    own.source = source;
    own.kinds = kinds;
    own.live = live;
  }
  const flash = new Map();
  let animate = false;
  for (const [markId, item] of own.live) {
    if (item.alert) animate = true;
    if (item.pressedAt === null || item.pressedAt === undefined) continue;
    const seen = own.flash.get(markId);
    if (!seen || seen.pressedAt !== item.pressedAt) own.flash.set(markId, { pressedAt: item.pressedAt, at: now });
    const left = 1 - (now - own.flash.get(markId).at) / SIM_LIVE_FLASH_MS;
    if (left > 0) {
      flash.set(markId, left);
      animate = true;
    }
  }
  const faded = lightFadeLive(own.live, own.fade || (own.fade = lightFadeMemo()), now);
  if (faded.busy) animate = true;
  return { live: faded.live, fx: { pulse: (now % SIM_LIVE_PULSE_MS) / SIM_LIVE_PULSE_MS, flash }, animate };
}

function simLiveShare(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : 0;
}

// Ореол под знаком: у точки — радиальный градиент, у линии — мягкая толстая
// полоса вдоль неё. Сила — от яркости: даже тусклый свет виден. Разгорается и
// гаснет он плавно (`fade`, `lightFadeLive`): прозрачность идёт за долей
// включённости, а не прыгает от нуля к шестнадцати процентам.
function drawLiveGlow(ctx, mark, screen, radius, live) {
  const level = simLiveShare(live.level);
  const alpha = (0.16 + 0.5 * level) * lightFadeOf(live);
  // Цвет лампы (правка после сборки сценариев) — оттенок или цветовая
  // температура; у лампы без цвета — прежний тёплый.
  const glowRgb = Array.isArray(live.color) && live.color.length >= 3 ? live.color.slice(0, 3).map((value) => Math.round(Number(value) || 0)).join(", ") : SIM_LIVE_GLOW_RGB;
  ctx.save();
  if (mark.kind === "line" && screen.length > 1) {
    ctx.strokeStyle = "rgba(" + glowRgb + ", " + (alpha * 0.7).toFixed(3) + ")";
    ctx.lineWidth = radius * (1.6 + 2.4 * level);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    screen.forEach((point, index) => (index === 0 ? ctx.moveTo(point.x, point.y) : ctx.lineTo(point.x, point.y)));
    if (mark.closed) ctx.closePath();
    ctx.stroke();
    ctx.restore();
    return;
  }
  const reach = radius * (2.4 + 2.2 * level);
  for (const point of screen) {
    const gradient = ctx.createRadialGradient(point.x, point.y, radius * 0.4, point.x, point.y, reach);
    gradient.addColorStop(0, "rgba(" + glowRgb + ", " + alpha.toFixed(3) + ")");
    gradient.addColorStop(1, "rgba(" + glowRgb + ", 0)");
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(point.x, point.y, reach, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

// Знак состояния рядом с меткой — в правом верхнем углу знака.
function drawLiveBadge(ctx, at, size, kind, live) {
  ctx.save();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = "#ffffff";
  if (kind === "curtain") {
    // Штора: две створки; чем она открытее, тем шире просвет между ними.
    const open = simLiveShare(live.open);
    const half = size * 0.55;
    const gap = size * 0.9 * open;
    ctx.fillStyle = "#6e7781";
    ctx.fillRect(at.x - half - gap, at.y - half, half, half * 2);
    ctx.fillRect(at.x + gap, at.y - half, half, half * 2);
    ctx.strokeRect(at.x - half - gap, at.y - half, half, half * 2);
    ctx.strokeRect(at.x + gap, at.y - half, half, half * 2);
  } else if (kind === "tv") {
    ctx.fillStyle = "#1f6feb";
    ctx.fillRect(at.x - size, at.y - size * 0.7, size * 2, size * 1.4);
    ctx.strokeRect(at.x - size, at.y - size * 0.7, size * 2, size * 1.4);
  } else {
    ctx.fillStyle = SIM_LIVE_ON_COLOR;
    ctx.beginPath();
    ctx.arc(at.x, at.y, size * 0.75, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * Состояние одного устройства на плане. `layer`: `"glow"` — ореол света (до
 * знаков, чтобы свет лёг под соседей), `"badge"` — знаки, пульс и вспышка
 * (после знаков). `live` — запись из `Map` для этой метки; нет записи — ничего
 * не рисуется, и ни одного вызова `ctx`.
 */
export function drawMarkLive(ctx, project, scheme, mark, view, live, fx, options = {}) {
  if (!live || markIsComment(mark) || !mark.points || mark.points.length === 0) return;
  const layer = options.layer === "glow" ? "glow" : "badge";
  const kind = SIM_LIVE_KINDS.includes(live.kind) ? live.kind : "other";
  const radius = markRadius(view);
  const screen = markStackPoints(mark, options.stacks || null).map((point) => planToScreen(point, scheme, view));
  if (layer === "glow") {
    if (live.on && kind === "light") drawLiveGlow(ctx, mark, screen, radius, live);
    return;
  }
  const effects = fx || {};
  const at = screen[0];
  if (live.alert) {
    // Красная метка-пульс: постоянное кольцо и расходящаяся волна.
    const phase = simLiveShare(effects.pulse);
    ctx.save();
    ctx.strokeStyle = SIM_LIVE_ALERT_COLOR;
    ctx.lineWidth = 2.5;
    for (const point of screen) {
      ctx.globalAlpha = 0.95;
      ctx.beginPath();
      ctx.arc(point.x, point.y, radius * 1.3, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 0.7 * (1 - phase);
      ctx.beginPath();
      ctx.arc(point.x, point.y, radius * (1.3 + 1.6 * phase), 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }
  const flash = effects.flash && typeof effects.flash.get === "function" ? simLiveShare(effects.flash.get(mark.id)) : 0;
  if (flash > 0) {
    ctx.save();
    ctx.strokeStyle = "#0969da";
    ctx.lineWidth = 3;
    ctx.globalAlpha = flash;
    ctx.beginPath();
    ctx.arc(at.x, at.y, radius * (1.2 + 1.8 * (1 - flash)), 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
  const shows = kind === "curtain" ? live.open > 0 : live.on && kind !== "light";
  if (shows) {
    drawLiveBadge(ctx, { x: at.x + radius * 1.05, y: at.y - radius * 1.05 }, Math.max(4, radius * 0.55), kind, live);
  }
}

// ——— стопка совпавших меток: отрисовка ————————————————————————————————
//
// Ни одного нового способа рисовать знак: сами знаки рисует тот же
// `drawMarkBody`, уже по смещённой точке. Здесь только то, чего без стопки не
// бывает, — тонкая линия от настоящей точки к уехавшим знакам. Подписей высот
// у знаков больше нет (G188), и второй проход по стопке отпал вместе с ними.

/**
 * Спина стопки: волосяная линия от настоящей точки метки к дальнему знаку.
 *
 * Без неё стопка читалась бы рядом меток, стоящих на плане по-настоящему, —
 * а они стоят в одном месте. Рецепт тот же, что у поводка отведённой подписи
 * (`drawLabelLeader`): цвет метки вполсилы, толщина от размера знака. Красится
 * цветом той метки, что осталась на настоящей точке: спина принадлежит месту,
 * а не всем типам в стопке.
 */
function drawMarkStackSpines(ctx, project, scheme, view, marks, stacks) {
  if (!stacks || stacks.size === 0) return;
  ctx.save();
  ctx.globalAlpha = 0.55;
  ctx.lineWidth = Math.max(1, markRadius(view) * 0.12);
  for (const mark of marks) {
    const shift = stacks.get(mark.id);
    if (!shift || shift.index !== 0 || shift.count < 2) continue;
    const from = planToScreen(mark.points[0], scheme, view);
    const far = shift.stepPx * (shift.count - 1);
    ctx.strokeStyle = styleOf(project, mark.typeId).color;
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(from.x + shift.dir.x * far * view.zoom, from.y + shift.dir.y * far * view.zoom);
    ctx.stroke();
  }
  ctx.restore();
}


// Ручки «+» рисуются только у выделенной точки. `color` — цвет типа, который
// эта ручка поставит: в смешанном блоке она красится в цвет ставящейся метки,
// а без него остаётся цветом выделения.
export function drawHandles(ctx, scheme, mark, view, color, stacks = null) {
  const tint = color || "#0969da";
  for (const handle of handlePositions(scheme, mark, view, stacks)) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(handle.x, handle.y, handle.r, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255, 255, 255, 0.95)";
    ctx.strokeStyle = tint;
    ctx.lineWidth = 1.5;
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    const arm = handle.r * 0.5;
    ctx.moveTo(handle.x - arm, handle.y);
    ctx.lineTo(handle.x + arm, handle.y);
    ctx.moveTo(handle.x, handle.y - arm);
    ctx.lineTo(handle.x, handle.y + arm);
    ctx.strokeStyle = tint;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
  }
}

// Видимая часть холста в его собственных единицах: по ней тянутся направляющие.
// Ширину холста знает только `ctx`, и если он её не отдаёт (заглушка в тесте),
// направляющая тянется по плану.
function drawExtent(ctx, scheme, view) {
  const scale = typeof ctx.getTransform === "function" ? ctx.getTransform() : null;
  const ratio = scale && scale.a > 0 ? scale.a : 0;
  const width = ctx.canvas && ctx.canvas.width > 0 && ratio > 0 ? ctx.canvas.width / ratio : 0;
  const height = ctx.canvas && ctx.canvas.height > 0 && ratio > 0 ? ctx.canvas.height / ratio : 0;
  if (width > 0 && height > 0) return { width, height };
  return {
    width: view.offsetX + schemeWidthPx(scheme) * view.zoom,
    height: view.offsetY + schemeHeightPx(scheme) * view.zoom,
  };
}

// Направляющие: полупрозрачный мелкий пунктир через вершину, которая поймала
// курсор. Узор нарочно мельче любого начертания метки — иначе на пунктирной
// линии не понять, где черновик, а где подсказка.
export function drawDraftGuides(ctx, scheme, guides, view, color) {
  if (!guides || guides.length === 0) return;
  const box = drawExtent(ctx, scheme, view);
  ctx.save();
  ctx.globalAlpha = GUIDE_ALPHA;
  ctx.strokeStyle = color;
  ctx.lineWidth = GUIDE_WIDTH;
  ctx.setLineDash(GUIDE_DASH);
  for (const guide of guides) {
    const at = planToScreen(guide.at, scheme, view);
    ctx.beginPath();
    if (guide.axis === "h") {
      ctx.moveTo(0, at.y);
      ctx.lineTo(box.width, at.y);
    } else {
      ctx.moveTo(at.x, 0);
      ctx.lineTo(at.x, box.height);
    }
    ctx.stroke();
  }
  ctx.restore();
}

// Черновик линии: уже поставленные вершины плюс резинка до курсора.
function drawDraft(ctx, scheme, draft, view, color, lineStyle) {
  if (!draft || draft.points.length === 0) return;
  const radius = markRadius(view);
  // Направляющие — под черновиком: подсказка не должна перечёркивать линию.
  drawDraftGuides(ctx, scheme, draft.guides, view, color);
  const screen = draft.points.map((point) => planToScreen(point, scheme, view));
  // Черновик рисуется тем же начертанием, каким ляжет метка: волну и пунктир
  // видно ещё до того, как линия поставлена. Резинка до курсора — часть той же
  // нитки, иначе узор на ней начинался бы заново.
  const drawn = draft.cursor ? [...screen, planToScreen(draft.cursor, scheme, view)] : screen;
  if (drawn.length > 1) strokeStyledLine(ctx, drawn, false, lineStyle, radius, color);
  for (const point of screen) drawShape(ctx, "circle", point.x, point.y, Math.max(3, radius * 0.5), color);
  // Первая вершина крупнее: по ней замыкают контур.
  drawShape(ctx, "circle", screen[0].x, screen[0].y, Math.max(4, radius * 0.75), color);
  if (!draft.cursor) return;
  const from = draft.points[draft.points.length - 1];
  const start = planToScreen(from, scheme, view);
  const cursor = planToScreen(draft.cursor, scheme, view);
  if (Math.hypot(cursor.x - start.x, cursor.y - start.y) < DRAFT_ANGLE_MIN_PX) return;
  // Угол берётся у уже нарисованного отрезка: точку под курсором холст к этому
  // времени притянул сам, и подсказка обязана показывать то, что видно.
  const shown = snapSegment(from, draft.cursor, scheme, { free: true });
  // Подсказка живёт только на экране — черновика в выгрузке не бывает, — но
  // шрифт ей всё равно даётся кадром, а не берётся по умолчанию: иначе на
  // системной схеме один градус был бы чертёжным.
  drawDraftAngle(ctx, cursor, shown.angle, Boolean(draft.snapped), color, renderView(view).fontFamily);
}

// Градус тянущегося отрезка — у курсора, а не в углу холста: инженер смотрит на
// конец линии, и по углу холста не понять, к какому отрезку относится число.
// Сработавший магнит виден по слову «ровно» и цвету — иначе непонятно, почему
// линия не идёт за рукой.
//
// Зовут это и холст, и чертёж (таск 172): притяжку чертёж считал той же
// `draftSnap` и **выбрасывал** посчитанное — в миллиметрах, где прямой угол
// важнее всего, про прямой угол и молчали. Второго рисовальщика градуса для
// этого заводить не стали.
export function drawDraftAngle(ctx, at, angle, snapped, color, family) {
  const value = text(snapped ? "canvas.angleSnapped" : "canvas.angleFree", { deg: Math.round(angle) % 360 });
  ctx.save();
  ctx.font = drawFont(DRAFT_ANGLE_FONT, 600, family);
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.lineWidth = Math.max(2, DRAFT_ANGLE_FONT * 0.3);
  ctx.lineJoin = "round";
  const x = draftAngleX(ctx, at, ctx.measureText(value).width);
  const y = at.y - DRAFT_ANGLE_GAP;
  ctx.strokeStyle = "rgba(255, 255, 255, 0.92)";
  ctx.strokeText(value, x, y);
  ctx.fillStyle = snapped ? color : DRAFT_ANGLE_FREE;
  ctx.fillText(value, x, y);
  ctx.restore();
}

// Подсказка стоит справа от курсора, а у правого края холста переезжает влево:
// обрезанное число не читается, а курсор у края — обычное дело, когда линию
// ведут к стене. Ширину холста в своих единицах знает только `ctx`, и если он
// её не отдаёт (заглушка в тесте), подсказка остаётся справа.
function draftAngleX(ctx, at, width) {
  const right = at.x + DRAFT_ANGLE_GAP;
  const scale = typeof ctx.getTransform === "function" ? ctx.getTransform() : null;
  const ratio = scale && scale.a > 0 ? scale.a : 0;
  const edge = ctx.canvas && ctx.canvas.width > 0 && ratio > 0 ? ctx.canvas.width / ratio : 0;
  if (!(edge > 0) || right + width <= edge) return right;
  return at.x - DRAFT_ANGLE_GAP - width;
}

function legendRows(project, scheme, filter) {
  const used = new Set(visibleMarks(project, scheme, filter).map((mark) => mark.typeId));
  const rows = [];
  for (const group of typesInOrder(project)) {
    // Комментариев в легенде нет (G167): легенда объясняет знаки, а у плашки
    // знака нет — она читается сама.
    for (const type of listedTypes(project, group.types)) {
      if (!used.has(type.id)) continue;
      rows.push({ code: type.code, name: type.name, category: group.category.name, ...styleOf(project, type.id) });
    }
  }
  return rows;
}

// Легенда — для выгрузки: список типов, встреченных на схеме.
export function drawLegend(ctx, { project, scheme, filter, view, box }) {
  const rows = legendRows(project, scheme, filter);
  if (rows.length === 0) return;
  const state = renderView(view);
  const font = Math.max(11, labelFontSize(state) * 0.9);
  const step = font * 1.7;
  const x = box ? box.x : 12;
  const y = box ? box.y : 12;
  ctx.save();
  ctx.font = drawFont(font, null, state.fontFamily);
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  // Ширина рамки — по самой длинной строке: код типа бывает и в шестнадцать
  // букв, а рамка фиксированной ширины оставляла «ПОДСВЕТКА — подсветка ниши»
  // лежать поверх плана. Шире предела легенда сама закрывает план, и строка
  // обрезается многоточием.
  const textX = font * LEGEND_TEXT_EM;
  const pad = font * 0.8;
  const texts = rows.map((row) => legendClip(ctx, `${row.code} — ${row.name}`, font * LEGEND_MAX_EM - textX - pad));
  const widest = texts.reduce((max, value) => Math.max(max, ctx.measureText(value).width), 0);
  const width = Math.max(font * LEGEND_MIN_EM, textX + widest + pad);
  const height = step * rows.length + font;
  ctx.fillStyle = "rgba(255, 255, 255, 0.92)";
  ctx.strokeStyle = "#d0d7de";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.rect(x, y, width, height);
  ctx.fill();
  ctx.stroke();
  rows.forEach((row, index) => {
    const lineY = y + font * 0.6 + step * (index + 0.5);
    drawShape(ctx, row.shape, x + font * 1.1, lineY, font * 0.55, row.color);
    ctx.fillStyle = "#1f2328";
    ctx.fillText(texts[index], x + textX, lineY);
  });
  ctx.restore();
}

// Весь кадр: план, метки, подписи, при надобности легенда. Тот же код и на
// экране, и в экспорте — меняется только масштаб во `view`.
// ——— чертёж: стены, проёмы и объекты ——————————————————————————————————
//
// Слой чертежа рисуется **одним кодом на две поверхности** — в мастерской
// (таски 125–126) и на основном холсте вместе с метками (таск 127). Второй
// отрисовки быть не должно: разойдись они, дверь на холсте открывалась бы не в
// ту сторону, чем в окне, и заметили бы это на бумаге.
//
// Поверхности отличаются ровно одним — тем, как миллиметр превращается в
// пиксель экрана, и это вынесено в **мост** (`bridge`):
//   мастерская — миллиметр и есть «пиксель плана», мост тождественный;
//   холст — миллиметры ложатся на доли плана через калибровку и привязку
//     (ADR 008), и мост считает `drawingBridge`.
// Больше ничего о поверхности этот код не знает.

// Краска чертежа. Стена почти чёрная — на бумаге и поверх скана она должна
// читаться стеной; объект на полу фиолетовый и тоньше — он не стена, и путать
// их нельзя. В чёрно-белом листе всё это проходит через `mono.js` и становится
// тушью, своей развилки здесь нет (G170).
export const DRAWING_WALL = "#30363d";
// Подкраска стены, видимой торцом на развёртке (G201). Слабая нарочно: `mono`
// снимает заливку слабее половины как подкраску и оставляет контур тушью, то
// есть на чёрно-белом листе торец выходит рамкой, а не чёрным пятном поверх
// меток.
export const DRAWING_WALL_FILL = "rgba(48, 54, 61, 0.12)";
export const DRAWING_EDGE = "#0f1419";
// Стеклянная стена на плане (правка 2026-10-27): голубая полоса в толщину
// стены и тонкие кромки — так стекло и рисуют.
export const DRAWING_GLASS = "#9fc9db";
export const DRAWING_PAPER = "#f6f8fa";
export const DRAWING_OBJECT = "#6639ba";
export const DRAWING_OBJECT_FILL = "rgba(102, 57, 186, 0.12)";

// Чем призрак отличается от вещи, и только этим (таск 168): пунктирный контур
// и полсилы цвета. Всё остальное — заливка, толщина, подпись — у него общее с
// тем, что встанет по клику.
export const DRAWING_GHOST_ALPHA = 0.7;
export const DRAWING_GHOST_DASH = [5, 4];
export const DRAWING_ACTIVE = "#1f6feb";
export const DRAWING_BAD = "#d1242f";
export const DRAWING_CAPTION = "#57606a";

// Подпись объекта показывается, только когда объекту есть куда её принять:
// на общем виде квартиры десяток подписей превратился бы в кашу поверх меток.
const DRAWING_CAPTION_MIN_PX = 70;


/** Концы проёма на оси стены плюс её векторы — всё, чем он рисуется и ловится. */
export function drawingOpeningSpan(wall, opening) {
  const vectors = wallVectors(wall);
  if (!vectors || !opening) return null;
  const at = Number(opening.atMm) || 0;
  const width = Number(opening.widthMm) || 0;
  const point = (distance) => ({
    x: wall.aMm.x + vectors.u.x * distance,
    y: wall.aMm.y + vectors.u.y * distance,
  });
  return { from: point(at), to: point(at + width), u: vectors.u, n: vectors.n, len: vectors.len, width };
}

/**
 * Створки проёма с полотном: где петля (или край полотна), где закрытое
 * положение и где кончик открытого.
 *
 * **Распашная, одна створка.** Четыре сочетания петель и стороны — это четыре
 * разные двери, и различают их на чертеже именно по створке: с какого косяка
 * она растёт и в какую сторону стены открывается. Полотно рисуется раскрытым
 * на четверть оборота — так его рисуют на планах, и так видно, какой кусок пола
 * дверь занимает.
 *
 * **Распашная, две створки** (таск 215: двустворчатая дверь, распашные ворота)
 * — то же самое дважды: каждая створка шириной в половину проёма растёт от
 * своего косяка и открывается на ту же сторону стены. Петли у такой двери стоят
 * у обоих косяков, поэтому `hinge` её рисунка не меняет — и кольцо `Q`/`E` у
 * неё из двух состояний, а не из четырёх (`openingDoorStates`).
 *
 * **Сдвижная, гармошка, портальная** — полотно не поворачивается, а едет: оно
 * лежит **вдоль** стены, и признаков у него те же два. `swing` говорит, по
 * какой стороне стены идёт полотно (у портальной — внутри самой стены), `hinge`
 * — в какую сторону оно уходит, открываясь. Створка здесь не ручка поворота, а
 * полоса, поэтому у неё `pivot: false`: ручку петли у такой двери не ставят —
 * крутить нечего.
 */
export function drawingDoorLeaves(wall, opening) {
  const span = drawingOpeningSpan(wall, opening);
  if (!span || !(span.width > 0)) return [];
  const motion = openingMotionOf(opening.kind);
  const side = opening.swing === "right" ? -1 : 1;
  const atStart = opening.hinge !== "end";
  const along = (point, distance) => ({ x: point.x + span.u.x * distance, y: point.y + span.u.y * distance });
  const across = (point, distance) => ({
    x: point.x + span.n.x * side * distance,
    y: point.y + span.n.y * side * distance,
  });
  if (motion === "swing") {
    if (openingLeavesOf(opening.kind) > 1) {
      const half = span.width / 2;
      const middle = along(span.from, half);
      return [span.from, span.to].map((hinge) => ({
        motion,
        // Петли у двупольной двери у обоих косяков: ручки петли у неё нет,
        // переставлять нечего.
        pivot: false,
        hinge,
        closed: middle,
        tip: across(hinge, half),
        radius: half,
        side,
        n: span.n,
        u: span.u,
      }));
    }
    const hinge = atStart ? span.from : span.to;
    const closed = atStart ? span.to : span.from;
    return [
      {
        motion,
        pivot: true,
        hinge,
        closed,
        tip: across(hinge, span.width),
        radius: span.width,
        side,
        n: span.n,
        u: span.u,
      },
    ];
  }
  if (!motion || motion === "lift") return [];
  // Полотно, которое едет. Портальное лежит **в** стене (его карман — внутри
  // неё), остальные — по её стороне: отступ откладывает отрисовка, потому что
  // только она знает толщину стены в точках.
  const head = atStart ? span.from : span.to;
  const tail = atStart ? span.to : span.from;
  return [
    {
      // Ручка у головы полотна есть: щелчок по ней переставляет сторону, в
      // которую полотно уходит, — то же, что у петель распашной.
      motion,
      pivot: true,
      hinge: head,
      closed: tail,
      tip: tail,
      radius: span.width,
      side,
      n: span.n,
      u: span.u,
      // Куда уходит полотно: к началу стены или к её концу. Знак — вдоль `u`.
      park: atStart ? -1 : 1,
      inWall: motion === "pocket",
    },
  ];
}

/**
 * Створка, за которую берут рукой: первая из `drawingDoorLeaves`.
 *
 * Ручки правки и попадание курсора спрашивают **одну** створку — ту, которая
 * отвечает за состояние двери. У двустворчатой это створка у начала проёма:
 * щелчок по её кончику переставляет сторону открывания обеих, потому что
 * сторона у них общая.
 */
export function drawingDoorLeaf(wall, opening) {
  const leaves = drawingDoorLeaves(wall, opening);
  return leaves.length > 0 ? leaves[0] : null;
}



function drawingInsidePolygon(point, corners) {
  let inside = false;
  for (let i = 0, j = corners.length - 1; i < corners.length; j = i, i += 1) {
    const a = corners[i];
    const b = corners[j];
    const crosses = a.y > point.y !== b.y > point.y;
    if (crosses && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Попал ли курсор в объект: внутрь прямоугольника или в полосу ломаной. */
export function drawingHitObject(object, pointMm, slackMm) {
  const corners = schemeObjectCorners(object);
  if (corners.length === 0) return false;
  if (object.shape === "polyline") {
    const limit = Math.max(Number(slackMm) || 0, Number(object.depthMm) / 2);
    for (let index = 1; index < corners.length; index += 1) {
      if (segmentDistanceMm(pointMm, corners[index - 1], corners[index]) <= limit) return true;
    }
    return false;
  }
  if (drawingInsidePolygon(pointMm, corners)) return true;
  const limit = Number(slackMm) || 0;
  for (let index = 0; index < corners.length; index += 1) {
    if (segmentDistanceMm(pointMm, corners[index], corners[(index + 1) % corners.length]) <= limit) return true;
  }
  return false;
}

// Поворот вектора на четверть оборота по часовой в экранных осях — тот же, что
// `turnVector` модели и что `ctx.rotate` при положительном угле. Повторён
// здесь потому, что модель его наружу не отдаёт; согласие с моделью не
// объявляется, а проверяется тестом (`drawingBridge` против `planMmToFraction`).
function drawingTurn(point, turn) {
  if (turn === 90) return { x: -point.y, y: point.x };
  if (turn === 180) return { x: -point.x, y: -point.y };
  if (turn === 270) return { x: point.y, y: -point.x };
  return { x: point.x, y: point.y };
}

/**
 * Мост «миллиметр чертежа → пиксель экрана» для основного холста.
 *
 * Считается **один раз на кадр**, а не вызовом `planMmToFraction` на каждую
 * точку: у сотни стен это тысяча вызовов, каждый со своим поиском схемы и
 * пересчётом калибровки. Преобразование аффинное, поэтому сводится к одному
 * умножению на точку — и согласие этой арифметики с мостом модели проверяется
 * тестом на всех четырёх поворотах подложки.
 *
 * `null` — моста нет: нет калибровки или нет привязки. Чертёж тогда не
 * рисуется, и сказать об этом должен тот, кто звал (ADR 008: «чертёж виден на
 * подложке только при двух условиях сразу»).
 *
 * **Угол привязки не кэшируется ни на миг**: кнопка поворота плана меняет его
 * в любую минуту (G178), а мост живёт один кадр.
 */
export function drawingBridge(project, scheme, view) {
  if (!project || !scheme) return null;
  const perMeter = planPixelsPerMeter(project, scheme.id);
  const origin = planOriginOf(project, scheme.id);
  if (!(perMeter > 0) || !origin) return null;
  const state = renderView(view);
  const width = schemeWidthPx(scheme);
  const height = schemeHeightPx(scheme);
  const pxPerMm = perMeter / 1000;
  const zeroX = state.offsetX + origin.at.x * width * state.zoom;
  const zeroY = state.offsetY + origin.at.y * height * state.zoom;
  const turn = origin.turn;
  const scale = pxPerMm * state.zoom;
  return {
    pxPerMm: scale,
    toScreen(pointMm) {
      const px = drawingTurn({ x: Number(pointMm.x) * scale, y: Number(pointMm.y) * scale }, turn);
      return { x: zeroX + px.x, y: zeroY + px.y };
    },
    // Обратный ход: миллиметр под точкой экрана. Нужен сетке (таск 193) —
    // она идёт от края поля до края, и чтобы узнать, с какого миллиметра
    // начать, надо перевести угол кадра обратно. Поворот снимается тем же
    // `drawingTurn` на дополнение до полного оборота.
    toMm(point) {
      const px = drawingTurn({ x: Number(point.x) - zeroX, y: Number(point.y) - zeroY }, (360 - turn) % 360);
      return { x: px.x / scale, y: px.y / scale };
    },
  };
}

/** Мост мастерской: там «пиксель плана» и есть миллиметр, поворота нет. */
export function drawingUnitBridge(view) {
  const state = renderView(view);
  return {
    pxPerMm: state.zoom,
    toScreen(pointMm) {
      return { x: state.offsetX + Number(pointMm.x) * state.zoom, y: state.offsetY + Number(pointMm.y) * state.zoom };
    },
    toMm(point) {
      return { x: (Number(point.x) - state.offsetX) / state.zoom, y: (Number(point.y) - state.offsetY) / state.zoom };
    },
  };
}

// ——— сетка чертежа: один рисунок на два поля (таск 193, G293) —————————————
//
// Слова заказчика: «Сделай что бы сетка была и на схеме… Короче меню Интерфейс
// не должно отличаться от режима чертеж\схема». Сетка жила внутри мастерской
// и рисовалась только там; теперь она рисуется **мостом**, а мост есть у обоих
// полей — у плана `drawingBridge`, у мастерской `drawingUnitBridge`. Шаг у них
// один и тот же: он лежит в объекте (`model.gridStepOf`, G258).
//
// Реже пяти пикселей на экране сетка читается заливкой — рисуется кратный шаг,
// а притягивается по-прежнему выбранный: иначе отметка «шаг 100 мм» врала бы
// на мелком масштабе.
const GRID_MIN_PX = 5;
const GRID_MULTIPLES = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000];
// Каждая пятая линия темнее: по ним глаз считает метры.
const GRID_MAJOR_EVERY = 5;
const GRID_LINE = "#d0d7de";
const GRID_MAJOR = "#aeb7c0";

/**
 * Шаг сетки, которым её **рисуют**: выбранный человеком или кратный ему, если
 * выбранный на этом масштабе слился бы в заливку. `0` — не рисуется вовсе
 * (нет шага или «Без сетки»).
 */
export function gridDrawStepMm(gridMm, pxPerMm) {
  const step = Number(gridMm) || 0;
  const scale = Number(pxPerMm) > 0 ? Number(pxPerMm) : 1;
  if (!(step > 0)) return 0;
  for (const multiple of GRID_MULTIPLES) {
    if (step * multiple * scale >= GRID_MIN_PX) return step * multiple;
  }
  return 0;
}

/**
 * Сетка в миллиметрах чертежа поверх поля. `bridge` — мост того поля, которое
 * рисует (у плана он знает и поворот подложки, поэтому четверть оборота сетку
 * не кривит: линии остаются по осям листа).
 *
 * Шаг `0` и отсутствие моста — молчание: кадр не меняется ни на пиксель.
 */
export function drawDrawingGrid(ctx, bridge, box, gridMm) {
  if (!ctx || !bridge || !box) return 0;
  const step = gridDrawStepMm(gridMm, bridge.pxPerMm);
  if (!(step > 0)) return 0;
  // Край кадра в миллиметрах: все четыре угла, потому что при повороте
  // подложки угол «слева сверху» на листе может оказаться любым.
  const corners = [
    bridge.toMm({ x: 0, y: 0 }),
    bridge.toMm({ x: box.width, y: 0 }),
    bridge.toMm({ x: 0, y: box.height }),
    bridge.toMm({ x: box.width, y: box.height }),
  ];
  const xs = corners.map((point) => point.x);
  const ys = corners.map((point) => point.y);
  const from = { x: Math.min(...xs), y: Math.min(...ys) };
  const to = { x: Math.max(...xs), y: Math.max(...ys) };
  ctx.save();
  ctx.lineWidth = 1;
  const line = (ax, ay, bx, by, major) => {
    const start = bridge.toScreen({ x: ax, y: ay });
    const end = bridge.toScreen({ x: bx, y: by });
    ctx.strokeStyle = major ? GRID_MAJOR : GRID_LINE;
    ctx.beginPath();
    // Полупиксельный сдвиг — чтобы линия в один пиксель не размазалась на два.
    ctx.moveTo(Math.round(start.x) + 0.5, Math.round(start.y) + 0.5);
    ctx.lineTo(Math.round(end.x) + 0.5, Math.round(end.y) + 0.5);
    ctx.stroke();
  };
  let count = 0;
  for (let mm = Math.ceil(from.x / step) * step; mm <= to.x; mm += step) {
    line(mm, from.y, mm, to.y, Math.round(mm / step) % GRID_MAJOR_EVERY === 0);
    count += 1;
  }
  for (let mm = Math.ceil(from.y / step) * step; mm <= to.y; mm += step) {
    line(from.x, mm, to.x, mm, Math.round(mm / step) % GRID_MAJOR_EVERY === 0);
    count += 1;
  }
  ctx.restore();
  return count;
}

/**
 * Направляющие плана поверх чертежа (таск 193). Место направляющей задано
 * **долей подложки** (ADR 002), а поле чертежа мерит миллиметры, — значит доля
 * переводится мостом модели, тем же, которым на подложку ложится чертёж.
 *
 * Поворот подложки четвертями оборота меняет ось: вертикальная направляющая
 * плана на повёрнутом листе идёт горизонтально. Решается это не разбором
 * поворота, а двумя точками: куда легли оба конца — та и ось.
 */
export function drawDrawingGuides(ctx, bridge, project, schemeId, guides, box, options = {}) {
  if (!ctx || !bridge || !project || !schemeId || !guides || guides.length === 0 || !box) return 0;
  const active = options.activeId || null;
  ctx.save();
  let drawn = 0;
  for (const guide of guides) {
    const ends =
      guide.axis === "h"
        ? [
            { x: 0, y: guide.at },
            { x: 1, y: guide.at },
          ]
        : [
            { x: guide.at, y: 0 },
            { x: guide.at, y: 1 },
          ];
    const mm = ends.map((point) => planFractionToMm(project, schemeId, point));
    if (!mm[0] || !mm[1]) continue;
    const at = mm.map((point) => bridge.toScreen(point));
    const live = guide.id === active;
    ctx.strokeStyle = live ? GUIDE_LINE_ACTIVE : GUIDE_LINE;
    ctx.lineWidth = live ? 1.6 : 1;
    ctx.beginPath();
    if (Math.abs(at[0].x - at[1].x) < 0.5) {
      const x = Math.round(at[0].x) + 0.5;
      ctx.moveTo(x, 0);
      ctx.lineTo(x, box.height);
    } else {
      const y = Math.round(at[0].y) + 0.5;
      ctx.moveTo(0, y);
      ctx.lineTo(box.width, y);
    }
    ctx.stroke();
    drawn += 1;
  }
  ctx.restore();
  return drawn;
}

function drawingOpeningsByWall(project, schemeId) {
  const byWall = new Map();
  for (const wall of wallsOnScheme(project, schemeId)) byWall.set(wall.id, openingsInWall(project, wall.id));
  return byWall;
}

/**
 * Слой чертежа целиком. Рисует стены с толщиной, проёмы в них и объекты на
 * полу — в этом порядке снизу вверх: объект на полу уходит под стену, потому
 * что стена на чертеже главная, а проём ложится поверх своей стены, потому что
 * он в ней дырка.
 *
 * `options.active` — что подсвечено и ручками (только мастерская).
 * `options.wallAt` — подмена концов стены на время перетаскивания.
 * `options.openingAt` — подмена отступа проёма на то же время.
 * `options.handle` — чем рисовать ручку; без неё ручек нет. Ручки идут
 *   **последним слоем**, поверх всего начерченного (`drawDrawingHandles`).
 * `options.labels` — `false` рисует чертёж без слов (буквы углов, имена
 *   объектов): так его просит миникарта объёма.
 * `options.hiddenObjectIds` — вещи, спрятанные с экрана поштучно (таск 154,
 *   G223). Список приходит **доводом, а не из объекта**: прятать их — выбор
 *   глаз, и в выгрузках его нет вовсе. Кто не передал — у того на листе все
 *   вещи, как и было.
 */
export function drawDrawing(ctx, options = {}) {
  const { project, schemeId, bridge } = options;
  if (!project || !schemeId || !bridge) return;
  const walls = wallsOnScheme(project, schemeId);
  const hidden = options.hiddenObjectIds instanceof Set ? options.hiddenObjectIds : new Set(options.hiddenObjectIds || []);
  const objects =
    options.objects === false
      ? []
      : schemeObjectsOnScheme(project, schemeId).filter((object) => !hidden.has(object.id));
  if (walls.length === 0 && objects.length === 0) return;
  const active = options.active || null;
  // `labels: false` — чертёж без слов: ни букв углов, ни подписей объектов.
  // Заведено для миникарты объёма (G212, таск 150), где заказчик попросил
  // «только схема и местоположение»: на накладке в двести точек подписи
  // превращаются в кашу, а читают по ней не имена, а своё место.
  const labels = options.labels !== false;
  for (const object of objects) {
    drawDrawingObject(ctx, bridge, options.objectAt ? options.objectAt(object) : object, {
      active: active && active.kind === "object" && active.id === object.id,
      // Имя вещи спрашивается у модели: у вещи каталога оно каталожное, у
      // прежней — её собственное из справочника объекта (таск 154).
      name: labels ? schemeObjectNameOf(project, object) : "",
      stair: drawingStairParts(project, schemeId, object),
    });
  }
  // Проём, который сейчас правят: его створку ручками показывает последний
  // слой, и искать её там заново по стенам незачем.
  let activeOpening = null;
  if (options.walls !== false) {
    const byWall = drawingOpeningsByWall(project, schemeId);
    for (const wall of walls) {
      const ends = options.wallAt ? options.wallAt(wall) : wall;
      drawDrawingWall(ctx, bridge, ends, active && active.kind === "wall" && active.id === wall.id);
    }
    for (const wall of walls) {
      const ends = options.wallAt ? options.wallAt(wall) : wall;
      for (const opening of byWall.get(wall.id) || []) {
        const shown = options.openingAt ? options.openingAt(opening) : opening;
        const live = Boolean(active && active.kind === "opening" && active.id === opening.id);
        if (live) activeOpening = { wall: ends, opening: shown };
        drawDrawingOpening(ctx, bridge, ends, shown, { active: live });
      }
    }
    // Буквы углов — поверх стен и проёмов, но под разметкой: метка главнее
    // обозначения стены, как и везде (G200). Вместе со слоем стен они и гаснут:
    // буква без стены не значит ничего.
    if (labels) drawDrawingLetters(ctx, bridge, wallNames(project, schemeId), walls, options.wallAt);
  }
  drawDrawingHandles(ctx, bridge, {
    walls,
    objects,
    active,
    activeOpening,
    handle: options.handle,
    wallAt: options.wallAt,
    objectAt: options.objectAt,
  });
}

/**
 * Ручки правки — **последний слой чертежа** (дефект D45, снимок заказчика: «на
 * чертеже точки, за которые можно менять размер объекта, рисуются под линией
 * стены, а должны быть поверх»).
 *
 * Прежде каждый рисовал свои сам: углы вещи — `drawDrawingObject`, петлю и
 * край створки — `drawDrawingDoor`, концы стены — хвост `drawDrawing`. Слой у
 * ручки получался тот же, что у того, кому она принадлежит, — а вещи на полу
 * лежат **под** стенами (так и задумано: стена на чертеже главная). Выходило,
 * что у ванны, у столешницы и у радиатора — у всего, что к стене и приставлено,
 * — ручка пропадала ровно под той линией, от которой вещь надо оттащить. То же
 * и у створки двери: её ручки рисовались до букв углов и уходили под кружок
 * буквы.
 *
 * Ручка — не часть чертежа, а место, куда класть руку: под чертежом ей делать
 * нечего, и слой у неё один на всех — поверх стен, проёмов и букв.
 */
function drawDrawingHandles(ctx, bridge, { walls, objects, active, activeOpening, handle, wallAt, objectAt }) {
  if (!handle || !active) return;
  if (active.kind === "object") {
    const object = objects.find((item) => item.id === active.id);
    if (!object) return;
    const shown = objectAt ? objectAt(object) : object;
    for (const point of schemeObjectCorners(shown)) handle(ctx, bridge.toScreen(point));
    return;
  }
  if (active.kind === "opening") {
    if (!activeOpening || !openingHasLeaf(activeOpening.opening.kind)) return;
    const leaf = drawingDoorLeaf(activeOpening.wall, activeOpening.opening);
    if (!leaf) return;
    // Ручка петли — только там, где петлям есть что переставить: у двупольной
    // двери они стоят у обоих косяков, и ручка обещала бы выбор, которого нет.
    if (leaf.pivot) handle(ctx, bridge.toScreen(leaf.hinge));
    handle(ctx, bridge.toScreen(leaf.tip));
    return;
  }
  if (active.kind !== "wall") return;
  const wall = walls.find((item) => item.id === active.id);
  if (!wall) return;
  const ends = wallAt ? wallAt(wall) : wall;
  handle(ctx, bridge.toScreen(ends.aMm));
  handle(ctx, bridge.toScreen(ends.bMm));
}

// Мельче этого буква угла на плане не ставится. Порог — экранная длина самой
// стены: на общем виде квартиры буквы всех углов слиплись бы в кашу поверх
// чертежа, а у стены короче сорока точек их всё равно негде развести. Правило
// то же, что у подписи объекта (`DRAWING_CAPTION_MIN_PX`): порог в экранных
// пикселях, а не отметка «тут показывать, а тут нет».
const DRAWING_LETTER_MIN_PX = 44;

/**
 * Буквы углов на чертеже.
 *
 * Буква ставится **в самом углу** — там, где сошлись концы стен. Так видно, что
 * она у угла одна на всех, и имя любой стены читается по её двум концам; напиши
 * имя вдоль стены, и смежность, ради которой буквы и заводились, пропала бы.
 *
 * **Кружком, а не просто буквой.** Так на строительных чертежах обозначают
 * координационные оси (ГОСТ 21.101), откуда взят и сам алфавит, — и так буква
 * читается на тёмной стене: живым прогоном видно, что тёмная буква с тонкой
 * обводкой на стене цвета `DRAWING_WALL` не читается вовсе. Кружок — это
 * бумага под буквой, и на чёрно-белом листе он остаётся белым с контуром тушью.
 *
 * Рисуется по **нарисованным** концам (`wallAt`), а не по записанным в объекте:
 * в мастерской стену тащат за ручку, и буква обязана ехать с углом, а не
 * оставаться там, где он был. Один угол — одна буква: совпавшие концы дают одно
 * и то же место, и повторную отрисовку снимает ключ по букве и месту.
 */
function drawDrawingLetters(ctx, bridge, names, walls, wallAt) {
  if (names.length === 0) return;
  const byWall = new Map(names.map((named) => [named.wallId, named]));
  const done = new Set();
  ctx.save();
  ctx.font = drawFont(11, 700);
  ctx.textBaseline = "middle";
  ctx.textAlign = "center";
  for (const wall of walls) {
    const named = byWall.get(wall.id);
    if (!named) continue;
    const ends = wallAt ? wallAt(wall) : wall;
    const from = bridge.toScreen(ends.aMm);
    const to = bridge.toScreen(ends.bMm);
    if (Math.hypot(to.x - from.x, to.y - from.y) < DRAWING_LETTER_MIN_PX) continue;
    for (const [letter, at] of [
      [named.aLetter, from],
      [named.bLetter, to],
    ]) {
      if (!letter) continue;
      const key = letter + "@" + Math.round(at.x) + ":" + Math.round(at.y);
      if (done.has(key)) continue;
      done.add(key);
      // Кружок по букве, а не постоянный: двухбуквенный угол в него тоже
      // обязан влезть, а не вылезти за края.
      const radius = Math.max(9, ctx.measureText(letter).width / 2 + 3);
      ctx.beginPath();
      ctx.arc(at.x, at.y, radius, 0, Math.PI * 2);
      ctx.fillStyle = DRAWING_PAPER;
      ctx.fill();
      ctx.lineWidth = 1.2;
      ctx.strokeStyle = DRAWING_CAPTION;
      ctx.stroke();
      ctx.fillStyle = DRAWING_EDGE;
      ctx.fillText(letter, at.x, at.y);
    }
  }
  ctx.restore();
}

/** Пунктир стены высотой ноль: на плане это край пола, а не стена. */
const DRAWING_LOW_WALL_DASH = [5, 3];

function drawDrawingWall(ctx, bridge, wall, active) {
  const from = bridge.toScreen(wall.aMm);
  const to = bridge.toScreen(wall.bMm);
  const width = Math.max(1, Number(wall.thicknessMm) * bridge.pxPerMm);
  ctx.lineCap = "butt";
  // **Стена высотой ноль** (правка после сборки сценариев) — стены нет, есть
  // край пола: два пунктира по граням без заливки. Так её видно и выделить
  // можно, а за стену её не примешь — как не примешь за неё границу балкона.
  if (wallOwnHeightMm(wall) === 0) {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length = Math.hypot(dx, dy) || 1;
    const nx = (dy / length) * (width / 2);
    const ny = (-dx / length) * (width / 2);
    ctx.save();
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = active ? DRAWING_ACTIVE : DRAWING_WALL;
    ctx.setLineDash(DRAWING_LOW_WALL_DASH);
    ctx.beginPath();
    ctx.moveTo(from.x + nx, from.y + ny);
    ctx.lineTo(to.x + nx, to.y + ny);
    ctx.moveTo(from.x - nx, from.y - ny);
    ctx.lineTo(to.x - nx, to.y - ny);
    ctx.stroke();
    ctx.restore();
    return;
  }
  if (wallGlassOf(wall)) {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length = Math.hypot(dx, dy) || 1;
    const nx = (dy / length) * (width / 2);
    const ny = (-dx / length) * (width / 2);
    ctx.lineWidth = width;
    ctx.strokeStyle = DRAWING_GLASS;
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
    ctx.lineWidth = 1;
    ctx.strokeStyle = active ? DRAWING_ACTIVE : DRAWING_WALL;
    ctx.beginPath();
    ctx.moveTo(from.x + nx, from.y + ny);
    ctx.lineTo(to.x + nx, to.y + ny);
    ctx.moveTo(from.x - nx, from.y - ny);
    ctx.lineTo(to.x - nx, to.y - ny);
    ctx.stroke();
    return;
  }
  ctx.lineWidth = width;
  ctx.strokeStyle = active ? DRAWING_ACTIVE : DRAWING_WALL;
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.stroke();
  // Осевая линия у толстой стены: по ней видно, где проходит сама стена,
  // когда её толщина на экране в полсантиметра.
  if (width <= 6) return;
  ctx.lineWidth = 1;
  ctx.strokeStyle = DRAWING_PAPER;
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.stroke();
}

/**
 * Проём в стене: разрыв до бумаги, два косяка поперёк стены и — по виду — то,
 * что его называет. Окно — ниткой стекла вдоль середины, арка — пунктиром,
 * проём без полотна — ничем, дверь — створкой с дугой.
 *
 * **Стеклянная дверь** (таск 180) рисуется той же створкой и той же дугой —
 * четыре состояния у неё те же, и различать их человек должен тем же рисунком,
 * — но полотно у неё не линия, а контур: рама по краю, бумага внутри. Это и
 * есть «с рамой, но не глухая, а по центру стекло» в плановой проекции, и это
 * тот же приём, которым на плане отличается окно: стекло — незакрашенное
 * место, обведённое по контуру.
 *
 * **Виды каталога** (таск 215) ложатся сюда без новой ветки на каждый: решают
 * порода и движение полотна. Окно любого вида — та же нитка, а импосты
 * отмечены короткими засечками поперёк просвета (у одинарного их нет, и кадр
 * прежнего окна не изменился ни на вызов). Полотно, которое едет, лежит вдоль
 * стены; роллетные и секционные ворота стоят полотном в самом проёме.
 */
export function drawDrawingOpening(ctx, bridge, wall, opening, options = {}) {
  const span = drawingOpeningSpan(wall, opening);
  if (!span) return;
  const half = Math.max(1, (Number(wall.thicknessMm) * bridge.pxPerMm) / 2);
  const from = bridge.toScreen(span.from);
  const to = bridge.toScreen(span.to);
  // Нормаль считается в экранных осях по самому отрезку: поворот подложки
  // поворачивает и её, и выводить её из миллиметров пришлось бы дважды.
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = dy / len;
  const ny = -dx / len;
  const colour = options.active ? DRAWING_ACTIVE : options.bad ? DRAWING_BAD : DRAWING_EDGE;
  ctx.save();
  if (options.ghost) ctx.globalAlpha = 0.65;
  // Дырка: стена в этом месте стирается до бумаги. Подложку под ней тоже —
  // чертёж здесь главнее фотографии.
  ctx.beginPath();
  ctx.moveTo(from.x + nx * half, from.y + ny * half);
  ctx.lineTo(to.x + nx * half, to.y + ny * half);
  ctx.lineTo(to.x - nx * half, to.y - ny * half);
  ctx.lineTo(from.x - nx * half, from.y - ny * half);
  ctx.closePath();
  ctx.fillStyle = DRAWING_PAPER;
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = colour;
  for (const jamb of [from, to]) {
    ctx.beginPath();
    ctx.moveTo(jamb.x + nx * half, jamb.y + ny * half);
    ctx.lineTo(jamb.x - nx * half, jamb.y - ny * half);
    ctx.stroke();
  }
  if (openingFamilyOf(opening.kind) === "window") {
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
    drawDrawingImposts(ctx, opening, from, to, nx * half, ny * half);
  } else if (opening.kind === "arch") {
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
    ctx.setLineDash([]);
  } else if (openingHasLeaf(opening.kind)) {
    drawDrawingDoor(ctx, bridge, wall, opening, colour);
  } else if (openingMotionOf(opening.kind) === "lift") {
    // Роллетные и секционные ворота: полотно стоит **в проёме**, потому что
    // уходит оно вверх — ни на плане, ни на полу от него ничего не меняется.
    // Открытого положения у них нет вовсе, и это названо вслух
    // (`openingHasLeaf` отвечает «нет»): полотно под перемычкой — не та
    // геометрия, которую план показывает.
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
    ctx.lineWidth = 1.5;
    drawDrawingImposts(ctx, opening, from, to, nx * half, ny * half);
  }
  ctx.restore();
}

/**
 * Импосты проёма на плане — короткие засечки поперёк просвета там, где
 * делится остекление.
 *
 * Доли берутся у модели (`openingFaceGrid`), и это та же сетка, по которой
 * проём делится на листе развёртки и в объёме: окно на плане ниткой, на листе
 * тремя секциями и в объёме тремя полями стекла — одно и то же окно.
 *
 * Засечка не ставится, когда секции на экране ближе четырёх точек: на общем
 * виде квартиры полоса засечек слилась бы в серое пятно и соврала бы про
 * толщину линии.
 */
const DRAWING_IMPOST_MIN_PX = 4;

function drawDrawingImposts(ctx, opening, from, to, ox, oy) {
  const grid = openingFaceGrid(opening);
  if (grid.xs.length === 0) return;
  const span = Math.hypot(to.x - from.x, to.y - from.y);
  if (span / (grid.xs.length + 1) < DRAWING_IMPOST_MIN_PX) return;
  ctx.lineWidth = 1;
  for (const part of grid.xs) {
    const x = from.x + (to.x - from.x) * part;
    const y = from.y + (to.y - from.y) * part;
    ctx.beginPath();
    ctx.moveTo(x + ox, y + oy);
    ctx.lineTo(x - ox, y - oy);
    ctx.stroke();
  }
  ctx.lineWidth = 1.5;
}

// Полотно стеклянной двери на плане тоньше рамы не бывает: при мелком масштабе
// 90 мм рамы дают меньше точки, и контур слился бы в ту же линию, что у
// глухого полотна. Три точки — наименьшее, на чём двойная линия ещё двойная.
const DRAWING_GLASS_MIN_PX = 3;

function drawDrawingDoor(ctx, bridge, wall, opening, colour) {
  const glazed = openingGlazed(opening);
  const frame = Math.max(DRAWING_GLASS_MIN_PX, OPENING_GLASS_FRAME_MM * bridge.pxPerMm);
  for (const leaf of drawingDoorLeaves(wall, opening)) {
    if (leaf.motion !== "swing") {
      drawDrawingSlider(ctx, bridge, wall, opening, leaf, colour, glazed, frame);
      continue;
    }
    const hinge = bridge.toScreen(leaf.hinge);
    const closed = bridge.toScreen(leaf.closed);
    const tip = bridge.toScreen(leaf.tip);
    const radius = Math.hypot(tip.x - hinge.x, tip.y - hinge.y);
    if (glazed) {
      drawDrawingGlassLeaf(ctx, hinge, tip, frame, colour);
    } else {
      ctx.lineWidth = 2;
      ctx.strokeStyle = colour;
      ctx.beginPath();
      ctx.moveTo(hinge.x, hinge.y);
      ctx.lineTo(tip.x, tip.y);
      ctx.stroke();
    }
    if (radius > 1) {
      const start = Math.atan2(closed.y - hinge.y, closed.x - hinge.x);
      const end = Math.atan2(tip.y - hinge.y, tip.x - hinge.x);
      // Короткая сторона дуги — та, по которой полотно и ходит: четверть
      // оборота, а не три четверти вокруг косяка.
      let sweep = end - start;
      while (sweep > Math.PI) sweep -= Math.PI * 2;
      while (sweep < -Math.PI) sweep += Math.PI * 2;
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.arc(hinge.x, hinge.y, radius, start, start + sweep, sweep < 0);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }
  // Ручки петли и края створки — в последнем слое (`drawDrawingHandles`): здесь
  // они ложились под буквы углов, а кружок буквы ровно на конце стены и стоит.
}

/**
 * **Полотно, которое едет** (таск 215): сдвижное, гармошка, портальное.
 *
 * Рисуется там, где оно лежит закрытым: вдоль стены, по стороне `swing`, —
 * а не в плоскости проёма, потому что сдвижную дверь на планах рисуют именно
 * накладной полосой: по ней видно, какой кусок стены нельзя занять мебелью и
 * где не встанет выключатель. Стрелка показывает, куда полотно уходит.
 *
 *   **сдвижное** — прямая полоса и стрелка;
 *   **гармошка** — та же полоса, сложенная в четыре звена: число звеньев то
 *     же, что секций у её лица (`openingFoldLinks`), и второго числа для
 *     гармошки в сборке нет: тем же числом она складывается в пакет в объёме
 *     (таск 226);
 *   **портальное** — полоса лежит **в** стене, а за косяком пунктиром показан
 *     карман, куда полотно уезжает целиком: это и есть «слайдинг в стену».
 */
function drawDrawingSlider(ctx, bridge, wall, opening, leaf, colour, glazed, frame) {
  const head = bridge.toScreen(leaf.hinge);
  const tail = bridge.toScreen(leaf.closed);
  const dx = tail.x - head.x;
  const dy = tail.y - head.y;
  const span = Math.hypot(dx, dy) || 1;
  // Поперёк стены: накладное полотно лежит на её стороне, портальное — внутри.
  const thick = Number(wall.thicknessMm) * bridge.pxPerMm;
  const away = leaf.inWall ? 0 : (thick / 2 + Math.max(1.5, thick * 0.1)) * leaf.side;
  const nx = (dy / span) * away;
  const ny = (-dx / span) * away;
  const from = { x: head.x + nx, y: head.y + ny };
  const to = { x: tail.x + nx, y: tail.y + ny };
  ctx.strokeStyle = colour;
  if (leaf.motion === "fold") {
    // Звенья гармошки: ломаная туда-обратно поперёк полосы. Амплитуда — та же
    // мера, на которую полотно отодвинуто от стены, чтобы звенья не наехали на
    // неё и не слились с её линией.
    const parts = openingFoldLinks(opening);
    const amp = Math.max(2, Math.abs(away) || thick / 2);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let index = 0; index <= parts; index += 1) {
      const part = index / parts;
      const x = from.x + (to.x - from.x) * part + (index % 2 === 0 ? 0 : (-dy / span) * amp * leaf.side);
      const y = from.y + (to.y - from.y) * part + (index % 2 === 0 ? 0 : (dx / span) * amp * leaf.side);
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  } else if (glazed) {
    drawDrawingGlassLeaf(ctx, from, to, frame, colour);
  } else {
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
  }
  // Карман портальной двери: прямоугольник в стене за тем косяком, в который
  // уезжает полотно. Пунктиром — он внутри стены, его не видно.
  if (leaf.inWall && span > 2) {
    const ux = -dx / span;
    const uy = -dy / span;
    const px = (dy / span) * (thick / 2);
    const py = (-dx / span) * (thick / 2);
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(head.x + px, head.y + py);
    ctx.lineTo(head.x + px + ux * span, head.y + py + uy * span);
    ctx.lineTo(head.x - px + ux * span, head.y - py + uy * span);
    ctx.lineTo(head.x - px, head.y - py);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  // Стрелка хода: от середины полосы к тому косяку, за который полотно уходит.
  if (span > 12) {
    const tipAt = { x: from.x + (to.x - from.x) * 0.08, y: from.y + (to.y - from.y) * 0.08 };
    const back = { x: from.x + (to.x - from.x) * 0.42, y: from.y + (to.y - from.y) * 0.42 };
    const wing = Math.min(6, span * 0.08);
    const ax = (tipAt.x - back.x) / Math.hypot(tipAt.x - back.x, tipAt.y - back.y || 1);
    const ay = (tipAt.y - back.y) / Math.hypot(tipAt.x - back.x, tipAt.y - back.y || 1);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(back.x, back.y);
    ctx.lineTo(tipAt.x, tipAt.y);
    ctx.moveTo(tipAt.x, tipAt.y);
    ctx.lineTo(tipAt.x - ax * wing + ay * wing * 0.6, tipAt.y - ay * wing - ax * wing * 0.6);
    ctx.moveTo(tipAt.x, tipAt.y);
    ctx.lineTo(tipAt.x - ax * wing - ay * wing * 0.6, tipAt.y - ay * wing + ax * wing * 0.6);
    ctx.stroke();
  }
}

/**
 * Остеклённое полотно: контур рамы от петли до кончика, внутри бумага.
 *
 * Считается в экранных точках по двум концам полотна — тем же, которыми
 * рисуется глухое, — и поэтому поворот подложки достаётся ему даром: своей
 * нормали в миллиметрах здесь не выводится, как не выводит её и сам проём.
 */
function drawDrawingGlassLeaf(ctx, hinge, tip, thickness, colour) {
  const dx = tip.x - hinge.x;
  const dy = tip.y - hinge.y;
  const len = Math.hypot(dx, dy) || 1;
  const half = thickness / 2;
  const nx = (dy / len) * half;
  const ny = (-dx / len) * half;
  // Бумага внутри — это и есть стекло: закрашенное полотно читалось бы глухим.
  ctx.beginPath();
  ctx.moveTo(hinge.x + nx, hinge.y + ny);
  ctx.lineTo(tip.x + nx, tip.y + ny);
  ctx.lineTo(tip.x - nx, tip.y - ny);
  ctx.lineTo(hinge.x - nx, hinge.y - ny);
  ctx.closePath();
  ctx.fillStyle = DRAWING_PAPER;
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = colour;
  ctx.stroke();
}

// Секции проёма ближе этого друг к другу на листе не размечаются: у роллетных
// ворот ламелей две дюжины, и на общем виде стены они слились бы в серое поле,
// соврав про толщину линии. Та же мерка держит и плитку выбора сорока точек.
const OPENING_FACE_MIN_PX = 3;
// Рама стеклянного полотна рисуется, только когда внутри ещё остаётся стекло:
// на мелком масштабе она съела бы полотно целиком, и честнее оставить проём
// обведённым, чем обещать стекло, которого негде нарисовать.
const OPENING_FACE_GLASS_RATIO = 2.5;

/**
 * **Лицо проёма** — один рисунок на развёртку и на плитку выбора (таск 215).
 *
 * Проём, в отличие от вещи чертежа, своей картинки не имеет: изображение ему
 * заменяет это самое лицо — просвет, секции остекления, рама стеклянного
 * полотна, засечка петель и знак хода полотна. Поэтому второго реестра
 * «изображений проёма» в сборке нет: плитка выбора зовёт **эту** функцию, и
 * человек, выбравший балконное окно по картинке, видит на листе ровно её.
 *
 * `face` — запись проёма с развёртки (`wallElevation`) или такая же, собранная
 * по каталогу: `{kind, glazed, motion, leaves, grid, hinge}`. Петли и сторона в
 * ней уже перевёрнуты под сторону взгляда — переворачивать их здесь второй раз
 * нельзя.
 *
 * `options.paper` = `null` снимает бумагу под просветом: на тёмной плитке
 * выбора светлый прямоугольник читался бы заливкой, а не стеклом.
 */
export function drawOpeningFace(ctx, box, face, options = {}) {
  const unit = Number(options.unit) > 0 ? Number(options.unit) : 1;
  const ink = options.ink || DRAWING_EDGE;
  const paper = Object.prototype.hasOwnProperty.call(options, "paper") ? options.paper : DRAWING_PAPER;
  const x = box.x;
  const top = box.y;
  const width = box.width;
  const height = box.height;
  // Точек на миллиметр: нужно раме стеклянного полотна — её ширина названа в
  // миллиметрах и одна на все три поверхности.
  const scale = Number(options.scale) > 0 ? Number(options.scale) : 0;
  if (paper) {
    ctx.fillStyle = paper;
    ctx.fillRect(x, top, width, height);
  }
  ctx.lineWidth = 1.5 * unit;
  ctx.strokeStyle = ink;
  // **Верх дугой** (таск 219, G329): у арки просвет кончается не перемычкой, а
  // полуциркульной дугой — её рисуют и в кирпиче, и из гипсокартона. Контур
  // идёт откосами до пяты и дальше по дуге; бумага под ним осталась залитой на
  // весь прямоугольник, и это не видно: поле стены на листе такое же бумажное,
  // то есть пазухи над дугой — это стена, какой она и есть.
  if (face.arch && drawOpeningArchPath(ctx, box, face.arch)) ctx.stroke();
  else ctx.strokeRect(x, top, width, height);
  // Стеклянная дверь (таск 180): на развёртку она смотрит лицом, и здесь видно
  // ровно то, что просил заказчик, — рама по контуру, стекло в середине. Рама
  // отложена внутрь на свою ширину, а не нарисована двойной линией на глаз:
  // число одно на план, развёртку и объём.
  let hole = { x, y: top, width, height };
  if (face.glazed && scale > 0) {
    const inset = OPENING_GLASS_FRAME_MM * scale;
    if (width > inset * OPENING_FACE_GLASS_RATIO && height > inset * OPENING_FACE_GLASS_RATIO) {
      ctx.lineWidth = 1 * unit;
      ctx.strokeRect(x + inset, top + inset, width - inset * 2, height - inset * 2);
      // Секции делят **стекло**, а не проём: импост у остеклённой двери стоит
      // внутри рамы, и выводить его на коробку значило бы нарисовать рамку
      // крестом поверх самой рамы.
      hole = { x: x + inset, y: top + inset, width: width - inset * 2, height: height - inset * 2 };
    }
  }
  const grid = face.grid || { xs: [], ys: [] };
  drawOpeningFaceGrid(ctx, hole, grid, unit);
  // Засечка петель — наклонная от верхнего косяка к нижнему, как её рисуют на
  // развёртке. У двупольной двери их две, по створке на каждую: петли у неё
  // стоят у обоих косяков, и одна засечка соврала бы про вторую створку.
  if (face.hinge && face.motion === "swing") {
    const leaves = Number(face.leaves) > 1 ? 2 : 1;
    const part = width / leaves;
    for (let index = 0; index < leaves; index += 1) {
      const left = x + part * index;
      // У одностворчатой петли там, где сказано; у двупольной — у своего косяка.
      const atStart = leaves > 1 ? index === 0 : face.hinge === "start";
      const hingeX = atStart ? left : left + part;
      ctx.setLineDash([4 * unit, 3 * unit]);
      ctx.lineWidth = 1 * unit;
      ctx.beginPath();
      ctx.moveTo(hingeX, top);
      ctx.lineTo(atStart ? left + part : left, top + height / 2);
      ctx.lineTo(hingeX, top + height);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }
  if (face.motion && face.motion !== "swing") drawOpeningFaceMotion(ctx, box, face, ink, unit);
}

/**
 * Контур проёма с дугой: откосы до пяты, дальше по окружности.
 *
 * Считается по тем же двум числам, которыми объём режет свод
 * (`model.openingArchGeometry`), и в экранную меру переводится одним
 * множителем: лист, плитка выбора и грань в объёме обязаны показывать одну и ту
 * же дугу. Отдаёт `false`, когда дуге негде встать (вырожденный просвет), —
 * тогда проём обводится прямоугольником, как обводился всегда.
 */
function drawOpeningArchPath(ctx, box, arch) {
  const scale = box.width / (2 * Math.max(1e-6, archHalfMm(arch)));
  const rise = arch.riseMm * scale;
  const radius = arch.radiusMm * scale;
  if (!(rise > 0.5) || !(radius > 0.5) || !(box.height > rise)) return false;
  const middle = box.x + box.width / 2;
  const centre = box.y + radius;
  const start = Math.atan2(box.y + rise - centre, box.x - middle);
  const end = Math.atan2(box.y + rise - centre, box.x + box.width - middle);
  ctx.beginPath();
  ctx.moveTo(box.x, box.y + box.height);
  ctx.lineTo(box.x, box.y + rise);
  ctx.arc(middle, centre, radius, start, end);
  ctx.lineTo(box.x + box.width, box.y + box.height);
  ctx.closePath();
  return true;
}

/**
 * Полуширина проёма, выведенная обратно из дуги: `R = (a² + f²) / 2f`, значит
 * `a = sqrt(2Rf − f²)`. Лицу не передают ширину в миллиметрах — у него есть
 * клетка в точках, — а множитель «точек на миллиметр» нужен только дуге.
 */
function archHalfMm(arch) {
  return Math.sqrt(Math.max(0, 2 * arch.radiusMm * arch.riseMm - arch.riseMm * arch.riseMm));
}

/** Импосты лица: вертикальные по долям ширины, горизонтальные — от низа. */
function drawOpeningFaceGrid(ctx, hole, grid, unit) {
  const xs = Array.isArray(grid.xs) ? grid.xs : [];
  const ys = Array.isArray(grid.ys) ? grid.ys : [];
  const draw = (parts, horizontal) => {
    if (parts.length === 0) return;
    const span = horizontal ? hole.height : hole.width;
    if (span / (parts.length + 1) < OPENING_FACE_MIN_PX * unit) return;
    ctx.lineWidth = 1 * unit;
    for (const part of parts) {
      ctx.beginPath();
      if (horizontal) {
        // Доли отсчитаны **от низа** просвета, а холст растёт вниз.
        const y = hole.y + hole.height * (1 - part);
        ctx.moveTo(hole.x, y);
        ctx.lineTo(hole.x + hole.width, y);
      } else {
        const at = hole.x + hole.width * part;
        ctx.moveTo(at, hole.y);
        ctx.lineTo(at, hole.y + hole.height);
      }
      ctx.stroke();
    }
  };
  draw(xs, false);
  draw(ys, true);
}

/**
 * Знак хода полотна на лице: стрелка. Сдвижное, гармошка и портальное едут
 * вбок — в ту сторону, куда уходят; роллетное и секционное уходят вверх.
 *
 * Стрелка нужна именно здесь: на листе развёртки сдвижная дверь от распашной
 * иначе не отличается ничем (засечки петель у неё нет), а на плитке выбора
 * различать их человеку надо до клика.
 */
function drawOpeningFaceMotion(ctx, box, face, ink, unit) {
  const up = face.motion === "lift";
  const long = Math.min(up ? box.height : box.width, (up ? box.height : box.width) * 0.5);
  if (long < 8 * unit) return;
  const middle = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  // Куда смотрит стрелка: вверх — у поднимающегося полотна, иначе к тому
  // косяку, за который полотно уходит.
  const dir = up ? { x: 0, y: -1 } : { x: face.hinge === "end" ? 1 : -1, y: 0 };
  const tip = { x: middle.x + dir.x * (long / 2), y: middle.y + dir.y * (long / 2) };
  const tail = { x: middle.x - dir.x * (long / 2), y: middle.y - dir.y * (long / 2) };
  const wing = Math.min(6 * unit, long * 0.25);
  ctx.strokeStyle = ink;
  ctx.lineWidth = 1 * unit;
  ctx.beginPath();
  ctx.moveTo(tail.x, tail.y);
  ctx.lineTo(tip.x, tip.y);
  ctx.moveTo(tip.x, tip.y);
  ctx.lineTo(tip.x - dir.x * wing + dir.y * wing * 0.7, tip.y - dir.y * wing + dir.x * wing * 0.7);
  ctx.moveTo(tip.x, tip.y);
  ctx.lineTo(tip.x - dir.x * wing - dir.y * wing * 0.7, tip.y - dir.y * wing - dir.x * wing * 0.7);
  ctx.stroke();
}

/**
 * Вещь чертежа: габарит заливкой, контур и подпись с именем над ним.
 *
 * `options.ghost` — та же вещь **до** постановки (таск 168): заливка, контур и
 * подпись те же самые, контур пунктирный, и всё это вполсилы. Вынесено
 * наружу и зовётся из мастерской потому, что призрак обязан быть нарисован
 * **этим же кодом**: до таска 168 он рисовался своим — голый пунктир без
 * заливки и без имени, зато с числами поперёк самого габарита, — и вещь,
 * вставшая по клику, выглядела иначе, чем обещанная. У радиатора 1200 × 100
 * коробка габарита выходит 90 × 7 точек, а строка чисел поверх неё — 75 × 12:
 * подпись крупнее того, что подписывает, и закрывает его целиком.
 */
export function drawDrawingObject(ctx, bridge, object, options = {}) {
  const colour = options.active ? DRAWING_ACTIVE : DRAWING_OBJECT;
  const corners = schemeObjectCorners(object).map((point) => bridge.toScreen(point));
  if (corners.length < 2) return;
  ctx.save();
  if (options.ghost) ctx.globalAlpha = DRAWING_GHOST_ALPHA;
  if (object.shape === "polyline") {
    ctx.lineCap = "butt";
    ctx.lineJoin = "round";
    ctx.lineWidth = Math.max(2, Number(object.depthMm) * bridge.pxPerMm);
    ctx.strokeStyle = DRAWING_OBJECT_FILL;
    drawDrawingPath(ctx, corners);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = colour;
    if (options.ghost) ctx.setLineDash(DRAWING_GHOST_DASH);
    drawDrawingPath(ctx, corners);
  } else {
    ctx.beginPath();
    corners.forEach((point, index) => (index === 0 ? ctx.moveTo(point.x, point.y) : ctx.lineTo(point.x, point.y)));
    ctx.closePath();
    ctx.fillStyle = DRAWING_OBJECT_FILL;
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = colour;
    if (options.ghost) ctx.setLineDash(DRAWING_GHOST_DASH);
    ctx.stroke();
  }
  // Подпись пунктиром не пишется: штрихом держится только контур.
  ctx.setLineDash([]);
  if (options.stair && object.shape !== "polyline") drawDrawingStair(ctx, bridge, object, options.stair, colour);
  drawDrawingCaption(ctx, object, corners, options.name, bridge);
  ctx.restore();
  // Ручек здесь нет: углы выделенной вещи рисует последний слой чертежа
  // (`drawDrawingHandles`, дефект D45) — вещи лежат под стенами, и ручка вместе
  // с ними уходила под линию стены.
}

/**
 * **Ступени лестницы на плане** (правка 2026-10-27): та же сборка, что в
 * «Объёме» (`objectStairModel`), — ступени по подъёму и отражение. Слова
 * заказчика про отражение были о «Объёме», но на плане лестница оставалась
 * прямоугольником, и с какой стороны у неё низ, видно не было. `null` — вещь
 * не лестница или полоса.
 */
export function drawingStairParts(project, schemeId, object) {
  if (!object || object.shape === "polyline") return null;
  const key = schemeObjectKeyOf(project, object);
  if (!objectStairKey(key)) return null;
  const heightMm = Number(object.heightMm) > 0 ? Number(object.heightMm) : wallHeightShownMm(project, { schemeId }).mm;
  return objectStairModel(key, { widthMm: object.widthMm, depthMm: object.depthMm, heightMm, mirror: object.mirror === true });
}

/** Меньше этого на экране ступени не рисуются: кашу из штрихов не читают. */
const DRAWING_STAIR_MIN_PX = 24;

/**
 * Ступени — тонкими контурами, стрелка подъёма — по серединам ступеней от
 * первой к последней, как на плане этажа. Доли модели переводятся тем же
 * правилом, что тела вещи в «Объёме» (`volumeObjectFrame`): поперёк лица по
 * повороту, вглубь — от лица к заднику.
 */
function drawDrawingStair(ctx, bridge, object, parts, colour) {
  const widthMm = Number(object.widthMm);
  const depthMm = Number(object.depthMm);
  if (!(widthMm > 0) || !(depthMm > 0) || !object.atMm) return;
  if (Math.max(widthMm, depthMm) * bridge.pxPerMm < DRAWING_STAIR_MIN_PX) return;
  const angle = ((Number(object.turnDeg) || 0) * Math.PI) / 180;
  const u = { x: Math.cos(angle), y: Math.sin(angle) };
  const f = { x: Math.sin(angle), y: -Math.cos(angle) };
  const at = (fx, fy) =>
    bridge.toScreen({
      x: Number(object.atMm.x) + u.x * fx * widthMm + f.x * fy * depthMm,
      y: Number(object.atMm.y) + u.y * fx * widthMm + f.y * fy * depthMm,
    });
  const steps = parts.filter((part) => /^step\d+$/.test(part.name));
  const middles = [];
  ctx.save();
  ctx.lineWidth = 0.75;
  ctx.strokeStyle = colour;
  ctx.globalAlpha *= 0.7;
  for (const part of steps) {
    const points =
      part.kind === "plate"
        ? part.points.map(([fx, fy]) => at(fx, fy))
        : [at(part.x, part.y), at(part.x + part.width, part.y), at(part.x + part.width, part.y + part.depth), at(part.x, part.y + part.depth)];
    ctx.beginPath();
    points.forEach((point, index) => (index === 0 ? ctx.moveTo(point.x, point.y) : ctx.lineTo(point.x, point.y)));
    ctx.closePath();
    ctx.stroke();
    middles.push({
      x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
      y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
    });
  }
  if (middles.length >= 2) {
    ctx.lineWidth = 1;
    drawDrawingPath(ctx, middles);
    const tip = middles[middles.length - 1];
    const back = middles[middles.length - 2];
    const length = Math.hypot(tip.x - back.x, tip.y - back.y) || 1;
    const dx = (tip.x - back.x) / length;
    const dy = (tip.y - back.y) / length;
    const size = 6;
    ctx.beginPath();
    ctx.moveTo(tip.x - dx * size - dy * size * 0.6, tip.y - dy * size + dx * size * 0.6);
    ctx.lineTo(tip.x, tip.y);
    ctx.lineTo(tip.x - dx * size + dy * size * 0.6, tip.y - dy * size - dx * size * 0.6);
    ctx.stroke();
  }
  ctx.restore();
}

function drawDrawingPath(ctx, points) {
  ctx.beginPath();
  points.forEach((point, index) => (index === 0 ? ctx.moveTo(point.x, point.y) : ctx.lineTo(point.x, point.y)));
  ctx.stroke();
}

/**
 * Подпись объекта: имя вида и верх над полом.
 *
 * Верх здесь не для красоты. Ради двух видов объекты и заведены (таск 122): от
 * верха **столешницы** отмеряют розетки над кухонным фронтом, а **радиатор**
 * своей высотой говорит, куда розетку ставить нельзя.
 *
 * Показывается она, только когда объекту есть куда её принять: на общем виде
 * квартиры десяток подписей лёг бы поверх меток кашей, а в мастерской, где
 * смотрят на один угол, место есть. Правило одно на обе поверхности — порог в
 * экранных пикселях, а не отметка «тут показывать, а тут нет».
 */
function drawDrawingCaption(ctx, object, corners, name, bridge) {
  if (!name) return;
  const xs = corners.map((point) => point.x);
  const ys = corners.map((point) => point.y);
  const spread = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  const band = object.shape === "polyline" ? Number(object.depthMm) * bridge.pxPerMm : 0;
  if (spread < DRAWING_CAPTION_MIN_PX) return;
  const top = object.shape === "polyline" ? Math.min(...ys) - band / 2 : Math.min(...ys);
  const middle = xs.reduce((sum, value) => sum + value, 0) / xs.length;
  const topMm = schemeObjectTopMm(object);
  const line = topMm === null ? name : name + " · " + text("workshop.objectTop", { top: topMm });
  const at = { x: middle, y: top - 8 };
  ctx.font = drawFont(11, 600);
  ctx.textBaseline = "bottom";
  ctx.textAlign = "center";
  ctx.lineWidth = 3;
  ctx.strokeStyle = DRAWING_PAPER;
  ctx.strokeText(line, at.x, at.y);
  ctx.fillStyle = DRAWING_CAPTION;
  ctx.fillText(line, at.x, at.y);
  ctx.textAlign = "start";
}

// ——— развёртка стены: отрисовка ———————————————————————————————————————
//
// Данные собирает `model.wallElevation`, здесь они только рисуются — и
// рисуются **в любой прямоугольник любого холста**. Разделено это нарочно:
// выгрузка развёртки в PNG и на лист по ГОСТ — следующий шаг, и ей достанется
// тот же вызов с другим `ctx` и другой рамкой, без единой новой строки
// отрисовки (тот же приём, что у чертежа в таске 127).

// Поля рамки: слева — размер высоты, снизу — размер длины, под полом — полоса
// для меток, у которых высота не задана.
// Поля рамки: слева — размер высоты, снизу — размер длины, под полом — полоса
// для меток, у которых высота не задана.
//
// Числа здесь — **единицы**, не пиксели: на экране единица равна точке (тогда
// развёртка выглядит так же, как её нарисовал таск 129), на бумаге —
// `ELEVATION_UNIT_MM` миллиметра. Множитель приходит доводом `unit`, и второй
// отрисовки для листа по ГОСТ не заводится (таск 130).
const ELEVATION_PAD = { left: 56, right: 18, top: 20, bottom: 42 };
const ELEVATION_UNKNOWN_BAND = 22;
const ELEVATION_FONT = 11;
// Мельче этого подпись на развёртке не читается — тогда её просто нет.
const ELEVATION_LABEL_MIN_PX = 26;

// Из кегля ГОСТ и выводится, сколько миллиметров стоит единица развёртки, —
// одно число на все поля, и пропорции экранной развёртки переносятся на лист
// целиком.
export const ELEVATION_UNIT_MM = GOST_TEXT_MM / ELEVATION_FONT;

// Сколько единиц рамки съедают поля: по ширине и по высоте. Этим считает
// раскладку листа `gostSheet.elevationFit` — размеры полей живут здесь, рядом
// с тем, кто их рисует, и второго их описания в сборке нет.
export const ELEVATION_FRAME_UNITS = {
  side: ELEVATION_PAD.left + ELEVATION_PAD.right,
  stack: ELEVATION_PAD.top + ELEVATION_PAD.bottom + ELEVATION_UNKNOWN_BAND,
};

function elevationTick(ctx, x, y, vertical, unit) {
  const arm = 4 * unit;
  ctx.beginPath();
  if (vertical) {
    ctx.moveTo(x - arm, y);
    ctx.lineTo(x + arm, y);
  } else {
    ctx.moveTo(x, y - arm);
    ctx.lineTo(x, y + arm);
  }
  ctx.stroke();
}

// Подпись с подложкой под буквами. Кисть берётся и **возвращается**: без
// `restore` цвет бумаги оставался на холсте, и следующая линия рисовалась им
// же. Так пропадала размерная цепочка под стеной: на цветном листе она была
// бледно-серой, на чёрно-белом исчезала совсем (найдено живым прогоном T130).
function elevationText(ctx, value, x, y, align, unit) {
  ctx.save();
  ctx.textAlign = align || "center";
  ctx.lineWidth = 3 * unit;
  ctx.strokeStyle = DRAWING_PAPER;
  ctx.strokeText(value, x, y);
  ctx.fillStyle = DRAWING_CAPTION;
  ctx.fillText(value, x, y);
  ctx.restore();
}

/**
 * **Нижняя граница масштаба** изображения объекта — в тех же единицах, что
 * остальная развёртка (`unit`: 1 на экране, точек в миллиметре на бумаге).
 *
 * ——— она больше не включена сама (дефект D42, таск 179) ———————————————————
 *
 * Слова заказчика: «На схеме и в объёме корректно всё отображается, а на
 * развёртке розетки и выключатели слишком большие, **рисуй всё в реальном
 * масштабе**». Граница снизу — единственное, что на развёртке мелочь
 * увеличивало, и числа на его объекте такие: полоса во весь экран даёт масштаб
 * по высоте стены (216 точек на 2800 мм = 0.0771), и тринадцать точек
 * оборачиваются **169 миллиметрами**. Розетка 80 мм выходит вдвое крупнее
 * себя, выключатель 80 — тоже, увлажнитель 60 — в 2.8 раза, а бризер 600 и
 * кондиционер 900 стоят как есть. Отсюда и жалоба: рядом с холодильником
 * мелочь растёт, крупное нет, и масштаб на листе перестаёт быть один.
 *
 * Поэтому граница стала **отметкой**, а не правилом: `grow` в
 * `elevationMarkBox` и `options.grow` в `drawElevation`. Умолчание — реальный
 * масштаб, то есть без границы; отметка «Мелкое крупнее» в окне развёртки
 * возвращает прежнее поведение тому, кому важнее узнать вещь, чем померить её.
 * Само число не изменилось: когда граница включена, она ровно та же, что была,
 * и приписка о подтянутых вещах — та же.
 *
 * Дефект D25: «что-то масштаб меток слишком крупный на развёртке». Мелкая вещь
 * рисовалась **постоянным размером** 22 точки независимо от длины стены. На
 * стене восьми метров это выглядело нормально, а на стене 2100 масштаб
 * развёртки крупный, и те же 22 точки оборачивались третью метра: розетка 80 мм
 * выходила размером 250.
 *
 * Ошибка была в самой постановке: «мельче трёхсот миллиметров — рисуем
 * постоянным размером». Правильная — **граница снизу**: рисуем в масштабе, но
 * не мельче того, на чём вещь ещё узнаётся. Тогда развилки «крупное или
 * мелкое» не нужно вовсе, и прежней `ELEVATION_SCALE_MM` больше нет: одно
 * правило вместо двух.
 *
 * Тринадцать точек выбраны глазами, не арифметикой. Двадцать два — явно много
 * (на короткой стене розетка в полтора подрозетника шириной), десять —
 * контур розетки сливается в кружок с чёрточками. На тринадцати два отверстия
 * розетки ещё различимы, а на стене 2100 розетка выходит почти в масштабе:
 * восемьдесят миллиметров дают там около девяти точек, то есть подтягивать
 * приходится в полтора раза, а не в три.
 */
export const ELEVATION_VIEW_MIN_PX = 13;

/**
 * Насколько подтянутой вещь может быть **молча**.
 *
 * Подпись говорит, что мелочь нарисована крупнее своего масштаба, — иначе по
 * картинке начнут мерить. Но подтяжка на сотую долю не меняет ни картинки, ни
 * выводов по ней, а подпись, которая горит всегда, учит себя не читать:
 * на полосе во весь экран розетка выходит в 12.5 точек при минимуме 13, и
 * кричать об этих четырёх процентах значит обесценить то же слово там, где
 * вещь нарисована втрое крупнее.
 *
 * Десятая доля — та граница, за которой разница видна глазом на самой
 * картинке. Это мера **разговора**, а не рисования: на размер нарисованного
 * она не влияет никак.
 */
export const ELEVATION_GROWN_QUIET = 1.1;

/**
 * Прямоугольник метки на развёртке и изображение, которым её рисовать.
 *
 * Правило одно: **каждая сторона — своя в масштабе, но не меньше минимума**.
 * Крупная вещь целиком своя (кондиционер 900 × 300 на любой стене), мелкая
 * подтягивается до читаемой, а вещь между ними едет по масштабу без всякой
 * развилки.
 *
 * Стороны подтягиваются **врозь**, и это не небрежность: вертикальная лента
 * 40 × 600 с сохранением пропорции выросла бы до двух метров высотой, лишь бы
 * её толщина стала различимой. Врозь каждая сторона либо честна, либо стоит на
 * минимуме, и нарисованной крупнее, чем `max(свой размер, минимум)`, вещь не
 * бывает никогда. Поэтому и прежний зажим пропорции (от половины до двух)
 * больше не нужен: границу держит сам минимум.
 *
 * `scaled` — обе стороны в масштабе, то есть вещь нарисована честно. По нему
 * развёртка считает, о чём предупредить подписью: подтянутая вещь крупнее
 * своего масштаба, и молчать об этом на листе, по которому размечают стену,
 * нельзя.
 *
 * `grow` — включена ли сама нижняя граница (дефект D42). **Умолчание —
 * реальный масштаб**: не попросили — значит вещь нарисована своим размером, и
 * «забыл довод» даёт честную картинку, а не подтянутую. С границей `scaled` и
 * `grown` говорят о ней ровно то же, что говорили всегда; без границы вещь
 * всегда в масштабе, и говорить не о чем.
 *
 * Чистая и вынесена наружу: эта развилка — то самое место, где легче всего
 * соврать о размере, и проверяется она без холста.
 */
export function elevationMarkBox(mark, scale, unit, views, grow = false) {
  const view = views ? elevationViewOf(mark) : null;
  // Без изображения рисуется условный знак, и размер у него свой, постоянный:
  // знак не изображает вещь и масштаба не обещает.
  if (!view) {
    const side = 18 * unit;
    // Догадкой знак не считается, и это та же мысль, что у `scaled`: знак не
    // изображает вещь и размера не обещает, значит и предупреждать о выдуманной
    // стороне не о чем. Снял человек отметку «изображения» — на листе остались
    // одни знаки, и о габаритах лист не говорит вовсе.
    return { view: null, width: side, height: side, scaled: false, grown: 1, guessed: false };
  }
  const size = mark.sizeMm || {};
  // Габарит вещи — один ответ на обе поверхности (G226, `markBox.js`): каждая
  // сторона своя, недостающая берётся у изображения объекта. Правило то же,
  // что было здесь, но теперь его же спрашивает и объём — и расходиться им
  // больше негде.
  const box = markBoxMm({ lengthMm: size.width, widthMm: size.height }, view);
  // Нулевой минимум — это и есть реальный масштаб (D42): ни одна ветка ниже не
  // знает о развилке, и второго способа нарисовать вещь не появляется.
  const min = grow === true ? ELEVATION_VIEW_MIN_PX * unit : 0;
  const atScale = { width: box.lengthMm * scale, height: box.widthMm * scale };
  return {
    view,
    width: Math.max(min, atScale.width),
    height: Math.max(min, atScale.height),
    scaled: atScale.width >= min && atScale.height >= min,
    // Во сколько раз нарисованное крупнее настоящего масштаба. Единица —
    // честно; по этому числу подпись и решает, есть ли о чём говорить.
    grown: Math.max(1, min / Math.max(1e-9, Math.min(atScale.width, atScale.height))),
    // Хоть одна сторона габарита — догадка общего правила (G226). Развёртка об
    // этом говорит так же, как объём (G230), и считает то же самое: второго
    // счёта нет, здесь просто проброшен ответ `markBoxMm`.
    guessed: box.guessed,
  };
}

/** Значок метки: имя у типа старше формы знака (см. `icons/registry.js`). */
export function elevationViewOf(mark) {
  return objectViewByName(mark.view) || objectViewForShape(mark.shape);
}

/**
 * Точечные метки развёртки — **рядами**: группа идёт одним рядом, одиночка
 * сама себе ряд (таск 135, требования G190 и G191).
 *
 * G190 («на развёртке сразу указывать рядом, как и в жизни подрозетники»):
 * метки одной группы стоят на стене вплотную друг к другу, как подрозетники в
 * рамке. **Вплотную — это про просветы внутри группы, а не про место самой
 * группы** (дефект D27: «метки по горизонтали должны быть ровно в том месте,
 * как и на схеме, сейчас могут разъезжаться»). До этого таска ряд целиком
 * вставал серединой в середину группы и раскладывался вплотную от края — и
 * метка, нарисованная на плане в двадцати сантиметрах от соседки, на развёртке
 * оказывалась в восьми. Теперь каждая метка стоит на **своём** отступе, а
 * вплотную расходятся только те, что налезли бы друг на друга
 * (`elevationPack`): на плане промахнулись мышью на сантиметр — рамка всё
 * равно рамка, нарисовали розетки врозь — они и на стене врозь.
 *
 * `axis` — чем группа различается на плане, тем и строится на стене:
 *
 * - `"row"` — метки разошлись **вдоль стены** (обычный блок подрозетников):
 *   ряд по горизонтали, одна отметка высоты на всех (G191);
 * - `"column"` — метки стоят на одном месте стены, а различаются **высотой**
 *   (G203: «вертикальные и горизонтальные группы должны поддерживаться»).
 *   Столбик по вертикали, и подписана высота у каждой метки: разные высоты —
 *   это и есть то, ради чего столбик собрали.
 *
 * Отличаются они не полем и не настройкой, а самим расположением меток: что
 * разошлось сильнее — отступ вдоль стены или высота над полом. Выбор по
 * расположению тем и хорош, что человек ничего не объявляет: поставил
 * подрозетники в рамку — ряд, поставил столбиком — столбик.
 *
 * G191 («одну высоту указывать у группы по нижнему объекту»): у ряда высота
 * одна, по нижнему. Заказчик снял вопрос о разной высоте внутри ряда: «2 блока
 * розеток мы в одну группу не собираем, это всегда 2 группы разных».
 *
 * Чистая и вынесена наружу: без холста проверяется и порядок, и высота, и ось.
 */
export function elevationRows(marks) {
  const rows = [];
  const byGroup = new Map();
  for (const mark of marks) {
    const key = mark.groupId || null;
    if (!key) {
      rows.push({ members: [mark] });
      continue;
    }
    if (!byGroup.has(key)) {
      const row = { members: [] };
      byGroup.set(key, row);
      rows.push(row);
    }
    byGroup.get(key).members.push(mark);
  }
  return rows.map((row) => {
    const heights = row.members.map((mark) => mark.heightMm).filter((value) => value !== null);
    const spread = (values) => (values.length > 1 ? Math.max(...values) - Math.min(...values) : 0);
    // Столбик — когда высоты разошлись сильнее, чем отступы. Равенство (в том
    // числе у одиночки, где оба нуля) — ряд: ряд умолчание, столбик случай.
    const column = spread(heights) > spread(row.members.map((mark) => mark.fromMm));
    // Порядок в ряду — по его собственной оси: ряд читается вдоль стены,
    // столбик — снизу вверх, как его и размечают. Метки без высоты в столбик
    // не попадают (они стоят полосой под полом), но порядок у них всё равно
    // устойчивый: сортировка стабильна.
    const members = [...row.members].sort((first, second) =>
      column ? (first.heightMm || 0) - (second.heightMm || 0) : first.fromMm - second.fromMm,
    );
    const centreMm = members.reduce((sum, mark) => sum + mark.fromMm, 0) / members.length;
    const label = members.length > 1 && members[0].groupLabel ? members[0].groupLabel : members[0].label;
    return {
      members,
      centreMm,
      label,
      axis: column ? "column" : "row",
      heightMm: heights.length > 0 ? Math.min(...heights) : null,
    };
  });
}

/**
 * Разложить ряд по одной оси: каждая метка на **своём** месте, а те, что
 * налезли бы друг на друга, — вплотную (дефект D27).
 *
 * `places` — места в порядке возрастания, `sizes` — размеры вдоль той же оси,
 * обе величины в одних единицах. Отвечает новыми местами.
 *
 * Два правила, и второе важнее первого:
 *
 *   1. соседи расходятся **ровно настолько, чтобы коснуться краями** — не
 *      больше; просветы, которые и так были, остаются как есть;
 *   2. **середина ряда не двигается**: что раздвинули, то поровну и сдвинули
 *      обратно. Иначе рамка из трёх розеток, раздвинутая вправо, уехала бы
 *      с того места, где её нарисовали на плане.
 *
 * Из первого правила следует главное: ряд, нарисованный врозь, функция не
 * трогает вовсе — отступ на развёртке совпадает с планом **числом**, а не
 * примерно. Вплотную встаёт только то, что иначе налезло бы.
 */
export function elevationPack(places, sizes) {
  const next = places.slice();
  for (let index = 1; index < next.length; index += 1) {
    const touch = next[index - 1] + (sizes[index - 1] + sizes[index]) / 2;
    if (next[index] < touch) next[index] = touch;
  }
  if (next.length < 2) return next;
  const middle = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;
  const shift = middle(places) - middle(next);
  return shift === 0 ? next : next.map((value) => value + shift);
}

/**
 * Нарисовать развёртку в заданный прямоугольник.
 *
 * Возвращает геометрию поля (`{x, y, width, height, scale}`) — по ней
 * вызывающий попадает мышью в то, что нарисовано, и по ней же выгрузка
 * проверяет, что обещанный масштаб настоящий, — и `grown`: сколько вещей
 * пришлось подтянуть до читаемого размера (дефект D25). Знает это только
 * отрисовка: подтянута вещь или нет, зависит от масштаба, а масштаб
 * известен здесь.
 *
 * `options.unit` — величина единицы полей и шрифта в точках холста: `1` на
 * экране, «точек в миллиметре × `ELEVATION_UNIT_MM`» на бумаге.
 * `options.scale` — **заданный** масштаб (точек холста на миллиметр объекта).
 * Без него развёртка вписывается в рамку сама; с ним она рисуется ровно тем
 * масштабом, который лист обещал в штампе: на одном листе их несколько, а
 * графа «Масштаб» у листа одна (G169).
 * `options.label` — подпись над чертежом. На экране её не надо (над полосой
 * стоит заголовок строкой), а на листе из нескольких развёрток она и есть
 * порядок обхода: без номера ряд чертежей читается как россыпь.
 * `options.grow` — включить нижнюю границу масштаба мелких вещей
 * (`ELEVATION_VIEW_MIN_PX`). **Умолчание — реальный масштаб** (дефект D42):
 * забытый довод рисует честно, а не крупнее. Отметка идёт от человека и из
 * окна развёртки, и в выгрузку она уходит тем же путём, что «изображения».
 *
 * Возвращает поле стены, выбранный масштаб и две новости о том, чем вещи
 * нарисованы: `grown` — сколько подтянуто до читаемого размера (дефект D25),
 * `spare` — какие нарисованы запасным габаритом (G230). Обе знает только
 * отрисовка: первая зависит от масштаба, который она подбирает сама, вторая —
 * от отметки «изображения», и считать их по данным заново значило бы завести
 * второй счёт.
 */
export function drawElevation(ctx, elevation, box, options = {}) {
  if (!elevation) return null;
  const unit = options.unit > 0 ? options.unit : 1;
  const band = ELEVATION_UNKNOWN_BAND * unit;
  const inner = {
    x: box.x + ELEVATION_PAD.left * unit,
    y: box.y + ELEVATION_PAD.top * unit,
    width: Math.max(1, box.width - (ELEVATION_PAD.left + ELEVATION_PAD.right) * unit),
    height: Math.max(1, box.height - (ELEVATION_PAD.top + ELEVATION_PAD.bottom) * unit - band),
  };
  const scale =
    options.scale > 0
      ? options.scale
      : Math.min(inner.width / Math.max(1, elevation.lengthMm), inner.height / Math.max(1, elevation.heightShownMm));
  const wallWidth = elevation.lengthMm * scale;
  const wallHeight = elevation.heightShownMm * scale;
  // Стена прижата к низу поля: пол — это пол, и смотреть на него снизу вверх
  // привычнее, чем искать его где-то посередине. По ширине, наоборот, она
  // стоит по середине: короткая стена, прижатая влево, читается обрезанной.
  const left = inner.x + Math.max(0, (inner.width - wallWidth) / 2);
  const floor = inner.y + inner.height;
  const atX = (mm) => left + mm * scale;
  const atY = (mm) => floor - mm * scale;
  // Чем тонкой полоске не стать: узкий проём или плинтус обязан остаться
  // видимым, и на бумаге эта мера тоже измеряется единицами, а не точками.
  const thin = 2 * unit;

  // Метки разбираются **до рисования**, а не по дороге: подпись над чертежом
  // говорит, сколько вещей пришлось подтянуть до читаемого размера (дефект
  // D25), а стоит она в самом верху — считать это после было бы поздно.
  const unknown = [];
  const points = [];
  const lines = [];
  for (const mark of elevation.marks) {
    if (mark.heightMm === null) unknown.push(mark);
    else if (mark.kind === "line" && mark.toMm !== null) lines.push(mark);
    else points.push(mark);
  }
  // Точечные метки идут **рядами**: группа — один ряд (таск 135, G190 и
  // G191). См. `elevationRows`.
  const rows = elevationRows(points).map((row) => ({
    ...row,
    boxes: row.members.map((mark) =>
      elevationMarkBox(mark, scale, unit, options.views === true, options.grow === true),
    ),
  }));
  // Знак без изображения не считается подтянутым: он и не обещал масштаба.
  // Подтяжка меньше десятой доли — молча (см. `ELEVATION_GROWN_QUIET`).
  const grown = rows.reduce(
    (sum, row) => sum + row.boxes.filter((box) => box.view && box.grown > ELEVATION_GROWN_QUIET).length,
    0,
  );
  // Вещи с додуманной стороной (G230): список тот же, что у объёма, и считает
  // его то же правило (`markBoxMm` через `elevationMarkBox`). Собирается здесь
  // по той же причине, что `grown`: кто чем нарисован, знает только отрисовка —
  // отметка «изображения» снята, и говорить не о чем вовсе.
  const spare = [];
  for (const row of rows) {
    row.members.forEach((mark, index) => {
      const box = row.boxes[index];
      if (box.view && box.guessed) spare.push({ markId: mark.id, label: mark.label });
    });
  }

  ctx.save();
  ctx.font = drawFont(ELEVATION_FONT * unit, 600);
  ctx.textBaseline = "middle";

  // Подпись — в верхнем поле рамки и по левому краю поля, а не над самой
  // стеной: короткая стена стоит по середине, и подписи ряда разъехались бы.
  if (options.label) {
    // Приписка о подтянутых вещах едет **с подписью**, а не только в полосу на
    // экране: размечают стену по листу, и на листе графа «Масштаб» одна, а
    // мелочь на нём крупнее своего масштаба (дефект D25).
    const said = grown > 0 ? options.label + " · " + text("elevationSheet.grown", { count: grown }) : options.label;
    const captionY = box.y + (ELEVATION_PAD.top / 2) * unit;
    elevationText(ctx, said, inner.x, captionY, "left", unit);
    // Додуманная сторона — **на том же листе** и теми же словами, что в объёме
    // (`markSpare.js`, G230). Молчать на листе нельзя ровно по той причине, по
    // которой на нём стоит приписка о подтянутых вещах (дефект D25): по листу
    // размечают стену, графа «Масштаб» у него одна, а у этих вещей сторона не
    // измерена, а взята у картинки. Догадка хуже подтяжки: подтянутую вещь
    // можно померить по справочнику, а у этой мерить нечего.
    //
    // Хвост с объяснением остаётся экрану: подпись над чертежом — строка, а не
    // абзац, и целый абзац по ширине листа не ляжет. Поэтому здесь голова, и
    // стоит она **у правого края** поля, навстречу подписи, а не за ней: имя
    // стены слева, догадка справа — так они не упираются друг в друга даже на
    // узком формате.
    const spareSaid = markSpareLine(spare);
    if (spareSaid) {
      elevationText(ctx, spareSaid, inner.x + inner.width, captionY, "right", unit);
    }
  }

  // Поле стены.
  ctx.fillStyle = DRAWING_PAPER;
  ctx.fillRect(left, floor - wallHeight, wallWidth, wallHeight);
  ctx.lineWidth = 1.5 * unit;
  ctx.strokeStyle = DRAWING_WALL;
  ctx.strokeRect(left, floor - wallHeight, wallWidth, wallHeight);

  // Упирающиеся стены — торцом от пола до потолка (G201). Идут **первыми**, под
  // всем остальным: торец говорит «здесь угол», а не заменяет собой метки, и
  // загородить розетку возле угла он не имеет права. Заливка слабая нарочно —
  // в чёрно-белом листе `mono` снимает её как подкраску и оставляет контур
  // тушью, то есть на бумаге торец читается рамкой, а не чёрным пятном.
  for (const cross of elevation.crossings || []) {
    const x = atX(cross.fromMm);
    const width = Math.max(thin, (cross.toMm - cross.fromMm) * scale);
    ctx.fillStyle = DRAWING_WALL_FILL;
    ctx.fillRect(x, floor - wallHeight, width, wallHeight);
    ctx.lineWidth = 1.2 * unit;
    ctx.strokeStyle = DRAWING_WALL;
    ctx.strokeRect(x, floor - wallHeight, width, wallHeight);
    // Имя — под потолком: там, где у стены пусто, и на целую строку ниже
    // верхней грани, чтобы подложка подписи не выедала её линию (видно только
    // на снимке живого прогона). Подпись шире торца, и это нарочно:
    // перегородка в сто миллиметров на листе уже трёх букв, а безымянный торец
    // не отвечает на «какая именно это стена».
    if (cross.name) {
      elevationText(ctx, cross.name, x + width / 2, floor - wallHeight + 13 * unit, "center", unit);
    }
  }

  // Объекты на полу — под всем остальным: розетка над столешницей обязана
  // остаться видной поверх неё.
  for (const object of elevation.objects) {
    const top = object.topMm === null ? elevation.heightShownMm : object.topMm;
    const y = atY(top);
    const height = Math.max(thin, (top - object.floorMm) * scale);
    ctx.fillStyle = DRAWING_OBJECT_FILL;
    ctx.fillRect(atX(object.fromMm), y, Math.max(thin, (object.toMm - object.fromMm) * scale), height);
    ctx.lineWidth = 1.2 * unit;
    ctx.strokeStyle = DRAWING_OBJECT;
    ctx.strokeRect(atX(object.fromMm), y, Math.max(thin, (object.toMm - object.fromMm) * scale), height);
    if ((object.toMm - object.fromMm) * scale < ELEVATION_LABEL_MIN_PX * unit) continue;
    elevationText(ctx, object.name, (atX(object.fromMm) + atX(object.toMm)) / 2, y - 8 * unit, "center", unit);
    if (object.topMm !== null) {
      elevationText(ctx, String(object.topMm), atX(object.toMm) + 2 * unit, y + 9 * unit, "left", unit);
    }
  }

  // Проёмы: дырка в стене с косяками, а внутри — лицо вида (таск 215): секции
  // остекления, рама стеклянного полотна, засечка петель, знак хода полотна.
  // Рисует его один `drawOpeningFace` — тот же, которым нарисована плитка
  // выбора: человек выбирает проём по картинке и обязан увидеть на листе её же.
  for (const opening of elevation.openings) {
    const x = atX(opening.fromMm);
    const width = Math.max(thin, (opening.toMm - opening.fromMm) * scale);
    const top = atY(opening.topMm);
    const height = Math.max(thin, (opening.topMm - opening.floorMm) * scale);
    drawOpeningFace(ctx, { x, y: top, width, height }, opening, { unit, scale });
    if (width < ELEVATION_LABEL_MIN_PX * unit) continue;
    // Низ и верх проёма — числами у его косяка: именно от них отмеряют.
    elevationText(ctx, String(opening.topMm), x + width / 2, top - 8 * unit, "center", unit);
    if (opening.floorMm > 0) {
      elevationText(ctx, String(opening.floorMm), x + width / 2, top + height + 9 * unit, "center", unit);
    }
  }

  // Метки: знак или изображение на своём месте и высоте, подпись рядом.
  // Линия — отрезком.
  for (const mark of lines) {
    const y = atY(mark.heightMm);
    ctx.strokeStyle = mark.color;
    ctx.fillStyle = mark.color;
    ctx.lineWidth = 2.5 * unit;
    ctx.beginPath();
    ctx.moveTo(atX(mark.fromMm), y);
    ctx.lineTo(atX(mark.toMm), y);
    ctx.stroke();
    elevationText(
      ctx,
      mark.label + " · " + mark.heightMm,
      (atX(mark.fromMm) + atX(mark.toMm)) / 2,
      y - 9 * unit,
      "center",
      unit,
    );
  }

  // Знак метки или её изображение в прямоугольнике с серединой в `(x, y)`.
  const drawRowMark = (mark, box, x, y) => {
    if (box.view) {
      drawObjectView(ctx, box.view, { x: x - box.width / 2, y: y - box.height / 2, width: box.width, height: box.height }, mark.color);
    } else {
      drawShape(ctx, mark.shape, x, y, 9 * unit, mark.color);
    }
  };

  for (const row of rows) {
    const boxes = row.boxes;
    // **Столбик** (G203): метки стоят на одном месте стены и различаются
    // высотой. Расходятся они по вертикали — и подписана высота у каждой: ради
    // разных высот столбик и собирают.
    if (row.axis === "column") {
      const places = elevationPack(
        row.members.map((mark) => mark.heightMm * scale),
        boxes.map((box) => box.height),
      );
      row.members.forEach((mark, index) => {
        const box = boxes[index];
        const x = atX(mark.fromMm);
        const y = floor - places[index];
        drawRowMark(mark, box, x, y);
        elevationText(ctx, mark.label + " · " + mark.heightMm, x + box.width / 2 + 4 * unit, y, "left", unit);
      });
      continue;
    }
    // **Ряд**: каждая метка на своём отступе вдоль стены, вплотную расходятся
    // только налезающие (дефект D27). Считается в точках холста относительно
    // левого края стены — там же, где живут размеры знаков.
    const places = elevationPack(
      row.members.map((mark) => mark.fromMm * scale),
      boxes.map((box) => box.width),
    );
    let top = Infinity;
    row.members.forEach((mark, index) => {
      const box = boxes[index];
      const y = atY(mark.heightMm);
      drawRowMark(mark, box, left + places[index], y);
      top = Math.min(top, y - box.height / 2);
    });
    // Одна отметка высоты на ряд, по нижнему объекту (G191): «2 блока розеток
    // мы в одну группу не собираем, это всегда 2 группы разных», — значит у
    // ряда высота и правда одна, и повторять её у каждого подрозетника незачем.
    // Стоит она над серединой группы — той, что на плане: `elevationPack`
    // середину ряда не двигает.
    elevationText(ctx, row.label + " · " + row.heightMm, atX(row.centreMm), top - 7 * unit, "center", unit);
  }

  // Метки без высоты — полосой под полом: на стене им места нет, но и
  // потерять их нельзя. Выдуманная высота соврала бы развёртке.
  if (unknown.length > 0) {
    const y = floor + band / 2 + 4 * unit;
    ctx.setLineDash([3 * unit, 3 * unit]);
    ctx.lineWidth = 1 * unit;
    ctx.strokeStyle = DRAWING_CAPTION;
    ctx.beginPath();
    ctx.moveTo(left, floor + 3 * unit);
    ctx.lineTo(left + wallWidth, floor + 3 * unit);
    ctx.stroke();
    ctx.setLineDash([]);
    for (const mark of unknown) {
      drawShape(ctx, mark.shape, atX(mark.fromMm), y, 7 * unit, mark.color);
      elevationText(ctx, mark.label, atX(mark.fromMm) + 11 * unit, y, "left", unit);
    }
  }

  // Пол толще стен: он опора всему, что на развёртке стоит.
  ctx.lineWidth = 2.5 * unit;
  ctx.strokeStyle = DRAWING_WALL;
  ctx.beginPath();
  ctx.moveTo(left, floor);
  ctx.lineTo(left + wallWidth, floor);
  ctx.stroke();

  // ——— размеры ———
  ctx.lineWidth = 1 * unit;
  ctx.strokeStyle = DRAWING_CAPTION;
  // Высота — слева, одной выносной.
  const heightX = left - 26 * unit;
  ctx.beginPath();
  ctx.moveTo(heightX, floor);
  ctx.lineTo(heightX, floor - wallHeight);
  ctx.stroke();
  elevationTick(ctx, heightX, floor, true, unit);
  elevationTick(ctx, heightX, floor - wallHeight, true, unit);
  elevationText(ctx, String(elevation.heightShownMm), heightX - 4 * unit, floor - wallHeight / 2, "right", unit);
  // Длина — снизу, и по ней же засечки проёмов: по этой цепочке проём и
  // размечают на стене.
  const lengthY = floor + band + 14 * unit;
  ctx.beginPath();
  ctx.moveTo(left, lengthY);
  ctx.lineTo(left + wallWidth, lengthY);
  ctx.stroke();
  elevationTick(ctx, left, lengthY, false, unit);
  elevationTick(ctx, left + wallWidth, lengthY, false, unit);
  elevationText(ctx, String(elevation.lengthMm), left + wallWidth / 2, lengthY + 12 * unit, "center", unit);
  // Буквы углов — на концах этой самой размерной цепочки (G200): длина 4000 и
  // есть расстояние от угла А до угла Б, и подписанные концы отвечают на
  // «какой край листа какой край стены». В поле за цепочкой пусто, а внутри
  // чертежа буква легла бы поверх меток.
  if (elevation.fromLetter) {
    elevationText(ctx, elevation.fromLetter, left - 7 * unit, lengthY, "right", unit);
  }
  if (elevation.toLetter) {
    elevationText(ctx, elevation.toLetter, left + wallWidth + 7 * unit, lengthY, "left", unit);
  }
  for (const opening of elevation.openings) {
    for (const mm of [opening.fromMm, opening.toMm]) {
      elevationTick(ctx, atX(mm), lengthY, false, unit);
      elevationText(ctx, String(mm), atX(mm), lengthY - 10 * unit, "center", unit);
    }
  }
  ctx.restore();
  return { x: left, y: floor - wallHeight, width: wallWidth, height: wallHeight, scale, grown, spare };
}

export function drawScheme(ctx, {
  project,
  scheme,
  image,
  filter,
  view,
  legend,
  selectedIds,
  draft,
  draftColor,
  draftLineStyle,
  guides,
  links,
  outlines,
  selectedOutlineId,
  drawing,
  // Сетка чертежа на плане (таск 193, G293): `{stepMm, box}`. Передаёт её
  // только холст — у выгрузок своих галок видимости сетка не получала, и лист
  // с ней не меняется ни на пиксель (G68). Шаг — из объекта (`gridStepOf`),
  // `box` — размер поля в его собственных точках: сетка идёт от края до края,
  // а не по краю подложки.
  grid,
  // Что из чертежа спрятано с экрана (таск 154, G223). Холст передаёт, выгрузки
  // — нет: у них свои галки видимости, и они не менялись.
  objects,
  hiddenObjectIds,
  selectedWallId,
  // Состояние дома запущенной имитации (таск 08, история 2.11): `Map<markId,
  // Live>` и эффекты кадра. Передаёт только холст; без них кадр прежний.
  live,
  liveFx,
}) {
  const state = renderView(view);
  if (image) {
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(
      image,
      state.offsetX,
      state.offsetY,
      schemeWidthPx(scheme) * state.zoom,
      schemeHeightPx(scheme) * state.zoom,
    );
    ctx.restore();
  }
  if (!project || !scheme) return;
  // Чертёж — слой **под разметкой и над подложкой** (таск 127): он часть
  // плана, а не пометка на нём. Рисуется тем же кодом, что в мастерской, и
  // только когда его попросили: `drawing !== false`. Кадр без чертежа у
  // объекта, которого не чертили, не меняется ни на пиксель — `drawDrawing`
  // выходит на пустых списках, не трогая ни `ctx`, ни единой настройки (G68).
  // Условие `project.walls || project.schemeObjects` — не оптимизация, а то же
  // правило: у объекта, которого не чертили, этих полей нет вовсе, и кадр не
  // спрашивает про калибровку ни разу.
  // Сетка — **под чертежом и над подложкой**: по ней чертят, и перечёркивать
  // ею нарисованные стены незачем. Мост у неё тот же, которым ложится чертёж:
  // нет калибровки или привязки — нет и сетки, потому что миллиметра на этом
  // плане не существует.
  if (grid && grid.stepMm > 0 && grid.box) {
    drawDrawingGrid(ctx, drawingBridge(project, scheme, state), grid.box, grid.stepMm);
  }
  if (drawing !== false && (project.walls || project.schemeObjects)) {
    drawDrawing(ctx, {
      project,
      schemeId: scheme.id,
      bridge: drawingBridge(project, scheme, state),
      objects,
      hiddenObjectIds,
      // Выделенная стена подсвечена и на холсте: её развёртка открыта полосой
      // рядом, и видеть, о какой именно стене речь, обязательно.
      active: selectedWallId ? { kind: "wall", id: selectedWallId } : null,
    });
  }
  // Контуры ложатся под метки: метка на стене комнаты должна остаться видна.
  if (outlines !== false && outlines !== null) {
    drawOutlines(ctx, { project, scheme, filter, view: state, mode: outlines, selectedOutlineId });
  }
  const selected = new Set(selectedIds || []);
  // Стопка совпавших меток (G181): знаки, стоящие на плане в одном месте,
  // расходятся **при отрисовке** — в объекте их точки те же. Спина стопки
  // ложится под знаки: она подсказка о том, что место одно, а не часть знака.
  const shown = visibleMarks(project, scheme, filter);
  const stacks = markStacks(project, scheme, filter, state);
  drawMarkStackSpines(ctx, project, scheme, state, shown, stacks);
  // Ореолы света — под знаками: свет ложится на план, а не поверх соседей.
  if (live) {
    for (const mark of shown) drawMarkLive(ctx, project, scheme, mark, state, live.get(mark.id), liveFx, { stacks, layer: "glow" });
  }
  for (const mark of shown) {
    drawMarkSign(ctx, project, scheme, mark, state, { selected: selected.has(mark.id), stacks });
  }
  if (live) {
    for (const mark of shown) drawMarkLive(ctx, project, scheme, mark, state, live.get(mark.id), liveFx, { stacks, layer: "badge" });
  }
  // Связи — поверх меток и под подписями: обозначение метки читать важнее, чем
  // дугу разбора. `links` — либо готовый кадр (его считает холст из того же
  // промежуточного объекта, что и метки), либо `true`: посчитать самому. Так
  // выгрузка получает связи по отметке в диалоге, ничего не зная про холст.
  if (links) {
    drawMarkLinks(ctx, links === true ? markLinks(project, scheme, filter) : links, scheme, state);
  }
  // Подписи — после меток и в два прохода: сперва поводки у тех, кого развели
  // от соседа, потом сам текст. Иначе поводок ляжет поверх уже нарисованной
  // подписи и перечеркнёт её.
  const layout = labelLayout(project, scheme, filter, state);
  const labels = labelTargets(project, scheme, filter).map((target) => {
    const box = labelBoxIn(project, scheme, target, state, layout, stacks);
    // Цвет подписи — цвет ведущей метки; у смешанного блока это только цвет
    // первого куска и поводка, а буквы каждого куска красятся своим типом.
    const color = styleOf(project, (labelLead(project, target) || {}).typeId).color;
    return {
      box,
      anchor: planToScreen(labelOrigin(project, target, stacks), scheme, state),
      color,
      runs: labelRuns(project, target, color),
      // Поводок: правило раскладки, если метка не сказала иначе. Перебивка
      // лежит в объекте, поэтому одинаково видна на экране, в PNG и в печати.
      leader: labelLeaderShown(project, target, box),
      // Выделение плашки рисуется вместе с ней: точка комментария лежит под
      // подложкой, и обводка вокруг точки из-под неё не видна.
      selected: target.markIds
        ? labelMemberIds(target).some((id) => selected.has(id))
        : selected.has(target.id),
    };
  });
  for (const item of labels) {
    if (item.leader) drawLabelLeader(ctx, item.anchor, item.box, item.color);
  }
  for (const item of labels) drawLabel(ctx, item.box, item.color, item.runs, item.selected);
  if (draft) drawDraft(ctx, scheme, draft, state, draftColor || "#0969da", draftLineStyle);
  // Направляющие без черновика: вершину правят той же рукой, что рисуют, и
  // подсказки при этом те же. Черновика в этот момент нет, а пунктир нужен.
  if (guides && !draft) drawDraftGuides(ctx, scheme, guides, state, draftColor || "#0969da");
  if (legend) drawLegend(ctx, { project, scheme, filter, view: state, box: legend === true ? null : legend });
}

// Дверь для тестов — не для панелей: за ней внутренности drawScheme, которые
// снаружи вызывать незачем, но проверить нужно (геометрия, видимость, запас
// попадания). Панели и экспорт берут только именованные экспорты выше.
export const renderInternals = {
  renderView,
  shapeGeometry,
  MARK_STACK_REACH_RATIO,
  MARK_STACK_STEP_RATIO,
  outlineCenter,
  outlineTint,
  outlineLabelBox,
  shapeInternals,
  labelFontSize,
  labelTargets,
  labelOrigin,
  markVisible,
  handlePositions,
  drawDraft,
  HIT_SLACK_PX,
  LABEL_CHAR_RATIO,
  LABEL_GAP,
  HANDLE_GAP,
};
