// Поле плана вне «Схемы»: мини-план «Сценариев» и схема в окне (правка после
// сборки сценариев).
//
// Слова заказчика: «в окне выбора метки двигаться как и на схеме, включая все
// жесты, а ты опять по новому сделал. Переиспользуй везде один механизм».
//
// Поле одно на оба места, и ходит оно **тем же механизмом, что «Схема»**
// (`planNav.js`): перетаскивание, колесо мыши и двухпальцевый свайп трекпада,
// щипок, средняя кнопка, Shift и пробел, стрелки с разгоном, «+» и «−», те же
// пределы масштаба и та же мерка «поехала рука» у мыши и у пальца. Рисует его
// тот же `drawScheme`, что «Схема» (через `miniPlanPaint`), а щелчок по метке в
// запущенном доме — те же жесты устройства (`deviceGestureStart`/`End`): клавиша
// распознаёт одиночное, двойное и долгое, свет переключается.
//
// Чем поля различаются, решает вызывающий: какие метки видны (`markIds`),
// какие выбираются (`pickable`), что делать со щелчком (`onTap`), жмёт ли
// щелчок устройство дома (`devices`) и слушает ли поле клавиатуру (`keys` — у
// окна; мини-плану клавиатура не нужна: стрелки в «Сценариях» принадлежат
// спискам).
import { cancelFrame, scheduleFrame } from "../app.js";
import { findMark, findScheme } from "../model.js";
import { simLiveFrame, simLiveMemo } from "../render.js";
import { createPlanNav, planNavFit } from "../planNav.js";
import { simAct, simLive, simPress, simRunning, simWatch } from "../simulation.js";
import { deviceGestureEnd, deviceGestureStart, deviceLiveKinds, devicePresserOf } from "./deviceCard.js";
import { miniPlanMarkAt, miniPlanPaint, miniPlanSized } from "./miniPlan.js";
import { uiFieldTarget, uiSpaceTarget, uiTypingTarget } from "./ui.js";

/**
 * Поле плана в узле `host`. `options`:
 *   `schemeId()`  — какой этаж показать (по умолчанию открытая схема);
 *   `markIds`     — `Set` меток, которые видны (нет — все по фильтру);
 *   `pickable`    — `(markId) => boolean`, что выбирается щелчком (нет — метка с аксессуаром);
 *   `onTap`       — `(markId) => void`, щелчок по выбираемой метке;
 *   `devices`     — пока дом идёт, щелчок жмёт устройство, как на «Схеме»;
 *   `selected()`  — метки, обведённые как выбранные;
 *   `keys`        — стрелки, «+»/«−» и пробел, пока поле на виду.
 * Отдаёт `{node, redraw, fit, zoomBy, setHighlight, dispose}`.
 */
export function createPlanView(host, api, options = {}) {
  const canvas = document.createElement("canvas");
  canvas.className = "mini-plan__canvas";
  host.append(canvas);
  const ctx = canvas.getContext ? canvas.getContext("2d") : null;
  const state = () => api.getState();
  const memo = simLiveMemo();
  const pointers = new Map();
  let box = { width: 1, height: 1 };
  let view = null;
  let viewFor = null;
  // Увели рукой — размер рамки поменялся, а вид остаётся: вписывать заново
  // значило бы бросить то место, куда человек приехал.
  let touched = false;
  let highlight = [];
  let frame = 0;
  let closed = false;
  let tapMark = null;
  let gesture = null;
  let panOnly = false;
  let space = false;

  const schemeIdNow = () => (typeof options.schemeId === "function" ? options.schemeId() : state().schemeId);
  const schemeNow = () => {
    const now = state();
    const id = schemeIdNow();
    return now.project && id ? findScheme(now.project, id) : null;
  };
  const filterNow = () => ({ ...(state().filter || {}), ...(options.markIds instanceof Set ? { markIds: options.markIds } : {}) });
  const pickable = typeof options.pickable === "function" ? options.pickable : null;

  const nav = createPlanNav({
    getView: () => view,
    setView: (next) => {
      view = { zoom: next.zoom, offsetX: next.offsetX, offsetY: next.offsetY };
      touched = true;
      redraw();
    },
    box: () => box,
    frames: { schedule: (fn) => scheduleFrame(fn), cancel: (id) => cancelFrame(id) },
  });

  // Нажатия дома — те же двери, что у «Схемы»: выделение по концу жеста.
  const io = {
    presserOf: (markId, index) => devicePresserOf(markId, index),
    select: (markId) => {
      if (typeof options.onTap === "function") options.onTap(markId);
    },
    press: (markId, index, press) => simPress(markId, index, press),
    act: (action) => simAct(action),
  };

  function fit() {
    const scheme = schemeNow();
    if (!scheme) return;
    view = planNavFit(state().project, scheme, box);
    viewFor = scheme.id;
    touched = false;
    redraw();
  }

  function paint() {
    frame = 0;
    if (closed || !ctx) return;
    const now = state();
    const ratio = (typeof window !== "undefined" && window.devicePixelRatio) || 1;
    const width = Math.max(1, host.clientWidth);
    const height = Math.max(1, host.clientHeight);
    const resized = width !== box.width || height !== box.height;
    if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      canvas.style.width = width + "px";
      canvas.style.height = height + "px";
    }
    box = { width, height };
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    const scheme = schemeNow();
    if (!scheme) {
      ctx.clearRect(0, 0, width, height);
      return;
    }
    if (!view || viewFor !== scheme.id || (resized && !touched)) {
      view = planNavFit(now.project, scheme, box);
      viewFor = scheme.id;
      touched = false;
    }
    let live = null;
    let liveFx = null;
    let animate = false;
    if (simRunning()) {
      const made = simLiveFrame(simLive(now.project), deviceLiveKinds(now.project), memo, Date.now());
      live = made.live;
      liveFx = made.fx;
      animate = made.animate;
    }
    const loaded = now.schemeImage;
    miniPlanPaint(ctx, {
      project: now.project,
      scheme,
      image: now.planShown === false ? null : loaded && loaded.schemeId === scheme.id ? loaded.image : null,
      filter: filterNow(),
      box,
      view,
      drawing: now.drawingShown !== false,
      objects: now.objectsShown !== false,
      live,
      liveFx,
      selected: typeof options.selected === "function" ? options.selected() : [],
      highlight,
      fontKind: now.schemeFont,
    });
    if (animate) redraw();
  }

  function redraw() {
    if (frame || closed) return;
    frame = scheduleFrame(paint);
  }

  function pointOf(event) {
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function markUnder(point) {
    const scheme = schemeNow();
    if (!scheme || !view) return null;
    const now = state();
    return miniPlanMarkAt(now.project, scheme, point, miniPlanSized(now.project, view), filterNow(), pickable);
  }

  function syncCursor() {
    const panning = space || panOnly || (nav.dragging() && !tapMark && !gesture);
    canvas.style.cursor = panning ? "grab" : "pointer";
  }

  function onDown(event) {
    if (event.button === 2) return;
    try {
      canvas.setPointerCapture(event.pointerId);
    } catch (error) {
      /* работаем без захвата */
    }
    pointers.set(event.pointerId, pointOf(event));
    if (pointers.size === 2) {
      // Два пальца пришли возить и приближать: начатое нажатие бросается.
      if (gesture) deviceGestureEnd(gesture, true, io);
      gesture = null;
      tapMark = null;
      nav.dragEnd();
      nav.pinchStart(pointers.values());
      return;
    }
    if (pointers.size > 2) return;
    const point = pointOf(event);
    const touch = event.pointerType === "touch";
    // Средняя кнопка, Shift и пробел просят ход прямо, без щелчка — как на «Схеме».
    panOnly = event.button === 1 || event.shiftKey || space;
    if (panOnly) event.preventDefault();
    nav.dragStart(point, { touch });
    tapMark = panOnly ? null : markUnder(point);
    if (tapMark && options.devices && simRunning()) {
      const now = state();
      if (findMark(now.project, tapMark)) gesture = deviceGestureStart(now.project, tapMark, io);
    }
    syncCursor();
  }

  function onMove(event) {
    if (!pointers.has(event.pointerId)) return;
    pointers.set(event.pointerId, pointOf(event));
    if (nav.pinching() && pointers.size === 2) {
      nav.pinchMove(pointers.values());
      return;
    }
    if (!nav.dragging()) return;
    if (nav.dragMove(pointOf(event))) {
      // Рука поехала — это ход: нажатие бросается, щелчка не будет.
      if (gesture) deviceGestureEnd(gesture, true, io);
      gesture = null;
      tapMark = null;
      syncCursor();
    }
  }

  function onEnd(event) {
    pointers.delete(event.pointerId);
    if (pointers.size < 2) nav.pinchEnd();
    const moved = nav.dragEnd() || event.type === "pointercancel";
    const current = gesture;
    const tapped = tapMark;
    gesture = null;
    tapMark = null;
    panOnly = false;
    syncCursor();
    if (current) {
      deviceGestureEnd(current, moved, io);
      return;
    }
    if (!moved && tapped) io.select(tapped);
  }

  function onWheel(event) {
    nav.wheel(event, pointOf(event));
  }

  // Клавиатура — у окна (`keys`): стрелки, «+»/«−», пробел. Поля набора и
  // списки отдают свои клавиши себе — те же предикаты, что у холста и чертежа.
  function onKeyDown(event) {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (uiTypingTarget(event.target) || uiFieldTarget(event.target)) return;
    if (nav.panKeyDown(event.code) || nav.zoomKey(event)) {
      event.preventDefault();
      return;
    }
    if (event.code === "Space" && !uiSpaceTarget(event.target)) {
      event.preventDefault();
      space = true;
      syncCursor();
    }
  }

  function onKeyUp(event) {
    nav.panKeyUp(event.code);
    if (event.code !== "Space") return;
    if (space && !uiSpaceTarget(event.target)) event.preventDefault();
    space = false;
    syncCursor();
  }

  function onBlur() {
    nav.panKeyUp(null);
    space = false;
  }

  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerup", onEnd);
  canvas.addEventListener("pointercancel", onEnd);
  canvas.addEventListener("wheel", onWheel, { passive: false });
  if (options.keys && typeof document !== "undefined") {
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("keyup", onKeyUp);
    if (typeof window !== "undefined") window.addEventListener("blur", onBlur);
  }

  const unsubscribe = api.subscribe((next, changed) => {
    if (
      "project" in changed ||
      "schemeId" in changed ||
      "schemeImage" in changed ||
      "selectedMarkIds" in changed ||
      "simRunning" in changed ||
      "filter" in changed ||
      "screen" in changed ||
      "layout" in changed
    )
      redraw();
  });
  // Скрытое поле (другой режим, свёрнутый раздел) событий дома не рисует
  // (известный баг): показали снова — перерисуют смена `screen` или
  // ResizeObserver, у которого размер из нуля стал настоящим.
  const unwatch = simWatch(() => {
    if (host.isConnected && host.getClientRects().length > 0) redraw();
  });
  const observer = typeof ResizeObserver === "function" ? new ResizeObserver(() => redraw()) : null;
  if (observer) observer.observe(host);
  syncCursor();
  redraw();

  return {
    node: canvas,
    redraw,
    fit,
    zoomBy: (factor) => nav.zoomBy(factor),
    setHighlight(markIds) {
      const next = Array.isArray(markIds) ? markIds.filter((id) => typeof id === "string") : [];
      if (next.length === highlight.length && next.every((id, at) => id === highlight[at])) return;
      highlight = next;
      redraw();
    },
    dispose() {
      closed = true;
      if (frame) cancelFrame(frame);
      frame = 0;
      nav.dispose();
      if (gesture) deviceGestureEnd(gesture, true, io);
      gesture = null;
      unsubscribe();
      unwatch();
      if (observer) observer.disconnect();
      if (options.keys && typeof document !== "undefined") {
        document.removeEventListener("keydown", onKeyDown);
        document.removeEventListener("keyup", onKeyUp);
        if (typeof window !== "undefined") window.removeEventListener("blur", onBlur);
      }
      canvas.remove();
    },
  };
}

/**
 * Мини-план «Сценариев»: поле плана открытой схемы. Щелчок по метке выбирает
 * устройство (`on.pick`); пока дом запущен, ещё и жмёт его, как на «Схеме».
 * Возвращает `{redraw, setHighlight, dispose}`.
 */
export function createMiniPlan(host, api, on = {}) {
  const field = createPlanView(host, api, {
    devices: true,
    onTap: (markId) => {
      if (on.pick) on.pick(markId);
    },
    selected: () => api.getState().selectedMarkIds,
  });
  return { redraw: field.redraw, setHighlight: field.setHighlight, dispose: field.dispose };
}
