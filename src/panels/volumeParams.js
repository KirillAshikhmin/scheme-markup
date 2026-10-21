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
  VOLUME_CLOCK_SPEED_REAL,
  VOLUME_SLAB_MM,
  volumeBackdropKindOf,
  volumeClockDayMinutes,
  volumeClockFixed,
  volumeClockNow,
  volumeClockOnDay,
  volumeClockParse,
  volumeClockSpeedOf,
  volumeClockStamp,
  volumeClockText,
  volumeDateParse,
  volumeDateText,
  volumeDayNumberOf,
} from "../volume.js";
import { uiButton, uiEl, uiIconButton, uiModal } from "./ui.js";

export const VOLUME_BACKDROP_SETTING = "volumeBackdrop";
export const VOLUME_MINIMAP_SETTING = "volumeMinimap";
export const VOLUME_SPEED_SETTING = "volumeClockSpeed";
// ——— две отметки таска 192 (G292) ———————————————————————————————————————
//
// Слова заказчика: «Сделай в параметрах отображения для Объёма опции:
// 1. Плавные светила… 2. Проходить сквозь стены 3. Летать».
//
// Обе — **вид и поведение рук**, то есть той же природы, что фон и миникарта:
// в `project.json` им нельзя (G68), и живут они в настройках браузера рядом с
// соседями. Умолчание у каждой — **снято**: сегодняшнее поведение не меняется
// ни на миллиметр у того, кто галок не ставил.
//
// Третьей была «Летать», и убрал её **заказчик** (таск 200, G304): «уберём
// опцию Летать, но механику полёта перенесём в обзор». Отметки нет ни в окне,
// ни в этом списке. Записанное когда-то `volumeFly: true` осталось лежать в
// хранилище и не значит ничего: настройки читаются по именам, которые окно
// спрашивает, и незнакомое имя никого не ждёт. Чистить его нечем и незачем —
// в объект оно не попадало никогда (G68), миграции тут браться не от чего.
// ——— что показывать: все этажи или один (таск 202, G307) ————————————————
//
// Слова заказчика: «в опциях просмотра пусть будет пункт что показывать. Все
// этажи (если указаны этажи у схем) или какой-то именно этаж».
//
// В настройках браузера живёт **только отметка «все этажи»**, и это не
// небрежность: «какой-то именно этаж» — это открытая схема, а она и так своя у
// объекта и у приложения. Запиши сюда ещё и номер — и у вопроса «какая схема
// открыта» стало бы два ответа, спорящих при открытии объекта. В `project.json`
// не попадает ни то, ни другое (G68).
//
// Умолчание — **снято**: у того, кто галку не ставил, объём показывает ровно
// то, что показывал, — открытую схему.
export const VOLUME_FLOORS_SETTING = "volumeFloorsAll";
// ——— «Снять крышу» (таск 212, требование G319) ——————————————————————————
//
// С таска 211 дом сверху глухой: потолок стал двусторонним, и это то, что
// просил заказчик («перекрытия не должны быть прозрачными»). Вместе с
// просвечивающей крышей исчез **кукольный дом** — способ посмотреть планировку
// сверху, не выходя из объёма. Отметка возвращает его по требованию.
//
// Умолчание — **снято**: крыша на месте, и у того, кто галок не ставил, ничего
// не меняется. Живёт она в настройках браузера рядом с миникартой и фоном: это
// вид, а не свойство дома (G68).
export const VOLUME_ROOF_SETTING = "volumeRoofOff";
export const VOLUME_SMOOTH_SETTING = "volumeSmoothSky";
export const VOLUME_GHOST_SETTING = "volumeThroughWalls";

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
  floorsAll: false,
  roofOff: false,
  speed: VOLUME_CLOCK_SPEED_DEFAULT,
  clock: null,
  smooth: false,
  ghost: false,
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
  // Отметки таска 192 — **отрицательные**: умолчание снято, и только
  // записанное `true` их включает. Поэтому читаются они одним правилом, а не
  // двумя: `saved !== true` — это «галки не ставили».
  for (const [key, name] of [
    [VOLUME_FLOORS_SETTING, "floorsAll"],
    [VOLUME_ROOF_SETTING, "roofOff"],
    [VOLUME_SMOOTH_SETTING, "smooth"],
    [VOLUME_GHOST_SETTING, "ghost"],
  ]) {
    Promise.resolve(getSetting(key))
      .then((saved) => {
        if (saved !== true) return;
        params[name] = true;
        tell();
      })
      .catch(() => {});
  }
}

/** Что выбрано сейчас. Снимок: менять только через двери ниже. */
export function volumeParamsRead() {
  return {
    kind: params.kind,
    minimap: params.minimap,
    floorsAll: params.floorsAll,
    roofOff: params.roofOff,
    speed: params.speed,
    clock: params.clock,
    smooth: params.smooth,
    ghost: params.ghost,
  };
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
 * Отметки таска 192 — одной дверью (G292).
 *
 * `smooth` — «Плавные светила» (фон в 30 кадров в секунду вместо раза в
 * секунду), `ghost` — «Проходить сквозь стены», `floorsAll` — «Все этажи»
 * (таск 202). Дверь одна на все, потому что устроены они одинаково до буквы:
 * прочесть, записать, сказать полю. Три близнеца-функции разошлись бы на
 * первой же правке.
 */
export function volumeParamsFlag(name, on) {
  const keys = {
    floorsAll: VOLUME_FLOORS_SETTING,
    roofOff: VOLUME_ROOF_SETTING,
    smooth: VOLUME_SMOOTH_SETTING,
    ghost: VOLUME_GHOST_SETTING,
  };
  const key = keys[name];
  if (!key) return;
  const next = Boolean(on);
  if (next === params[name]) return;
  params[name] = next;
  setSetting(key, next);
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
  const stamp = volumeClockStamp(volumeParamsClock(nowMs), nowMs);
  params.clock = { fixed: false, fromDay: stamp.day, fromMin: stamp.minutes, atMs: nowMs, speed: next };
  tell();
}

/** Своё время: поставили час — он стоит (и фон не пересчитывается вовсе). */
export function volumeParamsFix(minutes, nowMs) {
  const stamp = volumeClockStamp(volumeParamsClock(nowMs), nowMs);
  const value = minutes === null || minutes === undefined ? stamp.minutes : minutes;
  params.clock = volumeClockFixed(value, params.speed, stamp.day);
  tell();
}

/**
 * Своя дата (G289): число меняется, час и ход часов — нет.
 *
 * Дата не останавливает время нарочно: человек выбирает **день года**, на
 * который смотрит небо, а не замирает в нём. Остановка — отдельная кнопка, и
 * двух смыслов у одного поля быть не должно.
 */
export function volumeParamsDay(day, nowMs) {
  params.clock = volumeClockOnDay(volumeParamsClock(nowMs), nowMs, day);
  tell();
}

/**
 * «Сейчас»: сегодняшняя дата, настоящее время — и они идут **без ускорения**.
 *
 * Слова заказчика (G287): «При нажатии Сейчас он и должен выбираться и время
 * идти в реальном времени». Поэтому кнопка трогает и ускорение: вернуть
 * настоящее время, оставив его бежать по шестьдесят минут в минуту, значило бы
 * вернуть настоящим только первый миг.
 */
export function volumeParamsNow(nowMs) {
  params.speed = VOLUME_CLOCK_SPEED_REAL;
  setSetting(VOLUME_SPEED_SETTING, VOLUME_CLOCK_SPEED_REAL);
  params.clock = volumeClockNow(nowMs, new Date(), VOLUME_CLOCK_SPEED_REAL);
  tell();
}

/** Час словом: им подписаны и окно, и отрезки суток. */
export function volumePhaseWord(phase) {
  if (phase === "morning") return strings.volume.phaseMorning;
  if (phase === "day") return strings.volume.phaseDay;
  if (phase === "evening") return strings.volume.phaseEvening;
  return strings.volume.phaseNight;
}

/**
 * Подпись ускорения: «×60 — сутки за 24 мин». Число — не в словаре, оно счёт.
 *
 * У единицы подпись своя (G287): «×1 — сутки за 1440 мин» — это та же правда,
 * сказанная так, что её надо считать в голове.
 */
export function volumeSpeedLabel(speed) {
  const value = volumeClockSpeedOf(speed);
  if (value === VOLUME_CLOCK_SPEED_REAL) return strings.volume.speedNone;
  return text("volume.speedOption", { speed: value, day: volumeDayText(speed) });
}

/** 1,5 — с запятой: это число для человека, а не для кода. */
function volumeDayText(speed) {
  return String(volumeClockDayMinutes(speed)).replace(".", ",");
}

/** Дата человеку: «20.10.2026». Поле даты говорит на ISO, строка — на нашем. */
export function volumeDayLabel(day) {
  const iso = volumeDateText(day);
  return iso.slice(8, 10) + "." + iso.slice(5, 7) + "." + iso.slice(0, 4);
}

/** Строка состояния часов: какое число, который час и идёт ли он. */
export function volumeParamsLine(clock, minutes, phase, day) {
  const where = {
    date: volumeDayLabel(day === undefined || day === null ? volumeDayNumberOf(new Date()) : day),
    time: volumeClockText(minutes),
    phase: volumePhaseWord(phase),
  };
  if (clock && clock.fixed) return text("volume.clockFixedLine", where);
  if (volumeClockSpeedOf(clock ? clock.speed : null) === VOLUME_CLOCK_SPEED_REAL) {
    return text("volume.clockRealLine", where);
  }
  return text("volume.clockRunning", { ...where, day: volumeDayText(clock ? clock.speed : null) });
}

/** Строка про рассвет и закат: по координатам объекта или по умолчанию. */
export function volumeParamsSunLine(times) {
  const where = { rise: volumeClockText(times.riseMin), set: volumeClockText(times.setMin) };
  return times.bySite ? text("volume.sunriseSite", where) : text("volume.sunrise", where);
}

/**
 * Подпись этажа в списке «что показывать»: номер и имя схемы, как у лестницы.
 *
 * Номер первым — по нему этажи и ищут («этаж 2 · Второй свет»), и ровно так же
 * подписан список перехода по лестнице (таск 149). Второго порядка слов у
 * этажей в сборке нет.
 */
export function volumeFloorOptionLabel(option) {
  return text("volume.stairOption", { floor: option.floor, name: option.name });
}

/**
 * Что сказано под списком этажей (таск 202).
 *
 * Молчания здесь быть не может ни в одном случае — это прямое требование
 * тикета: «пункт недоступен, и скажи почему словом, а не молчанием». Поэтому
 * строка есть всегда: почему «все этажи» недоступны, что встало в стопку,
 * какой план на номер не попал.
 */
export function volumeFloorsNote(plan, all) {
  if (!plan) return "";
  if (!plan.can) {
    if (plan.why === "noFloor") return strings.volume.floorsNoOwn;
    if (plan.why === "one") return strings.volume.floorsOne;
    return strings.volume.floorsNone;
  }
  const doubles = (plan.doubles || [])
    .map((item) => text("volume.floorsDouble", { floor: item.floor, name: item.name }))
    .join(" ");
  if (!all) return [strings.volume.floorsOneShown, doubles].filter((part) => part !== "").join(" ");
  const numbers = plan.floors.map((item) => item.floor).join(", ");
  return [text("volume.floorsAllShown", { numbers, slab: VOLUME_SLAB_MM }), doubles]
    .filter((part) => part !== "")
    .join(" ");
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
export function createVolumeParams(options) {
  const { now, hour, times } = options;
  // Этажи и переход к одному из них (таск 202) — руки поля: окно спрашивает
  // список и просит открыть выбранный этаж, а делает это поле. Умолчания стоят
  // затем, что стенд и тесты зовут окно без этажей вовсе.
  const floors = options.floors || (() => null);
  const goFloor = options.goFloor || (() => {});
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
      const plan = floors();
      const stacked = chosen.floorsAll === true && plan !== null && plan.can;
      body.replaceChildren(
        // «Что показывать» — **первым разделом**: это выбор о самой сцене, а
        // фон, час и миникарта — о том, как её показать. Человек, открывший
        // окно ради этажей, не должен искать их под ускорением времени.
        uiEl("p", { class: "tools__label", text: strings.volume.floorsLabel }),
        uiEl(
          "div",
          { class: "volume__paramsRow" },
          [
            uiButton(strings.volume.floorsAll, {
              class: "ui-btn" + (stacked ? " is-on" : ""),
              title: plan && plan.can ? strings.volume.floorsAllHint : volumeFloorsNote(plan, false),
              attrs: {
                "aria-pressed": stacked ? "true" : "false",
                ...(plan && plan.can ? {} : { disabled: "" }),
              },
              on: { click: () => volumeParamsFlag("floorsAll", true) },
            }),
            ...((plan && plan.floors) || []).map((option) =>
              uiButton(volumeFloorOptionLabel(option), {
                class: "ui-btn" + (!stacked && option.current ? " is-on" : ""),
                title: strings.volume.floorsOneHint,
                attrs: { "aria-pressed": !stacked && option.current ? "true" : "false" },
                on: {
                  click: () => {
                    // Выбрали один этаж — отметка «все этажи» снимается, а
                    // схема становится открытой: «показывать этаж 2» и значит
                    // «открыть второй этаж». Второго способа сменить схему тут
                    // не заводится — зовётся та же дверь, которой переводит
                    // лестница.
                    volumeParamsFlag("floorsAll", false);
                    if (!option.current) goFloor(option);
                  },
                },
              }),
            ),
          ],
        ),
        uiEl("p", { class: "tools__note", text: volumeFloorsNote(plan, stacked) }),
        // «Снять крышу» стоит здесь, а не рядом с фоном: это про **дом**, а не
        // про картинку за окном, и спрашивают её там же, где выбирают, какой
        // этаж показывать.
        checkRow(strings.volume.roofOff, chosen.roofOff, (on) => volumeParamsFlag("roofOff", on)),
        uiEl("p", { class: "tools__note", text: strings.volume.roofOffHint }),
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
        checkRow(strings.volume.minimap, chosen.minimap, (on) => volumeParamsMinimap(on)),
        uiEl("p", { class: "tools__note", text: strings.volume.minimapHint }),
        uiEl("p", { class: "tools__label", text: strings.volume.clock }),
        // Дата стоит **над** часами (G289): от неё зависит место солнца, то
        // есть и рассвет с закатом, и фаза луны. Час без даты — полдела.
        uiEl("div", { class: "volume__paramsRow" }, [
          uiEl("span", { class: "volume__paramsName", text: strings.volume.clockDate }),
          dateField(dayOf(at)),
        ]),
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
        // «Плавные светила» стоят в разделе времени, а не отдельным: отметка
        // меняет не картинку, а то, как часто время доходит до неба.
        checkRow(strings.volume.smooth, chosen.smooth, (on) => volumeParamsFlag("smooth", on)),
        uiEl("p", { class: "tools__note", text: strings.volume.smoothHint }),
        // Ходьба — свой раздел: это не вид за окном, а то, что делают руки.
        // Отметка одна и про запрет, который человек снимает, когда показывает
        // объект, а не ходит по нему. Вторая была «Летать» — её убрал
        // заказчик (таск 200): полёт уехал в обзор, где он всегда.
        uiEl("p", { class: "tools__label", text: strings.volume.walking }),
        checkRow(strings.volume.ghost, chosen.ghost, (on) => volumeParamsFlag("ghost", on)),
        uiEl("p", { class: "tools__note", text: strings.volume.ghostHint }),
      );
      line();
    };
    // Строка состояния обновляется сама, пока окно открыто: время идёт, и
    // человек должен видеть, который час в объёме. Поле при этом **не**
    // перерисовывается этим таймером — у него свой, и он один.
    const line = () => {
      const at = hour();
      state.textContent = volumeParamsLine(volumeParamsRead().clock, at.minutes, at.phase, dayOf(at));
      // Пока время идёт, часы в поле идут вместе с ним: поле, застывшее на
      // минуте открытия, читалось бы как «вот сейчас столько». Набирающую руку
      // это не трогает — под курсором поле не переписывается.
      const field = body.querySelector(".tools__time");
      if (field && document.activeElement !== field) field.value = volumeClockText(at.minutes);
      // И дата вместе с ними: полночь переводит число сама (G289), при
      // ускорении 960 — каждые полторы минуты.
      const date = body.querySelector(".tools__date");
      if (date && document.activeElement !== date) date.value = volumeDateText(dayOf(at));
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

  /**
   * Строка с галкой. Одна на все три отметки окна (миникарта и две отметки
   * таска 192): списанные друг с друга строки разошлись бы на первой же правке
   * разметки, а подпись и галка обязаны оставаться одной мишенью для
   * пальца — потому это `label`, а не `div`.
   */
  function checkRow(label, on, set) {
    const box = uiEl("input", {
      class: "tools__check",
      type: "checkbox",
      on: { change: () => set(box.checked) },
    });
    box.checked = on === true;
    return uiEl("label", { class: "tools__field tools__field--check" }, [box, uiEl("span", { text: label })]);
  }

  /**
   * Какое число показывает снимок часа. Своего счёта у окна нет: дату, как и
   * час, оно спрашивает у поля — иначе в сборке стало бы два ответа на вопрос
   * «какое сегодня число в объёме».
   */
  function dayOf(at) {
    const day = at && at.times ? Number(at.times.dayNumber) : NaN;
    return Number.isFinite(day) ? day : volumeDayNumberOf(new Date());
  }

  function dateField(day) {
    const field = uiEl("input", {
      class: "tools__date",
      type: "date",
      value: volumeDateText(day),
      title: strings.volume.clockDateHint,
      attrs: { "aria-label": strings.volume.clockDate },
      on: {
        change: () => {
          const own = volumeDateParse(field.value);
          if (own === null) {
            field.value = volumeDateText(dayOf(hour()));
            return;
          }
          volumeParamsDay(own, now());
        },
      },
    });
    return field;
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
