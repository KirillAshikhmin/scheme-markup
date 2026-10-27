// Редактор блоков «Если — Тогда — Иначе» (таск 11 сценариев; истории 4.4–4.21,
// 4.26, 4.28, 4.30, 4.31).
//
// Вид — по скриншотам вики Sprut.Hub (`research/spruthub-wiki.md` §2): карточка
// условия с именем устройства и комнатой, строкой «характеристика · оператор ·
// значение · единица · ⏱», жёлтым кружком-триггером и ∞ у числовых сравнений;
// «Если» с переключателем «Одно из / Все сразу»; «Тогда» с секундомером
// «Каждые»; необязательное «Иначе»; «Задержка №N» с «Один / Новый таймер»;
// меню «+» с пунктами как в Sprut.
//
// Две половины:
//
// - **чистая** (`scenarioEditor*` ниже): какие характеристики можно выбрать,
//   какое значение и оператор им подходят, как чинится блок при смене
//   характеристики, какие глаголы у действия, что не заполнено словами,
//   перетаскивание. Тестируется в Node (`scenarioEditor.test.js`);
// - **экранная** (`sed*`): тонкая обёртка над чистой, подключается к режиму
//   «Сценарии» дверью `scenariosHook("editor", …)`.
//
// Дерево правит только `scenarioTree.js` (вставка, перенос, замена): здесь его
// не размножаем. Каждая правка — один шаг истории через `ctx.commit`; поля
// отдают значение по Enter и по уходу фокуса (`uiApply`), а не на каждую
// клавишу.
import { appClockSimMs } from "../appClock.js";
import { clockMsStamp, volumeClockParse, volumeClockText } from "../clockMath.js";
import { findMark, findRoom, findScenario, labelOf, scenariosInOrder, updateScenario } from "../model.js";
import {
  scenarioAddBlock,
  scenarioBlockMarks,
  scenarioDelayNumbers,
  scenarioFind,
  scenarioIssues,
  scenarioMenu,
  scenarioMove,
  scenarioOps,
  scenarioPatch,
  scenarioRemove,
  scenarioRepeatAllowed,
  scenarioSetElse,
  scenarioShift,
} from "../scenarioTree.js";
import { sunTimes } from "../sim/schedule.js";
import { homeAccessories } from "../sim/home.js";
import { strings, text } from "../strings.js";
import { volumeSiteOf } from "../volume.js";
import { scenariosDeviceGroups, scenariosHook, scenariosIssueText } from "./scenarios.js";
import { uiApply, uiButton, uiCheckRow, uiEl, uiIcon, uiIconButton, uiModal, uiNumber } from "./ui.js";

const SED_WORDS = strings.scenarios.editor;

// ——— чистая половина: характеристики и значения ———————————————————————

function editorObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function editorBlank(value) {
  return value === undefined || value === null || value === "";
}

function editorSame(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

// Характеристика без состояния: нажатие и команда «только запись».
function editorEventLike(meta) {
  return Boolean(meta) && (meta.format === "event" || (Array.isArray(meta.perms) && !meta.perms.includes("read")));
}

function editorNumeric(meta) {
  return Boolean(meta) && (meta.format === "int" || meta.format === "float");
}

/**
 * Что выбрать у устройства: `[{key: "сервис:характеристика", service, char,
 * label, meta, readOnly}]` — сервис и характеристика одним списком, как в
 * карточке Sprut. Одинаковые сервисы (клавиши выключателя) различаются номером.
 *
 * С `{write: true}` (для действия) список **тот же целиком**, а
 * характеристика без записи помечена `readOnly` и пометкой в подписи (правка
 * 2026-10-27). Слова заказчика: «Позволь блочными сценариями управлять
 * характеристиками только для чтения у устройств, просто делай пометку что они
 * только для чтения, но менять можно». В имитации это и нужно: датчик
 * температуры или движения сценарий ставит сам, проверяя ответ дома. Записываемые
 * идут первыми — их и подставляет выбор устройства.
 */
export function scenarioEditorCharChoices(accessory, { write = false } = {}) {
  const services = accessory && Array.isArray(accessory.services) ? accessory.services : [];
  const out = [];
  for (const service of services) {
    const same = services.filter((item) => item.type === service.type);
    let name = strings.sim.services[service.type] || service.type;
    if (same.length > 1) name += " " + (Number.isInteger(service.channel) ? service.channel : same.indexOf(service) + 1);
    for (const char of Array.isArray(service.chars) ? service.chars : []) {
      const meta = char.meta || null;
      const readOnly = write && !(meta && Array.isArray(meta.perms) && meta.perms.includes("write"));
      const charLabel = strings.sim.chars[char.type] || char.type;
      out.push({
        key: service.index + ":" + char.type,
        service: service.index,
        char: char.type,
        label: name + " · " + (readOnly ? text("scenarios.editor.readOnlyChar", { char: charLabel }) : charLabel),
        meta,
        readOnly,
      });
    }
  }
  // Записываемые — первыми; внутри своих — прежний порядок карточки.
  return write ? [...out.filter((item) => !item.readOnly), ...out.filter((item) => item.readOnly)] : out;
}

/**
 * Каким полем вводят значение характеристики: `{kind: "options", options:
 * [{value, label}]}` (да/нет и подписи перечислений), `{kind: "number", min,
 * max, step, unit, hint}`, `{kind: "text"}` или `{kind: "none"}` (метаданных
 * нет — устройство удалено).
 */
export function scenarioEditorValueSpec(meta, char) {
  if (!meta) return { kind: "none" };
  if (meta.format === "bool") {
    return {
      kind: "options",
      options: [
        { value: true, label: strings.scenarios.phrase.yes },
        { value: false, label: strings.scenarios.phrase.no },
      ],
    };
  }
  if (meta.format === "enum" || meta.format === "event") {
    const labels = strings.sim.values[char] || {};
    return { kind: "options", options: (meta.values || []).map((item) => ({ value: item.key, label: labels[item.key] || item.key })) };
  }
  if (editorNumeric(meta)) {
    const unit = meta.unit && strings.sim.units[meta.unit] ? strings.sim.units[meta.unit] : "";
    const known = Number.isFinite(meta.min) && Number.isFinite(meta.max);
    return {
      kind: "number",
      min: Number.isFinite(meta.min) ? meta.min : null,
      max: Number.isFinite(meta.max) ? meta.max : null,
      step: Number.isFinite(meta.step) ? meta.step : null,
      unit,
      hint: known ? text("scenarios.editor.range", { min: meta.min, max: meta.max, unit }).trim() : "",
    };
  }
  return { kind: "text" };
}

/** Число из поля: запятая как точка; не число — `null`. */
export function scenarioEditorParseNumber(raw) {
  const source = String(raw ?? "")
    .trim()
    .replace(",", ".");
  if (source === "" || !/^[-+]?(\d+\.?\d*|\.\d+)$/.test(source)) return null;
  const value = Number(source);
  return Number.isFinite(value) ? value : null;
}

function editorDefaultValue(spec) {
  return spec.kind === "options" && spec.options.length > 0 ? spec.options[0].value : undefined;
}

function editorValueFits(spec, value) {
  if (spec.kind === "options") return spec.options.some((item) => item.value === value);
  if (spec.kind === "number") return typeof value === "number" && Number.isFinite(value);
  if (spec.kind === "text") return typeof value === "string";
  return true;
}

const EDITOR_OP_SIGNS = { eq: "=", ne: "≠", gt: ">", ge: "≥", lt: "<", le: "≤" };

/** Подпись оператора: «Изменено», «=», «≠», «>», «≥», «<», «≤». */
export function scenarioEditorOpLabel(op) {
  return op === "changed" ? SED_WORDS.opChanged : EDITOR_OP_SIGNS[op] || String(op);
}

/** Можно ли условию «⏱ Более/Менее»: не «Изменено» и не нажатие (у события нет «держится»). */
export function scenarioEditorHoldAllowed(condition, meta) {
  return Boolean(condition) && condition.op !== "changed" && Boolean(meta) && !editorEventLike(meta);
}

/**
 * Привести условие по устройству в согласие с характеристикой: оператор из
 * допустимых для формата, значение того же вида (да/нет и подписи выбраны
 * сразу, число вводят сами), ∞ только у числовых сравнений, «⏱» не у
 * «Изменено». Без метаданных (устройство удалено) условие не трогает.
 * Нечего менять — то же условие.
 */
export function scenarioEditorConditionFix(condition, meta) {
  if (!editorObject(condition) || !meta) return condition;
  const next = { ...condition };
  if (!scenarioOps(meta).includes(next.op)) next.op = "eq";
  if (next.op === "changed") delete next.value;
  else {
    const spec = scenarioEditorValueSpec(meta, next.ref && next.ref.char);
    if (!editorValueFits(spec, next.value)) {
      const given = editorDefaultValue(spec);
      if (given === undefined) delete next.value;
      else next.value = given;
    }
  }
  if (next.repeat !== undefined && !scenarioRepeatAllowed(next, meta)) delete next.repeat;
  if (next.hold !== undefined && !scenarioEditorHoldAllowed(next, meta)) delete next.hold;
  return editorSame(next, condition) ? condition : next;
}

/**
 * Назначить условию устройство, сервис и характеристику. Та же
 * характеристика — значение и отметки остаются; другая — значение, ∞ и «⏱»
 * начинаются заново (триггер остаётся: это выбор человека).
 */
export function scenarioEditorConditionRef(condition, ref, meta) {
  const was = editorObject(condition.ref) ? condition.ref : {};
  const same = was.markId === ref.markId && was.service === ref.service && was.char === ref.char;
  const next = { ...condition, ref: { markId: ref.markId, service: ref.service, char: ref.char } };
  if (!same) {
    delete next.value;
    delete next.repeat;
    delete next.hold;
  }
  return scenarioEditorConditionFix(next, meta);
}

/** Глаголы действия по формату: «Установить» всегда, «Инвертировать» и «Увеличить» — где есть смысл. */
export function scenarioEditorVerbs(meta) {
  if (!meta || meta.format === "event") return ["set"];
  const verbs = ["set"];
  const two = meta.format === "enum" && Array.isArray(meta.values) && meta.values.length === 2;
  const span = editorNumeric(meta) && Number.isFinite(meta.min) && Number.isFinite(meta.max);
  if (meta.format === "bool" || two || span) verbs.push("invert");
  if (editorNumeric(meta)) verbs.push("increase");
  verbs.push("setFrom");
  return verbs;
}

/** Привести позицию действия в согласие с характеристикой: глагол из допустимых, лишнее убрано, значение подобрано. */
export function scenarioEditorItemFix(item, meta) {
  const verb = scenarioEditorVerbs(meta).includes(item.verb) ? item.verb : "set";
  const next = { char: item.char, verb };
  if (verb === "set") {
    const spec = scenarioEditorValueSpec(meta, item.char);
    if (!editorBlank(item.value) && editorValueFits(spec, item.value)) next.value = item.value;
    else {
      const given = editorDefaultValue(spec);
      if (given !== undefined) next.value = given;
    }
  } else if (verb === "increase") {
    if (typeof item.step === "number" && Number.isFinite(item.step)) next.step = item.step;
  } else if (verb === "setFrom") next.from = editorObject(item.from) ? item.from : {};
  return editorSame(next, item) ? item : next;
}

/** Другая характеристика в позиции действия: «Установить» и значение по новому формату. */
export function scenarioEditorItemChar(item, char, meta) {
  if (item.char === char) return item;
  return scenarioEditorItemFix({ char, verb: "set" }, meta);
}

/** Секунды → `{h, m, s}` для полей «ч · мин · сек». */
export function scenarioEditorDuration(sec) {
  const total = Math.max(0, Math.round(Number(sec) || 0));
  return { h: Math.floor(total / 3600), m: Math.floor((total % 3600) / 60), s: total % 60 };
}

/** Часы, минуты, секунды → секунды; негодное — нуль. */
export function scenarioEditorSeconds(h, m, s) {
  const part = (value) => {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
  };
  return part(h) * 3600 + part(m) * 60 + part(s);
}

// ——— чистая половина: планировщик ———————————————————————————————————

const EDITOR_SUN = new Set(["sunrise", "sunset"]);
export const SCENARIO_EDITOR_EVERY_SEC = 600;
export const SCENARIO_EDITOR_TIME = "07:00";

/**
 * Правка планировщика с чисткой полей режима: «В ЧЧ:ММ» несёт `at`,
 * «Каждые» — `everySec`, восход и закат — `offsetSec` (между собой смещение
 * сохраняется). Дни не трогаются.
 */
export function scenarioEditorSchedulePatch(block, patch) {
  const next = { ...block, ...patch };
  if (patch.mode && patch.mode !== block.mode && !(EDITOR_SUN.has(patch.mode) && EDITOR_SUN.has(block.mode))) {
    delete next.at;
    delete next.everySec;
    delete next.offsetSec;
    if (patch.mode === "time") next.at = SCENARIO_EDITOR_TIME;
    else if (patch.mode === "every") next.everySec = SCENARIO_EDITOR_EVERY_SEC;
    else next.offsetSec = 0;
  }
  return next;
}

/**
 * Время восхода или заката на сегодня (по часам имитации и координатам
 * объекта; без них — 9:00 и 21:00, как в «Объёме») и время срабатывания со
 * смещением. `{text, site, note}`; `note` — подсказка про координаты.
 */
export function scenarioEditorSunText(project, simMs, block) {
  const coords = volumeSiteOf(project);
  const located = coords.latDeg !== null && coords.lonDeg !== null;
  const times = sunTimes(simMs, located ? { latDeg: coords.latDeg, lonDeg: coords.lonDeg } : null);
  const rise = block && block.mode === "sunrise";
  const at = rise ? times.riseAt : times.setAt;
  const clock = (ms) => volumeClockText(clockMsStamp(ms).minutes);
  const offset = Number(block && block.offsetSec) || 0;
  let line = text(rise ? "scenarios.editor.sunToday.sunrise" : "scenarios.editor.sunToday.sunset", { time: clock(at) });
  if (offset !== 0) line += text("scenarios.editor.sunFires", { time: clock(at + offset * 1000) });
  return { text: line, site: located, note: located ? "" : SED_WORDS.sunNoSite };
}

// ——— чистая половина: перетаскивание ———————————————————————————————

/**
 * Куда вставить перетаскиваемый блок: `raw` — место среди карточек списка
 * (0 — перед первой, `ids.length` — после последней); для `scenarioMove`
 * индекс считается в списке уже без самого блока.
 */
export function scenarioEditorDropIndex(ids, dragId, raw) {
  const from = ids.indexOf(dragId);
  return from >= 0 && from < raw ? raw - 1 : raw;
}

/**
 * Условие это или действие — чтобы не положить «Тогда» в «Если». Блок кода
 * один и тот же там и там: различает слот (`slot === "conditions"`).
 */
export function scenarioEditorBlockClass(block, slot) {
  if (!editorObject(block)) return "action";
  switch (block.type) {
    case "group":
    case "schedule":
    case "period":
    case "command":
      return "condition";
    case "device":
      return Array.isArray(block.items) ? "action" : "condition";
    case "code":
      return slot === "conditions" ? "condition" : "action";
    default:
      return "action";
  }
}

// ——— чистая половина: проблемы словами ————————————————————————————————

/** Что не заполнено в блоке — словами («Выберите устройство»); заполнен — пустая строка. */
export function scenarioEditorNeed(block) {
  const need = SED_WORDS.need;
  if (!editorObject(block)) return "";
  switch (block.type) {
    case "device": {
      const ref = editorObject(block.ref) ? block.ref : {};
      if (!ref.markId) return need.device;
      if (Array.isArray(block.items)) {
        if (block.items.length === 0) return need.item;
        for (const item of block.items) {
          if (!editorObject(item) || !item.char) return need.item;
          if (item.verb === "set" && editorBlank(item.value)) return need.value;
          if (item.verb === "setFrom" && !(editorObject(item.from) && item.from.markId && item.from.char)) return need.source;
        }
        return "";
      }
      if (!ref.char) return need.char;
      if (block.op !== "changed" && editorBlank(block.value)) return need.value;
      return "";
    }
    case "command":
      return String(block.text || "").trim() === "" ? need.text : "";
    case "code":
      return String(block.code || "").trim() === "" ? need.code : "";
    case "scenario":
      return block.scenarioId ? "" : need.scenario;
    case "http":
      return String(block.url || "").trim() === "" ? need.url : "";
    case "schedule":
      if (block.mode === "time") return volumeClockParse(block.at) === null ? need.time : "";
      if (block.mode === "every") return Number(block.everySec) > 0 ? "" : need.time;
      return "";
    case "period":
      return volumeClockParse(block.from) === null || volumeClockParse(block.to) === null ? need.time : "";
    default:
      return "";
  }
}

/**
 * Проблемы сценария по блокам: `Map<blockId, [код]>` (`incomplete`,
 * `deviceMissing`, `loop`) — по ним карточка краснеет; у карты поле
 * `noTrigger` — нет ни одной галки «триггер» (подсказка под заголовком).
 */
export function scenarioEditorProblems(project, scenario, accessories = null) {
  const found = new Map();
  found.noTrigger = false;
  if (!project || !editorObject(scenario)) return found;
  for (const issue of scenarioIssues(project, scenario, accessories)) {
    if (!issue.blockId) {
      if (issue.code === "noTrigger") found.noTrigger = true;
      continue;
    }
    if (!found.has(issue.blockId)) found.set(issue.blockId, []);
    if (!found.get(issue.blockId).includes(issue.code)) found.get(issue.blockId).push(issue.code);
  }
  return found;
}

/**
 * Правка сценария шагом истории: `{project, label}` или `null` — менять
 * нечего или сценария в объекте нет. Берёт у `next` только дерево блоков.
 */
export function scenarioEditorCommit(project, scenario, next, label) {
  if (!project || !editorObject(scenario) || !editorObject(next) || next === scenario) return null;
  if (!findScenario(project, scenario.id)) return null;
  const updated = updateScenario(project, scenario.id, { targets: next.targets });
  return updated.project === project ? null : { project: updated.project, label };
}

// ——— экранная половина ———————————————————————————————————————————————
//
// Всё ниже строит DOM и пишет в объект через `ctx.commit`. Проверяется живым
// прогоном; логика — выше.

const SED_DAYS = [1, 2, 3, 4, 5, 6, 7];
const SED_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"];
const SED_VERBS = ["run", "activate", "activateRun", "deactivate", "reset"];

// Память между перерисовками: перетаскиваемый блок и поле с фокусом.
const sedMemory = { dragId: null, focus: null, wired: new WeakSet(), closeMenu: null };

/** Подпись устройства блока: «С3 · Гостиная». */
function sedDeviceText(project, markId) {
  const mark = markId ? findMark(project, markId) : null;
  if (!mark) return "";
  const room = mark.roomId ? findRoom(project, mark.roomId) : null;
  return labelOf(project, mark.id) + (room && room.name ? " · " + room.name : "");
}

// Узел с адресом для возврата фокуса после перерисовки.
function sedFid(node, id) {
  node.dataset.fid = id;
  return node;
}

function sedSelect(options, value, on, { title = "", fid = "", className = "" } = {}) {
  const select = uiEl("select", { class: "ui-select sed-select" + (className ? " " + className : ""), title });
  for (const option of options) {
    const node = uiEl("option", { text: option.label });
    node.value = String(option.value);
    if (option.disabled) node.disabled = true;
    select.append(node);
  }
  select.value = String(value);
  if (select.value !== String(value) && options.length > 0 && value !== "") {
    // Значения нет в списке (устройство удалено, номер задержки пропал): показать его как есть.
    const extra = uiEl("option", { text: String(value) });
    extra.value = String(value);
    select.append(extra);
    select.value = String(value);
  }
  select.addEventListener("change", () => on(select.value));
  if (fid) sedFid(select, fid);
  return select;
}

// Поле числа: запятая допустима, негодное красится и не пишется.
function sedNumberInput(value, on, { unit = "", hint = "", fid = "", width = 8 } = {}) {
  const input = uiEl("input", {
    class: "ui-input sed-input sed-input--number",
    type: "text",
    value: value === undefined || value === null ? "" : String(value),
    title: hint,
    attrs: { inputmode: "decimal", autocomplete: "off", spellcheck: "false", "aria-label": hint || unit },
  });
  input.style.width = width + "ch";
  uiApply(input, () => {
    const raw = input.value.trim();
    if (raw === "") {
      input.classList.remove("is-bad");
      on(undefined);
      return;
    }
    const parsed = scenarioEditorParseNumber(raw);
    input.classList.toggle("is-bad", parsed === null);
    if (parsed !== null) on(parsed);
  });
  if (fid) sedFid(input, fid);
  const wrap = uiEl("span", { class: "sed-numwrap" }, [input]);
  if (unit) wrap.append(uiEl("span", { class: "sed-unit", text: unit }));
  return wrap;
}

function sedTextInput(value, on, { placeholder = "", fid = "", className = "" } = {}) {
  const input = uiEl("input", {
    class: "ui-input sed-input" + (className ? " " + className : ""),
    type: "text",
    value: value ?? "",
    placeholder,
    attrs: { autocomplete: "off", spellcheck: "false", "aria-label": placeholder },
  });
  uiApply(input, () => on(input.value));
  if (fid) sedFid(input, fid);
  return input;
}

function sedCodeInput(value, on, { placeholder = "", fid = "" } = {}) {
  const area = uiEl("textarea", {
    class: "ui-input sed-code",
    placeholder,
    attrs: { rows: "3", spellcheck: "false", autocomplete: "off", "aria-label": placeholder },
  });
  area.value = value ?? "";
  // Многострочное поле: Enter — новая строка, значение уходит по уходу фокуса.
  area.addEventListener("change", () => on(area.value));
  if (fid) sedFid(area, fid);
  return area;
}

function sedTimeInput(value, on, { fid = "", title = "" } = {}) {
  const input = uiEl("input", { class: "ui-input sed-input sed-input--time", type: "time", value: value || "", title, attrs: { "aria-label": title } });
  uiApply(input, () => on(input.value));
  if (fid) sedFid(input, fid);
  return input;
}

// Часы · минуты · секунды (`parts` — какие показать): задержка, «Каждые», смещение.
function sedDuration(sec, on, { parts = "hms", fid = "" } = {}) {
  const now = scenarioEditorDuration(sec);
  const fields = {};
  const read = () => scenarioEditorSeconds(fields.h ? fields.h.value : 0, fields.m ? fields.m.value : 0, fields.s ? fields.s.value : 0);
  const wrap = uiEl("span", { class: "sed-duration" });
  for (const part of parts.split("")) {
    const input = uiNumber(0, part === "h" ? 999 : 59);
    input.classList.add("sed-input", "sed-input--time-part");
    input.value = String(now[part]);
    input.setAttribute("aria-label", SED_WORDS.duration[part]);
    uiApply(input, () => on(read()));
    if (fid) sedFid(input, fid + ":" + part);
    fields[part] = input;
    wrap.append(input, uiEl("span", { class: "sed-unit", text: SED_WORDS.duration[part] }));
  }
  return wrap;
}

function sedDaysChips(days, on) {
  const have = new Set(Array.isArray(days) ? days : SED_DAYS);
  const row = uiEl("span", { class: "sed-days", attrs: { role: "group", "aria-label": SED_WORDS.days } });
  for (const day of SED_DAYS) {
    const chip = uiButton(strings.scenarios.days[day], { class: "sed-chip" + (have.has(day) ? " is-on" : ""), attrs: { "aria-pressed": have.has(day) ? "true" : "false" } });
    chip.addEventListener("click", () => {
      const next = new Set(have);
      if (next.has(day)) next.delete(day);
      else next.add(day);
      on(SED_DAYS.filter((item) => next.has(item)));
    });
    row.append(chip);
  }
  return row;
}

// ——— меню «+» ———

function sedCloseMenu() {
  if (sedMemory.closeMenu) sedMemory.closeMenu();
}

function sedMenu(label, items, { className = "", title = "" } = {}) {
  const wrap = uiEl("span", { class: "sed-menuwrap" });
  const button = uiButton("", { class: "ui-btn sed-add" + (className ? " " + className : ""), title: title || label, attrs: { "aria-haspopup": "menu", "aria-expanded": "false" } });
  button.append(uiIcon("plus"), uiEl("span", { class: "sed-add__text", text: label }));
  let popup = null;
  const close = () => {
    if (!popup) return;
    popup.remove();
    popup = null;
    button.setAttribute("aria-expanded", "false");
    document.removeEventListener("pointerdown", outside, true);
    document.removeEventListener("keydown", keys, true);
    if (sedMemory.closeMenu === close) sedMemory.closeMenu = null;
  };
  const outside = (event) => {
    if (popup && !popup.contains(event.target) && !button.contains(event.target)) close();
  };
  const keys = (event) => {
    if (event.key !== "Escape") return;
    // Escape принадлежит открытому меню: окно под ним не закрывается.
    event.preventDefault();
    event.stopPropagation();
    close();
    button.focus();
  };
  button.addEventListener("click", () => {
    if (popup) {
      close();
      return;
    }
    sedCloseMenu();
    popup = uiEl("div", { class: "sed-menu", attrs: { role: "menu" } });
    for (const item of items) {
      const entry = uiButton(item.label, { class: "sed-menu__item", attrs: { role: "menuitem" } });
      if (item.sep) entry.classList.add("has-sep");
      entry.addEventListener("click", () => {
        close();
        item.run();
      });
      popup.append(entry);
    }
    wrap.append(popup);
    button.setAttribute("aria-expanded", "true");
    sedMemory.closeMenu = close;
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("keydown", keys, true);
    const first = popup.querySelector("button");
    if (first) first.focus();
  });
  wrap.append(button);
  return wrap;
}

// ——— выбор устройства ———

function sedPickDevice(env, onPick) {
  let query = "";
  const search = uiEl("input", { class: "ui-input sed-pick__search", type: "search", placeholder: strings.scenarios.side.search, attrs: { "aria-label": strings.scenarios.side.search, autocomplete: "off" } });
  const list = uiEl("div", { class: "sed-pick__list" });
  let modal = null;
  const draw = () => {
    list.replaceChildren();
    const groups = scenariosDeviceGroups(env.ctx.project, query);
    if (groups.length === 0) {
      list.append(uiEl("p", { class: "sed-pick__none", text: env.accessories.length === 0 ? strings.scenarios.side.none : strings.scenarios.side.noMatch }));
      return;
    }
    for (const group of groups) {
      list.append(uiEl("h4", { class: "sed-pick__room", text: group.name }));
      for (const device of group.devices) {
        const button = uiButton("", { class: "sed-pick__device" });
        button.append(uiEl("b", { text: device.label }), uiEl("span", { text: [device.typeName, device.kindLabel].filter(Boolean).join(" · ") }));
        button.addEventListener("click", () => {
          if (modal) modal.close();
          onPick(device.markId);
        });
        list.append(button);
      }
    }
  };
  search.addEventListener("input", () => {
    query = search.value;
    draw();
  });
  draw();
  modal = uiModal({
    title: SED_WORDS.pickTitle,
    body: [search, list],
    actions: [uiButton(SED_WORDS.pickClose, { class: "ui-btn", on: { click: () => modal.close() } })],
  });
  search.focus();
}

// ——— среда одного рисования ———

function sedEnv(host, ctx) {
  const accessories = homeAccessories(ctx.project);
  const env = {
    host,
    ctx,
    accessories,
    byMark: new Map(accessories.map((item) => [item.markId, item])),
    problems: scenarioEditorProblems(ctx.project, ctx.scenario, accessories),
    simMs: appClockSimMs(Date.now()),
    scenarios: scenariosInOrder(ctx.project),
    // Свежий сценарий: две правки подряд до перерисовки не теряют друг друга.
    latest() {
      const project = ctx.api.getState().project;
      return project ? findScenario(project, ctx.scenario.id) : null;
    },
    edit(label, run) {
      const state = ctx.api.getState();
      const current = state.project ? findScenario(state.project, ctx.scenario.id) : null;
      if (!current) return;
      const result = scenarioEditorCommit(state.project, current, run(current), label);
      if (result) ctx.commit(result);
    },
    // Правка полей одного блока: `build(блок)` отдаёт блок целиком, в дерево уходит разница.
    update(blockId, label, build) {
      env.edit(label, (scenario) => {
        const found = scenarioFind(scenario, blockId);
        if (!found) return scenario;
        const made = build(found.block);
        if (made === found.block) return scenario;
        const patch = {};
        for (const key of Object.keys(found.block)) if (!(key in made)) patch[key] = undefined;
        for (const [key, value] of Object.entries(made)) if (!editorSame(found.block[key], value)) patch[key] = value;
        return scenarioPatch(scenario, blockId, patch);
      });
    },
    meta(ref) {
      const accessory = ref && ref.markId ? env.byMark.get(ref.markId) : null;
      const service = accessory ? accessory.services[ref.service] : null;
      const slot = service && Array.isArray(service.chars) ? service.chars.find((item) => item.type === ref.char) : null;
      return slot ? slot.meta || null : null;
    },
  };
  return env;
}

// ——— карточка блока ———

function sedMarksOf(block) {
  return scenarioBlockMarks(block);
}

function sedProblemLines(env, block) {
  const codes = env.problems.get(block.id) || [];
  const lines = [];
  for (const code of codes) {
    if (code === "incomplete") lines.push({ kind: "bad", text: scenarioEditorNeed(block) || strings.scenarios.issues.incomplete });
    else if (code === "deviceMissing") lines.push({ kind: "bad", text: SED_WORDS.deviceGone });
    else if (code === "loop") lines.push({ kind: "warn", text: scenariosIssueText(env.ctx.project, env.ctx.scenario, { blockId: block.id, code }) });
  }
  return lines;
}

// Карточка: ручка, заголовок, кнопки ↑ ↓ ✕, тело, строки проблем.
function sedCard(env, block, place, { kind, head, body = [], tools = true }) {
  const lines = sedProblemLines(env, block);
  const bad = lines.some((line) => line.kind === "bad");
  const card = uiEl("div", {
    class: "sed-card sed-card--" + kind + (bad ? " is-bad" : "") + (lines.some((line) => line.kind === "warn") ? " is-warn" : ""),
    attrs: { "data-block": block.id },
  });
  const top = uiEl("div", { class: "sed-card__head" });
  if (tools) {
    const handle = uiEl("span", { class: "sed-handle", title: SED_WORDS.drag, attrs: { draggable: "true", "aria-hidden": "true" } });
    handle.append(uiEl("span", { text: "⠿" }));
    handle.addEventListener("dragstart", (event) => {
      sedMemory.dragId = block.id;
      event.stopPropagation();
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", block.id);
      }
      card.classList.add("is-dragging");
    });
    handle.addEventListener("dragend", () => {
      sedMemory.dragId = null;
      card.classList.remove("is-dragging");
      for (const line of env.host.querySelectorAll(".sed-dropline")) line.remove();
    });
    top.append(handle);
  }
  top.append(uiEl("div", { class: "sed-card__title" }, head));
  if (tools) {
    const label = strings.history;
    top.append(
      uiEl("div", { class: "sed-card__tools" }, [
        uiIconButton("up", {
          title: SED_WORDS.up,
          class: "ui-btn sed-tool",
          on: { click: () => env.edit(label.scenarioBlockMove, (scenario) => scenarioShift(scenario, block.id, -1)) },
        }),
        uiIconButton("down", {
          title: SED_WORDS.down,
          class: "ui-btn sed-tool",
          on: { click: () => env.edit(label.scenarioBlockMove, (scenario) => scenarioShift(scenario, block.id, 1)) },
        }),
        uiIconButton("trash", {
          title: SED_WORDS.remove,
          class: "ui-btn ui-btn--danger sed-tool",
          on: { click: () => env.edit(label.scenarioBlockRemove, (scenario) => scenarioRemove(scenario, block.id)) },
        }),
      ]),
    );
  }
  card.append(top);
  for (const node of body) if (node) card.append(node);
  for (const line of lines) card.append(uiEl("p", { class: "sed-card__problem is-" + line.kind, text: line.text }));
  const marks = sedMarksOf(block);
  if (marks.length > 0) {
    card.addEventListener("pointerenter", () => env.ctx.highlight(marks));
    card.addEventListener("pointerleave", () => env.ctx.highlight([]));
  }
  return card;
}

function sedDeviceRow(env, block, ref, onPick, fid) {
  const wrap = uiEl("span", { class: "sed-device" });
  const markId = ref && ref.markId;
  const known = markId ? sedDeviceText(env.ctx.project, markId) : "";
  const button = uiButton("", {
    class: "ui-btn sed-device__name" + (markId && !known ? " is-gone" : "") + (markId ? "" : " is-empty"),
    title: SED_WORDS.pickHint,
  });
  button.textContent = !markId ? SED_WORDS.pickNone : known || strings.scenarios.phrase.deviceGone;
  sedFid(button, fid);
  button.addEventListener("click", () => sedPickDevice(env, onPick));
  wrap.append(button);
  const picked = env.ctx.picked;
  const fromPlan = uiButton("", { class: "ui-btn sed-device__plan", title: picked ? SED_WORDS.fromPlan : SED_WORDS.fromPlanNone });
  fromPlan.append(uiIcon("view"));
  fromPlan.disabled = !picked || picked === markId || !env.byMark.has(picked);
  fromPlan.addEventListener("click", () => onPick(picked));
  wrap.append(fromPlan);
  return wrap;
}

// ——— условия ———

function sedTrigger(env, block, on) {
  const button = uiButton("", {
    class: "sed-trigger" + (block.trigger === true ? " is-on" : ""),
    title: block.trigger === true ? SED_WORDS.triggerOn : SED_WORDS.triggerOff,
    attrs: { "aria-pressed": block.trigger === true ? "true" : "false", "aria-label": SED_WORDS.triggerLabel },
  });
  button.addEventListener("click", () => on(block.trigger !== true));
  return button;
}

function sedValueControl(spec, value, on, fid) {
  if (spec.kind === "options") {
    const options = spec.options.map((item) => ({ value: item.value, label: item.label }));
    const present = options.some((item) => item.value === value);
    if (!present) options.unshift({ value: "", label: SED_WORDS.valueNone });
    return sedSelect(options, present ? value : "", (raw) => {
      const picked = spec.options.find((item) => String(item.value) === raw);
      on(picked ? picked.value : undefined);
    }, { fid, className: "sed-select--value" });
  }
  if (spec.kind === "number") return sedNumberInput(value, on, { unit: spec.unit, hint: spec.hint, fid });
  return sedTextInput(value, on, { fid });
}

function sedDeviceCondition(env, block, place) {
  const label = strings.history.scenarioBlockEdit;
  const ref = editorObject(block.ref) ? block.ref : {};
  const accessory = ref.markId ? env.byMark.get(ref.markId) : null;
  const meta = env.meta(ref);
  const choices = scenarioEditorCharChoices(accessory);
  const fid = block.id + ":";
  const pick = (markId) => {
    const target = env.byMark.get(markId);
    const first = scenarioEditorCharChoices(target)[0];
    if (!target || !first) return;
    env.update(block.id, label, (current) => scenarioEditorConditionRef(current, { markId, service: first.service, char: first.char }, first.meta));
  };
  const head = [sedDeviceRow(env, block, ref, pick, fid + "device")];
  head.push(sedTrigger(env, block, (on) => env.update(block.id, label, (current) => ({ ...current, trigger: on }))));
  const row = uiEl("div", { class: "sed-row" });
  if (accessory && choices.length > 0) {
    const key = ref.service + ":" + ref.char;
    const options = choices.map((item) => ({ value: item.key, label: item.label }));
    row.append(
      sedSelect(options, choices.some((item) => item.key === key) ? key : "", (raw) => {
        const chosen = choices.find((item) => item.key === raw);
        if (!chosen) return;
        env.update(block.id, label, (current) => scenarioEditorConditionRef(current, { markId: ref.markId, service: chosen.service, char: chosen.char }, chosen.meta));
      }, { fid: fid + "char", title: SED_WORDS.char, className: "sed-select--char" }),
    );
  }
  if (meta) {
    const ops = scenarioOps(meta).map((op) => ({ value: op, label: scenarioEditorOpLabel(op) }));
    row.append(
      sedSelect(ops, block.op, (op) => env.update(block.id, label, (current) => scenarioEditorConditionFix({ ...current, op }, meta)), {
        fid: fid + "op",
        title: SED_WORDS.op,
        className: "sed-select--op",
      }),
    );
    if (block.op !== "changed") {
      const spec = scenarioEditorValueSpec(meta, ref.char);
      row.append(
        sedValueControl(spec, block.value, (value) => env.update(block.id, label, (current) => scenarioEditorConditionFix({ ...current, value }, meta)), fid + "value"),
      );
    }
    // ∞ — только у числовых сравнений и только вместе с триггером (G07).
    if (scenarioRepeatAllowed(block, meta)) {
      const on = block.repeat !== false;
      const live = block.trigger === true;
      const infinity = uiButton(SED_WORDS.infinity, {
        class: "sed-infinity" + (on && live ? " is-on" : "") + (live ? "" : " is-off"),
        title: live ? (on ? SED_WORDS.infinityOn : SED_WORDS.infinityOff) : SED_WORDS.infinityNoTrigger,
        attrs: { "aria-pressed": on && live ? "true" : "false" },
      });
      infinity.disabled = !live;
      infinity.addEventListener("click", () => env.update(block.id, label, (current) => ({ ...current, repeat: on ? false : undefined })));
      row.append(infinity);
    }
    if (scenarioEditorHoldAllowed(block, meta)) {
      const hold = editorObject(block.hold) ? block.hold : null;
      const modes = [
        { value: "", label: SED_WORDS.holdNone },
        { value: "more", label: SED_WORDS.holdMore },
        { value: "less", label: SED_WORDS.holdLess },
      ];
      row.append(
        sedSelect(modes, hold ? hold.mode : "", (mode) => env.update(block.id, label, (current) => ({ ...current, hold: mode ? { mode, sec: current.hold && current.hold.sec > 0 ? current.hold.sec : 60 } : undefined })), {
          fid: fid + "hold",
          title: SED_WORDS.holdTitle,
          className: "sed-select--hold",
        }),
      );
      if (hold) {
        row.append(
          sedDuration(hold.sec, (sec) => env.update(block.id, label, (current) => ({ ...current, hold: { mode: current.hold ? current.hold.mode : hold.mode, sec } })), { parts: "ms", fid: fid + "holdsec" }),
        );
      }
    }
  }
  return sedCard(env, block, place, { kind: "condition", head, body: [row] });
}

function sedScheduleCondition(env, block, place) {
  const label = strings.history.scenarioBlockEdit;
  const fid = block.id + ":";
  const patch = (changes) => env.update(block.id, label, (current) => scenarioEditorSchedulePatch(current, changes));
  const modes = ["time", "every", "sunrise", "sunset"].map((mode) => ({ value: mode, label: SED_WORDS.schedule[mode] }));
  const row = uiEl("div", { class: "sed-row" }, [sedSelect(modes, block.mode, (mode) => patch({ mode }), { fid: fid + "mode", title: SED_WORDS.scheduleMode })]);
  if (block.mode === "time") row.append(sedTimeInput(block.at, (at) => patch({ at }), { fid: fid + "at", title: SED_WORDS.scheduleAt }));
  else if (block.mode === "every") {
    const total = Number(block.everySec) > 0 ? Number(block.everySec) : SCENARIO_EDITOR_EVERY_SEC;
    const unit = total % 3600 === 0 ? 3600 : total % 60 === 0 ? 60 : 1;
    const units = [
      { value: 3600, label: strings.scenarios.units.h },
      { value: 60, label: strings.scenarios.units.m },
      { value: 1, label: strings.scenarios.units.s },
    ];
    row.append(
      uiEl("span", { class: "sed-unit", text: SED_WORDS.scheduleEvery }),
      sedNumberInput(total / unit, (amount) => patch({ everySec: Math.max(1, Math.round((amount || 1) * unit)) }), { fid: fid + "every", width: 6, hint: SED_WORDS.scheduleEvery }),
      sedSelect(units, unit, (raw) => patch({ everySec: Math.max(1, Math.round((total / unit) * Number(raw))) }), { fid: fid + "unit", title: SED_WORDS.scheduleUnit }),
    );
  } else {
    const offset = Number(block.offsetSec) || 0;
    const sides = [
      { value: "after", label: SED_WORDS.sunAfter },
      { value: "before", label: SED_WORDS.sunBefore },
    ];
    row.append(
      sedSelect(sides, offset < 0 ? "before" : "after", (side) => patch({ offsetSec: side === "before" ? -Math.abs(offset) : Math.abs(offset) }), { fid: fid + "side", title: SED_WORDS.sunSide }),
      sedDuration(Math.abs(offset), (sec) => patch({ offsetSec: offset < 0 ? -sec : sec }), { fid: fid + "offset" }),
    );
  }
  const body = [row, sedDaysChips(block.days, (days) => patch({ days }))];
  if (block.mode === "sunrise" || block.mode === "sunset") {
    const sun = scenarioEditorSunText(env.ctx.project, env.simMs, block);
    body.push(uiEl("p", { class: "sed-sun", text: sun.text }));
    if (sun.note) body.push(uiEl("p", { class: "sed-sun is-note", text: sun.note }));
  }
  const head = [uiEl("span", { class: "sed-kind", text: SED_WORDS.kinds.schedule }), uiEl("span", { class: "sed-always", title: SED_WORDS.alwaysTrigger, text: SED_WORDS.alwaysTriggerShort })];
  return sedCard(env, block, place, { kind: "condition", head, body });
}

function sedPeriodCondition(env, block, place) {
  const label = strings.history.scenarioBlockEdit;
  const fid = block.id + ":";
  const patch = (changes) => env.update(block.id, label, (current) => ({ ...current, ...changes }));
  const row = uiEl("div", { class: "sed-row" }, [
    sedTimeInput(block.from, (from) => patch({ from }), { fid: fid + "from", title: SED_WORDS.periodFrom }),
    uiEl("span", { class: "sed-unit", text: SED_WORDS.periodTo }),
    sedTimeInput(block.to, (to) => patch({ to }), { fid: fid + "to", title: SED_WORDS.periodToTitle }),
  ]);
  const head = [uiEl("span", { class: "sed-kind", text: SED_WORDS.kinds.period }), sedTrigger(env, block, (on) => patch({ trigger: on }))];
  return sedCard(env, block, place, { kind: "condition", head, body: [row, sedDaysChips(block.days, (days) => patch({ days }))] });
}

function sedCodeBlock(env, block, place, kind) {
  const label = strings.history.scenarioBlockEdit;
  const hint = kind === "condition" ? SED_WORDS.codeConditionHint : SED_WORDS.codeActionHint;
  const head = [uiEl("span", { class: "sed-kind", text: kind === "condition" ? SED_WORDS.kinds.codeCondition : SED_WORDS.kinds.codeAction })];
  const area = sedCodeInput(block.code, (code) => env.update(block.id, label, (current) => ({ ...current, code })), { placeholder: hint, fid: block.id + ":code" });
  return sedCard(env, block, place, { kind, head, body: [area, uiEl("p", { class: "sed-hint", text: hint })] });
}

function sedCommandCondition(env, block, place) {
  const label = strings.history.scenarioBlockEdit;
  const input = sedTextInput(block.text, (value) => env.update(block.id, label, (current) => ({ ...current, text: value })), { placeholder: SED_WORDS.commandPlaceholder, fid: block.id + ":text" });
  const head = [uiEl("span", { class: "sed-kind", text: SED_WORDS.kinds.command }), uiEl("span", { class: "sed-always", title: SED_WORDS.alwaysTrigger, text: SED_WORDS.alwaysTriggerShort })];
  return sedCard(env, block, place, { kind: "condition", head, body: [uiEl("div", { class: "sed-row" }, [input]), uiEl("p", { class: "sed-hint", text: SED_WORDS.commandHint })] });
}

function sedGroup(env, group, place, { tools }) {
  const label = strings.history.scenarioBlockEdit;
  const modes = [
    { value: "OR", label: SED_WORDS.modeAny },
    { value: "AND", label: SED_WORDS.modeAll },
  ];
  const head = [uiEl("span", { class: "sed-kind", text: SED_WORDS.kinds.group }), sedSelect(modes, group.mode === "AND" ? "AND" : "OR", (mode) => env.update(group.id, label, (current) => ({ ...current, mode })), { fid: group.id + ":mode", title: SED_WORDS.modeTitle, className: "sed-select--mode" })];
  const list = sedList(env, group.conditions, group.id, "conditions");
  return sedCard(env, group, place, { kind: "group", head, body: [list], tools });
}

function sedCondition(env, block, place) {
  switch (block.type) {
    case "device":
      return sedDeviceCondition(env, block, place);
    case "schedule":
      return sedScheduleCondition(env, block, place);
    case "period":
      return sedPeriodCondition(env, block, place);
    case "code":
      return sedCodeBlock(env, block, place, "condition");
    case "command":
      return sedCommandCondition(env, block, place);
    case "group":
      return sedGroup(env, block, place, { tools: true });
    default:
      return sedCard(env, block, place, { kind: "condition", head: [uiEl("span", { class: "sed-kind", text: strings.scenarios.phrase.block })] });
  }
}

// ——— действия ———

function sedActionDevice(env, block, place) {
  const label = strings.history.scenarioBlockEdit;
  const ref = editorObject(block.ref) ? block.ref : {};
  const accessory = ref.markId ? env.byMark.get(ref.markId) : null;
  const items = Array.isArray(block.items) ? block.items : [];
  const fid = block.id + ":";
  const writable = scenarioEditorCharChoices(accessory, { write: true });
  const services = [];
  for (const choice of writable) if (!services.some((item) => item.service === choice.service)) services.push(choice);
  // Сервисы — в порядке карточки, а не «сначала записываемые»: список сервисов
  // не про запись.
  services.sort((a, b) => a.service - b.service);
  const pick = (markId) => {
    const target = env.byMark.get(markId);
    const first = scenarioEditorCharChoices(target, { write: true })[0];
    if (!target || !first) {
      env.ctx.api.notify(SED_WORDS.noWritable, "error");
      return;
    }
    env.update(block.id, label, (current) => ({ ...current, ref: { markId, service: first.service }, items: [scenarioEditorItemChar({ char: "", verb: "set" }, first.char, first.meta)] }));
  };
  const head = [sedDeviceRow(env, block, ref, pick, fid + "device")];
  const body = [];
  const serviceKey = Number.isInteger(ref.service) ? ref.service : "";
  if (accessory && services.length > 1) {
    const options = services.map((item) => ({ value: item.service, label: item.label.split(" · ")[0] }));
    body.push(
      sedSelect(options, serviceKey, (raw) => {
        const first = writable.find((item) => String(item.service) === raw && !item.readOnly) || writable.find((item) => String(item.service) === raw);
        if (!first) return;
        env.update(block.id, label, (current) => ({ ...current, ref: { markId: ref.markId, service: first.service }, items: [scenarioEditorItemChar({ char: "", verb: "set" }, first.char, first.meta)] }));
      }, { fid: fid + "service", title: SED_WORDS.service, className: "sed-select--service" }),
    );
  }
  const own = writable.filter((item) => item.service === ref.service);
  items.forEach((item, index) => {
    const row = uiEl("div", { class: "sed-row sed-item" });
    const meta = env.meta({ markId: ref.markId, service: ref.service, char: item.char });
    const charOptions = own.map((choice) => ({
      value: choice.char,
      label: choice.readOnly
        ? text("scenarios.editor.readOnlyChar", { char: strings.sim.chars[choice.char] || choice.char })
        : strings.sim.chars[choice.char] || choice.char,
    }));
    const edit = (build) =>
      env.update(block.id, label, (current) => ({ ...current, items: current.items.map((entry, at) => (at === index ? build(entry) : entry)) }));
    if (accessory) {
      row.append(
        sedSelect(charOptions, item.char || "", (char) => {
          const chosen = own.find((choice) => choice.char === char);
          if (chosen) edit((entry) => scenarioEditorItemChar(entry, char, chosen.meta));
        }, { fid: fid + index + ":char", title: SED_WORDS.char, className: "sed-select--char" }),
      );
    }
    if (meta) {
      const verbs = scenarioEditorVerbs(meta).map((verb) => ({ value: verb, label: SED_WORDS.verbs[verb] }));
      row.append(sedSelect(verbs, item.verb, (verb) => edit((entry) => scenarioEditorItemFix({ ...entry, verb }, meta)), { fid: fid + index + ":verb", title: SED_WORDS.verb, className: "sed-select--verb" }));
      if (item.verb === "set") {
        row.append(sedValueControl(scenarioEditorValueSpec(meta, item.char), item.value, (value) => edit((entry) => ({ ...entry, value })), fid + index + ":value"));
      } else if (item.verb === "increase") {
        const spec = scenarioEditorValueSpec(meta, item.char);
        row.append(
          sedNumberInput(item.step, (step) => edit((entry) => ({ char: entry.char, verb: entry.verb, ...(step === undefined ? {} : { step }) })), {
            unit: spec.unit,
            hint: text("scenarios.editor.stepHint", { step: meta.step || 1 }),
            fid: fid + index + ":step",
            width: 6,
          }),
          uiEl("span", { class: "sed-unit", text: text("scenarios.editor.stepDefault", { step: meta.step || 1 }) }),
        );
      } else if (item.verb === "setFrom") {
        const from = editorObject(item.from) ? item.from : {};
        const source = from.markId ? env.byMark.get(from.markId) : null;
        const sourceChoices = scenarioEditorCharChoices(source).filter((choice) => !editorEventLike(choice.meta));
        const setSource = (markId) => {
          const target = env.byMark.get(markId);
          const first = scenarioEditorCharChoices(target).filter((choice) => !editorEventLike(choice.meta))[0];
          if (target && first) edit((entry) => ({ ...entry, from: { markId, service: first.service, char: first.char } }));
        };
        row.append(sedDeviceRow(env, block, from, setSource, fid + index + ":from"));
        if (source && sourceChoices.length > 0) {
          const key = from.service + ":" + from.char;
          row.append(
            sedSelect(sourceChoices.map((choice) => ({ value: choice.key, label: choice.label })), sourceChoices.some((choice) => choice.key === key) ? key : "", (raw) => {
              const chosen = sourceChoices.find((choice) => choice.key === raw);
              if (chosen) edit((entry) => ({ ...entry, from: { markId: from.markId, service: chosen.service, char: chosen.char } }));
            }, { fid: fid + index + ":fromchar", title: SED_WORDS.fromChar, className: "sed-select--char" }),
          );
        }
      }
    }
    row.append(
      uiIconButton("close", {
        title: SED_WORDS.itemRemove,
        class: "ui-btn sed-tool",
        on: { click: () => env.update(block.id, label, (current) => ({ ...current, items: current.items.filter((entry, at) => at !== index) })) },
      }),
    );
    body.push(row);
  });
  if (accessory && own.length > 0) {
    const used = new Set(items.map((item) => item.char));
    const free = own.find((choice) => !used.has(choice.char)) || own[0];
    body.push(
      uiButton(SED_WORDS.itemAdd, {
        class: "ui-btn sed-item-add",
        on: {
          click: () =>
            env.update(block.id, label, (current) => ({ ...current, items: [...(current.items || []), scenarioEditorItemChar({ char: "", verb: "set" }, free.char, free.meta)] })),
        },
      }),
    );
  }
  return sedCard(env, block, place, { kind: "action", head, body });
}

function sedActionDelay(env, block, place) {
  const label = strings.history.scenarioBlockEdit;
  const fid = block.id + ":";
  const timers = [
    { value: "one", label: SED_WORDS.timerOne },
    { value: "new", label: SED_WORDS.timerNew },
  ];
  const head = [
    uiEl("span", { class: "sed-kind", text: text("scenarios.editor.delayNo", { no: block.no }) }),
    sedDuration(block.sec, (sec) => env.update(block.id, label, (current) => ({ ...current, sec })), { fid: fid + "sec" }),
    sedSelect(timers, block.timer === "new" ? "new" : "one", (timer) => env.update(block.id, label, (current) => ({ ...current, timer })), { fid: fid + "timer", title: SED_WORDS.timerTitle }),
  ];
  return sedCard(env, block, place, { kind: "action", head, body: [sedList(env, block.blocks, block.id, "blocks")] });
}

function sedActionResetDelay(env, block, place) {
  const label = strings.history.scenarioBlockEdit;
  const numbers = scenarioDelayNumbers(env.ctx.scenario);
  if (Number.isFinite(Number(block.no)) && block.no !== null && !numbers.includes(Number(block.no))) numbers.push(Number(block.no));
  const options = [{ value: "", label: SED_WORDS.resetAll }, ...numbers.sort((a, b) => a - b).map((no) => ({ value: no, label: text("scenarios.editor.delayNo", { no }) }))];
  const head = [
    uiEl("span", { class: "sed-kind", text: SED_WORDS.kinds.resetDelay }),
    sedSelect(options, block.no === null || block.no === undefined ? "" : block.no, (raw) => env.update(block.id, label, (current) => ({ ...current, no: raw === "" ? null : Number(raw) })), { fid: block.id + ":no", title: SED_WORDS.resetTitle }),
  ];
  return sedCard(env, block, place, { kind: "action", head });
}

function sedActionScenario(env, block, place) {
  const label = strings.history.scenarioBlockEdit;
  const verbs = SED_VERBS.map((verb) => ({ value: verb, label: SED_WORDS.scenarioVerbs[verb] }));
  const targets = [{ value: "", label: SED_WORDS.scenarioPick }, ...env.scenarios.map((item) => ({ value: item.id, label: item.name + (item.id === env.ctx.scenario.id ? SED_WORDS.scenarioSelf : "") }))];
  const head = [
    sedSelect(verbs, SED_VERBS.includes(block.verb) ? block.verb : "run", (verb) => env.update(block.id, label, (current) => ({ ...current, verb })), { fid: block.id + ":verb", title: SED_WORDS.verb }),
    sedSelect(targets, block.scenarioId || "", (scenarioId) => env.update(block.id, label, (current) => ({ ...current, scenarioId })), { fid: block.id + ":target", title: SED_WORDS.scenarioTarget, className: "sed-select--wide" }),
  ];
  return sedCard(env, block, place, { kind: "action", head });
}

function sedActionNotify(env, block, place) {
  const label = strings.history.scenarioBlockEdit;
  const head = [uiEl("span", { class: "sed-kind", text: SED_WORDS.kinds.notify })];
  const input = sedTextInput(block.text, (value) => env.update(block.id, label, (current) => ({ ...current, text: value })), { placeholder: SED_WORDS.notifyPlaceholder, fid: block.id + ":text" });
  return sedCard(env, block, place, { kind: "action", head, body: [uiEl("div", { class: "sed-row" }, [input])] });
}

function sedActionHttp(env, block, place) {
  const label = strings.history.scenarioBlockEdit;
  const methods = SED_METHODS.map((method) => ({ value: method, label: method }));
  const head = [uiEl("span", { class: "sed-kind", text: SED_WORDS.kinds.http })];
  const row = uiEl("div", { class: "sed-row" }, [
    sedSelect(methods, SED_METHODS.includes(block.method) ? block.method : "GET", (method) => env.update(block.id, label, (current) => ({ ...current, method })), { fid: block.id + ":method", title: SED_WORDS.httpMethod }),
    sedTextInput(block.url, (url) => env.update(block.id, label, (current) => ({ ...current, url })), { placeholder: SED_WORDS.httpUrl, fid: block.id + ":url", className: "sed-input--wide" }),
  ]);
  return sedCard(env, block, place, { kind: "action", head, body: [row, uiEl("p", { class: "sed-hint", text: SED_WORDS.httpHint })] });
}

function sedAction(env, block, place) {
  switch (block.type) {
    case "if":
      return sedIf(env, block, place);
    case "device":
      return sedActionDevice(env, block, place);
    case "delay":
      return sedActionDelay(env, block, place);
    case "resetDelay":
      return sedActionResetDelay(env, block, place);
    case "scenario":
      return sedActionScenario(env, block, place);
    case "code":
      return sedCodeBlock(env, block, place, "action");
    case "notify":
      return sedActionNotify(env, block, place);
    case "http":
      return sedActionHttp(env, block, place);
    default:
      return sedCard(env, block, place, { kind: "action", head: [uiEl("span", { class: "sed-kind", text: strings.scenarios.phrase.block })] });
  }
}

// ——— «Если — Тогда — Иначе» ———

function sedMenuItems(env, listKind, parentId, slot, extra = []) {
  const history = strings.history;
  const group = listKind === "conditions" ? "cond" : listKind === "root" ? "root" : "act";
  const items = scenarioMenu(listKind).map((kind) => ({
    label: (listKind === "root" && kind !== "if" ? SED_WORDS.menu.act[kind] : SED_WORDS.menu[group][kind]) || kind,
    run: () => env.edit(history.scenarioBlockAdd, (scenario) => scenarioAddBlock(scenario, parentId, slot, kind).scenario),
  }));
  return [...items, ...extra];
}

function sedIf(env, block, place) {
  const history = strings.history;
  const group = editorObject(block.if) ? block.if : { id: block.id + "g", mode: "OR", conditions: [] };
  const hasElse = Array.isArray(block.else);
  const elseItem = hasElse
    ? { label: SED_WORDS.menu.removeElse, run: () => env.edit(history.scenarioBlockEdit, (scenario) => scenarioSetElse(scenario, block.id, false)), sep: true }
    : { label: SED_WORDS.menu.addElse, run: () => env.edit(history.scenarioBlockEdit, (scenario) => scenarioSetElse(scenario, block.id, true)), sep: true };
  const modes = [
    { value: "OR", label: SED_WORDS.modeAny },
    { value: "AND", label: SED_WORDS.modeAll },
  ];
  const head = [
    uiEl("span", { class: "sed-keyword", text: SED_WORDS.if }),
    sedSelect(modes, group.mode === "AND" ? "AND" : "OR", (mode) => env.update(group.id, history.scenarioBlockEdit, (current) => ({ ...current, mode })), { fid: group.id + ":mode", title: SED_WORDS.modeTitle, className: "sed-select--mode" }),
  ];
  const conditions = uiEl("div", { class: "sed-section sed-section--if" }, [
    sedList(env, group.conditions, group.id, "conditions"),
    uiEl("div", { class: "sed-section__add" }, [sedMenu(SED_WORDS.add, sedMenuItems(env, "conditions", group.id, "conditions", [elseItem]), { title: SED_WORDS.addCondition })]),
  ]);
  // «Тогда» с секундомером «Каждые N».
  const every = editorObject(block.every) && Number(block.every.sec) > 0 ? block.every : null;
  const thenHead = uiEl("div", { class: "sed-section__head" }, [
    uiEl("span", { class: "sed-keyword", text: SED_WORDS.then }),
    sedSelect(
      [
        { value: "", label: SED_WORDS.everyNone },
        { value: "on", label: SED_WORDS.everyOn },
      ],
      every ? "on" : "",
      (raw) => env.update(block.id, history.scenarioBlockEdit, (current) => ({ ...current, every: raw === "on" ? { sec: 60 } : null })),
      { fid: block.id + ":every", title: SED_WORDS.everyTitle, className: "sed-select--every" },
    ),
  ]);
  if (every) thenHead.append(sedDuration(every.sec, (sec) => env.update(block.id, history.scenarioBlockEdit, (current) => ({ ...current, every: { sec } })), { parts: "ms", fid: block.id + ":everysec" }));
  const thenBody = uiEl("div", { class: "sed-section sed-section--then" }, [
    thenHead,
    sedList(env, block.then, block.id, "then"),
    uiEl("div", { class: "sed-section__add" }, [sedMenu(SED_WORDS.add, sedMenuItems(env, "actions", block.id, "then", [elseItem]), { title: SED_WORDS.addAction })]),
  ]);
  const body = [conditions, thenBody];
  if (hasElse) {
    const elseHead = uiEl("div", { class: "sed-section__head" }, [
      uiEl("span", { class: "sed-keyword", text: SED_WORDS.else }),
      uiButton(SED_WORDS.menu.removeElse, { class: "ui-btn sed-else-remove", on: { click: () => env.edit(history.scenarioBlockEdit, (scenario) => scenarioSetElse(scenario, block.id, false)) } }),
    ]);
    body.push(
      uiEl("div", { class: "sed-section sed-section--else" }, [
        elseHead,
        sedList(env, block.else, block.id, "else"),
        uiEl("div", { class: "sed-section__add" }, [sedMenu(SED_WORDS.add, sedMenuItems(env, "actions", block.id, "else"), { title: SED_WORDS.addAction })]),
      ]),
    );
  }
  return sedCard(env, block, place, { kind: "if", head, body });
}

// ——— список блоков и перетаскивание ———

function sedAllowedHere(scenario, dragId, slot) {
  const found = dragId ? scenarioFind(scenario, dragId) : null;
  if (!found) return false;
  const want = slot === "conditions" ? "condition" : "action";
  return scenarioEditorBlockClass(found.block, found.slot) === want;
}

// Место вставки по высоте указателя: сколько карточек списка целиком выше него.
function sedDropRaw(list, y) {
  const cards = [...list.children].filter((node) => node.classList && node.classList.contains("sed-card"));
  let raw = 0;
  for (const card of cards) {
    const box = card.getBoundingClientRect();
    if (y > box.top + box.height / 2) raw += 1;
  }
  return { raw, cards };
}

function sedList(env, blocks, parentId, slot) {
  const list = uiEl("div", { class: "sed-list sed-list--" + slot, attrs: { "data-parent": parentId || "", "data-slot": slot } });
  const items = Array.isArray(blocks) ? blocks : [];
  const size = items.length;
  items.forEach((block, index) => {
    if (!editorObject(block)) return;
    const place = { parentId, slot, index, size };
    list.append(slot === "conditions" ? sedCondition(env, block, place) : sedAction(env, block, place));
  });
  if (size === 0) list.classList.add("is-empty");
  const clear = () => {
    for (const line of env.host.querySelectorAll(".sed-dropline")) line.remove();
    list.classList.remove("is-drop");
  };
  list.addEventListener("dragover", (event) => {
    const scenario = env.latest();
    if (!scenario || !sedAllowedHere(scenario, sedMemory.dragId, slot)) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    const { raw, cards } = sedDropRaw(list, event.clientY);
    for (const line of env.host.querySelectorAll(".sed-dropline")) line.remove();
    list.classList.add("is-drop");
    const line = uiEl("div", { class: "sed-dropline" });
    if (raw >= cards.length) list.append(line);
    else list.insertBefore(line, cards[raw]);
  });
  list.addEventListener("dragleave", (event) => {
    if (!list.contains(event.relatedTarget)) clear();
  });
  list.addEventListener("drop", (event) => {
    const dragId = sedMemory.dragId;
    const scenario = env.latest();
    if (!scenario || !sedAllowedHere(scenario, dragId, slot)) return;
    event.preventDefault();
    event.stopPropagation();
    const { raw, cards } = sedDropRaw(list, event.clientY);
    const ids = cards.map((node) => node.dataset.block);
    clear();
    sedMemory.dragId = null;
    const index = scenarioEditorDropIndex(ids, dragId, raw);
    env.edit(strings.history.scenarioBlockMove, (current) => scenarioMove(current, dragId, parentId, slot, index));
  });
  return list;
}

// ——— вход ———

function sedRestoreFocus(host) {
  const wanted = sedMemory.focus;
  if (!wanted || typeof document === "undefined") return;
  const active = document.activeElement;
  if (active && active !== document.body && host.contains(active)) return;
  if (active && active !== document.body && !host.contains(active)) return;
  const node = [...host.querySelectorAll("[data-fid]")].find((item) => item.dataset.fid === wanted.fid);
  if (!node) return;
  node.focus({ preventScroll: true });
  if (wanted.at !== null && typeof node.setSelectionRange === "function" && node.type !== "time" && node.type !== "number") {
    try {
      node.setSelectionRange(wanted.at, wanted.at);
    } catch (error) {
      // Не у всякого поля есть каретка.
    }
  }
}

function sedWire(host) {
  if (sedMemory.wired.has(host)) return;
  sedMemory.wired.add(host);
  // Перерисовка после правки убирает поле с фокусом: помним его адрес и каретку и возвращаем фокус новому.
  host.addEventListener("focusin", (event) => {
    const node = event.target;
    sedMemory.focus = node && node.dataset && node.dataset.fid ? { fid: node.dataset.fid, at: typeof node.selectionEnd === "number" ? node.selectionEnd : null } : null;
  });
  host.addEventListener("focusout", (event) => {
    const node = event.target;
    // Фокус ушёл и поле на месте — человек ушёл сам; пропало из дерева — это перерисовка.
    Promise.resolve().then(() => {
      if (node && node.isConnected && document.activeElement !== node) sedMemory.focus = null;
    });
  });
}

/** Нарисовать редактор блочного сценария в `host` (дверь `scenariosHook("editor")`). */
export function scenarioEditorRender(host, ctx) {
  sedCloseMenu();
  host.classList.add("sed");
  sedWire(host);
  host.replaceChildren();
  if (!ctx.scenario || ctx.scenario.kind !== "block") return;
  if (!ctx.canEdit) {
    host.append(uiEl("p", { class: "scn-center__slot", text: strings.scenarios.center.readOnly }));
    return;
  }
  const env = sedEnv(host, ctx);
  const rootAdd = sedMenu(SED_WORDS.rootAdd, sedMenuItems(env, "root", null, "root"), { className: "sed-add--root", title: SED_WORDS.rootAddTitle });
  const bar = uiEl("div", { class: "sed-bar" }, [rootAdd]);
  host.append(bar, sedList(env, ctx.scenario.targets, null, "root"));
  sedRestoreFocus(host);
}

scenariosHook("editor", scenarioEditorRender);
