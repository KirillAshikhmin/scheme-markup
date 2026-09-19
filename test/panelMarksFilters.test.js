// Заголовок сворачиваемого блока фильтров.
//
// Фильтры сворачиваются ради места: прилипший блок отдавал списку 258 px
// полосы, а раскрытая карточка метки — 282 px, и в невысоком окне она не
// помещалась. Опасность у сворачивания одна: спрятать вместе с фильтрами
// включённый фильтр. Метки пропали со схемы и из списка, причина не видна
// нигде — и пользователь идёт искать их, вместо того чтобы снять фильтр.
// Поэтому заголовок обязан сказать и что список сужен, и сколько меток видно.
import test from "node:test";
import assert from "node:assert/strict";
import { strings } from "../src/strings.js";
import { marksFiltersHead } from "../src/panels/marks.js";

const EMPTY = { categoryIds: null, typeIds: null, roomId: null, query: "" };
const head = (extra) => marksFiltersHead({ collapsed: false, filter: EMPTY, shown: 36, total: 36, ...extra });

test("фильтр не тронут: заголовок спокоен, в счётчике просто число меток", () => {
  const view = head();
  assert.equal(view.narrowed, false);
  assert.equal(view.count, "36");
  assert.equal(view.hint, strings.filters.collapse);
  assert.ok(!view.hint.includes(strings.filters.narrowed), "сужения нет — и говорить не о чем");
});

test("любой включённый фильтр виден в заголовке", () => {
  // Четыре способа сузить список — и все четыре обязаны быть заметны.
  const ways = [
    { query: "Т1" },
    { roomId: "комната" },
    { typeIds: ["один-тип"] },
    { categoryIds: ["одна-категория"] },
  ];
  for (const way of ways) {
    const view = head({ filter: { ...EMPTY, ...way }, shown: 12 });
    assert.equal(view.narrowed, true, "не заметили фильтр: " + JSON.stringify(way));
    assert.ok(view.hint.includes(strings.filters.narrowed), "подсказка молчит про сужение");
  }
});

test("суженный список показывает оба числа, а не одно", () => {
  const view = head({ filter: { ...EMPTY, query: "Т" }, shown: 12 });
  assert.equal(view.count, "Показано 12 из 36");
  // Пустой поиск фильтром не считается: пробел в поле не должен красить
  // заголовок в тревожный цвет.
  assert.equal(head({ filter: { ...EMPTY, query: "   " } }).narrowed, false);
});

test("фильтр включён, но ничего не спрятал — заголовок всё равно говорит об этом", () => {
  // Помещение выбрано, а метки все в нём: числа совпадают, и счётчик о
  // сужении не скажет. Это тот самый случай, ради которого признак считается
  // по самому фильтру, а не по числам.
  const view = head({ filter: { ...EMPTY, roomId: "комната" }, shown: 36 });
  assert.equal(view.narrowed, true);
  assert.equal(view.count, "Показано 36 из 36");
  assert.ok(view.hint.includes(strings.filters.narrowed));
});

test("свёрнутый блок зовёт развернуть, развёрнутый — свернуть", () => {
  assert.ok(head({ collapsed: true }).hint.startsWith(strings.filters.expand));
  assert.ok(head({ collapsed: false }).hint.startsWith(strings.filters.collapse));
  // И то и другое дополняется предупреждением о сужении — свёрнутому оно
  // нужнее всего.
  const shut = head({ collapsed: true, filter: { ...EMPTY, query: "Т" }, shown: 12 });
  assert.equal(shut.hint, strings.filters.expand + ". " + strings.filters.narrowed);
});

test("меток на схеме нет — счётчику нечего показывать", () => {
  assert.equal(head({ shown: 0, total: 0 }).count, "");
  assert.equal(head({ shown: 0, total: 0, filter: { ...EMPTY, query: "Т" } }).count, "");
});
