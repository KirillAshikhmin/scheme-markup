// Объекты: список в шапке, переключение, переименование, удаление,
// первый запуск и автосохранение в браузер.
import { LAST_PROJECT_KEY, layoutAllows, PANEL_IDS, registerPanel } from "../app.js";
import {
  createProject,
  ensureProjectKey,
  fillTypeSizes,
  migrateCommentType,
  migrateScenarios,
  migrateTypeKinds,
} from "../model.js";
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
import { formatMegabytes, uiButton, uiConfirm, uiEl, uiIconButton, uiModal } from "./ui.js";
import { projectPropsDialog } from "./projectProps.js";
import { TYPE_TEMPLATE_KEY, typesTemplateFrom } from "./types.js";
import { openProjectFileDialog } from "./file.js";

const SAVE_DELAY_MS = 400;

/**
 * Объект из базы браузера, доведённый до этой сборки, — второй конвейер
 * открытия рядом с `projectFile.migrateProject` (тот — для файла). Миграции
 * те же и в том же порядке: иначе один объект открывался бы по-разному из
 * базы и из архива. Каждая миграция у объекта, которому нечего менять,
 * отдаёт тот же объект, — и прежний объект из базы открывается байт в байт
 * таким, каким лёг туда (G68).
 */
export function projectsMigrateStored(stored) {
  const migrated = fillTypeSizes(migrateCommentType(migrateTypeKinds(stored).project).project).project;
  // Сценарии и привязки логики (таск 01 сценариев): терпимое чтение.
  return migrateScenarios(migrated).project;
}

function uniqueProjectName(list) {
  const base = strings.project.untitled;
  const taken = new Set(list.map((item) => item.name));
  if (!taken.has(base)) return base;
  let index = 2;
  while (taken.has(base + " " + index)) index += 1;
  return base + " " + index;
}

/**
 * Что стоит в списке шапки — чистое правило, вынесенное ради теста (дефект
 * D75). DOM и база сюда не ходят.
 *
 * `known === null` — список ещё не прочитан, `[]` — объектов правда нет.
 * Пустота говорит о себе разными словами: непрочитанная — «читаем», ответ
 * базы — «объектов пока нет». Открытый объект стоит в списке всегда, даже
 * если список его ещё не знает: строка, отрицающая открытый объект, читается
 * как «моя работа пропала».
 */
export function projectListItems({ known, id, name } = {}) {
  const list = Array.isArray(known) ? known : [];
  const empty = known === null || known === undefined ? strings.projects.reading : strings.projects.empty;
  if (!id) return { items: list, empty };
  if (list.some((item) => item.id === id)) return { items: list, empty };
  return { items: [{ id, name: name || strings.project.untitled }, ...list], empty };
}

function mountProjectsPanel(host, api) {
  const { getState, setState, notify, subscribe } = api;
  // **`null` — список ещё не прочитан, `[]` — объектов правда нет** (дефект
  // D75). До таска 223 это было одним состоянием, и шапка на пустом `known`
  // писала «Объектов пока нет» — то есть врала человеку, у которого объект
  // открыт и цел. Замер: объект, пришедший **из файла**, в список не попадал
  // вовсе — `panels/file.js` кладёт его в состояние, а перечитывать список
  // панели не говорит, и перерисовка шла по устаревшему `known`.
  let known = null;
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
  // Карандаш открывает свойства объекта (таск 188): имя, адрес, координаты,
  // направление верха чертежа и графы штампа. Прежде он открывал одно имя, а
  // графы штампа жили за кнопкой в окне выгрузки.
  const propsButton = uiIconButton("edit", {
    label: strings.projects.props,
    on: { click: () => projectPropsDialog(api) },
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
  host.replaceChildren(select, createButton, propsButton, removeButton);

  function currentId() {
    const state = getState();
    return state.project ? state.project.id : "";
  }

  /**
   * Перерисовать шапку. Два правила, оба про одно — **пустота не имеет права
   * врать** (дефект D75):
   *
   * 1. Пока список не прочитан (`known === null`), на месте пустоты стоит
   *    «читаем», а не «объектов пока нет». Прочитанная пустота — ответ базы,
   *    непрочитанная — ещё ничей.
   * 2. Открытый объект стоит в списке **всегда**, даже если список его ещё не
   *    знает: он открыт, он на экране, и строка, которая его отрицает, — это
   *    и есть «моя работа пропала». Так приходит объект из файла: `file.js`
   *    кладёт его в состояние сам, а список о нём узнаёт только с перечитки.
   */
  function renderList() {
    const id = currentId();
    const state = getState();
    const { items, empty } = projectListItems({
      known,
      id,
      name: state.project ? state.project.name : "",
    });
    select.replaceChildren();
    if (items.length === 0) {
      select.append(uiEl("option", { value: "", text: empty }));
    }
    for (const item of items) {
      select.append(uiEl("option", { value: item.id, text: item.name }));
    }
    select.value = id;
    const has = Boolean(id);
    propsButton.disabled = !has;
    removeButton.disabled = !has;
    // Режим просмотра: объект выбирается, но не заводится, не переименовывается
    // и не удаляется — на объекте с телефоном это только риск.
    const editable = layoutAllows("editProject", getState().layout);
    createButton.hidden = !editable;
    propsButton.hidden = !editable;
    removeButton.hidden = !editable;
  }

  async function refreshList() {
    known = await listProjects();
    renderList();
  }

  /**
   * Объект появился в состоянии, а список о нём не знает — значит его завёл
   * кто-то другой (приёмка файла, папка автосохранения). Список перечитывается
   * сам: до таска 223 он оставался устаревшим до конца сеанса, и переключиться
   * на принесённый объект было нечем.
   *
   * **Спрашивается смена объекта, а не факт правки** (дефект D76, таск 225).
   * Подписка на `project` срабатывает на каждый штрих: каждая метка, каждая
   * стена идут через `setState({project})`. Пока объект не попал в список,
   * прежнее условие звало `listProjects` на **каждую** правку, а та читает
   * документы целиком (`getAll`), а не сводки. Поэтому сравнивается
   * идентификатор: сменился объект — спросили список один раз, двигают метку
   * в том же объекте — не спросили ни разу.
   */
  let lastProjectId = null;
  function refreshIfUnknown(project) {
    const id = project ? project.id : null;
    if (id === lastProjectId) return;
    lastProjectId = id;
    if (!id) return;
    if (known && known.some((item) => item.id === id)) return;
    refreshList().catch(() => {});
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
    // открывался бы по-разному из базы и из архива. Тем же правилом и там же
    // переезжает комментарий со строки справочника на встроенный тип (G173).
    const migrated = projectsMigrateStored(stored);
    // Постоянный ключ у объектов, заведённых до его появления, дописывается
    // здесь — один раз, при открытии. Это не правка разметки: `updatedAt` не
    // трогается, в истории отмены ничего не появляется, а в базу объект
    // ложится сразу, чтобы ключ не заводился заново при каждом открытии.
    const keyed = ensureProjectKey(migrated);
    const project = keyed.project;
    if (keyed.changed) await saveProject(project);
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
    const project = createProject({ name: uniqueProjectName(known || []), ...(template || {}) });
    await saveProject(project);
    await refreshList();
    setState({ project, schemeId: null, selectedMarkIds: [], activeTypeId: null });
    await setSetting(LAST_PROJECT_KEY, project.id);
    renderList();
    notify(text("projects.created", { name: project.name }), "success");
    return project;
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
    if (known && known.length > 0) await openProjectById(known[0].id);
    else showWelcome();
  }

  // Первый запуск: не пустая серая страница, а две кнопки — завести объект и
  // открыть принесённый файл. Человек с файлом от напарника до этого заводил
  // пустой объект только затем, чтобы добраться до кнопки в шапке.
  //
  // Главное действие — «Создать объект»: оно акцентное и отвечает на Enter.
  // «Открыть файл» стоит рядом обычной кнопкой: это равноправный вход, но
  // выбирают его реже, а два акцента в ряду не оставили бы главного вовсе.
  function showWelcome() {
    // Окно не знает, чем кончился выбор файла, и знать не должно: оно ждёт
    // самого события — появился объект. Так оно закрывается и после открытия
    // файла, и после создания, и если объект пришёл со стороны. Отказ от
    // выбора, отмена в вопросе «каким объектом» и битый архив объекта не
    // создают — окно остаётся стоять, и человек пробует снова.
    let stopWatching = null;
    const finish = () => {
      if (stopWatching) stopWatching();
      stopWatching = null;
      modal.close();
    };
    const modal = uiModal({
      title: strings.projects.welcomeTitle,
      dismissable: false,
      body: [
        uiEl("p", { class: "modal__text", text: strings.projects.welcomeText }),
        uiEl("p", { class: "modal__hint", text: strings.projects.welcomeFile }),
      ],
      actions: [
        uiButton(strings.file.open, {
          title: strings.file.openHint,
          on: { click: () => openProjectFileDialog() },
        }),
        uiButton(strings.projects.createTitle, {
          class: "ui-btn ui-btn--accent",
          on: {
            click: async () => {
              finish();
              await createAndOpen();
            },
          },
        }),
      ],
    });
    stopWatching = subscribe((state, changed) => {
      if ("project" in changed && state.project) finish();
    });
  }

  function scheduleSave(project) {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      saveTimer = null;
      const result = await saveProject(project);
      if (result.ok) {
        known = (known || []).map((item) =>
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
    refreshIfUnknown(state.project);
    if (state.project) scheduleSave(state.project);
  });

  // Первый кадр шапки — **до** того, как база ответила (таск 225): иначе
  // слова «читаем список» некому показать, и в окне ожидания стоит пустой
  // селект без единой строки. Рисуется он тем же `renderList`, просто с
  // непрочитанным списком.
  renderList();

  (async () => {
    await openStore();
    await refreshList();
    const lastId = await getSetting(LAST_PROJECT_KEY);
    const target = (known || []).find((item) => item.id === lastId) || (known || [])[0] || null;
    if (target) await openProjectById(target.id);
    else showWelcome();
    await checkSpace();
    if (storeMode() === "memory") renderList();
  })();
}

registerPanel(PANEL_IDS.projectActions, mountProjectsPanel);
