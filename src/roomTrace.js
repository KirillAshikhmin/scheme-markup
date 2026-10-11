// Помещение по чертежу: показал точку внутри комнаты — контур нашёлся сам.
//
// Требование G196 (таск 138). Слова заказчика: «тыкнул внутри комнаты и
// автоматически она определилась по чертежу… если комната уже разбита на
// помещение… автоматическое определение должно занимать только не занятую
// часть комнаты (например в случае совмещённых кухня-столовая… или если стены
// между комнатами нет, например комната переходит в коридор)».
//
// ——— почему заливка, а не планарный граф ————————————————————————————————
//
// Считать можно двумя способами, и разница не во вкусе, а в том, на чём каждый
// ломается.
//
// **Планарный граф** разбивает стены на рёбра по пересечениям и обходит грань
// по правилу левой руки. Он даёт точный ответ в миллиметрах — но только если
// грань есть. Стены у нас рисуют росчерком, цепочкой отрезков (таск 124), и
// половина чертежей живёт с разрывами: дверь нарисовали дырой в стене, а не
// проёмом; перегородку не довели до несущей; угол сошёлся не на миллиметр.
// Незамкнутая грань — это не «чуть хуже», это «ответа нет вовсе». Сверх того
// пункт «занятую часть не захватывать» в граф не укладывается: границы
// существующих контуров — не стены, их пришлось бы заводить вторым слоем рёбер
// и резать ими грани.
//
// **Растровая заливка** отвечает всегда. Стены и границы уже размеченных
// контуров ложатся в один буфер, и «не захватывать занятое» получается тем же
// проходом, бесплатно. Незамкнутость она не скрывает, а **показывает**:
// заливка уходит за рамку буфера, и это ровно тот ответ, который человеку надо
// сказать вслух.
//
// Главное же — заливка **не врёт в сторону протечки**. Стена кладётся в клетки
// с запасом (клетка занята, если её центр ближе `cell·√2/2` к отрезку), то есть
// занятых клеток заведомо не меньше, чем настоящих стен. Свободная клетка
// гарантированно вся вне стен, поэтому путь по свободным клеткам (по четырём
// сторонам, без диагоналей) — это настоящий путь в плоскости, не пересекающий
// ни одной стены. Значит «протекло» в ответе бывает только там, где и правда
// протекло: ложной протечки растр дать не может. Платим обратным — заливка
// бывает **меньше** комнаты: узкую щель между стенами она закрывает, а край
// заливки отстоит от грани стены на 4…24 мм при клетке 20 мм.
//
// Эти 4…24 мм и снимает последний шаг: отрезки обведённой лестницы **садятся
// на линии грани стены** и на рёбра соседних контуров (`snapSegments`). После
// этого ортогональная планировка — а она почти всегда ортогональная — даёт
// контур ровно по внутренней грани, миллиметр в миллиметр, а не «примерно».
//
// ——— числа ————————————————————————————————————————————————————————————
//
// Клетка 20 мм. План 20 × 15 м с запасом по 0,5 м — это 1050 × 800 = 840 000
// клеток, буфер `Uint8Array` на 840 КБ; разметка стен и заливка на таком плане
// занимают единицы миллисекунд. Потолок — `ROOM_TRACE_CELLS_MAX`; дом больше
// примерно 90 × 70 м не отвергается, а считается клеткой 40 мм (и дальше 80),
// то есть точность падает, но ответ остаётся.
//
// Чего заливка сознательно не делает: **проёмы не вырезает**. Дверь, окно,
// арка — для заливки глухая стена. Человек показывает комнату, а не связную
// область пола: вырежи проём — и заливка утекла бы в коридор через каждую
// дверь. Кухню-столовую через арку просят разделить ровно так же (пункт 5
// требования), и значит проём обязан держать.
import {
  OUTLINE_MIN_POINTS,
  outlinesInOrder,
  planFractionToMm,
  planMmToFraction,
  segmentDistanceMm,
  wallsOnScheme,
  wallVectors,
} from "./model.js";

/** Сторона клетки буфера, мм. */
export const ROOM_TRACE_CELL_MM = 20;

/** Потолок буфера в клетках: на большом доме клетка грубеет, а не падает. */
export const ROOM_TRACE_CELLS_MAX = 4000000;

/**
 * Запас вокруг чертежа, мм. Внешнее кольцо клеток — та самая рамка, по которой
 * узнаётся незамкнутая область: дошла заливка до неё — стены не сошлись.
 * Запас не меньше самой толстой стены, иначе рамка пришлась бы внутрь стены.
 */
export const ROOM_TRACE_MARGIN_MM = 500;

/** Меньше этого — не комната, а щель между стенами: 0,2 м². */
export const ROOM_TRACE_AREA_MIN_MM2 = 200000;

/**
 * Предел сверху — 200 м². Одной комнаты такого размера не бывает; такую
 * площадь даёт заливка, утёкшая через дверной проём, нарисованный разрывом в
 * стене. Отдать её контуром хуже, чем сказать «похоже, стены не сошлись».
 */
export const ROOM_TRACE_AREA_MAX_MM2 = 200000000;

/** Вершин в найденном контуре. Больше — это не комната, а бахрома растра. */
export const ROOM_TRACE_POINTS_MAX = 120;

// Насколько отрезок обводки может отстоять от линии, чтобы на неё сесть. Край
// заливки отходит от грани стены на 4…24 мм при клетке 20 — но после стягивания
// фаски вершина уезжает ещё, и на настоящем плане отрезок промахивался мимо
// своей грани на 32 мм при допуске 30. Две клетки (40 мм) его забирают, а
// соседнюю грань не захватывают: из двух линий берётся **ближняя**, поэтому
// даже у стены в 50 мм ближняя грань выигрывает у дальней.
const SNAP_TOLERANCE_CELLS = 2;

// Допуск по углу, синусом: 12°. Запас нужен косой стене — направление её
// стороны снято с лестницы растра, и на коротком отрезке оно врёт на градусы.
const SNAP_SINE = 0.21;

// Для разбора «сторона или фаска» допуск строже (2,5°): фаска стыка у
// настоящей планировки оказалась повёрнутой к стене на 10° и при 12° сходила за
// саму стену.
const SNAP_SINE_STRICT = 0.045;

// Короче полутора клеток отрезок на линию не садится: его направление — это
// направление ступеньки растра, а не стены.
const SNAP_MIN_CELLS = 1.5;

// Допуск «точки совпали» и «три точки на одной прямой», мм².
const SAME_POINT_MM = 1;

function ringBounds(points) {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
}

/** Площадь многоугольника в мм² (формула шнурков). Знак обхода не важен. */
export function ringAreaMm2(points) {
  const list = Array.isArray(points) ? points : [];
  if (list.length < 3) return 0;
  let sum = 0;
  for (let i = 0, j = list.length - 1; i < list.length; j = i, i += 1) {
    sum += (list[j].x + list[i].x) * (list[j].y - list[i].y);
  }
  return Math.abs(sum) / 2;
}

/** Точка внутри кольца — чётно-нечётное правило, как у `pointInOutline`. */
function pointInRing(point, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const a = ring[i];
    const b = ring[j];
    const crosses = a.y > point.y !== b.y > point.y;
    if (crosses && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function cellSizeFor(widthMm, heightMm) {
  let cell = ROOM_TRACE_CELL_MM;
  for (let step = 0; step < 24; step += 1) {
    const cols = Math.ceil(widthMm / cell) + 2;
    const rows = Math.ceil(heightMm / cell) + 2;
    if (cols * rows <= ROOM_TRACE_CELLS_MAX) return cell;
    cell *= 2;
  }
  return cell;
}

/**
 * Буфер под чертёж: клетки, начало, размер. Пустой список стен сюда не
 * приходит — его отбивает `roomTraceRegion`.
 */
function gridFor(walls) {
  const points = [];
  let thickest = 0;
  for (const wall of walls) {
    points.push(wall.aMm, wall.bMm);
    thickest = Math.max(thickest, Number(wall.thicknessMm) || 0);
  }
  const bounds = ringBounds(points);
  const margin = Math.max(ROOM_TRACE_MARGIN_MM, thickest);
  const widthMm = bounds.maxX - bounds.minX + margin * 2;
  const heightMm = bounds.maxY - bounds.minY + margin * 2;
  const cell = cellSizeFor(widthMm, heightMm);
  const cols = Math.max(3, Math.ceil(widthMm / cell));
  const rows = Math.max(3, Math.ceil(heightMm / cell));
  return {
    cell,
    cols,
    rows,
    x: bounds.minX - margin,
    y: bounds.minY - margin,
    bounds,
    margin,
  };
}

const CELL_FREE = 0;
const CELL_WALL = 1;
const CELL_TAKEN = 2;

function centerX(grid, i) {
  return grid.x + (i + 0.5) * grid.cell;
}

function centerY(grid, j) {
  return grid.y + (j + 0.5) * grid.cell;
}

function columnOf(grid, xMm) {
  return Math.floor((xMm - grid.x) / grid.cell);
}

function rowOf(grid, yMm) {
  return Math.floor((yMm - grid.y) / grid.cell);
}

// Отрезок толщиной `thickness` в клетки — с запасом на полдиагонали клетки.
// Запас и даёт то самое «занятых клеток не меньше, чем настоящих стен».
function markSegment(mask, grid, a, b, thicknessMm, value) {
  const reach = (grid.cell * Math.SQRT2) / 2;
  const radius = thicknessMm / 2 + reach;
  const fromI = Math.max(0, columnOf(grid, Math.min(a.x, b.x) - radius));
  const toI = Math.min(grid.cols - 1, columnOf(grid, Math.max(a.x, b.x) + radius));
  const fromJ = Math.max(0, rowOf(grid, Math.min(a.y, b.y) - radius));
  const toJ = Math.min(grid.rows - 1, rowOf(grid, Math.max(a.y, b.y) + radius));
  for (let j = fromJ; j <= toJ; j += 1) {
    const y = centerY(grid, j);
    for (let i = fromI; i <= toI; i += 1) {
      const index = j * grid.cols + i;
      if (mask[index] === CELL_WALL) continue;
      if (segmentDistanceMm({ x: centerX(grid, i), y }, a, b) <= radius) mask[index] = value;
    }
  }
}

// Внутренность кольца в клетки — построчно, тем же чётно-нечётным правилом,
// каким считается попадание в контур. Края кольца размечаются сверх того
// отрезками: занятая клетка на границе не даёт новому контуру налезть на
// соседний, а оставшийся зазор (не больше клетки) снимает посадка на линии.
function markRing(mask, grid, ring, value) {
  const bounds = ringBounds(ring);
  const fromJ = Math.max(0, rowOf(grid, bounds.minY));
  const toJ = Math.min(grid.rows - 1, rowOf(grid, bounds.maxY));
  for (let j = fromJ; j <= toJ; j += 1) {
    const y = centerY(grid, j);
    const crossings = [];
    for (let i = 0, k = ring.length - 1; i < ring.length; k = i, i += 1) {
      const a = ring[i];
      const b = ring[k];
      if (a.y > y === b.y > y) continue;
      crossings.push(((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x);
    }
    crossings.sort((one, two) => one - two);
    for (let pair = 0; pair + 1 < crossings.length; pair += 2) {
      const fromI = Math.max(0, columnOf(grid, crossings[pair]));
      const toI = Math.min(grid.cols - 1, columnOf(grid, crossings[pair + 1]));
      for (let i = fromI; i <= toI; i += 1) {
        const x = centerX(grid, i);
        if (x < crossings[pair] || x > crossings[pair + 1]) continue;
        const index = j * grid.cols + i;
        if (mask[index] === CELL_FREE) mask[index] = value;
      }
    }
  }
  for (let i = 0, k = ring.length - 1; i < ring.length; k = i, i += 1) {
    markSegment(mask, grid, ring[k], ring[i], 0, value);
  }
}

/**
 * Залить от клетки и отдать её клетки. `open: true` — заливка дошла до рамки
 * буфера, то есть область не замкнута.
 */
function floodFrom(mask, grid, seedIndex) {
  const seen = new Uint8Array(grid.cols * grid.rows);
  const queue = new Int32Array(grid.cols * grid.rows + 1);
  let head = 0;
  let tail = 0;
  queue[tail += 1] = seedIndex;
  seen[seedIndex] = 1;
  const cells = [];
  let open = false;
  while (head < tail) {
    const index = queue[head += 1];
    const i = index % grid.cols;
    const j = (index - i) / grid.cols;
    if (i === 0 || j === 0 || i === grid.cols - 1 || j === grid.rows - 1) {
      open = true;
      break;
    }
    cells.push(index);
    const around = [index - 1, index + 1, index - grid.cols, index + grid.cols];
    for (const next of around) {
      if (next < 0 || next >= mask.length) continue;
      if (seen[next] || mask[next] !== CELL_FREE) continue;
      seen[next] = 1;
      queue[tail += 1] = next;
    }
  }
  return { cells, open };
}

// ——— обход границы залитого —————————————————————————————————————————————
//
// Идём по стыкам клеток так, чтобы залитое всё время оставалось справа:
// «свободно слева, залито справа». На каждом узле сетки сперва пробуем поворот
// налево, потом прямо, потом направо — этот порядок и склеивает область в одно
// кольцо там, где две клетки сошлись уголком.

const TRACE_STEPS = [
  { dx: 1, dy: 0 }, // восток
  { dx: 0, dy: 1 }, // юг
  { dx: -1, dy: 0 }, // запад
  { dx: 0, dy: -1 }, // север
];

// Клетка слева и справа от направления `d` в узле (i, j). Оси экранные: y вниз.
const TRACE_SIDES = [
  { left: { di: 0, dj: -1 }, right: { di: 0, dj: 0 } }, // восток
  { left: { di: 0, dj: 0 }, right: { di: -1, dj: 0 } }, // юг
  { left: { di: -1, dj: 0 }, right: { di: -1, dj: -1 } }, // запад
  { left: { di: -1, dj: -1 }, right: { di: 0, dj: -1 } }, // север
];

function traceRing(filled, grid, startIndex) {
  const inside = (i, j) => i >= 0 && j >= 0 && i < grid.cols && j < grid.rows && filled[j * grid.cols + i] === 1;
  const startI = startIndex % grid.cols;
  const startJ = (startIndex - startI) / grid.cols;
  let i = startI;
  let j = startJ;
  let dir = 0;
  const path = [];
  const limit = grid.cols * grid.rows * 4 + 8;
  for (let step = 0; step < limit; step += 1) {
    path.push({ i, j });
    const move = TRACE_STEPS[dir];
    const nextI = i + move.dx;
    const nextJ = j + move.dy;
    const sides = TRACE_SIDES[dir];
    const leftFilled = inside(nextI + sides.left.di, nextJ + sides.left.dj);
    const rightFilled = inside(nextI + sides.right.di, nextJ + sides.right.dj);
    i = nextI;
    j = nextJ;
    if (leftFilled) dir = (dir + 3) % 4;
    else if (!rightFilled) dir = (dir + 1) % 4;
    if (i === startI && j === startJ && dir === 0) break;
  }
  return path.map((node) => ({ x: grid.x + node.i * grid.cell, y: grid.y + node.j * grid.cell }));
}

// ——— упрощение ————————————————————————————————————————————————————————

function sameVertex(a, b) {
  return Math.abs(a.x - b.x) <= SAME_POINT_MM && Math.abs(a.y - b.y) <= SAME_POINT_MM;
}

function dropRepeats(ring) {
  const out = [];
  for (const point of ring) {
    if (out.length > 0 && sameVertex(out[out.length - 1], point)) continue;
    out.push(point);
  }
  while (out.length > 1 && sameVertex(out[0], out[out.length - 1])) out.pop();
  return out;
}

// Вершина на прямой между соседями — лишняя. Мера — высота треугольника, а не
// векторное произведение: у длинного отрезка оно велико и на прямой линии.
function dropStraight(ring) {
  if (ring.length < 4) return ring;
  const out = [];
  for (let index = 0; index < ring.length; index += 1) {
    const previous = out.length > 0 ? out[out.length - 1] : ring[(index - 1 + ring.length) % ring.length];
    const next = ring[(index + 1) % ring.length];
    if (segmentDistanceMm(ring[index], previous, next) > SAME_POINT_MM) out.push(ring[index]);
  }
  return out.length >= 3 ? out : ring;
}

// Рамер–Дуглас–Пекер по открытой цепочке.
function thinChain(chain, epsilon) {
  if (chain.length < 3) return chain;
  let worst = 0;
  let at = 0;
  for (let index = 1; index < chain.length - 1; index += 1) {
    const away = segmentDistanceMm(chain[index], chain[0], chain[chain.length - 1]);
    if (away > worst) {
      worst = away;
      at = index;
    }
  }
  if (worst <= epsilon) return [chain[0], chain[chain.length - 1]];
  const head = thinChain(chain.slice(0, at + 1), epsilon);
  const tail = thinChain(chain.slice(at), epsilon);
  return [...head.slice(0, -1), ...tail];
}

// Кольцо режется на две цепочки по двум самым далёким друг от друга вершинам:
// иначе первая же вершина кольца стала бы якорем и срезала бы угол.
function thinRing(ring, epsilon) {
  if (ring.length < 4) return ring;
  let first = 0;
  let span = -1;
  for (let index = 1; index < ring.length; index += 1) {
    const away = Math.hypot(ring[index].x - ring[0].x, ring[index].y - ring[0].y);
    if (away > span) {
      span = away;
      first = index;
    }
  }
  let second = 0;
  span = -1;
  for (let index = 0; index < ring.length; index += 1) {
    const away = Math.hypot(ring[index].x - ring[first].x, ring[index].y - ring[first].y);
    if (away > span) {
      span = away;
      second = index;
    }
  }
  const from = Math.min(first, second);
  const to = Math.max(first, second);
  const head = thinChain(ring.slice(from, to + 1), epsilon);
  const tail = thinChain([...ring.slice(to), ...ring.slice(0, from + 1)], epsilon);
  return dropRepeats([...head, ...tail.slice(1, -1)]);
}

// ——— посадка на линии чертежа ——————————————————————————————————————————

function unitBetween(a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (!(len > 0)) return null;
  return { x: dx / len || 0, y: dy / len || 0, len };
}

function lineAway(line, point) {
  return Math.abs((point.x - line.x) * line.dy - (point.y - line.y) * line.dx);
}

function lineOnto(line, point) {
  const along = (point.x - line.x) * line.dx + (point.y - line.y) * line.dy;
  return { x: line.x + line.dx * along, y: line.y + line.dy * along };
}

function lineCross(one, two) {
  const den = one.dx * two.dy - one.dy * two.dx;
  if (Math.abs(den) < 0.05) return null;
  const along = ((two.x - one.x) * two.dy - (two.y - one.y) * two.dx) / den;
  return { x: one.x + one.dx * along, y: one.y + one.dy * along };
}

/**
 * Линии, на которые садится обводка: по две грани и по два торца у каждой
 * стены, плюс рёбра соседних контуров — там, где новый контур встаёт вплотную
 * к размеченному, шов обязан быть общим, а не «почти».
 */
export function roomTraceLines(walls, rings) {
  const lines = [];
  for (const wall of walls) {
    const vectors = wallVectors(wall);
    if (!vectors) continue;
    const half = (Number(wall.thicknessMm) || 0) / 2;
    const middle = { x: (wall.aMm.x + wall.bMm.x) / 2, y: (wall.aMm.y + wall.bMm.y) / 2 };
    for (const side of [1, -1]) {
      lines.push({
        x: middle.x + vectors.n.x * half * side,
        y: middle.y + vectors.n.y * half * side,
        dx: vectors.u.x,
        dy: vectors.u.y,
      });
    }
    for (const end of [wall.aMm, wall.bMm]) {
      lines.push({ x: end.x, y: end.y, dx: vectors.n.x, dy: vectors.n.y });
    }
  }
  for (const ring of rings) {
    for (let i = 0, k = ring.length - 1; i < ring.length; k = i, i += 1) {
      const unit = unitBetween(ring[k], ring[i]);
      if (!unit) continue;
      lines.push({ x: ring[k].x, y: ring[k].y, dx: unit.x, dy: unit.y });
    }
  }
  return lines;
}

function bestLine(from, to, lines, tolerance, minLength, sine = SNAP_SINE) {
  const unit = unitBetween(from, to);
  if (!unit || unit.len < minLength) return null;
  let found = null;
  let best = tolerance;
  for (const line of lines) {
    if (Math.abs(unit.x * line.dy - unit.y * line.dx) > sine) continue;
    const away = Math.max(lineAway(line, from), lineAway(line, to));
    if (away > best) continue;
    best = away;
    found = line;
  }
  return found;
}

/**
 * Убрать углы, которых на чертеже нет.
 *
 * Внутренний угол комнаты растр срезает фаской: там, где две стены сходятся
 * концами, между их прямоугольниками остаётся свободный кармашек размером
 * примерно в половину толщины стены. На Г-образной комнате настоящего плана это
 * выглядело как лишняя седьмая вершина и скос 56 мм — все прочие пять вершин
 * сходились миллиметр в миллиметр.
 *
 * Отличить фаску от настоящей стороны можно тем же, чем считается всё
 * остальное: **настоящая сторона лежит на линии чертежа, фаска — ни на одной**.
 * Поэтому короткий отрезок, которому не нашлось линии, стягивается в вершину, и
 * дальше две длинные стороны честно пересекаются в самом углу.
 */
function dropArtifacts(ring, lines, tolerance, minLength, maxArtifact) {
  if (ring.length < 4 || lines.length === 0) return ring;
  const real = ring.map((point, index) => {
    const next = ring[(index + 1) % ring.length];
    if (Math.hypot(next.x - point.x, next.y - point.y) >= maxArtifact) return true;
    return Boolean(bestLine(point, next, lines, tolerance, minLength, SNAP_SINE_STRICT));
  });
  let start = -1;
  for (let index = 0; index < ring.length; index += 1) {
    if (real[(index - 1 + ring.length) % ring.length]) {
      start = index;
      break;
    }
  }
  if (start < 0) return ring;
  const out = [];
  let group = [];
  for (let step = 0; step < ring.length; step += 1) {
    const index = (start + step) % ring.length;
    group.push(ring[index]);
    if (!real[index]) continue;
    let x = 0;
    let y = 0;
    for (const point of group) {
      x += point.x;
      y += point.y;
    }
    out.push({ x: x / group.length, y: y / group.length });
    group = [];
  }
  return out.length >= 3 ? out : ring;
}

/**
 * Отрезки лестницы садятся на линии чертежа, вершины пересчитываются как
 * пересечения соседних линий. Это и превращает «примерно по стене» в «ровно по
 * внутренней грани».
 */
export function snapSegments(ring, lines, tolerance, minLength) {
  if (ring.length < 3 || lines.length === 0) return ring;
  const taken = ring.map((point, index) => bestLine(point, ring[(index + 1) % ring.length], lines, tolerance, minLength));
  const out = [];
  for (let index = 0; index < ring.length; index += 1) {
    const before = taken[(index - 1 + ring.length) % ring.length];
    const after = taken[index];
    const point = ring[index];
    if (before && after) {
      const crossed = lineCross(before, after);
      // Пересечение, уехавшее далеко, — это почти параллельные линии: вершина
      // там не настоящая, и лучше остаться на линии, чем улететь по ней.
      out.push(crossed && Math.hypot(crossed.x - point.x, crossed.y - point.y) <= tolerance * 3 ? crossed : lineOnto(after, point));
    } else if (before) out.push(lineOnto(before, point));
    else if (after) out.push(lineOnto(after, point));
    else out.push(point);
  }
  return out;
}

// ——— сам ответ ————————————————————————————————————————————————————————

/**
 * Обвести область вокруг точки по чертежу. Чистая геометрия в миллиметрах:
 * ни объекта, ни схемы, ни долей плана здесь нет — только то, что можно
 * проверить числами.
 *
 * `scene = {seedMm, walls: [{aMm, bMm, thicknessMm}], rings: [points[]]}`,
 * где `rings` — уже размеченные контуры этой схемы в миллиметрах.
 *
 * Ответ — `{ok: true, pointsMm, areaMm2, cell, cells}` или
 * `{ok: false, reason}`, где `reason`:
 *
 * - `noWalls` — стен нет, считать нечего;
 * - `inWall` — показали внутрь стены;
 * - `taken` (+`ringIndex`) — показали в уже размеченный контур;
 * - `open` — заливка ушла за рамку: стены не сошлись;
 * - `tooSmall` — меньше `ROOM_TRACE_AREA_MIN_MM2`;
 * - `tooBig` — больше `ROOM_TRACE_AREA_MAX_MM2`;
 * - `tooComplex` — вершин больше `ROOM_TRACE_POINTS_MAX`.
 */
export function roomTraceRegion(scene) {
  const walls = (scene && Array.isArray(scene.walls) ? scene.walls : []).filter((wall) => wallVectors(wall));
  const rings = (scene && Array.isArray(scene.rings) ? scene.rings : []).filter((ring) => ring.length >= 3);
  const seed = scene && scene.seedMm;
  if (walls.length === 0) return { ok: false, reason: "noWalls" };
  if (!seed) return { ok: false, reason: "noBridge" };
  // Показали в уже размеченное — ответ до всякой заливки, и он называет
  // контур: «просто пусть показывает ошибку» (слова заказчика).
  for (let index = 0; index < rings.length; index += 1) {
    if (pointInRing(seed, rings[index])) return { ok: false, reason: "taken", ringIndex: index };
  }
  const grid = gridFor(walls);
  const seedI = columnOf(grid, seed.x);
  const seedJ = rowOf(grid, seed.y);
  if (seedI <= 0 || seedJ <= 0 || seedI >= grid.cols - 1 || seedJ >= grid.rows - 1) {
    return { ok: false, reason: "open" };
  }
  const mask = new Uint8Array(grid.cols * grid.rows);
  for (const wall of walls) {
    markSegment(mask, grid, wall.aMm, wall.bMm, Number(wall.thicknessMm) || 0, CELL_WALL);
  }
  for (const ring of rings) markRing(mask, grid, ring, CELL_TAKEN);
  const seedIndex = seedJ * grid.cols + seedI;
  if (mask[seedIndex] === CELL_WALL) return { ok: false, reason: "inWall" };
  if (mask[seedIndex] === CELL_TAKEN) {
    // Клетка занята краем соседнего контура: сам он точку не накрыл, но встать
    // тут нечему — до шва меньше клетки.
    let nearest = 0;
    let best = Infinity;
    for (let index = 0; index < rings.length; index += 1) {
      for (let i = 0, k = rings[index].length - 1; i < rings[index].length; k = i, i += 1) {
        const away = segmentDistanceMm(seed, rings[index][k], rings[index][i]);
        if (away < best) {
          best = away;
          nearest = index;
        }
      }
    }
    return { ok: false, reason: "taken", ringIndex: nearest };
  }
  const flood = floodFrom(mask, grid, seedIndex);
  if (flood.open) return { ok: false, reason: "open", cell: grid.cell };
  const filled = new Uint8Array(grid.cols * grid.rows);
  let top = flood.cells[0];
  for (const index of flood.cells) {
    filled[index] = 1;
    if (index < top) top = index;
  }
  const raw = traceRing(filled, grid, top);
  const tolerance = grid.cell * SNAP_TOLERANCE_CELLS;
  const lines = roomTraceLines(walls, rings);
  const minLength = grid.cell * SNAP_MIN_CELLS;
  // Фаска стыка растёт с толщиной стены, а не с клеткой: у стены 150 мм она
  // доходит до 110 мм, и мерить её клеткой было бы мало.
  let thickest = 0;
  for (const wall of walls) thickest = Math.max(thickest, Number(wall.thicknessMm) || 0);
  let ring = dropStraight(dropRepeats(raw));
  ring = thinRing(ring, grid.cell * 0.8);
  // Два прохода, а не один, и это не «на всякий случай»: стянутая фаска сдвигает
  // вершину, и соседняя сторона на первом проходе промахивается мимо своей
  // линии. Второй проход считает её направление уже по исправленным вершинам и
  // садится. На настоящей планировке это ровно разница между 17 точными
  // комнатами из 18 и 15 из 18; третий проход не меняет ничего.
  for (let pass = 0; pass < 2; pass += 1) {
    ring = dropArtifacts(ring, lines, tolerance, minLength, thickest * 0.75 + grid.cell);
    ring = snapSegments(ring, lines, tolerance, minLength);
    ring = dropStraight(dropRepeats(ring));
  }
  const pointsMm = ring.map((point) => ({ x: Math.round(point.x), y: Math.round(point.y) }));
  const areaMm2 = ringAreaMm2(pointsMm);
  if (pointsMm.length < OUTLINE_MIN_POINTS || areaMm2 < ROOM_TRACE_AREA_MIN_MM2) {
    return { ok: false, reason: "tooSmall", cell: grid.cell };
  }
  if (areaMm2 > ROOM_TRACE_AREA_MAX_MM2) return { ok: false, reason: "tooBig", areaMm2, cell: grid.cell };
  if (pointsMm.length > ROOM_TRACE_POINTS_MAX) {
    return { ok: false, reason: "tooComplex", points: pointsMm.length, cell: grid.cell };
  }
  return { ok: true, pointsMm, areaMm2, cell: grid.cell, cells: flood.cells.length };
}

// ——— то же, но об объекте ——————————————————————————————————————————————

/**
 * Можно ли вообще обводить по чертежу на этой схеме. `reason` называет, чего
 * не хватает: `noWalls` — стен не нарисовано, `noBridge` — чертёж к подложке
 * не привязан или план не откалиброван (ADR 008), и тогда миллиметры в доли не
 * перевести.
 */
export function roomTraceReady(project, schemeId) {
  if (!project || !schemeId) return { ok: false, reason: "noWalls" };
  if (wallsOnScheme(project, schemeId).length === 0) return { ok: false, reason: "noWalls" };
  if (!planMmToFraction(project, schemeId, { x: 0, y: 0 })) return { ok: false, reason: "noBridge" };
  return { ok: true, reason: null };
}

/**
 * Контур помещения по точке на плане. Точка — **доля плана** (ADR 002), ответ
 * тоже в долях: контур ложится рядом с нарисованными руками и дальше правится
 * ими же. Миллиметры живут только внутри.
 *
 * `{ok: true, points, areaMm2}` или `{ok: false, reason, outlineId?}` — коды
 * те же, что у `roomTraceRegion`, плюс `noBridge`.
 */
export function roomTraceAt(project, schemeId, point) {
  const ready = roomTraceReady(project, schemeId);
  if (!ready.ok) return { ok: false, reason: ready.reason };
  const seedMm = planFractionToMm(project, schemeId, point);
  if (!seedMm) return { ok: false, reason: "noBridge" };
  const outlines = outlinesInOrder(project, schemeId);
  const rings = [];
  const ringOwners = [];
  for (const outline of outlines) {
    const ring = [];
    for (const vertex of outline.points) {
      const converted = planFractionToMm(project, schemeId, vertex);
      if (converted) ring.push(converted);
    }
    if (ring.length < 3) continue;
    rings.push(ring);
    ringOwners.push(outline);
  }
  const region = roomTraceRegion({ seedMm, walls: wallsOnScheme(project, schemeId), rings });
  if (!region.ok) {
    const owner = region.reason === "taken" ? ringOwners[region.ringIndex] : null;
    return { ok: false, reason: region.reason, outlineId: owner ? owner.id : null, roomId: owner ? owner.roomId : null };
  }
  const points = [];
  for (const vertex of region.pointsMm) {
    const converted = planMmToFraction(project, schemeId, vertex);
    if (!converted) return { ok: false, reason: "noBridge" };
    points.push(converted);
  }
  return { ok: true, points, areaMm2: region.areaMm2, cell: region.cell };
}
