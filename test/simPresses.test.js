// Распознавание нажатий (таск 04 сценариев, история 2.6; `interfaces.md` —
// строка `sim/presses.js`). Слова спецификации: «щелчок — одиночное, двойной
// щелчок (≤ 400 мс) — двойное, удержание ≥ 500 мс — долгое; палец так же; в
// «Объёме» клавиша `E` … теми же правилами; одиночное не срабатывает раньше,
// чем истекло окно двойного». Время в тестах — миллисекунды от нуля.
import test from "node:test";
import assert from "node:assert/strict";

import { PRESS_DOUBLE_MS, PRESS_LONG_MS, pressDetector, pressEventValue } from "../src/sim/presses.js";

// Всё, что распознано к мигу `t`: `due` отдаёт по одному.
function drain(detector, t) {
  const out = [];
  for (let press = detector.due(t); press; press = detector.due(t)) out.push(press);
  return out;
}

test("окно двойного — 400 мс, порог долгого — 500 мс (спецификация, история 2.6)", () => {
  assert.equal(PRESS_DOUBLE_MS, 400);
  assert.equal(PRESS_LONG_MS, 500);
});

test("щелчок — одиночное, но не раньше, чем истекло окно двойного", () => {
  const detector = pressDetector();
  assert.equal(detector.nextDue(), null, "пустой распознаватель чего-то ждёт");
  detector.down(1000);
  detector.up(1100);
  assert.equal(detector.nextDue(), 1500, "одиночное ждёт не конца окна от отпускания");
  assert.deepEqual(drain(detector, 1499), [], "одиночное раньше окна двойного");
  assert.deepEqual(drain(detector, 1500), ["single"]);
  assert.deepEqual(drain(detector, 5000), [], "одиночное пришло дважды");
  assert.equal(detector.nextDue(), null);
});

test("два щелчка в окне — одно двойное, без одиночных", () => {
  const detector = pressDetector();
  detector.down(0);
  detector.up(80);
  detector.down(300);
  assert.deepEqual(drain(detector, 300), ["double"], "двойное не узнано на втором нажатии");
  detector.up(380);
  assert.deepEqual(drain(detector, 3000), [], "после двойного пришло ещё что-то");
  // На самой границе окна — тоже двойное: «≤ 400 мс».
  const edge = pressDetector();
  edge.down(0);
  edge.up(100);
  edge.down(500);
  assert.deepEqual(drain(edge, 500), ["double"], "второй щелчок ровно на границе окна — не двойное");
});

test("удержание ≥ 500 мс — долгое, оно приходит, пока клавиша ещё зажата", () => {
  const detector = pressDetector();
  detector.down(200);
  assert.equal(detector.nextDue(), 700);
  assert.deepEqual(drain(detector, 699), []);
  assert.deepEqual(drain(detector, 700), ["long"]);
  detector.up(1500);
  assert.deepEqual(drain(detector, 5000), [], "отпускание после долгого дало ещё нажатие");
  // Отпустили ровно на пороге, не спросив раньше, — всё равно долгое.
  const edge = pressDetector();
  edge.down(0);
  edge.up(500);
  assert.deepEqual(drain(edge, 2000), ["long"]);
});

test("повтор клавиши `E` при удержании не множит нажатий", () => {
  const detector = pressDetector();
  // Браузер шлёт keydown повторами, пока клавиша зажата.
  detector.down(0);
  detector.down(30);
  detector.down(60);
  detector.up(150);
  assert.deepEqual(drain(detector, 600), ["single"]);
  const held = pressDetector();
  held.down(0);
  for (let t = 30; t < 900; t += 30) held.down(t);
  held.up(900);
  assert.deepEqual(drain(held, 3000), ["long"], "повторы при удержании сломали долгое");
});

test("второе нажатие после окна: сначала прежнее одиночное, потом новое", () => {
  const detector = pressDetector();
  detector.down(0);
  detector.up(100);
  // Распознаватель не спрашивали, а следующее нажатие пришло через секунду.
  detector.down(1100);
  assert.deepEqual(drain(detector, 1100), ["single"], "прежнее одиночное потерялось");
  detector.up(1200);
  assert.deepEqual(drain(detector, 1600), ["single"]);
  // Отпускание без нажатия ничего не значит.
  const stray = pressDetector();
  stray.up(10);
  assert.deepEqual(drain(stray, 2000), []);
});

test("нажатие → значение события кнопки Sprut.Hub", () => {
  assert.equal(pressEventValue("single"), "SINGLE_PRESS");
  assert.equal(pressEventValue("double"), "DOUBLE_PRESS");
  assert.equal(pressEventValue("long"), "LONG_PRESS");
  assert.equal(pressEventValue("triple"), null);
  assert.equal(pressEventValue(undefined), null);
});
