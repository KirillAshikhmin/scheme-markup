// Рейка заголовков: что ниже кадра — то у нижней кромки колонки (таск 194,
// G295). Слова заказчика: «помимо sticky headers сверху, он должен быть и
// снизу. Что бы группы были видны всегда».
//
// Верх умеет сам браузер, а низ — счёт, и счёт этот чистый: на входе места
// разделов в содержимом и высоты их заголовков, на выходе — на сколько поднять
// каждый. В Node нет ни DOM, ни высот, поэтому проверяется здесь именно он, а
// живой вид — снимком. Приклейка к стилям (`transform`, меры `--panel-rail` и
// `--panel-head`) читается текстом: зелёный прогон про стили не говорит ничего.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { PANEL_RAIL_SHARE, panelRailPins } from "../src/panels/rail.js";

const APP_CSS = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
const PANELS_CSS = readFileSync(new URL("../src/panels/panels.css", import.meta.url), "utf8");
const MARKS_CSS = readFileSync(new URL("../src/panels/marks.css", import.meta.url), "utf8");
const WORKSHOP_CSS = readFileSync(new URL("../src/panels/workshop.css", import.meta.url), "utf8");
const RAIL_JS = readFileSync(new URL("../src/panels/rail.js", import.meta.url), "utf8");
const APP_JS = readFileSync(new URL("../src/app.js", import.meta.url), "utf8");

// Колонка как на экране: пять разделов по 300 точек, заголовок у каждого 30.
const HEAD = 30;
const STEP = 300;
const COLUMN = Array.from({ length: 5 }, (unused, k) => ({ top: k * STEP, height: HEAD }));

// Где заголовок нарисован: своё место плюс сдвиг.
const drawn = (items, shifts, k) => items[k].top + shifts[k];

test("всё влезло в кадр — никто не прилип", () => {
  const frame = { scrollTop: 0, clientHeight: 5 * STEP };
  assert.deepEqual(panelRailPins(COLUMN, frame), [0, 0, 0, 0, 0]);
});

test("кадр показывает полтора раздела: хвост стоит рейкой у нижней кромки", () => {
  const frame = { scrollTop: 0, clientHeight: 420 };
  const shifts = panelRailPins(COLUMN, frame);
  // Первые два стоят сами: один виден целиком, у второго виден заголовок.
  assert.deepEqual(shifts.slice(0, 2), [0, 0]);
  // Остальные трое — у кромки, по порядку, без щелей и без наложений.
  const edge = frame.scrollTop + frame.clientHeight;
  assert.equal(drawn(COLUMN, shifts, 4) + HEAD, edge, "последний раздел не у самой кромки");
  assert.equal(drawn(COLUMN, shifts, 3) + HEAD, drawn(COLUMN, shifts, 4), "между заголовками рейки щель");
  assert.equal(drawn(COLUMN, shifts, 2) + HEAD, drawn(COLUMN, shifts, 3), "между заголовками рейки щель");
  // Порядок в рейке — порядок разделов: что ниже в колонке, то ниже и в рейке.
  assert.deepEqual(shifts, [0, 0, -270, -540, -810]);
  // Рейка начинается там, где кончается заголовок ближнего раздела, стоящий
  // сам: по колонке читается «вот этот, а вот эти трое ниже».
  assert.equal(drawn(COLUMN, shifts, 1) + HEAD, drawn(COLUMN, shifts, 2));
});

test("заголовок снимается с рейки непрерывно — без прыжка на пороге", () => {
  const frame = (scrollTop) => ({ scrollTop, clientHeight: 420 });
  // Порог третьего раздела: кромка минус два заголовка под ним минус свой.
  assert.equal(panelRailPins(COLUMN, frame(269))[2], -1);
  assert.equal(panelRailPins(COLUMN, frame(270))[2], 0);
  assert.equal(panelRailPins(COLUMN, frame(271))[2], 0);
  // Снявшись с рейки, он не тянет за собой соседей: те, кто ниже, стоят где
  // стояли — рейка уменьшилась ровно на один заголовок.
  assert.deepEqual(panelRailPins(COLUMN, frame(270)).slice(3), [-270, -540]);
  const after = panelRailPins(COLUMN, frame(270));
  assert.equal(drawn(COLUMN, after, 4) + HEAD, 270 + 420, "нижний в рейке съехал с кромки");
  assert.equal(drawn(COLUMN, after, 3) + HEAD, drawn(COLUMN, after, 4), "в рейке появилась щель");
});

test("вниз заголовок не двигается никогда", () => {
  for (const scrollTop of [0, 100, 270, 640, 1000, 1500]) {
    for (const shift of panelRailPins(COLUMN, { scrollTop, clientHeight: 420 })) {
      assert.ok(shift <= 0, "заголовок уехал вниз по своему же содержимому: " + shift);
    }
  }
});

test("докрутили до конца — рейка пуста: ниже кадра не осталось никого", () => {
  const frame = { scrollTop: 5 * STEP - 420, clientHeight: 420 };
  assert.deepEqual(panelRailPins(COLUMN, frame), [0, 0, 0, 0, 0]);
});

test("низкий кадр: рейка не съедает больше половины, лишние снимаются с дальнего конца", () => {
  const frame = { scrollTop: 0, clientHeight: 200 };
  const shifts = panelRailPins(COLUMN, frame);
  const rail = shifts.filter((shift) => shift !== 0).length * HEAD;
  assert.ok(rail <= frame.clientHeight * PANEL_RAIL_SHARE, "рейка заняла " + rail + " из " + frame.clientHeight);
  // Остались ближние: дальний раздел и так за двумя другими, а ближний —
  // следующий, к которому человек подойдёт прокруткой.
  assert.deepEqual(shifts, [0, -190, -460, -730, 0]);
  // Нижний в рейке по-прежнему у самой кромки — рейка не висит в воздухе.
  assert.equal(drawn(COLUMN, shifts, 3) + HEAD, frame.scrollTop + frame.clientHeight);
});

test("кадра нет вовсе (спрятанная колонка, нулевая высота) — считать нечего", () => {
  assert.deepEqual(panelRailPins(COLUMN, { scrollTop: 0, clientHeight: 0 }), [0, 0, 0, 0, 0]);
  assert.deepEqual(panelRailPins([], { scrollTop: 0, clientHeight: 420 }), []);
  assert.deepEqual(panelRailPins(COLUMN, {}), [0, 0, 0, 0, 0]);
});

test("один раздел на колонку (объём): прилипать некуда и незачем", () => {
  const single = [{ top: 0, height: HEAD }];
  assert.deepEqual(panelRailPins(single, { scrollTop: 0, clientHeight: 200 }), [0]);
  // Даже уехав вниз по длинному списку, единственный заголовок остаётся липким
  // сверху — это делает браузер, и рейке он не достаётся.
  assert.deepEqual(panelRailPins(single, { scrollTop: 900, clientHeight: 200 }), [0]);
});

test("свёрнутые разделы в рейке участвуют: группа видна и свёрнутой", () => {
  // Свёрнутый раздел — это только заголовок: места в колонке 30 точек.
  const items = [
    { top: 0, height: HEAD },
    { top: 600, height: HEAD },
    { top: 630, height: HEAD },
    { top: 660, height: HEAD },
  ];
  const shifts = panelRailPins(items, { scrollTop: 0, clientHeight: 420 });
  assert.deepEqual(shifts, [0, -270, -270, -270]);
  assert.equal(drawn(items, shifts, 3) + HEAD, 420);
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
  assert.match(RAIL_JS, /if \(head\.style\.transform !== css\)/);
  assert.match(RAIL_JS, /if \(node\.style\.getPropertyValue\(name\) !== css\)/);
  // Рейку завязывает каркас — после панелей, иначе высот у разделов ещё нет.
  assert.match(APP_JS, /for \(const id of appPanels\.keys\(\)\) mountPanel\(id\);\n\s*\/\/[^\n]*\n\s*\/\/[^\n]*\n\s*wirePanelRail\(\);/);
  // И трогает её там, где сам меняет высоты: свёрнутость и режим экрана.
  assert.equal((APP_JS.match(/syncPanelRail\(\);/g) || []).length, 2);
});

test("стили знают про рейку: заголовок у кромки, накладки над ней", () => {
  // Черта над прилипшим снизу заголовком — тенью, а не рамкой: рамка изменила
  // бы высоту заголовка, а по высоте считается вся рейка.
  const below = APP_CSS.slice(APP_CSS.indexOf(".panel__head.is-below {"));
  assert.ok(below.startsWith(".panel__head.is-below {"), "правила для заголовка у нижней кромки нет");
  const body = below.slice(0, below.indexOf("}"));
  assert.match(body, /box-shadow: 0 -1px 0 var\(--panel-line\);/);
  assert.equal(/border-top/.test(body), false, "рамка вместо тени меняет высоту заголовка");
  // Прилипшие накладки садятся над рейкой, а не под неё.
  assert.match(MARKS_CSS, /bottom: calc\(var\(--panel-rail, 0px\) - 12px\);/);
  assert.match(WORKSHOP_CSS, /bottom: calc\(var\(--panel-rail, 0px\) - 12px\);/);
  // Фильтры списка меток липнут под заголовком своего раздела, а не на нём:
  // прокрутка одна, и оба липких блока целятся в одну кромку.
  assert.match(PANELS_CSS, /\.marks__top \{\n(?:.*\n)*?\s*top: var\(--panel-head, 0px\);/);
});
