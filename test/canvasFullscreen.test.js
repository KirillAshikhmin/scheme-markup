// Полный экран: кнопка в правом верхнем углу холста.
//
// Руками здесь проверяется вид, а числами — три решения, которые расходятся
// молча и дорого:
//
// 1. Даёт ли браузер полный экран вообще. У Safari дверь называется иначе, а
//    установленное приложение и встроенный фрейм не дают её вовсе — и тогда
//    кнопки не должно быть: кнопка, которая ничего не делает, хуже её
//    отсутствия.
// 2. Мы сейчас внутри или снаружи. Выйти можно мимо кнопки — Esc, жест, —
//    поэтому состояние спрашивается у документа, а не запоминается флагом.
// 3. Подпись говорит, что случится по нажатию, а не то, что сейчас.
import test from "node:test";
import assert from "node:assert/strict";
import {
  FULLSCREEN_EVENTS,
  canvasFullscreenLabel,
  canvasFullscreenOn,
  canvasFullscreenSupported,
} from "../src/canvas.js";
import { strings } from "../src/strings.js";

// Документ и элемент — простые объекты: DOM для этих ответов не нужен, и
// именно поэтому они здесь и проверяются.
const modernDoc = { fullscreenEnabled: true, fullscreenElement: null };
const modernEl = { requestFullscreen() {} };
const safariDoc = { webkitFullscreenEnabled: true, webkitFullscreenElement: null };
const safariEl = { webkitRequestFullscreen() {} };

test("обычный браузер и Safari — обе двери считаются открытыми", () => {
  assert.equal(canvasFullscreenSupported(modernDoc, modernEl), true);
  assert.equal(canvasFullscreenSupported(safariDoc, safariEl), true);
});

test("браузер сказал «нельзя» — кнопки нет", () => {
  // Установленное приложение и встроенный фрейм отвечают именно так.
  assert.equal(canvasFullscreenSupported({ fullscreenEnabled: false }, modernEl), false);
  assert.equal(canvasFullscreenSupported({ webkitFullscreenEnabled: false }, safariEl), false);
});

test("двери нет вовсе — кнопки нет", () => {
  assert.equal(canvasFullscreenSupported(modernDoc, {}), false);
  assert.equal(canvasFullscreenSupported(null, modernEl), false);
  assert.equal(canvasFullscreenSupported(modernDoc, null), false);
});

test("признака «можно» нет — спрашивать нечем, и решает сама дверь", () => {
  // Старый Safari про `fullscreenEnabled` не знает: отсутствие признака — это
  // не отказ, и по нему прятать кнопку нельзя.
  assert.equal(canvasFullscreenSupported({}, safariEl), true);
});

test("состояние берётся у документа, а не из памяти кнопки", () => {
  assert.equal(canvasFullscreenOn(modernDoc), false);
  assert.equal(canvasFullscreenOn({ fullscreenElement: {} }), true);
  assert.equal(canvasFullscreenOn({ webkitFullscreenElement: {} }), true);
  assert.equal(canvasFullscreenOn(null), false);
});

test("подпись говорит, что случится по нажатию", () => {
  assert.equal(canvasFullscreenLabel(false), strings.canvas.fullscreenEnter);
  assert.equal(canvasFullscreenLabel(true), strings.canvas.fullscreenExit);
  assert.notEqual(strings.canvas.fullscreenEnter, strings.canvas.fullscreenExit);
});

test("выход мимо кнопки слышен в обоих браузерах", () => {
  // Без второго имени кнопка в Safari осталась бы со значком «свернуть» на
  // обратно свёрнутом окне.
  assert.deepEqual(FULLSCREEN_EVENTS, ["fullscreenchange", "webkitfullscreenchange"]);
});
