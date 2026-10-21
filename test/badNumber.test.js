// Один ответ на негодное число (находка 9 разбора механик).
//
// Ответов было три. Окно размеров метки разбирало число моделью, красило поле,
// ставило причину в окне и не закрывалось. Колонка чертежа разбирала `Number()`
// — и «абв» в поле поворота становилось нулём **молча**, разворачивая вещь, —
// а на отказ модели показывала плашку в углу экрана и тихо возвращала прежнее
// число: человек смотрел на поле, а ответ ему давали в другом месте, и
// набранное пропадало.
//
// Выбран ответ окна: **у поля, и набранное остаётся на правку**. Плашка в углу
// осталась отказам, которые к полю не привязаны («окно не садится в эту
// стену»): показать их у одного из четырёх полей значило бы указать не на то.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  drawingHeightMm,
  drawingOffsetMm,
  drawingPositiveMm,
  schemeObjectTurnDeg,
} from "../src/model.js";
import { workshopParseFields } from "../src/panels/workshop.js";
import { uiMarkBad } from "../src/panels/ui.js";
import { markSizesParse } from "../src/panels/markSizes.js";
import { strings } from "../src/strings.js";

const srcDir = join(dirname(fileURLToPath(import.meta.url)), "..", "src");

// Поле, какого хватает `uiMarkBad`: класс-список и значение.
function fakeInput(value = "") {
  const classes = new Set();
  return {
    value,
    classList: {
      toggle(name, on) {
        if (on) classes.add(name);
        else classes.delete(name);
      },
      has: (name) => classes.has(name),
    },
  };
}

function fakeLine() {
  return { textContent: "", hidden: true };
}

test("годные числа разбираются правилами модели", () => {
  const width = fakeInput("900");
  const floor = fakeInput("0");
  const turn = fakeInput("90");
  const height = fakeInput("");
  const parsed = workshopParseFields([
    { key: "widthMm", input: width, value: width.value, parse: drawingPositiveMm },
    { key: "heightAboveFloorMm", input: floor, value: floor.value, parse: drawingOffsetMm },
    { key: "turnDeg", input: turn, value: turn.value, parse: schemeObjectTurnDeg },
    // Пустая высота вещи — «во всю высоту помещения», а не ноль.
    { key: "heightMm", input: height, value: height.value, parse: drawingHeightMm },
  ]);
  assert.deepEqual(parsed.bad, []);
  assert.deepEqual(parsed.values, { widthMm: 900, heightAboveFloorMm: 0, turnDeg: 90, heightMm: null });
});

test("негодное число больше не превращается в ноль молча", () => {
  // Ровно тот случай: `Number(objectTurn.value) || 0` разворачивал вещь на
  // нулевой угол, ничего не сказав.
  const turn = fakeInput("абв");
  const parsed = workshopParseFields([
    { key: "turnDeg", input: turn, value: turn.value, parse: schemeObjectTurnDeg },
  ]);
  assert.equal(parsed.values.turnDeg, null, "ноль из мусора больше не выходит");
  assert.equal(parsed.bad.length, 1);
  assert.equal(parsed.bad[0].input, turn);
  assert.equal(parsed.bad[0].message, strings.errors.schemeObjectTurnInvalid);
});

test("минус и пустота отвергаются с причиной, названной моделью", () => {
  const negative = fakeInput("-5");
  const empty = fakeInput("");
  const parsed = workshopParseFields([
    { key: "heightAboveFloorMm", input: negative, value: negative.value, parse: drawingOffsetMm },
    { key: "thicknessMm", input: empty, value: empty.value, parse: drawingPositiveMm },
  ]);
  assert.equal(parsed.bad.length, 2);
  assert.equal(parsed.bad[0].message, strings.errors.drawingMmNegative);
  assert.equal(parsed.bad[1].message, strings.errors.drawingMmInvalid);
  // Порядок — порядок полей: причина показывается от первого негодного.
  assert.equal(parsed.bad[0].input, negative);
});

test("ответ у поля: красное поле, причина строкой, набранное остаётся", () => {
  const line = fakeLine();
  const good = fakeInput("900");
  const bad = fakeInput("-5");
  assert.equal(uiMarkBad(line, [good, bad], [{ input: bad, message: "Так нельзя" }]), true);
  assert.equal(bad.classList.has("is-bad"), true);
  assert.equal(good.classList.has("is-bad"), false, "красным помечено не то поле");
  assert.equal(line.textContent, "Так нельзя");
  assert.equal(line.hidden, false);
  assert.equal(bad.value, "-5", "набранное откатилось — ровно то, от чего уходили");
  // Поправили — отметка и строка уходят.
  assert.equal(uiMarkBad(line, [good, bad]), false);
  assert.equal(bad.classList.has("is-bad"), false);
  assert.equal(line.hidden, true);
  assert.equal(line.textContent, "");
});

test("окно размеров метки отвечает тем же", () => {
  // Правило окна не менялось — менялся только кирпич, которым оно отвечает.
  const parsed = markSizesParse({ length: "абв", depth: "-100", width: "", heightAboveFloor: "300" });
  assert.equal(parsed.invalid.length, 1, "минус у «Ширины» законен — это утопленное");
  assert.equal(parsed.invalid[0].field, "length");
  assert.equal(parsed.values.depth, -100);
  assert.equal(parsed.values.width, null);
  assert.equal(parsed.values.heightAboveFloor, 300);
});

test("своего разбора числа в колонке чертежа больше нет", () => {
  // Сканированием: вернись `Number(...)` в применение полей — и «абв» снова
  // стало бы нулём молча, а прогон бы об этом не сказал.
  const text = readFileSync(join(srcDir, "panels", "workshop.js"), "utf8");
  for (const name of ["applyThickness", "applyOpeningFields", "applyObjectFields"]) {
    const at = text.indexOf("function " + name + "(");
    assert.ok(at > 0, "функция " + name + " пропала — тест потерял смысл");
    const body = text.slice(at, at + 2200);
    const end = body.indexOf("\n  }");
    const code = body
      .slice(0, end > 0 ? end : body.length)
      .split("\n")
      // Строки-пояснения не код: в них `Number(...)` назван нарочно — чтобы
      // следующий знал, что здесь стояло и почему ушло.
      .filter((line) => !line.trimStart().startsWith("//") && !line.trimStart().startsWith("*"))
      .join("\n");
    assert.ok(!/Number\(/.test(code), name + ": свой разбор числа вернулся");
    assert.ok(/workshopParseFields\(/.test(code), name + ": разбор идёт мимо модели");
    assert.ok(/uiMarkBad\(/.test(code), name + ": ответ не у поля");
  }
});

test("строка причины и красное поле есть во всех трёх пачках и в окне высот", () => {
  const text = readFileSync(join(srcDir, "panels", "workshop.js"), "utf8");
  for (const name of ["wallBad", "openingBad", "objectBad", "heightBad"]) {
    assert.ok(text.includes(name + " = uiBadLine()"), "нет строки причины: " + name);
    assert.ok(text.includes(name + ","), "строка причины не поставлена в разметку: " + name);
  }
  // Красный вид — один на окно метки и на колонку.
  const css = readFileSync(join(srcDir, "panels", "panels.css"), "utf8");
  assert.ok(/\.ui-input\.is-bad[\s\S]{0,80}border-color: var\(--danger\)/.test(css));
  assert.ok(/\.ui-bad\s*\{[\s\S]{0,120}color: var\(--danger\)/.test(css));
});
