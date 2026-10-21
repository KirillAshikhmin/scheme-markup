// Три клика в тишину (таск 217, дефект D66).
//
// Жалоба звучала как «метка перестала ставиться на схему со стенами»:
// на пустой схеме метка вставала, на той же со стенами и обведённым
// помещением — три клика подряд и «Меток 0». Живой прогон показал, что
// постановка цела: не ставил её не план и не контур, а **занятие**. Переход
// между полями «Чертёж · Схема · Объём» сбрасывает его на «Выделение» (правило
// заказчика G296, таск 193), выбранный тип при этом остаётся — и человек,
// вернувшийся из чертежа, целится в план с живым типом в плашке, а клик уходит
// в пустоту.
//
// Говорить об этом обязаны двое, и оба проверяются здесь:
//
//   — строка под кнопками «Выделение · Добавление» (`toolsModeNote`). До этого
//     таска она при любом занятии обещала «клик по плану ставит точку» — то
//     есть ровно то, чего в «Выделении» не происходит;
//   — сам пустой клик (`canvasSilentPlaceNote`): он называет занятие и кнопку,
//     которой его меняют.
//
// Обе функции чистые, и обе проверяются без браузера. То, что обработчик
// указателя их действительно спрашивает, видно только сканированием исходника:
// DOM-обработчики здесь не поднимаются, а именно ветка обработчика и была
// местом молчания.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { canvasSilentPlaceNote } from "../src/canvas.js";
import { toolsKindNote, toolsModeNote } from "../src/panels/tools.js";
import { MARK_KIND_COMMENT } from "../src/model.js";
import { strings } from "../src/strings.js";

const CANVAS_SRC = readFileSync(new URL("../src/canvas.js", import.meta.url), "utf8");
const TOOLS_SRC = readFileSync(new URL("../src/panels/tools.js", import.meta.url), "utf8");

const project = {
  markTypes: [{ id: "type-1", code: "Р", name: "Розетка", categoryId: "cat-1", kind: "point" }],
  categories: [{ id: "cat-1", name: "Силовые", color: "#ff0000" }],
  marks: [],
};

const stateOf = (patch = {}) => ({
  project,
  schemeId: "scheme-1",
  layout: "desktop",
  screen: "scheme",
  mode: "select",
  activeTypeId: "type-1",
  selectedMarkIds: [],
  selectedOutlineId: null,
  editPathId: null,
  ...patch,
});

// Клик мышью по пустому месту: именно он уходил в тишину.
const emptyClick = (patch = {}) => ({ kind: "empty", moved: false, ...patch });

test("строка под кнопками в «Выделении» не обещает постановку, а называет дверь", () => {
  const note = toolsModeNote({ mode: "select", kind: "point", label: "Р — Розетка" });
  assert.notEqual(note, strings.tools.kindPointHint);
  assert.match(note, /Выделение/);
  assert.match(note, /Добавление/);
  assert.match(note, /Р — Розетка/);
});

test("в «Добавлении» строка осталась прежней — про то, что поставит клик", () => {
  assert.equal(toolsModeNote({ mode: "add", kind: "point", label: "Р — Розетка" }), strings.tools.kindPointHint);
  assert.equal(toolsModeNote({ mode: "add", kind: "line", label: "Л — Лента" }), strings.tools.kindLineHint);
  assert.equal(
    toolsModeNote({ mode: "add", kind: MARK_KIND_COMMENT, label: "Комментарий" }),
    strings.tools.kindCommentHint,
  );
});

test("без типа правду говорит прежняя строка — про выбор типа, а не про режим", () => {
  assert.equal(toolsModeNote({ mode: "select", kind: null, label: "" }), strings.canvas.needType);
  assert.equal(toolsKindNote(null), strings.canvas.needType);
});

test("у занятий без своей кнопки строка прежняя: они говорят о себе сами", () => {
  assert.equal(toolsModeNote({ mode: "room", kind: "point", label: "Р — Розетка" }), strings.tools.modeNow_room);
  assert.equal(toolsModeNote({ mode: "scale", kind: "point", label: "Р — Розетка" }), strings.tools.modeNow_scale);
});

test("пустой клик в «Выделении» с выбранным типом объясняется словом", () => {
  const note = canvasSilentPlaceNote(stateOf(), emptyClick(), null);
  assert.ok(note, "клик, который ничего не сделал, молчать не должен");
  assert.match(note, /Добавление/);
  assert.match(note, /Р — Розетка/);
});

test("тап пальцем по пустому месту молчит ровно так же мало, как клик мышью", () => {
  const touch = { kind: "pan", touch: true, tap: { markId: null }, moved: false };
  assert.ok(canvasSilentPlaceNote(stateOf(), touch, null));
  // Тап по метке — дело сделано, и слов не просит.
  const onMark = { kind: "pan", touch: true, tap: { markId: "mark-1" }, moved: false };
  assert.equal(canvasSilentPlaceNote(stateOf(), onMark, null), null);
});

test("клик, который что-то сделал, слов не просит", () => {
  // Снял выделение, выбрал стену — патч есть, и сказать уже сказано делом.
  assert.equal(canvasSilentPlaceNote(stateOf(), emptyClick(), { selectedMarkIds: [] }), null);
  // Жест был переносом, а не кликом.
  assert.equal(canvasSilentPlaceNote(stateOf(), emptyClick({ moved: true }), null), null);
  // Клик пришёлся по метке, по ручке, по направляющей — чужой жест не наш.
  assert.equal(canvasSilentPlaceNote(stateOf(), { kind: "mark", moved: false }, null), null);
  assert.equal(canvasSilentPlaceNote(stateOf(), { kind: "guideNew", moved: false }, null), null);
});

test("в «Добавлении» и без типа этих слов нет: там клик ставит или уже всё сказано", () => {
  assert.equal(canvasSilentPlaceNote(stateOf({ mode: "add" }), emptyClick(), null), null);
  assert.equal(canvasSilentPlaceNote(stateOf({ activeTypeId: null }), emptyClick(), null), null);
  // Тип, которого в справочнике больше нет, — не повод обещать его постановку.
  assert.equal(canvasSilentPlaceNote(stateOf({ activeTypeId: "type-gone" }), emptyClick(), null), null);
});

test("в просмотре и в чужом поле слов нет: там меток не ставят вовсе", () => {
  assert.equal(canvasSilentPlaceNote(stateOf({ layout: "mobile" }), emptyClick(), null), null);
  assert.equal(canvasSilentPlaceNote(stateOf({ screen: "drawing" }), emptyClick(), null), null);
  assert.equal(canvasSilentPlaceNote(stateOf({ screen: "volume" }), emptyClick(), null), null);
});

test("обработчик указателя и правда спрашивает про тишину — обе руки, одна дверь", () => {
  // Мышь: сразу за разбором тапа, пока ветка не ушла к пальцу.
  const mouse = CANVAS_SRC.indexOf("const tap = canvasTapAction(state, drag, { cancelled:");
  const saidMouse = CANVAS_SRC.indexOf("canvasSaySilent(state, drag, tap);");
  assert.ok(mouse > 0 && saidMouse > mouse, "у мыши слова стоят сразу за разбором тапа");
  // Палец: в своей ветке тапа, и тоже через общую дверь.
  assert.match(CANVAS_SRC, /else canvasSaySilent\(state, drag, patch\);/);
  // Память «уже сказали» снимается сменой занятия, иначе второй вход в
  // «Выделение» промолчал бы.
  assert.match(CANVAS_SRC, /canvasSilentSaid = false;/);
});

test("строка под кнопками собирается одной дверью: второй ветки с обещанием нет", () => {
  const promises = TOOLS_SRC.match(/strings\.tools\.kindPointHint/g) || [];
  assert.equal(promises.length, 1, "обещание «клик ставит точку» живёт только в toolsKindNote");
  assert.match(TOOLS_SRC, /const modeNote = toolsModeNote\(/);
});
