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
// ——— колонка там, где она есть; окно там, где её нет ————————————————————
//
// Таск 181 ставил кнопку на поле **во всех раскладках**: «Интерфейс проекта»
// (таск 175) живёт разделом левой колонки, а у объёма колонок нет вовсе в
// полном экране (G246) — и дверь, которая работает там, может быть только на
// поле. Заказчик переставил это дважды: параметры живут в левой колонке (G349),
// а окно остаётся «в мобильном интерфейсе и в полноэкранном» (G351).
//
// Правило вышло то же, что у «Интерфейса проекта», и теперь оно общее на оба
// раздела: **ряды в колонке, а где колонки нет — то же окно**. Двух путей к
// одному значению на одной раскладке не бывает, а ряды собираются один раз
// (`createVolumeParamsFields`) — разбор у `volumeParamsHome` ниже.
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
import { uiButton, uiCheckRow, uiEl, uiIconButton, uiModal } from "./ui.js";

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
// **Умолчание — взведённое** (таск 231, G350): «по умолчанию отключи показ
// потолка» — открыл объём, видишь планировку сверху. Таск 212 ставил обратное
// («крыша на месте, и у того, кто галок не ставил, ничего не меняется»), и
// отменил это заказчик своим словом.
//
// Отметка этим переходит из **отрицательных** в **положительные**: читается она
// теперь правилом миникарты (`saved !== false` — умолчание в силе), а не
// правилом трёх отметок таска 192 (`saved !== true` — умолчание снято). Так и
// отличается «не трогал» от «вернул крышу на место»: в хранилище лежит либо
// ничего (ключа нет вовсе — умолчание, крыша снята), либо `false` — человек
// снял галку руками, и его выбор старше нового умолчания.
//
// Живёт она в настройках браузера рядом с миникартой и фоном: это вид, а не
// свойство дома (G68), и миграции тут браться не от чего.
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
  // Крыша снята (G350): объём открывается видом на планировку сверху.
  roofOff: true,
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
  // Отметки **положительные** и умолчание у них взведённое: карта и снятая
  // крыша появляются сами, а снятая галка — это просьба их убрать. Правило одно
  // на обе: `saved !== false` значит «не трогали, умолчание в силе».
  for (const [key, name] of [
    [VOLUME_MINIMAP_SETTING, "minimap"],
    [VOLUME_ROOF_SETTING, "roofOff"],
  ]) {
    Promise.resolve(getSetting(key))
      .then((saved) => {
        if (saved !== false) return;
        params[name] = false;
        tell();
      })
      .catch(() => {});
  }
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


// ——— где живут параметры: колонка или окно (таск 231, G349, G351) —————————
//
// Таск 181 ставил кнопку на поле **во всех раскладках** и доводом брал полный
// экран: «дверь, которая работает в полном экране, может быть только на поле».
// Довод остался верным, а вывод заказчик поправил (G349): «в режиме Объём как
// будто справа панель убрать надо, а слева оставить блок Объём и добавить туда
// Параметры объёма, что сейчас в окне», и следом (G351) — «окно должно быть в
// мобильном интерфейсе и в полноэкранном».
//
// Отсюда правило: **двух путей к одному значению на одной раскладке нет**.
// Параметры стоят там, где на этой раскладке вообще есть место:
//
//   обычная раскладка — ряды в левой колонке, кнопки в углу поля нет вовсе;
//   узкая (`is-mobile`) — колонок нет, колонка приходит листом снизу: окно;
//   полный экран «Объёма» (таск 166, G246) — колонок нет: окно.
//
// Считается ответ **одним** местом и чистой функцией: две колонки правды
// («кнопка решает сама» и «колонка решает сама») разошлись бы в переходе —
// развернул окно браузера, и параметры оказались бы и там, и там, или нигде.
/**
 * Где стоят параметры на этой раскладке: `"column"` или `"window"`.
 *
 * `layout` — раскладка страницы (`app.getState().layout`), `bare` — поле во
 * весь экран без колонок (`canvasFullscreenBare`).
 */
export function volumeParamsHome(layout, bare) {
  return bare === true || layout === "mobile" ? "window" : "column";
}

/**
 * Ряды параметров — **одна сборка на колонку и на окно** (таск 231, G351).
 *
 * Две сборки разошлись бы на первой же правке: это тот самый урок таска 183,
 * где общий скелет окна вынесли, а окон осталось четыре. Поэтому ряды собирает
 * эта функция, а колонка и окно только дают ей место.
 *
 * `now` — часы страницы (аргументом, а не `Date.now()` внутри: ряды обязаны
 * жить в тех же часах, в которых идёт поле), `hour` — снимок часа от поля, из
 * него берутся слово и минута, `times` — рассвет с закатом этого объекта,
 * `window` — ряды стоят в окне (у него своя мера ширины, см. `volume.css`).
 *
 * О правках ряды рассказывают **только себе**: поле слушает выбор своей
 * подпиской (`volumeParamsWatch`) и той же подпиской принимает настройки,
 * приехавшие из хранилища. Два пути к одному кадру были бы двойной
 * перерисовкой на каждое нажатие.
 */
export function createVolumeParamsFields(options) {
  const { now, hour, times } = options;
  // Этажи и переход к одному из них (таск 202) — руки поля: ряды спрашивают
  // список и просят открыть выбранный этаж, а делает это поле. Умолчания стоят
  // затем, что стенд и тесты зовут ряды без этажей вовсе.
  const floors = options.floors || (() => null);
  const goFloor = options.goFloor || (() => {});
  const box = uiEl("div", {
    class: "tools volume__params" + (options.window === true ? " volume__params--window" : ""),
  });
  const state = uiEl("p", { class: "tools__note volume__paramsState" });
  let tick = 0;

  const render = () => {
    const chosen = volumeParamsRead();
    const at = hour();
    const plan = floors();
    const stacked = chosen.floorsAll === true && plan !== null && plan.can;
    const stopped = Boolean(chosen.clock && chosen.clock.fixed);
    box.replaceChildren(
      // «Что показывать» — **первым разделом**: это выбор о самой сцене, а
      // фон, час и миникарта — о том, как её показать. Человек, пришедший за
      // этажами, не должен искать их под ускорением времени.
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
      // Строка под списком этажей — **состояние, а не описание**: что встало в
      // стопку и почему «все этажи» недоступны. Молчания здесь быть не может
      // ни в одном случае (таск 202), поэтому в подсказку она не уходит.
      uiEl("p", { class: "tools__note", text: volumeFloorsNote(plan, stacked) }),
      // «Снять крышу» стоит здесь, а не рядом с фоном: это про **дом**, а не
      // про картинку за окном, и спрашивают её там же, где выбирают, какой
      // этаж показывать.
      checkRow(strings.volume.roofOff, chosen.roofOff, strings.volume.roofOffHint, (on) =>
        volumeParamsFlag("roofOff", on),
      ),
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
      checkRow(strings.volume.minimap, chosen.minimap, strings.volume.minimapHint, (on) =>
        volumeParamsMinimap(on),
      ),
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
          class: "ui-btn" + (stopped ? " is-on" : ""),
          title: strings.volume.clockStopHint,
          attrs: { "aria-pressed": stopped ? "true" : "false" },
          on: { click: () => volumeParamsFix(null, now()) },
        }),
      ]),
      state,
      uiEl("p", { class: "tools__label", text: strings.volume.speed }),
      // ——— ускорение списком, а не рядом кнопок (таск 231, G349) ————————
      //
      // Шесть подписей вида «Без ускорения — сутки идут сутки» кнопками — это
      // шесть строк в колонку шириной 264 точки: ряд занимал бы больше места,
      // чем все остальные параметры вместе. Список — тот же выбор в одну
      // строку, и приём в сборке не новый: так же стоит шаг сетки в
      // «Интерфейсе», где «Без сетки» — первый пункт того же списка (таск 193,
      // G293, по прямому слову заказчика).
      //
      // Список один и в колонке, и в окне (G351): рядом кнопок в окне он был бы
      // второй сборкой тех же шести значений.
      uiEl("div", { class: "volume__paramsRow" }, [speedSelect(chosen)]),
      // Рассвет и закат — тоже состояние, а не описание: они считаны по дате,
      // часам и координатам объекта и меняются от них.
      uiEl("p", { class: "tools__note", text: volumeParamsSunLine(times()) }),
      // «Плавные светила» стоят в разделе времени, а не отдельным: отметка
      // меняет не картинку, а то, как часто время доходит до неба.
      checkRow(strings.volume.smooth, chosen.smooth, strings.volume.smoothHint, (on) =>
        volumeParamsFlag("smooth", on),
      ),
      // Ходьба — свой раздел: это не вид за окном, а то, что делают руки.
      // Отметка одна и про запрет, который человек снимает, когда показывает
      // объект, а не ходит по нему. Вторая была «Летать» — её убрал
      // заказчик (таск 200): полёт уехал в обзор, где он всегда.
      uiEl("p", { class: "tools__label", text: strings.volume.walking }),
      checkRow(strings.volume.ghost, chosen.ghost, strings.volume.ghostHint, (on) =>
        volumeParamsFlag("ghost", on),
      ),
    );
    line();
  };

  // Строка состояния обновляется сама, пока ряды на экране: время идёт, и
  // человек должен видеть, который час в объёме. Поле при этом **не**
  // перерисовывается этим таймером — у него свой, и он один.
  const line = () => {
    const at = hour();
    state.textContent = volumeParamsLine(volumeParamsRead().clock, at.minutes, at.phase, dayOf(at));
    // Пока время идёт, часы в поле идут вместе с ним: поле, застывшее на
    // минуте открытия, читалось бы как «вот сейчас столько». Набирающую руку
    // это не трогает — под курсором поле не переписывается.
    const field = box.querySelector(".tools__time");
    if (field && document.activeElement !== field) field.value = volumeClockText(at.minutes);
    // И дата вместе с ними: полночь переводит число сама (G289), при
    // ускорении 960 — каждые полторы минуты.
    const date = box.querySelector(".tools__date");
    if (date && document.activeElement !== date) date.value = volumeDateText(dayOf(at));
  };

  /**
   * Строка с галкой — **готовый кирпич** `uiCheckRow`: подпись и квадратик
   * обязаны оставаться одной мишенью для пальца, и эта строка одна на все
   * четыре отметки (крыша, миникарта, плавные светила, сквозь стены).
   *
   * Пояснение уходит в **подсказку строки**, а не абзацем под ней: это правило
   * «Интерфейса» (таск 187, G281 — «в интерфейсе убери описания у пунктов»), и
   * в колонке на 264 точки четыре абзаца по три строки занимали бы больше, чем
   * все параметры. Состояние — другое дело: строки про этажи, рассвет и час
   * остались на виду.
   */
  function checkRow(label, on, title, set) {
    const input = uiEl("input", {
      class: "tools__check",
      type: "checkbox",
      on: { change: () => set(input.checked) },
    });
    input.checked = on === true;
    return uiCheckRow(input, label, title);
  }

  /** Ускорение списком. Подписи — те же `volumeSpeedLabel`, что были у кнопок. */
  function speedSelect(chosen) {
    const select = uiEl(
      "select",
      {
        class: "ui-input tools__select",
        title: strings.volume.speedHint,
        attrs: { "aria-label": strings.volume.speed },
        on: { change: () => volumeParamsSpeed(Number(select.value), now()) },
      },
      VOLUME_CLOCK_SPEEDS.map((speed) =>
        uiEl("option", { value: String(speed), text: volumeSpeedLabel(speed) }),
      ),
    );
    // Время остановлено — список показывает то ускорение, с которым оно
    // **пойдёт**: выбор в нём и есть «идти». Что оно сейчас стоит, сказано
    // строкой состояния и нажатой кнопкой «Остановить», и второго языка для
    // этого не заводится.
    select.value = String(chosen.speed);
    return select;
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

  const stopWatch = volumeParamsWatch(() => render());
  render();
  if (typeof setInterval === "function") tick = setInterval(line, 1000);

  return {
    node: box,
    /**
     * Пересобрать ряды: **список этажей считается не по настройкам, а по
     * объекту** (таск 202) — по схемам и по той из них, что открыта.
     *
     * Своей подписки на объект у рядов нет и быть не должно: доводы им даёт
     * поле (`floors`), оно же знает, когда они устарели. Без этого ряды,
     * живущие в колонке всю жизнь режима, показывали бы выбранным прежний
     * этаж: живой прогон поймал ровно это — перешли на второй, а подсвечен
     * остался первый. В окне это пряталось за тем, что его открывают заново.
     */
    refresh() {
      render();
    },
    dispose() {
      if (tick && typeof clearInterval === "function") clearInterval(tick);
      tick = 0;
      stopWatch();
    },
  };
}

/**
 * Какое число показывает снимок часа. Своего счёта у рядов нет: дату, как и
 * час, они спрашивают у поля — иначе в сборке стало бы два ответа на вопрос
 * «какое сегодня число в объёме».
 */
function dayOf(at) {
  const day = at && at.times ? Number(at.times.dayNumber) : NaN;
  return Number.isFinite(day) ? day : volumeDayNumberOf(new Date());
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

/**
 * Кнопка параметров на поле и окно за ней — **там, где колонки нет** (G351).
 *
 * Кнопку показывает и прячет поле (`volumeParamsHome`), а не она сама: про
 * полный экран и про раскладку знает поле, и спрашивать об этом из окна
 * значило бы завести второй ответ. Ряды окно берёт у общей сборки
 * (`createVolumeParamsFields`) — своей у него нет ни одной строки.
 */
export function createVolumeParams(options) {
  const button = uiIconButton("sliders", {
    class: "canvas-corner volume__paramsBtn",
    label: strings.volume.params,
    title: strings.volume.paramsHint,
    attrs: { hidden: "hidden" },
    on: { click: () => open() },
  });
  let modal = null;
  let fields = null;

  function open() {
    if (modal) return;
    fields = createVolumeParamsFields({ ...options, window: true });
    const close = () => {
      if (fields) fields.dispose();
      fields = null;
      modal = null;
    };
    modal = uiModal({
      title: strings.volume.paramsTitle,
      body: fields.node,
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
    // Ширину задаёт содержимое, а не общая мера диалогов (таск 175, дефект
    // D41): в окне ряды кнопок и галки, и общие 720 точек оставили бы
    // половину карточки пустым полем.
    if (modal.card) modal.card.classList.add("modal--fit");
  }

  return {
    node: button,
    /**
     * Есть ли кнопка на поле. Зовёт её поле на каждой пересборке и на смене
     * раскладки; закрывшееся место закрывает и открытое окно — окно без своей
     * двери осталось бы висеть над полем, у которого параметры уже в колонке.
     */
    /** Объект или открытая схема сменились — открытое окно пересобирает ряды. */
    refresh() {
      if (fields) fields.refresh();
    },
    shown(on) {
      button.hidden = on !== true;
      if (on === true || !modal) return;
      const open = modal;
      if (fields) fields.dispose();
      fields = null;
      modal = null;
      open.close();
    },
    dispose() {
      if (fields) fields.dispose();
      fields = null;
      if (modal) modal.close();
      modal = null;
    },
  };
}
