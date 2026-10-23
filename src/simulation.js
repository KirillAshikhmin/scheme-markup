// Имитация умного дома в странице (таск 07 сценариев; истории 2.3, 2.14–2.16,
// 3.2–3.4, 5.4, 6.4, 7.5).
//
// Одна имитация на сеанс. Хозяин состояния дома — движок в потоке
// (`sim/worker.js`), здесь его **зеркало**: значения всех характеристик для
// рисования (`simValue`, `simLive`), журнал (`simJournal`, 2000 строк),
// сценарии и формы опций — всё, что поток прислал. Экрана здесь нет: кнопки,
// полосу часов и журнал на экране дают таски 08–12, они зовут эти двери.
//
// ——— когда зеркало — правда ——————————————————————————————————————————————
//
// Пока дом запущен, правда — в потоке: зеркало принимает каждое изменение.
// Пока остановлен — правда в зеркале: значения пережили остановку, их помнит
// браузер, и «Запустить» отдаёт потоку их целиком (`start {values}`). Поэтому
// изменения, которые поток прислал остановленным (`live: false` — умолчания
// после `load`), зеркало не трогают, а «Сбросить дом» у остановленного дома
// сбрасывает само зеркало.
//
// ——— память в браузере ————————————————————————————————————————————————————
//
// Слово заказчика (раунд 3): память состояний — «В браузере». Ключ настроек
// `SIM_STATE_SETTING`, внутри — по постоянному ключу объекта `project.key`, а
// не по `project.id`: тот перевыдаётся при открытии файла, и свой же файл
// открывался бы «новым домом». Не больше `SIM_STATE_MAX` объектов, запись не
// чаще раза в `SIM_STATE_SAVE_MS`. В объект (`project`) не пишется ничего:
// живое состояние — не правка (история отмены, автосохранение, слияние).
//
// ——— таймеры ————————————————————————————————————————————————————————————————
//
// Задержки и таймеры сценариев живут только в потоке и перезагрузку страницы
// не переживают — как перезагрузка хаба (история 2.16): значения поднимаются,
// дом остановлен, в журнале — «Страница перезагружена — таймеры сброшены».
// Правка объекта на ходу перестраивает дом (`load`), и у хозяев сценариев
// идущие задержки теряются (таск 05) — журнал говорит и об этом. Логический и
// глобальный сценарий, которых правка не коснулась, хаб оставляет как были
// (F2, `simEditDrops`): про них журнал молчит.
//
// Коды записей журнала, которые пишет страница (текст — `strings.sim.journal`):
// `pageReloaded`, `editReset`, `noWorker`, `reset` (сброс остановленного дома),
// `scenarioHung` (`{name, label, where}`), `hungUnknown` (`{count}`).
import { appClockJump, appClockNow, appClockSimMs, appClockStep, appClockWatch } from "./appClock.js";
import { appWeatherRead, appWeatherWatch } from "./appWeather.js";
import { findMark, findType, markControlsByChannel, roomAtPoint, roomsInOrder, scenariosInOrder } from "./model.js";
import { getSetting, setSetting } from "./store.js";
import { text } from "./strings.js";
import { SIM_BRIDGE_REPLAY, createSimBridge } from "./sim/bridge.js";
import { blocksCommandTexts, commandKey } from "./sim/blocks.js";
import { simClamp } from "./sim/catalog.js";
import { buildHomeSpec, homeAccessories } from "./sim/home.js";
import { hubScriptKey } from "./sim/hubApi.js";
import { simLiveOf, simValueKey } from "./sim/live.js";
import { volumeClimateGeometry, volumeSiteOf } from "./volume.js";

/** Ключ настроек браузера: `{[project.key]: {values, at, running}}`. */
export const SIM_STATE_SETTING = "simState";
/** Сколько объектов помнит браузер; лишние — самые давние. */
export const SIM_STATE_MAX = 20;
/** Запись состояния в настройки — не чаще раза в столько мс. */
export const SIM_STATE_SAVE_MS = 500;
/** Сколько строк хранит журнал (история 6.4); старые уходят. */
export const SIM_JOURNAL_MAX = 2000;

const SIM_SCRIPT_KINDS = new Set(["logic", "global"]);
// Что имеет смысл только у запущенного дома — ждёт, пока запуск уйдёт в поток.
const SIM_HELD = new Set(["act", "run", "active", "reset"]);

function simList(value) {
  return Array.isArray(value) ? value : [];
}

/**
 * Теряет ли сценарий `scenarioId` идущие задержки и таймеры, когда дом на ходу
 * перестраивается с `before` на `after` (F2). Логический и глобальный — только
 * если правка коснулась его самого или его привязок (`hubScriptKey`): хаб
 * оставляет их как были; блочный теряет всегда (таск 05).
 */
export function simEditDrops(before, after, scenarioId) {
  const was = hubScriptKey(before, scenarioId);
  if (was === null) return true;
  return was !== hubScriptKey(after, scenarioId);
}

function simOwn(object, key) {
  return Boolean(object) && typeof object === "object" && Object.prototype.hasOwnProperty.call(object, key);
}

// Характеристика без состояния (нажатие, команда «только запись») в зеркало
// не ложится — то же правило, что у движка.
function simStateless(meta) {
  return Boolean(meta) && (meta.format === "event" || (Array.isArray(meta.perms) && !meta.perms.includes("read")));
}

/** Постоянный ключ объекта для памяти в браузере: `key`, у совсем старого — `id`. */
export function simProjectKey(project) {
  if (!project || typeof project !== "object") return null;
  if (typeof project.key === "string" && project.key) return project.key;
  return typeof project.id === "string" && project.id ? project.id : null;
}

/** Дом для потока: `buildHomeSpec` плюс координаты солнца и имена помещений. */
export function simHomeOf(project) {
  // Координаты — тем же чтением, что у солнца «Объёма»: одно небо на двоих.
  const { latDeg, lonDeg } = volumeSiteOf(project);
  const spec = buildHomeSpec(project);
  return {
    ...spec,
    site: latDeg === null || lonDeg === null ? null : { latDeg, lonDeg },
    rooms: roomsInOrder(project).map((room) => ({ id: room.id, name: String(room.name || "") })),
    climate: simClimateOf(project, spec.accessories),
  };
}

/**
 * Климат дома для потока (правка после сборки сценариев): помещения и проёмы
 * (`volumeClimateGeometry`) и устройства, от которых климат зависит или
 * которым его показывают, — `{markId, roomId, role, controls}`. `role` —
 * что делает вентилятор: приток (бризер), вытяжка, кухонная вытяжка; у реле —
 * осушитель. `controls` — кем управляет термостат («чем управляет»).
 */
export function simClimateOf(project, accessories) {
  const geometry = volumeClimateGeometry(project);
  const devices = [];
  for (const accessory of accessories || []) {
    const mark = findMark(project, accessory.markId);
    if (!mark) continue;
    const type = findType(project, mark.typeId);
    const code = type ? String(type.code || "").trim().toUpperCase() : "";
    const first = Array.isArray(mark.points) && mark.points.length > 0 ? mark.points[0] : null;
    const roomId = mark.roomId || (first && mark.schemeId ? roomAtPoint(project, mark.schemeId, first) : null) || null;
    let role = null;
    if (accessory.kind === "breezer" || code === "Б") role = "supply";
    else if (code === "ВЫТ") role = "hood";
    else if (accessory.kind === "fan") role = "exhaust";
    else if (code === "ОВ") role = "dry";
    const thermostat = accessory.services.some((service) => service.type === "Thermostat");
    const controls =
      thermostat && accessory.kind !== "warmFloor"
        ? markControlsByChannel(project, accessory.markId).flatMap((group) => group.marks.map((item) => item.id))
        : [];
    devices.push({ markId: accessory.markId, roomId, role, controls });
  }
  return { ...geometry, devices };
}

/**
 * Значения одного устройства по его аксессуару: что было — остаётся (сервис
 * того же типа на том же месте), чего не было — начальное значение, лишнее
 * (снятый сервис, чужая характеристика) — уходит. `before` — аксессуар до
 * правки или `null`, если сравнивать не с чем.
 */
export function simMirrorFit(values, accessory, before = null) {
  const out = {};
  for (const service of simList(accessory && accessory.services)) {
    const was = before ? simList(before.services).find((item) => item.index === service.index) : null;
    const same = !before || (was && was.type === service.type);
    for (const char of simList(service.chars)) {
      if (simStateless(char.meta)) continue;
      const key = simValueKey(service.index, char.type);
      const kept = same && simOwn(values, key) && values[key] !== undefined;
      out[key] = kept ? simClamp(char.meta, values[key]) : char.value === undefined ? null : char.value;
    }
  }
  return out;
}

/**
 * Список кнопки «Выполнить команду» (G17): все тексты условий «Команда»
 * блочных сценариев объекта — без повторов (одна команда — один ключ
 * `commandKey`, текст — как набран первым по порядку сценариев), по алфавиту.
 * `scenarioIds` — какие сценарии её слушают, `active: false` — все они
 * неактивны (пометка в списке). Объект без команд — пустой список.
 */
export function simCommands(project) {
  const byKey = new Map();
  for (const scenario of scenariosInOrder(project)) {
    if (!scenario || scenario.kind !== "block") continue;
    for (const raw of blocksCommandTexts(scenario)) {
      const key = commandKey(raw);
      if (!byKey.has(key)) byKey.set(key, { text: raw.trim().replace(/\s+/g, " "), scenarioIds: [], active: false });
      const item = byKey.get(key);
      if (!item.scenarioIds.includes(scenario.id)) item.scenarioIds.push(scenario.id);
      if (scenario.active !== false) item.active = true;
    }
  }
  return [...byKey.values()].sort((a, b) => a.text.localeCompare(b.text, "ru", { sensitivity: "base" }) || (a.text < b.text ? -1 : a.text > b.text ? 1 : 0));
}

/** Карта памяти с записью объекта `key`: не больше `SIM_STATE_MAX`, давние уходят. */
export function simStateWith(all, key, record) {
  const map = all && typeof all === "object" && !Array.isArray(all) ? all : {};
  const entries = Object.entries(map).filter(
    ([other, value]) => other !== key && value && typeof value === "object" && value.values && typeof value.values === "object",
  );
  entries.push([key, record]);
  entries.sort((a, b) => (Number(b[1].at) || 0) - (Number(a[1].at) || 0));
  const kept = entries.slice(0, SIM_STATE_MAX);
  if (!kept.some(([other]) => other === key)) kept[kept.length - 1] = [key, record];
  return Object.fromEntries(kept);
}

function simScenarioName(scenario, id) {
  if (scenario && typeof scenario.name === "string" && scenario.name) return scenario.name;
  if (scenario && scenario.template && typeof scenario.template.name === "string" && scenario.template.name) return scenario.template.name;
  return String(id || "");
}

function simScriptIds(home) {
  const scenarios = simList(home && home.scenarios).filter((scenario) => scenario && SIM_SCRIPT_KINDS.has(scenario.kind));
  return [
    ...scenarios.filter((scenario) => scenario.kind === "global"),
    ...scenarios.filter((scenario) => scenario.kind === "logic"),
  ].map((scenario) => scenario.id);
}

// Подсказка потока, которая называет виновника прямо.
function simCulpritOf(trace) {
  if (!trace || typeof trace !== "object") return null;
  const where = typeof trace.where === "string" ? trace.where : "start";
  if (Array.isArray(trace.bindingIds) && trace.bindingIds.length > 0) {
    return { where, scenarioId: trace.scenarioId ?? null, bindingIds: trace.bindingIds.filter((id) => typeof id === "string") };
  }
  if (typeof trace.bindingId === "string" && trace.bindingId) return { where, scenarioId: trace.scenarioId ?? null, bindingIds: [trace.bindingId] };
  if (typeof trace.scenarioId === "string" && trace.scenarioId) return { where, scenarioId: trace.scenarioId, bindingIds: [] };
  return null;
}

// Выключенный сторожем сценарий: блочный — неактивен, скрипт — ещё и без
// текста, иначе остановленный дом исполнил бы его верхний уровень ради форм.
function simHungScenario(scenario) {
  return scenario.kind === "block" ? { ...scenario, active: false } : { ...scenario, active: false, source: "" };
}

const SIM_HUNG_FAULT = Object.freeze({ code: "hung", line: null, message: "" });

function simulationTimers() {
  return {
    now: () => Date.now(),
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (id) => clearTimeout(id),
  };
}

/**
 * Имитация: `createSimulation({bridge?, settings?, clock?, timers?})` — двери
 * подставляют тесты; страница пользуется одной имитацией через `sim*` ниже.
 */
export function createSimulation(options = {}) {
  const given = options && typeof options === "object" ? options : {};
  const makeBridge = typeof given.bridge === "function" ? given.bridge : createSimBridge;
  const settings = given.settings || { get: getSetting, set: setSetting };
  const clock = given.clock || { now: appClockNow, simMs: appClockSimMs, watch: appClockWatch, step: appClockStep, jump: appClockJump };
  // Выбор погоды (правка после сборки сценариев): климат дома считает улицу по
  // нему же, что и «Объём».
  const weather = given.weather || { read: appWeatherRead, watch: appWeatherWatch };
  const timers = given.timers || simulationTimers();
  let bridge = null;
  let clockOff = null;
  let weatherOff = null;
  // Климат дома от потока: `{at, outdoor, rooms: {roomId: {t, rh, co2, people}}}`
  // (`sim/climate.js`); `savedClimate` — помещения из памяти браузера, они
  // уходят потоку до запуска.
  let climate = null;
  let savedClimate = null;
  let inPage = false;
  let closed = false;

  let project = null;
  let key = null;
  let home = null;
  let accessories = new Map();
  let sentText = null;
  let sentSpec = null;

  const mirror = new Map();
  const pressed = new Map();
  let revision = 0;
  let running = false;
  let startPosted = false;
  let loading = null;
  let scenarios = [];
  let nextAt = null;
  const forms = new Map();
  const hungScenarios = new Map();
  const hungBindings = new Map();
  const journal = [];
  const watchers = new Set();
  const held = [];

  const pendingSaves = new Map();
  let saveTimer = null;
  let lastSaveAt = -Infinity;
  let saveChain = Promise.resolve();

  let liveCache = null;
  let foreign = null;

  // ——— поток ————————————————————————————————————————————————————————————

  function ensureBridge() {
    if (bridge || closed) return bridge;
    bridge = makeBridge({ onMessage: receive, onHang: hangAnswer, onPage: pageMode, restore: restoreMessages });
    if (bridge && bridge.inPage) inPage = true;
    bridge.post({ type: "clock", clock: clock.now() });
    clockOff = clock.watch((read) => {
      if (bridge) bridge.post({ type: "clock", clock: (read && read.clock) || clock.now() });
    });
    bridge.post(climateWeather());
    weatherOff = weather.watch(() => {
      if (bridge) bridge.post(climateWeather());
    });
    return bridge;
  }

  function post(message) {
    // Запуск ждёт памяти браузера (`restoreSaved`): действия человека, сделанные
    // за этот миг, идут следом за ним, а не мимо остановленного дома.
    if (running && !startPosted && SIM_HELD.has(message.type)) {
      held.push(message);
      return;
    }
    const own = ensureBridge();
    if (own) own.post(message);
  }

  function pageMode() {
    inPage = true;
    const entries = [entry("system", "noWorker")];
    addLog(entries);
    notify({ log: entries });
  }

  function climateWeather() {
    return { type: "climate", data: { kind: "weather", choice: weather.read() } };
  }

  function climateRestore() {
    const rooms = climate ? climate.rooms : savedClimate;
    return rooms && typeof rooms === "object" ? { type: "climate", data: { kind: "restore", rooms } } : null;
  }

  function restoreMessages() {
    const out = [{ type: "clock", clock: clock.now() }, climateWeather()];
    if (home) {
      const spec = overlay(home);
      sentText = JSON.stringify(spec);
      sentSpec = spec;
      out.push({ type: "load", spec });
    }
    const rooms = climateRestore();
    if (rooms) out.push(rooms);
    if (running && startPosted) out.push({ type: "start", values: mirrorValues(), restore: true });
    return out;
  }

  function receive(message) {
    if (!message || typeof message !== "object") return;
    switch (message.type) {
      case "changes":
        applyChanges(message);
        break;
      case "log": {
        const entries = simList(message.entries);
        addLog(entries);
        notify({ log: entries });
        break;
      }
      case "scenarios":
        scenarios = simList(message.list);
        notify({});
        break;
      case "next":
        nextAt = Number.isFinite(message.at) ? message.at : null;
        notify({});
        break;
      case "forms":
        forms.set(formKey(message.scenarioId, message.bindingId), message);
        notify({ forms: [message] });
        break;
      case "climate":
        climate = {
          at: Number(message.at) || 0,
          outdoor: message.outdoor && typeof message.outdoor === "object" ? message.outdoor : null,
          rooms: message.rooms && typeof message.rooms === "object" ? message.rooms : {},
        };
        markDirty();
        notify({ climate: true });
        break;
      default:
        break;
    }
  }

  function applyChanges(message) {
    if (message.live !== true) return;
    const list = simList(message.list).filter((change) => change && accessories.has(change.markId));
    if (list.length === 0) return;
    for (const change of list) {
      if (change.event) {
        if (change.char === "ProgrammableSwitchEvent") pressed.set(change.markId, change.at);
        continue;
      }
      if (!mirror.has(change.markId)) mirror.set(change.markId, {});
      mirror.get(change.markId)[simValueKey(change.service, change.char)] = change.value;
    }
    revision += 1;
    markDirty();
    notify({ changes: list });
  }

  // ——— сторож ———————————————————————————————————————————————————————————

  async function hangAnswer({ trace, pending } = {}) {
    let culprit = simCulpritOf(trace);
    if (!culprit) {
      const candidates = trace && Array.isArray(trace.candidates) ? trace.candidates : simScriptIds(home);
      culprit = await probeCandidates(candidates, simList(pending), trace && trace.where);
    }
    if (culprit) {
      markHung(culprit);
      return { replay: true };
    }
    // Виновника не нашли: скрипты гасятся все — лучше так, чем зависать по кругу.
    const ids = simScriptIds(home).filter((id) => !hungScenarios.has(id));
    for (const id of ids) hungScenarios.set(id, { where: "unknown", stamp: stampOf(scenarioById(id)) });
    const entries = [entry("error", "hungUnknown", { count: ids.length })];
    addLog(entries);
    notify({ log: entries, fault: { scenarioId: null, bindingId: null, message: "hung", line: null } });
    return { replay: false };
  }

  // Виновник среди нескольких (верхний уровень скриптов): пробные потоки с
  // первыми 1, 2, … скриптами в порядке исполнения — первый зависший и есть он.
  async function probeCandidates(candidates, pending, where) {
    const list = simList(candidates).filter((id) => typeof id === "string" && !hungScenarios.has(id));
    if (!bridge || !home || list.length === 0) return null;
    const replay = pending.filter((message) => message && SIM_BRIDGE_REPLAY.includes(message.type));
    for (let i = 0; i < list.length; i += 1) {
      const off = new Set(list.slice(i + 1));
      const spec = overlay(home, off);
      const messages = [{ type: "clock", clock: clock.now() }, { type: "load", spec }];
      if (running && startPosted) messages.push({ type: "start", values: mirrorValues(), restore: true });
      messages.push(...replay);
      const result = await bridge.probe(messages);
      if (closed) return null;
      if (result && result.ok === false) {
        return simCulpritOf(result.trace) || { where: typeof where === "string" ? where : "start", scenarioId: list[i], bindingIds: [] };
      }
    }
    return null;
  }

  function markHung(culprit) {
    const where = culprit.where || "start";
    const entries = [];
    if (culprit.bindingIds.length > 0) {
      for (const bindingId of culprit.bindingIds) {
        const binding = simList(home && home.logicBindings).find((item) => item.id === bindingId) || null;
        hungBindings.set(bindingId, { where, stamp: stampOf(binding) });
        const scenarioId = binding ? binding.scenarioId : culprit.scenarioId;
        const accessory = binding ? accessories.get(binding.markId) : null;
        entries.push(
          entry(
            "error",
            "scenarioHung",
            { name: simScenarioName(scenarioById(scenarioId), scenarioId), label: accessory ? accessory.label || "" : "", where },
            { scenarioId, bindingId },
          ),
        );
      }
    } else {
      const scenario = scenarioById(culprit.scenarioId);
      hungScenarios.set(culprit.scenarioId, { where, stamp: stampOf(scenario) });
      entries.push(
        entry("error", "scenarioHung", { name: simScenarioName(scenario, culprit.scenarioId), label: "", where }, { scenarioId: culprit.scenarioId }),
      );
    }
    addLog(entries);
    const fault = { scenarioId: culprit.scenarioId ?? null, bindingId: culprit.bindingIds[0] ?? null, message: "hung", line: null };
    notify({ log: entries, fault });
  }

  function scenarioById(id) {
    return simList(home && home.scenarios).find((scenario) => scenario && scenario.id === id) || null;
  }

  function stampOf(value) {
    return value ? JSON.stringify(value) : "";
  }

  // Правленный человеком сценарий или привязка получают ещё одну попытку.
  function forgetEdited() {
    for (const [id, record] of [...hungScenarios]) {
      if (stampOf(scenarioById(id)) !== record.stamp) hungScenarios.delete(id);
    }
    for (const [id, record] of [...hungBindings]) {
      const binding = simList(home && home.logicBindings).find((item) => item.id === id) || null;
      if (stampOf(binding) !== record.stamp) hungBindings.delete(id);
    }
  }

  // Дом для потока: выключенные сторожем сценарии и привязки — выключены;
  // `off` — сценарии, временно погашенные пробой.
  function overlay(base, off = null) {
    if (hungScenarios.size === 0 && hungBindings.size === 0 && !off) return base;
    return {
      ...base,
      scenarios: simList(base.scenarios).map((scenario) =>
        scenario && (hungScenarios.has(scenario.id) || (off && off.has(scenario.id))) ? simHungScenario(scenario) : scenario,
      ),
      logicBindings: simList(base.logicBindings).map((binding) =>
        binding && hungBindings.has(binding.id) ? { ...binding, active: false } : binding,
      ),
    };
  }

  function resend() {
    if (!home) return;
    const spec = overlay(home);
    const textNow = JSON.stringify(spec);
    if (textNow === sentText) return;
    sentText = textNow;
    sentSpec = spec;
    post({ type: "load", spec });
  }

  // ——— журнал и подписчики ————————————————————————————————————————————————

  function entry(kind, code, vars, extra = {}) {
    const out = { at: clock.simMs(timers.now()), kind, chain: [], code, text: text("sim.journal." + code, vars), ...extra };
    if (vars) out.vars = vars;
    return out;
  }

  function addLog(entries) {
    if (entries.length === 0) return;
    journal.push(...entries);
    if (journal.length > SIM_JOURNAL_MAX) journal.splice(0, journal.length - SIM_JOURNAL_MAX);
  }

  function scenariosView() {
    return scenarios.map((scenario) =>
      hungScenarios.has(scenario.id) ? { ...scenario, active: false, running: false, fault: { ...SIM_HUNG_FAULT } } : scenario,
    );
  }

  function notify(delta) {
    if (watchers.size === 0) return;
    const payload = {
      changes: delta.changes || [],
      log: delta.log || [],
      running,
      scenarios: scenariosView(),
      next: nextAt,
      inPage,
      forms: delta.forms || [],
      fault: delta.fault || null,
      climate: delta.climate === true,
    };
    for (const watcher of [...watchers]) watcher(payload);
  }

  // ——— зеркало —————————————————————————————————————————————————————————

  function mirrorValues() {
    const out = {};
    for (const [markId, values] of mirror) out[markId] = { ...values };
    return out;
  }

  function fitMirror(before) {
    for (const markId of [...mirror.keys()]) {
      if (!accessories.has(markId)) {
        mirror.delete(markId);
        pressed.delete(markId);
      }
    }
    for (const [markId, accessory] of accessories) {
      mirror.set(markId, simMirrorFit(mirror.get(markId), accessory, before ? before.get(markId) || null : null));
    }
  }

  function allChanges() {
    const list = [];
    for (const [markId, values] of mirror) {
      for (const [valueKey, value] of Object.entries(values)) {
        const dot = valueKey.indexOf(".");
        list.push({ markId, service: Number(valueKey.slice(0, dot)), char: valueKey.slice(dot + 1), value });
      }
    }
    return list;
  }

  // ——— память в браузере ——————————————————————————————————————————————————

  function recordNow() {
    const record = { values: mirrorValues(), at: timers.now(), running };
    const rooms = climate ? climate.rooms : savedClimate;
    if (rooms) record.climate = rooms;
    return record;
  }

  function markDirty() {
    if (!key) return;
    pendingSaves.set(key, null);
    scheduleSave();
  }

  function scheduleSave() {
    if (saveTimer !== null || closed) return;
    const wait = Math.max(0, SIM_STATE_SAVE_MS - (timers.now() - lastSaveAt));
    saveTimer = timers.setTimeout(() => {
      saveTimer = null;
      writeSaves();
    }, wait);
  }

  function writeSaves() {
    if (pendingSaves.size === 0) return;
    const records = [...pendingSaves].map(([own, record]) => [own, record || (own === key ? recordNow() : null)]).filter(([, record]) => record);
    pendingSaves.clear();
    lastSaveAt = timers.now();
    saveChain = saveChain
      .then(() => settings.get(SIM_STATE_SETTING))
      .then((all) => {
        let next = all;
        for (const [own, record] of records) next = simStateWith(next, own, record);
        return settings.set(SIM_STATE_SETTING, next);
      })
      .catch(() => {});
  }

  function restoreSaved(own) {
    loading = own;
    Promise.resolve()
      .then(() => settings.get(SIM_STATE_SETTING))
      .catch(() => null)
      .then((all) => {
        if (key !== own || loading !== own) return;
        loading = null;
        const record = all && typeof all === "object" ? all[own] : null;
        if (record && typeof record === "object" && record.climate && typeof record.climate === "object" && !climate) {
          savedClimate = record.climate;
        }
        if (record && typeof record === "object" && record.values && typeof record.values === "object" && !startPosted) {
          for (const [markId, values] of Object.entries(record.values)) {
            const accessory = accessories.get(markId);
            if (accessory && values && typeof values === "object") mirror.set(markId, simMirrorFit(values, accessory, null));
          }
          revision += 1;
          const entries = record.running === true ? [entry("system", "pageReloaded")] : [];
          addLog(entries);
          notify({ changes: allChanges(), log: entries });
        }
        if (running && !startPosted) postStart();
      });
  }

  // ——— двери ———————————————————————————————————————————————————————————

  function sync(next) {
    if (closed || !next || typeof next !== "object" || next === project) return false;
    const nextKey = simProjectKey(next);
    const switching = nextKey !== key;
    if (switching && key !== null) {
      if (running) stopNow();
      pendingSaves.set(key, recordNow());
      scheduleSave();
    }
    const before = switching ? new Map() : accessories;
    project = next;
    home = simHomeOf(next);
    accessories = new Map(home.accessories.map((accessory) => [accessory.markId, accessory]));
    if (switching) {
      key = nextKey;
      mirror.clear();
      pressed.clear();
      scenarios = [];
      forms.clear();
      nextAt = null;
      climate = null;
      savedClimate = null;
    }
    forgetEdited();
    fitMirror(before);
    revision += 1;
    const spec = overlay(home);
    const textNow = JSON.stringify(spec);
    const entries = [];
    if (textNow !== sentText) {
      // Сказать «таймеры сброшены правкой» можно только про сценарий, который
      // их правда теряет: логику, которой правка не коснулась, дом не трогает.
      const lost =
        !switching &&
        running &&
        startPosted &&
        scenarios.some((scenario) => scenario && scenario.running && simEditDrops(sentSpec, spec, scenario.id));
      sentText = textNow;
      sentSpec = spec;
      post({ type: "load", spec });
      if (lost) entries.push(entry("system", "editReset"));
    }
    addLog(entries);
    if (switching) restoreSaved(key);
    notify({ log: entries });
    return true;
  }

  function postStart() {
    startPosted = true;
    const rooms = climateRestore();
    if (rooms) post(rooms);
    post({ type: "start", values: mirrorValues() });
    for (const message of held.splice(0)) post(message);
  }

  function start() {
    if (closed || !project || running) return false;
    running = true;
    if (loading === null) postStart();
    markDirty();
    notify({});
    return true;
  }

  function stopNow() {
    running = false;
    held.length = 0;
    if (startPosted) post({ type: "stop" });
    startPosted = false;
  }

  function stop() {
    if (!running) return false;
    stopNow();
    markDirty();
    notify({});
    return true;
  }

  function reset() {
    if (closed || !project) return false;
    if (running && startPosted) {
      post({ type: "reset" });
      return true;
    }
    for (const [markId, accessory] of accessories) mirror.set(markId, simMirrorFit(null, accessory, null));
    pressed.clear();
    revision += 1;
    const entries = [entry("system", "reset")];
    addLog(entries);
    markDirty();
    notify({ changes: allChanges(), log: entries });
    return true;
  }

  function act(action) {
    if (closed || !project || !action || typeof action !== "object") return false;
    post({ type: "act", action });
    return running;
  }

  function value(markId, service, char) {
    const own = mirror.get(markId);
    const valueKey = simValueKey(service, char);
    if (simOwn(own, valueKey)) return own[valueKey];
    const accessory = accessories.get(markId);
    const found = accessory ? simList(accessory.services).find((item) => item.index === service) : null;
    const slot = found ? simList(found.chars).find((item) => item.type === char) : null;
    return slot ? slot.value : undefined;
  }

  function live(of = project) {
    let source = accessories;
    if (of && of !== project) {
      if (!foreign || foreign.project !== of) {
        foreign = { project: of, map: new Map(homeAccessories(of).map((accessory) => [accessory.markId, accessory])) };
      }
      source = foreign.map;
    }
    if (liveCache && liveCache.source === source && liveCache.revision === revision) return liveCache.map;
    const map = new Map();
    for (const [markId, accessory] of source) {
      const values = mirror.get(markId) || {};
      map.set(markId, simLiveOf(accessory, pressed.has(markId) ? { ...values, pressedAt: pressed.get(markId) } : values));
    }
    liveCache = { source, revision, map };
    return map;
  }

  function nextEvent() {
    if (closed || nextAt === null) return false;
    const at = nextAt;
    clock.jump(at, timers.now());
    post({ type: "advance", toMs: at });
    return true;
  }

  function step(ms) {
    const by = Number(ms);
    if (closed || !Number.isFinite(by)) return false;
    const nowMs = timers.now();
    const target = clock.simMs(nowMs) + by;
    clock.step(by, nowMs);
    post({ type: "advance", toMs: target });
    return true;
  }

  function scenarioActive(id, on) {
    if (closed || !project) return false;
    if (on === true) {
      // Повторная активация возвращает сценарий — и его привязки, выключенные сторожем.
      let cleared = hungScenarios.delete(id);
      for (const [bindingId] of [...hungBindings]) {
        const binding = simList(home && home.logicBindings).find((item) => item.id === bindingId);
        if (binding && binding.scenarioId === id) cleared = hungBindings.delete(bindingId) || cleared;
      }
      if (cleared) resend();
    }
    post({ type: "active", scenarioId: id, on: on === true });
    notify({});
    return true;
  }

  function formKey(scenarioId, bindingId) {
    return bindingId === null || bindingId === undefined ? "s|" + scenarioId : "b|" + bindingId;
  }

  function optionForms(bindingId, scenarioId = null) {
    const message = forms.get(formKey(scenarioId, bindingId));
    if (!message) return null;
    const hung = (bindingId !== null && bindingId !== undefined && hungBindings.has(bindingId)) || hungScenarios.has(message.scenarioId);
    return {
      scenarioId: message.scenarioId,
      bindingId: message.bindingId ?? null,
      form: message.form ?? null,
      fault: hung ? { ...SIM_HUNG_FAULT } : message.fault ?? null,
    };
  }

  function close() {
    closed = true;
    if (clockOff) clockOff();
    clockOff = null;
    if (saveTimer !== null) timers.clearTimeout(saveTimer);
    saveTimer = null;
    if (weatherOff) weatherOff();
    weatherOff = null;
    if (bridge) bridge.close();
    watchers.clear();
  }

  return {
    sync,
    start,
    stop,
    reset,
    running: () => running,
    act,
    press: (markId, service, press) => act({ kind: "press", markId, service, press }),
    command: (said) => act({ kind: "command", text: typeof said === "string" ? said : String(said ?? ""), cause: "web" }),
    presence: (roomIds) => act({ kind: "presence", roomIds: simList(roomIds) }),
    door: (openingId, open) => act({ kind: "door", openingId, open: open === true }),
    value,
    live,
    climate: () => climate,
    climateSet: (roomId, patch) => {
      if (closed || !project || typeof roomId !== "string" || !patch || typeof patch !== "object") return false;
      post({ type: "climate", data: { kind: "set", roomId, patch } });
      return true;
    },
    watch: (fn) => {
      if (typeof fn !== "function") return () => {};
      watchers.add(fn);
      return () => watchers.delete(fn);
    },
    journal: () => journal.slice(),
    journalClear: () => {
      journal.length = 0;
      notify({});
    },
    nextAt: () => nextAt,
    nextEvent,
    step,
    scenarioRun: (id) => {
      if (closed || !project) return false;
      post({ type: "run", scenarioId: id });
      return running;
    },
    scenarioActive,
    scenarios: scenariosView,
    optionForms,
    hung: () => ({ scenarios: [...hungScenarios.keys()], bindings: [...hungBindings.keys()] }),
    inPage: () => inPage,
    saved: () => saveChain,
    close,
  };
}

// ——— одна имитация на сеанс —————————————————————————————————————————————————

let simSession = null;

function simSessionOf() {
  if (!simSession) simSession = createSimulation();
  return simSession;
}

/** Запустить дом (история 2.3): поток получает зеркало целиком. */
export function simStart() {
  return simSessionOf().start();
}

/** Остановить дом: таймеры и подписки сняты, значения остались. */
export function simStop() {
  return simSessionOf().stop();
}

/** «Сбросить дом» (история 2.15). */
export function simReset() {
  return simSessionOf().reset();
}

export function simRunning() {
  return simSessionOf().running();
}

/** Действие человека (`interfaces.md`, «Действия»). `true` — дом запущен и исполнит его. */
export function simAct(action) {
  return simSessionOf().act(action);
}

/** Нажатие клавиши: `"single" | "double" | "long"`. */
export function simPress(markId, service, press) {
  return simSessionOf().press(markId, service, press);
}

/**
 * «Выполнить команду» (G17): текст уходит в имитацию событием команды —
 * сценарии с условием «Команда» на тот же текст запускаются; журнал
 * `command {text}`, не понял никто — `commandUnknown {text}`. `true` — дом
 * запущен и исполнит её.
 */
export function simCommand(text) {
  return simSessionOf().command(text);
}

/** Значение характеристики из зеркала (нет в зеркале — начальное). */
export function simValue(markId, service, char) {
  return simSessionOf().value(markId, service, char);
}

/** Что рисовать: `Map<markId, Live>` (`simLiveOf`) — одно правило для всех поверхностей. */
export function simLive(project) {
  return simSessionOf().live(project);
}

/**
 * Климат дома (правка после сборки сценариев): `{at, outdoor: {tempC, humidity,
 * sky, season}, rooms: {roomId: {t, rh, co2, people}}}` — или `null`, пока
 * поток не прислал ни одного шага.
 */
export function simClimate() {
  return simSessionOf().climate();
}

/** Задать помещению температуру, влажность, CO₂ или число людей: `{t, rh, co2, people}`. */
export function simClimateSet(roomId, patch) {
  return simSessionOf().climateSet(roomId, patch);
}

/** Подписка: `fn({changes, log, running, scenarios, next, inPage, forms, fault, climate})`. */
export function simWatch(fn) {
  return simSessionOf().watch(fn);
}

/** Журнал сеанса — не больше `SIM_JOURNAL_MAX` строк (история 6.4). */
export function simJournal() {
  return simSessionOf().journal();
}

export function simJournalClear() {
  return simSessionOf().journalClear();
}

/**
 * Объект открыт или поправлен: дом перестраивается без потери состояний живых
 * устройств; другой объект — своё состояние из памяти браузера. Звать на
 * каждую смену `project`.
 */
export function simSync(project) {
  return simSessionOf().sync(project);
}

/** Ближайшее событие имитации (мс часов) или `null` — «Ничего не запланировано». */
export function simNextAt() {
  return simSessionOf().nextAt();
}

/** «К следующему событию» (история 3.3): `false` — ничего не ждёт. */
export function simNextEvent() {
  return simSessionOf().nextEvent();
}

/** Шаг часов (история 3.2): события внутри шага срабатывают по порядку. */
export function simStep(ms) {
  return simSessionOf().step(ms);
}

/** Где человек сейчас — весь список помещений (ходьба в «Объёме»). */
export function simPresence(roomIds) {
  return simSessionOf().presence(roomIds);
}

/** Дверь открыли или закрыли — датчик открытия ходит вместе с ней. */
export function simDoor(openingId, open) {
  return simSessionOf().door(openingId, open);
}

/** «Запустить» у сценария (как «Тестовый запуск» Sprut). */
export function simScenarioRun(id) {
  return simSessionOf().scenarioRun(id);
}

/** «Активный» на ходу; включение снимает пометку «остановлен: завис». */
export function simScenarioActive(id, on) {
  return simSessionOf().scenarioActive(id, on);
}

/** Сценарии от потока: `[{id, active, running, fault}]`, зависшие — с `fault.code: "hung"`. */
export function simScenarios() {
  return simSessionOf().scenarios();
}

/** Форма опций привязки (или новой привязки сценария): `{scenarioId, bindingId, form, fault}` | `null`. */
export function simOptionForms(bindingId, scenarioId = null) {
  return simSessionOf().optionForms(bindingId, scenarioId);
}

/** Движок в странице, без защиты от зависания (история 5.4). */
export function simInPage() {
  return simSessionOf().inPage();
}
