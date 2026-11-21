// Сетка для отрисовки видеокартой: грани сцены → треугольники (правка
// 2026-11-20, слово заказчика: «мне нравится three.js, свет и тени… давай этот
// вариант и сделаем, но включаемым… с возможностью откатиться на старую
// отрисовку»).
//
// Здесь только **счёт**: чистые функции без DOM и без библиотеки. Саму
// видеокарту держит `src/volumeGl.js`; он берёт отсюда плоские массивы и
// больше ничего о гранях не знает. Сцена у обеих отрисовок одна и та же
// (`volumeScene`) — разная у них только последняя миля.
//
// Оси. Чертёж меряет в миллиметрах: `x` вправо, `y` вниз по листу, `z` вверх.
// Сетка — в метрах и в осях библиотеки: `X = x`, `Y = z` (вверх), `Z = y`.
// Перестановка осей — отражение, поэтому обход каждого треугольника здесь
// приводится к нормали сцены заново: порядок точек грани её не выдаёт.

import { VOLUME_LAMP_LIGHT_RGB } from "./measures.js";
import { volumeLampSourcesOf } from "./lamps.js";
import { volumeMarkPlace } from "./scene.js";

/** Миллиметры → метры. */
export const VOLUME_MESH_SCALE = 0.001;
/** Соседние источники ближе этого сливаются в один: у видеокарты их считаные. */
export const VOLUME_MESH_LAMP_JOIN_MM = 1500;
/** На сколько настенный светильник отодвинут от стены для видеокарты. */
export const VOLUME_MESH_WALL_OUT_MM = 180;
/** Подсветка картины: вынос от стены и на сколько ниже себя она целит. */
export const VOLUME_MESH_WASH_OUT_MM = 260;
export const VOLUME_MESH_WASH_DROP_MM = 900;
/** Источник ниже потолка на столько — светильник висячий. */
export const VOLUME_MESH_HANG_MM = 250;
/** Бра «вверх и вниз»: вынос луча от стены, начало луча от середины бра, цель вдоль стены и её заглубление в стену. */
export const VOLUME_MESH_UPDOWN_OUT_MM = 45;
export const VOLUME_MESH_UPDOWN_START_MM = 75;
export const VOLUME_MESH_UPDOWN_REACH_MM = 1000;
export const VOLUME_MESH_UPDOWN_IN_MM = 150;

/** Канал sRGB 0…1 → линейный: свет складывается в линейных числах. */
export function volumeMeshLinear(value) {
  return value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
}

/**
 * Отрезка ушей: плоский `[x0, y0, x1, y1, …]` → тройки номеров точек. Годится
 * для невыпуклого контура без дыр — контур помещения выпуклым не бывает.
 */
export function volumeMeshEarcut(xy) {
  const n = xy.length >> 1;
  if (n < 3) return [];
  if (n === 3) return [0, 1, 2];
  let area = 0;
  for (let i = 0; i < n; i += 1) {
    const j = (i + 1) % n;
    area += xy[2 * i] * xy[2 * j + 1] - xy[2 * j] * xy[2 * i + 1];
  }
  const idx = [];
  for (let i = 0; i < n; i += 1) idx.push(area >= 0 ? i : n - 1 - i);
  const out = [];
  const eps = Math.abs(area) * 1e-9;
  let guard = n * n + 8;
  while (idx.length > 3 && guard-- > 0) {
    let cut = false;
    const m = idx.length;
    for (let i = 0; i < m; i += 1) {
      const a = idx[(i + m - 1) % m];
      const b = idx[i];
      const c = idx[(i + 1) % m];
      const ax = xy[2 * a];
      const ay = xy[2 * a + 1];
      const bx = xy[2 * b];
      const by = xy[2 * b + 1];
      const cx = xy[2 * c];
      const cy = xy[2 * c + 1];
      const cross = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
      if (Math.abs(cross) <= eps) {
        // Три точки на одной прямой — средняя лишняя.
        idx.splice(i, 1);
        cut = true;
        break;
      }
      if (cross < 0) continue;
      let free = true;
      for (let k = 0; k < m && free; k += 1) {
        const p = idx[k];
        if (p === a || p === b || p === c) continue;
        const px = xy[2 * p];
        const py = xy[2 * p + 1];
        const d1 = (bx - ax) * (py - ay) - (by - ay) * (px - ax);
        const d2 = (cx - bx) * (py - by) - (cy - by) * (px - bx);
        const d3 = (ax - cx) * (py - cy) - (ay - cy) * (px - cx);
        if (d1 > eps && d2 > eps && d3 > eps) free = false;
      }
      if (!free) continue;
      out.push(a, b, c);
      idx.splice(i, 1);
      cut = true;
      break;
    }
    if (!cut) break;
  }
  // Что осталось: обычно один треугольник, у вырожденного контура — веер.
  for (let i = 1; i + 1 < idx.length; i += 1) out.push(idx[0], idx[i], idx[i + 1]);
  return out;
}

/** Цвет линии сцены (`#rrggbb`, `rgb(…)`, `rgba(…)`) → `[r, g, b]` 0…255. */
export function volumeMeshColor(color, fallback = [60, 60, 60]) {
  if (Array.isArray(color)) return color;
  if (typeof color !== "string") return fallback;
  const hex = /^#([0-9a-f]{6})$/i.exec(color.trim());
  if (hex) return [1, 3, 5].map((at) => parseInt(color.trim().slice(at, at + 2), 16));
  const short = /^#([0-9a-f]{3})$/i.exec(color.trim());
  if (short) return [0, 1, 2].map((at) => parseInt(short[1][at] + short[1][at], 16));
  const list = /^rgba?\(([^)]+)\)$/i.exec(color.trim());
  if (list) {
    const parts = list[1].split(",").map((part) => Number(part));
    if (parts.length >= 3 && parts.slice(0, 3).every(Number.isFinite)) return parts.slice(0, 3);
  }
  return fallback;
}

/**
 * Грани сцены → плоские массивы трёх тел: непрозрачное (`solid`), прозрачное
 * (`clear`, цвет с альфой) и линии (`lines`, отрезками).
 *
 * `options.keep(face)` — какие грани брать (умолчание — все);
 * `options.paint(face)` — свой цвет грани `[r, g, b]` 0…255 вместо её краски;
 * `options.alpha(face)` — своя непрозрачность;
 * `options.lift(face)` — на сколько миллиметров вынести грань по её нормали.
 * Буфер глубины не разводит грани, лежащие в одной плоскости (дерево порядка
 * разводило их очередью): столешницы двух вещей на одной высоте, фигуры
 * картинки на стекле экрана. Вынос на доли миллиметра решает, кто сверху.
 * `options.sink(face)` — на сколько миллиметров утопить в пол нижние точки
 * грани (те, что у самого пола): полотно двери кончается ровно на полу, и
 * карта теней пропускала под ним полоску света из соседней комнаты (дефект
 * заказчика: «дверные проёмы внизу тоже дают артефакты»).
 * `options.shift(face)` — сдвиг грани целиком `{x, y, z}` в мм: вещь едет вся
 * разом, и щелей на её рёбрах не открывается (вынос по нормали их открывал —
 * дефект заказчика «рябь на гранях»).
 *
 * Сглаживание: у грани круглого тела (`face.smooth`, `volumeRoundWith`)
 * нормаль вершины — среднее нормалей боков, сходящихся в ней. Днище (точек
 * больше четырёх) остаётся плоским, вершина конуса — гранёной.
 */
export function volumeMeshBuild(faces, options = {}) {
  const S = VOLUME_MESH_SCALE;
  const keep = options.keep || null;
  const paint = options.paint || null;
  const alphaOf = options.alpha || null;
  const liftOf = options.lift || null;
  const shiftOf = options.shift || null;
  const sinkOf = options.sink || null;
  const tagOf = options.tag || null;
  const tags = [];
  const solid = { pos: [], nor: [], col: [] };
  const clear = { pos: [], nor: [], col: [] };
  const lines = { pos: [], col: [] };
  const smoothOf = new Map();
  const keyOf = (id, x, y, z) => id + ":" + Math.round(x) + ":" + Math.round(y) + ":" + Math.round(z);
  for (const face of faces) {
    if (!face || !face.smooth || !face.n || face.line || !face.p || face.p.length > 4) continue;
    if (keep && !keep(face)) continue;
    for (const p of face.p) {
      const key = keyOf(face.smooth, p.x, p.y, p.z);
      const sum = smoothOf.get(key) || [0, 0, 0, 0];
      sum[0] += face.n.x;
      sum[1] += face.n.y;
      sum[2] += face.n.z;
      sum[3] += 1;
      smoothOf.set(key, sum);
    }
  }
  for (const face of faces) {
    if (!face || !face.p || face.p.length < 2) continue;
    if (keep && !keep(face)) continue;
    const P = face.p;
    if (face.line || P.length < 3) {
      const rgb = (paint && paint(face)) || volumeMeshColor(face.color || face.rgb);
      const c = [volumeMeshLinear(rgb[0] / 255), volumeMeshLinear(rgb[1] / 255), volumeMeshLinear(rgb[2] / 255)];
      const last = face.closed ? P.length : P.length - 1;
      for (let i = 0; i < last; i += 1) {
        const a = P[i];
        const b = P[(i + 1) % P.length];
        lines.pos.push(a.x * S, a.z * S, a.y * S, b.x * S, b.z * S, b.y * S);
        lines.col.push(c[0], c[1], c[2], c[0], c[1], c[2]);
      }
      continue;
    }
    // Нормаль — у сцены; нет её — по Ньюэллу (у невыпуклого контура первые три
    // точки могут обмануть).
    let nx = 0;
    let ny = 0;
    let nz = 0;
    if (face.n) {
      nx = face.n.x;
      ny = face.n.y;
      nz = face.n.z;
    } else {
      for (let i = 0; i < P.length; i += 1) {
        const p = P[i];
        const q = P[(i + 1) % P.length];
        nx += (p.y - q.y) * (p.z + q.z);
        ny += (p.z - q.z) * (p.x + q.x);
        nz += (p.x - q.x) * (p.y + q.y);
      }
    }
    const nl = Math.hypot(nx, ny, nz);
    if (!(nl > 0)) continue;
    nx /= nl;
    ny /= nl;
    nz /= nl;
    let tri;
    if (P.length === 3) tri = [0, 1, 2];
    else if (P.length === 4) tri = [0, 1, 2, 0, 2, 3];
    else {
      // Плоские оси грани: выбрасывается та ось, вдоль которой нормаль длиннее.
      const ax = Math.abs(nx);
      const ay = Math.abs(ny);
      const az = Math.abs(nz);
      const xy = [];
      for (const p of P) {
        if (az >= ax && az >= ay) xy.push(p.x, p.y);
        else if (ax >= ay) xy.push(p.y, p.z);
        else xy.push(p.x, p.z);
      }
      tri = volumeMeshEarcut(xy);
    }
    const rgb = (paint && paint(face)) || face.rgb || [60, 60, 60];
    const c = [volumeMeshLinear(rgb[0] / 255), volumeMeshLinear(rgb[1] / 255), volumeMeshLinear(rgb[2] / 255)];
    const own = alphaOf ? alphaOf(face) : null;
    const alpha = own !== null && own !== undefined ? own : face.clear ? (typeof face.alpha === "number" ? face.alpha : 0.4) : typeof face.alpha === "number" ? face.alpha : 1;
    const into = alpha < 1 ? clear : solid;
    const smooth = Boolean(face.smooth && face.n && P.length <= 4);
    const lift = liftOf ? Number(liftOf(face)) || 0 : 0;
    const shift = (shiftOf && shiftOf(face)) || null;
    const sx = nx * lift + (shift ? shift.x : 0);
    const sy = ny * lift + (shift ? shift.y : 0);
    const sz = nz * lift + (shift ? shift.z : 0);
    // Изнанка крашеного потолка — крыша: она держит цвет сборки (`backRgb`),
    // как и в кадре Canvas 2D (`volumeFacePolygons`).
    const back = face.backRgb
      ? [volumeMeshLinear(face.backRgb[0] / 255), volumeMeshLinear(face.backRgb[1] / 255), volumeMeshLinear(face.backRgb[2] / 255)]
      : c;
    const sink = sinkOf ? Number(sinkOf(face)) || 0 : 0;
    const tag = tagOf ? Number(tagOf(face)) || 0 : 0;
    const emit = (p, sign) => {
      into.pos.push((p.x + sx) * S, (p.z + sz - (sink > 0 && p.z < 5 && p.z > -5 ? sink : 0)) * S, (p.y + sy) * S);
      let vx = nx;
      let vy = ny;
      let vz = nz;
      if (smooth) {
        const sum = smoothOf.get(keyOf(face.smooth, p.x, p.y, p.z));
        if (sum && sum[3] >= 2 && sum[3] <= 4) {
          const len = Math.hypot(sum[0], sum[1], sum[2]);
          if (len > 0.2) {
            vx = sum[0] / len;
            vy = sum[1] / len;
            vz = sum[2] / len;
          }
        }
      }
      into.nor.push(vx * sign, vz * sign, vy * sign);
      if (tagOf && into === solid) tags.push(tag);
      const tone = sign < 0 ? back : c;
      if (into === clear) into.col.push(tone[0], tone[1], tone[2], alpha);
      else into.col.push(tone[0], tone[1], tone[2]);
    };
    for (let i = 0; i < tri.length; i += 3) {
      const a = P[tri[i]];
      const b = P[tri[i + 1]];
      const d = P[tri[i + 2]];
      // Обход в осях сетки: нормаль треугольника (в осях чертежа) против
      // нормали грани. Оси сетки — отражение, поэтому знак обратный.
      const ux = b.x - a.x;
      const uy = b.y - a.y;
      const uz = b.z - a.z;
      const wx = d.x - a.x;
      const wy = d.y - a.y;
      const wz = d.z - a.z;
      const dot = (uy * wz - uz * wy) * nx + (uz * wx - ux * wz) * ny + (ux * wy - uy * wx) * nz;
      if (Math.abs(dot) < 1e-9) continue;
      // В осях чертежа обход «по нормали» — dot > 0; после отражения он
      // становится обратным, и лицом к нормали смотрит порядок a, d, b.
      const front = dot > 0 ? [a, d, b] : [a, b, d];
      for (const p of front) emit(p, 1);
      // Двусторонняя грань (полотно двери, рама, крыша над потолком) — вторым
      // лицом с обратной нормалью. Прозрачное тело рисуется с обеих сторон само.
      if (face.both && into === solid) for (const p of [front[0], front[2], front[1]]) emit(p, -1);
    }
  }
  return {
    // `tag` — число на вершину (`options.tag(face)`): номер помещения грани для света лент.
    solid: { pos: new Float32Array(solid.pos), nor: new Float32Array(solid.nor), col: new Float32Array(solid.col), ...(tagOf ? { tag: new Float32Array(tags) } : {}) },
    clear: { pos: new Float32Array(clear.pos), nor: new Float32Array(clear.nor), col: new Float32Array(clear.col) },
    lines: { pos: new Float32Array(lines.pos), col: new Float32Array(lines.col) },
    triangles: (solid.pos.length + clear.pos.length) / 9,
  };
}

/**
 * Горящие источники света для видеокарты: по источнику на лампу (у ленты — на
 * каждый её кусок, `volumeLampSources`), сила — мощность лампы на её яркость.
 * `light` — ответ `volumeLiveLight`: он уже знает, что горит и с какой силой.
 */
export function volumeMeshLamps(scene, light, live = null) {
  const out = [];
  // Висячий светильник (источник заметно ниже потолка — люстра на подвесе)
  // светит во все стороны, а не конусом вниз: потолок над ним освещён
  // (слово заказчика: «потолок тоже должен освещаться»).
  const ceilingMm = Number(scene && scene.heightMm) || 0;
  if (!scene || !light || !light.lamps) return out;
  for (const [markId, strength] of light.lamps) {
    if (!(strength > 0)) continue;
    const item = live ? live.get(markId) : null;
    const rgb = (light.colors && light.colors.get(markId)) || VOLUME_LAMP_LIGHT_RGB;
    // Люстра светит во все стороны, как бы высоко её ни повесили.
    const place = volumeMarkPlace(scene, markId);
    const chandelier = Boolean(place && place.view && place.view.name === "chandelier");
    // Лента и трек (источник на каждом метре): конусами они светили бы
    // пятнами через метр-полтора (дефект заказчика: «почему ленты светят
    // пятнами?»), да и конусов у видеокарты восемь. Куски ленты помечаются
    // `line`: в конусы они не идут, а светят отражённым светом комнаты и
    // полосой свечения вдоль себя (`volumeMeshGlowStrips`).
    const sources = volumeLampSourcesOf(scene, markId, item ? item.roomId : undefined);
    const line = sources.length >= 3 ? String(markId) : null;
    for (const source of sources) {
      if (!source || !source.at || !(source.power > 0)) continue;
      // Настенный светильник (правка 2026-11-21, дефект заказчика: «странно бра
      // светят»): источник сцены стоит в трёх сантиметрах от стены — точечный
      // свет оттуда даёт яркую кляксу на стене и больше ничего. Видеокарте он
      // отодвигается от стены. Маленький настенный (подсветка картины, `beam`
      // меньше единицы) светит не во все стороны, а конусом вниз вдоль стены —
      // на картину под ним (`aim`).
      const wall = source.wall || null;
      // Бра «вверх и вниз» (правка 2026-11-21, слова заказчика: «Бра сделай
      // которые светят вверх и вниз»): вместо источника во все стороны — два
      // узких конуса вдоль стены, к потолку и к полу; сила делится пополам.
      // Каждый стоит чуть за торцом кубика и целит в стену поодаль: так на
      // стене ложится вытянутый клин, а не круг.
      if (wall && source.updown === true) {
        for (const sign of [1, -1]) {
          out.push({
            x: source.at.x + wall.x * VOLUME_MESH_UPDOWN_OUT_MM,
            y: source.at.y + wall.y * VOLUME_MESH_UPDOWN_OUT_MM,
            z: source.at.z + sign * VOLUME_MESH_UPDOWN_START_MM,
            wall: true,
            narrow: true,
            aim: {
              x: source.at.x - wall.x * VOLUME_MESH_UPDOWN_IN_MM,
              y: source.at.y - wall.y * VOLUME_MESH_UPDOWN_IN_MM,
              z: source.at.z + sign * VOLUME_MESH_UPDOWN_REACH_MM,
            },
            power: (source.power * strength) / 2,
            down: true,
            hang: false,
            room: source.room || null,
            rgb,
          });
        }
        continue;
      }
      const wash = Boolean(wall) && Number(source.beam) < 1;
      const off = wall ? (wash ? VOLUME_MESH_WASH_OUT_MM : VOLUME_MESH_WALL_OUT_MM) : 0;
      out.push({
        x: source.at.x + (wall ? wall.x * off : 0),
        y: source.at.y + (wall ? wall.y * off : 0),
        z: source.at.z,
        ...(wall ? { wall: true } : {}),
        ...(line ? { line } : {}),
        ...(wash ? { aim: { x: source.at.x - wall.x * 20, y: source.at.y - wall.y * 20, z: source.at.z - VOLUME_MESH_WASH_DROP_MM } } : {}),
        power: source.power * strength,
        down: wash || Boolean(source.dir && source.dir.z < 0) && !chandelier && !(ceilingMm > 0 && source.at.z < ceilingMm - VOLUME_MESH_HANG_MM),
        hang: Boolean(source.dir && source.dir.z < 0) && (chandelier || (ceilingMm > 0 && source.at.z < ceilingMm - VOLUME_MESH_HANG_MM)),
        room: source.room || null,
        rgb,
      });
    }
  }
  return out;
}

/** Соседние источники одного помещения и одного вида сливаются в один, по силе. */
export function volumeMeshLampJoin(lamps) {
  const out = [];
  for (const lamp of lamps) {
    // Настенные не сливаются: у каждого бра своё пятно на своей стене.
    const near = lamp.wall ? null : out.find(
      (item) =>
        !item.wall &&
        item.room === lamp.room &&
        item.down === lamp.down &&
        Math.hypot(item.x - lamp.x, item.y - lamp.y) < VOLUME_MESH_LAMP_JOIN_MM,
    );
    if (!near) {
      out.push({ ...lamp, rgb: [...lamp.rgb] });
      continue;
    }
    const sum = near.power + lamp.power;
    near.x = (near.x * near.power + lamp.x * lamp.power) / sum;
    near.y = (near.y * near.power + lamp.y * lamp.power) / sum;
    near.z = (near.z * near.power + lamp.z * lamp.power) / sum;
    near.rgb = [0, 1, 2].map((at) => (near.rgb[at] * near.power + lamp.rgb[at] * lamp.power) / sum);
    near.power = sum;
    near.hang = near.hang || lamp.hang;
  }
  return out;
}

/**
 * Какие источники достаются видеокарте: ближайшие к глазу, порознь «вниз»
 * (потолочные — конусом) и «во все стороны» (настенные, напольные).
 * `fill` — отражённый свет: слабый источник в середине горящего, без него
 * потолок над лампами чёрный.
 */
export function volumeMeshLampPick(lamps, eye, limits = { spots: 8, points: 3 }) {
  const ribbons = lamps.filter((item) => item.line);
  const joined = volumeMeshLampJoin(lamps.filter((item) => !item.line));
  const near = (down) =>
    joined
      .filter((item) => item.down === down)
      .map((item) => ({ item, d: (item.x - eye.x) ** 2 + (item.y - eye.y) ** 2 }))
      .sort((one, two) => one.d - two.d)
      .map((entry) => entry.item);
  const spots = near(true).slice(0, limits.spots);
  const points = near(false).slice(0, limits.points);
  let fx = 0;
  let fy = 0;
  let power = 0;
  // Отражённый свет — у **ближайшего горящего помещения**: середина ламп
  // разных комнат пришлась бы в стену или к соседям, а сквозь стены он теперь
  // не ходит (у источника тень).
  const lead = spots[0] && points[0] ? ((spots[0].x - eye.x) ** 2 + (spots[0].y - eye.y) ** 2 <= (points[0].x - eye.x) ** 2 + (points[0].y - eye.y) ** 2 ? spots[0] : points[0]) : spots[0] || points[0] || ribbons.slice().sort((one, two) => (one.x - eye.x) ** 2 + (one.y - eye.y) ** 2 - ((two.x - eye.x) ** 2 + (two.y - eye.y) ** 2))[0] || null;
  for (const item of [...spots, ...points]) {
    if (lead && item.room !== lead.room) continue;
    // Настенные в отражённый свет не идут: его середина легла бы на стену.
    if (item.wall) continue;
    fx += item.x * item.power;
    fy += item.y * item.power;
    power += item.power;
  }
  return { spots, points, fill: power > 0 ? { x: fx / power, y: fy / power, power } : null, total: joined.length };
}

/**
 * Вынос грани вещи по нормали, мм: у каждой вещи свой, по её номеру, — две
 * вещи с гранями в одной плоскости расходятся на доли миллиметра, и спора в
 * буфере глубины нет. Одна и та же вещь выносится целиком и одинаково.
 */
export function volumeMeshThingLift(face) {
  const id = face && face.thing !== undefined && face.thing !== null ? Number(face.thing) : NaN;
  return Number.isFinite(id) ? 0.1 + (Math.abs(id) % 7) * 0.12 : 0;
}

/**
 * Сдвиг вещи целиком, мм: тем же числом по всем трём осям, со знаками по номеру
 * вещи. Грани двух вещей в одной плоскости расходятся, а сама вещь остаётся
 * целой — её грани едут вместе, и щелей на рёбрах нет.
 */
export function volumeMeshThingShift(face) {
  const id = face && face.thing !== undefined && face.thing !== null ? Number(face.thing) : NaN;
  if (!Number.isFinite(id)) return null;
  const size = volumeMeshThingLift(face);
  const n = Math.abs(Math.trunc(id));
  return { x: n & 1 ? size : -size, y: n & 2 ? size : -size, z: size };
}

/**
 * Вынос фигур картинки (экран, полотно): они лежат в одной плоскости друг на
 * друге, и порядок записи — порядок слоёв. `volumeMeshArtLift()` отдаёт
 * счётчик на одну сборку сетки: каждая следующая фигура — на 0,3 мм выше.
 */
export function volumeMeshArtLift(baseMm = 1) {
  let count = 0;
  return (face) => {
    if (!face || !face.art) return 0;
    count += 1;
    return baseMm + count * 0.3;
  };
}

/** Полоса свечения ленты: на сколько она расходится в каждую сторону, мм. */
export const VOLUME_MESH_GLOW_WIDTH_MM = 520;

/**
 * Полосы свечения вдоль горящих лент и треков: `{pos, col}` — треугольники с
 * цветом и прозрачностью в вершинах (у ленты ярко, к краю — ноль). Кладутся на
 * ту поверхность, по которой идёт лента, чуть ниже неё; рисуются сложением.
 * Это не источник света, а его след: ровная светлая полоса вместо пятен.
 */
export function volumeMeshGlowStrips(lamps) {
  const S = VOLUME_MESH_SCALE;
  const pos = [];
  const col = [];
  const byLine = new Map();
  for (const item of lamps || []) {
    if (!item.line) continue;
    if (!byLine.has(item.line)) byLine.set(item.line, []);
    byLine.get(item.line).push(item);
  }
  const W = VOLUME_MESH_GLOW_WIDTH_MM;
  for (const list of byLine.values()) {
    for (let at = 0; at + 1 < list.length; at += 1) {
      const a = list[at];
      const b = list[at + 1];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const flat = Math.hypot(dx, dy);
      // Разрыв (другой отрезок той же метки) и отвесный кусок — без полосы.
      if (!(flat > 50) || Math.hypot(dx, dy, b.z - a.z) > 1700) continue;
      const px = (-dy / flat) * W;
      const py = (dx / flat) * W;
      const c = [volumeMeshLinear(a.rgb[0] / 255), volumeMeshLinear(a.rgb[1] / 255), volumeMeshLinear(a.rgb[2] / 255)];
      const glow = Math.max(0.12, Math.min(0.34, 0.14 + ((a.power + b.power) / 2) * 0.4));
      const za = a.z - 14;
      const zb = b.z - 14;
      for (const side of [1, -1]) {
        const quad = [
          [a.x, a.y, za, glow],
          [b.x, b.y, zb, glow],
          [b.x + px * side, b.y + py * side, zb, 0],
          [a.x + px * side, a.y + py * side, za, 0],
        ];
        for (const index of [0, 1, 2, 0, 2, 3]) {
          const q = quad[index];
          pos.push(q[0] * S, q[2] * S, q[1] * S);
          col.push(c[0], c[1], c[2], q[3]);
        }
      }
    }
  }
  return { pos: new Float32Array(pos), col: new Float32Array(col) };
}

/**
 * Ленты и треки отрезками — настоящими источниками света (слово заказчика:
 * «это полноценные источники света могут быть»). Соседние куски одной метки,
 * лежащие на одной прямой, сливаются в один отрезок: `{a, b, rgb, power, room}`,
 * `power` — сила на метр. Светит отрезок своим помещением (`room`), поэтому
 * сквозь стены свет не идёт и без карты теней.
 */
export function volumeMeshRibbonSegments(lamps) {
  const out = [];
  const byLine = new Map();
  for (const item of lamps || []) {
    if (!item.line) continue;
    const key = item.line + "|" + (item.room || "");
    if (!byLine.has(key)) byLine.set(key, []);
    byLine.get(key).push(item);
  }
  for (const list of byLine.values()) {
    let run = null;
    for (let at = 0; at + 1 < list.length; at += 1) {
      const a = list[at];
      const b = list[at + 1];
      const d = [b.x - a.x, b.y - a.y, b.z - a.z];
      const length = Math.hypot(d[0], d[1], d[2]);
      if (!(length > 50) || length > 1700) {
        run = null;
        continue;
      }
      const dir = d.map((value) => value / length);
      if (run && run.dir[0] * dir[0] + run.dir[1] * dir[1] + run.dir[2] * dir[2] > 0.995 && run.length < 6000) {
        run.seg.b = { x: b.x, y: b.y, z: b.z };
        run.length += length;
        continue;
      }
      const seg = { a: { x: a.x, y: a.y, z: a.z }, b: { x: b.x, y: b.y, z: b.z }, rgb: a.rgb, power: (a.power + b.power) / 2, room: a.room || null };
      out.push(seg);
      run = { seg, dir, length };
    }
  }
  return out;
}
