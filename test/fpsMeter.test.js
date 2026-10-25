// Счётчик кадров «Объёма» по адресу `?fps` (`src/fpsMeter.js`): включение
// адресом и счёт темпа и времени кадра за окно.
import test from "node:test";
import assert from "node:assert/strict";

import { FPS_GAP_MS, FPS_WINDOW_MS, createFpsMeter, fpsMeterOn } from "../src/fpsMeter.js";

test("счётчик включается только адресом: ?fps, ?fps=1, &fps, #fps", () => {
  for (const search of ["?fps", "?fps=1", "?a=1&fps", "?fps&b=2"]) assert.equal(fpsMeterOn(search, ""), true, search);
  assert.equal(fpsMeterOn("", "#fps"), true);
  for (const search of ["", "?fpsx", "?myfps", "?a=fps"]) assert.equal(fpsMeterOn(search, ""), false, search);
});

test("темп — по интервалам между кадрами подряд, простой в счёт не идёт; время кадра — среднее и наибольшее", () => {
  const meter = createFpsMeter();
  assert.equal(meter.read(0).fps, null, "без кадров темпа нет");
  // 30 кадров по 20 мс, каждый считается 4 мс, последний — 10 мс.
  for (let i = 0; i < 30; i += 1) meter.frame(i * 20, i * 20 + (i === 29 ? 10 : 4), 600);
  const read = meter.read(29 * 20 + 10);
  assert.equal(Math.round(read.fps), 50);
  assert.equal(read.maxMs, 10);
  assert.ok(Math.abs(read.ms - (29 * 4 + 10) / 30) < 1e-9);
  assert.equal(read.polygons, 600);
  // Пауза дольше FPS_GAP_MS — простой, а не медленный кадр.
  meter.frame(29 * 20 + FPS_GAP_MS + 100, 29 * 20 + FPS_GAP_MS + 104, 610);
  assert.equal(Math.round(meter.read(29 * 20 + FPS_GAP_MS + 104).fps), 50);
  // Окно ушло вперёд — старые кадры забыты.
  assert.equal(meter.read(29 * 20 + FPS_GAP_MS + 104 + FPS_WINDOW_MS + 1).frames, 0);
});
