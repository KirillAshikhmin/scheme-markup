// Дом из объекта: аксессуары меток с адресами `aid.sid.cid` (таск 01
// сценариев, истории 1.1, 1.16). Чистое чтение — объект не правится, DOM нет;
// модуль идёт и в бандл движка (Worker), поэтому всё, что он отдаёт, —
// структурно клонируемые данные.
//
// **Адреса.** `aid` — чистая функция от `mark.id` (FNV-1a по строке id в
// диапазон 100000000…999999999): он не хранится и поэтому не меняется ни между
// сеансами, ни после сохранения в файл, ни после слияния папки, ни после
// приёмки файла (`adoptLoadedProject` переприсваивает только `project.id`).
// Совпадение у двух меток объекта разводится пробой по порядку `markId`.
// `sid` и `cid` идут подряд с 13 внутри аксессуара: сервис получает номер,
// следом номера получают его характеристики — как в ScenarioSimulator
// (`IdAllocator`, база 13). Они меняются только вместе с профилем.
import {
  deviceFollowers,
  findMark,
  findOpening,
  labelOf,
  logicBindingsOf,
  markControlsByChannel,
  markDeviceOf,
  markIsComment,
  markOpeningHit,
  openingOpens,
  openingsInWall,
  planFractionToMm,
  scenariosInOrder,
  segmentDistanceMm,
  wallVectors,
  wallsOnScheme,
} from "../model.js";
import { simServiceCharMeta, simServiceMeta } from "./catalog.js";

export const DEVICE_AID_MIN = 100000000;
export const DEVICE_AID_MAX = 999999999;
// Первый номер сервиса и характеристики внутри аксессуара (как в Sprut).
export const DEVICE_ID_START = 13;
// Как далеко датчик открытия ищет свою дверь, если его не привязали рукой.
export const DEVICE_DOOR_REACH_MM = 600;

const DEVICE_AID_SPAN = DEVICE_AID_MAX - DEVICE_AID_MIN + 1;
const DEVICE_TEXT = new TextEncoder();

/**
 * Адрес аксессуара метки — чистая функция от `mark.id`: одно и то же число в
 * любом вызове, на любой машине, после любой упаковки. Без разведения
 * совпадений — их разводит `deviceAids` по всему объекту.
 */
export function deviceAid(markId) {
  let hash = 0x811c9dc5;
  for (const byte of DEVICE_TEXT.encode(String(markId))) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return DEVICE_AID_MIN + (hash % DEVICE_AID_SPAN);
}

/**
 * Адреса всех меток объекта: `Map<markId, aid>`, различные. Совпавшие
 * разводятся пробой вверх по кольцу в порядке `markId` — тем, у кого id
 * меньше, достаётся исходный адрес. Счёт идёт по всем меткам, а не только по
 * устройствам: заведённый у соседа профиль не сдвигает чужой адрес.
 */
export function deviceAids(project) {
  return new Map(deviceHomeCache(project).aids());
}

// Кэш чтения по ссылке на объект (ревью ветки, F1): объект неизменяем — каждая
// правка даёт новый, — поэтому всё, что прочитано из одного объекта, верно для
// него навсегда. Без кэша `markAccessory` на каждый вызов сортировал адреса
// всех меток, а мини-план зовёт его на каждую видимую метку: 105 мс на щелчок в
// доме из 500 устройств. `WeakMap` отпускает старые объекты сам.
const DEVICE_HOME_CACHE = new WeakMap();
const DEVICE_HOME_NONE = { aids: () => new Map(), accessories: new Map() };

function deviceHomeCache(project) {
  if (!project || typeof project !== "object") return DEVICE_HOME_NONE;
  let cached = DEVICE_HOME_CACHE.get(project);
  if (!cached) {
    let aids = null;
    cached = { aids: () => aids || (aids = deviceAidsOf(project)), accessories: new Map() };
    DEVICE_HOME_CACHE.set(project, cached);
  }
  return cached;
}

// Замороженный аксессуар: один ответ на всех читателей, и случайная правка
// ответа одним из них не испортит его другим. Словарь характеристики (`meta`)
// — общий справочник, он не трогается.
function deviceFrozen(accessory) {
  if (!accessory) return null;
  for (const service of accessory.services) {
    for (const char of service.chars) Object.freeze(char);
    Object.freeze(service.chars);
    Object.freeze(service);
  }
  Object.freeze(accessory.services);
  Object.freeze(accessory.params);
  return Object.freeze(accessory);
}

function deviceAidsOf(project) {
  const ids = (project && Array.isArray(project.marks) ? project.marks : [])
    .map((mark) => mark.id)
    .filter((id) => typeof id === "string")
    .sort();
  const taken = new Set();
  const aids = new Map();
  for (const id of ids) {
    if (aids.has(id)) continue;
    let aid = deviceAid(id);
    while (taken.has(aid)) aid = aid === DEVICE_AID_MAX ? DEVICE_AID_MIN : aid + 1;
    taken.add(aid);
    aids.set(id, aid);
  }
  return aids;
}

/**
 * Номера сервисов и характеристик аксессуара по его развёрнутым сервисам
 * (`markDeviceOf(...).services` или любой список `{chars}` в том же порядке):
 * `[{sid, cids}]` — подряд с `DEVICE_ID_START`, сервис, следом его
 * характеристики. Одно правило для дома и для окна «Аксессуар» (G12).
 */
export function deviceIdsOf(services) {
  let next = DEVICE_ID_START;
  return (Array.isArray(services) ? services : []).map((service) => {
    const sid = next;
    next += 1;
    const cids = (Array.isArray(service.chars) ? service.chars : []).map(() => {
      next += 1;
      return next - 1;
    });
    return { sid, cids };
  });
}

function deviceAccessory(project, mark, aid) {
  const profile = markDeviceOf(project, mark.id);
  if (!profile) return null;
  const ids = deviceIdsOf(profile.services);
  const services = profile.services.map((service, index) => {
    const sid = ids[index].sid;
    const meta = simServiceMeta(service.type);
    const chars = service.chars.map((type, at) => {
      const cid = ids[index].cids[at];
      const charMeta = simServiceCharMeta(service.type, type);
      // Номер клавиши — константа сервиса: канал, а у одиночной кнопки — 1.
      const value = type === "ServiceLabelIndex" ? service.channel || 1 : charMeta ? charMeta.initial : null;
      return { cid, type, address: aid + "." + sid + "." + cid, meta: charMeta, value };
    });
    return {
      sid,
      index,
      type: service.type,
      name: service.name || null,
      channel: service.channel,
      decoupled: service.decoupled === true,
      aux: Boolean(meta && meta.aux),
      address: aid + "." + sid,
      chars,
    };
  });
  return {
    aid,
    markId: mark.id,
    typeId: mark.typeId,
    schemeId: mark.schemeId || null,
    roomId: mark.roomId || null,
    label: labelOf(project, mark.id),
    kind: profile.kind,
    own: profile.own === true,
    params: { ...profile.params },
    services,
  };
}

/**
 * Аксессуар метки: `{aid, markId, typeId, schemeId, roomId, label, kind, own,
 * params, services: [{sid, index, type, name, channel, decoupled, aux,
 * address, chars: [{cid, type, address, meta, value}]}]}` — или `null`, если
 * метка не устройство. `value` — начальное значение имитации (у номера
 * клавиши — сам номер).
 */
export function markAccessory(project, markId) {
  // Ведомая метка группы — аксессуар ведущей (правка после сборки сценариев):
  // щелчок по любой лампе группы переключает её общий аксессуар.
  const leader = project ? deviceFollowers(project).get(markId) : null;
  if (leader) return markAccessory(project, leader);
  const cache = deviceHomeCache(project);
  if (cache.accessories.has(markId)) return cache.accessories.get(markId);
  const mark = project ? findMark(project, markId) : null;
  const accessory = !mark || markIsComment(mark) ? null : deviceFrozen(deviceAccessory(project, mark, cache.aids().get(mark.id) || deviceAid(mark.id)));
  if (project && typeof project === "object") cache.accessories.set(markId, accessory);
  return accessory;
}

/**
 * Куда слать щелчок по клавише канала `channel` (G11): индекс кнопки
 * (`StatelessProgrammableSwitch`) этого канала у аксессуара — `act {kind:
 * "toggle" | "press", service}` по нему. Привязанная клавиша с «Выключателем»
 * переключит его, отвязанная пришлёт нажатие. Канала без кнопки — `null`;
 * канал без номера — первый.
 */
export function deviceKeyIndex(accessory, channel = 1) {
  const wanted = Number.isInteger(channel) && channel >= 1 ? channel : 1;
  const services = accessory && Array.isArray(accessory.services) ? accessory.services : [];
  const key = services.find(
    (service) => service.type === "StatelessProgrammableSwitch" && (Number.isInteger(service.channel) ? service.channel : 1) === wanted,
  );
  return key ? key.index : null;
}

/** Аксессуары всех меток-устройств объекта, в порядке объекта. */
export function homeAccessories(project) {
  if (!project || !Array.isArray(project.marks)) return [];
  const aids = deviceHomeCache(project).aids();
  const followers = deviceFollowers(project);
  const out = [];
  for (const mark of project.marks) {
    // Ведомая метка группы своего аксессуара не имеет: сценарию — одна.
    if (markIsComment(mark) || followers.has(mark.id)) continue;
    const accessory = deviceAccessory(project, mark, aids.get(mark.id) || deviceAid(mark.id));
    if (accessory) out.push(accessory);
  }
  return out;
}

function deviceIsContact(project, markId) {
  const profile = markDeviceOf(project, markId);
  return Boolean(profile) && profile.services.some((service) => service.type === "ContactSensor");
}

/**
 * Дверь датчика открытия: своя (`mark.device.doorId`; `null` — связь снята
 * рукой) → проём, в который метка попала (`markOpeningHit`) → ближайшая
 * открывающаяся дверь схемы не дальше `DEVICE_DOOR_REACH_MM`. `null` — двери
 * нет или метка не датчик открытия.
 */
export function markDoorOf(project, markId) {
  const mark = project ? findMark(project, markId) : null;
  if (!mark || !deviceIsContact(project, markId)) return null;
  const device = mark.device && typeof mark.device === "object" ? mark.device : null;
  if (device && Object.prototype.hasOwnProperty.call(device, "doorId")) {
    if (device.doorId === null) return null;
    if (typeof device.doorId === "string" && findOpening(project, device.doorId)) return device.doorId;
  }
  const hit = markOpeningHit(project, mark);
  if (hit && openingOpens(hit.kind)) return hit.id;
  const first = Array.isArray(mark.points) && mark.points.length > 0 ? mark.points[0] : null;
  const at = first ? planFractionToMm(project, mark.schemeId, first) : null;
  if (!at) return null;
  let best = null;
  for (const wall of wallsOnScheme(project, mark.schemeId)) {
    const vectors = wallVectors(wall);
    if (!vectors) continue;
    for (const opening of openingsInWall(project, wall.id)) {
      if (!openingOpens(opening.kind)) continue;
      const from = Number(opening.atMm);
      const to = from + Number(opening.widthMm);
      const a = { x: wall.aMm.x + vectors.u.x * from, y: wall.aMm.y + vectors.u.y * from };
      const b = { x: wall.aMm.x + vectors.u.x * to, y: wall.aMm.y + vectors.u.y * to };
      const distance = segmentDistanceMm(at, a, b);
      if (distance <= DEVICE_DOOR_REACH_MM && (!best || distance < best.distance)) best = { id: opening.id, distance };
    }
  }
  return best ? best.id : null;
}

/**
 * Всё, что движку нужно знать о доме, одним клонируемым значением:
 * `{accessories, links, doors, scenarios, logicBindings}`. `links` — прямые
 * связи клавиш «чем управляет» (`markControlsByChannel`): `[{markId, channel,
 * targets: [markId]}]`; `doors` — `[{markId, openingId}]` для датчиков открытия.
 */
export function buildHomeSpec(project) {
  const accessories = homeAccessories(project);
  const followers = deviceFollowers(project);
  const lead = (markId) => followers.get(markId) || markId;
  const links = [];
  const doors = [];
  for (const accessory of accessories) {
    if (accessory.services.some((service) => service.type === "StatelessProgrammableSwitch")) {
      // Связи ведущей — вместе со связями её ведомых, а подопечные — ведущие
      // своих групп: клавиша, которая управляет второй лампой группы,
      // управляет её общим аксессуаром.
      const members = [accessory.markId, ...[...followers].filter(([, leader]) => leader === accessory.markId).map(([id]) => id)];
      const byChannel = new Map();
      for (const member of members) {
        for (const group of markControlsByChannel(project, member)) {
          if (!byChannel.has(group.channel)) byChannel.set(group.channel, []);
          const list = byChannel.get(group.channel);
          for (const mark of group.marks) if (!list.includes(lead(mark.id))) list.push(lead(mark.id));
        }
      }
      for (const [channel, targets] of byChannel) links.push({ markId: accessory.markId, channel, targets });
    }
    if (accessory.services.some((service) => service.type === "ContactSensor")) {
      const openingId = markDoorOf(project, accessory.markId);
      if (openingId) doors.push({ markId: accessory.markId, openingId });
    }
  }
  // Сценарий и привязка, названные ведомой меткой, достаются ведущей: так
  // сценарий, собранный до того, как метки сгруппировали, не теряет устройства.
  return {
    accessories,
    links,
    doors,
    scenarios: homeLeadMarks(structuredClone(scenariosInOrder(project)), followers),
    logicBindings: homeLeadMarks(structuredClone(logicBindingsOf(project)), followers),
  };
}

/**
 * Сценарий так, как его увидит дом: ссылки на ведомые метки групп — ведущим.
 * Копия, если подменять есть что, иначе тот же объект. Нужна проверке
 * сценария в редакторе — иначе она назвала бы пропавшим устройство, на
 * котором дом его исполнит.
 */
export function homeLeadScenario(project, scenario) {
  const followers = deviceFollowers(project);
  if (followers.size === 0 || !scenario || typeof scenario !== "object") return scenario;
  return homeLeadMarks(structuredClone(scenario), followers);
}

/** Поля `markId` в копии сценариев и привязок: ведомая метка → ведущая (на месте). */
function homeLeadMarks(value, followers) {
  if (followers.size === 0 || !value || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    for (const item of value) homeLeadMarks(item, followers);
    return value;
  }
  for (const [key, item] of Object.entries(value)) {
    if (key === "markId" && typeof item === "string" && followers.has(item)) value[key] = followers.get(item);
    else if (item && typeof item === "object") homeLeadMarks(item, followers);
  }
  return value;
}
