// Два раздела левой колонки. «Метки» — всё про постановку: выбранный тип,
// что ставим, режим блока, отмена. Тип показан крупно и «залипает» — по нему
// видно, что следующий клик по плану поставит именно его. «Размеры» — размер
// меток и подписей и масштаб плана.
//
// Обводки помещений здесь нет вовсе: контур принадлежит комнате, а не метке,
// и запускается из раздела «Помещения» — там и список комнат, и кнопки
// контуров. В этом разделе остаются только режимы про метки.
import { layoutAllows, PANEL_IDS, registerPanel } from "../app.js";
import { strings, text } from "../strings.js";
import {
  BLOCK_MODES,
  changeMarkType,
  findMark,
  findType,
  labelOf,
  styleOf,
  typeKindOf,
  updateProject,
  updateType,
} from "../model.js";
import { uiEl, uiButton } from "./ui.js";
import { openTypePicker } from "./typePicker.js";
import { shapeIcon } from "../render.js";
import { canUndo, canRedo, onHistoryChange, undoLabel, redoLabel } from "../history.js";
import {
  canvasCommit,
  canvasFitPlan,
  canvasRedoStep,
  canvasUndoStep,
  canvasZoomBy,
  canvasZoomReset,
} from "../canvas.js";

const TOOLS_MARK_SIZE = { min: 4, max: 36 };
const TOOLS_LABEL_SIZE = { min: 8, max: 40 };
// Крупный значок выбранного типа: цвет категории и форма из справочника,
// нарисованные тем же `render.shapeIcon`, что в списках и на плане.
function toolsTypeIcon(project, typeId, size = 26) {
  const style = styleOf(project, typeId);
  return shapeIcon(style.shape, style.color, size);
}

// Ползунок двигается живьём, а в историю попадает одним действием на всё
// перетаскивание: иначе стек забивался бы тридцатью шагами на один жест.
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
      kind: mark.kind === "line" ? "line" : "point",
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

    // Режимов два: выделение и добавление. Что именно добавится — точка или
    // ломаная, — решает вид выбранного типа, и строка под кнопками говорит
    // ровно это. Третьей кнопки нет: выбор вида руками пользователя только
    // путал, когда он уже выбрал тип. Строка нужна именно словами: по одному
    // значку типа не видно, ставится метка кликом или тянется линией.
    const modeNote = !kind
      ? strings.canvas.needType
      : kind === "line"
        ? strings.tools.kindLineHint
        : strings.tools.kindPointHint;
    const modeRow = uiEl("div", { class: "tools__row tools__row--modes" }, [
      uiButton(strings.tools.selectMode, {
        class: "ui-btn" + (state.mode === "select" ? " is-active" : ""),
        title: strings.tools.selectModeHint,
        on: { click: () => setMode("select") },
      }),
      uiButton(strings.tools.addMode, {
        class: "ui-btn" + (state.mode === "add" ? " is-active" : ""),
        // Типа нет — кнопка откроет окно выбора, про точку ей обещать нечего.
        title: modeNote,
        on: { click: () => setMode("add") },
      }),
    ]);

    // Блок собирается только из точек — ручки «+» у линии нет и быть не может.
    // При линейном типе выбор гаснет и говорит почему: живой на вид список,
    // который ни на что не влияет, — обещание, которого сборка не держит.
    const blockOff = !type || kind === "line";
    const blockSelect = uiEl(
      "select",
      {
        class: "ui-select",
        title: kind === "line" ? strings.tools.blockLineHint : strings.tools.blockHint,
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
      selectedMark
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

// Раздел «Размеры»: размер меток и подписей, масштаб плана.
function mountSizesPanel(host, api) {
  const { getState, setState, subscribe } = api;
  const box = uiEl("div", { class: "tools" });
  host.replaceChildren(box);
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

  function render() {
    const state = getState();
    const sizes = state.project ? state.project.view : { markSize: 10, labelSize: 12 };
    box.replaceChildren(
      uiEl("label", { class: "tools__field" }, [
        uiEl("span", { text: strings.tools.markSize }),
        toolsSlider(sizes.markSize, TOOLS_MARK_SIZE, (value) => setSize("markSize", value), commitSize),
      ]),
      uiEl("label", { class: "tools__field" }, [
        uiEl("span", { text: strings.tools.labelSize }),
        toolsSlider(sizes.labelSize, TOOLS_LABEL_SIZE, (value) => setSize("labelSize", value), commitSize),
      ]),
      uiEl("p", { class: "tools__label", text: strings.tools.zoom }),
      uiEl("div", { class: "tools__row" }, [
        uiButton("−", { title: strings.tools.zoomOut, on: { click: () => canvasZoomBy(1 / 1.25) } }),
        uiButton("+", { title: strings.tools.zoomIn, on: { click: () => canvasZoomBy(1.25) } }),
        uiButton(strings.tools.zoomFit, { on: { click: () => canvasFitPlan() } }),
        uiButton(strings.tools.zoomReset, { on: { click: () => canvasZoomReset() } }),
      ]),
    );
  }

  subscribe((state, changed) => {
    if (sizeBefore) return;
    if ("project" in changed) render();
  });
  render();
}

// Отмена — в шапке: она возвращает не только метки, но и помещения, схемы и
// справочник, и в разделе «Метки» обещала меньше, чем делает. В режиме
// просмотра её нет вовсе: отменять там нечего.
function mountHistoryPanel(host, api) {
  const { getState, subscribe } = api;
  const undoButton = uiButton(strings.tools.undo, { on: { click: () => canvasUndoStep() } });
  const redoButton = uiButton(strings.tools.redo, { on: { click: () => canvasRedoStep() } });
  host.replaceChildren(uiEl("div", { class: "history-actions" }, [undoButton, redoButton]));

  function render() {
    const shown = layoutAllows("undo", getState().layout);
    host.hidden = !shown;
    if (!shown) return;
    undoButton.disabled = !canUndo();
    redoButton.disabled = !canRedo();
    undoButton.title = text("tools.undoTitle", { label: undoLabel() });
    redoButton.title = text("tools.redoTitle", { label: redoLabel() });
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
