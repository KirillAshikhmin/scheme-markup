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
  // Двенадцать вещей: шесть прежних, гардеробная, обувница и вешалка (подъём
  // предела тел до пятнадцати, G06) и телевизор, компьютерный стол с картиной
  // — ими меряется картинка на лице прибора (таск 255, G400).
  assert.equal(flat.project.schemeObjects.length, 12);
  // Два экрана сцены — вещи-устройства: без включённого устройства кадр
  // картинку не рисует вовсе, и мерить было бы нечего.
  assert.equal(flat.screens.length, 2);
  const hall = BENCH_SCENES.hall();
  assert.equal(hall.lamps.length, 20);
  assert.equal(hall.project.schemeObjects.length, 48);
  // Термостат — с таска 257 (G398): табло на его лице кладёт кадр, и без
  // поставленного прибора эта цена в замер не попала бы вовсе.
  assert.equal(flat.thermostats.length, 1);
  assert.equal(benchLive(flat).size, 8, "пять ламп, два экрана и термостат");
  assert.equal(benchCameras(flat).length, 24);
});

test("замер счёта: числа есть и кадр не пустой", () => {
  const result = benchCompute("flat", 1);
  // `one` и `next` — свет по частям (таск 253): первая зажжённая лампа и
  // следующая за ней.
  for (const key of ["scene", "light", "one", "next", "frame"]) assert.ok(Number.isFinite(result[key]) && result[key] >= 0, key);
  assert.ok(result.polys > 100, "кадр стенда почти пустой: " + result.polys);
  assert.equal(result.lamps, 5);
});
