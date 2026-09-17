// Раскладка окна «Тип метки»: категории по колонкам.
//
// Сетка выравнивала ряд по самой высокой категории: «Свет» с девятью типами
// держал всю первую строку, и «Щит» с «Датчиками» начинались только под ним —
// между выключателями и датчиками зияла пустая половина окна. Проверяется
// именно это: колонка набивается подряд, порядок справочника не меняется,
// и в узкий экран колонок уходит столько, сколько в него влезает.
import test from "node:test";
import assert from "node:assert/strict";
import { pickerColumnLimit, pickerLayout } from "../src/panels/typePicker.js";

// Категория для раскладки — только имя и число типов: высоту она считает по
// ним, остальные поля ей безразличны.
function group(name, count) {
  return {
    category: { id: name, name },
    types: Array.from({ length: count }, (unused, index) => ({ id: name + index, code: name + index })),
  };
}

// Стартовый справочник объекта: семь категорий, двадцать один тип — ровно тот
// перекос, с которого пришла жалоба.
const starter = [
  group("Свет", 7),
  group("Выключатели", 3),
  group("Розетки", 1),
  group("Климат", 2),
  group("Сетевое оборудование", 2),
  group("Датчики", 4),
  group("Щит", 2),
];

const height = (column) => column.reduce((sum, item) => sum + 1 + item.types.length, 0);
const names = (columns) => columns.flat().map((item) => item.category.name);

test("короткие категории встают под соседние, а не держат каждая свою колонку", () => {
  const columns = pickerLayout(starter, 6);
  // Семь категорий уместились в меньшее число колонок — значит короткие
  // сложились друг под друга, а не растянулись на ряд с переносом.
  assert.ok(columns.length < starter.length, "колонок должно стать меньше, чем категорий");
  // Ни одна колонка не выше самой длинной категории: окно не растёт в высоту
  // от уплотнения.
  const tallest = Math.max(...starter.map((item) => 1 + item.types.length));
  for (const column of columns) assert.ok(height(column) <= tallest, "колонка выше самой длинной категории");
  // Пустых колонок не бывает: пустая колонка — это и есть пустое место.
  for (const column of columns) assert.ok(column.length > 0, "пустая колонка");
});

test("порядок справочника не меняется: колонка читается сверху вниз, колонки слева направо", () => {
  assert.deepEqual(
    names(pickerLayout(starter, 6)),
    starter.map((item) => item.category.name),
  );
});

test("узкий экран убавляет колонки, а не уводит их за край", () => {
  const wide = pickerLayout(starter, pickerColumnLimit(1440));
  const narrow = pickerLayout(starter, pickerColumnLimit(420));
  assert.ok(narrow.length <= 2, "в 420 px помещается не больше двух колонок");
  assert.ok(narrow.length < wide.length);
  // Категории не теряются: все на месте и в том же порядке.
  assert.deepEqual(names(narrow), starter.map((item) => item.category.name));
});

test("колонок не больше, чем разрешено, даже когда категорий вдвое больше", () => {
  const many = Array.from({ length: 13 }, (unused, index) => group("К" + index, 1));
  const columns = pickerLayout(many, 6);
  assert.ok(columns.length <= 6);
  assert.deepEqual(names(columns), many.map((item) => item.category.name));
});

test("одна найденная категория — одна колонка, ничего не найдено — ни одной", () => {
  assert.equal(pickerLayout([group("Свет", 7)], 6).length, 1);
  assert.deepEqual(pickerLayout([], 6), []);
});

test("ширина экрана переводится в колонки по мере колонки, а не на глаз", () => {
  assert.equal(pickerColumnLimit(1440), 6);
  assert.equal(pickerColumnLimit(500), 2);
  assert.equal(pickerColumnLimit(390), 2);
  assert.equal(pickerColumnLimit(320), 1);
  // Ширины нет (страница ещё не открыта) — одна колонка, а не ноль.
  assert.equal(pickerColumnLimit(0), 1);
  assert.equal(pickerColumnLimit(undefined), 1);
});

// Колонка, которая «почти влезла», — это горизонтальная прокрутка в окне,
// которое открывают десятки раз за сеанс. Поэтому считаются и просветы между
// колонками, и поля карточки, а не одни только колонки.
test("колонки помещаются в экран вместе с просветами и полями карточки", () => {
  for (const width of [320, 390, 420, 500, 768, 1024, 1280, 1440, 1920]) {
    const columns = pickerColumnLimit(width);
    const needed = columns * 150 + (columns - 1) * 14 + 40;
    assert.ok(
      columns === 1 || needed <= width * 0.96,
      "в " + width + " px не помещается " + columns + " колонок",
    );
  }
});
