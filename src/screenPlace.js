// Одно место и один масштаб на три режима (требование G276, таск 178; дефект
// D59, таск 193) и память вида между перезагрузками (G294).
//
// Слова заказчика в таске 178: «При переключении Схема - Чертёж - объём мы
// должны находиться в одном месте… центр схемы\чертежа это расположение камеры
// в объёме. Ну и учитывай что может попасть на стены и т.д. тогда сдвигай».
// Его же слова в таске 193: «сейчас при переключении я не остаюсь там же,
// точнее не всегда работает и уровень зума меняется. Должно совпадать пиксель
// в пиксель».
//
// ——— почему «не всегда работало» ———————————————————————————————————————
//
// Потому что мест было **три**, а не одно: план держал свой `state.view`,
// мастерская — свой `view` внутри себя, объём — где стоит человек. Этот модуль
// до таска 193 переносил место только **через объём**: мастерская говорила,
// где стоит, объём это читал на входе и оставлял просьбу на выходе. Переход
// «Схема → Чертёж» напрямую не переносил ничего вовсе, а масштаб не
// переносился ни на одном пути — ровно то, что заказчик и увидел.
//
// Теперь здесь лежит **одно состояние на три режима**: середина поля в
// миллиметрах чертежа, экранных точек на миллиметр и — с таска 227 — взгляд
// камеры объёма. Кто на экране — тот и пишет его (на каждый кадр), а остальные
// читают, когда их показывают. Второго счёта нет: `volumePlanCentre` объёма
// зовёт эти же функции.
//
// ——— каждое поле пишет своё и бережёт чужое (таск 227, G339) ——————————
//
// Слово заказчика: «направление камеры сохраняй». Направление легло **сюда**,
// в ту же запись, а не рядом с ней: место и взгляд — один ответ на вопрос «где
// я и куда смотрю», и хозяин у них один (правило T210). Вторая запись рядом
// означала бы второго хозяина и второй порядок старшинства.
//
// Владеют полями разные поверхности, и это не беспорядок, а то же правило:
//
//   `x, y`      — общие: место человека на плане, его пишут все трое;
//   `pxPerMm`   — плана и чертежа: у камеры приближения нет вовсе, и объём,
//                 записывая место, оставляет прежнее;
//   `look`      — только объёма: у плоских полей взгляда нет, и они, записывая
//                 место, оставляют прежний.
//
// То есть каждое поле пишет то, чем владеет, и **бережёт** то, чем не владеет.
// Поэтому «ушёл из объёма, повозил схему, вернулся» возвращает тот же взгляд:
// схема его не трогала.
//
// ——— почему это отдельный модуль, а не поле состояния ——————————————————
//
// Потому что у режимов разные системы координат, и свести их можно только в
// миллиметрах чертежа: у плана вид задан в пикселях подложки (`state.view`), у
// мастерской — в миллиметрах, у объёма — в миллиметрах же, но третьей осью.
// Состояние приложения хранит вид плана и перерисовывает холст на каждую его
// правку — положи сюда же место чертежа, и холст стал бы перерисовываться от
// чужого переключения.
//
// ——— где моста нет ————————————————————————————————————————————————————
//
// Перевод «доля плана ↔ миллиметр чертежа» держится на двух половинах:
// калибровке (пикселей на метр) и привязке (где нуль чертежа на плане). Нет
// хотя бы одной — обе функции модели отвечают `null`, и перенос молча не
// делается: каждое поле остаётся там, где стояло. Соврать тут нечем — у плана
// без калибровки миллиметра не существует.
//
// ——— «чьё это место» ——————————————————————————————————————————————————
//
// У записи есть отметка (`stamp`), которая растёт на каждую запись. Поверхность
// помнит отметку своей последней записи и читает место только тогда, когда она
// другая, — то есть когда место поставил **кто-то другой**. Без этого
// спрятанная поверхность, которая всё ещё перерисовывается (мастерская рисует
// кадр и на чужом режиме), перебивала бы своим старым местом то, куда уехало
// поле на экране.
//
// ——— и «чья это рука» (дефект D61) ————————————————————————————————————
//
// Слова заказчика: «если схему или чертёж сдвинуть и переключиться на другой
// вариант то кидает туда, где стоит камера в Объёме. Последнее движение на
// любом из 3 видов должно сохраняться».
//
// Отметки для этого мало: она отвечает «чья запись», а спор был о том, **чья
// рука**. Объём, собранный один раз, живёт дальше за кадром, и его подписка
// писала место камеры на всякую смену режима — в том числе на «Схема →
// Чертёж», где объёма не было ни до, ни после. Чертёж честно читал чужую
// запись и вставал по камере, а не по схеме, которую человек только что
// двигал.
//
// Поэтому у записи есть хозяин: **пишет только то поле, которое на экране**.
// Правило одно на три вида и живёт здесь, а не тремя уговорами в трёх файлах:
// уговор можно забыть, заводя четвёртую поверхность, а отказ в записи — нет.
import { findScheme, planFractionToMm, planMmToFraction, planPixelsPerMeter } from "./model.js";
import { planToScreen, screenToPlan } from "./render.js";

/** Общее место: `{schemeId, x, y, pxPerMm, stamp}` или `null`. */
let place = null;
let placeStamp = 0;
const listeners = new Set();
// Какое поле сейчас на экране. Ставит его каркас — `app.setScreen`/`setState`,
// **до** того, как разбудит подписчиков: к мигу, когда поверхности узнают о
// новом режиме, хозяин записи уже новый.
//
// `null` — никто не сказал (так живут тесты и первые миллисекунды страницы, до
// `startApp`): тогда пишет кто угодно. Поверхности в этот миг ещё не собраны и
// кадров не рисуют.
let owner = null;

const placeOf = (schemeId, pointMm) => {
  if (!schemeId || !pointMm) return null;
  const x = Number(pointMm.x);
  const y = Number(pointMm.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { schemeId, x, y };
};

/**
 * Кто сейчас на экране (дефект D61). Зовёт это каркас на каждую смену режима —
 * и только он: поверхность о себе этого не объявляет, иначе двое сразу считали
 * бы себя хозяевами.
 */
export function screenPlaceScreen(screen) {
  owner = screen || null;
}

/**
 * Поле, которое на экране, говорит, где стоит середина его кадра и сколько в
 * ней экранных точек на миллиметр. `from` — чьё это движение: `"scheme"`,
 * `"drawing"` или `"volume"`. `pxPerMm` необязателен: объём масштабом не
 * владеет вовсе и оставляет прежний — вернувшись, человек видит то
 * приближение, которое выбрал сам.
 *
 * **Пишет только то поле, которое на экране** — и это проверяется здесь, а не
 * тремя уговорами в трёх файлах (дефект D61). Поверхности живут дальше за
 * кадром: объём, собранный один раз, перерисовывается и в чужом режиме, и его
 * запись — место камеры — перебивала сдвиг схемы, сделанный человеком секунду
 * назад. Старшинство у **последнего движения человека**, а движение человека —
 * это движение того поля, на которое он в этот миг смотрит.
 *
 * Возвращает отметку записи — её зовущий запоминает своей.
 */
export function screenPlaceSet(from, schemeId, pointMm, options = {}) {
  if (owner !== null && from !== owner) return placeStamp;
  const next = placeOf(schemeId, pointMm);
  if (!next) return placeStamp;
  const same = place && place.schemeId === schemeId;
  const scale = Number(options.pxPerMm);
  next.pxPerMm = Number.isFinite(scale) && scale > 0 ? scale : same ? place.pxPerMm : null;
  // Взгляд — поле объёма, и плоские его **берегут**: записывая место, они о нём
  // не говорят ничего, и он остаётся прежним (таск 227). Та же бережность, с
  // какой объём оставляет чужой `pxPerMm`.
  const look = screenPlaceLookFrom(options.look);
  next.look = look || (same ? place.look : null);
  // Запись, ничего не меняющая, не двигает отметку: мастерская и холст говорят
  // это на каждый кадр, и память вида иначе писалась бы в хранилище впустую.
  if (
    place &&
    place.schemeId === next.schemeId &&
    place.x === next.x &&
    place.y === next.y &&
    place.pxPerMm === next.pxPerMm &&
    sameLook(place.look, next.look)
  ) {
    return placeStamp;
  }
  placeStamp += 1;
  place = { ...next, stamp: placeStamp };
  for (const listener of [...listeners]) {
    try {
      listener(place);
    } catch (error) {
      // Слушатель — память вида; его беда не повод ронять кадр поля.
    }
  }
  return placeStamp;
}

/** Общее место этой схемы: `{x, y, pxPerMm, look, stamp}` или `null`. */
export function screenPlaceOf(schemeId) {
  if (!place || !schemeId || place.schemeId !== schemeId) return null;
  return {
    x: place.x,
    y: place.y,
    pxPerMm: place.pxPerMm,
    look: place.look ? { ...place.look } : null,
    stamp: place.stamp,
  };
}

/** Забыть всё: новый объект, закрытая схема. */
export function screenPlaceForget() {
  place = null;
  return placeStamp;
}

/** Кому сказать, что место сменилось (память вида). Возвращает отписку. */
export function screenPlaceWatch(listener) {
  if (typeof listener !== "function") return () => {};
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Поставить место из памяти — не от поверхности, а из настроек браузера.
 * Отдельная дверь нарочно: у неё другое правило старшинства (выбор человека
 * старше сохранённого, D54), и решает его тот, кто память поднимает.
 */
export function screenPlaceRestore(schemeId, saved) {
  const next = screenPlaceFrom(saved);
  if (!next) return 0;
  // Мимо хозяина (D61): память — не поле, она поднимает то самое последнее
  // движение, которым человек закончил прошлый сеанс, и спорить ей не с кем —
  // ни одно поле ещё ничего не нарисовало.
  return screenPlaceSet(owner, schemeId, next, { pxPerMm: next.pxPerMm, look: next.look });
}

/**
 * Что из настроек годится в место. Мусор (чужая версия, правка руками)
 * отбрасывается молча: лучше прежнее поведение, чем поле, уехавшее в `NaN`.
 */
export function screenPlaceFrom(value) {
  if (!value || typeof value !== "object") return null;
  const x = Number(value.x);
  const y = Number(value.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const scale = Number(value.pxPerMm);
  return {
    x,
    y,
    pxPerMm: Number.isFinite(scale) && scale > 0 ? scale : null,
    look: screenPlaceLookFrom(value.look),
  };
}

// ——— взгляд камеры объёма (таск 227, G339) ———————————————————————————————
//
// `{view, yaw, pitch, reach}`: каким глазом смотрели (первым лицом или
// обзором), рысканье и наклон в радианах, а у обзора ещё и мера — докуда он
// достаёт до пола. Меру держим потому, что **одного направления мало**: тот же
// угол с другой высоты показывает другую картинку, и «смотрит туда же» без неё
// не получается. У первого лица меры нет: там высота глаза — это стойка.
export const SCREEN_LOOK_VIEWS = ["person", "around"];

/** Что годится во взгляд. Мусор отбрасывается молча, как и всё в этой записи. */
export function screenPlaceLookFrom(value) {
  if (!value || typeof value !== "object") return null;
  if (!SCREEN_LOOK_VIEWS.includes(value.view)) return null;
  const yaw = Number(value.yaw);
  const pitch = Number(value.pitch);
  if (!Number.isFinite(yaw) || !Number.isFinite(pitch)) return null;
  const look = { view: value.view, yaw, pitch };
  const reach = Number(value.reach);
  if (look.view === "around" && Number.isFinite(reach) && reach > 0) look.reach = reach;
  return look;
}

function sameLook(a, b) {
  if (!a || !b) return a === b || (!a && !b);
  return a.view === b.view && a.yaw === b.yaw && a.pitch === b.pitch && (a.reach || null) === (b.reach || null);
}

/** Что кладётся в настройки: только числа, и округлённые. */
export function screenPlaceStored(value) {
  const next = screenPlaceFrom(value);
  if (!next) return null;
  const stored = { x: Math.round(next.x), y: Math.round(next.y) };
  // Масштаб округляется до шестого знака: в хранилище незачем двадцать цифр
  // дробной части, а пиксель на миллиметр — это уже лупа.
  if (next.pxPerMm) stored.pxPerMm = Math.round(next.pxPerMm * 1e6) / 1e6;
  // Углы — в радианах и до четвёртого знака: это шесть тысячных градуса, мельче
  // которых человек не целится, а в хранилище экономит половину строки.
  if (next.look) {
    stored.look = {
      view: next.look.view,
      yaw: Math.round(next.look.yaw * 1e4) / 1e4,
      pitch: Math.round(next.look.pitch * 1e4) / 1e4,
    };
    if (next.look.reach) stored.look.reach = Math.round(next.look.reach);
  }
  return stored;
}

// ——— план: доли подложки ↔ миллиметры чертежа ————————————————————————
//
// Обе половины живут здесь, потому что обе нужны и холсту, и объёму, и памяти
// вида. Арифметика взята у моста кадра (`render.drawingBridge`): экранных
// точек на миллиметр у плана — это `zoom · пикселей на метр / 1000`.

/** Экранных точек на миллиметр у плана при этом масштабе. `0` — моста нет. */
export function screenPlacePlanScale(project, schemeId, view) {
  const perMeter = planPixelsPerMeter(project, schemeId);
  if (!(perMeter > 0)) return 0;
  const zoom = Number(view && view.zoom) > 0 ? Number(view.zoom) : 1;
  return (zoom * perMeter) / 1000;
}

/** Масштаб плана, у которого в миллиметре столько экранных точек. `0` — моста нет. */
export function screenPlacePlanZoom(project, schemeId, pxPerMm) {
  const perMeter = planPixelsPerMeter(project, schemeId);
  const scale = Number(pxPerMm);
  if (!(perMeter > 0) || !(scale > 0)) return 0;
  return (scale * 1000) / perMeter;
}

/**
 * Где стоит план: середина поля в миллиметрах чертежа плюс масштаб.
 * `null` — моста нет (нет калибровки, нет привязки или нет схемы).
 */
export function screenPlacePlanRead(project, schemeId, box, view) {
  if (!project || !schemeId || !box || !(box.width > 0) || !(box.height > 0)) return null;
  const scheme = findScheme(project, schemeId);
  if (!scheme) return null;
  const point = screenToPlan({ x: box.width / 2, y: box.height / 2 }, scheme, view);
  const at = planFractionToMm(project, schemeId, point);
  if (!at) return null;
  return { x: at.x, y: at.y, pxPerMm: screenPlacePlanScale(project, schemeId, view) };
}

/**
 * Вид плана, у которого середина поля смотрит на это место тем же масштабом.
 *
 * `place.pxPerMm` задаёт приближение, и это половина «пиксель в пиксель» (D59):
 * у плана и у чертежа после перехода одинаковы и середина, и число точек на
 * миллиметр, значит всякая точка чертежа стоит под той же точкой экрана. Нет
 * `pxPerMm` (так приходит место из объёма — камера масштабом не владеет) —
 * остаётся прежний масштаб поля.
 */
export function screenPlacePlanView(project, schemeId, box, next, view) {
  if (!project || !schemeId || !box || !(box.width > 0) || !(box.height > 0)) return null;
  const scheme = findScheme(project, schemeId);
  if (!scheme || !next) return null;
  const point = planMmToFraction(project, schemeId, next);
  if (!point) return null;
  const asked = screenPlacePlanZoom(project, schemeId, next.pxPerMm);
  const zoom = asked > 0 ? asked : Number(view && view.zoom) > 0 ? Number(view.zoom) : 1;
  const at = planToScreen(point, scheme, { zoom, offsetX: 0, offsetY: 0 });
  return { zoom, offsetX: box.width / 2 - at.x, offsetY: box.height / 2 - at.y };
}
