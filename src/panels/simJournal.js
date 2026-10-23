// Журнал имитации на экране (таск 08 сценариев; истории 6.1–6.3, 6.5).
//
// Сворачиваемый раздел в углу «Схемы»: время имитации, что изменилось,
// цепочка причин («С3 вкл ← ДД1 движение ← щелчок»), результаты условий и
// ошибки. Щелчок по строке подсвечивает метку на плане, фильтры — по
// сценарию и по устройству, «Очистить» — сеансовая лента (в файл и в браузер
// она не пишется).
//
// Тексты строк — по коду и подстановкам записи (`strings.sim.journal.<код>`):
// движок и страница кладут в запись и готовый `text`, но он собран до
// подстановки результата условий и разных мелочей, поэтому экран собирает
// сам. Сырой ключ вместо текста — дефект: тест перебирает все коды.
import { PANEL_IDS, registerPanel } from "../app.js";
import { canvasHighlightMark } from "../canvas.js";
import { findMark, findScenario, labelOf, scenariosInOrder } from "../model.js";
import { simCharMeta } from "../sim/catalog.js";
import { simJournal, simJournalClear, simWatch } from "../simulation.js";
import { getSetting, setSetting } from "../store.js";
import { strings, text } from "../strings.js";
import { deviceValueText } from "./deviceCard.js";
import { uiButton, uiEl, uiIcon } from "./ui.js";

/** Настройка браузера: журнал свёрнут (по умолчанию — да). */
export const SIM_JOURNAL_SETTING = "simJournalCollapsed";
/** Сколько последних строк рисуется в списке; лента хранит больше. */
export const SIM_JOURNAL_SHOWN = 300;

function simJournalPad(value) {
  return String(value).padStart(2, "0");
}

/** Время имитации строки: «21:05:09». */
export function simJournalTime(simMs) {
  const at = new Date(Number.isFinite(simMs) ? simMs : 0);
  return simJournalPad(at.getUTCHours()) + ":" + simJournalPad(at.getUTCMinutes()) + ":" + simJournalPad(at.getUTCSeconds());
}

// Значение характеристики словами: «да», «Включено», «22 °C».
function simJournalValue(char, value) {
  return deviceValueText(simCharMeta(char), char, value);
}

/** «истинно / ложно / пропущено» по результату условия. */
export function simJournalResult(result) {
  if (result === true) return strings.sim.log.true;
  if (result === false) return strings.sim.log.false;
  return strings.sim.log.skipped;
}

// Подстановки: логические значения — словами, у условий — `{result}`.
function simJournalVars(entry) {
  const out = {};
  for (const [name, value] of Object.entries(entry.vars || {})) {
    if (typeof value === "boolean") out[name] = name === "visible" ? (value ? strings.sim.log.shown : strings.sim.log.hidden) : value ? strings.sim.log.yes : strings.sim.log.no;
    else out[name] = value === null || value === undefined ? "?" : value;
  }
  if (entry.code === "blockCond" || entry.code === "blockIf") out.result = simJournalResult(entry.result);
  return out;
}

/**
 * Текст строки журнала. Запись с кодом собирается по словарю
 * `strings.sim.journal`; запись без кода — как есть (`text`). Сырой ключ
 * словаря наружу не выходит никогда: код без строки даёт «Событие имитации».
 * Изменение и нажатие устройства собираются заново из полей записи (`markId`,
 * `char`, `from`, `to`) — движок кладёт в готовый `text` сырые значения
 * («false → true»), а здесь они читаются словами; `project` даёт обозначение
 * метки.
 */
export function simJournalText(entry, project = null) {
  if (!entry || typeof entry !== "object") return "";
  const code = typeof entry.code === "string" ? entry.code : "";
  const known = code !== "" && typeof strings.sim.journal[code] === "string";
  const given = typeof entry.text === "string" && entry.text !== "" && !entry.text.startsWith("sim.journal.") ? entry.text : "";
  let out = "";
  if ((code === "change" || code === "press") && entry.char && entry.markId && project && findMark(project, entry.markId)) {
    out = text("sim.journal." + code, {
      label: labelOf(project, entry.markId),
      char: text("sim.chars." + entry.char),
      from: simJournalValue(entry.char, entry.from),
      to: simJournalValue(entry.char, entry.to),
    });
  } else if (known && (entry.vars || entry.code === "blockCond" || entry.code === "blockIf")) {
    out = text("sim.journal." + code, simJournalVars(entry));
  } else if (given) out = given;
  else if (known) out = text("sim.journal." + code, simJournalVars(entry));
  else return strings.sim.log.unknown;
  // Подстановка, которой запись не принесла, — вопрос, а не фигурные скобки.
  return out.replace(/\{\w+\}/g, "?");
}

// Одно звено цепочки причин словами.
function simJournalCause(project, cause) {
  if (!cause || typeof cause !== "object") return strings.sim.log.cause.unknown;
  const words = strings.sim.log.cause;
  switch (cause.k) {
    case "web":
    case "walk":
    case "door":
      return words[cause.k];
    case "char": {
      const mark = project && cause.markId ? findMark(project, cause.markId) : null;
      return text("sim.log.cause.char", {
        label: mark ? labelOf(project, cause.markId) : "?",
        char: text("sim.chars." + cause.char),
        value: simJournalValue(cause.char, cause.value),
      });
    }
    case "scenario":
    case "logic": {
      const found = project && cause.scenarioId ? findScenario(project, cause.scenarioId) : null;
      return text("sim.log.cause." + cause.k, { name: cause.name || (found && found.name) || "?" });
    }
    case "timer":
      return text("sim.log.cause.timer", { what: strings.sim.log.timerWhat[cause.what] || String(cause.what || "") });
    case "hub":
      return text("sim.log.cause.hub", { what: strings.sim.log.hubWhat[cause.what] || String(cause.what || "") });
    case "command":
      return text("sim.log.cause.command", { text: cause.text || "" });
    default:
      return words.unknown;
  }
}

/** Цепочка причин строкой «причина ← исходная»; нет цепочки — пустая строка. */
export function simJournalChain(project, entry) {
  const chain = entry && Array.isArray(entry.chain) ? entry.chain : [];
  return chain.map((cause) => simJournalCause(project, cause)).join(" ← ");
}

// Метка записи: своя или первая метка в цепочке причин.
function simJournalMark(entry) {
  if (entry.markId) return entry.markId;
  const cause = (Array.isArray(entry.chain) ? entry.chain : []).find((item) => item && item.markId);
  return cause ? cause.markId : null;
}

function simJournalScenarios(entry) {
  const ids = new Set();
  if (entry.scenarioId) ids.add(entry.scenarioId);
  for (const cause of Array.isArray(entry.chain) ? entry.chain : []) {
    if (cause && cause.scenarioId) ids.add(cause.scenarioId);
  }
  return ids;
}

/**
 * Строки для списка: `[{id, at, time, kind, text, chain, markId, result}]`,
 * новые сверху, не больше `limit`. `filter` — `{scenarioId, markId}`: строка
 * проходит, если сценарий (или метка) назван в ней самой или в её цепочке.
 */
export function simJournalRows(entries, project, filter = {}, limit = SIM_JOURNAL_SHOWN) {
  const out = [];
  const list = Array.isArray(entries) ? entries : [];
  for (let index = list.length - 1; index >= 0 && out.length < limit; index -= 1) {
    const entry = list[index];
    if (!entry || typeof entry !== "object") continue;
    const markId = simJournalMark(entry);
    if (filter.scenarioId && !simJournalScenarios(entry).has(filter.scenarioId)) continue;
    if (filter.markId && markId !== filter.markId && !(entry.chain || []).some((cause) => cause && cause.markId === filter.markId)) continue;
    out.push({
      id: index,
      at: entry.at,
      time: simJournalTime(entry.at),
      kind: typeof entry.kind === "string" ? entry.kind : "system",
      text: simJournalText(entry, project),
      chain: simJournalChain(project, entry),
      markId,
      result: entry.result === true || entry.result === false ? entry.result : null,
    });
  }
  return out;
}

/**
 * Варианты фильтров по тому, что есть в ленте: сценарии объекта (в его
 * порядке) и устройства, которых коснулись записи.
 */
export function simJournalFilters(entries, project) {
  const list = Array.isArray(entries) ? entries : [];
  const scenarioIds = new Set();
  const markIds = new Set();
  for (const entry of list) {
    if (!entry) continue;
    for (const id of simJournalScenarios(entry)) scenarioIds.add(id);
    const mark = simJournalMark(entry);
    if (mark) markIds.add(mark);
    for (const cause of Array.isArray(entry.chain) ? entry.chain : []) if (cause && cause.markId) markIds.add(cause.markId);
  }
  const scenarios = project ? scenariosInOrder(project).filter((scenario) => scenarioIds.has(scenario.id)).map((scenario) => ({ id: scenario.id, name: scenario.name })) : [];
  const marks = project
    ? [...markIds].filter((id) => findMark(project, id)).map((id) => ({ id, label: labelOf(project, id) }))
    : [];
  marks.sort((a, b) => a.label.localeCompare(b.label, "ru", { numeric: true }));
  return { scenarios, marks };
}

/** Чем пусто: «ещё не запускали» (ни одной записи и дом остановлен), «событий нет», «по фильтру нет». */
export function simJournalEmpty(total, shown, running) {
  if (shown > 0) return null;
  if (total === 0) return running ? strings.sim.log.noEvents : strings.sim.log.neverStarted;
  return strings.sim.log.noMatch;
}

function mountSimJournal(host, api) {
  host.classList.add("sim-journal");
  let collapsed = true;
  const filter = { scenarioId: "", markId: "" };
  let frame = 0;

  const toggle = uiEl("button", { class: "sim-journal__toggle", type: "button", on: { click: () => flip(!collapsed) } });
  const count = uiEl("span", { class: "sim-journal__count" });
  const head = uiEl("div", { class: "sim-journal__head" }, [toggle, count]);
  const scenarioSelect = uiEl("select", {
    class: "ui-select sim-journal__filter",
    title: strings.sim.log.scenarioFilter,
    attrs: { "aria-label": strings.sim.log.scenarioFilter },
    on: {
      change: (event) => {
        filter.scenarioId = event.target.value;
        draw();
      },
    },
  });
  const markSelect = uiEl("select", {
    class: "ui-select sim-journal__filter",
    title: strings.sim.log.deviceFilter,
    attrs: { "aria-label": strings.sim.log.deviceFilter },
    on: {
      change: (event) => {
        filter.markId = event.target.value;
        draw();
      },
    },
  });
  const clear = uiButton(strings.sim.log.clear, {
    class: "ui-btn sim-journal__clear",
    title: strings.sim.log.clearHint,
    on: { click: () => simJournalClear() },
  });
  const tools = uiEl("div", { class: "sim-journal__tools" }, [scenarioSelect, markSelect, clear]);
  const list = uiEl("ol", { class: "sim-journal__list" });
  const empty = uiEl("p", { class: "sim-journal__empty" });
  const body = uiEl("div", { class: "sim-journal__body" }, [tools, list, empty]);
  host.replaceChildren(head, body);

  function flip(value) {
    collapsed = value;
    Promise.resolve(setSetting(SIM_JOURNAL_SETTING, collapsed)).catch(() => {});
    draw();
  }

  // Список вариантов фильтра с сохранением выбора; пропавший вариант сбрасывается.
  function fillSelect(select, all, options, current) {
    const keep = options.some((option) => option.id === current) ? current : "";
    select.replaceChildren(
      uiEl("option", { text: all, attrs: { value: "" } }),
      ...options.map((option) => uiEl("option", { text: option.label, attrs: { value: option.id } })),
    );
    select.value = keep;
    return keep;
  }

  function draw() {
    frame = 0;
    const state = api.getState();
    const visible = Boolean(state.schemeId) && state.screen === "scheme";
    host.hidden = !visible;
    if (!visible) return;
    const entries = simJournal();
    host.classList.toggle("is-collapsed", collapsed);
    toggle.replaceChildren(uiIcon("chevron"), uiEl("span", { text: strings.sim.log.title }));
    toggle.title = collapsed ? strings.sim.log.expand : strings.sim.log.collapse;
    toggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
    count.textContent = entries.length > 0 ? text("sim.log.count", { count: entries.length }) : "";
    body.hidden = collapsed;
    if (collapsed) return;
    const variants = simJournalFilters(entries, state.project);
    filter.scenarioId = fillSelect(
      scenarioSelect,
      strings.sim.log.allScenarios,
      variants.scenarios.map((item) => ({ id: item.id, label: item.name })),
      filter.scenarioId,
    );
    filter.markId = fillSelect(
      markSelect,
      strings.sim.log.allDevices,
      variants.marks.map((item) => ({ id: item.id, label: item.label })),
      filter.markId,
    );
    const rows = simJournalRows(entries, state.project, filter);
    list.replaceChildren(
      ...rows.map((row) => {
        const clickable = Boolean(row.markId);
        const parts = [
          uiEl("span", { class: "sim-journal__time", text: row.time }),
          uiEl("span", { class: "sim-journal__text", text: row.text }),
        ];
        if (row.chain) parts.push(uiEl("span", { class: "sim-journal__chain", text: text("sim.log.chain", { chain: row.chain }) }));
        return uiEl(
          "li",
          {
            class:
              "sim-journal__row is-" +
              row.kind +
              (row.result === true ? " is-true" : row.result === false ? " is-false" : "") +
              (clickable ? " is-link" : ""),
            title: clickable ? strings.sim.log.rowHint : "",
            on: clickable ? { click: () => canvasHighlightMark(row.markId) } : undefined,
          },
          parts,
        );
      }),
    );
    const note = simJournalEmpty(entries.length, rows.length, state.simRunning === true);
    empty.hidden = note === null;
    empty.textContent = note || "";
  }

  // Перерисовка — одним кадром, сколько бы записей ни пришло за него.
  function later() {
    if (frame) return;
    const ask = typeof requestAnimationFrame === "function" ? requestAnimationFrame : (fn) => setTimeout(fn, 16);
    frame = ask(draw);
  }

  api.subscribe((state, changed) => {
    if ("schemeId" in changed || "screen" in changed || "simRunning" in changed || "project" in changed) draw();
  });
  simWatch((payload) => {
    if (payload.log.length > 0 || !collapsed) later();
  });
  draw();
  Promise.resolve(getSetting(SIM_JOURNAL_SETTING))
    .then((saved) => {
      if (saved === false) {
        collapsed = false;
        draw();
      }
    })
    .catch(() => {});
}

registerPanel(PANEL_IDS.simJournal, mountSimJournal);
