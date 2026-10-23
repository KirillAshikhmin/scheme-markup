// Мини-план режима «Сценарии» (таск 10 сценариев; истории 4.22, 4.23, 2.11).
//
// Уменьшенная схема открытого этажа справа в «Сценариях»: на ней выбирают
// устройство щелчком по метке, подсвечивают устройство блока, на ней же идёт
// живой дом — пока он запущен, метки рисуют состояния, а щелчок и нажатия
// работают как в «Схеме» (`deviceCard.js` — те же правила щелчка и тот же
// распознаватель нажатий). Рисует его тот же `drawScheme({live, liveFx})`, что
// и «Схема», — второго рисовальщика состояний в сборке нет.
//
// Состояние дома сюда приходит только из `simulation.js` и только на экран:
// ни в объект, ни в историю оно не пишется. Выбор устройства — сеанс панели,
// не объект.
import { cancelFrame, scheduleFrame } from "../app.js";
import { findMark, findScheme, projectViewSizes, schemesInOrder } from "../model.js";
import { drawScheme, fitView, markRadius, markStackPoints, markStacks, planToScreen, simLiveFrame, simLiveMemo, visibleMarks } from "../render.js";
import { markAccessory } from "../sim/home.js";
import { simLive, simRunning, simWatch } from "../simulation.js";
import { deviceClickAct, deviceClickPlan, deviceLiveKinds, devicePresserOf } from "./deviceCard.js";

/** Меньше этого радиуса (в точках экрана) метка на мини-плане не рисуется. */
export const MINI_PLAN_MARK_PX = 7;
/** Меньше этой высоты (в точках экрана) подпись метки не рисуется. */
export const MINI_PLAN_LABEL_PX = 10;
/** Подсветка устройства блока держится, пока на блок наведён курсор; кольцо выбора — всегда. */
export const MINI_PLAN_RING = "#bf8700";

const MINI_PLAN_HIT_SLACK = 4;

/**
 * Какую схему показать, когда выбрали метку: схему метки, если она не та, что
 * открыта, иначе `null` — оставить как есть. Метки нет — тоже `null`.
 */
export function miniPlanSchemeFor(project, markId, currentSchemeId) {
  const mark = project && markId ? findMark(project, markId) : null;
  if (!mark || !mark.schemeId || mark.schemeId === currentSchemeId) return null;
  return findScheme(project, mark.schemeId) ? mark.schemeId : null;
}

/** Схемы объекта для переключателя этажей: `[{id, name}]` в порядке списка. */
export function miniPlanSchemes(project) {
  return project ? schemesInOrder(project).map((scheme) => ({ id: scheme.id, name: scheme.name })) : [];
}

/**
 * Вид плана в рамке мини-плана: план вписан целиком, а метка и подпись не
 * мельче читаемого — на уменьшенном плане размеры из объекта дали бы точки в
 * два пикселя. Возвращает `view` для `drawScheme` и `hitTest`.
 */
export function miniPlanView(project, scheme, box) {
  const fit = fitView(scheme, { width: Math.max(1, box.width), height: Math.max(1, box.height) });
  const sizes = projectViewSizes(project);
  return {
    ...fit,
    markSize: Math.max(sizes.markSize, MINI_PLAN_MARK_PX / fit.zoom),
    labelSize: Math.max(sizes.labelSize, MINI_PLAN_LABEL_PX / fit.zoom),
  };
}

/**
 * Метка-устройство под точкой экрана мини-плана (`point` — в точках холста) или
 * `null`. Берётся **ближайшая к точке** из меток-устройств в пределах знака:
 * на уменьшенном плане знаки теснятся, и «верхняя из накрывших» (как у
 * `hitTest`) выбирала бы соседа, а не ту, в которую целились. Подпись,
 * комментарий и метка без аксессуара не выбираются.
 */
export function miniPlanMarkAt(project, scheme, point, view, filter) {
  if (!project || !scheme) return null;
  const reach = markRadius(view) + MINI_PLAN_HIT_SLACK;
  const stacks = markStacks(project, scheme, filter, view);
  // Сначала метки в пределах знака по близости, потом — первая из них, что
  // устройство: аксессуар собирается у одной-двух меток под пальцем, а не у
  // всех видимых.
  const near = [];
  for (const mark of visibleMarks(project, scheme, filter)) {
    const points = markStackPoints(mark, stacks);
    if (!points || points.length === 0) continue;
    const at = planToScreen(points[0], scheme, view);
    const distance = Math.hypot(at.x - point.x, at.y - point.y);
    if (distance <= reach) near.push({ markId: mark.id, distance });
  }
  near.sort((first, second) => first.distance - second.distance);
  const found = near.find((item) => markAccessory(project, item.markId));
  return found ? found.markId : null;
}

// Кольцо вокруг метки на мини-плане: выбор — синим пунктиром рисует сам
// `drawScheme` (`selectedIds`), подсветку блока — янтарным кольцом здесь.
function miniPlanRing(ctx, project, scheme, view, markId, filter) {
  const mark = findMark(project, markId);
  if (!mark || mark.schemeId !== scheme.id) return false;
  const stacks = markStacks(project, scheme, filter, view);
  const points = markStackPoints(mark, stacks);
  if (!points || points.length === 0) return false;
  const at = planToScreen(points[0], scheme, view);
  ctx.save();
  ctx.strokeStyle = MINI_PLAN_RING;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(at.x, at.y, markRadius(view) * 1.9, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
  return true;
}

/**
 * Нарисовать мини-план в `ctx` (кадр в точках холста, ничего не стирает, кроме
 * своей рамки). `live`/`liveFx` — состояние запущенного дома: без них кадр —
 * просто схема. `selected` — выбранные метки, `highlight` — метки блока,
 * над которым стоит курсор. Возвращает число подсвеченных меток, найденных на
 * этом этаже.
 */
export function miniPlanPaint(ctx, { project, scheme, image, filter, box, drawing, objects, live, liveFx, selected, highlight, fontKind }) {
  ctx.clearRect(0, 0, box.width, box.height);
  if (!project || !scheme) return 0;
  const view = { ...miniPlanView(project, scheme, box), ...(fontKind ? { fontKind } : {}) };
  drawScheme(ctx, {
    project,
    scheme,
    image: image || null,
    drawing: drawing !== false,
    objects: objects !== false,
    filter,
    view,
    selectedIds: Array.isArray(selected) ? selected : [],
    ...(live ? { live, liveFx } : {}),
  });
  let rings = 0;
  for (const markId of Array.isArray(highlight) ? highlight : []) if (miniPlanRing(ctx, project, scheme, view, markId, filter)) rings += 1;
  return rings;
}

/**
 * Мини-план в узле `host`: холст на всю рамку, перерисовка по событиям дома и
 * состояния. `api` — `panelApi()` панели; `on.pick(markId)` — щелчок по метке
 * (выбор устройства). Возвращает `{redraw, setHighlight, dispose}`.
 *
 * Щелчок по метке всегда выбирает её; пока дом запущен, он ещё и нажимает на
 * устройство по правилам «Схемы» (`deviceClickPlan`): клавиша — одиночное,
 * двойное, долгое по времени нажатия, датчик срабатывает, свет переключается.
 * Многоклавишный выключатель только выбирается — клавишу выбирают в карточке.
 */
export function createMiniPlan(host, api, on = {}) {
  const canvas = document.createElement("canvas");
  canvas.className = "mini-plan__canvas";
  host.append(canvas);
  const ctx = canvas.getContext("2d");
  // Кадр пульса и вспышки, вид знака и распознаватели нажатий — общие со
  // «Схемой» и «Объёмом»; своя здесь только память кадров.
  const memo = simLiveMemo();
  let highlight = [];
  let frame = 0;
  let press = null;
  let box = { width: 1, height: 1 };

  function paint() {
    frame = 0;
    if (!ctx) return;
    const state = api.getState();
    const ratio = window.devicePixelRatio || 1;
    const width = Math.max(1, host.clientWidth);
    const height = Math.max(1, host.clientHeight);
    if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      canvas.style.width = width + "px";
      canvas.style.height = height + "px";
    }
    box = { width, height };
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    const scheme = state.project && state.schemeId ? findScheme(state.project, state.schemeId) : null;
    if (!scheme) {
      ctx.clearRect(0, 0, width, height);
      return;
    }
    let live = null;
    let liveFx = null;
    let animate = false;
    if (simRunning()) {
      const made = simLiveFrame(simLive(state.project), deviceLiveKinds(state.project), memo, Date.now());
      live = made.live;
      liveFx = made.fx;
      animate = made.animate;
    }
    const loaded = state.schemeImage;
    miniPlanPaint(ctx, {
      project: state.project,
      scheme,
      image: state.planShown === false ? null : loaded && loaded.schemeId === scheme.id ? loaded.image : null,
      filter: state.filter,
      box,
      drawing: state.drawingShown !== false,
      objects: state.objectsShown !== false,
      live,
      liveFx,
      selected: state.selectedMarkIds,
      highlight,
      fontKind: state.schemeFont,
    });
    if (animate) redraw();
  }

  function redraw() {
    if (frame) return;
    frame = scheduleFrame(paint);
  }

  function pointOf(event) {
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function markUnder(event) {
    const state = api.getState();
    const scheme = state.project && state.schemeId ? findScheme(state.project, state.schemeId) : null;
    if (!scheme) return null;
    return miniPlanMarkAt(state.project, scheme, pointOf(event), miniPlanView(state.project, scheme, box), state.filter);
  }

  canvas.addEventListener("pointerdown", (event) => {
    if (event.button !== undefined && event.button !== 0) return;
    const markId = markUnder(event);
    if (!markId) return;
    const state = api.getState();
    if (typeof canvas.setPointerCapture === "function" && event.pointerId !== undefined) canvas.setPointerCapture(event.pointerId);
    if (on.pick) on.pick(markId);
    if (!simRunning()) return;
    const plan = deviceClickPlan(markAccessory(state.project, markId));
    press = { markId, plan, presser: null };
    if (plan.kind === "key" && plan.key.detect) {
      press.presser = devicePresserOf(markId, plan.key.index);
      press.presser.down();
    }
  });
  const release = (event) => {
    const current = press;
    press = null;
    if (!current) return;
    const cancelled = event.type === "pointercancel";
    if (current.presser) {
      if (cancelled) current.presser.abort();
      else current.presser.up();
    } else if (!cancelled) deviceClickAct(current.markId, current.plan);
  };
  canvas.addEventListener("pointerup", release);
  canvas.addEventListener("pointercancel", release);

  const unsubscribe = api.subscribe((state, changed) => {
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
  const unwatch = simWatch(() => redraw());
  const observer = typeof ResizeObserver === "function" ? new ResizeObserver(() => redraw()) : null;
  if (observer) observer.observe(host);
  redraw();

  return {
    redraw,
    setHighlight(markIds) {
      const next = Array.isArray(markIds) ? markIds.filter((id) => typeof id === "string") : [];
      if (next.length === highlight.length && next.every((id, at) => id === highlight[at])) return;
      highlight = next;
      redraw();
    },
    dispose() {
      if (frame) cancelFrame(frame);
      frame = 0;
      unsubscribe();
      unwatch();
      if (observer) observer.disconnect();
      canvas.remove();
    },
  };
}
