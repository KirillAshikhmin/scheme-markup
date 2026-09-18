// Подписи цвета в окне выбора и на кнопке.
//
// Голый hex в подсказке — это код, который человек сверяет глазами по цифрам:
// «#164E63» и «#0F766E» на слух и на вид одно и то же. Имя цвета считает
// `colorName.js`, а здесь проверяется то, что стоит между ним и интерфейсом:
// один формат подписи на все места окна, пометку занятого цвета имя не
// вытесняет, и на нецвете подпись остаётся прежней, а не превращается в
// «Цвет: ».
//
// Сам DOM не поднимается — как и в остальных тестах панелей: плитки, кнопка и
// наведение мышью остаются ручной приёмке.
import test from "node:test";
import assert from "node:assert/strict";

import { ROOM_PALETTE, colorTaken } from "../src/model.js";
import { colorName } from "../src/colorName.js";
import { colorLabel, colorSwatchTitle, colorValueLabel } from "../src/panels/colorPicker.js";
import { strings, text } from "../src/strings.js";

test("подпись складывается из названия кнопки, имени цвета и кода", () => {
  assert.equal(colorLabel("Цвет категории", "#E80098"), "Цвет категории: пурпурный (#E80098)");
  assert.equal(colorLabel(strings.colorPicker.before, "#164E63"), "Было: тёмно-бирюзовый (#164E63)");
  assert.equal(colorLabel("Цвет контура помещения", "#BE123C"), "Цвет контура помещения: красный (#BE123C)");
});

test("без названия остаётся имя цвета с кодом — это подпись самого кружка", () => {
  assert.equal(colorLabel("", "#164E63"), "тёмно-бирюзовый (#164E63)");
  assert.equal(colorLabel(null, "#FFFFFF"), "белый (#FFFFFF)");
});

test("код цвета приводится к верхнему регистру, как в таблице", () => {
  assert.equal(colorLabel("", "#be123c"), "красный (#BE123C)");
  assert.equal(colorLabel("Цвет", "  #0f766e  "), "Цвет: тёмно-бирюзовый (#0F766E)");
});

test("на нецвете подпись остаётся прежней, а не становится «Цвет: »", () => {
  assert.equal(colorLabel("Цвет категории", ""), "Цвет категории");
  assert.equal(colorLabel("Цвет категории", "синий"), "Цвет категории");
  assert.equal(colorLabel("Цвет категории", null), "Цвет категории");
  assert.equal(colorLabel("", "мусор"), "");
});

test("занятый цвет остаётся названным — пометка дописывается к имени", () => {
  const free = colorSwatchTitle("#0F766E", false);
  const busy = colorSwatchTitle("#0F766E", true);
  assert.equal(free, "тёмно-бирюзовый (#0F766E)");
  assert.equal(busy, "тёмно-бирюзовый (#0F766E) — цвет уже занят");
  assert.ok(busy.startsWith(free), "имя цвета обязано остаться и у занятой плитки");
});

test("каждая плитка палитры называет цвет словом и кодом", () => {
  for (const color of ROOM_PALETTE) {
    const name = colorName(color);
    assert.ok(name, "цвет палитры без названия: " + color);
    const title = colorSwatchTitle(color, colorTaken(color, ["#0F766E"]));
    assert.ok(title.includes(name), "в подсказке нет имени: " + color + " → " + title);
    assert.ok(title.includes(color.toUpperCase()), "в подсказке нет кода: " + color + " → " + title);
  }
});

// ——— надпись, которую видно без мыши ————————————————————————————————
//
// Подсказки выше живут в `title`: их видит тот, у кого мышь в руке, и не видит
// никто больше. Требование заказчика было «давай имя цвета в палитре выбора и
// кнопке», а единственная всегда видимая надпись окна показывала голый hex —
// то есть имени не было видно нигде.

test("видимая надпись окна называет цвет словом и кодом", () => {
  assert.equal(colorValueLabel("#164E63"), "тёмно-бирюзовый (#164E63)");
  assert.equal(colorValueLabel("#be123c"), "красный (#BE123C)");
  // Это надпись, а не подсказка: названия кнопки к ней не приписывается.
  assert.ok(!colorValueLabel("#164E63").includes(":"));
  // И цвет она называет теми же словами, что подсказка рядом.
  for (const color of ROOM_PALETTE) {
    assert.equal(colorValueLabel(color), colorLabel("", color));
  }
});

test("на мусоре вместо цвета остаётся сам код, а не пустое место", () => {
  // Пустая строка на месте надписи читалась бы как поломка окна.
  assert.equal(colorValueLabel("  не цвет  "), "не цвет");
  assert.equal(colorValueLabel(""), "");
  assert.equal(colorValueLabel(null), "");
});

// Надпись стоит своей строкой под кружками и растянута по колонке, поэтому
// длина имени ширину окна не двигает. Чтобы это осталось правдой и после новых
// имён, у неё есть потолок: надпись обязана оставаться строкой.
test("самое длинное имя цвета с кодом умещается в одну строку", () => {
  const bases = Object.entries(strings.colors)
    .filter(([key]) => !["dark", "light", "withHex"].includes(key))
    .map(([, name]) => name);
  const longest = Math.max(
    ...bases.map((name) =>
      Math.max(name.length, text("colors.dark", { name }).length, text("colors.light", { name }).length),
    ),
  );
  assert.ok(longest + " (#FFFFFF)".length <= 30, "имя цвета выросло до " + longest + " знаков");
});
