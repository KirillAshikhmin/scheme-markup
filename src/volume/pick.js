// «Объём»: что под пальцем — метка, канал, дверь и проём по точке экрана.
//
// Часть «Объёма», вынесенная из `src/volume.js` (2026-10-25) переносом без
// переименований: снаружи модуль читают через дверь `volume.js`, а соседи по
// `src/volume/` — напрямую. Зависимости идут только вниз по слоям (порядок —
// в шапке `volume.js`), циклов нет. Решения и доводы — в шапках разделов ниже.

/**
 * Какую дверь показывают (G207): ищется по полотну и ручке, сверху вниз — тем
 * же порядком, которым рисовался кадр, только с конца. Запас промаха тот же,
 * что у вещей: полотно в три метра занимает полкадра, а ручка — пару точек, и
 * требовать попадания в саму дверь на другом конце коридора незачем.
 */
export function volumeDoorAt(polygons, x, y, slack = VOLUME_PICK_SLACK_PX) {
  let near = null;
  let gap = slack;
  for (let index = polygons.length - 1; index >= 0; index -= 1) {
    const polygon = polygons[index];
    if (!polygon.door || polygon.stroke) continue;
    if (volumePolygonHit(polygon.xy, x, y)) return polygon.door;
    const centre = volumePolygonCentre(polygon.xy);
    const distance = Math.hypot(centre.x - x, centre.y - y);
    if (distance < gap) {
      gap = distance;
      near = polygon.door;
    }
  }
  return near;
}

/**
 * **Дверь по её проёму** (правка после сборки сценариев). Слова заказчика:
 * «Открыл дверь нажатием Е, потом курсор убрал в другую сторону, а нажатие Е
 * всё равно открывает дверь… открывает и закрывает последнюю дверь, с которой
 * взаимодействовали».
 *
 * Полотно открытой двери уезжает из-под прицела, и закрыть её было бы не во
 * что целиться. Поэтому дверью считается и **её проём**: точка внутри рамки
 * его откосов на кадре (прямоугольник, охватывающий их многоугольники). Из
 * нескольких проёмов под точкой — тот, чьи откосы нарисованы позже, то есть
 * ближний. Взгляд мимо проёма — двери нет, и E о ней не знает.
 */
export function volumeDoorwayAt(polygons, x, y) {
  const frames = new Map();
  (polygons || []).forEach((polygon, index) => {
    // Рамка — откосы проёма и само полотно: у открытой двери оно стоит рядом.
    const owner = polygon.doorway || polygon.door;
    if (!owner || polygon.stroke || !polygon.xy) return;
    let frame = frames.get(owner);
    if (!frame) {
      frame = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity, last: index };
      frames.set(owner, frame);
    }
    for (let at = 0; at + 1 < polygon.xy.length; at += 2) {
      frame.minX = Math.min(frame.minX, polygon.xy[at]);
      frame.maxX = Math.max(frame.maxX, polygon.xy[at]);
      frame.minY = Math.min(frame.minY, polygon.xy[at + 1]);
      frame.maxY = Math.max(frame.maxY, polygon.xy[at + 1]);
    }
    frame.last = index;
  });
  if (frames.size === 0) return null;
  // Что под точкой нарисовано последним и не просвечивает: кадр идёт от
  // дальнего к ближнему, и проём за стеной закрыт гранью, нарисованной позже
  // его откосов. Своя дверь проём не закрывает — ни полотно, ни откос.
  let cover = null;
  for (let index = (polygons || []).length - 1; index >= 0; index -= 1) {
    const polygon = polygons[index];
    if (polygon.stroke || polygon.clear || !polygon.xy || !volumePolygonHit(polygon.xy, x, y)) continue;
    cover = { index, owner: polygon.doorway || polygon.door || null };
    break;
  }
  let best = null;
  for (const [id, frame] of frames) {
    if (x < frame.minX || x > frame.maxX || y < frame.minY || y > frame.maxY) continue;
    if (cover && cover.index > frame.last && cover.owner !== id) continue;
    if (!best || frame.last > best.last) best = { id, last: frame.last };
  }
  return best ? best.id : null;
}

/** Насколько промахивается рука: розетка в трёх метрах — десяток точек экрана. */
export const VOLUME_PICK_SLACK_PX = 14;

/**
 * Во что попал клик (таск 148): обозначение метки или `null`.
 *
 * Ищется **по телам вещей и сверху вниз** — тем же порядком, которым кадр
 * рисовался, только с конца: что человек видит последним нарисованным, то и
 * под курсором. Контуры и связи в поиске не участвуют: по ним целиться нельзя,
 * а попадание в линию толщиной в точку было бы случайностью.
 *
 * Не попал точно — берётся ближайшая вещь в пределах промаха: розетка с трёх
 * метров занимает десяток точек, и требовать попадания в неё пикселем значило
 * бы сделать выделение недоступным ровно там, где оно нужнее всего.
 */
export function volumePickAt(polygons, x, y, slack = VOLUME_PICK_SLACK_PX) {
  let near = null;
  let gap = slack;
  for (let index = polygons.length - 1; index >= 0; index -= 1) {
    const polygon = polygons[index];
    if (!polygon.pick || polygon.stroke) continue;
    if (volumePolygonHit(polygon.xy, x, y)) return polygon.pick;
    const centre = volumePolygonCentre(polygon.xy);
    const distance = Math.hypot(centre.x - x, centre.y - y);
    if (distance < gap) {
      gap = distance;
      near = polygon.pick;
    }
  }
  return near;
}

/**
 * **Что видно в точке кадра** (G214): обозначение метки, если в этой точке
 * последней нарисована она, иначе `null` — стена, пол, полотно двери.
 *
 * Отличие от `volumePickAt` одно, и оно по существу. Клик — это рука, и ей
 * прощается промах: вещь, до которой десяток точек, считается задетой, а стена
 * перед ней руке не мешает. Прицел — это **взгляд**, и прощать ему нечего: он
 * показывает ровно одну точку кадра, и ответ на вопрос «на что ты смотришь»
 * может быть только один — то, что в этой точке видно. Спрятанную за стеной
 * вещь человек не видит, и выделять её по взгляду было бы обманом.
 *
 * Отвечать на это стало можно только с таском 151: порядок кадра точен в
 * каждом пикселе, и «нарисовано последним» наконец значит «видно».
 *
 * ——— сквозь прозрачную вещь (таск 169, G251) ———
 *
 * Прозрачная грань (вещь чертежа) для взгляда **не существует**: обход идёт
 * дальше, пока не упрётся в непрозрачное. Это и есть просьба заказчика
 * «взаимодействовать с ними»: шкаф просвечивает, за ним видно розетку — значит
 * ответ «на что ты смотришь» — розетка, а не шкаф.
 *
 * Правило «видно — выделяется» при этом не меняется, а исполняется буквально:
 * сквозь прозрачное видно, сквозь стену — нет, и **стена по-прежнему
 * останавливает обход**. Метка за перегородкой невидима и невыделяема, даже
 * если перед перегородкой стоит прозрачный шкаф.
 *
 * Пропустить, а не «спросить ближайшую непрозрачную и выбрать из двух», —
 * потому что выбирать не из чего: **у вещи чертежа хозяина нет вовсе**
 * (`markId` у её граней `null`), и до таска 169 взгляд в шкаф отвечал `null`.
 * Прозрачная грань не отняла ни одного ответа — она только перестала закрывать
 * чужой.
 *
 * Отсюда и ответ на «а если за прозрачной вещью ничего нет»: за ней
 * непрозрачная стена, пол или плита — обход упирается в них и отвечает `null`,
 * ровно как прежде. Для `E` это «тут ничего нет» словами (`volume.aimless`),
 * для щелчка — снятие выделения, как по пустому месту плана. Ни одна точка
 * поля смысла не поменяла, кроме той, где за вещью **и правда** метка.
 *
 * ——— а сквозь тюль взгляд не проходит (таск 189, G286) ———
 *
 * Прозрачная грань пропускает взгляд, **пока у неё нет хозяина**. У шторы он
 * есть: тюль — это сама метка, её выделяют, у неё открываются свойства, по ней
 * щёлкают. Пропусти её — и выделить шторы взглядом стало бы нельзя вовсе:
 * ответом стало бы окно за ними, то есть `null`.
 *
 * Поэтому правило звучит не «прозрачное пропускается», а **«пропускается то,
 * за чем всё равно никого не выделить»**: у вещи чертежа хозяина нет (`markId`
 * её граней — `null`), и пропуск не отнимает ни одного ответа — он только
 * перестаёт закрывать чужой. У метки хозяин есть, и пропуск отнял бы её
 * собственный.
 *
 * Цена названа прямо: **метку, целиком закрытую тюлем, взглядом не выделить** —
 * ответом будет штора. Это ровно то, что было до таска 189 (тогда полотнище
 * было плотным), то есть не потеря, а сохранение: прозрачность поменяла, как
 * штора выглядит, а не что выделяется. Достать метку за шторой по-прежнему
 * может рука — `volumePickAt` прозрачности не спрашивает вовсе, и промах в
 * десяток точек приводит именно её.
 */
export function volumeSightAt(polygons, x, y) {
  for (let index = polygons.length - 1; index >= 0; index -= 1) {
    const polygon = polygons[index];
    if (polygon.stroke || volumeSeeThrough(polygon)) continue;
    if (volumePolygonHit(polygon.xy, x, y)) return polygon.pick || null;
  }
  return null;
}

/**
 * Смотрит ли взгляд сквозь этот многоугольник: прозрачный и бесхозный — да,
 * прозрачная метка — нет. Одно место на взгляд и на клавиши: разойдись они —
 * щелчок выбирал бы канал у выключателя за шторой.
 */
function volumeSeeThrough(polygon) {
  return Boolean(polygon.clear) && !polygon.pick;
}

/**
 * **В какую клавишу попал щелчок** (таск 177, G274): `{markId, channel}` или
 * `null`.
 *
 * Правило то же, что у взгляда (`volumeSightAt`): клавиша должна быть **видна**
 * в этой точке кадра. Промах здесь не прощается, и это по существу: соседние
 * клавиши стоят в десятке миллиметров друг от друга, и «ближайшая в пределах
 * промаха» означала бы, что выбран канал, по которому человек не целился.
 * Выделение самой метки при этом остаётся со своим запасом — промах по клавише
 * просто выделяет вещь целиком, как выделял до каналов.
 */
export function volumeChannelAt(polygons, x, y) {
  for (let index = polygons.length - 1; index >= 0; index -= 1) {
    const polygon = polygons[index];
    if (polygon.stroke || volumeSeeThrough(polygon)) continue;
    if (!volumePolygonHit(polygon.xy, x, y)) continue;
    if (!polygon.pick || !polygon.channel) return null;
    return { markId: polygon.pick, channel: polygon.channel };
  }
  return null;
}

/**
 * **Ближайшая клавиша метки** к точке кадра: `{markId, channel}` или `null`,
 * если клавиш у неё не нарисовано (правка 2026-10-27).
 *
 * Слова заказчика: «почему-то не все выключатели реагируют на нажатие Е в
 * объёме». Не реагировали многоклавишные: прицел в рамке между клавишами не
 * находил ни одной (`volumeChannelAt` промаха не прощает), а без клавиши
 * нажимать нечего. Нажатие при запущенном доме — не выбор канала: человек
 * целился в выключатель и ждёт, что он щёлкнет. Поэтому здесь, и только здесь,
 * промах прощается — ближайшей клавишей той же метки. Выбор канала щелчком
 * при остановленном доме остаётся строгим.
 */
export function volumeChannelNear(polygons, markId, x, y) {
  let best = null;
  let bestDistance = Infinity;
  for (const polygon of polygons) {
    if (polygon.stroke || polygon.pick !== markId || !polygon.channel) continue;
    const centre = volumePolygonCentre(polygon.xy);
    const distance = (centre.x - x) ** 2 + (centre.y - y) ** 2;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = { markId, channel: polygon.channel };
    }
  }
  return best;
}

function volumePolygonHit(xy, x, y) {
  let inside = false;
  for (let i = 0, j = xy.length - 2; i < xy.length; j = i, i += 2) {
    const ax = xy[i];
    const ay = xy[i + 1];
    const bx = xy[j];
    const by = xy[j + 1];
    const crosses = ay > y !== by > y;
    if (crosses && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) inside = !inside;
  }
  return inside;
}

function volumePolygonCentre(xy) {
  let sumX = 0;
  let sumY = 0;
  for (let index = 0; index < xy.length; index += 2) {
    sumX += xy[index];
    sumY += xy[index + 1];
  }
  const count = xy.length / 2;
  return { x: sumX / count, y: sumY / count };
}
