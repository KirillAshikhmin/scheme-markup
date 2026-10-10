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
//      отвечает `null`, миллиметру не от чего считаться. Рисовать «на глаз, а
//      потом откалибровать» нельзя: калибровка миллиметры уже нарисованных
//      стен не пересчитывает (в отличие от долей разметки), и такой чертёж
//      остался бы неверным навсегда. Рисовать по сетке, от размеров, при этом
//      никто не мешает.
//
//      Но **показать картинку и положить на неё чертёж — разные задачи** (таск
//      132, дефект D22). Прежде окно гасило слой подложки и предлагало кнопку,
//      которая закрывала его и уводила на холст: человек, пришедший обводить
//      план, выставлялся из мастерской прежде, чем что-то увидел. Теперь у
//      окна есть нулевое занятие — `WORKSHOP_TOOL_SCALE`, — и в нём кадр
//      меряется **точками подложки, а не миллиметрами**: картинка видна
//      целиком, отрезок калибровки проводится по ней же, метры спрашиваются
//      тут же, и в объект уходит `setPlanScale` через `canvasCommit`. Ни
//      сетки, ни чертежа в этом кадре нет — миллиметр в нём ещё ничему не
//      равен, и рисовать в нём нечем. Масштаб задан — окно само берётся за
//      стены и вписывает план заново.
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
import { strings, text } from "../strings.js";
import {
  DRAWING_MM_MAX,
  OPENING_HINGES,
  OPENING_KINDS,
  OPENING_KIND_DOOR,
  OPENING_SWINGS,
  PLAN_SCALE_SHORT_SHARE,
  SCHEME_OBJECT_SHAPES,
  WALL_THICKNESS_MM_MAX,
  addOpening,
  addSchemeObject,
  addSchemeObjectKind,
  addWall,
  deleteOpening,
  deleteSchemeObject,
  deleteWall,
  drawingBoundsMm,
  drawingMmValue,
  ensureSchemeObjectKinds,
  findOpening,
  findRoom,
  findScheme,
  findSchemeObject,
  findSchemeObjectKind,
  findWall,
  formatMeters,
  openingsInWall,
  planFractionToMm,
  planOriginOf,
  planPixelsPerMeter,
  planScaleShort,
  planSizeMeters,
  roomsInOrder,
  schemeObjectCorners,
  schemeObjectKindsInOrder,
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
  wallVectors,
  wallsOnScheme,
} from "../model.js";
import {
  canvasPanSpeed,
  canvasPanVector,
  canvasPinchWheel,
  canvasRedoStep,
  canvasScaleMeters,
  canvasUndoStep,
  canvasWheelKind,
  canvasZoomFactor,
  canvasCommit,
} from "../canvas.js";
import {
  DRAWING_ACTIVE,
  DRAWING_EDGE,
  DRAWING_OBJECT,
  DRAWING_PAPER,
  drawDrawing,
  drawDrawingOpening,
  drawingDoorLeaf,
  drawingHitObject,
  drawingOpeningSpan,
  drawingUnitBridge,
  draftSnap,
  drawFont,
  planToScreen,
  screenToPlan,
} from "../render.js";
import { uiButton, uiConfirm, uiDialogDepth, uiEl, uiIconButton, uiModal, uiPrompt } from "./ui.js";
import { createElevationStrip, elevationPlace } from "./elevation.js";

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

// Занятие «Масштаб» (таск 132) меряет кадр **точками подложки**, а не
// миллиметрами, и предел у него поэтому свой: восемь пикселей экрана на точку
// плана — чтобы конец стены на фотографии было чем поймать точно.
export const WORKSHOP_TOOL_SCALE = "scale";
export const WORKSHOP_PLAN_ZOOM_MAX = 8;

// Пороги попадания в пикселях экрана, как у холста: иначе на разном масштабе
// всё ведёт себя по-разному. Вершина ловится шире тела стены — ею правят.
export const WORKSHOP_VERTEX_PX = 9;
export const WORKSHOP_WALL_PX = 6;

// Пока палец не сдвинулся на столько, это клик, а не перетаскивание.
const WORKSHOP_DRAG_SLOP = 3;

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
 * Росчерк — в отрезки. **Концы соседних стен — один и тот же объект точки**, и
 * равенство в данных поэтому не «почти», а буква в букву: модель переписывает
 * обе копии одним `drawingPointMm`, целые миллиметры совпадают равенством, и
 * цепочка стен становится графом, из которого вырастет развёртка (G177).
 *
 * Подряд идущие совпадающие вершины выбрасываются: два клика в одну точку —
 * это один клик, а не стена нулевой длины.
 */
export function workshopChain(pointsMm) {
  const points = [];
  for (const point of Array.isArray(pointsMm) ? pointsMm : []) {
    const last = points[points.length - 1];
    if (last && last.x === point.x && last.y === point.y) continue;
    points.push({ x: point.x, y: point.y });
  }
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

// ——— занятие «Масштаб»: кадр в точках подложки ————————————————————————
//
// **Картинку можно показать без калибровки, чертёж — нельзя.** Разница в том,
// чем меряется кадр. Миллиметр без пикселей на метр не считается ни во что —
// значит кадр, размеченный в миллиметрах, подложку принять не может. Но кадр,
// размеченный **точками самой подложки**, принимает её без единого допущения:
// точка плана — это точка плана, а не «примерно столько-то миллиметров».
//
// Поэтому у занятия «Масштаб» единица — точка подложки. `WORKSHOP_UNIT` и
// `view` при этом те же: `zoom` читается как «пикселей экрана на точку плана»,
// и `render.planToScreen`/`screenToPlan`/`draftSnap` работают без правок — как
// и в миллиметровом кадре. Своей арифметики не появляется ни строки.
//
// Чего в этом кадре нет: сетки, нуля и чертежа. Все трое живут в миллиметрах,
// а миллиметр здесь ещё ничему не равен — нарисовать их значило бы соврать о
// размерах. Нарисовать стену в этом кадре тоже нельзя, и это то самое честное
// ограничение: калибровка пересчитывает доли разметки, но миллиметры уже
// нарисованных стен не трогает.

/**
 * Габарит подложки в её собственных точках — кадр занятия «Масштаб».
 * `null` — показывать нечего: размера у схемы нет (её и калибровать нечем).
 */
export function workshopPlanExtent(project, schemeId) {
  const scheme = findScheme(project, schemeId);
  const width = Number(scheme && scheme.width) || 0;
  const height = Number(scheme && scheme.height) || 0;
  if (!(width > 0) || !(height > 0)) return null;
  return { minX: 0, minY: 0, maxX: width, maxY: height };
}

/**
 * Точка подложки (её точки) — в долю плана 0…1, как точки меток (ADR 002).
 * Доля зажимается: конец отрезка, выведенный за край картинки, принадлежит
 * краю, а не пустоте за ним.
 */
export function workshopPlanFraction(project, schemeId, pointPx) {
  const extent = workshopPlanExtent(project, schemeId);
  if (!extent || !pointPx) return null;
  const share = (value, size) => Math.min(1, Math.max(0, Number(value) / size));
  return { x: share(pointPx.x, extent.maxX), y: share(pointPx.y, extent.maxY) };
}

/**
 * Чем окно занято при открытии. Подложка без калибровки — **масштабом**: там
 * без него не нарисовать ни стены, и человек, пришедший обводить план, первым
 * делом обязан увидеть сам план (дефект D22). Во всех остальных случаях —
 * стенами, как было.
 */
export function workshopInitialTool(project, schemeId) {
  return workshopPlacement(project, schemeId).kind === "noScale" ? WORKSHOP_TOOL_SCALE : "walls";
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

// ——— объекты на полу: умолчания по виду ————————————————————————————————
//
// Виды пополняются человеком, а умолчания привязаны к стартовым девяти —
// сопоставление идёт **по имени** (к id справочника привязываться нельзя,
// `schemeObjectKindTemplate` выдаёт свежие на каждый вызов). Незнакомому виду
// достаётся `WORKSHOP_OBJECT_FALLBACK`: квадрат, который человек поправит.
//
// Числа — то, что стоит в квартире. Два вида выверены отдельно, потому что
// ради них объекты и заведены (таск 122): **радиатор** 1200 × 100, высота 500,
// от пола 150 — он висит под окном ровно там, где хочется розетка; и
// **столешница** полосой 600 мм, верх на 900 (860 + 40) — от этого числа
// отмеряют розетки над кухонным фронтом.
export const WORKSHOP_OBJECT_DEFAULTS = {
  column: { shape: "rect", widthMm: 400, depthMm: 400, heightMm: null, heightAboveFloorMm: 0 },
  niche: { shape: "rect", widthMm: 1000, depthMm: 300, heightMm: null, heightAboveFloorMm: 0 },
  duct: { shape: "rect", widthMm: 300, depthMm: 300, heightMm: null, heightAboveFloorMm: 0 },
  stairs: { shape: "rect", widthMm: 1100, depthMm: 2700, heightMm: null, heightAboveFloorMm: 0 },
  panel: { shape: "rect", widthMm: 600, depthMm: 150, heightMm: 800, heightAboveFloorMm: 1000 },
  radiator: { shape: "rect", widthMm: 1200, depthMm: 100, heightMm: 500, heightAboveFloorMm: 150 },
  counter: { shape: "polyline", depthMm: 600, heightMm: 40, heightAboveFloorMm: 860 },
  plumbing: { shape: "rect", widthMm: 700, depthMm: 400, heightMm: 400, heightAboveFloorMm: 0 },
  cabinet: { shape: "rect", widthMm: 1000, depthMm: 600, heightMm: 2200, heightAboveFloorMm: 0 },
};

export const WORKSHOP_OBJECT_FALLBACK = {
  shape: "rect",
  widthMm: 600,
  depthMm: 600,
  heightMm: null,
  heightAboveFloorMm: 0,
};

function workshopKindKeyByName(name) {
  const wanted = String(name == null ? "" : name).trim().toLowerCase();
  for (const key of Object.keys(WORKSHOP_OBJECT_DEFAULTS)) {
    if (String(strings.schemeObjectKinds[key] || "").toLowerCase() === wanted) return key;
  }
  return null;
}

/**
 * Умолчания вида — **по имени**, а не по id: `schemeObjectKindTemplate` выдаёт
 * свежие идентификаторы на каждый вызов, привязываться к ним нельзя (то же
 * правило, что у `defaultTemplate`). Имени хватает: справочник пополняет
 * человек, и своему виду он даст своё имя, а не чужое.
 */
export function workshopObjectDefaultsByName(name) {
  const key = workshopKindKeyByName(name);
  return { ...(key ? WORKSHOP_OBJECT_DEFAULTS[key] : WORKSHOP_OBJECT_FALLBACK) };
}

export function workshopObjectDefaults(project, kindId) {
  const kind = findSchemeObjectKind(project, kindId);
  return workshopObjectDefaultsByName(kind ? kind.name : null);
}




/**
 * Что под курсором на чертеже. Старшинство названо здесь целиком, потому что
 * спорят теперь четверо:
 *
 *   1. **ручки створки выделенной двери** — ими её и переключают, и стоят они
 *      поверх самой двери;
 *   2. **вершина стены** — ею правят угол, промах по ней обиднее всего;
 *   3. **проём** — он лежит в стене, и клик по нему должен брать его, а не
 *      стену под ним;
 *   4. **объект на полу** — он внутри комнаты, стен там обычно нет;
 *   5. **тело стены** — последнее, и порог растёт с толщиной.
 */
export function workshopPick(project, schemeId, pointMm, view, selected) {
  const walls = wallsOnScheme(project, schemeId);
  const zoom = Number(view && view.zoom) > 0 ? Number(view.zoom) : 1;
  const vertexMm = WORKSHOP_VERTEX_PX / zoom;
  const slackMm = WORKSHOP_WALL_PX / zoom;
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
  const objects = schemeObjectsOnScheme(project, schemeId);
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
 * Зажать масштаб окна. Потолок — довод: у миллиметрового кадра он свой
 * (`WORKSHOP_ZOOM_MAX`), у кадра занятия «Масштаб» — свой
 * (`WORKSHOP_PLAN_ZOOM_MAX`): единица там в сотни раз крупнее, и один предел
 * на оба не годится.
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
export function workshopHint(tool) {
  // Слова калибровки — те самые, что над холстом: жест один и тот же, и
  // второго описания одного жеста в сборке быть не должно.
  if (tool === WORKSHOP_TOOL_SCALE) return strings.scale.hint;
  if (tool === "openings") return strings.workshop.hintOpenings;
  if (tool === "objects") return strings.workshop.hintObjects;
  if (tool === "edit") return strings.workshop.hintEdit;
  return strings.workshop.hint;
}

/**
 * Строка состояния схемы: какой это из трёх случаев, что в чертеже и сколько
 * стен. Чистая — слова про случай «молча рисовать в никуда нельзя» решаются
 * здесь и проверяются без браузера.
 */
export function workshopStatus(project, schemeId, placement) {
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
  return parts.join(" · ");
}

// ——— окно ——————————————————————————————————————————————————————————————

// Что человек выбрал в окне — его рабочее место, а не свойство объекта: слои,
// шаг сетки, притяжка и толщина новых стен живут в памяти страницы и переживают
// закрытие окна, но в `project.json` не попадают.
let workshopLayers = { plan: true, grid: true, walls: true, objects: true };
let workshopGridMm = WORKSHOP_GRID_DEFAULT_MM;
let workshopGridSnap = true;
let workshopThicknessMm = WORKSHOP_THICKNESS_DEFAULT_MM;
// Умолчания проёмов — по виду и на сеанс: поправил окно на 1300, и следующее
// окно встанет 1300, а дверь останется дверью.
let workshopOpeningKind = OPENING_KINDS[0];
let workshopOpeningSizes = JSON.parse(JSON.stringify(WORKSHOP_OPENING_DEFAULTS));
let workshopDoorHinge = OPENING_HINGES[0];
let workshopDoorSwing = OPENING_SWINGS[0];
// Объекты: вид выбирается в колонке, размеры подставляются по виду, форма —
// от вида же (столешница полосой, остальное прямоугольником).
let workshopObjectKindName = strings.schemeObjectKinds.radiator;
let workshopObjectShape = SCHEME_OBJECT_SHAPES[0];
let workshopObjectSizes = {};
let workshopOpened = false;

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
 * Открыть мастерскую для схемы.
 *
 * Про калибровку окно больше ничего не спрашивает у вызывающего: она делается
 * здесь же, занятием `WORKSHOP_TOOL_SCALE`. Прежний довод `onCalibrate` уводил
 * на холст, закрывая окно, — и это и был дефект D22.
 */
export function openWorkshop({ schemeId, api }) {
  if (workshopOpened) return null;
  const { getState, setState, notify, subscribe } = api;
  if (!findScheme(getState().project, schemeId)) return null;
  workshopOpened = true;

  // Чем окно занято при открытии: подложка без калибровки — масштабом, иначе
  // стенами. Пришёл обводить план — первым делом видит план.
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
  // Отрезок калибровки — `{pointsPx: [точки подложки], cursorPx}`. Живёт
  // отдельно от `draft`: тот в миллиметрах, а этот в точках плана, и путать их
  // нельзя даже на один кадр.
  let scaleDraft = null;
  let drag = null;
  let pan = null;
  // Нажатие, которое ещё не решило, чем станет: клик занятия или панорама.
  // Решает это сдвиг руки, а решение принимается по отпусканию — ровно как на
  // холсте (дефект D23, «навигация должна быть как и у схемы»).
  let press = null;
  let hover = null;
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
  });
  const node = uiEl("canvas", { class: "workshop__canvas" });
  // Поле забирает фокус по нажатию: иначе после правки толщины фокус остаётся
  // в поле ввода, а Ctrl+Z там принадлежит браузеру — человек жмёт отмену над
  // чертежом и не получает ничего. То же правило, что у холста
  // (`canvasKeyboardOwner`): работают с чертежом — клавиатура его.
  const stage = uiEl("div", { class: "workshop__stage", attrs: { tabindex: "-1" } }, [node, strip.node]);
  const ctx = node.getContext ? node.getContext("2d") : null;

  // ——— левая часть: инструменты над полем ———
  //
  // «Масштаб» стоит первым и показывается только у подложки без калибровки:
  // там он — нулевой шаг работы, а везде ещё он не нужен и занимал бы место в
  // ряду, который и так дорос до семи кнопок.
  const scaleButton = uiButton(strings.workshop.toolScale, {
    title: strings.workshop.toolScaleHint,
    on: { click: () => setTool(WORKSHOP_TOOL_SCALE) },
  });
  const wallsButton = uiButton(strings.workshop.toolWalls, {
    title: strings.workshop.toolWallsHint,
    on: { click: () => setTool("walls") },
  });
  // Порядок кнопок — порядок работы, заданный заказчиком (G176): сперва
  // стены, потом проёмы, потом объекты. Правка последняя: ею пользуются после.
  const openingsButton = uiButton(strings.workshop.toolOpenings, {
    title: strings.workshop.toolOpeningsHint,
    on: { click: () => setTool("openings") },
  });
  const objectsButton = uiButton(strings.workshop.toolObjects, {
    title: strings.workshop.toolObjectsHint,
    on: { click: () => setTool("objects") },
  });
  const editButton = uiButton(strings.workshop.toolEdit, {
    title: strings.workshop.toolEditHint,
    on: { click: () => setTool("edit") },
  });
  const zoomOut = uiIconButton("minus", {
    title: strings.tools.zoomOut,
    on: { click: () => zoomBy(1 / WORKSHOP_ZOOM_KEY_STEP) },
  });
  const zoomIn = uiIconButton("plus", {
    title: strings.tools.zoomIn,
    on: { click: () => zoomBy(WORKSHOP_ZOOM_KEY_STEP) },
  });
  const fitButton = uiButton(strings.workshop.fit, { on: { click: () => fit() } });
  const meta = uiEl("p", { class: "workshop__meta" });
  const hint = uiEl("p", { class: "modal__hint", text: workshopHint("walls") });

  // ——— правая часть: слои, сетка, стена, высоты ———
  const planCheck = uiEl("input", { type: "checkbox" });
  const gridCheck = uiEl("input", { type: "checkbox" });
  const wallsCheck = uiEl("input", { type: "checkbox" });
  const objectsCheck = uiEl("input", { type: "checkbox" });
  objectsCheck.addEventListener("change", () => {
    workshopLayers = { ...workshopLayers, objects: objectsCheck.checked };
    sync();
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
  // Кнопка больше не закрывает окно: она берётся за занятие «Масштаб» здесь же.
  const calibrateButton = uiButton(strings.workshop.calibrate, {
    class: "ui-btn ui-btn--wide",
    title: strings.workshop.calibrateHint,
    on: { click: () => setTool(WORKSHOP_TOOL_SCALE) },
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

  const objectKindSelect = uiEl("select", { class: "ui-input" });
  objectKindSelect.addEventListener("change", () => setObjectKind(objectKindSelect.value));
  const objectKindAdd = uiButton(strings.workshop.objectKindAdd, {
    class: "ui-btn workshop__chip",
    title: strings.workshop.objectKindAddHint,
    on: { click: () => addObjectKind() },
  });
  const shapeButtons = SCHEME_OBJECT_SHAPES.map((shape) =>
    uiButton(strings.workshop["shape_" + shape], {
      class: "ui-btn workshop__chip",
      on: { click: () => setObjectShape(shape) },
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
  const objectFields = uiEl("div", { class: "workshop__fields" }, [
    uiEl("div", { class: "workshop__chips" }, [objectKindSelect, objectKindAdd]),
    uiEl("div", { class: "workshop__chips" }, shapeButtons),
    widthField,
    depthField,
    turnField,
    workshopField(strings.workshop.objectHeight, objectHeight),
    workshopField(strings.workshop.objectFloor, objectFloor),
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

  const body = uiEl("div", { class: "workshop" }, [
    uiEl("div", { class: "workshop__main" }, [
      uiEl("div", { class: "workshop__tools" }, [
        scaleButton,
        wallsButton,
        openingsButton,
        objectsButton,
        editButton,
        zoomOut,
        zoomIn,
        fitButton,
      ]),
      stage,
      meta,
      hint,
    ]),
    side,
  ]);

  const scheme = findScheme(getState().project, schemeId);
  const closeButton = uiButton(strings.workshop.close, {
    class: "ui-btn ui-btn--accent",
    on: { click: () => finish() },
  });
  const modal = uiModal({
    title: text("workshop.title", { name: scheme.name }),
    body,
    actions: [closeButton],
    onCancel: () => cleanup(),
  });
  modal.card.classList.add("modal--workshop");
  // Глубина стопки диалогов на момент открытия: пока она такая же, клавиатура
  // наша. Поверх мастерской встают подтверждения — им она уступает, как и
  // холст уступает ей самой.
  const depth = uiDialogDepth();

  // ——— состояние объекта ———

  function project() {
    return getState().project;
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

  // Занятие «Масштаб» меряет кадр точками подложки — у него свой габарит и
  // свой потолок увеличения. Одна дверь на оба кадра: разойдись «что вписать»
  // и «что нарисовать», картинка уехала бы за край поля.
  function scaleMode() {
    return tool === WORKSHOP_TOOL_SCALE;
  }

  function zoomCeiling() {
    return scaleMode() ? WORKSHOP_PLAN_ZOOM_MAX : WORKSHOP_ZOOM_MAX;
  }

  function fit() {
    const planExtent = scaleMode() ? workshopPlanExtent(project(), schemeId) : null;
    view = planExtent
      ? workshopFitView(planExtent, viewport(), WORKSHOP_PLAN_ZOOM_MAX)
      : workshopFitView(workshopExtentMm(project(), schemeId, placement()), viewport());
    sync();
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

  // ——— инструменты ———

  function setTool(next) {
    if (tool === next) return;
    const was = tool;
    draft = null;
    ghost = null;
    scaleDraft = null;
    press = null;
    // Выделение снимается вместе со сменой занятия: иначе поля выделенной
    // стены перебивали бы умолчания проёма, за которым человек и переключился.
    selected = null;
    tool = next;
    // Кадр у занятия «Масштаб» свой — точки подложки вместо миллиметров, — и
    // при переходе в любую сторону смысл `view` меняется целиком: без нового
    // «вписать» план уехал бы за край поля в тысячу крат.
    if (was === WORKSHOP_TOOL_SCALE || next === WORKSHOP_TOOL_SCALE) {
      fit();
      if (next === WORKSHOP_TOOL_SCALE) notify(strings.scale.started);
      // Ушли от масштаба, а масштаба так и нет — подложка в поле гаснет.
      // Молчать об этом нельзя: именно это молчание заказчик и увидел.
      else if (placement().kind === "noScale") notify(strings.workshop.scaleFirst);
      return;
    }
    sync();
  }

  function select(next) {
    const same = Boolean(selected) === Boolean(next) && (!next || (selected.kind === next.kind && selected.id === next.id));
    if (same) return;
    selected = next;
    // Выделенная стена попадает и в состояние сеанса: закрыли окно — её
    // развёртка осталась открытой над основным холстом, и искать стену заново
    // не надо.
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
    if (tool === WORKSHOP_TOOL_SCALE) return WORKSHOP_TOOL_SCALE;
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

  // Справочник видов заводится **по первой надобности и через canvasCommit**
  // (договор таска 123): объект без чертежа не должен носить девять видов с
  // собой. Поэтому `ensureSchemeObjectKinds` зовётся здесь, в минуту первого
  // объекта, а не при открытии окна.
  function withKinds() {
    const ready = ensureSchemeObjectKinds(workshopEnsureSheet(project(), schemeId).project);
    return { project: ready.project, added: ready.added };
  }

  function currentKindId(source) {
    const list = schemeObjectKindsInOrder(source);
    if (list.length === 0) return null;
    const found = list.find((kind) => kind.name === workshopObjectKindName);
    return (found || list[0]).id;
  }

  function setObjectKind(name) {
    workshopObjectKindName = name;
    workshopObjectSizes = {};
    const object = selectedObject();
    if (!object) {
      // Форма идёт за видом: столешницу тянут полосой, радиатор набирают
      // прямоугольником — и спрашивать об этом отдельно незачем.
      workshopObjectShape = workshopObjectDefaultsByName(name).shape;
      sync();
      return;
    }
    const kindId = currentKindId(project());
    if (!kindId) return;
    try {
      commit(updateSchemeObject(project(), object.id, { kindId }).project, strings.history.objectEdit);
    } catch (error) {
      fail(error);
      sync();
    }
  }

  function setObjectShape(shape) {
    if (selectedObject()) return;
    workshopObjectShape = shape;
    workshopObjectSizes = {};
    draft = null;
    sync();
  }

  async function addObjectKind() {
    const name = await uiPrompt({ title: strings.workshop.objectKindAddTitle });
    if (!name) return;
    const ready = withKinds();
    let next = ready.project;
    try {
      const added = addSchemeObjectKind(next, { name });
      next = added.project;
      workshopObjectKindName = added.schemeObjectKind.name;
      workshopObjectSizes = {};
      canvasCommit(project(), next, strings.history.objectKindAdd, { schemeId });
    } catch (error) {
      fail(error);
    }
    sync();
  }

  // Умолчания берутся по **имени** вида, а не по его id: до первого объекта
  // справочника в объекте ещё нет (он заводится вместе с объектом), и id
  // взяться неоткуда — а показать размеры радиатора надо уже сейчас.
  function objectSizes(source, kindId) {
    const kind = kindId ? findSchemeObjectKind(source, kindId) : null;
    const defaults = workshopObjectDefaultsByName(kind ? kind.name : workshopObjectKindName);
    return { ...defaults, ...workshopObjectSizes, shape: workshopObjectShape };
  }

  function placeObject(pointMm, pointsMm) {
    const ready = withKinds();
    const kindId = currentKindId(ready.project);
    if (!kindId) return;
    const sizes = objectSizes(ready.project, kindId);
    const fields =
      sizes.shape === "polyline"
        ? { shape: "polyline", pointsMm, depthMm: sizes.depthMm }
        : {
            shape: "rect",
            atMm: pointMm,
            widthMm: sizes.widthMm,
            depthMm: sizes.depthMm,
            turnDeg: sizes.turnDeg || 0,
          };
    try {
      const added = addSchemeObject(ready.project, {
        schemeId,
        kindId,
        heightMm: sizes.heightMm,
        heightAboveFloorMm: sizes.heightAboveFloorMm,
        ...fields,
      });
      // Как и проём, поставленный объект себя не выделяет: иначе выбор вида в
      // колонке стал бы правкой только что поставленного.
      commit(added.project, strings.history.objectAdd);
    } catch (error) {
      fail(error);
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

  // ——— масштаб: отрезок по той же картинке, которую собираются обводить ———
  //
  // Жест тот же, что на холсте (`CANVAS_MODE_SCALE`, таск 111): клик — первый
  // конец, второй клик — второй, потом вопрос о расстоянии. Общие здесь не
  // строки и не рука, а **проверки**: короткий отрезок (`planScaleShort`),
  // разбор набранного (`canvasScaleMeters`) и запись (`setPlanScale`) взяты
  // готовыми. Своё — только кадр в точках подложки.

  function scalePointOf(event) {
    return screenToPlan(pointOf(event), WORKSHOP_UNIT, view);
  }

  function scaleSnapOf(event) {
    const points = scaleDraft ? scaleDraft.pointsPx : [];
    return draftSnap(points, scalePointOf(event), WORKSHOP_UNIT, view, event.altKey ? { free: true } : {});
  }

  function scaleClick(event) {
    if (!workshopPlanExtent(project(), schemeId)) return;
    const snap = scaleSnapOf(event);
    if (!scaleDraft) {
      scaleDraft = { pointsPx: [snap.point], cursorPx: snap.point };
      paint();
      return;
    }
    // Второй клик в ту же точку — промах, а не отрезок: калибровать по нулю
    // нельзя, и отвечать на это ошибкой было бы грубо. Та же примета, что на
    // холсте, и тот же порог в пикселях экрана.
    const first = screenOf(scaleDraft.pointsPx[0]);
    const at = pointOf(event);
    if (Math.hypot(at.x - first.x, at.y - first.y) <= WORKSHOP_VERTEX_PX) return;
    scaleDraft = { pointsPx: [scaleDraft.pointsPx[0], snap.point], cursorPx: snap.point };
    paint();
    askMeters();
  }

  function cancelScale(said) {
    scaleDraft = null;
    if (said) notify(strings.scale.cancelled);
    paint();
  }

  // Вопрос о расстоянии. Короткий отрезок не проходит молча: сперва
  // предупреждение, и только потом цифра. Диалог живёт дольше черновика —
  // за это время могли отменить, сменить занятие или закрыть окно, и тогда
  // отрезок уже ничей.
  async function askMeters() {
    const own = scaleDraft;
    if (!own || own.pointsPx.length < 2) return;
    const a = workshopPlanFraction(project(), schemeId, own.pointsPx[0]);
    const b = workshopPlanFraction(project(), schemeId, own.pointsPx[1]);
    if (!a || !b) {
      cancelScale(false);
      return;
    }
    if (planScaleShort(project(), schemeId, { a, b })) {
      const go = await uiConfirm({
        title: strings.scale.shortTitle,
        message: text("scale.shortAsk", { share: Math.round(PLAN_SCALE_SHORT_SHARE * 100) }),
        confirmLabel: strings.scale.shortAnyway,
      });
      if (closed || scaleDraft !== own) return;
      if (!go) {
        cancelScale(true);
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
      if (closed || scaleDraft !== own) return;
      if (raw === null) {
        cancelScale(true);
        return;
      }
      typed = raw;
      const meters = canvasScaleMeters(raw);
      // Опечатку не проглатываем и работу не теряем: отрезок на месте, вопрос
      // задаётся снова с тем, что было набрано.
      if (meters === null) {
        notify(strings.scale.badMeters, "error");
        continue;
      }
      applyScale(a, b, meters);
      return;
    }
  }

  function applyScale(a, b, meters) {
    try {
      const result = setPlanScale(project(), schemeId, { a, b, meters });
      scaleDraft = null;
      // Через ту же дверь, что и всё остальное: Ctrl+Z возвращает прежнее
      // «масштаба нет» — и подложка снова гаснет, как и была.
      commit(result.project, strings.history.scaleSet);
      const size = planSizeMeters(project(), schemeId);
      notify(
        text("scale.applied", {
          meters: formatMeters(result.scale.meters),
          width: size ? formatMeters(size.width) : "",
          height: size ? formatMeters(size.height) : "",
        }),
        "success",
      );
      // Масштаб есть — подложку теперь есть на что положить, и окно само
      // берётся за стены: за ними человек и пришёл.
      setTool("walls");
    } catch (error) {
      scaleDraft = null;
      fail(error);
      sync();
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
        pinch = { ...pinchNow(), zoom: view.zoom };
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
      const pick = workshopPick(project(), schemeId, mmOf(event), view, selected);
      if (pick) {
        grab(pick, event);
        return;
      }
    }
    // Всё остальное — нажатие без решения: поехала рука — панорама, не поехала
    // — клик занятия.
    press = { x: event.clientX, y: event.clientY };
  });

  // Что берёт «Правка» под руку. Ручки створки ничего не таскают — они
  // переключают дверь по нажатию: перетаскиванием дверь не «приоткроешь», у
  // неё четыре положения, а не непрерывный угол.
  function grab(pick, event) {
    if (pick.kind === "hinge" || pick.kind === "swing") {
      flipDoor(pick.kind);
      return;
    }
    // Ручки створки ничего не таскают — они переключают дверь по нажатию:
    // перетаскиванием дверь не «приоткроешь», у неё четыре положения, а не
    // непрерывный угол.
    if (pick.kind === "hinge" || pick.kind === "swing") {
      flipDoor(pick.kind);
      return;
    }
    select(pick.kind === "vertex" ? { kind: "wall", id: pick.wallId } : { kind: pick.kind, id: pick.id });
    drag = {
      kind: pick.kind,
      id: pick.id,
      wallId: pick.wallId,
      atMm: pick.atMm,
      fromMm: pick.atMm,
      startMm: mmOf(event),
      start: { x: event.clientX, y: event.clientY },
      moved: false,
    };
  }

  /**
   * Клик занятия: рука не поехала, и жест оказался не панорамой.
   *
   * Точка берётся из события отпускания, а не нажатия: разошлись они не больше
   * чем на `WORKSHOP_DRAG_SLOP` пикселей — иначе этот путь бы и не вызвался, —
   * и притяжка всё равно ставит вершину в узел или на ровный угол.
   */
  function tap(event) {
    if (scaleMode()) {
      scaleClick(event);
      return;
    }
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
      if (workshopObjectShape === "polyline") addVertex(event);
      else placeObject(snapOf(mmOf(event), event.altKey).point, null);
      return;
    }
    // «Правка» по пустому месту снимает выделение — как клик по пустому месту
    // на холсте. Взятое под руку сюда не доходит: оно ушло в `drag`.
    select(null);
  }

  function pinchNow() {
    const [first, second] = [...fingers.values()];
    return {
      distance: Math.hypot(first.x - second.x, first.y - second.y),
      center: { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 },
    };
  }

  function addVertex(event) {
    const snap = snapOf(mmOf(event), event.altKey);
    if (!draft) {
      draft = { points: [snap.point], cursor: snap.point, snap };
      paint();
      return;
    }
    // Клик по последней вершине ничего не добавляет: это первая половина
    // двойного клика, которым цепочку заканчивают. Та же примета, что на холсте.
    const last = draft.points[draft.points.length - 1];
    if (last.x === snap.point.x && last.y === snap.point.y) return;
    draft.points.push(snap.point);
    draft.cursor = snap.point;
    draft.snap = snap;
    paint();
  }

  stage.addEventListener("dblclick", (event) => {
    event.preventDefault();
    if (tool === "walls") finishChain();
    else if (tool === "objects" && workshopObjectShape === "polyline") finishBand();
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

  function onPointerMove(event) {
    if (closed) return;
    if (fingers.has(event.pointerId)) {
      fingers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pinch && fingers.size >= 2) {
        const now = pinchNow();
        const rect = node.getBoundingClientRect();
        panBy(now.center.x - pinch.center.x, now.center.y - pinch.center.y);
        if (pinch.distance > 0 && now.distance > 0) {
          zoomAt({ x: now.center.x - rect.left, y: now.center.y - rect.top }, now.distance / pinch.distance);
        }
        pinch = now;
        return;
      }
    }
    // Нажатие, которое поехало, становится панорамой — и дальше ведёт её
    // обычная ветка. Отсчёт идёт от точки нажатия, а не от этого события:
    // иначе первые три пикселя терялись бы и план отставал от руки.
    if (press) {
      if (Math.hypot(event.clientX - press.x, event.clientY - press.y) < WORKSHOP_DRAG_SLOP) return;
      pan = { x: press.x, y: press.y };
      press = null;
    }
    if (pan) {
      panBy(event.clientX - pan.x, event.clientY - pan.y);
      pan = { x: event.clientX, y: event.clientY };
      return;
    }
    if (drag) {
      if (!drag.moved && Math.hypot(event.clientX - drag.start.x, event.clientY - drag.start.y) < WORKSHOP_DRAG_SLOP) {
        return;
      }
      drag.moved = true;
      dragTo(event);
      return;
    }
    // Отрезок калибровки тянется от первого конца, как резинка ломаной: до
    // первого клика тянуть не от чего.
    if (scaleMode()) {
      if (!scaleDraft) return;
      scaleDraft.cursorPx = scaleSnapOf(event).point;
      redraw();
      return;
    }
    if (tool === "walls" || (tool === "objects" && workshopObjectShape === "polyline")) {
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
    if (tool === "objects") {
      ghost = null;
      return;
    }
    const pick = workshopPick(project(), schemeId, mmOf(event), view, selected);
    const next = pick ? pick.kind + ":" + pick.id : null;
    if (next !== hover) {
      hover = next;
      node.style.cursor = !pick
        ? "default"
        : pick.kind === "vertex"
          ? "grab"
          : pick.kind === "hinge" || pick.kind === "swing"
            ? "pointer"
            : "move";
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
      paint();
      return;
    }
    try {
      if (current.kind === "vertex" && current.toMm) {
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
      // Колесо и щипок разбираются теми же приметами, что на холсте и в окне
      // загрузки плана: одно и то же колесо в трёх местах приложения не должно
      // делать разного.
      const kind = canvasWheelKind(event, streak);
      streak = { kind, time: event.timeStamp };
      if (kind === "pan") return;
      event.preventDefault();
      const rect = node.getBoundingClientRect();
      zoomAt(
        { x: event.clientX - rect.left, y: event.clientY - rect.top },
        canvasZoomFactor(event, canvasPinchWheel(event)),
      );
    },
    { passive: false },
  );

  // ——— клавиатура ———
  //
  // Пока мастерская — верхний диалог, клавиатура её: холст уступает её сам
  // (`uiDialogDepth() > 0`), а подтверждению поверх неё уступает она. Ctrl+Z
  // поэтому приходится вести самим — иначе отмены в окне не было бы вовсе.
  function onKeyDown(event) {
    if (closed || uiDialogDepth() !== depth) return;
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
    if (event.key === "Escape" && scaleDraft) {
      event.preventDefault();
      event.stopPropagation();
      cancelScale(true);
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
      if (tool === "objects") finishBand();
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
    // Кадр занятия «Масштаб» меряется точками подложки: в нём только картинка
    // и отрезок. Сетка, нуль и чертёж живут в миллиметрах, а миллиметр здесь
    // ещё ничему не равен — нарисовать их значило бы соврать о размерах.
    if (scaleMode()) {
      paintScalePlan(box);
      paintScaleDraft();
      return;
    }
    const spot = placement();
    if (workshopLayers.plan && spot.kind === "ready") paintPlan(spot, box);
    if (workshopLayers.grid) paintGrid(box);
    if (spot.kind === "ready") paintOrigin();
    // Объекты под стенами: колонна в стене и короб у стены принадлежат полу, а
    // стена — главное на чертеже, и прятать её под габаритом нельзя.
    paintDrawing();
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

  /**
   * Подложка в своём кадре: точка плана — единица, левый верхний угол в нуле.
   * Поворота здесь нет вовсе и быть не может: поворот — это угол **осей
   * чертежа** к осям плана, а чертежа в этом кадре нет.
   */
  function paintScalePlan(box) {
    const bitmap = image();
    const extent = workshopPlanExtent(project(), schemeId);
    if (!bitmap || !extent) return;
    const zero = screenOf({ x: 0, y: 0 });
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, box.width, box.height);
    ctx.clip();
    ctx.translate(zero.x, zero.y);
    ctx.scale(view.zoom, view.zoom);
    try {
      ctx.drawImage(bitmap, 0, 0, extent.maxX, extent.maxY);
    } catch (error) {
      // Картинку могли закрыть (схему переключили) — кадр не повод падать.
    }
    ctx.restore();
  }

  // Отрезок калибровки: концы ручками, как у вершин цепочки, — ими и целятся.
  function paintScaleDraft() {
    if (!scaleDraft) return;
    const points = [...scaleDraft.pointsPx];
    if (points.length < 2) points.push(scaleDraft.cursorPx);
    ctx.lineCap = "round";
    ctx.lineWidth = 2;
    ctx.strokeStyle = WORKSHOP_ACCENT;
    ctx.beginPath();
    points.forEach((point, index) => {
      const at = screenOf(point);
      if (index === 0) ctx.moveTo(at.x, at.y);
      else ctx.lineTo(at.x, at.y);
    });
    ctx.stroke();
    ctx.lineCap = "butt";
    for (const point of points) handle(ctx, screenOf(point));
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
      objects: workshopLayers.objects,
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
    const band = tool === "objects" && workshopObjectShape === "polyline";
    if ((tool !== "walls" && !band) || !draft) return;
    const points = [...draft.points, draft.cursor];
    ctx.lineCap = "butt";
    ctx.lineJoin = "round";
    ctx.lineWidth = Math.max(1, (band ? bandWidthMm() : workshopThicknessMm) * view.zoom);
    ctx.strokeStyle = band ? DRAWING_OBJECT : WORKSHOP_ACCENT;
    ctx.globalAlpha = 0.5;
    ctx.beginPath();
    points.forEach((point, index) => {
      const at = screenOf(point);
      if (index === 0) ctx.moveTo(at.x, at.y);
      else ctx.lineTo(at.x, at.y);
    });
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.lineWidth = 1;
    ctx.strokeStyle = DRAWING_EDGE;
    ctx.beginPath();
    points.forEach((point, index) => {
      const at = screenOf(point);
      if (index === 0) ctx.moveTo(at.x, at.y);
      else ctx.lineTo(at.x, at.y);
    });
    ctx.stroke();
    for (const point of draft.points) handle(ctx, screenOf(point));
    // Длина набираемого отрезка — у курсора: стену рисуют по размеру, и
    // смотреть на панель в этот момент некогда.
    const last = draft.points[draft.points.length - 1];
    const length = Math.round(Math.hypot(draft.cursor.x - last.x, draft.cursor.y - last.y));
    if (length <= 0) return;
    const at = screenOf(draft.cursor);
    ctx.font = drawFont(13, 600);
    ctx.textBaseline = "bottom";
    ctx.lineWidth = 3;
    ctx.strokeStyle = WORKSHOP_PAPER;
    ctx.strokeText(String(length), at.x + 10, at.y - 8);
    ctx.fillStyle = DRAWING_EDGE;
    ctx.fillText(String(length), at.x + 10, at.y - 8);
  }

  // Ширина полосы нового объекта: из умолчаний вида, пока его не поправили.
  function bandWidthMm() {
    const ready = project();
    const kindId = currentKindId(ready);
    const sizes = objectSizes(ready, kindId);
    return Number(sizes.depthMm) || 600;
  }

  // ——— панель: значения и доступность ———

  function sync() {
    const current = project();
    const spot = placement();
    const wall = selectedWall();
    const scaling = scaleMode();
    wallsButton.className = "ui-btn" + (tool === "walls" ? " ui-btn--accent" : "");
    editButton.className = "ui-btn" + (tool === "edit" ? " ui-btn--accent" : "");
    // Кнопка масштаба стоит, пока масштаба нет, и пока им занимаются: иначе
    // она пропала бы из-под руки в тот же миг, когда занятие ещё идёт.
    scaleButton.hidden = spot.kind !== "noScale" && !scaling;
    scaleButton.className = "ui-btn" + (scaling ? " ui-btn--accent" : "");
    // Пока задают масштаб, в поле только план — отметка это и показывает, а
    // снять её нечем: другого кадра у занятия нет.
    planCheck.checked = scaling || (workshopLayers.plan && spot.kind === "ready");
    planCheck.disabled = scaling || spot.kind !== "ready";
    planRow.title = scaling
      ? strings.workshop.layerPlanScaling
      : spot.kind === "noImage"
        ? strings.workshop.layerPlanNone
        : spot.kind === "noScale"
          ? strings.workshop.layerPlanNoScale
          : "";
    calibrateButton.hidden = spot.kind !== "noScale" || scaling;
    attachButton.hidden = !spot.pending || scaling;
    gridCheck.checked = workshopLayers.grid && !scaling;
    wallsCheck.checked = workshopLayers.walls && !scaling;
    objectsCheck.checked = workshopLayers.objects && !scaling;
    // Слои миллиметрового кадра в кадре масштаба ничего не значат: живая на
    // вид отметка, которая ни на что не влияет, — обещание, которого окно не
    // держит.
    for (const check of [gridCheck, wallsCheck, objectsCheck]) check.disabled = scaling;
    gridSelect.disabled = scaling;
    snapCheck.disabled = scaling;
    gridSelect.value = String(workshopGridMm);
    snapCheck.checked = workshopGridSnap;
    openingsButton.className = "ui-btn" + (tool === "openings" ? " ui-btn--accent" : "");
    objectsButton.className = "ui-btn" + (tool === "objects" ? " ui-btn--accent" : "");
    syncSubject(current, wall);
    hint.textContent = workshopHint(tool);
    if (document.activeElement !== heightInput) {
      const own = findScheme(current, schemeId);
      heightInput.value = own && typeof own.wallHeightMm === "number" ? String(own.wallHeightMm) : "";
    }
    syncRooms(current);
    syncElevation(current, wall);
    meta.textContent = workshopStatus(current, schemeId, spot);
    node.style.cursor = tool === "edit" ? "default" : "crosshair";
    redraw();
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
    removeButton.disabled = !selected;
    removeButton.hidden = !selected;
    subjectNote.classList.remove("is-bad");
    // Масштаб: полей у него нет — он задаётся в поле, отрезком. Колонка
    // держит заголовок и то самое объяснение, которого прежде не получал
    // никто, кто калибрует впервые.
    if (kind === WORKSHOP_TOOL_SCALE) {
      subjectHead.textContent = strings.workshop.scaleHead;
      subjectNote.textContent = strings.scale.dialogHint;
      return;
    }
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

  function syncObject(current, object) {
    subjectHead.textContent = strings.workshop.object;
    const kinds = schemeObjectKindsInOrder(current);
    // Справочник видов заводится только когда объект появляется, поэтому до
    // первого объекта выбирать не из чего — в списке стоят стартовые девять
    // имён, а записаны они будут вместе с первым объектом.
    const names = kinds.length > 0 ? kinds.map((item) => item.name) : Object.values(strings.schemeObjectKinds);
    const listKey = names.join("|");
    if (objectKindSelect.dataset.key !== listKey) {
      objectKindSelect.dataset.key = listKey;
      objectKindSelect.replaceChildren(
        ...names.map((name) => uiEl("option", { value: name, text: name })),
      );
    }
    const kindName = object
      ? (findSchemeObjectKind(current, object.kindId) || { name: "" }).name
      : workshopObjectKindName;
    if (names.includes(kindName)) objectKindSelect.value = kindName;
    const shape = object ? object.shape : workshopObjectShape;
    shapeButtons.forEach((button, index) => {
      button.className = "ui-btn workshop__chip" + (SCHEME_OBJECT_SHAPES[index] === shape ? " is-on" : "");
      button.disabled = Boolean(object);
    });
    const sizes = object || objectSizes(current, currentKindId(current));
    widthField.hidden = shape === "polyline";
    turnField.hidden = shape === "polyline";
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
    subjectNote.textContent = object
      ? top === null
        ? strings.workshop.objectFullHeight
        : text("workshop.objectTop", { top })
      : shape === "polyline"
        ? strings.workshop.objectBandHint
        : strings.workshop.objectHint;
  }

  // Полоса развёртки в окне: у той же стены, что выделена, и у того края
  // поля, который дальше от неё.
  function syncElevation(current, wall) {
    if (!wall) {
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
    // Схему удалили под окном — закрываемся: править нечего.
    if (!findScheme(state.project, schemeId)) {
      finish();
      return;
    }
    if ("wallSide" in changed) sync();
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

  function cleanup() {
    if (closed) return;
    strip.destroy();
    closed = true;
    workshopOpened = false;
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

  function finish() {
    cleanup();
    modal.close();
  }

  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerEnd);
  window.addEventListener("pointercancel", onPointerEnd);
  window.addEventListener("resize", onResize);
  window.addEventListener("blur", onBlur);
  document.addEventListener("keydown", onKeyDown, true);
  document.addEventListener("keyup", onKeyUp, true);

  // Схема, открытая в мастерской, становится текущей: её картинку панель схем
  // держит в состоянии сеанса, и второй раз декодировать тот же план окно не
  // должно. Заодно шаг истории, записанный отсюда, возвращает Ctrl+Z на ту же
  // схему, на которой он случился.
  if (getState().schemeId !== schemeId) setState({ schemeId, selectedMarkIds: [] });
  resize();
  // Окно открылось — клавиатура у поля чертежа, а не у первой отметки слоя,
  // которой диалог отдаёт фокус по умолчанию.
  if (typeof stage.focus === "function") stage.focus({ preventScroll: true });
  return { close: finish };
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
