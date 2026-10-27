// Окошко климата у полосы часов (правка после сборки сценариев).
//
// Слова заказчика: «при тапе на плашке с текущей температурой, влажностью и
// co2 открывай небольшое окошко с ползунками этих 3 характеристик».
//
// Плашка — строка климата под часами: она говорит про то место, где стоит
// человек от первого лица (`syncAir` в `volume.js`). Окошко говорит про то же
// место и пишет туда же, куда раздел «Климат помещений» в параметрах
// (`simClimateSet`): второго пути задать помещению воздух в сборке нет. На
// улице CO₂ у плашки нет, и ползунков два — температура и влажность улицы.
// Это ручные значения погоды (`appWeatherSet`), те же, что поля «Улица» в
// параметрах: они держатся, пока их не вернут погоде кнопкой «Как по погоде».
//
// Окошко **не модальное**: ради него и заведено, чтобы двигать ползунок и
// смотреть, как дом отвечает. Человек ходит — окошко идёт с ним: перешёл в
// другое помещение, и ползунки уже его. Ползунок, который ведут, живым
// значением не переписывается, а только что отпущенный — недолго ещё ждёт,
// пока дом пришлёт новое значение: иначе на кадр он прыгнул бы назад.
//
// **Время — в том же окошке** (правка 2026-10-27): «при клике по плашке с
// временем и климатом уже открывается ввод климата, так же там сделай
// изменение времени, но компактно». Строка часов тоже кнопка, и обе строки
// открывают одно окошко: сверху ряд часов (поле времени и «Сейчас»), под ним
// ползунки климата — если дом идёт и климат есть. Без климата окошко
// говорит только про время. Ряд пишет туда же, куда поле «Своё время» в
// параметрах (`volumeParamsFix`, `volumeParamsNow`): второго пути перевести
// часы в сборке нет. Дата в окошко не вошла нарочно: «компактно» — это одна
// строка, а дата с часами в 264 точки одной строкой не ложатся.
import { volumeClockParse, volumeClockText } from "../clockMath.js";
import { strings, text } from "../strings.js";
import { uiButton, uiEl, uiIconButton, uiTimeApply } from "./ui.js";
import { volumeAirLine, volumeTempText } from "./volumeParams.js";

/**
 * Пределы ползунков. Температура помещения — 0…40 °C: шире ползунок стал бы
 * грубым, а холоднее или жарче помещение бывает редко — тогда предел
 * раздвигается до значения (`volumeAirRows`). CO₂ и улица — те же пределы,
 * что у полей в параметрах.
 */
export const VOLUME_AIR_RANGES = Object.freeze({
  t: Object.freeze({ min: 0, max: 40, step: 0.5 }),
  rh: Object.freeze({ min: 0, max: 100, step: 1 }),
  co2: Object.freeze({ min: 400, max: 5000, step: 10 }),
  tempC: Object.freeze({ min: -50, max: 50, step: 0.5 }),
  humidity: Object.freeze({ min: 0, max: 100, step: 1 }),
});

/** Сколько отпущенный ползунок не слушает живое значение, мс. */
export const VOLUME_AIR_SETTLE_MS = 600;

const VOLUME_AIR_UNITS = { t: "°C", rh: "%", co2: "ppm", tempC: "°C", humidity: "%" };

/** Значение для строки окошка: «+22,4 °C», «45 %», «650 ppm». */
export function volumeAirValueText(key, value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  const body = key === "t" || key === "tempC" ? volumeTempText(number) : String(Math.round(number));
  return body + " " + VOLUME_AIR_UNITS[key];
}

/** Ключ места: окошко пересобирает ряды, только когда место сменилось. */
export function volumeAirPlaceKey(place) {
  if (!place) return "";
  return place.kind === "room" ? "room:" + place.roomId : "street";
}

/**
 * Ряды окошка по месту: `[{key, label, min, max, step, value, text}]`.
 *
 * Место — `{kind: "room", roomId, name, t, rh, co2}` или `{kind: "street",
 * tempC, humidity}`; места нет — рядов нет.
 */
export function volumeAirRows(place) {
  if (!place) return [];
  const keys = place.kind === "room" ? ["t", "rh", "co2"] : ["tempC", "humidity"];
  const labels = {
    t: strings.volume.climateTemp,
    rh: strings.volume.climateHumidity,
    co2: strings.volume.climateCo2,
    tempC: strings.volume.climateTemp,
    humidity: strings.volume.climateHumidity,
  };
  return keys.map((key) => {
    const range = VOLUME_AIR_RANGES[key];
    const value = Number(place[key]);
    const known = Number.isFinite(value);
    return {
      key,
      label: labels[key],
      min: known ? Math.min(range.min, Math.floor(value)) : range.min,
      max: known ? Math.max(range.max, Math.ceil(value)) : range.max,
      step: range.step,
      value: known ? value : null,
      text: volumeAirValueText(key, value),
    };
  });
}

/**
 * Где встать окошку: `{side, top, maxHeight}`. `field` и `strip` —
 * прямоугольники поля и полосы часов (`top`, `bottom`), `height` — сколько
 * окошко хочет в высоту.
 *
 * Над полосой — если там помещается. Иначе — слева от полосы, низом по её
 * низу, но не выше поля: пальцем полоса поднята над кнопками, и в лежачем
 * телефоне над ней остаётся строк на одну. `top` — от верха полосы (окошко
 * лежит в ней), `maxHeight` — только когда и поля не хватает: тогда ряды
 * прокручиваются.
 */
export function volumeAirPlacement(field, strip, height, gap = 8) {
  const above = strip.top - field.top - gap * 2;
  if (height <= above) return { side: false, top: null, maxHeight: null };
  const room = Math.max(0, field.bottom - field.top - gap * 2);
  const tall = Math.min(height, room);
  const top = Math.max(field.top + gap, Math.min(strip.bottom, field.bottom - gap) - tall);
  return { side: true, top: Math.round(top - strip.top), maxHeight: room < height ? Math.floor(room) : null };
}

/** Строка на плашке: у помещения с CO₂, у улицы без него. */
export function volumeAirSaid(place) {
  if (!place) return "";
  if (place.kind === "room") return volumeAirLine(place.t, place.rh, place.co2);
  return volumeAirLine(place.tempC, place.humidity, null);
}

/**
 * Строки часов и климата и окошко за ними: `{timeLine, line, box, sync, open,
 * close, isOpen}`.
 *
 * `timeLine` — кнопка-строка часов (текст ей пишет поле), `line` — кнопка-строка
 * климата, `box` — окошко; все три поле ставит в полосу часов. `sync(place)`
 * поле зовёт на каждый кадр и на каждый шаг климата — пишется только то, что
 * изменилось. Двери: `setRoom(roomId, patch)`, `setStreet(patch)`, `clock:
 * {minutes(), set(minutes), now()}` — часы поля, `now()` для тестов.
 */
export function createVolumeAir(doors = {}) {
  const now = typeof doors.now === "function" ? doors.now : () => Date.now();
  const clock = doors.clock || null;
  const toggle = () => (opened ? close() : open());
  const timeLine = uiEl("button", {
    class: "volume__clockTime",
    type: "button",
    attrs: { "aria-haspopup": "dialog", "aria-expanded": "false" },
    on: { click: toggle },
  });
  const line = uiEl("button", {
    class: "volume__clockAir",
    type: "button",
    attrs: { hidden: "hidden", "aria-haspopup": "dialog", "aria-expanded": "false" },
    on: { click: toggle },
  });
  const title = uiEl("span", { class: "volume__airTitle" });
  const timeField = uiEl("input", {
    class: "tools__time volume__airTime",
    type: "time",
    title: strings.volume.clockOwnHint,
    attrs: { "aria-label": strings.volume.clockOwn },
  });
  uiTimeApply(timeField, () => {
    const own = volumeClockParse(timeField.value);
    if (own !== null && clock) clock.set(own);
  });
  const nowButton = uiButton(strings.volume.clockNow, {
    class: "ui-btn volume__airNow",
    title: strings.volume.clockNowHint,
    on: { click: () => clock && clock.now() },
  });
  const clockRow = uiEl("div", { class: "volume__airClock" }, [timeField, nowButton]);
  const closeButton = uiIconButton("close", {
    class: "ui-btn volume__airClose",
    label: strings.volume.airClose,
    on: { click: () => close(true) },
  });
  const rowsNode = uiEl("div", { class: "volume__airRows" });
  const autoButton = uiButton(strings.volume.airAuto, {
    class: "ui-btn volume__airAuto",
    title: strings.volume.airAutoHint,
    on: { click: () => send({ tempC: null, humidity: null }) },
  });
  // `title` пустой нарочно: окошко лежит в полосе часов, и без своей пустой
  // подсказки над ползунками всплывала бы подсказка полосы — про ход времени.
  const box = uiEl(
    "div",
    {
      class: "volume__airBox",
      attrs: { hidden: "hidden", role: "dialog", title: "" },
      on: {
        keydown: (event) => {
          if (event.key !== "Escape") return;
          event.preventDefault();
          event.stopPropagation();
          close(true);
        },
      },
    },
    [uiEl("div", { class: "volume__airHead" }, [title, closeButton]), clockRow, rowsNode, autoButton],
  );

  let place = null;
  let said = null;
  let opened = false;
  let shownKey = null;
  // Ряды окошка: `key → {input, value, row}`.
  const rows = new Map();
  // Какой ползунок ведут и до какого мига отпущенный ждёт ответа дома.
  let held = null;
  const settle = new Map();

  function send(patch) {
    if (!place) return;
    if (place.kind === "room") {
      if (typeof doors.setRoom === "function") doors.setRoom(place.roomId, patch);
    } else if (typeof doors.setStreet === "function") {
      doors.setStreet(patch);
    }
  }

  function rowNode(row) {
    const value = uiEl("span", { class: "volume__airValue", text: row.text });
    const input = uiEl("input", {
      class: "volume__airSlider",
      type: "range",
      attrs: { min: String(row.min), max: String(row.max), step: String(row.step), "aria-label": row.label },
      on: {
        input: () => {
          held = row.key;
          value.textContent = volumeAirValueText(row.key, Number(input.value));
        },
        change: () => {
          held = null;
          settle.set(row.key, now() + VOLUME_AIR_SETTLE_MS);
          send({ [row.key]: Number(input.value) });
        },
      },
    });
    input.value = String(row.value ?? row.min);
    rows.set(row.key, { input, value });
    return uiEl("label", { class: "volume__airRow" }, [
      uiEl("span", { class: "volume__airName", text: row.label }),
      value,
      input,
    ]);
  }

  function rebuild() {
    rows.clear();
    held = null;
    settle.clear();
    shownKey = volumeAirPlaceKey(place);
    if (!place) {
      title.textContent = strings.volume.airTime;
      box.setAttribute("aria-label", strings.volume.airTime);
      rowsNode.replaceChildren();
      rowsNode.title = "";
      return;
    }
    const name = place.kind === "room" ? place.name || strings.volume.climateRoomUnnamed : strings.volume.airStreet;
    title.textContent = name;
    box.setAttribute("aria-label", text("volume.airTitle", { name }));
    rowsNode.replaceChildren(...volumeAirRows(place).map(rowNode));
    rowsNode.title = place.kind === "room" ? "" : strings.volume.airStreetHint;
  }

  // Поле часов идёт за временем, пока в нём не набирают: под фокусом его
  // держит человек.
  function refreshClock() {
    if (!clock) return;
    const focused = typeof document !== "undefined" && document.activeElement === timeField;
    if (focused) return;
    const minutes = clock.minutes();
    const value = Number.isFinite(minutes) ? volumeClockText(minutes) : "";
    if (timeField.value !== value) timeField.value = value;
  }

  function refresh() {
    refreshClock();
    if (!place) {
      if (!autoButton.hidden) autoButton.hidden = true;
      return;
    }
    const at = now();
    for (const row of volumeAirRows(place)) {
      const own = rows.get(row.key);
      if (!own || held === row.key) continue;
      if ((settle.get(row.key) || 0) > at) continue;
      settle.delete(row.key);
      const min = String(row.min);
      const max = String(row.max);
      if (own.input.getAttribute("min") !== min) own.input.setAttribute("min", min);
      if (own.input.getAttribute("max") !== max) own.input.setAttribute("max", max);
      const value = String(row.value ?? row.min);
      if (own.input.value !== value) own.input.value = value;
      if (own.value.textContent !== row.text) own.value.textContent = row.text;
    }
    // Своё значение улицы есть — есть и дорога назад, к погоде.
    const manual = place.kind === "street" && (place.manualTemp === true || place.manualHumidity === true);
    if (autoButton.hidden === manual) autoButton.hidden = !manual;
  }

  function open() {
    if (opened) return;
    opened = true;
    line.setAttribute("aria-expanded", "true");
    timeLine.setAttribute("aria-expanded", "true");
    box.hidden = false;
    rebuild();
    refresh();
    if (typeof doors.placed === "function") doors.placed(box);
  }

  /** Закрыть; `focusLine` — вернуть фокус строке (закрыли клавишей или крестиком). */
  function close(focusLine = false) {
    if (!opened) return;
    opened = false;
    shownKey = null;
    rows.clear();
    held = null;
    settle.clear();
    line.setAttribute("aria-expanded", "false");
    timeLine.setAttribute("aria-expanded", "false");
    box.hidden = true;
    const back = line.hidden ? timeLine : line;
    if (focusLine && typeof back.focus === "function") back.focus({ preventScroll: true });
  }

  function sync(next) {
    place = next || null;
    const words = volumeAirSaid(place);
    if (words !== said) {
      said = words;
      line.textContent = words;
      line.hidden = words === "";
      line.title = !place ? "" : place.kind === "room" ? strings.volume.airOpen : strings.volume.airOpenStreet;
    }
    if (!opened) return;
    // Климата нет — человек ушёл в обзор или дом остановили, — и окошко
    // остаётся про одно время.
    if (volumeAirPlaceKey(place) !== shownKey) rebuild();
    refresh();
    if (typeof doors.placed === "function") doors.placed(box);
  }

  return {
    timeLine,
    line,
    box,
    sync,
    open,
    close,
    isOpen: () => opened,
  };
}
