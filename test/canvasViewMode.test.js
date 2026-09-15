// Режим просмотра на холсте.
//
// Узкий экран — это не урезанный редактор, а просмотр. Раскладка уже прячет
// правящие кнопки, но мышь в суженном окне десктопа никуда не делась: пока
// холст ничего не знал о режиме, клик ставил метку, перетаскивание двигало её,
// а Delete удалял. Поэтому запрет живёт в самом холсте, а не в стилях.
import test from "node:test";
import assert from "node:assert/strict";
import { canvasEditAllowed, canvasHintText } from "../src/canvas.js";
import { LAYOUT_ABILITIES } from "../src/app.js";
import { strings } from "../src/strings.js";
import { addScheme, createProject } from "../src/model.js";

const world = () => {
  const made = addScheme(createProject(), { name: "1 этаж", width: 1000, height: 500 });
  const project = made.project;
  return { project, schemeId: made.scheme.id, typeId: project.markTypes.find((item) => item.code === "Р").id };
};

// Один объект на все проверки: `defaultTemplate()` выдаёт свежие идентификаторы
// на каждый вызов, и тип из другого объекта здесь не нашёлся бы.
const scene = world();

const stateOf = (patch) => {
  return {
    project: scene.project,
    schemeId: scene.schemeId,
    activeTypeId: null,
    activeRoomId: null,
    mode: "select",
    layout: "desktop",
    ...patch,
  };
};

test("правка на холсте идёт по общей таблице умений, своего списка у холста нет", () => {
  // Таблица — в app.js, и умение там названо `editMarks`: если оно переедет
  // или переименуется, холст обязан разойтись с панелями, а не промолчать.
  assert.ok(Array.isArray(LAYOUT_ABILITIES.editMarks), "умение editMarks пропало из таблицы");
  assert.equal(canvasEditAllowed(stateOf({ layout: "desktop" })), true);
  assert.equal(canvasEditAllowed(stateOf({ layout: "mobile" })), false);
});

test("неизвестная раскладка правку не открывает", () => {
  // Опечатка в поле или состояние без него — это не повод пустить правку:
  // запрет по умолчанию, как и в таблице умений.
  assert.equal(canvasEditAllowed(stateOf({ layout: "телефон" })), false);
  assert.equal(canvasEditAllowed(stateOf({ layout: undefined })), false);
  assert.equal(canvasEditAllowed(null), false);
});

test("в режиме просмотра подсказка не обещает того, чего там нет", () => {
  const view = canvasHintText(stateOf({ layout: "mobile", activeTypeId: scene.typeId }));
  assert.equal(view, strings.mobile.viewOnly, "подсказка просмотра взята не из словаря");

  // Ни одна подсказка правки в просмотр не попадает — ни про постановку меток,
  // ни про рисование линий и контуров.
  for (const key of ["hintPoint", "hintLine", "hintRoom", "hintSelectMode", "hintSelect"]) {
    assert.notEqual(view, strings.canvas[key], "в просмотре показана подсказка правки: " + key);
  }
  assert.ok(!/клик/i.test(view), "подсказка просмотра зовёт кликать по плану: " + view);
});

test("на десктопе подсказка прежняя — по режиму и выбранному типу", () => {
  assert.equal(canvasHintText(stateOf({})), strings.canvas.hintSelect, "без типа — общая подсказка");
  assert.equal(canvasHintText(stateOf({ activeTypeId: scene.typeId })), strings.canvas.hintSelectMode);
  assert.equal(canvasHintText(stateOf({ mode: "line", activeTypeId: scene.typeId })), strings.canvas.hintLine);
  assert.ok(canvasHintText(stateOf({ mode: "point", activeTypeId: scene.typeId })).includes("Р — "), "подсказка постановки без типа");
  // Схемы нет — подсказывать нечего, подписи не будет вовсе.
  assert.equal(canvasHintText(stateOf({ schemeId: null })), null);
});
