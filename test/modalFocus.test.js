// Окно показывается с того места, где стоит, а не прокрученным к кнопке
// (таск 290, живой прогон).
//
// Нашлось глазами: отчёт о слиянии без общего предка — заголовок, строка
// «Файл в папке», списки «Пришло со стороны», «Разошлось», «Номера совпали»,
// «Могло задвоиться» и довод под ним — выше предела `.modal`
// (`max-height: 90vh`), и окно открывалось **сразу прокрученным к низу**:
// фокус уходил на единственную кнопку «Понятно», а она стоит под всеми
// списками. Человек, которому окно сообщает, что пришло со стороны, видел
// середину текста.
//
// Прокрутку живого браузера в прогоне не воспроизвести — проверяется сама
// дверь: фокус ставится с `preventScroll`, и ставит его `uiFocusEntry` только
// через неё.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { uiFocusNode } from "../src/panels/ui.js";

const srcDir = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
const read = (name) => readFileSync(join(srcDir, name), "utf8");

test("фокус в окне не двигает прокрутку окна", () => {
  const calls = [];
  const node = {
    focus(options) {
      calls.push(options);
    },
  };
  assert.equal(uiFocusNode(node), true);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], { preventScroll: true });
});

test("фокусировать нечего — это не поломка", () => {
  assert.equal(uiFocusNode(null), false);
  assert.equal(uiFocusNode(undefined), false);
  assert.equal(uiFocusNode({}), false);
});

test("окно фокусируется этой дверью, второго `focus()` в диалоге нет", () => {
  const source = read("panels/ui.js");
  const body = source.slice(source.indexOf("function uiFocusEntry"));
  const entry = body.slice(0, body.indexOf("\n}") + 2);
  assert.match(entry, /uiFocusNode\(target\)/);
  assert.doesNotMatch(entry, /target\.focus\(/);
});

test("окно прокручивается само — иначе правило не о чем", () => {
  // Правило существует ровно потому, что `.modal` выше экрана прокручивается
  // внутри себя. Пропадёт прокрутка — пропадёт и повод, и эта строка скажет,
  // что правило пора пересмотреть, а не тихо носить дальше.
  const css = readFileSync(join(srcDir, "panels", "panels.css"), "utf8");
  const rule = css.slice(css.indexOf("\n.modal {"), css.indexOf("\n.modal--fit"));
  assert.match(rule, /max-height:\s*90vh/);
  assert.match(rule, /overflow:\s*auto/);
});
