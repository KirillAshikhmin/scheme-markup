// Окно выбора вещи чертежа (таск 170, требование G252).
//
// Что здесь держится:
//
//   1. **Каталог виден целиком.** Шага категории в окне нет: все вещи стоят
//      сразу, и до любой — один клик. Это и есть ответ на довод таска 154
//      («кухню собирают из шести вещей подряд»), поэтому охват проверяется
//      счётом: ни одна вещь каталога из окна не выпала.
//   2. **Порядок каталога.** Категории идут порядком `OBJECT_CATEGORIES`, а
//      внутри — порядком записи: своей сортировки окно не заводит.
//   3. **Прежняя вещь спрятана, но не потеряна.** `legacy` из окна убрана, а
//      пока ею стоит выделенное — показана: человек обязан видеть, чем стоит
//      вещь на его чертеже.
//   4. **Поиск.** По имени вещи и по имени категории, терпимо к регистру, «ё»
//      и пробелам по краям; пустая категория из выдачи уходит.
//   5. **Стрелки ходят по тому, что видно** — по разложенным колонкам, а не по
//      категориям: вверх-вниз на ряд (три плитки), вправо-влево в соседнюю
//      колонку, у края — стоп, а не прыжок через окно.
import test from "node:test";
import assert from "node:assert/strict";

import {
  OBJECT_PICKER_TILES_PER_ROW,
  objectPickerColumnLimit,
  objectPickerGroups,
  objectPickerStep,
  objectPickerWeight,
} from "../src/panels/objectPicker.js";
import { pickerLayout } from "../src/panels/typePicker.js";
import { OBJECT_CATEGORIES, objectCatalogEntry, objectCatalogKeys } from "../src/objectCatalog.js";
import { strings } from "../src/strings.js";

const keysOf = (groups) => groups.flatMap((group) => group.entries.map((entry) => entry.key));
const layout = (groups, limit = 3) => pickerLayout(groups, limit, objectPickerWeight);

test("в окне стоит весь каталог сразу — ни одной вещи не потеряно", () => {
  const groups = objectPickerGroups("");
  const shown = keysOf(groups);
  // Прежние вещи спрятаны, все остальные — на месте и по одному разу.
  const expected = objectCatalogKeys().filter((key) => !objectCatalogEntry(key).legacy);
  assert.deepEqual([...shown].sort(), [...expected].sort());
  assert.equal(shown.length, new Set(shown).size, "вещь показана дважды");
  // Шага категории нет: до любой вещи один клик, и это ответ на «шесть вещей
  // подряд» — ради него выбор и терпит переезд в окно.
  assert.ok(shown.length > 20, "в окне должен стоять весь каталог: " + shown.length);
});

test("порядок — каталожный: категории по порядку, внутри по записи", () => {
  const groups = objectPickerGroups("");
  assert.deepEqual(
    groups.map((group) => group.category),
    OBJECT_CATEGORIES,
  );
  for (const group of groups) {
    assert.equal(group.name, strings.schemeObjectCategories[group.category]);
    const inCategory = objectCatalogKeys().filter(
      (key) => objectCatalogEntry(key).category === group.category && !objectCatalogEntry(key).legacy,
    );
    assert.deepEqual(group.entries.map((entry) => entry.key), inCategory, "порядок записи сбился");
  }
});

test("прежняя вещь спрятана, а под выделенной — показана", () => {
  const legacy = objectCatalogKeys().filter((key) => objectCatalogEntry(key).legacy);
  assert.ok(legacy.length > 0, "в каталоге нет ни одной прежней вещи — проверять нечего");
  for (const key of legacy) {
    assert.ok(!keysOf(objectPickerGroups("")).includes(key), "прежняя вещь осталась в окне: " + key);
    // Ею стоит выделенное — значит она в окне и горит: подсветить вместо неё
    // похожую значило бы соврать.
    assert.ok(keysOf(objectPickerGroups("", { key })).includes(key), "выделенная прежняя вещь пропала: " + key);
  }
});

test("поиск: по имени вещи и по имени категории, терпимо к регистру и пробелам", () => {
  assert.deepEqual(keysOf(objectPickerGroups("холодильн")), ["fridge"]);
  assert.deepEqual(keysOf(objectPickerGroups("  ХОЛ  ")), ["fridge"]);
  // Имя категории — тоже ответ: «сантех» показывает весь раздел.
  const sanitary = objectPickerGroups("сантех");
  assert.deepEqual(sanitary.map((group) => group.category), ["sanitary"]);
  assert.deepEqual(keysOf(sanitary), keysOf(objectPickerGroups("")).filter((key) => objectCatalogEntry(key).category === "sanitary"));
  // Пустая категория из выдачи уходит, а не держит заголовок.
  assert.deepEqual(objectPickerGroups("лестни").map((group) => group.category), ["stairway"]);
  assert.deepEqual(objectPickerGroups("ничегонетщ"), []);
});

// ——— таск 230: поиск не подменяет вещь разделом (D77) ————————————————————
//
// Нашёл исполнитель таска 224: запрос «лифт» поднимал весь раздел «Лестницы и
// лифт», первой стояла «Лестница прямая» — и Enter, который берёт первую
// плитку, ставил лестницу вместо лифта.

test("D77: нашлись вещи — показываем вещи, и первой стоит та, которую искали", () => {
  const first = (query) => {
    const groups = objectPickerGroups(query);
    return groups.length > 0 ? groups[0].entries[0].name : null;
  };
  assert.deepEqual(keysOf(objectPickerGroups("лифт")), ["lift"], "раздел снова подменил вещь");
  assert.equal(first("лифт"), "Лифт", "Enter возьмёт не ту плитку");
  // Раздел отвечает, только когда по именам вещей не нашлось ничего, — и это
  // по-прежнему работает: «сантех» показывает весь раздел.
  assert.ok(keysOf(objectPickerGroups("сантех")).length > 1, "раздел перестал отвечать вовсе");
  // Половинчатый запрос чинится тем же правилом, а не точным совпадением.
  assert.deepEqual(keysOf(objectPickerGroups("лиф")), ["lift"]);
});

test("D77: у сетки плиток то же правило совпадения, что у всей сборки", () => {
  // `queryHit`: с начала слова, а не серединой. До таска 230 у сеток было своё
  // сравнение, и «техник» поднимал «Сантехнику» серединой слова.
  const categories = (query) => objectPickerGroups(query).map((group) => group.category);
  assert.deepEqual(categories("техник"), ["appliances"], "«техник» снова ловит «Сантехнику» серединой слова");
  assert.deepEqual(categories("сантех"), ["sanitary"]);
  // Слово с начала — по-прежнему ответ, в том числе вторым словом имени.
  assert.ok(keysOf(objectPickerGroups("дорожка")).length > 0, "«дорожка» не нашла беговую дорожку");
});

test("высота категории — заголовок плюс ряды плиток", () => {
  assert.equal(OBJECT_PICKER_TILES_PER_ROW, 3);
  assert.equal(objectPickerWeight({ entries: [] }), 1, "пустая категория — один заголовок");
  assert.equal(objectPickerWeight({ entries: new Array(3) }), 2);
  // Пять вещей — два ряда: четвёртая плитка начинает второй.
  assert.equal(objectPickerWeight({ entries: new Array(4) }), 3);
  assert.equal(objectPickerWeight({ entries: new Array(5) }), 3);
  assert.equal(objectPickerWeight({}), 1, "без списка вещей высота считается, а не падает");
});

test("узкому экрану — одна колонка, широкому не больше четырёх", () => {
  assert.equal(objectPickerColumnLimit(360), 1);
  assert.equal(objectPickerColumnLimit(0), 1);
  assert.ok(objectPickerColumnLimit(1000) > 1, "на 1000 точек колонок больше одной");
  // Потолок свой: категорий семь, и пятая колонка растянула бы окно ради одной
  // плитки «Декора».
  assert.equal(objectPickerColumnLimit(4000), 4);
});

test("стрелки ходят по колонкам: ряд вниз, соседняя колонка вбок", () => {
  const columns = layout(objectPickerGroups(""));
  assert.ok(columns.length > 1, "раскладка дала одну колонку — ходить некуда");
  const flat = columns.map((column) => column.flatMap((group) => group.entries.map((entry) => entry.key)));
  const first = flat[0][0];

  // Вниз — на ряд, то есть на три плитки, и через границу категории: колонка
  // читается целиком.
  assert.equal(objectPickerStep(columns, first, 0, 1), flat[0][OBJECT_PICKER_TILES_PER_ROW]);
  // Вверх от первой плитки — стоп, а не прыжок в чужую колонку.
  assert.equal(objectPickerStep(columns, first, 0, -1), first);
  // Вниз у дна колонки прижимает к последней плитке.
  const last = flat[0][flat[0].length - 1];
  assert.equal(objectPickerStep(columns, last, 0, 1), last);

  // Вбок — в соседнюю колонку на то же место сверху.
  assert.equal(objectPickerStep(columns, first, 1, 0), flat[1][0]);
  assert.equal(objectPickerStep(columns, flat[1][0], -1, 0), first);
  assert.equal(objectPickerStep(columns, first, -1, 0), first, "левее первой колонки колонок нет");
  // Короткая колонка прижимает к последней своей плитке, а не теряет фокус.
  const lastColumn = flat[flat.length - 1];
  const deep = flat[0][flat[0].length - 1];
  assert.equal(objectPickerStep(columns, deep, flat.length, 0), lastColumn[lastColumn.length - 1]);

  // Вещь не из окна (поиск только что сузил выдачу) — фокус на первую плитку.
  assert.equal(objectPickerStep(columns, "нетакогоключа", 0, 1), first);
  assert.equal(objectPickerStep([], "table", 0, 1), null, "пустому окну водить нечем");
});

test("в выдаче поиска стрелки ходят по ней же, а не по всему каталогу", () => {
  const columns = layout(objectPickerGroups("машина"), 3);
  const keys = columns.flatMap((column) => column.flatMap((group) => group.entries.map((entry) => entry.key)));
  assert.ok(keys.length >= 2, "по «машина» должно найтись несколько вещей: " + keys.join(","));
  // Выдача короче ряда — вниз идти некуда, и фокус остаётся на месте.
  assert.equal(objectPickerStep(columns, keys[0], 0, 1), keys[keys.length - 1]);
});
