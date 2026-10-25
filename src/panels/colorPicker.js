// Своё окно выбора цвета: слева палитра объекта, справа — поле оттенка
// и точная правка по числам.
//
// Системное `<input type="color">` здесь не годится по двум причинам.
// Во-первых, оно ничего не знает о палитре объекта и о том, какие цвета уже
// заняты соседними комнатами, — а повтор цвета на плане и есть главная беда.
// Во-вторых, оно выглядит по-разному в каждой системе и в каждом браузере,
// а в части из них его вовсе не открыть с клавиатуры. Поэтому поле
// «насыщенность/яркость» и полоса оттенка рисуются холстом, а любое движение
// мыши здесь повторяется стрелками и полями R, G, B.
import {
  PAINT_PALETTE,
  ROOM_PALETTE,
  colorBlend,
  colorDistance,
  colorFieldToHsv,
  colorHsvToField,
  colorTaken,
  hexToRgb,
  hsvToRgb,
  randomColor,
  rgbToHex,
  rgbToHsv,
} from "../model.js";
import { colorNameHex } from "../colorName.js";
import { getSetting, setSetting } from "../store.js";
import { strings, text } from "../strings.js";
import { uiButton, uiEl, uiModal } from "./ui.js";

const COLOR_FIELD_SIZE = { width: 232, height: 168 };
const COLOR_HUE_HEIGHT = 18;
// Шаг стрелок: мелкий для точной подгонки, крупный с Shift.
const COLOR_STEP = { fine: 0.02, coarse: 0.1, hue: 2, hueCoarse: 12 };
const COLOR_FALLBACK = "#8B949E";
// Плотность заливки контура на белом плане: окно показывает цвет и линией,
// и заливкой — так видно, как он ляжет на схему.
const COLOR_PLAN_ALPHA = 0.12;

// ——— последние цвета (правка без автопилота, 2026-10-25) ———————————————
//
// Слова заказчика: «В выборе цвета под основной палитрой добавь Последние
// используемые цвета, 3 ряда». Ряд — та же сетка, что у палитры: шесть плиток,
// значит в памяти восемнадцать цветов, новый — первым, повтор поднимается
// наверх, а не двоится.
//
// **Списков два**, как и палитр: у контуров и категорий (`plan`) и у краски
// (`paint`). Палитры разведены нарочно — контуры различают насыщенным, стены
// красят светлым, — и общий список снова смешал бы одно с другим.
//
// Живут они **в настройках браузера**, а не в объекте: это память руки, а не
// свойство квартиры (G68 миграции не требует) — как выбор погоды и фона.
// Помнится цвет, выбранный кнопкой «ОК», — то, что ушло в объект.

/** Столбцов в сетке палитры и последних. Повтор в стиле держит `cssMeasures.test.js`. */
export const COLOR_PALETTE_COLUMNS = 6;
/** Рядов последних цветов. */
export const COLOR_RECENT_ROWS = 3;
export const COLOR_RECENT_MAX = COLOR_PALETTE_COLUMNS * COLOR_RECENT_ROWS;
/** Ключ настроек браузера: `{plan: [...], paint: [...]}`. */
export const COLOR_RECENT_SETTING = "colorRecent";
const COLOR_RECENT_KINDS = ["plan", "paint"];

/**
 * Список последних с цветом `color` во главе: код в верхнем регистре, повтор
 * снят, длина не больше `max`. Мусор вместо цвета список не меняет.
 */
export function colorRecentAdd(list, color, max = COLOR_RECENT_MAX) {
  const was = colorRecentOf(list, max);
  const hex = hexToRgb(color) ? String(color).trim().toUpperCase() : null;
  if (!hex) return was;
  return [hex, ...was.filter((item) => item !== hex)].slice(0, max);
}

/** Сохранённый список, приведённый к правилам: коды, без повторов и мусора. */
export function colorRecentOf(saved, max = COLOR_RECENT_MAX) {
  const out = [];
  for (const item of Array.isArray(saved) ? saved : []) {
    const hex = hexToRgb(item) ? String(item).trim().toUpperCase() : null;
    if (hex && !out.includes(hex)) out.push(hex);
    if (out.length >= max) break;
  }
  return out;
}

const colorRecentState = { lists: { plan: [], paint: [] }, loading: null, chosen: false };

function colorRecentKind(kind) {
  return COLOR_RECENT_KINDS.includes(kind) ? kind : "plan";
}

// Поднять списки из настроек — один раз за сеанс. Окно ждёт этого перед тем,
// как открыться: чтение настроек — доли миллисекунды, а окно без последних,
// дорисованных через миг, прыгало бы под рукой.
function colorRecentLoad() {
  if (!colorRecentState.loading) {
    colorRecentState.loading = Promise.resolve(getSetting(COLOR_RECENT_SETTING))
      .then((saved) => {
        if (colorRecentState.chosen || !saved || typeof saved !== "object") return;
        for (const kind of COLOR_RECENT_KINDS) colorRecentState.lists[kind] = colorRecentOf(saved[kind]);
      })
      .catch(() => {});
  }
  return colorRecentState.loading;
}

function colorRecentRemember(kind, color) {
  const key = colorRecentKind(kind);
  const next = colorRecentAdd(colorRecentState.lists[key], color);
  colorRecentState.lists = { ...colorRecentState.lists, [key]: next };
  colorRecentState.chosen = true;
  Promise.resolve(setSetting(COLOR_RECENT_SETTING, colorRecentState.lists)).catch(() => {});
}

function colorHexOf(hsv) {
  return rgbToHex(hsvToRgb(hsv));
}

// Подсказка цвета — одним местом на всё окно и на кнопку. Голый hex человеку
// не говорит ничего: «#164E63» узнаётся только сверкой кодов, а «тёмно-
// бирюзовый» — с первого взгляда. Код при этом остаётся: по нему тот же цвет
// ищут в другом окне и в таблице.
//
// Имя есть у любого цвета, включая заведённый пользователем (`colorName.js`),
// но `colorNameHex` возвращает пустую строку на мусоре вместо кода — тогда
// подсказка остаётся прежней подписью, а не превращается в «Цвет: ».
export function colorLabel(label, value) {
  const named = colorNameHex(value);
  if (!named) return label || "";
  if (!label) return named;
  return text("colorPicker.named", { label, color: named });
}

// Подсказка плитки палитры. Занятость дописывается к имени, а не заменяет его:
// у занятого цвета человеку нужно и то и другое — как он называется и почему
// он помечен. Поэтому и пометка здесь же, а не отдельной веткой у плитки.
export function colorSwatchTitle(color, busy) {
  const named = colorLabel("", color);
  return busy ? text("colorPicker.taken", { color: named }) : named;
}

// Единственная надпись окна, которую видно без наведения мыши. Раньше в ней
// стоял голый hex, и имя цвета жило только в `title` — то есть у человека с
// мышью в руке и нигде больше. Теперь она называет цвет словом и кодом сразу:
// слово читается, код остаётся для того, кто ищет тот же цвет в другом окне.
//
// Ширина окна от длины имени не зависит — надпись стоит своей строкой под
// кружками и растянута по колонке (`colorpick__value` в CSS). Иначе она
// раздвигала бы окно на ходу: «красный» и «светло-фиолетовый (#B07AD1)»
// отличаются вдвое, а курсор по цветовому полю ходит непрерывно.
//
// На мусоре вместо цвета остаётся сам код: пустая строка на этом месте
// смотрелась бы поломкой окна, а не отсутствием имени.
export function colorValueLabel(value) {
  return colorNameHex(value) || String(value || "").trim();
}

// Поле насыщенности и яркости: заливка чистым оттенком, поверх — белый
// градиент слева направо и чёрный сверху вниз. Кружок-курсор рисуется тем же
// холстом: отдельный слой поверх canvas пришлось бы двигать вручную.
function colorDrawField(canvas, hsv) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const { width, height } = canvas;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = colorHexOf({ h: hsv.h, s: 1, v: 1 });
  ctx.fillRect(0, 0, width, height);
  const white = ctx.createLinearGradient(0, 0, width, 0);
  white.addColorStop(0, "rgba(255, 255, 255, 1)");
  white.addColorStop(1, "rgba(255, 255, 255, 0)");
  ctx.fillStyle = white;
  ctx.fillRect(0, 0, width, height);
  const black = ctx.createLinearGradient(0, 0, 0, height);
  black.addColorStop(0, "rgba(0, 0, 0, 0)");
  black.addColorStop(1, "rgba(0, 0, 0, 1)");
  ctx.fillStyle = black;
  ctx.fillRect(0, 0, width, height);

  const place = colorHsvToField(hsv);
  const x = place.x * width;
  const y = place.y * height;
  ctx.lineWidth = 2;
  ctx.strokeStyle = "rgba(0, 0, 0, 0.55)";
  ctx.beginPath();
  ctx.arc(x, y, 7.5, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = "#FFFFFF";
  ctx.beginPath();
  ctx.arc(x, y, 6, 0, Math.PI * 2);
  ctx.stroke();
}

function colorDrawHue(canvas, hsv) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const { width, height } = canvas;
  const rainbow = ctx.createLinearGradient(0, 0, width, 0);
  for (let stop = 0; stop <= 6; stop += 1) {
    rainbow.addColorStop(stop / 6, colorHexOf({ h: stop * 60, s: 1, v: 1 }));
  }
  ctx.fillStyle = rainbow;
  ctx.fillRect(0, 0, width, height);

  const x = (((hsv.h % 360) + 360) % 360) / 360 * width;
  ctx.lineWidth = 2;
  ctx.strokeStyle = "rgba(0, 0, 0, 0.55)";
  ctx.strokeRect(x - 3, 1, 6, height - 2);
  ctx.strokeStyle = "#FFFFFF";
  ctx.strokeRect(x - 2, 2, 4, height - 4);
}

// Мышь, палец и перо — один и тот же обработчик: холст забирает указатель
// себе, поэтому линия ведётся даже когда курсор ушёл за край поля.
function colorDrag(canvas, onPoint) {
  const at = (event) => {
    const box = canvas.getBoundingClientRect();
    onPoint((event.clientX - box.left) / box.width, (event.clientY - box.top) / box.height);
  };
  canvas.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    canvas.setPointerCapture(event.pointerId);
    canvas.focus();
    at(event);
  });
  canvas.addEventListener("pointermove", (event) => {
    if (canvas.hasPointerCapture(event.pointerId)) at(event);
  });
  const release = (event) => {
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  };
  canvas.addEventListener("pointerup", release);
  canvas.addEventListener("pointercancel", release);
}

function colorTakenList(used) {
  return (Array.isArray(used) ? used : []).filter((value) => hexToRgb(value)).map((value) => String(value).trim());
}

// Enter внутри диалога нажимает его основное действие («ОК»), и делает это
// раньше, чем браузер успевает превратить Enter в клик по кнопке под фокусом.
// Поэтому кнопки самого окна обрабатывают Enter сами: выбор цвета с клавиатуры
// не должен заодно закрывать окно, отдав прежний цвет.
function colorEnter(node, run) {
  node.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    run();
  });
  return node;
}

export function openColorPicker(options = {}) {
  return colorRecentLoad().then(() => colorPickerWindow(options));
}

function colorPickerWindow(options) {
  return new Promise((resolve) => {
    const before = hexToRgb(options.color) ? String(options.color).trim().toUpperCase() : COLOR_FALLBACK;
    const taken = colorTakenList(options.used).filter(
      (value) => String(value).toUpperCase() !== before,
    );
    let hsv = rgbToHsv(hexToRgb(before));
    let modal;

    const field = uiEl("canvas", {
      class: "colorpick__field",
      title: strings.colorPicker.field,
      attrs: {
        width: String(COLOR_FIELD_SIZE.width),
        height: String(COLOR_FIELD_SIZE.height),
        tabindex: "0",
        role: "application",
        "aria-label": strings.colorPicker.field,
      },
    });
    const hue = uiEl("canvas", {
      class: "colorpick__hue",
      title: strings.colorPicker.hue,
      attrs: {
        width: String(COLOR_FIELD_SIZE.width),
        height: String(COLOR_HUE_HEIGHT),
        tabindex: "0",
        role: "application",
        "aria-label": strings.colorPicker.hue,
      },
    });
    const chip = uiEl("span", { class: "colorpick__chip" });
    // «Было» называет прежний цвет словом: рядом с новым сразу видно, что
    // меняешь, — а не два кружка, отличие которых надо угадывать.
    const chipBefore = uiEl("span", {
      class: "colorpick__chip colorpick__chip--before",
      title: colorLabel(strings.colorPicker.before, before),
      attrs: { style: "background:" + before },
    });
    const value = uiEl("p", { class: "colorpick__value" });
    const onPlan = uiEl("span", { class: "colorpick__plan", title: strings.colorPicker.onPlan });
    const swatches = uiEl("div", {
      class: "colorpick__palette",
      attrs: { role: "group", "aria-label": strings.colorPicker.palette },
    });
    const recent = uiEl("div", {
      class: "colorpick__palette colorpick__recent",
      title: strings.colorPicker.recentHint,
      attrs: { role: "group", "aria-label": strings.colorPicker.recent },
    });
    const tiles = [];
    const numbers = {};

    function numberField(key, label) {
      const input = uiEl("input", {
        class: "ui-input colorpick__number",
        type: "number",
        attrs: { min: "0", max: "255", step: "1", "aria-label": label },
        on: {
          input: () => {
            const rgb = {
              r: Number(numbers.r.value),
              g: Number(numbers.g.value),
              b: Number(numbers.b.value),
            };
            setColor(rgbToHex(rgb), input);
          },
          blur: () => sync(),
        },
      });
      numbers[key] = input;
      return uiEl("label", { class: "colorpick__number-box" }, [
        uiEl("span", { class: "colorpick__number-label", text: label }),
        input,
      ]);
    }

    // Единственное место, где перерисовывается всё сразу: поле, полоса,
    // превью, числа и отметка в палитре. Поле, в котором сейчас печатают,
    // не трогаем — иначе «12» на пути к «120» прыгало бы обратно.
    function sync(skip) {
      const color = colorHexOf(hsv);
      const rgb = hsvToRgb(hsv);
      colorDrawField(field, hsv);
      colorDrawHue(hue, hsv);
      chip.setAttribute("style", "background:" + color);
      // Кружок нового цвета зовётся так же, как прежний, — иначе «Было»
      // называлось бы словом, а «стало» оставалось кодом.
      chip.title = colorLabel("", color);
      // Так цвет ляжет на белый план: линия контура и заливка помещения.
      onPlan.setAttribute(
        "style",
        "border-color:" + color + ";background:" + colorBlend(color, "#FFFFFF", COLOR_PLAN_ALPHA),
      );
      value.textContent = colorValueLabel(color);
      for (const [key, input] of Object.entries(numbers)) {
        if (input === skip) continue;
        input.value = String(rgb[key]);
      }
      for (const button of tiles) {
        const same = colorDistance(button.dataset.color, color) < 1;
        button.classList.toggle("is-active", same);
        button.setAttribute("aria-pressed", same ? "true" : "false");
      }
    }

    function setHsv(next, skip) {
      // Стрелки и полоса оттенка выезжают за края так же, как мышь, поэтому
      // и приводит их к цвету та же функция, что переводит курсор поля.
      hsv = colorFieldToHsv({ h: next.h, x: next.s, y: 1 - next.v });
      sync(skip);
    }

    function setColor(color, skip) {
      const rgb = hexToRgb(color);
      if (!rgb) return;
      const next = rgbToHsv(rgb);
      // Серый и чёрный не хранят оттенка — иначе ползунок прыгал бы к красному.
      setHsv({ h: next.s === 0 ? hsv.h : next.h, s: next.s, v: next.v }, skip);
    }

    // Палитра — плана, а у краски своя (`PAINT_PALETTE`): стены красят светлым
    // и тёплым, а не цветами, которыми различают контуры.
    // Плитка палитры и плитка последних — одна и та же кнопка.
    const swatchOf = (color) => {
      const busy = colorTaken(color, taken);
      // Плитка называется словом и кодом — и занятая тоже.
      const hint = colorSwatchTitle(color, busy);
      const button = uiEl("button", {
        class: "colorpick__swatch" + (busy ? " is-used" : ""),
        type: "button",
        title: hint,
        attrs: { style: "background:" + color, "aria-label": hint, "aria-pressed": "false" },
        on: { click: () => setColor(color) },
      });
      button.dataset.color = color;
      colorEnter(button, () => setColor(color));
      tiles.push(button);
      return button;
    };
    for (const color of options.palette || ROOM_PALETTE) swatches.append(swatchOf(color));
    // Последние — три ряда всегда: пустые места держат высоту окна, и оно не
    // растёт от того, сколько цветов уже выбирали.
    const recentKind = colorRecentKind(options.recent);
    const used = colorRecentState.lists[recentKind];
    for (let index = 0; index < COLOR_RECENT_MAX; index += 1) {
      recent.append(
        index < used.length
          ? swatchOf(used[index])
          : uiEl("span", { class: "colorpick__swatch is-empty", attrs: { "aria-hidden": "true" } }),
      );
    }

    colorDrag(field, (x, y) => setHsv(colorFieldToHsv({ h: hsv.h, x, y })));
    colorDrag(hue, (x) => setHsv({ h: x * 360, s: hsv.s, v: hsv.v }));

    field.addEventListener("keydown", (event) => {
      const step = event.shiftKey ? COLOR_STEP.coarse : COLOR_STEP.fine;
      const moves = {
        ArrowLeft: { s: -step, v: 0 },
        ArrowRight: { s: step, v: 0 },
        ArrowUp: { s: 0, v: step },
        ArrowDown: { s: 0, v: -step },
      };
      const move = moves[event.key];
      if (!move) return;
      event.preventDefault();
      setHsv({ h: hsv.h, s: hsv.s + move.s, v: hsv.v + move.v });
    });

    hue.addEventListener("keydown", (event) => {
      const step = event.shiftKey ? COLOR_STEP.hueCoarse : COLOR_STEP.hue;
      const moves = { ArrowLeft: -step, ArrowDown: -step, ArrowRight: step, ArrowUp: step };
      const move = moves[event.key];
      if (move == null) return;
      event.preventDefault();
      setHsv({ h: hsv.h + move, s: hsv.s, v: hsv.v });
    });

    const roll = () => setColor(randomColor([...taken, colorHexOf(hsv)]));
    const shuffle = colorEnter(
      uiButton(strings.colorPicker.random, { class: "ui-btn colorpick__random", on: { click: roll } }),
      roll,
    );

    const body = uiEl("div", { class: "colorpick" }, [
      uiEl("div", { class: "colorpick__side" }, [
        uiEl("p", { class: "colorpick__caption", text: strings.colorPicker.palette }),
        swatches,
        uiEl(
          "div",
          { class: "colorpick__recentBox" + (used.length === 0 ? " is-blank" : "") },
          [uiEl("p", { class: "colorpick__caption", text: strings.colorPicker.recent, title: strings.colorPicker.recentHint }), recent],
        ),
      ]),
      uiEl("div", { class: "colorpick__side colorpick__side--custom" }, [
        uiEl("p", { class: "colorpick__caption", text: strings.colorPicker.custom }),
        field,
        hue,
        uiEl("div", { class: "colorpick__bottom" }, [
          // «Как ляжет на план» — только у цвета контура: краска стен на план
          // не ложится вовсе.
          uiEl("div", { class: "colorpick__preview" }, options.planPreview === false ? [chipBefore, chip] : [chipBefore, chip, onPlan]),
          uiEl("div", { class: "colorpick__numbers" }, [
            numberField("r", strings.colorPicker.red),
            numberField("g", strings.colorPicker.green),
            numberField("b", strings.colorPicker.blue),
          ]),
        ]),
        // Имя цвета — отдельной строкой под кружками, а не припиской сбоку:
        // сбоку оно раздвигало бы окно на каждом движении мыши по полю.
        value,
        shuffle,
      ]),
    ]);

    const done = (result) => {
      modal.close();
      if (result) colorRecentRemember(recentKind, result);
      resolve(result);
    };
    modal = uiModal({
      title: options.title || strings.colorPicker.title,
      body,
      actions: [
        uiButton(strings.dialog.cancel, { on: { click: () => done(null) } }),
        uiButton(strings.colorPicker.apply, {
          class: "ui-btn ui-btn--accent",
          on: { click: () => done(colorHexOf(hsv)) },
        }),
      ],
      dismissable: true,
      onCancel: () => resolve(null),
    });
    // Ширину задаёт содержимое — палитра и поле оттенка: общая мера диалогов
    // оставляла справа пустое поле. Та же мера, что у сеток формы и начертания.
    if (modal.card) modal.card.classList.add("modal--fit");
    sync();
    field.focus();
  });
}

// Кнопка цвета в строке справочника или помещения: показывает текущий цвет
// и открывает окно выбора. Никаких `<input type="color">` в сборке больше нет.
//
// Подсказка называет не только назначение кнопки, но и сам цвет — «Цвет
// категории: пурпурный (#E80098)»: цветного квадратика хватает, чтобы отличить
// две строки друг от друга, и не хватает, чтобы назвать цвет вслух или найти
// тот же в другом окне. Кнопка от этого не растёт: подсказка живёт в `title`,
// а ширину квадратику задаёт CSS.
export function colorPickerButton({ value, used, title, dialogTitle, onPick }) {
  const label = title || strings.colorPicker.title;
  let color = value;
  const hint = () => colorLabel(label, color);
  const button = uiEl("button", {
    class: "colorpick__button",
    type: "button",
    title: hint(),
    attrs: { style: "background:" + (color || COLOR_FALLBACK), "aria-label": hint() },
    on: {
      click: async () => {
        const picked = await openColorPicker({ color, used, title: dialogTitle || title });
        if (!picked) return;
        color = picked;
        button.setAttribute("style", "background:" + picked);
        // Имя в подсказке держится выбранного цвета: кнопку после выбора никто
        // не перестраивает, и без этой строки она называла бы прежний.
        button.title = hint();
        button.setAttribute("aria-label", button.title);
        onPick(picked);
      },
    },
  });
  return button;
}

// ——— поле краски (правка без автопилота, 2026-10-25) ————————————————————
//
// Краска стены, пола и потолка — не цвет контура: у неё есть «не крашено», и
// это не цвет, а отсутствие ключа (`wall.paint`, `room.paint` в модели).
// Поэтому у поля две кнопки: квадратик цвета, открывающий окно с палитрой
// краски, и «Снять», которая возвращает краску сборки. Некрашеное показывает
// цвет, которым «Объём» нарисует поверхность сам (`fallback`), — пунктирной
// рамкой: так видно, что его не выбирали. «Разные» — у кнопки на все стены
// помещения, когда стороны крашены порознь.
//
// Поле не перестраивается на каждую перерисовку колонки: значение ему ставит
// `set`, а выбор уходит наружу через `onPick` (`null` — снять). Подпись `set`
// меняет тоже: у стороны стены она называет помещение за ней.
export function colorPaintField({ label, fallback, onPick }) {
  let value = null;
  let mixed = false;
  const swatch = uiEl("button", {
    class: "colorpick__button colorpick__paint",
    type: "button",
    on: {
      click: async () => {
        const picked = await openColorPicker({
          color: value || fallback,
          title: text("paint.dialog", { label }),
          palette: PAINT_PALETTE,
          planPreview: false,
          recent: "paint",
        });
        if (picked) onPick(picked);
      },
    },
  });
  const clear = uiButton(strings.paint.clear, {
    class: "ui-btn colorpick__clear",
    title: text("paint.clearHint", { label }),
    on: { click: () => onPick(null) },
  });
  const node = uiEl("span", { class: "colorpick__paintField" }, [swatch, clear]);
  function set(next, options = {}) {
    if (options.label) label = options.label;
    value = next || null;
    mixed = Boolean(options.mixed);
    swatch.classList.toggle("is-unset", !value && !mixed);
    swatch.classList.toggle("is-mixed", mixed);
    swatch.setAttribute("style", "background:" + (value || fallback));
    const hint = mixed
      ? text("paint.mixed", { label })
      : value
        ? colorLabel(label, value)
        : text("paint.unset", { label });
    swatch.title = hint;
    swatch.setAttribute("aria-label", hint);
    clear.hidden = !value && !mixed;
    clear.title = text("paint.clearHint", { label });
    swatch.disabled = Boolean(options.disabled);
    clear.disabled = Boolean(options.disabled);
  }
  set(null);
  return { node, set };
}

