// Нижний предел ширины плашки (таск 185, D47) — правило, которое живёт в
// стилях целиком.
//
// Зелёный прогон про стили не говорит ничего: сборка склеивает их текстом.
// А разойтись здесь есть чему, и молча:
//
//   предел пропал из одной из четырёх мер ширины — и эта плашка снова уходит в
//     столбик по букве, а остальные три стоят как надо (на снимке такое видно
//     только в том режиме, в котором смотрели);
//   предел дорос до потолка — и ширина перестала зависеть от поля вообще,
//     то есть «на обычном поле как сейчас» больше не выполняется;
//   предел перерос самое узкое поле — и плашка уже не накрывает кнопки, а
//     обрезается кромкой поля (`#canvas-area` режет по себе);
//   у плашки сняли `pointer-events: none` или опустили её под переключатель —
//     и перекрытие либо съедает нажатия, либо нечитаемо. Эти два свойства
//     поставлены вместе и держатся вместе.
//
// Поэтому правила читаются текстом и сверяются числами — тот же приём, что в
// `fieldBare` и `cssMeasures`.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { LAYOUT_NARROW_WIDTH } from "../src/app.js";
import { RULER_SIZE } from "../src/render.js";

const CANVAS_CSS = readFileSync(new URL("../src/panels/canvas.css", import.meta.url), "utf8");
const APP_CSS = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");

// Без комментариев: в них те же числа и те же слова, что в правилах, и искать
// по тексту пришлось бы с оглядкой на прозу.
function bare(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

// Правила файла: селектор и тело. Разбор нарочно простой — вложенных правил и
// `@media` в этом файле нет, и появись они, разбор упадёт, а не соврёт.
function rules(css) {
  const text = bare(css);
  assert.equal(text.includes("@media"), false, "в canvas.css появился @media — разбор правил больше не годится");
  const out = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(text))) out.push({ selector: m[1].replace(/\s+/g, " ").trim(), body: m[2] });
  return out;
}

// Значение свойства в одну строку; `null` — свойства в правиле нет.
function prop(body, name) {
  const match = body.match(new RegExp("(?:^|;|\\n)\\s*" + name + ":\\s*([^;]+);", "m"));
  return match ? match[1].replace(/\s+/g, " ").trim() : null;
}

function px(value) {
  const match = String(value).match(/^(-?\d+(?:\.\d+)?)px$/);
  assert.ok(match, "ждали число в точках, а стоит: " + value);
  return Number(match[1]);
}

const RULES = rules(CANVAS_CSS);

// Сам предел — из стиля, а не переписанный сюда числом.
const DECLARED = RULES.filter((rule) => prop(rule.body, "--canvas-plate-min") !== null);
const PLATE_MIN = px(prop(DECLARED[0] ? DECLARED[0].body : "", "--canvas-plate-min"));

// Все меры ширины плашек: правило про `.canvas-hint`, в котором есть
// `max-width`. Их четыре — две на настольную раскладку и две на просмотр.
const WIDTHS = RULES.filter((rule) => rule.selector.includes(".canvas-hint") && prop(rule.body, "max-width") !== null);

test("предел ширины объявлен ровно в одном месте — на самой плашке", () => {
  assert.equal(DECLARED.length, 1);
  assert.equal(DECLARED[0].selector, ".canvas-hint");
});

test("предел стоит у каждой меры ширины плашки", () => {
  assert.ok(WIDTHS.length >= 4, "мер ширины стало меньше четырёх: " + WIDTHS.length);
  for (const rule of WIDTHS) {
    const value = prop(rule.body, "max-width");
    assert.ok(value.startsWith("max("), "ширина не через `max()` — " + rule.selector + ": " + value);
    assert.ok(value.includes("var(--canvas-plate-min)"), "ширина без предела — " + rule.selector + ": " + value);
  }
});

test("предел ниже потолков ширины: на обычном поле решает поле", () => {
  // Потолки — те самые числа из `min()`: 460 у подсказки, 360 у сводки. Стань
  // предел больше любого из них, и плашка перестала бы считаться от поля
  // вовсе: заказчик просил обратного — «если нормально, то как и сейчас».
  const caps = [];
  for (const rule of WIDTHS) {
    const value = prop(rule.body, "max-width");
    for (const found of value.matchAll(/min\(\s*(\d+)px/g)) caps.push(Number(found[1]));
  }
  assert.ok(caps.length >= 2, "потолков ширины в стилях не нашлось");
  for (const cap of caps) assert.ok(PLATE_MIN < cap, "предел " + PLATE_MIN + " не ниже потолка " + cap);
});

test("предел укладывается в самое узкое поле настольной раскладки", () => {
  // Самое узкое поле: окно на границе раскладок и обе колонки открыты.
  const panel = px(prop(bare(APP_CSS), "--panel-width"));
  const field = LAYOUT_NARROW_WIDTH + 1 - 2 * panel;
  // Мера угла — из своего правила в этом же файле (таск 166), а не числом.
  const cornerBody = RULES.find((rule) => prop(rule.body, "--canvas-corner-edge") !== null).body;
  const corner = { edge: px(prop(cornerBody, "--canvas-corner-edge")), size: px(prop(cornerBody, "--canvas-corner-size")) };
  // Подсказке слева мешает линейка, сводке справа — полоса под угловые кнопки.
  const hintRoom = field - 12 - RULER_SIZE;
  const infoRoom = field - (corner.edge + corner.size + 8);
  assert.ok(PLATE_MIN <= hintRoom, "подсказке в самом узком поле остаётся " + hintRoom + ", а предел " + PLATE_MIN);
  assert.ok(PLATE_MIN <= infoRoom, "сводке в самом узком поле остаётся " + infoRoom + ", а предел " + PLATE_MIN);
});

test("перекрытие не съедает нажатия и не прячется под переключателем", () => {
  const plate = RULES.find((rule) => rule.selector === ".canvas-hint");
  assert.ok(plate, "правила `.canvas-hint` не стало");
  assert.equal(prop(plate.body, "pointer-events"), "none");
  const toggle = RULES.find((rule) => rule.selector === ".canvas-hint__toggle");
  assert.equal(prop(toggle.body, "pointer-events"), "auto");
  const modes = RULES.find((rule) => rule.selector === ".canvas-modes");
  const plateZ = Number(prop(plate.body, "z-index"));
  const modesZ = Number(prop(modes.body, "z-index"));
  assert.ok(plateZ > modesZ, "плашка (" + plateZ + ") обязана быть выше переключателя (" + modesZ + ")");
});

test("строка с подсказкой наведения наведение получает", () => {
  // В сводке «Объёма» перечень неразмещённых меток живёт в `title`: пропусти
  // такую строку клики насквозь — и подсказка браузера не выйдет вовсе.
  const line = RULES.find((rule) => rule.selector === ".canvas-hint__text > p[title]");
  assert.ok(line, "правила для строки с `title` не стало");
  assert.equal(prop(line.body, "pointer-events"), "auto");
});
