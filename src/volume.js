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
  openingsInWall,
  outlinesInOrder,
  planFractionToMm,
  roomAtPoint,
  planMmToFraction,
  schemeObjectCorners,
  schemeObjectsOnScheme,
  wallHeightOf,
  wallHeightOnSide,
  wallVectors,
  wallsOnScheme,
} from "./model.js";

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
export const VOLUME_FRAME_RGB = [240, 242, 244];
export const VOLUME_MARKER_RGB = [31, 111, 235];

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
function volumePrismFaces(corners, bottomMm, topMm, rgb, out) {
  if (corners.length < 3 || !(topMm > bottomMm)) return out;
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
      }),
    );
  }
  out.push(
    volumeFace(
      corners.map((point) => volumeAt(point, topMm)),
      rgb,
      { normal: { x: 0, y: 0, z: 1 } },
    ),
  );
  if (bottomMm > 0) {
    out.push(
      volumeFace(
        corners.map((point) => volumeAt(point, bottomMm)),
        rgb,
        { normal: { x: 0, y: 0, z: -1 } },
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
 * Низ стены не рисуется: он под полом. Полотно двери стоит **раскрытым**, как
 * его рисуют на плане (`render.drawingDoorLeaf`): закрытое перекрыло бы вид в
 * соседнюю комнату, которого заказчик просил прямо («Давай всю схему»).
 */
export function volumeWallFaces(wall, openings, heightMm, out = []) {
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
    volumeOpeningFaces(wall, opening, heightMm, out);
  }
  return out;
}

/** Откосы проёма, рама окна и раскрытое полотно двери. */
function volumeOpeningFaces(wall, opening, heightMm, out) {
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
  if (opening.kind === OPENING_KIND_DOOR) volumeDoorLeaf(wall, opening, { from, to, bottom, top }, out);
  return out;
}

/** Толщина брусков рамы окна. */
const VOLUME_FRAME_MM = 60;

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

// Полотно — одна двусторонняя грань от петли наружу, на четверть оборота: так
// дверь рисуют на плане, так видно, какой кусок пола она занимает. Держать
// человека она не должна (слова заказчика: «Проходим сквозь нарисованные
// двери»), и в список препятствий не попадает — см. `volumeWallSolids`.
function volumeDoorLeaf(wall, opening, span, out) {
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
  const tip = { x: hinge.x + n.x * side * width, y: hinge.y + n.y * side * width };
  out.push(
    volumeFace(
      [volumeAt(hinge, span.bottom), volumeAt(tip, span.bottom), volumeAt(tip, span.top), volumeAt(hinge, span.top)],
      VOLUME_DOOR_RGB,
      { both: true },
    ),
  );
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

// Обход приводится к часовому на экране: у пола нормаль обязана смотреть
// вверх, и зависеть это от того, в какую сторону человек обводил комнату, не
// должно. Ось `y` смотрит вниз, поэтому «по часовой на экране» — это
// отрицательная знаковая площадь.
function volumeClockwise(corners) {
  let sum = 0;
  for (let i = 0, j = corners.length - 1; i < corners.length; j = i, i += 1) {
    sum += corners[j].x * corners[i].y - corners[i].x * corners[j].y;
  }
  return sum <= 0 ? corners : [...corners].reverse();
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

// ——— сцена ———————————————————————————————————————————————————————————————

/**
 * Вся сцена схемы: грани, препятствия, помещения, границы, где встать.
 *
 * `empty` — объект без чертежа: окно открывается и говорит, что показывать
 * нечего. `notes` — коды того, о чём окно обязано сказать вслух: нет моста к
 * подложке, помещения не обведены, высота не задана.
 */
export function volumeScene(project, schemeId) {
  const scheme = findScheme(project, schemeId);
  if (!scheme) return null;
  const walls = wallsOnScheme(project, schemeId);
  const objects = schemeObjectsOnScheme(project, schemeId);
  const notes = [];
  if (walls.length === 0 && objects.length === 0) {
    return { empty: true, notes: [], faces: [], solids: [], rooms: [], boundsMm: null };
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
  for (const wall of walls) {
    const openings = openingsInWall(project, wall.id);
    const left = wallHeightOnSide(project, wall.id, "left");
    const right = wallHeightOnSide(project, wall.id, "right");
    const height = Math.max(left > 0 ? left : 0, right > 0 ? right : 0) || schemeHeight.mm;
    volumeWallFaces(wall, openings, height, faces);
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
  // `wallCount` — настоящее число стен чертежа, а не длина `solids`: препятствий
  // больше, потому что проём режет стену на куски, а вещи на полу тоже держат.
  // Окно говорит о чертеже, и путать эти два числа нельзя.
  return {
    empty: false,
    notes,
    faces,
    solids,
    rooms,
    boundsMm: bounds,
    heightMm: schemeHeight.mm,
    wallCount: walls.length,
    openingCount: walls.reduce((sum, wall) => sum + openingsInWall(project, wall.id).length, 0),
  };
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
  const out = [];
  for (let index = 0; index < points.length; index += 1) {
    const a = points[index];
    const b = points[(index + 1) % points.length];
    const aIn = a.z >= near;
    const bIn = b.z >= near;
    if (aIn) out.push(a);
    if (aIn !== bIn) {
      const t = (near - a.z) / (b.z - a.z);
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: near });
    }
  }
  return out;
}

/**
 * Кадр: грани сцены, переведённые в экранные многоугольники и выложенные в
 * порядке рисования.
 *
 * Порядок — сортировка по дальности, дальние первыми, и пол с потолком идут
 * **до** всего остального. Это не ускорение, а правило: под полом ничего нет,
 * а потолок, видимый снизу, не закрывает ничего, кроме себя, — значит они
 * ложатся первыми и спор «пол поверх далёкой стены» не возникает вовсе. Будь
 * они в общем потоке, пол комнаты, в которой стоишь, оказался бы ближе дальней
 * стены и закрасил бы её низ.
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
  const take = (face) => {
    const screen = volumeFacePolygon(face, camera, basis, focal, halfWidth, halfHeight, box);
    if (screen) polygons.push(screen);
  };
  for (const face of scene.faces) take(face);
  for (const face of extra || []) take(face);
  polygons.sort((a, b) => (a.layer === b.layer ? b.depth - a.depth : a.layer - b.layer));
  return polygons;
}

// Одна грань в экранный многоугольник — или `null`, если её не видно:
// отвёрнута, целиком за ближней плоскостью или целиком за краем окна.
function volumeFacePolygon(face, camera, basis, focal, halfWidth, halfHeight, box) {
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
  if (facing <= 0) return null;
  const clipped = volumeClipNear(face.p.map((point) => volumeToCamera(point, camera.at, basis)));
  if (clipped.length < 3) return null;
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
  if (maxX < 0 || minX > box.width || maxY < 0 || minY > box.height) return null;
  return {
    xy,
    depth: depth / clipped.length,
    layer: face.layer,
    fill: volumeFill(face.rgb, volumeShade(normal)),
  };
}

/**
 * Отрисовка кадра. Заливка и обводка тем же цветом: без обводки между
 * соседними гранями остаётся волосяная щель от сглаживания, и стена
 * расчерчивается белыми нитями.
 */
export function volumeDraw(ctx, polygons) {
  ctx.lineJoin = "round";
  ctx.lineWidth = 1;
  for (const polygon of polygons) {
    const xy = polygon.xy;
    ctx.beginPath();
    ctx.moveTo(xy[0], xy[1]);
    for (let index = 2; index < xy.length; index += 2) ctx.lineTo(xy[index], xy[index + 1]);
    ctx.closePath();
    ctx.fillStyle = polygon.fill;
    ctx.strokeStyle = polygon.fill;
    ctx.fill();
    ctx.stroke();
  }
  return polygons.length;
}

// ——— задник ——————————————————————————————————————————————————————————————
//
// Слова заказчика: «статичный фон с зелёным полем с небольшим количеством
// деревьев, небом, солнцем и облаками». Он рисуется **один раз за кадром и в
// перспективе не участвует** — это задник, а не сцена, и ни одна его точка не
// проходит через камеру.
//
// Единственное, за чем он следит, — строка горизонта (`volumeHorizon`): она
// считается одним числом из наклона и не знает рысканья. Без неё поле и небо
// стояли бы посреди окна, когда взгляд опущен в пол, и за краем пола виднелась
// бы трава выше настоящего горизонта. Это не перспектива, а одно смещение.

const VOLUME_SKY_TOP = "#8dbfe6";
const VOLUME_SKY_LOW = "#dceaf4";
const VOLUME_FIELD_FAR = "#9cba78";
const VOLUME_FIELD_NEAR = "#6b9450";
const VOLUME_SUN = "#fff3c4";
const VOLUME_CLOUD = "#ffffff";
const VOLUME_TRUNK = "#6b5134";
const VOLUME_CROWN = "#4f7a3c";

// Доли ширины окна и высоты неба. Числа постоянные: задник один и тот же в
// любом кадре, и двигаться ему незачем.
const VOLUME_CLOUDS = [
  { x: 0.14, lift: 0.62, size: 0.075 },
  { x: 0.37, lift: 0.78, size: 0.055 },
  { x: 0.62, lift: 0.58, size: 0.095 },
  { x: 0.86, lift: 0.8, size: 0.06 },
];
const VOLUME_TREES = [
  { x: 0.08, size: 0.055 },
  { x: 0.22, size: 0.035 },
  { x: 0.46, size: 0.045 },
  { x: 0.68, size: 0.03 },
  { x: 0.91, size: 0.05 },
];

export function volumeDrawBackdrop(ctx, box, horizonY) {
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
  const skyHeight = Math.max(1, Math.min(line, box.height));
  // Солнце и облака живут в небе, деревья стоят на горизонте.
  ctx.fillStyle = VOLUME_SUN;
  ctx.beginPath();
  ctx.arc(box.width * 0.79, line - skyHeight * 0.68, Math.max(8, box.width * 0.028), 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = VOLUME_CLOUD;
  for (const cloud of VOLUME_CLOUDS) {
    const radius = Math.max(6, box.width * cloud.size * 0.4);
    const top = line - skyHeight * cloud.lift;
    ctx.beginPath();
    ctx.arc(box.width * cloud.x - radius, top, radius * 0.72, 0, Math.PI * 2);
    ctx.arc(box.width * cloud.x, top - radius * 0.3, radius, 0, Math.PI * 2);
    ctx.arc(box.width * cloud.x + radius, top, radius * 0.66, 0, Math.PI * 2);
    ctx.fill();
  }
  for (const tree of VOLUME_TREES) {
    const height = Math.max(10, box.height * tree.size);
    const x = box.width * tree.x;
    ctx.fillStyle = VOLUME_TRUNK;
    ctx.fillRect(x - height * 0.07, line - height * 0.45, height * 0.14, height * 0.45);
    ctx.fillStyle = VOLUME_CROWN;
    ctx.beginPath();
    ctx.arc(x, line - height * 0.62, height * 0.38, 0, Math.PI * 2);
    ctx.fill();
  }
  return line;
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
 */
export function volumeMarkerFaces(at, yaw, out = []) {
  const radius = 320;
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
  const tip = { x: at.x + Math.cos(yaw) * radius * 2.1, y: at.y + Math.sin(yaw) * radius * 2.1, z: lift };
  const left = {
    x: at.x + Math.cos(yaw + Math.PI / 2) * radius * 0.55,
    y: at.y + Math.sin(yaw + Math.PI / 2) * radius * 0.55,
    z: lift,
  };
  const right = {
    x: at.x + Math.cos(yaw - Math.PI / 2) * radius * 0.55,
    y: at.y + Math.sin(yaw - Math.PI / 2) * radius * 0.55,
    z: lift,
  };
  out.push(volumeFace(volumeClockwise([tip, left, right]).map((point) => ({ ...point, z: lift })), VOLUME_MARKER_RGB, {
    normal: { x: 0, y: 0, z: 1 },
    layer: VOLUME_LAYER_MARK,
  }));
  return out;
}
