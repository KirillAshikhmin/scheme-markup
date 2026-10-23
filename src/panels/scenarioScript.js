// Логические и глобальные сценарии Sprut.Hub в интерфейсе (таск 12 сценариев;
// истории 5.1, 5.2, 5.7–5.11, 5.13).
//
// Две половины:
//
//   — **чистая**: разбор загруженного файла в сценарий объекта
//     (`scenarioScriptAdd`), правка текста (`scenarioScriptSave`), «Скачать»
//     в том же формате (`scenarioScriptFile`), проверка текста (синтаксис и
//     совместимость с хабом — `scenarioScriptCheck`), клавиша Tab, номера
//     строк, привязки к устройству (`scenarioScriptLogicOf` — модель раздела
//     «Логика», `scenarioScriptBind` и соседи — команды над объектом);
//   — **экранная**: загрузка файла и вставка текста, окно редактора кода,
//     раздел «Логика» карточки устройства (`scenarioScriptLogicView`) с формой
//     опций из `info.options`.
//
// Команды возвращают `{project, label, …}` или `null` (менять нечего); шаг
// истории собирает вызывающий через `canvasCommit`. Этот модуль сам
// `canvas.js` не подключает — карточка устройства живёт в модуле, который
// `canvas.js` подключает сам, а цикл сборка запрещает: записывающую функцию
// ему отдаёт режим «Сценарии» (`scenarioScriptCommitter`).
import { getState, layoutAllowsState, reportAppError, subscribe } from "../app.js";
import { exportText } from "../exporter.js";
import {
  addLogicBinding,
  addScenario,
  deleteLogicBinding,
  deviceFollowers,
  findLogicBinding,
  findScenario,
  labelOf,
  logicBindingsOf,
  scenariosInOrder,
  updateLogicBinding,
  updateScenario,
} from "../model.js";
import { deviceAids, homeAccessories } from "../sim/home.js";
import { hubCompatWarnings, hubFits, hubScriptCompile, hubScriptInfoName, hubScriptRead } from "../sim/hubApi.js";
import { simOptionForms, simScenarios, simWatch } from "../simulation.js";
import { strings, text } from "../strings.js";
import { uiButton, uiCheckRow, uiEl, uiIconButton, uiModal } from "./ui.js";

/** Отступ по Tab: два пробела. */
export const SCENARIO_SCRIPT_INDENT = "  ";
/** Пауза перед перепроверкой текста в редакторе, мс. */
export const SCENARIO_SCRIPT_CHECK_MS = 250;

// ——— чистая половина: разбор, правка, скачивание ———————————————————————

/**
 * Имя сценария: из заготовки хаба, затем `info.name`, затем имя файла, затем
 * «Сценарий JS». Код сценария в странице **не исполняется** (ревью ветки, F1):
 * `info.name` берётся разбором текста (`hubScriptInfoName`), а формы опций
 * приходят из потока имитации.
 */
function scenarioScriptName(read) {
  if (read.template && read.template.name) return read.template.name;
  if (read.kind === "logic") {
    const name = hubScriptInfoName(read.source);
    if (name) return name;
  }
  return read.name || strings.scenarios.script.untitled;
}

/**
 * Разобрать загруженный текст: `{read}` или `{error}` — готовая фраза для
 * человека (`hubBlocks` — «Блочные сценарии хаба загружать пока нельзя»).
 */
export function scenarioScriptRead(source, fileName) {
  const read = hubScriptRead(source, fileName);
  if (read.error) {
    const said = strings.scenarios.script.readErrors[read.error];
    return { error: said || strings.scenarios.script.readErrors.unreadable, code: read.error };
  }
  return { read };
}

/** Значение для `addScenario` из ответа `hubScriptRead`. */
export function scenarioScriptFrom(read) {
  const value = {
    kind: read.kind,
    name: scenarioScriptName(read),
    source: read.source,
    origin: read.origin,
    fileName: read.fileName || "",
  };
  if (read.template) {
    value.template = { ...read.template };
    value.active = read.template.active !== false;
    value.onStart = read.template.onStart === true;
    value.description = read.template.desc || "";
  }
  return value;
}

/** Добавить загруженный сценарий в объект: `{project, label, scenarioId, name, syntax, warnings}`. */
export function scenarioScriptAdd(project, read) {
  const made = addScenario(project, scenarioScriptFrom(read));
  return {
    project: made.project,
    label: strings.history.scenarioScriptAdd,
    scenarioId: made.scenario.id,
    name: made.scenario.name,
    syntax: read.syntax || null,
    warnings: read.warnings || [],
  };
}

/**
 * Изменён ли текст в окне кода (ревью ветки, F1): набранное `value` отличается
 * от текста сценария в объекте. Без права правки менять нечего — `false`;
 * сценарий удалили, пока окно открыто, — изменён всякий непустой текст.
 */
export function scenarioScriptDirty(project, scenarioId, value, editable = true) {
  if (!editable) return false;
  const typed = typeof value === "string" ? value : "";
  const scenario = project ? findScenario(project, scenarioId) : null;
  if (!scenario) return typed !== "";
  return typed !== (typeof scenario.source === "string" ? scenario.source : "");
}

/** Новый текст логического или глобального сценария; тот же текст — `null`. */
export function scenarioScriptSave(project, scenarioId, source) {
  const scenario = findScenario(project, scenarioId);
  if (!scenario || scenario.kind === "block" || typeof source !== "string") return null;
  const next = updateScenario(project, scenarioId, { source }).project;
  return next === project ? null : { project: next, label: strings.history.scenarioScriptEdit };
}

/**
 * Файл для «Скачать» — в том формате, в каком сценарий загружен: `.js` как
 * есть, JSON — `scenarioTemplate` хаба с текущим текстом в `data`.
 * Возвращает `{name, type, text}`.
 */
export function scenarioScriptFile(scenario) {
  const base = String(scenario.name || strings.scenarios.script.untitled).replace(/[\\/:*?"<>|]+/g, "_").trim() || "script";
  if (scenario.origin === "json") {
    const template = scenario.template || {};
    const body = {
      scenarioTemplate: {
        name: scenario.name || template.name || "",
        desc: scenario.description || template.desc || "",
        active: scenario.active !== false,
        onStart: scenario.onStart === true,
        sync: template.sync === true,
        data: scenario.source || "",
        type: scenario.kind === "global" ? "GLOBAL" : "LOGIC",
      },
    };
    const fileName = scenario.fileName && /\.json$/i.test(scenario.fileName) ? scenario.fileName : base + ".json";
    return { name: fileName, type: "application/json;charset=utf-8", text: JSON.stringify(body, null, 2) + "\n" };
  }
  const fileName = scenario.fileName && /\.js$/i.test(scenario.fileName) ? scenario.fileName : base + ".js";
  return { name: fileName, type: "text/javascript;charset=utf-8", text: scenario.source || "" };
}

/** Проверка текста: `{syntax: {line, message} | null, warnings: [{code, line}]}`. */
export function scenarioScriptCheck(source) {
  const textIn = typeof source === "string" ? source : "";
  const compiled = hubScriptCompile(textIn);
  return {
    syntax: compiled.error === undefined ? null : { line: compiled.line ?? null, message: compiled.error },
    warnings: hubCompatWarnings(textIn),
  };
}

/** Фраза о синтаксической ошибке: «Синтаксическая ошибка, строка 3: …». */
export function scenarioScriptSyntaxText(syntax) {
  if (!syntax) return "";
  const known = Number.isInteger(syntax.line) && syntax.line > 0;
  return text(known ? "scenarios.script.syntax" : "scenarios.script.syntaxNoLine", { line: syntax.line, message: syntax.message });
}

/** Фраза о предупреждении совместимости: «строка 4: class — …». */
export function scenarioScriptWarningText(warning) {
  const what = strings.scenarios.script.warnings[warning.code] || warning.code;
  return text("scenarios.script.warning", { line: warning.line, what });
}

/** Состояние текста сценария для середины: `{syntax, warnings}` — те же, что у редактора. */
export function scenarioScriptStatus(scenario) {
  return scenarioScriptCheck(scenario && scenario.source);
}

/** Столбик номеров строк для текста: «1\n2\n3». */
export function scenarioScriptNumbers(value) {
  const count = String(value ?? "").split("\n").length;
  const lines = [];
  for (let line = 1; line <= count; line += 1) lines.push(String(line));
  return lines.join("\n");
}

/**
 * Клавиша Tab в поле кода: два пробела на месте курсора (с выделением на
 * одной строке — вместо него), у выделения на нескольких строках — отступ
 * каждой; Shift+Tab убирает до двух пробелов в начале строк. Ответ — `{value,
 * start, end}`: новый текст и выделение.
 */
export function scenarioScriptTab(value, start, end, shift = false) {
  const source = String(value ?? "");
  const from = Math.max(0, Math.min(start, end));
  const to = Math.min(source.length, Math.max(start, end));
  const spansLines = source.slice(from, to).includes("\n");
  if (!shift && !spansLines) {
    return { value: source.slice(0, from) + SCENARIO_SCRIPT_INDENT + source.slice(to), start: from + 2, end: from + 2 };
  }
  const lineStart = source.lastIndexOf("\n", from - 1) + 1;
  const block = source.slice(lineStart, to);
  const rows = block.split("\n");
  let delta = 0;
  let firstDelta = 0;
  const changed = rows.map((row, index) => {
    let next = row;
    if (shift) {
      const cut = row.startsWith(SCENARIO_SCRIPT_INDENT) ? 2 : row.startsWith(" ") ? 1 : 0;
      next = row.slice(cut);
      delta -= cut;
      if (index === 0) firstDelta = -cut;
    } else {
      next = SCENARIO_SCRIPT_INDENT + row;
      delta += 2;
      if (index === 0) firstDelta = 2;
    }
    return next;
  });
  return {
    value: source.slice(0, lineStart) + changed.join("\n") + source.slice(to),
    start: Math.max(lineStart, from + firstDelta),
    end: Math.max(lineStart, to + delta),
  };
}

// ——— чистая половина: привязки к устройству ————————————————————————————

/** Подпись сервиса для списков: «Выключатель 2» у нескольких одного типа. */
function scenarioScriptServiceName(accessory, service) {
  const same = accessory.services.filter((item) => item.type === service.type).length;
  const base = service.name || text("sim.services." + service.type);
  return base + (!service.name && same > 1 && Number.isInteger(service.channel) ? " " + service.channel : "");
}

/** Что не так с привязкой или сценарием — словами; `null` — всё в порядке. */
export function scenarioScriptFaultText(fault, scope = "list") {
  if (!fault || !fault.code) return null;
  const table = scope === "card" ? strings.sim.card.logic.fault : strings.scenarios.list.fault;
  const known = Number.isInteger(fault.line) && fault.line > 0;
  if (fault.code === "hung") return table.hung;
  if (fault.code === "syntax") return known ? text(scope === "card" ? "sim.card.logic.fault.syntax" : "scenarios.list.fault.syntax", { line: fault.line }) : table.syntaxNoLine;
  if (fault.code === "start") {
    if (scope === "card") return table.start;
    return known ? text("scenarios.list.fault.startLine", { line: fault.line }) : table.start;
  }
  return null;
}

/**
 * Модель раздела «Логика» карточки устройства (история 5.7):
 *   bindings  — привязки этой метки: `{id, scenarioId, name, service,
 *               serviceName, active, fault, fields}` (`fields` — поля формы
 *               опций со значениями привязки; `null`, пока форма не пришла);
 *   available — подходящие сервисам сценарии: `{scenarioId, name, services:
 *               [{index, name}], form}` (`form` — форма новой привязки);
 *   scripts   — сколько логических сценариев в объекте.
 * `read(bindingId, scenarioId)` отдаёт `{form, fault}` или `null`; по
 * умолчанию — формы имитации сеанса.
 */
export function scenarioScriptLogicOf(project, given, read = simOptionForms) {
  // Ведомая метка (то же обозначение) — аксессуар ведущей: и привязки её.
  const markId = project ? deviceFollowers(project).get(given) || given : given;
  const accessory = project ? homeAccessories(project).find((item) => item.markId === markId) : null;
  if (!accessory) return null;
  const logic = scenariosInOrder(project).filter((scenario) => scenario.kind === "logic");
  const bindings = [];
  for (const binding of logicBindingsOf(project)) {
    if (binding.markId !== markId) continue;
    const scenario = findScenario(project, binding.scenarioId);
    if (!scenario) continue;
    const answer = read(binding.id, scenario.id);
    const service = accessory.services.find((item) => item.index === binding.service);
    bindings.push({
      id: binding.id,
      scenarioId: scenario.id,
      name: scenario.name,
      service: binding.service,
      serviceName: service ? scenarioScriptServiceName(accessory, service) : String(binding.service),
      active: binding.active !== false,
      fault: answer && answer.fault ? answer.fault : null,
      fields: answer && answer.form ? answer.form.fields : null,
    });
  }
  const available = [];
  for (const scenario of logic) {
    const answer = read(null, scenario.id);
    const form = answer && answer.form ? answer.form : null;
    if (!form) continue;
    const services = accessory.services.filter((service) => hubFits(form, service)).map((service) => ({ index: service.index, name: scenarioScriptServiceName(accessory, service) }));
    if (services.length > 0) available.push({ scenarioId: scenario.id, name: scenario.name, services, form, fault: answer.fault || null });
  }
  // Сервисы, у которых есть что показать (правка после сборки сценариев: «если
  // у аксессуара несколько сервисов, логика привязывается к каждому
  // отдельно»): привязанные и те, которым подходит сценарий, — в порядке
  // аксессуара; привязка к сервису, которого больше нет, — следом.
  const shown = new Set([...bindings.map((item) => item.service), ...available.flatMap((entry) => entry.services.map((item) => item.index))]);
  const services = accessory.services
    .filter((service) => shown.has(service.index))
    .map((service) => ({ index: service.index, name: scenarioScriptServiceName(accessory, service) }));
  for (const binding of bindings) {
    if (!services.some((item) => item.index === binding.service)) services.push({ index: binding.service, name: binding.serviceName });
  }
  return { markId, bindings, available, services, scripts: logic.length };
}

/**
 * Значение поля формы из того, что ввёл человек: `{value}` или `{error}`.
 * Boolean — как есть; Integer — целое, Double — число, обоим границы
 * `min…max`; String — строка не длиннее `maxLength`; список — значение
 * выбранной строки (`raw` — её номер).
 */
export function scenarioScriptFieldValue(field, raw) {
  if (field.formType === "list") {
    const item = Array.isArray(field.values) ? field.values[Number(raw)] : null;
    return item ? { value: item.value } : { error: strings.sim.card.logic.bad };
  }
  if (field.type === "Boolean") return { value: raw === true || raw === "true" };
  if (field.type === "Integer" || field.type === "Double") {
    const source = typeof raw === "string" ? raw.trim().replace(",", ".") : raw;
    const number = typeof source === "number" ? source : source === "" ? NaN : Number(source);
    if (!Number.isFinite(number)) return { error: strings.sim.card.logic.bad };
    if (field.type === "Integer" && !Number.isInteger(number)) return { error: strings.sim.card.logic.bad };
    if ((typeof field.min === "number" && number < field.min) || (typeof field.max === "number" && number > field.max)) {
      return { error: strings.sim.card.logic.bad };
    }
    return { value: number };
  }
  const value = String(raw ?? "");
  return { value: typeof field.maxLength === "number" && field.maxLength >= 0 ? value.slice(0, field.maxLength) : value };
}

/** Привязать сценарий к сервису метки с опциями: `{project, label, bindingId}`. */
export function scenarioScriptBind(project, { scenarioId, markId, service, options = {} }) {
  const made = addLogicBinding(project, { scenarioId, markId, service, options });
  return { project: made.project, label: strings.history.addLogicBinding, bindingId: made.binding.id };
}

/** Одна опция привязки; то же значение — `null`. */
export function scenarioScriptSetOption(project, bindingId, key, value) {
  const binding = findLogicBinding(project, bindingId);
  if (!binding) return null;
  const options = { ...(binding.options || {}), [key]: value };
  const next = updateLogicBinding(project, bindingId, { options }).project;
  return next === project ? null : { project: next, label: strings.history.logicBindingOptions };
}

/**
 * Опции привязки разом — одним шагом истории (правка после сборки сценариев:
 * «Опции» открывают окно, как при добавлении, и правка уходит по «Сохранить»).
 */
export function scenarioScriptSetOptions(project, bindingId, patch) {
  const binding = findLogicBinding(project, bindingId);
  if (!binding || !patch || typeof patch !== "object" || Object.keys(patch).length === 0) return null;
  const options = { ...(binding.options || {}), ...patch };
  const next = updateLogicBinding(project, bindingId, { options }).project;
  return next === project ? null : { project: next, label: strings.history.logicBindingOptions };
}

/**
 * Метки за значениями списка формы (правка после сборки сценариев): сценарий
 * хаба собирает список устройств из адресов — аксессуар `aid`, сервис
 * `aid.sid`, характеристика `aid.sid.cid` (`getUUID`), — и `aid` однозначно
 * называет метку объекта. `Map<markId, [{index, label}]>` — у каких меток в
 * списке есть варианты и какие (номер строки списка и её подпись); у поля, в
 * котором устройств нет, — пустая.
 */
export function scenarioScriptFieldMarks(project, field) {
  const out = new Map();
  if (!project || !field || field.formType !== "list" || !Array.isArray(field.values)) return out;
  const byAid = new Map();
  for (const [markId, aid] of deviceAids(project)) byAid.set(String(aid), markId);
  field.values.forEach((item, index) => {
    const match = /^(\d+)(?:\.\d+){0,2}$/.exec(String(item && item.value !== null && item.value !== undefined ? item.value : ""));
    const markId = match ? byAid.get(match[1]) : null;
    if (!markId) return;
    if (!out.has(markId)) out.set(markId, []);
    out.get(markId).push({ index, label: item.label });
  });
  // Метки с тем же обозначением — то же устройство (четыре Т1): на схеме
  // щёлкнуть можно по любой из них.
  for (const [follower, leader] of deviceFollowers(project)) {
    if (out.has(leader) && !out.has(follower)) out.set(follower, out.get(leader));
  }
  return out;
}

/** «Активна» привязки. */
export function scenarioScriptSetActive(project, bindingId, on) {
  if (!findLogicBinding(project, bindingId)) return null;
  const next = updateLogicBinding(project, bindingId, { active: on === true }).project;
  return next === project ? null : { project: next, label: strings.history.logicBindingActive };
}

/** Снять привязку. */
export function scenarioScriptUnbind(project, bindingId) {
  if (!findLogicBinding(project, bindingId)) return null;
  return { project: deleteLogicBinding(project, bindingId).project, label: strings.history.removeLogicBinding };
}

// ——— запись в объект: функцию отдаёт режим «Сценарии» ————————————————————

let scenarioScriptCommit = null;
// Схема в окне (`planPicker.js`) — дверью от режима «Сценарии», как запись в
// объект: окно рисует поле плана, поле — карточку устройства, а карточка сама
// открывает этот раздел, и прямой импорт замкнул бы их в кольцо.
let scenarioScriptPicker = null;

/** Подключить `openPlanPicker(api, options)` — схему в окне для выбора устройства на ней. */
export function scenarioScriptPlanPicker(fn) {
  scenarioScriptPicker = typeof fn === "function" ? fn : null;
}

/** Подключить `canvasCommit(before, after, label, options)` — ему одному можно писать в объект. */
export function scenarioScriptCommitter(fn) {
  scenarioScriptCommit = typeof fn === "function" ? fn : null;
}

function scenarioScriptApply(result) {
  if (!result || !scenarioScriptCommit) return false;
  try {
    scenarioScriptCommit(getState().project, result.project, result.label, result.patch ? { patch: result.patch } : {});
  } catch (error) {
    reportAppError(error);
    return false;
  }
  return true;
}

// Правка сценариев: компьютер и планшет, и в раскладке просмотра (F2).
function scenarioScriptCanEdit() {
  return layoutAllowsState("editScenarios", getState());
}

// ——— экранная половина: форма опций ————————————————————————————————————

/**
 * Поля формы опций (`hubOptionsForm(...).fields`) узлами. `onChange(key,
 * value)` зовётся уже с готовым значением; негодное число красится и
 * возвращается к прежнему. `readOnly` гасит правку.
 */
export function scenarioScriptFields(fields, { readOnly = false, onChange = () => {} } = {}) {
  const box = uiEl("div", { class: "scr-fields" });
  for (const field of fields) {
    if (field.formType === "status") {
      box.append(uiEl("p", { class: "scr-field__status", text: field.label + (field.value === "" || field.value === null ? "" : ": " + field.value) }));
      continue;
    }
    if (field.formType === "html") {
      box.append(uiEl("p", { class: "scr-field__html", title: field.label, text: field.html || "" }));
      continue;
    }
    const bad = uiEl("span", { class: "scr-field__bad" });
    bad.hidden = true;
    let mapButton = null;
    const send = (raw, input) => {
      const checked = scenarioScriptFieldValue(field, raw);
      if (checked.error !== undefined) {
        input.classList.add("is-bad");
        bad.textContent = checked.error;
        bad.hidden = false;
        return;
      }
      input.classList.remove("is-bad");
      bad.hidden = true;
      onChange(field.key, checked.value);
    };
    let input;
    if (field.formType === "list") {
      const values = Array.isArray(field.values) ? field.values : [];
      input = uiEl(
        "select",
        { class: "ui-select scr-field__input", attrs: { "aria-label": field.label } },
        values.map((item, index) => uiEl("option", { text: item.label, attrs: { value: String(index) } })),
      );
      const at = values.findIndex((item) => String(item.value) === String(field.value));
      input.value = String(at >= 0 ? at : 0);
      input.addEventListener("change", () => send(input.value, input));
      // Список устройств — и на схеме (правка после сборки сценариев): «рядом
      // с полем добавь кнопку, которая тоже откроет эту карту — схему в окне,
      // но только с теми метками, которые можно выбрать».
      const marks = readOnly || !scenarioScriptPicker ? new Map() : scenarioScriptFieldMarks(getState().project, field);
      if (marks.size > 0) {
        const select = input;
        const choose = (index) => {
          select.value = String(index);
          send(select.value, select);
        };
        const current = [...marks].find(([, list]) => list.some((item) => String(item.index) === select.value));
        mapButton = uiIconButton("planPick", {
          class: "ui-btn scr-field__map",
          title: strings.planPicker.fieldOpen,
          attrs: { "aria-label": strings.planPicker.fieldOpen },
          on: {
            click: (event) => {
              event.preventDefault();
              scenarioScriptPicker(
                { getState, subscribe },
                {
                  title: text("planPicker.fieldTitle", { label: field.label }),
                  hint: strings.planPicker.fieldHint,
                  markIds: new Set(marks.keys()),
                  selected: current ? [current[0]] : [],
                  onPick: (markId) => {
                    const list = marks.get(markId) || [];
                    if (list.length === 1) choose(list[0].index);
                    else if (list.length > 1) scenarioScriptChooseWindow(markId, list, choose);
                  },
                },
              );
            },
          },
        });
      }
    } else if (field.type === "Boolean") {
      input = uiEl("input", { type: "checkbox", attrs: { "aria-label": field.label } });
      input.checked = field.value === true;
      input.addEventListener("change", () => send(input.checked, input));
    } else if (field.type === "Integer" || field.type === "Double") {
      const attrs = { "aria-label": field.label, inputmode: field.type === "Integer" ? "numeric" : "decimal" };
      if (typeof field.min === "number") attrs.min = String(field.min);
      if (typeof field.max === "number") attrs.max = String(field.max);
      attrs.step = typeof field.step === "number" ? String(field.step) : field.type === "Integer" ? "1" : "any";
      input = uiEl("input", { class: "ui-input scr-field__input", type: "number", attrs });
      input.value = field.value === null || field.value === undefined ? "" : String(field.value);
      input.addEventListener("change", () => send(input.value, input));
    } else {
      const attrs = { "aria-label": field.label };
      if (typeof field.maxLength === "number") attrs.maxlength = String(field.maxLength);
      input = uiEl("input", { class: "ui-input scr-field__input", type: "text", attrs });
      input.value = field.value === null || field.value === undefined ? "" : String(field.value);
      input.addEventListener("change", () => send(input.value, input));
    }
    if (input.type === "number" || input.type === "text") {
      // Enter в поле — его правка, а не нажатие кнопки окна.
      input.addEventListener("keydown", (event) => {
        if (event.key !== "Enter") return;
        event.preventDefault();
        send(input.value, input);
      });
    }
    input.disabled = readOnly;
    const unit = field.unit ? uiEl("span", { class: "scr-field__unit", text: field.unit }) : null;
    const label = uiEl("label", { class: "scr-field" + (field.type === "Boolean" && field.formType !== "list" ? " is-check" : ""), title: field.hint || "" }, [
      uiEl("span", { class: "scr-field__label", text: field.label }),
      mapButton ? uiEl("span", { class: "scr-field__pick" }, [input, mapButton]) : input,
      ...(unit ? [unit] : []),
      bad,
    ]);
    box.append(label);
  }
  return box;
}

// ——— экранная половина: раздел «Логика» ————————————————————————————————

/** У метки в списке поля несколько вариантов (сервисы одного аксессуара): какой. */
function scenarioScriptChooseWindow(markId, list, choose) {
  const label = labelOf(getState().project, markId);
  let modal;
  modal = uiModal({
    title: text("planPicker.fieldChoose", { label }),
    body: uiEl(
      "div",
      { class: "scr-choose" },
      list.map((item) =>
        uiButton(item.label, {
          class: "ui-btn ui-btn--wide",
          on: {
            click: () => {
              modal.close();
              choose(item.index);
            },
          },
        }),
      ),
    ),
    actions: [uiButton(strings.sim.card.logic.addCancel, { on: { click: () => modal.close() } })],
  });
}

/**
 * Окно опций привязки (правка после сборки сценариев): «после того как
 * настроил логику, то что бы у устройства в списке по нажатию Опции не
 * разворачивался список, а открывалось окно параметров логики, как и при
 * добавлении». Поля те же, что в окне привязки; правка копится и уходит одним
 * шагом по «Сохранить». Без права правки окно только показывает.
 */
function scenarioScriptOptionsWindow(binding, editable) {
  const draft = {};
  const body = [];
  body.push(uiEl("p", { class: "scr-add__desc", text: text("sim.card.logic.service", { name: binding.serviceName }) }));
  body.push(
    uiEl("div", { class: "scr-add__fields" }, [
      scenarioScriptFields(binding.fields, { readOnly: !editable, onChange: (key, value) => (draft[key] = value) }),
    ]),
  );
  let modal;
  const actions = [uiButton(editable ? strings.sim.card.logic.addCancel : strings.dialog.close, { on: { click: () => modal.close() } })];
  if (editable) {
    actions.push(
      uiButton(strings.sim.card.logic.optionsSave, {
        class: "ui-btn ui-btn--primary",
        on: {
          click: () => {
            modal.close();
            scenarioScriptApply(scenarioScriptSetOptions(getState().project, binding.id, draft));
          },
        },
      }),
    );
  }
  modal = uiModal({
    title: text("sim.card.logic.optionsTitle", { name: binding.name }),
    body: uiEl("div", { class: "scr-add" }, body),
    actions,
  });
  return modal;
}

function scenarioScriptAddWindow(project, markId, entry, service = null) {
  const draft = {};
  // Сервис задан разделом, из которого добавляют, — выбирать его в окне нечего.
  const fixed = entry.services.find((item) => item.index === service) || null;
  const state = { service: fixed ? fixed.index : entry.services[0].index };
  const fields = uiEl("div", { class: "scr-add__fields" });
  fields.append(scenarioScriptFields(entry.form.fields, { onChange: (key, value) => (draft[key] = value) }));
  const body = [];
  if (fixed) body.push(uiEl("p", { class: "scr-add__desc", text: text("sim.card.logic.service", { name: fixed.name }) }));
  else if (entry.services.length > 1) {
    const select = uiEl(
      "select",
      { class: "ui-select", attrs: { "aria-label": strings.sim.card.logic.addService } },
      entry.services.map((service) => uiEl("option", { text: service.name, attrs: { value: String(service.index) } })),
    );
    select.addEventListener("change", () => (state.service = Number(select.value)));
    body.push(uiEl("label", { class: "scr-field" }, [uiEl("span", { class: "scr-field__label", text: strings.sim.card.logic.addService }), select]));
  }
  if (entry.form.description) body.push(uiEl("p", { class: "scr-add__desc", text: entry.form.description }));
  body.push(fields);
  if (entry.form.fields.length === 0) body.push(uiEl("p", { class: "scr-add__desc", text: strings.sim.card.logic.noOptions }));
  const modal = uiModal({
    title: text("sim.card.logic.addTitle", { name: entry.form.name || entry.name }),
    body: uiEl("div", { class: "scr-add" }, body),
    actions: [
      uiButton(strings.sim.card.logic.addCancel, { on: { click: () => modal.close() } }),
      uiButton(strings.sim.card.logic.addSubmit, {
        class: "ui-btn ui-btn--primary",
        on: {
          click: () => {
            modal.close();
            scenarioScriptApply(scenarioScriptBind(getState().project, { scenarioId: entry.scenarioId, markId, service: state.service, options: draft }));
          },
        },
      }),
    ],
  });
  return modal;
}

/**
 * Раздел «Логика» карточки устройства (5.7): `{node, dispose}`. Сам
 * перерисовывается на смену объекта и на новые формы от потока; правка —
 * только там, где разрешена правка сценариев.
 */
export function scenarioScriptLogicView(markId) {
  const node = uiEl("section", { class: "scr-logic" });
  let timer = null;

  function render() {
    timer = null;
    if (!node.isConnected && node.dataset.seen === "1") return;
    if (node.isConnected) node.dataset.seen = "1";
    // Поле, в котором стоит курсор, не пересобираем — иначе ввод оборвётся.
    const active = typeof document !== "undefined" ? document.activeElement : null;
    if (active && node.contains(active) && active.tagName !== "BUTTON") return;
    const project = getState().project;
    const model = scenarioScriptLogicOf(project, markId);
    const editable = scenarioScriptCanEdit();
    node.replaceChildren(uiEl("p", { class: "sim-card__head scr-logic__title", title: strings.sim.card.logic.hint, text: strings.sim.card.logic.title }));
    if (!model) return;
    // Раздел на каждый сервис (правка после сборки сценариев): «если у
    // аксессуара несколько сервисов, логика привязывается к каждому отдельно».
    // У одного сервиса заголовка нет — раздел тот же, что был.
    const grouped = model.services.length > 1;
    if (!grouped) {
      const service = model.services[0] ? model.services[0].index : null;
      appendBindings(node, model.bindings, editable, true);
      appendAdd(node, model, editable, model.available, service, true);
      return;
    }
    for (const service of model.services) {
      const part = uiEl("div", { class: "scr-logic__service", attrs: { "data-service": String(service.index) } }, [
        uiEl("p", { class: "scr-logic__serviceName", text: service.name }),
      ]);
      appendBindings(part, model.bindings.filter((binding) => binding.service === service.index), editable, false);
      appendAdd(part, model, editable, model.available.filter((entry) => entry.services.some((item) => item.index === service.index)), service.index, false);
      node.append(part);
    }
    if (!editable) node.append(uiEl("p", { class: "scr-logic__empty", text: strings.sim.card.logic.readOnly }));
  }

  function appendBindings(host, bindings, editable, withService) {
    if (bindings.length === 0) host.append(uiEl("p", { class: "scr-logic__empty", text: strings.sim.card.logic.none }));
    for (const binding of bindings) {
      const fault = scenarioScriptFaultText(binding.fault, "card");
      const head = uiEl("div", { class: "scr-bind__head" }, [
        uiEl("strong", { class: "scr-bind__name", text: binding.name }),
        withService ? uiEl("span", { class: "scr-bind__service", text: text("sim.card.logic.service", { name: binding.serviceName }) }) : null,
      ]);
      const check = uiEl("input", { type: "checkbox", attrs: { "aria-label": strings.sim.card.logic.active } });
      check.checked = binding.active;
      check.disabled = !editable;
      check.addEventListener("change", () => scenarioScriptApply(scenarioScriptSetActive(getState().project, binding.id, check.checked)));
      const tools = [uiCheckRow(check, strings.sim.card.logic.active, strings.sim.card.logic.activeHint)];
      if (editable) {
        tools.push(
          uiButton(strings.sim.card.logic.remove, {
            class: "ui-btn ui-btn--danger",
            title: strings.sim.card.logic.removeHint,
            on: { click: () => scenarioScriptApply(scenarioScriptUnbind(getState().project, binding.id)) },
          }),
        );
      }
      const parts = [head];
      if (fault) parts.push(uiEl("p", { class: "scr-bind__fault", text: fault }));
      parts.push(uiEl("div", { class: "scr-bind__tools" }, tools));
      if (binding.fields === null) parts.push(uiEl("p", { class: "scr-logic__empty", text: strings.sim.card.logic.noForm }));
      else if (binding.fields.length > 0) {
        // Опции — окном, как при добавлении (правка после сборки сценариев):
        // десятки полей настоящего сценария в узкой карточке читались плохо.
        parts.push(
          uiButton(strings.sim.card.logic.options, {
            class: "ui-btn scr-bind__options",
            title: strings.sim.card.logic.optionsHint,
            on: { click: () => scenarioScriptOptionsWindow(binding, editable) },
          }),
        );
      }
      host.append(uiEl("div", { class: "scr-bind" + (binding.active && !fault ? "" : " is-off") + (fault ? " is-fault" : ""), attrs: { "data-binding": binding.id } }, parts));
    }
  }

  // «+ сценарий» раздела: подходящие этому сервису (`service`) или, у раздела
  // без сервисов, — пояснение, почему добавить нечего.
  function appendAdd(host, model, editable, entries, service, alone) {
    if (!editable) {
      if (alone) host.append(uiEl("p", { class: "scr-logic__empty", text: strings.sim.card.logic.readOnly }));
      return;
    }
    if (entries.length === 0) {
      if (alone) host.append(uiEl("p", { class: "scr-logic__empty", text: model.scripts === 0 ? strings.sim.card.logic.noScripts : strings.sim.card.logic.nothingFits }));
      return;
    }
    const row = uiEl("div", { class: "scr-logic__add" });
    for (const entry of entries) {
      row.append(
        uiButton("+ " + entry.name, {
          class: "ui-btn",
          title: strings.sim.card.logic.addHint,
          attrs: { "data-scenario": entry.scenarioId },
          on: { click: () => scenarioScriptAddWindow(getState().project, markId, entry, service) },
        }),
      );
    }
    host.append(row);
  }

  function later() {
    if (timer !== null) return;
    timer = setTimeout(render, 0);
  }

  render();
  const offState = subscribe((_next, changed) => {
    if ("project" in changed || "layout" in changed || "tablet" in changed) later();
  });
  const offSim = simWatch((payload) => {
    if (payload.forms && payload.forms.length > 0) later();
    else if (payload.fault) later();
  });
  return {
    node,
    dispose: () => {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      offState();
      offSim();
    },
  };
}

// ——— экранная половина: загрузка и редактор ————————————————————————————

function scenarioScriptSay(ctx, key, vars) {
  const notify = ctx && ctx.api && typeof ctx.api.notify === "function" ? ctx.api.notify : null;
  if (notify) notify(text(key, vars), key.endsWith("Syntax") ? "error" : "success");
}

function scenarioScriptFail(ctx, message) {
  const notify = ctx && ctx.api && typeof ctx.api.notify === "function" ? ctx.api.notify : null;
  if (notify) notify(message, "error");
}

/** Принять разобранный текст: добавить сценарий и открыть его. */
function scenarioScriptTake(ctx, source, fileName) {
  const parsed = scenarioScriptRead(source, fileName);
  if (parsed.error) {
    scenarioScriptFail(ctx, parsed.error);
    return false;
  }
  const result = scenarioScriptAdd(getState().project, parsed.read);
  if (!ctx.commit({ ...result, patch: { scenarioId: result.scenarioId } })) return false;
  if (result.syntax) scenarioScriptSay(ctx, "scenarios.script.addedSyntax", { name: result.name, line: result.syntax.line ?? "?" });
  else scenarioScriptSay(ctx, "scenarios.script.added", { name: result.name });
  return true;
}

/** «Загрузить JS»: выбор файла `.js` или JSON хаба. */
export function scenarioScriptLoad(ctx) {
  if (typeof document === "undefined") return;
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".js,.json,application/json,text/javascript";
  input.addEventListener("change", async () => {
    const file = input.files && input.files[0];
    if (!file) return;
    let content;
    try {
      content = await file.text();
    } catch {
      scenarioScriptFail(ctx, strings.scenarios.script.readErrors.unreadable);
      return;
    }
    scenarioScriptTake(ctx, content, file.name);
  });
  input.click();
}

/** «Вставить текст»: окно с полем для текста сценария. */
export function scenarioScriptPaste(ctx) {
  const area = uiEl("textarea", {
    class: "ui-input scr-code__area scr-paste__area",
    placeholder: strings.scenarios.script.pastePlaceholder,
    attrs: { rows: "14", spellcheck: "false", wrap: "off", "aria-label": strings.scenarios.script.pasteTitle },
  });
  area.addEventListener("keydown", (event) => {
    if (event.key !== "Tab") return;
    event.preventDefault();
    const out = scenarioScriptTab(area.value, area.selectionStart, area.selectionEnd, event.shiftKey);
    area.value = out.value;
    area.setSelectionRange(out.start, out.end);
  });
  const modal = uiModal({
    title: strings.scenarios.script.pasteTitle,
    body: uiEl("div", { class: "scr-paste" }, [area]),
    actions: [
      uiButton(strings.scenarios.script.close, { on: { click: () => modal.close() } }),
      uiButton(strings.scenarios.script.pasteSubmit, {
        class: "ui-btn ui-btn--primary",
        on: {
          click: () => {
            if (scenarioScriptTake(ctx, area.value, "")) modal.close();
          },
        },
      }),
    ],
  });
  modal.card.classList.add("scr-modal");
}

/** Окно редактора кода (5.2, 5.11, 5.13) сценария `scenarioId`. */
export function scenarioScriptEdit(ctx, scenarioId) {
  const scenario = findScenario(getState().project, scenarioId);
  if (!scenario || scenario.kind === "block") return null;
  const editable = scenarioScriptCanEdit();
  const area = uiEl("textarea", {
    class: "ui-input scr-code__area",
    attrs: { spellcheck: "false", wrap: "off", "aria-label": strings.scenarios.script.codeLabel, autocapitalize: "off", autocomplete: "off" },
  });
  area.value = scenario.source || "";
  area.readOnly = !editable;
  const gutter = uiEl("pre", { class: "scr-code__gutter", attrs: { "aria-hidden": "true" } });
  const status = uiEl("p", { class: "scr-code__status" });
  const warnings = uiEl("ul", { class: "scr-code__warnings" });
  const count = uiEl("span", { class: "scr-code__count" });
  let checkTimer = null;

  function paintStatus() {
    checkTimer = null;
    const check = scenarioScriptCheck(area.value);
    status.textContent = check.syntax ? scenarioScriptSyntaxText(check.syntax) + ". " + strings.scenarios.script.syntaxNote : strings.scenarios.script.noSyntax;
    status.classList.toggle("is-error", Boolean(check.syntax));
    warnings.replaceChildren(
      ...(check.warnings.length > 0 ? [uiEl("li", { class: "scr-code__warnings-title", text: strings.scenarios.script.warningsTitle })] : []),
      ...check.warnings.map((warning) => uiEl("li", { text: scenarioScriptWarningText(warning) })),
    );
    gutter.classList.toggle("has-error", Boolean(check.syntax));
    gutter.dataset.errorLine = check.syntax && Number.isInteger(check.syntax.line) ? String(check.syntax.line) : "";
  }
  function paintNumbers() {
    gutter.textContent = scenarioScriptNumbers(area.value);
    count.textContent = text("scenarios.script.lines", { count: area.value.split("\n").length });
    gutter.scrollTop = area.scrollTop;
  }
  function changed() {
    paintNumbers();
    if (checkTimer !== null) clearTimeout(checkTimer);
    checkTimer = setTimeout(paintStatus, SCENARIO_SCRIPT_CHECK_MS);
  }
  area.addEventListener("input", changed);
  area.addEventListener("scroll", () => (gutter.scrollTop = area.scrollTop));
  area.addEventListener("keydown", (event) => {
    if (event.key !== "Tab" || !editable || event.ctrlKey || event.metaKey || event.altKey) return;
    event.preventDefault();
    const out = scenarioScriptTab(area.value, area.selectionStart, area.selectionEnd, event.shiftKey);
    area.value = out.value;
    area.setSelectionRange(out.start, out.end);
    changed();
  });
  paintNumbers();
  paintStatus();

  const save = () => {
    if (!editable) return true;
    const fresh = getState().project;
    const result = scenarioScriptSave(fresh, scenarioId, area.value);
    if (result) return ctx.commit(result);
    return true;
  };
  // Escape и «Закрыть» набранное молча не выбрасывают: изменённый текст —
  // вопрос «Сохранить изменения?», нетронутый — окно просто закрывается.
  let asking = false;
  const leave = () => {
    if (asking) return;
    if (!scenarioScriptDirty(getState().project, scenarioId, area.value, editable)) {
      modal.close();
      return;
    }
    asking = true;
    let question = null;
    const answer = (how) => {
      question.close();
      asking = false;
      if (how === "save" && !save()) return;
      if (how === "save" || how === "discard") modal.close();
      else area.focus();
    };
    question = uiModal({
      title: strings.scenarios.script.unsavedTitle,
      body: uiEl("p", { class: "modal__text", text: text("scenarios.script.unsavedMessage", { name: scenario.name }) }),
      actions: [
        uiButton(strings.scenarios.script.unsavedStay, { on: { click: () => answer("stay") } }),
        uiButton(strings.scenarios.script.unsavedDiscard, { class: "ui-btn ui-btn--danger", on: { click: () => answer("discard") } }),
        uiButton(strings.scenarios.script.unsavedSave, { class: "ui-btn ui-btn--primary", on: { click: () => answer("save") } }),
      ],
      onCancel: () => {
        asking = false;
        area.focus();
      },
    });
  };
  const modal = uiModal({
    title: text("scenarios.script.editTitle", { name: scenario.name }),
    body: uiEl("div", { class: "scr-code" }, [
      uiEl("div", { class: "scr-code__frame" }, [gutter, area]),
      uiEl("div", { class: "scr-code__foot" }, [count, status]),
      warnings,
      ...(editable ? [] : [uiEl("p", { class: "scr-code__readonly", text: strings.scenarios.script.editReadOnly })]),
    ]),
    actions: [
      uiButton(strings.scenarios.script.editDownload, {
        title: strings.scenarios.script.editDownloadHint,
        on: { click: () => scenarioScriptDownload({ ...scenario, source: area.value }) },
      }),
      uiButton(strings.scenarios.script.close, { on: { click: () => leave() } }),
      ...(editable
        ? [
            uiButton(strings.scenarios.script.editSave, {
              class: "ui-btn ui-btn--primary",
              on: {
                click: () => {
                  if (save()) modal.close();
                },
              },
            }),
          ]
        : []),
    ],
    // Escape окна решает само окно (`leave`): общий обработчик закрыл бы его молча.
    dismissable: false,
  });
  modal.card.classList.add("scr-modal");
  modal.card.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || event.defaultPrevented) return;
    // Дальше общему обработчику окон это нажатие не идёт: он закрыл бы
    // только что открытый вопрос тем же Escape.
    event.preventDefault();
    event.stopPropagation();
    leave();
  });
  area.focus();
  return modal;
}

/** «Скачать» сценария в его формате (`scenario` — с нужным текстом). */
export function scenarioScriptDownload(scenario) {
  const file = scenarioScriptFile(scenario);
  exportText(file.text, file.name, file.type);
}

/**
 * Что не так со сценариями на ходу дома: `Map<id сценария, fault>`. Сценарий,
 * который сторож выключил целиком, приходит от имитации сам; а когда завис
 * только вызов у одной привязки, сценарий в списке тоже «остановлен: завис» —
 * какая именно привязка, видно в её карточке. Повторная активация сценария
 * возвращает и его привязки. `source` подменяет имитацию в тесте.
 */
export function scenarioScriptFaults(project = null, source = { scenarios: simScenarios, forms: simOptionForms }) {
  const out = new Map();
  for (const item of source.scenarios()) if (item && item.fault) out.set(item.id, item.fault);
  if (project) {
    for (const binding of logicBindingsOf(project)) {
      if (out.has(binding.scenarioId)) continue;
      const answer = source.forms(binding.id, binding.scenarioId);
      if (answer && answer.fault && answer.fault.code === "hung") out.set(binding.scenarioId, answer.fault);
    }
  }
  return out;
}
