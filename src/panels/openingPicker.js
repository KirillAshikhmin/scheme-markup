// Выбор вида проёма плитками (таск 215, требование G321).
//
// Слова заказчика: «выбор проёмов сделай как и у объектов». У объектов это
// сетка плиток «картинка — имя», разложенная категориями по колонкам, с поиском
// и клавиатурой (таски 154, 170, 183). Здесь то же самое, и ни одного своего
// механизма: раскладку колонок считает общий `pickerLayout`, поиск и клавиши —
// общие кирпичи `uiPickSearch`/`uiPickKeys`, шаг стрелки по сетке —
// `objectPickerStep`, карточку окна — `uiPickCard`. Своё здесь одно: **чем
// нарисована плитка**.
//
// ——— у проёма нет картинки, у него есть лицо ———
//
// У вещи чертежа плитку рисует реестр изображений (`objectViews`). У проёма
// такого реестра нет и быть не должно: проём рисуется своей геометрией в стене,
// и вид его узнаётся по лицу — сколько секций, стеклянный ли он, как ходит
// полотно. Поэтому плитку рисует **та же** `render.drawOpeningFace`, которой
// нарисована развёртка: человек выбирает проём по картинке и обязан увидеть на
// листе её же. Второго рисования видов проёма в сборке нет.
//
// ——— где это живёт ———
//
// Главное место — шаг «Проёмы» окна «Что добавить» (таск 187): там выбирают,
// чем будет **следующий** проём. Окно `openOpeningPicker` меняет вид
// **выделенного** проёма — ровно как `openObjectPicker` меняет вещь у
// выделенной вещи, и сетка у них общая на оба случая.
import { OPENING_CATEGORIES, openingCatalogCategory, openingCatalogEntry } from "../openingCatalog.js";
import { openingArchGeometry, openingFaceGrid } from "../model.js";
import { drawOpeningFace } from "../render.js";
import { strings } from "../strings.js";
import { uiEl, uiPickCard, uiPickKeys, uiPickSearch } from "./ui.js";
import { objectTilesForQuery } from "./objectPicker.js";
import {
  TILE_INK,
  objectPickerColumnLimit,
  objectPickerStep,
  objectPickerWeight,
} from "./objectPicker.js";
import { pickerLayout } from "./typePicker.js";

// Клетка картинки на плитке — та же сорокаточечная, что у вещи чертежа: две
// сетки плиток стоят рядом в одном окне «Что добавить», и разного размера
// клетки читались бы как разная важность.
export const OPENING_TILE_ICON = 40;

/**
 * Лицо вида в клетке. Рисуется в точках устройства, а показывается в точках
 * страницы: на экране с удвоенной плотностью импосты иначе размылись бы.
 *
 * Пропорции — **настоящие**: дверь 900 × 2100 стоит в клетке стоймя, окно
 * 1500 × 1400 почти квадратом, ворота 2500 × 2250 лежат. По одной этой примете
 * ворота от двери отличаются ещё до того, как человек прочтёт подпись.
 */
export function openingTileIcon(kind, size = OPENING_TILE_ICON) {
  const canvas = uiEl("canvas", { class: "objectTile__icon" });
  const ratio = typeof devicePixelRatio === "number" && devicePixelRatio > 0 ? Math.min(3, devicePixelRatio) : 1;
  canvas.width = Math.round(size * ratio);
  canvas.height = Math.round(size * ratio);
  canvas.style.width = size + "px";
  canvas.style.height = size + "px";
  const ctx = canvas.getContext ? canvas.getContext("2d") : null;
  const entry = openingCatalogEntry(kind);
  if (!ctx || !entry) return canvas;
  const pad = 2 * ratio;
  const room = { width: canvas.width - pad * 2, height: canvas.height - pad * 2 };
  const scale = Math.min(room.width / entry.widthMm, room.height / entry.heightMm);
  const width = entry.widthMm * scale;
  const height = entry.heightMm * scale;
  drawOpeningFace(
    ctx,
    {
      x: pad + (room.width - width) / 2,
      y: pad + (room.height - height) / 2,
      width,
      height,
    },
    {
      kind: entry.kind,
      glazed: Boolean(entry.glazed),
      motion: entry.motion,
      leaves: entry.leaves,
      grid: openingFaceGrid({ kind: entry.kind, heightMm: entry.heightMm }),
      // Дуга арки (таск 219, G329) — та же, что на листе: до неё «Проём» и
      // «Арка» стояли в окне выбора двумя одинаковыми плитками.
      arch: openingArchGeometry({ kind: entry.kind, widthMm: entry.widthMm, heightMm: entry.heightMm }),
      // Петли у плитки всегда у начала: плитка показывает **вид**, а не
      // состояние двери — состояние крутят `Q` и `E` уже на чертеже.
      hinge: "start",
    },
    { unit: ratio, scale, ink: TILE_INK, paper: null },
  );
  return canvas;
}

// Терпимое сравнение, как у каталога вещей: регистр, «ё» и пробелы по краям не
// считаются.
/**
 * Что показать в окне: разделы по порядку каталога, в каждом — его виды.
 *
 * `kind` — вид, которым стоит выделенное (или которым поставят следующий): по
 * нему в окне остаётся спрятанный `legacy` вид, если им размечен чертёж. Правило
 * то же, что у вещи с отметкой `legacy` в каталоге объектов: человек обязан
 * видеть, чем стоит проём на его чертеже, а подсветить вместо него похожий
 * значило бы соврать.
 *
 * **Сужает выдачу общий `objectTilesForQuery`** — тот же, что у сетки вещей
 * (таск 230): своего сравнения здесь было третье на сборку, и раздел отвечал
 * наравне с видом. Теперь имя раздела отвечает только тогда, когда по именам
 * видов не нашлось ничего: «двер» по-прежнему показывает весь раздел, а
 * «проём» — одну плитку, а не раздел, в котором она вторая.
 */
export function openingPickerGroups(query, { kind } = {}) {
  const chosen = kind || null;
  const groups = OPENING_CATEGORIES.map((category) => ({
    category,
    name: strings.openingCategories[category] || category,
    entries: openingCatalogCategory(category)
      .filter((entry) => !entry.legacy || entry.kind === chosen)
      // Шаг стрелки и разметка плитки общие с вещами и ходят по `key`: у проёма
      // ключ — это его вид.
      .map((entry) => ({ ...entry, key: entry.kind })),
  }));
  return objectTilesForQuery(query, groups);
}

/**
 * Сетка видов как кирпич: поиск сверху, разделы колонками, плитки внутри.
 *
 * Хозяев у неё двое, как у сетки вещей: шаг «Проёмы» окна «Что добавить» и окно
 * смены вида у выделенного проёма. `onPick(kind)` зовётся кликом по плитке и
 * Enter в поиске; что считать выбранным, решает хозяин — он же присылает это
 * обратно через `setKind`.
 */
export function createOpeningTiles(options = {}) {
  let kind = options.kind || null;
  let columns = [];
  // Классы разметки — **те же**, что у сетки вещей, и это не описка: сетка
  // плиток одна на две сетки, её меры стоят в `objectPicker.css` и держатся
  // тестом (`cssMeasures`). Заведи здесь свои — и две сетки плиток, стоящие в
  // одном окне «Что добавить», разъехались бы шириной клетки.
  const box = uiEl("div", { class: "picker__columns picker__columns--objects" });
  const node = uiEl("div", { class: "picker picker--objects" });
  const pick = (next) => {
    if (next && typeof options.onPick === "function") options.onPick(next);
  };
  const firstKey = () => {
    const first = box.querySelector(".objectTile");
    return first ? first.dataset.key : null;
  };

  const search = uiPickSearch({
    placeholder: strings.openingPicker.search,
    title: strings.openingPicker.searchHint,
    onInput: () => render(),
    first: () => box.querySelector(".objectTile"),
    onEnter: () => pick(firstKey()),
  });

  function tile(entry) {
    // Подсказка плитки говорит то, чего на ней не видно: как ходит полотно.
    // Рисунок про это врать не может — у сдвижной и портальной стрелка одна и
    // та же, — а подсказка отвечает словом.
    const motion = entry.motion ? strings.openingMotions[entry.motion] || "" : "";
    return uiEl(
      "button",
      {
        class: "objectTile" + (entry.kind === kind ? " is-on" : ""),
        type: "button",
        title: motion ? entry.name + " · " + motion : entry.name,
        attrs: { "data-key": entry.kind, "aria-pressed": entry.kind === kind ? "true" : "false" },
        on: { click: () => pick(entry.kind) },
      },
      [
        openingTileIcon(entry.kind),
        uiEl("span", { class: "objectTile__name", text: entry.name, attrs: { lang: "ru" } }),
      ],
    );
  }

  function categoryBlock(group) {
    return uiEl("div", { class: "picker__category" }, [
      uiEl("div", { class: "picker__group", text: group.name }),
      uiEl("div", { class: "objectTiles__grid" }, group.entries.map(tile)),
    ]);
  }

  function render() {
    const groups = openingPickerGroups(search.value, { kind });
    const width = typeof window === "undefined" ? 0 : window.innerWidth;
    columns = pickerLayout(groups, objectPickerColumnLimit(width), objectPickerWeight);
    box.replaceChildren(
      ...columns.map((column) => uiEl("div", { class: "picker__column" }, column.map(categoryBlock))),
    );
    if (groups.length === 0) box.append(uiEl("p", { class: "panel__empty", text: strings.openingPicker.empty }));
    node.style.setProperty("--picker-columns", String(Math.max(columns.length, 1)));
  }

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
    setKind(next) {
      kind = next || null;
      render();
    },
  };
}

/**
 * Открыть окно смены вида у выделенного проёма. Отдаёт ключ вида или `null`.
 *
 * Пятого окна выбора в сборке не завелось: это **то же** окно, что у вещи
 * чертежа (`openObjectPicker`), с той же карточкой и той же сеткой — только
 * каталог другой. Вид **нового** проёма выбирают не здесь, а шагом «Проёмы»
 * окна «Что добавить».
 */
export function openOpeningPicker(options = {}) {
  return new Promise((resolve) => {
    let modal;
    const tiles = createOpeningTiles({
      kind: options.kind,
      onPick: (kind) => {
        modal.close();
        resolve(kind || null);
      },
    });
    modal = uiPickCard({
      title: options.title || strings.openingPicker.title,
      body: tiles.node,
      wide: true,
      cancel: () => {
        modal.close();
        resolve(null);
      },
    });
    tiles.focus();
  });
}
