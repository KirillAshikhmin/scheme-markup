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

const ELEVATION_CSS = readFileSync(new URL("../src/panels/elevation.css", import.meta.url), "utf8");
const TYPE_PICKER_CSS = readFileSync(new URL("../src/panels/typePicker.css", import.meta.url), "utf8");
const OBJECT_PICKER_CSS = readFileSync(new URL("../src/panels/objectPicker.css", import.meta.url), "utf8");

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
