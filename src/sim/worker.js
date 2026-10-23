// Вход потока имитации (таск 07 сценариев; истории 2.3, 3.2–3.4, 5.4, 7.5).
//
// Движок, блочные сценарии и хозяин скриптов живут здесь вместе: API хаба
// синхронный (`getCharacteristicValue` сразу отдаёт значение), поэтому
// состояние дома обязано жить в том же потоке, что и код сценариев. Страница
// держит только зеркало (`simulation.js`) и говорит с потоком сообщениями —
// протокол `interfaces.md` («Протокол страница ↔ Worker»).
//
// Модуль только объявляет `simWorkerMain(scope)`; вызов `simWorkerMain(self)`
// дописывает сборка в конец бандла воркера (`build.js`). В бандле страницы та
// же функция служит запасным путём: без Worker мост (`bridge.js`) поднимает
// её на поддельном `scope` прямо в странице.
//
// ——— время ———————————————————————————————————————————————————————————————
//
// Страница шлёт часы формулой (`clock {clock}`), «сейчас» поток считает сам
// той же формулой (`clockSimMs`) от `Date.now()`. Перед каждым сообщением
// время догоняется до часов, а пока дом запущен и часы идут, поток будит
// себя к ближайшему событию очереди — не чаще, чем нужно, и не реже раза в
// `SIM_WORKER_TICK_MAX_MS`. `advance {toMs}` — шаг страницы: время уходит
// вперёд ровно до этого мига (перевод часов формулой может недобрать долю
// миллисекунды, и событие ровно на границе шага осталось бы ждать).
//
// ——— сторож ——————————————————————————————————————————————————————————————
//
// Зависший сценарий страница узнаёт по молчанию на `ping`, но виновника из
// молчания не узнать. Поэтому перед входом в код сценария поток говорит, чей
// код сейчас пойдёт: `trace {where, scenarioId, bindingId}`; несколько
// возможных виновников (верхний уровень скриптов при загрузке и запуске) —
// `trace {where, candidates}`; пустой `trace {}` — код сценариев кончился.
// Сообщение уходит до исполнения, поэтому доезжает и тогда, когда поток
// потом встал навсегда. Слушает хозяина скриптов обёртка (`simWorkerTraced`):
// перед `trigger` хозяин пишет `hubTrigger`, таймеры скриптов помечены
// `hub:<id>`, остальное — по хуку, который движок зовёт.
import { clockSimMs, volumeClockSpeedOf } from "../clockMath.js";
import { text } from "../strings.js";
import { blocksOwner } from "./blocks.js";
import { createSimEngine } from "./engine.js";
import { createHubOwner } from "./hubApi.js";

/** Самый долгий сон потока между событиями при идущих часах, мс настоящего времени. */
export const SIM_WORKER_TICK_MAX_MS = 1000;
/** Сообщения, которые поток понимает (`interfaces.md`, «Протокол»). */
export const SIM_WORKER_MESSAGES = Object.freeze([
  "load",
  "start",
  "stop",
  "reset",
  "clock",
  "act",
  "advance",
  "next",
  "run",
  "active",
  "ping",
]);

/**
 * Чего у потока сценариев нет (ревью ветки, F1): сеть, хранилища браузера,
 * чужие потоки и уведомления. Код сценария исполняется здесь уже при открытии
 * объекта, а изоляция области (`hubApi.js`) — не защита: глобальный объект
 * достаётся через `({}).constructor.constructor("return this")()`. Поэтому
 * эти имена снимаются с глобального объекта до первого сообщения.
 */
export const SIM_WORKER_SEALED = Object.freeze([
  "fetch",
  "XMLHttpRequest",
  "WebSocket",
  "WebSocketStream",
  "WebTransport",
  "EventSource",
  "importScripts",
  "indexedDB",
  "caches",
  "BroadcastChannel",
  "Worker",
  "SharedWorker",
  "Notification",
  "navigator",
]);

/**
 * Снять `SIM_WORKER_SEALED` с глобального объекта потока: с него самого и с
 * его прототипов (у браузера одни имена лежат на объекте, другие — на
 * `WorkerGlobalScope.prototype`); что не удаляется — заслоняется своим
 * `undefined`. Возвращает имена, которые снять не вышло (пустой список — всё
 * снято). Поддельный `scope` запасного пути в странице здесь ничего не теряет.
 */
export function simWorkerSeal(scope) {
  const left = [];
  if (!scope || (typeof scope !== "object" && typeof scope !== "function")) return left;
  const gone = (name) => {
    try {
      return scope[name] === undefined;
    } catch {
      return false;
    }
  };
  for (const name of SIM_WORKER_SEALED) {
    for (let owner = scope; owner && owner !== Object.prototype; owner = Object.getPrototypeOf(owner)) {
      if (!Object.prototype.hasOwnProperty.call(owner, name)) continue;
      try {
        delete owner[name];
      } catch {
        // неудаляемое заслоним ниже
      }
    }
    if (!gone(name)) {
      try {
        Object.defineProperty(scope, name, { value: undefined, writable: false, enumerable: false, configurable: false });
      } catch {
        // не вышло — имя уйдёт в ответ
      }
    }
    if (!gone(name)) left.push(name);
  }
  return left;
}

const SIM_WORKER_SCRIPT_KINDS = new Set(["logic", "global"]);
const SIM_WORKER_TIMER_TAG = "hub:";
// У сценария есть `compute` — только такие привязки хозяин зовёт до записи.
const SIM_WORKER_COMPUTE = /\bfunction\s+compute\s*\(|\bcompute\s*=[^=]/;

function simWorkerList(value) {
  return Array.isArray(value) ? value : [];
}

// Скрипты дома в порядке, в каком их исполняет хозяин: глобальные, потом
// логические, каждый вид — в порядке списка.
function simWorkerScripts(home) {
  const scenarios = simWorkerList(home && home.scenarios).filter(
    (scenario) => scenario && typeof scenario.id === "string" && SIM_WORKER_SCRIPT_KINDS.has(scenario.kind),
  );
  return [
    ...scenarios.filter((scenario) => scenario.kind === "global"),
    ...scenarios.filter((scenario) => scenario.kind === "logic"),
  ].map((scenario) => scenario.id);
}

// Сообщения о том, чей код сейчас исполняется. Одинаковое подряд не шлётся.
function simWorkerTracer(post) {
  let current = null;
  let posted = "";

  function keyOf(trace) {
    if (!trace) return "";
    if (typeof trace.key !== "string") {
      trace.key = [trace.where, trace.scenarioId, trace.bindingId, simWorkerList(trace.candidates).join(","), simWorkerList(trace.bindingIds).join(",")].join("|");
    }
    return trace.key;
  }

  function set(trace) {
    current = trace || null;
    const key = keyOf(current);
    if (key === posted) return;
    posted = key;
    if (!current) {
      post({ type: "trace" });
      return;
    }
    const message = { type: "trace", where: current.where };
    if (current.scenarioId !== undefined) message.scenarioId = current.scenarioId;
    if (current.bindingId !== undefined) message.bindingId = current.bindingId;
    if (current.bindingIds !== undefined) message.bindingIds = current.bindingIds;
    if (current.candidates !== undefined) message.candidates = current.candidates;
    post(message);
  }

  function within(trace, fn) {
    if (!trace) return fn();
    const before = current;
    set(trace);
    try {
      return fn();
    } finally {
      set(before);
    }
  }

  return { set, within, current: () => current, idle: () => set(null) };
}

/**
 * Хозяин скриптов с подсказками сторожу: тот же хозяин, но перед кодом
 * сценария поток говорит, чей это код (`trace`). Поведение хозяина не
 * меняется ни в чём — меняется только дверь (`host`), через которую он ходит
 * к движку: запись `hubTrigger` перед `trigger`, подписки скриптов помнят,
 * из чьего кода их завели, таймеры `hub:<id>` знают свой сценарий.
 */
export function simWorkerTraced(owner, tracer) {
  const hosts = new WeakMap();

  function hostOf(host) {
    if (!host || typeof host !== "object") return host;
    if (hosts.has(host)) return hosts.get(host);
    const traced = {
      ...host,
      log(entry) {
        if (entry && entry.code === "hubTrigger") {
          tracer.set({ where: "trigger", scenarioId: entry.scenarioId ?? null, bindingId: entry.bindingId ?? null });
        }
        return host.log(entry);
      },
      subscribe(filter, handler) {
        // Подписка привязки (по метке) ведёт в `trigger` — её назовёт `hubTrigger`.
        if (filter && typeof filter.markId === "string") return host.subscribe(filter, handler);
        const from = tracer.current();
        const trace = from ? { ...from, where: "subscribe", key: undefined } : null;
        return host.subscribe(filter, (event, own) => tracer.within(trace, () => handler(event, own)));
      },
      timer(atMs, fn, tag) {
        const id = typeof tag === "string" && tag.startsWith(SIM_WORKER_TIMER_TAG) ? tag.slice(SIM_WORKER_TIMER_TAG.length) : null;
        const trace = id ? { where: "timer", scenarioId: id } : tracer.current();
        return host.timer(atMs, (when) => tracer.within(trace, () => fn(when)), tag);
      },
    };
    hosts.set(host, traced);
    return traced;
  }

  // Привязки с `compute` по сервису: `compute` зовётся на каждую запись, и
  // искать их каждый раз заново — лишняя работа на горячем пути.
  let computeHome = null;
  let computeIndex = new Map();

  function computersOf(home) {
    if (home === computeHome) return computeIndex;
    computeHome = home;
    computeIndex = new Map();
    const computing = new Set(
      simWorkerList(home && home.scenarios)
        .filter((scenario) => scenario && scenario.kind === "logic" && SIM_WORKER_COMPUTE.test(String(scenario.source || "")))
        .map((scenario) => scenario.id),
    );
    for (const binding of simWorkerList(home && home.logicBindings)) {
      if (!binding || binding.active === false || !computing.has(binding.scenarioId)) continue;
      const key = binding.markId + "|" + binding.service;
      if (!computeIndex.has(key)) computeIndex.set(key, []);
      computeIndex.get(key).push(binding);
    }
    return computeIndex;
  }

  function traceOf(hook, args, host) {
    const home = host && typeof host.home === "function" ? host.home() : null;
    switch (hook) {
      case "load":
        // Остановленный дом исполняет верхний уровень всех скриптов ради форм опций.
        return host && host.running() ? null : { where: "load", candidates: simWorkerScripts(args[0]) };
      case "start":
        return { where: "start", candidates: simWorkerScripts(home) };
      case "reset":
        return { where: "reset", candidates: simWorkerScripts(home) };
      case "setActive":
        return args[1] === true ? { where: "start", scenarioId: args[0] } : null;
      case "resetScenario":
      case "run":
        return { where: "start", scenarioId: args[0] };
      case "compute": {
        const write = args[0] || {};
        const bindings = computersOf(home).get(write.markId + "|" + write.service);
        if (!bindings) return null;
        const trace = { where: "compute", scenarioId: bindings[0].scenarioId, bindingId: bindings[0].id };
        if (bindings.length > 1) trace.bindingIds = bindings.map((binding) => binding.id);
        return trace;
      }
      case "runCode": {
        const request = args[0] && typeof args[0] === "object" ? args[0] : {};
        return { where: "code", scenarioId: request.scenarioId === undefined ? null : request.scenarioId };
      }
      default:
        return null;
    }
  }

  const traced = { name: owner.name };
  if (owner.kinds !== undefined) traced.kinds = owner.kinds;
  for (const hook of Object.keys(owner)) {
    if (typeof owner[hook] !== "function") continue;
    traced[hook] = (...args) => {
      const host = args.pop();
      return tracer.within(traceOf(hook, args, host), () => owner[hook](...args, hostOf(host)));
    };
  }
  return traced;
}

/**
 * Поднять имитацию на `scope` — `self` потока или поддельный `scope` моста в
 * странице: `postMessage(message)`, `addEventListener("message", fn)` (или
 * `onmessage`), необязательно `setTimeout`/`clearTimeout`/`now` (без них —
 * свои у потока). Возвращает `{engine, handle}` — для тестов и запасного пути.
 */
export function simWorkerMain(scope) {
  // До первого сообщения: сеть и хранилища потоку не нужны, а сценариям — запрещены.
  simWorkerSeal(scope);
  const later = typeof scope.setTimeout === "function" ? (fn, ms) => scope.setTimeout(fn, ms) : (fn, ms) => setTimeout(fn, ms);
  const cancel = typeof scope.clearTimeout === "function" ? (id) => scope.clearTimeout(id) : (id) => clearTimeout(id);
  const realNow = typeof scope.now === "function" ? () => scope.now() : () => Date.now();

  let engine = null;
  let clock = null;
  let tick = null;
  let lastNext;
  let quietStart = false;

  function post(message) {
    try {
      scope.postMessage(message);
    } catch (error) {
      // Неклонируемое значение (функция в форме опций и т. п.) не роняет поток.
      scope.postMessage({ type: "log", entries: [failure(error)] });
    }
  }

  function failure(error) {
    const vars = { message: error && typeof error.message === "string" ? error.message : String(error) };
    return {
      at: engine ? engine.now() : 0,
      kind: "error",
      chain: [],
      code: "workerError",
      vars,
      text: text("sim.journal.workerError", vars),
    };
  }

  function emit(message) {
    if (message.type === "changes") {
      // Остановленный дом — не источник правды: зеркало страницы держит
      // своё, а значения после `load` — это умолчания движка.
      post({ ...message, live: engine.running() });
      return;
    }
    if (message.type === "log" && quietStart) {
      const entries = message.entries.filter((entry) => entry.code !== "started");
      if (entries.length > 0) post({ ...message, entries });
      return;
    }
    post(message);
  }

  const tracer = simWorkerTracer(post);
  engine = createSimEngine({ emit, owners: [simWorkerTraced(createHubOwner(), tracer), blocksOwner()] });

  function clockNow() {
    return clock ? clockSimMs(clock, realNow()) : engine.now();
  }

  // Догнать часы: время идёт только вперёд; назад его переводит `clock`.
  function catchUp() {
    if (!clock) return;
    const to = clockNow();
    if (Number.isFinite(to) && to > engine.now()) engine.advanceTo(to);
  }

  function tellNext(always) {
    const at = engine.nextAt();
    if (!always && at === lastNext) return;
    lastNext = at;
    post({ type: "next", at });
  }

  function wake() {
    if (tick !== null) cancel(tick);
    tick = null;
    if (!engine.running() || !clock || clock.fixed) return;
    const next = engine.nextAt();
    if (next === null) return;
    const speed = volumeClockSpeedOf(clock.speed);
    const wait = Math.max(0, Math.min(SIM_WORKER_TICK_MAX_MS, (next - clockNow()) / speed));
    tick = later(() => {
      tick = null;
      try {
        catchUp();
      } catch (error) {
        post({ type: "log", entries: [failure(error)] });
      }
      tracer.idle();
      wake();
      tellNext(false);
    }, Math.ceil(wait));
  }

  function run(data) {
    switch (data.type) {
      case "load":
        engine.load(data.spec);
        break;
      case "start":
        quietStart = data.restore === true;
        try {
          engine.start(data.values);
        } finally {
          quietStart = false;
        }
        break;
      case "stop":
        engine.stop();
        break;
      case "reset":
        engine.reset();
        break;
      case "clock":
        clock = data.clock && typeof data.clock === "object" ? data.clock : null;
        if (clock) engine.setClock({ simMs: clockNow() });
        break;
      case "act":
        engine.act(data.action);
        break;
      case "advance": {
        const to = Number(data.toMs);
        if (Number.isFinite(to)) engine.advanceTo(Math.max(engine.now(), to));
        break;
      }
      case "next":
        tellNext(true);
        break;
      case "run":
        engine.runScenario(data.scenarioId);
        break;
      case "active":
        engine.setScenarioActive(data.scenarioId, data.on === true);
        break;
      default:
        break;
    }
  }

  function handle(data) {
    if (!data || typeof data !== "object") return;
    if (data.type === "ping") {
      post({ type: "pong", n: data.n });
      return;
    }
    try {
      if (data.type !== "clock") catchUp();
      run(data);
    } catch (error) {
      post({ type: "log", entries: [failure(error)] });
    }
    tracer.idle();
    wake();
    tellNext(false);
  }

  const listen = (event) => handle(event && typeof event === "object" && "data" in event ? event.data : event);
  if (typeof scope.addEventListener === "function") scope.addEventListener("message", listen);
  else scope.onmessage = listen;

  return { engine, handle };
}
