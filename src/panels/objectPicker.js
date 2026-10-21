// Окно выбора вещи чертежа (таск 170, требование G252).
//
// Слова заказчика: «механеику выбора для добавления и изменения объекта сделай
// как для меток — в отдельном окне». До этого вещи выбирались плитками **прямо
// в колонке** (таск 154), и довод был свой: кухню собирают из шести предметов
// подряд, и окно пришлось бы открывать на каждый. Заказчик решил иначе, но
// довод никуда не делся — вот что сделано, чтобы шесть вещей подряд не стали
// шестью мучениями:
//
//   1. **Шага категории больше нет.** В колонке на 264 точки плитки влезали
//      только по одной категории, и до холодильника надо было сперва выбрать
//      «Технику». Окно шире колонки втрое: все вещи каталога стоят в нём
//      сразу, категориями по колонкам, и до любой из них — один клик.
//   2. **Выбранная вещь залипает** — ровно как тип метки в панели инструментов
//      (`tools__type`). Окно открывается один раз на серию: шесть одинаковых
//      розеток или шесть шкафов ставятся кликами по полю без единого диалога.
//   3. **Поиск с клавиатуры.** «хол» и Enter — холодильник выбран, мышь не
//      нужна; стрелки водят по плиткам, как по строкам окна типов.
//
// Механизм — тот же, что у выбора типа метки, и скелет у них общий, из
// кирпичей `ui.js` (таск 183): карточка `uiPickCard`, поиск `uiPickSearch`,
// клавиатура `uiPickKeys`. Раскладку колонок считает общий `pickerLayout` из
// `typePicker.js` (он же считает её для типов — второго такого механизма в
// сборке нет). Отличается клетка: у типа строка «знак — код — название», у
// вещи плитка «картинка — имя» (G224, плитки переехали сюда из колонки
// чертежа), — и шаг стрелки: она прыгает на ряд из трёх плиток.
//
// **Вещь с отметкой `legacy` из окна спрятана** (сегодня одна — общий вид
// «Сантехника»): ею больше не размечают, но по ней открываются чужие чертежи.
// Прячет её окно, а не каталог — что показать в выборе, дело экрана, — и
// показывает обратно, пока такой вещью стоит выделенное: человек обязан
// видеть, чем стоит вещь на его чертеже, а подсветить вместо неё похожую
// значило бы соврать.
import { objectCatalogCategory, OBJECT_CATEGORIES } from "../objectCatalog.js";
import { drawObjectView, objectViewByName } from "../objectViews/registry.js";
import { strings } from "../strings.js";
import { uiEl, uiPickCard, uiPickKeys, uiPickSearch } from "./ui.js";
import { pickerColumnLimit, pickerLayout } from "./typePicker.js";

// Клетка картинки на плитке. Сорок точек — столько же, сколько у крупного
// знака типа метки в разделе «Метки»: мельче у кровати не разобрать подушек.
export const OBJECT_TILE_ICON = 40;
// Цвет рисунка — цвет текста панели: плитка не красит вещь, она её показывает.
// Цвет на чертеже у объектов свой и общий, и повторять его тут значило бы
// обещать выбор краски, которого нет.
//
// Вынесен наружу в таске 215: той же краской рисует плитку каталог проёмов, и
// второго такого цвета в сборке быть не должно — две сетки плиток стоят в одном
// окне «Что добавить», и разойдись краски, одна из них читалась бы погасшей.
export const TILE_INK = "#e6edf3";

/**
 * Картинка вещи в клетке. Рисуется в точках устройства, а показывается в
 * точках страницы: на экране с удвоенной плотностью контур иначе размылся бы.
 *
 * `color` — краска контура; умолчание `TILE_INK` оставляет плитку плиткой.
 * Справочник типов (таск 218) просит цвет категории: там изображение стоит в
 * строке типа, и красится оно так же, как встанет на развёртку.
 */
export function objectTileIcon(key, size = OBJECT_TILE_ICON, color = TILE_INK) {
  const canvas = uiEl("canvas", { class: "objectTile__icon" });
  const ratio = typeof devicePixelRatio === "number" && devicePixelRatio > 0 ? Math.min(3, devicePixelRatio) : 1;
  canvas.width = Math.round(size * ratio);
  canvas.height = Math.round(size * ratio);
  canvas.style.width = size + "px";
  canvas.style.height = size + "px";
  const ctx = canvas.getContext ? canvas.getContext("2d") : null;
  const icon = objectViewByName(key);
  if (ctx && icon) drawObjectView(ctx, icon, { x: 0, y: 0, width: canvas.width, height: canvas.height }, color);
  return canvas;
}

// Плиток в ряду внутри категории. Та же тройка стоит в `objectPicker.css`
// (`grid-template-columns: repeat(3, …)`), и держать её надо вместе: по ней
// здесь считается высота категории для раскладки колонок и шаг стрелок
// вверх-вниз. Разойдись эти числа — стрелка прыгала бы не на ряд.
export const OBJECT_PICKER_TILES_PER_ROW = 3;
// Колонка в три плитки по 84 точки с просветами — та же мера, что в
// `objectPicker.css` (`minmax(270px, 1fr)`); держит их вместе
// `test/cssMeasures.test.js`.
export const OBJECT_PICKER_COLUMN_MIN = 270;
// Больше четырёх колонок не ставим: категорий всего семь (седьмая —
// «Транспорт», таск 204), и пятая колонка растянула бы окно на весь экран ради
// одной плитки «Декора».
const OBJECT_PICKER_MAX_COLUMNS = 4;

/** Сколько колонок категорий помещается в экран шириной `width`. */
export function objectPickerColumnLimit(width) {
  return Math.min(OBJECT_PICKER_MAX_COLUMNS, pickerColumnLimit(width, OBJECT_PICKER_COLUMN_MIN));
}

// Высота категории в единицах раскладки: заголовок плюс ряды плиток.
export function objectPickerWeight(group) {
  const count = group && Array.isArray(group.entries) ? group.entries.length : 0;
  return 1 + Math.ceil(count / OBJECT_PICKER_TILES_PER_ROW);
}

// Терпимое сравнение, как у каталога: регистр, «ё» и пробелы по краям не
// считаются. Поиск идёт по имени вещи и по имени её категории — «сантех»
// показывает весь раздел, «хол» одну плитку.
function plain(value) {
  return String(value == null ? "" : value)
    .trim()
    .toLowerCase()
    .replace(/ё/g, "е");
}

/**
 * Подходит ли плитка под запрос: по имени вещи или по имени её раздела.
 *
 * **Одно правило на всю сетку плиток** (таск 218): сетку изображений в
 * справочнике типов собирают из тех же кирпичей, и её разделы — свои. Разойдись
 * правила — в одном окне половина плиток искалась бы иначе, чем другая.
 */
export function objectTileMatches(query, name, groupName) {
  const needle = plain(query);
  if (needle === "") return true;
  return plain(name).includes(needle) || plain(groupName).includes(needle);
}

/**
 * Что показать в окне: категории по порядку каталога, в каждой — её вещи.
 *
 * `query` сужает выдачу, `key` — ключ вещи, которой стоит выделенное (или
 * которой поставят следующую): по нему в окне остаётся спрятанная `legacy`
 * вещь, если ею размечен чертёж. Пустая категория из выдачи уходит — пустой
 * заголовок держал бы колонку зря.
 */
export function objectPickerGroups(query, { key } = {}) {
  const chosen = key || null;
  return OBJECT_CATEGORIES.map((category) => {
    const name = strings.schemeObjectCategories[category] || category;
    const entries = objectCatalogCategory(category).filter((entry) => {
      if (entry.legacy && entry.key !== chosen) return false;
      return objectTileMatches(query, entry.name, name);
    });
    return { category, name, entries };
  }).filter((group) => group.entries.length > 0);
}

/**
 * Куда уводит стрелка. Правило то же, что в окне типов: вверх-вниз — по
 * колонке целиком, через границы категорий (все ряды в три плитки, поэтому
 * шаг на ряд — это шаг на три плитки); вправо-влево — в соседнюю колонку на то
 * же место сверху (короткая колонка прижимает к последней плитке).
 *
 * `columns` — уже разложенные колонки (`pickerLayout`), а не категории:
 * стрелка должна ходить по тому, что человек видит.
 */
export function objectPickerStep(columns, key, dx, dy) {
  const flat = (Array.isArray(columns) ? columns : []).map((column) =>
    column.flatMap((group) => group.entries.map((entry) => entry.key)),
  );
  const clamp = (value, last) => Math.max(0, Math.min(last, value));
  let at = -1;
  let spot = -1;
  flat.forEach((keys, index) => {
    const found = keys.indexOf(key);
    if (found >= 0) {
      at = index;
      spot = found;
    }
  });
  const first = flat.find((keys) => keys.length > 0);
  if (at < 0) return first ? first[0] : null;
  if (dx) {
    const target = flat[clamp(at + dx, flat.length - 1)];
    return target.length > 0 ? target[clamp(spot, target.length - 1)] : key;
  }
  if (!dy) return key;
  return flat[at][clamp(spot + dy * OBJECT_PICKER_TILES_PER_ROW, flat[at].length - 1)];
}

/**
 * Сетка вещей как кирпич: поиск сверху, категории колонками, плитки внутри.
 *
 * Вынесена наружу в таске 187: той же сеткой стоит шаг «Объекты» в окне «Что
 * добавить», и второй её сборки быть не должно — разойдись они, человек видел
 * бы в двух окнах два разных каталога. Окно выбора вещи (ниже) — первый её
 * хозяин, и ведёт себя в точности как прежде.
 *
 * `onPick(key)` зовётся кликом по плитке и Enter в поиске; что считать
 * выбранным, решает хозяин — он же присылает это `setKey`.
 *
 * **Что показать — тоже довод хозяина** (таск 218): `groups(query, {key})`
 * отдаёт разделы с плитками, умолчание — каталог вещей чертежа. Так же, как
 * `onPick`, это нужно было вынести, чтобы сетку изображений в справочнике типов
 * не собирать второй раз: разделы у неё свои (семьи реестра плюс каталог), а
 * раскладка колонок, поиск, клавиши и плитка — те же.
 *
 * У записи раздела могут стоять `title` (подсказка плитки целиком) и `offer`
 * (пометка «это предлагает общая база»).
 */
export function createObjectTiles(options = {}) {
  let key = options.key || null;
  let columns = [];
  const box = uiEl("div", { class: "picker__columns picker__columns--objects" });
  const node = uiEl("div", { class: "picker picker--objects" });
  const groupsOf = typeof options.groups === "function" ? options.groups : objectPickerGroups;
  const words = options.strings || strings.objectPicker;
  const pick = (next) => {
    if (next && typeof options.onPick === "function") options.onPick(next);
  };
  const firstKey = () => {
    const first = box.querySelector(".objectTile");
    return first ? first.dataset.key : null;
  };

  const search = uiPickSearch({
    placeholder: words.search,
    title: words.searchHint,
    onInput: () => render(),
    first: () => box.querySelector(".objectTile"),
    // Enter берёт первую найденную вещь — ключом, а не кликом по плитке:
    // плитки знает сетка, а что с ключом делать, решает хозяин.
    onEnter: () => pick(firstKey()),
  });

  function tile(entry) {
    return uiEl(
      "button",
      {
        class: "objectTile" + (entry.key === key ? " is-on" : "") + (entry.offer ? " is-offer" : ""),
        type: "button",
        title: entry.title || entry.name,
        attrs: { "data-key": entry.key, "aria-pressed": entry.key === key ? "true" : "false" },
        on: { click: () => pick(entry.key) },
      },
      [
        objectTileIcon(entry.key, OBJECT_TILE_ICON, options.color),
        // Язык подписи назван в самой подписи: перенос по слогам
        // (`hyphens: auto`) работает только когда браузер знает язык.
        uiEl("span", { class: "objectTile__name", text: entry.name, attrs: { lang: "ru" } }),
      ],
    );
  }

  // Категория — заголовок и сетка её плиток. Блок целиком, потому что в
  // колонке их бывает несколько: заголовок должен липнуть к своим плиткам, а
  // не наезжать на соседнюю категорию.
  function categoryBlock(group) {
    return uiEl("div", { class: "picker__category" }, [
      uiEl("div", { class: "picker__group", text: group.name }),
      uiEl("div", { class: "objectTiles__grid" }, group.entries.map(tile)),
    ]);
  }

  function render() {
    const groups = groupsOf(search.value, { key });
    const width = typeof window === "undefined" ? 0 : window.innerWidth;
    columns = pickerLayout(groups, objectPickerColumnLimit(width), objectPickerWeight);
    box.replaceChildren(
      ...columns.map((column) => uiEl("div", { class: "picker__column" }, column.map(categoryBlock))),
    );
    if (groups.length === 0) box.append(uiEl("p", { class: "panel__empty", text: words.empty }));
    // Ширину окна задаёт число получившихся колонок: нашлась одна категория
    // — окно узкое, и справа не остаётся пустого поля.
    node.style.setProperty("--picker-columns", String(Math.max(columns.length, 1)));
  }

  // Клавиатура по сетке: кирпич окна выбора, а куда уводит стрелка — своё
  // (`objectPickerStep`), и считается это по ключам каталога, а не по разметке.
  uiPickKeys(box, {
    cell: "objectTile",
    grid: true,
    move: (current, dx, dy) => {
      const next = objectPickerStep(columns, current.dataset.key, dx, dy);
      const target = next ? box.querySelector('.objectTile[data-key="' + next + '"]') : null;
      if (target) target.focus();
    },
  });

  render();
  node.replaceChildren(search, box);
  return {
    node,
    focus: () => search.focus(),
    setKey(next) {
      key = next || null;
      render();
    },
  };
}

/**
 * Открыть окно выбора вещи. Отдаёт ключ каталога или `null`, если закрыли.
 *
 * `options.key` — вещь, которая горит (у выделенной её собственная, без
 * выделения — та, которой поставят следующую); `options.title` — заголовок
 * окна: у смены вещи он свой, и человек должен видеть, что правит стоящее на
 * чертеже, а не выбирает новое.
 */
export function openObjectPicker(options = {}) {
  return new Promise((resolve) => {
    let modal;
    const tiles = createObjectTiles({
      key: options.key,
      onPick: (key) => {
        modal.close();
        resolve(key || null);
      },
    });
    modal = uiPickCard({
      title: options.title || strings.objectPicker.title,
      body: tiles.node,
      // Широкая карточка — как у окна типов: ширину внутри задаёт сетка колонок.
      wide: true,
      cancel: () => {
        modal.close();
        resolve(null);
      },
    });
    // Фокус — в поиск сетки: он лежит внутри кирпича, и просить о нём надо
    // самой сетке.
    tiles.focus();
  });
}
