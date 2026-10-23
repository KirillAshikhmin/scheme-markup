// Часы «Объёма» — это часы приложения (таск 02 сценариев, R09, R30i, история 3.1).
//
// Слова спецификации: «вход в «Объём» больше не перецепляет идущие часы к
// реальному времени (часы одни и идут непрерывно; «Сейчас» — по кнопке)».
// Здесь проверяется дверь «Объёма» к часам: `volumeParams*` читает и пишет
// через `appClock*`, и вход в режим часов не трогает.
import test from "node:test";
import assert from "node:assert/strict";

import { getSetting, setSetting } from "../src/store.js";
import { volumeClockStamp, volumeDayNumberOf } from "../src/clockMath.js";
import { appClockNow, appClockPause, appClockSimMs, appClockSpeed, appClockStep } from "../src/appClock.js";
import {
  VOLUME_HIDE_CARD_SETTING,
  VOLUME_SIMULATION_SETTING,
  VOLUME_SPEED_SETTING,
  volumeParamsArrive,
  volumeParamsClock,
  volumeParamsDay,
  volumeParamsFix,
  volumeParamsFlag,
  volumeParamsRead,
  volumeParamsSpeed,
  volumeParamsWatch,
} from "../src/panels/volumeParams.js";

/** Доехали все микрозадания: настройки пишутся обещаниями. */
function settled() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

test("вход в «Объём» не перецепляет идущие часы: переведённая дата остаётся", () => {
  const nowMs = Date.now();
  volumeParamsSpeed(60, nowMs);
  const today = volumeDayNumberOf(new Date());
  volumeParamsDay(today - 100, nowMs);
  const before = volumeClockStamp(volumeParamsClock(nowMs), nowMs);
  assert.equal(before.day, today - 100);
  volumeParamsArrive(nowMs);
  assert.deepEqual(volumeClockStamp(volumeParamsClock(nowMs), nowMs), before, "вход вернул часы к настоящему дню");
  assert.equal(volumeParamsRead().clock.fixed, false, "часы по-прежнему идут");
});

test("часы, переведённые шагом на +1 ч, после входа в «Объём» показывают то же время", () => {
  const nowMs = Date.now();
  volumeParamsSpeed(60, nowMs);
  const real = volumeClockStamp(volumeParamsClock(nowMs), nowMs);
  appClockStep(3_600_000, nowMs);
  const stepped = volumeClockStamp(volumeParamsClock(nowMs), nowMs);
  const gone = (stepped.day - real.day) * 1440 + stepped.minutes - real.minutes;
  assert.ok(Math.abs(gone - 60) < 1e-6, "шаг: " + gone);
  volumeParamsArrive(nowMs);
  assert.deepEqual(volumeClockStamp(volumeParamsClock(nowMs), nowMs), stepped, "вход съел шаг");
  // Пауза тоже переживает вход: её человек поставил нарочно.
  appClockPause(true, nowMs);
  volumeParamsArrive(nowMs + 60_000);
  assert.equal(volumeParamsRead().clock.fixed, true);
  appClockPause(false, nowMs);
});

test("«Объём» читает и пишет одни часы приложения", async () => {
  const nowMs = Date.now();
  appClockSpeed(120, nowMs);
  assert.equal(volumeParamsRead().speed, 120, "ускорение — то, что у часов приложения");
  assert.equal(volumeParamsRead().clock, appClockNow(nowMs), "часы — те самые, а не копия");
  assert.equal(volumeParamsClock(nowMs), appClockNow(nowMs));
  volumeParamsFix(6 * 60, nowMs);
  assert.equal(appClockNow(nowMs).fixed, true, "«Остановить» в «Объёме» останавливает часы приложения");
  assert.equal(volumeClockStamp(appClockNow(nowMs), nowMs).minutes, 6 * 60);
  // Ускорение по-прежнему помнится в настройках браузера — тем же ключом.
  volumeParamsSpeed(480, nowMs);
  assert.equal(VOLUME_SPEED_SETTING, "volumeClockSpeed");
  await settled();
  assert.equal(await getSetting("volumeClockSpeed"), 480);
});

test("перевод часов снаружи «Объёма» слышен его подписчикам — один раз", () => {
  let heard = 0;
  const stop = volumeParamsWatch(() => {
    heard += 1;
  });
  const nowMs = Date.now();
  const before = appClockSimMs(nowMs);
  appClockStep(600_000, nowMs);
  assert.equal(heard, 1, "шаг из «Схемы» не дошёл до «Объёма» или дошёл дважды");
  volumeParamsSpeed(240, nowMs);
  assert.equal(heard, 2, "своя правка «Объёма» тоже слышна один раз");
  assert.ok(Math.abs(appClockSimMs(nowMs) - before - 600_000) < 1e-3);
  stop();
  appClockStep(60_000, nowMs);
  assert.equal(heard, 2);
});

// ——— «Имитация умного дома» (таск 09 сценариев, G04, история 2.2) ————————————
//
// Слова заказчика: «в Объёме по умолчанию включён, но в параметрах Объёма можно
// отключить». Отметка живёт в настройках браузера рядом с остальными
// отметками окна параметров, в объект не пишется ничего.

test("2.2: отметка «Имитация умного дома» по умолчанию стоит и помнится в браузере", async () => {
  assert.equal(VOLUME_SIMULATION_SETTING, "volumeSimulation");
  assert.equal(volumeParamsRead().simulation, true, "умолчание — имитация включена");
  let heard = 0;
  const stop = volumeParamsWatch(() => {
    heard += 1;
  });
  volumeParamsFlag("simulation", false);
  assert.equal(volumeParamsRead().simulation, false);
  assert.equal(heard, 1, "снятую отметку не услышал «Объём»");
  await settled();
  assert.equal(await getSetting("volumeSimulation"), false, "снятая отметка не записана в настройки браузера");
  volumeParamsFlag("simulation", true);
  assert.equal(volumeParamsRead().simulation, true);
  await settled();
  assert.equal(await getSetting("volumeSimulation"), true);
  stop();
});

test("2.2: снятая отметка поднимается из настроек при открытии страницы, а «готово» ждёт её", async () => {
  await setSetting("volumeSimulation", false);
  // Свой экземпляр модуля — та же страница, открытая заново: настройки те же.
  const fresh = await import("../src/panels/volumeParams.js?t09-fresh");
  assert.equal(fresh.volumeParamsRead().simulation, true, "до ответа хранилища — умолчание");
  fresh.volumeParamsLoad();
  await fresh.volumeParamsReady();
  assert.equal(fresh.volumeParamsRead().simulation, false, "снятая отметка забыта после перезагрузки");
  await setSetting("volumeSimulation", true);
});

// ——— «Не показывать карточку метки» (таск 09 сценариев, G22, история 8.7) ————

test("8.7: отметка «Не показывать карточку метки» по умолчанию снята и помнится в браузере", async () => {
  assert.equal(VOLUME_HIDE_CARD_SETTING, "volumeHideCard");
  assert.equal(volumeParamsRead().hideCard, false, "умолчание — карточка видна");
  volumeParamsFlag("hideCard", true);
  assert.equal(volumeParamsRead().hideCard, true);
  await settled();
  assert.equal(await getSetting("volumeHideCard"), true, "отметка не записана в настройки браузера");
  // Поставленная отметка поднимается при открытии страницы заново.
  const fresh = await import("../src/panels/volumeParams.js?t09-card");
  fresh.volumeParamsLoad();
  await fresh.volumeParamsReady();
  assert.equal(fresh.volumeParamsRead().hideCard, true, "поставленная отметка забыта после перезагрузки");
  volumeParamsFlag("hideCard", false);
  await settled();
  assert.equal(await getSetting("volumeHideCard"), false);
});
