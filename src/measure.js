// Линейка: измерить расстояние в «Чертеже», «Схеме» и «Объёме» (таск 237, G356).
//
// Слова заказчика: «добавь в верхнюю панель рядом с кнопокй печати инструмент
// Линейка, что бы измерять расстояния. При чем он должен работать и в режиме
// Чертёж и схема и измерять в 2д так и в объёме, измеряя в 3д. В объёме начало
// и конец отрезка измеряемого может ставиться только на стены\пол\потолок, а не
// просто в случайную точку в объёме».
//
// ——— что здесь живёт и чего здесь нет ————————————————————————————————————
//
// Здесь — **отрезок и арифметика**: где стоят его концы, сколько между ними и
// какими словами это написать. Ни DOM, ни холста, ни объекта: модуль лежит в
// слое данных и правил, его читают три поверхности и кнопка в шапке.
//
// **Измерение не идёт в объект** (G68). Это мерка, а не разметка: ни в
// `project.json`, ни через `canvasCommit`, ни в файл, ни в настройки браузера —
// отрезок живёт ровно столько, сколько открыт инструмент, как живут выделение и
// фильтры. Поэтому и хранится он здесь, рядом с арифметикой, а не в состоянии
// сеанса приложения: второй конец ходит за курсором, и каждое движение мыши
// звало бы `setState` со всеми подписчиками.
//
// Включённость инструмента, наоборот, лежит **в состоянии сеанса**
// (`state.measuring`): её спрашивают три поля, кнопка в шапке и подсказки, и
// менять её надо так, чтобы все четверо узнали — то есть через `setState`.
//
// ——— один отрезок на поле, и он не исчезает сам ———————————————————————————
//
// Отрезков живёт **по одному на поле**: третий клик начинает новый, второй
// заканчивает прежний. Цепочки с накоплением длины заказчик не просил, а
// главное — число должно быть одно: два отрезка на поле заставляли бы глаз
// разбирать, какая подпись к какому.
//
// Готовый отрезок **остаётся на поле**, пока не начали новый: измеренное читают
// глазами, отводят взгляд в таблицу и возвращаются. Пропадай он на движение
// мыши — читать его было бы некогда.
//
// Поля у отрезков свои, потому что свои у них единицы: «Чертёж» меряет в целых
// миллиметрах (ADR 008), «Схема» — в долях плана (ADR 002), «Объём» — в
// миллиметрах чертежа с третьей осью. Отрезок помнит ещё и схему с объектом
// (`key`): сменили то или другое — мерка относилась к прежнему плану, и
// показывать её на новом нельзя.
import { formatMeters, planLengthMeters } from "./model.js";
import { strings, text } from "./strings.js";

/** Поля, где линейка работает. «Сценарии» меряют не расстояния. */
export const MEASURE_FIELDS = ["drawing", "scheme", "volume"];

/**
 * Цвет линейки — свой, и нарочно не служебный синий (`#0969da`), которым
 * нарисован отрезок калибровки масштаба. Жест у них один в один — две точки на
 * плане, — и спутать мерку с калибровкой значило бы однажды задать масштаб
 * линейкой. Этого цвета в сборке больше нет ни у чего.
 */
export const MEASURE_COLOR = "#d6336c";

const measureHeld = new Map();

/**
 * К чему привязан отрезок: объект и схема. `null` — привязывать не к чему, и
 * мерки тогда нет вовсе.
 */
export function measureKeyOf(state) {
  const projectId = state && state.project ? state.project.id : null;
  const schemeId = state && state.schemeId ? state.schemeId : null;
  if (!projectId || !schemeId) return null;
  return projectId + "|" + schemeId;
}

function measureSlot(field, key) {
  if (!key) return null;
  const held = measureHeld.get(field);
  // Сменили схему или объект — прежняя мерка относилась к другому плану.
  if (!held || held.key !== key) return null;
  return held;
}

/** Поставить конец отрезка. Третий раз начинает новый отрезок. */
export function measureAdd(field, key, point) {
  if (!key || !point) return null;
  const held = measureSlot(field, key);
  const next = held && held.a && !held.b ? { key, a: held.a, b: point, aim: null } : { key, a: point, b: null, aim: null };
  measureHeld.set(field, next);
  return next;
}

/**
 * Куда смотрит рука, пока второй конец не поставлен: число живое, пока тянут.
 * `true` — точка сменилась и поле стоит перерисовать.
 */
export function measureAim(field, key, point) {
  const held = measureSlot(field, key);
  if (!held || !held.a || held.b) return false;
  const was = held.aim;
  if (point && was && was.x === point.x && was.y === point.y && (was.z || 0) === (point.z || 0)) return false;
  if (!point && !was) return false;
  held.aim = point || null;
  return true;
}

/** Снять мерку этого поля. */
export function measureDrop(field) {
  if (!measureHeld.has(field)) return false;
  measureHeld.delete(field);
  return true;
}

/** Снять мерки всех полей — выход из инструмента и смена объекта. */
export function measureDropAll() {
  if (measureHeld.size === 0) return false;
  measureHeld.clear();
  return true;
}

/**
 * Концы отрезка для рисования: `{from, to, live}` или `null`.
 *
 * `live` — второй конец ещё не поставлен и идёт за рукой: подпись у такого
 * отрезка та же, а вид другой (пунктир), чтобы было видно, что он не готов.
 * `to: null` — поставлен только первый конец, а руки на поле нет.
 */
export function measureEnds(field, key) {
  const held = measureSlot(field, key);
  if (!held || !held.a) return null;
  if (held.b) return { from: held.a, to: held.b, live: false };
  return { from: held.a, to: held.aim || null, live: true };
}

/** Поставлен ли уже первый конец: по нему подсказка говорит, что делает клик. */
export function measureStarted(field, key) {
  const held = measureSlot(field, key);
  return Boolean(held && held.a && !held.b);
}

// ——— арифметика ———————————————————————————————————————————————————————————
//
// Третья ось необязательна: у плоских полей её нет, и ноль вместо неё даёт ту
// же формулу. Второго счёта расстояния здесь не появляется — одна функция на
// три поля.

/** Прямое расстояние между точками. Без третьей оси — обычная гипотенуза. */
export function measureSpan(a, b) {
  if (!a || !b) return 0;
  const dx = Number(b.x) - Number(a.x);
  const dy = Number(b.y) - Number(a.y);
  const dz = (Number(b.z) || 0) - (Number(a.z) || 0);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * Расстояние втроём: прямое, по полу и по высоте.
 *
 * Электрику разложение полезнее одного числа: кабель идёт по стенам и потолку,
 * а не по воздуху, и «4250 прямо» без «3200 по полу и 2800 по высоте» не
 * говорит, сколько провода заказывать.
 */
export function measureParts(a, b) {
  if (!a || !b) return { straight: 0, floor: 0, rise: 0 };
  const dx = Number(b.x) - Number(a.x);
  const dy = Number(b.y) - Number(a.y);
  const dz = (Number(b.z) || 0) - (Number(a.z) || 0);
  return { straight: Math.sqrt(dx * dx + dy * dy + dz * dz), floor: Math.hypot(dx, dy), rise: Math.abs(dz) };
}

/** Миллиметры словами — та же единица, что у длины стены в чертеже. */
export function measureMmText(value) {
  return text("measure.mm", { value: Math.round(Number(value) || 0) });
}

/** Подпись отрезка в «Чертеже»: целые миллиметры. */
export function measureDrawingLines(fromMm, toMm) {
  if (!fromMm || !toMm) return [];
  return [measureMmText(measureSpan(fromMm, toMm))];
}

/**
 * Подпись отрезка в «Схеме»: метры по калибровке — тем же счётом и тем же
 * числом, которым сборка пишет длину линейной метки (`planLengthMeters` плюс
 * `formatMeters`). Без калибровки метров у плана нет вовсе, и вместо числа
 * стоит причина: доли подложки длиной не являются.
 */
export function measurePlanLines(project, schemeId, from, to) {
  if (!from || !to) return [];
  const meters = planLengthMeters(project, schemeId, [from, to]);
  if (meters === null) return [strings.measure.noMeters];
  return [text("scale.meters", { value: formatMeters(meters) })];
}

/** Подпись отрезка в «Объёме»: прямое расстояние и разложение под ним. */
export function measureVolumeLines(from, to) {
  if (!from || !to) return [];
  const parts = measureParts(from, to);
  return [
    measureMmText(parts.straight),
    text("measure.volumeParts", { floor: measureMmText(parts.floor), rise: measureMmText(parts.rise) }),
  ];
}
