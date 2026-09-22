// Каркас сеанса: состояние, реестр панелей, уведомления.
// Панели других тасков монтируются по идентификатору контейнера из index.html
// и не правят ни этот файл, ни разметку.
import { strings, text } from "./strings.js";
import { getSetting, setSetting } from "./store.js";
import { findScheme } from "./model.js";
import { registerServiceWorker } from "./pwa.js";
// Значок кнопки раскладки рисует общий набор — своего рисунка у каркаса нет.
import { uiIcon } from "./panels/ui.js";

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
  headerSearch: "header-search",
  headerHistory: "header-history",
  headerWarnings: "header-warnings",
  headerLinks: "header-links",
  projectActions: "project-actions",
  dialogs: "dialog-host",
};

const appState = {
  layout: "desktop",
  project: null,
  schemeId: null,
  selectedMarkIds: [],
  // Путь в правке: у него видны ручки вершин. Режим руки, а не свойство
  // разметки, — в объект и в файл проекта он не попадает.
  editPathId: null,
  // Линейка и направляющие видны, пока их не спрятали.
  guidesShown: true,
  // Связи меток на плане: умолчание — «нет». Это разбор, а не чертёж, и
  // встречать пользователя дугами поверх плана никто не просил.
  linksShown: false,
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
// Линейка и направляющие: отметка рабочего места, а не свойство объекта.
// Живёт в настройках браузера и переживает перезагрузку.
export const GUIDES_SETTING = "schemeGuidesShown";
// Последний открытый объект: с него начинается следующий сеанс. Ключ лежит
// здесь, рядом с остальными, а не в панели объектов: его пишет и панель
// объектов, и панель файла (объект, пришедший из архива, тоже становится
// последним), а панели друг друга не знают.
export const LAST_PROJECT_KEY = "lastProjectId";
// Связи меток: та же природа, что у линейки, — оснастка разбора, а не свойство
// разметки. Живёт в настройках браузера, переживает перезагрузку, в объект и в
// файл проекта не попадает.
export const LINKS_SETTING = "markLinksShown";
// На первом запуске свёрнуты «Размеры»: их трогают один раз и надолго, а
// место они отнимают у списка схем. Всё остальное открыто — иначе новый
// пользователь ищет, куда делись инструменты.
export const SECTION_DEFAULT_COLLAPSED = [SECTION_IDS.sizes];

// ——— раскладка: широкий экран правит, узкий смотрит ————————————————————
//
// На объекте в руке телефон: нужно открыть план, найти метку, свериться с
// таблицей. Размечать пальцем пользователь не собирался с самого брифинга,
// поэтому узкий экран получает не урезанный редактор, а режим просмотра.
// Решение о режиме — чистое, его и проверяют тесты: разъехаться оно может
// незаметно, а цена — панель, которой на экране нет.
export const LAYOUT_MODES = ["desktop", "mobile"];
// Окно уже этого — раскладка просмотра. На десктопе это же и есть способ
// посмотреть мобильный вид: сузить окно.
export const LAYOUT_NARROW_WIDTH = 860;
// Короткая сторона телефона: поворот её не меняет, поэтому альбомная
// ориентация остаётся просмотром, а не превращается в редактор на 844 px.
export const LAYOUT_PHONE_SIDE = 560;

// Что доступно в каждой раскладке. Список нарочно перечислен целиком: новое
// умение нужно назвать здесь, иначе оно считается правкой и на телефон не идёт.
export const LAYOUT_ABILITIES = {
  viewPlan: ["desktop", "mobile"],
  switchProject: ["desktop", "mobile"],
  switchScheme: ["desktop", "mobile"],
  markList: ["desktop", "mobile"],
  filters: ["desktop", "mobile"],
  tables: ["desktop", "mobile"],
  exportFiles: ["desktop", "mobile"],
  openFile: ["desktop", "mobile"],
  search: ["desktop", "mobile"],
  // Предупреждения — про правку объекта: в них отвечают на вопрос о виде типа
  // и идут чинить найденное. В просмотре чинить нечем, а место в шапке дорого.
  warnings: ["desktop"],
  // Связи — чтение, а не правка: «что включает этот выключатель» спрашивают и
  // с телефона, стоя перед щитом. Ничего не меняют, поэтому идут в оба вида.
  markLinks: ["desktop", "mobile"],
  undo: ["desktop"],
  saveFile: ["desktop"],
  editMarks: ["desktop"],
  editSchemes: ["desktop"],
  editRooms: ["desktop"],
  editProject: ["desktop"],
  dictionary: ["desktop"],
  viewSizes: ["desktop"],
};

export function layoutModeFor(view, override) {
  if (override === "mobile" || override === "desktop") return override;
  const source = view || {};
  const width = Number(source.width) || 0;
  const height = Number(source.height) || 0;
  const shortSide = height > 0 ? Math.min(width, height) : width;
  if (source.coarsePointer && shortSide > 0 && shortSide <= LAYOUT_PHONE_SIDE) return "mobile";
  if (width > 0 && width <= LAYOUT_NARROW_WIDTH) return "mobile";
  return "desktop";
}

// Неизвестное умение доступным не считается: опечатка в имени спрячет кнопку,
// а не пустит правку в режим просмотра.
export function layoutAllows(ability, mode) {
  const modes = LAYOUT_ABILITIES[ability];
  return Array.isArray(modes) && modes.includes(mode);
}

const appCollapsed = new Set();
let appLayoutOverride = null;
let appSheet = "none";

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
  syncSchemeName();
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

// На узком экране имя схемы стоит в шапке: с первого взгляда видно, что
// открыто, — списка схем на экране нет, он спрятан в лист.
function syncSchemeName() {
  const node = document.getElementById("scheme-name");
  if (!node) return;
  const scheme = appState.project && appState.schemeId ? findScheme(appState.project, appState.schemeId) : null;
  node.textContent = scheme ? scheme.name : strings.mobile.noScheme;
}

function syncCanvasClass() {
  const app = document.getElementById("app");
  if (!app) return;
  app.classList.toggle("has-scheme", Boolean(appState.schemeId));
}

function layoutViewport() {
  if (typeof window === "undefined") return { width: 0, height: 0, coarsePointer: false };
  return {
    width: window.innerWidth,
    height: window.innerHeight,
    coarsePointer:
      typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches,
  };
}

// Раскладка, которую выбрал бы сам экран: по ней видно, показывать ли переход
// к полной версии. На настоящем десктопе кнопки нет вовсе — второго режима
// работы там не заводим.
export function layoutAutoMode() {
  return layoutModeFor(layoutViewport(), null);
}

export function layoutMode() {
  return appState.layout;
}

export function layoutOverride() {
  return appLayoutOverride;
}

export function setLayoutOverride(mode) {
  appLayoutOverride = mode === "mobile" || mode === "desktop" ? mode : null;
  syncLayout();
}

// Лист снизу: на узком экране колонки показываются по одной и поверх плана.
export function openSheet(name) {
  appSheet = name === "schemes" || name === "marks" ? name : "none";
  syncSheet();
}

export function currentSheet() {
  return appSheet;
}

function syncSheet() {
  const app = document.getElementById("app");
  if (!app) return;
  app.dataset.sheet = appState.layout === "mobile" ? appSheet : "none";
  for (const button of document.querySelectorAll("[data-sheet-button]")) {
    const target = button.dataset.sheetButton;
    const active = app.dataset.sheet === target || (target === "none" && app.dataset.sheet === "none");
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", active ? "true" : "false");
  }
}

function syncLayout() {
  const mode = layoutModeFor(layoutViewport(), appLayoutOverride);
  const app = document.getElementById("app");
  if (app) app.classList.toggle("is-mobile", mode === "mobile");
  if (mode !== "mobile") appSheet = "none";
  const toggle = document.getElementById("layout-toggle");
  if (toggle) {
    // Кнопка живёт только там, где экран сам выбрал просмотр: на телефоне —
    // дорога к полной версии, на десктопе её нет и быть не должно.
    toggle.hidden = layoutAutoMode() !== "mobile";
    // Значком, а не словом: «Полная версия» занимала в шапке 127 точек — на
    // восьмидюймовом планшете это разница между одной строкой и двумя. Карандаш
    // и глаз — пара «править / смотреть»; слово при этом не потеряно, оно в
    // подсказке и в `aria-label`, как у остальных кнопок-значков.
    const toEdit = mode === "mobile";
    const label = toEdit ? strings.mobile.full : strings.mobile.view;
    toggle.className = "ui-btn ui-btn--icon";
    toggle.replaceChildren(toEdit ? uiIcon("edit") : uiIcon("view"));
    toggle.title = toEdit ? strings.mobile.fullHint : strings.mobile.viewHint;
    toggle.setAttribute("aria-label", label);
  }
  if (appState.layout !== mode) {
    // Вход в просмотр снимает режим постановки: в суженном окне мышь никуда не
    // делась, и оставленный «Точка» ставил бы метки там, где их не ждут.
    setState(mode === "mobile" ? { layout: mode, mode: "select" } : { layout: mode });
  }
  syncSheet();
  syncSchemeName();
}

function wireLayout() {
  syncLayout();
  const toggle = document.getElementById("layout-toggle");
  if (toggle) {
    toggle.addEventListener("click", () =>
      setLayoutOverride(appState.layout === "mobile" ? "desktop" : null),
    );
  }
  for (const button of document.querySelectorAll("[data-sheet-button]")) {
    button.addEventListener("click", () => {
      const target = button.dataset.sheetButton;
      openSheet(appSheet === target ? "none" : target);
    });
  }
  if (typeof window === "undefined") return;
  let timer = null;
  const later = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(syncLayout, 120);
  };
  window.addEventListener("resize", later);
  window.addEventListener("orientationchange", later);
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
  // Та же история у линейки: страница стартует с ней, и она гаснет, когда
  // хранилище ответит «спрятана».
  Promise.resolve(getSetting(GUIDES_SETTING))
    .then((saved) => {
      if (saved === false) setState({ guidesShown: false });
    })
    .catch(() => {});
  // Связи, наоборот, стартуют спрятанными и зажигаются, когда хранилище
  // ответит «показаны».
  Promise.resolve(getSetting(LINKS_SETTING))
    .then((saved) => {
      if (saved === true) setState({ linksShown: true });
    })
    .catch(() => {});
}

export function startApp() {
  if (appStarted) return;
  appStarted = true;
  applyStrings(document);
  wireSections();
  syncCanvasClass();
  wireLayout();
  for (const id of appPanels.keys()) mountPanel(id);
  // Веб-версия заодно просит служебный скрипт: установленное приложение
  // обязано открываться и без сети. Со страницы на диске это ничего не делает.
  registerServiceWorker();
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
