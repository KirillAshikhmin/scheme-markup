// Распознавание нажатий клавиш и кнопок (таск 04 сценариев, история 2.6).
//
// Слова спецификации: «щелчок — одиночное, двойной щелчок (≤ 400 мс) —
// двойное, удержание ≥ 500 мс — долгое; палец так же; в «Объёме» клавиша `E`
// … теми же правилами; одиночное не срабатывает раньше, чем истекло окно
// двойного». Одно чистое правило на мышь, палец и клавишу: поверхность зовёт
// `down`/`up` со своим временем, а распознанное забирает `due` — сразу после
// события и в миг `nextDue()` (так одиночное приходит, когда окно двойного
// истекло, а долгое — пока клавиша ещё зажата, как у настоящей кнопки).
//
// Время — любое возрастающее число миллисекунд (`event.timeStamp`,
// `performance.now()`); распознаватель часов не читает.
//
// Правила на краях:
//   — окно двойного считается от отпускания первого нажатия до второго
//     нажатия, граница входит в окно: второе нажатие ровно через 400 мс —
//     двойное. Если в этот же миг раньше спросили `due`, одиночное уже ушло —
//     решает порядок вызовов;
//   — двойное узнаётся на втором нажатии, удержание после него долгим не
//     становится;
//   — повтор нажатия без отпускания (автоповтор `keydown`) ничего не значит;
//     отпускание без нажатия — тоже.

export const PRESS_DOUBLE_MS = 400;
export const PRESS_LONG_MS = 500;

const PRESS_EVENT_VALUES = Object.freeze({
  single: "SINGLE_PRESS",
  double: "DOUBLE_PRESS",
  long: "LONG_PRESS",
});

/**
 * Значение события кнопки Sprut.Hub (`ProgrammableSwitchEvent`) для нажатия:
 * `"single" → "SINGLE_PRESS"`, `"double" → "DOUBLE_PRESS"`, `"long" →
 * "LONG_PRESS"`; чужое слово — `null`.
 */
export function pressEventValue(press) {
  return Object.prototype.hasOwnProperty.call(PRESS_EVENT_VALUES, press) ? PRESS_EVENT_VALUES[press] : null;
}

/**
 * Распознаватель нажатий одной клавиши:
 * `{down(t), up(t), due(t) -> "single" | "double" | "long" | null, nextDue() -> t | null}`.
 *
 * `due(t)` отдаёт распознанное к мигу `t` по одному — звать, пока не `null`.
 * `nextDue()` — когда спросить в следующий раз (истечёт окно двойного или
 * наберётся порог долгого); `null` — ждать нечего.
 */
export function pressDetector() {
  // idle — свободна; held — первое нажатие зажато; waiting — отпущено, ждём
  // второго; done — нажатие уже распознано (долгое или двойное), ждём
  // отпускания.
  let phase = "idle";
  let downAt = 0;
  let upAt = 0;
  let lastAt = 0;
  const ready = [];

  // Сроки, истёкшие к мигу `t`: порог долгого и окно двойного.
  function expire(t) {
    if (phase === "held" && t - downAt >= PRESS_LONG_MS) {
      ready.push("long");
      phase = "done";
    } else if (phase === "waiting" && t - upAt >= PRESS_DOUBLE_MS) {
      ready.push("single");
      phase = "idle";
    }
  }

  function down(time) {
    const t = Number(time);
    lastAt = t;
    if (phase === "held" || phase === "done") return;
    if (phase === "waiting" && t - upAt <= PRESS_DOUBLE_MS) {
      ready.push("double");
      phase = "done";
      return;
    }
    expire(t);
    phase = "held";
    downAt = t;
  }

  function up(time) {
    const t = Number(time);
    lastAt = t;
    expire(t);
    if (phase === "held") {
      phase = "waiting";
      upAt = t;
    } else if (phase === "done") {
      phase = "idle";
    }
  }

  function due(time) {
    const t = Number(time);
    lastAt = Math.max(lastAt, t);
    expire(t);
    return ready.length > 0 ? ready.shift() : null;
  }

  function nextDue() {
    if (ready.length > 0) return lastAt;
    if (phase === "held") return downAt + PRESS_LONG_MS;
    if (phase === "waiting") return upAt + PRESS_DOUBLE_MS;
    return null;
  }

  return { down, up, due, nextDue };
}
