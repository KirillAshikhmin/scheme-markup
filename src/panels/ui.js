// Общие кирпичи панелей: элементы, кнопки, модальные диалоги.
// Отдельный модуль, потому что ими пользуются все панели: тянуть их из чужой
// панели значило бы тянуть вместе с ней её регистрацию и подписки.
import { strings, text } from "../strings.js";

export function uiEl(tag, options = {}, children = []) {
  const node = document.createElement(tag);
  if (options.class) node.className = options.class;
  if (options.text != null) node.textContent = options.text;
  if (options.title) node.title = options.title;
  if (options.type) node.type = options.type;
  if (options.value != null) node.value = options.value;
  if (options.placeholder) node.placeholder = options.placeholder;
  if (options.attrs) {
    for (const [name, value] of Object.entries(options.attrs)) node.setAttribute(name, value);
  }
  if (options.on) {
    for (const [name, handler] of Object.entries(options.on)) node.addEventListener(name, handler);
  }
  for (const child of Array.isArray(children) ? children : [children]) {
    if (child) node.append(child);
  }
  return node;
}

export function uiButton(label, options = {}) {
  return uiEl("button", {
    class: options.class || "ui-btn",
    text: label,
    title: options.title || "",
    type: "button",
    on: options.on,
    attrs: options.attrs,
  });
}

// Диалоги складываются стопкой: подтверждение поверх редактора плана —
// обычное дело. Виден верхний, Escape закрывает только его, Enter нажимает его
// основное действие, нижние ждут своей очереди и закрываются своими же close().
// Пока стопка не пуста, #dialog-host не пустой — значит затемнение на месте
// (правило `:empty` из styles.css). Клавиатура не должна оставаться в панели
// под затемнением: диалог забирает фокус, а закрываясь — возвращает его тому,
// кто его открыл.
const uiDialogs = [];
let uiEscapeListener = null;

export function uiDialogDepth() {
  return uiDialogs.length;
}

function uiRefreshDialogs() {
  const host = document.getElementById("dialog-host");
  uiDialogs.forEach((entry, index) => {
    entry.card.hidden = index !== uiDialogs.length - 1;
  });
  if (uiDialogs.length === 0) {
    if (host) host.replaceChildren();
    if (uiEscapeListener) {
      document.removeEventListener("keydown", uiEscapeListener);
      uiEscapeListener = null;
    }
    return;
  }
  if (uiEscapeListener) return;
  uiEscapeListener = (event) => {
    const top = uiDialogs[uiDialogs.length - 1];
    if (!top) return;
    if (event.key === "Escape") {
      if (top.dismissable === false) return;
      event.preventDefault();
      top.close();
      if (top.onCancel) top.onCancel();
      return;
    }
    // Enter подтверждает основное действие. Поле ввода, которое обработало
    // Enter само (uiPrompt), помечает событие — второй раз не срабатываем.
    if (event.key !== "Enter" || event.defaultPrevented || !top.primary) return;
    const target = event.target;
    if (target && (target.tagName === "TEXTAREA" || target.isContentEditable)) return;
    event.preventDefault();
    top.primary.click();
  };
  document.addEventListener("keydown", uiEscapeListener);
}

function uiFocusEntry(entry) {
  const target = entry.card.querySelector("input, select, textarea") || entry.primary || entry.card;
  if (target && typeof target.focus === "function") target.focus();
}

// Фокус возвращается открывшему, если он ещё на странице (кнопка панели могла
// исчезнуть при перерисовке); иначе — диалогу, который снова стал верхним.
function uiReturnFocus(entry) {
  const opener = entry.opener;
  if (opener && typeof opener.focus === "function" && opener.isConnected) {
    opener.focus();
    return;
  }
  const top = uiDialogs[uiDialogs.length - 1];
  if (top) uiFocusEntry(top);
}

export function uiModal(options) {
  const host = document.getElementById("dialog-host");
  const actions = options.actions || [];
  const card = uiEl("div", { class: "modal", attrs: { tabindex: "-1" } }, [
    uiEl("h3", { class: "modal__title", text: options.title || "" }),
    uiEl("div", { class: "modal__body" }, options.body || null),
    uiEl("div", { class: "modal__actions" }, actions),
  ]);
  const entry = {
    card,
    dismissable: options.dismissable,
    onCancel: options.onCancel,
    // Основное действие — последняя кнопка в ряду (в uiConfirm и uiPrompt это
    // подтверждение, в редакторе плана — «Готово»).
    primary: options.primary || [...actions].reverse().find((node) => node && node.tagName === "BUTTON") || null,
    opener: typeof document !== "undefined" ? document.activeElement : null,
    close() {
      const index = uiDialogs.indexOf(entry);
      if (index < 0) return;
      uiDialogs.splice(index, 1);
      card.remove();
      uiRefreshDialogs();
      uiReturnFocus(entry);
    },
  };
  if (!host) return { close() {}, card };
  uiDialogs.push(entry);
  host.append(card);
  uiRefreshDialogs();
  uiFocusEntry(entry);
  return { close: entry.close, card };
}

export function uiConfirm({ title, message, confirmLabel }) {
  return new Promise((resolve) => {
    let modal;
    const answer = (value) => {
      modal.close();
      resolve(value);
    };
    modal = uiModal({
      title,
      body: uiEl("p", { class: "modal__text", text: message }),
      actions: [
        uiButton(strings.dialog.cancel, { on: { click: () => answer(false) } }),
        uiButton(confirmLabel || strings.dialog.confirm, {
          class: "ui-btn ui-btn--danger",
          on: { click: () => answer(true) },
        }),
      ],
      onCancel: () => resolve(false),
    });
  });
}

export function uiPrompt({ title, value, placeholder, submitLabel }) {
  return new Promise((resolve) => {
    let modal;
    const done = (result) => {
      modal.close();
      resolve(result || null);
    };
    const input = uiEl("input", {
      class: "ui-input",
      type: "text",
      value: value || "",
      placeholder: placeholder || "",
      on: {
        keydown: (event) => {
          if (event.key !== "Enter") return;
          event.preventDefault();
          done(input.value.trim());
        },
      },
    });
    modal = uiModal({
      title,
      body: input,
      actions: [
        uiButton(strings.dialog.cancel, { on: { click: () => done(null) } }),
        uiButton(submitLabel || strings.dialog.save, {
          class: "ui-btn ui-btn--accent",
          on: { click: () => done(input.value.trim()) },
        }),
      ],
      onCancel: () => resolve(null),
    });
    input.select();
  });
}

export function formatMegabytes(bytes) {
  return text("units.megabytes", { value: Math.round(bytes / (1024 * 1024)) });
}
