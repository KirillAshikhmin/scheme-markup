// Шов отмены: стек команд — чистая структура, браузер ей не нужен.
import test from "node:test";
import assert from "node:assert/strict";
import {
  pushCommand,
  undo,
  redo,
  clearHistory,
  canUndo,
  canRedo,
  undoLabel,
  redoLabel,
  HISTORY_DEPTH,
  onHistoryChange,
} from "../src/history.js";

// Команда-счётчик: видно, сколько раз её отменяли и возвращали.
function counterCommand(label, log) {
  return {
    label,
    undo: () => log.push("undo:" + label),
    redo: () => log.push("redo:" + label),
  };
}

test("пустая история ничего не отменяет и не возвращает", () => {
  clearHistory();
  assert.equal(canUndo(), false);
  assert.equal(canRedo(), false);
  assert.equal(undo(), null);
  assert.equal(redo(), null);
  assert.equal(undoLabel(), "");
});

test("отмена вызывает undo команды, возврат — её redo", () => {
  clearHistory();
  const log = [];
  pushCommand(counterCommand("постановка", log));
  assert.equal(canUndo(), true);
  assert.equal(undoLabel(), "постановка");

  undo();
  assert.deepEqual(log, ["undo:постановка"]);
  assert.equal(canUndo(), false);
  assert.equal(canRedo(), true);
  assert.equal(redoLabel(), "постановка");

  redo();
  assert.deepEqual(log, ["undo:постановка", "redo:постановка"]);
  assert.equal(canUndo(), true);
  assert.equal(canRedo(), false);
});

test("отмена идёт с конца: последнее действие отменяется первым", () => {
  clearHistory();
  const log = [];
  pushCommand(counterCommand("первое", log));
  pushCommand(counterCommand("второе", log));
  undo();
  undo();
  assert.deepEqual(log, ["undo:второе", "undo:первое"]);
});

test("новое действие после отмены стирает возврат", () => {
  clearHistory();
  const log = [];
  pushCommand(counterCommand("первое", log));
  undo();
  assert.equal(canRedo(), true);
  pushCommand(counterCommand("второе", log));
  assert.equal(canRedo(), false);
  assert.equal(redo(), null);
});

test("глубина стека — сто действий, лишние старые выпадают", () => {
  clearHistory();
  const log = [];
  assert.equal(HISTORY_DEPTH, 100);
  for (let index = 0; index < HISTORY_DEPTH + 5; index += 1) {
    pushCommand(counterCommand("шаг" + index, log));
  }
  for (let index = 0; index < HISTORY_DEPTH; index += 1) undo();
  assert.equal(canUndo(), false);
  assert.equal(log.length, HISTORY_DEPTH);
  // Самое старое отменённое — шаг5: шаги 0…4 вытеснены.
  assert.equal(log[HISTORY_DEPTH - 1], "undo:шаг5");
});

test("смена объекта очищает историю целиком", () => {
  clearHistory();
  const log = [];
  pushCommand(counterCommand("постановка", log));
  undo();
  clearHistory();
  assert.equal(canUndo(), false);
  assert.equal(canRedo(), false);
  assert.deepEqual(log, ["undo:постановка"]);
});

test("команда без функций отмены не кладётся в стек", () => {
  clearHistory();
  pushCommand(null);
  pushCommand({ label: "без рук" });
  assert.equal(canUndo(), false);
});

test("на изменения истории подписываются все желающие, отписка снимает одного", () => {
  clearHistory();
  const log = [];
  const offFirst = onHistoryChange(() => log.push("первый"));
  onHistoryChange(() => log.push("второй"));
  pushCommand({ label: "шаг", undo() {}, redo() {} });
  assert.deepEqual(log, ["первый", "второй"], "вторая подписка не вытесняет первую");

  log.length = 0;
  offFirst();
  undo();
  assert.deepEqual(log, ["второй"], "отписался только тот, кто просил");
});
