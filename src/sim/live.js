// Что рисовать по состоянию устройства (таск 01 сценариев): одно правило для
// «Схемы», мини-плана и «Объёма». Чистая функция от аксессуара метки
// (`sim/home.js`) и значений его характеристик — без DOM и без объекта.
//
// Значения — плоский словарь `{"<индекс сервиса>.<характеристика>": value}`
// (ключ — `simValueKey`), как их шлёт движок (`changes {markId, service, char,
// value}`), плюс `pressedAt` — время имитации последнего нажатия клавиши.
// Подходит и `Map` с теми же ключами. Отсутствующее значение — начальное
// (`char.value` аксессуара). Перечисления читаются и именем, и кодом.
import { simClamp } from "./catalog.js";

/** Ключ значения характеристики в словаре состояния. */
export function simValueKey(service, char) {
  return service + "." + char;
}

function simLiveReader(values) {
  const get =
    values instanceof Map
      ? (key) => values.get(key)
      : (key) => (values && typeof values === "object" ? values[key] : undefined);
  return (service, type) => {
    const char = service.chars.find((item) => item.type === type);
    if (!char) return undefined;
    const raw = get(simValueKey(service.index, type));
    return simClamp(char.meta, raw === undefined ? char.value : raw);
  };
}

function simShare(value, max = 100) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(1, number / max));
}

/**
 * Живое состояние устройства: `{on, level, alert, open, pressedAt, keys, flow, locked}`.
 *   on    — устройство включено (свет, реле, розетка, вентиляция, ТВ, кран…);
 *   level — 0…1: яркость включённого света, скорость вентилятора, громкость;
 *   alert — датчик сработал (движение, присутствие, открыто, протечка, дым, CO2);
 *   open  — 0…1: положение шторы, датчик открытия и замок — 1, когда открыты;
 *   pressedAt — время имитации последнего нажатия клавиши или `null`;
 *   keys  — реле клавиш по каналам `{канал: включено}` (G11) или `null`, если
 *           у устройства нет «Выключателя» с номером канала;
 *   flow  — что устройство выдувает или звучит: `{kind, level}`, `kind` —
 *           `"air"` (вентиляция, бризер), `"cool"` и `"heat"` (кондиционер по
 *           режиму), `"sound"` (колонка); `null` — ничего;
 *   locked — замок заперт;
 *   lamps — яркость каждой лампы по индексу сервиса (`{индекс: 0…1}`) или
 *           `null`, если ламп нет; heat — термостат или тёплый пол греют;
 *   climate — что показывают датчики климата: `{t, rh, co2}` (что есть).
 *
 * Три последних поля — правка после сборки сценариев: «Вентиляция не видно
 * когда работает, розетка тоже, и выключатель… придумай как визуально отличать
 * работающие от отключенных устройств». Их читает «Объём» (`volumeLiveSigns`).
 */
// ——— цвет лампы (правка после сборки сценариев) ——————————————————————————
//
// Слова заказчика: «добавь что бы у света можно было менять цветовую
// температуру и оттенок/насыщенность… свечение всегда одно, надо поправить» и
// «по умолчанию светильники умеют всё, если у сервиса включили нужную
// характеристику». Цвет — по характеристикам сервиса, а не по виду: оттенок с
// насыщенностью, цветовая температура или ничего (тёплое свечение, как было).

/** Цвет цветовой температуры в миредах: `[r, g, b]` (приближение Таннера Хелланда). */
export function simMiredRgb(mired) {
  const kelvin = 1e6 / Math.max(1, Number(mired) || 1);
  const t = Math.max(1000, Math.min(40000, kelvin)) / 100;
  const clamp = (value) => Math.round(Math.max(0, Math.min(255, value)));
  const red = t <= 66 ? 255 : 329.698727446 * Math.pow(t - 60, -0.1332047592);
  const green = t <= 66 ? 99.4708025861 * Math.log(t) - 161.1195681661 : 288.1221695283 * Math.pow(t - 60, -0.0755148492);
  const blue = t >= 66 ? 255 : t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  return [clamp(red), clamp(green), clamp(blue)];
}

/** Цвет по оттенку (градусы) и насыщенности (проценты) при полной светлоте: `[r, g, b]`. */
export function simHueRgb(hue, saturation) {
  const h = ((((Number(hue) || 0) % 360) + 360) % 360) / 60;
  const s = Math.max(0, Math.min(100, Number(saturation) || 0)) / 100;
  const x = 1 - Math.abs((h % 2) - 1);
  const [r, g, b] = h < 1 ? [1, x, 0] : h < 2 ? [x, 1, 0] : h < 3 ? [0, 1, x] : h < 4 ? [0, x, 1] : h < 5 ? [x, 0, 1] : [1, 0, x];
  const mix = (value) => Math.round(255 * (1 - s + s * value));
  return [mix(r), mix(g), mix(b)];
}

/**
 * Цвет лампы по её сервису: `[r, g, b]` или `null` — цвета у лампы нет. Режим
 * (`C_ColorMode`) решает, что светит: оттенок или температура. Без режима —
 * оттенок, если он есть и насыщенность не ноль, иначе температура.
 */
export function simLightRgb(service, read) {
  const has = (type) => Array.isArray(service.chars) && service.chars.some((item) => item.type === type);
  const hs = has("Hue") && has("Saturation");
  const ct = has("ColorTemperature");
  if (!hs && !ct) return null;
  const mode = has("C_ColorMode") ? read(service, "C_ColorMode") : null;
  const useHs = hs && (mode === "HUE" || (!ct && mode !== "TEMPERATURE") || (mode === null && Number(read(service, "Saturation")) > 0));
  if (useHs) return simHueRgb(read(service, "Hue"), read(service, "Saturation"));
  return ct ? simMiredRgb(read(service, "ColorTemperature")) : null;
}

export function simLiveOf(accessory, values) {
  const live = {
    on: false,
    level: 0,
    alert: false,
    open: 0,
    pressedAt: null,
    keys: null,
    flow: null,
    locked: false,
    // Правки после сборки сценариев: яркость каждой лампы устройства по её
    // сервису (у ели гирлянда и звезда горят порознь), греет ли термостат или
    // тёплый пол и что показывают датчики климата — `{t, rh, co2}`.
    lamps: null,
    heat: false,
    climate: null,
    // Цвет горящей лампы `[r, g, b]` (правка после сборки сценариев) — или
    // `null`: свечение тёплое, как было.
    color: null,
  };
  if (!accessory || !Array.isArray(accessory.services)) return live;
  const read = simLiveReader(values);
  const lit = (level) => {
    live.on = true;
    live.level = Math.max(live.level, level);
  };
  const blow = (kind, level) => {
    if (!live.flow || live.flow.level < level) live.flow = { kind, level };
  };
  let warm = false;
  const sense = (key, value) => {
    const number = Number(value);
    if (value === undefined || value === null || !Number.isFinite(number)) return;
    if (!live.climate) live.climate = {};
    live.climate[key] = number;
  };
  for (const service of accessory.services) {
    switch (service.type) {
      case "Lightbulb": {
        let level = 0;
        if (read(service, "On")) {
          const brightness = read(service, "Brightness");
          level = brightness === undefined ? 1 : simShare(brightness);
          lit(level);
          if (!live.color) live.color = simLightRgb(service, read);
        }
        if (!live.lamps) live.lamps = {};
        live.lamps[service.index] = level;
        break;
      }
      case "Switch":
      case "Outlet": {
        const on = Boolean(read(service, "On"));
        // У бризера «Выключатель» — подогрев (правка после сборки сценариев):
        // он не включает бризер, а греет его поток.
        if (accessory.kind === "breezer" && service.type === "Switch") {
          if (on) warm = true;
          break;
        }
        if (on) lit(1);
        if (service.type === "Switch" && Number.isInteger(service.channel)) {
          if (!live.keys) live.keys = {};
          live.keys[service.channel] = on;
        }
        break;
      }
      case "Fan":
        if (read(service, "Active") === "ACTIVE") {
          const speed = read(service, "RotationSpeed");
          const level = speed === undefined ? 1 : simShare(speed);
          lit(level);
          blow("air", level);
        }
        break;
      case "HeaterCooler":
        if (read(service, "Active") === "ACTIVE") {
          lit(1);
          const mode = read(service, "TargetHeaterCoolerState");
          blow(mode === "HEAT" ? "heat" : mode === "COOL" ? "cool" : "air", 1);
        }
        break;
      case "Television":
      case "Valve":
        if (read(service, "Active") === "ACTIVE") lit(1);
        break;
      case "Thermostat": {
        const mode = read(service, "TargetHeatingCoolingState");
        // Кондиционер — термостат (правка после сборки сценариев): дует, пока
        // не выключен, — тёплым, холодным или просто воздухом, как прежде.
        if (accessory.kind === "conditioner") {
          if (mode !== "OFF" && mode !== undefined) {
            lit(1);
            const now = read(service, "CurrentHeatingCoolingState");
            const way = mode === "HEAT" || mode === "COOL" ? mode : now;
            blow(way === "HEAT" ? "heat" : way === "COOL" ? "cool" : "air", 1);
          }
          break;
        }
        if (mode !== "OFF") lit(1);
        if (read(service, "CurrentHeatingCoolingState") === "HEAT") live.heat = true;
        break;
      }
      case "TemperatureSensor":
        sense("t", read(service, "CurrentTemperature"));
        break;
      case "HumiditySensor":
        sense("rh", read(service, "CurrentRelativeHumidity"));
        break;
      case "Speaker":
        if (read(service, "Mute") === false) {
          const volume = read(service, "Volume");
          const level = volume === undefined ? 1 : simShare(volume);
          lit(level);
          blow("sound", level);
        }
        break;
      case "WindowCovering":
        live.open = Math.max(live.open, simShare(read(service, "CurrentPosition")));
        break;
      case "ContactSensor":
        if (read(service, "ContactSensorState") === "CONTACT_NOT_DETECTED") {
          live.open = 1;
          live.alert = true;
        }
        break;
      case "LockMechanism":
        if (read(service, "LockCurrentState") === "UNSECURED") live.open = 1;
        else if (read(service, "LockCurrentState") === "SECURED") live.locked = true;
        break;
      case "MotionSensor":
        if (read(service, "MotionDetected")) live.alert = true;
        break;
      case "OccupancySensor":
        if (read(service, "OccupancyDetected") === "OCCUPANCY_DETECTED") live.alert = true;
        break;
      case "LeakSensor":
        if (read(service, "LeakDetected") === "LEAK_DETECTED") live.alert = true;
        break;
      case "SmokeSensor":
        if (read(service, "SmokeDetected") === "SMOKE_DETECTED") live.alert = true;
        break;
      case "CarbonDioxideSensor":
        if (read(service, "CarbonDioxideDetected") === "CO2_LEVELS_ABNORMAL") live.alert = true;
        sense("co2", read(service, "CarbonDioxideLevel"));
        break;
      default:
        break;
    }
  }
  // Подогрев бризера красит его поток тёплым.
  if (warm && live.flow && live.flow.kind === "air") live.flow = { kind: "heat", level: live.flow.level };
  const pressedAt = values instanceof Map ? values.get("pressedAt") : values && values.pressedAt;
  live.pressedAt = typeof pressedAt === "number" && Number.isFinite(pressedAt) ? pressedAt : null;
  return live;
}
