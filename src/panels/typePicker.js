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
import { uiEl, uiButton, uiPickCard, uiPickKeys, uiPickSearch } from "./ui.js";
import {
  COMMENT_TYPE_ID,
  addType,
  commentCodeOf,
  findType,
  codeProblem,
  matchTypeExactly,
  queryHit,
  queryNeedle,
  searchTypes,
  typeKindOf,
  CODE_MAX_LENGTH,
} from "../model.js";
import { typeIcon } from "../render.js";

// Клетка знака в строке: одна мера на оба вида. Образец линии шире фигуры —
// сплющить его до её ширины нельзя (точечную линию от штрихпунктирной в 22px
// не отличить), поэтому фигура садится в клетку той же ширины, что образец.
// Так строки точечных и линейных типов стоят колонка в колонку — то же
// правило, по которому выровнены строки справочника.
const PICKER_ICON = { size: 22, length: 44 };

// Значок типа — цвет категории и обозначение из справочника, нарисованные
// общим `render.typeIcon`: у точечного типа фигура, у линейного образец его
// начертания (дефект D31 — здесь рисовались точки у всех). Вид спрашивает сам
// `typeIcon` у `typeKindOf`: у объекта прежнего формата поля `kind` нет.
function pickerIcon(project, typeId, size = PICKER_ICON.size) {
  return uiEl("span", { class: "picker__icon" }, [
    typeIcon(project, typeId, size, PICKER_ICON.length),
  ]);
}

// Больше шести колонок в ряд не ставим: седьмая ужимает остальные до каши.
// Лишние категории уходят не во второй ряд, а вниз по колонкам — вторым рядом
// сетка выравнивала всё по самой высокой категории и оставляла посреди окна
// пустое поле.
const PICKER_MAX_COLUMNS = 6;

// Меры окна, по которым считается, сколько колонок в него влезет. Считать нужно
// всё это вместе: колонка, которая «почти влезла», даёт горизонтальную
// прокрутку — а на узком экране колонок должно становиться меньше, только и
// всего.
//
// **Хозяин этих чисел — здесь, а узнаёт о них CSS двумя путями** (таск 173).
// Где стиль может спросить — он спрашивает: число колонок приходит к нему
// переменной `--picker-columns`, которую ставит `renderList`. Где не может —
// ширина колонки в `minmax()`, просвет `gap`, доля экрана `96vw` и поля
// карточки `40px` — число повторено в `typePicker.css` и `objectPicker.css`,
// а держит их вместе `test/cssMeasures.test.js`: он читает стиль текстом и
// падает на расхождении. Переменная с запасным значением этого не заменила бы
// — запасное значение и есть то же число во втором месте.
export const PICKER_COLUMN_MIN = 150;
export const PICKER_COLUMN_GAP = 14;
export const PICKER_MODAL_SHARE = 0.96;
export const PICKER_MODAL_CHROME = 40;

// Сколько колонок помещается в экран шириной `width`. Мера колонки — довод:
// у окна вещей чертежа (`objectPicker.js`) колонка шире, потому что в ней
// стоят плитки, а не строки.
export function pickerColumnLimit(width, columnMin = PICKER_COLUMN_MIN) {
  const usable = Math.max(0, Number(width) || 0) * PICKER_MODAL_SHARE - PICKER_MODAL_CHROME;
  const fits = Math.floor((usable + PICKER_COLUMN_GAP) / (columnMin + PICKER_COLUMN_GAP));
  return Math.max(1, Math.min(PICKER_MAX_COLUMNS, fits));
}

// Высота категории в строках: заголовок плюс её типы. Точные пиксели здесь не
// нужны — раскладка решает, что с чем встанет в одну колонку, а не рисует.
//
// Мера высоты — довод раскладки, а не её устройство: окно вещей чертежа
// считает ряды плиток (`objectPickerWeight`), и обоим окнам хватает одной
// раскладки. Второго такого механизма в сборке быть не должно.
function pickerWeight(group) {
  return 1 + (group && Array.isArray(group.types) ? group.types.length : 0);
}

// Категории кладутся в колонку подряд, пока та не станет выше `height`.
// Порядок справочника сохраняется: колонка читается сверху вниз, колонки —
// слева направо, «Свет» по-прежнему первый, «Щит» последний.
function pickerFill(groups, height, weightOf) {
  const columns = [];
  let filled = 0;
  for (const group of groups) {
    const weight = weightOf(group);
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
export function pickerLayout(groups, limit = PICKER_MAX_COLUMNS, weightOf = pickerWeight) {
  const list = Array.isArray(groups) ? groups.filter(Boolean) : [];
  if (list.length === 0) return [];
  const cap = Math.max(1, Math.floor(Number(limit)) || 1);
  const total = list.reduce((sum, group) => sum + weightOf(group), 0);
  let height = Math.max(...list.map(weightOf));
  let columns = pickerFill(list, height, weightOf);
  // Категорий больше, чем колонок помещается в окно, — колонка становится
  // выше, и лишние уходят под соседние, а не за край экрана.
  while (columns.length > cap && height < total) {
    height += 1;
    columns = pickerFill(list, height, weightOf);
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

// Виды, внутри которых окно сужает справочник. Комментарий здесь наравне с
// точкой и линией: плашку меняют только на плашку — текст у неё есть, а у
// знака его негде взять (`changeMarkType` стережёт то же правило).
// Виды, внутри которых окно сужает справочник. Комментария здесь нет и быть
// не может: тип у него встроенный и единственный (G173), менять его не на
// что — кнопку «Сменить тип» панель инструментов такой метке и не показывает.
const PICKER_KINDS = ["point", "line"];

// Чем окно объясняет сужение. Строка одна на вид — иначе пользователь видел бы
// короткий список и не знал, чего в нём не хватает.
function pickerKindNote(kind) {
  return kind === "line" ? strings.picker.onlyLine : strings.picker.onlyPoint;
}

/**
 * Подходит ли встроенный комментарий под набранное в поиске.
 *
 * Плашка стоит под таблицей и ведёт себя как её строки: поиск сужает окно, и
 * «розетка» не должна оставлять на экране комментарий. Спросить `searchTypes`
 * о нём нельзя — встроенного типа в справочнике нет, — но **правило
 * совпадения берётся у модели** (`queryHit`, находка 7 разбора механик):
 * своего здесь было третье, и плашка ловилась серединой слова, когда строки
 * таблицы рядом уже нет.
 */
export function pickerCommentMatches(project, query) {
  const needle = queryNeedle(query);
  if (!needle) return true;
  const type = findType(project, COMMENT_TYPE_ID);
  return (
    queryHit(type.code.toLowerCase(), needle) ||
    queryHit(type.name.toLowerCase(), needle) ||
    queryHit(strings.picker.builtinComment.toLowerCase(), needle)
  );
}

// Смена типа у метки идёт внутри её вида: линии — линейные типы, точке —
// точечные. Окно получает вид в `options.kind` и оставляет только свои типы;
// постановка новой метки вид не задаёт и видит справочник целиком.
//
// Вид спрашивается у `typeKindOf`, а не у `type.kind`: у объекта прежнего
// формата поля нет вовсе. Категория, в которой не осталось ни одного типа
// нужного вида, из окна уходит — пустой заголовок держал бы колонку зря.
export function pickerGroupsOfKind(project, groups, kind) {
  if (!PICKER_KINDS.includes(kind)) return groups;
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
    const builtin = uiEl("div", { class: "picker__builtin" });
    const body = uiEl("div", { class: "picker picker--types" });
    const error = uiEl("p", { class: "picker__error" });
    const createBox = uiEl("div", { class: "picker__create" });
    // Первая строка окна — первая строка сетки, а когда поиск оставил одну
    // плашку комментария, то она: плашка стоит под сеткой и в обход её не
    // остаётся, и стрелка вниз, и Enter ведут к ней.
    const firstRow = () => box.querySelector(".picker__row") || builtinRow();
    const search = uiPickSearch({
      placeholder: strings.picker.search,
      onInput: () => renderList(),
      first: firstRow,
      // Нечего выбрать, но есть что завести — Enter заводит: человек набрал
      // код, которого в справочнике нет, и это ровно то движение, которого он
      // ждёт.
      onEnter: () => {
        const first = firstRow();
        if (first) first.click();
        else if (createBox.firstChild) createType();
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

    /**
     * Отдельная плашка «Комментарий» под основной таблицей (G173).
     *
     * Слова заказчика: «в окне добавления в выборе типа метки просто сделай
     * снизу отдельную плашку Комментарий, под основной таблицей. То есть под
     * капотом это такая же метка, но в интерфейсе отдельно выделяется».
     *
     * Почему не клетка сетки: сетка — это справочник объекта, который человек
     * правит сам, а комментарий есть всегда и ни переименовать, ни удалить
     * его нельзя. Отдельный блок под чертой и подпись «есть всегда, в
     * справочнике его нет» говорят это прямо, а не намёком.
     *
     * Плашки нет, когда окно сужено видом метки (`options.kind`): там меняют
     * тип у уже стоящей метки, а точку в комментарий не превращают — модель
     * этого и не позволит.
     */
    function renderBuiltin(query) {
      builtin.replaceChildren();
      builtin.hidden = Boolean(options.kind) || !pickerCommentMatches(current, query);
      if (builtin.hidden) return;
      const type = findType(current, COMMENT_TYPE_ID);
      const row = uiEl(
        "button",
        {
          class: "picker__row picker__builtin-row" + (options.activeTypeId === COMMENT_TYPE_ID ? " is-active" : ""),
          type: "button",
          title: strings.picker.builtinCommentHint,
          on: { click: () => done({ typeId: COMMENT_TYPE_ID, project: current }) },
        },
        [
          pickerIcon(current, COMMENT_TYPE_ID),
          uiEl("span", { class: "picker__code", text: commentCodeOf(current) }),
          uiEl("span", { class: "picker__name", text: type.name }),
        ],
      );
      builtin.append(
        uiEl("p", { class: "picker__builtin-title", text: strings.picker.builtinComment }),
        row,
        uiEl("p", { class: "picker__builtin-hint", text: strings.picker.builtinCommentHint }),
      );
    }

    // Строка плашки, когда она на экране. Отдельной функцией — её спрашивают
    // и клавиатура, и проверка «а есть ли вообще что выбрать».
    function builtinRow() {
      return builtin.hidden ? null : builtin.querySelector(".picker__row");
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
      renderBuiltin(query);
      renderCreate(query);
    }

    // Клавиатура по сетке: кирпич окна выбора, а куда уводит стрелка — своё
    // (`pickerMove`), по колонкам.
    uiPickKeys(box, {
      cell: "picker__row",
      grid: true,
      move: (row, dx, dy) => pickerMove(box, row, dx, dy),
    });

    renderList();
    const note = PICKER_KINDS.includes(options.kind)
      ? uiEl("p", { class: "picker__note", text: pickerKindNote(options.kind) })
      : null;
    body.replaceChildren(...[search, note, box, builtin, createBox, error].filter(Boolean));
    modal = uiPickCard({
      title: options.title || strings.picker.title,
      body,
      // Широкая карточка: ширину внутри задаёт сетка колонок.
      wide: true,
      cancel: () => done(null),
      focus: search,
    });
  });
}
