// Скаты — наклонные участки потолка мансарды (ADR 043).
//
// Чистая геометрия без объекта и без DOM: плоскость ската, высота потолка в
// точке, раскладка потолка помещения на куски и профиль верха стены. Объект
// сюда приходит уже разобранным — списком скатов контура (`outline.slopes`,
// читает `model.outlineSlopes`), — поэтому модуль стоит ниже модели, и его же
// читают «Объём» и развёртка.
//
// **Скат** — `{pointsMm, edge, lowMm, highMm}`: участок потолка на плане в
// миллиметрах чертежа, номер кромки отсчёта (обычно нижней), высота от пола у
// этой кромки и высота в самой дальней от неё вершине. Плоскость линейна по
// расстоянию от кромки. Слово «нижняя» — про обычный случай: высота у кромки
// может быть и больше дальней, тогда скат от кромки опускается (так собирается
// примыкание второй крыши, у которого на плане от нижнего края осталась одна
// вершина).
//
// **Одно правило высоты:** под скатом потолок — плоскость ската, под
// несколькими — наименьшая из них, вне скатов — плоский, на высоте помещения.
// Отвечает на это `slopesHeightAt`, и второго счёта быть не должно: её
// спрашивают и грани потолка, и срез стены, и посадка метки, и развёртка.

/** Меньше этого многоугольник — не кусок потолка, а погрешность резки, мм². */
const SLOPE_AREA_MIN_MM2 = 25;
/** Точки ближе этого вдоль стены — одна точка профиля, мм. */
const SLOPE_STEP_MIN_MM = 0.5;

/**
 * Насколько скат «дотягивается» до стены за своим краем, мм. Участок обводят
 * по углам помещения — по внутренней грани стены, а грань стены и её угол
 * (ось соседки) лежат снаружи контура на долю толщины. Без запаса верх стены у
 * самого угла считался бы плоским потолком.
 */
export const SLOPE_REACH_MM = 400;

function slopeSignedArea(points) {
  let sum = 0;
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    sum += points[j].x * points[i].y - points[i].x * points[j].y;
  }
  return sum / 2;
}

/** Площадь участка на плане, мм². */
export function slopeArea(points) {
  return Math.abs(slopeSignedArea(points || []));
}

// Обход в одну сторону (площадь со знаком плюс): резка полуплоскостями ниже
// считает «внутри» слева от ребра.
function slopeOriented(points) {
  const list = points.map((point) => ({ x: Number(point.x), y: Number(point.y) }));
  return slopeSignedArea(list) < 0 ? list.reverse() : list;
}

/**
 * Плоскость ската: `{ax, ay, c}`, высота в точке — `ax·x + ay·y + c`.
 * `null` — скат вырожден: кромки нет или все вершины лежат на ней.
 */
export function slopePlane(slope) {
  const points = slope && Array.isArray(slope.pointsMm) ? slope.pointsMm : [];
  const count = points.length;
  const edge = Number(slope && slope.edge);
  if (count < 3 || !Number.isInteger(edge) || edge < 0 || edge >= count) return null;
  const from = points[edge];
  const to = points[(edge + 1) % count];
  const dx = Number(to.x) - Number(from.x);
  const dy = Number(to.y) - Number(from.y);
  const len = Math.hypot(dx, dy);
  if (!(len > 0)) return null;
  const nx = -dy / len;
  const ny = dx / len;
  let far = 0;
  for (const point of points) {
    const reach = (Number(point.x) - Number(from.x)) * nx + (Number(point.y) - Number(from.y)) * ny;
    if (Math.abs(reach) > Math.abs(far)) far = reach;
  }
  if (!(Math.abs(far) >= 1)) return null;
  const low = Number(slope.lowMm);
  const high = Number(slope.highMm);
  if (!Number.isFinite(low) || !Number.isFinite(high)) return null;
  const rise = (high - low) / far;
  const ax = rise * nx;
  const ay = rise * ny;
  return { ax, ay, c: low - ax * Number(from.x) - ay * Number(from.y) };
}

function slopePlaneAt(plane, point) {
  return plane.ax * point.x + plane.ay * point.y + plane.c;
}

function slopeInside(point, points) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    const a = points[i];
    const b = points[j];
    if (a.y > point.y !== b.y > point.y && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

function slopeGap(point, points) {
  let best = Infinity;
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    const a = points[j];
    const b = points[i];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    const t = len2 > 0 ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / len2)) : 0;
    best = Math.min(best, Math.hypot(point.x - a.x - dx * t, point.y - a.y - dy * t));
  }
  return best;
}

/** Лежит ли точка плана под скатом; `reachMm` — запас за его краем. */
export function slopeCovers(slope, point, reachMm = 0) {
  const points = slope && Array.isArray(slope.pointsMm) ? slope.pointsMm : [];
  if (points.length < 3) return false;
  if (slopeInside(point, points)) return true;
  return reachMm > 0 && slopeGap(point, points) <= reachMm;
}

/**
 * **Высота потолка в точке** — единственный ответ сборки: под скатом его
 * плоскость, под несколькими — наименьшая, вне скатов — `flatMm`. Ниже пола
 * потолок не опускается.
 */
export function slopesHeightAt(slopes, point, flatMm, reachMm = 0) {
  let best = null;
  // Запас за краем работает, только когда над самой точкой ската нет (см.
  // `slopeProfile`): сосед по ендове, продлённый запасом, ниже настоящего.
  for (const reach of [0, reachMm]) {
    for (const slope of slopes || []) {
      if (!slopeCovers(slope, point, reach)) continue;
      const plane = slopePlane(slope);
      if (!plane) continue;
      const height = slopePlaneAt(plane, point);
      if (best === null || height < best) best = height;
    }
    if (best !== null || !(reachMm > 0)) break;
  }
  return best === null ? flatMm : Math.max(0, best);
}

/** Номер ската, который держит потолок в точке, или `-1` — потолок плоский. */
export function slopeIndexAt(slopes, point, reachMm = 0) {
  let best = null;
  let found = -1;
  (slopes || []).forEach((slope, index) => {
    if (!slopeCovers(slope, point, reachMm)) return;
    const plane = slopePlane(slope);
    if (!plane) return;
    const height = slopePlaneAt(plane, point);
    if (best === null || height < best) {
      best = height;
      found = index;
    }
  });
  return found;
}

// ——— резка многоугольников ————————————————————————————————————————————————

function slopeConvex(points) {
  const count = points.length;
  for (let index = 0; index < count; index += 1) {
    const a = points[index];
    const b = points[(index + 1) % count];
    const c = points[(index + 2) % count];
    if ((b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x) < -1e-6) return false;
  }
  return true;
}

function slopeInTriangle(point, a, b, c) {
  const side = (p, q) => (q.x - p.x) * (point.y - p.y) - (q.y - p.y) * (point.x - p.x);
  // На самой диагонали `c → a` точка тоже мешает: отрезав такое ухо, мы прошли
  // бы диагональю через вершину контура и накрыли то, что лежит вне его.
  return side(a, b) > 1e-9 && side(b, c) > 1e-9 && side(c, a) > -1e-9;
}

/**
 * Выпуклые части многоугольника: выпуклый — сам, иначе треугольники
 * (отрезание ушей). Обход частей — в одну сторону.
 */
export function slopeConvexParts(points) {
  const list = slopeOriented(points || []);
  if (list.length < 3) return [];
  if (slopeConvex(list)) return [list];
  const rest = [...list];
  const parts = [];
  let guard = rest.length * rest.length;
  while (rest.length > 3 && guard > 0) {
    guard -= 1;
    let cut = false;
    for (let index = 0; index < rest.length; index += 1) {
      const a = rest[(index + rest.length - 1) % rest.length];
      const b = rest[index];
      const c = rest[(index + 1) % rest.length];
      if ((b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x) <= 1e-9) continue;
      if (rest.some((point) => point !== a && point !== b && point !== c && slopeInTriangle(point, a, b, c))) continue;
      parts.push([a, b, c]);
      rest.splice(index, 1);
      cut = true;
      break;
    }
    if (!cut) break;
  }
  if (rest.length >= 3) parts.push(rest);
  return parts.filter((part) => slopeArea(part) > SLOPE_AREA_MIN_MM2);
}

// Часть выпуклого многоугольника, где `value(point) >= 0`.
function slopeClipHalf(points, value) {
  const out = [];
  for (let index = 0; index < points.length; index += 1) {
    const a = points[index];
    const b = points[(index + 1) % points.length];
    const va = value(a);
    const vb = value(b);
    if (va >= 0) out.push(a);
    if ((va > 0 && vb < 0) || (va < 0 && vb > 0)) {
      const t = va / (va - vb);
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    }
  }
  return out.length >= 3 && slopeArea(out) > SLOPE_AREA_MIN_MM2 ? out : null;
}

// Выпуклый `piece` делится выпуклым `part`: что внутри и куски снаружи.
function slopeSplitBy(piece, part) {
  const outside = [];
  let rest = piece;
  for (let index = 0; index < part.length && rest; index += 1) {
    const a = part[index];
    const b = part[(index + 1) % part.length];
    const side = (point) => (b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x);
    const out = slopeClipHalf(rest, (point) => -side(point));
    if (out) outside.push(out);
    rest = slopeClipHalf(rest, side);
  }
  return { inside: rest, outside };
}

/**
 * **Потолок помещения кусками:** `[{points: [{x, y, z}], slope}]`, где
 * `slope` — номер ската в списке или `-1` у плоского куска. Куски выпуклые,
 * не накладываются и вместе закрывают контур помещения. Под двумя скатами
 * кусок режется по линии, где их плоскости равны, и достаётся нижнему.
 *
 * Без скатов ответ — один кусок, сам контур: сцена такого помещения прежняя.
 */
export function slopeCeilingPieces(pointsMm, slopes, flatMm) {
  const list = (slopes || []).map((slope) => ({ slope, plane: slopePlane(slope) }));
  if (!list.some((item) => item.plane)) {
    return [{ points: (pointsMm || []).map((point) => ({ x: point.x, y: point.y, z: flatMm })), slope: -1 }];
  }
  let pieces = slopeConvexParts(pointsMm).map((poly) => ({ poly, slope: -1, plane: null }));
  list.forEach((item, index) => {
    if (!item.plane) return;
    for (const part of slopeConvexParts(item.slope.pointsMm)) {
      const next = [];
      for (const piece of pieces) {
        if (piece.slope === index) {
          next.push(piece);
          continue;
        }
        const { inside, outside } = slopeSplitBy(piece.poly, part);
        for (const poly of outside) next.push({ ...piece, poly });
        if (!inside) continue;
        if (piece.slope < 0) {
          next.push({ poly: inside, slope: index, plane: item.plane });
          continue;
        }
        const over = (point) => slopePlaneAt(piece.plane, point) - slopePlaneAt(item.plane, point);
        const lower = slopeClipHalf(inside, over);
        const upper = slopeClipHalf(inside, (point) => -over(point));
        if (lower) next.push({ poly: lower, slope: index, plane: item.plane });
        if (upper) next.push({ ...piece, poly: upper });
      }
      pieces = next;
    }
  });
  return pieces.map((piece) => ({
    points: piece.poly.map((point) => ({
      x: point.x,
      y: point.y,
      z: piece.plane ? Math.max(0, slopePlaneAt(piece.plane, point)) : flatMm,
    })),
    slope: piece.slope,
  }));
}

/** Перепад высот на стыке кусков меньше этого — не щека, а погрешность счёта, мм. */
const SLOPE_CHEEK_MIN_MM = 10;

/**
 * **Обрезок плоского потолка** — плоский кусок уже половины запаса ската
 * (`SLOPE_REACH_MM`): участок обвели чуть мимо контура помещения, и между
 * скатом и стеной осталась полоска на высоте помещения. Это погрешность
 * обводки, а не потолок: стена под неё и так срезана по скату (тот же запас),
 * поэтому сцена такой кусок не рисует и щеки к нему не ставит. Ширина —
 * `2·площадь / периметр`.
 */
export function slopePieceStray(piece) {
  if (!piece || piece.slope >= 0 || !Array.isArray(piece.points) || piece.points.length < 3) return false;
  let around = 0;
  for (let i = 0, j = piece.points.length - 1; i < piece.points.length; j = i, i += 1) {
    around += Math.hypot(piece.points[i].x - piece.points[j].x, piece.points[i].y - piece.points[j].y);
  }
  return around > 0 && (2 * slopeArea(piece.points)) / around < SLOPE_REACH_MM / 2;
}

/**
 * **Щёки потолка** — вертикальные грани на стыках кусков, где высоты не
 * сходятся: кромка ската под плоским потолком, край ската, начерченного не на
 * всё помещение, уступ между двумя скатами (стенка слухового окна). Без них
 * скат висел листом со свободной кромкой, а в щель над ней было видно небо
 * (слова заказчика: «как будто просто лист приложили»).
 *
 * `pieces` — ответ `slopeCeilingPieces`; ответ — `[{points: [{x, y, z}]}]`,
 * три или четыре точки на грань. Куски, сошедшиеся по высоте (конёк, ендова),
 * щёк не дают, поэтому потолок из сходящихся скатов собирается как прежде.
 */
export function slopeCheeks(pieces) {
  const out = [];
  const list = (pieces || []).filter((piece) => !slopePieceStray(piece));
  const lerp = (from, to, t) => from + (to - from) * t;
  for (let i = 0; i < list.length; i += 1) {
    for (let j = i + 1; j < list.length; j += 1) {
      const first = list[i].points;
      const second = list[j].points;
      for (let ei = 0; ei < first.length; ei += 1) {
        const a = first[ei];
        const b = first[(ei + 1) % first.length];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const len = Math.hypot(dx, dy);
        if (!(len > SLOPE_STEP_MIN_MM)) continue;
        const ux = dx / len;
        const uy = dy / len;
        for (let ej = 0; ej < second.length; ej += 1) {
          const c = second[ej];
          const d = second[(ej + 1) % second.length];
          const offC = (c.x - a.x) * -uy + (c.y - a.y) * ux;
          const offD = (d.x - a.x) * -uy + (d.y - a.y) * ux;
          if (Math.abs(offC) > SLOPE_STEP_MIN_MM || Math.abs(offD) > SLOPE_STEP_MIN_MM) continue;
          const tc = (c.x - a.x) * ux + (c.y - a.y) * uy;
          const td = (d.x - a.x) * ux + (d.y - a.y) * uy;
          if (!(Math.abs(td - tc) > SLOPE_STEP_MIN_MM)) continue;
          const from = Math.max(0, Math.min(tc, td));
          const to = Math.min(len, Math.max(tc, td));
          if (!(to - from > SLOPE_CHEEK_MIN_MM)) continue;
          const mine = (t) => lerp(a.z, b.z, t / len);
          const theirs = (t) => lerp(c.z, d.z, (t - tc) / (td - tc));
          const at = (t, z) => ({ x: a.x + ux * t, y: a.y + uy * t, z });
          const gapFrom = mine(from) - theirs(from);
          const gapTo = mine(to) - theirs(to);
          if (Math.abs(gapFrom) < SLOPE_CHEEK_MIN_MM && Math.abs(gapTo) < SLOPE_CHEEK_MIN_MM) continue;
          // Высоты пересеклись посреди стыка — щека из двух треугольников.
          const spans = gapFrom * gapTo < -1e-9 ? [[from, from + ((to - from) * gapFrom) / (gapFrom - gapTo)], [from + ((to - from) * gapFrom) / (gapFrom - gapTo), to]] : [[from, to]];
          for (const [t0, t1] of spans) {
            const points = [at(t0, mine(t0)), at(t1, mine(t1))];
            if (Math.abs(mine(t1) - theirs(t1)) >= SLOPE_CHEEK_MIN_MM / 2) points.push(at(t1, theirs(t1)));
            if (Math.abs(mine(t0) - theirs(t0)) >= SLOPE_CHEEK_MIN_MM / 2) points.push(at(t0, theirs(t0)));
            if (points.length >= 3) out.push({ points });
          }
        }
      }
    }
  }
  return out;
}

/**
 * Вырезать из кусков потолка выпуклый участок плана (мансардное окно):
 * `{pieces, cut}` — что осталось и что вырезано; высоты пересчитаны по
 * плоскости своего куска.
 */
export function slopePiecesCut(pieces, holeMm) {
  const hole = slopeOriented(holeMm || []);
  const kept = [];
  const cut = [];
  for (const piece of pieces || []) {
    const flat = slopeOriented(piece.points);
    // Высота в точке куска — по трём его вершинам: кусок плоский.
    const plane = slopePlaneThrough(piece.points);
    const lift = (poly) => ({
      ...piece,
      points: poly.map((point) => ({ x: point.x, y: point.y, z: plane ? slopePlaneAt(plane, point) : piece.points[0].z })),
    });
    if (hole.length < 3) {
      kept.push(piece);
      continue;
    }
    const { inside, outside } = slopeSplitBy(flat, hole);
    if (!inside) {
      kept.push(piece);
      continue;
    }
    for (const poly of outside) kept.push(lift(poly));
    cut.push(lift(inside));
  }
  return { pieces: kept, cut };
}

// Плоскость через вершины куска `{x, y, z}`: по первой тройке не на одной прямой.
function slopePlaneThrough(points) {
  for (let index = 2; index < points.length; index += 1) {
    const a = points[0];
    const b = points[index - 1];
    const c = points[index];
    const det = (b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y);
    if (Math.abs(det) < 1e-6) continue;
    const ax = ((b.z - a.z) * (c.y - a.y) - (c.z - a.z) * (b.y - a.y)) / det;
    const ay = ((b.x - a.x) * (c.z - a.z) - (c.x - a.x) * (b.z - a.z)) / det;
    return { ax, ay, c: a.z - ax * a.x - ay * a.y };
  }
  return null;
}

// ——— профиль верха стены ——————————————————————————————————————————————————

/**
 * **Профиль потолка вдоль отрезка** `a → b` (грань стены на плане):
 * `[{fromMm, toMm, fromZ, toZ}]` — куски от начала к концу, высота на куске
 * линейна. Скат дотягивается до стены с запасом `reachMm`.
 */
export function slopeProfile(slopes, a, b, flatMm, reachMm = SLOPE_REACH_MM) {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  if (!(len > 0)) return [];
  const ux = (b.x - a.x) / len;
  const uy = (b.y - a.y) / len;
  const at = (t) => ({ x: a.x + ux * t, y: a.y + uy * t });
  const list = (slopes || []).map((slope) => ({ slope, plane: slopePlane(slope) })).filter((item) => item.plane);
  const cuts = [0, len];
  for (const item of list) {
    const points = item.slope.pointsMm;
    for (let index = 0; index < points.length; index += 1) {
      const p = points[index];
      const q = points[(index + 1) % points.length];
      const ex = q.x - p.x;
      const ey = q.y - p.y;
      const cross = ux * ey - uy * ex;
      if (Math.abs(cross) < 1e-9) continue;
      const t = ((p.x - a.x) * ey - (p.y - a.y) * ex) / cross;
      if (t > SLOPE_STEP_MIN_MM && t < len - SLOPE_STEP_MIN_MM) cuts.push(t);
    }
  }
  // Где две плоскости равны: там нижняя сменяется.
  for (let i = 0; i < list.length; i += 1) {
    for (let j = i + 1; j < list.length; j += 1) {
      const start = slopePlaneAt(list[i].plane, a) - slopePlaneAt(list[j].plane, a);
      const end = slopePlaneAt(list[i].plane, b) - slopePlaneAt(list[j].plane, b);
      if ((start > 0 && end < 0) || (start < 0 && end > 0)) cuts.push((start / (start - end)) * len);
    }
  }
  cuts.sort((first, second) => first - second);
  const parts = [];
  for (let index = 0; index + 1 < cuts.length; index += 1) {
    const from = cuts[index];
    const to = cuts[index + 1];
    if (!(to - from > SLOPE_STEP_MIN_MM)) continue;
    const mid = at((from + to) / 2);
    // Сначала скаты, которые лежат над точкой сами, и только если таких нет —
    // те, что дотягиваются запасом. Иначе у ендовы сосед, продлённый за свою
    // кромку, оказывался ниже и срезал стену под потолком (правка 2026-11-21).
    let best = null;
    for (const reach of [0, reachMm]) {
      for (const item of list) {
        if (!slopeCovers(item.slope, mid, reach)) continue;
        if (best === null || slopePlaneAt(item.plane, mid) < slopePlaneAt(best, mid)) best = item.plane;
      }
      if (best !== null || !(reachMm > 0)) break;
    }
    const fromZ = best ? Math.max(0, slopePlaneAt(best, at(from))) : flatMm;
    const toZ = best ? Math.max(0, slopePlaneAt(best, at(to))) : flatMm;
    parts.push({ fromMm: from, toMm: to, fromZ, toZ });
  }
  return slopeProfileTidy(parts);
}

/** Соседние куски на одной прямой сливаются: ровная стена — один кусок. */
export function slopeProfileTidy(parts) {
  const out = [];
  for (const part of parts) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.toZ - part.fromZ) < 0.01) {
      const before = (last.toZ - last.fromZ) / (last.toMm - last.fromMm);
      const after = (part.toZ - part.fromZ) / (part.toMm - part.fromMm);
      if (Math.abs(before - after) < 1e-6) {
        last.toMm = part.toMm;
        last.toZ = part.toZ;
        continue;
      }
    }
    out.push({ ...part });
  }
  return out;
}

/** Высота профиля в месте `alongMm`; на стыке кусков — большая из двух. */
export function slopeProfileAt(profile, alongMm) {
  let best = null;
  for (const part of profile || []) {
    if (alongMm < part.fromMm - 1e-6 || alongMm > part.toMm + 1e-6) continue;
    const span = part.toMm - part.fromMm;
    const z = span > 0 ? part.fromZ + ((part.toZ - part.fromZ) * (alongMm - part.fromMm)) / span : part.fromZ;
    if (best === null || z > best) best = z;
  }
  return best === null ? 0 : best;
}

/** Самая высокая точка профиля. */
export function slopeProfileTop(profile) {
  let top = 0;
  for (const part of profile || []) top = Math.max(top, part.fromZ, part.toZ);
  return top;
}

/** Ровный профиль на всю длину. */
export function slopeProfileFlat(lengthMm, heightMm) {
  return [{ fromMm: 0, toMm: lengthMm, fromZ: heightMm, toZ: heightMm }];
}

function slopeProfileZ(part, alongMm) {
  const span = part.toMm - part.fromMm;
  return span > 0 ? part.fromZ + ((part.toZ - part.fromZ) * (alongMm - part.fromMm)) / span : part.fromZ;
}

/**
 * Больший из двух профилей в каждой точке: у стены две стороны, и верх ей
 * даёт более высокая — то же правило, что у плоских потолков (`wallHeightMm`).
 * `null` на месте профиля — сторона молчит (улица).
 */
export function slopeProfileMax(first, second) {
  if (!first || first.length === 0) return second || [];
  if (!second || second.length === 0) return first;
  const cuts = new Set();
  for (const part of [...first, ...second]) {
    cuts.add(part.fromMm);
    cuts.add(part.toMm);
  }
  for (const one of first) {
    for (const two of second) {
      const from = Math.max(one.fromMm, two.fromMm);
      const to = Math.min(one.toMm, two.toMm);
      if (!(to - from > SLOPE_STEP_MIN_MM)) continue;
      const start = slopeProfileZ(one, from) - slopeProfileZ(two, from);
      const end = slopeProfileZ(one, to) - slopeProfileZ(two, to);
      if ((start > 0 && end < 0) || (start < 0 && end > 0)) cuts.add(from + (start / (start - end)) * (to - from));
    }
  }
  const sorted = [...cuts].sort((left, right) => left - right);
  const partAt = (profile, mid) => profile.find((part) => mid >= part.fromMm && mid <= part.toMm) || null;
  const out = [];
  for (let index = 0; index + 1 < sorted.length; index += 1) {
    const from = sorted[index];
    const to = sorted[index + 1];
    if (!(to - from > SLOPE_STEP_MIN_MM)) continue;
    const mid = (from + to) / 2;
    const one = partAt(first, mid);
    const two = partAt(second, mid);
    const pick = !one ? two : !two ? one : slopeProfileZ(one, mid) >= slopeProfileZ(two, mid) ? one : two;
    if (!pick) continue;
    out.push({ fromMm: from, toMm: to, fromZ: slopeProfileZ(pick, from), toZ: slopeProfileZ(pick, to) });
  }
  return slopeProfileTidy(out);
}

/**
 * Многоугольник `[{alongMm, zMm}]` (выпуклый, на плоскости стены) под
 * профилем: части, лежащие ниже верха стены. Целиком под профилем — тот же
 * многоугольник одной частью **по ссылке**: звавший по ней узнаёт, что резать
 * было нечего.
 */
export function slopeProfileClip(profile, polygon) {
  const eps = 0.01;
  if (polygon.every((point) => point.zMm <= slopeProfileAt(profile, point.alongMm) + eps)) return [polygon];
  const out = [];
  for (const part of profile || []) {
    const span = part.toMm - part.fromMm;
    if (!(span > 0)) continue;
    const top = (point) => part.fromZ + ((part.toZ - part.fromZ) * (point.alongMm - part.fromMm)) / span - point.zMm;
    let rest = slopeClipFlat(polygon, (point) => point.alongMm - part.fromMm);
    rest = rest && slopeClipFlat(rest, (point) => part.toMm - point.alongMm);
    rest = rest && slopeClipFlat(rest, top);
    if (rest) out.push(rest);
  }
  return out;
}

/** Часть многоугольника `[{alongMm, zMm}]` между двумя местами вдоль стены. */
export function slopeSpanClip(polygon, fromMm, toMm) {
  const rest = slopeClipFlat(polygon, (point) => point.alongMm - fromMm);
  return rest && slopeClipFlat(rest, (point) => toMm - point.alongMm);
}

// То же, что `slopeClipHalf`, но в осях стены: вдоль и вверх.
function slopeClipFlat(points, value) {
  const out = [];
  for (let index = 0; index < points.length; index += 1) {
    const a = points[index];
    const b = points[(index + 1) % points.length];
    const va = value(a);
    const vb = value(b);
    if (va >= 0) out.push(a);
    if ((va > 0 && vb < 0) || (va < 0 && vb > 0)) {
      const t = va / (va - vb);
      out.push({ alongMm: a.alongMm + (b.alongMm - a.alongMm) * t, zMm: a.zMm + (b.zMm - a.zMm) * t });
    }
  }
  if (out.length < 3) return null;
  let area = 0;
  for (let i = 0, j = out.length - 1; i < out.length; j = i, i += 1) {
    area += out[j].alongMm * out[i].zMm - out[i].alongMm * out[j].zMm;
  }
  return Math.abs(area) / 2 > SLOPE_AREA_MIN_MM2 ? out : null;
}
