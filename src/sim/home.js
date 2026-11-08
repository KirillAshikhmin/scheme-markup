// Дом из объекта: аксессуары меток с адресами `aid.sid.cid` (таск 01
// сценариев, истории 1.1, 1.16). Чистое чтение — объект не правится, DOM нет;
// модуль идёт и в бандл движка (Worker), поэтому всё, что он отдаёт, —
// структурно клонируемые данные.
//
// **Адреса.** `aid` — **номер метки** (`mark.id`; таск 04 связи меток и вещей,
// G10). Идентификатор сущности объекта стал коротким номером, уникальным по
// всем видам сразу (`idNumberOf`, `nextId` в `model.js`), и адрес читается из
// него, а не считается хэшем от uuid. Храниться он от этого не начал (ADR 012)
// и поэтому не меняется ни между сеансами, ни после сохранения в файл, ни
// после слияния папки, ни после приёмки файла (`adoptLoadedProject`
// переприсваивает только `project.id`). Разводить совпадения больше нечего:
// номера уникальны по условию, а адрес стал читаться как в настоящем хабе
// (`1.13.15`).
//
// Цена названа вслух и принята заказчиком: адрес, вписанный числом прямо в
// текст его сценария, после перенумерации указывает в пустоту. Дом при этом
// идёт — `charByAddress` отвечает «нет такой характеристики», исключение
// сценария ловит `guard`, и в журнале стоит `hubError` со строкой исходника;
// остальные сценарии работают.
//
// Метка, чей id не номер (разметка до перенумерации, собранный руками объект),
// адреса не имеет вовсе: `deviceAid` отвечает `null`, и аксессуара у такой
// метки нет. Обе трубы открытия нумеруют объект прежде, чем дом его увидит.
//
// `sid` и `cid` идут подряд с 13 внутри аксессуара: сервис получает номер,
// следом номера получают его характеристики — как в ScenarioSimulator
// (`IdAllocator`, база 13). Они меняются только вместе с профилем.
import {
  deviceFollowers,
  findMark,
  findOpening,
  idNumberOf,
  labelOf,
  logicBindingsOf,
  markControlsByChannel,
  markDeviceOf,
  markIsComment,
  markOpeningHit,
  openingOpens,
  openingVents,
  openingsInWall,
  planFractionToMm,
  scenariosInOrder,
  segmentDistanceMm,
  wallVectors,
  wallsOnScheme,
} from "../model.js";
import { simServiceCharMeta, simServiceMeta } from "./catalog.js";

// Первый номер сервиса и характеристики внутри аксессуара (как в Sprut).
export const DEVICE_ID_START = 13;
// Как далеко датчик открытия ищет свою дверь, если его не привязали рукой.
export const DEVICE_DOOR_REACH_MM = 600;

/**
 * Адрес аксессуара метки — её номер: `"17"` → `17`. Не номер (uuid прежней
 * разметки, встроенный ключ, мусор) — `null`: адреса у такой метки нет, и
 * аксессуара тоже.
 *
 * Числом, а не строкой: `aid` в хабе — число, и так его ждут и разбор адреса
 * сценария (`hubApi.charByAddress`), и окно «Аксессуар».
 */
export function deviceAid(markId) {
  return idNumberOf(markId);
}

/**
 * Адреса всех меток объекта: `Map<markId, aid>`. Карта целиком нужна тем, кто
 * ищет метку **по адресу** (подсказка в сценарии, окно «Аксессуар», перевод
 * профилей); свой адрес берут у `deviceAid`, а не отсюда. Метка без номера в
 * карту не попадает — адреса у неё нет.
 */
export function deviceAids(project) {
  const marks = project && Array.isArray(project.marks) ? project.marks : [];
  const aids = new Map();
  for (const mark of marks) {
    const aid = deviceAid(mark && mark.id);
    if (aid !== null && !aids.has(mark.id)) aids.set(mark.id, aid);
  }
  return aids;
}

// Кэш чтения по ссылке на объект (ревью ветки, F1): объект неизменяем — каждая
// правка даёт новый, — поэтому всё, что прочитано из одного объекта, верно для
// него навсегда. Собранный аксессуар стоит обхода профиля и словаря сервисов, а
// мини-план зовёт `markAccessory` на каждую видимую метку. `WeakMap` отпускает
// старые объекты сам. Адреса в кэше больше не лежат: номер читается из id
// самой метки и обхода объекта не стоит.
const DEVICE_HOME_CACHE = new WeakMap();
const DEVICE_HOME_NONE = { accessories: new Map() };

function deviceHomeCache(project) {
  if (!project || typeof project !== "object") return DEVICE_HOME_NONE;
  let cached = DEVICE_HOME_CACHE.get(project);
  if (!cached) {
    cached = { accessories: new Map() };
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
  // Нет номера — нет адреса, а аксессуар без адреса сценарию не назвать:
  // `hubApi` такую запись всё равно пропускает (`Number.isFinite(aid)`), и
  // честнее не делать вид, что устройство в доме есть.
  if (!profile || !Number.isInteger(aid)) return null;
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
  // Ведомая метка (то же обозначение) — аксессуар ведущей (правка после сборки сценариев):
  // щелчок по любой из четырёх Т1 переключает их общий аксессуар.
  const leader = project ? deviceFollowers(project).get(markId) : null;
  if (leader) return markAccessory(project, leader);
  const cache = deviceHomeCache(project);
  if (cache.accessories.has(markId)) return cache.accessories.get(markId);
  const mark = project ? findMark(project, markId) : null;
  const accessory = !mark || markIsComment(mark) ? null : deviceFrozen(deviceAccessory(project, mark, deviceAid(mark.id)));
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
  const followers = deviceFollowers(project);
  const out = [];
  for (const mark of project.marks) {
    // Ведомая метка своего аксессуара не имеет: четыре Т1 для сценария — одна.
    if (markIsComment(mark) || followers.has(mark.id)) continue;
    const accessory = deviceAccessory(project, mark, deviceAid(mark.id));
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
 * рукой) → проём, в который метка попала (`markOpeningHit`; дверь или окно со
 * створкой) → ближайшая открывающаяся дверь схемы не дальше
 * `DEVICE_DOOR_REACH_MM`. `null` — двери нет или метка не датчик открытия.
 */
export function markDoorOf(project, markId) {
  const mark = project ? findMark(project, markId) : null;
  if (!mark || !deviceIsContact(project, markId)) return null;
  const device = mark.device && typeof mark.device === "object" ? mark.device : null;
  if (device && Object.prototype.hasOwnProperty.call(device, "doorId")) {
    if (device.doorId === null) return null;
    if (typeof device.doorId === "string" && findOpening(project, device.doorId)) return device.doorId;
  }
  // Метка в проёме окна со створкой — датчик этого окна (правка без
  // автопилота, 2026-10-25): окна теперь открывают, и геркон на раме ходит с
  // ним. Ближайшая дверь ниже ищется только среди дверей, как и было.
  const hit = markOpeningHit(project, mark);
  if (hit && (openingOpens(hit.kind) || openingVents(hit.kind))) return hit.id;
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
 *
 * `opts.scenarios` — **уже разрешённые** записи сценариев (таск 05 просмотра,
 * G25): исходники библиотечных скриптов подставляет страница
 * (`src/scenarioLib.js`), потому что поток лишён сети и кода из строки.
 * Здесь их берут как есть; нет их — дом собирается по записям объекта, ровно
 * как раньше. Искать исходники этот модуль не умеет и не должен: он идёт в
 * бандл потока.
 */
export function buildHomeSpec(project, opts = null) {
  const accessories = homeAccessories(project);
  const followers = deviceFollowers(project);
  const lead = (markId) => followers.get(markId) || markId;
  const links = [];
  const doors = [];
  for (const accessory of accessories) {
    if (accessory.services.some((service) => service.type === "StatelessProgrammableSwitch")) {
      // Связи ведущей — вместе со связями её ведомых, а подопечные — ведущие
      // своих обозначений: клавиша, которая управляет второй Т1,
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
  const given = opts && typeof opts === "object" && Array.isArray(opts.scenarios) ? opts.scenarios : null;
  return {
    accessories,
    links,
    doors,
    scenarios: homeLeadMarks(structuredClone(given || scenariosInOrder(project)), followers),
    logicBindings: homeLeadMarks(structuredClone(logicBindingsOf(project)), followers),
  };
}

/**
 * Сценарий так, как его увидит дом: ссылки на ведомые метки — ведущим.
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
