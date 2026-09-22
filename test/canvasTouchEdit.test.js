// Правка пальцем (D20, G155).
//
// Слова заказчика: «на планшете даже при переключении в режим редактирования
// (полный режим) не редактируется ничего и не добавляется на схеме». Правка
// холста была написана под мышь целиком: палец умел только возить план и
// выделять метку (таск 106), а постановка, перенос, рисование и ручки стояли
// ниже выхода `if (event.pointerType === "touch") return;`.
//
// Жестов у пальца теперь три, и правила у них чистые — их и проверяем:
// тап (`canvasTapKind`), долгое нажатие (`canvasGrabKind`) и двойной тап
// (`canvasDoubleTap`). Сам обработчик DOM здесь не поднимается: он проверен
// живым прогоном, а правила — отсюда.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  canvasDoubleTap,
  canvasDragSlop,
  canvasGrabKind,
  canvasHitSlack,
  canvasPressProgress,
  canvasTapAction,
  canvasTapKind,
} from "../src/canvas.js";
import { addScheme, createProject } from "../src/model.js";

const CANVAS_SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "canvas.js");

const world = () => {
  const made = addScheme(createProject(), { name: "1 этаж", width: 1000, height: 500 });
  const project = made.project;
  const idOf = (code) => project.markTypes.find((item) => item.code === code).id;
  return { project, schemeId: made.scheme.id, point: idOf("Р"), line: idOf("Л") };
};
const scene = world();

// Полная версия — `layout: "desktop"`: правка там разрешена.
const stateOf = (patch = {}) => ({
  project: scene.project,
  schemeId: scene.schemeId,
  layout: "desktop",
  mode: "select",
  activeTypeId: null,
  activeRoomId: null,
  selectedMarkIds: [],
  selectedOutlineId: null,
  editPathId: null,
  ...patch,
});

// ——— одиночный тап —————————————————————————————————————————————————

test("в добавлении тап по пустому месту ставит метку — ради этого таск и есть", () => {
  const state = stateOf({ mode: "add", activeTypeId: scene.point });
  assert.equal(canvasTapKind(state, {}), "place");
});

test("тап по стоящей метке выделяет её даже в добавлении", () => {
  // Так ведёт себя клик мышью: попадание по метке важнее постановки новой —
  // иначе до соседа в блоке было бы не дотянуться, а метки ложились бы одна на
  // другую.
  const state = stateOf({ mode: "add", activeTypeId: scene.point });
  assert.equal(canvasTapKind(state, { markId: "mark-1", part: "mark" }), "select");
  assert.equal(canvasTapKind(state, { markId: "mark-1", part: "label" }), "select");
});

test("в рисовании ломаной и контура тап ставит вершину, что бы под ним ни было", () => {
  const line = stateOf({ mode: "add", activeTypeId: scene.line });
  assert.equal(canvasTapKind(line, {}), "vertex");
  // Клик мышью в рисовании тоже не выбирает метку: жест занят вершинами.
  assert.equal(canvasTapKind(line, { markId: "mark-1", part: "mark" }), "vertex");
  const room = stateOf({ mode: "room", activeRoomId: "room-1" });
  assert.equal(canvasTapKind(room, {}), "vertex");
  assert.equal(canvasTapKind(room, { markId: "mark-1", part: "mark" }), "vertex");
});

test("ручки важнее всего остального, и порядок у них мышиный", () => {
  const state = stateOf({ mode: "add", activeTypeId: scene.point, selectedMarkIds: ["mark-1"] });
  assert.equal(canvasTapKind(state, { labelTurn: true }), "labelTurn");
  assert.equal(canvasTapKind(state, { labelLeader: true }), "labelLeader");
  assert.equal(canvasTapKind(state, { blockSide: "right" }), "block");
  // Ручка разбивки и продолжения ставит вершину нажатием, ручка вершины — нет:
  // она для переноса, и тапом по ней мышь тоже ничего не делает.
  assert.equal(canvasTapKind(state, { pathHandle: { kind: "insert", index: 1 } }), "pathAdd");
  assert.equal(canvasTapKind(state, { pathHandle: { kind: "extend", index: 2, end: "last" } }), "pathAdd");
  assert.equal(canvasTapKind(state, { pathHandle: { kind: "vertex", index: 0 } }), "none");
});

test("вне добавления тап по пустому месту ничего не ставит", () => {
  assert.equal(canvasTapKind(stateOf({}), {}), "select");
  // Тип выбран, но режим «Выделение» — клик мышью тоже ничего не ставит.
  assert.equal(canvasTapKind(stateOf({ activeTypeId: scene.point }), {}), "select");
});

// ——— просмотр не трогаем ————————————————————————————————————————————

test("в просмотре тап только выделяет — ни метки, ни вершины, ни ручки", () => {
  // Это граница таска 106: правка в просмотре запрещена, и разрешать её
  // пальцем нельзя ни одним жестом.
  const view = (patch) => stateOf({ layout: "mobile", ...patch });
  const picks = [
    {},
    { markId: "mark-1", part: "mark" },
    { labelTurn: true },
    { labelLeader: true },
    { blockSide: "right" },
    { pathHandle: { kind: "insert", index: 1 } },
    { pathHandle: { kind: "vertex", index: 0 } },
    { outlineId: "outline-1", outlinePart: "label" },
    { guideId: "guide-1", guideAxis: "h" },
  ];
  for (const mode of ["select", "add", "room"]) {
    for (const pick of picks) {
      const state = view({ mode, activeTypeId: scene.point, activeRoomId: "room-1", selectedMarkIds: ["mark-1"] });
      assert.equal(canvasTapKind(state, pick), "select", "в просмотре тап делает не выбор: " + JSON.stringify(pick));
      assert.equal(canvasGrabKind(state, pick), null, "в просмотре долгое нажатие что-то берёт: " + JSON.stringify(pick));
    }
  }
});

// ——— долгое нажатие ————————————————————————————————————————————————

test("долгое нажатие берёт то, что под пальцем", () => {
  const state = stateOf({});
  assert.equal(canvasGrabKind(state, { markId: "mark-1", part: "mark" }), "mark");
  assert.equal(canvasGrabKind(state, { markId: "mark-1", part: "line" }), "mark");
  assert.equal(canvasGrabKind(state, { markId: "mark-1", part: "label" }), "label");
  assert.equal(canvasGrabKind(state, { pathHandle: { kind: "vertex", index: 0 } }), "pathVertex");
  assert.equal(canvasGrabKind(state, { pathHandle: { kind: "insert", index: 1 } }), "pathAdd");
  assert.equal(canvasGrabKind(state, { outlineId: "outline-1", outlinePart: "label" }), "outlineLabel");
  assert.equal(canvasGrabKind(state, { guideId: "guide-1", guideAxis: "h" }), "guideMove");
});

test("над пустым местом долгое нажатие не берёт ничего — жест остаётся панорамой", () => {
  assert.equal(canvasGrabKind(stateOf({}), {}), null);
  assert.equal(canvasGrabKind(stateOf({}), { outlineId: "outline-1", outlinePart: "edge" }), null);
  assert.equal(canvasGrabKind(null, { markId: "mark-1" }), null);
});

test("во время рисования долгое нажатие не хватает соседнюю метку", () => {
  // Рука там ставит вершины; утащить чужую метку посреди ломаной — не то, чего
  // ждут, и вернуть её было бы нечем: черновик в историю не попадает.
  const line = stateOf({ mode: "add", activeTypeId: scene.line });
  assert.equal(canvasGrabKind(line, { markId: "mark-1", part: "mark" }), null);
  const room = stateOf({ mode: "room", activeRoomId: "room-1" });
  assert.equal(canvasGrabKind(room, { markId: "mark-1", part: "mark" }), null);
});

// ——— двойной тап ———————————————————————————————————————————————————

test("двойной тап — два тапа подряд рядом друг с другом", () => {
  const first = { point: { x: 100, y: 100 }, at: 1000 };
  assert.equal(canvasDoubleTap(first, { point: { x: 104, y: 98 }, at: 1180 }), true);
  // Разошлись во времени — это два разных тапа.
  assert.equal(canvasDoubleTap(first, { point: { x: 100, y: 100 }, at: 1600 }), false);
  // Разошлись в пространстве — тоже.
  assert.equal(canvasDoubleTap(first, { point: { x: 160, y: 100 }, at: 1100 }), false);
  assert.equal(canvasDoubleTap(null, { point: { x: 100, y: 100 }, at: 1100 }), false);
});

// ——— меры пальца ———————————————————————————————————————————————————

test("у пальца свой запас попадания, у мыши прежний", () => {
  // Ручка вершины — квадратик в семь пикселей: без запаса за неё не взяться.
  assert.ok(canvasHitSlack(true) >= 6, "запас пальца мал: " + canvasHitSlack(true));
  assert.equal(canvasHitSlack(false), 0, "мыши добавили запас — попадание изменилось бы у всех");
  assert.ok(canvasHitSlack(true) > canvasHitSlack(false));
  // Мерка сдвига живёт рядом и тоже разная (таск 106).
  assert.ok(canvasDragSlop({ touch: true }) > canvasDragSlop({}));
});

test("кольцо ожидания замыкается ровно к порогу долгого нажатия", () => {
  assert.equal(canvasPressProgress(0), 0);
  assert.equal(canvasPressProgress(-5), 0);
  assert.ok(canvasPressProgress(200) > 0 && canvasPressProgress(200) < 1);
  assert.equal(canvasPressProgress(10000), 1, "кольцо перерастает само себя");
});

// ——— выделение по тапу: просмотр против полной версии —————————————————

test("повторный тап по метке снимает выделение только в просмотре", () => {
  const drag = { kind: "pan", tap: { markId: "mark-1" }, moved: false, touch: true };
  // Просмотр: тап по выделенной метке закрывает её карточку (таск 106).
  const viewing = stateOf({ layout: "mobile", selectedMarkIds: ["mark-1"] });
  assert.deepEqual(canvasTapAction(viewing, drag), { selectedMarkIds: [], selectedOutlineId: null });
  // Полная версия: выделение рабочее — за ним ручки «+», поворот подписи и
  // поводок. Мышь по выделенной метке его тоже не снимает.
  const editing = stateOf({ selectedMarkIds: ["mark-1"] });
  assert.equal(canvasTapAction(editing, drag), null);
  // Чужая метка выделяется в обеих раскладках.
  const other = { kind: "pan", tap: { markId: "mark-2" }, moved: false, touch: true };
  assert.deepEqual(canvasTapAction(editing, other), { selectedMarkIds: ["mark-2"], selectedOutlineId: null });
});

// ——— порядок веток в обработчике ————————————————————————————————————

const source = readFileSync(CANVAS_SRC, "utf8");
const withoutComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, "");
const bodyOf = (name) => {
  const from = source.indexOf(name);
  const rest = source.slice(from);
  return withoutComments(rest.slice(0, rest.indexOf("\nfunction ")));
};

test("палец разбирается своей дверью раньше мышиного выхода", () => {
  // Тот же класс дефекта, что в D19: ветка ниже раннего выхода — мёртвый код.
  const body = bodyOf("function canvasPointerUp(");
  const touchDoor = body.indexOf("canvasTouchUp(");
  const mouseExit = body.indexOf('pointerType === "touch"');
  assert.ok(touchDoor > 0, "обработчик отпускания больше не зовёт canvasTouchUp");
  assert.ok(mouseExit > 0, "мышиный выход пропал — проверять нечего");
  assert.ok(touchDoor < mouseExit, "разбор пальца снова стоит ниже выхода по pointerType");
});

test("правка объекта по-прежнему идёт одной дверью, и та спрашивает раскладку", () => {
  // Пальцу открыли жесты, а не объект: всё, что он делает, идёт через те же
  // команды холста, а они — через `canvasCommit` с проверкой умения `editMarks`.
  const body = bodyOf("export function canvasCommit(");
  const guard = body.indexOf("if (!canvasEditAllowed(state))");
  assert.ok(guard > 0, "из canvasCommit пропала проверка раскладки");
  for (const gate of ["setState({ project:", "pushCommand("]) {
    assert.ok(guard < body.indexOf(gate), "правка объекта идёт раньше проверки раскладки: " + gate);
  }
  // Ни один пальцевый жест не пишет в объект мимо команд холста: в разборе
  // пальца нет ни setState с проектом, ни своего pushCommand.
  const touch = bodyOf("function canvasTouchUp(");
  assert.ok(!touch.includes("pushCommand("), "разбор пальца пишет в историю мимо canvasCommit");
  assert.ok(!/setState\(\s*\{\s*project:/.test(touch), "разбор пальца правит объект напрямую");
});
