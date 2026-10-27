// «Объём»: свет ламп и неба — `volumeLiveLight`, пятна ламп кольцами, швы,
// пятна окон, тени вещей от ламп, тон комнаты.
//
// Часть «Объёма», вынесенная из `src/volume.js` (2026-10-25) переносом без
// переименований: снаружи модуль читают через дверь `volume.js`, а соседи по
// `src/volume/` — напрямую. Зависимости идут только вниз по слоям (порядок —
// в шапке `volume.js`), циклов нет. Решения и доводы — в шапках разделов ниже.
import { lightFadeOf } from "../lightFade.js";
import {
  VOLUME_DOOR_RGB,
  VOLUME_GLOW_MIN,
  VOLUME_GLOW_RGB,
  VOLUME_HEAT_GLOW_RGB,
  VOLUME_LAMP_LIFT,
  VOLUME_LAMP_LIGHT_RGB,
  VOLUME_LAMP_LIGHT_SHARE,
  VOLUME_NIGHT_RGB,
  VOLUME_ROOM_LIGHT,
  VOLUME_ROOM_WARM,
  VOLUME_ROOM_WARM_RGB,
  VOLUME_SCREEN_RGB,
  VOLUME_STAR_RGB,
  VOLUME_TREE_LIGHT,
  volumeNormalize,
} from "./measures.js";
import {
  volumeFill,
  volumeHull,
  volumeIsCeiling,
  volumeIsFloor,
  volumeIsWall,
  volumeShade,
  volumeShare01,
  volumeTintRgb,
} from "./faces.js";
import {
  VOLUME_MARK_WALL,
  volumeBox3,
  volumeMix,
  volumePointInside,
  volumeRoomKey,
  volumeRoomKeyAt,
} from "./shapes.js";
import { volumeMiddleOf } from "./order.js";
import { VOLUME_NIGHT_SHARE } from "./sky.js";
import { volumeClipPolygon, volumeMoonTint } from "./sun.js";
import { VOLUME_MARK_CEILING, volumeMarkProbe } from "./marks.js";
import { volumeArea } from "./floors.js";
import { volumeMarkPlace } from "./scene.js";

/**
 * **Свет дома для кадра** (таск 09 сценариев, история 2.12; правка после
 * сборки сценариев): `{glow, rooms, physical, lamps, decals}` для
 * `volumeFrame(…, live)` — или `null`, если не горит ничего.
 *
 * `live` — состояние дома по меткам: `Map<markId, {on, level, kind, roomId,
 * fade}>` (`simLiveOf` и вид знака `simLiveKindOf`, одно правило со «Схемой»;
 * `fade` — доля включённости, пока лампа разгорается или гаснет,
 * `lightFadeLive`). Светится включённый свет — по яркости — и экран
 * включённого телевизора.
 *
 * **Комната светлеет от суммы ламп** — слова заказчика: «чем больше света
 * включено, тем ярче в комнате». Сумма — сила лампы (`volumeLampPower`) на её
 * яркость, а светлота комнаты — `volumeRoomShare`: одна лампа в гостиной даёт
 * полутьму, три — свет, и светлее полного не бывает. Помещение лампы — её
 * помещение в объекте, а у метки без него — контур, в котором она висит.
 *
 * `options.physical` — **физический свет** (отметка «Физический свет», по
 * умолчанию взведена). Слова заказчика: «что бы светил и в проёмах и чуть
 * передавал в соседнюю комнату» и «что бы не заполнял всю комнату сразу, а
 * светил в своей области». Тогда комната от ламп светлеет только отражённым
 * светом (`VOLUME_LAMP_BOUNCE`), остальное — пятна каждой лампы на полу, стенах
 * и потолке (`decals`, `volumeLampDecals`); соседняя комната за открытым
 * проёмом получает долю отражённого (`VOLUME_LAMP_SPILL`) и клин пятна сквозь
 * проём; откосы и полотна проёмов светлеют по более светлой стороне.
 *
 * `options.tint` — **тон часа** (`volumeMood().tint`): с ним физический свет
 * светит и небом (правка «Для солнца и Луны тоже примени физический свет»).
 * Тогда ответ есть и у дома, где не горит ничего, и даже без имитации: комнату
 * светят её окна (`day`, `volumeDayLevels`), у окна светлее (`skyDecals`,
 * `volumeWindowDecals`), а сила окна — доля неба на штору (`windows`). Без тона
 * — как до правки: небо комнаты светит ровно, тем же тоном, что улицу.
 */
export function volumeLiveLight(scene, live, options = {}) {
  const physical = options.physical === true;
  const sky = physical && options.tint !== undefined;
  if ((!live || live.size === 0) && !sky) return null;
  const glow = new Map();
  const lamps = new Map();
  const sums = new Map();
  const colors = new Map();
  const paints = new Map();
  for (const [markId, item] of live || []) {
    if (!item || item.on !== true) continue;
    const fade = lightFadeOf(item);
    if (item.kind === "tv") {
      glow.set(markId, { level: 1, rgb: VOLUME_SCREEN_RGB, fade });
      continue;
    }
    // Греет — рдеет (правка после сборки сценариев): экран термостата и
    // греющий слой тёплого пола.
    if (item.heat) {
      glow.set(markId, { level: 1, rgb: VOLUME_HEAT_GLOW_RGB, fade: 1 });
      continue;
    }
    if (item.kind !== "light") continue;
    const level = volumeShare01(item.level);
    const place = scene ? volumeMarkPlace(scene, markId) : null;
    // Новогодняя ель: звезда горит золотом, а светит ель гирляндой — слабее
    // лампы её размера (`VOLUME_TREE_LIGHT`).
    const tree = Boolean(place && place.view && place.view.name === "xmasTree");
    // Ламп у устройства несколько (ель) — свечение знает каждую: тело своей
    // лампы горит, только пока она горит (`bulb`).
    const many = Boolean(item.lamps && Object.keys(item.lamps).length > 1);
    // Цвет лампы (правка после сборки сценариев: «свечение всегда одно, надо
    // поправить») — её оттенок или цветовая температура (`simLightRgb`); у
    // лампы без цвета — тёплый белый, как было.
    const color = !tree && volumeColorOf(item.color);
    glow.set(markId, { level, rgb: tree ? VOLUME_STAR_RGB : color || VOLUME_GLOW_RGB, fade, ...(many ? { lamps: item.lamps } : {}) });
    const strength = level * fade * (tree ? VOLUME_TREE_LIGHT : 1);
    lamps.set(markId, strength);
    if (color) colors.set(markId, color);
    const key = item.roomId || volumeRoomKeyAt(scene, volumeMarkProbe(place));
    if (key) {
      const power = volumeLampPower(place) * strength;
      sums.set(key, (sums.get(key) || 0) + power);
      // Свет комнаты — смесь цветов её ламп по их силе.
      const mix = paints.get(key) || [0, 0, 0, 0, false];
      const rgb = color || VOLUME_LAMP_LIGHT_RGB;
      paints.set(key, [mix[0] + rgb[0] * power, mix[1] + rgb[1] * power, mix[2] + rgb[2] * power, mix[3] + power, mix[4] || Boolean(color)]);
    }
  }
  if (glow.size === 0 && !sky) return null;
  const areas = volumeRoomAreas(scene);
  const rooms = new Map();
  for (const [key, sum] of sums) rooms.set(key, volumeRoomShare(sum * (physical ? VOLUME_LAMP_BOUNCE : 1), areas.get(key)));
  if (physical) volumeLampSpill(scene, rooms);
  // Цвет света комнаты — только у комнат, где горит цветная лампа: у
  // остальных свет тот же тёплый белый, и карта о них молчит.
  let roomRgb = null;
  for (const [key, mix] of paints) {
    if (!mix[4] || !(mix[3] > 0)) continue;
    if (!roomRgb) roomRgb = new Map();
    roomRgb.set(key, [mix[0] / mix[3], mix[1] / mix[3], mix[2] / mix[3]]);
  }
  const out = {
    glow,
    rooms,
    physical,
    lamps,
    decals: physical && live && lamps.size > 0 ? volumeLampDecals(scene, live) : null,
    shades: physical && live && lamps.size > 0 ? volumeLampShades(scene, live) : null,
    ...(colors.size > 0 ? { colors } : {}),
    ...(roomRgb ? { roomRgb } : {}),
  };
  if (sky) {
    const share = volumeSkyShare(options.tint);
    out.day = volumeDayLevels(scene, share);
    out.windows = new Map();
    for (const window of volumeSkyWindows(scene).list) out.windows.set(window.id, share * window.pass);
    out.skyDecals = share > VOLUME_LAMP_INVISIBLE ? volumeWindowDecals(scene) : null;
  }
  return out;
}

// ——— свет ламп: сила, комната, пятна (правка после сборки сценариев) ————————
//
// Света от ламп в сцене по-прежнему нет как вычисления: ни лучей, ни теней от
// вещей. Есть три приёма, и все три живут в кадре, а не в сцене:
//
//   — **свет комнаты** — тон ночи, сведённый слабее (`volumeRoomTint`) по сумме
//     ламп помещения (`volumeRoomShare`);
//   — **пятно лампы** — кольца поверх пола, стен и потолка, каждое шире и
//     тусклее предыдущего, — так край пятна плавный. Слова заказчика: «границы
//     что бы плавные были, с переходом. Можно несколько пятен, каждое из
//     который больше и менее яркое». Кольцо лежит **на куске своей грани** и
//     рисуется сразу за ним (`volumeFrame`), поэтому всё, что стоит ближе, —
//     диван, стена, дверь — закрывает пятно, как закрывало пол;
//   — **проём**: пятно лампы ложится и в соседнюю комнату — клином, срезанным
//     проёмом так, как его срезал бы свет из точки, где висит лампа.
//
// Днём ночного тона нет — нет и света от ламп: пятна не рисуются вовсе.

/** Сила лампы — от и до: самая слабая подсветка и люстра. */
export const VOLUME_LAMP_POWER_MIN = 0.06;
export const VOLUME_LAMP_POWER_MAX = 1.6;
/**
 * Площадь, которую лампа силы 1 на полной яркости светит **на долю 1 − 1/e**
 * (`volumeRoomShare`): обычный светильник в гостиной 16 м² даёт больше двух
 * третей, два — девять десятых. Было 8 м², и заказчик сказал: «ночью сейчас
 * дают приглушённый свет, а должны освещать».
 */
export const VOLUME_LAMP_AREA_MM2 = 20e6;
/** Комната без своей площади (контур не обведён) — средняя комната. */
const VOLUME_LAMP_ROOM_MM2 = 15e6;
/** Доля света комнаты, которая при физическом свете остаётся отражённой. */
export const VOLUME_LAMP_BOUNCE = 0.6;
/** Доля отражённого света, которую открытый дверной проём отдаёт соседке. */
export const VOLUME_LAMP_SPILL = 0.3;
/** Площадь проёма, при которой соседке отдаётся вся эта доля, — дверь 900 × 2100. */
const VOLUME_LAMP_SPILL_MM2 = 1.9e6;

/**
 * **Сила лампы** по её размеру: подсветка картины в сорок миллиметров слабее
 * плафона, а люстра сильнее его. Своего поля силы у типа нет, и выдумывать его
 * незачем — размер лица в справочнике есть у каждого светильника.
 *
 * Точечная — по площади лица, на логарифмической шкале: плафон 200 × 120 —
 * около единицы, точечный 90 × 90 — 0,4, люстра 500 × 400 — потолок шкалы,
 * подсветка 40 × 40 — её пол. Линия (лента, трек) — по длине: 0,3 на метр у
 * ленты в сантиметр, больше у широкого трека.
 */
export function volumeLampPower(place) {
  if (!place) return 0.8;
  if (place.kind === "line") {
    let sum = 0;
    for (const piece of volumeLampPieces(place)) sum += piece.power;
    return Math.max(VOLUME_LAMP_POWER_MIN, sum);
  }
  const size = volumeLampFace(place);
  const m2 = (size.widthMm * size.heightMm) / 1e6;
  const power = 0.5 + 0.35 * Math.log2(Math.max(1e-6, m2) / 0.01);
  return Math.max(VOLUME_LAMP_POWER_MIN, Math.min(VOLUME_LAMP_POWER_MAX, power));
}

/** Лицо точечной лампы: у вещи без лица — её коробка в плане. */
function volumeLampFace(place) {
  if (place.face && place.face.widthMm > 0 && place.face.heightMm > 0) {
    return { widthMm: place.face.widthMm, heightMm: place.face.heightMm };
  }
  const corners = place.prisms && place.prisms[0] ? place.prisms[0].corners : null;
  if (!corners || corners.length < 3) return { widthMm: 120, heightMm: 120 };
  const a = Math.hypot(corners[1].x - corners[0].x, corners[1].y - corners[0].y);
  const b = Math.hypot(corners[2].x - corners[1].x, corners[2].y - corners[1].y);
  return { widthMm: Math.max(a, b), heightMm: Math.min(a, b) };
}

/** Кусок линейной лампы — не длиннее метра: столько и светит одна точка ленты. */
const VOLUME_LAMP_PIECE_MM = 1000;

/** Куски линейной лампы: середина, длина и сила каждого. */
function volumeLampPieces(place) {
  const out = [];
  for (const prism of place.prisms || []) {
    const c = prism.corners;
    if (!c || c.length < 4) continue;
    const a = Math.hypot(c[1].x - c[0].x, c[1].y - c[0].y);
    const b = Math.hypot(c[2].x - c[1].x, c[2].y - c[1].y);
    // Длина — длинная сторона коробки звена, поперечник — короткая.
    const along = a >= b ? { from: c[0], to: c[1], back: c[3] } : { from: c[1], to: c[2], back: c[0] };
    const length = Math.max(a, b);
    const across = Math.min(a, b);
    const perMeter = 0.25 + Math.min(across, 100) / 200;
    const count = Math.max(1, Math.ceil(length / VOLUME_LAMP_PIECE_MM));
    const half = { x: (along.back.x - along.from.x) / 2, y: (along.back.y - along.from.y) / 2 };
    const z = (Number(prism.bottomMm) + Number(prism.topMm)) / 2;
    for (let index = 0; index < count; index += 1) {
      const t = (index + 0.5) / count;
      out.push({
        at: {
          x: along.from.x + (along.to.x - along.from.x) * t + half.x,
          y: along.from.y + (along.to.y - along.from.y) * t + half.y,
          z,
        },
        power: (perMeter * length) / count / 1000,
      });
    }
  }
  return out;
}

/** Вынос точки света от стены у лампы на стене: свет выходит из лица, а не из стены. */
const VOLUME_LAMP_WALL_OUT_MM = 30;

/**
 * Откуда лампа светит: `[{at, power, dir, wall, beam}]` — точка, сила, куда
 * смотрит (`null` — во все стороны), нормаль своей стены у лампы на стене и
 * ширина пятна. Линия даёт точку на каждый метр.
 *
 * Куда смотрит, решает посадка (`place.mode`): потолочная — вниз, на стене —
 * от стены, висящая в воздухе выше человека — вниз, ниже — во все стороны
 * (подсветка пола, ночник у кровати).
 */
export function volumeLampSources(place) {
  if (!place || !place.anchor) return [];
  const down = { x: 0, y: 0, z: -1 };
  const wall = place.mode === VOLUME_MARK_WALL && place.face && place.face.normal ? place.face.normal : null;
  const out = (z) => (wall ? wall : place.mode === VOLUME_MARK_CEILING || z >= 1400 ? down : null);
  const lift = (point) =>
    wall
      ? { x: point.x + wall.x * VOLUME_LAMP_WALL_OUT_MM, y: point.y + wall.y * VOLUME_LAMP_WALL_OUT_MM, z: point.z }
      : point;
  if (place.kind === "line") {
    return volumeLampPieces(place).map((piece) => ({
      at: lift(piece.at),
      power: piece.power,
      dir: out(piece.at.z),
      wall,
      beam: 1,
    }));
  }
  const size = volumeLampFace(place);
  const most = Math.max(size.widthMm, size.heightMm);
  // Точечный и подсветка светят узко, люстра — широко.
  const beam = most <= 120 ? 0.6 : most >= 400 ? 1.15 : 1;
  return [{ at: lift(place.anchor), power: volumeLampPower(place), dir: out(place.anchor.z), wall, beam }];
}

/**
 * Светлота комнаты от суммы ламп: `1 − e^(−сумма · S₀ / S)` (`S₀` —
 * `VOLUME_LAMP_AREA_MM2`, `S` — площадь помещения). Растёт с каждой лампой и
 * не переходит единицы; маленькая комната светлеет быстрее большой.
 */
export function volumeRoomShare(sum, areaMm2) {
  const area = Math.max(2e6, Number(areaMm2) > 0 ? Number(areaMm2) : VOLUME_LAMP_ROOM_MM2);
  const power = Math.max(0, Number(sum) || 0);
  return 1 - Math.exp(-(power * VOLUME_LAMP_AREA_MM2) / area);
}

const volumeAreaMemo = new WeakMap();

/** Площади помещений сцены по ключу (`volumeRoomKey`) — раз на сцену. */
function volumeRoomAreas(scene) {
  if (!scene) return new Map();
  const held = volumeAreaMemo.get(scene);
  if (held) return held;
  const areas = new Map();
  for (const room of scene.rooms || []) {
    const key = volumeRoomKey(room);
    if (key && room.pointsMm) areas.set(key, (areas.get(key) || 0) + volumeArea(room.pointsMm));
  }
  volumeAreaMemo.set(scene, areas);
  return areas;
}

/**
 * Проёмы своего этажа между двумя помещениями — для света ламп. Берутся у
 * солнца (`scene.sunSpots`): те же проёмы с теми же сторонами, шторами и
 * дверями, второго обхода стен нет. Помещение стороны узнаётся по контуру
 * (`pointsMm` — тот же массив, что у `scene.rooms`), и потому проёмы чужих
 * этажей стопки сюда не попадают: их контуры — другие массивы.
 */
function volumeLampOpenings(scene) {
  const held = volumeOpeningMemo.get(scene);
  if (held) return held;
  const byPoints = new Map();
  for (const room of (scene && scene.rooms) || []) byPoints.set(room.pointsMm, volumeRoomKey(room));
  const out = [];
  for (const spot of (scene && scene.sunSpots) || []) {
    const left = spot.left ? byPoints.get(spot.left.pointsMm) : undefined;
    const right = spot.right ? byPoints.get(spot.right.pointsMm) : undefined;
    if (!left || !right || left === right) continue;
    const base = Number(spot.baseMm) || 0;
    const side = (sign) =>
      spot.faceMm.map((point) => ({
        x: spot.aMm.x + spot.u.x * point.alongMm + spot.n.x * spot.halfMm * sign,
        y: spot.aMm.y + spot.u.y * point.alongMm + spot.n.y * spot.halfMm * sign,
        z: base + point.zMm,
      }));
    out.push({
      left,
      right,
      // Сторона `left` — та, куда смотрит нормаль стены (`volumeSunOpenings`).
      plus: side(1),
      minus: side(-1),
      // Вдоль проёма: по нему лампа размером светит клин с мягким краем.
      u: { x: spot.u.x, y: spot.u.y },
      // Поперёк: по нему кусок знает, за какой стороной проёма он лежит.
      n: { x: spot.n.x, y: spot.n.y },
      areaMm2: (spot.toMm - spot.fromMm) * (spot.topMm - spot.bottomMm),
      shut: Boolean(spot.shut || spot.sheerMarkId),
    });
  }
  volumeOpeningMemo.set(scene, out);
  return out;
}

const volumeOpeningMemo = new WeakMap();

/** Отражённый свет через открытые проёмы — один шаг, «чуть»: доля соседки. */
function volumeLampSpill(scene, rooms) {
  if (rooms.size === 0) return;
  const base = new Map(rooms);
  for (const way of volumeLampOpenings(scene)) {
    if (way.shut) continue;
    const share = VOLUME_LAMP_SPILL * Math.min(1, way.areaMm2 / VOLUME_LAMP_SPILL_MM2);
    for (const [from, to] of [
      [way.left, way.right],
      [way.right, way.left],
    ]) {
      const light = base.get(from);
      if (!(light > 0)) continue;
      const was = rooms.get(to) || 0;
      rooms.set(to, 1 - (1 - was) * (1 - light * share));
    }
  }
}

// ——— свет неба: окна, солнце и луна (правка после сборки сценариев) ————————
//
// Слова заказчика: «Для солнца и Луны тоже примени физический свет» и «От луны
// должно быть тоже освещение, но слабое, и чем полнее луна, тем сильнее, ну и
// белым светом».
//
// Без физического света небо светит дом ровно: тон часа один у улицы и у
// каждой комнаты. С ним комнату светят **её окна**:
//
//   — **свет комнаты** — доля неба (`volumeSkyShare`: 1 днём, 0 ночью, у луны —
//     её доля, см. `volumeMood`) на то, сколько у комнаты окон против пола
//     (`volumeWindowShare`), и на долю, что расходится ровно
//     (`VOLUME_DAY_BOUNCE`). Комната без окон днём темна, как ночью; открытый
//     проём отдаёт соседке долю её света (`volumeLampSpill`);
//   — **пятно окна** — кольца у окна на полу, стенах и потолке, тем же приёмом,
//     что пятно лампы (`volumeLampPool`): у окна светлее, в глубине темнее, а
//     сквозь открытую дверь свет ложится клином в соседнюю комнату;
//   — **солнце** по-прежнему кладёт свои пятна (`volumeSunSpotFaces`), а
//     **луна** с правки — свои (`volumeMoonSpotFaces`).
//
// Окно — проём своего этажа, у которого с одной стороны комната, а с другой
// улица (`scene.sunSpots`, те же стороны, шторы и двери, что у солнца). Глухая
// закрытая дверь света не пропускает, задёрнутая штора — часть
// (`VOLUME_SHEER_PASS`).

/** Цвет тьмы в комнате днём: серый, а не синий — синева у ночи от неба. */
export const VOLUME_INDOOR_RGB = [30, 29, 34];
/** Окна против пола: `1 − e^(−k · окна / пол)`. По норме окно — восьмая пола, и это 0,85. */
const VOLUME_WINDOW_GAIN = 15;
/** Доля света окон, которая расходится по комнате ровно; остальное — пятно у окна. */
export const VOLUME_DAY_BOUNCE = 0.85;
/** Сколько света пропускает задёрнутая штора: тюль, а не стена. */
export const VOLUME_SHEER_PASS = 0.35;
/** Вынос точки света окна в комнату: свет берётся не из стекла, а из воздуха перед ним. */
const VOLUME_WINDOW_OUT_MM = 500;
/** Сила окна на квадратный метр проёма — мера пятна та же, что у лампы. */
const VOLUME_WINDOW_POWER_M2 = 0.25;
/** Насколько пятно окна поднимает светлоту грани к единице: у окна светлее, чем в глубине. */
export const VOLUME_WINDOW_LIFT = 0.3;

/** Полдень: тон без тьмы — им окно светит, когда часа не дали. */
export const VOLUME_NOON_TINT = Object.freeze({ share: 0 });

/** Доля неба: 1 — день, 0 — ночь. Тон часа — тот же, которым темнеет улица. */
export function volumeSkyShare(tint) {
  const share = tint ? volumeShare01(tint.share) : 0;
  return 1 - Math.min(1, share / VOLUME_NIGHT_SHARE);
}

/**
 * Тон комнаты, которую светит небо: тьма — та же, что ночью
 * (`VOLUME_NIGHT_SHARE`), без света `level` — она вся; цвет её днём серый,
 * к ночи — синий цвет ночи.
 */
export function volumeIndoorTint(tint, level) {
  const outside = tint ? volumeShare01(tint.share) : 0;
  const night = Math.min(1, outside / VOLUME_NIGHT_SHARE);
  return {
    rgb: volumeMix(VOLUME_INDOOR_RGB, (tint && tint.rgb) || VOLUME_NIGHT_RGB, night),
    share: Math.max(outside, VOLUME_NIGHT_SHARE) * (1 - volumeShare01(level)),
  };
}

/** Сколько света дают окна комнате: `1 − e^(−k · окна / пол)`. */
export function volumeWindowShare(windowMm2, floorMm2) {
  const floor = Math.max(2e6, Number(floorMm2) > 0 ? Number(floorMm2) : VOLUME_LAMP_ROOM_MM2);
  return 1 - Math.exp(-(VOLUME_WINDOW_GAIN * Math.max(0, Number(windowMm2) || 0)) / floor);
}

const volumeWindowMemo = new WeakMap();

/**
 * Окна сцены — раз на сцену: `{list: [{id, key, areaMm2, pass, source}], byRoom:
 * Map<ключ комнаты, площадь окон с поправкой на шторы>}`. `source` — точка
 * света окна для пятна (`volumeLampPool`): посреди проёма, вынесенная в
 * комнату, светит в комнату и вниз.
 */
function volumeSkyWindows(scene) {
  const held = scene ? volumeWindowMemo.get(scene) : null;
  if (held) return held;
  const byPoints = new Map();
  for (const room of (scene && scene.rooms) || []) byPoints.set(room.pointsMm, volumeRoomKey(room));
  const list = [];
  const byRoom = new Map();
  ((scene && scene.sunSpots) || []).forEach((spot, index) => {
    if (spot.shut) return;
    // С одной стороны комната, с другой улица; комната — своего этажа.
    if (Boolean(spot.left) === Boolean(spot.right)) return;
    const key = spot.left ? byPoints.get(spot.left.pointsMm) : byPoints.get(spot.right.pointsMm);
    if (!key) return;
    const sign = spot.left ? 1 : -1;
    const areaMm2 = (spot.toMm - spot.fromMm) * (spot.topMm - spot.bottomMm);
    if (!(areaMm2 > 0)) return;
    const pass = spot.sheerMarkId ? VOLUME_SHEER_PASS : 1;
    const along = (spot.fromMm + spot.toMm) / 2;
    const out = spot.halfMm + VOLUME_WINDOW_OUT_MM;
    const inward = { x: spot.n.x * sign, y: spot.n.y * sign };
    list.push({
      id: "sky:" + index,
      key,
      areaMm2,
      pass,
      source: {
        at: {
          x: spot.aMm.x + spot.u.x * along + inward.x * out,
          y: spot.aMm.y + spot.u.y * along + inward.y * out,
          z: (Number(spot.baseMm) || 0) + (spot.bottomMm + spot.topMm) / 2,
        },
        power: Math.max(0.2, Math.min(VOLUME_LAMP_POWER_MAX, (areaMm2 / 1e6) * VOLUME_WINDOW_POWER_M2)),
        dir: volumeNormalize({ x: inward.x, y: inward.y, z: -0.6 }),
        wall: null,
        beam: 1.1,
        sky: true,
      },
    });
    byRoom.set(key, (byRoom.get(key) || 0) + areaMm2 * pass);
  });
  const windows = { list, byRoom };
  if (scene) volumeWindowMemo.set(scene, windows);
  return windows;
}

const volumeDayMemo = new WeakMap();

/**
 * Свет неба по комнатам: `Map<ключ, 0…1>` — у каждой комнаты своего этажа,
 * без окон ноль. Считается на долю неба и помнится, пока она та же.
 */
export function volumeDayLevels(scene, sky) {
  const held = scene ? volumeDayMemo.get(scene) : null;
  if (held && held.sky === sky) return held.day;
  const areas = volumeRoomAreas(scene);
  const day = new Map();
  // Помещение без потолка светит небо целиком — как улицу: в карту света окон
  // оно не попадает вовсе, и тон у его граней уличный.
  const open = new Set();
  for (const room of (scene && scene.rooms) || []) if (room.hasCeiling === false) open.add(volumeRoomKey(room));
  for (const key of areas.keys()) if (!open.has(key)) day.set(key, 0);
  if (sky > 0) {
    for (const [key, area] of volumeSkyWindows(scene).byRoom) {
      day.set(key, volumeWindowShare(area, areas.get(key)) * sky * VOLUME_DAY_BOUNCE);
    }
    volumeLampSpill(scene, day);
  }
  if (scene) volumeDayMemo.set(scene, { sky, day });
  return day;
}

const volumeWindowDecalMemo = new WeakMap();

/** Пятна окон сцены — как пятна ламп (`volumeLampDecals`), раз на сцену. */
export function volumeWindowDecals(scene) {
  if (!scene || !scene.order) return null;
  const held = volumeWindowDecalMemo.get(scene);
  if (held) return held;
  const decals = new Map();
  const byRoom = volumeDecalHosts(scene);
  const ways = volumeLampOpenings(scene).filter((way) => !way.shut);
  for (const window of volumeSkyWindows(scene).list) volumeSourcePools(decals, byRoom, ways, window.key, window.id, window.source);
  volumeWindowDecalMemo.set(scene, decals);
  return decals;
}

/**
 * Тон для кадра: тот из двух, при котором грань светлее. Сравнивается не доля
 * тьмы, а цвет: у лампы днём доля растёт — это свет, а не тьма.
 */
function volumeBrighterTint(one, two) {
  const grey = [200, 200, 200];
  const sum = (tint) => volumeTintRgb(grey, tint).reduce((total, value) => total + value, 0);
  return sum(two) > sum(one) ? two : one;
}

// ——— пятна ламп ———

/**
 * Доли пятна по кольцам — от края к середине: на краю кольца свет падает до
 * этой доли от середины. Шесть колец и шаг между ними растёт к середине: у
 * края, где глаз видит ступень яснее всего на тёмном, ступени мельче. Четыре
 * кольца живой прогон отверг — на потолке читались круги.
 */
export const VOLUME_LAMP_RINGS = Object.freeze([0.05, 0.13, 0.25, 0.41, 0.6, 0.82]);
/** Самое яркое место пятна: даже под лампой стена остаётся стеной. */
const VOLUME_LAMP_PEAK = 0.9;
/** Сила пятна: доля на мм² — пол под плафоном светится в полную силу пятна. */
const VOLUME_LAMP_GAIN = 9e6;
/** Размытие точки света: лампа не точка, и пятно у самой стены не сходится в иглу. */
const VOLUME_LAMP_SOFT_MM = 300;
/** Дальше этого пятно не растёт: весь пол квартиры одной лампой не светится. */
const VOLUME_LAMP_REACH_MM = 6000;
/** Пятно тусклее этого не рисуется вовсе. */
const VOLUME_LAMP_FAINT = 0.03;
/** Сколько сторон у кольца пятна: углов у края шестнадцатиугольника не видно. */
const VOLUME_LAMP_SIDES = 16;
/** Доля ночи, с которой пятна ламп видны: днём их не рисуют. */
export const VOLUME_LAMP_DUSK = 0.02;
/** Кольцо прозрачнее этого в кадр не идёт: его не видно. */
export const VOLUME_LAMP_INVISIBLE = 0.004;

const volumeDecalMemo = new WeakMap();

/**
 * **Пятна ламп сцены**: `Map<кусок грани, [{markId, p, alpha, src, seams}]>` —
 * кольца каждой лампы на кусках пола, стен и потолка, на которые она светит.
 * Кусок — ровно тот, что лежит в дереве порядка (`scene.order`): кольцо
 * обрезано им и рисуется сразу за ним. `seams` — рёбра кольца, лежащие на краю
 * куска (`volumeDecalSeams`), `src` — источник лампы, от которого кольцо.
 *
 * От включённости это не зависит: геометрия считается **на все лампы сцены
 * разом** и раз на сцену, а кадр берёт кольца горящих и красит их по яркости.
 * Сцена пересобирается на открытую дверь — и клин сквозь проём вместе с ней.
 */
export function volumeLampDecals(scene, live) {
  const built = volumeLampBuilt(scene, live);
  return built ? built.decals : null;
}

/**
 * **Тени вещей от ламп** (правка после сборки сценариев: «Мебель должна
 * отбрасывать тень от ламп»): `Map<кусок грани, [{markId, p, own, mix, gone,
 * seams}]>` — куда габарит вещи чертежа закрывает лампу своего помещения.
 *
 * Тень — не тёмное пятно, а **кусок без этой лампы**: кадр кладёт поверх
 * колец сам кусок в его свете без пятен (`shadow` у `volumeLiveFill`) такой
 * прозрачностью, чтобы из света в этом месте ушла ровно доля лампы. `own` —
 * сколько света даёт здесь источник тени, `mix` — `[markId, доля, …]`: сколько
 * дают все лампы, чьи кольца легли сюда. Одна лампа — тень снимает весь её
 * свет, три — только свет своей, и под столом от двух других светло.
 *
 * Считается с пятнами, тем же разом на сцену и набор ламп.
 */
export function volumeLampShades(scene, live) {
  const built = volumeLampBuilt(scene, live);
  return built ? built.shades : null;
}

/** Пятна и тени ламп сцены — раз на сцену и набор ламп. */
function volumeLampBuilt(scene, live) {
  if (!scene || !scene.order) return null;
  const ids = [];
  for (const [markId, item] of live || []) if (item && item.kind === "light") ids.push(markId);
  ids.sort();
  const sign = ids.join(" ");
  const held = volumeDecalMemo.get(scene);
  if (held && held.sign === sign) return held;
  const built = { sign, ...volumeLampDecalsBuild(scene, ids, live) };
  volumeDecalMemo.set(scene, built);
  return built;
}

function volumeLampDecalsBuild(scene, ids, live) {
  const decals = new Map();
  const shades = new Map();
  const byRoom = volumeDecalHosts(scene);
  const ways = volumeLampOpenings(scene).filter((way) => !way.shut);
  const occluders = scene.occluders || [];
  for (const markId of ids) {
    const place = volumeMarkPlace(scene, markId);
    if (!place) continue;
    const item = live.get(markId);
    const key = (item && item.roomId) || volumeRoomKeyAt(scene, volumeMarkProbe(place));
    if (!key) continue;
    for (const source of volumeLampSources(place)) {
      const blockers = volumeShadeBlockers(occluders, key, source.at);
      const shade = blockers.length > 0 ? { blockers, shades, planes: new Map() } : null;
      volumeSourcePools(decals, byRoom, ways, key, markId, source, shade);
    }
  }
  volumeShadeMix(decals, shades);
  return { decals, shades };
}

const volumeHostMemo = new WeakMap();

/** На чём лежат пятна: куски пола, стен и потолка дерева порядка по комнатам — раз на сцену. */
function volumeDecalHosts(scene) {
  const held = volumeHostMemo.get(scene);
  if (held) return held;
  const byRoom = new Map();
  for (const face of volumeOrderAll(scene.order, [])) {
    if (!face.room || face.line) continue;
    // Полотно двери — тоже (правка после сборки сценариев): раскрытое стоит в
    // тёмной соседке, и без пятна его сторона к проёму оставалась чёрной рядом
    // со светлым проёмом.
    const door = face.rgb === VOLUME_DOOR_RGB && face.doorId;
    // Мебель и тела меток — тоже (правка после сборки сценариев): «сделай что
    // бы физический свет подсвечивал объекты (мебель)». Светящееся тело —
    // нет: горит оно своим светом, а пятно чужой лампы его бы притушило.
    const thing = face.thing && !face.lit && !face.led;
    if (!door && !thing && !volumeIsFloor(face) && !volumeIsWall(face) && !volumeIsCeiling(face)) continue;
    let list = byRoom.get(face.room);
    if (!list) byRoom.set(face.room, (list = []));
    list.push(face);
  }
  for (const list of byRoom.values()) volumeFindSeams(list);
  volumeHostMemo.set(scene, byRoom);
  return byRoom;
}

/** Швы кусков: `кусок → [номер ребра]` (`volumeFindSeams`). */
const volumeSeamMemo = new WeakMap();

/** Рёбра куска, по которым он встык с соседом той же плоскости и комнаты. */
function volumeHostSeams(host) {
  return volumeSeamMemo.get(host) || null;
}

/**
 * Где куски одной комнаты лежат встык в одной плоскости: дерево порядка
 * разрезало грань, и пятно на двух половинах должно сойтись без шва
 * (`volumeSeamGrow`). Край комнаты, угол и кромка грани швом не считаются —
 * за ними пятна этой лампы нет, и раздавать его туда значило бы пустить свет
 * гостиной полоской в коридор.
 */
function volumeFindSeams(hosts) {
  const groups = new Map();
  for (const host of hosts) {
    const n = host.n;
    const key = Math.round(n.x * 1e4) + " " + Math.round(n.y * 1e4) + " " + Math.round(n.z * 1e4);
    let group = groups.get(key);
    if (!group) groups.set(key, (group = []));
    const o = host.p[0];
    group.push({ host, at: n.x * o.x + n.y * o.y + n.z * o.z, box: volumeHostBox(host), joins: new Set() });
  }
  for (const group of groups.values()) {
    for (let i = 0; i < group.length; i += 1) {
      for (let j = i + 1; j < group.length; j += 1) {
        const a = group[i];
        const b = group[j];
        if (Math.abs(a.at - b.at) > VOLUME_SEAM_MM || !volumeBoxesTouch(a.box, b.box)) continue;
        volumeSharedEdges(a, b);
      }
    }
    // Кусок без швов снимает и прежние: неподвижные куски живут из сборки в
    // сборку (`volumeOrderTree`), а их сосед-полотно — уже другой.
    for (const item of group) {
      if (item.joins.size > 0) volumeSeamMemo.set(item.host, [...item.joins].sort((x, y) => x - y));
      else volumeSeamMemo.delete(item.host);
    }
  }
}

const volumeHostBoxMemo = new WeakMap();

/** Габарит куска — раз на кусок. */
function volumeHostBox(host) {
  let box = volumeHostBoxMemo.get(host);
  if (!box) volumeHostBoxMemo.set(host, (box = volumeBox3(host.p)));
  return box;
}

function volumeBoxesTouch(a, b) {
  const e = VOLUME_SEAM_MM;
  return a.minX <= b.maxX + e && b.minX <= a.maxX + e && a.minY <= b.maxY + e && b.minY <= a.maxY + e && a.minZ <= b.maxZ + e && b.minZ <= a.maxZ + e;
}

/** Рёбра двух кусков одной плоскости, лежащие на одной прямой внахлёст, — в `joins` обоих. */
function volumeSharedEdges(a, b) {
  const pa = a.host.p;
  const pb = b.host.p;
  for (let i = 0; i < pa.length; i += 1) {
    const from = pa[i];
    const to = pa[(i + 1) % pa.length];
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const dz = to.z - from.z;
    const length = Math.hypot(dx, dy, dz);
    if (!(length > VOLUME_SEAM_MM)) continue;
    const off = (P) => {
      const px = P.x - from.x;
      const py = P.y - from.y;
      const pz = P.z - from.z;
      const cx = py * dz - pz * dy;
      const cy = pz * dx - px * dz;
      const cz = px * dy - py * dx;
      return { gap: Math.hypot(cx, cy, cz) / length, along: (px * dx + py * dy + pz * dz) / length };
    };
    for (let j = 0; j < pb.length; j += 1) {
      const p = off(pb[j]);
      const q = off(pb[(j + 1) % pb.length]);
      if (p.gap > VOLUME_SEAM_MM || q.gap > VOLUME_SEAM_MM) continue;
      // Внахлёст больше миллиметра, а не касание концами.
      const lo = Math.max(0, Math.min(p.along, q.along));
      const hi = Math.min(length, Math.max(p.along, q.along));
      if (hi - lo <= 1) continue;
      a.joins.add(i);
      b.joins.add(j);
    }
  }
}

/**
 * Сколько точек у лампы, когда она светит сквозь проём: клин с края мягкий,
 * а не срезанный ножом.
 */
export const VOLUME_LAMP_SOFT_STEPS = 6;

/**
 * Пятно одного источника: на кусках своей комнаты и клином сквозь открытые
 * проёмы.
 *
 * **Клин — от лампы размером, а не от точки** (правка после сборки сценариев:
 * «В проёмах и у стены какая странная тень»). Из точки косяки срезали клин
 * ножом, и у трёх ламп гостиной на полу коридора сходились в углу проёма три
 * пары резких рёбер — веером, кусками разной светлоты. Теперь лампа — отрезок
 * вдоль проёма шириной в её размытие (`VOLUME_LAMP_SOFT_MM` в обе стороны), и
 * клин кладут `VOLUME_LAMP_SOFT_STEPS` его точек, каждая своей долей: у угла
 * проёма край по-прежнему резкий — там тень касается косяка, — а дальше
 * расходится полутенью, как от настоящего плафона.
 */
function volumeSourcePools(decals, byRoom, ways, key, id, source, shade = null) {
  for (const host of byRoom.get(key) || []) volumeLampPool(decals, host, id, source, null, 1, shade);
  for (const way of ways) {
    const into = way.left === key ? way.right : way.right === key ? way.left : null;
    if (!into) continue;
    // Ближняя к источнику сторона проёма и дальняя: пучок срезают обе, как
    // срезают его косяки.
    const near = way.left === key ? way.plus : way.minus;
    const far = way.left === key ? way.minus : way.plus;
    const share = 1 / VOLUME_LAMP_SOFT_STEPS;
    for (let step = 0; step < VOLUME_LAMP_SOFT_STEPS; step += 1) {
      // Точки — по диагонали: у каждой своя доля и вдоль проёма, и по высоте,
      // и мягкими выходят и бока клина (тень косяков), и его дальний край
      // (тень перемычки).
      const shift = ((step + 0.5) / VOLUME_LAMP_SOFT_STEPS - 0.5) * 2 * VOLUME_LAMP_SOFT_MM;
      const at = { x: source.at.x + way.u.x * shift, y: source.at.y + way.u.y * shift, z: source.at.z - shift / 2 };
      const point = { ...source, at };
      for (const host of byRoom.get(into) || []) volumeLampPool(decals, host, id, point, { near, far, n: way.n }, share);
    }
  }
}

/** Все грани дерева порядка — куски, как они лежат в узлах. */
function volumeOrderAll(node, out) {
  if (!node) return out;
  for (const face of node.same) out.push(face);
  volumeOrderAll(node.front, out);
  volumeOrderAll(node.back, out);
  return out;
}

/**
 * Насколько лампа светит на плоскость с нормалью `n`: потолочная — в пол
 * целиком, в стены наполовину, в свой потолок едва; на стене — свою стену
 * целиком (подсветка картины светит картину); во все стороны — поровну.
 */
function volumeLampFacing(n, source, distanceMm) {
  if (source.wall && n.x * source.wall.x + n.y * source.wall.y > 0.9 && distanceMm < 300) return 1;
  if (!source.dir) return 0.6;
  const k = -(n.x * source.dir.x + n.y * source.dir.y + n.z * source.dir.z);
  // Окно светит туда, куда смотрит, и почти не светит себе за спину: своя
  // стена окна и потолок над ним — самые тёмные в комнате.
  if (source.sky) return ((k + 1) / 2) ** 2;
  return 0.15 + (0.85 * (k + 1)) / 2;
}

/**
 * Кольца одной лампы на одном куске грани. `way` — проём, сквозь который свет
 * идёт в соседнюю комнату: тогда кольца срезаются ещё и тенью его краёв —
 * проекцией проёма из точки света на плоскость куска.
 *
 * Плоскость куска — его собственная, кольцо считается в ней: середина — точка
 * под лампой, радиусы — где свет падает до доли кольца (`VOLUME_LAMP_RINGS`)
 * по закону `1 / (d² + ρ² + s²)`. Доля середины — `VOLUME_LAMP_GAIN · сила /
 * (d² + s²)`, не больше `VOLUME_LAMP_PEAK`, и на направление лампы.
 * Прозрачность кольца — приращение: наложенные друг на друга кольца дают ровно
 * долю своего кольца.
 *
 * `shade` — вещи, отбрасывающие тень от этого источника (`volumeLampShade`):
 * только в своей комнате, клину сквозь проём теней нет.
 */
function volumeLampPool(decals, host, markId, source, way, share = 1, shade = null) {
  let n = host.n;
  const o = host.p[0];
  const L = source.at;
  let d = n.x * (L.x - o.x) + n.y * (L.y - o.y) + n.z * (L.z - o.z);
  // Двусторонняя грань (полотно двери) светится той стороной, что смотрит на
  // лампу; кольцо несёт нормаль этой стороны, и с изнанки его не видно.
  const flipped = host.both && d < -1;
  if (flipped) {
    n = { x: -n.x, y: -n.y, z: -n.z };
    d = -d;
  }
  if (!(d > 1)) return;
  const soft2 = d * d + VOLUME_LAMP_SOFT_MM * VOLUME_LAMP_SOFT_MM;
  const whole = Math.min(VOLUME_LAMP_PEAK, (VOLUME_LAMP_GAIN * source.power) / soft2) * volumeLampFacing(n, source, d);
  // Тусклое отбрасывается по силе всей лампы, а не своей доли: доля клина
  // (`volumeSourcePools`) слабее, но светит вместе с соседками.
  if (whole < VOLUME_LAMP_FAINT) return;
  const peak = whole * share;
  const radii = VOLUME_LAMP_RINGS.map((q) => Math.min(VOLUME_LAMP_REACH_MM, source.beam * Math.sqrt(soft2 * (1 / q - 1))));
  // Оси плоскости: у пола и потолка — оси плана, у стены — вдоль неё и вверх.
  const flat = Math.abs(n.z) > 0.9;
  const e1 = flat ? { x: 1, y: 0, z: 0 } : volumeNormalize({ x: -n.y, y: n.x, z: 0 });
  const e2 = flat ? { x: 0, y: 1, z: 0 } : { x: 0, y: 0, z: 1 };
  const to2 = (X) => {
    const dx = X.x - o.x;
    const dy = X.y - o.y;
    const dz = X.z - o.z;
    return { x: dx * e1.x + dy * e1.y + dz * e1.z, y: dx * e2.x + dy * e2.y + dz * e2.z };
  };
  const centre = to2({ x: L.x - n.x * d, y: L.y - n.y * d, z: L.z - n.z * d });
  let shape = host.p.map(to2);
  // Свой кусок целиком — по нему ищутся швы (`volumeDecalSeams`): клин сквозь
  // проём `shape` ещё обрежет.
  const outline = shape;
  const joins = volumeHostSeams(host);
  // Кусок дальше внешнего кольца — мимо.
  const reach = radii[0];
  let near = Infinity;
  for (const point of shape) near = Math.min(near, Math.hypot(point.x - centre.x, point.y - centre.y));
  if (near > reach) {
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const point of shape) {
      minX = Math.min(minX, point.x);
      maxX = Math.max(maxX, point.x);
      minY = Math.min(minY, point.y);
      maxY = Math.max(maxY, point.y);
    }
    const gapX = Math.max(minX - centre.x, 0, centre.x - maxX);
    const gapY = Math.max(minY - centre.y, 0, centre.y - maxY);
    if (Math.hypot(gapX, gapY) > reach) return;
  }
  if (way) {
    const middle = volumeMiddleOf(host.p);
    for (const edge of [way.near, way.far]) {
      // Сторона проёма режет пучок только тому, что лежит **за ней**: порог и
      // откос внутри толщины стены лампа видит сквозь ближнюю сторону, а
      // дальняя от них по ту же руку, что лампа. Без этого правила половина
      // порога у соседки оставалась тёмной полосой посреди светлого проёма.
      if (way.n) {
        const sideOf = (point) => (point.x - edge[0].x) * way.n.x + (point.y - edge[0].y) * way.n.y;
        const here = sideOf(middle);
        if (Math.abs(here) < 1 || here * sideOf(L) > 0) continue;
      }
      const beam = volumeLampBeam(edge, L, n, o);
      if (!beam) return;
      shape = volumeClipPolygon(shape, beam.map(to2));
      if (shape.length < 3) return;
    }
  }
  const from2 = (point) => ({
    x: o.x + e1.x * point.x + e2.x * point.y,
    y: o.y + e1.y * point.x + e2.y * point.y,
    z: o.z + e1.z * point.x + e2.z * point.y,
  });
  let list = decals.get(host);
  let before = 0;
  let first = 0;
  // Кольца, которые накрывают кусок целиком, класть стопкой одинаковых
  // многоугольников незачем — они сливаются в один с долей самого внутреннего
  // из них (доли колец — приращения, и стопка даёт ровно её). Внутренние, что
  // режут кусок, идут по одному. Сначала так стало у вещей — их куски
  // маленькие; потом у всех (правка «оптимизировать весь Объём»): дерево
  // порядка режет стену и пол на полосы, и у полосы вдали от лампы все шесть
  // колец были одним и тем же куском шесть раз — шесть заливок вместо одной.
  const put = (piece, alpha) => {
    if (!list) decals.set(host, (list = []));
    const seams = volumeDecalSeams(piece, outline, joins);
    const ring = flipped ? { markId, p: piece.map(from2), alpha, n, src: source, seams } : { markId, p: piece.map(from2), alpha, src: source, seams };
    list.push(ring);
    return ring;
  };
  let merged = null;
  {
    const inner = Math.cos(Math.PI / VOLUME_LAMP_SIDES);
    let far = 0;
    for (const point of shape) far = Math.max(far, Math.hypot(point.x - centre.x, point.y - centre.y));
    while (first < radii.length && radii[first] * inner >= far) first += 1;
    if (first > 0) {
      before = peak * VOLUME_LAMP_RINGS[first - 1];
      merged = put(shape, before);
    }
  }
  for (let index = first; index < radii.length; index += 1) {
    const piece = volumeClipPolygon(shape, volumeRingPoints(centre, radii[index]));
    const target = peak * VOLUME_LAMP_RINGS[index];
    // Кольцо, хоть край его и прошёл у самого угла, накрыло кусок целиком —
    // и оно уходит в общий кусок, а не ложится вторым таким же.
    if (piece.length === shape.length && piece.every((point, at) => point.x === shape[at].x && point.y === shape[at].y)) {
      before = target;
      if (merged) merged.alpha = target;
      else merged = put(shape, target);
      continue;
    }
    const alpha = 1 - (1 - target) / (1 - before);
    before = target;
    if (piece.length < 3) continue;
    put(piece, alpha);
  }
  if (shade && !way && !host.both && list) volumeLampShade(shade, host, markId, source, { n, o, d, to2, from2, centre, shape, joins, reach: radii[0] });
}

/** Углы кольца пятна на единичной окружности — раз на сборку модуля. */
const VOLUME_RING_UNIT = Array.from({ length: VOLUME_LAMP_SIDES }, (item, side) => {
  const angle = (side / VOLUME_LAMP_SIDES) * Math.PI * 2;
  return { x: Math.cos(angle), y: Math.sin(angle) };
});

/** Кольцо пятна: шестнадцатиугольник радиуса `radius` вокруг `centre` в плоскости куска. */
function volumeRingPoints(centre, radius) {
  return VOLUME_RING_UNIT.map((unit) => ({ x: centre.x + unit.x * radius, y: centre.y + unit.y * radius }));
}

/** Насколько точка может отойти от края куска, оставаясь на нём, мм. */
const VOLUME_SEAM_MM = 0.5;
/**
 * На сколько экранных точек пятно раздаётся наружу по шву: столько же, сколько
 * закрывала прежняя обводка в точку толщиной, — половина с каждой стороны.
 */
export const VOLUME_SEAM_GROW_PX = 0.5;
/** Сдвиги точек для `volumeSeamGrow` — один запас на все кадры, без мусора. */
let volumeSeamMoves = new Float64Array(64);

/**
 * **Швы пятна**: номера рёбер многоугольника `piece` (ребро `i` — от точки `i`
 * к следующей), которые лежат на рёбрах `joins` куска `shape` — там, где кусок
 * встык с соседом той же плоскости и той же комнаты (`volumeHostSeams`). Оба
 * многоугольника — в плоскости куска.
 *
 * Пол и стену дерево порядка режет на куски, и кольцо одного пятна ложится
 * на соседние куски двумя многоугольниками встык. Без обводки сглаживание
 * края у каждого из двух закрашивает пиксель шва наполовину — и по куску
 * проступала тёмная линия, тем темнее, чем больше колец в стопке. Поэтому по
 * этим рёбрам пятно в кадре раздаётся на полточки (`volumeSeamGrow`), а дуги
 * колец остаются мягкими: обводка по дуге и давала круги на потолке.
 * Обводить одни швы не годилось: телефону дорог сам вызов обводки, а не её
 * длина, и кадр с обводкой швов стоил почти столько же, сколько с полной.
 */
function volumeDecalSeams(piece, shape, joins) {
  const seams = [];
  if (!joins || joins.length === 0) return seams;
  for (let index = 0; index < piece.length; index += 1) {
    const a = piece[index];
    const b = piece[(index + 1) % piece.length];
    for (const at of joins) {
      const from = shape[at];
      const to = shape[(at + 1) % shape.length];
      if (volumeOnEdge(a, from, to) && volumeOnEdge(b, from, to)) {
        seams.push(index);
        break;
      }
    }
  }
  return seams;
}

/**
 * Раздать многоугольник `xy` (экранные точки подряд) наружу по рёбрам `seams`
 * на `VOLUME_SEAM_GROW_PX`: обе точки ребра — по его внешней нормали. Точка
 * между двумя швами уходит по обеим.
 */
export function volumeSeamGrow(xy, seams) {
  const count = xy.length / 2;
  let area = 0;
  for (let index = 0; index < count; index += 1) {
    const next = (index + 1) % count;
    area += xy[index * 2] * xy[next * 2 + 1] - xy[next * 2] * xy[index * 2 + 1];
  }
  const sign = area > 0 ? 1 : -1;
  if (volumeSeamMoves.length < xy.length) volumeSeamMoves = new Float64Array(xy.length * 2);
  const moves = volumeSeamMoves;
  moves.fill(0, 0, xy.length);
  for (const index of seams) {
    const next = (index + 1) % count;
    const dx = xy[next * 2] - xy[index * 2];
    const dy = xy[next * 2 + 1] - xy[index * 2 + 1];
    const length = Math.hypot(dx, dy);
    if (!(length > 0)) continue;
    const nx = (sign * dy * VOLUME_SEAM_GROW_PX) / length;
    const ny = (-sign * dx * VOLUME_SEAM_GROW_PX) / length;
    moves[index * 2] += nx;
    moves[index * 2 + 1] += ny;
    moves[next * 2] += nx;
    moves[next * 2 + 1] += ny;
  }
  for (let index = 0; index < xy.length; index += 1) xy[index] += moves[index];
  return xy;
}

/** Лежит ли точка на отрезке `from → to` (в пределах `VOLUME_SEAM_MM`). */
function volumeOnEdge(point, from, to) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length2 = dx * dx + dy * dy;
  if (!(length2 > 0)) return false;
  const cross = dx * (point.y - from.y) - dy * (point.x - from.x);
  if (cross * cross > VOLUME_SEAM_MM * VOLUME_SEAM_MM * length2) return false;
  const along = dx * (point.x - from.x) + dy * (point.y - from.y);
  const slack = VOLUME_SEAM_MM * Math.sqrt(length2);
  return along >= -slack && along <= length2 + slack;
}

// ——— тени вещей от ламп (правка после сборки сценариев) ———
//
// Слова заказчика: «Мебель должна отбрасывать тень от ламп». Тень — габарит
// вещи (`scene.occluders`), спроецированный из точки лампы на плоскость куска,
// на котором лежит её пятно: пол, стена, потолок, соседняя вещь. Габарит —
// выпуклая призма, и тень его — выпуклая оболочка проекций её вершин.

/**
 * Выше этой доли высоты лампы над плоскостью вещь тень не удлиняет: луч через
 * такую точку уходит почти вдоль плоскости, и тень её кончалась бы за
 * квартирой. Вещь срезается на этой высоте — тень от шкафа выше настенного
 * светильника всё равно доходит до края пятна.
 */
const VOLUME_SHADE_TOP = 0.9;
/**
 * Тень, где её лампа даёт меньше этой доли, не кладётся: на краю пятна она
 * темнит пол на пару оттенков, а в комнате с двадцатью лампами таких — тысячи.
 */
const VOLUME_SHADE_FAINT = 0.05;

/**
 * Вещи помещения `key`, от которых источник в точке `at` отбрасывает тень.
 * Вещь, внутри которой лампа, — не тень, а абажур: лампа на столе светит над
 * столом, а не гаснет.
 */
function volumeShadeBlockers(occluders, key, at) {
  const out = [];
  for (const occluder of occluders) {
    if (occluder.room !== key) continue;
    if (at.z >= occluder.bottomMm - 1 && at.z <= occluder.topMm + 1 && volumePointInside(at, occluder.corners)) continue;
    // Вещь дальше, чем достаёт пятно, тени в нём не кладёт: в большой комнате
    // это и есть почти все вещи для каждой лампы.
    let near = Infinity;
    for (const corner of occluder.corners) near = Math.min(near, Math.hypot(corner.x - at.x, corner.y - at.y));
    if (near > VOLUME_LAMP_REACH_MM && !volumePointInside(at, occluder.corners)) continue;
    out.push(occluder);
  }
  return out;
}

/**
 * Тень вещи на плоскости `(n, o)` от точки `L`, поднятой над ней на `d`:
 * проекции вершин габарита, срезанного плоскостью куска и высотой
 * `VOLUME_SHADE_TOP` (точки в трёх осях, на плоскости), или `null` — вещь не
 * между лампой и плоскостью.
 */
function volumeShadeHull(blocker, L, n, o, d) {
  const top = d * VOLUME_SHADE_TOP;
  const corners = blocker.corners;
  const count = corners.length;
  const points = [];
  const at = [];
  for (const z of [blocker.bottomMm, blocker.topMm]) {
    for (const corner of corners) at.push({ x: corner.x, y: corner.y, z });
  }
  const level = at.map((P) => n.x * (P.x - o.x) + n.y * (P.y - o.y) + n.z * (P.z - o.z));
  const cast = (P, h) => {
    const s = d / (d - h);
    points.push({ x: L.x + (P.x - L.x) * s, y: L.y + (P.y - L.y) * s, z: L.z + (P.z - L.z) * s });
  };
  for (let index = 0; index < at.length; index += 1) if (level[index] >= 0 && level[index] <= top) cast(at[index], level[index]);
  const edge = (i, j) => {
    for (const cut of [0, top]) {
      const a = level[i] - cut;
      const b = level[j] - cut;
      if (!(a * b < 0)) continue;
      const t = a / (a - b);
      cast({ x: at[i].x + (at[j].x - at[i].x) * t, y: at[i].y + (at[j].y - at[i].y) * t, z: at[i].z + (at[j].z - at[i].z) * t }, cut);
    }
  };
  for (let i = 0; i < count; i += 1) {
    const j = (i + 1) % count;
    edge(i, j);
    edge(count + i, count + j);
    edge(i, count + i);
  }
  return points.length >= 3 ? points : null;
}

/**
 * Тени вещей `shade.blockers` от одного источника на одном куске: оболочка
 * проекций габарита, обрезанная внешним кольцом пятна (дальше лампа не
 * светит — и тени нет) и самим куском. Плоскость у кусков пола одна на всех,
 * и оболочка считается раз на плоскость (`shade.planes`).
 */
function volumeLampShade(shade, host, markId, source, plane) {
  const { n, o, d, to2, from2, centre, shape, joins } = plane;
  const key = n.x.toFixed(3) + " " + n.y.toFixed(3) + " " + n.z.toFixed(3) + " " + Math.round(n.x * o.x + n.y * o.y + n.z * o.z);
  let hulls = shade.planes.get(key);
  if (!hulls) shade.planes.set(key, (hulls = new Map()));
  let reach = null;
  const box = volumeHostBox(host);
  // Лучи от лампы к куску лежат в габарите «лампа плюс кусок»: вещь вне его
  // кусок не затеняет, и её тень на эту плоскость можно не строить.
  const L = source.at;
  const rays = {
    minX: Math.min(box.minX, L.x),
    minY: Math.min(box.minY, L.y),
    minZ: Math.min(box.minZ, L.z),
    maxX: Math.max(box.maxX, L.x),
    maxY: Math.max(box.maxY, L.y),
    maxZ: Math.max(box.maxZ, L.z),
  };
  for (const blocker of shade.blockers) {
    // Своей тени на себе вещь не получает: её отвёрнутые грани и так без пятна.
    if (host.thing === blocker.id) continue;
    if (!volumeBoxesTouch(blocker.box, rays)) continue;
    if (!hulls.has(blocker)) {
      const points = volumeShadeHull(blocker, source.at, n, o, d);
      hulls.set(blocker, points ? { points, box: volumeBox3(points) } : null);
    }
    const cast = hulls.get(blocker);
    // Тень мимо куска — дальше не считается: у пола комнаты десятки кусков, а
    // тень вещи ложится на немногие.
    if (!cast || !volumeBoxesTouch(cast.box, box)) continue;
    const hull = cast.points;
    // Внешнее кольцо режет только тень, вышедшую за него.
    let shadow = volumeHull(hull.map(to2));
    const inner = plane.reach * Math.cos(Math.PI / VOLUME_LAMP_SIDES);
    if (shadow.some((point) => Math.hypot(point.x - centre.x, point.y - centre.y) > inner)) {
      if (!reach) reach = volumeRingPoints(centre, plane.reach);
      shadow = volumeClipPolygon(shadow, reach);
    }
    if (shadow.length < 3) continue;
    const piece = volumeClipPolygon(shape, shadow);
    if (piece.length < 3) continue;
    let list = shade.shades.get(host);
    if (!list) shade.shades.set(host, (list = []));
    list.push({ markId, src: source, p: piece.map(from2), at: from2(volumeCentroid2(piece)), own: 0, mix: null, gone: null, seams: volumeDecalSeams(piece, shape, joins) });
  }
}

/** Середина многоугольника по площади (в плоскости); у вырожденного — средняя точка. */
function volumeCentroid2(points) {
  let area = 0;
  let x = 0;
  let y = 0;
  for (let index = 0; index < points.length; index += 1) {
    const a = points[index];
    const b = points[(index + 1) % points.length];
    const cross = a.x * b.y - b.x * a.y;
    area += cross;
    x += (a.x + b.x) * cross;
    y += (a.y + b.y) * cross;
  }
  if (Math.abs(area) < 1e-9) {
    const middle = volumeMiddleOf(points.map((point) => ({ x: point.x, y: point.y, z: 0 })));
    return { x: middle.x, y: middle.y };
  }
  return { x: x / (3 * area), y: y / (3 * area) };
}

/**
 * Сколько света в середине каждой тени даёт её источник (`own`) и каждая
 * лампа, чьи кольца легли туда (`mix`): по самим кольцам куска, теми долями,
 * которыми их кладёт кадр. Тень, где её источник почти не светит
 * (`VOLUME_SHADE_FAINT`), отбрасывается.
 *
 * `gone` — `[markId, доля, …]`: источники других ламп, чьи тени кадр кладёт
 * на эту точку раньше. Их света здесь уже нет, и тень снимает свою долю из
 * того, что осталось: под столом в комнате с тремя лампами три тени дают
 * темноту, а не треть её.
 */
function volumeShadeMix(decals, shades) {
  for (const [host, list] of shades) {
    const n = host.n;
    const ax = Math.abs(n.x);
    const ay = Math.abs(n.y);
    const az = Math.abs(n.z);
    // Точка в многоугольнике — в двух осях: та, вдоль которой смотрит кусок,
    // отбрасывается. Кольца куска сводятся к двум осям раз на кусок.
    const u = az >= ax && az >= ay ? "x" : ax >= ay ? "y" : "x";
    const v = az >= ax && az >= ay ? "y" : "z";
    const rings = (decals.get(host) || []).map((ring) => ({ ring, flat: volumeFlat2(ring.p, u, v) }));
    const kept = [];
    for (const shade of list) {
      const px = shade.at[u];
      const py = shade.at[v];
      const keeps = new Map();
      const bySource = new Map();
      for (const { ring, flat } of rings) {
        if (!volumeInsideFlat(flat, px, py)) continue;
        keeps.set(ring.markId, (keeps.has(ring.markId) ? keeps.get(ring.markId) : 1) * (1 - ring.alpha));
        bySource.set(ring.src, (bySource.has(ring.src) ? bySource.get(ring.src) : 1) * (1 - ring.alpha));
      }
      shade.own = 1 - (bySource.has(shade.src) ? bySource.get(shade.src) : 1);
      if (!(shade.own > VOLUME_SHADE_FAINT)) continue;
      const mix = [];
      for (const [markId, keep] of keeps) mix.push(markId, 1 - keep);
      shade.mix = mix;
      const gone = [];
      for (const before of kept) {
        if (before.shade.markId === shade.markId || !volumeInsideFlat(before.flat, px, py)) continue;
        if (bySource.has(before.shade.src)) gone.push(before.shade.markId, 1 - bySource.get(before.shade.src));
      }
      shade.gone = gone;
      kept.push({ shade, flat: volumeFlat2(shade.p, u, v) });
    }
    for (const item of kept) item.shade.src = null;
    if (kept.length > 0) shades.set(host, kept.map((item) => item.shade));
    else shades.delete(host);
  }
}

/**
 * Многоугольник в двух осях `u`, `v` для `volumeInsideFlat`: точки подряд и
 * габарит — по нему мимо проходящая точка отсеивается сразу.
 */
function volumeFlat2(points, u, v) {
  const xy = new Float64Array(points.length * 2);
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let index = 0; index < points.length; index += 1) {
    const x = points[index][u];
    const y = points[index][v];
    xy[index * 2] = x;
    xy[index * 2 + 1] = y;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return { xy, minX, maxX, minY, maxY };
}

/** Точка `(px, py)` в многоугольнике, сведённом к двум осям (`volumeFlat2`). */
function volumeInsideFlat(flat, px, py) {
  if (px < flat.minX || px > flat.maxX || py < flat.minY || py > flat.maxY) return false;
  const xy = flat.xy;
  const count = xy.length / 2;
  let inside = false;
  for (let index = 0, back = count - 1; index < count; back = index, index += 1) {
    const ax = xy[index * 2];
    const ay = xy[index * 2 + 1];
    const bx = xy[back * 2];
    const by = xy[back * 2 + 1];
    if (ay > py !== by > py && px < ((bx - ax) * (py - ay)) / (by - ay) + ax) inside = !inside;
  }
  return inside;
}

/**
 * Прозрачность тени в кадре: насколько надо вернуть кусок к его свету без
 * пятен, чтобы из света ушла ровно доля источника тени при нынешней яркости
 * ламп (`lamps`: `markId → сила`).
 *
 * Кольца кладутся одно на другое, и света в точке — `1 − П(1 − aₖ)` по лампам.
 * Кусок поверх колец прозрачностью `s` оставляет от света `(1 − П)(1 − s)`, а
 * без источника тени света `1 − П/(1 − a)`; отсюда `s`. Одна лампа — тень
 * снимает весь её свет. Тени, положенные сюда раньше (`gone`), свой свет уже
 * сняли — из `П` он вынут.
 */
export function volumeShadeAlpha(shade, lamps) {
  const strength = lamps ? lamps.get(shade.markId) || 0 : 0;
  if (!(strength > 0) || !shade.mix) return 0;
  let keep = 1;
  for (let index = 0; index < shade.mix.length; index += 2) {
    const level = lamps.get(shade.mix[index]) || 0;
    keep *= 1 - Math.min(1, level * shade.mix[index + 1]);
  }
  for (let index = 0; index < (shade.gone || []).length; index += 2) {
    const level = lamps.get(shade.gone[index]) || 0;
    keep /= 1 - Math.min(0.999, level * shade.gone[index + 1]);
  }
  keep = Math.min(1, keep);
  const light = 1 - keep;
  if (!(light > VOLUME_LAMP_INVISIBLE)) return 0;
  const mine = Math.min(0.999, strength * shade.own);
  const without = 1 - keep / (1 - mine);
  return Math.max(0, Math.min(1, 1 - Math.max(0, without) / light));
}

/**
 * Тень края проёма: проём (`edge`, точки в трёх осях), спроецированный из
 * точки света `L` на плоскость `(n, o)`. `null` — хоть один луч уходит мимо
 * плоскости: проём над лампой (свет снизу вверх) или плоскость за спиной.
 * Луч, не дошедший до проёма, — тоже мимо: плоскость между лампой и проёмом
 * светит не сквозь него.
 */
function volumeLampBeam(edge, L, n, o) {
  const out = [];
  const plane = n.x * (o.x - L.x) + n.y * (o.y - L.y) + n.z * (o.z - L.z);
  for (const P of edge) {
    const dx = P.x - L.x;
    const dy = P.y - L.y;
    const dz = P.z - L.z;
    const toward = n.x * dx + n.y * dy + n.z * dz;
    if (!(toward < -1e-6)) return null;
    const s = plane / toward;
    if (!(s >= 1)) return null;
    out.push({ x: L.x + dx * s, y: L.y + dy * s, z: L.z + dz * s });
  }
  return out.length >= 3 ? out : null;
}

/**
 * Цвет грани при запущенном доме (таск 09 сценариев, история 2.12).
 *
 * Тело, которое может светиться, у включённого устройства берёт цвет
 * свечения (`volumeGlowFill`) — без тона часа и без светлоты лампы сцены:
 * светится, значит не темнеет; разгорается и гаснет оно от тёмного к светлому
 * плавно (`fade`). Грань помещения, где горит свет, сводится к ночи слабее
 * (`volumeRoomTint`); при физическом свете так же — откос и полотно проёма, по
 * более светлой из двух сторон (`sides`). Кольцо пятна (`decal`) — свет полной
 * лампы поверх своей грани, прозрачностью кольца. Остальное — как без
 * имитации.
 */
export function volumeLiveFill(face, normal, tint, live) {
  const alpha = face.alpha === undefined ? 1 : face.alpha;
  const shade = face.flat ? 1 : volumeShade(normal);
  // Тень вещи от лампы: свой кусок в своём свете — тот же счёт, что ниже у
  // обычной грани, только прозрачностью тени.
  if (face.shadow !== undefined) {
    const own = volumeLiveTint(face, tint, live);
    return volumeFill(face.rgb, shade, face.shadow, face.moon ? volumeMoonTint(own, face.moon) : own);
  }
  if (face.decal !== undefined) {
    // Под лампой и у окна грань светлее, чем просто без тьмы: светлота
    // поднимается к единице (`VOLUME_LAMP_LIFT`, `VOLUME_WINDOW_LIFT`).
    const lift = face.lamp === false ? VOLUME_WINDOW_LIFT : VOLUME_LAMP_LIFT;
    const full = face.lampRgb && live.fullOf ? live.fullOf(face.lampRgb) : live.full;
    return volumeFill(face.rgb, shade + (1 - shade) * lift, face.decal, face.lamp === false ? live.sky : full);
  }
  if (face.led) return volumeFill(face.rgb, 1, 1, null);
  if (face.lit && face.markId && live.glow) {
    const glow = live.glow.get(face.markId);
    // Тело своей лампы (`bulb`, правка после сборки сценариев) горит, только
    // пока горит она: звезда ели — от второй лампы, гирлянда — от первой.
    const mine = glow && (face.bulb === null || face.bulb === undefined || !glow.lamps || glow.lamps[face.bulb] > 0);
    if (mine) return volumeGlowFill(face.rgb, glow, alpha, tint, shade);
  }
  const own = volumeLiveTint(face, tint, live);
  return volumeFill(face.rgb, shade, alpha, face.moon ? volumeMoonTint(own, face.moon) : own);
}

/**
 * Тон грани в доме: у грани комнаты — тон её комнаты, у откоса и полотна при
 * физическом свете — более светлой из сторон (и улицы, если она с одной
 * стороны), у остального — тон часа. Считается раз на комнату и кадр.
 */
function volumeLiveTint(face, tint, live) {
  if (!live.rooms && !live.day) return tint;
  if (face.room) return volumeRoomTintOf(face.room, tint, live);
  if (!live.physical || !face.sides) return tint;
  const sides = face.sides;
  const held = live.tints ? live.tints.get(sides.key) : undefined;
  if (held !== undefined) return held;
  let own = volumeBrighterTint(volumeRoomTintOf(sides.a, tint, live), volumeRoomTintOf(sides.b, tint, live));
  if (sides.out) own = volumeBrighterTint(own, tint);
  if (live.tints) live.tints.set(sides.key, own);
  return own;
}

/** Тон комнаты: свет неба (если он есть) и сверху — лампы. */
function volumeRoomTintOf(key, tint, live) {
  const held = live.tints ? live.tints.get(key) : undefined;
  if (held !== undefined) return held;
  const base = live.day && live.day.has(key) ? volumeIndoorTint(tint, live.day.get(key)) : tint;
  const level = live.rooms ? live.rooms.get(key) || 0 : 0;
  const own = level > 0 ? volumeRoomTint(base, level, live.roomRgb ? live.roomRgb.get(key) || null : null) : base;
  if (live.tints) live.tints.set(key, own);
  return own;
}

/**
 * Цвет светящегося тела: материал, сведённый к цвету свечения по яркости.
 * Даже самая тусклая лампа светится заметно (`VOLUME_GLOW_MIN`).
 *
 * Пока лампа разгорается или гаснет (`glow.fade` меньше единицы), цвет идёт от
 * тёмного тела — материал в тоне часа и светлоте лампы сцены (`tint`,
 * `shade`) — к светящемуся: свет не вспыхивает и не обрывается.
 */
export function volumeGlowFill(rgb, glow, alpha = 1, tint = null, shade = 1) {
  const level = volumeShare01(glow && glow.level);
  const to = (glow && glow.rgb) || VOLUME_GLOW_RGB;
  const share = VOLUME_GLOW_MIN + (1 - VOLUME_GLOW_MIN) * level;
  const lit = volumeMix(rgb, to, share);
  const fade = glow && glow.fade !== undefined ? volumeShare01(glow.fade) : 1;
  if (!(fade < 1)) return volumeFill(lit, 1, alpha, null);
  const dark = volumeTintRgb(rgb, tint).map((value) => Math.max(0, Math.min(255, value * shade)));
  return volumeFill(volumeMix(dark, lit, fade), 1, alpha, null);
}

/**
 * Тон ночи в комнате, где горит свет: доля ночи меньше пропорционально
 * яркости, а сама ночь теплее — к цвету лампы. Днём доли ночи нет, и комната
 * остаётся какой была.
 */
export function volumeRoomTint(tint, level, lamp = null) {
  const share = tint ? volumeShare01(tint.share) : 0;
  const light = volumeShare01(level);
  if (!(light > 0)) return tint;
  // Две доли в одном тоне: тьма, которая осталась, и свет лампы поверх
  // дневной светлоты (`VOLUME_LAMP_LIGHT_SHARE`). Смесь двух целей — одна цель
  // с суммой долей: `материал·(1 − a − b) + тьма·a + свет·b`.
  const dark = share * (1 - VOLUME_ROOM_LIGHT * light);
  const glow = VOLUME_LAMP_LIGHT_SHARE * light;
  // Цветная лампа (правка после сборки сценариев) тянет ночь к своему цвету
  // той же долей, что тёплая — к тёплому.
  const rgb = lamp || VOLUME_LAMP_LIGHT_RGB;
  const warm = lamp ? lamp.map((value, index) => (value * VOLUME_ROOM_WARM_RGB[index]) / VOLUME_LAMP_LIGHT_RGB[index]) : VOLUME_ROOM_WARM_RGB;
  const night = volumeMix((tint && tint.rgb) || VOLUME_NIGHT_RGB, warm, VOLUME_ROOM_WARM * light);
  const sum = dark + glow;
  return { rgb: volumeMix(night, rgb, glow / sum), share: sum };
}

/** Тон полной лампы по её цвету — один раз на цвет за кадр. */
export function volumeFullMemo(base) {
  const held = new Map();
  return (rgb) => {
    const key = rgb.join(",");
    if (!held.has(key)) held.set(key, volumeRoomTint(base, 1, rgb));
    return held.get(key);
  };
}

/** Цвет лампы из состояния дома: три числа 0…255 или `null`. */
function volumeColorOf(rgb) {
  if (!Array.isArray(rgb) || rgb.length < 3) return null;
  const out = rgb.slice(0, 3).map((value) => Math.max(0, Math.min(255, Number(value) || 0)));
  return out;
}
