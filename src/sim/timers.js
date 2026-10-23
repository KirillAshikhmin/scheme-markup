// Виртуальное время имитации: очередь событий (таск 02 сценариев; истории 3.2–3.4).
//
// Слова спецификации: шаг часов — «события внутри шага срабатывают по порядку,
// каждое со своим временем», перевод назад «ничего не запускает; задержки ждут
// своего времени». Сюда встают задержки блоков, `setTimeout`/`setInterval`
// скриптов, срабатывания планировщика и края периодов — одним способом, и
// исполняет их одна очередь.
//
// Время — местные миллисекунды часов имитации (`clockMath.js`, «время одним
// числом»). Сама очередь часов не знает: ей говорят «дойди до этого мига», а
// она рассказывает, на каком миге сейчас исполняется событие (`setNow`), —
// чтобы каждое событие видело своё время, а не конец шага.
//
// Устройство — двоичная куча по (время, номер постановки): одновременные
// события идут в порядке постановки. Отмена не роется в куче, а гасит запись;
// погашенные снимаются с вершины по дороге.

/**
 * Предохранитель шага: больше стольких событий за один `runUntil` не
 * исполняется. Столько же берёт ScenarioSimulator Sprut.Hub_Tools — сценарий,
 * который ставит себе таймер «через 0 мс» в ответ на свой же таймер, иначе
 * повесил бы страницу в одном миге.
 */
export const SIM_TIMERS_RUN_MAX = 100000;

/**
 * Очередь событий виртуального времени.
 *
 * - `add(atMs, fn, tag?) -> id` — событие на миг `atMs`; `fn(at)` получит своё
 *   время. `tag` — метка для `cancelTag` (например, «задержка №2 сценария»).
 * - `cancel(id)`, `cancelTag(tag)` — снять; снятое не исполнится, даже если
 *   стоит в том же миге, что исполняемое сейчас.
 * - `nextAt(all?) -> ms | null` — ближайшее событие; `null` — ничего не ждёт.
 *   **Фоновые** события (`add(…, {background: true})`, шаг климата дома)
 *   в ответ не идут: «ничего не запланировано» и «к следующему событию»
 *   говорят о сценариях и устройствах, а не о том, что воздух остывает. С
 *   `all` — идут: так поток будит себя вовремя.
 * - `runUntil(simMs, setNow?) -> {ran, cut}` — исполнить всё, что наступает не
 *   позже `simMs`, по порядку. Перед каждым событием — `setNow(его время)`,
 *   в конце — `setNow(simMs)`. Поставленное по ходу шага исполняется в том же
 *   шаге, если умещается в нём; поставленное в прошлое — в текущий миг (время
 *   назад не идёт). `cut` — сработал предохранитель: время осталось на миге
 *   последнего исполненного события, остальное ждёт в очереди.
 *   Ошибка события летит наружу; очередь при этом цела, следующий
 *   `runUntil` продолжит со следующего события.
 * - `clear()`, `size()` — снять всё и сколько ждёт.
 */
export function simTimers() {
  const heap = [];
  const live = new Map();
  let seq = 0;
  let lastId = 0;
  // Миг, на котором очередь последний раз остановилась: событие, поставленное
  // в прошлое между шагами, исполняется не раньше него.
  let now = -Infinity;

  function before(a, b) {
    return a.at < b.at || (a.at === b.at && a.seq < b.seq);
  }

  function up(index) {
    let at = index;
    while (at > 0) {
      const parent = (at - 1) >> 1;
      if (!before(heap[at], heap[parent])) break;
      [heap[at], heap[parent]] = [heap[parent], heap[at]];
      at = parent;
    }
  }

  function down(index) {
    let at = index;
    for (;;) {
      const left = at * 2 + 1;
      const right = left + 1;
      let best = at;
      if (left < heap.length && before(heap[left], heap[best])) best = left;
      if (right < heap.length && before(heap[right], heap[best])) best = right;
      if (best === at) return;
      [heap[at], heap[best]] = [heap[best], heap[at]];
      at = best;
    }
  }

  function pop() {
    const top = heap[0];
    const last = heap.pop();
    if (heap.length > 0) {
      heap[0] = last;
      down(0);
    }
    return top;
  }

  /** Вершина кучи без погашенных записей. */
  function head() {
    while (heap.length > 0 && heap[0].gone) pop();
    return heap.length > 0 ? heap[0] : null;
  }

  function add(atMs, fn, tag, options = null) {
    const at = Number(atMs);
    if (!Number.isFinite(at)) throw new TypeError("simTimers.add: time must be a finite number");
    if (typeof fn !== "function") throw new TypeError("simTimers.add: handler must be a function");
    lastId += 1;
    const background = Boolean(options && options.background === true);
    const entry = { id: lastId, at, seq: seq++, fn, tag: tag === undefined ? null : tag, gone: false, background };
    heap.push(entry);
    up(heap.length - 1);
    live.set(entry.id, entry);
    return entry.id;
  }

  function cancel(id) {
    const entry = live.get(id);
    if (!entry) return;
    entry.gone = true;
    live.delete(id);
  }

  function cancelTag(tag) {
    for (const entry of [...live.values()]) {
      if (entry.tag === tag) cancel(entry.id);
    }
  }

  function nextAt(all = false) {
    const top = head();
    if (!top) return null;
    if (all || !top.background) return top.at;
    let best = null;
    for (const entry of live.values()) {
      if (entry.background) continue;
      if (best === null || entry.at < best) best = entry.at;
    }
    return best;
  }

  function runUntil(simMs, setNow) {
    const until = Number(simMs);
    const tell = typeof setNow === "function" ? setNow : () => {};
    let ran = 0;
    // Время назад (часы перевели раньше) — нижняя граница уходит вместе с ним.
    let cursor = Math.min(now, until);
    for (;;) {
      const top = head();
      if (!top || top.at > until) break;
      if (ran >= SIM_TIMERS_RUN_MAX) return { ran, cut: true };
      pop();
      live.delete(top.id);
      top.gone = true;
      const at = Math.max(top.at, cursor);
      cursor = at;
      now = at;
      ran += 1;
      tell(at);
      top.fn(at);
    }
    if (Number.isFinite(until)) {
      now = until;
      tell(until);
    }
    return { ran, cut: false };
  }

  function clear() {
    for (const entry of live.values()) entry.gone = true;
    live.clear();
    heap.length = 0;
    now = -Infinity;
  }

  return { add, cancel, cancelTag, nextAt, runUntil, clear, size: () => live.size };
}
