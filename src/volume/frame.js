// «Объём»: кадр — `volumeFrame` переводит сцену в многоугольники экрана,
// `volumeDraw` рисует их на холсте; маска дома для осадков.
//
// Часть «Объёма», вынесенная из `src/volume.js` (2026-10-25) переносом без
// переименований: снаружи модуль читают через дверь `volume.js`, а соседи по
// `src/volume/` — напрямую. Зависимости идут только вниз по слоям (порядок —
// в шапке `volume.js`), циклов нет. Решения и доводы — в шапках разделов ниже.
import { VOLUME_LAND_RGB, VOLUME_LAYER_BODY, VOLUME_NEAR_MM } from "./measures.js";
import { volumeFill, volumeShade } from "./faces.js";
import { volumeBasis, volumeClipNear, volumeFocal, volumeToCamera } from "./camera.js";
import { volumeInTree, volumeMiddleOf, volumeOrderRank, volumeOrderTree, volumeOrderWalk } from "./order.js";
import { VOLUME_FOG_GROUND } from "./sky.js";
import { volumeFaceMine } from "./floors.js";
import {
  VOLUME_LAMP_DUSK,
  VOLUME_LAMP_INVISIBLE,
  VOLUME_NOON_TINT,
  volumeFullMemo,
  volumeIndoorTint,
  volumeLiveFill,
  volumeRoomTint,
  volumeSeamGrow,
  volumeShadeAlpha,
} from "./lamps.js";

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
 *
 * `live` — **состояние дома** (таск 09 сценариев, история 2.12): `{glow:
 * Map<markId, {level, rgb}>, rooms: Map<ключ помещения, 0…1>}` — что светится
 * и где горит свет (`volumeLiveLight`). Без него кадр тот же, что до имитации,
 * вызов в вызов: ветка не делает ни одного лишнего счёта.
 */
export function volumeFrame(scene, camera, box, extra = null, tint = null, live = null) {
  const basis = volumeBasis(camera);
  const focal = volumeFocal(box);
  const halfWidth = box.width / 2;
  const halfHeight = box.height / 2;
  const polygons = [];
  // У собранной сцены дерево уже есть; у наскоро составленной (стенд, тест) его
  // строят на месте — кадр обязан быть верным и там.
  const tree = scene.order === undefined ? volumeOrderTree(scene.faces) : scene.order;
  // Хозяева — только у своего этажа (`volumeFloorFaces`, таск 232). Правило
  // одно и живёт в `volumeFaceMine`; кадр его слушается, а не повторяет. У
  // сцены одной схемы этажей нет вовсе — там и спрашивать нечего.
  const ownFloor = scene.ownFloor;
  const stacked = ownFloor !== undefined && ownFloor !== null;
  // Тон освещённой комнаты считается **раз на комнату и кадр**, а не на грань:
  // граней в комнате сотни, а тон у них один. `full` — тон полной лампы: им
  // красятся кольца пятен (правка после сборки сценариев); при свете неба он
  // считается от самой тёмной комнаты — лампа светит одинаково днём и ночью.
  // `sky` — тон улицы: им красятся кольца окон.
  const day = live && live.day ? live.day : null;
  const lit = live
    ? {
        glow: live.glow || null,
        rooms: live.rooms || null,
        day,
        physical: live.physical === true,
        tints: new Map(),
        roomRgb: live.roomRgb || null,
        full: volumeRoomTint(day ? volumeIndoorTint(tint, 0) : tint, 1),
        // Тон полной лампы своего цвета — для колец цветных ламп, раз на цвет.
        fullOf: volumeFullMemo(day ? volumeIndoorTint(tint, 0) : tint),
        sky: tint || VOLUME_NOON_TINT,
      }
    : null;
  // Пятна ламп без света неба — только ночью и в сумерках: днём тона ночи нет,
  // и комната вся светла. Со светом неба днём темно в комнате без окон, и пятна
  // рисуются всегда.
  const decals = live && live.decals && (day || (tint && tint.share > VOLUME_LAMP_DUSK)) ? live.decals : null;
  const skyDecals = live && live.skyDecals ? live.skyDecals : null;
  const take = (face, order) =>
    volumeFacePolygons(
      face,
      camera,
      basis,
      focal,
      halfWidth,
      halfHeight,
      box,
      polygons,
      order,
      tint,
      !stacked || volumeFaceMine(face, ownFloor),
      lit,
    );
  // Половина — чтобы линия встала **между** гранями, а не спорила с одной из них.
  const rankOf = (face) => volumeOrderRank(tree, camera.at, volumeMiddleOf(face.p)) - 0.5;
  let rank = 0;
  for (const face of volumeOrderWalk(tree, camera.at)) {
    const before = polygons.length;
    take(face, rank);
    // Кусок не попал в кадр — отвёрнут, за спиной или за краем — не попали и
    // его пятна с тенями: они лежат в нём же и в его плоскости. Их и не
    // считают; кадр от этого не меняется ни на один многоугольник.
    if (polygons.length === before) {
      rank += 1;
      continue;
    }
    // Кольца пятен ламп — **сразу за своим куском** и с его местом в очереди:
    // то, что ближе куска, рисуется позже и закрывает пятно (правка после
    // сборки сценариев).
    // Пятно на полупрозрачной вещи (мебель, ткань шторы) просвечивает так же,
    // как она: иначе освещённый стол становился сплошной плитой.
    const through = face.alpha === undefined ? 1 : face.alpha;
    const rings = decals ? decals.get(face) : null;
    if (rings) {
      for (const ring of rings) {
        const strength = live.lamps ? live.lamps.get(ring.markId) : 0;
        const alpha = ring.alpha * (strength || 0) * through;
        if (!(alpha > VOLUME_LAMP_INVISIBLE)) continue;
        const color = live.colors ? live.colors.get(ring.markId) : null;
        take({ p: ring.p, n: ring.n || face.n, rgb: face.rgb, layer: face.layer, flat: face.flat, decal: alpha, lamp: true, seams: ring.seams, ...(color ? { lampRgb: color } : {}) }, rank);
      }
    }
    // Тени вещей от ламп — поверх колец своего куска: кусок в свете без пятен,
    // прозрачностью ровно на долю лампы тени (`volumeLampShades`).
    const shades = decals && live.shades ? live.shades.get(face) : null;
    if (shades) {
      for (const shade of shades) {
        const alpha = volumeShadeAlpha(shade, live.lamps) * through;
        if (!(alpha > VOLUME_LAMP_INVISIBLE)) continue;
        take({ p: shade.p, n: face.n, rgb: face.rgb, layer: face.layer, flat: face.flat, room: face.room, sides: face.sides, moon: face.moon, shadow: alpha, seams: shade.seams }, rank);
      }
    }
    // Кольца окон — тем же правилом; сила окна — доля неба на штору.
    const panes = skyDecals ? skyDecals.get(face) : null;
    if (panes) {
      for (const ring of panes) {
        const strength = live.windows ? live.windows.get(ring.markId) : 0;
        const alpha = ring.alpha * (strength || 0) * through;
        if (!(alpha > VOLUME_LAMP_INVISIBLE)) continue;
        take({ p: ring.p, n: ring.n || face.n, rgb: face.rgb, layer: face.layer, flat: face.flat, decal: alpha, lamp: false, seams: ring.seams }, rank);
      }
    }
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
function volumeFacePolygons(face, camera, basis, focal, halfWidth, halfHeight, box, out, order = null, tint = null, mine = true, live = null) {
  if (face.line) {
    const line = volumeLinePolygon(face, camera, basis, focal, halfWidth, halfHeight, box, mine);
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
  // Двусторонняя грань, видная изнанкой, — изнанкой и светится: полотно
  // закрытой двери со стороны тёмного коридора — коридором (`backRoom`,
  // `volumeTagSides`), пустая строка — улицей.
  let seen = face;
  if (face.both && facing < 0) {
    normal = { x: -normal.x, y: -normal.y, z: -normal.z };
    facing = -facing;
    if (live && typeof face.backRoom === "string") seen = { ...face, room: face.backRoom || null };
  }
  if (facing <= 0) return out;
  // Грань целиком перед ближней плоскостью — а таких почти все — переводится
  // в экран сразу, без промежуточных точек камеры: кадр делает это сотни раз,
  // и на телефоне мусор от них съедал заметную долю кадра. Счёт тот же, число
  // в число, что у `volumeToCamera` и `volumeClipNear`; задетую плоскостью
  // грань режет прежний путь.
  const eye = camera.at;
  const right = basis.right;
  const up = basis.up;
  const fwd = basis.fwd;
  let xy = [];
  let depth = 0;
  let count = face.p.length;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let whole = true;
  for (const point of face.p) {
    const dx = point.x - eye.x;
    const dy = point.y - eye.y;
    const dz = point.z - eye.z;
    const z = dx * fwd.x + dy * fwd.y + dz * fwd.z;
    if (!(z >= VOLUME_NEAR_MM)) {
      whole = false;
      break;
    }
    const scale = focal / z;
    const x = halfWidth + (dx * right.x + dy * right.y + dz * right.z) * scale;
    const y = halfHeight - (dx * up.x + dy * up.y + dz * up.z) * scale;
    xy.push(x, y);
    depth += z;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  if (!whole) {
    const clipped = volumeClipNear(face.p.map((point) => volumeToCamera(point, eye, basis)));
    if (clipped.length < 3) return out;
    xy = [];
    depth = 0;
    count = clipped.length;
    minX = Infinity;
    maxX = -Infinity;
    minY = Infinity;
    maxY = -Infinity;
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
  }
  if (maxX < 0 || minX > box.width || maxY < 0 || minY > box.height) return out;
  // Пятно света и тени не обводится, а раздаётся по швам (`volumeDecalSeams`)
  // — номерам своих рёбер. Срезанное ближней плоскостью пятно рёбра
  // перенумеровало, и такое обводится целиком, как прежде.
  let soft = face.decal !== undefined || face.shadow !== undefined;
  if (soft && face.seams && face.seams.length > 0) {
    if (whole) volumeSeamGrow(xy, face.seams);
    else soft = false;
  }
  const middle = depth / count;
  // Время года и туман (правка «погода»): земля плиты — земля сезона, а всё
  // снаружи дома тонет в тумане по дальности. В доме тумана нет: у граней
  // комнаты и проёма своё помещение (`room`, `sides`).
  const rgb = tint && tint.land && face.rgb === VOLUME_LAND_RGB ? tint.land : face.rgb;
  // Земля плиты тонет ровно, как земля фона ниже горизонта (`VOLUME_FOG_GROUND`).
  const fogged =
    tint && tint.fog && !face.room && !face.sides && !face.led && face.decal === undefined && !face.lit
      ? {
          rgb: tint.fog.rgb,
          share: tint.fog.share * (face.rgb === VOLUME_LAND_RGB ? VOLUME_FOG_GROUND : 1 - Math.exp(-middle / tint.fog.mm)),
        }
      : null;
  out.push({
    xy,
    depth: middle,
    order: order === null ? -middle : order,
    layer: face.layer,
    fill: fogged
      ? volumeFill(rgb, face.flat ? 1 : volumeShade(normal), face.alpha === undefined ? 1 : face.alpha, tint, fogged)
      : live
        ? volumeLiveFill(rgb === face.rgb ? seen : { ...seen, rgb }, normal, tint, live)
        : face.led
          ? volumeFill(face.rgb, 1, 1, null)
          : volumeFill(rgb, face.flat ? 1 : volumeShade(normal), face.alpha === undefined ? 1 : face.alpha, tint),
    // Многоугольник просвечивает (таск 169): взгляд смотрит сквозь него
    // дальше — если за ним есть кому отвечать (таск 189, см. `volumeSightAt`).
    // Рисование об этом не спрашивает — прозрачность уже в цвете.
    clear: Boolean(face.clear),
    // Пятно света или тени поверх своей грани (`decal`, `shadow`): без обводки
    // (`volumeDraw`), швы уже раздвинуты (`volumeSeamGrow`).
    soft,
    // Грань дома — комнаты или проёма (правка после сборки сценариев): за ней
    // дождя и снега не видно (`volumeRainMask`).
    // Грань помещения без потолка — под небом: снег на балконе идёт.
    inside: !face.open && Boolean(face.room || face.sides || face.indoor),
    // Хозяева — только у своего этажа (`volumeFloorFaces`): у грани чужого
    // этажа их нет, и кадр не отдаёт её ни прицелу, ни щелчку, ни клавише
    // выключателя. Своего правила здесь нет — только послушание пометке.
    pick: (mine && face.markId) || null,
    door: (mine && face.doorId) || null,
    // Рамка дверного проёма (правка после сборки сценариев) — тоже хозяин
    // только у своего этажа.
    doorway: (mine && face.doorway) || null,
    // Клавиша выключателя (таск 177): по ней окно отвечает, в какой канал
    // попал щелчок. У остальных многоугольников `null`.
    channel: mine && face.channel !== undefined ? face.channel : null,
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
function volumeLinePolygon(line, camera, basis, focal, halfWidth, halfHeight, box, mine = true) {
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
    pick: (mine && line.markId) || null,
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
      // Обводка своим цветом закрывает шов между соседними гранями. Пятну
      // света и тени (`soft`) её не нужно: шов с соседним куском закрыт тем,
      // что пятно раздвинуто по нему (`volumeSeamGrow`), а по дуге кольца
      // обводка клала кайму двойной прозрачности — круги на потолке — и
      // стоила телефону столько же, сколько заливка: замер стенда с мебелью
      // — 23,5 мс заливки кадра с обводкой пятен против 13 без неё.
      if (!polygon.soft) ctx.strokeStyle = polygon.fill;
      ctx.fill();
      if (!polygon.soft) ctx.stroke();
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

/**
 * **Где в кадре улица** (правка после сборки сценариев): «Снег и дождь не
 * видно в окно, если ты дома». Маска для поля осадков: залито — там дом,
 * капель не видно. Многоугольники идут в порядке рисования, поэтому то, что
 * ближе, решает: плотная грань дома закрашивает маску, грань улицы (наружная
 * стена, земля, дом напротив в окне) её стирает, прозрачное (стекло, тюль) —
 * пропускается: сквозь стекло улица видна. Фон — небо и земля — не
 * многоугольники, там маски нет вовсе.
 */
export function volumeRainMask(ctx, polygons) {
  ctx.fillStyle = "#000";
  for (const polygon of polygons || []) {
    if (polygon.stroke || polygon.clear || (typeof polygon.fill === "string" && polygon.fill.startsWith("rgba("))) continue;
    const xy = polygon.xy;
    ctx.globalCompositeOperation = polygon.inside ? "source-over" : "destination-out";
    ctx.beginPath();
    ctx.moveTo(xy[0], xy[1]);
    for (let index = 2; index < xy.length; index += 2) ctx.lineTo(xy[index], xy[index + 1]);
    ctx.closePath();
    ctx.fill();
  }
  ctx.globalCompositeOperation = "source-over";
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
