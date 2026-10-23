// Перевод аксессуаров старых объектов на нынешние виды (правка после сборки
// сценариев, правило G68: готовый проект пользователя не ломается).
//
// Два перевода, оба — словами заказчика:
//
//   «У всех выключателей считаем что есть реле на каждую клавишу. По факту
//   это может быть как умный выключатель, так и реле в подрозетнике». Вид
//   «Выключатель без реле (только кнопки)» (`switch`, так выключатели
//   выглядели до G11) становится «Выключателем» (`switchRelay`): на каждый
//   канал «Выключатель», затем кнопки. Номера сервисов кнопок сдвигаются на
//   число каналов — и ссылки сценариев, привязки логики и адреса в их опциях
//   переезжают вслед. Клавиша, на нажатия которой опирается сценарий или
//   логика, становится отвязанной: привязанная кнопка нажатий не шлёт (G11), и
//   сценарий замолчал бы.
//
//   «У термостатов в режиме Авто есть не пороги нагрева и охлаждения, а одна
//   характеристика — целевая температура» и выбор «Кондиционер → Термостат».
//   «Нагреватель-охладитель» кондиционера становится «Термостатом» на том же
//   месте: два порога — одной целевой температурой, «Активен» — режимом
//   «Выкл», состояния и режимы — своими именами термостата.
//
// Миграция **молчалива и идемпотентна**: переводить нечего — тот же объект по
// ссылке. Записи профилей правятся на месте (у вида без своей записи
// переводить нечего: он выводится по коду и уже новый), а ссылки — по
// сопоставлению сервисов «до» и «после».
//
// Модуль стоит отдельно от модели нарочно: ему нужны адреса хаба
// (`sim/home.js`), а дом сам читает модель — в модели это был бы круг.
import { findType, markDeviceLeader, markDeviceOf, typeDeviceOf } from "./model.js";
import { simServiceMeta } from "./sim/catalog.js";
import { deviceAids, deviceIdsOf } from "./sim/home.js";

const MIGRATE_SWITCH_OLD = "switch";
const MIGRATE_SWITCH_NEW = "switchRelay";
const MIGRATE_RELAY = Object.freeze({ type: "Switch", chars: ["On"], perChannel: true });
const MIGRATE_KEY = "StatelessProgrammableSwitch";
const MIGRATE_CONDITIONER = "conditioner";
const MIGRATE_HEATER = "HeaterCooler";
const MIGRATE_THERMOSTAT = "Thermostat";

/** Сервис кондиционера, каким его выводил вид `conditioner` до перевода. */
export const MIGRATE_CONDITIONER_LEGACY = Object.freeze([
  Object.freeze({
    type: MIGRATE_HEATER,
    chars: Object.freeze([
      "Active",
      "CurrentTemperature",
      "CurrentHeaterCoolerState",
      "TargetHeaterCoolerState",
      "CoolingThresholdTemperature",
      "HeatingThresholdTemperature",
    ]),
    channel: null,
  }),
]);

// Характеристики «Нагревателя-охладителя» в профиле → характеристики
// «Термостата». Скорость — своей характеристикой термостата (`C_FanSpeed`).
const MIGRATE_HEATER_PROFILE = Object.freeze({
  Active: "TargetHeatingCoolingState",
  CurrentTemperature: "CurrentTemperature",
  CurrentHeaterCoolerState: "CurrentHeatingCoolingState",
  TargetHeaterCoolerState: "TargetHeatingCoolingState",
  CoolingThresholdTemperature: "TargetTemperature",
  HeatingThresholdTemperature: "TargetTemperature",
  RotationSpeed: "C_FanSpeed",
  SwingMode: "SwingMode",
  TemperatureDisplayUnits: "TemperatureDisplayUnits",
  CurrentPosition: "CurrentPosition",
  TargetPosition: "TargetPosition",
  C_FanSpeed: "C_FanSpeed",
  Name: "Name",
});

// Ссылки сценариев: только то, что переводится без потери смысла. Скорость в
// процентах в ступени вентилятора не переводится — такая ссылка остаётся и
// редактор покажет её неполной.
const MIGRATE_HEATER_REFS = Object.freeze({
  Active: "TargetHeatingCoolingState",
  CurrentHeaterCoolerState: "CurrentHeatingCoolingState",
  TargetHeaterCoolerState: "TargetHeatingCoolingState",
  CoolingThresholdTemperature: "TargetTemperature",
  HeatingThresholdTemperature: "TargetTemperature",
});

const MIGRATE_HEATER_VALUES = Object.freeze({
  Active: Object.freeze({ ACTIVE: "AUTO", INACTIVE: "OFF" }),
  CurrentHeaterCoolerState: Object.freeze({ INACTIVE: "OFF", IDLE: "OFF", HEATING: "HEAT", COOLING: "COOL" }),
  TargetHeaterCoolerState: Object.freeze({ AUTO: "AUTO", HEAT: "HEAT", COOL: "COOL" }),
});

function migrateObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function migrateServices(record) {
  return migrateObject(record) && Array.isArray(record.services) && record.services.length > 0 ? record.services : null;
}

// Свои сервисы выключателя без реле — с «Выключателем» на каждый канал.
function migrateWithRelay(services) {
  if (services.some((service) => migrateObject(service) && service.type === MIGRATE_RELAY.type)) return services;
  return [{ ...MIGRATE_RELAY, chars: [...MIGRATE_RELAY.chars] }, ...services];
}

// Свои сервисы кондиционера — «Термостат» вместо «Нагревателя-охладителя».
// Термостат уже есть рядом — значит, перевод был, а нагреватель добавлен
// руками после него: его не трогаем.
function migrateHeaterServices(services) {
  if (!services.some((service) => migrateObject(service) && service.type === MIGRATE_HEATER)) return services;
  if (services.some((service) => migrateObject(service) && service.type === MIGRATE_THERMOSTAT)) return services;
  const meta = simServiceMeta(MIGRATE_THERMOSTAT);
  const allowed = new Set(meta ? [...meta.required, ...meta.optional] : []);
  return services.map((service) => {
    if (!migrateObject(service) || service.type !== MIGRATE_HEATER) return service;
    const chars = [];
    for (const char of Array.isArray(service.chars) ? service.chars : []) {
      const next = MIGRATE_HEATER_PROFILE[char];
      if (next && allowed.has(next) && !chars.includes(next)) chars.push(next);
    }
    return { ...service, type: MIGRATE_THERMOSTAT, chars };
  });
}

// Откуда у метки сервисы: из своей записи, из записи типа или из вида. Нужен
// ответ только кондиционеру: «из вида» значит, что до перевода сервисом был
// прежний нагреватель (`MIGRATE_CONDITIONER_LEGACY`), а записи, где это
// видно, в объекте нет.
function migrateFromKind(project, mark) {
  const own = migrateObject(mark.device) ? mark.device : null;
  if (migrateServices(own)) return false;
  const base = typeDeviceOf(project, mark.typeId);
  if (own && typeof own.kind === "string" && base && own.kind !== base.kind) return true;
  const type = findType(project, mark.typeId);
  return !migrateServices(type && migrateObject(type.device) ? type.device : null);
}

// Сервис «после» для сервиса «до»: тот же тип (нагреватель — термостатом) и
// канал, по порядку среди таких.
function migrateIndexMap(before, after) {
  const map = new Map();
  const same = (service) => (service.type === MIGRATE_HEATER ? MIGRATE_THERMOSTAT : service.type) + "#" + (service.channel ?? "");
  const taken = new Set();
  before.forEach((service, index) => {
    const key = same(service);
    const found = after.findIndex((item, at) => !taken.has(at) && same(item) === key);
    if (found < 0) return;
    taken.add(found);
    map.set(index, found);
  });
  return map;
}

// Адреса «до» → «после»: `aid.sid` и `aid.sid.cid`.
function migrateAddresses(aid, before, after, index, charOf) {
  const map = new Map();
  const old = deviceIdsOf(before);
  const now = deviceIdsOf(after);
  before.forEach((service, at) => {
    const to = index.get(at);
    if (to === undefined || !now[to]) return;
    map.set(aid + "." + old[at].sid, aid + "." + now[to].sid);
    (service.chars || []).forEach((char, position) => {
      const next = charOf(at, char) || char;
      const there = (after[to].chars || []).indexOf(next);
      if (there >= 0) map.set(aid + "." + old[at].sid + "." + old[at].cids[position], aid + "." + now[to].sid + "." + now[to].cids[there]);
    });
  });
  return map;
}

// ——— ссылки сценариев ————————————————————————————————————————————————————

function migrateCondition(block, plan) {
  const ref = block.ref;
  const service = plan.index(ref.service);
  const char = typeof ref.char === "string" ? plan.charOf(ref.service, ref.char) : null;
  if (service === ref.service && !char) return block;
  const next = { ...block, ref: { ...ref, service, ...(char ? { char } : {}) } };
  if (!char) return next;
  if (ref.char === "Active") {
    // «Активен» — «режим не Выкл»: равенство и неравенство меняются местами.
    if (block.op === "eq" || block.op === "ne") {
      const active = block.value === "ACTIVE" || block.value === 1;
      next.op = (block.op === "eq") === active ? "ne" : "eq";
      next.value = "OFF";
    }
    return next;
  }
  const values = MIGRATE_HEATER_VALUES[ref.char];
  if (values && typeof block.value === "string" && values[block.value]) next.value = values[block.value];
  return next;
}

function migrateFrom(from, plans) {
  if (!migrateObject(from) || typeof from.markId !== "string") return from;
  const plan = plans.get(from.markId);
  if (!plan) return from;
  const service = plan.index(from.service);
  const char = typeof from.char === "string" ? plan.charOf(from.service, from.char) : null;
  if (service === from.service && !char) return from;
  return { ...from, service, ...(char ? { char } : {}) };
}

function migrateAction(block, plans) {
  const ref = block.ref;
  const plan = plans.get(ref.markId) || null;
  const service = plan ? plan.index(ref.service) : ref.service;
  let changed = service !== ref.service;
  const seen = new Set();
  const items = [];
  for (const item of Array.isArray(block.items) ? block.items : []) {
    if (!migrateObject(item)) {
      items.push(item);
      continue;
    }
    let next = item;
    const char = plan && typeof item.char === "string" ? plan.charOf(ref.service, item.char) : null;
    if (char) {
      next = { ...next, char };
      const values = MIGRATE_HEATER_VALUES[item.char];
      if (item.verb === "set" && values && typeof item.value === "string" && values[item.value]) next.value = values[item.value];
    }
    const from = migrateFrom(item.from, plans);
    if (from !== item.from) next = { ...next, from };
    // Два порога одной правкой стали одной температурой: остаётся первая.
    if (char && seen.has(next.char)) {
      changed = true;
      continue;
    }
    if (typeof next.char === "string") seen.add(next.char);
    if (next !== item) changed = true;
    items.push(next);
  }
  if (!changed) return block;
  return { ...block, ref: { ...ref, service }, items };
}

function migrateTree(value, plans) {
  if (Array.isArray(value)) {
    let changed = false;
    const out = value.map((item) => {
      const next = migrateTree(item, plans);
      if (next !== item) changed = true;
      return next;
    });
    return changed ? out : value;
  }
  if (!migrateObject(value)) return value;
  let next = value;
  for (const key of Object.keys(value)) {
    if (key === "ref") continue;
    const child = value[key];
    const moved = migrateTree(child, plans);
    if (moved !== child) {
      if (next === value) next = { ...value };
      next[key] = moved;
    }
  }
  if (next.type !== "device" || !migrateObject(next.ref)) return next;
  if (Array.isArray(next.items)) return migrateAction(next, plans);
  const plan = typeof next.ref.markId === "string" ? plans.get(next.ref.markId) : null;
  return plan && Number.isInteger(next.ref.service) ? migrateCondition(next, plan) : next;
}

// Какие сервисы-кнопки (по номерам «до») держат на себе сценарий или логику.
function migrateKeyUses(project, markId, before) {
  const keys = new Set(before.map((service, index) => (service.type === MIGRATE_KEY ? index : -1)).filter((index) => index >= 0));
  const used = new Set();
  const lead = (id) => markDeviceLeader(project, id) || id;
  const visit = (value) => {
    if (Array.isArray(value)) value.forEach(visit);
    else if (migrateObject(value)) {
      if (value.type === "device" && migrateObject(value.ref) && !Array.isArray(value.items)) {
        if (typeof value.ref.markId === "string" && lead(value.ref.markId) === markId && keys.has(value.ref.service)) used.add(value.ref.service);
      }
      for (const key of Object.keys(value)) visit(value[key]);
    }
  };
  for (const scenario of Array.isArray(project.scenarios) ? project.scenarios : []) {
    if (migrateObject(scenario) && scenario.kind === "block") visit(scenario.targets);
  }
  for (const binding of Array.isArray(project.logicBindings) ? project.logicBindings : []) {
    if (migrateObject(binding) && lead(binding.markId) === markId && keys.has(binding.service)) used.add(binding.service);
  }
  return [...used].map((index) => before[index].channel || 1).sort((first, second) => first - second);
}

/**
 * Перевести аксессуары объекта: выключатели без реле — на выключатели с реле,
 * «Нагреватель-охладитель» кондиционера — на «Термостат». `{project, changed,
 * switches, conditioners}` — сколько меток переведено. Переводить нечего — тот
 * же объект.
 */
export function migrateDevices(project) {
  const idle = { project, changed: false, switches: 0, conditioners: 0 };
  if (!project || !Array.isArray(project.marks) || !Array.isArray(project.markTypes)) return idle;
  const before = new Map();
  const kinds = new Map();
  for (const mark of project.marks) {
    if (!mark || typeof mark.id !== "string") continue;
    const profile = markDeviceOf(project, mark.id);
    if (!profile) continue;
    if (profile.kind === MIGRATE_SWITCH_OLD) {
      before.set(mark.id, profile.services);
      kinds.set(mark.id, MIGRATE_SWITCH_OLD);
    } else if (profile.kind === MIGRATE_CONDITIONER) {
      const lead = project.marks.find((item) => item.id === (markDeviceLeader(project, mark.id) || mark.id)) || mark;
      const legacy = migrateFromKind(project, lead);
      const services = legacy ? MIGRATE_CONDITIONER_LEGACY : profile.services;
      // Нагревателя нет — переводить нечего; есть и термостат — перевод уже
      // был, а нагреватель добавлен руками после него.
      if (!services.some((service) => service.type === MIGRATE_HEATER)) continue;
      if (!legacy && services.some((service) => service.type === MIGRATE_THERMOSTAT)) continue;
      before.set(mark.id, services);
      kinds.set(mark.id, legacy ? "conditionerKind" : MIGRATE_CONDITIONER);
    }
  }
  // Записи типов правятся и без меток: справочник из шаблона или из общей базы
  // приходит раньше своих меток.

  // ——— записи профилей ———
  const decouple = new Map();
  for (const [markId, services] of before) {
    if (kinds.get(markId) !== MIGRATE_SWITCH_OLD || markDeviceLeader(project, markId)) continue;
    const used = migrateKeyUses(project, markId, services);
    if (used.length > 0) decouple.set(markId, used);
  }
  let typesChanged = false;
  const markTypes = project.markTypes.map((type) => {
    const record = type && migrateObject(type.device) ? type.device : null;
    if (!record) return type;
    if (record.kind === MIGRATE_SWITCH_OLD) {
      typesChanged = true;
      const services = migrateServices(record);
      return { ...type, device: { ...record, kind: MIGRATE_SWITCH_NEW, ...(services ? { services: migrateWithRelay(services) } : {}) } };
    }
    const services = record.kind === MIGRATE_CONDITIONER ? migrateServices(record) : null;
    if (!services) return type;
    const next = migrateHeaterServices(services);
    if (next === services) return type;
    typesChanged = true;
    return { ...type, device: { ...record, services: next } };
  });
  let marksChanged = false;
  const marks = project.marks.map((mark) => {
    if (!mark) return mark;
    const record = migrateObject(mark.device) ? mark.device : null;
    const base = typeDeviceOf(project, mark.typeId);
    const kind = record && typeof record.kind === "string" ? record.kind : base ? base.kind : null;
    let next = record;
    const services = migrateServices(record);
    if (record && record.kind === MIGRATE_SWITCH_OLD) next = { ...record, kind: MIGRATE_SWITCH_NEW };
    if (services && kind === MIGRATE_SWITCH_OLD) next = { ...next, services: migrateWithRelay(services) };
    if (services && kind === MIGRATE_CONDITIONER) {
      const converted = migrateHeaterServices(services);
      if (converted !== services) next = { ...next, services: converted };
    }
    const keys = decouple.get(mark.id);
    if (keys) {
      const own = next && Array.isArray(next.decoupled) ? next.decoupled : [];
      const merged = [...new Set([...own, ...keys])].sort((first, second) => first - second);
      if (merged.length !== own.length) next = { ...(next || {}), decoupled: merged };
    }
    if (next === record) return mark;
    marksChanged = true;
    return { ...mark, device: next };
  });
  const rewritten = typesChanged || marksChanged ? { ...project, markTypes, marks } : project;

  // ——— сопоставление «до» и «после» ———
  const aids = deviceAids(rewritten);
  const plans = new Map();
  const addresses = new Map();
  let switches = 0;
  let conditioners = 0;
  for (const [markId, old] of before) {
    const profile = markDeviceOf(rewritten, markId);
    if (!profile) continue;
    const now = profile.services;
    const index = migrateIndexMap(old, now);
    const heater = new Set(old.map((service, at) => (service.type === MIGRATE_HEATER ? at : -1)).filter((at) => at >= 0));
    const charOf = (at, char) => (heater.has(at) && MIGRATE_HEATER_REFS[char]) || null;
    plans.set(markId, { index: (at) => (index.has(at) ? index.get(at) : at), charOf });
    const kind = kinds.get(markId);
    if (kind === MIGRATE_SWITCH_OLD) switches += 1;
    else conditioners += 1;
    // Адреса в опциях логики — только там, где перевод случается один раз:
    // у записи, которую он правит. Кондиционер без своей записи выводится по
    // виду при каждом чтении, и второй проход сдвинул бы адреса ещё раз.
    if (kind === "conditionerKind") continue;
    const lead = markDeviceLeader(rewritten, markId) || markId;
    const aid = aids.get(lead);
    if (aid === undefined) continue;
    for (const [from, to] of migrateAddresses(aid, old, now, index, charOf)) if (from !== to) addresses.set(from, to);
  }

  // ——— ссылки ———
  let scenariosChanged = false;
  const scenarios = Array.isArray(project.scenarios)
    ? project.scenarios.map((scenario) => {
        if (!migrateObject(scenario) || scenario.kind !== "block") return scenario;
        const targets = migrateTree(scenario.targets, plans);
        if (targets === scenario.targets) return scenario;
        scenariosChanged = true;
        return { ...scenario, targets };
      })
    : project.scenarios;
  let bindingsChanged = false;
  const logicBindings = Array.isArray(project.logicBindings)
    ? project.logicBindings.map((binding) => {
        if (!migrateObject(binding)) return binding;
        let next = binding;
        const plan = plans.get(binding.markId);
        if (plan && Number.isInteger(binding.service)) {
          const service = plan.index(binding.service);
          if (service !== binding.service) next = { ...next, service };
        }
        if (addresses.size > 0 && migrateObject(binding.options)) {
          let options = binding.options;
          for (const [key, value] of Object.entries(binding.options)) {
            if (typeof value !== "string" || !addresses.has(value)) continue;
            if (options === binding.options) options = { ...binding.options };
            options[key] = addresses.get(value);
          }
          if (options !== binding.options) next = { ...next, options };
        }
        if (next !== binding) bindingsChanged = true;
        return next;
      })
    : project.logicBindings;

  if (rewritten === project && !scenariosChanged && !bindingsChanged) return idle;
  const out = { ...rewritten };
  if (scenariosChanged) out.scenarios = scenarios;
  if (bindingsChanged) out.logicBindings = logicBindings;
  return { project: out, changed: true, switches, conditioners };
}
