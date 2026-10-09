// Правила объекта: справочники, метки, группы, нумерация.
// Чистый модуль: ни DOM, ни хранилища. Все функции возвращают новый объект,
// исходный не меняется.
import { strings, text } from "./strings.js";

// Версия формата объекта. Поднимается, когда в project.json появляются поля,
// без которых работа теряется. История:
//   1 — схемы, метки, блоки, группы, помещения списком;
//   2 — контуры помещений (`project.outlines`), признак ручной правки
//       помещения у метки (`mark.roomManual`) и цвет помещения (`room.color`).
//   3 — вид типа (`type.kind`: точка или линия) и отметка выведенного вида
//       (`type.kindGuessed`), по которой показывается список на правку.
//   4 — канал связи: запись в `mark.controls` бывает и объектом
//       `{id, channel}`, и число каналов у типа (`type.channels`).
// Совместимости вперёд нет сознательно: страница версии 1 не знает о контурах
// и, открыв такой файл, молча потеряла бы их вместе с ручной правкой —
// поэтому она честно откажется («файл сделан более новой версией»). Со
// страницей версии 2 та же история: вид типа она не знает, показывает у
// линейного типа выбор фигуры и ставит его метки точками. Со страницей версии
// 3 — третья: связь с каналом она прочитать не умеет, и на её плане такая
// связь превратилась бы в потерянную.
// Назад совместимость обязательна: файл версии 1 читается и дополняется
// умолчаниями в `projectFile.migrateProject`, метка без `roomManual`
// считается правленной руками (`markRoomManual`), а вид типа выводится по его
// меткам (`migrateTypeKinds`), а тип без `channels` — одноканальным
// (`typeChannels`). Связь строкой и связь объектом с каналом законны обе —
// старая запись не переписывается (`markControlLinks`).
export const FORMAT_VERSION = 4;

// Условные обозначения, которые предлагает сетка выбора. Их различают на
// чёрно-белой распечатке в размере метки, поэтому семейства разведены контуром,
// а внутри семейства — засечкой: перекрестье, точка, сплошная заливка.
// Порядок — порядок сетки. Различимость проверяет test/shapes.test.js:
// фигура, которая сливается с соседкой в размере метки, красит его.
export const SHAPE_PALETTE = [
  // Порядок — порядок сетки выбора, и держится он семьями: сперва все круглые
  // знаки, потом квадратные и так далее. В размере метки знак узнают по
  // силуэту, и рядом стоящая родня даёт выбрать нужную засечку, а не искать её
  // по всей сетке.
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
  "circle-ring",
  // Евророзетка: круг с двумя отверстиями под контакты. Следом трёхфазная — три
  // отверстия по кругу: перепутать их на плане нельзя.
  "circle-socket",
  "circle-triple",
  // Оборудование: молния — силовой вывод, антенна — телевизионная розетка,
  // бабочка — запорный кран, стрелка вниз — сток, термометр — тепло, три луча —
  // вентилятор, подвес — люстра, черта — база на полу.
  "circle-bolt",
  "circle-antenna",
  "circle-valve",
  "circle-drain",
  "circle-thermo",
  "circle-fan",
  "circle-rays",
  "circle-bar",
  "square",
  // Клавиши выключателя: квадрат, квадрат с чертой, квадрат с двумя чертами —
  // одна, две и три клавиши, как они выглядят на стене. Следом переключатель:
  // проходной выключатель стоит в том же ряду, что и обычные, и квадрат держит
  // ряд — круг выпадал бы из него формой.
  "square-bar",
  "square-bar-two",
  "square-chevron",
  "square-cross",
  "square-fill",
  "square-jack",
  "square-bolt",
  "square-split",
  "square-hatch",
  "square-wave",
  // Кольцо в корпусе — объектив камеры, четыре точки — кнопочная панель.
  "square-ring",
  "square-grid",
  "triangle",
  "triangle-dot",
  "triangle-down",
  "triangle-down-fill",
  "diamond",
  "diamond-dot",
  "diamond-cross",
  "diamond-ring",
  "star",
  "plus",
  // Узкий прямоугольник стоймя: кусок чего-то длинного, поставленный
  // вертикально. Своё семейство контура — ни с круглыми, ни с квадратными
  // знаками он не спорит даже без засечки внутри. Лёжа — настенный блок:
  // кондиционер, корпус техники; засечки поперёк корпуса делают его решёткой.
  "rect-vertical",
  "rect-vertical-ticks",
  "rect-horizontal",
  "rect-horizontal-ticks",
  // Трапеция раструбом вниз: зонт вытяжки, луч проектора, поддон осушителя.
  "trapezoid",
  "trapezoid-dot",
  "trapezoid-bar",
  // Капля: вода. Пустая, с точкой — подвод.
  "drop",
  "drop-dot",
  // Полукруг: настенный светильник, потолочный датчик.
  "dome",
  "dome-dot",
];

// Начертание линейной метки. Сплошная и пунктирная значат разное, поэтому
// начертание — часть условного обозначения и живёт там же, где форма:
// у категории, с перебивкой у типа. Третьего правила в сборке нет.
//
// Выбирают начертание по изображению — сеткой нарисованных отрезков, как
// фигуру. Поэтому список держит не число вариантов, а различимость: каждая
// пара обязана разойтись на чёрно-белой распечатке в толщине линии метки,
// и это проверяет отпечаток в `test/lineStyle.test.js` — тем же приёмом, каким
// `test/shapes.test.js` разводит фигуры. Порядок — порядок сетки: сперва
// штриховые (их различает длина штриха), потом двойная, потом волнистые.
export const LINE_STYLES = [
  "solid",
  "dashed",
  "long-dash",
  "dotted",
  "dash-dot",
  "dash-dot-dot",
  "double",
  "wave",
  "zigzag",
  "meander",
  // Жирная стоит последней: она не рисунок узора, а толщина, и в сетке её
  // место — рядом со сплошной по смыслу, но в конце по новизне.
  "bold",
];

// Фигуры, которые ещё встречаются в объектах, но сетка их больше не предлагает:
// в размере метки шестиугольник неотличим от круга, залитый ромб — от залитого
// квадрата, а круг, залитый наполовину, — от залитого целиком. Рисоваться они
// продолжают как раньше: объекты с ними уже существуют.
export const SHAPE_LEGACY = ["hexagon", "diamond-fill", "circle-half"];

// Допустимые значения поля формы: палитра плюс старые значения.
export const SHAPE_NAMES = [...SHAPE_PALETTE, ...SHAPE_LEGACY];
export const BLOCK_MODES = ["each", "single"];
/**
 * Вид метки и вид типа — одни и те же значения: вид типа говорит, какие метки
 * этим типом ставятся.
 *
 * Третий вид — **комментарий** (G163). Слова заказчика: «нужен отдельный тип
 * меток - комментарий и комментарий с указателем. Просто комментарий -
 * прямоугольник со скруглёнными углами и внутри текст». На плане он рисуется
 * не знаком, а плашкой, и текст в плашке — поле «Комментарий» (`mark.original`,
 * то самое, что переименовали в таске 117): «плашка - да, пусть текст из поля
 * комментария будет».
 *
 * **Указатель — свойство метки, а не четвёртый вид** (его слова: «можно просто
 * как свойство комментария»): `mark.pointer`. Без него плашка стоит на своей
 * точке; с ним она отъезжает, а к точке идёт всегда видимая линия со стрелкой.
 * Механизм отъезда — тот же `labelOffset`/`labelLeader`, что у подписи обычной
 * метки: «Да, механизм тот же используем с поводком. Как раз это и правильно».
 * Второго механизма в сборке нет.
 *
 * Комментарий **не позиция**, а подпись к чертежу (G167: «В список меток в
 * таблицу и т.д. эти комментарии не должны попадать»), поэтому ни в списках,
 * ни в листах, ни в подсчётах его нет — см. `listedMarks` и `listedTypes`.
 *
 * И он **не строка справочника** (G173): «давай комментарий сделаем не просто
 * как отдельный тип метки, а всегда предустановленную, которая не помечается
 * в справочнике, так же у других меток оставь только Точка и линия». Тип у
 * него есть — метка без типа в этой модели не живёт, — но он **виртуальный**:
 * лежит не в `project.markTypes`, а в коде, под зарезервированным
 * идентификатором `COMMENT_TYPE_ID`. Отсюда вытекает всё остальное даром:
 * справочник, дерево фильтров, сетка выбора, легенда, лист справочника,
 * «Добавить из общей базы» и предупреждения перебирают `project.markTypes` —
 * и комментария там просто нет, фильтровать его в каждом месте не нужно.
 */
export const MARK_KIND_COMMENT = "comment";
export const MARK_KINDS = ["point", "line", MARK_KIND_COMMENT];

/**
 * Зарезервированные идентификаторы встроенного типа-комментария и его
 * категории.
 *
 * Не UUID намеренно: `crypto.randomUUID()` такого не выдаст никогда, значит
 * столкнуться с типом пользователя невозможно. В файле проекта они читаются
 * глазами — `"typeId": "comment"`, — и это тоже нарочно: разбирая чужой
 * объект руками, видно, что это за метка.
 */
export const COMMENT_TYPE_ID = "comment";
export const COMMENT_CATEGORY_ID = "comments";
// Код по умолчанию назвал заказчик: «Пусть код будет „Коммент"». Номер
// сквозной, счётчик ведётся на код — с чужими он не пересекается.
export const COMMENT_TYPE_CODE = "Коммент";

// Встроенная категория комментария. Цвет чернильный, почти чёрный: это не
// условное обозначение железки, а надпись на чертеже. Выбран счётом — до
// каждой категории шаблона ΔE больше `COLOR_NEAR_DISTANCE`, — хотя теперь это
// и не проверяется предупреждениями: категории нет в объекте, и
// `closeCategoryColors` её не видит. Знак — лежачий прямоугольник, та же
// плашка: на плане знак комментария не рисуется вовсе, но в окне выбора и в
// карточке метки значок нужен.
const COMMENT_CATEGORY = {
  id: COMMENT_CATEGORY_ID,
  name: strings.categories.comments,
  color: "#111418",
  shape: "rect-horizontal",
  lineStyle: null,
  order: -1,
};

/**
 * Код встроенного типа в этом объекте.
 *
 * Обычно это `COMMENT_TYPE_CODE`. Поле `project.commentCode` появляется
 * только у объекта, который пришёл из сборки таска 116 с **переименованным**
 * типом комментария: миграция переносит метки на встроенный тип и забирает
 * с собой код, иначе у человека сменились бы подписи всех плашек, а счётчик
 * начал бы нумерацию заново. У обычного объекта поля нет вовсе.
 */
export function commentCodeOf(project) {
  const own = project && typeof project.commentCode === "string" ? project.commentCode.trim() : "";
  return own || COMMENT_TYPE_CODE;
}

// Встроенный тип-комментарий этого объекта. Собирается на каждый вызов, как
// и положено значению, которого нет в данных.
function commentType(project) {
  return {
    id: COMMENT_TYPE_ID,
    categoryId: COMMENT_CATEGORY_ID,
    code: commentCodeOf(project),
    name: strings.types.comment,
    kind: MARK_KIND_COMMENT,
    shape: null,
    lineStyle: null,
    blockMode: "each",
    channels: TYPE_CHANNELS_DEFAULT,
    order: -1,
  };
}

/**
 * Сколько каналов у типа: одна клавиша у В, две у ВВ, три у ВВВ, четыре у
 * реле, шесть у сценарной панели. Канал — понятие, а не частный случай
 * двойного выключателя, поэтому число живёт у типа, а не выводится из кода.
 *
 * **У типа прежнего объекта поля нет, и это один канал.** Выводить число из
 * кода («ВВ — значит два») нельзя: код в справочнике заводит пользователь, и
 * догадка молча включила бы ему выбор канала там, где его не просили.
 * Потолок — здравый смысл: панелей больше чем на два десятка кнопок не бывает,
 * а список выбора на сотню строк был бы не выбором, а свалкой.
 */
export const TYPE_CHANNELS_DEFAULT = 1;
export const TYPE_CHANNELS_MAX = 24;

// Код типа: от одной буквы до шестнадцати. Заказчик снял прежний предел в две
// буквы, чтобы писать «ПОДСВЕТКА», а не «П».
export const CODE_MAX_LENGTH = 16;
// До двух букв подпись блока склеивается слитно — «В1В2В3», как на рукописном
// листе; длинный код так превращается в кашу и сворачивается в диапазон.
const CODE_GLUE_MAX = 2;

// Величина знака метки нового объекта — радиус в пикселях плана. Объявлена
// здесь, а не в `DEFAULT_VIEW`, потому что от неё считается шаг блока, и обе
// величины обязаны читаться рядом: разойдись они — соседняя метка встанет не
// там, где нарисована ручка «+».
export const DEFAULT_MARK_SIZE = 16;

/**
 * Шаг соседней точки блока — **в радиусах знака метки**, а не в пикселях.
 *
 * Слова заказчика: «добавляй метку прям рядом с текущей, а то сейчас на
 * большом расстоянии». Рядом — это как розетки в одной рамке, и мерить такое
 * абсолютным числом нельзя: у метки есть настройка величины, и при мелком
 * знаке прежние 28 пикселей разносили блок на семь радиусов.
 *
 * Откуда 2,4:
 *   — знак рисуется радиусом `markSize`, обводка добавляет ещё 0,11 радиуса,
 *     то есть два соседних знака касаются на 2,22 радиуса — ближе нельзя,
 *     иначе блок сливается в кляксу;
 *   — ручка «+» стоит ровно на 2,4 радиуса от центра метки (`HANDLE_GAP`
 *     в `render.js`), и новая метка встаёт **ровно туда, куда нажали**;
 *   — просвет между знаками получается 0,18 радиуса: знаки не сливаются,
 *     но читаются как одна рамка.
 * Согласие с ручкой проверено `test/blockStep.test.js` через `hitHandle`.
 */
export const BLOCK_STEP_RATIO = 2.4;

// Шаг блока в пикселях плана для заданной величины метки.
export function blockStepPx(markSize) {
  const size = Number.isFinite(markSize) && markSize > 0 ? markSize : DEFAULT_MARK_SIZE;
  return size * BLOCK_STEP_RATIO;
}

// Шаг для величины метки по умолчанию: им пользуется тот, кто величины не знает.
export const BLOCK_STEP_PX = blockStepPx(DEFAULT_MARK_SIZE);
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

// А ближе этого два цвета категорий на плане ещё различимы, но уже похожи:
// двадцать девять — разрыв самой близкой пары из пяти категорий первого брифа
// (зелень выключателей и оранжевый климата). Число не запрет: справочник
// заказчика держит пять пар ближе порога, и он об этом знает. Оно нужно, чтобы
// об этом было сказано вслух — предупреждением в панели (`closeCategoryColors`).
export const COLOR_NEAR_DISTANCE = 29;

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

// Поводок подписи — та самая полоска от метки к отведённой подписи. Правило по
// умолчанию считает раскладка: подпись, которую увели на ряд и дальше, поводок
// получает, а стоящая вплотную — нет; оттащенной рукой поводка не полагалось
// вовсе. Заказчику этого мало: «у тех, которые подвинул — пропадают».
//
// Поэтому у метки есть **перебивка**: `true` — поводок рисуется всегда,
// `false` — не рисуется никогда, поля нет вовсе — работает прежнее правило.
// Третьего значения нет: `null` в поле значит ровно то же, что отсутствие
// поля, и записывается, когда пользователь возвращает метку к правилу.
// У метки прежней разметки поля нет — и это не поломка: читать перебивку
// самому, минуя `markLabelLeader`, нельзя (G68).
export function markLabelLeader(mark) {
  if (!mark) return null;
  return mark.labelLeader === true || mark.labelLeader === false ? mark.labelLeader : null;
}

// ——— комментарий ——————————————————————————————————————————————————————
//
// Три читалки на весь инструмент: вид метки, указатель и текст плашки. Считать
// это самому нельзя по той же причине, по которой нельзя читать `type.kind`
// мимо `typeKindOf`: у метки прежней разметки ни `pointer`, ни `kind:
// "comment"` нет вовсе, и `undefined` разошёлся бы с «нет указателя».

/** Метка-комментарий: плашка с текстом вместо знака. */
export function markIsComment(mark) {
  return Boolean(mark) && mark.kind === MARK_KIND_COMMENT;
}

/**
 * Есть ли у комментария указатель. У метки без поля — нет: плашка стоит на
 * своей точке, и это умолчание новой метки. У не-комментария указателя нет
 * никогда, какое бы поле ему ни дописали чужие руки.
 */
export function markPointer(mark) {
  return markIsComment(mark) && mark.pointer === true;
}

/**
 * Текст плашки — поле «Комментарий» (`mark.original`), без краевых пробелов.
 * Пустая строка значит «плашка пустая»: рисуется она подсказкой, а `validate`
 * показывает это находкой — пустой комментарий на плане ничего не сообщает.
 */
export function markCommentText(mark) {
  return mark && typeof mark.original === "string" ? mark.original.trim() : "";
}

/** Тип, которым ставятся комментарии. */
export function typeIsComment(project, typeId) {
  return typeKindOf(project, typeId) === MARK_KIND_COMMENT;
}

/**
 * Метки, которые попадают в списки, листы и подсчёты, — то есть все, кроме
 * комментариев (G167).
 *
 * Одно место на весь инструмент, а не фильтр в каждом списке: заказчик
 * перечислил не одно место, а породу — «в список меток в таблицу и т.д.».
 * Разойдись такие фильтры, счётчик «Показано N из M» разошёлся бы с тем, что
 * видно в списке.
 */
export function listedMarks(marks) {
  return (Array.isArray(marks) ? marks : []).filter((mark) => !markIsComment(mark));
}

/**
 * Типы, которые попадают в листы и в легенду: комментарий — не позиция, его
 * знак на плане не рисуется, и объяснять в легенде нечего.
 */
export function listedTypes(project, types) {
  return (Array.isArray(types) ? types : []).filter((type) => !typeIsComment(project, type.id));
}

/**
 * Включить или выключить указатель у комментария.
 *
 * Отдельная команда, а не поле в `updateMark`: указатель меняет не вид
 * плашки, а её место на плане — без него плашка пришита к точке. Смещение
 * плашки при этом не трогается: выключили указатель, передумали, включили —
 * плашка вернулась туда, где её оставили рукой.
 */
export function setMarkPointer(project, markId, on) {
  const mark = requireMark(project, markId);
  if (!markIsComment(mark)) throw modelError("pointerOnlyComment");
  return updateMark(project, markId, { pointer: on === true });
}

// Размер метки и подписи в пикселях плана — с них начинается новый объект.
// Считано от бумаги: план в 2500 пикселей по большей стороне на листе A3 это
// 0,16 мм на пиксель, монтажник читает с расстояния вытянутой руки, значит
// подпись должна быть от двух с половиной миллиметров. Прежние 12 пикселей
// давали 1,9 мм, и проверяющий выгрузил схему, так и не узнав, что регулятор
// вообще есть. Двадцать пикселей — это 3,2 мм подписи и 5 мм значка.
// Регулятор никуда не делся: это только начальное значение нового объекта,
// у размеченных объектов свои числа уже записаны.
const DEFAULT_VIEW = { markSize: DEFAULT_MARK_SIZE, labelSize: 20 };

// Стартовый справочник — справочник рабочего объекта заказчика. Его слова:
// «справочник типов в общий возьми из этого проекта». Комнаты он прислал
// вместе с ним и тут же добавил «Комнаты не нужны» — в шаблон они не попали.
//
// Двенадцать категорий и сорок семь типов приехали как есть, включая коды,
// которые разошлись с прежним шаблоном: `П` теперь переключатель (был
// подсветкой), `ВП` — витая пара (был проходным переключателем), а подсветка
// зовётся `ПС`. Размеченный объект от этого не меняется: справочник копируется
// при создании и дальше живёт отдельно (G68), новые типы попадают в старый
// объект только кнопкой «Добавить из общей базы».
//
// Категорию «Не назначено» (`#FF007F`, крест) с единственным типом `ВОПРОС` он
// потом попросил убрать — «категорию „Не назначено“ удали», — и она ушла
// вместе с типом: тип без категории в модели не живёт. Заодно ушла самая
// тесная пара цветов, 21,4 с «Сантехникой».
//
// Справочник **нарушает два наших правила** — повтор знака у точечных типов и
// близкий цвет у категорий, — и нарушает сознательно: заказчику показали числа
// (семь типов «Света» под одним кругом с крестом, ещё четыре пары знаков,
// пары цветов ближе порога 29), и он выбрал «взять как есть». Довод его
// сильный: рядом со знаком на плане **всегда стоит подпись** — Т1, С2, ПК1, —
// и монтажник читает её, а не форму; правило заводилось, воображая знак без
// подписи, а такого на плане не бывает.
//
// Поэтому оба правила стали предупреждением, а не запретом: `validate` собирает
// их через `sharedShapes` и `closeCategoryColors`. На новом объекте эти
// предупреждения сразу же принимаются за пользователя (`acceptFromDictionary`):
// его слова — «в стандартной схеме не должно быть предупреждений», — и он прав,
// пустой объект обязан встречать тишиной. Ничего при этом не прячется: список
// принятых виден в панели, и любая строка возвращается одним нажатием. Строгими остались отпечаток самих
// фигур и начертаний (`test/shapes.test.js`, `test/lineStyle.test.js` — они про
// палитру, а не про справочник) и пометка занятых и близких цветов в окне
// выбора цвета: заводя новую категорию, человек по-прежнему видит, куда не
// стоит целиться.
const TEMPLATE_CATEGORIES = [
  { key: "light", name: strings.categories.light, color: "#1F6FEB", shape: "circle-cross" },
  // Форма категории у выключателей и розеток не используется ни одним типом:
  // у всех пяти выключателей и у обеих розеток знак свой. Круг и квадрат здесь
  // стоят так, как их оставил заказчик, — это умолчание для типа, который он
  // заведёт потом.
  { key: "switches", name: strings.categories.switches, color: "#2DA44E", shape: "circle" },
  { key: "sockets", name: strings.categories.sockets, color: "#D1242F", shape: "square" },
  { key: "climate", name: strings.categories.climate, color: "#E36209", shape: "triangle" },
  { key: "network", name: strings.categories.network, color: "#8250DF", shape: "star" },
  { key: "intercom", name: strings.categories.intercom, color: "#D901C4", shape: "triangle-down" },
  { key: "curtains", name: strings.categories.curtains, color: "#9d4c01", shape: "diamond" },
  { key: "appliances", name: strings.categories.appliances, color: "#1DAB1D", shape: "square-bolt" },
  { key: "cinema", name: strings.categories.cinema, color: "#001BDD", shape: "square-wave" },
  { key: "sensors", name: strings.categories.sensors, color: "#164E63", shape: "circle-ring" },
  { key: "panel", name: strings.categories.panel, color: "#6E4B1F", shape: "square-bolt" },
  { key: "plumbing", name: strings.categories.plumbing, color: "#E80098", shape: "drop-dot" },
];

// Порядок — порядок справочника заказчика, а не наша перекладка по категориям:
// он этим списком работает, и привычка искать тип глазами дороже стройности.
const TEMPLATE_TYPES = [
  // Свет. Семь точечных типов идут без своей формы и берут круг с крестом у
  // категории — тот самый повтор, на который заказчик согласился сознательно.
  { category: "light", code: "Т", name: strings.types.spot },
  { category: "light", code: "С", name: strings.types.lamp },
  { category: "light", code: "ПК", name: strings.types.bedLight },
  // Линейные типы света разведены начертанием: цвет в категории общий, и на
  // чёрно-белой распечатке линию от линии отличает только рисунок.
  { category: "light", code: "ТР", name: strings.types.track, kind: "line", lineStyle: "double" },
  { category: "light", code: "ПС", name: strings.types.backlight },
  // Лента своего начертания не имеет: берёт категорийное, то есть сплошную.
  { category: "light", code: "Л", name: strings.types.strip, kind: "line" },
  { category: "light", code: "ПШ", name: strings.types.wardrobeLight, kind: "line", lineStyle: "dashed" },
  // Выключатели: число каналов — число клавиш, связь с нагрузкой получает номер
  // клавиши. Каналы приехали из объекта заказчика вместе со справочником.
  { category: "switches", code: "В", name: strings.types.switch, shape: "square", channels: 1 },
  { category: "switches", code: "ВВ", name: strings.types.switchDouble, shape: "square-bar", channels: 2 },
  { category: "sockets", code: "Р", name: strings.types.socket, shape: "circle-socket" },
  { category: "climate", code: "Б", name: strings.types.breezer, shape: "dome-dot" },
  { category: "climate", code: "К", name: strings.types.conditioner, shape: "circle-thermo" },
  { category: "network", code: "W", name: strings.types.wifi, shape: "circle-wave" },
  { category: "intercom", code: "Д", name: strings.types.intercom },
  { category: "curtains", code: "КШ", name: strings.types.curtainRail },
  { category: "light", code: "ППл", name: strings.types.floorLight },
  { category: "light", code: "ПКШ", name: strings.types.corniceLight, kind: "line", lineStyle: "wave" },
  { category: "light", code: "ЛЮ", name: strings.types.chandelier },
  { category: "switches", code: "П", name: strings.types.switchToggle, shape: "square-chevron", channels: 1 },
  { category: "switches", code: "ПП", name: strings.types.switchToggleDouble, shape: "square-cross", channels: 2 },
  { category: "light", code: "Н", name: strings.types.nightLight, shape: "circle-drain" },
  // Розетка 380: три отверстия по кругу против двух у обычной — на плане их
  // не спутать.
  { category: "sockets", code: "РC", name: strings.types.socket380, shape: "circle-triple" },
  { category: "sensors", code: "ДП", name: strings.types.presence, shape: "circle-fan" },
  { category: "appliances", code: "СУШ", name: strings.types.dryer },
  { category: "panel", code: "Щ", name: strings.types.panel, shape: "square-hatch" },
  { category: "climate", code: "ВЫТ", name: strings.types.hood, shape: "circle-fill" },
  { category: "light", code: "Бр", name: strings.types.sconce },
  { category: "appliances", code: "ДЭП", name: strings.types.cabinetDoor },
  { category: "network", code: "ПУ", name: strings.types.controlPanel, shape: "square-jack" },
  { category: "climate", code: "ОВ", name: strings.types.dehumidifier, shape: "drop-dot" },
  { category: "network", code: "ВП", name: strings.types.ethernet, shape: "square-cross" },
  { category: "cinema", code: "РЕС", name: strings.types.receiver },
  { category: "cinema", code: "ПРО", name: strings.types.projector, shape: "diamond-dot" },
  { category: "network", code: "УК", name: strings.types.smartSpeaker, shape: "circle-antenna" },
  // Вертикальный кусок ленты ставится одной точкой, а не тянется по плану.
  { category: "light", code: "ЛВ", name: strings.types.stripVertical, shape: "rect-vertical" },
  { category: "switches", code: "ВВВ", name: strings.types.switchTriple, shape: "square-bar-two", channels: 3 },
  { category: "sensors", code: "ДД", name: strings.types.motion, shape: "triangle-dot" },
  { category: "sensors", code: "ДО", name: strings.types.opening, shape: "square-split" },
  { category: "sensors", code: "ДПр", name: strings.types.leak, shape: "drop" },
  { category: "panel", code: "ЩС", name: strings.types.panelLow, shape: "square-cross" },
  { category: "appliances", code: "РП", name: strings.types.vacuum, shape: "trapezoid-bar" },
  { category: "plumbing", code: "ВР", name: strings.types.waterOutlet },
  { category: "plumbing", code: "КН", name: strings.types.sewer, shape: "circle-drain" },
  { category: "plumbing", code: "КВ", name: strings.types.waterValve, shape: "circle-valve" },
  { category: "light", code: "ПЛ", name: strings.types.stairLight, kind: "line", lineStyle: "meander" },
  { category: "light", code: "ПЗ", name: strings.types.mirrorLight, shape: "circle-ring" },
  { category: "appliances", code: "КАМ", name: strings.types.camera, shape: "diamond-ring" },
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
    // Вид типа: точечных в шаблоне большинство, линейные и комментарий
    // названы поимённо в самом списке. Переключается строкой в справочнике.
    kind: MARK_KINDS.includes(type.kind) ? type.kind : "point",
    shape: type.shape || null,
    // Начертание своё только там, где оно разводит линейные типы одной
    // категории; остальные берут категорийное — как форму берёт тип, который
    // в своей категории один такой.
    lineStyle: type.lineStyle || null,
    blockMode: "each",
    // Каналы: у выключателей столько, сколько клавиш, у остальных один.
    channels: type.channels || TYPE_CHANNELS_DEFAULT,
    order: index,
  }));
  return { categories, markTypes, equipmentTypes: equipmentTypeTemplate() };
}

export function createProject(template) {
  const source = template && template.categories && template.markTypes ? clone(template) : defaultTemplate();
  const stamp = nowIso();
  const project = {
    formatVersion: FORMAT_VERSION,
    id: newId(),
    // Постоянный ключ объекта: заводится здесь и не меняется никогда — ни при
    // загрузке файла, ни при копировании, ни при переименовании. По нему два
    // файла узнают друг в друге один проект. `id` для этого не годится: его
    // перевыдаёт приёмка файла (`autosave.adoptLoadedProject`), иначе двое
    // писали бы в один снимок, — и у участников одного проекта он разный.
    key: newId(),
    name: (template && template.name) || strings.project.untitled,
    createdAt: stamp,
    updatedAt: stamp,
    categories: source.categories.map((category, index) => ({ ...category, order: index })),
    markTypes: source.markTypes.map((type, index) => ({
      shape: null,
      blockMode: "each",
      // Шаблон мог быть сохранён до того, как у типа появился вид: без
      // умолчания поле уехало бы в объект пустым. То же и с каналами.
      kind: "point",
      channels: TYPE_CHANNELS_DEFAULT,
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
    // Справочник типов оборудования — часть шаблона, как категории и типы
    // меток. Шаблон, сохранённый до появления типов, их не несёт: новый объект
    // тогда получает встроенный стартовый набор, а не пустой справочник.
    equipmentTypes: (Array.isArray(source.equipmentTypes) && source.equipmentTypes.length > 0
      ? source.equipmentTypes
      : equipmentTypeTemplate()
    ).map((type, index) => ({ ...type, order: index })),
    // Принятые предупреждения — ответы «так и задумано». Ответ живёт в объекте
    // и уезжает вместе с файлом, а не в настройках браузера: файл открывают на
    // другой машине и вторым человеком. Список читают через
    // `acceptedProblems`, поэтому объект прежнего формата без него открывается
    // как раньше.
    accepted: [],
    counters: {},
    view: { ...DEFAULT_VIEW, ...(source.view || {}) },
  };
  // Всё, о чём справочник нового объекта мог бы предупредить, он принёс с
  // собой: человек этих знаков и цветов не выбирал, он только что нажал
  // «Создать объект». Поэтому ответ «так и задумано» даётся сразу — иначе
  // пустой объект встречал бы десятком жёлтых строк. Список принятых при этом
  // виден, и любую строку возвращают одним нажатием.
  return acceptFromDictionary(project, new Set());
}

// ——— поиск ———————————————————————————————————————————————————————————

export function findScheme(project, schemeId) {
  return project.schemes.find((scheme) => scheme.id === schemeId) || null;
}

/**
 * Тип по идентификатору — **единственная** дверь к типу во всей сборке, и
 * поэтому именно здесь живёт встроенный комментарий (G173). Всё, что спрашивает
 * тип у метки, — подпись, цвет, знак, вид, карточка, холст — получает его, не
 * зная, что в справочнике такой строки нет.
 */
export function findType(project, typeId) {
  if (typeId === COMMENT_TYPE_ID) return commentType(project);
  return project.markTypes.find((type) => type.id === typeId) || null;
}

export function findCategory(project, categoryId) {
  if (categoryId === COMMENT_CATEGORY_ID) return COMMENT_CATEGORY;
  return project.categories.find((category) => category.id === categoryId) || null;
}

export function findMark(project, markId) {
  return project.marks.find((mark) => mark.id === markId) || null;
}

// Одно правило «та же категория» на всю модель: имя без краёв и без учёта
// регистра. Правил тут должно быть ровно одно — «Датчики» и «датчики» обязаны
// значить одну строку и общей базе, и шаблону нового объекта. Разойдись они —
// в справочнике заводится двойник, и метки двух категорий с одним именем
// красятся в разные цвета.
export function categoryNameKey(name) {
  return String(name == null ? "" : name).trim().toLowerCase();
}

export function findCategoryByName(project, name) {
  const key = categoryNameKey(name);
  if (!project || !key || !Array.isArray(project.categories)) return null;
  return project.categories.find((category) => categoryNameKey(category.name) === key) || null;
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
//
// **Калибровка масштаба снимается.** Доли указывают на то же место картинки,
// но картинка другая: новый файл — это другой чертёж, снятый неизвестно с
// какого кадра, и прежние «четыре метра между этими точками» на нём значат
// неизвестно что. Пересчитать это нечем — кадр нового файла не сравнить со
// старым ничем, кроме глаз, — а длина ленты из вранья уедет в закупку. Поэтому
// масштаб честно сбрасывается (`scaleDropped`), об этом говорят вслух, и схема
// возвращается в прежнее состояние «длин не показываем»; калибровка заново —
// два клика. Отмена шага возвращает и её.
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
  const scaleDropped = Boolean(planScaleOf(project, schemeId));
  // **Привязка чертежа снимается вместе с масштабом, а сам чертёж цел.** Он в
  // миллиметрах и от картинки не зависит — ни одна стена не трогается. А вот
  // место, где лежало его начало координат, указывало на точку **прежней**
  // картинки: на новой там неизвестно что, да и пикселей на метр больше нет,
  // так что положить чертёж на подложку всё равно нечем. Оставь привязку —
  // после новой калибровки чертёж молча встал бы не туда; снять её честнее,
  // а привязать заново — два клика. Отмена шага возвращает и её.
  const originDropped = Boolean(planOriginOf(project, schemeId));
  const schemes = project.schemes.map((item) => {
    if (item.id !== schemeId) return item;
    const { scale, origin, ...rest } = item;
    return { ...rest, imageId, width: nextWidth, height: nextHeight };
  });
  const marks = project.marks.map((mark) =>
    mark.schemeId === schemeId && mark.labelOffset ? { ...mark, labelOffset: scaleOffset(mark.labelOffset) } : mark,
  );
  const groups = project.groups.map((group) =>
    group.schemeId === schemeId && group.labelOffset
      ? { ...group, labelOffset: scaleOffset(group.labelOffset) }
      : group,
  );
  // Подпись комнаты держит своё смещение в тех же пикселях плана — и уезжает
  // вместе с ними.
  const outlines = outlinesOf(project).map((outline) =>
    outline.schemeId === schemeId && outline.labelOffset
      ? { ...outline, labelOffset: scaleOffset(outline.labelOffset) }
      : outline,
  );
  return {
    project: withProject(project, { schemes, marks, groups, outlines }),
    scheme: schemes.find((item) => item.id === schemeId),
    scaleDropped,
    originDropped,
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
  // Чертёж принадлежит схеме так же, как метки и контуры: стены уходят вместе
  // с ней, проёмы — вместе со стенами, а метки чужих схем теряют привязку к
  // ушедшим стенам.
  const goneWalls = new Set(wallsOnScheme(project, schemeId).map((wall) => wall.id));
  const marks = dropControls(
    project.marks
      .filter((mark) => mark.schemeId !== schemeId)
      .map((mark) => (goneWalls.has(mark.wallId) ? withoutWallBinding(mark) : mark)),
    removed,
  );
  const groups = project.groups.filter((group) => group.schemeId !== schemeId);
  // Контуры помещений живут на схеме — вместе с ней и уходят.
  const outlines = outlinesOf(project).filter((outline) => outline.schemeId !== schemeId);
  const schemes = project.schemes
    .filter((scheme) => scheme.id !== schemeId)
    .map((scheme, index) => ({ ...scheme, order: index }));
  const placements = dropPlacements(project, removed);
  const patch = { schemes, marks, groups, outlines, placements };
  // Списки чертежа попадают в патч только у того объекта, у которого они уже
  // есть: иначе удаление схемы дописало бы старому объекту три пустых списка
  // на пустом месте (G68).
  if (Array.isArray(project.walls)) patch.walls = project.walls.filter((wall) => wall.schemeId !== schemeId);
  if (Array.isArray(project.openings)) {
    patch.openings = project.openings.filter((opening) => !goneWalls.has(opening.wallId));
  }
  if (Array.isArray(project.schemeObjects)) {
    patch.schemeObjects = project.schemeObjects.filter((object) => object.schemeId !== schemeId);
  }
  return { project: withProject(project, patch) };
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
  // Указатель есть только у комментария, и поле заводится только ему: розетке
  // `pointer` ничего не значил бы, а в файле проекта лежал бы у каждой метки.
  const comment = kind === MARK_KIND_COMMENT ? { pointer: false } : null;
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
    // Размеры в миллиметрах (`MARK_DIMENSION_UNIT`): все три необязательные,
    // `null` — «не задано». У метки из старого объекта этих полей нет вовсе,
    // и читать их надо только через `markDimensions`.
    length: null,
    width: null,
    heightAboveFloor: null,
    // Чем управляет: ссылки на другие метки объекта. Именно ссылки, а не текст, —
    // смена типа и уплотнение номеров переписывают обозначения, а связь должна
    // это пережить.
    controls: [],
    ...comment,
  };
}

// Линия короче двух вершин не линия: одно правило и для постановки, и для
// правки вершин.
export const MARK_LINE_MIN_POINTS = 2;

export function addMark(project, { schemeId, typeId, kind = "point", points, blockMode } = {}) {
  requireScheme(project, schemeId);
  const type = requireType(project, typeId);
  if (!MARK_KINDS.includes(kind)) throw modelError("unknownKind");
  const vertices = normalizePoints(points);
  if (kind === "line" && vertices.length < MARK_LINE_MIN_POINTS) throw modelError("shortLine");
  // Комментарий — одна плашка в одном месте: вторая точка у него значила бы
  // блок из плашек, а блока у комментария нет (см. `addToGroup`).
  if (kind === MARK_KIND_COMMENT && vertices.length !== 1) throw modelError("commentOnePoint");

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

/**
 * Перечень обозначений без повторов: `[{label, count}]` в порядке первого
 * появления.
 *
 * Повтор номера — приём заказчика: группа светильников под одним номером это
 * несколько меток «Т3». В перечне связей они превращались в «Т3, Т3, Т3, ППл1,
 * ППл1, ППл2, ППл1…» — строка уезжала за край панели. Его слова: «если метки
 * с одинаковым номером, то в интерфейсе указывай только 1 раз».
 *
 * Число повторов возвращается вместе с именем, а не выбрасывается: связей
 * больше, чем имён, и сказать об этом больше нечем. Как его показать, решает
 * панель — модель словами не распоряжается.
 *
 * Тем же правилом живёт подпись блока (`blockLabelParts`): одинаковые
 * обозначения в ней тоже названы один раз.
 */
export function labelCounts(labels) {
  const known = new Map();
  const order = [];
  for (const label of Array.isArray(labels) ? labels : []) {
    if (!label) continue;
    const seen = known.get(label);
    if (seen) {
      seen.count += 1;
      continue;
    }
    const entry = { label, count: 1 };
    known.set(label, entry);
    order.push(entry);
  }
  return order;
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

// Разделитель кусков подписи блока. Объявлен отдельно, потому что теперь он
// ещё и **кусок без типа**: рисование красит его цветом соседа слева, и обе
// стороны должны говорить об одной и той же строке.
export const BLOCK_LABEL_SEPARATOR = ", ";

// Подпись блока: подряд идущие номера одного типа склеиваются слитно,
// разнородные — через запятую («В1, Р1» — выключатель и розетка в одной рамке).
// Список меток задаёт вызывающий: у группы это её метки, а на плане под
// фильтром — только видимые, иначе подпись обещает то, чего на листе нет.
export function blockLabel(project, markIds) {
  return blockLabelParts(project, markIds)
    .map((part) => part.text)
    .join("");
}

/**
 * Та же подпись блока, но кусками: `[{text, typeId}]`.
 *
 * Понадобилось оттого, что блок бывает **смешанным** — выключатель и розетка в
 * одной рамке (G22), — и подпись «В37, Р77Р78» красилась целиком цветом
 * первого типа. Слова заказчика: «если в группе метки разных типов, то цвет
 * группы целиком первого типа, а должны быть так же разным».
 *
 * Разделитель — отдельный кусок **без типа** (`typeId: null`): своего типа у
 * запятой нет, и решение, чем её красить, принимает рисование, а не модель.
 *
 * `blockLabel` склеивается **отсюда же**. Двух правил склейки быть не должно:
 * разойдись они — на плане и в таблице оказались бы разные подписи.
 */
export function blockLabelParts(project, markIds) {
  const runs = [];
  let previous = null;
  const named = new Set();
  for (const mark of blockMembers(project, markIds)) {
    const type = findType(project, mark.typeId);
    const code = type ? type.code : "?";
    const key = code + "\u0000" + mark.number;
    if (named.has(key)) continue;
    named.add(key);
    const sameRun = previous && previous.code === code && mark.number === previous.number + 1;
    if (sameRun) runs[runs.length - 1].numbers.push(mark.number);
    else runs.push({ code, numbers: [mark.number], typeId: mark.typeId });
    previous = { code, number: mark.number };
  }
  const parts = [];
  for (const run of runs) {
    if (parts.length > 0) parts.push({ text: BLOCK_LABEL_SEPARATOR, typeId: null });
    parts.push({ text: blockRunLabel(run), typeId: run.typeId });
  }
  return parts;
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
//
// **Канал — свойство связи.** Слова заказчика: «если выключатель одинарный, то
// он управляет своей нагрузкой и связь 1 к 1. а вот если двойной, то связи
// получаются к 2 нагрузкам сразу и фактически какой канал выключателя к какой
// нагрузке идёт — не понятно». Канал мог бы стоять у метки списком клавиш, но
// связей у метки много, а нагрузок у одной клавиши бывает шесть: канал живёт
// на самой связи и больше нигде.
//
// Поэтому запись в `mark.controls` бывает двух видов, и оба законны:
//
//   "id"                — канал не указан (так писали до появления каналов);
//   { id, channel: 2 }  — вторая клавиша, второй выход реле.
//
// **Старая запись читается как «канал не указан» и не переписывается.**
// Миграции значений здесь нет и быть не должно: объект заказчика обязан
// открыться ровно тем, чем закрывался, — те же дуги на плане, те же строки в
// таблице, ни одного вопроса при открытии. Поэтому и обратно: связь без канала
// пишется строкой, а не объектом с пустым полем.

// Номер канала, каким его можно прочитать. Верхнего предела при чтении нет
// нарочно: `TYPE_CHANNELS_MAX` ограничивает то, что кладут руками, а прочитать
// объект надо любой — иначе правка файла снаружи молча съела бы связь.
function channelValue(value) {
  return Number.isInteger(value) && value >= 1 ? value : null;
}

// Номер канала на запись: здесь предел уже есть.
function checkChannel(value) {
  const number = typeof value === "string" ? Number(value.trim()) : value;
  if (!Number.isInteger(number) || number < 1 || number > TYPE_CHANNELS_MAX) {
    throw modelError("channelInvalid", { max: TYPE_CHANNELS_MAX });
  }
  return number;
}

/**
 * Связи метки как есть: `[{id, channel}]`, где `channel` — число или `null`
 * («канал не указан»). Единственное место, где разбираются две формы записи;
 * всё остальное читает связь отсюда и про формы не знает.
 */
export function markControlLinks(mark) {
  const list = mark && Array.isArray(mark.controls) ? mark.controls : [];
  const links = [];
  for (const item of list) {
    if (typeof item === "string") {
      links.push({ id: item, channel: null });
      continue;
    }
    if (item && typeof item === "object" && typeof item.id === "string") {
      links.push({ id: item.id, channel: channelValue(item.channel) });
    }
  }
  return links;
}

// Поле появилось не сразу: у метки из старого файла или из браузерного
// хранилища его просто нет, и это не поломка. Читают связь только отсюда.
export function markControlIds(mark) {
  return markControlLinks(mark).map((link) => link.id);
}

// Канал связи с этой меткой: число или `null`. Дубли в списке не заводятся
// (`setMarkControls` их снимает), поэтому берётся первое совпадение.
export function markControlChannel(mark, id) {
  const link = markControlLinks(mark).find((item) => item.id === id);
  return link ? link.channel : null;
}

/**
 * Как канал зовётся в перечне: «①», «②». Канал не указан — пустая строка, и
 * перечень у объекта прежнего формата выглядит ровно как раньше.
 *
 * Кружок, а не «канал 2», — потому что перечень стоит в кнопке строки метки и
 * в ячейке таблицы, где слово съело бы место, отведённое обозначениям. Дальше
 * двадцатого кружков в наборе нет: там цифра в скобках.
 */
export function channelLabel(channel) {
  const value = channelValue(channel);
  if (value === null) return "";
  const digits = [...strings.channels.digits];
  return value <= digits.length ? digits[value - 1] : text("channels.over", { channel: value });
}

// Метки, которыми управляет эта, — в порядке объекта, а не в порядке кликов:
// строка списка и таблица должны читаться одинаково после каждой правки.
export function markControls(project, markId) {
  const mark = findMark(project, markId);
  if (!mark) return [];
  const wanted = new Set(markControlIds(mark));
  return wanted.size === 0 ? [] : marksInOrder(project, (item) => wanted.has(item.id));
}

// Порядок каналов в перечне: сперва названные по возрастанию, «канал не
// указан» — хвостом. Так читается «① Т16 ×6 · ② С1 · Р3»: сперва разложенное
// по клавишам, потом то, что ещё не разложили.
export function channelOrder(channel) {
  return channelValue(channel) === null ? Number.POSITIVE_INFINITY : channel;
}

/**
 * Нагрузки метки, сгруппированные по каналам: `[{channel, marks}]`.
 *
 * Группа с `channel: null` — связи без канала; у объекта прежнего формата
 * группа ровно одна, и перечень в строке метки выглядит в точности как
 * раньше. Метки внутри группы — в порядке объекта, как у `markControls`:
 * перечень не должен зависеть от того, в каком порядке щёлкали.
 *
 * Потерянные связи сюда не попадают — о них говорит `validate` и отдельная
 * пометка в таблице; здесь их не отличить от живых.
 */
export function markControlsByChannel(project, markId) {
  const mark = findMark(project, markId);
  if (!mark) return [];
  const channels = new Map();
  for (const link of markControlLinks(mark)) {
    if (!channels.has(link.id)) channels.set(link.id, link.channel);
  }
  if (channels.size === 0) return [];
  const groups = new Map();
  for (const item of marksInOrder(project, (candidate) => channels.has(candidate.id))) {
    const channel = channels.get(item.id);
    const key = channel === null ? "" : channel;
    if (!groups.has(key)) groups.set(key, { channel, marks: [] });
    groups.get(key).marks.push(item);
  }
  return [...groups.values()].sort((first, second) => channelOrder(first.channel) - channelOrder(second.channel));
}

// Обратная сторона: кто управляет этой меткой. Отдельного поля у неё нет —
// хранить связь с двух концов значит однажды их разойтись.
export function markControlledBy(project, markId) {
  if (!findMark(project, markId)) return [];
  return marksInOrder(project, (item) => markControlIds(item).includes(markId));
}

/**
 * Вся связная группа метки — транзитивное замыкание по трём родам отношений:
 * управление в обе стороны, общая цепь (у меток есть общий подопечный) и общий
 * номер (тип и номер совпали).
 *
 * Слова заказчика: «если выделили выключатель, у которого есть ещё один
 * переключатель и управляет группой светильников, то и группу света выделяй и
 * между выключателями связь и стрелки. Если хоть 1 элемент из цепочки
 * выделен». То есть выделение поднимает не соседей метки, а **всю цепочку**, в
 * какой бы её точке ни начали.
 *
 * Отношения здесь симметричны все три: управление берётся в обе стороны
 * нарочно — выделив светильник, пользователь хочет увидеть тех, кто его
 * включает, ровно так же, как выделив выключатель, хочет увидеть, что тот
 * включает.
 *
 * Считается по всему объекту, а не по схеме: связная группа — свойство
 * разметки, а какую её часть видно на открытом листе, решает уже холст.
 * Возвращает идентификаторы **в порядке объекта**, вместе с самой меткой;
 * несуществующая метка — пустой список.
 */
export function linkedMarkIds(project, markId) {
  if (!project || !findMark(project, markId)) return [];
  // Три карты на один обход всех меток: дальше замыкание ходит по ним, а не
  // перебирает объект заново на каждом шаге.
  const controls = new Map();
  const controlledBy = new Map();
  const byNumber = new Map();
  const add = (map, key, value) => {
    let list = map.get(key);
    if (!list) map.set(key, (list = new Set()));
    list.add(value);
  };
  for (const mark of project.marks) {
    add(byNumber, mark.typeId + "#" + mark.number, mark.id);
    for (const id of markControlIds(mark)) {
      add(controls, mark.id, id);
      add(controlledBy, id, mark.id);
    }
  }
  const seen = new Set([markId]);
  const queue = [markId];
  while (queue.length > 0) {
    const current = queue.shift();
    const neighbours = new Set();
    for (const id of controls.get(current) || []) neighbours.add(id);
    for (const id of controlledBy.get(current) || []) neighbours.add(id);
    // Общая цепь: у метки и соседа есть общий подопечный.
    for (const target of controls.get(current) || []) {
      for (const id of controlledBy.get(target) || []) neighbours.add(id);
    }
    const mark = findMark(project, current);
    if (mark) for (const id of byNumber.get(mark.typeId + "#" + mark.number) || []) neighbours.add(id);
    for (const id of neighbours) {
      if (seen.has(id) || !findMark(project, id)) continue;
      seen.add(id);
      queue.push(id);
    }
  }
  return project.marks.filter((mark) => seen.has(mark.id)).map((mark) => mark.id);
}

/**
 * Список переписывается целиком: окно выбора отдаёт то, что отмечено
 * галочками. На вход принимаются обе формы записи — идентификатор строкой и
 * `{id, channel}`; наружу уходит та же пара форм.
 *
 * **Канал не указан — пишется строкой.** Объект `{id, channel: null}` был бы
 * той же связью, но другим байтом в файле: открыв и сохранив объект прежнего
 * формата, пользователь получил бы «правку», которой не делал.
 */
export function setMarkControls(project, markId, controlled) {
  const owner = requireMark(project, markId);
  // Комментарий в связях не участвует (решение таска 116): «чем управляет» —
  // утверждение инженера про железки, а плашка — надпись на чертеже. Пустить
  // её в связи значило бы пустить её и в лист связей, откуда G167 её убирает.
  if (markIsComment(owner)) throw modelError("commentNoLinks");
  const wanted = [];
  const seen = new Set();
  for (const item of Array.isArray(controlled) ? controlled : []) {
    const id = typeof item === "string" ? item : item && typeof item === "object" ? item.id : null;
    if (typeof id !== "string") throw modelError("markNotFound");
    if (id === markId) throw modelError("controlsSelf");
    requireMark(project, id);
    if (seen.has(id)) continue;
    seen.add(id);
    const raw = typeof item === "string" ? null : item.channel;
    const channel = raw === null || raw === undefined || raw === "" ? null : checkChannel(raw);
    wanted.push(channel === null ? id : { id, channel });
  }
  // Хранится в порядке объекта — тогда и файл, и таблица, и строка списка
  // показывают одно и то же независимо от того, в каком порядке щёлкали.
  const order = new Map(marksInOrder(project).map((mark, index) => [mark.id, index]));
  const idOf = (item) => (typeof item === "string" ? item : item.id);
  wanted.sort((first, second) => order.get(idOf(first)) - order.get(idOf(second)));
  const marks = project.marks.map((mark) => (mark.id === markId ? { ...mark, controls: wanted } : mark));
  return { project: withProject(project, { marks }), mark: marks.find((mark) => mark.id === markId) };
}

// Ссылки на исчезнувшие метки снимаются одним проходом: висячая связь — это
// пустое место в таблице и вопрос «а что это было». Уцелевшие записи
// перекладываются **как есть**: канал — часть связи, и пересобирать список из
// одних идентификаторов значило бы терять его на каждом удалении метки.
function dropControls(marks, removed) {
  if (removed.size === 0) return marks;
  return marks.map((mark) => {
    const list = Array.isArray(mark.controls) ? mark.controls : [];
    const kept = list.filter((item) => !removed.has(typeof item === "string" ? item : item && item.id));
    if (kept.length === list.length) return mark;
    return { ...mark, controls: kept };
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

// ——— размеры метки ———————————————————————————————————————————————————
//
// Длина, ширина и высота над полом — три необязательных числа. Масштаба у
// плана нет (доли, а не метры), вывести единицу неоткуда — поэтому она
// объявлена здесь и означает, что в этих полях лежат **миллиметры**: так в
// строительных чертежах пишут высоту установки («розетка на 300»). Смена
// единицы — правка этой константы и строки `strings.markSizes.unit`, больше
// нигде число в другую меру не переводится.
export const MARK_DIMENSION_UNIT = "mm";

// Потолок разумного размера — сто метров в миллиметрах. Смысл тот же, что у
// `MARK_NUMBER_MAX`: опечатка в поле не должна превратиться в размер, которого
// не бывает, и молча уехать в файл.
export const MARK_DIMENSION_MAX = 100000;

// Порядок здесь — порядок полей в окне и в подписи кнопки.
export const MARK_DIMENSION_FIELDS = ["length", "width", "heightAboveFloor"];

/**
 * Одно значение размера.
 *
 * Пусто (`""`, `null`, `undefined`) — «не задано»: такая метка ничем не
 * отличается от размеченной до этого таска. Ноль — значение, а не пустота:
 * у метки в полу высота над полом равна нулю, и стереть её обратно в «не
 * задано» было бы враньём. Отрицательное и нечисловое не принимаются.
 *
 * Запятая принимается наравне с точкой: «1,5» набирают чаще, чем «1.5».
 */
export function markDimensionValue(value) {
  if (value === null || value === undefined) return null;
  const raw = typeof value === "string" ? value.trim().replace(",", ".") : value;
  if (raw === "") return null;
  const number = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(number) || number < 0) throw modelError("badDimension");
  if (number > MARK_DIMENSION_MAX) {
    throw modelError("dimensionTooBig", { max: MARK_DIMENSION_MAX, unit: strings.markSizes.unit });
  }
  return number;
}

/**
 * Размеры метки. У метки из старого файла этих полей нет вовсе — и это не
 * поломка: читают их только отсюда, и отсутствие приходит тем же `null`, что
 * и очищенное поле.
 */
export function markDimensions(mark) {
  const values = {};
  for (const field of MARK_DIMENSION_FIELDS) {
    const value = mark ? mark[field] : null;
    values[field] = typeof value === "number" && Number.isFinite(value) ? value : null;
  }
  return values;
}

// Задан ли у метки хоть один размер: по этому строка списка показывает, что
// в окно заглядывать есть зачем.
export function markHasDimensions(mark) {
  const values = markDimensions(mark);
  return MARK_DIMENSION_FIELDS.some((field) => values[field] !== null);
}

/**
 * Записать размеры. Поля, которых в `patch` нет, остаются как были: окно
 * отдаёт все три сразу, а команда не обязана.
 */
export function setMarkDimensions(project, markId, patch) {
  requireMark(project, markId);
  const changes = {};
  for (const field of MARK_DIMENSION_FIELDS) {
    if (!patch || !Object.prototype.hasOwnProperty.call(patch, field)) continue;
    changes[field] = patch[field];
  }
  return updateMark(project, markId, changes);
}

const MARK_PATCH_FIELDS = [
  "points",
  "closed",
  "labelOffset",
  "labelAngle",
  "labelLeader",
  "roomId",
  "roomManual",
  "location",
  "original",
  "pointer",
  ...MARK_DIMENSION_FIELDS,
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
  // Перебивка поводка — только да, нет или «как решит раскладка». Пустое
  // значение приводится к `null`: метка без поля и метка с `labelLeader: null`
  // обязаны читаться одинаково, иначе упаковка старого объекта дописала бы ему
  // поле, которого там не было.
  if (Object.prototype.hasOwnProperty.call(changes, "labelLeader")) {
    const value = changes.labelLeader;
    if (value !== true && value !== false && value !== null && value !== undefined) {
      throw modelError("labelLeaderUnknown");
    }
    changes.labelLeader = value === true || value === false ? value : null;
  }
  // Указатель — только у комментария и только «да» или «нет». Поле у чужой
  // метки значило бы, что `markPointer` обязан разбираться, кому верить;
  // проще не дать его записать. Правится он `setMarkPointer`, а здесь стоит
  // та же стража, что у угла и поводка подписи: объект правит модель.
  if (Object.prototype.hasOwnProperty.call(changes, "pointer")) {
    const current = project.marks.find((mark) => mark.id === markId);
    if (!markIsComment(current)) throw modelError("pointerOnlyComment");
    if (changes.pointer !== true && changes.pointer !== false) throw modelError("pointerUnknown");
  }
  // Размеры приводятся к числу или к `null` здесь — второго места, где они
  // попадают в метку, нет: `setMarkDimensions` идёт через эту же функцию.
  for (const field of MARK_DIMENSION_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(changes, field)) {
      changes[field] = markDimensionValue(changes[field]);
    }
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

// ——— копия метки —————————————————————————————————————————————————————
//
// Заказчик: «копируем тип и вставляем туда, где курсор». Тип — это минимум;
// вопрос в том, что ещё переезжает в копию, и отвечает на него сам приём, ради
// которого копируют: розетку у кровати слева копируют, чтобы поставить такую же
// справа. У этой пары одинаково не только обозначение — одинаковы «Расположение»
// («у кровати»), «Комментарий» (поле `original`, G164) и высота над
// полом. Копия без них заставляла бы вписывать всё это заново, и копировать было
// бы незачем: тип и так ставится кликом.
//
// Что в копию **не** переезжает и почему:
//   — номер: нумерация сквозная, копия — новая метка со следующим номером;
//   — блок (`groupId`): блок — это соседство на плане, а копия встаёт в другом
//     месте; пришлось бы тащить за ней и подпись-перечисление;
//   — смещение, угол и поводок подписи: они про место подписи на плане, а не
//     про метку, и в новой точке ничего не значат;
//   — помещение: его проставляет автоматика по контуру в точке вставки, и
//     чужое помещение из исходной метки было бы враньём про место;
//   — «Чем управляет»: это утверждение инженера про конкретные светильники, а
//     не свойство розетки. Копия, которая молча повторяет чужие связи, дорисует
//     в таблице то, чего никто не говорил.
export const MARK_COPY_FIELDS = ["location", "original", ...MARK_DIMENSION_FIELDS];

/**
 * Снимок метки для буфера обмена.
 *
 * Именно снимок, а не ссылка: между «скопировать» и «вставить» исходную метку
 * успевают удалить, сменить ей тип или уйти на другую схему — буфер это
 * переживает. В снимке лежит форма в долях плана: у точки одна вершина, у
 * линии — вся ломаная, иначе «такая же линия» получилась бы другой формы.
 */
export function markSnapshot(project, markId) {
  const mark = requireMark(project, markId);
  const snapshot = {
    typeId: mark.typeId,
    kind: mark.kind,
    points: mark.points.map((point) => ({ x: point.x, y: point.y })),
    closed: mark.closed === true,
    location: typeof mark.location === "string" ? mark.location : "",
    original: typeof mark.original === "string" ? mark.original : "",
  };
  // Размеры читаются только через `markDimensions`: у метки из старого объекта
  // этих полей нет вовсе, и `undefined` в снимке доехал бы до копии.
  const sizes = markDimensions(mark);
  for (const field of MARK_DIMENSION_FIELDS) snapshot[field] = sizes[field];
  return snapshot;
}

/**
 * Форма метки, перенесённая так, чтобы первая вершина легла в `point`.
 *
 * Сдвиг общий на все вершины и подрезан по краям плана целиком: подрезать
 * каждую вершину порознь значило бы смять ломаную — лента по периметру комнаты,
 * вставленная у края, вышла бы другой формы.
 */
function markShapeAt(points, point) {
  const shape = normalizePoints(points);
  const target = { x: Number(point && point.x), y: Number(point && point.y) };
  if (!Number.isFinite(target.x) || !Number.isFinite(target.y)) throw modelError("noPoints");
  const from = shape[0];
  const xs = shape.map((item) => item.x);
  const ys = shape.map((item) => item.y);
  const dx = Math.min(1 - Math.max(...xs), Math.max(-Math.min(...xs), target.x - from.x));
  const dy = Math.min(1 - Math.max(...ys), Math.max(-Math.min(...ys), target.y - from.y));
  return shape.map((item) => ({ x: item.x + dx, y: item.y + dy }));
}

/**
 * Поставить копию из снимка: та же метка со следующим номером, первая вершина
 * в точке `point`.
 *
 * Схема берётся от вызывающего, а не из снимка: копию ставят и на другой лист.
 */
export function pasteMark(project, snapshot, { schemeId, point } = {}) {
  if (!snapshot || typeof snapshot !== "object") throw modelError("nothingToPaste");
  requireScheme(project, schemeId);
  requireType(project, snapshot.typeId);
  const shape = markShapeAt(snapshot.points, point);
  // Вид копии — вид исходной метки: копия комментария обязана остаться
  // комментарием, иначе текст плашки уехал бы в поле розетки.
  const kind = MARK_KINDS.includes(snapshot.kind) ? snapshot.kind : "point";
  const result = addMark(project, {
    schemeId,
    typeId: snapshot.typeId,
    kind,
    points: shape,
    // Метка «одна на блок» держит несколько точек одним номером — копия обязана
    // остаться одной меткой, а не рассыпаться на три самостоятельных.
    blockMode: kind === "point" && shape.length > 1 ? "single" : undefined,
  });
  // Правятся только поля, в которых что-то есть: копия метки без расположения
  // и размеров обязана получиться такой же, как метка, поставленная кликом.
  const patch = {};
  if (kind === "line" && snapshot.closed === true) patch.closed = true;
  for (const field of MARK_COPY_FIELDS) {
    const value = snapshot[field];
    if (value !== null && value !== undefined && value !== "") patch[field] = value;
  }
  if (Object.keys(patch).length === 0) return { project: result.project, mark: result.mark };
  const updated = updateMark(result.project, result.mark.id, patch);
  return { project: updated.project, mark: updated.mark };
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

/**
 * Свободный номер типа — следующий за наибольшим занятым и за счётчиком: тот
 * самый, что достался бы новой метке этого типа.
 *
 * Выбор между «следующий за наибольшим» и «первая дыра в ряду» решён в пользу
 * первого, и это не вкус:
 *
 * - **Дыра — не свободное место.** ADR 003 отдельно отверг переиспользование
 *   освободившихся номеров: Т7 удалённой метки уже назван вслух, напечатан на
 *   распечатке и написан в чужом письме. Займи его вторая точка — и старая
 *   бумага начинает врать молча.
 * - **Одно правило на всю сборку.** Постановка метки (`nextNumber`), смена
 *   типа и разведение номеров при слиянии (`mergeNumbers`) ищут свободный
 *   номер вверх от счётчика. Кнопка с другим правилом поссорила бы их между
 *   собой: «свободный» значило бы в разных местах разное.
 * - **«Рядом» — это и есть «следующий».** Отделяют метку из группы, которую
 *   только что поставили, а она стоит у головы нумерации: Т13 ×3 отпускает
 *   метку на Т14 — соседний номер, видный в таблице тут же. Первая дыра увела
 *   бы её на Т2 — вниз через всю таблицу и на номер, который когда-то значил
 *   другую точку.
 *
 * Цена решения: нумерация растёт, дыры остаются дырами. Смыкает их отдельная
 * ручная команда — ровно как задумано в ADR 003.
 */
export function freeMarkNumber(project, typeId) {
  const type = requireType(project, typeId);
  const number = nextNumber(project, project.counters, type.code);
  // Потолок тот же, что у ручного номера: выдать то, чего руками не поставить,
  // кнопка не вправе.
  if (number > MARK_NUMBER_MAX) throw modelError("noFreeNumber", { max: MARK_NUMBER_MAX });
  return number;
}

/**
 * Отделить метку от одинаковых: номер, которого у её типа ещё не было.
 *
 * Повтор номера — приём заказчика (три светильника под одним Т13 — одна
 * позиция в его учёте), но иногда одну метку из группы надо отделить. Искать
 * свободный номер глазами по таблице для этого не нужно.
 *
 * Поверх `setMarkNumber`, а не мимо неё: счётчик типа двигается тем же
 * правилом, а принятое «так и задумано» остаётся на месте. Оставшиеся метки
 * своего номера не меняют, ключ принятия (`repeatedNumber:<typeId>#<номер>`)
 * тот же — вопрос, на который уже ответили, не задаётся заново, и ответ не
 * теряется. Из трёх меток остаётся две — повтор никуда не делся, только стал
 * меньше.
 */
export function setMarkFreeNumber(project, markId) {
  const mark = requireMark(project, markId);
  return setMarkNumber(project, markId, freeMarkNumber(project, mark.typeId));
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

/**
 * Порядок смыкания номеров: **схема → помещение → порядок постановки**.
 *
 * Слова заказчика: «„Сомкнуть номера“ — сделай что бы метки расположенные
 * подряд были в одном помещении. То есть не просто рандомно по объекту, а то
 * сперва по одному помещению, потом по другому, и все метки так в одном
 * порядке». Раздача номеров по одному порядку постановки давала Т1 в спальне,
 * Т2 в коридоре, Т3 снова в спальне — по такой распечатке ходить нельзя.
 *
 * **Порядок помещений — их порядок в объекте** (`roomsInOrder`): этот список у
 * пользователя перед глазами и правится им же. Алфавит и «по числу меток» были
 * бы нашим порядком, а не его.
 *
 * **Схема остаётся старшим ключом.** Помещение в модели принадлежит объекту, а
 * не листу, и у сложенного руками объекта одна комната может оказаться на двух
 * этажах. Пусти помещение вперёд схемы — и на первом листе пошло бы «Т1, Т2,
 * Т3, Т5»: Т4 уехал бы на второй этаж. А лист читают целиком: и таблица меток,
 * и список сбоку, и легенда идут схема за схемой. Поэтому на каждом листе ряд
 * остаётся сплошным, а комнаты внутри листа идут в порядке списка помещений.
 * Цена решения одна: комната, размеченная на двух листах, получает два ряда
 * номеров — и это честно, они на разных листах.
 *
 * **Внутри помещения порядок не трогается** — он остаётся тем же порядком
 * постановки, что и был. Смыкание это команда про **дыры** в нумерации, а
 * пользователь просил про **группировку**; перекладывать метки внутри комнаты
 * слева направо значило бы сделать заодно то, чего не просили, и заплатить
 * дважды: такой порядок зависит от того, как повёрнут и обрезан план (тот же
 * объект после поворота ответил бы иначе), а у линии и у блока «где метка» не
 * одно число, и ради сортировки пришлось бы завести второе определение места.
 * Маршрут по комнате — это отдельная команда, и заводить её надо вслух.
 *
 * **Метка без помещения идёт в конец** — за всеми комнатами, как «Без
 * помещения» в таблицах. Такая метка чаще всего ещё не разобрана, и хвостом
 * это видно; поставь её в начало — и номера всех комнат сдвинулись бы из-за
 * недоделки. Туда же попадает метка, чьё помещение удалили: ссылка в никуда
 * — это «без помещения», и `validate` о ней говорит отдельно.
 */
export function marksInRoomOrder(project, filter) {
  const schemeOrder = new Map(schemesInOrder(project).map((scheme, index) => [scheme.id, index]));
  const roomOrder = new Map(roomsInOrder(project).map((room, index) => [room.id, index]));
  const at = (order, key) => (key && order.has(key) ? order.get(key) : Number.MAX_SAFE_INTEGER);
  return project.marks
    .map((mark, index) => ({ mark, index }))
    .filter((item) => (filter ? filter(item.mark) : true))
    .sort(
      (a, b) =>
        at(schemeOrder, a.mark.schemeId) - at(schemeOrder, b.mark.schemeId) ||
        at(roomOrder, a.mark.roomId) - at(roomOrder, b.mark.roomId) ||
        a.index - b.index,
    )
    .map((item) => item.mark);
}

// Возвращает список замен и уже уплотнённый объект; применять или нет —
// решает вызывающий: исходный project не меняется.
export function compactNumbers(project, typeId) {
  const type = requireType(project, typeId);
  const ordered = marksInRoomOrder(project, (mark) => mark.typeId === typeId);
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
  // Принятое «так и задумано» переезжает на новый номер здесь же: ответ на
  // «Т4 повторяется намеренно» обязан пережить смыкание, иначе он повиснет на
  // номере, которого больше нет, а на Т2 тот же вопрос задастся заново. Одна
  // операция — один шаг истории: отмена возвращает и номера, и принятия.
  const accepted = renumberAccepted(project, typeId, type.code, renumbered);
  const patch = { marks, counters };
  if (accepted) patch.accepted = accepted;
  return { changes, project: withProject(project, patch) };
}

/**
 * Уплотнение по всем типам разом. Правил своих нет ни одного: считает та же
 * `compactNumbers`, тип за типом по накапливающемуся объекту, — иначе окно
 * обещало бы одно, а команда делала другое.
 *
 * Тип без дыр не трогается вовсе: его нет ни в ответе, ни в объекте. Это
 * важнее, чем кажется, — `compactNumbers` заодно подтягивает счётчик типа, и
 * прогон по всем типам «на всякий случай» сбросил бы счётчики там, где
 * пользователь ничего не просил.
 *
 * Порядок — справочника (`typesInOrder`), тот же, что у легенды и таблиц.
 * Возвращает `{project, groups:[{typeId, code, name, changes}], changes}`;
 * когда уплотнять нечего, `project` — тот же объект, что пришёл.
 */
export function compactAllNumbers(project) {
  const groups = [];
  let next = project;
  let changes = 0;
  for (const { types } of typesInOrder(project)) {
    // «Сомкнуть у всех» идёт по обычным типам (G167): номер комментария не
    // видно ни на плане, ни в листах, и список замен «Коммент3 → Коммент1»
    // пользователю сверять не с чем. Нумерация комментария от этого не
    // ломается — она сквозная по своему коду и с чужой не пересекается.
    for (const type of listedTypes(project, types)) {
      const result = compactNumbers(next, type.id);
      if (result.changes.length === 0) continue;
      next = result.project;
      groups.push({ typeId: type.id, code: type.code, name: type.name, changes: result.changes });
      changes += result.changes.length;
    }
  }
  return { project: changes === 0 ? project : next, groups, changes };
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
  // Комментарии в проверку дублей не идут (G167): их номер нигде не виден —
  // ни на плане (там текст плашки), ни в списке, ни в листах, — и
  // предупреждение о повторе невидимого номера было бы шумом.
  for (const mark of listedMarks(project.marks)) {
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
//
// Сменить тип можно только внутри вида метки — слова заказчика: «у метки если
// тип линия, то только на другой тип линии можно сменить, а точки только на
// другой тип с типом точка». Точка, которой достался линейный тип, рисовалась
// бы точкой с начертанием вместо фигуры, а нарисованная ломаная — линией с
// формой, которую негде показать. Правило живёт здесь, а не в окне выбора:
// окно уже показывает только свой вид, но правку объекта стережёт модель.
// Метка прежнего объекта, у которой вид разошёлся с типом (тип точечный,
// а метка нарисована линией), под это правило не попадает: у неё меняется
// именно тип, и разрешены ей линейные — те, что подходят самой метке.
export function changeMarkType(project, markId, typeId) {
  const mark = requireMark(project, markId);
  const type = requireType(project, typeId);
  if (mark.typeId === typeId) return { project, mark };
  const kind = MARK_KINDS.includes(mark.kind) ? mark.kind : "point";
  if (typeKindOf(project, typeId) !== kind) {
    if (kind === "line") throw modelError("typeKindNotLine", { code: type.code });
    // Комментарий меняется только на другой комментарий: плашку нельзя
    // превратить в знак, не выбросив её текст, а знак в плашку — не выдумав
    // текста. Обратная сторона того же правила: обычной метке комментарий тоже
    // не достанется.
    if (kind === MARK_KIND_COMMENT) throw modelError("typeKindNotComment", { code: type.code });
    throw modelError("typeKindNotPoint", { code: type.code });
  }
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
  // Код встроенного комментария занят, хотя строки в справочнике нет: счётчик
  // номеров ведётся на код, и второй тип с тем же кодом поделил бы с плашками
  // одну нумерацию.
  if (value.toUpperCase() === commentCodeOf(project).toUpperCase()) {
    throw modelError("codeTaken", { code: value });
  }
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

// Вид типа: точка или линия. Значения те же, что у метки (`MARK_KINDS`), и
// это не совпадение — вид типа говорит, какие метки этим типом ставятся.
function checkTypeKind(kind) {
  if (!MARK_KINDS.includes(kind)) throw modelError("unknownKind");
  return kind;
}

// Число каналов на запись. Пустое поле справочника — один канал: у типа
// каналов не бывает ноль, а «не знаю» здесь означает «один».
function checkChannels(value) {
  if (value === null || value === undefined || value === "") return TYPE_CHANNELS_DEFAULT;
  const number = typeof value === "string" ? Number(value.trim()) : value;
  if (!Number.isInteger(number) || number < 1 || number > TYPE_CHANNELS_MAX) {
    throw modelError("channelsInvalid", { max: TYPE_CHANNELS_MAX });
  }
  return number;
}

/**
 * Сколько каналов у типа. У типа объекта прежнего формата поля нет — это один
 * канал, и окно «Чем управляет» у такого типа выглядит ровно как раньше.
 * Считать это самому нельзя: разойдись справочник с окном — канал спрашивали
 * бы там, где его негде показать.
 */
export function typeChannels(project, typeId) {
  const type = findType(project, typeId);
  const value = type ? type.channels : null;
  return Number.isInteger(value) && value >= 1 ? value : TYPE_CHANNELS_DEFAULT;
}

export function addType(
  project,
  {
    code,
    name,
    categoryId,
    shape = null,
    lineStyle = null,
    blockMode = "each",
    kind = "point",
    channels = TYPE_CHANNELS_DEFAULT,
  } = {},
) {
  const type = {
    id: newId(),
    categoryId,
    code: normalizeCode(code, project),
    name: normalizeName(name),
    // Вид типа: у точечного выбирается фигура, у линейного — начертание.
    // Умолчание — точка: их в разы больше, и заведённый руками тип почти
    // всегда точечный.
    kind: checkTypeKind(kind),
    shape: checkShape(shape, { allowNull: true }),
    lineStyle: checkLineStyle(lineStyle, { allowNull: true }),
    blockMode: checkBlockMode(blockMode),
    // Каналов у заведённого руками типа один: клавиша, выход, кнопка — их
    // число знает только пользователь, и умолчание не должно за него гадать.
    channels: checkChannels(channels),
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
  // Число каналов уменьшают так же легко, как увеличивают, и связи на
  // отпавшем канале при этом остаются: терять их молча нельзя — о них говорит
  // `validate` предупреждением, а решает пользователь.
  if (Object.prototype.hasOwnProperty.call(patch, "channels")) next.channels = checkChannels(patch.channels);
  // Вид, выбранный руками, больше не догадка: отметка снимается, и тип уходит
  // из списка на правку — даже если пользователь подтвердил то же самое.
  if (Object.prototype.hasOwnProperty.call(patch, "kind")) {
    next.kind = checkTypeKind(patch.kind);
    delete next.kindGuessed;
  }
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

// ——— общая база типов ————————————————————————————————————————————————
//
// Справочник у каждого объекта свой, и это правильно: на одном объекте «Р» —
// розетка, на другом её вовсе нет. Но когда в стартовый справочник добавляется
// новый тип (проходной переключатель, вывод витой пары, целая категория
// датчиков), уже размеченные объекты о нём не узнают: единственным путём был
// возврат к стандартному шаблону, а он стирает и правки пользователя.
//
// Отсюда общая база: встроенный `defaultTemplate()` плюс сохранённый
// пользователем шаблон, объединённые по коду. Один и тот же код в обоих —
// побеждает сохранённый: его правили руками. Позиция строки при этом остаётся
// от встроенного справочника, чтобы привычный порядок не перетасовывался.
//
// Хранилища модель не знает: шаблон достаёт и передаёт сюда панель.

// Ключ строки общей базы — код в верхнем регистре и без краёв. Это ключ
// строки, а **не** правило занятости кода: занятость спрашивается у
// `codeProblem`, чтобы правило кода во всей сборке оставалось одно. Своя копия
// правила здесь молча разошлась бы с `addType` — и окно предлагало бы то,
// чего справочник не примет.
function catalogRowKey(code) {
  return String(code == null ? "" : code).trim().toUpperCase();
}

function catalogSources(templates) {
  const extra = Array.isArray(templates) ? templates : templates ? [templates] : [];
  return [defaultTemplate(), ...extra].filter(
    (source) => source && Array.isArray(source.categories) && Array.isArray(source.markTypes),
  );
}

// Слияние источников в одну базу. `Map.set` по существующему ключу меняет
// значение, но не место — отсюда и правило «позиция от первого источника,
// содержимое от последнего». Форма, начертание, режим блока и цвет сверяются
// со списками модели: шаблон мог быть сохранён давно, а неизвестное значение
// объект бы не принял. Код при этом не правится: негодный код — негодная
// строка целиком, и её судьбу решает `codeProblem`, а не догадка о том, что
// пользователь имел в виду.
function catalogMerge(templates) {
  const categories = new Map();
  const types = new Map();
  for (const source of catalogSources(templates)) {
    const byId = new Map(source.categories.map((category) => [category.id, category]));
    for (const category of source.categories) {
      const key = categoryNameKey(category.name);
      if (!key) continue;
      categories.set(key, {
        name: String(category.name).trim(),
        color: normalizeColor(category.color, FALLBACK_COLOR),
        shape: SHAPE_NAMES.includes(category.shape) ? category.shape : SHAPE_PALETTE[0],
        lineStyle: LINE_STYLES.includes(category.lineStyle) ? category.lineStyle : null,
      });
    }
    for (const type of source.markTypes) {
      const key = catalogRowKey(type.code);
      const category = byId.get(type.categoryId);
      const categoryKey = category ? categoryNameKey(category.name) : "";
      if (!key || !categoryKey) continue;
      const code = String(type.code).trim();
      types.set(key, {
        key,
        code,
        name: String(type.name == null ? "" : type.name).trim() || code,
        // Шаблон мог быть сохранён до того, как у типа появился вид: без
        // умолчания строка базы приехала бы в справочник с пустым полем.
        kind: MARK_KINDS.includes(type.kind) ? type.kind : "point",
        shape: SHAPE_NAMES.includes(type.shape) ? type.shape : null,
        lineStyle: LINE_STYLES.includes(type.lineStyle) ? type.lineStyle : null,
        blockMode: BLOCK_MODES.includes(type.blockMode) ? type.blockMode : BLOCK_MODES[0],
        // Каналы едут из общей базы вместе с типом: ВВ, взятый из неё, — это
        // двухклавишный выключатель, а не «такой же, но без клавиш». Шаблон
        // мог быть сохранён до появления каналов — тогда их один.
        channels:
          Number.isInteger(type.channels) && type.channels >= 1 ? Math.min(type.channels, TYPE_CHANNELS_MAX) : TYPE_CHANNELS_DEFAULT,
        categoryKey,
      });
    }
  }
  return { categories, types };
}

// Объект, по которому спрашивают правило кода: `codeProblem` смотрит в
// `markTypes`, и объекта может ещё не быть вовсе.
function catalogTarget(project) {
  return project && Array.isArray(project.markTypes) ? project : { markTypes: [] };
}

/**
 * Что из общей базы можно добавить в справочник объекта: строки, которые
 * справочник и правда примет, сгруппированные по категориям в порядке базы.
 * Пустых групп в ответе не бывает.
 *
 * `templates` — сохранённый шаблон (или список шаблонов) поверх встроенного;
 * `null` означает «только встроенный».
 *
 * Годность строки решает `codeProblem` — та же функция, что разбирает код,
 * введённый руками. Поэтому из окна выпадают и занятые коды, и негодные:
 * шаблон, сохранённый до правила «только буквы», несёт код вида «Т1», и
 * показать его значило бы предложить то, на чём добавление споткнётся.
 *
 * Категория ответа — та, какой она станет: у знакомой объекту категории это
 * её собственные имя, цвет и форма (`existingId` — её идентификатор), у новой —
 * значения из базы. Окно рисует ровно то, что получится после добавления.
 */
export function catalogOffer(project, templates) {
  const { categories, types } = catalogMerge(templates);
  const target = catalogTarget(project);
  const groups = new Map();
  for (const [key, base] of categories) {
    const found = findCategoryByName(project, base.name);
    groups.set(key, {
      category: {
        name: found ? found.name : base.name,
        color: found ? found.color : base.color,
        shape: found ? found.shape : base.shape,
        lineStyle: (found ? found.lineStyle : base.lineStyle) || null,
        existingId: found ? found.id : null,
      },
      types: [],
    });
  }
  for (const entry of types.values()) {
    if (codeProblem(target, entry.code)) continue;
    const group = groups.get(entry.categoryKey);
    if (!group) continue;
    group.types.push({
      key: entry.key,
      code: entry.code,
      name: entry.name,
      kind: entry.kind,
      shape: entry.shape,
      lineStyle: entry.lineStyle,
      blockMode: entry.blockMode,
    });
  }
  return [...groups.values()].filter((group) => group.types.length > 0);
}

/**
 * Добавить в справочник объекта отмеченные строки общей базы. `typeKeys` —
 * ключи строк из `catalogOffer` (они же коды в любом регистре); порядок и
 * повторы значения не имеют.
 *
 * Годность каждой строки проверяется здесь заново и по живому объекту, а не
 * по тому, что показало окно: окно могло устареть, а список ключей приходит
 * снаружи. Негодная строка выпадает из пакета одна — остальные добавляются, и
 * пропущенное названо в `skipped` (`{key, code, name, reason}`, `reason` — код
 * ошибки модели). Иначе один шаблон с кодом «Т1» уносил бы весь набор, и шесть
 * годных типов терялись бы молча. Занятый код в `skipped` не попадает: это не
 * беда, а «такой тип и так есть».
 *
 * Существующее не трогается: категория, знакомая объекту по имени,
 * переиспользуется как есть — ни цвет, ни форма её не меняются. Недостающая
 * заводится вместе с первым своим типом (и убирается, если ни один его тип
 * так и не добавился). Новые типы встают в конец своей категории.
 *
 * Добавлять нечего — возвращается тот же объект: пустого шага истории быть
 * не должно.
 */
export function addTypesFromCatalog(project, templates, typeKeys) {
  const wanted = new Set([...(typeKeys || [])].map(catalogRowKey).filter(Boolean));
  const base = catalogMerge(templates);
  // Что объект знал о своём справочнике до добавления: повторы и близкие цвета,
  // которые человек уже видел, останутся видимыми, а то, что принесёт с собой
  // общая база, примется молча — знаков в ней он не выбирал.
  const known = openDictionarySubjects(project);
  let next = project;
  const types = [];
  const created = [];
  const skipped = [];
  for (const entry of base.types.values()) {
    if (!wanted.has(entry.key)) continue;
    const trouble = codeProblem(catalogTarget(next), entry.code);
    if (trouble) {
      if (trouble.code !== "codeTaken") {
        skipped.push({ key: entry.key, code: entry.code, name: entry.name, reason: trouble.code });
      }
      continue;
    }
    const source = base.categories.get(entry.categoryKey);
    if (!source) continue;
    try {
      let category = findCategoryByName(next, source.name);
      if (!category) {
        const result = addCategory(next, {
          name: source.name,
          color: source.color,
          shape: source.shape,
          lineStyle: source.lineStyle,
        });
        next = result.project;
        category = result.category;
        created.push(category);
      }
      const added = addType(next, {
        code: entry.code,
        name: entry.name,
        categoryId: category.id,
        kind: entry.kind,
        shape: entry.shape,
        lineStyle: entry.lineStyle,
        blockMode: entry.blockMode,
        channels: entry.channels,
      });
      next = added.project;
      types.push(added.type);
    } catch (failure) {
      skipped.push({ key: entry.key, code: entry.code, name: entry.name, reason: failure.code });
    }
  }
  // Категория, заведённая под тип, который так и не добавился, остаётся пустой.
  // Пустая строка в справочнике — мусор, которого пользователь не заказывал.
  const categories = [];
  for (const category of created) {
    if (next.markTypes.some((type) => type.categoryId === category.id)) {
      categories.push(category);
      continue;
    }
    next = deleteCategory(next, category.id).project;
  }
  return { project: acceptFromDictionary(next, known), types, categories, skipped };
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
  // Смещение подписи — в пикселях плана, как у метки и у блока; угол — из
  // `LABEL_ANGLES`. У контуров, размеченных до этого, полей нет вовсе: пустое
  // смещение и нулевой угол — это и есть прежняя подпись в центре контура.
  const outline = {
    id: newId(),
    schemeId,
    roomId,
    points: normalizeOutlinePoints(points),
    labelOffset: null,
    labelAngle: 0,
  };
  return { project: withProject(project, { outlines: [...outlinesOf(project), outline] }), outline };
}

const OUTLINE_PATCH_FIELDS = ["points", "roomId", "labelOffset", "labelAngle"];

export function updateOutline(project, outlineId, patch) {
  if (!findOutline(project, outlineId)) throw modelError("outlineNotFound");
  const changes = pick(patch, OUTLINE_PATCH_FIELDS);
  if (Object.prototype.hasOwnProperty.call(changes, "points")) {
    changes.points = normalizeOutlinePoints(changes.points);
  }
  if (Object.prototype.hasOwnProperty.call(changes, "roomId") && !findRoom(project, changes.roomId)) {
    throw modelError("roomNotFound");
  }
  // Угол подписи — из списка и числом, ровно как у метки: габарит и попадание
  // по клику считаются по этому же числу.
  if (Object.prototype.hasOwnProperty.call(changes, "labelAngle")) {
    if (!LABEL_ANGLES.includes(changes.labelAngle)) throw modelError("labelAngleUnknown");
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

// ——— направляющие схемы ————————————————————————————————————————————————
//
// Заказчик: «поставил 2 горизонтальных направляющих, 6 вертикальных и на
// перекрестия ставишь точки». Направляющие — рабочая оснастка, а не часть
// чертежа: на распечатку они не попадают, но лежат в объекте, потому что
// переживают перезагрузку и уезжают с файлом проекта.
//
// Живут **у схемы**: у каждого плана свои. Координата — **доля 0…1** от размера
// плана, как точки меток (ADR 002): при замене подложки они остаются там же,
// где их поставили, а не разъезжаются в пикселях.
export const GUIDE_AXES = ["h", "v"];

export function schemeGuides(project, schemeId) {
  const scheme = findScheme(project, schemeId);
  return scheme && Array.isArray(scheme.guides) ? scheme.guides : [];
}

function withGuides(project, schemeId, guides) {
  const schemes = project.schemes.map((scheme) => (scheme.id === schemeId ? { ...scheme, guides } : scheme));
  return withProject(project, { schemes });
}

export function addSchemeGuide(project, schemeId, { axis, at } = {}) {
  requireScheme(project, schemeId);
  if (!GUIDE_AXES.includes(axis)) throw modelError("guideAxisUnknown");
  const guide = { id: newId(), axis, at: clampFraction(Number(at)) };
  if (!Number.isFinite(guide.at)) throw modelError("guideAtInvalid");
  return { project: withGuides(project, schemeId, [...schemeGuides(project, schemeId), guide]), guide };
}

export function moveSchemeGuide(project, schemeId, guideId, at) {
  requireScheme(project, schemeId);
  const guides = schemeGuides(project, schemeId);
  if (!guides.some((guide) => guide.id === guideId)) throw modelError("guideNotFound");
  const value = clampFraction(Number(at));
  if (!Number.isFinite(value)) throw modelError("guideAtInvalid");
  const next = guides.map((guide) => (guide.id === guideId ? { ...guide, at: value } : guide));
  return { project: withGuides(project, schemeId, next), guide: next.find((guide) => guide.id === guideId) };
}

export function deleteSchemeGuide(project, schemeId, guideId) {
  requireScheme(project, schemeId);
  const guides = schemeGuides(project, schemeId);
  const deleted = guides.find((guide) => guide.id === guideId);
  if (!deleted) throw modelError("guideNotFound");
  return { project: withGuides(project, schemeId, guides.filter((guide) => guide.id !== guideId)), deleted };
}

// ——— масштаб плана: калибровка по отрезку ——————————————————————————————
//
// В первый день сборки заказчик сказал «масштаба и длин пока не надо» (G13),
// теперь — «давай делаем настоящий масштаб», и способ назвал сам: **калибровка
// по отрезку**. Показывают две точки на плане и говорят, сколько между ними
// метров. Это работает со сканом, с фотографией чертежа и с выгрузкой из любой
// программы — в отличие от «введите dpi», которого у фотографии нет вовсе.
//
// Масштаб живёт **у схемы**, а не у объекта: у этажей разные планы, снятые с
// разных чертежей и в разном разрешении, и общего масштаба у них не бывает.
//
// Точки калибровки хранятся **долями** плана, как точки меток (ADR 002), а не
// пикселями и не готовым «px на метр». Это и есть то, за что доли плачены:
// поворот и обрезка пересчитывают доли тем же преобразованием, что и метки,
// размер плана меняется вместе с ними — и метры остаются те же, без миграции
// и без второго места, где живёт правда о масштабе. Готовое число px/м
// приходилось бы пересчитывать на каждую правку картинки, и ошибка такого
// пересчёта врала бы молча — в метрах, по которым закупают ленту.
//
// Поля нет у схем прежней разметки, и это не ошибка: без калибровки длины
// просто не показываются, а всё остальное работает как раньше (G68).
// `FORMAT_VERSION` не поднят — отсутствие поля даёт прежний вид.

// Потолок разумного отрезка: сто километров между двумя точками одного плана
// не бывает, а опечатка в поле не должна уехать в файл масштабом.
export const PLAN_SCALE_METERS_MAX = 100000;

// Короткий отрезок калибровки. Ошибка в пару пикселей неизбежна — палец
// целится не точнее, — и она делится на длину отрезка: откалибровал по
// полуметровому проёму, получил проценты ошибки по всему плану. Мерка —
// доля диагонали плана, а не метры: промах руки задан в пикселях, и
// относительная ошибка считается в них же.
export const PLAN_SCALE_SHORT_SHARE = 0.08;

function planDiagonalPx(scheme) {
  const width = Number(scheme && scheme.width) || 0;
  const height = Number(scheme && scheme.height) || 0;
  return Math.hypot(width, height);
}

function scalePointOk(point) {
  return Boolean(point) && Number.isFinite(Number(point.x)) && Number.isFinite(Number(point.y));
}

function scaleFraction(point) {
  return { x: clampFraction(Number(point.x)), y: clampFraction(Number(point.y)) };
}

// Длина отрезка в пикселях плана: доли умножаются на размер плана — тот самый
// обратный перевод, которым рисуется всё остальное.
function planSegmentPx(scheme, a, b) {
  const width = Number(scheme && scheme.width) || 0;
  const height = Number(scheme && scheme.height) || 0;
  return Math.hypot((b.x - a.x) * width, (b.y - a.y) * height);
}

/**
 * Калибровка схемы или `null`. Читать `scheme.scale` самому нельзя: у схемы
 * прежней разметки поля нет вовсе, а испорченное (ноль метров, выродившийся
 * в точку отрезок) здесь же превращается в «масштаба нет» — это честнее, чем
 * показать длину, посчитанную из мусора.
 */
export function planScaleOf(project, schemeId) {
  const scheme = findScheme(project, schemeId);
  const raw = scheme && scheme.scale;
  if (!raw || !scalePointOk(raw.a) || !scalePointOk(raw.b)) return null;
  const meters = Number(raw.meters);
  if (!(meters > 0) || !Number.isFinite(meters)) return null;
  const a = scaleFraction(raw.a);
  const b = scaleFraction(raw.b);
  if (!(planSegmentPx(scheme, a, b) > 0)) return null;
  return { a, b, meters, setAt: raw.setAt || null };
}

// Пикселей плана на метр — то число, через которое считается любая длина.
// Ноль значит «масштаба нет»: ни одна длина наружу не выйдет.
export function planPixelsPerMeter(project, schemeId) {
  const scale = planScaleOf(project, schemeId);
  if (!scale) return 0;
  const px = planSegmentPx(findScheme(project, schemeId), scale.a, scale.b);
  return px > 0 ? px / scale.meters : 0;
}

export function planHasScale(project, schemeId) {
  return planPixelsPerMeter(project, schemeId) > 0;
}

/**
 * Размер всего плана в метрах — или `null` без калибровки. Это ещё и способ
 * проверить калибровку глазом: инженер знает, что дом по фасаду двенадцать
 * метров, и «план 12,4 × 8,6 м» подтверждает масштаб, а «124 × 86» выдаёт
 * запятую, поставленную не туда.
 */
export function planSizeMeters(project, schemeId) {
  const perMeter = planPixelsPerMeter(project, schemeId);
  if (!(perMeter > 0)) return null;
  const scheme = findScheme(project, schemeId);
  return { width: Number(scheme.width) / perMeter, height: Number(scheme.height) / perMeter };
}

// Слишком короткий отрезок калибровки. Не отказ, а повод спросить: решает
// пользователь, но молча такое проходить не должно.
export function planScaleShort(project, schemeId, { a, b } = {}) {
  const scheme = findScheme(project, schemeId);
  if (!scheme || !scalePointOk(a) || !scalePointOk(b)) return false;
  const px = planSegmentPx(scheme, scaleFraction(a), scaleFraction(b));
  const diagonal = planDiagonalPx(scheme);
  if (!(px > 0) || !(diagonal > 0)) return false;
  return px < diagonal * PLAN_SCALE_SHORT_SHARE;
}

/**
 * Калибровка: две точки плана (в долях) и расстояние между ними в метрах.
 * Метры запоминаются как сказал человек, px/м считается из них и из размера
 * плана на каждый вопрос — поэтому поворот и обрезка ничего здесь не портят.
 */
export function setPlanScale(project, schemeId, { a, b, meters } = {}) {
  const scheme = requireScheme(project, schemeId);
  if (!scalePointOk(a) || !scalePointOk(b)) throw modelError("scalePointsInvalid");
  const value = Number(meters);
  if (!Number.isFinite(value) || !(value > 0)) throw modelError("scaleMetersInvalid");
  if (value > PLAN_SCALE_METERS_MAX) throw modelError("scaleMetersTooBig", { max: PLAN_SCALE_METERS_MAX });
  const first = scaleFraction(a);
  const second = scaleFraction(b);
  // Отрезок в один пиксель плана — это не калибровка, а промах мышью:
  // масштаб из него вышел бы любым.
  if (!(planSegmentPx(scheme, first, second) >= 1)) throw modelError("scaleSegmentEmpty");
  const scale = {
    a: first,
    b: second,
    // Три знака после запятой: миллиметры в метрах, дальше — шум ввода.
    meters: Math.round(value * 1000) / 1000,
    setAt: nowIso(),
  };
  const schemes = project.schemes.map((item) => (item.id === schemeId ? { ...item, scale } : item));
  return { project: withProject(project, { schemes }), scheme: schemes.find((item) => item.id === schemeId), scale };
}

// Снятие масштаба: поле **убирается**, а не обнуляется, — схема становится
// ровно такой, какой была до калибровки.
export function clearPlanScale(project, schemeId) {
  const scheme = requireScheme(project, schemeId);
  if (!Object.prototype.hasOwnProperty.call(scheme, "scale")) {
    return { project, scheme, cleared: false };
  }
  const schemes = project.schemes.map((item) => {
    if (item.id !== schemeId) return item;
    const { scale, ...rest } = item;
    return rest;
  });
  return { project: withProject(project, { schemes }), scheme: schemes.find((item) => item.id === schemeId), cleared: true };
}

/**
 * Длина ломаной в метрах — или `null`, когда у схемы нет калибровки. Считается
 * по тем же долям, что рисуются: сумма отрезков в пикселях плана, делённая на
 * px/м. Замкнутая ломаная (лента по периметру комнаты) считается с последним
 * отрезком — тем, который возвращается в первую вершину.
 */
export function planLengthMeters(project, schemeId, points, closed = false) {
  const perMeter = planPixelsPerMeter(project, schemeId);
  if (!(perMeter > 0)) return null;
  const scheme = findScheme(project, schemeId);
  const list = (Array.isArray(points) ? points : []).filter(scalePointOk).map(scaleFraction);
  if (list.length < 2) return 0;
  let px = 0;
  for (let index = 1; index < list.length; index += 1) {
    px += planSegmentPx(scheme, list[index - 1], list[index]);
  }
  if (closed && list.length > 2) px += planSegmentPx(scheme, list[list.length - 1], list[0]);
  return px / perMeter;
}

/**
 * Длина линейной метки в метрах — главный ответ этой задачи: сколько метров
 * ленты, трека или тёплого пола заказывать. У точечной метки длины нет
 * (`null`): её «длина» в карточке — размер изделия в миллиметрах, и путать их
 * нельзя. Без калибровки — тоже `null`, и нигде ничего не показывается.
 */
export function markLengthMeters(project, markId) {
  const mark = findMark(project, markId);
  if (!mark || mark.kind !== "line") return null;
  return planLengthMeters(project, mark.schemeId, mark.points, mark.closed);
}

/**
 * Метры числом для показа: запятая десятичным разделителем, как в чертеже,
 * и не больше двух знаков — калибровка руками точнее сантиметра не бывает,
 * а третий знак обещал бы точность, которой нет. Единицу приписывает строка
 * словаря (`scale.meters`), здесь только число.
 */
export function formatMeters(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "";
  return String(Math.round(number * 100) / 100).replace(".", ",");
}

// ——— чертёж: единицы и начало координат ———————————————————————————————
//
// Требование G174: «реализуем слои… рисуем все стены с указанием толщины и
// общая высота помещения задаётся, так же возможность разместить окна, двери…
// схему эту не переводим в растр, должна быть векторная». Разбор затеи и
// ответы заказчика — в таске 122; здесь только модель, без единой кнопки.
//
// **Это вторая система координат рядом с долями плана, и граница между ними
// названа словами в ADR 008.** Коротко: доли (ADR 002) остаются у меток,
// контуров, направляющих и калибровки — они живут **по чужой картинке**;
// чертёж живёт в **целых миллиметрах** от своего начала координат, потому что
// толщина стены 0,004 доли — это не толщина, а бессмыслица, а без подложки
// долям не от чего считаться вовсе.
//
// Целые, а не дробные, нарочно: стена 3000 мм остаётся 3000 мм через любое
// число правок, и — что важнее — **совпадение концов двух стен проверяется
// равенством**, без допуска. Цепочка стен поэтому надёжный граф, а не
// «почти сходится».
//
// Все поля с миллиметрами названы с хвостом `Mm` — ровно для того, чтобы в
// коде не перепутать их с долями, у которых хвоста нет.

// Потолок координаты и длины чертежа — километр. План больше километра
// по стороне — это опечатка в поле, а не дом.
export const DRAWING_MM_MAX = 1000000;

// Толще двух метров стен не бывает: это уже не стена, а объект схемы.
export const WALL_THICKNESS_MM_MAX = 2000;

// Высоты чертежа (помещение, проём, объект) мерятся тем же потолком, что
// высота у метки, — `MARK_DIMENSION_MAX`, сто метров. Иначе «розетка на 300»
// и «потолок 2700» жили бы по разным правилам, и в одном окне рядом стояли бы
// два разных предела.

/**
 * Координата чертежа: целые миллиметры, знак любой — начало координат внутри
 * плана, и стена левее него имеет отрицательный `x`.
 *
 * Запятая принимается наравне с точкой, дробное округляется: клик по холсту
 * даёт дробные миллиметры, и округлять их надо здесь, на границе модели, а не
 * в каждом вызывающем.
 */
export function drawingMmValue(value) {
  const raw = typeof value === "string" ? value.trim().replace(",", ".") : value;
  if (raw === "" || raw === null || raw === undefined) throw modelError("drawingMmInvalid");
  const number = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(number)) throw modelError("drawingMmInvalid");
  // `|| 0` здесь не от нуля, а от **минус нуля**: `Math.round(-0.4)` даёт
  // `-0`, и такая координата сравнивалась бы с нулём неравной — а совпадение
  // концов двух стен у нас проверяется именно равенством.
  const mm = Math.round(number) || 0;
  if (Math.abs(mm) > DRAWING_MM_MAX) throw modelError("drawingMmTooBig", { max: DRAWING_MM_MAX });
  return mm;
}

/** Размер чертежа: то же, но строго больше нуля — толщина, ширина, высота. */
export function drawingPositiveMm(value) {
  const mm = drawingMmValue(value);
  if (!(mm > 0)) throw modelError("drawingMmNotPositive");
  return mm;
}

/**
 * Отступ чертежа: то же, но не меньше нуля. Ноль — значение, а не пустота:
 * у двери высота от пола равна нулю, и стереть её в «не задано» было бы
 * враньём (то же правило, что у размеров метки).
 */
export function drawingOffsetMm(value) {
  const mm = drawingMmValue(value);
  if (mm < 0) throw modelError("drawingMmNegative");
  return mm;
}

/**
 * Необязательная высота: пусто (`""`, `null`, `undefined`) — «не задано».
 * У объекта схемы это значит «во всю высоту помещения», у схемы и помещения —
 * «высота не задана».
 */
function drawingHeightMm(value) {
  if (value === null || value === undefined || (typeof value === "string" && value.trim() === "")) return null;
  const mm = drawingPositiveMm(value);
  if (mm > MARK_DIMENSION_MAX) {
    throw modelError("drawingHeightTooBig", { max: MARK_DIMENSION_MAX, unit: strings.markSizes.unit });
  }
  return mm;
}

// Четверти оборота — те же, что у правки плана (`imagePrep.ROTATION_STEPS`).
// Повторены здесь, а не взяты оттуда: модель не знает ни о картинках, ни о
// браузере, и зависеть от модуля подготовки изображений не должна.
export const PLAN_TURNS = [0, 90, 180, 270];

/**
 * Начало координат чертежа на подложке — или `null`, если чертёж к подложке не
 * привязан (её нет, её заменили, или чертёж начали рисовать без неё).
 *
 * `at` — **доля** плана (ADR 002), куда попадает точка (0, 0) чертежа;
 * `turn` — на сколько повёрнуты оси чертежа относительно осей плана, по
 * часовой, четвертями оборота.
 *
 * Почему доля, а не пиксели: поворот и обрезка пересчитывают доли тем же
 * преобразованием, что точки меток, — ровно за это доли и плачены (ADR 002).
 * Почему ещё и `turn`: перенести одну точку мало. Повернули подложку на 90° —
 * вместе с картинкой повернулись и её стены, и чертёж обязан повернуться с
 * ними, иначе нарисованная стена ляжет поперёк той, по которой её обводили.
 * Четверть оборота — целое число, поэтому поворот туда и обратно возвращает
 * ровно прежнее значение, а миллиметры стен при этом **не трогаются вовсе**.
 */
export function planOriginOf(project, schemeId) {
  const scheme = findScheme(project, schemeId);
  const raw = scheme && scheme.origin;
  if (!raw || !scalePointOk(raw.at)) return null;
  const turn = Number(raw.turn) || 0;
  return { at: { x: Number(raw.at.x), y: Number(raw.at.y) }, turn: PLAN_TURNS.includes(turn) ? turn : 0 };
}

export function setPlanOrigin(project, schemeId, { at, turn = 0 } = {}) {
  requireScheme(project, schemeId);
  if (!scalePointOk(at)) throw modelError("originPointInvalid");
  const quarter = Number(turn) || 0;
  if (!PLAN_TURNS.includes(quarter)) throw modelError("originTurnUnknown");
  // Доля **не** зажимается в 0…1, в отличие от точек меток: начало координат —
  // якорь, а не место, на которое смотрят. Прижми его к краю при обрезке — и
  // уехал бы весь чертёж целиком, все стены разом.
  const origin = { at: { x: Number(at.x), y: Number(at.y) }, turn: quarter };
  const schemes = project.schemes.map((item) => (item.id === schemeId ? { ...item, origin } : item));
  return { project: withProject(project, { schemes }), scheme: schemes.find((item) => item.id === schemeId), origin };
}

/** Снятие привязки: поле **убирается**, а не обнуляется. */
export function clearPlanOrigin(project, schemeId) {
  const scheme = requireScheme(project, schemeId);
  if (!Object.prototype.hasOwnProperty.call(scheme, "origin")) return { project, scheme, cleared: false };
  const schemes = project.schemes.map((item) => {
    if (item.id !== schemeId) return item;
    const { origin, ...rest } = item;
    return rest;
  });
  return { project: withProject(project, { schemes }), scheme: schemes.find((item) => item.id === schemeId), cleared: true };
}

// Поворот вектора на четверть оборота по часовой — в экранных осях, где `y`
// вниз. Та же арифметика, что у `imagePrep.transformOffset` для смещения
// подписи: вектор внутри картинки едет вместе с картинкой.
function turnVector(point, turn) {
  if (turn === 90) return { x: -point.y, y: point.x };
  if (turn === 180) return { x: -point.x, y: -point.y };
  if (turn === 270) return { x: point.y, y: -point.x };
  return { x: point.x, y: point.y };
}

/**
 * Мост между системами: точка чертежа (мм) в доли плана — или `null`, если
 * моста нет. Нужны обе половины: калибровка (таск 111) даёт пиксели на метр,
 * привязка — начало координат и поворот. Нет хотя бы одной — чертёж на
 * подложку не ложится, и показывать его там нельзя.
 */
export function planMmToFraction(project, schemeId, pointMm) {
  const perMeter = planPixelsPerMeter(project, schemeId);
  const origin = planOriginOf(project, schemeId);
  if (!(perMeter > 0) || !origin || !pointMm) return null;
  const scheme = findScheme(project, schemeId);
  const width = Number(scheme.width) || 0;
  const height = Number(scheme.height) || 0;
  if (!(width > 0) || !(height > 0)) return null;
  const px = turnVector(
    { x: (Number(pointMm.x) / 1000) * perMeter, y: (Number(pointMm.y) / 1000) * perMeter },
    origin.turn,
  );
  return { x: origin.at.x + px.x / width, y: origin.at.y + px.y / height };
}

/** Обратный перевод: доля плана в целые миллиметры чертежа. */
export function planFractionToMm(project, schemeId, point) {
  const perMeter = planPixelsPerMeter(project, schemeId);
  const origin = planOriginOf(project, schemeId);
  if (!(perMeter > 0) || !origin || !scalePointOk(point)) return null;
  const scheme = findScheme(project, schemeId);
  const width = Number(scheme.width) || 0;
  const height = Number(scheme.height) || 0;
  if (!(width > 0) || !(height > 0)) return null;
  const px = { x: (Number(point.x) - origin.at.x) * width, y: (Number(point.y) - origin.at.y) * height };
  const back = turnVector(px, (360 - origin.turn) % 360);
  return { x: Math.round((back.x / perMeter) * 1000), y: Math.round((back.y / perMeter) * 1000) };
}

// ——— чертёж: стены —————————————————————————————————————————————————————
//
// **Стена — один отрезок, а не полилиния.** Решение объяснено развёрнуто,
// потому что от него зависит всё остальное (таск 122, развилка 1):
//
//   — проём живёт в стене отступом от её начала. У полилинии «отступ вдоль»
//     пересекал бы углы, и проём мог бы оказаться наполовину на одной стене,
//     наполовину на другой — чего не бывает;
//   — развёртка стены, ради которой всё затевается, — это одна плоская грань,
//     то есть ровно один отрезок. Полилинию пришлось бы резать на отрезки при
//     отрисовке и заново раздавать проёмы по кускам — угадывая;
//   — толщина принадлежит куску: несущая 400 и перегородка 100 — разные стены,
//     и правка толщины одного куска полилинии требовала бы её разрезать;
//   — удаление куска из цепочки не рвёт её соседей.
//
// Полилиния при этом не потеряна: она остаётся **жестом рисования** — таск 124
// заведёт из одного росчерка цепочку стен с общими концами. Соседство
// выражено не ссылкой, а совпадением точек, и в целых миллиметрах это
// совпадение точное.
//
// Стены лежат списком **у объекта**, а не внутри схемы: по `id` их сливает
// `merge.js`, и вложенный в схему чертёж сливался бы одним куском — двое
// рисовали бы по очереди, а не вместе.

function wallsOf(project) {
  return project && Array.isArray(project.walls) ? project.walls : [];
}

/** Стены схемы. Порядок — только отсюда, своей сортировки не заводить. */
export function wallsOnScheme(project, schemeId) {
  return wallsOf(project).filter((wall) => wall.schemeId === schemeId);
}

export function findWall(project, wallId) {
  if (!wallId) return null;
  return wallsOf(project).find((wall) => wall.id === wallId) || null;
}

function requireWall(project, wallId) {
  const wall = findWall(project, wallId);
  if (!wall) throw modelError("wallNotFound");
  return wall;
}

function drawingPointMm(point) {
  if (!point || typeof point !== "object") throw modelError("drawingMmInvalid");
  return { x: drawingMmValue(point.x), y: drawingMmValue(point.y) };
}

function wallThicknessMm(value) {
  const mm = drawingPositiveMm(value);
  if (mm > WALL_THICKNESS_MM_MAX) throw modelError("wallThicknessTooBig", { max: WALL_THICKNESS_MM_MAX });
  return mm;
}

/**
 * Длина стены в целых миллиметрах. Корень из целых чисел целым не бывает,
 * поэтому округляется здесь — и в одном месте, иначе проверка «проём влез» и
 * подпись длины расходились бы на миллиметр.
 */
/**
 * Единичные векторы стены: `u` — вдоль, от `a` к `b`; `n` — **влево** от него.
 * «Влево» — то же слово, которым названа сторона открывания двери: та, что
 * слева, если идти от `a` к `b`. Ось `y` на экране растёт вниз, поэтому левая
 * нормаль это `(u.y, −u.x)`, и перевёрнут этот знак ровно здесь, в одном месте
 * на всю сборку.
 *
 * Живёт в модели, а не в отрисовке: это геометрия самой стены, и нужна она не
 * только тому, кто рисует, — развёртка считает по ней стороны и проекции.
 */
export function wallVectors(wall) {
  if (!wall) return null;
  const dx = Number(wall.bMm.x) - Number(wall.aMm.x);
  const dy = Number(wall.bMm.y) - Number(wall.aMm.y);
  const len = Math.hypot(dx, dy);
  if (!(len > 0)) return null;
  // `|| 0` — от **минус нуля**: у вертикальной стены `−dx / len` даёт `-0`, и
  // он поехал бы дальше в координаты створки (ADR 008, `drawingMmValue`).
  return {
    len,
    u: { x: dx / len || 0, y: dy / len || 0 },
    n: { x: dy / len || 0, y: -dx / len || 0 },
  };
}

/** Расстояние от точки до отрезка — в тех же миллиметрах. */
export function segmentDistanceMm(point, from, to) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = dx * dx + dy * dy;
  if (length === 0) return Math.hypot(point.x - from.x, point.y - from.y);
  let t = ((point.x - from.x) * dx + (point.y - from.y) * dy) / length;
  t = Math.min(1, Math.max(0, t));
  return Math.hypot(point.x - (from.x + t * dx), point.y - (from.y + t * dy));
}

export function wallLengthMm(wall) {
  if (!wall || !wall.aMm || !wall.bMm) return 0;
  return Math.round(Math.hypot(Number(wall.bMm.x) - Number(wall.aMm.x), Number(wall.bMm.y) - Number(wall.aMm.y)));
}

export function addWall(project, { schemeId, aMm, bMm, thicknessMm } = {}) {
  requireScheme(project, schemeId);
  const a = drawingPointMm(aMm);
  const b = drawingPointMm(bMm);
  if (a.x === b.x && a.y === b.y) throw modelError("wallPointsSame");
  const wall = { id: newId(), schemeId, aMm: a, bMm: b, thicknessMm: wallThicknessMm(thicknessMm) };
  return { project: withProject(project, { walls: [...wallsOf(project), wall] }), wall };
}

/**
 * Правка стены. Концы двигаются, толщина меняется — а проёмы остаются там,
 * где стояли: отступ отсчитывается от конца `a`, поэтому проём едет вместе со
 * стеной, как и задумано.
 *
 * Укоротить стену **под** проёмом нельзя: модель отказывает (`openingOutsideWall`).
 * Прижать проём к новому концу значило бы угадать, что человек хотел, а
 * промолчать — оставить проём, висящий в воздухе, и соврать в развёртке.
 */
export function updateWall(project, wallId, patch = {}) {
  const current = requireWall(project, wallId);
  const next = { ...current };
  if (Object.prototype.hasOwnProperty.call(patch, "aMm")) next.aMm = drawingPointMm(patch.aMm);
  if (Object.prototype.hasOwnProperty.call(patch, "bMm")) next.bMm = drawingPointMm(patch.bMm);
  if (Object.prototype.hasOwnProperty.call(patch, "thicknessMm")) next.thicknessMm = wallThicknessMm(patch.thicknessMm);
  if (next.aMm.x === next.bMm.x && next.aMm.y === next.bMm.y) throw modelError("wallPointsSame");
  const length = wallLengthMm(next);
  for (const opening of openingsInWall(project, wallId)) {
    checkOpeningFits(opening, length);
  }
  const walls = wallsOf(project).map((wall) => (wall.id === wallId ? next : wall));
  return { project: withProject(project, { walls }), wall: next };
}

/**
 * Удаление стены уносит её проёмы — они живут в ней и нигде больше, — и
 * снимает привязку к ней у меток. Метка при этом остаётся на месте: привязка
 * говорит, на какой стене розетка, а не где она на плане.
 */
export function deleteWall(project, wallId) {
  const wall = requireWall(project, wallId);
  const walls = wallsOf(project).filter((item) => item.id !== wallId);
  const openings = openingsOf(project).filter((opening) => opening.wallId !== wallId);
  const marks = project.marks.map((mark) => (mark.wallId === wallId ? withoutWallBinding(mark) : mark));
  return { project: withProject(project, { walls, openings, marks }), deleted: wall };
}

/**
 * Габарит нарисованного на схеме — в миллиметрах, или `null`, если не
 * нарисовано ничего. Это и есть «размер схемы без подложки»: `scheme.width` и
 * `height` у неё нули (подложки нет), и единственный размер, который у такой
 * схемы бывает, — размер самого чертежа.
 */
export function drawingBoundsMm(project, schemeId) {
  const points = [];
  for (const wall of wallsOnScheme(project, schemeId)) points.push(wall.aMm, wall.bMm);
  for (const object of schemeObjectsOnScheme(project, schemeId)) points.push(...schemeObjectCorners(object));
  if (points.length === 0) return null;
  const xs = points.map((point) => Number(point.x));
  const ys = points.map((point) => Number(point.y));
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);
  return { minX, minY, maxX, maxY, widthMm: maxX - minX, heightMm: maxY - minY };
}

// ——— чертёж: проёмы ———————————————————————————————————————————————————
//
// Проём — объект **на стене**, а не на плане: стена, отступ от её начала,
// ширина, высота, высота от пола, вид. Тогда он сам едет со стеной, сам
// исчезает с ней и сам встаёт в будущую развёртку; будь он самостоятельной
// фигурой на плане — пришлось бы каждый раз заново угадывать, в какой он
// стене и на каком расстоянии от её угла.
//
// **Сторона открывания двери — два независимых признака**, и четыре их
// сочетания — это ровно четыре двери, какие рисуют на плане:
//   `hinge` — петли у начала проёма (ближе к концу `a` стены) или у конца;
//   `swing` — полотно открывается на левую сторону стены или на правую, где
//   «левая» — та, что слева, если идти от `a` к `b`.
// Обе названы через **направление самой стены**, а не «внутрь/наружу»: что
// внутри, а что снаружи, модель не знает — помещения выводятся из контуров, а
// не из стен (таск 122, развилка 2), и «внутрь» пришлось бы угадывать.

export const OPENING_KINDS = ["window", "door", "opening", "arch"];
export const OPENING_KIND_DOOR = "door";
export const OPENING_HINGES = ["start", "end"];
export const OPENING_SWINGS = ["left", "right"];

function openingsOf(project) {
  return project && Array.isArray(project.openings) ? project.openings : [];
}

/** Проёмы стены по порядку вдоль неё. Порядок — только отсюда. */
export function openingsInWall(project, wallId) {
  return openingsOf(project)
    .filter((opening) => opening.wallId === wallId)
    .sort((first, second) => Number(first.atMm) - Number(second.atMm));
}

export function findOpening(project, openingId) {
  if (!openingId) return null;
  return openingsOf(project).find((opening) => opening.id === openingId) || null;
}

// Проём влез в стену: шире стены не бывает, за её конец не торчит.
function checkOpeningFits(opening, length) {
  const width = Number(opening.widthMm);
  const at = Number(opening.atMm);
  if (width > length) throw modelError("openingWiderThanWall", { opening: width, wall: length });
  if (at + width > length) throw modelError("openingOutsideWall", { from: at, to: at + width, length });
}

// Проёмы в одной стене не налезают друг на друга: дверь внахлёст с окном —
// это не чертёж, а описка, и молча пустить её значит соврать в развёртке.
function checkOpeningFree(project, opening) {
  const from = Number(opening.atMm);
  const to = from + Number(opening.widthMm);
  for (const other of openingsInWall(project, opening.wallId)) {
    if (other.id === opening.id) continue;
    const otherFrom = Number(other.atMm);
    const otherTo = otherFrom + Number(other.widthMm);
    if (from < otherTo && otherFrom < to) {
      throw modelError("openingsOverlap", { from: otherFrom, to: otherTo });
    }
  }
}

/**
 * Проём не выше помещения. Сверяется с высотой **схемы**: в какой комнате
 * стоит стена, модель не знает (стены помещениям не принадлежат), поэтому
 * переопределённая высота комнаты здесь не участвует, а высоты у схемы может
 * не быть вовсе — тогда и сверять нечего.
 */
function checkOpeningHeight(project, wall, opening) {
  const height = Number(wallHeightOf(project, { schemeId: wall.schemeId })) || 0;
  if (!(height > 0)) return;
  const top = Number(opening.heightAboveFloorMm) + Number(opening.heightMm);
  if (top > height) throw modelError("openingAboveHeight", { top, height });
}

function openingDoorFields(kind, patch, current) {
  const has = (key) => patch && Object.prototype.hasOwnProperty.call(patch, key);
  const value = (key) => (has(key) ? patch[key] : current ? current[key] : undefined);
  if (kind !== OPENING_KIND_DOOR) {
    // Сторона открывания у окна и у арки не значит ничего: полотна нет.
    if ((has("hinge") && patch.hinge != null) || (has("swing") && patch.swing != null)) {
      throw modelError("openingSwingOnlyDoor");
    }
    return {};
  }
  const hinge = value("hinge") == null ? OPENING_HINGES[0] : value("hinge");
  const swing = value("swing") == null ? OPENING_SWINGS[0] : value("swing");
  if (!OPENING_HINGES.includes(hinge)) throw modelError("openingHingeUnknown");
  if (!OPENING_SWINGS.includes(swing)) throw modelError("openingSwingUnknown");
  return { hinge, swing };
}

export function addOpening(project, { wallId, kind, atMm, widthMm, heightMm, heightAboveFloorMm = 0, hinge, swing } = {}) {
  const wall = requireWall(project, wallId);
  if (!OPENING_KINDS.includes(kind)) throw modelError("openingKindUnknown");
  const height = drawingHeightMm(heightMm);
  if (height === null) throw modelError("drawingMmNotPositive");
  const opening = {
    id: newId(),
    wallId,
    kind,
    atMm: drawingOffsetMm(atMm),
    widthMm: drawingPositiveMm(widthMm),
    heightMm: height,
    heightAboveFloorMm: drawingOffsetMm(heightAboveFloorMm),
    ...openingDoorFields(kind, { hinge, swing }, null),
  };
  checkOpeningFits(opening, wallLengthMm(wall));
  checkOpeningFree(project, opening);
  checkOpeningHeight(project, wall, opening);
  return { project: withProject(project, { openings: [...openingsOf(project), opening] }), opening };
}

export function updateOpening(project, openingId, patch = {}) {
  const current = findOpening(project, openingId);
  if (!current) throw modelError("openingNotFound");
  const wall = requireWall(project, current.wallId);
  const next = { ...current };
  if (Object.prototype.hasOwnProperty.call(patch, "kind")) {
    if (!OPENING_KINDS.includes(patch.kind)) throw modelError("openingKindUnknown");
    next.kind = patch.kind;
  }
  if (Object.prototype.hasOwnProperty.call(patch, "atMm")) next.atMm = drawingOffsetMm(patch.atMm);
  if (Object.prototype.hasOwnProperty.call(patch, "widthMm")) next.widthMm = drawingPositiveMm(patch.widthMm);
  if (Object.prototype.hasOwnProperty.call(patch, "heightMm")) {
    const height = drawingHeightMm(patch.heightMm);
    if (height === null) throw modelError("drawingMmNotPositive");
    next.heightMm = height;
  }
  if (Object.prototype.hasOwnProperty.call(patch, "heightAboveFloorMm")) {
    next.heightAboveFloorMm = drawingOffsetMm(patch.heightAboveFloorMm);
  }
  // Стала дверью — у неё появилась сторона открывания; перестала — поля
  // убираются, а не остаются лежать соврать в развёртке.
  delete next.hinge;
  delete next.swing;
  Object.assign(next, openingDoorFields(next.kind, patch, current));
  checkOpeningFits(next, wallLengthMm(wall));
  checkOpeningFree(project, next);
  checkOpeningHeight(project, wall, next);
  const openings = openingsOf(project).map((opening) => (opening.id === openingId ? next : opening));
  return { project: withProject(project, { openings }), opening: next };
}

export function deleteOpening(project, openingId) {
  const opening = findOpening(project, openingId);
  if (!opening) throw modelError("openingNotFound");
  const openings = openingsOf(project).filter((item) => item.id !== openingId);
  return { project: withProject(project, { openings }), deleted: opening };
}

// ——— чертёж: объекты схемы —————————————————————————————————————————————
//
// Заказчик просил «другие основные объекты для схемы дома» и список велел
// придумать. Вместо того чтобы кодить каждый вид отдельно, здесь **один
// механизм**: объект схемы — это габарит на полу с размерами в миллиметрах и
// видом из своего справочника, а справочник пополняется как справочник типов
// меток, а не правкой кода.
//
// Имя в коде — `schemeObject`, никогда просто `object`: «объектом» во всём
// инструменте называется сам размеченный проект, и короткое имя читалось бы
// как он.
//
// Две формы, и обе нужны:
//   `rect` — середина, ширина, глубина и поворот. Так габарит **набирают**:
//     радиатор 1200 × 80 вписывают числами, а не обводят мышью. Середина, а
//     не угол, потому что поворот вокруг середины оставляет вещь там, где её
//     поставили, и «радиатор по центру окна» — это про середину;
//   `polyline` — ломаная и ширина полосы. Так задают кухонный фронт, короб и
//     лестничный марш: длина идёт по стене с поворотом, а глубина одна.
//
// Высота необязательна: у колонны, ниши и короба она «во всю высоту
// помещения», и выдумывать ей число — врать. Высота от пола, наоборот, всегда
// есть и по умолчанию нулевая: вещь стоит на полу.
//
// Два вида из списка — самые ценные для электрика, и размеры выражают именно
// то, ради чего они заведены: у **радиатора** есть высота от пола и высота
// (он висит под окном ровно там, где хочется розетка), у **столешницы** верх
// считается как `heightAboveFloorMm + heightMm` (`schemeObjectTopMm`) — это и
// есть та высота, от которой отмеряют розетки над ней.

export const SCHEME_OBJECT_SHAPES = ["rect", "polyline"];

// Стартовый набор видов: список заказчика плюс придуманное, утверждён в
// таске 122. Порядок — порядок справочника.
const TEMPLATE_SCHEME_OBJECT_KINDS = [
  "column",
  "niche",
  "duct",
  "stairs",
  "panel",
  "radiator",
  "counter",
  "plumbing",
  "cabinet",
];

// Свежие идентификаторы на каждый вызов — как у `defaultTemplate`: два объекта
// не должны делить id справочника.
export function schemeObjectKindTemplate() {
  return TEMPLATE_SCHEME_OBJECT_KINDS.map((key, index) => ({
    id: newId(),
    name: strings.schemeObjectKinds[key] || key,
    order: index,
  }));
}

// Справочник объекта прежней разметки пуст, и это не ошибка: чертежа у него
// нет, значит и видов ему не нужно. Заводится он `ensureSchemeObjectKinds` —
// при первой правке чертежа, а не при открытии (G68).
function schemeObjectKindsOf(project) {
  return project && Array.isArray(project.schemeObjectKinds) ? project.schemeObjectKinds : [];
}

export function schemeObjectKindsInOrder(project) {
  return schemeObjectKindsOf(project)
    .map((item, index) => ({ item, order: item.order == null ? index : item.order, index }))
    .sort((a, b) => (a.order === b.order ? a.index - b.index : a.order - b.order))
    .map((entry) => entry.item);
}

export function findSchemeObjectKind(project, kindId) {
  if (!kindId) return null;
  return schemeObjectKindsOf(project).find((item) => item.id === kindId) || null;
}

/**
 * Завести справочник видов, если его ещё нет. Отдельная команда, а не
 * дописывание при открытии: объект, которого не трогали, обязан остаться
 * прежним байт в байт (G68), а стартовый набор нужен ровно в ту минуту, когда
 * человек впервые ставит объект на чертёж.
 *
 * Заводить нечего — возвращается **тот же** объект по ссылке: ни `updatedAt`,
 * ни шага истории.
 */
export function ensureSchemeObjectKinds(project) {
  if (schemeObjectKindsOf(project).length > 0) return { project, added: false };
  return { project: withProject(project, { schemeObjectKinds: schemeObjectKindTemplate() }), added: true };
}

export function addSchemeObjectKind(project, { name } = {}) {
  const item = { id: newId(), name: normalizeName(name), order: schemeObjectKindsOf(project).length };
  return {
    project: withProject(project, { schemeObjectKinds: [...schemeObjectKindsOf(project), item] }),
    schemeObjectKind: item,
  };
}

export function updateSchemeObjectKind(project, kindId, patch = {}) {
  const current = findSchemeObjectKind(project, kindId);
  if (!current) throw modelError("schemeObjectKindNotFound");
  const next = { ...current };
  if (Object.prototype.hasOwnProperty.call(patch, "name")) next.name = normalizeName(patch.name);
  if (Object.prototype.hasOwnProperty.call(patch, "order")) next.order = patch.order;
  const schemeObjectKinds = schemeObjectKindsOf(project).map((item) => (item.id === kindId ? next : item));
  return { project: withProject(project, { schemeObjectKinds }), schemeObjectKind: next };
}

export function schemeObjectKindUsage(project, kindId) {
  return schemeObjectsOf(project).filter((object) => object.kindId === kindId).length;
}

// Вид с объектами не удаляется молча: у объекта осталась бы ссылка в никуда, а
// вид у него обязателен — безымянный прямоугольник на чертеже не значит ничего.
export function deleteSchemeObjectKind(project, kindId) {
  const item = findSchemeObjectKind(project, kindId);
  if (!item) throw modelError("schemeObjectKindNotFound");
  const used = schemeObjectKindUsage(project, kindId);
  if (used > 0) throw modelError("schemeObjectKindInUse", { name: item.name, count: used });
  const schemeObjectKinds = schemeObjectKindsOf(project)
    .filter((entry) => entry.id !== kindId)
    .map((entry, index) => ({ ...entry, order: index }));
  return { project: withProject(project, { schemeObjectKinds }), deleted: item };
}

function schemeObjectsOf(project) {
  return project && Array.isArray(project.schemeObjects) ? project.schemeObjects : [];
}

/** Объекты схемы. Порядок — только отсюда. */
export function schemeObjectsOnScheme(project, schemeId) {
  return schemeObjectsOf(project).filter((object) => object.schemeId === schemeId);
}

export function findSchemeObject(project, objectId) {
  if (!objectId) return null;
  return schemeObjectsOf(project).find((object) => object.id === objectId) || null;
}

function schemeObjectTurnDeg(value) {
  const number = Number(value === "" || value === null || value === undefined ? 0 : value);
  if (!Number.isFinite(number)) throw modelError("schemeObjectTurnInvalid");
  return ((Math.round(number) % 360) + 360) % 360;
}

/**
 * Верх объекта над полом — высота от пола плюс своя высота, или `null`, если
 * высота не задана («во всю высоту помещения»). Ради столешницы и заведено:
 * розетки над кухонным фронтом отмеряют именно от этого числа.
 */
export function schemeObjectTopMm(object) {
  if (!object || typeof object.heightMm !== "number") return null;
  return Number(object.heightAboveFloorMm || 0) + Number(object.heightMm);
}

// Углы габарита в миллиметрах: ими считается размер чертежа и по ним он
// рисуется. У прямоугольника это четыре повёрнутых угла, у ломаной — её
// вершины (полоса шириной `depthMm` ложится по ним).
export function schemeObjectCorners(object) {
  if (!object) return [];
  if (object.shape === "polyline") return (object.pointsMm || []).map((point) => ({ x: Number(point.x), y: Number(point.y) }));
  const at = object.atMm || { x: 0, y: 0 };
  const halfWidth = Number(object.widthMm) / 2;
  const halfDepth = Number(object.depthMm) / 2;
  const angle = ((Number(object.turnDeg) || 0) * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return [
    [-halfWidth, -halfDepth],
    [halfWidth, -halfDepth],
    [halfWidth, halfDepth],
    [-halfWidth, halfDepth],
  ].map(([x, y]) => ({
    x: Math.round(Number(at.x) + x * cos - y * sin),
    y: Math.round(Number(at.y) + x * sin + y * cos),
  }));
}

function schemeObjectShapeFields(shape, source, current) {
  const has = (key) => source && Object.prototype.hasOwnProperty.call(source, key);
  const value = (key) => (has(key) ? source[key] : current ? current[key] : undefined);
  if (shape === "polyline") {
    const raw = value("pointsMm");
    const points = Array.isArray(raw) ? raw.map(drawingPointMm) : [];
    if (points.length < 2) throw modelError("schemeObjectShortLine");
    return { pointsMm: points, depthMm: drawingPositiveMm(value("depthMm")) };
  }
  return {
    atMm: drawingPointMm(value("atMm")),
    widthMm: drawingPositiveMm(value("widthMm")),
    depthMm: drawingPositiveMm(value("depthMm")),
    turnDeg: schemeObjectTurnDeg(value("turnDeg")),
  };
}

export function addSchemeObject(project, { schemeId, kindId, shape = "rect", heightMm, heightAboveFloorMm = 0, ...rest } = {}) {
  requireScheme(project, schemeId);
  if (!findSchemeObjectKind(project, kindId)) throw modelError("schemeObjectKindNotFound");
  if (!SCHEME_OBJECT_SHAPES.includes(shape)) throw modelError("schemeObjectShapeUnknown");
  const object = {
    id: newId(),
    schemeId,
    kindId,
    shape,
    ...schemeObjectShapeFields(shape, rest, null),
    heightMm: drawingHeightMm(heightMm),
    heightAboveFloorMm: drawingOffsetMm(heightAboveFloorMm),
  };
  return { project: withProject(project, { schemeObjects: [...schemeObjectsOf(project), object] }), schemeObject: object };
}

export function updateSchemeObject(project, objectId, patch = {}) {
  const current = findSchemeObject(project, objectId);
  if (!current) throw modelError("schemeObjectNotFound");
  const shape = Object.prototype.hasOwnProperty.call(patch, "shape") ? patch.shape : current.shape;
  if (!SCHEME_OBJECT_SHAPES.includes(shape)) throw modelError("schemeObjectShapeUnknown");
  if (Object.prototype.hasOwnProperty.call(patch, "kindId") && !findSchemeObjectKind(project, patch.kindId)) {
    throw modelError("schemeObjectKindNotFound");
  }
  const next = {
    id: current.id,
    schemeId: current.schemeId,
    kindId: Object.prototype.hasOwnProperty.call(patch, "kindId") ? patch.kindId : current.kindId,
    shape,
    ...schemeObjectShapeFields(shape, patch, current.shape === shape ? current : null),
    heightMm: Object.prototype.hasOwnProperty.call(patch, "heightMm")
      ? drawingHeightMm(patch.heightMm)
      : current.heightMm,
    heightAboveFloorMm: Object.prototype.hasOwnProperty.call(patch, "heightAboveFloorMm")
      ? drawingOffsetMm(patch.heightAboveFloorMm)
      : current.heightAboveFloorMm,
  };
  const schemeObjects = schemeObjectsOf(project).map((object) => (object.id === objectId ? next : object));
  return { project: withProject(project, { schemeObjects }), schemeObject: next };
}

export function deleteSchemeObject(project, objectId) {
  const object = findSchemeObject(project, objectId);
  if (!object) throw modelError("schemeObjectNotFound");
  const schemeObjects = schemeObjectsOf(project).filter((item) => item.id !== objectId);
  return { project: withProject(project, { schemeObjects }), deleted: object };
}

// ——— чертёж: высота помещения ——————————————————————————————————————————
//
// Заказчик: «Задаётся общая высота, но у помещений можно менять и задавать
// свою». Общая живёт **у схемы**, а не у объекта: схема — это этаж, а у
// подвала, первого этажа и мансарды высота разная, и одно число на весь дом
// было бы неверным с первой же минуты — его пришлось бы перебивать по каждой
// комнате, ровно от чего переопределение и спасает. К тому же стены лежат на
// схеме, и высоту стены находят, не выходя из её схемы.
//
// У помещения — необязательное переопределение. Поля нет ни у схем, ни у
// комнат прежней разметки: читают высоту только через `wallHeightOf`, и
// отсутствие приходит честным `null`.

export function wallHeightOf(project, { schemeId, roomId } = {}) {
  const room = roomId ? findRoom(project, roomId) : null;
  if (room && typeof room.wallHeightMm === "number") return room.wallHeightMm;
  const scheme = schemeId ? findScheme(project, schemeId) : null;
  if (scheme && typeof scheme.wallHeightMm === "number") return scheme.wallHeightMm;
  return null;
}

// Снижать высоту под уже стоящим проёмом модель не даёт: промолчать значило бы
// оставить окно выше потолка, а прижать его — угадать за человека.
function checkHeightOverOpenings(project, schemeId, height) {
  if (!(height > 0)) return;
  for (const wall of wallsOnScheme(project, schemeId)) {
    for (const opening of openingsInWall(project, wall.id)) {
      const top = Number(opening.heightAboveFloorMm) + Number(opening.heightMm);
      if (top > height) throw modelError("openingAboveHeight", { top, height });
    }
  }
}

export function setSchemeWallHeight(project, schemeId, value) {
  const scheme = requireScheme(project, schemeId);
  const height = drawingHeightMm(value);
  if (height !== null) checkHeightOverOpenings(project, schemeId, height);
  if (height === null && !Object.prototype.hasOwnProperty.call(scheme, "wallHeightMm")) {
    return { project, scheme, changed: false };
  }
  const schemes = project.schemes.map((item) => {
    if (item.id !== schemeId) return item;
    if (height === null) {
      const { wallHeightMm, ...rest } = item;
      return rest;
    }
    return { ...item, wallHeightMm: height };
  });
  return { project: withProject(project, { schemes }), scheme: schemes.find((item) => item.id === schemeId), changed: true };
}

export function setRoomWallHeight(project, roomId, value) {
  const room = findRoom(project, roomId);
  if (!room) throw modelError("roomNotFound");
  const height = drawingHeightMm(value);
  if (height === null && !Object.prototype.hasOwnProperty.call(room, "wallHeightMm")) {
    return { project, room, changed: false };
  }
  const rooms = project.rooms.map((item) => {
    if (item.id !== roomId) return item;
    if (height === null) {
      const { wallHeightMm, ...rest } = item;
      return rest;
    }
    return { ...item, wallHeightMm: height };
  });
  return { project: withProject(project, { rooms }), room: rooms.find((item) => item.id === roomId), changed: true };
}

// ——— чертёж: метка на стене ————————————————————————————————————————————
//
// Для развёртки стены надо знать, **какие метки на этой стене и на какой
// высоте**. Высота у метки уже есть (G118), привязки к стене не было.
//
// Привязка **необязательна** и пустой бывает чаще, чем заполненной: потолочный
// светильник посреди комнаты стены не имеет и иметь не должен. В этом таске
// только поле и его чтение с записью; проставлять её автоматически при
// постановке метки — таск 127.
//
// Чего здесь сознательно нет: **стороны стены**. Для развёртки она нужна, но
// выводится из места метки в ту же минуту, когда привязка проставляется
// автоматикой, — то есть в таске 127, где привязка и записывается. Сторону
// открывания двери, наоборот, не вывести никогда, поэтому она заведена сразу.

function withoutWallBinding(mark) {
  const { wallId, wallAtMm, wallToMm, ...rest } = mark;
  return rest;
}

/**
 * Привязка метки к стене — `{wallId, atMm}` или `null`. Читать поля самому
 * нельзя: у метки прежней разметки их нет вовсе, и отсутствие обязано
 * приходить тем же `null`, что и снятая привязка.
 */
export function markWall(mark) {
  if (!mark || typeof mark.wallId !== "string" || !mark.wallId) return null;
  return {
    wallId: mark.wallId,
    atMm: typeof mark.wallAtMm === "number" ? mark.wallAtMm : 0,
    // **Линия привязывается отрезком, а не точкой** (дыра, найденная таском
    // 128): лента вдоль стены — обычное дело у этого заказчика, и одним
    // отступом её не назвать. `toMm` есть только у линии; у точки он `null`, и
    // у метки прежней разметки поля нет вовсе.
    toMm: typeof mark.wallToMm === "number" ? mark.wallToMm : null,
  };
}

/**
 * Привязать метку к стене или снять привязку (`null`). Снятие **убирает**
 * поля, а не обнуляет их: метка без привязки и метка со снятой привязкой
 * обязаны читаться одинаково, иначе упаковка дописала бы старой метке поля,
 * которых в ней не было (G68).
 */
export function setMarkWall(project, markId, binding) {
  const mark = requireMark(project, markId);
  if (binding === null || binding === undefined) {
    if (!markWall(mark)) return { project, mark, changed: false };
    const marks = project.marks.map((item) => (item.id === markId ? withoutWallBinding(item) : item));
    return { project: withProject(project, { marks }), mark: marks.find((item) => item.id === markId), changed: true };
  }
  const wall = requireWall(project, binding.wallId);
  if (wall.schemeId !== mark.schemeId) throw modelError("wallOtherScheme");
  const at = drawingOffsetMm(binding.atMm);
  const length = wallLengthMm(wall);
  if (at > length) throw modelError("markWallAtOutside", { at, length });
  const next = { ...mark, wallId: wall.id, wallAtMm: at };
  delete next.wallToMm;
  if (binding.toMm !== null && binding.toMm !== undefined) {
    const to = drawingOffsetMm(binding.toMm);
    if (to > length) throw modelError("markWallAtOutside", { at: to, length });
    next.wallToMm = to;
  }
  const marks = project.marks.map((item) => (item.id === markId ? next : item));
  return { project: withProject(project, { marks }), mark: marks.find((item) => item.id === markId), changed: true };
}

// ——— автопривязка метки к стене ———————————————————————————————————————
//
// Ради этого затевалась вся модель чертежа (таск 122, вопрос 3): у розетки
// появляется стена, расстояние вдоль неё и высота над полом — всё, из чего
// рисуется развёртка. Без привязки развёртка оказалась бы работой по
// угадыванию «какая розетка к какой стене ближе», и угадывать пришлось бы
// каждый раз заново.
//
// **Ставится она сама, по месту метки, и только так.** Кнопки «привязать» нет
// и не будет: человек ставит розетки, а не ведёт учёт стен. Ручного
// переопределения (как `roomManual` у помещения) здесь тоже нет — его и не
// было в договоре таска 123: «привязку проставляет автоматика по месту метки,
// а не рука человека». Поэтому привязка всегда равна тому, что видно на
// плане, и расходиться с ним не может.
//
// **Порог — в миллиметрах чертежа, а не в пикселях экрана.** Пиксели привычнее
// руке, но привязка пересчитывается на каждой правке объекта, а масштаб
// экрана в эту минуту может быть любым: та же метка привязывалась бы или нет
// в зависимости от того, насколько человек приблизил план. Данные зависели бы
// от взгляда — ровно то, чего в этой сборке нет нигде.
//
// Триста миллиметров **от грани стены** (то есть сверх половины её толщины):
// розетка рисуется точкой у стены и часто чуть внутри комнаты — подрозетник
// выступает, а за радиатором в сотне миллиметров от стены розетка всё ещё на
// стене. Полметра было бы много: в комнате три метра до середины, и метка
// посреди неё не должна считаться настенной.
export const MARK_WALL_REACH_MM = 300;

/**
 * Привязывается ли метка к стене вообще.
 *
 * Только **точка**. У линии два конца, и одним числом `wallAtMm` не сказать,
 * где она на стене: лента вдоль стены — это отрезок развёртки, а поля под
 * отрезок в модели нет. Плашка комментария — надпись на чертеже, а не
 * изделие, и на развёртке ей места нет тем более.
 */
export function markWallBindable(mark) {
  if (!mark) return false;
  // Плашка комментария — надпись на чертеже, а не изделие: на развёртке ей
  // места нет. Линия, наоборот, привязывается — отрезком (`wallToMm`), и это
  // закрытая дыра таска 128: лента вдоль стены у этого заказчика обычное дело,
  // пять линейных типов в стартовом справочнике.
  return !markIsComment(mark);
}

// Точки метки в миллиметрах чертежа — или пусто, если моста нет (ADR 008:
// нужны и калибровка, и привязка чертежа к плану).
function markPointsMm(project, mark) {
  const points = Array.isArray(mark.points) ? mark.points : [];
  const out = [];
  for (const point of points) {
    const at = planFractionToMm(project, mark.schemeId, point);
    if (!at) return [];
    out.push(at);
  }
  return out;
}

function markPointMm(project, mark) {
  const points = markPointsMm(project, mark);
  return points.length > 0 ? points[0] : null;
}

// Середина метки: у точки она же, у линии — середина её габарита.
function markMiddleMm(project, mark) {
  const points = markPointsMm(project, mark);
  if (points.length === 0) return null;
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  return { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
}

/**
 * С какой стороны стены стоит метка: `"left"` — та, что слева, если идти от
 * конца `a` к концу `b`, `"right"` — противоположная. То же слово и та же
 * сторона, что у стороны открывания двери (ADR 008): других сторон у стены
 * модель не знает, и заводить вторую систему названий нельзя.
 *
 * **Не хранится, а считается.** Сторона — чистая производная места метки и
 * геометрии стены, и обе уже лежат в объекте. Храни её — и она начала бы врать
 * при первом же переносе метки или стены, как врал бы незачем пересчитанный
 * `wallAtMm`; лишнее поле в каждой привязанной метке файл тоже не красит.
 *
 * `null` — метка стоит ровно на оси стены, и стороны у неё нет. Случай
 * вырожденный (доли плана — дробные, точное попадание на ось почти
 * невозможно), но врать в нём «слева» нельзя: на развёртке это была бы
 * розетка не на той стене.
 */
export function markWallSide(project, mark) {
  const binding = markWall(mark);
  if (!binding) return null;
  const wall = findWall(project, binding.wallId);
  // У линии сторону решает её середина: концы ленты лежат у самой стены, и
  // первый из них может оказаться по другую сторону от оси на миллиметр.
  const at = wall ? markMiddleMm(project, mark) : null;
  if (!wall || !at) return null;
  const dx = Number(wall.bMm.x) - Number(wall.aMm.x);
  const dy = Number(wall.bMm.y) - Number(wall.aMm.y);
  const len = Math.hypot(dx, dy);
  if (!(len > 0)) return null;
  // Левая нормаль в экранных осях (`y` вниз) — `(u.y, −u.x)`, та же, что у
  // стороны открывания двери.
  const side = ((at.x - wall.aMm.x) * dy - (at.y - wall.aMm.y) * dx) / len;
  if (side === 0) return null;
  return side > 0 ? "left" : "right";
}

/**
 * Ближайшая стена под меткой — или `null`, если ни одна не ближе порога.
 * Спорят стены расстоянием до **грани**: короб из двух перегородок в
 * полуметре друг от друга иначе забирал бы метку то одной, то другой.
 */
export function markWallNear(project, mark, walls) {
  if (!markWallBindable(mark)) return null;
  const list = walls || wallsOnScheme(project, mark.schemeId);
  if (list.length === 0) return null;
  const points = markPointsMm(project, mark);
  if (points.length === 0) return null;
  let best = null;
  for (const wall of list) {
    const vectors = wallVectors(wall);
    if (!vectors) continue;
    const half = Number(wall.thicknessMm) / 2;
    let worst = 0;
    const along = [];
    for (const at of points) {
      const distance = Math.min(
        vectors.len,
        Math.max(0, (at.x - wall.aMm.x) * vectors.u.x + (at.y - wall.aMm.y) * vectors.u.y),
      );
      along.push(distance);
      const foot = {
        x: wall.aMm.x + vectors.u.x * distance,
        y: wall.aMm.y + vectors.u.y * distance,
      };
      worst = Math.max(worst, Math.hypot(at.x - foot.x, at.y - foot.y) - half);
    }
    // **У линии к стене обязаны быть близко все вершины.** Лента, которая
    // идёт вдоль стены и уходит в комнату, на этой стене не лежит, и отрезок
    // «от и до» по ней соврал бы.
    if (worst > MARK_WALL_REACH_MM) continue;
    if (best && worst >= best.gap) continue;
    best = {
      gap: worst,
      wallId: wall.id,
      atMm: Math.round(along[0]),
      toMm: points.length > 1 ? Math.round(along[along.length - 1]) : null,
    };
  }
  if (!best) return null;
  return {
    wallId: best.wallId,
    atMm: best.atMm,
    toMm: best.toMm,
    gapMm: Math.round(Math.max(0, best.gap)),
  };
}

/**
 * Довести привязки меток до того, что видно на плане. Зовётся из
 * `canvasCommit` на каждой правке объекта — тем же путём, что автопривязка
 * помещения по контуру, и по той же причине: привязка обязана быть следствием
 * места метки, а не отдельного действия.
 *
 * **Что происходит при правке стены**, решается этим же вызовом и поэтому не
 * нуждается в отдельном правиле: стену подвинули — расстояние вдоль неё
 * пересчиталось; стену увели далеко — привязка снялась; стену укоротили так,
 * что метка осталась за её концом дальше порога, — снялась тоже. Метка не
 * может молча оказаться «на стене» в полуметре от неё: правило одно, и
 * проверяется оно после каждой правки.
 *
 * У объекта без чертежа не делается **ничего**: схем со стенами нет, и тот же
 * объект возвращается по ссылке (G68).
 */
export function applyMarkWalls(project, schemeId) {
  const changed = [];
  const byScheme = new Map();
  const wallsOf = (id) => {
    if (!byScheme.has(id)) byScheme.set(id, wallsOnScheme(project, id));
    return byScheme.get(id);
  };
  const marks = project.marks.map((mark) => {
    if (schemeId && mark.schemeId !== schemeId) return mark;
    if (!markWallBindable(mark)) return mark;
    const walls = wallsOf(mark.schemeId);
    if (walls.length === 0) return mark;
    const next = markWallNear(project, mark, walls);
    const now = markWall(mark);
    if (!next) {
      if (!now) return mark;
      changed.push(mark.id);
      return withoutWallBinding(mark);
    }
    if (now && now.wallId === next.wallId && now.atMm === next.atMm && now.toMm === next.toMm) return mark;
    changed.push(mark.id);
    const bound = { ...mark, wallId: next.wallId, wallAtMm: next.atMm };
    if (next.toMm === null) delete bound.wallToMm;
    else bound.wallToMm = next.toMm;
    return bound;
  });
  if (changed.length === 0) return { project, changed };
  return { project: withProject(project, { marks }), changed };
}

/**
 * Попала ли метка в проём — и в какой. Та самая проверка, ради которой
 * заказчик просил чертёж на холсте: розетка в дверном проёме на монтаже стоит
 * дорого.
 *
 * Вдоль стены пересечение считается точно: отступ проёма и его ширина
 * известны. По высоте правило зависит от самого проёма, и это не осторожность,
 * а то, как оно и есть:
 *
 *   — проём **от пола** (дверь, арка, проём без полотна) перекрывает стену во
 *     всю её полосу, и высота метки не меняет ничего — розетке там не место
 *     при любой высоте, даже если её не записали;
 *   — проём **над полом** (окно) мешает только тому, что попадает в него по
 *     высоте. Розетка под подоконником — обычное дело, и ругаться на неё
 *     значило бы приучить закрывать панель не глядя. Высота метки не задана —
 *     сказать нечего, и мы молчим.
 */
export function markOpeningHit(project, mark) {
  const binding = markWall(mark);
  if (!binding) return null;
  const wall = findWall(project, binding.wallId);
  if (!wall) return null;
  const height = markDimensions(mark).heightAboveFloor;
  for (const opening of openingsInWall(project, wall.id)) {
    const from = Number(opening.atMm);
    const to = from + Number(opening.widthMm);
    if (binding.atMm < from || binding.atMm > to) continue;
    const floor = Number(opening.heightAboveFloorMm) || 0;
    if (floor === 0) return opening;
    if (height === null) continue;
    if (height >= floor && height <= floor + Number(opening.heightMm)) return opening;
  }
  return null;
}

// ——— развёртка стены ———————————————————————————————————————————————————
//
// То, ради чего заводились стены, проёмы, высоты и привязка меток (G179).
// Здесь собираются **данные** развёртки; рисует их `render.drawElevation`, и
// разделены они нарочно: выгрузка развёртки в PNG и на лист по ГОСТ —
// следующий шаг, и он должен стоить дёшево (тот же приём, что у чертежа в
// таске 127: один слой, два моста).
//
// **Стороны у стены две, и они разные.** На одной розетки кухни, на другой —
// прихожей; высота потолка у этих комнат тоже может не совпадать. Поэтому
// сторона — довод каждой функции здесь, а не настройка: «развёртка стены» без
// стороны не существует.

export const WALL_SIDES = ["left", "right"];

// Насколько отходим от грани стены, когда спрашиваем, в какой комнате эта
// сторона. Сто миллиметров: ближе — и точка попадёт в сам контур, который
// обводят по стене, дальше — и в узком коридоре мы окажемся за его дальней
// стеной.
const WALL_ROOM_PROBE_MM = 100;

/**
 * В какой комнате **эта сторона** стены.
 *
 * Считается на лету по контурам, а не хранится полем у стены. Помещения в этой
 * сборке выводятся из контуров (решение таска 122, развилка 2), и поле `roomId`
 * у стены завело бы вторую правду о том же: обвёл комнату заново — и поле
 * врёт, а починить его нечем, кроме той же проверки по контуру. Считать
 * дешевле и честнее: спрашивают об этом только развёртка и только для той
 * стены, которую открыли.
 *
 * Пробная точка отходит от середины стены на её сторону: сама середина лежит
 * внутри стены, то есть на границе контура, и ответ там был бы случайным.
 */
export function wallRoomId(project, wallId, side) {
  const wall = findWall(project, wallId);
  const vectors = wallVectors(wall);
  if (!wall || !vectors) return null;
  const away = (side === "right" ? -1 : 1) * (Number(wall.thicknessMm) / 2 + WALL_ROOM_PROBE_MM);
  const middle = {
    x: (Number(wall.aMm.x) + Number(wall.bMm.x)) / 2 + vectors.n.x * away,
    y: (Number(wall.aMm.y) + Number(wall.bMm.y)) / 2 + vectors.n.y * away,
  };
  const point = planMmToFraction(project, wall.schemeId, middle);
  return point ? roomAtPoint(project, wall.schemeId, point) : null;
}

/**
 * Высота стены с этой стороны: переопределение комнаты, если сторона в ней
 * лежит, иначе высота схемы. `null` — высота не задана вовсе.
 *
 * Это и есть закрытая дыра таска 128: `wallHeightOf` умеет брать
 * переопределение по комнате, но у стены комнаты не было, и развёртка брала
 * высоту этажа. Теперь комната находится по стороне, а не по стене целиком —
 * у стены между кухней и прихожей две разные высоты, и обе верные.
 */
export function wallHeightOnSide(project, wallId, side) {
  const wall = findWall(project, wallId);
  if (!wall) return null;
  return wallHeightOf(project, { schemeId: wall.schemeId, roomId: wallRoomId(project, wallId, side) });
}

// Отступ вдоль стены с нужной стороны.
//
// **Зеркалится левая сторона, а не правая** — и это не произвол. Левая
// сторона та, что слева, если идти от `a` к `b`; встань на неё и повернись к
// стене — направление `a → b` пойдёт справа налево, и отсчёт от `a` окажется
// справа. С правой стороны, наоборот, `a → b` идёт слева направо, и отступы
// ложатся на лист как есть.
function sideAlong(lengthMm, atMm, side) {
  return side === "left" ? lengthMm - atMm : atMm;
}

function sideSpan(lengthMm, fromMm, toMm, side) {
  const first = sideAlong(lengthMm, fromMm, side);
  const second = sideAlong(lengthMm, toMm, side);
  return { fromMm: Math.min(first, second), toMm: Math.max(first, second) };
}

/**
 * Объекты схемы, попавшие на эту стену, — спроецированные на неё.
 *
 * Привязки у объекта **нет и не заводится**, в отличие от метки, и это не
 * недоделка. Метка — точка, и «какой стене она принадлежит» вопрос спорный:
 * ответ нужно выбрать, запомнить и показать человеку в карточке. У объекта
 * есть размер, и вопрос другой — «накрывает ли он полосу этой стены», а он
 * решается однозначно и считается за десять строк. Хранить ответ значило бы
 * завести поле, которое врёт после первого же переноса стены, — ровно то, от
 * чего мы отказались у стороны метки.
 */
export function wallObjectsOn(project, wallId, side) {
  const wall = findWall(project, wallId);
  const vectors = wallVectors(wall);
  if (!wall || !vectors) return [];
  const half = Number(wall.thicknessMm) / 2;
  const found = [];
  for (const object of schemeObjectsOnScheme(project, wall.schemeId)) {
    const corners = schemeObjectCorners(object);
    if (corners.length === 0) continue;
    const gap = Math.min(...corners.map((point) => segmentDistanceMm(point, wall.aMm, wall.bMm)));
    if (gap - half > MARK_WALL_REACH_MM) continue;
    // Сторона объекта — та, где лежит его середина. Объект, который сидит в
    // самой стене (колонна, ниша, короб), виден с обеих.
    const across =
      corners.reduce(
        (sum, point) => sum + (point.x - wall.aMm.x) * vectors.n.x + (point.y - wall.aMm.y) * vectors.n.y,
        0,
      ) / corners.length;
    const inside = Math.abs(across) <= half;
    if (!inside && (across > 0 ? "left" : "right") !== side) continue;
    const along = corners.map(
      (point) => (point.x - wall.aMm.x) * vectors.u.x + (point.y - wall.aMm.y) * vectors.u.y,
    );
    const span = sideSpan(vectors.len, Math.min(...along), Math.max(...along), side);
    found.push({
      id: object.id,
      name: (findSchemeObjectKind(project, object.kindId) || {}).name || "",
      fromMm: Math.round(span.fromMm),
      toMm: Math.round(span.toMm),
      floorMm: Number(object.heightAboveFloorMm) || 0,
      topMm: schemeObjectTopMm(object),
    });
  }
  return found.sort((first, second) => first.fromMm - second.fromMm);
}

/**
 * Развёртка стены с одной стороны — всё, что на ней есть, на своих местах.
 *
 * Отступы здесь уже **зеркальные по стороне**: рисующему остаётся отложить их
 * слева направо и ничего не знать ни про стороны, ни про направление стены.
 * `heightMm` — высота этой стороны (`null`, если её не задавали);
 * `heightShownMm` — то, во что рисовать: заданная высота или выведенная из
 * того, что на стене стоит. Без числа развёртка была бы картинкой, а с
 * выдуманным молча — враньём, поэтому признак `heightKnown` идёт рядом.
 */
export function wallElevation(project, wallId, side = "left") {
  const wall = findWall(project, wallId);
  if (!wall) return null;
  const length = wallLengthMm(wall);
  const view = WALL_SIDES.includes(side) ? side : "left";
  const openings = openingsInWall(project, wallId).map((opening) => {
    const span = sideSpan(length, Number(opening.atMm), Number(opening.atMm) + Number(opening.widthMm), view);
    return {
      id: opening.id,
      kind: opening.kind,
      fromMm: Math.round(span.fromMm),
      toMm: Math.round(span.toMm),
      floorMm: Number(opening.heightAboveFloorMm) || 0,
      topMm: Number(opening.heightAboveFloorMm) + Number(opening.heightMm),
      // Петли и сторона открывания названы **от направления стены**, и при
      // взгляде с зеркальной стороны обе переворачиваются: дверь,
      // открывающаяся налево, с обратной стороны открывается направо.
      hinge: opening.hinge ? (view === "left" ? flipHinge(opening.hinge) : opening.hinge) : null,
      swing: opening.swing ? (view === "left" ? flipSwing(opening.swing) : opening.swing) : null,
    };
  });
  // Порядок — слева направо **на листе**, а не в модели: после зеркала проём,
  // который в модели шёл первым, оказывается последним, и список, читаемый
  // не по картинке, сбивал бы с толку и размерную цепочку.
  openings.sort((first, second) => first.fromMm - second.fromMm);
  const marks = [];
  for (const mark of project.marks) {
    const binding = markWall(mark);
    if (!binding || binding.wallId !== wallId) continue;
    if (markWallSide(project, mark) !== view) continue;
    const style = styleOf(project, mark.typeId);
    const span =
      binding.toMm === null
        ? { fromMm: sideAlong(length, binding.atMm, view), toMm: null }
        : sideSpan(length, binding.atMm, binding.toMm, view);
    marks.push({
      id: mark.id,
      label: labelOf(project, mark.id),
      color: style.color,
      shape: style.shape,
      lineStyle: style.lineStyle,
      kind: mark.kind === "line" ? "line" : "point",
      fromMm: Math.round(span.fromMm),
      toMm: span.toMm === null ? null : Math.round(span.toMm),
      heightMm: markDimensions(mark).heightAboveFloor,
    });
  }
  marks.sort((first, second) => first.fromMm - second.fromMm);
  const objects = wallObjectsOn(project, wallId, view);
  const known = wallHeightOnSide(project, wallId, view);
  const tops = [
    ...openings.map((opening) => opening.topMm),
    ...objects.map((object) => (object.topMm === null ? 0 : object.topMm)),
    ...marks.map((mark) => mark.heightMm || 0),
  ];
  const roomId = wallRoomId(project, wallId, view);
  const room = roomId ? findRoom(project, roomId) : null;
  return {
    wallId,
    side: view,
    lengthMm: length,
    thicknessMm: Number(wall.thicknessMm),
    heightMm: known,
    heightKnown: known !== null,
    // Выведенная высота: самое высокое, что на стене стоит, плюс триста
    // миллиметров воздуха — чтобы верхний косяк не упирался в потолок листа.
    heightShownMm: known !== null ? known : Math.max(2000, Math.max(0, ...tops) + 300),
    roomId,
    roomName: room ? room.name : "",
    openings,
    marks,
    objects,
  };
}

function flipHinge(value) {
  return value === "end" ? "start" : "end";
}

function flipSwing(value) {
  return value === "right" ? "left" : "right";
}

// ——— данные для штампа ————————————————————————————————————————————————
//
// Графы основной надписи, которых в разметке не было: шифр документа, стадия,
// фамилии и организация. Живут **у объекта** (а не у схемы): шифр и
// организация одни на весь комплект, и переписывать их на каждом этаже
// человек не должен.
//
// Поля нет у объектов прежней разметки, и `FORMAT_VERSION` ради него не
// поднят: читают его только через `projectStamp`, который отсутствующее поле
// отдаёт пустыми графами. Объект, который не трогали, открывается и
// выгружается ровно как раньше — ни одного нового ключа в его `project.json`
// не появляется (G68).

export const PROJECT_STAMP_FIELDS = ["code", "stage", "author", "checker", "approver", "org"];

// Потолок строки графы: в ячейку шириной 50 мм и больше ста знаков не влезет,
// а вставленный туда абзац раздул бы файл и ничего не показал.
export const PROJECT_STAMP_MAX = 120;

function stampValue(raw) {
  // Переводы строк из буфера обмена схлопываются в пробел: графа штампа —
  // одна строка, а переносы в ней разложит уже отрисовка по ширине ячейки.
  return String(raw == null ? "" : raw).replace(/\s+/g, " ").trim().slice(0, PROJECT_STAMP_MAX);
}

/**
 * Данные штампа объекта: все графы строками, незаполненные — пустые.
 * Читать `project.stamp` самому нельзя: у объекта прежней разметки поля нет
 * вовсе, а мусор (число, строка вместо объекта) здесь же становится пустыми
 * графами — лист выйдет, просто без этих надписей.
 */
export function projectStamp(project) {
  const raw = project && project.stamp && typeof project.stamp === "object" && !Array.isArray(project.stamp)
    ? project.stamp
    : {};
  const stamp = {};
  for (const field of PROJECT_STAMP_FIELDS) stamp[field] = stampValue(raw[field]);
  return stamp;
}

// Заполнена ли хоть одна графа. Нужно диалогу и подсказке: пустой штамп — это
// не ошибка, но сказать «графы не заполнены» честнее, чем промолчать.
export function projectHasStamp(project) {
  const stamp = projectStamp(project);
  return PROJECT_STAMP_FIELDS.some((field) => stamp[field] !== "");
}

/**
 * Правка данных штампа. Пустые графы в объекте не хранятся, а когда пустыми
 * стали все — поле `stamp` **убирается**: объект возвращается ровно в то
 * состояние, в котором был до заполнения, и два одинаковых файла снова
 * сливаются в «ничего не изменилось».
 */
export function setProjectStamp(project, patch = {}) {
  const before = projectStamp(project);
  const next = { ...before };
  for (const field of PROJECT_STAMP_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(patch, field)) next[field] = stampValue(patch[field]);
  }
  const stamp = {};
  for (const field of PROJECT_STAMP_FIELDS) {
    if (next[field] !== "") stamp[field] = next[field];
  }
  const filled = Object.keys(stamp).length > 0;
  // Правка, ничего не изменившая, объект не трогает: иначе «Сохранить» в окне
  // без единой правки переписывало бы время объекта и ломало сравнение файлов.
  const same = PROJECT_STAMP_FIELDS.every((field) => next[field] === before[field]);
  if (same) return { project, stamp: next, changed: false };
  if (!filled) {
    const { stamp: dropped, ...rest } = project;
    return { project: withProject(rest, {}), stamp: next, changed: true };
  }
  return { project: withProject(project, { stamp }), stamp: next, changed: true };
}

// ——— правка вершин ломаной ————————————————————————————————————————————
//
// Та же рука, что правит контур помещения: вершину двигают, добавляют между
// соседними и удаляют. Ошибся на третьей вершине из десяти — правится третья,
// а не перерисовывается вся линия. Всё через `updateMark`: второго места, где
// меняются точки метки, нет.

function markPointsAt(project, markId) {
  return [...requireMark(project, markId).points];
}

export function moveMarkPoint(project, markId, index, point) {
  const points = markPointsAt(project, markId);
  if (!(index >= 0 && index < points.length)) throw modelError("markPointNotFound");
  points[index] = { x: point.x, y: point.y };
  return updateMark(project, markId, { points });
}

// Новая вершина встаёт после `index` — на сегменте от неё к следующей. У
// замкнутой линии замыкающий сегмент такой же, как все: последняя → первая.
export function insertMarkPoint(project, markId, index, point) {
  const points = markPointsAt(project, markId);
  if (!(index >= 0 && index < points.length)) throw modelError("markPointNotFound");
  points.splice(index + 1, 0, { x: point.x, y: point.y });
  return updateMark(project, markId, { points });
}

// Продолжение незамкнутой линии: новая вершина встаёт **за концом**, с любого
// из двух концов. Отдельная функция, а не `insertMarkPoint`, ровно по одной
// причине: продолжить линию с начала вставкой «после индекса» можно было бы
// только перевернув её, а порядок вершин у линии значащий — по первому сегменту
// уходит подпись, за первую вершину держится стрелка связи. Здесь порядок цел:
// с начала вершина дописывается в голову списка, с конца — в хвост.
export const MARK_LINE_ENDS = ["start", "end"];

export function extendMarkLine(project, markId, end, point) {
  const mark = requireMark(project, markId);
  if (mark.kind !== "line") throw modelError("extendOnlyLine");
  // Замкнутой линии расти некуда: у кольца концов нет.
  if (mark.closed) throw modelError("extendClosedLine");
  if (!MARK_LINE_ENDS.includes(end)) throw modelError("markEndUnknown");
  const points = markPointsAt(project, markId);
  const added = { x: point.x, y: point.y };
  if (end === "start") points.unshift(added);
  else points.push(added);
  return updateMark(project, markId, { points });
}

export function removeMarkPoint(project, markId, index) {
  const mark = requireMark(project, markId);
  const points = [...mark.points];
  if (!(index >= 0 && index < points.length)) throw modelError("markPointNotFound");
  // Линия короче двух вершин не существует — модель её и не примет.
  if (mark.kind === "line" && points.length <= MARK_LINE_MIN_POINTS) throw modelError("shortLine");
  if (points.length <= 1) throw modelError("shortLine");
  points.splice(index, 1);
  return updateMark(project, markId, { points });
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

/**
 * Дописывает объекту постоянный ключ, если его ещё нет. Возвращает
 * `{project, changed}`; `changed: false` — ключ уже был, объект тот же самый
 * по ссылке.
 *
 * Это не правка данных, а недостающая метка: `updatedAt` не трогается, чтобы
 * ключ, появившийся при открытии, не выглядел для второй стороны свежей
 * работой. Идемпотентно: второй вызов ничего не делает.
 */
export function ensureProjectKey(project) {
  if (!project) return { project, changed: false };
  if (typeof project.key === "string" && project.key) return { project, changed: false };
  return { project: { ...project, key: newId() }, changed: true };
}

export function updateProject(project, patch = {}) {
  const next = {};
  if (Object.prototype.hasOwnProperty.call(patch, "name")) next.name = normalizeName(patch.name);
  if (Object.prototype.hasOwnProperty.call(patch, "view")) next.view = { ...project.view, ...patch.view };
  return { project: withProject(project, next) };
}

// ——— вид типа: точка или линия ————————————————————————————————————————
//
// Поле `type.kind` появилось у типов позже самих типов, и объекты заказчика
// его не знают. Молча подставить «точку» всем — значит перерисовать готовый
// план: тип, которым размечали трек, стал бы точечным. Поэтому вид выводится
// из того, что уже нарисовано, и только там, где ответ однозначен.

// Виды меток этого типа: что из них есть на самом деле.
function typeMarkKinds(project, typeId) {
  const kinds = new Set();
  for (const mark of (project && project.marks) || []) {
    if (mark.typeId !== typeId) continue;
    kinds.add(MARK_KINDS.includes(mark.kind) ? mark.kind : "point");
  }
  return kinds;
}

/**
 * Какой вид приписать типу, у которого его нет, и насколько это догадка.
 * `reason`:
 *   `marks`   — все метки типа одного вида, ответ однозначен (молча);
 *   `noMarks` — меток нет, вид взят по умолчанию (точка);
 *   `mixed`   — метки обоих видов; тип считается точечным, а метки-линии
 *               остаются нарисованными как есть. Раздваивать тип нельзя:
 *               нумерация сквозная по типу, и раздвоение её порвёт.
 */
export function typeKindGuess(project, typeId) {
  const kinds = typeMarkKinds(project, typeId);
  if (kinds.size === 1) return { kind: [...kinds][0], reason: "marks" };
  if (kinds.size === 0) return { kind: "point", reason: "noMarks" };
  return { kind: "point", reason: "mixed" };
}

/** Вид типа: записанный, а у объекта прежнего формата — выведенный по меткам. */
export function typeKindOf(project, typeId) {
  const type = findType(project, typeId);
  if (type && MARK_KINDS.includes(type.kind)) return type.kind;
  if (!type) return "point";
  return typeKindGuess(project, typeId).kind;
}

/**
 * Дописать вид всем типам, у которых его нет. Однозначное проставляется молча,
 * догадка отмечается `kindGuessed` — по ней собирается список на правку.
 * Дописывать нечего — возвращается **тот же** объект: ни `updatedAt`, ни шага
 * истории миграция не трогает, иначе открытие объекта выглядело бы правкой.
 */
export function migrateTypeKinds(project) {
  if (!project || !Array.isArray(project.markTypes)) return { project, guessed: [] };
  const guessed = [];
  let changed = false;
  const markTypes = project.markTypes.map((type) => {
    if (MARK_KINDS.includes(type.kind)) return type;
    const guess = typeKindGuess(project, type.id);
    changed = true;
    const next = { ...type, kind: guess.kind };
    if (guess.reason !== "marks") {
      next.kindGuessed = guess.reason;
      guessed.push({ typeId: type.id, code: type.code, name: type.name, kind: guess.kind, reason: guess.reason });
    }
    return next;
  });
  if (!changed) return { project, guessed: [] };
  return { project: { ...project, markTypes }, guessed };
}

/**
 * Перевести объект сборки таска 116 на встроенный комментарий (G173).
 *
 * Тогда комментарий был обычной строкой справочника, и в объекты заказчика он
 * попал двумя путями — из шаблона нового объекта и кнопкой «Добавить из общей
 * базы». Теперь строки в справочнике нет, а метки на неё ссылаются: миграция
 * переводит их на `COMMENT_TYPE_ID` и убирает из справочника сам тип и
 * осиротевшую категорию.
 *
 * **Ни одна метка ничего не теряет.** Идентификатор метки, номер, точки,
 * текст, указатель и смещение плашки не трогаются вовсе — меняется одно поле
 * `typeId`. Подпись (`код + номер`) остаётся прежней, потому что миграция
 * **забирает код с собой**: переименуй пользователь тип в «Прим», и плашки
 * звались бы «Прим1» — после миграции они зовутся так же, код живёт в
 * `project.commentCode`. Счётчик номеров ведётся на код и поэтому тоже цел.
 *
 * Миграция **молчалива и идемпотентна**: переводить нечего — возвращается тот
 * же объект по ссылке, без `updatedAt` и без шага истории. Спрашивать у
 * человека ей нечего: догадок здесь нет, вид типа записан в самих данных.
 *
 * Редкий случай, названный вслух: типов-комментариев в справочнике оказалось
 * несколько (в сборке 116 переключатель вида позволял завести второй). Все их
 * метки сходятся на одном встроенном типе — он на то и один, — а код берётся
 * у того, где меток больше; у меток остальных сменится приставка подписи.
 * Из двух путей, какими тип попадал в объект, так получиться не могло.
 */
export function migrateCommentType(project) {
  if (!project || !Array.isArray(project.markTypes)) return { project, changed: false, moved: 0 };
  const own = project.markTypes.filter((type) => type.kind === MARK_KIND_COMMENT);
  if (own.length === 0) return { project, changed: false, moved: 0 };
  const ids = new Set(own.map((type) => type.id));
  const marks = Array.isArray(project.marks) ? project.marks : [];
  const count = (typeId) => marks.filter((mark) => mark.typeId === typeId).length;
  // Главный — тот, на котором больше меток: его код и переезжает. При равенстве
  // выигрывает первый в справочнике, чтобы ответ не зависел от порядка обхода.
  const main = own.reduce((best, type) => (count(type.id) > count(best.id) ? type : best), own[0]);
  const next = { ...project };
  let moved = 0;
  next.marks = marks.map((mark) => {
    if (!ids.has(mark.typeId)) return mark;
    moved += 1;
    return { ...mark, typeId: COMMENT_TYPE_ID };
  });
  next.markTypes = project.markTypes.filter((type) => !ids.has(type.id));
  // Категория уходит только вместе с последним своим типом: заведи пользователь
  // в «Комментариях» что-то своё — категория останется ему.
  const orphan = new Set(own.map((type) => type.categoryId));
  for (const type of next.markTypes) orphan.delete(type.categoryId);
  next.categories = (project.categories || []).filter((category) => !orphan.has(category.id));
  const code = String(main.code || "").trim();
  if (code && code !== COMMENT_TYPE_CODE) next.commentCode = code;
  return { project: next, changed: true, moved };
}

/**
 * Типы, вид которых не выведен, а угадан: показываются одним списком на правку.
 * Пусто — список не показывается вовсе, и это обычный случай размеченного
 * объекта.
 */
export function typeKindReview(project) {
  const rows = [];
  for (const type of (project && project.markTypes) || []) {
    if (!type.kindGuessed) continue;
    rows.push({
      typeId: type.id,
      code: type.code,
      name: type.name,
      kind: MARK_KINDS.includes(type.kind) ? type.kind : "point",
      reason: type.kindGuessed === "mixed" ? "mixed" : "noMarks",
    });
  }
  return rows;
}

/**
 * Список закрыт — больше не показывается. Отметка живёт в самом объекте, а не
 * в настройках браузера: файл переедет на другую машину вместе с ней.
 */
export function closeTypeKindReview(project) {
  if (!project || !Array.isArray(project.markTypes)) return { project };
  if (!project.markTypes.some((type) => type.kindGuessed)) return { project };
  const markTypes = project.markTypes.map((type) => {
    if (!type.kindGuessed) return type;
    const next = { ...type };
    delete next.kindGuessed;
    return next;
  });
  return { project: withProject(project, { markTypes }) };
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

// ——— типы оборудования ————————————————————————————————————————————————
//
// Свой справочник, не тот, что у меток. Слова заказчика: «для оборудования
// добавь поле Тип, которое можно расширять, но по умолчанию добавь все что
// есть по меткам, а так же всё, что может применяться в умном доме».
//
// Два справочника, а не один, потому что они отвечают на разные вопросы. Тип
// метки — чем точка обозначена на плане: у него есть код, цвет, форма и
// номер. Тип оборудования — что за железка куплена: реле на четыре канала и
// блок питания на плане не помечаются ничем, а закупаются и ставятся в щит.
// Свести их в один справочник значило бы завести «тип метки без метки».
//
// Стартовый набор — две части: то, что размечено метками (светильники,
// розетки, датчики, климат, сеть), и начинка щита с обвязкой. Живёт он в
// шаблоне и копируется в объект при создании: дальше объект правит свой
// справочник сам, и правка шаблона до него больше не доезжает — ровно как у
// типов меток.
const TEMPLATE_EQUIPMENT_TYPES = [
  // Размечается меткой на плане.
  "spot",
  "lamp",
  "strip",
  "track",
  "switchUnit",
  "socket",
  "breezer",
  "conditioner",
  "wifi",
  "ethernet",
  "motion",
  "opening",
  "leak",
  "smoke",
  "climate",
  "waterValve",
  // Ставится, но меткой на плане не помечается: щит и обвязка.
  "relay1",
  "relay2",
  "relay3",
  "relay4",
  "dimmer",
  "ledSingle",
  "ledRgb",
  "ledRgbw",
  "ledCct",
  "power",
  "button",
  "scenePanel",
  "gateway",
  "hub",
  "module",
  "curtainDrive",
  "thermostat",
  "irBlaster",
  "netSwitch",
  "router",
  "breaker",
  "rcd",
  "contactor",
  "enclosure",
];

// Свежие идентификаторы на каждый вызов — как у `defaultTemplate`: два объекта
// не должны делить id справочника.
export function equipmentTypeTemplate() {
  return TEMPLATE_EQUIPMENT_TYPES.map((key, index) => ({
    id: newId(),
    name: strings.equipmentTypes[key] || key,
    order: index,
  }));
}

// Справочник объекта прежнего формата пуст — это не ошибка: тип у единицы
// необязателен, и старый объект открывается как раньше.
function equipmentTypesOf(project) {
  return project && Array.isArray(project.equipmentTypes) ? project.equipmentTypes : [];
}

export function equipmentTypesInOrder(project) {
  return equipmentTypesOf(project)
    .map((item, index) => ({ item, order: item.order == null ? index : item.order, index }))
    .sort((a, b) => (a.order === b.order ? a.index - b.index : a.order - b.order))
    .map((entry) => entry.item);
}

export function findEquipmentType(project, typeId) {
  if (!typeId) return null;
  return equipmentTypesOf(project).find((item) => item.id === typeId) || null;
}

export function addEquipmentType(project, { name } = {}) {
  const item = { id: newId(), name: normalizeName(name), order: equipmentTypesOf(project).length };
  return {
    project: withProject(project, { equipmentTypes: [...equipmentTypesOf(project), item] }),
    equipmentType: item,
  };
}

export function updateEquipmentType(project, typeId, patch = {}) {
  const current = findEquipmentType(project, typeId);
  if (!current) throw modelError("equipmentTypeNotFound");
  const next = { ...current };
  if (Object.prototype.hasOwnProperty.call(patch, "name")) next.name = normalizeName(patch.name);
  if (Object.prototype.hasOwnProperty.call(patch, "order")) next.order = patch.order;
  const equipmentTypes = equipmentTypesOf(project).map((item) => (item.id === typeId ? next : item));
  return { project: withProject(project, { equipmentTypes }), equipmentType: next };
}

// Сколько моделей этого типа — и заодно ответ, можно ли тип удалить.
export function equipmentTypeUsage(project, typeId) {
  return equipmentOf(project).filter((item) => item.typeId === typeId).length;
}

// Тип с моделями не удаляется молча: иначе у модели осталась бы ссылка в
// никуда, и в таблице она читалась бы как «тип не заполнен».
export function deleteEquipmentType(project, typeId) {
  const item = findEquipmentType(project, typeId);
  if (!item) throw modelError("equipmentTypeNotFound");
  const used = equipmentTypeUsage(project, typeId);
  if (used > 0) throw modelError("equipmentTypeInUse", { name: item.name, count: used });
  const equipmentTypes = equipmentTypesOf(project)
    .filter((entry) => entry.id !== typeId)
    .map((entry, index) => ({ ...entry, order: index }));
  return { project: withProject(project, { equipmentTypes }), deleted: item };
}

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

// Тип у модели необязателен, и пустой тип — не ошибка: у единиц, заведённых до
// появления справочника, его нет вовсе. Ссылка в никуда сюда не проходит:
// несуществующий тип превращается в пустой, а не остаётся висеть.
function equipmentTypeRef(project, value) {
  const id = value == null ? "" : String(value);
  return id && findEquipmentType(project, id) ? id : "";
}

export function addEquipment(project, { name, vendor, code, typeId } = {}) {
  const item = {
    id: newId(),
    name: normalizeName(name),
    vendor: equipmentText(vendor),
    code: equipmentText(code),
    typeId: equipmentTypeRef(project, typeId),
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
  if (Object.prototype.hasOwnProperty.call(patch, "typeId")) next.typeId = equipmentTypeRef(project, patch.typeId);
  if (Object.prototype.hasOwnProperty.call(patch, "order")) next.order = patch.order;
  const equipment = equipmentOf(project).map((item) => (item.id === equipmentId ? next : item));
  return { project: withProject(project, { equipment }), equipment: next };
}

// Тип единицы читают только отсюда: у модели из старого файла поля нет вовсе,
// а ссылка могла остаться от типа, которого уже нет.
export function equipmentTypeOf(project, equipmentId) {
  const item = findEquipment(project, equipmentId);
  return item ? findEquipmentType(project, item.typeId) : null;
}

// ——— поиск модели ——————————————————————————————————————————————————————
//
// Окно выбора ищет так же, как окно выбора типа метки: строка совпадает с
// названием, производителем или артикулом, точное совпадение идёт первым.
// Правило поиска живёт здесь, а не в панели: разойдись они — Enter в окне
// брал бы не ту строку, что стоит первой.
function equipmentMatches(item, needle) {
  if (!needle) return true;
  return [item.name, item.vendor, item.code].some((value) => String(value || "").toLowerCase().includes(needle));
}

function equipmentExactRank(item, needle) {
  if (!needle || !item) return 0;
  const name = String(item.name || "").toLowerCase();
  if (name === needle) return 3;
  if (String(item.code || "").toLowerCase() === needle) return 2;
  return name.startsWith(needle) ? 1 : 0;
}

/**
 * Модели под фильтр окна выбора. `query` — строка поиска, `typeId` — тип
 * («» — любой), `vendor` — производитель как он записан у модели («» — любой,
 * причём модели без производителя отбираются пустой строкой отдельным
 * признаком `noVendor`).
 *
 * Порядок: точное совпадение первым, дальше порядок справочника — тот же, что
 * в таблице закупки, чтобы список не перетасовывался от одной буквы.
 */
export function searchEquipment(project, { query, typeId, vendor, noVendor } = {}) {
  const needle = String(query == null ? "" : query).trim().toLowerCase();
  const wantType = typeId == null ? "" : String(typeId);
  const wantVendor = vendor == null ? "" : String(vendor).trim().toLowerCase();
  return equipmentInOrder(project)
    .filter((item) => equipmentMatches(item, needle))
    .filter((item) => (wantType ? item.typeId === wantType : true))
    .filter((item) => {
      if (noVendor) return !String(item.vendor || "").trim();
      return wantVendor ? String(item.vendor || "").trim().toLowerCase() === wantVendor : true;
    })
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      const rank = equipmentExactRank(b.item, needle) - equipmentExactRank(a.item, needle);
      return rank === 0 ? a.index - b.index : rank;
    })
    .map((entry) => entry.item);
}

// Такая модель уже заведена — заводить вторую незачем: она стоит первой в
// списке, и Enter берёт именно её.
export function matchEquipmentExactly(project, query) {
  const needle = String(query == null ? "" : query).trim().toLowerCase();
  if (!needle) return null;
  return (
    equipmentOf(project).find(
      (item) => String(item.name || "").toLowerCase() === needle || String(item.code || "").toLowerCase() === needle,
    ) || null
  );
}

// Производители, встреченные у моделей, — список для фильтра окна выбора.
// Порядок справочника, без повторов и без пустых.
export function equipmentVendors(project) {
  const seen = [];
  for (const item of equipmentInOrder(project)) {
    const vendor = String(item.vendor || "").trim();
    if (vendor && !seen.includes(vendor)) seen.push(vendor);
  }
  return seen;
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
  const mark = requireMark(project, markId);
  // Оборудование ставят в точку, а не в надпись: лист оборудования — это
  // закупка, и комментария в нём нет (G167).
  if (markIsComment(mark)) throw modelError("commentNoEquipment");
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
//
// Проблема **называет виновника**: `{label}` в тексте — обозначение метки,
// название помещения у контура, подпись блока у группы. Три одинаковые строки
// «метка ссылается на несуществующее помещение» в списке предупреждений
// неразличимы, и посмотреть, о какой из них речь, можно было только кликом.
function problem(code, vars, ref, kind, subject) {
  return {
    code,
    message: text("problems." + code, vars),
    ref: ref || null,
    kind: kind || "error",
    // Ключ принятия: код проблемы и то, о чём она. По умолчанию это `ref` —
    // метка, тип, контур; там, где `ref` только представитель набора,
    // подставляется свой устойчивый признак (`subject`). От ключа зависит,
    // вернётся ли принятое, когда набор под ним изменится.
    key: code + ":" + (subject || ref || ""),
  };
}

// Чем назвать виновника, у которого нет своего обозначения: метка без типа
// обозначение всё-таки имеет («?7» — так её показывает и список меток), а вот
// контур без помещения и группа без меток — нет.
function problemSubject(kind) {
  return strings.subjects[kind] || strings.subjects.mark;
}

function outlineLabel(project, outline) {
  const room = outline && outline.roomId ? findRoom(project, outline.roomId) : null;
  return room ? room.name : problemSubject("outline");
}

/**
 * Знаки, которые носят несколько точечных типов справочника.
 *
 * Правило «у каждого точечного типа свой знак» держалось с первого брифа и
 * было запретом: тест шаблона краснел на повторе. Справочник заказчика его
 * нарушает семь раз подряд — под кругом с крестом сидят Т, С, ПК, ПС, ППл, ЛЮ
 * и Бр, — и нарушает сознательно. Его довод: рядом со знаком на плане
 * **всегда стоит подпись** — Т1, С2, ПК1, — и монтажник читает её, а не форму;
 * правило заводилось, воображая знак без подписи, а такого на плане не бывает.
 *
 * Поэтому повтор стал предупреждением, а не запретом: здесь он собирается,
 * `validate` его называет, панель показывает, а пользователь закрывает строку
 * «так и задумано». Линейные типы сюда не входят — их обозначение не форма, а
 * начертание, и разводит их своя проверка.
 *
 * Возвращает `[{ shape, name, codes, typeIds }]` в порядке справочника.
 */
export function sharedShapes(project) {
  const groups = new Map();
  for (const { types } of typesInOrder(project)) {
    for (const type of types) {
      if (typeKindOf(project, type.id) !== "point") continue;
      const shape = styleOf(project, type.id).shape;
      if (!groups.has(shape)) groups.set(shape, { shape, name: strings.shapes[shape] || shape, codes: [], typeIds: [] });
      const group = groups.get(shape);
      group.codes.push(type.code);
      group.typeIds.push(type.id);
    }
  }
  return [...groups.values()].filter((group) => group.typeIds.length > 1);
}

/**
 * Пары категорий, чьи цвета на плане похожи (ближе `COLOR_NEAR_DISTANCE`).
 *
 * История та же, что у знаков: порог был запретом в тесте шаблона, а справочник
 * заказчика держит пять пар ближе него — и это его выбор, сделанный по числам.
 * Окно выбора цвета при этом строгим и осталось: заводя новую категорию, человек
 * видит занятые и близкие цвета помеченными. Здесь — только рассказать о том,
 * что уже есть в объекте.
 *
 * Возвращает `[{ first, second, distance, categoryIds }]`, ближайшая пара первой.
 */
export function closeCategoryColors(project) {
  // Порядок — тот, в котором категории лежат в объекте: своей сортировки
  // сущностей здесь не заводится, а пары в конце выстраиваются по близости.
  const categories = project && Array.isArray(project.categories) ? project.categories : [];
  const pairs = [];
  for (let i = 0; i < categories.length; i += 1) {
    for (let j = i + 1; j < categories.length; j += 1) {
      const distance = colorDistance(categories[i].color, categories[j].color);
      if (!(distance < COLOR_NEAR_DISTANCE)) continue;
      pairs.push({
        first: categories[i].name,
        second: categories[j].name,
        distance,
        categoryIds: [categories[i].id, categories[j].id],
      });
    }
  }
  return pairs.sort((a, b) => a.distance - b.distance);
}

// Расстояние цвета — число с запятой, как его читает пользователь.
function colorDistanceText(distance) {
  return distance.toFixed(1).replace(".", ",");
}

export function validate(project) {
  const problems = [];

  const seenCodes = new Map();
  for (const type of project.markTypes) {
    const key = type.code.toUpperCase();
    if (seenCodes.has(key)) problems.push(problem("duplicateCode", { code: type.code }, type.id));
    else seenCodes.set(key, type.id);
    if (!findCategory(project, type.categoryId)) {
      problems.push(problem("typeWithoutCategory", { code: type.code }, type.id));
    }
  }

  const behindTypes = new Map();
  for (const mark of project.marks) {
    const type = findType(project, mark.typeId);
    const label = markLabel(project, mark);
    if (!type) problems.push(problem("markWithoutType", { label }, mark.id));
    if (!findScheme(project, mark.schemeId)) problems.push(problem("markWithoutScheme", { label }, mark.id));
    if (mark.roomId && !findRoom(project, mark.roomId)) problems.push(problem("markWithoutRoom", { label }, mark.id));
    if (!Array.isArray(mark.points) || mark.points.length === 0) {
      problems.push(problem("emptyPoints", { label }, mark.id));
    } else if (mark.kind === "line" && mark.points.length < 2) {
      problems.push(problem("shortLine", { label }, mark.id));
    }

    // Пустая плашка — находка, а не поломка: комментарий без текста занимает
    // место на плане и ничего не сообщает, и о нём стоит сказать вслух.
    // Предупреждения «метка без подписи» у комментария, наоборот, быть не
    // может: подписи у него нет вовсе — вместо неё плашка.
    if (markIsComment(mark) && markCommentText(mark) === "") {
      problems.push(problem("commentEmpty", { label }, mark.id, "warning"));
    }

    for (const controlled of markControlIds(mark)) {
      if (!findMark(project, controlled)) problems.push(problem("controlsMissing", { label }, mark.id));
    }

    // Каналы связей. Оба случая — предупреждения, а не ошибки: объект цел, но
    // читается неоднозначно, и решает пользователь.
    if (type) {
      const channels = typeChannels(project, mark.typeId);
      const links = markControlLinks(mark).filter((link) => findMark(project, link.id));
      // «У ВВ3 две нагрузки, канал не указан» — какая клавиша какую включает,
      // по плану не видно. Одна нагрузка без канала загадки не создаёт, а один
      // канал на шесть светильников — приём заказчика, а не оплошность.
      if (channels > 1 && links.length > 1 && links.some((link) => link.channel === null)) {
        problems.push(problem("controlsChannelMissing", { label, count: links.length }, mark.id, "warning"));
      }
      // Уменьшили число каналов у типа, а связь на третьем осталась. Связь
      // цела и работает как работала — но об этом надо сказать вслух.
      const beyond = [...new Set(links.map((link) => link.channel).filter((value) => value !== null && value > channels))];
      if (beyond.length > 0) {
        problems.push(
          problem(
            "controlsChannelBeyond",
            { label, code: type.code, channels, over: beyond.sort((first, second) => first - second).join(", ") },
            mark.id,
            "warning",
          ),
        );
      }
    }

    if (type) {
      const counter = project.counters[type.code] || 0;
      if (mark.number > counter) behindTypes.set(type.id, type.code);
    }
  }

  // Отставший счётчик — свойство типа, а не каждой его метки.
  for (const [id, code] of behindTypes) problems.push(problem("counterBehind", { code }, id));

  // **Метка в проёме** (таск 128). Та самая проверка, ради которой заказчик
  // просил чертёж на холсте: розетка, попавшая в дверной проём, на монтаже
  // стоит дорого. Это находка, а не поломка: данные целы, а права ли она —
  // решает человек, иногда розетка у самого косяка и задумана.
  for (const mark of project.marks) {
    const opening = markOpeningHit(project, mark);
    if (!opening) continue;
    problems.push(
      problem(
        "markInOpening",
        { label: markLabel(project, mark), kind: strings.openingKinds[opening.kind] || opening.kind },
        mark.id,
        "warning",
      ),
    );
  }

  // **Чертёж есть, а на план его не положить** (таск 127). Чертёж виден на
  // подложке только при двух условиях сразу — калибровка и привязка (ADR 008),
  // и когда одного не хватает, холст его просто не рисует. Молчать об этом
  // нельзя: человек чертил и не видит нарисованного, а причина не в нём.
  // Это находка, а не поломка: данные целы, и чинится она двумя кликами.
  for (const scheme of project.schemes) {
    if (wallsOnScheme(project, scheme.id).length === 0 && schemeObjectsOnScheme(project, scheme.id).length === 0) {
      continue;
    }
    if (planMmToFraction(project, scheme.id, { x: 0, y: 0 })) continue;
    // Код пишется словом, а не складывается из переменной: сверка словаря
    // ищет его в исходниках буквально, и склеенный код прошёл бы мимо неё
    // (тем самым путём, от которого `strings.test.js` и заведён).
    if (planPixelsPerMeter(project, scheme.id) > 0) {
      problems.push(problem("drawingNotPlaced", { name: scheme.name }, scheme.id, "warning"));
    } else {
      problems.push(problem("drawingNoScale", { name: scheme.name }, scheme.id, "warning"));
    }
  }

  // Метка не того вида, что её тип. Это не поломка: так открывается объект,
  // который размечали до того, как у типа появился вид, — линии остались
  // нарисованными, и трогать их молча нельзя. Но и промолчать нельзя:
  // предупреждение называет тип, а решает пользователь.
  for (const type of project.markTypes) {
    const kind = typeKindOf(project, type.id);
    const other = [...typeMarkKinds(project, type.id)].some((item) => item !== kind);
    if (other) problems.push(problem("typeKindMixed", { code: type.code }, type.id, "warning"));
  }

  // Повтор номера — приём заказчика, а не поломка: одно предупреждение на
  // обозначение, с числом меток, чтобы случайный дубль было видно.
  for (const item of repeatedNumbers(project)) {
    problems.push(
      problem(
        "repeatedNumber",
        { label: item.label, count: item.count },
        item.markIds[0],
        "warning",
        // Принимают не «вот эти три метки», а сам приём: тип и номер. Ключ по
        // первой метке вернул бы уже принятое, стоило добавить к группе
        // четвёртый светильник или убрать из неё первый.
        item.typeId + "#" + item.number,
      ),
    );
  }

  // Повтор знака и похожий цвет категорий — сведения об объекте, а не поломка.
  // Справочник заказчика держит и то и другое сознательно (см. `sharedShapes`),
  // и панель показывает это строкой, которую можно закрыть «так и задумано».
  // Ключ принятия — не сам знак, а **состав** под ним: принято «вот эти семь
  // типов носят круг с крестом». Развёл человек знаки руками и завёл новый
  // повтор тем же кругом — состав другой, и он об этом узнает.
  for (const group of sharedShapes(project)) {
    problems.push(
      problem(
        "sharedShape",
        { shape: group.name, codes: group.codes.join(", ") },
        group.typeIds[0],
        "warning",
        sharedShapeSubject(group),
      ),
    );
  }
  for (const pair of closeCategoryColors(project)) {
    problems.push(
      problem(
        "closeColors",
        { first: pair.first, second: pair.second, distance: colorDistanceText(pair.distance) },
        pair.categoryIds[0],
        "warning",
        closeColorsSubject(pair),
      ),
    );
  }

  for (const outline of outlinesOf(project)) {
    const label = outlineLabel(project, outline);
    if (!findScheme(project, outline.schemeId)) problems.push(problem("outlineWithoutScheme", { label }, outline.id));
    if (!findRoom(project, outline.roomId)) problems.push(problem("outlineWithoutRoom", { label }, outline.id));
    if (!Array.isArray(outline.points) || outline.points.length < OUTLINE_MIN_POINTS) {
      problems.push(problem("shortOutline", { label }, outline.id));
    }
  }

  for (const placement of placementsOf(project)) {
    // Единицу оборудования называют меткой, на которой она стоит: своего
    // обозначения у неё нет, а найти её пользователь будет по метке.
    const mark = findMark(project, placement.markId);
    const label = mark ? markLabel(project, mark) : problemSubject("placement");
    if (!findEquipment(project, placement.equipmentId)) {
      problems.push(problem("placementWithoutEquipment", { label }, placement.id));
    }
    if (!mark) problems.push(problem("placementWithoutMark", { label }, placement.id));
    for (const link of placementLinkIds(placement)) {
      if (!findMark(project, link)) problems.push(problem("placementLinkMissing", { label }, placement.id));
    }
  }

  for (const group of project.groups) {
    const members = group.markIds.map((markId) => findMark(project, markId)).filter(Boolean);
    const label = blockLabel(project, group.markIds) || problemSubject("group");
    if (members.length < 2) problems.push(problem("smallGroup", { label }, group.id));
    if (new Set(members.map((mark) => mark.schemeId)).size > 1) {
      problems.push(problem("groupAcrossSchemes", { label }, group.id));
    }
  }

  return problems;
}

// ——— принятые предупреждения ————————————————————————————————————————
//
// Повтор номера — приём заказчика: три светильника одной группы носят Т4
// намеренно. Программа об этом знать не может и обязана спросить один раз, а
// потом помнить ответ. Помнить — в самом объекте, как отметку `kindGuessed` у
// типа: файл переезжает на другую машину и открывается вторым человеком из
// общей папки, и ответ должен ехать вместе с ним.
//
// **Ключ принятия** — `problem.key`: код проблемы и то, о чём она. Он нарочно
// не считает меток: принято «Т4 повторяется намеренно», а не «таких меток
// три». Четвёртый светильник в группе не возвращает того, что пользователь уже
// закрыл, — иначе крестик пришлось бы нажимать после каждой новой метки.
// Возвращает предупреждение в работу только сам пользователь, строкой
// «Принято: N».
//
// Номер в ключе — не вечная величина: смыкание номеров меняет Т4 на Т2, и
// принятое переезжает вместе с обозначением (`renumberAccepted` зовётся прямо
// из `compactNumbers`). Слова заказчика: «по метке, типо Т4 — корректно. Но
// это тоже должно переживать уплотнение меток».
//
// Отсюда же цена решения: принятое молчит и тогда, когда повтор сложился
// заново — тем же номером, но из других меток. Поэтому ни одна запись не
// пропадает молча: весь список виден в панели, и каждую строку можно вернуть.

// ——— предупреждения, пришедшие не из рук человека ————————————————————
//
// Два предупреждения говорят не о разметке, а о самом справочнике: один знак
// на нескольких типах и похожий цвет у двух категорий. Справочник заказчика
// держит и то и другое сознательно, и на новом объекте он же и приезжает —
// значит на пустом объекте эти строки говорили бы человеку о том, чего он не
// делал. Слова заказчика: «в стандартной схеме не должно быть предупреждений».
//
// Правило при этом не выброшено. Развёл человек знаки руками, а потом завёл
// новый повтор — предупреждение он получит: принимается только то, что
// приехало со справочником, и только в тот момент, когда справочник приехал —
// при создании объекта и при «Добавить из общей базы». Всё, что появилось
// потом, считается как считалось.
//
// Выбран путь «принять за пользователя», а не «не считать шаблонное
// предупреждением»: второй требует признака «из шаблона» у каждого типа, а
// такой признак поехал бы в данные и начал бы врать при первой же правке
// знака. Принятие — механизм, который в сборке уже есть, и главное: оно
// ничего не прячет. Список принятых виден в панели, каждая строка называет
// то, на что ответили, и возвращается в работу одним нажатием.
export const DICTIONARY_PROBLEM_CODES = ["sharedShape", "closeColors"];

// Предмет предупреждения и его нынешний состав — две разные вещи, и обе нужны.
//
// **Состав** идёт в ключ принятия: принято не «круг с крестом», а «вот эти семь
// типов носят круг с крестом». Состав считается по идентификаторам типов, а не
// по кодам: переименование кода — не повод спрашивать заново, а вот другой
// набор типов под тем же знаком — уже другой вопрос. Отсюда и требование
// тикета: развёл человек знаки руками, а потом завёл новый повтор тем же
// кругом — состав другой, и он получит предупреждение.
//
// **Предмет** (сам знак, сама пара категорий) нужен, чтобы решить, можно ли
// молча принять новый состав: если про этот знак у человека уже висит открытое
// предупреждение, добавление типа из общей базы не имеет права его погасить.
function sharedShapeSubject(group) {
  return group.shape + "#" + [...group.typeIds].sort().join(",");
}

function closeColorsSubject(pair) {
  return [...pair.categoryIds].sort().join("+");
}

// Нынешние строки справочника: ключ принятия → предмет.
function dictionaryRows(project) {
  const rows = new Map();
  for (const group of sharedShapes(project)) {
    rows.set("sharedShape:" + sharedShapeSubject(group), "sharedShape:" + group.shape);
  }
  for (const pair of closeCategoryColors(project)) {
    const subject = closeColorsSubject(pair);
    rows.set("closeColors:" + subject, "closeColors:" + subject);
  }
  return rows;
}

/**
 * Предметы, о которых у человека прямо сейчас висит **открытое** предупреждение
 * справочника: знак, повтор которого он ещё не закрыл, пара категорий, про
 * которую ему ещё не ответили. Снимок берут до операции, приносящей типы из
 * общей базы, — чтобы та не погасила вопрос, который уже задан.
 */
export function openDictionarySubjects(project) {
  const open = new Set();
  for (const [key, subject] of dictionaryRows(project)) {
    if (!problemAccepted(project, key)) open.add(subject);
  }
  return open;
}

// Принять строки справочника, предмет которых в `known` ещё не значился.
// Принимать нечего — возвращается **тот же** объект: ни `updatedAt`, ни лишнего
// шага истории эта тишина не стоит.
function acceptFromDictionary(project, known) {
  const rows = dictionaryRows(project);
  const fresh = validate(project).filter(
    (problem) =>
      DICTIONARY_PROBLEM_CODES.includes(problem.code) &&
      rows.has(problem.key) &&
      !known.has(rows.get(problem.key)) &&
      !problemAccepted(project, problem.key),
  );
  if (fresh.length === 0) return project;
  const stamp = nowIso();
  const records = fresh.map((problem) => ({
    key: problem.key,
    code: problem.code,
    kind: "warning",
    label: String(problem.message || ""),
    at: stamp,
  }));
  return { ...project, accepted: [...acceptedOf(project), ...records] };
}

function acceptedOf(project) {
  return project && Array.isArray(project.accepted) ? project.accepted : [];
}

/**
 * Принятые предупреждения в порядке принятия:
 * `[{key, code, kind, label, at}]`. `label` — текст на момент принятия: это
 * то, на что пользователь ответил «так и задумано», и показывать в списке
 * принятых надо именно его, даже когда виновника уже нет.
 */
export function acceptedProblems(project) {
  return acceptedOf(project).slice();
}

/** Принято ли предупреждение с таким ключом. */
export function problemAccepted(project, key) {
  if (!key) return false;
  return acceptedOf(project).some((item) => item.key === key);
}

/**
 * «Так и задумано»: предупреждение уходит из списка, ответ остаётся в объекте.
 * Принимается и ошибка — объект принадлежит пользователю, — но её вид
 * запоминается, чтобы в списке принятых порванную связь было видно.
 * Принято повторно — возвращается **тот же** объект: ни второй записи, ни
 * лишнего шага истории.
 */
export function acceptProblem(project, problem) {
  if (!project || !problem || !problem.key) return { project };
  if (problemAccepted(project, problem.key)) return { project };
  const record = {
    key: problem.key,
    code: problem.code,
    kind: problem.kind === "warning" ? "warning" : "error",
    label: String(problem.message || ""),
    at: nowIso(),
  };
  return { project: withProject(project, { accepted: [...acceptedOf(project), record] }) };
}

/**
 * Вернуть принятое в работу: запись уходит, и предупреждение снова считается —
 * если оно всё ещё есть. Нечего возвращать — тот же объект.
 */
export function unacceptProblem(project, key) {
  if (!project) return { project };
  const list = acceptedOf(project);
  const next = list.filter((item) => item.key !== key);
  if (next.length === list.length) return { project };
  return { project: withProject(project, { accepted: next }) };
}

/**
 * Перенос принятого на новые номера. Смыкание меняет Т4 на Т2, и ответ «так и
 * задумано» обязан переехать вместе с обозначением: иначе он повиснет на
 * номере, которого больше нет, а на новом номере тот же вопрос задастся
 * заново — пользователь ответит дважды на одно и то же.
 *
 * Зовётся из `compactNumbers` по её же таблице замен, поэтому работает и для
 * «у всех типов» (`compactAllNumbers` считает той же функцией), и в том же
 * шаге истории: отмена смыкания возвращает и номера, и принятия.
 *
 * Номер, под которым меток уже нет, смыкание не переносит — переносить его
 * некуда; такая запись остаётся в списке принятых и видна пользователю.
 *
 * Переносить нечего — `null`: объект прежнего формата не должен обзавестись
 * пустым списком принятых только потому, что в нём сомкнули номера.
 */
function renumberAccepted(project, typeId, code, renumbered) {
  const list = acceptedOf(project);
  if (list.length === 0) return null;
  const prefix = "repeatedNumber:" + typeId + "#";
  let changed = false;
  const next = list.map((record) => {
    if (typeof record.key !== "string" || !record.key.startsWith(prefix)) return record;
    const was = Number(record.key.slice(prefix.length));
    const now = renumbered.get(was);
    if (!now || now === was) return record;
    changed = true;
    return { ...record, key: prefix + now, label: relabelAccepted(record.label, code + was, code + now) };
  });
  return changed ? next : null;
}

/**
 * Перенос принятого на номера, разведённые слиянием.
 *
 * Слияние двух экземпляров объекта иногда обязано развести номер: двое, не
 * видя друг друга, выдали новым меткам одно обозначение. Если переезжает целая
 * намеренная группа («три светильника Т4»), вместе с ней обязан переехать и
 * ответ «так и задумано» — иначе на новом номере тот же вопрос задастся
 * заново, и задастся молча, потому что слияние применяется без спроса.
 *
 * `moves` — `[{typeId, code, from, to, keepFrom}]`. `keepFrom` говорит, что на
 * старом номере повтор остался (номер разошёлся надвое): тогда ответ не
 * переезжает, а **копируется** — пользователь отвечал про эти метки, и обе
 * половины несут тот же замысел. Без `keepFrom` запись переименовывается.
 *
 * Своя запись не подменяется: если на новом номере ответ уже есть, чужой
 * поверх него не ложится. Переносить нечего — `null`: объект прежнего формата
 * не обзаводится пустым списком принятых из-за чужого слияния.
 */
export function renumberAcceptedRepeats(project, moves) {
  const list = acceptedOf(project);
  if (list.length === 0 || !Array.isArray(moves) || moves.length === 0) return null;
  const keys = new Set(list.map((record) => record.key));
  const renamed = new Map();
  const added = [];
  for (const move of moves) {
    if (!move || !move.typeId || move.from === move.to) continue;
    const prefix = "repeatedNumber:" + move.typeId + "#";
    const fromKey = prefix + move.from;
    const toKey = prefix + move.to;
    if (!keys.has(fromKey) || keys.has(toKey) || renamed.has(fromKey)) continue;
    const record = list.find((item) => item.key === fromKey);
    const next = {
      ...record,
      key: toKey,
      label: relabelAccepted(record.label, move.code + move.from, move.code + move.to),
    };
    keys.add(toKey);
    if (move.keepFrom) added.push(next);
    else renamed.set(fromKey, next);
  }
  if (renamed.size === 0 && added.length === 0) return null;
  const next = list.map((record) => renamed.get(record.key) || record);
  return added.length === 0 ? next : [...next, ...added];
}

// Обозначение в запомненном тексте: «Т4 — таких меток 3» после смыкания читается
// как «Т2 — таких меток 3». Меняется только обозначение в начале строки и только
// целиком — «Т1» внутри «Т10» не тронется.
function relabelAccepted(label, from, to) {
  const value = String(label == null ? "" : label);
  if (!value.startsWith(from)) return value;
  const rest = value.slice(from.length);
  if (/^\d/.test(rest)) return value;
  return to + rest;
}
