// Выбор метки пальцем и мышью в режиме просмотра (D19).
//
// Дефект, из-за которого таск и появился: «метки не кликабельны в
// мобильном\планшетном интерфейсе». Ветка тапа в `canvasPointerUp` стояла
// **ниже** выхода `if (event.pointerType === "touch") return;` — на планшете до
// неё не доходило вовсе, и карточка метки (таск 104) была недостижима. Ветку не
// видел ни один тест: DOM-обработчики здесь не поднимаются.
//
// Поэтому правило живёт в чистой `canvasTapAction`, и проверяется оно тут. А
// то, что обработчик спрашивает её раньше пальцевого выхода, проверяется
// сканированием исходника: другого способа увидеть порядок веток без браузера
// нет, а именно порядок и был дефектом.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { canvasDragSlop, canvasEditAllowed, canvasTapAction } from "../src/canvas.js";

const CANVAS_SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "canvas.js");

const stateOf = (patch = {}) => ({
  project: { marks: [] },
  schemeId: "scheme-1",
  layout: "mobile",
  selectedMarkIds: [],
  selectedOutlineId: null,
  editPathId: null,
  ...patch,
});

// Жест пальца: начался панорамой, под пальцем оказалась метка.
const tapOn = (markId, patch = {}) => ({ kind: "pan", tap: { markId }, moved: false, touch: true, ...patch });

test("тап пальцем по метке выделяет её — это и есть сломанное требование", () => {
  const action = canvasTapAction(stateOf(), tapOn("mark-1"));
  assert.deepEqual(action, { selectedMarkIds: ["mark-1"], selectedOutlineId: null });
});

test("тап по другой метке переносит выделение, по своей — снимает", () => {
  const state = stateOf({ selectedMarkIds: ["mark-1"] });
  assert.deepEqual(canvasTapAction(state, tapOn("mark-2")), {
    selectedMarkIds: ["mark-2"],
    selectedOutlineId: null,
  });
  // Повторный тап по выделенной метке закрывает карточку — так задумано в 104.
  assert.deepEqual(canvasTapAction(state, tapOn("mark-1")), { selectedMarkIds: [], selectedOutlineId: null });
});

test("тап по пустому месту снимает выделение, а снимать нечего — ничего не делает", () => {
  const busy = stateOf({ selectedMarkIds: ["mark-1"], editPathId: "mark-1" });
  assert.deepEqual(canvasTapAction(busy, tapOn(null)), {
    selectedMarkIds: [],
    selectedOutlineId: null,
    editPathId: null,
  });
  // Пустое состояние не трогается: лишний шаг состояния — лишняя перерисовка.
  assert.equal(canvasTapAction(stateOf(), tapOn(null)), null);
});

test("прокрутка пальцем выделение не меняет", () => {
  // План уехал — это была панорама, а не выбор метки.
  assert.equal(canvasTapAction(stateOf(), tapOn("mark-1", { moved: true })), null);
  assert.equal(canvasTapAction(stateOf({ selectedMarkIds: ["mark-1"] }), tapOn(null, { moved: true })), null);
});

test("жест, отобранный системой, тапом не считается", () => {
  // `pointercancel` приходит той же дверью, что `pointerup`: пальца на экране
  // уже нет, и выделять по нему нельзя.
  assert.equal(canvasTapAction(stateOf(), tapOn("mark-1"), { cancelled: true }), null);
});

test("мышью в просмотре: повторный клик по выделенной метке закрывает карточку", () => {
  const state = stateOf({ selectedMarkIds: ["mark-1"] });
  assert.deepEqual(canvasTapAction(state, { kind: "pan", tapSelected: true, moved: false }), {
    selectedMarkIds: [],
  });
  // Клик мышью по пустому месту — тот же ответ, что и тап.
  assert.deepEqual(canvasTapAction(state, { kind: "empty", moved: false }), {
    selectedMarkIds: [],
    selectedOutlineId: null,
    editPathId: null,
  });
  assert.equal(canvasTapAction(stateOf(), { kind: "empty", moved: false }), null);
});

// Главная осторожность таска: разрешив выделение, не открыть щель для правки.
test("выбор метки не может тронуть объект: в ответе только поля выделения", () => {
  const SESSION_ONLY = ["selectedMarkIds", "selectedOutlineId", "editPathId"];
  const states = [stateOf(), stateOf({ selectedMarkIds: ["mark-1"] }), stateOf({ selectedOutlineId: "outline-1" })];
  const drags = [
    tapOn("mark-1"),
    tapOn("mark-2"),
    tapOn(null),
    { kind: "pan", tapSelected: true, moved: false },
    { kind: "empty", moved: false },
  ];
  for (const state of states) {
    for (const drag of drags) {
      const action = canvasTapAction(state, drag);
      if (!action) continue;
      for (const key of Object.keys(action)) {
        assert.ok(SESSION_ONLY.includes(key), "выбор метки правит состояние за пределами выделения: " + key);
      }
      assert.ok(!("project" in action), "через выбор метки поехал объект");
    }
  }
});

test("чужой жест эта дверь не хватает: у правки свой разбор", () => {
  // Перенос метки, подпись, вершина, черновик, направляющая, постановка точки,
  // ломаная и контур — всё это разбирает обработчик своими ветками, и каждая
  // идёт через `canvasCommit`, закрытую в просмотре. Ответ здесь — «ничего».
  for (const kind of [
    "mark",
    "label",
    "pathVertex",
    "pathAdd",
    "outlineLabel",
    "guideNew",
    "guideMove",
    "place",
    "line",
    "room",
    "outline",
    "done",
  ]) {
    assert.equal(canvasTapAction(stateOf(), { kind, moved: false }), null, "дверь выбора схватила жест " + kind);
  }
  assert.equal(canvasTapAction(stateOf(), null), null);
  assert.equal(canvasTapAction(null, tapOn("mark-1")), null);
});

test("у пальца своя мерка «тап или перенос»", () => {
  // Палец не стоит на месте: мышиные три точки он проезжает на любом тапе, и
  // по ним тап читался бы панорамой.
  assert.ok(canvasDragSlop({ touch: true }) >= 8, "пальцевая мерка мала: " + canvasDragSlop({ touch: true }));
  assert.ok(canvasDragSlop({ touch: true }) > canvasDragSlop({}), "у пальца и мыши одна мерка");
  assert.equal(canvasDragSlop(null), canvasDragSlop({}));
});

// ——— порядок веток в обработчике ————————————————————————————————————
//
// Сам дефект был не в правиле, а в том, где его спросили. Правило теперь
// чистое, но спросить его снова можно не там — и тест обязан покраснеть.
const source = readFileSync(CANVAS_SRC, "utf8");
const pointerUp = source.slice(source.indexOf("function canvasPointerUp("));
// Комментарии выбрасываются: в них те же слова, что в коде, и порядок по ним
// читался бы неверно — этот тест сам на этом и попался.
const withoutComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, "");
const pointerUpBody = withoutComments(pointerUp.slice(0, pointerUp.indexOf("\nfunction ")));

test("выбор метки спрашивается раньше пальцевого выхода из обработчика", () => {
  const asked = pointerUpBody.indexOf("canvasTapAction(");
  const touchExit = pointerUpBody.indexOf('pointerType === "touch"');
  assert.ok(asked > 0, "обработчик отпускания больше не зовёт canvasTapAction");
  assert.ok(touchExit > 0, "пальцевой выход из обработчика пропал — проверять нечего");
  assert.ok(
    asked < touchExit,
    "ветка выбора метки снова стоит ниже выхода по pointerType — на планшете метка не выделится",
  );
});

test("правка в просмотре по-прежнему невозможна: дверь объекта спрашивает раскладку", () => {
  // Перенос метки, постановка новой, смена типа, подпись, вершины — все они
  // доходят до объекта одной дверью `canvasCommit`, и первое, что она делает, —
  // спрашивает умение `editMarks`. Выбор метки этой двери не касается вовсе.
  assert.equal(canvasEditAllowed(stateOf({ layout: "mobile" })), false);
  assert.equal(canvasEditAllowed(stateOf({ layout: "desktop" })), true);

  const commit = source.slice(source.indexOf("export function canvasCommit("));
  const body = withoutComments(commit.slice(0, commit.indexOf("\nfunction ")));
  const guard = body.indexOf("if (!canvasEditAllowed(state))");
  assert.ok(guard > 0, "из canvasCommit пропала проверка раскладки — просмотр стал украшением");
  for (const gate of ["setState({ project:", "pushCommand("]) {
    const at = body.indexOf(gate);
    assert.ok(at > 0, "в canvasCommit не нашлось " + gate);
    assert.ok(guard < at, "правка объекта идёт раньше проверки раскладки: " + gate);
  }
});
