// Математика расписаний имитации (таск 02 сценариев; истории 3.5, 4.9, 4.10).
//
// Что держится:
//
//   - планировщик (spec 4.9): «В ЧЧ:ММ» по дням недели, «Каждые N» от запуска,
//     «На восходе / закате ± смещение» — по координатам объекта тем же счётом,
//     что солнце «Объёма», а без координат — 9:00 и 21:00 (3.5);
//   - период (4.10): внутри суток и через полночь (22:00–06:00), с днями
//     недели; края — «начало» и «конец»;
//   - `Cron.schedule` Sprut.Hub: 6 полей, секунды первые (research/spruthub-tools.md §3.2, §4.4).
//
// Время — местные миллисекунды часов имитации (`clockMath.js`): день недели и
// час читаются без часового пояса, поэтому ожидания ниже — даты календаря.
import test from "node:test";
import assert from "node:assert/strict";

import { clockDayMs, volumeDayDateOf, volumeDayNumberOf, volumeDayTimes } from "../src/clockMath.js";
import { cronNextAt, periodContains, periodNextEdge, scheduleNextAt, sunTimes } from "../src/sim/schedule.js";

const SEC = 1000;
const MIN = 60 * SEC;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** Миг на часах имитации: дата календаря и время на стене. */
function at(year, month, date, hours = 0, minutes = 0, seconds = 0) {
  return clockDayMs(volumeDayNumberOf(new Date(year, month - 1, date))) + ((hours * 60 + minutes) * 60 + seconds) * SEC;
}

const MOSCOW = { latDeg: 55.7558, lonDeg: 37.6173 };
const ALL = [1, 2, 3, 4, 5, 6, 7];

// 22.10.2026 — четверг; 23-е — пятница, 24-е — суббота, 26-е — понедельник.

test("«В 07:00»: тот же день, следующий, через полночь и строго после", () => {
  const seven = { type: "schedule", mode: "time", days: ALL, at: "07:00" };
  assert.equal(scheduleNextAt(seven, at(2026, 10, 22, 6, 59)), at(2026, 10, 22, 7, 0));
  assert.equal(scheduleNextAt(seven, at(2026, 10, 22, 7, 0)), at(2026, 10, 23, 7, 0), "миг срабатывания не повторяется");
  assert.equal(scheduleNextAt(seven, at(2026, 10, 22, 23, 30)), at(2026, 10, 23, 7, 0), "переход суток");
  assert.equal(scheduleNextAt(seven, at(2026, 12, 31, 8, 0)), at(2027, 1, 1, 7, 0), "и года");
  // Только будни: из пятницы — в понедельник.
  const weekdays = { ...seven, days: [1, 2, 3, 4, 5] };
  assert.equal(scheduleNextAt(weekdays, at(2026, 10, 23, 8, 0)), at(2026, 10, 26, 7, 0));
  // Только суббота: из субботы после срабатывания — в следующую.
  const saturday = { ...seven, days: [6], at: "23:15" };
  assert.equal(scheduleNextAt(saturday, at(2026, 10, 24, 23, 15)), at(2026, 10, 31, 23, 15));
  // Дней не выбрано — не срабатывает никогда; негодное время — тоже.
  assert.equal(scheduleNextAt({ ...seven, days: [] }, at(2026, 10, 22)), null);
  assert.equal(scheduleNextAt({ ...seven, at: "25:00" }, at(2026, 10, 22)), null);
  assert.equal(scheduleNextAt({ ...seven, at: undefined }, at(2026, 10, 22)), null);
  assert.equal(scheduleNextAt({ ...seven, mode: "когда-нибудь" }, at(2026, 10, 22)), null);
});

test("«Каждые N» идут от запуска, по выбранным дням", () => {
  const launch = at(2026, 10, 22, 10, 3, 17);
  const every = { type: "schedule", mode: "every", days: ALL, everySec: 600 };
  // Первое срабатывание — через N после запуска, дальше цепочкой.
  const first = scheduleNextAt(every, launch);
  assert.equal(first, launch + 10 * MIN);
  assert.equal(scheduleNextAt(every, first), launch + 20 * MIN);
  // Перемотали часы в середину промежутка — сетка остаётся сеткой запуска.
  assert.equal(scheduleNextAt(every, launch + 25 * MIN, null, launch), launch + 30 * MIN);
  // Через полночь: запуск в четверг 23:55, только четверги — следующий четверг.
  const late = at(2026, 10, 22, 23, 55);
  const thursdays = { ...every, days: [4] };
  assert.equal(scheduleNextAt({ ...every, days: [5] }, late), at(2026, 10, 23, 0, 5), "пятница разрешена");
  assert.equal(scheduleNextAt(thursdays, late, null, late), at(2026, 10, 29, 0, 5), "пятница пропущена");
  // Каждые 2 часа с секундами — без накопления ошибки.
  const twoHours = { ...every, everySec: 7200 };
  assert.equal(scheduleNextAt(twoHours, launch + 3 * HOUR, null, launch), launch + 4 * HOUR);
  assert.equal(scheduleNextAt({ ...every, everySec: 0 }, launch), null);
  assert.equal(scheduleNextAt({ ...every, everySec: "часто" }, launch), null);
});

test("восход и закат без координат — 9:00 и 21:00 летом и зимой, со смещением", () => {
  const rise = { type: "schedule", mode: "sunrise", days: ALL, offsetSec: 0 };
  const set = { type: "schedule", mode: "sunset", days: ALL, offsetSec: -30 * 60 };
  assert.equal(scheduleNextAt(rise, at(2026, 6, 21, 0, 0), null), at(2026, 6, 21, 9, 0));
  assert.equal(scheduleNextAt(rise, at(2026, 12, 21, 0, 0), { latDeg: null, lonDeg: null }), at(2026, 12, 21, 9, 0));
  assert.equal(scheduleNextAt(set, at(2026, 12, 21, 12, 0)), at(2026, 12, 21, 20, 30), "за полчаса до заката");
  assert.equal(scheduleNextAt(set, at(2026, 12, 21, 20, 30)), at(2026, 12, 22, 20, 30), "после — завтра");
  const after = { ...rise, offsetSec: 90 * 60 };
  assert.equal(scheduleNextAt(after, at(2026, 10, 22, 10, 0)), at(2026, 10, 22, 10, 30), "через полтора часа после");
  // Только воскресенье.
  assert.equal(scheduleNextAt({ ...rise, days: [7] }, at(2026, 10, 22)), at(2026, 10, 25, 9, 0));
  // Смещение уводит закат за полночь — срабатывает в ночь после заката.
  const night = { ...set, offsetSec: 4 * 3600 };
  assert.equal(scheduleNextAt(night, at(2026, 10, 22, 23, 0)), at(2026, 10, 23, 1, 0));
  const plain = sunTimes(at(2026, 6, 21, 15, 0), null);
  assert.equal(plain.riseAt, at(2026, 6, 21, 9, 0));
  assert.equal(plain.setAt, at(2026, 6, 21, 21, 0));
  assert.equal(plain.bySite, false);
});

test("восход и закат по координатам — тем же счётом, что солнце «Объёма»", () => {
  const rise = { type: "schedule", mode: "sunrise", days: ALL, offsetSec: 0 };
  const set = { type: "schedule", mode: "sunset", days: ALL, offsetSec: 0 };
  for (const [month, date] of [
    [6, 21],
    [12, 21],
  ]) {
    const day = volumeDayNumberOf(new Date(2026, month - 1, date));
    const volume = volumeDayTimes(MOSCOW, volumeDayDateOf(day));
    const start = clockDayMs(day);
    // Спрашиваем за час до события: в чужом поясе восход Москвы бывает и до
    // полуночи, и после следующей — сутки «Объёма» те же, а миг другой.
    const riseAt = scheduleNextAt(rise, start + volume.riseMin * MIN - HOUR, MOSCOW);
    const setAt = scheduleNextAt(set, start + volume.setMin * MIN - HOUR, MOSCOW);
    // До секунды — тот же счёт; в карточке планировщика — то же время.
    assert.ok(Math.abs(riseAt - (start + volume.riseMin * MIN)) <= 500, month + ": восход разошёлся с «Объёмом»");
    assert.ok(Math.abs(setAt - (start + volume.setMin * MIN)) <= 500, month + ": закат разошёлся с «Объёмом»");
    const today = sunTimes(start + 12 * HOUR, MOSCOW);
    assert.equal(today.riseAt, riseAt);
    assert.equal(today.setAt, setAt);
    assert.equal(today.bySite, true);
  }
  // Таблицы: в Москве 21 июня день 17 ч 33 мин, 21 декабря — 7 ч.
  const june = sunTimes(at(2026, 6, 21), MOSCOW);
  const december = sunTimes(at(2026, 12, 21), MOSCOW);
  assert.ok(Math.abs(june.setAt - june.riseAt - (17 * HOUR + 33 * MIN)) < 12 * MIN);
  assert.ok(Math.abs(december.setAt - december.riseAt - 7 * HOUR) < 12 * MIN);
  // Восход со смещением «до» — раньше восхода ровно на смещение.
  const before = scheduleNextAt({ ...rise, offsetSec: -45 * 60 }, june.riseAt - 2 * HOUR, MOSCOW);
  assert.equal(before, june.riseAt - 45 * MIN);
});

test("полярная ночь: восхода нет — планировщик ждёт первого настоящего", () => {
  const polar = { latDeg: 78.2, lonDeg: 15.6 };
  const rise = { type: "schedule", mode: "sunrise", days: ALL, offsetSec: 0 };
  const from = at(2026, 12, 21);
  const next = scheduleNextAt(rise, from, polar);
  assert.ok(next !== null && next - from > 30 * DAY, "восход посреди полярной ночи");
  const times = sunTimes(next, polar);
  assert.ok(times.setAt > times.riseAt && times.setAt - times.riseAt < DAY, "в день срабатывания солнце встаёт и садится");
});

test("период внутри суток: начало входит, конец — нет", () => {
  const day = { type: "period", days: ALL, from: "07:00", to: "23:00", trigger: true };
  assert.equal(periodContains(day, at(2026, 10, 22, 6, 59, 59)), false);
  assert.equal(periodContains(day, at(2026, 10, 22, 7, 0)), true);
  assert.equal(periodContains(day, at(2026, 10, 22, 22, 59, 59)), true);
  assert.equal(periodContains(day, at(2026, 10, 22, 23, 0)), false);
  assert.deepEqual(periodNextEdge(day, at(2026, 10, 22, 6, 0)), { at: at(2026, 10, 22, 7, 0), edge: "start" });
  assert.deepEqual(periodNextEdge(day, at(2026, 10, 22, 7, 0)), { at: at(2026, 10, 22, 23, 0), edge: "end" });
  assert.deepEqual(periodNextEdge(day, at(2026, 10, 22, 23, 0)), { at: at(2026, 10, 23, 7, 0), edge: "start" });
});

test("период через полночь 22:00–06:00: дни недели — день начала периода", () => {
  const friday = { type: "period", days: [5], from: "22:00", to: "06:00", trigger: false };
  assert.equal(periodContains(friday, at(2026, 10, 23, 23, 0)), true, "пятница, 23:00");
  assert.equal(periodContains(friday, at(2026, 10, 24, 5, 59)), true, "ночь на субботу — ещё пятничный период");
  assert.equal(periodContains(friday, at(2026, 10, 24, 6, 0)), false);
  assert.equal(periodContains(friday, at(2026, 10, 24, 23, 0)), false, "суббота не выбрана");
  assert.equal(periodContains(friday, at(2026, 10, 23, 5, 0)), false, "ночь на пятницу — четвергов период");
  assert.equal(periodContains(friday, at(2026, 10, 22, 23, 0)), false);
  assert.deepEqual(periodNextEdge(friday, at(2026, 10, 22, 12, 0)), { at: at(2026, 10, 23, 22, 0), edge: "start" });
  assert.deepEqual(periodNextEdge(friday, at(2026, 10, 23, 22, 0)), { at: at(2026, 10, 24, 6, 0), edge: "end" });
  assert.deepEqual(periodNextEdge(friday, at(2026, 10, 24, 6, 0)), { at: at(2026, 10, 30, 22, 0), edge: "start" });
  // Каждый день: края чередуются, глубокая ночь — внутри.
  const nightly = { ...friday, days: ALL };
  assert.equal(periodContains(nightly, at(2026, 10, 26, 3, 0)), true);
  assert.equal(periodContains(nightly, at(2026, 10, 26, 12, 0)), false);
  assert.deepEqual(periodNextEdge(nightly, at(2026, 10, 26, 3, 0)), { at: at(2026, 10, 26, 6, 0), edge: "end" });
  assert.deepEqual(periodNextEdge(nightly, at(2026, 10, 26, 6, 0)), { at: at(2026, 10, 26, 22, 0), edge: "start" });
});

test("период без краёв: сплошной — краёв нет; пустой и негодный — ничего", () => {
  // «00:00–00:00» — сутки целиком: каждый день подряд значит «всегда», и края нет.
  const always = { type: "period", days: ALL, from: "00:00", to: "00:00" };
  assert.equal(periodContains(always, at(2026, 10, 22, 13, 37)), true);
  assert.equal(periodNextEdge(always, at(2026, 10, 22)), null);
  // Только понедельник целиком: начало в 00:00 понедельника, конец в 00:00 вторника.
  const monday = { ...always, days: [1] };
  assert.deepEqual(periodNextEdge(monday, at(2026, 10, 22)), { at: at(2026, 10, 26, 0, 0), edge: "start" });
  assert.deepEqual(periodNextEdge(monday, at(2026, 10, 26)), { at: at(2026, 10, 27, 0, 0), edge: "end" });
  assert.equal(periodContains({ ...always, days: [] }, at(2026, 10, 22)), false);
  assert.equal(periodNextEdge({ ...always, days: [] }, at(2026, 10, 22)), null);
  assert.equal(periodContains({ ...always, from: "утро" }, at(2026, 10, 22)), false);
  assert.equal(periodNextEdge({ ...always, to: null }, at(2026, 10, 22)), null);
});

test("Cron.schedule: выражения сценариев Sprut.Hub_Tools", () => {
  const noon = at(2026, 10, 22, 12, 0);
  // Полночь каждый день — VirtualThermostat, ExternalTempSensor, WinterSummer, IsDayOff.
  assert.equal(cronNextAt("0 0 0 * * *", noon), at(2026, 10, 23, 0, 0));
  // Каждые 15 минут — проверка отказа VirtualThermostat.
  assert.equal(cronNextAt("0 */15 * * * *", at(2026, 10, 22, 10, 7, 30)), at(2026, 10, 22, 10, 15));
  assert.equal(cronNextAt("0 */15 * * * *", at(2026, 10, 22, 10, 45)), at(2026, 10, 22, 11, 0));
  // Каждые 30 минут и каждый час — ExternalTempSensor.
  assert.equal(cronNextAt("0 */30 * * * *", at(2026, 10, 22, 10, 0)), at(2026, 10, 22, 10, 30));
  assert.equal(cronNextAt("0 0 * * * *", at(2026, 10, 22, 10, 0) + 500), at(2026, 10, 22, 11, 0));
  // «Ежедневно в полдень» из AverrageTempAndHum на деле — каждый час в :12.
  assert.equal(cronNextAt("0 12 * * * *", at(2026, 10, 22, 10, 20)), at(2026, 10, 22, 11, 12));
  // Каждую минуту — его же отладка.
  assert.equal(cronNextAt("0 * * * * *", at(2026, 10, 22, 10, 0, 30)), at(2026, 10, 22, 10, 1));
  // Секунды первыми — CircadianLight: `seconds + " */5 * * * *"`.
  assert.equal(cronNextAt("17 */5 * * * *", at(2026, 10, 22, 10, 0)), at(2026, 10, 22, 10, 0, 17));
  assert.equal(cronNextAt("17 */5 * * * *", at(2026, 10, 22, 10, 0, 17)), at(2026, 10, 22, 10, 5, 17));
  // Scheduler: `0 ${минуты} ${часы} * * *`.
  assert.equal(cronNextAt("0 30 7 * * *", noon), at(2026, 10, 23, 7, 30));
});

test("Cron.schedule: списки, диапазоны, шаги, «?», дни недели и месяцы", () => {
  const thursday = at(2026, 10, 22, 12, 0);
  // `?` — «любой», как в Quartz; `0/30` — с нуля через тридцать.
  assert.equal(cronNextAt("0 0/30 * ? * *", at(2026, 10, 22, 10, 10)), at(2026, 10, 22, 10, 30));
  assert.equal(cronNextAt("0 30 7 * * ?", thursday), at(2026, 10, 23, 7, 30));
  // Диапазон с шагом и будни словами: 9, 13 и 17 часов с понедельника по пятницу.
  assert.equal(cronNextAt("0 0 9-17/4 * * MON-FRI", at(2026, 10, 23, 13, 0)), at(2026, 10, 23, 17, 0));
  assert.equal(cronNextAt("0 0 9-17/4 * * MON-FRI", at(2026, 10, 23, 17, 0)), at(2026, 10, 26, 9, 0));
  // Списки: понедельник и среда, 8:00 и 8:30.
  assert.equal(cronNextAt("0 0,30 8 * * 1,3", thursday), at(2026, 10, 26, 8, 0));
  assert.equal(cronNextAt("0 0,30 8 * * 1,3", at(2026, 10, 26, 8, 0)), at(2026, 10, 26, 8, 30));
  // Воскресенье — и 0, и 7.
  assert.equal(cronNextAt("0 0 10 * * 0", thursday), at(2026, 10, 25, 10, 0));
  assert.equal(cronNextAt("0 0 10 * * 7", thursday), at(2026, 10, 25, 10, 0));
  assert.equal(cronNextAt("0 0 10 * * SUN", thursday), at(2026, 10, 25, 10, 0));
  // Число и месяц: Новый год и ближайшее 29 февраля.
  assert.equal(cronNextAt("0 0 0 1 1 *", thursday), at(2027, 1, 1));
  assert.equal(cronNextAt("0 0 12 29 FEB *", thursday), at(2028, 2, 29, 12, 0));
  // И число, и день недели заданы — срабатывает любое из двух (как cron-parser).
  assert.equal(cronNextAt("0 0 8 1 * MON", thursday), at(2026, 10, 26, 8, 0));
  assert.equal(cronNextAt("0 0 8 1 * MON", at(2026, 10, 31)), at(2026, 11, 1, 8, 0));
});

test("Cron.schedule: негодное выражение — null, а не догадка", () => {
  const from = at(2026, 10, 22);
  for (const bad of ["0 0 * *", "0 0 0 * * * *", "61 * * * * *", "0 0 25 * * *", "0 */0 * * * *", "0 0 0 L * *", "", null, "a b c d e f"]) {
    assert.equal(cronNextAt(bad, from), null, String(bad));
  }
  assert.equal(cronNextAt("0 0 0 31 2 *", from), null, "31 февраля не наступает");
});
