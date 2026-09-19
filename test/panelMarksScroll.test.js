// Прокрутка списка меток к выделенной строке.
//
// Заказчик поправил первую попытку: порядок строк не трогаем, двигаем только
// прокрутку, — и развёл два случая. Выделил метку на схеме: строка встаёт
// вверху видимой части, потому что искать её глазами по всему списку он не
// нанимался. Ткнул в саму строку: она уже под курсором, и дёргать её нельзя —
// прокрутка включается, только если раскрытая карточка не поместилась, и
// тогда она минимальна. Общее правило, которым проверяется и то и другое:
// «чтобы при выделении вся развёрнутая метка была на экране».
//
// Сам скролл — дело браузера, а вот «куда прокрутить» считается чистой
// функцией, и проверяется она здесь: в Node нет ни DOM, ни высот.
import test from "node:test";
import assert from "node:assert/strict";
import { MARKS_ALIGN_LEAST, MARKS_ALIGN_TOP, MARKS_SCROLL_GAP, marksScrollTop } from "../src/panels/marks.js";

// Список как на экране: десятки свёрнутых строк по 30 и одна раскрытая.
// Ящик — 800, но сверху к нему прилип непрозрачный блок фильтров, снизу —
// кнопка смыкания. Строки видно только в полосе между ними, и прокрутка
// обязана считать именно по ней: без накладок «подведённая к верху» строка
// уезжает под фильтры. Живой прогон поймал это снимком, тест держит дальше.
const AREA = { scrollTop: 0, clientHeight: 800, scrollHeight: 2000, headInset: 190, footInset: 50 };
const area = (extra) => ({ ...AREA, ...extra });
const STRIP = AREA.clientHeight - AREA.headInset - AREA.footInset;

// Видна ли строка целиком при такой прокрутке — то самое общее правило.
function whole(row, top, box) {
  const head = box.headInset || 0;
  const foot = box.footInset || 0;
  return row.top >= top + head && row.top + row.height <= top + box.clientHeight - foot;
}

test("выделение на схеме: строка встаёт под фильтрами, а не под ними же спрятанной", () => {
  const row = { top: 900, height: 280 };
  const top = marksScrollTop(row, area(), MARKS_ALIGN_TOP);
  assert.equal(top, 900 - AREA.headInset - MARKS_SCROLL_GAP);
  assert.ok(whole(row, top, AREA), "раскрытая карточка обязана быть видна целиком");
  // Умолчание — тот же случай: со стороны выделение приходит чаще всего.
  assert.equal(marksScrollTop(row, area()), top);
});

test("накладки учитываются: без них строка уехала бы под прилипшие фильтры", () => {
  const row = { top: 900, height: 280 };
  const withChrome = marksScrollTop(row, area(), MARKS_ALIGN_TOP);
  const without = marksScrollTop(row, area({ headInset: 0, footInset: 0 }), MARKS_ALIGN_TOP);
  assert.equal(without, 900 - MARKS_SCROLL_GAP);
  assert.equal(withChrome, without - AREA.headInset);
  // Та самая ошибка: по расчёту без накладок строка оказывается под фильтрами.
  assert.equal(whole(row, without, AREA), false);
});

test("первые строки: прокрутка не уходит в минус", () => {
  assert.equal(marksScrollTop({ top: 0, height: 280 }, area(), MARKS_ALIGN_TOP), 0);
  assert.equal(marksScrollTop({ top: 200, height: 30 }, area(), MARKS_ALIGN_TOP), 4);
});

test("последние метки: докручиваем до конца и стоим, а не дёргаемся", () => {
  // Строка у самого низа содержимого: к верху её не поднять — под ней пусто.
  const row = { top: 1850, height: 100 };
  const box = area({ scrollTop: 400 });
  const top = marksScrollTop(row, box, MARKS_ALIGN_TOP);
  assert.equal(top, 1200, "упёрлись в конец содержимого");
  assert.equal(top, box.scrollHeight - box.clientHeight);
  assert.ok(whole(row, top, box), "последняя строка всё равно видна целиком");
  // Второй раз то же самое: повторное выделение той же метки не дёргает список.
  assert.equal(marksScrollTop(row, area({ scrollTop: top }), MARKS_ALIGN_TOP), top);
});

test("карточка выше полосы: верх подводится к кромке фильтров, без зазора", () => {
  // Раскрытая метка со связями и размерами в невысоком окне: целиком её не
  // показать ничем, поэтому читаем сверху вниз.
  const row = { top: 700, height: STRIP + 40 };
  assert.equal(marksScrollTop(row, area(), MARKS_ALIGN_TOP), 700 - AREA.headInset);
  // Источник тут роли не играет: «подними чуть выше, чтобы поместился»,
  // доведённое до предела, — это и есть прижатый верх.
  assert.equal(marksScrollTop(row, area({ scrollTop: 300 }), MARKS_ALIGN_LEAST), 700 - AREA.headInset);
});

test("клик по строке в списке: карточка видна целиком — не двигаем ничего", () => {
  const box = area({ scrollTop: 600 });
  // Строка внутри полосы: 800…1080 при полосе 790…1350.
  const row = { top: 800, height: 280 };
  assert.ok(whole(row, box.scrollTop, box));
  assert.equal(marksScrollTop(row, box, MARKS_ALIGN_LEAST), 600, "строка уехала бы из-под курсора");
});

test("клик по строке в списке: раскрытая вылезла вниз — опускаем минимально", () => {
  const box = area({ scrollTop: 600 });
  // Свёрнутая строка была видна у нижней кромки, раскрытая — уже нет.
  const row = { top: 1200, height: 280 };
  assert.equal(whole(row, box.scrollTop, box), false);
  const top = marksScrollTop(row, box, MARKS_ALIGN_LEAST);
  assert.equal(top, 1200 + 280 + MARKS_SCROLL_GAP - 800 + AREA.footInset);
  assert.ok(whole(row, top, box), "нижняя граница обязана стать видимой");
  // Именно минимально: к верху её никто не тащит.
  assert.ok(top > box.scrollTop, "опускаем, а не поднимаем");
  assert.ok(top < row.top - AREA.headInset, "верх строки остался на экране");
  assert.ok(top < marksScrollTop(row, box, MARKS_ALIGN_TOP), "это меньше, чем подвести к верху");
});

test("клик по строке в списке: строка ушла под фильтры — подводим её верх", () => {
  const box = area({ scrollTop: 900 });
  // 1000 при прокрутке 900 — это 100 от кромки ящика, то есть под фильтрами.
  const row = { top: 1000, height: 280 };
  assert.equal(whole(row, box.scrollTop, box), false);
  const top = marksScrollTop(row, box, MARKS_ALIGN_LEAST);
  assert.equal(top, 1000 - AREA.headInset - MARKS_SCROLL_GAP);
  assert.ok(whole(row, top, box));
});

test("прокручивать нечего: короткий список остаётся на нуле", () => {
  const box = { scrollTop: 0, clientHeight: 800, scrollHeight: 300, headInset: 190, footInset: 50 };
  assert.equal(marksScrollTop({ top: 220, height: 30 }, box, MARKS_ALIGN_TOP), 0);
  assert.equal(marksScrollTop({ top: 220, height: 30 }, box, MARKS_ALIGN_LEAST), 0);
});
