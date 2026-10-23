// Погода и время года (правка после сборки сценариев).
//
// Слова заказчика: «Симуляция погоды. Все 4 сезона, классических весна, лето,
// осень, зима. Сейчас лето только. Зимой снег, осенью жёлтые листья и т.д. а
// так же небо — ясное, пасмурное, облачное. Может быть туман, снег и дождь»;
// «Температура на улице в зависимости от сезона, даты и времени дня»; «В
// опциях должна быть возможность выбрать погоду, температуры и влажность».
// На вопрос «сами или вручную» ответ — «Сами, с ручным выбором»: сезон идёт по
// дате на часах, погода меняется по дням и часам, а выбранное в опциях
// держится, пока его не вернут на «Авто».
//
// Модуль **чистый и без импортов**: его читают и картинка «Объёма» (небо,
// листва, снег, туман), и поток имитации (температура и влажность улицы для
// климата дома). Разойдись они — за окном шёл бы снег, а градусник показывал
// +20.
//
// Всё здесь — **правдоподобие средней полосы**, а не прогноз: нормы месяца —
// московские, широта сдвигает их грубо, а погода выбирается жребием, который
// зависит только от суток и часа. Жребий один и тот же при каждом расчёте: та
// же дата и тот же час дают ту же погоду и у «Объёма», и у потока, и после
// перезагрузки.

/** Времена года по порядку. */
export const WEATHER_SEASONS = Object.freeze(["spring", "summer", "autumn", "winter"]);
/** Небо: ясно, облачно, пасмурно, туман, дождь, снег. */
export const WEATHER_SKIES = Object.freeze(["clear", "cloudy", "overcast", "fog", "rain", "snow"]);
/** «Сами»: значение выбора, при котором сезон и небо считаются по дате. */
export const WEATHER_AUTO = "auto";

/** Выбор по умолчанию: всё само (ответ «Сами, с ручным выбором»). */
export const WEATHER_DEFAULT = Object.freeze({ season: WEATHER_AUTO, sky: WEATHER_AUTO, tempC: null, humidity: null });

const WEATHER_DAY_MS = 86400000;
/** Широта, для которой писаны нормы: Москва. */
const WEATHER_BASE_LAT = 55.75;

// Нормы месяца, Москва: средняя температура суток и половина размаха день —
// ночь при обычной облачности, °C; средняя относительная влажность, %.
const WEATHER_MONTH_TEMP = [-6.5, -6.7, -1.0, 6.6, 13.2, 17.0, 19.2, 17.0, 11.3, 5.6, -0.4, -4.6];
const WEATHER_MONTH_SWING = [2.8, 3.2, 4.0, 5.0, 5.8, 6.0, 6.0, 5.6, 4.6, 3.4, 2.4, 2.4];
const WEATHER_MONTH_HUMIDITY = [86, 82, 77, 68, 64, 70, 73, 76, 81, 84, 87, 87];

/**
 * Доли неба по времени года: `[ясно, облачно, пасмурно, осадки, туман]`.
 * Зимой и осенью пасмурно и сыро, летом в основном ясно.
 */
const WEATHER_SKY_ODDS = Object.freeze({
  winter: [0.18, 0.2, 0.3, 0.27, 0.05],
  spring: [0.3, 0.3, 0.2, 0.14, 0.06],
  summer: [0.45, 0.3, 0.1, 0.12, 0.03],
  autumn: [0.14, 0.24, 0.3, 0.22, 0.1],
});

/** Сколько часов держится погода, прежде чем жребий бросают заново. */
export const WEATHER_BLOCK_HOURS = 4;

/** Насколько гуляет температура от нормы между днями: зимой сильнее. */
const WEATHER_ANOMALY_C = Object.freeze({ winter: 6, spring: 4, summer: 3.5, autumn: 4 });

/** Размах суток по небу: ясная ночь холоднее, пасмурные сутки ровнее. */
const WEATHER_SKY_SWING = Object.freeze({ clear: 1.25, cloudy: 1, overcast: 0.5, fog: 0.4, rain: 0.5, snow: 0.5 });

function weatherShare(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : 0;
}

/** Жребий: целые → число в [0, 1). Один и тот же для тех же целых. */
export function weatherHash(a, b = 0, c = 0) {
  let h = 2166136261 ^ Math.imul(Math.floor(a) | 0, 0x9e3779b1);
  h = Math.imul(h ^ (Math.floor(b) | 0), 0x85ebca6b);
  h = Math.imul(h ^ (Math.floor(c) | 0), 0xc2b2ae35);
  h ^= h >>> 15;
  h = Math.imul(h, 0x27d4eb2f);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

/** Месяц (0…11) и доля месяца по номеру суток; в южном полушарии — со сдвигом на полгода. */
function weatherMonthOf(dayNumber, latDeg) {
  const at = new Date(Math.floor(Number(dayNumber) || 0) * WEATHER_DAY_MS);
  const month = at.getUTCMonth();
  const days = new Date(Date.UTC(at.getUTCFullYear(), month + 1, 0)).getUTCDate();
  const shifted = Number(latDeg) < 0 ? (month + 6) % 12 : month;
  return { month: shifted, share: (at.getUTCDate() - 0.5) / days };
}

/**
 * Время года по дате: метеорологическое — по месяцу. Зима — декабрь…февраль,
 * весна — март…май, лето — июнь…август, осень — сентябрь…ноябрь; в южном
 * полушарии наоборот.
 */
export function weatherSeasonOf(dayNumber, latDeg = WEATHER_BASE_LAT) {
  const { month } = weatherMonthOf(dayNumber, latDeg);
  if (month === 11 || month <= 1) return "winter";
  if (month <= 4) return "spring";
  if (month <= 7) return "summer";
  return "autumn";
}

/** Норма месяца на этот день — между серединами месяцев, без ступенек на первое число. */
function weatherNorm(table, dayNumber, latDeg) {
  const { month, share } = weatherMonthOf(dayNumber, latDeg);
  const next = share >= 0.5 ? (month + 1) % 12 : (month + 11) % 12;
  const t = share >= 0.5 ? share - 0.5 : 0.5 - share;
  return table[month] + (table[next] - table[month]) * t;
}

/** Плавный шум по суткам: соседние дни похожи, неделя — уже другая погода. */
function weatherDrift(dayNumber, minutes, salt) {
  const days = (Number(dayNumber) || 0) + (Number(minutes) || 0) / 1440;
  const scale = days / 3;
  const from = Math.floor(scale);
  const t = scale - from;
  const ease = t * t * (3 - 2 * t);
  const one = weatherHash(from, salt) * 2 - 1;
  const two = weatherHash(from + 1, salt) * 2 - 1;
  return one + (two - one) * ease;
}

/** Широта сдвигает нормы: южнее теплее, примерно на полградуса на градус широты. */
function weatherLatShift(latDeg) {
  const lat = Number.isFinite(Number(latDeg)) ? Math.abs(Number(latDeg)) : WEATHER_BASE_LAT;
  return (WEATHER_BASE_LAT - lat) * 0.5;
}

/** Температура суток без неба: норма, сдвиг широты и то, как гуляет погода. */
function weatherBaseTemp(dayNumber, minutes, latDeg, season) {
  return (
    weatherNorm(WEATHER_MONTH_TEMP, dayNumber, latDeg) +
    weatherLatShift(latDeg) +
    WEATHER_ANOMALY_C[season] * weatherDrift(dayNumber, minutes, 17)
  );
}

/**
 * Небо в этот час, если его не выбрали: жребий раз в `WEATHER_BLOCK_HOURS`
 * по долям времени года. Туман бывает только утром (4…10 ч) — в другое время
 * он становится пасмурным небом. Осадки — снег, если сутки морозные, иначе дождь.
 */
export function weatherAutoSky(dayNumber, minutes, season, baseTempC) {
  const odds = WEATHER_SKY_ODDS[season] || WEATHER_SKY_ODDS.summer;
  const block = Math.floor((Number(minutes) || 0) / (WEATHER_BLOCK_HOURS * 60));
  // Сутки задают общий настрой, блок — разброс внутри них: погода не скачет от
  // ясного к ливню каждые четыре часа.
  const mood = weatherHash(dayNumber, 101);
  const roll = Math.min(0.999, Math.max(0, mood * 0.6 + weatherHash(dayNumber, block, 202) * 0.4));
  let sum = 0;
  let pick = 0;
  for (let index = 0; index < odds.length; index += 1) {
    sum += odds[index];
    if (roll < sum) {
      pick = index;
      break;
    }
    pick = index;
  }
  const hour = (Number(minutes) || 0) / 60;
  if (pick === 4) return hour >= 4 && hour < 10 ? "fog" : "overcast";
  if (pick === 3) return baseTempC <= 0.5 ? "snow" : "rain";
  return ["clear", "cloudy", "overcast"][pick];
}

/**
 * Погода в этот миг — всё, что о ней надо знать картинке и потоку.
 *
 * `choice` — выбор человека (`WEATHER_DEFAULT` и его поля: `season`, `sky` —
 * «auto» или своё; `tempC`, `humidity` — `null` или число). `simMs` — местные
 * миллисекунды часов приложения, `latDeg` — широта объекта (нет — Москва).
 *
 * Ответ: `{season, sky, auto: {season, sky}, tempC, humidity, sun, cloud, fog,
 * rain, snow}` — `sun` — сколько солнца доходит до земли (0…1: тень и пятна
 * в окнах), `cloud` — доля неба под облаками, `fog` — густота тумана,
 * `rain`/`snow` — сила осадков (0…1).
 */
export function weatherAt(choice, simMs, latDeg = WEATHER_BASE_LAT) {
  const picked = { ...WEATHER_DEFAULT, ...(choice || {}) };
  const ms = Number(simMs) || 0;
  const day = Math.floor(ms / WEATHER_DAY_MS);
  const minutes = (ms - day * WEATHER_DAY_MS) / 60000;
  const lat = Number.isFinite(Number(latDeg)) ? Number(latDeg) : WEATHER_BASE_LAT;
  const autoSeason = weatherSeasonOf(day, lat);
  const season = WEATHER_SEASONS.includes(picked.season) ? picked.season : autoSeason;
  const base = weatherBaseTemp(day, minutes, lat, autoSeason);
  const autoSky = weatherAutoSky(day, minutes, autoSeason, base);
  const sky = WEATHER_SKIES.includes(picked.sky) ? picked.sky : autoSky;
  // Температура: норма суток, сутки — день теплее ночи (тепло к трём часам
  // дня, холод к пяти утра), небо меняет размах; дождь холодит.
  const swing = weatherNorm(WEATHER_MONTH_SWING, day, lat) * (WEATHER_SKY_SWING[sky] || 1);
  const phase = Math.cos(((minutes / 60 - 15) / 24) * Math.PI * 2);
  let tempC = base + swing * phase - (sky === "rain" ? 1.5 : 0);
  // Снег при плюсе и дождь при морозе, выбранные руками, держат свою погоду:
  // градусник подстраивается под небо, а не небо под градусник.
  if (sky === "snow" && tempC > 0.5) tempC = Math.min(tempC, 0.5 - weatherHash(day, 303) * 4);
  if (sky === "rain" && tempC < 1) tempC = Math.max(tempC, 1 + weatherHash(day, 304) * 3);
  const manualTemp = Number(picked.tempC);
  if (picked.tempC !== null && picked.tempC !== "" && Number.isFinite(manualTemp)) tempC = manualTemp;
  // Влажность: норма месяца, днём суше на ясном небе, в осадки и туман — почти
  // насыщенный воздух.
  let humidity = weatherNorm(WEATHER_MONTH_HUMIDITY, day, lat) - 10 * (WEATHER_SKY_SWING[sky] || 1) * phase;
  if (sky === "rain" || sky === "snow") humidity = Math.max(humidity, 90);
  if (sky === "fog") humidity = Math.max(humidity, 97);
  humidity = Math.max(15, Math.min(100, humidity));
  const manualHumidity = Number(picked.humidity);
  if (picked.humidity !== null && picked.humidity !== "" && Number.isFinite(manualHumidity)) {
    humidity = Math.max(0, Math.min(100, manualHumidity));
  }
  return {
    season,
    sky,
    auto: { season: autoSeason, sky: autoSky },
    tempC: Math.round(tempC * 10) / 10,
    humidity: Math.round(humidity),
    ...weatherLook(sky, day),
  };
}

/**
 * Как небо выглядит и светит: сколько солнца доходит до земли, сколько неба
 * под облаками, густота тумана, сила осадков.
 */
export function weatherLook(sky, day = 0) {
  const strength = 0.55 + weatherHash(day, 405) * 0.45;
  switch (sky) {
    case "cloudy":
      return { sun: 0.75, cloud: 0.5, fog: 0, rain: 0, snow: 0 };
    case "overcast":
      return { sun: 0, cloud: 1, fog: 0, rain: 0, snow: 0 };
    case "fog":
      return { sun: 0, cloud: 1, fog: 1, rain: 0, snow: 0 };
    case "rain":
      return { sun: 0, cloud: 1, fog: 0.25, rain: strength, snow: 0 };
    case "snow":
      return { sun: 0, cloud: 1, fog: 0.2, rain: 0, snow: strength };
    default:
      return { sun: 1, cloud: 0.15, fog: 0, rain: 0, snow: 0 };
  }
}

/**
 * Норма температуры суток в этот миг — без неба и без того, как гуляет погода:
 * по ней решается, идёт ли отопительный сезон (климат дома, `sim/climate.js`).
 */
export function weatherNormTemp(simMs, latDeg = WEATHER_BASE_LAT) {
  const day = Math.floor((Number(simMs) || 0) / WEATHER_DAY_MS);
  const lat = Number.isFinite(Number(latDeg)) ? Number(latDeg) : WEATHER_BASE_LAT;
  return weatherNorm(WEATHER_MONTH_TEMP, day, lat) + weatherLatShift(lat);
}

/** Выбор, приведённый к правилам: чужое значение становится «Авто». */
export function weatherChoiceOf(value) {
  const source = value && typeof value === "object" ? value : {};
  const number = (item, min, max) => {
    if (item === null || item === undefined || item === "") return null;
    const parsed = Number(item);
    return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : null;
  };
  return {
    season: WEATHER_SEASONS.includes(source.season) ? source.season : WEATHER_AUTO,
    sky: WEATHER_SKIES.includes(source.sky) ? source.sky : WEATHER_AUTO,
    tempC: number(source.tempC, -50, 50),
    humidity: number(source.humidity, 0, 100),
  };
}

/** Сила солнца на земле — доля, на которую гаснут тень дома и пятна в окнах. */
export function weatherSunShare(weather) {
  return weather ? weatherShare(weather.sun) : 1;
}
