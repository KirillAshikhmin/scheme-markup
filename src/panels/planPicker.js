// Схема в окне (правка после сборки сценариев).
//
// Слова заказчика: «в режиме сценарии у карты сделай кнопку, которая
// разворачивает её в большое окно, по которому можно двигаться как и по схеме,
// зумить и т.д. и выбирать так метку нужную, так же и в логике при выборе
// устройства из списка … рядом с полем добавь кнопку, которая тоже откроет эту
// карту — схему в окне, но только с теми метками, которые можно выбрать».
//
// Одно окно на оба случая: план этажа, вписанный в окно, двигается
// перетаскиванием и колесом (пальцами — щипком), щелчок по метке её выбирает
// и закрывает окно. Чем окна различаются, решает вызывающий: какие метки
// видны (`markIds`), какие выбираются (`pickable`) и что делать с выбором
// (`onPick`). Рисует план тот же `drawScheme`, что «Схема» и мини-план, —
// второго рисовальщика в сборке нет; пока дом запущен, метки рисуют его
// состояние.
//
// Окно ничего не пишет ни в объект, ни в настройки: вид в нём живёт, пока оно
// открыто.
import { cancelFrame, scheduleFrame } from "../app.js";
import { findMark, findScheme, projectViewSizes, schemesInOrder } from "../model.js";
import { drawScheme, fitView, markRadius, markStackPoints, markStacks, planToScreen, simLiveFrame, simLiveMemo, visibleMarks } from "../render.js";
import { simLive, simRunning, simWatch } from "../simulation.js";
import { strings } from "../strings.js";
import { uiButton, uiEl, uiIconButton, uiModal } from "./ui.js";

// Окно не тянет ни мини-план, ни карточку устройства: карточка сама открывает
// его из поля опций логики, и обратная ссылка замкнула бы импорты в кольцо.
// Поэтому меры знака здесь свои (те же, что у мини-плана), а виды знаков
// живого дома приносит вызывающий (`options.liveKinds`).

/** Меньше этого радиуса (в точках экрана) знак метки не рисуется. */
export const PLAN_PICKER_MARK_PX = 7;
/** Меньше этой высоты (в точках экрана) подпись метки не рисуется. */
export const PLAN_PICKER_LABEL_PX = 10;

/** Во сколько раз меняет масштаб одна кнопка «+» / «−» и один щелчок колеса. */
export const PLAN_PICKER_ZOOM_STEP = 1.25;
/** Ближе этого план не приближается: во столько раз крупнее вписанного. */
export const PLAN_PICKER_ZOOM_MAX = 40;
/** Дальше вписанного план не удаляется: доля вписанного масштаба. */
export const PLAN_PICKER_ZOOM_MIN = 0.5;
/** Рука сдвинулась дальше — это перетаскивание, а не щелчок. */
export const PLAN_PICKER_MOVE_PX = 5;

const PLAN_PICKER_HIT_SLACK = 4;

/**
 * Вид плана в окне: масштаб и сдвиг, плюс размеры знака и подписи — не мельче
 * читаемых, как на мини-плане: вписанный большой план дал бы точки в два
 * пикселя. Приблизили — знак растёт до своего размера из объекта.
 */
export function planPickerView(project, base) {
  const sizes = projectViewSizes(project);
  return {
    zoom: base.zoom,
    offsetX: base.offsetX,
    offsetY: base.offsetY,
    markSize: Math.max(sizes.markSize, PLAN_PICKER_MARK_PX / base.zoom),
    labelSize: Math.max(sizes.labelSize, PLAN_PICKER_LABEL_PX / base.zoom),
  };
}

/**
 * Масштаб вокруг точки экрана: то, что под рукой, остаётся под рукой. Масштаб
 * держится в `[fit·MIN, fit·MAX]`, где `fit` — вписанный.
 */
export function planPickerZoomAt(view, point, factor, fitZoom) {
  const low = fitZoom * PLAN_PICKER_ZOOM_MIN;
  const high = fitZoom * PLAN_PICKER_ZOOM_MAX;
  const zoom = Math.max(low, Math.min(high, view.zoom * factor));
  const by = zoom / view.zoom;
  return {
    zoom,
    offsetX: point.x - (point.x - view.offsetX) * by,
    offsetY: point.y - (point.y - view.offsetY) * by,
  };
}

/**
 * Метка под точкой экрана, которую можно выбрать, или `null`. Ближайшая к
 * руке из видимых в пределах знака — тот же довод, что у мини-плана: знаки
 * теснятся, и «верхняя из накрывших» выбирала бы соседа.
 */
export function planPickerMarkAt(project, scheme, point, view, filter, pickable) {
  if (!project || !scheme) return null;
  const reach = markRadius(view) + PLAN_PICKER_HIT_SLACK;
  const stacks = markStacks(project, scheme, filter, view);
  let best = null;
  for (const mark of visibleMarks(project, scheme, filter)) {
    if (pickable && !pickable(mark.id)) continue;
    const points = markStackPoints(mark, stacks);
    if (!points || points.length === 0) continue;
    const at = planToScreen(points[0], scheme, view);
    const distance = Math.hypot(at.x - point.x, at.y - point.y);
    if (distance <= reach && (!best || distance < best.distance)) best = { markId: mark.id, distance };
  }
  return best ? best.markId : null;
}

/** Этажи окна: схемы, на которых есть что выбрать (`markIds`), или все. */
export function planPickerSchemes(project, markIds = null) {
  if (!project) return [];
  return schemesInOrder(project)
    .filter((scheme) => !markIds || project.marks.some((mark) => mark.schemeId === scheme.id && markIds.has(mark.id)))
    .map((scheme) => ({ id: scheme.id, name: scheme.name }));
}

/**
 * Открыть схему в окне. `api` — `panelApi()` панели. `options`:
 *   `title`     — заголовок окна;
 *   `hint`      — строка под ним;
 *   `markIds`   — `Set` меток, которые видны (нет — видны все по фильтру);
 *   `pickable`  — `(markId) => boolean`, что можно выбрать (нет — всё видимое);
 *   `selected`  — метки, обведённые как выбранные;
 *   `schemeId`  — с какого этажа начать;
 *   `liveKinds` — `(project) => Map` видов знаков живого дома
 *                 (`deviceLiveKinds`); нет — план без состояний дома;
 *   `onPick`    — `(markId) => void`; окно после выбора закрывается само.
 * Возвращает `{close}`.
 */
export function openPlanPicker(api, options = {}) {
  const state = () => api.getState();
  const markIds = options.markIds instanceof Set ? options.markIds : null;
  const pickable = typeof options.pickable === "function" ? options.pickable : null;
  const floors = planPickerSchemes(state().project, markIds);
  let schemeId =
    (options.schemeId && floors.some((item) => item.id === options.schemeId) && options.schemeId) ||
    (floors.some((item) => item.id === state().schemeId) ? state().schemeId : floors[0] ? floors[0].id : null);
  const memo = simLiveMemo();
  let base = null;
  let fitZoom = 1;
  let box = { width: 1, height: 1 };
  let frame = 0;
  let closed = false;
  const pointers = new Map();
  let drag = null;
  let pinch = null;

  const canvas = uiEl("canvas", { class: "plan-picker__canvas" });
  const ctx = canvas.getContext ? canvas.getContext("2d") : null;
  const stage = uiEl("div", { class: "plan-picker__stage" }, [canvas]);
  const floorRow = uiEl("div", { class: "plan-picker__floors" });
  const scheme = () => (schemeId ? findScheme(state().project, schemeId) : null);
  const filter = () => ({ ...(state().filter || {}), ...(markIds ? { markIds } : {}) });

  function fit() {
    const current = scheme();
    if (!current) return;
    base = fitView(current, box);
    fitZoom = base.zoom;
  }

  function paint() {
    frame = 0;
    if (closed || !ctx) return;
    const ratio = (typeof window !== "undefined" && window.devicePixelRatio) || 1;
    const width = Math.max(1, stage.clientWidth);
    const height = Math.max(1, stage.clientHeight);
    const resized = width !== box.width || height !== box.height;
    if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      canvas.style.width = width + "px";
      canvas.style.height = height + "px";
    }
    box = { width, height };
    if (!base || resized) fit();
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, width, height);
    const current = scheme();
    if (!current || !base) return;
    const now = state();
    let live = null;
    let liveFx = null;
    let animate = false;
    if (simRunning() && typeof options.liveKinds === "function") {
      const made = simLiveFrame(simLive(now.project), options.liveKinds(now.project), memo, Date.now());
      live = made.live;
      liveFx = made.fx;
      animate = made.animate;
    }
    const loaded = now.schemeImage;
    drawScheme(ctx, {
      project: now.project,
      scheme: current,
      image: now.planShown === false ? null : loaded && loaded.schemeId === current.id ? loaded.image : null,
      drawing: now.drawingShown !== false,
      objects: now.objectsShown !== false,
      filter: filter(),
      view: { ...planPickerView(now.project, base), ...(now.schemeFont ? { fontKind: now.schemeFont } : {}) },
      selectedIds: Array.isArray(options.selected) ? options.selected : [],
      ...(live ? { live, liveFx } : {}),
    });
    if (animate) redraw();
  }

  function redraw() {
    if (frame || closed) return;
    frame = scheduleFrame(paint);
  }

  function zoomBy(factor, at = { x: box.width / 2, y: box.height / 2 }) {
    if (!base) return;
    base = planPickerZoomAt(base, at, factor, fitZoom);
    redraw();
  }

  function renderFloors() {
    floorRow.hidden = floors.length < 2;
    floorRow.replaceChildren(
      ...floors.map((item) =>
        uiButton(item.name, {
          class: "ui-btn plan-picker__floor" + (item.id === schemeId ? " is-on" : ""),
          on: {
            click: () => {
              if (item.id === schemeId) return;
              schemeId = item.id;
              base = null;
              renderFloors();
              redraw();
            },
          },
        }),
      ),
    );
  }

  const pointOf = (event) => {
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  function pick(point) {
    const current = scheme();
    if (!current || !base) return;
    const now = state();
    const markId = planPickerMarkAt(now.project, current, point, planPickerView(now.project, base), filter(), pickable);
    if (!markId || !findMark(now.project, markId)) return;
    close();
    if (typeof options.onPick === "function") options.onPick(markId);
  }

  canvas.addEventListener("pointerdown", (event) => {
    if (event.button !== undefined && event.button !== 0) return;
    if (typeof canvas.setPointerCapture === "function" && event.pointerId !== undefined) canvas.setPointerCapture(event.pointerId);
    pointers.set(event.pointerId, pointOf(event));
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = { distance: Math.hypot(a.x - b.x, a.y - b.y) || 1 };
      drag = null;
      return;
    }
    drag = { start: pointOf(event), last: pointOf(event), moved: false };
  });
  canvas.addEventListener("pointermove", (event) => {
    if (!pointers.has(event.pointerId)) return;
    pointers.set(event.pointerId, pointOf(event));
    if (pinch && pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const distance = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      zoomBy(distance / pinch.distance, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
      pinch.distance = distance;
      return;
    }
    if (!drag || !base) return;
    const at = pointOf(event);
    if (!drag.moved && Math.hypot(at.x - drag.start.x, at.y - drag.start.y) < PLAN_PICKER_MOVE_PX) return;
    drag.moved = true;
    base = { ...base, offsetX: base.offsetX + at.x - drag.last.x, offsetY: base.offsetY + at.y - drag.last.y };
    drag.last = at;
    redraw();
  });
  const release = (event) => {
    pointers.delete(event.pointerId);
    if (pinch) {
      if (pointers.size < 2) pinch = null;
      drag = null;
      return;
    }
    const current = drag;
    drag = null;
    if (current && !current.moved && event.type === "pointerup") pick(pointOf(event));
  };
  canvas.addEventListener("pointerup", release);
  canvas.addEventListener("pointercancel", release);
  canvas.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      zoomBy(event.deltaY < 0 ? PLAN_PICKER_ZOOM_STEP : 1 / PLAN_PICKER_ZOOM_STEP, pointOf(event));
    },
    { passive: false },
  );

  const tools = uiEl("div", { class: "plan-picker__tools" }, [
    floorRow,
    uiEl("span", { class: "plan-picker__gap" }),
    uiIconButton("minus", { class: "ui-btn", title: strings.planPicker.zoomOut, on: { click: () => zoomBy(1 / PLAN_PICKER_ZOOM_STEP) } }),
    uiIconButton("plus", { class: "ui-btn", title: strings.planPicker.zoomIn, on: { click: () => zoomBy(PLAN_PICKER_ZOOM_STEP) } }),
    uiButton(strings.planPicker.fit, {
      class: "ui-btn",
      title: strings.planPicker.fitHint,
      on: {
        click: () => {
          base = null;
          redraw();
        },
      },
    }),
  ]);
  const body = uiEl("div", { class: "plan-picker" }, [
    options.hint ? uiEl("p", { class: "modal__hint plan-picker__hint", text: options.hint }) : null,
    tools,
    floors.length === 0 ? uiEl("p", { class: "scn-side__empty", text: strings.planPicker.empty }) : stage,
  ].filter(Boolean));
  const modal = uiModal({
    title: options.title || strings.planPicker.title,
    body,
    actions: [uiButton(strings.dialog.close, { on: { click: () => close() } })],
    onCancel: () => close(),
  });
  if (modal.card) modal.card.classList.add("modal--plan");

  const unwatch = simWatch(() => redraw());
  const observer = typeof ResizeObserver === "function" ? new ResizeObserver(() => redraw()) : null;
  if (observer) observer.observe(stage);

  function close() {
    if (closed) return;
    closed = true;
    if (frame) cancelFrame(frame);
    frame = 0;
    unwatch();
    if (observer) observer.disconnect();
    modal.close();
  }

  renderFloors();
  redraw();
  return { close };
}
