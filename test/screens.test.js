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
  layoutAllows,
  PANEL_IDS,
  SCREEN_ABILITIES,
  SCREEN_DEFAULT,
  SCREEN_MODES,
  screenAfterLayout,
  screenAllowed,
  screensFor,
  SECTION_IDS,
  sectionListFrom,
  viewMemoryFrom,
} from "../src/app.js";
import { canvasHintInset, canvasHintText, canvasOnScreen, canvasSummaryLines } from "../src/canvas.js";
import { plateUnseen } from "../src/panels/plate.js";
import { workshopPlacement, workshopStatus, workshopSummaryLines } from "../src/panels/workshop.js";
import { RULER_SIZE } from "../src/render.js";
import { addScheme, createProject } from "../src/model.js";
import { strings } from "../src/strings.js";

test("режимов четыре, порядок — порядок переключателя, умолчание — схема", () => {
  assert.deepEqual(SCREEN_MODES, ["drawing", "scheme", "volume", "scenarios"]);
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

test("на узком экране чертежа нет, а схема, объём и сценарии остаются", () => {
  assert.deepEqual(screensFor("desktop"), ["drawing", "scheme", "volume", "scenarios"]);
  assert.deepEqual(screensFor("mobile"), ["scheme", "volume", "scenarios"]);
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
  // Четвёртое слово — «Сценарии» (G05): «давай конструктор четвёртым режимом».
  assert.equal(strings.screens.scenarios, "Сценарии");
});

test("«Сценарии»: смотреть можно везде, править — только на компьютере и планшете (история 4.29)", () => {
  assert.equal(SCREEN_ABILITIES.scenarios, "viewScenarios");
  assert.deepEqual(LAYOUT_ABILITIES.viewScenarios, ["desktop", "mobile"]);
  assert.equal(layoutAllows("viewScenarios", "mobile"), true);
  assert.equal(layoutAllows("editScenarios", "desktop"), true);
  assert.equal(layoutAllows("editScenarios", "mobile"), false);
  assert.equal(screenAllowed("scenarios", "mobile"), true);
  // Окно сузили — человек остаётся в «Сценариях»: на телефоне они только смотрят.
  assert.equal(screenAfterLayout("scenarios", "mobile"), "scenarios");
  assert.equal(PANEL_IDS.screenScenarios, "screen-scenarios");
});

test("память вида помнит режим «Сценарии»", () => {
  // Память — по объектам: `{идентификатор объекта: {screen, schemeId, place}}`.
  assert.equal(viewMemoryFrom({ p1: { screen: "scenarios" } }).p1.screen, "scenarios");
  assert.equal(viewMemoryFrom({ p1: { screen: "чужой" } }).p1, undefined);
});

test("раздел «Интерфейс» переименован дважды, а ключ остался прежним", () => {
  // Ключ держит свёрнутость: переименуй его — раздел развернулся бы у всех,
  // кто его однажды свернул. Подпись же сменилась дважды по слову заказчика:
  // «Размеры» → «Интерфейс проекта» (таск 153) → «Интерфейс» (таск 187, G281).
  assert.equal(SECTION_IDS.sizes, "sizes");
  assert.equal(strings.panels.sizes, "Интерфейс");
});

test("в правой колонке чертежа три раздела, и прежний один из настроек отброшен", () => {
  // Три списка вместо группы «Элементы чертежа» (таск 187, G280).
  assert.deepEqual(
    [SECTION_IDS.drawWalls, SECTION_IDS.drawOpenings, SECTION_IDS.drawObjects],
    ["drawWalls", "drawOpenings", "drawObjects"],
  );
  assert.equal(Object.values(SECTION_IDS).includes("drawList"), false);
  // Сохранённая свёрнутость прежнего раздела — мусор для нынешней сборки, и
  // она отбрасывается сама: колонка от неё не схлопывается.
  assert.deepEqual(sectionListFrom(["drawList", SECTION_IDS.drawWalls]), [SECTION_IDS.drawWalls]);
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
  // Отступ под линейку остаётся на **обоих плоских полях** (таск 193, G293):
  // линейку рисуют и план, и чертёж, отметка у них одна, и ряд кнопок над полем
  // обязан стоять на одной высоте в обоих режимах. В объёме линейки нет вовсе —
  // там переключатель с полным экраном висел бы на пустом поле.
  assert.equal(canvasHintInset(stateOf({})), RULER_SIZE);
  assert.equal(canvasHintInset(stateOf({ screen: "volume" })), 0);
  assert.equal(canvasHintInset(stateOf({ screen: "drawing" })), RULER_SIZE);
  // Спрятали линейку — отступ уходит из обоих.
  assert.equal(canvasHintInset(stateOf({ screen: "drawing", guidesShown: false })), 0);
  assert.equal(canvasHintInset(stateOf({ screen: "scheme", guidesShown: false })), 0);
});

// ——— две плашки над полем: подсказка слева, сводка справа (G228) ————————
//
// Заказчик: «Сделай подсказки все слева, чтобы скрывались, а информацию, так же
// чтобы скрывалась, справа, левее кнопки полноэкранности, с иконкой i (info). И
// там как раз размеры, количество и т.д.»
//
// Проверяется чистая половина: что в сводке лежит и что она не расходится со
// строкой состояния, из которой собрана.

test("сводка плана отвечает на «сколько чего» и считает видимые метки", () => {
  const scheme = made.scheme;
  const lines = canvasSummaryLines(stateOf({}));
  assert.ok(lines.length >= 3, "сводка из одной строки ничего не говорит");
  assert.ok(
    lines.some((line) => line.includes(String(scheme.width))),
    "размер подложки в сводке не назван: " + lines.join(" | "),
  );
  assert.ok(lines.some((line) => /Меток/.test(line)));
  assert.ok(lines.some((line) => /Помещений/.test(line)));
  // Без схемы сводке говорить нечего — и она молчит, а не показывает нули.
  assert.deepEqual(canvasSummaryLines(stateOf({ schemeId: null })), []);
  assert.deepEqual(canvasSummaryLines(null), []);
});

test("сводка чертежа — те же слова, что строка состояния, только порознь", () => {
  const spot = workshopPlacement(made.project, made.scheme.id);
  const lines = workshopSummaryLines(made.project, made.scheme.id, spot);
  assert.ok(lines.length >= 2);
  // Разошлись бы они — человек читал бы в сводке одно, а в отчёте другое.
  assert.equal(workshopStatus(made.project, made.scheme.id, spot), lines.join(" · "));
  for (const line of lines) assert.ok(line.trim().length > 0, "пустая строка сводки");
});

test("свёрнутая плашка помечается, когда текст сменился, и молчит, когда не видел ничего", () => {
  assert.equal(plateUnseen("было", "стало"), true);
  assert.equal(plateUnseen("было", "было"), false);
  assert.equal(plateUnseen(null, "стало"), false, "не видел ничего — и знака нет");
  assert.equal(plateUnseen("было", null), false);
});
