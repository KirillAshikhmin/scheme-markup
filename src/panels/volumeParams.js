// Окно параметров объёма: фон, время суток и миникарта (таск 181, G273, G282).
//
// Слова заказчика: «Аналогично 20, но в режиме Объём — там должны быть
// параметры: Показывать миникарту, Тип фона — Простой…, Природа…, Город…». И
// следом про время: «сразу заложи по фону что бы можно было указывать время
// суток… можно указать своё или вернуть текущее».
//
// ——— где живёт выбор ———————————————————————————————————————————————————
//
// **В настройках браузера, а не в объекте.** Фон, время и ускорение — это вид,
// а не свойство квартиры: уехав в `project.json`, они пришли бы к напарнику
// вместе с проектом и переставили бы ему картинку за окном и час на небе, а
// правило G68 потребовало бы миграции ради того, что человек меняет кнопкой.
// Той же природы и отметка миникарты, и соседи её по складу — «скрыть вещи»,
// шрифт схемы, свёрнутость плашек.
//
// Координаты объекта (таск 188) — наоборот, **свойство объекта**: место дома не
// меняется от того, кто на него смотрит. Их объём читает у объекта
// (`volumeSiteOf`) и сам не пишет ничего.
//
// Время при этом в настройки **не** ложится: заказчик сказал «при открытии
// стоит реальное время», и запомненный час спорил бы с этим прямо. Ложится
// только ускорение — им человек выбирает, как быстро смотреть сутки, а не
// который час.
//
// ——— окно, а не раздел колонки ——————————————————————————————————————————
//
// Кнопка стоит **на поле, во всех раскладках**, и это ответ на вопрос тикета
// «нужно ли оно и на большом экране». Да, нужно, и причина не во вкусе:
// «Интерфейс проекта» (таск 175) живёт разделом левой колонки, и окно ему нужно
// только там, где колонки уезжают листом. У объёма колонок нет вовсе в главном
// его виде — полный экран (G246) показывает одно поле, — и дверь, которая
// работает в полном экране, может быть только на поле. Две двери (раздел в
// колонке и кнопка) были бы двумя местами одного выбора; одна кнопка в углу
// работает всегда и везде.
import { strings, text } from "../strings.js";
import { getSetting, setSetting } from "../store.js";
import {
  VOLUME_BACKDROP_DEFAULT,
  VOLUME_BACKDROP_KINDS,
  VOLUME_CLOCK_SPEEDS,
  VOLUME_CLOCK_SPEED_DEFAULT,
  volumeBackdropKindOf,
  volumeClockDayMinutes,
  volumeClockFixed,
  volumeClockMinutes,
  volumeClockNow,
  volumeClockParse,
  volumeClockSpeedOf,
  volumeClockText,
} from "../volume.js";
import { uiButton, uiEl, uiIconButton, uiModal } from "./ui.js";

export const VOLUME_BACKDROP_SETTING = "volumeBackdrop";
export const VOLUME_MINIMAP_SETTING = "volumeMinimap";
export const VOLUME_SPEED_SETTING = "volumeClockSpeed";

/**
 * Выбор человека. Живёт в области модуля, а не в поверхности объёма: поверхность
 * пересобирается (сменили схему, закрыли объект), а выбор — нет.
 *
 * `clock` заводится при первом спросе и дальше идёт формулой — см.
 * `volumeClockMinutes`.
 */
const params = {
  kind: VOLUME_BACKDROP_DEFAULT,
  minimap: true,
  speed: VOLUME_CLOCK_SPEED_DEFAULT,
  clock: null,
};

// Настройки читаются асинхронно, как у плашек и слоёв: поле стартует с
// умолчаний и перерисовывается, когда хранилище ответит. Кто ждёт ответа —
// говорит об этом через `volumeParamsWatch`.
const watchers = new Set();
let loaded = false;

function tell() {
  for (const watcher of watchers) watcher();
}

export function volumeParamsWatch(watcher) {
  watchers.add(watcher);
  volumeParamsLoad();
  return () => watchers.delete(watcher);
}

export function volumeParamsLoad() {
  if (loaded) return;
  loaded = true;
  Promise.resolve(getSetting(VOLUME_BACKDROP_SETTING))
    .then((saved) => {
      if (!VOLUME_BACKDROP_KINDS.includes(saved) || saved === params.kind) return;
      params.kind = saved;
      tell();
    })
    .catch(() => {});
  // Отметка миникарты **положительная** и умолчание у неё взведённое: сегодня
  // карта появляется сама, и снятая галка — это просьба её убрать.
  Promise.resolve(getSetting(VOLUME_MINIMAP_SETTING))
    .then((saved) => {
      if (saved !== false) return;
      params.minimap = false;
      tell();
    })
    .catch(() => {});
  Promise.resolve(getSetting(VOLUME_SPEED_SETTING))
    .then((saved) => {
      const speed = volumeClockSpeedOf(saved);
      if (speed === params.speed) return;
      params.speed = speed;
      if (params.clock) params.clock = { ...params.clock, speed };
      tell();
    })
    .catch(() => {});
}

/** Что выбрано сейчас. Снимок: менять только через двери ниже. */
export function volumeParamsRead() {
  return { kind: params.kind, minimap: params.minimap, speed: params.speed, clock: params.clock };
}

/** Часы объёма; при первом спросе заводятся на настоящем времени. */
export function volumeParamsClock(nowMs) {
  if (!params.clock) params.clock = volumeClockNow(nowMs, new Date(), params.speed);
  return params.clock;
}

/**
 * Вошли в режим: идущие часы перецепляются за **настоящее** время.
 *
 * Слова заказчика — «при открытии стоит реальное время», и открытие режима и
 * есть та минута, о которой он говорит. Без этого человек, вернувшийся в объём
 * после обеда, попадал бы в случайный час: время идёт формулой и за час
 * отсутствия при ускорении 60 уходит на два с половиной дня вперёд.
 *
 * Остановленные часы не трогаются: их человек поставил нарочно.
 */
export function volumeParamsArrive(nowMs) {
  if (params.clock && params.clock.fixed) return;
  params.clock = volumeClockNow(nowMs, new Date(), params.speed);
}

export function volumeParamsKind(kind) {
  const next = volumeBackdropKindOf(kind);
  if (next === params.kind) return;
  params.kind = next;
  setSetting(VOLUME_BACKDROP_SETTING, next);
  tell();
}

export function volumeParamsMinimap(shown) {
  const next = Boolean(shown);
  if (next === params.minimap) return;
  params.minimap = next;
  setSetting(VOLUME_MINIMAP_SETTING, next);
  tell();
}

/**
 * Ускорение. Выбрал — время **идёт**: ускорение без хода ничего не значит, и
 * мёртвого пункта в окне быть не должно.
 */
export function volumeParamsSpeed(speed, nowMs) {
  const next = volumeClockSpeedOf(speed);
  params.speed = next;
  setSetting(VOLUME_SPEED_SETTING, next);
  const minutes = volumeClockMinutes(volumeParamsClock(nowMs), nowMs);
  params.clock = { fixed: false, fromMin: minutes, atMs: nowMs, speed: next };
  tell();
}

/** Своё время: поставили час — он стоит (и фон не пересчитывается вовсе). */
export function volumeParamsFix(minutes, nowMs) {
  const value = minutes === null || minutes === undefined ? volumeClockMinutes(volumeParamsClock(nowMs), nowMs) : minutes;
  params.clock = volumeClockFixed(value, params.speed);
  tell();
}

/** «Сейчас»: настоящее время, и оно идёт. */
export function volumeParamsNow(nowMs) {
  params.clock = volumeClockNow(nowMs, new Date(), params.speed);
  tell();
}

/** Час словом: им подписаны и окно, и отрезки суток. */
export function volumePhaseWord(phase) {
  if (phase === "morning") return strings.volume.phaseMorning;
  if (phase === "day") return strings.volume.phaseDay;
  if (phase === "evening") return strings.volume.phaseEvening;
  return strings.volume.phaseNight;
}

/** Подпись ускорения: «×60 — сутки за 24 мин». Число — не в словаре, оно счёт. */
export function volumeSpeedLabel(speed) {
  return text("volume.speedOption", { speed: volumeClockSpeedOf(speed), day: volumeDayText(speed) });
}

/** 1,5 — с запятой: это число для человека, а не для кода. */
function volumeDayText(speed) {
  return String(volumeClockDayMinutes(speed)).replace(".", ",");
}

/** Строка состояния часов: который час, как он называется и идёт ли. */
export function volumeParamsLine(clock, minutes, phase) {
  const where = { time: volumeClockText(minutes), phase: volumePhaseWord(phase) };
  if (clock && clock.fixed) return text("volume.clockFixedLine", where);
  return text("volume.clockRunning", { ...where, day: volumeDayText(clock ? clock.speed : null) });
}

/** Строка про рассвет и закат: по координатам объекта или по умолчанию. */
export function volumeParamsSunLine(times) {
  const where = { rise: volumeClockText(times.riseMin), set: volumeClockText(times.setMin) };
  return times.bySite ? text("volume.sunriseSite", where) : text("volume.sunrise", where);
}

/**
 * Кнопка параметров на поле и окно за ней.
 *
 * `now` — часы страницы (аргументом, а не `Date.now()` внутри: окно обязано
 * жить в тех же часах, в которых идёт поле), `hour` — снимок часа от поля, из
 * него берутся слово и минута, `times` — рассвет с закатом этого объекта.
 *
 * О правках окно рассказывает **только себе**: поле слушает выбор своей
 * подпиской (`volumeParamsWatch`) и той же подпиской принимает настройки,
 * приехавшие из хранилища. Два пути к одному кадру были бы двойной
 * перерисовкой на каждое нажатие.
 */
export function createVolumeParams({ now, hour, times }) {
  const button = uiIconButton("sliders", {
    class: "canvas-corner volume__paramsBtn",
    label: strings.volume.params,
    title: strings.volume.paramsHint,
    on: { click: () => open() },
  });
  let modal = null;
  let stopWatch = null;
  let tick = 0;

  function open() {
    if (modal) return;
    const body = uiEl("div", { class: "tools volume__params" });
    const state = uiEl("p", { class: "tools__note volume__paramsState" });
    const render = () => {
      const chosen = volumeParamsRead();
      const at = hour();
      body.replaceChildren(
        uiEl("p", { class: "tools__label", text: strings.volume.backdrop }),
        uiEl(
          "div",
          { class: "volume__paramsRow" },
          VOLUME_BACKDROP_KINDS.map((kind) =>
            uiButton(backdropLabel(kind), {
              class: "ui-btn" + (chosen.kind === kind ? " is-on" : ""),
              title: backdropHint(kind),
              attrs: { "aria-pressed": chosen.kind === kind ? "true" : "false" },
              on: { click: () => volumeParamsKind(kind) },
            }),
          ),
        ),
        uiEl("label", { class: "tools__field tools__field--check" }, [
          minimapCheck(chosen.minimap),
          uiEl("span", { text: strings.volume.minimap }),
        ]),
        uiEl("p", { class: "tools__note", text: strings.volume.minimapHint }),
        uiEl("p", { class: "tools__label", text: strings.volume.clock }),
        uiEl("div", { class: "volume__paramsRow" }, [
          clockField(at.minutes),
          uiButton(strings.volume.clockNow, {
            class: "ui-btn",
            title: strings.volume.clockNowHint,
            on: { click: () => volumeParamsNow(now()) },
          }),
          uiButton(strings.volume.clockStop, {
            class: "ui-btn" + (chosen.clock && chosen.clock.fixed ? " is-on" : ""),
            title: strings.volume.clockStopHint,
            attrs: { "aria-pressed": chosen.clock && chosen.clock.fixed ? "true" : "false" },
            on: { click: () => volumeParamsFix(null, now()) },
          }),
        ]),
        state,
        uiEl("p", { class: "tools__label", text: strings.volume.speed }),
        uiEl(
          "div",
          { class: "volume__paramsRow" },
          VOLUME_CLOCK_SPEEDS.map((speed) =>
            uiButton(volumeSpeedLabel(speed), {
              class: "ui-btn" + (chosen.speed === speed && !(chosen.clock && chosen.clock.fixed) ? " is-on" : ""),
              attrs: {
                "aria-pressed":
                  chosen.speed === speed && !(chosen.clock && chosen.clock.fixed) ? "true" : "false",
              },
              on: { click: () => volumeParamsSpeed(speed, now()) },
            }),
          ),
        ),
        uiEl("p", { class: "tools__note", text: volumeParamsSunLine(times()) }),
      );
      line();
    };
    // Строка состояния обновляется сама, пока окно открыто: время идёт, и
    // человек должен видеть, который час в объёме. Поле при этом **не**
    // перерисовывается этим таймером — у него свой, и он один.
    const line = () => {
      const at = hour();
      state.textContent = volumeParamsLine(volumeParamsRead().clock, at.minutes, at.phase);
    };
    const close = () => {
      if (tick && typeof clearInterval === "function") clearInterval(tick);
      tick = 0;
      if (stopWatch) stopWatch();
      stopWatch = null;
      modal = null;
    };
    stopWatch = volumeParamsWatch(() => render());
    render();
    if (typeof setInterval === "function") tick = setInterval(line, 1000);
    // Ширину задаёт содержимое, а не общая мера диалогов (таск 175, дефект
    // D41): в окне три ряда кнопок и галка, и общие 720 точек оставили бы
    // половину карточки пустым полем.
    modal = uiModal({
      title: strings.volume.paramsTitle,
      body,
      actions: [
        uiButton(strings.dialog.close, {
          class: "ui-btn ui-btn--accent",
          on: {
            click: () => {
              const open = modal;
              close();
              if (open) open.close();
            },
          },
        }),
      ],
      onCancel: () => close(),
    });
    if (modal.card) modal.card.classList.add("modal--fit");
  }

  function minimapCheck(on) {
    const box = uiEl("input", {
      class: "tools__check",
      type: "checkbox",
      on: { change: () => volumeParamsMinimap(box.checked) },
    });
    box.checked = on !== false;
    return box;
  }

  function clockField(minutes) {
    const field = uiEl("input", {
      class: "tools__time",
      type: "time",
      value: volumeClockText(minutes),
      title: strings.volume.clockOwnHint,
      attrs: { "aria-label": strings.volume.clockOwn },
      on: {
        change: () => {
          const own = volumeClockParse(field.value);
          if (own === null) return;
          volumeParamsFix(own, now());
        },
      },
    });
    return field;
  }

  function backdropLabel(kind) {
    if (kind === "plain") return strings.volume.backdropPlain;
    if (kind === "city") return strings.volume.backdropCity;
    return strings.volume.backdropNature;
  }

  function backdropHint(kind) {
    if (kind === "plain") return strings.volume.backdropPlainHint;
    if (kind === "city") return strings.volume.backdropCityHint;
    return strings.volume.backdropNatureHint;
  }

  return {
    node: button,
    dispose() {
      if (tick && typeof clearInterval === "function") clearInterval(tick);
      tick = 0;
      if (stopWatch) stopWatch();
      stopWatch = null;
      if (modal) modal.close();
      modal = null;
    },
  };
}
