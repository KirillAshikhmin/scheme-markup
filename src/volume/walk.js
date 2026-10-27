// «Объём»: где встать и как идти — комната под ногами, столкновения, стойка,
// лестница, падение в дыру двусвета.
//
// Часть «Объёма», вынесенная из `src/volume.js` (2026-10-25) переносом без
// переименований: снаружи модуль читают через дверь `volume.js`, а соседи по
// `src/volume/` — напрямую. Зависимости идут только вниз по слоям (порядок —
// в шапке `volume.js`), циклов нет. Решения и доводы — в шапках разделов ниже.
import { SCHEME_STAIR_OBJECT_KEYS, schemeFloorOf, schemeStairArrivalKeys, schemesInOrder } from "../model.js";
import {
  VOLUME_BODY_MM,
  VOLUME_CROUCH_MM,
  VOLUME_CROUCH_MM_S,
  VOLUME_EYE_MM,
  VOLUME_FALL_MM_S2,
  VOLUME_HEAD_MM,
  VOLUME_JUMP_MM_S,
  VOLUME_LAND_RGB,
  VOLUME_LAYER_BODY,
  VOLUME_PUSH_EPS_MM,
  VOLUME_PUSH_PASSES,
  VOLUME_STAIR_REACH_MM,
  VOLUME_STEP_MM,
} from "./measures.js";
import { volumeIsFloor } from "./faces.js";
import { volumeBasis, volumeFocal } from "./camera.js";
import {
  VOLUME_ROOM_PROBE_MM,
  VOLUME_SUN_PROBE_MM,
  volumeDrawn,
  volumePointInside,
  volumeRoomAt,
  volumeRoomKey,
  volumeRoomKeyAt,
} from "./shapes.js";
import { volumeMiddleOf } from "./order.js";
import { volumeArea, volumePolygonGap, volumeRooms, volumeStairs } from "./floors.js";

// ——— куда человек попадает, поднявшись по лестнице (дефект D58) ——————————
//
// Слова заказчика: «почему при переходе между схемами по лестнице я оказываюсь
// в середине объекта, а не возле лестницы? Надо доделать».
//
// **Что было.** Таск 149 ставил человека в **то же место плана**: мол,
// лестничная клетка у этажей одного дома в одном месте, значит те же
// координаты и есть «у лестницы». Довод верен ровно до тех пор, пока у двух
// схем один ноль — а ноль у каждой свой, и берётся он с подложки: планы
// сканируют по отдельности, обрезают по-разному и обводят с разных углов.
// Поэтому «те же координаты» и выносили человека на середину квартиры.
//
// **Что теперь.** Прибытие считается от самой лестницы, а место ухода нужно
// только затем, чтобы выбрать нужную лестничную клетку, когда их несколько:
//
//   1. **Выход с лестницы** (`stairsExit`, вещь таска 204) — если он на этаже
//      нарисован, человек встаёт у него: это и есть то место, где лестница
//      выходит на этаж, и гадать там не о чем;
//   2. **сама лестница** — если выхода нет. Встать **на** неё нельзя: марш
//      занимает место, и человек, поставленный в его середину, смотрел бы в
//      ступени. Поэтому место ищется **рядом с габаритом**: шестнадцать проб
//      вокруг, и берётся та, где человек стоит в помещении и где вокруг него
//      больше всего пусто;
//   3. **ни того, ни другого** — только тогда работает прежнее правило «то же
//      место плана», и окно по-прежнему говорит об этом вслух. Теперь оно
//      честнее: место пересчитано **через привязку** (таск 205), то есть это
//      та же точка дома, а не та же точка чужого чертежа.
//
// **Куда смотреть.** Прочь от лестницы — в ту сторону, в которую с неё сошли.
// Это и есть «лицом в комнату, а не в стену»: место выбрано там, где пусто,
// значит и взгляд в него смотрит в комнату. Своего счёта «где тут стена» для
// взгляда не заводится.

/** Насколько отойти от габарита лестницы: тело плюс запас на ступень. */
export const VOLUME_LANDING_GAP_MM = 250;

/** Сколько проб по кругу: тот же шаг, что у поиска свободного места. */
const VOLUME_LANDING_TRIES = 16;

/** Дальше этого свободное место не ценится: трёх метров хватает любому. */
const VOLUME_LANDING_ROOM_MM = 3000;

/**
 * Куда встать, придя по лестнице на этот этаж (D58). `null` — лестничной
 * клетки на нём не нарисовано, и решает это вызывающий.
 *
 * `atMm` — место ухода, пересчитанное в координаты **этой** схемы: им
 * выбирается лестница, когда их несколько.
 */
export function volumeStairLanding(scene, atMm = null, headMm = VOLUME_HEAD_MM, fromKey = null) {
  const all = (scene && scene.stairs) || [];
  if (all.length === 0) return null;
  // **Приходят в парную вещь** (таск 204): поднялись по маршу — вышли у выхода,
  // спустились от выхода — сошли у марша. Парной нет — годится любая вещь
  // лестничной клетки: другого места, где лестница выходит на этаж, всё равно
  // не нарисовано.
  //
  // Кого считать парой — **одно правило на всю клетку** и лежит оно в модели
  // (`schemeStairArrivalKeys`): маршем ушли — в выход, выходом — в марш,
  // лифтом — в лифт (таск 224). Своей сверки ключей здесь больше нет нарочно:
  // маршей четыре вида, лифт приходит сам в себя, и перечисляй я это на месте,
  // третья порода клетки тихо разъехалась бы с первыми двумя.
  const want = schemeStairArrivalKeys(fromKey);
  const paired = all.filter((place) => want.includes(place.key));
  const places = paired.length > 0 ? paired : all;
  let best = places[0];
  if (places.length > 1 && atMm) {
    let gap = Infinity;
    for (const place of places) {
      const length = Math.hypot(place.atMm.x - atMm.x, place.atMm.y - atMm.y);
      if (length < gap) {
        gap = length;
        best = place;
      }
    }
  }
  const centre = best.atMm;
  let reach = 0;
  for (const polygon of best.polygons || []) {
    for (const point of polygon) reach = Math.max(reach, Math.hypot(point.x - centre.x, point.y - centre.y));
  }
  const step = reach + VOLUME_BODY_MM + VOLUME_LANDING_GAP_MM;
  const solids = scene.solids || [];
  // Просторным считается место, где нет ни стены, ни мебели, — та же мерка, по
  // которой выбирается место старта (`volumeStart`).
  const roomy = [...solids, ...(scene.objectBoxes || [])];
  const rooms = (scene.rooms || []).length > 0;
  let spot = null;
  let score = -Infinity;
  for (let turn = 0; turn < VOLUME_LANDING_TRIES; turn += 1) {
    const angle = (turn * 2 * Math.PI) / VOLUME_LANDING_TRIES;
    const probe = { x: centre.x + Math.cos(angle) * step, y: centre.y + Math.sin(angle) * step };
    const pushed = volumePush(solids, probe, VOLUME_BODY_MM, headMm);
    // Вытолкнуть не удалось — место теснее тела, и это не площадка.
    if (volumeDepthMm(solids, pushed.x, pushed.y, VOLUME_BODY_MM, headMm) > 0) continue;
    const found = volumeRoomAt(scene, pushed);
    // Площадка у лестницы обязана быть **с полом**: сойти с марша в дыру
    // двусветного пространства — не прибытие, а падение (таск 209).
    const inside = !rooms || (found !== null && found.hasFloor !== false);
    const free = Math.min(volumeFreeMm(roomy, pushed.x, pushed.y, headMm), VOLUME_LANDING_ROOM_MM);
    // В помещении — главное, простор — второе. Вне контуров человек стоял бы
    // на улице, а по лестнице выходят в дом.
    const value = (inside ? VOLUME_LANDING_ROOM_MM * 2 : 0) + free;
    if (value > score) {
      score = value;
      spot = pushed;
    }
  }
  // Вокруг лестницы одни стены — встаём там, где свободно хоть где-нибудь.
  if (!spot) spot = volumeFreeSpotNear(solids, centre, headMm) || { x: centre.x, y: centre.y };
  return {
    x: spot.x,
    y: spot.y,
    yaw: Math.atan2(spot.y - centre.y, spot.x - centre.x),
    objectId: best.objectId,
    key: best.key || SCHEME_STAIR_OBJECT_KEYS[0],
    // Встали ли у парной вещи: `false` — её на этаже не нарисовано, и площадка
    // взята у того, что нашлось.
    paired: paired.length > 0,
  };
}

/**
 * Лестница, к которой подошли, или `null`. Ближайшая, если их рядом несколько:
 * спрашивают про ту, у которой стоят.
 *
 * `where` — сцена (её помещения и стены): с ней лестница зовёт только **из
 * своего помещения** (правка 2026-10-27, «проходишь мимо даже через стену, а
 * оно окно показывает»). Помещение лестницы — то, где лежит середина её
 * габарита; лестница вне контуров зовёт отовсюду, как прежде.
 */
export function volumeStairNear(stairs, at, reach = VOLUME_STAIR_REACH_MM, where = null) {
  let near = null;
  let gap = reach;
  const mine = where ? volumeRoomKeyAt(where, at) : null;
  for (const stair of stairs || []) {
    if (where) {
      const own = stair.atMm ? volumeRoomKeyAt(where, stair.atMm) : null;
      if (own && own !== mine) continue;
    }
    let own = Infinity;
    for (const polygon of stair.polygons) own = Math.min(own, volumePolygonGap(at, polygon));
    if (own > gap) continue;
    gap = own;
    near = stair;
  }
  return near ? { stair: near, distanceMm: gap } : null;
}

/**
 * Куда ведёт лестница: `{floor, options}` — этаж этой схемы и этажи, на которые
 * можно перейти.
 *
 * В список идёт не всякая схема, а та, у которой **задан этаж и есть чертёж**.
 * Этаж — потому что схема без номера не этаж, а просто второй план (развёртка,
 * фрагмент, чужая квартира), и предлагать «перейти» на него значило бы гадать.
 * Чертёж — потому что переход на схему, где показывать нечего, это тупик: окно
 * открылось бы пустым полем и человеку пришлось бы возвращаться.
 *
 * Порядок — по номеру этажа, снизу вверх: так его читают на табличке лифта.
 * Два плана с одним номером (бывает: план этажа и его зеркальная копия)
 * остаются оба и различаются именем схемы — выбрасывать чужую работу по
 * догадке нельзя.
 */
export function volumeFloors(project, schemeId) {
  const options = [];
  for (const scheme of schemesInOrder(project)) {
    if (scheme.id === schemeId) continue;
    const floor = schemeFloorOf(project, scheme.id);
    if (floor === null) continue;
    if (!volumeDrawn(project, scheme.id)) continue;
    options.push({
      schemeId: scheme.id,
      name: scheme.name,
      floor,
      stairs: volumeStairs(project, scheme.id).length > 0,
    });
  }
  options.sort((a, b) => a.floor - b.floor);
  return { floor: schemeFloorOf(project, schemeId), options };
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

/**
 * Держит ли препятствие человека, у которого макушка на `headMm` (G234).
 *
 * Правило то же, что у вещи чертежа (`volumePrismBlocks`), только спрашивается
 * оно не при сборке сцены, а на каждом шаге: присев, человек проходит под тем,
 * что выше его макушки, — и это единственный способ сделать так, чтобы
 * «проходить там, где низко» и «сквозь стены нельзя» были одним счётом, а не
 * двумя.
 *
 * Препятствие без высот (такие строит рука в тестах) держит всегда: `topMm`
 * без значения — это «до потолка», и молча пропускать сквозь него нельзя.
 *
 * **Ноги у спрашивающего всегда на полу**, и других тел тут не бывает. Высота
 * ног была доводом в таске 192, пока летал сам человек; с таска 200 (G304)
 * полёт ушёл в обзор, а камера обзора проходит сквозь стены **всегда** и этого
 * счёта не спрашивает вовсе. Поэтому порог отсчитывается от пола, как до 192.
 */
export function volumeSolidBlocks(solid, headMm = VOLUME_HEAD_MM) {
  const bottom = Number(solid.bottomMm) || 0;
  const top = solid.topMm === undefined || solid.topMm === null ? Infinity : Number(solid.topMm);
  return bottom < headMm && top > VOLUME_STEP_MM;
}

/** Сколько свободного места вокруг точки для человека с макушкой на `headMm`. */
export function volumeFreeMm(solids, x, y, headMm = VOLUME_HEAD_MM) {
  let free = Infinity;
  for (const solid of solids) {
    if (!volumeSolidBlocks(solid, headMm)) continue;
    free = Math.min(free, volumeGap(solid, x, y));
  }
  return free;
}

/**
 * Можно ли здесь встать (G234).
 *
 * Заказчик назвал случай прямо: человек отпустил Control под потолком в
 * 1200 мм. Ответ — **он не встаёт и остаётся присевшим**: протолкнуть макушку
 * сквозь низ шкафа значило бы пустить человека сквозь вещь, а вытолкнуть его в
 * сторону — переставить его туда, куда он не шёл. Он встанет сам, как только
 * выйдет из-под низкого места; окно говорит об этом словом.
 *
 * Считается **только по тем препятствиям, которые мешают именно вставанию**:
 * которые держат стоя и не держат сейчас. Стену, которая держит в любой стойке,
 * спрашивать нельзя не ради скорости: прижатый к ней человек стоит ровно в
 * `VOLUME_BODY_MM` от её грани, и сравнение «на волос ближе или на волос
 * дальше» в double запрещало бы ему вставать у стенки через раз.
 *
 * `options.ghost` — отметка «Проходить сквозь стены» (таск 192, G292): встать
 * можно везде. «Встать негде» — это и есть столкновение с тем, что над головой,
 * и снявший столкновения человек не должен застревать в приседе под вещью,
 * сквозь которую он только что прошёл.
 */
export function volumeCanStand(scene, at, headMm = VOLUME_HEAD_MM, options = {}) {
  if (options.ghost) return true;
  for (const solid of (scene && scene.solids) || []) {
    if (volumeSolidBlocks(solid, headMm)) continue;
    if (!volumeSolidBlocks(solid, VOLUME_HEAD_MM)) continue;
    if (volumeGap(solid, at.x, at.y) < VOLUME_BODY_MM) return false;
  }
  return true;
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
  // В помещение без пола не встают (таск 209): это дыра на два этажа, и
  // открывать окно, стоя в воздухе над нижним этажом, незачем.
  const rooms = [...(scene.rooms || [])]
    .filter((room) => room.hasFloor !== false)
    .sort((a, b) => volumeArea(b.pointsMm) - volumeArea(a.pointsMm));
  const solids = scene.solids || [];
  // Место выбирается **и по вещам** (G264): сквозь них теперь проходят, но
  // открывать окно с камерой внутри дивана незачем — просторным считается то,
  // где нет ни стены, ни мебели. Выталкивает же человека по-прежнему только
  // стена: вещь не препятствие, и толкаться ей нечем.
  const roomy = [...solids, ...(scene.objectBoxes || [])];
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
        candidates.push({ point, room, free: volumeFreeMm(roomy, point.x, point.y) });
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
 * Насколько глубоко тело радиуса `radius` сидит в препятствиях: ноль — не сидит
 * вовсе. Мерка та же, по которой выталкивает `volumePush`, и это не удобство, а
 * условие: шаг сверяет «стало ли хуже» ровно с тем, что выталкивание умеет
 * разобрать, — разойдись они, и человек то застревал бы на ровном месте, то
 * проваливался бы в стену.
 */
export function volumeDepthMm(solids, x, y, radius = VOLUME_BODY_MM, headMm = VOLUME_HEAD_MM) {
  let deep = 0;
  for (const solid of solids || []) {
    if (!volumeSolidBlocks(solid, headMm)) continue;
    const dx = x - solid.cx;
    const dy = y - solid.cy;
    const overAlong = solid.half + radius - Math.abs(dx * solid.ux + dy * solid.uy);
    const overAcross = solid.halfT + radius - Math.abs(dx * solid.nx + dy * solid.ny);
    if (overAlong <= 0 || overAcross <= 0) continue;
    deep = Math.max(deep, Math.min(overAlong, overAcross));
  }
  return deep;
}

/**
 * Выталкивание тела из стен. Круг против повёрнутого прямоугольника: из каждого
 * препятствия уходим по той оси, по которой пересечение меньше, — так тело
 * скользит вдоль стены, а не останавливается, уткнувшись.
 *
 * ——— дефект D39: «застревает и начинает прыгать» ——————————————————————————
 *
 * Слова заказчика: «когда ходишь иногда где-то застревает и начинает прыгать,
 * хотя жму движение на клавиатуре». Прыгала не стойка — прыгало **место**.
 *
 * Прежде проходы шли по препятствиям **по очереди**, и каждое двигало тело
 * сразу: последнее слово оставалось за последним в списке. Там, где два
 * препятствия требуют разного, это не сходится никогда, а **чередуется**, и
 * чередуется с частотой кадров. Замер на объекте заказчика (25 стен, 8
 * помещений, сетка проб 50 мм — 32 375 точек):
 *
 *   - **402 точки (1,2 %)**, где четыре прохода не разводят тело **одними
 *     стенами**; с вещами их было 666 (2,1 %) — то есть уборка столкновений у
 *     вещей (G264) убрала треть случаев и не вылечила ни одного;
 *   - разбор одной такой точки: две параллельные стены по 100 мм, оси в 350 мм
 *     друг от друга — просвет между гранями **250 мм** против диаметра тела
 *     **440 мм**. Нижняя стена толкает на +190 мм, верхняя тут же на −190 мм,
 *     и так каждый кадр: человек стоит на месте и дёргается на 190 мм шестьдесят
 *     раз в секунду. Повтори выталкивание хоть двадцать пять раз — остаток тот
 *     же 190: это не «мало проходов», это цикл длиной два;
 *   - второй разбор — стена против габарита вещи: 218 мм, тот же цикл.
 *
 * Чинится это двумя правилами, и оба здесь:
 *
 *   1. **Проход считает все препятствия разом и складывает их требования**
 *      (сумма векторов), а потом двигает тело один раз. Порядок препятствий
 *      перестал решать что-либо: в углу две стены дают диагональ и расходятся
 *      за проход, а в тесном месте их требования гасят друг друга в ноль — и
 *      тело **стоит ровно**, вместо того чтобы прыгать между двумя положениями.
 *   2. **Шаг не принимает положение хуже прежнего** (`volumeStep`): если после
 *      выталкивания тело сидит глубже, чем стояло, шаг не делается вовсе.
 *
 * Угол при этом держится так же, как держался: четыре прохода остались.
 */
export function volumePush(solids, at, radius, headMm = VOLUME_HEAD_MM) {
  let x = at.x;
  let y = at.y;
  for (let pass = 0; pass < VOLUME_PUSH_PASSES; pass += 1) {
    let sx = 0;
    let sy = 0;
    let pressed = false;
    for (const solid of solids) {
      // Присевший проходит под высоким (G234): препятствие, которое кончается
      // ниже его макушки, тела не касается вовсе.
      if (!volumeSolidBlocks(solid, headMm)) continue;
      const dx = x - solid.cx;
      const dy = y - solid.cy;
      const along = dx * solid.ux + dy * solid.uy;
      const across = dx * solid.nx + dy * solid.ny;
      const overAlong = solid.half + radius - Math.abs(along);
      const overAcross = solid.halfT + radius - Math.abs(across);
      if (overAlong <= 0 || overAcross <= 0) continue;
      pressed = true;
      if (overAcross <= overAlong) {
        const sign = across >= 0 ? 1 : -1;
        sx += solid.nx * sign * overAcross;
        sy += solid.ny * sign * overAcross;
      } else {
        const sign = along >= 0 ? 1 : -1;
        sx += solid.ux * sign * overAlong;
        sy += solid.uy * sign * overAlong;
      }
    }
    if (!pressed) break;
    // Требования погасили друг друга: место теснее тела, и уходить отсюда
    // некуда. Стоим — это и есть лекарство от дрожи.
    if (Math.abs(sx) < VOLUME_PUSH_EPS_MM && Math.abs(sy) < VOLUME_PUSH_EPS_MM) break;
    x += sx;
    y += sy;
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
 *
 * ——— отметка «Проходить сквозь стены» (таск 192, G292) ———————————————————
 *
 * `options.ghost` — шаг идёт **ровно туда, куда просили**, без дробления и
 * выталкивания. Это и есть вся отмена столкновений, и живёт она здесь, в
 * единственном месте, которое знает, где человек пройдёт; заведи её в поле — и
 * в сборке стало бы два ответа на «куда шагнул».
 *
 * Высоты ног у шага больше нет (таск 200, G304): летал по этому счёту человек,
 * а полёт уехал в обзор, где стены не спрашивают вовсе.
 */
export function volumeStep(scene, at, dx, dy, headMm = VOLUME_HEAD_MM, options = {}) {
  if (options.ghost) return { x: at.x + dx, y: at.y + dy };
  const solids = scene.solids || [];
  const length = Math.hypot(dx, dy);
  const parts = Math.max(1, Math.ceil(length / VOLUME_BODY_MM));
  let point = { x: at.x, y: at.y };
  // Насколько глубоко человек сидит в препятствиях **сейчас**. Обычно ноль;
  // не ноль бывает после переноса кликом, перехода по этажам и правки чертежа
  // под ногами — и тогда выход из этого места тоже должен быть возможен.
  let depth = volumeDepthMm(solids, point.x, point.y, VOLUME_BODY_MM, headMm);
  for (let index = 0; index < parts; index += 1) {
    const want = volumePush(
      solids,
      { x: point.x + dx / parts, y: point.y + dy / parts },
      VOLUME_BODY_MM,
      headMm,
    );
    const deep = volumeDepthMm(solids, want.x, want.y, VOLUME_BODY_MM, headMm);
    // **Хуже не становится** (D39). Выталкивание разобрало не всё — значит
    // место теснее тела, и шаг туда не делается вовсе: человек остаётся там,
    // где стоял, вместо того чтобы дрожать между двумя положениями.
    if (deep > depth + VOLUME_PUSH_EPS_MM) break;
    // **Стало свободнее — идём не глядя.** Это выход из тесного места, куда
    // человека могло занести переносом или правкой чертежа: единственное
    // правило там — «лишь бы наружу».
    if (deep > depth - VOLUME_PUSH_EPS_MM) {
      // **Назад от нажатой клавиши не пятимся** (D39, второе правило). Клин из
      // двух стен умеет вытолкнуть тело дальше, чем был шаг, — и тогда человек
      // скачет между двумя местами, нажимая «вперёд». Скольжение вдоль стены
      // это правило не трогает: там ход поперёк, а не назад.
      const went = (want.x - point.x) * dx + (want.y - point.y) * dy;
      if (went < -VOLUME_PUSH_EPS_MM * length) break;
    }
    point = want;
    depth = deep;
  }
  return point;
}

// ——— стойка (G234, таск 159) ————————————————————————————————————————————
//
// Присед и прыжок — **чистый счёт**, вынесенный сюда целиком: это одна третья
// координата человека, и в обработчике клавиши её не проверить ничем. Поле
// зовёт отсюда четыре функции и не считает сам ни миллиметра.
//
// Стойка — `{crouchMm, liftMm, speedMm}`: насколько присел, насколько оторвался
// от пола и с какой скоростью идёт вверх. В объект из этого не попадает ничего
// (G68) — она живёт в сеансе поверхности, как открытые двери.
//
// **Полёт отсюда ушёл** (таск 200, G304). Таск 192 клал его в ту же `liftMm`,
// и правильно клал: у человека одна третья координата. Но заказчик увидел, что
// летящий сквозь стены человек — это и есть обзор («вид от первого лица при
// включённом полёте и проходить сквозь стены это по факту обзорный вид»), и
// отметку «Летать» убрал. От первого лица осталось то, что было до 192: пробел
// — прыжок, Control — присед. Высота камеры обзора — **её собственная** `z`
// (`around.eye` в поле): она была у обзора всегда, и второго счёта высоты
// таким переездом не завелось — счётов по-прежнему по одному на каждое тело.

/** Стойка, с которой встают на пол: в полный рост и на земле. */
export function volumeStanceStart() {
  return { crouchMm: 0, liftMm: 0, speedMm: 0 };
}

/** Высота глаз в этой стойке: присед опускает, прыжок поднимает. */
export function volumeStanceEye(stance) {
  return VOLUME_EYE_MM - stance.crouchMm + stance.liftMm;
}

/**
 * Макушка в этой стойке — она и решает, где человек пройдёт.
 *
 * **Прыжок макушку не поднимает**, и это решение, а не недосмотр: стоять на
 * вещах в объёме нельзя (пола над полом в сцене нет), и пусти прыжок сквозь
 * низкое препятствие — человек приземлился бы внутри шкафа. Прыжок поднимает
 * глаза, то есть позволяет заглянуть за перегородку; проходимость он не
 * меняет — «сквозь стены нельзя, прыгнув тоже».
 */
export function volumeStanceHead(stance) {
  return VOLUME_HEAD_MM - stance.crouchMm;
}

/**
 * Пол держит — ниже своего пола не опускается никто (G234, G292, G304).
 *
 * Правило **одно на человека и на камеру обзора**, и названо оно здесь затем,
 * чтобы второго не завелось: там, где под полом ничего не нарисовано — ни
 * комнаты, ни земли, одна изнанка плиты, — провалившийся видел бы серое поле
 * вместо объекта. Прыжок таска 159 приземляется по нему, полёт обзора (таск
 * 200) им же останавливается у земли, падение в дыру двусвета (таск 229) им же
 * кончается на полу нижнего этажа.
 *
 * **«Ниже нуля» стало «ниже своего пола»** ровно затем, чтобы падение не
 * завело второго счёта: ноль — это пол того этажа, на котором человек
 * числится, и шагнувшему в дыру полом становится этаж ниже. Разбор — у
 * `volumeFallTo`.
 */
export function volumeGroundMm(mm, floorMm = 0) {
  // `floorMm` — где лежит пол **сцены**: ноль у одной схемы, низ стопки этажей
  // (таск 202), когда камера обходит дом снаружи, и пол **нижнего этажа** у
  // человека, который шагнул в дыру двусвета (таск 229, G342). Умолчание
  // оставляет прежнее правило до знака.
  return Math.max(Number(floorMm) || 0, Number(mm) || 0);
}

// ——— падение в дыру (таск 229, требование G342) ——————————————————————————
//
// Слово заказчика: «Пусть падаем». До таска человек шёл над снятым полом по
// воздуху, и об этом говорила строка.
//
// **Второго правила пола не завелось.** Пол по-прежнему держит на нуле
// (`volumeGroundMm`) — меняется только то, **где для этого человека ноль**:
// шагнул в дыру, и его полом стал пол этажа ниже, то есть `baseMm` того этажа
// в стопке (величина отрицательная). Дальше всё делает прежняя дуга: стойка
// видит, что человек выше своего пола, и роняет его тем же земным ускорением,
// которым приземляется прыжок (таск 159). Прыгнуть в падении нельзя — тот же
// счёт «в воздухе» запрещает и это.
//
// **Смена этажа — в миг приземления**, посреди шага. Пока человек летит, он
// считается по миллиметрам прежнего этажа: сцена стопки рисует все этажи разом
// (таск 202), и падающий видит нижнюю комнату до того, как в неё попадёт.
// Коснулся её пола — этаж под ним меняется: открывается схема нижнего этажа,
// стойка встаёт на её ноль (`volumeStanceOnFloor`), а глаза при этом не
// дёргаются ни на миллиметр, потому что разница баз и есть та высота, которую
// он пролетел. Столкновения всю дорогу считаются по тому этажу, на котором он
// числится, — второго правила «где можно стоять» не заводится, а на новом
// этаже человека выталкивает из стен то же `volumeMoveTo`, которым он выходит
// с лестницы.
//
// **Падать можно только туда, что нарисовано.** Под дырой нет этажа (двусвет
// на нижнем этаже) или этажи не показаны разом — остаётся прежнее поведение:
// человек идёт над дырой, и окно говорит об этом словом. Довод тот же, которым
// пол держит камеру обзора: под полом не нарисовано ничего, и провалившийся
// туда видел бы серое поле вместо объекта.

/**
 * На какой этаж падает человек из точки `at` — или `null`, если не падает.
 *
 * `plan` — план стопки (`volumeFloorPlan`): в нём у каждого этажа своя база и
 * своё смещение в общем плане дома. Ищется **ближайший этаж снизу, у которого
 * под этой точкой есть пол**: снятый пол дырой считается и здесь, поэтому
 * двусвет на два этажа роняет человека одной дугой, а не двумя.
 *
 * **Нижний этаж держит всегда**: под ним земля — плита чертежа, — и падать
 * сквозь его дыру некуда. Это и есть разбор случая «под дырой нет этажа»:
 * `null`, и всё остаётся как было.
 *
 * Точка переводится в координаты того этажа разницей смещений — тем же швом
 * привязки схем (таск 205), которым стопка совмещает этажи; второго счёта
 * совмещения здесь не заводится.
 */
export function volumeFallTo(project, plan, at) {
  const floors = (plan && plan.floors) || [];
  const mineAt = floors.findIndex((item) => item.current);
  if (mineAt < 1 || !at) return null;
  for (let below = mineAt - 1; below >= 0; below -= 1) {
    const item = floors[below];
    const point = { x: at.x - item.shiftMm.x, y: at.y - item.shiftMm.y };
    const room = volumeRooms(project, item.schemeId).find((found) =>
      volumePointInside(point, found.pointsMm),
    );
    // Пол под точкой есть — падаем на него. Комнаты там не обведено вовсе —
    // летим дальше вниз: пола в сцене там нет ни одной грани.
    if (below === 0 || (room && room.hasFloor !== false)) return item;
  }
  return null;
}

/**
 * В воздухе ли человек: прыжок идёт, пока он не вернулся на пол, — а над дырой
 * двусвета его пол лежит ниже нуля (таск 229, G342), и стоящий над ней в
 * воздухе с первого же тика.
 *
 * Скорость считается **любая, а не только вверх**: падающий из дыры идёт вниз,
 * и «скорость есть — значит в воздухе» — то же самое правило, только без
 * знака.
 */
export function volumeStanceAir(stance, floorMm = 0) {
  return stance.liftMm > (Number(floorMm) || 0) || stance.speedMm !== 0;
}

/** Падает ли человек: он уже ниже пола своего этажа (таск 229, G342). */
export function volumeStanceFalling(stance) {
  return stance.liftMm < 0;
}

/**
 * Кончилось ли падение — человек встал на тот пол, который ему считали
 * (таск 229, G342). Спрашивается у отрицательного пола: на своём этаже это
 * «стоит на полу» и значит оно там то же самое.
 */
export function volumeStanceLanded(stance, floorMm) {
  return stance.liftMm <= (Number(floorMm) || 0) && stance.speedMm === 0;
}

/**
 * Стойка на полу нового этажа (таск 229, G342): ноль переехал вместе с
 * человеком, и высоты у него больше нет — он стоит.
 *
 * Присед не трогается: приседая, падают тоже, и вставать за человека здесь
 * никто не должен.
 */
export function volumeStanceOnFloor(stance) {
  return { ...stance, liftMm: 0, speedMm: 0 };
}

/**
 * Нужен ли стойке ещё один тик. Часы в объёме идут, только пока их держат
 * (клавиша, палец на площадке), и прыжок с приседом — третий повод: иначе
 * прыжок замер бы в воздухе у того, кто прыгнул, не идя.
 *
 * Присед, которому **не дали встать**, поводом не считается: он уже стоит на
 * своих 550 мм, и ждать от него нечего — встанет он на том же тике, которым
 * выйдет из-под низкого места.
 */
export function volumeStanceBusy(stance, crouch, floorMm) {
  // Падение — такой же повод, как прыжок: пол под человеком лежит ниже нуля,
  // и часы обязаны идти, пока он не долетит (таск 229, G342).
  if (volumeStanceAir(stance, floorMm)) return true;
  return stance.crouchMm !== (crouch ? VOLUME_CROUCH_MM : 0);
}

/**
 * Прыжок (G234). Разовый: пока человек в воздухе, второго не бывает.
 *
 * **Присев, не прыгают.** Это не придирка к игровым привычкам: присед —
 * единственный способ оказаться там, где над головой низко, и прыжок оттуда
 * ударил бы макушкой в то, под что человек только что пролез.
 */
export function volumeStanceJump(stance, floorMm) {
  // **В падении не прыгают** — и это тот же счёт «в воздухе», а не новый
  // запрет: над дырой двусвета пол лежит ниже нуля, и человек там в воздухе
  // с первого тика (таск 229, G342).
  if (stance.crouchMm > 0 || volumeStanceAir(stance, floorMm)) return stance;
  return { ...stance, speedMm: VOLUME_JUMP_MM_S };
}


/**
 * Шаг стойки за `seconds` секунд: присед едет к цели, прыжок летит по дуге.
 *
 * `crouch` — держат ли Control (или человек застрял под низким и ещё не
 * встал), `canStand` — есть ли над ним место, чтобы выпрямиться. Отказ в
 * подъёме честный: присед **остаётся**, стойка не меняется ни на миллиметр, и
 * сквозь низ шкафа никто не проходит.
 *
 * Полёта здесь больше нет (таск 200, G304): отметку «Летать» заказчик убрал,
 * и `liftMm` значит одно — **отрыв от пола**: вверх его даёт прыжок, вниз —
 * дыра двусвета, в которую человек падает (таск 229, G342). Дуга у них одна,
 * и число у неё одно — `VOLUME_FALL_MM_S2`. Пол, который `liftMm` держит,
 * назван отдельно (`volumeGroundMm`) и зовётся теперь с трёх сторон: отсюда,
 * из полёта камеры обзора и из падения.
 */
export function volumeStanceStep(stance, seconds, options = {}) {
  const span = Math.max(0, Number(seconds) || 0);
  const crouch = Boolean(options.crouch);
  const canStand = options.canStand !== false;
  // `floorMm` — где для этого человека пол: ноль своего этажа или пол этажа
  // ниже, когда он шагнул в дыру двусвета (таск 229, G342). Своей дуги у
  // падения нет — та же, которой приземляется прыжок.
  const floorMm = Number(options.floorMm) || 0;
  const target = crouch ? VOLUME_CROUCH_MM : 0;
  let crouchMm = stance.crouchMm;
  if (target > crouchMm) crouchMm = Math.min(target, crouchMm + VOLUME_CROUCH_MM_S * span);
  else if (target < crouchMm && canStand) crouchMm = Math.max(target, crouchMm - VOLUME_CROUCH_MM_S * span);
  let liftMm = stance.liftMm;
  let speedMm = stance.speedMm;
  if (volumeStanceAir(stance, floorMm)) {
    speedMm -= VOLUME_FALL_MM_S2 * span;
    liftMm += speedMm * span;
    // Приземлились: ниже пола не бывает (`volumeGroundMm` — то же правило, по
    // которому у земли останавливается камера обзора), и скорость гасится
    // здесь же — иначе следующий тик утащил бы человека под пол.
    const landed = liftMm <= floorMm;
    liftMm = volumeGroundMm(liftMm, floorMm);
    if (landed) speedMm = 0;
  }
  return { crouchMm, liftMm, speedMm };
}

/**
 * Куда показали на полу: луч сквозь точку кадра до плоскости пола (G212,
 * «при клике курсором позволяй перемещать»).
 *
 * `null` — луч идёт вверх или вдоль пола и ни во что не упирается. С таска 195
 * это в обзоре бывает: взгляд там задирается к небу, и
 * щелчок по небу никуда не переносит — отвечать на него выдуманной точкой
 * пола было бы хуже, чем не отвечать вовсе.
 *
 * Считается **плоскостью пола, а не гранями сцены**: указывают на место, а не
 * на поверхность, и нажатый кусок стены должен значить «туда, к этой стене», а
 * не «на её гребень». Куда человек встанет на самом деле, решает `volumeMoveTo`.
 */
export function volumeFloorAt(camera, box, x, y) {
  const basis = volumeBasis(camera);
  const focal = volumeFocal(box);
  const right = (x - box.width / 2) / focal;
  const up = (box.height / 2 - y) / focal;
  const direction = {
    x: basis.fwd.x + basis.right.x * right + basis.up.x * up,
    y: basis.fwd.y + basis.right.y * right + basis.up.y * up,
    z: basis.fwd.z + basis.right.z * right + basis.up.z * up,
  };
  if (!(direction.z < -1e-6) || !(camera.at.z > 0)) return null;
  const away = -camera.at.z / direction.z;
  return { x: camera.at.x + direction.x * away, y: camera.at.y + direction.y * away };
}

/**
 * Куда человек встанет, если показали сюда (G212).
 *
 * Правило одно на оба случая, и оно прямо от заказчика: **вплотную**. Показали
 * в стену — тело выталкивается из неё и встаёт у её грани (`volumePush`, тот же
 * счёт, что у ходьбы, — второго правила «где можно стоять» в сборке нет).
 *
 * Показали за пределы плана — точка сперва зажимается габаритом чертежа, и
 * зажимается **внутрь на радиус тела**. Это не запас на всякий случай: габарит
 * идёт по осевым линиям наружных стен, и зажатая ровно по нему точка попадает в
 * середину стены, где выталкивать её равно выгодно в обе стороны — человек
 * оказывался снаружи дома. Шаг внутрь даёт выталкиванию сторону, и выходит
 * обещанное: человек у внутренней грани наружной стены.
 */
export function volumeMoveTo(scene, at, headMm = VOLUME_HEAD_MM) {
  const bounds = scene && scene.boundsMm;
  const inside = (value, min, max) => {
    const from = min + VOLUME_BODY_MM;
    const to = max - VOLUME_BODY_MM;
    if (!(to > from)) return (min + max) / 2;
    return Math.max(from, Math.min(to, value));
  };
  const point = bounds
    ? { x: inside(at.x, bounds.minX, bounds.maxX), y: inside(at.y, bounds.minY, bounds.maxY) }
    : { x: at.x, y: at.y };
  const solids = (scene && scene.solids) || [];
  const pushed = volumePush(solids, point, VOLUME_BODY_MM, headMm);
  if (volumeDepthMm(solids, pushed.x, pushed.y, VOLUME_BODY_MM, headMm) <= 0) return pushed;
  // **Вытолкнуть некуда — ищем рядом** (D39). Показали в место теснее тела: в
  // щель между стеной и перегородкой, в толщу стены на дальнем конце луча, в
  // угол ниши. Прежде человека там и оставляли — он оказывался зажат и дёргался
  // на каждом нажатии; это и был главный вход в дефект, потому что ходьбой в
  // такие места не попасть (в объекте заказчика все 390 щелей закрыты стенами).
  //
  // Поиск — кольцами по 100 мм до трёх метров, шестнадцать направлений в
  // кольце: берётся первое свободное место, то есть **ближайшее**. Три метра —
  // полкомнаты: дальше перенос перестал бы отвечать на «туда».
  const found = volumeFreeSpotNear(solids, pushed, headMm);
  return found || pushed;
}

/** Ближайшее к `at` место, где тело помещается целиком. `null` — не нашлось. */
export function volumeFreeSpotNear(solids, at, headMm = VOLUME_HEAD_MM, reachMm = 3000, stepMm = 100) {
  for (let radius = stepMm; radius <= reachMm; radius += stepMm) {
    for (let turn = 0; turn < 16; turn += 1) {
      const angle = (turn * Math.PI) / 8;
      const spot = { x: at.x + Math.cos(angle) * radius, y: at.y + Math.sin(angle) * radius };
      const pushed = volumePush(solids, spot, VOLUME_BODY_MM, headMm);
      if (volumeDepthMm(solids, pushed.x, pushed.y, VOLUME_BODY_MM, headMm) <= 0) return pushed;
    }
  }
  return null;
}

/**
 * **Грань в доме** (правка после сборки сценариев, маска осадков): у граней
 * без своего помещения — порогов, торцов стен, кромок перекрытий — середина,
 * сдвинутая по нормали на щуп, лежит в контуре помещения и не выше его
 * потолка. За такой гранью улицы нет, и снег на ней не рисуется
 * (`volumeRainMask`). Наружная сторона стены, земля и крыша остаются улицей.
 */
export function volumeTagIndoor(faces, rooms) {
  if (!rooms || rooms.length === 0) return;
  for (const face of faces) {
    // `indoor` уже стоит — сторону грани назвала сборка (половина откоса или
    // полосы под стеной снаружи): щупы ниже нашли бы ей комнату за стеной.
    if (face.line || face.room || face.sides || face.indoor !== undefined || !face.p || face.p.length < 3) continue;
    // Земля и плита под домом — улица всегда: её видно в окно и в дверь, и
    // снег на ней обязан идти.
    if (face.rgb === VOLUME_LAND_RGB || face.layer !== VOLUME_LAYER_BODY) continue;
    const middle = volumeMiddleOf(face.p);
    const floor = volumeIsFloor(face);
    if (middle.z < 0 && !floor) continue;
    const n = face.n || { x: 0, y: 0, z: 0 };
    const roomAt = (dx, dy) => {
      const probe = { x: middle.x + dx, y: middle.y + dy };
      const found = rooms.find((item) => volumePointInside(probe, item.pointsMm));
      return found && middle.z + n.z * VOLUME_ROOM_PROBE_MM <= (Number(found.heightMm) || 0) + 1 ? found : null;
    };
    // Грань смотрит в комнату — свет комнаты её и светлит (правка «как будто
    // прозрачные»): торец перегородки, кромка, у которых не было помещения,
    // красились улицей и в освещённой комнате читались дырой.
    const ahead = Math.abs(n.z) < 0.9 ? roomAt(n.x * VOLUME_ROOM_PROBE_MM * 2, n.y * VOLUME_ROOM_PROBE_MM * 2) : null;
    if (ahead) {
      face.indoor = true;
      face.room = volumeRoomKey(ahead);
      continue;
    }
    // Впереди проход между контурами (торец перегородки в проёме, порог):
    // грань — одна из смежных комнат — «Торец перегородки не как отдельная
    // комната, а как одна из смежных», — и светлеет по более светлой, как
    // откосы проёма (`sides`). Щупы — в стороны от грани, на полстены и ещё.
    const across = Math.abs(n.z) < 0.9 ? [{ x: -n.y, y: n.x }] : [{ x: 1, y: 0 }, { x: 0, y: 1 }];
    let width = 0;
    for (const point of face.p) width = Math.max(width, Math.hypot(point.x - middle.x, point.y - middle.y));
    const reach = width + VOLUME_SUN_PROBE_MM;
    const found = [];
    for (const dir of across) {
      for (const sign of [1, -1]) {
        const room = roomAt(dir.x * reach * sign, dir.y * reach * sign);
        const key = room ? volumeRoomKey(room) : null;
        if (key && !found.includes(key)) found.push(key);
      }
    }
    if (found.length === 0) {
      // Пол бывает только в доме — даже без соседей это пол, а не улица.
      if (floor) face.indoor = true;
      continue;
    }
    face.indoor = true;
    if (found.length === 1) face.room = found[0];
    else face.sides = { a: found[0], b: found[1], key: found[0] + "|" + found[1], out: false };
  }
}

/**
 * Приписать грани `faces[from…]` помещению, в котором стоит вещь: ключ
 * помещения точки `at` (таск 09 сценариев). Линиям помещение не нужно — у них
 * свой цвет. `where` — контуры и стены сцены: вещь в нише и метка на стене —
 * помещения своей стороны.
 */
export function volumeTagRoom(faces, from, where, at) {
  const key = volumeRoomKeyAt(where, at);
  if (!key) return;
  for (let index = from; index < faces.length; index += 1) {
    if (!faces[index].line) faces[index].room = key;
  }
}

/**
 * Грани `faces[from…]` — вещь: на них ложатся пятна физического света. `id` —
 * вещь чертежа: своей тени на себе она не получает (`volumeLampShade`).
 */
export function volumeTagThing(faces, from, id = null) {
  const thing = id || true;
  for (let index = from; index < faces.length; index += 1) {
    if (!faces[index].line) faces[index].thing = thing;
  }
}
