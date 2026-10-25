// Плотность холста «Объёма» на ходу (`volumeMotionRatio`, panels/volume.js):
// пальцем на ходу — `VOLUME_MOTION_RATIO`, стоя и мышью — по экрану.
import test from "node:test";
import assert from "node:assert/strict";

import { VOLUME_MOTION_RATIO, VOLUME_RATIO_MAX, volumeMotionRatio, volumeRatio } from "../src/panels/volume.js";

test("на ходу пальцем холст реже, стоя и мышью — по экрану", () => {
  const phone = volumeRatio(3);
  assert.equal(phone, VOLUME_RATIO_MAX);
  assert.equal(volumeMotionRatio(phone, { moving: true, touch: true }), VOLUME_MOTION_RATIO);
  assert.equal(volumeMotionRatio(phone, { moving: false, touch: true }), phone, "стоя кадр не чёткий");
  assert.equal(volumeMotionRatio(phone, { moving: true, touch: false }), phone, "мышью плотность тронута");
  // Экран и так реже — ниже него на ходу не опускаемся.
  assert.equal(volumeMotionRatio(1, { moving: true, touch: true }), 1);
  assert.equal(volumeMotionRatio(0.75, { moving: true, touch: true }), 0.75);
  assert.equal(volumeMotionRatio(undefined, {}), 1);
});
