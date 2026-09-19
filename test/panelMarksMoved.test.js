// Прокрутка за уехавшей строкой.
//
// Прокрутка умела один повод — сменилось выделение. Заказчик нашёл дыру: «при
// смене типа метки в списке меток она оказывается где-то за видимой областью —
// скролль до неё». Список упорядочен по типам, смена типа уносит строку в
// другой его конец, а выделение при этом не меняется.
//
// Правило шире одного случая: строка должна остаться на виду, если уехала она,
// а не пользователь. Поэтому переезд считается не по списку поводов, а по
// самому месту строки — и проверяется здесь, без DOM и высот.
import test from "node:test";
import assert from "node:assert/strict";
import { MARKS_SCROLL_MOVED, MARKS_SCROLL_SELECTION, marksScrollNeed } from "../src/panels/marks.js";

const at = (top, height = 282) => ({ top, height });
const shown = (selection, box) => ({ selection, box });

test("сменилось выделение — подводим к новой строке", () => {
  const need = marksScrollNeed(shown("метка-1", at(100)), shown("метка-2", at(900)));
  assert.equal(need, MARKS_SCROLL_SELECTION);
  // И на первой перерисовке, когда показывать ещё было нечего.
  assert.equal(marksScrollNeed(shown("", null), shown("метка-1", at(100))), MARKS_SCROLL_SELECTION);
});

test("та же метка на новом месте — переезд", () => {
  // Смена типа: строка ушла из светильников в розетки, к другому концу списка.
  assert.equal(marksScrollNeed(shown("метка-1", at(100)), shown("метка-1", at(1400))), MARKS_SCROLL_MOVED);
  // Ручная смена номера: переезд внутри своего типа, на пару строк.
  assert.equal(marksScrollNeed(shown("метка-1", at(400)), shown("метка-1", at(476))), MARKS_SCROLL_MOVED);
  // Смыкание номеров и удаление соседа: строка едет вверх, потому что
  // сдвинулось всё, что над ней.
  assert.equal(marksScrollNeed(shown("метка-1", at(800)), shown("метка-1", at(762))), MARKS_SCROLL_MOVED);
});

test("строка осталась на месте — прокрутку не трогаем", () => {
  // Это и есть «пользователь листает сам»: место меряется от начала
  // содержимого, прокрутка на него не влияет, и перерисовка списка сама по
  // себе не повод возвращать его к выделенной метке.
  assert.equal(marksScrollNeed(shown("метка-1", at(500)), shown("метка-1", at(500))), null);
});

test("карточка выросла на месте — тоже переезд", () => {
  // У метки завели связь, и в карточке прибавилась строка «Управляется»: верх
  // там же, а низ ушёл под кнопку смыкания. Для пользователя это то же самое
  // «уехала не я».
  assert.equal(marksScrollNeed(shown("метка-1", at(500, 282)), shown("метка-1", at(500, 310))), MARKS_SCROLL_MOVED);
});

test("выделенной строки в выдаче нет — не дёргаемся", () => {
  // Сменили метке помещение при фильтре по помещению: строка ушла из выдачи.
  assert.equal(marksScrollNeed(shown("метка-1", at(500)), shown("метка-1", null)), null);
  // Выделение сняли вовсе.
  assert.equal(marksScrollNeed(shown("метка-1", at(500)), shown("", null)), null);
  // Метка выделена, но она на другой схеме — строки нет и подводить не к чему.
  assert.equal(marksScrollNeed(shown("", null), shown("метка-2", null)), null);
});

test("строка вернулась в выдачу — подводим к ней", () => {
  // Фильтр по помещению сняли, и выделенная метка снова в списке. Прежнего
  // места у неё нет, но за кадром её оставлять нельзя.
  assert.equal(marksScrollNeed(shown("метка-1", null), shown("метка-1", at(900))), MARKS_SCROLL_MOVED);
});

test("прошлого показа не было вовсе", () => {
  assert.equal(marksScrollNeed(null, shown("метка-1", at(100))), MARKS_SCROLL_SELECTION);
  assert.equal(marksScrollNeed(null, shown("", null)), null);
  assert.equal(marksScrollNeed(shown("метка-1", at(100)), null), null);
});
