// Слот объекта на странице просмотра (таск 02 просмотра; R01.1, R03, R03.1,
// R03.2, G04, G04.1, G07, G08, G21, G22, R13i.1, R12i.1).
//
// Страница просмотра держит **один** объект. Эта панель — вся его жизнь:
// пустая страница первого захода, открытие файла («Открыть файл» и «Открыть
// другой файл»), замена прежнего объекта по правилу G22, память в браузере
// («во второй раз страница открывает объект сама»), «Забыть этот объект»,
// строка о предпросмотре и имя с датой выгрузки в шапке.
//
// Своего узла в шапке у панели нет — как у панели файла, она заводит контейнер
// сама. Монтируется в `#view-start`; на странице «Разметки» такого узла нет,
// и панель там молчит (`mountPanel` проходит мимо отсутствующего узла).
//
// Панель объектов («Разметки») на странице просмотра не монтируется, поэтому
// и подъём последнего объекта из базы, и его запись делает эта панель — тем
// же путём, что `projects.js` (`projectsMigrateStored`, `ensureProjectKey`).
//
// Объект в базе лежит в **своём пространстве** (`storeNamespace("view")`):
// страница просмотра и «Разметка» на одном origin друг друга не видят.
import { LAST_PROJECT_KEY, HIDDEN_OBJECTS_SETTING, VIEW_SETTING, registerPanel, setScreen } from "../app.js";
import { adoptLoadedProject } from "../autosave.js";
import { brotliDecompress, brotliReachable } from "../brotliCodec.js";
import { ensureProjectKey, findScheme, schemesInOrder, wallsOnScheme } from "../model.js";
import { unpackProject } from "../projectFile.js";
import { SIM_STATE_SETTING, simStop } from "../simulation.js";
import {
  deleteImage,
  deleteProject,
  getSetting,
  listProjects,
  loadProject,
  onStoreProblem,
  openStore,
  putImage,
  saveProject,
  setSetting,
  storeMode,
} from "../store.js";
import { strings, text } from "../strings.js";
import { VIEW_LINK_BROKEN, viewLinkRead } from "../viewLink.js";
import { projectsMigrateStored } from "./projects.js";
import { uiButton, uiConfirm, uiEl, uiIconLabelButton, uiModal } from "./ui.js";
import { viewScenariosOpen } from "./viewScenarios.js";

/** Узел панели в `src/view.html`. */
export const VIEW_START_ID = "view-start";
/** Параметр адреса с нагрузкой ссылки: `#o=<…>`. Тот же, что `VIEW_LINK_PARAM` в `viewLink.js`. */
export const VIEW_START_PARAM = "o";
/** Настройка браузера: строку о предпросмотре уже закрывали. */
export const VIEW_PREVIEW_SETTING = "viewPreviewSeen";
/** Настройка браузера: `{id, madeAt}` — какой объект лежит в слоте и когда его выгрузили. */
export const VIEW_SLOT_SETTING = "viewSlot";

// ——— чистая половина ——————————————————————————————————————————————————

/**
 * Нагрузка ссылки из адреса: `#o=<текст>` → `<текст>`; нет параметра или он
 * пуст — `null`. Разбор самой нагрузки — не здесь (`viewLink.js`, таск 04).
 */
export function viewStartLinkOf(hash) {
  const source = String(hash || "").replace(/^#/, "");
  for (const part of source.split("&")) {
    const at = part.indexOf("=");
    if (at < 0 || part.slice(0, at) !== VIEW_START_PARAM) continue;
    const payload = part.slice(at + 1);
    return payload === "" ? null : payload;
  }
  return null;
}

/** Ключ нагрузки (длина и FNV-1a): по нему видно, что слот уже взят из этой ссылки. */
export function viewStartLinkKey(payload) {
  const source = String(payload || "");
  let hash = 0x811c9dc5;
  for (let i = 0; i < source.length; i += 1) {
    hash ^= source.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return source.length + ":" + hash.toString(16);
}

/**
 * Разобрать адрес страницы (G12): `{status}` — `"none"` (ссылки нет), `"empty"`
 * (`#o=` без нагрузки), `"broken"` (порча, обрезка, нет кодека), `"same"` (слот
 * уже взят из этой ссылки: копии не плодим, G12.2) или `"ok"` с `loaded`
 * (`{project}`), `madeAt`, `key`, `warnings`. Не бросает. `options`:
 * `{decompress, savedKey, read}`.
 */
export async function viewStartLinkLoad(hash, options = {}) {
  const payload = viewStartLinkOf(hash);
  if (payload === null) {
    return /(^|[#&])o=(&|$)/.test(String(hash || "")) ? { status: "empty" } : { status: "none" };
  }
  const key = viewStartLinkKey(payload);
  if (options.savedKey && options.savedKey === key) return { status: "same", key };
  const read = options.read || viewLinkRead;
  try {
    const result = await read(payload, { decompress: options.decompress });
    return {
      status: "ok",
      loaded: { project: result.project },
      madeAt: result.madeAt || null,
      key,
      warnings: result.warnings || [],
    };
  } catch (error) {
    return { status: "broken", reason: (error && error.reason) || (error && error.code === VIEW_LINK_BROKEN ? "payload" : "unknown") };
  }
}

/**
 * Что делать с новым объектом (G22): `"fresh"` — слот пуст; `"silent"` — имя то
 * же, заменяем молча; `"ask"` — имя другое, спросить один раз. Имена
 * сравниваются без пробелов по краям.
 */
export function viewStartReplace(saved, next) {
  if (!saved) return "fresh";
  const name = (project) => String((project && project.name) || "").trim();
  return name(saved) === name(next) ? "silent" : "ask";
}

function viewStartValid(value) {
  if (typeof value !== "string" && typeof value !== "number") return false;
  return Number.isFinite(new Date(value).getTime());
}

/**
 * Дата выгрузки (G21): из нагрузки ссылки, иначе из `writer.json` файла, иначе
 * из `project.updatedAt`; ничего годного — `null`. `source`:
 * `{madeAt, writtenAt, project}`.
 */
export function viewStartMadeAt(source) {
  const from = source || {};
  const project = from.project || {};
  for (const value of [from.madeAt, from.writtenAt, project.updatedAt]) {
    if (viewStartValid(value)) return value;
  }
  return null;
}

/** «05.11.2026» по часовому поясу устройства; не дата — пустая строка. */
export function viewStartDateText(value) {
  if (!viewStartValid(value)) return "";
  const at = new Date(value);
  const pad = (number) => String(number).padStart(2, "0");
  return pad(at.getDate()) + "." + pad(at.getMonth() + 1) + "." + String(at.getFullYear()).padStart(4, "0");
}

/** Карта настроек без одного ключа — копией; нет карты — пустая. */
export function viewStartForget(map, key) {
  const out = {};
  if (!map || typeof map !== "object") return out;
  for (const [own, value] of Object.entries(map)) if (own !== key) out[own] = value;
  return out;
}

/**
 * Схема без подложки и без чертежа (R04.1): остаются метки, и страница говорит
 * об этом строкой. Нет такой схемы — не «голая», а никакая.
 */
export function viewStartBare(project, schemeId) {
  if (!project || !schemeId) return false;
  const scheme = findScheme(project, schemeId);
  if (!scheme) return false;
  return !scheme.imageId && wallsOnScheme(project, schemeId).length === 0;
}

// ——— сеанс панели ————————————————————————————————————————————————————

let viewOpenLoaded = null;
let viewReadyResolve = null;
const viewReady = new Promise((resolve) => {
  viewReadyResolve = resolve;
});

/**
 * Слот поднят из браузера (последний объект открыт или его нет). Адрес со
 * ссылкой разбирают **после** этого: иначе объект из ссылки перебился бы
 * сохранённым, поднявшимся позже.
 */
export function viewStartReady() {
  return viewReady;
}

/**
 * Принять объект из файла или ссылки: `loaded` — `{project, images?, madeAt?,
 * writtenAt?}`, `images` — `Map<imageId, Blob>`. Заменяет объект слота по
 * правилу G22 (другое имя — один вопрос); `true` — принят, `false` — отказались
 * или панель не смонтирована. Дверь для разбора ссылки (таск 04).
 */
export async function viewStartOpenLoaded(loaded, options = {}) {
  if (!viewOpenLoaded) return false;
  return viewOpenLoaded(loaded, options);
}

function mountViewStart(host, api) {
  const { getState, setState, notify, subscribe } = api;

  let ready = false;
  let previewSeen = true;
  let previewClosed = false;
  let noStore = false;
  let madeAt = null;
  let menuOpen = false;

  // ——— шапка: имя, дата, сценарии, меню ———————————————————————————————

  const nameNode = uiEl("span", { class: "view-head__name" });
  const dateNode = uiEl("span", { class: "view-head__date" });
  const scenariosButton = uiIconLabelButton("sliders", strings.view.scenarios, {
    title: strings.view.scenariosHint,
    class: "ui-btn view-head__scenarios",
    on: { click: () => viewScenariosOpen(api) },
  });
  const picker = uiEl("input", {
    class: "view-head__picker",
    type: "file",
    attrs: { accept: ".zip,application/zip", hidden: "hidden" },
    on: {
      change: async () => {
        const chosen = picker.files && picker.files[0];
        picker.value = "";
        if (chosen) await openFromFile(chosen);
      },
    },
  });
  const openOther = uiIconLabelButton("fileOpen", strings.view.openOther, {
    class: "ui-btn view-menu__item",
    on: {
      click: () => {
        closeMenu();
        picker.click();
      },
    },
  });
  const forgetButton = uiIconLabelButton("trash", strings.view.forget, {
    title: strings.view.forgetHint,
    class: "ui-btn view-menu__item",
    on: {
      click: () => {
        closeMenu();
        forgetObject();
      },
    },
  });
  const menuList = uiEl("div", { class: "view-menu__list", attrs: { role: "menu" } }, [openOther, forgetButton]);
  menuList.hidden = true;
  const menuButton = uiIconLabelButton("folder", strings.view.menu, {
    title: strings.view.menuHint,
    class: "ui-btn view-menu__button",
    on: { click: () => (menuOpen ? closeMenu() : openMenu()) },
  });
  menuButton.setAttribute("aria-haspopup", "true");
  menuButton.setAttribute("aria-expanded", "false");
  const menu = uiEl("div", { class: "view-menu" }, [menuButton, menuList]);
  const head = uiEl("div", { class: "view-head mount" }, [nameNode, dateNode, scenariosButton, menu, picker]);
  const header = typeof document !== "undefined" ? document.getElementById("app-header") : null;
  if (header) header.append(head);

  function openMenu() {
    menuOpen = true;
    menuList.hidden = false;
    menuButton.setAttribute("aria-expanded", "true");
  }

  function closeMenu() {
    menuOpen = false;
    menuList.hidden = true;
    menuButton.setAttribute("aria-expanded", "false");
  }

  if (typeof document !== "undefined") {
    document.addEventListener("pointerdown", (event) => {
      if (menuOpen && !menu.contains(event.target)) closeMenu();
    });
    document.addEventListener("keydown", (event) => {
      if (menuOpen && event.key === "Escape") closeMenu();
    });
  }

  // ——— отрисовка слота ————————————————————————————————————————————————

  function renderHead(project) {
    head.hidden = !project;
    if (!project) {
      if (typeof document !== "undefined") document.title = strings.view.title;
      return;
    }
    nameNode.textContent = project.name || strings.project.untitled;
    const date = viewStartDateText(madeAt);
    dateNode.textContent = date ? text("view.madeAt", { date }) : "";
    dateNode.title = date ? strings.view.madeAtHint : "";
    dateNode.hidden = !date;
    if (typeof document !== "undefined") document.title = text("view.titleNamed", { name: nameNode.textContent });
  }

  function render() {
    const state = getState();
    const project = state.project;
    renderHead(project);
    const notes = [];
    if (project && noStore) notes.push(uiEl("p", { class: "view-note view-note--store", text: strings.view.noStore }));
    if (project && !previewSeen && !previewClosed) {
      const close = uiButton(strings.view.previewClose, {
        class: "ui-btn view-note__close",
        on: {
          click: () => {
            previewClosed = true;
            previewSeen = true;
            Promise.resolve(setSetting(VIEW_PREVIEW_SETTING, true)).catch(() => {});
            render();
          },
        },
      });
      notes.push(uiEl("p", { class: "view-note view-note--preview" }, [uiEl("span", { text: strings.view.preview }), close]));
    }
    if (project && viewStartBare(project, state.schemeId)) {
      notes.push(uiEl("p", { class: "view-note view-note--bare", text: strings.view.schemeBare }));
    }
    const children = [];
    const notesBox = notes.length > 0 ? uiEl("div", { class: "view-notes" }, notes) : null;
    if (notesBox) children.push(notesBox);
    if (!project && ready) {
      const open = uiButton(strings.view.open, {
        class: "ui-btn ui-btn--accent view-empty__open",
        title: strings.view.openHint,
        on: { click: () => picker.click() },
      });
      children.push(
        uiEl("div", { class: "view-empty" }, [
          uiEl("h1", { class: "view-empty__title", text: strings.view.title }),
          uiEl("p", { class: "view-empty__text", text: strings.view.empty }),
          open,
          ...(noStore ? [uiEl("p", { class: "view-note view-note--store", text: strings.view.noStore })] : []),
        ]),
      );
    }
    host.replaceChildren(...children);
    noteHeight(notesBox);
  }

  /**
   * Высота строк просмотра — мерой `--view-notes-h` на корне страницы (ревью
   * ветки, F1).
   *
   * Строки лежат **поверх поля**, и в «Объёме» его верхний ряд занят плашками
   * и угловыми кнопками. Чтобы они не накрывали друг друга, плашки уходят под
   * строки — а на сколько, знает только живая высота: своё число в стилях
   * разъехалось бы с ними на второй строке или на переносе. Правила — в
   * `panels/view.css`; здесь только мера.
   */
  function noteHeight(box) {
    const root = typeof document !== "undefined" ? document.getElementById("app") : null;
    if (!root || !root.style) return;
    const height = box && box.getBoundingClientRect ? Math.ceil(box.getBoundingClientRect().height) : 0;
    root.style.setProperty("--view-notes-h", (height > 0 ? height + 4 : 0) + "px");
  }

  // ——— открытие файла ———————————————————————————————————————————————

  function busy(line) {
    const body = uiEl("p", { class: "modal__text", text: line });
    return { modal: uiModal({ title: strings.file.readingTitle, body, actions: [], dismissable: false }), body };
  }

  // Кадр на то, чтобы окно «Читаем файл…» успело нарисоваться: разбор большого
  // архива занимает вкладку, и без этого человек видел бы белый экран.
  const paint = () => new Promise((resolve) => setTimeout(resolve, 0));

  async function openFromFile(chosen) {
    const { modal, body } = busy(strings.file.reading);
    await paint();
    let loaded = null;
    try {
      loaded = await unpackProject(chosen, {
        onProgress: ({ done, total }) => {
          body.textContent = text("file.packingProgress", { done, total });
        },
      });
    } catch (error) {
      // Отказ ничего не трогает: объект на экране и в базе как был.
      modal.close();
      const reason = String((error && error.message) || strings.errors.notAProject).replace(/[.\s]+$/, "");
      notify(text("view.fileRefused", { reason }), "error");
      return false;
    }
    modal.close();
    return openLoaded(loaded);
  }

  /** Все настройки браузера, привязанные к объекту, — карта `{ключ объекта: …}`. */
  async function forgetSettings(project) {
    if (!project) return;
    const byId = [VIEW_SETTING, HIDDEN_OBJECTS_SETTING];
    for (const setting of byId) {
      const map = await getSetting(setting);
      if (map && typeof map === "object" && project.id in map) await setSetting(setting, viewStartForget(map, project.id));
    }
    if (project.key) {
      const sims = await getSetting(SIM_STATE_SETTING);
      if (sims && typeof sims === "object" && project.key in sims) await setSetting(SIM_STATE_SETTING, viewStartForget(sims, project.key));
    }
  }

  async function dropImages(project, keep = new Set()) {
    for (const scheme of (project && project.schemes) || []) {
      if (scheme.imageId && !keep.has(scheme.imageId)) await deleteImage(scheme.imageId);
    }
  }

  async function openLoaded(loaded, options = {}) {
    const state = getState();
    const saved = state.project;
    const verdict = viewStartReplace(saved, loaded.project);
    if (verdict === "ask") {
      const agreed = await uiConfirm({
        title: strings.view.replaceTitle,
        message: text("view.replaceMessage", { name: saved.name, next: loaded.project.name }),
        confirmLabel: strings.view.open,
        confirmClass: "ui-btn ui-btn--accent",
      });
      if (!agreed) return false;
    }
    const { modal } = busy(strings.file.reading);
    try {
      await paint();
      const memory = await getSetting(VIEW_SETTING);
      const images = loaded.images instanceof Map ? loaded.images : new Map();
      const imageIds = new Map();
      for (const [oldId, blob] of images) imageIds.set(oldId, await putImage(blob));
      // Молчаливая замена остаётся тем же объектом базы (то же имя — то же
      // место, режим и настройки показа), другой объект получает новый id.
      const adopted = adoptLoadedProject(
        { project: loaded.project, images },
        { mode: verdict === "silent" ? "replace" : "new", currentId: saved ? saved.id : null, imageIds },
      );
      const project = adopted.project;
      await saveProject(project);
      const kept = new Set(project.schemes.map((scheme) => scheme.imageId).filter(Boolean));
      const schemes = schemesInOrder(project);
      const stay = verdict === "silent" && state.schemeId && schemes.some((scheme) => scheme.id === state.schemeId);
      madeAt = viewStartMadeAt({ madeAt: options.madeAt, writtenAt: loaded.writtenAt, project: loaded.project });
      // Режим, которым закрывали, помнит `app.js` по id объекта. Объекту без
      // памяти — «Объём» (G07); память его самого поднимается сама.
      const remembered = verdict === "silent" || Boolean(memory && typeof memory === "object" && memory[project.id]);
      setState({
        project,
        schemeId: stay ? state.schemeId : schemes.length > 0 ? schemes[0].id : null,
        selectedMarkIds: [],
        activeTypeId: null,
      });
      if (!remembered) setScreen("volume");
      await setSetting(LAST_PROJECT_KEY, project.id);
      await setSetting(VIEW_SLOT_SETTING, { id: project.id, madeAt, link: options.linkKey || null });
      if (saved) {
        await dropImages(saved, kept);
        if (saved.id !== project.id) {
          await deleteProject(saved.id);
          await forgetSettings(saved);
        }
      }
      noteStore();
      render();
      return true;
    } catch (error) {
      notify(text("view.fileRefused", { reason: String((error && error.message) || strings.errors.notAProject).replace(/[.\s]+$/, "") }), "error");
      return false;
    } finally {
      modal.close();
    }
  }

  viewOpenLoaded = openLoaded;

  // ——— «Забыть этот объект» ————————————————————————————————————————————

  async function forgetObject() {
    const project = getState().project;
    if (!project) return;
    const agreed = await uiConfirm({
      title: strings.view.forgetTitle,
      message: text("view.forgetMessage", { name: project.name }),
      confirmLabel: strings.view.forget,
    });
    if (!agreed) return;
    // Дом гасится здесь, а не кнопкой полосы: объекта больше нет, и дому
    // незачем идти — а пока он идёт, он дописывал бы своё состояние в память
    // браузера уже после того, как её стёрли.
    simStop();
    madeAt = null;
    setState({ project: null, schemeId: null, selectedMarkIds: [], activeTypeId: null });
    await deleteProject(project.id);
    await dropImages(project);
    await forgetSettings(project);
    await setSetting(LAST_PROJECT_KEY, null);
    await setSetting(VIEW_SLOT_SETTING, null);
    // Дом дописывает состояние с задержкой: вторая чистка — после неё.
    setTimeout(() => forgetSettings(project).catch(() => {}), 1200);
    render();
    notify(strings.view.forgetDone, "success");
  }

  // ——— подъём слота из браузера ———————————————————————————————————————

  function noteStore() {
    if (storeMode() === "memory") noStore = true;
  }

  onStoreProblem(() => {
    noStore = true;
    render();
  });

  subscribe((state, changed) => {
    if ("project" in changed || "schemeId" in changed) render();
  });

  async function startup() {
    try {
      await openStore();
      noteStore();
      previewSeen = (await getSetting(VIEW_PREVIEW_SETTING)) === true;
      const list = await listProjects();
      const lastId = await getSetting(LAST_PROJECT_KEY);
      const target = list.find((item) => item.id === lastId) || list[0] || null;
      const stored = target ? await loadProject(target.id) : null;
      if (stored) {
        const project = ensureProjectKey(projectsMigrateStored(stored));
        if (project.changed) await saveProject(project.project);
        const slot = await getSetting(VIEW_SLOT_SETTING);
        const sameSlot = slot && typeof slot === "object" && slot.id === project.project.id;
        madeAt = viewStartMadeAt({ madeAt: sameSlot ? slot.madeAt : null, project: project.project });
        const memory = await getSetting(VIEW_SETTING);
        const remembered = Boolean(memory && typeof memory === "object" && memory[project.project.id]);
        const schemes = schemesInOrder(project.project);
        setState({
          project: project.project,
          schemeId: schemes.length > 0 ? schemes[0].id : null,
          selectedMarkIds: [],
          activeTypeId: null,
        });
        if (!remembered) setScreen("volume");
      }
    } catch (error) {
      notify(strings.storage.memory, "error");
    }
    ready = true;
    render();
    viewReadyResolve();
    // Адрес — только после подъёма слота: иначе объект из ссылки разошёлся бы
    // с сохранённым (G12).
    await openFromAddress();
  }

  // ——— открытие по ссылке (G12, G12.1, G12.2) ———————————————————————

  function cleanAddress() {
    if (typeof history === "undefined" || typeof location === "undefined") return;
    try {
      history.replaceState(null, "", location.pathname + location.search);
    } catch (error) {
      /* адрес не чистится — объект всё равно открыт */
    }
  }

  async function openFromAddress() {
    if (typeof location === "undefined") return;
    const hash = location.hash;
    if (viewStartLinkOf(hash) === null && !/(^|[#&])o=/.test(hash)) return;
    let slot = null;
    try {
      slot = await getSetting(VIEW_SLOT_SETTING);
    } catch (error) {
      /* нет базы — ключа нет, и объект откроется */
    }
    const { modal } = busy(strings.view.linkBusy);
    let result = null;
    try {
      await paint();
      result = await viewStartLinkLoad(hash, {
        decompress: brotliReachable() ? brotliDecompress : null,
        savedKey: slot && typeof slot === "object" ? slot.link : null,
      });
    } finally {
      modal.close();
      // Объект не должен остаться в истории браузера — чистим при любом исходе.
      cleanAddress();
    }
    if (result.status === "broken") notify(strings.view.linkBroken, "error");
    else if (result.status === "empty") notify(strings.view.linkEmpty, "error");
    else if (result.status === "ok") await openLoaded(result.loaded, { madeAt: result.madeAt, linkKey: result.key });
  }

  render();
  startup();
}

registerPanel(VIEW_START_ID, mountViewStart);
