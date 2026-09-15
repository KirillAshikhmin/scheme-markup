// Холст разметки: план, метки, блоки, ломаные, выделение и отмена.
//
// Главное правило места: заказчик сегодня размечает план ручкой по распечатке.
// Поэтому диалог тут ровно один — выбор типа, и открывается он один раз на серию.
// Дальше клик ставит метку, а ручки «+» у поставленной точки продолжают блок,
// не спрашивая ничего. Всё остальное (панель инструментов, список меток) —
// вокруг, но не между рукой и планом.
//
// Координаты: в объекте — доли плана (0…1), на экране — пиксели холста.
// Переводит их только render.js; здесь координаты не пересчитываются руками.
import { PANEL_IDS, registerPanel } from "./app.js";
import { strings, text } from "./strings.js";
import {
  BLOCK_STEP_PX,
  OUTLINE_MIN_POINTS,
  addMark,
  addOutline,
  addToGroup,
  applyRoomOutlines,
  deleteMark,
  deleteOutline,
  findScheme,
  findType,
  findMark,
  findGroup,
  findOutline,
  findRoom,
  insertOutlinePoint,
  labelOf,
  moveOutlinePoint,
  removeOutlinePoint,
  styleOf,
  updateMark,
} from "./model.js";
import {
  drawHandles,
  drawOutlineHandles,
  drawScheme,
  fitView,
  hitHandle,
  hitOutline,
  hitTest,
  labelBox,
  markRadius,
  planToScreen,
  screenToPlan,
} from "./render.js";
import { canRedo, canUndo, clearHistory, pushCommand, redo, undo } from "./history.js";
import { uiConfirm, uiDialogDepth } from "./panels/ui.js";

const CANVAS_ZOOM_MIN = 0.04;
const CANVAS_ZOOM_MAX = 24;
// Смещение курсора, после которого клик считается перетаскиванием.
const CANVAS_DRAG_SLOP = 3;

let canvasHost = null;
let canvasNode = null;
let canvasCtx = null;
let canvasApi = null;
let canvasDraft = null; // черновик ломаной: {points, cursor}
let canvasDrag = null;
let canvasPreview = null; // объект во время перетаскивания — в состояние не пишется
let canvasPointers = new Map();
let canvasPinch = null;
let canvasSpace = false;
let canvasFrame = 0;
let canvasFitted = null;
let canvasProjectId = null;

function canvasState() {
  return canvasApi ? canvasApi.getState() : null;
}

// Во `view` для рисования сходятся две половины: масштаб и сдвиг — сеансовые,
// размеры метки и подписи — из объекта (их двигает ползунок в панели).
function canvasViewOf(state) {
  const sizes = state.project && state.project.view ? state.project.view : {};
  return { ...state.view, markSize: sizes.markSize, labelSize: sizes.labelSize };
}

function canvasScheme(state) {
  return state.project && state.schemeId ? findScheme(state.project, state.schemeId) : null;
}

function canvasImage(state) {
  const loaded = state.schemeImage;
  return loaded && loaded.schemeId === state.schemeId ? loaded.image : null;
}

function canvasProject(state) {
  return canvasPreview || state.project;
}

function canvasPointOf(event) {
  const box = canvasNode.getBoundingClientRect();
  return { x: event.clientX - box.left, y: event.clientY - box.top };
}

// ——— рисование ———————————————————————————————————————————————————————

function canvasRedraw() {
  if (canvasFrame || !canvasNode) return;
  const schedule = typeof requestAnimationFrame === "function" ? requestAnimationFrame : (fn) => setTimeout(fn, 16);
  canvasFrame = schedule(() => {
    canvasFrame = 0;
    canvasPaint();
  });
}

function canvasResize() {
  if (!canvasNode || !canvasHost) return;
  const ratio = window.devicePixelRatio || 1;
  const width = Math.max(1, canvasHost.clientWidth);
  const height = Math.max(1, canvasHost.clientHeight);
  canvasNode.style.width = width + "px";
  canvasNode.style.height = height + "px";
  canvasNode.width = Math.round(width * ratio);
  canvasNode.height = Math.round(height * ratio);
  canvasPaint();
}

function canvasPaint() {
  if (!canvasCtx || !canvasNode) return;
  const ratio = window.devicePixelRatio || 1;
  const state = canvasState();
  canvasCtx.setTransform(ratio, 0, 0, ratio, 0, 0);
  canvasCtx.clearRect(0, 0, canvasNode.width, canvasNode.height);
  const scheme = canvasScheme(state);
  if (!scheme) return;
  const project = canvasProject(state);
  const view = canvasViewOf(state);
  const draftColor = canvasDraftColor(state, project);
  drawScheme(canvasCtx, {
    project,
    scheme,
    image: canvasImage(state),
    filter: state.filter,
    view,
    selectedIds: state.selectedMarkIds,
    selectedOutlineId: state.selectedOutlineId || null,
    draft: canvasDraft,
    draftColor,
  });
  // Ручки контура — у выделенного помещения: вершину двигают, «+» на стенке
  // добавляет новую. Обводка по стенам с первого раза не выходит.
  const outline = state.selectedOutlineId ? findOutline(project, state.selectedOutlineId) : null;
  if (outline && outline.schemeId === scheme.id && !canvasDrag) {
    drawOutlineHandles(canvasCtx, scheme, outline, view);
  }
  // Ручки «+» — только у одной выделенной точки: у линии блока не бывает.
  if (state.selectedMarkIds.length === 1 && !canvasDrag) {
    const mark = findMark(project, state.selectedMarkIds[0]);
    if (mark && mark.kind === "point" && mark.schemeId === scheme.id) {
      drawHandles(canvasCtx, scheme, mark, view, canvasHandleColor(state, mark));
    }
  }
}

// Цвет черновика: у контура помещения — цвет комнаты, у метки — цвет её типа.
function canvasDraftColor(state, project) {
  if (state.mode === "room") {
    const room = state.activeRoomId ? findRoom(project, state.activeRoomId) : null;
    return (room && room.color) || "#0969da";
  }
  return state.activeTypeId ? styleOf(project, state.activeTypeId).color : "#0969da";
}

// ——— изменения объекта ————————————————————————————————————————————————

// Любая правка объекта проходит здесь — и с холста, и из панели инструментов:
// команда отмены получает снимки «до» и «после», которые вернула модель, плюс
// схему и выделение, на которых действие произошло. Иначе Ctrl+Z после
// переключения схемы правит метки на той, которую не видно.
// Своего мутатора объекта в холсте нет.
// Ключи, которые понимает команда. Список закрытый нарочно: четвёртым
// аргументом когда-то был список выделения, потом стал объект опций — и массив
// от старого вызова молча превращался в опции без `selection`. Поставленная
// метка переставала выделяться: ни ручек «+» рядом с ней, ни живой кнопки
// «Сменить тип», и так четыре таска. Опечатка `selecton:` дала бы то же самое
// молчание, поэтому неизвестный ключ — отказ, а не подстановка по умолчанию.
const CANVAS_COMMIT_KEYS = ["selection", "schemeId", "patch"];

export function canvasCommitOptions(options) {
  if (options == null) return {};
  if (typeof options !== "object" || Array.isArray(options)) {
    throw canvasOptionError("commitOptionsNotObject", { keys: CANVAS_COMMIT_KEYS.join(", ") });
  }
  const unknown = Object.keys(options).filter((key) => !CANVAS_COMMIT_KEYS.includes(key));
  if (unknown.length > 0) {
    throw canvasOptionError("unknownCommitOption", { keys: unknown.join(", "), known: CANVAS_COMMIT_KEYS.join(", ") });
  }
  return options;
}

function canvasOptionError(key, vars) {
  const error = new Error(text("errors." + key, vars));
  error.code = key;
  return error;
}

export function canvasCommit(before, after, label, options = {}) {
  const { setState } = canvasApi;
  let settings;
  try {
    settings = canvasCommitOptions(options);
  } catch (error) {
    // Отказ виден и в интерфейсе: ошибка в опциях — это правка, которая не
    // случилась, и промолчать о ней значит повторить ту же историю.
    canvasFail(error);
    throw error;
  }
  const state = canvasState();
  const selectionBefore = state.selectedMarkIds;
  const schemeBefore = state.schemeId;
  const keep = settings.selection || selectionBefore;
  const schemeAfter = settings.schemeId || schemeBefore;
  // Правка сеансовых полей (активный тип, режим) едет вместе с командой:
  // возвращать объект без них — значит оставить панель показывать то, чего нет.
  // «До» для них снимается здесь же, по именам переданных полей, — вызывающий
  // передаёт только «после», иначе две половинки пары разъедутся молча.
  const patch = settings.patch || {};
  const patchBefore = {};
  for (const key of Object.keys(patch)) patchBefore[key] = state[key];
  // Единственное место, где срабатывает автопривязка меток к помещениям:
  // любая правка объекта проходит здесь, поэтому и поставленная метка, и
  // перерисованный контур доводят поля «Помещение» до порядка одним шагом
  // истории. Метка с вписанным руками помещением автоматике не достаётся.
  const binding = after && Array.isArray(after.marks) ? applyRoomOutlines(after) : { project: after, changed: [] };
  const bound = binding.project;
  // Ярлык шага называет и автопривязку, когда она что-то поменяла: «смена типа»
  // в списке отмены, за которой переехали помещения полудюжины меток, врёт.
  const step = binding.changed.length > 0 ? text("history.withRooms", { label }) : label;
  const apply = () =>
    setState({ project: bound, schemeId: schemeAfter, selectedMarkIds: canvasAlive(bound, keep), ...patch });
  apply();
  pushCommand({
    label: step,
    undo: () =>
      setState({
        project: before,
        schemeId: schemeBefore,
        selectedMarkIds: canvasAlive(before, selectionBefore),
        ...patchBefore,
      }),
    redo: apply,
  });
}

function canvasAlive(project, ids) {
  return ids.filter((id) => project.marks.some((mark) => mark.id === id));
}

function canvasFail(error) {
  canvasApi.notify(error && error.message ? error.message : String(error), "error");
}

function canvasPlacePoint(plan) {
  const state = canvasState();
  if (!state.activeTypeId) {
    canvasApi.notify(strings.canvas.needType);
    return;
  }
  try {
    const result = addMark(state.project, {
      schemeId: state.schemeId,
      typeId: state.activeTypeId,
      kind: "point",
      points: [plan],
    });
    canvasCommit(state.project, result.project, strings.history.addMark, { selection: [result.mark.id] });
  } catch (error) {
    canvasFail(error);
  }
}

// Тип, который поставит следующий клик: выбранный в панели, пока он жив
// в справочнике. Иначе — ничего, и модель повторит тип соседней метки.
function canvasPlacedTypeId(state) {
  const typeId = state.activeTypeId;
  if (!typeId || !state.project || !findType(state.project, typeId)) return null;
  return typeId;
}

// Цвет ручек «+»: выбран тип, отличный от типа метки, — ручка красится в его
// цвет, и по ней видно, что рядом встанет розетка, а не второй выключатель.
// Тип тот же или не выбран — ручка синяя, как выделение.
function canvasHandleColor(state, mark) {
  const typeId = canvasPlacedTypeId(state);
  return typeId && typeId !== mark.typeId ? styleOf(state.project, typeId).color : null;
}

// Шаг блока — не меньше умолчания модели и не меньше двух радиусов метки,
// иначе соседние точки блока сливаются в одну кляксу.
function canvasBlockStep(state) {
  const size = state.project && state.project.view ? state.project.view.markSize : 10;
  return Math.max(BLOCK_STEP_PX, size * 2.6);
}

// Ручка «+» ставит метку выбранного типа: выбрана «Р» — рядом с выключателем
// встаёт розетка со своим номером, как в настоящем подрозетнике. Активного типа
// нет (режим выделения) — модель берёт тип соседней метки.
function canvasBlockPoint(markId, side) {
  const state = canvasState();
  try {
    const result = addToGroup(state.project, markId, side, {
      step: canvasBlockStep(state),
      typeId: canvasPlacedTypeId(state),
    });
    canvasCommit(state.project, result.project, strings.history.addBlock, { selection: [result.mark.id] });
  } catch (error) {
    canvasFail(error);
  }
}

function canvasCancelDraft() {
  if (!canvasDraft) return false;
  canvasDraft = null;
  canvasRedraw();
  return true;
}

function canvasLineClick(plan, screen) {
  const state = canvasState();
  if (!state.activeTypeId) {
    canvasApi.notify(strings.canvas.needType);
    return;
  }
  canvasDraftClick(plan, screen);
}

// Контур помещения рисуется той же рукой, что и ломаная: клик — вершина,
// двойной клик по первой замыкает, Backspace убирает последнюю, Esc отменяет.
// Отличается только то, чем это заканчивается: замкнутым многоугольником
// помещения, а не линией-меткой.
function canvasOutlineClick(plan, screen) {
  const state = canvasState();
  if (!state.activeRoomId || !findRoom(state.project, state.activeRoomId)) {
    canvasApi.notify(strings.canvas.needRoom);
    return;
  }
  canvasDraftClick(plan, screen);
}

function canvasDraftClick(plan, screen) {
  const state = canvasState();
  if (!canvasDraft) {
    canvasDraft = { points: [plan], cursor: plan };
    canvasRedraw();
    return;
  }
  const scheme = canvasScheme(state);
  const view = canvasViewOf(state);
  const threshold = markRadius(view) + 6;
  const points = canvasDraft.points;
  const last = planToScreen(points[points.length - 1], scheme, view);
  const first = planToScreen(points[0], scheme, view);
  // Клик по последней или первой вершине ничего не добавляет: это первая
  // половина двойного клика, который завершает или замыкает линию.
  if (Math.hypot(screen.x - last.x, screen.y - last.y) <= threshold) return;
  if (points.length >= 2 && Math.hypot(screen.x - first.x, screen.y - first.y) <= threshold) return;
  points.push(plan);
  canvasRedraw();
}

function canvasLineFinish(closed) {
  if (!canvasDraft) return;
  const points = canvasDraft.points;
  const state = canvasState();
  if (points.length < 2) {
    canvasApi.notify(strings.canvas.lineTooShort);
    canvasCancelDraft();
    return;
  }
  try {
    const result = addMark(state.project, {
      schemeId: state.schemeId,
      typeId: state.activeTypeId,
      kind: "line",
      points,
    });
    let project = result.project;
    if (closed) project = updateMark(project, result.mark.id, { closed: true }).project;
    canvasDraft = null;
    canvasCommit(state.project, project, strings.history.addLine, { selection: [result.mark.id] });
  } catch (error) {
    canvasCancelDraft();
    canvasFail(error);
  }
}

function canvasOutlineFinish() {
  if (!canvasDraft) return;
  const points = canvasDraft.points;
  const state = canvasState();
  if (points.length < OUTLINE_MIN_POINTS) {
    canvasApi.notify(strings.canvas.outlineTooShort);
    return;
  }
  try {
    const result = addOutline(state.project, {
      schemeId: state.schemeId,
      roomId: state.activeRoomId,
      points,
    });
    canvasDraft = null;
    // Контур нарисован — дальше его правят, а не рисуют второй: режим
    // переключается на выделение, и ручки вершин сразу под рукой.
    canvasCommit(state.project, result.project, strings.history.addOutline, {
      selection: [],
      patch: { mode: "select", selectedOutlineId: result.outline.id },
    });
  } catch (error) {
    canvasCancelDraft();
    canvasFail(error);
  }
}

// Правка вершин выделенного контура: «+» на стенке добавляет вершину,
// двойной клик по вершине убирает её. Перетаскивание вершины — в canvasDragTo.
function canvasOutlineInsert(outlineId, index, plan) {
  const state = canvasState();
  try {
    const result = insertOutlinePoint(state.project, outlineId, index, plan);
    canvasCommit(state.project, result.project, strings.history.outlineVertexAdd, {
      patch: { selectedOutlineId: outlineId },
    });
  } catch (error) {
    canvasFail(error);
  }
}

function canvasOutlineRemovePoint(outlineId, index) {
  const state = canvasState();
  try {
    const result = removeOutlinePoint(state.project, outlineId, index);
    canvasCommit(state.project, result.project, strings.history.outlineVertexRemove, {
      patch: { selectedOutlineId: outlineId },
    });
  } catch (error) {
    canvasFail(error);
  }
}

async function canvasDeleteOutline() {
  const state = canvasState();
  const outline = state.selectedOutlineId ? findOutline(state.project, state.selectedOutlineId) : null;
  // Контур с другой схемы удалять нечего: выделение могло остаться с прошлой.
  if (!outline || outline.schemeId !== state.schemeId) return;
  const room = findRoom(state.project, outline.roomId);
  const agreed = await uiConfirm({
    title: strings.canvas.deleteOutlineTitle,
    message: text("canvas.deleteOutlineMessage", { name: room ? room.name : "" }),
    confirmLabel: strings.canvas.deleteOutlineConfirm,
  });
  if (!agreed) return;
  const fresh = canvasState().project;
  if (!findOutline(fresh, outline.id)) return;
  try {
    const result = deleteOutline(fresh, outline.id);
    canvasCommit(fresh, result.project, strings.history.removeOutline, {
      patch: { selectedOutlineId: null },
    });
  } catch (error) {
    canvasFail(error);
  }
}

async function canvasDeleteSelected() {
  const state = canvasState();
  const markId = state.selectedMarkIds[0];
  const mark = markId ? findMark(state.project, markId) : null;
  if (!mark) return;
  const group = mark.groupId ? findGroup(state.project, mark.groupId) : null;
  if (group) {
    const agreed = await uiConfirm({
      title: strings.canvas.deleteBlockTitle,
      message: text("canvas.deleteBlockMessage", {
        label: labelOf(state.project, mark.id),
        count: group.markIds.length,
      }),
      confirmLabel: strings.canvas.deleteConfirm,
    });
    if (!agreed) return;
  }
  const fresh = canvasState().project;
  if (!findMark(fresh, markId)) return;
  try {
    const result = deleteMark(fresh, markId);
    canvasCommit(fresh, result.project, strings.history.remove, { selection: [] });
  } catch (error) {
    canvasFail(error);
  }
}

// ——— отмена ——————————————————————————————————————————————————————————

export function canvasUndoStep() {
  if (!canUndo()) {
    canvasApi.notify(strings.canvas.nothingToUndo);
    return;
  }
  const command = undo();
  canvasApi.notify(text("canvas.undone", { label: command.label }));
}

export function canvasRedoStep() {
  if (!canRedo()) {
    canvasApi.notify(strings.canvas.nothingToRedo);
    return;
  }
  const command = redo();
  canvasApi.notify(text("canvas.redone", { label: command.label }));
}

// ——— масштаб —————————————————————————————————————————————————————————

function canvasClampZoom(zoom) {
  return Math.min(CANVAS_ZOOM_MAX, Math.max(CANVAS_ZOOM_MIN, zoom));
}

// Приближение к точке: точка плана под курсором остаётся под курсором.
function canvasZoomAt(point, factor) {
  const state = canvasState();
  const view = state.view;
  const zoom = canvasClampZoom(view.zoom * factor);
  const ratio = zoom / view.zoom;
  canvasApi.setState({
    view: {
      zoom,
      offsetX: point.x - (point.x - view.offsetX) * ratio,
      offsetY: point.y - (point.y - view.offsetY) * ratio,
    },
  });
}

export function canvasZoomBy(factor) {
  if (!canvasNode) return;
  canvasZoomAt({ x: canvasNode.clientWidth / 2, y: canvasNode.clientHeight / 2 }, factor);
}

export function canvasFitPlan() {
  const state = canvasState();
  const scheme = canvasScheme(state);
  if (!scheme || !canvasNode) return;
  canvasApi.setState({
    view: fitView(scheme, { width: canvasNode.clientWidth, height: canvasNode.clientHeight }),
  });
  canvasFitted = scheme.id;
}

export function canvasZoomReset() {
  if (!canvasNode) return;
  const state = canvasState();
  const scheme = canvasScheme(state);
  if (!scheme) return;
  canvasApi.setState({
    view: {
      zoom: 1,
      offsetX: (canvasNode.clientWidth - scheme.width) / 2,
      offsetY: (canvasNode.clientHeight - scheme.height) / 2,
    },
  });
}

// ——— указатель ———————————————————————————————————————————————————————

function canvasStartPan(point) {
  const state = canvasState();
  canvasDrag = { kind: "pan", start: point, view: { ...state.view }, moved: false };
}

function canvasPointerDown(event) {
  if (uiDialogDepth() > 0 || !canvasScheme(canvasState())) return;
  // Захват может не дать браузер (например, у синтетического события) — это не повод
  // терять клик.
  try {
    canvasNode.setPointerCapture(event.pointerId);
  } catch (error) {
    /* работаем без захвата */
  }
  canvasPointers.set(event.pointerId, canvasPointOf(event));

  // Планшет: разметка остаётся десктопной, пальцы только смотрят.
  if (event.pointerType === "touch") {
    if (canvasPointers.size === 2) {
      const [a, b] = [...canvasPointers.values()];
      canvasPinch = {
        distance: Math.hypot(a.x - b.x, a.y - b.y),
        center: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      };
      canvasDrag = null;
      return;
    }
    canvasStartPan(canvasPointOf(event));
    return;
  }
  if (event.button === 2) return;
  const point = canvasPointOf(event);
  if (event.button === 1 || canvasSpace) {
    event.preventDefault();
    canvasStartPan(point);
    return;
  }
  if (event.button !== 0) return;

  const state = canvasState();
  const scheme = canvasScheme(state);
  const view = canvasViewOf(state);

  // Ручка «+» важнее всего остального: она и есть быстрый путь.
  if (state.selectedMarkIds.length === 1) {
    const selected = findMark(state.project, state.selectedMarkIds[0]);
    if (selected && selected.kind === "point" && selected.schemeId === scheme.id) {
      const side = hitHandle(scheme, selected, point, view);
      if (side) {
        canvasBlockPoint(selected.id, side);
        canvasDrag = { kind: "done", start: point, moved: false };
        return;
      }
    }
  }

  if (state.mode === "line" || state.mode === "room") {
    canvasDrag = { kind: state.mode, start: point, view: { ...state.view }, moved: false };
    return;
  }

  // Клик по метке важнее клика по контуру: попадание по меткам считается
  // первым, и контур перехватывает клик только там, где метки нет.
  const hit = hitTest(state.project, scheme, point, view, state.filter);
  if (!hit && state.mode === "select") {
    const outlineHit = hitOutline(state.project, scheme, point, view, state.filter, state.selectedOutlineId || null);
    if (outlineHit) {
      if (outlineHit.part === "vertex") {
        canvasDrag = {
          kind: "outlineVertex",
          outlineId: outlineHit.outlineId,
          index: outlineHit.index,
          start: point,
          before: state.project,
          moved: false,
        };
        return;
      }
      if (outlineHit.part === "insert") {
        canvasOutlineInsert(outlineHit.outlineId, outlineHit.index, screenToPlan(point, scheme, view));
        canvasDrag = { kind: "done", start: point, moved: false };
        return;
      }
      if (state.selectedOutlineId !== outlineHit.outlineId || state.selectedMarkIds.length > 0) {
        canvasApi.setState({ selectedOutlineId: outlineHit.outlineId, selectedMarkIds: [] });
      }
      canvasDrag = { kind: "outline", start: point, view: { ...state.view }, moved: false };
      return;
    }
  }
  if (hit) {
    // Выделили метку — выделение контура снимается: две пары ручек рядом
    // означали бы, что непонятно, чью вершину сейчас потащат.
    if (state.selectedMarkIds[0] !== hit.markId || state.selectedOutlineId) {
      canvasApi.setState({ selectedMarkIds: [hit.markId], selectedOutlineId: null });
    }
    canvasDrag = {
      kind: hit.part === "label" ? "label" : "mark",
      markId: hit.markId,
      groupId: hit.groupId,
      start: point,
      before: state.project,
      moved: false,
    };
    return;
  }
  canvasDrag = {
    kind: state.mode === "point" ? "place" : "empty",
    start: point,
    view: { ...state.view },
    moved: false,
  };
}

// Перетаскивание метки: новые точки считаются от снимка «до», а не от
// предыдущего кадра, — иначе метка уползает от курсора накопленной ошибкой.
function canvasDragTo(point) {
  const state = canvasState();
  const scheme = canvasScheme(state);
  const view = canvasViewOf(state);
  const before = canvasDrag.before;
  const from = screenToPlan(canvasDrag.start, scheme, view);
  const now = screenToPlan(point, scheme, view);
  const dx = now.x - from.x;
  const dy = now.y - from.y;
  try {
    if (canvasDrag.kind === "outlineVertex") {
      const outline = findOutline(before, canvasDrag.outlineId);
      const origin = outline.points[canvasDrag.index];
      canvasPreview = moveOutlinePoint(before, canvasDrag.outlineId, canvasDrag.index, {
        x: origin.x + dx,
        y: origin.y + dy,
      }).project;
    } else if (canvasDrag.kind === "label") {
      const target = canvasDrag.groupId ? findGroup(before, canvasDrag.groupId) : findMark(before, canvasDrag.markId);
      // База — там, где подпись сейчас видна, а не там, где лежит её смещение:
      // подпись, отведённую раскладкой от соседа, нельзя дёргать обратно
      // в стандартное место в тот миг, когда за неё взялись мышью.
      const size = view.markSize || 10;
      const seen = target ? labelBox(before, scheme, target, view, state.filter) : null;
      const base = seen ? { dx: seen.dx, dy: seen.dy } : { dx: size * 1.5, dy: -size * 1.5 };
      const offset = { dx: base.dx + dx * scheme.width, dy: base.dy + dy * scheme.height };
      // Подпись блока стоит по смещению его первой метки — своего поля у группы
      // модель не заводит, а собственной подписи у этой метки нет.
      const holder = canvasDrag.groupId && target ? target.markIds[0] : canvasDrag.markId;
      canvasPreview = updateMark(before, holder, { labelOffset: offset }).project;
    } else {
      const mark = findMark(before, canvasDrag.markId);
      const points = mark.points.map((item) => ({ x: item.x + dx, y: item.y + dy }));
      canvasPreview = updateMark(before, canvasDrag.markId, { points }).project;
    }
  } catch (error) {
    canvasPreview = null;
  }
  canvasRedraw();
}

function canvasPointerMove(event) {
  if (!canvasNode) return;
  const point = canvasPointOf(event);
  if (canvasPointers.has(event.pointerId)) canvasPointers.set(event.pointerId, point);

  if (canvasPinch && canvasPointers.size === 2) {
    const [a, b] = [...canvasPointers.values()];
    const distance = Math.hypot(a.x - b.x, a.y - b.y);
    const center = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    if (canvasPinch.distance > 0) canvasZoomAt(center, distance / canvasPinch.distance);
    const state = canvasState();
    canvasApi.setState({
      view: {
        ...state.view,
        offsetX: state.view.offsetX + (center.x - canvasPinch.center.x),
        offsetY: state.view.offsetY + (center.y - canvasPinch.center.y),
      },
    });
    canvasPinch = { distance, center };
    return;
  }

  const state = canvasState();
  if (canvasDraft) {
    const scheme = canvasScheme(state);
    canvasDraft.cursor = screenToPlan(point, scheme, canvasViewOf(state));
    canvasRedraw();
  }
  if (!canvasDrag) return;
  const shift = Math.hypot(point.x - canvasDrag.start.x, point.y - canvasDrag.start.y);
  if (shift > CANVAS_DRAG_SLOP) canvasDrag.moved = true;
  if (!canvasDrag.moved) return;

  if (canvasDrag.kind === "mark" || canvasDrag.kind === "label" || canvasDrag.kind === "outlineVertex") {
    canvasDragTo(point);
    return;
  }
  if (["pan", "empty", "place", "line", "room", "outline"].includes(canvasDrag.kind)) {
    canvasApi.setState({
      view: {
        ...state.view,
        offsetX: canvasDrag.view.offsetX + (point.x - canvasDrag.start.x),
        offsetY: canvasDrag.view.offsetY + (point.y - canvasDrag.start.y),
      },
    });
  }
}

function canvasPointerUp(event) {
  canvasPointers.delete(event.pointerId);
  if (canvasPointers.size < 2) canvasPinch = null;
  const drag = canvasDrag;
  canvasDrag = null;
  if (!drag) return;
  const point = canvasPointOf(event);
  const state = canvasState();

  if (drag.moved) {
    if ((drag.kind === "mark" || drag.kind === "label") && canvasPreview) {
      const label = drag.kind === "label" ? strings.history.moveLabel : strings.history.move;
      const after = canvasPreview;
      canvasPreview = null;
      canvasCommit(drag.before, after, label, { selection: [drag.markId] });
    }
    if (drag.kind === "outlineVertex" && canvasPreview) {
      const after = canvasPreview;
      canvasPreview = null;
      canvasCommit(drag.before, after, strings.history.outlineVertexMove, {
        patch: { selectedOutlineId: drag.outlineId },
      });
    }
    canvasPreview = null;
    canvasRedraw();
    return;
  }
  canvasPreview = null;

  if (event.pointerType === "touch" || drag.kind === "done") return;
  const scheme = canvasScheme(state);
  const plan = screenToPlan(point, scheme, canvasViewOf(state));
  if (drag.kind === "line") {
    canvasLineClick(plan, point);
    return;
  }
  if (drag.kind === "room") {
    canvasOutlineClick(plan, point);
    return;
  }
  if (drag.kind === "place") {
    canvasPlacePoint(plan);
    return;
  }
  if (drag.kind === "empty" && (state.selectedMarkIds.length > 0 || state.selectedOutlineId)) {
    canvasApi.setState({ selectedMarkIds: [], selectedOutlineId: null });
  }
}

function canvasDoubleClick(event) {
  const state = canvasState();
  const scheme = canvasScheme(state);
  const view = canvasViewOf(state);
  // Двойной клик по вершине выделенного контура убирает её: обводка по стенам
  // с первого раза не выходит, и лишняя вершина — обычное дело.
  if (state.mode === "select" && state.selectedOutlineId) {
    const hit = hitOutline(state.project, scheme, canvasPointOf(event), view, state.filter, state.selectedOutlineId);
    if (hit && hit.part === "vertex" && hit.outlineId === state.selectedOutlineId) {
      event.preventDefault();
      canvasOutlineRemovePoint(hit.outlineId, hit.index);
      return;
    }
  }
  if ((state.mode !== "line" && state.mode !== "room") || !canvasDraft) return;
  const point = canvasPointOf(event);
  const threshold = markRadius(view) + 6;
  const points = canvasDraft.points;
  const first = planToScreen(points[0], scheme, view);
  const last = planToScreen(points[points.length - 1], scheme, view);
  const onFirst = Math.hypot(point.x - first.x, point.y - first.y) <= threshold;
  const onLast = Math.hypot(point.x - last.x, point.y - last.y) <= threshold;
  // Двойной клик в стороне — это просто две вершины подряд: рисование
  // продолжается, ничего не теряется и не замыкается.
  if (!onFirst && !onLast) return;
  event.preventDefault();
  // Контур помещения замкнут всегда: комната с открытой стенкой — не комната.
  if (state.mode === "room") {
    canvasOutlineFinish();
    return;
  }
  // По первой точке — замкнутый контур (лента по периметру комнаты),
  // по последней — открытая линия, ровно как в брифе.
  canvasLineFinish(onFirst && !onLast && points.length >= 3);
}

function canvasWheel(event) {
  if (uiDialogDepth() > 0) return;
  event.preventDefault();
  const step = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY;
  canvasZoomAt(canvasPointOf(event), Math.exp(-step * 0.0015));
}

// ——— клавиатура ——————————————————————————————————————————————————————

function canvasTypingTarget(target) {
  if (!target || !target.tagName) return false;
  return (
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT" ||
    target.isContentEditable
  );
}

function canvasKeyDown(event) {
  // Пока открыт диалог, клавиатура принадлежит ему.
  if (uiDialogDepth() > 0 || canvasTypingTarget(event.target)) return;
  const state = canvasState();
  const control = event.ctrlKey || event.metaKey;
  if (control && event.code === "KeyZ") {
    event.preventDefault();
    if (event.shiftKey) canvasRedoStep();
    else canvasUndoStep();
    return;
  }
  if (control && event.code === "KeyY") {
    event.preventDefault();
    canvasRedoStep();
    return;
  }
  if (control) return;
  if (event.code === "Space") {
    canvasSpace = true;
    if (canvasNode) canvasNode.style.cursor = "grab";
    return;
  }
  if (event.key === "Escape") {
    if (canvasCancelDraft()) return;
    if (state.selectedOutlineId) {
      canvasApi.setState({ selectedOutlineId: null });
      return;
    }
    // Первый Esc снимает выделение: пока метка выделена, вокруг неё ручки «+»,
    // и отдельную метку вплотную к блоку не поставить. Второй — выходит из режима.
    if (state.selectedMarkIds.length > 0) {
      canvasApi.setState({ selectedMarkIds: [] });
      return;
    }
    if (state.mode !== "select") canvasApi.setState({ mode: "select" });
    return;
  }
  if (event.key === "Backspace" && canvasDraft) {
    event.preventDefault();
    canvasDraft.points.pop();
    if (canvasDraft.points.length === 0) canvasDraft = null;
    canvasRedraw();
    return;
  }
  if ((event.key === "Delete" || event.key === "Backspace") && state.selectedMarkIds.length > 0) {
    event.preventDefault();
    canvasDeleteSelected();
    return;
  }
  if ((event.key === "Delete" || event.key === "Backspace") && state.selectedOutlineId) {
    event.preventDefault();
    canvasDeleteOutline();
  }
}

function canvasKeyUp(event) {
  if (event.code !== "Space") return;
  canvasSpace = false;
  canvasSyncCursor();
}

function canvasSyncCursor() {
  if (!canvasNode) return;
  const state = canvasState();
  if (canvasSpace) canvasNode.style.cursor = "grab";
  else canvasNode.style.cursor = state.mode === "select" ? "default" : "crosshair";
}

// ——— монтирование ————————————————————————————————————————————————————

function mountCanvas(host, api) {
  canvasApi = api;
  canvasHost = host;
  canvasNode = document.createElement("canvas");
  canvasNode.className = "canvas";
  host.replaceChildren(canvasNode);
  canvasCtx = canvasNode.getContext("2d");

  canvasNode.addEventListener("pointerdown", canvasPointerDown);
  canvasNode.addEventListener("pointermove", canvasPointerMove);
  canvasNode.addEventListener("pointerup", canvasPointerUp);
  canvasNode.addEventListener("pointercancel", canvasPointerUp);
  canvasNode.addEventListener("dblclick", canvasDoubleClick);
  canvasNode.addEventListener("wheel", canvasWheel, { passive: false });
  canvasNode.addEventListener("contextmenu", (event) => event.preventDefault());
  document.addEventListener("keydown", canvasKeyDown);
  document.addEventListener("keyup", canvasKeyUp);

  if (typeof ResizeObserver === "function") {
    new ResizeObserver(() => canvasResize()).observe(host);
  } else {
    window.addEventListener("resize", canvasResize);
  }

  api.subscribe((state, changed) => {
    if ("project" in changed) {
      const id = state.project ? state.project.id : null;
      // Стек отмены живёт в пределах объекта: сменили объект — история пуста.
      if (id !== canvasProjectId) {
        canvasProjectId = id;
        clearHistory();
        canvasFitted = null;
      }
    }
    if ("schemeId" in changed) {
      canvasCancelDraft();
      canvasPreview = null;
    }
    if ("mode" in changed) {
      if (state.mode !== "line" && state.mode !== "room") canvasCancelDraft();
      canvasSyncCursor();
    }
    if ("schemeId" in changed || "schemeImage" in changed) canvasAutoFit(state);
    canvasRedraw();
  });
  canvasResize();
  canvasSyncCursor();
  canvasAutoFit(canvasState());
}

// Новый план показывается целиком: подгонка один раз на схему, дальше масштаб
// принадлежит пользователю.
function canvasAutoFit(state) {
  const scheme = canvasScheme(state);
  if (!scheme || !canvasNode) return;
  if (canvasFitted === scheme.id) return;
  if (!canvasImage(state)) return;
  canvasFitted = scheme.id;
  canvasApi.setState({
    view: fitView(scheme, { width: canvasNode.clientWidth, height: canvasNode.clientHeight }),
  });
}

// Подсказка поверх холста: что сейчас ставим и чем это закончить.
function mountCanvasHint(host, api) {
  const hint = document.createElement("div");
  hint.className = "canvas-hint";
  host.replaceChildren(hint);
  const render = () => {
    const state = api.getState();
    if (!state.schemeId) {
      hint.hidden = true;
      return;
    }
    const type = state.project && state.activeTypeId ? findType(state.project, state.activeTypeId) : null;
    const label = type ? type.code + " — " + type.name : "";
    const room = state.project && state.activeRoomId ? findRoom(state.project, state.activeRoomId) : null;
    if (state.mode === "room") hint.textContent = text("canvas.hintRoom", { name: room ? room.name : "" });
    else if (state.mode === "point" && type) hint.textContent = text("canvas.hintPoint", { label });
    else if (state.mode === "line" && type) hint.textContent = strings.canvas.hintLine;
    else if (type) hint.textContent = strings.canvas.hintSelectMode;
    else hint.textContent = strings.canvas.hintSelect;
    hint.hidden = false;
    if (state.mode === "room" && room) hint.style.borderColor = room.color;
    else if (type) hint.style.borderColor = styleOf(state.project, type.id).color;
  };
  api.subscribe((state, changed) => {
    if (
      "mode" in changed ||
      "activeTypeId" in changed ||
      "activeRoomId" in changed ||
      "schemeId" in changed ||
      "project" in changed
    ) {
      render();
    }
  });
  render();
}

registerPanel(PANEL_IDS.canvas, mountCanvas);
registerPanel(PANEL_IDS.overlay, mountCanvasHint);
