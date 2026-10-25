// Числа, которые живут и в JS, и в CSS (таск 173, находка 12 разбора).
//
// Таких чисел в сборке немного, и каждое — это одна мерка, записанная дважды:
// счёт колонок в окне выбора считает JS, а расставляет их стиль; раскладку
// просмотра решает `layoutModeFor`, а полоса развёртки поджимается
// медиа-запросом. Сегодня они совпадают, и это видно только глазами.
//
// **Хозяин всюду — JS**: там решение, там же его читают тесты. Стиль узнаёт
// число двумя путями. Где может — спрашивает: `--picker-columns` ставит
// `renderList`, и второго числа нет вовсе. Где не может — `@media` переменных
// не читает, а `var()` с запасным значением просто переносит то же число в
// запасное, — число повторено в стиле, и держит повтор этот файл: он читает
// стиль текстом и падает на расхождении.
//
// Зелёный прогон про стили не говорит ничего (сборка склеивает их текстом),
// поэтому читается именно текст — тот же приём, что в `fieldBare.test.js` и
// `dictColumns.test.js`.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { LAYOUT_NARROW_WIDTH } from "../src/app.js";
import {
  PICKER_COLUMN_GAP,
  PICKER_COLUMN_MIN,
  PICKER_MODAL_CHROME,
  PICKER_MODAL_SHARE,
} from "../src/panels/typePicker.js";
import { OBJECT_PICKER_COLUMN_MIN, OBJECT_PICKER_TILES_PER_ROW } from "../src/panels/objectPicker.js";
import { UI_SIGN, UI_SIGN_SMALL } from "../src/panels/ui.js";

const ELEVATION_CSS = readFileSync(new URL("../src/panels/elevation.css", import.meta.url), "utf8");
const TYPE_PICKER_CSS = readFileSync(new URL("../src/panels/typePicker.css", import.meta.url), "utf8");
const OBJECT_PICKER_CSS = readFileSync(new URL("../src/panels/objectPicker.css", import.meta.url), "utf8");
const PANELS_CSS = readFileSync(new URL("../src/panels/panels.css", import.meta.url), "utf8");
const CANVAS_CSS = readFileSync(new URL("../src/panels/canvas.css", import.meta.url), "utf8");
const MARKS_CSS = readFileSync(new URL("../src/panels/marks.css", import.meta.url), "utf8");
const SIM_CSS = readFileSync(new URL("../src/panels/sim.css", import.meta.url), "utf8");
const TYPES_JS = readFileSync(new URL("../src/panels/types.js", import.meta.url), "utf8");
// Мера значка справочника наружу не отдаётся (имя внутреннее), поэтому читается
// текстом — тем же приёмом, которым сверяются мерки чертежа в measures.test.js.
const TYPES_BADGE_LENGTH = Number((TYPES_JS.match(/TYPES_BADGE = \{ size: \d+, length: (\d+) \}/) || [])[1]);

// Сколько раз кусок встречается в стиле. Ноль — расхождение: число в JS
// поправили, а в стиле нет (или наоборот).
function count(css, piece) {
  return css.split(piece).length - 1;
}

test("граница узкой раскладки в стиле полосы — та же, что решает раскладку", () => {
  // `@media` не умеет читать ни переменную CSS, ни тем более JS, поэтому число
  // здесь повторено. Поправили `LAYOUT_NARROW_WIDTH` — поправьте и стиль,
  // иначе полоса поджимается не там, где страница становится просмотром.
  assert.equal(
    count(ELEVATION_CSS, "@media (max-width: " + LAYOUT_NARROW_WIDTH + "px)"),
    1,
    "в elevation.css нет медиа-запроса на " + LAYOUT_NARROW_WIDTH + " точек",
  );
  // Журнал имитации уступает карточке низ поля на той же границе.
  assert.equal(count(SIM_CSS, "@media (max-width: " + LAYOUT_NARROW_WIDTH + "px)"), 1, "в sim.css нет медиа-запроса на " + LAYOUT_NARROW_WIDTH + " точек");
  assert.equal(count(SIM_CSS, "@media (max-width: 900px)"), 0, "в sim.css осталась граница 900 точек мимо LAYOUT_NARROW_WIDTH");
});

test("меры окна выбора типа: колонка, просвет, доля экрана и поля карточки", () => {
  const share = String(Math.round(PICKER_MODAL_SHARE * 100)) + "vw";
  const chrome = String(PICKER_MODAL_CHROME) + "px";
  assert.equal(
    count(TYPE_PICKER_CSS, "minmax(" + PICKER_COLUMN_MIN + "px, 1fr)"),
    1,
    "ширина колонки в стиле разошлась с PICKER_COLUMN_MIN",
  );
  assert.equal(count(TYPE_PICKER_CSS, "gap: " + PICKER_COLUMN_GAP + "px;"), 1, "просвет колонок разошёлся с PICKER_COLUMN_GAP");
  assert.ok(count(TYPE_PICKER_CSS, share) >= 2, "доля экрана карточки разошлась с PICKER_MODAL_SHARE");
  assert.ok(count(TYPE_PICKER_CSS, "calc(" + share + " - " + chrome + ")") >= 1, "поля карточки разошлись с PICKER_MODAL_CHROME");
});

test("меры окна выбора вещи: своя колонка, те же доля экрана и поля", () => {
  const share = String(Math.round(PICKER_MODAL_SHARE * 100)) + "vw";
  const chrome = String(PICKER_MODAL_CHROME) + "px";
  assert.equal(
    count(OBJECT_PICKER_CSS, "minmax(" + OBJECT_PICKER_COLUMN_MIN + "px, 1fr)"),
    1,
    "ширина колонки вещей разошлась с OBJECT_PICKER_COLUMN_MIN",
  );
  assert.equal(
    count(OBJECT_PICKER_CSS, "repeat(" + OBJECT_PICKER_TILES_PER_ROW + ", minmax(0, 1fr))"),
    1,
    "плиток в ряду в стиле разошлось с OBJECT_PICKER_TILES_PER_ROW — стрелка прыгала бы не на ряд",
  );
  assert.ok(count(OBJECT_PICKER_CSS, "calc(" + share + " - " + chrome + ")") >= 1, "поля карточки вещей разошлись");
});

test("счёт колонок стиль не считает сам — он приходит из JS переменной", () => {
  // Это тот путь, где второго числа нет вовсе: сколько колонок — решает
  // `pickerLayout`, а стиль только расставляет. Пропади переменная — окно
  // снова начнёт жить своей арифметикой.
  assert.ok(count(TYPE_PICKER_CSS, "var(--picker-columns, 1)") >= 2);
  assert.ok(count(OBJECT_PICKER_CSS, "var(--picker-columns, 1)") >= 2);
});

test("знак на подсвеченной строке поиска стоит на своём фоне, а не на акценте", () => {
  // Акцент подсветки и цвет категории «Свет» — один и тот же синий, и знак
  // пропадал. Ни категорию, ни акцент перекрашивать нельзя (правило таска
  // 182), поэтому клетка знака получает подложку тоном поля панели — тем
  // самым, на котором знак читается в обычной строке.
  const at = PANELS_CSS.indexOf(".search__row.is-active .ui-sign {");
  assert.ok(at >= 0, "подложки под знаком подсвеченной строки не стало");
  const body = PANELS_CSS.slice(PANELS_CSS.indexOf("{", at) + 1, PANELS_CSS.indexOf("}", at));
  assert.match(body, /background:\s*var\(--panel-bg\);/, "подложка не тона панели: " + body.trim());
  // Ни ширины, ни отступов: это фон, а не правка вида.
  assert.doesNotMatch(body, /width|padding|margin|font-size/, "подложка меняет размер клетки: " + body.trim());
  // И сама подсветка строки осталась акцентной — тон её не трогали.
  const row = PANELS_CSS.slice(PANELS_CSS.indexOf(".search__row.is-active {"));
  assert.match(row.slice(0, row.indexOf("}")), /background:\s*var\(--accent\);/, "тон подсветки строки поменялся");
});

test("клетка знака: правило одно, а число у неё спрашивают, а не повторяют", () => {
  // Знак рисуется на холсте шириной `length`, а стоит в клетке. Разойдись
  // они — образец линии либо обрежется клеткой, либо вылезет из неё и сдвинет
  // подпись только у линейных строк. Записей этого правила было четыре (таск
  // 228 завёл четвёртую), и свёл их таск 233: правило одно — `.ui-sign`, а
  // ширину ему ставит JS переменной той же мерой, которой нарисован знак.
  const at = PANELS_CSS.indexOf("\n.ui-sign {");
  assert.ok(at >= 0, "правила клетки знака не стало");
  const body = PANELS_CSS.slice(PANELS_CSS.indexOf("{", at) + 1, PANELS_CSS.indexOf("}", at));
  assert.match(body, /width:\s*var\(--ui-sign-width\);/, "ширина клетки перестала спрашиваться: " + body.trim());
  assert.doesNotMatch(body, /width:\s*\d/, "в клетку знака вернулось число: " + body.trim());
  // Второй записи правила нет ни в одном стиле: ни у окна выбора, ни у
  // справочника, ни у общей базы.
  for (const [name, css] of [
    ["canvas.css", CANVAS_CSS],
    ["marks.css", MARKS_CSS],
    ["panels.css", PANELS_CSS],
  ]) {
    for (const dead of [".picker__icon {", ".catalog__icon {", ".ui-sign--small {"]) {
      assert.ok(!css.includes(dead), name + ": вторая запись клетки знака — " + dead);
    }
  }
  // Числа живут в JS и в стиль не уезжают: сверяется, что они вообще есть и
  // что у мелкой клетки она своя (поиск и свёрнутая карточка).
  assert.ok(UI_SIGN.length > UI_SIGN_SMALL.length, "мелкая клетка перестала быть мельче");
  // Свотч цвета в строке справочника — не клетка знака, а кнопка, и колонку он
  // держит повтором: вот этот повтор и сверяется.
  assert.equal(
    count(MARKS_CSS, "  width: " + TYPES_BADGE_LENGTH + "px;"),
    1,
    "свотч цвета в строке справочника разошёлся с мерой значка",
  );
});
