// Файл проекта: «Сохранить в файл», «Открыть файл», папка автосохранения
// и строка «в файл выгружено: N назад» в шапке.
//
// Панель тонкая: zip пишет и читает `projectFile.js`, переприсваивание
// идентификаторов и работу с папкой держит `autosave.js`. Здесь — кнопки,
// диалоги и связь с состоянием сеанса.
//
// Своей точки монтирования в разметке у панели нет: она создаёт контейнер в
// шапке сама, после того как каркас поднялся (`startApp` откладывается на конец
// загрузки, и наш обработчик встаёт в очередь следом).
import { layoutAllows, panelApi } from "../app.js";
import { schemesInOrder } from "../model.js";
import { unpackProject } from "../projectFile.js";
import { deleteImage, putImage, saveProject, setSetting } from "../store.js";
import { exportDownload } from "../exporter.js";
import { strings, text } from "../strings.js";
import { uiButton, uiConfirm, uiDialogDepth, uiEl, uiModal } from "./ui.js";
import { LAST_PROJECT_KEY } from "./projects.js";
import {
  adoptLoadedProject,
  autosaveAgoText,
  autosaveFlush,
  autosaveForget,
  autosaveGrant,
  autosaveLastExport,
  autosaveNoteExport,
  autosavePack,
  autosavePendingWrite,
  autosavePickFolder,
  autosaveReady,
  autosaveRestore,
  autosaveSchedule,
  autosaveSnapshotName,
  autosaveStatus,
  autosaveWrite,
  onAutosaveChange,
} from "../autosave.js";

// Строка «выгружено N назад» стареет сама по себе: раз в минуту обновляем.
const FILE_TICK_MS = 60000;

// Выбор при загрузке: по умолчанию новый объект, перезапись — отдельной
// кнопкой и с подтверждением. Возвращает "new" | "replace" | null.
function fileAskMode(project, hasCurrent) {
  return new Promise((resolve) => {
    let modal;
    const answer = (value) => {
      modal.close();
      resolve(value);
    };
    const asNew = uiButton(strings.file.loadAsNew, {
      class: "ui-btn ui-btn--accent",
      on: { click: () => answer("new") },
    });
    const actions = [uiButton(strings.dialog.cancel, { on: { click: () => answer(null) } })];
    if (hasCurrent) {
      actions.push(uiButton(strings.file.loadReplace, { on: { click: () => answer("replace") } }));
    }
    actions.push(asNew);
    modal = uiModal({
      title: strings.file.loadTitle,
      body: [
        uiEl("p", {
          class: "modal__text",
          text: text("file.loadSummary", {
            name: project.name,
            schemes: (project.schemes || []).length,
            marks: (project.marks || []).length,
          }),
        }),
        uiEl("p", { class: "modal__hint", text: strings.file.loadHint }),
      ],
      actions,
      primary: asNew,
      onCancel: () => resolve(null),
    });
  });
}

function mountFilePanel(host, api) {
  const { getState, setState, notify, subscribe } = api;
  // Ссылка на объект, который целиком уехал в файл: сравнение по ссылке
  // честнее флага — правка, пришедшая во время упаковки, оставит dirty.
  let fileSavedProject = null;
  let fileFailReported = false;

  const saveButton = uiButton(strings.file.save, {
    class: "ui-btn ui-btn--accent",
    title: strings.file.saveHint,
    on: { click: () => saveToFile() },
  });
  const openButton = uiButton(strings.file.open, {
    title: strings.file.openHint,
    on: { click: () => picker.click() },
  });
  const folderButton = uiButton(strings.autosave.pick, {
    title: strings.autosave.pickHint,
    on: { click: () => folderClick() },
  });
  const statusNode = uiEl("span", { class: "file__status" });
  const picker = uiEl("input", {
    class: "file__picker",
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

  const row = uiEl("div", { class: "file" }, [statusNode, folderButton, openButton, saveButton, picker]);
  host.replaceChildren(row);

  // ——— сохранение в файл ————————————————————————————————————————————

  async function saveToFile() {
    const project = getState().project;
    if (!project) {
      notify(strings.file.noProject, "error");
      return;
    }
    const line = uiEl("p", { class: "modal__text", text: strings.file.packing });
    const modal = uiModal({
      title: strings.file.packingTitle,
      body: line,
      actions: [],
      dismissable: false,
    });
    try {
      // Упаковка идёт через await на каждой записи: вкладка остаётся живой,
      // а строка прогресса успевает перерисоваться.
      const packedFile = await autosavePack(project, {
        onProgress: ({ done, total, phase }) => {
          // Сверка идёт после упаковки и на большом объекте занимает заметное
          // время: молчащее окно выглядело бы как зависшая вкладка.
          line.textContent =
            phase === "check" ? strings.file.checking : text("file.packingProgress", { done, total });
        },
      });
      exportDownload(packedFile.blob, packedFile.name);
      await autosaveNoteExport(project.id);
      markSaved(project);
      notify(text("file.saved", { name: packedFile.name }), "success");
    } catch (error) {
      notify((error && error.message) || strings.file.saveFailed, "error");
    } finally {
      modal.close();
      renderStatus();
    }
  }

  // ——— загрузка из файла ————————————————————————————————————————————

  async function openFromFile(chosen) {
    const line = uiEl("p", { class: "modal__text", text: strings.file.reading });
    const modal = uiModal({
      title: strings.file.readingTitle,
      body: line,
      actions: [],
      dismissable: false,
    });
    let loaded = null;
    try {
      loaded = await unpackProject(chosen, {
        onProgress: ({ done, total }) => {
          line.textContent = text("file.packingProgress", { done, total });
        },
      });
    } catch (error) {
      // Отказ ничего не трогает: текущий объект на экране и в базе как был.
      modal.close();
      notify((error && error.message) || strings.errors.notAProject, "error");
      return;
    }
    modal.close();

    const current = getState().project;
    const mode = await fileAskMode(loaded.project, Boolean(current));
    if (!mode) return;
    if (mode === "replace") {
      const agreed = await uiConfirm({
        title: strings.file.replaceTitle,
        message: text("file.replaceMessage", { name: current.name }),
        confirmLabel: strings.file.replaceConfirm,
      });
      if (!agreed) return;
    }
    await applyLoaded(loaded, mode, current);
  }

  async function applyLoaded(loaded, mode, current) {
    const line = uiEl("p", { class: "modal__text", text: strings.file.reading });
    const modal = uiModal({ title: strings.file.readingTitle, body: line, actions: [], dismissable: false });
    try {
      // Картинки сперва ложатся в хранилище — идентификаторы выдаёт оно,
      // и ровно эти идентификаторы получает приёмка объекта. Второго
      // переприсваивания в сборке нет: ссылки схем чинятся один раз.
      const imageIds = new Map();
      for (const [oldId, blob] of loaded.images) imageIds.set(oldId, await putImage(blob));
      const adopted = adoptLoadedProject(loaded, {
        mode,
        currentId: current ? current.id : null,
        imageIds,
      });
      await saveProject(adopted.project);
      await setSetting(LAST_PROJECT_KEY, adopted.project.id);

      const schemes = schemesInOrder(adopted.project);
      setState({
        project: adopted.project,
        schemeId: schemes.length > 0 ? schemes[0].id : null,
        selectedMarkIds: [],
        activeTypeId: null,
      });
      // Объект только что пришёл из файла — он и есть копия файла,
      // и отметка выгрузки принадлежит уже новому идентификатору.
      await autosaveNoteExport(adopted.project.id);
      markSaved(adopted.project);
      // Заменённый объект унёс с собой свои планы: картинки под старыми
      // идентификаторами больше никому не нужны.
      if (mode === "replace" && current) {
        for (const scheme of current.schemes || []) {
          if (scheme.imageId) await deleteImage(scheme.imageId);
        }
      }
      notify(text("file.loaded", { name: adopted.project.name }), "success");
    } catch (error) {
      notify((error && error.message) || strings.errors.notAProject, "error");
    } finally {
      modal.close();
      renderStatus();
    }
  }

  // ——— папка автосохранения ————————————————————————————————————————

  async function folderClick() {
    const status = autosaveStatus();
    if (!status.supported) {
      notify(strings.autosave.unsupported, "info");
      return;
    }
    if (status.folder && status.permission !== "granted") {
      await autosaveGrant();
      if (autosaveReady()) await writeToFolder();
      renderStatus();
      return;
    }
    if (status.folder) {
      folderDialog();
      return;
    }
    await pickFolder();
  }

  async function pickFolder() {
    try {
      await autosavePickFolder();
    } catch (error) {
      // Отмена в системном окне выбора папки — не ошибка. Отказ по file://
      // (SecurityError) — не поломка, а известное ограничение: страница,
      // открытая с диска, в папку сохранять не умеет.
      const name = error && error.name;
      if (name === "SecurityError" || name === "NotAllowedError") notify(strings.autosave.unsupported, "info");
      else if (name !== "AbortError") notify(strings.autosave.failed, "error");
      renderStatus();
      return;
    }
    if (autosaveReady()) await writeToFolder();
    renderStatus();
  }

  function folderDialog() {
    const status = autosaveStatus();
    let modal;
    modal = uiModal({
      title: strings.autosave.dialogTitle,
      body: uiEl("p", {
        class: "modal__text",
        text: text("autosave.dialogText", { name: status.folder, file: currentFileName() }),
      }),
      actions: [
        uiButton(strings.dialog.close, { on: { click: () => modal.close() } }),
        uiButton(strings.autosave.off, {
          class: "ui-btn ui-btn--danger",
          on: {
            click: async () => {
              modal.close();
              await autosaveForget();
              notify(strings.autosave.offDone, "info");
              renderStatus();
            },
          },
        }),
        uiButton(strings.autosave.change, {
          class: "ui-btn ui-btn--accent",
          on: {
            click: async () => {
              modal.close();
              await pickFolder();
            },
          },
        }),
      ],
    });
  }

  function currentFileName() {
    const project = getState().project;
    return project ? autosaveSnapshotName(project) : "";
  }

  // Первая запись сразу после выбора папки: пользователь должен увидеть файл
  // на месте, а не ждать следующей правки.
  async function writeToFolder() {
    const project = getState().project;
    if (!project || !autosaveReady()) return;
    onFolderWritten(await autosaveWrite(project));
  }

  // Об отказавшей записи говорим один раз — правок много, а беда одна.
  function onFolderWritten(result) {
    if (result && result.ok) {
      fileFailReported = false;
      if (result.project) markSaved(result.project);
    } else if (result && result.error && !fileFailReported) {
      fileFailReported = true;
      // Не прошедшая сверка — не то же, что «не смогли записать»: файл в папке
      // есть, но верить ему нельзя, и сказать надо именно это.
      const failed =
        result.error.code === "fileCheckFailed" ? strings.autosave.checkFailed : strings.autosave.failed;
      notify(failed, "error");
    }
    renderStatus();
  }

  // ——— состояние и строка в шапке ————————————————————————————————————

  function markSaved(project) {
    fileSavedProject = project;
    if (getState().project === project) setState({ dirty: false });
  }

  function renderStatus() {
    const state = getState();
    const status = autosaveStatus();
    const projectId = state.project ? state.project.id : null;
    // Режим просмотра: файл открывают, чтобы посмотреть. Сохранять нечего —
    // объект не менялся, — поэтому на узком экране остаётся одна кнопка.
    const saving = layoutAllows("saveFile", state.layout);
    saveButton.hidden = !saving;
    statusNode.hidden = !saving;
    statusNode.textContent = text("file.exported", { ago: autosaveAgoText(autosaveLastExport(projectId)) });
    statusNode.title = status.supported ? "" : strings.autosave.unsupported;
    row.classList.toggle("is-busy", Boolean(status.busy));
    row.classList.toggle("is-dirty", Boolean(state.dirty));

    folderButton.hidden = !status.supported || !saving;
    if (!status.supported || !saving) return;
    if (!status.folder) {
      folderButton.textContent = strings.autosave.pick;
      folderButton.title = strings.autosave.pickHint;
      folderButton.classList.remove("is-on");
      return;
    }
    if (status.permission !== "granted") {
      folderButton.textContent = strings.autosave.allow;
      folderButton.title = text("autosave.allowHint", { name: status.folder });
      folderButton.classList.remove("is-on");
      return;
    }
    folderButton.textContent = text("autosave.folder", { name: status.folder });
    folderButton.title = strings.autosave.dialogTitle;
    folderButton.classList.add("is-on");
  }

  // Список объектов держит своя панель и перечитывает его по своим поводам:
  // объект, пришедший из файла, ей неизвестен. Чиним ровно одно — чтобы в
  // выпадающем списке стоял тот объект, который на экране.
  function syncProjectSelect(project) {
    const select = document.querySelector("#project-actions select");
    if (!select || !project) return;
    let option = [...select.options].find((item) => item.value === project.id);
    if (!option) {
      option = uiEl("option", { value: project.id, text: project.name });
      select.append(option);
    }
    option.textContent = project.name;
    select.value = project.id;
  }

  // Панель объектов перечитывает свой список только по своим поводам, в том
  // числе отложенно, после сохранения в браузер, — и объект, пришедший из
  // файла, ей неизвестен. Поэтому чиним не однажды, а на каждую перерисовку
  // списка: в нём должен стоять тот объект, который сейчас на экране.
  const projectSelect = document.querySelector("#project-actions select");
  if (projectSelect && typeof MutationObserver === "function") {
    new MutationObserver(() => syncProjectSelect(getState().project)).observe(projectSelect, { childList: true });
  }

  subscribe((state, changed) => {
    if ("layout" in changed) renderStatus();
    if (!("project" in changed)) {
      if ("dirty" in changed) row.classList.toggle("is-dirty", Boolean(state.dirty));
      return;
    }
    syncProjectSelect(state.project);
    if (state.project && state.project !== fileSavedProject) {
      // Не вложенным вызовом: подписчики сейчас в середине обхода.
      queueMicrotask(() => {
        if (getState().project !== fileSavedProject) setState({ dirty: true });
      });
      // Пока папка выбрана, «несохранённого» состояния почти не бывает:
      // запись уходит сама, с задержкой и по одной за раз.
      autosaveSchedule(state.project, { onDone: onFolderWritten });
    }
    renderStatus();
  });

  // Ctrl+S — привычка, а не сюрприз: браузерное «сохранить страницу» здесь
  // бесполезно. Пока открыт диалог, горячие клавиши молчат.
  document.addEventListener("keydown", (event) => {
    if (!(event.ctrlKey || event.metaKey) || event.key !== "s") return;
    if (uiDialogDepth() > 0) return;
    event.preventDefault();
    saveToFile();
  });

  // Вкладку прячут чаще, чем закрывают, и это единственный момент, когда
  // дослать отложенную запись можно по-настоящему: обработчик закрытия уже
  // ничего не дождётся.
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && autosavePendingWrite()) autosaveFlush({ onDone: onFolderWritten });
  });

  // Работа, которой нет ни в папке, ни в файле, не должна уезжать молча.
  // Отложенную запись досылаем прямо здесь — она успеет, если пользователь
  // задержится на вопросе или передумает закрывать. Пообещать это нельзя,
  // поэтому, пока запись не легла, вопрос задаётся и при выбранной папке.
  window.addEventListener("beforeunload", (event) => {
    const waiting = autosavePendingWrite();
    if (waiting) autosaveFlush({ onDone: onFolderWritten });
    if (!getState().dirty) return;
    if (autosaveReady() && !waiting) return;
    event.preventDefault();
    event.returnValue = "";
  });

  onAutosaveChange(() => renderStatus());
  setInterval(() => renderStatus(), FILE_TICK_MS);

  (async () => {
    await autosaveRestore();
    renderStatus();
  })();
  renderStatus();
}

// Контейнер в шапке панель заводит сама: точки монтирования для неё в разметке
// нет, а править разметку последним таском — лишний повод сломать сборку.
function startFilePanel() {
  const header = document.getElementById("app-header");
  if (!header || document.getElementById("file-actions")) return;
  const host = uiEl("div", { class: "mount" });
  host.id = "file-actions";
  header.append(host);
  mountFilePanel(host, panelApi());
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", startFilePanel, { once: true });
  } else {
    setTimeout(startFilePanel, 0);
  }
}
