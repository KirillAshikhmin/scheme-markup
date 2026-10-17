// Три режима основного экрана: Чертёж · Схема · Объём (таск 153, G219).
//
// Проверяется чистая половина переезда — та, которая может разойтись молча:
// какие режимы показывает переключатель на каком экране, куда возвращается
// человек, когда окно сузили под его режимом, и что режим нигде не
// запоминается (G68).
import test from "node:test";
import assert from "node:assert/strict";

import {
  LAYOUT_ABILITIES,
  SCREEN_ABILITIES,
  SCREEN_DEFAULT,
  SCREEN_MODES,
  screenAfterLayout,
  screenAllowed,
  screensFor,
  SECTION_IDS,
  sectionListFrom,
} from "../src/app.js";
import { canvasHintInset, canvasHintText, canvasOnScreen } from "../src/canvas.js";
import { RULER_SIZE } from "../src/render.js";
import { addScheme, createProject } from "../src/model.js";
import { strings } from "../src/strings.js";

test("режимов три, порядок — порядок переключателя, умолчание — схема", () => {
  assert.deepEqual(SCREEN_MODES, ["drawing", "scheme", "volume"]);
  assert.equal(SCREEN_DEFAULT, "scheme");
  // Схема посередине: из неё одинаково близко в обе стороны.
  assert.equal(SCREEN_MODES[1], SCREEN_DEFAULT);
});

test("у каждого режима есть своё умение раскладки, и все они объявлены", () => {
  for (const screen of SCREEN_MODES) {
    const ability = SCREEN_ABILITIES[screen];
    assert.ok(ability, "режим " + screen + " без умения — он не откроется никогда");
    assert.ok(
      Array.isArray(LAYOUT_ABILITIES[ability]),
      "умение " + ability + " не перечислено в LAYOUT_ABILITIES",
    );
  }
});

test("на узком экране чертежа нет, а схема и объём остаются", () => {
  assert.deepEqual(screensFor("desktop"), ["drawing", "scheme", "volume"]);
  assert.deepEqual(screensFor("mobile"), ["scheme", "volume"]);
  assert.equal(screenAllowed("drawing", "mobile"), false);
  assert.equal(screenAllowed("volume", "mobile"), true);
  // Неизвестный режим недоступен нигде: опечатка не должна открыть пустой экран.
  assert.equal(screenAllowed("чертёжик", "desktop"), false);
  assert.equal(screenAllowed(undefined, "desktop"), false);
});

test("окно сузили под чертежом — человек возвращается на схему", () => {
  assert.equal(screenAfterLayout("drawing", "mobile"), SCREEN_DEFAULT);
  // А объём на планшете остаётся: он только смотрит.
  assert.equal(screenAfterLayout("volume", "mobile"), "volume");
  assert.equal(screenAfterLayout("drawing", "desktop"), "drawing");
  assert.equal(screenAfterLayout("чужое", "desktop"), SCREEN_DEFAULT);
});

test("режим в настройках разделов не живёт: это сеанс вкладки, а не память (G68)", () => {
  // Разделы колонок помнятся между сеансами, режимы — нет. Проверка от
  // обратного: имена режимов не должны быть похожи на разделы и не должны
  // проходить фильтр сохранённого списка.
  assert.deepEqual(sectionListFrom([...SCREEN_MODES]), []);
  assert.ok(!Object.values(SECTION_IDS).includes("volume"));
});

test("у переключателя есть слово для каждого режима и подсказка к нему", () => {
  for (const screen of SCREEN_MODES) {
    assert.equal(typeof strings.screens[screen], "string");
    assert.ok(strings.screens[screen].length > 0);
    assert.ok(strings.screens[screen + "Hint"].length > 0);
  }
  // Слова заказчика, а не свои.
  assert.equal(strings.screens.drawing, "Чертёж");
  assert.equal(strings.screens.scheme, "Схема");
  assert.equal(strings.screens.volume, "Объём");
});

test("раздел «Интерфейс проекта» переименован, а ключ остался прежним", () => {
  // Ключ держит свёрнутость: переименуй его — раздел развернулся бы у всех,
  // кто его однажды свернул.
  assert.equal(SECTION_IDS.sizes, "sizes");
  assert.equal(strings.panels.sizes, "Интерфейс проекта");
});

const made = addScheme(createProject(), { name: "1 этаж", width: 1000, height: 500 });
const stateOf = (patch) => ({
  project: made.project,
  schemeId: made.scheme.id,
  layout: "desktop",
  mode: "select",
  selectedMarkIds: [],
  ...patch,
});

test("план уступает экран: подсказка и линейка уходят вместе с ним", () => {
  assert.equal(canvasOnScreen(stateOf({})), true, "состояние без поля — это схема");
  assert.equal(canvasOnScreen(stateOf({ screen: "scheme" })), true);
  assert.equal(canvasOnScreen(stateOf({ screen: "volume" })), false);
  assert.ok(canvasHintText(stateOf({ screen: "scheme" })));
  assert.equal(canvasHintText(stateOf({ screen: "drawing" })), null);
  assert.equal(canvasHintText(stateOf({ screen: "volume" })), null);
  // Отступ под линейку в чужом режиме не оставляется: линейки там нет, и
  // переключатель с полным экраном висели бы на пустом поле.
  assert.equal(canvasHintInset(stateOf({})), RULER_SIZE);
  assert.equal(canvasHintInset(stateOf({ screen: "volume" })), 0);
  assert.equal(canvasHintInset(stateOf({ screen: "drawing" })), 0);
});
