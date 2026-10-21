// Кому принадлежит клавиша (находка 10 разбора механик, дешёвая половина).
//
// Четыре починки, ни одна из которых не требовала решения:
//
// 1. Обработчик `blur` плана был **мёртв**: он стоял в ветке `else` от проверки
//    на `ResizeObserver`, то есть ни в одном живом браузере не вешался. Зажал
//    стрелку, ушёл в другое окно — `keyup` не придёт, и план продолжал ехать по
//    возвращении; зажатый пробел так же оставался зажатым.
// 2. Три предиката «фокус в поле» на три поверхности, расходившиеся на
//    галочке: Ctrl+Z на плане замолкал после щелчка по галочке фильтров, хотя
//    в чертеже тот же жест отменял.
// 3. Пробел-панорама на плане не снимал действие браузера: щёлкнул кнопку
//    панели, подвинул план пробелом, отпустил — кнопка срабатывала второй раз.
// 4. `R` (и `Q`/`E` того же механизма) не спрашивали `event.repeat`: придержал
//    клавишу — вещь крутилась вслепую, и в истории оставался десяток шагов.
//
// Плюс пятое: Shift-панорама работала в двух поверхностях из трёх, при
// комментарии чертежа «на холсте так же».
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { uiFieldTarget, uiTypingTarget } from "../src/panels/ui.js";
import { volumeTypingTarget } from "../src/panels/volume.js";

const srcDir = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
const read = (name) => readFileSync(join(srcDir, name), "utf8");

test("набор текста: буква принадлежит полю", () => {
  assert.equal(uiTypingTarget({ tagName: "INPUT" }), true);
  assert.equal(uiTypingTarget({ tagName: "input", type: "number" }), true);
  assert.equal(uiTypingTarget({ tagName: "TEXTAREA" }), true);
  assert.equal(uiTypingTarget({ tagName: "DIV", isContentEditable: true }), true);
  // Галочка и переключатель полем не считаются: набирать в них нечего, а
  // Ctrl+Z после щелчка по галочке обязан отменять правку объекта.
  assert.equal(uiTypingTarget({ tagName: "INPUT", type: "checkbox" }), false);
  assert.equal(uiTypingTarget({ tagName: "INPUT", type: "radio" }), false);
  // Список — не набор: отмена в нём работает, стрелки — нет (см. ниже).
  assert.equal(uiTypingTarget({ tagName: "SELECT" }), false);
  assert.equal(uiTypingTarget({ tagName: "CANVAS" }), false);
  assert.equal(uiTypingTarget(null), false);
});

test("своя клавиатура поля: список и ползунок ведут стрелки сами", () => {
  assert.equal(uiFieldTarget({ tagName: "SELECT" }), true);
  assert.equal(uiFieldTarget({ tagName: "INPUT", type: "range" }), true);
  assert.equal(uiFieldTarget({ tagName: "INPUT" }), true);
  assert.equal(uiFieldTarget({ tagName: "TEXTAREA" }), true);
  assert.equal(uiFieldTarget({ tagName: "INPUT", type: "checkbox" }), false);
  assert.equal(uiFieldTarget({ tagName: "BUTTON" }), false);
  assert.equal(uiFieldTarget(null), false);
});

test("предикат один на три поверхности", () => {
  // У объёма осталось имя, а правило — общее.
  for (const target of [
    { tagName: "SELECT" },
    { tagName: "INPUT", type: "checkbox" },
    { tagName: "INPUT", type: "range" },
    { tagName: "CANVAS" },
    null,
  ]) {
    assert.equal(volumeTypingTarget(target), uiFieldTarget(target));
  }
  // Своих предикатов в поверхностях больше нет.
  for (const name of ["canvas.js", join("panels", "workshop.js"), join("panels", "volume.js")]) {
    const text = read(name);
    assert.ok(!/function canvasTypingTarget/.test(text), name + ": свой предикат фокуса вернулся");
    assert.ok(
      !/tagName === "SELECT"|tag === "select"/.test(text),
      name + ": своё сравнение с SELECT вернулось",
    );
  }
});

test("обработчик blur плана живой: он вне ветки про ResizeObserver", () => {
  const text = read("canvas.js");
  const blurAt = text.indexOf('window.addEventListener("blur", canvasWindowBlur)');
  const observerAt = text.indexOf('if (typeof ResizeObserver === "function")');
  assert.ok(blurAt > 0, "обработчик blur не зарегистрирован вовсе");
  assert.ok(observerAt > 0, "проверка ResizeObserver пропала — тест потерял смысл");
  assert.ok(
    blurAt < observerAt,
    "blur снова стоит внутри ветки про ResizeObserver, то есть в живых браузерах не вешается",
  );
  // Чертёж и объём вешают свой безусловно — так же, как теперь и план.
  assert.ok(read(join("panels", "workshop.js")).includes('window.addEventListener("blur"'));
  assert.ok(read(join("panels", "volume.js")).includes('window.addEventListener("blur"'));
});

test("пробел на плане снимает действие браузера и на нажатии, и на отпускании", () => {
  const text = read("canvas.js");
  const down = text.slice(text.indexOf("function canvasKeyDown"), text.indexOf("function canvasKeyUp"));
  const up = text.slice(text.indexOf("function canvasKeyUp"), text.indexOf("function canvasPointerLeave"));
  const space = down.slice(down.indexOf('event.code === "Space"'));
  assert.ok(space.includes("event.preventDefault()"), "пробел на нажатии не снимает прокрутку страницы");
  assert.ok(space.includes("if (canvasSpace) return;"), "автоповтор системы считается новым нажатием");
  assert.ok(up.includes("event.preventDefault()"), "кнопку под фокусом пробел нажимает именно по keyup");
});

test("R, Q и E крутят по одному шагу на нажатие", () => {
  const text = read(join("panels", "workshop.js"));
  const guard = /if \(event\.repeat && \(event\.code === "KeyR" \|\| event\.code === "KeyQ" \|\| event\.code === "KeyE"\)\) return;/;
  assert.ok(guard.test(text), "автоповтор снова набивает историю шагами поворота");
  // Охрана стоит **до** разбора этих клавиш, иначе она ничего не значит.
  assert.ok(text.search(guard) < text.indexOf('event.code === "KeyR" && !event.altKey'));
});

test("Shift просит панораму во всех трёх поверхностях", () => {
  // Комментарий чертежа утверждал «на холсте так же (там ещё и пробел)», а на
  // холсте `event.shiftKey` в указательных обработчиках не встречался вовсе.
  const plan = read("canvas.js");
  assert.ok(
    /event\.button === 1 \|\| canvasSpace \|\| event\.shiftKey/.test(plan),
    "Shift на плане снова не возит план",
  );
  assert.ok(/event\.button === 1 \|\| event\.shiftKey/.test(read(join("panels", "workshop.js"))));
  assert.ok(/event\.button === 1 \|\| event\.shiftKey/.test(read(join("panels", "schemes.js"))));
});
