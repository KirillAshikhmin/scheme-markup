// Объёмный режим: комната, по которой можно пройти.
//
// Требование G205, шаг первый (таск 146). Слова заказчика: «просто открывается
// окно, где можно перемещаться по комнатам», «От первого лица», «Всё видно,
// полноценная комната с потолком и полом», «Проходим сквозь нарисованные
// двери», «с затенением», «Давай всю схему».
//
// ——— чем рисуем и почему ————————————————————————————————————————————————
//
// Свой рисовальщик по обычному холсту. Решение то же и по той же причине, что
// в [ADR 007](../docs/adr/007-pdf-without-library.md): чужой бандл в сборку не
// кладётся (`build.js` склеивает модули в одну область видимости), а покупать
// у библиотеки было бы нечего — сцена маленькая, перспектива одна формула,
// порядок граней решает сортировка.
//
// Числа посчитаны на настоящем объекте заказчика (две схемы, 28 обведённых
// помещений, 132 вершины контуров). Стены по контурам комнат, по одному проёму
// на помещение и по окну на наружные грани дают **чуть больше тысячи граней**
// на схему — то есть около четырёх тысяч вершин на кадр. Перевод вершины в
// экран — девять умножений; отсечение по ближней плоскости и сортировка по
// дальности на тысяче граней — доли миллисекунды. Узкое место не арифметика, а
// заливка: тысяча `fill()` по холсту 1400 × 700. Замер живого прогона — в
// отчёте таска.
//
// WebGL руками дал бы на порядок больший запас, но стоил бы второго способа
// рисовать то же самое: у холста 2D уже есть всё, чем рисуется план и
// развёртка, и путь «нет контекста — нет картинки» пришлось бы заводить
// отдельно. Запас не нужен: сцена не растёт от числа меток, она растёт от
// числа стен, а стен в квартире сотня.
//
// ——— что этот модуль делает и чего не делает ———————————————————————————
//
// Здесь только счёт: сцена из объекта, камера, затенение, порядок граней,
// столкновения. Ни DOM, ни строк интерфейса; холст приходит аргументом, как в
// `render.js`. Окно, клавиши и фон — `panels/volume.js`.
//
// Отдельный модуль, а не часть `render.js`: общего у них нет ничего. `render`
// живёт в долях плана и в его пикселях, объём — в миллиметрах чертежа и в
// третьей оси. Положи их рядом — и в одном файле окажутся два разных
// пространства с похожими именами.
//
// **G68: режим только читает.** Ни одной записи в объект, ни одного нового
// поля. Объект без чертежа честно отвечает `empty`.
import {
  OPENING_KIND_DOOR,
  drawingBoundsMm,
  findScheme,
  findSchemeObjectKind,
  findType,
  findWall,
  hexToRgb,
  labelOf,
  markIsComment,
  markSizes,
  markWall,
  markWallSideOn,
  openingsInWall,
  outlinesInOrder,
  planFractionToMm,
  roomAtPoint,
  planMmToFraction,
  schemeFloorOf,
  schemeObjectCorners,
  schemeObjectsOnScheme,
  schemesInOrder,
  segmentDistanceMm,
  styleOf,
  typeObjectView,
  wallHeightOf,
  wallHeightOnSide,
  wallVectors,
  wallsOnScheme,
} from "./model.js";
import { objectViewByName, objectViewForShape } from "./objectViews/registry.js";

// ——— числа ——————————————————————————————————————————————————————————————

/** Высота глаз. Постоянная: «от первого лица», приседать и прыгать незачем. */
export const VOLUME_EYE_MM = 1600;
/**
 * Радиус тела. Он же — страховка от того, чем кончается «камера упёрлась носом
 * в стену»: радиус заведомо больше ближней плоскости, поэтому грань стены
 * никогда не проходит сквозь камеру и геометрия не выворачивается.
 */
export const VOLUME_BODY_MM = 220;
/** Ближняя плоскость. Меньше радиуса тела — см. выше. */
export const VOLUME_NEAR_MM = 80;
/**
 * Порог, через который переступают. Проём, у которого низ не выше порога,
 * пропускает человека; окно на высоте 800 мм — нет, под ним глухая стена.
 */
export const VOLUME_STEP_MM = 300;
/** Макушка: под тем, что выше неё, проходят не нагибаясь. */
export const VOLUME_HEAD_MM = 1900;
/**
 * Свободное место вокруг, ниже которого окно говорит «тесно».
 *
 * Это ответ на узкий санузел, где камера упирается носом в стену. Ломаться там
 * нечему — радиус тела больше ближней плоскости, и грань сквозь камеру не
 * пройдёт никогда, — но кадр становится ровным полем в сорок сантиметров
 * стены, и человек решит, что сборка сломалась. Поэтому окно не подменяет
 * решение за него (ни выталкивания в середину комнаты, ни поля зрения
 * нараспашку), а называет происходящее словом и показывает выход: обзор.
 * Полметра — половина прохода между стеной и ванной.
 */
export const VOLUME_TIGHT_MM = 500;
/**
 * Поле зрения по длинной стороне окна.
 *
 * Девяносто, а не привычные семьдесят пять, и причина измеримая. Стоя
 * посередине комнаты 4 × 3 м с глазами на 1,6 м, человек видит низ дальней
 * стены под 49° к горизонту: при поле 75° по ширине окна 1400 × 700 на
 * вертикаль остаётся 48°, то есть ±24°, — и пол в кадр не попадает вовсе, пока
 * взгляд не опустят. Это не придирка: заказчик сказал «Всё видно, полноценная
 * комната с потолком и полом», а кадр без пола этого обещания не держит.
 */
export const VOLUME_FOV_DEG = 90;
/**
 * Наклон взгляда, с которым встают на пол. Небольшой, вниз: ровно горизонтально
 * в комнате видно только стену — пол уходит под нижний край кадра (см. выше), а
 * комната узнаётся как раз по тому, где стена сходится с полом.
 */
export const VOLUME_START_PITCH_DEG = -10;
/**
 * Высота, которой рисуется помещение без заданной высоты. Выдумывать её молча
 * нельзя — окно говорит об этом строкой, как говорит развёртка (таск 129).
 */
export const VOLUME_HEIGHT_FALLBACK_MM = 2700;
/**
 * С какого расстояния до лестницы спрашивают про этаж (таск 149).
 *
 * Метр с небольшим от её габарита — расстояние, с которого человек на неё
 * **подошёл**, а не прошёл мимо: лестница стоит у стены, проход рядом с ней
 * шириной в метр, и шаг в сторону из прохода уже упирается в саму лестницу
 * (тело выталкивается в 220 мм от неё). Больше — вопрос задавался бы из
 * соседней комнаты, меньше — не задавался бы вовсе: ближе 220 мм подойти
 * нельзя, лестница не пускает.
 */
export const VOLUME_STAIR_REACH_MM = 1100;
/** Ход и бег, миллиметры в секунду. */
export const VOLUME_WALK_MM_S = 2400;
export const VOLUME_RUN_MM_S = 4800;
/** Куда можно задрать и опустить взгляд. */
export const VOLUME_PITCH_MAX_DEG = 85;
/** Сколько экранных точек поворачивают голову на градус. */
export const VOLUME_LOOK_DEG_PX = 0.22;
/** Наклон обзора по умолчанию: смотрим сверху вниз. */
export const VOLUME_AROUND_PITCH_DEG = -42;
/** Насколько обзор отходит, когда его зовут к человеку. */
export const VOLUME_AROUND_NEAR_MM = 7000;
export const VOLUME_AROUND_MIN_MM = 1500;
export const VOLUME_AROUND_MAX_MM = 400000;
/**
 * Три яруса, в которых грани ложатся на холст (дефект живого прогона).
 *
 *   0 — **плита под чертежом**. Одна грань на всю схему, по габариту чертежа,
 *       то есть по осевым линиям наружных стен. Нужна не для красоты: в пороге
 *       двери пола нет вовсе (комнаты кончаются у внутренних граней, а между
 *       ними лежит толщина стены), и сквозь эту щель был виден задник —
 *       зелёная полоса поперёк каждого проёма. Той же щелью отзывается контур,
 *       обведённый рукой чуть мимо стены. Плита закрывает оба случая разом и
 *       наружу не вылезает: за осевой линией её прячет сама стена.
 *   1 — **полы и потолки** помещений.
 *   2 — **всё остальное**: стены, объекты, полотна, рамы.
 *   3 — **кружок «вы здесь»**. Он рисуется поверх всего, и это не оплошность:
 *       он не часть комнаты, а указатель. Обзор смотрит под углом, и ближняя
 *       стена высотой 2,7 м прячет за собой полосу пола метра в три — то есть
 *       ровно того человека, ради которого обзор и открыли («без него не
 *       понять, где стоишь»). Указатель, видный сквозь стену, отвечает на этот
 *       вопрос всегда; сама стена при этом остаётся на месте и читается как
 *       стена.
 *
 * Ярус сильнее дальности, и это правило, а не ускорение: под плитой нет
 * ничего, под полом нет ничего, а потолок, видимый снизу, не закрывает ничего,
 * кроме себя. Будь они в общем потоке, пол комнаты, в которой стоишь, оказался
 * бы ближе дальней стены и закрасил бы её низ.
 */
export const VOLUME_LAYER_BASE = 0;
export const VOLUME_LAYER_GROUND = 1;
export const VOLUME_LAYER_BODY = 2;
export const VOLUME_LAYER_MARK = 3;
/**
 * Зазор, внутри которого точка считается лежащей **на** плоскости грани
 * (дерево порядка, см. `volumeOrderTree`).
 *
 * Двадцатая доля миллиметра — заведомо меньше всего, что в сцене отодвинуто
 * нарочно: вещь стоит перед стеной на 2 мм (`VOLUME_MARK_LIFT_MM`), контур
 * поднят над лицом вещи на 1 мм (`VOLUME_VIEW_LIFT_MM`). И заведомо больше
 * погрешности, с которой миллиметровые координаты складываются в double.
 */
export const VOLUME_PLANE_EPS_MM = 0.05;
/** Сколько плоскостей примеряется в узле дерева, прежде чем выбрать лучшую. */
const VOLUME_ORDER_TRIES = 12;
/** Во сколько раз разрез дороже перекоса: цена лишней грани против цены глубины. */
const VOLUME_ORDER_SPLIT_COST = 8;
/** Сколько раз выталкиваем тело из стен за шаг: угол держат два прохода. */
const VOLUME_PUSH_PASSES = 4;
/** Светлота самой тёмной и самой светлой грани. */
const VOLUME_SHADE_MIN = 0.46;
const VOLUME_SHADE_MAX = 1;
/**
 * Направление, по которому считается светлота. Светлее всех грань, смотрящая
 * навстречу, темнее — отвёрнутая. У него отрицательная `z`, и из этого прямо
 * следует требование заказчика «пол темнее потолка»: низ потолка смотрит вниз
 * (навстречу), верх пола — вверх (от).
 */
const VOLUME_LIGHT = volumeNormalize({ x: -0.42, y: -0.33, z: -0.84 });

// Цвета материалов. Чернила чертежа (`DRAWING_WALL` и соседи) здесь не годятся:
// там тушь по бумаге, а тут поверхность комнаты, и затенение гонит её светлоту
// в обе стороны. Поэтому палитра своя и к `mono.js` отношения не имеет —
// объёмный вид не печатают.
export const VOLUME_WALL_RGB = [216, 212, 204];
export const VOLUME_FLOOR_RGB = [170, 142, 110];
export const VOLUME_CEILING_RGB = [238, 238, 236];
export const VOLUME_OBJECT_RGB = [150, 126, 190];
export const VOLUME_DOOR_RGB = [176, 132, 92];
/** Ручка двери — металл: светлее полотна и холоднее его (G207). */
export const VOLUME_HANDLE_RGB = [186, 190, 198];
export const VOLUME_FRAME_RGB = [240, 242, 244];
export const VOLUME_MARKER_RGB = [31, 111, 235];

/**
 * Радиус кружка «вы здесь» на обзоре (G212). Полтора дециметра — это полшага
 * человека: указатель виден, а пол под ним — тоже, и клик по месту за ним
 * (перенос) не упирается в собственный указатель.
 */
export const VOLUME_MARKER_MM = 150;

// ——— мелкая векторная арифметика ————————————————————————————————————————
//
// Своя, в три строки: выносить её в модель незачем — ни одна сущность объекта
// третьей оси не знает.

function volumeNormalize(vector) {
  const length = Math.hypot(vector.x, vector.y, vector.z);
  if (!(length > 0)) return { x: 0, y: 0, z: 0 };
  return { x: vector.x / length, y: vector.y / length, z: vector.z / length };
}

/**
 * Нормаль грани по трём первым вершинам. Направление задаёт обход: у плановых
 * многоугольников, записанных по часовой на экране (ось `y` смотрит вниз),
 * «левая» нормаль ребра смотрит наружу — то же соглашение, что у стены
 * (`wallVectors`), и второго в сборке нет.
 */
export function volumeFaceNormal(points) {
  if (!points || points.length < 3) return { x: 0, y: 0, z: 1 };
  const [a, b, c] = points;
  const ux = b.x - a.x;
  const uy = b.y - a.y;
  const uz = b.z - a.z;
  const vx = c.x - a.x;
  const vy = c.y - a.y;
  const vz = c.z - a.z;
  return volumeNormalize({ x: uy * vz - uz * vy, y: uz * vx - ux * vz, z: ux * vy - uy * vx });
}

/** Светлота грани по её направлению: одна формула, ни текстур, ни света. */
export function volumeShade(normal) {
  const dot = normal.x * VOLUME_LIGHT.x + normal.y * VOLUME_LIGHT.y + normal.z * VOLUME_LIGHT.z;
  return VOLUME_SHADE_MIN + ((VOLUME_SHADE_MAX - VOLUME_SHADE_MIN) * (dot + 1)) / 2;
}

/** Цвет грани: материал, умноженный на светлоту. */
export function volumeFill(rgb, shade) {
  const channel = (value) => Math.max(0, Math.min(255, Math.round(value * shade)));
  return "rgb(" + channel(rgb[0]) + "," + channel(rgb[1]) + "," + channel(rgb[2]) + ")";
}

// ——— грани ———————————————————————————————————————————————————————————————
//
// Грань — плоский многоугольник в миллиметрах чертежа плюс третья ось: `z`
// отсчитывается от пола вверх. `layer` — ярус отрисовки (см. выше), `both`
// помечает двустороннюю грань (дверное полотно, брусок рамы).

function volumeFace(points, rgb, options = {}) {
  const normal = options.normal || volumeFaceNormal(points);
  return {
    p: points,
    n: normal,
    rgb,
    layer: options.layer === undefined ? VOLUME_LAYER_BODY : options.layer,
    both: Boolean(options.both),
    // Чья это грань: по ней кадр отвечает, во что попал клик (таск 148).
    // У стен, пола и вещей чертежа хозяина нет — и попадать в них незачем.
    markId: options.markId || null,
    // Чьё это полотно: по нему кадр отвечает, какую дверь открывает E (G207).
    // Есть только у полотна и его ручки — больше ни у чего в сцене.
    doorId: options.doorId || null,
  };
}

/**
 * **Линия в сцене**: ломаная, которая не заливается, а обводится (таск 148).
 *
 * Заведена ради двух вещей, которые гранями не рисуются: контур изображения
 * объекта на лицевой стороне вещи и стрелка связи. И то и другое — **рисунок**,
 * а не поверхность: толщина у него в экранных точках, иначе контур розетки в
 * трёх метрах пропадает вовсе, а в полуметре превращается в кляксу.
 *
 * `normal` необязательна: с ней линия отсекается по направлению, как грань
 * (контур на лицевой стороне не виден с изнанки), без неё видна всегда —
 * стрелке связи так и надо.
 */
export function volumeLine(points, color, options = {}) {
  return {
    p: points,
    line: true,
    color,
    width: options.width === undefined ? 1.4 : options.width,
    closed: Boolean(options.closed),
    dash: options.dash || null,
    arrow: Boolean(options.arrow),
    n: options.normal || null,
    layer: options.layer === undefined ? VOLUME_LAYER_BODY : options.layer,
    markId: options.markId || null,
  };
}

function volumeAt(point, z) {
  return { x: point.x, y: point.y, z };
}

/**
 * Прямая призма по плановому многоугольнику: боковые грани, верх и — если вещь
 * висит над полом — низ. Низ лежащей на полу вещи не рисуется вовсе: его
 * никогда не видно, а грань стоит кадра.
 */
function volumePrismFaces(corners, bottomMm, topMm, rgb, out, options = {}) {
  if (corners.length < 3 || !(topMm > bottomMm)) return out;
  const markId = options.markId || null;
  const doorId = options.doorId || null;
  for (let index = 0; index < corners.length; index += 1) {
    const a = corners[index];
    const b = corners[(index + 1) % corners.length];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    if (dx === 0 && dy === 0) continue;
    const length = Math.hypot(dx, dy);
    out.push(
      volumeFace([volumeAt(a, bottomMm), volumeAt(b, bottomMm), volumeAt(b, topMm), volumeAt(a, topMm)], rgb, {
        normal: { x: dy / length, y: -dx / length, z: 0 },
        markId,
        doorId,
      }),
    );
  }
  out.push(
    volumeFace(
      corners.map((point) => volumeAt(point, topMm)),
      rgb,
      { normal: { x: 0, y: 0, z: 1 }, markId, doorId },
    ),
  );
  // Низ лежащей на полу вещи не нужен никому, а низ висящей — нужен: на
  // потолочный светильник смотрят снизу, и без этой грани он был бы дырой.
  if (bottomMm > 0 || markId || doorId) {
    out.push(
      volumeFace(
        corners.map((point) => volumeAt(point, bottomMm)),
        rgb,
        { normal: { x: 0, y: 0, z: -1 }, markId, doorId },
      ),
    );
  }
  return out;
}

// ——— стена ———————————————————————————————————————————————————————————————

/**
 * Проём, через который проходят. Решает **геометрия, а не вид**: низ не выше
 * порога — переступили. Окно исключено отдельно и нарочно: оно застеклено, и
 * панорамное окно до пола держит так же, как стена под обычным.
 */
export function volumeOpeningWalkable(opening) {
  if (!opening || opening.kind === "window") return false;
  return Number(opening.heightAboveFloorMm || 0) <= VOLUME_STEP_MM;
}

/**
 * Сплошные участки стены — то, что держит человека. Проёмы, через которые
 * проходят, оставляют дыру; окно дыры не оставляет.
 */
export function volumeWallSolids(wall, openings) {
  const length = Math.hypot(Number(wall.bMm.x) - Number(wall.aMm.x), Number(wall.bMm.y) - Number(wall.aMm.y));
  const holes = (openings || [])
    .filter((opening) => volumeOpeningWalkable(opening))
    .map((opening) => ({ from: Number(opening.atMm), to: Number(opening.atMm) + Number(opening.widthMm) }))
    .sort((left, right) => left.from - right.from);
  const spans = [];
  let cursor = 0;
  for (const hole of holes) {
    if (hole.from > cursor) spans.push({ fromMm: cursor, toMm: Math.min(hole.from, length) });
    cursor = Math.max(cursor, hole.to);
  }
  if (cursor < length) spans.push({ fromMm: cursor, toMm: length });
  return spans.filter((span) => span.toMm - span.fromMm > 0);
}

/**
 * Разбивка грани стены на прямоугольники вокруг проёмов.
 *
 * Проёмы уже отсортированы вдоль стены (`openingsInWall`), и накладываться им
 * модель не даёт (`openingsOverlap`) — значит разбивка однозначна: промежуток
 * между проёмами во всю высоту, под проёмом и над ним. Вырожденные куски
 * (проём от пола, проём до потолка) выпадают сами.
 */
export function volumeWallTiles(lengthMm, heightMm, openings) {
  const tiles = [];
  let cursor = 0;
  for (const opening of openings || []) {
    const from = Math.max(0, Math.min(lengthMm, Number(opening.atMm)));
    const to = Math.max(from, Math.min(lengthMm, from + Number(opening.widthMm)));
    const bottom = Math.max(0, Number(opening.heightAboveFloorMm || 0));
    const top = Math.min(heightMm, bottom + Number(opening.heightMm));
    if (from > cursor) tiles.push({ fromMm: cursor, toMm: from, bottomMm: 0, topMm: heightMm });
    if (to > from) {
      if (bottom > 0) tiles.push({ fromMm: from, toMm: to, bottomMm: 0, topMm: bottom });
      if (heightMm > top) tiles.push({ fromMm: from, toMm: to, bottomMm: top, topMm: heightMm });
    }
    cursor = Math.max(cursor, to);
  }
  if (lengthMm > cursor) tiles.push({ fromMm: cursor, toMm: lengthMm, bottomMm: 0, topMm: heightMm });
  return tiles.filter((tile) => tile.toMm > tile.fromMm && tile.topMm > tile.bottomMm);
}

/**
 * Грани стены: две стороны, разбитые проёмами, два торца, верх; на каждый
 * проём — четыре грани его откосов, рама окну и полотно двери.
 *
 * Низ стены не рисуется: он под полом. Полотно двери стоит **закрытым** (G207,
 * решение заказчика, которое отменило решение таска 146): «По умолчанию пусть
 * все двери будут закрыты». Раскрывается оно поимённо — `openDoorIds` — и живёт
 * это только в сеансе окна: в объект состояние двери не пишется (G68).
 */
export function volumeWallFaces(wall, openings, heightMm, out = [], openDoorIds = null) {
  const vectors = wallVectors(wall);
  if (!vectors || !(heightMm > 0)) return out;
  const half = Number(wall.thicknessMm) / 2;
  const { u, n, len } = vectors;
  const at = (along, across) => ({
    x: Number(wall.aMm.x) + u.x * along + n.x * across,
    y: Number(wall.aMm.y) + u.y * along + n.y * across,
  });
  for (const side of [1, -1]) {
    const normal = { x: n.x * side, y: n.y * side, z: 0 };
    const sideName = side > 0 ? "left" : "right";
    // Сторона стены — **один** многоугольник на кусок между проёмами. Метровой
    // сетки, которой она резалась в тасках 148–150 ради порядка рисования,
    // больше нет: порядок выкладывает дерево (`volumeOrderTree`), а вещь стоит
    // перед плоскостью стены на два миллиметра — этого дереву довольно.
    for (const tile of volumeWallTiles(len, heightMm, openings)) {
      const from = at(tile.fromMm, half * side);
      const to = at(tile.toMm, half * side);
      // Обход берётся так, чтобы нормаль смотрела на свою сторону: на правой
      // стороне концы меняются местами.
      const first = side > 0 ? to : from;
      const second = side > 0 ? from : to;
      out.push(
        volumeFace(
          [
            volumeAt(first, tile.bottomMm),
            volumeAt(second, tile.bottomMm),
            volumeAt(second, tile.topMm),
            volumeAt(first, tile.topMm),
          ],
          VOLUME_WALL_RGB,
          { normal },
        ),
      );
    }
  }
  for (const end of [0, 1]) {
    const along = end === 0 ? 0 : len;
    const normal = { x: u.x * (end === 0 ? -1 : 1), y: u.y * (end === 0 ? -1 : 1), z: 0 };
    const left = at(along, half);
    const right = at(along, -half);
    const first = end === 0 ? left : right;
    const second = end === 0 ? right : left;
    out.push(
      volumeFace([volumeAt(first, 0), volumeAt(second, 0), volumeAt(second, heightMm), volumeAt(first, heightMm)], VOLUME_WALL_RGB, {
        normal,
      }),
    );
  }
  out.push(
    volumeFace(
      [at(0, half), at(len, half), at(len, -half), at(0, -half)].map((point) => volumeAt(point, heightMm)),
      VOLUME_WALL_RGB,
      { normal: { x: 0, y: 0, z: 1 } },
    ),
  );
  for (const opening of openings || []) {
    volumeOpeningFaces(wall, opening, heightMm, out, openDoorIds);
  }
  return out;
}

/** Откосы проёма, рама окна и полотно двери — закрытое или раскрытое. */
function volumeOpeningFaces(wall, opening, heightMm, out, openDoorIds) {
  const vectors = wallVectors(wall);
  if (!vectors) return out;
  const half = Number(wall.thicknessMm) / 2;
  const { u, n, len } = vectors;
  const from = Math.max(0, Math.min(len, Number(opening.atMm)));
  const to = Math.max(from, Math.min(len, from + Number(opening.widthMm)));
  const bottom = Math.max(0, Number(opening.heightAboveFloorMm || 0));
  const top = Math.min(heightMm, bottom + Number(opening.heightMm));
  if (!(to > from) || !(top > bottom)) return out;
  const at = (along, across) => ({
    x: Number(wall.aMm.x) + u.x * along + n.x * across,
    y: Number(wall.aMm.y) + u.y * along + n.y * across,
  });
  // Низ проёма смотрит вверх, верх — вниз: подоконник виден снизу, перемычка
  // сверху, и затенение разводит их само.
  if (bottom > 0) {
    out.push(
      volumeFace(
        [at(from, half), at(to, half), at(to, -half), at(from, -half)].map((point) => volumeAt(point, bottom)),
        VOLUME_WALL_RGB,
        { normal: { x: 0, y: 0, z: 1 } },
      ),
    );
  }
  if (top < heightMm) {
    out.push(
      volumeFace(
        [at(from, -half), at(to, -half), at(to, half), at(from, half)].map((point) => volumeAt(point, top)),
        VOLUME_WALL_RGB,
        { normal: { x: 0, y: 0, z: -1 } },
      ),
    );
  }
  for (const end of [from, to]) {
    const sign = end === from ? 1 : -1;
    const normal = { x: u.x * sign, y: u.y * sign, z: 0 };
    const left = at(end, half);
    const right = at(end, -half);
    const first = sign > 0 ? right : left;
    const second = sign > 0 ? left : right;
    out.push(
      volumeFace([volumeAt(first, bottom), volumeAt(second, bottom), volumeAt(second, top), volumeAt(first, top)], VOLUME_WALL_RGB, {
        normal,
      }),
    );
  }
  if (opening.kind === "window") {
    volumeWindowFrame(at, from, to, bottom, top, out);
    return out;
  }
  if (opening.kind === OPENING_KIND_DOOR) {
    const open = volumeDoorOpen(openDoorIds, opening.id);
    volumeDoorLeaf(wall, opening, { from, to, bottom, top }, out, open);
  }
  return out;
}

/** Открыта ли эта дверь. Список пустой или не дан — закрыты все (G207). */
export function volumeDoorOpen(openDoorIds, doorId) {
  if (!openDoorIds || !doorId) return false;
  if (typeof openDoorIds.has === "function") return openDoorIds.has(doorId);
  return Array.isArray(openDoorIds) && openDoorIds.includes(doorId);
}

/** Толщина брусков рамы окна. */
const VOLUME_FRAME_MM = 60;

// Ручка двери (G207). Числа — обычная дверная фурнитура: ручка на 1050 мм от
// пола, длиной 130 мм, выступает на 35 мм в каждую сторону полотна, высотой
// 90 мм. Отступ от свободного края — 70 мм, как у настоящего замка.
const VOLUME_HANDLE_MM = 1050;
const VOLUME_HANDLE_LONG_MM = 130;
const VOLUME_HANDLE_OUT_MM = 35;
const VOLUME_HANDLE_TALL_MM = 90;
const VOLUME_HANDLE_EDGE_MM = 70;

// Рама — четыре бруска по краю проёма, в середине толщины стены. Стекла нет:
// сквозь окно видно фон, и это ровно то, чего просил заказчик.
function volumeWindowFrame(at, from, to, bottom, top, out) {
  const bars = [
    { from, to, bottom, top: Math.min(top, bottom + VOLUME_FRAME_MM) },
    { from, to, bottom: Math.max(bottom, top - VOLUME_FRAME_MM), top },
    { from, to: Math.min(to, from + VOLUME_FRAME_MM), bottom, top },
    { from: Math.max(from, to - VOLUME_FRAME_MM), to, bottom, top },
  ];
  for (const bar of bars) {
    if (!(bar.to > bar.from) || !(bar.top > bar.bottom)) continue;
    const first = at(bar.from, 0);
    const second = at(bar.to, 0);
    out.push(
      volumeFace(
        [volumeAt(first, bar.bottom), volumeAt(second, bar.bottom), volumeAt(second, bar.top), volumeAt(first, bar.top)],
        VOLUME_FRAME_RGB,
        { both: true },
      ),
    );
  }
}

/**
 * Полотно двери — одна двусторонняя грань от петли и ручка на ней.
 *
 * **Закрытое** стоит в самом проёме, в середине толщины стены: там же, где
 * бруски рамы у окна, и ровно поэтому не спорит с гранями стены за порядок —
 * совпавшие плоскости в сортировке по дальности решаются случаем, а полотно в
 * середине стены от её сторон отодвинуто на полтолщины.
 *
 * **Раскрытое** уходит от петли на четверть оборота — так дверь рисуют на плане
 * (`render.drawingDoorLeaf`), и так видно, какой кусок пола она занимает.
 *
 * Держать человека полотно не должно ни в том, ни в другом виде (слова
 * заказчика: «Проходим сквозь нарисованные двери») и в список препятствий не
 * попадает — см. `volumeWallSolids`. Закрытая дверь, сквозь которую проходят,
 * выглядит странно, и об этом сказано вслух в отчёте: поведение заказчик не
 * отменял, а менять его без его слова нельзя.
 */
function volumeDoorLeaf(wall, opening, span, out, open) {
  const vectors = wallVectors(wall);
  const width = span.to - span.from;
  if (!vectors || !(width > 0)) return out;
  const { u, n } = vectors;
  const atStart = opening.hinge !== "end";
  const alongHinge = atStart ? span.from : span.to;
  const hinge = {
    x: Number(wall.aMm.x) + u.x * alongHinge,
    y: Number(wall.aMm.y) + u.y * alongHinge,
  };
  const side = opening.swing === "right" ? -1 : 1;
  const doorId = opening.id || null;
  // Куда смотрит полотно: раскрытое — прочь от стены, закрытое — вдоль неё.
  const leaf = open ? { x: n.x * side, y: n.y * side } : { x: u.x * (atStart ? 1 : -1), y: u.y * (atStart ? 1 : -1) };
  const tip = { x: hinge.x + leaf.x * width, y: hinge.y + leaf.y * width };
  out.push(
    volumeFace(
      [volumeAt(hinge, span.bottom), volumeAt(tip, span.bottom), volumeAt(tip, span.top), volumeAt(hinge, span.top)],
      VOLUME_DOOR_RGB,
      { both: true, doorId },
    ),
  );
  // Ручка у свободного края полотна, на высоте, на которой её берут рукой
  // (G207: «ну и на дверях ручки нарисуй»). Выступает на обе стороны: дверь
  // открывают с той стороны, с которой подошли.
  const handleAt = {
    x: tip.x - leaf.x * VOLUME_HANDLE_EDGE_MM,
    y: tip.y - leaf.y * VOLUME_HANDLE_EDGE_MM,
  };
  const bottom = Math.max(span.bottom, VOLUME_HANDLE_MM - VOLUME_HANDLE_TALL_MM / 2);
  const top = Math.min(span.top, bottom + VOLUME_HANDLE_TALL_MM);
  if (top > bottom) {
    volumePrismFaces(
      volumeBoxCorners(handleAt, leaf, VOLUME_HANDLE_LONG_MM, VOLUME_HANDLE_OUT_MM * 2),
      bottom,
      top,
      VOLUME_HANDLE_RGB,
      out,
      { doorId },
    );
  }
  return out;
}

// ——— пол, потолок, объекты ———————————————————————————————————————————————

/**
 * Высота помещения: переопределение комнаты, высота схемы, а если ни того ни
 * другого — `VOLUME_HEIGHT_FALLBACK_MM` и честный `known: false`.
 */
export function volumeHeightMm(project, schemeId, roomId) {
  const given = wallHeightOf(project, { schemeId, roomId });
  if (given > 0) return { mm: given, known: true };
  return { mm: VOLUME_HEIGHT_FALLBACK_MM, known: false };
}

/** Внутри ли точка в плановом многоугольнике. Тот же счёт, что `pointInOutline`. */
export function volumePointInside(point, corners) {
  let inside = false;
  for (let i = 0, j = corners.length - 1; i < corners.length; j = i, i += 1) {
    const a = corners[i];
    const b = corners[j];
    const crosses = a.y > point.y !== b.y > point.y;
    if (crosses && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Площадь планового многоугольника в мм². */
export function volumeArea(corners) {
  let sum = 0;
  for (let i = 0, j = corners.length - 1; i < corners.length; j = i, i += 1) {
    sum += corners[j].x * corners[i].y - corners[i].x * corners[j].y;
  }
  return Math.abs(sum) / 2;
}

/**
 * Обход приводится к часовому на экране — тому единственному, при котором
 * «левая» нормаль ребра смотрит **наружу** (соглашение `volumeFaceNormal` и
 * `wallVectors`, второго в сборке нет). Зависеть это от того, в какую сторону
 * человек обводил комнату или ставил вещь, не должно.
 *
 * **Знак здесь был обратный, и это дефект, найденный замером D32** (таск 150):
 * функция возвращала обход против часовой, то есть у каждой призмы — у вещи
 * чертежа, у тела метки — боковые нормали смотрели **внутрь**. Следствие
 * видно глазами: ближняя сторона шкафа отсекалась как отвёрнутая, и вместо неё
 * рисовалась дальняя — сквозь переднюю стенку шкафа был виден его задник. У
 * плит пола и потолка нормаль задана прямо, поэтому их это не касалось, и
 * тестами не ловилось: они считали грани, а не их направление.
 *
 * Ось `y` смотрит вниз, и при этой формуле у часового на экране обхода сумма
 * **положительная**: проверено на квадрате, у которого наружу смотрят все
 * четыре нормали.
 */
function volumeClockwise(corners) {
  let sum = 0;
  for (let i = 0, j = corners.length - 1; i < corners.length; j = i, i += 1) {
    sum += corners[j].x * corners[i].y - corners[i].x * corners[j].y;
  }
  return sum >= 0 ? corners : [...corners].reverse();
}

/**
 * Помещения объёма: контур в миллиметрах и высота.
 *
 * Берутся **контуры** (`outlines`), а не стены: помещения в этой сборке
 * выводятся из контуров (ADR 008), и у стены помещения нет. Перевод в
 * миллиметры — только через мост `planFractionToMm`; нет калибровки или
 * привязки — помещений нет, и это не поломка, а честный ответ: чертежу без
 * моста не от чего считать доли.
 */
export function volumeRooms(project, schemeId) {
  const rooms = [];
  for (const outline of outlinesInOrder(project, schemeId)) {
    const points = [];
    let ok = true;
    for (const point of outline.points || []) {
      const mm = planFractionToMm(project, schemeId, point);
      if (!mm) {
        ok = false;
        break;
      }
      points.push(mm);
    }
    if (!ok || points.length < 3) continue;
    const height = volumeHeightMm(project, schemeId, outline.roomId);
    rooms.push({
      outlineId: outline.id,
      roomId: outline.roomId || null,
      pointsMm: volumeClockwise(points),
      heightMm: height.mm,
      heightKnown: height.known,
    });
  }
  return rooms;
}

/** Высота в точке: по накрывающему её контуру, иначе по схеме. */
function volumeHeightAt(project, schemeId, pointMm, fallbackMm) {
  const fraction = planMmToFraction(project, schemeId, pointMm);
  const roomId = fraction ? roomAtPoint(project, schemeId, fraction) : null;
  if (!roomId) return fallbackMm;
  return volumeHeightMm(project, schemeId, roomId).mm;
}

/**
 * Объект схемы, разложенный на прямые призмы.
 *
 * Прямоугольник — одна призма по четырём углам, ломаная — цепочка призм по
 * звеньям: соседние звенья слегка заходят друг в друга на изломе, и это тот же
 * стык, что у двух стен в углу.
 *
 * Высота `null` значит «во всю высоту помещения» (колонна, ниша, короб) — она
 * берётся по тому помещению, в котором вещь стоит.
 *
 * Одно место на обе надобности: по этим призмам вещь и рисуется, и держит
 * человека. Посчитай их врозь — и однажды нарисованный шкаф окажется не там,
 * где он не пускает.
 */
export function volumeObjectPrisms(project, schemeId, object, fallbackHeightMm) {
  const corners = schemeObjectCorners(object);
  if (corners.length === 0) return [];
  const bottom = Math.max(0, Number(object.heightAboveFloorMm || 0));
  const own = typeof object.heightMm === "number" ? Number(object.heightMm) : null;
  const topAt = (middle) => (own === null ? volumeHeightAt(project, schemeId, middle, fallbackHeightMm) : bottom + own);
  if (object.shape !== "polyline") {
    return [{ corners: volumeClockwise(corners), bottomMm: bottom, topMm: topAt(object.atMm || corners[0]) }];
  }
  const halfWidth = Number(object.depthMm) / 2;
  const prisms = [];
  for (let index = 0; index + 1 < corners.length; index += 1) {
    const a = corners[index];
    const b = corners[index + 1];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length = Math.hypot(dx, dy);
    if (!(length > 0)) continue;
    const nx = (dy / length) * halfWidth;
    const ny = (-dx / length) * halfWidth;
    prisms.push({
      corners: volumeClockwise([
        { x: a.x + nx, y: a.y + ny },
        { x: b.x + nx, y: b.y + ny },
        { x: b.x - nx, y: b.y - ny },
        { x: a.x - nx, y: a.y - ny },
      ]),
      bottomMm: bottom,
      topMm: topAt({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }),
    });
  }
  return prisms;
}

/** Грани объекта схемы. */
export function volumeObjectFaces(project, schemeId, object, fallbackHeightMm, out = []) {
  for (const prism of volumeObjectPrisms(project, schemeId, object, fallbackHeightMm)) {
    volumePrismFaces(prism.corners, prism.bottomMm, prism.topMm, VOLUME_OBJECT_RGB, out);
  }
  return out;
}

/**
 * Держит ли вещь человека. Решает, как и у проёма, геометрия: через низкое
 * переступают, под высоким проходят.
 *
 * Колонна, шкаф и столешница не пускают — пройти сквозь шкаф так же неверно,
 * как сквозь стену, и заказчик разрешил проходить ровно сквозь **дверные
 * полотна**, а не сквозь вещи. Короб под потолком, наоборот, над головой, и
 * останавливать им человека было бы странно.
 */
export function volumePrismBlocks(prism) {
  return prism.bottomMm < VOLUME_HEAD_MM && prism.topMm > VOLUME_STEP_MM;
}

/** Препятствие из призмы: повёрнутый прямоугольник по её габариту. */
export function volumePrismSolid(prism) {
  const corners = prism.corners;
  if (corners.length < 4) return null;
  const a = corners[0];
  const b = corners[1];
  const c = corners[2];
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  if (!(length > 0)) return null;
  const ux = dx / length;
  const uy = dy / length;
  const nx = uy;
  const ny = -ux;
  const depth = Math.abs((c.x - b.x) * nx + (c.y - b.y) * ny);
  return {
    cx: (a.x + c.x) / 2,
    cy: (a.y + c.y) / 2,
    ux,
    uy,
    nx,
    ny,
    half: length / 2,
    halfT: depth / 2,
  };
}

// ——— лестница и этажи ————————————————————————————————————————————————————
//
// Таск 149. Слова заказчика: «У схем можно задавать этаж, а при подходе к любой
// лестнице спрашивать нужный этаж. Если 2 этажа, то просто с подтверждением
// переходить».
//
// Лестница — не новая сущность: она **уже** есть в справочнике видов объектов
// чертежа («Лестница» в стартовом наборе, таск 122), её рисуют прямоугольником
// или ломаной марша, и в объёме она стоит призмой во всю высоту помещения.
// Объём только узнаёт её среди прочих вещей.
//
// **Узнаёт по имени вида, и другого способа нет.** У вида объекта есть `id`
// (свежий uuid на каждый объект) и `name` — ни кода, ни ключа, в отличие от
// типов меток. Привязываться к `id` нельзя (`defaultTemplate` выдаёт новые на
// каждый объект), значит остаётся имя. Поэтому имя сверяется терпимо: регистр,
// пробелы по краям и «ё» не считаются, а внутри строки ищется корень «лестни» —
// «Лестница», «лестничный марш», «Лестница на 2 этаж» и латинское `stairs`
// узнаются все.
// Переименовал человек вид в «Марш» — объём лестницы не найдёт и честно
// промолчит; выдумывать за него второй справочник ради этого незачем.

const VOLUME_STAIR_WORDS = ["лестни", "stair"];

/** Это вид «лестница»? Сверяется имя вида объекта чертежа. */
export function volumeStairKind(name) {
  const plain = String(name || "")
    .trim()
    .toLowerCase()
    .replace(/ё/g, "е");
  if (plain === "") return false;
  return VOLUME_STAIR_WORDS.some((word) => plain.includes(word));
}

/** Расстояние от точки до многоугольника: ноль — точка внутри. */
function volumePolygonGap(point, corners) {
  if (corners.length < 3) return Infinity;
  if (volumePointInside(point, corners)) return 0;
  let gap = Infinity;
  for (let i = 0, j = corners.length - 1; i < corners.length; j = i, i += 1) {
    gap = Math.min(gap, segmentDistanceMm(point, corners[i], corners[j]));
  }
  return gap;
}

/**
 * Лестницы схемы: `{objectId, polygons, atMm}` в миллиметрах чертежа.
 *
 * `polygons` — те же габариты, которыми лестница рисуется и которыми не
 * пускает (`volumeObjectPrisms`): у ломаной марша их столько, сколько звеньев.
 * Второй геометрии у лестницы нет — иначе спрашивать про этаж начали бы не там,
 * где она нарисована.
 */
export function volumeStairs(project, schemeId) {
  const stairs = [];
  for (const object of schemeObjectsOnScheme(project, schemeId)) {
    const kind = findSchemeObjectKind(project, object.kindId);
    if (!kind || !volumeStairKind(kind.name)) continue;
    const polygons = volumeObjectPrisms(project, schemeId, object, VOLUME_HEIGHT_FALLBACK_MM).map(
      (prism) => prism.corners,
    );
    if (polygons.length === 0) continue;
    let sx = 0;
    let sy = 0;
    let count = 0;
    for (const polygon of polygons) {
      for (const point of polygon) {
        sx += point.x;
        sy += point.y;
        count += 1;
      }
    }
    stairs.push({ objectId: object.id, polygons, atMm: { x: sx / count, y: sy / count } });
  }
  return stairs;
}

/**
 * Лестница, к которой подошли, или `null`. Ближайшая, если их рядом несколько:
 * спрашивают про ту, у которой стоят.
 */
export function volumeStairNear(stairs, at, reach = VOLUME_STAIR_REACH_MM) {
  let near = null;
  let gap = reach;
  for (const stair of stairs || []) {
    let own = Infinity;
    for (const polygon of stair.polygons) own = Math.min(own, volumePolygonGap(at, polygon));
    if (own > gap) continue;
    gap = own;
    near = stair;
  }
  return near ? { stair: near, distanceMm: gap } : null;
}

/**
 * Куда ведёт лестница: `{floor, options}` — этаж этой схемы и этажи, на которые
 * можно перейти.
 *
 * В список идёт не всякая схема, а та, у которой **задан этаж и есть чертёж**.
 * Этаж — потому что схема без номера не этаж, а просто второй план (развёртка,
 * фрагмент, чужая квартира), и предлагать «перейти» на него значило бы гадать.
 * Чертёж — потому что переход на схему, где показывать нечего, это тупик: окно
 * открылось бы пустым полем и человеку пришлось бы возвращаться.
 *
 * Порядок — по номеру этажа, снизу вверх: так его читают на табличке лифта.
 * Два плана с одним номером (бывает: план этажа и его зеркальная копия)
 * остаются оба и различаются именем схемы — выбрасывать чужую работу по
 * догадке нельзя.
 */
export function volumeFloors(project, schemeId) {
  const options = [];
  for (const scheme of schemesInOrder(project)) {
    if (scheme.id === schemeId) continue;
    const floor = schemeFloorOf(project, scheme.id);
    if (floor === null) continue;
    const drawn =
      wallsOnScheme(project, scheme.id).length > 0 || schemeObjectsOnScheme(project, scheme.id).length > 0;
    if (!drawn) continue;
    options.push({
      schemeId: scheme.id,
      name: scheme.name,
      floor,
      stairs: volumeStairs(project, scheme.id).length > 0,
    });
  }
  options.sort((a, b) => a.floor - b.floor);
  return { floor: schemeFloorOf(project, schemeId), options };
}

// ——— метки ———————————————————————————————————————————————————————————————
//
// Таск 148, второй шаг G205. Где стоит вещь — правила заказчика, записанные
// словами и сведённые в одно решение:
//
//   **Высота решает вертикаль, стена — сторону и место.**
//
//   1. Высота задана и метка привязана к стене → вещь стоит **на своей стене**:
//      отступ вдоль из привязки, высота над полом — середина вещи, сторона — та,
//      на которой метка лежит по плану. Выступ от стены (G197) гонит её наружу.
//   2. Высота задана, стены нет → вещь висит **в своём месте по плану** на
//      заданной высоте.
//   3. Высоты нет → вещь **потолочная**: встаёт под потолок того помещения, в
//      котором стоит, в своём месте по плану. Это не догадка сборки, а то, как
//      заполнен справочник: высота пуста ровно у потолочного света — точечный
//      светильник, светильник, подсветка, лента, трек, люстра, подсветка
//      кровати и шкафа, — и заполнена у всего, что висит на стене.
//   4. Высоты нет и потолка над меткой нет (помещение не обведено или метка
//      лежит вне контуров) → вешать не на что, и вещь **не размещается**:
//      уходит списком «не размещённые». Слова заказчика прямые: выдумывать им
//      место нельзя, но и молча терять нельзя.
//   5. Размеров нет вовсе → вещь рисуется **запасным габаритом** (G215,
//      `VOLUME_MARK_SPARE_MM`) и попадает в сцену, а не в список. Такое бывает
//      у типа, заведённого руками: в стартовом справочнике размеры есть у всех
//      (G192), а «Мастер-выключатель» из объекта заказчика — его собственный
//      тип, и размеров у него нет ни одного. Габарит при этом догадка, и окно
//      говорит об этом списком `spare`: потерять вещь нельзя, но и выдать
//      догадку за чертёж тоже.
//
//      Запас включается только там, где **нет ни длины, ни ширины**: вещь, у
//      которой хоть одно число записано рукой, рисуется ровно как сегодня, и
//      ни один готовый объект от этого не меняется.
//
// **Плашка комментария в объёме не участвует вовсе** — ни вещью, ни строкой
// списка: это надпись на чертеже, а не изделие (то же правило, что у развёртки,
// `markWallBindable`).
//
// Три измерения вещи читаются по той поверхности, на которой она висит, и это
// одно правило на все случаи: **длина — вдоль поверхности, ширина — вторая
// сторона лица, выступ — прочь от поверхности**. На стене лицо стоит
// вертикально (длина вдоль стены, ширина вверх, выступ наружу), на потолке —
// горизонтально (длина и ширина по полу, выступ вниз). Поэтому точечная лента
// ЛВ (40 × 600) на стене сама собой встаёт **вертикальной лентой**, а люстра
// (500 × 400, выступ 300) свисает с потолка своим габаритом: ни одной отдельной
// ветки на эти два случая нет.
//
// **Метки не держат человека.** Сквозь шкаф ходить нельзя — это вещь чертежа, —
// а сквозь розетку можно: препятствием её никто не называл.

/**
 * На сколько лицо вещи выступает перед гранью стены, прежде чем начнётся её
 * выступ. Два миллиметра — не зазор «на всякий случай», а лекарство от
 * совпавших плоскостей: встроенный щит (выступ −30) и плоская панель лежат
 * ровно в грани стены, и без этого сдвига порядок граней между ними решался бы
 * случайно.
 */
export const VOLUME_MARK_LIFT_MM = 2;
/**
 * Самая мелкая сторона вещи. Лента 10 × 10 мм в объёме вырождается в волос, в
 * который не попасть кликом, — и дело не в красоте, а в том, что вещь обязана
 * остаться выделяемой. Двадцать миллиметров на расстоянии вытянутой руки — те
 * же пара точек экрана, что и десять, но грань у них настоящая.
 */
export const VOLUME_MARK_MIN_MM = 20;

/**
 * **Запасной габарит** вещи, у которой размеров нет ни одного (G215).
 *
 * Дыра была такая: `fillTypeSizes` (G192) подтягивает умолчания по коду и по
 * форме знака, но у типа, заведённого рукой с незнакомой формой, донора нет
 * вовсе — и вещь уходила списком «не размещены». То есть выпадала из объёма не
 * из-за данных, а из-за правила, и человек об этом узнавал только строчкой под
 * полем, которую мог и не прочесть.
 *
 * **Откуда числа.** Первый ответ уже написан в развёртке: `elevationMarkBox`
 * при пустом размере берёт габарит **изображения объекта** (`view.mm`), и дыры
 * у неё поэтому нет. Изображения разобраны по формам знаков, и «Мастер-
 * выключатель» заказчика с формой `circle-rays` попадает в светильник
 * (`objectViews/light.js`, 90 × 90) — запас честный и из того же реестра,
 * которым объём уже рисует лица вещей. Так что здесь не заводится второго
 * правила: берётся то же.
 *
 * Изображения нет совсем — остаётся общий запас, и он тоже не выдуман:
 * **80 × 80 × 10 мм** стоит в самом стартовом справочнике у выключателя «В» и
 * розетки «Р» (`TEMPLATE_TYPES`), то есть это обычная рамка, которой в квартире
 * больше всего.
 *
 * **Выступ** у плоского изображения взять негде — его нет ни у одной записи
 * реестра, они двумерные. Поэтому выступ и общему запасу, и запасу по
 * изображению даётся один: те же 10 мм рамки из справочника. Двух миллиметров
 * (`VOLUME_MARK_LIFT_MM`, с которыми вещь без выступа рисуется сегодня) здесь
 * мало: вещь, у которой и размеры запасные, под потолком стала бы плёнкой.
 *
 * **В справочник не пишется ничего** (G68): запас живёт в сцене, на время
 * рисования. Иначе человек увидел бы у своего типа чужие числа и решил, что
 * сам их задал, — а они догадка сборки, и сказать о ней надо словом
 * (`spare` в `volumeMarks`), а не записью в объект.
 */
export const VOLUME_MARK_SPARE_MM = 80;
export const VOLUME_MARK_SPARE_DEPTH_MM = 10;

/**
 * Запасной габарит по изображению объекта или общий. `view` — изображение вещи
 * (`volumeMarkView`), `null` — такого нет.
 *
 * Чистая и вынесена наружу: откуда у вещи взялся габарит — это правило, и
 * проверяться оно обязано тестом, а не глазами на кадре.
 */
export function volumeSpareBox(view) {
  const mm = view && view.mm ? view.mm : null;
  if (mm && Number(mm.width) > 0 && Number(mm.height) > 0) {
    return { lengthMm: Number(mm.width), widthMm: Number(mm.height), depthMm: VOLUME_MARK_SPARE_DEPTH_MM, from: view.name || "view" };
  }
  return {
    lengthMm: VOLUME_MARK_SPARE_MM,
    widthMm: VOLUME_MARK_SPARE_MM,
    depthMm: VOLUME_MARK_SPARE_DEPTH_MM,
    from: null,
  };
}

/** Как вещь поставлена: на стене, в воздухе на своей высоте, под потолком. */
export const VOLUME_MARK_WALL = "wall";
export const VOLUME_MARK_ROOM = "room";
export const VOLUME_MARK_CEILING = "ceiling";

/** Почему вещь не размещена. Строки к этим кодам — в окне, не здесь. */
export const VOLUME_MARK_NO_POINT = "noPoint";
export const VOLUME_MARK_NO_SIZE = "noSize";
export const VOLUME_MARK_NO_PLACE = "noPlace";

/** Толщина контура изображения — в экранных точках (см. `volumeLine`). */
const VOLUME_VIEW_LINE_PX = 1.4;
/** На сколько контур отодвинут от лица вещи, чтобы не спорить с ним за порядок. */
const VOLUME_VIEW_LIFT_MM = 1;
/** Во сколько отрезков разбирается полная окружность изображения. */
const VOLUME_VIEW_STEPS = 16;

// Светлота тела вещи: цвет категории, разбавленный белым, и контур поверх него
// — тем же цветом в полную силу. Так вещь читается и издали (пятно цвета
// категории видно, когда контур уже слился), и вблизи (контур насыщеннее
// своего тела, как тушь по бумаге на развёртке).
//
// Доля подобрана живым прогоном, и оба края пробовались на нём же: при 0,7 тело
// почти догоняет контур по насыщенности, и решётка бризера на нём пропадает; при
// 0,3 бледное пятно теряется на светлой стене. Замечание таска 139 («цвет на
// всей поверхности читается хуже контура») верно и здесь — поэтому цвет и
// разбавлен, а не взят в полную силу.
const VOLUME_MARK_TINT = 0.45;
const VOLUME_MARK_BASE = [226, 224, 220];

function volumeTint(rgb) {
  return [0, 1, 2].map((index) =>
    Math.round(rgb[index] * VOLUME_MARK_TINT + VOLUME_MARK_BASE[index] * (1 - VOLUME_MARK_TINT)),
  );
}

/** Цвет метки тройкой каналов; незнакомый — серый, как и в `styleOf`. */
function volumeRgbOf(color) {
  const rgb = hexToRgb(color);
  return rgb ? [rgb.r, rgb.g, rgb.b] : [120, 120, 120];
}

// Точки метки в миллиметрах чертежа. Пусто — моста к подложке нет (ADR 008) или
// точек у метки не осталось: место неизвестно, и выдумывать его нельзя.
function volumeMarkPathMm(project, mark) {
  const out = [];
  for (const point of mark.points || []) {
    const at = planFractionToMm(project, mark.schemeId, point);
    if (!at) return [];
    out.push(at);
  }
  return out;
}

function volumePathMiddle(path) {
  const xs = path.map((point) => point.x);
  const ys = path.map((point) => point.y);
  return { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
}

/** Изображение объекта у метки: имя у типа старше формы знака (ADR 005). */
export function volumeMarkView(project, mark) {
  const type = findType(project, mark.typeId);
  const style = styleOf(project, mark.typeId);
  return objectViewByName(typeObjectView(type)) || objectViewForShape(style.shape);
}

// Прямоугольник в плане вокруг точки: `along` вдоль направления `u`, `across`
// поперёк него. Из него выходит и тело точечной вещи, и звено ленты.
function volumeBoxCorners(at, u, alongMm, acrossMm) {
  const n = { x: u.y, y: -u.x };
  const ha = alongMm / 2;
  const hc = acrossMm / 2;
  return volumeClockwise([
    { x: at.x - u.x * ha - n.x * hc, y: at.y - u.y * ha - n.y * hc },
    { x: at.x + u.x * ha - n.x * hc, y: at.y + u.y * ha - n.y * hc },
    { x: at.x + u.x * ha + n.x * hc, y: at.y + u.y * ha + n.y * hc },
    { x: at.x - u.x * ha + n.x * hc, y: at.y - u.y * ha + n.y * hc },
  ]);
}

// Звенья ленты: по призме на отрезок пути, поперечник у всех один. То же, что у
// ломаного объекта чертежа (`volumeObjectPrisms`), и по той же причине —
// соседние звенья заходят друг в друга на изломе, как две стены в углу.
function volumePathPrisms(path, acrossMm, bottomMm, topMm) {
  const prisms = [];
  for (let index = 0; index + 1 < path.length; index += 1) {
    const a = path[index];
    const b = path[index + 1];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length = Math.hypot(dx, dy);
    if (!(length > 0)) continue;
    const u = { x: dx / length, y: dy / length };
    const middle = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    prisms.push({ corners: volumeBoxCorners(middle, u, length, acrossMm), bottomMm, topMm });
  }
  return prisms;
}

/**
 * Где стоит одна метка — или почему не стоит нигде.
 *
 * `null` — того, чего в объёме нет вовсе (плашка комментария); `{markId, skip}`
 * — неразмещённая; полное описание места — размещённая. Чистая: ни холста, ни
 * строк, — правило места обязано проверяться без браузера.
 */
export function volumeMarkPlacement(project, mark, rooms = []) {
  if (!mark || markIsComment(mark)) return null;
  const path = volumeMarkPathMm(project, mark);
  if (path.length === 0) return { markId: mark.id, skip: VOLUME_MARK_NO_POINT };
  const sizes = markSizes(project, mark);
  const markView = volumeMarkView(project, mark);
  // Размеров нет ни одного — вещь рисуется запасным габаритом (G215). Строки
  // `VOLUME_MARK_NO_SIZE` в списке неразмещённых после этого не бывает вовсе,
  // но код остаётся: окно знает его, и объект прежнего формата в середине
  // пересборки не должен спорить с новым правилом.
  const spare = !(sizes.length > 0) && !(sizes.width > 0) ? volumeSpareBox(markView) : null;
  const lengthMm = Math.max(VOLUME_MARK_MIN_MM, (spare ? spare.lengthMm : sizes.length) || 0);
  const widthMm = Math.max(VOLUME_MARK_MIN_MM, (spare ? spare.widthMm : sizes.width) || 0);
  // Выступ **не подтягивается до самой мелкой стороны**: это измерение, по
  // которому ничего не выделяют, и округли его до двадцати — плоская панель
  // стала бы вдвое толще себя. Хватает двух миллиметров: тело перестаёт быть
  // вырожденным, а у встроенного светильника выступ и правда нулевой.
  //
  // Запасной выступ берётся только вместе с запасным габаритом и только там,
  // где своего нет: записанный ноль — это ноль («встроенный»), а не пустота.
  const depthOwn = spare && sizes.depth === null ? spare.depthMm : sizes.depth;
  const depthMm = Math.max(VOLUME_MARK_LIFT_MM, Math.abs(depthOwn || 0));
  const recessed = Number(sizes.depth) < 0;
  const line = mark.kind === "line" && path.length >= 2;
  const style = styleOf(project, mark.typeId);
  const rgb = volumeRgbOf(style.color);
  const common = {
    markId: mark.id,
    label: labelOf(project, mark.id),
    color: style.color,
    rgb,
    bodyRgb: volumeTint(rgb),
    kind: line ? "line" : "point",
    view: line ? null : markView,
    // Габарит — догадка сборки, а не чертёж: окно обязано сказать об этом
    // словом (`volumeMarks().spare`). Откуда именно взят запас, здесь не
    // хранится: это правило `volumeSpareBox`, и спрашивают его у неё.
    spare: Boolean(spare),
  };
  const heightMm = sizes.heightAboveFloor;
  const binding = markWall(mark);
  const wall = binding ? findWall(project, binding.wallId) : null;
  const vectors = wall ? wallVectors(wall) : null;
  const side = wall && vectors ? markWallSideOn(project, mark, wall.id) : null;

  // ——— на своей стене ———
  if (heightMm !== null && wall && vectors && side) {
    const sign = side === "left" ? 1 : -1;
    const normal = { x: vectors.n.x * sign, y: vectors.n.y * sign, z: 0 };
    const faceMm = Number(wall.thicknessMm) / 2 + VOLUME_MARK_LIFT_MM;
    // Отступ берётся из привязки **как есть**: зеркалит отступы только лист
    // развёртки (таск 129), а объёму нужны обе стороны стены разом.
    const to = binding.toMm === null ? binding.atMm : binding.toMm;
    const fromMm = Math.min(binding.atMm, to);
    const toMm = Math.max(binding.atMm, to);
    const alongMm = line ? Math.max(VOLUME_MARK_MIN_MM, toMm - fromMm) : lengthMm;
    const middle = (fromMm + toMm) / 2;
    // Выступ идёт наружу от грани стены; утопленное (щит, выступ −30) уходит
    // внутрь, но лицом остаётся в плоскости стены — иначе его не было бы видно.
    const outer = recessed ? faceMm : faceMm + depthMm;
    const inner = recessed ? faceMm - depthMm : faceMm;
    const at = (across) => ({
      x: Number(wall.aMm.x) + vectors.u.x * middle + normal.x * across,
      y: Number(wall.aMm.y) + vectors.u.y * middle + normal.y * across,
    });
    const faceAt = at(outer);
    return {
      ...common,
      mode: VOLUME_MARK_WALL,
      wallId: wall.id,
      side,
      heightMm,
      prisms: [
        {
          corners: volumeBoxCorners(at((outer + inner) / 2), vectors.u, alongMm, Math.max(outer - inner, 1)),
          bottomMm: heightMm - widthMm / 2,
          topMm: heightMm + widthMm / 2,
        },
      ],
      anchor: { x: faceAt.x, y: faceAt.y, z: heightMm },
      // Лицо вещи — её наружная грань: по нему рисуется изображение объекта.
      face: {
        origin: { x: faceAt.x, y: faceAt.y, z: heightMm },
        u: { x: vectors.u.x, y: vectors.u.y, z: 0 },
        v: { x: 0, y: 0, z: 1 },
        normal,
        widthMm: alongMm,
        heightMm: widthMm,
      },
    };
  }

  // ——— в воздухе на своей высоте и под потолком ———
  const middle = volumePathMiddle(path);
  const room = heightMm === null ? volumeRoomAt({ rooms }, middle) : null;
  if (heightMm === null && !room) return { markId: mark.id, skip: VOLUME_MARK_NO_PLACE };
  const topMm = heightMm === null ? room.heightMm : heightMm + depthMm / 2;
  const bottomMm = topMm - depthMm;
  const centreMm = (topMm + bottomMm) / 2;
  const prisms = line
    ? volumePathPrisms(path, lengthMm, bottomMm, topMm)
    : [{ corners: volumeBoxCorners(middle, { x: 1, y: 0 }, lengthMm, widthMm), bottomMm, topMm }];
  if (prisms.length === 0) return { markId: mark.id, skip: VOLUME_MARK_NO_POINT };
  return {
    ...common,
    mode: heightMm === null ? VOLUME_MARK_CEILING : VOLUME_MARK_ROOM,
    roomId: room ? room.roomId : null,
    heightMm: centreMm,
    prisms,
    anchor: { x: middle.x, y: middle.y, z: centreMm },
    // Лицо потолочной вещи смотрит вниз: на светильник смотрят снизу, и
    // изображение объекта рисуется на нижней грани.
    face: line
      ? null
      : {
          origin: { x: middle.x, y: middle.y, z: bottomMm },
          u: { x: 1, y: 0, z: 0 },
          v: { x: 0, y: 1, z: 0 },
          normal: { x: 0, y: 0, z: -1 },
          widthMm: lengthMm,
          heightMm: widthMm,
        },
  };
}

/**
 * Все метки схемы: размещённые, список тех, кому места не нашлось, и список
 * нарисованных запасным габаритом (G215).
 *
 * `marks` — что считать: окно отдаёт сюда видимые на плане, чтобы фильтр значил
 * в двух видах одно и то же. Порядок сохраняется — списки читаются в том же
 * порядке, что таблица меток.
 *
 * Запасной габарит — не потеря, а догадка: вещь в сцене есть, но её размер
 * сборка выдумала. Поэтому `spare` отдельным списком, а не причиной в
 * `unplaced`: это разные новости, и смешивать их нельзя.
 */
export function volumeMarks(project, schemeId, { marks, rooms } = {}) {
  const list = marks || (project ? project.marks.filter((mark) => mark.schemeId === schemeId) : []);
  const placed = [];
  const unplaced = [];
  const spare = [];
  for (const mark of list) {
    const place = volumeMarkPlacement(project, mark, rooms || []);
    if (!place) continue;
    if (place.skip) {
      unplaced.push({ markId: mark.id, label: labelOf(project, mark.id), reason: place.skip });
      continue;
    }
    placed.push(place);
    if (place.spare) spare.push({ markId: place.markId, label: place.label });
  }
  return { placed, unplaced, spare };
}

/** Грани тела вещи. Хозяин у каждой — сама метка: по ним и ловится клик. */
export function volumeMarkFaces(place, out = []) {
  for (const prism of place.prisms || []) {
    volumePrismFaces(prism.corners, prism.bottomMm, prism.topMm, place.bodyRgb, out, { markId: place.markId });
  }
  return out;
}

/**
 * **Второй интерпретатор изображений объектов** (таск 139, G198).
 *
 * Обещание того таска проверяется здесь: объёму хватило тех же пяти примитивов,
 * и ни одной записи переписывать не пришлось. Разница с плоским интерпретатором
 * (`objectViews/registry.js`, `drawPart`) одна, и она в природе вывода: тот
 * рисует по холсту и умеет дуги со скруглениями сам, а этому нужны **точки** —
 * окружность, дуга и скруглённый угол разбираются на отрезки здесь.
 *
 * Доли те же: −0.5…0.5 по сторонам своего прямоугольника.
 */
export function volumeViewPolylines(view) {
  const lines = [];
  for (const part of (view && view.parts) || []) {
    if (part.kind === "line") {
      lines.push({ points: [{ x: part.x1, y: part.y1 }, { x: part.x2, y: part.y2 }], closed: false });
      continue;
    }
    if (part.kind === "poly") {
      lines.push({ points: (part.points || []).map(([x, y]) => ({ x, y })), closed: Boolean(part.close) });
      continue;
    }
    if (part.kind === "rect") {
      lines.push({ points: volumeRectPoints(part), closed: true });
      continue;
    }
    if (part.kind === "circle") {
      lines.push({ points: volumeArcPoints(part.cx, part.cy, part.r, 0, Math.PI * 2), closed: true });
      continue;
    }
    if (part.kind === "arc") {
      lines.push({
        points: volumeArcPoints(part.cx, part.cy, part.r, part.from, part.to),
        closed: Boolean(part.close),
      });
    }
  }
  return lines.filter((item) => item.points.length >= 2);
}

// Дуга отрезками. Шаг — доля полного круга, но не меньше двух отрезков: у
// четверти окружности их выходит четыре, и излома на лице вещи не видно.
function volumeArcPoints(cx, cy, r, from, to) {
  const span = Math.abs(to - from);
  const steps = Math.max(2, Math.round((VOLUME_VIEW_STEPS * span) / (Math.PI * 2)));
  const points = [];
  for (let index = 0; index <= steps; index += 1) {
    const angle = from + ((to - from) * index) / steps;
    points.push({ x: cx + Math.cos(angle) * r, y: cy + Math.sin(angle) * r });
  }
  // Полная окружность: последняя точка совпала бы с первой, а замкнутость
  // говорится признаком `closed`, а не дублем вершины.
  if (span >= Math.PI * 2 - 1e-6) points.pop();
  return points;
}

// Прямоугольник со скруглением: углы — те же дуги. Радиус в долях, как у
// плоского интерпретатора, и так же зажат половиной короткой стороны.
function volumeRectPoints(part) {
  const left = part.x;
  const top = part.y;
  const right = part.x + part.width;
  const bottom = part.y + part.height;
  const r = Math.max(0, Math.min(Number(part.radius) || 0, Math.min(Math.abs(part.width), Math.abs(part.height)) / 2));
  if (!(r > 0)) {
    return [
      { x: left, y: top },
      { x: right, y: top },
      { x: right, y: bottom },
      { x: left, y: bottom },
    ];
  }
  const corner = (cx, cy, from, to) => volumeArcPoints(cx, cy, r, from, to);
  return [
    ...corner(left + r, top + r, Math.PI, Math.PI * 1.5),
    ...corner(right - r, top + r, Math.PI * 1.5, Math.PI * 2),
    ...corner(right - r, bottom - r, 0, Math.PI * 0.5),
    ...corner(left + r, bottom - r, Math.PI * 0.5, Math.PI),
  ];
}

/**
 * Доля лица вещи → точка в миллиметрах чертежа и высоте над полом.
 *
 * Доля по высоте берётся **с обратным знаком**: у плоского интерпретатора ось
 * `y` растёт вниз (так устроен холст), а здесь вверх. Без этого решётка
 * кондиционера оказалась бы над индикатором, а клавиша выключателя — под
 * рамкой: изображение рисовалось бы вверх ногами и молча.
 */
export function volumeFacePoint(face, fx, fy) {
  const alongMm = fx * face.widthMm;
  const upMm = -fy * face.heightMm;
  return {
    x: face.origin.x + face.u.x * alongMm + face.v.x * upMm + face.normal.x * VOLUME_VIEW_LIFT_MM,
    y: face.origin.y + face.u.y * alongMm + face.v.y * upMm + face.normal.y * VOLUME_VIEW_LIFT_MM,
    z: face.origin.z + face.u.z * alongMm + face.v.z * upMm + face.normal.z * VOLUME_VIEW_LIFT_MM,
  };
}

/**
 * Контур вещи — её изображением объекта, цветом метки.
 *
 * Изображения нет (тип без имени и с формой, которой изображения не завели) —
 * нет и контура: вещь остаётся своей плашкой цвета категории. Условный знак
 * плана сюда не переносится нарочно: знак читают как обозначение рядом с
 * подписью, а в объёме подписи нет, и знак стал бы украшением.
 */
export function volumeMarkViewLines(place, out = []) {
  if (!place || !place.face || !place.view) return out;
  for (const line of volumeViewPolylines(place.view)) {
    out.push(
      volumeLine(
        line.points.map((point) => volumeFacePoint(place.face, point.x, point.y)),
        place.color,
        {
          closed: line.closed,
          normal: place.face.normal,
          width: VOLUME_VIEW_LINE_PX,
          markId: place.markId,
        },
      ),
    );
  }
  return out;
}

// ——— выделение и связи ———————————————————————————————————————————————————
//
// Выделение в объёме **общее с планом** (слова заказчика): окно и список меток
// смотрят в одно и то же поле состояния, и кто выделил первым — неважно.
// Поэтому здесь только рамка, а живёт выделение там же, где жило.
//
// И рамка, и стрелки лежат **поверх всего** (`VOLUME_LAYER_MARK`) — это прямое
// решение заказчика: «стрелка идёт сквозь стену». Цель в соседней комнате иначе
// пропадала бы за перегородкой вместе с ответом на вопрос, куда связь ведёт.
// Чтобы сквозная линия не врала о том, что видно глазами, связь рисуется
// **дважды**: сплошной в общем потоке (её закрывают стены, как и положено) и
// тонкой пунктирной поверх всего. Там, где связь видна, пунктир ложится на свою
// же сплошную линию и не заметен; там, где она за стеной, остаётся один
// пунктир — он и значит «цель за стеной».

/** Цвет рамки выделения — тот же, что на плане (`drawMarkBody`). */
export const VOLUME_SELECT_COLOR = "#0969DA";
/** Цвета связей — те же, что на плане (`LINK_COLOR` и `LINK_TIE_COLOR`). */
export const VOLUME_LINK_COLOR = "#BF3989";
export const VOLUME_TIE_COLOR = "#0F2E7A";
/** Во сколько глушится поднятое цепочкой, но выделенной метки не касающееся. */
const VOLUME_LINK_FAR = 0.4;
/** Насколько видна сквозь стену та часть связи, которую закрывает геометрия. */
const VOLUME_LINK_THROUGH = 0.55;
const VOLUME_LINK_WIDTH = 2.2;
const VOLUME_LINK_THROUGH_WIDTH = 1.1;
const VOLUME_LINK_DASH = [6, 5];
const VOLUME_SELECT_DASH = [7, 5];
const VOLUME_SELECT_GROW = 1.3;

/** Тот же тон вполсилы: прозрачность пишется в сам цвет. */
export function volumeFade(color, alpha) {
  const rgb = hexToRgb(color) || { r: 120, g: 120, b: 120 };
  return "rgba(" + rgb.r + "," + rgb.g + "," + rgb.b + "," + Math.round(alpha * 100) / 100 + ")";
}

/**
 * Рамка выделенной вещи: по её лицу у точки, по оси у ленты. Пунктир и цвет те
 * же, что у кольца выделения на плане: одна и та же метка не должна выделяться
 * в двух видах по-разному.
 */
export function volumeSelectLines(place, out = []) {
  if (!place) return out;
  if (place.face) {
    const half = VOLUME_SELECT_GROW / 2;
    out.push(
      volumeLine(
        [
          volumeFacePoint(place.face, -half, -half),
          volumeFacePoint(place.face, half, -half),
          volumeFacePoint(place.face, half, half),
          volumeFacePoint(place.face, -half, half),
        ],
        VOLUME_SELECT_COLOR,
        { closed: true, dash: VOLUME_SELECT_DASH, width: 2, layer: VOLUME_LAYER_MARK },
      ),
    );
    return out;
  }
  // Лента: рамки у неё нет, обводится сама — так же, как на плане выделяется
  // линия, а не кольцо вокруг каждой её вершины.
  for (const prism of place.prisms || []) {
    const middleZ = (prism.bottomMm + prism.topMm) / 2;
    out.push(
      volumeLine(
        prism.corners.map((point) => ({ x: point.x, y: point.y, z: middleZ })),
        VOLUME_SELECT_COLOR,
        { closed: true, dash: VOLUME_SELECT_DASH, width: 2, layer: VOLUME_LAYER_MARK },
      ),
    );
  }
  return out;
}

/**
 * Стрелки связей по правилам плана.
 *
 * Правила, **какие** связи показывать, берутся с плана целиком
 * (`canvas.canvasFrameLinks` → `render.markLinks`): управление — дугой со
 * стрелкой, общее управление — без стрелки (это отношение равных), общий номер
 * — кольцом по своим меткам. Вторых правил здесь не заводится: разойдись они, у
 * одной метки на плане и в объёме оказались бы разные связи.
 *
 * `anchorOf` отвечает, где в объёме стоит метка. Неразмещённой вещи в объёме
 * нет — нет и стрелки к ней: это было бы указание в пустоту. Почему её нет,
 * отвечает список неразмещённых.
 */
export function volumeLinkLines(links, anchorOf, out = []) {
  const pair = (item, color, arrow) => {
    const from = anchorOf(item.fromId);
    const to = anchorOf(item.toId);
    if (!from || !to) return;
    const alpha = item.near === false ? VOLUME_LINK_FAR : 1;
    out.push(
      volumeLine([from, to], alpha === 1 ? color : volumeFade(color, alpha), { width: VOLUME_LINK_WIDTH, arrow }),
    );
    out.push(
      volumeLine([from, to], volumeFade(color, VOLUME_LINK_THROUGH * alpha), {
        width: VOLUME_LINK_THROUGH_WIDTH,
        dash: VOLUME_LINK_DASH,
        arrow,
        layer: VOLUME_LAYER_MARK,
      }),
    );
  };
  for (const line of (links && links.lines) || []) pair(line, VOLUME_LINK_COLOR, true);
  for (const tie of (links && links.ties) || []) pair(tie, VOLUME_TIE_COLOR, false);
  for (const group of (links && links.groups) || []) {
    const points = (group.markIds || []).map((id) => anchorOf(id)).filter(Boolean);
    if (points.length < 2) continue;
    const alpha = group.near === false ? VOLUME_LINK_FAR : 1;
    // Кольцом по углу вокруг середины: тождество — не цепь, у него нет ни
    // начала, ни направления, и замкнутая линия говорит об этом сама.
    const centre = {
      x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
      y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
    };
    const ring = [...points].sort(
      (first, second) =>
        Math.atan2(first.y - centre.y, first.x - centre.x) - Math.atan2(second.y - centre.y, second.x - centre.x),
    );
    out.push(volumeLine(ring, volumeFade(VOLUME_LINK_COLOR, alpha), { closed: true, dash: VOLUME_LINK_DASH, width: 1.4 }));
    out.push(
      volumeLine(ring, volumeFade(VOLUME_LINK_COLOR, VOLUME_LINK_THROUGH * alpha), {
        closed: true,
        dash: VOLUME_LINK_DASH,
        width: 1,
        layer: VOLUME_LAYER_MARK,
      }),
    );
  }
  return out;
}

// ——— сцена ———————————————————————————————————————————————————————————————

/**
 * Вся сцена схемы: грани, препятствия, помещения, границы, где встать.
 *
 * `empty` — объект без чертежа: окно открывается и говорит, что показывать
 * нечего. `notes` — коды того, о чём окно обязано сказать вслух: нет моста к
 * подложке, помещения не обведены, высота не задана.
 *
 * `options.marks` — какие метки ставить (таск 148). Окно отдаёт сюда видимые на
 * плане: фильтр спрятал метку на плане — она не появляется и в объёме, иначе в
 * двух видах одного объекта пришлось бы держать два ответа на вопрос «что
 * показано». Без него берутся все метки схемы.
 *
 * `options.openDoorIds` — какие двери раскрыты (G207). Без него закрыты все, и
 * это умолчание: состояние двери живёт в сеансе окна и в объект не попадает
 * никогда (G68). Поэтому оно и приходит аргументом сборки, а не полем проёма.
 */
export function volumeScene(project, schemeId, options = {}) {
  const scheme = findScheme(project, schemeId);
  if (!scheme) return null;
  const walls = wallsOnScheme(project, schemeId);
  const objects = schemeObjectsOnScheme(project, schemeId);
  const notes = [];
  if (walls.length === 0 && objects.length === 0) {
    // Без чертежа метку ставить не на что: ни стен, ни пола, ни потолка. Это
    // не потеря — объём и так говорит, что показывать нечего.
    return {
      empty: true,
      notes: [],
      faces: [],
      order: null,
      solids: [],
      rooms: [],
      boundsMm: null,
      doors: [],
      stairs: [],
      marks: [],
      unplaced: [],
      spare: [],
    };
  }
  const rooms = volumeRooms(project, schemeId);
  const schemeHeight = volumeHeightMm(project, schemeId, null);
  if (!schemeHeight.known && !rooms.some((room) => room.heightKnown)) notes.push("noHeight");
  const faces = [];
  const bounds = drawingBoundsMm(project, schemeId);
  // Плита под чертежом — нулевой ярус. Она есть всегда: с обведёнными
  // помещениями закрывает пороги и щели у стен, без них остаётся единственным
  // полом. Потолка в этом случае нет вовсе — накрыть всё одной крышкой значило
  // бы соврать о том, где кончается комната, и отнять обзор со стороны.
  if (bounds) {
    faces.push(
      volumeFace(
        volumeClockwise([
          { x: bounds.minX, y: bounds.minY },
          { x: bounds.maxX, y: bounds.minY },
          { x: bounds.maxX, y: bounds.maxY },
          { x: bounds.minX, y: bounds.maxY },
        ]).map((point) => volumeAt(point, 0)),
        VOLUME_FLOOR_RGB,
        { normal: { x: 0, y: 0, z: 1 }, layer: VOLUME_LAYER_BASE },
      ),
    );
  }
  for (const room of rooms) {
    faces.push(
      volumeFace(
        room.pointsMm.map((point) => volumeAt(point, 0)),
        VOLUME_FLOOR_RGB,
        { normal: { x: 0, y: 0, z: 1 }, layer: VOLUME_LAYER_GROUND },
      ),
    );
    faces.push(
      volumeFace(
        [...room.pointsMm].reverse().map((point) => volumeAt(point, room.heightMm)),
        VOLUME_CEILING_RGB,
        { normal: { x: 0, y: 0, z: -1 }, layer: VOLUME_LAYER_GROUND },
      ),
    );
  }
  if (rooms.length === 0) {
    notes.push(outlinesInOrder(project, schemeId).length > 0 ? "noBridge" : "noRooms");
  }
  const solids = [];
  // Все двери схемы: по этому списку хоткей «все двери» (G210) знает, что
  // открывать, не спрашивая объект второй раз.
  const doors = [];
  for (const wall of walls) {
    const openings = openingsInWall(project, wall.id);
    for (const opening of openings) {
      if (opening.kind === OPENING_KIND_DOOR && opening.id) doors.push(opening.id);
    }
    const left = wallHeightOnSide(project, wall.id, "left");
    const right = wallHeightOnSide(project, wall.id, "right");
    const height = Math.max(left > 0 ? left : 0, right > 0 ? right : 0) || schemeHeight.mm;
    volumeWallFaces(wall, openings, height, faces, options.openDoorIds || null);
    const vectors = wallVectors(wall);
    if (!vectors) continue;
    for (const span of volumeWallSolids(wall, openings)) {
      const middle = (span.fromMm + span.toMm) / 2;
      solids.push({
        cx: Number(wall.aMm.x) + vectors.u.x * middle,
        cy: Number(wall.aMm.y) + vectors.u.y * middle,
        ux: vectors.u.x,
        uy: vectors.u.y,
        nx: vectors.n.x,
        ny: vectors.n.y,
        half: (span.toMm - span.fromMm) / 2,
        halfT: Number(wall.thicknessMm) / 2,
      });
    }
  }
  for (const object of objects) {
    for (const prism of volumeObjectPrisms(project, schemeId, object, schemeHeight.mm)) {
      volumePrismFaces(prism.corners, prism.bottomMm, prism.topMm, VOLUME_OBJECT_RGB, faces);
      if (!volumePrismBlocks(prism)) continue;
      const solid = volumePrismSolid(prism);
      if (solid) solids.push(solid);
    }
  }
  // Метки — последними: их тела и контуры ложатся в тот же поток граней, что
  // стены и вещи чертежа, и спорят с ними порядком, а не ярусом. Вещь на стене
  // стоит перед стеной — это и значит «перед»; препятствием она при этом не
  // становится (сквозь розетку ходят).
  const marks = volumeMarks(project, schemeId, { marks: options.marks, rooms });
  for (const place of marks.placed) {
    volumeMarkFaces(place, faces);
    volumeMarkViewLines(place, faces);
  }
  // `wallCount` — настоящее число стен чертежа, а не длина `solids`: препятствий
  // больше, потому что проём режет стену на куски, а вещи на полу тоже держат.
  // Окно говорит о чертеже, и путать эти два числа нельзя.
  return {
    empty: false,
    notes,
    faces,
    // Дерево порядка строится здесь, один раз на сцену: кадру остаётся обход.
    order: volumeOrderTree(faces),
    solids,
    rooms,
    boundsMm: bounds,
    heightMm: schemeHeight.mm,
    wallCount: walls.length,
    openingCount: walls.reduce((sum, wall) => sum + openingsInWall(project, wall.id).length, 0),
    doors,
    // Лестницы схемы (таск 149): по ним окно спрашивает про этаж. Лежат в
    // сцене, а не ищутся на каждом шаге, — спрашивается это на каждом шаге, а
    // меняется только вместе с чертежом, то есть вместе со всей сценой.
    stairs: volumeStairs(project, schemeId),
    marks: marks.placed,
    unplaced: marks.unplaced,
    // Нарисованные запасным габаритом (G215): вещь в сцене есть, а размер её
    // сборка выдумала — окно называет такие вещи вслух.
    spare: marks.spare,
  };
}

/**
 * Какую дверь показывают (G207): ищется по полотну и ручке, сверху вниз — тем
 * же порядком, которым рисовался кадр, только с конца. Запас промаха тот же,
 * что у вещей: полотно в три метра занимает полкадра, а ручка — пару точек, и
 * требовать попадания в саму дверь на другом конце коридора незачем.
 */
export function volumeDoorAt(polygons, x, y, slack = VOLUME_PICK_SLACK_PX) {
  let near = null;
  let gap = slack;
  for (let index = polygons.length - 1; index >= 0; index -= 1) {
    const polygon = polygons[index];
    if (!polygon.door || polygon.stroke) continue;
    if (volumePolygonHit(polygon.xy, x, y)) return polygon.door;
    const centre = volumePolygonCentre(polygon.xy);
    const distance = Math.hypot(centre.x - x, centre.y - y);
    if (distance < gap) {
      gap = distance;
      near = polygon.door;
    }
  }
  return near;
}

/** Где в объёме стоит метка — по её месту в сцене. `null` — не размещена. */
export function volumeMarkAnchor(scene, markId) {
  for (const place of (scene && scene.marks) || []) {
    if (place.markId === markId) return place.anchor;
  }
  return null;
}

/** Размещение метки в сцене по её идентификатору. */
export function volumeMarkPlace(scene, markId) {
  for (const place of (scene && scene.marks) || []) {
    if (place.markId === markId) return place;
  }
  return null;
}

// ——— где встать ——————————————————————————————————————————————————————————

/** Расстояние от точки до препятствия (отрицательное — внутри). */
function volumeGap(solid, x, y) {
  const dx = x - solid.cx;
  const dy = y - solid.cy;
  const along = Math.abs(dx * solid.ux + dy * solid.uy) - solid.half;
  const across = Math.abs(dx * solid.nx + dy * solid.ny) - solid.halfT;
  if (along <= 0 && across <= 0) return Math.max(along, across);
  return Math.hypot(Math.max(along, 0), Math.max(across, 0));
}

/** Сколько свободного места вокруг точки. */
export function volumeFreeMm(solids, x, y) {
  let free = Infinity;
  for (const solid of solids) free = Math.min(free, volumeGap(solid, x, y));
  return free;
}

/**
 * Откуда начинать ходить: самое просторное место самой большой комнаты.
 *
 * Серединой контура ограничиться нельзя — у Г-образной кухни она лежит в
 * вырезе, то есть внутри стены. Поэтому по габариту контура идёт сетка проб, и
 * из точек внутри контура берётся та, вокруг которой больше всего места.
 * Взгляд направляется на дальнюю вершину: человек, открывший окно, должен
 * увидеть комнату, а не упереться в ближний угол.
 */
export function volumeStart(scene) {
  const rooms = [...(scene.rooms || [])].sort((a, b) => volumeArea(b.pointsMm) - volumeArea(a.pointsMm));
  const solids = scene.solids || [];
  const candidates = [];
  for (const room of rooms.slice(0, 1)) {
    const xs = room.pointsMm.map((point) => point.x);
    const ys = room.pointsMm.map((point) => point.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const steps = 6;
    for (let ix = 1; ix < steps; ix += 1) {
      for (let iy = 1; iy < steps; iy += 1) {
        const point = { x: minX + ((maxX - minX) * ix) / steps, y: minY + ((maxY - minY) * iy) / steps };
        if (!volumePointInside(point, room.pointsMm)) continue;
        candidates.push({ point, room, free: volumeFreeMm(solids, point.x, point.y) });
      }
    }
  }
  if (candidates.length === 0) {
    const bounds = scene.boundsMm;
    const point = bounds
      ? { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 }
      : { x: 0, y: 0 };
    const pushed = volumePush(solids, point, VOLUME_BODY_MM);
    return { x: pushed.x, y: pushed.y, yaw: 0 };
  }
  candidates.sort((a, b) => b.free - a.free);
  const best = candidates[0];
  const pushed = volumePush(solids, best.point, VOLUME_BODY_MM);
  let far = best.room.pointsMm[0];
  let distance = -1;
  for (const point of best.room.pointsMm) {
    const length = Math.hypot(point.x - pushed.x, point.y - pushed.y);
    if (length > distance) {
      distance = length;
      far = point;
    }
  }
  return { x: pushed.x, y: pushed.y, yaw: Math.atan2(far.y - pushed.y, far.x - pushed.x) };
}

/**
 * Выталкивание тела из стен. Круг против повёрнутого прямоугольника: уходим по
 * той оси, по которой пересечение меньше, — так тело скользит вдоль стены, а
 * не останавливается, уткнувшись. Четыре прохода держат угол, где давят сразу
 * две стены.
 */
export function volumePush(solids, at, radius) {
  let x = at.x;
  let y = at.y;
  for (let pass = 0; pass < VOLUME_PUSH_PASSES; pass += 1) {
    let moved = false;
    for (const solid of solids) {
      const dx = x - solid.cx;
      const dy = y - solid.cy;
      const along = dx * solid.ux + dy * solid.uy;
      const across = dx * solid.nx + dy * solid.ny;
      const overAlong = solid.half + radius - Math.abs(along);
      const overAcross = solid.halfT + radius - Math.abs(across);
      if (overAlong <= 0 || overAcross <= 0) continue;
      moved = true;
      if (overAcross <= overAlong) {
        const sign = across >= 0 ? 1 : -1;
        x += solid.nx * sign * overAcross;
        y += solid.ny * sign * overAcross;
      } else {
        const sign = along >= 0 ? 1 : -1;
        x += solid.ux * sign * overAlong;
        y += solid.uy * sign * overAlong;
      }
    }
    if (!moved) break;
  }
  return { x, y };
}

/**
 * Шаг с проверкой стен: сдвинулись, потом вытолкнулись.
 *
 * Шаг дробится на куски не длиннее радиуса тела — и это не предосторожность, а
 * необходимость. Выталкивание разбирает **перекрытие**, а не путь: прыгни
 * человек разом дальше, чем толщина перегородки плюс два радиуса, и он
 * окажется по ту сторону, ничего не задев. На бегу (4,8 м/с) кадр длиной в
 * десятую долю секунды — это 480 мм, а перегородка бывает в 50 мм: без дробления
 * сквозь неё проходили бы при любом подвисании вкладки.
 */
export function volumeStep(scene, at, dx, dy) {
  const solids = scene.solids || [];
  const length = Math.hypot(dx, dy);
  const parts = Math.max(1, Math.ceil(length / VOLUME_BODY_MM));
  let point = { x: at.x, y: at.y };
  for (let index = 0; index < parts; index += 1) {
    point = volumePush(solids, { x: point.x + dx / parts, y: point.y + dy / parts }, VOLUME_BODY_MM);
  }
  return point;
}

/**
 * Куда показали на полу: луч сквозь точку кадра до плоскости пола (G212,
 * «при клике курсором позволяй перемещать»).
 *
 * `null` — луч идёт вверх или вдоль пола и ни во что не упирается: с обзора,
 * который смотрит сверху всегда (`volumeAroundPitch`), такого не бывает, но
 * отвечать на это выдуманной точкой нельзя.
 *
 * Считается **плоскостью пола, а не гранями сцены**: указывают на место, а не
 * на поверхность, и нажатый кусок стены должен значить «туда, к этой стене», а
 * не «на её гребень». Куда человек встанет на самом деле, решает `volumeMoveTo`.
 */
export function volumeFloorAt(camera, box, x, y) {
  const basis = volumeBasis(camera);
  const focal = volumeFocal(box);
  const right = (x - box.width / 2) / focal;
  const up = (box.height / 2 - y) / focal;
  const direction = {
    x: basis.fwd.x + basis.right.x * right + basis.up.x * up,
    y: basis.fwd.y + basis.right.y * right + basis.up.y * up,
    z: basis.fwd.z + basis.right.z * right + basis.up.z * up,
  };
  if (!(direction.z < -1e-6) || !(camera.at.z > 0)) return null;
  const away = -camera.at.z / direction.z;
  return { x: camera.at.x + direction.x * away, y: camera.at.y + direction.y * away };
}

/**
 * Куда человек встанет, если показали сюда (G212).
 *
 * Правило одно на оба случая, и оно прямо от заказчика: **вплотную**. Показали
 * в стену — тело выталкивается из неё и встаёт у её грани (`volumePush`, тот же
 * счёт, что у ходьбы, — второго правила «где можно стоять» в сборке нет).
 *
 * Показали за пределы плана — точка сперва зажимается габаритом чертежа, и
 * зажимается **внутрь на радиус тела**. Это не запас на всякий случай: габарит
 * идёт по осевым линиям наружных стен, и зажатая ровно по нему точка попадает в
 * середину стены, где выталкивать её равно выгодно в обе стороны — человек
 * оказывался снаружи дома. Шаг внутрь даёт выталкиванию сторону, и выходит
 * обещанное: человек у внутренней грани наружной стены.
 */
export function volumeMoveTo(scene, at) {
  const bounds = scene && scene.boundsMm;
  const inside = (value, min, max) => {
    const from = min + VOLUME_BODY_MM;
    const to = max - VOLUME_BODY_MM;
    if (!(to > from)) return (min + max) / 2;
    return Math.max(from, Math.min(to, value));
  };
  const point = bounds
    ? { x: inside(at.x, bounds.minX, bounds.maxX), y: inside(at.y, bounds.minY, bounds.maxY) }
    : { x: at.x, y: at.y };
  return volumePush((scene && scene.solids) || [], point, VOLUME_BODY_MM);
}

/**
 * В каком помещении стоит человек — по контурам сцены, а не по `roomAtPoint`:
 * контуры здесь уже переведены в миллиметры, и спрашивается это на каждом
 * шаге. Окно называет комнату вслух — заказчик про обзор сказал «без него не
 * понять, где стоишь», и имя комнаты отвечает на то же самое словом.
 */
export function volumeRoomAt(scene, at) {
  for (const room of scene.rooms || []) {
    if (volumePointInside(at, room.pointsMm)) return room;
  }
  return null;
}

// ——— камера ——————————————————————————————————————————————————————————————

/**
 * Оси камеры по рысканью и наклону. Плановые оси — те же, что у чертежа: `x`
 * вправо, `y` вниз; `z` растёт вверх от пола. Рысканье считается от оси `x` по
 * часовой на плане, наклон — вверх положительный.
 */
export function volumeBasis(camera) {
  const yaw = camera.yaw || 0;
  const pitch = camera.pitch || 0;
  const cosYaw = Math.cos(yaw);
  const sinYaw = Math.sin(yaw);
  const cosPitch = Math.cos(pitch);
  const sinPitch = Math.sin(pitch);
  return {
    fwd: { x: cosYaw * cosPitch, y: sinYaw * cosPitch, z: sinPitch },
    right: { x: -sinYaw, y: cosYaw, z: 0 },
    up: { x: -sinPitch * cosYaw, y: -sinPitch * sinYaw, z: cosPitch },
  };
}

/** Фокус в экранных точках: поле зрения меряется по длинной стороне окна. */
export function volumeFocal(box) {
  const side = Math.max(box.width, box.height);
  return (side / 2) / Math.tan(((VOLUME_FOV_DEG / 2) * Math.PI) / 180);
}

/**
 * Экранная строка горизонта: куда уходит всё, что лежит на уровне глаз.
 * Зависит только от наклона — и поэтому задник, привязанный к ней, рысканья не
 * знает и в перспективе не участвует.
 */
export function volumeHorizon(camera, box) {
  return box.height / 2 + volumeFocal(box) * Math.tan(camera.pitch || 0);
}

function volumeToCamera(point, eye, basis) {
  const dx = point.x - eye.x;
  const dy = point.y - eye.y;
  const dz = point.z - eye.z;
  return {
    x: dx * basis.right.x + dy * basis.right.y + dz * basis.right.z,
    y: dx * basis.up.x + dy * basis.up.y + dz * basis.up.z,
    z: dx * basis.fwd.x + dy * basis.fwd.y + dz * basis.fwd.z,
  };
}

/**
 * Отсечение многоугольника ближней плоскостью. Без него грань, пересекающая
 * плоскость камеры, выворачивается наизнанку через бесконечность — и это не
 * мелкая погрешность, а клякса на весь кадр.
 */
export function volumeClipNear(points, near = VOLUME_NEAR_MM) {
  return volumeClipDepth(points, near, Infinity);
}

/**
 * Отсечение многоугольника слоем глубины `[near, far]` — тем же обходом рёбер,
 * что ближней плоскостью, только с двумя сторонами. Общий случай; кадру нужен
 * его частный — `volumeClipNear`.
 */
export function volumeClipDepth(points, near = VOLUME_NEAR_MM, far = Infinity) {
  const side = (list, keep, cut) => {
    const out = [];
    for (let index = 0; index < list.length; index += 1) {
      const a = list[index];
      const b = list[(index + 1) % list.length];
      const aIn = keep(a);
      const bIn = keep(b);
      if (aIn) out.push(a);
      if (aIn !== bIn) out.push(cut(a, b));
    }
    return out;
  };
  let poly = side(
    points,
    (point) => point.z >= near,
    (a, b) => {
      const t = (near - a.z) / (b.z - a.z);
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: near };
    },
  );
  if (!(far < Infinity) || poly.length < 3) return poly;
  poly = side(
    poly,
    (point) => point.z <= far,
    (a, b) => {
      const t = (far - a.z) / (b.z - a.z);
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: far };
    },
  );
  return poly.length < 3 ? [] : poly;
}

// ——— порядок граней: дерево разбиения (D32, D33) ——————————————————————————
//
// Порядок рисования — не сортировка, а **дерево**, построенное один раз на
// сцену (`volumeOrderTree`) и обойдённое на каждый кадр (`volumeOrderWalk`).
//
// ——— почему не сортировка ————————————————————————————————————————————————
//
// «Художник» сравнивает грани одним числом — дальностью середины, — а
// перекрытие в кадре решает дальность **в пикселе**. У грани, уходящей от
// камеры вдаль, это разные числа, и спор она проигрывает целиком: стена в
// четыре метра серединой оказывается ближе вещи, стоящей у её края (D32,
// «иногда бывает что стены просвечивают»).
//
// Таск 150 лечил это **ломтями**: грань резалась плоскостями равной дальности
// `z = k · 250 мм`, и каждый кусок ехал со своей серединой. Провалы глубже
// полуметра это убрало, но завело свою семью дефектов (D33, слова заказчика:
// «на границах и углах появились треугольные артефакты»):
//
//   — ошибка порядка не исчезла, а измельчала: внутри одного ломтя соседние
//     куски по-прежнему спорят, и спор этот теперь виден **на каждом кадре** —
//     ровной чередой клиньев с шагом ломтя вдоль кромки;
//   — у разрезанной грани появились швы: канва сглаживает края, и два куска
//     общего ребра не складываются в непрозрачный пиксель.
//
// Ни то ни другое мельче шага не чинится: это та же шкала, а не выход.
//
// ——— что вместо ————————————————————————————————————————————————————————
//
// Дерево двоичного разбиения пространства. В узле — плоскость одной из граней;
// всё, что перед ней, в одном поддереве, всё, что за ней, в другом, грани в
// самой плоскости — в узле. Грань, которую плоскость пересекает, режется по ней
// надвое — **по настоящей геометрии, а не по сетке**.
//
// Свойство, ради которого всё затевалось: луч из глаза пересекает плоскость
// узла не больше одного раза, значит **всё, что лежит на стороне глаза, стоит
// на луче раньше** всего, что лежит за плоскостью. Обход «дальнее поддерево,
// потом плоскость, потом ближнее» даёт порядок, верный в каждом пикселе и на
// любом ракурсе — не «ошибка не больше шага», а ошибки нет вовсе.
//
// Цена названа и замерена в отчёте таска: дерево строится при сборке сцены
// (там же, где считаются грани, — на объекте заказчика это единицы
// миллисекунд), резов выходит на порядок меньше, чем давали ломти, а кадр
// вместо сортировки `n log n` получает обход `n` без единого сравнения.
//
// Ярусы (`VOLUME_LAYER_*`) дерево не отменяет: в нём лежит только ярус тел.
// Плита, полы с потолками и указатель «вы здесь» ложатся до и после него по
// прежнему правилу — там спорить не о чем (см. `VOLUME_LAYER_BASE`).

/** Плоскость грани: нормаль и расстояние до начала координат. */
function volumePlaneOf(face) {
  return {
    x: face.n.x,
    y: face.n.y,
    z: face.n.z,
    d: face.n.x * face.p[0].x + face.n.y * face.p[0].y + face.n.z * face.p[0].z,
  };
}

/** С какой стороны плоскости точка: 1 перед, −1 за, 0 — на ней. */
function volumePointSide(plane, point, eps = VOLUME_PLANE_EPS_MM) {
  const gap = plane.x * point.x + plane.y * point.y + plane.z * point.z - plane.d;
  return gap > eps ? 1 : gap < -eps ? -1 : 0;
}

/**
 * С какой стороны плоскости грань: `1` перед, `−1` за, `0` в самой плоскости,
 * `2` — пересекает, то есть её придётся резать.
 */
export function volumeFaceSide(plane, face) {
  let front = 0;
  let back = 0;
  for (const point of face.p) {
    const side = volumePointSide(plane, point);
    if (side > 0) front += 1;
    else if (side < 0) back += 1;
  }
  if (front > 0 && back > 0) return 2;
  if (front > 0) return 1;
  if (back > 0) return -1;
  return 0;
}

/**
 * Разрез грани плоскостью. Возвращает `{front, back}` — две грани со всеми
 * полями исходной (цвет, ярус, хозяин, полотно) и своими точками.
 *
 * Грань выпуклая или нет — обход один и тот же: вершины раскладываются по
 * сторонам, точка пересечения ребра попадает в обе половины.
 */
export function volumeSplitFace(face, plane) {
  const side = volumeFaceSide(plane, face);
  if (side === 1 || side === 0) return { front: face, back: null };
  if (side === -1) return { front: null, back: face };
  const front = [];
  const back = [];
  const points = face.p;
  for (let index = 0; index < points.length; index += 1) {
    const a = points[index];
    const b = points[(index + 1) % points.length];
    const sa = volumePointSide(plane, a);
    const sb = volumePointSide(plane, b);
    if (sa >= 0) front.push(a);
    if (sa <= 0) back.push(a);
    if (sa * sb < 0) {
      const da = plane.x * a.x + plane.y * a.y + plane.z * a.z - plane.d;
      const db = plane.x * b.x + plane.y * b.y + plane.z * b.z - plane.d;
      const t = da / (da - db);
      const cut = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
      front.push(cut);
      back.push(cut);
    }
  }
  return {
    front: front.length >= 3 ? { ...face, p: front } : null,
    back: back.length >= 3 ? { ...face, p: back } : null,
  };
}

/**
 * Дерево порядка по граням яруса тел. `null` — делить нечего.
 *
 * Строится один раз на сцену и живёт в ней (`scene.order`): сцена пересобирается
 * при правке объекта и при открытии двери, и дерево вместе с ней.
 */
export function volumeOrderTree(faces) {
  const items = [];
  for (const face of faces || []) {
    if (!face || face.line) continue;
    if (face.layer !== undefined && face.layer !== VOLUME_LAYER_BODY) continue;
    items.push(face);
  }
  return volumeOrderNode(items);
}

/**
 * Узел дерева. Плоскость выбирается примеркой: меньше резов, ровнее половины.
 * Грань-кандидат всегда лежит в своей же плоскости, поэтому узел забирает хотя
 * бы одну грань — построение не зацикливается.
 */
function volumeOrderNode(items) {
  if (items.length === 0) return null;
  let best = null;
  const tries = Math.min(items.length, VOLUME_ORDER_TRIES);
  for (let at = 0; at < tries; at += 1) {
    const plane = volumePlaneOf(items[Math.floor((at * items.length) / tries)]);
    let front = 0;
    let back = 0;
    let splits = 0;
    for (const item of items) {
      const side = volumeFaceSide(plane, item);
      if (side === 2) splits += 1;
      else if (side === 1) front += 1;
      else if (side === -1) back += 1;
    }
    if (front === 0 && back === 0 && splits === 0) continue;
    const score = splits * VOLUME_ORDER_SPLIT_COST + Math.abs(front - back);
    if (!best || score < best.score) best = { plane, score };
  }
  // Все грани в одной плоскости: делить нечем, и незачем — коплоскостные грани
  // друг друга не закрывают.
  if (!best) return { plane: volumePlaneOf(items[0]), same: items, front: null, back: null, count: items.length };
  const plane = best.plane;
  const same = [];
  const front = [];
  const back = [];
  for (const item of items) {
    const side = volumeFaceSide(plane, item);
    if (side === 0) {
      same.push(item);
      continue;
    }
    if (side === 1) {
      front.push(item);
      continue;
    }
    if (side === -1) {
      back.push(item);
      continue;
    }
    const cut = volumeSplitFace(item, plane);
    if (cut.front) front.push(cut.front);
    if (cut.back) back.push(cut.back);
  }
  const node = { plane, same, front: volumeOrderNode(front), back: volumeOrderNode(back), count: 0 };
  node.count = same.length + (node.front ? node.front.count : 0) + (node.back ? node.back.count : 0);
  return node;
}

/**
 * Обход дерева от дальнего к ближнему: дальнее поддерево, своя плоскость,
 * ближнее поддерево. Возвращает грани в порядке рисования.
 */
export function volumeOrderWalk(tree, eye, out = []) {
  if (!tree) return out;
  const near = volumePointSide(tree.plane, eye) >= 0;
  volumeOrderWalk(near ? tree.back : tree.front, eye, out);
  for (const face of tree.same) out.push(face);
  volumeOrderWalk(near ? tree.front : tree.back, eye, out);
  return out;
}

/**
 * Сколько граней обход нарисует **раньше** этой точки. Ею встают в очередь те,
 * кого в дереве нет: линии (контур вещи, стрелка связи) — рисунок поверх сцены,
 * резать их по плоскостям нельзя (у ломаной есть концы, а у пунктира — шаг), и
 * место в очереди им считается по середине.
 */
export function volumeOrderRank(tree, eye, point) {
  let node = tree;
  let rank = 0;
  while (node) {
    const near = volumePointSide(node.plane, eye) >= 0;
    const first = near ? node.back : node.front;
    const second = near ? node.front : node.back;
    const side = volumePointSide(node.plane, point);
    const inFirst = near ? side < 0 : side > 0;
    if (inFirst) {
      node = first;
      continue;
    }
    rank += (first ? first.count : 0) + node.same.length;
    node = second;
  }
  return rank;
}

/** Грань яруса тел — та, что лежит в дереве порядка. */
function volumeInTree(face) {
  return !face.line && (face.layer === undefined || face.layer === VOLUME_LAYER_BODY);
}

/** Середина грани или линии: ею считается место в очереди у тех, кого нет в дереве. */
function volumeMiddleOf(points) {
  let x = 0;
  let y = 0;
  let z = 0;
  for (const point of points) {
    x += point.x;
    y += point.y;
    z += point.z;
  }
  return { x: x / points.length, y: y / points.length, z: z / points.length };
}

/**
 * Кадр: грани сцены, переведённые в экранные многоугольники и выложенные в
 * порядке рисования.
 *
 * Ярус тел выкладывает **дерево порядка** (`volumeOrderTree`) — точно, в каждом
 * пикселе и на любом ракурсе. Плита, полы с потолками и указатель «вы здесь»
 * лежат вне дерева, своими ярусами и по дальности: под полом ничего нет, а
 * потолок, видимый снизу, не закрывает ничего, кроме себя, — спорить им не о
 * чем. Будь они в общем потоке, пол комнаты, в которой стоишь, оказался бы
 * ближе дальней стены и закрасил бы её низ.
 *
 * Линии (контур вещи, стрелка связи) в дереве не лежат — их встраивают в
 * очередь по середине (`volumeOrderRank`), а контур вещи ставит на место своим
 * правилом `volumeOutlineOrder`.
 *
 * Невидимые грани отбрасываются по направлению нормали; двусторонние (полотно
 * двери, рама окна) нормаль поворачивают навстречу.
 */
export function volumeFrame(scene, camera, box, extra = null) {
  const basis = volumeBasis(camera);
  const focal = volumeFocal(box);
  const halfWidth = box.width / 2;
  const halfHeight = box.height / 2;
  const polygons = [];
  // У собранной сцены дерево уже есть; у наскоро составленной (стенд, тест) его
  // строят на месте — кадр обязан быть верным и там.
  const tree = scene.order === undefined ? volumeOrderTree(scene.faces) : scene.order;
  const take = (face, order) =>
    volumeFacePolygons(face, camera, basis, focal, halfWidth, halfHeight, box, polygons, order);
  // Половина — чтобы линия встала **между** гранями, а не спорила с одной из них.
  const rankOf = (face) => volumeOrderRank(tree, camera.at, volumeMiddleOf(face.p)) - 0.5;
  let rank = 0;
  for (const face of volumeOrderWalk(tree, camera.at)) {
    take(face, rank);
    rank += 1;
  }
  for (const face of scene.faces) {
    if (volumeInTree(face)) continue;
    take(face, face.layer === VOLUME_LAYER_BODY ? rankOf(face) : null);
  }
  for (const face of extra || []) {
    take(face, face.layer === VOLUME_LAYER_BODY || face.layer === undefined ? rankOf(face) : null);
  }
  polygons.sort((a, b) => (a.layer === b.layer ? a.order - b.order : a.layer - b.layer));
  return volumeOutlineOrder(polygons);
}

// Вещь на стене рисуется после неё сама: она **и правда** стоит перед
// плоскостью стены — на два миллиметра (`VOLUME_MARK_LIFT_MM`), — а дерево
// порядка смотрит на плоскости, а не на дальность середин. Поэтому
// перестановки «вещь за своим куском стены», которой жили таски 148–150
// (`volumeHostOrder`, метровая сетка стороны стены), здесь больше нет: с точным
// порядком она не помогала, а мешала — вещь вставала перед **чужими** стенами,
// и розетки соседней комнаты просвечивали сквозь перегородку. Замер: 0,028 %
// точек кадра с провалом до шести метров против нуля без неё.

/**
 * Перестановка очереди: `waiting` — карта «за каким многоугольником встать» →
 * список тех, кто встаёт за ним. Всё остальное сохраняет свой порядок.
 *
 * Нужна она контуру вещи (`volumeOutlineOrder`): контур обязан ехать сразу за
 * своим телом, и это правило, а не дальность.
 */
function volumeReorder(polygons, waiting) {
  const moved = new Set();
  for (const list of waiting.values()) for (const index of list) moved.add(index);
  const out = [];
  for (let index = 0; index < polygons.length; index += 1) {
    if (!moved.has(index)) out.push(polygons[index]);
    const list = waiting.get(index);
    if (list) for (const at of list) out.push(polygons[at]);
  }
  return out;
}

/**
 * Контур вещи рисуется **сразу после её тела**, и это правило, а не дальность.
 *
 * Контур поднят над лицом вещи на миллиметр (`VOLUME_VIEW_LIFT_MM`) — то есть
 * лежит в плоскости, параллельной лицу. Сортировка по средней дальности на
 * таком зазоре ничего не решает: у решётки бризера свои точки стоят не там, где
 * середина его плашки, и при взгляде вкось средняя дальность контура бывает
 * больше средней дальности тела. Тогда тело закрашивает собственный контур — тот
 * самый дефект живого прогона таска 148, у которого от решётки оставался один
 * индикатор. Миллиметровым зазором он лечится только случайно, поэтому порядок
 * здесь назван прямо.
 */
function volumeOutlineOrder(polygons) {
  let bodies = null;
  for (let index = 0; index < polygons.length; index += 1) {
    const polygon = polygons[index];
    if (polygon.stroke || !polygon.pick) continue;
    if (!bodies) bodies = new Map();
    bodies.set(polygon.pick, index);
  }
  if (!bodies) return polygons;
  const waiting = new Map();
  let deferred = false;
  for (let index = 0; index < polygons.length; index += 1) {
    const polygon = polygons[index];
    if (!polygon.stroke || !polygon.pick) continue;
    const at = bodies.get(polygon.pick);
    if (at === undefined || at <= index) continue;
    let list = waiting.get(at);
    if (!list) waiting.set(at, (list = []));
    list.push(index);
    deferred = true;
  }
  return deferred ? volumeReorder(polygons, waiting) : polygons;
}

/**
 * Одна грань в экранный многоугольник. Пусто — её не видно: отвёрнута, целиком
 * за ближней плоскостью или целиком за краем окна.
 *
 * Многоугольник ровно один: грань в кадре больше не режется ничем. Резы, если
 * они нужны, сделаны один раз при сборке дерева порядка — по настоящим
 * плоскостям сцены, а не по сетке дальностей (см. `volumeOrderTree`). Шва от
 * них тем меньше, чем меньше резов, и это то же самое число.
 *
 * `order` — место в очереди: ранг из дерева у яруса тел, `null` у всех
 * остальных, и тогда порядок внутри яруса решает дальность, как прежде.
 */
function volumeFacePolygons(face, camera, basis, focal, halfWidth, halfHeight, box, out, order = null) {
  if (face.line) {
    const line = volumeLinePolygon(face, camera, basis, focal, halfWidth, halfHeight, box);
    if (line) {
      line.order = order === null ? -line.depth : order;
      out.push(line);
    }
    return out;
  }
  const first = face.p[0];
  const vx = camera.at.x - first.x;
  const vy = camera.at.y - first.y;
  const vz = camera.at.z - first.z;
  let normal = face.n;
  let facing = normal.x * vx + normal.y * vy + normal.z * vz;
  if (face.both && facing < 0) {
    normal = { x: -normal.x, y: -normal.y, z: -normal.z };
    facing = -facing;
  }
  if (facing <= 0) return out;
  const clipped = volumeClipNear(face.p.map((point) => volumeToCamera(point, camera.at, basis)));
  if (clipped.length < 3) return out;
  const xy = [];
  let depth = 0;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const point of clipped) {
    const scale = focal / point.z;
    const x = halfWidth + point.x * scale;
    const y = halfHeight - point.y * scale;
    xy.push(x, y);
    depth += point.z;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  if (maxX < 0 || minX > box.width || maxY < 0 || minY > box.height) return out;
  const middle = depth / clipped.length;
  out.push({
    xy,
    depth: middle,
    order: order === null ? -middle : order,
    layer: face.layer,
    fill: volumeFill(face.rgb, volumeShade(normal)),
    pick: face.markId || null,
    door: face.doorId || null,
  });
  return out;
}

/**
 * Линия сцены в экранную ломаную (таск 148).
 *
 * Отличий от грани два. Первое: светлоты у линии нет — контур изображения и
 * стрелка связи рисуются своим цветом, а не поверхностью, повёрнутой к свету.
 * Второе: **за ближнюю плоскость линия не режется, а выбрасывается целиком.**
 * Резать её пришлось бы иначе, чем кольцо грани (у ломаной есть концы, и
 * замкнуть её по кругу значило бы дорисовать отрезок, которого нет), а цена
 * отказа нулевая: контур вещи длиной в полметра оказывается наполовину за
 * спиной только тогда, когда человек уткнулся в него носом.
 */
function volumeLinePolygon(line, camera, basis, focal, halfWidth, halfHeight, box) {
  if (line.n) {
    const first = line.p[0];
    const facing =
      line.n.x * (camera.at.x - first.x) + line.n.y * (camera.at.y - first.y) + line.n.z * (camera.at.z - first.z);
    if (facing <= 0) return null;
  }
  const xy = [];
  let depth = 0;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const point of line.p) {
    const at = volumeToCamera(point, camera.at, basis);
    if (at.z < VOLUME_NEAR_MM) return null;
    const scale = focal / at.z;
    const x = halfWidth + at.x * scale;
    const y = halfHeight - at.y * scale;
    xy.push(x, y);
    depth += at.z;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  if (xy.length < 4) return null;
  if (maxX < 0 || minX > box.width || maxY < 0 || minY > box.height) return null;
  return {
    xy,
    depth: depth / line.p.length,
    layer: line.layer,
    stroke: line.color,
    width: line.width,
    closed: line.closed,
    dash: line.dash,
    arrow: line.arrow,
    pick: line.markId || null,
  };
}

/** Стрелка связи в экранных точках: размер у неё постоянный, как у плана. */
const VOLUME_ARROW_PX = 9;
const VOLUME_ARROW_SPREAD = 0.42;

/**
 * Отрисовка кадра. Заливка и обводка тем же цветом: без обводки между
 * соседними гранями остаётся волосяная щель от сглаживания, и стена
 * расчерчивается белыми нитями.
 *
 * Линии (контур вещи, стрелка связи) обводятся своим цветом и своей толщиной и
 * не заливаются вовсе: это рисунок поверх сцены, а не её поверхность.
 */
export function volumeDraw(ctx, polygons) {
  ctx.lineJoin = "round";
  ctx.lineWidth = 1;
  for (const polygon of polygons) {
    const xy = polygon.xy;
    ctx.beginPath();
    ctx.moveTo(xy[0], xy[1]);
    for (let index = 2; index < xy.length; index += 2) ctx.lineTo(xy[index], xy[index + 1]);
    if (!polygon.stroke) {
      ctx.closePath();
      ctx.fillStyle = polygon.fill;
      ctx.strokeStyle = polygon.fill;
      ctx.fill();
      ctx.stroke();
      continue;
    }
    if (polygon.closed) ctx.closePath();
    ctx.save();
    ctx.lineWidth = polygon.width;
    ctx.strokeStyle = polygon.stroke;
    if (polygon.dash) ctx.setLineDash(polygon.dash);
    ctx.stroke();
    if (polygon.arrow) volumeDrawArrow(ctx, xy);
    ctx.restore();
  }
  return polygons.length;
}

// Наконечник стрелки — в экранных точках, по направлению последнего отрезка:
// в объёме он иначе то съёживался бы в точку, то вырастал в парус.
function volumeDrawArrow(ctx, xy) {
  const size = xy.length;
  if (size < 4) return;
  const tipX = xy[size - 2];
  const tipY = xy[size - 1];
  const dx = tipX - xy[size - 4];
  const dy = tipY - xy[size - 3];
  const length = Math.hypot(dx, dy);
  if (!(length > 0)) return;
  const ux = dx / length;
  const uy = dy / length;
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(tipX - ux * VOLUME_ARROW_PX - uy * VOLUME_ARROW_PX * VOLUME_ARROW_SPREAD, tipY - uy * VOLUME_ARROW_PX + ux * VOLUME_ARROW_PX * VOLUME_ARROW_SPREAD);
  ctx.lineTo(tipX, tipY);
  ctx.lineTo(tipX - ux * VOLUME_ARROW_PX + uy * VOLUME_ARROW_PX * VOLUME_ARROW_SPREAD, tipY - uy * VOLUME_ARROW_PX - ux * VOLUME_ARROW_PX * VOLUME_ARROW_SPREAD);
  ctx.stroke();
}

/** Насколько промахивается рука: розетка в трёх метрах — десяток точек экрана. */
export const VOLUME_PICK_SLACK_PX = 14;

/**
 * Во что попал клик (таск 148): обозначение метки или `null`.
 *
 * Ищется **по телам вещей и сверху вниз** — тем же порядком, которым кадр
 * рисовался, только с конца: что человек видит последним нарисованным, то и
 * под курсором. Контуры и связи в поиске не участвуют: по ним целиться нельзя,
 * а попадание в линию толщиной в точку было бы случайностью.
 *
 * Не попал точно — берётся ближайшая вещь в пределах промаха: розетка с трёх
 * метров занимает десяток точек, и требовать попадания в неё пикселем значило
 * бы сделать выделение недоступным ровно там, где оно нужнее всего.
 */
export function volumePickAt(polygons, x, y, slack = VOLUME_PICK_SLACK_PX) {
  let near = null;
  let gap = slack;
  for (let index = polygons.length - 1; index >= 0; index -= 1) {
    const polygon = polygons[index];
    if (!polygon.pick || polygon.stroke) continue;
    if (volumePolygonHit(polygon.xy, x, y)) return polygon.pick;
    const centre = volumePolygonCentre(polygon.xy);
    const distance = Math.hypot(centre.x - x, centre.y - y);
    if (distance < gap) {
      gap = distance;
      near = polygon.pick;
    }
  }
  return near;
}

/**
 * **Что видно в точке кадра** (G214): обозначение метки, если в этой точке
 * последней нарисована она, иначе `null` — стена, пол, полотно двери.
 *
 * Отличие от `volumePickAt` одно, и оно по существу. Клик — это рука, и ей
 * прощается промах: вещь, до которой десяток точек, считается задетой, а стена
 * перед ней руке не мешает. Прицел — это **взгляд**, и прощать ему нечего: он
 * показывает ровно одну точку кадра, и ответ на вопрос «на что ты смотришь»
 * может быть только один — то, что в этой точке видно. Спрятанную за стеной
 * вещь человек не видит, и выделять её по взгляду было бы обманом.
 *
 * Отвечать на это стало можно только с таском 151: порядок кадра точен в
 * каждом пикселе, и «нарисовано последним» наконец значит «видно».
 */
export function volumeSightAt(polygons, x, y) {
  for (let index = polygons.length - 1; index >= 0; index -= 1) {
    const polygon = polygons[index];
    if (polygon.stroke) continue;
    if (volumePolygonHit(polygon.xy, x, y)) return polygon.pick || null;
  }
  return null;
}

function volumePolygonHit(xy, x, y) {
  let inside = false;
  for (let i = 0, j = xy.length - 2; i < xy.length; j = i, i += 2) {
    const ax = xy[i];
    const ay = xy[i + 1];
    const bx = xy[j];
    const by = xy[j + 1];
    const crosses = ay > y !== by > y;
    if (crosses && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) inside = !inside;
  }
  return inside;
}

function volumePolygonCentre(xy) {
  let sumX = 0;
  let sumY = 0;
  for (let index = 0; index < xy.length; index += 2) {
    sumX += xy[index];
    sumY += xy[index + 1];
  }
  const count = xy.length / 2;
  return { x: sumX / count, y: sumY / count };
}

// ——— фон: панорама вокруг дома ———————————————————————————————————————————
//
// Слова заказчика (G208): «при повороте от 1 лица дом крутится, а фон нет, как
// будто сам дом вращается на местности — не хорошо. А так же в зависимости от
// вертикального наклона двигаются облака и солнце, они должны быть статичны.
// Ну и вращаться в след за поворотом, то есть как реальный фон. И нарисуй
// несколько деревьев и кустарников ближе».
//
// Таск 146 рисовал задник **в экранных точках**: одно и то же дерево на одном и
// том же месте кадра, что бы человек ни делал головой. Исполнитель назвал это
// ценой решения, заказчик цену не принял — и правильно: от такого фона дом и
// правда выглядит вертушкой на местности.
//
// ——— что здесь считается и почему это не вторая сцена —————————————————
//
// Фон — **бесконечно далёкая панорама**: у каждой вещи есть сторона света
// (`az`, та же мера, что рысканье камеры) и высота над горизонтом (`rise`), а
// места в метрах у неё нет вовсе. Точка панорамы попадает на экран **той же
// камерой, что и сцена** (`volumeBasis`, `volumeFocal`), только без переноса:
// направление не зависит от того, где стоит человек, — значит фон не
// приближается шагами и не съезжает от хождения, но поворачивается вслед за
// головой и наклоняется вслед за взглядом, как настоящий.
//
// Второй системы координат из этого не вышло: направление считается тремя
// скалярными произведениями на тот же базис, а числа фона — два угла на вещь.
// Ставить деревья **в саму сцену** далёкими плоскостями было бы дороже и
// неправдивее: плоскость за окном участвовала бы в сортировке граней, лезла бы
// в столкновения и в обзор сверху (где дом видно с крыши, а «задник» оказался
// бы лежащим на земле листом), а деревьев за каждым окном нужно было бы ровно
// столько, сколько окон. Панорама же одна на весь дом и не знает о нём ничего.
//
// ——— горизонт: формула та же, доказательство другое ————————————————————
//
// `volumeHorizon` считает строку горизонта одним числом из наклона и рысканья
// не знает. В таске 146 это было **упрощением**, теперь это **следствие**:
// направление с нулевой высотой над горизонтом даёт на экране
// `y = height / 2 + focal · tg(pitch)` при любой стороне света — то есть ровно
// ту же строку. Поэтому и небо спокойно при наклоне: оно не привязано к
// горизонту долями своей высоты (от этого солнце и ездило), а стоит на своих
// углах и едет вместе со всем кадром.

const VOLUME_SKY_TOP = "#8dbfe6";
const VOLUME_SKY_LOW = "#dceaf4";
const VOLUME_FIELD_FAR = "#9cba78";
const VOLUME_FIELD_NEAR = "#6b9450";
const VOLUME_SUN = "#fff3c4";
const VOLUME_SUN_HALO = "rgba(255, 243, 196, 0.35)";
const VOLUME_CLOUD = "#ffffff";
const VOLUME_TRUNK = "#6b5134";
const VOLUME_CROWN_FAR = "#6f8f5a";
const VOLUME_CROWN = "#4f7a3c";
const VOLUME_CROWN_DARK = "#3f6632";
const VOLUME_BUSH = "#5c8a41";

/** Ближе этого направление считается ушедшим за край: делить на нуль нельзя. */
const VOLUME_SKY_NEAR = 0.08;

/**
 * Солнце: сторона света и высота над горизонтом в градусах, угловой радиус —
 * тоже в градусах. Высота небольшая (14°): при взгляде прямо и поле зрения 90°
 * по длинной стороне окна на вертикаль остаётся около ±22°, и солнце, повешенное
 * высоко, не попадало бы в кадр вовсе.
 */
const VOLUME_SUN_AT = { az: 205, rise: 14, size: 2.1 };

/** Облака: сторона света, высота, угловой размер. */
const VOLUME_CLOUDS = [
  { az: 25, rise: 16, size: 7 },
  { az: 70, rise: 9, size: 5 },
  { az: 120, rise: 18, size: 8 },
  { az: 165, rise: 11, size: 5.5 },
  { az: 240, rise: 15, size: 6.5 },
  { az: 285, rise: 8, size: 4.5 },
  { az: 320, rise: 19, size: 7.5 },
];

/**
 * Деревья и кустарники. `rise` — высота **основания**: ноль значит «стоит на
 * горизонте», то есть далеко, отрицательное — ближе к дому, потому что земля у
 * ног уходит вниз. `size` — угловая высота вещи. Три вида (круглая крона, ель,
 * куст) и три дальности: ближние заказчик просил прямо, дальние держат горизонт
 * обжитым, когда смотришь между ближними.
 */
const VOLUME_TREES = [
  // дальний ряд по всему кругу
  { az: 10, rise: 0, size: 3.4, kind: "tree" },
  { az: 48, rise: 0, size: 2.6, kind: "spruce" },
  { az: 95, rise: 0, size: 3.8, kind: "tree" },
  { az: 140, rise: 0, size: 2.8, kind: "spruce" },
  { az: 185, rise: 0, size: 3.2, kind: "tree" },
  { az: 228, rise: 0, size: 2.4, kind: "tree" },
  { az: 262, rise: 0, size: 3.6, kind: "spruce" },
  { az: 305, rise: 0, size: 2.9, kind: "tree" },
  { az: 345, rise: 0, size: 3.1, kind: "spruce" },
  // средний ряд
  { az: 30, rise: -2.2, size: 9, kind: "spruce" },
  { az: 112, rise: -2.6, size: 10.5, kind: "tree" },
  { az: 200, rise: -2, size: 8.5, kind: "tree" },
  { az: 275, rise: -2.8, size: 11, kind: "spruce" },
  { az: 330, rise: -2.4, size: 9.5, kind: "tree" },
  // ближний ряд — то, о чём просил заказчик
  { az: 62, rise: -6.5, size: 19, kind: "tree" },
  { az: 155, rise: -7.5, size: 21, kind: "spruce" },
  { az: 248, rise: -6, size: 17.5, kind: "tree" },
  { az: 352, rise: -7, size: 20, kind: "tree" },
  // кустарники — ниже деревьев и ближе к земле
  { az: 44, rise: -9, size: 6.5, kind: "bush" },
  { az: 88, rise: -10.5, size: 7.5, kind: "bush" },
  { az: 133, rise: -8.5, size: 6, kind: "bush" },
  { az: 176, rise: -11, size: 8, kind: "bush" },
  { az: 219, rise: -9.5, size: 7, kind: "bush" },
  { az: 295, rise: -10, size: 7.5, kind: "bush" },
  { az: 315, rise: -8.8, size: 6.2, kind: "bush" },
];

const DEG = Math.PI / 180;

/**
 * Прицел панорамы: базис камеры, фокус и середина окна. Считается один раз на
 * кадр — все вещи фона смотрят через него.
 */
export function volumeSkyAim(camera, box) {
  return {
    basis: volumeBasis(camera),
    focal: volumeFocal(box),
    halfWidth: box.width / 2,
    halfHeight: box.height / 2,
  };
}

/**
 * Направление панорамы в точку экрана. `null` — направление за спиной.
 *
 * `scale` — сколько экранных точек даёт один радиан углового размера рядом с
 * этой точкой: им считаются размеры облака и дерева, и из него само собой
 * выходит, что у края широкого окна вещи крупнее, чем в середине, — так же, как
 * у граней сцены, и ровно потому, что камера одна и та же.
 */
export function volumeSkyPoint(aim, azimuthDeg, riseDeg) {
  const rise = riseDeg * DEG;
  const azimuth = azimuthDeg * DEG;
  const flat = Math.cos(rise);
  const direction = { x: flat * Math.cos(azimuth), y: flat * Math.sin(azimuth), z: Math.sin(rise) };
  const { basis, focal } = aim;
  const depth = direction.x * basis.fwd.x + direction.y * basis.fwd.y + direction.z * basis.fwd.z;
  if (!(depth > VOLUME_SKY_NEAR)) return null;
  const right = direction.x * basis.right.x + direction.y * basis.right.y + direction.z * basis.right.z;
  const up = direction.x * basis.up.x + direction.y * basis.up.y + direction.z * basis.up.z;
  const scale = focal / depth;
  return { x: aim.halfWidth + right * scale, y: aim.halfHeight - up * scale, scale };
}

/**
 * Фон кадра: небо с солнцем и облаками, поле и зелень по кругу.
 *
 * Рисуется до сцены и в её сортировке не участвует — ни одна точка фона не
 * знает, где стоит человек. Возвращается строка горизонта: по ней окно рисует
 * миникарту и подписи, и второго её счёта в сборке нет.
 */
export function volumeDrawBackdrop(ctx, box, camera) {
  const horizonY = volumeHorizon(camera, box);
  const line = Math.max(-box.height, Math.min(box.height * 2, horizonY));
  const sky = ctx.createLinearGradient(0, Math.min(0, line - box.height), 0, line);
  sky.addColorStop(0, VOLUME_SKY_TOP);
  sky.addColorStop(1, VOLUME_SKY_LOW);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, box.width, Math.max(0, line));
  if (line < box.height) {
    const field = ctx.createLinearGradient(0, line, 0, box.height);
    field.addColorStop(0, VOLUME_FIELD_FAR);
    field.addColorStop(1, VOLUME_FIELD_NEAR);
    ctx.fillStyle = field;
    ctx.fillRect(0, Math.max(0, line), box.width, box.height - Math.max(0, line));
  }
  const aim = volumeSkyAim(camera, box);
  volumeDrawSun(ctx, aim);
  for (const cloud of VOLUME_CLOUDS) volumeDrawCloud(ctx, aim, cloud);
  // Дальние раньше ближних: в этом порядке они и стоят в списке, и переставлять
  // их нечем — у фона нет дальности, есть только порядок рисования.
  for (const tree of VOLUME_TREES) volumeDrawTree(ctx, aim, tree);
  return line;
}

function volumeDrawSun(ctx, aim) {
  const at = volumeSkyPoint(aim, VOLUME_SUN_AT.az, VOLUME_SUN_AT.rise);
  if (!at) return;
  const radius = Math.max(4, VOLUME_SUN_AT.size * DEG * at.scale);
  ctx.fillStyle = VOLUME_SUN_HALO;
  ctx.beginPath();
  ctx.arc(at.x, at.y, radius * 2.1, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = VOLUME_SUN;
  ctx.beginPath();
  ctx.arc(at.x, at.y, radius, 0, Math.PI * 2);
  ctx.fill();
}

function volumeDrawCloud(ctx, aim, cloud) {
  const at = volumeSkyPoint(aim, cloud.az, cloud.rise);
  if (!at) return;
  const radius = Math.max(4, cloud.size * DEG * at.scale * 0.4);
  ctx.fillStyle = VOLUME_CLOUD;
  ctx.beginPath();
  ctx.arc(at.x - radius, at.y, radius * 0.72, 0, Math.PI * 2);
  ctx.arc(at.x, at.y - radius * 0.3, radius, 0, Math.PI * 2);
  ctx.arc(at.x + radius, at.y, radius * 0.66, 0, Math.PI * 2);
  ctx.fill();
}

// Дерево, ель и куст — тремя кистями по одному и тому же правилу: основание на
// своей высоте над горизонтом, высота угловая. Своей картинки у фона нет
// нарочно: это рисунок за окном, а не часть чертежа.
function volumeDrawTree(ctx, aim, tree) {
  const base = volumeSkyPoint(aim, tree.az, tree.rise);
  if (!base) return;
  const height = Math.max(6, tree.size * DEG * base.scale);
  const far = tree.rise === 0;
  if (tree.kind === "bush") {
    const radius = height * 0.5;
    ctx.fillStyle = VOLUME_BUSH;
    ctx.beginPath();
    ctx.arc(base.x - radius * 0.8, base.y - radius * 0.6, radius * 0.62, 0, Math.PI * 2);
    ctx.arc(base.x + radius * 0.75, base.y - radius * 0.5, radius * 0.56, 0, Math.PI * 2);
    ctx.arc(base.x, base.y - radius * 0.95, radius * 0.78, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  ctx.fillStyle = VOLUME_TRUNK;
  const trunk = Math.max(1, height * (tree.kind === "spruce" ? 0.05 : 0.08));
  const trunkTop = base.y - height * (tree.kind === "spruce" ? 0.2 : 0.45);
  ctx.fillRect(base.x - trunk / 2, trunkTop, trunk, base.y - trunkTop);
  if (tree.kind === "spruce") {
    ctx.fillStyle = far ? VOLUME_CROWN_FAR : VOLUME_CROWN_DARK;
    const half = height * 0.27;
    for (const level of [0, 1, 2]) {
      const bottom = base.y - height * (0.18 + level * 0.26);
      const top = bottom - height * 0.42;
      const spread = half * (1 - level * 0.22);
      ctx.beginPath();
      ctx.moveTo(base.x - spread, bottom);
      ctx.lineTo(base.x + spread, bottom);
      ctx.lineTo(base.x, top);
      ctx.closePath();
      ctx.fill();
    }
    return;
  }
  ctx.fillStyle = far ? VOLUME_CROWN_FAR : VOLUME_CROWN;
  const radius = height * 0.34;
  ctx.beginPath();
  ctx.arc(base.x, base.y - height * 0.66, radius, 0, Math.PI * 2);
  ctx.arc(base.x - radius * 0.72, base.y - height * 0.47, radius * 0.66, 0, Math.PI * 2);
  ctx.arc(base.x + radius * 0.7, base.y - height * 0.5, radius * 0.6, 0, Math.PI * 2);
  ctx.fill();
}

// ——— обзор со стороны ————————————————————————————————————————————————————

/**
 * Камера обзора: отходим от цели на расстояние по рысканью и наклону.
 * Наклон отрицательный — смотрим сверху вниз.
 */
export function volumeAroundCamera(target, yaw, pitch, distance) {
  const basis = volumeBasis({ yaw, pitch });
  return {
    at: {
      x: target.x - basis.fwd.x * distance,
      y: target.y - basis.fwd.y * distance,
      z: target.z - basis.fwd.z * distance,
    },
    yaw,
    pitch,
  };
}

/**
 * Обзор, в котором видно всю схему: цель — середина чертежа, расстояние —
 * такое, чтобы габарит уместился в поле. Окно открывается именно им: заказчик
 * сказал, что показ начинается с общего вида.
 */
export function volumeAroundFit(scene, box) {
  const bounds = scene.boundsMm;
  const height = scene.heightMm || VOLUME_HEIGHT_FALLBACK_MM;
  if (!bounds) {
    return { target: { x: 0, y: 0, z: height / 2 }, distance: VOLUME_AROUND_NEAR_MM };
  }
  const target = {
    x: (bounds.minX + bounds.maxX) / 2,
    y: (bounds.minY + bounds.maxY) / 2,
    z: height / 2,
  };
  const radius = Math.hypot(bounds.widthMm, bounds.heightMm, height) / 2;
  const focal = volumeFocal(box);
  const fit = (radius * focal) / (0.42 * Math.min(box.width, box.height));
  return { target, distance: volumeAroundDistance(fit) };
}

export function volumeAroundDistance(value) {
  return Math.max(VOLUME_AROUND_MIN_MM, Math.min(VOLUME_AROUND_MAX_MM, value));
}

/**
 * Наклон обзора, при котором камера заведомо выше крыши (дефект живого
 * прогона).
 *
 * Обзор ходит вокруг цели, а цель стоит на полу среди стен. Подними взгляд к
 * горизонту — и камера, отойдя на семь метров, окажется **внутри** стены
 * соседней комнаты: кадр станет ровным серым полем, и человек решит, что
 * сборка сломалась. Сквозь стены при этом смотреть нельзя по той же причине,
 * по какой сквозь них нельзя ходить, — пропадёт смысл.
 *
 * Поэтому обзор смотрит сверху всегда: наклон ограничен так, чтобы подъём
 * камеры над целью был не меньше `liftMm` — высоты, на которой кончается
 * чертёж. Отошли дальше — можно смотреть положе; приблизились — вид сам
 * становится круче, вплоть до отвесного.
 */
export function volumeAroundPitch(pitch, distance, liftMm) {
  const limit = (VOLUME_PITCH_MAX_DEG * Math.PI) / 180;
  if (!(distance > 0) || !(liftMm > 0)) return Math.max(-limit, Math.min(limit, pitch));
  const ratio = Math.min(1, liftMm / distance);
  const steepest = -Math.min(limit, Math.asin(ratio));
  return Math.max(-limit, Math.min(steepest, pitch));
}

/**
 * Где стоит человек — кружок на полу и треугольник взгляда.
 *
 * Заказчик про обзор: «без него не понять, где стоишь». Значит обзор обязан
 * показать не только комнату, но и самого смотрящего — иначе он отвечает на
 * половину вопроса. Кружок лежит чуть выше пола и идёт **последним ярусом**,
 * поверх всего: ближняя стена под углом прячет за собой полосу пола метра в
 * три, и указатель, который она закрывает, бесполезен.
 *
 * Радиус — `VOLUME_MARKER_MM`, и он вдвое меньше прежнего (G212: «Позицию на
 * схеме на обзорном виде сделай меньше»). Кружок в 320 мм на обзоре квартиры
 * закрывал собой полметра пола — то есть ровно то место, куда человек
 * собирался перейти кликом.
 */
export function volumeMarkerFaces(at, yaw, out = [], radiusMm = VOLUME_MARKER_MM) {
  const radius = radiusMm;
  const lift = 15;
  const circle = [];
  const steps = 14;
  for (let index = 0; index < steps; index += 1) {
    const angle = (index / steps) * Math.PI * 2;
    circle.push({ x: at.x + Math.cos(angle) * radius, y: at.y + Math.sin(angle) * radius, z: lift });
  }
  out.push(volumeFace(volumeClockwise(circle).map((point) => ({ ...point, z: lift })), VOLUME_MARKER_RGB, {
    normal: { x: 0, y: 0, z: 1 },
    layer: VOLUME_LAYER_MARK,
  }));
  const tip = { x: at.x + Math.cos(yaw) * radius * 2.4, y: at.y + Math.sin(yaw) * radius * 2.4, z: lift };
  const left = {
    x: at.x + Math.cos(yaw + Math.PI / 2) * radius * 0.62,
    y: at.y + Math.sin(yaw + Math.PI / 2) * radius * 0.62,
    z: lift,
  };
  const right = {
    x: at.x + Math.cos(yaw - Math.PI / 2) * radius * 0.62,
    y: at.y + Math.sin(yaw - Math.PI / 2) * radius * 0.62,
    z: lift,
  };
  out.push(volumeFace(volumeClockwise([tip, left, right]).map((point) => ({ ...point, z: lift })), VOLUME_MARKER_RGB, {
    normal: { x: 0, y: 0, z: 1 },
    layer: VOLUME_LAYER_MARK,
  }));
  return out;
}
