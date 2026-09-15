// Справочник объекта: типы меток, категории, помещения и шаблон для новых
// объектов.
//
// Справочник у каждого объекта свой — правка типов здесь не трогает соседние
// объекты. Общим остаётся только шаблон: снимок справочника в настройках
// браузера, с которого панель объектов создаёт следующий объект; уже
// созданные остаются как были.
import { PANEL_IDS, registerPanel } from "../app.js";
import { strings, text } from "../strings.js";
import {
  BLOCK_MODES,
  SHAPE_NAMES,
  SHAPE_PALETTE,
  addCategory,
  addType,
  deleteCategory,
  deleteType,
  findCategory,
  styleOf,
  typesInOrder,
  updateCategory,
  updateType,
} from "../model.js";
import { shapeIcon } from "../render.js";
import { canvasCommit } from "../canvas.js";
import { getSetting, setSetting } from "../store.js";
import { uiButton, uiConfirm, uiEl, uiModal } from "./ui.js";
import { openRoomsEditor } from "./rooms.js";

export const TYPE_TEMPLATE_KEY = "typeTemplate";
const TYPES_SWATCH_SIZE = 34;

function typesSnapshot(project) {
  return {
    categories: project.categories.map((category) => ({
      id: category.id,
      name: category.name,
      color: category.color,
      shape: category.shape,
    })),
    markTypes: project.markTypes.map((type) => ({
      categoryId: type.categoryId,
      code: type.code,
      name: type.name,
      shape: type.shape,
      blockMode: type.blockMode,
    })),
  };
}

// Шаблон для `createProject`: те же категории и типы, но с новыми
// идентификаторами — два объекта не должны делить ни одну запись справочника.
// Форма и режим блока сверяются со списками модели: шаблон мог быть сохранён
// давно, а неизвестное значение объект бы уже не принял.
export function typesTemplateFrom(template) {
  if (!template || !Array.isArray(template.categories) || !Array.isArray(template.markTypes)) return null;
  const ids = new Map();
  const categories = template.categories.map((category, index) => {
    const id = globalThis.crypto.randomUUID();
    ids.set(category.id, id);
    return {
      id,
      name: category.name,
      color: category.color,
      shape: SHAPE_NAMES.includes(category.shape) ? category.shape : SHAPE_NAMES[0],
      order: index,
    };
  });
  const markTypes = template.markTypes
    .filter((type) => ids.has(type.categoryId))
    .map((type, index) => ({
      id: globalThis.crypto.randomUUID(),
      categoryId: ids.get(type.categoryId),
      code: type.code,
      name: type.name,
      shape: SHAPE_NAMES.includes(type.shape) ? type.shape : null,
      blockMode: BLOCK_MODES.includes(type.blockMode) ? type.blockMode : BLOCK_MODES[0],
      order: index,
    }));
  if (categories.length === 0 || markTypes.length === 0) return null;
  return { categories, markTypes };
}

function typesShapeCell({ shape, color, active, inherit, onPick }) {
  const cell = uiEl(
    "button",
    {
      class: "shapes__cell" + (active ? " is-active" : "") + (inherit ? " shapes__cell--inherit" : ""),
      type: "button",
      title: inherit ? strings.shapes.inherit : strings.shapes[shape] || shape,
      on: { click: onPick },
    },
    [shapeIcon(shape, color, TYPES_SWATCH_SIZE)],
  );
  return cell;
}

// Выбор формы — сетка нарисованных фигур, а не список названий: обозначение
// узнают в лицо, а не по слову. Вариант «как у категории» стоит первой ячейкой
// и показывает фигуру категории с пометкой.
export function openTypesShapePicker({ shape, color, allowInherit, inheritShape }) {
  return new Promise((resolve) => {
    let modal;
    const done = (result) => {
      modal.close();
      resolve(result);
    };
    const cells = [];
    if (allowInherit) {
      cells.push(
        typesShapeCell({
          shape: inheritShape || SHAPE_PALETTE[0],
          color,
          active: !shape,
          inherit: true,
          onPick: () => done({ shape: null }),
        }),
      );
    }
    for (const name of SHAPE_PALETTE) {
      cells.push(
        typesShapeCell({ shape: name, color, active: shape === name, onPick: () => done({ shape: name }) }),
      );
    }
    modal = uiModal({
      title: strings.dictionary.shape,
      body: uiEl("div", { class: "shapes" }, cells),
      actions: [uiButton(strings.dialog.cancel, { on: { click: () => done(null) } })],
      onCancel: () => resolve(null),
    });
  });
}

function typesShapeButton({ shape, color, allowInherit, inheritShape, onPick }) {
  const button = uiEl(
    "button",
    {
      class: "dict__shape" + (allowInherit && !shape ? " dict__shape--inherit" : ""),
      type: "button",
      // В подсказке — имя того, что выбрано сейчас: у снятых с палитры фигур
      // это единственное место, где видно, как называется старое значение.
      title: shape ? strings.shapes[shape] || shape : allowInherit ? strings.shapes.inherit : strings.dictionary.shape,
      on: {
        click: async () => {
          const picked = await openTypesShapePicker({ shape, color, allowInherit, inheritShape });
          if (picked) onPick(picked.shape);
        },
      },
    },
    [shapeIcon(shape || inheritShape || SHAPE_PALETTE[0], color, 26)],
  );
  return button;
}

export function openTypesDictionary(api) {
  const body = uiEl("div", { class: "dict" });

  function project() {
    return api.getState().project;
  }

  function fail(error) {
    api.notify(error && error.message ? error.message : String(error), "error");
    render();
  }

  // Своей перерисовки после команды не нужно: правка объекта приходит подпиской,
  // и тем же путём приходит чужая — Ctrl+Z при открытом окне.
  function commit(build, label) {
    try {
      canvasCommit(project(), build(project()), label);
    } catch (error) {
      fail(error);
    }
  }

  function categorySelect(value, onPick) {
    const select = uiEl("select", {
      class: "ui-select",
      title: strings.dictionary.category,
      on: { change: (event) => onPick(event.target.value) },
    });
    for (const category of project().categories) {
      select.append(uiEl("option", { value: category.id, text: category.name }));
    }
    select.value = value || "";
    return select;
  }

  async function removeType(type) {
    const agreed = await uiConfirm({
      title: strings.dictionary.removeTypeTitle,
      message: text("dictionary.removeTypeMessage", { code: type.code, name: type.name }),
      confirmLabel: strings.dialog.confirm,
    });
    if (!agreed) return;
    commit((current) => deleteType(current, type.id).project, strings.history.removeType);
  }

  async function removeCategory(category) {
    const agreed = await uiConfirm({
      title: strings.dictionary.removeCategoryTitle,
      message: text("dictionary.removeCategoryMessage", { name: category.name }),
      confirmLabel: strings.dialog.confirm,
    });
    if (!agreed) return;
    commit((current) => deleteCategory(current, category.id).project, strings.history.removeCategory);
  }

  function typeRow(type, count) {
    const category = findCategory(project(), type.categoryId);
    const style = styleOf(project(), type.id);
    // Невозможное действие видно невозможным: тип с метками не удаляется,
    // и кнопка об этом говорит до нажатия, а не после.
    const removeButton = uiButton("🗑", {
      class: "ui-btn ui-btn--danger",
      title: count > 0 ? text("errors.typeHasMarks", { code: type.code, count }) : strings.dictionary.removeType,
      on: { click: () => removeType(type) },
    });
    removeButton.disabled = count > 0;
    return uiEl("div", { class: "dict__row" }, [
      shapeIcon(style.shape, style.color, 20),
      uiEl("input", {
        class: "ui-input dict__code",
        type: "text",
        value: type.code,
        title: strings.dictionary.code,
        attrs: { maxlength: "2" },
        on: {
          change: (event) =>
            commit((current) => updateType(current, type.id, { code: event.target.value }).project, strings.history.editType),
        },
      }),
      uiEl("input", {
        class: "ui-input",
        type: "text",
        value: type.name,
        title: strings.dictionary.name,
        on: {
          change: (event) =>
            commit((current) => updateType(current, type.id, { name: event.target.value }).project, strings.history.editType),
        },
      }),
      categorySelect(type.categoryId, (categoryId) =>
        commit((current) => updateType(current, type.id, { categoryId }).project, strings.history.editType),
      ),
      typesShapeButton({
        shape: type.shape,
        color: category ? category.color : "#57606A",
        allowInherit: true,
        inheritShape: category ? category.shape : SHAPE_PALETTE[0],
        onPick: (shape) =>
          commit((current) => updateType(current, type.id, { shape }).project, strings.history.editType),
      }),
      uiEl("span", { class: "dict__count", text: String(count), title: strings.dictionary.marks }),
      removeButton,
    ]);
  }

  function categoryRow(category) {
    const types = project().markTypes.filter((type) => type.categoryId === category.id).length;
    const removeButton = uiButton("🗑", {
      class: "ui-btn ui-btn--danger",
      title: types > 0 ? strings.errors.categoryHasTypes : strings.dictionary.removeCategory,
      on: { click: () => removeCategory(category) },
    });
    removeButton.disabled = types > 0;
    return uiEl("div", { class: "dict__row" }, [
      uiEl("input", {
        class: "dict__color",
        type: "color",
        value: category.color,
        title: strings.dictionary.color,
        on: {
          change: (event) =>
            commit(
              (current) => updateCategory(current, category.id, { color: event.target.value }).project,
              strings.history.editCategory,
            ),
        },
      }),
      uiEl("input", {
        class: "ui-input",
        type: "text",
        value: category.name,
        title: strings.dictionary.name,
        on: {
          change: (event) =>
            commit(
              (current) => updateCategory(current, category.id, { name: event.target.value }).project,
              strings.history.editCategory,
            ),
        },
      }),
      typesShapeButton({
        shape: category.shape,
        color: category.color,
        allowInherit: false,
        onPick: (shape) =>
          commit((current) => updateCategory(current, category.id, { shape }).project, strings.history.editCategory),
      }),
      removeButton,
    ]);
  }

  function addTypeRow() {
    const code = uiEl("input", {
      class: "ui-input dict__code",
      type: "text",
      placeholder: strings.dictionary.codePlaceholder,
      attrs: { maxlength: "2" },
    });
    const name = uiEl("input", {
      class: "ui-input",
      type: "text",
      placeholder: strings.dictionary.typeNamePlaceholder,
    });
    let categoryId = project().categories.length > 0 ? project().categories[0].id : "";
    const add = () =>
      commit(
        (current) => addType(current, { code: code.value, name: name.value, categoryId }).project,
        strings.history.addType,
      );
    return uiEl("div", { class: "dict__row dict__row--add" }, [
      code,
      name,
      categorySelect(categoryId, (value) => {
        categoryId = value;
      }),
      uiButton(strings.dictionary.addType, { class: "ui-btn ui-btn--accent", on: { click: add } }),
    ]);
  }

  function addCategoryRow() {
    const name = uiEl("input", {
      class: "ui-input",
      type: "text",
      placeholder: strings.dictionary.categoryNamePlaceholder,
    });
    const color = uiEl("input", { class: "dict__color", type: "color", value: "#57606A" });
    let shape = SHAPE_PALETTE[0];
    const shapeButton = typesShapeButton({
      shape,
      color: color.value,
      allowInherit: false,
      onPick: (picked) => {
        shape = picked || SHAPE_PALETTE[0];
        shapeButton.replaceChildren(shapeIcon(shape, color.value, 26));
      },
    });
    const add = () =>
      commit(
        (current) => addCategory(current, { name: name.value, color: color.value, shape }).project,
        strings.history.addCategory,
      );
    return uiEl("div", { class: "dict__row dict__row--add" }, [
      color,
      name,
      shapeButton,
      uiButton(strings.dictionary.addCategory, { class: "ui-btn ui-btn--accent", on: { click: add } }),
    ]);
  }

  function render() {
    const current = project();
    if (!current) {
      body.replaceChildren();
      return;
    }
    const counts = new Map();
    for (const mark of current.marks) counts.set(mark.typeId, (counts.get(mark.typeId) || 0) + 1);
    const typeRows = [];
    const shown = new Set();
    for (const { category, types } of typesInOrder(current)) {
      typeRows.push(uiEl("p", { class: "dict__group", text: category.name }));
      for (const type of types) {
        shown.add(type.id);
        typeRows.push(typeRow(type, counts.get(type.id) || 0));
      }
    }
    for (const type of current.markTypes) {
      if (!shown.has(type.id)) typeRows.push(typeRow(type, counts.get(type.id) || 0));
    }
    if (typeRows.length === 0) typeRows.push(uiEl("p", { class: "panel__empty", text: strings.dictionary.noTypes }));

    body.replaceChildren(
      uiEl("h4", { class: "dict__title", text: strings.dictionary.categories }),
      ...current.categories.map((category) => categoryRow(category)),
      addCategoryRow(),
      uiEl("h4", { class: "dict__title", text: strings.dictionary.types }),
      ...typeRows,
      addTypeRow(),
    );
  }

  render();
  // Окно живёт, пока его не закрыли, и показывает объект таким, какой он сейчас:
  // отмена чужого действия обновляет список, а не оставляет вчерашний.
  const unsubscribe = api.subscribe((state, changed) => {
    if ("project" in changed) render();
  });
  const modal = uiModal({
    title: strings.dictionary.title,
    body,
    actions: [uiButton(strings.dialog.close, { on: { click: () => close() } })],
    onCancel: () => unsubscribe(),
  });
  function close() {
    unsubscribe();
    modal.close();
  }
  return { close };
}

function mountTypesPanel(host, api) {
  const { getState, notify, subscribe } = api;

  const dictionaryButton = uiButton(strings.dictionary.open, {
    class: "ui-btn ui-btn--wide",
    on: { click: () => openTypesDictionary(api) },
  });
  const roomsButton = uiButton(strings.rooms.open, {
    class: "ui-btn ui-btn--wide",
    on: { click: () => openRoomsEditor(api) },
  });
  const saveButton = uiButton(strings.dictionary.saveTemplate, {
    class: "ui-btn ui-btn--wide",
    title: strings.dictionary.saveTemplateHint,
    on: { click: () => saveTemplate() },
  });
  const resetButton = uiButton(strings.dictionary.resetTemplate, {
    class: "ui-btn ui-btn--wide",
    on: { click: () => resetTemplate() },
  });
  // Кнопка возврата показывается, только когда шаблон и правда сохранён.
  resetButton.hidden = true;
  host.replaceChildren(uiEl("div", { class: "dict-panel" }, [dictionaryButton, roomsButton, saveButton, resetButton]));

  async function saveTemplate() {
    const state = getState();
    if (!state.project) return;
    await setSetting(TYPE_TEMPLATE_KEY, typesSnapshot(state.project));
    notify(strings.dictionary.templateSaved, "success");
    syncButtons();
  }

  async function resetTemplate() {
    await setSetting(TYPE_TEMPLATE_KEY, null);
    notify(strings.dictionary.templateReset, "success");
    syncButtons();
  }

  async function syncButtons() {
    const template = await getSetting(TYPE_TEMPLATE_KEY);
    resetButton.hidden = !template;
    const state = getState();
    dictionaryButton.disabled = !state.project;
    saveButton.disabled = !state.project;
  }

  subscribe((state, changed) => {
    if ("project" in changed) syncButtons();
  });
  syncButtons();
}

registerPanel(PANEL_IDS.properties, mountTypesPanel);
