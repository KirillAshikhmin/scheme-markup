// Отмена — стек команд в памяти. В файл история не пишется: пользователь просил
// отмену, а не версии.
//
// Команда — это пара функций: `undo()` возвращает как было, `redo()` — как стало.
// Холст кладёт сюда снимки объекта, которые вернула модель; своего мутатора
// объекта здесь нет и быть не должно.
export const HISTORY_DEPTH = 100;

const historyDone = [];
const historyUndone = [];
const historyListeners = new Set();

function historyChanged() {
  for (const listener of [...historyListeners]) listener();
}

export function pushCommand(command) {
  if (!command || typeof command.undo !== "function" || typeof command.redo !== "function") return null;
  historyDone.push(command);
  // Ветка «отменил и сделал иначе»: возвращать уже нечего.
  historyUndone.length = 0;
  while (historyDone.length > HISTORY_DEPTH) historyDone.shift();
  historyChanged();
  return command;
}

export function undo() {
  const command = historyDone.pop();
  if (!command) return null;
  command.undo();
  historyUndone.push(command);
  historyChanged();
  return command;
}

export function redo() {
  const command = historyUndone.pop();
  if (!command) return null;
  command.redo();
  historyDone.push(command);
  historyChanged();
  return command;
}

export function canUndo() {
  return historyDone.length > 0;
}

export function canRedo() {
  return historyUndone.length > 0;
}

export function undoLabel() {
  const command = historyDone[historyDone.length - 1];
  return command && command.label ? command.label : "";
}

export function redoLabel() {
  const command = historyUndone[historyUndone.length - 1];
  return command && command.label ? command.label : "";
}

// Стек живёт в пределах объекта: при переключении объекта его чистят.
export function clearHistory() {
  historyDone.length = 0;
  historyUndone.length = 0;
  historyChanged();
}

// Кнопки «Отменить»/«Вернуть» подсвечиваются по этому событию, и слушателей у
// него столько, сколько подписалось: панель инструментов, список меток и всё,
// что появится дальше. Возвращённая функция снимает только свою подписку.
export function onHistoryChange(listener) {
  if (typeof listener !== "function") return () => {};
  historyListeners.add(listener);
  return () => historyListeners.delete(listener);
}
