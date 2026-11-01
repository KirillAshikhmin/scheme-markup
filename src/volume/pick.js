// «Объём»: что под пальцем — метка, канал, дверь, проём и поверхность по точке
// экрана.
//
// Часть «Объёма», вынесенная из `src/volume.js` (2026-10-25) переносом без
// переименований: снаружи модуль читают через дверь `volume.js`, а соседи по
// `src/volume/` — напрямую. Зависимости идут только вниз по слоям (порядок —
// в шапке `volume.js`), циклов нет. Решения и доводы — в шапках разделов ниже.
import { volumeRayAt } from "./camera.js";
import { volumeIsCeiling, volumeIsFloor, volumeIsWall } from "./faces.js";
import { VOLUME_DOOR_RGB, VOLUME_FRAME_RGB, VOLUME_GLASS_RGB, VOLUME_NEAR_MM } from "./measures.js";

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

// ——— поверхность под прицелом: линейка (таск 237, G356, G358) ——————————————
//
// Заказчик: «В объёме начало и конец отрезка измеряемого может ставиться только
// на стены\пол\потолок, а не просто в случайную точку в объёме». И, вторым
// ответом (G358): «Да, поверхности дверей, проёмов и окон тоже надо отмечать».
//
// **Обратного хода «точка кадра → точка на грани в миллиметрах» в сборке не
// было.** Кадр отвечал только хозяином (`volumeSightAt` — чья метка), а
// многоугольник кадра трёхмерной геометрии не несёт вовсе: у него `xy`,
// глубина, ярус и краска (`volumeFacePolygons`). Путей было два, и выбран
// первый:
//
//   **луч сквозь грани сцены на событие** — кадр не платит ничего. Мерят редко:
//     два клика на измерение и ход руки между ними. Проход по `scene.faces`
//     стоит отсечения плоскостью (скалярное произведение и деление), а
//     попадание в многоугольник считается только у граней, которые ближе уже
//     найденной, — на объекте в 13 тысяч граней это доли миллисекунды;
//
//   донести геометрию до многоугольника кадра было бы ближе к готовому порядку
//     отрисовки, но платил бы **каждый кадр**: три числа на вершину у шести
//     сотен многоугольников, и всё это ради двух кликов за сеанс. Бюджет кадра
//     (§6.4 карты) такого не выдерживает, и правило «новый эффект в кадре
//     меряют прежде, чем принять» здесь отвечает отказом.
//
// **Поверхность опознаётся гранью, а не цветом стены**: `volumeIsWall` /
// `volumeIsFloor` / `volumeIsCeiling` — крашеная стена несёт ответ полем
// `paint`, и сравнение `rgb` на ней провалилось бы. Полотно двери, створка и
// бруски рамы краски человека не знают вовсе, и у них ответ как раз цветом
// сборки: `VOLUME_DOOR_RGB` и `VOLUME_FRAME_RGB` больше нигде не встречаются
// (их ставит только `walls.js`), а проём узнаётся ещё и по хозяину (`doorId`,
// `doorway`) — звенья гармошки и ворота приходят ими.
//
// **Откос, подоконник и перемычка проёма приходят стеной, и это не поблажка**:
// срез толщи стены красится её же краской, то есть стеной и является. Отличать
// его отдельным условием было бы дороже и неверно по существу.
//
// **Мерим до стекла, а не сквозь него** (решение таска; заказчик оставил выбор
// исполнителю). Взгляд сквозь прозрачную бесхозную грань проходит
// (`volumeSeeThrough`) — там это правильно: за стеклом двери выделяют то, что
// видно. Линейке это правило не годится: человек целится в стеклопакет, и
// точка ушла бы на дом через улицу — туда, куда он не показывал. Стекло — это
// поверхность, которой касаются рулеткой, и мерить до него честнее.
//
// **А сквозь тюль и прозрачную мебель луч идёт дальше.** Их заказчик не
// называл (G358 — «двери, проёмы, окна»), и останавливаться на них значило бы
// отказывать в точке там, где поверхность за ними прекрасно видна: сквозь
// шкаф видно стену, и мерить хотят до стены. Разводятся они со стеклом по
// существу, а не по прозрачности: стекло — это `glass` у стеклянной стены и
// `VOLUME_GLASS_RGB` у остеклённого полотна, всё прочее прозрачное — ткань и
// вещи каталога.

/**
 * Насколько две грани считаются лежащими в одной точке луча. Полмиллиметра:
 * мерить тоньше нечем, а настоящие поверхности так близко друг к другу по
 * взгляду не стоят — даже полотно двери в 40 мм дальше.
 */
const VOLUME_SURFACE_SAME_MM = 0.5;

/** Стекло ли это: стеклянная стена или остеклённое полотно двери и окна. */
function volumeSurfaceGlass(face) {
  return Boolean(face.glass) || face.rgb === VOLUME_GLASS_RGB;
}

/**
 * Поверхность под точкой кадра: `{point, kind}` или `null`, если луч ни во что
 * не упёрся (небо, взгляд мимо дома).
 *
 * `point` — миллиметры чертежа с третьей осью от пола; `kind` — что это
 * (`volumeSurfaceKind`). Решение «ставить точку или нет» принимает вызывающий:
 * здесь только ответ на вопрос «что там», а слова у отказа свои
 * (`strings.measure.volumeMiss*`).
 */
export function volumeSurfaceAt(scene, camera, box, x, y) {
  if (!scene || scene.empty || !Array.isArray(scene.faces) || !camera || !box) return null;
  const ray = volumeRayAt(camera, box, x, y);
  let found = null;
  let near = Infinity;
  for (const face of scene.faces) {
    // Линия не поверхность; прозрачное пропускается, кроме стекла.
    if (face.line) continue;
    if (face.clear && !volumeSurfaceGlass(face)) continue;
    // Запас на совпадающие грани: ближе найденной — или ровно на ней.
    const away = volumeFaceRayAway(face, ray, near + VOLUME_SURFACE_SAME_MM);
    if (away === null) continue;
    // **Совпадающие грани разводит ярус, а не расстояние.** Пол помещения лежит
    // на плите чертежа ровно, в ноль (`VOLUME_LAYER_BASE` под
    // `VOLUME_LAYER_GROUND`), и по расстоянию они равны до последнего знака.
    // Кадр в таком споре рисует ту, у которой ярус выше, — она и видна. Возьми
    // луч первую попавшуюся, и прицел в пол комнаты отвечал бы землёй вокруг
    // дома: ровно это и случилось при первом прогоне.
    if (found && Math.abs(away - near) <= VOLUME_SURFACE_SAME_MM) {
      if (!(face.layer > found.layer)) continue;
    } else if (!(away < near)) {
      continue;
    }
    near = away;
    found = face;
  }
  if (!found) return null;
  return {
    point: {
      x: ray.at.x + ray.dir.x * near,
      y: ray.at.y + ray.dir.y * near,
      z: ray.at.z + ray.dir.z * near,
    },
    kind: volumeSurfaceKind(found),
  };
}

/** Годится ли эта поверхность под конец отрезка. Одна дверь к правилу G358. */
export function volumeSurfaceHolds(kind) {
  return Boolean(kind) && kind !== "other";
}

/**
 * Чем грань работает: `wall`, `floor`, `ceiling`, `door` (полотно, створка,
 * звено, ворота), `frame` (бруски рамы окна и остеклённой двери), `glass` — или
 * `other` у всего прочего: вещи каталога, тела меток, земля вокруг плиты.
 *
 * Порядок проверок — порядок надёжности ответа. Стекло спрашивается первым: его
 * грань у стеклянной стены **была** стеной и краску потеряла (`volumeGlassFace`
 * сбрасывает `paint`), и отвечать на неё «стена» значило бы соврать о том, до
 * чего мерили. Хозяин проёма — последним: он есть и у откосов, а те уже
 * ответили стеной, и это ближе к делу.
 */
export function volumeSurfaceKind(face) {
  if (!face) return "other";
  if (volumeSurfaceGlass(face)) return "glass";
  if (volumeIsWall(face)) return "wall";
  if (volumeIsFloor(face)) return "floor";
  if (volumeIsCeiling(face)) return "ceiling";
  if (face.rgb === VOLUME_DOOR_RGB) return "door";
  if (face.rgb === VOLUME_FRAME_RGB) return "frame";
  if (face.doorId || face.doorway) return "door";
  return "other";
}

/**
 * Насколько далеко по лучу лежит грань — или `null`: луч идёт вдоль её
 * плоскости, упирается за спиной, дальше уже найденной (`limit`) или мимо самого
 * многоугольника.
 *
 * Порядок проверок — порядок цены: плоскость стоит одно деление, попадание в
 * многоугольник — обход всех его вершин, и до него доходят только грани, которые
 * и правда ближе.
 */
function volumeFaceRayAway(face, ray, limit) {
  const points = face.p;
  if (!points || points.length < 3) return null;
  const n = face.n;
  if (!n) return null;
  const denom = n.x * ray.dir.x + n.y * ray.dir.y + n.z * ray.dir.z;
  if (Math.abs(denom) < 1e-9) return null;
  const first = points[0];
  const away =
    ((first.x - ray.at.x) * n.x + (first.y - ray.at.y) * n.y + (first.z - ray.at.z) * n.z) / denom;
  if (!(away > VOLUME_NEAR_MM) || !(away < limit)) return null;
  const at = {
    x: ray.at.x + ray.dir.x * away,
    y: ray.at.y + ray.dir.y * away,
    z: ray.at.z + ray.dir.z * away,
  };
  return volumeFaceHolds(points, n, at) ? away : null;
}

/**
 * Лежит ли точка плоскости внутри многоугольника. Многоугольник роняется на ту
 * из трёх плоскостей, где он не выродился: ось с самой большой нормалью
 * выбрасывается — стену по оси `x` нельзя разбирать в плановых осях, она там
 * отрезок.
 */
function volumeFaceHolds(points, n, at) {
  const ax = Math.abs(n.x);
  const ay = Math.abs(n.y);
  const az = Math.abs(n.z);
  const drop = az >= ax && az >= ay ? "z" : ay >= ax ? "y" : "x";
  const flat =
    drop === "z"
      ? (point) => ({ u: point.x, v: point.y })
      : drop === "y"
        ? (point) => ({ u: point.x, v: point.z })
        : (point) => ({ u: point.y, v: point.z });
  const spot = flat(at);
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    const a = flat(points[i]);
    const b = flat(points[j]);
    const crosses = a.v > spot.v !== b.v > spot.v;
    if (crosses && spot.u < ((b.u - a.u) * (spot.v - a.v)) / (b.v - a.v) + a.u) inside = !inside;
  }
  return inside;
}
