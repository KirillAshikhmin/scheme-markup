// Устройство метки: профиль у типа, своя настройка у метки (таск 01 сценариев,
// истории 1.3–1.14; «Решения по реализации» — профиль выводится, поля внутри
// типа и метки).
//
// Ожидаемые профили здесь — таблица «тип стартового справочника → профиль»
// спецификации (раздел 1), переписанная руками, а не прочитанная из кода.
// G68 сверяется с отпечатками, снятыми со сборки **до** таска
// (`test/fixtures/g68-*.json`): объект прежней разметки обязан открываться и
// упаковываться байт в байт тем же текстом.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  COMMENT_TYPE_ID,
  addMark,
  addScheme,
  addType,
  addTypesFromCatalog,
  catalogOffer,
  changeMarkType,
  createProject,
  deleteType,
  deviceExpand,
  findMark,
  findType,
  markDeviceOf,
  markDeviceOwn,
  markDeviceProfile,
  markSnapshot,
  pasteMark,
  setMarkDevice,
  setTypeDevice,
  typeDeviceOf,
  typeDeviceOwn,
  typeDeviceUnknown,
  updateType,
} from "../src/model.js";
import { PROJECT_ENTRY, packProject, readZip, unpackProject } from "../src/projectFile.js";
import { projectsMigrateStored } from "../src/panels/projects.js";
import { typesSnapshot, typesTemplateFrom } from "../src/panels/types.js";
import { markAccessory } from "../src/sim/home.js";
import { simLegacySwitchProject } from "./fixtures/simHome.js";

const here = dirname(fileURLToPath(import.meta.url));
const read = (name) => readFileSync(join(here, name), "utf8");

// ——— таблица «тип → профиль» (спецификация, раздел 1) ———————————————————

const KEY = ["StatelessProgrammableSwitch", ["ProgrammableSwitchEvent", "ServiceLabelIndex"]];
const LIGHT = { kind: "light", services: [["Lightbulb", ["On", "Brightness"]]] };
// Выключатель (G11): «Выключатель» на каждый канал, затем кнопка на каждый.
const SWITCH = { kind: "switchRelay", services: [["Switch", ["On"]], KEY], perChannel: true };
// Обязательные хаба (`sh_types.json`, правка после сборки сценариев) встают за
// прежними: «используется» у розетки, единицы у термостата, четыре у ТВ, тип у
// крана.
const OUTLET = { kind: "outlet", services: [["Outlet", ["On", "OutletInUse"]]] };
const FAN = { kind: "fan", services: [["Fan", ["Active", "RotationSpeed"]]] };
// Бризер (правка после сборки сценариев): «у бризера должен быть выключатель
// подогрева» — вентилятор приточки и «Выключатель» подогрева.
const BREEZER = { kind: "breezer", services: [["Fan", ["Active", "RotationSpeed"]], ["Switch", ["On"]]] };
const RELAY = { kind: "relay", services: [["Switch", ["On"]]] };
const TV = { kind: "tv", services: [["Television", ["Active", "ActiveIdentifier", "ConfiguredName", "RemoteKey", "SleepDiscoveryMode"]]] };
const NONE = null;

const PROFILE_BY_CODE = {
  Т: LIGHT, С: LIGHT, ПК: LIGHT, ТР: LIGHT, ПС: LIGHT, Л: LIGHT, ПШ: LIGHT, ППл: LIGHT,
  ПКШ: LIGHT, ЛЮ: LIGHT, Н: LIGHT, Бр: LIGHT, ЛВ: LIGHT, ПЛ: LIGHT, ПЗ: LIGHT,
  В: { ...SWITCH, keys: 1 }, П: { ...SWITCH, keys: 1 }, МВ: { ...SWITCH, keys: 1 },
  ВВ: { ...SWITCH, keys: 2 }, ПП: { ...SWITCH, keys: 2 }, ВВВ: { ...SWITCH, keys: 3 },
  Р: OUTLET,
  // Вторая буква «РC» — латинская C, как в справочнике заказчика.
  ["РC"]: OUTLET,
  // «Active, CurrentTemperature, TargetHeaterCoolerState, пороги» таблицы плюс
  // обязательное у HeaterCooler текущее состояние (HAP, §7 исследования).
  К: {
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
  },
  Б: BREEZER, ВЫТ: FAN, ВЕНТ: FAN,
  // Правки после сборки сценариев: датчик климата, термостат, тёплый пол, ель.
  ДК: {
    kind: "climateFull",
    services: [
      ["TemperatureSensor", ["CurrentTemperature"]],
      ["HumiditySensor", ["CurrentRelativeHumidity"]],
      ["CarbonDioxideSensor", ["CarbonDioxideLevel", "CarbonDioxideDetected"]],
    ],
  },
  ТМ: {
    kind: "thermostat",
    services: [["Thermostat", ["CurrentTemperature", "TargetTemperature", "CurrentHeatingCoolingState", "TargetHeatingCoolingState", "TemperatureDisplayUnits"]]],
  },
  ТП: {
    kind: "warmFloor",
    services: [["Thermostat", ["CurrentTemperature", "TargetTemperature", "CurrentHeatingCoolingState", "TargetHeatingCoolingState", "TemperatureDisplayUnits"]]],
  },
  НЕ: { kind: "xmasTree", services: [["Lightbulb", ["On"]], ["Lightbulb", ["On"]]] },
  ОВ: RELAY, СУШ: RELAY, РП: RELAY, ПОС: RELAY, ДЭП: RELAY,
  УК: { kind: "speaker", services: [["Speaker", ["Mute", "Volume"]]] },
  Д: { kind: "doorbell", services: [["Doorbell", ["ProgrammableSwitchEvent"]]] },
  КШ: { kind: "curtain", services: [["WindowCovering", ["CurrentPosition", "TargetPosition", "PositionState"]]] },
  КАМ: { kind: "camera", services: [["MotionSensor", ["MotionDetected"]]] },
  ТВ: TV, ПРО: TV, РЕС: TV,
  ДП: { kind: "occupancy", services: [["OccupancySensor", ["OccupancyDetected"]]] },
  ДД: { kind: "motion", services: [["MotionSensor", ["MotionDetected"]]] },
  ДО: { kind: "contact", services: [["ContactSensor", ["ContactSensorState"]]] },
  ДПр: { kind: "leak", services: [["LeakSensor", ["LeakDetected"]]] },
  КВ: { kind: "valve", services: [["Valve", ["Active", "InUse", "ValveType"]]] },
  Щ: NONE, ЩС: NONE, W: NONE, ПУ: NONE, ВП: NONE, ВР: NONE, КН: NONE,
};

function scene() {
  const added = addScheme(createProject(), { name: "1 этаж", imageId: null, width: 1000, height: 800 });
  return { project: added.project, schemeId: added.scheme.id };
}

const typeByCode = (project, code) => project.markTypes.find((type) => type.code === code);

function place(base, code, at = { x: 0.5, y: 0.5 }) {
  const project = base.project || base;
  const type = typeByCode(project, code);
  const line = type.kind === "line";
  const added = addMark(project, {
    schemeId: base.schemeId,
    typeId: type.id,
    kind: line ? "line" : "point",
    points: line ? [at, { x: at.x + 0.1, y: at.y }] : [at],
  });
  return { project: added.project, schemeId: base.schemeId, markId: added.mark.id };
}

test("каждый из 55 типов стартового справочника получает профиль по таблице спецификации", () => {
  const { project, schemeId } = scene();
  assert.equal(project.markTypes.length, 55);
  let next = project;
  const marks = new Map();
  for (const type of project.markTypes) {
    assert.ok(Object.prototype.hasOwnProperty.call(PROFILE_BY_CODE, type.code), "тип " + type.code + " не назван таблицей");
    const expected = PROFILE_BY_CODE[type.code];
    const profile = typeDeviceOf(project, type.id);
    if (expected === NONE) {
      assert.equal(profile, null, type.code + " — не устройство");
      assert.equal(typeDeviceUnknown(project, type.id), false, type.code + " назван таблицей — это не «не угадать»");
    } else {
      assert.ok(profile, type.code + " без профиля");
      assert.equal(profile.kind, expected.kind, "вид " + type.code);
      assert.equal(profile.derived, true, type.code + ": профиль выведен, а не записан");
      assert.deepEqual(
        profile.services.map((service) => [service.type, service.chars]),
        expected.services,
        "сервисы " + type.code,
      );
      assert.equal(profile.services.every((service) => service.perChannel === true), Boolean(expected.perChannel));
    }
    // У типа поле не появилось: профиль только читается.
    assert.equal(Object.prototype.hasOwnProperty.call(type, "device"), false, type.code + ": в тип дописали профиль");
    const placed = place({ project: next, schemeId }, type.code, { x: 0.1 + marks.size / 100, y: 0.5 });
    next = placed.project;
    marks.set(type.code, placed.markId);
  }
  // У меток — по сервису, у выключателей — N «Выключателей», затем N кнопок
  // с номерами 1…N.
  for (const [code, markId] of marks) {
    const expected = PROFILE_BY_CODE[code];
    const profile = markDeviceOf(next, markId);
    if (expected === NONE) {
      assert.equal(profile, null, code);
      continue;
    }
    const count = expected.keys ? expected.keys * 2 : expected.services.length;
    assert.equal(profile.services.length, count, "сервисов у метки " + code);
    if (expected.keys) {
      const channels = [1, 2, 3].slice(0, expected.keys);
      assert.deepEqual(profile.services.map((service) => service.channel), [...channels, ...channels], code + ": каналы");
      const relays = profile.services.slice(0, expected.keys);
      const keys = profile.services.slice(expected.keys);
      for (const service of relays) {
        assert.deepEqual([service.type, service.chars], ["Switch", ["On"]], code + ": сначала «Выключатели»");
        assert.equal(service.decoupled, false);
      }
      for (const service of keys) {
        assert.equal(service.type, "StatelessProgrammableSwitch", code + ": затем кнопки");
        assert.ok(service.chars.includes("ServiceLabelIndex"), code + ": клавиша без номера");
        assert.equal(service.decoupled, false, code + ": клавиша по умолчанию привязана");
      }
    } else {
      assert.ok(profile.services.every((service) => service.channel === null), code + ": канал у не-клавиши");
    }
  }
});

test("комментарий и свой тип без профиля — «без устройства»; свой тип попадает в список на правку", () => {
  const { project } = scene();
  assert.equal(typeDeviceOf(project, COMMENT_TYPE_ID), null);
  assert.equal(typeDeviceUnknown(project, COMMENT_TYPE_ID), false);
  const own = addType(project, { code: "ЖЖ", name: "Жалюзи", categoryId: project.categories[0].id });
  assert.equal(typeDeviceOf(own.project, own.type.id), null);
  assert.equal(typeDeviceUnknown(own.project, own.type.id), true, "догадку не угадать — тип в списке на правку");
  // Переименованный тип справочника таблице незнаком, но профиль не теряет:
  // смена кода записывает выведенный вид в сам тип (ревью ветки, F1).
  const renamed = updateType(project, typeByCode(project, "Т").id, { code: "ТТ" }).project;
  const kept = typeDeviceOf(renamed, typeByCode(renamed, "ТТ").id);
  assert.ok(kept, "переименование типа сняло профиль");
  assert.equal(kept.kind, "light");
  assert.equal(typeDeviceUnknown(renamed, typeByCode(renamed, "ТТ").id), false);
});

test("смена кода у типа без своего профиля (Т→ТЛ) оставляет меткам аксессуар и адреса aid.sid", () => {
  let box = place(scene(), "Т", { x: 0.2, y: 0.2 });
  const first = box.markId;
  box = place(box, "Т", { x: 0.4, y: 0.2 });
  const second = box.markId;
  const typeId = typeByCode(box.project, "Т").id;
  const addresses = (project, markId) => {
    const accessory = markAccessory(project, markId);
    return accessory ? { kind: accessory.kind, services: accessory.services.map((service) => [service.address, service.chars.map((char) => char.address)]) } : null;
  };
  const before = [addresses(box.project, first), addresses(box.project, second)];
  assert.equal(before[0].kind, "light");

  const renamed = updateType(box.project, typeId, { code: "ТЛ" }).project;
  // Профиль записан той же командой — в тип, видом прежнего кода.
  assert.deepEqual(findType(renamed, typeId).device, { kind: "light" });
  assert.equal(typeDeviceOwn(renamed, typeId), true);
  assert.deepEqual([addresses(renamed, first), addresses(renamed, second)], before, "метки потеряли аксессуар или адреса");

  // Свой профиль у типа смена кода не трогает.
  const own = setTypeDevice(box.project, typeId, { kind: "lightCct" }).project;
  assert.deepEqual(findType(updateType(own, typeId, { code: "ТЛ" }).project, typeId).device, { kind: "lightCct" });
  // Явный `device` в той же правке главнее: «без устройства» так и записывается.
  assert.deepEqual(findType(updateType(box.project, typeId, { code: "ТЛ", device: null }).project, typeId).device, { kind: "none" });
  // Тип, чей код профиля не давал (щит), профиль не получает.
  const shield = typeByCode(box.project, "Щ").id;
  const shieldRenamed = updateType(box.project, shield, { code: "ЩЩ" }).project;
  assert.equal(Object.prototype.hasOwnProperty.call(findType(shieldRenamed, shield), "device"), false);
  // Смена только имени профиль не пишет.
  const named = updateType(box.project, typeId, { name: "Светильник" }).project;
  assert.equal(Object.prototype.hasOwnProperty.call(findType(named, typeId), "device"), false);
});

test("правка профиля у типа меняет метки без своей настройки и не трогает метки со своей", () => {
  let box = place(scene(), "Т", { x: 0.2, y: 0.2 });
  const plain = box.markId;
  box = place(box, "Т", { x: 0.4, y: 0.2 });
  const custom = box.markId;
  const typeId = typeByCode(box.project, "Т").id;

  let project = setMarkDevice(box.project, custom, { kind: "lightCct" }).project;
  assert.equal(markDeviceOwn(project, custom), true);
  assert.equal(markDeviceOwn(project, plain), false);

  project = setTypeDevice(project, typeId, { kind: "lightOnOff" }).project;
  assert.equal(typeDeviceOwn(project, typeId), true);
  assert.equal(typeDeviceOf(project, typeId).derived, false);
  assert.deepEqual(markDeviceOf(project, plain).services.map((service) => service.chars), [["On"]]);
  assert.equal(markDeviceOf(project, plain).kind, "lightOnOff");
  assert.equal(markDeviceOf(project, custom).kind, "lightCct", "правка типа задела метку со своей настройкой");
  assert.deepEqual(markDeviceOf(project, custom).services[0].chars, ["On", "Brightness", "ColorTemperature"]);

  // «Вернуть как у типа» снимает своё — метка снова как у типа.
  const reset = setMarkDevice(project, custom, undefined).project;
  assert.equal(markDeviceOwn(reset, custom), false);
  assert.equal(markDeviceOf(reset, custom).kind, "lightOnOff");
  assert.equal(Object.prototype.hasOwnProperty.call(findMark(reset, custom), "device"), false, "пустое поле осталось в метке");

  // Снятый профиль типа снова выводится — и поле уходит из типа целиком.
  const derived = setTypeDevice(reset, typeId, undefined).project;
  assert.equal(typeDeviceOf(derived, typeId).derived, true);
  assert.equal(Object.prototype.hasOwnProperty.call(findType(derived, typeId), "device"), false);
  // «Без устройства» у типа — метки тоже без устройства.
  const none = setTypeDevice(derived, typeId, null).project;
  assert.equal(typeDeviceOf(none, typeId), null);
  assert.equal(markDeviceOf(none, plain), null);
  assert.deepEqual(findType(none, typeId).device, { kind: "none" });
  // И у не-устройства профиль задаётся руками (история 1.11).
  const wifi = typeByCode(none, "W").id;
  assert.equal(typeDeviceOf(setTypeDevice(none, wifi, { kind: "relay" }).project, wifi).kind, "relay");
});

test("пустая правка возвращает тот же объект по ссылке", () => {
  const box = place(scene(), "Т");
  const typeId = typeByCode(box.project, "Т").id;
  assert.equal(setTypeDevice(box.project, typeId, undefined).project, box.project, "снятие несуществующего профиля");
  assert.equal(setMarkDevice(box.project, box.markId, {}).project, box.project, "пустой патч метки");
  assert.equal(setMarkDevice(box.project, box.markId, undefined).project, box.project, "сброс без своей настройки");
  const set = setTypeDevice(box.project, typeId, { kind: "lightCct" }).project;
  assert.equal(setTypeDevice(set, typeId, { kind: "lightCct" }).project, set, "тот же профиль второй раз");
  const own = setMarkDevice(set, box.markId, { params: {}, kind: "light" }).project;
  assert.equal(setMarkDevice(own, box.markId, { kind: "light" }).project, own, "та же своя настройка второй раз");
});

test("запись, совпадающая с действующим профилем, у типа и метки без своей записи — тот же объект по ссылке", () => {
  const box = place(scene(), "Т");
  const typeId = typeByCode(box.project, "Т").id;
  // Тип: выведенный профиль целиком, тот же вид, вид с умолчаниями вида.
  assert.equal(setTypeDevice(box.project, typeId, typeDeviceOf(box.project, typeId)).project, box.project, "выведенный профиль типа");
  assert.equal(setTypeDevice(box.project, typeId, { kind: "light" }).project, box.project, "тот же вид у типа");
  // Метка: всё, что отдал `markDeviceProfile`, и частичные записи того же.
  const full = markDeviceProfile(box.project, box.markId);
  assert.equal(setMarkDevice(box.project, box.markId, full).project, box.project, "профиль метки целиком");
  assert.equal(setMarkDevice(box.project, box.markId, { kind: "light" }).project, box.project, "тот же вид у метки");
  assert.equal(setMarkDevice(box.project, box.markId, { decoupled: [] }).project, box.project, "та же отвязка у метки");
  assert.equal(markDeviceOwn(box.project, box.markId), false);

  // Выключатель с отвязкой у типа: та же отвязка у метки — не своя настройка.
  const keys = place(scene(), "ВВ");
  const keysType = typeByCode(keys.project, "ВВ").id;
  const decoupled = setTypeDevice(keys.project, keysType, { kind: "switchRelay", decoupled: [2] }).project;
  assert.equal(setMarkDevice(decoupled, keys.markId, { decoupled: [2] }).project, decoupled);
  assert.equal(setMarkDevice(decoupled, keys.markId, markDeviceProfile(decoupled, keys.markId)).project, decoupled);

  // «Без устройства» у щита и так без устройства — ничего не дописывается.
  const shield = typeByCode(box.project, "Щ").id;
  assert.equal(setTypeDevice(box.project, shield, null).project, box.project, "«без устройства» у не-устройства");

  // Отличие пишется, как прежде; у незнакомого кода «без устройства» — решение
  // человека (тип уходит из списка на правку), оно тоже пишется.
  assert.notEqual(setTypeDevice(box.project, typeId, { kind: "lightCct" }).project, box.project);
  assert.notEqual(setMarkDevice(box.project, box.markId, { kind: "lightCct" }).project, box.project);
  const unknown = addType(box.project, { code: "ЖЖ", name: "Жалюзи", categoryId: box.project.categories[0].id });
  assert.deepEqual(findType(setTypeDevice(unknown.project, unknown.type.id, null).project, unknown.type.id).device, { kind: "none" });

  // Дверь датчика в той же записи пишется, а совпавший профиль — нет.
  const contact = place(scene(), "ДО");
  const door = setMarkDevice(contact.project, contact.markId, { kind: "contact", doorId: null }).project;
  assert.deepEqual(findMark(door, contact.markId).device, { doorId: null });
  assert.equal(markDeviceOwn(door, contact.markId), false);
});

test("отвязанные клавиши — у типа для всех и у метки своей настройкой", () => {
  const box = place(scene(), "ВВВ");
  const typeId = typeByCode(box.project, "ВВВ").id;
  const project = setTypeDevice(box.project, typeId, { kind: "switch", decoupled: [2] }).project;
  assert.deepEqual(markDeviceOf(project, box.markId).services.map((service) => service.decoupled), [false, true, false]);
  const own = setMarkDevice(project, box.markId, { decoupled: [1, 3] }).project;
  assert.deepEqual(markDeviceOf(own, box.markId).services.map((service) => service.decoupled), [true, false, true]);
  // Своё «ничего не отвязано» перебивает отвязку типа.
  const none = setMarkDevice(own, box.markId, { decoupled: [] }).project;
  assert.deepEqual(markDeviceOf(none, box.markId).services.map((service) => service.decoupled), [false, false, false]);
  // Для правки профиль отдаётся неразвёрнутым: клавиша одной строкой.
  const editable = markDeviceProfile(none, box.markId);
  assert.deepEqual(editable.services.map((service) => [service.type, service.perChannel]), [[KEY[0], true]]);
  assert.equal(markDeviceProfile(none, "нет"), null);
  // Число клавиш следует за каналами типа.
  const four = updateType(none, typeId, { channels: 4 }).project;
  assert.equal(markDeviceOf(four, box.markId).services.length, 4);
  assert.deepEqual(deviceExpand({ kind: "switch", services: [{ type: KEY[0], chars: KEY[1], perChannel: true }], decoupled: [] }, 2).services.length, 2);
});

test("параметры поведения и добавленный сервис — своей настройкой метки", () => {
  const box = place(scene(), "ДД");
  assert.equal(markDeviceOf(box.project, box.markId).params.resetSec, 60);
  // Окно правит профиль без развёртки по каналам — его и отдаёт обратно.
  const base = markDeviceProfile(box.project, box.markId);
  const project = setMarkDevice(box.project, box.markId, {
    params: { resetSec: 30 },
    services: [...base.services, { type: "BatteryService" }],
  }).project;
  const profile = markDeviceOf(project, box.markId);
  assert.equal(profile.params.resetSec, 30);
  assert.deepEqual(profile.services.map((service) => service.type), ["MotionSensor", "BatteryService"]);
  assert.deepEqual(profile.services[1].chars, ["BatteryLevel", "ChargingState", "StatusLowBattery"]);
  // Смена вида без своих сервисов уносит сервисы прежнего устройства.
  const relay = setMarkDevice(project, box.markId, { kind: "relay" }).project;
  assert.deepEqual(markDeviceOf(relay, box.markId).services.map((service) => service.type), ["Switch"]);
});

test("негодная правка отвергается вслух, объект не трогается", () => {
  const box = place(scene(), "Т");
  const typeId = typeByCode(box.project, "Т").id;
  const code = (fn) => {
    try {
      fn();
    } catch (error) {
      return error.code;
    }
    return null;
  };
  assert.equal(code(() => setTypeDevice(box.project, typeId, { kind: "toaster" })), "deviceKindUnknown");
  assert.equal(code(() => setTypeDevice(box.project, typeId, { kind: "light", services: [{ type: "Toaster" }] })), "deviceServiceUnknown");
  assert.equal(code(() => setMarkDevice(box.project, box.markId, { params: { resetSec: -5 } })), "deviceParamInvalid");
  assert.equal(code(() => setMarkDevice(box.project, box.markId, { decoupled: [0] })), "deviceDecoupledInvalid");
  assert.equal(code(() => setMarkDevice(box.project, box.markId, { doorId: "нет-такой-двери" })), "deviceDoorInvalid");
  assert.equal(code(() => setTypeDevice(box.project, COMMENT_TYPE_ID, { kind: "light" })), "commentNoDevice");
  assert.equal(code(() => addType(box.project, { code: "ЖЖ", name: "Ж", categoryId: box.project.categories[0].id, device: { kind: "?" } })), "deviceKindUnknown");
});

test("мусор в поле из файла читается как «не задано», а не роняет объект", () => {
  const box = place(scene(), "Т");
  const typeId = typeByCode(box.project, "Т").id;
  const broken = {
    ...box.project,
    markTypes: box.project.markTypes.map((type) => (type.id === typeId ? { ...type, device: "light" } : type)),
    marks: box.project.marks.map((mark) => ({ ...mark, device: { kind: 42, services: "все" } })),
  };
  assert.equal(typeDeviceOf(broken, typeId).derived, true, "мусор у типа — профиль выводится");
  assert.equal(markDeviceOf(broken, box.markId).kind, "light");
  assert.equal(markDeviceOwn(broken, box.markId), false);
});

// ——— белые списки: поле типа и метки переживает каждую дверь ————————————————

test("профиль типа переживает addType и updateType", () => {
  const { project } = scene();
  const added = addType(project, {
    code: "ЖЖ",
    name: "Жалюзи",
    categoryId: project.categories[0].id,
    device: { kind: "curtain", params: { travelSec: 35 } },
  });
  assert.equal(typeDeviceOf(added.project, added.type.id).kind, "curtain");
  assert.equal(typeDeviceOf(added.project, added.type.id).params.travelSec, 35);
  // Правка другого поля профиль не теряет.
  const renamed = updateType(added.project, added.type.id, { name: "Жалюзи кухни" }).project;
  assert.equal(typeDeviceOf(renamed, added.type.id).params.travelSec, 35);
  const changed = updateType(renamed, added.type.id, { device: { kind: "relay" } }).project;
  assert.equal(typeDeviceOf(changed, added.type.id).kind, "relay");
  const cleared = updateType(changed, added.type.id, { device: undefined }).project;
  assert.equal(typeDeviceOf(cleared, added.type.id), null, "снятый профиль своего типа — «без устройства»");
  // Тип без профиля поля не получает.
  const bare = addType(project, { code: "ЮЮ", name: "Своё", categoryId: project.categories[0].id });
  assert.equal(Object.prototype.hasOwnProperty.call(bare.type, "device"), false);
});

test("профиль типа переживает сохранённый шаблон справочника и новый объект из него", () => {
  const { project } = scene();
  const typeId = typeByCode(project, "Т").id;
  const tuned = setTypeDevice(project, typeId, { kind: "lightCct" }).project;
  const snapshot = typesSnapshot(tuned);
  const spot = snapshot.markTypes.find((type) => type.code === "Т");
  assert.deepEqual(spot.device, { kind: "lightCct" });
  // Выведенный профиль в шаблон не пишется — он выведется и там.
  assert.equal(Object.prototype.hasOwnProperty.call(snapshot.markTypes.find((type) => type.code === "С"), "device"), false);

  const fresh = createProject({ name: "Второй", ...typesTemplateFrom(snapshot) });
  assert.equal(typeDeviceOf(fresh, typeByCode(fresh, "Т").id).kind, "lightCct");
  assert.equal(typeDeviceOf(fresh, typeByCode(fresh, "С").id).derived, true);
  // Шаблон с мусором в профиле не уносит мусор в объект.
  const stale = { ...snapshot, markTypes: snapshot.markTypes.map((type) => ({ ...type, device: { kind: "?" } })) };
  const clean = typesTemplateFrom(stale);
  assert.ok(clean.markTypes.every((type) => !Object.prototype.hasOwnProperty.call(type, "device")));
});

test("профиль типа переживает «Добавить из общей базы»", () => {
  const { project } = scene();
  const own = addType(project, {
    code: "ЖЖ",
    name: "Жалюзи",
    categoryId: project.categories[0].id,
    device: { kind: "curtain" },
  }).project;
  const saved = typesSnapshot(own);
  const target = scene().project;
  const row = catalogOffer(target, saved).flatMap((group) => group.types).find((item) => item.code === "ЖЖ");
  assert.deepEqual(row.device, { kind: "curtain" }, "окно базы не знает, что приедет с типом");
  const added = addTypesFromCatalog(target, saved, ["ЖЖ"]).project;
  assert.equal(typeDeviceOf(added, typeByCode(added, "ЖЖ").id).kind, "curtain");

  // Тип встроенной базы приезжает без поля и выводит профиль сам.
  const without = deleteType(target, typeByCode(target, "КВ").id).project;
  const back = addTypesFromCatalog(without, null, ["КВ"]).project;
  const valve = typeByCode(back, "КВ");
  assert.equal(Object.prototype.hasOwnProperty.call(valve, "device"), false);
  assert.equal(typeDeviceOf(back, valve.id).kind, "valve");
});

test("своя настройка метки переживает копирование, а метка без неё копируется без поля", () => {
  let box = place(scene(), "Т", { x: 0.2, y: 0.2 });
  const plain = box.markId;
  box = place(box, "Т", { x: 0.4, y: 0.2 });
  const project = setMarkDevice(box.project, box.markId, { kind: "lightCct" }).project;

  const copied = pasteMark(project, markSnapshot(project, box.markId), { schemeId: box.schemeId, point: { x: 0.6, y: 0.6 } });
  assert.equal(markDeviceOwn(copied.project, copied.mark.id), true, "своя настройка не доехала до копии");
  assert.equal(markDeviceOf(copied.project, copied.mark.id).kind, "lightCct");

  const bare = pasteMark(project, markSnapshot(project, plain), { schemeId: box.schemeId, point: { x: 0.7, y: 0.6 } });
  assert.equal(Object.prototype.hasOwnProperty.call(findMark(bare.project, bare.mark.id), "device"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(markSnapshot(project, plain), "device"), false);
});

test("смена типа снимает свою настройку: метка берёт профиль нового типа", () => {
  const box = place(scene(), "Т");
  const own = setMarkDevice(box.project, box.markId, { kind: "lightRgb" }).project;
  const changed = changeMarkType(own, box.markId, typeByCode(own, "Бр").id).project;
  assert.equal(markDeviceOwn(changed, box.markId), false);
  assert.equal(markDeviceOf(changed, box.markId).kind, "light");
  assert.equal(Object.prototype.hasOwnProperty.call(findMark(changed, box.markId), "device"), false);
  // Метка без своей настройки меняет тип, не получая поля.
  const plain = changeMarkType(box.project, box.markId, typeByCode(box.project, "Бр").id).project;
  assert.equal(Object.prototype.hasOwnProperty.call(findMark(plain, box.markId), "device"), false);
});

// ——— G68: объект прежней разметки открывается как был ————————————————————

const LEGACY = [
  ["legacy-project.json", "g68-legacy-project"],
  ["legacy-views-project.json", "g68-legacy-views-project"],
];

for (const [name, print] of LEGACY) {
  test("G68: " + name + " проходит оба конвейера и упаковку байт в байт, профили видны выведенными", async () => {
    const text = read(name);
    const legacy = JSON.parse(text);
    const packedBefore = read("fixtures/" + print + ".packed.json");
    const storedBefore = read("fixtures/" + print + ".stored.json");

    // Конвейер файла: упаковка → project.json → распаковка.
    const blob = await packProject(legacy, new Map(), { date: new Date("2026-10-22T10:00:00Z") });
    const packed = new TextDecoder().decode((await readZip(blob)).get(PROJECT_ENTRY));
    assert.equal(packed, packedBefore, "project.json прежнего объекта стал другим текстом");
    const restored = (await unpackProject(blob)).project;
    const before = JSON.parse(packedBefore);
    for (const key of ["marks", "markTypes", "groups"]) {
      assert.equal(JSON.stringify(restored[key]), JSON.stringify(before[key]), key + " после файла");
    }
    // Конвейер базы браузера (`openProjectById`).
    const stored = projectsMigrateStored(legacy);
    assert.equal(JSON.stringify(stored, null, 2), storedBefore, "объект из базы открылся другим");
    if (legacy.formatVersion === 5) assert.equal(stored, legacy, "миграция объекта текущего формата что-то переписала");
    // Нового в файле — ни ключа.
    for (const key of ['"device"', '"scenarios"', '"logicBindings"']) {
      assert.ok(!packed.includes(key), "в файл прежнего объекта дописано " + key);
    }
    assert.equal(restored.formatVersion, 5);

    // Профили при этом видны — выведенными по коду.
    for (const project of [restored, stored]) {
      for (const type of project.markTypes) {
        const expected = PROFILE_BY_CODE[type.code];
        if (expected === undefined) continue;
        const profile = typeDeviceOf(project, type.id);
        assert.equal(profile ? profile.kind : null, expected ? expected.kind : null, type.code);
        if (profile) assert.equal(profile.derived, true);
      }
      for (const mark of project.marks) {
        const type = findType(project, mark.typeId);
        const expected = type ? PROFILE_BY_CODE[type.code] : undefined;
        if (expected) assert.equal(markDeviceOf(project, mark.id).kind, expected.kind, "метка " + type.code);
      }
    }
    assert.ok(text.length > 0);
  });
}

// ——— G68 (G11): профиль выключателя, сохранённый до G11 ————————————————————

test("G68: объект с профилем выключателя до G11 (одни кнопки) открывается байт в байт и читает те же кнопки", async () => {
  const legacy = simLegacySwitchProject();
  const blob = await packProject(legacy.project, new Map(), { date: new Date("2026-10-22T10:00:00Z") });
  const packed = new TextDecoder().decode((await readZip(blob)).get(PROJECT_ENTRY));
  assert.equal(packed, legacy.text, "project.json объекта до G11 стал другим текстом");
  const restored = (await unpackProject(blob)).project;
  for (const key of ["marks", "markTypes", "counters"]) {
    assert.equal(JSON.stringify(restored[key]), JSON.stringify(legacy.project[key]), key + " после файла");
  }
  const stored = projectsMigrateStored(legacy.project);
  assert.equal(stored, legacy.project, "открытие из базы переписало объект");
  const KEY_ONLY = ["StatelessProgrammableSwitch", ["ProgrammableSwitchEvent", "ServiceLabelIndex"]];
  for (const project of [restored, stored]) {
    for (const code of ["В", "ВВ"]) {
      const profile = typeDeviceOf(project, legacy.types[code]);
      assert.equal(profile.kind, "switch", code + ": вид профиля до G11");
      assert.equal(profile.derived, false);
      assert.deepEqual(profile.services.map((service) => [service.type, service.chars]), [KEY_ONLY], code + ": к кнопкам добавился сервис");
    }
    const shape = (label) =>
      markDeviceOf(project, legacy.marks[label]).services.map((service) => [service.type, service.channel, service.decoupled]);
    assert.deepEqual(shape("В1"), [["StatelessProgrammableSwitch", 1, false]]);
    assert.deepEqual(shape("ВВ1"), [
      ["StatelessProgrammableSwitch", 1, false],
      ["StatelessProgrammableSwitch", 2, true],
    ]);
    assert.deepEqual(shape("В2"), [["StatelessProgrammableSwitch", 1, true]]);
  }
});
