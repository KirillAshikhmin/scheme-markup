// Часы и солнце: формулы без DOM и без объекта (таск 02 сценариев, R09, R30i).
//
// Слова заказчика (раунд 3): часы — «Ускорение, перемотка и шаг», и они одни на
// всё приложение. Поэтому формулы, по которым «Объём» знал, который час и когда
// встаёт солнце, переехали сюда из `volume.js` **с прежними именами и прежним
// счётом**: «Объём» читает их как читал, а движок имитации в отдельном потоке
// (Worker) берёт ровно тот же счёт — и время у солнца и у сценариев не
// разойдётся ни на секунду.
//
// Модуль чистый: ни импорта, ни DOM, ни хранилища. Состояние часов держит
// `appClock.js`, а здесь — только «что показывает формула в этот миг».
//
// ——— время имитации одним числом ———————————————————————————————————————
//
// Часы живут номером суток и минутами (`{day, minutes}`), а очереди таймеров и
// расписаниям нужно одно число. Это **местное время в миллисекундах**:
// `день × 86 400 000 + минуты × 60 000` — то, что показали бы часы на стене,
// записанное так, будто это UTC. Читать его — `getUTC…`-методами (`new
// Date(ms).getUTCHours()` — час на часах имитации). Ни часового пояса, ни
// перехода на летнее время в этом числе нет: «07:00» — всегда ровно
// `день + 7 ч`, а сутки — всегда 86 400 000 мс.

/** Градус в радианах: им считается склонение и рассвет. */
const CLOCK_DEG = Math.PI / 180;
/** Миллисекунд в сутках времени имитации — у местного числа сутки ровные. */
export const CLOCK_DAY_MS = 86400000;

/** Минут в сутках. */
export const VOLUME_DAY_MIN = 1440;
/** Рассвет и закат по умолчанию — слова заказчика: 9:00 и 21:00. */
export const VOLUME_SUNRISE_MIN = 9 * 60;
export const VOLUME_SUNSET_MIN = 21 * 60;
/**
 * Ускорение времени. Числа — слова заказчика (480, а не 280: «это опечатка»), и
 * каждое читается как «во сколько раз время идёт быстрее настоящего»: 60 → сутки
 * за 24 минуты, 120 → за 12, 240 → за 6, 480 → за 3, 960 → за полторы.
 *
 * **Первый пункт — единица** (G287): «добавь в Ускорение пункт первый — без
 * ускорения. При нажатии Сейчас он и должен выбираться и время идти в реальном
 * времени». Единица — это идущее время, а не стоячее: сутки проходят сутки, и
 * таймер снимка часа при ней живёт, как при любом другом ускорении. Стоячее
 * время — это `volumeClockFixed`, и оно устроено иначе.
 */
export const VOLUME_CLOCK_SPEEDS = [1, 60, 120, 240, 480, 960];
export const VOLUME_CLOCK_SPEED_DEFAULT = 60;
/** «Без ускорения» — то, что выбирает кнопка «Сейчас». */
export const VOLUME_CLOCK_SPEED_REAL = 1;
/** Наклон земной оси: им считаются склонения и солнца, и месяца. */
export const VOLUME_EARTH_TILT_DEG = 23.44;
/**
 * Горизонт, по которому считаются рассвет и закат: −50′ на преломление воздуха
 * и полупоперечник диска (та же мера, что у всех таблиц рассвета). Высота
 * светила отсчитывается **от него**, поэтому ноль высоты приходится ровно на
 * рассвет из подписи окна, а не примерно на него.
 */
export const VOLUME_HORIZON_DEG = -0.833;

/** Минуты суток у настоящих часов. */
export function volumeDayMinutesOf(date) {
  const at = date || new Date();
  return at.getHours() * 60 + at.getMinutes() + at.getSeconds() / 60;
}

/** Минуты в сутках, с переходом через полночь в обе стороны. */
export function volumeWrapMinutes(minutes) {
  const value = Number(minutes);
  if (!Number.isFinite(value)) return 0;
  return ((value % VOLUME_DAY_MIN) + VOLUME_DAY_MIN) % VOLUME_DAY_MIN;
}

/** Часы и минуты строкой — для контрола с часами и для плашки. */
export function volumeClockText(minutes) {
  const value = volumeWrapMinutes(minutes);
  const hours = Math.floor(value / 60);
  const left = Math.floor(value - hours * 60);
  return String(hours).padStart(2, "0") + ":" + String(left).padStart(2, "0");
}

/** «09:30» → минуты суток. `null` — не время. */
export function volumeClockParse(text) {
  const match = /^\s*(\d{1,2})\s*[:.]\s*(\d{1,2})/.exec(String(text || ""));
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!(hours >= 0 && hours < 24) || !(minutes >= 0 && minutes < 60)) return null;
  return hours * 60 + minutes;
}

// ——— дата своим числом (таск 190, G289) ————————————————————————————————
//
// Слова заказчика: «для положения солнца дата нужна, пусть отдельное поле будет
// над полем время».
//
// Дата живёт **номером суток** — целым числом суток гражданского календаря от
// эпохи. Не `Date` и не тройкой чисел, и причина простая: часам нужно
// складывать её с минутами и переваливать через полночь одним сложением
// (`volumeClockStamp`), а `Date` для этого пришлось бы собирать и разбирать на
// каждый кадр. Перевод в обе стороны — `volumeDayNumberOf`/`volumeDayDateOf`,
// и считаются они через `Date.UTC`, то есть не зависят ни от часового пояса, ни
// от перехода на летнее время: номер суток — это «какое сегодня число», а не
// «сколько миллисекунд прошло».

/** Номер суток по гражданской дате: целое число суток от эпохи. */
export function volumeDayNumberOf(date) {
  const at = date || new Date();
  return Math.floor(Date.UTC(at.getFullYear(), at.getMonth(), at.getDate()) / 86400000);
}

/**
 * Обратно: `Date` на полдень этих суток по месту.
 *
 * Полдень, а не полночь, нарочно: из этой даты читают год, месяц и число, а
 * полночь в день перехода на летнее время умеет уехать на сутки назад.
 */
export function volumeDayDateOf(dayNumber) {
  const at = new Date((Number(dayNumber) || 0) * 86400000);
  return new Date(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate(), 12);
}

/** «2026-10-20» — то, что просит и отдаёт поле даты. */
export function volumeDateText(dayNumber) {
  const at = volumeDayDateOf(dayNumber);
  return (
    String(at.getFullYear()).padStart(4, "0") +
    "-" +
    String(at.getMonth() + 1).padStart(2, "0") +
    "-" +
    String(at.getDate()).padStart(2, "0")
  );
}

/**
 * **Дата для человека: «20.10.2026»** (таск 191, G300).
 *
 * Строка часов в углу поля читается боковым зрением, пока человек ходит по
 * комнатам, — ей нужен привычный порядок «день, месяц, год», а не ISO. ISO
 * остаётся у поля ввода (`volumeDateText`): его просит сам браузер, и смешивать
 * эти две строки нельзя — одна для машины, другая для глаза.
 */
export function volumeDateShort(dayNumber) {
  const at = volumeDayDateOf(dayNumber);
  return (
    String(at.getDate()).padStart(2, "0") +
    "." +
    String(at.getMonth() + 1).padStart(2, "0") +
    "." +
    String(at.getFullYear()).padStart(4, "0")
  );
}

/** «2026-10-20» → номер суток. `null` — не дата. */
export function volumeDateParse(text) {
  const match = /^\s*(\d{4})-(\d{1,2})-(\d{1,2})\s*$/.exec(String(text || ""));
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!(month >= 1 && month <= 12) || !(day >= 1 && day <= 31)) return null;
  const at = new Date(Date.UTC(year, month - 1, day));
  // Тридцатое февраля браузер молча переносит на март — такую дату не берём.
  if (at.getUTCMonth() !== month - 1 || at.getUTCDate() !== day) return null;
  return Math.floor(at.getTime() / 86400000);
}

/**
 * Часы объёма.
 *
 * Идущее время — **не накопитель, а формула**: `откуда + (сейчас − когда) ×
 * ускорение`. Поэтому пока объём закрыт, ничего не идёт и не считается, а
 * вернувшийся человек видит время, которое «прошло» за его отсутствие, с
 * одного умножения. Накопитель требовал бы живого таймера в закрытом режиме.
 *
 * `fixed` — время стоит: ровно то, что человек поставил, и ни пересчёта, ни
 * таймера.
 */
export function volumeClockNow(nowMs, date, speed = VOLUME_CLOCK_SPEED_DEFAULT) {
  const at = date || new Date();
  return {
    fixed: false,
    fromDay: volumeDayNumberOf(at),
    fromMin: volumeDayMinutesOf(at),
    atMs: Number(nowMs) || 0,
    speed: volumeClockSpeedOf(speed),
  };
}

export function volumeClockFixed(minutes, speed = VOLUME_CLOCK_SPEED_DEFAULT, day = null) {
  return {
    fixed: true,
    fromDay: day === null || day === undefined ? volumeDayNumberOf(new Date()) : Math.round(Number(day) || 0),
    fromMin: volumeWrapMinutes(minutes),
    atMs: 0,
    speed: volumeClockSpeedOf(speed),
  };
}

/** Своё ускорение: чужое число не берётся — у списка ровно шесть пунктов. */
export function volumeClockSpeedOf(speed) {
  const value = Number(speed);
  return VOLUME_CLOCK_SPEEDS.includes(value) ? value : VOLUME_CLOCK_SPEED_DEFAULT;
}

/** Сколько минут занимают сутки при этом ускорении: 1440, 24, 12, 6, 3 и 1,5. */
export function volumeClockDayMinutes(speed) {
  return VOLUME_DAY_MIN / volumeClockSpeedOf(speed);
}

/**
 * Который час и какое число на часах объёма.
 *
 * **Полночь переводит дату** (G289): время идёт формулой, и сутки у неё не
 * последний разряд, а часть того же числа — минуты от начала `fromDay`. Сколько
 * бы их ни набежало, целые сутки уезжают в номер дня, остаток — в часы. При
 * ускорении 960 это случается каждые полторы минуты настоящего времени, и
 * считается тем же одним сложением, что и час.
 */
export function volumeClockStamp(clock, nowMs) {
  if (!clock) return { day: volumeDayNumberOf(new Date()), minutes: VOLUME_SUNRISE_MIN };
  const day = Number.isFinite(Number(clock.fromDay)) ? Number(clock.fromDay) : volumeDayNumberOf(new Date());
  if (clock.fixed) {
    const fixed = volumeWrapMinutes(clock.fromMin);
    return { day: day + Math.floor(Number(clock.fromMin) / VOLUME_DAY_MIN || 0), minutes: fixed };
  }
  const gone = (Number(nowMs) - Number(clock.atMs)) / 60000;
  const total = Number(clock.fromMin) + gone * volumeClockSpeedOf(clock.speed);
  const over = Math.floor(total / VOLUME_DAY_MIN);
  return { day: day + (Number.isFinite(over) ? over : 0), minutes: volumeWrapMinutes(total) };
}

/** Который час на часах объёма. */
export function volumeClockMinutes(clock, nowMs) {
  return volumeClockStamp(clock, nowMs).minutes;
}

/**
 * Сменить ускорение, не сдвинув время: часы перецепляются за ту минуту и то
 * число, которые показывают сейчас. Иначе выбор «быстрее» прыгал бы временем.
 */
export function volumeClockAt(clock, nowMs, speed) {
  const stamp = volumeClockStamp(clock, nowMs);
  if (clock && clock.fixed) return volumeClockFixed(stamp.minutes, speed, stamp.day);
  return { fixed: false, fromDay: stamp.day, fromMin: stamp.minutes, atMs: Number(nowMs) || 0, speed: volumeClockSpeedOf(speed) };
}

/** Поставить другое число, не тронув ни час, ни ход часов. */
export function volumeClockOnDay(clock, nowMs, day) {
  const stamp = volumeClockStamp(clock, nowMs);
  const next = Math.round(Number(day));
  const put = Number.isFinite(next) ? next : stamp.day;
  if (clock && clock.fixed) return volumeClockFixed(stamp.minutes, clock.speed, put);
  return {
    fixed: false,
    fromDay: put,
    fromMin: stamp.minutes,
    atMs: Number(nowMs) || 0,
    speed: volumeClockSpeedOf(clock ? clock.speed : undefined),
  };
}

/**
 * Долгота солнца по эклиптике в этот день года — то, из чего выходит склонение.
 *
 * Счёт тот же, что был у склонения в таске 181 (формула Купера): нуль
 * приходится на весеннее равноденствие, и за год долгота обходит круг. Держать
 * её отдельным числом нужно месяцу: он ходит по той же эклиптике, только
 * опережает солнце на свою фазу.
 */
export function volumeSunLonDeg(date) {
  const at = date || new Date();
  const start = Date.UTC(at.getFullYear(), 0, 1);
  const day = Math.floor((Date.UTC(at.getFullYear(), at.getMonth(), at.getDate()) - start) / 86400000) + 1;
  return (360 / 365) * (284 + day);
}

/** Склонение светила по его долготе на эклиптике: ось Земли наклонена. */
export function volumeDeclDeg(lonDeg) {
  return VOLUME_EARTH_TILT_DEG * Math.sin(Number(lonDeg) * CLOCK_DEG);
}

/**
 * Рассвет и закат — и всё, из чего они выходят.
 *
 * Без координат — умолчание заказчика: 9:00 и 21:00. С координатами — по
 * широте, дню года и долготе, с часовым поясом браузера.
 *
 * Отдаётся **не только пара минут**: в ответе лежат широта, склонение,
 * солнечный полдень, долгота солнца по эклиптике, часовой пояс и номер суток —
 * то есть всё, по чему место светила считает `volumeSunAt`. Так сделано
 * нарочно: подпись и небо обязаны идти от одних и тех же чисел, иначе рассвет
 * из подписи разойдётся с рассветом в кадре — ровно та ошибка, от которой таск
 * 190 и затевался.
 *
 * **Чего здесь нет нарочно:** уравнения времени (до четверти часа у солнечного
 * полудня) и преломления сверх стандартных 50′. Часы объёма — не астрономия, и
 * четверть часа на рассвете видна только в таблице, а не в кадре.
 *
 * Полярный день и полярная ночь не ломают счёт: в первом сутки целиком день, во
 * втором — ночь, и это правда, а не вырождение.
 */
export function volumeDayTimes(site, date) {
  // `Number(null)` — это нуль, то есть экватор: пустые координаты обязаны
  // читаться пустыми, а не нулевой широтой в Атлантике.
  const number = (value) => (value === null || value === undefined || value === "" ? NaN : Number(value));
  const latDeg = site ? number(site.latDeg) : NaN;
  const lonDeg = site ? number(site.lonDeg) : NaN;
  const at = date || new Date();
  // Номер суток и часовой пояс нужны и без координат: по ним считается возраст
  // луны, а он от широты не зависит.
  const day = { dayNumber: volumeDayNumberOf(at), tzHours: -at.getTimezoneOffset() / 60 };
  if (!Number.isFinite(latDeg) || !Number.isFinite(lonDeg) || Math.abs(latDeg) > 90) {
    return { riseMin: VOLUME_SUNRISE_MIN, setMin: VOLUME_SUNSET_MIN, bySite: false, ...day };
  }
  const sunLonDeg = volumeSunLonDeg(at);
  const declDeg = volumeDeclDeg(sunLonDeg);
  const noonMin = (12 - (lonDeg - 15 * day.tzHours) / 15) * 60;
  const place = { bySite: true, latDeg, declDeg, sunLonDeg, noonMin, ...day };
  const cosH = volumeDayCosH(latDeg, declDeg);
  if (!(cosH > -1)) return { riseMin: noonMin - 720, setMin: noonMin + 720, ...place };
  if (!(cosH < 1)) return { riseMin: noonMin, setMin: noonMin, ...place };
  const half = (Math.acos(cosH) / CLOCK_DEG / 15) * 60;
  return { riseMin: noonMin - half, setMin: noonMin + half, ...place };
}

/**
 * Косинус полуденного часового угла: из него выходит половина дня.
 *
 * `cos H₀ = (sin h₀ − sin φ sin δ) / (cos φ cos δ)`, где `h₀` — горизонт с
 * преломлением. За единицу вышло — солнце не встаёт (полярная ночь), ниже минус
 * единицы — не садится (полярный день).
 */
export function volumeDayCosH(latDeg, declDeg) {
  const lat = Number(latDeg) * CLOCK_DEG;
  const decl = Number(declDeg) * CLOCK_DEG;
  return (
    (Math.sin(VOLUME_HORIZON_DEG * CLOCK_DEG) - Math.sin(lat) * Math.sin(decl)) / (Math.cos(lat) * Math.cos(decl))
  );
}

// ——— перевод часов в одно число и обратно (разбор — в начале модуля) ———————

/**
 * Время имитации в местных миллисекундах: та же формула, что у
 * `volumeClockStamp`, только без разбора на сутки и минуты — поэтому число
 * непрерывно и не теряет ни доли минуты на переходе через полночь.
 */
export function clockSimMs(clock, nowMs) {
  const stamp = volumeClockStamp(clock, nowMs);
  if (!clock) return clockStampMs(stamp);
  const day = Number.isFinite(Number(clock.fromDay)) ? Number(clock.fromDay) : stamp.day;
  const from = Number(clock.fromMin) || 0;
  if (clock.fixed) return day * CLOCK_DAY_MS + from * 60000;
  const gone = (Number(nowMs) - Number(clock.atMs)) * volumeClockSpeedOf(clock.speed);
  const total = day * CLOCK_DAY_MS + from * 60000 + gone;
  return Number.isFinite(total) ? total : clockStampMs(stamp);
}

/** `{day, minutes}` → местные миллисекунды. */
export function clockStampMs(stamp) {
  return Number(stamp.day) * CLOCK_DAY_MS + Number(stamp.minutes) * 60000;
}

/** Местные миллисекунды → `{day, minutes}`: номер суток и минуты суток (дробные). */
export function clockMsStamp(simMs) {
  const value = Number(simMs) || 0;
  const day = Math.floor(value / CLOCK_DAY_MS);
  return { day, minutes: (value - day * CLOCK_DAY_MS) / 60000 };
}

/** Начало суток `day` в местных миллисекундах. */
export function clockDayMs(day) {
  return Math.floor(Number(day) || 0) * CLOCK_DAY_MS;
}

/**
 * День недели: 1 — понедельник … 7 — воскресенье (так считает Sprut.Hub и
 * блоки сценариев). Первое января 1970 года — четверг.
 */
export function clockWeekday(simMs) {
  const day = Math.floor((Number(simMs) || 0) / CLOCK_DAY_MS);
  return ((((day + 3) % 7) + 7) % 7) + 1;
}
