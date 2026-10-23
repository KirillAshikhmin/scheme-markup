// Словарь устройств имитации умного дома: сервисы, характеристики и виды
// устройств по образцу Sprut.Hub (таск 01 сценариев, истории 1.2–1.5, 1.13).
//
// Это **данные сборки**, а не справочник объекта: объект хранит у типа и у
// метки только ключи — вид устройства, типы сервисов, выбранные характеристики
// (`type.device`, `mark.device`), — а форматы, диапазоны и перечисления живут
// здесь и одинаково читаются моделью, сборкой дома и движком.
//
// Откуда что взято (`research/sprut-templates.md`):
//   — §3.2: форматы и диапазоны характеристик (HAP и то, что ставят шаблоны
//     Sonoff, Yandex и SberDevices);
//   — §7: виды устройств и их сервисы по умолчанию. Диапазоны, отличающиеся
//     от HAP (температура −40…+80, CO2 0–5000, цветовая температура 153–370
//     миред), — предложение для имитации, а не значения Sprut.
// Охраны и газа здесь нет сознательно (спецификация, история 1.2).
//
// Имена сервисов и характеристик — имена Sprut/HAP (`Lightbulb`, `On`),
// константы перечислений — тоже их строковые имена (`CONTACT_DETECTED`);
// числовой код стоит рядом справочно — его отдаёт API хаба скриптам.
// Русские подписи — в `strings.sim` (сервисы, характеристики, значения, виды).
//
// Модуль импортирует только словарь хаба `hubTypes.js` — лист без импортов,
// собранный из `sh_types.json`: каталог читают и страница, и бандл движка в
// Worker, и модель — а модель сама импортирует его, так что ссылка на неё
// дала бы циклический импорт.
//
// **Весь словарь хаба** (правка после сборки сценариев). Слова заказчика: «вот
// тут все типы сервисов перечислены, с их характеристиками (некоторые
// опциональные, у них их можно добавлять и удалять. Но не более 1
// характеристики каждого типа у сервиса). Перенеси эту структуру». Сервисы и
// характеристики, описанные ниже руками, — наши: их диапазоны подобраны под
// имитацию, а порядок характеристик — это адреса `cid` в уже размеченных
// объектах. Всё остальное берётся из словаря хаба как есть (`SIM_SERVICES`,
// `SIM_CHARS` собираются из двух частей). У нашего сервиса обязательные
// характеристики хаба, которых у нас не было, встают **после** наших: адреса
// прежних характеристик не меняются. Системные сервисы хаба (сведения об
// аксессуаре, транспорт, Siri) к метке не добавляют — их в словаре нет.
import { HUB_CHAR_TYPES, HUB_SERVICE_TYPES, HUB_SYSTEM_SERVICES } from "./hubTypes.js";

const RWE = Object.freeze(["read", "write", "event"]);
const RE = Object.freeze(["read", "event"]);
const R = Object.freeze(["read"]);
const W = Object.freeze(["write"]);
const RW = Object.freeze(["read", "write"]);

// Одна форма записи на все характеристики: недостающее — `null`, а не
// отсутствующее поле. Так читатель не гадает, «нет диапазона» это или «забыли».
function simChar(format, options = {}) {
  const values = Array.isArray(options.values)
    ? Object.freeze(options.values.map(([key, code]) => Object.freeze({ key, code })))
    : null;
  return Object.freeze({
    format,
    min: options.min ?? null,
    max: options.max ?? null,
    step: options.step ?? null,
    unit: options.unit ?? null,
    values,
    perms: options.perms || RWE,
    // Начальное значение имитации: с чего дом стартует, пока его не трогали.
    initial: options.initial === undefined ? null : options.initial,
  });
}

/** Наши характеристики: диапазоны подобраны под имитацию (шапка файла). */
const SIM_CHARS_OWN = Object.freeze({
  // — свет и реле —
  On: simChar("bool", { initial: false }),
  Brightness: simChar("int", { min: 0, max: 100, step: 1, unit: "percent", initial: 100 }),
  ColorTemperature: simChar("int", { min: 153, max: 370, step: 1, unit: "mired", initial: 250 }),
  Hue: simChar("float", { min: 0, max: 360, step: 1, unit: "degree", initial: 0 }),
  Saturation: simChar("float", { min: 0, max: 100, step: 1, unit: "percent", initial: 0 }),
  C_ColorMode: simChar("enum", {
    values: [["UNKNOWN", 0], ["HUE", 1], ["TEMPERATURE", 2]],
    perms: RE,
    initial: "TEMPERATURE",
  }),
  OutletInUse: simChar("bool", { perms: RE, initial: false }),
  // — кнопки —
  ProgrammableSwitchEvent: simChar("event", {
    values: [["SINGLE_PRESS", 0], ["DOUBLE_PRESS", 1], ["LONG_PRESS", 2]],
    perms: RE,
  }),
  // Порядковый номер клавиши — константа: 1, 2, 3… (её ставит сборка дома).
  ServiceLabelIndex: simChar("int", { min: 1, max: 255, step: 1, perms: R, initial: 1 }),
  // — датчики —
  MotionDetected: simChar("bool", { perms: RE, initial: false }),
  OccupancyDetected: simChar("enum", {
    values: [["OCCUPANCY_NOT_DETECTED", 0], ["OCCUPANCY_DETECTED", 1]],
    perms: RE,
    initial: "OCCUPANCY_NOT_DETECTED",
  }),
  ContactSensorState: simChar("enum", {
    values: [["CONTACT_DETECTED", 0], ["CONTACT_NOT_DETECTED", 1]],
    perms: RE,
    initial: "CONTACT_DETECTED",
  }),
  StatusTampered: simChar("enum", { values: [["NOT_TAMPERED", 0], ["TAMPERED", 1]], perms: RE, initial: "NOT_TAMPERED" }),
  LeakDetected: simChar("enum", {
    values: [["LEAK_NOT_DETECTED", 0], ["LEAK_DETECTED", 1]],
    perms: RE,
    initial: "LEAK_NOT_DETECTED",
  }),
  SmokeDetected: simChar("enum", {
    values: [["SMOKE_NOT_DETECTED", 0], ["SMOKE_DETECTED", 1]],
    perms: RE,
    initial: "SMOKE_NOT_DETECTED",
  }),
  CurrentTemperature: simChar("float", { min: -40, max: 80, step: 0.1, unit: "celsius", perms: RE, initial: 22 }),
  CurrentRelativeHumidity: simChar("float", { min: 0, max: 100, step: 1, unit: "percent", perms: RE, initial: 45 }),
  CurrentAmbientLightLevel: simChar("float", { min: 0.0001, max: 100000, step: 0.0001, unit: "lux", perms: RE, initial: 300 }),
  // Давление — в мм рт. ст., как у хаба: сценарий из Sprut.Hub сравнивает
  // именно их. Диапазон — погода на равнине, а не «0…2000» хаба.
  C_CurrentAtmosphericPressure: simChar("float", { min: 600, max: 820, step: 0.1, unit: "mmhg", perms: RE, initial: 760 }),
  CarbonDioxideLevel: simChar("float", { min: 0, max: 5000, step: 1, unit: "ppm", perms: RE, initial: 450 }),
  CarbonDioxideDetected: simChar("enum", {
    values: [["CO2_LEVELS_NORMAL", 0], ["CO2_LEVELS_ABNORMAL", 1]],
    perms: RE,
    initial: "CO2_LEVELS_NORMAL",
  }),
  // — шторы —
  CurrentPosition: simChar("int", { min: 0, max: 100, step: 1, unit: "percent", perms: RE, initial: 0 }),
  TargetPosition: simChar("int", { min: 0, max: 100, step: 1, unit: "percent", initial: 0 }),
  PositionState: simChar("enum", {
    values: [["DECREASING", 0], ["INCREASING", 1], ["STOPPED", 2]],
    perms: RE,
    initial: "STOPPED",
  }),
  C_TargetPositionState: simChar("enum", { values: [["CLOSE", 0], ["OPEN", 1], ["STOP", 2]], initial: "STOP" }),
  // — климат —
  TargetTemperature: simChar("float", { min: 5, max: 35, step: 0.5, unit: "celsius", initial: 22 }),
  CurrentHeatingCoolingState: simChar("enum", {
    values: [["OFF", 0], ["HEAT", 1], ["COOL", 2]],
    perms: RE,
    initial: "OFF",
  }),
  TargetHeatingCoolingState: simChar("enum", {
    values: [["OFF", 0], ["HEAT", 1], ["COOL", 2], ["AUTO", 3], ["ECO", -3]],
    initial: "OFF",
  }),
  Active: simChar("enum", { values: [["INACTIVE", 0], ["ACTIVE", 1]], initial: "INACTIVE" }),
  CurrentHeaterCoolerState: simChar("enum", {
    values: [["INACTIVE", 0], ["IDLE", 1], ["HEATING", 2], ["COOLING", 3]],
    perms: RE,
    initial: "INACTIVE",
  }),
  TargetHeaterCoolerState: simChar("enum", { values: [["AUTO", 0], ["HEAT", 1], ["COOL", 2]], initial: "AUTO" }),
  CoolingThresholdTemperature: simChar("float", { min: 16, max: 32, step: 0.5, unit: "celsius", initial: 24 }),
  HeatingThresholdTemperature: simChar("float", { min: 16, max: 32, step: 0.5, unit: "celsius", initial: 20 }),
  RotationSpeed: simChar("float", { min: 0, max: 100, step: 1, unit: "percent", initial: 50 }),
  SwingMode: simChar("enum", { values: [["SWING_DISABLED", 0], ["SWING_ENABLED", 1]], initial: "SWING_DISABLED" }),
  TargetFanState: simChar("enum", { values: [["MANUAL", 0], ["AUTO", 1]], initial: "MANUAL" }),
  // — телевизор и звук —
  ActiveIdentifier: simChar("int", { min: 0, max: 4294967295, step: 1, initial: 1 }),
  RemoteKey: simChar("enum", {
    values: [
      ["REWIND", 0],
      ["FAST_FORWARD", 1],
      ["NEXT_TRACK", 2],
      ["PREVIOUS_TRACK", 3],
      ["ARROW_UP", 4],
      ["ARROW_DOWN", 5],
      ["ARROW_LEFT", 6],
      ["ARROW_RIGHT", 7],
      ["SELECT", 8],
      ["BACK", 9],
      ["EXIT", 10],
      ["PLAY_PAUSE", 11],
      ["INFORMATION", 15],
    ],
    perms: W,
  }),
  ConfiguredName: simChar("string", { perms: RW, initial: "" }),
  Mute: simChar("bool", { initial: false }),
  Volume: simChar("int", { min: 0, max: 100, step: 1, unit: "percent", initial: 30 }),
  // — замок и кран —
  LockCurrentState: simChar("enum", {
    values: [["UNSECURED", 0], ["SECURED", 1], ["JAMMED", 2], ["UNKNOWN", 3]],
    perms: RE,
    initial: "SECURED",
  }),
  LockTargetState: simChar("enum", { values: [["UNSECURED", 0], ["SECURED", 1]], initial: "SECURED" }),
  InUse: simChar("enum", { values: [["NOT_IN_USE", 0], ["IN_USE", 1]], perms: RE, initial: "NOT_IN_USE" }),
  ValveType: simChar("enum", {
    values: [["GENERIC_VALVE", 0], ["IRRIGATION", 1], ["SHOWER_HEAD", 2], ["WATER_FAUCET", 3]],
    perms: RE,
    initial: "GENERIC_VALVE",
  }),
  // — служебные: батарея и счётчики —
  BatteryLevel: simChar("int", { min: 0, max: 100, step: 1, unit: "percent", perms: RE, initial: 100 }),
  ChargingState: simChar("enum", {
    values: [["NOT_CHARGING", 0], ["CHARGING", 1], ["NOT_CHARGEABLE", 2]],
    perms: RE,
    initial: "NOT_CHARGEABLE",
  }),
  StatusLowBattery: simChar("enum", {
    values: [["BATTERY_LEVEL_NORMAL", 0], ["BATTERY_LEVEL_LOW", 1]],
    perms: RE,
    initial: "BATTERY_LEVEL_NORMAL",
  }),
  C_Watt: simChar("float", { min: 0, max: 100000, step: 0.1, unit: "watt", perms: RE, initial: 0 }),
  C_Volt: simChar("float", { min: 0, max: 500, step: 0.1, unit: "volt", perms: RE, initial: 230 }),
  C_Ampere: simChar("float", { min: 0, max: 100, step: 0.01, unit: "ampere", perms: RE, initial: 0 }),
  C_KiloWattHour: simChar("float", { min: 0, max: 1000000, step: 0.01, unit: "kwh", perms: RE, initial: 0 }),
});

/** Единицы хаба → ключ подписи `strings.sim.units`. */
const SIM_HUB_UNITS = Object.freeze({
  "%": "percent",
  "°": "degree",
  "°C": "celsius",
  lux: "lux",
  s: "second",
  m: "meter",
  "dB/m": "dbm",
  mmHg: "mmhg",
  dB: "decibel",
  V: "volt",
  A: "ampere",
  W: "watt",
  VA: "voltAmpere",
  kWh: "kwh",
  kVAh: "kvah",
  UVI: "uvi",
  "m³": "cubicMeter",
  var: "var",
  kVArh: "kvarh",
  Hz: "hertz",
  GCal: "gcal",
  "mg/m³": "mgm3",
});

/**
 * Характеристика из словаря хаба: формат хаба переводится в наш (целое с
 * допустимыми значениями — перечисление), единица — в ключ подписи, начальное
 * значение — «нет»: ложь, первое значение, ноль в диапазоне, пустая строка.
 * Описания нет (формат хаба неизвестен) — `null`.
 */
function simHubChar(type) {
  const hub = Object.prototype.hasOwnProperty.call(HUB_CHAR_TYPES, type) ? HUB_CHAR_TYPES[type] : null;
  if (!hub || !hub.format) return null;
  const values = hub.values ? hub.values.map((item) => [item.key, item.code]) : null;
  const format = values
    ? "enum"
    : { Boolean: "bool", Integer: "int", Long: "int", Double: "float", String: "string" }[hub.format] || null;
  if (!format) return null;
  // У перечисления диапазон — это его коды, и держит его список значений.
  const options = {
    min: values ? null : hub.min,
    max: values ? null : hub.max,
    step: values ? null : hub.step,
    unit: hub.unit ? SIM_HUB_UNITS[hub.unit] || null : null,
    values,
    perms: hub.perms.length > 0 ? hub.perms : RWE,
  };
  let initial = null;
  if (format === "bool") initial = false;
  else if (format === "enum") initial = values[0][0];
  else if (format === "string") initial = "";
  else initial = Math.max(hub.min ?? 0, Math.min(hub.max ?? 0, 0));
  return simChar(format, { ...options, initial });
}

/** Служебный ли сервис хаба: батарея и счётчики (история 1.10). */
function simHubAux(type) {
  return type === "BatteryService" || /^C_.*Meter$/.test(type);
}

function simService(required, optional = [], options = {}) {
  return Object.freeze({
    required: Object.freeze(required),
    optional: Object.freeze(optional),
    // Служебный сервис (история 1.10): батарея, счётчики. Помечается в окне
    // устройства и не считается «главным» сервисом метки.
    aux: options.aux === true,
    // Ограничения характеристик внутри сервиса: звонок умеет только одиночное
    // нажатие, хотя событие кнопки знает три.
    limits: Object.freeze(options.limits || {}),
  });
}

/** Наши сервисы: порядок характеристик — адреса `cid` размеченных объектов. */
const SIM_SERVICES_OWN = Object.freeze({
  Lightbulb: simService(["On"], ["Brightness", "ColorTemperature", "Hue", "Saturation", "C_ColorMode"]),
  Switch: simService(["On"]),
  Outlet: simService(["On"], ["OutletInUse"]),
  StatelessProgrammableSwitch: simService(["ProgrammableSwitchEvent"], ["ServiceLabelIndex"]),
  Doorbell: simService(["ProgrammableSwitchEvent"], [], {
    limits: { ProgrammableSwitchEvent: { values: ["SINGLE_PRESS"] } },
  }),
  MotionSensor: simService(["MotionDetected"]),
  OccupancySensor: simService(["OccupancyDetected"]),
  ContactSensor: simService(["ContactSensorState"], ["StatusTampered"]),
  LeakSensor: simService(["LeakDetected"]),
  SmokeSensor: simService(["SmokeDetected"]),
  TemperatureSensor: simService(["CurrentTemperature"]),
  HumiditySensor: simService(["CurrentRelativeHumidity"]),
  LightSensor: simService(["CurrentAmbientLightLevel"]),
  C_AtmosphericPressureSensor: simService(["C_CurrentAtmosphericPressure"]),
  // Превышение CO2 Sprut вычисляет логикой из уровня; здесь оно — необязательная
  // характеристика, которую вид «Датчик CO2» берёт сразу.
  CarbonDioxideSensor: simService(["CarbonDioxideLevel"], ["CarbonDioxideDetected"]),
  WindowCovering: simService(["CurrentPosition", "TargetPosition", "PositionState"], ["C_TargetPositionState"]),
  Thermostat: simService(["CurrentTemperature", "TargetTemperature", "CurrentHeatingCoolingState", "TargetHeatingCoolingState"]),
  HeaterCooler: simService(
    ["Active", "CurrentTemperature", "CurrentHeaterCoolerState", "TargetHeaterCoolerState"],
    ["CoolingThresholdTemperature", "HeatingThresholdTemperature", "RotationSpeed", "SwingMode"],
  ),
  Fan: simService(["Active"], ["RotationSpeed", "TargetFanState", "SwingMode"]),
  Television: simService(["Active"], ["ActiveIdentifier", "RemoteKey", "ConfiguredName"]),
  Speaker: simService(["Mute"], ["Volume"]),
  LockMechanism: simService(["LockCurrentState", "LockTargetState"]),
  Valve: simService(["Active", "InUse"], ["ValveType"]),
  BatteryService: simService(["BatteryLevel", "ChargingState", "StatusLowBattery"], [], { aux: true }),
  C_WattMeter: simService(["C_Watt"], [], { aux: true }),
  C_VoltMeter: simService(["C_Volt"], [], { aux: true }),
  C_AmpereMeter: simService(["C_Ampere"], [], { aux: true }),
  C_KiloWattHourMeter: simService(["C_KiloWattHour"], [], { aux: true }),
});

/**
 * Характеристики: `{format, min, max, step, unit, values, perms, initial}`.
 * `format` — `bool | int | float | enum | event | string`; у перечисления и
 * события `values` — `[{key, code}]`; `unit` — ключ подписи `strings.sim.units`.
 * Наши (`SIM_CHARS_OWN`) главнее описаний хаба.
 */
export const SIM_CHARS = (() => {
  const all = {};
  for (const [type, service] of Object.entries(HUB_SERVICE_TYPES)) {
    if (HUB_SYSTEM_SERVICES.includes(type)) continue;
    for (const char of [...service.required, ...service.optional]) {
      if (Object.prototype.hasOwnProperty.call(all, char) || Object.prototype.hasOwnProperty.call(SIM_CHARS_OWN, char)) continue;
      const meta = simHubChar(char);
      if (meta) all[char] = meta;
    }
  }
  return Object.freeze({ ...all, ...SIM_CHARS_OWN });
})();

/**
 * Сервисы: `{required: [char], optional: [char], aux, limits}` — все
 * несистемные сервисы хаба. У нашего сервиса (`SIM_SERVICES_OWN`) порядок
 * наш, а обязательные хаба, которых у нас не было, идут за нашими
 * обязательными; необязательные хаба — за нашими необязательными. Порядок
 * характеристик здесь — порядок их адресов `cid` в аксессуаре. Каждая
 * характеристика в сервисе — одна: повторов список не держит.
 */
export const SIM_SERVICES = (() => {
  const all = {};
  const known = (char) => Object.prototype.hasOwnProperty.call(SIM_CHARS, char);
  for (const [type, hub] of Object.entries(HUB_SERVICE_TYPES)) {
    if (HUB_SYSTEM_SERVICES.includes(type)) continue;
    const own = Object.prototype.hasOwnProperty.call(SIM_SERVICES_OWN, type) ? SIM_SERVICES_OWN[type] : null;
    const required = [...(own ? own.required : [])];
    for (const char of hub.required) if (known(char) && !required.includes(char)) required.push(char);
    const optional = (own ? own.optional : []).filter((char) => !required.includes(char));
    for (const char of hub.optional) if (known(char) && !required.includes(char) && !optional.includes(char)) optional.push(char);
    all[type] = simService(required, optional, {
      aux: own ? own.aux : simHubAux(type),
      limits: own ? own.limits : {},
    });
  }
  // Наш сервис, которого хаб не знает (такого сейчас нет), остаётся нашим.
  for (const [type, own] of Object.entries(SIM_SERVICES_OWN)) if (!all[type]) all[type] = own;
  return Object.freeze(all);
})();

/**
 * Параметры поведения «как настоящее» (история 1.17): время сброса датчика
 * движения, время хода шторы. Секунды имитации, целые.
 */
export const DEVICE_PARAMS = Object.freeze({
  resetSec: Object.freeze({ min: 1, max: 86400 }),
  travelSec: Object.freeze({ min: 1, max: 600 }),
});

function simKind(key, services, options = {}) {
  return Object.freeze({
    key,
    // Состав — через словарь (`simServiceChars`): обязательные сервиса есть у
    // вида всегда, даже те, что хаб сделал обязательными после того, как вид
    // был записан (единицы у термостата, четыре у телевизора).
    services: Object.freeze(
      services.map(([type, chars, perChannel]) =>
        Object.freeze({
          type,
          chars: Object.freeze(simServiceChars(type, chars) || chars),
          ...(perChannel ? { perChannel: true } : {}),
        }),
      ),
    ),
    params: Object.freeze(options.params || {}),
    // Что предложить в «Добавить сервис» первым делом: служебные и частые
    // спутники (§7, колонка «Доп. сервисы»).
    extras: Object.freeze(options.extras || []),
  });
}

const KEY_CHARS = ["ProgrammableSwitchEvent", "ServiceLabelIndex"];
const BATTERY_CHARS = ["BatteryLevel", "ChargingState", "StatusLowBattery"];

/**
 * Виды устройств: `[{key, services: [{type, chars, perChannel?}], params, extras}]`.
 * `perChannel` — сервис разворачивается по одному на канал типа (клавиши ВВ,
 * ВВВ, каналы реле). Порядок — порядок списка видов в окне устройства.
 * «Без устройства» видом не является: это ключ `"none"` у типа или метки.
 */
export const DEVICE_KINDS = Object.freeze([
  simKind("light", [["Lightbulb", ["On", "Brightness"]]]),
  simKind("lightOnOff", [["Lightbulb", ["On"]]]),
  simKind("lightCct", [["Lightbulb", ["On", "Brightness", "ColorTemperature"]]]),
  simKind("lightRgb", [["Lightbulb", ["On", "Brightness", "ColorTemperature", "Hue", "Saturation", "C_ColorMode"]]]),
  // Выключатель (G11): на каждый канал сервис «Выключатель» — реле клавиши,
  // за которым следуют нагрузки канала, — затем кнопка на каждый канал (она
  // шлёт нажатия, только когда клавиша отвязана). Ключ вида остался прежним,
  // `switchRelay`: так он и лежит в объектах, где его выбрали руками.
  simKind("switchRelay", [
    ["Switch", ["On"], true],
    ["StatelessProgrammableSwitch", KEY_CHARS, true],
  ]),
  // Выключатель без реле — одни кнопки. Так стартовые выключатели выглядели
  // до G11, и профиль, сохранённый тогда (`kind: "switch"`), обязан читаться
  // и работать как прежде (G68): щелчок переключает нагрузки и шлёт нажатие.
  simKind("switch", [["StatelessProgrammableSwitch", KEY_CHARS, true]]),
  simKind("button", [
    ["StatelessProgrammableSwitch", KEY_CHARS, true],
    ["BatteryService", BATTERY_CHARS],
  ]),
  simKind("relay", [["Switch", ["On"]]], { extras: ["C_WattMeter"] }),
  simKind("relayMulti", [["Switch", ["On"], true]], { extras: ["C_WattMeter"] }),
  simKind("outlet", [["Outlet", ["On"]]], {
    extras: ["C_WattMeter", "C_VoltMeter", "C_AmpereMeter", "C_KiloWattHourMeter"],
  }),
  simKind("virtualSwitch", [["Switch", ["On"]]]),
  simKind("curtain", [["WindowCovering", ["CurrentPosition", "TargetPosition", "PositionState"]]], {
    params: { travelSec: 20 },
    extras: ["BatteryService"],
  }),
  simKind(
    "conditioner",
    [
      [
        "HeaterCooler",
        [
          "Active",
          "CurrentTemperature",
          "CurrentHeaterCoolerState",
          "TargetHeaterCoolerState",
          "CoolingThresholdTemperature",
          "HeatingThresholdTemperature",
        ],
      ],
    ],
  ),
  simKind(
    "thermostat",
    [["Thermostat", ["CurrentTemperature", "TargetTemperature", "CurrentHeatingCoolingState", "TargetHeatingCoolingState"]]],
    { extras: ["BatteryService"] },
  ),
  simKind("fan", [["Fan", ["Active", "RotationSpeed"]]]),
  // Бризер (правка после сборки сценариев): «у бризера должен быть
  // выключатель подогрева». Вентилятор приточки и «Выключатель» — подогрев
  // воздуха; подпись «Подогрев» ему даёт окно устройства по виду
  // (`deviceCard.js`), в профиль имя не пишется.
  simKind("breezer", [
    ["Fan", ["Active", "RotationSpeed"]],
    ["Switch", ["On"]],
  ]),
  // Тёплый пол (правка после сборки сценариев): «им значение можно напрямую
  // задавать или через термостат». Свой термостат — уставка напрямую; связь
  // «чем управляет» от метки-термостата — уставка и режим идут от него
  // (`sim/climate.js`).
  simKind("warmFloor", [
    ["Thermostat", ["CurrentTemperature", "TargetTemperature", "CurrentHeatingCoolingState", "TargetHeatingCoolingState"]],
  ]),
  // Новогодняя ель (правка после сборки сценариев): «у которой можно включить
  // гирлянду и звезду наверху» — две лампы, первая гирлянда, вторая звезда.
  simKind("xmasTree", [
    ["Lightbulb", ["On"]],
    ["Lightbulb", ["On"]],
  ]),
  simKind("tv", [["Television", ["Active"]]], { extras: ["Speaker"] }),
  simKind("speaker", [["Speaker", ["Mute", "Volume"]]]),
  simKind("doorbell", [["Doorbell", ["ProgrammableSwitchEvent"]]]),
  simKind("lock", [["LockMechanism", ["LockCurrentState", "LockTargetState"]]], { extras: ["BatteryService"] }),
  simKind("valve", [["Valve", ["Active", "InUse"]]], { extras: ["BatteryService"] }),
  simKind("motion", [["MotionSensor", ["MotionDetected"]]], {
    params: { resetSec: 60 },
    extras: ["LightSensor", "BatteryService"],
  }),
  simKind("occupancy", [["OccupancySensor", ["OccupancyDetected"]]], {
    params: { resetSec: 60 },
    extras: ["LightSensor"],
  }),
  simKind("camera", [["MotionSensor", ["MotionDetected"]]], { params: { resetSec: 60 } }),
  simKind("contact", [["ContactSensor", ["ContactSensorState"]]], { extras: ["BatteryService"] }),
  simKind("leak", [["LeakSensor", ["LeakDetected"]]], { extras: ["BatteryService"] }),
  simKind("smoke", [["SmokeSensor", ["SmokeDetected"]]], { extras: ["BatteryService"] }),
  simKind("temperature", [["TemperatureSensor", ["CurrentTemperature"]]], { extras: ["BatteryService"] }),
  simKind(
    "climateSensor",
    [
      ["TemperatureSensor", ["CurrentTemperature"]],
      ["HumiditySensor", ["CurrentRelativeHumidity"]],
    ],
    { extras: ["C_AtmosphericPressureSensor", "BatteryService"] },
  ),
  simKind("lightSensor", [["LightSensor", ["CurrentAmbientLightLevel"]]], { extras: ["BatteryService"] }),
  simKind("co2", [["CarbonDioxideSensor", ["CarbonDioxideLevel", "CarbonDioxideDetected"]]]),
  // Датчик климата (правка после сборки сценариев): температура, влажность и
  // CO₂ в одном корпусе — «3 шкалы вертикальных как на ртутном градуснике».
  simKind(
    "climateFull",
    [
      ["TemperatureSensor", ["CurrentTemperature"]],
      ["HumiditySensor", ["CurrentRelativeHumidity"]],
      ["CarbonDioxideSensor", ["CarbonDioxideLevel", "CarbonDioxideDetected"]],
    ],
    { extras: ["BatteryService"] },
  ),
]);

const DEVICE_KIND_BY_KEY = new Map(DEVICE_KINDS.map((kind) => [kind.key, kind]));

/** Вид устройства по ключу или `null`. */
export function deviceKind(key) {
  return DEVICE_KIND_BY_KEY.get(key) || null;
}

// ——— код типа стартового справочника → вид ——————————————————————————————
//
// Таблица «тип → профиль» спецификации (раздел 1). Ключ — код в верхнем
// регистре и без краёв: то же правило, что у строки общей базы
// (`model.catalogRowKey`). Своей копии этого правила модель не держит —
// сравнение идёт здесь, на нормализованных кодах, а сама таблица записана
// кодами так, как они стоят в справочнике (у «РC» вторая буква **латинская**,
// как у заказчика).
//
// `"none"` — тип справочника, который устройством не является (щит, витая
// пара, канализация…); кода, которого здесь нет, таблица не знает вовсе.
const DEVICE_KIND_BY_CODE_SOURCE = [
  ["light", ["Т", "С", "ПК", "ТР", "ПС", "Л", "ПШ", "ППл", "ПКШ", "ЛЮ", "Н", "Бр", "ЛВ", "ПЛ", "ПЗ"]],
  // Выключатели — с реле на каждый канал (G11). До G11 здесь стоял `switch`
  // (одни кнопки); выведенный профиль в объект не пишется, так что старый
  // объект без своих профилей просто видит новый.
  ["switchRelay", ["В", "П", "МВ", "ВВ", "ПП", "ВВВ"]],
  ["outlet", ["Р", "РC"]],
  ["conditioner", ["К"]],
  // Бризер — своим видом с подогревом (правка после сборки сценариев).
  ["breezer", ["Б"]],
  ["fan", ["ВЫТ", "ВЕНТ"]],
  ["thermostat", ["ТМ"]],
  ["warmFloor", ["ТП"]],
  ["climateFull", ["ДК"]],
  // Датчик освещённости (правка после сборки сценариев).
  ["lightSensor", ["ДОС"]],
  ["xmasTree", ["НЕ"]],
  ["relay", ["ОВ", "СУШ", "РП", "ПОС", "ДЭП"]],
  ["speaker", ["УК"]],
  ["doorbell", ["Д"]],
  ["curtain", ["КШ"]],
  ["camera", ["КАМ"]],
  ["tv", ["ТВ", "ПРО", "РЕС"]],
  ["occupancy", ["ДП"]],
  ["motion", ["ДД"]],
  ["contact", ["ДО"]],
  ["leak", ["ДПр"]],
  ["valve", ["КВ"]],
  ["none", ["Щ", "ЩС", "W", "ПУ", "ВП", "ВР", "КН"]],
];

function deviceCodeKey(code) {
  return String(code == null ? "" : code).trim().toUpperCase();
}

const DEVICE_KIND_BY_CODE = new Map();
for (const [kind, codes] of DEVICE_KIND_BY_CODE_SOURCE) {
  for (const code of codes) DEVICE_KIND_BY_CODE.set(deviceCodeKey(code), kind);
}

/**
 * Вид устройства для кода типа стартового справочника: ключ вида, `"none"` —
 * тип, который устройством не является, `null` — код таблице незнаком (свой
 * тип человека, переименованный тип).
 */
export function deviceKindForTemplateCode(code) {
  const key = deviceCodeKey(code);
  if (!key) return null;
  return DEVICE_KIND_BY_CODE.get(key) || null;
}

// ——— чтение словаря ——————————————————————————————————————————————————————

/** Описание характеристики или `null`. */
export function simCharMeta(type) {
  return Object.prototype.hasOwnProperty.call(SIM_CHARS, type) ? SIM_CHARS[type] : null;
}

/** Описание сервиса или `null`. */
export function simServiceMeta(type) {
  return Object.prototype.hasOwnProperty.call(SIM_SERVICES, type) ? SIM_SERVICES[type] : null;
}

/**
 * Характеристики сервиса из выбранных: обязательные всегда, необязательные —
 * только названные, всё — в порядке словаря (он же порядок `cid`). Незнакомая
 * характеристика выпадает молча, незнакомый сервис — `null`.
 */
export function simServiceChars(type, chosen) {
  const meta = simServiceMeta(type);
  if (!meta) return null;
  const wanted = new Set(Array.isArray(chosen) ? chosen : []);
  return [...meta.required, ...meta.optional.filter((char) => wanted.has(char))];
}

/**
 * Описание характеристики **внутри сервиса** — с его ограничениями (у звонка
 * одно нажатие). `null`, если сервис этой характеристики не знает.
 */
export function simServiceCharMeta(serviceType, charType) {
  const service = simServiceMeta(serviceType);
  const meta = simCharMeta(charType);
  if (!service || !meta) return null;
  if (!service.required.includes(charType) && !service.optional.includes(charType)) return null;
  const limit = service.limits[charType];
  if (!limit || !Array.isArray(limit.values) || !meta.values) return meta;
  const allowed = new Set(limit.values);
  return Object.freeze({ ...meta, values: Object.freeze(meta.values.filter((value) => allowed.has(value.key))) });
}

// Знаков после запятой у шага: 0,1 → 1, 0,0001 → 4. По ним округляется итог,
// иначе 22,3 приходило бы как 22,299999999999997.
function simStepDecimals(step) {
  const text = String(step);
  const dot = text.indexOf(".");
  return dot < 0 ? 0 : text.length - dot - 1;
}

function simNumber(meta, value) {
  let number = typeof value === "boolean" ? Number(value) : Number(value);
  if (value === null || value === "" || !Number.isFinite(number)) number = meta.min ?? 0;
  if (meta.min !== null) number = Math.max(number, meta.min);
  if (meta.max !== null) number = Math.min(number, meta.max);
  if (meta.step) {
    const base = meta.min ?? 0;
    number = base + Math.round((number - base) / meta.step) * meta.step;
    number = Number(number.toFixed(Math.max(simStepDecimals(meta.step), simStepDecimals(base))));
    if (meta.max !== null && number > meta.max) number = meta.max;
  }
  if (meta.format === "int") number = Math.round(number);
  return number === 0 ? 0 : number;
}

function simEnumKey(meta, value) {
  const values = meta.values || [];
  const byKey = values.find((item) => item.key === value);
  if (byKey) return byKey.key;
  const code = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  if (typeof code === "number") {
    const byCode = values.find((item) => item.code === code);
    if (byCode) return byCode.key;
  }
  return null;
}

/**
 * Значение, приведённое к характеристике (история 1.13): число — в `min…max`
 * с шагом, логика — к `true/false`, перечисление — к имени константы (число
 * переводится по коду), строка — к строке. Чужое значение перечисления
 * становится первым допустимым: неверное значение не ломает устройство.
 * У события состояния нет — чужое нажатие даёт `null`.
 */
export function simClamp(meta, value) {
  if (!meta) return value;
  switch (meta.format) {
    case "bool":
      if (value === true || value === 1 || value === "true" || value === "1") return true;
      if (value === false || value === 0 || value === "false" || value === "0" || value == null) return false;
      return Boolean(value);
    case "int":
    case "float":
      return simNumber(meta, value);
    case "enum": {
      const key = simEnumKey(meta, value);
      if (key !== null) return key;
      return meta.values && meta.values.length > 0 ? meta.values[0].key : null;
    }
    case "event":
      return simEnumKey(meta, value);
    case "string":
      return value == null ? "" : String(value);
    default:
      return value;
  }
}
