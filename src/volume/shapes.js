// «Объём»: общие помощники формы — точка в контуре, призмы, коробки, ключ
// комнаты по точке, тени вещей как призмы. Их зовут и сцена, и свет, и ходьба.
//
// Часть «Объёма», вынесенная из `src/volume.js` (2026-10-25) переносом без
// переименований: снаружи модуль читают через дверь `volume.js`, а соседи по
// `src/volume/` — напрямую. Зависимости идут только вниз по слоям (порядок —
// в шапке `volume.js`), циклов нет. Решения и доводы — в шапках разделов ниже.
import { schemeObjectsOnScheme, wallPlaceRoom, wallsOnScheme } from "../model.js";
import { volumeAt, volumeClockwise, volumeFace } from "./faces.js";

/**
 * Насколько глубоко в комнату заходит щуп, которым спрашивают сторону проёма.
 *
 * Полтора сантиметра от грани стены: контур помещения обводят по подложке
 * рукой, и промахнуться на сантиметр-другой — обычное дело (то же наблюдение,
 * из которого вышел напуск пола `VOLUME_FLOOR_LAP`). Больше брать нельзя:
 * перегородка в сто миллиметров, и щуп, заведённый на полметра, ушёл бы в
 * комнату за ней. Замер на объекте заказчика: все 13 проёмов отвечают одно и то
 * же при щупе 50, 150 и 400 мм — то есть выбор внутри этого разброса ни на что
 * не влияет, и взята середина.
 */
export const VOLUME_SUN_PROBE_MM = 150;

/**
 * Прямая призма по плановому многоугольнику: боковые грани, верх и — если вещь
 * висит над полом — низ. Низ лежащей на полу вещи не рисуется вовсе: его
 * никогда не видно, а грань стоит кадра.
 */
export function volumePrismFaces(corners, bottomMm, topMm, rgb, out, options = {}) {
  if (corners.length < 3 || !(topMm > bottomMm)) return out;
  const markId = options.markId || null;
  const doorId = options.doorId || null;
  // Не `Boolean`: признак несёт **плотность** (`true` — вещь чертежа, имя —
  // тело модели, таск 189), и свести его к «да» значило бы покрасить тюль
  // прозрачностью шкафа.
  const clear = options.clear || false;
  const channel = options.channel === undefined ? null : options.channel;
  // Может ли тело светиться (таск 09 сценариев) — доезжает до каждой грани.
  const lit = options.lit === true;
  const bulb = Number.isInteger(options.bulb) ? options.bulb : null;
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
        clear,
        channel,
        lit,
        bulb,
      }),
    );
  }
  out.push(
    volumeFace(
      corners.map((point) => volumeAt(point, topMm)),
      rgb,
      { normal: { x: 0, y: 0, z: 1 }, markId, doorId, clear, channel, lit, bulb },
    ),
  );
  // Низ лежащей на полу вещи не нужен никому, а низ висящей — нужен: на
  // потолочный светильник смотрят снизу, и без этой грани он был бы дырой.
  if (bottomMm > 0 || markId || doorId) {
    out.push(
      volumeFace(
        corners.map((point) => volumeAt(point, bottomMm)),
        rgb,
        { normal: { x: 0, y: 0, z: -1 }, markId, doorId, clear, channel, lit, bulb },
      ),
    );
  }
  return out;
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

/** Есть ли в схеме чертёж: без стен и объектов объёму показывать нечего. */
export function volumeDrawn(project, schemeId) {
  if (!project || !schemeId) return false;
  return wallsOnScheme(project, schemeId).length > 0 || schemeObjectsOnScheme(project, schemeId).length > 0;
}

/** Плановые точки, сдвинутые на смещение схемы. Пустой сдвиг отдаёт их же. */
export function volumeShiftPoints(points, shiftMm) {
  if (!shiftMm || (!shiftMm.x && !shiftMm.y)) return points;
  return (points || []).map((point) => ({ ...point, x: point.x + shiftMm.x, y: point.y + shiftMm.y }));
}

// ——— чья стена в полосе двусвета (таск 214, дефект D65) ————————————————
//
// Слова заказчика: «если на двусветном помещении на 2 этаже отрисовать проёмы
// в стенах (проход, дверь, окна), то их перекрывает стена первого этажа и
// становятся глухими».
//
// **Откуда берутся две стены.** Двусвет собирается двумя ручками (таск 209):
// комнате снизу задают высоту в два этажа, у помещения сверху снимают пол.
// Высота комнаты поднимает её стены (`wallHeightOnSide`), и в полосе второго
// этажа оказываются **две стены разом**: высокая нижняя, глухая наверху, и
// своя стена второго этажа — та, в которой человек чертит проёмы. Толщина,
// место и плоскость у них те же, и порядок между совпавшими плоскостями
// решать нечем: чья грань нарисуется последней, ту и видно. На объекте
// заказчика так закрыты **7 проёмов из 17** на втором этаже — шесть окон
// (4000…5400 мм) и проход (3200…5300).
//
// **Главная — стена того этажа, в чьей полосе она стоит.** Это не «спрятать
// лишнее», а прочтение данных: один и тот же кусок дома человек чертит на
// каждом плане своего этажа, и проёмы верхней полосы он рисует на верхнем
// плане. Нижняя стена поднимается выше своего этажа только там, где **у
// верхнего этажа своей стены нет** — тогда уступать некому, и простенок
// двусветной стены честно стоит на всю высоту. Оба случая встречаются в одной
// комнате: на объекте заказчика пять высоких стен накрыты верхними целиком, а
// шестая — на 5 % длины, и остальные её 95 % остаются высокими.
//
// Уступает стена **кусками, а не целиком**: накрытый кусок становится проёмом
// от перекрытия до её верха. Поэтому в сцене не заводится ни одного нового
// вида грани — работают те же откосы, те же куски стены между проёмами и те же
// препятствия, которыми живут настоящие проёмы.

/** Насколько стены считаются «той же самой»: угол между их осями. */
export const VOLUME_WALL_SAME_DEG = 20;

/**
 * ——— этаж стопки переставляется, а не пересобирается (таск 232) ———
 *
 * Долг тасков 202 и 229: открывание двери пересобирало все этажи (26 мс на
 * трёх), приземление после падения и переход по лестнице — тоже (61 мс на
 * объекте заказчика, 80 % из них — дерево порядка). Между двумя сборками при
 * этом менялась мелочь: у одного этажа дверь, у остальных — только та база, от
 * которой считается высота.
 *
 * **Второго источника правды тут нет.** Этаж, однажды собранный, остаётся
 * лежать в самой сцене (`scene.stackParts`) — той единственной, которая и есть
 * ответ на «что показано». Ключ этажа (`volumeFloorKey`) собран из тех же
 * доводов, по которым этаж собирают: объекта, схемы, видимых меток, своих
 * открытых дверей и штор, своих спрятанных вещей, снятой крыши и накрытия
 * сверху. Сошлось — этаж берут как есть; не сошлось — собирают заново. Другого
 * способа устареть у него нет: сцена живёт один кадр, ключ — вывод из данных.
 *
 * Переезд этажа — это **перенос**, и он точен: сдвиг не меняет ни одной
 * взаимной дальности, поэтому дерево порядка переносится вместе с гранями
 * (плоскость узла уезжает на `n·t`), а не строится заново. Правило «дерево
 * строится при сборке сцены, а не покадрово» от этого не трогается: и сборка, и
 * перенос случаются по событию — дверь, лестница, падение, — а не в кадре.
 */

/** Ящик этажа опустел: дерева нет, точки резов и состав пачки брошены. */
export function volumeBoxEmpty(box) {
  if (!box) return;
  box.tree = null;
  box.pack = null;
  if (box.cuts) box.cuts.length = 0;
}

/** Снизу и сверху: насколько грани уходят по вертикали. `null` — граней нет. */
export function volumeFacesSpan(faces) {
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const face of faces || []) {
    for (const point of face.p) {
      if (point.z < minZ) minZ = point.z;
      if (point.z > maxZ) maxZ = point.z;
    }
  }
  return minZ > maxZ ? null : { minZ, maxZ };
}

/**
 * Напуск пола под стеной (дефект D37): на сколько полоса пола выходит за грань
 * стены по обе стороны. Пять сантиметров прячутся под самой стеной и в углах, а
 * больше — и пол полез бы кантом наружу, из-под стены на землю.
 */
export const VOLUME_FLOOR_LAP = 50;

/**
 * **Запасной габарит** спрашивается у общего правила — `markBoxMm`
 * (`markBox.js`, G226), и своего у объёма больше нет.
 *
 * Дыра, с которой запас начинался (G215), была такая: `fillTypeSizes` (G192)
 * подтягивает умолчания по коду и по форме знака, но у типа, заведённого рукой
 * с незнакомой формой, донора нет вовсе — и вещь уходила списком «не
 * размещены». То есть выпадала из объёма не из-за данных, а из-за правила.
 *
 * Запас тогда включался только там, где нет **ни одной** стороны, — а
 * развёртка уже подтягивала стороны **врозь**, и вещь с длиной 600 и пустой
 * шириной выходила 600 × 90 на листе и 600 × 20 здесь. Теперь правило одно и
 * развёрточное: каждая сторона берётся у изображения объекта, а без
 * изображения — у общей рамки. Частный случай «не задано ни одной» никуда не
 * делся, просто перестал быть вторым правилом рядом.
 *
 * **Выступ остаётся за объёмом**: у плоского изображения его взять негде —
 * записи реестра двумерные, — а на листе развёртки его нет вовсе. Рамка
 * отвечает за него теми же 10 мм (`MARK_BOX_FRAME_DEPTH_MM`), и только у вещи,
 * о размерах которой не сказано ничего: записанный ноль — это ноль
 * («встроенный»), а не пустота, и двух миллиметров (`VOLUME_MARK_LIFT_MM`)
 * вещи с запасными размерами под потолком мало — она стала бы плёнкой.
 *
 * **В справочник не пишется ничего** (G68): запас живёт в сцене, на время
 * рисования. Иначе человек увидел бы у своего типа чужие числа и решил, что
 * сам их задал, — а они догадка сборки, и сказать о ней надо словом
 * (`spare` в `volumeMarks`), а не записью в объект.
 */

/** Как вещь поставлена: на стене, в воздухе на своей высоте, под потолком. */
export const VOLUME_MARK_WALL = "wall";

// Прямоугольник в плане вокруг точки: `along` вдоль направления `u`, `across`
// поперёк него. Из него выходит и тело точечной вещи, и звено ленты.
export function volumeBoxCorners(at, u, alongMm, acrossMm) {
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

export function volumeMix(rgb, to, share) {
  return [0, 1, 2].map((index) => Math.round(rgb[index] * (1 - share) + to[index] * share));
}

/** Контур сцены под точкой — без стен: им щупают «что за этой гранью». */
function volumeContourAt(rooms, at) {
  for (const room of rooms || []) {
    if (volumePointInside(at, room.pointsMm)) return room;
  }
  return null;
}

/**
 * В каком помещении стоит человек (или вещь, или метка) — по контурам сцены,
 * а не по `roomAtPoint`: контуры здесь уже переведены в миллиметры, и
 * спрашивается это на каждом шаге. Окно называет комнату вслух — заказчик про
 * обзор сказал «без него не понять, где стоишь», и имя комнаты отвечает на то
 * же самое словом.
 *
 * Толща стены — проём, порог, откос — помещение одной из сторон по общему
 * правилу плана и объёма (`wallPlaceRoom`, правка после сборки сценариев):
 * «Стою в дверном проеме внутри квартиры, а оно считает что я на улице». Стены
 * сцена несёт полосами (`scene.walls`). `where` — сцена или `{rooms, walls}`;
 * голый список контуров — только контуры.
 */
export function volumeRoomAt(where, at) {
  if (!where || !at) return null;
  const rooms = Array.isArray(where) ? where : where.rooms;
  const own = volumeContourAt(rooms, at);
  if (own) return own;
  const walls = Array.isArray(where) ? null : where.walls;
  if (!walls || walls.length === 0) return null;
  return wallPlaceRoom(walls, at, (probe) => volumeContourAt(rooms, probe), (room) => room.hasCeiling !== false);
}

/**
 * **Ключ помещения** для света имитации (таск 09 сценариев): помещение объекта
 * (`roomId` контура), а у контура без помещения — сам контур. Помещение из
 * двух контуров (Г-образная гостиная) — одно: свет в нём светлит оба.
 */
export function volumeRoomKey(room) {
  if (!room) return null;
  return room.roomId || room.outlineId || null;
}

/**
 * Ключ помещения, в котором лежит точка плана, или `null` — улица. `where` —
 * как у `volumeRoomAt`: со стенами это «где стоит», голым списком контуров —
 * щуп за гранью стены.
 */
export function volumeRoomKeyAt(where, at) {
  return volumeRoomKey(volumeRoomAt(where, at));
}

// Насколько отступить от грани внутрь помещения, спрашивая, чьё оно: метка на
// стене и сторона стены лежат ровно на кромке контура, и точка на кромке
// отвечала бы жребием.
export const VOLUME_ROOM_PROBE_MM = 50;

/**
 * Вещь, отбрасывающая тень: `{id, room, corners, bottomMm, topMm, box}` —
 * габарит призмы с её помещением и рамкой в трёх осях.
 */
export function volumeOccluder(id, room, prism) {
  const box = volumeBox3(prism.corners.map((corner) => ({ x: corner.x, y: corner.y, z: prism.bottomMm })));
  box.maxZ = prism.topMm;
  return { id, room, corners: prism.corners, bottomMm: prism.bottomMm, topMm: prism.topMm, box };
}

/** Габарит точек в трёх осях. */
export function volumeBox3(points) {
  const box = { minX: Infinity, minY: Infinity, minZ: Infinity, maxX: -Infinity, maxY: -Infinity, maxZ: -Infinity };
  for (const point of points) {
    box.minX = Math.min(box.minX, point.x);
    box.minY = Math.min(box.minY, point.y);
    box.minZ = Math.min(box.minZ, point.z);
    box.maxX = Math.max(box.maxX, point.x);
    box.maxY = Math.max(box.maxY, point.y);
    box.maxZ = Math.max(box.maxZ, point.z);
  }
  return box;
}
