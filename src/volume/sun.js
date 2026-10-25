// «Объём»: солнце и луна в комнате — пятна из проёмов, свет окна, шторы и тюль.
//
// Часть «Объёма», вынесенная из `src/volume.js` (2026-10-25) переносом без
// переименований: снаружи модуль читают через дверь `volume.js`, а соседи по
// `src/volume/` — напрямую. Зависимости идут только вниз по слоям (порядок —
// в шапке `volume.js`), циклов нет. Решения и доводы — в шапках разделов ниже.
import { openingGlazed, openingOpens, openingsInWall, wallVectors, wallsOnScheme } from "../model.js";
import { DEG, VOLUME_FLOOR_RGB, VOLUME_NIGHT_RGB, VOLUME_WALL_RGB } from "./measures.js";
import { volumeAt, volumeFace, volumeShade, volumeShare01 } from "./faces.js";
import {
  VOLUME_FLOOR_LAP,
  VOLUME_MARK_WALL,
  VOLUME_SUN_PROBE_MM,
  VOLUME_WALL_SAME_DEG,
  volumeMix,
  volumePointInside,
  volumeRoomKey,
  volumeShiftPoints,
} from "./shapes.js";
import { volumeDoorOpen, volumeOpeningFaceMm, volumeWallPaintRgb, volumeWallTiles } from "./walls.js";

// ——— солнце в комнате (таск 196, дефект D51, требование G301) —————————————
//
// Слова заказчика: «почему-то теперь в доме вообще нет тени ни через двери ни
// через окна».
//
// **Сломанного нет, и это надо сказать прямо.** Внутреннего света в сборке не
// было никогда: тень дома (таск 178) лежит только на земле, а внутри комнат её
// не видно нарочно — ярусом (D49). Раньше сквозь щели в полу местами светила
// зелёная земля, и это читалось тенью; таск 190 щели закрыл, и «тень» вместе с
// ними исчезла. То есть заказчик просит не починки, а того, чего не было:
// света, который солнце кладёт на пол через проём.
//
// **Это проекция проёма, а не трассировка лучей.** Проём — прямоугольник в
// стене (низ, верх, ширина вдоль стены); солнце даёт направление; пятно — тот
// же прямоугольник, снесённый по направлению света на пол. Низ проёма сносится
// на `низ / tg(высота солнца)`, верх — на `верх / tg(...)`, и прямоугольник
// становится **параллелограммом**: смещение растёт с высотой линейно, а стороны
// проёма вдоль стены параллельны. Ни карт теней, ни отражений, ни света на
// стенах, ни второго шага (из комнаты в комнату через внутреннюю дверь) здесь
// нет — что из этого стоит сделать дальше, сказано в отчёте таска.
//
// ——— один шаг света: солнечная сторона проёма обязана быть улицей ————————
//
// У проёма две стороны, и обе спрашиваются у контуров помещений:
//
//   - **принимающая** (та, куда идёт свет) обязана быть комнатой — иначе пятну
//     негде лежать: свет уходит из дома на улицу;
//   - **солнечная** (та, откуда идёт свет) обязана быть улицей — иначе свет
//     пришёл бы из соседней комнаты, то есть сам был бы пятном от другого
//     проёма, а это уже второй шаг и трассировка.
//
// Отсюда сразу три ответа, которых иначе пришлось бы искать по отдельности:
//
//   1. **дверь между двумя комнатами пятна не даёт вовсе** — у неё обе стороны
//      комнаты, значит светить в неё нечему. Цена названа прямо: сквозь
//      внутреннюю дверь солнце в этой сборке не проходит, даже когда соседняя
//      комната залита светом. Врать красивее было бы дороже: пятно за
//      внутренней дверью появлялось бы и там, где его кормить нечем — у двери
//      в середине квартиры;
//   2. **солнце с другой стороны стены** — окно в северной стене в полдень не
//      светит: принимающей стороной оказывается улица, и проём отбрасывается
//      тем же условием, а не отдельной проверкой стороны света;
//   3. **проём в стене, у которой комнат нет совсем** (сарай на чертеже),
//      молчит.
//
// На объекте заказчика из 13 проёмов пятно могут дать 5 (четыре окна и входная
// дверь), остальные 8 — внутренние.

/**
 * Светлота пола: та же, которой красит его лампа сцены.
 *
 * Пол — **самая тёмная грань сцены** по построению (у `VOLUME_LIGHT`
 * отрицательная `z`: «пол темнее потолка», требование заказчика из таска 146).
 * Числом это `volumeShade({0,0,1})` = **0,502**, то есть пол `170·142·110`
 * показывается как `85·71·55` — то же число, которым считался дефект D49.
 */
const VOLUME_SUN_SPOT_DIM = volumeShade({ x: 0, y: 0, z: 1 });

/**
 * Цвет солнечного пятна: **тот же пол, которому досталась самая светлая грань
 * сцены вместо самой тёмной.**
 *
 * Мера взята из уже существующих, а не придумана: снаружи тень — это земля,
 * помноженная на 0,72 (`VOLUME_SHADOW_RGB`, доля взята от разброса светлот
 * `VOLUME_SHADE_MIN`…`VOLUME_SHADE_MAX` = 0,46…1); внутри всё ровно наоборот —
 * комната в полумраке, и солнце её местами освещает, то есть пятно это пол,
 * которому досталась светлота 1 вместо своей 0,502, — светлее себя же ровно
 * **вдвое** (1,99). Второй краски для пятна нет вовсе: `VOLUME_FLOOR_RGB`,
 * нарисованный без затенения (`flat`), и есть пятно — `170·142·110` против
 * пола `85·71·55`.
 *
 * **Гаснет пятно цветом, как и тень** — по тому же `fade`, которым гаснет она:
 * `fade` = 1 даёт полный свет, `fade` = 0 сводит пятно к самому полу, и в
 * сумерках оно исчезает, не мигнув. Прозрачностью этого делать нельзя по той же
 * причине, что у тени: пятна двух окон одной комнаты перекрываются, и на
 * пересечении вышло бы вдвое светлее.
 *
 * Ночь пятно не красит сама: `tint` кладёт на него тот же час, что на все грани
 * сцены (`volumeFrame` → `volumeFill`), — но ночью `fade` и так ноль, и пятен
 * нет: луна их не даёт, света у неё для этого нет.
 *
 * **Пятно на стене — то же правило, а не второе** (дефект D70): у грани берётся
 * её собственный цвет и её собственная светлота, и светлота поднимается до
 * единицы тем же `fade`. Пол — частный случай с самой тёмной светлотой сцены,
 * поэтому он и стоит умолчанием; стена `216·212·204` при светлоте 0,62…0,84
 * поднимается в себя же без затенения. Главное свойство у обоих одно и то же:
 * при `fade` = 0 пятно совпадает со своей гранью точка в точку — ни ступеньки,
 * ни канта.
 */
export function volumeSunSpotRgb(fade, rgb = VOLUME_FLOOR_RGB, dim = VOLUME_SUN_SPOT_DIM) {
  const share = Math.max(0, Math.min(1, Number(fade) || 0));
  const lift = dim + (1 - dim) * share;
  return [Math.round(rgb[0] * lift), Math.round(rgb[1] * lift), Math.round(rgb[2] * lift)];
}

/**
 * Какую долю проёма штора должна закрыть, чтобы погасить пятно, — **половину**.
 *
 * Полупятен не бывает (см. `volumeSunOpenings`), значит порог обязан быть, и
 * половина — единственный, который не выдуман: он симметричен и не требует
 * второго числа. Промахи названы прямо: штора, закрывающая 0,6 широкого окна,
 * гасит пятно целиком, а закрывающая 0,4 — не гасит вовсе.
 */
export const VOLUME_SHEER_SHARE = 0.5;

/** Ткань ли это: у тела модели стоит именованная плотность (таск 189). */
export function volumeSheerParts(parts) {
  return Array.isArray(parts) && parts.some((part) => part && part.clear);
}

/**
 * Штора ли эта метка — спрашивается **у модели, а не у кода типа**.
 *
 * Ткань в этой сборке уже помечена: у полотнищ стоит `clear: "sheer"` (таск
 * 189) — и у модели точечной шторы (`things.js` → `curtainRail`), и у повтора
 * вдоль пути у линейной (`lines.js` → `КШ`). Поэтому вопрос «что висит перед
 * проёмом» задаётся тому же признаку, которым ткань рисуется: завёл человек
 * свой тип с тюлевой моделью — он гасит пятно даром, а список кодов пришлось бы
 * править. Труба карниза плотная и в счёт не идёт — у неё `clear` нет.
 */
export function volumeSheerPlace(place) {
  if (!place) return false;
  if (place.repeat && volumeSheerParts(place.repeat.parts)) return true;
  return Boolean(place.model && volumeSheerParts(place.model.parts));
}

/**
 * Шторы схемы — те метки, которые **можно открыть и закрыть** (G332).
 *
 * Отбор один на две задачи: счёт пятна берёт отсюда ткань перед проёмом, а окно
 * — список для строки «Шторы: открыто N из M» и для ответа «а есть ли они
 * вообще». Второго отбора заводить нельзя: разойдись они — окно обещало бы
 * открыть штору, которую свет не спрашивает.
 *
 * Условие то же, что было внутри счёта: тюлевое тело модели (`volumeSheerPlace`)
 * **и** привязка к стене с габаритом — без стены и ширины связать её с проёмом
 * нечем.
 */
export function volumeSheerPlaces(places) {
  const out = [];
  for (const place of places || []) {
    if (!place || place.mode !== VOLUME_MARK_WALL || !place.wallId || !place.frame) continue;
    if (!volumeSheerPlace(place)) continue;
    out.push(place);
  }
  return out;
}

/**
 * Открыта ли эта штора. Список пустой или не дан — закрыты все (G301).
 *
 * **Отметка состояния, а не поле объекта** — ровно как у двери
 * (`volumeDoorOpen`, G207): открытые шторы живут экраном, в `project.json` о
 * них ни строки (G68). Открывание в этом таске не делается нарочно — слова
 * заказчика «потом сделаем их открытие», — но счёт пятна уже спрашивает
 * **состояние**, а не «штора есть»: включить открывание значит положить id
 * метки в это множество (`volumeScene(..., { openCurtainIds })`) и дать ему
 * клавишу в `panels/volume.js`, где уже лежит такое же множество дверей.
 * Переписывать счёт пятна для этого не придётся.
 */
/**
 * **Насколько открыта штора**, 0…1 (таск 09 сценариев, история 2.12): 0 —
 * закрыта, 1 — собрана у края, 0,5 — наполовину.
 *
 * Читатель терпимый, и в этом обещание «прежняя память открытых штор читается
 * как позиция»: список или множество id открытых штор (память показа G352,
 * `openCurtainIds`) значит «эти открыты на 100 %», а словарь `markId → доля` —
 * позиция дома. Мусор и отсутствие — закрыта.
 */
export function volumeCurtainShare(source, markId) {
  if (!source || !markId) return 0;
  if (source instanceof Map) {
    const share = Number(source.get(markId));
    return Number.isFinite(share) ? Math.max(0, Math.min(1, share)) : 0;
  }
  return volumeCurtainOpen(source, markId) ? 1 : 0;
}

/**
 * Какая доля ширины остаётся у открытой шторы: ткань собирается у края, а не
 * исчезает — 20 % ширины карниза при позиции 100.
 */
export const VOLUME_CURTAIN_BUNCH = 0.2;

/**
 * Ткань модели, собранная на долю `keep` ширины: к началу оси (`gather`
 * `"min"` — как до правки), к её концу (`"max"`) или к обоим краям (`"both"`:
 * полотнище, лежащее через середину, делится надвое).
 */
export function volumeCurtainParts(parts, keep, gather = "min") {
  let low = Infinity;
  let high = -Infinity;
  for (const part of parts) {
    if (!part || !part.clear) continue;
    low = Math.min(low, part.x);
    high = Math.max(high, part.x + part.width);
  }
  if (gather === "max") {
    return parts.map((part) => (part && part.clear ? { ...part, x: high - (high - part.x) * keep, width: part.width * keep } : part));
  }
  if (gather === "both") {
    const middle = (low + high) / 2;
    const out = [];
    for (const part of parts) {
      if (!part || !part.clear) {
        out.push(part);
        continue;
      }
      const leftEnd = Math.min(part.x + part.width, middle);
      const rightStart = Math.max(part.x, middle);
      if (leftEnd > part.x) out.push({ ...part, x: low + (part.x - low) * keep, width: (leftEnd - part.x) * keep });
      if (part.x + part.width > rightStart) {
        out.push({ ...part, name: part.name + "Right", x: high - (high - rightStart) * keep, width: (part.x + part.width - rightStart) * keep });
      }
    }
    return out;
  }
  return parts.map((part) => (part && part.clear ? { ...part, x: low + (part.x - low) * keep, width: part.width * keep } : part));
}

/**
 * К какому краю собирается ткань (правка после сборки сценариев, «Сторона
 * открывания»): `"min"` — к началу оси `u`, `"max"` — к концу, `"both"` — к
 * обоим. Без своей стороны — к началу, как до правки. Сторона — глазами из
 * комнаты: правая рука смотрящего на стену — `(n.y, −n.x)` (`markCurtainLegacySide`).
 */
export function volumeCurtainGather(place, u) {
  const side = place ? place.curtainSide : null;
  if (!side) return "min";
  if (side === "center") return "both";
  const normal = place.face && place.face.normal;
  const rightIsMax = normal && u ? u.x * normal.y + u.y * -normal.x > 0 : true;
  return (side === "right") === rightIsMax ? "max" : "min";
}

/** Полотнища вдоль пути, собранные к его концу, — то же, что к началу, только путь развёрнут. */
export function volumeCurtainFramesTo(frames, keep, gather) {
  if (gather === "max") {
    const back = frames
      .slice()
      .reverse()
      .map((frame) => ({ ...frame, u: { x: -frame.u.x, y: -frame.u.y } }));
    return volumeCurtainFrames(back, keep)
      .reverse()
      .map((frame, index) => ({ ...frame, u: frames[index].u }));
  }
  if (gather === "both" && frames.length > 1) {
    const half = Math.ceil(frames.length / 2);
    return [...volumeCurtainFrames(frames.slice(0, half), keep), ...volumeCurtainFramesTo(frames.slice(half), keep, "max")];
  }
  return volumeCurtainFrames(frames, keep);
}

/**
 * Полотнища повтора вдоль пути, собранные к его началу на долю `keep` длины.
 * Путь — цепочка середин полотнищ от начала пути: на изломе ткань едет по
 * изломной цепочке, а не срезает угол.
 */
function volumeCurtainFrames(frames, keep) {
  if (frames.length === 0) return frames;
  // Начало — край первого полотнища: он и остаётся на месте, к нему ткань и
  // собирается.
  const first = frames[0];
  const start = { x: first.at.x - first.u.x * (first.widthMm / 2), y: first.at.y - first.u.y * (first.widthMm / 2) };
  const chain = [start, ...frames.map((frame) => frame.at)];
  const along = [0];
  for (let index = 1; index < chain.length; index += 1) {
    along.push(along[index - 1] + Math.hypot(chain[index].x - chain[index - 1].x, chain[index].y - chain[index - 1].y));
  }
  const pointAt = (distance) => {
    for (let index = 1; index < chain.length; index += 1) {
      if (distance > along[index] && index < chain.length - 1) continue;
      const span = along[index] - along[index - 1];
      const t = span > 0 ? (distance - along[index - 1]) / span : 0;
      return {
        x: chain[index - 1].x + (chain[index].x - chain[index - 1].x) * t,
        y: chain[index - 1].y + (chain[index].y - chain[index - 1].y) * t,
      };
    }
    return chain[chain.length - 1];
  };
  return frames.map((frame, index) => ({ ...frame, at: pointAt(along[index + 1] * keep), widthMm: frame.widthMm * keep }));
}

export function volumeCurtainOpen(openCurtainIds, markId) {
  if (!openCurtainIds || !markId) return false;
  if (typeof openCurtainIds.has === "function") return openCurtainIds.has(markId);
  return Array.isArray(openCurtainIds) && openCurtainIds.includes(markId);
}

/**
 * Проёмы, через которые солнце может положить пятно, — **без часа**.
 *
 * Собирается вместе со сценой и живёт в ней (`scene.sunSpots`), потому что от
 * времени здесь не зависит ничего: ни геометрия проёма, ни сторона, где комната,
 * ни штора перед ним. Час добавляет только направление света
 * (`volumeSunSpotFaces`) — тот же раздел труда, что у тени дома (таск 181):
 * сцена держит габариты, час кладёт грани.
 *
 * **Штора связывается с проёмом по стене и перекрытию вдоль неё.** Правило:
 * штора гасит проём, если она висит на **той же стене** и закрывает **не меньше
 * половины** его ширины. Стену и отступы называет сама метка (`markWall`,
 * привязка к стене с `atMm`…`toMm`) — это данные, а не догадка о расстоянии, и
 * второго хозяина у вопроса «на какой стене висит метка» в сборке нет.
 * Сторона стены при этом **не спрашивается**: ткань, повешенная перед проёмом,
 * заслоняет его с любой стороны, а спроси я сторону — штора, размеченная с
 * улицы, пропускала бы солнце.
 *
 * Промахи правила названы прямо: штора на соседней стене того же окна (эркер,
 * размеченный одной линией по двум стенам) гасит только проёмы своей стены;
 * штора, задвинутая на треть окна, не гасит ничего; «половина» порога — число,
 * а не измерение света.
 *
 * **Закрытое глухое полотно света не пропускает** (дефект D69). До этого таска
 * полотно в счёт не шло вовсе: закрытая дверь пропускала пятно, как пустой
 * проём. Спрашивается здесь ровно то же, что у шторы, — **состояние**
 * (`openDoorIds`, G207), а не вид: закрытая глухая гасит, открытая пропускает.
 * Стекло спрашивается отметкой (`openingGlazed`, таск 215), а не видом: у
 * стеклянной двери вместо глухого полотна рама и стекло, и закрытой она светит
 * так же, как окно. «Есть ли полотно» спрашивает `openingOpens` — тот же
 * вопрос, по которому собран список дверей сцены, поэтому гаснут и ворота,
 * которых `openingHasLeaf` не считает.
 */
export function volumeSunOpenings(project, schemeId, rooms, places, heightOf, options = {}) {
  const openCurtainIds = options.openCurtainIds || null;
  const openDoorIds = options.openDoorIds || null;
  const spots = [];
  if (!rooms || rooms.length === 0) return spots;
  const walls = wallsOnScheme(project, schemeId);
  // Пятну нужен **пол**: в помещении без пола (двусветное пространство, таск
  // 209) лежать ему не на чем, и такая комната для света — та же улица. Светить
  // сквозь дыру в перекрытии сборка не умеет и не делает вид, что умеет: дыра
  // ведёт на **чужой этаж**, а этажи собираются порознь (таск 202) — см. разбор
  // у `volumeSunBeam`.
  //
  // Помещение без потолка (балкон, правка после сборки сценариев) для света —
  // тоже улица: окно гостиной на открытый балкон светит небом, как наружное.
  const roomAt = (point) =>
    rooms.find((room) => room.hasFloor !== false && room.hasCeiling !== false && volumePointInside(point, room.pointsMm)) ||
    null;
  // Тюль по стенам: отступы вдоль стены, посчитанные один раз на сцену.
  const sheers = [];
  for (const place of volumeSheerPlaces(places)) {
    if (volumeCurtainOpen(openCurtainIds, place.markId)) continue;
    sheers.push(place);
  }
  // Перекрытия шторами — по стене и **один раз на сцену**: их спрашивает и сам
  // проём, и проём на пути света (G332), а считать их дважды значило бы завести
  // второго хозяина порога `VOLUME_SHEER_SHARE`.
  const curtainsOf = new Map();
  for (const place of sheers) {
    const wall = walls.find((item) => item.id === place.wallId);
    const vectors = wall ? wallVectors(wall) : null;
    if (!vectors) continue;
    const middle =
      (place.frame.at.x - Number(wall.aMm.x)) * vectors.u.x + (place.frame.at.y - Number(wall.aMm.y)) * vectors.u.y;
    const reach = Math.max(0, Number(place.frame.widthMm) || 0) / 2;
    const list = curtainsOf.get(wall.id) || [];
    list.push({ markId: place.markId, fromMm: middle - reach, toMm: middle + reach });
    curtainsOf.set(wall.id, list);
  }
  /** Чья штора закрывает этот отступ стены, или `null`. Порог — половина ширины. */
  const sheerOver = (wallId, fromMm, toMm) => {
    const widthMm = toMm - fromMm;
    const found = (curtainsOf.get(wallId) || []).find(
      (curtain) => Math.min(curtain.toMm, toMm) - Math.max(curtain.fromMm, fromMm) >= widthMm * VOLUME_SHEER_SHARE,
    );
    return found ? found.markId : null;
  };
  // Что света не пропускает: закрытое глухое полотно (D69) или закрытая штора
  // перед проёмом (G301) — один ответ на оба места, где это спрашивают.
  const shutOf = (wall, opening, fromMm, toMm) =>
    volumeOpeningShut(opening, openDoorIds) || Boolean(sheerOver(wall.id, fromMm, toMm));
  // Помещение со стенами по рёбрам — **один раз на сцену и на помещение**: от
  // часа это не зависит, а свет спрашивает его на каждом пересчёте часа.
  const lights = new Map();
  const lightOf = (room, steps) => {
    if (!room) return null;
    const key = room.pointsMm;
    const held = lights.get(key);
    if (held && held.steps >= steps) return held.light;
    const light = volumeRoomLight(room, {
      walls,
      heightOf,
      openingsOf: (wall) => openingsInWall(project, wall.id),
      roomAt,
      shutOf,
      steps,
      lightOf,
    });
    lights.set(key, { steps, light });
    return light;
  };
  const lightAt = (point) => lightOf(roomAt(point), VOLUME_SUN_STEPS - 1);
  for (const wall of walls) {
    const vectors = wallVectors(wall);
    if (!vectors) continue;
    const openings = openingsInWall(project, wall.id);
    if (openings.length === 0) continue;
    const { u, n, len } = vectors;
    const half = Number(wall.thicknessMm) / 2;
    const heightMm = Number(heightOf ? heightOf(wall) : 0) || 0;
    const at = (alongMm, across) => ({
      x: Number(wall.aMm.x) + u.x * alongMm + n.x * across,
      y: Number(wall.aMm.y) + u.y * alongMm + n.y * across,
    });
    for (const opening of openings) {
      const fromMm = Math.max(0, Math.min(len, Number(opening.atMm)));
      const toMm = Math.max(fromMm, Math.min(len, fromMm + Number(opening.widthMm)));
      const bottomMm = Math.max(0, Number(opening.heightAboveFloorMm || 0));
      const topMm = heightMm > 0 ? Math.min(heightMm, bottomMm + Number(opening.heightMm)) : bottomMm + Number(opening.heightMm);
      if (!(toMm > fromMm) || !(topMm > bottomMm)) continue;
      const middleMm = (fromMm + toMm) / 2;
      // Штора считается закрывающей, когда перекрытие вдоль стены больше
      // половины ширины проёма.
      const covered = sheerOver(wall.id, fromMm, toMm);
      spots.push({
        openingId: opening.id || null,
        wallId: wall.id,
        aMm: { x: Number(wall.aMm.x), y: Number(wall.aMm.y) },
        u: { x: u.x, y: u.y },
        n: { x: n.x, y: n.y },
        halfMm: half,
        fromMm,
        toMm,
        bottomMm,
        topMm,
        // **Лицо проёма ломаной** (дефект D71): у прямоугольного верха четыре
        // точки, у арки — дуга. Считает его одно место на все поверхности
        // (`volumeOpeningFaceMm`), второго счёта дуги в сборке нет.
        faceMm: volumeOpeningFaceMm(opening, fromMm, toMm, bottomMm, topMm),
        // Помещения по обе стороны проёма: контур плюс стены по его рёбрам
        // (`volumeRoomLight`). `null` — улица.
        left: lightAt(at(middleMm, half + VOLUME_SUN_PROBE_MM)),
        right: lightAt(at(middleMm, -half - VOLUME_SUN_PROBE_MM)),
        sheerMarkId: covered,
        // Закрытое глухое полотно (дефект D69): пятна нет вовсе.
        shut: volumeOpeningShut(opening, openDoorIds),
      });
    }
  }
  return spots;
}

/**
 * Пересечение многоугольника с **выпуклым** многоугольником (обход
 * Сазерленда — Ходжмана, по одной полуплоскости на ребро отсечки).
 *
 * Режется контур помещения выпуклым параллелограммом пятна, а не наоборот, и
 * порядок здесь не вкус: алгоритм требует выпуклости **отсекающего**, а контур
 * помещения выпуклым не бывает — его обводят рукой, и Г-образная комната
 * обычное дело. Сторона «внутри» берётся у середины отсечки: у выпуклого
 * многоугольника она заведомо внутри, и обход контура — по часовой или
 * против — перестаёт значить что-либо.
 */
export function volumeClipPolygon(subject, clip) {
  if (!subject || subject.length < 3 || !clip || clip.length < 3) return [];
  let out = subject.map((point) => ({ x: point.x, y: point.y }));
  let cx = 0;
  let cy = 0;
  for (const point of clip) {
    cx += point.x;
    cy += point.y;
  }
  cx /= clip.length;
  cy /= clip.length;
  for (let index = 0; index < clip.length; index += 1) {
    const a = clip[index];
    const b = clip[(index + 1) % clip.length];
    const side = (point) => (b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x);
    const want = side({ x: cx, y: cy }) >= 0 ? 1 : -1;
    const inside = (point) => side(point) * want >= 0;
    const next = [];
    for (let at = 0; at < out.length; at += 1) {
      const here = out[at];
      const there = out[(at + 1) % out.length];
      const hereIn = inside(here);
      const thereIn = inside(there);
      if (hereIn) next.push(here);
      if (hereIn !== thereIn) {
        const from = side(here);
        const to = side(there);
        const share = from / (from - to);
        next.push({ x: here.x + (there.x - here.x) * share, y: here.y + (there.y - here.y) * share });
      }
    }
    out = next;
    if (out.length < 3) return [];
  }
  return out;
}

/**
 * **Сколько шагов делает свет** — два (G332). Слова заказчика: «он должен
 * проходить через окна с открытыми шторами и через проёмы в другие комнаты».
 *
 * Шаг первый — снаружи в комнату через её собственный проём (таск 196). Шаг
 * второй — из этой комнаты в соседнюю через проём, на который легло её пятно:
 * **проём со светом сам становится источником**. Рекурсии нет нарочно, и это
 * не лень: каждый шаг множит число пятен на число проёмов комнаты, а польза
 * падает — свет, дошедший до третьей комнаты, не отличить от общего полумрака.
 * Два шага — это «вижу, что соседняя комната подсвечена оттого, что солнце
 * бьёт в эту», то есть ровно то, о чём просил заказчик.
 *
 * Число названо константой, а не вписано в обход: вырасти ему придётся вместе
 * с глубиной `volumeRoomLight`, и оба места читают одно и то же.
 */
export const VOLUME_SUN_STEPS = 2;

/**
 * **Закрытое глухое полотно света не пропускает** (дефект D69).
 *
 * Один вопрос на два места: сам проём, в который светит солнце, и проём на пути
 * второго шага (G332). Три правила в одной строке, и каждое — чужое, уже
 * существующее:
 *
 *   `openingOpens`  — есть ли полотно вообще (таск 219). У окна, арки и пустого
 *                     проёма его нет, и гасить нечему; у ворот есть, хотя
 *                     `openingHasLeaf` отвечает про них «нет» — поэтому
 *                     спрашивается именно `openingOpens`, тот же вопрос, по
 *                     которому собран список дверей сцены;
 *   `openingGlazed` — **отметка**, а не вид (таск 215): у стеклянной двери
 *                     вместо глухого полотна рама и стекло, и закрытой она
 *                     светит, как окно. Сравнивать вид с `glassDoor` нельзя —
 *                     новая разметка пишет породу плюс отметку;
 *   `volumeDoorOpen`— **состояние**, живущее в сеансе окна (G207, G68): открыл
 *                     дверь — пятно вернулось, и в объект не записано ничего.
 */
export function volumeOpeningShut(opening, openDoorIds) {
  if (!opening || !openingOpens(opening.kind)) return false;
  if (openingGlazed(opening)) return false;
  return !volumeDoorOpen(openDoorIds, opening.id);
}

/**
 * **Помещение глазами света**: контур плюс то, что стоит по его рёбрам.
 *
 * Зачем это понадобилось: до таска свет знал о комнате только контур и клал
 * пятно на пол (таск 196). Пятну, уехавшему за дальнюю стену, нужна **сама
 * стена** (дефект D70), а второму шагу (G332) — **проём** в ней и комната за
 * ним. И то и другое от часа не зависит, поэтому считается здесь, вместе со
 * сценой, а не в пересчёте часа.
 *
 * На каждое ребро контура — `null` или запись:
 *
 *   `offMm`  — на сколько грань стены отстоит от прямой ребра наружу. Контур
 *              обводят рукой, и совпадать с гранью стены он не обязан: пятно
 *              ложится на **настоящую** грань, иначе оно висело бы в воздухе
 *              или уходило внутрь стены — порядок граней решают плоскости
 *              (таск 211), и промах в сантиметр спрятал бы пятно целиком;
 *   `tiles`  — сплошные куски лица стены, выпуклыми многоугольниками в
 *              координатах ребра (`volumeWallTiles`, те же, которыми стена
 *              нарисована): пятно живёт только на них, и потому не ложится ни
 *              на окно напротив, ни в дверной проём;
 *   `holes`  — проёмы этой стены: через них свет идёт дальше (`beyond` —
 *              помещение за стеной, `shut` — полотно или штора на пути).
 *
 * **Стена вдоль ребра ищется, а не берётся по привязке**: у помещения стены нет
 * вовсе (ADR 008, `volumeRooms` берёт контуры). Условие — ось стены
 * сонаправлена ребру с точностью `VOLUME_WALL_SAME_DEG` (та же мерка, которой
 * таск 214 решает «та же стена») и её ближняя грань отстоит от ребра не дальше
 * `VOLUME_FLOOR_LAP` — того самого напуска, которым пол подкладывают под стену
 * ради той же ручной обводки. Из двух граней берётся ближняя: контур, обведённый
 * чуть внутри стены, и контур, обведённый чуть внутри комнаты, — одна и та же
 * ошибка руки с разным знаком.
 *
 * Цена названа прямо: ребро, вдоль которого стены нет (широкий проход между
 * комнатами, обведёнными порознь), света не держит — пятно там кончается, а не
 * повисает в воздухе простынёй. Длинное ребро, у которого стена стоит только
 * частью, держит свет на своей части: `tiles` считаются у той стены, которая
 * нашлась, и дальше её конца их нет.
 */
export function volumeRoomLight(room, options = {}) {
  const points = room && room.pointsMm ? room.pointsMm : null;
  if (!points || points.length < 3) return null;
  const { walls, heightOf, openingsOf, roomAt, shutOf, lightOf } = options;
  const steps = Math.max(0, Number(options.steps) || 0);
  const limit = Math.cos(VOLUME_WALL_SAME_DEG * DEG);
  const edges = [];
  for (let index = 0; index < points.length; index += 1) {
    const a = points[index];
    const b = points[(index + 1) % points.length];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (!(len > 0)) {
      edges.push(null);
      continue;
    }
    const e = { x: dx / len, y: dy / len };
    // Наружная нормаль ребра — «левая»: обход контура приведён к часовому на
    // экране (`volumeClockwise`), и это то же соглашение, по которому смотрят
    // наружу боковые грани призмы.
    const m = { x: dy / len, y: -dx / len };
    let found = null;
    for (const wall of walls || []) {
      const vectors = wallVectors(wall);
      if (!vectors) continue;
      if (Math.abs(vectors.u.x * e.x + vectors.u.y * e.y) < limit) continue;
      const half = Number(wall.thicknessMm) / 2;
      const axis = (Number(wall.aMm.x) - a.x) * m.x + (Number(wall.aMm.y) - a.y) * m.y;
      // **Прямая ребра обязана идти по телу стены** (плюс напуск по краям). Это
      // мерка `volumeWallCovers` «та же стена», только про одну стену и ребро, и
      // она терпит ровно то, что человек делает рукой: обводит то по внутренней
      // грани, то по оси стены. На объекте заказчика по осям обведено 17 рёбер
      // из 80 — у стены 250 мм это промах в 125, и порог в один напуск пола их
      // всех отбрасывал.
      if (Math.abs(axis) > half + VOLUME_FLOOR_LAP) continue;
      // Стена должна стоять **вдоль этого ребра**, а не в другом конце дома:
      // отступы её концов, снесённые на ребро, обязаны его перекрывать.
      const from = (Number(wall.aMm.x) - a.x) * e.x + (Number(wall.aMm.y) - a.y) * e.y;
      const to = from + vectors.len * vectorsAlong(vectors.u, e);
      if (Math.min(Math.max(from, to), len) - Math.max(Math.min(from, to), 0) <= 1) continue;
      if (found && Math.abs(axis) >= Math.abs(found.axisMm)) continue;
      // Грань, которой стена смотрит **в это помещение**: она лежит со стороны
      // внутренней нормали ребра, а не та, что просто ближе. Контур, обведённый
      // по оси, и контур, обведённый по дальней грани, дают одну и ту же стену и
      // одну и ту же её поверхность — настоящую.
      found = { offMm: axis - half, axisMm: axis, wall, vectors, half };
    }
    if (!found) {
      edges.push(null);
      continue;
    }
    const wall = found.wall;
    const heightMm = Number(heightOf ? heightOf(wall) : 0) || 0;
    const openings = openingsOf ? openingsOf(wall) : [];
    // Перевод отступа вдоль **стены** в отступ вдоль **ребра**: стену могли
    // чертить в другую сторону, и тогда отступы идут навстречу.
    const base = (Number(wall.aMm.x) - a.x) * e.x + (Number(wall.aMm.y) - a.y) * e.y;
    const flip = vectorsAlong(found.vectors.u, e);
    const wAt = (alongWall) => base + alongWall * flip;
    const tiles = [];
    for (const tile of volumeWallTiles(found.vectors.len, heightMm, openings)) {
      const bottomFrom = tile.bottomFromMm == null ? tile.bottomMm : tile.bottomFromMm;
      const bottomTo = tile.bottomToMm == null ? tile.bottomMm : tile.bottomToMm;
      tiles.push([
        { wMm: wAt(tile.fromMm), hMm: bottomFrom },
        { wMm: wAt(tile.toMm), hMm: bottomTo },
        { wMm: wAt(tile.toMm), hMm: tile.topMm },
        { wMm: wAt(tile.fromMm), hMm: tile.topMm },
      ]);
    }
    const holes = [];
    if (steps > 0) {
      for (const opening of openings) {
        const fromMm = Math.max(0, Math.min(found.vectors.len, Number(opening.atMm)));
        const toMm = Math.max(fromMm, Math.min(found.vectors.len, fromMm + Number(opening.widthMm)));
        const bottomMm = Math.max(0, Number(opening.heightAboveFloorMm || 0));
        const topMm =
          heightMm > 0 ? Math.min(heightMm, bottomMm + Number(opening.heightMm)) : bottomMm + Number(opening.heightMm);
        if (!(toMm > fromMm) || !(topMm > bottomMm)) continue;
        // Комната **за стеной** — тем же щупом, которым солнце выясняет, с
        // какой стороны проёма улица (`VOLUME_SUN_PROBE_MM`): второго числа для
        // этого не заведено.
        const side = found.vectors.n.x * m.x + found.vectors.n.y * m.y >= 0 ? 1 : -1;
        const middle = (fromMm + toMm) / 2;
        const probe = {
          x: Number(wall.aMm.x) + found.vectors.u.x * middle + found.vectors.n.x * side * (found.half + VOLUME_SUN_PROBE_MM),
          y: Number(wall.aMm.y) + found.vectors.u.y * middle + found.vectors.n.y * side * (found.half + VOLUME_SUN_PROBE_MM),
        };
        const beyondRoom = roomAt ? roomAt(probe) : null;
        if (!beyondRoom || beyondRoom.pointsMm === points) continue;
        const beyond = lightOf ? lightOf(beyondRoom, steps - 1) : null;
        if (!beyond) continue;
        holes.push({
          openingId: opening.id || null,
          shut: shutOf ? Boolean(shutOf(wall, opening, fromMm, toMm)) : false,
          // Лицо проёма — то же, что у источника: у арки свет идёт сквозь дугу,
          // а не сквозь прямоугольник (дефект D71).
          faceMm: volumeOpeningFaceMm(opening, fromMm, toMm, bottomMm, topMm).map((point) => ({
            wMm: wAt(point.alongMm),
            hMm: point.zMm,
          })),
          beyond,
        });
      }
    }
    // Краска стороны, которой стена смотрит в это помещение (покраска): пятно
    // на ней светлеет из её цвета. Наружу — `m`, внутрь — против него.
    const inner = found.vectors.n.x * m.x + found.vectors.n.y * m.y >= 0 ? -1 : 1;
    edges.push({ offMm: found.offMm, tiles, holes, rgb: volumeWallPaintRgb(wall, inner) });
  }
  // Краска пола помещения (покраска): пятно на полу — из неё.
  return { pointsMm: points, edges, floorRgb: room.floorRgb || null };
}

/**
 * Перенос помещения света на сдвиг привязки (таск 205): в стопке этажей чужой
 * этаж стоит в своих координатах, и свет обязан переехать вместе с ним.
 *
 * Переносится **только контур**: отступы кусков стены и просветов считаны вдоль
 * ребра, а смещение грани — поперёк, и от переноса ни одно из этих чисел не
 * меняется. Комната за проёмом переезжает тем же счётом — второй шаг света
 * (G332) живёт на том же этаже, что первый.
 */
export function volumeShiftRoomLight(light, shiftMm) {
  if (!light) return null;
  if (!shiftMm || (!shiftMm.x && !shiftMm.y)) return light;
  return {
    ...light,
    pointsMm: volumeShiftPoints(light.pointsMm, shiftMm),
    edges: (light.edges || []).map((edge) => {
      if (!edge) return null;
      if (edge.holes.length === 0) return edge;
      return {
        ...edge,
        holes: edge.holes.map((hole) => ({ ...hole, beyond: volumeShiftRoomLight(hole.beyond, shiftMm) })),
      };
    }),
  };
}

/** Навстречу ли идут два единичных направления: `1` или `−1`. */
function vectorsAlong(u, e) {
  return u.x * e.x + u.y * e.y >= 0 ? 1 : -1;
}

/**
 * Грани солнечных пятен в этот час (таск 196).
 *
 * `spots` — проёмы сцены (`scene.sunSpots`), `shadow` — где стоит солнце и
 * насколько свет виден (`mood.shadow`, та же тройка, которой гаснет наружная
 * тень). Хозяин у света и у тени один нарочно: разойдись они, пятно на полу
 * легло бы не в ту сторону, в которую уходит тень дома за окном.
 *
 * **Солнце зашло — пятен нет**: `fade` ноль, и счёт не начинается. В сумерках
 * пятно гаснет тем же `fade`, что тень. Ночью его не даёт и луна: света у неё
 * для этого нет, и обещать его честнее не обещать.
 *
 * **Ярус у пятна свой** (`VOLUME_LAYER_SUN`): пятно лежит выше пола своей
 * комнаты и ниже всего, что в комнате стоит. Числа — те же, что стоили дефекта
 * D49: пятно и пол **коплоскостны** (оба на нулевой отметке, и у пятна нет даже
 * миллиметра подъёма, которым вещь стоит перед стеной), то есть дальность их
 * середин решала бы спор от часа к часу — пятно уходит от стены в комнату и
 * оказывается то ближе пола, то дальше. Ярусом же порядок задан правилом:
 *
 *   пол (2) → пятно (3) → тела (4) → указатель (5),
 *
 * и из этого прямо следуют два ответа, которых пришлось бы искать отдельно:
 * **метка на полу** (тело яруса 4, поднятое на `VOLUME_MARK_LIFT_MM`) рисуется
 * поверх пятна и остаётся видна; **вещь чертежа** (диван, шкаф) тоже, то есть
 * пятно под ней не просвечивает — свет кончается у того, что стоит на полу.
 * Полупрозрачная вещь (таск 169) смешивается с пятном, как смешивалась с полом.
 *
 * **Пятно обрезано контуром своей комнаты** (`volumeClipPolygon`). Без обрезки
 * закатное пятно уезжает сквозь стены на десятки метров: при высоте солнца 5°
 * окно с верхом 2,2 м даёт вынос 25 м, то есть через всю квартиру и наружу.
 *
 * **Пятно ложится и на стену** (дефект D70). Обрезка от этого не ослабла, а
 * наоборот: уехавшая за контур часть пятна не выбрасывается, а поднимается по
 * той стене, на которую свет и попадает. Разбор — у `volumeSunBeam`.
 */
export function volumeSunSpotFaces(spots, shadow, out = [], moon = null) {
  const fade = shadow ? Math.max(0, Math.min(1, Number(shadow.fade))) : 0;
  if (!spots || spots.length === 0 || !(fade > 0)) return out;
  const rise = Number(shadow.rise);
  if (!Number.isFinite(rise) || !(rise > 0)) return out;
  // Вынос на миллиметр высоты: `1 / tg(высота солнца)`. Высота снизу не
  // подпирается (в отличие от тени дома, которой нужна земляная плита под ней):
  // пятно обрезано комнатой, и длина ему не страшна — у `fade` ноль наступает
  // раньше, чем `tg` уходит в ноль.
  const reach = 1 / Math.tan(rise * DEG);
  const away = ((Number(shadow.az) || 0) + 180) * DEG;
  // Куда идёт свет: ровно прочь от солнца, той же мерой, которой уходит тень
  // (`volumeShadowShift`). Сторона света чертежа здесь уже учтена — `az`
  // приходит повёрнутым на `topAzimuthDeg` (G288, `volumeSunAt`).
  const dir = { x: Math.cos(away), y: Math.sin(away) };
  for (const spot of spots) {
    // Закрытая штора гасит пятно своего проёма целиком (G301), закрытое глухое
    // полотно — тоже (дефект D69). Оба ответа посчитаны вместе со сценой: от
    // часа они не зависят, а спрашиваются на каждом его пересчёте.
    if (spot.sheerMarkId || spot.shut) continue;
    const into = spot.n.x * dir.x + spot.n.y * dir.y;
    // Свет идёт вдоль стены: пятну негде лежать, и считать нечего.
    if (!(Math.abs(into) > 1e-6)) continue;
    const sign = into > 0 ? 1 : -1;
    const room = sign > 0 ? spot.left : spot.right;
    const sunny = sign > 0 ? spot.right : spot.left;
    // Принимающая сторона — комната, солнечная — улица. Разбор — выше.
    if (!room || sunny) continue;
    // Луч считается от **внутренней грани** стены (`halfMm` в сторону комнаты):
    // пятно начинается там, где свет входит в комнату, а не в середине стены.
    volumeSunBeam(
      spot.faceMm,
      room,
      {
        origin: {
          x: spot.aMm.x + spot.n.x * spot.halfMm * sign,
          y: spot.aMm.y + spot.n.y * spot.halfMm * sign,
        },
        u: spot.u,
        dir,
        reach,
        fade,
        // `spot.baseMm` — пол **своего этажа** (таск 202). У одной схемы это
        // ноль; в стопке пятно обязано лежать на том полу, через чьё окно
        // вошло, и рисоваться раньше перекрытия этажа выше — иначе оно легло бы
        // светлым пятном на крышу.
        baseMm: Number(spot.baseMm) || 0,
        // Пятно луны (`volumeMoonSpotFaces`): своя сила и комната грани.
        moon,
      },
      // Вход первого шага — сама плоскость проёма: дальше луча считать от неё.
      { t0: 0, t1: 0 },
      VOLUME_SUN_STEPS - 1,
      out,
    );
  }
  return out;
}

/** Режет луч-многоугольник полуплоскостью: `f` ≥ 0 — оставить. `f` обязана быть линейной. */
function volumeSunClipHalf(points, f) {
  const out = [];
  for (let index = 0; index < points.length; index += 1) {
    const here = points[index];
    const there = points[(index + 1) % points.length];
    const a = f(here);
    const b = f(there);
    if (a >= 0) out.push(here);
    if (a < 0 !== b < 0) {
      const share = a / (a - b);
      out.push({
        alongMm: here.alongMm + (there.alongMm - here.alongMm) * share,
        zMm: here.zMm + (there.zMm - here.zMm) * share,
      });
    }
  }
  return out.length >= 3 ? out : [];
}

/**
 * Режет луч-многоугольник выпуклым куском **лица стены** (`shape` в
 * `{wMm, hMm}`), переводя каждую точку луча в лицо данным `faceAt`.
 *
 * Сторона «внутри» берётся у середины куска — тот же приём, что в
 * `volumeClipPolygon`: обход куска по часовой или против перестаёт значить
 * что-либо. Перевод луча в лицо **линеен** (см. `volumeSunBeam`), поэтому
 * прямая режется прямой и доля считается по одному отношению.
 */
function volumeSunFaceClip(points, shape, faceAt) {
  if (points.length < 3 || !shape || shape.length < 3) return [];
  let cw = 0;
  let ch = 0;
  for (const point of shape) {
    cw += point.wMm;
    ch += point.hMm;
  }
  cw /= shape.length;
  ch /= shape.length;
  let out = points;
  for (let index = 0; index < shape.length; index += 1) {
    const a = shape[index];
    const b = shape[(index + 1) % shape.length];
    const side = (wMm, hMm) => (b.wMm - a.wMm) * (hMm - a.hMm) - (b.hMm - a.hMm) * (wMm - a.wMm);
    const want = side(cw, ch) >= 0 ? 1 : -1;
    out = volumeSunClipHalf(out, (point) => {
      const face = faceAt(point);
      return side(face.wMm, face.hMm) * want;
    });
    if (out.length < 3) return [];
  }
  return out;
}

/** Площадь луч-многоугольника в мм² просвета: ею отсекаются вырожденные куски. */
function volumeSunArea(points) {
  let sum = 0;
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    sum += points[j].alongMm * points[i].zMm - points[i].alongMm * points[j].zMm;
  }
  return Math.abs(sum) / 2;
}

/** Чем пятно меньше, тем меньше смысла в грани: половина квадратного сантиметра. */
const VOLUME_SUN_MIN_MM2 = 50;

/**
 * **Пучок света, прошедший через проём, — один шаг.**
 *
 * Считается он не в плане и не в трёх осях, а **в самом просвете**: точка пучка
 * — это `{alongMm, zMm}`, то есть «через какое место проёма прошёл луч». Все
 * лучи пучка идут в одну сторону, поэтому место попадания — линейная функция
 * этой пары, и из одного этого факта выходит весь обход:
 *
 *   — **на полу** луч `(a, z)` лежит в `origin + u·a + dir·z·reach`: падение
 *     `1/reach` на миллиметр хода, значит высоты `z` хватает ровно на `z·reach`
 *     хода. Это та же формула, которой пятно считалось с таска 196, — в
 *     прежнем виде она и осталась, только лицо проёма теперь ломаная
 *     (`volumeOpeningFaceMm`), а не четыре угла: у арки свет идёт сквозь дугу;
 *   — **ребро контура** `k` луч пересекает на ходу `τ_k(a) = t0 + t1·a` —
 *     линейно по `a`, потому что ребро прямое, а ход у всех лучей один;
 *   — **высота попадания** в стену — `z − τ_k(a)/reach`, тоже линейная. Больше
 *     нуля — луч встретил стену раньше пола; меньше — успел лечь на пол.
 *
 * Отсюда **дефект D70 лечится без второго правила**: пятно, уехавшее за дальнюю
 * стену, не выбрасывается, а поднимается по ней на ту самую высоту. Окно 800 мм
 * при 6° даёт вынос 7,6 м — в комнате 2,8 м на пол не попадает **ничего**, и до
 * этого таска пятна не было вовсе; теперь оно стоит на дальней стене от 506 до
 * 1806 мм. Обрезка комнатой при этом не ослабла: пол режется её контуром, как
 * резался, а стена — только сплошными кусками своего лица (`tiles`), поэтому
 * пятно не ложится ни на окно напротив, ни в проём.
 *
 * **Через какое ребро луч выходит, решает только `a`** — и это не упрощение, а
 * свойство: в плане все лучи с одним `a` идут по одной и той же прямой, и
 * различаются лишь тем, когда кончится высота. Поэтому просвет делится по `a`
 * на участки с общим ребром выхода: границы участков — те `a`, где два ребра
 * меняются местами или где точка выхода доходит до конца ребра (всё это корни
 * линейных уравнений, считать нечего). Внутри участка ребро спрашивается один
 * раз — настоящим обходом по контуру.
 *
 * **Второй шаг** (G332): луч, попавший не в сплошной кусок стены, а в её проём,
 * идёт дальше — тем же пучком, с тем же `origin` и той же `dir`, только
 * просветом ему становится лицо того проёма, а комнатой — комната за ним.
 * Рекурсии нет: `steps` убывает, и у второго шага проёмов в описании комнаты
 * уже нет вовсе (`volumeRoomLight` строит их на один шаг). Дверь на пути
 * подчиняется тому же правилу, что дверь-источник (`volumeOpeningShut`): глухая
 * закрытая не пропускает, открытая и стеклянная пропускают.
 *
 * **Дыра двусвета (снятый пол) светом не работает, и это не недоделка.** Второй
 * шаг идёт через проём в **стене своей схемы**, а дыра в перекрытии ведёт на
 * чужой этаж: этажи собираются порознь (`volumeStackScene`, таск 202), у каждого
 * свои контуры и свой `baseMm`, и ни один не видит помещений соседа. Пучок
 * пришлось бы передавать из сцены в сцену — это уже не «ещё один проём», а
 * новый хозяин у геометрии этажей.
 */
function volumeSunBeam(faceMm, room, ctx, entry, steps, out) {
  if (!faceMm || faceMm.length < 3 || !room || !room.pointsMm) return out;
  const { origin, u, dir, reach, fade, baseMm, moon } = ctx;
  const points = room.pointsMm;
  // ——— пол: та же обрезка контуром, что с таска 196 ———
  const floor = volumeClipPolygon(
    points,
    faceMm.map((point) => ({
      x: origin.x + u.x * point.alongMm + dir.x * point.zMm * reach,
      y: origin.y + u.y * point.alongMm + dir.y * point.zMm * reach,
    })),
  );
  if (floor.length >= 3) {
    out.push(
      // **Ярус у пятна телесный** (таск 211): оно лежит на полу, а пол с того
      // таска выкладывает дерево. Оставь пятну прежний ярус — и пол, рисуясь
      // после него, закрасил бы его целиком. Место в очереди пятну считает то
      // же дерево (`volumeOrderRank`): грань пятна коплоскостна полу, и обход
      // ставит её сразу за ним, а тело, стоящее на этом полу, — после неё.
      moon
        ? volumeMoonFace(floor.map((point) => volumeAt(point, baseMm)), room.floorRgb || VOLUME_FLOOR_RGB, { x: 0, y: 0, z: 1 }, room, moon)
        : volumeFace(floor.map((point) => volumeAt(point, baseMm)), volumeSunSpotRgb(fade, room.floorRgb || VOLUME_FLOOR_RGB), {
            normal: { x: 0, y: 0, z: 1 },
            flat: true,
          }),
    );
  }
  if (!room.edges) return out;
  // ——— рёбра, через которые пучок может выйти ———
  const edges = [];
  for (let index = 0; index < points.length; index += 1) {
    const a = points[index];
    const b = points[(index + 1) % points.length];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (!(len > 0)) continue;
    const e = { x: dx / len, y: dy / len };
    const m = { x: dy / len, y: -dx / len };
    const dot = dir.x * m.x + dir.y * m.y;
    // Наружу луч через это ребро не идёт: выйти через него нельзя.
    if (!(dot > 1e-9)) continue;
    const t0 = ((a.x - origin.x) * m.x + (a.y - origin.y) * m.y) / dot;
    const t1 = -(u.x * m.x + u.y * m.y) / dot;
    const dirE = dir.x * e.x + dir.y * e.y;
    edges.push({
      index,
      a,
      e,
      m,
      len,
      t0,
      t1,
      // Куда вдоль ребра попадает луч — тоже линейно по `a`.
      w0: (origin.x - a.x) * e.x + (origin.y - a.y) * e.y + t0 * dirE,
      w1: u.x * e.x + u.y * e.y + t1 * dirE,
      wall: room.edges[index] || null,
    });
  }
  if (edges.length === 0) return out;
  let minA = Infinity;
  let maxA = -Infinity;
  for (const point of faceMm) {
    minA = Math.min(minA, point.alongMm);
    maxA = Math.max(maxA, point.alongMm);
  }
  // ——— границы участков: корни линейных уравнений, и ничего больше ———
  const cuts = [minA, maxA];
  const edge = 1e-6;
  const addCut = (value) => {
    if (Number.isFinite(value) && value > minA + edge && value < maxA - edge) cuts.push(value);
  };
  for (let i = 0; i < edges.length; i += 1) {
    const one = edges[i];
    if (one.t1 !== 0) addCut(-one.t0 / one.t1);
    if (one.w1 !== 0) {
      addCut(-one.w0 / one.w1);
      addCut((one.len - one.w0) / one.w1);
    }
    if (one.t1 !== entry.t1) addCut((entry.t0 - one.t0) / (one.t1 - entry.t1));
    for (let j = i + 1; j < edges.length; j += 1) {
      const two = edges[j];
      if (one.t1 !== two.t1) addCut((two.t0 - one.t0) / (one.t1 - two.t1));
    }
  }
  cuts.sort((one, two) => one - two);
  /** Через какое ребро выходит луч `a`: первое по ходу, считая от входа. */
  const exitAt = (alongMm) => {
    let best = null;
    for (const one of edges) {
      const t = one.t0 + one.t1 * alongMm;
      if (!(t > entry.t0 + entry.t1 * alongMm)) continue;
      const w = one.w0 + one.w1 * alongMm;
      if (w < 0 || w > one.len) continue;
      if (!best || t < best.t) best = { one, t };
    }
    return best ? best.one : null;
  };
  // ——— участки: соседние с одним ребром выхода сливаются ———
  const runs = [];
  for (let index = 0; index < cuts.length - 1; index += 1) {
    const from = cuts[index];
    const to = cuts[index + 1];
    if (!(to - from > edge)) continue;
    const found = exitAt((from + to) / 2);
    if (!found) continue;
    const last = runs[runs.length - 1];
    if (last && last.edge === found && Math.abs(last.toMm - from) < edge) {
      last.toMm = to;
      continue;
    }
    runs.push({ edge: found, fromMm: from, toMm: to });
  }
  for (const run of runs) {
    const one = run.edge;
    if (!one.wall) continue;
    // Перевод точки пучка в лицо стены: вдоль ребра и по высоте. Обе линейны.
    const faceAt = (point) => {
      const t = one.t0 + one.t1 * point.alongMm;
      return { wMm: one.w0 + one.w1 * point.alongMm, hMm: point.zMm - t / reach };
    };
    let beam = faceMm.map((point) => ({ alongMm: point.alongMm, zMm: point.zMm }));
    beam = volumeSunClipHalf(beam, (point) => point.alongMm - run.fromMm);
    beam = volumeSunClipHalf(beam, (point) => run.toMm - point.alongMm);
    // Луч дошёл до стены раньше пола: высота попадания больше нуля.
    beam = volumeSunClipHalf(beam, (point) => faceAt(point).hMm);
    if (beam.length < 3) continue;
    const inside = { x: -one.m.x, y: -one.m.y, z: 0 };
    // Грань стены стоит там, где она **стоит**, а не где её обвели рукой.
    const offX = one.m.x * one.wall.offMm;
    const offY = one.m.y * one.wall.offMm;
    const spotAt = (point) => {
      const t = one.t0 + one.t1 * point.alongMm;
      return {
        x: origin.x + u.x * point.alongMm + dir.x * t + offX,
        y: origin.y + u.y * point.alongMm + dir.y * t + offY,
        z: baseMm + point.zMm - t / reach,
      };
    };
    // Пятно на сплошных куках лица — цвет и мера те же, что у напольного:
    // своя краска грани при светлоте 1 (`volumeSunSpotRgb`).
    const paint = one.wall.rgb || VOLUME_WALL_RGB;
    const rgb = volumeSunSpotRgb(fade, paint, volumeShade(inside));
    for (const tile of one.wall.tiles) {
      const patch = volumeSunFaceClip(beam, tile, faceAt);
      if (patch.length < 3 || volumeSunArea(patch) < VOLUME_SUN_MIN_MM2) continue;
      out.push(
        moon
          ? volumeMoonFace(patch.map(spotAt), paint, inside, room, moon)
          : volumeFace(patch.map(spotAt), rgb, { normal: inside, flat: true }),
      );
    }
    if (steps <= 0) continue;
    // Второй шаг: что попало в проём, идёт дальше тем же пучком.
    for (const hole of one.wall.holes) {
      if (hole.shut || !hole.beyond) continue;
      const through = volumeSunFaceClip(beam, hole.faceMm, faceAt);
      if (through.length < 3 || volumeSunArea(through) < VOLUME_SUN_MIN_MM2) continue;
      volumeSunBeam(through, hole.beyond, ctx, { t0: one.t0, t1: one.t1 }, steps - 1, out);
    }
  }
  return out;
}

// ——— пятно луны (правка после сборки сценариев) ————————————————————————————
//
// Слова заказчика: «От луны должно быть тоже освещение, но слабое, и чем
// полнее луна, тем сильнее, ну и белым светом». До правки луна пятен не давала
// («света у неё для этого нет»); при физическом свете даёт — тем же пучком, что
// солнце (`volumeSunBeam`), только краска другая: не пол, поднятый до светлоты
// единицы, а та же грань в тоне своей комнаты, с которой луна снимает часть тьмы
// и тянет её к белому (`volumeMoonTint`). Так пятно луны на полу комнаты, где
// горит свет, почти не видно — как и в жизни.

/** Сила пятна полной луны в зените: доля тьмы, которую она снимает. */
export const VOLUME_MOON_SPOT = 0.6;
/** Белый свет луны и доля, на которую пятно тянет к нему грань. */
export const VOLUME_MOON_LIGHT_RGB = [226, 230, 238];
const VOLUME_MOON_GLOW = 0.08;

/** Грань пятна луны: сама поверхность, её комната и сила луны. */
function volumeMoonFace(points, rgb, normal, room, moon) {
  const face = volumeFace(points, rgb, { normal, room: moon.keyOf ? moon.keyOf(room) : null });
  face.moon = moon.strength;
  return face;
}

/**
 * Грани пятен луны в этот час. `moonLight` — `{az, rise, fade}` из снимка часа
 * (`volumeMood`): `fade` — освещённая доля диска на то, насколько луна видна и
 * высоко ли стоит. Новолуние пятен не даёт, полнолуние — самые яркие.
 * `rooms` — помещения сцены: по ним пятно узнаёт свою комнату.
 */
export function volumeMoonSpotFaces(spots, moonLight, rooms, out = []) {
  const strength = moonLight ? volumeShare01(moonLight.fade) * VOLUME_MOON_SPOT : 0;
  if (!(strength > 0.01)) return out;
  const byPoints = new Map();
  for (const room of rooms || []) if (room && room.pointsMm) byPoints.set(room.pointsMm, volumeRoomKey(room));
  const keyOf = (room) => (room && byPoints.get(room.pointsMm)) || null;
  return volumeSunSpotFaces(spots, { az: moonLight.az, rise: moonLight.rise, fade: 1 }, out, { strength, keyOf });
}

/**
 * Тон грани под луной: тьма меньше на силу луны, и к белому — чуть-чуть.
 * Смесь двух целей — одна цель с суммой долей, как у лампы (`volumeRoomTint`).
 */
export function volumeMoonTint(tint, strength) {
  const share = tint ? volumeShare01(tint.share) : 0;
  const moon = volumeShare01(strength);
  if (!(moon > 0)) return tint;
  const dark = share * (1 - moon);
  const glow = VOLUME_MOON_GLOW * moon;
  return { rgb: volumeMix((tint && tint.rgb) || VOLUME_NIGHT_RGB, VOLUME_MOON_LIGHT_RGB, glow / (dark + glow)), share: dark + glow };
}
