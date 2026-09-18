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
import { layoutAllows, PANEL_IDS, registerPanel } from "./app.js";
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
  addSchemeGuide,
  deleteSchemeGuide,
  insertMarkPoint,
  insertOutlinePoint,
  moveSchemeGuide,
  schemeGuides,
  labelOf,
  moveMarkPoint,
  moveOutlinePoint,
  removeMarkPoint,
  removeOutlinePoint,
  styleOf,
  typeKindOf,
  updateMark,
  updateOutline,
} from "./model.js";
import {
  drawHandles,
  drawScheme,
  fitView,
  drawLabelTurn,
  hitHandle,
  hitLabelTurn,
  labelLead,
  hitOutline,
  hitTest,
  labelAngleOf,
  labelTargetOf,
  labelTurnHandle,
  labelBox,
  markRadius,
  outlineLabelBox,
  outlineLabelTurn,
  hitOutlineLabelTurn,
  pathVertexHandles,
  hitPathHandle,
  drawPathHandles,
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
} from "./render.js";
import { canRedo, canUndo, clearHistory, pushCommand, redo, undo } from "./history.js";
import { uiConfirm, uiDialogDepth } from "./panels/ui.js";

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

// Шаг короткого нажатия, экранные пиксели.
const CANVAS_PAN_STEP_PX = 24;
// Сколько клавишу держат, прежде чем начнётся непрерывный ход.
const CANVAS_PAN_HOLD_MS = 180;
// Скорость непрерывного хода в начале и на потолке, пикселей в секунду.
const CANVAS_PAN_SPEED_MIN = 240;
const CANVAS_PAN_SPEED_MAX = 2400;
// За столько разгон доходит до потолка.
const CANVAS_PAN_RAMP_MS = 1300;
// Потолок шага кадра: вкладку свернули на минуту — план не должен улететь.
const CANVAS_PAN_FRAME_MS = 64;
// Во сколько раз «+» и «−» меняют масштаб за нажатие.
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

// ——— колесо и трекпад ————————————————————————————————————————————————
//
// Браузер шлёт двухпальцевый скролл трекпада теми же событиями, что и колесо
// мыши, а различить их надо: колесом заказчик зумит каждый день, двумя пальцами
// привык листать. Цена ошибки несимметрична — сломанный зум мыши хуже, чем
// неузнанный трекпад, — поэтому «листать» включается только по прямой примете
// трекпада, а всё сомнительное остаётся зумом.
//
// Приметы, по порядку надёжности:
// 1. `ctrlKey` — щипок на трекпаде приходит колесом с поднятым ctrlKey (и это
//    же Ctrl+колесо у мыши). Зум всегда, даже посреди прокрутки.
// 2. Строчный и постраничный режимы (`deltaMode` не ноль) шлёт только колесо.
// 3. Горизонтальная составляющая, дробный шаг или шаг мельче щелчка колеса —
//    трекпад. Щелчок колеса — это ровно 100 (Chrome) или 120 пикселей целым
//    числом и без горизонтали.
// 4. Серия: внутри одного жеста решение не меняется. Палец разгоняется, и к
//    середине маха шаги становятся крупными и целыми — по приметам уже колесо;
//    без серии мах переключался бы на зум на полпути.

// Мера масштаба у колеса и у щипка разная, и мерить их одинаково нельзя:
// щелчок колеса — это сразу сто пикселей, а щипок сыплет дробными единицами по
// несколько за кадр. Пока мера была общей, щипок выходил вялым: чтобы
// приблизить, пальцы приходилось сводить долго.
//
// Колесу оставлена прежняя мера — заказчика она устраивает: щелчок меняет
// масштаб примерно на четырнадцать процентов. Щипку дана мера почти в семь раз
// крупнее: жест на треть экрана — это около сотни единиц, и на такой мере он
// приближает вдвое с лишним, как в привычных редакторах на Mac.
const CANVAS_WHEEL_RATE = 0.0015;
const CANVAS_PINCH_RATE = 0.01;
// Потолок одного события: полтора раза. Резкий щипок (а иные драйверы шлют его
// одним крупным событием) иначе перескакивал бы половину диапазона рывком —
// а весь диапазон холста это шестьсот крат, и пройти его должно не меньше чем
// за полтора десятка событий.
const CANVAS_ZOOM_STEP_MAX = 1.5;

// Щипок на трекпаде: колесо с ctrlKey и мелким или дробным шагом. Ctrl с
// колесом мыши шлёт те же ровные сто пикселей — у него своя мера, и разгонять
// его нельзя.
export function canvasPinchWheel(event) {
  if (!event.ctrlKey || event.deltaMode !== 0) return false;
  return !Number.isInteger(event.deltaY) || Math.abs(event.deltaY) < CANVAS_WHEEL_NOTCH_PX;
}

// Во сколько раз событие меняет масштаб. Шаг пропорционален величине жеста:
// пальцы двигают масштаб ровно настолько, насколько их свели.
export function canvasZoomFactor(event, pinch) {
  const step = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY;
  const factor = Math.exp(-step * (pinch ? CANVAS_PINCH_RATE : CANVAS_WHEEL_RATE));
  return Math.min(CANVAS_ZOOM_STEP_MAX, Math.max(1 / CANVAS_ZOOM_STEP_MAX, factor));
}

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

// Текст подсказки над планом — чистая функция от состояния. `null` значит, что
// подсказки нет вовсе. В просмотре она не рассказывает, как ставить метки и
// рисовать контуры: этого здесь нет, и обещать нечего.
export function canvasHintText(state) {
  if (!state || !state.schemeId) return null;
  if (!canvasEditAllowed(state)) return strings.mobile.viewOnly;
  // Правка ломаной — это режим руки, и подсказка обязана сказать, что сейчас
  // делает двойной клик: он здесь занят вершинами, а не выделением.
  if (state.editPathId && state.project) {
    if (findMark(state.project, state.editPathId)) return strings.canvas.hintLineEdit;
    if (findOutline(state.project, state.editPathId)) return strings.canvas.hintOutlineEdit;
  }
  const type = state.project && state.activeTypeId ? findType(state.project, state.activeTypeId) : null;
  const room = state.project && state.activeRoomId ? findRoom(state.project, state.activeRoomId) : null;
  if (state.mode === "room") return text("canvas.hintRoom", { name: room ? room.name : "" });
  const adding = canvasAddKind(state);
  if (adding === "point" && type) return text("canvas.hintPoint", { label: type.code + " — " + type.name });
  if (adding === "line" && type) return strings.canvas.hintLine;
  if (type) return strings.canvas.hintSelectMode;
  return strings.canvas.hintSelect;
}

// Пауза, после которой события колеса считаются новым жестом.
const CANVAS_WHEEL_STREAK_MS = 220;
// Мельче этого шага щелчка у колеса мыши не бывает.
const CANVAS_WHEEL_NOTCH_PX = 40;

// Что делать с событием колеса: `zoom` или `pan`. `streak` — `{kind, time}`
// предыдущего события или `null`.
export function canvasWheelKind(event, streak) {
  if (event.ctrlKey || event.metaKey) return "zoom";
  if (event.deltaMode !== 0) return "zoom";
  if (streak && streak.kind && event.timeStamp - streak.time <= CANVAS_WHEEL_STREAK_MS) return streak.kind;
  const sideways = event.deltaX !== 0;
  const fractional = !Number.isInteger(event.deltaY) || !Number.isInteger(event.deltaX);
  const small = Math.abs(event.deltaY) < CANVAS_WHEEL_NOTCH_PX;
  return sideways || fractional || small ? "pan" : "zoom";
}

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
// Зажатые стрелки: клавиша → время нажатия. Их может быть две сразу — тогда
// план едет по диагонали, как и должен.
// Последнее событие колеса: по нему тянется решение внутри одного жеста.
let canvasWheelStreak = null;
let canvasPanHeld = new Map();
let canvasPanFrame = 0;
let canvasPanClock = 0;

function canvasNow() {
  const clock = typeof performance === "object" && performance !== null ? performance : null;
  return clock && typeof clock.now === "function" ? clock.now() : Date.now();
}

function canvasFrameRequest(fn) {
  return typeof requestAnimationFrame === "function" ? requestAnimationFrame(fn) : setTimeout(fn, 16);
}

function canvasFrameCancel(id) {
  if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(id);
  else clearTimeout(id);
}

function canvasPanBy(dx, dy) {
  const state = canvasState();
  if (!state) return;
  canvasApi.setState({
    view: { ...state.view, offsetX: state.view.offsetX + dx, offsetY: state.view.offsetY + dy },
  });
}

// Клавиатура холста. Стрелки и «+»/«−» холст берёт себе только тогда, когда
// клавиатура ничья: их ждут окно выбора типа и окно цвета (там стрелки ходят
// по колонкам и по полю насыщенности), поля ввода и списки панелей. Диалоги и
// поля отсекаются выше, в canvasKeyDown; здесь остаётся третий случай —
// фокус на кнопке или списке панели. Признак «человек работает с холстом»:
// фокуса нет вовсе (цель события — документ, так и бывает после клика по
// холсту: он фокус не берёт) либо фокус внутри самого холста.
function canvasKeyboardOwner(event) {
  const state = canvasState();
  if (!state || !state.schemeId) return false;
  const target = event.target;
  if (!target || target === document || target === document.body) return true;
  return Boolean(canvasHost && typeof canvasHost.contains === "function" && canvasHost.contains(target));
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
  canvasPanFrame = canvasFrameRequest(canvasPanTick);
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
  canvasFrameCancel(canvasPanFrame);
  canvasPanFrame = 0;
}

// «+» на основном ряду — это Shift и «=», поэтому «=» увеличивает тоже;
// на цифровой клавиатуре свои клавиши. Ноль означает «не про масштаб».
function canvasZoomKey(event) {
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
    guides: canvasDrag && canvasDrag.kind === "pathVertex" ? canvasDrag.guides : null,
    draftColor,
    draftLineStyle: state.activeTypeId ? styleOf(project, state.activeTypeId).lineStyle : "solid",
  });
  const editable = canvasEditAllowed(state);
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
  if (edited) drawPathHandles(canvasCtx, pathVertexHandles(scheme, edited.points, view));

  // Ручки «+» — только у одной выделенной точки: у линии блока не бывает.
  // Ручка поворота подписи — у самой подписи выделенной метки: подпись вдоль
  // стены ставят, глядя на план, а не в панель.
  if (editable && state.selectedMarkIds.length === 1 && !canvasDrag) {
    const target = labelTargetOf(project, scheme, state.selectedMarkIds[0], state.filter);
    const lead = target ? labelLead(project, target) : null;
    drawLabelTurn(
      canvasCtx,
      labelTurnHandle(project, scheme, target, view, state.filter),
      styleOf(project, lead && lead.typeId).color,
    );
  }
  if (editable && state.selectedMarkIds.length === 1 && !canvasDrag) {
    const mark = findMark(project, state.selectedMarkIds[0]);
    if (mark && mark.kind === "point" && mark.schemeId === scheme.id) {
      drawHandles(canvasCtx, scheme, mark, view, canvasHandleColor(state, mark));
    }
  }
  // Линейка — последней: она поверх всего, и с неё тянут направляющие.
  if (guidesOn) drawRuler(canvasCtx, scheme, view, box);
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
      // Точка липнет к направляющим — ради этого их и ставят: «6 вертикальных,
      // 2 горизонтальных и на перекрестия ставишь точки».
      points: [canvasGuideSnap(plan)],
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

// Куда сядет вершина, которую тащат. Правка вершины ничем не отличается от
// рисования: тот же магнит направления и те же направляющие по вершинам этой
// же ломаной. Опора — соседняя вершина: от неё и считается угол.
function canvasVertexSnap(path, index, target, free) {
  const state = canvasState();
  const scheme = canvasScheme(state);
  const points = path.points || [];
  if (points.length < 2) return { point: target, guides: [] };
  const anchor = index > 0 ? index - 1 : path.closed ? points.length - 1 : 1;
  const sources = points.filter((item, at) => at !== index && at !== anchor);
  const snap = draftSnap([...sources, points[anchor]], target, scheme, canvasViewOf(state), {
    free: Boolean(free),
    planGuides: canvasSchemeGuides(state, scheme),
  });
  return { point: snap.point, guides: snap.guides || [] };
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
// Первая вершина не притягивается: тянуть её не от чего.
function canvasDraftSnap(plan, free) {
  if (!canvasDraft || canvasDraft.points.length === 0) return { point: plan, snapped: false, guides: [] };
  const state = canvasState();
  const scheme = canvasScheme(state);
  return draftSnap(canvasDraft.points, plan, scheme, canvasViewOf(state), {
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

function canvasDraftClick(plan, screen, free) {
  const state = canvasState();
  if (!canvasDraft) {
    // Черновик помнит, чем его начали: ломаной линейного типа или контуром
    // помещения. По этой памяти его и заканчивают, когда режим или вид типа
    // сменились на ходу, — тип берётся тот, которым рисовали, а не тот,
    // который выбран сейчас.
    canvasDraft = {
      kind: state.mode === "room" ? "room" : "line",
      typeId: state.mode === "room" ? null : state.activeTypeId,
      projectId: state.project ? state.project.id : null,
      points: [plan],
      cursor: plan,
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
  const threshold = markRadius(view) + 6;
  const points = canvasDraft.points;
  const last = planToScreen(points[points.length - 1], scheme, view);
  const first = planToScreen(points[0], scheme, view);
  // Клик по последней или первой вершине ничего не добавляет: это первая
  // половина двойного клика, который завершает или замыкает линию.
  if (Math.hypot(screen.x - last.x, screen.y - last.y) <= threshold) return;
  if (points.length >= 2 && Math.hypot(screen.x - first.x, screen.y - first.y) <= threshold) return;
  points.push(snap.point);
  canvasDraft.cursor = snap.point;
  canvasDraft.snapped = false;
  // Вершина поставлена — подсказки гаснут до следующего движения руки: висеть
  // им не над чем, курсор стоит ровно на только что поставленной точке.
  canvasDraft.guides = [];
  canvasRedraw();
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

// Чем должен быть черновик при нынешнем состоянии: ломаной, контуром или
// ничем. Одно место на весь холст — режим, тип и вид типа спрашиваются здесь.
function canvasDraftWanted(state) {
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

  // В режиме просмотра открыты только две двери: выделить метку, чтобы прочитать
  // её поля, и возить план. Всё остальное — правка, и начинаться она не должна:
  // ни ручки блока, ни черновика, ни перетаскивания.
  const editable = canvasEditAllowed(state);

  if (editable && state.selectedMarkIds.length === 1) {
    const target = labelTargetOf(state.project, scheme, state.selectedMarkIds[0], state.filter);
    if (target && hitLabelTurn(state.project, scheme, target, point, view, state.filter)) {
      canvasRotateLabel(state.selectedMarkIds[0]);
      canvasDrag = { kind: "done", start: point, moved: false };
      return;
    }
  }

  if (editable && state.selectedOutlineId) {
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

  // Вершина правимого пути важнее клика по самому объекту: пока ручки видны,
  // за вершину тащат её одну, а не всю линию и не весь контур.
  const editedPath = editable ? canvasEditedPath(state, scheme) : null;
  if (editedPath) {
    const handle = hitPathHandle(pathVertexHandles(scheme, editedPath.points, view), point);
    if (handle) {
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
  }

  // Ручка «+» важнее всего остального: она и есть быстрый путь.
  if (editable && state.selectedMarkIds.length === 1) {
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

  // Ломаную рисует режим добавления с линейным типом; контур помещения — свой
  // режим. Жест у них один, и дальше он разбирается по `canvasDrag.kind`.
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
      canvasDrag = { kind: "pan", start: point, view: { ...state.view }, moved: false };
      return;
    }
    canvasDrag = {
      kind: hit.part === "label" ? "label" : "mark",
      markId: hit.markId,
      groupId: hit.groupId,
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
    kind: canvasAddKind(state) === "point" && editable ? "place" : "empty",
    start: point,
    view: { ...state.view },
    moved: false,
  };
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
      const size = view.markSize || 10;
      const seen = target ? labelBox(before, scheme, target, view, state.filter) : null;
      const base = seen ? { dx: seen.dx, dy: seen.dy } : { dx: size * 1.5, dy: 0 };
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
      const points = shifted.map((item) => ({ x: item.x + fix.x, y: item.y + fix.y }));
      canvasPreview = updateMark(before, canvasDrag.markId, { points }).project;
    }
  } catch (error) {
    // Модель отказала на полпути — картинка замерла бы под рукой, а по
    // отпусканию перенос потерялся бы молча. Пусть скажет, в чём дело.
    canvasPreview = null;
    canvasFail(error);
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
    const snap = canvasDraftSnap(screenToPlan(point, scheme, canvasViewOf(state)), event.altKey);
    canvasDraft.cursor = snap.point;
    canvasDraft.snapped = snap.snapped;
    canvasDraft.guides = snap.guides || [];
    canvasRedraw();
  }
  if (!canvasDrag) return;
  const shift = Math.hypot(point.x - canvasDrag.start.x, point.y - canvasDrag.start.y);
  if (shift > CANVAS_DRAG_SLOP) canvasDrag.moved = true;
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
  if (["mark", "label", "outlineLabel", "pathVertex"].includes(canvasDrag.kind)) {
    canvasDragTo(point, event.altKey);
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
  if (drag.moved) {
    if ((drag.kind === "mark" || drag.kind === "label") && canvasPreview) {
      const label = drag.kind === "label" ? strings.history.moveLabel : strings.history.move;
      const after = canvasPreview;
      canvasPreview = null;
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

  if (event.pointerType === "touch" || drag.kind === "done") return;
  const scheme = canvasScheme(state);
  const plan = screenToPlan(point, scheme, canvasViewOf(state));
  if (drag.kind === "line") {
    canvasLineClick(plan, point, event.altKey);
    return;
  }
  if (drag.kind === "room") {
    canvasOutlineClick(plan, point, event.altKey);
    return;
  }
  if (drag.kind === "place") {
    canvasPlacePoint(plan);
    return;
  }
  if (drag.kind === "empty" && (state.selectedMarkIds.length > 0 || state.selectedOutlineId || state.editPathId)) {
    canvasApi.setState({ selectedMarkIds: [], selectedOutlineId: null, editPathId: null });
  }
}

function canvasDoubleClick(event) {
  const state = canvasState();
  if (!canvasEditAllowed(state)) return;
  const scheme = canvasScheme(state);
  const view = canvasViewOf(state);
  // Двойной клик по линейке ставит направляющую в точке клика — это второй
  // способ к перетаскиванию, и просил его пользователь: «двойной клик по
  // линейке должен создавать линию».
  if (canvasGuidesShown(state)) {
    const at = canvasPointOf(event);
    const axis = rulerAxis(at);
    if (axis) {
      event.preventDefault();
      canvasGuideAdd(axis, canvasGuideAt(axis, at, scheme, view));
      return;
    }
  }
  // Правка пути — один жест на ломаную метки и на контур помещения. Двойной
  // клик по объекту включает правку, по вершине — убирает её, по сегменту или
  // стенке — добавляет новую в точке клика. Пользователь: «у линий при
  // выделении позволь редактировать её, например двойным кликом на линию» и
  // «двойной клик по контуру комнаты — тоже давай править его».
  if (state.mode === "select") {
    const at = canvasPointOf(event);
    const plan = screenToPlan(at, scheme, view);
    const edited = canvasEditedPath(state, scheme);
    if (edited) {
      const handle = hitPathHandle(pathVertexHandles(scheme, edited.points, view), at);
      if (handle) {
        event.preventDefault();
        canvasPathVertexRemove(edited, handle.index);
        return;
      }
    }
    // Метка важнее контура — тот же порядок, что у одиночного клика.
    const hit = hitTest(state.project, scheme, at, view, state.filter);
    if (hit && edited && edited.kind === "mark" && hit.markId === edited.id && hit.part === "line") {
      event.preventDefault();
      canvasPathVertexInsert(edited, hit.index, plan);
      return;
    }
    if (hit && hit.part !== "label") {
      const mark = findMark(state.project, hit.markId);
      if (mark && mark.kind === "line" && (!edited || hit.markId !== edited.id)) {
        event.preventDefault();
        canvasEditPath("mark", mark.id);
        return;
      }
    }
    if (!hit && canvasGuidesShown(state)) {
      const guide = hitSchemeGuide(canvasSchemeGuides(state, scheme), at, scheme, view);
      if (guide) {
        event.preventDefault();
        canvasGuideRemove(guide.id);
        return;
      }
    }
    if (!hit) {
      const outlineHit = hitOutline(state.project, scheme, at, view, state.filter, null);
      if (outlineHit && outlineHit.part === "edge") {
        event.preventDefault();
        if (edited && edited.kind === "outline" && edited.id === outlineHit.outlineId) {
          canvasPathVertexInsert(edited, outlineHit.index, plan);
        } else {
          canvasEditPath("outline", outlineHit.outlineId);
        }
        return;
      }
    }
  }
  // Двойной клик по подписи возвращает её на место — там же, где её и таскают:
  // в рисовании линии и контура двойной клик занят завершением ломаной.
  const drawing = state.mode === "room" || canvasAddKind(state) === "line";
  if (!drawing && canvasResetLabel(canvasPointOf(event))) {
    event.preventDefault();
    return;
  }
  if ((canvasAddKind(state) !== "line" && state.mode !== "room") || !canvasDraft) return;
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
  const kind = canvasWheelKind(event, canvasWheelStreak);
  canvasWheelStreak = { kind, time: event.timeStamp };
  if (kind === "pan") {
    // Листаем как прокрутка — в ту же сторону, что и стрелки: жест вниз
    // показывает то, что ниже, поэтому содержимое уезжает вверх.
    canvasPanBy(-event.deltaX, -event.deltaY);
    return;
  }
  canvasZoomAt(canvasPointOf(event), canvasZoomFactor(event, canvasPinchWheel(event)));
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
  // Ход и масштаб — до всего остального, но только когда клавиатура ничья.
  if (canvasKeyboardOwner(event)) {
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
  if (event.code === "Space") {
    canvasSpace = true;
    if (canvasNode) canvasNode.style.cursor = "grab";
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
  canvasSpace = false;
  canvasSyncCursor();
}

// Окно увели — зажатые клавиши отпустить некому: своего keyup они уже не
// пришлют, и план уехал бы дальше сам по себе.
function canvasWindowBlur() {
  canvasPanRelease(null);
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
    window.addEventListener("blur", canvasWindowBlur);
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
    // Режим, выбранный тип и его вид в справочнике — всё это меняет то, что
    // рисует рука. Черновик подтягивается к новому положению дел здесь, в
    // одном месте, а не на каждой кнопке, которая что-то из этого правит.
    if ("mode" in changed || "activeTypeId" in changed || "project" in changed) canvasSyncDraft(state);
    if ("mode" in changed) canvasSyncCursor();
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
    const value = canvasHintText(state);
    // Условие показа живёт здесь, а не в чужих стилях: подсказки нет, когда
    // нечего подсказывать, а в просмотре она говорит про просмотр.
    hint.hidden = value === null;
    if (value === null) return;
    hint.textContent = value;
    const type = state.project && state.activeTypeId ? findType(state.project, state.activeTypeId) : null;
    const room = state.project && state.activeRoomId ? findRoom(state.project, state.activeRoomId) : null;
    if (!canvasEditAllowed(state)) hint.style.borderColor = "";
    else if (state.mode === "room" && room) hint.style.borderColor = room.color;
    else if (type) hint.style.borderColor = styleOf(state.project, type.id).color;
  };
  api.subscribe((state, changed) => {
    if (
      "mode" in changed ||
      "activeTypeId" in changed ||
      "activeRoomId" in changed ||
      "schemeId" in changed ||
      "layout" in changed ||
      // Правка ломаной — такой же режим руки, как «Добавление»: началась или
      // закончилась, и подсказка обязана это сказать.
      "editPathId" in changed ||
      "project" in changed
    ) {
      render();
    }
  });
  render();
}

registerPanel(PANEL_IDS.canvas, mountCanvas);
registerPanel(PANEL_IDS.overlay, mountCanvasHint);
