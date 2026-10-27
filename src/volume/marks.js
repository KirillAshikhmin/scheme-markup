// «Объём»: метки и модели — тела меток по габаритам и моделям `objectModels`,
// место на стене и потолке, выделение и связи.
//
// Часть «Объёма», вынесенная из `src/volume.js` (2026-10-25) переносом без
// переименований: снаружи модуль читают через дверь `volume.js`, а соседи по
// `src/volume/` — напрямую. Зависимости идут только вниз по слоям (порядок —
// в шапке `volume.js`), циклов нет. Решения и доводы — в шапках разделов ниже.
import { MARK_BOX_FRAME_DEPTH_MM, markBoxMm } from "../markBox.js";
import {
  MARK_CURTAIN_SIDES,
  findType,
  findWall,
  hexToRgb,
  labelOf,
  markIsComment,
  markSizes,
  markWall,
  markWallSideOn,
  planFractionToMm,
  styleOf,
  typeChannels,
  typeObjectView,
  wallVectors,
} from "../model.js";
import { MODEL_CYL_SIDES } from "../objectModels/kit.js";
import { objectLineModel, objectModelByKey, objectModelChannels } from "../objectModels/registry.js";
import { objectViewByName, objectViewForShape } from "../objectViews/registry.js";
import { VOLUME_LAYER_MARK } from "./measures.js";
import { volumeClockwise, volumeFace, volumeFaceNormal, volumeLine } from "./faces.js";
import {
  VOLUME_MARK_WALL,
  VOLUME_ROOM_PROBE_MM,
  volumeBoxCorners,
  volumeMix,
  volumePrismFaces,
  volumeRoomAt,
} from "./shapes.js";
import { volumeMiddleOf } from "./order.js";
import {
  VOLUME_CURTAIN_BUNCH,
  volumeCurtainFramesTo,
  volumeCurtainGather,
  volumeCurtainParts,
  volumeSheerParts,
  volumeSheerPlace,
} from "./sun.js";

// ——— метки ———————————————————————————————————————————————————————————————
//
// Таск 148, второй шаг G205. Где стоит вещь — правила заказчика, записанные
// словами и сведённые в одно решение:
//
//   **Высота решает вертикаль, стена — сторону и место.**
//
//   1. Высота задана и метка привязана к стене → вещь стоит **на своей стене**:
//      отступ вдоль из привязки, высота над полом — середина вещи, сторона — та,
//      на которой метка лежит по плану. Выступ от стены (G197) гонит её наружу.
//   2. Высота задана, стены нет → вещь висит **в своём месте по плану** на
//      заданной высоте.
//   2a. Высота задана **нулём** → вещь не висит, а **стоит на полу**: на нуле
//      её низ, а не середина (дефект D34, `volumeMarkOnFloor`). Правило
//      действует в обеих ветках: осушитель у стены стоит на полу так же, как
//      робот-пылесос посреди комнаты.
//   3. Высоты нет → вещь **потолочная**: встаёт под потолок того помещения, в
//      котором стоит, в своём месте по плану. Это не догадка сборки, а то, как
//      заполнен справочник: высота пуста ровно у потолочного света — точечный
//      светильник, светильник, подсветка, лента, трек, люстра, подсветка
//      кровати и шкафа, — и заполнена у всего, что висит на стене.
//   4. Высоты нет и потолка над меткой нет (помещение не обведено или метка
//      лежит вне контуров) → вешать не на что, и вещь **не размещается**:
//      уходит списком «не размещённые». Слова заказчика прямые: выдумывать им
//      место нельзя, но и молча терять нельзя.
//   5. Размера нет → недостающая сторона берётся **у изображения объекта**, а
//      без изображения — у общей рамки (G215 и G226, `markBox.js`), и вещь
//      попадает в сцену, а не в список. Такое бывает у типа, заведённого
//      руками: в стартовом справочнике размеры есть у всех (G192), а
//      «Мастер-выключатель» из объекта заказчика — его собственный тип, и
//      размеров у него нет ни одного. Габарит при этом догадка, и окно говорит
//      об этом списком `spare`: потерять вещь нельзя, но и выдать догадку за
//      чертёж тоже.
//
//      Правило здесь **не своё**: его же спрашивает развёртка, и оттуда оно и
//      взято — каждая сторона подтягивается отдельно. Вещь, у которой названы
//      обе стороны, рисуется ровно как прежде.
//
// **Плашка комментария в объёме не участвует вовсе** — ни вещью, ни строкой
// списка: это надпись на чертеже, а не изделие (то же правило, что у развёртки,
// `markWallBindable`).
//
// Три измерения вещи читаются по той поверхности, на которой она висит, и это
// одно правило на все случаи: **длина — вдоль поверхности, ширина — вторая
// сторона лица, выступ — прочь от поверхности**. На стене лицо стоит
// вертикально (длина вдоль стены, ширина вверх, выступ наружу), на потолке —
// горизонтально (длина и ширина по полу, выступ вниз). Поэтому точечная лента
// ЛВ (40 × 600) на стене сама собой встаёт **вертикальной лентой**, а люстра
// (500 × 400, выступ 300) свисает с потолка своим габаритом: ни одной отдельной
// ветки на эти два случая нет.
//
// **Метки не держат человека.** Сквозь шкаф ходить нельзя — это вещь чертежа, —
// а сквозь розетку можно: препятствием её никто не называл.

/**
 * На сколько лицо вещи выступает перед гранью стены, прежде чем начнётся её
 * выступ. Два миллиметра — не зазор «на всякий случай», а лекарство от
 * совпавших плоскостей: встроенный щит (выступ −30) и плоская панель лежат
 * ровно в грани стены, и без этого сдвига порядок граней между ними решался бы
 * случайно.
 */
export const VOLUME_MARK_LIFT_MM = 2;
/**
 * Самая мелкая сторона вещи. Лента 10 × 10 мм в объёме вырождается в волос, в
 * который не попасть кликом, — и дело не в красоте, а в том, что вещь обязана
 * остаться выделяемой. Двадцать миллиметров на расстоянии вытянутой руки — те
 * же пара точек экрана, что и десять, но грань у них настоящая.
 */
export const VOLUME_MARK_MIN_MM = 20;

/**
 * Вещь **стоит на полу**, а не висит на своей высоте (дефект D34).
 *
 * Высота над полом — это **середина** вещи: розетка на 300 занимает от 260 до
 * 340, и иначе её не поставить — ни верх, ни низ у висящей вещи не главнее
 * другого. Но ровно на этом правиле вещь с высотой **нуль** — осушитель, робот‑
 * пылесос, датчик протечки — вставала серединой на нуле, то есть нижней
 * половиной под полом.
 *
 * Признак — **сама нулевая высота, и больше ничего**. Проверять «есть ли под
 * ней пол» незачем: пол в объёме есть всегда (обведённое помещение или плита
 * под всем чертежом, `volumeScene`), так что проверка была бы истинной везде и
 * не различала бы ничего. Поля «где стоит» у метки нет (у вещей чертежа оно
 * появилось в таске 154), и заводить его ради этого не нужно: вещи, у которой
 * середина **на уровне пола**, не бывает. Записанный ноль у висящей вещи
 * означал бы, что её половина замурована в стяжку, — такого не размечают, и
 * читать ноль как «низ на полу» значит понять человека, а не догадаться за
 * него.
 *
 * Поэтому правило узкое: **двигается только нулевая высота**. Вещь на 50 мм
 * останется серединой на пятидесяти, даже если её низ при этом уйдёт ниже нуля:
 * пятьдесят человек написал сам, и перетолковывать его число нельзя (G68 —
 * готовый объект не должен меняться сверх того, что прямо исправляют).
 */
export function volumeMarkOnFloor(heightMm) {
  return heightMm === 0;
}
export const VOLUME_MARK_ROOM = "room";
export const VOLUME_MARK_CEILING = "ceiling";

/** Почему вещь не размещена. Строки к этим кодам — в окне, не здесь. */
export const VOLUME_MARK_NO_POINT = "noPoint";
export const VOLUME_MARK_NO_SIZE = "noSize";
export const VOLUME_MARK_NO_PLACE = "noPlace";

/** Толщина контура изображения — в экранных точках (см. `volumeLine`). */
const VOLUME_VIEW_LINE_PX = 1.4;
/** На сколько контур отодвинут от лица вещи, чтобы не спорить с ним за порядок. */
const VOLUME_VIEW_LIFT_MM = 1;
/** Во сколько отрезков разбирается полная окружность изображения. */
const VOLUME_VIEW_STEPS = 16;

// Светлота тела вещи: цвет категории, разбавленный белым, и контур поверх него
// — тем же цветом в полную силу. Так вещь читается и издали (пятно цвета
// категории видно, когда контур уже слился), и вблизи (контур насыщеннее
// своего тела, как тушь по бумаге на развёртке).
//
// Доля подобрана живым прогоном, и оба края пробовались на нём же: при 0,7 тело
// почти догоняет контур по насыщенности, и решётка бризера на нём пропадает; при
// 0,3 бледное пятно теряется на светлой стене. Замечание таска 139 («цвет на
// всей поверхности читается хуже контура») верно и здесь — поэтому цвет и
// разбавлен, а не взят в полную силу.
const VOLUME_MARK_TINT = 0.45;
const VOLUME_MARK_BASE = [226, 224, 220];

function volumeTint(rgb) {
  return [0, 1, 2].map((index) =>
    Math.round(rgb[index] * VOLUME_MARK_TINT + VOLUME_MARK_BASE[index] * (1 - VOLUME_MARK_TINT)),
  );
}

/** Цвет метки тройкой каналов; незнакомый — серый, как и в `styleOf`. */
function volumeRgbOf(color) {
  const rgb = hexToRgb(color);
  return rgb ? [rgb.r, rgb.g, rgb.b] : [120, 120, 120];
}

// Точки метки в миллиметрах чертежа. Пусто — моста к подложке нет (ADR 008) или
// точек у метки не осталось: место неизвестно, и выдумывать его нельзя.
function volumeMarkPathMm(project, mark) {
  const out = [];
  for (const point of mark.points || []) {
    const at = planFractionToMm(project, mark.schemeId, point);
    if (!at) return [];
    out.push(at);
  }
  return out;
}

function volumePathMiddle(path) {
  const xs = path.map((point) => point.x);
  const ys = path.map((point) => point.y);
  return { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
}

/** Изображение объекта у метки: имя у типа старше формы знака (ADR 005). */
export function volumeMarkView(project, mark) {
  const type = findType(project, mark.typeId);
  const style = styleOf(project, mark.typeId);
  return objectViewByName(typeObjectView(type)) || objectViewForShape(style.shape);
}

// Звенья ленты: по призме на отрезок пути, поперечник у всех один. То же, что у
// ломаного объекта чертежа (`volumeObjectPrisms`), и по той же причине —
// соседние звенья заходят друг в друга на изломе, как две стены в углу.
function volumePathPrisms(path, acrossMm, bottomMm, topMm) {
  const prisms = [];
  for (let index = 0; index + 1 < path.length; index += 1) {
    const a = path[index];
    const b = path[index + 1];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length = Math.hypot(dx, dy);
    if (!(length > 0)) continue;
    const u = { x: dx / length, y: dy / length };
    const middle = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    prisms.push({ corners: volumeBoxCorners(middle, u, length, acrossMm), bottomMm, topMm });
  }
  return prisms;
}

/**
 * **Точки повтора вдоль пути** (таск 177, G275): куда сядут светильники трека.
 *
 * Правило одно на любую длину и любой излом: считается **число** элементов —
 * `round(длина / шаг)`, не меньше одного и не больше потолка, — и они
 * расставляются равномерно с отступом полушага от концов. Поэтому у трека в
 * 1,7 м выходит три светильника через 567 мм, а не два через 600 и обрубок, а у
 * трека в 40 см — ровно один посередине.
 *
 * Отдаёт точку и направление пути в ней: по направлению встаёт габарит
 * элемента, и на изломе он честно повернётся вместе с полосой.
 */
export function volumeLineSpots(path, stepMm, max) {
  const legs = [];
  let total = 0;
  for (let index = 0; index + 1 < path.length; index += 1) {
    const a = path[index];
    const b = path[index + 1];
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (!(length > 0)) continue;
    legs.push({ a, u: { x: (b.x - a.x) / length, y: (b.y - a.y) / length }, length, from: total });
    total += length;
  }
  if (legs.length === 0 || !(stepMm > 0)) return [];
  const count = Math.max(1, Math.min(Math.round(total / stepMm) || 1, Math.max(1, max)));
  const spots = [];
  for (let index = 0; index < count; index += 1) {
    const along = (total * (index + 0.5)) / count;
    // Нога, на которую попала мера. Последняя — для меры, упёршейся в конец.
    const leg = legs.find((item) => along <= item.from + item.length) || legs[legs.length - 1];
    const inside = along - leg.from;
    spots.push({
      at: { x: leg.a.x + leg.u.x * inside, y: leg.a.y + leg.u.y * inside },
      u: leg.u,
      // **Настоящий** шаг, а не заказанный: на коротком пути он сжался, на
      // длинном растянулся потолком. Им меряется элемент, который должен
      // встать вплотную к соседнему — полотнище шторы.
      stepMm: total / count,
    });
  }
  return spots;
}

/**
 * Габариты повторяющихся элементов по пути полосы (таск 177).
 *
 * Полоса остаётся полосой: её рисуют звенья. Элемент встаёт **в её
 * поперечнике**, свисает ниже и заходит внутрь — почему именно так, разобрано
 * у `MODELS_LINES` в `objectModels/lines.js`.
 */
function volumeLineFrames(repeat, path, acrossMm, bottomMm, topMm) {
  const thickMm = Math.max(VOLUME_MARK_LIFT_MM, topMm - bottomMm);
  const thinMm = Math.max(VOLUME_MARK_LIFT_MM, acrossMm * repeat.acrossShare);
  return volumeLineSpots(path, repeat.stepMm, repeat.max).map((spot, index) => {
    const f = { x: spot.u.y, y: -spot.u.x };
    // Вдоль пути элемент мерится либо своим поперечником (светильник трека —
    // кругляш), либо **шагом** (полотнище шторы — почти вплотную к соседнему,
    // иначе вместо ткани выйдут жалюзи).
    const alongMm = repeat.alongShare
      ? Math.max(VOLUME_MARK_LIFT_MM, spot.stepMm * repeat.alongShare)
      : thinMm;
    // Волна: соседние элементы разведены по глубине. Складка тем и видна —
    // грани полотнищ отвёрнуты друг от друга, и между ними встаёт тёмный стык.
    const wave = repeat.waveShare ? (index % 2 === 0 ? -1 : 1) * repeat.waveShare * thinMm : 0;
    return {
      at: { x: spot.at.x + f.x * wave, y: spot.at.y + f.y * wave },
      // Полотно висит **до пола**: низ — ноль, верх заходит в полосу карниза.
      // Светильник трека, наоборот, свисает из полосы на долю её толщины.
      bottomMm: repeat.toFloor ? 0 : bottomMm - thickMm * repeat.dropShare,
      u: spot.u,
      f,
      widthMm: alongMm,
      depthMm: thinMm,
      heightMm: repeat.toFloor
        ? Math.max(VOLUME_MARK_LIFT_MM, bottomMm + thickMm * repeat.biteShare)
        : thickMm * (repeat.dropShare + repeat.biteShare),
    };
  });
}

/**
 * Где стоит одна метка — или почему не стоит нигде.
 *
 * `null` — того, чего в объёме нет вовсе (плашка комментария); `{markId, skip}`
 * — неразмещённая; полное описание места — размещённая. Чистая: ни холста, ни
 * строк, — правило места обязано проверяться без браузера.
 */
export function volumeMarkPlacement(project, mark, where = []) {
  if (!mark || markIsComment(mark)) return null;
  const path = volumeMarkPathMm(project, mark);
  if (path.length === 0) return { markId: mark.id, skip: VOLUME_MARK_NO_POINT };
  const sizes = markSizes(project, mark);
  const markView = volumeMarkView(project, mark);
  // Габарит лица — у общего правила (G226): каждая недостающая сторона берётся
  // у изображения объекта, а без изображения — у общей рамки. Строки
  // `VOLUME_MARK_NO_SIZE` в списке неразмещённых после G215 не бывает вовсе,
  // но код остаётся: окно знает его, и объект прежнего формата в середине
  // пересборки не должен спорить с новым правилом.
  const box = markBoxMm({ lengthMm: sizes.length, widthMm: sizes.width }, markView);
  const lengthMm = Math.max(VOLUME_MARK_MIN_MM, box.lengthMm);
  const widthMm = Math.max(VOLUME_MARK_MIN_MM, box.widthMm);
  // Выступ **не подтягивается до самой мелкой стороны**: это измерение, по
  // которому ничего не выделяют, и округли его до двадцати — плоская панель
  // стала бы вдвое толще себя. Хватает двух миллиметров: тело перестаёт быть
  // вырожденным, а у встроенного светильника выступ и правда нулевой.
  //
  // Запасной выступ берётся только у вещи, о размерах которой не сказано
  // **ничего**, и только там, где своего выступа нет: записанный ноль — это
  // ноль («встроенный»), а не пустота. Вещь, у которой человек назвал хоть
  // одну сторону лица, остаётся при своём выступе — догадываться о третьем
  // измерении по одной названной стороне нечем, да и готовый объект от этого
  // не должен толстеть.
  const nothingOwn = box.lengthFrom !== "own" && box.widthFrom !== "own";
  const depthOwn = nothingOwn && sizes.depth === null ? MARK_BOX_FRAME_DEPTH_MM : sizes.depth;
  const depthMm = Math.max(VOLUME_MARK_LIFT_MM, Math.abs(depthOwn || 0));
  const recessed = Number(sizes.depth) < 0;
  const line = mark.kind === "line" && path.length >= 2;
  const style = styleOf(project, mark.typeId);
  const rgb = volumeRgbOf(style.color);
  const view = line ? null : markView;
  // Повтор вдоль пути (таск 177, G275): у трека из полосы торчат светильники, у
  // ленты не торчит ничего. Ищется по коду типа — почему именно по коду,
  // разобрано в `objectModels/lines.js`.
  const lineType = line ? findType(project, mark.typeId) : null;
  const repeat = lineType ? objectLineModel(lineType.code) : null;
  const repeating = (spotPath, acrossMm, bottomMm, topMm) => {
    if (!repeat) return null;
    const frames = volumeLineFrames(repeat, spotPath, acrossMm, bottomMm, topMm);
    return frames.length === 0 ? null : { key: repeat.key, parts: repeat.parts, frames };
  };
  const common = {
    markId: mark.id,
    label: labelOf(project, mark.id),
    color: style.color,
    rgb,
    bodyRgb: volumeTint(rgb),
    kind: line ? "line" : "point",
    view,
    // Сторона открывания шторы (правка после сборки сценариев): своя у метки
    // или `null` — как до правки (`volumeCurtainGather`).
    curtainSide: MARK_CURTAIN_SIDES.includes(mark.curtainSide) ? mark.curtainSide : null,
    // Хоть одна сторона габарита — догадка сборки, а не чертёж: окно обязано
    // сказать об этом словом (`volumeMarks().spare`). Откуда именно взята
    // каждая сторона, здесь не хранится: это правило `markBoxMm`, и
    // спрашивают его у неё.
    spare: box.guessed,
    // Модель садится на последнюю ступень лестницы изображения (таск 155,
    // `objectModels/registry.js`): нашлось изображение — его имя и есть ключ
    // модели. У линейной метки модели нет и быть не может: она не вещь, а
    // цепочка звеньев, и у звена нет ни лица, ни верха. Зато у неё может быть
    // **повтор вдоль пути** (таск 177, поле `repeat`) — у трека из полосы
    // торчат светильники, у ленты не торчит ничего.
    //
    // С запасным габаритом (G215, G226) модель живёт мирно и по той же
    // причине: недостающая сторона взята у того же изображения, и получается,
    // что у вещи сходятся и габарит, и тело — а не кубик в габарите от
    // кондиционера.
    // Клавиш у выключателя столько, сколько каналов у типа (таск 177, G274):
    // описание приходит по имени изображения, а число клавиш — у справочника.
    // Неклавишной модели это ничего не меняет, и отдаётся она той же ссылкой.
    model: view ? objectModelChannels(objectModelByKey(view.name), typeChannels(project, mark.typeId)) : null,
  };
  const heightMm = sizes.heightAboveFloor;
  const binding = markWall(mark);
  const wall = binding ? findWall(project, binding.wallId) : null;
  const vectors = wall ? wallVectors(wall) : null;
  const side = wall && vectors ? markWallSideOn(project, mark, wall.id) : null;

  // ——— на своей стене ———
  if (heightMm !== null && wall && vectors && side) {
    const sign = side === "left" ? 1 : -1;
    const normal = { x: vectors.n.x * sign, y: vectors.n.y * sign, z: 0 };
    const faceMm = Number(wall.thicknessMm) / 2 + VOLUME_MARK_LIFT_MM;
    // Отступ берётся из привязки **как есть**: зеркалит отступы только лист
    // развёртки (таск 129), а объёму нужны обе стороны стены разом.
    const to = binding.toMm === null ? binding.atMm : binding.toMm;
    const fromMm = Math.min(binding.atMm, to);
    const toMm = Math.max(binding.atMm, to);
    const alongMm = line ? Math.max(VOLUME_MARK_MIN_MM, toMm - fromMm) : lengthMm;
    const middle = (fromMm + toMm) / 2;
    // Выступ идёт наружу от грани стены; утопленное (щит, выступ −30) уходит
    // внутрь, но лицом остаётся в плоскости стены — иначе его не было бы видно.
    const outer = recessed ? faceMm : faceMm + depthMm;
    const inner = recessed ? faceMm - depthMm : faceMm;
    // Высота над полом — середина вещи, кроме вещи, стоящей на полу
    // (`volumeMarkOnFloor`, D34): у неё на полу стоит низ. Вверх на стене идёт
    // **ширина** — вторая сторона лица, и другого имени у этой оси нет.
    const bottomMm = volumeMarkOnFloor(heightMm) ? 0 : heightMm - widthMm / 2;
    const topMm = bottomMm + widthMm;
    // Середина тела, а не записанное число: по ней стоит лицо, целится рамка
    // выделения и приходит стрелка связи. У всего, что висит, она и есть
    // записанная высота, — разойтись они могут только у стоящего на полу.
    const centreMm = (bottomMm + topMm) / 2;
    const at = (across, alongMm = middle) => ({
      x: Number(wall.aMm.x) + vectors.u.x * alongMm + normal.x * across,
      y: Number(wall.aMm.y) + vectors.u.y * alongMm + normal.y * across,
    });
    const faceAt = at(outer);
    const coreMm = (outer + inner) / 2;
    return {
      ...common,
      mode: VOLUME_MARK_WALL,
      wallId: wall.id,
      side,
      heightMm: centreMm,
      prisms: [
        {
          corners: volumeBoxCorners(at(coreMm), vectors.u, alongMm, Math.max(outer - inner, 1)),
          bottomMm,
          topMm,
        },
      ],
      // Повтор вдоль стены: путь — сама полоса от отступа до отступа. Поперечник
      // тут — выступ от стены, а толщина полосы — её высота: на стене полоса
      // лежит боком, и элемент всё равно свисает вниз.
      repeat: repeating(
        [at(coreMm, fromMm), at(coreMm, toMm)],
        Math.max(outer - inner, 1),
        bottomMm,
        topMm,
      ),
      anchor: { x: faceAt.x, y: faceAt.y, z: centreMm },
      // Габарит для модели (таск 155). Перёд берётся **оттуда же, откуда
      // лицо**: `u` — вдоль стены, как у изображения, `f` — от лица в стену,
      // то есть доля −0.5 по глубине всегда лежит на наружной грани, и у
      // утопленного щита тоже. Вверх идёт **высота вещи** — поле `width`,
      // которое с таска 158 так и подписано («Высота»): по стене мерят длину,
      // поперёк — ширину (выступ), вверх — высоту.
      frame: {
        at: at((outer + inner) / 2),
        bottomMm,
        u: { x: vectors.u.x, y: vectors.u.y },
        f: { x: -normal.x, y: -normal.y },
        widthMm: alongMm,
        depthMm: Math.max(outer - inner, 1),
        heightMm: widthMm,
      },
      // Лицо вещи — её наружная грань: по нему рисуется изображение объекта.
      face: {
        origin: { x: faceAt.x, y: faceAt.y, z: centreMm },
        u: { x: vectors.u.x, y: vectors.u.y, z: 0 },
        v: { x: 0, y: 0, z: 1 },
        normal,
        widthMm: alongMm,
        heightMm: widthMm,
      },
    };
  }

  // ——— в воздухе на своей высоте и под потолком ———
  const middle = volumePathMiddle(path);
  const room = heightMm === null ? volumeRoomAt(where, middle) : null;
  if (heightMm === null && !room) return { markId: mark.id, skip: VOLUME_MARK_NO_PLACE };
  // Вверх у вещи без стены идёт **выступ**: она лежит лицом к полу или к
  // потолку, а не стоит боком. Потолочная свисает выступом от потолка, висящая
  // в воздухе берёт свою высоту серединой, а стоящая на полу
  // (`volumeMarkOnFloor`, D34) — низом: робот-пылесос с выступом 90 занимает от
  // нуля до девяноста, а не от минус сорока пяти до сорока пяти.
  const onFloor = volumeMarkOnFloor(heightMm);
  // Потолочная вещь висит **на два миллиметра ниже потолка** — ту же щель
  // (`VOLUME_MARK_LIFT_MM`), которой вещь на стене отходит от стены. До таска
  // 211 её верх лежал ровно в плоскости потолка, и это сходило с рук: потолок
  // рисовался ярусом раньше тел и всегда оказывался под ними. Теперь порядок
  // им считает дерево, а у совпавших плоскостей порядок решать нечем — трек и
  // лента проступали сквозь крышу на виде сверху.
  const bottomMm =
    heightMm === null
      ? room.heightMm - depthMm - VOLUME_MARK_LIFT_MM
      : onFloor
        ? 0
        : heightMm - depthMm / 2;
  const topMm = bottomMm + depthMm;
  const centreMm = (topMm + bottomMm) / 2;
  const prisms = line
    ? volumePathPrisms(path, lengthMm, bottomMm, topMm)
    : [{ corners: volumeBoxCorners(middle, { x: 1, y: 0 }, lengthMm, widthMm), bottomMm, topMm }];
  if (prisms.length === 0) return { markId: mark.id, skip: VOLUME_MARK_NO_POINT };
  return {
    ...common,
    mode: heightMm === null ? VOLUME_MARK_CEILING : VOLUME_MARK_ROOM,
    roomId: room ? room.roomId : null,
    heightMm: centreMm,
    prisms,
    // Повтор вдоль пути (таск 177): трек под потолком и есть тот случай, для
    // которого он заведён. Поперечник полосы — её ширина в плане, толщина —
    // выступ: полоса лежит лицом к полу, и светильники свисают вниз.
    repeat: repeating(path, lengthMm, bottomMm, topMm),
    anchor: { x: middle.x, y: middle.y, z: centreMm },
    // Габарит для модели. Вещь в воздухе не повёрнута ничем — её коробка
    // лежит по осям плана, — значит и модель берёт их: `u` вдоль `x`, перёд
    // смотрит против `y`. Вверх здесь идёт **ширина (выступ)**: у потолочного
    // светильника вниз от потолка свисает именно она, а высота с длиной
    // ложатся в план — лицо вещи смотрит вниз.
    //
    // **Здесь имена осей и расходятся с картинкой** (дефект D36, таск 158): у
    // вещи под потолком «Ширина» рисуется вниз, а «Высота» — в плане. Имена
    // верны для вещи на стене, а таких у заказчика 79 из 86; под потолком
    // расходится люстра (500 × 400 при выступе 300). Честная правка — хранить
    // габарит в осях самой вещи и раскладывать его по посадке — двигает
    // готовые картинки, поэтому ждёт слова заказчика (G68).
    frame: line
      ? null
      : {
          at: middle,
          bottomMm,
          u: { x: 1, y: 0 },
          f: { x: 0, y: 1 },
          widthMm: lengthMm,
          depthMm: widthMm,
          heightMm: topMm - bottomMm,
        },
    // Лицо потолочной вещи смотрит вниз: на светильник смотрят снизу, и
    // изображение объекта рисуется на нижней грани. У стоящей на полу — ровно
    // наоборот (D34): на робота-пылесоса смотрят сверху, а лицо, оставленное
    // внизу, легло бы в самую плоскость пола и ушло бы под неё вместе с
    // контуром (`VOLUME_VIEW_LIFT_MM` поднимает контур **по нормали**), да ещё
    // и отсеклось бы отбором по нормали — то есть вещь осталась бы без
    // изображения вовсе.
    //
    // Переворачивается только нормаль и сторона, на которой лежит лицо: `u` и
    // `v` остаются своими. У горизонтального лица верхнего края нет вовсе —
    // человек ходит вокруг и смотрит на него с любой стороны, — и назначать его
    // значило бы выдумать то, чего в данных нет.
    face: line
      ? null
      : {
          origin: { x: middle.x, y: middle.y, z: onFloor ? topMm : bottomMm },
          u: { x: 1, y: 0, z: 0 },
          v: { x: 0, y: 1, z: 0 },
          normal: { x: 0, y: 0, z: onFloor ? 1 : -1 },
          widthMm: lengthMm,
          heightMm: widthMm,
        },
  };
}

/**
 * Все метки схемы: размещённые, список тех, кому места не нашлось, и список
 * нарисованных запасным габаритом (G215).
 *
 * `marks` — что считать: окно отдаёт сюда видимые на плане, чтобы фильтр значил
 * в двух видах одно и то же. Порядок сохраняется — списки читаются в том же
 * порядке, что таблица меток.
 *
 * Запасной габарит — не потеря, а догадка: вещь в сцене есть, но её размер
 * сборка выдумала. Поэтому `spare` отдельным списком, а не причиной в
 * `unplaced`: это разные новости, и смешивать их нельзя.
 */
export function volumeMarks(project, schemeId, { marks, rooms, walls } = {}) {
  const list = marks || (project ? project.marks.filter((mark) => mark.schemeId === schemeId) : []);
  const placed = [];
  const unplaced = [];
  const spare = [];
  const where = { rooms: rooms || [], walls: walls || [] };
  for (const mark of list) {
    const place = volumeMarkPlacement(project, mark, where);
    if (!place) continue;
    if (place.skip) {
      unplaced.push({ markId: mark.id, label: labelOf(project, mark.id), reason: place.skip });
      continue;
    }
    placed.push(place);
    if (place.spare) spare.push({ markId: place.markId, label: place.label });
  }
  return { placed, unplaced, spare };
}

/**
 * Грани тела вещи. Хозяин у каждой — сама метка: по ним и ловится клик.
 *
 * Есть модель — рисуется она, нет — прежняя коробка по габариту (таск 155).
 * Порядок именно такой, а не наоборот: пока модели писались, объём ни одной
 * минуты не был сломан, и тип, заведённый человеком руками, останется с
 * коробкой навсегда — у него нет изображения, а значит нет и модели.
 *
 * Выделение, прицел и `E` по взгляду от модели не зависят: `markId` стоит у
 * **каждой** грани модели, поэтому выделяется вещь целиком, а не одно тело.
 */
export function volumeMarkFaces(place, out = [], open = 0) {
  // Штора по позиции (таск 09 сценариев): ткань собирается к краю, карниз
  // стоит. Закрытая (0) — та же штора, что без позиции, грань в грань.
  const keep = open > 0 && volumeSheerPlace(place) ? 1 - Math.min(1, open) * (1 - VOLUME_CURTAIN_BUNCH) : 1;
  if (place.model && place.frame) {
    const gather = volumeCurtainGather(place, place.frame.u);
    const model = keep < 1 ? { ...place.model, parts: volumeCurtainParts(place.model.parts || [], keep, gather) } : place.model;
    return volumeModelFaces(place.frame, model, place.bodyRgb, out, { markId: place.markId });
  }
  // Метка без модели — коробка или полоса по габариту — **светится вся**, если
  // повтора у неё нет (таск 09 сценариев): у ленты света свет и есть сама
  // полоса. У трека светятся его светильники, а не полоса; у шторы — ничего.
  // Признак «может», а не «горит»: розетка-коробка не засветится, сколько её ни
  // включай, — свечение кадр даёт только свету и экрану.
  const lit = !place.repeat;
  for (const prism of place.prisms || []) {
    volumePrismFaces(prism.corners, prism.bottomMm, prism.topMm, place.bodyRgb, out, { markId: place.markId, lit });
  }
  // Повтор вдоль пути (таск 177, G275): полоса уже нарисована звеньями, а
  // поверх неё садятся светильники трека. Хозяин у них тот же — сама метка,
  // поэтому щелчок по светильнику выделяет трек, а не ничего.
  const frames = (place.repeat && place.repeat.frames) || [];
  const gather = frames.length > 0 ? volumeCurtainGather(place, frames[0].u) : "min";
  for (const frame of keep < 1 && volumeSheerParts(place.repeat.parts) ? volumeCurtainFramesTo(frames, keep, gather) : frames) {
    volumeModelFaces(frame, place.repeat, place.bodyRgb, out, { markId: place.markId });
  }
  return out;
}

/**
 * Точка, по которой метка узнаёт своё помещение (таск 09 сценариев): у вещи на
 * стене — в пяти сантиметрах от лица внутрь комнаты, у остальных — её якорь.
 */
export function volumeMarkProbe(place) {
  if (!place || !place.anchor) return null;
  const normal = place.mode === VOLUME_MARK_WALL && place.face ? place.face.normal : null;
  if (!normal) return { x: place.anchor.x, y: place.anchor.y };
  return { x: place.anchor.x + normal.x * VOLUME_ROOM_PROBE_MM, y: place.anchor.y + normal.y * VOLUME_ROOM_PROBE_MM };
}

// ——— модели (таск 155, требование G221) ——————————————————————————————————
//
// Второй интерпретатор описаний — после плоского (`objectViews/registry.js`) и
// объёмного для изображений (`volumeViewPolylines`). Читает список тел
// (`objectModels/kit.js`) и выдаёт призмы: ни мешей, ни вершин руками.
//
// Тело — это **призма по многоугольнику в плане**, то есть ровно то, чем уже
// рисуются стены, вещи чертежа и коробки меток. Поэтому цилиндр здесь
// вертикальный, и другого быть не может: `volumePrismFaces` выдавливает
// многоугольник вверх. Лежачая труба — полотенцесушитель, ствол объектива,
// карниз — описывается коробкой, и в её тридцати миллиметрах разницы не видит
// никто. Это то же решение, что отказ от кривой Безье у изображений: не
// хватает примитива — упрощается вещь, а не растёт набор.

/** Нейтральные концы двух материалов. Чистых их не бывает — см. `volumeModelRgb`. */
const VOLUME_MODEL_METAL = [172, 176, 182];
const VOLUME_MODEL_GLASS = [205, 219, 230];
/** Насколько `light` светлее тела и насколько `dark` темнее его. */
const VOLUME_MODEL_LIGHT = 0.8;
const VOLUME_MODEL_DARK = 0.72;
/** Сколько своего цвета остаётся у металла и стекла. */
const VOLUME_MODEL_NEUTRAL = 0.86;

/**
 * Цвет тела: материал, посчитанный **от цвета самой вещи**.
 *
 * Так решается спор модели с ADR 005. Цвет принадлежит категории, и модель
 * своей краски не приносит ни одной: `body` — ровно тот цвет, которым вещь
 * рисовалась до моделей (у метки — разбавленный цвет её категории, у вещи
 * чертежа — её собственный), `light` и `dark` — он же светлее и темнее,
 * `metal` и `glass` — почти нейтральные, но оттенок вещи в них остаётся.
 * Перекрасил человек категорию — поехали все пять.
 *
 * Из этого следует проверяемое обещание: **у вещи, чья модель — одно тело во
 * весь габарит, в кадре не изменилось ничего** — ни цвета, ни числа граней.
 * Колонна тому свидетель.
 *
 * Выигрыш тоже проверяется глазами: на одной стене стоят розетка и
 * выключатель одного цвета, и до моделей они были двумя одинаковыми плашками.
 * Теперь у одной светлая сердцевина, у другого светлые клавиши — а красный
 * остался красным.
 */
export function volumeModelRgb(material, bodyRgb) {
  if (material === "light") return volumeMix(bodyRgb, VOLUME_MARK_BASE, VOLUME_MODEL_LIGHT);
  if (material === "dark") return bodyRgb.map((value) => Math.round(value * VOLUME_MODEL_DARK));
  if (material === "metal") return volumeMix(bodyRgb, VOLUME_MODEL_METAL, VOLUME_MODEL_NEUTRAL);
  if (material === "glass") return volumeMix(bodyRgb, VOLUME_MODEL_GLASS, VOLUME_MODEL_NEUTRAL);
  return bodyRgb;
}

/**
 * Тела модели, переведённые в призмы габарита.
 *
 * Габарит — `frame`: середина в плане, низ по высоте, направление лица и три
 * размера. Доли переводятся им, и только им: ни одно описание не знает ни
 * миллиметров, ни того, на стене вещь или на полу.
 */
export function volumeModelPrisms(frame, parts) {
  const out = [];
  if (!frame || !(frame.heightMm > 0)) return out;
  const at = (fx, fy) => ({
    x: frame.at.x + frame.u.x * fx * frame.widthMm + frame.f.x * fy * frame.depthMm,
    y: frame.at.y + frame.u.y * fx * frame.widthMm + frame.f.y * fy * frame.depthMm,
  });
  for (const part of parts || []) {
    // Лежачий цилиндр призмой не бывает вовсе (таск 177): призма выдавливается
    // вверх, а у него ось горизонтальна. Грани ему строит `volumeTubeFaces`, и
    // здесь он пропускается — иначе барабан стиральной машины молча стал бы
    // коробкой, то есть ровно тем, на что заказчик и указал.
    if (part.kind === "tube" || part.kind === "cone") continue;
    // Полотно шторы висит **до пола** (таск 177, G261): верх из долей, низ —
    // ноль. Это единственное тело, которое выходит из габарита, и выходит оно
    // по признаку в описании, а не по догадке интерпретатора.
    const bottomMm = part.toFloor ? 0 : frame.bottomMm + part.z * frame.heightMm;
    const topMm = frame.bottomMm + (part.z + part.height) * frame.heightMm;
    const corners = [];
    if (part.kind === "cyl") {
      // Эллипс вписан в прямоугольник тела, углы сдвинуты на полшага: при
      // восьми сторонах так получаются плоские грани вперёд, назад и по
      // бокам, а не рёбра — цилиндр у стены стоит к ней стороной.
      const cx = part.x + part.width / 2;
      const cy = part.y + part.depth / 2;
      for (let index = 0; index < MODEL_CYL_SIDES; index += 1) {
        const angle = ((index + 0.5) * Math.PI * 2) / MODEL_CYL_SIDES;
        corners.push(at(cx + (Math.cos(angle) * part.width) / 2, cy + (Math.sin(angle) * part.depth) / 2));
      }
    } else if (part.kind === "plate") {
      // Плита по контуру (ступень винтовой лестницы): вершины — свои.
      for (const [fx, fy] of part.points) corners.push(at(fx, fy));
    } else {
      corners.push(at(part.x, part.y));
      corners.push(at(part.x + part.width, part.y));
      corners.push(at(part.x + part.width, part.y + part.depth));
      corners.push(at(part.x, part.y + part.depth));
    }
    out.push({
      corners: volumeClockwise(corners),
      bottomMm,
      topMm,
      material: part.material,
      name: part.name,
      // «Может светиться» (таск 09 сценариев): доезжает до грани
      // (`volumeModelFaces`), а горит ли — решает кадр по состоянию дома.
      lit: part.lit,
      // Какая лампа устройства зажигает тело (правка после сборки сценариев).
      bulb: Number.isInteger(part.bulb) ? part.bulb : null,
      // Номер канала клавиши (таск 177): у остальных тел его нет вовсе.
      channel: part.channel === undefined ? null : part.channel,
      // Чем тело просвечивает (таск 189): имя плотности или `null`. Доезжает
      // до грани и останавливается — в объект не пишется ничего (G68).
      clear: part.clear || null,
    });
  }
  return out;
}

/**
 * Грань **наружу тела**: обход разворачивается, если нормаль смотрит внутрь.
 *
 * Заведена для лежачего цилиндра (таск 177) и нужна ровно ему: у призмы
 * сторона наружу выходит сама — плановый многоугольник записан по часовой
 * (`volumeClockwise`), и «левая» нормаль ребра смотрит из тела. У лежачего
 * цилиндра плана нет вовсе: его бока стоят косо к обеим осям, и держать в
 * голове, куда повёрнут габарит, пришлось бы в каждой записи. Вместо этого
 * спрашивается сама геометрия: `inside` — точка на оси тела, и грань
 * обязана смотреть от неё.
 */
function volumeFaceOut(points, inside, rgb, options) {
  const normal = volumeFaceNormal(points);
  const middle = volumeMiddleOf(points);
  const away =
    normal.x * (middle.x - inside.x) + normal.y * (middle.y - inside.y) + normal.z * (middle.z - inside.z);
  return volumeFace(away >= 0 ? points : [...points].reverse(), rgb, options);
}

/**
 * Грани **лежачего цилиндра**: восемь боковых полос и два днища (таск 177,
 * G262 — «барабан, горизонтальный и внутри»).
 *
 * Круг вписан в те две стороны тела, что поперёк оси, а углы сдвинуты на
 * полшага — как у стоячего цилиндра: при восьми сторонах восьмиугольник стоит
 * к глазу стороной, а не ребром. Цена та же, что у стоячего, — десять граней,
 * и предел вещи от нового вида тела не поехал.
 */
/**
 * Грани конуса (правка после сборки сценариев): круг основания вписан в
 * прямоугольник тела на высоте `z`, вершина — посередине на `z + height`.
 * Бока смотрят прочь от оси, днище — вниз.
 */
export function volumeConeFaces(frame, part, rgb, out = [], options = {}) {
  if (!frame || !(frame.heightMm > 0)) return out;
  const at = (fx, fy, fz) => ({
    x: frame.at.x + frame.u.x * fx * frame.widthMm + frame.f.x * fy * frame.depthMm,
    y: frame.at.y + frame.u.y * fx * frame.widthMm + frame.f.y * fy * frame.depthMm,
    z: frame.bottomMm + fz * frame.heightMm,
  });
  const cx = part.x + part.width / 2;
  const cy = part.y + part.depth / 2;
  const ring = [];
  for (let index = 0; index < MODEL_CYL_SIDES; index += 1) {
    const angle = ((index + 0.5) * Math.PI * 2) / MODEL_CYL_SIDES;
    ring.push(at(cx + (Math.cos(angle) * part.width) / 2, cy + (Math.sin(angle) * part.depth) / 2, part.z));
  }
  const apex = at(cx, cy, part.z + part.height);
  const middle = at(cx, cy, part.z + part.height / 3);
  for (let index = 0; index < ring.length; index += 1) {
    out.push(volumeFaceOut([ring[index], ring[(index + 1) % ring.length], apex], middle, rgb, options));
  }
  out.push(volumeFaceOut(ring, apex, rgb, options));
  return out;
}

export function volumeTubeFaces(frame, part, rgb, out = [], options = {}) {
  if (!frame || !(frame.heightMm > 0)) return out;
  const at = (fx, fy, fz) => ({
    x: frame.at.x + frame.u.x * fx * frame.widthMm + frame.f.x * fy * frame.depthMm,
    y: frame.at.y + frame.u.y * fx * frame.widthMm + frame.f.y * fy * frame.depthMm,
    z: frame.bottomMm + fz * frame.heightMm,
  });
  // Ось: `x` — поперёк лица, `y` — из лица в глубину. Вдоль неё тело тянется от
  // `from` до `to`, а круг лежит в двух оставшихся долях.
  const alongX = part.axis === "x";
  const from = alongX ? part.x : part.y;
  const to = from + (alongX ? part.width : part.depth);
  const across = alongX ? part.y + part.depth / 2 : part.x + part.width / 2;
  const acrossMm = alongX ? frame.depthMm : frame.widthMm;
  const middleZ = part.z + part.height / 2;
  // Доли круга поперёк оси. Обычно он вписан в само тело и в неквадратном
  // габарите выходит овальным — как овальна колонна 150 × 90. `round` берёт
  // диаметр по **большей** стороне тела в миллиметрах и переводит его в доли
  // каждой оси порознь: круг остаётся кругом, даже если для этого ему придётся
  // выйти из габарита (круглое зеркало при полосе подсветки, таск 177).
  let acrossShare = (alongX ? part.depth : part.width) / 2;
  let upShare = part.height / 2;
  if (part.round) {
    const radiusMm = Math.max(acrossShare * 2 * acrossMm, part.height * frame.heightMm) / 2;
    acrossShare = acrossMm > 0 ? radiusMm / acrossMm : acrossShare;
    upShare = frame.heightMm > 0 ? radiusMm / frame.heightMm : upShare;
  }
  const ring = [];
  for (let index = 0; index < MODEL_CYL_SIDES; index += 1) {
    const angle = ((index + 0.5) * Math.PI * 2) / MODEL_CYL_SIDES;
    ring.push({ across: across + Math.cos(angle) * acrossShare, z: middleZ + Math.sin(angle) * upShare });
  }
  const node = (item, along) => (alongX ? at(along, item.across, item.z) : at(item.across, along, item.z));
  const axisAt = (along) => (alongX ? at(along, across, middleZ) : at(across, along, middleZ));
  const middle = axisAt((from + to) / 2);
  for (let index = 0; index < ring.length; index += 1) {
    const a = ring[index];
    const b = ring[(index + 1) % ring.length];
    out.push(volumeFaceOut([node(a, from), node(b, from), node(b, to), node(a, to)], middle, rgb, options));
  }
  // Днища: наружу у каждого — прочь от другого конца оси.
  out.push(volumeFaceOut(ring.map((item) => node(item, from)), axisAt(to), rgb, options));
  out.push(volumeFaceOut(ring.map((item) => node(item, to)), axisAt(from), rgb, options));
  return out;
}

/**
 * Грани модели.
 *
 * `options.markId` — хозяин: у вещей чертежа его нет, у меток есть.
 * `options.clear` — модель просвечивает **целиком** (таск 169): так рисуются
 * вещи чертежа. У метки такого признака нет и не будет: просвечивает не метка,
 * а **тело** — полотнище тюля (таск 189), стекло в раме, — и говорит об этом
 * само описание (`clear` в `objectModels/kit.js`). Поэтому плотность тела
 * сильнее общей: прозрачное тело прозрачно и внутри прозрачной вещи, а труба
 * карниза остаётся плотной внутри шторы.
 *
 * Тела двух видов идут призмами, лежачий цилиндр — своими гранями (таск 177).
 * Разбор по виду тела здесь и только здесь: ни одна модель не знает, чем её
 * рисуют.
 */
export function volumeModelFaces(frame, model, rgb, out = [], options = {}) {
  const parts = (model && model.parts) || [];
  const own = (part) => ({
    markId: options.markId || null,
    // Плотность тела старше общей — см. заголовок.
    clear: (part && part.clear) || options.clear || false,
    // Номер канала доезжает до грани и останавливается там: что значит «канал
    // выделен», решает окно, а в объект не пишется ничего (G68, таск 177).
    channel: part && part.channel !== undefined ? part.channel : null,
    // «Может светиться» (таск 09 сценариев): признак тела доезжает до грани.
    lit: Boolean(part && part.lit),
    bulb: part && Number.isInteger(part.bulb) ? part.bulb : null,
  });
  for (const part of parts) {
    if (part.kind === "tube") volumeTubeFaces(frame, part, volumeModelRgb(part.material, rgb), out, own(part));
    else if (part.kind === "cone") volumeConeFaces(frame, part, volumeModelRgb(part.material, rgb), out, own(part));
  }
  for (const prism of volumeModelPrisms(frame, parts)) {
    // Та самая одна строка (таск 09 сценариев): `prism.lit` доезжает до грани
    // через `own(prism)`, а горит ли тело — решает кадр по состоянию дома.
    const fill = volumeModelRgb(prism.material, rgb);
    volumePrismFaces(prism.corners, prism.bottomMm, prism.topMm, fill, out, own(prism));
  }
  return out;
}

/**
 * **Второй интерпретатор изображений объектов** (таск 139, G198).
 *
 * Обещание того таска проверяется здесь: объёму хватило тех же пяти примитивов,
 * и ни одной записи переписывать не пришлось. Разница с плоским интерпретатором
 * (`objectViews/registry.js`, `drawPart`) одна, и она в природе вывода: тот
 * рисует по холсту и умеет дуги со скруглениями сам, а этому нужны **точки** —
 * окружность, дуга и скруглённый угол разбираются на отрезки здесь.
 *
 * Доли те же: −0.5…0.5 по сторонам своего прямоугольника.
 */
export function volumeViewPolylines(view) {
  const lines = [];
  for (const part of (view && view.parts) || []) {
    if (part.kind === "line") {
      lines.push({ points: [{ x: part.x1, y: part.y1 }, { x: part.x2, y: part.y2 }], closed: false });
      continue;
    }
    if (part.kind === "poly") {
      lines.push({ points: (part.points || []).map(([x, y]) => ({ x, y })), closed: Boolean(part.close) });
      continue;
    }
    if (part.kind === "rect") {
      lines.push({ points: volumeRectPoints(part), closed: true });
      continue;
    }
    if (part.kind === "circle") {
      lines.push({ points: volumeArcPoints(part.cx, part.cy, part.r, 0, Math.PI * 2), closed: true });
      continue;
    }
    if (part.kind === "arc") {
      lines.push({
        points: volumeArcPoints(part.cx, part.cy, part.r, part.from, part.to),
        closed: Boolean(part.close),
      });
    }
  }
  return lines.filter((item) => item.points.length >= 2);
}

// Дуга отрезками. Шаг — доля полного круга, но не меньше двух отрезков: у
// четверти окружности их выходит четыре, и излома на лице вещи не видно.
function volumeArcPoints(cx, cy, r, from, to) {
  const span = Math.abs(to - from);
  const steps = Math.max(2, Math.round((VOLUME_VIEW_STEPS * span) / (Math.PI * 2)));
  const points = [];
  for (let index = 0; index <= steps; index += 1) {
    const angle = from + ((to - from) * index) / steps;
    points.push({ x: cx + Math.cos(angle) * r, y: cy + Math.sin(angle) * r });
  }
  // Полная окружность: последняя точка совпала бы с первой, а замкнутость
  // говорится признаком `closed`, а не дублем вершины.
  if (span >= Math.PI * 2 - 1e-6) points.pop();
  return points;
}

// Прямоугольник со скруглением: углы — те же дуги. Радиус в долях, как у
// плоского интерпретатора, и так же зажат половиной короткой стороны.
function volumeRectPoints(part) {
  const left = part.x;
  const top = part.y;
  const right = part.x + part.width;
  const bottom = part.y + part.height;
  const r = Math.max(0, Math.min(Number(part.radius) || 0, Math.min(Math.abs(part.width), Math.abs(part.height)) / 2));
  if (!(r > 0)) {
    return [
      { x: left, y: top },
      { x: right, y: top },
      { x: right, y: bottom },
      { x: left, y: bottom },
    ];
  }
  const corner = (cx, cy, from, to) => volumeArcPoints(cx, cy, r, from, to);
  return [
    ...corner(left + r, top + r, Math.PI, Math.PI * 1.5),
    ...corner(right - r, top + r, Math.PI * 1.5, Math.PI * 2),
    ...corner(right - r, bottom - r, 0, Math.PI * 0.5),
    ...corner(left + r, bottom - r, Math.PI * 0.5, Math.PI),
  ];
}

/**
 * Доля лица вещи → точка в миллиметрах чертежа и высоте над полом.
 *
 * Доля по высоте берётся **с обратным знаком**: у плоского интерпретатора ось
 * `y` растёт вниз (так устроен холст), а здесь вверх. Без этого решётка
 * кондиционера оказалась бы над индикатором, а клавиша выключателя — под
 * рамкой: изображение рисовалось бы вверх ногами и молча.
 */
export function volumeFacePoint(face, fx, fy) {
  const alongMm = fx * face.widthMm;
  const upMm = -fy * face.heightMm;
  return {
    x: face.origin.x + face.u.x * alongMm + face.v.x * upMm + face.normal.x * VOLUME_VIEW_LIFT_MM,
    y: face.origin.y + face.u.y * alongMm + face.v.y * upMm + face.normal.y * VOLUME_VIEW_LIFT_MM,
    z: face.origin.z + face.u.z * alongMm + face.v.z * upMm + face.normal.z * VOLUME_VIEW_LIFT_MM,
  };
}

/**
 * Контур вещи — её изображением объекта, цветом метки.
 *
 * Изображения нет (тип без имени и с формой, которой изображения не завели) —
 * нет и контура: вещь остаётся своей плашкой цвета категории. Условный знак
 * плана сюда не переносится нарочно: знак читают как обозначение рядом с
 * подписью, а в объёме подписи нет, и знак стал бы украшением.
 *
 * Это и есть салатовая картинка поверх выключателя со скриншота заказчика
 * (таск 14 сценариев, G15): с тех пор поверх **модели** она рисуется только по
 * опции «Подсвечивать метки» — решает `volumeScene` доводом `markImages`.
 */
export function volumeMarkViewLines(place, out = []) {
  if (!place || !place.face || !place.view) return out;
  for (const line of volumeViewPolylines(place.view)) {
    out.push(
      volumeLine(
        line.points.map((point) => volumeFacePoint(place.face, point.x, point.y)),
        place.color,
        {
          closed: line.closed,
          normal: place.face.normal,
          width: VOLUME_VIEW_LINE_PX,
          markId: place.markId,
        },
      ),
    );
  }
  return out;
}

// ——— выделение и связи ———————————————————————————————————————————————————
//
// Выделение в объёме **общее с планом** (слова заказчика): окно и список меток
// смотрят в одно и то же поле состояния, и кто выделил первым — неважно.
// Поэтому здесь только рамка, а живёт выделение там же, где жило.
//
// И рамка, и стрелки лежат **поверх всего** (`VOLUME_LAYER_MARK`) — это прямое
// решение заказчика: «стрелка идёт сквозь стену». Цель в соседней комнате иначе
// пропадала бы за перегородкой вместе с ответом на вопрос, куда связь ведёт.
// Чтобы сквозная линия не врала о том, что видно глазами, связь рисуется
// **дважды**: сплошной в общем потоке (её закрывают стены, как и положено) и
// тонкой пунктирной поверх всего. Там, где связь видна, пунктир ложится на свою
// же сплошную линию и не заметен; там, где она за стеной, остаётся один
// пунктир — он и значит «цель за стеной».

/** Цвет рамки выделения — тот же, что на плане (`drawMarkBody`). */
export const VOLUME_SELECT_COLOR = "#0969DA";
/** Цвета связей — те же, что на плане (`LINK_COLOR` и `LINK_TIE_COLOR`). */
export const VOLUME_LINK_COLOR = "#BF3989";
export const VOLUME_TIE_COLOR = "#0F2E7A";
/** Во сколько глушится поднятое цепочкой, но выделенной метки не касающееся. */
const VOLUME_LINK_FAR = 0.4;
/** Насколько видна сквозь стену та часть связи, которую закрывает геометрия. */
const VOLUME_LINK_THROUGH = 0.55;
const VOLUME_LINK_WIDTH = 2.2;
const VOLUME_LINK_THROUGH_WIDTH = 1.1;
const VOLUME_LINK_DASH = [6, 5];
const VOLUME_SELECT_DASH = [7, 5];
const VOLUME_SELECT_GROW = 1.3;

/** Тот же тон вполсилы: прозрачность пишется в сам цвет. */
export function volumeFade(color, alpha) {
  const rgb = hexToRgb(color) || { r: 120, g: 120, b: 120 };
  return "rgba(" + rgb.r + "," + rgb.g + "," + rgb.b + "," + Math.round(alpha * 100) / 100 + ")";
}

/**
 * Рамка выделенной вещи: по её лицу у точки, по оси у ленты. Пунктир и цвет те
 * же, что у кольца выделения на плане: одна и та же метка не должна выделяться
 * в двух видах по-разному.
 */
export function volumeSelectLines(place, out = []) {
  if (!place) return out;
  if (place.face) {
    const half = VOLUME_SELECT_GROW / 2;
    out.push(
      volumeLine(
        [
          volumeFacePoint(place.face, -half, -half),
          volumeFacePoint(place.face, half, -half),
          volumeFacePoint(place.face, half, half),
          volumeFacePoint(place.face, -half, half),
        ],
        VOLUME_SELECT_COLOR,
        { closed: true, dash: VOLUME_SELECT_DASH, width: 2, layer: VOLUME_LAYER_MARK },
      ),
    );
    return out;
  }
  // Лента: рамки у неё нет, обводится сама — так же, как на плане выделяется
  // линия, а не кольцо вокруг каждой её вершины.
  for (const prism of place.prisms || []) {
    const middleZ = (prism.bottomMm + prism.topMm) / 2;
    out.push(
      volumeLine(
        prism.corners.map((point) => ({ x: point.x, y: point.y, z: middleZ })),
        VOLUME_SELECT_COLOR,
        { closed: true, dash: VOLUME_SELECT_DASH, width: 2, layer: VOLUME_LAYER_MARK },
      ),
    );
  }
  return out;
}

/**
 * **Рамка выбранной клавиши** (таск 177, G274): по самой клавише, а не по лицу
 * вещи.
 *
 * Выбранный канал обязан быть виден глазами — иначе стрелки «только его» читались
 * бы как пропавшие связи. Рамка идёт тем же цветом, что рамка выделения, но
 * сплошной и вплотную по клавише: у вещи рамка снаружи и пунктиром, у клавиши
 * внутри и линией, и спутать их нельзя.
 *
 * Доли клавиши переводятся в доли лица: у модели `z` считается снизу вверх, у
 * лица `fy` — сверху вниз, отсюда `0.5 − z`. Это то же пересчитывание, что в
 * `volumeFacePoint`, и другого места, где оно живёт, нет.
 */
export function volumeChannelLines(place, channel, out = []) {
  if (!place || !place.face || !channel || !place.model) return out;
  const key = (place.model.parts || []).find((part) => part.channel === channel);
  if (!key) return out;
  const left = key.x;
  const right = key.x + key.width;
  const top = 0.5 - (key.z + key.height);
  const bottom = 0.5 - key.z;
  out.push(
    volumeLine(
      [
        volumeFacePoint(place.face, left, top),
        volumeFacePoint(place.face, right, top),
        volumeFacePoint(place.face, right, bottom),
        volumeFacePoint(place.face, left, bottom),
      ],
      VOLUME_SELECT_COLOR,
      { closed: true, width: 2, layer: VOLUME_LAYER_MARK },
    ),
  );
  return out;
}

/**
 * Стрелки связей по правилам плана.
 *
 * Правила, **какие** связи показывать, берутся с плана целиком
 * (`canvas.canvasFrameLinks` → `render.markLinks`): управление — дугой со
 * стрелкой, общее управление — без стрелки (это отношение равных), общий номер
 * — кольцом по своим меткам. Вторых правил здесь не заводится: разойдись они, у
 * одной метки на плане и в объёме оказались бы разные связи.
 *
 * `anchorOf` отвечает, где в объёме стоит метка. Неразмещённой вещи в объёме
 * нет — нет и стрелки к ней: это было бы указание в пустоту. Почему её нет,
 * отвечает список неразмещённых.
 */
/**
 * **Связи одного канала** (таск 177, G274): слова заказчика — «обрабатывай клик
 * на каждый канал отдельно рисуя стрелки только на соответствующий канал».
 *
 * Канал не выбран (`null`) — связи идут как шли, и это обычная жизнь: выделение
 * метки показывает всю её цепь. Канал выбран — остаётся **только управление с
 * этого канала этой метки**, и остаётся оно одно:
 *
 * - общее управление (`ties`) про канал не знает вовсе — это отношение равных
 *   между двумя выключателями, и у него нет стороны «какой клавишей»;
 * - общий номер (`groups`) — тождество меток, тоже не про клавишу;
 * - связи **без канала** у многоклавишной метки — это разметка до каналов, и
 *   показывать их при выбранной первой клавише значило бы сказать «они на
 *   первой», чего в данных нет.
 *
 * Поэтому выбор канала — это **сужение до одной клавиши**, а не подсветка: на
 * кадре остаётся ровно то, чем она управляет. Снять его можно щелчком мимо
 * клавиши — выделение вещи целиком возвращает всю картину.
 *
 * **Одноклавишная метка — исключение, и не домысел** (таск 191, D50). Слова
 * заказчика: «Если в Объёме нажать на клавишу 1 клавишного выключателя, то
 * пишет: Канал 1: на этой клавише нет ни одной нагрузки. Хотя по факту 1 канал
 * там и в „Чем управляет“ не указывается канал. Соответственно выбранное и есть
 * первый канал». У метки с одной клавишей другого канала **не бывает**: связь
 * без номера может принадлежать только ей, и это не догадка, а единственный
 * возможный ответ. Правило таска 177 («связь без канала первой клавише не
 * приписывается») остаётся там, где оно верно, — у двух клавиш и больше, где
 * данные молчат о том, какая из них.
 *
 * Сколько клавиш — говорит `keys`, и считает их `volumeModelKeys` по самому
 * описанию тела: второго счёта клавиш в сборке нет. Не передали — метка
 * считается многоклавишной, то есть осторожной.
 *
 * Чистая и живёт здесь, а не в холсте: правила, **какие** связи бывают,
 * по-прежнему плановые целиком (`canvasFrameLinks`), и второго их хозяина
 * заводить нельзя. Здесь только отбор по каналу — то, чего на плане нет.
 */
export function volumeChannelLinks(links, pick, keys = 0) {
  const empty = { lines: [], ties: [], groups: [], offScheme: [] };
  if (!links) return empty;
  if (!pick || !pick.markId || !pick.channel) return links;
  // Единственная клавиша забирает себе и связи без номера: другого канала у неё
  // нет. У второй и дальше клавиш этого правила быть не может — номер там
  // значит выбор, и выбора в данных не записано.
  const alone = keys === 1 && pick.channel === 1;
  return {
    ...empty,
    lines: (links.lines || []).filter(
      (line) =>
        line.fromId === pick.markId &&
        (line.channel === pick.channel || (alone && (line.channel === null || line.channel === undefined))),
    ),
  };
}

/**
 * **Сколько клавиш нарисовано у вещи** (таск 191, D50).
 *
 * Считается по самому описанию тела — по тем клавишам, которые построил
 * `modelKeys` (`objectModels/power.js`), а не вторым счётом по типу: число
 * каналов у типа и число клавиш на стене расходятся нарочно (у четырёхканальной
 * метки клавиш четыре, у двадцатиканального реле — ни одной, разбор в
 * `power.js`). Спрашивать надо то, по чему человек щёлкает, а щёлкает он по
 * клавише.
 *
 * Неклавишная модель даёт ноль — и ноль здесь значит «правило одной клавиши не
 * про неё», а не «одна клавиша».
 */
export function volumeModelKeys(model) {
  return ((model && model.parts) || []).filter((part) => part.channel).length;
}

export function volumeLinkLines(links, anchorOf, out = []) {
  const pair = (item, color, arrow) => {
    const from = anchorOf(item.fromId);
    const to = anchorOf(item.toId);
    if (!from || !to) return;
    const alpha = item.near === false ? VOLUME_LINK_FAR : 1;
    out.push(
      volumeLine([from, to], alpha === 1 ? color : volumeFade(color, alpha), { width: VOLUME_LINK_WIDTH, arrow }),
    );
    out.push(
      volumeLine([from, to], volumeFade(color, VOLUME_LINK_THROUGH * alpha), {
        width: VOLUME_LINK_THROUGH_WIDTH,
        dash: VOLUME_LINK_DASH,
        arrow,
        layer: VOLUME_LAYER_MARK,
      }),
    );
  };
  for (const line of (links && links.lines) || []) pair(line, VOLUME_LINK_COLOR, true);
  for (const tie of (links && links.ties) || []) pair(tie, VOLUME_TIE_COLOR, false);
  for (const group of (links && links.groups) || []) {
    const points = (group.markIds || []).map((id) => anchorOf(id)).filter(Boolean);
    if (points.length < 2) continue;
    const alpha = group.near === false ? VOLUME_LINK_FAR : 1;
    // Кольцом по углу вокруг середины: тождество — не цепь, у него нет ни
    // начала, ни направления, и замкнутая линия говорит об этом сама.
    const centre = {
      x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
      y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
    };
    const ring = [...points].sort(
      (first, second) =>
        Math.atan2(first.y - centre.y, first.x - centre.x) - Math.atan2(second.y - centre.y, second.x - centre.x),
    );
    out.push(volumeLine(ring, volumeFade(VOLUME_LINK_COLOR, alpha), { closed: true, dash: VOLUME_LINK_DASH, width: 1.4 }));
    out.push(
      volumeLine(ring, volumeFade(VOLUME_LINK_COLOR, VOLUME_LINK_THROUGH * alpha), {
        closed: true,
        dash: VOLUME_LINK_DASH,
        width: 1,
        layer: VOLUME_LAYER_MARK,
      }),
    );
  }
  return out;
}
