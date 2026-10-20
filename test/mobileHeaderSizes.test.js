// Шапка телефона и «Интерфейс проекта» окном (таск 175, требования G271 и
// G272), и прокрутка левой колонки (G259).
//
// Все три правила живут в разметке и стилях, а зелёный прогон про них не
// говорит ничего: сборка склеивает и то и другое текстом. Разойтись здесь есть
// чему, и молча:
//
//   **имя схемы** убрано из шапки насовсем (G271) — вернись узел или строка
//     словаря, и на 360 точках снова появится «Схема до…»;
//   **поля «Интерфейса проекта» собираются один раз** (G272) — вторая сборка
//     для окна разошлась бы с колонкой на первой же правке, и человек,
//     покрутивший подписи с телефона, не нашёл бы этого переключателя за
//     столом;
//   **прокрутка левой колонки одна** (G259) — вернись потолок в половину
//     колонки или прокрутка телу раздела, и ползунок снова встанет рядом с
//     ползунком.
//
// Приём тот же, что в `fieldBare.test.js` и `cssMeasures.test.js`: читается
// текст, а живой вид — снимком.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { LAYOUT_ABILITIES, PANEL_IDS, layoutAllows } from "../src/app.js";
import { strings } from "../src/strings.js";

const MARKUP = readFileSync(new URL("../src/index.html", import.meta.url), "utf8");
const APP_CSS = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
const APP_JS = readFileSync(new URL("../src/app.js", import.meta.url), "utf8");
const TOOLS_JS = readFileSync(new URL("../src/panels/tools.js", import.meta.url), "utf8");

// Тело правила по точному селектору: всё между `{` и `}`.
function ruleBody(css, selector) {
  const at = css.indexOf("\n" + selector + " {");
  assert.ok(at >= 0, "правила не стало: " + selector);
  const from = css.indexOf("{", at);
  const to = css.indexOf("}", from);
  return css.slice(from + 1, to);
}

test("G271: имени схемы в шапке нет ни узлом, ни правилом, ни строкой", () => {
  assert.equal(MARKUP.includes('id="scheme-name"'), false, "узел имени схемы вернулся в шапку");
  assert.equal(APP_CSS.includes("#scheme-name"), false, "правило имени схемы осталось в стилях");
  assert.equal(APP_JS.includes("syncSchemeName"), false, "подстановка имени схемы осталась в каркасе");
  // Строка «Схема не выбрана» жила только под этим узлом. Мёртвый ключ красит
  // прогон `strings.test.js`, но здесь важно другое: пустая шапка не должна
  // снова начать что-то говорить.
  assert.equal(Object.prototype.hasOwnProperty.call(strings.mobile, "noScheme"), false);
});

test("G272: кнопка «Интерфейс проекта» есть в шапке и только на узкой раскладке", () => {
  assert.ok(MARKUP.includes('id="' + PANEL_IDS.headerSizes + '"'), "в шапке нет точки монтирования кнопки");
  // Умение разрешено на телефоне — иначе кнопка считалась бы правкой и не
  // показывалась бы вовсе.
  assert.equal(layoutAllows("viewSizes", "mobile"), true);
  assert.deepEqual(LAYOUT_ABILITIES.viewSizes, ["desktop", "mobile"]);
  // На большом экране кнопки нет: раздел стоит в колонке, и вторая дверь к тем
  // же полям там лишняя.
  assert.match(TOOLS_JS, /layout !== "mobile" \|\| !layoutAllows\("viewSizes", layout\)/);
  // Называется кнопка тем же словом, что раздел: двух имён у одних полей быть
  // не должно.
  assert.match(TOOLS_JS, /uiIconButton\("sliders", \{\s*\n\s*label: strings\.panels\.sizes,/);
});

test("G272: поля собираются один раз — и для колонки, и для окна", () => {
  // Одна сборка — одна функция, и зовут её ровно два места: раздел колонки и
  // окно. Третьего вызова и второй сборки полей быть не должно.
  const calls = TOOLS_JS.match(/(?<!function )createSizesFields\(api\)/g) || [];
  assert.equal(calls.length, 2, "сборку полей зовут не два места, а " + calls.length);
  assert.match(TOOLS_JS, /function mountSizesPanel\(host, api\) \{\s*\n\s*host\.replaceChildren\(createSizesFields\(api\)\.node\);/);
  assert.match(TOOLS_JS, /body: fields\.node,/, "окно собирает поля не той же сборкой");
  // Подписка окна снимается на закрытии — и кнопкой, и Escape: иначе она
  // рисовала бы в выброшенный из разметки ящик.
  assert.equal((TOOLS_JS.match(/fields\.dispose\(\)/g) || []).length, 2);
});

test("G259 и G295: прокрутка одна на колонку — и правило одно на обе", () => {
  // Правило общее: ни одного селектора с ключом колонки у прокрутки больше нет
  // — иначе колонки опять разъехались бы поведением, как до таска 194.
  assert.equal(APP_CSS.includes("#panel-left .panel__"), false, "у левой колонки завелось своё правило прокрутки");
  assert.equal(APP_CSS.includes("#panel-right .panel__"), false, "у правой колонки завелось своё правило прокрутки");
  assert.match(ruleBody(APP_CSS, ".panel__body"), /overflow: visible;/);
  const section = ruleBody(APP_CSS, ".panel__section");
  assert.match(section, /flex: 0 0 auto;/, "раздел снова ужимается — прокрутка вернётся в тело");
  assert.equal(/max-height/.test(section), false, "потолок в половину колонки вернулся");
  // Растущий раздел (слева список схем, справа список меток) по-прежнему
  // забирает остаток, но ниже содержимого не садится.
  assert.match(ruleBody(APP_CSS, ".panel__section--grow"), /flex: 1 0 auto;/);
  // Свёрнутый не растёт: иначе один заголовок растянулся бы на всю колонку.
  const shut = ruleBody(APP_CSS, ".panel__section.is-collapsed,\n.panel__section--grow.is-collapsed");
  assert.match(shut, /flex: 0 0 auto;/);
  // Своих потолков у «Чертежа» не осталось: три списка живут общим правилом, а
  // «какие разделы ниже» отвечает рейка заголовков, а не треть колонки.
  assert.equal(APP_CSS.includes("max-height: 34%"), false, "потолок в треть колонки вернулся");
  assert.equal(APP_CSS.includes("max-height: 62%"), false, "потолок разделу с полями вернулся");
  // Заголовки по-прежнему липкие — ими колонка и остаётся проходимой.
  assert.match(ruleBody(APP_CSS, ".panel__head"), /position: sticky;/);
  // В листе снизу прокрутка остаётся у тела: лист — один раздел на весь экран.
  assert.match(ruleBody(APP_CSS, "#app.is-mobile .panel__body"), /overflow: auto;/);
});
