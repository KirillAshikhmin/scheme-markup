// «Объём»: сцена — `volumeScene` собирает грани, стены, комнаты, призмы теней и
// дерево порядка из объекта; этажи стопкой — `volumeStackScene`.
//
// Часть «Объёма», вынесенная из `src/volume.js` (2026-10-25) переносом без
// переименований: снаружи модуль читают через дверь `volume.js`, а соседи по
// `src/volume/` — напрямую. Зависимости идут только вниз по слоям (порядок —
// в шапке `volume.js`), циклов нет. Решения и доводы — в шапках разделов ниже.
import {
  drawingBoundsMm,
  findScheme,
  openingOpens,
  openingVents,
  openingsInWall,
  outlinesInOrder,
  schemeObjectsOnScheme,
  wallGlassOf,
  wallOwnHeightMm,
  wallPlaceBands,
  wallVectors,
  wallsOnScheme,
} from "../model.js";
import {
  VOLUME_CEILING_RGB,
  VOLUME_FLOOR_RGB,
  VOLUME_LAND_OUT_MM,
  VOLUME_LAND_RGB,
  VOLUME_LAYER_BASE,
  VOLUME_SLAB_RGB,
  VOLUME_WALL_RGB,
} from "./measures.js";
import { volumeAt, volumeClockwise, volumeFace, volumePainted, volumeShadowShift } from "./faces.js";
import {
  VOLUME_FLOOR_LAP,
  VOLUME_SUN_PROBE_MM,
  volumeBoxCorners,
  volumeOccluder,
  volumePointInside,
  volumePrismFaces,
  volumeRoomKey,
  volumeRoomKeyAt,
  volumeShiftPoints,
} from "./shapes.js";
import { volumeMiddleOf, volumeOrderAll, volumeOrderStack, volumeOrderTree } from "./order.js";
import {
  volumeSideParts,
  volumeSideStops,
  volumeWallFaces,
  volumeGlassed,
  volumeWallPaintRgb,
  volumeWallLintels,
  volumeWallMiters,
  volumeWallSolids,
} from "./walls.js";
import { volumeCurtainShare, volumeSheerPlaces, volumeShiftRoomLight, volumeSunOpenings } from "./sun.js";
import { volumeMarkFaces, volumeMarkProbe, volumeMarkViewLines, volumeMarks } from "./marks.js";
import {
  volumeCeilingUnderVoid,
  volumeFloorFaces,
  volumeFloorKey,
  volumeFloorKeySame,
  volumeFloorPlace,
  volumeHeightMm,
  volumeObjectFaces,
  volumeObjectPrisms,
  volumePolysOverlap,
  volumePrismBlocks,
  volumePrismSolid,
  volumeRooms,
  volumeSlabFaces,
  volumeStairs,
  volumeWallCovers,
  volumeWallFree,
  volumeWallHeights,
  volumeWallsTopMm,
} from "./floors.js";
import { volumeTagIndoor, volumeTagRoom, volumeTagThing } from "./walk.js";

/**
 * Сцена из нескольких этажей (таск 202).
 *
 * **Чем она остаётся** — сценой того этажа, на котором стоит человек: все её
 * поля, кроме граней, дерева, тени и пятен, принадлежат открытой схеме. Ходьба,
 * препятствия, метки, выделение, лестница, миникарта и сводка спрашивают её,
 * а соседние этажи добавляют к кадру только то, что видно. Это и есть ответ на
 * «что значит ходьба при всех этажах»: ходим по своему этажу и переходим
 * лестницей, как с таска 149, — ни провалов между этажами, ни второго правила
 * столкновений.
 *
 * `optionsOf(schemeId)` — доводы сборки для каждой схемы (видимые метки,
 * открытые двери, спрятанные вещи): фильтр и отметки обязаны значить на всех
 * этажах одно и то же.
 *
 * `was` — **прошлая сцена стопки** (таск 232). Этажи лежат в ней разобранными
 * (`was.stackParts`), и каждый берётся готовым, если его ключ сошёлся: открытая
 * дверь, снятый пол и смена часа чужих этажей не касаются, а смена этажа
 * прибытия не касается ни одного — она переставляет их, а не пересобирает.
 * Второго ответа о сцене от этого не завелось: `stackParts` — это та же сцена,
 * разобранная на то, из чего она сложена, и живёт она ровно столько, сколько
 * живёт сцена. Не передали `was` — всё собирается заново, как собиралось.
 */
export function volumeStackScene(project, plan, optionsOf, was = null) {
  const floors = (plan && plan.floors) || [];
  const mineAt = floors.findIndex((item) => item.current);
  if (mineAt < 0 || floors.length < 2) return null;
  const take = (schemeId) => (typeof optionsOf === "function" ? optionsOf(schemeId) || {} : {});
  // **У этажа выше нижнего плиты нет вовсе**: земля у дома одна и лежит под
  // нижним этажом, а перекрытие собирается из полов помещений (таск 209).
  // Зелёный прямоугольник с выносом под тень, повторённый на каждом этаже,
  // закрыл бы дом сверху травой, а сплошная плита по габариту — затянула бы
  // дыру двусветного пространства. Правило одно и для той схемы, которая
  // открыта: второй этаж не становится землёй от того, что человек на нём
  // стоит.
  const upperOf = (at) => at > 0;

  /**
   * Чем этаж накрыт сверху (таск 214): потолок его полосы и куски стен, у
   * которых этаж выше поставил свою стену на то же место. Стены соседа
   * переводятся в координаты этого этажа — разницу привязок знает план стопки.
   */
  // Насколько сосед сверху сдвинут в плане и где потолок этой полосы. Обе
  // мерки — **разницы**, то есть от выбранного этажа не зависят, и ровно
  // поэтому они годятся в ключ этажа (`volumeFloorKey`).
  const coverShift = (at) => {
    const above = floors[at + 1];
    if (!above) return { dx: 0, dy: 0, capMm: null };
    return {
      dx: above.shiftMm.x - floors[at].shiftMm.x,
      dy: above.shiftMm.y - floors[at].shiftMm.y,
      capMm: above.baseMm - floors[at].baseMm,
    };
  };
  const coverOf = (at) => {
    const here = floors[at];
    const above = floors[at + 1];
    if (!above) return {};
    const { dx, dy } = coverShift(at);
    // Стена соседа высотой ноль никого не накрывает: её нет.
    const uppers = wallsOnScheme(project, above.schemeId).filter((wall) => wallOwnHeightMm(wall) !== 0).map((wall) => ({
      aMm: { x: Number(wall.aMm.x) + dx, y: Number(wall.aMm.y) + dy },
      bMm: { x: Number(wall.bMm.x) + dx, y: Number(wall.bMm.y) + dy },
      thicknessMm: wall.thicknessMm,
    }));
    const covers = new Map();
    for (const wall of wallsOnScheme(project, here.schemeId)) {
      const spans = volumeWallCovers(wall, uppers);
      if (spans.length > 0) covers.set(wall.id, spans);
    }
    // Дыры двусвета (таск 229, G343): контуры помещений **без пола** этажом
    // выше, переведённые в координаты этого этажа. Перекрытия там нет, и
    // комнате под дырой низ плиты потолком уже не работает — своего потолка она
    // не рисует.
    const voids = volumeRooms(project, above.schemeId)
      .filter((room) => room.hasFloor === false)
      .map((room) => volumeShiftPoints(room.pointsMm, { x: dx, y: dy }));
    // Потолок полосы этажа в его собственных миллиметрах: база соседа минус
    // своя, то есть высота этажа вместе с перекрытием.
    return { capMm: above.baseMm - here.baseMm, covers, voids };
  };
  // Этажи прошлой сцены — по схеме. Ключ сошёлся, значит этаж собран из того же
  // и годится как есть; разошёлся — этот этаж собирается заново, и только он.
  const had = new Map();
  for (const part of (was && was.stackParts) || []) if (!had.has(part.schemeId)) had.set(part.schemeId, part);

  /** Этаж стопки: готовый из прошлой сцены или собранный заново. */
  const floorPart = (at) => {
    const item = floors[at];
    const options = take(item.schemeId);
    const upper = upperOf(at);
    const cover = coverShift(at);
    const place = { baseMm: item.baseMm, shiftMm: item.shiftMm, floor: item.schemeId };
    const ready = had.get(item.schemeId) || null;
    if (ready) {
      const key = volumeFloorKey(project, item.schemeId, options, cover, upper, ready.known);
      if (volumeFloorKeySame(ready.key, key)) {
        ready.key = key;
        return volumeFloorPlace(ready, place);
      }
    }
    const sub = volumeScene(project, item.schemeId, { ...options, ...coverOf(at), order: false, upper });
    if (!sub) return null;
    if (sub.empty) return { schemeId: item.schemeId, sub };
    volumeFloorFaces(sub.faces, place);
    // Своя доля общих множеств: двери, шторы и вещи **этого** этажа. Ими ключ
    // отвечает на «моё ли это открыли» (см. `volumeFloorKey`).
    const known = {
      // Створка окна — тоже «открыли»: этаж с распахнутым окном собирается заново.
      doors: [...(sub.doors || []), ...(sub.windows || [])],
      sheers: sub.sheers || [],
      objects: schemeObjectsOnScheme(project, item.schemeId).map((object) => object.id),
    };
    return {
      schemeId: item.schemeId,
      sub,
      known,
      key: volumeFloorKey(project, item.schemeId, options, cover, upper, known),
      cuts: [],
      tree: null,
      pack: null,
      // Собран заново — значит грани у него новые, и прежнее дерево пачки на
      // них уже не ссылается.
      fresh: true,
      move: { dx: 0, dy: 0, dz: 0 },
      at: {
        baseMm: Number(item.baseMm) || 0,
        dx: Number(item.shiftMm && item.shiftMm.x) || 0,
        dy: Number(item.shiftMm && item.shiftMm.y) || 0,
      },
    };
  };

  // Свой этаж — первым: пустой он значит, что показывать нечего, и соседей ради
  // него собирать незачем (прежнее правило `base`).
  const parts = new Array(floors.length).fill(null);
  parts[mineAt] = floorPart(mineAt);
  const base = parts[mineAt] && parts[mineAt].sub;
  if (!base || base.empty) return base || null;
  for (let at = 0; at < floors.length; at += 1) if (at !== mineAt) parts[at] = floorPart(at);

  const groups = [];
  const boxes = [];
  const faces = [];
  const shadowBoxes = [];
  const sunSpots = [];
  const groundMm = floors[0].baseMm;
  let landMm = null;
  let stackBox = null;
  let bottomMm = 0;
  let topMm = 0;
  for (let at = 0; at < floors.length; at += 1) {
    const item = floors[at];
    const part = parts[at];
    const sub = part && part.sub;
    if (!sub || sub.empty) continue;
    if (at === 0) landMm = sub.landMm;
    groups.push(sub.faces);
    boxes.push(part);
    faces.push(...sub.faces);
    if (sub.boundsMm) {
      const box = {
        minX: sub.boundsMm.minX + item.shiftMm.x,
        minY: sub.boundsMm.minY + item.shiftMm.y,
        maxX: sub.boundsMm.maxX + item.shiftMm.x,
        maxY: sub.boundsMm.maxY + item.shiftMm.y,
      };
      stackBox = stackBox
        ? {
            minX: Math.min(stackBox.minX, box.minX),
            minY: Math.min(stackBox.minY, box.minY),
            maxX: Math.max(stackBox.maxX, box.maxX),
            maxY: Math.max(stackBox.maxY, box.maxY),
          }
        : box;
    }
    // Тень на земле кладут **все этажи разом**: дом отбрасывает одно пятно, а
    // стена второго этажа даёт тень длиннее — она выше над землёй. Поэтому у
    // габарита появляется `baseMm` (где лежит земля) и высота от неё.
    for (const box of sub.shadowBoxes || []) {
      shadowBoxes.push({
        ...box,
        corners: volumeShiftPoints(box.corners, item.shiftMm),
        baseMm: groundMm,
        heightMm: item.baseMm - groundMm + box.heightMm,
      });
    }
    // Солнечное пятно лежит на полу **своего** этажа и в его ярусе: иначе
    // пятно первого этажа легло бы на перекрытие второго.
    for (const spot of sub.sunSpots || []) {
      sunSpots.push({
        ...spot,
        aMm: { x: spot.aMm.x + item.shiftMm.x, y: spot.aMm.y + item.shiftMm.y },
        left: volumeShiftRoomLight(spot.left, item.shiftMm),
        right: volumeShiftRoomLight(spot.right, item.shiftMm),
        baseMm: item.baseMm,
      });
    }
    bottomMm = Math.min(bottomMm, item.baseMm);
    topMm = Math.max(topMm, item.baseMm + item.heightMm);
  }
  // Двусвет — одно помещение для света: и у граней, и у кусков дерева порядка
  // (куски — копии граней, и у этажа, взятого готовым, они прежние).
  const alias = volumeStackRoomAlias(project, floors);
  const under = volumeStackUnder(project, floors);
  volumeStackRoomsJoin(faces, alias, under);
  const order = volumeOrderStack(groups, boxes);
  volumeStackRoomsJoin(volumeOrderAll(order, []), alias, under);
  return {
    ...base,
    faces,
    order,
    // Та же сцена, разобранная на этажи: из них она и сложена, и из них
    // следующая сборка возьмёт всё, что не изменилось (таск 232). Это не второй
    // ответ о сцене — это её же части, и живут они ровно её срок.
    stackParts: boxes,
    // На каком этаже стоит человек. **Единственное**, чем свой этаж отличается
    // от чужого в гранях: хозяева (выделение, прицел, двери, клавиши) достаются
    // граням с этим ярлыком, и решает это кадр. Поднялись по лестнице — поле
    // меняется, грани остаются как есть (таск 232).
    ownFloor: floors[mineAt].schemeId,
    shadowBoxes,
    sunSpots,
    // Земля — у нижнего этажа: у него плита работает землёй, у остальных она
    // стала перекрытием. Нет её и там (помещения не обведены) — нет её и у
    // стопки: это правило сцены, а не стопки.
    landMm,
    // Габарит стопки: по вертикали — от пола нижнего этажа до потолка верхнего,
    // в плане — объединение габаритов этажей (сойтись в плане они могут не
    // точно, когда появится привязка, — шов таска 205). Им «Вся схема» вмещает
    // дом целиком, а обзор держит камеру над его крышей, а не над потолком
    // своего этажа.
    stackMm: {
      bottomMm,
      topMm,
      count: floors.length,
      boundsMm: stackBox
        ? { ...stackBox, widthMm: stackBox.maxX - stackBox.minX, heightMm: stackBox.maxY - stackBox.minY }
        : null,
    },
  };
}

// ——— двусвет — одно помещение для света (правка 2026-10-27) ————————————————
//
// Слова заказчика: «метки освещения правильно расставились, с гостиной
// наверху, но вот освещение работает неверно» и «там, где одна стена не должно
// быть видно стыка этажей… Стена должна быть ровной».
//
// Двусветная гостиная начерчена двумя помещениями: своим на первом этаже и
// помещением **без пола** на втором (дыра, таск 229). Свет же знает помещение
// по ключу грани (`face.room`): лампы гостиной светят её пол и низ стен, а
// верх стен и потолок над дырой числятся за помещением второго этажа, у
// которого ламп нет, — и стена делилась пополам по перекрытию: снизу свет,
// сверху ночь.
//
// Для света это **одно помещение**: дыра этажом выше получает ключ того
// помещения, над которым стоит. Тогда лампы гостиной кладут пятна и на верх
// стен, и на потолок двусвета, а тон ночи у обеих частей один. Какие помещения
// и стены — не трогается: ходят, падают и выделяют по-прежнему по своим.
//
// Связь считается **на каждой сборке стопки**: этажи берутся готовыми из
// прошлой сцены (таск 232), а сосед снизу мог перемениться. Поэтому свой ключ
// грань хранит в `roomOwn`, а `room` — ключ после связи.

/**
 * Связь «дыра → помещение под ней»: `Map<ключ дыры, ключ помещения>`. Дыра —
 * помещение без пола этажом выше; под ней — помещение этажа ниже, в котором
 * лежит середина дыры, или первое, с которым она пересекается. Дыра над дырой
 * (три этажа света) сводится к нижнему помещению.
 */
export function volumeStackRoomAlias(project, floors) {
  const alias = new Map();
  for (let at = 0; at + 1 < (floors || []).length; at += 1) {
    const lower = floors[at];
    const upper = floors[at + 1];
    const dx = upper.shiftMm.x - lower.shiftMm.x;
    const dy = upper.shiftMm.y - lower.shiftMm.y;
    const below = volumeRooms(project, lower.schemeId);
    for (const room of volumeRooms(project, upper.schemeId)) {
      if (room.hasFloor !== false) continue;
      const key = volumeRoomKey(room);
      if (!key) continue;
      const hole = volumeShiftPoints(room.pointsMm, { x: dx, y: dy });
      const middle = volumeMiddleOf(hole.map((point) => ({ x: point.x, y: point.y, z: 0 })));
      const under =
        below.find((item) => volumePointInside(middle, item.pointsMm)) ||
        below.find((item) => volumePolysOverlap(item.pointsMm, hole)) ||
        null;
      const target = under ? volumeRoomKey(under) : null;
      if (target && target !== key) alias.set(key, target);
    }
  }
  // Цепочки — к самому нижнему: дыра третьего этажа над дырой второго.
  for (const [key, target] of alias) {
    let end = target;
    for (let step = 0; step < 16 && alias.has(end); step += 1) end = alias.get(end);
    alias.set(key, end);
  }
  return alias;
}

/**
 * **Низ плиты — потолок комнаты под ней.** У комнаты под дырой двусвета своего
 * потолка нет (`volumeCeilingUnderVoid`), и над её частью у галереи потолком
 * служит низ перекрытия этажа выше. Помещения у него не было — лампы гостиной
 * его не светили, и ночью над головой висела чёрная плита. Теперь низ плиты
 * этажа выше берёт помещение этажа ниже, в котором лежит его середина:
 * `Map<схема этажа выше, помещения этажа ниже в общих миллиметрах стопки>`.
 */
function volumeStackUnder(project, floors) {
  const out = new Map();
  for (let at = 0; at + 1 < (floors || []).length; at += 1) {
    const lower = floors[at];
    const rooms = volumeRooms(project, lower.schemeId)
      .filter((room) => volumeRoomKey(room))
      .map((room) => ({ key: volumeRoomKey(room), pointsMm: volumeShiftPoints(room.pointsMm, lower.shiftMm) }));
    out.set(floors[at + 1].schemeId, rooms);
  }
  return out;
}

/** Ключи помещений граней — после связи (`volumeStackRoomAlias`); свой ключ — в `roomOwn`. */
function volumeStackRoomsJoin(faces, alias, under = null) {
  const join = (key) => (key && alias.has(key) ? alias.get(key) : key);
  for (const face of faces) {
    // Низ плиты этажа выше: помещение — по середине, у этажа ниже (см.
    // `volumeStackUnder`). Считается каждый раз: этаж ниже мог перемениться.
    // Торец перекрытия над двусветом (край галереи) — так же, по месту перед
    // ним: смотрит он в комнату этажа ниже, и светит его её свет.
    const own = face.roomOwn === undefined ? (face.room === undefined ? null : face.room) : face.roomOwn;
    const slab = face.n && ((face.n.z < -0.9 && face.rgb === VOLUME_CEILING_RGB) || (Math.abs(face.n.z) < 0.1 && face.rgb === VOLUME_SLAB_RGB));
    const below = under && face.floor && own === null && slab ? under.get(face.floor) : null;
    if (below) {
      const centre = volumeMiddleOf(face.p);
      const middle = face.n.z < -0.9 ? centre : { x: centre.x + face.n.x * VOLUME_SUN_PROBE_MM, y: centre.y + face.n.y * VOLUME_SUN_PROBE_MM };
      const found = below.find((room) => volumePointInside(middle, room.pointsMm));
      if (face.roomOwn === undefined) face.roomOwn = null;
      if (found) face.room = join(found.key);
      else delete face.room;
      continue;
    }
    if (face.roomOwn === undefined) {
      face.roomOwn = face.room === undefined ? null : face.room;
      face.backRoomOwn = face.backRoom === undefined ? null : face.backRoom;
      face.sidesOwn = face.sides === undefined ? null : face.sides;
    }
    if (face.roomOwn) face.room = join(face.roomOwn);
    if (face.backRoomOwn) face.backRoom = join(face.backRoomOwn);
    const sides = face.sidesOwn;
    if (sides && (alias.has(sides.a) || alias.has(sides.b))) {
      const a = join(sides.a);
      const b = join(sides.b);
      face.sides = { ...sides, a, b, key: (a || "") + "|" + (b || "") };
    } else if (sides) {
      face.sides = sides;
    }
  }
}

// ——— сцена ———————————————————————————————————————————————————————————————

/**
 * Вся сцена схемы: грани, препятствия, помещения, границы, где встать.
 *
 * `empty` — объект без чертежа: окно открывается и говорит, что показывать
 * нечего. `notes` — коды того, о чём окно обязано сказать вслух: нет моста к
 * подложке, помещения не обведены, высота не задана.
 *
 * `options.marks` — какие метки ставить (таск 148). Окно отдаёт сюда видимые на
 * плане: фильтр спрятал метку на плане — она не появляется и в объёме, иначе в
 * двух видах одного объекта пришлось бы держать два ответа на вопрос «что
 * показано». Без него берутся все метки схемы.
 *
 * `options.openDoorIds` — какие двери раскрыты (G207). Без него закрыты все, и
 * это умолчание: состояние двери живёт в сеансе окна и в объект не попадает
 * никогда (G68). Поэтому оно и приходит аргументом сборки, а не полем проёма.
 *
 * `options.hiddenObjectIds` — вещи, спрятанные с экрана (таск 154, G223). Той
 * же природы, что раскрытые двери: выбор глаз, живущий в сеансе и в настройках
 * браузера. Спрятанной вещи в сцене нет **совсем** — ни граней, ни
 * препятствия, ни лестницы: сквозь невидимый шкаф человек идёт, не понимая,
 * обо что споткнулся, а лестница, которой не видно, не должна спрашивать про
 * этаж.
 *
 * `options.markImages` — рисовать ли **поверх модели метки её изображение**
 * контуром цвета категории (таск 14 сценариев, G15). Это та салатовая картинка
 * со скриншота заказчика, а рисует её `volumeMarkViewLines`. Слова заказчика:
 * «сделай опцию вида, отключённую по умолчанию — Подсвечивать метки, которая
 * убирает изображение метки поверх её модели». Опция живёт в сеансе и в
 * настройках браузера (`marksHighlight`), и окно отдаёт её сюда доводом.
 *
 * Без довода контур рисуется, как рисовался до опции: сборка без неё обязана
 * давать прежнюю сцену грань в грань, и выключает его только явное `false`.
 * Метка **без модели** (изображение есть, а тела нет) контур сохраняет и тогда:
 * поверх плашки он — единственное, что говорит, какая это вещь, а убрать
 * заказчик просил картинку поверх модели.
 */
export function volumeScene(project, schemeId, options = {}) {
  const scheme = findScheme(project, schemeId);
  if (!scheme) return null;
  const walls = wallsOnScheme(project, schemeId);
  const hidden =
    options.hiddenObjectIds instanceof Set ? options.hiddenObjectIds : new Set(options.hiddenObjectIds || []);
  const objects = schemeObjectsOnScheme(project, schemeId).filter((object) => !hidden.has(object.id));
  const notes = [];
  if (walls.length === 0 && objects.length === 0) {
    // Без чертежа метку ставить не на что: ни стен, ни пола, ни потолка. Это
    // не потеря — объём и так говорит, что показывать нечего.
    return {
      empty: true,
      notes: [],
      faces: [],
      order: null,
      solids: [],
      shadowBoxes: [],
      sunSpots: [],
      landMm: null,
      objectBoxes: [],
      occluders: [],
      rooms: [],
      walls: [],
      boundsMm: null,
      doors: [],
      windows: [],
      sheers: [],
      stairs: [],
      marks: [],
      unplaced: [],
      spare: [],
    };
  }
  const rooms = volumeRooms(project, schemeId);
  // Стены полосами — для вопроса «где стоит» (`volumeRoomAt`): толща стены
  // принадлежит помещению одной из сторон.
  const wallBands = wallPlaceBands(walls);
  const where = { rooms, walls: wallBands };
  // Краска пола по ключу помещения: её берут и полосы пола под стенами.
  const floorRgbOf = new Map();
  for (const room of rooms) if (room.floorRgb) floorRgbOf.set(volumeRoomKey(room), room.floorRgb);
  // Помещения без пола — дыры двусвета: у стены над ними полоса пола не
  // торчит (см. «пол под стеной» ниже).
  const holeKeys = new Set(rooms.filter((room) => room.hasFloor === false).map(volumeRoomKey).filter(Boolean));
  const schemeHeight = volumeHeightMm(project, schemeId, null);
  if (!schemeHeight.known && !rooms.some((room) => room.heightKnown)) notes.push("noHeight");
  const faces = [];
  const bounds = drawingBoundsMm(project, schemeId);
  // Плита под чертежом — нулевой ярус. Она есть всегда: с обведёнными
  // помещениями закрывает пороги и щели у стен, без них остаётся единственным
  // полом. Потолка в этом случае нет вовсе — накрыть всё одной крышкой значило
  // бы соврать о том, где кончается комната, и отнять обзор со стороны.
  //
  // Цвет у неё зависит от того, **чем она работает** (G237). Помещения обведены
  // — свой пол есть у каждого, и плита остаётся только землёй вокруг дома: тон
  // у неё тот же, что у поля панорамы (`VOLUME_LAND`), и затенение лампой сцены
  // к ней не применяется (`flat`), иначе земля у дома вышла бы вдвое темнее
  // земли за ним. Ровно на этом дом и «летал»: он стоял на тёмно-коричневой
  // доске в габарите чертежа, лежащей посреди зелёного.
  //
  // Помещения не обведены — плита и есть единственный пол, и красится полом:
  // назвать её землёй значило бы сказать, что пола в доме нет.
  //
  // **Плита идёт с выносом** (D43): земля под домом не может кончаться ровно по
  // осям наружных стен — иначе ей не на чем держать тень дома, которая уходит
  // от стены на полторы высоты. Вынос считается от высоты, а не взят на глаз:
  // `VOLUME_LAND_OUT` высот от габарита во все стороны.
  const wallHeights = volumeWallHeights(project, schemeId, schemeHeight.mm);
  const tallest = volumeWallsTopMm(project, schemeId, wallHeights);
  // Прямоугольник плиты, когда она работает землёй (D52): им фон узнаёт, где
  // кончается земля сцены. `null` — плита сама пол, и земли у сцены нет вовсе.
  //
  // `options.upper` — схема показана **этажом стопки, стоящим не на земле**
  // (таск 202). Плиты у такого этажа нет **вовсе** (таск 209, G317): земля у
  // дома одна, под нижним этажом, а перекрытие — это полы его помещений, и
  // второй сплошной плиты по габариту чертежа быть не должно. Именно она
  // раньше затыкала собой дыру двусветного пространства: пол сняли, а плита
  // под ним осталась.
  //
  // Цена названа прямо: где на верхнем этаже помещение **не обведено**, там
  // перекрытия нет и видно насквозь. Это то же правило, что у заказчика в
  // словах — «пол есть во всех замкнутых помещениях», — и другого способа
  // узнать, есть ли там пол, у сборки нет.
  let landMm = null;
  if (bounds && options.upper !== true) {
    const land = rooms.length > 0;
    const shadow = volumeShadowShift(tallest);
    const out = land ? Math.hypot(shadow.x, shadow.y) + VOLUME_LAND_OUT_MM : 0;
    const plate = {
      minX: bounds.minX - out,
      minY: bounds.minY - out,
      maxX: bounds.maxX + out,
      maxY: bounds.maxY + out,
    };
    if (land) landMm = plate;
    faces.push(
      volumeFace(
        volumeClockwise([
          { x: plate.minX, y: plate.minY },
          { x: plate.maxX, y: plate.minY },
          { x: plate.maxX, y: plate.maxY },
          { x: plate.minX, y: plate.maxY },
        ]).map((point) => volumeAt(point, 0)),
        land ? VOLUME_LAND_RGB : VOLUME_FLOOR_RGB,
        { normal: { x: 0, y: 0, z: 1 }, layer: VOLUME_LAYER_BASE, flat: land },
      ),
    );
  }
  // **Тень дома на земле** (дефект D43). Слова заказчика по снимку обзора: «дом
  // всё ещё летает, а не стоит на земле».
  //
  // Разбор числами. Плита и земля сведены в один тон ещё в G237, и сведены
  // верно: замер пикселей живого кадра — `123,160,93` и у самой стены, и в семи
  // метрах от дома, тон в тон. Но ровно поэтому в кадре **не осталось ничего,
  // что говорило бы о поверхности**: плита кончается по осям наружных стен
  // (габарит 9200 × 8700 мм на объекте заказчика), за ней геометрии нет вовсе —
  // поле панорамы рисуется заливкой ниже строки горизонта, а в обзоре (наклон
  // −42°, поле 972 × 778) горизонт стоит на `y = −48` точки, то есть **выше
  // кадра**: вся высота поля залита одним плоским цветом. Ни растяжки, ни
  // затенения (плита `flat`), ни тени — глазу не за что зацепиться, и дом
  // читается наклейкой на зелёном листе.
  //
  // Поэтому в сцену добавлена **тень**: единственная примета касания, которой
  // не было. Кладёт её солнце с неба (`volumeShadowShift`): при его высоте 14°
  // стена 2800 мм даёт тень 11 230 мм, и ложится она ровно прочь от солнца.
  //
  // Тень — это силуэт: выпуклая оболочка габарита стены и того же габарита,
  // сдвинутого на вынос. Рисуется **сплошным** тоном без затенения, поэтому
  // наложение теней соседних стен не темнеет вдвое и дом отбрасывает одно пятно.
  //
  // Кладётся она только на землю — то есть когда помещения обведены и плита
  // работает землёй. Нет обводки — плита сама пол, и тень легла бы внутри дома.
  // Внутри дома её не видно **ярусом** (`VOLUME_LAYER_SHADOW`): полы лежат выше
  // неё по правилу, а не по дальности. На дальность это и было переложено, и
  // отозвалось дефектом D49 — зеленью вместо пола в части комнат.
  //
  // **В сцене лежат габариты, а не грани** (таск 181). Солнце ходит по небу, и
  // тень ходит за ним; пересобирать ради этого весь дом — восемь миллисекунд на
  // объекте заказчика, то есть провал кадра каждую секунду у идущего человека.
  // Поэтому сцена держит то, что от часа не зависит (габарит стены и её
  // высоту), а грани тени собирает `volumeShadowFaces` — вместе со снимком
  // часа, не чаще раза в секунду, и уходят они в кадр теми же `extra`, которыми
  // идут рамка выделения и кружок «вы здесь».
  const shadowBoxes = [];
  if (rooms.length > 0) {
    for (const wall of walls) {
      // Стеклянная стена тени дома не бросает (правка 2026-10-27).
      if (wallGlassOf(wall)) continue;
      const vectors = wallVectors(wall);
      if (!vectors) continue;
      const height = wallHeights.get(wall.id) || 0;
      if (!(height > 0)) continue;
      shadowBoxes.push({
        corners: volumeBoxCorners(
          {
            x: Number(wall.aMm.x) + vectors.u.x * (vectors.len / 2),
            y: Number(wall.aMm.y) + vectors.u.y * (vectors.len / 2),
          },
          vectors.u,
          vectors.len,
          Number(wall.thicknessMm),
        ),
        heightMm: height,
      });
    }
  }
  for (const room of rooms) {
    // **Пол помещения — он же перекрытие** (таск 209, G317): одно правило, а не
    // два похожих. Есть пол — есть плита с кромкой, на которой стоит этаж выше;
    // снят — там дыра на два этажа, и край её держат соседние плиты.
    if (room.hasFloor) {
      faces.push(
        // Ярус у пола **телесный** (таск 211): порядок ему считает дерево.
        volumePainted(
          volumeFace(room.pointsMm.map((point) => volumeAt(point, 0)), VOLUME_FLOOR_RGB, {
            normal: { x: 0, y: 0, z: 1 },
            room: volumeRoomKey(room),
          }),
          room.floorRgb,
          "floor",
        ),
      );
      volumeSlabFaces(room.pointsMm, 0, faces);
    }
    // **Потолок под дырой двусвета не рисуется** (таск 229, G343): помещение
    // этажом выше без пола — значит перекрытия над этой комнатой нет, и низу
    // плиты, которым её потолок и был, стоять негде. Мерку считает одно место
    // (`volumeCeilingUnderVoid`), доводы ей даёт стопка — как и накрытиям стен.
    if (volumeCeilingUnderVoid(room, options.voids, options.capMm)) continue;
    // **Потолка нет у помещения, открытого небу** (правка после сборки
    // сценариев): балкон, у которого стены к улице ниже этажа, или помещение,
    // которому потолок сняли рукой. Пол при этом остаётся — «только пол».
    if (room.hasCeiling === false) continue;
    // **Потолок двусторонний** (таск 211, дефект D62): снизу это потолок
    // комнаты, сверху — крыша. До таска у него была одна сторона, нормалью
    // вниз, и сверху он отбрасывался отбором — поэтому в кадре сверху потолок
    // занимал **ноль процентов**, а человек смотрел прямо в комнату.
    //
    // Почему двусторонняя грань, а не плита с телом, как у пола: плита над
    // каждым помещением встала бы ровно туда, где у этажа выше лежит его
    // собственный пол, — две одинаковые плиты друг в друге, и этажи перестали
    // бы делиться плоскостью (их дерево порядка сшивается по ней, таск 202).
    // Двусторонний потолок не добавляет в сцену **ни одной грани** и держит
    // этажи раздельными: низ перекрытия — это и есть потолок нижнего этажа, а
    // толщину ему даёт плита пола верхнего.
    faces.push(
      volumePainted(
        volumeFace(
          [...room.pointsMm].reverse().map((point) => volumeAt(point, room.heightMm)),
          VOLUME_CEILING_RGB,
          // **«Снять крышу»** (таск 212, требование G319) — это ровно вторая
          // сторона потолка, и ничего больше. Отметка снята (умолчание) —
          // потолок двусторонний, дом сверху глухой, как с таска 211. Отметка
          // стоит — у потолка остаётся одна сторона, нижняя: изнутри он тот же
          // до грани, а сверху отбор по нормали его не рисует вовсе, и видно
          // планировку. Ни одной грани при этом не прибавляется и не убавляется.
          { normal: { x: 0, y: 0, z: -1 }, both: options.roofOff !== true, room: volumeRoomKey(room) },
        ),
        room.ceilingRgb,
        "ceiling",
      ),
    );
  }
  if (rooms.length === 0) {
    notes.push(outlinesInOrder(project, schemeId).length > 0 ? "noBridge" : "noRooms");
  }
  const solids = [];
  // Все двери схемы: по этому списку хоткей «все двери» (G210) знает, что
  // открывать, не спрашивая объект второй раз.
  const doors = [];
  // Окна со створкой (правка без автопилота, 2026-10-25): их открывают по
  // одному — E и касанием; «все двери» их не трогает.
  const windows = [];
  // Высоты посчитаны выше, до плиты: по ним идёт вынос земли и тень дома (D43),
  // по ним же сводятся углы (G265) — ус ставится только между стенами одной
  // высоты.
  const miters = volumeWallMiters(walls, (wall) => wallHeights.get(wall.id) || 0);
  for (const wall of walls) {
    // **Накрытые куски стены** (таск 214, дефект D65): там, где у этажа выше
    // стоит его собственная стена, эта уступает ей — накрытый кусок выше
    // перекрытия становится проходом. Считает накрытия стопка (`options.covers`
    // и `options.capMm`): одна схема про соседние этажи не знает ничего, и
    // без стопки этого словаря нет вовсе — тогда всё как было.
    const covers = options.covers instanceof Map ? options.covers.get(wall.id) : null;
    const openings = openingsInWall(project, wall.id);
    for (const opening of openings) {
      // Стеклянная дверь — дверь и здесь (таск 180): её открывают `E`, щелчком
      // и касанием, и `R` открывает её вместе со всеми.
      // Открывается всё, у чего есть полотно (таск 219, G328): распашное,
      // едущее и поднимающееся. До таска список спрашивал «есть ли сторона», и
      // роллетные с секционными в него не попадали — `R` их не трогал, а
      // счётчик «открыто N из M» их не считал.
      if (openingOpens(opening.kind) && opening.id) doors.push(opening.id);
      else if (openingVents(opening.kind) && opening.id) windows.push(opening.id);
    }
    const own = wallHeights.get(wall.id);
    // **Стена уступает полосе этажа выше** (таск 214, дефект D65). Накрыта
    // верхней стеной — своя строится до потолка своей полосы (`capMm`), а
    // выше стоит стена соседа, в которой и прорезаны его проёмы. Не накрыта —
    // высота своя, как была: простенок двусветной стены честно идёт на всю
    // высоту, и это тот самый случай, который видно на рендерах заказчика.
    const cap = covers && covers.length > 0 ? Math.min(own, Number(options.capMm) || own) : own;
    const height = cap;
    // Стена высотой ноль (правка после сборки сценариев) — стены нет: ни
    // граней, ни препятствия. Остаётся пол под ней — полоса ниже, — и по нему
    // выходят на балкон.
    if (height > 0) {
      volumeWallFaces(wall, openings, height, faces, options.openDoorIds || null, miters.get(wall.id) || null, rooms);
    }
    const vectors = wallVectors(wall);
    if (!vectors) continue;
    // Куски, которые верхняя стена не накрыла, продолжаются вверх своим телом:
    // проёмов выше перекрытия у них не бывает — чертят их на том плане, где
    // этот кусок стоит.
    if (cap < own) {
      for (const span of volumeWallFree(vectors.len, covers)) {
        const middleMm = (span.fromMm + span.toMm) / 2;
        const from = faces.length;
        volumePrismFaces(
          volumeBoxCorners(
            {
              x: Number(wall.aMm.x) + vectors.u.x * middleMm,
              y: Number(wall.aMm.y) + vectors.u.y * middleMm,
            },
            vectors.u,
            span.toMm - span.fromMm,
            Number(wall.thicknessMm),
          ),
          cap,
          own,
          VOLUME_WALL_RGB,
          faces,
        );
        // Бока куска — стороны той же стены и той же краски (покраска).
        for (let index = from; index < faces.length; index += 1) {
          const face = faces[index];
          const across = face.n.x * vectors.n.x + face.n.y * vectors.n.y;
          if (Math.abs(across) > 0.9) volumePainted(face, volumeWallPaintRgb(wall, Math.sign(across)), "wall");
        }
        volumeGlassed(wall, faces, from);
      }
    }
    // **Пол под стеной** (дефект D37). Слова заказчика: «под дверными проёмами
    // нет пола».
    //
    // Пол лежит по контурам помещений, то есть кончается у внутренней грани
    // стены. Под самой стеной пола нет никогда, а **проём — это дыра в стене на
    // всю её толщину**, и порога в нём не было тоже. Раньше дыры затыкала плита
    // чертежа, крашенная полом; с тех пор как плита стала землёй (G237), каждая
    // щель читается травой в доме.
    //
    // Поэтому пол кладётся полосой **под всю стену: во всю длину и во всю
    // толщину, поверх проёмов**. Это и есть ответ на порог: он получается сам,
    // одной гранью на стену, и не требует ни разбора проёмов, ни объединения
    // контуров. Снаружи полоса не видна — её ровно накрывает сама стена.
    //
    // `VOLUME_FLOOR_LAP` — напуск по обе стороны: контур помещения обводят по
    // подложке рукой, и промахнуться на сантиметр-другой мимо грани стены
    // обычное дело. Напуск маленький нарочно: пять сантиметров прячутся под
    // стеной и в углах, а сделай его больше — пол полез бы кантом наружу.
    //
    // Нужна полоса только там, где плита стала землёй: без обведённых помещений
    // плита сама пол, и подкладывать под стену нечего.
    //
    // Полоса — **две половины по сторонам стены** (правка после сборки
    // сценариев: «В проёмах и у стены какая странная тень»). Цельной гранью она
    // была одного помещения на обе стороны: напуск в пять сантиметров ложился
    // в соседнюю комнату чужим светом — тёмной каймой у стены освещённой
    // гостиной и светлой в тёмном коридоре, а порог светлел как попало.
    // Половина берёт помещение своей стороны тем же щупом и с теми же резами,
    // что сторона стены (`volumeSideStops`); половина на улицу — улица.
    if (rooms.length > 0) {
      const middleMm = vectors.len / 2;
      const strip = volumeBoxCorners(
        {
          x: Number(wall.aMm.x) + vectors.u.x * middleMm,
          y: Number(wall.aMm.y) + vectors.u.y * middleMm,
        },
        vectors.u,
        vectors.len + VOLUME_FLOOR_LAP * 2,
        Number(wall.thicknessMm) + VOLUME_FLOOR_LAP * 2,
      );
      const halfT = Number(wall.thicknessMm) / 2;
      const spot = (along, across) => ({
        x: Number(wall.aMm.x) + vectors.u.x * along + vectors.n.x * across,
        y: Number(wall.aMm.y) + vectors.u.y * along + vectors.n.y * across,
      });
      // **Сторона дыры двусвета** (правка 2026-10-27): «там, где одна стена не
      // должно быть видно стыка этажей в виде части пола в стене. Стена должна
      // быть ровной». В помещении без пола напуск полосы торчал из стены
      // торцом перекрытия — тёмным поясом во всю стену на высоте этажа. Там
      // полосы нет вовсе, а тело перекрытия кончается заподлицо со стеной, и
      // торца у него с этой стороны нет: там продолжается сама стена.
      const sideParts = new Map();
      let holes = false;
      for (const side of [1, -1]) {
        const roomAt = (along) => volumeRoomKeyAt(rooms, spot(along, (halfT + VOLUME_SUN_PROBE_MM) * side));
        const list = volumeSideParts(-VOLUME_FLOOR_LAP, vectors.len + VOLUME_FLOOR_LAP, volumeSideStops(wall, side, rooms), roomAt).map(
          (part) => ({ ...part, hole: Boolean(part.room && holeKeys.has(part.room)) }),
        );
        if (list.some((part) => part.hole)) holes = true;
        sideParts.set(side, list);
      }
      for (const side of [1, -1]) {
        const outer = (halfT + VOLUME_FLOOR_LAP) * side;
        for (const part of sideParts.get(side)) {
          if (part.hole) continue;
          const piece = volumeFace(
            volumeClockwise([spot(part.fromMm, 0), spot(part.toMm, 0), spot(part.toMm, outer), spot(part.fromMm, outer)]).map((point) =>
              volumeAt(point, 0),
            ),
            VOLUME_FLOOR_RGB,
            { normal: { x: 0, y: 0, z: 1 }, room: part.room },
          );
          // Пол в проёме — пол своего помещения (покраска, правка без
          // автопилота: «пол… один цвет на помещение, включая их проёмы»):
          // порог крашен наполовину одной комнатой, наполовину другой.
          if (part.room) volumePainted(piece, floorRgbOf.get(part.room), "floor");
          // Половина на улицу — пол дома (снег на нём не идёт, «пол бывает
          // только в доме»), но без комнаты: светит её улица. Щупы
          // `volumeTagIndoor` её не трогают — нашли бы ей комнату за стеной.
          if (!part.room) piece.indoor = true;
          faces.push(piece);
        }
      }
      // Тело у полосы — такое же, как у пола комнаты (таск 209): иначе
      // перекрытие кончалось бы у контура помещения, а под стеной верхнего
      // этажа на фасаде оставалась бы щель ровно в толщину плиты.
      if (!holes) volumeSlabFaces(strip, 0, faces);
      else {
        // У стены над дырой — по половинам, как и пол: у дыры половина
        // кончается гранью стены.
        for (const side of [1, -1]) {
          for (const part of sideParts.get(side)) {
            const reach = (part.hole ? halfT : halfT + VOLUME_FLOOR_LAP) * side;
            const from = faces.length;
            volumeSlabFaces(volumeClockwise([spot(part.fromMm, 0), spot(part.toMm, 0), spot(part.toMm, reach), spot(part.fromMm, reach)]), 0, faces);
            if (!part.hole) continue;
            // Торец в плоскости стены не рисуется: там стоит сама стена этажа
            // ниже, и вторая грань в той же плоскости давала шов в точку по
            // всей стене. Низ плиты остаётся — им снизу закрыта стена этажа
            // выше, если своей стены под ней нет.
            for (let index = faces.length - 1; index >= from; index -= 1) {
              const face = faces[index];
              const facing = face.n.x * vectors.n.x * side + face.n.y * vectors.n.y * side;
              if (facing >= 0.99) faces.splice(index, 1);
            }
          }
        }
      }
    }
    // Сплошные участки стены — во всю её высоту; низкая перемычка над проёмом
    // (G234) — своим куском от верха проёма до верха стены. У препятствия
    // появились высоты: по ним присевший проходит там, где стоящий не проходит.
    const spans = !(height > 0)
      ? []
      : [
          ...volumeWallSolids(wall, openings).map((span) => ({ ...span, bottomMm: 0, topMm: height })),
          ...volumeWallLintels(openings, height),
        ];
    for (const span of spans) {
      const middle = (span.fromMm + span.toMm) / 2;
      solids.push({
        cx: Number(wall.aMm.x) + vectors.u.x * middle,
        cy: Number(wall.aMm.y) + vectors.u.y * middle,
        ux: vectors.u.x,
        uy: vectors.u.y,
        nx: vectors.n.x,
        ny: vectors.n.y,
        half: (span.toMm - span.fromMm) / 2,
        halfT: Number(wall.thicknessMm) / 2,
        bottomMm: span.bottomMm,
        topMm: span.topMm,
      });
    }
  }
  // Габариты вещей: **не препятствия** (G264), а места, которые заняты.
  // Разница — в следующем абзаце.
  const objectBoxes = [];
  // Что отбрасывает тень от ламп (`volumeLampShades`): габариты вещей чертежа
  // с их помещением.
  const occluders = [];
  for (const object of objects) {
    // Рисуется модель или габарит — решает одно место (`volumeObjectFaces`).
    //
    // **Сквозь вещи проходят** (G264, таск 178). Слова заказчика: «Сделай что
    // бы объекты можно было проходить на сквозь, убери коллизию». Было
    // наоборот: габарит вещи держал человека, и это было задумано — «пройти
    // между ножек стола так же неверно, как пройти сквозь шкаф».
    //
    // Отменено это не капризом, а тем, ради чего объём и открывают: в нём
    // смотрят метки. Метка за диваном, розетка в тумбе, щит, к которому не
    // подойти вплотную, — каждая вещь отнимала у человека подход к своим же
    // точкам, а обойти её в квартире часто негде. С таска 169 вещи ещё и
    // просвечивают: смотреть сквозь шкаф можно, а подойти нельзя — это разные
    // правила об одном и том же, и заказчик свёл их в одно.
    //
    // **Стены остались**: сквозь них нельзя, это правило таска 146 и его никто
    // не отменял. Вещь — мебель, её двигают; стена — дом.
    //
    // **Лестница и колонна проходятся тоже.** Они вещи каталога и исключением
    // не стали: список исключений завёл бы второго хозяина правила (тот же
    // довод, что у прозрачности в таске 169), а «конструкция» — это не признак
    // данных, а догадка о замысле. Цена названа прямо: сквозь колонну и короб
    // проходят насквозь, а в лестницу входят внутрь марша. Переход по этажам от
    // этого не пострадал — он спрашивается по расстоянию до габарита
    // (`volumeStairNear`), а не по упору в него, и теперь срабатывает ещё
    // вернее: встать можно прямо на лестницу.
    const objectFrom = faces.length;
    volumeObjectFaces(project, schemeId, object, schemeHeight.mm, faces, options.objectsClear !== false);
    // Вещь в комнате — её (таск 09 сценариев): включённый свет светлит и диван.
    if (rooms.length > 0 && faces.length > objectFrom) volumeTagRoom(faces, objectFrom, where, volumeMiddleOf(faces[objectFrom].p));
    volumeTagThing(faces, objectFrom, object.id);
    const room = faces.length > objectFrom ? faces[objectFrom].room : null;
    for (const prism of volumeObjectPrisms(project, schemeId, object, schemeHeight.mm)) {
      // Тень от ламп — по габариту вещи (правка после сборки сценариев:
      // «Мебель должна отбрасывать тень от ламп»): у стола тенью ложится
      // столешница, у шкафа — короб, и ножки отдельными тенями кадру не нужны.
      if (room && prism.topMm > prism.bottomMm) occluders.push(volumeOccluder(object.id, room, prism));
      if (!volumePrismBlocks(prism)) continue;
      const solid = volumePrismSolid(prism);
      // Габарит остаётся в сцене, но не в `solids`: по нему выбирается место,
      // с которого начинают ходить (`volumeStart`) — вставать внутрь дивана
      // незачем и без столкновений.
      if (solid) objectBoxes.push(solid);
    }
  }
  // Метки — последними: их тела и контуры ложатся в тот же поток граней, что
  // стены и вещи чертежа, и спорят с ними порядком, а не ярусом. Вещь на стене
  // стоит перед стеной — это и значит «перед»; препятствием она при этом не
  // становится (сквозь розетку ходят).
  const marks = volumeMarks(project, schemeId, { marks: options.marks, rooms, walls: wallBands });
  const markImages = options.markImages !== false;
  for (const place of marks.placed) {
    const markFrom = faces.length;
    // Позиция шторы (таск 09 сценариев) — только когда её дали: без имитации
    // доводов позиции нет, и штора та же, что до таска.
    volumeMarkFaces(place, faces, options.curtainShares ? volumeCurtainShare(options.curtainShares, place.markId) : 0);
    // Метка в комнате — её (таск 09 сценариев). Щуп — от лица вещи внутрь: у
    // метки на стене лицо лежит на кромке контура.
    if (rooms.length > 0) volumeTagRoom(faces, markFrom, where, volumeMarkProbe(place));
    volumeTagThing(faces, markFrom);
    if (markImages || !place.model) volumeMarkViewLines(place, faces);
  }
  volumeTagIndoor(faces, rooms);
  // Помещение без потолка — под открытым небом (правка после сборки
  // сценариев): его грани светит небо, как улицу, и снег на них идёт.
  const openKeys = new Set(rooms.filter((room) => room.hasCeiling === false).map(volumeRoomKey).filter(Boolean));
  if (openKeys.size > 0) {
    for (const face of faces) if (face.room && openKeys.has(face.room)) face.open = true;
  }
  // `wallCount` — настоящее число стен чертежа, а не длина `solids`: препятствий
  // больше, потому что проём режет стену на куски, а вещи на полу тоже держат.
  // Окно говорит о чертеже, и путать эти два числа нельзя.
  return {
    empty: false,
    notes,
    faces,
    // Прозрачны ли вещи чертежа (отметка «Прозрачные объекты»): поле сверяет
    // по нему, пора ли пересобрать сцену.
    objectsClear: options.objectsClear !== false,
    // Дерево порядка строится здесь, один раз на сцену: кадру остаётся обход.
    //
    // `options.order === false` — сцену собирают **этажом стопки** (таск 202):
    // грани ещё поднимут на базу этажа, и дерево, построенное до подъёма, стало
    // бы врать. Стопка строит его сама, после подъёма, и сшивает этажи
    // плоскостью (`volumeOrderStack`). Полусобранная сцена без дерева годится
    // только ей: кадру её отдавать нельзя.
    order: options.order === false ? null : volumeOrderTree(faces),
    solids,
    // Габариты стен для тени дома (таск 181): час кладёт её сам, см. выше.
    shadowBoxes,
    // Проёмы, через которые солнце кладёт пятно на пол (таск 196). В сцене
    // лежит то, что от часа не зависит — геометрия проёма, комнаты по обе его
    // стороны и штора перед ним; грани кладёт час (`volumeSunSpotFaces`), тем
    // же порядком, что тень дома.
    sunSpots: volumeSunOpenings(project, schemeId, rooms, marks.placed, (wall) => wallHeights.get(wall.id) || 0, {
      openCurtainIds: options.openCurtainIds || null,
      openDoorIds: options.openDoorIds || null,
    }),
    // Шторы схемы (G332): по этому списку окно знает, что можно открыть, и
    // считает «открыто N из M». Тот же отбор, которым свет берёт ткань перед
    // проёмом, — `volumeSheerPlaces`, второго в сборке нет.
    sheers: volumeSheerPlaces(marks.placed).map((place) => place.markId),
    // Земляная плита: её прямоугольник в миллиметрах чертежа — `null`, когда
    // плита работает полом, а не землёй. По нему фон знает, где кончается земля
    // сцены (D52, `volumeGroundLimitDeg`), и второй мерки для этого нет.
    landMm,
    // Занятые места: габариты вещей, которые человека **не держат** (G264), но
    // по которым видно, где в комнате пусто. Ими пользуется только выбор места
    // старта; ходьба, перенос и «тесно» спрашивают `solids`.
    objectBoxes,
    // Габариты вещей для теней от ламп (`volumeLampShades`).
    occluders,
    rooms,
    // Стены полосами: толща стены — помещение одной из сторон (`volumeRoomAt`).
    walls: wallBands,
    boundsMm: bounds,
    // На сколько нарисованное выходит за габарит чертежа: стена стоит на всю
    // толщину от своей оси, а пол под ней — ещё и с напуском (D37). Обзор
    // «вся схема» вмещает то, что **рисуется**, и без этого числа он резал бы
    // угол у толстых стен — впритык он стоял и до напуска.
    outsetMm: walls.reduce(
      (most, wall) => Math.max(most, Number(wall.thicknessMm) / 2 + (rooms.length > 0 ? VOLUME_FLOOR_LAP : 0)),
      0,
    ),
    heightMm: schemeHeight.mm,
    wallCount: walls.length,
    openingCount: walls.reduce((sum, wall) => sum + openingsInWall(project, wall.id).length, 0),
    doors,
    windows,
    // Лестницы схемы (таск 149): по ним окно спрашивает про этаж. Лежат в
    // сцене, а не ищутся на каждом шаге, — спрашивается это на каждом шаге, а
    // меняется только вместе с чертежом, то есть вместе со всей сценой.
    stairs: volumeStairs(project, schemeId).filter((stair) => !hidden.has(stair.objectId)),
    marks: marks.placed,
    unplaced: marks.unplaced,
    // Нарисованные запасным габаритом (G215): вещь в сцене есть, а размер её
    // сборка выдумала — окно называет такие вещи вслух.
    spare: marks.spare,
  };
}

/** Где в объёме стоит метка — по её месту в сцене. `null` — не размещена. */
export function volumeMarkAnchor(scene, markId) {
  for (const place of (scene && scene.marks) || []) {
    if (place.markId === markId) return place.anchor;
  }
  return null;
}

/** Размещение метки в сцене по её идентификатору. */
export function volumeMarkPlace(scene, markId) {
  for (const place of (scene && scene.marks) || []) {
    if (place.markId === markId) return place;
  }
  return null;
}
