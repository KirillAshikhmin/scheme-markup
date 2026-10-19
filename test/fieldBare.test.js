// Угол поля и полный экран «Объёма» — правила, которые живут в стилях (таск
// 166, G245 и G246).
//
// Зелёный прогон про стили не говорит ничего: сборка склеивает их текстом. А
// разойтись здесь есть чему, и молча:
//
//   место кнопки вида считается **не её собственными числами**, а общей мерой
//     угла — иначе поправка кнопки полного экрана разводит столбик;
//   полный экран в «Объёме» убирает с страницы шапку, колонки, ручки, нижний
//     ряд и переключатель режимов — и **только их**: пропади из списка колонка,
//     и она останется поверх сцены; попади в список лишнее, и человек потеряет
//     из полного экрана выход.
//
// Поэтому правила читаются как текст и сверяются числами — так же, как
// `dictColumns` сверяет колонки справочника.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const CANVAS_CSS = readFileSync(new URL("../src/panels/canvas.css", import.meta.url), "utf8");
const VOLUME_CSS = readFileSync(new URL("../src/panels/volume.css", import.meta.url), "utf8");
const APP_CSS = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");

// Тело правила по точному селектору: всё между `{` и `}`.
function ruleBody(css, selector) {
  const at = css.indexOf("\n" + selector + " {");
  assert.ok(at >= 0, "правила не стало: " + selector);
  const from = css.indexOf("{", at);
  const to = css.indexOf("}", from);
  return css.slice(from + 1, to);
}

// Значение свойства из тела правила, в одну строку.
function prop(body, name) {
  const match = body.match(new RegExp("(?:^|;|\\n)\\s*" + name + ":\\s*([^;]+);", "m"));
  assert.ok(match, "в правиле нет свойства " + name);
  return match[1].replace(/\s+/g, " ").trim();
}

// Меры угла — из самих стилей, а не переписанные сюда числом: поправят там,
// упадёт здесь.
const CORNER = {
  size: Number(prop(ruleBody(CANVAS_CSS, "#app"), "--canvas-corner-size").replace("px", "")),
  edge: Number(prop(ruleBody(CANVAS_CSS, "#app"), "--canvas-corner-edge").replace("px", "")),
  gap: Number(prop(ruleBody(CANVAS_CSS, "#app"), "--canvas-corner-gap").replace("px", "")),
  mobileSize: Number(prop(ruleBody(CANVAS_CSS, "#app.is-mobile"), "--canvas-corner-size").replace("px", "")),
};

/**
 * Во что складывается выражение `calc(...)` в точках.
 *
 * Переменные подставляются мерами угла, линейка — нулём (её рисует только план,
 * а речь про поле объёма). Считать арифметику сама проверка не умеет — её
 * считает движок, — но пускает в счёт только цифры и знаки, никаких имён: если
 * в выражении осталось неподставленное `var(...)`, проверка падает, а не
 * выдумывает число.
 */
function px(value, size = CORNER.size) {
  const filled = value
    .replace(/var\(--canvas-corner-size\)/g, String(size))
    .replace(/var\(--canvas-corner-edge\)/g, String(CORNER.edge))
    .replace(/var\(--canvas-corner-gap\)/g, String(CORNER.gap))
    .replace(/var\(--canvas-hint-inset,\s*0px\)/g, "0")
    .replace(/calc/g, "")
    .replace(/px/g, "");
  assert.match(filled, /^[\d\s+*().]+$/, "в мере осталось чужое имя: " + value);
  return Function("return " + filled)();
}

test("мера угла объявлена один раз, и обе кнопки берут размер оттуда", () => {
  assert.ok(CORNER.size > 0 && CORNER.edge > 0 && CORNER.gap > 0);
  // Палец крупнее курсора: на узком экране кнопки угла подрастают.
  assert.ok(CORNER.mobileSize > CORNER.size, "на телефоне кнопка угла должна быть крупнее");
  const corner = ruleBody(CANVAS_CSS, ".canvas-corner");
  assert.equal(prop(corner, "width"), "var(--canvas-corner-size)");
  assert.equal(prop(corner, "height"), "var(--canvas-corner-size)");
  // Своих размеров у кнопок нет ни у одной: общий вид — в `.canvas-corner`.
  for (const [css, selector] of [
    [CANVAS_CSS, ".canvas-full"],
    [VOLUME_CSS, ".volume__viewBtn"],
  ]) {
    const body = ruleBody(css, selector);
    assert.doesNotMatch(body, /\bwidth:/, selector + " завёл свою ширину");
    assert.doesNotMatch(body, /\bheight:/, selector + " завёл свою высоту");
  }
});

test("кнопка вида стоит ровно под кнопкой полного экрана, по той же оси", () => {
  const full = ruleBody(CANVAS_CSS, ".canvas-full");
  const view = ruleBody(VOLUME_CSS, ".volume__viewBtn");
  // Один край — иначе «под кнопкой» превращается в «где-то рядом».
  assert.equal(prop(full, "right"), prop(view, "right"));
  const fullTop = px(prop(full, "top"));
  const viewTop = px(prop(view, "top"));
  assert.equal(viewTop - fullTop, CORNER.size + CORNER.gap, "кнопки разъехались по высоте");
  // И на узком экране тоже: там кнопка крупнее, но столбик остаётся столбиком.
  assert.equal(
    px(prop(view, "top"), CORNER.mobileSize) - px(prop(full, "top"), CORNER.mobileSize),
    CORNER.mobileSize + CORNER.gap,
  );
  // Промежуток есть, но кнопки не разбросаны: палец не должен путать их, а
  // глаз — не должен искать вторую.
  assert.ok(CORNER.gap >= 4 && CORNER.gap <= CORNER.size / 2);
});

test("развёрнутая плашка на узком экране уходит под кнопки угла, а в «Объёме» — под обе", () => {
  const row = ruleBody(CANVAS_CSS, "#app.is-mobile .canvas-hint:not(.is-collapsed)");
  const one = px(prop(row, "top"), CORNER.mobileSize);
  assert.equal(one, CORNER.edge + CORNER.mobileSize + CORNER.gap, "плашка легла на верхний ряд кнопок");
  const second = ruleBody(
    VOLUME_CSS,
    "#app.is-mobile .volume__stage .canvas-hint.canvas-hint--info:not(.is-collapsed)",
  );
  const two = px(prop(second, "top"), CORNER.mobileSize);
  // В объёме ячеек две — полный экран и вид: сводка опускается под обе, иначе
  // она накрыла бы смену вида и съела её нажатия.
  assert.equal(two, CORNER.edge + 2 * (CORNER.mobileSize + CORNER.gap));
  assert.ok(two > one);
});

// ——— полный экран «Объёма»: что уходит и что остаётся (G246) ———————————————

const BARE_HIDDEN = APP_CSS.slice(
  APP_CSS.indexOf("#app.is-field-bare #app-header"),
  APP_CSS.indexOf("}", APP_CSS.indexOf("#app.is-field-bare #app-header")),
);

test("полный экран объёма оставляет страницу одной клеткой — самим полем", () => {
  const bare = ruleBody(APP_CSS, "#app.is-field-bare");
  assert.equal(prop(bare, "grid-template-areas"), '"canvas"');
  assert.equal(prop(bare, "grid-template-columns"), "1fr");
  assert.equal(prop(bare, "grid-template-rows"), "1fr");
});

test("прячется шапка, обе колонки с ручками, нижний ряд и переключатель режимов", () => {
  for (const part of [
    "#app-header",
    "#panel-left",
    "#panel-right",
    ".panel-handle",
    "#mobile-bar",
    "#canvas-modes",
  ]) {
    assert.ok(BARE_HIDDEN.includes(part), "в полном экране осталось лишнее: " + part);
  }
  // Лист снизу прячется своим правилом: у правила с отметкой листа вес выше.
  const sheet = APP_CSS.indexOf('#app.is-mobile[data-sheet="schemes"] #panel-left');
  const shut = APP_CSS.indexOf("#app.is-field-bare.is-mobile #panel-left");
  assert.ok(sheet >= 0 && shut > sheet, "правило листа должно стоять выше, иначе оно перебьёт");
});

test("то, ради чего в полный экран и уходят, не прячется", () => {
  // Сцена, карточка метки, наложение с кнопкой выхода, сенсорная оснастка и
  // уведомления. Выход — главное: спрячь кнопку полного экрана, и из него
  // останется только Esc, о котором пальцем никто не узнает.
  for (const part of [
    "#screen-volume",
    "#canvas-overlay",
    "#canvas-card",
    ".canvas-full",
    ".canvas-corner",
    ".volume__",
    "#notifications",
    "#dialog-host",
  ]) {
    assert.ok(!BARE_HIDDEN.includes(part), "полный экран спрятал нужное: " + part);
  }
});
