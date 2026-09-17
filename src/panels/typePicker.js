// Своё окно выбора типа метки: «буква — пояснение», поиск и ввод нового кода
// прямо здесь.
//
// Категории стоят колонками рядом — «Свет», «Выключатели», «Розетки» и так
// далее, — а не одним длинным столбцом: окно открывается десятки раз за сеанс,
// и цель — попасть в нужный тип одним взглядом и одним кликом, без листания.
// В одной колонке категорий бывает несколько: короткие «Розетки» и «Климат»
// встают друг под друга, а не держат каждая свою пустую колонку до низа окна.
// Раскладку считает `pickerLayout`, ширину окна задаёт число получившихся
// колонок (`--picker-columns`) — справа не остаётся пустого поля, и колонки не
// растягиваются, когда поиск оставил одну.
//
// Окно открывается один раз на серию: выбранный тип «залипает» в панели
// инструментов, и дальше метки ставятся кликами без единого диалога.
import { strings, text } from "../strings.js";
import { uiEl, uiButton, uiModal } from "./ui.js";
import {
  addType,
  codeProblem,
  matchTypeExactly,
  searchTypes,
  styleOf,
  typeKindOf,
  CODE_MAX_LENGTH,
} from "../model.js";
import { shapeIcon } from "../render.js";

// Значок типа — цвет категории и форма из справочника, нарисованные общим
// `render.shapeIcon`: в списке видно ровно то, что попадёт на план.
function pickerIcon(project, typeId, size = 22) {
  const style = styleOf(project, typeId);
  return shapeIcon(style.shape, style.color, size);
}

// Больше шести колонок в ряд не ставим: седьмая ужимает остальные до каши.
// Лишние категории уходят не во второй ряд, а вниз по колонкам — вторым рядом
// сетка выравнивала всё по самой высокой категории и оставляла посреди окна
// пустое поле.
const PICKER_MAX_COLUMNS = 6;

// Меры окна, по которым считается, сколько колонок в него влезет. Те же числа
// стоят в `typePicker.css`: ширина колонки (`minmax(150px, 1fr)`), просвет
// между колонками (`gap`), доля экрана под карточку (`max-width: 96vw`) и её
// собственные поля с рамкой (`.modal`: по 18px с каждой стороны плюс рамка,
// здесь с запасом до 40). Считать нужно
// всё это вместе: колонка, которая «почти влезла», даёт горизонтальную
// прокрутку — а на узком экране колонок должно становиться меньше, только и
// всего.
const PICKER_COLUMN_MIN = 150;
const PICKER_COLUMN_GAP = 14;
const PICKER_MODAL_SHARE = 0.96;
const PICKER_MODAL_CHROME = 40;

// Сколько колонок помещается в экран шириной `width`.
export function pickerColumnLimit(width) {
  const usable = Math.max(0, Number(width) || 0) * PICKER_MODAL_SHARE - PICKER_MODAL_CHROME;
  const fits = Math.floor((usable + PICKER_COLUMN_GAP) / (PICKER_COLUMN_MIN + PICKER_COLUMN_GAP));
  return Math.max(1, Math.min(PICKER_MAX_COLUMNS, fits));
}

// Высота категории в строках: заголовок плюс её типы. Точные пиксели здесь не
// нужны — раскладка решает, что с чем встанет в одну колонку, а не рисует.
function pickerWeight(group) {
  return 1 + (group && Array.isArray(group.types) ? group.types.length : 0);
}

// Категории кладутся в колонку подряд, пока та не станет выше `height`.
// Порядок справочника сохраняется: колонка читается сверху вниз, колонки —
// слева направо, «Свет» по-прежнему первый, «Щит» последний.
function pickerFill(groups, height) {
  const columns = [];
  let filled = 0;
  for (const group of groups) {
    const weight = pickerWeight(group);
    if (columns.length > 0 && filled + weight <= height) {
      columns[columns.length - 1].push(group);
      filled += weight;
      continue;
    }
    columns.push([group]);
    filled = weight;
  }
  return columns;
}

// Раскладка категорий по колонкам. Сетка выравнивала ряд по самой высокой
// категории: «Свет» с девятью типами держал всю первую строку, и «Щит» с
// «Датчиками» начинались только под ним — между выключателями и датчиками
// зияла пустая половина окна. Здесь колонка набивается подряд до высоты самой
// длинной категории: пустых мест между категориями не остаётся, а колонок
// выходит ровно столько, сколько понадобилось, — не больше `limit`.
export function pickerLayout(groups, limit = PICKER_MAX_COLUMNS) {
  const list = Array.isArray(groups) ? groups.filter(Boolean) : [];
  if (list.length === 0) return [];
  const cap = Math.max(1, Math.floor(Number(limit)) || 1);
  const total = list.reduce((sum, group) => sum + pickerWeight(group), 0);
  let height = Math.max(...list.map(pickerWeight));
  let columns = pickerFill(list, height);
  // Категорий больше, чем колонок помещается в окно, — колонка становится
  // выше, и лишние уходят под соседние, а не за край экрана.
  while (columns.length > cap && height < total) {
    height += 1;
    columns = pickerFill(list, height);
  }
  return columns;
}

// Клавиатура по сетке: вверх-вниз — по колонке целиком, через границы
// категорий, если их в колонке несколько; вправо-влево — в соседнюю колонку на
// ту же строку (короткая колонка прижимает к последней строке).
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

// Смена типа у метки идёт внутри её вида: линии — линейные типы, точке —
// точечные. Окно получает вид в `options.kind` и оставляет только свои типы;
// постановка новой метки вид не задаёт и видит справочник целиком.
//
// Вид спрашивается у `typeKindOf`, а не у `type.kind`: у объекта прежнего
// формата поля нет вовсе. Категория, в которой не осталось ни одного типа
// нужного вида, из окна уходит — пустой заголовок держал бы колонку зря.
export function pickerGroupsOfKind(project, groups, kind) {
  if (kind !== "point" && kind !== "line") return groups;
  return groups
    .map((group) => ({ ...group, types: group.types.filter((type) => typeKindOf(project, type.id) === kind) }))
    .filter((group) => group.types.length > 0);
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
          // Окно сужено до вида метки — заведённый здесь тип обязан быть того
          // же вида, иначе его нечем будет выбрать в этом же окне.
          ...(options.kind ? { kind: options.kind } : {}),
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

    // Категория — заголовок в её цвете и строки типов. Блок целиком, потому
    // что в колонке их бывает несколько: заголовок должен липнуть к своим
    // строкам и уезжать вместе с ними, а не наезжать на соседнюю категорию.
    function categoryBlock(group) {
      const head = uiEl("div", { class: "picker__group", text: group.category.name });
      head.style.borderColor = group.category.color;
      head.style.color = group.category.color;
      return uiEl("div", { class: "picker__category" }, [head, ...group.types.map(typeRow)]);
    }

    function renderList() {
      const query = search.value.trim();
      // Что за чем показывать, решает модель: поиск по коду и названию,
      // точное совпадение кода первым. Своей сортировки здесь нет.
      const groups = pickerGroupsOfKind(current, searchTypes(current, query), options.kind);
      const width = typeof window === "undefined" ? 0 : window.innerWidth;
      const columns = pickerLayout(groups, pickerColumnLimit(width));
      box.replaceChildren(
        ...columns.map((column) => uiEl("div", { class: "picker__column" }, column.map(categoryBlock))),
      );
      if (groups.length === 0) box.append(uiEl("p", { class: "panel__empty", text: strings.picker.empty }));
      // Ширину окна задаёт число колонок: уместились семь категорий в четыре —
      // окно на четыре колонки и никакого пустого поля справа, одна найденная
      // категория — узкое окно.
      body.style.setProperty("--picker-columns", String(Math.max(columns.length, 1)));
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
    const note =
      options.kind === "line" || options.kind === "point"
        ? uiEl("p", {
            class: "picker__note",
            text: options.kind === "line" ? strings.picker.onlyLine : strings.picker.onlyPoint,
          })
        : null;
    body.replaceChildren(...[search, note, box, createBox, error].filter(Boolean));
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
