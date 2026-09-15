// Каркас сеанса: состояние, реестр панелей, уведомления.
// Панели других тасков монтируются по идентификатору контейнера из index.html
// и не правят ни этот файл, ни разметку.
import { strings, text } from "./strings.js";

// Контейнеры-точки монтирования (идентификаторы из src/index.html).
export const PANEL_IDS = {
  tools: "panel-tools",
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

export function startApp() {
  if (appStarted) return;
  appStarted = true;
  applyStrings(document);
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
