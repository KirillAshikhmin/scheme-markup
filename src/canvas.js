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
  DEFAULT_MARK_SIZE,
  OUTLINE_MIN_POINTS,
  addMark,
  addOutline,
  addToGroup,
  applyRoomOutlines,
  blockStepPx,
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
  extendMarkLine,
  insertMarkPoint,
  insertOutlinePoint,
  moveSchemeGuide,
  schemeGuides,
  labelOf,
  linkedMarkIds,
  markSnapshot,
  pasteMark,
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
  drawLabelLeaderSwitch,
  hitHandle,
  hitLabelTurn,
  hitLabelLeader,
  labelLeaderHandle,
  labelLeaderHolder,
  labelLeaderShown,
  markLinks,
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
  pathEditHandles,
  samePathHandle,
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
import { getSetting, setSetting } from "./store.js";
import { uiConfirm, uiDialogDepth, uiEl, uiIcon } from "./panels/ui.js";

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
  if (adding === "point" && type) {
    return canvasHintCopy(text("canvas.hintPoint", { label: type.code + " — " + type.name }));
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

// ——— подсказка: отступ от края и знак «текст сменился» ————————————————
//
// Линейка (таск 59) занимает полосу в `RULER_SIZE` пикселей сверху и слева
// холста, и подсказка, стоявшая в самом углу, наехала на неё. Отступ считается
// здесь, а не в стилях: линейку прячут отметкой в «Размерах», и вместе с ней
// обязан уходить отступ — иначе подсказка висит с пустым полем сверху.
export function canvasHintInset(state) {
  return canvasGuidesShown(state) ? RULER_SIZE : 0;
}

// Текст подсказки меняется по ходу работы и иногда говорит важное («второй Esc
// возвращает в „Выделение“»). Когда подсказка свёрнута, разворачивать её за
// пользователя нельзя: он свернул её осознанно, и она выпрыгивала бы под рукой
// на каждую смену типа — ровно то, от чего он избавился. Но и молча съесть
// новый текст нельзя, поэтому кнопка получает точку и другую подпись.
//
// `seen` — текст, который пользователь видел последним (подсказка была
// развёрнута). Ничего не видел — знака нет: точка на первой же подсказке после
// перезагрузки была бы шумом.
export function canvasHintUnseen(seen, current) {
  if (seen === null || current === null) return false;
  return seen !== current;
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

// Переключение. Возвращает обещание: браузер вправе отказать, и отказ надо
// показать, а не проглотить.
function canvasFullscreenToggle(doc, element) {
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
let canvasHintCollapsed = false;
let canvasHintSeen = null;

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
// Размер плана, по которому считается шаг, пока схема не знает своих пикселей.
const CANVAS_PLAN_FALLBACK_PX = 1000;
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
// Буфер метки: снимок из `markSnapshot` плюс имя исходной метки — по нему
// вставка находит, рядом с чем встать, когда курсора над планом нет.
let canvasClipboard = null;
// Последняя точка курсора на холсте в экранных пикселях. `null` значит, что
// курсор ушёл с холста: тогда вставка целится не под него.
let canvasCursor = null;
// Серия вставок подряд: `{schemeId, x, y, count}`. Пока вставляют в то же
// место, каждая следующая копия отступает на шаг — иначе метки лягут стопкой.
let canvasPasteRun = null;
// Ручка правимого пути под курсором: по ней бледная ручка разбивки становится
// точкой. Живёт в кадре, а не в состоянии сеанса: наведение мышью — не то, что
// стоит гонять через `setState` и подписчиков панелей.
let canvasHoverHandle = null;
// Вершина, которую сию минуту поставила ручка: `{id, index, at}`. Нужна ровно
// для одного — чтобы двойной клик по ручке разбивки не убирал ту вершину,
// которую сам только что и поставил (первый клик ставит, второй попадает уже
// по ней). Смотри `canvasDoubleClick`.
let canvasFreshVertex = null;
// Столько времени вершина считается «только что поставленной».
const CANVAS_FRESH_VERTEX_MS = 600;

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
    guides: canvasDrag && (canvasDrag.kind === "pathVertex" || canvasDrag.kind === "pathAdd") ? canvasDrag.guides : null,
    // Готовый кадр связей, а не `true`: холст считает их из того же
    // промежуточного объекта, что и метки, — иначе дуга отстанет от метки,
    // которую ведут мышью. Выгрузка передаёт сюда `true` и считает сама.
    links: canvasFrameLinks(state, canvasPreview, scheme),
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
    x: px / (scheme && scheme.width > 0 ? scheme.width : CANVAS_PLAN_FALLBACK_PX),
    y: px / (scheme && scheme.height > 0 ? scheme.height : CANVAS_PLAN_FALLBACK_PX),
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

// Общий показ связей: отметка в шапке. Умолчание — «нет». Это не значит, что
// связей не видно вовсе: выключенный переключатель оставляет связи выделенной
// метки (см. `canvasFrameLinks`).
function canvasLinksShown(state) {
  return Boolean(state && state.linksShown === true);
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
    // Вторая ручка того же ряда: поводок подписи. Стоит вплотную к повороту,
    // поэтому и проверяется здесь же, сразу за ним.
    if (target && hitLabelLeader(state.project, scheme, target, point, view, state.filter)) {
      canvasToggleLabelLeader(state.selectedMarkIds[0]);
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
      const side = hitHandle(scheme, selected, point, view);
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
  if (canvasHoverUpdate(state, point)) canvasRedraw();
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
  if (["mark", "label", "outlineLabel", "pathVertex", "pathAdd"].includes(canvasDrag.kind)) {
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
        // Вершина, которую первый клик этого же двойного только что поставил
        // ручкой, не убирается вторым: жест «ткнуть в ручку дважды» иначе
        // ставил бы вершину и тут же её снимал, оставляя два шага истории и
        // ничего на плане.
        if (!canvasVertexIsFresh(edited.id, handle.index)) canvasPathVertexRemove(edited, handle.index);
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

// Выделенный на странице текст: пока он есть, Ctrl+C принадлежит браузеру.
function canvasTextSelected() {
  if (typeof window === "undefined" || typeof window.getSelection !== "function") return false;
  const selection = window.getSelection();
  return Boolean(selection && selection.isCollapsed === false && String(selection).length > 0);
}

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
  // Q — тоже физическая клавиша: в русской раскладке это «й», и сравнение по
  // `event.key` молчало бы ровно у тех, кто размечает планы по-русски.
  if (event.code === "KeyQ" && !event.altKey) {
    event.preventDefault();
    canvasPickType();
    return;
  }
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

// Курсор ушёл с холста — вставке больше не под что целиться: она встанет рядом
// с исходной меткой. Без этого запомненная точка оставалась бы «последней
// известной», и копия садилась бы туда, где мыши давно нет.
function canvasPointerLeave() {
  canvasCursor = null;
  // Курсора над планом нет — и подсвеченной ручки быть не должно: иначе она
  // осталась бы гореть на последнем месте, где мышь ушла с холста.
  if (canvasHoverHandle) {
    canvasHoverHandle = null;
    canvasRedraw();
  }
}

// Окно увели — зажатые клавиши отпустить некому: своего keyup они уже не
// пришлют, и план уехал бы дальше сам по себе. Курсор за это время тоже мог
// уехать куда угодно, и его последняя точка больше ничего не значит.
function canvasWindowBlur() {
  canvasPanRelease(null);
  canvasSpace = false;
  canvasCursor = null;
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
  canvasNode.addEventListener("pointerleave", canvasPointerLeave);
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
    const unseen = canvasHintCollapsed && canvasHintUnseen(canvasHintSeen, value);
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
      if (state.mode === "room" && room) color = room.color;
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
    class: "canvas-full",
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
    // Кнопка живёт над планом: без открытой схемы разворачивать нечего, и в
    // пустом холсте она была бы единственной вещью на экране.
    const shown = Boolean(state.schemeId) && !denied && canvasFullscreenSupported(doc, target);
    button.hidden = !shown;
    if (!shown) return;
    const on = canvasFullscreenOn(doc);
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
    if ("schemeId" in changed || "guidesShown" in changed || "layout" in changed) render();
  });
  // Из полного экрана выходят и мимо кнопки: Esc, жест, системная кнопка. Своё
  // состояние кнопка не помнит, но перерисоваться обязана — иначе на обратно
  // свёрнутом окне у неё останется значок «свернуть».
  if (doc) {
    for (const name of FULLSCREEN_EVENTS) doc.addEventListener(name, render);
  }
  render();
}

// Поверх холста живут двое: подсказка слева и полный экран справа. Точка
// монтирования одна, поэтому и монтируются они вместе — панель чистит поле
// один раз, а не каждый за себя.
function mountCanvasOverlay(host, api) {
  host.replaceChildren();
  mountCanvasHint(host, api);
  mountCanvasFullscreen(host, api);
}

registerPanel(PANEL_IDS.canvas, mountCanvas);
registerPanel(PANEL_IDS.overlay, mountCanvasOverlay);
