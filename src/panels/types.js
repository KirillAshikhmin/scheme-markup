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
  CODE_MAX_LENGTH,
  BLOCK_MODES,
  SHAPE_NAMES,
  SHAPE_PALETTE,
  addCategory,
  addType,
  compactNumbers,
  deleteCategory,
  deleteType,
  findCategory,
  findMark,
  colorsInUse,
  findType,
  freeColor,
  styleOf,
  typesInOrder,
  updateCategory,
  updateType,
} from "../model.js";
import { shapeIcon } from "../render.js";
import { canvasCommit } from "../canvas.js";
import { colorPickerButton } from "./colorPicker.js";
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

// Предпросмотр уплотнения: строка на обозначение, а не на метку. И старый
// номер, и новый берутся из ответа `compactNumbers` — своей нумерации у панели
// нет, иначе окно обещало бы одно, а команда делала другое. `count` показывает
// намеренный повтор: две метки Т1 останутся двумя Т1, и это видно до нажатия.
// Строки идут по новому номеру: так виден будущий ряд, а не прошлый.
export function typesCompactPreview(project, typeId) {
  const type = findType(project, typeId);
  if (!type) return { code: "", rows: [], changes: [] };
  const result = compactNumbers(project, typeId);
  const rows = new Map();
  for (const mark of project.marks) {
    if (mark.typeId !== typeId) continue;
    const after = findMark(result.project, mark.id);
    const to = after ? after.number : mark.number;
    let row = rows.get(mark.number);
    if (!row) {
      row = { from: mark.number, to, fromLabel: type.code + mark.number, toLabel: type.code + to, count: 0 };
      rows.set(mark.number, row);
    }
    row.count += 1;
  }
  return {
    code: type.code,
    rows: [...rows.values()].sort((a, b) => (a.to === b.to ? a.from - b.from : a.to - b.to)),
    changes: result.changes,
  };
}

// Подпись списка замен: по ней окно и применение договариваются, что речь об
// одном и том же. Сравниваются обозначения и число меток за каждым — ровно то,
// что пользователь видел и одобрил; правка, не трогающая номера, подпись не
// меняет и переспрашивать не заставляет.
export function typesCompactSignature(preview) {
  return [preview.code, ...preview.rows.map((row) => row.from + ">" + row.to + "*" + row.count)].join("|");
}

// Уплотнение разрушающее (ADR 003): после него распечатка на руках у монтажника
// начинает врать. Поэтому окно показывает замены целиком и говорит о цене —
// подтверждение здесь не украшение, а часть команды.
function openTypesCompactPreview(preview, { stale } = {}) {
  return new Promise((resolve) => {
    let modal;
    const done = (value) => {
      modal.close();
      resolve(value);
    };
    const rows = preview.rows.map((row) =>
      uiEl("div", { class: "compact__row" + (row.from === row.to ? " is-same" : "") }, [
        uiEl("span", { class: "compact__label", text: row.fromLabel }),
        uiEl("span", { class: "compact__arrow", text: "→" }),
        uiEl("span", { class: "compact__label", text: row.toLabel }),
        row.count > 1
          ? uiEl("span", { class: "compact__repeat", text: text("dictionary.compactRepeat", { count: row.count }) })
          : null,
      ]),
    );
    modal = uiModal({
      title: text("dictionary.compactTitle", { code: preview.code }),
      body: uiEl("div", { class: "compact" }, [
        stale ? uiEl("p", { class: "compact__warning", text: strings.dictionary.compactStale }) : null,
        uiEl("p", { class: "modal__text", text: text("dictionary.compactSummary", { count: preview.changes.length }) }),
        uiEl("div", { class: "compact__rows" }, rows),
        uiEl("p", { class: "compact__warning", text: strings.dictionary.compactWarning }),
      ]),
      actions: [
        uiButton(strings.dialog.cancel, { on: { click: () => done(false) } }),
        uiButton(strings.dictionary.compactApply, {
          class: "ui-btn ui-btn--danger",
          on: { click: () => done(true) },
        }),
      ],
      onCancel: () => resolve(false),
    });
  });
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

  // Уплотнение — по одному типу, как просил заказчик: тип назван явно, строкой
  // справочника, а не «весь объект разом».
  async function compactType(type) {
    let preview = typesCompactPreview(project(), type.id);
    let stale = false;
    // Пока окно висит открытым, объект могли поменять — поставить метку, вернуть
    // номера чужим Ctrl+Z. Применяем по свежему объекту (иначе уплотняли бы
    // вчерашнее состояние), но молча подменить одобренный список нельзя: если
    // замены разошлись, показываем новые и спрашиваем заново.
    for (;;) {
      if (preview.changes.length === 0) {
        api.notify(text("dictionary.compactNothing", { code: type.code }), "info");
        return;
      }
      const agreed = await openTypesCompactPreview(preview, { stale });
      if (!agreed) return;
      const fresh = typesCompactPreview(project(), type.id);
      if (typesCompactSignature(fresh) === typesCompactSignature(preview)) {
        commit((current) => compactNumbers(current, type.id).project, strings.history.compact);
        return;
      }
      preview = fresh;
      stale = true;
    }
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
    // Уплотнение живёт в строке типа: тип назван, и рядом видно, скольких меток
    // команда коснётся.
    const compactButton = uiButton("№", {
      class: "ui-btn",
      title:
        count > 0
          ? text("dictionary.compactHint", { code: type.code })
          : text("dictionary.compactEmpty", { code: type.code }),
      on: { click: () => compactType(type) },
    });
    compactButton.disabled = count === 0;
    return uiEl("div", { class: "dict__row" }, [
      shapeIcon(style.shape, style.color, 20),
      uiEl("input", {
        class: "ui-input dict__code",
        type: "text",
        value: type.code,
        title: strings.dictionary.code,
        attrs: { maxlength: String(CODE_MAX_LENGTH) },
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
      compactButton,
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
      colorPickerButton({
        value: category.color,
        used: colorsInUse(project(), { exceptCategoryId: category.id }),
        title: strings.dictionary.color,
        onPick: (color) =>
          commit(
            (current) => updateCategory(current, category.id, { color }).project,
            strings.history.editCategory,
          ),
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
      attrs: { maxlength: String(CODE_MAX_LENGTH) },
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
    // Цвет новой категории — незанятый цвет палитры: метки новой категории
    // должны быть видны отдельно и от соседних меток, и от заливки помещений.
    const busy = colorsInUse(project());
    let color = freeColor(busy);
    let shape = SHAPE_PALETTE[0];
    const colorButton = colorPickerButton({
      value: color,
      used: busy,
      title: strings.dictionary.color,
      onPick: (picked) => {
        color = picked;
        shapeButton.replaceChildren(shapeIcon(shape, color, 26));
      },
    });
    const shapeButton = typesShapeButton({
      shape,
      color,
      allowInherit: false,
      onPick: (picked) => {
        shape = picked || SHAPE_PALETTE[0];
        shapeButton.replaceChildren(shapeIcon(shape, color, 26));
      },
    });
    const add = () =>
      commit(
        (current) => addCategory(current, { name: name.value, color, shape }).project,
        strings.history.addCategory,
      );
    return uiEl("div", { class: "dict__row dict__row--add" }, [
      colorButton,
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
