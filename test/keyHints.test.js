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
    // Сетка изображений в справочнике типов (таск 218) стоит на том же
    // `uiPickSearch` — значит и жест у неё тот же, и сказан теми же словами.
    strings.dictionary.viewSearchHint,
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
    [join("panels", "equipmentPicker.js"), "strings.equipmentPicker.searchHint"],
  ]) {
    assert.ok(read(name).includes("title: " + key), name + ": подсказка поиска не прокинута в поле");
  }
  // Сетка плиток (таск 187) с таска 218 служит двум хозяевам: окну вещей и
  // сетке изображений в справочнике типов. Слова ей присылает хозяин, поэтому
  // в поле едет `words.searchHint`, а проверять надо обе двери — иначе
  // подсказка одного из окон тихо осталась бы в словаре.
  const tiles = read(join("panels", "objectPicker.js"));
  assert.ok(tiles.includes("title: words.searchHint"), "сетка плиток не прокидывает подсказку в поле");
  assert.ok(
    tiles.includes("options.strings || strings.objectPicker"),
    "окно вещей перестало отдавать сетке свои слова",
  );
  assert.ok(
    read(join("panels", "types.js")).includes("searchHint: strings.dictionary.viewSearchHint"),
    "сетка изображений не отдаёт свою подсказку",
  );
});

// ——— диалог забирает клавиатуру у всех трёх поверхностей (таск 222, D74) ——
//
// Дефект D74 оказался **не дефектом**, и это нашлось проверкой: исполнитель
// таска 220 прочитал тело `onKeyDown` чертежа, не увидел там `uiDialogDepth`
// и записал находку, а вопрос этот стоит уровнем выше — в `active()`, куда
// обработчик упирается первой же строкой. Живой прогон это и показывал: при
// открытом окне «Что добавить» «+» не делает ничего.
//
// Раз проверять было нечем, тест и заведён: правило сборки «пока
// `uiDialogDepth() > 0`, клавиатура принадлежит диалогу» держалось на одном
// комментарии, и первый же рефакторинг `active()` снял бы его молча.
test("пока открыт диалог, клавиатура не принадлежит ни плану, ни чертежу, ни объёму", () => {
  // План спрашивает первым делом в самом обработчике.
  const canvas = read("canvas.js");
  const down = canvas.slice(canvas.indexOf("function canvasKeyDown"), canvas.indexOf("function canvasKeyUp"));
  const dialogAt = down.indexOf("uiDialogDepth() > 0");
  assert.ok(dialogAt >= 0, "план перестал спрашивать про диалог");
  assert.ok(
    dialogAt < down.indexOf("uiTypingTarget(event.target)"),
    "порядок сбился: поле набора спрашивается раньше диалога",
  );

  // Чертёж и объём спрашивают через «моя ли это минута»: обработчик упирается
  // в сторожа первой строкой, а сторож спрашивает и свой экран, и диалог.
  // Имя сторожа у них разное (`active` и `ours`), и это не важно — важно, что
  // он один и что в нём оба вопроса.
  for (const [name, screen] of [
    [join("panels", "workshop.js"), '"drawing"'],
    [join("panels", "volume.js"), '"volume"'],
  ]) {
    const text = read(name);
    const handler = text.slice(text.indexOf("function onKeyDown"));
    const guard = /^function onKeyDown\(event\) \{\s*if \(!(\w+)\(\)\) return;/.exec(handler);
    assert.ok(guard, name + ": клавиши перестали упираться в сторожа первой же строкой");
    const body = text.slice(text.indexOf("function " + guard[1] + "()"));
    const line = body.slice(0, body.indexOf("}")).split("\n").find((item) => item.includes("screenMode() === " + screen));
    assert.ok(line, name + ": сторож перестал спрашивать про свой экран");
    assert.match(line, /uiDialogDepth\(\) === 0/, name + ": диалог перестал забирать клавиатуру");
  }
});
