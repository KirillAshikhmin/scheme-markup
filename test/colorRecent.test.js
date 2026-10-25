// Последние цвета в окне выбора (правка без автопилота, 2026-10-25): «под
// основной палитрой добавь Последние используемые цвета, 3 ряда». Три ряда —
// три ряда той же сетки, что у палитры, и число столбцов у JS и стиля одно.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { PAINT_PALETTE, ROOM_PALETTE } from "../src/model.js";
import {
  COLOR_PALETTE_COLUMNS,
  COLOR_RECENT_MAX,
  COLOR_RECENT_ROWS,
  colorRecentAdd,
  colorRecentOf,
} from "../src/panels/colorPicker.js";

const COLOR_CSS = readFileSync(new URL("../src/panels/colorPicker.css", import.meta.url), "utf8");

test("последних — три ряда сетки палитры, и палитры ложатся в неё целыми рядами", () => {
  assert.equal(COLOR_RECENT_ROWS, 3);
  assert.equal(COLOR_RECENT_MAX, COLOR_PALETTE_COLUMNS * 3);
  assert.match(COLOR_CSS, new RegExp("\\.colorpick__palette \\{[^}]*grid-template-columns: repeat\\(" + COLOR_PALETTE_COLUMNS + ", 32px\\)"));
  assert.equal(ROOM_PALETTE.length % COLOR_PALETTE_COLUMNS, 0);
  assert.equal(PAINT_PALETTE.length % COLOR_PALETTE_COLUMNS, 0);
});

test("новый цвет — первым, повтор поднимается наверх, а не двоится", () => {
  let list = [];
  list = colorRecentAdd(list, "#aabbcc");
  list = colorRecentAdd(list, "#112233");
  assert.deepEqual(list, ["#112233", "#AABBCC"]);
  list = colorRecentAdd(list, "#AABBCC");
  assert.deepEqual(list, ["#AABBCC", "#112233"]);
  assert.deepEqual(colorRecentAdd(list, "красный"), list, "мусор попал в последние");
});

test("в памяти не больше трёх рядов: старый уходит с конца", () => {
  let list = [];
  for (let index = 0; index < COLOR_RECENT_MAX + 5; index += 1) {
    list = colorRecentAdd(list, "#0000" + index.toString(16).padStart(2, "0"));
  }
  assert.equal(list.length, COLOR_RECENT_MAX);
  assert.equal(list[0], "#0000" + (COLOR_RECENT_MAX + 4).toString(16).padStart(2, "0").toUpperCase());
  assert.ok(!list.includes("#000000"), "самый старый не ушёл");
});

test("сохранённое в настройках чистится при чтении: повторы, мусор и лишнее", () => {
  assert.deepEqual(colorRecentOf(["#abcdef", "#ABCDEF", "x", null, "#123456"]), ["#ABCDEF", "#123456"]);
  assert.deepEqual(colorRecentOf(null), []);
  assert.equal(colorRecentOf(Array.from({ length: 40 }, (_, index) => "#1000" + String(index).padStart(2, "0"))).length, COLOR_RECENT_MAX);
});
