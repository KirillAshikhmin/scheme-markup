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
    const value = uiEl("span", { class: "colorpick__value" });
    const onPlan = uiEl("span", { class: "colorpick__plan", title: strings.colorPicker.onPlan });
    const swatches = uiEl("div", {
      class: "colorpick__palette",
      attrs: { role: "group", "aria-label": strings.colorPicker.palette },
    });
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
      value.textContent = color;
      for (const [key, input] of Object.entries(numbers)) {
        if (input === skip) continue;
        input.value = String(rgb[key]);
      }
      for (const button of swatches.children) {
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

    for (const color of ROOM_PALETTE) {
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
      swatches.append(button);
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
      ]),
      uiEl("div", { class: "colorpick__side colorpick__side--custom" }, [
        uiEl("p", { class: "colorpick__caption", text: strings.colorPicker.custom }),
        field,
        hue,
        uiEl("div", { class: "colorpick__bottom" }, [
          uiEl("div", { class: "colorpick__preview" }, [chipBefore, chip, onPlan, value]),
          uiEl("div", { class: "colorpick__numbers" }, [
            numberField("r", strings.colorPicker.red),
            numberField("g", strings.colorPicker.green),
            numberField("b", strings.colorPicker.blue),
          ]),
        ]),
        shuffle,
      ]),
    ]);

    const done = (result) => {
      modal.close();
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
