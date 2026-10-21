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
import {
  cancelFrame,
  ELEVATION_GROW_SETTING,
  ELEVATION_VIEWS_SETTING,
  layoutAllows,
  PANEL_IDS,
  registerPanel,
  reportAppError,
  scheduleFrame,
  SCREEN_DEFAULT,
  setScreen,
} from "./app.js";
import { strings, text } from "./strings.js";
import {
  gestureDraftClick,
  gestureDraftEnd,
  gesturePinchOf,
  gesturePinchStep,
  gestureWheel,
} from "./gestures.js";
import {
  DEFAULT_MARK_SIZE,
  DEFAULT_VIEW,
  MARK_KIND_COMMENT,
  OUTLINE_MIN_POINTS,
  addMark,
  addOutline,
  addToGroup,
  applyMarkWalls,
  applyRoomOutlines,
  blockMembers,
  blockStepPx,
  deleteMark,
  deleteOutline,
  findScheme,
  findType,
  findWall,
  findMark,
  findGroup,
  findOutline,
  findRoom,
  gridStepOf,
  addSchemeGuide,
  deleteSchemeGuide,
  extendMarkLine,
  insertMarkPoint,
  insertOutlinePoint,
  moveSchemeGuide,
  schemeGuides,
  schemeHeightPx,
  schemeWidthPx,
  segmentDistanceMm,
  wallsOnScheme,
  labelOf,
  linkedMarkIds,
  markCommentText,
  markIsComment,
  markPointer,
  markSnapshot,
  pasteMark,
  setMarkPointer,
  moveMarkPoint,
  moveOutlinePoint,
  removeMarkPoint,
  removeOutlinePoint,
  drawingBoundsMm,
  drawingCounts,
  drawingScaleFactor,
  formatMeters,
  planFractionToMm,
  planMmToFraction,
  planScaleShort,
  planSizeMeters,
  scaleDrawing,
  setPlanScale,
  PLAN_SCALE_METERS_MAX,
  PLAN_SCALE_SHORT_SHARE,
  styleOf,
  typeKindOf,
  updateMark,
  updateOutline,
} from "./model.js";
import {
  ROOM_TRACE_AREA_MAX_MM2,
  ROOM_TRACE_AREA_MIN_MM2,
  roomTraceAt,
} from "./roomTrace.js";
import {
  drawHandles,
  drawMarkSign,
  cursorFor,
  drawScheme,
  drawingBridge,
  fitView,
  drawLabelTurn,
  drawLabelLeaderSwitch,
  hitHandle,
  hitLabelTurn,
  hitLabelLeader,
  labelLeaderHandle,
  labelLeaderHolder,
  labelLeaderShown,
  markLinks,
  markStacks,
  labelLead,
  hitOutline,
  hitTest,
  labelAngleOf,
  labelTargetOf,
  labelTurnHandle,
  labelBox,
  LABEL_GAP,
  markRadius,
  outlineLabelBox,
  outlineLabelTurn,
  hitOutlineLabelTurn,
  pathVertexHandles,
  pathEditHandles,
  samePathHandle,
  hitPathHandle,
  drawPathHandles,
  drawPressRing,
  drawRuler,
  drawSchemeGuides,
  guideFraction,
  hitSchemeGuide,
  rulerAxis,
  snapToSchemeGuides,
  RULER_SIZE,
  planToScreen,
  screenToPlan,
  draftSnap,
  visibleMarks,
  visibleOutlines,
  drawFontReady,
} from "./render.js";
import { canRedo, canUndo, clearHistory, pushCommand, redo, undo } from "./history.js";
import { getSetting, setSetting } from "./store.js";
import { uiConfirm, uiDialogDepth, uiEl, uiFieldTarget, uiIcon, uiPrompt, uiSpaceTarget, uiTypingTarget } from "./panels/ui.js";
import { createFieldPlate, plateUnseen } from "./panels/plate.js";
import { createElevationStrip, elevationPlace } from "./panels/elevation.js";
import { screenPlaceOf, screenPlacePlanRead, screenPlacePlanView, screenPlaceSet } from "./screenPlace.js";

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

// Шаг короткого нажатия, экранные пиксели. Отдан наружу: чертёж листает вид
// теми же стрелками и тем же шагом (`workshop.js`), и второго числа тут быть
// не должно — разойдись они, одна и та же клавиша ходила бы по-разному на
// плане и в чертеже.
export const CANVAS_PAN_STEP_PX = 24;
// Сколько клавишу держат, прежде чем начнётся непрерывный ход.
const CANVAS_PAN_HOLD_MS = 180;
// Скорость непрерывного хода в начале и на потолке, пикселей в секунду.
const CANVAS_PAN_SPEED_MIN = 240;
const CANVAS_PAN_SPEED_MAX = 2400;
// За столько разгон доходит до потолка.
const CANVAS_PAN_RAMP_MS = 1300;
// Потолок шага кадра: вкладку свернули на минуту — план не должен улететь.
// Тоже отдан наружу — у чертежа свой цикл кадров, но мерка общая.
export const CANVAS_PAN_FRAME_MS = 64;
// Во сколько раз «+» и «−» меняют масштаб за нажатие. Мерка одна на план и на
// чертёж — читают её обе поверхности через `canvasZoomKey` (дефект D68).
const CANVAS_ZOOM_KEY_STEP = 1.2;

// Куда едет вид по каждой стрелке. Числа — знак прибавки к смещению холста,
// а смещение сдвигает содержимое: чтобы показать то, что правее, содержимое
// обязано уехать влево. Отсюда знаки, обратные наивным.
const CANVAS_PAN_KEYS = {
  ArrowLeft: { x: 1, y: 0 },
  ArrowRight: { x: -1, y: 0 },
  ArrowUp: { x: 0, y: 1 },
  ArrowDown: { x: 0, y: -1 },
};

// Направление хода по клавише: прибавка к `view.offsetX/offsetY` на единицу
// пути. Не своя клавиша — `null`.
export function canvasPanVector(code) {
  const direction = CANVAS_PAN_KEYS[code];
  return direction ? { x: direction.x, y: direction.y } : null;
}

// Скорость непрерывного хода по времени удержания клавиши, пикселей в секунду.
// До конца задержки — ноль: там работает шаг короткого нажатия. Дальше квадрат
// доли разгона: прибавка скорости со временем растёт, поэтому начало мягкое,
// а конец быстрый. Потолок обязателен — без него удержание на секунду уносит
// план в другой конец схемы, и обратно его уже не поймать.
export function canvasPanSpeed(heldMs) {
  const running = heldMs - CANVAS_PAN_HOLD_MS;
  if (!(running > 0)) return 0;
  const ramp = Math.min(1, running / CANVAS_PAN_RAMP_MS);
  return CANVAS_PAN_SPEED_MIN + (CANVAS_PAN_SPEED_MAX - CANVAS_PAN_SPEED_MIN) * ramp * ramp;
}

// ——— колесо, трекпад и щипок ——————————————————————————————————————————
//
// Разбора здесь больше нет: приметы трекпада, меры масштаба и щипок двумя
// пальцами живут одним модулем (`gestures.js`), и его же зовут чертёж и окно
// загрузки плана (таск 162, требование G241). Холст остался хозяином того, что
// с ответом делать: `canvasPanBy` и `canvasZoomAt` ниже.

// ——— режим просмотра ——————————————————————————————————————————————————
//
// Узкий экран — не урезанный редактор, а просмотр: так решила раскладка, и
// таблица умений в `app.js` — единственное место, где это записано. Панели по
// ней прячут кнопки, но мышь в суженном окне десктопа никуда не делась, и без
// этой проверки клик по плану ставил метку, перетаскивание двигало её, а Delete
// удалял. Своего списка холст не заводит: спрашивает то же умение `editMarks`.
export function canvasEditAllowed(state) {
  return Boolean(state) && layoutAllows("editMarks", state.layout);
}

// Отказ вслух: правка, которая не случилась, должна быть видна. Молчаливый
// отказ в этой сборке уже стоил четырёх тасков.
function canvasViewOnly() {
  if (canvasApi) canvasApi.notify(strings.mobile.viewOnly);
  return false;
}

// ——— калибровка масштаба: имя режима ——————————————————————————————————
//
// Четвёртый режим холста, короткоживущий: рука показывает две точки отрезка,
// дальше спрашивается расстояние в метрах, и режим сам возвращается в
// «Выделение». Включает его панель схем — масштаб принадлежит схеме, и ручка
// для него стоит там же, где сама схема.
export const CANVAS_MODE_SCALE = "scale";

// ——— помещение по чертежу: имя режима ————————————————————————————————
//
// Пятый режим холста, и тоже короткоживущий: рука показывает **одну** точку
// внутри комнаты, контур находится по стенам, и режим сам возвращается в
// «Выделение» — с выделенным контуром, чтобы вершины сразу были под рукой.
// Включает его панель помещений: помещение принадлежит ей, и вторая дверь в
// этот режим не нужна.
export const CANVAS_MODE_ROOM_TRACE = "roomTrace";

/**
 * Режимы, у которых **нет своей кнопки** в ряду «Режим», — и потому о входе в
 * них говорит плашка (таск 133).
 *
 * Корень беды, который таск 133 лечит, а не обходит: ряд «Режим» знал только
 * выделение и добавление, и в обводке помещения с калибровкой не горела ни
 * одна кнопка — панель показывала состояние, которого не бывает. Теперь ряд
 * называет любой режим, а плашка остаётся вторым следом: ряд живёт в левой
 * колонке, которую на планшете сворачивают, а рука в это время над холстом.
 *
 * Объявление висит **на состоянии, а не на дверях**: режим меняют панель схем,
 * панель помещений, панель выгрузки и клавиши, и каждая новая дверь молчала бы
 * по-своему. Здесь забыть нельзя.
 */
export const CANVAS_MODE_NOTES = {
  room: strings.canvas.modeRoomSaid,
  roomTrace: strings.canvas.modeRoomTraceSaid,
  scale: strings.scale.started,
};

/**
 * Включить калибровку масштаба у схемы — **единственная дверь в режим**.
 *
 * Держит её холст, потому что режим его. Зовут её двое: строка схемы (там
 * кнопка масштаба) и панель выгрузки (там подсказка «масштаб не задан», у
 * которой до таска 133 двери не было вовсе). Второй такой дороги заводить
 * нельзя: разойдись они — одна забудет снять выделение, и ручки метки встанут
 * под рукой, которая целится в точку отрезка.
 *
 * Плашку о переходе даёт не она, а подписка на смену `mode`: так говорят о
 * себе **все** двери, включая клавиши и отмену.
 */
/**
 * Записать новый масштаб плана — и, если чертёж уже есть, спросить, идти ли
 * ему следом (таск 134, требование G186).
 *
 * **Одна дверь на обе поверхности.** Калибруют и на холсте, и в мастерской, и
 * вопрос с пересчётом обязан быть один: два похожих спрашивали бы по-разному и
 * разошлись бы в первую же правку. Здесь же держится и правило «одним шагом» —
 * масштаб и пересчёт уходят в `canvasCommit` вместе, поэтому Ctrl+Z возвращает
 * и то и другое. Два шага были бы ловушкой: отменив половину, человек получил
 * бы несовпадение, которого не делал.
 *
 * **Молча пересчитывать нельзя.** Чертёж мог быть нарисован не по подложке, а
 * по сетке от размеров — такой верен сам по себе, и пересчёт его испортит.
 * Поэтому вопрос, и в нём названа цена: во сколько раз и сколько чего тронет.
 * Первая калибровка не спрашивает ничего — множителя из «масштаба не было» не
 * выходит, и пересчитывать нечего.
 *
 * `before` — объект до записи масштаба, `after` — он же с новым масштабом.
 * Возвращает `{ok, scaled, factor, counts}`; `ok: false` — человек закрыл
 * вопрос, ничего не записано.
 */
export async function canvasCommitScale(before, after, schemeId, options = {}) {
  const factor = drawingScaleFactor(before, after, schemeId);
  const counts = factor ? drawingCounts(before, schemeId) : null;
  const touches = counts ? counts.walls + counts.objects : 0;
  let next = after;
  let scaled = null;
  if (factor && touches > 0) {
    const answer = await uiConfirm({
      title: strings.scale.followTitle,
      message: text("scale.followAsk", {
        change: factor > 1 ? text("scale.followBigger", { times: formatMeters(factor) }) : text("scale.followSmaller", { times: formatMeters(1 / factor) }),
        parts: drawingCountsText(counts),
      }),
      confirmLabel: strings.scale.followYes,
      cancelLabel: strings.scale.followNo,
      // Не красная: ни один из двух ответов ничего не теряет, а отмена у обоих
      // одна и та же — Ctrl+Z.
      confirmClass: "ui-btn ui-btn--accent",
    });
    // Отказ от пересчёта — это «оставить как есть», а не отмена калибровки:
    // масштаб человек уже задал, и терять его на этом вопросе нельзя.
    if (answer) scaled = scaleDrawing(after, schemeId, factor);
    if (scaled) next = scaled.project;
  }
  if (!findScheme(next, schemeId)) return { ok: false, scaled: null, factor, counts };
  canvasCommit(before, next, strings.history.scaleSet, { schemeId, ...options });
  return { ok: true, scaled, factor, counts };
}

/** Цена вопроса словами: только то, чего и правда сколько-то есть. */
export function drawingCountsText(counts) {
  const parts = [];
  if (counts.walls > 0) parts.push(text("scale.followWalls", { count: counts.walls }));
  if (counts.openings > 0) parts.push(text("scale.followOpenings", { count: counts.openings }));
  if (counts.objects > 0) parts.push(text("scale.followObjects", { count: counts.objects }));
  if (counts.marks > 0) parts.push(text("scale.followMarks", { count: counts.marks }));
  return parts.join(", ");
}

export function canvasStartScale(schemeId) {
  // Отрезок меряют **по плану**, значит план и надо показать (таск 153): позвать
  // калибровку можно из строки схемы и из слоёв чертежа, а поле в этот миг может
  // быть занято чертежом или объёмом. Режим — часть самой двери, иначе каждый
  // зовущий чинил бы это сам и однажды забыл бы.
  setScreen(SCREEN_DEFAULT);
  canvasApi.setState({
    schemeId,
    selectedMarkIds: [],
    selectedOutlineId: null,
    editPathId: null,
    mode: CANVAS_MODE_SCALE,
  });
}

/**
 * Включить определение помещения по чертежу — **единственная дверь в режим**
 * (таск 138), как `canvasStartScale` у калибровки.
 *
 * Выделение снимается здесь же: ручки выделенной метки висят над планом и
 * отобрали бы клик у точки, которую человек показывает внутри комнаты.
 */
export function canvasStartRoomTrace(roomId) {
  // Показывают пальцем внутрь комнаты **на плане** — значит план и показываем
  // (таск 153): «Помещения» стоят в колонке во всех трёх режимах.
  setScreen(SCREEN_DEFAULT);
  canvasApi.setState({
    activeRoomId: roomId,
    selectedMarkIds: [],
    selectedOutlineId: null,
    editPathId: null,
    mode: CANVAS_MODE_ROOM_TRACE,
  });
}

/**
 * Отказ автоопределения словами. Чистая функция от объекта и ответа
 * `roomTraceAt`: шесть причин, и каждая называет, что делать дальше.
 *
 * Карта явная, а не `strings.roomTrace[reason]`: склеенный на лету ключ
 * выходит пользователю строкой «roomTrace.foo», и проверка словаря таких
 * разделов не сканирует.
 */
const CANVAS_ROOM_TRACE_SAID = {
  noWalls: strings.roomTrace.noWalls,
  noBridge: strings.roomTrace.noBridge,
  inWall: strings.roomTrace.inWall,
  open: strings.roomTrace.open,
};

export function canvasRoomTraceSaid(project, result) {
  const reason = result ? result.reason : null;
  if (reason === "taken") {
    const room = result.roomId ? findRoom(project, result.roomId) : null;
    return room ? text("roomTrace.taken", { name: room.name }) : strings.roomTrace.takenUnnamed;
  }
  if (reason === "tooSmall") {
    return text("roomTrace.tooSmall", { min: formatMeters(ROOM_TRACE_AREA_MIN_MM2 / 1e6) });
  }
  if (reason === "tooBig") {
    return text("roomTrace.tooBig", {
      area: formatMeters((result.areaMm2 || 0) / 1e6),
      max: formatMeters(ROOM_TRACE_AREA_MAX_MM2 / 1e6),
    });
  }
  if (reason === "tooComplex") return text("roomTrace.tooComplex", { count: result.points || 0 });
  return CANVAS_ROOM_TRACE_SAID[reason] || strings.roomTrace.noWalls;
}

// Цвет отрезка калибровки. Он не часть чертежа и ничьим типом не окрашен —
// поэтому свой, тот же синий, которым холст рисует всё «служебное».
const CANVAS_SCALE_COLOR = "#0969da";

// Видны ли ручки выделенного — поворот подписи, поводок, вершины пути, «+»
// блока. Пока калибруют масштаб, их нет: рука показывает точки отрезка, и
// ручка под курсором отобрала бы у него клик. Одно правило на рисование и на
// попадание — разойдись они, пользователь нажимал бы на то, чего не видит.
function canvasHandlesShown(state) {
  if (!canvasEditAllowed(state)) return false;
  return state.mode !== CANVAS_MODE_SCALE && state.mode !== CANVAS_MODE_ROOM_TRACE;
}

// ——— что ставит режим добавления ——————————————————————————————————————
//
// Режимов у холста три: `select`, `add` и `room`. Отдельного «что ставим» —
// точку или линию — у пользователя больше нет: это решает вид выбранного типа
// (слова заказчика: «просто выделение и добавление, соответственно при выборе
// типа ставится или одно или другое»). Спрашивать вид напрямую у `type.kind`
// нельзя — у объекта прежнего формата его там нет; ответ даёт `typeKindOf`.
//
// Ответ считается на месте, а не хранится вторым полем состояния: тип
// переключают на ходу, и вид ему меняют в справочнике тем же сеансом — второе
// поле разошлось бы с первым молча, и клик поставил бы точку линейным типом.
export function canvasAddKind(state) {
  if (!state || state.mode !== "add") return null;
  if (!state.project || !state.activeTypeId) return null;
  return typeKindOf(state.project, state.activeTypeId);
}

// Ставится ли нынешний тип одним кликом. Точка и комментарий — да: оба встают
// в одну точку, разница только в том, что нарисуется. Линия — нет, её ведут
// вершинами. Отдельная функция, потому что спрашивают это трижды — тап,
// начало ведения и подсказка, — и разойдись ответы, клик ставил бы метку там,
// где подсказка обещала панораму.
export function canvasPlacesByClick(state) {
  const kind = canvasAddKind(state);
  return kind === "point" || kind === MARK_KIND_COMMENT;
}

// ——— план показан или уступил место чертежу с объёмом (таск 153) ————————
//
// Режим экрана один на три поверхности, и холст — одна из них. Отсутствие поля
// в состоянии считается схемой: настройки у режима нет, в объект он не пишется
// (G68), и до первой отрисовки состояние может прийти без него.
export function canvasOnScreen(state) {
  const screen = state && state.screen ? state.screen : SCREEN_DEFAULT;
  return screen === SCREEN_DEFAULT;
}

// Текст подсказки над планом — чистая функция от состояния. `null` значит, что
// подсказки нет вовсе. В просмотре она не рассказывает, как ставить метки и
// рисовать контуры: этого здесь нет, и обещать нечего. В чужом режиме её нет
// совсем: там своя подсказка про своё поле.
export function canvasHintText(state) {
  if (!state || !state.schemeId) return null;
  if (!canvasOnScreen(state)) return null;
  if (!canvasEditAllowed(state)) return strings.mobile.viewOnly;
  // Правка ломаной — это режим руки, и подсказка обязана сказать, что сейчас
  // делает двойной клик: он здесь занят вершинами, а не выделением.
  if (state.editPathId && state.project) {
    if (findMark(state.project, state.editPathId)) return strings.canvas.hintLineEdit;
    if (findOutline(state.project, state.editPathId)) return strings.canvas.hintOutlineEdit;
  }
  const type = state.project && state.activeTypeId ? findType(state.project, state.activeTypeId) : null;
  const room = state.project && state.activeRoomId ? findRoom(state.project, state.activeRoomId) : null;
  // Калибровка — поверх всего остального: рука в этот момент занята отрезком,
  // и про метки с помещениями рассказывать нечего.
  if (state.mode === CANVAS_MODE_SCALE) return strings.scale.hint;
  if (state.mode === CANVAS_MODE_ROOM_TRACE) {
    return text("canvas.hintRoomTrace", { name: room ? room.name : "" });
  }
  if (state.mode === "room") return text("canvas.hintRoom", { name: room ? room.name : "" });
  const adding = canvasAddKind(state);
  if (adding === "point" && type) {
    return canvasHintCopy(text("canvas.hintPoint", { label: type.code + " — " + type.name }));
  }
  if (adding === MARK_KIND_COMMENT && type) {
    return canvasHintCopy(text("canvas.hintComment", { label: type.code + " — " + type.name }));
  }
  if (adding === "line" && type) return strings.canvas.hintLine;
  if (type) return canvasHintCopy(strings.canvas.hintSelectMode);
  return canvasHintCopy(strings.canvas.hintSelect);
}

// Q, Ctrl+C и Ctrl+V работают и в выделении, и в добавлении точки, и подсказка
// обязана назвать их там же. В рисовании линии, в обводке помещения и в правке
// ломаной о них молчим: там рука занята черновиком, а подсказка и без того
// в три строки — в неё дописывают то, что нужно прямо сейчас.
function canvasHintCopy(hint) {
  return hint + " " + strings.canvas.hintCopy;
}

/**
 * Сводка плана — правая плашка режима «Схема» (G228).
 *
 * Заказчик: «в схеме тоже давай сводку», состав — «размеры, количество и т.д.».
 * Поэтому здесь ровно то же, что в сводках чертежа и объёма: **чем схема
 * меряется и сколько в ней чего**. Размер плана в метрах — если масштаб задан;
 * в точках — всегда, это то, во что упираются доли меток. Счёт меток считается
 * **видимых** (`visibleMarks`): фильтр спрятал половину — сводка говорит о том,
 * что на экране, иначе она спорила бы с собственным планом.
 *
 * Чистая и вынесена наружу ради теста: сводка, разошедшаяся с планом, —
 * ровно та ошибка, которую глазами ловят последней.
 */
export function canvasSummaryLines(state) {
  if (!state || !state.project || !state.schemeId) return [];
  const scheme = findScheme(state.project, state.schemeId);
  if (!scheme) return [];
  const lines = [];
  const size = planSizeMeters(state.project, state.schemeId);
  if (size) {
    lines.push(
      text("canvas.sumSize", { width: formatMeters(size.width), height: formatMeters(size.height) }),
    );
  } else if (scheme.imageId) {
    lines.push(strings.canvas.sumNoScale);
  }
  if (Number(scheme.width) > 0 && Number(scheme.height) > 0) {
    lines.push(text("canvas.sumPixels", { width: Math.round(scheme.width), height: Math.round(scheme.height) }));
  }
  const marks = visibleMarks(state.project, scheme, state.filter);
  const all = state.project.marks.filter((mark) => mark.schemeId === scheme.id).length;
  lines.push(
    marks.length === all
      ? text("canvas.sumMarks", { count: all })
      : text("canvas.sumMarksFiltered", { count: marks.length, all }),
  );
  const rooms = (state.project.rooms || []).length;
  const walls = wallsOnScheme(state.project, state.schemeId).length;
  lines.push(text("canvas.sumRooms", { rooms, walls }));
  return lines;
}

// ——— подсказка: отступ от края и знак «текст сменился» ————————————————
//
// Линейка (таск 59) занимает полосу в `RULER_SIZE` пикселей сверху и слева
// холста, и подсказка, стоявшая в самом углу, наехала на неё. Отступ считается
// здесь, а не в стилях: линейку прячут отметкой в «Размерах», и вместе с ней
// обязан уходить отступ — иначе подсказка висит с пустым полем сверху.
export function canvasHintInset(state) {
  // Линейку рисуют **оба плоских поля** (таск 193, G293): отметка «Линейка и
  // направляющие» одна на план и на чертёж, значит и полоса, которую она
  // занимает, одна — иначе подсказка в чертеже наехала бы на деления. В объёме
  // линейки нет вовсе (там не плоскость, а камера), и отступ под неё оставил бы
  // переключатель с полным экраном висеть на пустом поле.
  const screen = state && state.screen ? state.screen : SCREEN_DEFAULT;
  if (screen === "volume") return 0;
  return canvasGuidesShown(state) ? RULER_SIZE : 0;
}

// ——— полный экран ————————————————————————————————————————————————————
//
// Кнопка стоит зеркально подсказке — в правом верхнем углу холста — и
// разворачивает во весь экран страницу целиком, а не один холст: панели и
// шапка нужны и там, а убрать надо адресную строку, которая на планшете
// съедает полосу плана.
//
// Дверь к полному экрану у браузеров называется по-разному: у всех
// `requestFullscreen`, у Safari — `webkitRequestFullscreen`; так же двоятся
// выход, признак «мы внутри» и само событие. Имена перечислены здесь, и
// разбор их — чистые функции: в тесте вместо документа стоит простой объект.
const FULLSCREEN_ENTER = ["requestFullscreen", "webkitRequestFullscreen"];
const FULLSCREEN_EXIT = ["exitFullscreen", "webkitExitFullscreen"];
const FULLSCREEN_ELEMENT = ["fullscreenElement", "webkitFullscreenElement"];
const FULLSCREEN_ALLOWED = ["fullscreenEnabled", "webkitFullscreenEnabled"];
// Выход бывает мимо кнопки — Esc, жест, переключение вкладки, — и кнопка
// обязана об этом узнать. Слушаются оба имени события: у Safari своё.
export const FULLSCREEN_EVENTS = ["fullscreenchange", "webkitfullscreenchange"];

// Даёт ли эта страница полный экран вообще. Установленное приложение (оно и
// так во весь экран) и часть планшетных браузеров его не дают — тогда кнопки
// нет вовсе: кнопка, которая ничего не делает, хуже отсутствующей.
// `fullscreenEnabled === false` — это прямой отказ браузера, а отсутствие
// признака у старого Safari означает только то, что спросить его нечем.
export function canvasFullscreenSupported(doc, element) {
  if (!doc || !element) return false;
  for (const name of FULLSCREEN_ALLOWED) {
    if (name in doc && doc[name] === false) return false;
  }
  return FULLSCREEN_ENTER.some((name) => typeof element[name] === "function");
}

// Мы сейчас в полном экране? Спрашивается у документа, а не хранится флагом:
// выйти можно мимо кнопки, и запомненное состояние разошлось бы с настоящим
// молча — кнопка показывала бы «свернуть» на развёрнутом обратно окне.
export function canvasFullscreenOn(doc) {
  if (!doc) return false;
  return FULLSCREEN_ELEMENT.some((name) => Boolean(doc[name]));
}

// Подпись кнопки говорит, что случится по нажатию, а не то, что сейчас:
// текущее состояние видно по рисунку уголков.
export function canvasFullscreenLabel(on) {
  return on ? strings.canvas.fullscreenExit : strings.canvas.fullscreenEnter;
}

/**
 * Прячет ли полный экран всё, кроме поля (таск 166, G246).
 *
 * Слова заказчика: «в режиме Объём в полноэкраном режиме скрывай всё лишнее,
 * оставь только саму сцену, управление, если с сенсорного девайса, кнопки что
 * поверх сцены, плашку про метку и переключение вида».
 *
 * **Только «Объём».** В «Схеме» и в «Чертеже» полный экран убирает адресную
 * строку, а панели там — рабочие руки: тип метки, инструмент, список. В
 * «Объёме» руки другие — голова, ноги и глаза, — и всё, чем там пользуются на
 * ходу, уже лежит на самом поле.
 *
 * Правило чистое и вынесено наружу: по нему решают двое — страница (что убрать
 * с себя) и поле объёма (что убрать с себя), — и разойтись им нельзя.
 */
export function canvasFullscreenBare(on, screen) {
  return Boolean(on) && screen === "volume";
}

// Переключение. Возвращает обещание: браузер вправе отказать, и отказ надо
// показать, а не проглотить.
//
// Вынесено наружу ради объёмного режима (таск 146): он разворачивает не
// страницу, а своё окно, но дверь к полному экрану у браузеров двоится ровно
// так же. Второй разбор тех же имён разошёлся бы с этим при первой правке.
export function canvasFullscreenToggle(doc, element) {
  if (canvasFullscreenOn(doc)) {
    const exit = FULLSCREEN_EXIT.find((name) => typeof doc[name] === "function");
    return exit ? Promise.resolve(doc[exit]()) : Promise.reject(new Error("no exit"));
  }
  const enter = FULLSCREEN_ENTER.find((name) => typeof element[name] === "function");
  return enter ? Promise.resolve(element[enter]()) : Promise.reject(new Error("no enter"));
}

// Свёрнутость — оснастка рабочего места, как и отметка линейки: живёт в
// настройках браузера, в объект и в файл проекта не попадает.
const CANVAS_HINT_SETTING = "canvasHintCollapsed";
// Свёрнутость сводки — своя (G228): свернул сводку, а подсказка осталась.
const CANVAS_SUMMARY_SETTING = "canvasSummaryCollapsed";
let canvasHintCollapsed = false;
let canvasHintSeen = null;

const CANVAS_ZOOM_MIN = 0.04;
const CANVAS_ZOOM_MAX = 24;
// Смещение курсора, после которого клик считается перетаскиванием.
const CANVAS_DRAG_SLOP = 3;
// Запас к радиусу метки, по которому клик считается попавшим в концевую вершину
// черновика: по кружку в самый его край целиться незачем.
const CANVAS_DRAFT_END_PAD_PX = 6;
// То же для пальца, и мера у него своя. Палец не стоит на месте: тап по метке
// на планшете уезжает на несколько точек, и по мышиной мерке в три точки он
// почти всегда оказывался бы панорамой, а не выбором метки. Десять точек —
// столько же, сколько отдают на «тап» системные жесты.
const CANVAS_TOUCH_SLOP = 10;
// Запас попадания пальца сверх мышиного. Подушечка накрывает вчетверо больше
// экрана, чем остриё курсора, а ручка вершины — квадратик в семь пикселей:
// без запаса за неё не взяться, и человек решит, что ручки не нажимаются.
const CANVAS_TOUCH_HIT_PX = 8;
// Долгое нажатие: сколько держать палец на месте, чтобы взять то, что под ним.
// Слова заказчика про перенос: «зажали иконку и потом потащили на нужное
// место». Порог выбран между двумя бедами: короче — и обычная панорама, начатая
// с метки, утащит метку вместо плана; длиннее — рука устаёт ждать. Те же
// полсекунды берут на долгое нажатие и системные жесты.
const CANVAS_PRESS_MS = 450;
// Двойной тап: окно и разброс. Палец возвращается в ту же точку хуже мыши,
// поэтому разброс щедрее мышиного, а окно взято по верхней границе привычных
// (системные жесты считают двойным тапом 300–400 мс): замкнуть ломаную двумя
// неторопливыми тапами человек должен с первого раза, а не с третьего.
const CANVAS_DOUBLE_TAP_MS = 400;
const CANVAS_DOUBLE_TAP_PX = 28;
// Сколько после касания не верить мышиным событиям. Браузер досылает вслед за
// быстрым двойным тапом «призрачный» `dblclick` — мышиное событие, которого
// пальцем никто не делал. Палец свой двойной тап уже разобрал сам, и второй
// разбор того же жеста снял бы вершину, которую первый только что поставил.
const CANVAS_GHOST_MS = 700;

let canvasPress = null; // ожидание долгого нажатия: {point, pick, at}
let canvasPressTimer = 0;
let canvasLastTap = null; // последний тап пальцем: {point, at} — для двойного
let canvasTouchAt = 0; // когда палец последний раз касался холста
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
// Зажатые стрелки: клавиша → время нажатия. Их может быть две сразу — тогда
// план едет по диагонали, как и должен.
// Последнее событие колеса: по нему тянется решение внутри одного жеста.
let canvasWheelStreak = null;
let canvasPanHeld = new Map();
let canvasPanFrame = 0;
let canvasPanClock = 0;
// Буфер метки: снимок из `markSnapshot` плюс имя исходной метки — по нему
// вставка находит, рядом с чем встать, когда курсора над планом нет.
let canvasClipboard = null;
// Последняя точка курсора на холсте в экранных пикселях. `null` значит, что
// курсор ушёл с холста: тогда вставка целится не под него.
let canvasCursor = null;
// Метка-призрак под рукой: `{point, schemeId}` в долях плана — **уже с
// притяжкой**. `null` — показывать нечего (таск 176, G263).
let canvasGhost = null;
// Серия вставок подряд: `{schemeId, x, y, count}`. Пока вставляют в то же
// место, каждая следующая копия отступает на шаг — иначе метки лягут стопкой.
let canvasPasteRun = null;
// Сказали ли уже, почему клик не поставил метку (таск 217, D66). Один раз на
// вход в «Выделение»: первый пустой клик объясняет, остальные молчат — иначе
// обычное «кликнул мимо» заваливало бы поле плашками. Снимается сменой
// занятия, и только ею: вернулись в «Добавление» и снова в «Выделение» —
// значит это новый случай, и сказать о нём надо снова.
let canvasSilentSaid = false;
// Ручка правимого пути под курсором: по ней бледная ручка разбивки становится
// точкой. Живёт в кадре, а не в состоянии сеанса: наведение мышью — не то, что
// стоит гонять через `setState` и подписчиков панелей.
let canvasHoverHandle = null;
// Вершина, которую сию минуту поставила ручка: `{id, index, at}`. Нужна ровно
// для одного — чтобы двойной клик по ручке разбивки не убирал ту вершину,
// которую сам только что и поставил (первый клик ставит, второй попадает уже
// по ней). Смотри `canvasDoubleClick`.
let canvasFreshVertex = null;
// Столько времени вершина считается «только что поставленной». Наружу отдана
// мастерской (таск 137): полосу объекта там правят той же рукой, и окно, которое
// считало бы вершину свежей другое время, вело бы себя иначе на том же жесте.
export const CANVAS_FRESH_VERTEX_MS = 600;

function canvasNow() {
  const clock = typeof performance === "object" && performance !== null ? performance : null;
  return clock && typeof clock.now === "function" ? clock.now() : Date.now();
}


function canvasPanBy(dx, dy) {
  const state = canvasState();
  if (!state) return;
  canvasApi.setState({
    view: { ...state.view, offsetX: state.view.offsetX + dx, offsetY: state.view.offsetY + dy },
  });
}

// Ход и масштаб холста: есть ли по чему ходить.
//
// **Фокус здесь больше не спрашивается** (таск 213). Стояла третья проверка —
// «клавиатура ничья»: цель события должна была быть документом или лежать
// внутри холста, иначе стрелки и «+»/«−» холст не брал. Её писали до того, как
// у сборки завелись общие предикаты фокуса, и объясняли так: стрелок ждут окно
// выбора типа, окно цвета, поля ввода и списки панелей.
//
// Сегодня всех четверых отсекает кто-то другой, и раньше: окна выбора и окно
// цвета — диалоги, их снимает `uiDialogDepth() > 0`; поля набора снимает
// `uiTypingTarget`; список и ползунок, у которых стрелки свои, — `uiFieldTarget`
// (таск 182). Из-под проверки оставалась одна цель — **кнопка панели**, а
// кнопке стрелки не нужны ни за чем.
//
// Платил за это человек: щёлкнул «Выделение» в колонке — и план перестал
// листаться стрелками и масштабироваться «+»/«−», хотя подсказка их обещает
// (замер живого прогона таска 213: кадр не меняется ни от стрелки, ни от «+»).
// В чертеже та же клавиша в тот же миг работала: там после отсечения полей
// `panKeyDown` зовут без всяких условий. Сведено к чертежу — его ответ
// правильнее: рука на мыши, глаза на плане, и то, что фокус остался на кнопке,
// человека не касается.
function canvasHasPlan() {
  const state = canvasState();
  return Boolean(state && state.schemeId);
}

// Первое нажатие стрелки: один шаг сразу и завод непрерывного хода. Повторы
// нажатия от системы пропускаются — ход ведут кадры, а не автоповтор.
function canvasPanKeyDown(code) {
  const direction = CANVAS_PAN_KEYS[code];
  if (!direction) return false;
  if (!canvasPanHeld.has(code)) {
    canvasPanHeld.set(code, canvasNow());
    canvasPanClock = canvasNow();
    canvasPanBy(direction.x * CANVAS_PAN_STEP_PX, direction.y * CANVAS_PAN_STEP_PX);
    canvasPanSchedule();
  }
  return true;
}

function canvasPanSchedule() {
  if (canvasPanFrame || canvasPanHeld.size === 0) return;
  canvasPanFrame = scheduleFrame(canvasPanTick);
}

function canvasPanTick() {
  canvasPanFrame = 0;
  if (canvasPanHeld.size === 0) return;
  const time = canvasNow();
  const step = Math.min(CANVAS_PAN_FRAME_MS, time - canvasPanClock) / 1000;
  canvasPanClock = time;
  let dx = 0;
  let dy = 0;
  for (const [code, since] of canvasPanHeld) {
    const speed = canvasPanSpeed(time - since) * step;
    const direction = CANVAS_PAN_KEYS[code];
    dx += direction.x * speed;
    dy += direction.y * speed;
  }
  if (dx !== 0 || dy !== 0) canvasPanBy(dx, dy);
  canvasPanSchedule();
}

// Клавишу отпустили — или её отпустили за нас: окно увели, открылся диалог.
// Без этого зажатая стрелка уезжает вместе с фокусом и не останавливается.
function canvasPanRelease(code) {
  if (code) canvasPanHeld.delete(code);
  else canvasPanHeld.clear();
  if (canvasPanHeld.size > 0 || !canvasPanFrame) return;
  cancelFrame(canvasPanFrame);
  canvasPanFrame = 0;
}

/**
 * Во сколько раз это нажатие меняет масштаб. Ноль означает «не про масштаб».
 *
 * «+» на основном ряду — это Shift и «=», поэтому «=» увеличивает тоже; на
 * цифровой клавиатуре свои клавиши. Набор клавиш и шаг — **одна мерка на две
 * поверхности** (дефект D68, таск 220): чертёж зовёт эту же функцию, как он
 * уже зовёт `canvasPanVector` и `canvasPanSpeed` для стрелок. Второй список
 * кодов разошёлся бы с этим на `NumpadAdd` в тот же день, когда его написали.
 */
export function canvasZoomKey(event) {
  if (event.code === "Equal" || event.code === "NumpadAdd" || event.key === "+" || event.key === "=") {
    return CANVAS_ZOOM_KEY_STEP;
  }
  if (event.code === "Minus" || event.code === "NumpadSubtract" || event.key === "-" || event.key === "_") {
    return 1 / CANVAS_ZOOM_KEY_STEP;
  }
  return 0;
}

function canvasState() {
  return canvasApi ? canvasApi.getState() : null;
}

// Во `view` для рисования сходятся две половины: масштаб и сдвиг — сеансовые,
// размеры метки и подписи — из объекта (их двигает ползунок в панели).
function canvasViewOf(state) {
  const sizes = state.project && state.project.view ? state.project.view : {};
  // Вид шрифта — третья половина `view`, рядом с сеансовым масштабом и
  // объектными размерами: это выбор глаз из личных настроек браузера, в объект
  // он не попадает. Выгрузка собирает свой `view` сама и этого поля не кладёт,
  // поэтому на бумагу уходит чертёжный шрифт независимо от настройки (G172).
  // Поля кладутся, только когда они у объекта есть. Иначе `undefined`
  // перебивает умолчание `render` — у объекта, собранного мимо
  // `createProject` (чужой файл, сборка руками), `markRadius` отвечал `NaN`,
  // и обводка контура переставала замыкаться двойным кликом: порог «клик по
  // первой вершине» считается от радиуса. Найдено исполнителем таска 138.
  const view = { ...state.view, fontKind: state.schemeFont };
  if (sizes.markSize !== undefined) view.markSize = sizes.markSize;
  if (sizes.labelSize !== undefined) view.labelSize = sizes.labelSize;
  return view;
}

// Внутренности холста, открытые тестам. Приём тот же, что у `renderInternals`:
// функции остаются частными, но проверяемыми — иначе правило «поле кладётся,
// только когда оно есть» держалось бы на комментарии.
export const canvasInternals = { viewOf: canvasViewOf };

function canvasScheme(state) {
  return state.project && state.schemeId ? findScheme(state.project, state.schemeId) : null;
}

// Подложка на кадре: картинка схемы, пока её не выключили. Выключатель —
// личная настройка браузера (таск 127): скрыл фотографию — размечает по
// своему чертежу.
function canvasImage(state) {
  if (state.planShown === false) return null;
  const loaded = state.schemeImage;
  return loaded && loaded.schemeId === state.schemeId ? loaded.image : null;
}

function canvasProject(state) {
  return canvasPreview || state.project;
}

// ——— одно место и один масштаб на три режима (G276, D59) ————————————————
//
// Слова заказчика: «сейчас при переключении я не остаюсь там же, точнее не
// всегда работает и уровень зума меняется. Должно совпадать пиксель в пиксель».
//
// План говорит, где стоит, на **каждый кадр** — в миллиметрах чертежа и в
// экранных точках на миллиметр, — и говорит это только пока он на экране: кадр
// рисуется и в чужом режиме, а запись из спрятанного поля перебила бы то, куда
// уехало поле на виду. Читает он место, только когда оно **чужое**: отметка
// записи растёт на каждую правку, и своя собственная ничего не значит.
let canvasPlaceStamp = 0;

function canvasPushPlace(state, project, view) {
  // Кто на экране — тот и пишет (D61). Спрашивается это дважды: здесь, чтобы
  // не считать место впустую, и в самой записи, где правило общее на три поля.
  if (!canvasOnScreen(state) || !state.schemeId) return;
  const place = screenPlacePlanRead(project, state.schemeId, canvasBox(), view);
  if (!place) return;
  canvasPlaceStamp = screenPlaceSet(SCREEN_DEFAULT, state.schemeId, place, place.pxPerMm);
}

/**
 * Встать туда, где стояло поле, с которого пришли (или куда просит память
 * вида). `false` — места нет, нет моста в миллиметры или оно своё же.
 *
 * Подгонка после этого не нужна и вредна: `canvasAutoFit` срабатывает, когда
 * доедет подложка, — то есть **после** перехода, — и увёл бы план от
 * назначенного места. Это и был случай «не всегда работает»: первый переход
 * после загрузки объекта.
 */
function canvasPullPlace(state) {
  if (!canvasOnScreen(state) || !state.schemeId) return false;
  const place = screenPlaceOf(state.schemeId);
  if (!place || place.stamp === canvasPlaceStamp) return false;
  const next = screenPlacePlanView(state.project, state.schemeId, canvasBox(), place, state.view);
  if (!next) return false;
  canvasPlaceStamp = place.stamp;
  canvasFitted = state.schemeId;
  canvasApi.setState({ view: next });
  return true;
}

function canvasPointOf(event) {
  const box = canvasNode.getBoundingClientRect();
  return { x: event.clientX - box.left, y: event.clientY - box.top };
}

// ——— рисование ———————————————————————————————————————————————————————

function canvasRedraw() {
  if (canvasFrame || !canvasNode) return;
  canvasFrame = scheduleFrame(() => {
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

/**
 * Что обведено выделением в этом кадре.
 *
 * Обычно — выделенные метки сеанса. Пока ведут группу (G189), обведена вся
 * она: по пунктиру видно, что взяли блок, а не одну розетку, и видно это до
 * того, как кнопка отпущена. Выделение сеанса при этом не трогается — в нём
 * остаётся взятая метка, у неё и после переноса открыта карточка и стоят
 * ручки «+». Кадр говорит «везу блок», состояние — «работаю с этой меткой»,
 * и путать эти два ответа нельзя: правка полей в панели адресуется одной.
 */
function canvasFrameSelected(state) {
  const moving = canvasDrag && canvasDrag.kind === "mark" && canvasDrag.moved ? canvasDrag.moving : null;
  if (!moving || moving.length < 2) return state.selectedMarkIds;
  return moving;
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
  // Где стоит план — общему месту трёх режимов (D59). На кадр это один перевод
  // середины поля в миллиметры: дешевле, чем ловить все двери к `view`.
  canvasPushPlace(state, project, view);
  const draftColor = canvasDraftColor(state, project);
  drawScheme(canvasCtx, {
    project,
    scheme,
    image: canvasImage(state),
    // Чертёж — слой под метками; выключатель его прячет, а не удаляет.
    drawing: state.drawingShown !== false,
    // Вещи чертежа: отметка «скрыть все» и спрятанные поштучно глазком
    // (таск 154, G223). Это экран: в PNG, в лист ГОСТ и в развёртки ничего из
    // этого не уходит — там свои галки видимости.
    objects: state.objectsShown !== false,
    hiddenObjectIds: state.hiddenObjectIds,
    // Сетка чертежа — и на плане (таск 193, G293). Шаг тот же, что в чертеже:
    // он лежит в объекте (G258), и второго числа у сетки нет.
    grid: canvasGridLayer(state, project),
    selectedWallId: state.selectedWallId || null,
    filter: state.filter,
    view,
    selectedIds: canvasFrameSelected(state),
    selectedOutlineId: state.selectedOutlineId || null,
    draft: canvasDraft,
    guides: canvasDrag && (canvasDrag.kind === "pathVertex" || canvasDrag.kind === "pathAdd") ? canvasDrag.guides : null,
    // Готовый кадр связей, а не `true`: холст считает их из того же
    // промежуточного объекта, что и метки, — иначе дуга отстанет от метки,
    // которую ведут мышью. Выгрузка передаёт сюда `true` и считает сама.
    links: canvasFrameLinks(state, canvasPreview, scheme),
    draftColor,
    // Отрезок калибровки — всегда сплошной: начертание выбранного типа к нему
    // отношения не имеет, а волна вместо прямой мешала бы целиться.
    draftLineStyle:
      state.activeTypeId && state.mode !== CANVAS_MODE_SCALE ? styleOf(project, state.activeTypeId).lineStyle : "solid",
  });
  // Метка-призрак — **сразу за метками и до линейки**: поставленная метка
  // ляжет ровно сюда же, и выглядеть призрак обязан так же. В `drawScheme` его
  // нет вовсе — значит, в PNG, в печать и в лист «Схема» он не попадёт ни при
  // каких отметках, как и направляющие рядом.
  const ghostMark = canvasGhostMark(state, canvasPlaceSpot(canvasGhost, null, state.schemeId));
  if (ghostMark) drawMarkSign(canvasCtx, project, scheme, ghostMark, view, { ghost: true });
  // Здесь `editable` отвечает только за ручки — поэтому и спрашивается про
  // них: в калибровке их нет.
  const editable = canvasHandlesShown(state);
  const outline = editable && state.selectedOutlineId ? findOutline(project, state.selectedOutlineId) : null;
  if (outline && outline.schemeId === scheme.id && !canvasDrag) {
    // Ручка поворота — у самой подписи комнаты, как у подписи метки: подпись
    // вдоль стены ставят, глядя на план, а не в панель.
    const room = findRoom(project, outline.roomId);
    drawLabelTurn(canvasCtx, outlineLabelTurn(project, scheme, outline, view), (room && room.color) || "#0969da");
  }
  // Направляющие пользователя — под ручками и над планом: их ставят, чтобы
  // целиться, и терять их под меткой нельзя. В `drawScheme` их нет вовсе,
  // поэтому в PNG, в печать и в лист «Схема» они не попадают.
  const box = canvasBox();
  const guidesOn = canvasGuidesShown(state);
  if (guidesOn) {
    const live = canvasDrag && canvasDrag.kind === "guideMove" ? canvasDrag.guideId : null;
    // Утащенная на линейку направляющая по отпусканию снимется — пусть это
    // будет видно до того, как кнопка отпущена, а не после.
    const dropping = canvasDrag && canvasDrag.kind === "guideMove" && canvasDrag.drop ? canvasDrag.guideId : null;
    drawSchemeGuides(canvasCtx, canvasFrameGuides(state, canvasPreview, scheme), scheme, view, box, {
      activeId: live,
      dropId: dropping,
    });
    // Новая направляющая, которую сейчас тянут с линейки: в объекте её ещё нет.
    if (canvasDrag && canvasDrag.kind === "guideNew") {
      drawSchemeGuides(
        canvasCtx,
        [{ id: "draft", axis: canvasDrag.axis, at: canvasDrag.at }],
        scheme,
        view,
        box,
        { activeId: "draft" },
      );
    }
  }

  // Ручки вершин правимого пути — одни и те же у ломаной метки и у контура
  // помещения: обводка по стенам с первого раза не выходит, и ошибка на третьей
  // вершине из десяти правится третьей, а не перерисовкой всего.
  const edited = editable && !canvasDrag ? canvasEditedPath(state, scheme) : null;
  if (edited) drawPathHandles(canvasCtx, pathEditHandles(scheme, edited, view), null, canvasHoverHandle);

  // Ручки «+» — только у одной выделенной точки: у линии блока не бывает.
  // Ручка поворота подписи — у самой подписи выделенной метки: подпись вдоль
  // стены ставят, глядя на план, а не в панель.
  if (editable && state.selectedMarkIds.length === 1 && !canvasDrag) {
    const target = labelTargetOf(project, scheme, state.selectedMarkIds[0], state.filter);
    const lead = target ? labelLead(project, target) : null;
    const color = styleOf(project, lead && lead.typeId).color;
    drawLabelTurn(canvasCtx, labelTurnHandle(project, scheme, target, view, state.filter), color);
    // Вторая ручка того же ряда — поводок подписи. Показывает, что сейчас:
    // включённый поводок нарисован, выключенный зачёркнут.
    if (target) {
      drawLabelLeaderSwitch(
        canvasCtx,
        labelLeaderHandle(project, scheme, target, view, state.filter),
        color,
        labelLeaderShown(project, target, labelBox(project, scheme, target, view, state.filter)),
      );
    }
  }
  if (editable && state.selectedMarkIds.length === 1 && !canvasDrag) {
    const mark = findMark(project, state.selectedMarkIds[0]);
    if (mark && mark.kind === "point" && mark.schemeId === scheme.id) {
      drawHandles(canvasCtx, scheme, mark, view, canvasHandleColor(state, mark), canvasStacks(state, scheme));
    }
  }
  // Линейка — последней: она поверх всего, и с неё тянут направляющие.
  if (guidesOn) drawRuler(canvasCtx, scheme, view, box);

  // Кольцо ожидания под пальцем — поверх и линейки: это ответ руке, а не часть
  // чертежа. Цвет — у того, что сейчас возьмут: по нему видно, что именно
  // держат, ещё до того, как оно поедет.
  if (canvasPress) {
    const held = canvasPress.pick && canvasPress.pick.markId ? findMark(project, canvasPress.pick.markId) : null;
    const color = held ? styleOf(project, held.typeId).color : "#0969da";
    drawPressRing(canvasCtx, { ...canvasPress.point, r: markRadius(view) + 14 }, canvasPressProgress(canvasNow() - canvasPress.at), color);
    // Кадр за кадром, пока палец держат: кольцо обязано закрываться на глазах,
    // а своего хода у него нет — рисует его тот же кадр холста.
    canvasRedraw();
  }
}

// Цвет черновика: у контура помещения — цвет комнаты, у метки — цвет её типа,
// у отрезка калибровки — свой: он ничьего типа не несёт.
function canvasDraftColor(state, project) {
  if (state.mode === CANVAS_MODE_SCALE) return CANVAS_SCALE_COLOR;
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
  // Последняя дверь перед объектом. Выше стоят свои засовы на каждом входе
  // холста, но правка приходит и из панелей, и пропустить её здесь — значит
  // сделать режим просмотра украшением.
  if (!canvasEditAllowed(state)) {
    canvasViewOnly();
    return;
  }
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
  // Вторая автоматика того же места и по той же причине (таск 128): привязка
  // метки к стене обязана быть следствием её места на плане, а не отдельного
  // действия. Здесь же она переживает и правку стены: подвинули стену —
  // расстояние пересчиталось, увели далеко — привязка снялась.
  //
  // Ярлык шага от неё **не меняется**: про помещения говорится вслух, потому
  // что их человек правит руками и ждёт увидеть своё; стену же метке никто не
  // назначал, и «+ стены» в списке отмены было бы отчётом о том, чего он не
  // делал.
  const walls = applyMarkWalls(binding.project);
  const bound = walls.project;
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
  reportAppError(error);
}

/**
 * Метку поставили за планом, и модель прижала её к краю (дефект D73) — сказать
 * об этом надо словом. Дверь одна на обе постановки — точку и линию; две копии
 * правила разошлись бы, а повод у них один. Вставка копии сюда не ходит: её
 * `markShapeAt` двигает целиком, пока она не войдёт в план, и за краем копия
 * не оказывается никогда.
 *
 * Говорится **один раз на вход в занятие** — той же меркой и в том же месте,
 * что молчаливый клик таска 217: человек, который ведёт мышь по краю плана, не
 * должен читать одну и ту же строку на каждую метку.
 */
let canvasPinnedSaid = false;

function canvasSayPinned(result) {
  if (!result || !result.pinned || canvasPinnedSaid) return;
  canvasPinnedSaid = true;
  canvasApi.notify(strings.canvas.markPinned, "info");
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
      // Вид метки берётся у типа, а не прибивается к точке: тип-комментарий
      // ставит комментарий, и плашка появляется там, где щёлкнули.
      kind: canvasAddKind(state) === MARK_KIND_COMMENT ? MARK_KIND_COMMENT : "point",
      // Точка липнет к направляющим — ради этого их и ставят: «6 вертикальных,
      // 2 горизонтальных и на перекрестия ставишь точки».
      points: [canvasGuideSnap(plan)],
    });
    canvasCommit(state.project, result.project, strings.history.addMark, { selection: [result.mark.id] });
    canvasSayPinned(result);
  } catch (error) {
    canvasFail(error);
  }
}

// ——— метка-призрак под рукой (таск 176, G263) —————————————————————————
//
// Слова заказчика: «При добавлении метки так же рисуй под курсором её». «Так
// же» — как у вещи чертежа (таск 168), и приём взят оттуда целиком, без
// второго механизма:
//
//   рисует призрака **тот же код**, что и поставленную метку
//     (`render.drawMarkSign` с приметой `ghost`) — фигура, цвет и величина
//     знака те же, пунктиром и вполсилы;
//   считается он **из той точки, из которой пойдёт постановка**
//     (`canvasPlaceSpot`). В таске 168 на этом и попались: призрак считался от
//     события движения руки, а клик — от события отпускания, и между ними
//     разрешена вся мерка «рука поехала». На плане магнит мельче, чем сетка
//     чертежа, но он есть: `GUIDE_SNAP_PX` — семь точек вокруг направляющей.
//     Дрогнула рука на две точки поперёк её полосы — и метка села на семь
//     точек в стороне от показанного, мимо перекрестия, ради которого
//     направляющие и ставят.
//
// Призрака нет у метки-линии: её ведут вершинами, и до первого клика тянуть
// резинку не от чего — ровно та же оговорка, что у росчерка в чертеже.
// Комментарий тоже без призрака: он рисуется плашкой, а плашку рисует проход
// подписей по её тексту, которого до постановки ещё не набрали.

/**
 * Метка, которую поставит клик, — или `null`, если показывать нечего.
 *
 * `point` — доли плана **с уже применённой** притяжкой к направляющим: та же
 * точка, что уйдёт в `addMark`.
 */
export function canvasGhostMark(state, point) {
  if (!state || !point || !state.schemeId || !state.project) return null;
  if (!canvasEditAllowed(state)) return null;
  if (!canvasPlacesByClick(state) || canvasAddKind(state) !== "point") return null;
  const typeId = canvasPlacedTypeId(state);
  if (!typeId) return null;
  // Метка настоящая во всём, кроме имени: номер ей выдаст модель при
  // постановке, и обещать его призраком нельзя — пока рука ходит по плану,
  // метку мог поставить второй человек с того же объекта.
  return {
    id: "",
    schemeId: state.schemeId,
    typeId,
    number: 0,
    kind: "point",
    points: [point],
    closed: false,
    groupId: null,
    labelOffset: null,
  };
}

/**
 * Точка постановки — **та самая, из которой нарисован призрак** (таск 176,
 * вслед за 168).
 *
 * Клик приходит из события отпускания кнопки, а призрак нарисован по
 * последнему движению руки; между ними разрешена вся мерка «рука поехала»
 * (`canvasDragSlop`: три точки у мыши, десять у пальца). Сама по себе эта
 * дрожь ничего не стоит — но притяжка к направляющей ловит точку в семи точках
 * от неё (`GUIDE_SNAP_PX`), и граница этой полосы проходит где-то рядом всегда:
 * дрогнула рука поперёк неё — и метка села не туда, куда показывал призрак.
 *
 * Сырой курсор остаётся запасным путём: призрака может не быть вовсе —
 * например, палец на сенсорном экране касается, не наведя.
 */
export function canvasPlaceSpot(ghost, plan, schemeId) {
  if (!ghost || !ghost.point) return plan;
  if (schemeId && ghost.schemeId !== schemeId) return plan;
  return ghost.point;
}

// Пересчитать призрака под рукой. Отвечает, сменилось ли место: кадр
// перерисовывается только тогда — мышь ходит по плану десятками шагов в
// секунду.
function canvasGhostUpdate(state) {
  const scheme = canvasScheme(state);
  const plan = scheme ? canvasCursorPlan(state, scheme, canvasViewOf(state)) : null;
  const next =
    plan && canvasPlacesByClick(state) ? { point: canvasGuideSnap(plan), schemeId: state.schemeId } : null;
  const was = canvasGhost;
  canvasGhost = next;
  if (!was || !next) return Boolean(was) !== Boolean(next);
  return was.schemeId !== next.schemeId || was.point.x !== next.point.x || was.point.y !== next.point.y;
}

// Призрак снимается вместе с курсором: рука ушла с холста — обещать нечего.
function canvasGhostDrop() {
  if (!canvasGhost) return false;
  canvasGhost = null;
  return true;
}

// Тип, который поставит следующий клик: выбранный в панели, пока он жив
// в справочнике. Иначе — ничего, и модель повторит тип соседней метки.
function canvasPlacedTypeId(state) {
  const typeId = state.activeTypeId;
  if (!typeId || !state.project || !findType(state.project, typeId)) return null;
  return typeId;
}

// ——— пипетка, копирование и вставка ——————————————————————————————————
//
// Три жеста заказчика: «хоткей Q — скопировать тип метки, чтобы добавить новую
// такую же, а также через command (control) C / V копировать и вставлять метки
// (по сути копируем тип и вставляем туда, где курсор, если он на поле схемы,
// или рядом, если за пределами, и выделяем его сразу)».
//
// Q и Ctrl+C — про разное, и объединять их нельзя. Q меняет **чем размечают
// дальше**: тип уходит в панель, и следующий клик по плану ставит такую же
// метку — это пипетка. Ctrl+C ничего не меняет в инструменте: он кладёт метку
// в буфер, и поставит её Ctrl+V, не трогая выбранный тип. Скопировать розетку
// «на потом», продолжая ставить выключатели, — обычное дело.
//
// Что переезжает в копию, решает `model.markSnapshot` — там же и объяснено.

// Куда целится вставка **до** каскада. Три случая, по убыванию точности:
//   1. Курсор над планом — точка под ним. Прямые слова заказчика; притяжка к
//      направляющим та же, что у клика, иначе вставка мимо перекрестия.
//   2. Курсора над планом нет (он на панели, на линейке, за краем плана) —
//      рядом с исходной меткой, на шаг блока вправо-вниз. Её только что
//      скопировали, она на виду, и копия встаёт у неё под боком: ровно жест
//      «розетка у кровати слева — такую же справа», где копию потом оттащат.
//   3. Исходной метки уже нет или она на другом листе — центр видимой области.
//      Ставить копию за краем экрана нельзя: пользователь решит, что вставка
//      не сработала, и нажмёт ещё раз.
function canvasPasteBase(state, scheme, view, step) {
  const cursor = canvasCursorPlan(state, scheme, view);
  if (cursor) return canvasGuideSnap(cursor);
  const source = canvasClipboard.markId ? findMark(state.project, canvasClipboard.markId) : null;
  if (source && source.schemeId === state.schemeId && source.points.length > 0) {
    const from = source.points[0];
    return { x: from.x + step.x, y: from.y + step.y };
  }
  const box = canvasBox();
  return screenToPlan({ x: box.width / 2, y: box.height / 2 }, scheme, view);
}

// Доли плана под курсором — или `null`, когда курсора над планом нет. Полоса
// линейки планом не считается: там вытягивают направляющие, а не ставят метки.
function canvasCursorPlan(state, scheme, view) {
  if (!canvasCursor || !scheme) return null;
  if (canvasGuidesShown(state) && canvasOnRuler(canvasCursor)) return null;
  const plan = screenToPlan(canvasCursor, scheme, view);
  if (!(plan.x >= 0 && plan.x <= 1 && plan.y >= 0 && plan.y <= 1)) return null;
  return plan;
}

// Шаг каскада в долях плана — тот же, что у соседней точки блока: ближе знаки
// сливаются в кляксу, дальше копия перестаёт читаться как пара исходной.
function canvasPasteStep(state, scheme) {
  const px = canvasBlockStep(state);
  return {
    x: px / schemeWidthPx(scheme),
    y: px / schemeHeightPx(scheme),
  };
}

/**
 * Точка очередной вставки и состояние серии.
 *
 * Вставили дважды подряд, не двигая мышь, — вторая копия обязана отойти в
 * сторону: стопка меток в одной точке выглядит как одна метка, и пользователь
 * решит, что вставка не сработала (а на плане у него уже три розетки). Отсюда
 * серия: пока целятся в то же место, каждая следующая копия отступает ещё на
 * шаг вправо-вниз, лесенкой.
 *
 * «То же место» — ближе половины шага: ближе этого метки всё равно наложились
 * бы, значит это продолжение серии, а не новая точка. Отодвинулись дальше —
 * серия начинается заново, и копия встаёт ровно туда, куда показали.
 *
 * Чистая и вынесена наружу нарочно: лесенка — единственное здесь, что можно
 * проверить числами, всё остальное проверяется руками над планом.
 */
export function canvasPasteSpot(base, run, step) {
  const near = (a, b, size) => Math.abs(a - b) <= Math.abs(size) / 2;
  const same = Boolean(run) && near(run.x, base.x, step.x) && near(run.y, base.y, step.y);
  const count = same ? run.count + 1 : 1;
  const shift = count - 1;
  return {
    point: {
      x: canvasFraction(base.x + step.x * shift),
      y: canvasFraction(base.y + step.y * shift),
    },
    run: { x: base.x, y: base.y, count },
  };
}

function canvasFraction(value) {
  return Math.min(1, Math.max(0, value));
}

// Метка, с которой работают жесты: первая из выделения. Выделен блок — берётся
// его первая метка, и уведомление называет её по имени: буфер и правда получил
// одну метку, обещать блок было бы враньём.
function canvasGestureMark(state) {
  if (!canvasEditAllowed(state)) {
    canvasViewOnly();
    return null;
  }
  const markId = state.selectedMarkIds[0];
  const mark = markId && state.project ? findMark(state.project, markId) : null;
  if (!mark) {
    canvasApi.notify(strings.canvas.needMark);
    return null;
  }
  return mark;
}

// Q — пипетка: тип выделенной метки становится текущим, и холст переходит в
// добавление. Переход в режим — часть жеста: тип берут, чтобы ставить такие же,
// и оставить пользователя в выделении значило бы потребовать второго нажатия.
// В историю это не пишется: выбранный тип и режим — оснастка руки, а не объект.
function canvasPickType() {
  const state = canvasState();
  const mark = canvasGestureMark(state);
  if (!mark) return;
  const type = findType(state.project, mark.typeId);
  if (!type) {
    canvasApi.notify(strings.errors.typeNotFound, "error");
    return;
  }
  canvasApi.setState({ activeTypeId: mark.typeId, mode: "add" });
  canvasApi.notify(text("canvas.typeTaken", { label: type.code + " — " + type.name }), "success");
}

// Ctrl+C — снимок выделенной метки в буфер. Серия вставок при этом обнуляется:
// новая копия начинает свою лесенку с того места, куда её поставят.
function canvasCopyMark() {
  const state = canvasState();
  const mark = canvasGestureMark(state);
  if (!mark) return;
  try {
    canvasClipboard = { snapshot: markSnapshot(state.project, mark.id), markId: mark.id };
    canvasPasteRun = null;
    canvasApi.notify(text("canvas.copied", { label: labelOf(state.project, mark.id) }), "success");
  } catch (error) {
    canvasFail(error);
  }
}

// Ctrl+V — копия из буфера в объект. Правка объекта, значит через `canvasCommit`:
// один шаг истории, Ctrl+Z возвращает всё как было. Поставленная метка сразу
// выделена — так её видно, и её же ждут ручки «+» и панель свойств.
function canvasPasteMark() {
  const state = canvasState();
  if (!canvasEditAllowed(state)) {
    canvasViewOnly();
    return;
  }
  if (!state.schemeId) {
    canvasApi.notify(strings.canvas.needScheme);
    return;
  }
  if (!canvasClipboard) {
    canvasApi.notify(strings.canvas.pasteEmpty);
    return;
  }
  const scheme = canvasScheme(state);
  if (!scheme) {
    canvasApi.notify(strings.canvas.needScheme);
    return;
  }
  const view = canvasViewOf(state);
  const step = canvasPasteStep(state, scheme);
  const run = canvasPasteRun && canvasPasteRun.schemeId === state.schemeId ? canvasPasteRun : null;
  const spot = canvasPasteSpot(canvasPasteBase(state, scheme, view, step), run, step);
  try {
    const result = pasteMark(state.project, canvasClipboard.snapshot, {
      schemeId: state.schemeId,
      point: spot.point,
    });
    canvasPasteRun = { schemeId: state.schemeId, ...spot.run };
    canvasCommit(state.project, result.project, strings.history.pasteMark, { selection: [result.mark.id] });
    canvasApi.notify(text("canvas.pasted", { label: labelOf(result.project, result.mark.id) }), "success");
  } catch (error) {
    canvasFail(error);
  }
}

// Цвет ручек «+»: выбран тип, отличный от типа метки, — ручка красится в его
// цвет, и по ней видно, что рядом встанет розетка, а не второй выключатель.
// Тип тот же или не выбран — ручка синяя, как выделение.
function canvasHandleColor(state, mark) {
  const typeId = canvasPlacedTypeId(state);
  return typeId && typeId !== mark.typeId ? styleOf(state.project, typeId).color : null;
}

// Шаг блока считается от величины знака метки — той самой, что стоит у
// пользователя в ползунке: метки в блоке должны стоять как розетки в одной
// рамке при любой величине. Прежний нижний порог в пикселях это ломал —
// у мелкой метки он разносил блок на семь радиусов.
function canvasBlockStep(state) {
  const view = state.project ? state.project.view : null;
  return blockStepPx(view ? view.markSize : DEFAULT_MARK_SIZE);
}

// Стопки совпавших меток этой схемы — ровно те, что сейчас на экране: фильтр и
// величина знака те же, что в кадре. Нужны они холсту затем, что ручки «+»
// рисуются у **знака**, а знак в стопке отодвинут от своей точки.
function canvasStacks(state, scheme) {
  if (!state.project || !scheme) return null;
  return markStacks(state.project, scheme, state.filter, canvasViewOf(state));
}

// Смещение знака выделенной метки в пикселях плана — его холст передаёт модели
// вместе с шагом: новая метка обязана встать туда, где нарисована ручка «+»,
// а не на настоящую точку, над которой стоит чужой знак.
function canvasStackShift(state, scheme, markId) {
  const stacks = canvasStacks(state, scheme);
  const shift = stacks ? stacks.get(markId) : null;
  return shift ? shift.px : null;
}

// Ручка «+» ставит метку выбранного типа: выбрана «Р» — рядом с выключателем
// встаёт розетка со своим номером, как в настоящем подрозетнике. Активного типа
// нет (режим выделения) — модель берёт тип соседней метки.
// Поворот подписи на 90° и обратно. Угол — свойство метки: он уезжает в файл
// проекта, отменяется по Ctrl+Z и одинаково виден на экране, в PNG и в печати.
// У блока подпись одна на всех, и угол ей держит первая метка — там же, где
// лежит смещение.
function canvasRotateLabel(markId) {
  const state = canvasState();
  const scheme = canvasScheme(state);
  const target = labelTargetOf(state.project, scheme, markId, state.filter);
  if (!target) return;
  const holder = target.markIds ? target.markIds[0] : markId;
  const angle = labelAngleOf(state.project, target) === 90 ? 0 : 90;
  try {
    const after = updateMark(state.project, holder, { labelAngle: angle }).project;
    canvasCommit(state.project, after, strings.history.rotateLabel, { selection: [markId] });
  } catch (error) {
    canvasFail(error);
  }
}

// Поводок подписи: показывать его или нет. Перебивка — свойство метки, как и
// угол подписи: она уезжает в файл проекта, отменяется по Ctrl+Z и одинаково
// видна на экране, в PNG и в печати. Общей настройкой вида её делать нельзя
// именно поэтому — поводок часть чертежа, а не оснастка рабочего места.
//
// Записывается всегда явное «да» или «нет», а не «как решит раскладка»:
// пользователь нажал кнопку, глядя на подпись, и ответ должен остаться таким,
// каким он его увидел, даже если подпись потом переедет.
function canvasToggleLabelLeader(markId) {
  const state = canvasState();
  const scheme = canvasScheme(state);
  const target = labelTargetOf(state.project, scheme, markId, state.filter);
  if (!target) return;
  // У комментария эта кнопка включает **указатель**: поводок у плашки не
  // отдельная настройка, а он и есть («соединительная линия… чтобы была
  // всегда»). Кнопка одна и стоит на том же месте — у самой плашки, где на
  // неё и смотрят; ручки поворота у комментария нет, и место первой ручки
  // занимает она (`labelLeaderHandle` в render.js).
  if (markIsComment(target)) {
    try {
      const after = setMarkPointer(state.project, markId, !markPointer(target)).project;
      canvasCommit(state.project, after, strings.history.commentPointer, { selection: [markId] });
    } catch (error) {
      canvasFail(error);
    }
    return;
  }
  const holder = labelLeaderHolder(target);
  const shown = labelLeaderShown(
    state.project,
    target,
    labelBox(state.project, scheme, target, canvasViewOf(state), state.filter),
  );
  try {
    const after = updateMark(state.project, holder, { labelLeader: !shown }).project;
    canvasCommit(state.project, after, strings.history.labelLeader, { selection: [markId] });
  } catch (error) {
    canvasFail(error);
  }
}

/**
 * Правка текста комментария — одним окном, прямо с плана.
 *
 * Комментариев нет в списке меток (G167), и это главный вопрос, который
 * создаёт их природа: откуда править текст. Ответ — там же, где плашка:
 * двойной клик по ней и кнопка в карточке выделенной метки открывают это
 * окно. Поле одно и то же — `original`, то самое «Комментарий» из таска 117,
 * и второй правды о тексте в сборке нет.
 *
 * Пустой ответ — это ответ (`allowEmpty`): очистить плашку человек имеет
 * право, и удалять ради этого всю метку он не обязан. О пустой плашке скажет
 * панель предупреждений.
 */
export async function canvasEditCommentText(markId) {
  const before = canvasState();
  const mark = before.project ? findMark(before.project, markId) : null;
  if (!markIsComment(mark)) return;
  const raw = await uiPrompt({
    title: strings.canvas.commentTextTitle,
    value: markCommentText(mark),
    placeholder: strings.marks.comment,
    submitLabel: strings.dialog.save,
    allowEmpty: true,
  });
  if (raw === null) return;
  // Окно живёт дольше кадра: за это время метку могли удалить чужим Ctrl+Z
  // или уйти на другой объект. Правим по свежему снимку, а если метки больше
  // нет — молчим: писать некуда.
  const state = canvasState();
  const current = state.project ? findMark(state.project, markId) : null;
  if (!markIsComment(current)) return;
  if (markCommentText(current) === raw.trim()) return;
  try {
    const after = updateMark(state.project, markId, { original: raw.trim() }).project;
    canvasCommit(state.project, after, strings.history.commentText, { selection: [markId] });
  } catch (error) {
    canvasFail(error);
  }
}

// Поворот подписи комнаты — тот же механизм, что у метки: угол лежит в данных
// контура, уезжает в файл проекта, отменяется по Ctrl+Z и одинаково виден на
// экране, в PNG и в печати.
function canvasRotateOutlineLabel(outlineId) {
  const state = canvasState();
  const outline = findOutline(state.project, outlineId);
  if (!outline) return;
  const angle = outline.labelAngle === 90 ? 0 : 90;
  try {
    const after = updateOutline(state.project, outlineId, { labelAngle: angle }).project;
    canvasCommit(state.project, after, strings.history.rotateOutlineLabel, {
      patch: { selectedOutlineId: outlineId },
    });
  } catch (error) {
    canvasFail(error);
  }
}

// Подпись, оттащенную руками, автоматика не двигает никогда — вернуть её на
// место может только рука. Двойной клик по подписи и возвращает: смещения
// больше нет, подпись встаёт туда, где стояла бы сама.
function canvasResetLabel(point) {
  const state = canvasState();
  if (!canvasEditAllowed(state)) return false;
  const scheme = canvasScheme(state);
  const view = canvasViewOf(state);
  const hit = hitTest(state.project, scheme, point, view, state.filter);
  if (hit && hit.part === "label") {
    const group = hit.groupId ? findGroup(state.project, hit.groupId) : null;
    const holder = group ? group.markIds[0] : hit.markId;
    const mark = findMark(state.project, holder);
    if (!mark || !mark.labelOffset) return false;
    try {
      const after = updateMark(state.project, holder, { labelOffset: null }).project;
      canvasCommit(state.project, after, strings.history.resetLabel, { selection: [hit.markId] });
    } catch (error) {
      canvasFail(error);
    }
    return true;
  }
  if (hit) return false;
  // Контур ловится только в выделении — там же, где его подпись и таскают:
  // в добавлении клик по плану ставит метку, и отбирать у него двойной клик
  // нельзя.
  if (state.mode !== "select") return false;
  const outlineHit = hitOutline(state.project, scheme, point, view, state.filter, state.selectedOutlineId || null);
  if (!outlineHit || outlineHit.part !== "label") return false;
  const outline = findOutline(state.project, outlineHit.outlineId);
  if (!outline || !outline.labelOffset) return false;
  try {
    const after = updateOutline(state.project, outlineHit.outlineId, { labelOffset: null }).project;
    canvasCommit(state.project, after, strings.history.resetLabel, {
      patch: { selectedOutlineId: outlineHit.outlineId },
    });
  } catch (error) {
    canvasFail(error);
  }
  return true;
}

// Путь в правке: ломаная метки или контур помещения — у того, чей
// идентификатор лежит в `editPathId`, видны ручки вершин. Жест один на оба
// объекта (заказчик: «двойной клик по контуру комнаты — тоже давай править
// его»), поэтому и место в состоянии одно. Правка живёт в состоянии сеанса, а
// не в объекте: это режим руки, а не свойство разметки, и в файле проекта ему
// делать нечего.
//
// Разница между ними — только в пределе: линия живёт от двух вершин, контур от
// трёх. Всё остальное считает один и тот же код.
// Линейка и направляющие видны, пока пользователь их не спрятал. Отметка живёт
// в настройках браузера, а не в объекте: это оснастка рабочего места, и в файл
// проекта ей не за чем — зато переживает перезагрузку.
function canvasGuidesShown(state) {
  return !state || state.guidesShown !== false;
}

function canvasBox() {
  return canvasNode
    ? { width: Math.max(1, canvasNode.clientWidth), height: Math.max(1, canvasNode.clientHeight) }
    : { width: 1, height: 1 };
}

/**
 * Сетка чертежа на плане (таск 193, G293). Слова заказчика: «Сделай что бы
 * сетка была и на схеме».
 *
 * Шаг — у объекта (`gridStepOf`, G258), и он **тот же**, что в чертеже: это
 * вторая причина, по которой сетку сделали общей, а не спрятали из «Интерфейса»
 * в режиме плана. «Без сетки» — пункт в списке шагов, а живёт он в настройках
 * браузера (`GRID_SETTING`), как и прочие слои показа: в объект от этого не
 * пишется ничего (G68).
 *
 * `null` — сетки нет: либо «Без сетки», либо у плана нет моста в миллиметры
 * (нет калибровки или привязки) — тогда и рисовать нечего, миллиметра на таком
 * плане не существует.
 */
function canvasGridLayer(state, project) {
  if (!state || state.gridShown === false) return null;
  const step = gridStepOf(project);
  return step > 0 ? { stepMm: step, box: canvasBox() } : null;
}

// Полоса линейки: клик по ней вытягивает новую направляющую, а не идёт в план.
function canvasOnRuler(point) {
  return rulerAxis(point) !== null;
}

// Доля плана, в которую сядет направляющая, вытянутая из-под этой точки.
function canvasGuideAt(axis, point, scheme, view) {
  return guideFraction(axis, axis === "h" ? point.y : point.x, scheme, view);
}

/**
 * Направляющие, которые холст отдаёт кадру.
 *
 * **Берутся оттуда же, откуда метки: из промежуточного объекта, пока идёт
 * перенос, и из состояния, когда переноса нет.** Отсюда дефект, который здесь
 * и чинится: пока направляющая читалась прямо из `state.project`, она во время
 * переноса рисовалась на старом месте — толстела под рукой, но за курсором не
 * ехала, а по отпусканию прыгала туда, где он был. Третьего пути у переноса
 * нет и не должно быть: у меток он один, и у направляющих тот же.
 *
 * Чистая и вынесенная наружу нарочно: промежуточное положение обязано быть
 * видно в том, что уходит в кадр, а не только в итоговом объекте, — и это
 * проверяется тестом без глаз.
 */
export function canvasFrameGuides(state, preview, scheme) {
  if (!canvasGuidesShown(state) || !scheme) return [];
  const project = preview || (state && state.project);
  return schemeGuides(project, scheme.id);
}

function canvasSchemeGuides(state, scheme) {
  return canvasFrameGuides(state, canvasPreview, scheme);
}

// Общий показ связей: отметка в шапке. Умолчание — «нет». Это не значит, что
// связей не видно вовсе: выключенный переключатель оставляет связи выделенной
// метки (см. `canvasFrameLinks`).
//
// Раскладку спрашиваем вместе с отметкой (таск 163, G242): кнопки связей на
// узком экране больше нет, а отметка живёт в настройках браузера и переживает
// поворот планшета. Без этого вопроса человек, включивший связи в альбомной
// ориентации, получал бы в книжной паутину поверх плана и ни одной кнопки,
// которой её снять. Сама отметка при этом цела — повернул обратно, и связи на
// месте.
function canvasLinksShown(state) {
  return Boolean(state && state.linksShown === true && layoutAllows("markLinks", state.layout));
}

/**
 * Связи, которые холст отдаёт кадру.
 *
 * **Берутся оттуда же, откуда метки: из промежуточного объекта, пока идёт
 * перенос, и из состояния, когда переноса нет.** Ровно то же правило, что у
 * `canvasFrameGuides`, и ровно по той же причине: у направляющих однажды завёлся
 * свой, укороченный путь до кадра — они рисовались из `state.project` и во
 * время переноса стояли на старом месте, а прыгали только по отпусканию. Связь
 * держится за метку обоими концами, и читай она объект из состояния — дуга
 * отставала бы от метки, которую в этот миг ведут мышью.
 *
 * **Режима два, и они не спорят** (слова заказчика: «если связи не включены, то
 * при выделении метки да, пусть показываются её связи, это удобно будет»):
 *
 * - переключатель **включён** — все связи схемы;
 * - переключатель **выключен** — **вся связная группа** выделенной метки:
 *   транзитивное замыкание по всем трём родам (`model.linkedMarkIds`), а не
 *   только её соседи. Выделили выключатель — поднялись и второй переключатель,
 *   и цепь между ними, и вся группа светильников, которой они управляют.
 *   Ничего не выделено — не рисуется ничего.
 *
 * В этом режиме у каждой связи стоит `near`: касается ли она **самой**
 * выделенной метки. Всё остальное в поднятой группе рисуется вполсилы — иначе
 * человек выделил одну метку, увидел двенадцать и не понял, с чего началось.
 *
 * Отсюда же ответ на «три рода под одной кнопкой или у каждого своя»: кнопка
 * одна. Три кнопки в шапке — приборная панель, а частями паутина выключается
 * жестом, который у пользователя уже есть: выделил метку — видишь её разбор и
 * ничего больше.
 *
 * Рисуются они **одинаково**: тот же цвет, та же толщина, тот же прогиб. Вид
 * не должен прыгать на переключении — иначе одна и та же дуга у одной и той же
 * метки читалась бы как две разные вещи. Прогиб считает `markLinks` по всем
 * связям схемы разом, поэтому в узком режиме дуга лежит ровно там же, где
 * лежала в общем. Заметность выделенному даётся **порядком**: его связи
 * рисуются последними и ложатся поверх остальных.
 *
 * Чистая и вынесенная наружу нарочно: промежуточный кадр обязан проверяться
 * тестом, а не глазами.
 */
export function canvasFrameLinks(state, preview, scheme) {
  const empty = { lines: [], ties: [], groups: [], offScheme: [] };
  if (!scheme) return empty;
  const selected = (state && state.selectedMarkIds) || [];
  const all = canvasLinksShown(state);
  if (!all && selected.length === 0) return empty;
  const project = preview || (state && state.project);
  const links = markLinks(project, scheme, state && state.filter);
  const picked = new Set(selected);
  const touches = (item, set) => set.has(item.fromId) || set.has(item.toId);
  if (!all) {
    // Поднимается **вся связная группа**, а не соседи выделенной метки: от неё
    // идём по всем трём родам отношений до конца цепочки. Слова заказчика:
    // «если хоть 1 элемент из цепочки выделен».
    const cluster = new Set();
    for (const id of selected) for (const linked of linkedMarkIds(project, id)) cluster.add(linked);
    if (cluster.size === 0) return empty;
    // `near` отвечает на «с чего началось»: связи самой выделенной метки идут в
    // полную силу, остальная поднятая цепочка — вполсилы.
    const mark = (item, near) => ({ ...item, near });
    return {
      lines: links.lines.filter((line) => touches(line, cluster)).map((line) => mark(line, touches(line, picked))),
      ties: links.ties.filter((tie) => touches(tie, cluster)).map((tie) => mark(tie, touches(tie, picked))),
      // Оболочка показывается целиком или не показывается вовсе: это
      // тождество, и половина группы — неправда.
      groups: links.groups
        .filter((group) => group.markIds.some((id) => cluster.has(id)))
        .map((group) => mark(group, group.markIds.some((id) => picked.has(id)))),
      offScheme: links.offScheme
        .filter((item) => cluster.has(item.markId))
        .map((item) => ({ ...item, near: picked.has(item.markId) })),
    };
  }
  const mine = (item) => touches(item, picked);
  return {
    lines: [...links.lines.filter((line) => !mine(line)), ...links.lines.filter(mine)],
    ties: [...links.ties.filter((tie) => !mine(tie)), ...links.ties.filter(mine)],
    groups: links.groups,
    offScheme: links.offScheme,
  };
}

// Притяжка к своим направляющим — одной дверью для всех рук: постановка точки,
// перенос метки, перенос линии. Рисование и правка вершины идут через
// `draftSnap`, который зовёт ту же функцию первой.
function canvasGuideSnap(plan, free) {
  const state = canvasState();
  const scheme = canvasScheme(state);
  if (!scheme) return plan;
  const guides = canvasSchemeGuides(state, scheme);
  if (guides.length === 0) return plan;
  return snapToSchemeGuides(guides, plan, scheme, canvasViewOf(state), { free: Boolean(free) }).point;
}

// Вершина метки, ближайшая к точке клика: за неё и считается притяжка при
// переносе. У точечной метки она одна, у ломаной — та, что под рукой.
function canvasNearestVertex(mark, point, scheme, view) {
  const points = (mark && mark.points) || [];
  let best = 0;
  let gap = Infinity;
  points.forEach((item, index) => {
    const at = planToScreen(item, scheme, view);
    const distance = Math.hypot(at.x - point.x, at.y - point.y);
    if (distance < gap) {
      gap = distance;
      best = index;
    }
  });
  return best;
}

function canvasEditedPath(state, scheme) {
  if (!state || !state.editPathId || !scheme || !state.project) return null;
  const mark = findMark(state.project, state.editPathId);
  if (mark) {
    if (mark.kind !== "line" || mark.schemeId !== scheme.id) return null;
    // Скрытую фильтром линию не правят: её на плане нет.
    const shown = visibleMarks(state.project, scheme, state.filter).some((item) => item.id === mark.id);
    return shown ? { kind: "mark", id: mark.id, points: mark.points, closed: Boolean(mark.closed) } : null;
  }
  const outline = findOutline(state.project, state.editPathId);
  if (!outline || outline.schemeId !== scheme.id) return null;
  const shown = visibleOutlines(state.project, scheme, state.filter).some((item) => item.id === outline.id);
  // Контур замкнут всегда: комната с открытой стенкой — не комната.
  return shown ? { kind: "outline", id: outline.id, points: outline.points, closed: true } : null;
}

// Куда сядет вершина, которую ведут мышью. Правка ничем не отличается от
// рисования: тот же магнит направления и те же направляющие по вершинам этой
// же ломаной. Опора — вершина, от которой считается угол; её `draftSnap` берёт
// последней в списке. Из источников она и правимая вершина исключены: угол
// меряется от опоры, а сама с собой вершина не выравнивается.
function canvasPathSnap(path, anchorIndex, skipIndex, target, free) {
  const state = canvasState();
  const scheme = canvasScheme(state);
  const points = path.points || [];
  if (points.length < 2) return { point: target, guides: [] };
  const anchor = points[anchorIndex] || points[0];
  const sources = points.filter((item, at) => at !== skipIndex && at !== anchorIndex);
  const snap = draftSnap([...sources, anchor], target, scheme, canvasViewOf(state), {
    free: Boolean(free),
    planGuides: canvasSchemeGuides(state, scheme),
  });
  return { point: snap.point, guides: snap.guides || [] };
}

// Опора у правимой вершины — соседняя: `index - 1`, у замкнутой линии для
// первой — последняя.
function canvasVertexSnap(path, index, target, free) {
  const points = path.points || [];
  const anchor = index > 0 ? index - 1 : path.closed ? points.length - 1 : 1;
  return canvasPathSnap(path, anchor, index, target, free);
}

// Опора у новой вершины — та, от которой она растёт: у разбивки начало
// отрезка, у продолжения сам конец линии. Обе лежат в `drag.index`.
function canvasAddSnap(drag, target, free) {
  return canvasPathSnap(drag.path, drag.index, -1, target, free);
}

// Вход в правку — один жест на оба объекта. Выделение при этом встаёт то же,
// что от обычного клика: у линии — метка, у контура — помещение.
function canvasEditPath(kind, id) {
  if (kind === "outline") {
    canvasApi.setState({ selectedOutlineId: id, selectedMarkIds: [], editPathId: id });
    canvasApi.notify(strings.canvas.outlineEditOn);
    return;
  }
  canvasApi.setState({ selectedMarkIds: [id], selectedOutlineId: null, editPathId: id });
  canvasApi.notify(strings.canvas.lineEditOn);
}

// Вершина правимого пути: у метки и у контура свои функции модели, но правило
// одно, и холст выбирает между ними в одном месте.
function canvasPathVertexMove(path, before, index, point) {
  return path.kind === "outline"
    ? moveOutlinePoint(before, path.id, index, point).project
    : moveMarkPoint(before, path.id, index, point).project;
}

function canvasPathVertexInsert(path, index, plan) {
  if (path.kind === "outline") {
    canvasOutlineInsert(path.id, index, plan);
    return;
  }
  canvasInsertMarkPoint(path.id, index, plan);
}

function canvasPathVertexRemove(path, index) {
  if (path.kind === "outline") {
    canvasOutlineRemovePoint(path.id, index);
    return;
  }
  canvasRemoveMarkPoint(path.id, index);
}

/**
 * Новая вершина от ручки: разбивка отрезка и продолжение линии — одна рука.
 *
 * Разница между ними одна: куда вершина встаёт. Разбивка ставит её внутрь, за
 * `index`-й вершиной, продолжение — за концом, и для начала линии это отдельная
 * функция модели (`extendMarkLine`), а не вставка «после индекса»: вставкой
 * продолжить линию с головы можно было бы только перевернув её, а порядок
 * вершин значащий — по первому сегменту уходит подпись, за первую вершину
 * держится стрелка связи.
 */
function canvasPathAdded(drag, plan) {
  const path = drag.path;
  if (drag.end) return extendMarkLine(drag.before, path.id, drag.end, plan).project;
  return path.kind === "outline"
    ? insertOutlinePoint(drag.before, path.id, drag.index, plan).project
    : insertMarkPoint(drag.before, path.id, drag.index, plan).project;
}

// Где окажется поставленная вершина: разбивка садится сразу за своим отрезком,
// продолжение — в голову или в хвост списка.
function canvasAddedIndex(drag) {
  if (drag.end === "start") return 0;
  if (drag.end === "end") return (drag.path.points || []).length;
  return drag.index + 1;
}

// Нажали ручку или дотащили её — вершина ставится одним шагом истории на весь
// жест: одна отмена возвращает и постановку, и место, куда её довели.
function canvasPathAddCommit(drag, plan) {
  const path = drag.path;
  try {
    const after = canvasPathAdded(drag, plan);
    const label = drag.end
      ? strings.history.markLineExtend
      : path.kind === "outline"
        ? strings.history.outlineVertexAdd
        : strings.history.markVertexAdd;
    canvasCommit(drag.before, after, label, {
      ...(path.kind === "outline" ? { patch: { selectedOutlineId: path.id } } : { selection: [path.id] }),
    });
    // Двойной клик по ручке — жест человеческий: первый клик ставит вершину,
    // второй попадает уже по ней, и без этой отметки он бы её и убрал.
    canvasFreshVertex = { id: path.id, index: canvasAddedIndex(drag), at: canvasNow() };
  } catch (error) {
    canvasFail(error);
  }
}

// Вершина, поставленная только что этой же рукой: двойной клик по ней ничего
// не убирает.
function canvasVertexIsFresh(pathId, index) {
  if (!canvasFreshVertex || canvasFreshVertex.id !== pathId) return false;
  if (canvasFreshVertex.index !== index) return false;
  return canvasNow() - canvasFreshVertex.at < CANVAS_FRESH_VERTEX_MS;
}

function canvasInsertMarkPoint(markId, index, plan) {
  const state = canvasState();
  try {
    const result = insertMarkPoint(state.project, markId, index, plan);
    canvasCommit(state.project, result.project, strings.history.markVertexAdd, { selection: [markId] });
  } catch (error) {
    canvasFail(error);
  }
}

function canvasRemoveMarkPoint(markId, index) {
  const state = canvasState();
  try {
    const result = removeMarkPoint(state.project, markId, index);
    canvasCommit(state.project, result.project, strings.history.markVertexRemove, { selection: [markId] });
  } catch (error) {
    canvasFail(error);
  }
}

// Направляющую ставят, двигают и убирают — три шага истории, как у всего
// остального на холсте.
function canvasGuideAdd(axis, at) {
  const state = canvasState();
  try {
    const result = addSchemeGuide(state.project, state.schemeId, { axis, at });
    canvasCommit(state.project, result.project, strings.history.guideAdd);
  } catch (error) {
    canvasFail(error);
  }
}

function canvasGuideRemove(guideId) {
  const state = canvasState();
  try {
    const result = deleteSchemeGuide(state.project, state.schemeId, guideId);
    canvasCommit(state.project, result.project, strings.history.guideRemove);
  } catch (error) {
    canvasFail(error);
  }
}

function canvasBlockPoint(markId, side) {
  const state = canvasState();
  try {
    const result = addToGroup(state.project, markId, side, {
      step: canvasBlockStep(state),
      typeId: canvasPlacedTypeId(state),
      fromPx: canvasStackShift(state, canvasScheme(state), markId),
    });
    canvasCommit(state.project, result.project, strings.history.addBlock, { selection: [result.mark.id] });
  } catch (error) {
    canvasFail(error);
  }
}

// Магнит направления и направляющие. Пока тянется следующая вершина, направление
// от предыдущей липнет к ровным углам (шаг 15°) — стены в квартире прямые,
// и целиться от руки инженеру больше не нужно; а сам курсор ловят вершины,
// которые в этой же ломаной уже стоят: ровно под прежней вершиной через неё
// видна пунктирная направляющая. Зажатый Alt рисует свободно: косые стены и
// эркеры бывают, и выходить ради них из рисования нельзя.

/**
 * Куда сядет вершина черновика — одной дверью на первую и на все следующие.
 *
 * Магнита угла у первой вершины и правда нет: тянуть её не от чего. Но
 * направляющие пользователя к этому отношения не имеют — они нарисованы на
 * плане до всякого черновика, и главный его приём начинается как раз с первой
 * вершины: «6 вертикальных, 2 горизонтальных и на перекрестия ставишь точки».
 * Пока пустой черновик выходил раньше, чем дело доходило до `draftSnap`,
 * первая вершина садилась под сырой курсор — промах до порога перекрестия
 * (13 px), и увидеть его было нечем: предпросмотра до первого клика нет.
 *
 * Разбирается всё это в `draftSnap`: без предыдущей вершины он применяет
 * только направляющие и возвращает точку без угла. Чистая и вынесена наружу
 * нарочно — что первая вершина идёт той же дверью, проверяется тестом.
 */
export function canvasDraftPoint(draft, cursor, scheme, view, options) {
  const points = draft && Array.isArray(draft.points) ? draft.points : [];
  return draftSnap(points, cursor, scheme, view, options);
}

// Вершины черновика в экранных точках: общий разбор жеста (`gestureDraftClick`,
// `gestureDraftEnd`) меряет попадание в вершину глазом, а не долями плана.
function canvasDraftScreen(points, scheme, view) {
  return (points || []).map((point) => planToScreen(point, scheme, view));
}

// Порог попадания в концевую вершину черновика: кружок вершины нарисован в
// размер метки и растёт с масштабом, поэтому и порог считается от него.
function canvasDraftEndPx(view, slack = 0) {
  return markRadius(view) + CANVAS_DRAFT_END_PAD_PX + slack;
}

function canvasDraftSnap(plan, free) {
  const state = canvasState();
  const scheme = canvasScheme(state);
  return canvasDraftPoint(canvasDraft, plan, scheme, canvasViewOf(state), {
    free: Boolean(free),
    planGuides: canvasSchemeGuides(state, scheme),
  });
}

function canvasCancelDraft() {
  if (!canvasDraft) return false;
  canvasDraft = null;
  canvasRedraw();
  return true;
}

function canvasLineClick(plan, screen, free) {
  const state = canvasState();
  if (!state.activeTypeId) {
    canvasApi.notify(strings.canvas.needType);
    return;
  }
  canvasDraftClick(plan, screen, free);
}

// Контур помещения рисуется той же рукой, что и ломаная: клик — вершина,
// двойной клик по первой замыкает, Backspace убирает последнюю, Esc отменяет.
// Отличается только то, чем это заканчивается: замкнутым многоугольником
// помещения, а не линией-меткой.
function canvasOutlineClick(plan, screen, free) {
  const state = canvasState();
  if (!state.activeRoomId || !findRoom(state.project, state.activeRoomId)) {
    canvasApi.notify(strings.canvas.needRoom);
    return;
  }
  canvasDraftClick(plan, screen, free);
}

/**
 * Клик в режиме «по чертежу»: контур ищется по стенам и сразу кладётся
 * помещению. Один клик — один контур, черновика здесь нет вовсе.
 *
 * Дальше всё как у обведённого рукой: режим возвращается в «Выделение», контур
 * выделен, вершины под рукой. Отмена — тот же Ctrl+Z, потому что запись идёт
 * через `canvasCommit`, второй дороги к объекту нет.
 */
function canvasRoomTraceClick(plan) {
  const state = canvasState();
  if (!state.activeRoomId || !findRoom(state.project, state.activeRoomId)) {
    canvasApi.notify(strings.canvas.needRoom);
    return;
  }
  const found = roomTraceAt(state.project, state.schemeId, plan);
  if (!found.ok) {
    canvasApi.notify(canvasRoomTraceSaid(state.project, found), "error");
    return;
  }
  try {
    const made = addOutline(state.project, {
      schemeId: state.schemeId,
      roomId: state.activeRoomId,
      points: found.points,
    });
    canvasCommit(state.project, made.project, strings.history.addOutlineTraced, {
      selection: [],
      patch: { mode: "select", selectedOutlineId: made.outline.id },
    });
    // Площадь вслух: по ней сразу видно, попала ли заливка в комнату или
    // ушла через дверь в коридор. Числа у этой кнопки — единственная проверка,
    // которую человек может сделать не глядя на план.
    canvasApi.notify(
      text("roomTrace.found", {
        area: formatMeters(found.areaMm2 / 1e6),
        count: found.points.length,
      }),
    );
  } catch (error) {
    canvasFail(error);
  }
}

function canvasDraftClick(plan, screen, free) {
  const state = canvasState();
  if (!canvasDraft) {
    // Первая вершина садится на направляющие пользователя так же, как все
    // следующие: перекрестия он ставил именно под неё. Ломаная и контур
    // помещения начинаются здесь оба — значит и притяжка у них одна.
    const start = canvasDraftSnap(plan, free);
    // Черновик помнит, чем его начали: ломаной линейного типа или контуром
    // помещения. По этой памяти его и заканчивают, когда режим или вид типа
    // сменились на ходу, — тип берётся тот, которым рисовали, а не тот,
    // который выбран сейчас.
    canvasDraft = {
      kind: state.mode === "room" ? "room" : "line",
      typeId: state.mode === "room" ? null : state.activeTypeId,
      projectId: state.project ? state.project.id : null,
      points: [start.point],
      cursor: start.point,
      snapped: false,
      guides: [],
    };
    canvasRedraw();
    return;
  }
  // Вершина встаёт ровно туда, где её показывал черновик: и предпросмотр, и
  // клик считают магнит одной функцией, разойтись им негде.
  const snap = canvasDraftSnap(plan, free);
  const scheme = canvasScheme(state);
  const view = canvasViewOf(state);
  const points = canvasDraft.points;
  // Клик по последней или первой вершине ничего не добавляет: это первая
  // половина двойного клика, который завершает или замыкает линию. Разбор общий
  // (`gestureDraftClick`, таск 167) — тем же живёт контур вещи в чертеже.
  const kind = gestureDraftClick(canvasDraftScreen(points, scheme, view), screen, canvasDraftEndPx(view));
  if (kind !== "add") return;
  points.push(snap.point);
  canvasDraft.cursor = snap.point;
  canvasDraft.snapped = false;
  // Вершина поставлена — подсказки гаснут до следующего движения руки: висеть
  // им не над чем, курсор стоит ровно на только что поставленной точке.
  canvasDraft.guides = [];
  canvasRedraw();
}

// ——— калибровка масштаба ——————————————————————————————————————————————
//
// Два клика по плану и один вопрос. Отрезок — тот же черновик, которым
// рисуется ломаная (и та же притяжка к направляющим и ровным углам: калибруют
// по стене, а стена ровная), только кончается он не меткой, а масштабом схемы.

/**
 * Расстояние, набранное руками, числом в метрах — или `null`, если это не
 * число. Запятая и точка равноправны: в чертёжной привычке «4,2», на
 * клавиатуре нампада — «4.2», и спорить с рукой здесь незачем. Пробелы внутри
 * («4 200»… нет, в метрах таких не бывает) просто убираются.
 *
 * Чистая и вынесена наружу ради теста: разбор ввода — то место, где молчаливая
 * ошибка превращается в неверный масштаб по всему плану.
 */
export function canvasScaleMeters(raw) {
  const clean = String(raw == null ? "" : raw)
    .replace(/\s/g, "")
    .replace(",", ".");
  if (clean === "") return null;
  if (!/^\d*\.?\d+$/.test(clean)) return null;
  const value = Number(clean);
  if (!Number.isFinite(value) || !(value > 0) || value > PLAN_SCALE_METERS_MAX) return null;
  return value;
}

// Первый клик ставит начало отрезка, второй — конец и открывает вопрос.
function canvasScaleClick(plan, screen, free) {
  const state = canvasState();
  const scheme = canvasScheme(state);
  if (!scheme) return;
  const snap = canvasDraftSnap(plan, free);
  if (!canvasDraft || canvasDraft.kind !== "scale") {
    canvasDraft = {
      kind: "scale",
      typeId: null,
      projectId: state.project ? state.project.id : null,
      // Схему черновик помнит сам: масштаб принадлежит ей, и дожидаться ответа
      // в диалоге он обязан на той же схеме, на которой начинался.
      schemeId: state.schemeId,
      points: [snap.point],
      cursor: snap.point,
      snapped: false,
      guides: [],
    };
    canvasRedraw();
    return;
  }
  const view = canvasViewOf(state);
  const first = planToScreen(canvasDraft.points[0], scheme, view);
  // Второй клик в ту же точку — промах, а не отрезок: калибровать по нулю
  // нельзя, и отказывать на это ошибкой было бы грубо.
  if (Math.hypot(screen.x - first.x, screen.y - first.y) <= markRadius(view) + 6) return;
  canvasDraft.points[1] = snap.point;
  canvasDraft.cursor = snap.point;
  canvasDraft.guides = [];
  canvasRedraw();
  canvasScaleAsk();
}

// Вопрос о расстоянии. Короткий отрезок не проходит молча: сперва
// предупреждение, и только потом цифра.
async function canvasScaleAsk() {
  const draft = canvasDraft;
  if (!draft || draft.kind !== "scale" || draft.points.length < 2) return;
  const [a, b] = draft.points;
  if (planScaleShort(canvasState().project, draft.schemeId, { a, b })) {
    const go = await uiConfirm({
      title: strings.scale.shortTitle,
      message: text("scale.shortAsk", { share: Math.round(PLAN_SCALE_SHORT_SHARE * 100) }),
      confirmLabel: strings.scale.shortAnyway,
    });
    // Диалог живёт дольше черновика: за это время могли сменить схему или
    // объект, и тогда отрезок уже ничей.
    if (canvasDraft !== draft) return;
    if (!go) {
      canvasCancelDraft();
      canvasApi.notify(strings.scale.cancelled);
      return;
    }
  }
  let typed = "";
  for (;;) {
    const raw = await uiPrompt({
      title: strings.scale.askTitle,
      value: typed,
      placeholder: strings.scale.askPlaceholder,
      submitLabel: strings.scale.askSubmit,
    });
    if (canvasDraft !== draft) return;
    if (raw === null) {
      canvasCancelDraft();
      canvasApi.notify(strings.scale.cancelled);
      return;
    }
    typed = raw;
    const meters = canvasScaleMeters(raw);
    // Опечатку не проглатываем и работу не теряем: отрезок на месте, вопрос
    // задаётся снова с тем, что было набрано.
    if (meters === null) {
      canvasApi.notify(strings.scale.badMeters, "error");
      continue;
    }
    canvasScaleCommit(draft, meters);
    return;
  }
}

async function canvasScaleCommit(draft, meters) {
  const state = canvasState();
  const [a, b] = draft.points;
  if (!findScheme(state.project, draft.schemeId)) {
    canvasCancelDraft();
    return;
  }
  try {
    const result = setPlanScale(state.project, draft.schemeId, { a, b, meters });
    canvasDraft = null;
    // Через ту же дверь, что и всё остальное: Ctrl+Z возвращает прежний
    // масштаб (или прежнее «масштаба нет») — а с таска 134 и чертёж, если он
    // пошёл следом. Режим сам уходит в «Выделение»: калибруют один раз, а не
    // серией.
    const done = await canvasCommitScale(state.project, result.project, draft.schemeId, {
      patch: { mode: "select" },
    });
    if (!done.ok) return;
    const size = planSizeMeters(canvasState().project, draft.schemeId);
    canvasApi.notify(
      text("scale.applied", {
        meters: formatMeters(result.scale.meters),
        width: size ? formatMeters(size.width) : "",
        height: size ? formatMeters(size.height) : "",
      }) + canvasScaleFollowSaid(done),
      "success",
    );
  } catch (error) {
    canvasCancelDraft();
    canvasFail(error);
  }
}

/**
 * Что дописать к известию о заданном масштабе: пошёл ли чертёж следом и не
 * торчит ли теперь проём за своей стеной.
 *
 * Про торчащий проём говорится вслух, потому что сделать с ним нечего без
 * вранья: ширину ему задали руками, и менять её пересчёт не вправе, а стена
 * после исправленного масштаба и правда короче этой ширины. Это противоречие
 * человека, а не сборки, и молчать о нём нельзя.
 */
export function canvasScaleFollowSaid(done) {
  if (!done || !done.scaled) return "";
  const said = " " + text("scale.followDone", { count: done.scaled.walls });
  if (!done.scaled.stuck) return said;
  return said + " " + text("scale.followStuck", { count: done.scaled.stuck });
}

// `typeId` передаётся только тогда, когда линию дочерчивают не тем типом, что
// выбран сейчас: черновик закончился, потому что тип на панели сменили.
function canvasLineFinish(closed, typeId) {
  if (!canvasDraft) return null;
  const points = canvasDraft.points;
  const state = canvasState();
  if (points.length < 2) {
    canvasApi.notify(strings.canvas.lineTooShort);
    canvasCancelDraft();
    return null;
  }
  try {
    const result = addMark(state.project, {
      schemeId: state.schemeId,
      typeId: typeId || state.activeTypeId,
      kind: "line",
      points,
    });
    let project = result.project;
    if (closed) project = updateMark(project, result.mark.id, { closed: true }).project;
    canvasDraft = null;
    canvasCommit(state.project, project, strings.history.addLine, { selection: [result.mark.id] });
    canvasSayPinned(result);
    return result.mark.id;
  } catch (error) {
    canvasCancelDraft();
    canvasFail(error);
    return null;
  }
}

// ——— незаконченный черновик при смене того, что рисуем ————————————————
//
// Пользователь ведёт ломаную и посреди неё выбирает точечный тип. Бросить
// начатое молча нельзя: это его работа, а в стеке отмены её нет — черновик
// живёт вне истории, и Ctrl+Z его не вернёт. Поэтому начатое **дочерчивается**
// тем типом, которым рисовали: линия становится обычной меткой, попадает в
// историю одним шагом и отменяется тем же Ctrl+Z, если была лишней. Пропадает
// только черновик из одной вершины — линии в нём нет, сохранять нечего.
//
// Контур помещения так не спасти: комната с открытой стенкой — не комната,
// и незамкнутый контур модель не примет. Его черновик отменяется.
function canvasSettleDraft() {
  if (!canvasDraft) return false;
  const draft = canvasDraft;
  // Начатая калибровка не дочерчивается ничем: отрезок без расстояния в метрах
  // — это не данные, а полдела, и в объекте ему места нет. Уходит он со
  // словами: рука его начинала.
  if (draft.kind === "scale") {
    canvasCancelDraft();
    canvasApi.notify(strings.scale.cancelled);
    return true;
  }
  if (draft.kind !== "line" || draft.points.length < 2) {
    canvasCancelDraft();
    canvasApi.notify(strings.canvas.draftDropped);
    return true;
  }
  // `canvasLineFinish` обнуляет черновик до записи в историю, поэтому вложенная
  // подписка, которую разбудит `canvasCommit`, сюда уже не вернётся.
  const markId = canvasLineFinish(false, draft.typeId);
  if (markId) {
    canvasApi.notify(text("canvas.draftFinished", { label: labelOf(canvasState().project, markId) }), "success");
  }
  return true;
}

// Чем должен быть черновик при нынешнем состоянии: ломаной, контуром,
// отрезком калибровки или ничем. Одно место на весь холст — режим, тип и вид
// типа спрашиваются здесь.
function canvasDraftWanted(state) {
  if (state.mode === CANVAS_MODE_SCALE) return "scale";
  if (state.mode === "room") return "room";
  return canvasAddKind(state) === "line" ? "line" : null;
}

// Черновик приведён в согласие с тем, что рисуем сейчас. Вызывается на каждую
// смену режима, типа и объекта: вид типа меняют и в справочнике, и это тоже
// обязано долететь до руки, которая ведёт линию.
function canvasSyncDraft(state) {
  if (!canvasDraft) return;
  // Объект сменился целиком — черновик остался от прежнего, и дочерчивать его
  // в новый объект нельзя: там ему не место ни схемой, ни типом.
  const projectId = state.project ? state.project.id : null;
  if (canvasDraft.projectId !== projectId) {
    canvasCancelDraft();
    return;
  }
  const wanted = canvasDraftWanted(state);
  if (canvasDraft.kind === wanted) {
    // Линейный тип сменили на другой линейный — рисование продолжается, и
    // линия достанется новому типу: так было и до двух режимов.
    if (wanted === "line") canvasDraft.typeId = state.activeTypeId;
    return;
  }
  canvasSettleDraft();
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
  if (!canvasEditAllowed(state)) return canvasViewOnly();
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
  // Отказ до диалога: спрашивать «удалить метку?» там, где удалить нельзя, —
  // обещание, которого холст не выполнит.
  if (!canvasEditAllowed(state)) return canvasViewOnly();
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
  if (!canvasEditAllowed(canvasState())) return canvasViewOnly();
  if (!canUndo()) {
    canvasApi.notify(strings.canvas.nothingToUndo);
    return;
  }
  const command = undo();
  canvasApi.notify(text("canvas.undone", { label: command.label }));
}

export function canvasRedoStep() {
  if (!canvasEditAllowed(canvasState())) return canvasViewOnly();
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
  const box = { width: canvasNode.clientWidth, height: canvasNode.clientHeight };
  // У схемы без подложки «вписать» значит вписать чертёж: листа под ним никто
  // не видит, и вписывать его было бы вписыванием пустого поля.
  const view = scheme.imageId ? fitView(scheme, box) : canvasFitDrawing(state.project, scheme, box);
  canvasApi.setState({ view });
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

/**
 * Что под пальцем: ручка подписи, ручка пути, ручка блока, метка, контур,
 * направляющая — или пустое место.
 *
 * Ответ снимается **в начале жеста**: по отпусканию план уже мог уехать, и
 * попадание считалось бы по новым координатам.
 *
 * Порядок тот же, что у мыши в `canvasPointerDown`, и это не совпадение: два
 * порядка на один план означали бы, что палец и мышь целятся в разное. Запас
 * попадания пальцу даётся больше (`canvasHitSlack`) — ручки мелкие.
 */
function canvasTouchPick(state, point) {
  const scheme = canvasScheme(state);
  const pick = { markId: null, part: null, groupId: null };
  if (!scheme || !state.project) return pick;
  const view = canvasViewOf(state);
  const slack = canvasHitSlack(true);
  const editable = canvasEditAllowed(state);
  const single = editable && state.selectedMarkIds.length === 1 ? state.selectedMarkIds[0] : null;

  if (single) {
    const target = labelTargetOf(state.project, scheme, single, state.filter);
    if (target && hitLabelTurn(state.project, scheme, target, point, view, state.filter, slack)) {
      pick.labelTurn = true;
      return pick;
    }
    if (target && hitLabelLeader(state.project, scheme, target, point, view, state.filter, slack)) {
      pick.labelLeader = true;
      return pick;
    }
  }

  const edited = editable ? canvasEditedPath(state, scheme) : null;
  if (edited) {
    const handle = hitPathHandle(pathEditHandles(scheme, edited, view), point, slack);
    if (handle) {
      pick.pathHandle = handle;
      pick.path = edited;
      return pick;
    }
  }

  const hit = hitTest(state.project, scheme, point, view, state.filter, slack);
  // Ручка «+» важнее всего, кроме уже стоящей под ней метки, — та же оговорка,
  // что у мыши: ручка висит ровно на шаге блока и накрывает соседа по блоку.
  if (single) {
    const selected = findMark(state.project, single);
    if (selected && selected.kind === "point" && selected.schemeId === scheme.id) {
      const side = hitHandle(scheme, selected, point, view, slack, canvasStacks(state, scheme));
      const neighbour = hit && hit.part === "mark" && hit.markId !== selected.id;
      if (side && !neighbour) {
        pick.blockSide = side;
        return pick;
      }
    }
  }

  if (hit) {
    pick.markId = hit.markId;
    pick.part = hit.part;
    pick.groupId = hit.groupId || null;
    return pick;
  }

  const outlineHit = hitOutline(state.project, scheme, point, view, state.filter, state.selectedOutlineId || null, slack);
  if (outlineHit) {
    pick.outlineId = outlineHit.outlineId;
    pick.outlinePart = outlineHit.part;
    return pick;
  }

  if (editable && canvasGuidesShown(state) && state.mode === "select") {
    const guide = hitSchemeGuide(canvasSchemeGuides(state, scheme), point, scheme, view, slack);
    if (guide) {
      pick.guideId = guide.id;
      pick.guideAxis = guide.axis;
    }
  }
  return pick;
}

// Запас попадания: у пальца больше, чем у мыши. Отдельной функцией — как и
// мерка сдвига: разницу должно быть видно тесту, а не только глазу в коде.
export function canvasHitSlack(touch) {
  return touch ? CANVAS_TOUCH_HIT_PX : 0;
}

/**
 * Что делает одиночный тап пальцем.
 *
 * Главный вопрос таска: в режиме «Добавление» человек тапает, **чтобы
 * поставить метку**, а до сих пор тап только выделял. Разведено тем же
 * правилом, по которому живёт мышь: тап делает то же, что сделал бы клик в
 * этой точке. Клик в добавлении по пустому месту ставит метку, по стоящей
 * метке — выделяет её (иначе до соседа в блоке было бы не дотянуться), в
 * рисовании ломаной и контура — ставит вершину, а ручки (поворот подписи,
 * поводок, «+», разбивка пути) срабатывают раньше всего остального. Второго
 * порядка заводить нельзя: палец и мышь целятся в один план.
 *
 * В просмотре ответ один — `"select"`: правка там запрещена, и тап только
 * выделяет (таск 106).
 */
export function canvasTapKind(state, pick = {}) {
  if (!canvasEditAllowed(state)) return "select";
  // Калибровка забирает тап себе целиком и раньше всех ручек: рука показывает
  // точку отрезка, и ручка выделенной метки под пальцем не должна отбирать
  // жест у масштаба.
  if (state && state.mode === CANVAS_MODE_SCALE) return "scalePoint";
  // Определение по чертежу забирает тап так же и ровно затем же: рука
  // показывает точку внутри комнаты, и ручка метки под пальцем отобрала бы её.
  if (state && state.mode === CANVAS_MODE_ROOM_TRACE) return "roomTrace";
  if (pick.labelTurn) return "labelTurn";
  if (pick.labelLeader) return "labelLeader";
  // Ручка вершины — для переноса, а не для тапа: тапом по ней мышь тоже ничего
  // не делает. Ручки разбивки и продолжения, наоборот, ставят вершину нажатием.
  if (pick.pathHandle) return pick.pathHandle.kind === "vertex" ? "none" : "pathAdd";
  if (pick.blockSide) return "block";
  if (state.mode === "room" || canvasAddKind(state) === "line") return "vertex";
  if (pick.markId) return "select";
  if (canvasPlacesByClick(state)) return "place";
  return "select";
}

/**
 * Что берёт долгое нажатие. `null` — ничего: жест остаётся панорамой.
 *
 * Слова заказчика: «зажали иконку и потом потащили на нужное место». Это же
 * решает главную беду касания: палец не умеет «навести и нажать», а обычное
 * ведение обязано остаться панорамой, иначе план перестанет листаться.
 *
 * В просмотре не берётся ничего — там правка запрещена. Во время рисования
 * ломаной и контура тоже: рука там ставит вершины, и хватать соседнюю метку
 * посреди линии — не то, чего ждут.
 */
export function canvasGrabKind(state, pick = {}) {
  if (!canvasEditAllowed(state)) return null;
  if (state.mode === CANVAS_MODE_SCALE || state.mode === CANVAS_MODE_ROOM_TRACE) return null;
  if (state.mode === "room" || canvasAddKind(state) === "line") return null;
  if (pick.pathHandle) return pick.pathHandle.kind === "vertex" ? "pathVertex" : "pathAdd";
  if (pick.markId) return pick.part === "label" ? "label" : "mark";
  if (pick.outlineId && pick.outlinePart === "label") return "outlineLabel";
  if (pick.guideId) return "guideMove";
  return null;
}

// Двойной тап: два тапа подряд рядом друг с другом. Мышь узнаёт двойной клик
// сама, пальцу браузер о нём не сообщает — считаем здесь.
export function canvasDoubleTap(previous, now) {
  if (!previous || !now) return false;
  if (now.at - previous.at > CANVAS_DOUBLE_TAP_MS) return false;
  return Math.hypot(now.point.x - previous.point.x, now.point.y - previous.point.y) <= CANVAS_DOUBLE_TAP_PX;
}

// Насколько замкнулось кольцо ожидания под пальцем: 0 — только нажали, 1 —
// пора брать.
export function canvasPressProgress(elapsed) {
  if (!(elapsed > 0)) return 0;
  return Math.min(1, elapsed / CANVAS_PRESS_MS);
}

// Мерка «это был тап или перенос»: у пальца своя. Отдельной функцией, чтобы
// разница была видна тесту: мышиные три точки пальцу не годятся.
export function canvasDragSlop(drag) {
  return drag && drag.touch ? CANVAS_TOUCH_SLOP : CANVAS_DRAG_SLOP;
}

/**
 * Что делает отпускание, когда ничего не тащили: выделить метку, снять
 * выделение или ничего.
 *
 * Вынесено из обработчика и проверяется без браузера не ради красоты. Правило
 * жило в `canvasPointerUp` ветками, и одна из них — тап пальцем — стояла
 * **ниже** выхода `if (event.pointerType === "touch") return;`: на планшете до
 * неё не доходило вовсе, и метка не выделялась ни разу (D19). Ветку не видно
 * ни одним тестом, потому что DOM-обработчики здесь не тестируются, — а
 * функция видна.
 *
 * Возвращает патч состояния сеанса или `null` («ничего не делать»). В патче
 * могут быть только поля выделения: выделение — это поле сеанса, как открытая
 * схема или масштаб, и объекта оно не касается. Правка по-прежнему идёт одной
 * дверью `canvasCommit`, и та в просмотре закрыта.
 *
 * - `pan` с `tap` — тап пальцем: пустое место снимает выделение, своя метка
 *   снимает (карточка закрывается), чужая выделяется;
 * - `pan` с `tapSelected` — то же мышью в просмотре: повторный клик по
 *   выделенной метке закрывает карточку;
 * - `empty` — клик мышью по пустому месту;
 * - всё остальное (перенос метки, вершина, черновик, направляющая) — `null`:
 *   этим распоряжается обработчик, и хватать чужой жест эта функция не должна.
 */
export function canvasTapAction(state, drag, options = {}) {
  if (!state || !drag || drag.moved) return null;
  // Жест отобрал браузер или система (`pointercancel`) — пальца на экране уже
  // нет, и считать это тапом нельзя.
  if (options.cancelled) return null;
  const selected = state.selectedMarkIds || [];
  const busy = selected.length > 0 || Boolean(state.selectedOutlineId) || Boolean(state.editPathId);
  const clear = { selectedMarkIds: [], selectedOutlineId: null, editPathId: null };
  if (drag.kind === "pan" && drag.tap) {
    const markId = drag.tap.markId;
    if (!markId) return busy ? clear : null;
    // Повторный тап по выделенной метке снимает выделение — но только в
    // просмотре, где это единственный способ закрыть её карточку. В полной
    // версии выделение — рабочее состояние: за выделенной меткой стоят ручки
    // «+», поворот подписи и поводок, и снимать его тапом по самой метке
    // значило бы отбирать их из-под пальца. Мышь там ведёт себя так же: клик
    // по выделенной метке её не снимает.
    const same = selected.length === 1 && selected[0] === markId;
    if (same && canvasEditAllowed(state)) return null;
    return { selectedMarkIds: same ? [] : [markId], selectedOutlineId: null };
  }
  if (drag.kind === "pan" && drag.tapSelected && selected.length > 0) return { selectedMarkIds: [] };
  if (drag.kind === "empty") {
    // **Стена под меткой, и метка всегда главнее** (таск 129): сюда попадает
    // только клик, который ничего другого не задел. Повторный клик по уже
    // выделенной стене её не снимает — снимает клик мимо всего и крестик на
    // полосе развёртки: выделение стены это открытая развёртка, и закрывать
    // её случайным попаданием в ту же стену было бы обидно.
    const wallId = drag.wallId || null;
    if (wallId) return wallId === state.selectedWallId ? null : { ...clear, selectedWallId: wallId };
    if (busy || state.selectedWallId) return { ...clear, selectedWallId: null };
  }
  return null;
}

/**
 * Клик, который ничего не сделал, — и слова, которых на нём не хватало
 * (таск 217, дефект D66).
 *
 * Разбор дефекта: постановка меток цела, а «метка перестала ставиться» — это
 * режим. Переход между полями «Чертёж · Схема · Объём» сбрасывает занятие на
 * «Выделение» (правило заказчика G296, таск 193: «при переключении… сбрасывай
 * режим на Выделение с Добавления»), выбранный тип при этом остаётся. Человек
 * возвращается из чертежа, видит в плашке свой тип и целится в план — а клик
 * уходит в пустоту: выделять нечего, ставить не велено. Три таких клика подряд
 * и выглядят как сломанная разметка.
 *
 * Поэтому пустой клик говорит, почему он пустой. Условия узкие нарочно:
 *
 *   — жест **ничего не сделал**: `canvasTapAction` вернула `null` (значит, не
 *     сняла выделение, не выбрала стену — там клик по делу и слов не просит);
 *   — он кончился **на пустом месте** (`empty` у мыши, тап мимо меток у
 *     пальца), а не переносом, вершиной или направляющей;
 *   — занятие — «Выделение», поле — план, правка разрешена;
 *   — **тип выбран**: без него правду говорит своя строка «Сначала выберите
 *     тип метки», и второй голос ей не нужен.
 *
 * Чистая и вынесена наружу ради теста: тишина, которую ловят только глазами и
 * только живьём, — ровно то, из-за чего этот таск и завели.
 */
export function canvasSilentPlaceNote(state, drag, tap) {
  if (tap || !state || !drag || drag.moved) return null;
  const empty = drag.kind === "empty" || (drag.kind === "pan" && Boolean(drag.tap) && !drag.tap.markId);
  if (!empty) return null;
  if (state.mode !== "select" || !canvasEditAllowed(state) || !canvasOnScreen(state)) return null;
  if (!state.schemeId || !state.project || !state.activeTypeId) return null;
  const type = findType(state.project, state.activeTypeId);
  if (!type) return null;
  return text("canvas.placeNeedsAdd", { label: type.code + " — " + type.name });
}

// Сказать про пустой клик — один раз на вход в «Выделение». Слова считает
// чистая `canvasSilentPlaceNote`, здесь только память о том, что уже сказано.
function canvasSaySilent(state, drag, tap) {
  if (canvasSilentSaid) return;
  const note = canvasSilentPlaceNote(state, drag, tap);
  if (!note) return;
  canvasSilentSaid = true;
  canvasApi.notify(note);
}

/**
 * Ожидание долгого нажатия. Кольцо под пальцем показывает, сколько осталось
 * держать; без него человек решит, что не сработало, и уберёт палец раньше.
 *
 * Кольцо показывается **только там, где есть что взять**: обещать перенос над
 * пустым планом значило бы врать. Пока ждём, жест остаётся панорамой — сдвиг
 * дальше пальцевой мерки её и подтверждает, а ожидание снимает.
 */
function canvasPressStart(point, pick) {
  canvasPressCancel();
  if (!canvasGrabKind(canvasState(), pick)) return;
  canvasPress = { point, pick, at: canvasNow() };
  const later = typeof setTimeout === "function" ? setTimeout : null;
  if (later) canvasPressTimer = later(canvasPressFire, CANVAS_PRESS_MS);
  canvasRedraw();
}

function canvasPressCancel() {
  if (canvasPressTimer) clearTimeout(canvasPressTimer);
  canvasPressTimer = 0;
  const had = Boolean(canvasPress);
  canvasPress = null;
  if (had) canvasRedraw();
}

// Долгое нажатие дождалось своего: то, что под пальцем, берётся в руку, и
// дальше ведение переносит его, а отпускание ставит.
function canvasPressFire() {
  canvasPressTimer = 0;
  const press = canvasPress;
  canvasPress = null;
  if (!press || !canvasDrag || canvasDrag.moved || canvasDrag.grabbed) return;
  const state = canvasState();
  const scheme = canvasScheme(state);
  if (!scheme) return;
  const drag = canvasGrabDrag(state, scheme, canvasViewOf(state), press.point, press.pick);
  if (!drag) return;
  canvasDrag = { ...drag, start: press.point, touch: true, grabbed: true, moved: false };
  // Взяли — это должно быть видно и слышно рукой: метка выделяется, как при
  // нажатии мышью, и устройство коротко отзывается.
  if (drag.selectId) {
    canvasApi.setState({ selectedMarkIds: [drag.selectId], selectedOutlineId: null });
  }
  canvasBuzz();
  canvasRedraw();
}

// Короткий отклик устройства на «взял». Есть не везде (в Safari на iPad его
// нет вовсе), поэтому он — добавка к кольцу и выделению, а не единственный
// ответ.
function canvasBuzz() {
  if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") return;
  try {
    navigator.vibrate(12);
  } catch (error) {
    /* устройство не умеет — и не надо */
  }
}

/**
 * Жест переноса под то, что взяли долгим нажатием. Собирается ровно так же,
 * как его собирает мышь в `canvasPointerDown`: снимок «до» для отмены, якорная
 * вершина у метки, путь и номер вершины у ручки.
 */
function canvasGrabDrag(state, scheme, view, point, pick) {
  const kind = canvasGrabKind(state, pick);
  if (!kind) return null;
  if (kind === "pathVertex") {
    return { kind, path: pick.path, index: pick.pathHandle.index, before: state.project, guides: [] };
  }
  if (kind === "pathAdd") {
    return {
      kind,
      path: pick.path,
      index: pick.pathHandle.index,
      end: pick.pathHandle.end || null,
      // Точка, где вершина встанет без ведения, — под самой ручкой.
      point: screenToPlan({ x: pick.pathHandle.x, y: pick.pathHandle.y }, scheme, view),
      before: state.project,
      guides: [],
    };
  }
  if (kind === "label") {
    return { kind, markId: pick.markId, groupId: pick.groupId || null, before: state.project, selectId: pick.markId };
  }
  if (kind === "mark") {
    const mark = findMark(state.project, pick.markId);
    if (!mark) return null;
    return {
      kind,
      markId: pick.markId,
      groupId: pick.groupId || null,
      // Точка комментария и пальцу достаётся отдельно от плашки (G199): ручки
      // у них разные, и спор за долгое нажатие разбирает тот же `part`.
      commentPoint: canvasDragsCommentPoint(state.project, pick.markId, pick.part),
      // У пальца Ctrl нет, и взятая долгим нажатием группа едет целиком — то
      // самое умолчание, о котором просил заказчик (G189). Разнять блок можно
      // мышью с Ctrl/Cmd; на планшете метку из блока правят, уводя её ручкой
      // «+» заново, — отдельного жеста для этого не выдумано.
      moving: canvasMoveIds(state.project, pick.markId, pick.groupId || null, false),
      anchor: canvasNearestVertex(mark, point, scheme, view),
      before: state.project,
      selectId: pick.markId,
    };
  }
  if (kind === "outlineLabel") {
    return { kind, outlineId: pick.outlineId, before: state.project };
  }
  if (kind === "guideMove") {
    return { kind, guideId: pick.guideId, axis: pick.guideAxis, before: state.project, guides: [] };
  }
  return null;
}

/**
 * Отпускание пальца, когда ничего не тащили: тап.
 *
 * Что именно делает тап, решает `canvasTapKind` — чистое правило, одно на
 * палец и на мышь. Здесь только исполнение и двойной тап, которого браузер
 * пальцу не присылает.
 */
function canvasTouchUp(state, drag, point, cancelled) {
  canvasTouchAt = canvasNow();
  // Жест отобрала система или им уже взяли метку — тапа не было.
  if (cancelled || drag.grabbed) {
    canvasRedraw();
    return;
  }
  const scheme = canvasScheme(state);
  if (!scheme) return;
  const view = canvasViewOf(state);
  const pick = drag.pick || {};
  const now = { point, at: canvasNow() };
  const twice = canvasDoubleTap(canvasLastTap, now);
  // Третий тап подряд — снова первый, а не второй двойного: иначе три тапа по
  // ручке вершины поставили бы вершину и тут же её убрали.
  canvasLastTap = twice ? null : now;
  const kind = canvasTapKind(state, pick);
  const plan = screenToPlan(point, scheme, view);
  if (kind === "labelTurn") canvasRotateLabel(state.selectedMarkIds[0]);
  else if (kind === "labelLeader") canvasToggleLabelLeader(state.selectedMarkIds[0]);
  else if (kind === "pathAdd") {
    const handle = pick.pathHandle;
    canvasPathAddCommit(
      {
        path: pick.path,
        index: handle.index,
        end: handle.end || null,
        point: screenToPlan({ x: handle.x, y: handle.y }, scheme, view),
        before: state.project,
      },
      screenToPlan({ x: handle.x, y: handle.y }, scheme, view),
    );
  } else if (kind === "block") canvasBlockPoint(state.selectedMarkIds[0], pick.blockSide);
  else if (kind === "scalePoint") canvasScaleClick(plan, point, false);
  else if (kind === "roomTrace") canvasRoomTraceClick(plan);
  else if (kind === "vertex") {
    if (state.mode === "room") canvasOutlineClick(plan, point, false);
    else canvasLineClick(plan, point, false);
  } else if (kind === "place") canvasPlacePoint(canvasPlaceSpot(canvasGhost, plan, state.schemeId));
  else if (kind === "select") {
    const patch = canvasTapAction(state, drag, {});
    if (patch) canvasApi.setState(patch);
    // Тишина у пальца та же, что у мыши, и дверь к словам одна (таск 217, D66).
    else canvasSaySilent(state, drag, patch);
  }
  // Второй тап того же двойного — то же, что второй клик мыши: замкнуть
  // ломаную, включить правку пути, вернуть подпись на место. Первый тап при
  // этом своё уже сделал — ровно как первый клик двойного у мыши.
  if (twice) canvasDoubleAt(point, canvasHitSlack(true));
  canvasRedraw();
}

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
  // Призрак пересчитывается и по нажатию, а не только по движению: палец на
  // сенсорном экране касается, не наведя, и прежнее место под ним — с другого
  // края плана. Постановка берёт точку у призрака, и он обязан быть свежим.
  canvasCursor = canvasPointOf(event);
  canvasGhostUpdate(canvasState());

  // Палец. Жест **всегда начинается панорамой** — иначе план перестанет
  // листаться, — а чем он был на самом деле, решают время и сдвиг:
  //
  // - повели сразу → панорама (или новая направляющая, если начали с линейки);
  // - подержали на месте `CANVAS_PRESS_MS` → взяли то, что под пальцем, и
  //   дальше ведение переносит его («зажали иконку и потом потащили»);
  // - отпустили, не сдвинув → тап, и что он делает, решает `canvasTapKind`.
  //
  // Раньше здесь всё кончалось панорамой: в просмотре палец не умел даже
  // выделить метку (таск 106), а в полной версии — ни поставить, ни перенести
  // (этот таск).
  if (event.pointerType === "touch") {
    if (canvasPointers.size === 2) {
      canvasPinch = gesturePinchOf(canvasPointers.values());
      canvasPressCancel();
      canvasDrag = null;
      return;
    }
    const at = canvasPointOf(event);
    canvasTouchAt = canvasNow();
    const touchState = canvasState();
    const touchScheme = canvasScheme(touchState);
    // Линейка отдаёт палец направляющей — ровно как мыши: полоса узкая и
    // заведена для того, чтобы с неё тянули.
    if (canvasEditAllowed(touchState) && canvasGuidesShown(touchState) && rulerAxis(at)) {
      const axis = rulerAxis(at);
      canvasDrag = {
        kind: "guideNew",
        axis,
        at: canvasGuideAt(axis, at, touchScheme, canvasViewOf(touchState)),
        start: at,
        moved: false,
        touch: true,
      };
      return;
    }
    canvasStartPan(at);
    if (canvasDrag) {
      // Жест помечается пальцевым здесь: по этой отметке `canvasPointerMove`
      // берёт пальцевую мерку сдвига, а не мышиную.
      canvasDrag.touch = true;
      const pick = canvasTouchPick(touchState, at);
      canvasDrag.pick = pick;
      // `tap` держит выбор метки: его читает `canvasTapAction` (таск 106).
      canvasDrag.tap = { markId: pick.markId };
      canvasPressStart(at, pick);
    }
    return;
  }
  if (event.button === 2) return;
  const point = canvasPointOf(event);
  // Средняя кнопка, зажатый пробел и Shift просят панораму прямо, без разбора.
  // Shift добавлен к ним по находке 10 разбора механик: его обещают подсказки
  // чертежа и окна загрузки плана, и комментарий чертежа утверждал «на холсте
  // так же» — а на холсте `event.shiftKey` не встречался вовсе.
  if (event.button === 1 || canvasSpace || event.shiftKey) {
    event.preventDefault();
    canvasStartPan(point);
    return;
  }
  if (event.button !== 0) return;

  const state = canvasState();
  const scheme = canvasScheme(state);
  const view = canvasViewOf(state);

  // В режиме просмотра открыты только две двери: выделить метку, чтобы прочитать
  // её поля, и возить план. Всё остальное — правка, и начинаться она не должна:
  // ни ручки блока, ни черновика, ни перетаскивания.
  const editable = canvasEditAllowed(state);
  // Ручки спрашиваются отдельно: в калибровке их не видно, и ловить клик они
  // не должны — иначе поворот подписи отобрал бы точку отрезка.
  const handles = canvasHandlesShown(state);

  if (handles && state.selectedMarkIds.length === 1) {
    const target = labelTargetOf(state.project, scheme, state.selectedMarkIds[0], state.filter);
    if (target && hitLabelTurn(state.project, scheme, target, point, view, state.filter)) {
      canvasRotateLabel(state.selectedMarkIds[0]);
      canvasDrag = { kind: "done", start: point, moved: false };
      return;
    }
    // Вторая ручка того же ряда: поводок подписи. Стоит вплотную к повороту,
    // поэтому и проверяется здесь же, сразу за ним.
    if (target && hitLabelLeader(state.project, scheme, target, point, view, state.filter)) {
      canvasToggleLabelLeader(state.selectedMarkIds[0]);
      canvasDrag = { kind: "done", start: point, moved: false };
      return;
    }
  }

  if (handles && state.selectedOutlineId) {
    const selected = findOutline(state.project, state.selectedOutlineId);
    if (selected && selected.schemeId === scheme.id && hitOutlineLabelTurn(state.project, scheme, selected, point, view)) {
      canvasRotateOutlineLabel(selected.id);
      canvasDrag = { kind: "done", start: point, moved: false };
      return;
    }
  }

  // Линейка забирает клик себе: с неё тянут новую направляющую. Она лежит
  // поверх плана, и отдавать её клик метке нельзя.
  const rulerUnder = editable && canvasGuidesShown(state) ? rulerAxis(point) : null;
  if (rulerUnder) {
    const axis = rulerUnder;
    canvasDrag = {
      kind: "guideNew",
      axis,
      at: canvasGuideAt(axis, point, scheme, view),
      start: point,
      moved: false,
    };
    return;
  }

  // Калибровка забирает клик себе — раньше ручек, метки и контура: рука
  // показывает точку отрезка, и всё, что обычно ловит клик, сейчас не при
  // деле. Линейка выше не случайно: направляющую вдоль стены ставят как раз
  // затем, чтобы по ней откалибровать.
  if (editable && state.mode === CANVAS_MODE_SCALE) {
    canvasDrag = { kind: "scale", start: point, view: { ...state.view }, moved: false };
    return;
  }

  // Показ точки внутри комнаты — тоже клик раньше всех ручек, и по той же
  // причине. Жест начинается панорамой: план обязан листаться и здесь.
  if (editable && state.mode === CANVAS_MODE_ROOM_TRACE) {
    canvasDrag = { kind: "roomTrace", start: point, view: { ...state.view }, moved: false };
    return;
  }

  // Ручки правимого пути важнее клика по самому объекту: пока они видны, за
  // вершину тащат её одну, а не всю линию и не весь контур. Ручка середины
  // ставит новую вершину, ручка за концом продолжает линию — и тот и другой
  // жест работает и нажатием, и перетаскиванием: нажали — вершина встала там,
  // где ручка, потянули — там, куда довели.
  const editedPath = editable ? canvasEditedPath(state, scheme) : null;
  if (editedPath) {
    const handle = hitPathHandle(pathEditHandles(scheme, editedPath, view), point);
    if (handle && handle.kind === "vertex") {
      canvasDrag = {
        kind: "pathVertex",
        path: editedPath,
        index: handle.index,
        start: point,
        before: state.project,
        guides: [],
        moved: false,
      };
      return;
    }
    if (handle) {
      canvasDrag = {
        kind: "pathAdd",
        path: editedPath,
        index: handle.index,
        end: handle.end || null,
        // Точка, где вершина встанет без перетаскивания, — под самой ручкой.
        point: screenToPlan({ x: handle.x, y: handle.y }, scheme, view),
        start: point,
        before: state.project,
        guides: [],
        moved: false,
      };
      return;
    }
  }

  // Ручка «+» важнее всего остального: она и есть быстрый путь. Важнее всего,
  // кроме уже стоящей под ней метки: ручка висит ровно на шаге блока, то есть
  // накрывает соседа по блоку, и без этой оговорки клик по соседу ставил бы
  // третью метку поверх него вместо того, чтобы его выделить. Своя метка не в
  // счёт — её ручки на то и ручки.
  if (editable && state.selectedMarkIds.length === 1) {
    const selected = findMark(state.project, state.selectedMarkIds[0]);
    if (selected && selected.kind === "point" && selected.schemeId === scheme.id) {
      const side = hitHandle(scheme, selected, point, view, 0, canvasStacks(state, scheme));
      const covered = side ? hitTest(state.project, scheme, point, view, state.filter) : null;
      const neighbour = covered && covered.part === "mark" && covered.markId !== selected.id;
      if (side && !neighbour) {
        canvasBlockPoint(selected.id, side);
        canvasDrag = { kind: "done", start: point, moved: false };
        return;
      }
    }
  }

  // Ломаную рисует режим добавления с линейным типом; контур помещения — свой
  // режим. Жест у них один, и дальше он разбирается по `canvasDrag.kind`.
  // Калибровка сюда не доходит — её жест начат выше.
  const drawing = state.mode === "room" ? "room" : canvasAddKind(state) === "line" ? "line" : null;
  if (editable && drawing) {
    canvasDrag = { kind: drawing, start: point, view: { ...state.view }, moved: false };
    return;
  }

  // Клик по метке важнее клика по контуру: попадание по меткам считается
  // первым, и контур перехватывает клик только там, где метки нет.
  const hit = hitTest(state.project, scheme, point, view, state.filter);
  if (!hit && state.mode === "select") {
    // Ручки вершин у контура те же, что у линии, и разбираются выше — здесь
    // контур отвечает только за стенку и подпись.
    const outlineHit = hitOutline(state.project, scheme, point, view, state.filter, null);
    if (outlineHit) {
      if (state.selectedOutlineId !== outlineHit.outlineId || state.selectedMarkIds.length > 0) {
        // Выбрали другой контур — правка прежнего пути закончена.
        canvasApi.setState({
          selectedOutlineId: outlineHit.outlineId,
          selectedMarkIds: [],
          editPathId: state.editPathId === outlineHit.outlineId ? state.editPathId : null,
        });
      }
      // Подпись комнаты таскается отдельно от контура — тем же жестом, что
      // подпись метки.
      if (outlineHit.part === "label" && editable) {
        canvasDrag = {
          kind: "outlineLabel",
          outlineId: outlineHit.outlineId,
          start: point,
          before: state.project,
          moved: false,
        };
        return;
      }
      canvasDrag = { kind: "outline", start: point, view: { ...state.view }, moved: false };
      return;
    }
  }
  if (hit) {
    // Выделили метку — выделение контура снимается: две пары ручек рядом
    // означали бы, что непонятно, чью вершину сейчас потащат.
    if (state.selectedMarkIds[0] !== hit.markId || state.selectedOutlineId) {
      // Выбрали другой объект — правка прежней линии закончена.
      canvasApi.setState({
        selectedMarkIds: [hit.markId],
        selectedOutlineId: null,
        editPathId: state.editPathId === hit.markId ? hit.markId : null,
      });
    }
    if (!editable) {
      // Метка выделена — её поля можно прочитать; тащить её при этом нельзя,
      // и жест уходит в панораму, а не в перемещение.
      //
      // `tapSelected` — тап по уже выделенной метке: по отпусканию без сдвига
      // он снимает выделение и закрывает карточку. Решение принимается здесь,
      // а применяется по отпусканию: с той же метки начинают и панораму, и
      // снимать выделение под рукой было бы нельзя.
      canvasDrag = {
        kind: "pan",
        start: point,
        view: { ...state.view },
        moved: false,
        tapSelected: state.selectedMarkIds.length === 1 && state.selectedMarkIds[0] === hit.markId,
      };
      return;
    }
    const kind = hit.part === "label" ? "label" : "mark";
    canvasDrag = {
      kind,
      markId: hit.markId,
      groupId: hit.groupId,
      // Точка комментария едет без плашки (G199). Решается здесь же, где и
      // состав группы, и по той же причине: жест, у которого смысл меняется
      // посреди ведения, нельзя ни показать, ни отменить одним шагом.
      commentPoint: canvasDragsCommentPoint(state.project, hit.markId, hit.part),
      // Кого везёт жест (G189). Решается **на нажатии**, один раз: жест, у
      // которого смысл меняется посреди ведения, нельзя ни показать, ни
      // отменить одним шагом. Ctrl/Cmd, нажатый после того как метку уже
      // повезли, эту группу не разнимает — отпустите и возьмите снова.
      moving: kind === "mark" ? canvasMoveIds(state.project, hit.markId, hit.groupId, canvasDragSolo(event)) : null,
      anchor: canvasNearestVertex(findMark(state.project, hit.markId), point, scheme, view),
      start: point,
      before: state.project,
      moved: false,
    };
    return;
  }
  // Направляющую берут под руку только в выделении: в добавлении клик по плану
  // ставит метку, и отбирать его у постановки нельзя — в перекрестия и целятся.
  if (editable && canvasGuidesShown(state) && state.mode === "select") {
    const guide = hitSchemeGuide(canvasSchemeGuides(state, scheme), point, scheme, view);
    if (guide) {
      canvasDrag = {
        kind: "guideMove",
        guideId: guide.id,
        axis: guide.axis,
        start: point,
        before: state.project,
        moved: false,
      };
      return;
    }
  }

  canvasDrag = {
    kind: canvasPlacesByClick(state) && editable ? "place" : "empty",
    start: point,
    view: { ...state.view },
    moved: false,
    // Стена под курсором запоминается здесь, на нажатии: по отпусканию решать
    // будет `canvasTapAction`, и считать ей второй раз нечем — у неё нет ни
    // плана, ни масштаба.
    wallId: canvasWallAt(state, screenToPlan(point, scheme, view)),
  };
}

// Сколько пикселей экрана прощается промаху по стене. **Здесь пиксели
// уместны**, в отличие от порога привязки метки (там миллиметры): это
// попадание рукой, а не свойство данных, и оно обязано вести себя одинаково
// на любом масштабе.
export const CANVAS_WALL_PICK_PX = 6;

/**
 * Стена чертежа под точкой плана — или `null`. Выключенный слой чертежа стену
 * не отдаёт: кликать по тому, чего не видно, человек не может.
 */
function canvasWallAt(state, plan) {
  if (!state || state.drawingShown === false) return null;
  const scheme = canvasScheme(state);
  if (!scheme) return null;
  const project = canvasProject(state);
  const walls = wallsOnScheme(project, scheme.id);
  if (walls.length === 0) return null;
  const at = planFractionToMm(project, scheme.id, plan);
  const bridge = drawingBridge(project, scheme, canvasViewOf(state));
  if (!at || !bridge || !(bridge.pxPerMm > 0)) return null;
  const slack = CANVAS_WALL_PICK_PX / bridge.pxPerMm;
  let best = null;
  for (const wall of walls) {
    const gap = segmentDistanceMm(at, wall.aMm, wall.bMm) - Number(wall.thicknessMm) / 2;
    if (gap > slack) continue;
    if (!best || gap < best.gap) best = { gap, id: wall.id };
  }
  return best ? best.id : null;
}

// ——— группа едет как одна метка ———————————————————————————————————————
//
// Заказчик (G189): «группы выключателей\розеток давай двигать вместе, как одну
// метку по умолчанию, а с зажатым ctrl\command уже отдельно каждую точку».
// До этого рамка, собранная ручкой «+», разъезжалась по одной метке: взял
// среднюю розетку из трёх — уехала одна, а блок перестал быть блоком.
//
// **Группа** здесь — ровно та, что в ADR 004 у режима «каждая своя»: несколько
// самостоятельных меток, связанных `group {markIds}` с общей подписью-
// перечислением. Второй механизм того же ADR — «одна метка на блок» — уже
// едет целиком и без всякой правки: там точки лежат в одной метке, и
// перетаскивание всегда возило их вместе. Третьей сущности не заводится.
//
// Выделение фильтром не сужается: скрытая метка блока едет вместе со
// остальными. Блок — одно место на плане; оставь её позади, и человек увидит
// разъехавшийся блок, только сняв фильтр, — а это и есть испорченная
// разметка (G68). Решение видно в объекте целиком, а не в текущем кадре.

/**
 * Разнимает ли этот жест группу: Ctrl на Windows, Cmd на Mac. Разбор тот же,
 * что у Ctrl+C/Ctrl+V и Ctrl+Z в `canvasKeyDown`, — обе клавиши названы
 * заказчиком, и второй правды о них в сборке нет.
 */
export function canvasDragSolo(event) {
  return Boolean(event && (event.ctrlKey || event.metaKey));
}

/**
 * Какие метки везёт жест: одну взятую или всю её группу.
 *
 * `solo` — Ctrl/Cmd на нажатии. Порядок — модельный `blockMembers`: своей
 * сортировки холст не заводит. Взятая метка в списке есть всегда, даже если
 * группа рассыпалась (висячий `groupId` после удаления соседей).
 */
export function canvasMoveIds(project, markId, groupId, solo) {
  if (!markId) return [];
  if (solo || !groupId) return [markId];
  const group = findGroup(project, groupId);
  if (!group) return [markId];
  const ids = blockMembers(project, group.markIds).map((mark) => mark.id);
  if (!ids.includes(markId)) ids.push(markId);
  return ids.length > 1 ? ids : [markId];
}

/**
 * Сдвинуть метки на один и тот же вектор в долях плана.
 *
 * Объект правит модель — `updateMark` на каждую метку, по снимку «до»: сдвиг
 * один, и форма блока от перетаскивания не меняется никогда. Результат — один
 * объект «после», поэтому в историю он уходит одним шагом `canvasCommit`.
 * Исчезнувшая метка молча пропускается: список собран на нажатии, а между
 * нажатием и ведением объект мог успеть измениться (отмена из другой панели).
 */
export function canvasMoveMarks(project, ids, shift) {
  let next = project;
  for (const id of ids || []) {
    const mark = findMark(next, id);
    if (!mark) continue;
    const points = mark.points.map((point) => ({ x: point.x + shift.x, y: point.y + shift.y }));
    next = updateMark(next, id, { points }).project;
  }
  return next;
}

// ——— комментарий: плашка и точка едут врозь ———————————————————————————
//
// Требование G199. Слова заказчика: «У комментария должна быть возможность
// сдвигать метку, куда указывает независимо от текст». У комментария с
// указателем две сущности на плане — плашка с текстом и точка, в которую
// смотрит остриё, — и держатся они в одной метке: точка это `points[0]`,
// плашка отведена пиксельным `labelOffset` (таск 116).
//
// Отсюда и вся работа таска: **перенос плашки уже был независимым** (смещение
// правится, точка стоит), а перенос точки тащил плашку за собой, потому что
// смещение считается от точки. Нового поля для этого не завелось: точку везёт
// обычная правка `points`, а плашка остаётся на месте поправкой того же
// `labelOffset` на тот же сдвиг со знаком минус. Формат объекта не тронут —
// значит и миграции нет, и прежние комментарии открываются как были (G68).

/**
 * Везёт ли этот жест **точку** комментария отдельно от плашки.
 *
 * Спрашивается на нажатии, как и состав группы (G189): смысл жеста не должен
 * меняться посреди ведения. Разбор идёт по тому же `part`, что у всех прочих
 * жестов холста, — встаём в спор за клик, а не рядом с ним:
 *
 * - `label` — плашка; её возят смещением, и это прежнее поведение;
 * - `mark` у комментария **с указателем** — та самая точка: плашка в этот
 *   момент отдаёт `label`, и спутать их нельзя;
 * - `mark` у комментария **без указателя** — плашка, стоящая на своей точке:
 *   разводить нечего, едет вся метка, как ездила.
 */
export function canvasDragsCommentPoint(project, markId, part) {
  if (!markId || part === "label") return false;
  const mark = findMark(project, markId);
  return Boolean(mark && markIsComment(mark) && markPointer(mark));
}

/**
 * Перенос точки комментария: точка едет, плашка остаётся там, где стояла.
 *
 * `base` — смещение плашки, какое видно **сейчас**, в пикселях плана (его
 * отдаёт `labelBox().dx/dy`). Берётся видимое, а не записанное, по той же
 * причине, что у переноса подписи: плашку с указателем могла поставить
 * раскладка, и дёргать её в стандартное место в тот миг, когда повезли точку,
 * нельзя. Побочное следствие — потащили точку, и плашка становится
 * поставленной рукой: раскладка её больше не двигает. Так и надо, место ей
 * выбрал человек.
 *
 * Единицы разные нарочно: точки метки — доли плана (ADR 002), смещение
 * подписи — пиксели плана. Поэтому поправка умножается на размер плана.
 */
export function canvasMoveCommentPoint(project, scheme, markId, shift, base) {
  const mark = findMark(project, markId);
  if (!mark) return project;
  const points = mark.points.map((point) => ({ x: point.x + shift.x, y: point.y + shift.y }));
  const width = scheme && scheme.width > 0 ? scheme.width : 0;
  const height = scheme && scheme.height > 0 ? scheme.height : 0;
  const labelOffset = {
    dx: (base ? base.dx : 0) - shift.x * width,
    dy: (base ? base.dy : 0) - shift.y * height,
  };
  return updateMark(project, markId, { points, labelOffset }).project;
}

/**
 * Ярлык шага истории для переноса: по нему человек в списке отмены видит, что
 * вернётся.
 *
 * Плашка и точка комментария едут врозь — и называются врозь: иначе два
 * соседних шага «смещение подписи» и «перемещение метки» не сказали бы, какой
 * из них вернёт текст, а какой остриё.
 */
export function canvasMoveStepLabel(project, drag) {
  if (!drag) return strings.history.move;
  const comment = drag.markId ? markIsComment(findMark(project, drag.markId)) : false;
  if (drag.kind === "label") return comment ? strings.history.moveCommentPlate : strings.history.moveLabel;
  if (drag.commentPoint) return strings.history.moveCommentPoint;
  return (drag.moving || []).length > 1 ? strings.history.moveBlock : strings.history.move;
}

// Перетаскивание метки: новые точки считаются от снимка «до», а не от
// предыдущего кадра, — иначе метка уползает от курсора накопленной ошибкой.
function canvasDragTo(point, free) {
  const state = canvasState();
  const scheme = canvasScheme(state);
  const view = canvasViewOf(state);
  const before = canvasDrag.before;
  const from = screenToPlan(canvasDrag.start, scheme, view);
  const now = screenToPlan(point, scheme, view);
  const dx = now.x - from.x;
  const dy = now.y - from.y;
  try {
    if (canvasDrag.kind === "pathVertex") {
      const path = canvasDrag.path;
      const origin = path.points[canvasDrag.index];
      const snap = canvasVertexSnap(path, canvasDrag.index, { x: origin.x + dx, y: origin.y + dy }, free);
      canvasDrag.guides = snap.guides;
      canvasPreview = canvasPathVertexMove(path, before, canvasDrag.index, snap.point);
    } else if (canvasDrag.kind === "pathAdd") {
      // Новая вершина ведётся от места ручки и притягивается ровно так же, как
      // вершина рисуемой ломаной: разбитый отрезок и продолжение линии ложатся
      // по тем же ровным углам и по тем же направляющим.
      const origin = canvasDrag.point;
      const snap = canvasAddSnap(canvasDrag, { x: origin.x + dx, y: origin.y + dy }, free);
      canvasDrag.guides = snap.guides;
      canvasDrag.landing = snap.point;
      canvasPreview = canvasPathAdded(canvasDrag, snap.point);
    } else if (canvasDrag.kind === "outlineLabel") {
      const outline = findOutline(before, canvasDrag.outlineId);
      // База — там, где подпись видна сейчас: у неподвинутой это середина
      // контура, у подвинутой — её смещение.
      const seen = outline ? outlineLabelBox(before, scheme, outline, view) : null;
      const base = seen ? { dx: seen.dx, dy: seen.dy } : { dx: 0, dy: 0 };
      canvasPreview = updateOutline(before, canvasDrag.outlineId, {
        labelOffset: { dx: base.dx + dx * scheme.width, dy: base.dy + dy * scheme.height },
      }).project;
    } else if (canvasDrag.kind === "label") {
      const target = canvasDrag.groupId ? findGroup(before, canvasDrag.groupId) : findMark(before, canvasDrag.markId);
      // База — там, где подпись сейчас видна, а не там, где лежит её смещение:
      // подпись, отведённую раскладкой от соседа, нельзя дёргать обратно
      // в стандартное место в тот миг, когда за неё взялись мышью.
      // Умолчание — модельное (`DEFAULT_VIEW`), не своё число: здесь стояла
      // десятка, отвергнутая заказчиком вместе с прежним кеглем подписи
      // (находка 3 разбора механик).
      const size = view.markSize || DEFAULT_VIEW.markSize;
      const seen = target ? labelBox(before, scheme, target, view, state.filter) : null;
      // Запасное место подписи — то же, куда её ставит отрисовка, когда её не
      // оттаскивали: мерка отступа берётся у неё (`LABEL_GAP`), а не повторяется.
      const base = seen ? { dx: seen.dx, dy: seen.dy } : { dx: size * LABEL_GAP, dy: 0 };
      const offset = { dx: base.dx + dx * scheme.width, dy: base.dy + dy * scheme.height };
      // Подпись блока стоит по смещению его первой метки — своего поля у группы
      // модель не заводит, а собственной подписи у этой метки нет.
      const holder = canvasDrag.groupId && target ? target.markIds[0] : canvasDrag.markId;
      canvasPreview = updateMark(before, holder, { labelOffset: offset }).project;
    } else {
      const mark = findMark(before, canvasDrag.markId);
      const shifted = mark.points.map((item) => ({ x: item.x + dx, y: item.y + dy }));
      // Притяжка к направляющим считается по той вершине, за которую взялись:
      // её пользователь и ведёт глазами. Вся метка едет за ней, форма цела.
      const anchor = shifted[canvasDrag.anchor] || shifted[0];
      const snapped = canvasGuideSnap(anchor, free);
      const fix = { x: snapped.x - anchor.x, y: snapped.y - anchor.y };
      const shift = { x: dx + fix.x, y: dy + fix.y };
      // Точка комментария везётся без плашки (G199): плашка стоит там, где её
      // видно сейчас, и это место берётся из той же `labelBox`, из которой его
      // берёт перенос самой плашки.
      if (canvasDrag.commentPoint) {
        const seen = labelBox(before, scheme, mark, view, state.filter);
        canvasPreview = canvasMoveCommentPoint(before, scheme, canvasDrag.markId, shift, {
          dx: seen.dx,
          dy: seen.dy,
        });
      } else {
        // Сдвиг один на всех, и считается он по взятой метке: группа едет как
        // одна метка (G189) и форму не меняет — соседи получают ровно тот же
        // сдвиг, включая поправку от направляющей.
        canvasPreview = canvasMoveMarks(before, canvasDrag.moving || [canvasDrag.markId], shift);
      }
    }
  } catch (error) {
    // Модель отказала на полпути — картинка замерла бы под рукой, а по
    // отпусканию перенос потерялся бы молча. Пусть скажет, в чём дело.
    canvasPreview = null;
    canvasFail(error);
  }
  canvasRedraw();
}

/**
 * Ручка правимого пути под курсором.
 *
 * Вершины сюда не попадают нарочно: они и так нарисованы в полную силу, и
 * подсвечивать в них нечего. Наведение нужно бледным — ручке разбивки и ручке
 * продолжения: под рукой первая показывает будущую вершину тем же квадратом,
 * какой на её месте и встанет.
 */
function canvasHoverAt(state, point) {
  if (canvasDrag || !canvasEditAllowed(state)) return null;
  const scheme = canvasScheme(state);
  const path = canvasEditedPath(state, scheme);
  if (!path) return null;
  const handle = hitPathHandle(pathEditHandles(scheme, path, canvasViewOf(state)), point);
  return handle && handle.kind !== "vertex" ? handle : null;
}

// Перерисовка — только когда ручка под курсором сменилась: ход мыши по плану
// не должен гонять кадр впустую.
function canvasHoverUpdate(state, point) {
  const previous = canvasHoverHandle;
  canvasHoverHandle = canvasHoverAt(state, point);
  if (!previous && !canvasHoverHandle) return false;
  return !samePathHandle(previous, canvasHoverHandle);
}

function canvasPointerMove(event) {
  if (!canvasNode) return;
  const point = canvasPointOf(event);
  // Где курсор — помнит только это место: вставка по Ctrl+V целится под него,
  // а своего «где мышь» у холста до сих пор не было.
  canvasCursor = point;
  if (canvasPointers.has(event.pointerId)) canvasPointers.set(event.pointerId, point);

  if (canvasPinch && canvasPointers.size === 2) {
    // Щипок разбирает `gestures.js` — то же правило, что в чертеже и в окне
    // загрузки плана. Порядок применения оттуда же: сперва масштаб вокруг
    // новой середины, потом сдвиг на её ход.
    const step = gesturePinchStep(canvasPinch, canvasPointers.values());
    canvasZoomAt(step.pinch.center, step.factor);
    const state = canvasState();
    canvasApi.setState({
      view: {
        ...state.view,
        offsetX: state.view.offsetX + step.panX,
        offsetY: state.view.offsetY + step.panY,
      },
    });
    canvasPinch = step.pinch;
    return;
  }

  const state = canvasState();
  if (canvasDraft) {
    const scheme = canvasScheme(state);
    const snap = canvasDraftSnap(screenToPlan(point, scheme, canvasViewOf(state)), event.altKey);
    canvasDraft.cursor = snap.point;
    canvasDraft.snapped = snap.snapped;
    canvasDraft.guides = snap.guides || [];
    canvasRedraw();
  }
  if (canvasHoverUpdate(state, point)) canvasRedraw();
  // Курсор — в тот же заход, что наведение: он отвечает про ту же точку, и
  // считать её дважды незачем (находка 6 разбора механик).
  canvasSyncCursor();
  // Призрак идёт за рукой — и перерисовывается только тогда, когда его место
  // сменилось: с притяжкой к направляющей оно меняется реже, чем курсор.
  if (canvasGhostUpdate(state)) canvasRedraw();
  if (!canvasDrag) return;
  const shift = Math.hypot(point.x - canvasDrag.start.x, point.y - canvasDrag.start.y);
  if (shift > canvasDragSlop(canvasDrag)) {
    canvasDrag.moved = true;
    // Повели — значит, это панорама или уже начатый перенос: ждать долгого
    // нажатия больше нечего, и кольцо под пальцем гаснет.
    canvasPressCancel();
  }
  if (!canvasDrag.moved) return;

  if (canvasDrag.kind === "guideNew" || canvasDrag.kind === "guideMove") {
    const scheme = canvasScheme(state);
    const view = canvasViewOf(state);
    const at = canvasGuideAt(canvasDrag.axis, point, scheme, view);
    if (canvasDrag.kind === "guideNew") canvasDrag.at = at;
    else {
      try {
        canvasPreview = moveSchemeGuide(canvasDrag.before, state.schemeId, canvasDrag.guideId, at).project;
      } catch (error) {
        canvasPreview = null;
      }
    }
    // Утащенная обратно на линейку направляющая снимается — это её «корзина».
    canvasDrag.drop = canvasOnRuler(point);
    canvasRedraw();
    return;
  }
  if (["mark", "label", "outlineLabel", "pathVertex", "pathAdd"].includes(canvasDrag.kind)) {
    canvasDragTo(point, event.altKey);
    return;
  }
  // «scale» в этом списке не для красоты: отрезок калибровки берут во всю
  // стену, и между первой и второй точкой план приходится возить.
  if (["pan", "empty", "place", "line", "room", "outline", "scale", "roomTrace"].includes(canvasDrag.kind)) {
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
  canvasPressCancel();
  canvasPointers.delete(event.pointerId);
  if (canvasPointers.size < 2) canvasPinch = null;
  const drag = canvasDrag;
  canvasDrag = null;
  if (!drag) return;
  const point = canvasPointOf(event);
  const state = canvasState();

  if (drag.kind === "guideNew") {
    // Не вытянули с линейки — направляющей и не было: клик по самой линейке
    // ничего не создаёт.
    if (drag.moved && !canvasOnRuler(point)) canvasGuideAdd(drag.axis, drag.at);
    canvasRedraw();
    return;
  }
  if (drag.kind === "guideMove") {
    const after = canvasPreview;
    canvasPreview = null;
    if (canvasOnRuler(point)) canvasGuideRemove(drag.guideId);
    else if (drag.moved && after) canvasCommit(drag.before, after, strings.history.guideMove);
    canvasRedraw();
    return;
  }
  // Ручка новой вершины: жест кончился — вершина встала. Нажали не сдвинув —
  // под самой ручкой, дотащили — там, куда довели. Шаг истории один на весь
  // жест, а не два: отмена возвращает линию, какой она была до нажатия.
  if (drag.kind === "pathAdd") {
    canvasPreview = null;
    canvasPathAddCommit(drag, drag.moved && drag.landing ? drag.landing : drag.point);
    canvasRedraw();
    return;
  }
  if (drag.moved) {
    if ((drag.kind === "mark" || drag.kind === "label") && canvasPreview) {
      // Перенос группы — **один** шаг истории, а не по шагу на метку: один
      // жест человека, один Ctrl+Z. Ярлык называет, что вернётся: «перенос
      // блока» против «перемещения метки», плашка комментария против его
      // точки. Считает его `canvasMoveStepLabel` — одно правило на все переносы.
      const label = canvasMoveStepLabel(drag.before, drag);
      const after = canvasPreview;
      canvasPreview = null;
      // Выделение остаётся на взятой метке: панель свойств и карточка говорят
      // об одной метке, и после переноса блока человек правит ту, за которую
      // взялся, а не получает пустую панель «выделено три».
      canvasCommit(drag.before, after, label, { selection: [drag.markId] });
    }
    if (drag.kind === "pathVertex" && canvasPreview) {
      const after = canvasPreview;
      canvasPreview = null;
      // Ярлык шага — свой у линии и у контура: в отмене видно, что вернётся.
      const outlinePath = drag.path.kind === "outline";
      canvasCommit(drag.before, after, outlinePath ? strings.history.outlineVertexMove : strings.history.markVertexMove, {
        ...(outlinePath ? { patch: { selectedOutlineId: drag.path.id } } : { selection: [drag.path.id] }),
      });
    }
    if (drag.kind === "outlineLabel" && canvasPreview) {
      const after = canvasPreview;
      canvasPreview = null;
      canvasCommit(drag.before, after, strings.history.moveOutlineLabel, {
        patch: { selectedOutlineId: drag.outlineId },
      });
    }
    canvasPreview = null;
    canvasRedraw();
    return;
  }
  canvasPreview = null;

  // Выбор метки — первым делом и до пальцевого выхода ниже. Правило целиком в
  // `canvasTapAction`: тап пальцем по метке, повторный клик по выделенной в
  // просмотре и клик по пустому месту. Оно и есть D19: ветка тапа стояла ниже
  // выхода `pointerType === "touch"`, и на планшете метка не выделялась вовсе.
  // Выделение — поле сеанса, объект оно не трогает; правка идёт дверью
  // `canvasCommit`, и та в просмотре закрыта.
  // Палец разбирается своей дверью: тап делает то же, что сделал бы клик, а
  // взятое долгим нажатием уже отпущено выше.
  if (drag.touch) {
    canvasTouchUp(state, drag, point, event.type === "pointercancel");
    return;
  }

  const tap = canvasTapAction(state, drag, { cancelled: event.type === "pointercancel" });
  if (tap) {
    canvasApi.setState(tap);
    return;
  }
  // Клик ничего не сделал — и, если целились в план с выбранным типом, об этом
  // говорится словом (таск 217, D66). Спрашивается здесь же, где решается тап:
  // два места для одного правила разошлись бы, а молчит оно ровно там, где
  // человек ждал метку.
  canvasSaySilent(state, drag, tap);

  // Ниже — только мышь: у пальца свой разбор выше.
  if (event.pointerType === "touch") return;
  // Нажатая ручка своё дело уже сделала — но рисовались ручки при `canvasDrag`
  // пустом, и без этого кадра они оставались бы невидимыми до следующего хода
  // мыши. Переключателю поводка это стоит дороже всех: он показывает состояние,
  // и пропасть сразу после нажатия — значит не показать ничего.
  if (drag.kind === "done") {
    canvasRedraw();
    return;
  }
  const scheme = canvasScheme(state);
  const plan = screenToPlan(point, scheme, canvasViewOf(state));
  if (drag.kind === "scale") {
    canvasScaleClick(plan, point, event.altKey);
    return;
  }
  if (drag.kind === "roomTrace") {
    canvasRoomTraceClick(plan);
    return;
  }
  if (drag.kind === "line") {
    canvasLineClick(plan, point, event.altKey);
    return;
  }
  if (drag.kind === "room") {
    canvasOutlineClick(plan, point, event.altKey);
    return;
  }
  if (drag.kind === "place") {
    // Точка — у призрака: он её показал (таск 176, `canvasPlaceSpot`).
    canvasPlacePoint(canvasPlaceSpot(canvasGhost, plan, state.schemeId));
    return;
  }
}

function canvasDoubleClick(event) {
  // Пока открыт диалог, холст не слушает ни клавиатуру, ни указатель — и
  // двойной клик тоже: вопрос о расстоянии калибровки открывается вторым
  // кликом, и браузерный `dblclick` приходит уже поверх диалога.
  if (uiDialogDepth() > 0) return;
  // Призрачный `dblclick` вслед за двойным тапом — не жест, а эхо: палец свой
  // двойной уже разобрал сам (`canvasTouchUp`), и разбирать его второй раз
  // значит сделать два дела вместо одного.
  if (canvasNow() - canvasTouchAt < CANVAS_GHOST_MS) return;
  // Мышь гасит браузерное событие только тогда, когда жест и правда разобран:
  // двойной клик в стороне — это просто два клика, и мешать браузеру незачем.
  if (canvasDoubleAt(canvasPointOf(event), canvasHitSlack(false))) event.preventDefault();
}

/**
 * Двойной жест по плану: замкнуть ломаную, включить правку пути, поставить или
 * убрать вершину, снять направляющую, вернуть подпись на место.
 *
 * Одна рука на мышь и на палец. Пальцу `dblclick` браузер не присылает вовсе —
 * проверено живьём: двойной тап по холсту с `touch-action: none` даёт два
 * `click` и ни одного `dblclick`. Поэтому двойной тап холст считает сам
 * (`canvasDoubleTap`) и зовёт эту же функцию: второй раз описать те же правила
 * значило бы их развести.
 *
 * `slack` — запас попадания: у пальца он больше (`canvasHitSlack`).
 * Возвращает `true`, если жест разобран.
 */
function canvasDoubleAt(at, slack = 0) {
  const state = canvasState();
  if (!canvasEditAllowed(state)) return false;
  // В калибровке двойного жеста нет вовсе: два клика там — это две точки
  // отрезка, и ни замыкать, ни возвращать подпись на место сейчас нечего.
  // В определении по чертежу его нет по той же причине: там всё решает один
  // клик, и второй не должен приниматься за правку только что найденного.
  if (state.mode === CANVAS_MODE_SCALE || state.mode === CANVAS_MODE_ROOM_TRACE) return false;
  const scheme = canvasScheme(state);
  const view = canvasViewOf(state);
  // Двойной клик по линейке ставит направляющую в точке клика — это второй
  // способ к перетаскиванию, и просил его пользователь: «двойной клик по
  // линейке должен создавать линию».
  if (canvasGuidesShown(state)) {
    const axis = rulerAxis(at);
    if (axis) {
      canvasGuideAdd(axis, canvasGuideAt(axis, at, scheme, view));
      return true;
    }
  }
  // Правка пути — один жест на ломаную метки и на контур помещения. Двойной
  // клик по объекту включает правку, по вершине — убирает её, по сегменту или
  // стенке — добавляет новую в точке клика. Пользователь: «у линий при
  // выделении позволь редактировать её, например двойным кликом на линию» и
  // «двойной клик по контуру комнаты — тоже давай править его».
  if (state.mode === "select") {
    const plan = screenToPlan(at, scheme, view);
    const edited = canvasEditedPath(state, scheme);
    if (edited) {
      const handle = hitPathHandle(pathVertexHandles(scheme, edited.points, view), at, slack);
      if (handle) {
        // Вершина, которую первый клик этого же двойного только что поставил
        // ручкой, не убирается вторым: жест «ткнуть в ручку дважды» иначе
        // ставил бы вершину и тут же её снимал, оставляя два шага истории и
        // ничего на плане.
        if (!canvasVertexIsFresh(edited.id, handle.index)) canvasPathVertexRemove(edited, handle.index);
        return true;
      }
    }
    // Метка важнее контура — тот же порядок, что у одиночного клика.
    const hit = hitTest(state.project, scheme, at, view, state.filter, slack);
    // Двойной клик по плашке правит её текст — и это главный способ до него
    // добраться: в списке меток комментариев нет (G167). Проверяется раньше
    // возврата подписи на место: у плашки без указателя смещения нет вовсе, а
    // у плашки с указателем текст нужнее, чем сброс места.
    if (hit && markIsComment(findMark(state.project, hit.markId))) {
      canvasEditCommentText(hit.markId);
      return true;
    }
    if (hit && edited && edited.kind === "mark" && hit.markId === edited.id && hit.part === "line") {
      canvasPathVertexInsert(edited, hit.index, plan);
      return true;
    }
    if (hit && hit.part !== "label") {
      const mark = findMark(state.project, hit.markId);
      if (mark && mark.kind === "line" && (!edited || hit.markId !== edited.id)) {
        canvasEditPath("mark", mark.id);
        return true;
      }
    }
    if (!hit && canvasGuidesShown(state)) {
      const guide = hitSchemeGuide(canvasSchemeGuides(state, scheme), at, scheme, view, slack);
      if (guide) {
        canvasGuideRemove(guide.id);
        return true;
      }
    }
    if (!hit) {
      const outlineHit = hitOutline(state.project, scheme, at, view, state.filter, null, slack);
      if (outlineHit && outlineHit.part === "edge") {
        if (edited && edited.kind === "outline" && edited.id === outlineHit.outlineId) {
          canvasPathVertexInsert(edited, outlineHit.index, plan);
        } else {
          canvasEditPath("outline", outlineHit.outlineId);
        }
        return true;
      }
    }
  }
  // Двойной клик по подписи возвращает её на место — там же, где её и таскают:
  // в рисовании линии и контура двойной клик занят завершением ломаной.
  const drawing = state.mode === "room" || canvasAddKind(state) === "line";
  if (!drawing && canvasResetLabel(at)) return true;
  if ((canvasAddKind(state) !== "line" && state.mode !== "room") || !canvasDraft) return false;
  const points = canvasDraft.points;
  // Что значит двойной клик — общий разбор (`gestureDraftEnd`, таск 167): по
  // первой вершине замыкает, по последней заканчивает незамкнутым, в стороне не
  // значит ничего. Тем же разбором заканчивается контур вещи в чертеже.
  const end = gestureDraftEnd(canvasDraftScreen(points, scheme, view), at, canvasDraftEndPx(view, slack));
  // Двойной клик в стороне — это просто две вершины подряд: рисование
  // продолжается, ничего не теряется и не замыкается.
  if (end === "none") return false;
  // Контур помещения замкнут всегда: комната с открытой стенкой — не комната.
  if (state.mode === "room") {
    canvasOutlineFinish();
    return true;
  }
  // По первой точке — замкнутый контур (лента по периметру комнаты),
  // по последней — открытая линия, ровно как в брифе.
  canvasLineFinish(end === "close");
  return true;
}

function canvasWheel(event) {
  if (uiDialogDepth() > 0) return;
  event.preventDefault();
  const move = gestureWheel(event, canvasWheelStreak);
  canvasWheelStreak = move.streak;
  if (move.kind === "pan") {
    canvasPanBy(move.panX, move.panY);
    return;
  }
  canvasZoomAt(canvasPointOf(event), move.factor);
}

// ——— клавиатура ——————————————————————————————————————————————————————

// Выделенный на странице текст: пока он есть, Ctrl+C принадлежит браузеру.
function canvasTextSelected() {
  if (typeof window === "undefined" || typeof window.getSelection !== "function") return false;
  const selection = window.getSelection();
  return Boolean(selection && selection.isCollapsed === false && String(selection).length > 0);
}

function canvasKeyDown(event) {
  // Пока открыт диалог, клавиатура принадлежит ему.
  if (uiDialogDepth() > 0) return;
  // Предикат «фокус в поле» — общий на три поверхности (`uiTypingTarget` и
  // `uiFieldTarget`, находка 10 разбора механик). Своего здесь больше нет, и
  // ответов стало два: пока набирают буквы — молчим вовсе; пока фокус в списке
  // или на ползунке — отдаём им стрелки и буквы, но не отмену.
  //
  // Главное, что это чинит: щелчок по галочке фильтров или по `select`
  // выключал Ctrl+Z на плане. В галочке отменять нечего, а в чертеже тот же
  // жест отменял — одна рука, два ответа.
  if (uiTypingTarget(event.target)) return;
  const inField = uiFieldTarget(event.target);
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
  // Дальше всё — про план под рукой: метки, типы, ход и масштаб. На экране
  // может стоять чертёж или объём, и там те же клавиши заняты своим (таск
  // 153): стрелки в объёме ходят, а «+» в чертеже меняет масштаб чертежа — тем
  // же шагом и той же `canvasZoomKey`, но своим видом (дефект D68, таск 220).
  //
  // Отмена и возврат выше этой границы нарочно: они про объект, а не про
  // режим, живут в шапке и обязаны работать во всех трёх.
  if (!canvasOnScreen(state)) return;
  // Ctrl+C и Ctrl+V — по физической клавише, как и всё здесь: в русской
  // раскладке на них «с» и «м». Поля ввода и диалоги отсечены выше — там
  // копирование и вставка текста остаются браузерными и никуда не деваются.
  if (control && event.code === "KeyC") {
    // Выделенный на странице текст забирать нельзя: пользователь выделил
    // расположение в списке меток, чтобы перенести его в письмо, — Ctrl+C
    // в этот момент про текст, а не про метку.
    if (canvasTextSelected()) return;
    event.preventDefault();
    canvasCopyMark();
    return;
  }
  if (control && event.code === "KeyV") {
    event.preventDefault();
    canvasPasteMark();
    return;
  }
  if (control) return;
  // Дальше — клавиши без Ctrl: их у списка и ползунка отбирать нельзя.
  if (inField) return;
  // Q — тоже физическая клавиша: в русской раскладке это «й», и сравнение по
  // `event.key` молчало бы ровно у тех, кто размечает планы по-русски.
  if (event.code === "KeyQ" && !event.altKey) {
    event.preventDefault();
    canvasPickType();
    return;
  }
  // Ход и масштаб — до всего остального. Поля и диалоги отсечены выше, больше
  // спрашивать не о чем: см. `canvasHasPlan`.
  if (canvasHasPlan()) {
    if (canvasPanKeyDown(event.code)) {
      event.preventDefault();
      return;
    }
    const factor = canvasZoomKey(event);
    if (factor) {
      event.preventDefault();
      canvasZoomBy(factor);
      return;
    }
  }
  if (event.code === "Space" && !event.altKey && !uiSpaceTarget(event.target)) {
    // **Действие браузера снимается здесь и в `canvasKeyUp`** (находка 10
    // разбора механик): нажатие кнопки пробелом браузер делает именно по
    // `keyup`, и одного `preventDefault` на нажатии не хватает. Без этого
    // щёлкнул кнопку панели, подвинул план пробелом, отпустил — и кнопка
    // срабатывала второй раз. Абзац про тот же случай написан в объёме, и
    // там `preventDefault` стоит дважды.
    //
    // Сочетания с пробелом остаются системе: Ctrl+Space (раскладка),
    // Cmd+Space (поиск), Alt+Space (меню окна) — `control` отсечён выше,
    // Alt отсечён условием.
    event.preventDefault();
    // Автоповтор системы ничего не добавляет: пробел уже зажат.
    if (canvasSpace) return;
    canvasSpace = true;
    // Через ту же дверь, что и всё про курсор: своё «grab» здесь спорило бы с
    // правилом (`render.cursorFor`, находка 6 разбора механик).
    canvasSyncCursor();
    return;
  }
  if (event.key === "Escape") {
    if (canvasCancelDraft()) return;
    // Первый Esc заканчивает правку линии: выделение при этом остаётся — за ним
    // стоят панель свойств и кнопки, и сносить его заодно нельзя.
    if (state.editPathId) {
      canvasApi.setState({ editPathId: null });
      return;
    }
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
    // Убрали вершину — прежняя пометка магнита и прежние направляющие
    // относились к прежнему отрезку.
    else {
      canvasDraft.snapped = false;
      canvasDraft.guides = [];
    }
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
  canvasPanRelease(event.code);
  if (event.code !== "Space") return;
  // Нажатие кнопки пробелом браузер делает по **отпусканию** — снимать его
  // надо и здесь (находка 10). Поле набора и диалог при этом не трогаем:
  // пробел там принадлежит им.
  if (canvasSpace && uiDialogDepth() === 0 && !uiSpaceTarget(event.target)) event.preventDefault();
  canvasSpace = false;
  canvasSyncCursor();
}

// Курсор ушёл с холста — вставке больше не под что целиться: она встанет рядом
// с исходной меткой. Без этого запомненная точка оставалась бы «последней
// известной», и копия садилась бы туда, где мыши давно нет.
function canvasPointerLeave() {
  canvasCursor = null;
  // Призрак уходит с курсором: обещать постановку там, где руки нет, нельзя.
  if (canvasGhostDrop()) canvasRedraw();
  // Курсора над планом нет — и подсвеченной ручки быть не должно: иначе она
  // осталась бы гореть на последнем месте, где мышь ушла с холста.
  if (canvasHoverHandle) {
    canvasHoverHandle = null;
    canvasRedraw();
  }
  canvasSyncCursor();
}

// Окно увели — зажатые клавиши отпустить некому: своего keyup они уже не
// пришлют, и план уехал бы дальше сам по себе. Курсор за это время тоже мог
// уехать куда угодно, и его последняя точка больше ничего не значит.
function canvasWindowBlur() {
  canvasPanRelease(null);
  canvasSpace = false;
  canvasCursor = null;
  canvasGhostDrop();
  canvasSyncCursor();
}

/**
 * Что под рукой на плане — в словах курсора (находка 6 разбора механик).
 *
 * До этого курсор плана знал **только про режим** и о наведении не спрашивал,
 * хотя попадание считается на каждое движение мыши: метка под рукой ничем не
 * отличалась от пустого места, и что её можно тащить, человек узнавал, только
 * потащив. В чертеже это было ровно наоборот, и один и тот же вопрос получал
 * два противоположных ответа.
 *
 * Лестница повторяет порядок `canvasPointerDown`, а не живёт сама по себе:
 * обещать курсором одно, а делать по клику другое — хуже, чем молчать.
 * Спрашивается она только в «Выделении»: в постановке и калибровке клик ставит
 * точку, и что под рукой, ответа не меняет.
 */
function canvasCursorAt(state, point) {
  if (!point || !state || state.mode !== "select") return {};
  const scheme = canvasScheme(state);
  if (!scheme) return {};
  const view = canvasViewOf(state);
  const editable = canvasEditAllowed(state);
  const handles = canvasHandlesShown(state);
  // Линейка лежит поверх плана и забирает клик себе: с неё тянут направляющую.
  if (editable && canvasGuidesShown(state) && rulerAxis(point)) return { pull: true };
  // Ручки подписи выделенной метки: поворот и поводок — нажимаются, не тянутся.
  if (handles && state.selectedMarkIds.length === 1) {
    const target = labelTargetOf(state.project, scheme, state.selectedMarkIds[0], state.filter);
    if (target && hitLabelTurn(state.project, scheme, target, point, view, state.filter)) return { press: true };
    if (target && hitLabelLeader(state.project, scheme, target, point, view, state.filter)) return { press: true };
  }
  if (handles && state.selectedOutlineId) {
    const selected = findOutline(state.project, state.selectedOutlineId);
    if (selected && selected.schemeId === scheme.id && hitOutlineLabelTurn(state.project, scheme, selected, point, view)) {
      return { press: true };
    }
  }
  // Ручки правимого пути: вершину тянут, ручку разбивки и продолжения нажимают.
  const editedPath = editable ? canvasEditedPath(state, scheme) : null;
  if (editedPath) {
    const handle = hitPathHandle(pathEditHandles(scheme, editedPath, view), point);
    if (handle) return handle.kind === "vertex" ? { pull: true } : { press: true };
  }
  // Ручка «+» вокруг выделенной точки — быстрый путь к соседу по блоку.
  if (editable && state.selectedMarkIds.length === 1) {
    const selected = findMark(state.project, state.selectedMarkIds[0]);
    if (selected && selected.kind === "point" && selected.schemeId === scheme.id) {
      if (hitHandle(scheme, selected, point, view, 0, canvasStacks(state, scheme))) return { press: true };
    }
  }
  // Метка, её подпись и контур помещения — их возят, значит `move`. В режиме
  // просмотра возить нельзя, но выделить можно: курсор там говорит «нажмётся»,
  // а не «поедет», и это правда.
  const hit = hitTest(state.project, scheme, point, view, state.filter);
  if (hit) return editable ? { move: true } : { press: true };
  const outlineHit = hitOutline(state.project, scheme, point, view, state.filter, null);
  if (outlineHit) return editable ? { move: true } : { press: true };
  // Направляющая — последней, как и в нажатии: метка под ней главнее.
  if (editable && canvasGuidesShown(state)) {
    if (hitSchemeGuide(canvasSchemeGuides(state, scheme), point, scheme, view)) return { pull: true };
  }
  return {};
}

function canvasSyncCursor() {
  if (!canvasNode) return;
  const state = canvasState();
  // Правило — одно на план и чертёж (`render.cursorFor`): панорама, потом
  // постановка точки, потом то, что под рукой.
  canvasNode.style.cursor = cursorFor({
    pan: canvasSpace || Boolean(canvasDrag && canvasDrag.kind === "pan" && canvasDrag.moved),
    place: state.mode !== "select" || Boolean(canvasDraft),
    ...canvasCursorAt(state, canvasDrag ? null : canvasCursor),
  });
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
  canvasNode.addEventListener("pointerleave", canvasPointerLeave);
  canvasNode.addEventListener("dblclick", canvasDoubleClick);
  canvasNode.addEventListener("wheel", canvasWheel, { passive: false });
  canvasNode.addEventListener("contextmenu", (event) => event.preventDefault());
  document.addEventListener("keydown", canvasKeyDown);
  document.addEventListener("keyup", canvasKeyUp);

  // Первый кадр может лечь до того, как дошёл файл чертёжного шрифта: холст в
  // отличие от разметки сам ничего не перерисовывает, и подписи остались бы
  // системным шрифтом до первого движения мышью. Один лишний кадр на загрузку.
  drawFontReady().then(() => canvasRedraw());

  // Окно увели — зажатые клавиши отпустить некому, и это **не связано** с
  // `ResizeObserver`: обработчик стоял в ветке `else` от проверки на него, то
  // есть ни в одном живом браузере не вешался (находка 10 разбора механик).
  // Чертёж и объём вешают свой безусловно; теперь и план. Без этого зажатая
  // стрелка уезжала вместе с окном, а зажатый пробел оставался зажатым —
  // курсор «рука», и клик по плану листал его вместо постановки метки.
  window.addEventListener("blur", canvasWindowBlur);
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
      if (state.selectedWallId) canvasApi.setState({ selectedWallId: null });
    }
    // Режим, выбранный тип и его вид в справочнике — всё это меняет то, что
    // рисует рука. Черновик подтягивается к новому положению дел здесь, в
    // одном месте, а не на каждой кнопке, которая что-то из этого правит.
    if ("mode" in changed || "activeTypeId" in changed || "project" in changed) canvasSyncDraft(state);
    if ("mode" in changed) {
      canvasSyncCursor();
      // Новое занятие — молчание начинается заново (таск 217, D66): про
      // пустой клик говорится один раз на каждый вход в «Выделение». По той же
      // мерке и по тому же поводу — слова о метке, прижатой к краю плана
      // (таск 222, D73).
      canvasSilentSaid = false;
      canvasPinnedSaid = false;
      // Режим, у которого нет своей кнопки, говорит о себе сам — кто бы его ни
      // включил. См. `CANVAS_MODE_NOTES`.
      const said = CANVAS_MODE_NOTES[state.mode];
      if (said) canvasApi.notify(said);
    }
    // Место общее на три режима (D59): вернулись на план — встаём туда, где
    // стояло поле, с которого пришли. **До** подгонки: встав на место, план
    // считается подогнанным, и `canvasAutoFit` его больше не трогает.
    if ("screen" in changed || "schemeId" in changed || "project" in changed) canvasPullPlace(state);
    // Подгонка пробуется и на правке объекта: у схемы без подложки вписывать
    // до первой стены нечего, и единственный случай, когда «вписать» впервые
    // становится возможным, — появление чертежа. Повторов это не даёт:
    // `canvasAutoFit` выходит сразу, как только схема подогнана.
    if ("schemeId" in changed || "schemeImage" in changed || "project" in changed) canvasAutoFit(state);
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
  // Вписывать нечего, пока схема пуста: ни картинки, ни чертежа. У схемы без
  // подложки (таск 127) подгонка идёт по чертежу — её лист вчетверо больше
  // квартиры, и вписанный целиком он показал бы квартиру маркой на поле.
  const image = state.schemeImage && state.schemeImage.schemeId === scheme.id;
  const bounds = drawingBoundsMm(state.project, scheme.id);
  if (!image && !bounds) return;
  canvasFitted = scheme.id;
  const box = { width: canvasNode.clientWidth, height: canvasNode.clientHeight };
  canvasApi.setState({ view: image ? fitView(scheme, box) : canvasFitDrawing(state.project, scheme, box) });
}

/**
 * Вписать **нарисованное**, а не лист: у схемы без подложки лист постоянный и
 * заведомо больше квартиры (сорок на тридцать метров), и `fitView` показал бы
 * чертёж марковой наклейкой посреди поля.
 *
 * Чистая и вынесена наружу ради теста: промах здесь — это «открыл схему, а там
 * пусто», и ловить его глазами дорого.
 */
export function canvasFitDrawing(project, scheme, box) {
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

// Подсказка поверх холста: что сейчас ставим и чем это закончить. Сворачивается
// в одну кнопку со значком — текст её читают один раз, а место она занимает всё
// время работы.
function mountCanvasHint(host, api) {
  const hint = document.createElement("div");
  hint.className = "canvas-hint";
  const body = uiEl("p", { class: "canvas-hint__text" });
  const toggle = uiEl(
    "button",
    {
      class: "canvas-hint__toggle",
      type: "button",
      on: {
        click: () => {
          canvasHintCollapsed = !canvasHintCollapsed;
          setSetting(CANVAS_HINT_SETTING, canvasHintCollapsed);
          render();
        },
      },
    },
    uiIcon("hint"),
  );
  hint.append(toggle, body);
  host.append(hint);
  const render = () => {
    const state = api.getState();
    const value = canvasHintText(state);
    // Отступ от линейки — до проверки на пустоту: он нужен подсказке в любом
    // виде, и свёрнутой тоже.
    hint.style.setProperty("--canvas-hint-inset", canvasHintInset(state) + "px");
    // Условие показа живёт здесь, а не в чужих стилях: подсказки нет, когда
    // нечего подсказывать, а в просмотре она говорит про просмотр.
    hint.hidden = value === null;
    if (value === null) return;
    body.textContent = value;
    hint.classList.toggle("is-collapsed", canvasHintCollapsed);
    body.hidden = canvasHintCollapsed;
    // Развёрнутую подсказку пользователь видит — значит, этот текст прочитан.
    if (!canvasHintCollapsed) canvasHintSeen = value;
    const unseen = canvasHintCollapsed && plateUnseen(canvasHintSeen, value);
    toggle.classList.toggle("is-new", unseen);
    let label = strings.canvas.hintCollapse;
    if (canvasHintCollapsed) label = unseen ? strings.canvas.hintExpandNew : strings.canvas.hintExpand;
    toggle.title = label;
    toggle.setAttribute("aria-label", label);
    toggle.setAttribute("aria-expanded", canvasHintCollapsed ? "false" : "true");
    const type = state.project && state.activeTypeId ? findType(state.project, state.activeTypeId) : null;
    const room = state.project && state.activeRoomId ? findRoom(state.project, state.activeRoomId) : null;
    // Цвет достаётся и кнопке: свёрнутой подсказки, кроме неё, не видно, а
    // цвет типа — единственное, что говорит, чем сейчас размечают. В просмотре
    // цвета нет вовсе: размечать там нечем.
    let color = "";
    if (canvasEditAllowed(state)) {
      if ((state.mode === "room" || state.mode === CANVAS_MODE_ROOM_TRACE) && room) color = room.color;
      else if (type) color = styleOf(state.project, type.id).color;
    }
    hint.style.borderColor = color;
    toggle.style.borderColor = color;
  };
  api.subscribe((state, changed) => {
    if (
      "mode" in changed ||
      "activeTypeId" in changed ||
      "activeRoomId" in changed ||
      "schemeId" in changed ||
      "layout" in changed ||
      // Режим экрана: подсказка про план уходит вместе с планом (таск 153).
      "screen" in changed ||
      // Линейка пришла или ушла — отступ подсказки меняется вместе с ней.
      "guidesShown" in changed ||
      // Правка ломаной — такой же режим руки, как «Добавление»: началась или
      // закончилась, и подсказка обязана это сказать.
      "editPathId" in changed ||
      "project" in changed
    ) {
      render();
    }
  });
  render();
  // Настройка читается асинхронно: подсказка стартует развёрнутой и
  // схлопывается, когда хранилище ответит. Ждать его с пустым углом хуже.
  Promise.resolve(getSetting(CANVAS_HINT_SETTING))
    .then((saved) => {
      if (saved !== true) return;
      canvasHintCollapsed = true;
      // То, что пользователь успел увидеть до ответа хранилища, прочитанным не
      // считается: он на подсказку не смотрел, она мигнула сама.
      canvasHintSeen = null;
      render();
    })
    .catch(() => {});
}

// Кнопка полного экрана: правый верхний угол холста, зеркально подсказке в
// левом. Тот же приём — рисованный значок поверх плана, клики берёт только
// сама кнопка (поле наложения сквозное), — и та же мера отступа от линейки.
function mountCanvasFullscreen(host, api) {
  const doc = typeof document === "undefined" ? null : document;
  // Разворачивается страница целиком: полный экран одного холста оставил бы
  // пользователя без панелей и без шапки посреди работы.
  const target = doc ? doc.documentElement : null;
  // Браузер отказал — кнопка уходит до перезагрузки. Это тот случай, о котором
  // предупреждал тикет: висеть мёртвой ей незачем, а спрашивать браузер ещё
  // раз тем же жестом нечем.
  let denied = false;
  const button = uiEl("button", {
    // Рисунок и размер — общие для угловых кнопок поля (`.canvas-corner`), своё
    // у этой только место: первая ячейка угла (таск 166).
    class: "canvas-corner canvas-full",
    type: "button",
    on: {
      click: () => {
        Promise.resolve()
          .then(() => canvasFullscreenToggle(doc, target))
          .then(() => render())
          .catch(() => {
            denied = true;
            api.notify(strings.canvas.fullscreenDenied, "error");
            render();
          });
      },
    },
  });
  host.append(button);
  const render = () => {
    const state = api.getState();
    const on = canvasFullscreenOn(doc);
    // Поле во весь экран (таск 166, G246): страница убирает с себя всё, кроме
    // поля, и говорит об этом отметкой на своём корне — что именно уходит,
    // решают стили (`styles.css`). Отметка ставится здесь потому, что это
    // единственное место сборки, которое знает и про полный экран, и про
    // режим; и считается она заново на каждый вопрос, как и само состояние
    // кнопки, — запомненная, она разошлась бы с настоящей при выходе мимо
    // кнопки.
    const app = doc ? doc.getElementById("app") : null;
    if (app) app.classList.toggle("is-field-bare", canvasFullscreenBare(on, state.screen));
    // Кнопка живёт над планом: без открытой схемы разворачивать нечего, и в
    // пустом холсте она была бы единственной вещью на экране.
    const shown = Boolean(state.schemeId) && !denied && canvasFullscreenSupported(doc, target);
    button.hidden = !shown;
    if (!shown) return;
    const label = canvasFullscreenLabel(on);
    button.replaceChildren(on ? uiIcon("fullscreenExit") : uiIcon("fullscreen"));
    button.title = label;
    button.setAttribute("aria-label", label);
    button.setAttribute("aria-pressed", on ? "true" : "false");
    // Линейка занимает полосу сверху — кнопка начинается за ней, как и
    // подсказка, и мера у них общая.
    button.style.setProperty("--canvas-hint-inset", canvasHintInset(state) + "px");
  };
  api.subscribe((state, changed) => {
    if (
      "schemeId" in changed ||
      "guidesShown" in changed ||
      "layout" in changed ||
      // Кнопка одна на все три режима — она и есть обещанный тикетом
      // полноэкранный показ чертежа и объёма (таск 153), — но мера отступа у
      // режимов разная: линейка есть только у плана.
      "screen" in changed
    ) {
      render();
    }
  });
  // Из полного экрана выходят и мимо кнопки: Esc, жест, системная кнопка. Своё
  // состояние кнопка не помнит, но перерисоваться обязана — иначе на обратно
  // свёрнутом окне у неё останется значок «свернуть».
  if (doc) {
    for (const name of FULLSCREEN_EVENTS) doc.addEventListener(name, render);
  }
  render();
}

/**
 * Полоса развёртки выделенной стены поверх холста (таск 129).
 *
 * Прижимается к тому краю поля, который **дальше от самой стены**: иначе она
 * регулярно накрывала бы ровно то, ради чего её открыли. Сторона стены живёт
 * в состоянии сеанса рядом с выделением — в объект она не попадает, это
 * взгляд, а не свойство чертежа.
 *
 * **Правило показа одно на обе поверхности** (таск 133, G185): полоса не
 * выезжает сама собой, её показывают, когда попросили. В мастерской просьба —
 * режим «Развёртка». Здесь просьба — сам клик по стене: на холсте стену
 * нельзя ни подвинуть, ни поправить, выделяют её ровно затем, чтобы увидеть
 * развёртку, и второго смысла у этого клика нет. Для того, кто размечает
 * поверх своего чертежа и ловит полосу промахом мимо метки, есть выключатель
 * `elevationShown` — рядом с подложкой и чертежом, в разделе «Размеры».
 */
function mountCanvasElevation(host, api) {
  const strip = createElevationStrip({
    onSide: (side) => api.setState({ wallSide: side }),
    // Переход на другую стену парой углов (таск 197, G302): стена и сторона
    // ложатся одной правкой состояния — иначе между ними мелькнула бы развёртка
    // новой стены с прежней стороной. Сам участок полоса держит у себя: на
    // какой кусок стены человек смотрит, выделению знать незачем.
    onWall: ({ wallId, side }) => api.setState({ selectedWallId: wallId, wallSide: side }),
    onClose: () => api.setState({ selectedWallId: null }),
    // Отметка живёт в настройках браузера, как слои и шрифт схемы: на одном
    // компьютере смотрят картинками, на другом знаками, а объект один.
    onViews: (value) => {
      api.setState({ elevationViews: value });
      setSetting(ELEVATION_VIEWS_SETTING, value);
    },
    views: api.getState().elevationViews !== false,
    // Нижняя граница масштаба мелких вещей (таск 179, D42) — той же природы и
    // тем же путём, что «изображения».
    onGrow: (value) => {
      api.setState({ elevationGrow: value });
      setSetting(ELEVATION_GROW_SETTING, value);
    },
    grow: api.getState().elevationGrow === true,
  });
  host.append(strip.node);

  function render() {
    const state = api.getState();
    const scheme = canvasScheme(state);
    const project = state.project;
    // В чужом режиме полосы над планом нет: план не виден, а у чертежа своя
    // такая же полоса в своём поле (таск 153).
    if (
      !project ||
      !scheme ||
      !state.selectedWallId ||
      !canvasNode ||
      !canvasOnScreen(state) ||
      state.elevationShown === false
    ) {
      strip.update({ project, wallId: null });
      return;
    }
    const height = canvasNode.clientHeight || 0;
    strip.update({
      project,
      wallId: state.selectedWallId,
      side: state.wallSide,
      place: elevationPlace(canvasWallMiddleY(state), height),
      fieldHeight: height,
      views: state.elevationViews !== false,
      grow: state.elevationGrow === true,
    });
  }

  api.subscribe((state, changed) => {
    if (
      "selectedWallId" in changed ||
      "wallSide" in changed ||
      "elevationShown" in changed ||
      "elevationViews" in changed ||
      "elevationGrow" in changed ||
      "project" in changed ||
      "schemeId" in changed ||
      "view" in changed ||
      "layout" in changed ||
      "screen" in changed
    ) {
      render();
    }
  });
  if (typeof window !== "undefined") window.addEventListener("resize", () => strip.repaint());
  render();
}

// Середина выделенной стены в пикселях поля — по ней решается, у какого края
// встанет полоса.
function canvasWallMiddleY(state) {
  const scheme = canvasScheme(state);
  const wall = scheme ? findWall(state.project, state.selectedWallId) : null;
  const bridge = wall ? drawingBridge(state.project, scheme, canvasViewOf(state)) : null;
  if (!wall || !bridge) return Number.NaN;
  const a = bridge.toScreen(wall.aMm);
  const b = bridge.toScreen(wall.bMm);
  return (a.y + b.y) / 2;
}

/**
 * Сводка плана — правая плашка (G228).
 *
 * Правило одно на три режима: слева подсказка со знаком «?», справа сводка со
 * знаком «i», и стоит она левее кнопки полноэкранности. Содержимое считает
 * `canvasSummaryLines`, а здесь только руки и перерисовка.
 */
function mountCanvasSummary(host, api) {
  const plate = createFieldPlate({ side: "right", setting: CANVAS_SUMMARY_SETTING });
  host.append(plate.node);
  const render = () => {
    const state = api.getState();
    plate.update(canvasSummaryLines(state), { hidden: !canvasOnScreen(state) });
    plate.node.style.setProperty("--canvas-hint-inset", canvasHintInset(state) + "px");
  };
  api.subscribe((state, changed) => {
    if (
      "project" in changed ||
      "schemeId" in changed ||
      "filter" in changed ||
      "layout" in changed ||
      "guidesShown" in changed ||
      "screen" in changed
    ) {
      render();
    }
  });
  render();
}

// Поверх холста живут четверо: подсказка слева, сводка и полный экран справа и
// полоса развёртки у дальнего от стены края. Точка монтирования одна, поэтому и
// монтируются они вместе — панель чистит поле один раз, а не каждый за себя.
function mountCanvasOverlay(host, api) {
  host.replaceChildren();
  mountCanvasHint(host, api);
  mountCanvasSummary(host, api);
  mountCanvasFullscreen(host, api);
  mountCanvasElevation(host, api);
}

registerPanel(PANEL_IDS.canvas, mountCanvas);
registerPanel(PANEL_IDS.overlay, mountCanvasOverlay);
