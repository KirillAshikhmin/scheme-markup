// Режим «Сценарии» (таск 10 сценариев; истории 1.7, 2.19, 4.1–4.3, 4.22–4.25,
// 4.27–4.29, 6.2).
//
// Четвёртый режим основного экрана. Слева — список сценариев (поиск, вид,
// «Активный», фраза-описание, порядок, создать из пустого, из заготовки или
// загрузить JS) и «Типы без аксессуара»; в середине — выбранный сценарий:
// фраза-описание построчно, параметры, проблемы и место под редактор блоков;
// справа — выбор устройства по помещениям и живой мини-план; снизу — журнал;
// сверху — полоса запуска дома и часов. Телефон — без правки: список с
// «Активный», просмотр, журнал и запуск дома.
//
// Две половины. **Чистая**: команды над объектом (`scenariosAdd`,
// `scenariosRename`, …) принимают объект и отдают `{project, label}` или
// `null`, если менять нечего, — шаг истории из них собирает вызывающий через
// `canvasCommit`; читатели списка, устройств и типов; свои заготовки; память
// «сработавших только что» блоков. **Экранная**: `mountScenariosScreen`.
//
// Живое состояние дома (запущен ли, значения) сюда приходит только из
// `simulation.js` и в объект не пишется; а всё, что в файле — сценарии и
// профили типов, — только через `canvasCommit` со своим ярлыком истории.
import { PANEL_IDS, layoutAllowsState, registerPanel, reportAppError, scheduleFrame } from "../app.js";
import { appClockWatch } from "../appClock.js";
import { canvasCommit } from "../canvas.js";
import {
  addScenario,
  deleteScenario,
  findMark,
  findScenario,
  findType,
  labelOf,
  moveScenario,
  roomsInOrder,
  scenariosInOrder,
  setTypeDevice,
  typeDeviceUnknown,
  typesInOrder,
  updateScenario,
} from "../model.js";
import {
  SCENARIO_TEMPLATES,
  scenarioBlockHas,
  scenarioBlockMarks,
  scenarioFind,
  scenarioFromTemplate,
  scenarioIssues,
  scenarioNewId,
  scenarioPhraseParts,
  scenarioSlotLabel,
  scenarioTemplatesFrom,
  scenarioToTemplate,
} from "../scenarioTree.js";
import { DEVICE_KINDS } from "../sim/catalog.js";
import { homeAccessories } from "../sim/home.js";
import { simRunning, simScenarioActive, simScenarioRun, simWatch } from "../simulation.js";
import { getSetting, setSetting } from "../store.js";
import { strings, text } from "../strings.js";
import { deviceCardView } from "./deviceCard.js";
import { deviceDraftKind, deviceTypeRecord } from "./deviceSettings.js";
import { createMiniPlan, miniPlanSchemeFor, miniPlanSchemes } from "./miniPlan.js";
import {
  scenarioScriptCommitter,
  scenarioScriptDownload,
  scenarioScriptEdit,
  scenarioScriptFaultText,
  scenarioScriptFaults,
  scenarioScriptLoad,
  scenarioScriptLogicView,
  scenarioScriptPaste,
  scenarioScriptStatus,
  scenarioScriptSyntaxText,
  scenarioScriptWarningText,
} from "./scenarioScript.js";
import { simBarMount } from "./simBar.js";
import { simJournalMount } from "./simJournal.js";
import { uiButton, uiCheckRow, uiConfirm, uiEl, uiIconButton, uiModal, uiPrompt } from "./ui.js";

/** Настройка браузера: свои заготовки сценариев (видны во всех объектах). */
export const SCENARIO_TEMPLATES_SETTING = "scenarioTemplates";
/** Настройка браузера: журнал в «Сценариях» свёрнут. */
export const SCENARIOS_JOURNAL_SETTING = "scenariosJournalCollapsed";
/** Сколько после срабатывания блок остаётся подсвеченным, мс (история 4.23). */
export const SCENARIO_FIRED_MS = 1500;

// ——— чистая половина: поиск и список ——————————————————————————————————

/** Ключ сравнения слов поиска: регистр и «ё»/«е» не важны, края без пробелов. */
export function scenariosKey(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .trim();
}

/** Сценарий, который открыт: выбранный, а если его нет в объекте — первый из списка. */
export function scenariosCurrent(project, scenarioId) {
  if (!project) return null;
  const chosen = scenarioId ? findScenario(project, scenarioId) : null;
  return chosen || scenariosInOrder(project)[0] || null;
}

/**
 * Строки списка: `[{id, name, kind, active, phrase, index, first, last,
 * issues}]` в порядке выполнения. `query` — часть имени, `kind` — вид
 * (`""` — все). `index`, `first`, `last` — место в **полном** списке: под
 * поиском порядок не меняется, а кнопки перестановки читают их.
 * `accessories` — готовый `homeAccessories(project)` (один раз на кадр).
 * `faults` — `Map<id сценария, fault>` от имитации: у строки появляются `fault`
 * (слова: «остановлен: завис», «ошибка в строке 3») и `hung`; зависший
 * сценарий показан выключенным — включение возвращает его.
 */
export function scenariosListRows(project, { query = "", kind = "" } = {}, accessories = null, faults = null) {
  if (!project) return [];
  const ordered = scenariosInOrder(project);
  const wanted = scenariosKey(query);
  const home = accessories || homeAccessories(project);
  const rows = [];
  ordered.forEach((scenario, index) => {
    if (kind && scenario.kind !== kind) return;
    if (wanted && !scenariosKey(scenario.name).includes(wanted)) return;
    const fault = faults && faults.get ? faults.get(scenario.id) || null : null;
    rows.push({
      id: scenario.id,
      name: scenario.name,
      kind: scenario.kind,
      active: scenario.active !== false && !(fault && fault.code === "hung"),
      hung: Boolean(fault && fault.code === "hung"),
      fault: scenarioScriptFaultText(fault, "list"),
      phrase: scenarioPhraseParts(project, scenario)
        .map((part) => part.text)
        .join(""),
      index,
      first: index === 0,
      last: index === ordered.length - 1,
      issues: scenarioIssues(project, scenario, home).length,
    });
  });
  return rows;
}

// ——— чистая половина: команды над объектом ————————————————————————————
//
// Каждая отдаёт `{project, label, scenarioId?}` или `null` — менять нечего.
// Метка шага — `strings.history.*`: Ctrl+Z называет, что отменяет.

function scenariosResult(before, after, label, extra = {}) {
  return after === before ? null : { project: after, label, ...extra };
}

/** Добавить готовый сценарий (значение для `addScenario`) в конец списка. */
export function scenariosAdd(project, scenario) {
  const made = addScenario(project, scenario);
  return { project: made.project, label: strings.history.addScenario, scenarioId: made.scenario.id };
}

/** Сценарий из заготовки (встроенной или своей): пустые места под устройства. */
export function scenariosFromTemplate(project, template) {
  const made = addScenario(project, scenarioFromTemplate(template));
  return { project: made.project, label: strings.history.scenarioFromTemplate, scenarioId: made.scenario.id };
}

/** Переименовать; пустое и прежнее имя — ничего не меняют. */
export function scenariosRename(project, scenarioId, name) {
  const next = String(name ?? "").trim();
  if (!next || !findScenario(project, scenarioId)) return null;
  return scenariosResult(project, updateScenario(project, scenarioId, { name: next }).project, strings.history.renameScenario);
}

/** Дубль сценария в конец списка: новые id блоков, привязки логики не копируются. */
export function scenariosDuplicate(project, scenarioId) {
  const source = findScenario(project, scenarioId);
  if (!source) return null;
  const copy = JSON.parse(JSON.stringify(source));
  delete copy.id;
  delete copy.order;
  copy.name = text("scenarios.list.copyName", { name: source.name });
  if (source.kind === "block") copy.targets = scenarioFromTemplate({ scenario: { targets: source.targets } }).targets;
  const made = addScenario(project, copy);
  return { project: made.project, label: strings.history.duplicateScenario, scenarioId: made.scenario.id };
}

/** Удалить сценарий; `nextId` — какой открыть следом (сосед по списку). */
export function scenariosRemove(project, scenarioId) {
  if (!findScenario(project, scenarioId)) return null;
  const ordered = scenariosInOrder(project);
  const at = ordered.findIndex((item) => item.id === scenarioId);
  const neighbour = ordered[at + 1] || ordered[at - 1] || null;
  const removed = deleteScenario(project, scenarioId);
  return { project: removed.project, label: strings.history.removeScenario, nextId: neighbour ? neighbour.id : null };
}

/** Сдвинуть сценарий на `delta` мест (−1 выше, +1 ниже); у края — ничего. */
export function scenariosMoveBy(project, scenarioId, delta) {
  const ordered = scenariosInOrder(project);
  const at = ordered.findIndex((item) => item.id === scenarioId);
  if (at < 0) return null;
  const target = at + delta;
  if (target < 0 || target >= ordered.length) return null;
  return scenariosResult(project, moveScenario(project, scenarioId, target).project, strings.history.moveScenario);
}

/** «Активный» сценария. */
export function scenariosSetActive(project, scenarioId, on) {
  if (!findScenario(project, scenarioId)) return null;
  return scenariosResult(project, updateScenario(project, scenarioId, { active: on === true }).project, strings.history.scenarioActive);
}

/** Параметры сценария: `onStart`, `sequential`, `description`. */
export function scenariosSetParams(project, scenarioId, patch) {
  if (!findScenario(project, scenarioId)) return null;
  const allowed = {};
  for (const key of ["onStart", "sequential", "description"]) if (patch && key in patch) allowed[key] = patch[key];
  return scenariosResult(project, updateScenario(project, scenarioId, allowed).project, strings.history.scenarioParams);
}

// ——— чистая половина: свои заготовки ——————————————————————————————————
//
// Живут в настройках браузера и видны во всех объектах (история 4.25).

/** Добавить свою заготовку (из `scenarioToTemplate`) в список; id выдаёт эта функция. */
export function scenariosTemplatesAdd(list, template) {
  const name = String(template && template.name ? template.name : "").trim();
  if (!name) return list;
  return [...list, { ...JSON.parse(JSON.stringify(template)), id: scenarioNewId(), name }];
}

/** Переименовать свою заготовку; пустое имя и чужой id — список не меняется. */
export function scenariosTemplatesRename(list, templateId, name) {
  const next = String(name ?? "").trim();
  if (!next || !list.some((item) => item.id === templateId)) return list;
  return list.map((item) => (item.id === templateId ? { ...item, name: next } : item));
}

/** Убрать свою заготовку. */
export function scenariosTemplatesRemove(list, templateId) {
  return list.some((item) => item.id === templateId) ? list.filter((item) => item.id !== templateId) : list;
}

// ——— чистая половина: устройства и типы без аксессуара ——————————————————

/**
 * Устройства объекта по помещениям для выбора: `[{roomId, name, devices:
 * [{markId, label, typeName, kindLabel}]}]`; помещения — в порядке списка,
 * «Без помещения» — последним, пустые группы не показываются. `query` — часть
 * обозначения, названия типа или вида аксессуара, помещения.
 */
export function scenariosDeviceGroups(project, query = "") {
  if (!project) return [];
  const wanted = scenariosKey(query);
  const groups = new Map();
  for (const room of roomsInOrder(project)) groups.set(room.id, { roomId: room.id, name: room.name, devices: [] });
  const loose = { roomId: null, name: strings.scenarios.side.noRoom, devices: [] };
  for (const accessory of homeAccessories(project)) {
    const type = findType(project, accessory.typeId);
    const group = (accessory.roomId && groups.get(accessory.roomId)) || loose;
    const device = {
      markId: accessory.markId,
      label: accessory.label,
      typeName: type ? type.name : "",
      kindLabel: strings.sim.kinds[accessory.kind] || "",
    };
    if (wanted) {
      const haystack = scenariosKey([device.label, device.typeName, device.kindLabel, group.name].join(" "));
      if (!haystack.includes(wanted)) continue;
    }
    group.devices.push(device);
  }
  return [...groups.values(), loose].filter((group) => group.devices.length > 0);
}

/** Сервисы выбранного устройства строками: «Лампа: Включено, Яркость» (без служебных). */
export function scenariosDeviceLines(project, markId) {
  const accessory = homeAccessories(project).find((item) => item.markId === markId);
  if (!accessory) return [];
  return accessory.services
    .filter((service) => !service.aux)
    .map((service) => {
      const name = strings.sim.services[service.type] || service.type;
      const chars = service.chars.map((char) => strings.sim.chars[char.type] || char.type);
      return chars.length > 0 ? name + ": " + chars.join(", ") : name;
    });
}

/** Типы, у которых аксессуар не угадать (история 1.7): `[{typeId, code, name, marks}]`. */
export function scenariosTypesWithoutDevice(project) {
  if (!project) return [];
  return typesInOrder(project)
    .flatMap((group) => group.types)
    .filter((type) => typeDeviceUnknown(project, type.id))
    .map((type) => ({
      typeId: type.id,
      code: type.code,
      name: type.name,
      marks: project.marks.filter((mark) => mark.typeId === type.id).length,
    }));
}

/** Виды аксессуара для выбора одним действием: `[{key, label}]`, «Без аксессуара» последним. */
export function scenariosDeviceKinds() {
  return [...DEVICE_KINDS.filter((kind) => kind.key !== "none").map((kind) => ({ key: kind.key, label: strings.sim.kinds[kind.key] || kind.key })), { key: "none", label: strings.sim.kinds.none }];
}

/** Задать типу вид аксессуара одним действием (`"none"` — осознанно без аксессуара). */
export function scenariosSetTypeKind(project, typeId, key) {
  if (!findType(project, typeId)) return null;
  const record = deviceTypeRecord(deviceDraftKind(null, key));
  return scenariosResult(project, setTypeDevice(project, typeId, record).project, strings.history.typeDevice);
}

// ——— чистая половина: проблемы словами и «сработало только что» ———————————

/** Проблема сценария словами (истории 4.21, 4.26): подставляет обозначение метки в петлю. */
export function scenariosIssueText(project, scenario, issue) {
  if (issue.code === "loop") {
    const found = issue.blockId ? scenarioFind(scenario, issue.blockId) : null;
    const markId = found ? scenarioBlockMarks(found.block)[0] : null;
    const mark = markId ? findMark(project, markId) : null;
    if (!mark) return strings.scenarios.issues.loopNone;
    return text("scenarios.issues.loop", { label: labelOf(project, mark.id) });
  }
  return strings.scenarios.issues[issue.code] || "";
}

/**
 * Память «сработало только что»: записи журнала с блоком (запуск блока или
 * истинное условие) подсвечивают блок на `ttl` мс. `note(entries, now)` —
 * принять новые записи, `active(now)` — какие блоки подсвечены, `next(now)` —
 * когда подсветка кончится (чтобы вовремя перерисовать), `null` — нечему.
 */
export function scenariosFiredTracker(ttl = SCENARIO_FIRED_MS) {
  const at = new Map();
  return {
    note(entries, now) {
      for (const entry of Array.isArray(entries) ? entries : []) {
        if (!entry || !entry.blockId) continue;
        if (entry.kind === "run" || (entry.kind === "cond" && entry.result === true)) at.set(entry.blockId, now);
      }
    },
    active(now) {
      const out = new Set();
      for (const [blockId, time] of at) {
        if (now - time < ttl) out.add(blockId);
        else at.delete(blockId);
      }
      return out;
    },
    next(now) {
      let soonest = null;
      for (const time of at.values()) {
        const end = time + ttl;
        if (end > now && (soonest === null || end < soonest)) soonest = end;
      }
      return soonest;
    },
  };
}

/**
 * Может ли человек править сценарии: компьютер и планшет — и в раскладке
 * просмотра (`tablet`, F2), телефон — нет.
 */
export function scenariosCanEdit(layout, tablet = false) {
  return layoutAllowsState("editScenarios", { layout, tablet });
}

/**
 * Может ли человек включать и выключать сценарии отметкой «Активный» — везде,
 * и на телефоне (история 4.29, F2): это шаг истории, как на компьютере.
 */
export function scenariosCanToggle(layout, tablet = false) {
  return layoutAllowsState("toggleScenarios", { layout, tablet });
}

// ——— двери для следующих шагов сборки ———————————————————————————————————
//
// Редактор блоков (таск 11) и загрузка JS (таск 12) подключаются сюда, не
// трогая каркас: `scenariosHook("editor", fn)` — `fn(host, ctx)` рисует
// редактор блочного сценария в узле `host`; `scenariosHook("loadScript", fn)` —
// `fn(ctx)` открывает загрузку JS. `ctx` — `{api, project, scenario, canEdit,
// picked, commit(result), highlight(markIds)}`.
const scenariosHooks = new Map();

export function scenariosHook(name, fn) {
  if (typeof fn === "function") scenariosHooks.set(name, fn);
  else scenariosHooks.delete(name);
}

// ——— экранная половина ——————————————————————————————————————————————

let scenariosOwnTemplates = [];

function scenariosLoadTemplates(after) {
  Promise.resolve(getSetting(SCENARIO_TEMPLATES_SETTING))
    .then((saved) => {
      scenariosOwnTemplates = scenarioTemplatesFrom(saved);
      if (after) after();
    })
    .catch(() => {});
}

function scenariosSaveTemplates(list) {
  scenariosOwnTemplates = list;
  Promise.resolve(setSetting(SCENARIO_TEMPLATES_SETTING, list)).catch(() => {});
}

function mountScenariosScreen(host, api) {
  host.classList.add("scn");
  const view = { query: "", kind: "", deviceQuery: "" };
  const fired = scenariosFiredTracker();
  let built = false;
  let miniPlan = null;
  let cardView = null;
  let cardKey = "";
  let frame = 0;
  let firedTimer = null;

  const state = () => api.getState();
  const canEdit = () => scenariosCanEdit(state().layout, state().tablet);
  const canToggle = () => scenariosCanToggle(state().layout, state().tablet);

  // ——— запись в объект ———

  function commit(result) {
    if (!result) return false;
    const now = state();
    try {
      canvasCommit(now.project, result.project, result.label, result.patch ? { patch: result.patch } : {});
    } catch (error) {
      reportAppError(error);
      return false;
    }
    return true;
  }

  function open(scenarioId) {
    api.setState({ scenarioId });
  }

  // Правка, после которой открывается другой сценарий: выбор едет в той же
  // записи истории, и отмена возвращает прежний.
  function commitAndOpen(result, scenarioId) {
    if (!result) return;
    commit({ ...result, patch: { scenarioId } });
  }

  // ——— полоса запуска и часов ———
  // Та же сборка, что над планом «Схемы» (`simBarMount`): режим её только
  // монтирует в свою верхнюю строку.

  const bar = uiEl("div", { class: "scn__bar" });
  const barParts = simBarMount(bar, api);

  function renderBar() {
    barParts.update();
  }

  // ——— список слева ———

  const listTitle = uiEl("h3", { class: "scn-list__title", text: strings.scenarios.list.title });
  const createEmpty = uiButton("+ " + strings.scenarios.list.createEmpty, {
    class: "ui-btn scn-list__create",
    title: strings.scenarios.list.createEmptyHint,
    on: { click: () => createBlank() },
  });
  const createTemplate = uiButton(strings.scenarios.list.createTemplate, {
    class: "ui-btn scn-list__create",
    title: strings.scenarios.list.createTemplateHint,
    on: { click: () => openTemplates() },
  });
  const createScript = uiButton(strings.scenarios.list.createScript, {
    class: "ui-btn scn-list__create",
    title: strings.scenarios.list.createScriptHint,
    on: { click: () => loadScript() },
  });
  const createPaste = uiButton(strings.scenarios.script.paste, {
    class: "ui-btn scn-list__create",
    title: strings.scenarios.script.pasteHint,
    on: { click: () => pasteScript() },
  });
  const createRow = uiEl("div", { class: "scn-list__creates" }, [createEmpty, createTemplate, createScript, createPaste]);
  const search = uiEl("input", {
    class: "ui-input scn-list__search",
    type: "search",
    placeholder: strings.scenarios.list.search,
    attrs: { "aria-label": strings.scenarios.list.search },
    on: {
      input: (event) => {
        view.query = event.target.value;
        renderList();
      },
    },
  });
  const kindSelect = uiEl(
    "select",
    {
      class: "ui-select scn-list__kind",
      attrs: { "aria-label": strings.scenarios.list.kindFilter },
      title: strings.scenarios.list.kindFilter,
      on: {
        change: (event) => {
          view.kind = event.target.value;
          renderList();
        },
      },
    },
    [
      uiEl("option", { text: strings.scenarios.list.kindAll, attrs: { value: "" } }),
      ...["block", "logic", "global"].map((kind) => uiEl("option", { text: strings.scenarios.list.kindPlural[kind], attrs: { value: kind } })),
    ],
  );
  const listRows = uiEl("ul", { class: "scn-list__rows" });
  const listEmpty = uiEl("p", { class: "scn-list__empty" });
  const typesBox = uiEl("section", { class: "scn-types" });
  const list = uiEl("section", { class: "scn__list" }, [
    uiEl("div", { class: "scn-list__head" }, [listTitle, createRow, uiEl("div", { class: "scn-list__filters" }, [search, kindSelect])]),
    uiEl("div", { class: "scn-list__scroll" }, [listRows, listEmpty]),
    typesBox,
  ]);

  function createBlank() {
    const now = state();
    if (!now.project || !canEdit()) return;
    const made = scenariosAdd(now.project, { kind: "block" });
    commitAndOpen(made, made.scenarioId);
  }

  function loadScript() {
    const hook = scenariosHooks.get("loadScript");
    if (hook) hook(centerContext());
  }

  function pasteScript() {
    const hook = scenariosHooks.get("pasteScript");
    if (hook) hook(centerContext());
  }

  function renderRow(row, selected, editable) {
    const now = state();
    const toggles = canToggle();
    const active = uiEl("input", { type: "checkbox", attrs: { "aria-label": strings.scenarios.list.active } });
    active.checked = row.active;
    active.disabled = !toggles;
    active.addEventListener("click", (event) => event.stopPropagation());
    active.addEventListener("change", () => {
      commit(scenariosSetActive(state().project, row.id, active.checked));
      // Повторная активация возвращает остановленный сторожем сценарий.
      if (active.checked && row.hung) simScenarioActive(row.id, true);
    });
    const activeLabel = uiEl("label", { class: "scn-row__active", title: toggles ? strings.scenarios.list.activeHint : strings.scenarios.list.activeReadOnly }, [
      active,
      uiEl("span", { text: strings.scenarios.list.active }),
    ]);
    const head = uiEl("div", { class: "scn-row__head" }, [
      uiEl("span", { class: "scn-row__name", text: row.name }),
      uiEl("span", { class: "scn-row__kind is-" + row.kind, text: strings.scenarios.list.kinds[row.kind] }),
    ]);
    const parts = [head, uiEl("p", { class: "scn-row__phrase", text: row.phrase }), activeLabel];
    if (row.fault) parts.push(uiEl("span", { class: "scn-row__fault", title: row.hung ? strings.scenarios.list.fault.hungHint : "", text: row.fault }));
    if (row.issues > 0) parts.push(uiEl("span", { class: "scn-row__issues", title: strings.scenarios.list.issuesHint, text: text("scenarios.list.issues", { count: row.issues }) }));
    const item = uiEl("li", { class: "scn-row" + (selected ? " is-selected" : "") + (row.active ? "" : " is-inactive"), attrs: { "data-scenario": row.id } }, parts);
    item.addEventListener("click", () => open(row.id));
    if (selected && editable) {
      const tools = uiEl("div", { class: "scn-row__tools" }, [
        uiIconButton("up", { title: strings.scenarios.list.up + ". " + strings.scenarios.list.orderHint, on: { click: (event) => { event.stopPropagation(); commit(scenariosMoveBy(now.project, row.id, -1)); } } }),
        uiIconButton("down", { title: strings.scenarios.list.down + ". " + strings.scenarios.list.orderHint, on: { click: (event) => { event.stopPropagation(); commit(scenariosMoveBy(now.project, row.id, 1)); } } }),
        uiIconButton("edit", { title: strings.scenarios.list.rename, on: { click: (event) => { event.stopPropagation(); rename(row.id); } } }),
        uiButton(strings.scenarios.list.duplicate, { class: "ui-btn", on: { click: (event) => { event.stopPropagation(); duplicate(row.id); } } }),
        uiIconButton("trash", { title: strings.scenarios.list.remove, class: "ui-btn ui-btn--danger", on: { click: (event) => { event.stopPropagation(); remove(row.id); } } }),
      ]);
      tools.children[0].disabled = row.first;
      tools.children[1].disabled = row.last;
      item.append(tools);
    }
    return item;
  }

  function renderList() {
    const now = state();
    if (!now.project) return;
    const editable = canEdit();
    createRow.hidden = !editable;
    createScript.disabled = !scenariosHooks.has("loadScript");
    createScript.title = createScript.disabled ? strings.scenarios.list.createScriptLater : strings.scenarios.list.createScriptHint;
    createPaste.disabled = !scenariosHooks.has("pasteScript");
    const current = scenariosCurrent(now.project, now.scenarioId);
    const rows = scenariosListRows(now.project, view, homeAccessories(now.project), scenarioScriptFaults(state().project));
    listRows.replaceChildren(...rows.map((row) => renderRow(row, current !== null && row.id === current.id, editable)));
    const total = scenariosInOrder(now.project).length;
    const noScenarios = total === 0;
    list.classList.toggle("is-empty", noScenarios);
    listEmpty.hidden = rows.length > 0;
    listEmpty.textContent = noScenarios ? "" : strings.scenarios.list.noMatch;
    renderTypes();
  }

  function renderTypes() {
    const now = state();
    const items = scenariosTypesWithoutDevice(now.project);
    typesBox.hidden = items.length === 0;
    if (items.length === 0) {
      typesBox.replaceChildren();
      return;
    }
    const editable = canEdit();
    const kinds = scenariosDeviceKinds();
    typesBox.replaceChildren(
      uiEl("h3", { class: "scn-types__title", text: strings.scenarios.types.title }),
      uiEl("p", { class: "scn-types__hint", text: strings.scenarios.types.hint }),
      ...items.map((item) => {
        const select = uiEl(
          "select",
          {
            class: "ui-select scn-types__pick",
            title: strings.scenarios.types.pick,
            attrs: { "aria-label": text("scenarios.types.pickLabel", { code: item.code }) },
            on: {
              change: (event) => {
                const key = event.target.value;
                if (key) commit(scenariosSetTypeKind(state().project, item.typeId, key));
              },
            },
          },
          [
            uiEl("option", { text: strings.scenarios.types.pick, attrs: { value: "" } }),
            ...kinds.map((kind) => uiEl("option", { text: kind.key === "none" ? strings.scenarios.types.keepNone : kind.label, attrs: { value: kind.key } })),
          ],
        );
        select.disabled = !editable;
        return uiEl("div", { class: "scn-types__row", attrs: { "data-type": item.typeId } }, [
          uiEl("span", { class: "scn-types__name", text: item.code + " · " + item.name }),
          uiEl("span", { class: "scn-types__marks", text: text("scenarios.types.marks", { count: item.marks }) }),
          select,
        ]);
      }),
    );
  }

  // ——— действия над сценарием ———

  async function rename(scenarioId) {
    const now = state();
    const scenario = findScenario(now.project, scenarioId);
    if (!scenario || !canEdit()) return;
    const name = await uiPrompt({ title: strings.scenarios.dialogs.renameTitle, value: scenario.name, submitLabel: strings.scenarios.dialogs.renameSubmit });
    if (name) commit(scenariosRename(state().project, scenarioId, name));
  }

  function duplicate(scenarioId) {
    const made = scenariosDuplicate(state().project, scenarioId);
    if (made && canEdit()) commitAndOpen(made, made.scenarioId);
  }

  async function remove(scenarioId) {
    const now = state();
    const scenario = findScenario(now.project, scenarioId);
    if (!scenario || !canEdit()) return;
    const sure = await uiConfirm({
      title: strings.scenarios.dialogs.removeTitle,
      message: text("scenarios.dialogs.removeMessage", { name: scenario.name }),
      confirmLabel: strings.scenarios.dialogs.removeConfirm,
    });
    if (!sure) return;
    const result = scenariosRemove(state().project, scenarioId);
    if (result) commitAndOpen(result, result.nextId);
  }

  function slotsText(template) {
    return template.slots.map((slot) => scenarioSlotLabel(slot.key)).join(", ");
  }

  function openTemplates() {
    if (!canEdit()) return;
    let modal = null;
    const body = uiEl("div", { class: "scn-templates" });
    const make = (template) => {
      const made = scenariosFromTemplate(state().project, template);
      modal.close();
      commitAndOpen(made, made.scenarioId);
    };
    const draw = () => {
      const builtin = SCENARIO_TEMPLATES.map((template) =>
        uiEl("div", { class: "scn-templates__item", attrs: { "data-template": template.key } }, [
          uiEl("div", { class: "scn-templates__text" }, [
            uiEl("strong", { text: template.name }),
            uiEl("span", { class: "scn-templates__desc", text: template.description }),
            uiEl("span", { class: "scn-templates__slots", text: text("scenarios.dialogs.templateSlots", { list: slotsText(template) }) }),
          ]),
          uiButton(strings.scenarios.dialogs.templateCreate, { class: "ui-btn ui-btn--primary", on: { click: () => make(template) } }),
        ]),
      );
      const own = scenariosOwnTemplates.map((template) =>
        uiEl("div", { class: "scn-templates__item", attrs: { "data-template": template.id } }, [
          uiEl("div", { class: "scn-templates__text" }, [
            uiEl("strong", { text: template.name }),
            uiEl("span", { class: "scn-templates__slots", text: text("scenarios.dialogs.templateSlots", { list: slotsText(template) || "—" }) }),
          ]),
          uiButton(strings.scenarios.dialogs.templateCreate, { class: "ui-btn ui-btn--primary", on: { click: () => make(template) } }),
          uiIconButton("edit", {
            title: strings.scenarios.dialogs.templateRename,
            on: {
              click: async () => {
                const name = await uiPrompt({ title: strings.scenarios.dialogs.templateRenameTitle, value: template.name, submitLabel: strings.scenarios.dialogs.renameSubmit });
                if (name) {
                  scenariosSaveTemplates(scenariosTemplatesRename(scenariosOwnTemplates, template.id, name));
                  draw();
                }
              },
            },
          }),
          uiIconButton("trash", {
            title: strings.scenarios.dialogs.templateRemove,
            class: "ui-btn ui-btn--danger",
            on: {
              click: async () => {
                const sure = await uiConfirm({
                  title: strings.scenarios.dialogs.templateRemoveTitle,
                  message: text("scenarios.dialogs.templateRemoveMessage", { name: template.name }),
                  confirmLabel: strings.scenarios.dialogs.templateRemove,
                });
                if (sure) {
                  scenariosSaveTemplates(scenariosTemplatesRemove(scenariosOwnTemplates, template.id));
                  draw();
                }
              },
            },
          }),
        ]),
      );
      body.replaceChildren(
        uiEl("h4", { class: "scn-templates__head", text: strings.scenarios.dialogs.templateBuiltin }),
        ...builtin,
        uiEl("h4", { class: "scn-templates__head", text: strings.scenarios.dialogs.templateOwn }),
        ...(own.length > 0 ? own : [uiEl("p", { class: "scn-templates__empty", text: strings.scenarios.dialogs.templateOwnEmpty })]),
      );
    };
    draw();
    modal = uiModal({
      title: strings.scenarios.dialogs.templateTitle,
      body,
      actions: [uiButton(strings.scenarios.dialogs.templateClose, { on: { click: () => modal.close() } })],
    });
  }

  async function saveAsTemplate(scenario) {
    const name = await uiPrompt({
      title: strings.scenarios.dialogs.saveTemplateTitle,
      value: scenario.name,
      placeholder: strings.scenarios.dialogs.saveTemplateName,
      submitLabel: strings.scenarios.dialogs.saveTemplateSubmit,
    });
    if (!name) return;
    const template = { ...scenarioToTemplate(scenario, state().project), name };
    scenariosSaveTemplates(scenariosTemplatesAdd(scenariosOwnTemplates, template));
    api.notify(text("scenarios.center.templateSaved", { name }), "success");
  }

  // ——— середина ———

  const centerHead = uiEl("div", { class: "scn-center__head" });
  const centerIssues = uiEl("ul", { class: "scn-center__issues" });
  const centerPhrase = uiEl("div", { class: "scn-center__phrase" });
  const centerEditor = uiEl("div", { class: "scn-center__editor", attrs: { id: "scn-editor" } });
  const centerParams = uiEl("div", { class: "scn-center__params" });
  const centerEmpty = uiEl("div", { class: "scn-center__invite" });
  const center = uiEl("section", { class: "scn__center" }, [centerEmpty, centerHead, centerIssues, centerPhrase, centerEditor, centerParams]);

  function centerContext() {
    const now = state();
    return {
      api,
      project: now.project,
      scenario: scenariosCurrent(now.project, now.scenarioId),
      canEdit: canEdit(),
      picked: now.selectedMarkIds[0] || null,
      commit,
      highlight: (markIds) => miniPlan && miniPlan.setHighlight(markIds),
    };
  }

  function renderInvite(project) {
    const editable = canEdit();
    const open = project && scenariosInOrder(project).length === 0;
    centerEmpty.hidden = !open;
    if (!open) return;
    centerEmpty.replaceChildren(
      uiEl("h3", { class: "scn-invite__title", text: strings.scenarios.invite.title }),
      uiEl("p", { class: "scn-invite__text", text: strings.scenarios.invite.text }),
      ...(editable
        ? [
            uiEl("div", { class: "scn-invite__buttons" }, [
              uiButton(strings.scenarios.list.createEmpty, { class: "ui-btn ui-btn--primary", title: strings.scenarios.list.createEmptyHint, on: { click: () => createBlank() } }),
              uiButton(strings.scenarios.list.createTemplate, { class: "ui-btn", title: strings.scenarios.list.createTemplateHint, on: { click: () => openTemplates() } }),
              (() => {
                const button = uiButton(strings.scenarios.list.createScript, { class: "ui-btn", title: strings.scenarios.list.createScriptHint, on: { click: () => loadScript() } });
                button.disabled = !scenariosHooks.has("loadScript");
                if (button.disabled) button.title = strings.scenarios.list.createScriptLater;
                return button;
              })(),
            ]),
          ]
        : [uiEl("p", { class: "scn-invite__text", text: strings.scenarios.mobile.viewOnly })]),
    );
  }

  // Строки фразы открытого сценария: `{node, block}` — чтобы подсветку
  // «сработало только что» обновлять, не пересобирая середину.
  let phraseLines = [];

  function refreshFired() {
    const lit = fired.active(Date.now());
    for (const line of phraseLines) line.node.classList.toggle("is-fired", [...lit].some((id) => scenarioBlockHas(line.block, id)));
  }

  function renderPhrase(project, scenario) {
    const lit = fired.active(Date.now());
    phraseLines = [];
    centerPhrase.replaceChildren();
    centerPhrase.append(uiEl("h4", { class: "scn-center__label", text: strings.scenarios.center.phrase }));
    if (scenario.kind !== "block") {
      centerPhrase.append(uiEl("p", { class: "scn-line", text: scenarioPhraseParts(project, scenario).map((part) => part.text).join("") }));
      centerPhrase.append(uiEl("p", { class: "scn-center__note", text: strings.scenarios.center.jsNote }));
      return;
    }
    const targets = Array.isArray(scenario.targets) ? scenario.targets : [];
    if (targets.length === 0) {
      centerPhrase.append(uiEl("p", { class: "scn-line is-empty", text: strings.scenarios.phrase.empty }));
      return;
    }
    // Каждый блок верхнего уровня — своя строка: наведение на неё подсвечивает
    // его устройства на мини-плане, сработавший блок горит полторы секунды.
    for (const block of targets) {
      const parts = scenarioPhraseParts(project, { ...scenario, targets: [block] });
      const marks = scenarioBlockMarks(block);
      const isLit = [...lit].some((id) => scenarioBlockHas(block, id));
      const line = uiEl(
        "p",
        { class: "scn-line" + (isLit ? " is-fired" : ""), attrs: { "data-block": block.id || "" } },
        parts.map((part) => uiEl("span", { class: part.slot ? "scn-slot" : "scn-text", text: part.text, title: part.slot ? strings.scenarios.center.emptyMarks : "" })),
      );
      line.addEventListener("pointerenter", () => miniPlan && miniPlan.setHighlight(marks));
      line.addEventListener("pointerleave", () => miniPlan && miniPlan.setHighlight([]));
      centerPhrase.append(line);
      phraseLines.push({ node: line, block });
    }
  }

  function renderParams(project, scenario, editable) {
    const onStart = uiEl("input", { type: "checkbox" });
    onStart.checked = scenario.onStart === true;
    onStart.disabled = !editable;
    onStart.addEventListener("change", () => commit(scenariosSetParams(state().project, scenario.id, { onStart: onStart.checked })));
    const sequential = uiEl("input", { type: "checkbox" });
    sequential.checked = scenario.sequential === true;
    sequential.disabled = !editable;
    sequential.addEventListener("change", () => commit(scenariosSetParams(state().project, scenario.id, { sequential: sequential.checked })));
    const active = uiEl("input", { type: "checkbox" });
    active.checked = scenario.active !== false;
    active.disabled = !editable;
    active.addEventListener("change", () => commit(scenariosSetActive(state().project, scenario.id, active.checked)));
    const description = uiEl("textarea", {
      class: "ui-input scn-center__description",
      placeholder: strings.scenarios.center.descriptionPlaceholder,
      attrs: { rows: "2", "aria-label": strings.scenarios.center.description },
    });
    description.value = scenario.description || "";
    description.disabled = !editable;
    // Описание правится по уходу из поля, а не на каждую клавишу — иначе
    // история забилась бы буквами.
    description.addEventListener("change", () => commit(scenariosSetParams(state().project, scenario.id, { description: description.value })));
    centerParams.replaceChildren(
      uiEl("h4", { class: "scn-center__label", text: strings.scenarios.center.params }),
      uiEl("div", { class: "scn-center__checks" }, [
        uiCheckRow(active, strings.scenarios.list.active, strings.scenarios.list.activeHint),
        uiCheckRow(onStart, strings.scenarios.center.onStart, strings.scenarios.center.onStartHint),
        uiCheckRow(sequential, strings.scenarios.center.sequential, strings.scenarios.center.sequentialHint),
      ]),
      uiEl("label", { class: "scn-center__field" }, [uiEl("span", { text: strings.scenarios.center.description }), description]),
    );
  }

  // Логический и глобальный сценарий: кнопки «Код» и «Скачать», состояние
  // текста (синтаксис, совместимость с хабом) и где он привязан.
  function renderScript(project, scenario, editable) {
    const status = scenarioScriptStatus(scenario);
    const fault = scenarioScriptFaults(state().project).get(scenario.id) || null;
    const faultLine = scenarioScriptFaultText(fault, "list");
    const buttons = uiEl("div", { class: "scn-script__buttons" }, [
      uiButton(editable ? strings.scenarios.script.edit : strings.scenarios.script.editHint, {
        class: "ui-btn ui-btn--primary",
        title: strings.scenarios.script.editHint,
        on: { click: () => scenarioScriptEdit(centerContext(), scenario.id) },
      }),
      uiButton(strings.scenarios.script.editDownload, {
        class: "ui-btn",
        title: strings.scenarios.script.editDownloadHint,
        on: { click: () => scenarioScriptDownload(scenario) },
      }),
    ]);
    const lines = [];
    if (faultLine) lines.push(uiEl("li", { class: "scn-script__fault", text: faultLine }));
    if (status.syntax) lines.push(uiEl("li", { class: "scn-script__syntax", text: scenarioScriptSyntaxText(status.syntax) }));
    if (status.warnings.length > 0) {
      lines.push(uiEl("li", { class: "scn-script__warn-title", text: strings.scenarios.script.warningsTitle }));
      for (const warning of status.warnings) lines.push(uiEl("li", { class: "scn-script__warn", text: scenarioScriptWarningText(warning) }));
    }
    centerEditor.append(buttons, uiEl("ul", { class: "scn-script__status" }, lines));
  }

  function renderCenter() {
    const now = state();
    const project = now.project;
    renderInvite(project);
    const scenario = scenariosCurrent(project, now.scenarioId);
    const has = Boolean(scenario);
    for (const node of [centerHead, centerIssues, centerPhrase, centerEditor, centerParams]) node.hidden = !has;
    if (!has) return;
    const editable = canEdit();
    const running = simRunning();
    const run = uiButton(strings.scenarios.list.run, {
      class: "ui-btn ui-btn--primary",
      title: running ? strings.scenarios.list.runHint : strings.scenarios.list.runStopped,
      on: { click: () => simScenarioRun(scenario.id) },
    });
    run.disabled = !running;
    const parts = [
      uiEl("h3", { class: "scn-center__name", text: scenario.name }),
      uiEl("span", { class: "scn-row__kind is-" + scenario.kind, text: strings.scenarios.list.kinds[scenario.kind] }),
      run,
    ];
    if (editable) {
      parts.push(uiButton(strings.scenarios.center.rename, { class: "ui-btn", on: { click: () => rename(scenario.id) } }));
      if (scenario.kind === "block") {
        parts.push(
          uiButton(strings.scenarios.center.saveTemplate, {
            class: "ui-btn",
            title: strings.scenarios.center.saveTemplateHint,
            on: { click: () => saveAsTemplate(scenario) },
          }),
        );
      }
    }
    centerHead.replaceChildren(...parts);
    const issues = scenario.kind === "block" ? scenarioIssues(project, scenario) : [];
    // Несколько неполных блоков — одна строка: список из десятка одинаковых фраз ничего не добавляет.
    const seen = new Set();
    centerIssues.replaceChildren(
      ...issues
        .map((issue) => scenariosIssueText(project, scenario, issue))
        .filter((line) => line && !seen.has(line) && seen.add(line))
        .map((line) => uiEl("li", { class: "scn-center__issue", text: line })),
    );
    centerIssues.hidden = issues.length === 0;
    renderPhrase(project, scenario);
    // Место редактора блоков (таск 11): если он подключён — рисует он.
    const editor = scenariosHooks.get("editor");
    centerEditor.replaceChildren();
    centerEditor.hidden = false;
    if (scenario.kind === "block") {
      if (editor) editor(centerEditor, centerContext());
      else if (editable) centerEditor.append(uiEl("p", { class: "scn-center__slot", text: strings.scenarios.center.editorSlot }));
      else centerEditor.append(uiEl("p", { class: "scn-center__slot", text: strings.scenarios.center.readOnly }));
    } else {
      renderScript(project, scenario, editable);
    }
    renderParams(project, scenario, editable);
  }

  // ——— справа: устройства, мини-план, карточка ———

  const deviceSearch = uiEl("input", {
    class: "ui-input scn-side__search",
    type: "search",
    placeholder: strings.scenarios.side.search,
    attrs: { "aria-label": strings.scenarios.side.search },
    on: {
      input: (event) => {
        view.deviceQuery = event.target.value;
        renderDevices();
      },
    },
  });
  const deviceList = uiEl("div", { class: "scn-side__devices" });
  const floors = uiEl("div", { class: "scn-side__floors" });
  const planHost = uiEl("div", { class: "scn-side__plan mini-plan", title: strings.scenarios.side.planHint });
  const cardHost = uiEl("div", { class: "scn-side__card" });
  const side = uiEl("aside", { class: "scn__side" }, [
    uiEl("h3", { class: "scn-side__title", text: strings.scenarios.side.devices }),
    deviceSearch,
    deviceList,
    floors,
    planHost,
    cardHost,
  ]);

  function pick(markId) {
    const now = state();
    const schemeId = miniPlanSchemeFor(now.project, markId, now.schemeId);
    api.setState({ selectedMarkIds: [markId], selectedOutlineId: null, ...(schemeId ? { schemeId } : {}) });
  }

  function renderDevices() {
    const now = state();
    if (!now.project) return;
    const groups = scenariosDeviceGroups(now.project, view.deviceQuery);
    const total = homeAccessories(now.project).length;
    if (groups.length === 0) {
      deviceList.replaceChildren(uiEl("p", { class: "scn-side__empty", text: total === 0 ? strings.scenarios.side.none : strings.scenarios.side.noMatch }));
      return;
    }
    const picked = now.selectedMarkIds[0] || null;
    deviceList.replaceChildren(
      ...groups.map((group) =>
        uiEl("div", { class: "scn-room", attrs: { "data-room": group.roomId || "" } }, [
          uiEl("h4", { class: "scn-room__name", text: group.name }),
          ...group.devices.map((device) => {
            const row = uiEl(
              "button",
              {
                class: "scn-device" + (device.markId === picked ? " is-picked" : ""),
                type: "button",
                attrs: { "data-mark": device.markId },
                on: { click: () => pick(device.markId) },
              },
              [uiEl("strong", { text: device.label }), uiEl("span", { text: device.typeName || device.kindLabel })],
            );
            return row;
          }),
        ]),
      ),
    );
    // Выбранное устройство раскрыто: его сервисы и характеристики — то, из чего
    // собирается условие или действие.
    if (picked) {
      const lines = scenariosDeviceLines(now.project, picked);
      const row = deviceList.querySelector('[data-mark="' + picked + '"]');
      if (row && lines.length > 0) row.after(uiEl("ul", { class: "scn-device__services" }, lines.map((line) => uiEl("li", { text: line }))));
    }
  }

  function renderFloors() {
    const now = state();
    const schemes = miniPlanSchemes(now.project);
    floors.hidden = schemes.length < 2;
    floors.replaceChildren(
      ...(schemes.length < 2
        ? []
        : schemes.map((scheme) =>
            uiButton(scheme.name, {
              class: "ui-btn scn-side__floor" + (scheme.id === now.schemeId ? " is-on" : ""),
              title: strings.scenarios.side.floor,
              on: { click: () => api.setState({ schemeId: scheme.id }) },
            }),
          )),
    );
  }

  function renderCard() {
    const now = state();
    const markId = now.selectedMarkIds[0] || null;
    const running = simRunning();
    const key = running && markId ? markId + "|" + (now.project && findMark(now.project, markId) ? "1" : "0") : "";
    if (key === cardKey && key !== "") return;
    cardKey = key;
    if (cardView) cardView.dispose();
    cardView = null;
    if (!markId || !now.project || !findMark(now.project, markId)) {
      cardHost.replaceChildren(uiEl("p", { class: "scn-side__empty", text: strings.scenarios.side.pickHint }));
      return;
    }
    if (!running) {
      // Привязки логики правят и при остановленном доме: формы опций приходят
      // от сухого прогона сценариев.
      cardView = scenarioScriptLogicView(markId);
      cardHost.replaceChildren(uiEl("p", { class: "scn-side__empty", text: strings.sim.card.stopped }), cardView.node);
      return;
    }
    cardView = deviceCardView(now.project, markId);
    cardHost.replaceChildren(uiEl("h4", { class: "scn-side__card-title", text: strings.scenarios.side.card }), cardView.node);
  }

  // ——— журнал внизу ———
  // Та же сборка, что в «Схеме» (`simJournalMount`); щелчок по строке
  // выбирает устройство и подсвечивает его на мини-плане.

  const journal = uiEl("section", { class: "scn__journal" });
  const journalParts = simJournalMount(journal, api, {
    title: strings.scenarios.journal.title,
    setting: SCENARIOS_JOURNAL_SETTING,
    collapsed: false,
    onRow: (row) => {
      pick(row.markId);
      if (miniPlan) {
        miniPlan.setHighlight([row.markId]);
        setTimeout(() => miniPlan && miniPlan.setHighlight([]), SCENARIO_FIRED_MS);
      }
    },
  });

  function renderJournal() {
    journalParts.draw();
  }

  // ——— сборка и перерисовка ———

  const layout = uiEl("div", { class: "scn__grid" }, [list, center, side]);
  host.replaceChildren(uiEl("div", { class: "scn__page" }, [bar, layout, journal]));

  function renderAll() {
    frame = 0;
    const now = state();
    if (now.screen !== "scenarios" || !now.project) return;
    host.classList.toggle("is-view-only", !canEdit());
    renderBar();
    renderList();
    renderCenter();
    renderDevices();
    renderFloors();
    renderCard();
    renderJournal();
    scheduleFiredClear();
  }

  function later() {
    if (frame) return;
    frame = scheduleFrame(renderAll);
  }

  // Подсветка сработавшего блока гаснет сама: к её концу — перерисовка.
  function scheduleFiredClear() {
    if (firedTimer) clearTimeout(firedTimer);
    firedTimer = null;
    const end = fired.next(Date.now());
    if (end !== null) {
      firedTimer = setTimeout(() => {
        refreshFired();
        scheduleFiredClear();
      }, Math.max(16, end - Date.now() + 16));
    }
  }

  function build() {
    if (built) return;
    built = true;
    miniPlan = createMiniPlan(planHost, api, { pick });
    scenariosLoadTemplates();
  }

  api.subscribe((next, changed) => {
    if (next.screen === "scenarios" && next.schemeId) build();
    if (
      "screen" in changed ||
      "project" in changed ||
      "scenarioId" in changed ||
      "layout" in changed ||
      "tablet" in changed ||
      "simRunning" in changed ||
      "selectedMarkIds" in changed ||
      "schemeId" in changed
    )
      later();
  });
  // События дома не пересобирают список, устройства и середину: меняются
  // только полоса, журнал и подсветка сработавших строк — иначе на большом
  // доме каждый кадр имитации перестраивал бы сотни строк.
  let liveFrame = 0;
  let liveLog = false;
  let faultKey = "";
  simWatch((payload) => {
    if (state().screen !== "scenarios") return;
    // Зависание или ошибка сценария — в списке и в середине сразу, не по следующей правке.
    const nextKey = JSON.stringify([...scenarioScriptFaults(state().project)]);
    if (nextKey !== faultKey) {
      faultKey = nextKey;
      later();
    }
    if (payload.log && payload.log.length > 0) {
      fired.note(payload.log, Date.now());
      liveLog = true;
    }
    if (liveFrame) return;
    liveFrame = scheduleFrame(() => {
      liveFrame = 0;
      renderBar();
      if (liveLog) {
        liveLog = false;
        renderJournal();
        refreshFired();
        scheduleFiredClear();
      }
    });
  });
  appClockWatch(() => {
    if (state().screen === "scenarios") renderBar();
  });
  // Бегущие часы обновляются по таймеру, пока режим на виду.
  if (typeof setInterval === "function") {
    setInterval(() => {
      if (state().screen === "scenarios" && simRunning()) renderBar();
    }, 250);
  }
  if (state().screen === "scenarios") {
    build();
    later();
  }
}

// Загрузка JS и вставка текста — через двери; запись в объект — `canvasCommit`.
scenarioScriptCommitter(canvasCommit);
scenariosHook("loadScript", scenarioScriptLoad);
scenariosHook("pasteScript", scenarioScriptPaste);

registerPanel(PANEL_IDS.screenScenarios, mountScenariosScreen);
