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
import { PANEL_IDS, cancelFrame, layoutAllows, registerPanel, scheduleFrame, screenMode } from "../app.js";
import { FULLSCREEN_EVENTS, canvasFrameLinks, canvasFullscreenBare, canvasFullscreenOn } from "../canvas.js";
import { createFieldPlate, plateUnseen } from "./plate.js";
import {
  createVolumeParams,
  createVolumeParamsFields,
  volumeParamsArrive,
  volumeParamsClock,
  volumeParamsHome,
  volumeParamsLine,
  volumeParamsRead,
  volumeParamsReady,
  volumeParamsWatch,
} from "./volumeParams.js";
import { exportDownload, exportFileName, viewPng } from "../exporter.js";
import { MARK_LIST_SHOWN, markNamedList, markSpareLine, markSpareTitle } from "../markSpare.js";
import { gesturePinchOf, gesturePinchStep, gestureWheel } from "../gestures.js";
import {
  SCHEME_LIFT_KEY,
  WALL_HEIGHT_FALLBACK_MM,
  findRoom,
  findScheme,
  schemeFloorOf,
  schemeObjectsOnScheme,
} from "../model.js";
import { drawDrawing, drawingUnitBridge, visibleMarks } from "../render.js";
import { lightFadeLive, lightFadeMemo } from "../lightFade.js";
import { screenPlaceOf, screenPlacePlanRead, screenPlaceSet } from "../screenPlace.js";
import { volumeClockStamp, volumeClockText, volumeDateShort, volumeDayDateOf, volumeDayTimes } from "../clockMath.js";
import { strings, text } from "../strings.js";
import {
  VOLUME_AROUND_NEAR_MM,
  VOLUME_AROUND_PITCH_DEG,
  VOLUME_CEILING_RGB,
  VOLUME_LOOK_DEG_PX,
  VOLUME_MARK_NO_PLACE,
  VOLUME_MARK_NO_POINT,
  VOLUME_MARK_NO_SIZE,
  VOLUME_MARKER_RGB,
  VOLUME_PITCH_MAX_DEG,
  VOLUME_RUN_MM_S,
  VOLUME_SHEER_SHARE,
  VOLUME_START_PITCH_DEG,
  VOLUME_WALK_MM_S,
  VOLUME_TIGHT_MM,
  volumeAroundEye,
  volumeAroundFit,
  volumeAroundPan,
  volumeAroundReach,
  volumeAroundSpeed,
  volumeAroundTarget,
  volumeFreeMm,
  volumeBasis,
  volumeCanStand,
  volumeChannelAt,
  volumeChannelLines,
  volumeChannelLinks,
  volumeDoorAt,
  volumeDraw,
  volumeDrawBackdrop,
  volumeDrawBackdropNear,
  volumeMood,
  volumeFloorAt,
  volumeFloorPlan,
  volumeFloors,
  volumeFrame,
  volumeLinkLines,
  volumeLiveLight,
  volumeLiveSigns,
  volumeMarkAnchor,
  volumeMarkPlace,
  volumeMarkerFaces,
  volumeModelKeys,
  volumeMoodMs,
  volumeMoveTo,
  volumePickAt,
  volumeSightAt,
  volumeRoomAt,
  volumeScene,
  volumeSchemeOriginMm,
  volumeStackScene,
  volumeShadowFaces,
  volumeSunSpotFaces,
  volumeSiteOf,
  volumeDrawn,
  volumeFallTo,
  volumeGroundMm,
  volumeSelectLines,
  volumeStairLanding,
  volumeStairNear,
  volumeStanceBusy,
  volumeStanceEye,
  volumeStanceFalling,
  volumeStanceHead,
  volumeStanceJump,
  volumeStanceLanded,
  volumeStanceOnFloor,
  volumeStanceStart,
  volumeStanceStep,
  volumeStart,
  volumeStep,
} from "../volume.js";
import { markCardModel, markCardParts } from "./markCard.js";
import { deviceCardView, deviceClickPlan, deviceLiveKinds, devicePresserOf } from "./deviceCard.js";
import { openSimCommands } from "./simBar.js";
import { markAccessory } from "../sim/home.js";
import {
  SIM_STATE_SETTING,
  simAct,
  simDoor,
  simLive,
  simPress,
  simPresence,
  simProjectKey,
  simRunning,
  simStart,
  simStop,
  simWatch,
} from "../simulation.js";
import { getSetting } from "../store.js";
import { uiButton, uiDialogDepth, uiEl, uiFieldTarget, uiIcon, uiIconButton, uiSpaceTarget } from "./ui.js";

// ——— подсказка плашкой (G218) ————————————————————————————————————————————
//
// Слова заказчика: «подсказку по управлению сделай в виде как на схеме —
// кнопочка справа сверху, которую закрывать можно».
//
// Механизм общий на все три режима (G228) и живёт в `panels/plate.js`: те же
// классы, та же точка на кнопке при сменившемся тексте, те же подписи. Второго
// поведения не заводится — у человека одна рука на все поверхности.
//
// **Настройки свои**, отдельные от холста и друг от друга: подсказка и сводка
// разные, и свернув одну, он не просил сворачивать другую. Живут они в
// настройках браузера, то есть переживают перезагрузку.
const VOLUME_HINT_SETTING = "volumeHintCollapsed";
const VOLUME_SUMMARY_SETTING = "volumeSummaryCollapsed";

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

// ——— клавиши стойки (G234) ——————————————————————————————————————————————
//
// **Control приседает, пробел прыгает** — прямые слова заказчика. Обе клавиши
// лежат под большими пальцами, и обе на главном экране живут среди панелей,
// кнопок и привычных сочетаний. Развести их пришлось нарочно.
//
// **Control против Ctrl+Z, Ctrl+C, Ctrl+V.** Отличить «присесть» от
// «модификатора» в миг нажатия невозможно: первым приходит сам Control, а буква
// — через десятую долю секунды. Поэтому присед начинается сразу, а приход буквы
// с зажатым Control его **отменяет** (`"combo"`) и больше не начинает до
// отпускания. Платой был бы дёрнутый кадр на каждой отмене — её снимает
// плавность приседа (`VOLUME_CROUCH_MM_S`): за сотню миллисекунд он уходит на
// 300 мм из 550 и возвращается сам. Сочетание при этом доходит до отмены и до
// буфера нетронутым: `"combo"` не зовёт `preventDefault` и событие не
// останавливает.
//
// **Пробел против прокрутки страницы и кнопки под фокусом.** Прокрутку снимает
// `preventDefault` на нажатии; кнопку — он же вместе с `preventDefault` на
// **отпускании**: нажатие кнопки пробелом браузер делает именно по `keyup`, и
// одного нажатия тут не хватает. Сочетания с пробелом остаются системе:
// Ctrl+Space (смена раскладки), Cmd+Space (поиск), Alt+Space (меню окна) —
// стойке они не принадлежат.

/** Пробел — прыжок. */
export const VOLUME_JUMP_KEY = "Space";

/** Control он же Ctrl: приседает любой из двух. */
export function volumeCrouchKey(code) {
  return code === "ControlLeft" || code === "ControlRight";
}

/**
 * Что делает клавиша со стойкой: `"crouch"`, `"combo"`, `"jump"` или `null`.
 *
 * Чистая и вынесена наружу: правило, записанное внутри обработчика клавиши, не
 * проверяется ничем. Разбор — в разделе выше.
 */
export function volumeStanceKey(event) {
  if (volumeCrouchKey(event.code)) return "crouch";
  if (event.ctrlKey || event.metaKey) return "combo";
  if (event.code === VOLUME_JUMP_KEY && !event.altKey) return "jump";
  return null;
}

/**
 * Нужен ли таймер часа — и с какой частотой (таск 181, G282; таск 192, G292).
 *
 * `null` значит «таймера нет вовсе», и это не мелочь, а прямое требование:
 * **при остановленном времени фон не пересчитывается**, и отметка «Плавные
 * светила» этого не отменяет — она меняет период идущего таймера и только.
 * Гаснет режим — таймер тоже снимается: фон за погашенным полем считать
 * незачем, а идущее время остаётся формулой и догоняет себя само.
 *
 * Чистая и вынесена наружу: правило, записанное внутри `syncClock`, не
 * проверяется ничем — а проверять тут нужно как раз ноль пересчётов.
 */
export function volumeClockEvery(state) {
  if (!state.on) return null;
  if (state.clock && state.clock.fixed) return null;
  return volumeMoodMs(state.smooth);
}

/**
 * Куда целятся — и, с таска 159, **где нарисован прицел** (G235).
 *
 * Слова заказчика: «Когда курсор не перехвачен — тоже прицел надо отображать, а
 * клик на дверь должен тоже её открывать. Клик равноценен нажатию E на объект
 * под курсором».
 *
 * **Решение таска 151 отменено его словом.** Там прицел гас, пока курсор над
 * полем, с доводом «второй крест посреди поля обещал бы то, чего не делает».
 * Довод остался верным — и именно поэтому прицел теперь не второй крест, а
 * тот же самый: он **идёт за курсором**, пока тот над полем, и возвращается
 * посреди поля, когда мышь отдана виду. Двух прицелов не бывает ни на миг, и
 * обещает он ровно то, что делает: «клик равноценен нажатию E на объект **под
 * курсором**» — значит E и клик обязаны смотреть в одну точку, а точка эта
 * одна на оба способа и живёт здесь.
 *
 * Разбор:
 *
 *   - **мышь у вида** (захват) — курсора нет вовсе, целятся серединой поля;
 *   - **курсор над полем** — целится он;
 *   - **курсор увели** на панель или за окно — от первого лица снова середина:
 *     клавиша, переставшая работать от того, что мышь лежит на кнопке, была бы
 *     загадкой;
 *   - **в обзоре** середина поля не значит ничего (это и есть та часть решения
 *     таска 151, которую заказчик не отменял), и без курсора ответа нет.
 */
export function volumeAimAt(box, state) {
  const middle = { x: box.width / 2, y: box.height / 2 };
  if (state.locked) return middle;
  if (state.pointer) return state.pointer;
  return state.view === "person" ? middle : null;
}

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

/**
 * Живые ключи из памяти показа (таск 234, G352): что из раскрытого ещё
 * существует в этой сцене.
 *
 * Проём могли стереть между сеансами, и ключ остался бы висеть в настройке. Сам
 * по себе он безвреден — сцена спрашивает «открыта ли **эта** дверь», а не
 * «какие ключи записаны», — но копиться ему незачем: просеянное первый же кадр
 * пишет обратно, и мёртвый ключ не доживает до второго возвращения.
 *
 * Смотрим и на этажи стопки: в ней человек видит соседние этажи, и дверь,
 * открытую там, тоже надо узнать своей. Чистая и вынесена наружу ради теста —
 * ошибиться здесь значит молча закрыть дверь, которую человек оставил открытой.
 */
export function volumeOpenAlive(scene, saved) {
  const open = saved || {};
  const doors = new Set();
  const sheers = new Set();
  const add = (sub) => {
    for (const id of (sub && sub.doors) || []) doors.add(id);
    for (const id of (sub && sub.sheers) || []) sheers.add(id);
  };
  add(scene);
  for (const part of (scene && scene.stackParts) || []) add(part && part.sub);
  const kept = (list, alive) => (Array.isArray(list) ? list.filter((id) => alive.has(id)) : []);
  return { doors: kept(open.doors, doors), sheers: kept(open.sheers, sheers) };
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
  // **Над дырой — словом** (таск 209, G317). Пол у помещения сняли, человек
  // стоит над двусветным пространством, а падения в сборке нет вовсе: он
  // остаётся на своём этаже и идёт дальше. Молча это выглядело бы хождением по
  // воздуху, поэтому полоса «где я» говорит прямо. Сделать из этого падение —
  // отдельная работа: падать нужно **на нижний этаж**, то есть менять этаж под
  // ногами посреди шага.
  const hole = room && room.hasFloor === false ? " · " + strings.volume.noFloor : "";
  // Упёрлись носом в стену — об этом говорится словом, а не исправляется за
  // человека: в санузле 1,4 × 1,6 м кадр честно показывает сорок сантиметров
  // стены, и подсказать тут можно только выход — обзор.
  if (volumeFreeMm(scene.solids, at.x, at.y) < VOLUME_TIGHT_MM) {
    return place + hole + " · " + strings.volume.tight;
  }
  return place + hole;
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
 *
 * `shown` — отметка «Показывать миникарту» из окна параметров (таск 181,
 * G273). Правило про размер поля она **не отменяет и не повторяет**: это
 * второй повод не показывать карту, а не второе правило о том, где она
 * помещается. Поэтому отметка стоит здесь, в единственном месте, которое
 * отвечает «есть ли карта» — её же спрашивают и рисование, и щелчок по карте, и
 * отступ столбика стойки. Заведи её в поле отдельно — и столбик встал бы над
 * картой, которой нет.
 *
 * `room` — **место под карту при сенсорной оснастке** (правка после сборки
 * сценариев): `{top, bottom}` в точках поля. Слова заказчика: «слева снизу
 * добавить джойстик поворота камеры». Левый нижний угол с этой правки отдан
 * джойстику взгляда, и карта поднимается в левый верхний — под угловые кнопки
 * (`top`) и не ниже кнопок стойки над джойстиком (`bottom`). Не влезает в
 * зазор — её нет: лёжа на телефоне поле низкое, и карта легла бы на кнопки.
 * `null` — мышь, и карта стоит, где стояла.
 */
export function volumeMinimapBox(box, bounds, shown = true, room = null) {
  if (shown === false) return null;
  if (!bounds || !(bounds.widthMm > 0) || !(bounds.heightMm > 0)) return null;
  if (box.width < 520 || box.height < 320) return null;
  const width = Math.max(110, Math.min(220, box.width * 0.2));
  const height = Math.max(70, Math.min(box.height * 0.3, (width * bounds.heightMm) / bounds.widthMm));
  if (!room) return { x: 14, y: box.height - height - 14, width, height };
  const top = Math.max(14, Number(room.top) || 0);
  const free = (Number.isFinite(room.bottom) ? room.bottom : box.height - 14) - top;
  if (free < 70) return null;
  return { x: 14, y: top, width, height: Math.min(height, free) };
}

/** Поля внутри миникарты: чертёж не прижимается к её кромке. */
const VOLUME_MINIMAP_PAD = 8;

/**
 * Мост между миникартой и чертежом: прямоугольник накладки и перевод
 * «миллиметр → точка поля».
 *
 * Одна мерка на двоих — на рисование карты и на попадание по ней (G270).
 * Считай их врозь, и щелчок однажды поедет мимо того места, которое человек
 * видел под курсором.
 */
export function volumeMinimapView(box, bounds, shown = true, room = null) {
  const place = volumeMinimapBox(box, bounds, shown, room);
  if (!place) return null;
  const zoom = Math.min(
    (place.width - VOLUME_MINIMAP_PAD * 2) / bounds.widthMm,
    (place.height - VOLUME_MINIMAP_PAD * 2) / bounds.heightMm,
  );
  return {
    place,
    zoom,
    offsetX: place.x + (place.width - bounds.widthMm * zoom) / 2 - bounds.minX * zoom,
    offsetY: place.y + (place.height - bounds.heightMm * zoom) / 2 - bounds.minY * zoom,
  };
}

// ——— общее место трёх режимов (G276, таск 178) ———————————————————————————
//
// «При переключении Схема - Чертёж - объём мы должны находиться в одном
// месте… центр схемы\чертежа это расположение камеры в объёме. Ну и учитывай
// что может попасть на стены и т.д. тогда сдвигай».
//
// Объём здесь — **ось переноса**, и это не вольность, а прямое чтение слов: в
// них место названо расположением камеры, а схема с чертежом — тем, что этому
// месту следует. Поэтому правил ровно два:
//
//   1. входим в объём — камера встаёт туда, где была середина того поля, с
//      которого пришли (схема или чертёж);
//   2. выходим из объёма — и схема, и чертёж встают серединой на человека.
//
// Схему объём правит сам: её вид лежит в состоянии приложения (`view`). Место
// при этом **одно на три режима** и лежит в `screenPlace.js` (таск 193, D59):
// объём его читает на входе и пишет на выходе, а переводом «середина поля ↔
// миллиметры чертежа» владеет тот же модуль — своего счёта здесь больше нет.
// Масштабом объём не владеет вовсе: камера приближения не знает, и у плана с
// чертежом оно остаётся тем, которое человек выбрал до ухода.
//
// **Где это неприменимо:** у схемы без калибровки (план не привязан к
// миллиметрам) моста между долями и миллиметрами нет вовсе — обе функции
// отвечают `null`, и перенос молча не делается. Так же молчит он и у схемы без
// подложки, где вид плана не значит ничего.

/**
 * Середина поля плана в миллиметрах чертежа. `null` — моста нет.
 *
 * Счёт один на всю сборку и лежит он в `screenPlace.js` (таск 193, D59): туда
 * же смотрят холст и память вида, и разойдись эти переводы — «пиксель в
 * пиксель» разъехался бы ровно на разницу между ними.
 */
export function volumePlanCentre(project, schemeId, box, view) {
  return screenPlacePlanRead(project, schemeId, box, view);
}

// Вид плана по месту считает `screenPlace.screenPlacePlanView` — и зовёт его
// сам план, когда читает чужую запись (D61). Своей руки, которая правила бы
// плану вид из объёма, больше нет: объём говорит только «вот где человек».

/**
 * Куда на чертеже показали щелчком по миникарте (G270). `null` — мимо карты.
 *
 * Слова заказчика: «В режиме от первого лица при клике курсором на миникарте
 * телепортируй туда». Карта показывает план сверху — значит и щелчок по ней
 * значит место на плане, а не направление взгляда: за дверь, в дальнюю
 * комнату, на другой конец коридора.
 *
 * Чистая и вынесена наружу ради теста: промах здесь — это «ткнул в кухню, а
 * оказался в ванной», и ловить его глазами дорого.
 */
export function volumeMinimapAt(box, bounds, at, shown = true, room = null) {
  const view = volumeMinimapView(box, bounds, shown, room);
  if (!view || !at) return null;
  const { place, zoom } = view;
  if (!(zoom > 0)) return null;
  if (at.x < place.x || at.x > place.x + place.width) return null;
  if (at.y < place.y || at.y > place.y + place.height) return null;
  return { x: (at.x - view.offsetX) / zoom, y: (at.y - view.offsetY) / zoom };
}

// ——— сенсорная оснастка: два джойстика и кнопки над ними ——————————————————
//
// Таск 163 (G242): «на интерфейсе для планшетов и смартфонов добавь кнопки
// прыжкак и присяда» — столбик стоял слева внизу, над миникартой.
//
// Правка после сборки сценариев переставила угол целиком. Слова заказчика:
// «слева снизу добавить джойстик поворота камеры что ты можно было
// одновременно двумя управлять для движения, а кнопку действия сделай не
// буквой Е, а иконкой и расположи справа сверху над джойстиком движения, и
// прыжок и присяд в таком порядке в строку над джойстиком поворота взгляда».
//
//   слева внизу  — джойстик взгляда, над ним строкой «Прыжок» и «Присесть»;
//   справа внизу — джойстик хода, над ним «Действие».
//
// Два джойстика — две руки: правый ведёт ноги (вперёд, назад, вбок), левый —
// голову. Поворачивал с таска 149 и правый (вбок значило «повернуться»), но с
// головой на левом это стало бы вторым рулём того же поворота, и правый
// отдал вбок шагу — как в играх на два стика.
//
// Места кнопок считает `volume.css` от мер площадки, а не этот файл: прежде
// столбик поднимался над миникартой (`volumeFieldBottom`), теперь карта
// уходит из угла сама (`volumeMinimapBox`, довод `room`), и считать на поле
// остаётся только её зазор.

// ——— смена вида кнопкой на поле (таски 165 и 166, G244 и G245) ——————————
//
// «а как перейти в режим от 1 лица на мобильном интерфейсе? сделай кнопку».
//
// Переключатель вида стоял только в колонке, а колонка на телефоне и планшете
// уезжает листом снизу: чтобы сменить вид, надо было открыть лист, найти блок
// «Объём», нажать и закрыть лист. Клавиши V на телефоне нет вовсе — с поля до
// вида не дотянуться.
//
// **Кнопка одна, а не две.** Два вида — это не два состояния, которые надо
// подсвечивать: от первого лица человек стоит в комнате, в обзоре смотрит на
// неё со стороны, и в каком он виде, видно по самому кадру вернее любой
// подсветки (миникарта и та появляется только в первом лице). Значит, кнопке
// остаётся сказать не «где ты», а **куда она ведёт** — и она называет тот вид,
// в который переведёт, тем же словом, каким вид назван в колонке. Правило не
// новое: так же устроена кнопка полного экрана — подпись говорит, что
// случится по нажатию, а не то, что есть сейчас.
//
// С таска 166 слово ушло в подсказку, а на кнопке стоит значок того же вида
// (G245: «сделай её небольшой и под кнопкой полноэкранного режима»). Сказанное
// выше от этого не изменилось: значок тоже говорит, куда кнопка ведёт, — и
// именно поэтому в первом лице на ней нарисована коробка, а не человек.
//
// Своего правила «какой вид следующий» у кнопки нет: `volumeViewSwitch` — одно
// место и для неё, и для клавиши V.

/** Куда ведёт кнопка смены вида: следующий вид, его имя и подсказка. */
export function volumeViewSwitch(view) {
  const next = view === "person" ? "around" : "person";
  const label = next === "person" ? strings.volume.viewPerson : strings.volume.viewAround;
  return { next, label, title: text("volume.viewSwitch", { name: label }) };
}

// ——— сенсорное управление (таск 149) ——————————————————————————————————
//
// «Нужно планшетное управление, если зашли с планшета или смартфона».
// Заказчик смотрит с восьмидюймового.
//
// Разложено так: **палец по полю вертит головой** (это уже умеет перетаскивание
// мыши — события указателя одни и те же, и трогать его не пришлось), а ходит
// **площадка в углу поля**: вверх-вниз — шаг вперёд и назад, влево-вправо —
// шаг вбок. Поворотом влево-вправо было до правки после сборки сценариев, а
// поворачивает теперь вторая площадка — джойстик взгляда в левом углу.
//
// Почему было «поворот», а не шаг боком, как у A и D: одного пальца должно было
// хватать на всё — ходьба без поворота это ходьба в стену. С джойстиком
// взгляда пальцев стало два, и довод кончился: поворот («ходьба и поворот
// пальцем» в критериях приёмки) остался — левой площадкой и пальцем по полю, —
// а правая получила шаг вбок, как A и D.
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
 * Куда ведёт палец на площадке ходьбы: `{forward, side}` от −1 до 1 — вперёд
 * и вбок. Вбок с правки после сборки сценариев значит шаг, а не поворот:
 * поворачивает джойстик взгляда (`volumeLookVector`).
 *
 * Величина растёт от края мёртвой зоны к краю площадки: тронул слегка — идёшь
 * шагом, увёл до края — бежишь. Дальше края не считается — палец, уехавший за
 * площадку, значит то же, что палец на её краю.
 */
export function volumePadVector(dx, dy, radius) {
  const reach = radius > 0 ? radius : 1;
  const dead = reach * VOLUME_PAD_DEAD;
  const length = Math.hypot(dx, dy);
  if (!(length > dead)) return { forward: 0, side: 0 };
  const power = Math.min(1, (length - dead) / (reach - dead)) / length;
  return { forward: -dy * power, side: dx * power };
}

/** Как быстро вертит голову джойстик взгляда, увёденный до края: градусы в секунду. */
export const VOLUME_LOOK_PAD_YAW_DEG_S = 150;
export const VOLUME_LOOK_PAD_PITCH_DEG_S = 90;

/**
 * Куда ведёт палец на джойстике взгляда: `{yaw, pitch}` от −1 до 1 — доля
 * полной скорости поворота (`VOLUME_LOOK_PAD_*_DEG_S`). Вверх — взгляд
 * поднимается.
 *
 * Мёртвая зона та же, что у ходьбы, а отклик **квадратный**: у края — полный
 * разворот, у середины — тонкая доводка прицела. Линейный отклик на 150° в
 * секунду не давал навести прицел на клавишу выключателя: малейший сдвиг
 * пальца уводил взгляд на полметра.
 */
export function volumeLookVector(dx, dy, radius) {
  const reach = radius > 0 ? radius : 1;
  const dead = reach * VOLUME_PAD_DEAD;
  const length = Math.hypot(dx, dy);
  if (!(length > dead)) return { yaw: 0, pitch: 0 };
  const share = Math.min(1, (length - dead) / (reach - dead));
  const power = (share * share) / length;
  return { yaw: dx * power, pitch: -dy * power };
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

/**
 * Сколько неразмещённых меток окно называет по имени, прежде чем сказать «и
 * ещё». Мера не своя: это та же строка под тем же полем, что и перечень
 * нарисованных запасным габаритом, и живёт она в одном месте
 * (`markSpare.MARK_LIST_SHOWN`) — иначе два списка под одним полем однажды
 * оборвались бы по-разному.
 */
export const VOLUME_UNPLACED_SHOWN = MARK_LIST_SHOWN;

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
 * Перечень, который не выталкивает поле за край окна. Правило и мера — общие
 * (`markSpare.markNamedList`): под полем объёма стоят два списка — неразмещённые
 * и нарисованные запасным габаритом, — и обрываться они обязаны одинаково.
 */
function volumeNamedList(list, name, moreKey) {
  return markNamedList(list, name, moreKey);
}

/**
 * Строка про двери (G207, G210): сколько открыто и что с ними делают клавиши.
 *
 * Чистая и вынесена наружу по той же причине, что `volumeUnplacedLine`: строку,
 * собранную в обработчике кадра, не проверяет ничто. Дверей в схеме нет вовсе —
 * и строки нет: клавиша, которой нечего открывать, в подсказке лишняя.
 */
/**
 * Строка про шторы (G332) — рядом с дверной и по её образцу.
 *
 * **Шторы нет в `R`, и это решение.** `R` названа требованием G210 словами «все
 * двери», у неё свой счётчик в плашке и своя кнопка «Все двери»; сложи в неё
 * шторы — и число в плашке начнёт говорить о двух разных вещах. Штора при этом
 * не проём чертежа, а **метка** с тюлевым телом, и открывается она там же, где
 * выделяется: клик или `E` по тому, на что смотришь (G214). Захочет заказчик
 * один взмах на всё — это вторая кнопка и второй счётчик, а не смешение этих.
 *
 * Пустой список — строки нет вовсе: на схеме без штор обещать нечего, и
 * картинка у того, у кого их нет, не меняется ни словом.
 */
export function volumeSheerLine(sheers, open, aimed, touching) {
  const list = sheers || [];
  if (list.length === 0) return "";
  const count = list.filter((id) => open.has(id)).length;
  const state = text("volume.sheers", { open: count, count: list.length });
  // Пальцем клавиши E нет вовсе (таск 149): штора открывается касанием по ней,
  // ровно как дверь.
  if (touching) return state + " " + strings.volume.sheerTouch;
  return aimed ? state + " " + strings.volume.sheerAimed : state + " " + strings.volume.sheerKeys;
}

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
  // Подсказка **меняется по виду**, а не дописывается (правило таска 192,
  // G292): человеку в первом лице не пишут про полёт, летящему в обзоре — про
  // прыжок, а снявший столкновения не должен читать «сквозь стены нельзя».
  if (state.view === "person") {
    parts.push(strings.volume.hintStance);
    parts.push(state.ghost ? strings.volume.hintGhost : strings.volume.hintWalls);
    // Пальцем миникарта уходит из левого нижнего угла наверх — угол занял
    // джойстик взгляда (правка после сборки сценариев).
    parts.push(state.touching ? strings.volume.hintMinimapTouch : strings.volume.hintMinimap);
  } else {
    // Про отметку «Проходить сквозь стены» в обзоре не говорится вовсе: там
    // сквозь стены летают всегда, и галка ничего не меняет (таск 200, G304).
    parts.push(strings.volume.hintAroundFly);
  }
  // Пальцем про захват мыши говорить нечего: мыши нет (таск 149).
  if (state.touching) parts.push(strings.volume.hintTouch);
  else parts.push(state.locked ? strings.volume.hintLocked : strings.volume.hintGrab);
  parts.push(strings.volume.pickHint);
  // Про клавиши каналов — только когда они под рукой: у одноклавишного
  // выключателя и у розетки эта строка была бы шумом (таск 177, G274).
  if (state.keys) parts.push(strings.volume.channelHint);
  // Про прицел — там же, где он показан: пальцем его нет, в обзоре нет.
  if (state.aim) parts.push(strings.volume.aimHint);
  // Дом идёт (таск 09 сценариев): то, что делают E, щелчок и «Действие» с
  // устройствами. Пальцем — про кнопку «Действие», мышью — про E и щелчок.
  if (state.home) parts.push(state.touching ? strings.volume.homeTouchHint : strings.volume.homeHint);
  parts.push(volumeDoorLine(state.doors, state.open, state.aimedDoor, state.touching));
  parts.push(volumeSheerLine(state.sheers, state.openSheers || new Set(), state.aimedSheer, state.touching));
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
 * **Каким словом назвать то, у чего стоят** — лестницей или лифтом (таск 224).
 *
 * Окно перехода и его механика **одни на обоих** (G316, слова заказчика:
 * «сделай что бы она одна была»), и второго пути здесь нет: меняется
 * существительное, а не правило. Падеж берётся по месту подстановки — «рядом
 * лестница», но «вышли у лестницы».
 *
 * Все четыре марша и выход с лестницы — «лестница»: для того, кто идёт, они
 * одно и то же, а вид марша виден глазами.
 */
export function volumeFloorWord(key, at = false) {
  const lift = key === SCHEME_LIFT_KEY;
  if (at) return lift ? strings.volume.liftWordAt : strings.volume.stairWordAt;
  return lift ? strings.volume.liftWord : strings.volume.stairWord;
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
    const what = volumeFloorWord(stair.key);
    if (!options || options.length === 0) {
      return { kind: "none", label: "", title: "", hint: text("volume.stairNoFloors", { what }) };
    }
    return {
      kind: "stair",
      label: strings.volume.stairButton,
      title: strings.volume.stairButtonHint,
      hint: text("volume.stairNear", { what }),
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
 *
 * **Сам предикат — общий на три поверхности** (`uiFieldTarget`, находка 10
 * разбора механик): своих было три, и расходились они на галочке. Здесь
 * остаётся имя — его зовут клавиши окна и его проверяет тест, — а правило
 * одно. Галочка полем не считается: «W» при фокусе на ней ходит, а пробел
 * у неё отбирается отдельно и нарочно (`preventDefault` на нажатии **и** на
 * отпускании).
 */
export function volumeTypingTarget(node) {
  return uiFieldTarget(node);
}

/** Заголовок окна: с номером этажа, если он у схемы задан. */
export function volumeTitle(name, floor) {
  if (floor === null || floor === undefined) return text("volume.title", { name });
  return text("volume.titleFloor", { name, floor });
}

/**
 * Строка сводки про стопку этажей (таск 202): сколько их в кадре и который
 * ваш. Пусто — в кадре один этаж, и говорить нечего.
 *
 * Числа стен, проёмов, помещений и меток в сводке — **про свой этаж**: сцена
 * стопки остаётся сценой открытой схемы, и складывать их по этажам значило бы
 * соврать про то, что человек видит в списке меток справа.
 */
export function volumeStackLine(scene, plan) {
  if (!scene || !scene.stackMm || !plan) return "";
  return text("volume.countsFloors", {
    count: scene.stackMm.count,
    numbers: plan.floors.map((item) => item.floor).join(", "),
    floor: plan.floor,
  });
}

/** Строки про то, чего в сцене не хватает. Порядок — порядок важности. */
export function volumeNotes(scene) {
  const lines = [];
  for (const note of scene.notes || []) {
    if (note === "noRooms") lines.push(strings.volume.noRooms);
    if (note === "noBridge") lines.push(strings.volume.noBridge);
    // Число берётся у сцены, а не у константы (таск 228): высота, которую не
    // задали, выводится из того, что стоит на схеме, и бывает выше умолчания.
    // Константа в строке соврала бы ровно там, где объём и так рисует выше, —
    // и снова разошлась бы с полосой развёртки, которая выводит то же число.
    if (note === "noHeight") {
      lines.push(text("volume.noHeight", { height: scene.heightMm || WALL_HEIGHT_FALLBACK_MM }));
    }
  }
  return lines;
}

/**
 * Собрать объём на основном экране (таск 153).
 *
 * Окна у объёма больше нет: поле занимает основной экран, вид, этаж, «Вся
 * схема», снимок и двери стоят в верхнем блоке левой колонки, а правая колонка
 * показывает **тот же список меток, что и схема** — выделение у них общее и
 * всегда было общим. Полноэкранный показ даёт кнопка «Во весь экран» над полем,
 * общая на все три режима.
 *
 * Поверхность **живёт дальше, когда режим сменили**: она только гаснет
 * (`visibility` в стилях). Поэтому человек, вернувшийся в «Объём», стоит там,
 * где стоял, с теми же открытыми дверями и на том же этаже — в объект при этом
 * по-прежнему не попадает ничего (G68).
 */
// ——— имитация умного дома (таск 09 сценариев) ————————————————————————————
//
// Слова заказчика: «А так же есть 3д визуализация (Объем), где есть наглядное
// представление этих объектов» и «в Объёме по умолчанию включён, но в
// параметрах Объёма можно отключить. Да, давай пока не физический свет».
//
// Дом в «Объёме» — **тот же дом**, что в «Схеме»: одна имитация на сеанс
// (`simulation.js`), одно правило «что рисовать» (`simLiveOf`), один щелчок и
// одна карточка (`panels/deviceCard.js`). Своего здесь — только то, что есть у
// «Объёма» и нет у плана: свечение тел и свет комнаты (`volumeLiveLight`),
// шторы по позиции, ходьба, которая будит датчики, и двери, которые двигают
// датчик открытия. В объект не пишется ничего (G68): живое состояние —
// зеркало имитации и память браузера.
//
// Ниже — чистые правила; провода — внутри `createVolume`.

/**
 * Состояние дома для кадра: `Map<markId, {on, level, alert, open, pressedAt,
 * kind, roomId}>` — `simLive` объекта, к которому приписан вид знака и
 * помещение метки (`deviceLiveKinds` — один на «Схему», мини-план и «Объём»).
 */
export function volumeSimLive(project, live) {
  const out = new Map();
  if (!project || !live) return out;
  const meta = deviceLiveKinds(project);
  for (const [markId, item] of live) {
    const own = meta.get(markId);
    if (own) out.set(markId, { ...item, kind: own.kind, roomId: own.roomId });
  }
  return out;
}

/**
 * Позиции штор сцены по состоянию дома: `Map<markId, 0…1>` — только у штор,
 * которые в доме и есть шторы (`WindowCovering`). Штора без аксессуара позиции
 * не получает и открывается своей памятью, как до имитации.
 */
export function volumeSimCurtains(scene, live) {
  const out = new Map();
  if (!scene || !live) return out;
  for (const id of scene.sheers || []) {
    const item = live.get(id);
    if (item && item.kind === "curtain") out.set(id, Math.max(0, Math.min(1, Number(item.open) || 0)));
  }
  return out;
}

/**
 * Где человек — для датчиков движения и присутствия (история 2.8): помещение
 * объекта, в чьём контуре он стоит, списком; на улице и в контуре без
 * помещения — пустой список.
 */
export function volumeSimRooms(scene, at) {
  if (!scene || !at) return [];
  const room = volumeRoomAt(scene, at);
  return room && room.roomId ? [room.roomId] : [];
}

/**
 * Что делают `E` и щелчок по метке при запущенном доме (истории 2.5–2.7):
 *   `{kind: "press", index}` — привязанная клавиша: одиночное сразу;
 *   `{kind: "hold", index}` — отвязанная клавиша или отдельная кнопка: нажатие
 *     распознаётся (`devicePresserOf`) — одиночное, двойное, долгое;
 *   `{kind: "toggle"}` — свет, штора, телевизор, розетка;
 *   `{kind: "sensor", service}` — датчик срабатывает;
 *   `{kind: "none"}` — щёлкать нечем (или мимо клавиши многоклавишного).
 * `channel` — клавиша под рукой (`volumeChannelAt`), `null` — мимо клавиш.
 */
export function volumeSimAction(accessory, channel) {
  const plan = deviceClickPlan(accessory);
  let key = null;
  if (plan.kind === "key") key = plan.key;
  else if (plan.kind === "keys") key = plan.keys.find((item) => item.channel === channel) || null;
  if (key) return { kind: key.detect ? "hold" : "press", index: key.index };
  if (plan.kind === "sensor") return { kind: "sensor", service: plan.service };
  if (plan.kind === "toggle") return { kind: "toggle" };
  return { kind: "none" };
}

/** Зазор между карточкой метки и кнопками поля, и меньшие её мерки (G21). */
export const VOLUME_CARD_GAP = 10;
export const VOLUME_CARD_MIN_WIDTH = 240;
export const VOLUME_CARD_MIN_HEIGHT = 96;

/**
 * **Где встать карточке метки, когда на поле сенсорная оснастка** (таск 09
 * сценариев, G21, история 8.6). Слова заказчика: «при выделении метки её
 * плашка заползает под кнопки управления, как-то не хорошо».
 *
 * `box` — поле, `controls` — прямоугольники кнопок в точках поля (столбик
 * стойки с «Действием», площадка ходьбы), `top` — где кончается верхний ряд
 * угловых кнопок. Ответ — отступы карточки от краёв поля `{left, right,
 * bottom, maxHeight}`, или `null`, если оснастки нет и карточка стоит, как
 * стояла.
 *
 * Правило одно на обе ориентации: карточка встаёт **между** столбиками внизу,
 * если там хватает ширины (лёжа), а иначе — **над** ними во всю ширину
 * (стоя). Высота — что осталось до верхнего ряда; длинная карточка листается
 * своим телом.
 */
export function volumeCardPlace(box, controls, top = 0) {
  const list = (controls || []).filter((rect) => rect && rect.right > rect.left && rect.bottom > rect.top);
  if (!box || list.length === 0) return null;
  const gap = VOLUME_CARD_GAP;
  const middle = box.width / 2;
  let leftEdge = gap;
  let rightEdge = gap;
  for (const rect of list) {
    if ((rect.left + rect.right) / 2 < middle) leftEdge = Math.max(leftEdge, rect.right + gap);
    else rightEdge = Math.max(rightEdge, box.width - rect.left + gap);
  }
  const between = box.width - leftEdge - rightEdge;
  const roof = Math.max(0, Number(top) || 0) + gap;
  if (between >= VOLUME_CARD_MIN_WIDTH) {
    const maxHeight = Math.max(VOLUME_CARD_MIN_HEIGHT, box.height - gap - roof);
    return { left: leftEdge, right: rightEdge, bottom: gap, maxHeight };
  }
  const highest = Math.min(...list.map((rect) => rect.top));
  const bottom = box.height - highest + gap;
  const maxHeight = Math.max(VOLUME_CARD_MIN_HEIGHT, box.height - bottom - roof);
  return { left: gap, right: gap, bottom, maxHeight };
}

/**
 * Какие шторы открыть в доме по прежней памяти показа (история 2.14: «прежняя
 * память открытых дверей и штор читается»): дом здесь ещё не запускали
 * (`known` — в памяти браузера нет его записи), а штора в памяти открыта и в
 * доме она штора. Дом, который себя помнит, старше памяти показа.
 */
export function volumeSimSeed(sheers, memory, curtains, known) {
  if (known || !memory) return [];
  return (sheers || []).filter((id) => memory.has(id) && curtains.has(id));
}

function createVolume({ api, hosts }) {
  const { getState, setState, notify, subscribe } = api;
  const project = getState().project;
  if (!findScheme(project, getState().schemeId)) return null;

  // Какую схему показываем. **Переменная, а не аргумент**: лестница меняет этаж,
  // то есть меняет схему под той же камерой (таск 149), и схему же меняют в
  // списке схем — объём идёт за выбором человека, не выходя из режима.
  //
  // Этаж, на который человек поднялся, становится текущей схемой всего
  // приложения (таск 153): иначе список меток справа показывал бы метки того
  // этажа, с которого человек уже ушёл, а шапка — его имя.
  let schemeId = getState().schemeId;

  // Метки берутся **видимые на плане**: фильтр спрятал метку на плане — её нет
  // и в объёме. Иначе у одного объекта было бы два ответа на вопрос «что
  // сейчас показано».
  const sceneMarks = (state, id = schemeId) => {
    const scheme = findScheme(state.project, id);
    return scheme ? visibleMarks(state.project, scheme, state.filter) : [];
  };
  // Раскрытые двери (G207). Живут **в сеансе окна**: закрыл дверь в объёме — в
  // файл не попадает ничего (G68), и объект после прогулки байт в байт тот же.
  // Поэтому это и не поле проёма, а аргумент сборки сцены.
  const openDoors = new Set();
  // Раскрытые шторы (G332) — то же множество и то же место, что у дверей: сеанс
  // окна, а не поле метки. Открыл штору в объёме — в файл не попало ничего
  // (G68), и объект после прогулки байт в байт тот же.
  const openCurtains = new Set();
  // Сколько раз трогали открытое и когда об этом сказали общей записи: кадру
  // незачем перебирать множества, пока в них ничего не менялось. Начальные
  // значения разные нарочно — первый кадр обязан сказать, что поднялось из
  // памяти (просеянное) или что открытого нет вовсе.
  let openRev = 1;
  let openSaid = 0;
  // ——— имитация умного дома (таск 09 сценариев) ———
  //
  // Всё здесь — сеанс поверхности: в объект не пишется ничего (G68). Дом один
  // на страницу (`simulation.js`), «Объём» только запускает его по отметке,
  // показывает и трогает руками.
  //
  // `homeHere` — дом запустил «Объём»: он же и остановит его, уходя, — иначе
  // «Схема» после прогулки оказалась бы в режиме имитации без единого нажатия
  // «Запустить». Дом, запущенный в «Схеме», «Объём» не останавливает.
  let homeHere = false;
  // Окно параметров ответило из хранилища, и известно, помнит ли себя дом:
  // снятая отметка не запускает дом даже на миг.
  let homeReady = false;
  let homeKnown = true;
  let homeSeeded = false;
  // Был ли дом включён для поля при прошлой сверке: по переходу поле встаёт
  // в дом (двери, датчики, человек) или выходит из него.
  let homeWas = false;
  // Состояние дома для света кадра (`volumeSimLive`) и позиции штор, по которым
  // собрана сцена. Позиции меняются шагами по 10 % хода — сцена пересобирается
  // только на сдвиг шторы, свет идёт в кадр без пересборки. Свет кадр берёт
  // плавным (`lightFadeLive`, правка после сборки сценариев: «для всего света
  // сделаем плавное включение и отключение») — память плавности у поля своя.
  let homeTarget = null;
  const homeFade = lightFadeMemo();
  let homeShares = new Map();
  // Поле погасло, а дом жил: свет и шторы сверяются на возвращении.
  let homeStale = false;
  // Что сказано дому о человеке: строка помещений или `null` — не говорили.
  let homePlace = null;
  // Нажатие клавиши, начатое E или кнопкой «Действие» (отпускание — там же),
  // и начатое мышью или пальцем на поле (отпускание — щелчком).
  let homeHeld = null;
  let homeGesture = null;
  // Карточка устройства в карточке метки — та же, что в «Схеме».
  let homeCard = null;
  // Что было в окне параметров: отметки дома и карточки сверяются по переходу,
  // а не на каждый перевод часов.
  let homeParams = { simulation: null, hideCard: null };
  // Открытые шторы, поднятые из памяти показа, — до того как дом их тронул.
  const homeMemory = new Set();
  // Подписка на зеркало дома; снимается вместе с поверхностью.
  let stopHome = null;
  /** Дом идёт и «Объём» его показывает: отметка стоит, дом запущен. */
  // `closed` здесь не спрашивается: он объявлен ниже, а первая сборка сцены
  // зовёт это правило раньше; разобранная поверхность не спрашивает его вовсе.
  const homeOn = () => volumeParamsRead().simulation === true && simRunning();
  // «Скрыть все объекты» — та же отметка, только разом: сцена собирается без
  // единой вещи чертежа. Отдельного выключателя у сцены нет нарочно — иначе
  // ответов на «что показано» стало бы два.
  const sceneObjectIds = (state, id) =>
    schemeObjectsOnScheme(state.project, id).map((object) => object.id);
  // Доводы сборки — **одни на все этажи стопки** (таск 202): фильтр меток,
  // открытые двери и спрятанные вещи обязаны значить на чужом этаже то же, что
  // на своём, иначе у вопроса «что сейчас показано» стало бы два ответа.
  const sceneOptions = (state, id) => ({
    marks: sceneMarks(state, id),
    openDoorIds: openDoors,
    openCurtainIds: openCurtains,
    // Шторы по позиции дома (таск 09 сценариев) — только при запущенной
    // имитации: без неё доводов позиции нет, и штора та же, что до таска.
    ...(homeOn() ? { curtainShares: homeShares } : {}),
    // «Снять крышу» (таск 212, G319): отметка окна параметров. Доезжает до
    // **каждого** этажа стопки — крыша снимается у всех, а не только у
    // верхнего; разбор у самой грани в `volumeScene`.
    roofOff: volumeParamsRead().roofOff === true,
    // Спрятанные вещи чертежа (таск 154, G223): «Скрытое не видно на чертеже
    // и в объёме». Отметка приходит из сеанса, в объект не пишется.
    hiddenObjectIds: state.objectsShown === false ? sceneObjectIds(state, id) : state.hiddenObjectIds,
    // «Подсвечивать метки» (таск 14 сценариев, G15): контур изображения поверх
    // модели метки. Отметка раздела «Интерфейс», умолчание — снята.
    markImages: state.marksHighlight === true,
  });
  /**
   * Какие этажи показывает окно (таск 202): стопка или одна открытая схема.
   *
   * Отметка «все этажи» живёт в настройках браузера, а список этажей — в
   * объекте (номера схем). Поэтому ответ считается каждый раз заново: схему
   * могли переименовать, этаж — задать или снять, а отметку — переставить в
   * окне параметров.
   */
  const floorPlan = (state) => volumeFloorPlan(state.project, schemeId);
  const stacking = (state, plan) => volumeParamsRead().floorsAll === true && (plan || floorPlan(state)).can;
  // Сцена объёма — одна на поверхность, и её же прошлое состояние идёт доводом
  // сборки (таск 232): стопка разобрана в ней на этажи, и каждый берётся
  // готовым, если собран из того же. Открытая дверь чужих этажей не касается, а
  // смена этажа прибытия — переставляет их, а не пересобирает. Второго ответа о
  // сцене это не заводит: доводом идёт она сама.
  let scene = null;
  const sceneOf = (state) => {
    const plan = floorPlan(state);
    if (stacking(state, plan)) {
      const stack = volumeStackScene(state.project, plan, (id) => sceneOptions(state, id), scene);
      if (stack) return stack;
    }
    return volumeScene(state.project, schemeId, sceneOptions(state, schemeId));
  };

  // ——— что было открыто (таск 234, G352) ————————————————————————————————
  //
  // Двери и шторы поднимаются из памяти показа **до** первой сборки сцены: она
  // спрашивает оба множества доводом, и подними их позже — дом собрался бы
  // закрытым, а потом пересобрался открытым, то есть вдвое (кэш этажей таска
  // 232 ровно на такие пересборки и заведён).
  //
  // Мёртвые ключи при этом не страшны: сцена спрашивает «открыта ли **эта**
  // дверь», а не «какие ключи записаны». Просеиваются они сразу после сборки —
  // по живой сцене, — и первый же кадр записывает просеянное обратно.
  const savedOpen = screenPlaceOf(schemeId);
  if (savedOpen && savedOpen.open) {
    for (const id of savedOpen.open.doors) openDoors.add(id);
    for (const id of savedOpen.open.sheers) openCurtains.add(id);
    for (const id of savedOpen.open.sheers) homeMemory.add(id);
  }

  scene = sceneOf(getState());

  if (savedOpen && savedOpen.open) {
    const alive = volumeOpenAlive(scene, { doors: [...openDoors], sheers: [...openCurtains] });
    openDoors.clear();
    for (const id of alive.doors) openDoors.add(id);
    openCurtains.clear();
    for (const id of alive.sheers) openCurtains.add(id);
  }
  // ——— час суток (таск 181, G282) ———
  //
  // Снимок часа (`volumeMood`) держится здесь и пересчитывается **не чаще раза
  // в секунду** — прямое требование заказчика («не каждый кадр, а, хотя бы раз
  // в секунду»). Кадр о времени не знает ничего: он берёт готовые цвета, тон
  // комнаты и готовые грани тени.
  //
  // **Стоячее время не считается вовсе:** таймера нет, снимок посчитан один раз
  // и живёт, пока человек не тронет часы. Погас режим — таймер тоже снимается:
  // поверхность жива, но фон за погашенным полем пересчитывать незачем, а
  // идущее время — формула, и вернувшийся человек получает свой час одним
  // умножением (`volumeClockMinutes`).
  let hour = null;
  let hourTick = 0;
  // С какой частотой таймер поставлен; `null` — таймера нет. Нужна затем, что
  // отметка «Плавные светила» (таск 192) меняет **период** живого таймера: без
  // этого числа `syncClock` увидел бы «таймер уже идёт» и оставил бы прежнюю
  // секунду.
  let hourEvery = null;
  // Грани тени дома в этот час: собираются вместе со снимком, а не в кадре.
  let shadow = [];
  // Солнечные пятна от проёмов в этот час (таск 196) — там же, где тень, и по
  // той же причине: час меняется раз в секунду, а кадров в секунде шестьдесят.
  let spots = [];
  let view = "around";
  let closed = false;
  let frame = 0;
  let walking = 0;
  let clock = 0;
  const keys = new Map();
  let look = null; // перетаскивание мышью: {x, y}
  let locked = false;
  // Где рука: точка поля под курсором (без захвата) — ею целятся в дверь.
  let pointer = null;
  // Дверь под рукой и дверь, по которой щёлкнули. Заказчик назвал оба способа:
  // «по клику на них или когда наведён курсор».
  let aimedDoor = null;
  let heldDoor = null;
  // Метка под прицелом — только ради строки про штору (G332), и считается она
  // лишь на схемах со шторами.
  let aimedMark = null;
  const aimedSheer = () => Boolean(aimedMark && (scene.sheers || []).includes(aimedMark));
  // Alt отпустил мышь, и по отпусканию Alt её надо забрать обратно (G211).
  let altFree = false;
  // Зашли пальцем (таск 149). Догадка по виду указателя — сразу, точный ответ —
  // по первому касанию: мышь площадку ходьбы не увидит никогда.
  let touching = volumeTouchLikely();
  // Палец на площадке ходьбы: `{id, forward, side}`.
  let pad = null;
  // Палец на джойстике взгляда: `{id, yaw, pitch}` (`volumeLookVector`).
  let lookPad = null;
  // Где на поле есть место миникарте при сенсорной оснастке — `{top, bottom}`
  // или `null` (`volumeMinimapBox`). Меряется вместе с местом кнопок.
  let minimapRoom = null;
  // Два пальца на поле: `{distance, center}` от общего `gesturePinchStep` —
  // прошлый разведённый промежуток и прошлая середина между пальцами.
  let pinch = null;
  // Серия колеса: `{kind, time}` от общего `gestureWheel` (таск 195). Нужна
  // затем же, зачем плану и чертежу: внутри одного маха трекпада решение
  // «листать или приближать» не меняется, иначе разогнавшийся мах переключался
  // бы на зум на полпути.
  let wheelStreak = null;
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
  // Человек: место на плане, рысканье и наклон. Высоту глаз он больше не носит
  // с собой — её даёт стойка (G234), и постоянной она быть перестала по слову
  // заказчика: «на клавишу Control функцию Присесть, а на пробел - прыжок».
  const person = { x: start.x, y: start.y, yaw: start.yaw, pitch: (VOLUME_START_PITCH_DEG * Math.PI) / 180 };
  // ——— стойка (G234) ———
  //
  // Присед и прыжок живут **в сеансе поверхности**, как открытые двери: в
  // объект не пишется ничего (G68). Счёт весь в `volume.js` — здесь только
  // руки: кто держит Control, кому не дали встать и о чём сказать вслух.
  let stance = volumeStanceStart();
  // Держат ли Control. Отдельно от `crouchStuck`: отпустивший Control под
  // низким потолком человек остаётся присевшим, но **хотеть** приседа он
  // перестал, и встанет он сам, как только выйдет.
  let crouchHeld = false;
  let crouchStuck = false;
  // Палец на кнопке «Ниже» в обзоре (таск 163, G242): `null` — кнопку не
  // держат. Отпускание ищут по нему, иначе спуск, начатый кнопкой, снимался бы
  // любым касанием поля.
  let crouchFinger = null;
  // Присед, включённый кнопкой (правка после сборки сценариев: «присед сделай
  // не удержанием, а переключением»). Отдельно от Control: клавишу держат,
  // кнопку нажимают раз, и отпущенный Control не поднимает того, кто присел
  // кнопкой.
  let crouchLatched = false;
  // Держат ли пробел — и палец на той же кнопке (таск 192, G292; таск 200,
  // G304). **В обзоре** пробел не прыгает, а поднимает камеру, пока его
  // держат, и у этого «держат» своя пара переменных: прыжок разовый, и ему
  // держать было нечего.
  let riseHeld = false;
  let riseFinger = null;
  // Про «встать негде» говорится один раз на попытку, а не каждый кадр.
  let stuckSaid = false;
  // ——— падение в дыру (таск 229, G342) ———
  //
  // Счёт весь в `volume.js` (`volumeFallTo` и стойка) — здесь три руки: на
  // какой этаж падаем, снимок этого ответа и «сказали, что падать некуда».
  //
  // `fallAt` — выбранный этаж. Он же **зарок**: начав падать, не всплывают.
  // Пол под ногами может вернуться посреди полёта (человек рулит в воздухе и
  // уходит за кромку дыры), и спроси мы заново — его вытолкнуло бы наверх, на
  // тот этаж, который он уже покинул глазами.
  let fallAt = null;
  // Снимок ответа: пока сцена и место те же, второй раз этажи не опрашиваются.
  // Спрашивается это из `moving()`, то есть несколько раз за тик.
  let fallSnap = null;
  let fallSaid = false;
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
  // ——— обзор: свободная камера (таск 200 G304, таск 207 G312) ———
  //
  // Хранятся **место камеры и её взгляд**, и больше ничего. Орбиты нет: мышь
  // вертит обзор на месте, как в первом лице, — прямое слово заказчика
  // («почему движение мыши… перемещает камеру вокруг какой-то цели, а не
  // просто поворачивает камеру как при виде от 1 лица? должно быть так же»).
  //
  // `distance` в состоянии **не выбор, а счёт**: мера обзора
  // (`volumeAroundReach`) — докуда он достаёт до пола по взгляду. Её пишет
  // один `aroundSet`, и живого выбора «расстояние до цели» в сборке больше нет
  // — второго смысла у числа взяться неоткуда.
  let around = null;
  aroundSet(
    volumeAroundEye(
      { x: start.x, y: start.y, z: 1200 },
      start.yaw,
      (VOLUME_AROUND_PITCH_DEG * Math.PI) / 180,
      VOLUME_AROUND_NEAR_MM,
    ),
    start.yaw,
    (VOLUME_AROUND_PITCH_DEG * Math.PI) / 180,
  );

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
  // Джойстик взгляда (правка после сборки сценариев): «слева снизу добавить
  // джойстик поворота камеры». Та же площадка, что у ходьбы, зеркально в
  // левом углу, — две руки и две площадки одного вида.
  const lookKnob = uiEl("span", { class: "volume__padKnob" });
  const lookNode = uiEl(
    "div",
    {
      class: "volume__pad volume__pad--look",
      attrs: { hidden: "hidden", "aria-hidden": "true", title: strings.volume.lookPadLabel },
    },
    [lookKnob],
  );
  // Присед и прыжок пальцем (таск 163, G242). Своих правил у кнопок нет: они
  // зовут ровно то, что зовут Control и пробел, — `crouchStart`/`crouchStop` и
  // `jump`. Числа стойки (550 мм приседа, 300 мм прыжка, полсекунды дуги)
  // живут в `volume.js` и про то, какой рукой их позвали, не знают. Присед
  // пальцем с правки после сборки сценариев не держат, а переключают
  // (`crouchLatch`): «присед сделай не удержанием, а переключением».
  const jumpButton = uiIconButton("jump", {
    class: "ui-btn volume__stanceBtn",
    label: strings.volume.jump,
    title: strings.volume.jumpHint,
    on: { click: () => jump() },
  });
  const crouchButton = uiIconButton("crouch", {
    class: "ui-btn volume__stanceBtn",
    label: strings.volume.crouch,
    title: strings.volume.crouchHint,
  });
  // «Действие» пальцем (таск 09 сценариев, G20): «добавь кнопку действия
  // (которая аналогично E на клавиатуре)». Своего правила у неё нет — она зовёт
  // ровно то, что E: дверь и штора под прицелом, при запущенном доме —
  // устройство и клавиша, и у отвязанной клавиши удержание кнопки — то же
  // удержание E (одиночное, двойное, долгое по одному распознавателю).
  // Значок — рука с касанием (`tap`), не буква: «кнопку действия сделай не
  // буквой Е, а иконкой». Стоит она отдельно от стойки — над джойстиком хода,
  // под правым пальцем: целятся головой, жмут ногами.
  const actionButton = uiIconButton("tap", {
    class: "ui-btn volume__stanceBtn volume__actionBtn",
    label: strings.volume.action,
    title: strings.volume.actionHint,
    attrs: { hidden: "hidden" },
  });
  // Строка стойки над джойстиком взгляда: «прыжок и присяд в таком порядке в
  // строку». Место — у строки, а не у кнопок (`volume.css`).
  const stanceBox = uiEl("div", { class: "volume__stance", attrs: { hidden: "hidden" } }, [jumpButton, crouchButton]);
  // Смена вида кнопкой прямо на поле (таск 165, G244), значком под кнопкой
  // полного экрана (таск 166, G245).
  //
  // Слова заказчика: «кнопка От первого лица слишком большая, сделай её
  // небольшой и под кнопкой полноэкранного режима». Таск 165 ставил её плашкой
  // со словом в 132 точки нижней ячейкой левого столбика — столбик вернулся
  // стойке, а кнопка уехала во **вторую ячейку правого верхнего угла**.
  //
  // *Почему значок, а не слово.* В углу стоят кнопки размером в полтора
  // сантиметра, и слово «От первого лица» туда не влезает ни в какой вид.
  // Значок говорит то же самое: человек — «встань в комнате», коробка с дугой
  // — «отойди и обойди». Слово при этом не потеряно — оно в подсказке и в
  // `aria-label`, как у всех кнопок-значков сборки.
  //
  // *Почему под полным экраном, а не рядом.* Это одна оснастка поля: смотреть
  // во весь экран и смотреть откуда — соседние решения, и рука находит их в
  // одном углу. Мера у ячеек общая (`--canvas-corner-*` в `canvas.css`): своё
  // число здесь значило бы, что поправь кнопку полного экрана — и столбик
  // разъедется.
  //
  // *Место не уезжает из-под пальца* (довод таска 165): в правом верхнем углу
  // ничего не схлопывается — кнопка полного экрана стоит в обоих видах, и
  // вторая ячейка остаётся второй. Браузер полного экрана не даёт вовсе (G208:
  // установленное приложение) — первая ячейка пустует, а кнопка вида остаётся
  // на своём месте: считать чужое отсутствие она не умеет, и прыгающее место
  // было бы хуже пустого угла.
  //
  // *Кнопка видна и мышью.* Таск 165 показывал её только пальцем — у мыши есть
  // колонка и клавиша V. С таска 166 этого мало: в полном экране «Объёма»
  // колонок нет вовсе (G246), и без кнопки мышиный вид менялся бы только
  // клавишей — то есть никак для того, кто про неё не знает.
  const viewButton = uiButton("", {
    class: "canvas-corner volume__viewBtn",
    attrs: { hidden: "hidden" },
    on: { click: () => setView(volumeViewSwitch(view).next) },
  });
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
  // Дата и час симуляции — полосой в правом нижнем углу поля (таск 191, G300).
  //
  // Слова заказчика: «Справа снизу в Объёме пиши текущие дату и время
  // симуляции». До этого они жили только в окне параметров: закрыл окно — и при
  // ускорении в 480 раз непонятно, какой час на объекте, а по кадру час
  // угадывается разве что до «день или ночь».
  //
  // Правый угол, а не левый: слева внизу стоят миникарта (G212) и столбик
  // стойки (таск 163), и они там по прямому слову заказчика.
  //
  // Строку пишет **тот же снимок часа**, который красит небо (`refreshHour`), и
  // другого времени у поля нет: заведи полоса свои часы — они разошлись бы с
  // небом на первой же правке ускорения. Отсюда и частота: раз в секунду, а при
  // остановленном времени таймера нет вовсе (G282) — полоса стоит и не мигает.
  const clockNode = uiEl("div", { class: "volume__clock", attrs: { hidden: "hidden" } });
  // Что на полосе уже написано: с плавными светилами снимок часа считается
  // тридцать раз в секунду, а минута на полосе столько раз не меняется.
  let clockSaid = { value: null, line: null };
  // Подсказка по управлению — плашка **слева** со знаком «?» (G228): правило
  // одно на все три режима, и кирпич у них общий (`panels/plate.js`). Справа
  // стоит сводка, а ещё правее — кнопка полноэкранного показа.
  const hintPlate = createFieldPlate({ side: "left", setting: VOLUME_HINT_SETTING });
  // ——— параметры объёма: ряды в колонке, окно там, где колонки нет ————————
  //
  // Доводы у поля одни на оба места, поэтому и собираются они здесь, рядом:
  // час, рассвет и список этажей параметры спрашивают **у поля**, а не считают
  // сами — иначе в сборке стало бы два ответа на вопрос «который час в объёме»,
  // и расходились бы они ровно в ту секунду, на которую поле снимок
  // придерживает.
  const paramsDoors = {
    now: () => Date.now(),
    hour: () => hourNow(),
    times: () => dayTimes().times,
    // Этажи параметры спрашивают у объекта через поле: номера живут в схемах, и
    // пересчитывать их надо на каждую пересборку — схему могли переименовать
    // или задать ей этаж, не выходя из режима.
    floors: () => floorPlan(getState()),
    // «Показывать этаж 2» и значит «открыть второй этаж»: схема ставится в
    // состояние приложения, а дальше работает та же дверь, которой идёт выбор
    // схемы в шапке (G217) и переход по лестнице. Второго способа сменить
    // схему здесь не заводится.
    goFloor: (option) => setState({ schemeId: option.schemeId }),
  };
  // Ряды в левой колонке (таск 231, G349) — главное место: обычная раскладка
  // показывает их, и кнопки в углу поля при ней нет вовсе.
  const paramsFields = createVolumeParamsFields(paramsDoors);
  // Кнопка параметров — **левый** верхний угол поля (таск 191, G291): «кнопку
  // настроек отображения в 3д режиме перенеси налево». Левый угол устроен тем
  // же столбиком ячеек, что правый, кнопка в нём первая, а подсказка со знаком
  // «?» уступает ей угол и встаёт второй (`volume.css`).
  //
  // С таска 231 кнопка живёт не всегда, а там, где колонки нет (G351): в узкой
  // раскладке и в полном экране. Решает это одно место — `volumeParamsHome`, и
  // спрашивает его поле (`syncParamsHome`): про полный экран и про раскладку
  // знает оно, и второго ответа на «где сейчас параметры» в сборке нет.
  const paramsButton = createVolumeParams(paramsDoors);
  // Выбор человека поле слушает **всю свою жизнь**, а не пока открыто окно:
  // этой же подпиской приезжают настройки из хранилища (читаются они
  // асинхронно, как у плашек и слоёв, и первый кадр рисуется умолчаниями).
  const stopParams = volumeParamsWatch(() => paramsChanged());
  const stage = uiEl("div", { class: "volume__stage", attrs: { tabindex: "-1" } }, [
    node,
    card,
    stairButton,
    padNode,
    lookNode,
    stanceBox,
    actionButton,
    viewButton,
    paramsButton.node,
    aimNode,
    clockNode,
    hintPlate.node,
    askBox,
  ]);
  const ctx = node.getContext ? node.getContext("2d") : null;

  // ——— поле меряется по своему прямоугольнику (таск 231, дефект D79) ————
  //
  // `resize()` звали события, которые **могли** изменить ширину поля: окно
  // потянули, вошли в режим, вышли из полного экрана. Ширину при этом меняет и
  // то, о чём событий нет: ручка колонки (`is-left-hidden`) и уход правой
  // колонки вместе с режимом (G348). Найдено живым прогоном: свернёшь ручкой
  // левую колонку в объёме — стойка 1582 точки, холст остаётся 1072, и справа
  // зияет чёрная полоса в четверть кадра. Дефект старше таска: на `main` он
  // воспроизводится ручкой, а с уходом правой колонки стал виден при каждом
  // входе в режим.
  //
  // Правильного события тут нет и быть не может: `data-screen` страница ставит
  // **после** оповещения подписчиков (`app.setState`), то есть в миг
  // переключения поле мерило бы прежнюю ширину, сколько ни зови. Поэтому
  // ширину сторожит сам прямоугольник.
  //
  // Холостых перерисовок это не добавляет: наблюдатель сверяет меру с той, по
  // которой холст уже нарезан, и равную пропускает.
  let stageSize = { width: 0, height: 0 };
  const stageWatch =
    typeof ResizeObserver === "function"
      ? new ResizeObserver(() => {
          if (closed) return;
          const box = viewport();
          if (box.width === stageSize.width && box.height === stageSize.height) return;
          stageSize = box;
          resize();
        })
      : null;
  if (stageWatch) stageWatch.observe(stage);


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
  const commandButton = uiButton(strings.sim.bar.command, {
    class: "ui-btn",
    title: strings.sim.bar.commandHint,
    on: { click: () => openSimCommands(api) },
  });
  const commandRow = uiEl("div", { class: "volume__tools", attrs: { hidden: "hidden" } }, [commandButton]);
  const where = uiEl("p", { class: "volume__where" });
  const meta = uiEl("p", { class: "volume__meta" });
  const missing = uiEl("p", { class: "volume__missing" });
  // Нарисованные запасным габаритом (G215) — своей строкой рядом с
  // неразмещёнными: новость другая («вещь есть, но размер выдуман»), а место и
  // цвет те же — в объекте не хватает числа, и сказать об этом надо там, где
  // человек уже читает про недостающее.
  const spareLine = uiEl("p", { class: "volume__missing" });

  // ——— где что стоит на основном экране (таск 153) ———
  //
  // Подсказка про управление — плашка в поле (G218, таск 152), она переехала
  // вместе с полем и не переделывалась. Строки про объект (где стоит человек,
  // счёт чертежа, недостающее, запасные габариты) собраны во вторую плашку —
  // под полем места больше нет, поле занимает экран целиком.
  //
  // Заголовок с этажом тоже уехал в эту плашку: прежде он стоял в шапке окна и
  // был единственным местом, где написано, где человек оказался после
  // лестницы. Окна нет — осталась первая строка плашки.
  const titleNode = uiEl("p", { class: "volume__title" });
  const summaryPlate = createFieldPlate({ side: "right", setting: VOLUME_SUMMARY_SETTING });
  // Нечего показывать — плашка посреди поля, а не строчка в углу: это главное,
  // что человек должен прочесть, войдя в режим без чертежа.
  const emptyNote = uiEl("p", { class: "screen-empty", attrs: { hidden: "hidden" } });
  stage.append(summaryPlate.node, emptyNote);
  hosts.stage.replaceChildren(stage);
  // Этаж — в колонке, рядом с видом (таск 153): на каком этаже человек стоит,
  // видно и не подходя к лестнице, а переход остаётся **один на обе кнопки** —
  // то же правило `volumeFloorAction`, что у кнопки в поле. Второго способа
  // менять этаж не заводится.
  const floorLine = uiEl("span", { class: "volume__floorLine" });
  const floorButton = uiButton("", {
    class: "ui-btn ui-btn--wide",
    on: { click: () => floorByHand() },
  });
  hosts.side.replaceChildren(
    uiEl("div", { class: "volume__panel" }, [
      uiEl("div", { class: "volume__tools" }, [
        uiEl("span", { class: "volume__toolsLabel", text: strings.volume.view }),
        personButton,
        aroundButton,
      ]),
      // «Вся схема», снимок и все двери разом: не вид, а действия над ним —
      // своей строкой под переключателем вида.
      uiEl("div", { class: "volume__tools" }, [fitButton, shotButton, doorsButton]),
      // «Выполнить команду» (G17, история 2.19) — то же окно, что в «Схеме»:
      // список команд сценариев и поле «своя команда». Видна, пока дом идёт.
      commandRow,
      uiEl("div", { class: "volume__tools" }, [
        uiEl("span", { class: "volume__toolsLabel", text: strings.volume.floorLabel }),
        floorLine,
      ]),
      floorButton,
      // ——— параметры объёма в том же блоке (таск 231, G349) ————————————
      //
      // Слова заказчика: «а слева оставить блок Объём и добавить туда
      // Параметры объёма, что сейчас в окне», — то есть в этот блок, а не
      // вторым разделом колонки. Своего заголовка у параметров поэтому нет:
      // заголовок у блока один, а внутри их разделяют подписи групп («ЧТО
      // ПОКАЗЫВАТЬ», «ТИП ФОНА», «ВРЕМЯ СУТОК», «УСКОРЕНИЕ», «ХОДЬБА») — те
      // же, что стояли в окне.
      //
      // Сверху — **действия над видом**, снизу — **настройки вида**: вид,
      // «Вся схема», снимок и этаж человек трогает на каждом показе, а фон и
      // час — один раз и надолго.
      paramsFields.node,
    ]),
  );

  // ——— вид ———

  // Поверхность жива и в чужом режиме — она только погасла, — поэтому клавиши
  // обязаны спрашивать, её ли сейчас экран. Правило то же, что у холста
  // (`canvasOnScreen`) и у чертежа: кто показан, того и клавиатура. Диалог
  // забирает её у всех троих: пока стопка не пуста, клавиши принадлежат ему.
  function ours() {
    return !closed && screenMode() === "volume" && uiDialogDepth() === 0;
  }

  function setView(next) {
    if (view === next) return;
    // Переход к обзору ставит цель туда, где стоит человек: обзор нужен, чтобы
    // понять, где стоишь, а не чтобы потерять себя из виду.
    if (next === "around") {
      aroundFrame({ x: person.x, y: person.y, z: 1200 }, person.yaw, aroundAim(), VOLUME_AROUND_NEAR_MM);
    }
    // Клавиши высоты держат **руки**, а значат они в двух видах разное: в
    // обзоре пробел поднимает камеру, от первого лица он прыгает. Сменили вид
    // — отпустили: иначе вернувшийся в обзор поднимался бы без нажатия.
    riseStop();
    // Присед кнопкой — тоже: в обзоре та же кнопка значит «ниже», и
    // включённый присед повёз бы камеру к земле сам.
    crouchLatch(false);
    view = next;
    sync();
  }

  function fit() {
    if (scene.empty) return;
    const fitted = volumeAroundFit(scene, viewport());
    aroundFrame(fitted.target, around.yaw, aroundAim(), fitted.distance);
    if (view !== "around") {
      view = "around";
      sync();
      return;
    }
    redraw();
  }

  /**
   * Взгляд обзора, возвращённый на чертёж (таск 195).
   *
   * Руками взгляд задирается к небу свободно — но «Обзор» и «Вся схема» это
   * **возврат**: они и так ставят цель и расстояние заново, и нажавший их ждёт
   * увидеть схему, а не небо, в котором остался взгляд. Поэтому взгляд тут не
   * положе умолчания обзора.
   *
   * Круче умолчания — не трогаем: смотреть на схему почти отвесно человек мог
   * выбрать сам, и возврат такой выбор не отнимает.
   */
  function aroundAim() {
    const home = (VOLUME_AROUND_PITCH_DEG * Math.PI) / 180;
    return Math.min(around.pitch, home);
  }

  // ——— обзор: одна дверь к состоянию и одна мера (таск 207, G311 и G312) ———
  //
  // Место и взгляд пишет **только** `aroundSet`, и он же считает меру
  // (`volumeAroundReach`). Поэтому мера не может протухнуть: нет пути, которым
  // камера сдвинулась бы, а число осталось прежним. Таким путём был полёт
  // таска 200 — слетев с тридцати метров в комнату, человек возил карту
  // двумя пальцами мерой тридцати метров.

  /** Единственная дверь к обзору: место и взгляд — руками, мера — счётом. */
  function aroundSet(eye, yaw, pitch) {
    around = { eye, yaw, pitch, distance: volumeAroundReach(eye, pitch) };
  }

  /** Куда смотрит обзор: точка пола под взглядом (мера её и задаёт). */
  function aroundTarget() {
    return volumeAroundTarget(around.eye, around.yaw, around.pitch, around.distance);
  }

  /** Кадрировать: встать так, чтобы смотреть на `target` с `distance`. */
  function aroundFrame(target, yaw, pitch, distance) {
    aroundSet(volumeAroundEye(target, yaw, pitch, distance), yaw, pitch);
  }

  /** Повернуть обзор на месте: то же правило, что у человека (`lookBy`). */
  function aroundTurn(yaw, pitch) {
    aroundSet(around.eye, yaw, pitch);
  }

  /**
   * Приблизиться или отойти (таск 207): камера **едет по взгляду** на долю
   * меры, а не подходит к цели на расстояние.
   *
   * Так колесо не умирает. До таска 207 оно уменьшало хранимое расстояние, и
   * у предела (`VOLUME_AROUND_MIN_MM`) приближаться становилось нечем: в
   * комнате колесо переставало делать что-либо вовсе. Шаг долей меры
   * приближает **всегда**: он сам мельчает вместе с нею и в ноль не упирается.
   *
   * `factor` приходит от общей двери жестов (`gestureWheel`,
   * `gesturePinchStep`): больше единицы — приблизились.
   */
  function aroundZoom(factor) {
    const value = Number(factor) > 0 ? Number(factor) : 1;
    const step = volumeAroundReach(around.eye, around.pitch) * (1 - 1 / value);
    const basis = volumeBasis({ yaw: around.yaw, pitch: around.pitch });
    aroundSet(
      {
        x: around.eye.x + basis.fwd.x * step,
        y: around.eye.y + basis.fwd.y * step,
        // Пол держит и здесь — тем же правилом, что держит прыжок и полёт.
        z: volumeGroundMm(around.eye.z + basis.fwd.z * step),
      },
      around.yaw,
      around.pitch,
    );
  }

  /** Сдвинуть обзор по полу: и камера, и точка под взглядом уезжают на столько же. */
  function aroundSlide(dx, dy) {
    aroundSet({ ...around.eye, x: around.eye.x + dx, y: around.eye.y + dy }, around.yaw, around.pitch);
  }

  /** Навести обзор на это место плана, не меняя ни взгляда, ни высоты. */
  function aroundLookAt(x, y) {
    const target = aroundTarget();
    aroundSlide(x - target.x, y - target.y);
  }

  function camera() {
    if (view === "person") {
      // Высота глаз — у стойки (G234): присел — ниже, прыгнул — выше.
      return { at: { x: person.x, y: person.y, z: volumeStanceEye(stance) }, yaw: person.yaw, pitch: person.pitch };
    }
    // Камера обзора стоит сама: её место и есть состояние вида.
    return { at: { ...around.eye }, yaw: around.yaw, pitch: around.pitch };
  }

  // ——— общее место трёх режимов (G276) ———
  //
  // Разбор правила — у `volumePlanCentre` выше. Здесь две руки: встать туда,
  // откуда пришли, и оставить своё место тем, к кому уходим.

  /**
   * Пришли в объём: камера встаёт на середину того поля, с которого пришли.
   *
   * **Попали в стену — сдвигаем** (слова заказчика). Сдвигает то же правило,
   * что у переноса кликом по полу и по миникарте: `volumeMoveTo` выталкивает
   * тело из стены и ставит вплотную к её грани, а место теснее тела меняет на
   * ближайшее свободное (D39). Второго правила «куда можно встать» в сборке
   * нет, и заводить его здесь было бы третьим ответом на тот же вопрос.
   */
  function placeArrive(state) {
    if (scene.empty) return false;
    // Место общее на три режима и лежит в одном месте (таск 193, D59): его и
    // спрашиваем, кто бы его ни поставил — план, чертёж или память вида.
    // Прежде здесь спрашивали **мастерскую**, и только когда пришли из неё, —
    // отсюда и «не всегда работает»: прямой переход «Схема → Чертёж» не
    // переносил ничего. Молчит общее место только там, где моста нет вовсе
    // (схема без калибровки): тогда считается середина плана.
    const place = screenPlaceOf(schemeId);
    const want = place || volumePlanCentre(state.project, schemeId, viewport(), state.view);
    if (!want) return false;
    const moved = volumeMoveTo(scene, want, volumeStanceHead(stance));
    person.x = moved.x;
    person.y = moved.y;
    // Обзор смотрит на то же место: вид переключают, не выходя из режима, и
    // разойдись они — человек увидел бы со стороны не ту комнату, в которой
    // только что стоял.
    aroundLookAt(moved.x, moved.y);
    // ...а если в записи есть взгляд — встаём и смотрим туда же (таск 227).
    const looked = lookArrive(place && place.look, moved);
    // Встал присевший под низкое или вышел из-под него — решает новое место.
    stanceRecheck();
    syncWhere();
    return looked;
  }

  /**
   * Поставить взгляд из общей записи. `false` — взгляда в ней нет, и кадр
   * решает тот, кто звал (первый вход открывает объём всей схемой, таск 146).
   *
   * Обзор ставится **целиком**: глаз — туда же относительно человека, где он
   * и стоял, углы — сохранённые. Той же дверью (`aroundSet`), которой живёт
   * весь обзор, — второго способа посадить камеру в сборке нет, и заводить его
   * ради памяти нельзя. Глаза в записи нет (запись старая или от первого лица)
   * — берутся одни углы, камера остаётся там, где её поставил кадр.
   */
  function lookArrive(look, at) {
    if (!look) return false;
    const pitch = volumeClampPitch(look.pitch);
    if (look.view === "person") {
      person.yaw = look.yaw;
      person.pitch = pitch;
      if (view !== "person") {
        view = "person";
        riseStop();
      }
      return true;
    }
    if (look.eye) aroundSet({ x: at.x + look.eye.dx, y: at.y + look.eye.dy, z: look.eye.z }, look.yaw, pitch);
    else aroundTurn(look.yaw, pitch);
    if (view !== "around") {
      view = "around";
      riseStop();
    }
    return true;
  }

  /**
   * Где стоит человек — общему месту трёх видов, **и только пока объём на
   * экране** (дефект D61, таск 210).
   *
   * Говорится это кадром, как у плана и у мастерской: у трёх полей одно
   * правило — пишет тот, на кого смотрят. Прежде объём писал место на уходе из
   * режима, а уходом считал всякую смену экрана: поверхность живёт дальше за
   * кадром, и «Схема → Чертёж» тоже будила эту подписку. Чертёж после такого
   * вставал по камере, а не по схеме, которую человек только что двигал.
   *
   * Масштаба объём не касается — камера им не владеет, и у плана с чертежом он
   * остаётся тем, который человек выбрал сам (`screenPlaceSet` без `pxPerMm`).
   * Назад схема и чертёж встают сами, читая чужую запись: второй руки, которая
   * правила бы им вид, больше нет.
   */
  function placeHere() {
    if (scene.empty || screenMode() !== "volume") return;
    screenPlaceSet("volume", schemeId, { x: person.x, y: person.y }, { look: lookNow(), open: openNow() });
  }

  /**
   * Что в доме открыто — в общую запись (таск 234, G352): двери и шторы.
   *
   * Списки собираются **только когда их меняли**: кадров в секунде шестьдесят,
   * а дверь открывают раз в минуту, и перебирать два множества на каждый кадр
   * незачем. В остальные кадры поле молчит, а запись бережёт прежнее — то же
   * правило, по которому объём бережёт чужой масштаб (T227).
   */
  function openNow() {
    if (openRev === openSaid) return undefined;
    openSaid = openRev;
    return { doors: [...openDoors], sheers: [...openCurtains] };
  }

  /**
   * Куда смотрит камера — **та, которой смотрят** (таск 227, G339). Слово
   * заказчика: «направление камеры сохраняй».
   *
   * Углы берутся у вида, который на экране, и вид назван в самой записи: у
   * первого лица и у обзора своя пара углов, и наклон обзора (−42° в пол) в
   * первом лице значил бы «уткнуться под ноги». Взгляда погасшего вида в
   * записи нет нарочно: человек его не видел и вернётся не к нему — вернётся он
   * к тому, которым уходил. Переключит вид руками — получит умолчание этого
   * вида, как и сегодня.
   *
   * У обзора записан ещё и сам глаз — **смещением от человека** и своей
   * высотой. Одних углов там мало: обзор вертится и летает на месте, его
   * камера живёт отдельно от тела, и повернувшийся да отошедший смотрит на дом
   * со стороны, а не на себя. Разбор, почему смещением, — в `screenPlace.js`.
   */
  function lookNow() {
    if (view === "person") return { view: "person", yaw: person.yaw, pitch: person.pitch };
    return {
      view: "around",
      yaw: around.yaw,
      pitch: around.pitch,
      eye: { dx: around.eye.x - person.x, dy: around.eye.y - person.y, z: around.eye.z },
    };
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
    placeStance();
    redraw();
  }

  /**
   * Сенсорная оснастка встала или сдвинулась — считается здесь, а не однажды
   * при показе: планшет повернули, страницу развернули во весь экран, окно
   * потянули. Поэтому место пересчитывается там же, где меряется поле, — в
   * `resize()`, и ещё раз в `sync()`, когда оснастку только показывают.
   *
   * Сами кнопки стоят по мерам `volume.css`; здесь меряется **зазор миникарты**
   * (`volumeMinimapBox`, довод `room`): от низа угловых кнопок слева сверху до
   * строки стойки над джойстиком взгляда.
   */
  function placeStance() {
    minimapRoom = stanceBox.hidden ? null : touchMinimapRoom();
    // Карточка метки уступает кнопкам и площадкам (G21): их место только что
    // сменилось — сменилось и её.
    placeCard();
  }

  /** Зазор под миникарту в левой части поля при сенсорной оснастке. */
  function touchMinimapRoom() {
    const box = viewport();
    const origin = stage.getBoundingClientRect ? stage.getBoundingClientRect() : { left: 0, top: 0 };
    const rectOf = (element) => {
      if (!element || element.hidden || !element.getBoundingClientRect) return null;
      const rect = element.getBoundingClientRect();
      return { left: rect.left - origin.left, top: rect.top - origin.top, bottom: rect.bottom - origin.top };
    };
    const gap = 10;
    let top = 0;
    for (const rect of [rectOf(paramsButton.node), rectOf(hintPlate.node)]) {
      if (rect && rect.left < box.width / 2) top = Math.max(top, rect.bottom + gap);
    }
    const row = rectOf(stanceBox);
    return { top, bottom: row ? row.top - gap : box.height };
  }

  // ——— час суток: один снимок на секунду ———

  /** Сцена, тень и свет меняются вместе: все трое держатся за геометрию. */
  function setScene(state) {
    scene = sceneOf(state) || scene;
    // Пол под ногами считается по сцене: пересобрали — прежний ответ и зарок
    // падения устарели (таск 229, G342).
    fallSnap = null;
    fallAt = null;
    refreshShadow();
  }

  function refreshShadow() {
    const at = hour ? hour.shadow : null;
    shadow = volumeShadowFaces(scene.shadowBoxes, at);
    spots = volumeSunSpotFaces(scene.sunSpots, at);
  }

  /**
   * Рассвет и закат этого объекта: по координатам (таск 188) или умолчанием —
   * и **на ту дату, которая стоит на часах объёма** (G289), а не на сегодня.
   * Сегодня бралось до таска 190, и тогда поле даты не двигало бы ничего:
   * зимний рассвет считался бы по летнему дню.
   */
  function dayTimes(nowMs) {
    const at = nowMs === undefined ? Date.now() : nowMs;
    const stamp = volumeClockStamp(volumeParamsClock(at), at);
    const site = volumeSiteOf(getState().project);
    return { site, stamp, times: volumeDayTimes(site, volumeDayDateOf(stamp.day)) };
  }

  /** Снимок часа. Нет его — считается; есть — берётся готовым. */
  function hourNow() {
    return hour || refreshHour();
  }

  function refreshHour() {
    const at = Date.now();
    const { site, stamp, times } = dayTimes(at);
    hour = volumeMood({
      minutes: stamp.minutes,
      times,
      topDeg: site.topDeg,
      kind: volumeParamsRead().kind,
    });
    refreshShadow();
    syncClockLine(stamp, at);
    return hour;
  }

  /**
   * Что написано в полосе часов (таск 191, G300).
   *
   * Снимок приходит готовым — тот самый, которым покрашено небо: второго счёта
   * времени у поля нет. Подсказка на полосе — та же строка, что в окне
   * параметров (`volumeParamsLine`): она отвечает на вопрос «почему не идёт»,
   * когда время остановлено, и на «как быстро идёт» при ускорении.
   */
  function syncClockLine(stamp, nowMs) {
    clockNode.hidden = scene.empty;
    if (scene.empty) return;
    const value = text("volume.clockCorner", {
      date: volumeDateShort(stamp.day),
      time: volumeClockText(stamp.minutes),
    });
    const line = volumeParamsLine(volumeParamsClock(nowMs), stamp.minutes, hour ? hour.phase : null);
    // **Пишем, только когда написанное изменилось** (таск 192). Полоса живёт в
    // снимке часа, а снимок с отметкой «Плавные светила» считается тридцать раз
    // в секунду — без этой проверки узел переписывался бы тридцать раз в
    // секунду ради той же минуты: лишние перерисовки строки и повторное
    // объявление `aria-label` читалкой. Минута на полосе меняется ровно так
    // часто, как идёт время: раз в секунду при ×60 и шестнадцать раз при ×960.
    if (clockSaid.value === value && clockSaid.line === line) return;
    clockSaid = { value, line };
    clockNode.textContent = value;
    clockNode.title = line;
    clockNode.setAttribute("aria-label", line);
  }

  /**
   * Таймер часа. Стоит он ровно тогда, когда времени есть куда идти: поле на
   * экране и время не остановлено. Во всех остальных случаях таймера нет
   * вовсе — это и есть «при фиксированном времени фон не пересчитывается».
   */
  function syncClock() {
    const chosen = volumeParamsRead();
    // Нужен ли таймер и как часто — одно правило (`volumeClockEvery`), и оно
    // проверяется тестом: «при стоячем времени ноль пересчётов» — требование, а
    // не следствие.
    const every = volumeClockEvery({
      on: !closed && screenMode() === "volume",
      clock: chosen.clock,
      smooth: chosen.smooth,
    });
    if (every === hourEvery) return;
    if (hourTick && typeof clearInterval === "function") clearInterval(hourTick);
    hourTick = 0;
    hourEvery = null;
    if (every === null) return;
    if (typeof setInterval !== "function") return;
    hourEvery = every;
    hourTick = setInterval(() => {
      if (closed) return;
      refreshHour();
      redraw();
    }, every);
  }

  /** Правку в окне параметров поле принимает одним путём: час заново и кадр. */
  function paramsChanged() {
    // Отметки дома и карточки (таск 09 сценариев) сверяются по переходу: часы
    // переводят часто, а пересобирать карточку-пульт на каждый перевод нельзя
    // — под пальцем ползунок.
    const chosen = volumeParamsRead();
    if (chosen.simulation !== homeParams.simulation || chosen.hideCard !== homeParams.hideCard) {
      const home = chosen.simulation !== homeParams.simulation;
      homeParams = { simulation: chosen.simulation, hideCard: chosen.hideCard };
      if (home) homeEnsure();
      syncCard();
      syncHint();
    }
    // «Все этажи» (таск 202) — единственная отметка окна, которая меняет саму
    // **сцену**, а не её показ: этажи приходят гранями, деревом порядка, тенью
    // и пятнами, и собрать их можно только заново. Сверяется это с тем, что в
    // сцене уже лежит, а не с отметкой: отметка бывает взведена и там, где
    // стопки нет (у открытой схемы не задан этаж), и тогда пересобирать нечего.
    //
    // **«Снять крышу»** (таск 212) — вторая такая отметка: она меняет грань
    // потолка, то есть саму сцену. Сверяется она так же — с тем, что в сцене
    // уже лежит: двусторонний потолок значит, что крыша на месте.
    const state = getState();
    const roofOff = volumeParamsRead().roofOff === true;
    // Крыша в сцене есть, если **хоть один** потолок двусторонний. Искать
    // «первую грань потолочного цвета» нельзя: тем же цветом крашен низ плиты,
    // и он односторонний всегда — на нём сверка и застревала, а отметка не
    // доезжала до кадра.
    const roofed = (scene.faces || []).some((face) => face.rgb === VOLUME_CEILING_RGB && face.both === true);
    const ceilings = (scene.faces || []).some((face) => face.rgb === VOLUME_CEILING_RGB && face.n.z < 0);
    if (stacking(state) !== Boolean(scene.stackMm) || (ceilings && roofOff === roofed)) {
      setScene(state);
      rebuildOverlay();
      stanceRecheck();
      sync();
    }
    refreshHour();
    syncClock();
    placeStance();
    // Отметка «Проходить сквозь стены» меняет не только картинку: подсказка
    // говорит про другое, а снятые стены поднимают того, кому не давали встать.
    syncHint();
    stanceRecheck();
    walkSchedule();
    redraw();
  }

  /**
   * Слова на кнопках стойки. **В обзоре те же две кнопки значат «выше» и
   * «ниже»** (таск 192, таск 200) — это одна оснастка в двух руках, и вторых
   * кнопок для полёта камеры не заводится.
   *
   * Это и есть ответ на «куда переезжают кнопки стойки на планшете»: никуда.
   * Они стоят в том же углу поля, в обоих видах, и меняют только подписи —
   * клавиш у планшета нет вовсе, а пробел с Control нажать там нечем.
   */
  function syncStanceWords() {
    const fly = view === "around";
    const up = fly ? strings.volume.flyUp : strings.volume.jump;
    const down = fly ? strings.volume.flyDown : strings.volume.crouch;
    jumpButton.title = fly ? strings.volume.flyUpHint : strings.volume.jumpHint;
    jumpButton.setAttribute("aria-label", up);
    crouchButton.title = fly ? strings.volume.flyDownHint : strings.volume.crouchHint;
    crouchButton.setAttribute("aria-label", down);
    // Нажата ли — вопрос только приседа: «Ниже» в обзоре держат, а не
    // переключают, и сказать «нажата» про неё нечего.
    if (fly) crouchButton.removeAttribute("aria-pressed");
    else crouchButton.setAttribute("aria-pressed", crouchLatched ? "true" : "false");
  }

  function paint() {
    if (!ctx || closed) return;
    // Где стоит человек — общему месту трёх видов (G276, D61). На кадр это одно
    // присваивание, и только на своём режиме: запись из погасшего поля отняла
    // бы место у того, на которое смотрят.
    placeHere();
    const ratio = (typeof window !== "undefined" && window.devicePixelRatio) || 1;
    const box = viewport();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, node.width, node.height);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    const spot = camera();
    const at = hourNow();
    // Фон — настоящая панорама вокруг дома (G208): он знает о камере её
    // направление и больше ничего, и поворачивается вслед за головой. Про время
    // он не считает ничего — час приходит готовым снимком.
    // Земля сцены приходит фону одним прямоугольником (D52): по ней он знает,
    // где кончается плита, и не рисует на земле ничего ближе её кромки.
    volumeDrawBackdrop(ctx, box, spot, at, scene.landMm);
    if (scene.empty) {
      shown = [];
      return;
    }
    // Кружок «вы здесь» рисуется только в обзоре: от первого лица человек и
    // так знает, где стоит, а под ногами кружок закрыл бы пол.
    const marker = view === "around" ? volumeMarkerFaces({ x: person.x, y: person.y }, person.yaw) : [];
    // Тень дома идёт в кадр `extra`, а не гранью сцены: её кладёт час (таск
    // 181). Ярус у неё свой (`VOLUME_LAYER_SHADOW`), и пол помещения ложится
    // поверх неё правилом яруса, а не дальностью середин — дефект D49. Тем же
    // путём и теми же `extra` идут солнечные пятна от проёмов (таск 196), ярус
    // у них `VOLUME_LAYER_SUN` — выше полов, ниже тел.
    // Свет дома (таск 09 сценариев): свечение тел и свет комнаты — доводом
    // кадра, без пересборки сцены. Дом не идёт — довода нет, и кадр тот же.
    const lights = homeLights();
    shown = volumeFrame(scene, spot, box, [...shadow, ...spots, ...overlay, ...marker, ...lights.signs], at.tint, lights.light);
    volumeDraw(ctx, shown);
    // Второй проход фона: вещи, которые ближе кромки плиты, дом закрыть не
    // может — они перед ним (таск 199, разбор у `volumeDrawBackdrop`). Внутри
    // плиты проход пуст, то есть у ходящего по дому его нет вовсе.
    volumeDrawBackdropNear(ctx, box, spot, at, scene.landMm);
    // Миникарта — поверх кадра и после него: это накладка, а не часть сцены.
    if (view === "person") paintMinimap(box);
    syncAim();
    // Лампа ещё разгорается или гаснет — нужен следующий кадр. Улеглось —
    // кадров больше не заказывается, и поле снова молчит до события.
    if (lights.busy) redraw();
  }

  /**
   * Свет дома на этот кадр: плавный (`lightFadeLive`) и — по отметке
   * «Физический свет» — пятнами (`volumeLiveLight`). `busy` — свет ещё в пути.
   * `signs` — признаки работы остальных вещей: диоды и потоки
   * (`volumeLiveSigns`, правка после сборки сценариев).
   */
  function homeLights() {
    if (!homeTarget) return { light: null, busy: false, signs: [] };
    const faded = lightFadeLive(homeTarget, homeFade, now());
    const physical = volumeParamsRead().physical !== false;
    return { light: volumeLiveLight(scene, faded.live, { physical }), busy: faded.busy, signs: volumeLiveSigns(scene, homeTarget) };
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
    const bounds = scene.boundsMm;
    const spot = volumeMinimapView(box, bounds, volumeParamsRead().minimap, minimapRoom);
    if (!spot) return;
    const place = spot.place;
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
    const zoom = spot.zoom;
    const view = { zoom, offsetX: spot.offsetX, offsetY: spot.offsetY };
    // Без подписей: буквы углов и имена объектов на накладке в двести точек
    // слипаются в кашу, а заказчик просил «только схема и местоположение».
    drawDrawing(ctx, {
      project: state.project,
      schemeId,
      bridge: drawingUnitBridge(view),
      labels: false,
      // Спрятанное не всплывает и на миникарте: она показывает то же поле,
      // только сверху (таск 154, G223).
      objects: state.objectsShown !== false,
      hiddenObjectIds: state.hiddenObjectIds,
    });
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

  // ——— выбранный канал (таск 177, G274) ———
  //
  // Слова заказчика: «обрабатывай клик на каждый канал отдельно рисуя стрелки
  // только на соответствующий канал».
  //
  // **Что значит «канал выделен».** Это не второе выделение рядом с первым:
  // выделена по-прежнему метка — та же, что в списке меток и на плане, — а
  // канал говорит, **какой клавишей** на неё смотрят. Поэтому он и живёт
  // здесь, в переменной окна, рядом с раскрытыми дверями и стойкой: в объект не
  // попадает ничего (G68), в состояние сеанса — тоже ничего, потому что список
  // меток и план про клавиши не знают и знать им незачем.
  //
  // Держится он за свою метку: выделили другую вещь (хоть здесь, хоть на плане,
  // хоть в списке) — канал снимается сам, и картина связей возвращается целиком.
  let channelPick = null;

  /** Канал под точкой кадра — или `null`: клавиша должна быть видна. */
  function channelAt(at) {
    if (!at || scene.empty) return null;
    return volumeChannelAt(shown, at.x, at.y);
  }

  /**
   * Сколько клавиш нарисовано у метки: спрашивается у её же тела
   * (`volumeModelKeys`), второго счёта клавиш в сборке нет. Одна клавиша —
   * особый случай отбора связей (таск 191, D50).
   */
  function keysOf(markId) {
    const place = markId ? volumeMarkPlace(scene, markId) : null;
    return volumeModelKeys(place && place.model);
  }

  function pickChannel(found, quiet = false) {
    const was = channelPick;
    const same = was && found && was.markId === found.markId && was.channel === found.channel;
    channelPick = found || null;
    // Кадр пересобирается здесь, а не состоянием: щелчок по второй клавише той
    // же метки выделения не меняет, и подписка молчала бы.
    if (!same) syncSelection();
    // При запущенном доме щелчок по клавише — нажатие (таск 09 сценариев), и
    // слово про связи канала на каждое нажатие было бы шумом: клавиша выбрана
    // рамкой, а что она сделала, видно в доме и в журнале.
    if (!found || same || quiet) return;
    // Сказать словом один раз: стрелок на кадре стало меньше, и без слова это
    // читается как пропавшие связи. Пустой канал — тоже новость: клавиша есть,
    // а нагрузки на ней нет.
    const state = getState();
    const scheme = state.schemeId ? findScheme(state.project, state.schemeId) : null;
    const all = scheme ? canvasFrameLinks(state, null, scheme) : null;
    const links = all ? volumeChannelLinks(all, channelPick, keysOf(found.markId)) : null;
    const empty = !links || links.lines.length === 0;
    if (!empty) {
      notify(text("volume.channelPicked", { channel: found.channel }), "info");
      return;
    }
    // Клавиша пуста — но пуста ли она **по данным**? У многоклавишной метки
    // связь без номера канала не принадлежит ни одной клавише (правило таска
    // 177: какая из четырёх — в данных не записано), и молчать об этом нельзя:
    // человек видит в «Чем управляет» нагрузки, а на кадре — пустую клавишу, и
    // читает это как поломку. Поэтому такой случай говорит о себе и зовёт туда,
    // где это чинится — проставить канал у связи.
    const mute = ((all && all.lines) || []).filter(
      (line) => line.fromId === found.markId && (line.channel === null || line.channel === undefined),
    ).length;
    const where = { channel: found.channel, count: mute };
    notify(text(mute > 0 ? "volume.channelUnnumbered" : "volume.channelEmpty", where), "info");
  }

  // Рамка выделенного и стрелки связей. Правила, какие связи показывать, —
  // плановые целиком (`canvasFrameLinks`): переключатель в шапке включён —
  // видны все связи схемы, выключен — связная группа выделенной метки.
  function rebuildOverlay() {
    overlay = [];
    if (scene.empty) return;
    const state = getState();
    // Канал держится за свою метку: выделили другую — он снялся сам.
    if (channelPick && !selectedIds().includes(channelPick.markId)) channelPick = null;
    for (const id of selectedIds()) {
      const place = volumeMarkPlace(scene, id);
      if (!place) continue;
      volumeSelectLines(place, overlay);
      // Рамка по самой клавише: выбранный канал обязан быть виден глазами.
      if (channelPick && channelPick.markId === id) volumeChannelLines(place, channelPick.channel, overlay);
    }
    const scheme = findScheme(state.project, schemeId);
    if (!scheme) return;
    // Правила, какие связи бывают, — плановые целиком; канал только сужает их
    // до одной клавиши (таск 177, G274), а у одноклавишной метки берёт себе и
    // связи без номера (таск 191, D50).
    const links = volumeChannelLinks(
      canvasFrameLinks(state, null, scheme),
      channelPick,
      channelPick ? keysOf(channelPick.markId) : 0,
    );
    volumeLinkLines(links, (id) => volumeMarkAnchor(scene, id), overlay);
  }

  function syncCard() {
    const state = getState();
    const selected = selectedIds();
    // Карточка про одну метку — то же правило, что у карточки на плане:
    // у выделенных пачкой общих полей нет.
    //
    // «Не показывать карточку метки» (таск 09 сценариев, G22) убирает её из
    // поля: выделение остаётся — рамкой на самой вещи и строкой в списке.
    const model =
      selected.length === 1 && volumeParamsRead().hideCard !== true ? markCardModel(state.project, selected[0]) : null;
    if (homeCard) homeCard.dispose();
    homeCard = null;
    card.hidden = !model;
    if (!model) return;
    // Запущенный дом: под полями метки — пульт её устройства, тот же, что в
    // «Схеме» (`deviceCardView`, таск 08): клавиши с тремя нажатиями, ползунки,
    // значения.
    if (homeOn() && !model.comment) homeCard = deviceCardView(state.project, model.id);
    card.classList.toggle("mark-card--sim", Boolean(homeCard));
    card.replaceChildren(...markCardParts(model, { headButton: cardClose, ...(homeCard ? { extra: homeCard.node } : {}) }));
    placeCard();
  }

  /**
   * Клавиши каналов под рукой: у выделенной вещи их больше одной или канал уже
   * выбран. Только тогда про них и говорит подсказка.
   */
  function channelKeys() {
    if (channelPick) return true;
    if (scene.empty) return false;
    for (const id of selectedIds()) if (keysOf(id) > 1) return true;
    return false;
  }

  function syncSelection() {
    rebuildOverlay();
    syncCard();
    syncHint();
    redraw();
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
  //
  // С таска 159 щелчок по двери её **открывает** (G235, слова заказчика «клик
  // на дверь должен тоже её открывать»), а не только показывает, о какой двери
  // речь. Разбор — в `onPointerUp`.

  /** Середина поля — туда целится кнопка «Действие». */
  function fieldMiddle() {
    const box = viewport();
    return { x: box.width / 2, y: box.height / 2 };
  }

  /** Куда смотрит рука — одно правило на E, на клик и на сам прицел (`volumeAimAt`). */
  function aimPoint() {
    return volumeAimAt(viewport(), { locked, pointer, view });
  }

  /**
   * Прицел виден ровно там, где он **и есть рука** (G213, G235).
   *
   * Заказчик: «Когда курсор не перехвачен — тоже прицел надо отображать». Было
   * иначе — прицел гас, пока курсор над полем (таск 151), — и правило сменилось
   * по его слову. Прицел не стал вторым крестом: он идёт за курсором
   * (`volumeAimAt`), и вместо курсора — у холста в этом виде своего указателя
   * нет вовсе (`volume__stage--aim` в `volume.css`). Один крест, одна точка
   * попадания, и обещает он ровно то, что делают E и клик.
   *
   * Чего нет по-прежнему: прицела в обзоре (центр поля там ничего не значит) и
   * прицела под пальцем — там целятся касанием, и клавиши E нет вовсе (таск 149).
   */
  function syncAimNode() {
    // Пальцем прицел стоит посреди поля (таск 09 сценариев, G20): туда целится
    // кнопка «Действие», и человек должен видеть, на что она подействует.
    const at = scene.empty || view !== "person" ? null : touching ? fieldMiddle() : aimPoint();
    aimNode.hidden = at === null;
    stage.classList.toggle("volume__stage--aim", at !== null);
    if (!at) return;
    aimNode.style.left = at.x + "px";
    aimNode.style.top = at.y + "px";
  }

  /** Дверь под рукой — по последнему нарисованному кадру. */
  function syncAim() {
    syncAimNode();
    const at = aimPoint();
    const found = at && !scene.empty ? volumeDoorAt(shown, at.x, at.y) : null;
    // Штора под прицелом (G332) спрашивается **только там, где шторы есть**: на
    // схеме без них это был бы лишний проход по кадру на каждое движение
    // взгляда, а сказать о ней всё равно нечего.
    const sheer =
      at && !scene.empty && (scene.sheers || []).length > 0 ? volumeSightAt(shown, at.x, at.y) : null;
    if (found === aimedDoor && sheer === aimedMark) return;
    aimedDoor = found;
    aimedMark = sheer;
    syncHint();
  }

  // Сцена пересобирается целиком: дверь меняет грани стены, в которой стоит, и
  // считать её заново дешевле, чем держать второй путь «подмени одно полотно».
  // На объекте заказчика это 8 мс и происходит по нажатию клавиши, а не в кадре.
  function rebuildScene() {
    setScene(getState());
    rebuildOverlay();
    // Низкое место могли убрать с чертежа, пока человек сидел под ним (G234).
    stanceRecheck();
    syncHint();
    redraw();
  }

  /**
   * На что подействуют E и клик в этой точке поля.
   *
   * `door` приходит снаружи, потому что у E и у клика он берётся по-разному:
   * E слушается двери **под прицелом или запомненной щелчком** (G207), клик —
   * той, по которой щёлкнули. Остальное одно на оба: вещь, которую **видно**
   * (`volumeSightAt`) — точное попадание, вещь в запасе промаха
   * (`volumePickAt`) — нет, а разбор между ними и дверью делает
   * `volumeAimChoice`.
   */
  function aimChoiceAt(at, door) {
    if (!at || scene.empty) return { kind: "none", id: null };
    return volumeAimChoice({
      markExact: volumeSightAt(shown, at.x, at.y),
      door,
      markNear: volumePickAt(shown, at.x, at.y),
    });
  }

  /**
   * Что делает нажатие E и **что делает щелчок** (G214, G235): одно правило,
   * два повода. Слова заказчика: «Клик равноценен нажатию E на объект под
   * курсором».
   *
   * Вещь — выделить **тем же выделением**, что список меток и план (таск 148);
   * дверь — открыть или закрыть (G207). `false` — под прицелом нет ни того, ни
   * другого, и дальше решает тот, кто спрашивал: E говорит об этом словом, а
   * щелчок по полю значит своё (см. `onPointerUp`).
   */
  function actOnChoice(choice, at, how = "click") {
    if (choice.kind === "mark") {
      // Пальцем при запущенном доме вещь, которой есть что делать, **только
      // работает** и не выделяется (правка после сборки сценариев). Слова
      // заказчика: «взаимодействие с выключателем открывает его окно, хотя
      // перед этим нажатие проходит и состояние меняется». Окно — карточка
      // метки: на телефоне она встаёт поверх поля, и каждое касание клавиши
      // закрывало бы комнату пультом. Мышью карточка остаётся — она прижата
      // к краю и кадра не закрывает. Вещь без дела (`none`) выделяется, как
      // прежде: карточка — единственное, что касание по ней может показать.
      if (homeOn() && touching && homeActs(choice.id, at)) return homeAct(choice.id, at, how);
      select(choice.id);
      // Запущенный дом (таск 09 сценариев): вещь не только выделяется, а
      // работает — как щелчок по метке в «Схеме».
      if (homeOn()) return homeAct(choice.id, at, how);
      // **Штора открывается там же, где выделяется** (G332): у метки с тюлевым
      // телом есть своё дело, и `E` делает его — тем же правилом, которым
      // щелчок по клавише выключателя выбирает канал. Выделение при этом
      // остаётся: по шторе смотрят её размеры и привязку, как по любой вещи.
      if (toggleCurtain(choice.id)) return true;
      // Щелчок по клавише многоклавишного выключателя выбирает **её канал**
      // (таск 177, G274), мимо клавиши — снимает выбор и возвращает все связи
      // метки. Выделение при этом одно и то же: канал не выделяет вместо вещи,
      // он говорит, какой клавишей на неё смотрят.
      const found = channelAt(at);
      pickChannel(found && found.markId === choice.id ? found : null);
      return true;
    }
    if (choice.kind === "door") {
      toggleDoor(choice.id);
      return true;
    }
    return false;
  }

  /**
   * E действует на то, на что смотришь (G207, G214). `how` — `"key"` у E и
   * кнопки «Действие» (нажатие клавиши выключателя держится до отпускания),
   * `at` — куда целится рука: кнопка «Действие» целится серединой поля.
   */
  function actOnAim(how = "click", given = null) {
    const at = given || aimPoint();
    const door = given ? (scene.empty ? null : volumeDoorAt(shown, given.x, given.y)) : aimedDoor || heldDoor;
    const choice = aimChoiceAt(at, door);
    if (!actOnChoice(choice, at, how)) notify(strings.volume.aimless, "info");
  }

  /** Открыть или задвинуть штору. `false` — эта метка не штора. */
  function toggleCurtain(markId) {
    if (!markId || !(scene.sheers || []).includes(markId)) return false;
    if (openCurtains.has(markId)) openCurtains.delete(markId);
    else openCurtains.add(markId);
    openRev += 1;
    rebuildScene();
    notify(openCurtains.has(markId) ? strings.volume.sheerOpened : strings.volume.sheerClosed, "info");
    return true;
  }

  function toggleDoor(doorId) {
    if (!doorId) return false;
    if (openDoors.has(doorId)) openDoors.delete(doorId);
    else openDoors.add(doorId);
    openRev += 1;
    heldDoor = doorId;
    rebuildScene();
    // Датчик открытия ходит вместе с дверью (история 2.9): связь дверь — датчик
    // считает дом (`markDoorOf`), «Объём» только говорит, что дверь сделала.
    if (homeOn()) simDoor(doorId, openDoors.has(doorId));
    return true;
  }

  function toggleAllDoors() {
    const doors = scene.doors || [];
    if (doors.length === 0) {
      notify(strings.volume.doorsNone, "info");
      return;
    }
    const next = volumeDoorsAfterAll(doors, openDoors);
    const was = new Set(openDoors);
    openDoors.clear();
    for (const id of next) openDoors.add(id);
    openRev += 1;
    rebuildScene();
    if (homeOn()) for (const id of doors) if (was.has(id) !== openDoors.has(id)) simDoor(id, openDoors.has(id));
    notify(next.length > 0 ? strings.volume.doorsOpened : strings.volume.doorsClosed, "info");
  }

  // ——— имитация умного дома: руки и провода (таск 09 сценариев) ———————————

  /**
   * Что делает рука с меткой при запущенном доме (истории 2.5–2.7, 2.10):
   * правило — `volumeSimAction`, одно со «Схемой». `how`: `"key"` — E или
   * «Действие» (у отвязанной клавиши нажатие держится до отпускания),
   * `"click"` — щелчок мышью или касание (нажатие уже начато на `pointerdown`).
   */
  function homeAct(markId, at, how) {
    const mine = homeKeyAt(markId, at);
    pickChannel(mine, true);
    const action = volumeSimAction(markAccessory(getState().project, markId), mine ? mine.channel : null);
    if (action.kind === "hold") {
      const presser = devicePresserOf(markId, action.index);
      if (how === "key") {
        homeRelease(true);
        homeHeld = presser;
        presser.down();
      } else if (!homeGesture || homeGesture.presser !== presser) {
        // Щелчок без начатого нажатия (захват мыши, касание мимо) — одиночное.
        presser.down();
        presser.up();
      }
      return true;
    }
    if (action.kind === "press") simPress(markId, action.index, "single");
    else if (action.kind === "sensor") simAct({ kind: "sensor", markId, service: action.service });
    else if (action.kind === "toggle") simAct({ kind: "toggle", markId });
    // Штора без аксессуара открывается, как до имитации, — своей памятью.
    else toggleCurtain(markId);
    return true;
  }

  /** Клавиша этой метки под точкой кадра — или `null`, если рука мимо клавиш. */
  function homeKeyAt(markId, at) {
    const found = channelAt(at);
    return found && found.markId === markId ? found : null;
  }

  /** Есть ли у метки дело для руки в этой точке — то же правило, что у `homeAct`. */
  function homeActs(markId, at) {
    const mine = homeKeyAt(markId, at);
    return volumeSimAction(markAccessory(getState().project, markId), mine ? mine.channel : null).kind !== "none";
  }

  /** Отпустили E или «Действие»: нажатие клавиши кончилось (или брошено). */
  function homeRelease(abort = false) {
    if (!homeHeld) return;
    const held = homeHeld;
    homeHeld = null;
    if (abort) held.abort();
    else held.up();
  }

  /**
   * Нажатие начинается **на опускании** мыши или пальца (история 2.6): долгое
   * приходит, пока держат, двойное — по второму щелчку. Начинает его только
   * отвязанная клавиша; остальное делает щелчок на отпускании.
   */
  function homeGestureStart(event) {
    homeGesture = null;
    if (!homeOn() || scene.empty) return;
    const at = atEvent(event);
    const choice = aimChoiceAt(at, volumeDoorAt(shown, at.x, at.y));
    if (choice.kind !== "mark") return;
    const found = channelAt(at);
    const mine = found && found.markId === choice.id ? found : null;
    const action = volumeSimAction(markAccessory(getState().project, choice.id), mine ? mine.channel : null);
    if (action.kind !== "hold") return;
    const presser = devicePresserOf(choice.id, action.index);
    presser.down();
    homeGesture = { presser };
  }

  function homeGestureEnd(moved) {
    if (!homeGesture) return;
    if (moved) homeGesture.presser.abort();
    else homeGesture.presser.up();
  }

  /** Где человек — датчикам движения и присутствия (история 2.8). */
  function homePresence() {
    if (!homeOn() || closed || scene.empty || screenMode() !== "volume") return;
    const rooms = volumeSimRooms(scene, person);
    const said = rooms.join(" ");
    if (said === homePlace) return;
    homePlace = said;
    simPresence(rooms);
  }

  /** Человек ушёл из дома — с поля или из имитации: датчикам его больше не видно. */
  function homePresenceGone() {
    if (homePlace && simRunning()) simPresence([]);
    homePlace = null;
  }

  /**
   * Свет и шторы по зеркалу дома. Свет идёт в кадр, шторы — в сцену, и
   * пересобирается она только на сдвиг шторы. Память открытых штор идёт за
   * домом: выключили имитацию — шторы там, где их оставил дом.
   */
  function homeRefresh() {
    if (closed || !homeOn()) return;
    if (screenMode() !== "volume") {
      homeStale = true;
      return;
    }
    homeStale = false;
    const state = getState();
    const live = volumeSimLive(state.project, simLive(state.project));
    homeTarget = live;
    const shares = volumeSimCurtains(scene, live);
    for (const [id, share] of shares) {
      const open = share >= VOLUME_SHEER_SHARE;
      if (open === openCurtains.has(id)) continue;
      if (open) openCurtains.add(id);
      else openCurtains.delete(id);
      openRev += 1;
    }
    // Штора без аксессуара — по своей памяти: открыта — значит собрана.
    for (const id of scene.sheers || []) if (!shares.has(id) && openCurtains.has(id)) shares.set(id, 1);
    const same = shares.size === homeShares.size && [...shares].every(([id, share]) => homeShares.get(id) === share);
    if (same) {
      redraw();
      return;
    }
    homeShares = shares;
    rebuildScene();
  }

  /** Поле встало в дом: двери говорят датчикам, человек — помещению. */
  function homeArrive() {
    homePlace = null;
    if (!scene.empty) for (const id of scene.doors || []) simDoor(id, openDoors.has(id));
    // Прежняя память открытых штор (история 2.14) — один раз и только дому,
    // который здесь ещё не запускали: его собственная память старше.
    if (!homeSeeded && !homeKnown) {
      homeSeeded = true;
      const state = getState();
      const curtains = new Set();
      for (const id of scene.sheers || []) {
        const accessory = markAccessory(state.project, id);
        if (accessory && accessory.services.some((service) => service.type === "WindowCovering")) curtains.add(id);
      }
      for (const id of volumeSimSeed(scene.sheers, homeMemory, curtains, homeKnown)) {
        const service = markAccessory(state.project, id).services.find((item) => item.type === "WindowCovering");
        simAct({ kind: "set", markId: id, service: service.index, char: "CurrentPosition", value: 100 });
        simAct({ kind: "set", markId: id, service: service.index, char: "TargetPosition", value: 100 });
      }
    }
    homeSeeded = true;
    homePresence();
  }

  /** Поле вышло из дома: свечения нет, шторы — своей памятью, как до имитации. */
  function homeLeave() {
    homeRelease(true);
    if (homeGesture) homeGesture.presser.abort();
    homeGesture = null;
    homePresenceGone();
    homeTarget = null;
    if (homeShares.size > 0) {
      homeShares = new Map();
      rebuildScene();
    } else redraw();
  }

  /** Сверка поля с домом: переход «вошли / вышли» и свет со шторами. */
  function homeSync() {
    if (closed) return;
    const on = homeOn();
    if (on !== homeWas) {
      homeWas = on;
      if (on) homeArrive();
      else homeLeave();
      commandRow.hidden = !on;
      syncCard();
      syncHint();
    }
    homeRefresh();
  }

  /**
   * Запустить или остановить дом по отметке и режиму (история 2.2): отметка
   * стоит и «Объём» на экране — дом идёт; ушли из режима или сняли отметку —
   * дом, запущенный здесь, останавливается.
   */
  function homeEnsure() {
    if (closed || !homeReady) return;
    const want = volumeParamsRead().simulation === true && screenMode() === "volume";
    if (want && !simRunning()) {
      if (simStart()) homeHere = true;
    } else if (!want && homeHere) {
      homeHere = false;
      homePresenceGone();
      if (simRunning()) simStop();
    }
    homeSync();
  }

  /**
   * **Карточка метки не заползает под кнопки поля** (G21, история 8.6): при
   * сенсорной оснастке ей отводит место `volumeCardPlace` по живым
   * прямоугольникам кнопок; без оснастки — стоит, как стояла.
   */
  function placeCard() {
    if (card.hidden) return;
    const box = viewport();
    const origin = stage.getBoundingClientRect ? stage.getBoundingClientRect() : { left: 0, top: 0 };
    const rectOf = (element) => {
      if (!element || element.hidden || !element.getBoundingClientRect) return null;
      const rect = element.getBoundingClientRect();
      return { left: rect.left - origin.left, right: rect.right - origin.left, top: rect.top - origin.top, bottom: rect.bottom - origin.top };
    };
    // Без сенсорной оснастки карточка стоит, как стояла, — и у лестницы тоже:
    // «Этаж» посреди низа ей не мешал никогда (она прижата влево).
    const touch = [rectOf(stanceBox), rectOf(lookNode), rectOf(padNode), rectOf(actionButton)].filter(Boolean);
    const controls = touch.length > 0 ? [...touch, rectOf(stairButton)].filter(Boolean) : [];
    // Сверху — угловые кнопки и развёрнутые плашки подсказки и сводки: плашка
    // лежит слоем выше карточки и закрыла бы её голову с кнопкой «закрыть».
    const corners = [rectOf(viewButton), rectOf(paramsButton.node), rectOf(hintPlate.node), rectOf(summaryPlate.node)].filter(Boolean);
    const top = corners.reduce((most, rect) => Math.max(most, rect.bottom), 0);
    const place = volumeCardPlace(box, controls, top);
    card.style.left = place ? place.left + "px" : "";
    card.style.right = place ? place.right + "px" : "";
    card.style.bottom = place ? place.bottom + "px" : "";
    card.style.width = place ? "auto" : "";
    card.style.maxHeight = place ? place.maxHeight + "px" : "";
    card.style.margin = place ? "0" : "";
  }

  /**
   * **Кадр по событию заказывается, а не рисуется** (дефект D80, таск 233).
   *
   * Правило одно на всю поверхность: внутри кадра — `paint()`, из события —
   * `redraw()`. Событие трогает поверхность не один раз (смена этажа мерит
   * поле, ставит подписи и сбрасывает выделение — и каждая рука рисовала поле
   * сама), а кадр у него должен быть один: лишние перерисовки человек не
   * видит, а время у них настоящее. Заказ сливается сам — пока кадр заказан,
   * второй заказ ничего не делает.
   *
   * Проверять «а не тот же ли это кадр» нигде больше не нужно: заказ **и есть**
   * проверка, и другого места для неё нет. Единственный, кто рисует напрямую, —
   * `walkTick`: он сам уже кадр, и заказ из него уехал бы на кадр позже.
   */
  function redraw() {
    if (frame || closed) return;
    frame = scheduleFrame(() => {
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

  // Кто-то держит ход: клавиша, палец на площадке — или стойка, которой ещё
  // есть куда ехать (G234). Прыжок без ходьбы иначе замер бы в воздухе: часы в
  // объёме идут только пока их держат, и присед с прыжком — третий повод.
  function moving() {
    if (keys.size > 0 || Boolean(pad) || Boolean(lookPad)) return true;
    // Обзор летит, пока держат клавишу высоты: висящая камера никуда не едет,
    // и крутить ей кадры незачем (таск 200, G304).
    if (view === "around" && (riseHeld || crouchHeld)) return true;
    // Падение — четвёртый повод (таск 229, G342): пол под человеком лежит
    // ниже нуля, и часы идут, пока он не долетит до нижнего этажа.
    return volumeStanceBusy(stance, crouching() || crouchStuck, fallFloorMm());
  }

  // ——— отметка окна параметров (таск 192, G292) ———
  //
  // Спрашивается **у окна параметров** и нигде не запоминается: своя копия
  // ответа разошлась бы с галкой в тот же миг, когда её снимут. В объект не
  // пишется ничего (G68) — отметка живёт в настройках браузера рядом с фоном и
  // миникартой.

  /**
   * Сняты ли столкновения со стенами — вопрос **первого лица**.
   *
   * В обзоре его не задают вовсе: камера проходит сквозь стены всегда, без
   * отметки (таск 200, G304). Камера — не человек, и запрет, который человеку
   * снимают галкой, ей не ставили никогда.
   */
  function ghosting() {
    return volumeParamsRead().ghost === true;
  }

  /**
   * Приседает ли человек. Control держат руки, а значит он в двух видах разное:
   * от первого лица — присед, в обзоре — спуск камеры (таск 200, G304).
   */
  function crouching() {
    return (crouchHeld || crouchLatched) && view === "person";
  }

  /**
   * Полёт камеры обзора (таск 200, G304).
   *
   * Слова заказчика: «механику полёта (кнопки прыжка и присяда и т.д.)
   * перенесём в обзор и позволим в обзоре спускаться до земли и летаться сквозь
   * стены». Поэтому:
   *
   *   - **ход идёт по взгляду целиком**, включая наклон: смотришь вверх —
   *     поднимаешься. Деления на плоскую часть здесь нет — это то же правило,
   *     по которому летал человек в таске 192;
   *   - **пробел и Control** добавляют к этому отвесную составляющую, пока их
   *     держат;
   *   - **скорость своя не заводится** (слово заказчика: «скорость для камеры
   *     как и сейчас для полёта») — `VOLUME_WALK_MM_S`, с Shift
   *     `VOLUME_RUN_MM_S`, те же, которыми ходит человек;
   *   - **стены не спрашиваются**: ни `volumeStep`, ни выталкивания. Камера
   *     летит ровно туда, куда просили, и **может оказаться внутри стены —
   *     это ожидаемо по слову заказчика** («по камере — ок, пусть в стенах
   *     оказываемся, это ожидаемо»). Предел стояния таска 195 заводили ровно
   *     против этого серого кадра; заказчик его снял сам, и замены ему нет;
   *   - **пол держит** — `volumeGroundMm`, то же правило, которым приземляется
   *     прыжок: ниже нуля не уходит ни человек, ни камера.
   */
  function aroundFly(forward, side, scale, basis, speed) {
    const lift = ((riseHeld ? 1 : 0) - (crouchHeld ? 1 : 0)) * speed;
    const dx = (basis.fwd.x * forward + basis.right.x * side) * scale;
    const dy = (basis.fwd.y * forward + basis.right.y * side) * scale;
    const dz = basis.fwd.z * forward * scale + lift;
    if (dx === 0 && dy === 0 && dz === 0) return;
    aroundSet(
      {
        x: around.eye.x + dx,
        y: around.eye.y + dy,
        // Пол держит камеру (таск 200) — но в стопке этажей (таск 202) земля
        // лежит ниже пола открытой схемы, и держать надо по ней: иначе с
        // третьего этажа дом не обойти снаружи, камера упирается в свой пол.
        z: volumeGroundMm(around.eye.z + dz, scene.stackMm ? scene.stackMm.bottomMm : 0),
      },
      around.yaw,
      around.pitch,
    );
  }

  // ——— присед и прыжок (G234) ———
  //
  // Счёт — в `volume.js`, здесь три руки: шаг стойки на каждом тике, разовый
  // прыжок и слово про «встать негде».

  // ——— падение в дыру (таск 229, требование G342) ———
  //
  // Слово заказчика: «Пусть падаем». Счёт — в `volume.js`: куда падать, знает
  // `volumeFallTo` (ближайший этаж снизу, у которого под этой точкой есть
  // пол), а роняет человека та же стойка той же дугой, которой приземляется
  // прыжок. Здесь — руки: спросить про пол под ногами, сказать, когда падать
  // некуда, и поменять этаж в миг приземления.

  /**
   * На какой этаж человек падает — или `null`, если не падает.
   *
   * **Падать можно только туда, что нарисовано.** Показан один этаж — под
   * дырой не нарисовано ничего, и провалившийся увидел бы серое поле вместо
   * объекта; тот же довод, которым пол держит камеру обзора. Поэтому вопрос
   * задаётся только стопке, а причину «падать некуда» окно называет вслух —
   * один раз на дыру, как и «встать негде».
   */
  function fallFloor() {
    // Зарок: начав падать, не всплывают. Разбор — у объявления `fallAt`.
    if (fallAt && volumeStanceFalling(stance)) return fallAt;
    if (fallSnap && fallSnap.scene === scene && fallSnap.x === person.x && fallSnap.y === person.y) {
      fallAt = fallSnap.floor;
      return fallAt;
    }
    fallAt = fallFloorNow();
    fallSnap = { scene, x: person.x, y: person.y, floor: fallAt };
    return fallAt;
  }

  /** Тот же вопрос без снимка: место под ногами и, если это дыра, этажи ниже. */
  function fallFloorNow() {
    const room = volumeRoomAt(scene, person);
    if (!room || room.hasFloor !== false) {
      fallSaid = false;
      return null;
    }
    const state = getState();
    const floor = scene.stackMm ? volumeFallTo(state.project, floorPlan(state), person) : null;
    if (!floor) {
      if (!fallSaid) {
        notify(scene.stackMm ? strings.volume.fallNoBelow : strings.volume.fallOneFloor, "info");
        fallSaid = true;
      }
      return null;
    }
    return floor;
  }

  /** Где для человека пол: ноль своего этажа или пол того, на который падает. */
  function fallFloorMm() {
    const floor = fallFloor();
    return floor ? floor.baseMm : 0;
  }

  /**
   * **Упасть на этаж ниже** (таск 229, G342) — смена этажа посреди шага.
   *
   * Зовётся в миг приземления, из шага стойки: пока человек летел, он
   * считался по миллиметрам прежнего этажа (сцена стопки рисует все этажи
   * разом, и нижнюю комнату он видел ещё в полёте), а коснувшись её пола —
   * переезжает в неё целиком. Переезд — тот же, которым работает лестница
   * (таск 149, таск 202), и ровно поэтому он не свой: открытая схема
   * становится схемой всего приложения, место переводится привязкой
   * (`sameSpotOn`, шов таска 205), из стен нового этажа человека выталкивает
   * `volumeMoveTo`, выделение сбрасывается — оно осталось этажом выше.
   *
   * Чего здесь нет нарочно: **площадки**. С лестницы сходят у марша
   * (`volumeStairLanding`, дефект D58), а в дыру падают отвесно — человек
   * встаёт ровно под тем местом, с которого шагнул, и смотрит туда же, куда
   * смотрел. Выдумывать падающему другое место значило бы отменить дыру.
   */
  function fallTo(floor) {
    const state = getState();
    const was = { x: person.x, y: person.y };
    const from = schemeId;
    closeAsk();
    leaveScheme();
    schemeId = floor.schemeId;
    setState({ schemeId });
    setScene(state);
    const want = sameSpotOn(state.project, from, schemeId, was);
    const moved = volumeMoveTo(scene, want, volumeStanceHead(stance));
    person.x = moved.x;
    person.y = moved.y;
    // Ноль переехал вместе с человеком: падал он в миллиметрах прежнего этажа,
    // встал — на полу нового. Глаза при этом не дёргаются ни на миллиметр,
    // потому что разница баз и есть та высота, которую он пролетел.
    stance = volumeStanceOnFloor(stance);
    fallAt = null;
    fallSnap = null;
    fallSaid = false;
    aroundLookAt(person.x, person.y);
    select(null);
    // У лестницы, рядом с которой упал, вопрос сам не всплывает: он выскочил
    // бы в тот же миг, в который человек приземлился.
    stairAsked = (stairHere() || {}).objectId || null;
    sync();
    notify(text("volume.fellTo", { floor: floor.floor }), "info");
  }

  /**
   * Шаг стойки. Он же — то место, где человек **встаёт сам**, выйдя из-под
   * низкого: вставать можно или нет, спрашивается каждый тик по тому месту, где
   * он стоит сейчас.
   *
   * «Застрял» бывает только у того, кто уже присел: стоящего в низкое место не
   * пускает сама ходьба, и подниматься ему незачем.
   */
  function stanceTick(step) {
    const room = volumeCanStand(scene, person, volumeStanceHead(stance), { ghost: ghosting() });
    const want = crouching();
    if (!want) {
      crouchStuck = stance.crouchMm > 0 && !room;
      // Отпустил Control под низким потолком — об этом говорится словом, один
      // раз на попытку: протолкнуть макушку сквозь вещь нельзя, переставить
      // человека в сторону — тоже, а молчание он прочтёт как залипшую клавишу.
      //
      // В обзоре молчим: человек смотрит со стороны, Control у него под
      // «ниже», и строка про его макушку была бы шумом не по делу.
      if (crouchStuck && !stuckSaid && view === "person") {
        notify(strings.volume.standBlocked, "info");
        stuckSaid = true;
      }
      if (!crouchStuck) stuckSaid = false;
    }
    // Пол под ногами спрашивается каждый тик: шагнул в дыру — он ушёл на этаж
    // ниже, и стойка роняет человека сама (таск 229, G342).
    const floor = fallFloor();
    const floorMm = floor ? floor.baseMm : 0;
    stance = volumeStanceStep(stance, step, { crouch: want || crouchStuck, canStand: room, floorMm });
    // Долетел — этаж под ним меняется **здесь**, посреди шага.
    if (floor && volumeStanceLanded(stance, floorMm)) fallTo(floor);
  }

  /** Control нажали: приседаем, пока держат. */
  function crouchStart() {
    if (crouchHeld) return;
    crouchHeld = true;
    walkSchedule();
  }

  /**
   * Control отпустили — или его нажали как модификатор (Ctrl+Z, Ctrl+C,
   * Ctrl+V): встаём. Встать негде — `stanceTick` оставит присед и скажет об
   * этом.
   */
  function crouchStop() {
    // Кнопку больше не держат — чем бы присед ни был начат: вставать всегда
    // значит «палец с кнопки снят» (таск 163, G242).
    crouchFinger = null;
    if (!crouchHeld) return;
    crouchHeld = false;
    walkSchedule();
  }

  /** Пробел: разовый прыжок. Присев и в воздухе не прыгают (`volumeStanceJump`). */
  function jump() {
    // В обзоре пробел не прыгает, а поднимает камеру, пока его держат (таск
    // 200): разовый прыжок там не значил бы ничего.
    if (view !== "person") return;
    // В падении не прыгают: пол, который считает стойка, лежит ниже нуля, и
    // человек над дырой в воздухе с первого тика (таск 229, G342).
    stance = volumeStanceJump(stance, fallFloorMm());
    walkSchedule();
  }

  /**
   * Пробел в обзоре держат (таск 192, G292; таск 200, G304). Отдельная пара
   * рук, а не повтор приседа: прыжок разовый, и держать ему нечего.
   */
  function riseStart() {
    if (riseHeld) return;
    riseHeld = true;
    walkSchedule();
  }

  function riseStop() {
    riseFinger = null;
    if (!riseHeld) return;
    riseHeld = false;
    walkStop();
  }

  // ——— та же стойка пальцем (таск 163, G242) ———
  //
  // Кнопка приседа держится, как клавиша: нажали — присели, отпустили —
  // встали, встать негде — остались внизу и услышали ту же строку. Своих чисел
  // у кнопок нет вовсе — они зовут то же, что Control и пробел.

  /**
   * Кнопка прыжка в обзоре становится кнопкой «Выше» и работает как присед —
   * пока держат (таск 192, таск 200). От первого лица та же кнопка остаётся
   * разовым прыжком по щелчку, и второго способа прыгнуть не завелось.
   */
  function risePress(event) {
    if (riseFinger !== null || view !== "around") return;
    event.preventDefault();
    riseFinger = event.pointerId;
    if (jumpButton.setPointerCapture) {
      try {
        jumpButton.setPointerCapture(event.pointerId);
      } catch (error) {
        // захват указателя кнопке не дали — отпускание поймаем окном
      }
    }
    riseStart();
  }

  function riseRelease(event) {
    if (riseFinger === null) return;
    if (event && event.pointerId !== undefined && event.pointerId !== riseFinger) return;
    riseStop();
  }

  // ——— «Действие» пальцем (таск 09 сценариев, G20) ———
  //
  // Нажали — то же, что нажатие E, отпустили — то же, что его отпускание:
  // у отвязанной клавиши между ними и решается одиночное, двойное или долгое.
  // Целится кнопка серединой поля — там стоит прицел.
  let actionFinger = null;

  function actionPress(event) {
    if (actionFinger !== null) return;
    event.preventDefault();
    actionFinger = event.pointerId;
    if (actionButton.setPointerCapture) {
      try {
        actionButton.setPointerCapture(event.pointerId);
      } catch (error) {
        // захват указателя кнопке не дали — отпускание поймаем окном
      }
    }
    actOnAim(homeOn() ? "key" : "click", fieldMiddle());
  }

  function actionRelease(event) {
    if (actionFinger === null) return;
    if (event && event.pointerId !== undefined && event.pointerId !== actionFinger) return;
    actionFinger = null;
    homeRelease(Boolean(event && event.type === "pointercancel"));
  }

  /**
   * Кнопка приседа. От первого лица она **переключает** (правка после сборки
   * сценариев: «присед сделай не удержанием, а переключением»): нажал —
   * присел, нажал ещё раз — встал, и идти пригнувшись можно, не держа её. В
   * обзоре та же кнопка — «Ниже», и её держат, как Control (таск 200).
   */
  function crouchPress(event) {
    if (view === "person") {
      event.preventDefault();
      crouchLatch(!crouchLatched);
      return;
    }
    if (crouchFinger !== null) return;
    event.preventDefault();
    crouchFinger = event.pointerId;
    if (crouchButton.setPointerCapture) {
      try {
        crouchButton.setPointerCapture(event.pointerId);
      } catch (error) {
        // захват указателя кнопке не дали — отпускание поймаем окном
      }
    }
    crouchStart();
  }

  /**
   * Включить или снять присед кнопкой. Встать негде — `stanceTick` оставит
   * присед и скажет об этом той же строкой, что отпущенному Control.
   */
  function crouchLatch(value) {
    if (crouchLatched === value) return;
    crouchLatched = value;
    crouchButton.classList.toggle("is-on", value);
    syncStanceWords();
    walkSchedule();
  }

  // Отпустили палец, увели его за край, потеряли захват, ушли из вида от
  // первого лица — всё это одно и то же: кнопку больше не держат.
  function crouchRelease(event) {
    if (crouchFinger === null) return;
    if (event && event.pointerId !== undefined && event.pointerId !== crouchFinger) return;
    crouchStop();
  }

  /**
   * Место под человеком изменилось не шагом (перенос кликом, переход по
   * лестнице, правка чертежа) — присевший, которому не давали встать, мог
   * оказаться там, где можно. Часы в этот миг стоят, и спросить об этом надо
   * руками.
   */
  function stanceRecheck() {
    // Пол под ногами мог уйти тем же переносом (кликнули в дыру, переставили
    // чертёж, включили «Все этажи»): часы в этот миг стоят, и падение начать
    // некому. Будить их безопасно — `walkSchedule` сам спросит, держит ли ход
    // хоть кто-нибудь (таск 229, G342).
    fallSnap = null;
    walkSchedule();
    if (crouching() || !crouchStuck) return;
    if (!volumeCanStand(scene, person, volumeStanceHead(stance), { ghost: ghosting() })) return;
    crouchStuck = false;
    stuckSaid = false;
    walkSchedule();
  }

  /**
   * Пустить ход. Часы ставятся **здесь**, на пуске: отсюда ход начинают
   * события — нажатая клавиша, палец на площадке, пропавший пол под ногами.
   */
  function walkSchedule() {
    if (walking || !moving() || closed) return;
    clock = now();
    walking = scheduleFrame(walkTick);
  }

  /**
   * Заказать следующий тик **изнутри кадра** — и часов не трогать (дефект
   * D81, таск 233).
   *
   * Прежде продолжение шло той же `walkSchedule`, и она переставляла `clock`
   * на «сейчас» — то есть **после** шага и кадра. Время, ушедшее на сам кадр,
   * из счёта выпадало, и чем дороже кадр, тем медленнее шли ходьба и падение:
   * на объекте заказчика полёт с трёх метров вместо 0,81 с (√(2h/g), таск 229)
   * занимал секунды, и всё это время поле перерисовывалось. Правило простое:
   * часы ставит пуск, а продолжение их только читает.
   */
  function walkAgain() {
    if (walking || !moving() || closed) return;
    walking = scheduleFrame(walkTick);
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
      side += pad.side;
    }
    // Джойстик взгляда вертит голову, пока его держат: скорость — от того,
    // насколько увели палец (`volumeLookVector`), поворот — тем же счётом, что
    // у мыши (`lookTurn`).
    if (lookPad) {
      lookTurn(
        lookPad.yaw * VOLUME_LOOK_PAD_YAW_DEG_S * (Math.PI / 180) * step,
        lookPad.pitch * VOLUME_LOOK_PAD_PITCH_DEG_S * (Math.PI / 180) * step,
      );
    }
    // ——— скорость (таск 207, G311) ———
    //
    // Пешком — шаг человека, и он не тронут. В обзоре — мера, пройденная за
    // `VOLUME_AROUND_FLY_S` (`volumeAroundSpeed`): «вблизи точность, издали
    // размах» одним отношением, а не двумя скоростями.
    const speed =
      (view === "person"
        ? run
          ? VOLUME_RUN_MM_S
          : VOLUME_WALK_MM_S
        : volumeAroundSpeed(around.distance, run)) * step;
    if (turn !== 0) {
      const spin = Math.max(-1, Math.min(1, turn)) * step * 2.2;
      if (view === "person") person.yaw += spin;
      // Стрелками обзор поворачивается на месте — тем же, чем вертит мышь:
      // второго способа повернуться не заводится (таск 207).
      else aroundTurn(around.yaw + spin, around.pitch);
    }
    const basis = volumeBasis(view === "person" ? person : { yaw: around.yaw, pitch: around.pitch });
    // Длина делится на себя же, но не больше единицы: клавиши дают ровно
    // единицу (или корень из двух на двух сразу, как и было), а палец на
    // площадке — сколько увёл, и полшага должны остаться полушагом.
    const length = Math.hypot(forward, side);
    const scale = length === 0 ? 0 : (Math.min(1, length) / length) * speed;
    // Стойка — только у человека: в обзоре Control значит «ниже», а не
    // «присесть», и приседать там некому (таск 200, G304).
    stanceTick(step);
    if (view === "person") {
      if (forward !== 0 || side !== 0) {
        // Пешком ход идёт **по плану**, а не по направлению взгляда: с
        // опущенным взглядом иначе уходишь в пол, и это чувствуется как
        // провал, а не как шаг.
        const flat = Math.hypot(basis.fwd.x, basis.fwd.y) || 1;
        const dx = ((basis.fwd.x / flat) * forward + basis.right.x * side) * scale;
        const dy = ((basis.fwd.y / flat) * forward + basis.right.y * side) * scale;
        // Макушку даёт стойка (G234): присевший проходит там, где низко, — и
        // ровно там, где это правда проходимо. Отметка «сквозь стены» снимает
        // этот счёт целиком, и снимает его одно место — `volumeStep`.
        const moved = volumeStep(scene, person, dx, dy, volumeStanceHead(stance), { ghost: ghosting() });
        person.x = moved.x;
        person.y = moved.y;
        syncWhere();
        stairCheck();
      }
    } else {
      aroundFly(forward, side, scale, basis, speed);
    }
    paint();
    walkAgain();
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
    cancelFrame(walking);
    walking = 0;
  }

  // ——— мышь ———
  //
  // Голову вертят двумя способами, и оба нужны. Захват указателя — то самое
  // «как в игре»: мышь водит взглядом без нажатой кнопки. Но захват даёт не
  // каждый браузер и не во всякой вкладке, поэтому перетаскивание работает
  // всегда и само по себе.

  /**
   * Повернуть взгляд — **одно правило на оба вида** (таск 207, G312).
   *
   * Слова заказчика: «почему движение мыши с зажатой клавишей перемещает
   * камеру вокруг какой-то цели, а не просто поворачивает камеру как при виде
   * от 1 лица? должно быть так же». Орбита, которую таск 200 оставил
   * рысканью, отменена: камера вертится **на месте** — и считается это здесь,
   * одним счётом. Разница между видами осталась одна: чья это голова.
   */
  function lookBy(dx, dy) {
    const perPixel = (VOLUME_LOOK_DEG_PX * Math.PI) / 180;
    lookTurn(dx * perPixel, -dy * perPixel);
    redraw();
  }

  /** Повернуть взгляд на угол — в радианах, вверх положительно. Кадр заказывает зовущий. */
  function lookTurn(yawBy, pitchBy) {
    const aim = view === "person" ? person : around;
    const yaw = aim.yaw + yawBy;
    const pitch = volumeClampPitch(aim.pitch + pitchBy);
    if (view === "person") {
      person.yaw = yaw;
      person.pitch = pitch;
    } else {
      aroundTurn(yaw, pitch);
    }
  }

  function onPointerDown(event) {
    // Ctrl+щелчок на Mac — вызов контекстного меню, а не присед (G234): правило
    // то же, что у Ctrl с буквой, только модификатором тут работает мышь.
    if (event.ctrlKey) crouchStop();
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
      // Второй палец — жест двумя пальцами, а не второй поворот: взгляд
      // перестаёт ехать за первым пальцем, иначе щипок водил бы головой заодно.
      if (touches.size === 2) {
        look = null;
        pinch = gesturePinchOf(touches.values());
        return;
      }
      if (touches.size > 2) return;
    }
    look = { x: event.clientX, y: event.clientY, moved: false };
    // Отвязанная клавиша под рукой — нажатие начинается сейчас (таск 09).
    homeGestureStart(event);
  }

  function onPointerMove(event) {
    // Палец на площадке ходьбы — это ход, а не поворот: пока он там, поле
    // взгляда его движений не видит вовсе (таск 149).
    if (pad && event.pointerId === pad.id) {
      padMove(event);
      return;
    }
    if (lookPad && event.pointerId === lookPad.id) {
      lookMove(event);
      return;
    }
    if (locked) {
      lookBy(event.movementX || 0, event.movementY || 0);
      return;
    }
    if (event.pointerType === "touch" && touches.has(event.pointerId)) {
      touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
      // Два пальца в обзоре возят карту и щипком приближают — ровно как на
      // плане и в чертеже (таск 174, G256). Разбирает жест общий
      // `gestures.js`, и порядок применения оттуда же: сперва масштаб, потом
      // сдвиг на то, насколько уехала середина между пальцами.
      //
      // От первого лица два пальца не делают ничего, и это прежнее поведение:
      // там ходят площадкой и вертят головой, приближать нечего, а поле зрения
      // человек не просил.
      if (pinch && touches.size === 2) {
        const step = gesturePinchStep(pinch, touches.values());
        if (step) pinch = step.pinch;
        if (step && view === "around") {
          // Развели пальцы — приблизились, то есть камера подошла: расстояние
          // делится на множитель, а не умножается. Взгляд щипок не трогает
          // (таск 195): куда смотрят — выбор руки, а не приближения.
          aroundZoom(step.factor);
          const moved = volumeAroundPan(around, viewport(), step.panX, step.panY);
          aroundSlide(moved.dx, moved.dy);
          redraw();
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

  function onPointerUp(event) {
    const started = look;
    look = null;
    if (event.pointerType === "touch") {
      touches.delete(event.pointerId);
      if (touches.size < 2) pinch = null;
    }
    padEnd(event);
    lookEnd(event);
    // Захвата указателя кнопка могла и не получить — тогда отпускание придёт
    // сюда, и присед обязан сняться здесь же: палец свой она узнает сама.
    crouchRelease(event);
    riseRelease(event);
    actionRelease(event);
    // Нажатие клавиши, начатое на опускании, кончается здесь; повёл взглядом —
    // это был поворот головы, а не нажатие (таск 09 сценариев).
    if (started) homeGestureEnd(started.moved);
    if (closed || !started || started.moved) {
      homeGesture = null;
      return;
    }
    // ——— щелчок равноценен E (G235) ———
    //
    // Слова заказчика: «клик на дверь должен тоже её открывать. Клик
    // равноценен нажатию E на объект под курсором». **Это меняет решение таска
    // 150**, где щелчок по двери только запоминал, о какой двери речь, а
    // открывала её клавиша. Мышь при этом догнала палец: касанием дверь
    // открывалась уже в таске 149 — теперь у пальца и у мыши одно правило, а не
    // два.
    //
    // Разводится всё **по тому, на что показали**, а не по виду и не по
    // устройству: дверь — открыть, вещь — выделить, а щелчок **мимо того и
    // другого** значит своё, потому что у E там нет дела вовсе. Отсюда и
    // перенос кликом по полу в обзоре (G212) никуда не девается: он живёт
    // ровно в ветке «ни двери, ни вещи», то есть там же, где жил, — и ни одной
    // точки поля у него новое правило не отняло. Дверь и до таска 159
    // забирала щелчок себе (запоминала его), только проку от этого мышью не
    // было никакого.
    if (!scene.empty) {
      const at = atEvent(event);
      // ——— щелчок по миникарте переносит (G270) ———
      //
      // «В режиме от первого лица при клике курсором на миникарте телепортируй
      // туда». Карта — накладка поверх кадра, и щелчок по ней принадлежит ей,
      // а не тому, что за ней: иначе человек, ткнувший в дальнюю комнату,
      // открывал бы дверь, случайно оказавшуюся под картой.
      //
      // Под захваченной мышью карта щелчка не берёт: курсора там нет вовсе, и
      // прицел стоит посреди поля (таск 159) — щёлкать по углу экрана нечем.
      //
      // Куда человек встанет, решает **то же правило, что у переноса кликом по
      // полу** (G212): `volumeMoveTo` выталкивает тело из стены и ставит
      // вплотную к ней, а место теснее тела меняет на ближайшее свободное
      // (D39). Второго правила «куда можно встать» в сборке нет.
      if (view === "person" && !locked) {
        const spot = volumeMinimapAt(viewport(), scene.boundsMm, at, volumeParamsRead().minimap, minimapRoom);
        if (spot) {
          const moved = volumeMoveTo(scene, spot, volumeStanceHead(stance));
          person.x = moved.x;
          person.y = moved.y;
          // Перенесли присевшего — под низким он остался или вышел, решает
          // новое место (G234); у лестницы спросит про этаж, как при ходьбе.
          stanceRecheck();
          syncWhere();
          stairCheck();
          redraw();
          return;
        }
      }
      const door = volumeDoorAt(shown, at.x, at.y);
      const choice = aimChoiceAt(at, door);
      // Дверь, по которой щёлкнули, остаётся под рукой: E распоряжается ею и
      // после того, как мышь съехала с полотна (G207).
      if (choice.kind === "door") {
        heldDoor = choice.id;
        aimedDoor = choice.id;
      }
      // Захват мыши после попадания не просится: человек целился в розетку или
      // в дверь, а не в поле.
      const acted = actOnChoice(choice, at, "click");
      homeGesture = null;
      if (acted) return;
      // Мимо — снимает выделение, как тап по пустому месту плана.
      select(null);
      pickChannel(null);
      // Клик по обзору переносит туда, куда показали (G212). Захват мыши в
      // обзоре при этом не просится: у клика здесь свой смысл, а голову в
      // обзоре водят перетаскиванием, как и раньше.
      if (view === "around") {
        const place = volumeFloorAt(camera(), viewport(), at.x, at.y);
        if (place) {
          // Перенос — та же ходьба, только сразу: куда присевший пройдёт, туда
          // он и переносится (G234). Стоя под низкое его не поставит ничто.
          const moved = volumeMoveTo(scene, place, volumeStanceHead(stance));
          person.x = moved.x;
          person.y = moved.y;
          // Перенесли присевшего — под низким он остался или вышел, решает
          // новое место (G234).
          stanceRecheck();
          syncWhere();
          redraw();
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
    // Где лежал курсор до захвата — забывается: вернув его, браузер ставит
    // указатель сам, и прицел, оставшийся на старом месте, показывал бы на
    // то, во что человек уже не целится. До первого движения мыши он стоит
    // посреди поля — то есть там, где целился миг назад (G235).
    pointer = null;
    // Мышь отдали виду — курсора нет, и целится середина поля; вернули — рука.
    syncAimNode();
    syncHint();
  }

  /**
   * Колесо и трекпад в обзоре (таск 195, требование G299).
   *
   * Слова заказчика: «я же просил в обзоре скролл 2 пальцами… сейчас 2
   * пальцами всегда зум». Браузер шлёт двухпальцевый свайп трекпада тем же
   * `wheel`, что и колесо мыши, и своего разбора у объёма нет: что пришло,
   * решает общий `gestureWheel` — та же дверь, что у плана и чертежа (G241).
   *
   * Что из ответа получается:
   *
   *   `pan`  — свайп двумя пальцами **возит обзор по полу**, тем же переводом
   *            `volumeAroundPan`, которым его возят два пальца на стекле.
   *            Слово заказчика — «скролл», то есть сдвиг: вращение вокруг цели
   *            осталось за перетаскиванием, и отнимать у свайпа сдвиг в пользу
   *            второго способа вертеть головой было бы подменой просьбы.
   *   `zoom` — щипок трекпада (он приходит с `ctrlKey`) и колесо мыши
   *            **отодвигают камеру**: мышь двумя пальцами не водят, а щипок и
   *            на плане приближение. Расстояние делится на множитель — развели
   *            пальцы, значит камера подошла.
   *
   * Взгляд колесо не трогает вовсе. До таска 195 оно само делало вид круче,
   * чтобы камера не нырнула под крышу; с таска 200 камера стоит сама, и
   * приближение значит ровно «камера подошла к тому, на что смотрит», а не
   * «взгляд опустился». Пол и здесь держит (`volumeAroundEye`): подойти к цели
   * сквозь плиту нельзя.
   */
  function onWheel(event) {
    if (view !== "around") return;
    event.preventDefault();
    const step = gestureWheel(event, wheelStreak);
    wheelStreak = step.streak;
    if (step.kind === "pan") {
      const moved = volumeAroundPan(around, viewport(), step.panX, step.panY);
      aroundSlide(moved.dx, moved.dy);
    } else {
      aroundZoom(step.factor);
    }
    redraw();
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

  /**
   * Где палец на площадке — `{dx, dy, radius}` от её середины, — и кружок
   * за ним. Одна мерка на обе площадки: ходьбы и взгляда.
   */
  function knobAt(area, knob, event) {
    const rect = area.getBoundingClientRect ? area.getBoundingClientRect() : { left: 0, top: 0, width: 0, height: 0 };
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const radius = Math.max(1, Math.min(rect.width, rect.height) / 2);
    const dx = event.clientX - cx;
    const dy = event.clientY - cy;
    // Кружок показывает палец, но из площадки не выезжает.
    const length = Math.hypot(dx, dy) || 1;
    const reach = Math.min(1, length / radius) * radius * 0.62;
    knob.style.transform = "translate(" + (dx / length) * reach + "px, " + (dy / length) * reach + "px)";
    return { dx, dy, radius };
  }

  function padAt(event) {
    const at = knobAt(padNode, padKnob, event);
    return volumePadVector(at.dx, at.dy, at.radius);
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
    pad = { id: event.pointerId, forward: move.forward, side: move.side };
    padNode.classList.add("is-on");
    walkSchedule();
  }

  function padMove(event) {
    if (!pad || event.pointerId !== pad.id) return;
    event.preventDefault();
    const move = padAt(event);
    pad = { id: pad.id, forward: move.forward, side: move.side };
    walkSchedule();
  }

  function padEnd(event) {
    if (!pad || (event && event.pointerId !== undefined && event.pointerId !== pad.id)) return;
    pad = null;
    padNode.classList.remove("is-on");
    padKnob.style.transform = "";
    walkStop();
  }

  // ——— джойстик взгляда (правка после сборки сценариев) ———
  //
  // Держат его, как площадку ходьбы: палец лёг — голова вертится, пока он
  // уведён от середины; снят — встала. Ходьба и взгляд — разные пальцы, и
  // каждый узнаёт свой по `pointerId`.

  function lookAt(event) {
    const at = knobAt(lookNode, lookKnob, event);
    return volumeLookVector(at.dx, at.dy, at.radius);
  }

  function lookStart(event) {
    if (lookPad || closed) return;
    setTouch(true);
    event.preventDefault();
    if (lookNode.setPointerCapture) {
      try {
        lookNode.setPointerCapture(event.pointerId);
      } catch (error) {
        // захват указателя джойстиком не дали — обойдёмся событиями окна
      }
    }
    const turn = lookAt(event);
    lookPad = { id: event.pointerId, yaw: turn.yaw, pitch: turn.pitch };
    lookNode.classList.add("is-on");
    walkSchedule();
  }

  function lookMove(event) {
    if (!lookPad || event.pointerId !== lookPad.id) return;
    event.preventDefault();
    const turn = lookAt(event);
    lookPad = { id: lookPad.id, yaw: turn.yaw, pitch: turn.pitch };
    walkSchedule();
  }

  function lookEnd(event) {
    if (!lookPad || (event && event.pointerId !== undefined && event.pointerId !== lookPad.id)) return;
    lookPad = null;
    lookNode.classList.remove("is-on");
    lookKnob.style.transform = "";
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
    // Та же кнопка в колонке: один ответ `volumeFloorAction` на оба места,
    // разойтись им нечем. В поле кнопка нужна тому, кто идёт пальцем и смотрит
    // в комнату; в колонке — тому, кто смотрит на панель.
    floorButton.hidden = stairButton.hidden;
    if (!floorButton.hidden) {
      floorButton.textContent = action.label;
      floorButton.title = action.title;
    }
    const floor = schemeFloorOf(getState().project, schemeId);
    floorLine.textContent =
      floor === null || floor === undefined ? strings.volume.floorNone : String(floor);
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
    lookEnd(null);
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
   * **Человек выходит у лестницы** (дефект D58, слова заказчика: «почему при
   * переходе между схемами по лестнице я оказываюсь в середине объекта, а не
   * возле лестницы?»). Считает это `volumeStairLanding` — одно место на всю
   * сборку, разбор у него же: выход с лестницы, если он нарисован, иначе
   * площадка рядом с самим маршем, и взгляд прочь от неё, в комнату.
   *
   * **Прежнее правило «то же место плана»** (таск 149) осталось ровно на тот
   * случай, ради которого и годилось: лестничной клетки на новом этаже не
   * нарисовано вовсе. И оно стало честнее — место пересчитано через привязку
   * схем (таск 205), то есть это та же точка **дома**, а не та же точка чужого
   * чертежа. Разошлись эти два правила именно из-за нулей: у каждой схемы свой,
   * и «те же координаты» выносили человека на середину квартиры.
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
    // кнопкой и встанет у той же лестницы.
    const was = { x: person.x, y: person.y };
    const from = schemeId;
    // Чем воспользовались — маршем или выходом: прибытие ищет **парную** вещь
    // (таск 204). Спрашивается это до смены схемы: после неё под ногами уже
    // другой этаж.
    const used = stairHere();
    leaveScheme();
    schemeId = option.schemeId;
    // Этаж, на который поднялись, становится текущей схемой всего приложения
    // (таск 153): список меток справа, имя в шапке и подсветка в списке схем
    // обязаны говорить про тот этаж, на котором человек стоит. Своя подписка
    // этого изменения не увидит как смены схемы — `schemeId` уже равен ему.
    setState({ schemeId });
    setScene(state);
    // Место ухода в координатах нового этажа: им выбирается лестница, когда
    // их несколько, и оно же работает запасным местом.
    const want = sameSpotOn(state.project, from, schemeId, was);
    const landing = volumeStairLanding(
      scene,
      want,
      volumeStanceHead(stance),
      used && used.stair ? used.stair.key : null,
    );
    const moved = volumeMoveTo(scene, landing || want, volumeStanceHead(stance));
    person.x = moved.x;
    person.y = moved.y;
    // Лицом в комнату: с лестницы сходят в ту сторону, где есть место. Без
    // лестницы взгляд не трогается — человек идёт дальше, куда смотрел.
    if (landing) person.yaw = landing.yaw;
    aroundLookAt(person.x, person.y);
    select(null);
    // У лестницы, с которой сошли, вопрос второй раз не задаётся: иначе он
    // всплыл бы сразу же и предложил вернуться обратно.
    stairAsked = (stairHere() || {}).objectId || null;
    sync();
    notify(
      landing
        ? text("volume.stairArrived", { floor: option.floor, what: volumeFloorWord(landing.key, true) })
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

  /**
   * То же место **дома**, пересчитанное из координат одной схемы в координаты
   * другой (таск 205, G309).
   *
   * У каждой схемы свой ноль — он приходит с подложки, — и «те же координаты»
   * на соседнем этаже означают другое место дома. Разницу знает привязка, и
   * спрашивается она одной дверью (`volumeSchemeOriginMm`); без привязки
   * разница нулевая, и всё остаётся как было (G68).
   */
  function sameSpotOn(project, fromId, toId, at) {
    if (!at || fromId === toId) return at;
    const from = volumeSchemeOriginMm(project, fromId);
    const to = volumeSchemeOriginMm(project, toId);
    return { ...at, x: at.x + from.x - to.x, y: at.y + from.y - to.y };
  }

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
    const from = schemeId;
    schemeId = back.schemeId;
    setState({ schemeId });
    setScene(state);
    if (!scene.empty) {
      // Помним мы место **той** схемы, и пересчитывать его не надо. А вот
      // запасное (на ней ещё не стояли) приходит из координат покидаемой
      // схемы, и его переводит привязка (таск 205).
      const at = place || sameSpotOn(state.project, from, schemeId, { x: person.x, y: person.y, yaw: person.yaw });
      const moved = volumeMoveTo(scene, at, volumeStanceHead(stance));
      person.x = moved.x;
      person.y = moved.y;
      person.yaw = at.yaw;
      if (place) person.pitch = volumeClampPitch(place.pitch);
      aroundTurn(person.yaw, around.pitch);
      aroundLookAt(person.x, person.y);
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
    // Пробел у галочки и переключателя — их единственная клавиша: прыжок её не
    // отбирает (`uiSpaceTarget`, находка 10 разбора механик). У кнопки остаётся
    // Enter, у галочки не осталось бы ничего.
    if (event.code === VOLUME_JUMP_KEY && uiSpaceTarget(event.target)) return;
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
    // Присед и прыжок (G234). Разбор — `volumeStanceKey`: Control приседает сам
    // по себе и отменяет присед в сочетании, пробел прыгает и не прокручивает
    // страницу, системные сочетания с пробелом остаются системе.
    const stanceKey = volumeStanceKey(event);
    if (stanceKey === "crouch") {
      // `preventDefault` здесь не ставится по той же причине, что у Alt: Control
      // — модификатор ввода, и перехватывать его целиком значило бы ломать
      // сочетания на всей странице. Нам нужно его нажатие, а не его смысл.
      if (!event.repeat) crouchStart();
      return;
    }
    if (stanceKey === "combo") {
      crouchStop();
      return;
    }
    if (stanceKey === "jump") {
      // Прокрутка страницы и кнопка под фокусом снимаются здесь и в `onKeyUp`.
      event.preventDefault();
      // В обзоре пробел держат (таск 200): «пробел (прыжок) - выше». Автоповтор
      // клавиши к этому ничего не добавляет — поднимаемся, пока не отпустили.
      if (!event.repeat) {
        if (view === "around") riseStart();
        else jump();
      }
      return;
    }
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.code === "KeyV") {
      event.preventDefault();
      // Тот же ответ, что у кнопки на поле (таск 165): какой вид следующий,
      // считается в одном месте.
      setView(volumeViewSwitch(view).next);
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
      // При запущенном доме E — клавиша, которую держат (таск 09 сценариев):
      // автоповтор ничего не нажимает, отпускание — в `onKeyUp`.
      if (homeOn()) {
        if (!event.repeat) actOnAim("key");
        return;
      }
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
    // Отпустили E — нажатие клавиши выключателя кончилось (таск 09 сценариев).
    // `ours()` не спрашивается: отпустить можно и в другом режиме.
    if (event.code === VOLUME_DOOR_KEY) {
      homeRelease();
      return;
    }
    // Отпустили Alt — мышь возвращается виду (G211). Если захвата и не было,
    // просить его по отпусканию Alt нельзя: человек не звал его вовсе.
    if (volumeAltKey(event)) {
      if (!altFree) return;
      altFree = false;
      grabPointer();
      return;
    }
    // Отпустили Control — встаём (G234). Спрашивать `ours()` здесь не нужно и
    // нельзя: человек мог уйти в другой режим, не отпустив клавишу, и присед
    // остался бы висеть.
    if (volumeCrouchKey(event.code)) {
      crouchStop();
      return;
    }
    // Нажатие кнопки пробелом браузер делает по **отпусканию**, и снять его
    // можно только здесь: пробел в объёме прыгает, а не нажимает кнопку, на
    // которой остался фокус после щелчка по панели.
    if (event.code === VOLUME_JUMP_KEY) {
      // Отпустили пробел — в обзоре перестаём подниматься (таск 200).
      // Спрашивать `ours()` для этого нельзя по той же причине, что у Control:
      // человек мог уйти в другой режим, не отпустив клавишу, и подъём остался
      // бы висеть.
      riseStop();
      if (ours() && !uiSpaceTarget(event.target)) {
        event.preventDefault();
        event.stopPropagation();
      }
      return;
    }
    keyStop(event.code);
  }

  function onBlur() {
    keyStop(null);
    // Ушли с окна, держа E или «Действие», — нажатие брошено: отпускания не будет.
    homeRelease(true);
    // Ушли с окна с зажатым Control — его отпускание до нас не дойдёт, и
    // стоять в приседе до следующего нажатия человек не просил.
    crouchStop();
    // То же с пробелом в обзоре: подниматься до следующего нажатия он не просил.
    riseStop();
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
  // Своей кнопки у режима больше нет (таск 153): во весь экран разворачивает та
  // же кнопка над полем, что и в двух других режимах, и разворачивает она
  // страницу целиком.
  //
  // С таска 166 страница в полном экране «Объёма» убирает с себя всё, кроме
  // поля (G246): шапку, обе колонки, нижний ряд и переключатель режимов. Что
  // именно уходит — в `styles.css`, отметку ставит `canvas.js`, а полю
  // остаётся своё: перемериться под новый размер и убрать с поля то, что лишнее
  // уже на нём — сводку и развёрнутую подсказку.
  //
  // Ответ «мы в голом поле?» не хранится флагом, а спрашивается: выйти можно
  // мимо кнопки — Esc, жест, переключение вкладки, — и запомненное разошлось бы
  // с настоящим молча. Правило при этом общее с страницей (`canvasFullscreenBare`),
  // своего второго у поля нет.

  function bare() {
    return canvasFullscreenBare(canvasFullscreenOn(document), screenMode());
  }

  /**
   * Где сейчас параметры: ряды в колонке или окно за кнопкой (таск 231, G351).
   *
   * Ответ один и считает его `volumeParamsHome`; поле только отдаёт ему два
   * довода, которые знает само, — раскладку и полный экран. Место закрылось —
   * кнопка прячется, а открытое окно закрывается вместе с ней: окно, повисшее
   * над полем, у которого параметры уже в колонке, и было бы тем вторым путём,
   * которого заказчик не хочет.
   */
  function syncParamsHome() {
    const home = volumeParamsHome(getState().layout, bare());
    paramsFields.node.hidden = home !== "column";
    paramsButton.shown(home === "window");
  }

  function onFullscreenChange() {
    if (closed) return;
    resize();
    // Сводка и подсказка узнают о полном экране только отсюда: состояние
    // сеанса не менялось, и подписка их не позовёт. Параметры — тоже: в полном
    // экране колонок нет, и ряды уступают место окну.
    sync();
  }

  // ——— подписи ———

  function syncWhere() {
    where.textContent = scene.empty || view !== "person" ? "" : volumeWhere(getState().project, scene, person);
    // Человек ходит — датчики его помещения видят его (история 2.8).
    homePresence();
  }

  /**
   * Сводка — правая плашка со знаком «i» (G228): где человек стоит, сколько в
   * сцене чего и чего в ней **не** видно.
   *
   * Предупреждения (неразмещённые метки, запасной габарит) — её часть, и
   * пропасть вместе со свёрнутой плашкой они не должны: кнопка получает точку
   * (`alert`), ту же самую, которой подсказка говорит «текст сменился».
   *
   * В пустом поле плашка молчит: всё, что она сказала бы, уже написано
   * посреди экрана, а второй раз то же самое — шум.
   */
  function syncSummary() {
    titleNode.textContent = volumeTitle(schemeName(), schemeFloorOf(getState().project, schemeId));
    // Поле во весь экран (таск 166, G246): сводка уходит целиком — вместе со
    // своим знаком. Она про объект, а не про руки: сколько стен и проёмов, чего
    // не хватает, где человек стоит. Это читают, стоя у стола, и ради этого из
    // полного экрана выходят — а выйдя, находят её на прежнем месте, с той же
    // точкой предупреждения.
    if (scene.empty || bare()) {
      summaryPlate.update([], { hidden: true });
      return;
    }
    meta.textContent = [
      text("volume.counts", {
        walls: scene.wallCount,
        openings: scene.openingCount,
        rooms: scene.rooms.length,
        marks: scene.marks.length,
      }),
      // Стопка этажей (таск 202): числа выше — про тот этаж, на котором
      // человек стоит, и промолчать о том, что в кадре их несколько, нельзя.
      volumeStackLine(scene, floorPlan(getState())),
      ...volumeNotes(scene),
    ]
      .filter((part) => part !== "")
      .join(" ");
    missing.textContent = volumeUnplacedLine(scene.unplaced);
    missing.title = volumeUnplacedTitle(scene.unplaced);
    missing.hidden = scene.unplaced.length === 0;
    const spare = scene.spare || [];
    // Та же строка, что под развёрткой (`markSpare.js`, G230): в сводке место
    // под абзац есть, поэтому с хвостом — откуда числа и что сделать.
    spareLine.textContent = markSpareLine(spare, { why: true });
    spareLine.title = markSpareTitle(spare);
    spareLine.hidden = spare.length === 0;
    summaryPlate.update([titleNode, where, meta, missing, spareLine], {
      alert: scene.unplaced.length > 0 || spare.length > 0,
    });
  }

  /**
   * Подсказка плашкой (G218, G228): текст у неё свой, а свёрнутость, точка на
   * кнопке и память — общие с остальными плашками (`panels/plate.js`).
   */
  function syncHint() {
    const value = volumeHintText({
      empty: scene.empty,
      view,
      touching,
      locked,
      // Пальцем прицел стоит ради «Действия», а не идёт за курсором: строка
      // про курсор ему ни к чему (таск 09 сценариев).
      aim: !aimNode.hidden && !touching,
      doors: scene.doors,
      open: openDoors,
      aimedDoor: aimedDoor || heldDoor,
      sheers: scene.sheers,
      openSheers: openCurtains,
      aimedSheer: aimedSheer(),
      stair: stairHere(),
      floors: floorOptions(),
      back: backFloor(),
      keys: channelKeys(),
      // Отметка таска 192: подсказка обязана говорить то, что делают руки
      // сейчас, а не то, что они делали до галки.
      ghost: ghosting(),
      // Дом идёт (таск 09 сценариев): E и щелчок управляют устройствами.
      home: homeOn(),
    });
    // Подсказка в полном экране не уходит, а **складывается в свой знак**
    // (таск 166, G246). Она единственная из спрятанного говорит про руки:
    // какие клавиши, что делает палец, открыта ли дверь, — и как раз в полном
    // экране ей учатся. Текстом она заняла бы верхнюю треть сцены, знаком — те
    // же 26 точек, что соседние кнопки, и разворачивается одним нажатием.
    // Памяти человека это не трогает: вышли — плашка такая, какой была.
    hintPlate.fold(bare());
    hintPlate.update(value);
  }

  function sync() {
    personButton.className = "ui-btn" + (view === "person" ? " is-on" : "");
    aroundButton.className = "ui-btn" + (view === "around" ? " is-on" : "");
    stage.classList.toggle("volume__stage--person", view === "person");
    syncAimNode();
    // ——— площадка и стойка пальцем в обоих видах (таск 200, G304) ———
    //
    // До таска 200 и площадка ходьбы, и кнопки стойки жили **только от первого
    // лица**, и довод был честный: в обзоре площадка возила бы цель камеры, а
    // не человека. Теперь в обзоре летают — тем же ходом по взгляду, пробелом и
    // Control, — и площадка с кнопками значат там ровно то же, что клавиши:
    // вперёд по взгляду, поворот, выше, ниже.
    //
    // Это и есть ответ на вопрос тикета про планшет: кнопки никуда не
    // переезжают, они просто перестали исчезать в обзоре и меняют подписи
    // (`syncStanceWords`). Второй оснастки для полёта камеры не заведено.
    const noWalk = !touching || scene.empty;
    padNode.hidden = noWalk;
    lookNode.hidden = noWalk;
    actionButton.hidden = noWalk;
    if (noWalk) lookEnd(null);
    // Полоса часов стоит в том же углу, что площадка ходьбы, и уступает ей:
    // площадкой ходят не глядя, и накрывать её строкой нельзя. Подъём — ровно
    // на площадку, мерой самой площадки (`volume.css`), без своих чисел.
    clockNode.classList.toggle("volume__clock--overPad", !noWalk);
    clockNode.hidden = scene.empty;
    if (padNode.hidden) padEnd(null);
    stanceBox.hidden = noWalk;
    if (stanceBox.hidden) {
      crouchRelease(null);
      crouchLatch(false);
      riseRelease(null);
      actionRelease(null);
    }
    // Ушла оснастка — ушёл и зазор миникарты: карта возвращается в свой угол.
    placeStance();
    // Кнопка вида — не сенсорная оснастка, а вторая ячейка угла поля (таск 166,
    // G245): она есть и пальцем, и мышью, и в обоих видах. Уходит она только
    // там, где смотреть не на что: в пустом поле смена вида ничего не меняет,
    // а кнопка полного экрана без схемы уходит по той же причине.
    viewButton.hidden = scene.empty;
    const switcher = volumeViewSwitch(view);
    // Подпись у значка одна — действие: «Обзор» само по себе прочиталось бы как
    // «вы в обзоре», а кнопка в него ведёт. Слово ставится в подсказку и в
    // `aria-label`, а `uiButtonLabel` тут не годится: он пишет текст в кнопку и
    // стёр бы собой значок.
    viewButton.replaceChildren(switcher.next === "person" ? uiIcon("viewPerson") : uiIcon("viewAround"));
    viewButton.title = switcher.title;
    viewButton.setAttribute("aria-label", switcher.title);
    doorsButton.hidden = !touching || scene.empty || (scene.doors || []).length === 0;
    shotButton.hidden = scene.empty;
    // Режим без своего содержимого (таск 153): чертежа нет — поле показывает
    // задник и плашку посреди экрана. Кнопка режима при этом не гаснет: режим
    // доступен всегда, и сказать, чего не хватает, обязано само поле.
    emptyNote.hidden = !scene.empty;
    emptyNote.textContent = scene.empty ? strings.volume.empty : "";
    // Слова на кнопках стойки зависят от вида (таск 200): в обзоре те же две
    // кнопки значат «выше» и «ниже».
    syncStanceWords();
    // Человека могли перенести на другой этаж или на другую схему, пока он
    // сидел под низким: встать ему, может быть, уже есть где (G234).
    stanceRecheck();
    syncSummary();
    syncWhere();
    syncStair();
    syncSelection();
    syncParamsHome();
    // «Выполнить команду» — пока дом идёт; карточка — по оснастке поля, которая
    // только что могла появиться или уйти (таск 09 сценариев, G21).
    commandRow.hidden = !homeOn();
    placeCard();
  }

  // ——— жизнь поверхности ———

  function destroy() {
    if (closed) return;
    // Дом, запущенный «Объёмом», уходит вместе с ним (таск 09 сценариев).
    homeRelease(true);
    if (homeCard) homeCard.dispose();
    homeCard = null;
    if (stopHome) stopHome();
    stopHome = null;
    if (homeHere && simRunning()) simStop();
    homeHere = false;
    closed = true;
    volumeSurface = null;
    hosts.stage.replaceChildren();
    hosts.side.replaceChildren();
    keyStop(null);
    if (frame) {
      cancelFrame(frame);
      frame = 0;
    }
    if (hourTick && typeof clearInterval === "function") clearInterval(hourTick);
    hourTick = 0;
    if (stageWatch) stageWatch.disconnect();
    stopParams();
    paramsFields.dispose();
    paramsButton.dispose();
    if (locked && typeof document.exitPointerLock === "function") document.exitPointerLock();
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

  /**
   * Схему сменили **не лестницей**, а в списке схем (таск 153).
   *
   * Правило то же, что у перехода по лестнице: человек встаёт в том же месте
   * плана, а `volumeMoveTo` выталкивает его из стен. Память дороги при этом
   * ведётся так же, как при лестнице, — иначе возврат (G216) потерял бы этаж,
   * с которого ушли, и человек снова оказался бы в тупике, который этим
   * возвратом и чинят.
   */
  function followScheme(state) {
    const from = schemeId;
    leaveScheme();
    schemeId = state.schemeId;
    setScene(state);
    if (!scene.empty) {
      // Место дома, а не координаты чужого чертежа (таск 205): у схем свои нули.
      const want = sameSpotOn(state.project, from, schemeId, { x: person.x, y: person.y });
      const moved = volumeMoveTo(scene, want, volumeStanceHead(stance));
      person.x = moved.x;
      person.y = moved.y;
      aroundLookAt(person.x, person.y);
    }
    // Выделение осталось на прежней схеме, и карточка про него говорила бы о
    // том, чего в кадре нет.
    select(null);
    stairAsked = (stairHere() || {}).objectId || null;
    resize();
    sync();
  }

  // Чертёж могли поправить в другой вкладке того же объекта или отменой на
  // холсте — сцена пересобирается на каждое изменение объекта. Считать её
  // заново дешевле, чем следить за тем, что именно изменилось.
  const unsubscribe = subscribe
    ? subscribe((state, changed) => {
        if (closed) return;
        // Схему удалили под поверхностью или закрыли объект — поверхность
        // разбирается: следующий вход в режим соберёт её на той схеме, которая
        // открыта.
        if (!findScheme(state.project, state.schemeId)) {
          destroy();
          return;
        }
        // Схему сменили в списке схем — идём туда же. Переход по лестнице
        // досюда не доходит: он меняет `schemeId` сам и ставит его в состояние
        // заодно, так что к этому мигу обе схемы уже совпадают.
        // Список этажей в параметрах считается по объекту: по схемам и по той
        // из них, что открыта (таск 202). Сменились — ряды обязаны пересобраться,
        // иначе выбранным останется прежний этаж. Стоит это **до** перехода на
        // другую схему: тот возвращается сразу, а список устарел уже сейчас.
        if ("project" in changed || "schemeId" in changed) {
          paramsFields.refresh();
          paramsButton.refresh();
        }
        if (state.schemeId !== schemeId) {
          followScheme(state);
          return;
        }
        // Режим включили — поле снова на экране: перемерить его, встать туда,
        // где человек был на прежнем поле (G276), и забрать клавиатуру себе.
        if ("screen" in changed && state.screen === "volume") {
          resize();
          placeArrive(state);
          // Часы одни на всё приложение (таск 02 сценариев): вход в режим их
          // не перецепляет — переведённые в «Схеме», они и здесь те же.
          volumeParamsArrive(Date.now());
          refreshHour();
          syncClock();
          sync();
          // Вошли — дом запускается по отметке (история 2.2), свет и шторы,
          // которые жили без поля, сверяются.
          homeStale = true;
          homeEnsure();
          if (typeof stage.focus === "function") stage.focus({ preventScroll: true });
        }
        // Режим сменили на другой. Место схеме и чертежу объём здесь больше не
        // правит (D61): последний его кадр уже сказал, где стоит человек, а
        // встают по этому месту они сами — читая чужую запись. Прежняя правка
        // отсюда срабатывала и на чужих переключениях («Схема → Чертёж»), где
        // объёма не было ни до, ни после.
        if ("screen" in changed && state.screen !== "volume") {
          // Поле погасло — таймеру часа идти незачем.
          syncClock();
          // Человек ушёл из «Объёма» — датчики его больше не видят, а дом,
          // запущенный здесь, останавливается (таск 09 сценариев).
          homeRelease(true);
          homePresenceGone();
          homeEnsure();
        }
        // Выделили метку в списке или на плане — рамка и карточка поднимаются
        // здесь: выделение одно на оба вида. То же и с показом связей.
        if ("selectedMarkIds" in changed || "linksShown" in changed) syncSelection();
        // Окно браузера сузили или развернули — колонка пришла листом или
        // вернулась на место, и параметрам надо переехать (таск 231, G351).
        // Сцена от этого не меняется, поэтому отбор ниже нас не позовёт.
        if ("layout" in changed) syncParamsHome();
        // Вещи погасили или вернули (таск 154, G223) — сцену надо собрать
        // заново: спрятанной вещи в ней нет ни гранью, ни препятствием.
        const objectsChanged = "objectsShown" in changed || "hiddenObjectIds" in changed;
        // «Подсвечивать метки» переключили (G15) — контур изображения живёт в
        // гранях сцены, и без пересборки он остался бы как был.
        const imagesChanged = "marksHighlight" in changed;
        if (!("project" in changed) && !("filter" in changed) && !objectsChanged && !imagesChanged) return;
        setScene(state);
        // Координаты объекта и направление верха чертежа — свойства объекта
        // (таск 188), и правят их, не выходя из режима. Час пересчитывается
        // здесь же: при остановленном времени таймера нет вовсе, и без этого
        // новые координаты доехали бы до неба только со следующим ходом часов.
        refreshHour();
        sync();
        // Объект сменили или поправили: дом перестроен (`simSync`), а другой
        // объект останавливает прежний — «Объём» запускает свой по отметке.
        if ("project" in changed) homeEnsure();
      })
    : null;

  stage.addEventListener("pointerdown", onPointerDown);
  stage.addEventListener("wheel", onWheel, { passive: false });
  padNode.addEventListener("pointerdown", padStart);
  lookNode.addEventListener("pointerdown", lookStart);
  jumpButton.addEventListener("pointerdown", risePress);
  jumpButton.addEventListener("pointerup", riseRelease);
  jumpButton.addEventListener("pointercancel", riseRelease);
  jumpButton.addEventListener("lostpointercapture", riseRelease);
  crouchButton.addEventListener("pointerdown", crouchPress);
  crouchButton.addEventListener("pointerup", crouchRelease);
  crouchButton.addEventListener("pointercancel", crouchRelease);
  // Захват потеряли (палец уехал за край, браузер отдал указатель другому) —
  // это то же отпускание: иначе человек остался бы сидеть без кнопки.
  crouchButton.addEventListener("lostpointercapture", crouchRelease);
  actionButton.addEventListener("pointerdown", actionPress);
  actionButton.addEventListener("pointerup", actionRelease);
  actionButton.addEventListener("pointercancel", actionRelease);
  actionButton.addEventListener("lostpointercapture", actionRelease);
  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp);
  window.addEventListener("pointercancel", onPointerUp);
  window.addEventListener("resize", onResize);
  window.addEventListener("blur", onBlur);
  document.addEventListener("keydown", onKeyDown, true);
  document.addEventListener("keyup", onKeyUp, true);
  document.addEventListener("pointerlockchange", onLockChange);
  for (const name of FULLSCREEN_EVENTS) document.addEventListener(name, onFullscreenChange);

  // Первый вход в режим: человек встаёт туда, где была середина поля, с
  // которого пришли (G276). Обзор при этом по-прежнему открывается **всей
  // схемой** — это решение таска 146 («показать заказчику» начинается с общего
  // вида), и оно с переносом не спорит: место достаётся человеку, а не рамке
  // первого кадра. Переключил вид на первое лицо — стоит там, где показывал.
  //
  // **Кроме случая, когда взгляд помнят** (таск 227): человек вернулся туда,
  // откуда ушёл, и показывать ему вместо этого общий вид — значит забыть то,
  // что он просил запомнить. Кнопки «Обзор» и «Вся схема» при этом как были:
  // они возвращают взгляд к умолчанию по нажатию, и память им не перечит.
  //
  // **Встать надо до первого кадра.** Кадр говорит общей записи, где камера
  // (`placeHere`), и, нарисованный раньше, он успевал перебить поднятый из
  // памяти взгляд своим — тем, с которого поверхность начинается. Живой прогон
  // таска 227 поймал это на первом лице: вид возвращался обзором, потому что
  // читалась уже затёртая запись.
  const looked = placeArrive(getState());
  volumeParamsArrive(Date.now());
  refreshHour();
  syncClock();
  syncStanceWords();
  sync();
  resize();
  if (!scene.empty && !looked) fit();
  if (typeof stage.focus === "function") stage.focus({ preventScroll: true });

  // ——— дом (таск 09 сценариев) ———
  //
  // Зеркало дома слушается всю жизнь поверхности: запуск и остановка — сверка
  // «вошли / вышли», изменения — свет и шторы. Запускается дом, когда окно
  // параметров ответило (снятая отметка не запускает его даже на миг) и стало
  // известно, помнит ли себя этот дом: прежняя память открытых штор нужна
  // только дому, которого здесь ещё не было. Спрашивается это **до** запуска —
  // запущенный дом сам запишет себя в память.
  let homeRunning = simRunning();
  stopHome = simWatch((payload) => {
    if (closed) return;
    if (payload.running !== homeRunning) {
      homeRunning = payload.running;
      homeSync();
      return;
    }
    if (payload.changes.length > 0 || homeStale) homeRefresh();
  });
  const projectKey = simProjectKey(getState().project);
  Promise.all([
    volumeParamsReady(),
    Promise.resolve()
      .then(() => getSetting(SIM_STATE_SETTING))
      .then((all) => {
        homeKnown = Boolean(all && typeof all === "object" && projectKey && all[projectKey]);
      })
      .catch(() => {}),
  ]).then(() => {
    if (closed) return;
    homeReady = true;
    homeParams = { simulation: volumeParamsRead().simulation, hideCard: volumeParamsRead().hideCard };
    homeEnsure();
    syncCard();
  });
  return { destroy };
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

// ——— режим «Объём» основного экрана (таск 153) ————————————————————————
//
// Кнопки «3D» над планом больше нет: её дело делает переключатель режимов, и
// второго пути к объёму в сборке не осталось. Исчезло с ней и гашение «без
// чертежа»: режим доступен всегда — он показывает задник и плашку с причиной, —
// а гасла кнопка потому, что открывала окно.
//
// Поверхность одна на страницу и собирается **по первому входу в режим**: сцена
// на объекте заказчика считается восемь миллисекунд, и платить их тем, кто в
// объём не заходил, незачем. Собранная, она живёт дальше и в чужих режимах —
// гаснет, но помнит, где стоит человек, какие двери открыты и какой этаж.
let volumeSurface = null;
// Какой режим показан сейчас и какой был до него (G276): по второму объём
// решает, у кого спросить место — у схемы или у чертежа.
let volumeScreenNow = null;
let volumeScreenBefore = null;

/** Режим, из которого пришли в объём. `null` — страницу открыли в нём. */
export function volumeCameFrom() {
  return volumeScreenBefore;
}

function mountVolumeScreen(host, api) {
  const { getState, subscribe } = api;
  // Две точки монтирования на одну поверхность: поле в основном экране и
  // верхний блок левой колонки. Правой колонке режим ничего не даёт — там стоит
  // **тот же список меток, что и на схеме**, и выделение у них общее.
  const hosts = { stage: host, side: document.getElementById(PANEL_IDS.volumeTools) };

  const placeholder = () => {
    if (volumeSurface || !hosts.side) return;
    hosts.side.replaceChildren(uiEl("p", { class: "panel__empty", text: strings.screens.needScheme }));
  };

  const build = () => {
    const state = getState();
    if (!volumeSurface && state.screen === "volume" && state.schemeId && hosts.side) {
      volumeSurface = createVolume({ api, hosts });
    }
    placeholder();
  };

  subscribe((state, changed) => {
    // Откуда пришли (G276). Считается **здесь**, а не в самой поверхности:
    // поверхности может ещё не быть вовсе — в первый раз её собирает этот же
    // обработчик, и первый вход в объём обязан знать прежний режим так же
    // точно, как все следующие.
    if ("screen" in changed && state.screen !== volumeScreenNow) {
      volumeScreenBefore = volumeScreenNow;
      volumeScreenNow = state.screen;
    }
    if ("screen" in changed || "schemeId" in changed || "project" in changed) build();
  });
  volumeScreenNow = getState().screen;
  build();
}

registerPanel(PANEL_IDS.screenVolume, mountVolumeScreen);
