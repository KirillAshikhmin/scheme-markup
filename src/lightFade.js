// Плавный свет (правка после сборки сценариев).
//
// Слова заказчика: «по свету — давай для всего света сделаем плавное включение
// и отключение». «Для всего» — это и лампы, и экран телевизора, и все три
// места, где дом виден: ореол на «Схеме», мини-план «Сценариев» и «Объём».
// Поэтому правило одно и живёт отдельно от них всех: кадр каждого места
// спрашивает его, что показать **сейчас**.
//
// Дом при этом не плавный: имитация переключает лампу сразу, сценарии и журнал
// видят настоящее значение. Плавность — только у картинки, как у настоящей
// лампы, которая разгорается за полсекунды, хотя реле щёлкнуло мгновенно.
//
// Что плавное: `fade` — насколько устройство сейчас «включено» (0…1) — и
// `level` — яркость, если её меняют ползунком или сценарием. Яркость гаснущей
// лампы не падает к нулю, а остаётся той, с какой она гасла: гаснет `fade`, и
// ореол и пятно тускнеют, не сжимаясь до самой тусклой лампы.

/** Сколько длится разгорание и угасание. */
export const LIGHT_FADE_MS = 600;

/** Виды состояния, которые светятся (`SIM_LIVE_KINDS`): свет и экран. */
const LIGHT_FADE_KINDS = new Set(["light", "tv"]);

/** Память плавности одного места: своя у «Схемы», мини-плана и «Объёма». */
export function lightFadeMemo() {
  return { marks: new Map() };
}

function lightFadeShare(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : fallback;
}

// Мягкий разгон и мягкая остановка: свет не дёргается на старте и не
// «упирается» в конец.
function lightFadeEase(t) {
  return t * t * (3 - 2 * t);
}

/**
 * Что показать сейчас. `live` — `Map<markId, {on, level, kind, …}>` (состояние
 * дома с видом знака), `memo` — `lightFadeMemo()`, `now` — миллисекунды кадра.
 *
 * Ответ — `{live, busy}`. Пока что-то разгорается или гаснет, `live` — новая
 * карта, где у света и экрана `on` значит «ещё виден», `level` — яркость сейчас,
 * `fade` — доля включённости; `busy` — кадр нужен ещё. Всё улеглось — та же
 * карта, что пришла: местам, которые помнят её по ссылке, ничего не меняется.
 *
 * Устройство, увиденное впервые, встаёт сразу: открыли «Объём» с горящим светом
 * — он горит, а не разгорается заново.
 */
export function lightFadeLive(live, memo, now) {
  if (!live || !memo) return { live, busy: false };
  const seen = new Set();
  const shown = new Map();
  let busy = false;
  for (const [markId, item] of live) {
    if (!item || !LIGHT_FADE_KINDS.has(item.kind)) continue;
    seen.add(markId);
    const on = item.on === true ? 1 : 0;
    let mark = memo.marks.get(markId);
    const level = on ? lightFadeShare(item.level, 1) : mark ? mark.toLevel : lightFadeShare(item.level, 1);
    if (!mark) {
      mark = { fromOn: on, toOn: on, fromLevel: level, toLevel: level, at: now };
      memo.marks.set(markId, mark);
    } else if (mark.toOn !== on || mark.toLevel !== level) {
      // Цель сменилась на полпути — новый отрезок начинается **оттуда, где свет
      // сейчас**, а не с прежнего конца: выключили недогоревшую лампу — она
      // гаснет с той яркости, до которой успела дойти.
      const now0 = lightFadeAt(mark, now);
      mark.fromOn = now0.fade;
      mark.fromLevel = now0.level;
      mark.toOn = on;
      mark.toLevel = level;
      mark.at = now;
    }
    const at = lightFadeAt(mark, now);
    if (at.moving) busy = true;
    shown.set(markId, at);
  }
  for (const markId of [...memo.marks.keys()]) if (!seen.has(markId)) memo.marks.delete(markId);
  if (!busy) return { live, busy: false };
  const out = new Map();
  for (const [markId, item] of live) {
    const at = shown.get(markId);
    out.set(markId, at ? { ...item, on: at.fade > 0, level: at.level, fade: at.fade } : item);
  }
  return { live: out, busy: true };
}

function lightFadeAt(mark, now) {
  const t = Math.max(0, Math.min(1, (now - mark.at) / LIGHT_FADE_MS));
  const k = lightFadeEase(t);
  return {
    fade: mark.fromOn + (mark.toOn - mark.fromOn) * k,
    level: mark.fromLevel + (mark.toLevel - mark.fromLevel) * k,
    moving: t < 1 && (mark.fromOn !== mark.toOn || mark.fromLevel !== mark.toLevel),
  };
}

/** Доля включённости записи состояния: у записи без плавности — по `on`. */
export function lightFadeOf(item) {
  if (!item) return 0;
  if (item.fade !== undefined) return lightFadeShare(item.fade, 0);
  return item.on === true ? 1 : 0;
}
