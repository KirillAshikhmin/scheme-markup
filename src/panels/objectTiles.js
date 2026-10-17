// Выбор вещи чертежа плитками (таск 154, требование G224).
//
// Слова заказчика: «надо в выборе таблицей их отображать с изображением и
// названием» и «выбрать категорию (мебель, сантехника, техника и т.д.), а там
// уже объекты». Поэтому выбор в два шага: строка категории, под ней сетка
// плиток — картинка вещи и её имя.
//
// **Плитки стоят в колонке, а не в окне.** Вещи ставят подряд — кухню собирают
// из шести предметов, — и окно пришлось бы открывать на каждый. В колонке на
// 264 точки плитка шириной в треть читается и попадает пальцем, а картинку
// рисует тот же реестр, которым рисуются изображения меток
// (`objectViews/registry.js`): своего рисунка у плитки нет.
//
// Поиска здесь нет нарочно: вещей двадцать две, категорий шесть, и в самой
// крупной — пять плиток. Поле поиска отняло бы строку у того, ради чего оно
// заведено, и ответ всё равно был бы виден целиком.
import { objectCatalogCategory, objectCatalogEntry, OBJECT_CATEGORIES } from "../objectCatalog.js";
import { drawObjectView, objectViewByName } from "../objectViews/registry.js";
import { strings } from "../strings.js";
import { uiEl } from "./ui.js";

// Клетка картинки на плитке. Сорок точек — столько же, сколько у крупного
// знака типа метки в разделе «Метки»: мельче у кровати не разобрать подушек.
const TILE_ICON = 40;
// Цвет рисунка — цвет текста панели: плитка не красит вещь, она её показывает.
// Цвет на чертеже у объектов свой и общий, и повторять его тут значило бы
// обещать выбор краски, которого нет.
const TILE_INK = "#e6edf3";

/**
 * Картинка вещи в клетке. Рисуется в точках устройства, а показывается в
 * точках страницы: на экране с удвоенной плотностью контур иначе размылся бы.
 */
export function objectTileIcon(key, size = TILE_ICON) {
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

/**
 * Сетка выбора: строка категорий и плитки выбранной.
 *
 * `onPick(key)` зовётся кликом по плитке. Что выбрано сейчас, панель говорит
 * сама — `update({ key })`: у поставленной вещи это её ключ, без выделения —
 * ключ той, которая встанет следующей. Ключа нет вовсе (вещь прежней разметки
 * вне каталога) — не горит ни одна плитка, и это честно: подсветить похожую
 * значило бы соврать, что она та же.
 */
export function createObjectTiles({ onPick }) {
  // Категория — память панели, а не объекта: выбрал «Технику», поставил
  // холодильник и плиту — список не прыгает обратно.
  let category = OBJECT_CATEGORIES[0];
  let shownCategory = null;
  let currentKey = null;

  const select = uiEl("select", { class: "ui-input objectTiles__category" });
  for (const name of OBJECT_CATEGORIES) {
    select.append(uiEl("option", { value: name, text: strings.schemeObjectCategories[name] || name }));
  }
  select.addEventListener("change", () => {
    category = select.value;
    draw();
  });

  const grid = uiEl("div", { class: "objectTiles__grid" });
  const node = uiEl("div", { class: "objectTiles" }, [select, grid]);

  function draw() {
    if (shownCategory !== category) {
      shownCategory = category;
      grid.replaceChildren(
        ...objectCatalogCategory(category).map((entry) =>
          uiEl(
            "button",
            {
              class: "objectTile",
              type: "button",
              title: entry.name,
              attrs: { "data-key": entry.key },
              on: { click: () => onPick(entry.key) },
            },
            [
              objectTileIcon(entry.key),
              // Язык подписи назван в самой подписи: перенос по слогам
              // (`hyphens: auto`) работает только когда браузер знает язык.
              uiEl("span", { class: "objectTile__name", text: entry.name, attrs: { lang: "ru" } }),
            ],
          ),
        ),
      );
    }
    select.value = category;
    for (const tile of grid.querySelectorAll(".objectTile")) {
      const on = tile.dataset.key === currentKey;
      tile.classList.toggle("is-on", on);
      tile.setAttribute("aria-pressed", on ? "true" : "false");
    }
  }

  function update({ key } = {}) {
    currentKey = key || null;
    // Выбранная вещь перетягивает список на свою категорию: иначе у
    // поставленного радиатора горела бы плитка, которой на экране нет.
    const entry = objectCatalogEntry(currentKey);
    if (entry && entry.category !== category) category = entry.category;
    draw();
  }

  draw();
  return { node, update };
}
