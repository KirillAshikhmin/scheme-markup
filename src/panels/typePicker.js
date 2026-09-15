// Своё окно выбора типа метки: «буква — пояснение», группировка по цветным
// категориям, поиск и ввод нового кода прямо здесь.
//
// Окно открывается один раз на серию: выбранный тип «залипает» в панели
// инструментов, и дальше метки ставятся кликами без единого диалога.
import { strings, text } from "../strings.js";
import { uiEl, uiButton, uiModal } from "./ui.js";
import { addType, styleOf, typesInOrder } from "../model.js";
import { drawShape } from "../render.js";

const PICKER_CODE_RE = /^[A-Za-zА-Яа-яЁё]{1,2}$/u;

// Значок типа — та же функция рисования, что на холсте: в списке видно
// и цвет категории, и форму.
export function typeSwatch(project, typeId, size = 22) {
  const canvas = uiEl("canvas", { class: "picker__swatch" });
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext ? canvas.getContext("2d") : null;
  if (ctx) {
    const style = styleOf(project, typeId);
    drawShape(ctx, style.shape, size / 2, size / 2, size * 0.36, style.color);
  }
  return canvas;
}

function pickerExact(type, query) {
  return type && query && type.code.toUpperCase() === query.toUpperCase() ? 1 : 0;
}

function pickerMatches(type, query) {
  if (!query) return true;
  const needle = query.toLowerCase();
  return type.code.toLowerCase().startsWith(needle) || type.name.toLowerCase().includes(needle);
}

export function openTypePicker(project, options = {}) {
  return new Promise((resolve) => {
    let modal;
    let current = project;
    const done = (result) => {
      modal.close();
      resolve(result || null);
    };

    const list = uiEl("div", { class: "picker__list" });
    const error = uiEl("p", { class: "picker__error" });
    const createBox = uiEl("div", { class: "picker__create" });
    const search = uiEl("input", {
      class: "ui-input",
      type: "text",
      placeholder: strings.picker.search,
      on: {
        input: () => renderList(),
        keydown: (event) => {
          if (event.key !== "Enter") return;
          event.preventDefault();
          const first = list.querySelector(".picker__row");
          if (first) first.click();
          else if (createBox.firstChild) createType();
        },
      },
    });

    let createName = null;
    let createCategory = null;

    function createType() {
      const code = search.value.trim();
      if (!createName || !createCategory) return;
      try {
        const result = addType(current, {
          code,
          name: createName.value.trim() || code,
          categoryId: createCategory.value,
        });
        done({ typeId: result.type.id, project: result.project, created: true });
      } catch (failure) {
        error.textContent = failure.message;
      }
    }

    function renderCreate(query) {
      createBox.replaceChildren();
      error.textContent = "";
      if (!PICKER_CODE_RE.test(query)) return;
      const taken = current.markTypes.some((type) => type.code.toUpperCase() === query.toUpperCase());
      if (taken) return;
      createName = uiEl("input", {
        class: "ui-input",
        type: "text",
        placeholder: strings.picker.createNamePlaceholder,
      });
      createCategory = uiEl(
        "select",
        { class: "ui-select" },
        current.categories.map((category) =>
          uiEl("option", { text: category.name, value: category.id, attrs: { value: category.id } }),
        ),
      );
      createBox.append(
        uiEl("p", { class: "picker__createTitle", text: text("picker.createTitle", { code: query }) }),
        uiEl("p", { class: "picker__createTitle", text: strings.picker.codeHint }),
        uiEl("label", { class: "picker__field" }, [
          uiEl("span", { text: strings.picker.createName }),
          createName,
        ]),
        uiEl("label", { class: "picker__field" }, [
          uiEl("span", { text: strings.picker.createCategory }),
          createCategory,
        ]),
        uiButton(strings.picker.create, {
          class: "ui-btn ui-btn--accent",
          on: { click: createType },
        }),
      );
    }

    function renderList() {
      const query = search.value.trim();
      list.replaceChildren();
      let shown = 0;
      // Точное совпадение по коду — первым: «Р» это Розетка, а не «Подсветка
      // кровати», где та же буква стоит в середине названия.
      const groups = typesInOrder(current).map((group) => ({
        category: group.category,
        types: group.types.slice().sort((a, b) => pickerExact(b, query) - pickerExact(a, query)),
      }));
      groups.sort((a, b) => pickerExact(b.types[0], query) - pickerExact(a.types[0], query));
      for (const group of groups) {
        const rows = group.types.filter((type) => pickerMatches(type, query));
        if (rows.length === 0) continue;
        shown += rows.length;
        const head = uiEl("div", { class: "picker__group", text: group.category.name });
        head.style.borderColor = group.category.color;
        head.style.color = group.category.color;
        list.append(head);
        for (const type of rows) {
          const row = uiEl(
            "button",
            {
              class: "picker__row" + (type.id === options.activeTypeId ? " is-active" : ""),
              type: "button",
              on: { click: () => done({ typeId: type.id, project: current }) },
            },
            [
              typeSwatch(current, type.id),
              uiEl("span", { class: "picker__code", text: type.code }),
              uiEl("span", { class: "picker__name", text: type.name }),
            ],
          );
          list.append(row);
        }
      }
      if (shown === 0) list.append(uiEl("p", { class: "panel__empty", text: strings.picker.empty }));
      renderCreate(query);
    }

    renderList();
    modal = uiModal({
      title: options.title || strings.picker.title,
      body: uiEl("div", { class: "picker" }, [search, list, createBox, error]),
      actions: [uiButton(strings.dialog.cancel, { on: { click: () => done(null) } })],
      onCancel: () => resolve(null),
    });
    search.focus();
  });
}
