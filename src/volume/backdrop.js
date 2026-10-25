// «Объём»: фон — панорама вокруг дома: горизонт, земля, деревья, горы, город,
// облака, светила на небе.
//
// Часть «Объёма», вынесенная из `src/volume.js` (2026-10-25) переносом без
// переименований: снаружи модуль читают через дверь `volume.js`, а соседи по
// `src/volume/` — напрямую. Зависимости идут только вниз по слоям (порядок —
// в шапке `volume.js`), циклов нет. Решения и доводы — в шапках разделов ниже.
import { VOLUME_SUNRISE_MIN, VOLUME_SUNSET_MIN } from "../clockMath.js";
import { DEG, VOLUME_NEAR_MM, VOLUME_SUN_AT } from "./measures.js";
import { volumeShare01, volumeTintCss } from "./faces.js";
import { volumeBasis, volumeFocal, volumeHorizon } from "./camera.js";
import {
  VOLUME_BACKDROP_DEFAULT,
  VOLUME_HILL_FAR,
  VOLUME_HILL_NEAR,
  VOLUME_MOUNTAIN_FAR_ROCK,
  VOLUME_MOUNTAIN_FAR_SNOW,
  VOLUME_MOUNTAIN_ROCK,
  VOLUME_MOUNTAIN_SNOW,
} from "./palette.js";
import {
  VOLUME_FOG_GROUND,
  VOLUME_MOON_SIZE_DEG,
  VOLUME_MOON_THIN,
  volumeHexRgb,
  volumeMood,
  volumeMoonShape,
} from "./sky.js";

/** Ближе этого направление считается ушедшим за край: делить на нуль нельзя. */
const VOLUME_SKY_NEAR = 0.08;

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

// ——— вещи фона стоят на земле (таск 199, дефект D53) ————————————————————————
//
// Слова заказчика: «всё эти объекты должны быть на одном уровне с фундаментом.
// по сути на „фундаменте“ стоять. что бы я смотрел вдоль горизонта и всегда
// были видны ровно прямо», и про прежнюю сборку — «когда опускаешься на
// фундамент объекты фона (машинки, деревья) уменьшаются, подлетаешь —
// увеличиваются».
//
// **Это четвёртый заход на одно и то же, и первые три не могли сработать.**
// G237 (таск 157) ставил дом на землю, D43 (178) чинил «дом летает», D52 (196)
// сводил кромку плиты с кольцом фона множителем. Все три правили сцену или
// кольцо, а причина была в другом: **у вещей фона не было дальностей вовсе.**
// Панорама рисовалась на небосводе — у вещи были только сторона света и высота
// над горизонтом, — и «насколько она далеко» выходило из её же роста. Отсюда
// ровно то, что заказчик видит: вещь висит на небосводе, а не стоит на земле, а
// множитель T196, отодвигавший кольцо по высоте глаза, менял её размер при
// подъёме и спуске (0,311 на первом этаже против 1,000 в обзоре).
//
// Теперь **у каждой вещи фона есть место на земле**: `x`, `y` в миллиметрах от
// середины чертежа и высота в миллиметрах. Нулевая отметка у них та же, что у
// фундамента, и проекция та же, что у граней сцены (`volumeGroundPoint`).
// «На одном уровне с фундаментом» выходит само: отошёл — вещь уменьшилась,
// подошёл — выросла, и это правда, а не подгонка. Множителя `volumeGroundScale`
// и кольца больше нет ни одного.
//
// **Небо осталось на бесконечности** (`volumeSkyAim`, `volumeSkyPoint`): солнце,
// луна, звёзды, облака и растяжка неба при ходьбе двигаться не должны — у них
// направление, а не место.
//
// ——— докуда расставлено и почему ——————————————————————————————————————————
//
// Числа подобраны так, чтобы вещь читалась тем, чем она есть, из двух мест
// сразу: с уровня глаз (1,6 м) и из обзора (камера в полутора-четырёх десятках
// метров над домом). Мера одна — **угловой размер с уровня глаз**:
//
//   кусты          38…60 м    1,6…2,4 м   — 2…4°, подлесок у кромки участка;
//   ближние деревья 45…75 м   7…12 м      — 8…14°, «прямо перед глазами»;
//   средний ряд    110…190 м  9…16 м      — 4…7°;
//   дальний ряд    380…700 м  11…18 м     — 1,2…2,5°, обжитой горизонт;
//   дорога         150…900 м  ширина 7 м  — уходит к горизонту;
//   река           220…1200 м ширина 24 м;
//   гряды холмов   1,6 и 3,2 км, 45 и 110 м — 1,6° и 2,0°, «небольшой ландшафт»;
//   горы           7,5 км, 700…1400 м      — 5,3…10,6°, дальний план;
//   улицы города   120…800 м, ширина 14 м;
//   ближние дома   220…300 м, 28…38 м      — 5,3…9,8°, многоэтажка в квартале;
//   дальние дома   600…900 м, 18…28 м      — 1,2…2,7°;
//   машины         95…120 м, 1,5 м         — 0,7…0,9°, пятнышки на парковке.
//
// Ближе 38 м не ставится ничего, и это не вкус: земляная плита сцены (D43)
// выкроена по габариту чертежа плюс вынос под тень, у объекта заказчика это
// круг радиусом 26,5 м. Вещь внутри плиты была бы ею срезана — тем самым швом,
// из-за которого затевался T196. Запас до плиты — `VOLUME_BACKDROP_CLEAR_MM`.

/** Миллиметры в метре: фон размечен метрами, а сцена живёт в миллиметрах. */
const VOLUME_M = 1000;

/**
 * Дальше этого зелень фона бледнеет: триста метров — та дальность, с которой
 * воздух уже заметно съедает цвет, а крона перестаёт читаться отдельными
 * пятнами. До таска 199 то же решала высота основания над горизонтом, потому
 * что настоящей дальности у вещи не было.
 */
const VOLUME_TREE_FAR_MM = 300 * VOLUME_M;

/**
 * Самое близкое, что фон ставит на землю, и запас до кромки плиты.
 *
 * Если чертёж большой (плита радиусом больше, чем ближний куст), **вся**
 * расстановка отъезжает одним множителем — `volumeBackdropPlaces`. Множитель
 * зависит только от размера чертежа и ни от чего больше: ни от камеры, ни от
 * высоты глаза, ни от часа. Именно этим он отличается от отменённого
 * `volumeGroundScale`, который дышал от высоты глаза.
 */
export const VOLUME_BACKDROP_NEAR_MM = 32 * VOLUME_M;
export const VOLUME_BACKDROP_CLEAR_MM = 5 * VOLUME_M;

/** Место на земле: сторона света и дальность в метрах. */
function volumeAway(azDeg, metres) {
  return { x: Math.cos(azDeg * DEG) * metres * VOLUME_M, y: Math.sin(azDeg * DEG) * metres * VOLUME_M };
}

/** Вещь, стоящая на земле: место, высота в миллиметрах и порода. */
function volumeStanding(azDeg, metres, heightM, kind) {
  const spot = volumeAway(azDeg, metres);
  return { x: spot.x, y: spot.y, heightMm: heightM * VOLUME_M, awayMm: metres * VOLUME_M, kind };
}

/**
 * Деревья и кустарники: три дальности по всему кругу.
 *
 * Ближний ряд заказчик просил прямо («что бы я смотрел вдоль горизонта и всегда
 * были видны ровно прямо»), дальний держит горизонт обжитым, когда смотришь
 * между ближними. Бледнее дальнее становится само — по настоящей дальности, а
 * не по высоте основания над горизонтом, как считалось в кольце.
 */
export const VOLUME_TREES = [
  // дальний ряд по всему кругу: 230…430 м
  volumeStanding(10, 320, 14, "tree"),
  volumeStanding(48, 380, 12, "spruce"),
  volumeStanding(95, 265, 16, "poplar"),
  volumeStanding(140, 410, 13, "spruce"),
  volumeStanding(185, 295, 15, "tree"),
  volumeStanding(228, 430, 11, "birch"),
  volumeStanding(262, 240, 18, "spruce"),
  volumeStanding(305, 345, 13, "tree"),
  volumeStanding(345, 395, 15, "spruce"),
  // средний ряд: 70…120 м
  volumeStanding(30, 95, 12, "spruce"),
  volumeStanding(78, 118, 14, "poplar"),
  volumeStanding(112, 78, 10, "tree"),
  volumeStanding(171, 104, 13, "birch"),
  volumeStanding(200, 88, 11, "tree"),
  volumeStanding(275, 72, 9, "spruce"),
  volumeStanding(330, 110, 16, "tree"),
  // Берёзовая роща (таск 181: «плюс ещё немного берёз»): три белых ствола
  // подряд в ближнем ряду и ещё три врозь — в среднем и дальнем.
  volumeStanding(16, 36, 9, "birch"),
  volumeStanding(22, 40, 11, "birch"),
  volumeStanding(28, 34, 8, "birch"),
  volumeStanding(145, 82, 12, "birch"),
  volumeStanding(252, 98, 10, "birch"),
  volumeStanding(68, 280, 12, "birch"),
  // ближний ряд — то, о чём просил заказчик: 33…50 м
  volumeStanding(62, 40, 11, "tree"),
  volumeStanding(128, 44, 10, "birch"),
  volumeStanding(155, 34, 9, "spruce"),
  volumeStanding(212, 50, 12, "poplar"),
  volumeStanding(248, 38, 10, "tree"),
  volumeStanding(352, 47, 12, "tree"),
  // кустарники — ниже деревьев и ближе к земле: 32…45 м
  volumeStanding(44, 35, 2.1, "bush"),
  volumeStanding(88, 32, 1.8, "bush"),
  volumeStanding(133, 42, 2.4, "bush"),
  volumeStanding(176, 33, 1.6, "bush"),
  volumeStanding(219, 38, 2.2, "bush"),
  volumeStanding(295, 32, 1.9, "bush"),
  volumeStanding(315, 45, 2.3, "bush"),
];
/**
 * Узлы полосы, лежащей на земле: середина и половина ширины.
 *
 * У полосы два края, и считаются они **поперёк её же хода** — по направлению от
 * узла к узлу. Поэтому изгиб дороги не растягивает её ширину: семь метров
 * остаются семью метрами и на повороте.
 */
function volumeBandNodes(points, widthM) {
  const middles = points.map(([az, away]) => volumeAway(az, away));
  const half = (widthM / 2) * VOLUME_M;
  return middles.map((spot, index) => {
    const prev = middles[Math.max(0, index - 1)];
    const next = middles[Math.min(middles.length - 1, index + 1)];
    const dx = next.x - prev.x;
    const dy = next.y - prev.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    return {
      x: spot.x,
      y: spot.y,
      awayMm: Math.hypot(spot.x, spot.y),
      left: { x: spot.x + nx * half, y: spot.y + ny * half },
      right: { x: spot.x - nx * half, y: spot.y - ny * half },
    };
  });
}

/**
 * Дорога: приходит с запада-северо-запада и уводит на северо-восток. Ширина
 * семь метров — две полосы просёлка; ближнее колено в полутора сотнях метров,
 * дальнее — почти в километре.
 */
export const VOLUME_ROAD = volumeBandNodes(
  [
    [286, 95],
    [300, 135],
    [315, 195],
    [330, 275],
    [345, 370],
    [358, 470],
    [12, 560],
    [26, 640],
  ],
  9,
);

/** Река: с юго-востока к югу, шире дороги и извилистее — вода не спрямлена. */
export const VOLUME_RIVER = volumeBandNodes(
  [
    [118, 105],
    [131, 150],
    [142, 205],
    [156, 275],
    [168, 360],
    [179, 455],
    [191, 560],
    [204, 670],
  ],
  60,
);

/**
 * Гряда холмов (G232): вереница узлов на своей дальности, у каждого высота над
 * землёй. Рисуется силуэтом — низ по земле, верх по гребню.
 *
 * Мера прежняя, «небольшой ландшафт»: дальняя гряда 110 м в 3,2 км (2,0°),
 * ближняя 45 м в 1,6 км (1,6°). Для сравнения, ближнее дерево в полусотне
 * метров — 11°, то есть холмы остались фоном, а не стеной над домом.
 */
function volumeRidge(rises, away, step) {
  return rises.map((rise, index) => {
    const spot = volumeAway((index * 360) / rises.length, away);
    return { x: spot.x, y: spot.y, awayMm: away * VOLUME_M, heightMm: rise * step * VOLUME_M };
  });
}

export const VOLUME_HILLS = [
  {
    far: true,
    color: VOLUME_HILL_FAR,
    awayM: 2400,
    nodes: volumeRidge([1.5, 2.6, 2.1, 1.2, 1.9, 2.4, 1.4, 2.0, 2.6, 1.7, 1.1, 2.2, 1.8, 2.5], 2400, 34),
  },
  {
    far: false,
    color: VOLUME_HILL_NEAR,
    awayM: 1200,
    nodes: volumeRidge([0.9, 0.5, 1.4, 1.6, 0.8, 1.1, 1.5, 0.6, 1.2, 1.55, 0.95, 0.7, 1.35, 1.05], 1200, 22),
  },
];

/**
 * Гряда: несколько вершин разной высоты, перекрывающих друг друга. `at` — сдвиг
 * по стороне света от середины гряды, `height` — высота вершины **в метрах**,
 * `half` — половина ширины подножия в метрах, `snow` — какая доля вершины под
 * снегом.
 *
 * Дальность у обоих рядов одна — 7,5 км; разница в высоте, ширине и цвете.
 * Гора в 1,4 км высотой с этого расстояния видна под 10,6°, то есть выше
 * холмов (2°), но втрое ниже ближнего дерева в полусотне метров (11°): дальний
 * план, а не стена над домом.
 */
function volumeRange(peaks, away, rock, snowColor, far) {
  return peaks.map(([at, height, half, snow]) => {
    const az = (VOLUME_SUN_AT.az + 180 + at + 360) % 360;
    const spot = volumeAway(az, away);
    return {
      x: spot.x,
      y: spot.y,
      awayMm: away * VOLUME_M,
      heightMm: height * VOLUME_M,
      halfMm: half * VOLUME_M,
      snow,
      rock,
      snowColor,
      // Дальний ряд бледнее ближнего, и красит его час (`mood.palette`).
      far: Boolean(far),
    };
  });
}

export const VOLUME_MOUNTAIN_AWAY_M = 7500;

export const VOLUME_MOUNTAINS = [
  // Дальний ряд — выше и бледнее, и он же рисуется первым.
  ...volumeRange(
    [
      [-19, 1150, 1500, 0.34],
      [-4, 1400, 1750, 0.4],
      [13, 1000, 1350, 0.3],
    ],
    VOLUME_MOUNTAIN_AWAY_M,
    VOLUME_MOUNTAIN_FAR_ROCK,
    VOLUME_MOUNTAIN_FAR_SNOW,
    true,
  ),
  // Ближний ряд — ниже и темнее: он перекрывает подножия дальнего.
  ...volumeRange(
    [
      [-27, 760, 1150, 0.26],
      [-11, 940, 1300, 0.3],
      [4, 810, 1250, 0.26],
      [21, 890, 1400, 0.28],
    ],
    VOLUME_MOUNTAIN_AWAY_M,
    VOLUME_MOUNTAIN_ROCK,
    VOLUME_MOUNTAIN_SNOW,
    false,
  ),
];

/**
 * Кусты и деревья **по берегам реки** (G232). Слова заказчика: «а у реки кусты
 * и деревья по берегам».
 *
 * Считаются из самих узлов реки, а не выписаны второй таблицей рядом: сдвинь
 * реку — зелень уйдёт вместе с ней. Правила те же, что были, только в метрах:
 * зелень стоит **у самой кромки** (отступ в полширины реки от края), на
 * **обоих** берегах, а высота падает с дальностью — у ближнего колена ива в
 * восемь метров, у дальнего куст в полтора. Вид чередуется по узлу: ряд
 * одинаковых кустов читался бы забором.
 */
export function volumeRiverGreens(river) {
  const greens = [];
  const kinds = ["bush", "willow", "bush", "birch", "willow", "spruce"];
  const far = river[river.length - 1].awayMm;
  river.forEach((node, index) => {
    // Дальние колена реки у горизонта: там зелень выродилась бы в точку, и её
    // нет вовсе — пустой горизонт честнее мусора на нём.
    if (node.awayMm > far * 0.8) return;
    const share = 1 - node.awayMm / far;
    const heightMm = (1.6 + share * 6.4) * VOLUME_M;
    const bank = (edge, sign, grow, kind) => {
      const dx = edge.x - node.x;
      const dy = edge.y - node.y;
      greens.push({
        x: edge.x + dx * sign,
        y: edge.y + dy * sign,
        awayMm: Math.hypot(edge.x + dx * sign, edge.y + dy * sign),
        heightMm: heightMm * grow,
        kind,
      });
    };
    bank(node.left, 0.35, 1, kinds[index % kinds.length]);
    bank(node.right, 0.35, 0.78, kinds[(index + 1) % kinds.length]);
    // У ближних колен берег **гуще**: там видно отдельные кусты, и один куст на
    // берег читался бы случайной кочкой, а не зарослями у воды.
    if (index > 1) return;
    bank(node.left, 1.1, 0.62, "bush");
    bank(node.right, 1.1, 0.5, "bush");
  });
  return greens;
}

export const VOLUME_RIVER_GREENS = volumeRiverGreens(VOLUME_RIVER);

// ——— две камеры: небо на бесконечности, земля на своих местах ————————————
//
// Прицелов теперь два, и разница между ними — это разница между «направлением»
// и «местом».
//
//   **Небо** (`volumeSkyAim`, `volumeSkyPoint`) знает только направление.
//   Солнце, луна, звёзды, облака и растяжка неба при ходьбе стоять обязаны:
//   отойти от солнца на десять метров нельзя. Множителя `ground`, которым таск
//   196 отодвигал кольцо по высоте глаза, здесь больше нет — он и был дефектом
//   D53.
//
//   **Земля** (`volumeGroundAim`, `volumeGroundPoint`) знает место: точка в
//   миллиметрах чертежа, та же система координат и та же проекция, что у граней
//   сцены. Поэтому дерево в полусотне метров ведёт себя как дерево: подошёл —
//   выросло, отошёл — уменьшилось, поднялся на второй этаж — осталось тем же.

/**
 * Прицел земли: базис камеры, фокус, середина окна и **место камеры**.
 *
 * Считается один раз на кадр, как и небесный. Место здесь обязательно: у вещи
 * фона есть свои координаты, и без места камеры их не во что переводить.
 */
export function volumeGroundAim(camera, box) {
  return {
    basis: volumeBasis(camera),
    focal: volumeFocal(box),
    halfWidth: box.width / 2,
    halfHeight: box.height / 2,
    at: camera.at,
  };
}

/**
 * Точка земли в экран — **той же проекцией, что грани сцены**.
 *
 * `null` — точка за ближней плоскостью (`VOLUME_NEAR_MM`), то есть за спиной
 * или впритык к глазу. На кольце отбрасывать было нечего (у направления нет
 * «за спиной» в половине случаев — есть, но половина круга всегда считалась),
 * а у вещей с настоящими местами за спиной оказывается добрая половина, и это
 * экономит кадр.
 *
 * `scale` — сколько экранных точек даёт **миллиметр** на этой дальности.
 * Отвесный отрезок высотой `h` занимает на экране ровно `h · scale` точек, и
 * этим считаются все размеры вещей фона: высота дерева, ширина дома, кузов
 * машины. Перспектива у них от этого та же, что у стен дома.
 */
export function volumeGroundPoint(aim, xMm, yMm, zMm = 0) {
  const dx = xMm - aim.at.x;
  const dy = yMm - aim.at.y;
  const dz = (zMm || 0) - aim.at.z;
  const { basis, focal } = aim;
  const depth = dx * basis.fwd.x + dy * basis.fwd.y + dz * basis.fwd.z;
  if (!(depth > VOLUME_NEAR_MM)) return null;
  const right = dx * basis.right.x + dy * basis.right.y + dz * basis.right.z;
  const up = dx * basis.up.x + dy * basis.up.y + dz * basis.up.z;
  const scale = focal / depth;
  return { x: aim.halfWidth + right * scale, y: aim.halfHeight - up * scale, scale, depth };
}

/**
 * Насколько человек далёк от земляной плиты в плане: ноль — стоит на ней.
 *
 * Этим числом решается порядок рисования (см. `volumeDrawBackdrop`): вещь фона,
 * которая **ближе** плиты, не может быть закрыта домом — дом стоит на плите.
 */
export function volumePlateGap(land, at) {
  if (!land || !at) return 0;
  const dx = Math.max(Number(land.minX) - at.x, 0, at.x - Number(land.maxX));
  const dy = Math.max(Number(land.minY) - at.y, 0, at.y - Number(land.maxY));
  return Math.hypot(dx, dy);
}

/**
 * Расстановка фона под этот чертёж.
 *
 * Числа таблиц писаны от середины чертежа и рассчитаны на обычную квартиру:
 * ближний куст в 38 м, плита заказчика радиусом 26,5 м. У большого чертежа
 * (ангар, посёлок) плита вырастает, и вещь, писанная на 38 м, оказалась бы
 * внутри неё — то есть срезанной её кромкой. Поэтому вся расстановка отъезжает
 * **одним множителем**, и он зависит **только от размера чертежа**: ни от
 * камеры, ни от высоты глаза, ни от часа. Этим он и отличается от отменённого
 * `volumeGroundScale`, из-за которого фон дышал при подъёме (D53).
 *
 * Множитель — единица в обычном случае, и тогда таблицы отдаются как есть, без
 * копирования.
 */
const VOLUME_BACKDROP_CACHE = new Map();

export function volumeBackdropPush(land) {
  if (!land) return 1;
  const reach = Math.hypot((Number(land.maxX) - Number(land.minX)) / 2, (Number(land.maxY) - Number(land.minY)) / 2);
  if (!(reach > 0)) return 1;
  const want = (reach + VOLUME_BACKDROP_CLEAR_MM) / VOLUME_BACKDROP_NEAR_MM;
  // Шаг множителя — десятая доля: иначе каждый чертёж получал бы свою
  // расстановку, а кэш — свою запись.
  return Math.max(1, Math.ceil(want * 10) / 10);
}

function volumePushSpot(spot, push) {
  return { ...spot, x: spot.x * push, y: spot.y * push, awayMm: (spot.awayMm || 0) * push };
}

function volumePushBand(nodes, push) {
  return nodes.map((node) => ({
    ...volumePushSpot(node, push),
    left: { x: node.left.x * push, y: node.left.y * push },
    right: { x: node.right.x * push, y: node.right.y * push },
  }));
}

/**
 * Вещи фона на земле для этого чертежа. Таблицы — общие, множитель — свой.
 *
 * Высоты **не растягиваются**: отодвинутое дерево остаётся деревом в девять
 * метров, просто видно его мельче. Растянуть высоту значило бы вернуть кольцо,
 * у которого размер зависел не от вещи, а от того, где стоит смотрящий.
 */
export function volumeBackdropPlaces(land) {
  const push = volumeBackdropPush(land);
  const kept = VOLUME_BACKDROP_CACHE.get(push);
  if (kept) return kept;
  const made =
    push === 1
      ? {
          push,
          trees: VOLUME_TREES,
          road: VOLUME_ROAD,
          river: VOLUME_RIVER,
          greens: VOLUME_RIVER_GREENS,
          hills: VOLUME_HILLS,
          mountains: VOLUME_MOUNTAINS,
          city: VOLUME_CITY,
          streets: VOLUME_CITY_STREETS,
          marks: VOLUME_CITY_MARKS,
          park: VOLUME_CITY_PARK,
          banners: VOLUME_CITY_BANNER_PLACES,
          cityGreens: VOLUME_CITY_GREENS,
        }
      : {
          push,
          trees: VOLUME_TREES.map((tree) => volumePushSpot(tree, push)),
          road: volumePushBand(VOLUME_ROAD, push),
          river: volumePushBand(VOLUME_RIVER, push),
          greens: VOLUME_RIVER_GREENS.map((green) => volumePushSpot(green, push)),
          hills: VOLUME_HILLS.map((ridge) => ({
            ...ridge,
            nodes: ridge.nodes.map((node) => volumePushSpot(node, push)),
          })),
          mountains: VOLUME_MOUNTAINS.map((peak) => ({
            ...volumePushSpot(peak, push),
            halfMm: peak.halfMm * push,
          })),
          city: VOLUME_CITY.map((block) => ({
            ...volumePushSpot(block, push),
            halfMm: block.halfMm * push,
            deepMm: block.deepMm * push,
          })),
          streets: VOLUME_CITY_STREETS.map((street) => volumePushBand(street, push)),
          marks: VOLUME_CITY_MARKS.map((street) => volumePushBand(street, push)),
          park: VOLUME_CITY_PARK.map((car) => volumePushSpot(car, push)),
          banners: VOLUME_CITY_BANNER_PLACES.map((banner) => ({
            ...volumePushSpot(banner, push),
            halfMm: banner.halfMm * push,
          })),
          cityGreens: VOLUME_CITY_GREENS.map((green) => volumePushSpot(green, push)),
        };
  VOLUME_BACKDROP_CACHE.set(push, made);
  return made;
}

/**
 * Прицел панорамы: базис камеры, фокус и середина окна. Считается один раз на
 * кадр — все вещи фона смотрят через него.
 *
 * `ground` — множитель, которым земля панорамы отодвинута за кромку земли сцены
 * (D52, `volumeGroundScale`). Единица — прицел, каким он был до таска 196;
 * светило, звёзды и облака смотрят **через него**, а не через земной: небу
 * кромка плиты не указ.
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
 * Прогоны полосы: вереницы узлов, попавших в кадр подряд.
 *
 * Узел за спиной `volumeGroundPoint` отдаёт как `null`, и полоса от этого
 * рвётся — у дороги длиной в километр это обычное дело, а у вещей с настоящими
 * местами за спиной оказывается добрая половина. Поэтому полоса рисуется не
 * одним многоугольником, а прогонами: соседние узлы делят ребро ровно, и стыка
 * между ними не видно.
 *
 * Чистая и вынесена наружу: разрыв полосы на краю кадра глазами не поймаешь.
 */
export function volumeStripRuns(aim, nodes) {
  const runs = [];
  let run = null;
  for (const node of nodes) {
    const top = volumeGroundPoint(aim, node.left.x, node.left.y, 0);
    const bottom = volumeGroundPoint(aim, node.right.x, node.right.y, 0);
    if (!top || !bottom) {
      run = null;
      continue;
    }
    if (!run) {
      run = [];
      runs.push(run);
    }
    run.push({ top, bottom });
  }
  return runs.filter((item) => item.length > 1);
}

// Заливка полосы: одна растяжка от ближнего края к дальнему. Ближний край — низ
// первого узла, дальний — верх последнего: так растяжка идёт вдоль полосы, а не
// поперёк, и выцветание получается по дальности, а не по высоте.
function volumeStripFill(ctx, run, near, far) {
  const from = run[0].bottom;
  const to = run[run.length - 1].top;
  const fade = ctx.createLinearGradient(from.x, from.y, to.x, to.y);
  fade.addColorStop(0, near);
  fade.addColorStop(1, far);
  return fade;
}

function volumeDrawStrip(ctx, aim, nodes, paint) {
  for (const run of volumeStripRuns(aim, nodes)) {
    ctx.beginPath();
    ctx.moveTo(run[0].top.x, run[0].top.y);
    for (let index = 1; index < run.length; index += 1) ctx.lineTo(run[index].top.x, run[index].top.y);
    for (let index = run.length - 1; index >= 0; index -= 1) ctx.lineTo(run[index].bottom.x, run[index].bottom.y);
    ctx.closePath();
    ctx.fillStyle = paint(run);
    ctx.fill();
  }
}

/**
 * Гряда холмов силуэтом: низ по земле, верх по гребню. Та же разбивка на
 * прогоны, что у полосы, — гряда идёт по кругу, и половина её за спиной.
 */
function volumeDrawRidge(ctx, aim, ridge, palette) {
  let run = null;
  const runs = [];
  for (const node of ridge.nodes) {
    const foot = volumeGroundPoint(aim, node.x, node.y, 0);
    const crest = volumeGroundPoint(aim, node.x, node.y, node.heightMm);
    if (!foot || !crest) {
      run = null;
      continue;
    }
    if (!run) {
      run = [];
      runs.push(run);
    }
    run.push({ foot, crest });
  }
  for (const line of runs) {
    if (line.length < 2) continue;
    ctx.beginPath();
    ctx.moveTo(line[0].crest.x, line[0].crest.y);
    for (let index = 1; index < line.length; index += 1) ctx.lineTo(line[index].crest.x, line[index].crest.y);
    for (let index = line.length - 1; index >= 0; index -= 1) ctx.lineTo(line[index].foot.x, line[index].foot.y);
    ctx.closePath();
    ctx.fillStyle = ridge.far ? palette.hillFar : palette.hillNear;
    ctx.fill();
  }
}

/**
 * Фон кадра: небо со светилом, звёздами и облаками, земля, а дальше то, что
 * выбрано видом фона (G273) — ничего, природа или город.
 *
 * Возвращается строка горизонта: по ней окно рисует миникарту и подписи, и
 * второго её счёта в сборке нет.
 *
 * `mood` — снимок часа (`volumeMood`), посчитанный **не здесь**: кадр про время
 * не считает ничего, он берёт готовые цвета. `land` — прямоугольник земляной
 * плиты (`scene.landMm`): по нему решается расстановка и порядок рисования.
 *
 * ——— земля до горизонта ———
 *
 * Земля — **одна заливка** ниже строки горизонта, и это буквально та земля,
 * которая до горизонта и доходит: строка горизонта и есть место, куда уходит
 * плоскость на уровне глаз. Сетки узлов здесь нет и не нужно — у ровной земли
 * без рельефа делить нечего, а тысячи точек на кадр стоили бы дороже всего
 * остального фона вместе взятого. Плита сцены (`VOLUME_LAYER_BASE`) лежит
 * внутри этой заливки тем же тоном (G237) и несёт на себе тень дома и
 * солнечные пятна; кромки между ними не видно ни при каком взгляде, потому что
 * это один цвет, покрашенный одним часом.
 *
 * ——— порядок рисования (таск 199) ———
 *
 * Вещи фона **не идут в дерево порядка сцены** (`volumeOrderTree`), и это
 * решение, а не упущение: дерево строится при сборке сцены (9 мс на объекте
 * заказчика), и класть в него десятки вещей фона значило бы пересобирать его
 * при каждой правке чертежа ради того, что от чертежа не зависит. Вместо дерева
 * — **одно правило о дальности, которое всегда верно**:
 *
 *   вещь фона стоит **снаружи плиты**, а дом стоит **на плите**;
 *   значит дом ближе смотрящего только тогда, когда смотрящий **дальше плиты**,
 *   и ровно настолько, насколько вещь ближе её кромки.
 *
 * Отсюда два прохода. `volumeDrawBackdrop` рисует небо, землю и всё, что
 * **дальше** ближней кромки плиты, — дом его закроет, и это правда.
 * `volumeDrawBackdropNear` рисует то, что **ближе** кромки, и зовётся оно уже
 * после сцены: такую вещь дом закрыть не может, она перед ним. Внутри плиты
 * (человек ходит по дому) ближе кромки нет ничего, и второй проход пуст.
 *
 * Цена ошибки названа прямо: вещь, которая дальше ближней кромки, но ближе
 * дальней стены дома, рисуется под домом. Случается это только в обзоре с
 * отлёта, где дом и есть то, на что смотрят.
 */
export function volumeDrawBackdrop(ctx, box, camera, mood = null, land = null) {
  const hour = mood || VOLUME_MOOD_NOON;
  const palette = hour.palette;
  const horizonY = volumeHorizon(camera, box);
  const line = Math.max(-box.height, Math.min(box.height * 2, horizonY));
  const sky = ctx.createLinearGradient(0, Math.min(0, line - box.height), 0, line);
  sky.addColorStop(0, hour.sky.top);
  sky.addColorStop(1, hour.sky.low);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, box.width, Math.max(0, line));
  // Небо знает направление, земля — место. Разницу между этими двумя прицелами
  // и чинит таск 199 (D53).
  const above = volumeSkyAim(camera, box);
  // Светило и звёзды — до земли: они за горизонтом и обрезаются ею.
  if (hour.stars > 0) volumeDrawStars(ctx, above, hour);
  volumeDrawSun(ctx, above, hour);
  volumeDrawMoon(ctx, above, hour);
  if (hour.kind !== "plain") volumeDrawClouds(ctx, above, hour);
  if (line < box.height) {
    // Земля — плоским тоном (G237): тем же, которым красится плита чертежа, и
    // дом от этого стоит на ней, а не на доске. Час красит обе одной краской
    // (`volumeTintRgb`), поэтому стык не виден и в полночь.
    ctx.fillStyle = palette.land;
    ctx.fillRect(0, Math.max(0, line), box.width, box.height - Math.max(0, line));
  }
  if (hour.kind !== "plain") volumeDrawGround(ctx, box, camera, hour, land, false);
  volumeDrawFogBand(ctx, box, line, hour);
  return line;
}

/**
 * Облака по погоде: в ясный день — прежние семь, в облачный — вдвое больше и
 * крупнее, под сплошными тучами — серые клочья по серому небу.
 */
function volumeDrawClouds(ctx, aim, hour) {
  const cloud = hour.weather ? volumeShare01(hour.weather.cloud) : 0;
  const palette = hour.palette;
  // В тумане облаков не видно вовсе: небо — сам туман.
  if (hour.weather && hour.weather.fog >= 1) return;
  if (!(cloud > 0.3)) {
    for (const one of VOLUME_CLOUDS) volumeDrawCloud(ctx, aim, one, palette.cloud);
    return;
  }
  const paint = cloud >= 1 ? palette.cloudDark : palette.cloud;
  for (const one of VOLUME_CLOUDS) volumeDrawCloud(ctx, aim, { ...one, size: one.size * 1.3 }, paint);
  for (const one of VOLUME_CLOUDS_MORE) volumeDrawCloud(ctx, aim, one, paint);
}

/** Ещё облака — для облачного и пасмурного неба. */
const VOLUME_CLOUDS_MORE = [
  { az: 0, rise: 12, size: 6 },
  { az: 48, rise: 21, size: 9 },
  { az: 95, rise: 13, size: 7 },
  { az: 142, rise: 23, size: 8.5 },
  { az: 200, rise: 10, size: 6 },
  { az: 262, rise: 22, size: 9 },
  { az: 300, rise: 12, size: 6.5 },
  { az: 345, rise: 25, size: 8 },
];

/**
 * Туман над землёй: полоса его цвета у горизонта, гуще всего на самом
 * горизонте и тоньше к низу кадра — дальнее тонет, ближнее видно.
 */
function volumeDrawFogBand(ctx, box, line, hour) {
  const fog = hour.tint && hour.tint.fog;
  if (!fog) return;
  const rgb = fog.rgb.join(",");
  const strength = volumeShare01(fog.share);
  const top = line - box.height * 0.3;
  const gradient = ctx.createLinearGradient(0, top, 0, box.height);
  const at = (y) => Math.max(0, Math.min(1, (y - top) / Math.max(1, box.height - top)));
  gradient.addColorStop(0, "rgba(" + rgb + ",0)");
  gradient.addColorStop(at(line), "rgba(" + rgb + "," + Math.round(strength * 100) / 100 + ")");
  // Ниже горизонта густота ровная — та же, что у земли плиты сцены
  // (`VOLUME_FOG_GROUND`): стыка земли у дома и земли за ним не видно и в тумане.
  gradient.addColorStop(Math.min(1, at(line) + 0.02), "rgba(" + rgb + "," + Math.round(strength * VOLUME_FOG_GROUND * 100) / 100 + ")");
  gradient.addColorStop(1, "rgba(" + rgb + "," + Math.round(strength * VOLUME_FOG_GROUND * 100) / 100 + ")");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, Math.max(0, top), box.width, box.height - Math.max(0, top));
}

/**
 * Второй проход фона: то, что **ближе** кромки плиты. Зовётся после сцены —
 * дом такую вещь закрыть не может (разбор у `volumeDrawBackdrop`).
 *
 * Внутри плиты проход пуст, и это обычный случай: человек ходит по дому.
 */
export function volumeDrawBackdropNear(ctx, box, camera, mood = null, land = null) {
  const hour = mood || VOLUME_MOOD_NOON;
  if (hour.kind === "plain") return;
  if (!(volumePlateGap(land, camera.at) > 0)) return;
  volumeDrawGround(ctx, box, camera, hour, land, true);
}

/**
 * Вещи фона, стоящие на земле, одним правилом на все три вида фона.
 *
 * `near` — какой проход: `false` — всё, что дальше ближней кромки плиты,
 * `true` — что ближе неё.
 *
 * **Порядок внутри прохода — по дальности, от дальнего к ближнему**, и считать
 * его дёшево: дальность у вещи своя, а не выведенная из её роста. Плоское
 * (дорога, река, улицы, разметка) рисуется до стоящего — оно лежит на земле и
 * закрыть собой дерево не может.
 */
function volumeDrawGround(ctx, box, camera, hour, land, near) {
  const palette = hour.palette;
  const aim = volumeGroundAim(camera, box);
  const places = volumeBackdropPlaces(land);
  const gap = volumePlateGap(land, camera.at);
  const at = camera.at;
  const mine = (spot) => {
    if (!(gap > 0)) return !near;
    const away = Math.hypot(spot.x - at.x, spot.y - at.y);
    return near ? away < gap : away >= gap;
  };
  const standing = [];
  const take = (list, paint) => {
    for (let index = 0; index < list.length; index += 1) {
      const spot = list[index];
      if (!mine(spot)) continue;
      standing.push({ depth: Math.hypot(spot.x - at.x, spot.y - at.y), spot, index, paint });
    }
  };
  if (hour.kind === "city") {
    if (!near) {
      for (let index = 0; index < places.streets.length; index += 1) {
        volumeDrawStrip(ctx, aim, places.streets[index], (run) =>
          volumeStripFill(ctx, run, palette.asphalt, palette.asphaltFar),
        );
        volumeDrawStrip(ctx, aim, places.marks[index], () => palette.mark);
      }
    }
    take(places.city, (spot, index) => volumeDrawBlock(ctx, aim, spot, index, hour));
    take(places.park, (spot) => volumeDrawCar(ctx, aim, spot, palette));
    take(places.banners, (spot) => volumeDrawBanner(ctx, aim, spot, hour));
    take(places.cityGreens, (spot) => volumeDrawTree(ctx, aim, spot, palette));
  } else {
    if (!near) {
      // Горы — самое далёкое, что есть в панораме: раньше всего, что стоит на
      // земле (G238). Полосы уходят за гряды, поэтому гряды после них.
      for (const peak of places.mountains) volumeDrawPeak(ctx, aim, peak, palette);
      volumeDrawStrip(ctx, aim, places.road, (run) =>
        volumeStripFill(ctx, run, palette.roadNear, palette.roadFar),
      );
      volumeDrawStrip(ctx, aim, places.river, (run) =>
        volumeStripFill(ctx, run, palette.riverNear, palette.riverFar),
      );
      for (const ridge of places.hills) volumeDrawRidge(ctx, aim, ridge, palette);
    }
    take(places.greens, (spot) => volumeDrawTree(ctx, aim, spot, palette));
    take(places.trees, (spot) => volumeDrawTree(ctx, aim, spot, palette));
  }
  // Порядок внутри прохода — по дальности, от дальнего к ближнему. Считать его
  // дёшево: дальность у вещи своя, а не выведенная из её роста, и сортируются
  // десятки вещей, а не тысячи граней.
  standing.sort((one, two) => two.depth - one.depth);
  for (const item of standing) item.paint(item.spot, item.index);
}

// ——— город (G273) ————————————————————————————————————————————————————————
//
// Улицы, парковка, дома, окна. Порядок тот же по смыслу, что у природы: улицы
// лежат на земле и уходят к горизонту, дома стоят на них, машины — перед
// ближними домами, зелень вдоль улиц. Дальний ряд домов рисуется раньше
// ближнего — он за ним.
//
// **Неоновых вывесок на домах нет** — требование G337 (таск 226) сняло их:
// заказчик завёл их в таске 206 словами «добавь туда рекламные баннеры и
// неоновые вывески», посмотрел город в объёме и решил убрать. Снято начисто:
// ни цвета неона в палитре, ни ветки «если вывеска», ни поля у дома. Щиты у
// дорог остались и ночью по-прежнему не светятся — про них речи не было.
// Светится ночью одно — окна.
/**
 * Дом города — **коробка** (дефект D57): лицо, бок и крыша.
 *
 * Долг таска 199 назывался так: «бок у дома города пропал, дом читается щитом».
 * Заказчик увидел это первым же взглядом — «плоские дома (о чем и говорил)».
 * Теперь у дома есть глубина, и в кадр идут **две стены из четырёх** — те, что
 * повёрнуты к камере; какие именно, решает сама камера, поэтому при облёте дом
 * поворачивается, а не схлопывается.
 *
 * Окна рисуются **на каждой видимой стене** своей сеткой, посчитанной из метров
 * (`VOLUME_CITY_FLOOR_MM`, `VOLUME_CITY_BAY_MM`), — у бока секций меньше, чем у
 * лица, ровно во столько раз, во сколько он у́же.
 *
 * Светящееся окно **не красится часом** (светит — значит не темнеет).
 */
function volumeDrawBlock(ctx, aim, block, index, hour) {
  const palette = hour.palette;
  // Лицо дома стоит поперёк взгляда на него, глубина уходит от середины
  // чертежа: `u` — вдоль лица, `f` — в глубину.
  const len = Math.hypot(block.x, block.y) || 1;
  const fx = block.x / len;
  const fy = block.y / len;
  const ux = -fy;
  const uy = fx;
  const deep = block.deepMm / 2;
  const corner = (alongSign, deepSign) => ({
    x: block.x + ux * block.halfMm * alongSign + fx * deep * deepSign,
    y: block.y + uy * block.halfMm * alongSign + fy * deep * deepSign,
  });
  // Четыре угла коробки в плане: лицо смотрит на дом (к середине чертежа).
  const plan = {
    faceLeft: corner(1, -1),
    faceRight: corner(-1, -1),
    backLeft: corner(1, 1),
    backRight: corner(-1, 1),
  };
  const walls = [
    { from: plan.faceLeft, to: plan.faceRight, wide: block.halfMm * 2, face: true },
    { from: plan.faceRight, to: plan.backRight, wide: block.deepMm, face: false },
    { from: plan.backRight, to: plan.backLeft, wide: block.halfMm * 2, face: false },
    { from: plan.backLeft, to: plan.faceLeft, wide: block.deepMm, face: false },
  ];
  const at = aim.at;
  const shown = [];
  for (const wall of walls) {
    // Стена видна, если её наружная нормаль смотрит на камеру. Обход коробки
    // задан по кругу (лицо → правый бок → зад → левый бок), и при этом обходе
    // наружу смотрит **правый** перпендикуляр ребра: у лица он уходит к
    // середине чертежа, то есть к дому, как и положено лицу.
    const ex = wall.to.x - wall.from.x;
    const ey = wall.to.y - wall.from.y;
    const nx = ey;
    const ny = -ex;
    const mx = (wall.from.x + wall.to.x) / 2;
    const my = (wall.from.y + wall.to.y) / 2;
    if (nx * (at.x - mx) + ny * (at.y - my) <= 0) continue;
    const left = volumeGroundPoint(aim, wall.from.x, wall.from.y, block.heightMm);
    const right = volumeGroundPoint(aim, wall.to.x, wall.to.y, block.heightMm);
    const footLeft = volumeGroundPoint(aim, wall.from.x, wall.from.y, 0);
    const footRight = volumeGroundPoint(aim, wall.to.x, wall.to.y, 0);
    if (!left || !right || !footLeft || !footRight) continue;
    shown.push({ ...wall, left, right, footLeft, footRight, depth: Math.hypot(mx - at.x, my - at.y) });
  }
  if (shown.length === 0) return;
  // Дальняя стена ложится первой: у коробки их видно самое большее две, и
  // спорить им не о чем, кроме порядка.
  shown.sort((one, two) => two.depth - one.depth);
  const lit = hour.cityLit;
  for (let wallIndex = 0; wallIndex < shown.length; wallIndex += 1) {
    const wall = shown[wallIndex];
    const { left, right, footLeft, footRight } = wall;
    // Бок темнее лица: та же мера, что у боковых стен города до таска 206.
    const flat = wall.face || shown.length === 1;
    ctx.fillStyle = flat
      ? block.far
        ? palette.wallFar
        : palette.wall
      : block.far
        ? palette.wallSideFar
        : palette.wallSide;
    ctx.beginPath();
    ctx.moveTo(left.x, left.y);
    ctx.lineTo(right.x, right.y);
    ctx.lineTo(footRight.x, footRight.y);
    ctx.lineTo(footLeft.x, footLeft.y);
    ctx.closePath();
    ctx.fill();
    // Окна: сетка по этажам и секциям, с полями по краям стены. Точки
    // считаются по самой стене (`volumeCitySpot`), поэтому сетка едет вместе с
    // перспективой.
    const bays = Math.max(2, Math.round(wall.wide / VOLUME_CITY_BAY_MM));
    const pad = 0.14;
    const cellX = (1 - pad * 2) / bays;
    const cellY = (1 - pad * 2) / block.floors;
    const seed = index * 4 + wallIndex;
    // Сколько точек занимает окно на этой стене. От этого зависит, рисовать ли
    // каждое окно своим прямоугольником или целым этажом сразу (см. ниже).
    const across = Math.hypot(right.x - left.x, right.y - left.y) / Math.max(1, bays);
    // **Дальний дом рисуется этажами, а не окнами** (цена кадра, таск 206).
    // Окно в полторы точки и так сливается с соседним в полосу, и полоса эта
    // рисуется одной заливкой вместо `bays`; поимённо дорисовываются только
    // **светящиеся** окна — ночью их доля не больше `VOLUME_CITY_LIT_MAX`, а
    // днём нет вовсе. Вблизи (окно шире трёх точек) всё как было: каждое своим.
    const rows = across < VOLUME_CITY_WINDOW_PX;
    for (let floor = 0; floor < block.floors; floor += 1) {
      const sy = pad + cellY * (floor + 0.14);
      if (rows) {
        const a = volumeCitySpot(left, right, footLeft, footRight, pad + cellX * 0.12, sy);
        const b = volumeCitySpot(
          left,
          right,
          footLeft,
          footRight,
          pad + cellX * (bays - 1 + 0.88),
          sy + cellY * 0.72,
        );
        const width = b.x - a.x;
        const height = b.y - a.y;
        if (!(Math.abs(width) > 0.6) || !(Math.abs(height) > 0.6)) continue;
        ctx.fillStyle = palette.glass;
        ctx.fillRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(width), Math.abs(height));
      }
      for (let bay = 0; bay < bays; bay += 1) {
        const alight = volumeCityWindowLit(seed, floor, bay, lit);
        if (rows && !alight) continue;
        const sx = pad + cellX * (bay + 0.12);
        const a = volumeCitySpot(left, right, footLeft, footRight, sx, sy);
        const b = volumeCitySpot(left, right, footLeft, footRight, sx + cellX * 0.76, sy + cellY * 0.72);
        const width = b.x - a.x;
        const height = b.y - a.y;
        if (!(Math.abs(width) > 0.6) || !(Math.abs(height) > 0.6)) continue;
        ctx.fillStyle = alight ? VOLUME_CITY_LIGHT : palette.glass;
        ctx.fillRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(width), Math.abs(height));
      }
    }
  }
  // Крыша: четырёхугольник по верху коробки. Видна она сверху, а снизу
  // вырождается в черту — и это та самая черта парапета, которой дом отличался
  // от коробки до таска 206.
  const top = [plan.faceLeft, plan.faceRight, plan.backRight, plan.backLeft].map((spot) =>
    volumeGroundPoint(aim, spot.x, spot.y, block.heightMm),
  );
  if (top.every(Boolean)) {
    ctx.fillStyle = block.far ? palette.roof : palette.roof;
    ctx.beginPath();
    ctx.moveTo(top[0].x, top[0].y);
    for (let index2 = 1; index2 < top.length; index2 += 1) ctx.lineTo(top[index2].x, top[index2].y);
    ctx.closePath();
    ctx.fill();
  }
}

/**
 * Рекламный щит у дороги (G310): полотно на двух ногах, поперёк взгляда.
 *
 * Полотно — цветные полосы, и всё: текста на нём нет нарочно, писать на щите
 * значило бы придумывать чужую рекламу. Ночью щит **не светится** — подсветка
 * билборда это отдельная история, и так было с первого дня: заказчик снял с
 * домов неон (G337), а щиты оставил как есть.
 */
function volumeDrawBanner(ctx, aim, banner, hour) {
  const palette = hour.palette;
  const len = Math.hypot(banner.x, banner.y) || 1;
  const ux = -banner.y / len;
  const uy = banner.x / len;
  const edge = (sign, zMm) =>
    volumeGroundPoint(aim, banner.x + ux * banner.halfMm * sign, banner.y + uy * banner.halfMm * sign, zMm);
  const top = banner.bottomMm + banner.heightMm;
  const left = edge(1, top);
  const right = edge(-1, top);
  const footLeft = edge(1, banner.bottomMm);
  const footRight = edge(-1, banner.bottomMm);
  const legLeft = edge(0.62, 0);
  const legRight = edge(-0.62, 0);
  if (!left || !right || !footLeft || !footRight || !legLeft || !legRight) return;
  // Ноги — две черты до земли, толщиной в сотую ширины щита.
  ctx.fillStyle = palette.wallSide;
  const leg = Math.max(1, Math.abs(right.x - left.x) * 0.04);
  for (const [atTop, atFoot] of [
    [footLeft, legLeft],
    [footRight, legRight],
  ]) {
    ctx.fillRect(Math.min(atTop.x, atFoot.x) - leg / 2, Math.min(atTop.y, atFoot.y), leg, Math.abs(atFoot.y - atTop.y));
  }
  const paint = VOLUME_CITY_BANNERS[banner.paint % VOLUME_CITY_BANNERS.length];
  ctx.fillStyle = volumeTintCss(volumeHexRgb(paint.back), hour.tint);
  ctx.beginPath();
  ctx.moveTo(left.x, left.y);
  ctx.lineTo(right.x, right.y);
  ctx.lineTo(footRight.x, footRight.y);
  ctx.lineTo(footLeft.x, footLeft.y);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = volumeTintCss(volumeHexRgb(paint.mark), hour.tint);
  for (const [from, to, thick] of [
    [0.1, 0.66, 0.2],
    [0.1, 0.44, 0.52],
    [0.1, 0.78, 0.74],
  ]) {
    const a = volumeCitySpot(left, right, footLeft, footRight, from, thick);
    const b = volumeCitySpot(left, right, footLeft, footRight, to, thick + 0.14);
    const wide = b.x - a.x;
    const high = b.y - a.y;
    if (!(Math.abs(wide) > 1) || !(Math.abs(high) > 0.8)) continue;
    ctx.fillRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(wide), Math.abs(high));
  }
}

/** Точка на лице дома по долям: верх-низ и лево-право, с перспективой. */
function volumeCitySpot(left, right, footLeft, footRight, fx, fy) {
  const topX = left.x + (right.x - left.x) * fx;
  const topY = left.y + (right.y - left.y) * fx;
  const lowX = footLeft.x + (footRight.x - footLeft.x) * fx;
  const lowY = footLeft.y + (footRight.y - footLeft.y) * fx;
  return { x: topX + (lowX - topX) * fy, y: topY + (lowY - topY) * fy };
}

/** Машина: кузов и крыша двумя прямоугольниками — силуэт, а не модель. */
function volumeDrawCar(ctx, aim, spot, palette) {
  const base = volumeGroundPoint(aim, spot.x, spot.y, 0);
  if (!base) return;
  const height = Math.max(3, spot.heightMm * base.scale);
  const width = height * 2.4;
  ctx.fillStyle = palette.car[spot.car % palette.car.length];
  ctx.fillRect(base.x - width / 2, base.y - height * 0.62, width, height * 0.62);
  ctx.fillRect(base.x - width * 0.28, base.y - height, width * 0.56, height * 0.42);
}

/**
 * Звёзды: точки на своих местах, одной яркостью на всё небо.
 *
 * Яркость — доля ночи (`mood.stars`), и она в прозрачности, а не в цвете: небо
 * под ними своё на каждый час, и звезда обязана проступать сквозь сумерки, а
 * не спорить с ними готовым серым.
 */
function volumeDrawStars(ctx, aim, hour) {
  ctx.fillStyle = "rgba(255,255,255," + Math.round(hour.stars * 85) / 100 + ")";
  for (const star of VOLUME_STARS) {
    const at = volumeSkyPoint(aim, star.az, star.rise);
    if (!at) continue;
    const radius = Math.max(0.7, star.size * DEG * at.scale * 0.1);
    ctx.beginPath();
    ctx.arc(at.x, at.y, radius, 0, Math.PI * 2);
    ctx.fill();
  }
}

// Солнце: диск с ореолом. Цвет и место — из снимка часа; у горизонта оно рыжее
// и подрезано полем, под горизонтом его нет вовсе.
function volumeDrawSun(ctx, aim, hour) {
  if (hour.sun.height < -3) return;
  // За сплошными тучами солнца не видно (правка «погода»).
  if (hour.weather && !(hour.weather.sun > 0)) return;
  const at = volumeSkyPoint(aim, hour.sun.az, hour.sun.rise);
  if (!at) return;
  const radius = Math.max(4, VOLUME_SUN_AT.size * DEG * at.scale);
  ctx.fillStyle = hour.sunColors.halo;
  ctx.beginPath();
  ctx.arc(at.x, at.y, radius * 2.1, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = hour.sunColors.body;
  ctx.beginPath();
  ctx.arc(at.x, at.y, radius, 0, Math.PI * 2);
  ctx.fill();
}

/**
 * Месяц: не круг, а серп — заказчик назвал его месяцем, и узнаётся он формой.
 *
 * Фигура приходит готовой ломаной (`volumeMoonShape`) — одной на весь круг фаз
 * (G290), от новолуния до полнолуния и обратно. Рисуется она **одним путём без
 * вырезания**: прежний месяц был разностью двух окружностей в одном пути, и
 * торчащий за диск кусок вырезающей окружности правило непустого обхода
 * заливало — отсюда дефект D48, «две пересекающиеся дуги, фигура похожа на
 * линзу». Заливки «цветом неба» здесь быть не может тем более: под месяцем
 * растяжка, и заплатка плоским цветом была бы видна.
 *
 * Новолуние не рисуется вовсе, и это решение: освещённой доли у него нет, а
 * обведённый контуром тёмный диск был бы выдумкой — в настоящем небе его не
 * видно. Фигура и так сходится в линию сама, порог лишь убирает волосок.
 */
function volumeDrawMoon(ctx, aim, hour) {
  const moon = hour.moon;
  if (moon.rise < -2 || !(moon.glow > 0) || !(moon.lit > VOLUME_MOON_THIN)) return;
  if (hour.weather && !(hour.weather.sun > 0)) return;
  const at = volumeSkyPoint(aim, moon.az, moon.rise);
  if (!at) return;
  const radius = Math.max(4, VOLUME_MOON_SIZE_DEG * DEG * at.scale);
  const shown = Math.max(0.35, Math.min(1, hour.stars + 0.35)) * moon.glow;
  ctx.fillStyle = "rgba(242,243,228," + Math.round(shown * 100) / 100 + ")";
  const edge = volumeMoonShape(radius, moon.edge, moon.tiltDeg);
  ctx.beginPath();
  ctx.moveTo(at.x + edge[0].x, at.y + edge[0].y);
  for (let index = 1; index < edge.length; index += 1) ctx.lineTo(at.x + edge[index].x, at.y + edge[index].y);
  ctx.closePath();
  ctx.fill();
}

// Вершина: треугольник камня и шапка снега на его верхушке. Шапка считается
// **по уже посчитанным точкам** — долей от вершины вниз по обоим склонам, — и
// отдельной стороны света у неё нет: снег лежит на той же горе, а не рядом с
// ней. Низ шапки с изломом, иначе снеговая линия выходит начерченной по
// линейке.
function volumeDrawPeak(ctx, aim, peak, palette) {
  const len = Math.hypot(peak.x, peak.y) || 1;
  const nx = -peak.y / len;
  const ny = peak.x / len;
  const apex = volumeGroundPoint(aim, peak.x, peak.y, peak.heightMm);
  const left = volumeGroundPoint(aim, peak.x + nx * peak.halfMm, peak.y + ny * peak.halfMm, 0);
  const right = volumeGroundPoint(aim, peak.x - nx * peak.halfMm, peak.y - ny * peak.halfMm, 0);
  if (!apex || !left || !right) return;
  ctx.fillStyle = peak.far ? palette.rockFar : palette.rock;
  ctx.beginPath();
  ctx.moveTo(left.x, left.y);
  ctx.lineTo(apex.x, apex.y);
  ctx.lineTo(right.x, right.y);
  ctx.closePath();
  ctx.fill();
  const down = (point) => ({
    x: apex.x + (point.x - apex.x) * peak.snow,
    y: apex.y + (point.y - apex.y) * peak.snow,
  });
  const a = down(left);
  const b = down(right);
  ctx.fillStyle = peak.far ? palette.snowFar : palette.snow;
  ctx.beginPath();
  ctx.moveTo(apex.x, apex.y);
  ctx.lineTo(b.x, b.y);
  ctx.lineTo((a.x + b.x) / 2, (a.y + b.y) / 2 - (b.y - apex.y) * 0.3);
  ctx.lineTo(a.x, a.y);
  ctx.closePath();
  ctx.fill();
}

function volumeDrawCloud(ctx, aim, cloud, paint) {
  const at = volumeSkyPoint(aim, cloud.az, cloud.rise);
  if (!at) return;
  const radius = Math.max(4, cloud.size * DEG * at.scale * 0.4);
  ctx.fillStyle = paint;
  ctx.beginPath();
  ctx.arc(at.x - radius, at.y, radius * 0.72, 0, Math.PI * 2);
  ctx.arc(at.x, at.y - radius * 0.3, radius, 0, Math.PI * 2);
  ctx.arc(at.x + radius, at.y, radius * 0.66, 0, Math.PI * 2);
  ctx.fill();
}

// Дерево, ель и куст — тремя кистями по одному и тому же правилу: основание на
// своей высоте над горизонтом, высота угловая. Своей картинки у фона нет
// нарочно: это рисунок за окном, а не часть чертежа.
function volumeDrawTree(ctx, aim, tree, palette) {
  const base = volumeGroundPoint(aim, tree.x, tree.y, 0);
  if (!base) return;
  const height = Math.max(6, tree.heightMm * base.scale);
  // Дальнее — бледнее: зелень у горизонта видна сквозь воздух. Мера теперь
  // настоящая — дальность в метрах, а не высота основания над горизонтом:
  // дальше трёхсот метров зелень блёкнет, ближе остаётся своей.
  const far = tree.awayMm > VOLUME_TREE_FAR_MM;
  if (tree.kind === "bush") {
    const radius = height * 0.5;
    ctx.fillStyle = palette.bush;
    ctx.beginPath();
    ctx.arc(base.x - radius * 0.8, base.y - radius * 0.6, radius * 0.62, 0, Math.PI * 2);
    ctx.arc(base.x + radius * 0.75, base.y - radius * 0.5, radius * 0.56, 0, Math.PI * 2);
    ctx.arc(base.x, base.y - radius * 0.95, radius * 0.78, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  const slim = tree.kind === "spruce" || tree.kind === "poplar" || tree.kind === "birch";
  ctx.fillStyle = tree.kind === "birch" ? palette.birchTrunk : palette.trunk;
  const trunk = Math.max(1, height * (slim ? 0.05 : 0.08));
  // Зимой лиственное дерево голое (правка «погода»): ствол во весь рост и
  // ветви — кроны нет.
  if (palette.bare && tree.kind !== "spruce") {
    volumeDrawBareTree(ctx, base, height, trunk, tree, palette);
    return;
  }
  const bare = tree.kind === "spruce" ? 0.2 : tree.kind === "poplar" ? 0.3 : tree.kind === "birch" ? 0.58 : 0.45;
  const trunkTop = base.y - height * bare;
  ctx.fillRect(base.x - trunk / 2, trunkTop, trunk, base.y - trunkTop);
  // Берёза узнаётся по стволу, а не по кроне: светлый ствол и чёрточки на нём.
  // Их три, и мельче точки они не бывают — на дальнем ряду чёрточка выродилась
  // бы в мусор, и её там просто нет.
  if (tree.kind === "birch" && trunk > 2) {
    ctx.fillStyle = palette.birchMark;
    for (const part of [0.3, 0.55, 0.78]) {
      const y = base.y - (base.y - trunkTop) * part;
      ctx.fillRect(base.x - trunk / 2, y, trunk * (part > 0.5 ? 0.55 : 0.75), Math.max(1, trunk * 0.3));
    }
  }
  if (tree.kind === "spruce") {
    ctx.fillStyle = far ? palette.crownFar : palette.crownDark;
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
    // Зимой на ели снег — шапкой на верхушке каждого яруса.
    if (palette.snowCap) {
      ctx.fillStyle = palette.snowCap;
      for (const level of [0, 1, 2]) {
        const bottom = base.y - height * (0.18 + level * 0.26);
        const top = bottom - height * 0.42;
        const spread = half * (1 - level * 0.22) * 0.45;
        const capBottom = top + height * 0.42 * 0.45;
        ctx.beginPath();
        ctx.moveTo(base.x - spread, capBottom);
        ctx.lineTo(base.x + spread, capBottom);
        ctx.lineTo(base.x, top);
        ctx.closePath();
        ctx.fill();
      }
    }
    return;
  }
  // Тополь: узкая высокая крона в одно пятно — силуэт у него такой и есть,
  // и издали он отличается от круглого дерева одним только очерком.
  if (tree.kind === "poplar") {
    ctx.fillStyle = far ? palette.crownFar : palette.crowns ? volumeCrownOf(tree, palette) : palette.crownDark;
    ctx.beginPath();
    ctx.ellipse(base.x, base.y - height * 0.6, height * 0.17, height * 0.44, 0, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  // Ива: широкая плоская крона и три свисающие пряди под ней. Стоит она у
  // воды — там её и ставит берег реки (G232).
  if (tree.kind === "willow") {
    ctx.fillStyle = far ? palette.crownFar : palette.willow;
    const wide = height * 0.46;
    ctx.beginPath();
    ctx.ellipse(base.x, base.y - height * 0.62, wide, height * 0.3, 0, 0, Math.PI * 2);
    ctx.fill();
    for (const side of [-0.72, 0, 0.72]) {
      ctx.beginPath();
      ctx.ellipse(base.x + wide * side, base.y - height * 0.34, wide * 0.22, height * 0.22, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    return;
  }
  // Берёза: крона светлее и жиже круглого дерева — два пятна вместо трёх.
  if (tree.kind === "birch") {
    ctx.fillStyle = far ? palette.crownFar : palette.birchCrown;
    const leaf = height * 0.3;
    ctx.beginPath();
    ctx.ellipse(base.x, base.y - height * 0.78, leaf * 0.85, leaf * 1.15, 0, 0, Math.PI * 2);
    ctx.ellipse(base.x - leaf * 0.55, base.y - height * 0.58, leaf * 0.6, leaf * 0.8, 0, 0, Math.PI * 2);
    ctx.ellipse(base.x + leaf * 0.55, base.y - height * 0.62, leaf * 0.55, leaf * 0.75, 0, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  ctx.fillStyle = far ? palette.crownFar : volumeCrownOf(tree, palette);
  const radius = height * 0.34;
  ctx.beginPath();
  ctx.arc(base.x, base.y - height * 0.66, radius, 0, Math.PI * 2);
  ctx.arc(base.x - radius * 0.72, base.y - height * 0.47, radius * 0.66, 0, Math.PI * 2);
  ctx.arc(base.x + radius * 0.7, base.y - height * 0.5, radius * 0.6, 0, Math.PI * 2);
  ctx.fill();
  // Весной круглые деревья в цвету: несколько светлых пятнышек по кроне.
  if (palette.blossom && !far && radius > 3) {
    const seed = volumeTreeSeed(tree);
    for (let index = 0; index < 5; index += 1) {
      const angle = (seed * 7 + index * 2.4) % (Math.PI * 2);
      const reach = radius * (0.25 + ((seed * 13 + index * 0.37) % 0.6));
      ctx.fillStyle = palette.blossom[index % palette.blossom.length];
      ctx.beginPath();
      ctx.arc(base.x + Math.cos(angle) * reach, base.y - height * 0.6 + Math.sin(angle) * reach * 0.8, Math.max(1, radius * 0.11), 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

/** Число дерева по его месту: у каждого дерева своё и одно и то же в каждом кадре. */
function volumeTreeSeed(tree) {
  const value = Math.sin((Number(tree.x) || 0) * 0.0007 + (Number(tree.y) || 0) * 0.0013) * 43758.5453;
  return value - Math.floor(value);
}

/** Крона круглого дерева: осенью у каждого своя — жёлтая, рыжая, красная. */
function volumeCrownOf(tree, palette) {
  if (!palette.crowns) return palette.crown;
  return palette.crowns[Math.floor(volumeTreeSeed(tree) * palette.crowns.length) % palette.crowns.length];
}

/**
 * Голое дерево — зимой: ствол во весь рост и ветви от него вверх и в стороны.
 * У тополя ветви идут почти вверх, у ивы свисают.
 */
function volumeDrawBareTree(ctx, base, height, trunk, tree, palette) {
  const topY = base.y - height * 0.92;
  ctx.fillRect(base.x - trunk / 2, topY, trunk, base.y - topY);
  ctx.strokeStyle = tree.kind === "birch" ? palette.birchTrunk : palette.trunk;
  ctx.lineWidth = Math.max(1, trunk * 0.45);
  const spread = tree.kind === "poplar" ? 0.12 : tree.kind === "willow" ? 0.42 : 0.3;
  const droop = tree.kind === "willow" ? 0.12 : -0.14;
  ctx.beginPath();
  for (const [at, side] of [
    [0.45, -1],
    [0.55, 1],
    [0.66, -1],
    [0.74, 1],
    [0.84, -1],
  ]) {
    const y = base.y - height * at;
    ctx.moveTo(base.x, y);
    ctx.lineTo(base.x + side * height * spread, y + height * droop);
  }
  ctx.stroke();
  if (palette.snowCap && trunk > 2) {
    ctx.fillStyle = palette.snowCap;
    ctx.fillRect(base.x - trunk / 2, topY, trunk, Math.max(1, trunk * 0.6));
  }
}
/** Свет в окне — он же самое яркое в ночном кадре. */
const VOLUME_CITY_LIGHT = "#ffe6a3";

/**
 * Рекламные щиты у дороги (G310): полотно и краска полос. Текста нет — писать
 * на щите значило бы придумывать чужую рекламу.
 */
const VOLUME_CITY_BANNERS = [
  { back: "#d94f3d", mark: "#ffe8c8" },
  { back: "#2f6fb5", mark: "#eaf3ff" },
  { back: "#f0b429", mark: "#5b3a00" },
  { back: "#3b8f57", mark: "#eafbe8" },
];

/**
 * Многоэтажки по кругу: место на земле, половина ширины лица, половина глубины,
 * высота — и **сетка окон, посчитанная из метров**.
 *
 * ——— отчего дома выглядели сплюснутыми (дефект D57) ———————————————————————
 *
 * Слова заказчика: «по вертикали дома сплюснытые». Беда была **не в высоте и не
 * в дальности**, а в сетке окон: `floors` и `bays` писались руками, порознь от
 * настоящих метров. Замер прежних чисел: высота этажа выходила 3,2…3,8 м (это
 * верно, так и строят), а ширина секции — **8,4…17,3 м**, то есть ячейка окна
 * была вчетверо-впятеро шире себя (отношение 4,0…5,0 у дальнего ряда, 2,5…2,9 у
 * ближнего). Глаз читает масштаб дома по окнам, и дом в ровную горизонтальную
 * полоску читается приплюснутым — хоть ты сделай его вдвое выше.
 *
 * Поэтому сетка больше не пишется руками: **этаж 3,2 м, секция 3,5 м**, и число
 * строк со столбцами выходит делением. Ячейка получается 3,5 × 3,2 — почти
 * квадратной, как в настоящем доме, и пропорции сходятся сами на любой высоте и
 * ширине.
 */
export const VOLUME_CITY_FLOOR_MM = 3200;
export const VOLUME_CITY_BAY_MM = 3500;

/**
 * Ширина окна в экранных точках, ниже которой дом рисуется **этажами, а не
 * окнами**: три точки. Окно у́же трёх точек сливается с соседним в полосу и
 * нарисованное поимённо стоит ровно столько же, сколько нарисованное полосой, —
 * а полоса это одна заливка вместо шести-девяти. Светящиеся окна дорисовываются
 * поверх полосы и тогда: их доля ночью не больше `VOLUME_CITY_LIT_MAX`.
 */
const VOLUME_CITY_WINDOW_PX = 3;

/**
 * Дом — **коробка, а не щит** (дефект D57, долг таска 199). Кроме лица у него
 * есть глубина, и в кадр попадают две стены и крыша: какая из боковых видна,
 * решает сама камера. При облёте дом поворачивается, а не схлопывается.
 *
 * Своего на лице у дома больше ничего нет: вывеску (G310) снял G337, и поля
 * `sign` у записи не стало вовсе — дом описывается местом, габаритом и сеткой
 * окон.
 */
function volumeBlock(az, away, halfM, deepM, heightM, far) {
  const spot = volumeAway(az, away);
  const halfMm = halfM * VOLUME_M;
  const heightMm = heightM * VOLUME_M;
  return {
    x: spot.x,
    y: spot.y,
    awayMm: away * VOLUME_M,
    halfMm,
    deepMm: deepM * VOLUME_M,
    heightMm,
    floors: Math.max(2, Math.round(heightMm / VOLUME_CITY_FLOOR_MM)),
    bays: Math.max(2, Math.round((halfMm * 2) / VOLUME_CITY_BAY_MM)),
    far: Boolean(far),
  };
}

/**
 * Два ряда домов. Ближний стоит в **95…150 м** — это дом через дорогу: сорок
 * метров высоты с уровня глаз дают 23°, и дом занимает треть неба, а не
 * полоску у горизонта (до таска 206 он стоял в 220…300 м и давал 5…10°).
 * Дальний ряд — 260…430 м, он заслоняется ближним и держит горизонт
 * застроенным.
 *
 * Дома **у́же, чем были**: лицо 18…30 м вместо прежних 34…68. Широкая плита в
 * полсотни метров сама по себе читается приземистой, сколько ни добавляй ей
 * высоты.
 */
export const VOLUME_CITY = [
  // дальний ряд — за улицей, бледный
  volumeBlock(8, 330, 13, 11, 30, true),
  volumeBlock(24, 410, 11, 9, 26, true),
  volumeBlock(58, 285, 15, 12, 32, true),
  volumeBlock(96, 370, 12, 10, 28, true),
  volumeBlock(131, 310, 14, 11, 32, true),
  volumeBlock(168, 395, 11, 9, 25, true),
  volumeBlock(205, 265, 16, 12, 33, true),
  volumeBlock(241, 380, 12, 10, 27, true),
  volumeBlock(278, 320, 14, 11, 31, true),
  volumeBlock(316, 425, 11, 9, 24, true),
  volumeBlock(344, 295, 13, 11, 33, true),
  // ближний ряд — высокие, тёмнее и шире
  volumeBlock(40, 120, 11, 14, 40, false),
  volumeBlock(112, 98, 9, 12, 44, false),
  volumeBlock(186, 145, 15, 16, 36, false),
  volumeBlock(258, 110, 10, 13, 46, false),
  volumeBlock(330, 132, 12, 15, 38, false),
];

/**
 * Светится ли это окно при такой доле зажжённых.
 *
 * Чистая и постоянная: номер дома, этаж и секция дают одно и то же число
 * всегда. Случай здесь не годится вовсе — окна мигали бы на каждом снимке
 * часа, то есть каждую секунду.
 */
export function volumeCityWindowLit(block, floor, bay, share) {
  if (!(share > 0)) return false;
  // Перемешивание тремя множителями — обычный целочисленный хэш: соседние окна
  // получают далёкие числа, и свет не выстраивается полосами и лестницами.
  const mixed = ((block + 1) * 73856093) ^ ((floor + 1) * 19349663) ^ ((bay + 1) * 83492791);
  return ((mixed >>> 8) % 1000) / 1000 < share;
}

/**
 * Машины на парковке: место на земле, высота и цвет из палитры. Стоят рядком у
 * ближнего дома — после таска 206 в 45…70 м, а не в сотне: полтора метра
 * высоты дают оттуда 1,2…1,9°, и видно, что это машины, а не точки.
 */
function volumeCar(az, away, heightM, car) {
  const spot = volumeAway(az, away);
  return { x: spot.x, y: spot.y, awayMm: away * VOLUME_M, heightMm: heightM * VOLUME_M, car };
}

export const VOLUME_CITY_PARK = [
  volumeCar(150, 62, 1.5, 0),
  volumeCar(154, 58, 1.5, 1),
  volumeCar(158, 54, 1.6, 2),
  volumeCar(162, 50, 1.6, 3),
  volumeCar(166, 47, 1.7, 4),
  volumeCar(170, 45, 1.7, 1),
  volumeCar(290, 60, 1.5, 2),
  volumeCar(294, 56, 1.6, 0),
  volumeCar(298, 52, 1.6, 4),
  volumeCar(302, 48, 1.7, 3),
];

/**
 * Рекламные щиты у дороги (G310): место, половина ширины полотна, высота
 * полотна и высота его низа над землёй.
 *
 * Стоят они **вдоль улиц**, по которым и расставлены: шесть метров полотна в
 * полусотне метров дают 7°, то есть щит читается щитом, а не пятном. Ноги
 * поднимают полотно на три-четыре метра — так их и ставят, чтобы не мешали
 * тротуару.
 */
function volumeBanner(az, away, halfM, heightM, bottomM, paint) {
  const spot = volumeAway(az, away);
  return {
    x: spot.x,
    y: spot.y,
    awayMm: away * VOLUME_M,
    halfMm: halfM * VOLUME_M,
    heightMm: heightM * VOLUME_M,
    bottomMm: bottomM * VOLUME_M,
    paint,
  };
}

export const VOLUME_CITY_BANNER_PLACES = [
  volumeBanner(140, 52, 3.2, 3.6, 3.4, 0),
  volumeBanner(196, 68, 3.6, 4, 3.8, 1),
  volumeBanner(268, 58, 3, 3.4, 3.2, 2),
  volumeBanner(322, 75, 3.8, 4.2, 4, 3),
  volumeBanner(64, 88, 3.4, 3.8, 3.6, 1),
];

/**
 * Улицы города: те же полосы, что дорога «Природы», только шире и с разметкой.
 * После таска 206 ближнее колено в 55…60 м вместо 120: улица должна лежать
 * перед домами, а не теряться за ними.
 */
export const VOLUME_CITY_STREETS = [
  volumeBandNodes(
    [
      [134, 58],
      [148, 95],
      [163, 150],
      [178, 230],
      [193, 340],
      [208, 480],
    ],
    16,
  ),
  volumeBandNodes(
    [
      [274, 62],
      [288, 100],
      [303, 160],
      [318, 250],
      [333, 370],
      [348, 520],
    ],
    16,
  ),
];

/** Разметка по середине улицы: та же полоса, только в полметра шириной. */
function volumeStreetMarks(street) {
  return street.map((node) => {
    const dx = node.left.x - node.right.x;
    const dy = node.left.y - node.right.y;
    const len = Math.hypot(dx, dy) || 1;
    const half = (0.25 * VOLUME_M) / len;
    return {
      x: node.x,
      y: node.y,
      awayMm: node.awayMm,
      left: { x: node.x + dx * half, y: node.y + dy * half },
      right: { x: node.x - dx * half, y: node.y - dy * half },
    };
  });
}

export const VOLUME_CITY_MARKS = VOLUME_CITY_STREETS.map((street) => volumeStreetMarks(street));

/** Деревья вдоль улиц: город не бетонная коробка, но и не лес. */
export const VOLUME_CITY_GREENS = [
  volumeStanding(143, 66, 9, "tree"),
  volumeStanding(176, 105, 7, "tree"),
  volumeStanding(199, 150, 2.4, "bush"),
  volumeStanding(283, 70, 8.5, "tree"),
  volumeStanding(311, 112, 7.5, "tree"),
  volumeStanding(341, 145, 2.6, "bush"),
];

/** Звёзды: раскиданы по небу раз и навсегда, своей яркости у каждой нет. */
export const VOLUME_STARS = (() => {
  const stars = [];
  // Числа ровные и постоянные: тот же целочисленный хэш, что у окон города.
  for (let index = 0; index < 48; index += 1) {
    const mixed = ((index + 1) * 2654435761) >>> 0;
    stars.push({
      az: (mixed % 3600) / 10,
      rise: 6 + ((mixed >>> 12) % 520) / 10,
      size: 0.8 + ((mixed >>> 22) % 70) / 100,
    });
  }
  return stars;
})();

/** Полдень по умолчанию: фон, который был до таска 181. Им же рисуется кадр,
 * пока снимок часа не посчитан. */
export const VOLUME_MOOD_NOON = volumeMood({
  minutes: (VOLUME_SUNRISE_MIN + VOLUME_SUNSET_MIN) / 2,
  kind: VOLUME_BACKDROP_DEFAULT,
});
