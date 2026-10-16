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
// Этажей, лестницы, сенсорного управления и снимка вида здесь нет (таск 149).
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
} from "../canvas.js";
import { findRoom, findScheme, schemeObjectsOnScheme, wallsOnScheme } from "../model.js";
import { drawDrawing, drawingUnitBridge, visibleMarks } from "../render.js";
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
  volumeFrame,
  volumeLinkLines,
  volumeMarkAnchor,
  volumeMarkPlace,
  volumeMarkerFaces,
  volumeMoveTo,
  volumePickAt,
  volumeRoomAt,
  volumeScene,
  volumeSelectLines,
  volumeStart,
  volumeStep,
} from "../volume.js";
import { markCardModel, markCardParts } from "./markCard.js";
import { uiButton, uiDialogDepth, uiEl, uiIcon, uiIconButton, uiModal } from "./ui.js";

// Окно одно: второе показывало бы ту же сцену второй камерой и сжирало бы
// кадры у первого. То же правило, что у мастерской.
let volumeOpened = false;

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
  const named = list
    .slice(0, VOLUME_UNPLACED_SHOWN)
    .map((item) => text("volume.unplacedItem", { label: item.label, reason: volumeUnplacedReason(item.reason) }));
  if (list.length > VOLUME_UNPLACED_SHOWN) {
    named.push(text("volume.unplacedMore", { count: list.length - VOLUME_UNPLACED_SHOWN }));
  }
  return text("volume.unplaced", { count: list.length, list: named.join(", ") });
}

/** Все неразмещённые по обозначениям — в подсказку строки, когда их много. */
export function volumeUnplacedTitle(unplaced) {
  const list = unplaced || [];
  if (list.length <= VOLUME_UNPLACED_SHOWN) return "";
  return list
    .map((item) => text("volume.unplacedItem", { label: item.label, reason: volumeUnplacedReason(item.reason) }))
    .join(", ");
}

/**
 * Строка про двери (G207, G210): сколько открыто и что с ними делают клавиши.
 *
 * Чистая и вынесена наружу по той же причине, что `volumeUnplacedLine`: строку,
 * собранную в обработчике кадра, не проверяет ничто. Дверей в схеме нет вовсе —
 * и строки нет: клавиша, которой нечего открывать, в подсказке лишняя.
 */
export function volumeDoorLine(doors, open, aimed) {
  const list = doors || [];
  if (list.length === 0) return "";
  const count = list.filter((id) => open.has(id)).length;
  const state = text("volume.doors", { open: count, count: list.length });
  return aimed ? state + " " + strings.volume.doorAimed : state + " " + strings.volume.doorKeys;
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

export function openVolume({ schemeId, api }) {
  if (volumeOpened) return null;
  const { getState, setState, notify, subscribe } = api;
  const project = getState().project;
  if (!findScheme(project, schemeId)) return null;
  volumeOpened = true;

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
  const stage = uiEl("div", { class: "volume__stage", attrs: { tabindex: "-1" } }, [node, card]);
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
  const fullButton = uiIconButton("fullscreen", {
    label: canvasFullscreenLabel(false),
    on: { click: () => toggleFullscreen() },
  });
  const where = uiEl("span", { class: "volume__where" });
  const meta = uiEl("p", { class: "volume__meta" });
  const missing = uiEl("p", { class: "volume__missing" });
  const hint = uiEl("p", { class: "modal__hint" });

  const bar = uiEl("div", { class: "volume__tools" }, [
    uiEl("span", { class: "volume__toolsLabel", text: strings.volume.view }),
    personButton,
    aroundButton,
    where,
    uiEl("span", { class: "volume__spacer" }, [fitButton, fullButton]),
  ]);
  const body = uiEl("div", { class: "volume" }, [bar, stage, meta, missing, hint]);

  const scheme = findScheme(project, schemeId);
  const closeButton = uiButton(strings.volume.close, {
    class: "ui-btn ui-btn--accent",
    on: { click: () => finish() },
  });
  const modal = uiModal({
    title: text("volume.title", { name: scheme.name }),
    body,
    actions: [closeButton],
    onCancel: () => cleanup(),
  });
  modal.card.classList.add("modal--volume");
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

  /** Куда смотрит рука: прицел под захватом, курсор без него. */
  function aimPoint() {
    const box = viewport();
    if (locked) return { x: box.width / 2, y: box.height / 2 };
    return pointer;
  }

  /** Дверь под рукой — по последнему нарисованному кадру. */
  function syncAim() {
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

  function walkSchedule() {
    if (walking || keys.size === 0 || closed) return;
    const schedule = typeof requestAnimationFrame === "function" ? requestAnimationFrame : (fn) => setTimeout(fn, 16);
    clock = now();
    walking = schedule(walkTick);
  }

  function walkTick() {
    walking = 0;
    if (keys.size === 0 || closed) return;
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
    const speed = (run ? VOLUME_RUN_MM_S : VOLUME_WALK_MM_S) * step;
    if (turn !== 0) {
      const spin = turn * step * 2.2;
      if (view === "person") person.yaw += spin;
      else around = { ...around, yaw: around.yaw + spin };
    }
    if (forward !== 0 || side !== 0) {
      const length = Math.hypot(forward, side);
      const basis = volumeBasis(view === "person" ? person : around);
      // Ход по плану, а не по направлению взгляда: с опущенным взглядом иначе
      // уходишь в пол, и это чувствуется как провал, а не как шаг.
      const flat = Math.hypot(basis.fwd.x, basis.fwd.y) || 1;
      const dx = ((basis.fwd.x / flat) * forward + basis.right.x * side) / length * speed;
      const dy = ((basis.fwd.y / flat) * forward + basis.right.y * side) / length * speed;
      if (view === "person") {
        const moved = volumeStep(scene, person, dx, dy);
        person.x = moved.x;
        person.y = moved.y;
        syncWhere();
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
    if (keys.size > 0 || !walking) return;
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
    stage.focus({ preventScroll: true });
    look = { x: event.clientX, y: event.clientY, moved: false };
  }

  function onPointerMove(event) {
    if (locked) {
      lookBy(event.movementX || 0, event.movementY || 0);
      return;
    }
    const rect = node.getBoundingClientRect ? node.getBoundingClientRect() : { left: 0, top: 0 };
    pointer = { x: event.clientX - rect.left, y: event.clientY - rect.top };
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
    grabPointer();
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

  // ——— клавиатура ———

  function onKeyDown(event) {
    if (!ours()) return;
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
    // Дверь под рукой или та, по которой щёлкнули (G207).
    if (event.code === VOLUME_DOOR_KEY) {
      event.preventDefault();
      if (!toggleDoor(aimedDoor || heldDoor)) notify(strings.volume.doorAimless, "info");
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

  function syncHint() {
    if (scene.empty) {
      hint.textContent = strings.volume.emptyHint;
      return;
    }
    const base = view === "person" ? strings.volume.hintPerson : strings.volume.hintAround;
    const grab = locked ? strings.volume.hintLocked : strings.volume.hintGrab;
    hint.textContent = base + " " + grab + " " + strings.volume.pickHint + " " + volumeDoorLine(scene.doors, openDoors, aimedDoor || heldDoor);
  }

  function sync() {
    personButton.className = "ui-btn" + (view === "person" ? " is-on" : "");
    aroundButton.className = "ui-btn" + (view === "around" ? " is-on" : "");
    stage.classList.toggle("volume__stage--person", view === "person");
    if (scene.empty) {
      meta.textContent = strings.volume.empty;
      missing.textContent = "";
      missing.hidden = true;
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
    }
    syncWhere();
    syncHint();
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
  return { close: finish };
}

/** Доступен ли объёмный режим в этой раскладке. */
export function volumeAllowed(state) {
  return layoutAllows("viewVolume", state && state.layout);
}

/** Есть ли в схеме чертёж: без стен и объектов объёму показывать нечего. */
export function volumeHasDrawing(project, schemeId) {
  if (!project || !schemeId) return false;
  return wallsOnScheme(project, schemeId).length > 0 || schemeObjectsOnScheme(project, schemeId).length > 0;
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
