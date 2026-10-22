// Часы и солнце модулем без DOM (таск 02 сценариев, R09, R30i).
//
// Что здесь держится:
//
//   1. **Один счёт.** Формулы часов и рассвета живут в `clockMath.js`, и
//      объявлены они там одним местом: «Объём», сценарии и движок в Worker
//      считают время одной формулой, а не тремя похожими.
//   2. **Чистота.** Модуль ничего не импортирует — его заберёт бандл движка,
//      где нет ни DOM, ни хранилища.
//   3. **Время одним числом.** Местные миллисекунды непрерывны, переводят сутки
//      сами и не знают часового пояса.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  CLOCK_DAY_MS,
  VOLUME_CLOCK_SPEEDS,
  VOLUME_CLOCK_SPEED_DEFAULT,
  clockDayMs,
  clockMsStamp,
  clockSimMs,
  clockStampMs,
  clockWeekday,
  volumeClockFixed,
  volumeClockNow,
  volumeClockSpeedOf,
  volumeClockStamp,
  volumeDayDateOf,
  volumeDayNumberOf,
  volumeDayTimes,
} from "../src/clockMath.js";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src");

function sources(dir = SRC, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) sources(full, out);
    else if (entry.name.endsWith(".js")) out.push({ name: full.slice(SRC.length + 1), text: readFileSync(full, "utf8") });
  }
  return out;
}

test("формулы часов и рассвета объявлены одним местом — clockMath.js", () => {
  const names = [
    "volumeClockNow",
    "volumeClockFixed",
    "volumeClockStamp",
    "volumeClockSpeedOf",
    "VOLUME_CLOCK_SPEEDS",
    "volumeDayTimes",
    "volumeDayNumberOf",
  ];
  const all = sources();
  for (const name of names) {
    const decl = new RegExp("^(?:export\\s+)?(?:function|const|let|var)\\s+" + name + "\\b", "m");
    const owners = all.filter((file) => decl.test(file.text)).map((file) => file.name);
    assert.deepEqual(owners, ["clockMath.js"], name + " объявлено в: " + owners.join(", "));
  }
  // Ни одного импорта: модуль уедет в бандл движка, где нет ни страницы, ни
  // хранилища, и потянуть за собой «Объём» он не должен.
  const own = all.find((file) => file.name === "clockMath.js").text;
  assert.doesNotMatch(own, /^\s*import\b/m, "clockMath.js что-то импортирует");
});

test("часы: прежний счёт — ускорение, сутки и умолчания", () => {
  assert.deepEqual(VOLUME_CLOCK_SPEEDS, [1, 60, 120, 240, 480, 960]);
  assert.equal(volumeClockSpeedOf(7), VOLUME_CLOCK_SPEED_DEFAULT, "чужое ускорение — умолчание 60");
  const day = volumeDayNumberOf(new Date(2026, 9, 22));
  // 23:30 при ускорении 60: минута настоящего времени — час на часах, и
  // полночь переводит число.
  const clock = { fixed: false, fromDay: day, fromMin: 23 * 60 + 30, atMs: 1000, speed: 60 };
  assert.deepEqual(volumeClockStamp(clock, 1000 + 60_000), { day: day + 1, minutes: 30 });
  const fixed = volumeClockFixed(7 * 60, 60, day);
  assert.deepEqual(volumeClockStamp(fixed, 9e12), { day, minutes: 7 * 60 }, "стоячее время не идёт");
  const real = volumeClockNow(5000, new Date(2026, 9, 22, 8, 15), 1);
  assert.deepEqual(volumeClockStamp(real, 5000), { day, minutes: 8 * 60 + 15 });
});

test("рассвет и закат: без координат 9:00 и 21:00, с координатами — Москва летом и зимой", () => {
  const plain = volumeDayTimes(null, volumeDayDateOf(volumeDayNumberOf(new Date(2026, 5, 21))));
  assert.equal(plain.riseMin, 9 * 60);
  assert.equal(plain.setMin, 21 * 60);
  assert.equal(plain.bySite, false);
  // Таблицы восхода: Москва, 21 июня — день 17 ч 33 мин, 21 декабря — 7 ч 00 мин.
  // Уравнения времени у счёта нет нарочно, поэтому мерой, а не минутой.
  const site = { latDeg: 55.7558, lonDeg: 37.6173 };
  const june = volumeDayTimes(site, new Date(2026, 5, 21, 12));
  const december = volumeDayTimes(site, new Date(2026, 11, 21, 12));
  assert.ok(Math.abs(june.setMin - june.riseMin - (17 * 60 + 33)) < 12, "июнь: " + (june.setMin - june.riseMin));
  assert.ok(Math.abs(december.setMin - december.riseMin - 7 * 60) < 12, "декабрь: " + (december.setMin - december.riseMin));
  // Солнечный полдень в Москве — около 09:30 UTC; пояс берётся у самой даты.
  const noonUtc = (june.riseMin + june.setMin) / 2 + new Date(2026, 5, 21, 12).getTimezoneOffset();
  assert.ok(Math.abs(noonUtc - (9 * 60 + 30)) < 10, "полдень по UTC: " + noonUtc);
});

test("время имитации одним числом: местные миллисекунды", () => {
  const day = volumeDayNumberOf(new Date(2026, 9, 22));
  assert.equal(CLOCK_DAY_MS, 86_400_000);
  assert.equal(clockDayMs(day), day * 86_400_000);
  assert.equal(clockStampMs({ day, minutes: 7 * 60 }), day * 86_400_000 + 7 * 3_600_000);
  assert.deepEqual(clockMsStamp(day * 86_400_000 + 90 * 60_000), { day, minutes: 90 });
  // Читается getUTC-методами: на часах имитации ровно то, что поставили.
  const at = new Date(clockStampMs({ day, minutes: 7 * 60 + 5 }));
  assert.equal(at.getUTCHours(), 7);
  assert.equal(at.getUTCMinutes(), 5);
  assert.equal(at.getUTCDate(), 22);
  // Стоячие часы — стоящее число.
  assert.equal(clockSimMs(volumeClockFixed(7 * 60, 60, day), 123456), day * 86_400_000 + 7 * 3_600_000);
  // Идущие: ×60 — секунда настоящего времени, минута имитации; полночь не
  // рвёт число и не теряет доли минуты.
  const clock = { fixed: false, fromDay: day, fromMin: 23 * 60 + 59.5, atMs: 0, speed: 60 };
  const before = clockSimMs(clock, 0);
  assert.equal(clockSimMs(clock, 1000) - before, 60_000);
  assert.deepEqual(clockMsStamp(clockSimMs(clock, 1000)), volumeClockStamp(clock, 1000));
});

test("день недели: 1 — понедельник … 7 — воскресенье", () => {
  // 22.10.2026 — четверг, 25.10.2026 — воскресенье, 26.10.2026 — понедельник.
  const thursday = clockDayMs(volumeDayNumberOf(new Date(2026, 9, 22)));
  assert.equal(clockWeekday(thursday), 4);
  assert.equal(clockWeekday(thursday + 3 * CLOCK_DAY_MS + 23 * 3_600_000), 7);
  assert.equal(clockWeekday(thursday + 4 * CLOCK_DAY_MS), 1);
  assert.equal(clockWeekday(0), 4, "1 января 1970 — четверг");
  assert.equal(clockWeekday(-1), 3, "миг до эпохи — среда");
});
