// Встроенный каталог вещей чертежа (таск 154, требования G220, G223–G225).
//
// ——— почему он встроенный ———
//
// Заказчик провёл границу сам: «У нас есть 2 типа объектов — статичные,
// которые расставляются на чертеже, они чисто для отображения… а есть другой
// тип — метки. Это уже интерактивные элементы… Вот метки можно расширять. А
// статичные объекты — встроенный каталог». И следом: «без кастомных для
// объектов, не усложняем».
//
// Поэтому каталог — **данные сборки**, а не справочник внутри объекта. Новая
// вещь появляется правкой этого файла, и ключ у неё один на все объекты и на
// все машины: по ключу её узнают модель (таск 155), объём (лестница и этажи) и
// высота установки. Прежний справочник `project.schemeObjectKinds` со свежими
// id на каждый объект остаётся ровно для одного — чтобы **уже размеченные
// объекты открывались как прежде** (G68): вещь с `kindId` читает своё имя
// оттуда, и переименованный руками вид остаётся переименованным.
//
// ——— что лежит у вещи ———
//
//   `key`        — ключ каталога. Он же ключ модели (`objectModels/objects.js`)
//                  и он же имя изображения (`objectViews/objects.js`): три
//                  реестра сходятся на одном слове, и «добавить вещь» — это
//                  запись здесь, рисунок там и тело там, без четвёртого места,
//                  куда надо не забыть вписаться.
//   `category`   — раздел выбора. Сперва категория, потом вещи (G224).
//   `mount`      — где стоит: на полу, на стене или в полу. Решает, что
//                  показывать в высоте, и пригодится моделям.
//   габариты     — длина × глубина × высота и высота от пола. Это **умолчания
//                  поставленной вещи**: человек правит их у себя на чертеже,
//                  как правил и раньше (G192).
//   `words`      — корни, по которым **имя прежнего вида** узнаётся как эта
//                  вещь. Мост для уже размеченных объектов: ключа у них нет, а
//                  имя есть. Сравнение терпимое (регистр, «ё», пробелы по
//                  краям), и ищется от самого длинного корня — «Столешница»
//                  содержит «стол», а стол со столешницей разные вещи.
//
// Имена вещей лежат в словаре (`strings.schemeObjectKinds`), как и всё видимое
// глазу: второго места с русскими словами в сборке нет.
import { strings } from "./strings.js";

/** Разделы каталога. Порядок — порядок выбора. */
export const OBJECT_CATEGORIES = ["furniture", "sanitary", "appliances", "structures", "engineering", "decor"];

/**
 * Где вещь стоит.
 *
 * `floor` — на полу: стол, шкаф, холодильник. Высота от пола нулевая.
 * `wall` — на стене: картина, полотенцесушитель, радиатор, щит. У такой вещи
 *   высота от пола обязательна и не нулевая — ею она и задана.
 * `inFloor` — в полу: бассейн. Над полом остаётся борт, а чаша уходит вниз;
 *   высота у такой вещи — то, что видно над полом.
 */
export const OBJECT_MOUNTS = ["floor", "wall", "inFloor"];

// Числа — то, что стоит в квартире, и взяты они по трём статьям:
//
//   **девять прежних видов** сохраняют свои числа до миллиметра (таск 122):
//   радиатор 1200 × 100 высотой 500 от пола 150 — он висит под окном ровно
//   там, где хочется розетка; столешница полосой 600 с верхом на 900 (860+40)
//   — от этого числа отмеряют розетки над кухонным фронтом. Поменяй их — и у
//   человека, который ставит вещи по привычке, поехали бы все новые;
//
//   **бытовая техника** — её стандарт: корпус 600 × 600, высота 850 под
//   столешницу 900 (холодильник 1850 — числа заказчика из тикета);
//
//   **мебель и сантехника** — ходовой размер: обеденный стол 1400 × 800
//   высотой 750, кровать 1600 × 2000 высотой 500 (числа заказчика), раковина
//   верхом на 850, душевой уголок 900 × 900.
//
// Высота `null` — «во всю высоту помещения»: у колонны, ниши, короба и
// лестницы своего числа нет, и выдумывать его значило бы врать.
const CATALOG = [
  // ——— мебель ———
  {
    key: "table",
    category: "furniture",
    mount: "floor",
    shape: "rect",
    widthMm: 1400,
    depthMm: 800,
    heightMm: 750,
    heightAboveFloorMm: 0,
    words: ["стол"],
  },
  {
    key: "bed",
    category: "furniture",
    mount: "floor",
    shape: "rect",
    widthMm: 1600,
    depthMm: 2000,
    heightMm: 500,
    heightAboveFloorMm: 0,
    words: ["кроват"],
  },
  {
    key: "dresser",
    category: "furniture",
    mount: "floor",
    shape: "rect",
    widthMm: 450,
    depthMm: 400,
    heightMm: 550,
    heightAboveFloorMm: 0,
    words: ["тумб"],
  },
  {
    key: "cabinet",
    category: "furniture",
    mount: "floor",
    shape: "rect",
    widthMm: 1000,
    depthMm: 600,
    heightMm: 2200,
    heightAboveFloorMm: 0,
    words: ["шкаф"],
  },
  // Столешница идёт полосой: длина у неё по стене с поворотом, а глубина одна —
  // ровно для этого полоса и заведена.
  {
    key: "counter",
    category: "furniture",
    mount: "floor",
    shape: "polyline",
    widthMm: 2000,
    depthMm: 600,
    heightMm: 40,
    heightAboveFloorMm: 860,
    words: ["столешниц", "кухонн"],
  },

  // ——— сантехника ———
  {
    key: "sink",
    category: "sanitary",
    mount: "floor",
    shape: "rect",
    widthMm: 600,
    depthMm: 500,
    heightMm: 850,
    heightAboveFloorMm: 0,
    words: ["раковин", "мойк"],
  },
  {
    key: "shower",
    category: "sanitary",
    mount: "floor",
    shape: "rect",
    widthMm: 900,
    depthMm: 900,
    heightMm: 2200,
    heightAboveFloorMm: 0,
    words: ["душ"],
  },
  {
    key: "towelDryer",
    category: "sanitary",
    mount: "wall",
    shape: "rect",
    widthMm: 500,
    depthMm: 100,
    heightMm: 800,
    heightAboveFloorMm: 900,
    words: ["полотенцесуш"],
  },
  // Бассейн: 4 × 2 м — домашний, а не спортивный. Над полом остаётся борт в
  // 300 мм: глубину чаши объём не выкапывает, и обещать её числом нечестно.
  {
    key: "pool",
    category: "sanitary",
    mount: "inFloor",
    shape: "rect",
    widthMm: 4000,
    depthMm: 2000,
    heightMm: 300,
    heightAboveFloorMm: 0,
    words: ["бассейн"],
  },
  // Общий вид «Сантехника» из прежнего справочника: унитаз, биде, ванна — всё,
  // что заводили одним видом до каталога. Остаётся, потому что им уже
  // размечены чужие чертежи.
  {
    key: "plumbing",
    category: "sanitary",
    mount: "floor",
    shape: "rect",
    widthMm: 700,
    depthMm: 400,
    heightMm: 400,
    heightAboveFloorMm: 0,
    words: ["сантехник", "унитаз"],
  },

  // ——— техника ———
  {
    key: "fridge",
    category: "appliances",
    mount: "floor",
    shape: "rect",
    widthMm: 600,
    depthMm: 600,
    heightMm: 1850,
    heightAboveFloorMm: 0,
    words: ["холодильн"],
  },
  {
    key: "stove",
    category: "appliances",
    mount: "floor",
    shape: "rect",
    widthMm: 600,
    depthMm: 600,
    heightMm: 900,
    heightAboveFloorMm: 0,
    words: ["плит", "варочн"],
  },
  {
    key: "dishwasher",
    category: "appliances",
    mount: "floor",
    shape: "rect",
    widthMm: 600,
    depthMm: 600,
    heightMm: 850,
    heightAboveFloorMm: 0,
    words: ["посудомо"],
  },
  {
    key: "washer",
    category: "appliances",
    mount: "floor",
    shape: "rect",
    widthMm: 600,
    depthMm: 600,
    heightMm: 850,
    heightAboveFloorMm: 0,
    words: ["стиральн"],
  },
  {
    key: "dryerMachine",
    category: "appliances",
    mount: "floor",
    shape: "rect",
    widthMm: 600,
    depthMm: 600,
    heightMm: 850,
    heightAboveFloorMm: 0,
    words: ["сушильн"],
  },

  // ——— конструкции ———
  {
    key: "column",
    category: "structures",
    mount: "floor",
    shape: "rect",
    widthMm: 400,
    depthMm: 400,
    heightMm: null,
    heightAboveFloorMm: 0,
    words: ["колонн"],
  },
  {
    key: "niche",
    category: "structures",
    mount: "floor",
    shape: "rect",
    widthMm: 1000,
    depthMm: 300,
    heightMm: null,
    heightAboveFloorMm: 0,
    words: ["ниш"],
  },
  {
    key: "duct",
    category: "structures",
    mount: "floor",
    shape: "rect",
    widthMm: 300,
    depthMm: 300,
    heightMm: null,
    heightAboveFloorMm: 0,
    words: ["короб", "стояк"],
  },
  // Лестница в каталоге **обязательно** (таск 154): по ключу её узнаёт объём и
  // переводит человека на другой этаж (таск 149). До каталога она узнавалась
  // по имени вида — переименовал человек, и перехода нет.
  {
    key: "stairs",
    category: "structures",
    mount: "floor",
    shape: "rect",
    widthMm: 1100,
    depthMm: 2700,
    heightMm: null,
    heightAboveFloorMm: 0,
    words: ["лестни", "stair"],
  },

  // ——— инженерия ———
  {
    key: "radiator",
    category: "engineering",
    mount: "wall",
    shape: "rect",
    widthMm: 1200,
    depthMm: 100,
    heightMm: 500,
    heightAboveFloorMm: 150,
    words: ["радиатор", "отоплен"],
  },
  {
    key: "panel",
    category: "engineering",
    mount: "wall",
    shape: "rect",
    widthMm: 600,
    depthMm: 150,
    heightMm: 800,
    heightAboveFloorMm: 1000,
    words: ["щит"],
  },

  // ——— декор ———
  // Картина: 800 × 600 на стене, низ на 1300 — середина полотна приходится на
  // уровень глаз (1600), так её и вешают.
  {
    key: "picture",
    category: "decor",
    mount: "wall",
    shape: "rect",
    widthMm: 800,
    depthMm: 40,
    heightMm: 600,
    heightAboveFloorMm: 1300,
    words: ["картин"],
  },
];

// Имя приклеивается при чтении, а не лежит в записи: словарь — единственное
// место с русскими словами, и запись каталога не должна их дублировать.
const named = (entry) => (entry ? { ...entry, name: strings.schemeObjectKinds[entry.key] || entry.key } : null);

const BY_KEY = new Map(CATALOG.map((entry) => [entry.key, entry]));

// Корни ищутся от самого длинного: «Столешница (кухонный фронт)» содержит и
// «столешниц», и «стол».
const WORDS = CATALOG.flatMap((entry) => (entry.words || []).map((word) => ({ key: entry.key, word }))).sort(
  (left, right) => right.word.length - left.word.length,
);

/** Все вещи каталога по порядку: сперва категория, внутри — порядок записи. */
export function objectCatalogInOrder() {
  return OBJECT_CATEGORIES.flatMap((category) =>
    CATALOG.filter((entry) => entry.category === category).map(named),
  );
}

/** Вещи одной категории. Чужая категория — пустой список, а не все подряд. */
export function objectCatalogCategory(category) {
  return CATALOG.filter((entry) => entry.category === category).map(named);
}

/** Вещь по ключу. `null` — такого ключа в каталоге нет. */
export function objectCatalogEntry(key) {
  return key && BY_KEY.has(key) ? named(BY_KEY.get(key)) : null;
}

/** Все ключи — для сверки охвата моделями и изображениями. */
export function objectCatalogKeys() {
  return CATALOG.map((entry) => entry.key);
}

/** Имя вещи каталога. Пусто — ключа нет. */
export function objectCatalogName(key) {
  const entry = objectCatalogEntry(key);
  return entry ? entry.name : "";
}

/**
 * Умолчания размеров вещи: форма, габарит, высота и высота от пола.
 *
 * Отдаются **копией** — их кладут в поля колонки и правят там, а каталог
 * обязан остаться каталогом.
 */
export function objectCatalogDefaults(key) {
  const entry = objectCatalogEntry(key);
  if (!entry) return null;
  return {
    shape: entry.shape,
    widthMm: entry.widthMm,
    depthMm: entry.depthMm,
    heightMm: entry.heightMm,
    heightAboveFloorMm: entry.heightAboveFloorMm,
  };
}

/**
 * Ключ каталога по **имени прежнего вида** — мост для уже размеченных
 * объектов (G68).
 *
 * Сравнение терпимое, как у лестницы в объёме (`volumeStairKind`): регистр,
 * «ё» и пробелы по краям не считаются, внутри строки ищется корень. Поэтому
 * «Шкаф», «шкафы» и «Шкаф в прихожей» узнаются все, а переименованный в
 * «Пенал» — никто: такая вещь остаётся на чертеже со своим именем и своим
 * габаритом, просто без модели и без ключа.
 */
export function objectCatalogKeyByName(name) {
  const plain = String(name || "")
    .trim()
    .toLowerCase()
    .replace(/ё/g, "е");
  if (plain === "") return null;
  for (const entry of WORDS) {
    if (plain.includes(entry.word)) return entry.key;
  }
  return null;
}
