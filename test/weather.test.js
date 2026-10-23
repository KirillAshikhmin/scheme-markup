// Погода и времена года (правка после сборки сценариев).
//
// Слова заказчика: «Симуляция погоды. Все 4 сезона, классических весна, лето,
// осень, зима. Сейчас лето только. Зимой снег, осенью жёлтые листья и т.д. а
// так же небо — ясное, пасмурное, облачное. Может быть туман, снег и дождь»;
// «Температура на улице в зависимости от сезона, даты и времени дня»; «В
// опциях должна быть возможность выбрать погоду, температуры и влажность».
// Ответ на вопрос: «Сами, с ручным выбором».
import test from "node:test";
import assert from "node:assert/strict";

import {
  WEATHER_DEFAULT,
  WEATHER_SKIES,
  weatherAt,
  weatherChoiceOf,
  weatherSeasonOf,
} from "../src/weather.js";
import {
  VOLUME_FOG_RGB,
  VOLUME_LAND_RGB,
  VOLUME_SEASON_PALETTE,
  volumeBackdropPalette,
  volumeFill,
  volumeMood,
  volumeShadowFaces,
} from "../src/volume.js";
import { volumeRainSeed, volumeRainStep } from "../src/panels/volumeRain.js";
import { volumeTempText, volumeWeatherLine } from "../src/panels/volumeParams.js";

const DAY_MS = 86400000;
const dayOf = (year, month, date) => Math.floor(Date.UTC(year, month - 1, date) / DAY_MS);
const at = (year, month, date, hour = 12) => dayOf(year, month, date) * DAY_MS + hour * 3600000;

test("время года по дате: зима, весна, лето, осень — и наоборот на юге", () => {
  assert.equal(weatherSeasonOf(dayOf(2026, 1, 15)), "winter");
  assert.equal(weatherSeasonOf(dayOf(2026, 12, 1)), "winter");
  assert.equal(weatherSeasonOf(dayOf(2026, 3, 1)), "spring");
  assert.equal(weatherSeasonOf(dayOf(2026, 7, 10)), "summer");
  assert.equal(weatherSeasonOf(dayOf(2026, 10, 23)), "autumn");
  assert.equal(weatherSeasonOf(dayOf(2026, 7, 10), -34), "winter", "в южном полушарии июль — зима");
});

test("температура улицы: зимой мороз, летом тепло, днём теплее ночи", () => {
  const mean = (month) => {
    let sum = 0;
    for (let date = 1; date <= 28; date += 1) sum += weatherAt(WEATHER_DEFAULT, at(2026, month, date, 12)).tempC;
    return sum / 28;
  };
  assert.ok(mean(1) < -2, "январь не морозный: " + mean(1));
  assert.ok(mean(7) > 15, "июль не тёплый: " + mean(7));
  assert.ok(mean(4) > mean(1) && mean(4) < mean(7), "апрель не между январём и июлем");
  // Сутки: в три часа дня теплее, чем в пять утра, — при том же небе.
  const clear = { ...WEATHER_DEFAULT, sky: "clear" };
  for (const date of [3, 11, 19]) {
    const day = weatherAt(clear, at(2026, 6, date, 15)).tempC;
    const night = weatherAt(clear, at(2026, 6, date, 5)).tempC;
    assert.ok(day > night + 4, "день не теплее ночи: " + night + " → " + day);
  }
  // Влажность в процентах и в осадки высокая.
  const wet = weatherAt({ ...WEATHER_DEFAULT, sky: "rain" }, at(2026, 9, 10, 14));
  assert.ok(wet.humidity >= 90 && wet.humidity <= 100, "в дождь сухо: " + wet.humidity);
});

test("погода сама: та же дата и час — та же погода; за сезон встречается всё", () => {
  const one = weatherAt(WEATHER_DEFAULT, at(2026, 11, 3, 9));
  const two = weatherAt(WEATHER_DEFAULT, at(2026, 11, 3, 9));
  assert.deepEqual(one, two, "погода у одного и того же часа разная");
  const seen = (month) => {
    const skies = new Set();
    for (let date = 1; date <= 28; date += 1) {
      for (const hour of [2, 7, 13, 19]) skies.add(weatherAt(WEATHER_DEFAULT, at(2026, month, date, hour)).sky);
    }
    return skies;
  };
  const winter = seen(1);
  assert.ok(winter.has("snow"), "зимой нет снега");
  assert.ok(!winter.has("rain") || seen(1).size > 2, "зимой только дождь");
  const summer = seen(7);
  assert.ok(summer.has("clear"), "летом нет ясного неба");
  assert.ok(!summer.has("snow"), "летом идёт снег");
  const autumn = seen(10);
  assert.ok(autumn.has("rain") || autumn.has("overcast"), "осенью нет ни дождя, ни пасмурного неба");
  // Туман — только утром.
  for (let date = 1; date <= 28; date += 1) {
    for (const hour of [13, 19, 23]) assert.notEqual(weatherAt(WEATHER_DEFAULT, at(2026, 10, date, hour)).sky, "fog");
  }
});

test("ручной выбор держится: сезон, небо, градусник и влажность", () => {
  const picked = weatherAt({ season: "winter", sky: "snow", tempC: -12, humidity: 70 }, at(2026, 7, 10, 12));
  assert.equal(picked.season, "winter");
  assert.equal(picked.sky, "snow");
  assert.equal(picked.tempC, -12);
  assert.equal(picked.humidity, 70);
  assert.equal(picked.auto.season, "summer", "само время года потерялось за выбором");
  // Небо выбрано, а градусник сам: снег не идёт в +20.
  const snow = weatherAt({ ...WEATHER_DEFAULT, sky: "snow" }, at(2026, 7, 10, 15));
  assert.ok(snow.tempC <= 0.5, "снег при плюсе: " + snow.tempC);
  // Чужое значение выбора — «Авто».
  assert.deepEqual(weatherChoiceOf({ season: "monsoon", sky: 3, tempC: "x", humidity: 250 }), {
    season: "auto",
    sky: "auto",
    tempC: null,
    humidity: 100,
  });
  for (const sky of WEATHER_SKIES) {
    const look = weatherAt({ ...WEATHER_DEFAULT, sky }, at(2026, 5, 5));
    assert.ok(look.sun >= 0 && look.sun <= 1 && look.cloud >= 0 && look.cloud <= 1, sky);
  }
});

test("небо в кадре: без погоды снимок прежний, пасмурно — темнее и без тени", () => {
  const plain = volumeMood({ minutes: 780 });
  const clear = volumeMood({ minutes: 780, weather: weatherAt({ ...WEATHER_DEFAULT, sky: "clear", season: "summer" }, at(2026, 7, 1, 13)) });
  assert.equal(clear.tint.share, plain.tint.share, "ясный летний полдень темнее прежнего");
  assert.deepEqual(clear.tint.land, VOLUME_LAND_RGB, "летом земля не прежняя");
  const grey = volumeMood({ minutes: 780, weather: weatherAt({ ...WEATHER_DEFAULT, sky: "overcast" }, at(2026, 7, 1, 13)) });
  assert.ok(grey.tint.share > 0.1, "пасмурный полдень такой же светлый, как ясный: " + grey.tint.share);
  assert.equal(grey.shadow.fade, 0, "под тучами тень дома");
  assert.notEqual(grey.sky.top, plain.sky.top, "небо под тучами то же голубое");
  // Туман: цвет тумана у тона, им тонет снаружи дальнее.
  const fog = volumeMood({ minutes: 480, weather: weatherAt({ ...WEATHER_DEFAULT, sky: "fog" }, at(2026, 10, 1, 8)) });
  assert.ok(fog.tint.fog && fog.tint.fog.share > 0.5, "у тумана нет густоты");
  const near = volumeFill([200, 100, 50], 1, 1, null, { rgb: VOLUME_FOG_RGB, share: 0 });
  const far = volumeFill([200, 100, 50], 1, 1, null, { rgb: VOLUME_FOG_RGB, share: 0.9 });
  assert.equal(near, "rgb(200,100,50)");
  assert.notEqual(far, near, "туман не съел дальний цвет");
});

test("время года в палитре: зимой снег и голые деревья, осенью жёлтые кроны, летом прежнее", () => {
  const summer = volumeBackdropPalette(null, "summer");
  assert.deepEqual(summer, volumeBackdropPalette(null), "лето — не прежняя палитра");
  const winter = volumeBackdropPalette(null, "winter");
  assert.equal(winter.bare, true, "зимой у деревьев листва");
  assert.ok(winter.snowCap, "зимой на ёлках нет снега");
  const [r, g, b] = VOLUME_SEASON_PALETTE.winter.land;
  assert.ok(r > 200 && g > 200 && b > 200, "зимой земля не белая");
  const autumn = volumeBackdropPalette(null, "autumn");
  assert.ok(autumn.crowns && autumn.crowns.length >= 3, "осенью у крон одного цвета");
  // Тень дома на снегу — тот же снег, только темнее.
  const box = { corners: [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 1000, y: 1000 }, { x: 0, y: 1000 }], heightMm: 2700 };
  const shade = volumeShadowFaces([box], { az: 90, rise: 30, fade: 1 }, [], VOLUME_SEASON_PALETTE.winter.land);
  assert.ok(shade.length > 0 && shade[0].rgb[0] > 150, "тень на снегу — не снег: " + shade[0].rgb.join(","));
});

test("дождь и снег: частиц по силе, падают и возвращаются сверху", () => {
  assert.equal(volumeRainSeed("rain", 0, 800, 600).length, 0, "без осадков частицы");
  const rain = volumeRainSeed("rain", 1, 800, 600);
  const light = volumeRainSeed("rain", 0.5, 800, 600);
  assert.ok(rain.length > light.length && light.length > 0, "сила осадков не меняет их числа");
  const snow = volumeRainSeed("snow", 1, 800, 600);
  assert.ok(snow.every((drop) => drop.speed < rain[0].speed), "снег падает быстрее дождя");
  const before = rain.map((drop) => drop.y);
  volumeRainStep(rain, "rain", 0.05, 800, 600);
  assert.ok(rain.some((drop, index) => drop.y > before[index]), "капли не падают");
  for (let index = 0; index < 200; index += 1) volumeRainStep(rain, "rain", 0.05, 800, 600);
  assert.ok(rain.every((drop) => drop.y <= 620 && drop.y >= -60), "капли ушли за поле насовсем");
});

test("строка погоды в опциях", () => {
  assert.equal(volumeTempText(6.24), "+6,2");
  assert.equal(volumeTempText(-3), "−3");
  assert.equal(volumeTempText(0), "0");
  const line = volumeWeatherLine({ season: "autumn", sky: "overcast", tempC: 6.2, humidity: 84 });
  assert.equal(line, "Сейчас: осень, пасмурно, +6,2 °C, влажность 84 %");
  assert.equal(volumeWeatherLine(null), "");
});
