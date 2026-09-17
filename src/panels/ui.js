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

// Значки рисуются прямо здесь, своими линиями: внешних картинок и шрифтов в
// сборке нет, а стрелки отмены в системном шрифте есть не на каждой машине —
// на части из них вместо знака встал бы пустой прямоугольник. Рисунок задан
// в клетке 24×24 и тянется за цветом кнопки (`currentColor` в стилях).
const UI_SVG_NS = "http://www.w3.org/2000/svg";
const UI_ICONS = {
  undo: ["M7 10h9a4.5 4.5 0 0 1 0 9h-5", "M10.5 6 6.5 10l4 4"],
  redo: ["M17 10H8a4.5 4.5 0 0 0 0 9h5", "M13.5 6 17.5 10l-4 4"],
  search: ["M17 10.5a6.5 6.5 0 1 1-13 0 6.5 6.5 0 0 1 13 0", "M15.2 15.2 20 20"],
  plus: ["M12 5v14", "M5 12h14"],
  // Карандаш ведён по той же диагонали, что стрелки отмены: круглый торец даёт
  // дуга, поперечина отделяет остриё — без неё в размере кнопки это просто
  // палка.
  edit: ["M5 19v-3.5L15.5 5a2.5 2.5 0 0 1 3.5 3.5L8.5 19H5z", "M13.7 6.8 17.2 10.3"],
  // Корзина: крышка, дужка и сужающийся к низу корпус. Полосок внутри нет —
  // в клетке 18 px они сливаются с корпусом в пятно.
  trash: ["M4.5 7.5h15", "M9.5 7.5V5.5h5v2", "M6.5 7.5l1 12a1.5 1.5 0 0 0 1.5 1.5h6a1.5 1.5 0 0 0 1.5-1.5l1-12"],
  // Предупреждения: восклицательный знак в треугольнике — тот же рисунок, что
  // на дорожном знаке, и читается он раньше слова.
  warning: ["M12 4.5 21 20H3z", "M12 10v4.5", "M12 17.4v.2"],
  // Всё в порядке — галочка. Отдельный значок, а не зачёркнутый треугольник:
  // хорошая новость не должна выглядеть как отменённая плохая.
  ok: ["M5 12.5 10 17.5 19 7"],
  // Раскрытие списка. Повёрнутый влево — свёрнутый, вниз — раскрытый; поворот
  // делают стили, рисунок один.
  chevron: ["M7 10.5 12 15.5 17 10.5"],
};

export function uiIcon(name) {
  const svg = document.createElementNS(UI_SVG_NS, "svg");
  svg.setAttribute("class", "ui-icon");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  for (const line of UI_ICONS[name] || []) {
    const path = document.createElementNS(UI_SVG_NS, "path");
    path.setAttribute("d", line);
    svg.append(path);
  }
  return svg;
}

// Кнопка-значок. Подпись словами у неё всё равно есть — в `title` и в
// `aria-label`: значок без слова опознаётся не всеми, а экранный диктор
// не читает рисунок вовсе.
export function uiIconButton(name, options = {}) {
  const button = uiButton("", {
    class: (options.class || "ui-btn") + " ui-btn--icon",
    title: options.title || options.label || "",
    on: options.on,
    attrs: { ...(options.attrs || {}), "aria-label": options.label || options.title || "" },
  });
  button.append(uiIcon(name));
  return button;
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
