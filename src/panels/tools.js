// Два раздела левой колонки. «Метки» — всё про постановку: выбранный тип,
// что ставим, режим блока, отмена. Тип показан крупно и «залипает» — по нему
// видно, что следующий клик по плану поставит именно его. «Размеры» — размер
// меток и подписей и масштаб плана.
//
// Обводки помещений здесь нет вовсе: контур принадлежит комнате, а не метке,
// и запускается из раздела «Помещения» — там и список комнат, и кнопки
// контуров. В этом разделе остаются только режимы про метки.
import {
  DRAWING_SETTING,
  ELEVATION_SETTING,
  GRID_SETTING,
  GRID_SNAP_SETTING,
  GUIDES_SETTING,
  OBJECTS_SETTING,
  PLAN_SETTING,
  SCHEME_FONT_SETTING,
  layoutAllows,
  PANEL_IDS,
  registerPanel,
} from "../app.js";
import { strings, text } from "../strings.js";
import {
  BLOCK_MODES,
  gridStepOf,
  setGridStep,
  MARK_KINDS,
  MARK_KIND_COMMENT,
  markIsComment,
  changeMarkType,
  findMark,
  findScheme,
  findType,
  labelOf,
  projectViewSizes,
  typeKindOf,
  schemesInOrder,
  updateProject,
  updateType,
  wallsOnScheme,
} from "../model.js";
import { uiEl, uiButton, uiIconButton, uiModal } from "./ui.js";
import { setSetting } from "../store.js";
import { openTypePicker } from "./typePicker.js";
import { FONT_DRAFT, FONT_SYSTEM, typeIcon } from "../render.js";
import { canUndo, canRedo, onHistoryChange, undoLabel, redoLabel } from "../history.js";
import {
  canvasCommit,
  canvasFitPlan,
  canvasRedoStep,
  canvasUndoStep,
  canvasZoomBy,
  canvasZoomReset,
} from "../canvas.js";
import {
  WORKSHOP_GRID_OFF,
  workshopAttachPlan,
  workshopCalibratePlan,
  workshopGridChoice,
  workshopGridOptions,
  workshopGridValue,
  workshopPlacement,
  workshopViewFit,
  workshopViewReady,
  workshopViewReset,
  workshopViewZoomBy,
} from "./workshop.js";

/**
 * Что обещает клик по плану выбранному типу: точку, ломаную или плашку.
 * Отдельно от режима, потому что это же обещание висит подсказкой на самой
 * кнопке «Добавление» — там оно про то, что **будет**, когда её нажмут.
 */
export function toolsKindNote(kind) {
  if (!kind) return strings.canvas.needType;
  if (kind === "line") return strings.tools.kindLineHint;
  if (kind === MARK_KIND_COMMENT) return strings.tools.kindCommentHint;
  return strings.tools.kindPointHint;
}

/**
 * Строка под кнопками «Выделение · Добавление» в разделе «Метки» — **одна
 * дверь к словам о том, что сейчас сделает клик** (пара к `workshopModeNote`
 * чертежа, таск 203).
 *
 * Дефект D66, с которого начался таск 217: на схеме со стенами и обведённым
 * помещением метка «перестала ставиться» — три клика подряд и «Меток 0».
 * Постановка оказалась цела: не ставила её не схема, а режим. Переход между
 * полями «Чертёж · Схема · Объём» сбрасывает занятие на «Выделение» — это
 * правило заказчика (G296, таск 193), и отменять его нельзя. А вот **молчать
 * о нём нельзя тем более**: тип в плашке остаётся выбранным, и строка под
 * кнопками до этого таска при любом режиме обещала «клик по плану ставит
 * точку». Человек, вернувшийся из чертежа, читал обещание, кликал — и не
 * получал ничего.
 *
 * Поэтому в «Выделении» с выбранным типом строка говорит правду и называет
 * дверь: режим, что делает клик и какую кнопку нажать. Без типа правда другая
 * и она уже была — «Сначала выберите тип метки»; режимы без своей кнопки
 * (обводка, калибровка) говорят о себе сами, как и раньше.
 *
 * Чистая и вынесена наружу ради теста: строка, разошедшаяся с тем, что делает
 * клик, — это и есть дефект, который ловят глазами последним.
 */
export function toolsModeNote({ mode, kind, label } = {}) {
  const named = mode && mode !== "select" && mode !== "add" ? mode : null;
  if (named) return strings.tools["modeNow_" + named] || toolsKindNote(kind);
  if (mode === "select" && kind) return text("tools.modeSelectNote", { label });
  return toolsKindNote(kind);
}

/**
 * Ряд масштаба: «−», «+», «Вписать план», «100 %» (G227).
 *
 * Куда он смотрит, решает режим экрана, а не панель: панель только зовёт.
 * «Чертёж» отвечает через `panels/workshop.js` — поверхность там одна на
 * страницу, и, пока в чертёж не заходили, звать некого: кнопки гаснут.
 */
function toolsZoomRow(state) {
  const screen = state.screen;
  const drawing = screen === "drawing";
  const off = screen === "volume" || (drawing && !workshopViewReady());
  const title = screen === "volume" ? strings.tools.zoomVolume : "";
  const make = (button) => {
    if (!off) return button;
    button.disabled = true;
    if (title) button.title = title;
    return button;
  };
  const zoomBy = (factor) => (drawing ? workshopViewZoomBy(factor) : canvasZoomBy(factor));
  const fit = () => (drawing ? workshopViewFit() : canvasFitPlan());
  const reset = () => (drawing ? workshopViewReset() : canvasZoomReset());
  return uiEl("div", { class: "tools__row" }, [
    make(uiIconButton("minus", { title: strings.tools.zoomOut, on: { click: () => zoomBy(1 / 1.25) } })),
    make(uiIconButton("plus", { title: strings.tools.zoomIn, on: { click: () => zoomBy(1.25) } })),
    make(uiButton(strings.tools.zoomFit, { on: { click: () => fit() } })),
    make(uiButton(strings.tools.zoomReset, { on: { click: () => reset() } })),
  ]);
}

const TOOLS_MARK_SIZE = { min: 4, max: 36 };
const TOOLS_LABEL_SIZE = { min: 8, max: 40 };
// Клетка знака на плашке: образец линии длиннее фигуры, и мера у них одна —
// иначе код и название съезжают, стоит сменить точечный тип на линейный.
const TOOLS_TYPE_ICON_LENGTH = 52;

// Крупный значок выбранного типа: цвет категории и обозначение из справочника,
// нарисованные тем же `render.typeIcon`, что в окне выбора и в справочнике.
//
// Это было **третье место** того же дефекта D31: плашка звала `shapeIcon`
// напрямую, и у линейного типа на ней стояла точка — ровно то, из-за чего
// заказчик решил, что «тип Линия не поддерживается». Вид плашка и так знает
// (строка-подсказка под кнопками спрашивает его у `typeKindOf`), но знак
// рисовался мимо него.
function toolsTypeIcon(project, typeId, size = 26) {
  return typeIcon(project, typeId, size, TOOLS_TYPE_ICON_LENGTH);
}

// Ползунок двигается живьём, а в историю попадает одним действием на всё
// перетаскивание: иначе стек забивался бы тридцатью шагами на один жест.
// Отметка «линейка и направляющие»: состояние сеанса плюс запись в настройки —
// оно переживает перезагрузку, но в объект не попадает.
// Выбор шрифта подписей на экране (G172).
//
// **Почему здесь, а не в своём окне настроек.** Окна настроек в сборке нет, и
// заводить его ради одного выбора жалко — а раздел «Размеры» и так отвечает
// ровно на этот вопрос: как схема выглядит на экране. Рядом уже стоят кегль
// меток, кегль подписей и галка линейки, причём линейка — такая же личная
// настройка браузера, а не свойство объекта. Шрифт встаёт прямо под «Подписи»:
// там же, где их размер, выбирается и их рисунок.
//
// **Почему два пункта, а не три.** Моноширинный напрашивался третьим, но
// своего файла у него не будет (второй шрифт в сборку не кладём), а системный
// моноширинный у каждой машины свой — на двух компьютерах один объект выглядел
// бы по-разному. Подписи к тому же короткие и прописные: выравнивать в них
// нечего, пользы от моноширинного нет.
function toolsFontSelect(state, setState) {
  const options = [
    { value: FONT_DRAFT, label: strings.tools.fontDraft },
    { value: FONT_SYSTEM, label: strings.tools.fontSystem },
  ];
  const select = uiEl("select", {
    class: "ui-input tools__select",
    title: strings.tools.fontHint,
    on: {
      change: () => {
        setState({ schemeFont: select.value });
        setSetting(SCHEME_FONT_SETTING, select.value);
      },
    },
  });
  const current = state.schemeFont === FONT_SYSTEM ? FONT_SYSTEM : FONT_DRAFT;
  for (const option of options) {
    const node = uiEl("option", { text: option.label, value: option.value });
    node.value = option.value;
    if (option.value === current) node.selected = true;
    select.append(node);
  }
  return select;
}

function toolsGuidesCheck(state, setState) {
  const box = uiEl("input", {
    class: "tools__check",
    type: "checkbox",
    on: {
      change: () => {
        setState({ guidesShown: box.checked });
        setSetting(GUIDES_SETTING, box.checked);
      },
    },
  });
  box.checked = state.guidesShown !== false;
  return box;
}

/**
 * Выключатель слоя плана: подложка и чертёж (таск 127).
 *
 * Стоят они здесь, в «Размерах», а не в строке схемы и не над холстом, по той
 * же причине, что линейка и шрифт схемы: это **выбор глаз**, личная настройка
 * браузера, и все такие выключатели собраны в одном разделе. В строке схемы
 * они читались бы свойством схемы — то есть объекта, — а объект тут ни при чём:
 * на одном компьютере размечают по фотографии, на другом по своему чертежу.
 */
function toolsLayerCheck(state, setState, key, setting) {
  const box = uiEl("input", {
    class: "tools__check",
    type: "checkbox",
    on: {
      change: () => {
        setState({ [key]: box.checked });
        setSetting(setting, box.checked);
      },
    },
  });
  box.checked = state[key] !== false;
  return box;
}

function toolsSlider(value, range, onInput, onCommit) {
  return uiEl("input", {
    class: "tools__slider",
    type: "range",
    value: String(value),
    attrs: { min: String(range.min), max: String(range.max), step: "1" },
    on: {
      input: (event) => onInput(Number(event.target.value)),
      change: () => onCommit(),
    },
  });
}

function mountToolsPanel(host, api) {
  const { getState, setState, subscribe, notify } = api;
  const box = uiEl("div", { class: "tools" });
  host.replaceChildren(box);

  function activeType(state) {
    return state.project && state.activeTypeId ? findType(state.project, state.activeTypeId) : null;
  }

  async function chooseType(nextMode) {
    const state = getState();
    if (!state.project) return;
    const picked = await openTypePicker(state.project, { activeTypeId: state.activeTypeId });
    if (!picked) return;
    const fresh = getState();
    // Выбрали тип — значит собрались ставить: режим добавления, а что именно
    // встанет, решит вид типа. Отдельного выбора «точка или линия» больше нет.
    const mode = nextMode || "add";
    if (!picked.created) {
      setState({ activeTypeId: picked.typeId, mode });
      return;
    }
    // Новый тип — правка объекта, значит и шаг истории: иначе следующий Ctrl+Z
    // по метке вернул бы объект без этого типа, ни о чём не спросив.
    canvasCommit(fresh.project, picked.project, strings.history.addType, {
      patch: { activeTypeId: picked.typeId, mode },
    });
    const type = findType(picked.project, picked.typeId);
    notify(text("picker.created", { code: type.code, name: type.name }), "success");
  }

  // Смена типа у выделенной метки: модель выдаёт новый номер, старый остаётся
  // дырой — так распечатка вчерашнего дня не протухает.
  async function changeSelectedType() {
    const state = getState();
    const markId = state.selectedMarkIds[0];
    if (!state.project || !markId) return;
    const mark = findMark(state.project, markId);
    if (!mark) return;
    // Сменить тип можно только внутри вида метки: нарисованной линии — другой
    // линейный тип, точке — другой точечный. Окно показывает только их;
    // метка прежнего объекта, чей тип оказался чужого вида, своего текущего
    // типа в списке не увидит — это и правильно, менять его есть на что.
    const picked = await openTypePicker(state.project, {
      title: strings.tools.changeType,
      // Комментарий — такой же вид, как точка и линия: плашку меняют только
      // на плашку, иначе её текст было бы некуда девать.
      kind: MARK_KINDS.includes(mark.kind) ? mark.kind : "point",
      activeTypeId: mark.typeId,
    });
    if (!picked) return;
    const before = picked.created ? state.project : getState().project;
    const base = picked.created ? picked.project : before;
    if (!findMark(base, markId)) return;
    try {
      const after = changeMarkType(base, markId, picked.typeId).project;
      canvasCommit(before, after, strings.history.changeType, { selection: [markId] });
      notify(text("canvas.typeChanged", { label: labelOf(after, markId) }), "success");
    } catch (error) {
      notify(error.message, "error");
    }
  }

  function setMode(mode) {
    const state = getState();
    if (mode !== "select" && !state.schemeId) {
      notify(strings.canvas.needScheme);
      return;
    }
    if (mode !== "select" && !state.activeTypeId) {
      chooseType(mode);
      return;
    }
    setState({ mode });
  }

  function setBlockMode(mode) {
    const state = getState();
    const type = activeType(state);
    if (!type) return;
    canvasCommit(state.project, updateType(state.project, type.id, { blockMode: mode }).project, strings.history.blockMode);
  }

  function render() {
    const state = getState();
    const type = activeType(state);
    // Вид выбранного типа — единственное, что решает, точку или ломаную
    // поставит следующий клик. Спрашивается он у модели: у объекта прежнего
    // формата поля `kind` у типа нет вовсе.
    const kind = type ? typeKindOf(state.project, type.id) : null;
    // Метка, у которой можно сменить тип: пока её нет, кнопки нет тоже —
    // серая кнопка, которая никогда не оживает, хуже её отсутствия.
    const selectedId = state.selectedMarkIds[0];
    const selectedMark = state.project && selectedId ? findMark(state.project, selectedId) : null;

    const typeButton = uiEl(
      "button",
      {
        class: "tools__type" + (type ? " is-set" : ""),
        type: "button",
        title: strings.tools.chooseType,
        on: { click: () => chooseType() },
      },
      type
        ? [
            toolsTypeIcon(state.project, type.id),
            uiEl("span", { class: "tools__code", text: type.code }),
            uiEl("span", { class: "tools__typeName", text: type.name }),
            // Плашка и есть кнопка выбора типа — и должна выглядеть кнопкой:
            // пользователь нажимал её вслепую, а рядом серела мёртвая кнопка.
            uiEl("span", { class: "tools__pick", text: strings.tools.pick }),
          ]
        : [
            uiEl("span", { class: "tools__typeName", text: strings.tools.noType }),
            uiEl("span", { class: "tools__pick", text: strings.tools.pick }),
          ],
    );

    // Кнопок по-прежнему две: включить руками можно выделение и добавление.
    // Что именно добавится — точка или ломаная, — решает вид выбранного типа,
    // и строка под кнопками говорит ровно это. Третьей кнопки «что добавляем»
    // нет: выбор вида руками пользователя только путал, когда он уже выбрал
    // тип. Строка нужна именно словами: по одному значку типа не видно,
    // ставится метка кликом или тянется линией.
    //
    // **Но режимов у холста четыре** (таск 133). Обводку помещения включает
    // панель помещений, калибровку — панель схем и панель выгрузки; своей
    // кнопки у них здесь нет и не нужно — их включают оттуда, где они по делу.
    // А вот показывать в эту минуту обе кнопки погашенными — значит показывать
    // состояние, которого не бывает: ровно на это заказчик и сказал «вообще не
    // очевидно, что холст переходит в режим калибровки». Поэтому рядом встаёт
    // **имя текущего режима** — не кнопка: нажимать его некуда, он отвечает на
    // «где я», а дверь наружу — соседнее «Выделение» и Esc.
    const named = state.mode !== "select" && state.mode !== "add" ? state.mode : null;
    const kindNote = toolsKindNote(kind);
    const modeNote = toolsModeNote({
      mode: state.mode,
      kind,
      label: type ? type.code + " — " + type.name : "",
    });
    const modeRow = uiEl(
      "div",
      { class: "tools__row tools__row--modes" },
      [
        uiButton(strings.tools.selectMode, {
          class: "ui-btn" + (state.mode === "select" ? " is-active" : ""),
          title: named ? strings.tools.selectModeLeave : strings.tools.selectModeHint,
          on: { click: () => setMode("select") },
        }),
        uiButton(strings.tools.addMode, {
          class: "ui-btn" + (state.mode === "add" ? " is-active" : ""),
          // Типа нет — кнопка откроет окно выбора, про точку ей обещать нечего.
          title: kindNote,
          on: { click: () => setMode("add") },
        }),
        named
          ? uiEl("span", {
              class: "tools__modeNow",
              text: strings.tools["mode_" + named] || named,
              title: modeNote,
            })
          : null,
      ].filter(Boolean),
    );

    // Блок собирается только из точек — ручки «+» у линии нет и быть не может.
    // При линейном типе выбор гаснет и говорит почему: живой на вид список,
    // который ни на что не влияет, — обещание, которого сборка не держит.
    // Блока нет ни у линии, ни у комментария: ручки «+» ставят соседнюю точку
    // блока, а плашек в блоке не бывает — это надпись, а не ряд розеток.
    const blockOff = !type || kind === "line" || kind === MARK_KIND_COMMENT;
    const blockSelect = uiEl(
      "select",
      {
        class: "ui-select",
        title:
          kind === "line"
            ? strings.tools.blockLineHint
            : kind === MARK_KIND_COMMENT
              ? strings.tools.blockCommentHint
              : strings.tools.blockHint,
        on: { change: (event) => setBlockMode(event.target.value) },
      },
      BLOCK_MODES.map((mode) =>
        uiEl("option", { text: strings.blockMode[mode], value: mode, attrs: { value: mode } }),
      ),
    );
    if (type) blockSelect.value = type.blockMode || "each";
    blockSelect.disabled = blockOff;

    // Пустые места отсеиваются: «Сменить тип» появляется только при выделенной
    // метке, а replaceChildren на null вставил бы в панель слово «null».
    const parts = [
      uiEl("p", { class: "tools__label", text: strings.tools.type }),
      typeButton,
      // «Сменить тип» у комментария не показывается вовсе: тип у него один и
      // встроенный (G173), менять его не на что, а окно выбора открылось бы
      // пустым. Модель думает так же — `changeMarkType` держит комментарий
      // внутри его вида.
      selectedMark && !markIsComment(selectedMark)
        ? uiButton(text("tools.changeTypeOf", { label: labelOf(state.project, selectedMark.id) }), {
            class: "ui-btn ui-btn--wide",
            title: strings.tools.changeTypeHint,
            on: { click: () => changeSelectedType() },
          })
        : null,
      uiEl("p", { class: "tools__label", text: strings.tools.mode }),
      modeRow,
      uiEl("p", { class: "tools__note", text: modeNote }),
      uiEl("p", { class: "tools__label" + (blockOff ? " tools__label--off" : ""), text: strings.tools.block }),
      blockSelect,
    ];
    box.replaceChildren(...parts.filter(Boolean));
  }

  subscribe((state, changed) => {
    if (
      "project" in changed ||
      "activeTypeId" in changed ||
      "mode" in changed ||
      "selectedMarkIds" in changed ||
      "schemeId" in changed
    ) {
      render();
    }
  });
  onHistoryChange(render);
  render();
}

/**
 * Поля «Интерфейса» — размер меток и подписей, шрифт, слои, сетка, развёртка и
 * масштаб того поля, которое на экране.
 *
 * **Все переключатели показа собраны здесь** (таск 187, G281). Слова заказчика:
 * «пункт „Слои“ убери, это же дубль вкладки Интерфейс проекта, просто почини то
 * бы там работало и добавь недостающие пункты. Ну и в интерфейсе убери описания
 * у пунктов». Описания ушли в подсказки, слои чертежа (сетка, шаг, притяжка)
 * пришли сюда из колонки.
 *
 * **И раздел один и тот же во всех трёх режимах** (таск 193, G293). Таск 187
 * показывал в каждом режиме только те отметки, которые в нём меняют картинку, —
 * заказчик решил иначе и лучше: «Сделай что бы сетка была и на схеме… И линейку
 * в чертеже и т.д. Короче меню Интерфейс не должно отличаться от режима
 * чертеж\схема». То есть пункт не прячут, а **учат работать**: сетка легла на
 * план, линейка — в чертёж. Прятать по режимам больше нельзя; на каком поле
 * пункт меняет картинку — говорит его подсказка.
 *
 * Разбор по пунктам (чтобы следующий не «починил» это обратно):
 *
 *   «Метки», «Подписи», «Шрифт» — размер и рисунок подписей схемы. Живут в
 *     объекте, видны на плане и в выгрузках; в чертеже и в объёме меток нет —
 *     но поля эти не про режим, а про объект, и прятать их незачем;
 *   «Линейка и направляющие» — **оба плоских поля**: деления на плане в
 *     пикселях подложки, в чертеже в миллиметрах. Направляющие ставят на
 *     плане, в чертеже они видны там, где у него есть мост в миллиметры;
 *   «Сетка, шаг в мм» с пунктом «Без сетки» — **оба плоских поля**, шаг один и
 *     тот же (он в объекте, G258);
 *   «Притягивать к узлам» — честно **про чертёж**: вершины стен садятся на
 *     узлы. Метку на плане кликом ставят по фотографии помещения, и притянуть
 *     её к сетке значило бы сдвинуть разметку, о которой никто не просил.
 *     При «Без сетки» гаснет с причиной;
 *   «Подложка», «Чертёж» — оба плоских поля (так было с таска 187);
 *   «Объекты чертежа» — все три режима;
 *   «Развёртка выделенной стены» — оба плоских поля: в объёме стену не
 *     выделяют;
 *   «Масштаб» — поле, которое на экране; в объёме гаснет с причиной (там
 *     отходят и приближаются камерой).
 *
 * **Одна сборка на два места** (таск 175, G272). На большом экране это раздел
 * левой колонки; на узком экрана раздела нет вовсе, и те же поля приходят
 * окном по кнопке в шапке. Второй сборки здесь быть не должно: разойдись они —
 * и человек, покрутивший подписи с телефона, не нашёл бы этого переключателя
 * за столом.
 *
 * Возвращает узел и `dispose`: подписка на состояние живёт, пока жив узел, а
 * окно закрывается — и подписку надо снять, иначе она рисовала бы в
 * выброшенный из разметки ящик.
 */
export function createSizesFields(api) {
  const { getState, setState, subscribe, notify } = api;
  const box = uiEl("div", { class: "tools" });
  // Снимок объекта на время жеста ползунка: пока он есть, раздел не
  // перерисовывается — иначе ползунок исчезал бы из-под пальца.
  let sizeBefore = null;

  function setSize(key, value) {
    const state = getState();
    if (!state.project) return;
    if (!sizeBefore) sizeBefore = state.project;
    setState({ project: updateProject(state.project, { view: { ...state.project.view, [key]: value } }).project });
  }

  // Конец жеста: один шаг истории на всё перетаскивание ползунка.
  function commitSize() {
    if (!sizeBefore) return;
    const before = sizeBefore;
    sizeBefore = null;
    const after = getState().project;
    if (after !== before) canvasCommit(before, after, strings.history.viewSize);
    render();
  }

  // ——— сетка: шаг в объекте, «Без сетки» в настройках (таск 187, 193) ———
  //
  // Шаг принадлежит объекту (G258), поэтому его смена — шаг истории: иначе
  // Ctrl+Z после смены сетки вернул бы метку, а сетку — молча и заодно.
  //
  // А «Без сетки» — **первый пункт того же списка** (таск 193, G293: «вместо
  // галки сделай просто пункт в Шаге - Без сетки»), и живёт он в настройках
  // браузера, как подложка и чертёж: в объект от него не пишется ничего, шаг
  // остаётся прежним, и старый файл открывается как закрывался (G68). Поэтому
  // история этот выбор и не трогает — отменять нечего.
  const gridSelect = uiEl("select", {
    class: "ui-input tools__select",
    title: strings.tools.gridStepHint,
    on: {
      change: () => {
        const choice = workshopGridChoice(gridSelect.value);
        if (!choice) return;
        const state = getState();
        if (!choice.shown) {
          setState({ gridShown: false });
          setSetting(GRID_SETTING, false);
          render();
          return;
        }
        // Выбрали число — сетка заодно и зажигается: человек выбирает шаг,
        // чтобы её видеть, а не чтобы оставить её погашенной.
        if (state.gridShown === false) {
          setState({ gridShown: true });
          setSetting(GRID_SETTING, true);
        }
        if (!state.project) {
          render();
          return;
        }
        // Шаг, которым объект и так живёт, в него не пишется (G68): вернуться
        // из «Без сетки» к тому же числу — это не правка объекта, и объект,
        // у которого ключа не было вовсе, его не получает. Живой прогон таска
        // 193 поймал ровно это: выбор «100» на объекте без ключа дописывал ему
        // `view.gridStepMm` и менял `updatedAt` ни за что.
        if (gridStepOf(state.project) !== choice.stepMm) {
          try {
            const next = setGridStep(state.project, choice.stepMm);
            if (next.changed) canvasCommit(state.project, next.project, strings.history.gridStep);
          } catch (error) {
            notify(error.message, "error");
          }
        }
        render();
      },
    },
  });
  let gridOptionsKey = "";

  // Список шагов пересобирается только когда он и правда другой (сменился
  // объект с чужим числом): `replaceChildren` на каждом кадре схлопывал бы
  // список, раскрытый под рукой.
  function syncGridSelect(state) {
    const step = gridStepOf(state.project);
    const options = workshopGridOptions(step);
    const key = options.join(",");
    if (key !== gridOptionsKey) {
      gridOptionsKey = key;
      gridSelect.replaceChildren(
        uiEl("option", { value: WORKSHOP_GRID_OFF, text: strings.tools.gridOff }),
        ...options.map((value) => uiEl("option", { value: String(value), text: String(value) })),
      );
    }
    gridSelect.value = workshopGridValue(state.gridShown, step);
    return gridSelect;
  }

  /**
   * Кого можно подложить под этот чертёж (таск 208, G315) — чистый счёт, и он
   * же отвечает на «накладывать нечего».
   *
   * Берутся схемы **со стенами**: подложить нечего у той, которую не чертили,
   * а наложение показывает только стены. Своя схема исключена всегда — калька
   * из самой себя ничего не показала бы.
   */
  function overlayOptions(project, schemeId) {
    if (!project || !schemeId) return [];
    return schemesInOrder(project)
      .filter((scheme) => scheme.id !== schemeId && wallsOnScheme(project, scheme.id).length > 0)
      .map((scheme) => ({ id: scheme.id, name: scheme.name }));
  }

  function overlayTitle(state) {
    return overlayOptions(state.project, state.schemeId).length === 0
      ? strings.tools.overlayNone
      : strings.tools.overlayHint;
  }

  // Выбор кальки. Значение, указывающее на схему, которой в списке нет (её
  // удалили, или она же и открыта), читается как «нет»: показывать имя того,
  // чего на поле не видно, нельзя.
  function overlaySelect(state) {
    const options = overlayOptions(state.project, state.schemeId);
    const current = options.some((item) => item.id === state.overlaySchemeId) ? state.overlaySchemeId : "";
    const select = uiEl(
      "select",
      {
        class: "ui-input",
        on: { change: (event) => setState({ overlaySchemeId: event.target.value || null }) },
      },
      [
        uiEl("option", { value: "", text: strings.tools.overlayOff }),
        ...options.map((item) => uiEl("option", { value: item.id, text: item.name })),
      ],
    );
    select.value = current || "";
    select.disabled = options.length === 0;
    return select;
  }

  /**
   * Строка слоя: отметка, слово и **причина в подсказке**, а не описанием под
   * галкой (таск 187, G281 — «в интерфейсе убери описания у пунктов»).
   */
  function layerRow(state, key, setting, label, title, options = {}) {
    const row = uiEl("label", { class: "tools__field tools__field--check", title: options.reason || title }, [
      toolsLayerCheck(state, setState, key, setting),
      uiEl("span", { text: label }),
    ]);
    if (options.off) {
      const input = row.querySelector("input");
      input.disabled = true;
      input.checked = false;
    }
    return row;
  }

  function render() {
    const state = getState();
    // Размеры — одной дверью (`projectViewSizes`). Здесь стояло
    // `state.project ? state.project.view : {…}`, и защищалось это от «нет
    // объекта», а не от «объект без поля `view`». На таком объекте `sizes`
    // оказывался `undefined`, `sizes.markSize` бросал ошибку, `setState` её
    // ловил — и вместо раздела «Размеры» человек получал английский текст
    // исключения в плашке (находка 3 разбора механик).
    const sizes = projectViewSizes(state.project);
    // ——— состав один и тот же во всех режимах (таск 193, G293) ————————
    //
    // Что в каком режиме меняет картинку — сказано в подсказках, а не
    // отсутствием пункта. Режим спрашивается только там, где у поля и правда
    // **разная работа**: ряд масштаба зовёт то поле, которое на экране, а
    // кнопки «Задать масштаб» и «Привязать чертёж» — это действия чертежа, и
    // показываются они тогда, когда им есть что сделать.
    const screen = state.screen;
    const drawing = screen === "drawing";
    const plan = screen === "scheme";
    // Подложку в чертёж не положить без масштаба — и это не решение, а
    // арифметика: миллиметру не от чего считаться в пикселях плана. Отметка в
    // таком случае гаснет, а причина стоит в её подсказке, а рядом — кнопка,
    // которая эту причину снимает.
    const spot = drawing ? workshopPlacement(state.project, state.schemeId) : null;
    const planOff = Boolean(spot) && spot.kind !== "ready";
    const planReason = !spot
      ? ""
      : spot.kind === "noImage"
        ? strings.tools.planLayerNone
        : spot.kind === "noScale"
          ? strings.tools.planLayerNoScale
          : "";
    // «Без сетки» выбрано — притягиваться не к чему: узлов нет. Отметка гаснет
    // **с причиной** (таск 193), а не висит мёртвой.
    const gridOff = state.gridShown === false;
    // На плане сетка видна только там, где есть мост в миллиметры: калибровка
    // и привязка. Сказать об этом надо в подсказке — иначе человек снимает
    // «Без сетки» и не понимает, почему ничего не появилось.
    const planBridge = plan && state.project && state.schemeId ? workshopPlacement(state.project, state.schemeId) : null;
    const gridNoBridge = Boolean(planBridge) && planBridge.kind !== "ready";
    const parts = [
      uiEl("label", { class: "tools__field" }, [
        uiEl("span", { text: strings.tools.markSize }),
        toolsSlider(sizes.markSize, TOOLS_MARK_SIZE, (value) => setSize("markSize", value), commitSize),
      ]),
      uiEl("label", { class: "tools__field" }, [
        uiEl("span", { text: strings.tools.labelSize }),
        toolsSlider(sizes.labelSize, TOOLS_LABEL_SIZE, (value) => setSize("labelSize", value), commitSize),
      ]),
      // Шрифт подписей — сразу под их размером, а «только на экране» ушло в
      // подсказку: строка под полем растила раздел, повторяя то же словами.
      uiEl("label", { class: "tools__field", title: strings.tools.fontHint }, [
        uiEl("span", { text: strings.tools.font }),
        toolsFontSelect(state, setState),
      ]),
      uiEl("p", { class: "tools__label", text: strings.tools.layers }),
      // Линейка и направляющие — оснастка **обоих плоских полей** (таск 193):
      // в чертеже деления в миллиметрах, на плане — в пикселях подложки.
      uiEl("label", { class: "tools__field tools__field--check", title: strings.tools.guidesHint }, [
        toolsGuidesCheck(state, setState),
        uiEl("span", { text: strings.tools.guides }),
      ]),
      // Подложка и чертёж — два слоя, и **одна отметка на оба поля** (таск
      // 187): прежде в чертеже работала своя пара галок, а эта молчала.
      layerRow(state, "planShown", PLAN_SETTING, strings.tools.planLayer, strings.tools.planLayerHint, {
        off: planOff,
        reason: planReason,
      }),
      // Две двери рядом с погашенной подложкой: уйти на план за масштабом и
      // привязать чертёж к подложке. Показываются ровно тогда, когда им есть
      // что сделать, — и только если поверхность чертежа уже собрана.
      drawing && spot && spot.kind === "noScale" && workshopViewReady()
        ? uiButton(strings.workshop.calibrate, {
            class: "ui-btn ui-btn--wide",
            title: strings.workshop.calibrateHint,
            on: { click: () => workshopCalibratePlan() },
          })
        : null,
      drawing && spot && spot.pending && workshopViewReady()
        ? uiButton(strings.workshop.attach, {
            class: "ui-btn ui-btn--wide",
            title: strings.workshop.attachHint,
            on: { click: () => workshopAttachPlan() },
          })
        : null,
      layerRow(state, "drawingShown", DRAWING_SETTING, strings.tools.drawingLayer, strings.tools.drawingLayerHint),
      // Сетка — на обоих плоских полях, и шаг у неё один (он в объекте, G258).
      // Отдельной отметки показа нет: «Без сетки» — первый пункт этого списка.
      uiEl("label", { class: "tools__field", title: gridNoBridge ? strings.tools.gridNoBridge : strings.tools.gridStepHint }, [
        uiEl("span", { text: strings.tools.gridStep }),
        syncGridSelect(state),
      ]),
      layerRow(state, "gridSnap", GRID_SNAP_SETTING, strings.tools.gridSnap, strings.tools.gridSnapHint, {
        off: gridOff,
        reason: gridOff ? strings.tools.gridSnapOff : "",
      }),
      // Наложенный чужой чертёж (таск 208, G315). Слова заказчика: «нужно
      // наложение чертежей, что бы подогнать один к другому. Также через меню
      // интерфейса и только стены и другим цветом».
      //
      // Выбор схемы, а не отметка «да/нет»: планов в объекте бывает три и
      // пять, и «наложено» без имени не отвечает на «что я вижу». Список —
      // модельный (`schemesInOrder`), в нём только те схемы, у которых есть
      // что наложить, и никогда не своя. Накладывать нечего — ряд гаснет с
      // причиной в подсказке, как гаснет подложка без масштаба.
      //
      // Стоит он здесь во всех трёх режимах, как и остальные пункты (таск 193,
      // G293), а рисует наложенное только чертёж — об этом и говорит подсказка.
      uiEl("label", { class: "tools__field", title: overlayTitle(state) }, [
        uiEl("span", { text: strings.tools.overlay }),
        overlaySelect(state),
      ]),
      // Вещи чертежа (таск 154, G223) — работают во всех трёх режимах: гасят
      // их и на плане, и в чертеже, и в объёме.
      layerRow(state, "objectsShown", OBJECTS_SETTING, strings.tools.objectsLayer, strings.tools.objectsLayerHint),
      // Полоса развёртки выделенной стены — над планом и над чертежом (G185,
      // G227). В объёме стену не выделяют, и полосы там нет — об этом говорит
      // подсказка, а не отсутствие пункта.
      layerRow(state, "elevationShown", ELEVATION_SETTING, strings.tools.elevationStrip, strings.tools.elevationStripHint),
      // ——— масштаб того поля, которое на экране (G227) ————————————————
      //
      // Заказчик: «Кнопки + − и вписать дублируются, есть в нижнем блоке с
      // интерфейсом, но в режиме чертёж они не работают сейчас. Убери сверху, а
      // снизу почини для чертежа».
      //
      // Поэтому ряд один, а поле у него то, которое показано: в «Схеме» — план,
      // в «Чертеже» — чертёж. В «Объёме» масштаба нет вовсе: там отходят и
      // приближаются колесом, а «всю схему» показывает своя кнопка, — и ряд
      // гаснет с причиной в подсказке, а не делает вид, что работает.
      uiEl("p", { class: "tools__label", text: strings.tools.zoom }),
      toolsZoomRow(state),
    ];
    box.replaceChildren(...parts.filter(Boolean));
  }

  const stop = subscribe((state, changed) => {
    if (sizeBefore) return;
    if (
      "project" in changed ||
      "guidesShown" in changed ||
      "planShown" in changed ||
      "drawingShown" in changed ||
      "gridShown" in changed ||
      "gridSnap" in changed ||
      "objectsShown" in changed ||
      "elevationShown" in changed ||
      // Калька выбрана или снята (таск 208): ряд обязан показать выбранное.
      "overlaySchemeId" in changed ||
      "schemeFont" in changed ||
      // Состав раздела и ряд масштаба смотрят на то поле, которое показано:
      // в каждом режиме видны те отметки, которые в нём меняют картинку.
      "screen" in changed ||
      "schemeId" in changed
    ) {
      render();
    }
  });
  render();
  return { node: box, dispose: stop };
}

// Раздел левой колонки: та же сборка полей, своей у раздела нет. Подписку он
// не снимает — раздел живёт столько же, сколько страница.
function mountSizesPanel(host, api) {
  host.replaceChildren(createSizesFields(api).node);
}

/**
 * «Интерфейс проекта» окном (таск 175, G272). Слова заказчика: «в мобильной
 * вёрстке добавь кнопку в шапку „Интерфейс проекта“, которая откроет тоже
 * самое, что в левой колонке, но в окне».
 *
 * Окно, а не лист снизу: лист занят колонками (схемы и метки), и третья
 * кнопка в нижнем ряду сломала бы ряд из трёх равных. Окно к тому же само
 * забирает клавиатуру и закрывается Escape, как остальные.
 */
function openSizesWindow(api) {
  const fields = createSizesFields(api);
  let modal;
  const close = () => {
    modal.close();
    fields.dispose();
  };
  modal = uiModal({
    title: strings.panels.sizes,
    body: fields.node,
    actions: [uiButton(strings.dialog.close, { class: "ui-btn ui-btn--accent", on: { click: () => close() } })],
    // Escape и нажатие мимо закрывают окно мимо кнопки — подписку снимаем и там.
    onCancel: () => fields.dispose(),
  });
}

// Кнопка в шапке. Стоит рядом со значком принтера — обе открывают, а не
// правят, — и только на узкой раскладке: на большом экране раздел на своём
// месте в колонке, и вторая дверь к тем же полям там лишняя.
function mountSizesButton(host, api) {
  const { getState, subscribe } = api;
  const button = uiIconButton("sliders", {
    label: strings.panels.sizes,
    title: strings.tools.sizesWindow,
    on: { click: () => openSizesWindow(api) },
  });
  host.replaceChildren(button);

  function render() {
    const layout = getState().layout;
    host.hidden = layout !== "mobile" || !layoutAllows("viewSizes", layout);
  }

  subscribe((state, changed) => {
    if ("layout" in changed) render();
  });
  render();
}

// Отмена — в шапке: она возвращает не только метки, но и помещения, схемы и
// справочник, и в разделе «Метки» обещала меньше, чем делает. В режиме
// просмотра её нет вовсе: отменять там нечего.
function mountHistoryPanel(host, api) {
  const { getState, subscribe } = api;
  // Значки вместо слов: в шапке рядом с ними живут объект, поиск, выгрузка и
  // файл, и два слова забирали место у того, что словами не скажешь. Что
  // именно отменится — в подсказке, она же называет горячую клавишу.
  const undoButton = uiIconButton("undo", {
    label: strings.tools.undo,
    on: { click: () => canvasUndoStep() },
  });
  const redoButton = uiIconButton("redo", {
    label: strings.tools.redo,
    on: { click: () => canvasRedoStep() },
  });
  host.replaceChildren(uiEl("div", { class: "history-actions" }, [undoButton, redoButton]));

  function render() {
    const shown = layoutAllows("undo", getState().layout);
    host.hidden = !shown;
    if (!shown) return;
    undoButton.disabled = !canUndo();
    redoButton.disabled = !canRedo();
    // Отменять нечего — называть нечего: подсказка остаётся действием и
    // клавишей, без двоеточия в пустоту.
    const undoWhat = undoLabel();
    const redoWhat = redoLabel();
    undoButton.title = undoWhat ? text("tools.undoTitle", { label: undoWhat }) : strings.tools.undoTitlePlain;
    redoButton.title = redoWhat ? text("tools.redoTitle", { label: redoWhat }) : strings.tools.redoTitlePlain;
  }

  subscribe((state, changed) => {
    if ("layout" in changed) render();
  });
  onHistoryChange(render);
  render();
}

registerPanel(PANEL_IDS.tools, mountToolsPanel);
registerPanel(PANEL_IDS.headerHistory, mountHistoryPanel);
registerPanel(PANEL_IDS.sizes, mountSizesPanel);
registerPanel(PANEL_IDS.headerSizes, mountSizesButton);
