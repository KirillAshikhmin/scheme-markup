// Математика расписаний имитации (таск 02 сценариев; истории 3.3–3.5, 4.9, 4.10).
//
// Здесь только счёт «когда»: следующее срабатывание планировщика, попадание в
// период и его края, следующий миг `Cron.schedule`. Кто и что по ним делает —
// движок и блоки сценариев; они ставят найденный миг в очередь виртуального
// времени (`sim/timers.js`) и спрашивают следующий после срабатывания.
//
// Время — местные миллисекунды часов имитации (`clockMath.js`, «время одним
// числом»): «07:00» — всегда `начало суток + 7 ч`, день недели и час читаются
// без часового пояса. Дни недели — 1 = понедельник … 7 = воскресенье, как в
// блоках и в Sprut.Hub. Списка дней нет вовсе — каждый день; пустой список —
// ни одного дня (такое расписание не срабатывает).
//
// Все ответы — **строго после** данного мига: сработавшее в 07:00 расписание,
// спрошенное из 07:00, отвечает завтрашними 07:00, а не тем же мигом снова.
import {
  CLOCK_DAY_MS,
  clockDayMs,
  clockWeekday,
  volumeClockParse,
  volumeDayDateOf,
  volumeDayTimes,
} from "../clockMath.js";

const SCHEDULE_MIN_MS = 60000;

/** Дни недели условия: множество чисел 1…7. Нет списка — каждый день. */
function scheduleDaysOf(days) {
  if (!Array.isArray(days)) return new Set([1, 2, 3, 4, 5, 6, 7]);
  return new Set(days.map(Number).filter((day) => Number.isInteger(day) && day >= 1 && day <= 7));
}

/**
 * Восход и закат суток, в которые попадает `dayMs`, — **тем же счётом, что
 * солнце «Объёма»** (`volumeDayTimes` на ту же дату). Без координат — 9:00 и
 * 21:00, как в «Объёме». К ответу `volumeDayTimes` добавлены `day` (номер
 * суток) и `riseAt`/`setAt` — миги в местных миллисекундах, до целой секунды:
 * планировщик Sprut срабатывает «в ту минуту и секунду, когда случится восход».
 */
export function sunTimes(dayMs, site) {
  const day = Math.floor((Number(dayMs) || 0) / CLOCK_DAY_MS);
  const times = volumeDayTimes(site || null, volumeDayDateOf(day));
  const start = clockDayMs(day);
  return {
    ...times,
    day,
    riseAt: start + Math.round(times.riseMin * 60) * 1000,
    setAt: start + Math.round(times.setMin * 60) * 1000,
  };
}

/** Встаёт ли солнце в эти сутки: в полярный день и в полярную ночь — нет. */
function scheduleSunCrosses(times) {
  if (!times.bySite) return true;
  const span = times.setMin - times.riseMin;
  return span > 0 && span < 1440;
}

/**
 * Следующее срабатывание планировщика строго после `afterMs` или `null`.
 *
 * `condition` — блок `{type: "schedule", mode, days, at?, everySec?, offsetSec?}`:
 *
 * - `"time"` — в `at` («ЧЧ:ММ») по выбранным дням;
 * - `"every"` — каждые `everySec` секунд **от запуска** `fromMs` (дома или
 *   ручного запуска сценария; по умолчанию — от `afterMs`, то есть цепочкой от
 *   прошлого срабатывания); срабатывают только миги сетки, выпавшие на
 *   выбранные дни;
 * - `"sunrise"`/`"sunset"` — восход/закат по координатам `site`
 *   (`{latDeg, lonDeg}`, как у `volumeSiteOf`) со смещением `offsetSec`
 *   (минус — «до», плюс — «после»); день недели — день самого восхода/заката.
 */
export function scheduleNextAt(condition, afterMs, site = null, fromMs = afterMs) {
  const after = Number(afterMs);
  if (!condition || !Number.isFinite(after)) return null;
  const days = scheduleDaysOf(condition.days);
  if (days.size === 0) return null;
  if (condition.mode === "time") return scheduleTimeNext(condition, after, days);
  if (condition.mode === "every") return scheduleEveryNext(condition, after, days, fromMs);
  if (condition.mode === "sunrise" || condition.mode === "sunset") return scheduleSunNext(condition, after, days, site);
  return null;
}

function scheduleTimeNext(condition, after, days) {
  const minutes = volumeClockParse(condition.at);
  if (minutes === null) return null;
  const first = Math.floor(after / CLOCK_DAY_MS);
  for (let day = first; day <= first + 7; day += 1) {
    const at = clockDayMs(day) + minutes * SCHEDULE_MIN_MS;
    if (at > after && days.has(clockWeekday(at))) return at;
  }
  return null;
}

function scheduleEveryNext(condition, after, days, fromMs) {
  const step = Number(condition.everySec) * 1000;
  if (!Number.isFinite(step) || step <= 0) return null;
  const anchor = Number.isFinite(Number(fromMs)) ? Number(fromMs) : after;
  let k = Math.floor((after - anchor) / step) + 1;
  let at = anchor + k * step;
  while (at <= after) {
    k += 1;
    at = anchor + k * step;
  }
  const limit = after + 8 * CLOCK_DAY_MS + step;
  while (at <= limit) {
    if (days.has(clockWeekday(at))) return at;
    // День не выбран — сразу к первому мигу сетки в следующих сутках.
    const next = clockDayMs(Math.floor(at / CLOCK_DAY_MS) + 1);
    k = Math.max(k + 1, Math.ceil((next - anchor) / step));
    at = anchor + k * step;
  }
  return null;
}

function scheduleSunNext(condition, after, days, site) {
  const offset = (Number(condition.offsetSec) || 0) * 1000;
  const key = condition.mode === "sunrise" ? "riseAt" : "setAt";
  // Смещение может увести срабатывание в соседние сутки: начинаем с суток,
  // чей восход со смещением ещё способен прийтись после `after`.
  const back = Math.ceil(Math.abs(offset) / CLOCK_DAY_MS) + 1;
  const first = Math.floor(after / CLOCK_DAY_MS) - back;
  // Год с запасом: полярная ночь длится месяцами, а дальше года восхода нет
  // только у неверных координат — их `volumeDayTimes` и так считает умолчанием.
  for (let day = first; day <= first + back + 400; day += 1) {
    const start = clockDayMs(day);
    if (!days.has(clockWeekday(start))) continue;
    const times = sunTimes(start, site);
    if (!scheduleSunCrosses(times)) continue;
    const at = times[key] + offset;
    if (at > after) return at;
  }
  return null;
}

// ——— период времени (история 4.10) ——————————————————————————————————————
//
// Период «с ЧЧ:ММ по ЧЧ:ММ» начинается в выбранный день и длится до конца; через
// полночь — до утра следующих суток: «пятница 22:00–06:00» — это ночь с пятницы
// на субботу. Начало входит в период, конец — нет. «С 00:00 по 00:00» — сутки
// целиком. Края — миги, когда «внутри» меняется: идущие подряд периоды без
// зазора края не дают.

/** `{from, len, days}` в минутах или `null`, если период не разобрать. */
function periodSpan(condition) {
  if (!condition) return null;
  const from = volumeClockParse(condition.from);
  const to = volumeClockParse(condition.to);
  if (from === null || to === null) return null;
  const len = (((to - from) % 1440) + 1440) % 1440 || 1440;
  return { from, len, days: scheduleDaysOf(condition.days) };
}

function periodCovers(span, ms) {
  const day = Math.floor(ms / CLOCK_DAY_MS);
  for (const start of [day, day - 1]) {
    const begin = clockDayMs(start) + span.from * SCHEDULE_MIN_MS;
    if (!span.days.has(clockWeekday(begin))) continue;
    if (ms >= begin && ms < begin + span.len * SCHEDULE_MIN_MS) return true;
  }
  return false;
}

/** Внутри ли миг `ms` периода `{type: "period", days, from, to}`. */
export function periodContains(condition, ms) {
  const span = periodSpan(condition);
  const at = Number(ms);
  if (!span || !Number.isFinite(at)) return false;
  return periodCovers(span, at);
}

/**
 * Ближайший край периода строго после `afterMs`: `{at, edge: "start" | "end"}`
 * — начало («Тогда» у периода-триггера) или конец («Иначе»); `null` — краёв
 * нет (дней не выбрано, период сплошной или не разобран).
 */
export function periodNextEdge(condition, afterMs) {
  const span = periodSpan(condition);
  const after = Number(afterMs);
  if (!span || !Number.isFinite(after) || span.days.size === 0) return null;
  const first = Math.floor(after / CLOCK_DAY_MS) - 1;
  const marks = [];
  for (let day = first; day <= first + 9; day += 1) {
    const begin = clockDayMs(day) + span.from * SCHEDULE_MIN_MS;
    marks.push(begin, begin + span.len * SCHEDULE_MIN_MS);
  }
  marks.sort((a, b) => a - b);
  for (const at of marks) {
    if (at <= after) continue;
    const was = periodCovers(span, at - 1);
    const now = periodCovers(span, at);
    if (was !== now) return { at, edge: now ? "start" : "end" };
  }
  return null;
}

// ——— Cron.schedule Sprut.Hub ————————————————————————————————————————————
//
// Шесть полей, **секунды первые**: «сек мин час день месяц день-недели»
// (research/spruthub-tools.md §3.2). Понимается то же, что у ScenarioSimulator
// (cron-parser): `*` и `?` — любое; списки `a,b`; диапазоны `a-b`; шаги `*/N`,
// `a/N`, `a-b/N`; месяцы `JAN…DEC`, дни недели `SUN…SAT`, а числами — 0…7, где
// и 0, и 7 — воскресенье. Заданы и число, и день недели — срабатывает любое из
// двух. Чего нет (`L`, `W`, `#`, седьмое поле года) — выражение негодно: `null`,
// а не догадка.

const CRON_FIELDS = [
  { min: 0, max: 59 },
  { min: 0, max: 59 },
  { min: 0, max: 23 },
  { min: 1, max: 31 },
  { min: 1, max: 12, names: ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"], base: 1 },
  { min: 0, max: 7, names: ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"], base: 0 },
];

function cronValue(text, field) {
  const word = text.toUpperCase();
  if (field.names && field.names.includes(word)) return field.names.indexOf(word) + field.base;
  if (!/^\d+$/.test(text)) return null;
  const value = Number(text);
  return value >= field.min && value <= field.max ? value : null;
}

/** Поле cron → множество значений или `null`, если поле негодно. */
function cronField(text, field) {
  const out = new Set();
  for (const part of text.split(",")) {
    const match = /^([^/]+)(?:\/(\d+))?$/.exec(part);
    if (!match) return null;
    const step = match[2] === undefined ? 1 : Number(match[2]);
    if (!(step >= 1)) return null;
    let from;
    let to;
    if (match[1] === "*" || match[1] === "?") {
      from = field.min;
      to = field.max;
    } else {
      const range = match[1].split("-");
      if (range.length > 2) return null;
      from = cronValue(range[0], field);
      to = range.length === 2 ? cronValue(range[1], field) : match[2] === undefined ? from : field.max;
      if (from === null || to === null || from > to) return null;
    }
    for (let value = from; value <= to; value += step) out.add(value);
  }
  return out;
}

/** Разбор выражения: шесть множеств или `null`. */
function cronParse(expr) {
  const parts = String(expr === null || expr === undefined ? "" : expr)
    .trim()
    .split(/\s+/);
  if (parts.length !== 6) return null;
  const sets = parts.map((part, index) => cronField(part, CRON_FIELDS[index]));
  if (sets.some((set) => set === null)) return null;
  const weekdays = sets[5];
  if (weekdays.delete(7)) weekdays.add(0);
  return {
    seconds: sets[0],
    minutes: sets[1],
    hours: sets[2],
    dates: sets[3],
    months: sets[4],
    weekdays,
    anyDate: sets[3].size === 31,
    anyWeekday: weekdays.size === 7,
  };
}

function cronDayMatches(cron, at) {
  const date = cron.dates.has(at.getUTCDate());
  const weekday = cron.weekdays.has(at.getUTCDay());
  if (cron.anyDate && cron.anyWeekday) return true;
  if (cron.anyDate) return weekday;
  if (cron.anyWeekday) return date;
  return date || weekday;
}

/**
 * Следующий миг 6-полевого выражения `Cron.schedule` строго после `afterMs`
 * (местные миллисекунды), до целой секунды; `null` — выражение негодно или не
 * наступает в ближайшие восемь лет (31 февраля).
 */
export function cronNextAt(expr6, afterMs) {
  const cron = cronParse(expr6);
  const after = Number(afterMs);
  if (!cron || !Number.isFinite(after)) return null;
  let t = Math.floor(after / 1000) * 1000 + 1000;
  const limit = after + 8 * 366 * CLOCK_DAY_MS;
  while (t <= limit) {
    const at = new Date(t);
    const year = at.getUTCFullYear();
    const month = at.getUTCMonth();
    const date = at.getUTCDate();
    const hour = at.getUTCHours();
    const minute = at.getUTCMinutes();
    if (!cron.months.has(month + 1)) {
      t = Date.UTC(year, month + 1, 1);
      continue;
    }
    if (!cronDayMatches(cron, at)) {
      t = Date.UTC(year, month, date + 1);
      continue;
    }
    if (!cron.hours.has(hour)) {
      t = Date.UTC(year, month, date, hour + 1);
      continue;
    }
    if (!cron.minutes.has(minute)) {
      t = Date.UTC(year, month, date, hour, minute + 1);
      continue;
    }
    for (let second = at.getUTCSeconds(); second < 60; second += 1) {
      if (cron.seconds.has(second)) return Date.UTC(year, month, date, hour, minute, second);
    }
    t = Date.UTC(year, month, date, hour, minute + 1);
  }
  return null;
}
