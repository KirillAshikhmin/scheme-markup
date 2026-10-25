// «Объём»: пол, потолок, вещи чертежа, лестница, этажи стопкой, двусвет и
// потолок под его дырой.
//
// Часть «Объёма», вынесенная из `src/volume.js` (2026-10-25) переносом без
// переименований: снаружи модуль читают через дверь `volume.js`, а соседи по
// `src/volume/` — напрямую. Зависимости идут только вниз по слоям (порядок —
// в шапке `volume.js`), циклов нет. Решения и доводы — в шапках разделов ниже.
import {
  SCHEME_ANCHOR_OBJECT_KEYS,
  WALL_HEIGHT_FALLBACK_MM,
  openingOpens,
  openingWalkThrough,
  openingsInWall,
  outlineHasCeiling,
  outlinesInOrder,
  planFractionToMm,
  planMmToFraction,
  roomAtPlace,
  roomHasFloor,
  schemeAnchorOriginMm,
  schemeFloorOf,
  schemeObjectCorners,
  schemeObjectKeyOf,
  schemeObjectsOnScheme,
  schemesInOrder,
  segmentDistanceMm,
  wallHeightMm,
  wallHeightShownMm,
  wallOwnHeightMm,
  wallVectors,
  wallsOnScheme,
} from "../model.js";
import { objectModelByKey } from "../objectModels/registry.js";
import {
  DEG,
  VOLUME_CEILING_RGB,
  VOLUME_HEAD_MM,
  VOLUME_MITER_EPS,
  VOLUME_MITER_MAX,
  VOLUME_OBJECT_RGB,
  VOLUME_PLANE_EPS_MM,
  VOLUME_SLAB_RGB,
  VOLUME_STEP_MM,
} from "./measures.js";
import { volumeAt, volumeClockwise, volumeFace } from "./faces.js";
import {
  VOLUME_SUN_PROBE_MM,
  VOLUME_WALL_SAME_DEG,
  volumeDrawn,
  volumePointInside,
  volumePrismFaces,
} from "./shapes.js";
import { volumeDoorOpen } from "./walls.js";
import { volumeCurtainShare } from "./sun.js";
import { volumeModelFaces } from "./marks.js";

// ——— пол, потолок, объекты ———————————————————————————————————————————————

/**
 * Высота помещения: переопределение комнаты, высота схемы, а если ни того ни
 * другого — выведенная высота и честный `known: false`.
 *
 * **Своего счёта здесь нет ни одной строки** (таск 228): и умолчание, и вывод
 * живут в модели (`wallHeightShownMm`), и ровно то же читает развёртка.
 * Умолчание стало общим ещё в таске 173, а вывод — нет: лист поднимался над
 * самым высоким, что стоит на стене, а комната оставалась плоской. Выходило два
 * числа про одну стену, и дверь выше умолчания объём срезал потолком
 * (`volumeWallTiles`), пока лист рисовал её целиком.
 *
 * Окно говорит о выведенном строкой `volume.noHeight`, и число в ней — это
 * `scene.heightMm`, а не константа: иначе строка снова разошлась бы с полосой.
 */
export function volumeHeightMm(project, schemeId, roomId) {
  return wallHeightShownMm(project, { schemeId, roomId });
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
      // Пол помещения (таск 209, G317): нет ключа — есть пол, и прежний объект
      // показывается как показывался. Контур без помещения (такое бывает у
      // объекта, где комнату удалили, а обводку оставили) считается с полом:
      // снимать его было некому.
      hasFloor: roomHasFloor(project, outline.roomId),
      // Потолок (правка после сборки сценариев): «если высота стены 0, то там
      // потолка нет, только пол, если не указано иное». Выводит его модель по
      // стенам контура, выбор помещения главнее (`outlineHasCeiling`).
      hasCeiling: outlineHasCeiling(project, outline),
    });
  }
  return rooms;
}

/**
 * **Климат дома** (правка после сборки сценариев): помещения с площадью,
 * высотой и окнами и проёмы между ними — для потока имитации
 * (`sim/climate.js`). Слова заказчика: «Температура в помещении. Воздухообмен
 * по помещениям и с улицей при открытых дверях».
 *
 * `{rooms: [{id, areaMm2, heightMm, windowsMm2}], ways: [{id, a, b, areaMm2,
 * window, leaf}]}` — у проёма стороны `a`, `b` (помещение или `null` — улица),
 * окно ли это (`window`) и есть ли полотно (`leaf`): у арки и проёма полотна
 * нет, и воздух через них ходит всегда. Сторона спрашивается тем же щупом, что
 * у света (`VOLUME_SUN_PROBE_MM`). Помещение из двух контуров — одно.
 */
export function volumeClimateGeometry(project) {
  const rooms = new Map();
  const ways = [];
  if (!project) return { rooms: [], ways };
  for (const scheme of schemesInOrder(project)) {
    // Помещение без потолка (балкон, терраса) для воздуха — улица: дверь на
    // балкон выходит наружу, а датчик на нём показывает улицу.
    const list = volumeRooms(project, scheme.id).filter((room) => room.roomId && room.hasCeiling !== false);
    if (list.length === 0) continue;
    for (const room of list) {
      const own = rooms.get(room.roomId) || { id: room.roomId, areaMm2: 0, heightMm: 0, windowsMm2: 0 };
      own.areaMm2 += volumeArea(room.pointsMm);
      own.heightMm = Math.max(own.heightMm, Number(room.heightMm) || 0);
      rooms.set(room.roomId, own);
    }
    const roomAt = (point) => {
      const found = list.find((room) => volumePointInside(point, room.pointsMm));
      return found ? found.roomId : null;
    };
    for (const wall of wallsOnScheme(project, scheme.id)) {
      const vectors = wallVectors(wall);
      if (!vectors) continue;
      const half = Number(wall.thicknessMm) / 2;
      for (const opening of openingsInWall(project, wall.id)) {
        const middle = Number(opening.atMm) + Number(opening.widthMm) / 2;
        const probe = (sign) => ({
          x: Number(wall.aMm.x) + vectors.u.x * middle + vectors.n.x * sign * (half + VOLUME_SUN_PROBE_MM),
          y: Number(wall.aMm.y) + vectors.u.y * middle + vectors.n.y * sign * (half + VOLUME_SUN_PROBE_MM),
        });
        const a = roomAt(probe(1));
        const b = roomAt(probe(-1));
        if ((!a && !b) || a === b) continue;
        const areaMm2 = Math.max(0, Number(opening.widthMm) || 0) * Math.max(0, Number(opening.heightMm) || 0);
        const window = !openingWalkThrough(opening.kind);
        ways.push({ id: opening.id, a, b, areaMm2, window, leaf: openingOpens(opening.kind) });
        if (window && (!a || !b)) rooms.get(a || b).windowsMm2 += areaMm2;
      }
    }
  }
  return { rooms: [...rooms.values()], ways };
}

/** Высота в точке: по помещению места (вещь в нише стены — тоже), иначе по схеме. */
function volumeHeightAt(project, schemeId, pointMm, fallbackMm) {
  const fraction = planMmToFraction(project, schemeId, pointMm);
  const roomId = fraction ? roomAtPlace(project, schemeId, fraction) : null;
  if (!roomId) return fallbackMm;
  return volumeHeightMm(project, schemeId, roomId).mm;
}

/**
 * **Ус на изломе полосы** (дефект D38, таск 169).
 *
 * Слова заказчика по снимку объёма: «не должно быть такого, ни двойного на
 * углу, ни пустоты в другом углу».
 *
 * Полоса (кухонный фронт, короб, марш) — цепочка призм по звеньям, и звенья,
 * обрубленные **поперёк своей оси**, на изломе не стыкуются: с внутренней
 * стороны угла они залезают друг на друга, с внешней между ними остаётся клин
 * пустоты. Непрозрачные звенья это прятали — лишний слой неотличим от одного,
 * — а прозрачные показали оба изъяна разом.
 *
 * Лечится тем же, чем в черчении: звено кончается не поперёк оси, а **по
 * биссектрисе угла**. Две кромки сходятся ровно, нахлёст пропадает вместе с
 * клином, и граней от этого не прибавляется ни одной — меняются координаты
 * четырёх точек звена.
 *
 * Смещение считается по сумме единичных нормалей: `(n₁ + n₂) / (1 + n₁·n₂)`.
 * На прямой она даёт ровно нормаль, на прямом угле — её же, удлинённую в
 * `√2`, то есть точку встречи двух кромок.
 */
function volumeMiterOffset(prev, next, halfWidth) {
  if (!prev) return { x: next.x * halfWidth, y: next.y * halfWidth };
  if (!next) return { x: prev.x * halfWidth, y: prev.y * halfWidth };
  const dot = prev.x * next.x + prev.y * next.y;
  const denominator = 1 + dot;
  // Полный разворот: ус уходит в бесконечность, а стыковать нечего — полоса
  // легла сама на себя. Кромка остаётся поперечной, как была.
  if (!(denominator > VOLUME_MITER_EPS)) return { x: next.x * halfWidth, y: next.y * halfWidth };
  const x = ((prev.x + next.x) / denominator) * halfWidth;
  const y = ((prev.y + next.y) / denominator) * halfWidth;
  const reach = Math.hypot(x, y);
  const limit = VOLUME_MITER_MAX * Math.abs(halfWidth);
  // Острый излом: ус длиннее предела — срезаем его по пределу («заглушка»).
  // Полоса в этом месте кончается тупым носом, и между звеньями остаётся
  // щель — но лежит она **внутри** острого угла, который сам себя закрывает.
  if (reach > limit && reach > 0) return { x: (x / reach) * limit, y: (y / reach) * limit };
  return { x, y };
}

/**
 * Объект схемы, разложенный на прямые призмы.
 *
 * Прямоугольник — одна призма по четырём углам, ломаная — цепочка призм по
 * звеньям, сходящихся на изломе **усом** (`volumeMiterOffset`, дефект D38).
 *
 * Высота `null` значит «во всю высоту помещения» (колонна, ниша, короб) — она
 * берётся по тому помещению, в котором вещь стоит.
 *
 * Одно место на обе надобности: по этим призмам вещь и рисуется, и держит
 * человека. Посчитай их врозь — и однажды нарисованный шкаф окажется не там,
 * где он не пускает.
 *
 * Ус — единственное, в чём эти две надобности расходятся, и расходятся
 * **названно**: `corners` — то, что рисуется (звено с косыми кромками),
 * `solidCorners` — прежний прямоугольник звена, которым вещь держит человека.
 * Препятствие осталось прямоугольником не из лени: `volumePrismSolid` выводит
 * ось и толщину из трёх первых углов, и косая кромка превратила бы трапецию в
 * препятствие, стоящее не там, где вещь. Цена решения названа: внешний клин
 * излома теперь **нарисован, но не держит** — на прямом угле это треугольник
 * с катетами в половину ширины полосы.
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
  // Звенья собираются списком **до** призм: усу нужен сосед, а вырожденное
  // звено (две точки в одном месте) соседом быть не может — оно выпадает, и
  // ус считается через него.
  const links = [];
  for (let index = 0; index + 1 < corners.length; index += 1) {
    const a = corners[index];
    const b = corners[index + 1];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length = Math.hypot(dx, dy);
    if (!(length > 0)) continue;
    links.push({ a, b, n: { x: dy / length, y: -dx / length } });
  }
  const prisms = [];
  for (let index = 0; index < links.length; index += 1) {
    const link = links[index];
    const head = volumeMiterOffset(links[index - 1] ? links[index - 1].n : null, link.n, halfWidth);
    const tail = volumeMiterOffset(link.n, links[index + 1] ? links[index + 1].n : null, halfWidth);
    const a = link.a;
    const b = link.b;
    const nx = link.n.x * halfWidth;
    const ny = link.n.y * halfWidth;
    prisms.push({
      corners: volumeClockwise([
        { x: a.x + head.x, y: a.y + head.y },
        { x: b.x + tail.x, y: b.y + tail.y },
        { x: b.x - tail.x, y: b.y - tail.y },
        { x: a.x - head.x, y: a.y - head.y },
      ]),
      // Препятствие — прежний прямоугольник звена (см. выше про расхождение).
      solidCorners: volumeClockwise([
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

/**
 * Модель вещи чертежа (таск 155). Ключ каталога старше имени вида, и оба пути
 * нужны: ключ — то, чем вещь названа с таска 154, имя — то, чем живут уже
 * размеченные объекты (G68). Оба пути сведены в `schemeObjectKeyOf`, и
 * второго места, где ключ вещи вычисляют, в сборке нет.
 *
 * У ломаной модели нет: ломаной задают кухонный фронт, короб и марш, то есть
 * **полосу**, а не вещь, — повторять по модели на каждом звене значило бы
 * поставить в ряд пять холодильников там, где человек провёл линию.
 */
export function volumeObjectModel(project, object) {
  if (!object || object.shape === "polyline") return null;
  return objectModelByKey(schemeObjectKeyOf(project, object));
}

/**
 * Габарит вещи чертежа для модели.
 *
 * **Перёд берётся из поворота на чертеже**, и больше ниоткуда: человек
 * поворачивает вещь мышью или числом, и это единственное место, где он
 * говорит, куда она смотрит. Угадывать по ближней стене было бы умнее на
 * словах и непредсказуемо на деле: шкаф, поставленный в середине комнаты,
 * разворачивался бы сам, стоило подвинуть его на сантиметр.
 *
 * При нулевом повороте вещь смотрит вниз по листу — туда, куда смотрит вещь,
 * приставленная к верхней стене комнаты. Так ставят шкаф, кровать и машинку:
 * габарит задают «ширина по стене × глубина от стены», и глубина уходит от
 * стены в комнату.
 */
export function volumeObjectFrame(project, schemeId, object, fallbackHeightMm) {
  if (!object || object.shape === "polyline" || !object.atMm) return null;
  const prisms = volumeObjectPrisms(project, schemeId, object, fallbackHeightMm);
  if (prisms.length !== 1) return null;
  const prism = prisms[0];
  const angle = ((Number(object.turnDeg) || 0) * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return {
    at: { x: Number(object.atMm.x), y: Number(object.atMm.y) },
    bottomMm: prism.bottomMm,
    u: { x: cos, y: sin },
    f: { x: sin, y: -cos },
    widthMm: Number(object.widthMm),
    depthMm: Number(object.depthMm),
    heightMm: prism.topMm - prism.bottomMm,
  };
}

/**
 * Грани объекта схемы: модель, а без неё — прежняя призма по габариту.
 *
 * **Все они просвечивают** (таск 169, G251): и модель, и запасной габарит, и
 * звено ломаной — вещь чертежа прозрачна целиком, какой бы породы она ни была.
 * Это одно место на весь объём: других хозяев `clear` в сборке нет, и вещь не
 * может оказаться прозрачной в кадре и непрозрачной для взгляда.
 *
 * Прозрачность — **вид, а не свойство вещи**: в объект не пишется ничего
 * (G68), и ни столкновения (`volumeObjectPrisms` → `volumePrismSolid`), ни
 * чертёж, ни выгрузки о ней не знают. Сквозь прозрачный шкаф по-прежнему не
 * пройти.
 */
export function volumeObjectFaces(project, schemeId, object, fallbackHeightMm, out = [], clear = true) {
  // Отметка «Прозрачные объекты» (правка после сборки сценариев): «если
  // выключить, то становятся не прозрачными. По умолчанию вкл.» Снята — вещь
  // плотная, как стена; тюль шторы — тело метки, его отметка не трогает.
  const own = clear !== false;
  const model = volumeObjectModel(project, object);
  const frame = model ? volumeObjectFrame(project, schemeId, object, fallbackHeightMm) : null;
  if (frame) return volumeModelFaces(frame, model, VOLUME_OBJECT_RGB, out, { clear: own });
  for (const prism of volumeObjectPrisms(project, schemeId, object, fallbackHeightMm)) {
    volumePrismFaces(prism.corners, prism.bottomMm, prism.topMm, VOLUME_OBJECT_RGB, out, { clear: own });
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
 *
 * Спрашивается это **в полный рост** и один раз, при сборке сцены: присед
 * макушку только опускает, то есть отсеять он может лишь то, что уже отсеяно
 * здесь. Что держит присевшего, решается на шаге — `volumeSolidBlocks`, и
 * высоты вещи для этого едут в препятствие (`volumePrismSolid`).
 */
export function volumePrismBlocks(prism) {
  return prism.bottomMm < VOLUME_HEAD_MM && prism.topMm > VOLUME_STEP_MM;
}

/** Препятствие из призмы: повёрнутый прямоугольник по её габариту. */
export function volumePrismSolid(prism) {
  // Звено полосы держит человека прежним прямоугольником, а не косым усом
  // (D38): ось и толщину препятствия выводят три первых угла, и трапеция
  // поставила бы их криво. У всего остального `solidCorners` нет вовсе.
  const corners = prism.solidCorners || prism.corners;
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
    // Высоты вещи едут в препятствие вместе с её габаритом (G234): под
    // навесным шкафом присевший проходит, сквозь колонну до потолка — нет.
    bottomMm: Number(prism.bottomMm) || 0,
    topMm: Number(prism.topMm) || 0,
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
// **Узнаёт по ключу каталога — `stairs`** (таск 154). Прежде узнавала по
// имени вида, и это было единственным, что у вида есть: ни кода, ни ключа, а
// `id` у каждого объекта свой. Имя человек правит руками — переименовал «Марш»,
// и перехода по этажам нет. Со встроенным каталогом у лестницы появился ключ,
// один на все объекты и на все машины, и узнавание перестало зависеть от слов.
//
// Имя осталось **запасным путём** и нигде здесь не упоминается: вещь прежней
// разметки получает ключ выводом из имени в `schemeObjectKeyOf`, тем же
// терпимым сравнением («Лестница», «лестничный марш», «Лестница на 2 этаж»,
// `stairs`). Два места, где лестницу узнают, развелись бы при первой правке —
// поэтому место одно.

/** Расстояние от точки до многоугольника: ноль — точка внутри. */
export function volumePolygonGap(point, corners) {
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
    const key = schemeObjectKeyOf(project, object);
    // **Марш и выход — одна и та же дверь между этажами** (таск 204): к маршу
    // подходят снизу, к выходу — сверху, вопрос «на какой этаж?» у них общий.
    // Список ключей один на сборку и живёт в модели: по нему же ставится точка
    // привязки (`SCHEME_ANCHOR_OBJECT_KEYS`, таск 205), и это не совпадение —
    // привязку берут ровно у лестничной клетки.
    if (!SCHEME_ANCHOR_OBJECT_KEYS.includes(key)) continue;
    const polygons = volumeObjectPrisms(project, schemeId, object, WALL_HEIGHT_FALLBACK_MM).map(
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
    // `key` — марш это или выход: по нему прибытие ищет **парную** вещь (D58).
    stairs.push({ objectId: object.id, key, polygons, atMm: { x: sx / count, y: sy / count } });
  }
  return stairs;
}

// ——— стопка этажей (таск 202, G307) ——————————————————————————————————————
//
// Слова заказчика: «давай сделаем новую фичу — отображение сразу всех этажей.
// Но в опциях просмотра пусть будет пункт что показывать. Все этажи (если
// указаны этажи у схем) или какой-то именно этаж».
//
// ——— высота этажа ————————————————————————————————————————————————————————
//
// **Этаж кончается там, где кончается его самая высокая стена**, и это не то
// же, что высота схемы: у комнаты бывает своё число (таск 173), и этаж с
// трёхметровой гостиной при схеме 2700 обязан подняться на три метра — иначе
// перекрытие верхнего этажа срезало бы ей потолок. Отсюда `volumeFloorTopMm`:
// потолок этажа — максимум из высоты схемы и всех её стен. Хозяин мерки один,
// её же спрашивает сам `volumeScene` под вынос земли.
//
// **Высоты складываются по очереди, а не умножаются.** У каждой схемы своя
// высота, и база следующего этажа — база этого плюс его потолок плюс
// перекрытие. Умножить одну высоту на число этажей значило бы поставить
// трёхметровый этаж в 2700 или наоборот.
//
// ——— перекрытие ——————————————————————————————————————————————————————————
//
// `VOLUME_SLAB_MM` = 200 мм — монолитная плита перекрытия жилого дома (сборная
// ПК — 220). Больше в это число ничего не вложено **нарочно**: стяжка с
// покрытием лежит уже внутри высоты этажа, потому что высота стен схемы
// отмерена от того пола, по которому ходят, а не от плиты. Числа этого в
// объекте нет и не будет — у схемы задаётся этаж и высота стен, а не толщина
// пола под ней (G68); понадобится своя — это новое поле схемы и отдельный
// разговор.
//
// ——— дыра в нумерации и два плана на одном номере ————————————————————————
//
// **Дыра не оставляет пустого места.** Есть 1 и 3, нет 2 — третий встаёт на
// первый. Выдумать пропущенному этажу высоту нечем: своей у него нет, а взять
// среднюю или соседнюю — это догадка, которую правило сборки запрещает
// применять молча. Номера в окне стоят как есть (1 и 3), и видно, что между
// ними ничего не нарисовано.
//
// **Два плана на одном номере — в стопке один.** Довод таска 149 («план этажа
// и его зеркальная копия») в силе и ничего не выбрасывает: оба остаются в
// списке лестницы, оба открываются по отдельности, ни одна схема не тронута.
// Но поставить их в стопку обоих нельзя — они встанут друг в друга и дадут
// кашу вместо этажа. Поэтому на номер берётся один план: открытый, если открыт
// один из них, иначе первый по порядку схем; остальные окно называет вслух.

/** Толщина перекрытия между этажами. Разбор — абзацем выше. */
export const VOLUME_SLAB_MM = 200;

/**
 * **Где начало этой схемы в общем плане дома** — единственный шов совмещения
 * этажей (таск 205, требование G309).
 *
 * Слова заказчика: «надо синхронизировать схемы для наложения одной на другую.
 * Можно точку привязки указать например. Кстати лестница как раз таки может
 * стать такой. Указываем в 1 месте лестницу и над ней выход с лестницы».
 *
 * Точку привязки завёл таск 205, и считает смещение **модель**
 * (`schemeAnchorOriginMm`): у схемы с привязкой `a` начало координат лежит в
 * общем плане в `−a`, у схемы без привязки — в нуле, то есть всё стоит как
 * стояло до стопки (G68). Здесь — дверь, через которую об этом спрашивает
 * объём, и больше нигде: `volumeFloorPlan` кладёт каждому этажу `shiftMm`
 * (разницу начал, как разницу баз по высоте), а грани двигает
 * `volumeFloorFaces`.
 *
 * Дверь не убрана за ненадобностью нарочно: совмещение спрашивается из одного
 * места, и когда у привязки появится второй ключ (поворот — разбор в модели),
 * править придётся здесь, а не в трёх местах сборки сцены.
 */
export function volumeSchemeOriginMm(project, schemeId) {
  return schemeAnchorOriginMm(project, schemeId);
}

/**
 * Высота каждой стены схемы: переопределение комнаты с той стороны, где оно
 * есть, иначе высота схемы.
 *
 * Хозяин мерки один на сборку: её спрашивает сцена (вынос земли и грани стен)
 * и стопка этажей (потолок этажа). Разойдись они — перекрытие срезало бы
 * стену, которую сцена нарисовала выше.
 */
export function volumeWallHeights(project, schemeId, fallbackMm) {
  const heights = new Map();
  for (const wall of wallsOnScheme(project, schemeId)) {
    // Своя высота стены (правка после сборки сценариев) — главнее, и ноль у
    // неё значение: стены нет. Правило счёта одно и живёт в модели
    // (`wallHeightMm`); `fallbackMm` остался доводом ради прежних вызовов —
    // модель берёт ту же показанную высоту схемы сама.
    const own = wallOwnHeightMm(wall);
    heights.set(wall.id, own !== null ? own : wallHeightMm(project, wall.id) || fallbackMm);
  }
  return heights;
}

/**
 * Высота этажа в стопке — **высота схемы**, а не самой высокой её комнаты
 * (таск 209 уточняет таск 202).
 *
 * Сперва здесь стоял максимум по стенам: «иначе перекрытие срежет комнату, у
 * которой своя высота». Двусветное пространство (G317) перевернуло довод.
 * Высокая комната — это и есть помещение на два этажа, и поднимать из-за неё
 * **весь** верхний этаж значит разносить дом: задали гостиной 5800 — и спальни
 * над ней уехали бы на три метра вверх от лестницы.
 *
 * Поэтому правило простое и предсказуемое: этаж ровно такой высоты, какая
 * задана схеме, а комната, которой задали больше, проходит сквозь перекрытие —
 * **через ту дыру, которую оставляет снятый пол помещения над ней**. Цена
 * названа прямо: комната выше схемы, под которой пол не снимали, упрётся в
 * перекрытие и будет срезана им — и это видно сразу, с первого взгляда на
 * стопку.
 *
 * Самую высокую стену спрашивает `volumeWallsTopMm` — она нужна земле под
 * тень, и это другая мерка.
 */
export function volumeFloorTopMm(project, schemeId) {
  return volumeHeightMm(project, schemeId, null).mm;
}

/** Самая высокая стена схемы: по ней считается вынос земли под тень (D43). */
export function volumeWallsTopMm(project, schemeId, heights = null) {
  const schemeMm = volumeHeightMm(project, schemeId, null).mm;
  const map = heights || volumeWallHeights(project, schemeId, schemeMm);
  let top = schemeMm || 0;
  for (const height of map.values()) top = Math.max(top, Number(height) || 0);
  return top;
}

/**
 * Что стопка этажей показывает и чего ей не хватает (таск 202).
 *
 * Отдаёт `{floor, floors, doubles, can, why}`:
 *
 *   - `floors` — этажи снизу вверх, по одному плану на номер, с базой
 *     `baseMm` **относительно того этажа, на котором стоит человек**: у него
 *     самого ноль, у нижнего — минус. Отсчёт именно такой, потому что всё
 *     остальное в объёме считается от пола открытой схемы — камера, ходьба,
 *     выделение, миникарта, — и смена системы координат под ними стоила бы
 *     переписывания ходьбы ради картинки;
 *   - `doubles` — планы, которые на свой номер не попали (два плана на одном
 *     этаже): окно называет их вслух;
 *   - `can` — доступны ли «все этажи» вообще, `why` — почему нет.
 *
 * Схема без номера этажа этажом не считается (правило таска 149), схема без
 * чертежа — тоже: в стопке от неё была бы пустота.
 */
export function volumeFloorPlan(project, schemeId) {
  const floor = schemeFloorOf(project, schemeId);
  const found = [];
  for (const scheme of schemesInOrder(project)) {
    const own = schemeFloorOf(project, scheme.id);
    if (own === null) continue;
    if (!volumeDrawn(project, scheme.id)) continue;
    found.push({ schemeId: scheme.id, name: scheme.name, floor: own });
  }
  // Снизу вверх, а внутри номера — порядком схем: сортировка устойчива
  // (ES2019), и первым на номере остаётся план, заведённый раньше.
  found.sort((a, b) => a.floor - b.floor);
  const floors = [];
  const doubles = [];
  for (const item of found) {
    const already = floors.findIndex((taken) => taken.floor === item.floor);
    if (already < 0) {
      floors.push({ ...item });
      continue;
    }
    // Открытая схема на номере главнее: человек смотрит на неё, и подменять её
    // однофамильцем значило бы подменить то, по чему он ходит.
    if (item.schemeId === schemeId) {
      doubles.push(floors[already]);
      floors[already] = { ...item };
      continue;
    }
    doubles.push({ ...item });
  }
  let base = 0;
  for (const item of floors) {
    item.heightMm = volumeFloorTopMm(project, item.schemeId);
    item.baseMm = base;
    item.originMm = volumeSchemeOriginMm(project, item.schemeId);
    item.current = item.schemeId === schemeId;
    base += item.heightMm + VOLUME_SLAB_MM;
  }
  const mine = floors.find((item) => item.current) || null;
  const zero = mine ? mine.baseMm : 0;
  // Этаж стоит относительно того, на котором человек: по высоте — разница баз,
  // в плане — разница начал (шов таска 205, `volumeSchemeOriginMm`). У своего
  // этажа и то и другое ноль, и это не совпадение, а правило отсчёта.
  const here = mine ? mine.originMm : { x: 0, y: 0 };
  for (const item of floors) {
    item.baseMm -= zero;
    item.shiftMm = { x: item.originMm.x - here.x, y: item.originMm.y - here.y };
  }
  // Причина недоступности — та, которую человек может **исправить**: нет
  // номеров вовсе, их меньше двух, или они есть, но не у открытой схемы.
  // Порядок именно такой: сказать «у этой схемы нет этажа» там, где этажей нет
  // ни у кого, значило бы послать править не ту схему.
  const why = floors.length > 1 ? (mine ? null : "noFloor") : found.length > 0 ? "one" : "none";
  return { floor, floors, doubles, can: why === null, why };
}

/**
 * **Ярусов по этажам больше нет** (таск 211 снял их вместе с ярусом полов).
 *
 * В таске 202 каждому этажу стопки отводился свой отрезок ярусов между полами
 * и телами: иначе солнечное пятно первого этажа (ярус 3) рисовалось бы поверх
 * перекрытия второго (ярус 2). Лечило это следствие, а не причину — причиной
 * был сам ярус полов, из-за которого горизонтали не закрывали ни одного тела
 * (D62, D63). Теперь полы, потолки, плита и пятна лежат в ярусе тел, и порядок
 * им всем — на всех этажах разом — считает дерево, сшитое по этажам
 * плоскостями (`volumeOrderStack`). Делить ярусы стало нечего.
 */

/**
 * Этаж стопки: грани встают на свою базу и на своё место в плане, плоское
 * уходит в ярус этажа, а у чужого этажа снимаются хозяева.
 *
 * `shiftMm` — смещение схемы в общем плане (шов таска 205): сегодня ноль, и
 * этажи совмещаются по началу координат.
 *
 * Правятся грани **на месте**: они только что собраны `volumeScene` и больше ни
 * у кого на руках, а копия стопки из трёх этажей — это десятки тысяч лишних
 * точек на каждую сборку сцены.
 *
 * **У этажа, на котором не стоишь, хозяев нет.** Выделение, прицел, клавиши
 * выключателя и двери остаются на своём этаже: иначе щелчок по розетке чужого
 * этажа выделил бы метку чужой схемы — карточка, список меток и подсветка на
 * плане говорили бы о том, чего в кадре нет, — а «все двери» открывало бы двери
 * двух этажей через одну.
 *
 * Правило то же, а записано оно иначе: грань носит **свой этаж** (`face.floor`
 * — схема, с которой она пришла), а хозяева достаются граням того этажа, на
 * котором стоит человек (`scene.ownFloor`); решает это кадр, одним сравнением
 * (`volumeFrame`). Прежде `markId`, `channel` и `doorId` у чужого этажа
 * **обнулялись**, и это было необратимо: поднявшись туда по лестнице, человек
 * получал этаж уже без хозяев — то есть этаж приходилось собирать заново.
 * Ярлык не снимается ничем, его наследуют и куски от резов дерева, и смена
 * этажа перестала быть пересборкой: меняется одно поле сцены (таск 232).
 *
 * `floor` не задан — грань ничья, и хозяева у неё свои: так приходит сцена
 * одной схемы, у которой этажа нет вовсе.
 */
export function volumeFloorFaces(faces, { baseMm = 0, shiftMm = null, floor = null } = {}) {
  const lift = Number(baseMm) || 0;
  const dx = Number(shiftMm && shiftMm.x) || 0;
  const dy = Number(shiftMm && shiftMm.y) || 0;
  for (const face of faces || []) {
    if (lift !== 0 || dx !== 0 || dy !== 0) {
      for (const point of face.p) {
        point.x += dx;
        point.y += dy;
        point.z += lift;
      }
    }
    if (floor !== null) face.floor = floor;
  }
  return faces;
}

/**
 * Своя ли это грань: ничья (этажа нет) или с того этажа, на котором стоят.
 * Хозяева — `markId`, `channel`, `doorId` — достаются только своим.
 */
export function volumeFaceMine(face, ownFloor) {
  return !face || face.floor === undefined || face.floor === null || face.floor === ownFloor;
}

/**
 * Тело перекрытия под полом: кромка по контуру и низ (таск 209, дефект D60).
 *
 * **Почему это понадобилось.** Пол был одной плоскостью без толщины, и между
 * этажами стопки зияла щель в `VOLUME_SLAB_MM`: верх стен нижнего этажа на
 * 2800, пол верхнего на 3000, а между ними **не было ни одной грани** — замер
 * на стенде из трёх этажей дал ноль граней, пересекающих эту полосу. Снаружи
 * сквозь неё было видно внутрь дома, и ровно это заказчик назвал словами
 * «говоришь рисуются, а я их не вижу».
 *
 * Теперь у пола есть тело: бок красится бетоном (`VOLUME_SLAB_RGB`) и идёт в
 * дерево порядка наравне со стенами, низ — потолком, и он же закрывает вид
 * снизу там, где у нижнего этажа комнаты не обведены.
 *
 * Эта же кромка — **края дыры** двусветного пространства (G317): пол снят у
 * помещения, перекрытия там нет, а у соседних оно кончается своим торцом.
 * Второго механизма «нарисовать край дыры» не нужно и заводить нельзя.
 */
export function volumeSlabFaces(points, topMm, out = []) {
  if (!points || points.length < 3) return out;
  const bottomMm = topMm - VOLUME_SLAB_MM;
  for (let index = 0; index < points.length; index += 1) {
    const a = points[index];
    const b = points[(index + 1) % points.length];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    if (dx === 0 && dy === 0) continue;
    const length = Math.hypot(dx, dy);
    out.push(
      volumeFace(
        [volumeAt(a, bottomMm), volumeAt(b, bottomMm), volumeAt(b, topMm), volumeAt(a, topMm)],
        VOLUME_SLAB_RGB,
        // Ярус у кромки **телесный**: она стоит вертикально, как стена, и
        // спорит с соседями порядком, а не правилом.
        { normal: { x: dy / length, y: -dx / length, z: 0 } },
      ),
    );
  }
  out.push(
    volumeFace(points.map((point) => volumeAt(point, bottomMm)), VOLUME_CEILING_RGB, {
      normal: { x: 0, y: 0, z: -1 },
    }),
  );
  return out;
}

/**
 * Куски стены, которые на этаже выше накрыты его собственной стеной.
 *
 * `uppers` — стены верхнего этажа, **уже переведённые в координаты этой
 * схемы** (разницу привязок знает стопка). Считается «та же стена»: оси
 * сонаправлены с точностью до `VOLUME_WALL_SAME_DEG` и отстоят не дальше, чем
 * сумма полутолщин. Стена, которая просто упирается в эту (перегородка под
 * прямым углом), накрытием не считается — иначе она пробивала бы в двусветной
 * стене дыру шириной в себя.
 */
export function volumeWallCovers(wall, uppers) {
  const vectors = wallVectors(wall);
  if (!vectors) return [];
  const half = Number(wall.thicknessMm) / 2;
  const limit = Math.cos(VOLUME_WALL_SAME_DEG * DEG);
  const spans = [];
  for (const up of uppers || []) {
    const other = wallVectors(up);
    if (!other) continue;
    if (Math.abs(vectors.u.x * other.u.x + vectors.u.y * other.u.y) < limit) continue;
    const reach = half + Number(up.thicknessMm) / 2;
    const ends = [up.aMm, up.bMm].map((point) => {
      const dx = Number(point.x) - Number(wall.aMm.x);
      const dy = Number(point.y) - Number(wall.aMm.y);
      return {
        along: dx * vectors.u.x + dy * vectors.u.y,
        across: dx * vectors.n.x + dy * vectors.n.y,
      };
    });
    if (Math.abs(ends[0].across) > reach && Math.abs(ends[1].across) > reach) continue;
    const from = Math.max(0, Math.min(ends[0].along, ends[1].along));
    const to = Math.min(vectors.len, Math.max(ends[0].along, ends[1].along));
    if (!(to - from > 1)) continue;
    spans.push({ fromMm: from, toMm: to });
  }
  spans.sort((a, b) => a.fromMm - b.fromMm);
  const merged = [];
  for (const span of spans) {
    const last = merged[merged.length - 1];
    if (last && span.fromMm <= last.toMm + 1) {
      last.toMm = Math.max(last.toMm, span.toMm);
      continue;
    }
    merged.push({ ...span });
  }
  return merged;
}

/** Куски стены, которые **не** накрыты: дополнение к `volumeWallCovers`. */
export function volumeWallFree(lengthMm, covers) {
  const free = [];
  let cursor = 0;
  for (const span of covers || []) {
    if (span.fromMm > cursor) free.push({ fromMm: cursor, toMm: Math.min(lengthMm, span.fromMm) });
    cursor = Math.max(cursor, span.toMm);
  }
  if (cursor < lengthMm) free.push({ fromMm: cursor, toMm: lengthMm });
  return free.filter((span) => span.toMm - span.fromMm > 1);
}

// ——— потолок под дырой двусвета (таск 229, требование G343) ——————————————
//
// Вопрос заказчика: «можно ли поправить?» — о потолке нижней комнаты, который
// остаётся на месте под двусветом, **если высоту комнате не задали**.
//
// **Откуда он там.** Двусвет собирают двумя ручками (таск 209): у помещения
// сверху снимают пол, комнате снизу задают высоту в два этажа. Сними один
// пол — дыра в перекрытии появится, а потолок комнаты под ней останется стоять
// на своей высоте и затянет её снизу: сверху сквозь дыру видно серую плоскость
// потолка, а не комнату, и двусвета не получается.
//
// **Что снимается.** Потолок, который стоит **в плоскости перекрытия** — тот
// самый, что и есть низ плиты этажа выше. Это и есть случай «высоту комнате не
// задали»: её потолок равен высоте этажа. Задали больше (двусвет как он есть,
// 6000 мм на объекте заказчика) — потолок стоит выше дыры, и снимать нечего;
// задали меньше (подшивной потолок) — он не низ перекрытия, а своя плоскость
// комнаты, и дыра до неё не доходит. Поэтому мерка одна: `capMm` без
// перекрытия против высоты комнаты, с той же точностью «одна плоскость»
// (`VOLUME_PLANE_EPS_MM`), которой сшиваются этажи.
//
// **Резать потолок по контуру дыры не стали, и цена названа числами.** Случай
// «дыра накрывает комнату целиком», на который рассчитывал тикет, на объекте
// заказчика не встретился ни разу: накрытие там **68,8 % и 89,8 %** площади.
// Поэтому потолок снимается целиком при любом накрытии, а ненакрытую часть
// держит **низ плиты этажа выше** — он лежит ровно в той же плоскости и того же
// цвета (`VOLUME_CEILING_RGB`), потому что это и есть потолок этой комнаты.
// Замер по объекту заказчика (сетка 25 мм, с полосами под стенами верхнего
// этажа): у комнаты 74,2 м² ненакрытое — 30,9 % низом плиты и **0,2 %** ничем,
// у комнаты 16,8 м² — 9,3 % и **1,0 %**. Эти доли процента — полоски у стен,
// где второй этаж не обведён; цена их закрытия — счёт вычитания многоугольников
// (в сборке есть только отсечка выпуклым, `volumeClipPolygon`), то есть новый
// кусок геометрии ради 0,2 % площади двух комнат. Не стали.

/**
 * Накладываются ли два плановых многоугольника. Спрашивается вершинами и
 * серединами: вершина одного внутри другого (или середина внутри) — значит
 * накладываются.
 *
 * Точного пересечения здесь не нужно, и заводить его нельзя: вопрос, на
 * который отвечает мерка, — «стоит ли эта комната под дырой», а не «на сколько
 * квадратных метров». Чего она не ловит: накрест положенных многоугольников,
 * у которых ни одна вершина не внутри (крест из двух прямоугольников). Контур
 * комнаты и контур помещения этажом выше так не лежат — они обведены по тем же
 * стенам, — а середины добирают случай «дыра целиком внутри комнаты», где
 * вершин внутри нет ни у той, ни у другой.
 */
export function volumePolysOverlap(a, b) {
  if (!a || a.length < 3 || !b || b.length < 3) return false;
  if (a.some((point) => volumePointInside(point, b))) return true;
  if (b.some((point) => volumePointInside(point, a))) return true;
  const middle = (points) => {
    let x = 0;
    let y = 0;
    for (const point of points) {
      x += point.x;
      y += point.y;
    }
    return { x: x / points.length, y: y / points.length };
  };
  return volumePointInside(middle(a), b) || volumePointInside(middle(b), a);
}

/**
 * Снят ли у помещения потолок дырой двусвета (таск 229, G343). Разбор —
 * абзацем выше.
 *
 * `voids` — контуры помещений **без пола** с этажа выше, уже переведённые в
 * координаты этой схемы (разницу привязок знает стопка, шов таска 205);
 * `capMm` — потолок полосы этажа, тот же довод, которым уступают стены в
 * двусвете (таск 214). Без стопки ни того, ни другого нет вовсе — и тогда всё
 * как было: одна схема про соседние этажи не знает ничего (G68).
 */
export function volumeCeilingUnderVoid(room, voids, capMm) {
  if (!voids || voids.length === 0) return false;
  const slabMm = (Number(capMm) || 0) - VOLUME_SLAB_MM;
  if (!(slabMm > 0)) return false;
  // Потолок в плоскости перекрытия — и только он: выше дыры или ниже её стоит
  // своя плоскость комнаты, и снимать её нечем.
  if (Math.abs((Number(room.heightMm) || 0) - slabMm) > VOLUME_PLANE_EPS_MM) return false;
  return voids.some((hole) => volumePolysOverlap(room.pointsMm, hole));
}

/** Плоскости дерева уезжают вместе с гранями: перенос сдвигает `d` на `n·t`. */
function volumeMovePlanes(node, dx, dy, dz) {
  if (!node) return;
  node.plane.d += node.plane.x * dx + node.plane.y * dy + node.plane.z * dz;
  volumeMovePlanes(node.front, dx, dy, dz);
  volumeMovePlanes(node.back, dx, dy, dz);
}

/**
 * Этаж встаёт на новое место: своя база и своё смещение плана.
 *
 * `part` — этаж из `scene.stackParts`: `{sub, cuts, tree, at}`. Переносятся
 * **все** точки, какие у этажа есть: точки граней сцены (у каждой грани свои,
 * общих между гранями нет) и точки резов дерева (`cuts`) — их в сцене нет
 * нигде, и без списка они остались бы на прежнем месте. Дерево, лежащее в
 * этаже, уезжает вместе с ними.
 *
 * Перенос записывается в `part.move`: по нему сшивка узнаёт, что пачка этажей
 * уехала целиком и одинаково, — только тогда её дерево годится как есть.
 */
export function volumeFloorPlace(part, { baseMm = 0, shiftMm = null } = {}) {
  if (!part || !part.at) return part;
  const lift = Number(baseMm) || 0;
  const toX = Number(shiftMm && shiftMm.x) || 0;
  const toY = Number(shiftMm && shiftMm.y) || 0;
  const dz = lift - part.at.baseMm;
  const dx = toX - part.at.dx;
  const dy = toY - part.at.dy;
  part.fresh = false;
  part.move = { dx, dy, dz };
  if (dx === 0 && dy === 0 && dz === 0) return part;
  for (const face of part.sub.faces) {
    for (const point of face.p) {
      point.x += dx;
      point.y += dy;
      point.z += dz;
    }
  }
  for (const point of part.cuts) {
    point.x += dx;
    point.y += dy;
    point.z += dz;
  }
  volumeMovePlanes(part.tree, dx, dy, dz);
  part.at.baseMm = lift;
  part.at.dx = toX;
  part.at.dy = toY;
  return part;
}

/**
 * Ключ этажа: доводы, из которых он собран. Сошлись все — этаж тот же.
 *
 * `project` сравнивается **ссылкой**: правка объекта заводит новый объект
 * (`model.js` возвращает новый из каждой функции), и равенство ссылок значит
 * «не менялось ничего». Ошибиться в эту сторону нельзя: разошлись ссылки —
 * этаж соберётся заново, даже если правили чужую схему.
 *
 * Открытые двери, шторы и спрятанные вещи приходят **одним множеством на все
 * этажи**, и спрашивать его целиком нельзя: дверь первого этажа пересобирала бы
 * второй. Поэтому у каждого этажа берётся его доля — `known` — те двери, шторы
 * и вещи, которые есть у него самого.
 *
 * Чего в ключе нет нарочно: база этажа, смещение плана и «свой ли он». Это не
 * то, из чего этаж собран, а то, куда он поставлен, — и меняется переносом
 * (`volumeFloorPlace`).
 */
export function volumeFloorKey(project, schemeId, options, cover, upper, known) {
  const mine = known || { doors: [], sheers: [], objects: [] };
  const chosen = (ids, open) => {
    const out = [];
    for (const id of ids || []) if (volumeDoorOpen(open, id)) out.push(id);
    return out.join(" ");
  };
  return {
    project,
    schemeId,
    marks: options.marks || null,
    roofOff: options.roofOff === true,
    // Контур изображения поверх модели (G15): умолчание — рисуется, как в
    // `volumeScene`. Переключили — этаж собирается заново, иначе готовый этаж
    // стопки остался бы с картинкой, которую убрали.
    markImages: options.markImages !== false,
    // «Прозрачные объекты» (правка после сборки сценариев): переключили — этаж
    // собирается заново, как у контура меток.
    objectsClear: options.objectsClear !== false,
    upper: upper === true,
    capMm: cover && cover.capMm !== undefined ? cover.capMm : null,
    coverX: (cover && cover.dx) || 0,
    coverY: (cover && cover.dy) || 0,
    doors: chosen(mine.doors, options.openDoorIds),
    sheers: chosen(mine.sheers, options.openCurtainIds),
    // Позиции штор этажа (таск 09 сценариев): сдвинулась штора — этаж
    // собирается заново. Закрытая и без позиции — одна и та же штора.
    curtains: options.curtainShares
      ? (mine.sheers || [])
          .map((id) => [id, volumeCurtainShare(options.curtainShares, id)])
          .filter(([, share]) => share > 0)
          .map(([id, share]) => id + ":" + share)
          .join(" ")
      : "",
    hidden: chosen(mine.objects, options.hiddenObjectIds),
  };
}

/** Тот же ключ или нет. Метки сравниваются поштучно: список собран заново. */
export function volumeFloorKeySame(was, now) {
  if (!was || !now) return false;
  if (
    was.project !== now.project ||
    was.schemeId !== now.schemeId ||
    was.roofOff !== now.roofOff ||
    was.markImages !== now.markImages ||
    was.objectsClear !== now.objectsClear ||
    was.upper !== now.upper ||
    was.capMm !== now.capMm ||
    was.coverX !== now.coverX ||
    was.coverY !== now.coverY ||
    was.doors !== now.doors ||
    was.sheers !== now.sheers ||
    was.curtains !== now.curtains ||
    was.hidden !== now.hidden
  ) {
    return false;
  }
  if (was.marks === now.marks) return true;
  if (!was.marks || !now.marks || was.marks.length !== now.marks.length) return false;
  for (let at = 0; at < was.marks.length; at += 1) if (was.marks[at] !== now.marks[at]) return false;
  return true;
}
