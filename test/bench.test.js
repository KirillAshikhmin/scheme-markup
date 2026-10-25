// Стенд «Объёма» (tools/bench): сцены собираются командами модели и стенд
// отдаёт числа. Времени тест не проверяет — только то, что меряется то, что
// заявлено: лампы горят, вещи стоят, кадр не пустой.
import test from "node:test";
import assert from "node:assert/strict";

import { benchCompute } from "../tools/bench/volume.mjs";
import { BENCH_SCENES, benchCameras, benchLive } from "../tools/bench/scenes.mjs";

test("сцены стенда: квартира с мебелью и зал — лампы, вещи и двери на месте", () => {
  const flat = BENCH_SCENES.flat();
  assert.equal(flat.lamps.length, 5);
  assert.equal(flat.doors.length, 2);
  assert.equal(flat.project.schemeObjects.length, 6);
  const hall = BENCH_SCENES.hall();
  assert.equal(hall.lamps.length, 20);
  assert.equal(hall.project.schemeObjects.length, 48);
  assert.equal(benchLive(flat).size, 5);
  assert.equal(benchCameras(flat).length, 24);
});

test("замер счёта: числа есть и кадр не пустой", () => {
  const result = benchCompute("flat", 1);
  for (const key of ["scene", "light", "frame"]) assert.ok(Number.isFinite(result[key]) && result[key] >= 0, key);
  assert.ok(result.polys > 100, "кадр стенда почти пустой: " + result.polys);
  assert.equal(result.lamps, 5);
});
