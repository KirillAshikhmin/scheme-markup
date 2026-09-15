// Панель инструментов: выбранный тип, что ставим, режим блока, размеры,
// масштаб и отмена. Тип показан крупно и «залипает» — по нему видно, что
// следующий клик по плану поставит именно его.
import { PANEL_IDS, registerPanel } from "../app.js";
import { strings, text } from "../strings.js";
import { BLOCK_MODES, changeMarkType, findMark, findType, labelOf, styleOf, updateProject, updateType } from "../model.js";
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
  // Снимок объекта на время жеста ползунка: пока он есть, панель не
  // перерисовывается — иначе ползунок исчезал бы из-под пальца.
  let sizeBefore = null;

  function activeType(state) {
    return state.project && state.activeTypeId ? findType(state.project, state.activeTypeId) : null;
  }

  async function chooseType(nextMode) {
    const state = getState();
    if (!state.project) return;
    const picked = await openTypePicker(state.project, { activeTypeId: state.activeTypeId });
    if (!picked) return;
    const fresh = getState();
    const mode = nextMode || (fresh.mode === "line" ? "line" : "point");
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
    const picked = await openTypePicker(state.project, { title: strings.tools.changeType });
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

  function setBlockMode(mode) {
    const state = getState();
    const type = activeType(state);
    if (!type) return;
    canvasCommit(state.project, updateType(state.project, type.id, { blockMode: mode }).project, strings.history.blockMode);
  }

  function render() {
    const state = getState();
    const type = activeType(state);
    const sizes = state.project ? state.project.view : { markSize: 10, labelSize: 12 };
    const selected = state.selectedMarkIds.length > 0;

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
          ]
        : [uiEl("span", { class: "tools__typeName", text: strings.tools.noType })],
    );

    const modeRow = uiEl("div", { class: "tools__row tools__row--modes" }, [
      uiButton(strings.tools.selectMode, {
        class: "ui-btn" + (state.mode === "select" ? " is-active" : ""),
        on: { click: () => setMode("select") },
      }),
      uiButton(strings.tools.kindPoint, {
        class: "ui-btn" + (state.mode === "point" ? " is-active" : ""),
        title: strings.tools.kindPointHint,
        on: { click: () => setMode("point") },
      }),
      uiButton(strings.tools.kindLine, {
        class: "ui-btn" + (state.mode === "line" ? " is-active" : ""),
        title: strings.tools.kindLineHint,
        on: { click: () => setMode("line") },
      }),
    ]);

    const blockSelect = uiEl(
      "select",
      {
        class: "ui-select",
        title: strings.tools.blockHint,
        on: { change: (event) => setBlockMode(event.target.value) },
      },
      BLOCK_MODES.map((mode) =>
        uiEl("option", { text: strings.blockMode[mode], value: mode, attrs: { value: mode } }),
      ),
    );
    if (type) blockSelect.value = type.blockMode || "each";
    blockSelect.disabled = !type;

    const undoButton = uiButton(strings.tools.undo, {
      title: text("tools.undoTitle", { label: undoLabel() }),
      on: { click: () => canvasUndoStep() },
    });
    const redoButton = uiButton(strings.tools.redo, {
      title: text("tools.redoTitle", { label: redoLabel() }),
      on: { click: () => canvasRedoStep() },
    });
    undoButton.disabled = !canUndo();
    redoButton.disabled = !canRedo();

    box.replaceChildren(
      uiEl("p", { class: "tools__label", text: strings.tools.type }),
      typeButton,
      uiButton(strings.tools.changeType, {
        class: "ui-btn ui-btn--wide",
        title: selected ? strings.tools.changeTypeHint : strings.tools.noSelection,
        on: { click: () => changeSelectedType() },
        attrs: selected ? {} : { disabled: "disabled" },
      }),
      uiEl("p", { class: "tools__label", text: strings.tools.kind }),
      modeRow,
      uiEl("p", { class: "tools__label", text: strings.tools.block }),
      blockSelect,
      uiEl("p", { class: "tools__label", text: strings.tools.sizes }),
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
      uiEl("div", { class: "tools__row" }, [undoButton, redoButton]),
    );
  }

  subscribe((state, changed) => {
    if (sizeBefore) return;
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

registerPanel(PANEL_IDS.tools, mountToolsPanel);
