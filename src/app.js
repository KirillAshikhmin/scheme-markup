// Каркас сеанса: состояние, реестр панелей, уведомления.
// Панели других тасков монтируются по идентификатору контейнера из index.html
// и не правят ни этот файл, ни разметку.
import { strings, text } from "./strings.js";
import { getSetting, setSetting } from "./store.js";

// Контейнеры-точки монтирования (идентификаторы из src/index.html).
export const PANEL_IDS = {
  tools: "panel-tools",
  rooms: "panel-rooms",
  sizes: "panel-sizes",
  schemes: "panel-schemes",
  marks: "panel-marks",
  properties: "panel-properties",
  canvas: "canvas-host",
  overlay: "canvas-overlay",
  headerActions: "header-actions",
  projectActions: "project-actions",
  dialogs: "dialog-host",
};

const appState = {
  project: null,
  schemeId: null,
  selectedMarkIds: [],
  activeTypeId: null,
  mode: "select",
  filter: { categoryIds: null, typeIds: null, roomId: null, query: "" },
  view: { zoom: 1, offsetX: 0, offsetY: 0 },
  dirty: false,
};

// Разделы колонок: заголовок сворачивает свой раздел, состояние переживает
// перезагрузку. Имена — из `data-section-id` в разметке.
export const SECTION_IDS = {
  marks: "marks",
  rooms: "rooms",
  schemes: "schemes",
  sizes: "sizes",
  markList: "markList",
  properties: "properties",
};
export const SECTIONS_SETTING = "collapsedSections";
// На первом запуске свёрнуты «Размеры»: их трогают один раз и надолго, а
// место они отнимают у списка схем. Всё остальное открыто — иначе новый
// пользователь ищет, куда делись инструменты.
export const SECTION_DEFAULT_COLLAPSED = [SECTION_IDS.sizes];

const appCollapsed = new Set();

// Что кладётся в настройки: список свёрнутых разделов. Мусор из хранилища
// (чужая версия, битое значение) не должен схлопывать панель — он отбрасывается.
export function sectionListFrom(value) {
  if (!Array.isArray(value)) return [];
  const known = new Set(Object.values(SECTION_IDS));
  return [...new Set(value.filter((id) => typeof id === "string" && known.has(id)))];
}

// Чего ещё не выбирал пользователь — то показываем по умолчанию; пустой
// сохранённый список означает «всё развёрнуто», а не «умолчание».
export function sectionStartList(saved) {
  return saved == null ? [...SECTION_DEFAULT_COLLAPSED] : sectionListFrom(saved);
}

export function sectionsAfterToggle(list, id, collapsed) {
  const next = new Set(sectionListFrom(list));
  if (!Object.values(SECTION_IDS).includes(id)) return [...next];
  if (collapsed) next.add(id);
  else next.delete(id);
  return [...next];
}

const appSubscribers = new Set();
const appPanels = new Map();
const appMounted = new Map();
let appStarted = false;

// Снимок: вложенные filter/view/selectedMarkIds копируются, чтобы правка
// на месте в панели не меняла состояние сеанса мимо setState.
export function getState() {
  return {
    ...appState,
    selectedMarkIds: [...appState.selectedMarkIds],
    filter: { ...appState.filter },
    view: { ...appState.view },
  };
}

export function setState(patch) {
  if (!patch) return getState();
  const changed = {};
  for (const [key, value] of Object.entries(patch)) {
    if (appState[key] !== value) {
      appState[key] = value;
      changed[key] = value;
    }
  }
  if (Object.keys(changed).length === 0) return getState();
  const snapshot = getState();
  for (const subscriber of [...appSubscribers]) {
    try {
      subscriber(snapshot, changed);
    } catch (error) {
      reportAppError(error);
    }
  }
  syncCanvasClass();
  syncProjectName();
  return snapshot;
}

export function subscribe(listener) {
  appSubscribers.add(listener);
  return () => appSubscribers.delete(listener);
}

// Регистрация панели: если каркас уже поднят — монтируем сразу.
export function registerPanel(id, mountFn) {
  if (typeof mountFn !== "function") return;
  appPanels.set(id, mountFn);
  if (appStarted) mountPanel(id);
}

export function panelApi() {
  return { getState, setState, subscribe, notify, strings, text };
}

function mountPanel(id) {
  const mountFn = appPanels.get(id);
  const host = document.getElementById(id);
  if (!mountFn || !host || appMounted.get(id) === mountFn) return;
  try {
    mountFn(host, panelApi());
    appMounted.set(id, mountFn);
  } catch (error) {
    reportAppError(error);
  }
}

export function notify(message, kind = "info") {
  const host = typeof document === "undefined" ? null : document.getElementById("notifications");
  if (!host) return null;
  const toast = document.createElement("div");
  toast.className = "toast toast--" + kind;
  toast.textContent = String(message);
  toast.title = strings.notify.close;
  toast.addEventListener("click", () => toast.remove());
  host.append(toast);
  setTimeout(() => toast.remove(), kind === "error" ? 12000 : 6000);
  return toast;
}

function reportAppError(error) {
  notify(error && error.message ? error.message : String(error), "error");
}

// Все видимые строки приходят из словаря: разметка держит только ключи.
export function applyStrings(root) {
  const scope = root || document;
  for (const node of scope.querySelectorAll("[data-text]")) {
    node.textContent = text(node.dataset.text);
  }
  for (const node of scope.querySelectorAll("[data-title]")) {
    node.title = text(node.dataset.title);
  }
}

function syncProjectName() {
  const node = document.getElementById("project-name");
  if (!node) return;
  node.textContent = appState.project ? appState.project.name : strings.header.noProject;
}

function syncCanvasClass() {
  const app = document.getElementById("app");
  if (!app) return;
  app.classList.toggle("has-scheme", Boolean(appState.schemeId));
}

function sectionNode(id) {
  return typeof document === "undefined" ? null : document.querySelector('[data-section-id="' + id + '"]');
}

// Свёрнутый раздел — это только заголовок с повёрнутой галочкой: пустым он не
// выглядит, и место соседям отдаёт целиком.
function applySectionState(id) {
  const node = sectionNode(id);
  if (!node) return;
  const collapsed = appCollapsed.has(id);
  node.classList.toggle("is-collapsed", collapsed);
  const button = node.querySelector("[data-section]");
  if (button) button.setAttribute("aria-expanded", collapsed ? "false" : "true");
}

export function setSectionCollapsed(id, collapsed) {
  if (collapsed) appCollapsed.add(id);
  else appCollapsed.delete(id);
  applySectionState(id);
  setSetting(SECTIONS_SETTING, [...appCollapsed]);
}

export function toggleSection(id) {
  setSectionCollapsed(id, !appCollapsed.has(id));
}

// Кто-то зовёт раздел со стороны (кнопка «Помещения» в справочнике): развернуть
// и подвести к глазам — вместо второго окна, делающего то же самое.
export function revealSection(id) {
  setSectionCollapsed(id, false);
  const node = sectionNode(id);
  if (!node) return;
  if (typeof node.scrollIntoView === "function") node.scrollIntoView({ block: "nearest" });
  node.classList.add("is-called");
  setTimeout(() => node.classList.remove("is-called"), 1200);
}

// Счётчик в заголовке: по свёрнутому разделу видно, пуст он или там сорок схем.
export function setSectionBadge(id, value) {
  const node = sectionNode(id);
  if (!node) return;
  const badge = node.querySelector(".panel__badge");
  if (badge) badge.textContent = value == null || value === "" ? "" : String(value);
}

function wireSections() {
  for (const button of document.querySelectorAll("[data-section]")) {
    button.addEventListener("click", () => toggleSection(button.dataset.section));
  }
  // Настройки читаются асинхронно: разделы стартуют развёрнутыми и схлопываются,
  // когда хранилище ответит. Ждать его с пустым экраном хуже.
  Promise.resolve(getSetting(SECTIONS_SETTING))
    .then((saved) => {
      for (const id of sectionStartList(saved)) {
        appCollapsed.add(id);
        applySectionState(id);
      }
    })
    .catch(() => {});
}

export function startApp() {
  if (appStarted) return;
  appStarted = true;
  applyStrings(document);
  wireSections();
  syncProjectName();
  syncCanvasClass();
  for (const id of appPanels.keys()) mountPanel(id);
}

// Старт откладывается за границу текущего скрипта: в собранном файле панели
// и модели определяются ниже по бандлу, и каркас не должен опережать их.
if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", startApp, { once: true });
  } else {
    setTimeout(startApp, 0);
  }
}
