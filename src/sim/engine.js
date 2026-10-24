// Движок имитации умного дома (таск 04 сценариев; истории 1.17, 2.3,
// 2.5–2.10, 2.15, 2.17, 2.18, 6.1).
//
// Чистый модуль: без DOM, без `window`, без настоящего времени — «сейчас»
// приходит часами (`setClock`, `advanceTo`), события виртуального времени
// исполняет одна очередь (`sim/timers.js`). Он будет жить в Worker, поэтому
// всё, что он отдаёт наружу (`emit`), — структурно клонируемые данные.
//
// Что он держит: дом (`buildHomeSpec` объекта, `sim/home.js`), значения всех
// характеристик, поведения устройств «как настоящие» (сброс датчика движения,
// ход шторы, замок, термостат, кондиционер, кран, низкий заряд, превышение
// CO2), прямые связи клавиш «чем управляет», события и подписки, цепочки
// причин и предохранитель петли. Сценариев он не знает: их исполняют
// **хозяева сценариев** (блочный — таск 05, скриптовый — таск 06), которые
// подключаются через дверь, описанную у `createSimEngine`.
//
// **Порядок событий.** Запись меняет значение сразу (следующее чтение видит
// новое), а событие встаёт в очередь и разносится после того, как текущий
// обработчик вернулся, — как на хабе, где `trigger` асинхронен. Поэтому
// глубина стека не растёт с цепочкой, а петлю ловит длина цепочки причин.
//
// **Цепочка причин** (`chain`, запись журнала 6.1) — массив `Cause` от
// ближайшей причины к исходной: `[{k: "char", …}, {k: "web", at}]` читается
// «С1 вкл ← клавиша В1 одиночное ← щелчок». Виды звеньев: `web` (человек на
// странице), `walk` (ходьба в «Объёме»), `door` (дверь в «Объёме»), `char`
// (изменение характеристики: `markId, aid, service, sid, serviceType, char,
// cid, address, value`), `timer` (`at, what`), `hub` (`what: "start" | "load"
// | "reset"` — `HUB[OnStart]`), `command` (`at, text` — команда «Ёлочка гори»,
// G16), `scenario` и `logic` — звенья хозяев.
//
// **Клавиша выключателя** (G11) — кнопка канала (`StatelessProgrammableSwitch`)
// и «Выключатель» того же канала (`Switch`, `On` — реле клавиши). Нагрузки из
// связи «чем управляет» следуют за «Выключателем»: включился — включить все,
// выключился — выключить все; кто бы его ни поставил — щелчок, сценарий или
// логика. Привязанная клавиша щелчком переключает свой «Выключатель», а её
// кнопка событий не шлёт; у отвязанной щелчок, двойное и долгое — события
// кнопки, «Выключатель» остаётся сценариям. Клавиша без своего
// «Выключателя» (профиль, сохранённый до G11, — одни кнопки) работает как
// прежде: одиночное нажатие привязанной клавиши переключает нагрузки канала
// («что-то включено — выключить всё, иначе включить всё») и уходит событием.
import { simClamp } from "./catalog.js";
import { simValueKey } from "./live.js";
import { pressEventValue } from "./presses.js";
import { SIM_TIMERS_RUN_MAX, simTimers } from "./timers.js";
import { strings, text } from "../strings.js";

/** Предохранитель петли: запись с цепочкой причин длиннее — обрывается. */
export const SIM_CHAIN_MAX = 50;
/** Предохранитель шага: больше стольких событий за один вызов не разносится. */
export const SIM_EVENTS_MAX = 100000;
/** Время сброса датчика движения по умолчанию, с имитации (история 1.17). */
export const SIM_RESET_SEC = 60;
/** Время хода шторы от края до края по умолчанию, с имитации (история 1.17). */
export const SIM_TRAVEL_SEC = 20;
/** Уровень заряда, ниже которого батарея «низкая», %. */
export const SIM_BATTERY_LOW = 20;
/** Шаг хода шторы: положение сообщается каждые столько процентов пути. */
export const SIM_CURTAIN_STEP = 10;
/** Уровень CO2, с которого датчик говорит «превышение», ppm. */
export const SIM_CO2_ABNORMAL = 1000;
/** Действия человека (`act`). */
export const SIM_ACTIONS = Object.freeze(["set", "toggle", "press", "sensor", "presence", "door", "command"]);

// Откуда действие пришло, если `cause` не сказан.
const SIM_ENGINE_ACTION_CAUSE = Object.freeze({
  set: "web",
  toggle: "web",
  press: "web",
  sensor: "web",
  presence: "walk",
  door: "door",
  command: "web",
});
const SIM_ENGINE_CAUSES = new Set(["web", "walk", "door"]);
// Нагрузки: что включает клавиша и щелчок по устройству.
const SIM_ENGINE_ON = new Set(["Lightbulb", "Switch", "Outlet"]);
const SIM_ENGINE_ACTIVE = new Set(["Fan", "Television", "Valve", "HeaterCooler"]);
const SIM_ENGINE_KEYS = new Set(["StatelessProgrammableSwitch", "Doorbell"]);
const SIM_ENGINE_SENSORS = new Set(["MotionSensor", "OccupancySensor", "ContactSensor", "LeakSensor", "SmokeSensor"]);
const SIM_ENGINE_OTHERS = new Set(["Thermostat", "LockMechanism", "Speaker"]);
const SIM_ENGINE_THERMOSTAT = new Set(["CurrentTemperature", "TargetTemperature", "TargetHeatingCoolingState"]);
const SIM_ENGINE_HEATER = new Set([
  "Active",
  "CurrentTemperature",
  "TargetHeaterCoolerState",
  "CoolingThresholdTemperature",
  "HeatingThresholdTemperature",
]);
// Сенсор → характеристика и два её положения: «сработал» и «тихо».
const SIM_ENGINE_ALERTS = Object.freeze({
  OccupancySensor: ["OccupancyDetected", "OCCUPANCY_DETECTED", "OCCUPANCY_NOT_DETECTED"],
  ContactSensor: ["ContactSensorState", "CONTACT_NOT_DETECTED", "CONTACT_DETECTED"],
  LeakSensor: ["LeakDetected", "LEAK_DETECTED", "LEAK_NOT_DETECTED"],
  SmokeSensor: ["SmokeDetected", "SMOKE_DETECTED", "SMOKE_NOT_DETECTED"],
});

// Характеристика без состояния: событие кнопки и команды «только запись»
// (кнопка пульта) — шлют событие и на повтор того же значения.
function simEngineEventLike(meta) {
  return Boolean(meta) && (meta.format === "event" || (Array.isArray(meta.perms) && !meta.perms.includes("read")));
}

function simEngineSeconds(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function simEngineList(value) {
  return Array.isArray(value) ? value : [];
}

/**
 * Движок имитации: `createSimEngine({emit, owners?})`.
 *
 * `emit(message)` — всё, что уходит наружу, по протоколу страница ↔ Worker,
 * одной пачкой в конце каждого вызова:
 *   `{type: "changes", list: [{markId, service, char, value, at, event?}]}` —
 *     последнее значение каждой изменившейся характеристики (`event: true` —
 *     событие без состояния, например нажатие);
 *   `{type: "log", entries: [Entry]}` — записи журнала (`interfaces.md`,
 *     «Запись журнала»; плюс `code` и `vars` — ключ строки
 *     `strings.sim.journal.<code>`, по которому собран `text`);
 *   `{type: "scenarios", list: [{id, active, running, fault}]}` — состояние
 *     сценариев от хозяев (после load/start/stop/reset/runScenario/
 *     setScenarioActive и `host.scenariosChanged()`);
 *   сообщения хозяев (`host.post`) — как есть.
 *
 * Методы: `load(spec)`, `start(values?, {restored?, memory?})`, `stop()`, `reset()`, `values()`,
 * `value(markId, service, char)`, `act(action)`, `advanceTo(simMs)`,
 * `setClock({simMs})`, `nextAt()`, `now()`, `running()`,
 * `runScenario(id)`, `setScenarioActive(id, on)`, `scenarios()`.
 *
 * `act(action)`: `{kind: "set", markId, service, char, value}` ·
 * `{kind: "toggle", markId, service?}` (щелчок: свет/реле/розетка/ТВ/
 * вентилятор/кран/кондиционер/«Выключатель» — вкл↔выкл, штора —
 * открыть/закрыть, замок, термостат, колонка, клавиша — как `press single`,
 * датчик — как `sensor`; без `service` — первая кнопка, иначе главный сервис) ·
 * `{kind: "press", markId, service?, press: "single"|"double"|"long"}` (по
 * кнопке клавиши: привязанная с «Выключателем» — одиночное переключает его,
 * двойное и долгое ничего не делают; отвязанная и кнопка без «Выключателя» —
 * событие нажатия) ·
 * `{kind: "sensor", markId, service?, value?}` (`value` нет — движение
 * «сработал», остальные переключаются; `true/false` — сработал/тихо) ·
 * `{kind: "presence", roomIds}` (где человек сейчас — весь список) ·
 * `{kind: "door", openingId, open}` · `{kind: "command", text}` (команда
 * «Ёлочка гори», G16: журнал `command {text}`, хозяева получают хук
 * `command`; не понял никто — `commandUnknown {text}`); у каждого необязательный `cause`
 * (`web | walk | door`). Возвращает `true`, если что-то изменилось. Пока дом
 * не запущен, действия не исполняются.
 *
 * `start(values?)` поднимает состояние `values()` без журнала и событий;
 * `load(spec)` на ходу сохраняет значения живых устройств (та же метка, тот
 * же тип сервиса на том же месте). `advanceTo(simMs)` — часы идут: события
 * между «сейчас» и `simMs` исполняются по порядку, каждое в своё время.
 * `setClock({simMs})` — часы перевёл человек: вперёд — как `advanceTo`, назад
 * — ничего не запускается; затем хозяева получают `clock`.
 *
 * **Дверь для хозяев сценариев.** `owners` — список хозяев в порядке старта
 * (сначала скриптовый, потом блочный: история 2.3). Хозяин — объект с
 * уникальным `name`; все хуки необязательны, **дверь `host` — всегда
 * последний аргумент**:
 *   `kinds: ["block"] | ["logic", "global"]` — чьи сценарии (`scenario.kind`)
 *     ему передают `runScenario`/`setScenarioActive`/`resetScenario`;
 *   `load(home, host)` — новый дом: `home` — `spec` из `load` как есть
 *     (`accessories, links, doors, scenarios, logicBindings` и лишние поля
 *     вроде `site`, `rooms`); прежние подписки и таймеры хозяина уже сняты;
 *   `start({reload, restored, memory, chain}, host)` — дом запущен (`reload:
 *     false`, `chain` — `[{k:"hub", what:"start"}]`, то есть `HUB[OnStart]`)
 *     или перестроен на ходу (`reload: true`, `what: "load"`). Подписки и
 *     таймеры — здесь. `restored: true` — тот же запуск, поднятый сторожем в
 *     новом потоке: «на старте» не исполняется; `memory` — то, что хозяин
 *     отдал хуком `memory()` перед зависанием (`null` — нечего);
 *   `memory() -> данные | null` — память хозяина, которую стоит пронести
 *     через перезапуск потока (структурно клонируемая; зовёт её поток, а не
 *     движок);
 *   `stop(host)` — дом останавливается; после хука движок снимает все
 *     подписки и таймеры хозяина;
 *   `reset({chain}, host)` — «Сбросить дом»: значения уже умолчания, все
 *     таймеры сняты (подписки остались) — забыть память, заново завести
 *     расписания;
 *   `compute(write, host) -> value | undefined` — до записи любой
 *     характеристики (`write = {markId, service, char, value, from, chain,
 *     address, serviceType}`); не `undefined` — записать это (зажимается);
 *   `run(scenarioId, {chain, manual}, host)` — запуск сценария: `manual:
 *     true` — кнопка «Запустить» (`chain` — `[{k:"web"}]`), `false` — другой
 *     сценарий через `host.runScenario`;
 *   `setActive(scenarioId, on, host)`, `resetScenario(scenarioId, host)`;
 *   `runCode(request, host) -> {ok: true, value} | {ok: false, error, line}` —
 *     исполнитель кода для других хозяев (условие-код и блок-код);
 *   `clock({from, to}, host)` — часы перевели (перечитать расписания);
 *   `command({text, chain}, host) -> число` — команда (G16): сколько
 *     сценариев хозяина её поняли (`chain` — `[{k:"command", at, text},
 *     {k:"web", at}]`); ни один хозяин не понял — запись `commandUnknown`;
 *   `scenarios() -> [{id, active, running, fault}]`.
 *
 * `host` (своя у каждого хозяина): `name`; `now() -> simMs`; `running()`;
 * `home()`; `site()` (`home.site` или `null`); `accessory(markId)`;
 * `value(markId, service, char)`; `values()`;
 * `write({markId, service, char, value, chain}) -> bool` — запись от имени
 * хозяина, `chain` — вся цепочка причин, обычно `[своё звено, ...event.chain]`
 * (например `{k:"scenario", scenarioId, blockId}`, `{k:"logic", scenarioId,
 * bindingId, address}`); `false` — то же значение, нет такой характеристики,
 * дом остановлен или цепочка длиннее `SIM_CHAIN_MAX`;
 * `subscribe({markId?, service?, char?, serviceTypes?, charTypes?}, handler)
 * -> unsubscribe` — `handler(event, host)` на каждое изменение и каждое
 * нажатие, `event = {at, markId, aid, service, sid, serviceType, char, cid,
 * address, value, from, chain}`, где `chain[0]` — звено `char` самого
 * изменения; обработчик зовётся после записи, когда предыдущий вернулся;
 * `timer(atMs, fn(at), tag?) -> id` — событие виртуального времени (свои
 * звенья цепочки `fn` строит сам), `cancelTimer(id)`, `cancelTimers(tag)`;
 * `log(entry)` — запись журнала (`at` — «сейчас», `chain` — `[]`, `text` —
 * из `code` по `strings.sim.journal`, если не дан); `post(message)` — своё
 * сообщение наружу (`forms`, `fault`); `runCode(request) -> {ok, value} |
 * {ok: false, error, line, code?}` — у другого хозяина с `runCode`, без него
 * `{ok: false, error: null, line: null, code: "noRunner"}`; ошибку пишет в
 * журнал тот, кто просил; `runScenario(id, chain)`, `setScenarioActive(id,
 * on)`, `resetScenario(id)` — хозяину вида сценария; `scenariosChanged()`.
 * Подписки и таймеры живут только в запущенном доме: вне его `subscribe`
 * отдаёт пустую отписку, `timer` — `null`. Ошибка в хуке или обработчике —
 * запись `ownerError` (`vars: {owner, message}`), дом идёт дальше.
 */
export function createSimEngine({ emit, owners = [] } = {}) {
  if (typeof emit !== "function") throw new TypeError("createSimEngine: emit must be a function");

  let home = null;
  const devices = new Map();
  let keyLinks = new Map();
  let doorSensors = new Map();
  let roomSensors = new Map();
  const present = new Set();
  const timers = simTimers();
  const deviceTimers = new Map();
  let isRunning = false;
  let now = 0;

  let subSeq = 0;
  const subsByMark = new Map();
  let subsAny = [];

  const queue = [];
  let queueHead = 0;
  let draining = false;

  const outChanges = new Map();
  const outLog = [];
  const outPosts = [];
  let outScenarios = false;
  let depth = 0;

  // ——— хозяева ————————————————————————————————————————————————————————————

  const entries = [];
  for (const owner of simEngineList(owners)) {
    if (!owner || typeof owner !== "object" || typeof owner.name !== "string" || !owner.name) {
      throw new TypeError("createSimEngine: owner needs a name");
    }
    if (entries.some((entry) => entry.owner.name === owner.name)) {
      throw new TypeError("createSimEngine: owner name taken: " + owner.name);
    }
    const entry = {
      owner,
      kinds: new Set(simEngineList(owner.kinds)),
      subs: new Set(),
      timers: new Map(),
      host: null,
    };
    entry.host = hostFor(entry);
    entries.push(entry);
  }
  const computers = entries.filter((entry) => typeof entry.owner.compute === "function");

  function call(entry, hook, ...args) {
    const fn = entry.owner[hook];
    if (typeof fn !== "function") return undefined;
    return guard(entry, () => fn.call(entry.owner, ...args, entry.host));
  }

  function guard(entry, fn) {
    try {
      return fn();
    } catch (error) {
      const message = error && typeof error.message === "string" ? error.message : String(error);
      journalSystem("error", "ownerError", { owner: entry.owner.name, message });
      return undefined;
    }
  }

  function dropOwner(entry) {
    for (const sub of [...entry.subs]) dropSub(sub);
    for (const id of entry.timers.keys()) timers.cancel(id);
    entry.timers.clear();
  }

  function ownerOfKind(kind) {
    return entries.find((entry) => entry.kinds.has(kind)) || null;
  }

  function scenarioOwner(id) {
    const scenario = home ? home.scenarios.find((item) => item && item.id === id) : null;
    return scenario ? ownerOfKind(scenario.kind) : null;
  }

  function scenarioList() {
    const list = [];
    for (const entry of entries) {
      const own = call(entry, "scenarios");
      if (Array.isArray(own)) list.push(...own);
    }
    return list;
  }

  // ——— вывод ——————————————————————————————————————————————————————————————

  function batch(fn) {
    depth += 1;
    try {
      const result = fn();
      drain();
      return result;
    } finally {
      depth -= 1;
      if (depth === 0) flush();
    }
  }

  function flush() {
    if (outChanges.size > 0) {
      const list = [...outChanges.values()];
      outChanges.clear();
      emit({ type: "changes", list });
    }
    if (outLog.length > 0) emit({ type: "log", entries: outLog.splice(0) });
    if (outPosts.length > 0) for (const message of outPosts.splice(0)) emit(message);
    if (outScenarios) {
      outScenarios = false;
      emit({ type: "scenarios", list: scenarioList() });
    }
  }

  function recordChange(markId, service, char, value, event) {
    const key = markId + "|" + simValueKey(service, char);
    outChanges.delete(key);
    outChanges.set(key, event ? { markId, service, char, value, at: now, event: true } : { markId, service, char, value, at: now });
  }

  function journalSystem(kind, code, vars) {
    const entry = { at: now, kind, chain: [], code, text: text("sim.journal." + code, vars) };
    if (vars) entry.vars = vars;
    outLog.push(entry);
  }

  function valueLabel(char, value) {
    const labels = strings.sim && strings.sim.values ? strings.sim.values[char] : null;
    if (labels && typeof value === "string" && typeof labels[value] === "string") return labels[value];
    return value === null || value === undefined ? "—" : String(value);
  }

  // ——— дом ————————————————————————————————————————————————————————————————

  function deviceFrom(accessory, old) {
    const services = simEngineList(accessory.services).map((service, position) => {
      const index = Number.isInteger(service.index) ? service.index : position;
      const chars = new Map();
      for (const char of simEngineList(service.chars)) {
        chars.set(char.type, {
          cid: char.cid,
          address: char.address,
          meta: char.meta || null,
          initial: char.value === undefined ? null : char.value,
          event: simEngineEventLike(char.meta),
        });
      }
      return {
        index,
        type: service.type,
        sid: service.sid,
        address: service.address,
        channel: Number.isInteger(service.channel) ? service.channel : null,
        decoupled: service.decoupled === true,
        aux: service.aux === true,
        // Термостат кондиционера — нагрузка (правка после сборки сценариев):
        // кондиционер стал термостатом, а выключатель и «выключить всё» им
        // управляли и управляют — режимом «Выкл» и прежним режимом.
        modeLoad: accessory.kind === "conditioner" && service.type === "Thermostat",
        chars,
      };
    });
    const device = {
      markId: accessory.markId,
      aid: accessory.aid,
      label: accessory.label || "",
      roomId: accessory.roomId || null,
      params: accessory.params && typeof accessory.params === "object" ? accessory.params : {},
      accessory,
      services,
      keys: services.filter((service) => service.type === "StatelessProgrammableSwitch").length,
      values: {},
    };
    pairKeys(services);
    for (const service of services) {
      const before = old ? old.services[service.index] : null;
      const same = before && before.type === service.type;
      for (const [char, slot] of service.chars) {
        if (slot.event) continue;
        const key = simValueKey(service.index, char);
        const kept = same && Object.prototype.hasOwnProperty.call(old.values, key);
        device.values[key] = kept ? old.values[key] : slot.initial;
        if (!kept || old.values[key] !== device.values[key]) recordChange(device.markId, service.index, char, device.values[key], false);
      }
    }
    return device;
  }

  // Клавиша и её «Выключатель» (G11): кнопка и реле одного канала. Канал без
  // номера — первый, как у связи «чем управляет». У кнопки без своего
  // «Выключателя» (профиль до G11) пары нет — она работает как прежде.
  function pairKeys(services) {
    const relays = new Map();
    for (const service of services) {
      service.relay = null;
      service.key = null;
      if (service.type === "Switch" && service.chars.has("On") && !relays.has(channelOf(service))) {
        relays.set(channelOf(service), service);
      }
    }
    for (const service of services) {
      if (service.type !== "StatelessProgrammableSwitch") continue;
      const relay = relays.get(channelOf(service));
      if (!relay || relay.key) continue;
      service.relay = relay;
      relay.key = service;
    }
  }

  function indexHome() {
    keyLinks = new Map();
    for (const link of home.links) {
      if (!link || !devices.has(link.markId)) continue;
      if (!keyLinks.has(link.markId)) keyLinks.set(link.markId, new Map());
      const channel = Number.isInteger(link.channel) ? link.channel : null;
      keyLinks.get(link.markId).set(channel, simEngineList(link.targets));
    }
    doorSensors = new Map();
    for (const door of home.doors) {
      if (!door || !devices.has(door.markId)) continue;
      if (!doorSensors.has(door.openingId)) doorSensors.set(door.openingId, []);
      doorSensors.get(door.openingId).push(door.markId);
    }
    roomSensors = new Map();
    for (const device of devices.values()) {
      if (!device.roomId) continue;
      for (const service of device.services) {
        if (service.type !== "MotionSensor" && service.type !== "OccupancySensor") continue;
        if (!roomSensors.has(device.roomId)) roomSensors.set(device.roomId, []);
        roomSensors.get(device.roomId).push({ markId: device.markId, service: service.index });
      }
    }
  }

  function serviceOf(markId, index) {
    const device = devices.get(markId);
    return device ? device.services[index] || null : null;
  }

  function read(device, service, char) {
    return device.values[simValueKey(service.index, char)];
  }

  // ——— запись значения ——————————————————————————————————————————————————————

  /**
   * Записать значение с цепочкой причин: зажать по метаданным, дать
   * хозяевам вычислить (`compute`), сохранить, записать в журнал и поставить
   * событие в очередь. `true` — значение изменилось или событие ушло.
   */
  function apply(markId, index, char, raw, chain, quiet = false) {
    const device = devices.get(markId);
    const service = device ? device.services[index] : null;
    const slot = service ? service.chars.get(char) : null;
    if (!slot) return false;
    const causes = Array.isArray(chain) ? chain : [];
    const key = simValueKey(index, char);
    const from = slot.event ? null : device.values[key];
    if (causes.length > SIM_CHAIN_MAX) {
      const entry = {
        at: now,
        kind: "error",
        markId,
        service: index,
        char,
        from,
        to: simClamp(slot.meta, raw),
        chain: causes,
        code: "loop",
        vars: { label: device.label, max: SIM_CHAIN_MAX },
      };
      entry.text = text("sim.journal.loop", entry.vars);
      outLog.push(entry);
      return false;
    }
    let value = simClamp(slot.meta, raw);
    for (const entry of computers) {
      const write = { markId, service: index, char, value, from, chain: causes, address: slot.address, serviceType: service.type };
      const out = guard(entry, () => entry.owner.compute(write, entry.host));
      if (out !== undefined) value = simClamp(slot.meta, out);
    }
    if (slot.event) {
      if (value === null || value === undefined) return false;
    } else {
      if (from === value) return false;
      device.values[key] = value;
    }
    recordChange(markId, index, char, value, slot.event);
    const press = char === "ProgrammableSwitchEvent";
    // Тихая запись (климат дома, правка после сборки сценариев): градусник,
    // меняющийся на десятую каждые несколько минут, засыпал бы журнал. Событие
    // при этом уходит как обычно — сценарии видят изменение.
    if (!quiet) outLog.push({
      at: now,
      kind: press ? "press" : "change",
      markId,
      service: index,
      char,
      from,
      to: value,
      chain: causes,
      code: press ? "press" : "change",
      text: text(press ? "sim.journal.press" : "sim.journal.change", {
        label: device.label,
        char: text("sim.chars." + char),
        from: valueLabel(char, from),
        to: valueLabel(char, value),
      }),
    });
    enqueue(device, service, char, slot, value, from, causes);
    return true;
  }

  // Событие характеристики подписчикам и поведениям; первое звено цепочки —
  // само изменение.
  function enqueue(device, service, char, slot, value, from, causes) {
    const cause = {
      k: "char",
      markId: device.markId,
      aid: device.aid,
      service: service.index,
      sid: service.sid,
      serviceType: service.type,
      char,
      cid: slot.cid,
      address: slot.address,
      value,
    };
    queue.push({
      at: now,
      markId: device.markId,
      aid: device.aid,
      service: service.index,
      sid: service.sid,
      serviceType: service.type,
      char,
      cid: slot.cid,
      address: slot.address,
      value,
      from,
      chain: [cause, ...causes],
    });
  }

  // Повторное движение (ревью ветки, F1): датчик уже сработал, а движение
  // снова — щелчок или E по нему, человек вошёл в его помещение. Значение то
  // же, но событие уходит подписчикам: условия-триггеры `MotionDetected`
  // запускают сценарий, и «Один таймер» продлевается; сброс датчика
  // отсчитывается заново (поведение `react`).
  function motionAgain(device, service, chain) {
    const slot = service.chars.get("MotionDetected");
    const causes = Array.isArray(chain) ? chain : [];
    if (!slot || causes.length > SIM_CHAIN_MAX) return false;
    const vars = { label: device.label };
    outLog.push({
      at: now,
      kind: "change",
      markId: device.markId,
      service: service.index,
      char: "MotionDetected",
      from: true,
      to: true,
      chain: causes,
      code: "motionAgain",
      vars,
      text: text("sim.journal.motionAgain", vars),
    });
    enqueue(device, service, "MotionDetected", slot, true, true, causes);
    return true;
  }

  // Разнести события очереди: сначала поведения устройств, потом подписчики.
  function drain() {
    if (draining) return;
    draining = true;
    let count = 0;
    try {
      while (queueHead < queue.length) {
        const event = queue[queueHead];
        queue[queueHead] = undefined;
        queueHead += 1;
        count += 1;
        if (count > SIM_EVENTS_MAX) {
          journalSystem("error", "eventsCut", { max: SIM_EVENTS_MAX });
          break;
        }
        react(event);
        deliver(event);
      }
    } finally {
      queue.length = 0;
      queueHead = 0;
      draining = false;
    }
  }

  // ——— подписки ————————————————————————————————————————————————————————————

  function subscribe(entry, filter, handler) {
    if (typeof handler !== "function") throw new TypeError("host.subscribe: handler must be a function");
    if (!isRunning) return () => {};
    const given = filter && typeof filter === "object" ? filter : {};
    const sub = {
      seq: (subSeq += 1),
      entry,
      handler,
      markId: typeof given.markId === "string" ? given.markId : null,
      service: Number.isInteger(given.service) ? given.service : null,
      char: typeof given.char === "string" ? given.char : null,
      serviceTypes: Array.isArray(given.serviceTypes) ? new Set(given.serviceTypes) : null,
      charTypes: Array.isArray(given.charTypes) ? new Set(given.charTypes) : null,
      gone: false,
    };
    if (sub.markId) {
      if (!subsByMark.has(sub.markId)) subsByMark.set(sub.markId, []);
      subsByMark.get(sub.markId).push(sub);
    } else {
      subsAny.push(sub);
    }
    entry.subs.add(sub);
    return () => dropSub(sub);
  }

  function dropSub(sub) {
    if (sub.gone) return;
    sub.gone = true;
    sub.entry.subs.delete(sub);
    if (sub.markId) {
      const list = subsByMark.get(sub.markId);
      if (list) {
        const left = list.filter((item) => item !== sub);
        if (left.length > 0) subsByMark.set(sub.markId, left);
        else subsByMark.delete(sub.markId);
      }
    } else {
      subsAny = subsAny.filter((item) => item !== sub);
    }
  }

  function matches(sub, event) {
    if (sub.service !== null && sub.service !== event.service) return false;
    if (sub.char !== null && sub.char !== event.char) return false;
    if (sub.serviceTypes && !sub.serviceTypes.has(event.serviceType)) return false;
    if (sub.charTypes && !sub.charTypes.has(event.char)) return false;
    return true;
  }

  function deliver(event) {
    const own = subsByMark.get(event.markId);
    const any = subsAny;
    if (!own && any.length === 0) return;
    // Снимок списков: подписанные по ходу этого события его не получают.
    const first = own ? own.slice() : [];
    const second = any.slice();
    let a = 0;
    let b = 0;
    while (a < first.length || b < second.length) {
      const sub = b >= second.length || (a < first.length && first[a].seq < second[b].seq) ? first[a++] : second[b++];
      if (sub.gone || !matches(sub, event)) continue;
      guard(sub.entry, () => sub.handler(event, sub.entry.host));
    }
  }

  // ——— таймеры ————————————————————————————————————————————————————————————

  function ownerTimer(entry, atMs, fn, tag, options = null) {
    if (typeof fn !== "function") throw new TypeError("host.timer: handler must be a function");
    if (!isRunning) return null;
    const id = timers.add(
      atMs,
      (at) => {
        entry.timers.delete(id);
        guard(entry, () => fn(at));
        drain();
      },
      undefined,
      options,
    );
    entry.timers.set(id, tag === undefined ? null : tag);
    return id;
  }

  function ownerCancelTimers(entry, tag) {
    for (const [id, own] of [...entry.timers]) {
      if (own !== tag) continue;
      timers.cancel(id);
      entry.timers.delete(id);
    }
  }

  function timerKey(markId, index, what) {
    return markId + "|" + index + "|" + what;
  }

  function deviceTimer(key, markId, index, type, at, fn) {
    cancelDeviceTimer(key);
    const id = timers.add(at, (when) => {
      deviceTimers.delete(key);
      fn(when);
      drain();
    });
    deviceTimers.set(key, { id, markId, index, type });
  }

  function cancelDeviceTimer(key) {
    const timer = deviceTimers.get(key);
    if (!timer) return;
    timers.cancel(timer.id);
    deviceTimers.delete(key);
  }

  function runTimers(to) {
    const result = timers.runUntil(to, (at) => {
      now = at;
    });
    if (result.cut) journalSystem("error", "timersCut", { max: SIM_TIMERS_RUN_MAX });
    return result;
  }

  function clearTimers() {
    timers.clear();
    deviceTimers.clear();
    for (const entry of entries) entry.timers.clear();
  }

  // ——— поведения «как настоящие» ——————————————————————————————————————————

  function react(event) {
    const device = devices.get(event.markId);
    const service = device ? device.services[event.service] : null;
    if (!service || service.type !== event.serviceType) return;
    switch (service.type) {
      case "StatelessProgrammableSwitch":
        // Кнопка без своего «Выключателя» (профиль до G11): одиночное нажатие
        // привязанной клавиши переключает нагрузки канала.
        if (event.char === "ProgrammableSwitchEvent" && event.value === "SINGLE_PRESS" && !service.decoupled && !service.relay) {
          keyLoads(device, service, event.chain);
        }
        break;
      case "Switch":
        // «Выключатель» клавиши ведёт нагрузки канала — кто бы его ни поставил.
        if (event.char === "On" && service.key) followLoads(device, service, event.value === true, event.chain);
        break;
      case "Lightbulb":
        lampFollow(device, service, event);
        break;
      case "MotionSensor":
        if (event.char !== "MotionDetected") break;
        if (event.value === true) armReset(device, service, event.chain, false);
        else cancelDeviceTimer(timerKey(device.markId, service.index, "reset"));
        break;
      case "WindowCovering":
        if (event.char === "TargetPosition") moveCurtain(device, service, event.chain);
        else if (event.char === "C_TargetPositionState") curtainCommand(device, service, event.value, event.chain);
        break;
      case "LockMechanism":
        if (event.char === "LockTargetState") lockFollow(device, service, event.chain);
        break;
      case "Thermostat":
        if (SIM_ENGINE_THERMOSTAT.has(event.char)) thermostatFollow(device, service, event.chain);
        break;
      case "HeaterCooler":
        if (SIM_ENGINE_HEATER.has(event.char)) heaterFollow(device, service, event.chain);
        break;
      case "BatteryService":
        if (event.char === "BatteryLevel") batteryFollow(device, service, event.chain);
        break;
      case "Valve":
        if (event.char === "Active") valveFollow(device, service, event.chain);
        break;
      case "CarbonDioxideSensor":
        if (event.char === "CarbonDioxideLevel") co2Follow(device, service, event.chain);
        break;
      default:
        break;
    }
  }

  // Привести производные состояния в порядок: при запуске и перестройке дома.
  // Идущие таймеры не переставляются: сброс датчика и ход шторы, начатые до
  // перестройки, идут своим временем.
  function settle(chain) {
    for (const device of devices.values()) {
      for (const service of device.services) {
        switch (service.type) {
          case "MotionSensor":
            if (read(device, service, "MotionDetected") === true) armReset(device, service, chain, true);
            break;
          case "WindowCovering":
            if (!deviceTimers.has(timerKey(device.markId, service.index, "travel"))) moveCurtain(device, service, chain);
            break;
          case "LockMechanism":
            lockFollow(device, service, chain);
            break;
          case "Thermostat":
            thermostatFollow(device, service, chain);
            break;
          case "HeaterCooler":
            heaterFollow(device, service, chain);
            break;
          case "BatteryService":
            batteryFollow(device, service, chain);
            break;
          case "Valve":
            valveFollow(device, service, chain);
            break;
          case "CarbonDioxideSensor":
            co2Follow(device, service, chain);
            break;
          default:
            break;
        }
      }
    }
  }

  function armReset(device, service, chain, ensure) {
    if (!isRunning) return;
    const key = timerKey(device.markId, service.index, "reset");
    // Пока человек в помещении датчика, движение не сбрасывается.
    if (device.roomId && present.has(device.roomId)) {
      cancelDeviceTimer(key);
      return;
    }
    if (ensure && deviceTimers.has(key)) return;
    const at = now + simEngineSeconds(device.params.resetSec, SIM_RESET_SEC) * 1000;
    deviceTimer(key, device.markId, service.index, service.type, at, (when) =>
      apply(device.markId, service.index, "MotionDetected", false, [{ k: "timer", at: when, what: "reset" }, ...chain]),
    );
  }

  function moveCurtain(device, service, chain) {
    const key = timerKey(device.markId, service.index, "travel");
    cancelDeviceTimer(key);
    if (!isRunning) return;
    const markId = device.markId;
    const index = service.index;
    const travelMs = simEngineSeconds(device.params.travelSec, SIM_TRAVEL_SEC) * 1000;
    const step = (base) => {
      const live = devices.get(markId);
      const own = live ? live.services[index] : null;
      if (!own || own.type !== "WindowCovering") return;
      const current = Number(read(live, own, "CurrentPosition")) || 0;
      const target = Number(read(live, own, "TargetPosition")) || 0;
      if (current === target) {
        apply(markId, index, "PositionState", "STOPPED", base);
        return;
      }
      const direction = target > current ? 1 : -1;
      apply(markId, index, "PositionState", direction > 0 ? "INCREASING" : "DECREASING", base);
      const move = Math.min(SIM_CURTAIN_STEP, Math.abs(target - current));
      deviceTimer(key, markId, index, "WindowCovering", now + (travelMs * move) / 100, (when) => {
        const next = [{ k: "timer", at: when, what: "travel" }, ...chain];
        apply(markId, index, "CurrentPosition", current + direction * move, next);
        step(next);
      });
    };
    step(chain);
  }

  function curtainCommand(device, service, command, chain) {
    if (command === "OPEN") apply(device.markId, service.index, "TargetPosition", 100, chain);
    else if (command === "CLOSE") apply(device.markId, service.index, "TargetPosition", 0, chain);
    else if (command === "STOP") {
      apply(device.markId, service.index, "TargetPosition", read(device, service, "CurrentPosition"), chain);
    }
  }

  // Лампа (правка после сборки сценариев): «если у лампочки поставили яркость
  // 0 %, то она выключается, а, если была выключена и поставили яркость больше
  // 0, то включается». Включили лампу с нулевой яркостью — она вспоминает
  // прежнюю (впервые — полную). Режим цвета (`C_ColorMode`) — то, что меняли
  // последним: оттенок и насыщенность или цветовую температуру.
  const lampBright = new Map();

  function lampFollow(device, service, event) {
    const key = device.markId + "|" + service.index;
    const chain = event.chain;
    if (event.char === "Brightness") {
      const level = Number(event.value);
      if (level > 0) lampBright.set(key, level);
      const on = read(device, service, "On") === true;
      if (!(level > 0) && on) apply(device.markId, service.index, "On", false, chain);
      else if (level > 0 && !on && service.chars.has("On")) apply(device.markId, service.index, "On", true, chain);
    } else if (event.char === "On" && event.value === true && service.chars.has("Brightness")) {
      if (!(Number(read(device, service, "Brightness")) > 0)) apply(device.markId, service.index, "Brightness", lampBright.get(key) || 100, chain);
    } else if (service.chars.has("C_ColorMode")) {
      const mode = event.char === "Hue" || event.char === "Saturation" ? "HUE" : event.char === "ColorTemperature" ? "TEMPERATURE" : null;
      if (mode && read(device, service, "C_ColorMode") !== mode) apply(device.markId, service.index, "C_ColorMode", mode, chain);
    }
  }

  function lockFollow(device, service, chain) {
    const target = read(device, service, "LockTargetState");
    if (target === undefined || target === null) return;
    apply(device.markId, service.index, "LockCurrentState", target, chain);
  }

  function thermostatFollow(device, service, chain) {
    const mode = read(device, service, "TargetHeatingCoolingState");
    const current = Number(read(device, service, "CurrentTemperature"));
    const target = Number(read(device, service, "TargetTemperature"));
    if (mode === undefined) return;
    let state = "OFF";
    if ((mode === "HEAT" || mode === "AUTO" || mode === "ECO") && current < target) state = "HEAT";
    else if ((mode === "COOL" || mode === "AUTO" || mode === "ECO") && current > target) state = "COOL";
    apply(device.markId, service.index, "CurrentHeatingCoolingState", state, chain);
  }

  function heaterFollow(device, service, chain) {
    const active = read(device, service, "Active");
    if (active === undefined) return;
    let state = "INACTIVE";
    if (active === "ACTIVE") {
      const mode = read(device, service, "TargetHeaterCoolerState");
      const current = Number(read(device, service, "CurrentTemperature"));
      const heat = read(device, service, "HeatingThresholdTemperature");
      const cool = read(device, service, "CoolingThresholdTemperature");
      const below = heat === undefined || heat === null ? mode === "HEAT" : current < Number(heat);
      const above = cool === undefined || cool === null ? mode === "COOL" : current > Number(cool);
      state = "IDLE";
      if ((mode === "HEAT" || mode === "AUTO") && below) state = "HEATING";
      else if ((mode === "COOL" || mode === "AUTO") && above) state = "COOLING";
    }
    apply(device.markId, service.index, "CurrentHeaterCoolerState", state, chain);
  }

  function batteryFollow(device, service, chain) {
    const level = read(device, service, "BatteryLevel");
    if (level === undefined || level === null) return;
    const low = Number(level) < SIM_BATTERY_LOW;
    apply(device.markId, service.index, "StatusLowBattery", low ? "BATTERY_LEVEL_LOW" : "BATTERY_LEVEL_NORMAL", chain);
  }

  function valveFollow(device, service, chain) {
    const active = read(device, service, "Active");
    if (active === undefined) return;
    apply(device.markId, service.index, "InUse", active === "ACTIVE" ? "IN_USE" : "NOT_IN_USE", chain);
  }

  function co2Follow(device, service, chain) {
    const level = read(device, service, "CarbonDioxideLevel");
    if (level === undefined || level === null) return;
    const high = Number(level) >= SIM_CO2_ABNORMAL;
    apply(device.markId, service.index, "CarbonDioxideDetected", high ? "CO2_LEVELS_ABNORMAL" : "CO2_LEVELS_NORMAL", chain);
  }

  // ——— нагрузки и щелчки ——————————————————————————————————————————————————

  function loadRole(service) {
    if (service.aux) return null;
    if (SIM_ENGINE_ON.has(service.type) && service.chars.has("On")) return "on";
    if (SIM_ENGINE_ACTIVE.has(service.type) && service.chars.has("Active")) return "active";
    if (service.type === "WindowCovering" && service.chars.has("TargetPosition")) return "curtain";
    if (service.modeLoad && service.chars.has("TargetHeatingCoolingState")) return "mode";
    return null;
  }

  // Режим, к которому вернётся включённый кондиционер: тот, с которым его
  // выключили, а впервые — «Авто».
  const lastModes = new Map();

  function loadIsOn(device, service) {
    switch (loadRole(service)) {
      case "on":
        return read(device, service, "On") === true;
      case "active":
        return read(device, service, "Active") === "ACTIVE";
      case "curtain":
        return Number(read(device, service, "TargetPosition")) > 0;
      case "mode":
        return read(device, service, "TargetHeatingCoolingState") !== "OFF";
      default:
        return false;
    }
  }

  function loadSet(device, service, on, chain) {
    switch (loadRole(service)) {
      case "on":
        return apply(device.markId, service.index, "On", on, chain);
      case "active":
        return apply(device.markId, service.index, "Active", on ? "ACTIVE" : "INACTIVE", chain);
      case "curtain":
        return apply(device.markId, service.index, "TargetPosition", on ? 100 : 0, chain);
      case "mode": {
        const key = device.markId + "|" + service.index;
        const mode = read(device, service, "TargetHeatingCoolingState");
        // Уже работает — включать нечего: режим, который выбрали, остаётся.
        if (on && mode !== "OFF" && mode !== undefined) return false;
        if (!on && mode !== "OFF" && mode !== undefined) lastModes.set(key, mode);
        return apply(device.markId, service.index, "TargetHeatingCoolingState", on ? lastModes.get(key) || "AUTO" : "OFF", chain);
      }
      default:
        return false;
    }
  }

  // Группа нагрузок: что-то включено — выключить всё, иначе включить всё.
  function toggleGroup(loads, chain) {
    if (loads.length === 0) return false;
    const on = loads.some(({ device, service }) => loadIsOn(device, service));
    let changed = false;
    for (const { device, service } of loads) changed = loadSet(device, service, !on, chain) || changed;
    return changed;
  }

  function channelOf(service) {
    return service.channel === null ? 1 : service.channel;
  }

  // Нагрузки канала клавиши из связи «чем управляет» — по сервису на нагрузку.
  function channelLoads(device, channel) {
    const loads = [];
    const links = keyLinks.get(device.markId);
    const targets = links ? [...(links.get(channel) || [])] : [];
    // Связь без номера канала — только у единственной клавиши (таск 177, D50).
    if (links && device.keys === 1 && channel === 1) targets.push(...(links.get(null) || []));
    const seen = new Set();
    for (const markId of targets) {
      if (seen.has(markId)) continue;
      seen.add(markId);
      const target = devices.get(markId);
      if (!target) continue;
      for (const service of target.services) if (loadRole(service)) loads.push({ device: target, service });
    }
    return loads;
  }

  // Клавиша без своего «Выключателя» (профиль до G11): группа нагрузок канала
  // переключается целиком.
  function keyLoads(device, key, chain) {
    toggleGroup(channelLoads(device, channelOf(key)), chain);
  }

  // Нагрузки следуют за «Выключателем» клавиши: вкл — все вкл, выкл — все выкл.
  function followLoads(device, relay, on, chain) {
    let changed = false;
    for (const { device: target, service } of channelLoads(device, channelOf(relay))) {
      changed = loadSet(target, service, on, chain) || changed;
    }
    return changed;
  }

  function primaryService(device) {
    const key = device.services.find((service) => service.type === "StatelessProgrammableSwitch");
    if (key) return key;
    return (
      device.services.find(
        (service) =>
          !service.aux &&
          (loadRole(service) || SIM_ENGINE_KEYS.has(service.type) || SIM_ENGINE_SENSORS.has(service.type) || SIM_ENGINE_OTHERS.has(service.type)),
      ) || null
    );
  }

  function pressKey(device, service, press, chain) {
    if (!service || !SIM_ENGINE_KEYS.has(service.type)) return false;
    const value = pressEventValue(press);
    if (!value) return false;
    // Привязанная клавиша с «Выключателем» (G11): щелчок переключает его, а
    // кнопка событий не шлёт — двойного и долгого у неё нет.
    if (service.relay && !service.decoupled) {
      if (value !== "SINGLE_PRESS") return false;
      return apply(device.markId, service.relay.index, "On", read(device, service.relay, "On") !== true, chain);
    }
    return apply(device.markId, service.index, "ProgrammableSwitchEvent", value, chain);
  }

  function sensorAct(device, service, value, chain) {
    if (!service) return false;
    if (service.type === "MotionSensor") {
      if (value === false) return apply(device.markId, service.index, "MotionDetected", false, chain);
      if (read(device, service, "MotionDetected") === true) return motionAgain(device, service, chain);
      return apply(device.markId, service.index, "MotionDetected", true, chain);
    }
    const alert = SIM_ENGINE_ALERTS[service.type];
    if (!alert) return false;
    const [char, on, off] = alert;
    const next = value === undefined ? read(device, service, char) !== on : Boolean(value);
    return apply(device.markId, service.index, char, next ? on : off, chain);
  }

  function toggleDevice(device, service, chain) {
    if (!service) return false;
    if (SIM_ENGINE_KEYS.has(service.type)) return pressKey(device, service, "single", chain);
    if (SIM_ENGINE_SENSORS.has(service.type)) return sensorAct(device, service, undefined, chain);
    if (loadRole(service)) return toggleGroup([{ device, service }], chain);
    const at = service.index;
    switch (service.type) {
      case "Thermostat":
        return apply(
          device.markId,
          at,
          "TargetHeatingCoolingState",
          read(device, service, "TargetHeatingCoolingState") === "OFF" ? "HEAT" : "OFF",
          chain,
        );
      case "LockMechanism":
        return apply(
          device.markId,
          at,
          "LockTargetState",
          read(device, service, "LockTargetState") === "SECURED" ? "UNSECURED" : "SECURED",
          chain,
        );
      case "Speaker":
        return apply(device.markId, at, "Mute", read(device, service, "Mute") !== true, chain);
      default:
        return false;
    }
  }

  function presenceAct(roomIds, chain) {
    const next = new Set(simEngineList(roomIds).filter((room) => typeof room === "string" && room));
    const left = [...present].filter((room) => !next.has(room));
    const entered = [...next].filter((room) => !present.has(room));
    present.clear();
    for (const room of next) present.add(room);
    let changed = false;
    for (const room of left) {
      for (const { markId, service } of roomSensors.get(room) || []) {
        const device = devices.get(markId);
        const own = device.services[service];
        if (own.type === "MotionSensor") {
          if (read(device, own, "MotionDetected") === true) armReset(device, own, chain, false);
        } else {
          changed = apply(markId, service, "OccupancyDetected", "OCCUPANCY_NOT_DETECTED", chain) || changed;
        }
      }
    }
    for (const room of entered) {
      for (const { markId, service } of roomSensors.get(room) || []) {
        const device = devices.get(markId);
        const own = device.services[service];
        if (own.type === "MotionSensor") {
          const again = read(device, own, "MotionDetected") === true;
          changed = (again ? motionAgain(device, own, chain) : apply(markId, service, "MotionDetected", true, chain)) || changed;
          armReset(device, own, chain, false);
        } else {
          changed = apply(markId, service, "OccupancyDetected", "OCCUPANCY_DETECTED", chain) || changed;
        }
      }
    }
    return changed;
  }

  function doorAct(openingId, open, chain) {
    let changed = false;
    // Хозяевам — что дверь открыли или закрыли (климат дома: воздух ходит
    // через открытую дверь).
    for (const entry of entries) {
      call(entry, "door", { openingId, open, chain });
      drain();
    }
    for (const markId of doorSensors.get(openingId) || []) {
      const device = devices.get(markId);
      const service = device.services.find((item) => item.type === "ContactSensor");
      if (!service) continue;
      changed = apply(markId, service.index, "ContactSensorState", open ? "CONTACT_NOT_DETECTED" : "CONTACT_DETECTED", chain) || changed;
    }
    return changed;
  }

  // Команда (G16): запись журнала, затем хозяева сценариев — каждый говорит,
  // сколько его сценариев её поняли.
  function commandAct(given, origin) {
    const said = typeof given === "string" ? given.trim() : "";
    if (!said) return false;
    const vars = { text: said };
    outLog.push({ at: now, kind: "system", chain: [...origin], code: "command", vars, text: text("sim.journal.command", vars) });
    const chain = [{ k: "command", at: now, text: said }, ...origin];
    let heard = 0;
    for (const entry of entries) {
      const got = Number(call(entry, "command", { text: said, chain }));
      drain();
      if (Number.isFinite(got) && got > 0) heard += got;
    }
    if (heard > 0) {
      outScenarios = true;
      return true;
    }
    outLog.push({ at: now, kind: "system", chain: [...origin], code: "commandUnknown", vars: { text: said }, text: text("sim.journal.commandUnknown", vars) });
    return false;
  }

  function originOf(action) {
    const k = SIM_ENGINE_CAUSES.has(action.cause) ? action.cause : SIM_ENGINE_ACTION_CAUSE[action.kind];
    if (k === "door") return { k, at: now, openingId: action.openingId, open: action.open === true };
    return { k, at: now };
  }

  function actNow(action) {
    const chain = [originOf(action)];
    if (action.kind === "command") return commandAct(action.text, chain);
    if (action.kind === "presence") return presenceAct(action.roomIds, chain);
    if (action.kind === "door") return doorAct(action.openingId, action.open === true, chain);
    const device = devices.get(action.markId);
    if (!device) return false;
    const given = Number.isInteger(action.service) ? device.services[action.service] || null : undefined;
    switch (action.kind) {
      case "set":
        return given ? apply(device.markId, given.index, action.char, action.value, chain) : false;
      case "toggle":
        return toggleDevice(device, given === undefined ? primaryService(device) : given, chain);
      case "press":
        return pressKey(device, given === undefined ? primaryService(device) : given, action.press, chain);
      case "sensor":
        return sensorAct(
          device,
          given === undefined ? device.services.find((service) => SIM_ENGINE_SENSORS.has(service.type)) || null : given,
          action.value,
          chain,
        );
      default:
        return false;
    }
  }

  // ——— дверь хозяина ——————————————————————————————————————————————————————

  function hostFor(entry) {
    return {
      name: entry.owner.name,
      now: () => now,
      running: () => isRunning,
      home: () => home,
      site: () => (home && home.site) || null,
      accessory: (markId) => {
        const device = devices.get(markId);
        return device ? device.accessory : null;
      },
      value: (markId, service, char) => valueOf(markId, service, char),
      values: () => snapshot(),
      write: (write) => {
        if (!isRunning || !write || typeof write !== "object") return false;
        return apply(write.markId, write.service, write.char, write.value, write.chain, write.quiet === true);
      },
      subscribe: (filter, handler) => subscribe(entry, filter, handler),
      // `options.background` — фоновое событие (шаг климата): в «ближайшее
      // событие» не идёт (`simTimers.nextAt`).
      timer: (atMs, fn, tag, options) => ownerTimer(entry, atMs, fn, tag, options),
      cancelTimer: (id) => {
        if (!entry.timers.has(id)) return;
        timers.cancel(id);
        entry.timers.delete(id);
      },
      cancelTimers: (tag) => ownerCancelTimers(entry, tag),
      log: (given) => {
        const source = given && typeof given === "object" ? given : {};
        const entryOut = {
          ...source,
          at: Number.isFinite(source.at) ? source.at : now,
          kind: typeof source.kind === "string" ? source.kind : "system",
          chain: Array.isArray(source.chain) ? source.chain : [],
        };
        if (typeof entryOut.text !== "string") {
          entryOut.text = typeof source.code === "string" ? text("sim.journal." + source.code, source.vars) : "";
        }
        outLog.push(entryOut);
      },
      post: (message) => {
        if (message && typeof message === "object") outPosts.push(message);
      },
      runCode: (request) => {
        const runner = entries.find((item) => item !== entry && typeof item.owner.runCode === "function");
        if (!runner) return { ok: false, error: null, line: null, code: "noRunner" };
        const result = guard(runner, () => runner.owner.runCode(request, runner.host));
        return result && typeof result === "object" ? result : { ok: false, error: null, line: null, code: "runnerFailed" };
      },
      runScenario: (id, chain) => {
        const owner = scenarioOwner(id);
        if (!owner || !isRunning || typeof owner.owner.run !== "function") return false;
        call(owner, "run", id, { chain: Array.isArray(chain) ? chain : [], manual: false });
        outScenarios = true;
        return true;
      },
      setScenarioActive: (id, on) => {
        const owner = scenarioOwner(id);
        if (!owner || typeof owner.owner.setActive !== "function") return false;
        call(owner, "setActive", id, on === true);
        outScenarios = true;
        return true;
      },
      resetScenario: (id) => {
        const owner = scenarioOwner(id);
        if (!owner || typeof owner.owner.resetScenario !== "function") return false;
        call(owner, "resetScenario", id);
        outScenarios = true;
        return true;
      },
      scenariosChanged: () => {
        outScenarios = true;
      },
    };
  }

  // ——— чтение ————————————————————————————————————————————————————————————

  function valueOf(markId, service, char) {
    const device = devices.get(markId);
    return device ? device.values[simValueKey(service, char)] : undefined;
  }

  function snapshot() {
    const out = {};
    for (const [markId, device] of devices) out[markId] = { ...device.values };
    return out;
  }

  function restore(values) {
    if (!values || typeof values !== "object") return;
    for (const [markId, own] of Object.entries(values)) {
      const device = devices.get(markId);
      if (!device || !own || typeof own !== "object") continue;
      for (const [key, raw] of Object.entries(own)) {
        const dot = key.indexOf(".");
        const index = Number(key.slice(0, dot));
        const char = key.slice(dot + 1);
        const service = dot > 0 && Number.isInteger(index) ? device.services[index] : null;
        const slot = service ? service.chars.get(char) : null;
        if (!slot || slot.event) continue;
        const value = simClamp(slot.meta, raw);
        if (device.values[key] === value) continue;
        device.values[key] = value;
        recordChange(markId, index, char, value, false);
      }
    }
  }

  // ——— методы ————————————————————————————————————————————————————————————

  function load(spec) {
    return batch(() => {
      const given = spec && typeof spec === "object" ? spec : {};
      home = {
        ...given,
        accessories: simEngineList(given.accessories),
        links: simEngineList(given.links),
        doors: simEngineList(given.doors),
        scenarios: simEngineList(given.scenarios),
        logicBindings: simEngineList(given.logicBindings),
      };
      const old = new Map(devices);
      devices.clear();
      for (const accessory of home.accessories) {
        if (!accessory || typeof accessory.markId !== "string" || devices.has(accessory.markId)) continue;
        devices.set(accessory.markId, deviceFrom(accessory, old.get(accessory.markId)));
      }
      indexHome();
      for (const [key, timer] of [...deviceTimers]) {
        const service = serviceOf(timer.markId, timer.index);
        if (!service || service.type !== timer.type) cancelDeviceTimer(key);
      }
      const chain = [{ k: "hub", at: now, what: "load" }];
      if (isRunning) settle(chain);
      drain();
      for (const entry of entries) {
        dropOwner(entry);
        call(entry, "load", home);
      }
      if (isRunning) {
        for (const entry of entries) {
          call(entry, "start", { reload: true, chain });
          drain();
        }
      }
      outScenarios = true;
      return true;
    });
  }

  // `restored` — тот же запуск, поднятый сторожем в новом потоке; `memory` —
  // память хозяев по их именам (`{hub: {globals}}`), которую старый поток
  // успел отдать странице. Хозяин получает только свою.
  function start(values, { restored = false, memory = null } = {}) {
    return batch(() => {
      if (isRunning) return false;
      restore(values);
      isRunning = true;
      journalSystem("system", "started");
      if (devices.size === 0) journalSystem("system", "empty");
      const chain = [{ k: "hub", at: now, what: "start" }];
      settle(chain);
      drain();
      for (const entry of entries) {
        const own = memory && typeof memory === "object" ? memory[entry.owner.name] : undefined;
        call(entry, "start", { reload: false, restored: restored === true, memory: own === undefined ? null : own, chain });
        drain();
      }
      outScenarios = true;
      return true;
    });
  }

  function stop() {
    return batch(() => {
      if (!isRunning) return false;
      for (const entry of entries) call(entry, "stop");
      drain();
      isRunning = false;
      clearTimers();
      for (const entry of entries) dropOwner(entry);
      subsByMark.clear();
      subsAny = [];
      journalSystem("system", "stopped");
      outScenarios = true;
      return true;
    });
  }

  function reset() {
    return batch(() => {
      clearTimers();
      queue.length = 0;
      queueHead = 0;
      for (const device of devices.values()) {
        for (const service of device.services) {
          for (const [char, slot] of service.chars) {
            if (slot.event) continue;
            const key = simValueKey(service.index, char);
            if (device.values[key] === slot.initial) continue;
            device.values[key] = slot.initial;
            recordChange(device.markId, service.index, char, slot.initial, false);
          }
        }
      }
      journalSystem("system", "reset");
      const chain = [{ k: "hub", at: now, what: "reset" }];
      for (const entry of entries) {
        call(entry, "reset", { chain });
        drain();
      }
      outScenarios = true;
      return true;
    });
  }

  function act(action) {
    if (!action || typeof action !== "object" || !SIM_ACTIONS.includes(action.kind)) {
      throw new TypeError("simEngine.act: unknown action");
    }
    return batch(() => (isRunning ? actNow(action) : false));
  }

  function advanceTo(simMs) {
    const to = Number(simMs);
    if (!Number.isFinite(to)) throw new TypeError("simEngine.advanceTo: time must be a finite number");
    return batch(() => {
      if (!isRunning) {
        now = to;
        return { ran: 0, cut: false };
      }
      return runTimers(to);
    });
  }

  function setClock(clock) {
    const to = Number(clock && clock.simMs);
    if (!Number.isFinite(to)) throw new TypeError("simEngine.setClock: clock.simMs must be a finite number");
    return batch(() => {
      const from = now;
      if (!isRunning) {
        now = to;
        return true;
      }
      runTimers(to);
      for (const entry of entries) {
        call(entry, "clock", { from, to: now });
        drain();
      }
      return true;
    });
  }

  function runScenario(id) {
    return batch(() => {
      const owner = scenarioOwner(id);
      if (!isRunning || !owner || typeof owner.owner.run !== "function") return false;
      call(owner, "run", id, { chain: [{ k: "web", at: now }], manual: true });
      outScenarios = true;
      return true;
    });
  }

  /**
   * Сообщение страницы хозяину по имени (правка после сборки сценариев): климат
   * дома слушает выбор погоды, людей и заданные значения помещений. Хозяина
   * нет — ничего.
   */
  function tell(name, data) {
    return batch(() => {
      const entry = entries.find((item) => item.owner.name === name);
      if (!entry) return false;
      call(entry, "message", data);
      return true;
    });
  }

  function setScenarioActive(id, on) {
    return batch(() => {
      const owner = scenarioOwner(id);
      if (!owner || typeof owner.owner.setActive !== "function") return false;
      call(owner, "setActive", id, on === true);
      outScenarios = true;
      return true;
    });
  }

  return {
    load,
    start,
    stop,
    reset,
    values: snapshot,
    value: valueOf,
    act,
    advanceTo,
    setClock,
    nextAt: () => (isRunning ? timers.nextAt() : null),
    // Когда будить поток — с фоновыми событиями: климат идёт и без сценариев.
    wakeAt: () => (isRunning ? timers.nextAt(true) : null),
    now: () => now,
    running: () => isRunning,
    runScenario,
    setScenarioActive,
    tell,
    scenarios: scenarioList,
  };
}
