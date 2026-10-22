// Виртуальное время имитации: очередь событий (таск 02 сценариев, история 3.2).
//
// Слова спецификации: «события внутри шага срабатывают по порядку, каждое со
// своим временем» (3.2), «перевод часов назад ничего не запускает; задержки
// ждут своего времени» (3.4). Очередь — шов движка: задержки, таймеры
// скриптов, планировщик и края периодов встают в неё одним способом.
import test from "node:test";
import assert from "node:assert/strict";

import { SIM_TIMERS_RUN_MAX, simTimers } from "../src/sim/timers.js";

test("события исполняются строго по порядку времени, каждое видит своё время", () => {
  const timers = simTimers();
  let now = 0;
  const seen = [];
  const note = (name) => (at) => seen.push({ name, at, now });
  timers.add(300, note("c"));
  timers.add(100, note("a"));
  timers.add(200, note("b"));
  const setNow = (ms) => {
    now = ms;
  };
  const result = timers.runUntil(250, setNow);
  assert.deepEqual(seen, [
    { name: "a", at: 100, now: 100 },
    { name: "b", at: 200, now: 200 },
  ]);
  assert.equal(now, 250, "после шага время стоит на его конце");
  assert.deepEqual(result, { ran: 2, cut: false });
  assert.equal(timers.nextAt(), 300, "ближайшее — то, что не дошло");
  assert.equal(timers.size(), 1);
});

test("одновременные события — в порядке постановки; поставленные по ходу шага — в том же шаге", () => {
  const timers = simTimers();
  const seen = [];
  timers.add(100, () => seen.push("first"));
  timers.add(100, () => {
    seen.push("second");
    // Задержка изнутри события: попадает в шаг, если умещается в нём.
    timers.add(150, (at) => seen.push("inner@" + at));
    timers.add(100, () => seen.push("same-moment"));
    timers.add(400, () => seen.push("later"));
  });
  timers.add(100, () => seen.push("third"));
  timers.runUntil(300, () => {});
  assert.deepEqual(seen, ["first", "second", "third", "same-moment", "inner@150"]);
  assert.equal(timers.nextAt(), 400);
});

test("отмена по id и по метке; ближайшее не видит отменённых", () => {
  const timers = simTimers();
  const seen = [];
  const a = timers.add(100, () => seen.push("a"), "delay:1");
  timers.add(200, () => seen.push("b"), "delay:2");
  timers.add(300, () => seen.push("c"), "delay:2");
  timers.add(400, () => seen.push("d"));
  assert.equal(timers.nextAt(), 100);
  timers.cancel(a);
  assert.equal(timers.nextAt(), 200, "отменённое событие осталось ближайшим");
  timers.cancelTag("delay:2");
  assert.equal(timers.nextAt(), 400);
  timers.cancel(a);
  timers.cancel(9999);
  timers.runUntil(1000, () => {});
  assert.deepEqual(seen, ["d"]);
  assert.equal(timers.nextAt(), null, "пустая очередь — ничего не запланировано");
  // Отмена изнутри события: соседнее того же мига не исполняется.
  const late = [];
  let victim = null;
  timers.add(2000, () => timers.cancel(victim));
  victim = timers.add(2000, () => late.push("victim"));
  timers.runUntil(3000, () => {});
  assert.deepEqual(late, []);
});

test("время назад ничего не запускает, задержки ждут своего времени", () => {
  const timers = simTimers();
  const seen = [];
  let now = 0;
  const setNow = (ms) => {
    now = ms;
  };
  timers.add(10_000, (at) => seen.push(at));
  timers.runUntil(5000, setNow);
  timers.runUntil(1000, setNow);
  assert.deepEqual(seen, []);
  assert.equal(now, 1000, "часы встали назад");
  assert.equal(timers.nextAt(), 10_000, "задержка осталась на своём времени");
  timers.runUntil(10_000, setNow);
  assert.deepEqual(seen, [10_000], "событие ровно на конце шага исполняется");
});

test("событие, поставленное в прошлое по ходу шага, не уводит время назад", () => {
  const timers = simTimers();
  const seen = [];
  let now = 0;
  timers.add(500, () => timers.add(100, (at) => seen.push({ at, now })));
  timers.runUntil(1000, (ms) => {
    now = ms;
  });
  assert.deepEqual(seen, [{ at: 500, now: 500 }]);
  // И между шагами: очередь стоит на 1000 — событие на 200 исполнится в 1000.
  timers.add(200, (at) => seen.push({ at, now }));
  timers.runUntil(2000, (ms) => {
    now = ms;
  });
  assert.deepEqual(seen[1], { at: 1000, now: 1000 });
});

test("предохранитель: бесконечная цепочка одного мига обрывается, очередь цела", () => {
  const timers = simTimers();
  let count = 0;
  const again = () => {
    count += 1;
    timers.add(100, again);
  };
  timers.add(100, again);
  let now = 0;
  const result = timers.runUntil(200, (ms) => {
    now = ms;
  });
  assert.equal(result.cut, true);
  assert.equal(result.ran, SIM_TIMERS_RUN_MAX);
  assert.equal(count, SIM_TIMERS_RUN_MAX);
  assert.equal(now, 100, "оборванный шаг не делает вид, что дошёл до конца");
  assert.equal(timers.nextAt(), 100);
  timers.clear();
  assert.equal(timers.nextAt(), null);
  assert.equal(timers.size(), 0);
});

test("ошибка события летит наружу, очередь цела и продолжает со следующего", () => {
  const timers = simTimers();
  const seen = [];
  timers.add(100, () => {
    throw new Error("сценарий упал");
  });
  timers.add(200, () => seen.push(200));
  assert.throws(() => timers.runUntil(300, () => {}), /сценарий упал/);
  assert.equal(timers.nextAt(), 200);
  timers.runUntil(300, () => {});
  assert.deepEqual(seen, [200]);
  assert.throws(() => timers.add(Number.NaN, () => {}), TypeError);
  assert.throws(() => timers.add(1, null), TypeError);
});
