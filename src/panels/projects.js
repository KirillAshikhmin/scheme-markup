// Объекты: список в шапке, переключение, переименование, удаление,
// первый запуск и автосохранение в браузер.
import { layoutAllows, PANEL_IDS, registerPanel } from "../app.js";
import { createProject, migrateTypeKinds, updateProject } from "../model.js";
import {
  deleteImage,
  deleteProject,
  estimateSpace,
  getSetting,
  listProjects,
  loadProject,
  onStoreProblem,
  openStore,
  saveProject,
  setSetting,
  storeMode,
} from "../store.js";
import { strings, text } from "../strings.js";
import { formatMegabytes, uiButton, uiConfirm, uiEl, uiIconButton, uiModal, uiPrompt } from "./ui.js";
import { TYPE_TEMPLATE_KEY, typesTemplateFrom } from "./types.js";

export const LAST_PROJECT_KEY = "lastProjectId";
const SAVE_DELAY_MS = 400;

function uniqueProjectName(list) {
  const base = strings.project.untitled;
  const taken = new Set(list.map((item) => item.name));
  if (!taken.has(base)) return base;
  let index = 2;
  while (taken.has(base + " " + index)) index += 1;
  return base + " " + index;
}

function mountProjectsPanel(host, api) {
  const { getState, setState, notify, subscribe } = api;
  let known = [];
  let saveTimer = null;
  let lowSpaceReported = false;

  const select = uiEl("select", {
    class: "ui-select",
    title: strings.projects.switch,
    on: {
      change: () => {
        const id = select.value;
        if (id && id !== currentId()) openProjectById(id);
      },
    },
  });
  // Значки, а не символы шрифта: рядом в шапке стоят отмена, возврат и поиск,
  // нарисованные линиями, и «＋» с корзиной-эмодзи выпадали из ряда — у них
  // своя толщина, свой размер и свой цвет. Слово у каждой кнопки осталось:
  // оно в подсказке и в `aria-label`.
  const renameButton = uiIconButton("edit", {
    label: strings.projects.rename,
    on: { click: () => renameCurrent() },
  });
  const createButton = uiIconButton("plus", {
    label: strings.projects.create,
    on: { click: () => createAndOpen() },
  });
  // Опасность удаления несла красная эмодзи; теперь её несёт сама кнопка —
  // красной рамкой и подложкой под курсором (`.ui-btn--danger` в panels.css).
  const removeButton = uiIconButton("trash", {
    class: "ui-btn ui-btn--danger",
    label: strings.projects.remove,
    on: { click: () => removeCurrent() },
  });
  host.replaceChildren(select, createButton, renameButton, removeButton);

  function currentId() {
    const state = getState();
    return state.project ? state.project.id : "";
  }

  function renderList() {
    const id = currentId();
    select.replaceChildren();
    if (known.length === 0) {
      select.append(uiEl("option", { value: "", text: strings.projects.empty }));
    }
    for (const item of known) {
      select.append(uiEl("option", { value: item.id, text: item.name }));
    }
    select.value = id;
    const has = Boolean(id);
    renameButton.disabled = !has;
    removeButton.disabled = !has;
    // Режим просмотра: объект выбирается, но не заводится, не переименовывается
    // и не удаляется — на объекте с телефоном это только риск.
    const editable = layoutAllows("editProject", getState().layout);
    createButton.hidden = !editable;
    renameButton.hidden = !editable;
    removeButton.hidden = !editable;
  }

  async function refreshList() {
    known = await listProjects();
    renderList();
  }

  async function openProjectById(id) {
    const stored = await loadProject(id);
    if (!stored) {
      await refreshList();
      return;
    }
    // Объект из базы браузера мимо `projectFile.migrateProject` не проходит,
    // а вид типа (точка или линия) у прежних объектов не записан. Дописывается
    // он тем же правилом, что и при чтении файла, — иначе один и тот же объект
    // открывался бы по-разному из базы и из архива.
    const project = migrateTypeKinds(stored).project;
    setState({
      project,
      schemeId: project.schemes.length > 0 ? project.schemes[0].id : null,
      selectedMarkIds: [],
      activeTypeId: null,
    });
    await setSetting(LAST_PROJECT_KEY, id);
    renderList();
  }

  // Новый объект начинается с сохранённого справочника, если он есть: копия
  // шаблона с новыми идентификаторами, дальше объект живёт своей жизнью.
  async function createAndOpen() {
    const saved = await getSetting(TYPE_TEMPLATE_KEY);
    const template = typesTemplateFrom(saved);
    const project = createProject({ name: uniqueProjectName(known), ...(template || {}) });
    await saveProject(project);
    await refreshList();
    setState({ project, schemeId: null, selectedMarkIds: [], activeTypeId: null });
    await setSetting(LAST_PROJECT_KEY, project.id);
    renderList();
    notify(text("projects.created", { name: project.name }), "success");
    return project;
  }

  async function renameCurrent() {
    const state = getState();
    if (!state.project) return;
    const name = await uiPrompt({
      title: strings.projects.renameTitle,
      value: state.project.name,
      placeholder: strings.projects.namePlaceholder,
    });
    if (!name || name === state.project.name) return;
    const next = updateProject(state.project, { name });
    setState({ project: next.project });
    await refreshList();
  }

  async function removeCurrent() {
    const state = getState();
    if (!state.project) return;
    const project = state.project;
    const agreed = await uiConfirm({
      title: strings.projects.removeTitle,
      message: text("projects.removeMessage", { name: project.name }),
      confirmLabel: strings.dialog.confirm,
    });
    if (!agreed) return;
    for (const scheme of project.schemes) {
      if (scheme.imageId) await deleteImage(scheme.imageId);
    }
    await deleteProject(project.id);
    setState({ project: null, schemeId: null, selectedMarkIds: [], activeTypeId: null });
    notify(text("projects.removed", { name: project.name }), "success");
    await refreshList();
    if (known.length > 0) await openProjectById(known[0].id);
    else showWelcome();
  }

  // Первый запуск: не пустая серая страница, а одна кнопка.
  function showWelcome() {
    const modal = uiModal({
      title: strings.projects.welcomeTitle,
      dismissable: false,
      body: uiEl("p", { class: "modal__text", text: strings.projects.welcomeText }),
      actions: [
        uiButton(strings.projects.createTitle, {
          class: "ui-btn ui-btn--accent",
          on: {
            click: async () => {
              modal.close();
              await createAndOpen();
            },
          },
        }),
      ],
    });
  }

  function scheduleSave(project) {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      saveTimer = null;
      const result = await saveProject(project);
      if (result.ok) {
        known = known.map((item) =>
          item.id === project.id
            ? { ...item, name: project.name, updatedAt: project.updatedAt, schemes: project.schemes.length, marks: project.marks.length }
            : item,
        );
        renderList();
        await checkSpace();
      }
    }, SAVE_DELAY_MS);
  }

  async function checkSpace() {
    if (lowSpaceReported) return;
    const space = await estimateSpace();
    if (!space.low) return;
    lowSpaceReported = true;
    notify(text("storage.lowSpace", { free: formatMegabytes(space.free) }), "error");
  }

  onStoreProblem((problem) => {
    notify(problem.kind === "unavailable" ? strings.storage.memory : strings.storage.writeFailed, "error");
  });

  subscribe((state, changed) => {
    if ("layout" in changed) renderList();
    if (!("project" in changed)) return;
    renderList();
    if (state.project) scheduleSave(state.project);
  });

  (async () => {
    await openStore();
    await refreshList();
    const lastId = await getSetting(LAST_PROJECT_KEY);
    const target = known.find((item) => item.id === lastId) || known[0] || null;
    if (target) await openProjectById(target.id);
    else showWelcome();
    await checkSpace();
    if (storeMode() === "memory") renderList();
  })();
}

registerPanel(PANEL_IDS.projectActions, mountProjectsPanel);
