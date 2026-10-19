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
  // Крестик: «убрать эту строку». Не корзина — ничего не удаляется насовсем,
  // и не галочка — она уже занята хорошей новостью.
  close: ["M7 7 17 17", "M17 7 7 17"],
  // Минус — близнец плюса: та же черта, та же длина. Пара стоит рядом в
  // масштабе, и разная длина черт была бы видна сразу.
  minus: ["M5 12h14"],
  // Порядок схем: стрелка с древком, а не «шеврон». Шеврон в наборе уже занят
  // раскрытием списка, и в столбце кнопок «выше/ниже» рядом с ним читался бы
  // как «развернуть».
  up: ["M12 19V6", "M6.5 11.5 12 6l5.5 5.5"],
  down: ["M12 5v13", "M6.5 12.5 12 18l5.5-5.5"],
  // Замена плана: две стрелки навстречу друг другу — «одно вместо другого».
  // Не крест-накрест: в клетке 16 px пересечение линий сливается в узел.
  swap: ["M4.5 9h13", "M14.5 5.5 18 9l-3.5 3.5", "M19.5 15h-13", "M9.5 11.5 6 15l3.5 3.5"],
  // Рамки кадрирования здесь больше нет: кнопка «Править план» убрана (G175),
  // а набор значков сверяется с кодом в обе стороны — ненужный рисунок красит
  // прогон. В окне загрузки обрезка подписана словом, а не значком.
  //
  // Поворот плана: кольцо с разрывом и уголком на конце дуги. Левый и правый
  // зеркальны, и сторона поворота читается только по уголку — поэтому он
  // вынесен за кольцо, а не вписан в него: остриё внутри дуги в клетке 16 px
  // сливалось с самим кольцом в утолщение.
  rotateLeft: ["M5.5 12a6.5 6.5 0 1 1 3 5.5", "M9 8.5H5.5V5"],
  rotateRight: ["M18.5 12a6.5 6.5 0 1 0-3 5.5", "M15 8.5h3.5V5"],
  // Контур помещения: замкнутая ломаная с углами — то же, что обводят на
  // плане. Прямоугольник не годится: обводят по стенам, а не по рамке.
  outline: ["M4.5 8.5 12 4l7.5 4.5v7L12 20l-7.5-4.5z"],
  // Подсказка холста в свёрнутом виде: вопрос в кольце. Не лампочка и не «i» —
  // кольцо с вопросом читается как «здесь написано, что делать», и в клетке
  // 16 px у него узнаётся сам знак, а не пятно.
  hint: ["M12 4.5a7.5 7.5 0 1 1 0 15 7.5 7.5 0 0 1 0-15", "M9.8 9.6a2.3 2.3 0 0 1 4.4.9c0 1.6-2.2 1.9-2.2 3.3", "M12 16.8v.2"],
  // «i» для сводки (G228): тот же круг, что у «?», — плашки стоят по краям
  // одного ряда и обязаны читаться парой. Внутри точка и штрих: буква «i»
  // линиями, а не шрифтом, — своего шрифта у значков нет.
  info: ["M12 4.5a7.5 7.5 0 1 1 0 15 7.5 7.5 0 0 1 0-15", "M12 10.8v6", "M12 7.4v.2"],
  // Уплотнение нумерации: две стрелки, сходящиеся к середине, — «сомкнуть».
  // Прежнее «№» говорило про номера, но не про то, что с ними сделают.
  compact: ["M4 12h6", "M7 9l3 3-3 3", "M20 12h-6", "M17 9l-3 3 3 3"],
  // Связи меток: звено цепи — два полукольца и перемычка между ними. Стрелка
  // не годится: стрелками в наборе уже сказано «отмена», «порядок» и «замена»,
  // а здесь речь не о действии, а о том, что две вещи держатся друг за друга.
  link: ["M10.6 7.4 12.4 5.6a3.9 3.9 0 0 1 5.5 5.5l-1.8 1.8", "M13.4 16.6l-1.8 1.8a3.9 3.9 0 0 1-5.5-5.5l1.8-1.8", "M9.6 14.4 14.4 9.6"],
  // Свободный номер метке: развилка — одна линия расходится надвое, со
  // стрелками на концах. Речь тут не о номере, а о том, что с меткой делают, —
  // отделяют её от одинаковых. «№» не годится (это буква, а не рисунок),
  // «плюс» уже значит «добавить», а «уплотнение» — стрелки навстречу; развилка
  // читается им обратной: было одно обозначение, стало два.
  split: ["M4 12h6", "M10 12 15 7h4", "M10 12 15 17h4", "M16.5 4.5 19 7l-2.5 2.5", "M16.5 14.5 19 17l-2.5 2.5"],
  // Просмотр: глаз. Пара к карандашу на одной кнопке — «смотреть» против
  // «править»; словами оба состояния названы в подсказке.
  view: ["M3.5 12s3.4-5.5 8.5-5.5 8.5 5.5 8.5 5.5-3.4 5.5-8.5 5.5S3.5 12 3.5 12", "M14.5 12a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0"],
  // Спрятанное: тот же глаз, перечёркнутый косой чертой. Пара к `view`, и
  // различать их надо с одного взгляда — поэтому не «глаз без зрачка», а
  // именно черта: она видна и в клетке 16 px.
  viewOff: ["M3.5 12s3.4-5.5 8.5-5.5c1.5 0 2.8.4 4 1.1", "M20.5 12s-3.4 5.5-8.5 5.5c-1.5 0-2.8-.4-4-1.1", "M9.9 9.9a2.5 2.5 0 0 0 3.5 3.5", "M4.5 4.5 19.5 19.5"],
  // Папка автосохранения: папка с язычком — тот же знак, что в проводнике.
  folder: ["M3.5 19.5V5.5h5l2 2.5h10v11.5z"],
  // Открыть файл и выгрузить в файл — пара: лоток один и тот же, стрелка
  // наружу и стрелка внутрь. Порознь каждая стрелка двусмысленна, парой они
  // читаются сразу, а в шапке они и стоят рядом.
  fileOpen: ["M12 15.5V4.5", "M8 8.5 12 4.5l4 4", "M4.5 15.5v4h15v-4"],
  fileSave: ["M12 4.5v11", "M8 11.5 12 15.5l4-4", "M4.5 15.5v4h15v-4"],
  // Полный экран: четыре уголка, расходящиеся к краям клетки, и они же,
  // сведённые внутрь, — выход. Рисунок общепринятый, и состояние по нему
  // видно без слова: уголки наружу — «развернуть», внутрь — «свернуть».
  fullscreen: ["M4 9.5V4h5.5", "M20 9.5V4h-5.5", "M4 14.5V20h5.5", "M20 14.5V20h-5.5"],
  fullscreenExit: ["M9.5 4v5.5H4", "M14.5 4v5.5H20", "M9.5 20v-5.5H4", "M14.5 20v-5.5H20"],
  // Выгрузки под одним значком (таск 163, G242): принтер — корпус, лист,
  // въехавший в него сверху, и лист, вышедший снизу. Знак заказчик назвал сам
  // («меню по иконке-кнопке с принтером»), и он честен: за ним и печать, и
  // файл листа — то, что уходит со страницы наружу.
  printer: ["M7.5 9.5V4.5h9v5", "M4.5 9.5h15v7h-3", "M7.5 16.5h-3", "M7.5 13.5h9v6h-9z"],
  // Присесть и подпрыгнуть пальцем (таск 163, G242). Пара: у обеих земля
  // чертой внизу, и отличает их только стрелка — вниз к земле у приседа, вверх
  // от земли у прыжка. Без черты обе читались бы как «листать список»: земля и
  // говорит, что речь про стойку, а не про порядок. Человечка здесь нет
  // нарочно — в клетке 18 px он превращается в пятно, а стрелка читается.
  crouch: ["M12 4.5v9", "M8.5 10 12 13.5l3.5-3.5", "M5 19.5h14"],
  jump: ["M12 13.5v-9", "M8.5 8 12 4.5l3.5 3.5", "M5 19.5h14"],
  // Два вида объёма — две кнопки одного места (таск 166, G245): кнопка под
  // полным экраном носит значок того вида, **в который переведёт**.
  //
  // `viewPerson` — человек: голова и плечи, тот же рисунок, которым человека
  // обозначают везде. Стоять в комнате — это и есть «от первого лица», и
  // палочный человечек тут не годится: в клетке 16 px его руки и ноги слипаются
  // (о том же говорит пара `crouch`/`jump`, где человечка нет нарочно).
  //
  // `viewAround` — коробка в три четверти: вся комната целиком, видимая со
  // стороны. Первым рисунком была коробка с дугой-облётом вокруг неё, и живой
  // прогон её отверг: в клетке 16 px дуга садится на крышу и всё вместе
  // читается грибом. Три ребра, сходящиеся в середине, спорить не с чем — и
  // они же отличают коробку от `outline`, где тот же шестиугольник означает
  // плоскую обводку помещения (а выбирают её в другом конце экрана).
  //
  // Пара читается с одного взгляда: человек — «встань внутри», коробка —
  // «отойди и посмотри на всё».
  viewPerson: ["M12 5a2.6 2.6 0 1 1 0 5.2 2.6 2.6 0 0 1 0-5.2", "M5.5 19.5a6.5 6.5 0 0 1 13 0"],
  viewAround: ["M12 3.5 20 8v8l-8 4.5-8-4.5V8z", "M4 8 12 12 20 8", "M12 12v8.5"],
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

// Кнопка со значком и словом рядом. Слово лежит в своём `span`, и это не
// мелочь: на узком экране его прячут стилями, а кнопка остаётся узнаваемой по
// значку — так файловые действия влезают в одну строку шапки на планшете.
// Слово при этом не теряется: оно уходит в подсказку и в `aria-label`, как и у
// кнопки-значка. Подпись меняют через `uiButtonLabel`, а не `textContent`:
// присваивание текста кнопке стёрло бы и значок.
export function uiIconLabelButton(name, label, options = {}) {
  const button = uiButton("", {
    class: (options.class || "ui-btn") + " ui-btn--label",
    on: options.on,
    attrs: options.attrs,
  });
  button.append(uiIcon(name), uiEl("span", { class: "ui-btn__word", text: label }));
  uiButtonLabel(button, label, options.title);
  return button;
}

// Новая подпись кнопки со значком: слово в строке, оно же в подсказке и в
// `aria-label`. `title` задаётся отдельно, когда подсказка длиннее подписи.
export function uiButtonLabel(button, label, title) {
  if (!button) return button;
  const word = button.querySelector(".ui-btn__word");
  if (word) word.textContent = label;
  else button.textContent = label;
  button.title = title || label;
  button.setAttribute("aria-label", label);
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

/**
 * Вопрос с двумя ответами.
 *
 * `cancelLabel` и `confirmClass` нужны там, где вопрос не про «делать или
 * передумать», а про развилку с двумя равными ответами: «пересчитать чертёж»
 * против «оставить как есть» (таск 134). Слово «Отмена» там соврало бы — ни
 * один из ответов ничего не отменяет, — а красная кнопка обещала бы потерю.
 */
export function uiConfirm({ title, message, confirmLabel, cancelLabel, confirmClass }) {
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
        uiButton(cancelLabel || strings.dialog.cancel, { on: { click: () => answer(false) } }),
        uiButton(confirmLabel || strings.dialog.confirm, {
          class: confirmClass || "ui-btn ui-btn--danger",
          on: { click: () => answer(true) },
        }),
      ],
      onCancel: () => resolve(false),
    });
  });
}

/**
 * Окно с одним полем. `null` в ответе значит «отказались».
 *
 * Пустая строка по умолчанию — тот же отказ: окно спрашивают про имя схемы,
 * про код типа, про расстояние — пустых ответов там не бывает. `allowEmpty`
 * включает обратное: пустой ответ — это ответ. Так правится текст
 * комментария (таск 116) — очистить плашку человек имеет право, и делать это
 * удалением всей метки он не обязан.
 */
export function uiPrompt({ title, value, placeholder, submitLabel, allowEmpty }) {
  return new Promise((resolve) => {
    let modal;
    const done = (result) => {
      modal.close();
      resolve(allowEmpty ? (result === null ? null : result) : result || null);
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
