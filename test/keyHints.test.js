// Дорогая половина находки про клавиши (таск 213): кому принадлежит клавиша,
// когда фокус ушёл на кнопку колонки, и где об этой клавише написано.
//
// Три вещи, все три названы исполнителем таска 182 и замерены им по дороге:
//
// 1. **Клавиши плана умирали после щелчка по кнопке в колонке.** Стрелки и
//    «+»/«−» холст брал себе только когда «клавиатура ничья» — цель события
//    документ или что-то внутри холста. Кнопка колонки под это не подходила,
//    и план переставал листаться, хотя подсказка стрелки обещает. В чертеже та
//    же клавиша в тот же миг работала.
// 2. **Про пробел и Shift на плане нигде не было написано**, хотя панорама с
//    таска 182 живёт на всех трёх поверхностях.
// 3. **Enter назван не везде, где работает**: в чертеже он заканчивает цепочку
//    стен, полосу и контур, а в подсказках стоял только у контура.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { strings } from "../src/strings.js";

const srcDir = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
const read = (name) => readFileSync(join(srcDir, name), "utf8");

test("ход и масштаб плана не спрашивают, где стоит фокус", () => {
  const text = read("canvas.js");
  assert.ok(
    !/canvasKeyboardOwner/.test(text),
    "проверка «клавиатура ничья» вернулась: щелчок по кнопке колонки снова убьёт стрелки",
  );
  // Своего сравнения с холстом тоже быть не должно — именно им проверка и
  // отличала «ничью» клавиатуру от кнопки панели.
  assert.ok(
    !/canvasHost\.contains\(/.test(text),
    "холст снова решает по фокусу, кому принадлежит клавиша",
  );
  // Отсекают клавишу те же двое, что и в чертеже: диалог и поле.
  const down = text.slice(text.indexOf("function canvasKeyDown"), text.indexOf("function canvasKeyUp"));
  assert.ok(down.includes("uiDialogDepth() > 0"), "диалог больше не забирает клавиатуру");
  assert.ok(down.includes("uiTypingTarget(event.target)"), "поле набора больше не забирает клавиатуру");
  assert.ok(down.includes("uiFieldTarget(event.target)"), "список и ползунок больше не ведут свои стрелки");
  // Ход и масштаб стоят после обоих отсечений.
  const panAt = down.indexOf("canvasPanKeyDown(event.code)");
  assert.ok(panAt > down.indexOf("uiFieldTarget(event.target)"), "ход идёт раньше, чем отсечены поля");
});

test("предикат фокуса один на всю сборку", () => {
  // Своих было четыре; таск 182 свёл три, четвёртый прятался у «/».
  for (const name of ["canvas.js", join("panels", "workshop.js"), join("panels", "volume.js"), join("panels", "search.js")]) {
    const text = read(name);
    assert.ok(
      !/tagName === "INPUT"|tagName === "SELECT"|tag === "input"|tag === "select"/.test(text),
      name + ": своё сравнение с полем ввода вернулось",
    );
  }
  assert.ok(read(join("panels", "search.js")).includes("uiFieldTarget(event.target)"), "«/» снова судит о поле сама");
});

test("про пробел и Shift написано там, где человек читает про ход плана", () => {
  // Правило сборки: горячий ключ, о котором негде прочитать, всё равно что его
  // нет. Панорама живёт на всех трёх поверхностях, в чертеже про Shift сказано
  // с самого начала, на плане не было ни слова.
  for (const hint of [strings.canvas.hintSelect, strings.canvas.hintSelectMode]) {
    assert.match(hint, /Shift/, "в подсказке плана не сказано про Shift");
    assert.match(hint, /пробел/, "в подсказке плана не сказано про пробел");
    // Рядом со стрелками и масштабом: это один и тот же вопрос — как двигать план.
    assert.match(hint, /Стрелки листают план/);
  }
  // В чертеже слова про Shift были и остались своими — переписывать привычное
  // ради единообразия нельзя (правило таска 182).
  assert.match(strings.workshop.hint, /перетаскивание с Shift — сдвиг/);
});

test("Enter назван везде, где заканчивает начатое", () => {
  // Чертёж: Enter кончает цепочку стен, полосу и контур — одна ветка на троих.
  for (const hint of [strings.workshop.hint, strings.workshop.hintBand, strings.workshop.hintContour]) {
    assert.match(hint, /Enter/, "занятие кончается Enter, а в подсказке его нет");
  }
  // Проверяем по исходнику, что ветка и правда одна и правда на троих.
  const text = read(join("panels", "workshop.js"));
  const at = text.indexOf('event.key === "Enter" && draft');
  assert.ok(at > 0, "Enter в чертеже больше не кончает черновик — подсказки врут");
  const branch = text.slice(at, at + 700);
  for (const name of ["finishContour()", "finishBand()", "finishChain()"]) {
    assert.ok(branch.includes(name), "Enter больше не кончает " + name);
  }
});

test("на плане Enter не назван — потому что его там нет", () => {
  // Это **не** недосмотр и не расхождение слов: ломаная плана кончается
  // двойным кликом, ветки Enter у холста нет вовсе. Назови его в подсказке —
  // и подсказка начнёт врать. Разница поверхностей здесь настоящая, и свести
  // её словами нельзя; свести её поведением — отдельное решение, не это.
  const text = read("canvas.js");
  const down = text.slice(text.indexOf("function canvasKeyDown"), text.indexOf("function canvasKeyUp"));
  assert.ok(!down.includes('"Enter"'), "на плане появился Enter — теперь его надо назвать в подсказках");
  for (const hint of [strings.canvas.hintLine, strings.canvas.hintRoom]) {
    assert.ok(!/Enter/.test(hint), "подсказка плана обещает Enter, которого у холста нет");
    assert.match(hint, /Двойной клик|двойной клик/, "чем же кончается ломаная");
  }
});

test("Enter окон поиска назван, и там, где он делает другое, сказано именно это", () => {
  // Жест один на все окна выбора (`uiPickSearch`, таск 183), а сказан был в
  // одном окне из пяти.
  const named = [
    strings.search.title,
    strings.picker.searchHint,
    strings.objectPicker.searchHint,
    strings.equipmentPicker.searchHint,
    strings.controls.searchHint,
    strings.controls.searchHintOne,
  ];
  for (const line of named) {
    assert.match(line, /Enter/, "окно поиска молчит про Enter");
    assert.match(line, /[Сс]трелка вниз/, "окно поиска молчит про стрелку вниз");
  }
  // Два исключения — про дело, и оба названы словами, а не умолчанием.
  // У типов и моделей Enter заводит новое, когда не нашлось ничего.
  assert.match(strings.picker.searchHint, /заводит тип/);
  assert.match(strings.equipmentPicker.searchHint, /заводит её/);
  // В окне связей Enter отмечает и ждёт следующего запроса, а не закрывает окно.
  assert.match(strings.controls.searchHint, /отмечает первую строку/);
  assert.match(strings.controls.searchHintOne, /выбирает первую строку/);
});

test("подсказка поиска доезжает до поля, а не лежит в словаре мёртвой", () => {
  for (const [name, key] of [
    [join("panels", "typePicker.js"), "strings.picker.searchHint"],
    [join("panels", "objectPicker.js"), "strings.objectPicker.searchHint"],
    [join("panels", "equipmentPicker.js"), "strings.equipmentPicker.searchHint"],
  ]) {
    assert.ok(read(name).includes("title: " + key), name + ": подсказка поиска не прокинута в поле");
  }
});
