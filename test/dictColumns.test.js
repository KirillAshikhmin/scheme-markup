// Колонки справочника стоят колонка в колонку (дефект D30).
//
// Слова заказчика со снимком: «таблица в справочнике едет, поля должны быть
// фиксированной ширины». Ехала она по двум причинам сразу, и обе — в стилях:
//
//   1. Поле кода объявлено `.dict__code { flex: none; width: 120px }`, а общее
//      правило строки — `.dict__row .ui-input { flex: 1 }`. У общего правила
//      специфичность выше, и поле кода вело себя вторым полем названия: делило
//      с ним свободную ширину. В живом прогоне оно меряется 203, 211, 214 px —
//      у каждой строки своё.
//   2. Кнопка умолчаний размеров ширины не имела вовсе и бралась по своей
//      подписи: 178…271 px. Эта разница и двигала все поля строки, а строка
//      добавления (кнопки размеров у неё нет) уезжала от строк типов на 95 px.
//
// Правка — в стилях, и **зелёный прогон её не подтверждает**: сборка клеит CSS
// текстом, структуру никто не разбирает. Снимок и измеренные ширины — в отчёте
// таска; здесь держится то, что из стилей можно прочесть текстом: у каждой
// колонки есть мера, меры записаны так, что общее правило строки их не
// перебивает, и хвост строки добавления считает **все** колонки хвоста.
//
// Тот же приём, которым `printFooter.test.js` стережёт печать: читаем файл
// стилей как текст и проверяем в нём правила.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const CSS = readFileSync(new URL("../src/panels/marks.css", import.meta.url), "utf8");

// Блок правила по точному селектору: всё между `{` и `}`.
function ruleBody(selector) {
  const at = CSS.indexOf("\n" + selector + " {");
  if (at < 0) return null;
  const from = CSS.indexOf("{", at);
  const to = CSS.indexOf("}", from);
  return CSS.slice(from + 1, to);
}

// Значения мер: `--dict-code: 120px`.
function measure(name) {
  const found = CSS.match(new RegExp("--dict-" + name + ":\\s*(\\d+)px"));
  return found ? Number(found[1]) : null;
}

test("у каждой колонки строки справочника есть своя мера", () => {
  for (const name of ["gap", "act", "count", "code", "sizes", "sign", "view"]) {
    assert.ok(measure(name) > 0, "мера --dict-" + name + " потерялась");
  }
  // Колонки, которые не тянутся: значок, код, выбор категории, вид, знак,
  // каналы, изображение, размеры, счётчик и кнопки конца строки. Тянуться в
  // строке имеет право ровно одно поле — название типа.
  const fixed = {
    ".dict__badge": "width: 48px",
    ".dict__row .dict__code": "width: var(--dict-code)",
    ".dict__row .dict__channels": "width: 56px",
    // Кнопка изображения (таск 218) — такая же колонка: у типа без своего имени
    // на ней стоит подпись «по знаку», и по её длине колонка ехала бы от строки
    // к строке ровно так, как ехала колонка размеров (D30).
    ".dict__view": "width: var(--dict-view)",
    ".dict__sizes": "width: var(--dict-sizes)",
    ".dict__count": "width: var(--dict-count)",
    ".dict__act": "width: var(--dict-act)",
  };
  for (const [selector, declaration] of Object.entries(fixed)) {
    const body = ruleBody(selector);
    assert.ok(body, "правило " + selector + " пропало");
    assert.ok(body.includes("flex: none"), selector + ": колонка тянется вместе со строкой");
    assert.ok(body.includes(declaration), selector + ": мера колонки не " + declaration);
  }
  // Выбор категории меру держит сам (самое длинное имя категории), но
  // сжиматься вместе с соседями не должен.
  assert.ok(ruleBody(".dict__row .ui-select").includes("flex: none"), "выбор категории сжимается");
});

test("меры полей записаны сильнее общего правила строки — иначе оно их перебьёт", () => {
  // `.dict__row .ui-input { flex: 1 }` — одно на все поля строки. Поле со
  // своей мерой обязано называться через строку, иначе выигрывает общее
  // правило: ровно на этом поле кода и разъезжалось.
  const common = ruleBody(".dict__row .ui-input");
  assert.ok(common && common.includes("flex: 1"), "общее правило полей строки пропало");
  for (const field of ["dict__code", "dict__channels"]) {
    assert.ok(
      CSS.includes(".dict__row ." + field + " {"),
      field + ": мера записана без `.dict__row` — общее правило строки её перебьёт",
    );
    assert.ok(
      !new RegExp("\\n\\." + field + "\\s*\\{").test(CSS),
      field + ": осталось слабое правило, которое ничего не держит",
    );
  }
});

test("строка добавления считает весь хвост строки типа — вместе с колонкой размеров", () => {
  // Кнопка строки добавления занимает место всего хвоста: размеры, счётчик,
  // две кнопки и промежутки между ними. Пропусти в этом счёте колонку — и
  // поля строки добавления станут шире полей строк типов ровно на неё.
  const body = ruleBody(".dict__add");
  assert.ok(body, "правило .dict__add пропало");
  // Колонка изображения (таск 218) встала в хвост перед размерами, и промежуток
  // с ней стал четвёртым: пропусти их в счёте — и поля строки добавления снова
  // уехали бы от строк типов, теперь на 70 точек.
  for (const part of [
    "var(--dict-view)",
    "var(--dict-sizes)",
    "var(--dict-count)",
    "var(--dict-act) * 2",
    "var(--dict-gap) * 4",
  ]) {
    assert.ok(body.includes(part), ".dict__add: в хвосте не посчитано " + part);
  }
  // Строка добавления категории считает свой хвост — он другой: знак и
  // корзина. Эта пара в таске 126 уже сходилась, и трогать её незачем.
  const category = ruleBody(".dict__addCategory");
  assert.ok(category.includes("var(--dict-sign)") && category.includes("var(--dict-act)"), "хвост категории поехал");
});
