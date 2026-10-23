// Ход по плану — один механизм на все поля (правка после сборки сценариев).
//
// Слова заказчика: «в окне выбора метки двигаться как и на схеме, включая все
// жесты, а ты опять по новому сделал. Переиспользуй везде один механизм».
//
// До правки ход по плану жил в двух копиях — у холста «Схемы» (`canvas.js`) и
// у чертежа (`panels/workshop.js`): общими были только мерки (`gestures.js`,
// шаг и разгон стрелок, клавиши масштаба), а сам ход — разгон удержанной
// стрелки кадрами, масштаб к точке, щипок, перетаскивание — каждый писал себе
// сам. Третья копия появилась у окна выбора метки и разошлась с холстом в тот
// же день: колесо там всегда приближало (трекпад не листал), стрелок и «+»/«−»
// не было вовсе, пределы масштаба были свои.
//
// Теперь ход — здесь, и поверхность отдаёт ему только своё: как прочитать и
// записать вид (`getView`/`setView`), в каких пределах масштаб (`clampZoom`) и
// какого размера поле (`box`). Что делать с нажатием, которое не стало ходом
// (выбрать метку, поставить вершину), решает поверхность — ход только говорит,
// поехала рука или нет. Разбор колеса и щипка по-прежнему у `gestures.js`.
//
// Вид у всех полей один и тот же: `{zoom, offsetX, offsetY}` — экранная точка
// равна `offset + точка плана · zoom`.
import { drawingBoundsMm, planMmToFraction, schemeHeightPx, schemeWidthPx } from "./model.js";
import { fitView } from "./render.js";
import { gesturePinchOf, gesturePinchStep, gestureWheel } from "./gestures.js";

// ——— клавиатура: ход и масштаб ————————————————————————————————————————
//
// Стрелки листают план, как прокрутка: камера едет в сторону стрелки, а не
// план. «Вниз» показывает то, что ниже, «вправо» — то, что правее. Рука при
// перетаскивании двигает сам план, и это другое движение: там план держат
// пальцем, здесь — ведут окно по плану.
//
// Короткое нажатие — один шаг: план подвинуть на чуть-чуть. Удержание после
// небольшой задержки переходит в непрерывный ход с разгоном — мягко в начале
// (чтобы не проскочить) и быстро дальше (чтобы одним нажатием дотащить план
// через весь экран).

/** Шаг короткого нажатия стрелки, экранные пиксели. */
export const PLAN_NAV_PAN_STEP_PX = 24;
// Сколько клавишу держат, прежде чем начнётся непрерывный ход.
const PLAN_NAV_PAN_HOLD_MS = 180;
// Скорость непрерывного хода в начале и на потолке, пикселей в секунду.
const PLAN_NAV_PAN_SPEED_MIN = 240;
const PLAN_NAV_PAN_SPEED_MAX = 2400;
// За столько разгон доходит до потолка.
const PLAN_NAV_PAN_RAMP_MS = 1300;
/** Потолок шага кадра: вкладку свернули на минуту — план не должен улететь. */
export const PLAN_NAV_PAN_FRAME_MS = 64;
// Во сколько раз «+» и «−» меняют масштаб за нажатие (дефект D68).
const PLAN_NAV_ZOOM_KEY_STEP = 1.2;

/** Пределы масштаба плана: от обзора большого дома до отдельной розетки. */
export const PLAN_NAV_ZOOM_MIN = 0.04;
export const PLAN_NAV_ZOOM_MAX = 24;

/** Сдвиг мыши, после которого нажатие считается перетаскиванием. */
export const PLAN_NAV_DRAG_SLOP_PX = 3;
/**
 * То же для пальца, и мера у него своя: тап по метке на планшете уезжает на
 * несколько точек, и по мышиной мерке он почти всегда оказывался бы ходом, а
 * не выбором. Десять точек — столько же, сколько отдают на «тап» системные
 * жесты.
 */
export const PLAN_NAV_TOUCH_SLOP_PX = 10;

// Куда едет вид по каждой стрелке. Числа — знак прибавки к смещению, а
// смещение сдвигает содержимое: чтобы показать то, что правее, содержимое
// обязано уехать влево. Отсюда знаки, обратные наивным.
const PLAN_NAV_PAN_KEYS = {
  ArrowLeft: { x: 1, y: 0 },
  ArrowRight: { x: -1, y: 0 },
  ArrowUp: { x: 0, y: 1 },
  ArrowDown: { x: 0, y: -1 },
};

/** Направление хода по клавише: прибавка к `offsetX/offsetY` на единицу пути; не стрелка — `null`. */
export function planNavPanVector(code) {
  const direction = PLAN_NAV_PAN_KEYS[code];
  return direction ? { x: direction.x, y: direction.y } : null;
}

/**
 * Скорость непрерывного хода по времени удержания, пикселей в секунду. До
 * конца задержки — ноль: там работает шаг короткого нажатия. Дальше квадрат
 * доли разгона — начало мягкое, конец быстрый; потолок обязателен.
 */
export function planNavPanSpeed(heldMs) {
  const running = heldMs - PLAN_NAV_PAN_HOLD_MS;
  if (!(running > 0)) return 0;
  const ramp = Math.min(1, running / PLAN_NAV_PAN_RAMP_MS);
  return PLAN_NAV_PAN_SPEED_MIN + (PLAN_NAV_PAN_SPEED_MAX - PLAN_NAV_PAN_SPEED_MIN) * ramp * ramp;
}

/**
 * Во сколько раз это нажатие меняет масштаб; ноль — не про масштаб. «+» на
 * основном ряду — это Shift и «=», поэтому «=» увеличивает тоже; на цифровой
 * клавиатуре свои клавиши.
 */
export function planNavZoomKey(event) {
  if (event.code === "Equal" || event.code === "NumpadAdd" || event.key === "+" || event.key === "=") {
    return PLAN_NAV_ZOOM_KEY_STEP;
  }
  if (event.code === "Minus" || event.code === "NumpadSubtract" || event.key === "-" || event.key === "_") {
    return 1 / PLAN_NAV_ZOOM_KEY_STEP;
  }
  return 0;
}

/** Масштаб плана в пределах. */
export function planNavClampZoom(zoom) {
  return Math.min(PLAN_NAV_ZOOM_MAX, Math.max(PLAN_NAV_ZOOM_MIN, zoom));
}

/** Масштаб к точке: точка плана под курсором остаётся под курсором. */
export function planNavZoomAt(view, point, factor, clampZoom = planNavClampZoom) {
  const zoom = clampZoom(view.zoom * factor);
  const ratio = zoom / view.zoom;
  return {
    ...view,
    zoom,
    offsetX: point.x - (point.x - view.offsetX) * ratio,
    offsetY: point.y - (point.y - view.offsetY) * ratio,
  };
}

/** Мерка «поехала рука» для мыши и для пальца. */
export function planNavSlop(touch) {
  return touch ? PLAN_NAV_TOUCH_SLOP_PX : PLAN_NAV_DRAG_SLOP_PX;
}

/** Вид после перетаскивания: начальный вид, сдвинутый на ход руки от точки нажатия. */
export function planNavDragView(view, start, point) {
  return { ...view, offsetX: view.offsetX + (point.x - start.x), offsetY: view.offsetY + (point.y - start.y) };
}

/**
 * Вписать **чертёж** схемы: у схемы без подложки вписывать её лист значило бы
 * вписывать пустое поле. Нет чертежа или моста в миллиметры — вписывается
 * лист (`fitView`).
 */
export function planNavFitDrawing(project, scheme, box) {
  const bounds = drawingBoundsMm(project, scheme.id);
  const corners = bounds
    ? [
        planMmToFraction(project, scheme.id, { x: bounds.minX, y: bounds.minY }),
        planMmToFraction(project, scheme.id, { x: bounds.maxX, y: bounds.minY }),
        planMmToFraction(project, scheme.id, { x: bounds.minX, y: bounds.maxY }),
        planMmToFraction(project, scheme.id, { x: bounds.maxX, y: bounds.maxY }),
      ].filter(Boolean)
    : [];
  if (corners.length < 4) return fitView(scheme, box);
  const width = Math.max(1, schemeWidthPx(scheme));
  const height = Math.max(1, schemeHeightPx(scheme));
  const xs = corners.map((point) => point.x * width);
  const ys = corners.map((point) => point.y * height);
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  const spanX = Math.max(1, Math.max(...xs) - left);
  const spanY = Math.max(1, Math.max(...ys) - top);
  const zoom = Math.min(Math.max(1, box.width) / spanX, Math.max(1, box.height) / spanY) * 0.92;
  return {
    zoom,
    offsetX: Math.max(1, box.width) / 2 - (left + spanX / 2) * zoom,
    offsetY: Math.max(1, box.height) / 2 - (top + spanY / 2) * zoom,
  };
}

/** Вписать план целиком — так, как это делает «Вписать» на «Схеме». */
export function planNavFit(project, scheme, box) {
  return scheme.imageId ? fitView(scheme, box) : planNavFitDrawing(project, scheme, box);
}

function planNavNow() {
  return typeof performance === "object" && performance !== null && typeof performance.now === "function" ? performance.now() : Date.now();
}

const PLAN_NAV_FRAMES = {
  schedule: (fn) =>
    typeof requestAnimationFrame === "function" ? requestAnimationFrame(fn) : setTimeout(() => fn(planNavNow()), 16),
  cancel: (id) => (typeof cancelAnimationFrame === "function" ? cancelAnimationFrame(id) : clearTimeout(id)),
};

/**
 * Ход по полю плана. `options`:
 *   `getView()` / `setView(view, how)` — вид поверхности; `how` — `"pan"` или
 *     `"zoom"` (холст перерисовывается одинаково, чертёж после масштаба ещё и
 *     пересобирает колонку);
 *   `clampZoom(zoom)` — пределы масштаба (по умолчанию плановые);
 *   `box()` — `{width, height}` поля: «+» и «−» приближают его середину;
 *   `frames` — `{schedule, cancel}` кадров (по умолчанию `requestAnimationFrame`).
 *
 * Отдаёт: `panBy`, `zoomAt`, `zoomBy`, `wheel(event, point)`,
 * `pinchStart(points)`, `pinchMove(points)`, `pinchEnd()`, `pinching()`,
 * `dragStart(point, {touch})`, `dragMove(point)`, `dragEnd()`, `dragging()`,
 * `panKeyDown(code)`, `panKeyUp(code | null)`, `zoomKey(event)`, `dispose()`.
 * Точки — в координатах поля.
 */
export function createPlanNav(options = {}) {
  const getView = options.getView;
  const setView = options.setView;
  const clampZoom = typeof options.clampZoom === "function" ? options.clampZoom : planNavClampZoom;
  const box = typeof options.box === "function" ? options.box : () => ({ width: 1, height: 1 });
  const frames = options.frames || PLAN_NAV_FRAMES;
  let streak = null;
  let pinch = null;
  let drag = null;
  const held = new Map();
  let frame = 0;
  let clock = 0;

  function panBy(dx, dy) {
    if (!dx && !dy) return;
    const view = getView();
    if (!view) return;
    setView({ ...view, offsetX: view.offsetX + dx, offsetY: view.offsetY + dy }, "pan");
  }

  function zoomAt(point, factor) {
    const view = getView();
    if (!view || !(factor > 0)) return;
    setView(planNavZoomAt(view, point, factor, clampZoom), "zoom");
  }

  function zoomBy(factor) {
    const size = box();
    zoomAt({ x: size.width / 2, y: size.height / 2 }, factor);
  }

  // Колесо и трекпад: листать или приближать, решает `gestures.js`.
  function wheel(event, point) {
    if (event && typeof event.preventDefault === "function") event.preventDefault();
    const move = gestureWheel(event, streak);
    streak = move.streak;
    if (move.kind === "pan") panBy(move.panX, move.panY);
    else zoomAt(point, move.factor);
  }

  // Щипок: масштаб вокруг новой середины, затем сдвиг на её ход — порядок тот
  // же, что был у холста и чертежа.
  function pinchStart(points) {
    pinch = gesturePinchOf(points);
    drag = null;
  }

  function pinchMove(points) {
    if (!pinch) return false;
    const step = gesturePinchStep(pinch, points);
    zoomAt(step.pinch.center, step.factor);
    panBy(step.panX, step.panY);
    pinch = step.pinch;
    return true;
  }

  function pinchEnd() {
    pinch = null;
  }

  // Перетаскивание: ход начинается, когда рука ушла дальше своей мерки, и
  // отсчитывается от точки нажатия — иначе первые точки терялись бы.
  function dragStart(point, { touch = false } = {}) {
    const view = getView();
    drag = view ? { start: point, view: { ...view }, touch: Boolean(touch), moved: false } : null;
  }

  function dragMove(point) {
    if (!drag) return false;
    if (!drag.moved && Math.hypot(point.x - drag.start.x, point.y - drag.start.y) < planNavSlop(drag.touch)) return false;
    drag.moved = true;
    setView(planNavDragView(drag.view, drag.start, point), "pan");
    return true;
  }

  function dragEnd() {
    const moved = Boolean(drag && drag.moved);
    drag = null;
    return moved;
  }

  // Стрелки: первое нажатие — шаг сразу и завод хода; повторы системы
  // пропускаются — ход ведут кадры, а не автоповтор.
  function panKeyDown(code) {
    const direction = planNavPanVector(code);
    if (!direction) return false;
    if (!held.has(code)) {
      held.set(code, planNavNow());
      clock = planNavNow();
      panBy(direction.x * PLAN_NAV_PAN_STEP_PX, direction.y * PLAN_NAV_PAN_STEP_PX);
      schedule();
    }
    return true;
  }

  // Клавишу отпустили — или её отпустили за нас (`null`: окно увели, открылся
  // диалог). Без этого зажатая стрелка уезжает вместе с фокусом.
  function panKeyUp(code) {
    if (code) held.delete(code);
    else held.clear();
    if (held.size > 0 || !frame) return;
    frames.cancel(frame);
    frame = 0;
  }

  function schedule() {
    if (frame || held.size === 0) return;
    frame = frames.schedule(tick);
  }

  function tick() {
    frame = 0;
    if (held.size === 0) return;
    const time = planNavNow();
    const step = Math.min(PLAN_NAV_PAN_FRAME_MS, time - clock) / 1000;
    clock = time;
    let dx = 0;
    let dy = 0;
    for (const [code, since] of held) {
      const speed = planNavPanSpeed(time - since) * step;
      const direction = PLAN_NAV_PAN_KEYS[code];
      dx += direction.x * speed;
      dy += direction.y * speed;
    }
    panBy(dx, dy);
    schedule();
  }

  /** «+» и «−»: приблизить середину поля. `true` — клавиша была про масштаб. */
  function zoomKey(event) {
    const factor = planNavZoomKey(event);
    if (!factor) return false;
    zoomBy(factor);
    return true;
  }

  return {
    panBy,
    zoomAt,
    zoomBy,
    wheel,
    pinchStart,
    pinchMove,
    pinchEnd,
    pinching: () => Boolean(pinch),
    dragStart,
    dragMove,
    dragEnd,
    dragging: () => Boolean(drag),
    panKeyDown,
    panKeyUp,
    zoomKey,
    dispose() {
      panKeyUp(null);
      pinch = null;
      drag = null;
    },
  };
}
