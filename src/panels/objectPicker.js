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
// Механизм — тот же, что у выбора типа метки: карточка `uiModal`, поиск
// сверху, категории колонками, раскладку колонок считает общий `pickerLayout`
// из `typePicker.js` (он же считает её для типов — второго такого механизма в
// сборке нет). Отличается только клетка: у типа строка «знак — код —
// название», у вещи плитка «картинка — имя» (G224, плитки переехали сюда из
// колонки чертежа).
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
import { uiButton, uiEl, uiModal } from "./ui.js";
import { pickerColumnLimit, pickerLayout } from "./typePicker.js";

// Клетка картинки на плитке. Сорок точек — столько же, сколько у крупного
// знака типа метки в разделе «Метки»: мельче у кровати не разобрать подушек.
export const OBJECT_TILE_ICON = 40;
// Цвет рисунка — цвет текста панели: плитка не красит вещь, она её показывает.
// Цвет на чертеже у объектов свой и общий, и повторять его тут значило бы
// обещать выбор краски, которого нет.
const TILE_INK = "#e6edf3";

/**
 * Картинка вещи в клетке. Рисуется в точках устройства, а показывается в
 * точках страницы: на экране с удвоенной плотностью контур иначе размылся бы.
 */
export function objectTileIcon(key, size = OBJECT_TILE_ICON) {
  const canvas = uiEl("canvas", { class: "objectTile__icon" });
  const ratio = typeof devicePixelRatio === "number" && devicePixelRatio > 0 ? Math.min(3, devicePixelRatio) : 1;
  canvas.width = Math.round(size * ratio);
  canvas.height = Math.round(size * ratio);
  canvas.style.width = size + "px";
  canvas.style.height = size + "px";
  const ctx = canvas.getContext ? canvas.getContext("2d") : null;
  const icon = objectViewByName(key);
  if (ctx && icon) drawObjectView(ctx, icon, { x: 0, y: 0, width: canvas.width, height: canvas.height }, TILE_INK);
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
// Больше четырёх колонок не ставим: категорий всего шесть, и пятая колонка
// растянула бы окно на весь экран ради двух плиток «Декора».
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
 * Что показать в окне: категории по порядку каталога, в каждой — её вещи.
 *
 * `query` сужает выдачу, `key` — ключ вещи, которой стоит выделенное (или
 * которой поставят следующую): по нему в окне остаётся спрятанная `legacy`
 * вещь, если ею размечен чертёж. Пустая категория из выдачи уходит — пустой
 * заголовок держал бы колонку зря.
 */
export function objectPickerGroups(query, { key } = {}) {
  const needle = plain(query);
  const chosen = key || null;
  return OBJECT_CATEGORIES.map((category) => {
    const name = strings.schemeObjectCategories[category] || category;
    const hay = plain(name);
    const entries = objectCatalogCategory(category).filter((entry) => {
      if (entry.legacy && entry.key !== chosen) return false;
      if (needle === "") return true;
      return plain(entry.name).includes(needle) || hay.includes(needle);
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
    let columns = [];
    const done = (key) => {
      modal.close();
      resolve(key || null);
    };

    const box = uiEl("div", { class: "picker__columns picker__columns--objects" });
    const body = uiEl("div", { class: "picker picker--objects" });
    const search = uiEl("input", {
      class: "ui-input",
      type: "text",
      placeholder: strings.objectPicker.search,
      on: {
        input: () => renderList(),
        keydown: (event) => {
          // Стрелка вниз из поиска — в первую плитку: дальше по сетке ходят
          // стрелками, не хватаясь за мышь.
          if (event.key === "ArrowDown") {
            const first = box.querySelector(".objectTile");
            if (!first) return;
            event.preventDefault();
            first.focus();
            return;
          }
          // Enter берёт первую найденную вещь. Своя обработка здесь
          // обязательна: основное действие карточки — «Отмена», и оно
          // сработало бы раньше (`uiModal` ловит Enter), то есть выбор
          // терялся бы.
          if (event.key !== "Enter") return;
          event.preventDefault();
          const first = box.querySelector(".objectTile");
          if (first) first.click();
        },
      },
    });

    function tile(entry) {
      return uiEl(
        "button",
        {
          class: "objectTile" + (entry.key === options.key ? " is-on" : ""),
          type: "button",
          title: entry.name,
          attrs: { "data-key": entry.key, "aria-pressed": entry.key === options.key ? "true" : "false" },
          on: { click: () => done(entry.key) },
        },
        [
          objectTileIcon(entry.key),
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

    function renderList() {
      const groups = objectPickerGroups(search.value, { key: options.key });
      const width = typeof window === "undefined" ? 0 : window.innerWidth;
      columns = pickerLayout(groups, objectPickerColumnLimit(width), objectPickerWeight);
      box.replaceChildren(
        ...columns.map((column) => uiEl("div", { class: "picker__column" }, column.map(categoryBlock))),
      );
      if (groups.length === 0) box.append(uiEl("p", { class: "panel__empty", text: strings.objectPicker.empty }));
      // Ширину окна задаёт число получившихся колонок: нашлась одна категория
      // — окно узкое, и справа не остаётся пустого поля.
      body.style.setProperty("--picker-columns", String(Math.max(columns.length, 1)));
    }

    box.addEventListener("keydown", (event) => {
      const current = event.target;
      if (!current || !current.classList || !current.classList.contains("objectTile")) return;
      if (event.key === "Enter") {
        event.preventDefault();
        current.click();
        return;
      }
      const step = { ArrowDown: [0, 1], ArrowUp: [0, -1], ArrowRight: [1, 0], ArrowLeft: [-1, 0] }[event.key];
      if (!step) return;
      event.preventDefault();
      const next = objectPickerStep(columns, current.dataset.key, step[0], step[1]);
      const node = next ? box.querySelector('.objectTile[data-key="' + next + '"]') : null;
      if (node) node.focus();
    });

    renderList();
    body.replaceChildren(search, box);
    modal = uiModal({
      title: options.title || strings.objectPicker.title,
      body,
      actions: [uiButton(strings.dialog.cancel, { on: { click: () => done(null) } })],
      onCancel: () => resolve(null),
    });
    // Широкая карточка — как у окна типов: ширину внутри задаёт сетка колонок.
    if (modal.card) modal.card.classList.add("modal--wide");
    search.focus();
  });
}
