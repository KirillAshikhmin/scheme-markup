// Дерево блочного сценария: правка, фраза-описание, проблемы и заготовки
// (таск 10 сценариев; истории 4.3, 4.21, 4.24, 4.25, 4.31).
//
// Модуль чистый и работает над **значением сценария**, а не над объектом:
// каждая правка возвращает новый сценарий, а правка, которой нечего менять
// (нет такого блока, слот не подходит), — **тот же** сценарий по ссылке, как
// команды модели. В объект сценарий кладёт панель: через `updateScenario` и
// `canvasCommit`, то есть шагом истории.
//
// Объект нужен читателям только затем, чтобы назвать метку (`labelOf`) и
// проверить, что устройство ещё есть. Метаданные характеристик (формат,
// единицы) берутся из словаря `SIM_CHARS` по типу — они у типа одни на всех.
//
// Правило ∞ одно на всю сборку — у движка (`blocksRepeatAllowed`); здесь оно
// только проброшено, второго не заводится. Проблемы `incomplete` и
// `deviceMissing` приносит та же сборка сценария, что исполняет его
// (`blocksPrepare`): что редактор красит красным, то движок и пропустит.
import { findMark, findScenario, labelOf } from "./model.js";
import { blocksPrepare, blocksRepeatAllowed } from "./sim/blocks.js";
import { simCharMeta } from "./sim/catalog.js";
import { homeAccessories, homeLeadScenario } from "./sim/home.js";
import { strings, text } from "./strings.js";

// ——— идентификаторы и новые блоки ————————————————————————————————————

let scenarioIdCounter = 0;

/** Новый идентификатор блока: у каждого блока свой, по нему правят и подсвечивают. */
export function scenarioNewId() {
  const source = typeof globalThis !== "undefined" ? globalThis.crypto : null;
  if (source && typeof source.randomUUID === "function") return source.randomUUID();
  scenarioIdCounter += 1;
  return "b" + Date.now().toString(36) + "-" + scenarioIdCounter;
}

const SCENARIO_ALL_DAYS = [1, 2, 3, 4, 5, 6, 7];

/**
 * Пустой сценарий вида `block | logic | global` — то, что отдают в
 * `addScenario`. Имя — «Новый сценарий»; id и порядок даёт модель.
 */
export function scenarioBlank(kind = "block") {
  const base = {
    kind,
    name: strings.sim.scenarioUntitled,
    active: true,
    onStart: false,
    sequential: false,
    description: "",
  };
  if (kind === "block") return { ...base, targets: [] };
  return { ...base, source: "", origin: "js", fileName: "" };
}

/**
 * Новый блок вида `type` с умолчаниями и своим id; `props` перекрывают
 * умолчания. Ссылки на устройства пустые — блок неполный, пока их не заполнят.
 */
export function scenarioNewBlock(type, props = {}) {
  const id = scenarioNewId();
  let block;
  switch (type) {
    case "if":
      block = { type, id, if: scenarioNewBlock("group"), then: [], else: null, every: null };
      break;
    case "group":
      block = { type, id, mode: "OR", conditions: [] };
      break;
    case "device":
      // Условие и действие различает набор полей: у действия — `items`.
      block = props.items ? { type, id, ref: {}, items: [] } : { type, id, ref: {}, op: "eq", trigger: false };
      break;
    case "schedule":
      block = { type, id, mode: "time", days: [...SCENARIO_ALL_DAYS], at: "07:00" };
      break;
    case "period":
      block = { type, id, days: [...SCENARIO_ALL_DAYS], from: "22:00", to: "06:00", trigger: false };
      break;
    case "code":
      block = { type, id, code: "" };
      break;
    case "command":
      block = { type, id, text: "" };
      break;
    case "delay":
      block = { type, id, no: 1, sec: 60, timer: "one", blocks: [] };
      break;
    case "resetDelay":
      block = { type, id, no: null };
      break;
    case "scenario":
      block = { type, id, verb: "run", scenarioId: "" };
      break;
    case "notify":
      block = { type, id, text: "" };
      break;
    case "http":
      block = { type, id, method: "GET", url: "" };
      break;
    default:
      block = { type, id };
  }
  return { ...block, ...props };
}

// ——— обход и правка дерева ——————————————————————————————————————————

function treeObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function treeList(value) {
  return Array.isArray(value) ? value : [];
}

// Слоты-списки блока: куда в него можно класть детей.
const SCENARIO_TREE_LISTS = { if: ["then", "else"], group: ["conditions"], delay: ["blocks"] };

// Обход: `visit(block, {owner, parentId, slot, list, index})`, `true` — стоп.
// `list` — массив, в котором лежит блок (`null` у группы условий «Если»: она
// одна и не в списке); `owner` — блок-родитель (`null` у корня).
function treeWalk(list, owner, slot, visit) {
  const parentId = owner ? owner.id : null;
  for (let index = 0; index < list.length; index += 1) {
    const block = list[index];
    if (!treeObject(block)) continue;
    if (visit(block, { owner, parentId, slot, list, index })) return true;
    if (treeInside(block, visit)) return true;
  }
  return false;
}

function treeInside(block, visit) {
  if (block.type === "if") {
    if (treeObject(block.if)) {
      if (visit(block.if, { owner: block, parentId: block.id, slot: "if", list: null, index: 0 })) return true;
      if (treeWalk(treeList(block.if.conditions), block.if, "conditions", visit)) return true;
    }
    if (treeWalk(treeList(block.then), block, "then", visit)) return true;
    if (treeWalk(treeList(block.else), block, "else", visit)) return true;
    return false;
  }
  if (block.type === "group") return treeWalk(treeList(block.conditions), block, "conditions", visit);
  if (block.type === "delay") return treeWalk(treeList(block.blocks), block, "blocks", visit);
  return false;
}

function treeRoot(scenario, visit) {
  return treeWalk(treeList(scenario && scenario.targets), null, "root", visit);
}

function treeDeep(value) {
  return JSON.parse(JSON.stringify(value));
}

/**
 * Где стоит блок: `{block, parentId, slot, index}` — `slot` один из `root`,
 * `then`, `else`, `blocks`, `conditions`, `if` (группа условий «Если»);
 * `null`, если такого блока нет.
 */
export function scenarioFind(scenario, blockId) {
  let found = null;
  treeRoot(scenario, (block, place) => {
    if (block.id !== blockId) return false;
    found = { block, parentId: place.parentId, slot: place.slot, index: place.index };
    return true;
  });
  return found;
}

// Найти блок-родителя в копии.
function treeOwner(copy, parentId) {
  let owner = null;
  treeRoot(copy, (block) => {
    if (block.id !== parentId) return false;
    owner = block;
    return true;
  });
  return owner;
}

/**
 * Вставить блок в слот родителя на место `index` (за краем — в конец).
 * `slot`: `root` (родитель не нужен), `then`, `else`, `blocks`, `conditions`.
 * Нет родителя или слот ему не подходит — тот же сценарий.
 */
export function scenarioInsert(scenario, parentId, slot, index, block) {
  if (!treeObject(scenario) || !treeObject(block)) return scenario;
  const copy = treeDeep(scenario);
  let list;
  if (slot === "root") {
    if (!Array.isArray(copy.targets)) copy.targets = [];
    list = copy.targets;
  } else {
    const owner = treeOwner(copy, parentId);
    if (!owner || !(SCENARIO_TREE_LISTS[owner.type] || []).includes(slot)) return scenario;
    // «Иначе» у «Если» может быть пустым (`null`): вставка его заводит.
    if (!Array.isArray(owner[slot])) owner[slot] = [];
    list = owner[slot];
  }
  const at = Number.isInteger(index) ? Math.max(0, Math.min(list.length, index)) : list.length;
  list.splice(at, 0, treeDeep(block));
  return copy;
}

/** Убрать блок вместе с вложенным. Нет блока (или это группа условий «Если») — тот же сценарий. */
export function scenarioRemove(scenario, blockId) {
  const found = scenarioFind(scenario, blockId);
  if (!found || found.slot === "if") return scenario;
  const copy = treeDeep(scenario);
  let done = false;
  treeRoot(copy, (block, place) => {
    if (block.id !== blockId || !place.list) return false;
    place.list.splice(place.index, 1);
    done = true;
    return true;
  });
  return done ? copy : scenario;
}

/** Заменить блок другим на том же месте. Нет блока — тот же сценарий. */
export function scenarioReplace(scenario, blockId, block) {
  if (!treeObject(block) || !scenarioFind(scenario, blockId)) return scenario;
  const copy = treeDeep(scenario);
  let done = false;
  treeRoot(copy, (current, place) => {
    if (current.id !== blockId) return false;
    if (place.list) place.list[place.index] = treeDeep(block);
    else if (place.owner) place.owner.if = treeDeep(block);
    else return false;
    done = true;
    return true;
  });
  return done ? copy : scenario;
}

function treeContains(block, id) {
  let inside = false;
  treeInside(block, (child) => {
    if (child.id !== id) return false;
    inside = true;
    return true;
  });
  return inside;
}

/**
 * Перенести блок в слот родителя на место `index` (считается в списке уже без
 * самого блока). В самого себя и в своего потомка перенести нельзя — тот же
 * сценарий.
 */
export function scenarioMove(scenario, blockId, parentId, slot, index) {
  const found = scenarioFind(scenario, blockId);
  if (!found || found.slot === "if") return scenario;
  if (slot !== "root" && (parentId === blockId || treeContains(found.block, parentId))) return scenario;
  const removed = scenarioRemove(scenario, blockId);
  const inserted = scenarioInsert(removed, parentId, slot, index, found.block);
  return inserted === removed ? scenario : inserted;
}

/** Номер для новой «Задержки»: следующий за наибольшим по всему дереву. */
export function scenarioDelayNumber(scenario) {
  let top = 0;
  treeRoot(scenario, (block) => {
    if (block.type === "delay" && Number.isFinite(Number(block.no))) top = Math.max(top, Number(block.no));
    return false;
  });
  return top + 1;
}

// ——— правка из редактора (таск 11) ——————————————————————————————————————
//
// Меню «+», добавление блока с умолчаниями Sprut, правка полей, «Иначе»,
// сдвиг на место. Всё — над значением сценария, как остальное в модуле.

const SCENARIO_MENU_ACTIONS = Object.freeze(["device", "if", "delay", "resetDelay", "scenario", "code", "notify", "http"]);
const SCENARIO_MENUS = Object.freeze({
  // «Добавить новый блок условий верхнего уровня» — и действия без «Если»:
  // сценарий без условий сразу выполняет «Тогда».
  root: Object.freeze(["if", ...SCENARIO_MENU_ACTIONS.filter((kind) => kind !== "if")]),
  conditions: Object.freeze(["device", "group", "schedule", "period", "code", "command"]),
  actions: SCENARIO_MENU_ACTIONS,
});

/**
 * Пункты меню «+» по виду списка: `root` (верх сценария), `conditions`
 * (раздел «Если»), `actions` («Тогда», «Иначе», «Задержка»). Порядок — как в
 * Sprut. Неизвестный вид — пустой список.
 */
export function scenarioMenu(list) {
  return Object.prototype.hasOwnProperty.call(SCENARIO_MENUS, list) ? [...SCENARIO_MENUS[list]] : [];
}

// Слот → вид списка меню.
function menuListOf(slot) {
  return slot === "root" ? "root" : slot === "conditions" ? "conditions" : "actions";
}

// Новое условие верхнего уровня — с триггером: оно лежит прямо в группе
// «Если», которое само стоит в корне сценария. Группа внутри группы и «Если»
// в «Тогда» — следующий уровень, там триггера нет (вики, «Триггеры»).
function conditionIsTop(scenario, groupId) {
  const group = scenarioFind(scenario, groupId);
  if (!group || group.slot !== "if") return false;
  const owner = scenarioFind(scenario, group.parentId);
  return Boolean(owner) && owner.slot === "root";
}

/**
 * Добавить блок вида `kind` (пункт меню) в слот родителя. В списке условий
 * `device` — условие по устройству, в остальных — действие. Возвращает
 * `{scenario, block}`; нельзя (нет родителя, пункта нет в меню этого списка) —
 * тот же сценарий и `block: null`.
 */
export function scenarioAddBlock(scenario, parentId, slot, kind, index) {
  if (!treeObject(scenario) || !scenarioMenu(menuListOf(slot)).includes(kind)) return { scenario, block: null };
  let block;
  if (slot === "conditions") {
    block = scenarioNewBlock(kind);
    const top = conditionIsTop(scenario, parentId);
    if (kind === "device") block.trigger = top;
    else if (kind === "period") block.trigger = top;
  } else if (kind === "device") block = scenarioNewBlock("device", { items: [] });
  else if (kind === "delay") block = scenarioNewBlock("delay", { no: scenarioDelayNumber(scenario) });
  else block = scenarioNewBlock(kind);
  const next = scenarioInsert(scenario, parentId, slot, index, block);
  return next === scenario ? { scenario, block: null } : { scenario: next, block };
}

/**
 * Поправить поля блока: ключи `patch` перекрывают, значение `undefined` ключ
 * убирает. Блока нет или ничего не изменилось — тот же сценарий.
 */
export function scenarioPatch(scenario, blockId, patch) {
  const found = scenarioFind(scenario, blockId);
  if (!found || !treeObject(patch)) return scenario;
  const merged = { ...found.block };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) delete merged[key];
    else merged[key] = value;
  }
  if (JSON.stringify(merged) === JSON.stringify(found.block)) return scenario;
  return scenarioReplace(scenario, blockId, merged);
}

/** «Добавить блок „Иначе“» (`on`) и «Удалить блок „Иначе“»; не «Если» и повтор — тот же сценарий. */
export function scenarioSetElse(scenario, ifId, on) {
  const found = scenarioFind(scenario, ifId);
  if (!found || found.block.type !== "if") return scenario;
  const has = Array.isArray(found.block.else);
  if (on === has) return scenario;
  return scenarioPatch(scenario, ifId, { else: on ? [] : null });
}

/** Сдвинуть блок на `delta` мест внутри его списка (кнопки ↑↓); у края — тот же сценарий. */
export function scenarioShift(scenario, blockId, delta) {
  const found = scenarioFind(scenario, blockId);
  if (!found || found.slot === "if" || !Number.isInteger(delta) || delta === 0) return scenario;
  const owner = found.parentId ? scenarioFind(scenario, found.parentId) : null;
  const holder = owner ? owner.block : null;
  const size = found.slot === "root" ? treeList(scenario.targets).length : treeList(holder && holder[found.slot]).length;
  const at = found.index + delta;
  if (at < 0 || at >= size) return scenario;
  return scenarioMove(scenario, blockId, found.parentId, found.slot, at);
}

/** Номера всех задержек сценария по возрастанию — для «Сбросить задержку №N». */
export function scenarioDelayNumbers(scenario) {
  const numbers = new Set();
  treeRoot(scenario, (block) => {
    if (block.type === "delay" && Number.isFinite(Number(block.no))) numbers.add(Number(block.no));
    return false;
  });
  return [...numbers].sort((a, b) => a - b);
}

// ——— устройства блоков ——————————————————————————————————————————————

// Ссылки блока на устройства: условие и действие несут `ref`, «Установить из»
// — ещё и `from` у характеристики.
function treeRefs(block) {
  const out = [];
  if (block.type !== "device") return out;
  if (treeObject(block.ref)) out.push(block.ref);
  for (const item of treeList(block.items)) if (treeObject(item) && treeObject(item.from)) out.push(item.from);
  return out;
}

/**
 * Метки, на которые ссылается блок со всем вложенным, — для подсветки на
 * мини-плане. Принимает блок или список блоков. С `{slots: true}` вместо
 * меток возвращает ключи пустых мест заготовки. Без повторов, в порядке дерева.
 */
export function scenarioBlockMarks(blocks, options = {}) {
  const list = Array.isArray(blocks) ? blocks : treeObject(blocks) ? [blocks] : [];
  const key = options.slots === true ? "slot" : "markId";
  const out = [];
  const take = (block) => {
    for (const ref of treeRefs(block)) {
      const value = ref[key];
      if (typeof value === "string" && value && !out.includes(value)) out.push(value);
    }
  };
  for (const block of list) {
    if (!treeObject(block)) continue;
    take(block);
    treeInside(block, (child) => {
      take(child);
      return false;
    });
  }
  return out;
}

/** Есть ли блок с этим id внутри блока `block` (сам блок тоже считается). */
export function scenarioBlockHas(block, blockId) {
  if (!treeObject(block)) return false;
  return block.id === blockId || treeContains(block, blockId);
}

// ——— операторы и ∞ ————————————————————————————————————————————————

const SCENARIO_OPS_FLAT = Object.freeze(["changed", "eq", "ne"]);
const SCENARIO_OPS_NUMBER = Object.freeze(["changed", "eq", "ne", "gt", "ge", "lt", "le"]);

/**
 * Операторы условия по формату характеристики: логика и перечисления —
 * «Изменено», «=», «≠»; числа — плюс «>», «≥», «<», «≤». Метаданных нет
 * (устройство удалено) — осторожные три.
 */
export function scenarioOps(meta) {
  return meta && (meta.format === "int" || meta.format === "float") ? [...SCENARIO_OPS_NUMBER] : [...SCENARIO_OPS_FLAT];
}

/** ∞ — только у числовых сравнений; правило движка, второго нет (G07). */
export function scenarioRepeatAllowed(condition, meta) {
  return blocksRepeatAllowed(condition, meta);
}

// ——— фраза-описание ——————————————————————————————————————————————————
//
// «Если ДД1 движение (триггер) и с 22:00 до 06:00 — С3 вкл 30 %, через 5 мин
// выкл». Пустые места заготовки в фразе помечены служебными знаками — по ним
// `scenarioPhraseParts` отдаёт их отдельно, чтобы экран подсветил.

const SCENARIO_SLOT_OPEN = "\u0001";
const SCENARIO_SLOT_MID = "\u0002";
const SCENARIO_SLOT_CLOSE = "\u0003";

const SCENARIO_OP_SIGNS = { eq: "=", ne: "≠", gt: ">", ge: "≥", lt: "<", le: "≤" };

function phraseDuration(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  const units = strings.scenarios.units;
  const parts = [];
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = total % 60;
  if (hours) parts.push(hours + " " + units.h);
  if (minutes) parts.push(minutes + " " + units.m);
  if (rest || parts.length === 0) parts.push(rest + " " + units.s);
  return parts.join(" ");
}

function phraseDays(days) {
  if (!Array.isArray(days)) return "";
  const set = [...new Set(days.filter((day) => Number.isInteger(day) && day >= 1 && day <= 7))].sort((a, b) => a - b);
  if (set.length === 7) return "";
  if (set.length === 0) return " (" + strings.scenarios.phrase.never + ")";
  const words = strings.scenarios.days;
  const parts = [];
  for (let at = 0; at < set.length; ) {
    let end = at;
    while (end + 1 < set.length && set[end + 1] === set[end] + 1) end += 1;
    if (end - at >= 2) parts.push(words[set[at]] + "–" + words[set[end]]);
    else for (let step = at; step <= end; step += 1) parts.push(words[set[step]]);
    at = end + 1;
  }
  return " (" + parts.join(", ") + ")";
}

function phraseSlotName(key) {
  const named = strings.scenarios.slots[key];
  if (typeof named === "string" && key !== "generic") return named;
  const generic = /^device(\d+)$/.exec(key);
  return generic ? text("scenarios.slots.generic", { n: generic[1] }) : String(key);
}

/** Подпись пустого места заготовки: «Датчик движения», «Устройство 2». */
export function scenarioSlotLabel(key) {
  return phraseSlotName(String(key));
}

function phraseDevice(project, ref) {
  const given = treeObject(ref) ? ref : {};
  if (typeof given.slot === "string" && given.slot) {
    return SCENARIO_SLOT_OPEN + given.slot + SCENARIO_SLOT_MID + text("scenarios.phrase.slot", { name: phraseSlotName(given.slot) }) + SCENARIO_SLOT_CLOSE;
  }
  if (typeof given.markId !== "string" || !given.markId) return strings.scenarios.phrase.deviceNone;
  return findMark(project, given.markId) ? labelOf(project, given.markId) : strings.scenarios.phrase.deviceGone;
}

function phraseChar(char) {
  const word = strings.sim.chars[char];
  return typeof word === "string" ? word.toLowerCase() : String(char || "");
}

// Значение характеристики словами: «да», «Протечка», «30 %», «22 °C».
function phraseValue(char, meta, value) {
  const words = strings.scenarios.phrase;
  if (value === undefined || value === null || value === "") return words.noValue;
  if (typeof value === "boolean") return value ? words.yes : words.no;
  const labels = strings.sim.values[char];
  if (labels && typeof value === "string" && typeof labels[value] === "string") return labels[value];
  if (typeof value === "number" || (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value)))) {
    const unit = meta && meta.unit && strings.sim.units[meta.unit] ? " " + strings.sim.units[meta.unit] : "";
    return String(value) + unit;
  }
  return String(value);
}

function phraseTruth(value) {
  return value === true || value === "true";
}

function phraseDeviceCondition(project, block) {
  const words = strings.scenarios.phrase;
  const ref = treeObject(block.ref) ? block.ref : {};
  const label = phraseDevice(project, ref);
  let body = label;
  if (typeof ref.char === "string" && ref.char && (ref.markId || ref.slot)) {
    const meta = simCharMeta(ref.char);
    const char = phraseChar(ref.char);
    if (block.op === "changed") body = label + " " + char + " " + words.changed;
    else if (meta && meta.format === "bool" && (block.op === "eq" || block.op === "ne")) {
      const truth = (block.op === "eq") === phraseTruth(block.value);
      if (ref.char === "On") body = label + " " + (truth ? words.on : words.off);
      else body = label + " " + char + (truth ? "" : " = " + words.no);
    } else {
      body = label + " " + char + " " + (SCENARIO_OP_SIGNS[block.op] || "=") + " " + phraseValue(ref.char, meta, block.value);
    }
  }
  const hold = treeObject(block.hold) ? block.hold : null;
  if (hold && Number(hold.sec) > 0 && (hold.mode === "more" || hold.mode === "less")) {
    body += " " + text("scenarios.phrase." + (hold.mode === "more" ? "holdMore" : "holdLess"), { time: phraseDuration(hold.sec) });
  }
  return body;
}

function phraseSchedule(block) {
  const words = strings.scenarios.phrase;
  let body;
  if (block.mode === "every") body = text("scenarios.phrase.every", { time: phraseDuration(block.everySec) });
  else if (block.mode === "sunrise" || block.mode === "sunset") {
    body = words[block.mode];
    const offset = Number(block.offsetSec) || 0;
    if (offset !== 0) body += " " + (offset < 0 ? "−" : "+") + phraseDuration(Math.abs(offset));
  } else body = text("scenarios.phrase.time", { at: block.at || words.noValue });
  return body + phraseDays(block.days);
}

function phraseCondition(project, block, nested) {
  const words = strings.scenarios.phrase;
  if (!treeObject(block)) return words.block;
  let body;
  let trigger = false;
  switch (block.type) {
    case "device":
      body = phraseDeviceCondition(project, block);
      trigger = block.trigger === true;
      break;
    case "schedule":
      return phraseSchedule(block);
    case "period":
      body = text("scenarios.phrase.period", { from: block.from || words.noValue, to: block.to || words.noValue }) + phraseDays(block.days);
      trigger = block.trigger === true;
      break;
    case "code":
      return words.code;
    case "command":
      return text("scenarios.phrase.command", {
        text: typeof block.text === "string" && block.text.trim() ? block.text.trim() : words.commandNone,
      });
    case "group":
      return phraseGroup(project, block, nested);
    default:
      return words.block;
  }
  return trigger ? body + " " + words.trigger : body;
}

function phraseGroup(project, group, nested) {
  const words = strings.scenarios.phrase;
  const items = treeList(group.conditions).map((item) => phraseCondition(project, item, true));
  if (items.length === 0) return words.noValue;
  const joined = items.join(" " + (group.mode === "AND" ? words.and : words.or) + " ");
  return nested && items.length > 1 ? "(" + joined + ")" : joined;
}

function phraseItems(project, items) {
  const words = strings.scenarios.phrase;
  const out = [];
  const list = treeList(items).filter(treeObject);
  for (let at = 0; at < list.length; at += 1) {
    const item = list[at];
    const char = phraseChar(item.char);
    const meta = simCharMeta(item.char);
    if (item.verb === "invert") out.push(item.char === "On" ? words.invert : char + " " + words.invert);
    else if (item.verb === "increase") {
      const own = Number(item.step);
      const step = item.step !== undefined && item.step !== null && item.step !== "" && Number.isFinite(own) ? own : meta && meta.step ? meta.step : 1;
      const unit = meta && meta.unit && strings.sim.units[meta.unit] ? " " + strings.sim.units[meta.unit] : "";
      out.push(text("scenarios.phrase.step", { char, sign: step < 0 ? "" : "+", step, unit }));
    } else if (item.verb === "setFrom") {
      const from = treeObject(item.from) ? item.from : {};
      out.push(
        text("scenarios.phrase.from", { char, label: phraseDevice(project, from), fromChar: from.char ? phraseChar(from.char) : words.noValue }),
      );
    } else if (item.char === "On") {
      let word = phraseTruth(item.value) ? words.on : words.off;
      const next = list[at + 1];
      // «вкл 30 %»: яркость сразу за включением читается одним куском.
      if (phraseTruth(item.value) && next && next.char === "Brightness" && next.verb === "set" && next.value !== undefined && next.value !== "") {
        word += " " + phraseValue("Brightness", simCharMeta("Brightness"), next.value);
        at += 1;
      }
      out.push(word);
    } else out.push(char + " " + phraseValue(item.char, meta, item.value));
  }
  return out.join(", ");
}

function phraseActions(project, list) {
  return treeList(list)
    .map((block) => phraseAction(project, block))
    .filter((item) => item !== "")
    .join(", ");
}

function phraseAction(project, block) {
  const words = strings.scenarios.phrase;
  if (!treeObject(block)) return words.block;
  switch (block.type) {
    case "if":
      return phraseIf(project, block, true);
    case "device": {
      const label = phraseDevice(project, block.ref);
      const items = phraseItems(project, block.items);
      return items ? label + " " + items : label;
    }
    case "delay": {
      const head = text("scenarios.phrase.delay", { time: phraseDuration(block.sec) });
      const inner = phraseActions(project, block.blocks);
      return inner ? head + " " + inner : head;
    }
    case "resetDelay":
      return block.no === null || block.no === undefined || block.no === ""
        ? words.resetAll
        : text("scenarios.phrase.resetOne", { no: block.no });
    case "scenario": {
      const target = typeof block.scenarioId === "string" && block.scenarioId ? findScenario(project, block.scenarioId) : null;
      const verb = words.verbs[block.verb] || words.verbs.run;
      return verb + " " + (target ? "«" + target.name + "»" : words.scenarioNone);
    }
    case "code":
      return words.codeRun;
    case "notify":
      return text("scenarios.phrase.notify", { text: block.text || words.commandNone });
    case "http":
      return text("scenarios.phrase.http", { method: block.method || "GET" });
    default:
      return words.block;
  }
}

function phraseIf(project, block, nested) {
  const words = strings.scenarios.phrase;
  const head = (nested ? words.ifNested : words.if) + " " + (treeObject(block.if) ? phraseGroup(project, block.if, false) : words.noValue);
  let then = phraseActions(project, block.then);
  const every = treeObject(block.every) && Number(block.every.sec) > 0 ? text("scenarios.phrase.cycle", { time: phraseDuration(block.every.sec) }) : "";
  if (every) then = then ? every + " " + then : every;
  const otherwise = phraseActions(project, block.else);
  let out = head;
  if (then) out += words.then + then;
  if (otherwise) out += (then ? ", " : words.then) + words.else + " " + otherwise;
  return out;
}

function phraseText(project, scenario) {
  const words = strings.scenarios.phrase;
  const targets = treeList(scenario.targets);
  if (targets.length === 0) return words.empty;
  return targets.map((block) => (treeObject(block) && block.type === "if" ? phraseIf(project, block, false) : phraseAction(project, block))).join("; ");
}

function phraseSplit(raw) {
  const parts = [];
  const pattern = new RegExp(SCENARIO_SLOT_OPEN + "([^" + SCENARIO_SLOT_MID + "]*)" + SCENARIO_SLOT_MID + "([^" + SCENARIO_SLOT_CLOSE + "]*)" + SCENARIO_SLOT_CLOSE, "g");
  let last = 0;
  for (let match = pattern.exec(raw); match; match = pattern.exec(raw)) {
    if (match.index > last) parts.push({ text: raw.slice(last, match.index) });
    parts.push({ text: match[2], slot: match[1] });
    last = pattern.lastIndex;
  }
  if (last < raw.length) parts.push({ text: raw.slice(last) });
  return parts;
}

/**
 * Фраза-описание по кускам: `[{text}, {text, slot}]` — `slot` стоит у пустых
 * мест заготовки, экран их подсвечивает. У логического и глобального
 * сценария — описание из `info` или имя.
 */
export function scenarioPhraseParts(project, scenario) {
  if (!treeObject(scenario)) return [];
  if (scenario.kind === "logic" || scenario.kind === "global") {
    const template = treeObject(scenario.template) ? scenario.template : {};
    const given = [scenario.description, template.desc, template.name, scenario.name].find((item) => typeof item === "string" && item.trim() !== "");
    return [{ text: given || "" }];
  }
  return phraseSplit(phraseText(project, scenario));
}

/** Фраза-описание блочного сценария одной строкой (истории 4.3, 4.31). */
export function scenarioPhrase(project, scenario) {
  return scenarioPhraseParts(project, scenario)
    .map((part) => part.text)
    .join("");
}

// ——— проблемы ———————————————————————————————————————————————————————

function issueTriggers(scenario) {
  const keys = new Set();
  let any = false;
  let hasIf = false;
  treeRoot(scenario, (block) => {
    if (block.type === "if") hasIf = true;
    if (block.type === "device" && !block.items && block.trigger === true) {
      any = true;
      const ref = treeObject(block.ref) ? block.ref : {};
      if (ref.markId && ref.char) keys.add(ref.markId + "|" + ref.char);
    } else if (block.type === "schedule" || block.type === "command") any = true;
    else if (block.type === "period" && block.trigger === true) any = true;
    return false;
  });
  return { keys, any, hasIf };
}

/**
 * Проблемы блочного сценария: `[{blockId, code}]`. Коды: `incomplete` (блок
 * без устройства или значения), `deviceMissing` (метки или сервиса больше
 * нет) — это те самые блоки, которые движок пропустит; `loop` — действие
 * управляет тем, что стоит триггером этого же сценария (история 4.21);
 * `noTrigger` (`blockId: null`) — условия есть, а ни одной галки «триггер»
 * нет. Сценарии на JS блочных проблем не имеют. `accessories` — готовый
 * `homeAccessories(project)`: список из многих сценариев собирает его один раз.
 */
export function scenarioIssues(project, given, accessories = null) {
  if (!treeObject(given) || given.kind !== "block") return [];
  // Ведомая метка группы — устройство ведущей: проверка видит сценарий так же,
  // как дом (`homeLeadScenario`).
  const scenario = homeLeadScenario(project, given);
  const issues = blocksPrepare(scenario, { accessories: accessories || homeAccessories(project) }).issues.map((item) => ({ blockId: item.blockId, code: item.code }));
  const triggers = issueTriggers(scenario);
  treeRoot(scenario, (block) => {
    if (block.type !== "device" || !block.items) return false;
    const ref = treeObject(block.ref) ? block.ref : {};
    const loops = treeList(block.items).some((item) => treeObject(item) && ref.markId && triggers.keys.has(ref.markId + "|" + item.char));
    if (loops) issues.push({ blockId: block.id ?? null, code: "loop" });
    return false;
  });
  if (triggers.hasIf && !triggers.any) issues.push({ blockId: null, code: "noTrigger" });
  return issues;
}

// ——— заготовки (истории 4.24, 4.25) ————————————————————————————————————
//
// Заготовка — сценарий, где вместо устройств стоят **места**: `{slot: "ключ"}`.
// Блоки в ней без id: id раздаёт `scenarioFromTemplate` при каждом создании.

const TEMPLATE_WORDS = strings.scenarios.templates;

const tplDevice = (slot, char, op, value, trigger) => ({ type: "device", ref: { slot, char }, op, value, trigger });
const tplAct = (slot, ...items) => ({ type: "device", ref: { slot }, items });
const tplOnly = (condition) => ({ type: "group", mode: "OR", conditions: [condition] });
const tplIf = (group, then) => ({ type: "if", if: group, then, else: null, every: null });
const tplSet = (char, value) => ({ char, verb: "set", value });
const tplDays = () => [...SCENARIO_ALL_DAYS];

const SCENARIO_LIGHT_KINDS = ["light", "lightOnOff", "lightCct", "lightRgb"];
const SCENARIO_MOTION_KINDS = ["motion", "occupancy"];
const SCENARIO_BUTTON_KINDS = ["button", "switchRelay", "switch"];

function templateOf(key, slots, targets, extra = {}) {
  return Object.freeze({
    key,
    name: TEMPLATE_WORDS[key].name,
    description: TEMPLATE_WORDS[key].desc,
    slots,
    scenario: { kind: "block", name: TEMPLATE_WORDS[key].name, active: true, onStart: false, sequential: false, description: "", targets, ...extra },
  });
}

/** Шесть типовых заготовок (история 4.24). */
export const SCENARIO_TEMPLATES = Object.freeze([
  templateOf(
    "motionLight",
    [
      { key: "motion", kinds: SCENARIO_MOTION_KINDS },
      { key: "light", kinds: SCENARIO_LIGHT_KINDS },
    ],
    [
      tplIf(tplOnly(tplDevice("motion", "MotionDetected", "eq", true, true)), [
        tplAct("light", tplSet("On", true)),
        { type: "delay", no: 1, sec: 300, timer: "one", blocks: [tplAct("light", tplSet("On", false))] },
      ]),
    ],
  ),
  templateOf(
    "nightDim",
    [
      { key: "motion", kinds: SCENARIO_MOTION_KINDS },
      { key: "light", kinds: SCENARIO_LIGHT_KINDS },
    ],
    [
      tplIf(
        {
          type: "group",
          mode: "AND",
          conditions: [tplDevice("motion", "MotionDetected", "eq", true, true), { type: "period", days: tplDays(), from: "22:00", to: "06:00", trigger: false }],
        },
        [
          tplAct("light", tplSet("On", true), tplSet("Brightness", 30)),
          { type: "delay", no: 1, sec: 300, timer: "one", blocks: [tplAct("light", tplSet("On", false))] },
        ],
      ),
    ],
  ),
  templateOf(
    "leakValve",
    [
      { key: "leak", kinds: ["leak"] },
      { key: "valve", kinds: ["valve"] },
    ],
    [tplIf(tplOnly(tplDevice("leak", "LeakDetected", "eq", "LEAK_DETECTED", true)), [tplAct("valve", tplSet("Active", "INACTIVE"))])],
  ),
  templateOf(
    "curtainsSun",
    [{ key: "curtain", kinds: ["curtain"] }],
    [
      tplIf(tplOnly({ type: "schedule", mode: "sunrise", days: tplDays(), offsetSec: 0 }), [tplAct("curtain", tplSet("TargetPosition", 100))]),
      tplIf(tplOnly({ type: "schedule", mode: "sunset", days: tplDays(), offsetSec: 0 }), [tplAct("curtain", tplSet("TargetPosition", 0))]),
    ],
  ),
  templateOf(
    "leaveHome",
    [
      { key: "button", kinds: SCENARIO_BUTTON_KINDS },
      { key: "light1", kinds: SCENARIO_LIGHT_KINDS },
      { key: "light2", kinds: SCENARIO_LIGHT_KINDS },
    ],
    [tplIf(tplOnly(tplDevice("button", "ProgrammableSwitchEvent", "eq", "LONG_PRESS", true)), [tplAct("light1", tplSet("On", false)), tplAct("light2", tplSet("On", false))])],
  ),
  templateOf(
    "doublePress",
    [
      { key: "button", kinds: SCENARIO_BUTTON_KINDS },
      { key: "light1", kinds: SCENARIO_LIGHT_KINDS },
      { key: "light2", kinds: SCENARIO_LIGHT_KINDS },
      { key: "light3", kinds: SCENARIO_LIGHT_KINDS },
    ],
    [
      tplIf(tplOnly(tplDevice("button", "ProgrammableSwitchEvent", "eq", "DOUBLE_PRESS", true)), [
        tplAct("light1", tplSet("On", true)),
        tplAct("light2", tplSet("On", true)),
        tplAct("light3", tplSet("On", true)),
      ]),
    ],
  ),
]);

// Всем блокам дерева — свои id (блок узнают по полю `type`).
function templateIds(node) {
  if (Array.isArray(node)) return node.forEach(templateIds);
  if (!treeObject(node)) return;
  if (typeof node.type === "string") node.id = scenarioNewId();
  Object.values(node).forEach(templateIds);
}

/**
 * Блочный сценарий из заготовки (встроенной или своей): копия с новыми id
 * блоков, устройства — пустые места `{slot}`. Исходная заготовка не меняется.
 * Отдаётся в `addScenario`.
 */
export function scenarioFromTemplate(template) {
  const source = treeObject(template) && treeObject(template.scenario) ? template.scenario : { targets: [] };
  const targets = treeDeep(treeList(source.targets));
  templateIds(targets);
  return {
    kind: "block",
    name: typeof template.name === "string" && template.name ? template.name : typeof source.name === "string" && source.name ? source.name : strings.sim.scenarioUntitled,
    active: source.active !== false,
    onStart: source.onStart === true,
    sequential: source.sequential === true,
    description: typeof source.description === "string" ? source.description : "",
    targets,
  };
}

/**
 * «Сохранить как заготовку» (история 4.25): устройства сценария становятся
 * пустыми местами — одна метка, одно место `device1`, `device2`… в порядке
 * появления. Характеристики, значения, время и вложенность остаются. Свой `id`
 * заготовке даёт хранилище. С `project` у мест есть вид устройства (подсказка
 * для выбора).
 */
export function scenarioToTemplate(scenario, project = null) {
  const source = treeObject(scenario) ? scenario : {};
  const targets = treeDeep(treeList(source.targets));
  const accessories = new Map((project ? homeAccessories(project) : []).map((item) => [item.markId, item]));
  const slots = [];
  const byMark = new Map();
  const slotFor = (markId) => {
    if (!byMark.has(markId)) {
      const key = "device" + (slots.length + 1);
      byMark.set(markId, key);
      const accessory = accessories.get(markId);
      slots.push({ key, kinds: accessory && accessory.kind ? [accessory.kind] : [] });
    }
    return byMark.get(markId);
  };
  const swap = (ref) => {
    if (!treeObject(ref)) return {};
    if (typeof ref.slot === "string" && ref.slot) {
      if (!slots.some((slot) => slot.key === ref.slot)) slots.push({ key: ref.slot, kinds: [] });
      return { slot: ref.slot, ...(ref.char ? { char: ref.char } : {}) };
    }
    if (typeof ref.markId !== "string" || !ref.markId) return {};
    return { slot: slotFor(ref.markId), ...(ref.char ? { char: ref.char } : {}) };
  };
  const visit = (node) => {
    if (Array.isArray(node)) return node.forEach(visit);
    if (!treeObject(node)) return;
    if (node.type === "device") {
      node.ref = swap(node.ref);
      for (const item of treeList(node.items)) if (treeObject(item) && treeObject(item.from)) item.from = swap(item.from);
    }
    Object.values(node).forEach(visit);
  };
  visit(targets);
  const name = typeof source.name === "string" && source.name.trim() ? source.name.trim() : strings.sim.scenarioUntitled;
  return {
    name,
    slots,
    scenario: {
      kind: "block",
      name,
      active: source.active !== false,
      onStart: source.onStart === true,
      sequential: source.sequential === true,
      description: typeof source.description === "string" ? source.description : "",
      targets,
    },
  };
}

/**
 * Свои заготовки из хранилища браузера: годные записи (`id`, непустое `name`,
 * `slots`, блочный `scenario` со списком `targets`), остальное — мусор от
 * другой версии или ручной правки — отбрасывается.
 */
export function scenarioTemplatesFrom(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (item) =>
        treeObject(item) &&
        typeof item.id === "string" &&
        item.id !== "" &&
        typeof item.name === "string" &&
        item.name.trim() !== "" &&
        Array.isArray(item.slots) &&
        treeObject(item.scenario) &&
        item.scenario.kind === "block" &&
        Array.isArray(item.scenario.targets),
    )
    .map((item) => treeDeep(item));
}
