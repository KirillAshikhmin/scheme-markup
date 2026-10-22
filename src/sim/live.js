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
 * Живое состояние устройства: `{on, level, alert, open, pressedAt}`.
 *   on    — устройство включено (свет, реле, розетка, вентиляция, ТВ, кран…);
 *   level — 0…1: яркость включённого света, скорость вентилятора, громкость;
 *   alert — датчик сработал (движение, присутствие, открыто, протечка, дым, CO2);
 *   open  — 0…1: положение шторы, датчик открытия и замок — 1, когда открыты;
 *   pressedAt — время имитации последнего нажатия клавиши или `null`.
 */
export function simLiveOf(accessory, values) {
  const live = { on: false, level: 0, alert: false, open: 0, pressedAt: null };
  if (!accessory || !Array.isArray(accessory.services)) return live;
  const read = simLiveReader(values);
  const lit = (level) => {
    live.on = true;
    live.level = Math.max(live.level, level);
  };
  for (const service of accessory.services) {
    switch (service.type) {
      case "Lightbulb":
        if (read(service, "On")) {
          const brightness = read(service, "Brightness");
          lit(brightness === undefined ? 1 : simShare(brightness));
        }
        break;
      case "Switch":
      case "Outlet":
        if (read(service, "On")) lit(1);
        break;
      case "Fan":
        if (read(service, "Active") === "ACTIVE") {
          const speed = read(service, "RotationSpeed");
          lit(speed === undefined ? 1 : simShare(speed));
        }
        break;
      case "HeaterCooler":
      case "Television":
      case "Valve":
        if (read(service, "Active") === "ACTIVE") lit(1);
        break;
      case "Thermostat":
        if (read(service, "TargetHeatingCoolingState") !== "OFF") lit(1);
        break;
      case "Speaker":
        if (read(service, "Mute") === false) {
          const volume = read(service, "Volume");
          lit(volume === undefined ? 1 : simShare(volume));
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
        break;
      default:
        break;
    }
  }
  const pressedAt = values instanceof Map ? values.get("pressedAt") : values && values.pressedAt;
  live.pressedAt = typeof pressedAt === "number" && Number.isFinite(pressedAt) ? pressedAt : null;
  return live;
}
