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
  COLOR_SAME_DISTANCE,
  ROOM_PALETTE,
  colorDistance,
  hexToRgb,
  hsvToRgb,
  randomColor,
  rgbToHex,
  rgbToHsv,
} from "../model.js";
import { strings } from "../strings.js";
import { uiButton, uiEl, uiModal } from "./ui.js";

const COLOR_FIELD_SIZE = { width: 232, height: 168 };
const COLOR_HUE_HEIGHT = 18;
// Шаг стрелок: мелкий для точной подгонки, крупный с Shift.
const COLOR_STEP = { fine: 0.02, coarse: 0.1, hue: 2, hueCoarse: 12 };
const COLOR_FALLBACK = "#8B949E";

function colorClamp(value) {
  return Math.min(1, Math.max(0, value));
}

function colorHexOf(hsv) {
  return rgbToHex(hsvToRgb(hsv));
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

  const x = colorClamp(hsv.s) * width;
  const y = (1 - colorClamp(hsv.v)) * height;
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
    onPoint(colorClamp((event.clientX - box.left) / box.width), colorClamp((event.clientY - box.top) / box.height));
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

// Занят ли цвет: не побайтно, а на глаз — иначе «почти тот же» цвет соседней
// комнаты выглядел бы свободным.
function colorIsTaken(color, taken) {
  return taken.some((other) => colorDistance(color, other) < COLOR_SAME_DISTANCE);
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
    const chipBefore = uiEl("span", {
      class: "colorpick__chip colorpick__chip--before",
      title: strings.colorPicker.before,
      attrs: { style: "background:" + before },
    });
    const value = uiEl("span", { class: "colorpick__value" });
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
      chip.title = color;
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
      hsv = { h: (((next.h % 360) + 360) % 360), s: colorClamp(next.s), v: colorClamp(next.v) };
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
      const busy = colorIsTaken(color, taken);
      const button = uiEl("button", {
        class: "colorpick__swatch" + (busy ? " is-used" : ""),
        type: "button",
        title: busy ? color + " — " + strings.colorPicker.used : color,
        attrs: { style: "background:" + color, "aria-label": color, "aria-pressed": "false" },
        on: { click: () => setColor(color) },
      });
      button.dataset.color = color;
      colorEnter(button, () => setColor(color));
      swatches.append(button);
    }

    colorDrag(field, (x, y) => setHsv({ h: hsv.h, s: x, v: 1 - y }));
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
          uiEl("div", { class: "colorpick__preview" }, [chipBefore, chip, value]),
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
    sync();
    field.focus();
  });
}

// Кнопка цвета в строке справочника или помещения: показывает текущий цвет
// и открывает окно выбора. Никаких `<input type="color">` в сборке больше нет.
export function colorPickerButton({ value, used, title, dialogTitle, onPick }) {
  const button = uiEl("button", {
    class: "colorpick__button",
    type: "button",
    title: title || strings.colorPicker.title,
    attrs: { style: "background:" + (value || COLOR_FALLBACK), "aria-label": title || strings.colorPicker.title },
    on: {
      click: async () => {
        const picked = await openColorPicker({ color: value, used, title: dialogTitle || title });
        if (!picked) return;
        button.setAttribute("style", "background:" + picked);
        onPick(picked);
      },
    },
  });
  return button;
}
