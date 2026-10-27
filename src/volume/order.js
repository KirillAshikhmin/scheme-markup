// «Объём»: порядок граней — дерево разбиения (BSP) строится раз на сцену,
// обходится за n на кадр (D32, D33).
//
// Часть «Объёма», вынесенная из `src/volume.js` (2026-10-25) переносом без
// переименований: снаружи модуль читают через дверь `volume.js`, а соседи по
// `src/volume/` — напрямую. Зависимости идут только вниз по слоям (порядок —
// в шапке `volume.js`), циклов нет. Решения и доводы — в шапках разделов ниже.
import { VOLUME_LAYER_BODY, VOLUME_ORDER_SPLIT_COST, VOLUME_ORDER_TRIES, VOLUME_PLANE_EPS_MM } from "./measures.js";
import { volumeBoxEmpty, volumeFacesSpan } from "./shapes.js";

/**
 * Дерево порядка стопки: по дереву на этаж, сшитые горизонтальной плоскостью.
 *
 * **Почему не одно дерево на всё.** Дерево строится при сборке сцены и стоит
 * девять миллисекунд на 2458 гранях одной схемы; растёт оно хуже, чем линейно —
 * резы множатся. А этажи **не проникают друг в друга**: каждый лежит в своём
 * слое между перекрытиями, и горизонтальная плоскость между ними — это точный
 * узел дерева, а не приближение. Поэтому стопка платит ровно столько, сколько
 * платят этажи по отдельности, и ни одного лишнего реза.
 *
 * `groups` — этажи снизу вверх, у каждого свои грани. Если чьи-то тела всё же
 * перекрылись по вертикали (метка, посаженная выше стен своего этажа), сшивать
 * нечем — такие этажи сливаются в одно дерево. Это дороже, зато верно: порядок
 * в объёме обязан быть точным в каждом пикселе.
 *
 * `boxes` — этажи стопки (таск 232), по одному на каждую запись `groups`.
 * Дерево пачки лежит **у первого её этажа** (`box.tree`, состав пачки —
 * `box.pack`), и берётся готовым, когда сошлись три условия: состав пачки тот
 * же, ни один её этаж не собран заново (`box.fresh`) и все уехали одинаково
 * (`box.move`). Иначе ящики всей пачки пустеют, а дерево строится здесь: оно
 * ложится в ящик первого этажа, точки резов — в его `cuts`, и по ним пачка
 * потом переезжает целиком.
 *
 * Пачка из одного этажа и пачка из слипшихся считаются одинаково, второго
 * правила для них нет: у перекрывшихся этажей дерево просто одно на всех, а
 * хозяин ему — нижний.
 */
export function volumeOrderStack(groups, boxes = null) {
  const boxAt = (at) => (boxes && at >= 0 && boxes[at]) || null;
  const parts = [];
  for (let group = 0; group < (groups || []).length; group += 1) {
    const faces = groups[group];
    const inTree = (faces || []).filter((face) => !face.line && face.layer === VOLUME_LAYER_BODY);
    const span = volumeFacesSpan(inTree);
    if (!span) continue;
    const last = parts[parts.length - 1];
    // Перекрылись по вертикали — плоскости между ними нет, и этажи считаются
    // одним куском. **Касание не перекрытие**: с таска 209 плита верхнего
    // этажа начинается ровно там, где кончаются стены нижнего, и шов проходит
    // по этой самой плоскости — ни одна грань её не пересекает.
    if (last && span.minZ < last.span.maxZ - VOLUME_PLANE_EPS_MM) {
      last.faces = [...last.faces, ...inTree];
      last.span = { minZ: Math.min(last.span.minZ, span.minZ), maxZ: Math.max(last.span.maxZ, span.maxZ) };
      last.pack.push(group);
      continue;
    }
    parts.push({ faces: inTree, span, pack: [group] });
  }
  if (parts.length === 0) return null;
  /** Готовое дерево пачки или `null`: состав, свежесть и переезд — у всех. */
  const ready = (part) => {
    const box = boxAt(part.pack[0]);
    if (!box || !box.tree) return null;
    const was = box.pack || [];
    if (was.length !== part.pack.length) return null;
    for (let at = 0; at < was.length; at += 1) if (was[at] !== part.pack[at]) return null;
    const move = box.move || { dx: 0, dy: 0, dz: 0 };
    for (const group of part.pack) {
      const one = boxAt(group);
      if (!one || one.fresh) return null;
      const step = one.move || { dx: 0, dy: 0, dz: 0 };
      if (step.dx !== move.dx || step.dy !== move.dy || step.dz !== move.dz) return null;
    }
    return box.tree;
  };
  const treeOf = (part) => {
    const done = ready(part);
    if (done) return done;
    for (const group of part.pack) volumeBoxEmpty(boxAt(group));
    const box = boxAt(part.pack[0]);
    const built = volumeOrderTree(part.faces, box ? box.cuts : null);
    if (box) {
      box.tree = built;
      box.pack = part.pack;
    }
    return built;
  };
  let tree = treeOf(parts[0]);
  for (let at = 1; at < parts.length; at += 1) {
    const upper = treeOf(parts[at]);
    if (!upper) continue;
    if (!tree) {
      tree = upper;
      continue;
    }
    // Шов — ровно между этажами: верх нижнего и низ верхнего.
    const zMm = (parts[at - 1].span.maxZ + parts[at].span.minZ) / 2;
    tree = {
      plane: { x: 0, y: 0, z: 1, d: zMm },
      same: [],
      front: upper,
      back: tree,
      count: tree.count + upper.count,
    };
  }
  return tree;
}

// ——— порядок граней: дерево разбиения (D32, D33) ——————————————————————————
//
// Порядок рисования — не сортировка, а **дерево**, построенное один раз на
// сцену (`volumeOrderTree`) и обойдённое на каждый кадр (`volumeOrderWalk`).
//
// ——— почему не сортировка ————————————————————————————————————————————————
//
// «Художник» сравнивает грани одним числом — дальностью середины, — а
// перекрытие в кадре решает дальность **в пикселе**. У грани, уходящей от
// камеры вдаль, это разные числа, и спор она проигрывает целиком: стена в
// четыре метра серединой оказывается ближе вещи, стоящей у её края (D32,
// «иногда бывает что стены просвечивают»).
//
// Таск 150 лечил это **ломтями**: грань резалась плоскостями равной дальности
// `z = k · 250 мм`, и каждый кусок ехал со своей серединой. Провалы глубже
// полуметра это убрало, но завело свою семью дефектов (D33, слова заказчика:
// «на границах и углах появились треугольные артефакты»):
//
//   — ошибка порядка не исчезла, а измельчала: внутри одного ломтя соседние
//     куски по-прежнему спорят, и спор этот теперь виден **на каждом кадре** —
//     ровной чередой клиньев с шагом ломтя вдоль кромки;
//   — у разрезанной грани появились швы: канва сглаживает края, и два куска
//     общего ребра не складываются в непрозрачный пиксель.
//
// Ни то ни другое мельче шага не чинится: это та же шкала, а не выход.
//
// ——— что вместо ————————————————————————————————————————————————————————
//
// Дерево двоичного разбиения пространства. В узле — плоскость одной из граней;
// всё, что перед ней, в одном поддереве, всё, что за ней, в другом, грани в
// самой плоскости — в узле. Грань, которую плоскость пересекает, режется по ней
// надвое — **по настоящей геометрии, а не по сетке**.
//
// Свойство, ради которого всё затевалось: луч из глаза пересекает плоскость
// узла не больше одного раза, значит **всё, что лежит на стороне глаза, стоит
// на луче раньше** всего, что лежит за плоскостью. Обход «дальнее поддерево,
// потом плоскость, потом ближнее» даёт порядок, верный в каждом пикселе и на
// любом ракурсе — не «ошибка не больше шага», а ошибки нет вовсе.
//
// Цена названа и замерена в отчёте таска: дерево строится при сборке сцены
// (там же, где считаются грани, — на объекте заказчика это единицы
// миллисекунд), резов выходит на порядок меньше, чем давали ломти, а кадр
// вместо сортировки `n log n` получает обход `n` без единого сравнения.
//
// Ярусы (`VOLUME_LAYER_*`) дерево не отменяет: в нём лежит только ярус тел.
// Плита, полы с потолками и указатель «вы здесь» ложатся до и после него по
// прежнему правилу — там спорить не о чем (см. `VOLUME_LAYER_BASE`).
//
// ——— и почему прозрачным вещам не понадобился второй проход ——————————
//
// Таск 169 сделал вещи чертежа полупрозрачными, и прозрачность требует
// рисования **строго от дальних к ближним без пропусков**: смешивание
// некоммутативно, переставь двоих — получишь другой цвет. У «художника» (таск
// 150) этого не было: он сортировал по средней дальности и врал в тех самых
// точках, где грани пересекались, — прозрачность показала бы его ложь цветом,
// а не только порядком.
//
// Дерево даёт ровно то, что нужно, и **ровно то же самое, что давало до
// прозрачности**: обход «дальнее поддерево → своя плоскость → ближнее» — это и
// есть порядок от дальних к ближним, точный в каждом пикселе, потому что
// спорящие грани разрезаны по-настоящему. Поэтому ни отдельного прохода, ни
// сортировки прозрачных, ни разделения потоков здесь нет: **признак
// прозрачности не участвует в порядке вовсе** — он виден только цвету
// (`volumeFill` отдаёт `rgba`) и взгляду (`volumeSightAt` смотрит сквозь).
// Отдельный проход был бы здесь не улучшением, а поломкой: он бы выдернул
// вещь из её настоящего места и поставил прозрачный шкаф **перед** стеной
// соседней комнаты.
//
// Что дерево не обещает и обещать не может — порядок **коплоскостных** граней
// (список `same` в узле): они друг друга не закрывают, и до прозрачности их
// порядок не значил ничего. Прозрачным он тоже не значит ничего, пока
// коплоскостные грани не накладываются друг на друга, — а наложенных
// коплоскостных граней в сцене нет: тела модели стоят рядом, а не в одной
// плоскости поверх друг друга.
//
// Что при этом честно складывается, а не пропадает, — **прозрачность по
// пути**: сквозь шкаф с фасадом луч проходит две лицевые грани (отсеиваются
// только отвёрнутые, а не стоящие друг за другом), и это посчитано в числе
// `VOLUME_CLEAR_ALPHA`.

/** Плоскость грани: нормаль и расстояние до начала координат. */
function volumePlaneOf(face) {
  return {
    x: face.n.x,
    y: face.n.y,
    z: face.n.z,
    d: face.n.x * face.p[0].x + face.n.y * face.p[0].y + face.n.z * face.p[0].z,
  };
}

/** С какой стороны плоскости точка: 1 перед, −1 за, 0 — на ней. */
function volumePointSide(plane, point, eps = VOLUME_PLANE_EPS_MM) {
  const gap = plane.x * point.x + plane.y * point.y + plane.z * point.z - plane.d;
  return gap > eps ? 1 : gap < -eps ? -1 : 0;
}

/**
 * С какой стороны плоскости грань: `1` перед, `−1` за, `0` в самой плоскости,
 * `2` — пересекает, то есть её придётся резать.
 */
export function volumeFaceSide(plane, face) {
  let front = 0;
  let back = 0;
  for (const point of face.p) {
    const side = volumePointSide(plane, point);
    if (side > 0) front += 1;
    else if (side < 0) back += 1;
  }
  if (front > 0 && back > 0) return 2;
  if (front > 0) return 1;
  if (back > 0) return -1;
  return 0;
}

/**
 * Разрез грани плоскостью. Возвращает `{front, back}` — две грани со всеми
 * полями исходной (цвет, ярус, хозяин, полотно) и своими точками.
 *
 * Грань выпуклая или нет — обход один и тот же: вершины раскладываются по
 * сторонам, точка пересечения ребра попадает в обе половины.
 *
 * `cuts` — куда складывать **новые** точки реза. Нужны они одному: этажу
 * стопки, который потом переставляют на другую базу (таск 232). Вершины
 * половин — это точки самой грани: они лежат в сцене и переедут вместе с ней, а
 * точка пересечения ребра не лежит в сцене нигде и осталась бы на месте. В обе
 * половины попадает **одна** точка, и в список она кладётся один раз.
 */
export function volumeSplitFace(face, plane, cuts = null) {
  const side = volumeFaceSide(plane, face);
  if (side === 1 || side === 0) return { front: face, back: null };
  if (side === -1) return { front: null, back: face };
  const front = [];
  const back = [];
  const points = face.p;
  for (let index = 0; index < points.length; index += 1) {
    const a = points[index];
    const b = points[(index + 1) % points.length];
    const sa = volumePointSide(plane, a);
    const sb = volumePointSide(plane, b);
    if (sa >= 0) front.push(a);
    if (sa <= 0) back.push(a);
    if (sa * sb < 0) {
      const da = plane.x * a.x + plane.y * a.y + plane.z * a.z - plane.d;
      const db = plane.x * b.x + plane.y * b.y + plane.z * b.z - plane.d;
      const t = da / (da - db);
      const cut = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
      if (cuts) cuts.push(cut);
      front.push(cut);
      back.push(cut);
    }
  }
  return {
    front: front.length >= 3 ? { ...face, p: front } : null,
    back: back.length >= 3 ? { ...face, p: back } : null,
  };
}

/**
 * Дерево порядка по граням яруса тел. `null` — делить нечего.
 *
 * Строится один раз на сцену и живёт в ней (`scene.order`): сцена пересобирается
 * при правке объекта и при открытии двери, и дерево вместе с ней.
 *
 * `cuts` — список точек реза (см. `volumeSplitFace`). Собирает его только
 * стопка: по нему этаж переставляется на другую базу целиком, вместе с уже
 * построенным деревом (таск 232).
 */
export function volumeOrderTree(faces, cuts = null) {
  const statics = [];
  const doors = [];
  for (const face of faces || []) {
    if (!face || face.line) continue;
    if (face.layer !== undefined && face.layer !== VOLUME_LAYER_BODY) continue;
    (face.doorId ? doors : statics).push(face);
  }
  // Память — только у сцены одной схемы (`cuts` пуст): у этажа стопки точки
  // граней переезжают на месте, и сверять их с прежними нечем.
  let base = null;
  const kept = cuts === null ? volumeOrderKept : null;
  if (kept && volumeFacesSame(kept.statics, statics)) base = kept.tree;
  else {
    base = volumeOrderNode(statics, cuts);
    if (cuts === null) volumeOrderKept = { statics, tree: base };
  }
  return volumeOrderInsert(base, doors, cuts);
}

// ——— дерево неподвижных граней (правка 2026-10-27) ————————————————————————
//
// Слова заказчика: «почему-то при открытии любой двери микрофриз есть». Дверь
// пересобирает сцену целиком (`rebuildScene` в `panels/volume.js`), и дороже
// всего в пересборке — дерево порядка: на объекте заказчика в 13 тысяч граней
// две трети из 65 мс счёта. А от двери в дереве меняются только грани с
// `doorId` — полотна, створки окон, ворота, — и их десяток.
//
// Поэтому дерево строится **по неподвижным граням**, а двери вставляются в
// него потом (`volumeOrderInsert`). Неподвижные грани новой сборки сверяются с
// прежними (`volumeFacesSame`): совпали поле в поле — дерево берётся готовым,
// и дверь стоит вставки десятка граней. Не совпали — строится заново, как
// прежде. Сверка честная, а не по признаку «объект тот же»: в дерево попадает
// ровно то, что собрала сцена, и врать порядку здесь нечем.
//
// Порядок в каждом пикселе от этого не меняется: дерево с гранями, вставленными
// после, — такое же дерево разбиения, просто плоскости дверей в нём лежат
// ниже. Вставка не трогает готового дерева — меняются копии узлов на её пути,
// и прежнее дерево остаётся годным для следующей двери.

/** Неподвижные грани последней сборки и их дерево: `{statics, tree}`. */
let volumeOrderKept = null;

/** Грани поле в поле те же, в том же порядке. */
function volumeFacesSame(was, now) {
  if (was.length !== now.length) return false;
  for (let index = 0; index < was.length; index += 1) {
    if (!volumeOrderValueSame(was[index], now[index], 3)) return false;
  }
  return true;
}

// Сверка значений вглубь на `depth` уровней: грань → точки → координаты.
// Глубже — «не те же», и дерево строится заново: промах здесь стоит времени,
// а не картинки.
function volumeOrderValueSame(a, b, depth) {
  if (a === b) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object" || depth <= 0) return false;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    for (let index = 0; index < a.length; index += 1) if (!volumeOrderValueSame(a[index], b[index], depth - 1)) return false;
    return true;
  }
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  for (const key of keys) if (!volumeOrderValueSame(a[key], b[key], depth - 1)) return false;
  return true;
}

/**
 * Вставить грани в готовое дерево. Готовое не меняется: узлы на пути
 * вставки — копии. Грань, которую плоскость узла пересекает, режется по ней,
 * как при сборке; в пустое место встаёт дерево вставленных граней.
 */
export function volumeOrderInsert(node, faces, cuts = null) {
  if (!faces || faces.length === 0) return node;
  if (!node) return volumeOrderNode(faces, cuts);
  const same = [];
  const front = [];
  const back = [];
  for (const face of faces) {
    const side = volumeFaceSide(node.plane, face);
    if (side === 0) same.push(face);
    else if (side === 1) front.push(face);
    else if (side === -1) back.push(face);
    else {
      const cut = volumeSplitFace(face, node.plane, cuts);
      if (cut.front) front.push(cut.front);
      if (cut.back) back.push(cut.back);
    }
  }
  const next = {
    plane: node.plane,
    same: same.length > 0 ? [...node.same, ...same] : node.same,
    front: volumeOrderInsert(node.front, front, cuts),
    back: volumeOrderInsert(node.back, back, cuts),
    count: 0,
  };
  next.count = next.same.length + (next.front ? next.front.count : 0) + (next.back ? next.back.count : 0);
  return next;
}

/**
 * Узел дерева. Плоскость выбирается примеркой: меньше резов, ровнее половины.
 * Грань-кандидат всегда лежит в своей же плоскости, поэтому узел забирает хотя
 * бы одну грань — построение не зацикливается.
 */
function volumeOrderNode(items, cuts = null) {
  if (items.length === 0) return null;
  let best = null;
  const tries = Math.min(items.length, VOLUME_ORDER_TRIES);
  for (let at = 0; at < tries; at += 1) {
    const plane = volumePlaneOf(items[Math.floor((at * items.length) / tries)]);
    let front = 0;
    let back = 0;
    let splits = 0;
    for (const item of items) {
      const side = volumeFaceSide(plane, item);
      if (side === 2) splits += 1;
      else if (side === 1) front += 1;
      else if (side === -1) back += 1;
    }
    if (front === 0 && back === 0 && splits === 0) continue;
    const score = splits * VOLUME_ORDER_SPLIT_COST + Math.abs(front - back);
    if (!best || score < best.score) best = { plane, score };
  }
  // Все грани в одной плоскости: делить нечем, и незачем — коплоскостные грани
  // друг друга не закрывают.
  if (!best) return { plane: volumePlaneOf(items[0]), same: items, front: null, back: null, count: items.length };
  const plane = best.plane;
  const same = [];
  const front = [];
  const back = [];
  for (const item of items) {
    const side = volumeFaceSide(plane, item);
    if (side === 0) {
      same.push(item);
      continue;
    }
    if (side === 1) {
      front.push(item);
      continue;
    }
    if (side === -1) {
      back.push(item);
      continue;
    }
    const cut = volumeSplitFace(item, plane, cuts);
    if (cut.front) front.push(cut.front);
    if (cut.back) back.push(cut.back);
  }
  const node = { plane, same, front: volumeOrderNode(front, cuts), back: volumeOrderNode(back, cuts), count: 0 };
  node.count = same.length + (node.front ? node.front.count : 0) + (node.back ? node.back.count : 0);
  return node;
}

/**
 * Обход дерева от дальнего к ближнему: дальнее поддерево, своя плоскость,
 * ближнее поддерево. Возвращает грани в порядке рисования.
 */
export function volumeOrderWalk(tree, eye, out = []) {
  if (!tree) return out;
  const near = volumePointSide(tree.plane, eye) >= 0;
  volumeOrderWalk(near ? tree.back : tree.front, eye, out);
  for (const face of tree.same) out.push(face);
  volumeOrderWalk(near ? tree.front : tree.back, eye, out);
  return out;
}

/**
 * Сколько граней обход нарисует **раньше** этой точки. Ею встают в очередь те,
 * кого в дереве нет: линии (контур вещи, стрелка связи) — рисунок поверх сцены,
 * резать их по плоскостям нельзя (у ломаной есть концы, а у пунктира — шаг), и
 * место в очереди им считается по середине.
 */
export function volumeOrderRank(tree, eye, point) {
  let node = tree;
  let rank = 0;
  while (node) {
    const near = volumePointSide(node.plane, eye) >= 0;
    const first = near ? node.back : node.front;
    const second = near ? node.front : node.back;
    const side = volumePointSide(node.plane, point);
    const inFirst = near ? side < 0 : side > 0;
    if (inFirst) {
      node = first;
      continue;
    }
    rank += (first ? first.count : 0) + node.same.length;
    node = second;
  }
  return rank;
}

/** Грань яруса тел — та, что лежит в дереве порядка. */
export function volumeInTree(face) {
  return !face.line && (face.layer === undefined || face.layer === VOLUME_LAYER_BODY);
}

/** Середина грани или линии: ею считается место в очереди у тех, кого нет в дереве. */
export function volumeMiddleOf(points) {
  let x = 0;
  let y = 0;
  let z = 0;
  for (const point of points) {
    x += point.x;
    y += point.y;
    z += point.z;
  }
  return { x: x / points.length, y: y / points.length, z: z / points.length };
}
