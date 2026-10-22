// Мост страницы к потоку имитации (таск 07 сценариев; истории 5.4, 7.5;
// «Решения по реализации» — Worker из Blob, один хозяин состояния).
//
// Поток поднимается из строки бандла (`SIM_WORKER_SOURCE`) через `Blob` и
// `URL.createObjectURL` — по `file://` это единственный путь (ADR 006 разрешает
// файлы рядом, но Worker из соседнего файла там не создаётся).
//
// ——— сторож ————————————————————————————————————————————————————————————————
//
// Раз в `SIM_BRIDGE_PULSE_MS` и после каждого сообщения мост шлёт `ping`.
// Нет `pong` дольше `SIM_BRIDGE_HANG_MS` — поток завис (`while(true)` в
// сценарии): мост его гасит (`terminate`), спрашивает хозяина, кто виноват
// (`onHang`), поднимает новый поток и кладёт в него `restore()` — зеркало
// страницы. Потом повторяет то, что старый поток так и не подтвердил
// (`SIM_BRIDGE_REPLAY`: действия человека, запуски, шаги), — со
// выключенным виновником остальные сценарии отрабатывают то же событие.
// Подсказку о виновнике поток шлёт сам перед кодом сценария (`trace`,
// `worker.js`); здесь она только запоминается до ближайшего `pong`.
//
// ——— запасной путь ——————————————————————————————————————————————————————————
//
// Нет Worker (конструктор бросает, бандла нет, поток не ответил на первый
// `ping`) — тот же `simWorkerMain` работает в странице на поддельном `scope`:
// сообщения ходят теми же копиями (`structuredClone`) и так же не сразу, но от
// зависания сценария страницу уже ничто не защищает. Об этом мост говорит
// один раз — `onPage()`, а `inPage` остаётся `true`.
import { SIM_WORKER_SOURCE } from "./workerSource.js";
import { simWorkerMain } from "./worker.js";

/** Пульс: как часто мост спрашивает поток, жив ли он, мс. */
export const SIM_BRIDGE_PULSE_MS = 1000;
/** Сколько ждать ответа, прежде чем считать поток зависшим, мс (история 5.4). */
export const SIM_BRIDGE_HANG_MS = 3000;
/** Как часто мост сверяет часы ожидания, мс. */
export const SIM_BRIDGE_CHECK_MS = 250;
/** Неподтверждённые сообщения, которые новый поток получает повторно. */
export const SIM_BRIDGE_REPLAY = Object.freeze(["act", "run", "active", "advance", "reset"]);

// Адрес бандла один на сеанс: из него же поднимаются перезапуски и пробы.
let simBridgeUrl = null;
let simBridgeUrlSource = null;

/** Поднять Worker из текста бандла через `Blob`; нечем — исключение. */
export function simBridgeSpawn(source) {
  const WorkerClass = globalThis.Worker;
  if (typeof source !== "string" || source === "") throw new Error("sim worker: no bundle");
  if (typeof WorkerClass !== "function" || typeof Blob !== "function" || typeof URL === "undefined" || typeof URL.createObjectURL !== "function") {
    throw new Error("sim worker: Worker is unavailable");
  }
  if (simBridgeUrlSource !== source) {
    simBridgeUrl = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
    simBridgeUrlSource = source;
  }
  return new WorkerClass(simBridgeUrl);
}

/** Часы и таймеры моста по умолчанию — настоящие. Тесты подставляют свои. */
export function simBridgeTimers() {
  return {
    now: () => Date.now(),
    setInterval: (fn, ms) => setInterval(fn, ms),
    clearInterval: (id) => clearInterval(id),
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (id) => clearTimeout(id),
    defer: (fn) => queueMicrotask(fn),
  };
}

function simBridgeClone(message) {
  return typeof structuredClone === "function" ? structuredClone(message) : JSON.parse(JSON.stringify(message));
}

/**
 * Мост: `createSimBridge({onMessage, onHang?, onPage?, restore?, source?,
 * spawn?, timers?, hangMs?, pulseMs?, checkMs?})` → `{post(message),
 * restart(), probe(messages, ms?), close(), inPage}`.
 *
 * - `onMessage(message)` — всё, что прислал поток, кроме служебных `pong` и
 *   `trace`;
 * - `onHang({trace, pending}) -> {replay?: false} | Promise<…>` — поток завис
 *   и уже погашен: `trace` — последняя подсказка потока (`{where,
 *   scenarioId?, bindingId?, bindingIds?, candidates?}` или `null`), `pending`
 *   — что он так и не подтвердил. Пока ответ не пришёл, новые сообщения ждут;
 *   `{replay: false}` — неподтверждённое не повторять;
 * - `onPage()` — движок ушёл в страницу (один раз);
 * - `restore() -> message[]` — чем поднять новый поток (часы, дом, запуск);
 * - `spawn(source) -> worker` — `{postMessage, terminate, addEventListener}`,
 *   бросает, если потока не будет.
 *
 * `probe(messages, ms)` — пробный поток: исполнить сообщения и ответить на
 * `ping`; `{ok: false, trace}` — не ответил за `ms`, `trace` — последняя его
 * подсказка. В странице проб нет — `{ok: true}`.
 */
export function createSimBridge(options = {}) {
  const given = options && typeof options === "object" ? options : {};
  const onMessage = typeof given.onMessage === "function" ? given.onMessage : null;
  const onHang = typeof given.onHang === "function" ? given.onHang : null;
  const onPage = typeof given.onPage === "function" ? given.onPage : null;
  const restore = typeof given.restore === "function" ? given.restore : null;
  const source = given.source === undefined ? SIM_WORKER_SOURCE : given.source;
  const spawn = typeof given.spawn === "function" ? given.spawn : simBridgeSpawn;
  const timers = given.timers && typeof given.timers === "object" ? given.timers : simBridgeTimers();
  const hangMs = Number.isFinite(given.hangMs) ? given.hangMs : SIM_BRIDGE_HANG_MS;
  const pulseMs = Number.isFinite(given.pulseMs) ? given.pulseMs : SIM_BRIDGE_PULSE_MS;
  const checkMs = Number.isFinite(given.checkMs) ? given.checkMs : SIM_BRIDGE_CHECK_MS;
  let worker = null;
  let page = null;
  let pageTold = false;
  let generation = 0;
  let started = false;
  let everStarted = false;
  let closed = false;
  let restarting = false;
  const buffer = [];
  let pending = [];
  let seq = 0;
  let pingN = 0;
  let outstanding = null;
  let lastPingAt = -Infinity;
  let pingQueued = false;
  let trace = null;
  let pulse = null;
  let lastCheckAt = timers.now();

  // ——— поток ————————————————————————————————————————————————————————————

  function receive(gen, data) {
    if (gen !== generation || closed || !data || typeof data !== "object") return;
    if (data.type === "pong") {
      pong(data.n);
      return;
    }
    if (data.type === "trace") {
      trace = typeof data.where === "string" ? data : null;
      return;
    }
    if (onMessage) onMessage(data);
  }

  function pong(n) {
    if (!outstanding || n !== outstanding.n) return;
    started = true;
    everStarted = true;
    const upTo = outstanding.seq;
    outstanding = null;
    trace = null;
    pending = pending.filter((item) => item.seq > upTo);
    if (pending.length > 0) ping();
  }

  function ping() {
    if (!worker || outstanding) return;
    pingN += 1;
    outstanding = { n: pingN, at: timers.now(), seq };
    lastPingAt = outstanding.at;
    worker.postMessage({ type: "ping", n: pingN });
  }

  function pingSoon() {
    if (pingQueued || outstanding) return;
    pingQueued = true;
    timers.defer(() => {
      pingQueued = false;
      if (!closed) ping();
    });
  }

  function check() {
    const now = timers.now();
    const gap = now - lastCheckAt;
    lastCheckAt = now;
    if (closed || restarting || !worker) return;
    // Страница сама стояла (тяжёлая отрисовка, выгрузка), и `pong` ещё не
    // разобран — это время потоку не в счёт, иначе живой поток погасили бы.
    if (outstanding && gap > checkMs * 4) outstanding.at += gap - checkMs;
    if (outstanding) {
      if (now - outstanding.at >= hangMs) hang();
      return;
    }
    if (now - lastPingAt >= pulseMs) ping();
  }

  function kill() {
    generation += 1;
    if (worker) {
      try {
        worker.terminate();
      } catch (ignored) {
        /* уже погашен */
      }
    }
    worker = null;
    outstanding = null;
    trace = null;
    pending = [];
    started = false;
  }

  function startWorker() {
    try {
      worker = spawn(source);
    } catch (error) {
      worker = null;
      return false;
    }
    const gen = generation;
    worker.addEventListener("message", (event) => receive(gen, event && event.data));
    worker.addEventListener("error", (event) => {
      if (gen !== generation || started || everStarted) return;
      // Поток не поднялся (бандл не разобрался, адрес запрещён) — в страницу.
      if (event && typeof event.preventDefault === "function") event.preventDefault();
      const replay = pending.map((item) => item.message);
      kill();
      toPage(replay);
    });
    // Первый `ping` уходит раньше всего: ответ на него — «бандл жив».
    ping();
    return true;
  }

  function hang() {
    const info = { trace, pending: pending.map((item) => item.message) };
    kill();
    if (!everStarted) {
      // Ни разу не ответил — это не зависание сценария, а поток, которого нет.
      toPage(info.pending);
      return;
    }
    restarting = true;
    Promise.resolve()
      .then(() => (onHang ? onHang(info) : null))
      .catch(() => null)
      .then((answer) => {
        if (closed) return;
        restarting = false;
        const replay = answer && answer.replay === false ? [] : info.pending.filter((message) => SIM_BRIDGE_REPLAY.includes(message.type));
        if (!startWorker()) {
          toPage([]);
        }
        refill(replay);
      });
  }

  function refill(replay) {
    for (const message of restore ? restore() : []) post(message);
    for (const message of replay) post(message);
    for (const message of buffer.splice(0)) post(message);
  }

  // ——— страница ——————————————————————————————————————————————————————————

  function toPage(replay) {
    stopPulse();
    const listeners = [];
    const scope = {
      postMessage: (message) => {
        const copy = simBridgeClone(message);
        timers.defer(() => {
          if (closed || page !== own) return;
          if (copy && (copy.type === "pong" || copy.type === "trace")) return;
          if (onMessage) onMessage(copy);
        });
      },
      addEventListener: (type, fn) => {
        if (type === "message") listeners.push(fn);
      },
      setTimeout: (fn, ms) => timers.setTimeout(fn, ms),
      clearTimeout: (id) => timers.clearTimeout(id),
      now: () => timers.now(),
    };
    const own = {
      send: (message) => {
        const copy = simBridgeClone(message);
        timers.defer(() => {
          if (closed || page !== own) return;
          for (const fn of listeners) fn({ data: copy });
        });
      },
    };
    page = own;
    simWorkerMain(scope);
    if (!pageTold) {
      pageTold = true;
      if (onPage) onPage();
    }
    for (const message of replay) own.send(message);
    for (const message of buffer.splice(0)) own.send(message);
  }

  function stopPulse() {
    if (pulse !== null) timers.clearInterval(pulse);
    pulse = null;
  }

  // ——— наружу ————————————————————————————————————————————————————————————

  function post(message) {
    if (closed || !message || typeof message !== "object") return;
    if (page) {
      page.send(message);
      return;
    }
    if (restarting || !worker) {
      buffer.push(message);
      return;
    }
    seq += 1;
    pending.push({ seq, message });
    worker.postMessage(message);
    pingSoon();
  }

  /** Перезапустить поток (или движок в странице) и положить в него `restore()`. */
  function restart() {
    if (closed) return;
    if (page) {
      page = null;
      toPage([]);
      refill([]);
      return;
    }
    kill();
    restarting = false;
    if (!startWorker()) toPage([]);
    refill([]);
  }

  function probe(messages, ms = hangMs) {
    if (page || closed) return Promise.resolve({ ok: true, trace: null });
    let scratch;
    try {
      scratch = spawn(source);
    } catch (error) {
      return Promise.resolve({ ok: true, trace: null });
    }
    return new Promise((resolve) => {
      let seen = null;
      let done = false;
      let timer = null;
      const finish = (ok) => {
        if (done) return;
        done = true;
        if (timer !== null) timers.clearTimeout(timer);
        try {
          scratch.terminate();
        } catch (ignored) {
          /* уже погашен */
        }
        resolve({ ok, trace: seen });
      };
      scratch.addEventListener("message", (event) => {
        const data = event && event.data;
        if (!data || typeof data !== "object") return;
        if (data.type === "trace") seen = typeof data.where === "string" ? data : null;
        else if (data.type === "pong" && data.n === "probe") finish(true);
      });
      scratch.addEventListener("error", () => finish(true));
      for (const message of Array.isArray(messages) ? messages : []) scratch.postMessage(message);
      scratch.postMessage({ type: "ping", n: "probe" });
      timer = timers.setTimeout(() => finish(false), ms);
    });
  }

  function close() {
    if (closed) return;
    closed = true;
    stopPulse();
    kill();
    page = null;
    buffer.length = 0;
  }

  if (startWorker()) pulse = timers.setInterval(check, checkMs);
  else toPage([]);

  return {
    post,
    restart,
    probe,
    close,
    get inPage() {
      return page !== null;
    },
    get restarting() {
      return restarting;
    },
  };
}
