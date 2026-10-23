// Выбор погоды приложения (правка после сборки сценариев): сезон, небо,
// температура и влажность улицы — «Авто» или своё.
//
// Хозяин один на всё приложение, как у часов (`appClock.js`): погоду видит
// «Объём», а климат дома считает поток имитации, и выбор у них обязан быть
// один. Живёт он **в настройках браузера**, а не в объекте — это вид мира, а
// не свойство квартиры, ровно как фон и ускорение часов (G68 не требует
// миграции ради кнопки).
//
// Сами правила погоды — в чистом `weather.js`: этот модуль только помнит выбор
// и говорит подписчикам, что он сменился.
import { getSetting, setSetting } from "./store.js";
import { WEATHER_DEFAULT, weatherChoiceOf } from "./weather.js";

/** Ключ настроек браузера с выбором погоды. */
export const APP_WEATHER_SETTING = "weatherChoice";

const appWeatherState = { choice: { ...WEATHER_DEFAULT } };
const appWeatherWatchers = new Set();
let appWeatherLoaded = false;
// Человек выбрал раньше, чем ответило хранилище, — его выбор старше.
let appWeatherChosen = false;

function appWeatherTell() {
  const read = appWeatherRead();
  for (const watcher of [...appWeatherWatchers]) watcher(read);
}

/** Снимок выбора: `{season, sky, tempC, humidity}`. */
export function appWeatherRead() {
  return { ...appWeatherState.choice };
}

/** Подписка на смену выбора. Первый подписчик поднимает выбор из настроек. */
export function appWeatherWatch(watcher) {
  appWeatherWatchers.add(watcher);
  appWeatherLoad();
  return () => appWeatherWatchers.delete(watcher);
}

/** Поднять выбор из настроек браузера (один раз за сеанс). */
export function appWeatherLoad() {
  if (appWeatherLoaded) return;
  appWeatherLoaded = true;
  Promise.resolve(getSetting(APP_WEATHER_SETTING))
    .then((saved) => {
      if (appWeatherChosen || !saved) return;
      appWeatherState.choice = weatherChoiceOf(saved);
      appWeatherTell();
    })
    .catch(() => {});
}

/** Сменить часть выбора: `{season}`, `{sky}`, `{tempC}`, `{humidity}` — «auto»/`null` возвращает «Авто». */
export function appWeatherSet(patch) {
  const next = weatherChoiceOf({ ...appWeatherState.choice, ...(patch || {}) });
  const was = appWeatherState.choice;
  if (
    next.season === was.season &&
    next.sky === was.sky &&
    next.tempC === was.tempC &&
    next.humidity === was.humidity
  ) {
    return;
  }
  appWeatherState.choice = next;
  appWeatherChosen = true;
  setSetting(APP_WEATHER_SETTING, next);
  appWeatherTell();
}
