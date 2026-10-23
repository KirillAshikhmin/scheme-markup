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
//
// Здесь — **чистая половина**: вписать, найти метку под рукой, нарисовать
// кадр. Живое поле — холст, ход по плану, щелчок и нажатия — собрано в
// `planView.js`: оно одно на мини-план и на схему в окне (правка после сборки
// сценариев: «Переиспользуй везде один механизм»).
import { findMark, findScheme, projectViewSizes, schemesInOrder } from "../model.js";
import { drawScheme, fitView, markRadius, markStackPoints, markStacks, planToScreen, visibleMarks } from "../render.js";
import { markAccessory } from "../sim/home.js";

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
  return miniPlanSized(project, fitView(scheme, { width: Math.max(1, box.width), height: Math.max(1, box.height) }));
}

/**
 * Размеры знака и подписи у вида поля плана: не мельче читаемых. Вид любой —
 * вписанный или тот, куда его увели рукой (`planView.js`): приблизили — знак
 * растёт до своего размера из объекта.
 */
export function miniPlanSized(project, view) {
  const sizes = projectViewSizes(project);
  return {
    zoom: view.zoom,
    offsetX: view.offsetX,
    offsetY: view.offsetY,
    markSize: Math.max(sizes.markSize, MINI_PLAN_MARK_PX / view.zoom),
    labelSize: Math.max(sizes.labelSize, MINI_PLAN_LABEL_PX / view.zoom),
  };
}

/**
 * Метка-устройство под точкой экрана мини-плана (`point` — в точках холста) или
 * `null`. Берётся **ближайшая к точке** из меток-устройств в пределах знака:
 * на уменьшенном плане знаки теснятся, и «верхняя из накрывших» (как у
 * `hitTest`) выбирала бы соседа, а не ту, в которую целились. Подпись,
 * комментарий и метка без аксессуара не выбираются.
 */
export function miniPlanMarkAt(project, scheme, point, view, filter, pickable = null) {
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
  // Что можно выбрать — решает поле (`pickable`); по умолчанию — метка с
  // аксессуаром.
  const can = typeof pickable === "function" ? pickable : (markId) => Boolean(markAccessory(project, markId));
  const found = near.find((item) => can(item.markId));
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
export function miniPlanPaint(ctx, { project, scheme, image, filter, box, view: given, drawing, objects, live, liveFx, selected, highlight, fontKind }) {
  ctx.clearRect(0, 0, box.width, box.height);
  if (!project || !scheme) return 0;
  // Вид — тот, куда поле увели (`planView.js`); не дали — вписанный.
  const fitted = given ? miniPlanSized(project, given) : miniPlanView(project, scheme, box);
  const view = { ...fitted, ...(fontKind ? { fontKind } : {}) };
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
