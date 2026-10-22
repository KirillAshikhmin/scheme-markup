// Часы приложения (таск 02 сценариев, R09, R30i; истории 3.1–3.4, 3.6).
//
// Одни часы на всё: «Объём» с его солнцем, полоса часов «Схемы» и «Сценариев»,
// движок имитации. Формула прежняя (`{fixed, fromDay, fromMin, atMs, speed}`),
// хозяин у неё теперь один — `appClock.js`. Здесь проверяются его двери: шаг,
// перемотка, пауза, своё время и дата, «Сейчас», ускорение и подписка.
//
// Время в тестах — подставное `nowMs`: двери принимают его последним доводом,
// как и прежние двери «Объёма», поэтому счёт не зависит от того, сколько
// длится прогон.
import test from "node:test";
import assert from "node:assert/strict";

import { getSetting, setSetting } from "../src/store.js";
import { clockStampMs, volumeClockFixed, volumeDayNumberOf } from "../src/clockMath.js";

const MIN = 60_000;
const HOUR = 3_600_000;

/** Свежий экземпляр часов: у каждого теста свой хозяин, как после загрузки страницы. */
let fresh = 0;
async function clockModule() {
  fresh += 1;
  return import("../src/appClock.js?case=" + fresh);
}

/**
 * Время имитации — дробные минуты формулы, переведённые в миллисекунды: счёт
 * сходится до миллионных долей миллисекунды, а не до бита.
 */
function near(actual, expected, message) {
  assert.ok(Math.abs(actual - expected) < 1e-3, (message || "время") + ": " + actual + " ≠ " + expected);
}

/** Доехали все микрозадания: настройки читаются обещаниями. */
function settled() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

test("часы заводятся на настоящем времени и идут формулой с ускорением", async () => {
  const app = await clockModule();
  const nowMs = 1_000_000;
  const clock = app.appClockNow(nowMs);
  assert.equal(clock.fixed, false);
  assert.equal(clock.speed, 60, "умолчание — ×60");
  assert.equal(app.appClockNow(nowMs + 5000), clock, "часы одни: второй спрос не заводит новых");
  const stamp = app.appClockStamp(nowMs);
  assert.equal(stamp.day, volumeDayNumberOf(new Date()));
  // ×60: секунда настоящего времени — минута имитации.
  near(app.appClockSimMs(nowMs + 1000) - app.appClockSimMs(nowMs), MIN);
  near(app.appClockSimMs(nowMs), clockStampMs(stamp));
});

test("шаг и перемотка двигают время, ход и ускорение остаются", async () => {
  const app = await clockModule();
  const nowMs = 2_000_000;
  const start = app.appClockSimMs(nowMs);
  app.appClockStep(HOUR, nowMs);
  near(app.appClockSimMs(nowMs), start + HOUR, "+1 ч");
  app.appClockStep(10 * MIN, nowMs);
  near(app.appClockSimMs(nowMs), start + HOUR + 10 * MIN, "+10 мин");
  assert.equal(app.appClockNow(nowMs).fixed, false, "шаг часов не останавливает");
  near(app.appClockSimMs(nowMs + 1000), start + HOUR + 11 * MIN, "и они идут дальше с тем же ×60");
  // Перемотка к событию — прямо в миг события, через полночь тоже.
  const target = clockStampMs({ day: volumeDayNumberOf(new Date()) + 1, minutes: 7 * 60 + 30 });
  app.appClockJump(target, nowMs);
  near(app.appClockSimMs(nowMs), target);
  assert.deepEqual(app.appClockStamp(nowMs), { day: volumeDayNumberOf(new Date()) + 1, minutes: 7 * 60 + 30 });
  // Назад — тоже перевод: часы просто показывают более раннее время.
  app.appClockStep(-2 * HOUR, nowMs);
  near(app.appClockSimMs(nowMs), target - 2 * HOUR);
});

test("пауза: время стоит, шаг его двигает, снятие паузы идёт с того же мига", async () => {
  const app = await clockModule();
  const nowMs = 3_000_000;
  app.appClockSpeed(120, nowMs);
  const at = app.appClockSimMs(nowMs);
  app.appClockPause(true, nowMs);
  assert.equal(app.appClockNow(nowMs).fixed, true);
  near(app.appClockSimMs(nowMs + HOUR), at, "на паузе время не идёт");
  app.appClockStep(MIN, nowMs + HOUR);
  near(app.appClockSimMs(nowMs + 2 * HOUR), at + MIN, "шаг на паузе двигает стоячее время");
  assert.equal(app.appClockNow(nowMs).fixed, true, "и пауза остаётся");
  app.appClockPause(false, nowMs + 3 * HOUR);
  near(app.appClockSimMs(nowMs + 3 * HOUR), at + MIN, "снятие паузы не прыгает");
  near(app.appClockSimMs(nowMs + 3 * HOUR + 1000), at + MIN + 2 * MIN, "и время идёт с прежним ×120");
});

test("своё время, своя дата, «Сейчас» и ускорение — прежние двери «Объёма»", async () => {
  const app = await clockModule();
  const nowMs = 4_000_000;
  const today = volumeDayNumberOf(new Date());
  app.appClockFix(5 * 60, nowMs);
  assert.deepEqual(app.appClockNow(nowMs), volumeClockFixed(5 * 60, 60, today), "своё время стоит");
  app.appClockDay(today - 200, nowMs);
  assert.deepEqual(app.appClockStamp(nowMs), { day: today - 200, minutes: 5 * 60 }, "дата не трогает час");
  // Ускорение: выбрал — время идёт, и без скачка.
  const before = app.appClockSimMs(nowMs);
  app.appClockSpeed(480, nowMs);
  near(app.appClockSimMs(nowMs), before);
  assert.equal(app.appClockNow(nowMs).fixed, false);
  assert.equal(app.appClockRead().speed, 480);
  await settled();
  assert.equal(await getSetting("volumeClockSpeed"), 480, "ускорение помнится в настройках браузера прежним ключом");
  // «Сейчас»: сегодня, настоящий час и «Без ускорения».
  app.appClockRealNow(nowMs);
  assert.equal(app.appClockRead().speed, 1);
  assert.equal(app.appClockStamp(nowMs).day, today);
  const real = new Date();
  const minutes = real.getHours() * 60 + real.getMinutes() + real.getSeconds() / 60;
  assert.ok(Math.abs(app.appClockStamp(nowMs).minutes - minutes) < 1, "час настоящий");
  await settled();
  assert.equal(await getSetting("volumeClockSpeed"), 1);
});

test("подписка: каждый перевод часов слышен, отписка — тишина", async () => {
  const app = await clockModule();
  const nowMs = 5_000_000;
  const heard = [];
  const stop = app.appClockWatch((read) => heard.push(read.clock));
  app.appClockStep(MIN, nowMs);
  app.appClockPause(true, nowMs);
  app.appClockPause(true, nowMs);
  app.appClockJump(clockStampMs({ day: 20000, minutes: 60 }), nowMs);
  assert.equal(heard.length, 3, "повторная пауза — не перевод");
  assert.equal(heard[2], app.appClockNow(nowMs), "подписчик получает те самые часы");
  stop();
  app.appClockStep(MIN, nowMs);
  assert.equal(heard.length, 3);
});

test("ускорение из настроек приезжает без скачка времени; выбор человека старше", async () => {
  await setSetting("volumeClockSpeed", 240);
  const app = await clockModule();
  const nowMs = Date.now();
  const before = app.appClockSimMs(nowMs);
  app.appClockWatch(() => {});
  await settled();
  assert.equal(app.appClockRead().speed, 240, "сохранённое ускорение не поднялось");
  assert.equal(app.appClockNow().speed, 240, "идущие часы пошли с ним");
  assert.ok(Math.abs(app.appClockSimMs(nowMs) - before) < 5 * MIN, "приезд настройки сдвинул время");
  // Человек выбрал раньше, чем ответило хранилище, — его выбор и остаётся.
  await setSetting("volumeClockSpeed", 960);
  const early = await clockModule();
  early.appClockWatch(() => {});
  early.appClockSpeed(120);
  await settled();
  assert.equal(early.appClockRead().speed, 120);
  // Мусор в хранилище — умолчание.
  await setSetting("volumeClockSpeed", "быстро");
  const junk = await clockModule();
  junk.appClockWatch(() => {});
  await settled();
  assert.equal(junk.appClockRead().speed, 60);
});
