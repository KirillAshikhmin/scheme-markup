// Заставка загрузки: шаги бандла (правка без автопилота, 2026-11-20).
//
// Саму заставку рисует маленький скрипт в начале страницы (`src/splash.html`):
// он работает, пока этот бандл ещё едет. Доехав, бандл говорит ему, где он, —
// и вторая часть полосы прогресса идёт по настоящим шагам, а не по ожиданию.
// Заставки может не быть вовсе (страница собрана без неё, тесты, поток
// имитации) — тогда шаги молча никуда не идут.

/** Шаги бандла по порядку: разобран, старт приложения, панели собраны, готово. */
export const SPLASH_MARKS = Object.freeze(["parsed", "start", "panels", "done"]);

/** Сообщить заставке о шаге. Чужое имя и отсутствие заставки — не ошибка. */
export function splashMark(name) {
  if (!SPLASH_MARKS.includes(name)) return false;
  const host = typeof window !== "undefined" ? window.schemeSplash : null;
  if (!host || typeof host.mark !== "function") return false;
  try {
    host.mark(name);
  } catch (error) {
    return false;
  }
  return true;
}
