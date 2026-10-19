// Мастерская чертежа: окно, в котором у схемы появляются **стены**.
//
// Третий этап требования G174 (разбор — таск 122, модель — таск 123, ADR 008).
// Слова заказчика: «В окне со схемой дома (где обрезка) её реализуем. Само окно
// делаем побольше, что бы удобнее было, реализуем слои, подложка — картинка,
// которую загрузили (но можно создавать схему без подложки), сетка сверху для
// помощи отрисовки и, текущими уже имеющимися инструментами сверху по слоям
// рисуем все стены с указанием толщины и общая высота помещения задаётся».
//
// **Это не то окно, где правится подложка.** Прежнее окно (`openPlanEditor`)
// после G175 живёт только там, где картинка **приходит**: оно работает с
// `blob`, которого в объекте ещё нет, и закрывается «Готово», отдавая файл
// вызывающему. Мастерская, наоборот, правит уже сохранённую схему и пишет в
// объект через `canvasCommit` на каждом действии — кнопки «Готово» у неё нет и
// быть не может. Поэтому это отдельное окно, а не то же самое, увеличенное.
//
// ——— две системы координат ———
//
// Чертёж живёт в **целых миллиметрах** (ADR 008), разметка — в долях плана
// (ADR 002). В этом окне всё, что видно, пересчитывается из миллиметров, и
// переход между системами устроен так, что второй геометрии не заводится:
//
//   `WORKSHOP_UNIT` — «схема», у которой пиксель плана равен миллиметру. С ней
//   `render.planToScreen`, `render.screenToPlan` и — главное — `render.draftSnap`
//   работают по миллиметрам без единой своей строки арифметики. Магнит углов
//   кратно 15° и направляющие по вершинам цепочки у мастерской поэтому **те
//   самые**, что на холсте, а не вторые такие же.
//
// Подложка же рисуется одним преобразованием холста (`workshopPlanPointScreen`
// — его чистая половина), и согласие этого преобразования с моделью проверяется
// тестом против `planFractionToMm`: угадывать мост между системами нельзя.
//
// ——— начало координат: три случая, и ни один не молчит ———
//
//   1. **Подложка есть и откалибрована.** Привязка (`scheme.origin`) ставится в
//      **середину подложки** и едет тем же шагом истории, что первая стена.
//      Почему середина: это единственная точка, которая существует **до** того,
//      как человек куда-то показал, — значит ни одна координата не зависит от
//      того, с какого угла он начал обводить. Заодно числа остаются малыми в обе
//      стороны (±6 м у плана на 12 м, а не 0…12000), а модель отрицательные
//      координаты допускает нарочно.
//   2. **Подложка есть, калибровки нет.** Подложку под **чертёж** не положить —
//      и это не решение, а арифметика: без пикселей на метр `planMmToFraction`
//      отвечает `null`, миллиметру не от чего считаться. Обводить картинку, под
//      которой нет метров, поэтому нечем: не на что опереть ни одну стену.
//      Рисовать по сетке, от размеров, при этом никто не мешает.
//
//      Раньше здесь стояло и второе, более сильное: «на глаз нарисовать и
//      потом откалибровать нельзя, потому что миллиметры нарисованных стен за
//      калибровкой не идут». **С таска 134 идут** — по выбору человека
//      (`canvasCommitScale` спрашивает, `model.scaleDrawing` пересчитывает).
//      Ошибся с масштабом — откалибровал заново, ответил «пересчитать», и
//      чертёж снова лёг на план. Отказ от пересчёта оставляет чертёж как был:
//      нарисованный по сетке от размеров верен сам по себе.
//
//      **Задать масштаб — дело плана, а не чертежа** (G227, таск 153). Своего
//      занятия «Масштаб» у чертежа больше нет: заказчик убрал его как дубль —
//      «Масштаб убери, он в Схемах есть». Слой подложки в чертеже при этом
//      по-прежнему гаснет, но рядом с ним стоит кнопка, которая показывает
//      план и начинает на нём калибровку (`canvasStartScale`) — ту же самую,
//      что и строка схемы. Задали масштаб — вернулись в чертёж, и подложка в
//      поле зажглась.
//   3. **Подложки нет вовсе.** Привязки не бывает — привязывать не к чему, поле
//      не появляется. Чертёж сам себе план: размер берётся из `drawingBoundsMm`,
//      а у пустой схемы окно показывает лист `WORKSHOP_EMPTY_MM` вокруг нуля —
//      иначе первую вершину пришлось бы ставить в бесконечность.
//
// ——— G68 ———
//
// Окно ничего не пишет, пока человек не нарисовал: открыть и закрыть мастерскую
// у объекта без чертежа — ноль правок, ноль шагов истории, ноль новых полей в
// `project.json`. Пустые списки в объект не попадают: их не кладёт ни одна
// функция модели чертежа.
import {
  ELEVATION_VIEWS_SETTING,
  OBJECTS_SETTING,
  PANEL_IDS,
  registerPanel,
  SCREEN_DEFAULT,
  screenMode,
  setObjectHidden,
  setScreen,
} from "../app.js";
import { setSetting } from "../store.js";
import { strings, text } from "../strings.js";
import {
  DRAWING_MM_MAX,
  OPENING_HINGES,
  OPENING_KINDS,
  OPENING_KIND_DOOR,
  OPENING_SWINGS,
  PLAN_SCALE_SHORT_SHARE,
  WALL_THICKNESS_MM_MAX,
  addOpening,
  addSchemeObject,
  addWall,
  deleteOpening,
  deleteSchemeObject,
  deleteWall,
  drawingBoundsMm,
  drawingMmValue,
  findOpening,
  findRoom,
  findScheme,
  findSchemeObject,
  findWall,
  formatMeters,
  openingsInWall,
  planFractionToMm,
  planOriginOf,
  planPixelsPerMeter,
  planSizeMeters,
  roomsInOrder,
  schemeObjectCorners,
  schemeObjectKeyOf,
  schemeObjectMountOf,
  schemeObjectNameOf,
  schemeObjectTopMm,
  schemeObjectsOnScheme,
  segmentDistanceMm,
  setPlanOrigin,
  setPlanScale,
  setRoomWallHeight,
  setSchemeWallHeight,
  updateOpening,
  updateScheme,
  updateSchemeObject,
  updateWall,
  wallLengthMm,
  wallName,
  wallVectors,
  wallsOnScheme,
} from "../model.js";
import {
  CANVAS_FRESH_VERTEX_MS,
  canvasDragSlop,
  canvasPanSpeed,
  canvasPanVector,
  canvasRedoStep,
  canvasStartScale,
  canvasUndoStep,
  canvasCommit,
} from "../canvas.js";
import {
  GESTURE_CLOSE_MIN,
  gestureDraftClick,
  gestureDraftEnd,
  gesturePinchOf,
  gesturePinchStep,
  gestureWheel,
} from "../gestures.js";
import {
  DRAWING_ACTIVE,
  DRAWING_EDGE,
  DRAWING_OBJECT,
  DRAWING_PAPER,
  LABEL_TURN_RADIUS,
  drawDrawing,
  drawDrawingObject,
  drawDrawingOpening,
  drawLabelTurn,
  drawingDoorLeaf,
  drawingHitObject,
  drawingOpeningSpan,
  drawingUnitBridge,
  draftSnap,
  drawFont,
  drawPathHandles,
  hitPathHandle,
  pathEditHandles,
  pathVertexHandles,
  planToScreen,
  screenToPlan,
} from "../render.js";
import { uiButton, uiConfirm, uiDialogDepth, uiEl, uiIcon, uiIconButton } from "./ui.js";
import {
  objectCatalogDefaults,
  objectCatalogEntry,
  objectCatalogKeyByName,
  objectCatalogName,
} from "../objectCatalog.js";
import { objectTileIcon, openObjectPicker } from "./objectPicker.js";
import { createElevationStrip, elevationPlace } from "./elevation.js";
import { createFieldPlate } from "./plate.js";

// «Схема», у которой один пиксель плана — один миллиметр чертежа. Через неё
// мастерская зовёт готовую геометрию `render.js`: `zoom` становится «пикселей
// экрана на миллиметр», и пороги притяжки, заданные в пикселях экрана, остаются
// теми же, что на холсте.
export const WORKSHOP_UNIT = { width: 1, height: 1 };

// Привязка чертежа к подложке ставится в середину плана — см. случай 1 выше.
export const WORKSHOP_ORIGIN_AT = { x: 0.5, y: 0.5 };

// Шаги сетки: от полста миллиметров (толщина перегородки) до двух метров.
// Половина метра по умолчанию — ею размечают квартиру, и в ней видны и
// трёхметровая комната, и ниша.
export const WORKSHOP_GRID_STEPS_MM = [50, 100, 200, 250, 500, 1000, 2000];
export const WORKSHOP_GRID_DEFAULT_MM = 500;

// Реже пяти пикселей на экране сетка читается заливкой — рисуется кратный шаг,
// а притягивается по-прежнему выбранный.
const WORKSHOP_GRID_MIN_PX = 5;
const WORKSHOP_GRID_MULTIPLES = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000];

// Толщина новых стен. Сто миллиметров — перегородка, самая частая стена в
// квартире; несущую человек задаёт сам.
export const WORKSHOP_THICKNESS_DEFAULT_MM = 100;

// Лист пустой схемы: двенадцать метров по широкой стороне. Столько у квартиры
// по фасаду, и первая вершина попадает на лист, а не в бесконечность.
export const WORKSHOP_EMPTY_MM = { widthMm: 12000, heightMm: 9000 };

// Масштаб окна — пиксели экрана на миллиметр. Снизу: километровый план в окне
// на 700 точек. Сверху: миллиметр в полтора сантиметра экрана — дальше
// увеличивать нечего, координаты и так целые.
export const WORKSHOP_ZOOM_MIN = 0.0007;
export const WORKSHOP_ZOOM_MAX = 1.5;
const WORKSHOP_ZOOM_KEY_STEP = 1.25;

// ——— чего в чертеже больше нет (G227, таск 153) ————————————————————————
//
// Заказчик, посмотрев режим живьём: «Кнопки + − и вписать дублируются, есть в
// нижнем блоке с интерфейсом… Так же кнопка Развёртка… дублируется в блоке
// интерфейса. И Масштаб убери, он в Схемах есть».
//
// Поэтому из чертежа ушли три вещи, и ни одна из них не пропала:
//
//   **масштаб окна** («−», «+», «Вписать») — он в «Интерфейсе проекта», в той
//     же левой колонке ниже, и теперь работает на то поле, которое на экране;
//   **развёртка** — полоса выезжает по выделенной стене, как на плане, а
//     показывать её или нет, решает галка «Развёртка выделенной стены» там же,
//     в «Интерфейсе проекта»;
//   **калибровка масштаба плана** — она в строке схемы, в разделе «Схемы»
//     («Масштаб: план …»), и кнопка в слоях чертежа ведёт ровно туда же.
//
// Занятия внутри остались два: выделение и добавление.

/**
 * **Два уровня вместо ряда занятий** (таск 133, G184). Слова заказчика:
 * «рисую стены, а как мне выбрать текущую, поправить её или удалить. Нужен
 * выбор режима — выбор или добавление как для меток».
 *
 * Ряд из пяти кнопок отвечал сразу на два вопроса — «чем я занят» и «что
 * рисую», — и первый в нём терялся: «Правку» заказчик просто не нашёл среди
 * «Стен», «Проёмов» и «Объектов». Теперь вопроса два и уровня два:
 *
 *   режим — выделение, добавление, масштаб, развёртка;
 *   что добавляем — стены, проёмы, объекты (только в добавлении).
 *
 * Внутри окна всё по-прежнему решает **одно** поле `tool`: мода и «что
 * добавляем» — это его два взгляда, а не второе состояние рядом. Заведи их
 * врозь — и нашлась бы пара «режим добавления, а добавляем ничего».
 */
export const WORKSHOP_MODES = ["select", "add"];
export const WORKSHOP_ADDING = ["walls", "openings", "objects"];

/** Каким режимом читается занятие. Обратное — `workshopToolOf`. */
export function workshopModeOf(tool) {
  if (tool === "edit") return "select";
  return "add";
}

/**
 * Каким занятием оборачивается выбор режима. `adding` — что добавляли в
 * прошлый раз: вернулись в добавление — вернулись к тому же, чем рисовали,
 * а не к стенам через раз.
 */
export function workshopToolOf(mode, adding) {
  if (mode === "add") return WORKSHOP_ADDING.includes(adding) ? adding : "walls";
  return "edit";
}

// Пороги попадания в пикселях экрана, как у холста: иначе на разном масштабе
// всё ведёт себя по-разному. Вершина ловится шире тела стены — ею правят.
export const WORKSHOP_VERTEX_PX = 9;
export const WORKSHOP_WALL_PX = 6;

/**
 * Поехала ли рука: мерка **холстовая**, и у пальца она своя (`canvasDragSlop`).
 *
 * Своего числа у чертежа больше нет. Стояло одно на мышь и палец разом — три
 * точки, — а комментарий над ним говорил именно про палец. На планшете,
 * рабочем месте заказчика, тап по стене уезжает на четыре точки: по мышиной
 * мерке он оказывался перетаскиванием, стена ехала, и в историю падал шаг
 * «перенос стены». При масштабе 0,1 пикселя на миллиметр это сорок
 * миллиметров. У холста мерки разведены давно, и причина там названа: «тап по
 * метке на планшете уезжает на несколько точек, и по мышиной мерке в три
 * точки он почти всегда оказывался бы панорамой».
 *
 * `gesture` — начало жеста: `{x, y}` и `touch` у пальца; `at` — где рука
 * сейчас. Сравнение то же, что на холсте: сдвиг **больше** мерки — поехал.
 */
export function workshopHandMoved(gesture, at) {
  if (!gesture || !at) return false;
  const shift = Math.hypot(Number(at.x) - Number(gesture.x), Number(at.y) - Number(gesture.y));
  return shift > canvasDragSlop(gesture);
}

// Насколько подпись длины отступает от линии: ближе — садится на саму линию,
// дальше — отрывается от неё и читается как чужая.
const WORKSHOP_LENGTH_GAP_PX = 13;

// Сдвиг вида стрелками (дефект D23, «навигация должна быть как и у схемы»).
// Направление и кривую разгона даёт сам холст — `canvasPanVector` и
// `canvasPanSpeed` вывезены оттуда наружу, и второй такой арифметики здесь
// нет. Повторить пришлось только ход кадров: холстовый прибит к его
// синглтон-виду (`canvasPanBy` пишет в `getState().view`), а у окна вид свой.
// Шаг короткого нажатия взят тот же, что у холста, — наружу он не отдан.
const WORKSHOP_PAN_STEP_PX = 24;
// Потолок шага кадра: вкладку свернули на минуту — план не должен улететь.
const WORKSHOP_PAN_FRAME_MS = 64;

// ——— чистая половина: что показать и что записать ——————————————————————

function workshopClampMm(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.min(DRAWING_MM_MAX, Math.max(-DRAWING_MM_MAX, number));
}

/**
 * Точка чертежа в целых миллиметрах. Зажимается до потолка модели **перед**
 * округлением: клик далеко за краем листа иначе отказывал бы ошибкой модели
 * вместо того, чтобы встать на край.
 */
export function workshopRoundMm(point) {
  return { x: drawingMmValue(workshopClampMm(point && point.x)), y: drawingMmValue(workshopClampMm(point && point.y)) };
}

/**
 * Можно ли положить подложку под чертёж — и чем именно.
 *
 * Четыре ответа, и все четыре надо сказать вслух (см. голову файла):
 * Четыре ответа: `noScheme`, `noImage`, `noScale`, `ready`. У `ready` поле
 * `pending` означает «место известно, но в объекте ещё не записано».
 * У `ready` в ответе лежит всё, что нужно одному преобразованию холста:
 * `mmPerPx` — миллиметров чертежа в пикселе плана, `at` — доля плана, в которую
 * попадает нуль чертежа, `turn` — поворот осей чертежа относительно осей плана.
 */
export function workshopPlacement(project, schemeId) {
  const scheme = findScheme(project, schemeId);
  if (!scheme) return { kind: "noScheme" };
  if (!scheme.imageId) return { kind: "noImage" };
  const perMeter = planPixelsPerMeter(project, schemeId);
  if (!(perMeter > 0) || !(Number(scheme.width) > 0) || !(Number(scheme.height) > 0)) return { kind: "noScale" };
  // Привязки может ещё не быть: она записывается первой стеной, чтобы объект
  // не менялся от одного открытия окна. Но **показать** подложку это не мешает:
  // место известно заранее — та же середина плана, которую запишет первая
  // стена, с теми же осями. Раньше здесь был отказ `noOrigin`, и выходил
  // замкнутый круг: картинку не покажем, пока не обведёшь стену по картинке.
  // Поэтому отказа нет, а `pending` говорит вызывающему, что в объекте
  // привязки пока не записано.
  const origin = planOriginOf(project, schemeId);
  return {
    kind: "ready",
    pending: !origin,
    at: origin ? origin.at : WORKSHOP_ORIGIN_AT,
    turn: origin ? origin.turn : 0,
    mmPerPx: 1000 / perMeter,
    width: Number(scheme.width),
    height: Number(scheme.height),
  };
}

// Поворот вектора на четверть оборота по часовой в экранных осях — тот же, что
// `turnVector` модели и что `ctx.rotate` при положительном угле. Повторён здесь
// потому, что модель его наружу не отдаёт; согласие с моделью не объявляется, а
// проверяется тестом (`workshopPlanPointScreen` против `planFractionToMm`).
function workshopTurn(point, turn) {
  if (turn === 90) return { x: -point.y, y: point.x };
  if (turn === 180) return { x: -point.x, y: -point.y };
  if (turn === 270) return { x: point.y, y: -point.x };
  return { x: point.x, y: point.y };
}

/**
 * Где на экране окажется точка подложки, заданная **долей** плана.
 *
 * Это чистая половина того преобразования, которым окно рисует картинку:
 * `translate` в нуль чертежа, `rotate(-turn)`, `scale(zoom · mmPerPx)`. Вынесена
 * наружу ради теста — он сверяет её с мостом модели (`planFractionToMm` плюс
 * `planToScreen`) на всех четырёх поворотах. Разойдись они — чертёж лёг бы
 * поперёк плана, и увидеть это можно было бы только глазами.
 */
export function workshopPlanPointScreen(point, placement, view) {
  const zero = planToScreen({ x: 0, y: 0 }, WORKSHOP_UNIT, view);
  const local = {
    x: (Number(point.x) - placement.at.x) * placement.width,
    y: (Number(point.y) - placement.at.y) * placement.height,
  };
  const turned = workshopTurn(local, (360 - placement.turn) % 360);
  const k = Number(view.zoom) * placement.mmPerPx;
  return { x: zero.x + turned.x * k, y: zero.y + turned.y * k };
}

/**
 * Куда сядет следующая вершина — **одна дверь** для предпросмотра и для клика,
 * как `canvasDraftPoint` на холсте.
 *
 * Порядок разрешения споров назван здесь целиком:
 *
 *   `free` (зажатый Alt) — никакой притяжки, миллиметр под курсором;
 *   сетка включена — узел сетки и больше ничего: точка на узле уже точная, и
 *     двигать её магнитом угла значило бы снять её с узла, который человек
 *     перед собой видит;
 *   сетка выключена — прежние магниты холста целиком (`render.draftSnap`):
 *     направляющие по вершинам этой же цепочки и угол кратно 15°.
 *
 * Выключатель сетки нужен ровно за тем, за чем просил заказчик рисовать по
 * чужому плану: там стены стоят не по круглым числам, и узел увёл бы вершину
 * с линии, которую обводят.
 */
export function workshopSnapMm(pointsMm, cursorMm, view, options = {}) {
  const points = Array.isArray(pointsMm) ? pointsMm : [];
  if (options.free) {
    const shown = draftSnap(points, cursorMm, WORKSHOP_UNIT, view, { free: true });
    return { point: workshopRoundMm(cursorMm), angle: shown.angle, snapped: false, guides: [], grid: false };
  }
  const gridMm = Number(options.gridMm) || 0;
  if (options.gridSnap && gridMm > 0) {
    const node = { x: Math.round(cursorMm.x / gridMm) * gridMm, y: Math.round(cursorMm.y / gridMm) * gridMm };
    const shown = draftSnap(points, node, WORKSHOP_UNIT, view, { free: true });
    return { point: workshopRoundMm(node), angle: shown.angle, snapped: false, guides: [], grid: true };
  }
  const snap = draftSnap(points, cursorMm, WORKSHOP_UNIT, view, {});
  return {
    point: workshopRoundMm(snap.point),
    angle: snap.angle,
    snapped: snap.snapped,
    guides: snap.guides,
    grid: false,
  };
}

/**
 * Росчерк без холостых кликов: подряд идущие совпадающие вершины выбрасываются
 * — два клика в одну точку это один клик, а не стена нулевой длины. Одна дверь
 * у цепочки стен, полосы объекта и контура: примета у них общая.
 */
function workshopDistinct(pointsMm) {
  const points = [];
  for (const point of Array.isArray(pointsMm) ? pointsMm : []) {
    const last = points[points.length - 1];
    if (last && last.x === point.x && last.y === point.y) continue;
    points.push({ x: point.x, y: point.y });
  }
  return points;
}

/**
 * Росчерк — в отрезки. **Концы соседних стен — один и тот же объект точки**, и
 * равенство в данных поэтому не «почти», а буква в букву: модель переписывает
 * обе копии одним `drawingPointMm`, целые миллиметры совпадают равенством, и
 * цепочка стен становится графом, из которого вырастет развёртка (G177).
 *
 * Подряд идущие совпадающие вершины выбрасываются: два клика в одну точку —
 * это один клик, а не стена нулевой длины.
 */
export function workshopChain(pointsMm) {
  const points = workshopDistinct(pointsMm);
  const walls = [];
  for (let index = 1; index < points.length; index += 1) {
    walls.push({ aMm: points[index - 1], bMm: points[index] });
  }
  return walls;
}

/** Привязка чертежа к подложке: середина плана, оси по осям плана. */
export function workshopAttachOrigin(project, schemeId) {
  return setPlanOrigin(project, schemeId, { at: WORKSHOP_ORIGIN_AT, turn: 0 });
}

/**
 * Чем чертёж занят при открытии.
 *
 * Правило одно: **режим открывается тем, что в нём есть что делать.** Про
 * масштаб плана он больше не думает — тот задаётся в «Схемах» (G227), а
 * чертить по сетке можно и без подложки.
 *
 * Чертёж уже есть — **выделением**, а не стенами. Прежде окно открывалось
 * прямо в рисовании, и ровно на это заказчик и пожаловался: «рисую стены, а
 * как мне выбрать текущую» — обратной дороги он не видел среди четырёх
 * одинаковых кнопок. Холст открывается в выделении по той же причине: сперва
 * смотрят, потом правят, и первый клик по ошибке ничего не создаёт.
 *
 * Чертежа ещё нет — **добавлением**: выделять нечего, и окно, встречающее
 * пустое поле словами «клик выделяет», читалось бы сломанным. Это не
 * исключение из правила, а оно само: нет чертежа — нет и выделения.
 *
 * Дорога в обе стороны при этом не спрятана: оба режима стоят соседними
 * кнопками одного ряда, и в добавлении помнится, чем рисовали в прошлый раз.
 */
export function workshopInitialTool(project, schemeId) {
  return drawingBoundsMm(project, schemeId) ? "edit" : "walls";
}

// ——— лист схемы без подложки ——————————————————————————————————————————
//
// **Схема без картинки всё равно нуждается в плане** — не в картинке, а в
// системе координат. Метки живут долями плана (ADR 002), и доля отсчитывается
// от `scheme.width`/`height`; у схемы без подложки они нули, и доле не от чего
// считаться. Пока чертёж не выходил из мастерской, это никому не мешало; на
// холсте (таск 127) без этого не работает ничего — ни метки, ни линейка, ни
// выгрузка.
//
// Поэтому у такой схемы заводится **лист**: размер в «пикселях плана»,
// калибровка и привязка, выданные самой сборкой. Картинки за ними нет, но вся
// прежняя арифметика — `planMmToFraction`, `fitView`, линейка, выгрузка —
// работает с ним как с обычным откалиброванным планом, и ни одной развилки
// «а если подложки нет» заводить не приходится.
//
// **Лист фиксированный, а не по размеру чертежа** — и это главное в решении.
// Считай его от `drawingBoundsMm`, и каждая новая стена меняла бы смысл доли:
// все уже поставленные метки поехали бы относительно стен. Поэтому лист
// постоянный: сорок на тридцать метров, по сантиметру на пиксель плана, нуль
// чертежа в середине. Сорок метров кроет любую квартиру и почти любой дом;
// что не влезло — видно, но метку туда не поставить (доля зажимается в 0…1), и
// это честная граница, а не молчание.
//
// Пиксель в сантиметр выбран не случайно: размер метки и смещение подписи
// заданы в пикселях плана, и у фотографии плана квартиры их примерно тысяча на
// десять метров. Возьми пиксель в миллиметр — метки стали бы в десять раз
// мельче подписей, и раскладка подписей поехала бы на всех схемах разом.
export const WORKSHOP_SHEET = { width: 4000, height: 3000, mmPerPx: 10 };

/**
 * Завести лист у схемы без подложки, если его ещё нет. Возвращает тот же
 * объект по ссылке, когда заводить нечего: ни лишнего шага истории, ни
 * `updatedAt` на пустом месте (G68).
 */
export function workshopEnsureSheet(project, schemeId) {
  const scheme = findScheme(project, schemeId);
  if (!scheme || scheme.imageId) return { project, added: false };
  if (Number(scheme.width) > 0 && Number(scheme.height) > 0 && planOriginOf(project, schemeId)) {
    return { project, added: false };
  }
  let next = updateScheme(project, schemeId, {
    width: WORKSHOP_SHEET.width,
    height: WORKSHOP_SHEET.height,
  }).project;
  // Калибровка: четверть ширины листа объявлена десятью метрами. При ширине
  // 4000 это 1000 пикселей на 10 м, то есть сто пикселей на метр и сантиметр
  // на пиксель — ровно то, что обещано выше.
  next = setPlanScale(next, schemeId, {
    a: { x: 0.25, y: 0.5 },
    b: { x: 0.5, y: 0.5 },
    meters: (WORKSHOP_SHEET.width / 4) * (WORKSHOP_SHEET.mmPerPx / 1000),
  }).project;
  next = setPlanOrigin(next, schemeId, { at: WORKSHOP_ORIGIN_AT, turn: 0 }).project;
  return { project: next, added: true };
}

/**
 * Записать росчерк: цепочка стен одним шагом истории.
 *
 * Привязка ставится **тем же шагом** и ровно в одном случае — когда привязывать
 * есть к чему (подложка с калибровкой) и ещё не привязано. Решает это сама
 * функция, а не вызывающий: отдельного действия «появилось начало координат»
 * человек не делал, отменять его отдельно ему незачем, а флаг снаружи — это
 * второе место, где правило можно было бы нарушить.
 *
 * У схемы **без** подложки привязки не появляется вовсе: поля `origin` у неё
 * быть не должно — привязывать не к чему (ADR 008).
 */
export function workshopAddChain(project, schemeId, pointsMm, thicknessMm) {
  const segments = workshopChain(pointsMm);
  if (segments.length === 0) return { project, added: 0, origin: false };
  // Лист схемы без подложки заводится тем же шагом, что первая стена: без него
  // чертёж не выйдет на холст, а заводить его отдельной кнопкой человеку
  // незачем — он про него не думает.
  let next = workshopEnsureSheet(project, schemeId).project;
  let origin = false;
  if (workshopPlacement(next, schemeId).pending) {
    next = workshopAttachOrigin(next, schemeId).project;
    origin = true;
  }
  for (const segment of segments) {
    next = addWall(next, { schemeId, aMm: segment.aMm, bMm: segment.bMm, thicknessMm }).project;
  }
  return { project: next, added: segments.length, origin };
}

/**
 * Какие концы стен стоят **ровно** в этой точке. Сравнение равенством, без
 * допуска: в целых миллиметрах оно точное, и ровно на нём держится соседство
 * стен (ADR 008).
 */
export function workshopVertexEnds(walls, pointMm) {
  const ends = [];
  for (const wall of Array.isArray(walls) ? walls : []) {
    if (wall.aMm.x === pointMm.x && wall.aMm.y === pointMm.y) ends.push({ wallId: wall.id, end: "a" });
    if (wall.bMm.x === pointMm.x && wall.bMm.y === pointMm.y) ends.push({ wallId: wall.id, end: "b" });
  }
  return ends;
}

/**
 * Перенос вершины цепочки: **все** концы, стоявшие в этой точке, встают в
 * новую. Иначе перетаскивание угла рвало бы цепочку молча — а на её целости
 * держится будущая развёртка.
 */
export function workshopMoveVertex(project, schemeId, fromMm, toMm) {
  const ends = workshopVertexEnds(wallsOnScheme(project, schemeId), fromMm);
  if (ends.length === 0) return { project, moved: 0 };
  let next = project;
  for (const end of ends) {
    next = updateWall(next, end.wallId, end.end === "a" ? { aMm: toMm } : { bMm: toMm }).project;
  }
  return { project: next, moved: ends.length };
}

/**
 * Перенос стены целиком: оба конца на один и тот же целый сдвиг.
 *
 * Соседей он за собой **не тянет** — и это не недогляд. Стену в чертеже
 * переставляют именно затем, чтобы она ушла от прежнего места; тащить за ней
 * половину квартиры было бы догадкой. Цепочку при этом разорвать можно, и
 * никакая проверка об этом не скажет (ADR 008, раздел «Последствия») — поэтому
 * угол правят вершиной, а не телом стены.
 */
export function workshopMoveWall(project, wallId, deltaMm) {
  const wall = (project.walls || []).find((item) => item.id === wallId);
  if (!wall) return { project, moved: false };
  const shift = workshopRoundMm(deltaMm);
  if (shift.x === 0 && shift.y === 0) return { project, moved: false };
  const patch = {
    aMm: { x: wall.aMm.x + shift.x, y: wall.aMm.y + shift.y },
    bMm: { x: wall.bMm.x + shift.x, y: wall.bMm.y + shift.y },
  };
  return { project: updateWall(project, wallId, patch).project, moved: true };
}


// ——— проёмы: умолчания и геометрия ————————————————————————————————————
//
// **Умолчания обязательны, а не удобны.** Человек ставит десять окон подряд, и
// вводить по четыре числа на каждое он не станет — он поставит их «как
// обычно» и поправит те два, которые отличаются. Числа взяты из того, что
// ставят в квартире: окно 1500 × 1400 с подоконником на 800 (при потолке 2700
// над ним остаётся полметра), межкомнатная дверь — проём 900 × 2100 под
// полотно 800 × 2000, проём без полотна такой же, арка пошире — 1200.
//
// Запоминаются они **на сеанс и по виду**: поправил окно на 1300 — следующее
// окно встанет 1300, а дверь останется дверью.
export const WORKSHOP_OPENING_DEFAULTS = {
  window: { widthMm: 1500, heightMm: 1400, heightAboveFloorMm: 800 },
  door: { widthMm: 900, heightMm: 2100, heightAboveFloorMm: 0 },
  opening: { widthMm: 900, heightMm: 2100, heightAboveFloorMm: 0 },
  arch: { widthMm: 1200, heightMm: 2100, heightAboveFloorMm: 0 },
};


/** Сколько миллиметров от конца `a` до проекции точки на стену, зажато в стену. */
export function workshopAlongWall(wall, pointMm) {
  const vectors = wallVectors(wall);
  if (!vectors) return 0;
  const along = (pointMm.x - wall.aMm.x) * vectors.u.x + (pointMm.y - wall.aMm.y) * vectors.u.y;
  return Math.max(0, Math.min(vectors.len, Math.round(along)));
}

/**
 * Куда сядет проём, когда показали на стену: **серединой под курсор**, и
 * прижатый к стене, если у конца не хватает места.
 *
 * Прижатие — не догадка: человек видит призрак проёма до клика и видит, что он
 * упёрся в конец. Без прижатия каждый клик у угла отвечал бы отказом
 * «не помещается», а поставить окно вплотную к углу — обычное дело.
 */
export function workshopOpeningAt(wall, pointMm, widthMm) {
  const vectors = wallVectors(wall);
  if (!vectors) return 0;
  const width = Number(widthMm) || 0;
  const middle = workshopAlongWall(wall, pointMm);
  return Math.max(0, Math.min(Math.round(vectors.len - width), Math.round(middle - width / 2)));
}



/**
 * Попробовать записать проём и честно сказать, что не так.
 *
 * Модель отказывает на проём шире стены, за её концом, внахлёст с соседним и
 * выше потолка — и её собственные сообщения уже называют числа («Проём шире
 * стены: проём 1500 мм, стена 1200 мм»). Поэтому проверка здесь не
 * переписывается: окно **пробует настоящую правку** и берёт у модели её же
 * слова. Призрак под курсором считается этой же функцией, поэтому красным он
 * становится ровно тогда, когда клик не прошёл бы.
 */
export function workshopTryOpening(project, draft, openingId) {
  try {
    const result = openingId ? updateOpening(project, openingId, draft) : addOpening(project, draft);
    return { ok: true, project: result.project, opening: result.opening };
  } catch (error) {
    return { ok: false, message: error && error.message ? error.message : String(error) };
  }
}

// ——— объекты на полу: умолчания из каталога ———————————————————————————
//
// С таска 154 габариты вещи живут во **встроенном каталоге**
// (`objectCatalog.js`), а не списком здесь: там же её имя, категория, место
// установки, изображение и ключ модели, и второго места, куда надо вписать
// новую вещь, нет. Здесь остались две двери к этим числам — по ключу и по
// имени прежнего вида — и запасной квадрат для вещи, которой в каталоге нет.

export const WORKSHOP_OBJECT_FALLBACK = {
  shape: "rect",
  widthMm: 600,
  depthMm: 600,
  heightMm: null,
  heightAboveFloorMm: 0,
};

/** Умолчания вещи каталога. Чужой ключ — запасной квадрат, а не пустота. */
export function workshopObjectDefaultsByKey(key) {
  return objectCatalogDefaults(key) || { ...WORKSHOP_OBJECT_FALLBACK };
}

/**
 * Умолчания по **имени** вида — для вещей прежней разметки (G68): ключа у них
 * нет, а имя есть, и каталог переводит одно в другое терпимым сравнением.
 * Вид, которого в каталоге нет («Аквариум»), получает запасной квадрат — ровно
 * как получал до каталога.
 */
export function workshopObjectDefaultsByName(name) {
  return workshopObjectDefaultsByKey(objectCatalogKeyByName(name));
}


// ——— объект рисуется, а не набирается числами (таск 137, G193) ————————————
//
// Слова заказчика: «при добавлении объектов типа „Прямоугольник“ позволь не
// просто выставлять размеры, а просто рисовать его, как сейчас метки — линии,
// только что бы обязательно надо было завершить контур».
//
// **Способов поставить объект три, а форм в модели по-прежнему две.** Это и
// есть ответ на развилку тикета: прямоугольник остаётся прямоугольником
// (`shape: "rect"` — середина, ширина, глубина, поворот), а контур — это
// **способ его задать**, а не третья форма.
//
// Почему не полилиния: форма хранения — это то, что увидит развёртка и 3D.
// Полоса (`polyline`) выражает вещь, которая идёт **по стене** и у которой одна
// глубина: кухонный фронт, короб, марш. Обведённый контур кухонного фронта —
// это не полоса: у неё нет направления, вдоль которого отмеряют. Положи его
// полилинией — и в развёртке он встал бы лентой по своему же периметру, то есть
// дважды. А главное, у заказчика на руках объекты, набранные числами
// (умолчания каталога), и форма у них `rect`: заведи контуру свою форму
// — и два прямоугольника на одном чертеже стали бы разными вещами, которые
// по-разному рисуются, по-разному проецируются на стену и по-разному правятся.
//
// **Приведение названо вслух: габарит в осях первой нарисованной стороны.** Не
// «по двум первым сторонам» (вторая сторона может быть нарисована под любым
// углом — тогда правило спорило бы с собой) и не по осям чертежа (повёрнутый
// кухонный фронт лёг бы прямо). Для настоящего прямоугольника это точно: контур
// прямоугольника возвращает тот же прямоугольник, до миллиметра (тест). Для
// кривого контура это **габарит**, и человек видит его призраком **до** того,
// как замкнёт: контур обводят на глазах, и обещать нечего — показано.
export const WORKSHOP_OBJECT_WAYS = ["rect", "contour", "polyline"];

// Картинка вещи на плашке колонки (таск 170): мельче, чем плитка в окне, —
// здесь она отвечает на «та ли вещь выбрана», а не на «какую выбрать», и
// рядом с ней стоит имя словами.
const WORKSHOP_THING_ICON = 26;

// Меньше трёх вершин — не контур: двумя точками площадь не огородить. Счёт
// общий с планом (`GESTURE_CLOSE_MIN`, таск 167) — ровно столько же требует и
// холст, чтобы замкнуть ломаную метки, и двух разных троек здесь не бывает.
export const WORKSHOP_CONTOUR_MIN = GESTURE_CLOSE_MIN;

/** Какой формой модели оборачивается выбранный способ. */
export function workshopShapeOfWay(way) {
  return way === "polyline" ? "polyline" : "rect";
}

/**
 * Каким способом читается форма поставленного объекта. Объект **не помнит**,
 * нарисовали его контуром или набрали числами, — и помнить не должен: в
 * чертеже это одна и та же вещь. Поэтому прямоугольник читается
 * прямоугольником, а не контуром.
 */
export function workshopWayOfShape(shape) {
  return shape === "polyline" ? "polyline" : "rect";
}

// Контур замкнут самим жестом: вершину, которой его закончили, в список не
// дописывают. Но прийти она может — от клика ровно в первую вершину, — и тогда
// это по-прежнему тот же контур.
function workshopContourPoints(pointsMm) {
  const points = workshopDistinct(pointsMm);
  const first = points[0];
  const last = points[points.length - 1];
  if (points.length > 1 && first.x === last.x && first.y === last.y) points.pop();
  return points;
}

function workshopAxes(turnDeg) {
  const angle = ((Number(turnDeg) || 0) * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return { u: { x: cos, y: sin }, n: { x: -sin, y: cos } };
}

const workshopDot = (point, axis) => point.x * axis.x + point.y * axis.y;

/**
 * Замкнутый контур — в прямоугольник: габарит в осях **первой нарисованной
 * стороны**. `null` — прямоугольника из этого не выйдет: вершин меньше трёх
 * или контур без площади (все вершины на одной линии).
 *
 * Поворот приводится к полуобороту: прямоугольник, повёрнутый на 180°, — тот
 * же прямоугольник, и показывать в колонке «Поворот 183°» вместо «3°» значило
 * бы пугать числом на пустом месте.
 */
export function workshopRectFromContour(pointsMm) {
  const points = workshopContourPoints(pointsMm);
  if (points.length < WORKSHOP_CONTOUR_MIN) return null;
  const degrees = (Math.atan2(points[1].y - points[0].y, points[1].x - points[0].x) * 180) / Math.PI;
  const turnDeg = ((Math.round(degrees) % 180) + 180) % 180;
  const { u, n } = workshopAxes(turnDeg);
  const along = points.map((point) => workshopDot(point, u));
  const across = points.map((point) => workshopDot(point, n));
  const minA = Math.min(...along);
  const maxA = Math.max(...along);
  const minB = Math.min(...across);
  const maxB = Math.max(...across);
  const widthMm = Math.round(maxA - minA);
  const depthMm = Math.round(maxB - minB);
  if (!(widthMm > 0) || !(depthMm > 0)) return null;
  const centerA = (minA + maxA) / 2;
  const centerB = (minB + maxB) / 2;
  return {
    atMm: workshopRoundMm({
      x: centerA * u.x + centerB * n.x,
      y: centerA * u.y + centerB * n.y,
    }),
    widthMm,
    depthMm,
    turnDeg,
  };
}

/**
 * Правка прямоугольника **за угол** (G194): угол напротив стоит на месте,
 * поворот не трогается — вещь растянули, а не повернули.
 *
 * Считается в осях самого объекта, а не экрана: у повёрнутой столешницы «шире»
 * значит шире вдоль неё самой. Размер меньше миллиметра не бывает — модель
 * нулевой прямоугольник не примет, и предлагать его окно не должно; угол,
 * сведённый в точку, оставляет миллиметр, а отказ не показывается вовсе.
 */
export function workshopRectCornerPatch(object, index, pointMm) {
  if (!object || object.shape === "polyline" || !pointMm) return null;
  const corners = schemeObjectCorners(object);
  const fixed = corners[(Number(index) + 2) % 4];
  if (!fixed || !corners[Number(index)]) return null;
  const { u, n } = workshopAxes(object.turnDeg);
  const span = (axis) => {
    const from = workshopDot(fixed, axis);
    const to = workshopDot(pointMm, axis);
    const size = Math.max(1, Math.round(Math.abs(to - from)));
    return { size, center: from + (to < from ? -size : size) / 2 };
  };
  const a = span(u);
  const b = span(n);
  return {
    atMm: workshopRoundMm({
      x: a.center * u.x + b.center * n.x,
      y: a.center * u.y + b.center * n.y,
    }),
    widthMm: a.size,
    depthMm: b.size,
  };
}

// ——— вещь поворачивается (таск 164, G243) —————————————————————————————————
//
// Слова заказчика: «унитаз и другие объекты надо вращать и сразу задавать им их
// размеры при выборе». Поворот в модели был с таска 126 (`turnDeg`), и поле
// «Поворот, °» в колонке стояло там же — но набрать в нём 90 и попасть
// унитазом к стене значило посчитать угол в голове. Здесь добавлены три
// двери к одному и тому же числу, и все три сводятся к `turnDeg`:
//
//   **шаг в четверть оборота** (`WORKSHOP_TURN_STEP_DEG`) — кнопки «−90°» и
//     «+90°» и клавиша `R`. Это главный случай: вещь ставят к одной из четырёх
//     стен, и трёх нажатий на весь чертёж хватает;
//   **рука за ручку** — ручка перед вещью, и угол притягивается кратно 15°
//     (`WORKSHOP_TURN_SNAP_DEG`) — **тем же шагом**, которым магнит холста
//     держит углы стен (`render.draftSnap`). Стены квартиры стоят под этими
//     углами, и вещь у стены — под ними же. Alt снимает притяжку, как и на
//     вершине: остаётся целый градус;
//   **поле числа** — любой целый градус без всяких шагов. Свободный ввод
//     остаётся старшим: шаг — это удобство, а не правило, и у наклонной стены
//     мансарды он не должен мешать.
//
// Полоса (`shape: "polyline"`) поворота не имеет вовсе: её форма задана
// точками, и «угол» у неё был бы третьим мнением рядом с ними. Поэтому ни
// поля, ни ручки, ни прочерка — строки просто нет (см. `syncObject`).

/** Шаг кнопки и клавиши: четверть оборота. */
export const WORKSHOP_TURN_STEP_DEG = 90;

/**
 * Шаг клавиш `Q` и `E` — половина четверти (таск 168, G249). Слова заказчика:
 * «плюс поворот на 45 градусов сделай и при размещении объекта по Q/E».
 *
 * Четыре двери к одному числу остаются каждая при своём шаге, и шаги не
 * спорят, а вкладываются друг в друга: `R` — 90°, `Q`/`E` — 45°, ручка — 15°,
 * поле — любой целый градус. Косой угол 45° нужен ровно там, где его просят, —
 * срезанный угол кухни, диван к углу комнаты, — и четвертью оборота он не
 * набирается вовсе, а ручкой набирается тремя шагами по 15°.
 */
export const WORKSHOP_TURN_HALF_DEG = 45;

/** Шаг руки — те же 15°, которыми магнит холста держит углы стен. */
export const WORKSHOP_TURN_SNAP_DEG = 15;

/** Дальше этого «спинкой к стене» стену не ищет: рядом её нет. */
export const WORKSHOP_TURN_WALL_MM = 3000;

// Ручка поворота стоит **перед вещью**, в точках экрана от середины её переда:
// ближе — садится на сам габарит, дальше — отрывается от вещи и читается как
// чужая.
//
// Радиус — радиус ручки поворота подписи (`render.LABEL_TURN_RADIUS`), и
// рисуется она тем же `drawLabelTurn` (таск 168, G250). Слова заказчика: «а
// так же у объекта при выделении кнопка поворота, **как и у подписи метки**».
// До этого таска ручек поворота в сборке было две, и разного в них было три
// вещи: мера (7 точек против 9), рисунок (своё кольцо с дугой против белого
// кружка со стрелкой на дуге) и ответ на клик без движения (вещь молчала,
// подпись поворачивалась). Осталось одно отличие, и оно от места: ручка
// подписи сидит на самой подписи, а ручке вещи до вещи 26 точек — поэтому у
// неё есть поводок, иначе кружок в стороне читался бы ничьим.
const WORKSHOP_TURN_GAP_PX = 26;
const WORKSHOP_TURN_HANDLE_PX = LABEL_TURN_RADIUS;

// Отступ строки размеров под габаритом призрака: имя вещи стоит над ним на
// восьми точках (`render.drawDrawingCaption`), размеры — под ним на восьми же.
const WORKSHOP_GHOST_LINE_GAP_PX = 8;

/** Угол в целых градусах одного оборота — правило модели (`schemeObjectTurnDeg`). */
export function workshopTurnDeg(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return ((Math.round(number) % 360) + 360) % 360;
}

/** Повернуть на столько-то: кнопка, клавиша и «к стене» считают одним местом. */
export function workshopTurnBy(turnDeg, deltaDeg) {
  return workshopTurnDeg((Number(turnDeg) || 0) + (Number(deltaDeg) || 0));
}

/**
 * Куда вещь **смотрит** на чертеже.
 *
 * При нулевом повороте перёд уходит вниз по листу — туда, куда смотрит вещь,
 * приставленная к верхней стене комнаты. Это не выбор окна: ровно так читает
 * поворот модель в объёме (`volume.volumeObjectFrame`, таск 155), где доля
 * −0,5 по глубине лежит на той стороне, где `y` больше. Ось здесь одна и та
 * же — поперечная ось вещи, `workshopAxes(turnDeg).n`, — и второго описания
 * переда в сборке быть не должно: разойдись они, ручка поворота смотрела бы в
 * одну сторону, а фасад шкафа в объёме — в другую.
 */
export function workshopFrontAxis(turnDeg) {
  return workshopAxes(turnDeg).n;
}

/** Середина переда вещи в миллиметрах — там, где стоит ручка поворота. */
export function workshopFrontMidMm(object) {
  if (!object || object.shape === "polyline") return null;
  const corners = schemeObjectCorners(object);
  if (corners.length < 4) return null;
  return { x: (corners[2].x + corners[3].x) / 2, y: (corners[2].y + corners[3].y) / 2 };
}

/**
 * Ручка поворота выделенного прямоугольника: перед вещью, на поводке от
 * середины её переда. Ею она и показывает, куда вещь смотрит, — поэтому
 * отдельной приметы переда у выделенного нет, их было бы две.
 *
 * `null` — у полосы и у вещи без габарита: поворачивать нечего.
 */
export function workshopTurnHandle(object, view) {
  const frontMm = workshopFrontMidMm(object);
  if (!frontMm) return null;
  const from = planToScreen(frontMm, WORKSHOP_UNIT, view);
  const axis = workshopFrontAxis(object.turnDeg);
  return {
    kind: "turn",
    index: 0,
    x: from.x + axis.x * WORKSHOP_TURN_GAP_PX,
    y: from.y + axis.y * WORKSHOP_TURN_GAP_PX,
    r: WORKSHOP_TURN_HANDLE_PX,
    from,
  };
}

/**
 * Угол, при котором вещь смотрит **в точку под рукой**. Считается от середины
 * вещи: ручка ходит по кругу, и радиус в ответ не входит — важно только
 * направление.
 *
 * `free` (зажатый Alt) — целый градус, как и на вершине; без него угол
 * притягивается кратно 15°. `null` — рука ровно в середине вещи, направления
 * нет, и выдумывать его нельзя.
 */
export function workshopTurnToward(object, pointMm, options = {}) {
  if (!object || object.shape === "polyline" || !object.atMm || !pointMm) return null;
  const dx = Number(pointMm.x) - Number(object.atMm.x);
  const dy = Number(pointMm.y) - Number(object.atMm.y);
  if (!(Math.hypot(dx, dy) > 0)) return null;
  // Обратный ход к `workshopFrontAxis`: перёд равен {−sin, cos}, значит угол
  // читается из направления как `atan2(−x, y)`.
  const degrees = (Math.atan2(-dx, dy) * 180) / Math.PI;
  const step = options.free ? 1 : WORKSHOP_TURN_SNAP_DEG;
  return workshopTurnDeg(Math.round(degrees / step) * step);
}

/**
 * Угол, при котором вещь стоит **спинкой к ближайшей стене**.
 *
 * Притяжка названа вслух и остаётся **ручной** (таск 164): при постановке вещь
 * сама не доворачивается. Унитаз у стены действительно всегда к ней спиной, но
 * человек ставит и нарочно — косой умывальник в углу, диван посреди комнаты, —
 * и правило «рядом стена, значит повернуть» спорило бы с набранным им числом.
 * Поэтому это кнопка: нажал — довернулось, не нажал — стоит как поставил.
 *
 * Стена даёт **ось**, а не направление: ширина вещи ложится вдоль стены, а
 * перёд уходит на ту сторону, где вещь стоит. Вещь ровно на линии стены
 * (колонна в стене) стороны не называет — тогда из двух перпендикуляров
 * берётся тот, что ближе к нынешнему углу: доворот не должен разворачивать
 * вещь на пол-оборота без повода.
 *
 * `null` — поворачивать нечего (полоса) или стены ближе `limitMm` нет.
 */
export function workshopWallTurnDeg(walls, object, limitMm = WORKSHOP_TURN_WALL_MM) {
  if (!object || object.shape === "polyline" || !object.atMm) return null;
  const at = { x: Number(object.atMm.x), y: Number(object.atMm.y) };
  let best = null;
  for (const wall of walls || []) {
    if (!wall || !wall.aMm || !wall.bMm) continue;
    const axis = wallVectors(wall);
    if (!axis) continue;
    const gap = segmentDistanceMm(at, wall.aMm, wall.bMm);
    if (gap > limitMm) continue;
    if (!best || gap < best.gap) best = { gap, axis, wall };
  }
  if (!best) return null;
  // Сторона, на которой стоит вещь: от ближней точки стены к её середине.
  const span = { x: Number(best.wall.bMm.x) - Number(best.wall.aMm.x), y: Number(best.wall.bMm.y) - Number(best.wall.aMm.y) };
  const length = Math.hypot(span.x, span.y);
  const along = Math.max(
    0,
    Math.min(1, ((at.x - Number(best.wall.aMm.x)) * span.x + (at.y - Number(best.wall.aMm.y)) * span.y) / (length * length)),
  );
  const near = { x: Number(best.wall.aMm.x) + span.x * along, y: Number(best.wall.aMm.y) + span.y * along };
  const side = { x: at.x - near.x, y: at.y - near.y };
  const sides = [best.axis.n, { x: -best.axis.n.x, y: -best.axis.n.y }];
  const turns = sides.map((axis) => workshopTurnDeg((Math.atan2(-axis.x, axis.y) * 180) / Math.PI));
  if (Math.hypot(side.x, side.y) >= 1) {
    const pick = sides[0].x * side.x + sides[0].y * side.y >= 0 ? 0 : 1;
    return turns[pick];
  }
  const now = workshopTurnDeg(object.turnDeg);
  const away = (turn) => Math.min(((turn - now) % 360 + 360) % 360, ((now - turn) % 360 + 360) % 360);
  return away(turns[0]) <= away(turns[1]) ? turns[0] : turns[1];
}

/**
 * Что встанет по клику: прямоугольник серединой под курсор, с теми размерами и
 * тем углом, которые стоят в колонке.
 *
 * **Одна дверь для призрака и для постановки** (таск 164): призрак под рукой
 * рисуется из этого же ответа, которым `placeObject` зовёт модель. Разойдись
 * они — человек видел бы один угол, а ставил другой, и это была бы та самая
 * ложь, которой окно не должно говорить.
 */
export function workshopObjectRectAt(sizes, pointMm) {
  if (!sizes || !pointMm) return null;
  return {
    shape: "rect",
    atMm: { x: Number(pointMm.x), y: Number(pointMm.y) },
    widthMm: Number(sizes.widthMm),
    depthMm: Number(sizes.depthMm),
    turnDeg: workshopTurnDeg(sizes.turnDeg),
  };
}

/**
 * Куда встанет вещь по клику: **в ту самую точку, из которой нарисован
 * призрак** (таск 168, G248).
 *
 * Жалоба заказчика «просто тыкаешь и куда-то рядом встало» оказалась буквальной
 * и считается числами. Призрак считался из события движения руки, а клик — из
 * события **отпускания** кнопки, и между ними разрешена вся мерка «рука
 * поехала» (`workshopHandMoved`: три точки у мыши, десять у пальца): меньший
 * сдвиг кликом и остаётся, иначе жест стал бы панорамой. Сами по себе эти
 * точки ничего не стоят — но притяжка
 * к узлам сетки делит лист на клетки по 500 мм, и граница клетки шириной в
 * одну точку проходит через каждую. Дрогнула рука на две точки поперёк такой
 * границы — и вещь уехала на **полметра** от обещанного.
 *
 * Снято живьём на объекте заказчика (сетка 500 мм, 13,5 мм в точке экрана):
 * рука стоит на `y = 384`, призрак показывает узел −500 мм; кнопка отпущена на
 * `y = 382` — вещь встала на −1000 мм. Тот же клик без дрожи даёт −500 мм.
 *
 * Поэтому точка берётся у призрака, а не у события. Сырой курсор остаётся
 * запасным путём для случая, когда призрака нет вовсе: палец на сенсорном
 * экране касается, не наведя, и показать ему было нечего.
 *
 * `free` (зажатый Alt) снимает притяжку, и это признак самой точки, а не
 * события: нажали Alt, не двинув рукой, — призрак про это не знает, и точка
 * считается заново, по курсору.
 */
export function workshopPlacePointMm(ghost, free, cursorMm) {
  if (!ghost || !ghost.pointMm || Boolean(ghost.free) !== Boolean(free)) return cursorMm;
  return ghost.pointMm;
}

// ——— полоса правится как ломаная метки (таск 137, G194) ———————————————————
//
// Четыре движения, и все четыре взяты у холста: вершину двигают, ручка на
// середине отрезка разбивает его, ручка за концом продолжает полосу, двойной
// клик по вершине её убирает. Геометрия ручек, порядок спора за клик и их
// рисунок — те самые, что у ломаной метки и контура помещения
// (`render.pathEditHandles`, `hitPathHandle`, `drawPathHandles`): второй руки у
// человека нет, и второго правила здесь не заводится.
//
// Повторён только **список точек**: у метки его правит `model.moveMarkPoint` и
// соседи, а у объекта схемы точки лежат в `pointsMm`, и своего мутатора окно не
// пишет — считает новый список и отдаёт его `updateSchemeObject`. Ровно так же
// устроен перенос вершины цепочки стен (`workshopMoveVertex`, таск 125).

function workshopPointsOf(pointsMm) {
  return (Array.isArray(pointsMm) ? pointsMm : []).map((point) => ({ x: point.x, y: point.y }));
}

function workshopInside(points, index) {
  return Number.isInteger(index) && index >= 0 && index < points.length;
}

export function workshopPointsMove(pointsMm, index, pointMm) {
  const points = workshopPointsOf(pointsMm);
  if (!workshopInside(points, index) || !pointMm) return null;
  points[index] = { x: pointMm.x, y: pointMm.y };
  return points;
}

/** Новая вершина встаёт **за** `index` — на отрезке от неё к следующей. */
export function workshopPointsInsert(pointsMm, index, pointMm) {
  const points = workshopPointsOf(pointsMm);
  if (!workshopInside(points, index) || !pointMm) return null;
  points.splice(index + 1, 0, { x: pointMm.x, y: pointMm.y });
  return points;
}

/**
 * Продолжение полосы — за любой её конец. Отдельно от вставки по той же
 * причине, по которой у метки отдельная `extendMarkLine`: продолжить с головы
 * вставкой «после индекса» можно было бы только перевернув список, а порядок
 * вершин значащий — по нему идёт подпись и считается развёртка.
 */
export function workshopPointsExtend(pointsMm, end, pointMm) {
  const points = workshopPointsOf(pointsMm);
  if (points.length === 0 || !pointMm) return null;
  const added = { x: pointMm.x, y: pointMm.y };
  if (end === "start") return [added, ...points];
  if (end === "end") return [...points, added];
  return null;
}

/**
 * Убрать вершину. Список считается даже тогда, когда он станет короче двух
 * вершин: **отказывает модель** (`schemeObjectShortLine`) и её же словами —
 * второго свода правил в окне нет, как и у проёмов (таск 126).
 */
export function workshopPointsRemove(pointsMm, index) {
  const points = workshopPointsOf(pointsMm);
  if (!workshopInside(points, index)) return null;
  points.splice(index, 1);
  return points;
}

/**
 * Источники притяжки при правке вершины — правило холста (`canvasPathSnap`)
 * буква в букву: опора идёт **последней** (от неё `draftSnap` отмеряет угол
 * кратно 15°), правимая вершина в источники не попадает — сама с собой она не
 * выравнивается.
 *
 * Сам холст этого не отдаёт: его `canvasPathSnap` прибит к синглтон-состоянию
 * и к его схеме. Повторено поэтому не поведение, а три строки выборки.
 */
export function workshopPathSources(pointsMm, anchorIndex, skipIndex) {
  const points = workshopPointsOf(pointsMm);
  const anchor = points[anchorIndex] || points[0];
  if (!anchor) return [];
  const sources = points.filter((point, at) => at !== skipIndex && at !== anchorIndex);
  return [...sources, anchor];
}

/** Какая вершина служит опорой угла, когда двигают ручку `handle`. */
export function workshopPathAnchor(points, handle) {
  if (!handle) return { anchorIndex: 0, skipIndex: -1 };
  if (handle.kind !== "vertex") return { anchorIndex: handle.index, skipIndex: -1 };
  const last = points.length - 1;
  // У прямоугольника углы — кольцо: опора первого угла последний, а не второй.
  const ring = points.length === 4 && handle.ring;
  const index = Number(handle.index);
  if (index > 0) return { anchorIndex: index - 1, skipIndex: index };
  return { anchorIndex: ring ? last : Math.min(1, last), skipIndex: index };
}

/**
 * Ручки выделенного объекта. Прямоугольнику полагаются **углы и поворот**:
 * вставить в него пятый угол и продолжить его некуда — он не путь. Полосе
 * достаётся весь набор пути, какой правит ломаную метки, а поворота у неё нет
 * вовсе (таск 164).
 *
 * Ручка поворота идёт **последней**: спор за клик решается порядком, и угол
 * вещи старше её поворота — он стоит на самом габарите, а поворот снаружи.
 */
export function workshopObjectHandles(object, view) {
  if (!object) return [];
  if (object.shape === "polyline") {
    return pathEditHandles(WORKSHOP_UNIT, { points: object.pointsMm || [], closed: false }, view);
  }
  const corners = pathVertexHandles(WORKSHOP_UNIT, schemeObjectCorners(object), view).map((handle) => ({
    ...handle,
    ring: true,
  }));
  const turn = workshopTurnHandle(object, view);
  return turn ? [...corners, turn] : corners;
}

/**
 * **Одна дверь для предпросмотра и для записи.** Пока тащат — кадр рисуется из
 * этого патча, по отпусканию он же уходит в `updateSchemeObject`. Разойдись эти
 * два пути — призрак обещал бы одно, а в объект уходило бы другое.
 *
 * `options.free` — зажатый Alt: он нужен ручке поворота (целый градус вместо
 * шага 15°) и приходит обоими путями из одного места, `drag.free`.
 */
export function workshopObjectPatch(object, handle, toMm, options = {}) {
  if (!object || !handle || !toMm) return null;
  if (object.shape !== "polyline") {
    if (handle.kind === "turn") {
      const turnDeg = workshopTurnToward(object, toMm, options);
      return turnDeg === null ? null : { turnDeg };
    }
    return handle.kind === "vertex" ? workshopRectCornerPatch(object, handle.index, toMm) : null;
  }
  const points = object.pointsMm || [];
  const next =
    handle.kind === "vertex"
      ? workshopPointsMove(points, handle.index, toMm)
      : handle.kind === "insert"
        ? workshopPointsInsert(points, handle.index, toMm)
        : handle.kind === "extend"
          ? workshopPointsExtend(points, handle.end, toMm)
          : null;
  return next ? { pointsMm: next } : null;
}

/**
 * Где стоит длина набираемого отрезка (G195). Слова заказчика: «в процессе
 * рисования **над текущей линией** указывай ей длину при рисовании».
 *
 * Середина отрезка, сдвиг по нормали — и всегда в сторону меньшего `y`, то
 * есть вверх по экрану: подпись над линией, а не под ней, с какого конца её ни
 * рисуй. `null` — отрезка ещё нет, и мерить нечего.
 */
export function workshopLengthAt(a, b, gap) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  if (!(length > 0)) return null;
  const normal = { x: -dy / length, y: dx / length };
  const side = normal.y <= 0 ? 1 : -1;
  return {
    x: (a.x + b.x) / 2 + normal.x * side * gap,
    y: (a.y + b.y) / 2 + normal.y * side * gap,
  };
}

/**
 * Что под курсором на чертеже. Старшинство названо здесь целиком, потому что
 * спорят теперь пятеро:
 *
 *   1. **ручки выделенного** — створки у двери, углы и вершины у объекта. Ими
 *      его и правят, и стоят они поверх самой вещи;
 *   2. **вершина стены** — ею правят угол, промах по ней обиднее всего;
 *   3. **проём** — он лежит в стене, и клик по нему должен брать его, а не
 *      стену под ним;
 *   4. **объект на полу** — он внутри комнаты, стен там обычно нет;
 *   5. **тело стены** — последнее, и порог растёт с толщиной.
 *
 * `hiddenObjectIds` — вещи, спрятанные с экрана (таск 154, G223): их не видно,
 * значит и взять их нельзя. Иначе человек тащил бы за угол то, чего на поле
 * нет, и объяснить это было бы нечем.
 */
export function workshopPick(project, schemeId, pointMm, view, selected, hiddenObjectIds) {
  const walls = wallsOnScheme(project, schemeId);
  const zoom = Number(view && view.zoom) > 0 ? Number(view.zoom) : 1;
  const vertexMm = WORKSHOP_VERTEX_PX / zoom;
  const slackMm = WORKSHOP_WALL_PX / zoom;
  // Ручки правки живут **в экранных пикселях** — порог у них свой и тот же, что
  // на холсте: `hitPathHandle` считает по радиусу самой ручки.
  if (selected && selected.kind === "object") {
    const object = findSchemeObject(project, selected.id);
    const handle = object
      ? hitPathHandle(workshopObjectHandles(object, view), planToScreen(pointMm, WORKSHOP_UNIT, view))
      : null;
    if (handle) return { kind: "objectHandle", id: object.id, handle };
  }
  if (selected && selected.kind === "opening") {
    const opening = findOpening(project, selected.id);
    const wall = opening ? findWall(project, opening.wallId) : null;
    const leaf = wall && opening.kind === OPENING_KIND_DOOR ? drawingDoorLeaf(wall, opening) : null;
    if (leaf) {
      if (Math.hypot(pointMm.x - leaf.hinge.x, pointMm.y - leaf.hinge.y) <= vertexMm) {
        return { kind: "hinge", id: opening.id };
      }
      if (Math.hypot(pointMm.x - leaf.tip.x, pointMm.y - leaf.tip.y) <= vertexMm) {
        return { kind: "swing", id: opening.id };
      }
    }
  }
  let vertex = null;
  for (const wall of walls) {
    for (const end of ["aMm", "bMm"]) {
      const gap = Math.hypot(pointMm.x - wall[end].x, pointMm.y - wall[end].y);
      if (gap <= vertexMm && (!vertex || gap < vertex.gap)) {
        vertex = { gap, wallId: wall.id, atMm: { x: wall[end].x, y: wall[end].y } };
      }
    }
  }
  if (vertex) return { kind: "vertex", id: vertex.wallId, wallId: vertex.wallId, atMm: vertex.atMm };
  for (let index = walls.length - 1; index >= 0; index -= 1) {
    const wall = walls[index];
    const limit = Math.max(slackMm, Number(wall.thicknessMm) / 2);
    for (const opening of openingsInWall(project, wall.id)) {
      const span = drawingOpeningSpan(wall, opening);
      if (!span) continue;
      const along = (pointMm.x - wall.aMm.x) * span.u.x + (pointMm.y - wall.aMm.y) * span.u.y;
      const across = Math.abs((pointMm.x - wall.aMm.x) * span.n.x + (pointMm.y - wall.aMm.y) * span.n.y);
      if (along >= opening.atMm && along <= opening.atMm + opening.widthMm && across <= limit) {
        return { kind: "opening", id: opening.id, wallId: wall.id };
      }
    }
  }
  const hiddenObjects =
    hiddenObjectIds instanceof Set ? hiddenObjectIds : new Set(hiddenObjectIds || []);
  const objects = schemeObjectsOnScheme(project, schemeId).filter((object) => !hiddenObjects.has(object.id));
  for (let index = objects.length - 1; index >= 0; index -= 1) {
    if (drawingHitObject(objects[index], pointMm, slackMm)) {
      return { kind: "object", id: objects[index].id };
    }
  }
  for (let index = walls.length - 1; index >= 0; index -= 1) {
    const wall = walls[index];
    const limit = Math.max(slackMm, Number(wall.thicknessMm) / 2);
    if (segmentDistanceMm(pointMm, wall.aMm, wall.bMm) <= limit) {
      return { kind: "wall", id: wall.id, wallId: wall.id, atMm: null };
    }
  }
  return null;
}

/**
 * Что выделяет жест: **вещь, а не ручку**. Взялись за вершину стены — выделена
 * стена, за угол объекта — объект. Ручка это жест, а не то, что правят, и
 * выделенная «ручка» оставила бы колонку свойств без предмета: ни полей, ни
 * вида, ни размеров (найдено живым прогоном таска 137 — первая же правка угла
 * опустошила колонку).
 *
 * `WORKSHOP_SUBJECTS` — всё, чем выделение бывает: на этот список смотрят и
 * `subject()`, и `aliveSelection()`.
 */
export const WORKSHOP_SUBJECTS = ["wall", "opening", "object"];

export function workshopSelectionOf(pick) {
  if (!pick) return null;
  if (pick.kind === "vertex") return { kind: "wall", id: pick.wallId };
  if (pick.kind === "objectHandle") return { kind: "object", id: pick.id };
  return WORKSHOP_SUBJECTS.includes(pick.kind) ? { kind: pick.kind, id: pick.id } : null;
}

/**
 * Что должно влезть в окно: нарисованное и — когда она ложится — подложка.
 * Ни того, ни другой нет — лист `WORKSHOP_EMPTY_MM` вокруг нуля.
 */
export function workshopExtentMm(project, schemeId, placement) {
  const points = [];
  const bounds = drawingBoundsMm(project, schemeId);
  if (bounds) points.push({ x: bounds.minX, y: bounds.minY }, { x: bounds.maxX, y: bounds.maxY });
  if (placement && placement.kind === "ready") {
    for (const corner of [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }]) {
      const mm = planFractionToMm(project, schemeId, corner);
      if (mm) points.push(mm);
    }
  }
  if (points.length === 0) {
    return {
      minX: -WORKSHOP_EMPTY_MM.widthMm / 2,
      minY: -WORKSHOP_EMPTY_MM.heightMm / 2,
      maxX: WORKSHOP_EMPTY_MM.widthMm / 2,
      maxY: WORKSHOP_EMPTY_MM.heightMm / 2,
    };
  }
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
}

/**
 * Зажать масштаб окна. Потолок остался доводом, хотя кадр теперь один:
 * `workshopFitView` зовут и с чужой мерой — из теста и из «Интерфейса
 * проекта», — и прибивать предел внутри значило бы прятать его от вызывающего.
 */
export function workshopClampZoom(zoom, max = WORKSHOP_ZOOM_MAX) {
  const value = Number(zoom);
  const ceiling = Number(max) > 0 ? Number(max) : WORKSHOP_ZOOM_MAX;
  if (!(value > 0)) return WORKSHOP_ZOOM_MIN;
  return Math.min(ceiling, Math.max(WORKSHOP_ZOOM_MIN, value));
}

/** Вписать габарит в окно — с запасом по краю, как `render.fitView` у холста. */
export function workshopFitView(extent, viewport, max = WORKSHOP_ZOOM_MAX) {
  const width = Math.max(1, extent.maxX - extent.minX);
  const height = Math.max(1, extent.maxY - extent.minY);
  const boxWidth = Math.max(1, Number(viewport && viewport.width) || 0);
  const boxHeight = Math.max(1, Number(viewport && viewport.height) || 0);
  const zoom = workshopClampZoom(Math.min(boxWidth / width, boxHeight / height) * 0.94, max);
  return {
    zoom,
    offsetX: boxWidth / 2 - ((extent.minX + extent.maxX) / 2) * zoom,
    offsetY: boxHeight / 2 - ((extent.minY + extent.maxY) / 2) * zoom,
  };
}

/**
 * Шаг сетки, которым её **рисуют**: выбранный человеком или кратный ему, если
 * выбранный на этом масштабе слился бы в заливку. Притягивается при этом
 * по-прежнему выбранный — иначе отметка «шаг 100 мм» врала бы на мелком
 * масштабе.
 */
export function workshopGridDrawStepMm(gridMm, zoom) {
  const step = Number(gridMm) || 0;
  const scale = Number(zoom) > 0 ? Number(zoom) : 1;
  if (!(step > 0)) return 0;
  for (const multiple of WORKSHOP_GRID_MULTIPLES) {
    if (step * multiple * scale >= WORKSHOP_GRID_MIN_PX) return step * multiple;
  }
  return 0;
}

/**
 * Подсказка под полем — своя у каждого занятия. Одна на всех врала с той
 * минуты, как занятий стало три: про «вершину цепочки» читал человек, который
 * в это время ставил окно в стену. Чистая и вынесена наружу ради теста:
 * пропущенное занятие молча показало бы чужие слова.
 */
export function workshopHint(tool, way) {
  if (tool === "openings") return strings.workshop.hintOpenings;
  if (tool === "objects") {
    // Способов поставить объект три, и жесты у них разные (таск 137): про
    // «замкните контур» читал бы человек, который в эту минуту ставит радиатор
    // кликом.
    if (way === "contour") return strings.workshop.hintContour;
    if (way === "polyline") return strings.workshop.hintBand;
    return strings.workshop.hintObjects;
  }
  if (tool === "edit") return strings.workshop.hintEdit;
  return strings.workshop.hint;
}

/**
 * Строка состояния схемы: какой это из трёх случаев, что в чертеже и сколько
 * стен. Чистая — слова про случай «молча рисовать в никуда нельзя» решаются
 * здесь и проверяются без браузера.
 */
/**
 * Список элементов чертежа для правой колонки режима «Чертёж» (таск 153).
 *
 * Заказчик: правая панель своя в каждом режиме, и в чертеже это «список
 * элементов чертежа с глазками видимости». Глазки — соседний таск (154), здесь
 * сам список и место под них.
 *
 * Порядок — **модельный** (`wallsOnScheme`, `openingsInWall`,
 * `schemeObjectsOnScheme`), своей сортировки не заводится: разойдись она с
 * чертежом — список перестал бы отвечать на «что я выделил». Стены названы так
 * же, как на чертеже и в развёртке (`wallName`), проёмы стоят под своей стеной
 * (их место на чертеже — в ней), объекты зовутся по виду.
 *
 * Чистая: панель из неё только рисует строки, и проверяется она тестом — иначе
 * расхождение имён со чертежом заметил бы только глаз.
 */
export function workshopListGroups(project, schemeId) {
  if (!project || !schemeId) return [];
  const walls = wallsOnScheme(project, schemeId);
  const wallRows = [];
  const openingRows = [];
  for (const wall of walls) {
    wallRows.push({
      kind: "wall",
      id: wall.id,
      label: text("workshop.listWall", { name: wallName(project, wall.id) }),
      note: text("workshop.listWallNote", { length: wallLengthMm(wall), thickness: wall.thicknessMm }),
    });
    for (const opening of openingsInWall(project, wall.id)) {
      openingRows.push({
        kind: "opening",
        id: opening.id,
        label: strings.openingKinds[opening.kind] || strings.workshop.opening,
        note: text("workshop.listOpeningNote", {
          wall: wallName(project, wall.id),
          width: opening.widthMm,
          height: opening.heightMm,
        }),
      });
    }
  }
  const objectRows = schemeObjectsOnScheme(project, schemeId).map((object) => {
    const name = schemeObjectNameOf(project, object);
    return {
      kind: "object",
      id: object.id,
      label: name || strings.workshop.object,
      note:
        object.shape === "polyline"
          ? text("workshop.listBandNote", { depth: object.depthMm })
          : text("workshop.listRectNote", { width: object.widthMm, depth: object.depthMm }),
    };
  });
  return [
    { kind: "wall", title: strings.workshop.layerWalls, rows: wallRows },
    { kind: "opening", title: strings.workshop.toolOpenings, rows: openingRows },
    { kind: "object", title: strings.workshop.layerObjects, rows: objectRows },
  ];
}

export function workshopStatus(project, schemeId, placement) {
  return workshopSummaryLines(project, schemeId, placement).join(" · ");
}

/**
 * То же самое строками — для сводки над полем (G228).
 *
 * Одна строка — один ответ: чем меряется план, сколько в чертеже стен, проёмов
 * и объектов. Разбирать обратно строку со всеми ними («сплитом по точке»)
 * нельзя: внутри частей точка тоже встречается.
 */
export function workshopSummaryLines(project, schemeId, placement) {
  const parts = [];
  if (placement.kind === "ready") {
    const size = planSizeMeters(project, schemeId);
    parts.push(
      size
        ? text("workshop.caseReady", { width: formatMeters(size.width), height: formatMeters(size.height) })
        : strings.workshop.caseReady,
    );
    if (placement.pending) parts.push(strings.workshop.caseNoOrigin);
    if (placement.turn) {
      parts.push(text("workshop.caseTurn", { turn: placement.turn }));
    }
  } else if (placement.kind === "noScale") {
    parts.push(strings.workshop.caseNoScale);
  } else {
    parts.push(strings.workshop.caseNoImage);
  }
  const bounds = drawingBoundsMm(project, schemeId);
  parts.push(
    bounds
      ? text("workshop.size", { width: bounds.widthMm, height: bounds.heightMm })
      : strings.workshop.sizeEmpty,
  );
  parts.push(text("workshop.wallCount", { count: wallsOnScheme(project, schemeId).length }));
  const openings = wallsOnScheme(project, schemeId).reduce(
    (total, wall) => total + openingsInWall(project, wall.id).length,
    0,
  );
  if (openings > 0) parts.push(text("workshop.openingCount", { count: openings }));
  const objects = schemeObjectsOnScheme(project, schemeId).length;
  if (objects > 0) parts.push(text("workshop.objectCount", { count: objects }));
  return parts;
}

// ——— окно ——————————————————————————————————————————————————————————————

// Что человек выбрал в окне — его рабочее место, а не свойство объекта: слои,
// шаг сетки, притяжка и толщина новых стен живут в памяти страницы и переживают
// закрытие окна, но в `project.json` не попадают.
// Отметки слоёв поля. «Объектов» среди них больше нет: вещи гасит общий
// выключатель «Объекты чертежа» (таск 154, G223) — он же стоит в «Интерфейсе
// проекта» и гасит их заодно на плане и в объёме. Две отметки с одним словом в
// двух местах отвечали бы на один вопрос по-разному.
let workshopLayers = { plan: true, grid: true, walls: true };
let workshopGridMm = WORKSHOP_GRID_DEFAULT_MM;
let workshopGridSnap = true;
let workshopThicknessMm = WORKSHOP_THICKNESS_DEFAULT_MM;
// Умолчания проёмов — по виду и на сеанс: поправил окно на 1300, и следующее
// окно встанет 1300, а дверь останется дверью.
let workshopOpeningKind = OPENING_KINDS[0];
let workshopOpeningSizes = JSON.parse(JSON.stringify(WORKSHOP_OPENING_DEFAULTS));
let workshopDoorHinge = OPENING_HINGES[0];
let workshopDoorSwing = OPENING_SWINGS[0];
// Объекты: вид выбирается в колонке, размеры подставляются по виду, способ —
// от вида же (столешницу тянут полосой, остальное ставят прямоугольником).
// Что добавляли в прошлый раз (таск 133): вернулись в «Добавление» — вернулись
// к тому же, чем рисовали. Та же природа, что у толщины стен и шага сетки —
// рабочее место, а не объект.
let workshopAdding = "walls";
// Что поставит следующий клик — **ключ встроенного каталога** (таск 154).
// Прежде здесь стояло имя вида из справочника объекта, и у двух объектов с
// по-разному названными видами это имя значило разное. Радиатор остаётся
// умолчанием: ради него и столешницы объекты на чертеже и заведены.
let workshopObjectKey = "radiator";
// Способ, а не форма (таск 137): прямоугольник ставится кликом по умолчаниям
// **или** обводится контуром, и это один и тот же `shape: "rect"`.
let workshopObjectWay = WORKSHOP_OBJECT_WAYS[0];
let workshopObjectSizes = {};

// Краска самого окна. Цвета чертежа сюда не входят: их держит общий слой
// (`render.DRAWING_*`), и повтори их здесь — стена в окне и стена на холсте
// разошлись бы оттенком в первую же правку.
const WORKSHOP_PAPER = DRAWING_PAPER;
const WORKSHOP_ACCENT = DRAWING_ACTIVE;
const WORKSHOP_HANDLE = "#ffffff";
const WORKSHOP_GRID_LINE = "#d0d7de";
const WORKSHOP_GRID_MAJOR = "#aeb7c0";
const WORKSHOP_ORIGIN = "#d1242f";

/**
 * Собрать мастерскую чертежа на основном экране (таск 153).
 *
 * Окна у мастерской больше нет: поле занимает основной экран, инструменты и
 * свойства стоят в верхнем блоке левой колонки, список элементов — в правой.
 * Полноэкранный показ даёт кнопка «Во весь экран» над полем, общая на все три
 * режима, — своей кнопки «Закрыть» у режима нет и быть не может.
 *
 * Масштаб плана задаётся в «Схемах» (G227): кнопка рядом с погашенной
 * отметкой подложки показывает план и начинает калибровку там.
 *
 * Поверхность **живёт дальше, когда режим сменили**: она только гаснет
 * (`visibility` в стилях). Поэтому человек, вернувшийся в «Чертёж», находит
 * тот же масштаб, тот же инструмент и тот же черновик — в объект при этом не
 * попадает ничего (G68).
 */
function createWorkshop({ api, hosts }) {
  const { getState, setState, notify, subscribe } = api;
  // Схема — та, что открыта в приложении, и она **меняется под поверхностью**:
  // выбрали другую в списке схем — чертят её же, не выходя из режима. Прежде
  // окно открывалось на одну схему и закрывалось, чтобы сменить её.
  let schemeId = getState().schemeId;
  if (!findScheme(getState().project, schemeId)) return null;

  // Чем мастерская занята при открытии: подложка без калибровки — масштабом,
  // иначе стенами. Пришёл обводить план — первым делом видит план.
  let tool = workshopInitialTool(getState().project, schemeId);
  let view = { zoom: 1, offsetX: 0, offsetY: 0 };
  let fitted = false;
  let draft = null; // {points: [мм], cursor: мм, snap: результат притяжки}
  // Выделено может быть одно из трёх: стена, проём или объект на полу.
  // Одна переменная на всех — иначе «выделено два разных» стало бы состоянием,
  // которого в окне не бывает.
  let selected = null; // {kind: "wall"|"opening"|"object", id}
  // Призрак проёма под курсором и причина, по которой он не сядет: считается
  // той же попыткой записи, что и сам клик, поэтому красным он становится
  // ровно тогда, когда клик не прошёл бы.
  let ghost = null;
  // Где стоит призрак вещи (таск 164) — **точка, а не вещь**: сама вещь
  // считается на кадре, `workshopObjectRectAt` по полям колонки. Храни тут
  // готовый прямоугольник — и он остался бы со старым углом, когда угол
  // поправили, не двигая руки: поле уже 90°, а под рукой по-прежнему 0°.
  // Найдено живым прогоном таска 164.
  //
  // `{pointMm, free}` (таск 168): рядом с точкой лежит примета Alt, которой
  // она посчитана, — по ней `workshopPlacePointMm` решает, годится ли показанная
  // точка для клика. Из этой же точки вещь и встаёт: что показано, то и встало.
  let objectGhost = null;
  let drag = null;
  let pan = null;
  // Нажатие, которое ещё не решило, чем станет: клик занятия или панорама.
  // Решает это сдвиг руки, а решение принимается по отпусканию — ровно как на
  // холсте (дефект D23, «навигация должна быть как и у схемы»).
  let press = null;
  let hover = null;
  // Ручка правки под курсором: бледная ручка разбивки становится под рукой тем
  // самым квадратом, который встанет на её место (`render.drawPathHandles`).
  let hoverHandle = null;
  // Вершина, которую ручка поставила сию минуту: `{id, index, at}`. Нужна ровно
  // для того же, для чего холсту (`canvasFreshVertex`) — чтобы двойной клик по
  // ручке разбивки не убирал ту вершину, которую сам только что и поставил.
  let freshVertex = null;
  let streak = null;
  let frame = 0;
  // Зажатые стрелки и часы непрерывного хода.
  const panKeys = new Map();
  let panFrame = 0;
  let panClock = 0;
  let closed = false;
  // `null`, а не пустая строка: у объекта без комнат подпись списка — тоже
  // строка, и начни отметка с пустой, список не нарисовался бы ни разу.
  let roomsKey = null;
  const fingers = new Map();
  let pinch = null;

  // Полоса развёртки — тот же кирпич, что над основным холстом: сторона у них
  // общая (живёт в состоянии сеанса), и переключение в окне помнится, когда
  // окно закроют.
  const strip = createElevationStrip({
    onSide: (side) => setState({ wallSide: side }),
    onClose: () => select(null),
    onViews: (value) => {
      setState({ elevationViews: value });
      setSetting(ELEVATION_VIEWS_SETTING, value);
    },
    views: getState().elevationViews !== false,
  });
  const node = uiEl("canvas", { class: "workshop__canvas" });
  // Поле забирает фокус по нажатию: иначе после правки толщины фокус остаётся
  // в поле ввода, а Ctrl+Z там принадлежит браузеру — человек жмёт отмену над
  // чертежом и не получает ничего. То же правило, что у холста
  // (`canvasKeyboardOwner`): работают с чертежом — клавиатура его.
  const stage = uiEl("div", { class: "workshop__stage", attrs: { tabindex: "-1" } }, [node, strip.node]);
  const ctx = node.getContext ? node.getContext("2d") : null;

  // ——— левая часть: два уровня над полем ———
  //
  // Первый ряд отвечает на «чем я занят», второй — на «что добавляю», и второй
  // виден только в добавлении (таск 133, G184). Прежде оба вопроса отвечались
  // одним рядом кнопок, и первый в нём терялся: «Правку» заказчик не нашёл.
  const selectButton = uiButton(strings.workshop.modeSelect, {
    title: strings.workshop.modeSelectHint,
    on: { click: () => setMode("select") },
  });
  const addButton = uiButton(strings.workshop.modeAdd, {
    title: strings.workshop.modeAddHint,
    on: { click: () => setMode("add") },
  });
  // Порядок второго ряда — порядок работы, заданный заказчиком (G176): сперва
  // стены, потом проёмы, потом объекты.
  const wallsButton = uiButton(strings.workshop.toolWalls, {
    title: strings.workshop.toolWallsHint,
    on: { click: () => setAdding("walls") },
  });
  const openingsButton = uiButton(strings.workshop.toolOpenings, {
    title: strings.workshop.toolOpeningsHint,
    on: { click: () => setAdding("openings") },
  });
  const objectsButton = uiButton(strings.workshop.toolObjects, {
    title: strings.workshop.toolObjectsHint,
    on: { click: () => setAdding("objects") },
  });
  // Две плашки поверх поля, по общему правилу всех трёх режимов (G228):
  // **подсказка слева** со знаком «?» — про руки, **сводка справа** со знаком
  // «i» — про чертёж (размеры плана, счёт стен, проёмов и объектов). Обе
  // сворачиваются и помнят себя порознь; кирпич один на сборку
  // (`panels/plate.js`).
  const hintPlate = createFieldPlate({ side: "left", setting: WORKSHOP_HINT_SETTING });
  const summaryPlate = createFieldPlate({ side: "right", setting: WORKSHOP_SUMMARY_SETTING });

  // ——— правая часть: слои, сетка, стена, высоты ———
  const planCheck = uiEl("input", { type: "checkbox" });
  const gridCheck = uiEl("input", { type: "checkbox" });
  const wallsCheck = uiEl("input", { type: "checkbox" });
  const objectsCheck = uiEl("input", { type: "checkbox" });
  objectsCheck.addEventListener("change", () => {
    setState({ objectsShown: objectsCheck.checked });
    setSetting(OBJECTS_SETTING, objectsCheck.checked);
  });
  planCheck.addEventListener("change", () => {
    workshopLayers = { ...workshopLayers, plan: planCheck.checked };
    sync();
  });
  gridCheck.addEventListener("change", () => {
    workshopLayers = { ...workshopLayers, grid: gridCheck.checked };
    sync();
  });
  wallsCheck.addEventListener("change", () => {
    workshopLayers = { ...workshopLayers, walls: wallsCheck.checked };
    sync();
  });
  const planRow = workshopCheckRow(planCheck, strings.workshop.layerPlan);
  // Масштаб плана задаётся **в «Схемах»** (G227, слова заказчика: «Масштаб
  // убери, он в Схемах есть»). Кнопка рядом с погашенной отметкой подложки
  // осталась — она объясняет, почему подложки не видно, — но ведёт туда же,
  // куда «Масштаб: план …» в строке схемы: на план, где отрезок и меряют.
  // Второй двери к калибровке в сборке нет.
  const calibrateButton = uiButton(strings.workshop.calibrate, {
    class: "ui-btn ui-btn--wide",
    title: strings.workshop.calibrateHint,
    on: { click: () => calibrateOnPlan() },
  });
  const attachButton = uiButton(strings.workshop.attach, {
    class: "ui-btn ui-btn--wide",
    title: strings.workshop.attachHint,
    on: { click: () => attach() },
  });

  const gridSelect = uiEl("select", { class: "ui-input workshop__grid" });
  for (const step of WORKSHOP_GRID_STEPS_MM) {
    gridSelect.append(uiEl("option", { value: String(step), text: String(step) }));
  }
  gridSelect.addEventListener("change", () => {
    workshopGridMm = Number(gridSelect.value) || WORKSHOP_GRID_DEFAULT_MM;
    sync();
  });
  const snapCheck = uiEl("input", { type: "checkbox" });
  snapCheck.addEventListener("change", () => {
    workshopGridSnap = snapCheck.checked;
    sync();
  });

  // ——— одна колонка свойств на троих ———
  //
  // Групп в колонке было четыре, занятий стало три, и у каждого свои поля. Если
  // показывать все сразу, колонка вырастет вдвое и толщина стены будет висеть
  // над размерами двери. Поэтому группа одна, и её заголовок и поля меняются
  // вместе с тем, что делают: инструмент задаёт умолчания для нового, выделение
  // перебивает их свойствами выделенного. Это то же правило, по которому ещё в
  // таске 125 одно поле толщины служило и новым стенам, и выделенной.
  const subjectHead = uiEl("h4", { class: "workshop__head" });
  const subjectNote = uiEl("p", { class: "workshop__note" });

  const thicknessInput = workshopNumber(1, WALL_THICKNESS_MM_MAX);
  const thicknessLabel = uiEl("span", { class: "workshop__label" });
  workshopApply(thicknessInput, () => applyThickness());
  const wallFields = uiEl("div", { class: "workshop__fields" }, [
    uiEl("label", { class: "workshop__field" }, [thicknessLabel, thicknessInput]),
  ]);

  const kindButtons = OPENING_KINDS.map((kind) =>
    uiButton(strings.openingKinds[kind], {
      class: "ui-btn workshop__chip",
      on: { click: () => setOpeningKind(kind) },
    }),
  );
  const openingWidth = workshopNumber(1, DRAWING_MM_MAX);
  const openingHeight = workshopNumber(1, DRAWING_MM_MAX);
  const openingFloor = workshopNumber(0, DRAWING_MM_MAX);
  const openingAt = workshopNumber(0, DRAWING_MM_MAX);
  for (const input of [openingWidth, openingHeight, openingFloor, openingAt]) {
    workshopApply(input, () => applyOpeningFields());
  }
  const hingeButton = uiButton("", {
    class: "ui-btn ui-btn--wide",
    on: { click: () => flipDoor("hinge") },
  });
  const swingButton = uiButton("", {
    class: "ui-btn ui-btn--wide",
    on: { click: () => flipDoor("swing") },
  });
  const atField = workshopField(strings.workshop.openingAt, openingAt);
  const doorFields = uiEl("div", { class: "workshop__fields" }, [hingeButton, swingButton]);
  const openingFields = uiEl("div", { class: "workshop__fields" }, [
    uiEl("div", { class: "workshop__chips" }, kindButtons),
    workshopField(strings.workshop.openingWidth, openingWidth),
    workshopField(strings.workshop.openingHeight, openingHeight),
    workshopField(strings.workshop.openingFloor, openingFloor),
    atField,
    doorFields,
  ]);

  // Встроенный каталог: своих видов человек не заводит — заказчик решил это
  // прямо: «без кастомных для объектов, не усложняем».
  //
  // **Выбор вещи живёт в окне** (таск 170, G252): «механеику выбора для
  // добавления и изменения объекта сделай как для меток — в отдельном окне».
  // В колонке осталась плашка — картинка, имя и слово «Выбрать», — устроенная
  // как плашка типа метки в панели инструментов. Дверь одна на оба случая:
  // какую вещь поставить и какой стала выделенная. Что из двух сейчас, колонка
  // знает сама — по тому же правилу, по которому меняются её заголовок и поля.
  const thingIcon = uiEl("span", { class: "workshop__thingIcon" });
  const thingName = uiEl("span", { class: "workshop__thingName" });
  const thingButton = uiEl(
    "button",
    { class: "workshop__thing", type: "button", on: { click: () => chooseThing() } },
    [thingIcon, thingName, uiEl("span", { class: "workshop__thingPick", text: strings.workshop.objectPick })],
  );
  // Что нарисовано на плашке: картинку зря не перерисовываем — `sync` зовут на
  // каждое движение мыши по полю.
  let thingShown = null;
  // Три способа поставить объект, а не две формы (таск 137): прямоугольник
  // кликом по умолчаниям, он же контуром по месту, полоса цепочкой.
  const wayButtons = WORKSHOP_OBJECT_WAYS.map((way) =>
    uiButton(strings.workshop["way_" + way], {
      class: "ui-btn workshop__chip",
      title: strings.workshop["wayHint_" + way],
      on: { click: () => setObjectWay(way) },
    }),
  );
  const objectWidth = workshopNumber(1, DRAWING_MM_MAX);
  const objectDepth = workshopNumber(1, DRAWING_MM_MAX);
  const objectTurn = workshopNumber(0, 359);
  const objectHeight = workshopNumber(1, DRAWING_MM_MAX);
  const objectFloor = workshopNumber(0, DRAWING_MM_MAX);
  for (const input of [objectWidth, objectDepth, objectTurn, objectHeight, objectFloor]) {
    workshopApply(input, () => applyObjectFields());
  }
  const widthField = workshopField(strings.workshop.objectWidth, objectWidth);
  const depthField = workshopField(strings.workshop.objectDepth, objectDepth);
  const turnField = workshopField(strings.workshop.objectTurn, objectTurn);
  // Четверть оборота кнопкой — главный случай: вещь ставят к одной из четырёх
  // стен. Клавиша `R` названа в подсказке, а не отдельной строкой: горячий
  // ключ, о котором негде прочитать, всё равно что его нет.
  const turnLeftButton = uiButton(strings.workshop.objectTurnLeft, {
    class: "ui-btn workshop__chip",
    title: strings.workshop.objectTurnLeftHint,
    on: { click: () => turnBy(-WORKSHOP_TURN_STEP_DEG) },
  });
  const turnRightButton = uiButton(strings.workshop.objectTurnRight, {
    class: "ui-btn workshop__chip",
    title: strings.workshop.objectTurnRightHint,
    on: { click: () => turnBy(WORKSHOP_TURN_STEP_DEG) },
  });
  // Доворот к стене — **кнопка, а не притяжка** (таск 164): при постановке
  // вещь сама не поворачивается, см. `workshopWallTurnDeg`.
  const turnWallButton = uiButton(strings.workshop.objectToWall, {
    class: "ui-btn workshop__chip",
    title: strings.workshop.objectToWallHint,
    on: { click: () => turnToWall() },
  });
  const turnChips = uiEl("div", { class: "workshop__chips" }, [turnLeftButton, turnRightButton, turnWallButton]);
  const turnNote = uiEl("p", { class: "workshop__note", text: strings.workshop.objectTurnHint });
  // Где вещь стоит — на полу, на стене, в полу. Строка стоит над высотами и
  // отвечает ровно на вопрос «почему у картины от пола 1300, а у стола ноль».
  const objectMountNote = uiEl("p", { class: "workshop__note" });
  const objectFields = uiEl("div", { class: "workshop__fields" }, [
    thingButton,
    uiEl("div", { class: "workshop__chips" }, wayButtons),
    widthField,
    depthField,
    turnField,
    turnChips,
    turnNote,
    workshopField(strings.workshop.objectHeight, objectHeight),
    workshopField(strings.workshop.objectFloor, objectFloor),
    objectMountNote,
    uiEl("p", { class: "workshop__note", text: strings.workshop.objectHeightHint }),
  ]);

  const removeButton = uiButton(strings.workshop.remove, {
    class: "ui-btn ui-btn--danger ui-btn--wide",
    on: { click: () => removeSelected() },
  });

  const heightInput = workshopNumber(0, DRAWING_MM_MAX);
  heightInput.addEventListener("change", () => applySchemeHeight());
  heightInput.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    applySchemeHeight();
  });
  // Этажа здесь больше нет (таск 170, G254). Слова заказчика: «Этаж этой схемы
  // — вынеси из отдельного параметра вообще в параметры схемы». Поле стоит в
  // свойствах схемы (`panels/schemes.js`), где у неё правят имя и масштаб;
  // раздел «Схемы» виден во всех трёх режимах, и из чертежа до него один клик.
  const roomsList = uiEl("div", { class: "workshop__rooms" });

  const side = uiEl("div", { class: "workshop__side" }, [
    uiEl("div", { class: "workshop__group" }, [
      uiEl("h4", { class: "workshop__head", text: strings.workshop.layers }),
      planRow,
      calibrateButton,
      attachButton,
      workshopCheckRow(gridCheck, strings.workshop.layerGrid),
      workshopCheckRow(wallsCheck, strings.workshop.layerWalls, strings.workshop.layerWallsHint),
      workshopCheckRow(objectsCheck, strings.workshop.layerObjects),
    ]),
    uiEl("div", { class: "workshop__group" }, [
      uiEl("h4", { class: "workshop__head", text: strings.workshop.grid }),
      uiEl("label", { class: "workshop__field" }, [
        uiEl("span", { class: "workshop__label", text: strings.workshop.gridStep }),
        gridSelect,
      ]),
      workshopCheckRow(snapCheck, strings.workshop.gridSnap),
      uiEl("p", { class: "workshop__note", text: strings.workshop.gridSnapHint }),
    ]),
    uiEl("div", { class: "workshop__group" }, [
      subjectHead,
      wallFields,
      openingFields,
      objectFields,
      subjectNote,
      removeButton,
    ]),
    uiEl("div", { class: "workshop__group" }, [
      uiEl("h4", { class: "workshop__head", text: strings.workshop.height }),
      uiEl("label", { class: "workshop__field" }, [
        uiEl("span", { class: "workshop__label", text: strings.workshop.heightScheme }),
        heightInput,
      ]),
      uiEl("p", { class: "workshop__note", text: strings.workshop.heightHint }),
      uiEl("h4", { class: "workshop__head", text: strings.workshop.heightRooms }),
      uiEl("p", { class: "workshop__note", text: strings.workshop.heightRoomsHint }),
      roomsList,
    ]),
  ]);

  const addingRow = uiEl("div", { class: "workshop__tools workshop__tools--adding" }, [
    uiEl("span", { class: "workshop__toolsLabel", text: strings.workshop.adding }),
    wallsButton,
    openingsButton,
    objectsButton,
  ]);

  // ——— где что стоит (таск 153) ———
  //
  // Ряды занятий уехали в колонку вместе со свойствами: заказчик решил, что
  // правая панель своя в каждом режиме, а верхний блок левой меняется, — и
  // инструменты чертежа это и есть верхний блок. Над полем остаётся только то,
  // что над полем и было: подсказка слева, полный экран справа, а между ними
  // переключатель режимов.
  stage.append(hintPlate.node, summaryPlate.node);
  hosts.stage.replaceChildren(stage);
  hosts.side.replaceChildren(
    uiEl("div", { class: "workshop__panel" }, [
      // Ряд режимов: что делаю. Вид (масштаб и «Вписать») прижат вправо — он не
      // режим и стоять в одном ряду с ними как равный не должен.
      uiEl("div", { class: "workshop__tools" }, [
        uiEl("span", { class: "workshop__toolsLabel", text: strings.workshop.mode }),
        selectButton,
        addButton,
      ]),
      // Ряд «что добавляем»: виден только в добавлении — в остальных режимах
      // он отвечал бы на вопрос, которого человек не задавал.
      addingRow,
      side,
    ]),
  );
  const list = uiEl("div", { class: "workshop__list" });
  hosts.list.replaceChildren(list);
  let listKey = null;

  // ——— режим на экране ———
  //
  // Поверхность жива и в чужом режиме — она только погасла, — поэтому клавиши
  // и часы обязаны спрашивать, её ли сейчас экран. Правило то же, что у холста
  // (`canvasOnScreen`) и у объёма: кто показан, того и клавиатура. Диалог
  // забирает её у всех троих: пока стопка не пуста, клавиши принадлежат ему.
  function active() {
    return !closed && screenMode() === "drawing" && uiDialogDepth() === 0;
  }

  // ——— состояние объекта ———

  function project() {
    return getState().project;
  }

  // Вещи, спрятанные с экрана (таск 154, G223): их не рисуют, их нельзя взять
  // в поле и их не видно в объёме. Отметка живёт в сеансе и в настройках
  // браузера, а не в объекте.
  function hiddenObjects() {
    return new Set(getState().hiddenObjectIds);
  }

  function placement() {
    // Поворот подложки прибавляет к `turn` в любой момент (G178) — привязка
    // читается на каждом кадре и нигде не запоминается.
    return workshopPlacement(project(), schemeId);
  }

  function walls() {
    return wallsOnScheme(project(), schemeId);
  }

  function image() {
    const current = getState().schemeImage;
    const target = findScheme(project(), schemeId);
    if (!current || !target || current.schemeId !== schemeId || current.imageId !== target.imageId) return null;
    return current.image;
  }

  function fail(error) {
    notify(error && error.message ? error.message : String(error), "error");
  }

  function commit(after, label) {
    canvasCommit(project(), after, label, { schemeId });
  }

  // ——— масштаб и вид ———

  function viewport() {
    return { width: Math.max(1, stage.clientWidth), height: Math.max(1, stage.clientHeight) };
  }

  function zoomCeiling() {
    return WORKSHOP_ZOOM_MAX;
  }

  function fit() {
    view = workshopFitView(workshopExtentMm(project(), schemeId, placement()), viewport());
    sync();
  }

  /**
   * «100 %» для чертежа (G227): миллиметр чертежа — точка экрана.
   *
   * Тот же смысл, что у «100 %» на плане, где точка картинки равна точке
   * экрана: натуральная величина, видно не всё. Кадр при этом остаётся на
   * месте — середина поля показывает то же место чертежа, что и до нажатия.
   */
  function zoomReset() {
    const box = viewport();
    const middle = screenToPlan({ x: box.width / 2, y: box.height / 2 }, WORKSHOP_UNIT, view);
    view = { zoom: 1, offsetX: box.width / 2 - middle.x, offsetY: box.height / 2 - middle.y };
    sync();
  }

  /**
   * Уйти на план задавать масштаб (G227).
   *
   * Калибровка живёт в «Схемах» и делается по плану — значит, и показать надо
   * план: иначе человек жал бы кнопку, а отрезок меряли бы на поле, которого
   * в этот миг не видно.
   */
  function calibrateOnPlan() {
    setScreen(SCREEN_DEFAULT);
    canvasStartScale(schemeId);
  }

  function zoomAt(point, factor) {
    const zoom = workshopClampZoom(view.zoom * factor, zoomCeiling());
    const ratio = zoom / view.zoom;
    view = {
      zoom,
      offsetX: point.x - (point.x - view.offsetX) * ratio,
      offsetY: point.y - (point.y - view.offsetY) * ratio,
    };
    sync();
  }

  function zoomBy(factor) {
    const box = viewport();
    zoomAt({ x: box.width / 2, y: box.height / 2 }, factor);
  }

  function panBy(dx, dy) {
    view = { ...view, offsetX: view.offsetX + dx, offsetY: view.offsetY + dy };
    paint();
  }

  function pointOf(event) {
    const rect = node.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function mmOf(event) {
    return screenToPlan(pointOf(event), WORKSHOP_UNIT, view);
  }

  // Рука над полем, а не над колонкой: слушатель висит на окне, и события
  // приходят из любого его угла.
  function onField(event) {
    const at = pointOf(event);
    const box = viewport();
    return at.x >= 0 && at.y >= 0 && at.x <= box.width && at.y <= box.height;
  }

  function screenOf(pointMm) {
    return planToScreen(pointMm, WORKSHOP_UNIT, view);
  }

  function snapOf(pointMm, free) {
    return workshopSnapMm(draft ? draft.points : [], pointMm, view, {
      free,
      gridMm: workshopGridMm,
      gridSnap: workshopGridSnap,
    });
  }

  // ——— режимы и занятия ———
  //
  // Снаружи окна их два уровня, внутри — одно поле `tool`: `setMode` и
  // `setAdding` переводят выбор человека в него, `workshopModeOf` читает
  // обратно. Второго состояния рядом нет нарочно — иначе нашлась бы пара
  // «режим добавления, а добавлять нечего».

  function mode() {
    return workshopModeOf(tool);
  }

  function setMode(next) {
    setTool(workshopToolOf(next, workshopAdding));
  }

  // Что добавляем — помнится на сеанс, как толщина стен и шаг сетки: вернулся
  // в добавление — вернулся к тому же, чем рисовал, а не к стенам через раз.
  function setAdding(kind) {
    if (!WORKSHOP_ADDING.includes(kind)) return;
    workshopAdding = kind;
    setTool(kind);
  }

  function setTool(next) {
    if (tool === next) return;
    draft = null;
    ghost = null;
    objectGhost = null;
    press = null;
    // Выделение снимается вместе со сменой занятия: иначе поля выделенной
    // стены перебивали бы умолчания проёма, за которым человек и переключился.
    selected = null;
    tool = next;
    // Выделенная стена живёт и в состоянии сеанса: сняли выделение — полоса
    // развёртки над планом закрывается вместе с ним.
    if (getState().selectedWallId) setState({ selectedWallId: null });
    sync();
  }

  function select(next) {
    const same = Boolean(selected) === Boolean(next) && (!next || (selected.kind === next.kind && selected.id === next.id));
    if (same) return;
    selected = next;
    // Выделенная стена попадает и в состояние сеанса: выделение у чертежа и у
    // плана общее, и полоса развёртки выезжает по одному правилу на оба поля
    // (G227) — выделена стена, и галка «Развёртка выделенной стены» в
    // «Интерфейсе проекта» включена. Режима «Развёртка» для этого больше нет.
    const wallId = next && next.kind === "wall" ? next.id : null;
    if (getState().selectedWallId !== wallId) setState({ selectedWallId: wallId });
    sync();
  }

  function selectedWall() {
    return selected && selected.kind === "wall" ? findWall(project(), selected.id) : null;
  }

  function selectedOpening() {
    return selected && selected.kind === "opening" ? findOpening(project(), selected.id) : null;
  }

  function selectedObject() {
    return selected && selected.kind === "object" ? findSchemeObject(project(), selected.id) : null;
  }

  // Какой предмет сейчас в колонке свойств: выделенный, а без выделения — тот,
  // который поставит следующий клик. Отсюда и заголовок группы.
  function subject() {
    if (selected) return selected.kind;
    if (tool === "openings") return "opening";
    if (tool === "objects") return "object";
    return "wall";
  }

  function finishChain() {
    if (!draft) return;
    const points = draft.points;
    draft = null;
    if (points.length < 2) {
      sync();
      return;
    }
    try {
      const result = workshopAddChain(project(), schemeId, points, workshopThicknessMm);
      if (result.added === 0) {
        sync();
        return;
      }
      commit(result.project, strings.history.wallChain);
      notify(
        result.origin
          ? text("workshop.chainAdded", { count: result.added }) + " " + strings.workshop.originSet
          : text("workshop.chainAdded", { count: result.added }),
        "success",
      );
    } catch (error) {
      fail(error);
    }
    sync();
  }

  function applyThickness() {
    const value = Number(thicknessInput.value);
    const wall = selectedWall();
    if (!(value > 0)) {
      sync();
      return;
    }
    if (!wall) {
      workshopThicknessMm = Math.min(WALL_THICKNESS_MM_MAX, Math.round(value));
      sync();
      return;
    }
    if (Math.round(value) === wall.thicknessMm) return;
    try {
      commit(updateWall(project(), wall.id, { thicknessMm: value }).project, strings.history.wallThickness);
      workshopThicknessMm = Math.min(WALL_THICKNESS_MM_MAX, Math.round(value));
    } catch (error) {
      fail(error);
      sync();
    }
  }

  /**
   * Удаление выделенного — одной кнопкой на троих.
   *
   * **Стена уносит свои проёмы** (решение модели, таск 123: стену переставляют
   * десять раз за вечер, и возвращённое окно соврало бы в развёртке). Молча
   * этого делать нельзя: человек метит в стену, а теряет ещё и дверь. Поэтому
   * вопрос — и только когда проёмы в ней есть: пустая стена сносится сразу,
   * лишний вопрос на каждую стену раздражал бы.
   */
  async function removeSelected() {
    const wall = selectedWall();
    if (wall) {
      const inside = openingsInWall(project(), wall.id).length;
      if (inside > 0) {
        const agreed = await uiConfirm({
          title: strings.workshop.removeWallTitle,
          message: text("workshop.removeWallAsk", { count: inside }),
          confirmLabel: strings.workshop.remove,
        });
        if (!agreed) return;
        if (!findWall(project(), wall.id)) return;
      }
      runRemove(() => deleteWall(project(), wall.id).project, strings.history.wallRemove);
      return;
    }
    const opening = selectedOpening();
    if (opening) {
      runRemove(() => deleteOpening(project(), opening.id).project, strings.history.openingRemove);
      return;
    }
    const object = selectedObject();
    if (object) runRemove(() => deleteSchemeObject(project(), object.id).project, strings.history.objectRemove);
  }

  function runRemove(make, label) {
    try {
      const next = make();
      selected = null;
      commit(next, label);
    } catch (error) {
      fail(error);
    }
  }

  // ——— проёмы ———————————————————————————————————————————————————————————

  function openingDraft(kind) {
    const sizes = workshopOpeningSizes[kind] || WORKSHOP_OPENING_DEFAULTS[kind];
    const draftOpening = { kind, ...sizes };
    if (kind === OPENING_KIND_DOOR) {
      draftOpening.hinge = workshopDoorHinge;
      draftOpening.swing = workshopDoorSwing;
    }
    return draftOpening;
  }

  function setOpeningKind(kind) {
    const opening = selectedOpening();
    if (opening) {
      try {
        const patch = { kind, ...(kind === OPENING_KIND_DOOR ? { hinge: workshopDoorHinge, swing: workshopDoorSwing } : {}) };
        commit(updateOpening(project(), opening.id, patch).project, strings.history.openingKind);
      } catch (error) {
        fail(error);
        sync();
      }
      return;
    }
    workshopOpeningKind = kind;
    sync();
  }

  // Призрак под курсором: что встанет и встанет ли. Считается той же попыткой
  // записи, которой пойдёт клик, — значит красный призрак и отказ клика не
  // могут разойтись.
  function updateGhost(pointMm) {
    const pick = wallUnder(pointMm);
    if (!pick) {
      ghost = null;
      return;
    }
    const base = openingDraft(workshopOpeningKind);
    const atMm = workshopOpeningAt(pick.wall, pointMm, base.widthMm);
    const candidate = { wallId: pick.wall.id, atMm, ...base };
    const attempt = workshopTryOpening(project(), candidate, null);
    ghost = { wall: pick.wall, opening: candidate, ok: attempt.ok, message: attempt.ok ? "" : attempt.message };
  }

  function wallUnder(pointMm) {
    const list = walls();
    for (let index = list.length - 1; index >= 0; index -= 1) {
      const wall = list[index];
      const limit = Math.max(WORKSHOP_WALL_PX / view.zoom, Number(wall.thicknessMm) / 2);
      if (segmentDistanceMm(pointMm, wall.aMm, wall.bMm) <= limit) return { wall };
    }
    return null;
  }

  function placeOpening() {
    if (!ghost) return;
    if (!ghost.ok) {
      // Отказ уже назван строкой под полем и красным призраком — повторять его
      // плашкой на каждый промах мыши значит замучить человека.
      return;
    }
    const attempt = workshopTryOpening(project(), ghost.opening, null);
    if (!attempt.ok) {
      ghost.ok = false;
      ghost.message = attempt.message;
      sync();
      return;
    }
    // Поставленный проём **не выделяется**, и это поймано живым прогоном:
    // выделенный проём перехватывает кнопки видов — следующее нажатие «Дверь»
    // превращало в дверь только что поставленное окно вместо того, чтобы
    // выбрать, чем будет следующий клик. Человек ставит десять окон подряд, а
    // правит их потом и отдельным занятием — как и цепочку стен, которая себя
    // тоже не выделяет.
    commit(attempt.project, strings.history.openingAdd);
  }

  function applyOpeningFields() {
    const kind = selectedOpening() ? selectedOpening().kind : workshopOpeningKind;
    const sizes = {
      widthMm: Number(openingWidth.value),
      heightMm: Number(openingHeight.value),
      heightAboveFloorMm: Number(openingFloor.value),
    };
    if (!(sizes.widthMm > 0) || !(sizes.heightMm > 0) || !(sizes.heightAboveFloorMm >= 0)) {
      sync();
      return;
    }
    const opening = selectedOpening();
    if (!opening) {
      workshopOpeningSizes[kind] = sizes;
      sync();
      return;
    }
    const patch = { ...sizes, atMm: Number(openingAt.value) };
    const attempt = workshopTryOpening(project(), patch, opening.id);
    if (!attempt.ok) {
      // Набранное число — не движение мыши: призрака у него нет, и промолчать
      // здесь значило бы просто вернуть прежнее значение без объяснения.
      // Поэтому один отказ на одно нажатие Enter, плашкой.
      notify(attempt.message, "error");
      sync();
      return;
    }
    workshopOpeningSizes[kind] = sizes;
    commit(attempt.project, strings.history.openingEdit);
  }

  /**
   * Переключить створку двери. Четыре сочетания — четыре разные двери, и
   * различают их на плане по рисунку, а не по двум полям. Поэтому у выделенной
   * двери на чертеже стоят две ручки: у петли и на кончике полотна. Кнопки в
   * колонке делают то же самое словами — для тех, кто ищет глазами подпись.
   */
  function flipDoor(what) {
    const opening = selectedOpening();
    const flipHinge = (value) => (value === "end" ? "start" : "end");
    const flipSwing = (value) => (value === "right" ? "left" : "right");
    if (!opening || opening.kind !== OPENING_KIND_DOOR) {
      if (what === "hinge") workshopDoorHinge = flipHinge(workshopDoorHinge);
      else workshopDoorSwing = flipSwing(workshopDoorSwing);
      sync();
      return;
    }
    const patch =
      what === "hinge" ? { hinge: flipHinge(opening.hinge) } : { swing: flipSwing(opening.swing) };
    try {
      commit(updateOpening(project(), opening.id, patch).project, strings.history.openingSwing);
      workshopDoorHinge = patch.hinge || opening.hinge;
      workshopDoorSwing = patch.swing || opening.swing;
    } catch (error) {
      fail(error);
      sync();
    }
  }

  // ——— объекты на полу ——————————————————————————————————————————————————

  // Справочника видов вещь каталога больше не заводит (таск 154): её имя и
  // габариты лежат в сборке, а в объект пишется один ключ. Прежние виды в
  // чужом объекте при этом остаются на месте — ни одной записи их справочника
  // сборка не трогает (G68).
  function withSheet() {
    return workshopEnsureSheet(project(), schemeId).project;
  }

  /**
   * Открыть окно выбора вещи (таск 170, G252).
   *
   * Окно одно на оба случая — поставить новую и сменить у выделенной, — и
   * горит в нём та вещь, о которой сейчас речь. Заголовок разный нарочно: при
   * выделенной вещи человек правит стоящее на чертеже, и окно обязано сказать
   * это словом, а не промолчать.
   *
   * Серия из шести вещей подряд (кухня) переезда в окно боялась не зря, и
   * отвечено на это тремя вещами: в окне нет шага категории — все вещи стоят
   * сразу; выбранная залипает в плашке, и шесть одинаковых ставятся кликами
   * без диалога; поиск с Enter даёт путь без мыши (`objectPicker.js`).
   */
  async function chooseThing() {
    const object = selectedObject();
    const picked = await openObjectPicker({
      key: objectKey(object),
      title: object ? strings.workshop.objectChange : strings.objectPicker.title,
    });
    if (!picked) return;
    setObjectKey(picked);
  }

  function setObjectKey(key) {
    workshopObjectKey = key;
    workshopObjectSizes = keptTurn();
    const object = selectedObject();
    if (!object) {
      // Способ идёт за вещью: столешницу тянут полосой, радиатор набирают
      // прямоугольником — и спрашивать об этом отдельно незачем. Контур
      // умолчанием не бывает: обводить или набрать числами — это решение
      // человека, а не свойство радиатора.
      workshopObjectWay = workshopWayOfShape(workshopObjectDefaultsByKey(key).shape);
      sync();
      return;
    }
    // Выделенной вещи выбор меняет саму вещь: прежний вид из справочника
    // уходит вместе со своим полем, а имя на чертеже становится каталожным.
    //
    // Выбрали ту же самую — шага истории не будет: пустая правка в стеке
    // отмены стоила бы человеку одного Ctrl+Z впустую (то же правило, что у
    // «К стене»). У вещи прежней разметки `catalogKey` нет вовсе, и выбор её
    // же ключа — настоящая правка: вид справочника уступает место каталогу.
    if (object.catalogKey === key) return;
    try {
      commit(updateSchemeObject(project(), object.id, { catalogKey: key }).project, strings.history.objectEdit);
    } catch (error) {
      fail(error);
      sync();
    }
  }

  /**
   * Угол переживает смену вещи и способа, размеры — нет (таск 164).
   *
   * Угол принадлежит **стене, которую обставляют**, а не вещи: вдоль одной
   * стены подряд ставят шесть предметов — унитаз, раковину, стиральную машину,
   * — и спрашивать «а под каким углом» шесть раз значило бы спрашивать одно и
   * то же. Размеры, наоборот, у каждой вещи свои и возвращаются к каталожным.
   * Спрятанным состоянием это не становится: угол стоит числом в колонке и
   * нарисован призраком под рукой.
   */
  function keptTurn() {
    const turnDeg = workshopTurnDeg(workshopObjectSizes.turnDeg);
    return turnDeg ? { turnDeg } : {};
  }

  // Способ ставить объект: кликом по умолчаниям, обводкой контура или полосой.
  // Размеры сбрасываются к умолчаниям вида: контур их посчитает сам, а клик
  // возьмёт те, что у вида, — донашивать за контуром чужую ширину незачем.
  function setObjectWay(way) {
    if (selectedObject() || !WORKSHOP_OBJECT_WAYS.includes(way)) return;
    workshopObjectWay = way;
    workshopObjectSizes = keptTurn();
    draft = null;
    // Призрак принадлежит клику, а не росчерку: сменили способ — он уходит.
    // Иначе он остался бы под рукой с прежним габаритом и обещал бы клик там,
    // где теперь обводят контур.
    objectGhost = null;
    sync();
  }

  function objectWay() {
    const object = selectedObject();
    return object ? workshopWayOfShape(object.shape) : workshopObjectWay;
  }

  // Рисуется ли объект росчерком — полосой или контуром. Клик по умолчаниям
  // росчерка не ведёт: он ставит вещь целиком с первого нажатия.
  function objectDrawn() {
    return tool === "objects" && workshopObjectWay !== "rect";
  }

  // Ключ той вещи, о которой сейчас речь: у выделенной — её собственный (у
  // прежней выведенный из имени), без выделения — выбранный плиткой.
  function objectKey(object) {
    return object ? schemeObjectKeyOf(project(), object) : workshopObjectKey;
  }

  // Умолчания берутся у каталога по ключу. Поправленное руками старше
  // умолчаний — `workshopObjectSizes` ложится сверху и живёт до смены вещи.
  function objectSizes(object) {
    const defaults = workshopObjectDefaultsByKey(objectKey(object));
    return { ...defaults, ...workshopObjectSizes, shape: workshopShapeOfWay(workshopObjectWay) };
  }

  /**
   * Призрак вещи под рукой: что встанет по клику. `null` — ставят росчерком
   * (полоса, контур), и призрак там свой — сама линия под рукой.
   */
  function objectGhostAt(pointMm) {
    const sizes = objectSizes(null);
    if (sizes.shape !== "rect") return null;
    const rect = workshopObjectRectAt(sizes, pointMm);
    // Высоты — ради подписи (таск 168): имя вещи на чертеже идёт с её верхом
    // над полом («Радиатор · верх 650 мм»), и верх считается из высоты и
    // посадки. Без них призрак подписался бы короче, чем подпишется вещь, —
    // то есть снова обещал бы не то. В саму постановку они идут своим путём,
    // `placeObject`: `workshopObjectRectAt` остаётся дверью для габарита.
    return rect && { ...rect, heightMm: sizes.heightMm, heightAboveFloorMm: sizes.heightAboveFloorMm };
  }

  /**
   * Поставить объект. `rect` — габарит, посчитанный контуром; без него
   * прямоугольник берёт размеры у вида (умолчания G192 остаются: контур — это
   * второй способ, а не замена первому).
   */
  function placeObject(pointMm, pointsMm, rect) {
    const ready = withSheet();
    const sizes = objectSizes(null);
    const fields = rect
      ? { shape: "rect", ...rect }
      : sizes.shape === "polyline"
        ? { shape: "polyline", pointsMm, depthMm: sizes.depthMm }
        : // Та же дверь, из которой нарисован призрак под рукой: что показано,
          // то и встало — вместе с углом (таск 164).
          workshopObjectRectAt(sizes, pointMm);
    try {
      const added = addSchemeObject(ready, {
        schemeId,
        catalogKey: workshopObjectKey,
        heightMm: sizes.heightMm,
        heightAboveFloorMm: sizes.heightAboveFloorMm,
        ...fields,
      });
      // Как и проём, поставленный объект себя не выделяет: иначе выбор вещи в
      // колонке стал бы правкой только что поставленной.
      commit(added.project, strings.history.objectAdd);
      return added.schemeObject;
    } catch (error) {
      fail(error);
      return null;
    }
  }

  /**
   * Повернуть на четверть оборота (таск 164): выделенную вещь — правкой через
   * историю, а без выделения — ту, которая встанет следующей. Одна дверь на
   * кнопки и на клавишу `R`.
   *
   * Полоса поворота не имеет — у неё форма задана точками, и кнопки ей
   * недоступны (`syncObject` их гасит).
   */
  function turnBy(deltaDeg) {
    const object = selectedObject();
    if (object) {
      if (object.shape === "polyline") return;
      try {
        commit(
          updateSchemeObject(project(), object.id, { turnDeg: workshopTurnBy(object.turnDeg, deltaDeg) }).project,
          strings.history.objectTurn,
        );
      } catch (error) {
        fail(error);
        sync();
      }
      return;
    }
    if (objectSizes(null).shape === "polyline") return;
    workshopObjectSizes = {
      ...workshopObjectSizes,
      turnDeg: workshopTurnBy(objectSizes(null).turnDeg, deltaDeg),
    };
    sync();
  }

  /**
   * Довернуть выделенную вещь спинкой к ближайшей стене. Притяжки при
   * постановке нет нарочно (`workshopWallTurnDeg`): человек ставит и под углом,
   * и правило «рядом стена — значит повернуть» спорило бы с его числом.
   *
   * Стены рядом нет — сказано словами: молчащая кнопка выглядит сломанной.
   */
  function turnToWall() {
    const object = selectedObject();
    if (!object || object.shape === "polyline") return;
    const turnDeg = workshopWallTurnDeg(walls(), object);
    if (turnDeg === null) {
      notify(strings.workshop.objectNoWall, "error");
      return;
    }
    // Уже стоит спинкой — шага истории не будет: пустая правка в стеке отмены
    // стоила бы человеку одного Ctrl+Z впустую.
    if (turnDeg === workshopTurnDeg(object.turnDeg)) return;
    try {
      commit(updateSchemeObject(project(), object.id, { turnDeg }).project, strings.history.objectTurn);
    } catch (error) {
      fail(error);
      sync();
    }
  }

  function applyObjectFields() {
    const sizes = {
      widthMm: Number(objectWidth.value),
      depthMm: Number(objectDepth.value),
      turnDeg: Number(objectTurn.value) || 0,
      heightMm: objectHeight.value === "" ? null : Number(objectHeight.value),
      heightAboveFloorMm: Number(objectFloor.value) || 0,
    };
    const object = selectedObject();
    if (!object) {
      workshopObjectSizes = sizes;
      sync();
      return;
    }
    const patch = {
      depthMm: sizes.depthMm,
      heightMm: sizes.heightMm,
      heightAboveFloorMm: sizes.heightAboveFloorMm,
    };
    if (object.shape === "rect") {
      patch.widthMm = sizes.widthMm;
      patch.turnDeg = sizes.turnDeg;
    }
    try {
      commit(updateSchemeObject(project(), object.id, patch).project, strings.history.objectEdit);
    } catch (error) {
      fail(error);
      sync();
    }
  }

  function applySchemeHeight() {
    try {
      const result = setSchemeWallHeight(project(), schemeId, heightInput.value);
      if (!result.changed) return;
      commit(result.project, strings.history.wallHeight);
    } catch (error) {
      fail(error);
      sync();
    }
  }

  function applyRoomHeight(roomId, value) {
    try {
      const result = setRoomWallHeight(project(), roomId, value);
      if (!result.changed) return;
      commit(result.project, strings.history.roomWallHeight);
    } catch (error) {
      fail(error);
      sync();
    }
  }

  function attach() {
    try {
      commit(workshopAttachOrigin(project(), schemeId).project, strings.history.planOrigin);
      notify(strings.workshop.originSet, "success");
      // Подложка только что появилась в кадре — вписываем заново, иначе чертёж
      // остался бы в прежнем масштабе, а план ушёл за край поля.
      fit();
    } catch (error) {
      fail(error);
    }
  }

  // ——— указатель ———
  //
  // **Рука — холстовая** (дефект D23, слова заказчика: «навигация должна быть
  // как и у схемы»). Главное в ней не набор кнопок, а правило: любой жест,
  // который поехал, — это панорама, а действие занятия случается по
  // **отпусканию** и только если рука не поехала. На холсте так ведут себя и
  // рисование ломаной, и обводка помещения, и калибровка (`canvasDrag.kind`
  // попадает в список панорамы), и поэтому план там возится из любого режима
  // одной левой кнопкой.
  //
  // Прежде окно ставило вершину на **нажатии**, и подвинуть вид было нечем:
  // перетаскивание левой рисовало, а первое касание пальцем сажало вершину
  // раньше, чем второй палец успевал начать щипок. Отсюда и дефект.

  stage.addEventListener("pointerdown", (event) => {
    if (event.pointerType === "touch") {
      fingers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (fingers.size === 2) {
        drag = null;
        pan = null;
        // Нажатие первого пальца ещё не стало действием — и не станет: два
        // пальца пришли возить и приближать. Без этого щипок оставлял за
        // собой вершину, поставленную первым касанием.
        press = null;
        pinch = gesturePinchOf(fingers.values());
        event.preventDefault();
        return;
      }
      if (fingers.size > 2) return;
    }
    if (event.button !== 0 && event.button !== 1) return;
    event.preventDefault();
    if (typeof stage.focus === "function") stage.focus({ preventScroll: true });
    // Средняя кнопка и Shift просят панораму прямо, без разбора: ими её и
    // просят. Остаются ради привычки — на холсте так же (там ещё и пробел).
    if (event.button === 1 || event.shiftKey) {
      pan = { x: event.clientX, y: event.clientY };
      return;
    }
    // Правка: если под рукой что-то есть — берём его, и дальше это
    // перетаскивание, а не панорама. Пусто — жест решится по отпусканию.
    if (tool === "edit") {
      const pick = workshopPick(project(), schemeId, mmOf(event), view, selected, hiddenObjects());
      if (pick) {
        grab(pick, event);
        return;
      }
    }
    // Всё остальное — нажатие без решения: поехала рука — панорама, не поехала
    // — клик занятия.
    // Палец помечается здесь: мерка «поехал» у него своя, а спросить
    // `pointerType` потом будет негде — движение приходит с окна.
    press = { x: event.clientX, y: event.clientY, touch: event.pointerType === "touch" };
  });

  // Что берёт «Правка» под руку. Ручки створки ничего не таскают — они
  // переключают дверь по нажатию: перетаскиванием дверь не «приоткроешь», у
  // неё четыре положения, а не непрерывный угол.
  function grab(pick, event) {
    if (pick.kind === "hinge" || pick.kind === "swing") {
      flipDoor(pick.kind);
      return;
    }
    select(workshopSelectionOf(pick));
    drag = {
      kind: pick.kind,
      id: pick.id,
      wallId: pick.wallId,
      atMm: pick.atMm,
      fromMm: pick.atMm,
      startMm: mmOf(event),
      start: { x: event.clientX, y: event.clientY, touch: event.pointerType === "touch" },
      moved: false,
    };
    // Ручка пути: место, где она стоит, уже и есть ответ — клик по ней без
    // движения ставит вершину туда, где её нарисовали. Ровно так ведёт себя
    // холст (`canvasPathAddCommit` берёт точку нажатия, если рука не поехала).
    if (pick.kind === "objectHandle") {
      drag.handle = pick.handle;
      drag.toMm = workshopRoundMm(screenToPlan({ x: pick.handle.x, y: pick.handle.y }, WORKSHOP_UNIT, view));
    }
  }

  /**
   * Клик занятия: рука не поехала, и жест оказался не панорамой.
   *
   * Точка берётся из события отпускания, а не нажатия: разошлись они не больше
   * чем на мерку «рука поехала» (`workshopHandMoved`) — иначе этот путь бы и не
   * вызвался, —
   * и притяжка всё равно ставит вершину в узел или на ровный угол.
   */
  function tap(event) {
    if (tool === "walls") {
      addVertex(event);
      return;
    }
    // Проём ставится **в готовую стену** (G176): человек показывает на стену,
    // проём садится серединой под курсор. Отдельной фигуры рядом со стеной не
    // бывает — проём живёт в стене и нигде больше (ADR 008).
    if (tool === "openings") {
      updateGhost(mmOf(event));
      placeOpening();
      return;
    }
    if (tool === "objects") {
      // Три способа, и первый клик у каждого свой: полоса и контур начинают
      // росчерк, прямоугольник ставится целиком по умолчаниям вида (G192).
      if (objectDrawn()) addVertex(event);
      // Точка — у призрака (таск 168): он её показал, и до полуметра расхождения
      // между показанным и вставшим набиралось на одной дрогнувшей руке
      // (`workshopPlacePointMm`).
      else placeObject(workshopPlacePointMm(objectGhost, event.altKey, snapOf(mmOf(event), event.altKey).point), null);
      return;
    }
    // «Правка» по пустому месту снимает выделение — как клик по пустому месту
    // на холсте. Взятое под руку сюда не доходит: оно ушло в `drag`.
    select(null);
  }

  function addVertex(event) {
    const snap = snapOf(mmOf(event), event.altKey);
    if (!draft) {
      draft = { points: [snap.point], cursor: snap.point, snap };
      paint();
      return;
    }
    // Клик по концевой вершине ничего не добавляет: это первая половина двойного
    // клика, которым росчерк заканчивают. Разбор общий с планом
    // (`gestureDraftClick`, таск 167) — и порог тот же, в экранных пикселях:
    // попасть в вершину миллиметр в миллиметр нельзя.
    const kind = gestureDraftClick(draft.points.map(screenOf), pointOf(event), WORKSHOP_VERTEX_PX);
    if (kind === "last") return;
    // Контуру отказывается и по первой вершине: замыкают его двойным кликом, как
    // ломаную метки. Открытому росчерку — цепочке стен, полосе — клик в первую
    // вершину, наоборот, нужен: кольцо он замыкает повтором точки, отметки
    // «замкнуто» у него нет.
    if (kind === "first" && workshopObjectWay === "contour" && tool === "objects") return;
    draft.points.push(snap.point);
    draft.cursor = snap.point;
    draft.snap = snap;
    paint();
  }

  stage.addEventListener("dblclick", (event) => {
    event.preventDefault();
    if (tool === "walls") {
      finishChain();
      return;
    }
    // Правка: двойной клик по вершине полосы её убирает — как двойной клик по
    // вершине ломаной метки на холсте.
    if (tool === "edit") {
      dropObjectVertex(event);
      return;
    }
    if (tool !== "objects" || !draft) return;
    if (workshopObjectWay === "polyline") {
      finishBand();
      return;
    }
    // Контур заканчивается тем же двойным кликом, что ломаная метки на плане
    // (таск 167): по первой вершине — замкнут, и вещь встаёт; в стороне от
    // концов — просто две вершины, рисование продолжается.
    const end = gestureDraftEnd(draft.points.map(screenOf), pointOf(event), WORKSHOP_VERTEX_PX);
    if (end === "none") return;
    if (end === "close") {
      finishContour();
      return;
    }
    // Остаётся «закончить незамкнутым» — двойной клик по последней вершине. У
    // контура такого ответа нет: незамкнутый контур вещью не становится (G193).
    // Терять за это четыре клика человеку незачем — черновик остаётся на поле,
    // сказано только, чего не хватает.
    notify(strings.workshop.contourOpen, "error");
  });

  // Полоса объекта — тот же росчерк, что цепочка стен, только кончается одним
  // объектом с шириной полосы, а не чередой отрезков: кухонный фронт идёт по
  // стене с поворотом, а глубина у него одна.
  function finishBand() {
    if (!draft) return;
    const points = draft.points;
    draft = null;
    if (points.length < 2) {
      sync();
      return;
    }
    placeObject(null, points);
    sync();
  }

  /**
   * Замкнуть контур — и получить прямоугольник (G193).
   *
   * Габарит считает `workshopRectFromContour` — **та же функция**, что рисует
   * призрак под рукой: что показано, то и записано. Контур, из которого
   * прямоугольника не выходит (меньше трёх вершин, все вершины на одной линии),
   * черновик не теряет: сказано, чего не хватает.
   *
   * Посчитанные размеры уходят в умолчания сеанса — тогда они **видны в
   * колонке** сразу, тем же порядком, каким в окне помнится толщина стен и
   * размер окна: поправил окно на 1300 — следующее окно встанет 1300.
   */
  function finishContour() {
    if (!draft) return;
    const rect = workshopRectFromContour(draft.points);
    if (!rect) {
      notify(strings.workshop.contourFlat, "error");
      return;
    }
    draft = null;
    const added = placeObject(null, null, rect);
    if (added) {
      workshopObjectSizes = {
        ...workshopObjectSizes,
        widthMm: rect.widthMm,
        depthMm: rect.depthMm,
        turnDeg: rect.turnDeg,
      };
      notify(text("workshop.contourAdded", { width: rect.widthMm, depth: rect.depthMm }), "success");
    }
    sync();
  }

  function onPointerMove(event) {
    if (closed) return;
    if (fingers.has(event.pointerId)) {
      fingers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pinch && fingers.size >= 2) {
        // Тот же `gestures.js`, что у колеса, и тот же порядок, что на плане:
        // масштаб вокруг новой середины, затем сдвиг на её ход.
        const step = gesturePinchStep(pinch, fingers.values());
        const rect = node.getBoundingClientRect();
        zoomAt({ x: step.pinch.center.x - rect.left, y: step.pinch.center.y - rect.top }, step.factor);
        panBy(step.panX, step.panY);
        pinch = step.pinch;
        return;
      }
    }
    // Нажатие, которое поехало, становится панорамой — и дальше ведёт её
    // обычная ветка. Отсчёт идёт от точки нажатия, а не от этого события:
    // иначе первые три пикселя терялись бы и план отставал от руки.
    if (press) {
      if (!workshopHandMoved(press, { x: event.clientX, y: event.clientY })) return;
      pan = { x: press.x, y: press.y };
      press = null;
    }
    if (pan) {
      panBy(event.clientX - pan.x, event.clientY - pan.y);
      pan = { x: event.clientX, y: event.clientY };
      return;
    }
    if (drag) {
      // Тап пальцем по стене её не двигает: мерка пальцевая, и четыре точки
      // дрожи остаются тапом, а не шагом «перенос стены» в истории.
      if (!drag.moved && !workshopHandMoved(drag.start, { x: event.clientX, y: event.clientY })) return;
      drag.moved = true;
      dragTo(event);
      return;
    }
    if (tool === "walls" || objectDrawn()) {
      // Предпросмотра до первого клика нет — как и на холсте: тянуть резинку
      // не от чего.
      if (!draft) return;
      const snap = snapOf(mmOf(event), event.altKey);
      draft.cursor = snap.point;
      draft.snap = snap;
      redraw();
      return;
    }
    if (tool === "openings") {
      const before = ghost ? ghost.opening.wallId + ":" + ghost.opening.atMm + ":" + ghost.ok : "";
      updateGhost(mmOf(event));
      const after = ghost ? ghost.opening.wallId + ":" + ghost.opening.atMm + ":" + ghost.ok : "";
      if (before !== after) {
        // Причина отказа живёт в строке под полем, а не в плашке: курсор ходит
        // по стене десятками шагов в секунду, и плашка на каждый шаг была бы
        // не предупреждением, а помехой.
        subjectNote.textContent = ghost && !ghost.ok ? ghost.message : openingHelp();
        subjectNote.classList.toggle("is-bad", Boolean(ghost && !ghost.ok));
        redraw();
      }
      return;
    }
    // Что встанет по клику — видно до клика (таск 164): призрак идёт за рукой с
    // теми размерами и тем углом, которые стоят в колонке. Росчерк сюда не
    // доходит — полосу и контур рисуют на глазах, и обещать там нечего.
    if (tool === "objects") {
      // Рука ушла с поля (курсор в колонке) — призрака нет: рисовать вещь там,
      // куда клик её не поставит, значило бы обещать невозможное.
      const next = onField(event) ? snapOf(mmOf(event), event.altKey).point : null;
      const was = objectGhost && objectGhost.pointMm;
      const moved = Boolean(next) !== Boolean(was) || (next && was && (next.x !== was.x || next.y !== was.y));
      objectGhost = next ? { pointMm: next, free: Boolean(event.altKey) } : null;
      if (moved) redraw();
      return;
    }
    const pick = workshopPick(project(), schemeId, mmOf(event), view, selected, hiddenObjects());
    const handle = pick && pick.kind === "objectHandle" ? pick.handle : null;
    const next = pick ? pick.kind + ":" + pick.id + ":" + (handle ? handle.kind + handle.index : "") : null;
    if (next !== hover) {
      hover = next;
      hoverHandle = handle;
      node.style.cursor = !pick
        ? "default"
        : pick.kind === "vertex" || (handle && (handle.kind === "vertex" || handle.kind === "turn"))
          ? "grab"
          : pick.kind === "hinge" || pick.kind === "swing" || handle
            ? "pointer"
            : "move";
      // Ручка под рукой меняет рисунок — бледный «плюс» становится квадратом
      // будущей вершины. Кадр поэтому перерисовывается, а не только курсор.
      redraw();
    }
  }

  // Правка идёт одним шагом на всё перетаскивание: промежуточные кадры рисуются
  // из предпросмотра, а в объект уходит только то место, где руку отпустили.
  // Иначе стек отмены набивался бы сотней шагов за одно движение мыши.
  function dragTo(event) {
    // Проём ездит **вдоль своей стены** и никуда больше: из стены он не
    // выходит, а поперёк её у него нет свободы — он в ней и живёт.
    if (drag.kind === "opening") {
      const opening = findOpening(project(), drag.id);
      const wall = opening ? findWall(project(), opening.wallId) : null;
      if (wall) drag.atMm = workshopOpeningAt(wall, mmOf(event), opening.widthMm);
      redraw();
      return;
    }
    // Ручка объекта: притяжка та же, что у правки ломаной на холсте — опора
    // соседняя вершина, сама с собой правимая не выравнивается
    // (`workshopPathSources`).
    if (drag.kind === "objectHandle") {
      const object = findSchemeObject(project(), drag.id);
      // Ручка поворота ходит по кругу, и притягивать её к узлам сетки не к
      // чему: у поворота свой шаг — 15°, и считает его `workshopTurnToward`
      // по той же примете `free`, что и вершина (зажатый Alt).
      if (object && drag.handle.kind === "turn") {
        drag.toMm = mmOf(event);
        drag.free = event.altKey;
        redraw();
        return;
      }
      if (object) {
        const points =
          object.shape === "polyline" ? object.pointsMm || [] : schemeObjectCorners(object);
        const anchor = workshopPathAnchor(points, drag.handle);
        drag.toMm = workshopSnapMm(
          workshopPathSources(points, anchor.anchorIndex, anchor.skipIndex),
          mmOf(event),
          view,
          { free: event.altKey, gridMm: workshopGridMm, gridSnap: workshopGridSnap },
        ).point;
      }
      redraw();
      return;
    }
    const snap = workshopSnapMm(
      drag.kind === "vertex" ? vertexAnchor(drag) : [],
      mmOf(event),
      view,
      { free: event.altKey, gridMm: workshopGridMm, gridSnap: workshopGridSnap },
    );
    if (drag.kind === "vertex") drag.toMm = snap.point;
    else drag.deltaMm = workshopRoundMm({ x: snap.point.x - drag.startMm.x, y: snap.point.y - drag.startMm.y });
    redraw();
  }

  // Объект едет целиком: у прямоугольника двигается середина, у полосы — все
  // её вершины. Поворот при этом не трогается — вещь переставили, а не
  // повернули.
  function movedObject(object, deltaMm) {
    const patch =
      object.shape === "polyline"
        ? { pointsMm: (object.pointsMm || []).map((point) => ({ x: point.x + deltaMm.x, y: point.y + deltaMm.y })) }
        : { atMm: { x: object.atMm.x + deltaMm.x, y: object.atMm.y + deltaMm.y } };
    return updateSchemeObject(project(), object.id, patch).project;
  }

  /**
   * Записать правку объекта за ручку — **тем же патчем**, которым рисовался
   * предпросмотр (`workshopObjectPatch`). Одной правкой на весь жест: стек
   * отмены не набивается кадрами, и Ctrl+Z возвращает место, где была вещь до
   * того, как за неё взялись.
   */
  function applyObjectHandle(current) {
    const object = findSchemeObject(project(), current.id);
    const patch = object ? workshopObjectPatch(object, current.handle, current.toMm, { free: current.free }) : null;
    if (!patch) {
      sync();
      return;
    }
    const label =
      current.handle.kind === "turn"
        ? strings.history.objectTurn
        : object.shape === "polyline"
          ? strings.history.objectPoint
          : strings.history.objectResize;
    try {
      commit(updateSchemeObject(project(), object.id, patch).project, label);
      // Вершина, поставленная только что этой же рукой: двойной клик по ней
      // ничего не убирает (та же оговорка, что у холста). Ручка поворота
      // вершин не ставит — ей здесь нечего помнить.
      if (current.handle.kind === "insert" || current.handle.kind === "extend") {
        freshVertex = { id: object.id, index: addedIndex(object, current.handle), at: panNow() };
      }
    } catch (error) {
      fail(error);
      sync();
    }
  }

  // Куда встала новая вершина: разбивка садится сразу за своим отрезком,
  // продолжение — в голову или в хвост списка (`canvasAddedIndex` у холста).
  function addedIndex(object, handle) {
    if (handle.kind === "extend") return handle.end === "start" ? 0 : (object.pointsMm || []).length;
    return handle.index + 1;
  }

  /**
   * Двойной клик по вершине полосы её убирает — тот же жест, что у ломаной
   * метки на холсте. Полосу короче двух вершин не оставляем не потому, что
   * здесь проверка, а потому что её не примет модель: слова отказа её же.
   */
  function dropObjectVertex(event) {
    const object = selectedObject();
    if (!object || object.shape !== "polyline") return;
    const handle = hitPathHandle(workshopObjectHandles(object, view), pointOf(event));
    if (!handle || handle.kind !== "vertex") return;
    if (
      freshVertex &&
      freshVertex.id === object.id &&
      freshVertex.index === handle.index &&
      panNow() - freshVertex.at < CANVAS_FRESH_VERTEX_MS
    ) {
      return;
    }
    const pointsMm = workshopPointsRemove(object.pointsMm, handle.index);
    if (!pointsMm) return;
    try {
      commit(
        updateSchemeObject(project(), object.id, { pointsMm }).project,
        strings.history.objectPoint,
      );
    } catch (error) {
      fail(error);
    }
  }

  // Якорь для магнита угла при переносе вершины — противоположный конец той
  // стены, за которую взялись: ровную стену тянут за угол, и 15° отмеряются от
  // её же второго конца.
  function vertexAnchor(current) {
    const wall = walls().find((item) => item.id === current.wallId);
    if (!wall) return [];
    const same = wall.aMm.x === current.fromMm.x && wall.aMm.y === current.fromMm.y;
    return [same ? wall.bMm : wall.aMm];
  }

  function onPointerEnd(event) {
    if (fingers.has(event.pointerId)) {
      fingers.delete(event.pointerId);
      if (fingers.size < 2) pinch = null;
    }
    pan = null;
    // Нажатие, которое так и не поехало, — клик занятия. Отмена жеста
    // (`pointercancel`: палец увели за край, система забрала указатель)
    // действием не считается: холст решает так же.
    const pressed = press;
    press = null;
    if (pressed && !drag) {
      if (event.type !== "pointercancel") tap(event);
      return;
    }
    if (!drag) return;
    const current = drag;
    drag = null;
    if (!current.moved) {
      // Ручка разбивки и ручка продолжения срабатывают и без движения: клик по
      // ним ставит вершину туда, где они нарисованы. Вершину, наоборот,
      // нажатием на месте не правят — её тащат.
      //
      // Ручка поворота отвечает на клик четвертью оборота — тем же, чем на него
      // отвечает ручка подписи метки (`canvasRotateLabel`), и тем же, что
      // кнопка «+90°» и клавиша `R` (таск 168, G250). Прежде она молчала,
      // потому что «клик свернул бы угол к ближайшим 15°», — но сворачивать
      // ничего и не надо: четверть оборота это названный шаг от нынешнего
      // угла, а не притяжка. Shift — против часовой, как у `R`.
      const adds = current.kind === "objectHandle" && (current.handle.kind === "insert" || current.handle.kind === "extend");
      if (adds) applyObjectHandle(current);
      else if (current.kind === "objectHandle" && current.handle.kind === "turn") {
        turnBy(event.shiftKey ? -WORKSHOP_TURN_STEP_DEG : WORKSHOP_TURN_STEP_DEG);
      } else paint();
      return;
    }
    try {
      if (current.kind === "objectHandle") {
        applyObjectHandle(current);
      } else if (current.kind === "vertex" && current.toMm) {
        const result = workshopMoveVertex(project(), schemeId, current.fromMm, current.toMm);
        if (result.moved > 0) commit(result.project, strings.history.wallVertex);
      } else if (current.kind === "wall" && current.deltaMm) {
        const result = workshopMoveWall(project(), current.wallId, current.deltaMm);
        if (result.moved) commit(result.project, strings.history.wallMove);
      } else if (current.kind === "opening" && current.atMm !== null && current.atMm !== undefined) {
        const attempt = workshopTryOpening(project(), { atMm: current.atMm }, current.id);
        if (attempt.ok) commit(attempt.project, strings.history.openingMove);
        else notify(attempt.message, "error");
      } else if (current.kind === "object" && current.deltaMm) {
        const object = findSchemeObject(project(), current.id);
        if (object) commit(movedObject(object, current.deltaMm), strings.history.objectMove);
      }
    } catch (error) {
      fail(error);
    }
    sync();
  }

  stage.addEventListener(
    "wheel",
    (event) => {
      // Колесо, трекпад и щипок разбирает `gestures.js` — то же правило, что на
      // плане и в окне загрузки плана: одно и то же колесо в трёх местах
      // приложения не должно делать разного.
      //
      // Прежде здесь `pan` молча отбрасывался, и двухпальцевый скролл трекпада
      // чертёж не листал: «На виде Схема можно двигать полоно 2 пальцами, а на
      // Чертеже нет» (G241). Теперь листает — тем же ходом и в ту же сторону.
      const move = gestureWheel(event, streak);
      streak = move.streak;
      event.preventDefault();
      if (move.kind === "pan") {
        panBy(move.panX, move.panY);
        return;
      }
      const rect = node.getBoundingClientRect();
      zoomAt({ x: event.clientX - rect.left, y: event.clientY - rect.top }, move.factor);
    },
    { passive: false },
  );

  // ——— клавиатура ———
  //
  // Клавиши мастерской работают, пока на экране она (`active`): стрелки в
  // объёме ходят, на плане листают план, и один и тот же код не должен
  // доставаться трём поверхностям сразу. Ctrl+Z она ведёт сама — слушатель
  // стоит в фазе перехвата и до холста событие не доходит.
  function onKeyDown(event) {
    if (!active()) return;
    const target = event.target;
    const tag = target && target.tagName;
    // Отметку слоя отмена не касается: в ней нечего отменять, а стоять фокус в
    // ней может с самого открытия окна — диалог отдаёт фокус первому полю.
    const typing = Boolean(
      target && (tag === "TEXTAREA" || target.isContentEditable || (tag === "INPUT" && target.type !== "checkbox")),
    );
    const inField = typing || tag === "SELECT";
    const control = event.ctrlKey || event.metaKey;
    if (control && event.code === "KeyZ" && !typing) {
      event.preventDefault();
      event.stopPropagation();
      if (event.shiftKey) canvasRedoStep();
      else canvasUndoStep();
      return;
    }
    if (control && event.code === "KeyY" && !typing) {
      event.preventDefault();
      event.stopPropagation();
      canvasRedoStep();
      return;
    }
    if (control || inField) return;
    // Стрелки возят вид — как на холсте, той же кривой разгона (дефект D23).
    if (panKeyDown(event.code)) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (event.key === "Escape" && draft) {
      // Esc сперва отменяет цепочку, и только потом закрывает окно — та же
      // лесенка, что у холста. Слушатель висит в фазе перехвата: иначе окно
      // закрылось бы раньше, чем черновик успел отмениться.
      event.preventDefault();
      event.stopPropagation();
      draft = null;
      sync();
      return;
    }
    if (event.key === "Escape" && selected) {
      event.preventDefault();
      event.stopPropagation();
      select(null);
      return;
    }
    if (event.key === "Enter" && draft) {
      event.preventDefault();
      event.stopPropagation();
      // У контура «закончить» может значить только «замкнуть»: незамкнутый
      // контур объектом не становится (G193), и Enter его замыкает, а не
      // оставляет полосой.
      if (workshopObjectWay === "contour" && tool === "objects") finishContour();
      else if (tool === "objects") finishBand();
      else finishChain();
      return;
    }
    if (event.key === "Backspace" && draft) {
      event.preventDefault();
      event.stopPropagation();
      draft.points.pop();
      if (draft.points.length === 0) draft = null;
      paint();
      return;
    }
    // Четверть оборота с клавиатуры (таск 164): рука остаётся на мыши, а вещь
    // поворачивается — тем же шагом и той же дверью, что кнопки в колонке.
    const turnable = tool === "objects" || (selected && selected.kind === "object");
    if (event.code === "KeyR" && !event.altKey && turnable) {
      event.preventDefault();
      event.stopPropagation();
      turnBy(event.shiftKey ? -WORKSHOP_TURN_STEP_DEG : WORKSHOP_TURN_STEP_DEG);
      return;
    }
    // `Q` и `E` — половина четверти (таск 168, G249). Заказчик просил их «при
    // размещении», но условие здесь то же, что у `R`: и при размещении, и у
    // выделенной вещи. Рука у человека одна — она на мыши, — и правило
    // «до клика поворачивает клавиша, после клика только колонка» пришлось бы
    // держать в голове, а держать его незачем: угол один и тот же, дверей к
    // нему четыре, и ни одна не знает, поставлена вещь или нет.
    if ((event.code === "KeyQ" || event.code === "KeyE") && !event.altKey && !event.shiftKey && turnable) {
      event.preventDefault();
      event.stopPropagation();
      turnBy(event.code === "KeyQ" ? -WORKSHOP_TURN_HALF_DEG : WORKSHOP_TURN_HALF_DEG);
      return;
    }
    if ((event.key === "Delete" || event.key === "Backspace") && selected) {
      event.preventDefault();
      event.stopPropagation();
      removeSelected();
    }
  }

  // ——— стрелки: сдвиг вида с разгоном ————————————————————————————————
  //
  // Направление и скорость — холстовые (`canvasPanVector`, `canvasPanSpeed`):
  // короткое нажатие даёт шаг, удержание после задержки переходит в
  // непрерывный ход с разгоном. Повторы от системы пропускаются — ход ведут
  // кадры, а не автоповтор. Своего здесь только ход кадров: холстовый прибит к
  // его синглтон-виду, а у окна вид свой.

  function panKeyDown(code) {
    const direction = canvasPanVector(code);
    if (!direction) return false;
    if (!panKeys.has(code)) {
      panKeys.set(code, panNow());
      panClock = panNow();
      panBy(direction.x * WORKSHOP_PAN_STEP_PX, direction.y * WORKSHOP_PAN_STEP_PX);
      panSchedule();
    }
    return true;
  }

  // Клавишу отпустили — или её отпустили за нас: окно увели, открылся диалог.
  // Без этого зажатая стрелка уезжает вместе с фокусом и не останавливается.
  function panKeyUp(code) {
    if (code) panKeys.delete(code);
    else panKeys.clear();
    if (panKeys.size > 0 || !panFrame) return;
    const cancel = typeof cancelAnimationFrame === "function" ? cancelAnimationFrame : clearTimeout;
    cancel(panFrame);
    panFrame = 0;
  }

  function panNow() {
    return typeof performance !== "undefined" && performance.now ? performance.now() : Date.now();
  }

  function panSchedule() {
    if (panFrame || panKeys.size === 0 || closed) return;
    const schedule = typeof requestAnimationFrame === "function" ? requestAnimationFrame : (fn) => setTimeout(fn, 16);
    panFrame = schedule(panTick);
  }

  function panTick() {
    panFrame = 0;
    if (panKeys.size === 0 || closed) return;
    const time = panNow();
    const step = Math.min(WORKSHOP_PAN_FRAME_MS, time - panClock) / 1000;
    panClock = time;
    let dx = 0;
    let dy = 0;
    for (const [code, since] of panKeys) {
      const speed = canvasPanSpeed(time - since) * step;
      const direction = canvasPanVector(code);
      dx += direction.x * speed;
      dy += direction.y * speed;
    }
    if (dx !== 0 || dy !== 0) panBy(dx, dy);
    panSchedule();
  }

  function onKeyUp(event) {
    panKeyUp(event.code);
  }

  function onBlur() {
    panKeyUp(null);
  }

  function onResize() {
    if (closed) return;
    resize();
  }

  // ——— кадр ———

  function redraw() {
    if (frame || closed) return;
    const schedule = typeof requestAnimationFrame === "function" ? requestAnimationFrame : (fn) => setTimeout(fn, 16);
    frame = schedule(() => {
      frame = 0;
      paint();
    });
  }

  function resize() {
    // Окно спрятано (поверх лежит подтверждение) — измерять нечего, и мерить
    // нельзя: нулевая ширина увела бы масштаб в сторону. Та же оговорка, что в
    // `layout()` окна загрузки плана.
    if (!(stage.clientWidth > 0) || !(stage.clientHeight > 0)) return;
    const ratio = (typeof window !== "undefined" && window.devicePixelRatio) || 1;
    const box = viewport();
    node.style.width = box.width + "px";
    node.style.height = box.height + "px";
    node.width = Math.round(box.width * ratio);
    node.height = Math.round(box.height * ratio);
    if (!fitted) {
      fitted = true;
      // Через ту же дверь, что кнопка «Вписать»: у занятия «Масштаб» габарит
      // свой, и первый кадр обязан вписать картинку, а не миллиметры.
      fit();
      return;
    }
    sync();
  }

  function paint() {
    if (!ctx) return;
    const ratio = (typeof window !== "undefined" && window.devicePixelRatio) || 1;
    const box = viewport();
    // Бумага заливается по настоящим точкам холста, а не по его размеру в
    // стилевых пикселях: при дробном `devicePixelRatio` округление оставляло
    // по краю незакрашенную полосу в один пиксель — прозрачную, а не белую.
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = WORKSHOP_PAPER;
    ctx.fillRect(0, 0, node.width, node.height);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    const spot = placement();
    if (workshopLayers.plan && spot.kind === "ready") paintPlan(spot, box);
    if (workshopLayers.grid) paintGrid(box);
    if (spot.kind === "ready") paintOrigin();
    // Объекты под стенами: колонна в стене и короб у стены принадлежат полу, а
    // стена — главное на чертеже, и прятать её под габаритом нельзя.
    paintDrawing();
    paintObjectHandles();
    paintDraft();
  }

  function paintPlan(spot, box) {
    const bitmap = image();
    if (!bitmap) return;
    const zero = screenOf({ x: 0, y: 0 });
    const k = view.zoom * spot.mmPerPx;
    ctx.save();
    // Окно обрезает картинку само: при сильном увеличении она в сотни раз
    // больше поля, и `drawImage` без границ отъедал бы кадр целиком.
    ctx.beginPath();
    ctx.rect(0, 0, box.width, box.height);
    ctx.clip();
    ctx.translate(zero.x, zero.y);
    ctx.rotate((-spot.turn * Math.PI) / 180);
    ctx.scale(k, k);
    try {
      ctx.drawImage(bitmap, -spot.at.x * spot.width, -spot.at.y * spot.height, spot.width, spot.height);
    } catch (error) {
      // Картинку могли закрыть (схему переключили) — кадр не повод падать.
    }
    ctx.restore();
  }

  function paintGrid(box) {
    const step = workshopGridDrawStepMm(workshopGridMm, view.zoom);
    if (!(step > 0)) return;
    const from = screenToPlan({ x: 0, y: 0 }, WORKSHOP_UNIT, view);
    const to = screenToPlan({ x: box.width, y: box.height }, WORKSHOP_UNIT, view);
    ctx.lineWidth = 1;
    const firstX = Math.ceil(from.x / step) * step;
    const firstY = Math.ceil(from.y / step) * step;
    for (let mm = firstX; mm <= to.x; mm += step) {
      const at = Math.round(screenOf({ x: mm, y: 0 }).x) + 0.5;
      ctx.strokeStyle = Math.round(mm / step) % 5 === 0 ? WORKSHOP_GRID_MAJOR : WORKSHOP_GRID_LINE;
      ctx.beginPath();
      ctx.moveTo(at, 0);
      ctx.lineTo(at, box.height);
      ctx.stroke();
    }
    for (let mm = firstY; mm <= to.y; mm += step) {
      const at = Math.round(screenOf({ x: 0, y: mm }).y) + 0.5;
      ctx.strokeStyle = Math.round(mm / step) % 5 === 0 ? WORKSHOP_GRID_MAJOR : WORKSHOP_GRID_LINE;
      ctx.beginPath();
      ctx.moveTo(0, at);
      ctx.lineTo(box.width, at);
      ctx.stroke();
    }
  }

  // Нуль чертежа виден всегда, когда он существует: после замены подложки
  // привязку ставят заново, и показать, куда именно она встала, — половина
  // ответа на вопрос «почему чертёж не там».
  function paintOrigin() {
    const at = screenOf({ x: 0, y: 0 });
    ctx.strokeStyle = WORKSHOP_ORIGIN;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(at.x - 9, at.y);
    ctx.lineTo(at.x + 9, at.y);
    ctx.moveTo(at.x, at.y - 9);
    ctx.lineTo(at.x, at.y + 9);
    ctx.stroke();
  }

  // ——— чертёж рисует общий слой ———
  //
  // Стены, проёмы и объекты рисует `render.drawDrawing` — **тот же код**, что
  // на основном холсте (таск 127). Окно отдаёт ему свой мост (у мастерской
  // пиксель равен миллиметру), то, что сейчас под рукой, и рисовальщик ручек;
  // всё остальное общее. Второй отрисовки быть не должно: разойдись они, дверь
  // в окне открывалась бы не в ту сторону, что на холсте, и увидели бы это на
  // бумаге.
  function bridge() {
    return drawingUnitBridge(view);
  }

  // Что под рукой прямо сейчас: пока тащат, кадр рисуется из предпросмотра, а
  // в объект уходит только то место, где руку отпустили.
  function wallEnds(wall) {
    if (drag && drag.moved && drag.kind === "vertex" && drag.toMm) {
      const a = wall.aMm.x === drag.fromMm.x && wall.aMm.y === drag.fromMm.y ? drag.toMm : wall.aMm;
      const b = wall.bMm.x === drag.fromMm.x && wall.bMm.y === drag.fromMm.y ? drag.toMm : wall.bMm;
      return { ...wall, aMm: a, bMm: b };
    }
    if (drag && drag.moved && drag.kind === "wall" && drag.deltaMm && drag.wallId === wall.id) {
      return {
        ...wall,
        aMm: { x: wall.aMm.x + drag.deltaMm.x, y: wall.aMm.y + drag.deltaMm.y },
        bMm: { x: wall.bMm.x + drag.deltaMm.x, y: wall.bMm.y + drag.deltaMm.y },
      };
    }
    return wall;
  }

  function movedOpening(opening) {
    if (drag && drag.moved && drag.kind === "opening" && drag.id === opening.id && drag.atMm !== null) {
      return { ...opening, atMm: drag.atMm };
    }
    return opening;
  }

  function shiftObject(object) {
    // Правка за ручку: кадр рисуется тем самым патчем, который уйдёт в объект
    // по отпусканию, — одна дверь на предпросмотр и на запись.
    if (drag && drag.moved && drag.kind === "objectHandle" && drag.id === object.id) {
      const patch = workshopObjectPatch(object, drag.handle, drag.toMm, { free: drag.free });
      return patch ? { ...object, ...patch } : object;
    }
    if (!(drag && drag.moved && drag.kind === "object" && drag.id === object.id && drag.deltaMm)) return object;
    const deltaMm = drag.deltaMm;
    if (object.shape === "polyline") {
      return {
        ...object,
        pointsMm: (object.pointsMm || []).map((point) => ({ x: point.x + deltaMm.x, y: point.y + deltaMm.y })),
      };
    }
    return { ...object, atMm: { x: object.atMm.x + deltaMm.x, y: object.atMm.y + deltaMm.y } };
  }

  function paintDrawing() {
    drawDrawing(ctx, {
      project: project(),
      schemeId,
      bridge: bridge(),
      active: selected,
      walls: workshopLayers.walls,
      objects: getState().objectsShown !== false,
      hiddenObjectIds: getState().hiddenObjectIds,
      wallAt: wallEnds,
      openingAt: movedOpening,
      objectAt: shiftObject,
      handle,
    });
  }

  // Ручка правки. Принимает холст первым доводом, потому что её зовёт и общий
  // слой чертежа: у него своего рисовальщика ручек нет и быть не должно —
  // ручки есть только там, где правят.
  function handle(target, at) {
    target.beginPath();
    target.arc(at.x, at.y, 4.5, 0, Math.PI * 2);
    target.fillStyle = WORKSHOP_HANDLE;
    target.fill();
    target.lineWidth = 1.5;
    target.strokeStyle = WORKSHOP_ACCENT;
    target.stroke();
  }

  function paintDraft() {
    // Призрак проёма: что сядет по клику. Красный — не сядет, и причина уже
    // стоит строкой под полем.
    if (tool === "openings" && ghost) {
      drawDrawingOpening(ctx, bridge(), ghost.wall, ghost.opening, { ghost: true, bad: !ghost.ok });
      return;
    }
    // Призрак вещи: габарит, перёд и числа — до клика (таск 164). Считается на
    // кадре из полей колонки: поправили угол, не двигая руки, — призрак
    // повернулся вместе с полем.
    //
    // `objectDrawn()` спрашивается здесь, а не только при смене способа: у
    // росчерка свой призрак — сама линия под рукой (таск 167), и эта ветка
    // обрывает кадр возвратом. Одного условия в `setObjectWay` мало — порядок
    // веток важнее порядка вызовов.
    if (tool === "objects" && !objectDrawn() && objectGhost) {
      const ghostObject = objectGhostAt(objectGhost.pointMm);
      if (ghostObject) paintObjectGhost(ghostObject);
      return;
    }
    const band = objectDrawn() && workshopObjectWay === "polyline";
    const contour = objectDrawn() && workshopObjectWay === "contour";
    if ((tool !== "walls" && !band && !contour) || !draft) return;
    const points = [...draft.points, draft.cursor];
    ctx.lineCap = "butt";
    ctx.lineJoin = "round";
    // Контур обводят по месту, и толщины у него нет: он не стена и не полоса, а
    // габарит, который из него выйдет. Поэтому линия тонкая, а габарит показан
    // призраком — см. ниже.
    ctx.lineWidth = contour ? 1.5 : Math.max(1, (band ? bandWidthMm() : workshopThicknessMm) * view.zoom);
    ctx.strokeStyle = band || contour ? DRAWING_OBJECT : WORKSHOP_ACCENT;
    ctx.globalAlpha = contour ? 1 : 0.5;
    ctx.beginPath();
    points.forEach((point, index) => {
      const at = screenOf(point);
      if (index === 0) ctx.moveTo(at.x, at.y);
      else ctx.lineTo(at.x, at.y);
    });
    ctx.stroke();
    ctx.globalAlpha = 1;
    if (!contour) {
      ctx.lineWidth = 1;
      ctx.strokeStyle = DRAWING_EDGE;
      ctx.beginPath();
      points.forEach((point, index) => {
        const at = screenOf(point);
        if (index === 0) ctx.moveTo(at.x, at.y);
        else ctx.lineTo(at.x, at.y);
      });
      ctx.stroke();
    }
    if (contour) paintContourGhost();
    for (const point of draft.points) handle(ctx, screenOf(point));
    // Длина набираемого отрезка — **над ним самим** (G195). Слова заказчика: «в
    // процессе рисования над текущей линией указывай ей длину при рисовании».
    // Одна подпись на все три росчерка: стену, полосу и контур рисуют одной
    // рукой, и мерить её надо одинаково.
    const last = draft.points[draft.points.length - 1];
    paintLength(last, draft.cursor);
  }

  /**
   * Что выйдет из контура, пока его обводят: габарит прямоугольника и его
   * размеры. Считает его **та же** `workshopRectFromContour`, которая запишет
   * объект по замыканию, — приведение контура к прямоугольнику поэтому не
   * обещание, а показанное.
   *
   * Замыкающая сторона нарисована пунктиром от курсора к первой вершине: по
   * ней видно, что контур **надо** замкнуть и где это сделать.
   */
  function paintContourGhost() {
    const first = screenOf(draft.points[0]);
    const cursor = screenOf(draft.cursor);
    ctx.save();
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 1;
    ctx.strokeStyle = DRAWING_OBJECT;
    ctx.beginPath();
    ctx.moveTo(cursor.x, cursor.y);
    ctx.lineTo(first.x, first.y);
    ctx.stroke();
    const rect = workshopRectFromContour([...draft.points, draft.cursor]);
    if (rect) {
      const corners = schemeObjectCorners({ shape: "rect", ...rect }).map(screenOf);
      ctx.strokeStyle = WORKSHOP_ACCENT;
      ctx.beginPath();
      corners.forEach((point, index) => (index === 0 ? ctx.moveTo(point.x, point.y) : ctx.lineTo(point.x, point.y)));
      ctx.closePath();
      ctx.stroke();
      ctx.setLineDash([]);
      const middle = screenOf(rect.atMm);
      ctx.font = drawFont(12, 600);
      ctx.textBaseline = "middle";
      ctx.textAlign = "center";
      const line = text("workshop.contourSize", { width: rect.widthMm, depth: rect.depthMm });
      ctx.lineWidth = 3;
      ctx.strokeStyle = WORKSHOP_PAPER;
      ctx.strokeText(line, middle.x, middle.y);
      ctx.fillStyle = DRAWING_EDGE;
      ctx.fillText(line, middle.x, middle.y);
      ctx.textAlign = "start";
    }
    ctx.restore();
  }

  // Длина отрезка над ним самим: место считает `workshopLengthAt`, здесь только
  // рисуется. Нулевой отрезок подписи не получает — её некуда повернуть.
  function paintLength(fromMm, toMm) {
    const length = Math.round(Math.hypot(toMm.x - fromMm.x, toMm.y - fromMm.y));
    const at = length > 0 ? workshopLengthAt(screenOf(fromMm), screenOf(toMm), WORKSHOP_LENGTH_GAP_PX) : null;
    if (!at) return;
    ctx.save();
    ctx.font = drawFont(13, 600);
    ctx.textBaseline = "middle";
    ctx.textAlign = "center";
    ctx.lineWidth = 3;
    ctx.strokeStyle = WORKSHOP_PAPER;
    ctx.strokeText(String(length), at.x, at.y);
    ctx.fillStyle = DRAWING_EDGE;
    ctx.fillText(String(length), at.x, at.y);
    ctx.restore();
  }

  /**
   * Призрак вещи под рукой (таск 164, переписан в таске 168): **та самая
   * вещь**, которая встанет по клику, нарисованная тем же кодом
   * (`render.drawDrawingObject` с приметой `ghost`) — заливка, контур и подпись
   * с именем над габаритом. Своё у призрака только три вещи: пунктир, полсилы
   * цвета и строка «ширина × глубина · угол» **под** габаритом.
   *
   * Почему переписан. Заказчик призрака не видел: «просто тыкаешь и куда-то
   * рядом встало». Прежний рисовал голый пунктирный прямоугольник без заливки
   * и без имени, а числа клал поперёк его середины — у радиатора 1200 × 100 это
   * коробка 90 × 7 точек под строкой 75 × 12. Подпись закрывала собой вещь,
   * которую подписывала, а вставшая по клику вещь выглядела иначе: лиловая
   * заливка, сплошной контур и имя сверху. Показанное и полученное не совпадали
   * ни местом строки, ни видом.
   *
   * Числа ушли вниз по той же причине, по которой имя стоит сверху: у тонкой
   * вещи на габарите нет места ни для одной строки, и обе ставятся снаружи, с
   * разных сторон.
   *
   * Зачем клюв: на плане повёрнутый на 180° унитаз выглядит точно так же, как
   * неповёрнутый, — четыре угла те же. Число угла об этом говорит, а клюв
   * показывает, и смотреть на него не надо: он там же, где рука.
   */
  function paintObjectGhost(object) {
    const corners = schemeObjectCorners(object).map(screenOf);
    if (corners.length < 4) return;
    drawDrawingObject(ctx, bridge(), object, { ghost: true, name: objectCatalogName(workshopObjectKey) });
    ctx.save();
    paintObjectFront(object, corners);
    const line = text("workshop.ghostSize", {
      width: object.widthMm,
      depth: object.depthMm,
      turn: object.turnDeg,
    });
    const middle = corners.reduce((sum, point) => sum + point.x, 0) / corners.length;
    const bottom = Math.max(...corners.map((point) => point.y)) + WORKSHOP_GHOST_LINE_GAP_PX;
    ctx.font = drawFont(12, 600);
    ctx.textBaseline = "top";
    ctx.textAlign = "center";
    ctx.lineWidth = 3;
    ctx.strokeStyle = WORKSHOP_PAPER;
    ctx.strokeText(line, middle, bottom);
    ctx.fillStyle = DRAWING_EDGE;
    ctx.fillText(line, middle, bottom);
    ctx.textAlign = "start";
    ctx.restore();
  }

  // Клюв переда: уголок на середине той стороны, которой вещь смотрит.
  // Направление — `workshopFrontAxis`, то же самое, из которого объём берёт
  // фасад: второго описания переда в сборке нет.
  function paintObjectFront(object, corners) {
    const front = { x: (corners[2].x + corners[3].x) / 2, y: (corners[2].y + corners[3].y) / 2 };
    const axis = workshopFrontAxis(object.turnDeg);
    const side = { x: -axis.y, y: axis.x };
    const tip = { x: front.x + axis.x * 9, y: front.y + axis.y * 9 };
    ctx.beginPath();
    ctx.moveTo(front.x + side.x * 7, front.y + side.y * 7);
    ctx.lineTo(tip.x, tip.y);
    ctx.lineTo(front.x - side.x * 7, front.y - side.y * 7);
    ctx.closePath();
    ctx.fillStyle = DRAWING_OBJECT;
    ctx.fill();
  }

  // Ручки пути выделенной полосы: середины отрезков и концы. Вершины рисует
  // общий слой чертежа своим кружком — тем же, каким в этом окне показаны
  // вершины стен и ручки двери. У прямоугольника ручка одна — поворот
  // (таск 164): углы его габарита рисует тот же общий слой.
  function paintObjectHandles() {
    if (tool !== "edit") return;
    const object = selectedObject();
    if (!object) return;
    const shown = shiftObject(object);
    if (object.shape !== "polyline") {
      paintTurnHandle(workshopTurnHandle(shown, view));
      return;
    }
    const extra = workshopObjectHandles(shown, view).filter((item) => item.kind !== "vertex");
    drawPathHandles(ctx, extra, WORKSHOP_ACCENT, hoverHandle);
  }

  /**
   * Ручка поворота: поводок от переда вещи и **ручка поворота подписи** на его
   * конце — `render.drawLabelTurn`, та самая и тем же кодом (таск 168, G250).
   *
   * Своего рисунка здесь больше нет. Он был — кольцо с дугой внутри, — и от
   * ручки подписи отличался и мерой, и видом; заказчик попросил «как у подписи
   * метки», и двух кнопок одного смысла в сборке не осталось. Под рукой ручка
   * перестаёт быть полупрозрачной — это всё, что к общему рисунку добавлено.
   *
   * Поводок остаётся: ручка подписи сидит на подписи и в хозяине не
   * сомневается, а эта стоит в 26 точках перед вещью, и без поводка кружок в
   * стороне читался бы ничьим. Заодно он показывает, куда вещь смотрит.
   */
  function paintTurnHandle(turn) {
    if (!turn) return;
    const under = hoverHandle && hoverHandle.kind === "turn";
    ctx.save();
    ctx.globalAlpha = under ? 1 : 0.75;
    ctx.beginPath();
    ctx.setLineDash([3, 3]);
    ctx.lineWidth = 1;
    ctx.strokeStyle = WORKSHOP_ACCENT;
    ctx.moveTo(turn.from.x, turn.from.y);
    ctx.lineTo(turn.x, turn.y);
    ctx.stroke();
    ctx.setLineDash([]);
    drawLabelTurn(ctx, turn, WORKSHOP_ACCENT);
    ctx.restore();
  }

  // Ширина полосы нового объекта: из умолчаний вида, пока его не поправили.
  function bandWidthMm() {
    return Number(objectSizes(null).depthMm) || 600;
  }

  // ——— панель: значения и доступность ———

  function sync() {
    const current = project();
    const spot = placement();
    const wall = selectedWall();
    const now = mode();
    // Первый уровень: чем занят. Второй виден только в добавлении.
    selectButton.className = "ui-btn" + (now === "select" ? " ui-btn--accent" : "");
    addButton.className = "ui-btn" + (now === "add" ? " ui-btn--accent" : "");
    addingRow.hidden = now !== "add";
    wallsButton.className = "ui-btn" + (tool === "walls" ? " ui-btn--accent" : "");
    planCheck.checked = workshopLayers.plan && spot.kind === "ready";
    planCheck.disabled = spot.kind !== "ready";
    planRow.title =
      spot.kind === "noImage"
        ? strings.workshop.layerPlanNone
        : spot.kind === "noScale"
          ? strings.workshop.layerPlanNoScale
          : "";
    // Кнопка остаётся там, где масштаба нет: она стоит рядом с погашенной
    // отметкой подложки и объясняет её, а ведёт на план, в «Схемы» (G227).
    calibrateButton.hidden = spot.kind !== "noScale";
    attachButton.hidden = !spot.pending;
    gridCheck.checked = workshopLayers.grid;
    wallsCheck.checked = workshopLayers.walls;
    objectsCheck.checked = getState().objectsShown !== false;
    gridSelect.value = String(workshopGridMm);
    snapCheck.checked = workshopGridSnap;
    openingsButton.className = "ui-btn" + (tool === "openings" ? " ui-btn--accent" : "");
    objectsButton.className = "ui-btn" + (tool === "objects" ? " ui-btn--accent" : "");
    syncSubject(current, wall);
    if (document.activeElement !== heightInput) {
      const own = findScheme(current, schemeId);
      heightInput.value = own && typeof own.wallHeightMm === "number" ? String(own.wallHeightMm) : "";
    }
    syncRooms(current);
    syncElevation(current, wall);
    syncList(current);
    hintPlate.update(workshopHint(tool, workshopObjectWay));
    // Сводка — строками, как в объёме: каждая отвечает на свой вопрос, и
    // читать её сверху вниз легче, чем одну длинную строку.
    summaryPlate.update(workshopSummaryLines(current, schemeId, spot), {
      // Масштаба у плана нет — это и есть то, о чём сводка обязана сказать, даже
      // будучи свёрнутой: без него подложку под чертёж не положить.
      alert: spot.kind === "noScale",
    });
    // Стрелка там, где выбирают, крестик там, где ставят: развёртка выбирает.
    node.style.cursor = tool === "edit" ? "default" : "crosshair";
    redraw();
  }

  /**
   * Список элементов чертежа в правой колонке (таск 153).
   *
   * Пересобирается, только когда чертёж действительно изменился: ключ —
   * перечисление того, что в списке стоит. На объекте заказчика это сотня
   * строк, а `sync()` зовётся на каждое движение мышью в поле — без ключа
   * колонка пересобиралась бы кадрами. Подсветка выделенного живёт отдельно и
   * меняется без пересборки.
   */
  /**
   * Строка списка: имя с размером — кнопка выделения, а у вещи рядом с ней
   * глазок (таск 154, G223).
   *
   * Две кнопки, а не одна с двумя действиями: кнопка внутри кнопки — не
   * разметка, а по строке кликают, чтобы выделить, и промах по глазку не
   * должен прятать вещь.
   */
  function listRow(row, hidden) {
    const pick = uiEl(
      "button",
      {
        class: "workshop__listPick",
        type: "button",
        title: row.note,
        attrs: { "data-kind": row.kind, "data-id": row.id },
        // Клик по строке — то же выделение, что клик по вещи в поле: второй
        // правды о выделенном в режиме нет.
        on: { click: () => select({ kind: row.kind, id: row.id }) },
      },
      [
        uiEl("span", { class: "workshop__listName", text: row.label }),
        uiEl("span", { class: "workshop__listNote", text: row.note }),
      ],
    );
    if (row.kind !== "object") return uiEl("div", { class: "workshop__listRow" }, [pick]);
    const off = hidden.has(row.id);
    const eye = uiEl("button", {
      class: "ui-btn ui-btn--icon workshop__eye" + (off ? " is-off" : ""),
      type: "button",
      title: off ? strings.workshop.objectShow : strings.workshop.objectHide,
      attrs: { "aria-label": off ? strings.workshop.objectShow : strings.workshop.objectHide, "aria-pressed": off ? "true" : "false" },
      on: { click: () => setObjectHidden(row.id, !off) },
    });
    eye.append(off ? uiIcon("viewOff") : uiIcon("view"));
    return uiEl("div", { class: "workshop__listRow" }, [pick, eye]);
  }

  function syncList(current) {
    const groups = workshopListGroups(current, schemeId);
    const hidden = hiddenObjects();
    // В ключ входит и спрятанное: глазок — часть строки, и сменившись, он
    // обязан перерисоваться.
    const key = JSON.stringify(groups) + "|" + [...hidden].sort().join(",");
    if (key !== listKey) {
      listKey = key;
      const parts = [];
      for (const group of groups) {
        parts.push(
          uiEl("div", { class: "workshop__listGroup" }, [
            uiEl("h4", { class: "workshop__head" }, [
              uiEl("span", { text: group.title }),
              uiEl("span", { class: "workshop__listCount", text: String(group.rows.length) }),
            ]),
            ...group.rows.map((row) => listRow(row, hidden)),
          ]),
        );
      }
      // Чертежа нет вовсе — колонка говорит об этом словом, а не пустотой.
      if (groups.every((group) => group.rows.length === 0)) {
        parts.push(uiEl("p", { class: "panel__empty", text: strings.workshop.listEmpty }));
      }
      list.replaceChildren(...parts);
    }
    for (const row of list.querySelectorAll(".workshop__listPick")) {
      const on = Boolean(selected) && selected.kind === row.dataset.kind && selected.id === row.dataset.id;
      row.classList.toggle("is-on", on);
      row.setAttribute("aria-pressed", on ? "true" : "false");
    }
  }

  function fieldValue(input, value) {
    if (document.activeElement === input) return;
    input.value = value === null || value === undefined ? "" : String(value);
  }

  // Колонка свойств на троих: показывается ровно один набор полей — тот, о
  // котором сейчас речь. Что именно, решает `subject()`: выделенное, а без
  // выделения — то, что поставит следующий клик.
  function syncSubject(current, wall) {
    const kind = subject();
    const opening = selectedOpening();
    const object = selectedObject();
    wallFields.hidden = kind !== "wall";
    openingFields.hidden = kind !== "opening";
    objectFields.hidden = kind !== "object";
    const editing = Boolean(selected);
    removeButton.disabled = !editing;
    removeButton.hidden = !editing;
    subjectNote.classList.remove("is-bad");
    if (kind === "wall") {
      subjectHead.textContent = strings.workshop.wall;
      thicknessLabel.textContent = wall ? strings.workshop.thickness : strings.workshop.thicknessNew;
      fieldValue(thicknessInput, wall ? wall.thicknessMm : workshopThicknessMm);
      subjectNote.textContent = wall
        ? text("workshop.wallInfo", { length: wallLengthMm(wall) })
        : strings.workshop.wallNone;
      return;
    }
    if (kind === "opening") {
      syncOpening(opening);
      return;
    }
    syncObject(current, object);
  }

  function openingHelp() {
    return walls().length === 0 ? strings.workshop.openingNeedWall : strings.workshop.openingHint;
  }

  function syncOpening(opening) {
    const kind = opening ? opening.kind : workshopOpeningKind;
    subjectHead.textContent = strings.workshop.opening;
    kindButtons.forEach((button, index) => {
      button.className = "ui-btn workshop__chip" + (OPENING_KINDS[index] === kind ? " is-on" : "");
    });
    const sizes = opening || workshopOpeningSizes[kind] || WORKSHOP_OPENING_DEFAULTS[kind];
    fieldValue(openingWidth, sizes.widthMm);
    fieldValue(openingHeight, sizes.heightMm);
    fieldValue(openingFloor, sizes.heightAboveFloorMm);
    atField.hidden = !opening;
    if (opening) fieldValue(openingAt, opening.atMm);
    doorFields.hidden = kind !== OPENING_KIND_DOOR;
    const hinge = opening && opening.kind === OPENING_KIND_DOOR ? opening.hinge : workshopDoorHinge;
    const swing = opening && opening.kind === OPENING_KIND_DOOR ? opening.swing : workshopDoorSwing;
    hingeButton.textContent = text("workshop.doorHinge", { value: strings.openingHinges[hinge] });
    swingButton.textContent = text("workshop.doorSwing", { value: strings.openingSwings[swing] });
    subjectNote.textContent = opening ? strings.workshop.doorHint : openingHelp();
  }

  /**
   * Плашка вещи в колонке: картинка, имя и подсказка про дверь.
   *
   * Перерисовывается только когда поменялось нарисованное: `sync` зовут на
   * каждое движение мыши по полю, а картинка вещи — холст в точках устройства.
   */
  function syncThing(key, name, object) {
    const mark = (key || "") + "\n" + (name || "");
    if (thingShown !== mark) {
      thingShown = mark;
      thingIcon.replaceChildren(...(key ? [objectTileIcon(key, WORKSHOP_THING_ICON)] : []));
      thingIcon.hidden = !key;
      thingName.textContent = name || strings.workshop.objectUnknown;
    }
    thingButton.classList.toggle("is-set", Boolean(key));
    thingButton.title = object ? strings.workshop.objectChangeHint : strings.workshop.objectChooseHint;
  }

  function syncObject(current, object) {
    subjectHead.textContent = strings.workshop.object;
    // Что стоит на плашке: у выделенной вещи — её собственное имя (у прежней
    // разметки — переименованное человеком, из справочника вида), без
    // выделения — имя той вещи, которой поставят следующую. Картинку рисует
    // ключ; у вещи вне каталога его нет вовсе, и плашка остаётся с одним
    // именем, а не выдумывает чужую картинку.
    const key = objectKey(object);
    syncThing(key, object ? schemeObjectNameOf(current, object) : objectCatalogName(key), object);
    // Где вещь стоит. У вещи вне каталога этого ответа нет — и строка молчит,
    // а не выдумывает «на полу».
    const mount = object ? schemeObjectMountOf(current, object) : (objectCatalogEntry(key) || {}).mount;
    objectMountNote.textContent = mount ? strings.schemeObjectMounts[mount] || "" : "";
    objectMountNote.hidden = !mount;
    // Выделенный объект **не помнит**, нарисовали его контуром или набрали
    // числами, — и врать об этом нельзя: у прямоугольника горит
    // «Прямоугольник», а способ выбирают для следующего.
    const way = objectWay();
    const shape = object ? object.shape : workshopShapeOfWay(way);
    wayButtons.forEach((button, index) => {
      button.className = "ui-btn workshop__chip" + (WORKSHOP_OBJECT_WAYS[index] === way ? " is-on" : "");
      button.disabled = Boolean(object);
    });
    const sizes = object || objectSizes(null);
    widthField.hidden = shape === "polyline";
    // У полосы угла нет вовсе — её форма задана точками, — и строка не
    // показывает ни пустого поля, ни прочерка: прочерк обещал бы, что угол
    // есть, просто неизвестен (таск 164).
    turnField.hidden = shape === "polyline";
    turnChips.hidden = shape === "polyline";
    turnNote.hidden = shape === "polyline";
    // «К стене» работает по выделенной вещи: без неё стену не от чего искать.
    turnWallButton.disabled = !object;
    turnWallButton.title = object ? strings.workshop.objectToWallHint : strings.workshop.objectToWallNone;
    const depthLabel = depthField.querySelector(".workshop__label");
    if (depthLabel) {
      depthLabel.textContent = shape === "polyline" ? strings.workshop.objectBand : strings.workshop.objectDepth;
    }
    fieldValue(objectWidth, sizes.widthMm);
    fieldValue(objectDepth, sizes.depthMm);
    fieldValue(objectTurn, sizes.turnDeg || 0);
    fieldValue(objectHeight, sizes.heightMm === null || sizes.heightMm === undefined ? "" : sizes.heightMm);
    fieldValue(objectFloor, sizes.heightAboveFloorMm || 0);
    const top = object ? schemeObjectTopMm(object) : null;
    // У выделенного объекта в строке стоит его верх над полом, а без выделения
    // — слова того способа, которым встанет следующий: они разные, и общая
    // подсказка врала бы одному из трёх.
    //
    // Отдельный случай — вещь прежней разметки, которой в каталоге нет вовсе
    // («Аквариум»): ни одна плитка не горит, и молчать об этом нельзя — иначе
    // человек решит, что каталог сломался. Строка называет её вид и говорит,
    // что выбор плитки её заменит.
    const legacy = object && !key ? schemeObjectNameOf(current, object) : "";
    subjectNote.textContent = legacy
      ? text("workshop.objectLegacy", { name: legacy })
      : object
        ? top === null
          ? strings.workshop.objectFullHeight
          : text("workshop.objectTop", { top })
        : strings.workshop["wayNote_" + way];
  }

  /**
   * Полоса развёртки в окне: у той же стены, что выделена, и у того края поля,
   * который дальше от неё.
   *
   * **Правило одно с планом** (G227). Своего режима у развёртки больше нет —
   * заказчик убрал его как дубль: «кнопка Развёртка… дублируется в блоке
   * интерфейса». Полоса выезжает там же, где над планом: выделили стену, и
   * галка «Развёртка выделенной стены» в «Интерфейсе проекта» включена. Мешает
   * — её снимают той же галкой, одной на оба поля.
   */
  function syncElevation(current, wall) {
    if (!wall || getState().elevationShown === false) {
      strip.update({ project: current, wallId: null });
      return;
    }
    const box = viewport();
    const a = screenOf(wall.aMm);
    const b = screenOf(wall.bMm);
    strip.update({
      project: current,
      wallId: wall.id,
      side: getState().wallSide,
      place: elevationPlace((a.y + b.y) / 2, box.height),
      fieldHeight: box.height,
      views: getState().elevationViews !== false,
    });
  }

  // Список комнат перестраивается только когда он и правда другой: иначе
  // перерисовка на каждом шаге истории выбивала бы курсор из поля, в котором
  // в эту минуту набирают высоту.
  function syncRooms(current) {
    const rooms = roomsInOrder(current);
    const key = rooms.map((room) => room.id + ":" + room.name).join("|");
    if (key !== roomsKey) {
      roomsKey = key;
      roomsList.replaceChildren(
        ...(rooms.length === 0
          ? [uiEl("p", { class: "workshop__note", text: strings.workshop.heightRoomsEmpty })]
          : rooms.map((room) => {
              const input = workshopNumber(0, DRAWING_MM_MAX);
              input.dataset.roomId = room.id;
              input.addEventListener("change", () => applyRoomHeight(room.id, input.value));
              input.addEventListener("keydown", (event) => {
                if (event.key !== "Enter") return;
                event.preventDefault();
                applyRoomHeight(room.id, input.value);
              });
              return uiEl("label", { class: "workshop__field workshop__field--room" }, [
                uiEl("span", { class: "workshop__label", text: room.name, title: room.name }),
                input,
              ]);
            })),
      );
    }
    const common = findScheme(current, schemeId);
    const hintValue = common && typeof common.wallHeightMm === "number" ? String(common.wallHeightMm) : "";
    for (const input of roomsList.querySelectorAll("input")) {
      if (document.activeElement === input) continue;
      const room = findRoom(current, input.dataset.roomId);
      const own = room && typeof room.wallHeightMm === "number" ? String(room.wallHeightMm) : "";
      input.value = own;
      // Пустое поле показывает общую высоту подсказкой-заглушкой: так видно,
      // что́ именно перебивает своё число, — за этим переопределение и стоит
      // строкой ниже общей высоты, а не в чужой панели.
      input.placeholder = hintValue;
    }
  }

  // ——— жизнь окна ———

  const unsubscribe = subscribe((state, changed) => {
    if (closed) return;
    // Схему удалили под поверхностью или закрыли объект — поверхность
    // разбирается. Собрать её заново дешевле, чем держать мастерскую, у
    // которой нет схемы: следующий вход в режим соберёт её на той схеме,
    // которая открыта.
    if (!findScheme(state.project, state.schemeId)) {
      destroy();
      return;
    }
    // Схему сменили в списке — чертят её же, не выходя из режима (таск 153).
    // Всё, что относилось к прежней схеме, снимается: черновик, выделение и
    // вписанный кадр — у новой схемы свой масштаб и свой габарит.
    if (state.schemeId !== schemeId) {
      schemeId = state.schemeId;
      draft = null;
      ghost = null;
      objectGhost = null;
      press = null;
      selected = null;
      hover = null;
      hoverHandle = null;
      listKey = null;
      tool = workshopInitialTool(state.project, schemeId);
      fitted = false;
      resize();
      sync();
      return;
    }
    // Режим включили — поле снова на экране: его надо перемерить (пока
    // поверхность гасла, колонки могли спрятать или вернуть) и забрать
    // клавиатуру себе.
    if ("screen" in changed && state.screen === "drawing") {
      resize();
      sync();
      if (typeof stage.focus === "function") stage.focus({ preventScroll: true });
    }
    // Галка «Развёртка выделенной стены» — одна на план и на чертёж (G227):
    // сняли её в «Интерфейсе проекта» — полоса уходит и отсюда. Без этой
    // строки поверхность о ней не узнавала: проверено живым прогоном.
    if ("wallSide" in changed || "elevationViews" in changed || "elevationShown" in changed) sync();
    // Вещи погасили или вернули — хоть глазком в списке, хоть галкой в
    // «Интерфейсе проекта»: поле и список обязаны это увидеть (таск 154).
    if ("objectsShown" in changed || "hiddenObjectIds" in changed) {
      listKey = null;
      sync();
    }
    if ("project" in changed || "schemeImage" in changed) {
      // Отмена могла унести то, что было выделено, — и проём вместе со стеной.
      if (selected && !aliveSelection()) selected = null;
      sync();
    }
  });

  function aliveSelection() {
    if (!selected) return false;
    if (selected.kind === "wall") return Boolean(findWall(project(), selected.id));
    if (selected.kind === "opening") return Boolean(findOpening(project(), selected.id));
    return Boolean(findSchemeObject(project(), selected.id));
  }

  function destroy() {
    if (closed) return;
    strip.destroy();
    closed = true;
    workshopSurface = null;
    hosts.stage.replaceChildren();
    hosts.side.replaceChildren();
    hosts.list.replaceChildren();
    panKeyUp(null);
    if (unsubscribe) unsubscribe();
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerEnd);
    window.removeEventListener("pointercancel", onPointerEnd);
    window.removeEventListener("resize", onResize);
    window.removeEventListener("blur", onBlur);
    document.removeEventListener("keydown", onKeyDown, true);
    document.removeEventListener("keyup", onKeyUp, true);
  }

  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerEnd);
  window.addEventListener("pointercancel", onPointerEnd);
  window.addEventListener("resize", onResize);
  window.addEventListener("blur", onBlur);
  document.addEventListener("keydown", onKeyDown, true);
  document.addEventListener("keyup", onKeyUp, true);

  resize();
  // Режим включился — клавиатура у поля чертежа, а не у первой отметки слоя в
  // колонке: работают с чертежом — клавиши его.
  if (typeof stage.focus === "function") stage.focus({ preventScroll: true });
  // Масштаб поля наружу: им правит раздел «Интерфейс проекта» (G227) — тот
  // самый, который заказчик назвал единственным местом кнопок «−», «+» и
  // «Вписать». Второго ряда этих кнопок в чертеже больше нет.
  return {
    destroy,
    zoomBy: (factor) => zoomBy(factor),
    fit: () => fit(),
    reset: () => zoomReset(),
  };
}

// ——— режим «Чертёж» основного экрана (таск 153) ———————————————————————
//
// Поверхность одна на страницу и собирается **по первому входу в режим**: до
// него чертёж никому не нужен, а сцена и холст не бесплатны. Собранная, она
// живёт дальше и в чужих режимах — гаснет, но помнит масштаб, инструмент и
// черновик. Разбирается она только тогда, когда чертить стало нечего: схему
// удалили или объект закрыли.
// Свёрнутость плашек — у каждой своя (G228) и переживает перезагрузку.
const WORKSHOP_HINT_SETTING = "workshopHintCollapsed";
const WORKSHOP_SUMMARY_SETTING = "workshopSummaryCollapsed";

let workshopSurface = null;

function mountWorkshopScreen(host, api) {
  const { getState, subscribe } = api;
  // Три точки монтирования на одну поверхность: поле в основном экране,
  // инструменты в левой колонке, список элементов в правой. Берутся по
  // идентификатору из разметки, а не тремя регистрациями: у трёх регистраций
  // три закрытия, а выделение, инструмент и черновик у них общие.
  const hosts = {
    stage: host,
    side: document.getElementById(PANEL_IDS.drawTools),
    list: document.getElementById(PANEL_IDS.drawList),
  };

  const placeholder = () => {
    if (workshopSurface) return;
    for (const node of [hosts.side, hosts.list]) {
      if (!node) continue;
      node.replaceChildren(uiEl("p", { class: "panel__empty", text: strings.screens.needScheme }));
    }
  };

  const build = () => {
    const state = getState();
    if (!workshopSurface && state.screen === "drawing" && state.schemeId && hosts.side && hosts.list) {
      workshopSurface = createWorkshop({ api, hosts });
    }
    placeholder();
  };

  subscribe((state, changed) => {
    if ("screen" in changed || "schemeId" in changed || "project" in changed) build();
  });
  build();
}

registerPanel(PANEL_IDS.screenDrawing, mountWorkshopScreen);

// ——— масштаб чертежа снаружи (G227) ——————————————————————————————————
//
// «Кнопки + − и вписать дублируются, есть в нижнем блоке с интерфейсом, но в
// режиме чертёж они не работают сейчас. Убери сверху, а снизу почини для
// чертежа».
//
// Раздел «Интерфейс проекта» зовёт эти три двери, не зная о мастерской ничего
// другого. Поверхности может не быть вовсе (в чертеж ещё не заходили) — тогда
// звать нечего, и кнопки в разделе погашены (`workshopViewReady`).

export function workshopViewReady() {
  return Boolean(workshopSurface);
}

export function workshopViewZoomBy(factor) {
  if (workshopSurface) workshopSurface.zoomBy(factor);
}

export function workshopViewFit() {
  if (workshopSurface) workshopSurface.fit();
}

export function workshopViewReset() {
  if (workshopSurface) workshopSurface.reset();
}

function workshopCheckRow(input, label, title) {
  return uiEl("label", { class: "workshop__check", title: title || "" }, [input, uiEl("span", { text: label })]);
}

// Поле с подписью над ним — тот же кирпич, что в таске 125: длинные подписи с
// единицей измерения в узкой колонке рядом с полем ужимались до многоточия.
function workshopField(label, input) {
  return uiEl("label", { class: "workshop__field" }, [
    uiEl("span", { class: "workshop__label", text: label }),
    input,
  ]);
}

// Поле отдаёт значение по Enter и по уходу фокуса — и только так: правка на
// каждое нажатие клавиши набивала бы стек отмены на «1», «12», «120».
function workshopApply(input, run) {
  input.addEventListener("change", run);
  input.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    run();
  });
  return input;
}

function workshopNumber(min, max) {
  return uiEl("input", {
    class: "ui-input workshop__number",
    type: "number",
    attrs: { min: String(min), max: String(max), step: "1", inputmode: "numeric" },
  });
}
