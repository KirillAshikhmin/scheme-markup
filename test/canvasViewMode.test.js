// Режим просмотра на холсте.
//
// Узкий экран — это не урезанный редактор, а просмотр. Раскладка уже прячет
// правящие кнопки, но мышь в суженном окне десктопа никуда не делась: пока
// холст ничего не знал о режиме, клик ставил метку, перетаскивание двигало её,
// а Delete удалял. Поэтому запрет живёт в самом холсте, а не в стилях.
import test from "node:test";
import assert from "node:assert/strict";
import { canvasAddKind, canvasEditAllowed, canvasHintText } from "../src/canvas.js";
import { LAYOUT_ABILITIES } from "../src/app.js";
import { strings } from "../src/strings.js";
import { addScheme, createProject } from "../src/model.js";

const world = () => {
  const made = addScheme(createProject(), { name: "1 этаж", width: 1000, height: 500 });
  const project = made.project;
  const idOf = (code) => project.markTypes.find((item) => item.code === code).id;
  // «Р» — розетка, тип точечный; «Л» — лента, тип линейный.
  return { project, schemeId: made.scheme.id, typeId: idOf("Р"), lineTypeId: idOf("Л") };
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
  // Подсказки выделения и добавления точки заканчиваются жестами копирования
  // (таск 90), поэтому сверяется начало: важно, какая подсказка выбрана.
  assert.ok(
    canvasHintText(stateOf({})).startsWith(strings.canvas.hintSelect),
    "без типа — общая подсказка",
  );
  assert.ok(canvasHintText(stateOf({ activeTypeId: scene.typeId })).startsWith(strings.canvas.hintSelectMode));
  // Режим добавления один, а подсказка разная: её выбирает вид типа.
  assert.equal(canvasHintText(stateOf({ mode: "add", activeTypeId: scene.lineTypeId })), strings.canvas.hintLine);
  assert.ok(
    canvasHintText(stateOf({ mode: "add", activeTypeId: scene.typeId })).includes("Р — "),
    "подсказка постановки без типа",
  );
  // Схемы нет — подсказывать нечего, подписи не будет вовсе.
  assert.equal(canvasHintText(stateOf({ schemeId: null })), null);
});

// Что ставит режим добавления, решает вид типа, а не вторая кнопка в панели.
// Это тот самый шов, на котором сходятся панель инструментов и холст: разойдись
// они — клик ставил бы точку линейным типом.
test("режим добавления берёт вид у выбранного типа", () => {
  assert.equal(canvasAddKind(stateOf({ mode: "add", activeTypeId: scene.typeId })), "point");
  assert.equal(canvasAddKind(stateOf({ mode: "add", activeTypeId: scene.lineTypeId })), "line");
  // Вне режима добавления не ставится ничего — ни точка, ни линия.
  assert.equal(canvasAddKind(stateOf({ mode: "select", activeTypeId: scene.lineTypeId })), null);
  assert.equal(canvasAddKind(stateOf({ mode: "room", activeTypeId: scene.lineTypeId })), null);
  // Тип не выбран — добавлять нечего, и холст не должен считать это точкой.
  assert.equal(canvasAddKind(stateOf({ mode: "add" })), null);
  assert.equal(canvasAddKind(null), null);
});
