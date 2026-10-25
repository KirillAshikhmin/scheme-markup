// «Объём»: стены — грани по чертежу, усы на углах, проёмы: двери, окна,
// створки, ручки, откосы.
//
// Часть «Объёма», вынесенная из `src/volume.js` (2026-10-25) переносом без
// переименований: снаружи модуль читают через дверь `volume.js`, а соседи по
// `src/volume/` — напрямую. Зависимости идут только вниз по слоям (порядок —
// в шапке `volume.js`), циклов нет. Решения и доводы — в шапках разделов ниже.
import {
  OPENING_GLASS_FRAME_MM,
  openingArchDropMm,
  openingArchGeometry,
  openingFaceGrid,
  openingFamilyOf,
  openingFoldLinks,
  openingGlazed,
  openingHasLeaf,
  openingLeavesOf,
  openingMotionOf,
  openingOpens,
  openingSlatted,
  openingVentCell,
  openingVents,
  openingWalkThrough,
  wallHeightMm,
  wallPaintOf,
  wallVectors,
} from "../model.js";
import {
  VOLUME_DOOR_RGB,
  VOLUME_FLOOR_RGB,
  VOLUME_FRAME_RGB,
  VOLUME_GLASS_RGB,
  VOLUME_HANDLE_RGB,
  VOLUME_LINTEL_MM,
  VOLUME_MITER_EPS,
  VOLUME_MITER_MAX,
  VOLUME_STEP_MM,
  VOLUME_WALL_RGB,
} from "./measures.js";
import { volumeAt, volumeFace, volumePaintRgb, volumePainted } from "./faces.js";
import {
  VOLUME_SUN_PROBE_MM,
  volumeBoxCorners,
  volumePointInside,
  volumePrismFaces,
  volumeRoomKeyAt,
} from "./shapes.js";
import { volumeMiddleOf } from "./order.js";

// ——— стена ———————————————————————————————————————————————————————————————

/**
 * Краска стороны стены гранью (покраска, правка без автопилота): `sign` —
 * `1` у левой стороны (нормаль `n`), `−1` у правой, как у `volumeWallFaces`;
 * `null` — не крашено. Хозяин краски — объект (`wallPaintOf`).
 */
export function volumeWallPaintRgb(wall, sign) {
  if (!(sign === 1 || sign === -1)) return null;
  return volumePaintRgb(wallPaintOf(wall, sign > 0 ? "left" : "right"));
}

/**
 * Проём, через который проходят. Решает **геометрия, а не вид**: низ не выше
 * порога — переступили. Окно исключено отдельно и нарочно: оно застеклено, и
 * панорамное окно до пола держит так же, как стена под обычным.
 */
export function volumeOpeningWalkable(opening) {
  // Сквозь что ходят, решает модель (`openingWalkThrough`): сквозь окно любого
  // вида — нет, сквозь дверь, проём, арку и ворота — да. Сравнения с `"window"`
  // здесь больше нет нарочно: витраж в пол и балконное остекление (таск 215)
  // стоят от пола, и забытое сравнение пустило бы человека сквозь стекло.
  if (!opening || !openingWalkThrough(opening.kind)) return false;
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
 * Низкие перемычки над проёмами (G234): препятствие **над** дырой, которое
 * держит стоящего и пропускает присевшего.
 *
 * Зачем оно вообще: проём, через который проходят, вырезан из препятствий
 * целиком (`volumeWallSolids`) — то есть лаз высотой в метр до таска 159
 * пропускал человека в полный рост. Заказчик назвал проём среди низких мест,
 * где «встать нельзя», и перемычка — это он же, только посчитанный.
 *
 * Порог отбора — `VOLUME_LINTEL_MM`, и он нарочно много ниже макушки: см. там.
 */
export function volumeWallLintels(openings, wallHeightMm) {
  const out = [];
  for (const opening of openings || []) {
    if (!volumeOpeningWalkable(opening)) continue;
    const bottom = Math.max(0, Number(opening.heightAboveFloorMm) || 0);
    const top = bottom + (Number(opening.heightMm) || 0);
    if (!(top > 0)) continue;
    const fromMm = Number(opening.atMm) || 0;
    const toMm = fromMm + (Number(opening.widthMm) || 0);
    if (!(toMm > fromMm)) continue;
    const ceiling = Math.max(top, Number(wallHeightMm) || top);
    // **У арки просвет считается по дуге** (дефект D71). Прежде перемычка
    // спрашивала один верх проёма на всю ширину, и у арки 1200 × 2100 выходило,
    // что препятствия нет вовсе: 2100 выше порога. А у косяков просвет там
    // 1500 — ниже порога, то есть пройти под пятой в полный рост нельзя, и
    // голова должна её задевать. Дуга берётся **та же**, которой стена садится
    // на свод (`volumeArchSpan` → `openingArchDropMm`), второго счёта у арки
    // нет.
    //
    // Препятствие остаётся прямой призмой — иначе его пришлось бы учить кривым,
    // — поэтому дуга режется на те же `VOLUME_ARCH_SEGMENTS` кусков, и у каждого
    // берётся **низшая** из его двух высот: лучше пригнуться на вершок раньше,
    // чем пройти головой сквозь кладку. Куски, под которыми и так проходят в
    // рост, не заводятся вовсе — у арки 1200 × 2100 это восемь средних из
    // двенадцати.
    const span = volumeArchSpan(opening, fromMm, toMm, top, bottom);
    if (span) {
      for (let index = 0; index < span.length - 1; index += 1) {
        const left = span[index];
        const right = span[index + 1];
        const low = Math.min(left.zMm, right.zMm);
        if (low >= VOLUME_LINTEL_MM) continue;
        out.push({
          fromMm: left.alongMm,
          toMm: right.alongMm,
          bottomMm: low,
          topMm: Math.max(low, ceiling),
        });
      }
      continue;
    }
    if (top >= VOLUME_LINTEL_MM) continue;
    out.push({ fromMm, toMm, bottomMm: top, topMm: ceiling });
  }
  return out;
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
      // **Пазухи арки** (таск 219, G329): над дугой стена не кончается по
      // прямой — у косяков она спускается до пяты, и эти два серпа и есть то,
      // чем арка отличается от проёма. Нарезаются они трапециями по дуге, а не
      // одним вогнутым многоугольником: дерево порядка (таск 151) режет грани
      // плоскостями соседей и выпуклости от них не требует, но вогнутая грань
      // ему досталась бы одной штукой на весь серп — и легла бы поверх того,
      // что видно сквозь саму арку.
      const span = volumeArchSpan(opening, from, to, top, bottom);
      if (span) {
        for (let index = 0; index < span.length - 1; index += 1) {
          const left = span[index];
          const right = span[index + 1];
          const low = Math.min(left.zMm, right.zMm);
          if (!(heightMm > low)) continue;
          tiles.push({
            fromMm: left.alongMm,
            toMm: right.alongMm,
            bottomMm: low,
            topMm: heightMm,
            bottomFromMm: left.zMm,
            bottomToMm: right.zMm,
          });
        }
      } else if (heightMm > top) {
        tiles.push({ fromMm: from, toMm: to, bottomMm: top, topMm: heightMm });
      }
    }
    cursor = Math.max(cursor, to);
  }
  if (lengthMm > cursor) tiles.push({ fromMm: cursor, toMm: lengthMm, bottomMm: 0, topMm: heightMm });
  return tiles.filter((tile) => tile.toMm > tile.fromMm && tile.topMm > tile.bottomMm);
}

/** Во сколько отрезков режется дуга арки: и свод, и пазухи, и ничего больше. */
export const VOLUME_ARCH_SEGMENTS = 12;

/**
 * Дуга арки ломаной вдоль стены: `{alongMm, zMm}` от косяка до косяка.
 *
 * `null` — у вида прямой верх или дуге негде встать (просвет ниже её подъёма).
 * Числа берутся у модели (`openingArchGeometry` и `openingArchDropMm`) — теми
 * же, какими дугу рисует лист развёртки: второй формы у арки быть не должно.
 */
function volumeArchSpan(opening, from, to, top, bottom) {
  const arch = openingArchGeometry(opening);
  if (!arch) return null;
  if (!(top - bottom > arch.riseMm)) return null;
  const points = [];
  for (let index = 0; index <= VOLUME_ARCH_SEGMENTS; index += 1) {
    const part = index / VOLUME_ARCH_SEGMENTS;
    points.push({ alongMm: from + (to - from) * part, zMm: top - openingArchDropMm(opening, part) });
  }
  return points;
}

/**
 * **Просвет проёма ломаной** — `{alongMm, zMm}` по кругу, от левого косяка.
 *
 * Один ответ на вопрос «через что именно проходит свет» (дефект D71): у вида с
 * прямым верхом четыре точки, у арки — откосы и дуга той же `volumeArchSpan`,
 * которой стена садится на свод. До этого таска солнце считало арку
 * прямоугольником, и пятно выходило шире настоящего на две пазухи.
 *
 * Выпуклый и у того и у другой: дуга идёт наружу, и прямая низа её замыкает.
 * На это опирается обрезка комнатой (`volumeClipPolygon` требует выпуклости
 * отсекающего) — заведись здесь вогнутое лицо, обрезку пришлось бы менять.
 */
export function volumeOpeningFaceMm(opening, fromMm, toMm, bottomMm, topMm) {
  const face = [
    { alongMm: fromMm, zMm: bottomMm },
    { alongMm: toMm, zMm: bottomMm },
  ];
  const span = volumeArchSpan(opening, fromMm, toMm, topMm, bottomMm);
  if (span) {
    for (let index = span.length - 1; index >= 0; index -= 1) face.push(span[index]);
    return face;
  }
  face.push({ alongMm: toMm, zMm: topMm }, { alongMm: fromMm, zMm: topMm });
  return face;
}

// ——— ус на углу стен (G265, таск 178) ————————————————————————————————————
//
// Слова заказчика: «Внешние углы под 90 градусов в стенах сделай так же как
// пофиксил столешницу». Столешница — полоса вещи чертежа, починенная усом по
// биссектрисе в таске 169 (дефект D38), и беда у стен ровно та же.
//
// **Что было видно.** Стена рисуется коробкой с поперечными торцами по своей
// оси. Две стены, сошедшиеся в вершине под 90°, кладут эти коробки крест-накрест:
// квадрат со стороной в полтолщины с **внутренней** стороны угла покрыт дважды,
// а такой же квадрат с **внешней** — не покрыт вовсе. На стене 100 мм это
// квадрат 50 × 50 мм: снаружи дома в углу зияет вырез, сквозь который видно
// землю и нутро стены, а внутри комнаты по углу идёт шов.
//
// **Чем стены отличаются от полосы.** У полосы вершины идут цепочкой: у звена
// всегда ровно один сосед с каждой стороны, и ширина у всей полосы одна. Стены
// — отдельные сущности: в вершине может сойтись три стены и больше, у соседок
// бывает разная толщина и разная высота, а конец стены может упираться в
// середину чужой. Поэтому ус ставится только там, где стык **однозначен**:
//
//   1. в вершине ровно **два** конца стен — тройник и крест пропускаются: у
//      них нет одной биссектрисы, и какую пару сводить, сказать нечем;
//   2. **высоты соседок равны** — иначе ус срезал бы торец, а над соседкой
//      осталась бы дыра во всю разницу высот;
//   3. стены **не вдоль одной прямой** — у развёрнутых на 180° кромки
//      параллельны и не пересекаются вовсе (стык и так чистый);
//   4. ус не длиннее `VOLUME_MITER_MAX` полутолщин — то же число и та же
//      причина, что у полосы (D38): на острых углах ус уходит в бесконечность;
//   5. ус короче самой стены — у стены в ладонь длиной оба уса съели бы её
//      целиком и вывернули бы грани наизнанку.
//
// Толщины при этом могут быть **разными**: кромка каждой стены кончается там,
// где встречает соответствующую кромку соседки, и обе стены считают эту точку
// одинаково — стык выходит общим и без уговора между ними.
//
// **Препятствие не меняется** — ровно как в D38: `volumeWallSolids` остаётся
// прямоугольником по оси. Цена названа прямо: внешний клин угла теперь
// нарисован, но не держит; на стене 100 мм это треугольник с катетами 50 мм,
// вдвое меньше радиуса тела, и дотянуться до него человек всё равно не может —
// его держит сама стена.

/** Какая кромка соседки отвечает кромке `side` этой стены. Ноль — вдоль одной прямой. */
function volumeMiterSide(side, hereN, hereAway, thereN, thereAway) {
  const here = hereN.x * thereAway.x + hereN.y * thereAway.y;
  const there = thereN.x * hereAway.x + thereN.y * hereAway.y;
  if (Math.abs(here) < VOLUME_MITER_EPS || Math.abs(there) < VOLUME_MITER_EPS) return 0;
  return side * Math.sign(here) * Math.sign(there);
}

/**
 * Где кончается кромка `side` стены, сходящейся с соседкой: отступ вдоль оси от
 * общей вершины, в её сторону. Отрицательный — кромка уходит **за** вершину,
 * то есть наружу угла. `null` — ус неприменим.
 */
function volumeMiterReach(side, here, there) {
  const sideThere = volumeMiterSide(side, here.n, here.away, there.n, there.away);
  if (sideThere === 0) return null;
  const turn = here.away.x * there.away.y - here.away.y * there.away.x;
  if (Math.abs(turn) < VOLUME_MITER_EPS) return null;
  const from = { x: here.n.x * side * here.half, y: here.n.y * side * here.half };
  const to = { x: there.n.x * sideThere * there.half, y: there.n.y * sideThere * there.half };
  const gap = { x: to.x - from.x, y: to.y - from.y };
  const reach = (gap.x * there.away.y - gap.y * there.away.x) / turn;
  const limit = VOLUME_MITER_MAX * here.half;
  return Math.max(-limit, Math.min(limit, reach));
}

/**
 * Усы на концах стен: `Map` по идентификатору стены →
 * `{start: {left, right} | null, end: {left, right} | null}`, где числа —
 * координаты вдоль оси стены, на которых кончаются её левая и правая кромки.
 * Без уса это 0 и длина.
 *
 * `heightOf(wall)` — высота стены в сцене: ус ставится только между стенами
 * одной высоты (см. разбор выше).
 */
export function volumeWallMiters(walls, heightOf = () => 0) {
  const list = [];
  for (const wall of walls || []) {
    const vectors = wallVectors(wall);
    if (!vectors) continue;
    list.push({ wall, vectors, half: Math.abs(Number(wall.thicknessMm) || 0) / 2 });
  }
  const atCorner = new Map();
  const keyOf = (point) => Math.round(Number(point.x)) + "," + Math.round(Number(point.y));
  list.forEach((item, index) => {
    for (const end of ["a", "b"]) {
      const key = keyOf(end === "a" ? item.wall.aMm : item.wall.bMm);
      if (!atCorner.has(key)) atCorner.set(key, []);
      atCorner.get(key).push({ index, end });
    }
  });
  const miters = new Map();
  const seatOf = (index) => {
    const id = list[index].wall.id;
    if (!miters.has(id)) miters.set(id, { start: null, end: null });
    return miters.get(id);
  };
  const faceOf = (item, end) => ({
    n: item.vectors.n,
    half: item.half,
    // Куда стена уходит от общей вершины.
    away: end === "a" ? item.vectors.u : { x: -item.vectors.u.x, y: -item.vectors.u.y },
  });
  for (const ends of atCorner.values()) {
    if (ends.length !== 2) continue;
    const [one, two] = ends;
    if (one.index === two.index) continue;
    const here = list[one.index];
    const there = list[two.index];
    if (!(here.half > 0) || !(there.half > 0)) continue;
    if (Math.abs(Number(heightOf(here.wall)) - Number(heightOf(there.wall))) > 1) continue;
    const hereFace = faceOf(here, one.end);
    const thereFace = faceOf(there, two.end);
    const cut = (item, face, other, end) => {
      const left = volumeMiterReach(1, face, other);
      const right = volumeMiterReach(-1, face, other);
      if (left === null || right === null) return null;
      // Ус длиннее стены: вывернул бы её грани наизнанку — оставляем торец.
      if (Math.max(Math.abs(left), Math.abs(right)) >= item.vectors.len) return null;
      return end === "a"
        ? { left, right }
        : { left: item.vectors.len - left, right: item.vectors.len - right };
    };
    const first = cut(here, hereFace, thereFace, one.end);
    const second = cut(there, thereFace, hereFace, two.end);
    if (!first || !second) continue;
    seatOf(one.index)[one.end === "a" ? "start" : "end"] = first;
    seatOf(two.index)[two.end === "a" ? "start" : "end"] = second;
  }
  return miters;
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
export function volumeWallFaces(wall, openings, heightMm, out = [], openDoorIds = null, miter = null, rooms = null) {
  const vectors = wallVectors(wall);
  if (!vectors || !(heightMm > 0)) return out;
  const half = Number(wall.thicknessMm) / 2;
  const { u, n, len } = vectors;
  const at = (along, across) => ({
    x: Number(wall.aMm.x) + u.x * along + n.x * across,
    y: Number(wall.aMm.y) + u.y * along + n.y * across,
  });
  // Ус на углу (G265): кромка кончается не поперёк оси, а там, где встречает
  // кромку соседки. Без соседки числа те же, что были, — 0 и длина.
  const startOf = (side) => (miter && miter.start ? (side > 0 ? miter.start.left : miter.start.right) : 0);
  const endOf = (side) => (miter && miter.end ? (side > 0 ? miter.end.left : miter.end.right) : len);
  for (const side of [1, -1]) {
    const normal = { x: n.x * side, y: n.y * side, z: 0 };
    const sideName = side > 0 ? "left" : "right";
    // Сторона стены — **один** многоугольник на кусок между проёмами. Метровой
    // сетки, которой она резалась в тасках 148–150 ради порядка рисования,
    // больше нет: порядок выкладывает дерево (`volumeOrderTree`), а вещь стоит
    // перед плоскостью стены на два миллиметра — этого дереву довольно.
    // Чья это сторона (таск 09 сценариев): щуп в полутора сантиметрах от
    // грани — тот же, которым солнце ищет комнату (`volumeInnerSide`).
    // Наружная сторона — улица, ничья. Помещение у стороны меняется вдоль
    // стены (`volumeSideStops`), и кусок между проёмами режется ещё и там.
    const known = rooms && rooms.length > 0;
    const paint = volumeWallPaintRgb(wall, side);
    const stops = known ? volumeSideStops(wall, side, rooms) : [];
    const roomAt = (along) => (known ? volumeRoomKeyAt(rooms, at(along, (half + VOLUME_SUN_PROBE_MM) * side)) : null);
    for (const tile of volumeWallTiles(len, heightMm, openings)) {
      // Наклонный низ (пазухи арки) режется только проёмом: куски у арки
      // короткие, и помещение у них одно.
      const sloped = tile.bottomFromMm != null || tile.bottomToMm != null;
      const parts = sloped
        ? [{ fromMm: tile.fromMm, toMm: tile.toMm, room: roomAt((tile.fromMm + tile.toMm) / 2) }]
        : volumeSideParts(tile.fromMm, tile.toMm, stops, roomAt);
      for (const part of parts) {
        // Крайние куски стороны дотягиваются до уса: внутренняя кромка угла
        // отступает, внешняя выходит за вершину — и обе кончаются там же, где
        // кромки соседки.
        const from = at(part.fromMm === 0 ? startOf(side) : part.fromMm, half * side);
        const to = at(part.toMm === len ? endOf(side) : part.toMm, half * side);
        // Нижняя кромка куска бывает наклонной — так стена садится на дугу арки
        // (таск 219). У прямого куска оба угла на одной высоте, и кадр прежних
        // стен от этого не меняется ни на грань.
        const bottomFrom = tile.bottomFromMm == null ? tile.bottomMm : tile.bottomFromMm;
        const bottomTo = tile.bottomToMm == null ? tile.bottomMm : tile.bottomToMm;
        // Обход берётся так, чтобы нормаль смотрела на свою сторону: на правой
        // стороне концы меняются местами.
        const first = side > 0 ? to : from;
        const second = side > 0 ? from : to;
        const firstBottom = side > 0 ? bottomTo : bottomFrom;
        const secondBottom = side > 0 ? bottomFrom : bottomTo;
        out.push(
          volumePainted(
            volumeFace(
              [
                volumeAt(first, firstBottom),
                volumeAt(second, secondBottom),
                volumeAt(second, tile.topMm),
                volumeAt(first, tile.topMm),
              ],
              VOLUME_WALL_RGB,
              { normal, room: part.room },
            ),
            paint,
            "wall",
          ),
        );
      }
    }
  }
  for (const end of [0, 1]) {
    // Сведённый ус торца не имеет вовсе: там стена переходит в соседку, и
    // поперечная грань встала бы внутри угла, споря с её же кромками.
    if (end === 0 ? miter && miter.start : miter && miter.end) continue;
    const along = end === 0 ? 0 : len;
    const normal = { x: u.x * (end === 0 ? -1 : 1), y: u.y * (end === 0 ? -1 : 1), z: 0 };
    const left = at(along, half);
    const right = at(along, -half);
    const mid = at(along, 0);
    // Торец перегородки в проходе — пополам по толщине, как откос проёма
    // (`volumeTagSides`): половина светлеет своей комнатой, а не более светлой
    // из двух. Щуп — у стороны стены, чуть отступя от торца внутрь.
    const inward = Math.min(len / 2, VOLUME_SUN_PROBE_MM) * (end === 0 ? 1 : -1);
    // Обход прежний — от `first` к `second` через середину; половина у `left`
    // — сторона `+1`, у `right` — `−1`.
    // Помещений нет — торец цельный, как был.
    const start = end === 0 ? left : right;
    const finish = end === 0 ? right : left;
    const known = rooms && rooms.length > 0;
    const pieces = known
      ? [
          [start, mid, end === 0 ? 1 : -1],
          [mid, finish, end === 0 ? -1 : 1],
        ]
      : [[start, finish, 0]];
    for (const [first, second, sign] of pieces) {
      const room = known ? volumeRoomKeyAt(rooms, at(along + inward, (half + VOLUME_SUN_PROBE_MM) * sign)) : null;
      // Половина торца — краской своей стороны, как половина откоса.
      out.push(
        volumePainted(
          volumeFace([volumeAt(first, 0), volumeAt(second, 0), volumeAt(second, heightMm), volumeAt(first, heightMm)], VOLUME_WALL_RGB, {
            normal,
            room,
          }),
          volumeWallPaintRgb(wall, sign),
          "wall",
        ),
      );
    }
  }
  out.push(
    volumeFace(
      [at(startOf(1), half), at(endOf(1), half), at(endOf(-1), -half), at(startOf(-1), -half)].map((point) =>
        volumeAt(point, heightMm),
      ),
      VOLUME_WALL_RGB,
      { normal: { x: 0, y: 0, z: 1 } },
    ),
  );
  for (const opening of openings || []) {
    const from = out.length;
    volumeOpeningFaces(wall, opening, heightMm, out, openDoorIds, rooms);
    if (rooms && rooms.length > 0) volumeTagSides(wall, opening, out, from, rooms);
  }
  return out;
}

/**
 * Откосы, перемычка, подоконник, рама и полотно проёма — **между** двумя
 * помещениями (правка после сборки сценариев: «что бы светил и в проёмах»).
 *
 * Сперва у них были обе стороны (`sides`), и при физическом свете они
 * светлели по более светлой. Живой прогон заказчика это отверг: «почему
 * подсвечивается справа стена с проёмом… При чем даже с закрытой дверью».
 * Более светлая сторона светила и полотно закрытой двери со стороны тёмного
 * коридора, и откос, которого лампа из комнаты не видит.
 *
 * Теперь каждая грань проёма — **своей стороны стены**, тем же правилом, что
 * сторона стены (`volumeWallFaces`): откосы, перемычка и подоконник поделены
 * пополам по толщине стены (`volumeOpeningFaces`), и половина берёт помещение
 * своей стороны. Грань посреди толщины — полотно закрытой двери, стекло, рама —
 * своей нормалью: двусторонняя смотрит лицом в одну комнату, изнанкой в другую
 * (`backRoom`), и кадр берёт ту, что видна. Сторона на улицу — улица:
 * помещения у неё нет, и `volumeTagIndoor` её не трогает (`indoor: false`).
 *
 * Обе стороны (`sides`) остаются у рамы и стекла окна — свет к ним идёт с обеих
 * сторон, сквозь само стекло, — и у мелочи посреди толщины, у которой своей
 * стороны нет вовсе: верх и торцы ручки.
 */
function volumeTagSides(wall, opening, faces, from, rooms) {
  const vectors = wallVectors(wall);
  if (!vectors) return;
  const half = Number(wall.thicknessMm) / 2;
  const middle = Number(opening.atMm) + Number(opening.widthMm) / 2;
  const probe = (sign) => ({
    x: Number(wall.aMm.x) + vectors.u.x * middle + vectors.n.x * sign * (half + VOLUME_SUN_PROBE_MM),
    y: Number(wall.aMm.y) + vectors.u.y * middle + vectors.n.y * sign * (half + VOLUME_SUN_PROBE_MM),
  });
  const a = volumeRoomKeyAt(rooms, probe(1));
  const b = volumeRoomKeyAt(rooms, probe(-1));
  if (!a && !b) return;
  // `out` — с одной стороны улица (правка «солнце и луна»): откос окна светлеет
  // и по небу.
  const sides = { a: a || b, b: b || a, key: (a || "") + "|" + (b || ""), out: !a || !b };
  const roomOf = (sign) => (sign > 0 ? a : b);
  for (let index = from; index < faces.length; index += 1) {
    const face = faces[index];
    if (face.line || face.room) continue;
    // Рама и стекло окна светятся с обеих сторон — сквозь стекло свет и идёт,
    // — и для них «светлее из двух» верно. По сторонам делится только то, что
    // свет держит: стена, пол, полотно двери и его ручка.
    const opaque = !face.clear && (face.rgb === VOLUME_WALL_RGB || face.rgb === VOLUME_FLOOR_RGB || Boolean(face.doorId));
    if (!opaque) {
      face.sides = sides;
      continue;
    }
    const at = volumeMiddleOf(face.p);
    const across = (at.x - Number(wall.aMm.x)) * vectors.n.x + (at.y - Number(wall.aMm.y)) * vectors.n.y;
    const facing = face.n ? face.n.x * vectors.n.x + face.n.y * vectors.n.y : 0;
    const central = Math.abs(across) <= VOLUME_SIDE_CENTRE_MM;
    const sign = !central ? Math.sign(across) : Math.abs(facing) > 0.5 ? Math.sign(facing) : 0;
    if (sign === 0) {
      face.sides = sides;
      continue;
    }
    const own = roomOf(sign);
    if (own) face.room = own;
    else face.indoor = false;
    // Половина откоса, подоконника и перемычки — краской стороны своей стены
    // (покраска, правка без автопилота). Полотно и пол проёма — не стена.
    if (face.rgb === VOLUME_WALL_RGB) volumePainted(face, volumeWallPaintRgb(wall, sign), "wall");
    // Изнанка двусторонней грани: у полотна закрытой двери — соседняя
    // комната, у раскрытого полотна в комнате — та же. Пустая строка — улица.
    if (face.both) face.backRoom = (central ? roomOf(-sign) : own) || "";
  }
}

/**
 * Насколько грань может отстоять от середины толщины стены и всё ещё считаться
 * серединой: полотно закрытой двери и стекло стоят ровно на ней.
 */
const VOLUME_SIDE_CENTRE_MM = 1;
/**
 * Кусок стороны без помещения короче этого (за углом соседки, под торцом
 * перегородки) — не свой кусок, а часть соседнего: его закрывает стена, и
 * резать сторону ради него незачем.
 */
const VOLUME_SIDE_GAP_MM = 600;

/**
 * **Где вдоль стены меняется помещение** с её стороны `side` (правка после
 * сборки сценариев): места `(0, len)`, в которых линия щупа стороны — та, по
 * которой сторона стены ищет свою комнату, — пересекает контуры помещений.
 *
 * Нужны затем, что щуп у стороны один на кусок между проёмами, а наружная
 * стена квартиры идёт вдоль трёх комнат сразу: посреди неё коридор, и вся её
 * внутренняя сторона красилась коридором — и в гостиной, где горит свет, и в
 * спальне. Пятна ламп на такую сторону не ложились вовсе: они ищут свою
 * комнату (`volumeDecalHosts`).
 */
export function volumeSideStops(wall, side, rooms) {
  if (!rooms || rooms.length === 0) return [];
  const vectors = wallVectors(wall);
  if (!vectors) return [];
  const { u, n, len } = vectors;
  const reach = (Number(wall.thicknessMm) / 2 + VOLUME_SUN_PROBE_MM) * side;
  const ax = Number(wall.aMm.x) + n.x * reach;
  const ay = Number(wall.aMm.y) + n.y * reach;
  const stops = [];
  for (const room of rooms) {
    const points = room.pointsMm || [];
    for (let index = 0; index < points.length; index += 1) {
      const p = points[index];
      const q = points[(index + 1) % points.length];
      const ex = q.x - p.x;
      const ey = q.y - p.y;
      // Пересечение линии щупа `A + u·t` с ребром `p + e·s`.
      const cross = u.x * ey - u.y * ex;
      if (Math.abs(cross) < 1e-9) continue;
      const wx = p.x - ax;
      const wy = p.y - ay;
      const t = (wx * ey - wy * ex) / cross;
      const s = (wx * u.y - wy * u.x) / cross;
      if (s < 0 || s > 1 || !(t > 1) || !(t < len - 1)) continue;
      stops.push(t);
    }
  }
  return stops.sort((first, second) => first - second);
}

/**
 * Куски стороны стены от `fromMm` до `toMm` по помещениям: `[{fromMm, toMm,
 * room}]`. `stops` — где помещение может смениться (`volumeSideStops`),
 * `roomAt(along)` — помещение у стороны в этом месте. Короткий кусок без
 * помещения (`VOLUME_SIDE_GAP_MM`) отходит соседу, одинаковые соседи
 * сливаются: у стены одной комнаты кусок остаётся одним, как был.
 */
export function volumeSideParts(fromMm, toMm, stops, roomAt) {
  const cuts = [fromMm, ...stops.filter((stop) => stop > fromMm + 1 && stop < toMm - 1), toMm];
  let parts = [];
  for (let index = 0; index + 1 < cuts.length; index += 1) {
    const start = cuts[index];
    const end = cuts[index + 1];
    if (!(end - start > 0.5)) continue;
    parts.push({ fromMm: start, toMm: end, room: roomAt((start + end) / 2) });
  }
  if (parts.length > 1) {
    parts = parts.map((part, index) => {
      if (part.room || part.toMm - part.fromMm >= VOLUME_SIDE_GAP_MM) return part;
      const before = index > 0 ? parts[index - 1].room : null;
      const after = index + 1 < parts.length ? parts[index + 1].room : null;
      return { ...part, room: before || after };
    });
  }
  const merged = [];
  for (const part of parts) {
    const last = merged[merged.length - 1];
    if (last && last.room === part.room) last.toMm = part.toMm;
    else merged.push({ ...part });
  }
  return merged.length > 0 ? merged : [{ fromMm, toMm, room: roomAt((fromMm + toMm) / 2) }];
}

/**
 * **С какой стороны стены комната** — `1`, `-1` или `0`, если ответа нет.
 *
 * Спрашивается у контуров помещений тем же щупом, которым солнце выясняет,
 * куда ему светить (`VOLUME_SUN_PROBE_MM`): точка в полутора сантиметрах от
 * грани стены — уже комната, если контур обведён. Второго числа для этого не
 * заведено, и обводят контур один раз на обе задачи.
 *
 * `0` — обе стороны одинаковы (две комнаты или улица с обеих): тогда выбор
 * делает тот, кто спрашивал, и своё умолчание он называет сам.
 */
export function volumeInnerSide(wall, rooms, alongMm) {
  if (!Array.isArray(rooms) || rooms.length === 0) return 0;
  const vectors = wallVectors(wall);
  if (!vectors) return 0;
  const half = Number(wall.thicknessMm) / 2;
  const probe = (side) => ({
    x: Number(wall.aMm.x) + vectors.u.x * alongMm + vectors.n.x * side * (half + VOLUME_SUN_PROBE_MM),
    y: Number(wall.aMm.y) + vectors.u.y * alongMm + vectors.n.y * side * (half + VOLUME_SUN_PROBE_MM),
  });
  const inside = (side) => rooms.some((room) => volumePointInside(probe(side), room.pointsMm));
  const left = inside(1);
  const right = inside(-1);
  if (left === right) return 0;
  return left ? 1 : -1;
}

/** Откосы проёма, рама окна и полотно двери — закрытое или раскрытое. */
function volumeOpeningFaces(wall, opening, heightMm, out, openDoorIds, rooms = null) {
  const vectors = wallVectors(wall);
  if (!vectors) return out;
  const half = Number(wall.thicknessMm) / 2;
  const { u, n, len } = vectors;
  const from = Math.max(0, Math.min(len, Number(opening.atMm)));
  const to = Math.max(from, Math.min(len, from + Number(opening.widthMm)));
  const bottom = Math.max(0, Number(opening.heightAboveFloorMm || 0));
  const top = Math.min(heightMm, bottom + Number(opening.heightMm));
  if (!(to > from) || !(top > bottom)) return out;
  const reveals = out.length;
  const at = (along, across) => ({
    x: Number(wall.aMm.x) + u.x * along + n.x * across,
    y: Number(wall.aMm.y) + u.y * along + n.y * across,
  });
  // Низ проёма смотрит вверх, верх — вниз: подоконник виден снизу, перемычка
  // сверху, и затенение разводит их само.
  //
  // Подоконник, перемычка, свод и откосы — **пополам по толщине стены**
  // (правка после сборки сценариев): половина у комнаты светлеет её светом,
  // половина у соседки или улицы — своим (`volumeTagSides`). Цельной гранью
  // откос брал более светлую сторону и светился в тёмном коридоре и при
  // закрытой двери. Помещений нет — светить нечем, и грань остаётся цельной:
  // кадр такого объекта тот же до грани.
  const halves =
    rooms && rooms.length > 0
      ? [
          [half, 0],
          [0, -half],
        ]
      : [[half, -half]];
  if (bottom > 0) {
    for (const [outer, inner] of halves) {
      out.push(
        volumeFace(
          [at(from, outer), at(to, outer), at(to, inner), at(from, inner)].map((point) => volumeAt(point, bottom)),
          VOLUME_WALL_RGB,
          { normal: { x: 0, y: 0, z: 1 } },
        ),
      );
    }
  }
  // **Свод арки** (таск 219, G329): у неё верх не перемычкой, а дугой, и
  // откосы кончаются на пяте. Свод нарезан теми же отрезками, что пазухи, —
  // одной ломаной на обе поверхности.
  const span = volumeArchSpan(opening, from, to, top, bottom);
  const springMm = span ? span[0].zMm : top;
  if (span) {
    const middle = (from + to) / 2;
    const arch = openingArchGeometry(opening);
    for (let index = 0; index < span.length - 1; index += 1) {
      const left = span[index];
      const right = span[index + 1];
      // Нормаль свода смотрит **внутрь проёма** — к центру той окружности, по
      // которой он идёт: лампа сцены тогда гасит дугу к косякам, и свод виден
      // сводом, а не плоской полосой.
      const atMm = (left.alongMm + right.alongMm) / 2;
      const zMm = (left.zMm + right.zMm) / 2;
      const toCentre = { along: middle - atMm, z: top - arch.radiusMm - zMm };
      const length = Math.hypot(toCentre.along, toCentre.z) || 1;
      const normal = {
        x: (u.x * toCentre.along) / length,
        y: (u.y * toCentre.along) / length,
        z: toCentre.z / length,
      };
      for (const [outer, inner] of halves) {
        out.push(
          volumeFace(
            [
              volumeAt(at(left.alongMm, -outer), left.zMm),
              volumeAt(at(right.alongMm, -outer), right.zMm),
              volumeAt(at(right.alongMm, -inner), right.zMm),
              volumeAt(at(left.alongMm, -inner), left.zMm),
            ],
            VOLUME_WALL_RGB,
            { normal },
          ),
        );
      }
    }
  } else if (top < heightMm) {
    for (const [outer, inner] of halves) {
      out.push(
        volumeFace(
          [at(from, -outer), at(to, -outer), at(to, -inner), at(from, -inner)].map((point) => volumeAt(point, top)),
          VOLUME_WALL_RGB,
          { normal: { x: 0, y: 0, z: -1 } },
        ),
      );
    }
  }
  for (const end of [from, to]) {
    const sign = end === from ? 1 : -1;
    const normal = { x: u.x * sign, y: u.y * sign, z: 0 };
    const left = at(end, half);
    const right = at(end, -half);
    const mid = at(end, 0);
    const first = sign > 0 ? right : left;
    const second = sign > 0 ? left : right;
    const pieces =
      halves.length > 1
        ? [
            [first, mid],
            [mid, second],
          ]
        : [[first, second]];
    for (const [one, two] of pieces) {
      out.push(
        volumeFace([volumeAt(one, bottom), volumeAt(two, bottom), volumeAt(two, springMm), volumeAt(one, springMm)], VOLUME_WALL_RGB, {
          normal,
        }),
      );
    }
  }
  // **Рамка дверного проёма** (правка после сборки сценариев): откосы,
  // подоконник и перемычка открывающегося проёма помечены его дверью. По ним
  // прицел узнаёт проём и тогда, когда полотно уехало, — открытую дверь
  // закрывают, глядя в её проём (`volumeDoorwayAt`).
  // Окно со створкой — так же (правка без автопилота, 2026-10-25): глядя в
  // его проём, E открывает и закрывает створку.
  if (opening.id && (openingOpens(opening.kind) || openingVents(opening.kind))) {
    for (let index = reveals; index < out.length; index += 1) out[index].doorway = opening.id;
  }
  if (openingFamilyOf(opening.kind) === "window") {
    volumeWindowFrame(at, from, to, bottom, top, out, openingFaceGrid(opening));
    if (opening.id && volumeDoorOpen(openDoorIds, opening.id)) volumeWindowSash(wall, opening, { from, to, bottom, top }, out, rooms);
    return out;
  }
  if (openingHasLeaf(opening.kind)) {
    const open = volumeDoorOpen(openDoorIds, opening.id);
    volumeDoorLeaf(wall, opening, { from, to, bottom, top }, out, open, halves.length > 1);
    return out;
  }
  // **Роллетные и подъёмно-секционные ворота.** Закрытые стоят полотном в
  // проёме, в середине толщины стены — там же, где бруски рамы у окна.
  // Открытые уходят **вверх** (таск 219, G328): в таске 215 открытого
  // положения у них не было вовсе, и довод был — «показывать это пришлось бы
  // горизонтальным листом в комнате». Заказчик довод прочёл и лист принял:
  // «да, пусть лист будет».
  if (openingMotionOf(opening.kind) === "lift") {
    const open = volumeDoorOpen(openDoorIds, opening.id);
    const inner = open ? volumeInnerSide(wall, rooms, (from + to) / 2) : 0;
    if (open) volumeLiftOpen(wall, opening, { at, from, to, bottom, top, half, heightMm, inner }, out);
    else volumeLiftLeaf(at, from, to, bottom, top, out, openingFaceGrid(opening), opening.id || null);
  }
  return out;
}

/** Толщина свёрнутого полотна: вал роллеты и пакет панелей секционных. */
export const VOLUME_ROLL_MM = 300;

/**
 * **Открытые поднимающиеся ворота** (таск 219, G328).
 *
 * Разница между рулоном и пакетом дешева, и поэтому она видна — это два разных
 * механизма, и человек, выбравший один из них, должен увидеть именно его:
 *
 *   **роллетные** — полотно свёрнуто в **вал над проёмом**: короб поперёк
 *     стены, во всю ширину проёма, прямо под перемычкой. Так его и ставят —
 *     накладным коробом либо в нишу; места он занимает ровно `VOLUME_ROLL_MM`,
 *     и в комнату не выступает ничем;
 *   **подъёмно-секционные** — панели ушли по направляющим под потолок и лежат
 *     **горизонтальным листом в комнате**: лист той же ширины, что проём, и
 *     той же длины, какой была высота полотна. Это и есть «пусть лист будет».
 *
 * Куда уводить лист, спрашивается у помещений (`inner`): панели уезжают
 * **внутрь**, в гараж, а не на улицу. Помещения не обведены — сторона взята
 * по нормали стены и названа здесь же: промах стоит картинки, а не разметки.
 *
 * Полотна в проёме при этом нет вовсе — ворота открыты, сквозь них видно.
 */
function volumeLiftOpen(wall, opening, span, out) {
  const { at, from, to, top, bottom, half, heightMm, inner } = span;
  const doorId = opening.id || null;
  const leaf = Math.max(0, top - bottom);
  const roll = Math.min(VOLUME_ROLL_MM, Math.max(60, leaf));
  if (openingSlatted(opening.kind)) {
    // Рулон: короб под перемычкой, поперёк стены, во всю ширину проёма. Если
    // над проёмом места не осталось (проём до самого потолка), вал опускается
    // в сам проём — вверху, где ему и быть.
    const room = Math.max(0, heightMm - top);
    const low = room >= roll ? top : Math.max(bottom, top - roll);
    const high = low + roll;
    const vectors = wallVectors(wall);
    volumePrismFaces(
      volumeBoxCorners(at((from + to) / 2, 0), vectors.u, to - from, Math.min(roll, half * 2)),
      low,
      high,
      VOLUME_DOOR_RGB,
      out,
      { doorId },
    );
    return out;
  }
  // Пакет панелей: горизонтальный лист под перемычкой, уходящий в комнату.
  const side = inner || 1;
  const deep = Math.max(half, leaf);
  const near = { from: at(from, half * side), to: at(to, half * side) };
  const far = { from: at(from, (half + deep) * side), to: at(to, (half + deep) * side) };
  out.push(
    volumeFace(
      [volumeAt(near.from, top), volumeAt(near.to, top), volumeAt(far.to, top), volumeAt(far.from, top)],
      VOLUME_DOOR_RGB,
      { both: true, doorId },
    ),
  );
  return out;
}

/**
 * Полотно поднимающихся ворот: панели по горизонталям его лица.
 *
 * Панель на панель не налезает и все они коплоскостны — то же условие, по
 * которому не спорят за порядок рама и стекло двери (таск 180): грани в одной
 * плоскости, которые друг друга не закрывают, в сортировке по дальности
 * безразличны.
 */
function volumeLiftLeaf(at, from, to, bottom, top, out, grid, doorId = null) {
  const height = top - bottom;
  const edges = [0, ...(grid && Array.isArray(grid.ys) ? grid.ys : []), 1];
  for (let index = 1; index < edges.length; index += 1) {
    const low = bottom + height * edges[index - 1];
    const high = bottom + height * edges[index];
    if (!(high > low)) continue;
    const first = at(from, 0);
    const second = at(to, 0);
    out.push(
      volumeFace([volumeAt(first, low), volumeAt(second, low), volumeAt(second, high), volumeAt(first, high)], VOLUME_DOOR_RGB, {
        both: true,
        doorId,
      }),
    );
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

/**
 * **Сложенная гармошка** (таск 226, требование G338): два числа, из которых
 * выходит толщина пакета.
 *
 * `VOLUME_FOLD_LEAF_MM` — толщина звена. Сорок миллиметров: межкомнатное
 *   полотно 35–40 мм, у складных створок берут самое тонкое из этого ряда.
 * `VOLUME_FOLD_GAP_MM` — зазор между сложенными звеньями: петля-карта с
 *   осью снаружи полотна, десять миллиметров. Без зазора звенья легли бы
 *   плоскость в плоскость, а коплоскостные грани в сортировке по дальности
 *   решаются случаем (правило таска 180) — пакет мигал бы на облёте.
 *
 * Толщина пакета считается, а не пишется: `звеньев × 40 + промежутков × 10`.
 * У гармошки каталога (четыре звена) это **190 мм** — ровно то, на сколько
 * сложенное полотно вылезает из плоскости косяка в настоящей двери.
 */
export const VOLUME_FOLD_LEAF_MM = 40;
export const VOLUME_FOLD_GAP_MM = 10;

/**
 * **Зазор между уехавшим сдвижным полотном и стеной** (дефект D78).
 *
 * До правки открытое сдвижное полотно оставалось в средней плоскости стены —
 * то есть **внутри** неё, — и в объёме его не было видно вовсе: стена рисуется
 * поверх. На плане оно всё это время лежало накладным, по стороне стены
 * (`drawDrawingSlider`), и расходились эти два рисунка молча.
 *
 * Теперь полотно уезжает по той же стороне, и от оси стены его отделяет
 * полтолщины плюс эти двадцать миллиметров — кронштейн ролика, на котором
 * накладная дверь и висит. Меньше нельзя: полотно слилось бы со стеной в одну
 * плоскость, а коплоскостные грани сортировка по дальности разводит случаем
 * (правило таска 180).
 *
 * Портальной это не касается: у неё полотно **внутри** стены по замыслу, и
 * открытой она не рисуется вовсе (решение таска 215).
 */
export const VOLUME_SLIDE_GAP_MM = 20;

// Рама — четыре бруска по краю проёма, в середине толщины стены. Стекла нет:
// сквозь окно видно фон, и это ровно то, чего просил заказчик.
//
// **Импосты** (таск 215) — те же бруски по долям `openingFaceGrid`: двойное
// окно получает стойку посередине, тройное две, балконное две стойки и
// перекладину пояса. Своей сетки объём не считает: разойдись она с листом —
// окно на развёртке делилось бы на три, а в объёме на две.
function volumeWindowFrame(at, from, to, bottom, top, out, grid) {
  const half = VOLUME_FRAME_MM / 2;
  const span = to - from;
  const height = top - bottom;
  const bars = [
    { from, to, bottom, top: Math.min(top, bottom + VOLUME_FRAME_MM) },
    { from, to, bottom: Math.max(bottom, top - VOLUME_FRAME_MM), top },
    { from, to: Math.min(to, from + VOLUME_FRAME_MM), bottom, top },
    { from: Math.max(from, to - VOLUME_FRAME_MM), to, bottom, top },
  ];
  // Импосты встают **внутрь** рамы, а перекладина — отрезками между стойками:
  // наложенных коплоскостных граней в сцене быть не должно (правило таска 180),
  // а сошлись бы они здесь трижды — стойка с низом, с верхом и с поясом.
  const xs = grid && Array.isArray(grid.xs) ? grid.xs : [];
  const ys = grid && Array.isArray(grid.ys) ? grid.ys : [];
  const inner = {
    from: from + VOLUME_FRAME_MM,
    to: to - VOLUME_FRAME_MM,
    bottom: bottom + VOLUME_FRAME_MM,
    top: top - VOLUME_FRAME_MM,
  };
  const posts = xs.map((part) => from + span * part);
  for (const middle of posts) {
    bars.push({ from: middle - half, to: middle + half, bottom: inner.bottom, top: inner.top });
  }
  const gaps = [inner.from, ...posts.flatMap((middle) => [middle - half, middle + half]), inner.to];
  for (const part of ys) {
    const middle = bottom + height * part;
    for (let index = 0; index + 1 < gaps.length; index += 2) {
      bars.push({ from: gaps[index], to: gaps[index + 1], bottom: middle - half, top: middle + half });
    }
  }
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

/** На сколько градусов распахнута створка окна внутрь комнаты. */
export const VOLUME_SASH_DEG = 75;

/**
 * **Открытая створка окна** (правка без автопилота, 2026-10-25): та секция
 * лица, что открывается (`openingVentCell`), распахнута внутрь комнаты на
 * `VOLUME_SASH_DEG` вокруг своего края у начала стены. Рама и импосты окна
 * остаются на месте, как у настоящего окна; створка — рамка из четырёх брусков
 * без стекла, как и само окно в объёме. Бруски помечены окном (`doorId`):
 * прицел на створку закрывает его. Помещений нет или они с обеих сторон —
 * створка открывается на ту сторону, куда смотрит нормаль стены.
 */
function volumeWindowSash(wall, opening, span, out, rooms) {
  const cell = openingVentCell(opening);
  const vectors = wallVectors(wall);
  if (!cell || !vectors) return out;
  const { u, n } = vectors;
  const half = VOLUME_FRAME_MM / 2;
  const width = span.to - span.from;
  const height = span.top - span.bottom;
  const from = span.from + width * cell.fromShare + (cell.fromShare > 0 ? half : VOLUME_FRAME_MM);
  const to = span.from + width * cell.toShare - (cell.toShare < 1 ? half : VOLUME_FRAME_MM);
  const bottom = span.bottom + height * cell.bottomShare + (cell.bottomShare > 0 ? half : VOLUME_FRAME_MM);
  const top = span.bottom + height * cell.topShare - (cell.topShare < 1 ? half : VOLUME_FRAME_MM);
  const sash = to - from;
  if (!(sash > VOLUME_FRAME_MM * 3) || !(top - bottom > VOLUME_FRAME_MM * 3)) return out;
  const inner = volumeInnerSide(wall, rooms, (from + to) / 2) || 1;
  const turn = (VOLUME_SASH_DEG * Math.PI) / 180;
  const dir = { x: u.x * Math.cos(turn) + n.x * inner * Math.sin(turn), y: u.y * Math.cos(turn) + n.y * inner * Math.sin(turn) };
  const hinge = { x: Number(wall.aMm.x) + u.x * from, y: Number(wall.aMm.y) + u.y * from };
  const at = (along, z) => volumeAt({ x: hinge.x + dir.x * along, y: hinge.y + dir.y * along }, z);
  const bar = VOLUME_FRAME_MM * 0.8;
  const quad = (fromAlong, toAlong, low, high) => {
    if (!(toAlong > fromAlong) || !(high > low)) return;
    out.push(volumeFace([at(fromAlong, low), at(toAlong, low), at(toAlong, high), at(fromAlong, high)], VOLUME_FRAME_RGB, { both: true, doorId: opening.id }));
  };
  quad(0, sash, bottom, bottom + bar);
  quad(0, sash, top - bar, top);
  quad(0, bar, bottom + bar, top - bar);
  quad(sash - bar, sash, bottom + bar, top - bar);
  return out;
}

/**
 * **Звенья сложенной гармошки** (таск 226, G338): где встаёт каждое полотнище,
 * когда дверь раскрыта.
 *
 * Долг таска 215 звучал так: «гармошка в объёме складывается в половину своей
 * ширины — приближение, а не пакет звеньев». Приближение врало дважды: полотно
 * съезжало за косяк, как сдвижное (а гармошка никуда не съезжает), и оставалось
 * одной полосой вдвое короче себя (а она собирается звеньями).
 *
 * Теперь честно: **звенья встают поперёк стены пакетом у того косяка, где
 * петли**. Каждое звено — та же секция лица, которой полотно нарисовано на
 * плане и на развёртке (`openingFoldLinks`), то есть у гармошки каталога
 * 900 / 4 = 225 мм; в комнату пакет выступает ровно на эту ширину. Вдоль стены
 * он занимает свою толщину (`VOLUME_FOLD_LEAF_MM`, `VOLUME_FOLD_GAP_MM`) и
 * **из проёма не вылезает**: у двери у́же пакета (меньше 190 мм — такого не
 * бывает, но ширину задаёт человек) шаг жмётся по месту, а не рисует звенья
 * сквозь стену.
 */
function volumeFoldPack(root, into, across, width, links) {
  const link = width / links;
  const step = VOLUME_FOLD_LEAF_MM + VOLUME_FOLD_GAP_MM;
  const pack = links * VOLUME_FOLD_LEAF_MM + (links - 1) * VOLUME_FOLD_GAP_MM;
  const squeeze = pack > width ? width / pack : 1;
  const boards = [];
  for (let index = 0; index < links; index += 1) {
    // Грань звена стоит в середине его толщины: пакет начинается у самого
    // косяка и кончается ровно через свою толщину.
    const away = (VOLUME_FOLD_LEAF_MM / 2 + step * index) * squeeze;
    boards.push({
      at: { x: root.x + into.x * away, y: root.y + into.y * away },
      along: across,
      width: link,
    });
  }
  return boards;
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
function volumeDoorLeaf(wall, opening, span, out, open, sided = false) {
  const vectors = wallVectors(wall);
  const whole = span.to - span.from;
  if (!vectors || !(whole > 0)) return out;
  const { u, n } = vectors;
  const motion = openingMotionOf(opening.kind);
  const atStart = opening.hinge !== "end";
  const side = opening.swing === "right" ? -1 : 1;
  const doorId = opening.id || null;
  const point = (along, across = 0) => ({
    x: Number(wall.aMm.x) + u.x * along + n.x * side * across,
    y: Number(wall.aMm.y) + u.y * along + n.y * side * across,
  });
  // Створки: у двупольной две по половине проёма от своих косяков, у остальных
  // одна. Стороны открывания у двух створок общие — ровно как на плане.
  const twin = motion === "swing" && openingLeavesOf(opening.kind) > 1;
  const width = twin ? whole / 2 : whole;
  const leaves = twin
    ? [
        { along: span.from, out: 1 },
        { along: span.to, out: -1 },
      ]
    : [{ along: atStart ? span.from : span.to, out: atStart ? 1 : -1 }];
  for (const plan of leaves) {
    const root = point(plan.along);
    // Куда смотрит полотно.
    //
    //   распашное раскрытое — прочь от стены на четверть оборота;
    //   сдвижное раскрытое — вдоль стены **за** косяк и **по её стороне**, той
    //     самой, по которой оно нарисовано накладным на плане (дефект D78);
    //   гармошка раскрытая — пакетом звеньев поперёк стены у косяка с петлями
    //     (таск 226, `volumeFoldPack`): она никуда не съезжает, она
    //     складывается;
    //   портальное раскрытое — не рисуется вовсе: оно внутри стены, и это
    //     самый честный вид «открыто», какой у него бывает;
    //   закрытое любое — вдоль стены, в самом проёме.
    if (open && motion === "pocket") continue;
    const packed = open && motion === "fold";
    const slid = open && motion === "slide";
    const leaf = open && motion === "swing" ? { x: n.x * side, y: n.y * side } : { x: u.x * plan.out, y: u.y * plan.out };
    // Сколько полотно отстоит от оси стены, когда уехало: полстены плюс зазор.
    const away = slid ? Math.abs(Number(wall.thicknessMm) || 0) / 2 + VOLUME_SLIDE_GAP_MM : 0;
    const boards = packed
      ? volumeFoldPack(root, leaf, { x: n.x * side, y: n.y * side }, width, openingFoldLinks(opening))
      : [
          {
            at: slid
              ? { x: root.x - leaf.x * width + n.x * side * away, y: root.y - leaf.y * width + n.y * side * away }
              : root,
            along: leaf,
            width,
          },
        ];
    for (const board of boards) {
      const tip = { x: board.at.x + board.along.x * board.width, y: board.at.y + board.along.y * board.width };
      if (openingGlazed(opening)) {
        volumeGlassLeaf(board.at, board.along, board.width, span, out, doorId);
      } else {
        out.push(
          volumeFace(
            [
              volumeAt(board.at, span.bottom),
              volumeAt(tip, span.bottom),
              volumeAt(tip, span.top),
              volumeAt(board.at, span.top),
            ],
            VOLUME_DOOR_RGB,
            { both: true, doorId },
          ),
        );
      }
    }
    // Ручка у свободного края полотна, на высоте, на которой её берут рукой
    // (G207: «ну и на дверях ручки нарисуй»). Выступает на обе стороны: дверь
    // открывают с той стороны, с которой подошли. У сложенной гармошки свободный
    // край — у **последнего** звена пакета: ручка едет вместе с ним и в воздухе
    // не остаётся.
    const edge = boards[boards.length - 1];
    const handleAt = {
      x: edge.at.x + edge.along.x * (edge.width - VOLUME_HANDLE_EDGE_MM),
      y: edge.at.y + edge.along.y * (edge.width - VOLUME_HANDLE_EDGE_MM),
    };
    const bottom = Math.max(span.bottom, VOLUME_HANDLE_MM - VOLUME_HANDLE_TALL_MM / 2);
    const top = Math.min(span.top, bottom + VOLUME_HANDLE_TALL_MM);
    if (top > bottom && !sided) {
      volumePrismFaces(
        volumeBoxCorners(handleAt, edge.along, VOLUME_HANDLE_LONG_MM, VOLUME_HANDLE_OUT_MM * 2),
        bottom,
        top,
        VOLUME_HANDLE_RGB,
        out,
        { doorId },
      );
    } else if (top > bottom) {
      // При помещениях ручка — двумя половинами, по одной на сторону полотна
      // (правка после сборки сценариев): брусок насквозь стоял верхом посреди
      // полотна и светлел более светлой стороной — из тёмного коридора
      // светилась ручка закрытой двери (`volumeTagSides`).
      const across = { x: edge.along.y, y: -edge.along.x };
      for (const sign of [1, -1]) {
        const shift = (VOLUME_HANDLE_OUT_MM / 2) * sign;
        volumePrismFaces(
          volumeBoxCorners({ x: handleAt.x + across.x * shift, y: handleAt.y + across.y * shift }, edge.along, VOLUME_HANDLE_LONG_MM, VOLUME_HANDLE_OUT_MM),
          bottom,
          top,
          VOLUME_HANDLE_RGB,
          out,
          { doorId },
        );
      }
    }
  }
  return out;
}

/**
 * **Полотно стеклянной двери** (таск 180, G269): рама по контуру и стекло в
 * середине. Слова заказчика — «как на французский балкон — с рамой, но не
 * глухая, а по центру стекло, ну и тоже ручки».
 *
 * Четыре бруска рамы непрозрачны, пятая грань — стекло, и у неё тот же
 * признак `clear`, которым просвечивает вещь чертежа (таск 169) и тюль шторы
 * (таск 189). Доля **названа** — `"glass"` в `VOLUME_CLEAR_ALPHAS`, — а не
 * записана числом здесь: иначе стекло двери и стекло шкафа смешивались бы
 * по-разному в одном кадре, и расхождение заметил бы только глаз.
 *
 * ——— порядок граней ——————————————————————————————————————————————————————
 *
 * Рама и стекло **коплоскостны**: все пять граней лежат в одной плоскости
 * полотна. Дерево порядка (таск 151) порядок внутри плоскости не обещает — и
 * здесь он не нужен ни на что: бруски стоят вокруг стекла, а не поверх него, и
 * коплоскостные грани, которые друг друга не закрывают, смешиваться между
 * собой не могут. Ровно это условие и записано у `volumeOrderTree`.
 *
 * А вот то, что **за** полотном, дерево разводит как надо: плоскость полотна
 * сама становится секущей, и всё, что за ней, рисуется раньше — то есть
 * прозрачному стеклу достаётся уже готовый задник, как того и требует
 * смешивание. Второго прохода «прозрачные после непрозрачных» не понадобилось
 * и здесь.
 *
 * Полотно уже рамы вдвое — рама съедает ширину с двух сторон; на узкой или
 * низкой двери (меньше трёх рам) стекла не остаётся, и полотно рисуется глухим
 * одной гранью рамы: врать про стекло там, где его негде нарисовать, незачем.
 */
function volumeGlassLeaf(hinge, leaf, width, span, out, doorId) {
  const at = (along, z) => volumeAt({ x: hinge.x + leaf.x * along, y: hinge.y + leaf.y * along }, z);
  const quad = (fromAlong, toAlong, bottom, top, rgb, clear) => {
    if (!(toAlong > fromAlong) || !(top > bottom)) return;
    out.push(volumeFace([at(fromAlong, bottom), at(toAlong, bottom), at(toAlong, top), at(fromAlong, top)], rgb, {
      both: true,
      doorId,
      clear,
    }));
  };
  const frame = OPENING_GLASS_FRAME_MM;
  const height = span.top - span.bottom;
  if (!(width > frame * 3) || !(height > frame * 3)) {
    quad(0, width, span.bottom, span.top, VOLUME_FRAME_RGB, false);
    return out;
  }
  const inner = { from: frame, to: width - frame, bottom: span.bottom + frame, top: span.top - frame };
  // Низ, верх и две стойки — рама; стойки встают между низом и верхом, чтобы
  // бруски не легли друг на друга: наложенных коплоскостных граней в сцене
  // быть не должно.
  quad(0, width, span.bottom, inner.bottom, VOLUME_FRAME_RGB, false);
  quad(0, width, inner.top, span.top, VOLUME_FRAME_RGB, false);
  quad(0, inner.from, inner.bottom, inner.top, VOLUME_FRAME_RGB, false);
  quad(inner.to, width, inner.bottom, inner.top, VOLUME_FRAME_RGB, false);
  // Плотность стекла названа, а не задана числом (таск 189): `volumeClearAlpha`
  // переводит имя в долю, и второго числа у двери нет.
  quad(inner.from, inner.to, inner.bottom, inner.top, VOLUME_GLASS_RGB, "glass");
  return out;
}
