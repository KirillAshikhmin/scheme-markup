// Рейка заголовков: что ниже кадра — то у нижней кромки колонки (таск 194,
// G295), а нажатие на заголовок у кромки перелистывает к его разделу (таск
// 198, G303).
//
// Слова заказчика: «помимо sticky headers сверху, он должен быть и снизу. Что
// бы группы были видны всегда» и, про нажатие, «нажал — прыгнуло туда — да,
// так и надо, а то приходится самому листать, это не очевидно».
//
// Верх липнет сам браузером, низ — счёт, и счёт этот чистый: на входе места
// разделов и высоты их заголовков, на выходе — на сколько поднять каждый и у
// какой кромки он оказался. В Node нет ни DOM, ни высот, поэтому проверяется
// здесь именно он, а живой вид — снимком. Приклейка к стилям и к разметке
// (`transform`, меры `--panel-rail` и `--panel-head`, две кнопки в заголовке)
// читается текстом: зелёный прогон про стили не говорит ничего.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { PANEL_RAIL_SHARE, panelRailPins, panelRailTopInset } from "../src/panels/rail.js";
import { strings } from "../src/strings.js";

const MARKUP = readFileSync(new URL("../src/index.html", import.meta.url), "utf8");
const APP_CSS = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
const PANELS_CSS = readFileSync(new URL("../src/panels/panels.css", import.meta.url), "utf8");
const MARKS_CSS = readFileSync(new URL("../src/panels/marks.css", import.meta.url), "utf8");
const WORKSHOP_CSS = readFileSync(new URL("../src/panels/workshop.css", import.meta.url), "utf8");
const RAIL_JS = readFileSync(new URL("../src/panels/rail.js", import.meta.url), "utf8");
const APP_JS = readFileSync(new URL("../src/app.js", import.meta.url), "utf8");

// Колонка как на экране: пять разделов по 300 точек, заголовок у каждого 30.
const HEAD = 30;
const STEP = 300;
const COLUMN = Array.from({ length: 5 }, (unused, k) => ({ top: k * STEP, box: STEP, head: HEAD }));

const shifts = (pins) => pins.map((pin) => pin.shift);
const sides = (pins) => pins.map((pin) => pin.side);
// Где заголовок нарисован: своё место плюс сдвиг.
const drawn = (items, pins, k) => items[k].top + pins[k].shift;

test("всё влезло в кадр — никто не прилип", () => {
  const pins = panelRailPins(COLUMN, { scrollTop: 0, clientHeight: 5 * STEP });
  assert.deepEqual(shifts(pins), [0, 0, 0, 0, 0]);
  assert.deepEqual(sides(pins), ["", "", "", "", ""]);
});

test("кадр показывает полтора раздела: хвост стоит рейкой у нижней кромки", () => {
  const frame = { scrollTop: 0, clientHeight: 420 };
  const pins = panelRailPins(COLUMN, frame);
  // Первые два стоят сами: один виден целиком, у второго виден заголовок.
  assert.deepEqual(shifts(pins).slice(0, 2), [0, 0]);
  // Остальные трое — у кромки, по порядку, без щелей и без наложений.
  const edge = frame.scrollTop + frame.clientHeight;
  assert.equal(drawn(COLUMN, pins, 4) + HEAD, edge, "последний раздел не у самой кромки");
  assert.equal(drawn(COLUMN, pins, 3) + HEAD, drawn(COLUMN, pins, 4), "между заголовками рейки щель");
  assert.equal(drawn(COLUMN, pins, 2) + HEAD, drawn(COLUMN, pins, 3), "между заголовками рейки щель");
  // Порядок в рейке — порядок разделов: что ниже в колонке, то ниже и в рейке.
  assert.deepEqual(shifts(pins), [0, 0, -270, -540, -810]);
  assert.deepEqual(sides(pins), ["", "", "bottom", "bottom", "bottom"]);
  // Рейка начинается там, где кончается заголовок ближнего раздела, стоящий
  // сам: по колонке читается «вот этот, а вот эти трое ниже».
  assert.equal(drawn(COLUMN, pins, 1) + HEAD, drawn(COLUMN, pins, 2));
});

test("заголовок снимается с рейки непрерывно — без прыжка на пороге", () => {
  const frame = (scrollTop) => ({ scrollTop, clientHeight: 420 });
  // Порог третьего раздела: кромка минус два заголовка под ним минус свой.
  assert.equal(panelRailPins(COLUMN, frame(269))[2].shift, -1);
  assert.equal(panelRailPins(COLUMN, frame(270))[2].shift, 0);
  assert.equal(panelRailPins(COLUMN, frame(271))[2].shift, 0);
  // Снявшись с рейки, он не тянет за собой соседей: те, кто ниже, стоят где
  // стояли — рейка уменьшилась ровно на один заголовок.
  const after = panelRailPins(COLUMN, frame(270));
  assert.deepEqual(shifts(after).slice(3), [-270, -540]);
  assert.equal(drawn(COLUMN, after, 4) + HEAD, 270 + 420, "нижний в рейке съехал с кромки");
  assert.equal(drawn(COLUMN, after, 3) + HEAD, drawn(COLUMN, after, 4), "в рейке появилась щель");
});

test("вниз заголовок не двигается никогда", () => {
  for (const scrollTop of [0, 100, 270, 640, 1000, 1500]) {
    for (const pin of panelRailPins(COLUMN, { scrollTop, clientHeight: 420 })) {
      assert.ok(pin.shift <= 0, "заголовок уехал вниз по своему же содержимому: " + pin.shift);
    }
  }
});

test("докрутили до конца — рейка пуста: ниже кадра не осталось никого", () => {
  const pins = panelRailPins(COLUMN, { scrollTop: 5 * STEP - 420, clientHeight: 420 });
  assert.deepEqual(shifts(pins), [0, 0, 0, 0, 0]);
  // У нижней кромки нет никого, зато у верхней стоит тот, чей раздел её
  // пересекает: это делает браузер сам, а рейка только помечает — по метке
  // решается, что сделает нажатие.
  assert.deepEqual(sides(pins), ["", "", "", "top", ""]);
});

test("низкий кадр: рейка не съедает больше половины, лишние снимаются с дальнего конца", () => {
  const frame = { scrollTop: 0, clientHeight: 200 };
  const pins = panelRailPins(COLUMN, frame);
  const rail = pins.filter((pin) => pin.shift !== 0).length * HEAD;
  assert.ok(rail <= frame.clientHeight * PANEL_RAIL_SHARE, "рейка заняла " + rail + " из " + frame.clientHeight);
  // Остались ближние: дальний раздел и так за двумя другими, а ближний —
  // следующий, к которому человек подойдёт прокруткой.
  assert.deepEqual(shifts(pins), [0, -190, -460, -730, 0]);
  // Снятый с рейки указателем не считается: его нигде не нарисовано.
  assert.deepEqual(sides(pins), ["", "bottom", "bottom", "bottom", ""]);
  // Нижний в рейке по-прежнему у самой кромки — рейка не висит в воздухе.
  assert.equal(drawn(COLUMN, pins, 3) + HEAD, frame.scrollTop + frame.clientHeight);
});

test("кадра нет вовсе (спрятанная колонка, нулевая высота) — считать нечего", () => {
  assert.deepEqual(shifts(panelRailPins(COLUMN, { scrollTop: 0, clientHeight: 0 })), [0, 0, 0, 0, 0]);
  assert.deepEqual(panelRailPins([], { scrollTop: 0, clientHeight: 420 }), []);
  assert.deepEqual(shifts(panelRailPins(COLUMN, {})), [0, 0, 0, 0, 0]);
});

test("один раздел на колонку (объём): прилипать некуда и незачем", () => {
  const single = [{ top: 0, box: 2000, head: HEAD }];
  assert.deepEqual(panelRailPins(single, { scrollTop: 0, clientHeight: 200 }), [{ shift: 0, side: "" }]);
  // Уехав вниз по длинному списку, единственный заголовок остаётся липким
  // сверху — и нажатие на него обязано перематывать к началу раздела, как и в
  // рейке снизу: сверху и снизу правило одно.
  assert.deepEqual(panelRailPins(single, { scrollTop: 900, clientHeight: 200 }), [{ shift: 0, side: "top" }]);
});

test("свёрнутые разделы в рейке участвуют: группа видна и свёрнутой", () => {
  // Свёрнутый раздел — это только заголовок: места в колонке 30 точек.
  const items = [
    { top: 0, box: 600, head: HEAD },
    { top: 600, box: HEAD, head: HEAD },
    { top: 630, box: HEAD, head: HEAD },
    { top: 660, box: HEAD, head: HEAD },
  ];
  const pins = panelRailPins(items, { scrollTop: 0, clientHeight: 420 });
  assert.deepEqual(shifts(pins), [0, -270, -270, -270]);
  assert.equal(drawn(items, pins, 3) + HEAD, 420);
});

test("свёрнутый раздел к верхней кромке не липнет: двигать заголовок ему некуда", () => {
  const items = [
    { top: 0, box: HEAD, head: HEAD },
    { top: HEAD, box: 900, head: HEAD },
  ];
  // Прокрутка прошла свёрнутый раздел насквозь — он уехал вместе с заголовком.
  assert.deepEqual(sides(panelRailPins(items, { scrollTop: 200, clientHeight: 420 })), ["", "top"]);
});

test("перелистывание целится под накладку, и накладку считает рейка", () => {
  // В колонке разделы друг на друга не налезают, поэтому в целевом положении у
  // верхней кромки стоит сам позванный раздел — и ответ всегда ноль. Важно,
  // что это ответ счёта, а не допущение.
  for (let k = 0; k < COLUMN.length; k += 1) assert.equal(panelRailTopInset(COLUMN, k), 0);
  // А встанет сверху когда-нибудь лестница заголовков — цель уедет ниже на их
  // высоту сама, без правок в том, кто рейку зовёт. Раскладка здесь нарочно
  // невозможная: раздел накрывает собой соседа.
  const stacked = [
    { top: 0, box: 2000, head: HEAD },
    { top: 500, box: 300, head: HEAD },
  ];
  assert.equal(panelRailTopInset(stacked, 1), HEAD);
});

test("приём и его цена записаны там, где их будут искать", () => {
  // Поднимает заголовок трансформация — и это главное свойство приёма: место в
  // раскладке остаётся за заголовком, высота содержимого и прокрутка не
  // меняются. Вернись сюда `position`, и список дёргался бы на каждом кадре.
  assert.match(RAIL_JS, /translateY\(/);
  assert.equal(RAIL_JS.includes("position: absolute"), false);
  assert.equal(RAIL_JS.includes("position: fixed"), false);
  // Один кадр на обе колонки, и записи только на смену значения: наследуемая
  // мера, переписанная вслепую, пересчитала бы стили у всех строк списка.
  assert.match(RAIL_JS, /requestAnimationFrame/);
  assert.match(RAIL_JS, /if \(node\.style\.transform !== css\)/);
  assert.match(RAIL_JS, /if \(node\.style\.getPropertyValue\(name\) !== css\)/);
  // Перелистывание мгновенное: плавное в колонке на три с лишним тысячи точек
  // полсекунды перестраивает рейку и показывает по дороге чужие строки.
  assert.match(RAIL_JS, /column\.scrollTop = shown\[index\]\.top - panelRailTopInset\(shown, index\);/);
  assert.equal(RAIL_JS.includes("smooth"), false, "плавная прокрутка вернулась без уговора");
  assert.equal(APP_CSS.includes("scroll-behavior"), false, "плавную прокрутку включили стилем");
  // Рейку завязывает каркас — после панелей, иначе высот у разделов ещё нет.
  assert.match(APP_JS, /for \(const id of appPanels\.keys\(\)\) mountPanel\(id\);\n\s*\/\/[^\n]*\n\s*\/\/[^\n]*\n\s*wirePanelRail\(\);/);
  // И трогает её там, где сам меняет высоты: свёрнутость и режим экрана.
  assert.equal((APP_JS.match(/syncPanelRail\(\);/g) || []).length, 2);
});

test("нажатие: имя спрашивает рейку, галочка сворачивает всегда", () => {
  // Сначала рейка, потом сворачивание — и ровно в таком порядке: заголовок у
  // кромки перелистывает, на своём месте сворачивает, как прежде.
  assert.match(APP_JS, /if \(panelRailJump\(button\)\) return;\n\s*toggleSection\(button\.dataset\.section\);/);
  // Галочка о рейке не знает вовсе: у неё одно дело в любом месте.
  assert.match(
    APP_JS,
    /\[data-section-fold\]"\)\) \{\n\s*button\.addEventListener\("click", \(\) => toggleSection\(button\.dataset\.sectionFold\)\);/,
  );
  // Состояние «свёрнуто» висит на галочке: у имени дело меняется от места, и
  // обещать голосу `aria-expanded` ему нечем.
  assert.match(APP_JS, /fold\.setAttribute\("aria-expanded", collapsed \? "false" : "true"\);/);
  assert.equal(APP_JS.includes('querySelector("[data-section]")'), false, "состояние снова вешают на имя");
});

test("в разметке у каждого раздела две кнопки: галочка и имя", () => {
  const folds = MARKUP.match(/data-section-fold="(\w+)"/g) || [];
  const names = MARKUP.match(/<button class="panel__title" type="button" data-section="(\w+)">/g) || [];
  assert.equal(folds.length, 11, "кнопок-галочек не одиннадцать, а " + folds.length);
  assert.equal(names.length, folds.length, "кнопок с именем раздела столько же быть обязано");
  // Имя и галочка одного раздела говорят об одном разделе.
  for (const fold of folds) {
    const id = fold.slice('data-section-fold="'.length, -1);
    assert.ok(MARKUP.includes('data-section="' + id + '"'), "у раздела " + id + " имя и галочка разошлись");
  }
  // Галочка живёт в своей кнопке, а не внутри имени: вложенных кнопок не бывает.
  assert.match(
    MARKUP,
    /<button class="panel__fold"[^>]*>\n\s*<span class="panel__chevron" aria-hidden="true"><\/span>\n\s*<\/button>/,
  );
  assert.equal(
    /<button class="panel__title"[^>]*aria-expanded/.test(MARKUP),
    false,
    "состояние осталось на имени раздела",
  );
  // Подписи кнопке нужны: внутри один знак, и голос читает её по подписи.
  assert.equal(typeof strings.panels.fold, "string");
  assert.equal(typeof strings.panels.unfold, "string");
  assert.equal(typeof strings.panels.jump, "string");
});

test("стили знают про рейку: заголовок у кромки, накладки над ней", () => {
  // Черта над прилипшим снизу заголовком — тенью, а не рамкой: рамка изменила
  // бы высоту заголовка, а по высоте считается вся рейка.
  const below = APP_CSS.slice(APP_CSS.indexOf(".panel__head.is-below {"));
  assert.ok(below.startsWith(".panel__head.is-below {"), "правила для заголовка у нижней кромки нет");
  const body = below.slice(0, below.indexOf("}"));
  assert.match(body, /box-shadow: 0 -1px 0 var\(--panel-line\);/);
  assert.equal(/border-top/.test(body), false, "рамка вместо тени меняет высоту заголовка");
  // Две кнопки стоят рядом строкой, имя забирает остаток.
  const head = APP_CSS.slice(APP_CSS.indexOf("\n.panel__head {"));
  assert.match(head.slice(0, head.indexOf("}")), /display: flex;/);
  assert.ok(APP_CSS.includes("\n.panel__fold {"), "у галочки нет своего правила");
  // Прилипшие накладки садятся над рейкой, а не под неё.
  assert.match(MARKS_CSS, /bottom: calc\(var\(--panel-rail, 0px\) - 12px\);/);
  assert.match(WORKSHOP_CSS, /bottom: calc\(var\(--panel-rail, 0px\) - 12px\);/);
  // Фильтры списка меток липнут под заголовком своего раздела, а не на нём:
  // прокрутка одна, и оба липких блока целятся в одну кромку.
  assert.match(PANELS_CSS, /\.marks__top \{\n(?:.*\n)*?\s*top: var\(--panel-head, 0px\);/);
});
