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
  LINE_STYLES,
  MARK_KINDS,
  SHAPE_NAMES,
  SHAPE_PALETTE,
  addCategory,
  addType,
  addTypesFromCatalog,
  catalogOffer,
  categoryNameKey,
  compactNumbers,
  deleteCategory,
  deleteType,
  findCategory,
  findMark,
  colorsInUse,
  findType,
  freeColor,
  styleOf,
  typeKindOf,
  typesInOrder,
  updateCategory,
  updateType,
} from "../model.js";
import { lineStyleIcon, shapeIcon } from "../render.js";
import { canvasCommit } from "../canvas.js";
import { colorPickerButton } from "./colorPicker.js";
import { getSetting, setSetting } from "../store.js";
import { uiButton, uiConfirm, uiEl, uiIconButton, uiModal } from "./ui.js";
import { openEquipmentWindow } from "./equipment.js";

export const TYPE_TEMPLATE_KEY = "typeTemplate";
const TYPES_SWATCH_SIZE = 34;
// Цвет строки, у которой категории нет: справочник без категорий — это пустой
// справочник, но рисовать знак ему всё равно чем-то нужно.
const TYPES_NO_COLOR = "#57606A";

function typesSnapshot(project) {
  return {
    categories: project.categories.map((category) => ({
      id: category.id,
      name: category.name,
      color: category.color,
      shape: category.shape,
      lineStyle: category.lineStyle,
    })),
    markTypes: project.markTypes.map((type) => ({
      categoryId: type.categoryId,
      code: type.code,
      name: type.name,
      // Вид едет в шаблон вместе с типом: линейный тип, заведённый руками,
      // должен приезжать в новый объект линейным. Отметка `kindGuessed` —
      // нет: она про один объект и один список на правку.
      kind: typeKindOf(project, type.id),
      shape: type.shape,
      lineStyle: type.lineStyle,
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
  // «Та же категория» — правило модели (`categoryNameKey`), одно на всю сборку.
  // Снимок мог принести и «Датчики», и «датчики»: заведи их по отдельности —
  // и объект получил бы двойника той категории, в которую общая база кладёт
  // типы, а метки двух одноимённых категорий красились бы в разные цвета.
  const byName = new Map();
  const categories = [];
  for (const category of template.categories) {
    const twin = byName.get(categoryNameKey(category.name));
    if (twin) {
      ids.set(category.id, twin);
      continue;
    }
    const id = globalThis.crypto.randomUUID();
    ids.set(category.id, id);
    byName.set(categoryNameKey(category.name), id);
    categories.push({
      id,
      name: category.name,
      color: category.color,
      shape: SHAPE_NAMES.includes(category.shape) ? category.shape : SHAPE_NAMES[0],
      lineStyle: LINE_STYLES.includes(category.lineStyle) ? category.lineStyle : LINE_STYLES[0],
      order: categories.length,
    });
  }
  const markTypes = template.markTypes
    .filter((type) => ids.has(type.categoryId))
    .map((type, index) => ({
      id: globalThis.crypto.randomUUID(),
      categoryId: ids.get(type.categoryId),
      code: type.code,
      name: type.name,
      // Шаблон мог быть сохранён до того, как у типа появился вид: неизвестное
      // значение объект бы не принял, а пустое уехало бы в него как есть.
      kind: MARK_KINDS.includes(type.kind) ? type.kind : "point",
      shape: SHAPE_NAMES.includes(type.shape) ? type.shape : null,
      lineStyle: LINE_STYLES.includes(type.lineStyle) ? type.lineStyle : null,
      blockMode: BLOCK_MODES.includes(type.blockMode) ? type.blockMode : BLOCK_MODES[0],
      order: index,
    }));
  if (categories.length === 0 || markTypes.length === 0) return null;
  return { categories, markTypes };
}

// Название фигуры в строке наследования — со строчной буквы: оно продолжает
// фразу «как у категории», а не начинает свою.
function typesLowerName(name) {
  const value = String(name || "");
  return value ? value[0].toLowerCase() + value.slice(1) : value;
}

function typesShapeCell({ shape, color, active, inherit, onPick }) {
  // Клетка «как у категории» подписана прямо в сетке и занимает всю строку.
  // Пользователь: «И чем отличаются 2 первых линии?» — у категории со сплошной
  // линией и круглым знаком первые две клетки рисуют одно и то же, и одного
  // пунктирного контура вокруг мало: подсказка при наведении на этот вопрос не
  // ответила. Подпись называет и наследование, и то, что оно сейчас означает.
  const label = inherit ? text("dictionary.inheritShape", { name: typesLowerName(strings.shapes[shape] || shape) }) : null;
  return uiEl(
    "button",
    {
      class: "shapes__cell" + (active ? " is-active" : "") + (inherit ? " shapes__cell--inherit" : ""),
      type: "button",
      title: label || strings.shapes[shape] || shape,
      on: { click: onPick },
    },
    label
      ? [shapeIcon(shape, color, TYPES_SWATCH_SIZE), uiEl("span", { class: "shapes__caption", text: label })]
      : [shapeIcon(shape, color, TYPES_SWATCH_SIZE)],
  );
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
    // Ширину карточки задаёт сетка: общая мера диалогов рассчитана под окна с
    // текстом, и рядом с пятью колонками фигур оставалась пустой на треть.
    if (modal.card) modal.card.classList.add("modal--fit");
  });
}

// Размеры образца начертания: в сетке выбора и в строке справочника.
// Отрезок должен быть длиннее периода самой редкой волны, иначе в клетке
// видно полгорба и выбирать не из чего.
const TYPES_LINE_CELL = { size: 30, length: 140 };
const TYPES_LINE_BUTTON = { size: 26, length: 56 };
// Значок в начале строки справочника: у точечного типа фигура, у линейного —
// образец линии. Ширина у них общая и задана в CSS (`.dict__badge`), а холсту
// нужны свои числа: сплющить отрезок до ширины фигуры нельзя — точечную линию
// от штрихпунктирной в 26px не отличить. Поэтому образец рисуется во всю
// клетку, а фигура садится в клетку той же ширины по центру.
const TYPES_BADGE = { size: 20, length: 48 };

function typesLineCell({ lineStyle, color, active, inherit, onPick }) {
  // Та же подпись, что у сетки фигур: у категории со сплошной линией первая и
  // вторая клетки рисуют один и тот же отрезок, и пунктирной рамки мало.
  const label = inherit
    ? text("dictionary.inheritLine", { name: typesLowerName(strings.lineStyles[lineStyle] || lineStyle) })
    : null;
  return uiEl(
    "button",
    {
      class: "lines__cell" + (active ? " is-active" : "") + (inherit ? " lines__cell--inherit" : ""),
      type: "button",
      // Название — в подсказке, а не в клетке: выбирают по изображению.
      title: label || strings.lineStyles[lineStyle] || lineStyle,
      on: { click: onPick },
    },
    label
      ? [
          lineStyleIcon(lineStyle, color, TYPES_LINE_CELL.size, TYPES_LINE_CELL.length),
          uiEl("span", { class: "lines__caption", text: label }),
        ]
      : [lineStyleIcon(lineStyle, color, TYPES_LINE_CELL.size, TYPES_LINE_CELL.length)],
  );
}

// Выбор начертания — сетка нарисованных отрезков, ровно как сетка фигур:
// пользователь просил «в таком же окне как выбор иконки… а выбираем по их
// изображению». Слово «волнистая» в клетке ничего не добавляет к волне,
// которую видно.
export function openTypesLinePicker({ lineStyle, color, allowInherit, inheritLineStyle }) {
  return new Promise((resolve) => {
    let modal;
    const done = (result) => {
      modal.close();
      resolve(result);
    };
    const cells = [];
    if (allowInherit) {
      cells.push(
        typesLineCell({
          lineStyle: inheritLineStyle || LINE_STYLES[0],
          color,
          active: !lineStyle,
          inherit: true,
          onPick: () => done({ lineStyle: null }),
        }),
      );
    }
    for (const style of LINE_STYLES) {
      cells.push(
        typesLineCell({
          lineStyle: style,
          color,
          active: lineStyle === style,
          onPick: () => done({ lineStyle: style }),
        }),
      );
    }
    modal = uiModal({
      title: strings.lineStyles.title,
      body: uiEl("div", { class: "lines" }, cells),
      actions: [uiButton(strings.dialog.cancel, { on: { click: () => done(null) } })],
      onCancel: () => resolve(null),
    });
    // Та же мера, что у сетки фигур: ширину задаёт сетка, а не общая карточка.
    if (modal.card) modal.card.classList.add("modal--fit");
  });
}

// Начертание в строке справочника: кнопка с образцом, открывающая сетку.
// Раньше здесь стоял список названий — с волной и штрихпунктиром он врал бы
// сильнее, чем помогал: словом их не отличить, а рисунком отличают сразу.
function typesLineButton({ lineStyle, color, allowInherit, inheritLineStyle, onPick }) {
  const button = uiEl(
    "button",
    {
      class: "dict__line" + (allowInherit && !lineStyle ? " dict__line--inherit" : ""),
      type: "button",
      title: lineStyle
        ? strings.lineStyles[lineStyle] || lineStyle
        : allowInherit
          ? strings.lineStyles.inherit
          : strings.lineStyles.hint,
      on: {
        click: async () => {
          const picked = await openTypesLinePicker({ lineStyle, color, allowInherit, inheritLineStyle });
          if (picked) onPick(picked.lineStyle);
        },
      },
    },
    [
      lineStyleIcon(
        lineStyle || inheritLineStyle || LINE_STYLES[0],
        color,
        TYPES_LINE_BUTTON.size,
        TYPES_LINE_BUTTON.length,
      ),
    ],
  );
  return button;
}

// Вид типа — переключатель в строке: точка или линия. Две кнопки, а не список:
// значений всего два, и от выбранного зависит, что стоит рядом, — такое
// переключают одним кликом, а не раскрытием списка.
//
// `allowSame` нужен панели предупреждений: там переключателем отвечают на
// вопрос «вид выведен, так ли он?», и подтверждение того же вида — такой же
// ответ, как смена. В справочнике нажатие на уже выбранное по-прежнему
// ничего не делает: правки без изменения там не заводят шаг отмены.
export function typesKindSwitch({ kind, onPick, allowSame = false, sameTitle = "" }) {
  const cell = (value, label, hint) => {
    const same = kind === value;
    const button = uiButton(label, {
      class: "ui-btn dict__kindItem" + (same ? " is-active" : ""),
      title: same && allowSame && sameTitle ? sameTitle : hint,
      on: { click: () => (same && !allowSame ? null : onPick(value)) },
    });
    button.setAttribute("aria-pressed", kind === value ? "true" : "false");
    return button;
  };
  return uiEl("div", { class: "dict__kind", title: strings.dictionary.kind }, [
    cell("point", strings.dictionary.kindPoint, strings.dictionary.kindPointHint),
    cell("line", strings.dictionary.kindLine, strings.dictionary.kindLineHint),
  ]);
}

// Черновик строки добавления: вид и знак, выбранные до нажатия «Добавить тип».
// Поля названы как у `addType` — строка отдаёт их модели как есть, своего
// перевода между ними нет. Умолчание — точка со знаком категории: точечных
// типов в разы больше, а наследование знака и было прежним поведением нового
// типа, которому ничего не выбрали.
export function typesAddDraft(categoryId = "") {
  return { categoryId, kind: MARK_KINDS[0], shape: null, lineStyle: null };
}

// Смена вида ничего не стирает: знаки двух видов лежат в черновике порознь,
// и вернувшийся к «Точке» получает обратно свою фигуру. Так же устроен и
// заведённый тип — `updateType({kind})` не трогает ни `shape`, ни `lineStyle`;
// строка добавления не должна вести себя иначе, чем строка того же типа
// минутой позже.
export function typesDraftKind(draft, kind) {
  return MARK_KINDS.includes(kind) ? { ...draft, kind } : draft;
}

// Выбранный знак ложится в ячейку текущего вида: фигура у точечного,
// начертание у линейного. `null` — «как у категории».
export function typesDraftSign(draft, sign) {
  return draft.kind === "line" ? { ...draft, lineStyle: sign } : { ...draft, shape: sign };
}

// Чем новый тип встанет на план, пока его ещё нет. `styleOf` здесь не спросить:
// он отвечает по типу объекта, а тип появится только после «Добавить» — поэтому
// наследование разворачивается здесь, по той же цепочке «своё, иначе
// категорийное, иначе первое в палитре».
export function typesDraftStyle(draft, category) {
  return {
    kind: draft.kind,
    color: category ? category.color : TYPES_NO_COLOR,
    shape: draft.shape || (category && category.shape) || SHAPE_PALETTE[0],
    lineStyle: draft.lineStyle || (category && category.lineStyle) || LINE_STYLES[0],
  };
}

// Замена узла на месте: строка добавления перерисовывает только то, что
// зависит от выбора, — поля кода и названия остаются теми же узлами, иначе
// набранное пропадало бы вместе с фокусом при каждом переключении вида.
function typesSwap(current, next) {
  current.replaceWith(next);
  return next;
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

// Окно «Добавить из общей базы». Общая база — стандартный справочник плюс
// сохранённый шаблон: то, чего в справочнике объекта нет, но что уже описано.
// Появилось оттого, что новые типы стартового справочника (проходной
// переключатель, витая пара, датчики) не доезжали до размеченных объектов:
// единственным путём был возврат к шаблону, а он стирает правки пользователя.
//
// Что предлагать и что из этого выйдет, решает модель (`catalogOffer`): здесь
// только отметки. Значок и цвет строки — те же, что окажутся на плане, поэтому
// цвет берётся у категории объекта, когда она в нём уже есть.
export function openTypesCatalog(project, template) {
  return new Promise((resolve) => {
    const groups = catalogOffer(project, template);
    const chosen = new Set();
    const items = [];
    const heads = [];
    let modal;
    const done = (value) => {
      modal.close();
      resolve(value);
    };

    const counter = uiEl("p", { class: "modal__text" });
    const addButton = uiButton(strings.dictionary.catalogAdd, {
      class: "ui-btn ui-btn--accent",
      on: { click: () => done([...chosen]) },
    });

    // Состояние всех флажков — от одного набора отметок: галочка категории
    // ставится и снимается вместе со своими строками, а наполовину отмеченная
    // категория показывается серым квадратом, а не пустой галочкой.
    function sync() {
      for (const item of items) item.node.checked = chosen.has(item.key);
      for (const head of heads) {
        const marked = head.keys.filter((key) => chosen.has(key)).length;
        head.node.checked = marked === head.keys.length;
        head.node.indeterminate = marked > 0 && marked < head.keys.length;
      }
      counter.textContent = text("dictionary.catalogChosen", { count: chosen.size });
      addButton.disabled = chosen.size === 0;
    }

    const list = uiEl("div", { class: "catalog__rows" });
    for (const group of groups) {
      const keys = group.types.map((type) => type.key);
      const head = uiEl("input", {
        type: "checkbox",
        title: strings.dictionary.catalogAll,
        on: {
          change: () => {
            for (const key of keys) {
              if (head.checked) chosen.add(key);
              else chosen.delete(key);
            }
            sync();
          },
        },
      });
      heads.push({ node: head, keys });
      const name = uiEl("span", { text: group.category.name });
      name.style.color = group.category.color;
      list.append(
        uiEl("label", { class: "catalog__row catalog__row--group" }, [
          head,
          shapeIcon(group.category.shape, group.category.color, 18),
          name,
        ]),
      );
      for (const type of group.types) {
        const box = uiEl("input", {
          type: "checkbox",
          on: {
            change: () => {
              if (box.checked) chosen.add(type.key);
              else chosen.delete(type.key);
              sync();
            },
          },
        });
        items.push({ node: box, key: type.key });
        list.append(
          uiEl("label", { class: "catalog__row catalog__row--type", title: type.code + " — " + type.name }, [
            box,
            // Форма типа, а если своей нет — форма категории: ровно то, что
            // нарисует план. Цвет всегда категорийный, цвета у типа нет.
            shapeIcon(type.shape || group.category.shape, group.category.color, 20),
            uiEl("span", { class: "catalog__code", text: type.code }),
            uiEl("span", { class: "catalog__name", text: type.name }),
          ]),
        );
      }
    }

    // Добавлять нечего — это ответ, а не пустое окно: кнопка на месте, и
    // строка объясняет, почему список пуст.
    const body = uiEl(
      "div",
      { class: "catalog" },
      groups.length === 0
        ? [uiEl("p", { class: "panel__empty", text: strings.dictionary.catalogEmpty })]
        : [uiEl("p", { class: "modal__text", text: strings.dictionary.catalogHint }), list, counter],
    );
    sync();
    modal = uiModal({
      title: strings.dictionary.catalogTitle,
      body,
      actions: [uiButton(strings.dialog.cancel, { on: { click: () => done(null) } }), addButton],
      onCancel: () => resolve(null),
    });
  });
}

// Список выведенных видов уехал в панель предупреждений (`panels/warnings.js`):
// модальным окном при открытии объекта он перекрывал план простынёй на
// полтора десятка строк. Отметка «разобрано» осталась там же, где была, — в
// самом объекте (`type.kindGuessed`), и уезжает вместе с файлом.

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
    // Вид у объекта прежнего формата выведен по меткам, а не записан: читается
    // он одной функцией модели, чтобы справочник и холст не разошлись.
    const kind = typeKindOf(project(), type.id);
    // Кнопки конца строки идут своей мерой (`dict__act`), а не по ширине глифа:
    // из них складывается хвост, с которым равняется строка добавления.
    //
    // Невозможное действие видно невозможным: тип с метками не удаляется,
    // и кнопка об этом говорит до нажатия, а не после.
    const removeButton = uiIconButton("trash", {
      class: "ui-btn ui-btn--danger dict__act",
      title: count > 0 ? text("errors.typeHasMarks", { code: type.code, count }) : strings.dictionary.removeType,
      on: { click: () => removeType(type) },
    });
    removeButton.disabled = count > 0;
    // Уплотнение живёт в строке типа: тип назван, и рядом видно, скольких меток
    // команда коснётся.
    const compactButton = uiIconButton("compact", {
      class: "ui-btn dict__act",
      title:
        count > 0
          ? text("dictionary.compactHint", { code: type.code })
          : text("dictionary.compactEmpty", { code: type.code }),
      on: { click: () => compactType(type) },
    });
    compactButton.disabled = count === 0;
    // Значок строки — то, чем тип рисуется на плане: у точечного фигура,
    // у линейного отрезок его начертанием.
    const badge = uiEl("span", { class: "dict__badge" }, [
      kind === "line"
        ? lineStyleIcon(style.lineStyle, style.color, TYPES_BADGE.size, TYPES_BADGE.length)
        : shapeIcon(style.shape, style.color, TYPES_BADGE.size),
    ]);
    return uiEl("div", { class: "dict__row" }, [
      badge,
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
      typesKindSwitch({
        kind,
        onPick: (value) =>
          commit((current) => updateType(current, type.id, { kind: value }).project, strings.history.typeKind),
      }),
      // Лишнее не показывается: у точечного типа выбирается фигура, у
      // линейного — начертание. Показать оба значило бы предложить выбрать то,
      // чего на плане не будет.
      kind === "line"
        ? typesLineButton({
            lineStyle: type.lineStyle,
            color: category ? category.color : TYPES_NO_COLOR,
            allowInherit: true,
            inheritLineStyle: category ? category.lineStyle : LINE_STYLES[0],
            onPick: (lineStyle) =>
              commit((current) => updateType(current, type.id, { lineStyle }).project, strings.history.editType),
          })
        : typesShapeButton({
            shape: type.shape,
            color: category ? category.color : TYPES_NO_COLOR,
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
    const removeButton = uiIconButton("trash", {
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
      // У категории остаются оба: она задаёт умолчание и точечным своим типам,
      // и линейным, а вида у самой категории нет.
      typesLineButton({
        lineStyle: category.lineStyle || LINE_STYLES[0],
        color: category.color,
        allowInherit: false,
        onPick: (lineStyle) =>
          commit(
            (current) => updateCategory(current, category.id, { lineStyle }).project,
            strings.history.editCategory,
          ),
      }),
      removeButton,
    ]);
  }

  // Общая база: стандартный справочник и сохранённый шаблон. Шаблон достаёт
  // панель — модель хранилища не знает. Добавление идёт одним шагом истории:
  // одна отмена возвращает весь набор. Через общий `commit` не идёт нарочно —
  // нужно знать, сколько типов добавилось на самом деле, и не ставить пустой
  // шаг истории, когда не добавилось ничего.
  async function addFromCatalog() {
    const template = await getSetting(TYPE_TEMPLATE_KEY);
    const keys = await openTypesCatalog(project(), template);
    if (!keys || keys.length === 0) return;
    try {
      const result = addTypesFromCatalog(project(), template, keys);
      if (result.types.length > 0) {
        canvasCommit(project(), result.project, strings.history.addFromCatalog);
        api.notify(text("dictionary.catalogAdded", { count: result.types.length }), "success");
      }
      // Пропущенное называется вслух: строка, которую справочник не принял,
      // молча исчезнувшая из пакета, — это «добавил, а его нет».
      if (result.skipped.length > 0) {
        api.notify(
          text("dictionary.catalogSkipped", { codes: result.skipped.map((row) => row.code).join(", ") }),
          "error",
        );
      }
    } catch (error) {
      fail(error);
    }
  }

  // Строка добавления держит вид и знак сама, теми же элементами, что строка
  // заведённого типа: пользователь просил «при добавлении нового типа сразу
  // добавь переключатель точка/линия и выбор иконки или типа линии». Прежде
  // линейный тип заводился в два захода — создал строкой добавления, потом
  // переключил вид в строке созданного.
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
    let draft = typesAddDraft(project().categories.length > 0 ? project().categories[0].id : "");
    const category = () => findCategory(project(), draft.categoryId);

    // Значок строки — предпросмотр: то, чем новый тип встанет на план. Он же
    // показывает, во что обернулось умолчание «как у категории», до того как
    // пользователь откроет сетку знаков.
    function badgeNode() {
      const style = typesDraftStyle(draft, category());
      return uiEl("span", { class: "dict__badge" }, [
        style.kind === "line"
          ? lineStyleIcon(style.lineStyle, style.color, TYPES_BADGE.size, TYPES_BADGE.length)
          : shapeIcon(style.shape, style.color, TYPES_BADGE.size),
      ]);
    }

    function kindNode() {
      return typesKindSwitch({
        kind: draft.kind,
        onPick: (value) => {
          draft = typesDraftKind(draft, value);
          refresh();
        },
      });
    }

    // Рядом с переключателем — только нужное, как и в строке типа: фигура у
    // точечного, начертание у линейного. Вторых элементов выбора у строки
    // добавления нет — это те же `typesShapeButton` и `typesLineButton`.
    function signNode() {
      const own = category();
      const pick = (value) => {
        draft = typesDraftSign(draft, value);
        refresh();
      };
      const color = own ? own.color : TYPES_NO_COLOR;
      return draft.kind === "line"
        ? typesLineButton({
            lineStyle: draft.lineStyle,
            color,
            allowInherit: true,
            inheritLineStyle: (own && own.lineStyle) || LINE_STYLES[0],
            onPick: pick,
          })
        : typesShapeButton({
            shape: draft.shape,
            color,
            allowInherit: true,
            inheritShape: (own && own.shape) || SHAPE_PALETTE[0],
            onPick: pick,
          });
    }

    let badge = badgeNode();
    let kind = kindNode();
    let sign = signNode();
    function refresh() {
      badge = typesSwap(badge, badgeNode());
      kind = typesSwap(kind, kindNode());
      sign = typesSwap(sign, signNode());
    }

    // Черновик отдаётся модели как есть: вид и знак приезжают с типом сразу,
    // без второго захода. Сбрасывать строку руками не нужно — после команды
    // справочник перерисовывается подпиской и строит её заново.
    const add = () =>
      commit(
        (current) => addType(current, { ...draft, code: code.value, name: name.value }).project,
        strings.history.addType,
      );
    return uiEl("div", { class: "dict__row dict__row--add" }, [
      badge,
      code,
      name,
      categorySelect(draft.categoryId, (value) => {
        draft = { ...draft, categoryId: value };
        // Знак наследуется у категории — значит смена категории меняет и то,
        // что нарисовано в строке: и предпросмотр, и цвет кнопки знака.
        refresh();
      }),
      kind,
      sign,
      uiButton(strings.dictionary.addType, {
        class: "ui-btn ui-btn--accent dict__add",
        on: { click: add },
      }),
    ]);
  }

  // Кнопка общей базы стоит под строками добавления, как просил пользователь:
  // «а ниже кнопка добавления из общей базы». Не прячется, даже когда общая
  // база объекту уже нечего дать: исчезнувшая кнопка — это вопрос «куда она
  // делась», а не ответ.
  function catalogRow() {
    return uiEl("div", { class: "dict__row dict__row--catalog" }, [
      uiButton(strings.dictionary.addFromCatalog, {
        class: "ui-btn ui-btn--wide",
        title: strings.dictionary.addFromCatalogHint,
        on: { click: () => addFromCatalog() },
      }),
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

    // Сперва весь перечень — категории, потом типы, — и только после него
    // раздел «Добавить»: пользователь просил «в справочнике после перечня
    // добавь новый заголовок — добавить». Строки добавления, стоявшие внутри
    // своих перечней, обрывали чтение списка на полпути.
    body.replaceChildren(
      uiEl("h4", { class: "dict__title", text: strings.dictionary.categories }),
      ...current.categories.map((category) => categoryRow(category)),
      uiEl("h4", { class: "dict__title", text: strings.dictionary.types }),
      ...typeRows,
      uiEl("h4", { class: "dict__title", text: strings.dictionary.add }),
      addCategoryRow(),
      addTypeRow(),
      catalogRow(),
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
  // Ширину карточки задаёт справочник: колонок в строке столько, что на общей
  // мере диалогов название типа ужималось до трёх букв.
  if (modal.card) modal.card.classList.add("modal--wide");
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
  const equipmentButton = uiButton(strings.equipment.open, {
    class: "ui-btn ui-btn--wide",
    title: strings.equipment.title,
    on: { click: () => openEquipmentWindow(api) },
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
  host.replaceChildren(
    uiEl("div", { class: "dict-panel" }, [dictionaryButton, equipmentButton, saveButton, resetButton]),
  );

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
    equipmentButton.disabled = !state.project;
    saveButton.disabled = !state.project;
  }

  subscribe((state, changed) => {
    if ("project" in changed) syncButtons();
  });
  syncButtons();
}

registerPanel(PANEL_IDS.properties, mountTypesPanel);
