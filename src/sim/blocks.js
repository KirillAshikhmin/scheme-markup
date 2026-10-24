// Блочные сценарии имитации умного дома (таск 05 сценариев; истории 2.4,
// 4.4–4.21, 4.23, 4.26; семантика — `research/spruthub-wiki.md` §2 и §7 с
// поправками заказчика G07 и G08).
//
// Чистый модуль: без DOM и без настоящего времени. Сценарии исполняет
// **хозяин блоков** — `blocksOwner()`, который подключается к движку через его
// дверь для хозяев (`createSimEngine({owners})`, `sim/engine.js`): подписки на
// характеристики, таймеры виртуального времени, запись значений с цепочкой
// причин, журнал. Условие-код и блок-код уходят исполнителю кода другого
// хозяина (`host.runCode`, его даёт эмуляция API хаба, таск 06).
//
// **Как сценарий запускается.**
// - Событие характеристики, на которой стоит условие с галкой «триггер», на
//   любом уровне дерева запускает **весь** сценарий со всеми проверками (G08):
//   блоки верхнего уровня идут по порядку, каждое «Если» проверяется заново.
//   Условие, чьё событие пришло, судится по новому значению, остальные — по
//   текущему состоянию; нажатие и «Изменено» истинны только в миг своего
//   события. Условие без галки только проверяется.
// - ∞ (G07) — только у числовых сравнений с галкой: включена (умолчание) —
//   каждое изменение значения запускает сценарий (истинно — «Тогда», ложно —
//   «Иначе»); выключена — запуск только на пересечении границы, в обе
//   стороны. Память последнего результата — у каждого условия.
// - Удержание «Более N» запускает сценарий, когда условие продержалось N;
//   «Менее N» — когда держалось меньше N и перестало (в этот миг оно истинно).
// - Планировщик — всегда триггер и истинен только в миг своего срабатывания;
//   «Каждые N» отсчитывается от запуска дома или ручного запуска сценария.
//   Период с галкой запускает сценарий на своих краях: в начале он истинен
//   («Тогда»), в конце ложен («Иначе»); без галки — «сейчас внутри».
// - Команда (G16, `{type: "command", id, text}`) — всегда триггер и истинна
//   только в миг своей команды (`act {kind: "command", text}`); тексты
//   сравниваются ключом `commandKey` — без регистра, «ё» = «е» (и латинская
//   «Ë»), лишние пробелы и знаки по краям не важны. В «Все сразу» остальные
//   условия проверяются по текущему состоянию. Пустой текст — неполный блок.
// - Ручной запуск, «Выполнить на старте» и запуск из другого сценария
//   проверяют условия по состоянию; планировщик и команда в них ложны.
// - Неактивный сценарий не запускается ничем; «Активировать» и
//   «Деактивировать» меняют только живое состояние имитации, не объект.
//
// **Неполный блок и удалённое устройство пропускаются** с записью в журнал:
// условие не участвует в «Одно из / Все сразу» (все пропущены — «Если»
// пропускается целиком), действие не выполняется, остальное идёт дальше.
//
// **Журнал** — записи хозяина с кодом строки `sim.journal.<code>` (тексты
// добавит экран журнала), у каждой `scenarioId`, у блочных — `blockId`, в
// `vars.name` — имя сценария:
//   `blockRun` (kind `run`) — сценарий запущен, `chain` — почему;
//   `blockCond` (kind `cond`, `result`) — условие или вложенная группа, у
//     условия по устройству ещё `markId, service, char`;
//   `blockIf` (kind `cond`, `result` — `true | false | null`) — итог «Если»;
//   `blockIncomplete` (kind `system`) и `blockDeviceMissing` (kind `error`,
//     `markId`) — блок пропущен;
//   `blockCodeError` (kind `error`, `vars.message`, `vars.line`, `reason`) —
//     код не исполнился;
//   `blockNotify` (kind `notify`, `vars.text`), `blockHttp` (kind `http`,
//     `vars.method`, `vars.url`) — уведомление и HTTP-запрос (в сеть ничего);
//   `blockScenarioMissing` (kind `error`, `targetId`) — нет такого сценария;
//   `blockNotActive` (kind `system`) — неактивный сценарий не запущен;
//   `blockActivated`, `blockDeactivated`, `blockReset` (kind `system`);
//   `blockLoop` (kind `error`, `vars.max`) — цепочка запусков длиннее
//     `SIM_CHAIN_MAX`, запуск оборван.
import { volumeClockParse } from "../clockMath.js";
import { simClamp } from "./catalog.js";
import { SIM_CHAIN_MAX } from "./engine.js";
import { periodContains, periodNextEdge, scheduleNextAt } from "./schedule.js";

/** Имя хозяина блочных сценариев в движке. */
export const BLOCKS_OWNER_NAME = "blocks";

const BLOCKS_OPS = new Set(["changed", "eq", "ne", "gt", "ge", "lt", "le"]);
const BLOCKS_ORDER_OPS = new Set(["gt", "ge", "lt", "le"]);
const BLOCKS_NUMBERS = new Set(["int", "float"]);
const BLOCKS_VERBS = new Set(["set", "invert", "increase", "setFrom"]);
const BLOCKS_SCENARIO_VERBS = new Set(["run", "activate", "activateRun", "deactivate", "reset"]);
const BLOCKS_SCHEDULE_MODES = new Set(["time", "every", "sunrise", "sunset"]);
const BLOCKS_HOLD_MODES = new Set(["more", "less"]);
// Таймеры сценария, которые «Сбросить» снимает до следующего запуска.
const BLOCKS_RESET_KINDS = new Set(["delay", "every", "tick"]);
// Таймеры, пока идут которые сценарий «выполняется».
const BLOCKS_WORK_KINDS = new Set(["delay", "every"]);

function blocksList(value) {
  return Array.isArray(value) ? value : [];
}

function blocksObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

/**
 * Ключ сравнения текста команды (G16): регистр не важен, «ё» и латинская «ë»
 * — это «е», пробелы внутри сводятся к одному, пробелы и знаки препинания по
 * краям отбрасываются. «Ëлочка гори!» и « ёлочка  ГОРИ » — одна команда
 * «елочка гори». Пусто — команды нет.
 */
export function commandKey(text) {
  if (text === null || text === undefined) return "";
  return String(text)
    .normalize("NFC")
    .toLowerCase()
    .replace(/[\u0451\u00eb]/g, "\u0435")
    .replace(/\s+/g, " ")
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
}

// Тексты условий «Команда» в дереве блоков — по порядку дерева.
function blocksCommandWalk(block, out) {
  if (!blocksObject(block)) return;
  if (block.type === "command") {
    if (typeof block.text === "string") out.push(block.text);
    return;
  }
  if (block.type === "group") {
    for (const item of blocksList(block.conditions)) blocksCommandWalk(item, out);
    return;
  }
  if (block.type === "if") {
    blocksCommandWalk(block.if, out);
    for (const item of blocksList(block.then)) blocksCommandWalk(item, out);
    for (const item of blocksList(block.else)) blocksCommandWalk(item, out);
    return;
  }
  if (block.type === "delay") for (const item of blocksList(block.blocks)) blocksCommandWalk(item, out);
}

/**
 * Тексты условий «Команда» блочного сценария (как набраны, без пустых) — для
 * списка кнопки «Выполнить команду» (G17, `simCommands`).
 */
export function blocksCommandTexts(scenario) {
  const out = [];
  for (const block of blocksList(scenario && scenario.targets)) blocksCommandWalk(block, out);
  return out.filter((item) => commandKey(item) !== "");
}

// Характеристика без состояния: нажатие и команда «только запись».
function blocksEventLike(meta) {
  return Boolean(meta) && (meta.format === "event" || (Array.isArray(meta.perms) && !meta.perms.includes("read")));
}

function blocksNumeric(meta, value) {
  return meta ? BLOCKS_NUMBERS.has(meta.format) : typeof value === "number";
}

/**
 * Можно ли условию ∞ (G07): только числовое сравнение — `>`, `≥`, `<`, `≤`, а
 * также `=` и `≠` у числовой характеристики. «Изменено», логика и
 * перечисления ∞ не имеют.
 */
export function blocksRepeatAllowed(condition, meta) {
  if (!condition || !meta || !BLOCKS_NUMBERS.has(meta.format)) return false;
  return BLOCKS_ORDER_OPS.has(condition.op) || condition.op === "eq" || condition.op === "ne";
}

// Значение условия или действия, приведённое к характеристике; `undefined` —
// не разобрать (перечисление без такой константы — неполный блок, а не догадка).
function blocksValueOf(meta, value) {
  if (value === undefined || value === null || value === "") return undefined;
  if (!meta) return value;
  if (meta.format === "enum" || meta.format === "event") {
    const values = meta.values || [];
    const byKey = values.find((item) => item.key === value);
    if (byKey) return byKey.key;
    const code = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
    const byCode = values.find((item) => item.code === code);
    return byCode ? byCode.key : undefined;
  }
  return simClamp(meta, value);
}

// Проверка значения условием `op value`; `null` — условие не собрать.
function blocksTest(block, meta) {
  const op = block.op;
  if (!BLOCKS_OPS.has(op)) return null;
  if (op === "changed") return () => true;
  if (blocksNumeric(meta, block.value)) {
    const target = block.value === null || block.value === "" ? NaN : Number(block.value);
    if (!Number.isFinite(target)) return null;
    switch (op) {
      case "eq":
        return (value) => Number(value) === target;
      case "ne":
        return (value) => Number(value) !== target;
      case "gt":
        return (value) => Number(value) > target;
      case "ge":
        return (value) => Number(value) >= target;
      case "lt":
        return (value) => Number(value) < target;
      default:
        return (value) => Number(value) <= target;
    }
  }
  if (BLOCKS_ORDER_OPS.has(op)) return null;
  const target = blocksValueOf(meta, block.value);
  if (target === undefined) return null;
  return op === "eq" ? (value) => value === target : (value) => value !== target;
}

function blocksDevices(home) {
  const devices = new Map();
  for (const accessory of blocksList(home && home.accessories)) {
    if (accessory && typeof accessory.markId === "string" && !devices.has(accessory.markId)) devices.set(accessory.markId, accessory);
  }
  return devices;
}

// Сервис устройства по ссылке блока: `{status: "ok", markId, service, type,
// chars}` · `{status: "incomplete"}` (места нет или это пустое место заготовки)
// · `{status: "missing", markId}` (метки или сервиса больше нет).
function blocksService(devices, ref) {
  const given = blocksObject(ref);
  if (!given || typeof given.markId !== "string" || !given.markId || !Number.isInteger(given.service) || given.service < 0) {
    return { status: "incomplete" };
  }
  const accessory = devices.get(given.markId);
  const service = accessory ? blocksList(accessory.services)[given.service] : null;
  if (!service) return { status: "missing", markId: given.markId };
  return { status: "ok", markId: given.markId, service: given.service, type: service.type, chars: blocksList(service.chars) };
}

// Характеристика по ссылке: сервис плюс `char` и её метаданные.
function blocksChar(devices, ref, char) {
  const found = blocksService(devices, ref);
  if (found.status !== "ok") return found;
  if (typeof char !== "string" || !char) return { status: "incomplete" };
  const slot = found.chars.find((item) => item && item.type === char);
  if (!slot) return { status: "missing", markId: found.markId };
  return { ...found, char, meta: slot.meta || null };
}

// ——— сборка сценария ————————————————————————————————————————————————————————

function blocksNote(compiled, block, info) {
  compiled.info.set(block, info);
  if (info.status === "incomplete" || info.status === "missing") {
    compiled.issues.push({ blockId: block.id ?? null, code: info.status === "missing" ? "deviceMissing" : "incomplete" });
  }
  return info;
}

function blocksKeyOf(compiled) {
  compiled.counter += 1;
  return compiled.id + "#" + compiled.counter;
}

function blocksDeviceCondition(compiled, devices, block) {
  const ref = blocksObject(block.ref);
  const found = blocksChar(devices, ref, ref ? ref.char : null);
  const info = { kind: "device", block, key: blocksKeyOf(compiled), status: found.status, markId: found.markId || null };
  if (found.status !== "ok") return blocksNote(compiled, block, info);
  const test = blocksTest(block, found.meta);
  if (!test) return blocksNote(compiled, block, { ...info, status: "incomplete" });
  const eventOnly = block.op === "changed" || blocksEventLike(found.meta);
  const hold = blocksObject(block.hold);
  const sec = hold ? Number(hold.sec) : NaN;
  const held = !eventOnly && hold && BLOCKS_HOLD_MODES.has(hold.mode) && sec > 0 ? { mode: hold.mode, ms: sec * 1000 } : null;
  const trigger = block.trigger === true;
  Object.assign(info, {
    service: found.service,
    char: found.char,
    meta: found.meta,
    test,
    eventOnly,
    trigger,
    hold: held,
    edge: trigger && !held && block.repeat === false && blocksRepeatAllowed(block, found.meta),
  });
  if (trigger || held) {
    const key = found.markId + "|" + found.service + "|" + found.char;
    if (!compiled.keys.has(key)) compiled.keys.set(key, { markId: found.markId, service: found.service, char: found.char, conditions: [] });
    compiled.keys.get(key).conditions.push(info);
  }
  return blocksNote(compiled, block, info);
}

function blocksScheduleOk(block) {
  if (!BLOCKS_SCHEDULE_MODES.has(block.mode)) return false;
  if (block.mode === "time") return volumeClockParse(block.at) !== null;
  if (block.mode === "every") return Number(block.everySec) > 0;
  return true;
}

function blocksWalkCondition(compiled, devices, block) {
  if (!blocksObject(block)) return;
  const key = blocksKeyOf(compiled);
  switch (block.type) {
    case "group":
      compiled.info.set(block, { kind: "group", block, key, status: "ok" });
      for (const item of blocksList(block.conditions)) blocksWalkCondition(compiled, devices, item);
      return;
    case "device":
      blocksDeviceCondition(compiled, devices, block);
      return;
    case "schedule": {
      const info = blocksNote(compiled, block, { kind: "schedule", block, key, status: blocksScheduleOk(block) ? "ok" : "incomplete" });
      if (info.status === "ok") compiled.schedules.push(info);
      return;
    }
    case "period": {
      const ok = volumeClockParse(block.from) !== null && volumeClockParse(block.to) !== null;
      const info = blocksNote(compiled, block, { kind: "period", block, key, status: ok ? "ok" : "incomplete" });
      if (ok && block.trigger === true) compiled.periods.push(info);
      return;
    }
    case "code":
      blocksNote(compiled, block, { kind: "code", block, key, status: typeof block.code === "string" && block.code.trim() ? "ok" : "incomplete" });
      return;
    case "command": {
      const said = commandKey(block.text);
      const info = blocksNote(compiled, block, { kind: "command", block, key, status: said ? "ok" : "incomplete", command: said });
      if (info.status === "ok") compiled.commands.push(info);
      return;
    }
    default:
      blocksNote(compiled, block, { kind: "unknown", block, key, status: "incomplete" });
  }
}

function blocksItem(devices, found, item) {
  const given = blocksObject(item);
  if (!given || !BLOCKS_VERBS.has(given.verb)) return { status: "incomplete" };
  const slot = found.chars.find((char) => char && char.type === given.char);
  if (typeof given.char !== "string" || !given.char) return { status: "incomplete" };
  if (!slot) return { status: "missing" };
  const meta = slot.meta || null;
  const out = { status: "ok", char: given.char, verb: given.verb, meta };
  switch (given.verb) {
    case "set": {
      const value = blocksValueOf(meta, given.value);
      return value === undefined ? { status: "incomplete" } : { ...out, value };
    }
    case "invert": {
      const two = meta && meta.format === "enum" && Array.isArray(meta.values) && meta.values.length === 2;
      const span = meta && BLOCKS_NUMBERS.has(meta.format) && meta.min !== null && meta.max !== null;
      return !meta || meta.format === "bool" || two || span ? out : { status: "incomplete" };
    }
    case "increase": {
      if (!meta || !BLOCKS_NUMBERS.has(meta.format)) return { status: "incomplete" };
      const own = Number(given.step);
      const step = given.step !== undefined && given.step !== null && given.step !== "" && Number.isFinite(own) ? own : meta.step || 1;
      return { ...out, step };
    }
    default: {
      const from = blocksObject(given.from);
      const source = blocksChar(devices, from, from ? from.char : null);
      if (source.status !== "ok") return { status: source.status };
      if (blocksEventLike(source.meta)) return { status: "incomplete" };
      return { ...out, from: source };
    }
  }
}

function blocksDeviceAction(compiled, devices, block) {
  const found = blocksService(devices, block.ref);
  const info = { kind: "device", block, key: blocksKeyOf(compiled), status: found.status, markId: found.markId || null, items: [] };
  if (found.status !== "ok") return blocksNote(compiled, block, info);
  info.service = found.service;
  info.items = blocksList(block.items).map((item) => blocksItem(devices, found, item));
  const bad = info.items.find((item) => item.status !== "ok");
  if (info.items.length === 0) info.status = "incomplete";
  else if (bad) info.status = bad.status;
  return blocksNote(compiled, block, info);
}

function blocksWalkActions(compiled, devices, blocks) {
  for (const block of blocksList(blocks)) {
    if (!blocksObject(block)) continue;
    const key = () => blocksKeyOf(compiled);
    switch (block.type) {
      case "if":
        compiled.info.set(block, { kind: "if", block, key: key(), status: "ok" });
        if (blocksObject(block.if)) blocksWalkCondition(compiled, devices, block.if);
        blocksWalkActions(compiled, devices, block.then);
        blocksWalkActions(compiled, devices, block.else);
        break;
      case "device":
        blocksDeviceAction(compiled, devices, block);
        break;
      case "delay": {
        const sec = block.sec === null || block.sec === "" ? NaN : Number(block.sec);
        const info = blocksNote(compiled, block, { kind: "delay", block, key: key(), status: Number.isFinite(sec) && sec >= 0 ? "ok" : "incomplete" });
        if (info.status === "ok") compiled.delays.push(info);
        blocksWalkActions(compiled, devices, block.blocks);
        break;
      }
      case "resetDelay": {
        const all = block.no === null || block.no === undefined;
        blocksNote(compiled, block, { kind: "resetDelay", block, key: key(), status: all || Number.isFinite(Number(block.no)) ? "ok" : "incomplete" });
        break;
      }
      case "scenario": {
        const ok = BLOCKS_SCENARIO_VERBS.has(block.verb) && typeof block.scenarioId === "string" && block.scenarioId !== "";
        blocksNote(compiled, block, { kind: "scenario", block, key: key(), status: ok ? "ok" : "incomplete" });
        break;
      }
      case "code":
        blocksNote(compiled, block, { kind: "code", block, key: key(), status: typeof block.code === "string" && block.code.trim() ? "ok" : "incomplete" });
        break;
      case "notify":
        blocksNote(compiled, block, { kind: "notify", block, key: key(), status: "ok" });
        break;
      case "http":
        blocksNote(compiled, block, { kind: "http", block, key: key(), status: typeof block.url === "string" && block.url.trim() ? "ok" : "incomplete" });
        break;
      default:
        blocksNote(compiled, block, { kind: "unknown", block, key: key(), status: "incomplete" });
    }
  }
}

/**
 * Сценарий, собранный к исполнению на доме `home` (`buildHomeSpec` или
 * `spec` движка): `{id, name, order, active, onStart, sequential, targets,
 * info: Map<блок, сведения>, keys: Map<"markId|service|char", {markId,
 * service, char, conditions}>, schedules, periods, delays, commands, issues}`;
 * `commands` — условия «Команда» с ключом `command` (`commandKey`).
 * `issues` — `[{blockId, code: "incomplete" | "deviceMissing"}]` в порядке
 * дерева: что при исполнении будет пропущено.
 */
export function blocksPrepare(scenario, home) {
  const source = blocksObject(scenario) || {};
  const compiled = {
    id: typeof source.id === "string" ? source.id : "",
    name: typeof source.name === "string" ? source.name : "",
    order: Number.isFinite(source.order) ? source.order : 0,
    active: source.active !== false,
    onStart: source.onStart === true,
    sequential: source.sequential === true,
    targets: blocksList(source.targets),
    info: new Map(),
    keys: new Map(),
    schedules: [],
    periods: [],
    delays: [],
    commands: [],
    issues: [],
    counter: 0,
  };
  blocksWalkActions(compiled, blocksDevices(home), compiled.targets);
  return compiled;
}

// ——— хозяин ————————————————————————————————————————————————————————————————

/**
 * Хозяин блочных сценариев для двери движка: `createSimEngine({emit, owners:
 * [hub, blocksOwner()]})`. Каждый вызов — свой хозяин со своей памятью.
 */
export function blocksOwner() {
  let compiled = [];
  const byId = new Map();
  // Живое по сценарию, переживает перестройку дома: `override` — «Активный»,
  // изменённый имитацией (`{on, base}`), `anchor` — откуда считать «Каждые N».
  const lives = new Map();
  // Таймеры хозяина по меткам: `tag → {scenarioId, kind, ids}`.
  const tags = new Map();

  function liveOf(id) {
    if (!lives.has(id)) lives.set(id, { override: null, anchor: null });
    return lives.get(id);
  }

  function isActive(sc) {
    const live = lives.get(sc.id);
    return live && live.override ? live.override.on : sc.active;
  }

  function running(id) {
    for (const record of tags.values()) {
      if (record.scenarioId === id && BLOCKS_WORK_KINDS.has(record.kind) && record.ids.size > 0) return true;
    }
    return false;
  }

  function log(host, sc, entry) {
    host.log({ scenarioId: sc.id, ...entry, vars: { name: sc.name, ...(entry.vars || {}) } });
  }

  function link(sc, block) {
    return { k: "scenario", scenarioId: sc.id, blockId: block.id ?? null };
  }

  // ——— таймеры ——————————————————————————————————————————————————————————

  function arm(host, sc, tag, kind, at, fn) {
    let id = null;
    const record = tags.get(tag) || { scenarioId: sc.id, kind, ids: new Set() };
    id = host.timer(at, (when) => {
      record.ids.delete(id);
      if (record.ids.size === 0 && tags.get(tag) === record) tags.delete(tag);
      if (BLOCKS_WORK_KINDS.has(kind)) host.scenariosChanged();
      fn(when);
    }, tag);
    if (id === null) return;
    record.ids.add(id);
    tags.set(tag, record);
    if (BLOCKS_WORK_KINDS.has(kind)) host.scenariosChanged();
  }

  function disarm(host, tag) {
    const record = tags.get(tag);
    if (!record) return;
    host.cancelTimers(tag);
    tags.delete(tag);
    if (BLOCKS_WORK_KINDS.has(record.kind)) host.scenariosChanged();
  }

  function disarmScenario(host, sc, kinds) {
    for (const [tag, record] of [...tags]) {
      if (record.scenarioId === sc.id && kinds.has(record.kind)) disarm(host, tag);
    }
  }

  // ——— запуск ———————————————————————————————————————————————————————————

  function launch(host, sc, source, chain) {
    if (chain.length > SIM_CHAIN_MAX) {
      log(host, sc, { kind: "error", code: "blockLoop", chain, vars: { max: SIM_CHAIN_MAX } });
      return;
    }
    log(host, sc, { kind: "run", code: "blockRun", chain });
    perform(host, sc, sc.targets, { source, chain });
  }

  function skip(host, sc, block, info, run) {
    const missing = info && info.status === "missing";
    const entry = {
      kind: missing ? "error" : "system",
      code: missing ? "blockDeviceMissing" : "blockIncomplete",
      blockId: block.id ?? null,
      chain: run.chain,
    };
    if (missing && info.markId) entry.markId = info.markId;
    log(host, sc, entry);
  }

  function perform(host, sc, blocks, run) {
    for (const block of blocksList(blocks)) {
      if (!blocksObject(block)) continue;
      const info = sc.info.get(block);
      if (!info || info.status !== "ok") {
        skip(host, sc, block, info, run);
        continue;
      }
      switch (info.kind) {
        case "if":
          doIf(host, sc, block, info, run);
          break;
        case "device":
          doDevice(host, sc, block, info, run);
          break;
        case "delay":
          doDelay(host, sc, block, info, run);
          break;
        case "resetDelay":
          for (const delay of sc.delays) {
            if (block.no === null || block.no === undefined || Number(delay.block.no) === Number(block.no)) disarm(host, delay.key + "|delay");
          }
          break;
        case "scenario":
          doScenario(host, sc, block, run);
          break;
        case "code": {
          const result = runCode(host, sc, block, "action", run);
          if (!result.ok) codeError(host, sc, block, result, run);
          break;
        }
        case "notify":
          log(host, sc, {
            kind: "notify",
            code: "blockNotify",
            blockId: block.id ?? null,
            chain: run.chain,
            vars: { text: typeof block.text === "string" ? block.text : "" },
          });
          break;
        case "http":
          log(host, sc, {
            kind: "http",
            code: "blockHttp",
            blockId: block.id ?? null,
            chain: run.chain,
            vars: { method: typeof block.method === "string" && block.method ? block.method : "GET", url: block.url },
          });
          break;
        default:
          break;
      }
    }
  }

  function doIf(host, sc, block, info, run) {
    const result = blocksObject(block.if) ? evalGroup(host, sc, block.if, run) : true;
    log(host, sc, { kind: "cond", code: "blockIf", blockId: block.id ?? null, result, chain: run.chain });
    if (result === true) {
      perform(host, sc, block.then, run);
      const every = blocksObject(block.every);
      const sec = every ? Number(every.sec) : NaN;
      if (sec > 0) loop(host, sc, block, info, sec * 1000, run.chain);
    } else if (result === false) {
      perform(host, sc, block.else, run);
    }
  }

  // «Тогда — каждые N»: повторять «Тогда» до «Сбросить» сценария.
  function loop(host, sc, block, info, stepMs, chain) {
    const tag = info.key + "|every";
    disarm(host, tag);
    const tick = (at) =>
      arm(host, sc, tag, "every", at, (when) => {
        // Сначала следующий круг: «Сбросить» внутри «Тогда» снимет и его.
        tick(when + stepMs);
        const timer = { k: "timer", at: when, what: "every", scenarioId: sc.id, blockId: block.id ?? null };
        perform(host, sc, block.then, { source: {}, chain: [timer, ...chain] });
      });
    tick(host.now() + stepMs);
  }

  function doDelay(host, sc, block, info, run) {
    const tag = info.key + "|delay";
    if (block.timer !== "new") disarm(host, tag);
    const chain = run.chain;
    arm(host, sc, tag, "delay", host.now() + Number(block.sec) * 1000, (when) => {
      const timer = { k: "timer", at: when, what: "delay", scenarioId: sc.id, blockId: block.id ?? null };
      perform(host, sc, block.blocks, { source: {}, chain: [timer, ...chain] });
    });
  }

  function itemValue(host, info, item) {
    const current = host.value(info.markId, info.service, item.char);
    const meta = item.meta;
    switch (item.verb) {
      case "set":
        return item.value;
      case "invert":
        if (!meta || meta.format === "bool") return current !== true;
        if (meta.format === "enum") return meta.values[0].key === current ? meta.values[1].key : meta.values[0].key;
        return meta.min + meta.max - (Number(current) || 0);
      case "increase":
        return (Number(current) || 0) + item.step;
      default:
        return host.value(item.from.markId, item.from.service, item.from.char);
    }
  }

  function doDevice(host, sc, block, info, run) {
    const chain = [link(sc, block), ...run.chain];
    for (const item of info.items) {
      const value = itemValue(host, info, item);
      if (value === undefined) continue;
      host.write({ markId: info.markId, service: info.service, char: item.char, value, chain });
    }
  }

  function doScenario(host, sc, block, run) {
    const chain = [link(sc, block), ...run.chain];
    const target = block.scenarioId;
    let found;
    switch (block.verb) {
      case "run":
        found = host.runScenario(target, chain);
        break;
      case "activate":
        found = host.setScenarioActive(target, true);
        break;
      case "activateRun":
        found = host.setScenarioActive(target, true) && host.runScenario(target, chain);
        break;
      case "deactivate":
        found = host.setScenarioActive(target, false);
        break;
      default:
        found = host.resetScenario(target);
        break;
    }
    if (!found) log(host, sc, { kind: "error", code: "blockScenarioMissing", blockId: block.id ?? null, targetId: target, chain: run.chain });
  }

  function runCode(host, sc, block, kind, run) {
    const chain = [link(sc, block), ...run.chain];
    const result = host.runCode({ kind, code: block.code, scenarioId: sc.id, blockId: block.id ?? null, chain });
    return result && typeof result === "object" ? result : { ok: false, error: null, line: null };
  }

  function codeError(host, sc, block, result, run) {
    const entry = {
      kind: "error",
      code: "blockCodeError",
      blockId: block.id ?? null,
      chain: run.chain,
      vars: { message: result.error ?? null, line: result.line ?? null },
    };
    if (typeof result.code === "string") entry.reason = result.code;
    log(host, sc, entry);
  }

  // ——— условия ——————————————————————————————————————————————————————————

  // `true | false | null` (`null` — пропущено: неполное или устройства нет).
  function evalGroup(host, sc, group, run) {
    const items = blocksList(group.conditions);
    if (items.length === 0) return true;
    const results = [];
    for (const item of items) {
      const result = evalCondition(host, sc, item, run);
      if (result !== null) results.push(result);
    }
    if (results.length === 0) return null;
    return group.mode === "AND" ? results.every(Boolean) : results.some(Boolean);
  }

  function evalCondition(host, sc, block, run) {
    if (!blocksObject(block)) return null;
    const info = sc.info.get(block);
    if (!info || info.status !== "ok") {
      skip(host, sc, block, info, run);
      return null;
    }
    let result;
    switch (info.kind) {
      case "group":
        result = evalGroup(host, sc, block, run);
        if (result === null) return null;
        break;
      case "device":
        result = evalDevice(host, sc, info, run.source);
        break;
      case "schedule":
        result = run.source.schedule === info;
        break;
      case "command":
        result = run.source.command === info.command;
        break;
      case "period":
        result = periodContains(block, host.now());
        break;
      default: {
        const done = runCode(host, sc, block, "condition", run);
        result = done.ok ? Boolean(done.value) : false;
        if (!done.ok) codeError(host, sc, block, done, run);
        break;
      }
    }
    const entry = { kind: "cond", code: "blockCond", blockId: block.id ?? null, result, chain: run.chain };
    if (info.kind === "device") Object.assign(entry, { markId: info.markId, service: info.service, char: info.char });
    log(host, sc, entry);
    return result;
  }

  function evalDevice(host, sc, info, source) {
    const event = source.event;
    const own = event && event.markId === info.markId && event.service === info.service && event.char === info.char ? event : null;
    if (info.hold) {
      if (info.hold.mode === "less") return Boolean(own && source.released && source.released.has(info));
      const state = sc.holds.get(info);
      return Boolean(state && state.on && host.now() - state.since >= info.hold.ms);
    }
    if (info.eventOnly) return own ? Boolean(info.test(own.value)) : false;
    return Boolean(info.test(own ? own.value : host.value(info.markId, info.service, info.char)));
  }

  // ——— события, удержание, время ————————————————————————————————————————————

  function holdStep(host, sc, info, event, released) {
    const state = sc.holds.get(info) || { on: false, since: null };
    sc.holds.set(info, state);
    const on = Boolean(info.test(event.value));
    if (on && !state.on) {
      state.on = true;
      state.since = event.at;
      if (info.hold.mode === "more" && info.trigger) armHold(host, sc, info, event.at + info.hold.ms, event.chain);
    } else if (!on && state.on) {
      const held = event.at - state.since;
      state.on = false;
      state.since = null;
      disarm(host, info.key + "|hold");
      if (info.hold.mode === "less" && held < info.hold.ms) released.add(info);
    }
  }

  function armHold(host, sc, info, at, chain) {
    arm(host, sc, info.key + "|hold", "hold", at, (when) => {
      const state = sc.holds.get(info);
      if (!state || !state.on || !isActive(sc)) return;
      const timer = { k: "timer", at: when, what: "hold", scenarioId: sc.id, blockId: info.block.id ?? null };
      launch(host, sc, {}, [timer, ...chain]);
    });
  }

  function onEvent(host, sc, key, event) {
    const released = new Set();
    for (const info of key.conditions) if (info.hold) holdStep(host, sc, info, event, released);
    let fire = false;
    for (const info of key.conditions) {
      if (!info.trigger) continue;
      if (info.hold) {
        if (info.hold.mode === "less" && released.has(info)) fire = true;
        continue;
      }
      if (info.edge) {
        const now = Boolean(info.test(event.value));
        const before = sc.memory.has(info) ? sc.memory.get(info) : Boolean(info.test(event.from));
        sc.memory.set(info, now);
        if (now !== before) fire = true;
        continue;
      }
      fire = true;
    }
    if (fire && isActive(sc)) launch(host, sc, { event, released }, event.chain);
  }

  // Память ∞ и удержания — от текущего состояния дома.
  function seed(host, sc, chain) {
    sc.memory.clear();
    sc.holds.clear();
    for (const key of sc.keys.values()) {
      const current = host.value(key.markId, key.service, key.char);
      for (const info of key.conditions) {
        if (info.edge) sc.memory.set(info, Boolean(info.test(current)));
        if (!info.hold) continue;
        const on = Boolean(info.test(current));
        sc.holds.set(info, { on, since: on ? host.now() : null });
        if (on && info.hold.mode === "more" && info.trigger) armHold(host, sc, info, host.now() + info.hold.ms, chain);
      }
    }
  }

  function armSchedule(host, sc, info) {
    const tag = info.key + "|schedule";
    disarm(host, tag);
    const every = info.block.mode === "every";
    const anchor = liveOf(sc.id).anchor;
    const at = scheduleNextAt(info.block, host.now(), host.site(), every && Number.isFinite(anchor) ? anchor : host.now());
    if (at === null) return;
    arm(host, sc, tag, every ? "tick" : "schedule", at, (when) => {
      armSchedule(host, sc, info);
      if (!isActive(sc)) return;
      const timer = { k: "timer", at: when, what: "schedule", scenarioId: sc.id, blockId: info.block.id ?? null };
      launch(host, sc, { schedule: info }, [timer]);
    });
  }

  function armPeriod(host, sc, info) {
    const tag = info.key + "|period";
    disarm(host, tag);
    const edge = periodNextEdge(info.block, host.now());
    if (!edge) return;
    arm(host, sc, tag, "period", edge.at, (when) => {
      armPeriod(host, sc, info);
      if (!isActive(sc)) return;
      const timer = { k: "timer", at: when, what: "period", edge: edge.edge, scenarioId: sc.id, blockId: info.block.id ?? null };
      launch(host, sc, { period: info }, [timer]);
    });
  }

  function armTime(host, sc, everyOnly) {
    for (const info of sc.schedules) {
      if (!everyOnly || info.block.mode === "every") armSchedule(host, sc, info);
    }
    if (!everyOnly) for (const info of sc.periods) armPeriod(host, sc, info);
  }

  // ——— дверь движка ———————————————————————————————————————————————————————

  return {
    name: BLOCKS_OWNER_NAME,
    kinds: ["block"],
    load(home) {
      tags.clear();
      compiled = blocksList(home && home.scenarios)
        .map((scenario, index) => ({ scenario, index }))
        .filter(({ scenario }) => scenario && scenario.kind === "block" && typeof scenario.id === "string")
        .sort((a, b) => {
          const first = Number.isFinite(a.scenario.order) ? a.scenario.order : a.index;
          const second = Number.isFinite(b.scenario.order) ? b.scenario.order : b.index;
          return first === second ? a.index - b.index : first - second;
        })
        .map(({ scenario }) => ({ ...blocksPrepare(scenario, home), memory: new Map(), holds: new Map() }));
      byId.clear();
      for (const sc of compiled) if (!byId.has(sc.id)) byId.set(sc.id, sc);
      for (const [id, live] of [...lives]) {
        const sc = byId.get(id);
        if (!sc) lives.delete(id);
        else if (live.override && (live.override.base !== sc.active || live.override.on === sc.active)) live.override = null;
      }
    },
    start({ reload, restored, chain }, host) {
      for (const sc of compiled) {
        for (const key of sc.keys.values()) {
          host.subscribe({ markId: key.markId, service: key.service, char: key.char }, (event) => onEvent(host, sc, key, event));
        }
        seed(host, sc, chain);
        const live = liveOf(sc.id);
        if (!reload || !Number.isFinite(live.anchor)) live.anchor = host.now();
        armTime(host, sc, false);
      }
      // Перезапуск потока сторожем (`restored`) — не старт хаба: дом уже шёл,
      // и «Выполнить на старте» второй раз не срабатывает.
      if (reload || restored) return;
      for (const sc of compiled) if (sc.onStart && isActive(sc)) launch(host, sc, {}, chain);
    },
    stop() {
      tags.clear();
      for (const sc of compiled) {
        sc.memory.clear();
        sc.holds.clear();
      }
    },
    reset({ chain }, host) {
      tags.clear();
      for (const sc of compiled) {
        const live = liveOf(sc.id);
        live.override = null;
        live.anchor = host.now();
        seed(host, sc, chain);
        armTime(host, sc, false);
      }
      host.scenariosChanged();
    },
    run(id, { chain }, host) {
      const sc = byId.get(id);
      if (!sc) return;
      const given = Array.isArray(chain) ? chain : [];
      if (!isActive(sc)) {
        log(host, sc, { kind: "system", code: "blockNotActive", chain: given });
        return;
      }
      // «Каждые N» считаются заново от ручного запуска (и запуска из сценария).
      liveOf(sc.id).anchor = host.now();
      armTime(host, sc, true);
      launch(host, sc, {}, given);
    },
    setActive(id, on, host) {
      const sc = byId.get(id);
      if (!sc || isActive(sc) === on) return;
      const live = liveOf(id);
      live.override = on === sc.active ? null : { on, base: sc.active };
      log(host, sc, { kind: "system", code: on ? "blockActivated" : "blockDeactivated" });
      host.scenariosChanged();
    },
    resetScenario(id, host) {
      const sc = byId.get(id);
      if (!sc) return;
      disarmScenario(host, sc, BLOCKS_RESET_KINDS);
      log(host, sc, { kind: "system", code: "blockReset" });
      host.scenariosChanged();
    },
    clock(info, host) {
      for (const sc of compiled) armTime(host, sc, false);
    },
    // Команда (G16): запускает каждый сценарий, где есть условие с той же
    // командой; неактивный — отказом `blockNotActive`. Ответ — сколько
    // сценариев её поняли (ноль — движок запишет `commandUnknown`).
    command({ text, chain }, host) {
      const said = commandKey(text);
      if (!said) return 0;
      const given = Array.isArray(chain) ? chain : [];
      let heard = 0;
      for (const sc of compiled) {
        if (!sc.commands.some((info) => info.command === said)) continue;
        heard += 1;
        if (!isActive(sc)) {
          log(host, sc, { kind: "system", code: "blockNotActive", chain: given });
          continue;
        }
        launch(host, sc, { command: said }, given);
      }
      return heard;
    },
    scenarios() {
      return compiled.map((sc) => ({ id: sc.id, active: isActive(sc), running: running(sc.id), fault: null }));
    },
  };
}
