// Часы приложения: одно время на солнце «Объёма» и на сценарии (таск 02
// сценариев, R09, R30i; истории 3.1–3.6).
//
// Слова заказчика (раунд 3): часы — «Ускорение, перемотка и шаг», и они одни на
// всё. До этого таска часами владел «Объём» (`panels/volumeParams.js`), и только
// он их и читал. Теперь хозяин один — этот модуль; «Объём» ходит к нему через
// свои прежние двери (`volumeParams*`), полоса часов «Схемы» и «Сценариев» и
// имитация — напрямую.
//
// ——— что осталось как было ——————————————————————————————————————————————
//
// Формула та же: `{fixed, fromDay, fromMin, atMs, speed}` — не накопитель, а
// «откуда + (сейчас − когда) × ускорение» (`clockMath.js`). Часы заводятся на
// настоящем времени при первом спросе и в настройки не ложатся (слово
// заказчика: «при открытии стоит реальное время»); ложится только ускорение —
// прежним ключом `volumeClockSpeed`, так что выбор человека переживает этот
// таск без миграции.
//
// ——— что изменилось ————————————————————————————————————————————————————
//
// Вход в «Объём» часы больше **не перецепляет** к настоящему времени: часы
// одни, и переведённые шагом в «Схеме» они обязаны показывать то же время в
// «Объёме». «Сейчас» — только по кнопке (`appClockRealNow`).
//
// Каждая дверь принимает последним доводом `nowMs` — настоящее время страницы.
// Умолчание — `Date.now()`; довод нужен тестам и тем, кто уже держит «сейчас»
// кадра, чтобы часы и кадр считали от одного мига.
import { getSetting, setSetting } from "./store.js";
import {
  VOLUME_CLOCK_SPEED_DEFAULT,
  VOLUME_CLOCK_SPEED_REAL,
  clockMsStamp,
  clockSimMs,
  volumeClockAt,
  volumeClockFixed,
  volumeClockNow,
  volumeClockOnDay,
  volumeClockSpeedOf,
  volumeClockStamp,
} from "./clockMath.js";

/** Ключ настроек браузера, в котором помнится ускорение. Прежний — «Объёма». */
export const APP_CLOCK_SPEED_SETTING = "volumeClockSpeed";

/**
 * Состояние часов: ускорение, которым время **пойдёт**, и сами часы. `clock`
 * пуст, пока их никто не спросил, — как у «Объёма» до этого таска.
 */
const appClockState = { speed: VOLUME_CLOCK_SPEED_DEFAULT, clock: null };
const appClockWatchers = new Set();
let appClockLoaded = false;
// Человек выбрал ускорение раньше, чем ответило хранилище, — его выбор старше.
let appClockSpeedChosen = false;

function appClockTell() {
  const read = appClockRead();
  for (const watcher of [...appClockWatchers]) watcher(read);
}

/** Снимок: ускорение и часы (`null`, пока их не спрашивали). */
export function appClockRead() {
  return { speed: appClockState.speed, clock: appClockState.clock };
}

/**
 * Подписка на любой перевод часов. Первый подписчик поднимает ускорение из
 * настроек — тем же порядком, каким его поднимал «Объём».
 */
export function appClockWatch(watcher) {
  appClockWatchers.add(watcher);
  appClockLoad();
  return () => appClockWatchers.delete(watcher);
}

/** Поднять ускорение из настроек браузера (один раз за сеанс). */
export function appClockLoad() {
  if (appClockLoaded) return;
  appClockLoaded = true;
  Promise.resolve(getSetting(APP_CLOCK_SPEED_SETTING))
    .then((saved) => {
      if (appClockSpeedChosen) return;
      const speed = volumeClockSpeedOf(saved);
      if (speed === appClockState.speed) return;
      appClockState.speed = speed;
      // Часы перецепляются за ту же минуту: приезд настройки — не перевод.
      if (appClockState.clock) appClockState.clock = volumeClockAt(appClockState.clock, Date.now(), speed);
      appClockTell();
    })
    .catch(() => {});
}

/** Часы; при первом спросе заводятся на настоящем времени. */
export function appClockNow(nowMs = Date.now()) {
  if (!appClockState.clock) appClockState.clock = volumeClockNow(nowMs, new Date(), appClockState.speed);
  return appClockState.clock;
}

/** Который день и час на часах: `{day, minutes}`. */
export function appClockStamp(nowMs = Date.now()) {
  return volumeClockStamp(appClockNow(nowMs), nowMs);
}

/** Время имитации — местные миллисекунды (`clockMath.js`, «время одним числом»). */
export function appClockSimMs(nowMs = Date.now()) {
  return clockSimMs(appClockNow(nowMs), nowMs);
}

/**
 * Ускорение. Выбрал — время **идёт**: ускорение без хода ничего не значит.
 * Время при этом не прыгает — часы перецепляются за ту минуту, что показывают.
 */
export function appClockSpeed(speed, nowMs = Date.now()) {
  const next = volumeClockSpeedOf(speed);
  appClockState.speed = next;
  appClockSpeedChosen = true;
  setSetting(APP_CLOCK_SPEED_SETTING, next);
  const stamp = appClockStamp(nowMs);
  appClockState.clock = { fixed: false, fromDay: stamp.day, fromMin: stamp.minutes, atMs: nowMs, speed: next };
  appClockTell();
}

/** Своё время: поставили час — он стоит. `null` — остановить на том, что есть. */
export function appClockFix(minutes, nowMs = Date.now()) {
  const stamp = appClockStamp(nowMs);
  const value = minutes === null || minutes === undefined ? stamp.minutes : minutes;
  appClockState.clock = volumeClockFixed(value, appClockState.speed, stamp.day);
  appClockTell();
}

/** Своя дата: число меняется, час и ход часов — нет. */
export function appClockDay(day, nowMs = Date.now()) {
  appClockState.clock = volumeClockOnDay(appClockNow(nowMs), nowMs, day);
  appClockTell();
}

/** «Сейчас»: сегодняшняя дата, настоящий час и «Без ускорения». */
export function appClockRealNow(nowMs = Date.now()) {
  appClockState.speed = VOLUME_CLOCK_SPEED_REAL;
  appClockSpeedChosen = true;
  setSetting(APP_CLOCK_SPEED_SETTING, VOLUME_CLOCK_SPEED_REAL);
  appClockState.clock = volumeClockNow(nowMs, new Date(), VOLUME_CLOCK_SPEED_REAL);
  appClockTell();
}

/**
 * Перевести часы на миг `simMs` (местные миллисекунды). Ход и ускорение не
 * меняются: идущие часы идут дальше с него, стоячие стоят на нём. Назад —
 * тоже можно: это просто более раннее время (история 3.4).
 */
export function appClockJump(simMs, nowMs = Date.now()) {
  const target = Number(simMs);
  if (!Number.isFinite(target)) return;
  const clock = appClockNow(nowMs);
  const { day, minutes } = clockMsStamp(target);
  appClockState.clock = clock.fixed
    ? volumeClockFixed(minutes, clock.speed, day)
    : { fixed: false, fromDay: day, fromMin: minutes, atMs: nowMs, speed: volumeClockSpeedOf(clock.speed) };
  appClockTell();
}

/** Шаг: «+1 мин», «+10 мин», «+1 ч» — и любой другой, в том числе назад. */
export function appClockStep(ms, nowMs = Date.now()) {
  const by = Number(ms);
  if (!Number.isFinite(by)) return;
  appClockJump(appClockSimMs(nowMs) + by, nowMs);
}

/**
 * Пауза (история 3.6): время стоит там, где было, и идёт дальше с того же мига
 * с прежним ускорением. Пауза — это те же стоячие часы, что «Остановить» в
 * «Объёме»: двух видов «стоит» в часах не бывает.
 */
export function appClockPause(on, nowMs = Date.now()) {
  const clock = appClockNow(nowMs);
  if (Boolean(on) === Boolean(clock.fixed)) return;
  const stamp = volumeClockStamp(clock, nowMs);
  appClockState.clock = on
    ? volumeClockFixed(stamp.minutes, appClockState.speed, stamp.day)
    : { fixed: false, fromDay: stamp.day, fromMin: stamp.minutes, atMs: nowMs, speed: appClockState.speed };
  appClockTell();
}
