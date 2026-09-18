// Подсказка холста: где она стоит и что делает, когда её свернули.
//
// Правка внешняя, и числами её не проверить целиком — вид снимается руками.
// Но два решения здесь чистые, и разойтись они могут молча:
//
// 1. Отступ от края считается по линейке. Линейку прячут отметкой в
//    «Размерах» — отступ обязан уйти вместе с ней, иначе подсказка висит
//    с пустым полем сверху.
// 2. Знак «текст сменился» у свёрнутой подсказки. Подсказка иногда говорит
//    важное («второй Esc возвращает в „Выделение“»), и молча съесть новый
//    текст нельзя; разворачиваться сама она при этом не должна.
import test from "node:test";
import assert from "node:assert/strict";
import { canvasHintInset, canvasHintText, canvasHintUnseen } from "../src/canvas.js";
import { RULER_SIZE } from "../src/render.js";
import { strings } from "../src/strings.js";
import { addScheme, createProject } from "../src/model.js";

const made = addScheme(createProject(), { name: "1 этаж", width: 1000, height: 500 });
const scene = { project: made.project, schemeId: made.scheme.id };

const stateOf = (patch) => ({
  project: scene.project,
  schemeId: scene.schemeId,
  activeTypeId: null,
  activeRoomId: null,
  mode: "select",
  layout: "desktop",
  guidesShown: true,
  ...patch,
});

test("отступ подсказки берётся у линейки, а не из своего числа", () => {
  // Мера одна на холст и на подсказку: разойдись она — подсказка снова
  // наедет на линейку или отъедет от неё на пустое поле.
  assert.equal(canvasHintInset(stateOf({})), RULER_SIZE);
  assert.ok(RULER_SIZE > 0, "линейка нулевой ширины — мера потерялась");
});

test("линейку спрятали — отступа нет", () => {
  assert.equal(canvasHintInset(stateOf({ guidesShown: false })), 0);
});

test("линейка по умолчанию есть: состояние без отметки считается «показана»", () => {
  // Отметка приходит из настроек браузера асинхронно, и до ответа хранилища
  // поля в состоянии может не быть вовсе.
  assert.equal(canvasHintInset(stateOf({ guidesShown: undefined })), RULER_SIZE);
  assert.equal(canvasHintInset(null), RULER_SIZE);
});

test("свёрнутая подсказка помечается, когда текст сменился", () => {
  const before = canvasHintText(stateOf({}));
  const after = canvasHintText(stateOf({ mode: "room", activeRoomId: null }));
  assert.notEqual(before, after, "подсказки режимов совпали — проверять нечего");
  assert.equal(canvasHintUnseen(before, after), true);
});

test("тот же текст знака не даёт, и первый показ тоже", () => {
  const value = canvasHintText(stateOf({}));
  assert.equal(canvasHintUnseen(value, value), false);
  // Ничего ещё не видели (страница открылась свёрнутой) — точка была бы шумом.
  assert.equal(canvasHintUnseen(null, value), false);
  // Подсказки нет вовсе (схема не выбрана) — помечать нечего.
  assert.equal(canvasHintUnseen(value, null), false);
});

test("текст вернулся к прежнему — знак снимается", () => {
  // Пользователь ушёл в обводку и вернулся в выделение: читать там нечего,
  // и точка на кнопке врала бы.
  const select = canvasHintText(stateOf({}));
  const room = canvasHintText(stateOf({ mode: "room" }));
  assert.equal(canvasHintUnseen(select, room), true);
  assert.equal(canvasHintUnseen(select, select), false);
});

test("подписи кнопки сворачивания есть в словаре", () => {
  for (const key of ["hintCollapse", "hintExpand", "hintExpandNew"]) {
    assert.equal(typeof strings.canvas[key], "string", "нет строки canvas." + key);
    assert.ok(strings.canvas[key].length > 0, "пустая строка canvas." + key);
  }
  assert.notEqual(strings.canvas.hintExpand, strings.canvas.hintExpandNew, "новый текст ничем не отличается");
});
