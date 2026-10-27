// Климат дома (правка после сборки сценариев): температура, влажность и CO₂
// каждого помещения и улицы.
//
// Слова заказчика: «Симуляция температуры и влажности. Температура на улице в
// зависимости от сезона, даты и времени дня. Температура в помещении.
// Воздухообмен по помещениям и с улицей при открытых дверях, работа
// кондиционера, вытяжки, бризера. При чем у бризера должен быть выключатель
// подогрева»; «эти параметры у каждого помещения должны быть, как и уровень
// углекислого газа. Их тоже можно задавать». Ответы на вопросы: отопление —
// «Центральное», CO₂ растёт от людей — «Число людей в комнате».
//
// Климат — **хозяин движка**, как блочные и скриптовые сценарии (`engine.js`,
// «новый вид — новый хозяин»): у него свои таймеры в виртуальном времени,
// поэтому ускорение часов, шаг и перемотка гонят его тем же счётом, что и
// сценарии. Раз в `CLIMATE_STEP_MS` времени имитации он считает шаг и пишет
// датчикам их значения **тихо** (`write.quiet`): событие уходит, сценарии его
// видят, а журнал не засыпается десятыми градуса.
//
// Это **правдоподобие, а не теплотехника**: у помещения одна температура,
// одна влажность и один CO₂, стены — одна постоянная остывания, воздух ходит
// через проём долей его площади. Числа подобраны так, чтобы картина была
// узнаваемой: открытая зимой дверь на улицу выстужает комнату за полчаса,
// бризер на полной скорости держит CO₂ двоих у 700 ppm, кондиционер снимает
// три градуса за десять минут.
import { WEATHER_DEFAULT, weatherAt, weatherChoiceOf, weatherNormTemp } from "../weather.js";

/** Шаг климата в мс времени имитации. */
export const CLIMATE_STEP_MS = 60000;
/** CO₂ улицы, ppm. */
export const CLIMATE_CO2_OUT = 420;
/** Отопление: идёт, пока норма суток ниже этого, и держит в комнатах столько. */
export const CLIMATE_HEAT_SEASON_C = 8;
export const CLIMATE_HEAT_TARGET_C = 22;
/** Сколько часов комната с окнами остывает к улице на 1 − 1/e разницы; без окон — дольше. */
const CLIMATE_TAU_WINDOW_H = 8;
const CLIMATE_TAU_INNER_H = 20;
/**
 * Батареи: сколько градусов в час они могут дать помещению. С запасом на мороз
 * за −30 при закрытых дверях и на обычный воздухообмен — вытяжки и бризер
 * (около одного объёма в час при −25; правка 2026-10-27, было 10 — только на
 * закрытый дом, и квартира с работающей вытяжкой в мороз остывала), — и без
 * запаса на открытую настежь дверь.
 *
 * **Число на помещение любого размера** (правка 2026-10-27): отопление
 * рассчитывают на помещение, и в большой комнате батарей больше. Прежде это
 * были градусы на 40 м³ — одна батарея на всё, — и двусветная гостиная в
 * 440 м³ в мороз за два часа остывала до +11, хотя её никто не проветривал.
 * Кондиционер и тёплый пол остались мерой прибора: это одна вещь своей
 * мощности, сколько бы ни было вокруг воздуха.
 */
const CLIMATE_HEAT_C_H = 14;
/**
 * Тепло держит не воздух, а стены и вещи: на один градус воздуха — столько
 * его объёмов. Влага и CO₂ меняются с воздухом целиком, температура — в это
 * число раз медленнее.
 */
const CLIMATE_MASS = 6;
/** Неплотности: обмен воздуха с улицей в час, доля объёма. */
const CLIMATE_LEAK_ACH = 0.3;
/** Воздух через открытый проём, м³/с на м² проёма: между комнатами и с улицей. */
const CLIMATE_DOOR_FLOW = 0.04;
const CLIMATE_OUT_FLOW = 0.06;
/** Вытяжка и бризер на полной скорости, м³/с. Кухонная вытяжка сильнее. */
const CLIMATE_EXHAUST_FLOW = 0.03;
const CLIMATE_HOOD_FLOW = 0.08;
const CLIMATE_BREEZER_FLOW = 0.035;
/** До скольких градусов бризер греет зимний воздух с включённым подогревом. */
export const CLIMATE_BREEZER_HEAT_C = 20;
/** Кондиционер и термостат: градусов в час на объём 40 м³. */
const CLIMATE_AC_C_H = 18;
const CLIMATE_HEATER_C_H = 3;
const CLIMATE_REF_M3 = 40;
/** Человек: CO₂ — м³/с, влага — г/с, тепло — °C·м³/с (с запасом на тепло стен и вещей). */
const CLIMATE_PERSON_CO2 = 5e-6;
const CLIMATE_PERSON_WATER = 40 / 3600;
const CLIMATE_PERSON_HEAT = 0.0083;
/** Солнце через окна: градусов в час при окнах в восьмую пола в ясный день. */
const CLIMATE_SUN_C_H = 0.8;
/** Осушитель: г/м³ в час на 40 м³. */
const CLIMATE_DRY_G_H = 1.2;
/** Помещение без площади (контур не обведён) — средняя комната. */
const CLIMATE_ROOM_M3 = 40;

/** Абсолютная влажность, г/м³, по температуре и относительной влажности. */
export function climateAbsolute(tempC, relative) {
  const t = Number(tempC) || 0;
  // Формула Магнуса: давление насыщения в гПа, влажность — в процентах.
  const saturation = 6.112 * Math.exp((17.67 * t) / (t + 243.5));
  return (saturation * Math.max(0, Math.min(100, Number(relative) || 0)) * 2.1674) / (273.15 + t);
}

/** Относительная влажность, %, по абсолютной и температуре. Больше 100 не бывает — выпадает роса. */
export function climateRelative(tempC, absolute) {
  const t = Number(tempC) || 0;
  const saturation = (6.112 * Math.exp((17.67 * t) / (t + 243.5)) * 100 * 2.1674) / (273.15 + t);
  return Math.max(0, Math.min(100, (100 * Math.max(0, Number(absolute) || 0)) / saturation));
}

function climateNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

/** Помещение по умолчанию: тёплое, в меру сухое, CO₂ — уличный. Людей нет. */
function climateRoomFresh(outdoor, heating) {
  const t = heating ? CLIMATE_HEAT_TARGET_C : Math.max(18, Math.min(26, outdoor.tempC + 3));
  return { t, ah: climateAbsolute(t, 45), co2: 450, people: 0 };
}

/**
 * Один шаг климата на `dt` секунд — чистая функция, её проверяют тесты.
 *
 * `state` — `Map<roomId, {t, ah, co2, people}>` (меняется на месте),
 * `outdoor` — `{tempC, humidity, sun}`, `geometry` — `volumeClimateGeometry`,
 * `open` — `Set` открытых проёмов с полотном, `effects` — что делают устройства
 * в каждом помещении: `Map<roomId, {exhaust, supply: [{flow, tempC}], cool,
 * heat, dry}>`, `heating` — идёт ли отопительный сезон, `dayShare` — сколько
 * солнца сейчас светит (0…1).
 */
export function climateStep(state, outdoor, geometry, open, effects, heating, dt, dayShare = 0) {
  const rooms = (geometry && geometry.rooms) || [];
  const tOut = climateNumber(outdoor.tempC, 10);
  const ahOut = climateAbsolute(tOut, climateNumber(outdoor.humidity, 70));
  const volume = new Map();
  for (const room of rooms) {
    const m3 = (Number(room.areaMm2) / 1e6) * (Math.max(2000, Number(room.heightMm) || 2700) / 1000);
    volume.set(room.id, m3 > 1 ? m3 : CLIMATE_ROOM_M3);
  }
  // Сначала потоки воздуха — из того, что было в начале шага: порядок комнат
  // не должен решать, кто кого остудил.
  const was = new Map();
  for (const [id, item] of state) was.set(id, { ...item });
  const add = (id, key, value) => {
    const item = state.get(id);
    if (item) item[key] += value;
  };
  const exchange = (id, flow, t, ah, co2) => {
    const item = was.get(id);
    const m3 = volume.get(id);
    if (!item || !m3 || !(flow > 0)) return;
    const share = Math.min(1, (flow * dt) / m3);
    add(id, "t", ((t - item.t) * share) / CLIMATE_MASS);
    add(id, "ah", (ah - item.ah) * share);
    add(id, "co2", (co2 - item.co2) * share);
  };
  // Соседи по проёмам — куда вытяжка тянет воздух (`pull` ниже). Проём берётся
  // и закрытый: воздух к вытяжке идёт щелью под дверью или переточной
  // решёткой, на то они и ставятся.
  const neighbours = new Map();
  for (const way of (geometry && geometry.ways) || []) {
    if (!way.a || !way.b || way.a === way.b) continue;
    if (!neighbours.has(way.a)) neighbours.set(way.a, new Set());
    if (!neighbours.has(way.b)) neighbours.set(way.b, new Set());
    neighbours.get(way.a).add(way.b);
    neighbours.get(way.b).add(way.a);
  }
  /**
   * **Вытяжка забирает воздух комнаты, а замещает его воздух соседей**
   * (правка 2026-10-27, вопрос заказчика «физика верно рассчитана для них?»).
   * Было: на место вытянутого в ту же комнату сразу шёл уличный, и ванная с
   * вентилятором в мороз остывала к нескольким градусам тепла. На деле воздух
   * к вытяжке тянется из соседних помещений, а дом в целом добирает его с улицы
   * неплотностями — всеми помещениями понемногу. Поэтому уличный воздух тем же
   * расходом делится на все остальные помещения по объёму: у квартиры это доли
   * процента в час на комнату, и батареи их покрывают. Соседей нет (комната
   * только на улицу) — замещает улица прямо в неё, как прежде.
   */
  const pull = (id, flow) => {
    const near = [...(neighbours.get(id) || [])].filter((other) => was.has(other));
    if (near.length === 0) {
      exchange(id, flow, tOut, ahOut, CLIMATE_CO2_OUT);
      return;
    }
    const mix = { t: 0, ah: 0, co2: 0 };
    for (const other of near) {
      const item = was.get(other);
      mix.t += item.t / near.length;
      mix.ah += item.ah / near.length;
      mix.co2 += item.co2 / near.length;
    }
    exchange(id, flow, mix.t, mix.ah, mix.co2);
    const others = [...was.keys()].filter((other) => other !== id && volume.has(other));
    const total = others.reduce((sum, other) => sum + volume.get(other), 0);
    for (const other of others) exchange(other, (flow * volume.get(other)) / total, tOut, ahOut, CLIMATE_CO2_OUT);
  };
  for (const way of (geometry && geometry.ways) || []) {
    // Окно — пока не распахнули створку, и воздух идёт её площадью (`ventMm2`):
    // открытое окно проветривает, а не становится дырой во всю стену. Дверь —
    // пока её не открыли; арка и проём без полотна открыты всегда.
    if (way.window && !open.has(way.id)) continue;
    if (way.leaf && !open.has(way.id)) continue;
    const m2 = (Number(way.window ? way.ventMm2 : way.areaMm2) || 0) / 1e6;
    if (way.a && way.b) {
      const one = was.get(way.a);
      const two = was.get(way.b);
      if (!one || !two) continue;
      exchange(way.a, CLIMATE_DOOR_FLOW * m2, two.t, two.ah, two.co2);
      exchange(way.b, CLIMATE_DOOR_FLOW * m2, one.t, one.ah, one.co2);
    } else {
      exchange(way.a || way.b, CLIMATE_OUT_FLOW * m2, tOut, ahOut, CLIMATE_CO2_OUT);
    }
  }
  for (const room of rooms) {
    const item = state.get(room.id);
    const before = was.get(room.id);
    if (!item || !before) continue;
    const m3 = volume.get(room.id);
    const scale = CLIMATE_REF_M3 / m3;
    // Неплотности: воздух потихоньку меняется с улицей.
    exchange(room.id, (CLIMATE_LEAK_ACH * m3) / 3600, tOut, ahOut, CLIMATE_CO2_OUT);
    // Стены: комната остывает или греется к улице.
    const tau = (room.windowsMm2 > 0 ? CLIMATE_TAU_WINDOW_H : CLIMATE_TAU_INNER_H) * 3600;
    item.t += ((tOut - before.t) * dt) / tau;
    // Солнце через окна — днём в ясную погоду.
    if (room.windowsMm2 > 0 && dayShare > 0) {
      const ratio = Math.min(1.5, (8 * room.windowsMm2) / Math.max(1, room.areaMm2));
      item.t += ((CLIMATE_SUN_C_H * ratio * dayShare) / 3600) * dt;
    }
    // Люди дышат и греют.
    const people = Math.max(0, Math.round(Number(before.people) || 0));
    if (people > 0) {
      item.co2 += ((people * CLIMATE_PERSON_CO2 * 1e6) / m3) * dt;
      item.ah += ((people * CLIMATE_PERSON_WATER) / m3) * dt;
      item.t += ((people * CLIMATE_PERSON_HEAT) / m3) * dt;
    }
    const own = (effects && effects.get(room.id)) || null;
    if (own) {
      if (own.exhaust > 0) pull(room.id, own.exhaust);
      for (const supply of own.supply || []) exchange(room.id, supply.flow, supply.tempC, ahOut, CLIMATE_CO2_OUT);
      // Кондиционер и обогрев тянут к своей уставке, не дальше её.
      if (own.cool !== null && own.cool !== undefined && item.t > own.cool) {
        item.t = Math.max(own.cool, item.t - ((CLIMATE_AC_C_H * scale) / 3600) * dt);
        // Охлаждая, кондиционер сушит воздух.
        item.ah = Math.max(0, item.ah - ((CLIMATE_DRY_G_H * scale) / 3600) * dt);
      }
      if (own.warm !== null && own.warm !== undefined && item.t < own.warm) {
        item.t = Math.min(own.warm, item.t + ((CLIMATE_AC_C_H * scale) / 3600) * dt);
      }
      for (const target of own.heat || []) {
        if (item.t < target) item.t = Math.min(target, item.t + ((CLIMATE_HEATER_C_H * scale) / 3600) * dt);
      }
      if (own.dry) item.ah = Math.max(0, item.ah - ((CLIMATE_DRY_G_H * scale) / 3600) * dt);
    }
    // Центральное отопление: в сезон батареи греют своей мощностью до уставки;
    // теплее уставки — молчат. Мощность — по помещению, а не на 40 м³.
    if (heating && item.t < CLIMATE_HEAT_TARGET_C) {
      item.t = Math.min(CLIMATE_HEAT_TARGET_C, item.t + (CLIMATE_HEAT_C_H / 3600) * dt);
    }
    // Роса: воздух не держит больше насыщения.
    const most = climateAbsolute(item.t, 100);
    if (item.ah > most) item.ah = most;
    if (item.co2 < CLIMATE_CO2_OUT) item.co2 = CLIMATE_CO2_OUT;
  }
  return state;
}

/** Чтение климата для страницы: `{t, rh, co2, people}` с округлением. */
export function climateView(item) {
  return {
    t: Math.round(item.t * 10) / 10,
    rh: Math.round(climateRelative(item.t, item.ah)),
    co2: Math.round(item.co2),
    people: item.people,
  };
}

const CLIMATE_TEMP_SERVICES = new Set(["TemperatureSensor", "Thermostat", "HeaterCooler"]);

// ——— освещённость (правка после сборки сценариев) ————————————————————————
//
// «Датчик освещённости добавь ещё в виде метки». Метке нужен ответ, сколько
// света в её помещении, иначе сценарий «темно — включи свет» проверять не на
// чем. Счёт грубый и честный, по тем же доводам, что климат:
//   — улица: день (`dayShare` — час и облака, как солнце в окнах у тепла)
//     даёт до `CLIMATE_SKY_LUX`, ночь — `CLIMATE_NIGHT_LUX` (луна и город);
//   — помещение: доля улицы по окнам — отношение окон к полу, умноженное на
//     `CLIMATE_DAYLIGHT_FACTOR` (окна в восьмую пола дают ~3 % улицы — так и
//     в настоящих комнатах), плюс горящие лампы помещения: поток лампы в
//     полную яркость `CLIMATE_LAMP_LM` делится на площадь пола.
// Датчик без помещения меряет улицу.

/** Ясный полдень на улице, лк. */
export const CLIMATE_SKY_LUX = 100000;
/** Ночь на улице: луна и город, лк. */
export const CLIMATE_NIGHT_LUX = 0.5;
/** Доля улицы в помещении на единицу отношения окон к полу. */
const CLIMATE_DAYLIGHT_FACTOR = 0.25;
/** Окна больше половины пола света не прибавляют: это уже стеклянная стена. */
const CLIMATE_WINDOW_MAX = 0.5;
/** Поток лампы в полную яркость, дошедший до пола, лм. */
export const CLIMATE_LAMP_LM = 1500;
/** Помещение без площади — средняя комната, м². */
const CLIMATE_ROOM_M2 = 15;

/**
 * Освещённость: `{outdoor, rooms: Map<roomId, лк>}`. `rooms` — помещения
 * геометрии (`{id, areaMm2, windowsMm2}`), `lamps` — `Map<roomId, сумма
 * яркостей 0…1>` горящих ламп, `dayShare` — доля дня 0…1.
 */
export function climateLux(rooms, lamps, dayShare) {
  const outdoor = CLIMATE_NIGHT_LUX + CLIMATE_SKY_LUX * Math.max(0, Math.min(1, Number(dayShare) || 0));
  const out = new Map();
  for (const room of rooms || []) {
    const areaM2 = Number(room.areaMm2) > 0 ? Number(room.areaMm2) / 1e6 : CLIMATE_ROOM_M2;
    const share = Math.min(CLIMATE_WINDOW_MAX, (Number(room.windowsMm2) || 0) / 1e6 / areaM2);
    const lamp = (lamps && lamps.get(room.id)) || 0;
    out.set(room.id, outdoor * share * CLIMATE_DAYLIGHT_FACTOR + (lamp * CLIMATE_LAMP_LM) / areaM2);
  }
  return { outdoor, rooms: out };
}

/**
 * Хозяин климата для движка. Слушает `message` страницы: `{kind: "weather",
 * choice}`, `{kind: "set", roomId, patch: {t, rh, co2, people}}`, `{kind:
 * "restore", rooms}`; двери узнаёт хуком `door`. Шлёт странице `{type:
 * "climate", at, outdoor, rooms: {id: {t, rh, co2, people}}}` после каждого шага.
 */
export function climateOwner() {
  let home = null;
  let geometry = null;
  let choice = { ...WEATHER_DEFAULT };
  const state = new Map();
  const open = new Set();
  let timer = null;
  let last = null;
  let lampWatch = null;
  let outdoor = { tempC: 15, humidity: 70, sun: 1, sky: "clear", season: "summer" };

  const lat = () => (home && home.site ? home.site.latDeg : undefined);

  function weatherNow(host) {
    const at = weatherAt(choice, host.now(), lat());
    outdoor = { tempC: at.tempC, humidity: at.humidity, sun: at.sun, sky: at.sky, season: at.season };
    return outdoor;
  }

  function heatingNow(host) {
    return weatherNormTemp(host.now(), lat()) < CLIMATE_HEAT_SEASON_C;
  }

  function ensureRooms(host) {
    const out = weatherNow(host);
    const heating = heatingNow(host);
    const ids = new Set(((geometry && geometry.rooms) || []).map((room) => room.id));
    for (const id of ids) if (!state.has(id)) state.set(id, climateRoomFresh(out, heating));
  }

  function deviceRoom(device) {
    return device && device.roomId ? device.roomId : null;
  }

  // Что делают устройства в каждом помещении сейчас — по их значениям.
  function effectsNow(host) {
    const effects = new Map();
    const of = (roomId) => {
      if (!effects.has(roomId)) effects.set(roomId, { exhaust: 0, supply: [], cool: null, warm: null, heat: [], dry: false });
      return effects.get(roomId);
    };
    const thermostatsHeat = new Map();
    for (const device of (geometry && geometry.devices) || []) {
      const roomId = deviceRoom(device);
      if (!roomId) continue;
      const accessory = host.accessory(device.markId);
      if (!accessory) continue;
      for (const service of accessory.services || []) {
        const value = (char) => host.value(device.markId, service.index, char);
        if (service.type === "Fan") {
          if (value("Active") !== "ACTIVE") continue;
          const speed = Math.max(0, Math.min(100, climateNumber(value("RotationSpeed"), 100))) / 100;
          if (device.role === "supply") {
            const heater = (accessory.services || []).find((item) => item.type === "Switch");
            const warm = heater && host.value(device.markId, heater.index, "On") === true;
            of(roomId).supply.push({
              flow: CLIMATE_BREEZER_FLOW * speed,
              tempC: warm ? Math.max(outdoor.tempC, CLIMATE_BREEZER_HEAT_C) : outdoor.tempC,
            });
          } else {
            of(roomId).exhaust += (device.role === "hood" ? CLIMATE_HOOD_FLOW : CLIMATE_EXHAUST_FLOW) * speed;
          }
        } else if (service.type === "HeaterCooler") {
          const stateNow = value("CurrentHeaterCoolerState");
          if (stateNow === "COOLING") of(roomId).cool = climateNumber(value("CoolingThresholdTemperature"), 24);
          if (stateNow === "HEATING") of(roomId).warm = climateNumber(value("HeatingThresholdTemperature"), 20);
        } else if (service.type === "Thermostat" && accessory.kind === "conditioner") {
          // Кондиционер — термостат (правка после сборки сценариев): греет и
          // охлаждает воздухом, как прежний «Нагреватель-охладитель», к одной
          // целевой температуре.
          const stateNow = value("CurrentHeatingCoolingState");
          const target = climateNumber(value("TargetTemperature"), 22);
          if (stateNow === "COOL") of(roomId).cool = target;
          if (stateNow === "HEAT") of(roomId).warm = target;
        } else if (service.type === "Thermostat") {
          // Термостат греет сам — как тёплый пол или батарея с головкой, — если
          // ничем не управляет; управляет — греют те, кем он управляет.
          const heats = value("CurrentHeatingCoolingState") === "HEAT";
          const target = climateNumber(value("TargetTemperature"), 22);
          if (device.controls && device.controls.length > 0) {
            for (const markId of device.controls) if (heats) thermostatsHeat.set(markId, target);
          } else if (heats) {
            of(roomId).heat.push(target);
          } else if (value("CurrentHeatingCoolingState") === "COOL") {
            of(roomId).cool = target;
          }
        } else if (service.type === "Switch" || service.type === "Outlet") {
          if (device.role === "dry" && value("On") === true) of(roomId).dry = true;
        }
      }
    }
    // Нагрузки термостата: тёплый пол и реле нагревателя греют своё помещение.
    for (const [markId, target] of thermostatsHeat) {
      const device = ((geometry && geometry.devices) || []).find((item) => item.markId === markId);
      const roomId = deviceRoom(device);
      if (roomId) of(roomId).heat.push(target);
    }
    return effects;
  }

  // Термостат ведёт тёплый пол (правка «тёплые полы»): уставка и режим идут
  // от него, пока связь есть.
  function followThermostats(host, chain) {
    for (const device of (geometry && geometry.devices) || []) {
      if (!device.controls || device.controls.length === 0) continue;
      const accessory = host.accessory(device.markId);
      const own = accessory ? (accessory.services || []).find((item) => item.type === "Thermostat") : null;
      if (!own) continue;
      const target = host.value(device.markId, own.index, "TargetTemperature");
      const mode = host.value(device.markId, own.index, "TargetHeatingCoolingState");
      for (const markId of device.controls) {
        const floor = host.accessory(markId);
        const service = floor ? (floor.services || []).find((item) => item.type === "Thermostat") : null;
        if (!service) continue;
        if (host.value(markId, service.index, "TargetTemperature") !== target) {
          host.write({ markId, service: service.index, char: "TargetTemperature", value: target, chain, quiet: true });
        }
        if (host.value(markId, service.index, "TargetHeatingCoolingState") !== mode) {
          host.write({ markId, service: service.index, char: "TargetHeatingCoolingState", value: mode, chain, quiet: true });
        }
      }
    }
  }

  // Горящие лампы по помещениям: сумма яркостей 0…1 (`climateLux`).
  function lampsNow(host) {
    const lamps = new Map();
    for (const device of (geometry && geometry.devices) || []) {
      const roomId = deviceRoom(device);
      if (!roomId) continue;
      const accessory = host.accessory(device.markId);
      for (const service of (accessory && accessory.services) || []) {
        if (service.type !== "Lightbulb" || host.value(device.markId, service.index, "On") !== true) continue;
        const dim = (service.chars || []).some((item) => item.type === "Brightness")
          ? Math.max(0, Math.min(100, climateNumber(host.value(device.markId, service.index, "Brightness"), 100))) / 100
          : 1;
        lamps.set(roomId, (lamps.get(roomId) || 0) + dim);
      }
    }
    return lamps;
  }

  // Доля дня: час (день с 7 до 19, вершина в полдень) и облака — та же, что
  // греет помещения солнцем через окна.
  function dayShareNow(host, out) {
    const hour = ((host.now() / 3600000) % 24 + 24) % 24;
    const day = hour > 7 && hour < 19 ? Math.sin(((hour - 7) / 12) * Math.PI) : 0;
    return day * out.sun;
  }

  // Датчики и термостаты — значения своего помещения; без помещения — улица.
  function writeSensors(host, chain) {
    const lux = climateLux((geometry && geometry.rooms) || [], lampsNow(host), dayShareNow(host, outdoor));
    for (const device of (geometry && geometry.devices) || []) {
      const accessory = host.accessory(device.markId);
      if (!accessory) continue;
      const room = deviceRoom(device) ? state.get(device.roomId) : null;
      const view = room
        ? climateView(room)
        : { t: Math.round(outdoor.tempC * 10) / 10, rh: Math.round(outdoor.humidity), co2: CLIMATE_CO2_OUT };
      for (const service of accessory.services || []) {
        const put = (char, value, step) => {
          if (!(service.chars || []).some((item) => item.type === char)) return;
          const now = Number(host.value(device.markId, service.index, char));
          if (Number.isFinite(now) && Math.abs(now - value) < step) return;
          host.write({ markId: device.markId, service: service.index, char, value, chain, quiet: true });
        };
        if (CLIMATE_TEMP_SERVICES.has(service.type)) put("CurrentTemperature", view.t, 0.1);
        if (service.type === "HumiditySensor") put("CurrentRelativeHumidity", view.rh, 1);
        if (service.type === "CarbonDioxideSensor") put("CarbonDioxideLevel", view.co2, 5);
        if (service.type === "LightSensor") {
          const value = room && lux.rooms.has(device.roomId) ? lux.rooms.get(device.roomId) : lux.outdoor;
          // Шаг — пять процентов: глаз и сценарий различают «светло» и
          // «темно», а не десятые доли люкса.
          put("CurrentAmbientLightLevel", Math.round(value * 10) / 10, Math.max(1, value * 0.05));
        }
      }
    }
  }

  function tell(host) {
    const rooms = {};
    for (const [id, item] of state) rooms[id] = climateView(item);
    host.post({
      type: "climate",
      at: host.now(),
      outdoor: { ...outdoor, tempC: Math.round(outdoor.tempC * 10) / 10, humidity: Math.round(outdoor.humidity) },
      rooms,
    });
  }

  function step(host) {
    const now = host.now();
    const dt = last === null ? 0 : Math.max(0, Math.min(3600, (now - last) / 1000));
    last = now;
    const out = weatherNow(host);
    const chain = [{ k: "timer", at: now, what: "climate" }];
    followThermostats(host, chain);
    if (dt > 0) climateStep(state, out, geometry, open, effectsNow(host), heatingNow(host), dt, dayShareNow(host, out));
    writeSensors(host, chain);
    tell(host);
  }

  function schedule(host) {
    if (timer !== null) host.cancelTimer(timer);
    timer = host.timer(
      host.now() + CLIMATE_STEP_MS,
      () => {
        timer = null;
        step(host);
        schedule(host);
      },
      "climate",
      { background: true },
    );
  }

  return {
    name: "climate",
    kinds: [],
    load(nextHome, host) {
      home = nextHome;
      geometry = (nextHome && nextHome.climate) || null;
      timer = null;
      ensureRooms(host);
    },
    start(info, host) {
      ensureRooms(host);
      last = host.now();
      step(host);
      schedule(host);
      // Лампу включили — датчик освещённости видит это сразу, а не на
      // следующем шаге климата через минуту: сценарий «темно — включи свет»
      // иначе включал бы свет повторно, пока датчик не узнал о первом.
      if (lampWatch) lampWatch();
      lampWatch = host.subscribe({ serviceTypes: ["Lightbulb"], charTypes: ["On", "Brightness"] }, (event, own) =>
        writeSensors(own, [...(Array.isArray(event.chain) ? event.chain : []), { k: "timer", at: own.now(), what: "climate" }]),
      );
    },
    stop() {
      timer = null;
      last = null;
      if (lampWatch) lampWatch();
      lampWatch = null;
    },
    reset(info, host) {
      state.clear();
      ensureRooms(host);
      if (host.running()) step(host);
    },
    door(event, host) {
      if (!event || typeof event.openingId !== "string") return;
      if (event.open) open.add(event.openingId);
      else open.delete(event.openingId);
      if (host.running()) tell(host);
    },
    message(data, host) {
      if (!data || typeof data !== "object") return;
      if (data.kind === "weather") {
        choice = weatherChoiceOf(data.choice);
        weatherNow(host);
      } else if (data.kind === "restore" && data.rooms && typeof data.rooms === "object") {
        for (const [id, saved] of Object.entries(data.rooms)) {
          if (!saved || typeof saved !== "object") continue;
          const t = climateNumber(saved.t, CLIMATE_HEAT_TARGET_C);
          state.set(id, {
            t,
            ah: climateAbsolute(t, climateNumber(saved.rh, 45)),
            co2: Math.max(CLIMATE_CO2_OUT, climateNumber(saved.co2, 450)),
            people: Math.max(0, Math.round(climateNumber(saved.people, 0))),
          });
        }
      } else if (data.kind === "set" && typeof data.roomId === "string") {
        if (!state.has(data.roomId)) state.set(data.roomId, climateRoomFresh(weatherNow(host), heatingNow(host)));
        const item = state.get(data.roomId);
        const patch = data.patch && typeof data.patch === "object" ? data.patch : {};
        const rh = climateRelative(item.t, item.ah);
        if (patch.t !== undefined && Number.isFinite(Number(patch.t))) item.t = Math.max(-40, Math.min(60, Number(patch.t)));
        item.ah = climateAbsolute(item.t, patch.rh !== undefined && Number.isFinite(Number(patch.rh)) ? Number(patch.rh) : rh);
        if (patch.co2 !== undefined && Number.isFinite(Number(patch.co2))) item.co2 = Math.max(CLIMATE_CO2_OUT, Math.min(5000, Number(patch.co2)));
        if (patch.people !== undefined && Number.isFinite(Number(patch.people))) item.people = Math.max(0, Math.min(50, Math.round(Number(patch.people))));
      } else {
        return;
      }
      if (host.running()) {
        writeSensors(host, [{ k: "web", at: host.now() }]);
      }
      tell(host);
    },
  };
}
