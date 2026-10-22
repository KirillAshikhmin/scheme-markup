// Словарь устройств имитации: сервисы, характеристики и виды устройств по
// образцу Sprut.Hub (таск 01 сценариев, истории 1.2, 1.13).
//
// Ожидаемое здесь взято не из кода, а из исследования
// `research/sprut-templates.md` §3.2 и §7: каждая строка таблицы «вид
// устройства → сервис → характеристики» переписана в тест руками, с форматами и
// диапазонами. Охрана и газ из таблицы сознательно не взяты (спецификация, 1.2).
import test from "node:test";
import assert from "node:assert/strict";

import {
  DEVICE_KINDS,
  DEVICE_PARAMS,
  SIM_CHARS,
  SIM_SERVICES,
  deviceKind,
  deviceKindForTemplateCode,
  simCharMeta,
  simClamp,
  simServiceCharMeta,
  simServiceChars,
  simServiceMeta,
} from "../src/sim/catalog.js";
import { strings } from "../src/strings.js";

// ——— таблица §7, строка за строкой ———————————————————————————————————————

// Вид устройства → сервисы по умолчанию (тип и характеристики) и служебные
// сервисы, которые предлагаются добавить. `perChannel` — «N × сервис».
const TABLE = [
  { row: "Реле (1 канал)", kind: "relay", services: [["Switch", ["On"]]], extras: ["C_WattMeter"] },
  { row: "Реле N каналов", kind: "relayMulti", services: [["Switch", ["On"], true]] },
  {
    row: "Выключатель настенный с реле",
    kind: "switchRelay",
    services: [
      ["Switch", ["On"], true],
      ["StatelessProgrammableSwitch", ["ProgrammableSwitchEvent", "ServiceLabelIndex"], true],
    ],
  },
  {
    row: "Кнопка / беспроводной выключатель",
    kind: "button",
    services: [
      ["StatelessProgrammableSwitch", ["ProgrammableSwitchEvent", "ServiceLabelIndex"], true],
      ["BatteryService", ["BatteryLevel", "ChargingState", "StatusLowBattery"]],
    ],
  },
  { row: "Светильник on/off", kind: "lightOnOff", services: [["Lightbulb", ["On"]]] },
  { row: "Диммер", kind: "light", services: [["Lightbulb", ["On", "Brightness"]]] },
  { row: "Светильник CCT", kind: "lightCct", services: [["Lightbulb", ["On", "Brightness", "ColorTemperature"]]] },
  {
    row: "Светильник RGB / RGB+CCT",
    kind: "lightRgb",
    services: [["Lightbulb", ["On", "Brightness", "ColorTemperature", "Hue", "Saturation", "C_ColorMode"]]],
  },
  {
    row: "Розетка",
    kind: "outlet",
    services: [["Outlet", ["On"]]],
    extras: ["C_WattMeter", "C_VoltMeter", "C_AmpereMeter", "C_KiloWattHourMeter"],
  },
  { row: "Датчик движения", kind: "motion", services: [["MotionSensor", ["MotionDetected"]]], extras: ["LightSensor", "BatteryService"] },
  { row: "Датчик присутствия", kind: "occupancy", services: [["OccupancySensor", ["OccupancyDetected"]]], extras: ["LightSensor"] },
  { row: "Датчик открытия", kind: "contact", services: [["ContactSensor", ["ContactSensorState"]]], extras: ["BatteryService"] },
  { row: "Датчик протечки", kind: "leak", services: [["LeakSensor", ["LeakDetected"]]], extras: ["BatteryService"] },
  { row: "Датчик дыма", kind: "smoke", services: [["SmokeSensor", ["SmokeDetected"]]], extras: ["BatteryService"] },
  { row: "Датчик температуры", kind: "temperature", services: [["TemperatureSensor", ["CurrentTemperature"]]], extras: ["BatteryService"] },
  {
    row: "Датчик температуры и влажности",
    kind: "climateSensor",
    services: [
      ["TemperatureSensor", ["CurrentTemperature"]],
      ["HumiditySensor", ["CurrentRelativeHumidity"]],
    ],
    extras: ["C_AtmosphericPressureSensor", "BatteryService"],
  },
  { row: "Датчик освещённости", kind: "lightSensor", services: [["LightSensor", ["CurrentAmbientLightLevel"]]], extras: ["BatteryService"] },
  { row: "Датчик CO2", kind: "co2", services: [["CarbonDioxideSensor", ["CarbonDioxideLevel", "CarbonDioxideDetected"]]] },
  {
    row: "Штора / карниз / рольставня",
    kind: "curtain",
    services: [["WindowCovering", ["CurrentPosition", "TargetPosition", "PositionState"]]],
    extras: ["BatteryService"],
    optional: { WindowCovering: ["C_TargetPositionState"] },
  },
  {
    row: "Термостат",
    kind: "thermostat",
    services: [["Thermostat", ["CurrentTemperature", "TargetTemperature", "CurrentHeatingCoolingState", "TargetHeatingCoolingState"]]],
    extras: ["BatteryService"],
  },
  {
    row: "Кондиционер",
    kind: "conditioner",
    services: [
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
    optional: { HeaterCooler: ["RotationSpeed", "SwingMode"] },
  },
  {
    row: "Вентиляция / вентилятор",
    kind: "fan",
    services: [["Fan", ["Active", "RotationSpeed"]]],
    optional: { Fan: ["TargetFanState"] },
  },
  {
    row: "Телевизор",
    kind: "tv",
    services: [["Television", ["Active"]]],
    extras: ["Speaker"],
    optional: { Television: ["ActiveIdentifier", "RemoteKey", "ConfiguredName"], Speaker: ["Volume"] },
  },
  { row: "Замок", kind: "lock", services: [["LockMechanism", ["LockCurrentState", "LockTargetState"]]], extras: ["BatteryService"] },
  { row: "Кран / клапан воды", kind: "valve", services: [["Valve", ["Active", "InUse"]]], extras: ["BatteryService"], optional: { Valve: ["ValveType"] } },
  { row: "Звонок", kind: "doorbell", services: [["Doorbell", ["ProgrammableSwitchEvent"]]] },
  { row: "Виртуальный переключатель", kind: "virtualSwitch", services: [["Switch", ["On"]]] },
];

// Характеристики §3.2/§7: формат и диапазоны. Перечисления — именами Sprut/HAP
// с числовым кодом справочно.
const CHARS = {
  On: { format: "bool" },
  Brightness: { format: "int", min: 0, max: 100, step: 1 },
  // Предложение для имитации (§7, примечание): 153–370 миред ≈ 6500–2700 K.
  ColorTemperature: { format: "int", min: 153, max: 370 },
  Hue: { format: "float", min: 0, max: 360 },
  Saturation: { format: "float", min: 0, max: 100 },
  C_ColorMode: { format: "enum", values: { UNKNOWN: 0, HUE: 1, TEMPERATURE: 2 } },
  OutletInUse: { format: "bool" },
  ProgrammableSwitchEvent: { format: "event", values: { SINGLE_PRESS: 0, DOUBLE_PRESS: 1, LONG_PRESS: 2 } },
  ServiceLabelIndex: { format: "int" },
  MotionDetected: { format: "bool" },
  OccupancyDetected: { format: "enum", values: { OCCUPANCY_NOT_DETECTED: 0, OCCUPANCY_DETECTED: 1 } },
  ContactSensorState: { format: "enum", values: { CONTACT_DETECTED: 0, CONTACT_NOT_DETECTED: 1 } },
  StatusTampered: { format: "enum", values: { NOT_TAMPERED: 0, TAMPERED: 1 } },
  LeakDetected: { format: "enum", values: { LEAK_NOT_DETECTED: 0, LEAK_DETECTED: 1 } },
  SmokeDetected: { format: "enum" },
  CurrentTemperature: { format: "float", min: -40, max: 80, step: 0.1 },
  CurrentRelativeHumidity: { format: "float", min: 0, max: 100, step: 1 },
  CurrentAmbientLightLevel: { format: "float", min: 0.0001, max: 100000 },
  CarbonDioxideLevel: { format: "float", min: 0, max: 5000 },
  CarbonDioxideDetected: { format: "enum", values: { CO2_LEVELS_NORMAL: 0, CO2_LEVELS_ABNORMAL: 1 } },
  CurrentPosition: { format: "int", min: 0, max: 100 },
  TargetPosition: { format: "int", min: 0, max: 100 },
  PositionState: { format: "enum", values: { DECREASING: 0, INCREASING: 1, STOPPED: 2 } },
  C_TargetPositionState: { format: "enum", values: { CLOSE: 0, OPEN: 1, STOP: 2 } },
  TargetTemperature: { format: "float", min: 5, max: 35, step: 0.5 },
  TargetHeatingCoolingState: { format: "enum", values: { OFF: 0, HEAT: 1, COOL: 2, AUTO: 3, ECO: -3 } },
  CurrentHeatingCoolingState: { format: "enum", values: { OFF: 0, HEAT: 1, COOL: 2 } },
  Active: { format: "enum", values: { INACTIVE: 0, ACTIVE: 1 } },
  TargetHeaterCoolerState: { format: "enum", values: { AUTO: 0, HEAT: 1, COOL: 2 } },
  CurrentHeaterCoolerState: { format: "enum", values: { INACTIVE: 0, IDLE: 1, HEATING: 2, COOLING: 3 } },
  CoolingThresholdTemperature: { format: "float", min: 16, max: 32, step: 0.5 },
  HeatingThresholdTemperature: { format: "float", min: 16, max: 32, step: 0.5 },
  RotationSpeed: { format: "float", min: 0, max: 100 },
  SwingMode: { format: "enum", values: { SWING_DISABLED: 0, SWING_ENABLED: 1 } },
  TargetFanState: { format: "enum", values: { MANUAL: 0, AUTO: 1 } },
  ActiveIdentifier: { format: "int" },
  RemoteKey: { format: "enum", perms: ["write"], values: { ARROW_UP: 4, SELECT: 8, BACK: 9, PLAY_PAUSE: 11, INFORMATION: 15 } },
  ConfiguredName: { format: "string" },
  Mute: { format: "bool" },
  Volume: { format: "int", min: 0, max: 100 },
  LockTargetState: { format: "enum", values: { UNSECURED: 0, SECURED: 1 } },
  LockCurrentState: { format: "enum", values: { UNSECURED: 0, SECURED: 1, JAMMED: 2, UNKNOWN: 3 } },
  InUse: { format: "enum", values: { NOT_IN_USE: 0, IN_USE: 1 } },
  ValveType: { format: "enum", values: { GENERIC_VALVE: 0 } },
  BatteryLevel: { format: "int", min: 0, max: 100 },
  ChargingState: { format: "enum", values: { NOT_CHARGEABLE: 2 } },
  StatusLowBattery: { format: "enum", values: { BATTERY_LEVEL_NORMAL: 0, BATTERY_LEVEL_LOW: 1 } },
  C_Watt: { format: "float" },
  C_Volt: { format: "float" },
  C_Ampere: { format: "float" },
  C_KiloWattHour: { format: "float" },
};

test("каждая строка таблицы §7 — вид словаря с теми же сервисами и характеристиками", () => {
  for (const row of TABLE) {
    const kind = deviceKind(row.kind);
    assert.ok(kind, "нет вида для строки «" + row.row + "»");
    assert.equal(kind.key, row.kind);
    assert.deepEqual(
      kind.services.map((service) => [service.type, service.chars, ...(service.perChannel ? [true] : [])]),
      row.services,
      "сервисы вида «" + row.row + "» разошлись с таблицей",
    );
    for (const extra of row.extras || []) {
      assert.ok(kind.extras.includes(extra), "у вида «" + row.row + "» не предложен " + extra);
    }
    for (const [service, chars] of Object.entries(row.optional || {})) {
      for (const char of chars) {
        assert.ok(simServiceMeta(service).optional.includes(char), service + " не умеет " + char);
      }
    }
  }
});

test("охраны и газа в словаре нет, а виды не повторяются", () => {
  const keys = DEVICE_KINDS.map((kind) => kind.key);
  assert.equal(new Set(keys).size, keys.length, "ключ вида повторяется");
  assert.equal(SIM_SERVICES.SecuritySystem, undefined);
  assert.equal(SIM_SERVICES.C_GasSensor, undefined);
  assert.ok(!keys.includes("none"), "«без устройства» — не вид словаря, а его отсутствие");
});

test("характеристики §3.2 и §7 — с форматом, диапазоном и перечислением именами Sprut", () => {
  for (const [type, expected] of Object.entries(CHARS)) {
    const meta = simCharMeta(type);
    assert.ok(meta, "в словаре нет характеристики " + type);
    assert.equal(meta, SIM_CHARS[type], "simCharMeta отдаёт не запись словаря: " + type);
    assert.equal(meta.format, expected.format, "формат " + type);
    for (const field of ["min", "max", "step"]) {
      if (field in expected) assert.equal(meta[field], expected[field], field + " у " + type);
    }
    for (const [key, code] of Object.entries(expected.values || {})) {
      const value = meta.values.find((item) => item.key === key);
      assert.ok(value, type + ": нет значения " + key);
      assert.equal(value.code, code, type + ": код " + key);
    }
    if (expected.perms) assert.deepEqual(meta.perms, expected.perms, "доступ " + type);
    assert.ok(Array.isArray(meta.perms) && meta.perms.length > 0, "у " + type + " не сказан доступ");
  }
  // Событие кнопки состояния не хранит — только порождает нажатие.
  assert.deepEqual(simCharMeta("ProgrammableSwitchEvent").perms, ["read", "event"]);
  assert.equal(simCharMeta("NoSuchChar"), null);
});

test("у звонка одно нажатие — одиночное, у клавиши все три", () => {
  assert.deepEqual(
    simServiceCharMeta("Doorbell", "ProgrammableSwitchEvent").values.map((value) => value.key),
    ["SINGLE_PRESS"],
  );
  assert.deepEqual(
    simServiceCharMeta("StatelessProgrammableSwitch", "ProgrammableSwitchEvent").values.map((value) => value.key),
    ["SINGLE_PRESS", "DOUBLE_PRESS", "LONG_PRESS"],
  );
  // Ограничение — у сервиса, общий словарь не тронут.
  assert.equal(simCharMeta("ProgrammableSwitchEvent").values.length, 3);
  assert.equal(simServiceCharMeta("Doorbell", "On"), null, "звонок не умеет On");
});

test("словарь замкнут: каждая характеристика сервиса есть, и каждая используется", () => {
  const used = new Set();
  for (const [type, service] of Object.entries(SIM_SERVICES)) {
    assert.ok(Array.isArray(service.required) && service.required.length > 0, type + " без обязательных");
    for (const char of [...service.required, ...service.optional]) {
      assert.ok(SIM_CHARS[char], type + " ссылается на неизвестную характеристику " + char);
      used.add(char);
    }
  }
  for (const char of Object.keys(SIM_CHARS)) assert.ok(used.has(char), "характеристика " + char + " ничья");
  for (const kind of DEVICE_KINDS) {
    for (const service of kind.services) {
      const meta = SIM_SERVICES[service.type];
      assert.ok(meta, kind.key + ": неизвестный сервис " + service.type);
      for (const char of meta.required) assert.ok(service.chars.includes(char), kind.key + " без " + char);
      for (const char of service.chars) {
        assert.ok([...meta.required, ...meta.optional].includes(char), kind.key + ": " + service.type + " не умеет " + char);
      }
    }
    for (const extra of kind.extras) assert.ok(SIM_SERVICES[extra], kind.key + ": неизвестный доп. сервис " + extra);
    for (const name of Object.keys(kind.params)) assert.ok(DEVICE_PARAMS[name], kind.key + ": неизвестный параметр " + name);
  }
  // Служебные сервисы помечены (история 1.10): батарея и счётчики.
  for (const type of ["BatteryService", "C_WattMeter", "C_VoltMeter", "C_AmpereMeter", "C_KiloWattHourMeter"]) {
    assert.equal(SIM_SERVICES[type].aux, true, type + " не помечен служебным");
  }
  assert.ok(!SIM_SERVICES.Lightbulb.aux);
});

test("у каждого вида, сервиса, характеристики и значения — русская подпись", () => {
  const cyrillic = /[А-Яа-яЁё]/;
  for (const kind of DEVICE_KINDS) {
    assert.match(String(strings.sim.kinds[kind.key] || ""), cyrillic, "вид " + kind.key + " без подписи");
  }
  assert.match(String(strings.sim.kinds.none || ""), cyrillic, "«без устройства» без подписи");
  for (const type of Object.keys(SIM_SERVICES)) {
    assert.match(String(strings.sim.services[type] || ""), cyrillic, "сервис " + type + " без подписи");
  }
  for (const [type, meta] of Object.entries(SIM_CHARS)) {
    assert.match(String(strings.sim.chars[type] || ""), cyrillic, "характеристика " + type + " без подписи");
    if (meta.unit) assert.ok(strings.sim.units[meta.unit], type + ": единица " + meta.unit + " без подписи");
    for (const value of meta.values || []) {
      const label = strings.sim.values[type] && strings.sim.values[type][value.key];
      assert.match(String(label || ""), cyrillic, type + "." + value.key + " без подписи");
    }
  }
  for (const name of Object.keys(DEVICE_PARAMS)) {
    assert.match(String(strings.sim.params[name] || ""), cyrillic, "параметр " + name + " без подписи");
  }
});

test("умолчания поведения: датчик движения сбрасывается через 60 с, штора едет 20 с", () => {
  // Спецификация, история 1.17.
  assert.equal(deviceKind("motion").params.resetSec, 60);
  assert.equal(deviceKind("curtain").params.travelSec, 20);
  assert.equal(deviceKind("unknown"), null);
});

// ——— коды стартового справочника ————————————————————————————————————————

test("коды стартового справочника узнаются без учёта регистра и краёв", () => {
  assert.equal(deviceKindForTemplateCode("Т"), "light");
  assert.equal(deviceKindForTemplateCode(" ппл "), "light");
  assert.equal(deviceKindForTemplateCode("ДПр"), "leak");
  // «РC» — кириллическая Р и **латинская** C (так в справочнике заказчика).
  assert.equal(deviceKindForTemplateCode("РC"), "outlet");
  assert.equal(deviceKindForTemplateCode("ВВВ"), "switch");
  // Не-устройство названо прямо, а свой код не узнан вовсе.
  assert.equal(deviceKindForTemplateCode("Щ"), "none");
  assert.equal(deviceKindForTemplateCode("ЖЖ"), null);
  assert.equal(deviceKindForTemplateCode(""), null);
  assert.equal(deviceKindForTemplateCode(null), null);
});

// ——— зажим значения (история 1.13) ————————————————————————————————————————

test("число зажимается в диапазон с шагом, как в Sprut", () => {
  const temperature = simCharMeta("TargetTemperature");
  assert.equal(simClamp(temperature, 40), 35);
  assert.equal(simClamp(temperature, 1), 5);
  assert.equal(simClamp(temperature, 21.3), 21.5);
  assert.equal(simClamp(temperature, "22,0".replace(",", ".")), 22);
  const brightness = simCharMeta("Brightness");
  assert.equal(simClamp(brightness, 54.6), 55);
  assert.equal(simClamp(brightness, -3), 0);
  assert.equal(simClamp(brightness, "мусор"), 0, "нечисло не ломает устройство");
  // Шаг 0,1 не плодит хвостов двоичной арифметики.
  assert.equal(simClamp(simCharMeta("CurrentTemperature"), 22.349999), 22.3);
  assert.equal(simClamp(simCharMeta("CurrentTemperature"), -0.01), 0);
  assert.ok(!Object.is(simClamp(simCharMeta("CurrentTemperature"), -0.01), -0), "минус ноль");
});

test("логика, перечисление и событие приводятся к своему виду", () => {
  assert.equal(simClamp(simCharMeta("On"), 1), true);
  assert.equal(simClamp(simCharMeta("On"), "false"), false);
  assert.equal(simClamp(simCharMeta("On"), 0), false);
  const contact = simCharMeta("ContactSensorState");
  assert.equal(simClamp(contact, "CONTACT_NOT_DETECTED"), "CONTACT_NOT_DETECTED");
  assert.equal(simClamp(contact, 1), "CONTACT_NOT_DETECTED", "числовой код переводится в имя");
  assert.equal(simClamp(contact, "ОТКРЫТО"), "CONTACT_DETECTED", "чужое значение — первое допустимое");
  const press = simCharMeta("ProgrammableSwitchEvent");
  assert.equal(simClamp(press, 1), "DOUBLE_PRESS");
  assert.equal(simClamp(press, "TRIPLE"), null, "у события нет состояния, которое можно подставить");
  assert.equal(simClamp(simCharMeta("ConfiguredName"), 42), "42");
  assert.equal(simClamp(null, 7), 7, "без описания значение не трогается");
});

test("характеристики сервиса: обязательные всегда, необязательные — по выбору и в порядке словаря", () => {
  assert.deepEqual(simServiceChars("Lightbulb", ["Hue", "Brightness", "Garbage"]), ["On", "Brightness", "Hue"]);
  assert.deepEqual(simServiceChars("Lightbulb", []), ["On"]);
  assert.equal(simServiceChars("Garbage", ["On"]), null);
  assert.equal(simServiceMeta("Garbage"), null);
});
