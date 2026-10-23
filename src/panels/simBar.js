// Полоса запуска и часов имитации в «Схеме» (таск 08 сценариев; истории 2.1,
// 2.3, 2.15, 2.19, 3.1–3.3, 3.6).
//
// Слева направо: «Запустить дом» / «Остановить», «Сбросить дом», «Выполнить
// команду»; дальше часы — дата, время, ускорение, пауза, «Сейчас», шаги
// «+1 мин / +10 мин / +1 ч» и «К следующему событию». Часы — **одни на всё
// приложение** (`appClock.js`): что переведено здесь, видно в «Объёме» и
// слышат сценарии. Пока дом остановлен, полоса — одна кнопка запуска: часам
// «Схемы» там делать нечего, их ведёт «Объём».
//
// Клавиши (только в «Схеме», при запущенном доме, вне полей и диалогов):
// `P` — пауза, `N` — «К следующему событию», `E` — нажать на выделенное
// устройство. Правило — чистая `simBarKeyAction`.
import { PANEL_IDS, registerPanel, screenMode } from "../app.js";
import {
  appClockDay,
  appClockJump,
  appClockPause,
  appClockRead,
  appClockRealNow,
  appClockSimMs,
  appClockSpeed,
  appClockWatch,
} from "../appClock.js";
import {
  VOLUME_CLOCK_SPEEDS,
  clockDayMs,
  clockMsStamp,
  volumeClockParse,
  volumeClockSpeedOf,
  volumeDateParse,
  volumeDateText,
} from "../clockMath.js";
import {
  simCommand,
  simCommands,
  simInPage,
  simNextAt,
  simNextEvent,
  simReset,
  simRunning,
  simStart,
  simStep,
  simStop,
  simWatch,
} from "../simulation.js";
import { strings, text } from "../strings.js";
import { deviceClickMark } from "./deviceCard.js";
import { volumeSpeedLabel } from "./volumeParams.js";
import { uiButton, uiDialogDepth, uiEl, uiFieldTarget, uiModal, uiTypingTarget } from "./ui.js";

/** Шаги часов: ключ подписи в `strings.sim.bar` и длина шага в мс. */
export const SIM_BAR_STEPS = Object.freeze([
  Object.freeze({ key: "step1m", ms: 60000 }),
  Object.freeze({ key: "step10m", ms: 600000 }),
  Object.freeze({ key: "step1h", ms: 3600000 }),
]);

function simBarPad(value, size = 2) {
  return String(value).padStart(size, "0");
}

/**
 * Время имитации (местные миллисекунды) человеку: `{day, date, time}` —
 * номер суток, «20.10.2026» и «21:05:09». Читается по `getUTC*`: поясов во
 * времени имитации нет.
 */
export function simBarClockText(simMs) {
  const at = new Date(Number.isFinite(simMs) ? simMs : 0);
  return {
    day: clockMsStamp(simMs).day,
    date: simBarPad(at.getUTCDate()) + "." + simBarPad(at.getUTCMonth() + 1) + "." + simBarPad(at.getUTCFullYear(), 4),
    time: simBarPad(at.getUTCHours()) + ":" + simBarPad(at.getUTCMinutes()) + ":" + simBarPad(at.getUTCSeconds()),
  };
}

/**
 * Что показывает полоса: `{running, paused, speed, next, nextTitle, steps}`.
 * `read` — `{running, clock, speed, nextAt}`; `next` — кнопка «К следующему
 * событию» доступна, `nextTitle` — её подсказка («Ничего не запланировано»
 * или время события).
 */
export function simBarState(read) {
  const source = read || {};
  const nextAt = Number.isFinite(source.nextAt) ? source.nextAt : null;
  return {
    running: source.running === true,
    paused: Boolean(source.clock && source.clock.fixed),
    speed: volumeClockSpeedOf(source.speed),
    next: nextAt !== null,
    nextTitle:
      nextAt === null
        ? strings.sim.bar.nextNone
        : text("sim.bar.nextAt", { at: simBarClockText(nextAt).date + " " + simBarClockText(nextAt).time }),
    steps: SIM_BAR_STEPS.map((step) => ({ key: step.key, ms: step.ms })),
  };
}

/**
 * Что делает клавиша полосы и пульта: `"pause"` (P), `"next"` (N), `"press"`
 * (E) или `null`. Клавиатура принадлежит диалогу и полю ввода: при открытом
 * диалоге, в поле, вне «Схемы», при остановленном доме и с Ctrl/Alt/Cmd —
 * молчим. `ctx`: `{dialog, onScheme, running, field}`.
 */
export function simBarKeyAction(event, ctx) {
  if (!event || !ctx) return null;
  if (ctx.dialog || ctx.field || !ctx.onScheme || !ctx.running) return null;
  if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return null;
  if (event.code === "KeyP") return "pause";
  if (event.code === "KeyN") return "next";
  if (event.code === "KeyE") return "press";
  return null;
}

/**
 * Список «Выполнить команду»: команды сценариев объекта (`simCommands`) с
 * пометкой «сценарий не активен». Пустой — в объекте нет условий «Команда».
 */
export function simBarCommandItems(project) {
  return simCommands(project).map((item) => ({
    text: item.text,
    inactive: item.active === false,
    label: item.active === false ? item.text + " — " + strings.sim.command.inactive : item.text,
  }));
}

// Дата из поля ввода и время из текста → время имитации; `null` — не разобрано.
function simBarCompose(dateText, timeText, fallback) {
  const day = dateText ? volumeDateParse(dateText) : clockMsStamp(fallback).day;
  const minutes = timeText ? volumeClockParse(timeText) : null;
  if (day === null) return null;
  const rest = clockMsStamp(fallback).minutes;
  return clockDayMs(day) + (minutes === null ? rest : minutes) * 60000;
}

/** Диалог «Выполнить команду»: список команд и «своя команда». */
export function openSimCommands(api) {
  const state = api.getState();
  const items = state.project ? simBarCommandItems(state.project) : [];
  let modal = null;
  const send = (said) => {
    const value = String(said || "").trim();
    if (!value) return;
    const heard = simCommand(value);
    if (!heard && !simRunning()) api.notify(strings.sim.command.notRunning, "error");
    modal.close();
  };
  const list =
    items.length === 0
      ? uiEl("p", { class: "modal__text sim-command__empty", text: strings.sim.command.empty })
      : uiEl(
          "div",
          { class: "sim-command__list" },
          items.map((item) =>
            uiButton(item.label, {
              class: "ui-btn sim-command__item" + (item.inactive ? " is-inactive" : ""),
              on: { click: () => send(item.text) },
            }),
          ),
        );
  const field = uiEl("input", {
    class: "ui-input sim-command__field",
    type: "text",
    placeholder: strings.sim.command.ownPlaceholder,
    attrs: { "aria-label": strings.sim.command.own },
    on: {
      keydown: (event) => {
        if (event.key !== "Enter") return;
        // Enter набирает команду, а не нажимает основную кнопку окна второй раз.
        event.preventDefault();
        send(event.target.value);
      },
    },
  });
  const run = uiButton(strings.sim.command.run, { class: "ui-btn ui-btn--primary", on: { click: () => send(field.value) } });
  modal = uiModal({
    title: strings.sim.command.title,
    body: [
      uiEl("p", { class: "tools__label", text: strings.sim.command.pick }),
      list,
      uiEl("p", { class: "tools__label", text: strings.sim.command.own }),
      uiEl("div", { class: "sim-command__own" }, [field, run]),
    ],
    actions: [uiButton(strings.sim.command.cancel, { on: { click: () => modal.close() } })],
    primary: run,
  });
  return modal;
}

function mountSimBar(host, api) {
  host.classList.add("sim-bar");
  const start = uiButton("", { class: "ui-btn sim-bar__start", on: { click: () => (simRunning() ? simStop() : simStart()) } });
  const status = uiEl("span", { class: "sim-bar__status" });
  const warn = uiEl("span", { class: "sim-bar__warn", text: strings.sim.bar.noWorker });
  const reset = uiButton(strings.sim.bar.reset, { class: "ui-btn", title: strings.sim.bar.resetHint, on: { click: () => simReset() } });
  const command = uiButton(strings.sim.bar.command, {
    class: "ui-btn",
    title: strings.sim.bar.commandHint,
    on: { click: () => openSimCommands(api) },
  });

  const dateField = uiEl("input", {
    class: "ui-input sim-bar__date",
    type: "date",
    title: strings.sim.bar.dateHint,
    attrs: { "aria-label": strings.sim.bar.date },
    on: {
      change: (event) => {
        const day = volumeDateParse(event.target.value);
        if (day !== null) appClockDay(day);
      },
    },
  });
  const timeField = uiEl("input", {
    class: "ui-input sim-bar__time",
    type: "text",
    title: strings.sim.bar.timeHint,
    attrs: { "aria-label": strings.sim.bar.time, size: "8", spellcheck: "false" },
    on: {
      change: (event) => {
        const now = appClockSimMs();
        const target = simBarCompose(dateField.value, event.target.value, now);
        if (target !== null && volumeClockParse(event.target.value) !== null) appClockJump(target);
        update();
      },
      keydown: (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          event.target.blur();
        }
      },
    },
  });
  const speed = uiEl(
    "select",
    {
      class: "ui-select sim-bar__speed",
      title: strings.sim.bar.speedHint,
      attrs: { "aria-label": strings.sim.bar.speed },
      on: { change: (event) => appClockSpeed(Number(event.target.value)) },
    },
    VOLUME_CLOCK_SPEEDS.map((value) => uiEl("option", { text: volumeSpeedLabel(value), attrs: { value: String(value) } })),
  );
  const pause = uiButton("", { class: "ui-btn", on: { click: () => togglePause() } });
  const now = uiButton(strings.sim.bar.now, { class: "ui-btn", title: strings.sim.bar.nowHint, on: { click: () => appClockRealNow() } });
  const steps = SIM_BAR_STEPS.map((step) =>
    uiButton(strings.sim.bar[step.key], { class: "ui-btn", title: strings.sim.bar.stepHint, on: { click: () => simStep(step.ms) } }),
  );
  const next = uiButton(strings.sim.bar.next, { class: "ui-btn", on: { click: () => simNextEvent() } });

  const clock = uiEl("div", { class: "sim-bar__group sim-bar__clock" }, [dateField, timeField, speed, pause, now, ...steps, next]);
  const row = uiEl("div", { class: "sim-bar__row" }, [start, status, warn, reset, command]);
  host.replaceChildren(row, clock);

  function togglePause() {
    const read = appClockRead();
    appClockPause(!(read.clock && read.clock.fixed));
  }

  function update() {
    const state = api.getState();
    const visible = Boolean(state.schemeId) && state.screen === "scheme";
    host.hidden = !visible;
    if (!visible) return;
    const running = simRunning();
    const view = simBarState({ running, clock: appClockRead().clock, speed: appClockRead().speed, nextAt: simNextAt() });
    start.textContent = running ? strings.sim.bar.stop : strings.sim.bar.start;
    start.title = running ? strings.sim.bar.stopHint : strings.sim.bar.startHint;
    start.classList.toggle("ui-btn--primary", !running);
    status.textContent = running ? strings.sim.bar.running : strings.sim.bar.stopped;
    status.classList.toggle("is-running", running);
    warn.hidden = !(running && simInPage());
    reset.hidden = !running;
    command.hidden = !running;
    clock.hidden = !running;
    host.classList.toggle("is-running", running);
    if (!running) return;
    const shown = appClockSimMs();
    const parts = simBarClockText(shown);
    // Поле, в котором сейчас курсор, не перезаписывается — человек набирает.
    const active = typeof document !== "undefined" ? document.activeElement : null;
    if (active !== dateField) dateField.value = volumeDateText(parts.day);
    if (active !== timeField) timeField.value = parts.time;
    if (active !== speed) speed.value = String(view.speed);
    pause.textContent = view.paused ? strings.sim.bar.resume : strings.sim.bar.pause;
    pause.title = view.paused ? strings.sim.bar.resumeHint : strings.sim.bar.pauseHint;
    pause.classList.toggle("is-on", view.paused);
    next.disabled = !view.next;
    next.title = view.next ? strings.sim.bar.nextHint + ". " + view.nextTitle : strings.sim.bar.nextNone;
  }

  api.subscribe((state, changed) => {
    if ("schemeId" in changed || "screen" in changed || "simRunning" in changed || "project" in changed) update();
  });
  simWatch(() => update());
  appClockWatch(() => update());
  // Время идёт само, а в уведомлениях его хода нет: бегущие часы обновляются
  // по таймеру, пока полоса на виду.
  if (typeof setInterval === "function") setInterval(() => {
    if (!host.hidden && simRunning()) update();
  }, 250);

  // Клавиши полосы и пульта: P, N, E — по физической клавише, раскладка не важна.
  if (typeof document !== "undefined") {
    document.addEventListener("keydown", (event) => {
      const state = api.getState();
      const action = simBarKeyAction(event, {
        dialog: uiDialogDepth() > 0,
        onScheme: screenMode() === "scheme" && Boolean(state.schemeId),
        running: simRunning(),
        field: uiTypingTarget(event.target) || uiFieldTarget(event.target),
      });
      if (!action) return;
      if (action === "pause") togglePause();
      else if (action === "next") simNextEvent();
      else if (action === "press" && state.selectedMarkIds.length === 1) deviceClickMark(state.project, state.selectedMarkIds[0]);
      else return;
      event.preventDefault();
    });
  }
  update();
}

registerPanel(PANEL_IDS.simBar, mountSimBar);
