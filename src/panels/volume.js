// Окно объёмного режима: комната, по которой ходят.
//
// Требование G205, шаг первый (таск 146). Слова заказчика: «просто открывается
// окно, где можно перемещаться по комнатам… суть как в игре».
//
// Счёт — в `src/volume.js` (сцена, камера, затенение, порядок граней,
// столкновения). Здесь окно, клавиши, мышь и кадр: окно ничего не считает
// само, иначе арифметика разошлась бы с той, что проверена тестами.
//
// ——— что это окно не делает ————————————————————————————————————————————
//
// **В объект не пишет ничего** (G68). Объёмный режим читает чертёж и метки и
// только: ни правок, ни шагов истории, ни новых полей. Открыть и закрыть его у
// любого объекта — ноль изменений.
//
// Единственное, что окно меняет наружу, — **выделение** (таск 148), и это не
// оговорка к правилу, а другое место: выделенные метки живут в состоянии
// сеанса рядом с масштабом и фильтром, в объект и в файл проекта они не
// попадают никогда. Заказчик попросил прямо: «выделил в объёме — выделено и в
// списке, и наоборот», — а два выделения, живущие врозь, и есть та потеря, от
// которой он предостерегал.
//
// Этажи, лестница, сенсорное управление и снимок вида — таск 149, и к правилу
// выше они ничего не добавляют: этаж схемы правится **не здесь** (поле стоит в
// мастерской чертежа, где у схемы правят её величины), переход по лестнице
// меняет показываемую схему, а не объект, а снимок — картинку в папке загрузок.
//
// ——— окно открывается обзором ———————————————————————————————————————————
//
// Не от первого лица, хотя первое лицо — главный вид. Заказчик: обзор нужен
// потому, что «без него не понять, где стоишь», а «показать заказчику»
// начинается с общего вида. Поэтому первый кадр — вся схема сверху, а человек
// переходит к первому лицу, уже зная, куда попал.
import { PANEL_IDS, layoutAllows, registerPanel } from "../app.js";
import {
  FULLSCREEN_EVENTS,
  canvasFrameLinks,
  canvasFullscreenLabel,
  canvasFullscreenOn,
  canvasFullscreenSupported,
  canvasFullscreenToggle,
  canvasHintInset,
  canvasHintUnseen,
} from "../canvas.js";
import { exportDownload, exportFileName, viewPng } from "../exporter.js";
import { MARK_BOX_FRAME_DEPTH_MM, MARK_BOX_FRAME_MM } from "../markBox.js";
import { findRoom, findScheme, schemeFloorOf } from "../model.js";
import { drawDrawing, drawingUnitBridge, visibleMarks } from "../render.js";
import { getSetting, setSetting } from "../store.js";
import { strings, text } from "../strings.js";
import {
  VOLUME_AROUND_NEAR_MM,
  VOLUME_AROUND_PITCH_DEG,
  VOLUME_EYE_MM,
  VOLUME_HEIGHT_FALLBACK_MM,
  VOLUME_LOOK_DEG_PX,
  VOLUME_MARK_NO_PLACE,
  VOLUME_MARK_NO_POINT,
  VOLUME_MARK_NO_SIZE,
  VOLUME_MARKER_RGB,
  VOLUME_PITCH_MAX_DEG,
  VOLUME_RUN_MM_S,
  VOLUME_START_PITCH_DEG,
  VOLUME_WALK_MM_S,
  VOLUME_TIGHT_MM,
  volumeAroundCamera,
  volumeAroundDistance,
  volumeAroundFit,
  volumeAroundPitch,
  volumeFreeMm,
  volumeBasis,
  volumeDoorAt,
  volumeDraw,
  volumeDrawBackdrop,
  volumeFloorAt,
  volumeFloors,
  volumeFrame,
  volumeLinkLines,
  volumeMarkAnchor,
  volumeMarkPlace,
  volumeMarkerFaces,
  volumeMoveTo,
  volumePickAt,
  volumeSightAt,
  volumeRoomAt,
  volumeScene,
  volumeDrawn,
  volumeSelectLines,
  volumeStairNear,
  volumeStart,
  volumeStep,
} from "../volume.js";
import { markCardModel, markCardParts } from "./markCard.js";
import { uiButton, uiDialogDepth, uiEl, uiIcon, uiIconButton, uiModal } from "./ui.js";

// Окно одно: второе показывало бы ту же сцену второй камерой и сжирало бы
// кадры у первого. То же правило, что у мастерской.
let volumeOpened = false;

// ——— подсказка плашкой (G218) ————————————————————————————————————————————
//
// Слова заказчика: «подсказку по управлению сделай в виде как на схеме —
// кнопочка справа сверху, которую закрывать можно».
//
// Механизм взят у холста целиком: те же классы (`canvas-hint`,
// `canvas-hint__text`, `canvas-hint__toggle`, `is-collapsed`), та же точка на
// кнопке при сменившемся тексте (`canvasHintUnseen`, `is-new`) и те же подписи.
// Второго поведения не заводится — у человека одна рука на обе поверхности.
//
// **Настройка своя**, отдельная от холста: подсказки разные, и свернув одну, он
// не просил сворачивать другую. Свёрнутость живёт там же, где у холста, — в
// настройках браузера, то есть переживает закрытие окна и перезагрузку.
const VOLUME_HINT_SETTING = "volumeHintCollapsed";
let volumeHintCollapsed = false;
// Текст, который человек видел последним развёрнутым. Модульная, а не оконная:
// закрыл и открыл окно — подсказка та же, и мигать точкой ей незачем.
let volumeHintSeen = null;

/** Клавиша → куда шагаем: вперёд/назад и в сторону, в осях камеры. */
export function volumeKeyMove(code) {
  if (code === "KeyW" || code === "ArrowUp") return { forward: 1, side: 0, turn: 0 };
  if (code === "KeyS" || code === "ArrowDown") return { forward: -1, side: 0, turn: 0 };
  if (code === "KeyA") return { forward: 0, side: -1, turn: 0 };
  if (code === "KeyD") return { forward: 0, side: 1, turn: 0 };
  // Стрелки влево-вправо вертят, а не ходят: без мыши повернуться иначе нечем,
  // а боком ходят по A и D, как привыкли.
  //
  // **Q и E поворот больше не делают** (G207): E заказчик отдал двери, а Q
  // оставлять в одиночестве нельзя — пара «Q влево, E вправо» тем и была
  // хороша, что симметрична, а один Q читался бы как опечатка. Поворот остался
  // у стрелок, которыми его и делают без мыши.
  if (code === "ArrowLeft") return { forward: 0, side: 0, turn: -1 };
  if (code === "ArrowRight") return { forward: 0, side: 0, turn: 1 };
  return null;
}

/**
 * Клавиши дверей (G207, G210). Вынесены сюда, чтобы о них можно было спросить
 * тестом, а не читать обработчик.
 *
 * **E — дверь под рукой**, прямое слово заказчика. **R — все двери разом**, и
 * выбор объясним: R не занят ничем, лежит на той же строке клавиатуры, под тем
 * же пальцем, что E, а спутать их не страшно — обе правки живут в сеансе, обе
 * обратимы тем же нажатием, и ни одна не касается объекта (G68). Соседние
 * буквы, которые пришлось отвергнуть: W A S D и Shift ходят, V меняет вид, F
 * вписывает схему, Q отдан вместе с E (см. `volumeKeyMove`).
 */
export const VOLUME_DOOR_KEY = "KeyE";
export const VOLUME_DOORS_KEY = "KeyR";

/**
 * На что подействует **E** (G214): «нажатием на E на выключатель он должен
 * выделяться».
 *
 * Одна клавиша — одно правило: **E действует на то, на что смотришь**. Дверь
 * открывает или закрывает, вещь — выделяет. Спор, если под прицелом и то и
 * другое, решает **точность попадания**, а не вид:
 *
 *   1. вещь, в которую попали **точно**, старше двери. Вещь мелкая, и попасть
 *      в неё можно только нарочно; дверное полотно занимает полкадра, и под
 *      прицелом оно оказывается заодно, а не по желанию;
 *   2. дверь старше вещи, в которую попали **с запасом** (`VOLUME_PICK_SLACK_PX`,
 *      розетка в трёх метрах — десяток точек экрана): целились в дверь, а
 *      розетка рядом просто попала в запас;
 *   3. и только если двери нет вовсе — вещь с запасом.
 *
 * Дверь приходит уже выбранной (`door`): это дверь под прицелом или та, по
 * которой щёлкнули раньше (G207) — у неё своё правило запаса, и второго здесь
 * не заводится.
 *
 * Чистая и вынесена наружу: правило, записанное внутри обработчика клавиши, не
 * проверяется ничем.
 */
export function volumeAimChoice({ markExact, door, markNear }) {
  if (markExact) return { kind: "mark", id: markExact };
  if (door) return { kind: "door", id: door };
  if (markNear) return { kind: "mark", id: markNear };
  return { kind: "none", id: null };
}

/**
 * Alt он же Option (G211). Проверяется и по `key`, и по `code`: на Mac Option —
 * модификатор ввода, и браузер, отдающий `key` вида «Dead» для следующей
 * клавиши, сам Alt всё равно называет Alt'ом.
 */
export function volumeAltKey(event) {
  return event.key === "Alt" || event.code === "AltLeft" || event.code === "AltRight";
}

/**
 * Какие двери открыты после нажатия «все двери».
 *
 * Правило: **есть хоть одна закрытая — открываются все, иначе закрываются
 * все.** В тикете сказано «открывает все закрытые и закрывает все открытые», и
 * буквальное прочтение (вывернуть каждую наизнанку) здесь неверно: из
 * вперемешку открытых дверей оно даёт другую смесь и никогда — «все закрыты»,
 * то есть одной клавишей нельзя вернуться ни к одному из двух состояний,
 * которые заказчик называл словами «открыть и закрыть все двери».
 */
export function volumeDoorsAfterAll(doors, open) {
  const list = doors || [];
  const closed = list.filter((id) => !open.has(id));
  return closed.length > 0 ? list : [];
}

/** Наклон взгляда не заводится за отвес: вверх ногами смотреть незачем. */
export function volumeClampPitch(radians) {
  const limit = (VOLUME_PITCH_MAX_DEG * Math.PI) / 180;
  return Math.max(-limit, Math.min(limit, radians));
}

/**
 * Подпись места: имя помещения, в котором стоит человек, или честное «вне
 * помещений». Отдельной функцией — её проверяет тест: строка, собранная в
 * обработчике кадра, не проверяется ничем.
 */
export function volumeWhere(project, scene, at) {
  const room = volumeRoomAt(scene, at);
  const found = room && room.roomId ? findRoom(project, room.roomId) : null;
  const place = found ? text("volume.inRoom", { name: found.name }) : strings.volume.outside;
  // Упёрлись носом в стену — об этом говорится словом, а не исправляется за
  // человека: в санузле 1,4 × 1,6 м кадр честно показывает сорок сантиметров
  // стены, и подсказать тут можно только выход — обзор.
  if (volumeFreeMm(scene.solids, at.x, at.y) < VOLUME_TIGHT_MM) return place + " · " + strings.volume.tight;
  return place;
}

/**
 * Место миникарты в поле (G212) или `null`, если показывать её негде.
 *
 * Левый нижний угол — слово заказчика. Пятая часть ширины поля, но не меньше
 * 110 и не больше 220 точек: мельче плана не разобрать, крупнее — накладка
 * начинает спорить с кадром. Высота идёт по пропорции чертежа и зажата третью
 * высоты поля — вытянутая вверх квартира иначе дала бы полосу во весь бок.
 *
 * **На узком или низком поле миникарты нет вовсе.** Это и есть ответ на «проверь,
 * что не загораживает вид»: накладка в треть кадра загораживает его по
 * определению, и честнее не показывать её, чем показывать поверх комнаты.
 */
export function volumeMinimapBox(box, bounds) {
  if (!bounds || !(bounds.widthMm > 0) || !(bounds.heightMm > 0)) return null;
  if (box.width < 520 || box.height < 320) return null;
  const width = Math.max(110, Math.min(220, box.width * 0.2));
  const height = Math.max(70, Math.min(box.height * 0.3, (width * bounds.heightMm) / bounds.widthMm));
  return { x: 14, y: box.height - height - 14, width, height };
}

// ——— сенсорное управление (таск 149) ——————————————————————————————————
//
// «Нужно планшетное управление, если зашли с планшета или смартфона».
// Заказчик смотрит с восьмидюймового.
//
// Разложено так: **палец по полю вертит головой** (это уже умеет перетаскивание
// мыши — события указателя одни и те же, и трогать его не пришлось), а ходит
// **площадка в углу поля**: вверх-вниз — шаг вперёд и назад, влево-вправо —
// поворот.
//
// Почему поворот, а не шаг боком, как у A и D: одного пальца должно хватать на
// всё. Ходьба без поворота — это ходьба в стену; боковой шаг, наоборот,
// удобство, и на планшете его просто нет. Поворот есть в критериях приёмки
// («ходьба и поворот пальцем»), шаг боком — нет.
//
// Площадка стоит **справа внизу**, хотя в играх ход обычно под левым большим
// пальцем. Причина простая: левый нижний угол отдан миникарте прямым словом
// заказчика (G212), и двигать её ради привычки нельзя. Поворот при этом
// остаётся у любого пальца на любом месте поля, так что левая рука без дела не
// остаётся.
//
// **С жестами холста не дерётся** нигде: окно — своя точка монтирования со
// своим `touch-action: none`, панорама и щипок плана живут на `#canvas-host`
// под затемнением диалога и событий не видят вовсе. А внутри окна два жеста
// разведены по месту: начавшееся на площадке касание поворотом не становится
// никогда — площадка забирает указатель себе.

/** Мёртвая зона площадки: доля радиуса, в которой палец ещё стоит на месте. */
export const VOLUME_PAD_DEAD = 0.18;

/**
 * Куда ведёт палец на площадке: `{forward, turn}` от −1 до 1.
 *
 * Величина растёт от края мёртвой зоны к краю площадки: тронул слегка — идёшь
 * шагом, увёл до края — бежишь. Дальше края не считается — палец, уехавший за
 * площадку, значит то же, что палец на её краю.
 */
export function volumePadVector(dx, dy, radius) {
  const reach = radius > 0 ? radius : 1;
  const dead = reach * VOLUME_PAD_DEAD;
  const length = Math.hypot(dx, dy);
  if (!(length > dead)) return { forward: 0, turn: 0 };
  const power = Math.min(1, (length - dead) / (reach - dead)) / length;
  return { forward: -dy * power, turn: dx * power };
}

/**
 * Похоже ли, что сюда зашли пальцем. Это только **первая** догадка, по которой
 * площадка видна сразу: настоящий ответ даёт первое касание (`pointerType`), и
 * мышь площадки не увидит никогда.
 */
export function volumeTouchLikely() {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  try {
    return window.matchMedia("(pointer: coarse)").matches;
  } catch (error) {
    return false;
  }
}

/** Сколько неразмещённых меток окно называет по имени, прежде чем сказать «и ещё». */
export const VOLUME_UNPLACED_SHOWN = 8;

/** Почему вещь не встала в объём — словом. */
export function volumeUnplacedReason(reason) {
  if (reason === VOLUME_MARK_NO_SIZE) return strings.volume.unplacedNoSize;
  if (reason === VOLUME_MARK_NO_POINT) return strings.volume.unplacedNoPoint;
  return strings.volume.unplacedNoPlace;
}

/**
 * Строка «не размещены» (таск 148).
 *
 * Заказчик решил прямо: метке, у которой нет ни привязки, ни высоты, места не
 * выдумывать — но и терять её молча нельзя. Поэтому список стоит под полем,
 * зовёт метки по обозначению и у каждой называет причину: по ней видно, чего
 * не хватает объекту, а не сборке. Длинный список обрывается — все обозначения
 * остаются в подсказке строки, а не выталкивают поле за край окна.
 *
 * Чистая и вынесена наружу: строку, собранную в обработчике кадра, не проверяет
 * ничто.
 */
export function volumeUnplacedLine(unplaced) {
  const list = unplaced || [];
  if (list.length === 0) return "";
  return text("volume.unplaced", { count: list.length, list: volumeNamedList(list, unplacedName, "volume.unplacedMore") });
}

/** Все неразмещённые по обозначениям — в подсказку строки, когда их много. */
export function volumeUnplacedTitle(unplaced) {
  const list = unplaced || [];
  if (list.length <= VOLUME_UNPLACED_SHOWN) return "";
  return list.map(unplacedName).join(", ");
}

/** Одна неразмещённая вещь: обозначение и причина. */
function unplacedName(item) {
  return text("volume.unplacedItem", { label: item.label, reason: volumeUnplacedReason(item.reason) });
}

/**
 * Перечень, который не выталкивает поле за край окна: названо
 * `VOLUME_UNPLACED_SHOWN`, дальше «и ещё N», а полный список уходит в подсказку
 * строки. Одна мера на оба списка — и неразмещённых, и нарисованных запасным
 * габаритом: это одна и та же строка под полем, и обрываться она обязана
 * одинаково.
 */
function volumeNamedList(list, name, moreKey) {
  const named = list.slice(0, VOLUME_UNPLACED_SHOWN).map(name);
  if (list.length > VOLUME_UNPLACED_SHOWN) {
    named.push(text(moreKey, { count: list.length - VOLUME_UNPLACED_SHOWN }));
  }
  return named.join(", ");
}

/**
 * Строка «нарисованы запасным габаритом» (G215, G226).
 *
 * Вещь, у типа которой размеры заданы не все, в объём попадает — но
 * недостающую сторону сборка **выдумала** (`markBoxMm`: габарит изображения
 * объекта, а без изображения — обычная рамка). Молчать об этом нельзя: человек
 * решит, что числа заданы, и будет размечать щит по догадке. Писать догадку в
 * справочник тоже нельзя (G68) — остаётся сказать словом, той же строкой под
 * полем, где живут неразмещённые.
 *
 * Чистая и вынесена наружу по той же причине, что `volumeUnplacedLine`.
 */
export function volumeSpareLine(spare) {
  const list = spare || [];
  if (list.length === 0) return "";
  return text("volume.spare", {
    count: list.length,
    list: volumeNamedList(list, (item) => item.label, "volume.spareMore"),
    side: MARK_BOX_FRAME_MM,
    depth: MARK_BOX_FRAME_DEPTH_MM,
  });
}

/** Все нарисованные запасным габаритом — в подсказку строки, когда их много. */
export function volumeSpareTitle(spare) {
  const list = spare || [];
  if (list.length <= VOLUME_UNPLACED_SHOWN) return "";
  return list.map((item) => item.label).join(", ");
}

/**
 * Строка про двери (G207, G210): сколько открыто и что с ними делают клавиши.
 *
 * Чистая и вынесена наружу по той же причине, что `volumeUnplacedLine`: строку,
 * собранную в обработчике кадра, не проверяет ничто. Дверей в схеме нет вовсе —
 * и строки нет: клавиша, которой нечего открывать, в подсказке лишняя.
 */
export function volumeDoorLine(doors, open, aimed, touching) {
  const list = doors || [];
  if (list.length === 0) return "";
  const count = list.filter((id) => open.has(id)).length;
  const state = text("volume.doors", { open: count, count: list.length });
  // Пальцем клавиши E нет вовсе (таск 149), и обещать её значило бы оставить
  // планшет с закрытыми дверями: там дверь открывается касанием по ней.
  if (touching) return state + " " + strings.volume.doorTouch;
  return aimed ? state + " " + strings.volume.doorAimed : state + " " + strings.volume.doorKeys;
}

/**
 * Текст подсказки окна (G218) — весь, одной строкой.
 *
 * Собирается из того же, из чего собирался в строке под полем: вид говорит про
 * свои клавиши, мышь — про захват, палец — про площадку и щипок, дальше про
 * выделение, прицел, двери и лестницу под рукой. Переезд в плашку ничего из
 * этого не отменил.
 *
 * Чистая и вынесена наружу: текст, собранный внутри обработчика, не проверяет
 * ничто, а подсказка — единственное место, где в окне написано, что делают
 * клавиши.
 */
export function volumeHintText(state) {
  if (state.empty) return strings.volume.emptyHint;
  const parts = [state.view === "person" ? strings.volume.hintPerson : strings.volume.hintAround];
  // Пальцем про захват мыши говорить нечего: мыши нет (таск 149).
  if (state.touching) parts.push(strings.volume.hintTouch);
  else parts.push(state.locked ? strings.volume.hintLocked : strings.volume.hintGrab);
  parts.push(strings.volume.pickHint);
  // Про прицел — там же, где он показан: пальцем его нет, в обзоре нет.
  if (state.aim) parts.push(strings.volume.aimHint);
  parts.push(volumeDoorLine(state.doors, state.open, state.aimedDoor, state.touching));
  // Про этажи — последней: лестница под рукой есть далеко не всегда, а когда
  // есть, это самое новое в строке. Там же и возврат (G216).
  parts.push(volumeFloorAction(state.stair, state.floors, state.back).hint);
  return parts.filter((part) => part !== "").join(" ");
}

/**
 * Как назвать схему, на которую зовёт возврат: этажом, если он задан, иначе
 * именем. Винительный падеж один на кнопку и на уведомление — «вернуться на
 * этаж 1», «вернуться на схему „План“».
 */
export function volumeFloorName(where) {
  if (!where) return "";
  return where.floor === null || where.floor === undefined
    ? text("volume.floorNamed", { name: where.name })
    : text("volume.floorNumber", { floor: where.floor });
}

/**
 * Что окно предлагает сделать с этажами: подняться по лестнице под рукой или
 * вернуться туда, откуда пришёл (G216).
 *
 * **Один ответ на кнопку и на подсказку.** Раньше кнопка и строка считались
 * врозь, и разойтись они могли молча; теперь это одно правило, и проверяется
 * оно тестом.
 *
 * Разбор:
 *
 *   - **лестница под рукой** — её вопрос, как в таске 149; этажей не задано ни
 *     у одной схемы — кнопки нет, но строка об этом говорит прямо: человек
 *     видит нарисованную лестницу, и молчание он прочтёт как поломку;
 *   - **лестницы нет, а пришли мы сюда переходом** — возврат. Это и есть
 *     тупик, который назвал исполнитель таска 149: подняться на этаж, где
 *     лестница не нарисована, можно, а вернуться было нечем — кнопка живёт
 *     рядом с лестницей, а её там нет. Лестницы ему не выдумывают: возврат идёт
 *     по той же, по которой поднялись;
 *   - **ни того, ни другого** — молчание: предлагать нечего.
 *
 * Возврат не привязан ни к месту, ни к виду, и это нарочно. Кнопка «Этаж»
 * живёт рядом с лестницей, потому что лестница — вещь на чертеже, к ней
 * подходят. У возврата вещи нет: он про дорогу, по которой пришли. Привяжи его
 * к точке прихода — и человек, отошедший на три шага, снова в тупике, ровно в
 * том, который чинят.
 */
export function volumeFloorAction(stair, options, back) {
  if (stair) {
    if (!options || options.length === 0) {
      return { kind: "none", label: "", title: "", hint: strings.volume.stairNoFloors };
    }
    return {
      kind: "stair",
      label: strings.volume.stairButton,
      title: strings.volume.stairButtonHint,
      hint: strings.volume.stairNear,
    };
  }
  if (back) {
    return {
      kind: "back",
      label: text("volume.backButton", { where: volumeFloorName(back) }),
      title: strings.volume.backButtonHint,
      hint: strings.volume.backLine,
    };
  }
  return { kind: "none", label: "", title: "", hint: "" };
}

/**
 * Клавиатура принадлежит полю ввода, а не окну.
 *
 * Правило то же, что у диалогов (`uiDialogDepth`): у кого фокус, того и
 * клавиши. Своих полей у окна сейчас нет — его клавиши ловятся на `document` и
 * держатся глубиной диалога. Но объём переезжает на главный экран рядом с
 * панелями, где полей вдоволь: без этой проверки «W» в имени помещения увёл бы
 * человека на шаг вперёд.
 */
export function volumeTypingTarget(node) {
  if (!node || !node.tagName) return false;
  if (node.isContentEditable === true) return true;
  const tag = String(node.tagName).toLowerCase();
  return tag === "select" || tag === "input" || tag === "textarea";
}

/** Заголовок окна: с номером этажа, если он у схемы задан. */
export function volumeTitle(name, floor) {
  if (floor === null || floor === undefined) return text("volume.title", { name });
  return text("volume.titleFloor", { name, floor });
}

/** Строки про то, чего в сцене не хватает. Порядок — порядок важности. */
export function volumeNotes(scene) {
  const lines = [];
  for (const note of scene.notes || []) {
    if (note === "noRooms") lines.push(strings.volume.noRooms);
    if (note === "noBridge") lines.push(strings.volume.noBridge);
    if (note === "noHeight") lines.push(text("volume.noHeight", { height: VOLUME_HEIGHT_FALLBACK_MM }));
  }
  return lines;
}

export function openVolume({ schemeId: openOn, api }) {
  if (volumeOpened) return null;
  const { getState, setState, notify, subscribe } = api;
  const project = getState().project;
  if (!findScheme(project, openOn)) return null;
  volumeOpened = true;

  // Какую схему показываем. **Переменная, а не аргумент**: лестница меняет этаж,
  // то есть меняет схему под той же камерой (таск 149). Второго окна на второй
  // этаж не заводится — человек поднимается по лестнице, а не открывает ещё
  // одно окно, и пройденный путь, открытые двери и вид остаются при нём.
  let schemeId = openOn;

  // Метки берутся **видимые на плане**: фильтр спрятал метку на плане — её нет
  // и в объёме. Иначе у одного объекта было бы два ответа на вопрос «что
  // сейчас показано».
  const sceneMarks = (state) => {
    const scheme = findScheme(state.project, schemeId);
    return scheme ? visibleMarks(state.project, scheme, state.filter) : [];
  };
  // Раскрытые двери (G207). Живут **в сеансе окна**: закрыл дверь в объёме — в
  // файл не попадает ничего (G68), и объект после прогулки байт в байт тот же.
  // Поэтому это и не поле проёма, а аргумент сборки сцены.
  const openDoors = new Set();
  const sceneOf = (state) =>
    volumeScene(state.project, schemeId, { marks: sceneMarks(state), openDoorIds: openDoors });

  let scene = sceneOf(getState());
  let view = "around";
  let closed = false;
  let frame = 0;
  let walking = 0;
  let clock = 0;
  const keys = new Map();
  let look = null; // перетаскивание мышью: {x, y}
  let locked = false;
  let denied = false;
  // Где рука: точка поля под курсором (без захвата) — ею целятся в дверь.
  let pointer = null;
  // Дверь под рукой и дверь, по которой щёлкнули. Заказчик назвал оба способа:
  // «по клику на них или когда наведён курсор».
  let aimedDoor = null;
  let heldDoor = null;
  // Alt отпустил мышь, и по отпусканию Alt её надо забрать обратно (G211).
  let altFree = false;
  // Зашли пальцем (таск 149). Догадка по виду указателя — сразу, точный ответ —
  // по первому касанию: мышь площадку ходьбы не увидит никогда.
  let touching = volumeTouchLikely();
  // Палец на площадке ходьбы: `{id, forward, turn}`.
  let pad = null;
  // Щипок двумя пальцами в обзоре: расстояние между ними и расстояние камеры в
  // тот миг, когда щипок начался.
  let pinch = null;
  // Касания на поле, по которым узнаётся щипок.
  const touches = new Map();
  // Открытый вопрос про этаж и лестница, про которую уже спросили. Вторая нужна
  // затем, чтобы вопрос не задавался заново на каждом шаге у той же лестницы:
  // отошёл и подошёл снова — спросится опять.
  let ask = null;
  let stairAsked = null;
  // Откуда пришли на нынешнюю схему (G216). Живёт в сеансе окна, в объект не
  // пишется ничего (G68); закрыли окно — дорога забыта, и это честно.
  let cameFrom = null;
  // Вопрос отпускает мышь: по курсору в нём и щёлкают. Был захват — вернём.
  let askWasLocked = false;
  // Последний кадр — он же ответ на «во что ткнули»: клик ищет метку в том, что
  // человек видит, а не в сцене. Второго способа считать попадание не заводим.
  let shown = [];
  // Рамка выделения и стрелки связей. Пересобираются на правку объекта и на
  // смену выделения, а не на кадр: на бегу их считать незачем, они не двигаются.
  let overlay = [];

  const start = scene.empty ? { x: 0, y: 0, yaw: 0 } : volumeStart(scene);
  // Человек: место на плане, рысканье и наклон. Высота глаз постоянная —
  // приседать и прыгать в этом режиме незачем.
  const person = { x: start.x, y: start.y, yaw: start.yaw, pitch: (VOLUME_START_PITCH_DEG * Math.PI) / 180 };
  /**
   * Где человек стоял на схемах, которые уже покидал (G216, G217).
   *
   * Дыра, названная исполнителем таска 149: поднялся на этаж, где лестница не
   * нарисована, — и вернуться нечем, кнопка «Этаж» живёт только рядом с
   * лестницей. Выбор схемы в шапке (G217) этот тупик закрывает сам, а память
   * делает выбор **возвратом**, а не переброской: человек встаёт там, откуда
   * ушёл, то есть у той же лестницы, по которой поднялся. Без неё выбор ставил
   * бы его в самое просторное место схемы — то есть в другом конце квартиры от
   * двери, из которой он вышел.
   *
   * Живёт **в сеансе окна**: в объект не пишется ничего (G68). Закрыли окно —
   * память ушла, и это честно: заново открытый объём не помнит дороги.
   */
  const visited = new Map();
  // Обзор: цель, вокруг которой ходит камера, и расстояние до неё.
  let around = { target: { x: start.x, y: start.y, z: 1200 }, yaw: start.yaw, pitch: (VOLUME_AROUND_PITCH_DEG * Math.PI) / 180, distance: VOLUME_AROUND_NEAR_MM };

  const node = uiEl("canvas", { class: "volume__canvas" });
  // Карточка выделенной метки — внизу поверх поля, ровно так же, как она стоит
  // внизу поверх плана (заказчик: «Да, и карточку»). Собирается тем же
  // `markCardParts` и из той же `markCardModel`: второй правды о метке в сборке
  // быть не должно.
  const cardClose = uiIconButton("close", {
    class: "ui-btn mark-card__close",
    label: strings.volume.cardClose,
    on: { click: () => select(null) },
  });
  const card = uiEl("div", { class: "mark-card mark-card--volume", attrs: { hidden: "hidden" } });
  // Площадка ходьбы (таск 149): видна только там, где ходят пальцем. Кружок
  // внутри показывает, куда палец уведён, — без него непонятно, держит ли
  // площадка касание вообще.
  const padKnob = uiEl("span", { class: "volume__padKnob" });
  const padNode = uiEl(
    "div",
    {
      class: "volume__pad",
      attrs: { hidden: "hidden", "aria-hidden": "true", title: strings.volume.padLabel },
    },
    [padKnob],
  );
  // Вопрос про этаж живёт **в самом окне**, а не диалогом поверх страницы, и это
  // не вкусовщина: стопка диалогов прячет карточки под верхней (`uiRefreshDialogs`),
  // а в полном экране развёрнута карточка окна — всё, что лежит в
  // `#dialog-host`, в этот момент не видно вовсе. Окно в полном экране — главный
  // способ смотреть объём, и вопрос, которого там нет, был бы вопросом в пустоту.
  const askText = uiEl("p", { class: "volume__askText" });
  const askRow = uiEl("div", { class: "volume__askRow" });
  const askBox = uiEl("div", { class: "volume__ask", attrs: { hidden: "hidden" } }, [askText, askRow]);
  // Кнопка этажей на поле. У лестницы — тот же вопрос, заданный по своей воле:
  // нужен и пальцем (клавиш там нет), и мышью (отказался один раз — спроси
  // снова, не отходя от лестницы). На этаже, где лестницы нет, та же кнопка
  // зовёт обратно (G216) — одна кнопка и одна клавиша на оба перехода между
  // этажами, второго места для них не заводится. Подпись ставит `syncStair`:
  // она у кнопки меняется вместе со смыслом.
  const stairButton = uiButton(strings.volume.stairButton, {
    class: "ui-btn ui-btn--accent volume__stair",
    title: strings.volume.stairButtonHint,
    attrs: { hidden: "hidden" },
    on: { click: () => floorByHand() },
  });
  // Прицел (G213): «при виде от 1 лица поставь миниатюрный прицел по центру
  // экрана». Он **узел над холстом, а не рисунок по холсту** — иначе уехал бы
  // в снимок вида (таск 149), где указателю не место. Пустой: весь он в стилях
  // (`volume.css`), и читать его нечем — `aria-hidden`.
  const aimNode = uiEl("div", { class: "volume__aim", attrs: { hidden: "hidden", "aria-hidden": "true" } });
  // Подсказка по управлению — плашка справа сверху поля со сворачивающей
  // кнопкой (G218). Кнопка **справа от текста**, а не слева, как на холсте:
  // плашка прижата к правому краю, и свёрнутая она обязана остаться в том же
  // углу, где была её кнопка.
  const hintText = uiEl("p", { class: "canvas-hint__text" });
  const hintToggle = uiEl(
    "button",
    {
      class: "canvas-hint__toggle",
      type: "button",
      on: {
        click: () => {
          volumeHintCollapsed = !volumeHintCollapsed;
          setSetting(VOLUME_HINT_SETTING, volumeHintCollapsed);
          syncHint();
          // Клавиши возвращаются полю: свернул подсказку — идёшь дальше, а не
          // жмёшь пробелом ту же кнопку.
          if (typeof stage.focus === "function") stage.focus({ preventScroll: true });
        },
      },
    },
    uiIcon("hint"),
  );
  const hint = uiEl("div", { class: "canvas-hint canvas-hint--volume" }, [hintText, hintToggle]);
  const stage = uiEl("div", { class: "volume__stage", attrs: { tabindex: "-1" } }, [
    node,
    card,
    stairButton,
    padNode,
    aimNode,
    hint,
    askBox,
  ]);
  const ctx = node.getContext ? node.getContext("2d") : null;

  const personButton = uiButton(strings.volume.viewPerson, {
    title: strings.volume.viewPersonHint,
    on: { click: () => setView("person") },
  });
  const aroundButton = uiButton(strings.volume.viewAround, {
    title: strings.volume.viewAroundHint,
    on: { click: () => setView("around") },
  });
  const fitButton = uiButton(strings.volume.fit, { title: strings.volume.fitHint, on: { click: () => fit() } });
  // Снимок вида (таск 149): «просто возможность сделать „скрин“». Одна кнопка,
  // и она же единственный способ — клавиши у неё нет нарочно: занятых в окне
  // букв хватает, а снимок делают не на бегу.
  const shotButton = uiButton(strings.volume.shot, {
    title: strings.volume.shotHint,
    on: { click: () => shot() },
  });
  // Все двери разом — пальцем (таск 149): клавиши R на планшете нет. Мышью её
  // не показываем, чтобы не заводить второй способ там, где клавиша уже есть.
  const doorsButton = uiButton(strings.volume.doorsAll, {
    title: strings.volume.doorsAllHint,
    attrs: { hidden: "hidden" },
    on: { click: () => toggleAllDoors() },
  });
  const fullButton = uiIconButton("fullscreen", {
    label: canvasFullscreenLabel(false),
    on: { click: () => toggleFullscreen() },
  });
  const where = uiEl("span", { class: "volume__where" });
  const meta = uiEl("p", { class: "volume__meta" });
  const missing = uiEl("p", { class: "volume__missing" });
  // Нарисованные запасным габаритом (G215) — своей строкой рядом с
  // неразмещёнными: новость другая («вещь есть, но размер выдуман»), а место и
  // цвет те же — в объекте не хватает числа, и сказать об этом надо там, где
  // человек уже читает про недостающее.
  const spareLine = uiEl("p", { class: "volume__missing" });

  const bar = uiEl("div", { class: "volume__tools" }, [
    uiEl("span", { class: "volume__toolsLabel", text: strings.volume.view }),
    personButton,
    aroundButton,
    where,
    uiEl("span", { class: "volume__spacer" }, [doorsButton, shotButton, fitButton, fullButton]),
  ]);
  // Подсказки под полем больше нет: она переехала плашкой в само поле (G218).
  // Под полем остаётся то, что говорит про объект, а не про управление, — счёт
  // чертежа, недостающее и запасные габариты.
  const body = uiEl("div", { class: "volume" }, [bar, stage, meta, missing, spareLine]);

  const closeButton = uiButton(strings.volume.close, {
    class: "ui-btn ui-btn--accent",
    on: { click: () => finish() },
  });
  const modal = uiModal({
    title: volumeTitle(findScheme(project, schemeId).name, schemeFloorOf(project, schemeId)),
    body,
    actions: [closeButton],
    onCancel: () => cleanup(),
  });
  modal.card.classList.add("modal--volume");
  // Заголовок переписывается при переходе по лестнице: имя схемы и номер этажа
  // в нём — единственное место, где написано, где человек оказался.
  const titleNode = modal.card.querySelector(".modal__title");
  const depth = uiDialogDepth();

  // ——— вид ———

  function ours() {
    return !closed && uiDialogDepth() === depth;
  }

  function setView(next) {
    if (view === next) return;
    // Переход к обзору ставит цель туда, где стоит человек: обзор нужен, чтобы
    // понять, где стоишь, а не чтобы потерять себя из виду.
    if (next === "around") {
      around = { ...around, target: { x: person.x, y: person.y, z: 1200 }, yaw: person.yaw, distance: VOLUME_AROUND_NEAR_MM };
      around = { ...around, pitch: volumeAroundPitch(around.pitch, around.distance, aroundLift()) };
    }
    view = next;
    sync();
  }

  function fit() {
    if (scene.empty) return;
    const fitted = volumeAroundFit(scene, viewport());
    around = { ...around, target: fitted.target, distance: fitted.distance };
    around = { ...around, pitch: volumeAroundPitch(around.pitch, around.distance, aroundLift()) };
    if (view !== "around") {
      view = "around";
      sync();
      return;
    }
    paint();
  }

  function camera() {
    if (view === "person") {
      return { at: { x: person.x, y: person.y, z: VOLUME_EYE_MM }, yaw: person.yaw, pitch: person.pitch };
    }
    return volumeAroundCamera(around.target, around.yaw, around.pitch, around.distance);
  }

  function viewport() {
    return { width: Math.max(1, stage.clientWidth), height: Math.max(1, stage.clientHeight) };
  }

  // ——— кадр ———

  function resize() {
    if (!(stage.clientWidth > 0) || !(stage.clientHeight > 0)) return;
    const ratio = (typeof window !== "undefined" && window.devicePixelRatio) || 1;
    const box = viewport();
    node.style.width = box.width + "px";
    node.style.height = box.height + "px";
    node.width = Math.round(box.width * ratio);
    node.height = Math.round(box.height * ratio);
    paint();
  }

  function paint() {
    if (!ctx || closed) return;
    const ratio = (typeof window !== "undefined" && window.devicePixelRatio) || 1;
    const box = viewport();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, node.width, node.height);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    const spot = camera();
    // Фон — настоящая панорама вокруг дома (G208): он знает о камере её
    // направление и больше ничего, и поворачивается вслед за головой.
    volumeDrawBackdrop(ctx, box, spot);
    if (scene.empty) {
      shown = [];
      return;
    }
    // Кружок «вы здесь» рисуется только в обзоре: от первого лица человек и
    // так знает, где стоит, а под ногами кружок закрыл бы пол.
    const marker = view === "around" ? volumeMarkerFaces({ x: person.x, y: person.y }, person.yaw) : [];
    shown = volumeFrame(scene, spot, box, [...overlay, ...marker]);
    volumeDraw(ctx, shown);
    // Миникарта — поверх кадра и после него: это накладка, а не часть сцены.
    if (view === "person") paintMinimap(box);
    syncAim();
  }

  // ——— миникарта (G212) ———
  //
  // «а на виде от 1 лица сделай в левом нижнем углу миникарту — вид сверху».
  // На ней **только план и местоположение** (прямой ответ заказчика: «Только
  // схема и местоположение») — ни меток, ни подписей помещений: миникарта
  // отвечает на «где я и куда смотрю», а что где висит, видно в самом кадре.
  //
  // Рисует её **тот же `drawDrawing`, что и план** (стены с толщиной, проёмы,
  // объекты пола), через мост «пиксель равен миллиметру» — второй отрисовки
  // чертежа в сборке нет. Буквы углов и подписи объектов отпадают сами: у них
  // свои пороги в экранных точках, и на миникарте стена короче порога.

  function paintMinimap(box) {
    const place = volumeMinimapBox(box, scene.boundsMm);
    if (!place) return;
    const bounds = scene.boundsMm;
    const state = getState();
    ctx.save();
    ctx.beginPath();
    ctx.rect(place.x, place.y, place.width, place.height);
    ctx.fillStyle = "rgba(255, 255, 255, 0.86)";
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(31, 35, 40, 0.35)";
    ctx.stroke();
    ctx.clip();
    const pad = 8;
    const zoom = Math.min(
      (place.width - pad * 2) / bounds.widthMm,
      (place.height - pad * 2) / bounds.heightMm,
    );
    const view = {
      zoom,
      offsetX: place.x + (place.width - bounds.widthMm * zoom) / 2 - bounds.minX * zoom,
      offsetY: place.y + (place.height - bounds.heightMm * zoom) / 2 - bounds.minY * zoom,
    };
    // Без подписей: буквы углов и имена объектов на накладке в двести точек
    // слипаются в кашу, а заказчик просил «только схема и местоположение».
    drawDrawing(ctx, { project: state.project, schemeId, bridge: drawingUnitBridge(view), labels: false });
    // Местоположение и направление взгляда. Направление показать надо: без него
    // точка отвечает на половину вопроса, и миникарта становится бесполезной.
    const at = { x: view.offsetX + person.x * zoom, y: view.offsetY + person.y * zoom };
    const colour = "rgb(" + VOLUME_MARKER_RGB.join(",") + ")";
    const reach = 13;
    ctx.beginPath();
    ctx.moveTo(at.x + Math.cos(person.yaw) * reach, at.y + Math.sin(person.yaw) * reach);
    ctx.lineTo(
      at.x + Math.cos(person.yaw + 2.5) * reach * 0.8,
      at.y + Math.sin(person.yaw + 2.5) * reach * 0.8,
    );
    ctx.lineTo(
      at.x + Math.cos(person.yaw - 2.5) * reach * 0.8,
      at.y + Math.sin(person.yaw - 2.5) * reach * 0.8,
    );
    ctx.closePath();
    ctx.fillStyle = colour;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(at.x, at.y, 3.2, 0, Math.PI * 2);
    ctx.fillStyle = "#fff";
    ctx.fill();
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = colour;
    ctx.stroke();
    ctx.restore();
  }

  // ——— выделение ———
  //
  // Выделение **общее с планом**, и живёт оно там же, где жило, — в состоянии
  // сеанса. Окно его только читает и ставит; ни объект, ни история от этого не
  // меняются (G68).

  function selectedIds() {
    return getState().selectedMarkIds || [];
  }

  function select(markId) {
    const current = selectedIds();
    const next = markId ? [markId] : [];
    if (current.length === next.length && current.every((id, index) => id === next[index])) return;
    setState({ selectedMarkIds: next });
  }

  // Рамка выделенного и стрелки связей. Правила, какие связи показывать, —
  // плановые целиком (`canvasFrameLinks`): переключатель в шапке включён —
  // видны все связи схемы, выключен — связная группа выделенной метки.
  function rebuildOverlay() {
    overlay = [];
    if (scene.empty) return;
    const state = getState();
    for (const id of selectedIds()) {
      const place = volumeMarkPlace(scene, id);
      if (place) volumeSelectLines(place, overlay);
    }
    const scheme = findScheme(state.project, schemeId);
    if (!scheme) return;
    volumeLinkLines(canvasFrameLinks(state, null, scheme), (id) => volumeMarkAnchor(scene, id), overlay);
  }

  function syncCard() {
    const state = getState();
    const selected = selectedIds();
    // Карточка про одну метку — то же правило, что у карточки на плане:
    // у выделенных пачкой общих полей нет.
    const model = selected.length === 1 ? markCardModel(state.project, selected[0]) : null;
    card.hidden = !model;
    if (!model) return;
    card.replaceChildren(...markCardParts(model, { headButton: cardClose }));
  }

  function syncSelection() {
    rebuildOverlay();
    syncCard();
    paint();
  }

  // Во что ткнули. Под захватом мыши курсора нет вовсе, и целятся серединой
  // поля — тем самым прицелом, которым в играх и целятся.
  function atEvent(event) {
    const box = viewport();
    if (locked) return { x: box.width / 2, y: box.height / 2 };
    const rect = node.getBoundingClientRect ? node.getBoundingClientRect() : { left: 0, top: 0 };
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function pickAt(event) {
    const at = atEvent(event);
    return volumePickAt(shown, at.x, at.y);
  }

  // ——— двери (G207, G210) ———
  //
  // «По умолчанию пусть все двери будут закрыты, по клику на них или когда
  // наведён курсор, то по нажатию клавиши E надо открывать и закрывать дверь».
  //
  // Прицел у двери тот же, что у вещи: под захватом мыши — середина поля, без
  // захвата — точка под курсором. Щелчок по двери её запоминает, и E работает,
  // даже если рука уже съехала с полотна.

  /**
   * Куда смотрит рука.
   *
   * Под захватом мыши курсора нет вовсе — целятся серединой поля, то есть
   * прицелом (G213). Есть курсор — целятся им: он на поле виден, и обещать
   * вместо него середину значило бы врать. Курсор увели с поля, а захвата нет —
   * снова прицел: от первого лица середина поля всегда что-то значит, и
   * клавиша, переставшая работать от того, что мышь лежит на панели, — хуже.
   */
  function aimPoint() {
    const box = viewport();
    if (locked) return { x: box.width / 2, y: box.height / 2 };
    if (pointer) return pointer;
    return view === "person" ? { x: box.width / 2, y: box.height / 2 } : null;
  }

  /**
   * Прицел виден ровно тогда, когда он **и есть рука** (G213).
   *
   * От первого лица и мышью — да; в обзоре центр поля ничего не значит, а
   * пальцем целятся касанием, и клавиши E там нет вовсе (таск 149). И пока
   * курсор над полем, целится курсор — он и нарисован крестом (`volume.css`),
   * а второй крест посреди поля обещал бы то, чего не делает. Увели курсор с
   * поля или отдали мышь виду — снова прицел.
   */
  function syncAimNode() {
    aimNode.hidden = scene.empty || view !== "person" || touching || (!locked && pointer !== null);
  }

  /** Дверь под рукой — по последнему нарисованному кадру. */
  function syncAim() {
    syncAimNode();
    const at = aimPoint();
    const found = at && !scene.empty ? volumeDoorAt(shown, at.x, at.y) : null;
    if (found === aimedDoor) return;
    aimedDoor = found;
    syncHint();
  }

  // Сцена пересобирается целиком: дверь меняет грани стены, в которой стоит, и
  // считать её заново дешевле, чем держать второй путь «подмени одно полотно».
  // На объекте заказчика это 8 мс и происходит по нажатию клавиши, а не в кадре.
  function rebuildScene() {
    scene = sceneOf(getState()) || scene;
    rebuildOverlay();
    syncHint();
    paint();
  }

  /**
   * Что сделает E (G214). Вещь под прицелом — выделить **тем же выделением**,
   * что клик по ней и список меток (таск 148); дверь — открыть или закрыть
   * (G207). Правило разбора — в `volumeAimChoice`, здесь только руки.
   */
  function actOnAim() {
    const at = aimPoint();
    const aimed = at && !scene.empty;
    const choice = volumeAimChoice({
      // Точно — это **видно** (`volumeSightAt`), а не «накрыто телом»: вещь за
      // стеной человек не видит, и выделять её по взгляду нельзя.
      markExact: aimed ? volumeSightAt(shown, at.x, at.y) : null,
      door: aimedDoor || heldDoor,
      // А рядом — это рука с её промахом, тем же, что у клика: розетка в трёх
      // метрах занимает десяток точек.
      markNear: aimed ? volumePickAt(shown, at.x, at.y) : null,
    });
    if (choice.kind === "mark") {
      select(choice.id);
      return;
    }
    if (choice.kind === "door") {
      toggleDoor(choice.id);
      return;
    }
    notify(strings.volume.aimless, "info");
  }

  function toggleDoor(doorId) {
    if (!doorId) return false;
    if (openDoors.has(doorId)) openDoors.delete(doorId);
    else openDoors.add(doorId);
    heldDoor = doorId;
    rebuildScene();
    return true;
  }

  function toggleAllDoors() {
    const doors = scene.doors || [];
    if (doors.length === 0) {
      notify(strings.volume.doorsNone, "info");
      return;
    }
    const next = volumeDoorsAfterAll(doors, openDoors);
    openDoors.clear();
    for (const id of next) openDoors.add(id);
    rebuildScene();
    notify(next.length > 0 ? strings.volume.doorsOpened : strings.volume.doorsClosed, "info");
  }

  function redraw() {
    if (frame || closed) return;
    const schedule = typeof requestAnimationFrame === "function" ? requestAnimationFrame : (fn) => setTimeout(fn, 16);
    frame = schedule(() => {
      frame = 0;
      paint();
    });
  }

  // ——— ход ———
  //
  // Часы идут, только пока держат клавишу: окно, которое молотит кадры на
  // пустом месте, греет машину и съедает заряд планшета. Отпустили — последний
  // кадр нарисован, и до следующего события ничего не считается.

  function now() {
    return typeof performance !== "undefined" && performance.now ? performance.now() : Date.now();
  }

  // Кто-то держит ход: клавиша или палец на площадке. Пока держат — идут часы.
  function moving() {
    return keys.size > 0 || Boolean(pad);
  }

  function walkSchedule() {
    if (walking || !moving() || closed) return;
    const schedule = typeof requestAnimationFrame === "function" ? requestAnimationFrame : (fn) => setTimeout(fn, 16);
    clock = now();
    walking = schedule(walkTick);
  }

  function walkTick() {
    walking = 0;
    if (!moving() || closed) return;
    const time = now();
    const step = Math.min(0.1, Math.max(0, (time - clock) / 1000));
    clock = time;
    let forward = 0;
    let side = 0;
    let turn = 0;
    let run = false;
    for (const code of keys.keys()) {
      if (code === "ShiftLeft" || code === "ShiftRight") {
        run = true;
        continue;
      }
      const move = volumeKeyMove(code);
      if (!move) continue;
      forward += move.forward;
      side += move.side;
      turn += move.turn;
    }
    // Площадка ходьбы (таск 149) складывается с клавишами, а не спорит с ними:
    // в одном окне бывают и мышь с клавиатурой, и палец.
    if (pad) {
      forward += pad.forward;
      turn += pad.turn;
    }
    const speed = (run ? VOLUME_RUN_MM_S : VOLUME_WALK_MM_S) * step;
    if (turn !== 0) {
      const spin = Math.max(-1, Math.min(1, turn)) * step * 2.2;
      if (view === "person") person.yaw += spin;
      else around = { ...around, yaw: around.yaw + spin };
    }
    if (forward !== 0 || side !== 0) {
      const length = Math.hypot(forward, side);
      const basis = volumeBasis(view === "person" ? person : around);
      // Ход по плану, а не по направлению взгляда: с опущенным взглядом иначе
      // уходишь в пол, и это чувствуется как провал, а не как шаг.
      const flat = Math.hypot(basis.fwd.x, basis.fwd.y) || 1;
      // Длина делится на себя же, но не больше единицы: клавиши дают ровно
      // единицу (или корень из двух на двух сразу, как и было), а палец на
      // площадке — сколько увёл, и полшага должны остаться полушагом.
      const scale = (Math.min(1, length) / length) * speed;
      const dx = ((basis.fwd.x / flat) * forward + basis.right.x * side) * scale;
      const dy = ((basis.fwd.y / flat) * forward + basis.right.y * side) * scale;
      if (view === "person") {
        const moved = volumeStep(scene, person, dx, dy);
        person.x = moved.x;
        person.y = moved.y;
        syncWhere();
        stairCheck();
      } else {
        around = { ...around, target: { ...around.target, x: around.target.x + dx, y: around.target.y + dy } };
      }
    }
    paint();
    walkSchedule();
  }

  function keyStop(code) {
    if (code) keys.delete(code);
    else keys.clear();
    walkStop();
  }

  // Ход держать больше некому — часы останавливаются. Отдельно от `keyStop`:
  // палец с площадки сняли, а зажатую клавишу при этом отпускать нельзя.
  function walkStop() {
    if (moving() || !walking) return;
    const cancel = typeof cancelAnimationFrame === "function" ? cancelAnimationFrame : clearTimeout;
    cancel(walking);
    walking = 0;
  }

  // ——— мышь ———
  //
  // Голову вертят двумя способами, и оба нужны. Захват указателя — то самое
  // «как в игре»: мышь водит взглядом без нажатой кнопки. Но захват даёт не
  // каждый браузер и не во всякой вкладке, поэтому перетаскивание работает
  // всегда и само по себе.

  // Насколько обзор обязан подняться над целью, чтобы остаться снаружи: это
  // высота, на которой кончается чертёж, минус высота самой цели.
  function aroundLift() {
    const roof = (scene.heightMm || VOLUME_HEIGHT_FALLBACK_MM) + 400;
    return Math.max(0, roof - around.target.z);
  }

  function lookBy(dx, dy) {
    const perPixel = (VOLUME_LOOK_DEG_PX * Math.PI) / 180;
    if (view === "person") {
      person.yaw += dx * perPixel;
      person.pitch = volumeClampPitch(person.pitch - dy * perPixel);
    } else {
      around = {
        ...around,
        yaw: around.yaw + dx * perPixel,
        pitch: volumeAroundPitch(around.pitch - dy * perPixel, around.distance, aroundLift()),
      };
    }
    paint();
  }

  function onPointerDown(event) {
    if (event.button !== 0) return;
    // Кнопки и вопрос лежат **в самом поле** (карточка метки, площадка ходьбы,
    // «Этаж», вопрос про этаж), и нажатие на них полем не считается: иначе
    // щелчок по кнопке начинал бы поворот головы, а отпускание снимало бы
    // выделение.
    if (event.target !== node) return;
    if (event.pointerType === "touch") setTouch(true);
    stage.focus({ preventScroll: true });
    if (event.pointerType === "touch") {
      touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
      // Второй палец — щипок, а не второй поворот: взгляд перестаёт ехать за
      // первым пальцем, иначе щипок водил бы головой заодно.
      if (touches.size === 2) {
        look = null;
        pinch = { gap: touchGap(), distance: around.distance };
        return;
      }
      if (touches.size > 2) return;
    }
    look = { x: event.clientX, y: event.clientY, moved: false };
  }

  function onPointerMove(event) {
    // Палец на площадке ходьбы — это ход, а не поворот: пока он там, поле
    // взгляда его движений не видит вовсе (таск 149).
    if (pad && event.pointerId === pad.id) {
      padMove(event);
      return;
    }
    if (locked) {
      lookBy(event.movementX || 0, event.movementY || 0);
      return;
    }
    if (event.pointerType === "touch" && touches.has(event.pointerId)) {
      touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
      // Щипок двумя пальцами — то же, что колесо: в обзоре приближает, от
      // первого лица не делает ничего (приближать там нечего, а поле зрения
      // человек не просил).
      if (pinch && touches.size === 2) {
        const gap = touchGap();
        if (gap > 0 && pinch.gap > 0 && view === "around") {
          const distance = volumeAroundDistance((pinch.distance * pinch.gap) / gap);
          around = { ...around, distance, pitch: volumeAroundPitch(around.pitch, distance, aroundLift()) };
          paint();
        }
        return;
      }
    }
    const rect = node.getBoundingClientRect ? node.getBoundingClientRect() : { left: 0, top: 0 };
    const at = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    // Рука — только над полем. Увели курсор на панель или за окно — руки нет, и
    // целится прицел (G213): клавиша, переставшая работать от того, что мышь
    // лежит на кнопке, была бы загадкой.
    const box = viewport();
    pointer = at.x >= 0 && at.y >= 0 && at.x <= box.width && at.y <= box.height ? at : null;
    if (!look) {
      // Курсор просто ведут по полю — смотрим, не навели ли на дверь (G207).
      syncAim();
      return;
    }
    const dx = event.clientX - look.x;
    const dy = event.clientY - look.y;
    look = { x: event.clientX, y: event.clientY, moved: look.moved || Math.hypot(dx, dy) > 2 };
    lookBy(dx, dy);
  }

  /** Расстояние между двумя касаниями — мера щипка. */
  function touchGap() {
    const points = [...touches.values()];
    if (points.length < 2) return 0;
    return Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
  }

  function onPointerUp(event) {
    const started = look;
    look = null;
    if (event.pointerType === "touch") {
      touches.delete(event.pointerId);
      if (touches.size < 2) pinch = null;
    }
    padEnd(event);
    if (closed || !started || started.moved) return;
    // Щелчок по вещи — выделение (таск 148), и захват мыши тогда не просится:
    // человек целился в розетку, а не в поле. Щелчок мимо — снимает выделение
    // (так же, как тап по пустому месту плана) и просит захват: это и есть «как
    // в игре». Отказ браузера не беда, перетаскивание никуда не делось.
    if (!scene.empty) {
      const at = atEvent(event);
      const hit = volumePickAt(shown, at.x, at.y);
      if (hit) {
        select(hit);
        return;
      }
      // Щелчок по двери её запоминает — дальше ею распоряжается E. Сама дверь
      // от клика не открывается: заказчик назвал клавишу, а клик — только
      // способ показать, о какой двери речь.
      const door = volumeDoorAt(shown, at.x, at.y);
      if (door) {
        // Пальцем касание **открывает** дверь: клавиши E на планшете нет, и
        // «запомнить дверь для клавиши» там значило бы не делать ничего
        // (таск 149). Мышью остаётся прежнее — клик показывает, о какой двери
        // речь, а открывает её E (решение таска 150, заказчик назвал клавишу).
        if (touching) {
          toggleDoor(door);
          return;
        }
        heldDoor = door;
        aimedDoor = door;
        syncHint();
        return;
      }
      select(null);
      // Клик по обзору переносит туда, куда показали (G212). Захват мыши в
      // обзоре при этом не просится: у клика здесь появился свой смысл, а
      // голову в обзоре водят перетаскиванием, как и раньше.
      if (view === "around") {
        const place = volumeFloorAt(camera(), viewport(), at.x, at.y);
        if (place) {
          const moved = volumeMoveTo(scene, place);
          person.x = moved.x;
          person.y = moved.y;
          syncWhere();
          paint();
        }
        return;
      }
    }
    if (locked) return;
    // Пальцем захват указателя не просится: курсора нет, захватывать нечего, а
    // отказ браузера на каждое касание — лишняя работа и мигание.
    if (!touching) grabPointer();
  }

  // Захват мыши. Браузер вправе отказать — и это не беда: перетаскивание
  // никуда не делось, и вторым способом водить взглядом остаётся оно.
  function grabPointer() {
    if (typeof stage.requestPointerLock !== "function") return;
    try {
      const got = stage.requestPointerLock();
      if (got && typeof got.catch === "function") got.catch(() => {});
    } catch (error) {
      // захват не дали — молчим
    }
  }

  function onLockChange() {
    locked = document.pointerLockElement === stage;
    // Мышь отдали виду — курсора нет, и целится прицел; вернули — снова рука.
    syncAimNode();
    syncHint();
  }

  function onWheel(event) {
    if (view !== "around") return;
    event.preventDefault();
    const distance = volumeAroundDistance(around.distance * Math.exp(event.deltaY / 400));
    // Приблизились — вид сам становится круче: иначе камера нырнула бы под
    // крышу и уткнулась в стену изнутри.
    around = { ...around, distance, pitch: volumeAroundPitch(around.pitch, distance, aroundLift()) };
    paint();
  }

  // ——— палец: площадка ходьбы, щипок, кнопки на поле (таск 149) ———
  //
  // Площадка показывается по первому касанию и больше не прячется: один раз
  // зашли пальцем — дальше им и ходят. Обратно к мыши окно не переключается
  // само, и это нарочно — кнопка, исчезающая под рукой, хуже лишней.

  function setTouch(value) {
    if (touching === value) return;
    touching = value;
    sync();
  }

  function padAt(event) {
    const rect = padNode.getBoundingClientRect
      ? padNode.getBoundingClientRect()
      : { left: 0, top: 0, width: 0, height: 0 };
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const radius = Math.max(1, Math.min(rect.width, rect.height) / 2);
    const dx = event.clientX - cx;
    const dy = event.clientY - cy;
    const move = volumePadVector(dx, dy, radius);
    // Кружок показывает палец, но из площадки не выезжает.
    const length = Math.hypot(dx, dy) || 1;
    const reach = Math.min(1, length / radius) * radius * 0.62;
    padKnob.style.transform = "translate(" + (dx / length) * reach + "px, " + (dy / length) * reach + "px)";
    return move;
  }

  function padStart(event) {
    if (pad || closed) return;
    setTouch(true);
    event.preventDefault();
    if (padNode.setPointerCapture) {
      try {
        padNode.setPointerCapture(event.pointerId);
      } catch (error) {
        // захват указателя площадкой не дали — обойдёмся событиями окна
      }
    }
    const move = padAt(event);
    pad = { id: event.pointerId, forward: move.forward, turn: move.turn };
    padNode.classList.add("is-on");
    walkSchedule();
  }

  function padMove(event) {
    if (!pad || event.pointerId !== pad.id) return;
    event.preventDefault();
    const move = padAt(event);
    pad = { id: pad.id, forward: move.forward, turn: move.turn };
    walkSchedule();
  }

  function padEnd(event) {
    if (!pad || (event && event.pointerId !== undefined && event.pointerId !== pad.id)) return;
    pad = null;
    padNode.classList.remove("is-on");
    padKnob.style.transform = "";
    walkStop();
  }

  // ——— лестница и этажи (таск 149) ———
  //
  // «У схем можно задавать этаж, а при подходе к любой лестнице спрашивать
  // нужный этаж. Если 2 этажа, то просто с подтверждением переходить».
  //
  // Спрашивается **на подходе**: вопрос всплывает сам, когда человек подошёл к
  // лестнице (`VOLUME_STAIR_REACH_MM`), и не всплывает второй раз у той же
  // лестницы, пока от неё не отойдут. Один этаж на выбор — подтверждение одной
  // кнопкой, как и просил заказчик; больше — список этажей.

  /** Лестница, у которой стоит человек, или `null`. */
  function stairHere() {
    if (scene.empty || view !== "person") return null;
    const near = volumeStairNear(scene.stairs, person);
    return near ? near.stair : null;
  }

  /** Куда ведёт лестница: этажи других схем, годные для перехода. */
  function floorOptions() {
    return volumeFloors(getState().project, schemeId).options;
  }

  // Шаг сделан — не подошли ли к лестнице. Вопрос задаётся один раз на подход:
  // `stairAsked` помнит ту лестницу, про которую уже спросили, а выход из её
  // окрестности снова разрешает вопрос.
  function stairCheck() {
    const stair = stairHere();
    const id = stair ? stair.objectId : null;
    if (id === stairAsked) return;
    stairAsked = id;
    syncStair();
    if (!stair || ask) return;
    askStairs(false);
  }

  /** Кнопка «Этаж» и строка подсказки — по тому, стоим ли мы у лестницы. */
  function syncStair() {
    const action = floorAction();
    stairButton.hidden = action.kind === "none" || Boolean(ask);
    if (!stairButton.hidden) {
      stairButton.textContent = action.label;
      stairButton.title = action.title;
    }
    syncHint();
  }

  /** Что сейчас делает кнопка этажей и о чём говорит подсказка. */
  function floorAction() {
    return volumeFloorAction(stairHere(), floorOptions(), backFloor());
  }

  /**
   * Куда зовёт возврат (G216) — или `null`, если звать некуда.
   *
   * Условий два, и оба обязательны: мы **пришли сюда переходом** (окно помнит
   * дорогу, пока открыто) и **лестницы на этой схеме нет ни одной**. Есть
   * лестница — ею и пользуются, правило таска 149 не трогается вовсе.
   *
   * Схему, с которой пришли, могли удалить под окном — тогда возврата нет: имя
   * и этаж спрашиваются у объекта каждый раз, а не запоминаются вместе с
   * дорогой.
   */
  function backFloor() {
    if (!cameFrom) return null;
    if ((scene.stairs || []).length > 0) return null;
    const project = getState().project;
    const found = findScheme(project, cameFrom.schemeId);
    if (!found) return null;
    return { schemeId: found.id, name: found.name, floor: schemeFloorOf(project, found.id) };
  }

  /** Кнопка этажей и Enter: у лестницы — вопрос, без неё — возврат. */
  function floorByHand() {
    if (stairHere()) {
      askStairs(true);
      return;
    }
    goBackFloor();
  }

  /**
   * Спросить про этаж. `byHand` — спросили кнопкой или Enter: тогда молчать
   * нельзя даже там, где переходить некуда, иначе кнопка выглядит сломанной.
   */
  function askStairs(byHand) {
    const stair = stairHere();
    if (!stair) {
      if (byHand) notify(strings.volume.stairNoFloors, "info");
      return;
    }
    const options = floorOptions();
    if (options.length === 0) {
      // Подсказка про это уже говорит (`volumeFloorAction`) — вопроса без
      // ответов не задаём.
      if (byHand) notify(strings.volume.stairNoFloors, "info");
      return;
    }
    // Вопрос забирает клавиатуру и отпускает мышь: по курсору в нём и щёлкают.
    keyStop(null);
    padEnd(null);
    askWasLocked = locked;
    if (locked && typeof document.exitPointerLock === "function") document.exitPointerLock();
    ask = { stair, options };
    askText.textContent =
      options.length === 1
        ? text("volume.stairOne", { floor: options[0].floor })
        : strings.volume.stairPick;
    const buttons = options.map((option, index) =>
      uiButton(
        options.length === 1 ? strings.volume.stairGo : text("volume.stairOption", option),
        {
          class: "ui-btn" + (index === 0 ? " ui-btn--accent" : ""),
          on: { click: () => goToFloor(option) },
        },
      ),
    );
    buttons.push(uiButton(strings.volume.stairStay, { on: { click: () => closeAsk() } }));
    askRow.replaceChildren(...buttons);
    askBox.hidden = false;
    syncStair();
  }

  function closeAsk() {
    if (!ask) return;
    ask = null;
    askBox.hidden = true;
    askRow.replaceChildren();
    if (askWasLocked && !touching) grabPointer();
    askWasLocked = false;
    syncStair();
  }

  /**
   * Перейти на другой этаж.
   *
   * **Человек остаётся там, где стоял**, — в том же месте плана и глядя в ту же
   * сторону, — и это и есть ответ на «камера встаёт у соответствующей лестницы
   * нового этажа». Лестничная клетка у этажей одного дома в одном месте плана:
   * встав по тем же координатам, человек оказывается ровно у лестницы нового
   * этажа, а `volumeMoveTo` выталкивает его из самой лестницы и из стен тем же
   * счётом, которым это делает ходьба.
   *
   * **Лестницы на новом этаже нет** — правило то же, и другого честного места
   * всё равно нет: человек встаёт в том же месте плана (у `volumeMoveTo` оно
   * зажато габаритом чертежа и вытолкнуто из стен), а окно говорит об этом
   * вслух. Выдумывать ему середину комнаты значило бы соврать о том, где он
   * поднялся.
   *
   * Что остаётся при человеке: открытые двери (у этажей свои проёмы, и
   * вернувшись назад он найдёт свои двери как оставил) и вид. Что сбрасывается:
   * выделение — выделенная метка осталась на прежнем этаже, и карточка про неё
   * говорила бы о том, чего в кадре нет.
   */
  function goToFloor(option) {
    closeAsk();
    const state = getState();
    if (!findScheme(state.project, option.schemeId)) return;
    // Где мы стояли на покидаемой схеме и откуда пришли — в память окна
    // (G216): с этажа, где лестницы не нарисовано, человек вернётся сюда
    // кнопкой и встанет у той же лестницы. Сам переход по лестнице память **не
    // читает**: его правило прежнее, то же место плана (таск 149).
    leaveScheme();
    schemeId = option.schemeId;
    scene = sceneOf(state) || scene;
    const moved = volumeMoveTo(scene, { x: person.x, y: person.y });
    person.x = moved.x;
    person.y = moved.y;
    around = { ...around, target: { ...around.target, x: person.x, y: person.y } };
    select(null);
    // У лестницы, с которой сошли, вопрос второй раз не задаётся: иначе он
    // всплыл бы сразу же и предложил вернуться обратно.
    stairAsked = (stairHere() || {}).objectId || null;
    sync();
    notify(
      option.stairs
        ? text("volume.stairArrived", { floor: option.floor })
        : text("volume.stairArrivedPlain", { floor: option.floor }),
      "info",
    );
  }

  // ——— выбор схемы (G217) и возврат (G216) ————————————————————————————————
  //
  // «В окне добавь выбор схемы ещё».
  //
  // Это и есть выход из тупика, который назвал исполнитель таска 149: на этаж
  // без нарисованной лестницы попасть было можно, а вернуться нечем. Выдумывать
  // там лестницу нельзя (её нет на чертеже), заводить вторую кнопку «обратно» —
  // значит заводить второй способ сменить схему. Выбор в шапке закрывает и то и
  // другое: он доступен всегда и на любой схеме.

  /** Запомнить, где человек стоит на нынешней схеме. */
  function rememberPlace() {
    visited.set(schemeId, { x: person.x, y: person.y, yaw: person.yaw, pitch: person.pitch });
  }

  /** Уходим со схемы: где стояли — в память, а сама схема — «откуда пришли». */
  function leaveScheme() {
    rememberPlace();
    cameFrom = { schemeId };
  }

  /**
   * Вернуться туда, откуда пришли (G216).
   *
   * **Куда встаёт человек** — туда, где стоял, когда уходил, и глядя в ту же
   * сторону. Это и есть «возврат в точке прихода»: уходил он от лестницы, по
   * ней и возвращается. Место проходит через `volumeMoveTo` — чертёж могли
   * поправить, пока окно открыто, и память не должна поставить человека в новую
   * стену.
   *
   * Что остаётся при человеке: открытые двери и вид. Что сбрасывается:
   * выделение — выделенная метка осталась на прежней схеме.
   */
  function goBackFloor() {
    const back = backFloor();
    if (!back) return;
    closeAsk();
    const state = getState();
    leaveScheme();
    const place = visited.get(back.schemeId) || null;
    schemeId = back.schemeId;
    scene = sceneOf(state) || scene;
    if (!scene.empty) {
      const at = place || { x: person.x, y: person.y, yaw: person.yaw };
      const moved = volumeMoveTo(scene, at);
      person.x = moved.x;
      person.y = moved.y;
      person.yaw = at.yaw;
      if (place) person.pitch = volumeClampPitch(place.pitch);
      around = { ...around, target: { ...around.target, x: person.x, y: person.y }, yaw: person.yaw };
    }
    select(null);
    // Вернулись мы к самой лестнице — и вопрос про этаж сам не всплывает:
    // иначе он предложил бы тут же подняться обратно.
    stairAsked = (stairHere() || {}).objectId || null;
    sync();
    notify(text("volume.backArrived", { where: volumeFloorName(back) }), "info");
  }

  // ——— снимок вида (таск 149) ———
  //
  // «Да, но просто возможность сделать „скрин“». Снимок — **ровно тот кадр,
  // который на поле**: тем же холстом, той же величины, без рамки, подписи и
  // полей. Имя собирает `exportFileName`, то есть то же правило, по которому
  // названы все выгрузки объекта, — снимок ложится в папку загрузок рядом с
  // ними, а не под случайным именем от браузера.

  async function shot() {
    const name = exportFileName(getState().project, text("volume.shotPart", { name: schemeName() }), "png");
    try {
      exportDownload(await viewPng(node), name);
      notify(text("volume.shotDone", { name }), "success");
    } catch (error) {
      notify(error && error.message ? error.message : strings.exportPanel.failed, "error");
    }
  }

  function schemeName() {
    const found = findScheme(getState().project, schemeId);
    return found ? found.name : "";
  }

  // ——— клавиатура ———

  function onKeyDown(event) {
    if (!ours()) return;
    // Клавиши принадлежат полю ввода, пока в нём фокус: «W» в имени помещения
    // не должно уводить человека на шаг вперёд.
    if (volumeTypingTarget(event.target)) return;
    // Вопрос про этаж (таск 149) забирает клавиатуру себе: Enter переходит на
    // первый этаж из списка, Esc отказывается — и ни то, ни другое не доходит
    // до окна и до стопки диалогов. Иначе Esc закрыл бы весь объём, а Enter
    // нажал бы «Закрыть объём»: в стопке диалогов главное действие окна — она.
    if (ask) {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closeAsk();
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        event.stopPropagation();
        goToFloor(ask.options[0]);
        return;
      }
      // Остальные клавиши при открытом вопросе не ходят и не вертят: человек
      // отвечает на вопрос, а не идёт.
      return;
    }
    // Enter — переход между этажами (таск 149, G216): у лестницы спрашивает про
    // этаж, на этаже без лестницы возвращает туда, откуда пришли. Это та же
    // клавиша «согласиться», которой отвечают на сам вопрос, и единственная
    // новая в окне: E, R, V, F, W A S D, стрелки, Shift и Alt заняты. Делает
    // она ровно то же, что кнопка на поле, — и решает это одно правило.
    if (event.key === "Enter" && floorAction().kind !== "none") {
      event.preventDefault();
      event.stopPropagation();
      floorByHand();
      return;
    }
    // Esc при захвате отпускает мышь и окна не закрывает: человек жмёт его,
    // чтобы вернуть курсор, а не чтобы уйти. Перехват в фазе погружения —
    // слушатель диалогов стоит на всплытии.
    if (event.key === "Escape" && locked) {
      event.stopPropagation();
      if (typeof document.exitPointerLock === "function") document.exitPointerLock();
      return;
    }
    // Alt (на Mac — Option) отпускает мышь, пока его держат (G211): «Показывай
    // курсор не только по Esc но и по Alt\Option кнопкам». Отпустили — захват
    // просится обратно, и щёлкать по полю для этого не надо.
    //
    // `preventDefault` здесь не ставится нарочно: Alt — системный модификатор
    // ввода, и перехватывать его целиком значило бы ломать набор в других
    // полях страницы. Нам нужно его нажатие, а не его смысл.
    if (volumeAltKey(event)) {
      if (locked) {
        altFree = true;
        if (typeof document.exitPointerLock === "function") document.exitPointerLock();
      }
      return;
    }
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.code === "KeyV") {
      event.preventDefault();
      setView(view === "person" ? "around" : "person");
      return;
    }
    if (event.code === "KeyF") {
      event.preventDefault();
      fit();
      return;
    }
    // E действует на то, на что смотришь (G207, G214).
    if (event.code === VOLUME_DOOR_KEY) {
      event.preventDefault();
      actOnAim();
      return;
    }
    if (event.code === VOLUME_DOORS_KEY) {
      event.preventDefault();
      toggleAllDoors();
      return;
    }
    const known = volumeKeyMove(event.code) || event.code === "ShiftLeft" || event.code === "ShiftRight";
    if (!known) return;
    event.preventDefault();
    if (!keys.has(event.code)) keys.set(event.code, now());
    walkSchedule();
  }

  function onKeyUp(event) {
    // Отпустили Alt — мышь возвращается виду (G211). Если захвата и не было,
    // просить его по отпусканию Alt нельзя: человек не звал его вовсе.
    if (volumeAltKey(event)) {
      if (!altFree) return;
      altFree = false;
      grabPointer();
      return;
    }
    keyStop(event.code);
  }

  function onBlur() {
    keyStop(null);
    // Ушли с окна с зажатым Alt — его отпускание до нас не дойдёт, и ждать
    // его нечего: иначе следующий Alt оказался бы «уже нажатым».
    altFree = false;
  }

  function onResize() {
    if (closed) return;
    resize();
  }

  // ——— полный экран ———
  //
  // Разворачивается **само окно**, а не страница: заказчик просил «окно с
  // разворотом на полный экран», и панели за затемнением в нём не нужны.

  function toggleFullscreen() {
    Promise.resolve()
      .then(() => canvasFullscreenToggle(document, modal.card))
      .then(() => syncFullscreen())
      // Браузер отказал — кнопка уходит до перезагрузки, как на холсте:
      // спрашивать его ещё раз тем же жестом нечем.
      .catch(() => {
        denied = true;
        notify(strings.canvas.fullscreenDenied, "error");
        syncFullscreen();
      });
  }

  function onFullscreenChange() {
    if (closed) return;
    syncFullscreen();
    resize();
  }

  function syncFullscreen() {
    const on = canvasFullscreenOn(document);
    fullButton.hidden = denied || !canvasFullscreenSupported(document, modal.card);
    const label = canvasFullscreenLabel(on);
    fullButton.replaceChildren(uiIcon(on ? "fullscreenExit" : "fullscreen"));
    fullButton.title = label;
    fullButton.setAttribute("aria-label", label);
    fullButton.setAttribute("aria-pressed", on ? "true" : "false");
  }

  // ——— подписи ———

  function syncWhere() {
    where.textContent = scene.empty || view !== "person" ? "" : volumeWhere(getState().project, scene, person);
  }

  /**
   * Подсказка плашкой (G218): текст, свёрнутость и точка на кнопке.
   *
   * Разворачивать её за человека нельзя — он свернул её осознанно, и она
   * выпрыгивала бы под рукой на каждую открытую дверь. Но и молча съесть
   * сменившийся текст нельзя: кнопка получает точку и другую подпись. Правило
   * то же, что на холсте, и считает его та же `canvasHintUnseen`.
   */
  function syncHint() {
    const value = volumeHintText({
      empty: scene.empty,
      view,
      touching,
      locked,
      aim: !aimNode.hidden,
      doors: scene.doors,
      open: openDoors,
      aimedDoor: aimedDoor || heldDoor,
      stair: stairHere(),
      floors: floorOptions(),
      back: backFloor(),
    });
    hintText.textContent = value;
    hint.classList.toggle("is-collapsed", volumeHintCollapsed);
    hintText.hidden = volumeHintCollapsed;
    // Развёрнутую подсказку человек видит — значит, этот текст прочитан.
    if (!volumeHintCollapsed) volumeHintSeen = value;
    const unseen = volumeHintCollapsed && canvasHintUnseen(volumeHintSeen, value);
    hintToggle.classList.toggle("is-new", unseen);
    let label = strings.canvas.hintCollapse;
    if (volumeHintCollapsed) label = unseen ? strings.canvas.hintExpandNew : strings.canvas.hintExpand;
    hintToggle.title = label;
    hintToggle.setAttribute("aria-label", label);
    hintToggle.setAttribute("aria-expanded", volumeHintCollapsed ? "false" : "true");
  }

  function sync() {
    personButton.className = "ui-btn" + (view === "person" ? " is-on" : "");
    aroundButton.className = "ui-btn" + (view === "around" ? " is-on" : "");
    stage.classList.toggle("volume__stage--person", view === "person");
    syncAimNode();
    // Площадка ходьбы — только пальцем и только там, где ходят: в обзоре она
    // возила бы цель камеры, а не человека, и была бы просто непонятной.
    padNode.hidden = !touching || view !== "person" || scene.empty;
    if (padNode.hidden) padEnd(null);
    doorsButton.hidden = !touching || scene.empty || (scene.doors || []).length === 0;
    shotButton.hidden = scene.empty;
    if (titleNode) titleNode.textContent = volumeTitle(schemeName(), schemeFloorOf(getState().project, schemeId));
    if (scene.empty) {
      meta.textContent = strings.volume.empty;
      missing.textContent = "";
      missing.hidden = true;
      spareLine.textContent = "";
      spareLine.hidden = true;
    } else {
      const lines = [
        text("volume.counts", {
          walls: scene.wallCount,
          openings: scene.openingCount,
          rooms: scene.rooms.length,
          marks: scene.marks.length,
        }),
        ...volumeNotes(scene),
      ];
      meta.textContent = lines.join(" ");
      missing.textContent = volumeUnplacedLine(scene.unplaced);
      missing.title = volumeUnplacedTitle(scene.unplaced);
      missing.hidden = scene.unplaced.length === 0;
      const spare = scene.spare || [];
      spareLine.textContent = volumeSpareLine(spare);
      spareLine.title = volumeSpareTitle(spare);
      spareLine.hidden = spare.length === 0;
    }
    syncWhere();
    syncStair();
    syncSelection();
  }

  // ——— жизнь окна ———

  function cleanup() {
    if (closed) return;
    closed = true;
    volumeOpened = false;
    keyStop(null);
    if (frame) {
      const cancel = typeof cancelAnimationFrame === "function" ? cancelAnimationFrame : clearTimeout;
      cancel(frame);
      frame = 0;
    }
    if (locked && typeof document.exitPointerLock === "function") document.exitPointerLock();
    if (canvasFullscreenOn(document)) canvasFullscreenToggle(document, modal.card).catch(() => {});
    if (unsubscribe) unsubscribe();
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
    window.removeEventListener("pointercancel", onPointerUp);
    window.removeEventListener("resize", onResize);
    window.removeEventListener("blur", onBlur);
    document.removeEventListener("keydown", onKeyDown, true);
    document.removeEventListener("keyup", onKeyUp, true);
    document.removeEventListener("pointerlockchange", onLockChange);
    for (const name of FULLSCREEN_EVENTS) document.removeEventListener(name, onFullscreenChange);
  }

  function finish() {
    cleanup();
    modal.close();
  }

  // Чертёж могли поправить в другой вкладке того же объекта или отменой на
  // холсте — сцена пересобирается на каждое изменение объекта. Считать её
  // заново дешевле, чем следить за тем, что именно изменилось.
  const unsubscribe = subscribe
    ? subscribe((state, changed) => {
        if (closed) return;
        // Схему удалили под окном — закрываемся: смотреть нечего.
        if (!findScheme(state.project, schemeId)) {
          finish();
          return;
        }
        // Выделили метку в списке или на плане — рамка и карточка поднимаются
        // здесь: выделение одно на оба вида. То же и с показом связей.
        if ("selectedMarkIds" in changed || "linksShown" in changed) syncSelection();
        if (!("project" in changed) && !("filter" in changed)) return;
        scene = sceneOf(state) || scene;
        sync();
      })
    : null;

  stage.addEventListener("pointerdown", onPointerDown);
  stage.addEventListener("wheel", onWheel, { passive: false });
  padNode.addEventListener("pointerdown", padStart);
  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp);
  window.addEventListener("pointercancel", onPointerUp);
  window.addEventListener("resize", onResize);
  window.addEventListener("blur", onBlur);
  document.addEventListener("keydown", onKeyDown, true);
  document.addEventListener("keyup", onKeyUp, true);
  document.addEventListener("pointerlockchange", onLockChange);
  for (const name of FULLSCREEN_EVENTS) document.addEventListener(name, onFullscreenChange);

  syncFullscreen();
  sync();
  resize();
  if (!scene.empty) fit();
  if (typeof stage.focus === "function") stage.focus({ preventScroll: true });
  // Свёрнутость подсказки читается из настроек асинхронно — как на холсте:
  // плашка стартует развёрнутой и схлопывается, когда хранилище ответит.
  // То, что человек успел увидеть до ответа, прочитанным не считается: он на
  // подсказку не смотрел, она мигнула сама.
  Promise.resolve(getSetting(VOLUME_HINT_SETTING))
    .then((saved) => {
      if (closed || saved !== true) return;
      volumeHintCollapsed = true;
      volumeHintSeen = null;
      syncHint();
    })
    .catch(() => {});
  return { close: finish };
}

/** Доступен ли объёмный режим в этой раскладке. */
export function volumeAllowed(state) {
  return layoutAllows("viewVolume", state && state.layout);
}

/**
 * Есть ли в схеме чертёж: без стен и объектов объёму показывать нечего.
 *
 * Ответ один на всю сборку и живёт в сцене (`volumeDrawn`): кнопка над планом,
 * список этажей лестницы и выбор схемы в окне обязаны считать «чертёж есть»
 * одинаково, иначе кнопка гаснет там, где список предлагает перейти.
 */
export function volumeHasDrawing(project, schemeId) {
  return volumeDrawn(project, schemeId);
}

/**
 * Кнопка «3D» над планом (G209): «Сверху справа на схеме есть кнопка
 * полноэкранного режима — рядом добавь кнопку 3D которая тоже будет отображать
 * это окно».
 *
 * Открывает **то же окно**, что кнопка «Объём» в строке схемы: `openVolume`
 * один, и второго пути к объёму в сборке нет.
 *
 * Живёт она в своей точке монтирования, а не в общем наложении холста, и это не
 * прихоть: наложение собирает `canvas.js`, а объём лежит в панелях, которые
 * `canvas.js` импортируют, — положи кнопку туда, и сборка откажется склеивать
 * модули по кругу (`build.js`, «Циклический импорт»). Точка та же по счёту, что
 * у карточки метки в просмотре, и обходится она одной строкой в `index.html`.
 *
 * **Гаснет с причиной** (слова тикета): без чертежа кнопка не исчезает, а
 * становится недоступной и говорит в подсказке, чего не хватает. Исчезни она —
 * человек решил бы, что объём отвалился.
 */
function mountVolumeButton(host, api) {
  const { getState, setState, notify, subscribe } = api;
  const button = uiEl("button", {
    class: "canvas-volume",
    type: "button",
    text: strings.volume.button,
    on: {
      click: () => {
        const state = getState();
        if (!state.schemeId) return;
        openVolume({ schemeId: state.schemeId, api: { getState, setState, notify, subscribe } });
      },
    },
  });
  host.append(button);
  const render = () => {
    const state = getState();
    const shown = Boolean(state.schemeId) && volumeAllowed(state);
    button.hidden = !shown;
    if (!shown) return;
    const ready = volumeHasDrawing(state.project, state.schemeId);
    if (ready) button.removeAttribute("disabled");
    else button.setAttribute("disabled", "disabled");
    const label = ready ? strings.volume.openHint : strings.volume.noDrawing;
    button.title = label;
    button.setAttribute("aria-label", strings.volume.open + " · " + label);
    // Линейка занимает полосу сверху — мера отступа общая с кнопкой полного
    // экрана, иначе кнопки встали бы на разной высоте.
    button.style.setProperty("--canvas-hint-inset", canvasHintInset(state) + "px");
  };
  subscribe((state, changed) => {
    if ("schemeId" in changed || "guidesShown" in changed || "layout" in changed || "project" in changed) render();
  });
  render();
}

registerPanel(PANEL_IDS.canvasVolume, mountVolumeButton);
