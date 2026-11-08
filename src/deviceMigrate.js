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
import {
  FORMAT_VERSION_IDS,
  addSchemeObject,
  findMark,
  findType,
  findWall,
  idNumberOf,
  markDeviceLeader,
  markDeviceOf,
  markIsComment,
  markObjectId,
  markOfObject,
  markSizes,
  markWall,
  markWallSide,
  planFractionToMm,
  projectFormatVersion,
  schemeObjectsOnScheme,
  setMarkObject,
  typeDeviceOf,
  wallVectors,
} from "./model.js";
import { objectCatalogDefaults } from "./objectCatalog.js";
import { simServiceMeta } from "./sim/catalog.js";
import { deviceIdsOf } from "./sim/home.js";

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
    // Адрес аксессуара — номер ведущей метки (G392: своей двери у адреса нет).
    const aid = idNumberOf(lead);
    if (aid === null) continue;
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

// ——— метка прибора получает вещь (G01, история 15) ————————————————————————
//
// Слова заказчика о телевизоре и полотенцесушителе на готовых объектах:
// «Перевести миграцией сразу».
//
// Таск 186 увёл телевизор, полотенцесушитель и вытяжку из вещей чертежа в
// метки — «потому что он будет интерактивным». Прибор получил электрику и
// потерял форму: угла у метки нет вовсе, и телевизор на плане встал по осям
// плана, а не к дивану. Сборка «связь метки и вещи» вернула все три в каталог,
// и теперь прибор — это **вещь плюс связанная метка**.
//
// Миграция **достраивает, а не заменяет**: метке типа ТВ, ПОС или ВЫТ рядом
// заводится вещь с тем же местом и габаритом, и ставится связь. Сама метка не
// меняется ничем, кроме поля связи, — поэтому номер, обозначение, аксессуар,
// сценарии, привязки логики, связи «чем управляет» и роль вытяжки в климате
// (она читается по коду типа) остаются теми же, а объект без таких меток не
// меняется вовсе.
//
// Что **не** переводится, и это сознательно:
//
//   — метка с **переименованным кодом** типа («СУШ», «Пос», «Вытяжка» — такие
//     есть у заказчика). Код — единственный однозначный признак; угадывать по
//     имени значило бы применять догадку, а правило дома — «догадку показывают,
//     а не применяют». Такая метка остаётся меткой, и человек связывает её с
//     вещью рукой одним действием;
//   — метка **без моста мм ↔ доли** (у схемы нет калибровки или привязки начала
//     координат): места в миллиметрах для вещи не посчитать, а поставить её
//     «куда-нибудь» значит нарисовать прибор не там, где он стоит;
//   — метка-линия и метка со многими точками: форму ей провёл человек, и свести
//     её к прямоугольнику нельзя;
//   — метка, у которой связь уже есть: отсюда и идемпотентность.
//
// **Вещь, которая уже стоит, второй не обрастает.** Телевизор и
// полотенцесушитель были вещами до таска 186, и на готовом объекте заказчика
// они встречаются и вещью, и меткой сразу (в одном из четырёх — обе). Достроить
// такой метке ещё одну вещь значило бы нарисовать на плане **второй**
// телевизор — ровно то двоение, от которого связь и заводится. Поэтому
// свободная вещь того же ключа каталога, **в габарит которой попала точка
// метки**, не достраивается, а связывается: правило то же, по которому сборка
// предлагает связь при постановке метки (`canvas.canvasLinkOffer`), только
// строже — ключ каталога обязан совпасть, иначе метка молча уехала бы на тумбу
// под телевизором.
const MIGRATE_THING_KEYS = Object.freeze({ ТВ: "tv", ПОС: "towelDryer", ВЫТ: "hood" });

// Код типа сверяется **без учёта регистра** — так его сравнивает и сама модель
// (`validate`: коды уникальны по `code.toUpperCase()`). У заказчика
// полотенцесушитель назван «Пос», и с учётом регистра его метка не переводилась
// бы, хотя вещь `towelDryer` рядом уже нарисована. Переименованное **имя** типа
// по-прежнему ни на что не влияет: узнаётся только код.
function migrateThingKey(type) {
  return type ? MIGRATE_THING_KEYS[String(type.code || "").trim().toUpperCase()] : undefined;
}

// Габарит метки — в габарит вещи, с переводом осей. У метки `length` идёт вдоль
// поверхности, `depth` — от неё, `width` — вверх, а `heightAboveFloor` — это
// **середина** прибора; у вещи это `widthMm` × `depthMm` × `heightMm` и
// `heightAboveFloorMm` — её **низ**. Ровно этим переводом пересчитаны умолчания
// самих вещей в каталоге (`objectCatalog.js`), и второго описания перевода в
// сборке быть не должно.
function migrateThingSize(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.round(number) : fallback;
}

// Куда вещь смотрит: от стены, к которой привязана метка, в сторону той её
// стороны, где метка стоит. Перёд вещи при нулевом повороте уходит вниз по
// листу (`workshopFrontAxis`), то есть `n = (−sin, cos)`; отсюда и угол.
// Привязки нет — нуля достаточно: без стены направления не знает никто.
function migrateThingTurn(project, mark) {
  const binding = markWall(mark);
  const vectors = binding ? wallVectors(findWall(project, binding.wallId)) : null;
  if (!vectors) return 0;
  const side = markWallSide(project, mark);
  const front = side === "right" ? { x: -vectors.n.x, y: -vectors.n.y } : vectors.n;
  const degrees = (Math.atan2(-front.x, front.y) * 180) / Math.PI;
  return ((Math.round(degrees) % 360) + 360) % 360;
}

// Насколько метка может стоять **мимо** габарита вещи и всё-таки считаться её
// меткой. Число снято с объекта заказчика: нарисованный телевизор там стоит в
// 239 мм от своего знака — знак на стене, корпус от стены, — а глубина вещи
// всего 80 мм, и «точка внутри габарита» такую пару не узнаёт. Триста
// миллиметров — это толщина стены с отделкой плюс корпус прибора; на этом
// расстоянии второго телевизора в комнате не бывает, а полтора метра было бы
// уже гаданием.
const MIGRATE_THING_NEAR_MM = 300;

// Свободная вещь того же ключа, под которой стоит метка, — или `null`. Из
// нескольких берётся самая малая по площади, как у предложения связи на плане.
// Попадание считается в осях самой вещи: вдоль — половина длины, поперёк —
// половина глубины, и то и другое с запасом `MIGRATE_THING_NEAR_MM`.
function migrateThingFound(project, mark, key, atMm) {
  let best = null;
  let bestArea = Infinity;
  for (const object of schemeObjectsOnScheme(project, mark.schemeId)) {
    if (object.catalogKey !== key || object.shape === "polyline") continue;
    if (markOfObject(project, object.id)) continue;
    const turn = ((Number(object.turnDeg) || 0) * Math.PI) / 180;
    const dx = atMm.x - Number(object.atMm.x);
    const dy = atMm.y - Number(object.atMm.y);
    const along = Math.abs(dx * Math.cos(turn) + dy * Math.sin(turn));
    const across = Math.abs(-dx * Math.sin(turn) + dy * Math.cos(turn));
    if (along > Number(object.widthMm) / 2 + MIGRATE_THING_NEAR_MM) continue;
    if (across > Number(object.depthMm) / 2 + MIGRATE_THING_NEAR_MM) continue;
    const area = Number(object.widthMm) * Number(object.depthMm);
    if (area >= bestArea) continue;
    best = object;
    bestArea = area;
  }
  return best;
}

/**
 * **Этот объект уже переведён?** — по версии формата, которую даёт его
 * содержимое (`projectFormatVersion`, ADR 030).
 *
 * Признак «связи нет» для этого не годится, и это стоило работы заказчика:
 * отвязал метку рукой — следующее открытие связало её снова; удалил
 * достроенную вещь — открытие достроило новую; отвязал и увёл метку в сторону
 * — на плане появилась **вторая** вещь. Приёмка истории 2 («Отвязать»
 * возвращает метку к прежнему поведению) переоткрытия не переживала.
 *
 * Версия 8 — ровно «объект прошёл эту сборку»: перенумерация и вещи приборам
 * приехали одним куском, и пронумерованный объект через `migrateThingMarks`
 * уже проходил. Спрашивается **содержимое**, а не поле `formatVersion`: поле у
 * объекта в базе браузера до этой правки никто не переписывал, и объект,
 * который уже перенумерован, лежал там версией 5 — то есть врал о себе.
 *
 * Дверь спрашивают **трубы открытия** у объекта, каким он пришёл, а не сама
 * миграция: собранный руками объект (`createProject`) пронумерован от
 * рождения, и спроси она себя — перевод не случился бы ни разу. Обе трубы
 * обязаны спросить одно и то же, поэтому вопрос живёт здесь, рядом с
 * переводом, а не двумя `if` в двух панелях.
 */
export function thingMarksMigrated(project) {
  return projectFormatVersion(project) >= FORMAT_VERSION_IDS;
}

/**
 * Достроить вещи меткам приборов: `{project, changed, made, linked}` — сколько
 * вещей собрано и сколько уже стоявших связано. Переводить нечего — **тот же**
 * объект по ссылке, и `updatedAt` не трогается ни в одном случае: миграция —
 * не правка разметки, в истории отмены от неё ничего не появляется.
 *
 * Зовётся **один раз на объект**: решает это труба открытия по
 * `thingMarksMigrated`.
 */
export function migrateThingMarks(project) {
  const idle = { project, changed: false, made: 0, linked: 0 };
  if (!project || !Array.isArray(project.marks) || !Array.isArray(project.markTypes)) return idle;
  const ids = project.marks.map((mark) => (mark ? mark.id : null)).filter((id) => id != null && id !== "");
  let next = project;
  let made = 0;
  let linked = 0;
  for (const markId of ids) {
    const mark = findMark(next, markId);
    if (!mark || markIsComment(mark) || markObjectId(mark) !== null) continue;
    if (mark.kind !== "point" || !Array.isArray(mark.points) || mark.points.length !== 1) continue;
    const type = findType(next, mark.typeId);
    const key = migrateThingKey(type);
    if (!key) continue;
    const atMm = planFractionToMm(next, mark.schemeId, mark.points[0]);
    const defaults = objectCatalogDefaults(key);
    if (!atMm || !defaults) continue;
    // Вещь того же ключа уже стоит под меткой — связываем её, а не строим
    // вторую (двоение на плане).
    const found = migrateThingFound(next, mark, key, atMm);
    if (found) {
      next = setMarkObject(next, markId, found.id).project;
      linked += 1;
      continue;
    }
    const sizes = markSizes(next, mark);
    const heightMm = migrateThingSize(sizes.width, defaults.heightMm);
    const middle = Number(sizes.heightAboveFloor);
    const bottomMm = Number.isFinite(middle) && sizes.heightAboveFloor !== null
      ? Math.max(0, Math.round(middle - heightMm / 2))
      : defaults.heightAboveFloorMm;
    const added = addSchemeObject(next, {
      schemeId: mark.schemeId,
      catalogKey: key,
      shape: "rect",
      atMm,
      widthMm: migrateThingSize(sizes.length, defaults.widthMm),
      depthMm: migrateThingSize(sizes.depth, defaults.depthMm),
      heightMm,
      heightAboveFloorMm: bottomMm,
      turnDeg: migrateThingTurn(next, mark),
    });
    next = setMarkObject(added.project, markId, added.schemeObject.id).project;
    made += 1;
  }
  if (made === 0 && linked === 0) return idle;
  // Правки доехали через двери модели, а они честно двигают `updatedAt` —
  // миграции он не положен: объект открылся, а не был правлен.
  return { project: { ...next, updatedAt: project.updatedAt }, changed: true, made, linked };
}
