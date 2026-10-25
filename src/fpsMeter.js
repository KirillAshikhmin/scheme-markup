// Счётчик кадров «Объёма» по адресу страницы `?fps` (правка без автопилота,
// 2026-10-25). Частоту кадров на живом телефоне не мерил никто: в headless её
// видно, а у человека в руке — нет. Счётчик включается только адресом, в
// объект и в настройки не пишется ничего.
//
// Кадр «Объёма» рисуется по событию, а не постоянно (§6.1 карты), поэтому
// «кадров в секунду» — это темп, с которым поле успевает рисовать, пока его
// двигают: интервал между соседними кадрами, а не число кадров за секунду
// простоя. Время кадра — только счёт и вызовы холста в JS; заливку видеокарта
// делает потом, и её видно по темпу: не успевает — кадры реже.
//
// Чистый модуль: часы и узлы приходят снаружи, DOM нет.

/** За какое окно считаются темп и время кадра, мс. */
export const FPS_WINDOW_MS = 1000;
/** Пауза дольше этой — не темп, а простой: такой интервал в счёт не идёт, мс. */
export const FPS_GAP_MS = 250;

/** Включён ли счётчик по адресу: `?fps`, `?fps=1`, `&fps`, `#fps`. */
export function fpsMeterOn(search = "", hash = "") {
  return /(?:^|[?&#])fps(?:[=&#]|$)/.test(String(search || "")) || /(?:^|[#&])fps(?:[=&]|$)/.test(String(hash || ""));
}

/**
 * Счётчик: `frame(start, end, polygons)` — кадр рисовался с `start` по `end`
 * (мс одних часов), `read(now)` — `{fps, ms, maxMs, polygons, frames}` за
 * последнее окно; `fps` — `null`, пока кадров подряд меньше двух.
 */
export function createFpsMeter() {
  const frames = [];

  function trim(now) {
    while (frames.length > 0 && now - frames[0].start > FPS_WINDOW_MS) frames.shift();
  }

  return {
    frame(start, end, polygons = 0) {
      if (!Number.isFinite(start) || !Number.isFinite(end)) return;
      frames.push({ start, ms: Math.max(0, end - start), polygons: Number(polygons) || 0 });
      trim(end);
    },
    read(now) {
      trim(now);
      if (frames.length === 0) return { fps: null, ms: null, maxMs: null, polygons: null, frames: 0 };
      let gaps = 0;
      let span = 0;
      for (let i = 1; i < frames.length; i += 1) {
        const gap = frames[i].start - frames[i - 1].start;
        if (gap > 0 && gap <= FPS_GAP_MS) {
          gaps += 1;
          span += gap;
        }
      }
      const total = frames.reduce((sum, item) => sum + item.ms, 0);
      return {
        fps: gaps > 0 ? (1000 * gaps) / span : null,
        ms: total / frames.length,
        maxMs: Math.max(...frames.map((item) => item.ms)),
        polygons: frames[frames.length - 1].polygons,
        frames: frames.length,
      };
    },
  };
}
