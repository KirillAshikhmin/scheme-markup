// Схемы объекта: список, загрузка плана кнопкой и перетаскиванием, поворот
// и обрезка, переименование, порядок, удаление.
// Холст рисует другой модуль — сюда он приходит только за картинкой:
// подготовленный план и его размер кладутся в состояние сеанса (`schemeImage`).
import { layoutAllows, PANEL_IDS, registerPanel, SECTION_IDS, setSectionBadge } from "../app.js";
import {
  addScheme,
  clearPlanScale,
  deleteScheme,
  findScheme,
  formatMeters,
  planScaleOf,
  planSizeMeters,
  replaceSchemeImage,
  schemesInOrder,
  setPlanScale,
  updateMark,
  updateOutline,
  updateScheme,
} from "../model.js";
import { CANVAS_MODE_SCALE, canvasCommit } from "../canvas.js";
import { canUndo } from "../history.js";
import {
  countPointsOutside,
  cropTransform,
  decodePlanImage,
  identityTransform,
  isPlanImageFile,
  isIdentityTransform,
  readPlanImage,
  releasePlanImage,
  renderPlanImage,
  rotateTransform,
  sameAspect,
  transformMarkPoints,
  transformOffset,
  transformPoint,
} from "../imagePrep.js";
import { deleteImage, getImage, putImage, sweepOrphanImages } from "../store.js";
import { strings, text } from "../strings.js";
import { uiButton, uiConfirm, uiEl, uiIconButton, uiModal, uiPrompt } from "./ui.js";

// Рамка меньше этой доли считается промахом мыши, а не обрезкой.
const PLAN_FRAME_MIN = 0.02;

// Уборка ничьих подложек сносит данные заказчика, поэтому условия запуска
// названы явно и проверяются отдельно от порядка событий: объект открыт,
// за сеанс ещё не убирали, и — главное — отменять нечего. Пока в стеке отмены
// лежит хоть один шаг, он может вернуть ссылку на «ничью» картинку.
export function schemesSweepReady({ project, swept, canUndo: hasUndo }) {
  return Boolean(project) && !swept && !hasUndo;
}

function planNameFromFile(file, project) {
  const raw = String((file && file.name) || "").replace(/\.[^.]+$/, "").trim();
  if (raw) return raw.slice(0, 60);
  return text("schemes.defaultName", { number: project.schemes.length + 1 });
}

// Метка держит доли плана: одно накопленное преобразование двигает и их,
// иначе метки уедут с тех мест, куда их поставил инженер. Контур помещения
// устроен так же — точки в долях, смещение подписи в пикселях плана, — поэтому
// пересчитывается он той же функцией.
function remapForTransform(item, transform) {
  return {
    points: transformMarkPoints(item.points || [], transform),
    labelOffset: item.labelOffset ? transformOffset(item.labelOffset, transform) : null,
  };
}

function marksPushedOutside(marks, transform) {
  return marks.filter((mark) => countPointsOutside(mark.points || [], transform) > 0).length;
}

function outlinesOfScheme(project, schemeId) {
  const list = project && Array.isArray(project.outlines) ? project.outlines : [];
  return list.filter((outline) => outline.schemeId === schemeId);
}

/**
 * Правка плана одним куском: новая подложка, её размер и пересчёт всего, что
 * задано в координатах этого плана, — точки меток, смещения их подписей,
 * контуры помещений и смещения подписей комнат. Контуры двигаются вместе с
 * метками не для красоты: помещение метки подставляется по контуру на каждом
 * шаге истории, и оставь контур лежать поперёк повёрнутых стен — половина
 * меток молча уедет в чужие комнаты.
 *
 * Чистая и вынесена наружу нарочно: «до» и «после» одного и того же объекта —
 * это и есть шаг отмены, и проверяется он тестом, без DOM и без хранилища.
 * `pushed` — сколько меток рамка прижала к краю плана: их прежних мест не
 * вернёт уже ничто, кроме отмены, и сказать об этом надо вслух.
 *
 * **Калибровка масштаба переживает поворот и обрезку** — за этим и хранятся
 * доли (ADR 002): точки отрезка пересчитываются тем же преобразованием, что
 * точки меток, метры остаются теми же, а px/м пересчитается сам из нового
 * размера плана. Единственный случай, когда она не выживает, — точка отрезка
 * осталась за рамкой обрезки: её прижало бы к краю, отрезок укоротился, и
 * масштаб уехал бы молча. Тогда калибровка честно снимается (`scaleLost`).
 */
export function applyPlanEdit(project, schemeId, { imageId, width, height, transform } = {}) {
  const marks = project.marks.filter((mark) => mark.schemeId === schemeId);
  const pushed = marksPushedOutside(marks, transform);
  const scale = planScaleOf(project, schemeId);
  let scaleLost = Boolean(scale) && countPointsOutside([scale.a, scale.b], transform) > 0;
  let next = updateScheme(project, schemeId, { imageId, width, height }).project;
  for (const mark of marks) {
    const patch = remapForTransform(mark, transform);
    next = updateMark(next, mark.id, patch.labelOffset ? patch : { points: patch.points }).project;
  }
  for (const outline of outlinesOfScheme(project, schemeId)) {
    const patch = remapForTransform(outline, transform);
    next = updateOutline(next, outline.id, patch.labelOffset ? patch : { points: patch.points }).project;
  }
  if (scale && !scaleLost) {
    try {
      next = setPlanScale(next, schemeId, {
        a: transformPoint(scale.a, transform),
        b: transformPoint(scale.b, transform),
        meters: scale.meters,
      }).project;
    } catch (error) {
      // Пересчёт не сошёлся (отрезок выродился) — показывать длины из такого
      // масштаба нельзя. Снимаем и говорим вслух, а не угадываем.
      scaleLost = true;
    }
  }
  if (scale && scaleLost) next = clearPlanScale(next, schemeId).project;
  return { project: next, pushed, scaleLost };
}

/**
 * Что написано на кнопке масштаба. Чистая функция: решение о словах
 * принимается здесь и проверяется без браузера.
 *
 * Кнопка показывает не «1 px = 0,02 м», а **размер всего плана в метрах** —
 * это то, что инженер сверяет с чертежом глазом: дом по фасаду двенадцать
 * метров, значит «план 12,4 × 8,6 м» подтверждает калибровку, а «124 × 86»
 * выдаёт запятую не на том месте раньше, чем по этому масштабу закажут ленту.
 */
export function schemesScaleView(project, schemeId, name) {
  const scale = planScaleOf(project, schemeId);
  const size = planSizeMeters(project, schemeId);
  if (!scale || !size) {
    return { set: false, label: strings.scale.notSet, title: text("scale.notSetTitle", { name }) };
  }
  return {
    set: true,
    label: text("scale.set", { width: formatMeters(size.width), height: formatMeters(size.height) }),
    title: text("scale.setTitle", { name, meters: formatMeters(scale.meters) }),
  };
}

// Диалог правки плана. Повороты и рамки копятся в одно преобразование и
// применяются к исходнику: JPEG пережимается один раз, сколько бы шагов ни
// сделал пользователь. `beforeApply` — последнее слово вызывающего перед
// применением (например, спросить про метки, которые вынесет за рамку).
export function openPlanEditor({ blob, width, height, title, beforeApply }) {
  return new Promise((resolve) => {
    let transform = identityTransform();
    let preview = { blob, width, height };
    let url = URL.createObjectURL(blob);
    let frame = null;
    let busy = false;
    let modal = null;

    const image = uiEl("img", { class: "plan-stage__img", attrs: { src: url, alt: "" } });
    const box = uiEl("div", { class: "plan-frame" });
    box.hidden = true;
    const stage = uiEl("div", { class: "plan-stage" }, [image, box]);
    const hint = uiEl("p", { class: "modal__hint", text: strings.image.cropHint });

    const rotateLeft = uiIconButton("rotateLeft", {
      title: strings.image.rotateLeft,
      on: { click: () => apply(rotateTransform(transform, -90)) },
    });
    const rotateRight = uiIconButton("rotateRight", {
      title: strings.image.rotateRight,
      on: { click: () => apply(rotateTransform(transform, 90)) },
    });
    const cropButton = uiButton(strings.image.crop, {
      on: { click: () => apply(cropTransform(transform, frame)) },
    });
    const resetButton = uiButton(strings.image.cropReset, { on: { click: () => setFrame(null) } });
    const cancelButton = uiButton(strings.dialog.cancel, { on: { click: () => finish(null) } });
    const applyButton = uiButton(strings.image.apply, {
      class: "ui-btn ui-btn--accent",
      on: { click: () => requestApply() },
    });

    function setFrame(next) {
      frame = next;
      box.hidden = !next;
      cropButton.disabled = !next || busy;
      resetButton.disabled = !next || busy;
      if (!next) return;
      const rect = image.getBoundingClientRect();
      const stageRect = stage.getBoundingClientRect();
      box.style.left = rect.left - stageRect.left + next.x * rect.width + "px";
      box.style.top = rect.top - stageRect.top + next.y * rect.height + "px";
      box.style.width = next.width * rect.width + "px";
      box.style.height = next.height * rect.height + "px";
    }

    function setBusy(value) {
      busy = value;
      for (const button of [rotateLeft, rotateRight, applyButton, cancelButton]) button.disabled = value;
      cropButton.disabled = value || !frame;
      resetButton.disabled = value || !frame;
      hint.textContent = value ? strings.image.working : strings.image.cropHint;
    }

    // Предпросмотр всегда пересобирается из исходника по накопленному
    // преобразованию — что видно, то и получится, без цепочки пережатий.
    async function apply(next) {
      if (busy) return;
      setBusy(true);
      try {
        const result = await renderPlanImage(blob, next);
        URL.revokeObjectURL(url);
        preview = result;
        transform = next;
        url = URL.createObjectURL(result.blob);
        image.src = url;
        setFrame(null);
        setBusy(false);
      } catch (error) {
        setBusy(false);
        finish(null);
      }
    }

    async function requestApply() {
      if (busy) return;
      // Спрашиваем всегда, а не только после правки: замене подложки важен
      // итоговый размер, даже когда картинку не крутили.
      if (beforeApply) {
        setBusy(true);
        const agreed = await beforeApply(transform, { width: preview.width, height: preview.height });
        setBusy(false);
        if (!agreed) return;
      }
      finish({ blob: preview.blob, width: preview.width, height: preview.height, transform });
    }

    function finish(result) {
      URL.revokeObjectURL(url);
      if (modal) modal.close();
      resolve(result);
    }

    // Рамка тянется мышью прямо по картинке.
    stage.addEventListener("pointerdown", (event) => {
      if (busy || event.button !== 0) return;
      const rect = image.getBoundingClientRect();
      const startX = Math.min(Math.max(event.clientX, rect.left), rect.right);
      const startY = Math.min(Math.max(event.clientY, rect.top), rect.bottom);
      const move = (moveEvent) => {
        const x = Math.min(Math.max(moveEvent.clientX, rect.left), rect.right);
        const y = Math.min(Math.max(moveEvent.clientY, rect.top), rect.bottom);
        setFrame({
          x: (Math.min(startX, x) - rect.left) / rect.width,
          y: (Math.min(startY, y) - rect.top) / rect.height,
          width: Math.abs(x - startX) / rect.width,
          height: Math.abs(y - startY) / rect.height,
        });
      };
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        if (frame && (frame.width < PLAN_FRAME_MIN || frame.height < PLAN_FRAME_MIN)) setFrame(null);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      event.preventDefault();
    });

    modal = uiModal({
      title: title || strings.image.editTitle,
      body: uiEl("div", { class: "plan-editor" }, [
        uiEl("div", { class: "plan-editor__tools" }, [rotateLeft, rotateRight, cropButton, resetButton]),
        stage,
        hint,
      ]),
      actions: [cancelButton, applyButton],
      onCancel: () => {
        URL.revokeObjectURL(url);
        resolve(null);
      },
    });
    setFrame(null);
  });
}

function mountSchemesPanel(host, api) {
  const { getState, setState, notify, subscribe } = api;
  let decoded = null;
  let imageToken = 0;

  const list = uiEl("div", { class: "scheme-list" });
  const fileInput = uiEl("input", {
    class: "scheme-file",
    type: "file",
    attrs: { accept: "image/png,image/jpeg,.png,.jpg,.jpeg" },
    on: {
      change: async () => {
        const file = fileInput.files && fileInput.files[0];
        fileInput.value = "";
        if (file) await addPlanFromFile(file);
      },
    },
  });
  fileInput.hidden = true;
  let replaceTarget = null;
  const replaceInput = uiEl("input", {
    class: "scheme-file",
    type: "file",
    attrs: { accept: "image/png,image/jpeg,.png,.jpg,.jpeg" },
    on: {
      change: async () => {
        const file = replaceInput.files && replaceInput.files[0];
        const schemeId = replaceTarget;
        replaceInput.value = "";
        replaceTarget = null;
        if (file && schemeId) await replacePlanFromFile(schemeId, file);
      },
    },
  });
  replaceInput.hidden = true;
  const addButton = uiButton(strings.schemes.add, {
    class: "ui-btn ui-btn--accent ui-btn--wide",
    on: { click: () => fileInput.click() },
  });
  const hint = uiEl("p", { class: "panel__empty", text: strings.schemes.addHint });
  host.replaceChildren(addButton, fileInput, replaceInput, list, hint);

  function render() {
    const state = getState();
    const project = state.project;
    // Режим просмотра: схему выбирают, но не грузят, не правят и не удаляют.
    const editable = layoutAllows("editSchemes", state.layout);
    list.replaceChildren();
    addButton.disabled = !project;
    addButton.hidden = !editable;
    // Счётчик в заголовке: свёрнутый раздел не путается с пустым.
    setSectionBadge(SECTION_IDS.schemes, project && project.schemes.length ? project.schemes.length : "");
    if (!project || project.schemes.length === 0) {
      hint.textContent = editable
        ? project
          ? strings.schemes.addHint
          : strings.projects.empty
        : strings.mobile.viewOnly;
      return;
    }
    hint.textContent = "";
    const ordered = schemesInOrder(project);
    ordered.forEach((scheme, index) => {
      const marks = project.marks.filter((mark) => mark.schemeId === scheme.id).length;
      const row = uiEl("div", {
        class: "scheme-row" + (scheme.id === state.schemeId ? " scheme-row--current" : ""),
      });
      // Размеры плана стоят в узкой колонке рядом с рядом кнопок и при длинном
      // числе ужимаются многоточием — поэтому то же самое лежит в подсказке.
      const meta = scheme.imageId
        ? text("schemes.size", { width: scheme.width, height: scheme.height })
        : strings.schemes.noImage;
      row.append(
        uiEl("button", {
          class: "scheme-row__name",
          type: "button",
          text: scheme.name,
          title: scheme.name,
          on: { click: () => setState({ schemeId: scheme.id, selectedMarkIds: [] }) },
        }),
        uiEl("span", { class: "scheme-row__meta", text: meta, title: meta }),
        uiEl("div", { class: "scheme-row__tools", attrs: editable ? {} : { hidden: "hidden" } }, [
          uiIconButton("crop", { title: strings.schemes.edit, on: { click: () => editPlan(scheme.id) } }),
          uiIconButton("swap", {
            title: strings.schemes.replace,
            on: {
              click: () => {
                replaceTarget = scheme.id;
                replaceInput.click();
              },
            },
          }),
          uiIconButton("edit", { title: strings.schemes.rename, on: { click: () => renameScheme(scheme.id) } }),
          uiIconButton("up", {
            title: strings.schemes.up,
            attrs: index === 0 ? { disabled: "disabled" } : {},
            on: { click: () => moveScheme(scheme.id, -1) },
          }),
          uiIconButton("down", {
            title: strings.schemes.down,
            attrs: index === ordered.length - 1 ? { disabled: "disabled" } : {},
            on: { click: () => moveScheme(scheme.id, 1) },
          }),
          uiIconButton("trash", {
            class: "ui-btn ui-btn--danger",
            title: strings.schemes.remove,
            on: { click: () => removeScheme(scheme.id, marks) },
          }),
        ]),
      );
      // Масштаб — третьей строкой и словами, а не значком: состояние «задан или
      // нет» должно читаться с панели, не наводя курсор. Без плана калибровать
      // нечего, в просмотре правок нет вовсе — там кнопки не показываем.
      if (editable && scheme.imageId) {
        const view = schemesScaleView(project, scheme.id, scheme.name);
        row.append(
          uiButton(view.label, {
            class: "ui-btn ui-btn--wide scheme-row__scale" + (view.set ? " is-set" : ""),
            title: view.title,
            on: { click: () => editScale(scheme.id) },
          }),
        );
      }
      list.append(row);
    });
  }

  // Новый план: проверка файла, правка картинки, только потом запись.
  async function addPlanFromFile(file) {
    const state = getState();
    if (!state.project) return;
    if (!isPlanImageFile(file)) {
      notify(strings.image.wrongType, "error");
      return;
    }
    let plan;
    hint.textContent = strings.schemes.loading;
    addButton.disabled = true;
    try {
      plan = await readPlanImage(file);
    } catch (error) {
      notify(strings.image.broken, "error");
      return;
    } finally {
      addButton.disabled = false;
      render();
    }
    const edited = await openPlanEditor({
      blob: plan.blob,
      width: plan.width,
      height: plan.height,
      title: strings.image.editTitle,
    });
    if (!edited) return;
    const imageId = await putImage(edited.blob);
    const fresh = getState().project;
    const added = addScheme(fresh, {
      name: planNameFromFile(file, fresh),
      imageId,
      width: edited.width,
      height: edited.height,
    });
    setState({ project: added.project, schemeId: added.scheme.id, selectedMarkIds: [] });
    notify(text("schemes.added", { name: added.scheme.name }), "success");
  }

  // Правка уже загруженного плана: метки и контуры пересчитываются тем же
  // преобразованием. Про метки, которые уедут за рамку, спрашиваем до
  // применения — рамка прижимает их к краю, и прежних мест в них не остаётся.
  async function editPlan(schemeId) {
    const project = getState().project;
    const scheme = findScheme(project, schemeId);
    if (!scheme || !scheme.imageId) return;
    const blob = await getImage(scheme.imageId);
    if (!blob) {
      notify(strings.image.broken, "error");
      return;
    }
    const marksOfScheme = project.marks.filter((mark) => mark.schemeId === schemeId);
    const edited = await openPlanEditor({
      blob,
      width: scheme.width,
      height: scheme.height,
      title: scheme.name,
      beforeApply: async (transform) => {
        const count = marksPushedOutside(marksOfScheme, transform);
        if (count === 0) return true;
        return uiConfirm({
          title: strings.image.outsideTitle,
          message: text("image.marksOutsideAsk", { count }),
          confirmLabel: strings.image.cropAnyway,
        });
      },
    });
    if (!edited || isIdentityTransform(edited.transform)) return;
    const imageId = await putImage(edited.blob);
    const before = getState().project;
    if (!findScheme(before, schemeId)) return;
    let result;
    try {
      result = applyPlanEdit(before, schemeId, {
        imageId,
        width: edited.width,
        height: edited.height,
        transform: edited.transform,
      });
    } catch (error) {
      notify(error.message, "error");
      return;
    }
    // Через canvasCommit — тем же способом, что и «Заменить план». Поворот и
    // обрезка двигают координаты всех меток схемы разом: это самая
    // разрушительная правка в сборке, и отменяться она обязана раньше любой
    // другой. Прежняя картинка поэтому остаётся в хранилище: без неё отмена
    // вернула бы координаты на план, которого уже нет. Уберёт её уборка при
    // следующем запуске — тогда, когда отменять будет нечего.
    canvasCommit(before, result.project, strings.history.editImage, { schemeId });
    // Снятая калибровка важнее прижатых меток: без неё с листа пропадут длины,
    // и узнать об этом из таблицы — поздно.
    notify(
      result.scaleLost
        ? strings.image.appliedScaleDropped
        : result.pushed === 0
          ? strings.image.applied
          : text("image.appliedClamped", { count: result.pushed }),
      "success",
    );
  }

  // Замена подложки: картинка другая, разметка остаётся вся. Координаты — доли
  // плана, поэтому при той же пропорции всё встаёт само; при другой разметка
  // поедет, и об этом спрашивают до применения, а не показывают кашу после.
  // Прежнее преобразование не переносится: поворот и обрезка запечены в старой
  // картинке, самого преобразования нигде нет. Новый файл правится тем же
  // редактором и теми же руками — с предпросмотром, а не вслепую.
  async function replacePlanFromFile(schemeId, file) {
    const scheme = findScheme(getState().project, schemeId);
    if (!scheme) return;
    if (!isPlanImageFile(file)) {
      notify(strings.image.wrongType, "error");
      return;
    }
    let plan;
    try {
      plan = await readPlanImage(file);
    } catch (error) {
      notify(strings.image.broken, "error");
      return;
    }
    const wasSize = { width: scheme.width, height: scheme.height };
    const edited = await openPlanEditor({
      blob: plan.blob,
      width: plan.width,
      height: plan.height,
      title: text("image.replaceTitle", { name: scheme.name }),
      beforeApply: async (transform, size) => {
        if (sameAspect(wasSize, size)) return true;
        return uiConfirm({
          title: strings.image.aspectTitle,
          message: text("image.aspectAsk", {
            before: text("schemes.size", { width: wasSize.width, height: wasSize.height }),
            after: text("schemes.size", { width: size.width, height: size.height }),
          }),
          confirmLabel: strings.image.replaceAnyway,
        });
      },
    });
    if (!edited) return;
    const imageId = await putImage(edited.blob);
    const before = getState().project;
    if (!findScheme(before, schemeId)) return;
    let replaced;
    try {
      replaced = replaceSchemeImage(before, schemeId, {
        imageId,
        width: edited.width,
        height: edited.height,
      });
    } catch (error) {
      notify(error.message, "error");
      return;
    }
    // Через canvasCommit: замену отменяет Ctrl+Z, как и всё остальное. Прежняя
    // картинка поэтому и остаётся в хранилище — её убирает уборка при запуске,
    // когда отменять уже нечего.
    canvasCommit(before, replaced.project, strings.history.replaceImage, { schemeId });
    // Два разных известия в одном: куда встала разметка и что стало с
    // масштабом. Второе дописывается строкой словаря, а не вплетается в
    // четыре варианта первого: масштаб снимается независимо от пропорций.
    const placed = sameAspect(wasSize, edited) ? strings.image.replaced : strings.image.replacedShifted;
    notify(replaced.scaleDropped ? placed + " " + strings.scale.replaceDropped : placed, "success");
  }

  // ——— масштаб плана ——————————————————————————————————————————————————
  //
  // Ручка стоит в строке схемы, а не в инструментах: масштаб принадлежит
  // схеме. У этажей разные планы и разные калибровки, и кнопка у каждой свои.

  // Клик по кнопке: масштаба нет — сразу калибруем (лишнее окно там ни о чём);
  // есть — показываем, что задано, и спрашиваем, калибровать заново или снять.
  async function editScale(schemeId) {
    const state = getState();
    const scheme = findScheme(state.project, schemeId);
    if (!scheme) return;
    if (!scheme.imageId) {
      notify(strings.scale.needPlan, "error");
      return;
    }
    const scale = planScaleOf(state.project, schemeId);
    if (!scale) {
      startScale(schemeId);
      return;
    }
    const size = planSizeMeters(state.project, schemeId);
    let modal = null;
    const body = uiEl("div", {}, [
      uiEl("p", {
        text: text("scale.dialogSet", {
          meters: formatMeters(scale.meters),
          width: size ? formatMeters(size.width) : "",
          height: size ? formatMeters(size.height) : "",
        }),
      }),
      uiEl("p", { class: "modal__hint", text: strings.scale.dialogHint }),
    ]);
    modal = uiModal({
      title: text("scale.dialogTitle", { name: scheme.name }),
      body,
      actions: [
        uiButton(strings.dialog.cancel, { on: { click: () => modal.close() } }),
        uiButton(strings.scale.clear, {
          class: "ui-btn ui-btn--danger",
          on: {
            click: () => {
              modal.close();
              dropScale(schemeId);
            },
          },
        }),
        uiButton(strings.scale.again, {
          class: "ui-btn ui-btn--accent",
          on: {
            click: () => {
              modal.close();
              startScale(schemeId);
            },
          },
        }),
      ],
    });
  }

  // Калибруют на холсте — там план и видно. Панель только открывает нужную
  // схему и отдаёт холсту режим; выделение при этом снимается, чтобы ручки
  // метки не стояли под рукой, которая целится в точку отрезка.
  function startScale(schemeId) {
    setState({
      schemeId,
      selectedMarkIds: [],
      selectedOutlineId: null,
      editPathId: null,
      mode: CANVAS_MODE_SCALE,
    });
  }

  function dropScale(schemeId) {
    const before = getState().project;
    try {
      const result = clearPlanScale(before, schemeId);
      if (!result.cleared) return;
      canvasCommit(before, result.project, strings.history.scaleClear, { schemeId });
      notify(strings.scale.cleared, "success");
    } catch (error) {
      notify(error.message, "error");
    }
  }

  async function renameScheme(schemeId) {
    const project = getState().project;
    const scheme = findScheme(project, schemeId);
    if (!scheme) return;
    const name = await uiPrompt({ title: strings.schemes.renameTitle, value: scheme.name });
    if (!name || name === scheme.name) return;
    setState({ project: updateScheme(getState().project, schemeId, { name }).project });
  }

  function moveScheme(schemeId, delta) {
    const project = getState().project;
    const ordered = schemesInOrder(project);
    const index = ordered.findIndex((scheme) => scheme.id === schemeId);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= ordered.length) return;
    const moved = [...ordered];
    moved.splice(target, 0, moved.splice(index, 1)[0]);
    let next = project;
    moved.forEach((scheme, position) => {
      if (scheme.order !== position) next = updateScheme(next, scheme.id, { order: position }).project;
    });
    setState({ project: next });
  }

  async function removeScheme(schemeId, marks) {
    const project = getState().project;
    const scheme = findScheme(project, schemeId);
    if (!scheme) return;
    const agreed = await uiConfirm({
      title: strings.schemes.removeTitle,
      message: text("schemes.removeMessage", { name: scheme.name, marks }),
    });
    if (!agreed) return;
    const fresh = getState().project;
    const next = deleteScheme(fresh, schemeId).project;
    if (scheme.imageId) await deleteImage(scheme.imageId);
    const rest = schemesInOrder(next);
    setState({
      project: next,
      schemeId: getState().schemeId === schemeId ? (rest[0] ? rest[0].id : null) : getState().schemeId,
      selectedMarkIds: [],
    });
    notify(text("schemes.removed", { name: scheme.name }), "success");
  }

  // Картинка текущей схемы — единственное, что панель отдаёт холсту.
  async function loadSchemeImage(force) {
    const state = getState();
    const scheme = state.project && state.schemeId ? findScheme(state.project, state.schemeId) : null;
    const token = ++imageToken;
    if (!scheme || !scheme.imageId) {
      if (decoded) releasePlanImage(decoded);
      decoded = null;
      if (state.schemeImage) setState({ schemeImage: null });
      return;
    }
    const current = state.schemeImage;
    if (!force && current && current.schemeId === scheme.id && current.imageId === scheme.imageId) return;
    const blob = await getImage(scheme.imageId);
    if (!blob || token !== imageToken) return;
    let next;
    try {
      next = await decodePlanImage(blob);
    } catch (error) {
      notify(strings.image.broken, "error");
      return;
    }
    if (token !== imageToken) {
      releasePlanImage(next);
      return;
    }
    if (decoded) releasePlanImage(decoded);
    decoded = next;
    setState({
      schemeImage: {
        schemeId: scheme.id,
        imageId: scheme.imageId,
        image: next.image,
        url: next.url,
        width: next.width,
        height: next.height,
      },
    });
  }

  // Перетаскивание плана на холст — тот же путь, что и кнопка.
  const area = document.getElementById("canvas-area");
  if (area) {
    area.dataset.drop = strings.schemes.dropHere;
    area.addEventListener("dragover", (event) => {
      event.preventDefault();
      area.classList.add("is-dropping");
    });
    area.addEventListener("dragleave", (event) => {
      if (event.target === area) area.classList.remove("is-dropping");
    });
    area.addEventListener("drop", async (event) => {
      event.preventDefault();
      area.classList.remove("is-dropping");
      const file = event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0];
      if (file) await addPlanFromFile(file);
    });
  }
  // Файл, брошенный мимо холста, не должен уводить страницу в просмотр картинки.
  document.addEventListener("dragover", (event) => event.preventDefault());
  document.addEventListener("drop", (event) => event.preventDefault());

  // Уборка ничьих подложек — один раз за сеанс, на первом открытом объекте:
  // стек отмены в этот момент пуст, несохранённых правок ещё нет, и удалять
  // безопасно. Мусор, нажитый за сеанс, уйдёт при следующем запуске.
  let swept = false;
  subscribe((state, changed) => {
    if ("layout" in changed) render();
    if ("project" in changed || "schemeId" in changed) {
      render();
      loadSchemeImage(false);
    }
    if (schemesSweepReady({ project: state.project, swept, canUndo: canUndo() })) {
      swept = true;
      sweepOrphanImages([state.project]);
    }
  });
  render();
  loadSchemeImage(false);
}

registerPanel(PANEL_IDS.schemes, mountSchemesPanel);
