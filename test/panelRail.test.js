// Рейка заголовков — лестница у обеих кромок колонки.
//
// Слова заказчика, три таска подряд: «помимо sticky headers сверху, он должен
// быть и снизу. Что бы группы были видны всегда» (T194), «нажал — прыгнуло
// туда — да, так и надо» (T198) и «заголовки должны отображаться все имеющиеся
// на экране свёрнутые, а не только ближайший» (T201).
//
// Обе кромки считает одна чистая функция: на входе места разделов и высоты их
// заголовков, на выходе — на сколько сдвинуть каждый и у какой кромки он
// оказался. В Node нет ни DOM, ни высот, поэтому проверяется здесь именно она,
// а живой вид — снимком. Приклейка к стилям и к разметке (`transform`, меры
// `--panel-rail` и `--panel-head`, две кнопки в заголовке) читается текстом:
// зелёный прогон про стили не говорит ничего.
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

test("ступенька не уезжает за свою кромку и не отрывается от своего места зря", () => {
  for (const scrollTop of [0, 100, 270, 640, 1000, 1080, 1500]) {
    const frame = { scrollTop, clientHeight: 420 };
    const pins = panelRailPins(COLUMN, frame);
    for (let k = 0; k < pins.length; k += 1) {
      const at = drawn(COLUMN, pins, k);
      if (pins[k].side === "top") {
        assert.ok(pins[k].shift > 0, "верхняя ступенька без сдвига — значит она на своём месте");
        assert.ok(at >= scrollTop, "верхняя ступенька уехала выше кадра");
      }
      if (pins[k].side === "bottom") {
        assert.ok(pins[k].shift < 0, "нижняя ступенька без сдвига");
        assert.ok(at + HEAD <= scrollTop + frame.clientHeight, "нижняя ступенька уехала ниже кадра");
      }
      if (pins[k].side === "") assert.equal(pins[k].shift, 0, "стоит на месте, а сдвиг есть");
    }
  }
});

test("видны все разделы колонки — всегда, на любой прокрутке", () => {
  // Это и просил заказчик: «все имеющиеся на экране свёрнутые, а не только
  // ближайший». Кадр высокий, предохранителю работы нет — значит ни один
  // заголовок не имеет права оказаться за кадром.
  const frame = { clientHeight: 600 };
  const limit = 5 * STEP - frame.clientHeight;
  for (let scrollTop = 0; scrollTop <= limit; scrollTop += 17) {
    const pins = panelRailPins(COLUMN, { ...frame, scrollTop });
    for (let k = 0; k < pins.length; k += 1) {
      const at = drawn(COLUMN, pins, k);
      assert.ok(
        at + HEAD > scrollTop && at < scrollTop + frame.clientHeight,
        "заголовок " + k + " не виден при прокрутке " + scrollTop,
      );
    }
  }
});

test("докрутили до конца — внизу пусто, вверху вся лестница", () => {
  const frame = { scrollTop: 5 * STEP - 420, clientHeight: 420 };
  const pins = panelRailPins(COLUMN, frame);
  // Ниже кадра не осталось никого; четыре уехавших раздела стоят ступеньками
  // у верхней кромки, пятый — на своём месте.
  assert.deepEqual(sides(pins), ["top", "top", "top", "top", ""]);
  assert.deepEqual(shifts(pins), [1080, 810, 540, 270, 0]);
  for (let k = 0; k < 4; k += 1) {
    assert.equal(drawn(COLUMN, pins, k), frame.scrollTop + k * HEAD, "ступенька " + k + " не на своей строке");
  }
});

test("низкий кадр: лестницы не съедают больше половины, лишние снимаются с дальних концов", () => {
  const frame = { scrollTop: 0, clientHeight: 200 };
  const pins = panelRailPins(COLUMN, frame);
  const rail = pins.filter((pin) => pin.side !== "").length * HEAD;
  assert.ok(rail <= frame.clientHeight * PANEL_RAIL_SHARE, "лестницы заняли " + rail + " из " + frame.clientHeight);
  // Снизу осталось двое ближних, дальние двое сняты: дальний раздел и так за
  // соседями, а ближний — следующий, к которому человек подойдёт прокруткой.
  assert.deepEqual(sides(pins), ["", "bottom", "bottom", "", ""]);
  assert.deepEqual(shifts(pins), [0, -160, -430, 0, 0]);
  // Нижняя ступенька по-прежнему у самой кромки — лестница не висит в воздухе.
  assert.equal(drawn(COLUMN, pins, 2) + HEAD, frame.scrollTop + frame.clientHeight);
});

test("низкий кадр в середине колонки: уступает та лестница, в которой ступенек больше", () => {
  const frame = { scrollTop: 700, clientHeight: 200 };
  const pins = panelRailPins(COLUMN, frame);
  // Сверху просились трое (0, 1, 2), снизу двое (3, 4) — сняли две верхние.
  assert.deepEqual(sides(pins), ["", "", "top", "bottom", "bottom"]);
  const rail = pins.filter((pin) => pin.side !== "").length * HEAD;
  assert.ok(rail <= frame.clientHeight * PANEL_RAIL_SHARE, "лестницы заняли " + rail);
  // Оставшаяся верхняя ступенька — ближняя: она стоит у самой кромки.
  assert.equal(drawn(COLUMN, pins, 2), frame.scrollTop);
  assert.equal(drawn(COLUMN, pins, 4) + HEAD, frame.scrollTop + frame.clientHeight);
});

test("кадра нет вовсе (спрятанная колонка, нулевая высота) — считать нечего", () => {
  assert.deepEqual(shifts(panelRailPins(COLUMN, { scrollTop: 0, clientHeight: 0 })), [0, 0, 0, 0, 0]);
  assert.deepEqual(panelRailPins([], { scrollTop: 0, clientHeight: 420 }), []);
  assert.deepEqual(shifts(panelRailPins(COLUMN, {})), [0, 0, 0, 0, 0]);
});

test("один раздел на колонку (объём): лестница из одной ступеньки", () => {
  const single = [{ top: 0, box: 2000, head: HEAD }];
  assert.deepEqual(panelRailPins(single, { scrollTop: 0, clientHeight: 200 }), [{ shift: 0, side: "" }]);
  // Уехав вниз по длинному списку, единственный заголовок стоит у верхней
  // кромки — и нажатие на него перематывает к началу раздела, как и в нижней
  // лестнице: сверху и снизу правило одно.
  assert.deepEqual(panelRailPins(single, { scrollTop: 900, clientHeight: 200 }), [{ shift: 900, side: "top" }]);
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

test("свёрнутый раздел — такая же ступенька: видно и его", () => {
  // До таска 201 свёрнутый к верху не липнул вовсе: браузеру было некуда
  // двигать заголовок внутри раздела высотой в этот самый заголовок. Рейка
  // двигает его сама, и заказчик просил видеть все разделы.
  const items = [
    { top: 0, box: HEAD, head: HEAD },
    { top: HEAD, box: 900, head: HEAD },
  ];
  const pins = panelRailPins(items, { scrollTop: 200, clientHeight: 420 });
  assert.deepEqual(sides(pins), ["top", "top"]);
  assert.equal(drawn(items, pins, 0), 200, "свёрнутый не встал первой ступенькой");
  assert.equal(drawn(items, pins, 1), 200 + HEAD, "второй не встал под ним");
});

test("перелистывание целится под лестницу, и лестницу считает рейка", () => {
  // С таска 201 ответ перестал быть нулём: выше позванного раздела встанут все
  // разделы до него, и накладка — сумма их заголовков.
  const frame = { scrollTop: 0, clientHeight: 420 };
  for (let k = 0; k < COLUMN.length; k += 1) {
    assert.equal(panelRailTopInset(COLUMN, k, frame), k * HEAD, "накладка перед разделом " + k);
  }
  // Предохранитель виден и здесь: на низком кадре лестница короче, и целиться
  // под ступеньки, которых не будет, — значит промахнуться.
  const low = { scrollTop: 0, clientHeight: 120 };
  assert.equal(panelRailTopInset(COLUMN, 4, low), 60);
  assert.ok(panelRailTopInset(COLUMN, 4, low) <= low.clientHeight * PANEL_RAIL_SHARE);
  // Без кадра — просто сумма: предохранителю не из чего считать долю.
  assert.equal(panelRailTopInset(COLUMN, 3), 90);
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
  assert.match(RAIL_JS, /column\.scrollTop = shown\[index\]\.top - panelRailTopInset\(shown, index, frame\);/);
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
  const headBody = head.slice(0, head.indexOf("}"));
  assert.match(headBody, /display: flex;/);
  // Верх считает рейка, а не браузер: двое на одну кромку спорили бы на каждом
  // кадре (таск 201).
  assert.equal(/position: sticky/.test(headBody), false, "липкость вернулась к заголовку — верх считают двое");
  assert.match(APP_CSS, /\.panel__head\.is-above \{\n\s*box-shadow: 0 1px 0 var\(--panel-line\);/);
  assert.match(APP_CSS, /\.panel__head\.is-below \{\n\s*box-shadow: 0 -1px 0 var\(--panel-line\);/);
  assert.ok(APP_CSS.includes("\n.panel__fold {"), "у галочки нет своего правила");
  // Прилипшие накладки садятся над рейкой, а не под неё.
  assert.match(MARKS_CSS, /bottom: calc\(var\(--panel-rail, 0px\) - 12px\);/);
  assert.match(WORKSHOP_CSS, /bottom: calc\(var\(--panel-rail, 0px\) - 12px\);/);
  // Фильтры списка меток липнут под заголовком своего раздела, а не на нём:
  // прокрутка одна, и оба липких блока целятся в одну кромку.
  assert.match(PANELS_CSS, /\.marks__top \{\n(?:.*\n)*?\s*top: var\(--panel-head, 0px\);/);
});
