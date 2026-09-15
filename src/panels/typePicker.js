// Своё окно выбора типа метки: «буква — пояснение», поиск и ввод нового кода
// прямо здесь.
//
// Категории стоят колонками рядом — «Свет», «Выключатели», «Розетки» и так
// далее, — а не одним длинным столбцом: окно открывается десятки раз за сеанс,
// и цель — попасть в нужный тип одним взглядом и одним кликом, без листания.
// Ширину окна задаёт число колонок (`--picker-columns`), поэтому справа не
// остаётся пустого поля, а колонки не растягиваются, когда поиск оставил одну.
// Колонок больше шести — переносятся во второй ряд и прокручиваются по
// вертикали; горизонтальная прокрутка остаётся на крайний случай узкого окна.
//
// Окно открывается один раз на серию: выбранный тип «залипает» в панели
// инструментов, и дальше метки ставятся кликами без единого диалога.
import { strings, text } from "../strings.js";
import { uiEl, uiButton, uiModal } from "./ui.js";
import { addType, codeProblem, matchTypeExactly, searchTypes, styleOf, CODE_MAX_LENGTH } from "../model.js";
import { shapeIcon } from "../render.js";

// Значок типа — цвет категории и форма из справочника, нарисованные общим
// `render.shapeIcon`: в списке видно ровно то, что попадёт на план.
function pickerIcon(project, typeId, size = 22) {
  const style = styleOf(project, typeId);
  return shapeIcon(style.shape, style.color, size);
}

// Больше шести колонок в ряд не ставим: седьмая ужимает остальные до каши.
// Лишние переносятся во второй ряд — вертикальная прокрутка удобнее
// горизонтальной, когда справочник разросся.
const PICKER_MAX_COLUMNS = 6;

// Клавиатура по сетке: вверх-вниз — по колонке, вправо-влево — в соседнюю
// колонку на ту же строку (короткая колонка прижимает к последней строке).
function pickerMove(box, row, dx, dy) {
  const columns = [...box.children].filter((node) => node.classList.contains("picker__column"));
  const rowsOf = (node) => [...node.querySelectorAll(".picker__row")];
  const column = columns.findIndex((node) => node.contains(row));
  if (column < 0) return;
  const index = rowsOf(columns[column]).indexOf(row);
  const rows = rowsOf(columns[Math.min(columns.length - 1, Math.max(0, column + dx))]);
  const next = rows[Math.min(rows.length - 1, Math.max(0, index + dy))];
  if (next) next.focus();
}

export function openTypePicker(project, options = {}) {
  return new Promise((resolve) => {
    let modal;
    let current = project;
    const done = (result) => {
      modal.close();
      resolve(result || null);
    };

    const box = uiEl("div", { class: "picker__columns" });
    const body = uiEl("div", { class: "picker picker--types" });
    const error = uiEl("p", { class: "picker__error" });
    const createBox = uiEl("div", { class: "picker__create" });
    const search = uiEl("input", {
      class: "ui-input",
      type: "text",
      placeholder: strings.picker.search,
      on: {
        input: () => renderList(),
        keydown: (event) => {
          // Стрелка вниз из поиска — в первую строку сетки: дальше по ней
          // ходят стрелками, не хватаясь за мышь.
          if (event.key === "ArrowDown") {
            const first = box.querySelector(".picker__row");
            if (!first) return;
            event.preventDefault();
            first.focus();
            return;
          }
          if (event.key !== "Enter") return;
          event.preventDefault();
          const first = box.querySelector(".picker__row");
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
      // Годится ли код — знает модель, и только она: буквы, длина и занятость
      // проверяются там же, где их проверит `addType`. Своей копии правила
      // здесь нет намеренно — прежняя пережила снятие предела в две буквы и
      // отказывалась заводить «ПОДСВЕТКА».
      // Тип с таким названием или кодом уже есть — второй такой же заводить
      // незачем: он стоит первым в списке, и Enter берёт именно его.
      if (matchTypeExactly(current, query)) return;
      if (codeProblem(current, query)) return;
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
        uiEl("p", { class: "picker__createTitle", text: text("picker.codeHint", { max: CODE_MAX_LENGTH }) }),
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

    function typeRow(type) {
      const row = uiEl(
        "button",
        {
          class: "picker__row" + (type.id === options.activeTypeId ? " is-active" : ""),
          type: "button",
          // Длинный код не даёт названию места, и оно ужимается многоточием —
          // подсказка возвращает его целиком.
          title: type.code + " — " + type.name,
          on: { click: () => done({ typeId: type.id, project: current }) },
        },
        [
          pickerIcon(current, type.id),
          uiEl("span", { class: "picker__code", text: type.code }),
          uiEl("span", { class: "picker__name", text: type.name }),
        ],
      );
      return row;
    }

    function renderList() {
      const query = search.value.trim();
      // Что за чем показывать, решает модель: поиск по коду и названию,
      // точное совпадение кода первым. Своей сортировки здесь нет.
      const groups = searchTypes(current, query);
      box.replaceChildren(
        ...groups.map((group) => {
          const head = uiEl("div", { class: "picker__group", text: group.category.name });
          head.style.borderColor = group.category.color;
          head.style.color = group.category.color;
          return uiEl("div", { class: "picker__column" }, [head, ...group.types.map(typeRow)]);
        }),
      );
      if (groups.length === 0) box.append(uiEl("p", { class: "panel__empty", text: strings.picker.empty }));
      // Ширину окна задаёт число колонок: пять категорий — пять колонок и
      // никакого пустого поля справа, одна найденная — узкое окно.
      body.style.setProperty("--picker-columns", String(Math.min(Math.max(groups.length, 1), PICKER_MAX_COLUMNS)));
      renderCreate(query);
    }

    // Клавиатура по сетке. Enter здесь обязателен свой: основное действие
    // диалога — «Отмена», и оно сработало бы раньше, чем браузер превратит
    // Enter в клик по строке, — то есть выбор терялся бы.
    box.addEventListener("keydown", (event) => {
      const row = event.target;
      if (!row || !row.classList || !row.classList.contains("picker__row")) return;
      if (event.key === "Enter") {
        event.preventDefault();
        row.click();
        return;
      }
      const step = { ArrowDown: [0, 1], ArrowUp: [0, -1], ArrowRight: [1, 0], ArrowLeft: [-1, 0] }[event.key];
      if (!step) return;
      event.preventDefault();
      pickerMove(box, row, step[0], step[1]);
    });

    renderList();
    body.replaceChildren(search, box, createBox, error);
    modal = uiModal({
      title: options.title || strings.picker.title,
      body,
      actions: [uiButton(strings.dialog.cancel, { on: { click: () => done(null) } })],
      onCancel: () => resolve(null),
    });
    // Широкая карточка — только у этого окна: ширину внутри задаёт сетка колонок.
    if (modal.card) modal.card.classList.add("modal--wide");
    search.focus();
  });
}
