// Встроенный каталог видов проёма (таск 215, требования G321 и G325).
//
// ——— почему он встроенный ———
//
// Слова заказчика: «выбор проёмов сделай как и у объектов». У вещей чертежа
// каталог — **данные сборки** (`objectCatalog.js`, решение G225: «без кастомных
// для объектов, не усложняем»), и у проёмов причина та же, только сильнее: вид
// проёма — это не запись в справочнике, а **рисунок в трёх местах сразу**
// (план, развёртка, объём). Новый вид появляется правкой кода, и своих видов
// проёма человек не заводит.
//
// ——— сколько у проёма реестров ———
//
// У вещи ключ живёт в трёх реестрах: каталог, изображение (`objectViews`) и
// модель (`objectModels`). **У проёма их не три, а один** — этот файл, — и
// отдельного изображения у вида проёма нет вовсе: проём рисуется своей
// геометрией в стене, а не картинкой в клетке. Поэтому вместо реестра
// изображений у записи лежит **описание того, чем вид отличается**: как ходит
// полотно (`motion`), сколько створок (`leaves`), чем делится просвет
// (`face`). Эти три поля читают все три поверхности и плитка выбора — одна
// запись, четыре читателя, и ни одного места, куда надо не забыть вписаться.
//
// ——— что лежит у вида ———
//
//   `kind`      — ключ. Он же значение `opening.kind` в `project.json`, поэтому
//                 переименовать его нельзя никогда (G68).
//   `category`  — раздел выбора: двери, окна, проёмы, ворота.
//   `family`    — порода: `door`, `window`, `plain`, `gate`. По ней решается,
//                 ходят ли сквозь проём и можно ли его остеклить.
//   `motion`    — как ходит полотно: `swing` (на петлях), `slide` (вдоль
//                 стены), `fold` (гармошкой), `pocket` (внутрь стены), `lift`
//                 (вверх), `null` (полотна нет).
//   `leaves`    — сколько створок: 0, 1 или 2.
//   `face`      — чем делится просвет в лицевой проекции: `cols` секций по
//                 ширине, `rows` по высоте, `beltMm` — нижняя полоса до пояса,
//                 `slatMm` — шаг ламелей вместо числа полос.
//   `head`      — чем кончается просвет сверху: `"arch"` — дугой, пусто —
//                 прямой перемычкой (таск 219, G329).
//   габариты    — умолчания **нового** проёма этого вида; человек правит их у
//                 себя на чертеже, и правка запоминается на сеанс.
//   `glazed`    — вид, который остеклён сам по себе. Сегодня один —
//                 `glassDoor`, и он же `legacy`.
//   `base`      — какая плитка горит у такого вида: у `glassDoor` это
//                 распашная дверь, потому что стекло у неё — отметка, а не
//                 порода.
//   `legacy`    — вид прежней разметки: в плитках его нет, но по нему
//                 открываются уже размеченные чертежи (G68). Тот же приём, что
//                 у вещи с отметкой `legacy` в каталоге объектов.
//
// Имена видов лежат в словаре (`strings.openingKinds`), как и всё видимое
// глазу: второго места с русскими словами в сборке нет.
import { strings } from "./strings.js";

/**
 * Разделы каталога. Порядок — порядок выбора, и он же порядок разговора
 * заказчика: «Двери… Окна… Арка. Проём. Гаражные ворота».
 *
 * Люк и витраж (G325) своего раздела не получили нарочно: заказчик сказал
 * «разделение по категориям оставь осмысленным», а витраж в пол — это окно, и
 * стоит он в «Окнах» рядом с балконным, с которым его и ставят.
 */
export const OPENING_CATEGORIES = ["doors", "windows", "plain", "gates"];

/** Породы проёма. Решают, ходят ли сквозь него и бывает ли он стеклянным. */
export const OPENING_FAMILIES = ["door", "window", "plain", "gate"];

/** Как ходит полотно. `null` — полотна у вида нет вовсе (окно, арка, проём). */
export const OPENING_MOTIONS = ["swing", "slide", "fold", "pocket", "lift"];

/**
 * **Пояс** — высота нижней полосы балконного остекления.
 *
 * Слова заказчика: «балконные для полного остекления — снизу 3 секции до пояса
 * +-, и выше 3 секции большие по высоте». Пояс у человека — 900…1000 мм от
 * пола; взято 900: при проёме 2500 нижняя полоса выходит 900, верхняя 1600, то
 * есть ровно «выше секции большие по высоте».
 */
export const OPENING_BELT_MM = 900;

/**
 * Шаг ламели роллетных ворот. Роллетный профиль бывает 55…100 мм; взято
 * наибольшее — на листе и на плитке выбора сотая доля высоты различима, а
 * пятидесятая слилась бы в серое поле.
 */
export const OPENING_SLAT_MM = 100;

// ——— числа умолчаний ———————————————————————————————————————————————————
//
// **Умолчания обязательны, а не удобны** (правило таска 126): человек ставит
// десять окон подряд и вводить по четыре числа на каждое не станет. Откуда
// числа:
//
//   **пять прежних видов** сохраняют свои числа до миллиметра (таски 126 и
//   180): окно 1500 × 1400 с подоконником на 800, дверь 900 × 2100, стеклянная
//   балконная 800 × 2200, проём как дверь, арка пошире — 1200. Поменяй их — и у
//   человека, который ставит проёмы по привычке, поехали бы все новые;
//
//   **двери** — тот же проём, что у распашной: сдвижная, гармошка и портальная
//   садятся в проём 900 × 2100, меняется привод, а не дырка в стене.
//   Двустворчатая — 1400: двупольный блок по ГОСТ 6629 бывает 1200, 1400 и
//   1500 мм по проёму, и 1400 — ходовой под две створки по 600;
//
//   **окна** — двойное делит тот же проём 1500 импостом пополам (две створки
//   по 750), тройное шире: 2100 — это три стеклопакета по 700, ходовое
//   трёхстворчатое окно комнаты. Балконное 3000 × 2500 от пола — «полное
//   остекление» тремя секциями по 1000. Витраж в пол 2000 × 2500 одной
//   секцией;
//
//   **гаражные ворота** — 2500 × 2250 от пола, и это середина посадки, которую
//   назвал заказчик (2500…3000 × 2100…2500). Ширина: автомобиль каталога
//   1800 мм по корпусу, и по 350 мм на сторону — зеркала и запас на въезд.
//   Высота: стандартная ступень секционных ворот (2125 / 2250 / 2500), в
//   которую въезжает кроссовер габаритной высоты 2,0 м с запасом на привод под
//   перемычкой.
const OPENINGS = [
  // ——— двери ———
  {
    kind: "door",
    category: "doors",
    family: "door",
    motion: "swing",
    leaves: 1,
    face: { cols: 1, rows: 1 },
    widthMm: 900,
    heightMm: 2100,
    heightAboveFloorMm: 0,
  },
  {
    kind: "doorDouble",
    category: "doors",
    family: "door",
    motion: "swing",
    leaves: 2,
    face: { cols: 2, rows: 1 },
    widthMm: 1400,
    heightMm: 2100,
    heightAboveFloorMm: 0,
  },
  {
    kind: "doorSliding",
    category: "doors",
    family: "door",
    motion: "slide",
    leaves: 1,
    face: { cols: 1, rows: 1 },
    widthMm: 900,
    heightMm: 2100,
    heightAboveFloorMm: 0,
  },
  // Гармошка и портальная (G325) живут **той же механикой, что сдвижная**, и
  // только поэтому они здесь: у них одна и та же пара признаков — по какой
  // стороне стены идёт полотно и в какую сторону уходит, — и ни одной своей
  // геометрии створок они не тянут. Отличаются рисунком полотна: у гармошки
  // оно сложено в четыре звена, у портальной уезжает в стену и видно только
  // её карман.
  {
    kind: "doorFolding",
    category: "doors",
    family: "door",
    motion: "fold",
    leaves: 1,
    face: { cols: 4, rows: 1 },
    widthMm: 900,
    heightMm: 2100,
    heightAboveFloorMm: 0,
  },
  {
    kind: "doorPocket",
    category: "doors",
    family: "door",
    motion: "pocket",
    leaves: 1,
    face: { cols: 1, rows: 1 },
    widthMm: 900,
    heightMm: 2100,
    heightAboveFloorMm: 0,
  },
  // **Стеклянная дверь прежней разметки** (таск 180). С таска 215 стекло —
  // отметка у любой двери, и новая разметка пишет `door` плюс `glazed`. Этот
  // вид остаётся ради уже размеченных чертежей: в плитках его нет, а горит у
  // него плитка распашной двери с поставленной отметкой.
  {
    kind: "glassDoor",
    category: "doors",
    family: "door",
    motion: "swing",
    leaves: 1,
    face: { cols: 1, rows: 1 },
    widthMm: 800,
    heightMm: 2200,
    heightAboveFloorMm: 0,
    glazed: true,
    base: "door",
    legacy: true,
  },
  // ——— окна ———
  {
    kind: "window",
    category: "windows",
    family: "window",
    motion: null,
    leaves: 0,
    face: { cols: 1, rows: 1 },
    widthMm: 1500,
    heightMm: 1400,
    heightAboveFloorMm: 800,
  },
  {
    kind: "windowDouble",
    category: "windows",
    family: "window",
    motion: null,
    leaves: 0,
    face: { cols: 2, rows: 1 },
    widthMm: 1500,
    heightMm: 1400,
    heightAboveFloorMm: 800,
  },
  {
    kind: "windowTriple",
    category: "windows",
    family: "window",
    motion: null,
    leaves: 0,
    face: { cols: 3, rows: 1 },
    widthMm: 2100,
    heightMm: 1400,
    heightAboveFloorMm: 800,
  },
  {
    kind: "windowBalcony",
    category: "windows",
    family: "window",
    motion: null,
    leaves: 0,
    face: { cols: 3, rows: 2, beltMm: OPENING_BELT_MM },
    widthMm: 3000,
    heightMm: 2500,
    heightAboveFloorMm: 0,
  },
  {
    kind: "windowGlazing",
    category: "windows",
    family: "window",
    motion: null,
    leaves: 0,
    face: { cols: 1, rows: 1 },
    widthMm: 2000,
    heightMm: 2500,
    heightAboveFloorMm: 0,
  },
  // ——— проёмы ———
  {
    kind: "opening",
    category: "plain",
    family: "plain",
    motion: null,
    leaves: 0,
    face: { cols: 1, rows: 1 },
    widthMm: 900,
    heightMm: 2100,
    heightAboveFloorMm: 0,
  },
  // **У арки верх дугой** (таск 219, требование G329): «У арки дорисуй дугу и
  // на развёртке и в объёме». До таска 219 арка отличалась от проёма только
  // пунктиром на плане, а на листе и в объёме была прямоугольником — заказчик
  // это отменил. `head` — единственное место, где сказано, что верх у вида не
  // прямой; форму считает `model.openingArchGeometry`.
  {
    kind: "arch",
    category: "plain",
    family: "plain",
    motion: null,
    leaves: 0,
    head: "arch",
    face: { cols: 1, rows: 1 },
    widthMm: 1200,
    heightMm: 2100,
    heightAboveFloorMm: 0,
  },
  // ——— гаражные ворота ———
  //
  // Распашные и сдвижные — та же пара признаков, что у дверей, и достаются они
  // даром. Роллетные и подъёмно-секционные **полотна в сторону не уводят**: у
  // них нет ни петель, ни стороны стены — полотно уходит вверх, в вал под
  // перемычкой или под потолок. Поэтому у них `motion: "lift"`, и состояния
  // «открыто» у них нет (см. `openingLiftOpen`).
  {
    kind: "gateSwing",
    category: "gates",
    family: "gate",
    motion: "swing",
    leaves: 2,
    face: { cols: 2, rows: 1 },
    widthMm: 2500,
    heightMm: 2250,
    heightAboveFloorMm: 0,
  },
  {
    kind: "gateSliding",
    category: "gates",
    family: "gate",
    motion: "slide",
    leaves: 1,
    face: { cols: 1, rows: 1 },
    widthMm: 2500,
    heightMm: 2250,
    heightAboveFloorMm: 0,
  },
  {
    kind: "gateRoller",
    category: "gates",
    family: "gate",
    motion: "lift",
    leaves: 1,
    face: { cols: 1, slatMm: OPENING_SLAT_MM },
    widthMm: 2500,
    heightMm: 2250,
    heightAboveFloorMm: 0,
  },
  {
    kind: "gateSectional",
    category: "gates",
    family: "gate",
    motion: "lift",
    leaves: 1,
    // Четыре панели: при высоте 2250 секция выходит 560 мм — ровно то, что
    // ставят (панели секционных ворот 500…610 мм).
    face: { cols: 1, rows: 4 },
    widthMm: 2500,
    heightMm: 2250,
    heightAboveFloorMm: 0,
  },
];

// Имя приклеивается при чтении, а не лежит в записи: словарь — единственное
// место с русскими словами, и запись каталога не должна их дублировать.
const openingNamed = (entry) => (entry ? { ...entry, name: strings.openingKinds[entry.kind] || entry.kind } : null);

const OPENING_BY_KIND = new Map(OPENINGS.map((entry) => [entry.kind, entry]));

/** Все виды по порядку: сперва раздел, внутри — порядок записи. */
export function openingCatalogInOrder() {
  return OPENING_CATEGORIES.flatMap((category) =>
    OPENINGS.filter((entry) => entry.category === category).map(openingNamed),
  );
}

/** Виды одного раздела. Чужой раздел — пустой список, а не все подряд. */
export function openingCatalogCategory(category) {
  return OPENINGS.filter((entry) => entry.category === category).map(openingNamed);
}

/** Вид по ключу. `null` — такого вида в каталоге нет. */
export function openingCatalogEntry(kind) {
  return kind && OPENING_BY_KIND.has(kind) ? openingNamed(OPENING_BY_KIND.get(kind)) : null;
}

/** Все ключи — порядок каталога, он же порядок плиток и кнопок. */
export function openingCatalogKinds() {
  return OPENINGS.map((entry) => entry.kind);
}

/** Имя вида. Пусто — ключа нет. */
export function openingCatalogName(kind) {
  const entry = openingCatalogEntry(kind);
  return entry ? entry.name : "";
}

/**
 * Умолчания размеров нового проёма этого вида. **Копией**: их кладут в поля
 * окна и правят там, а каталог обязан остаться каталогом.
 */
export function openingCatalogDefaults(kind) {
  const entry = openingCatalogEntry(kind);
  if (!entry) return null;
  return {
    widthMm: entry.widthMm,
    heightMm: entry.heightMm,
    heightAboveFloorMm: entry.heightAboveFloorMm,
  };
}
