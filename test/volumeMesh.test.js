// Сетка для отрисовки видеокартой (правка 2026-11-20, ADR 042): чистый счёт
// `volume/mesh.js` и довод сборки «круглые тела».
import test from "node:test";
import assert from "node:assert/strict";
import {
  VOLUME_ROUND_SIDES,
  volumeMeshBuild,
  volumeMeshColor,
  volumeMeshEarcut,
  volumeMeshLampJoin,
  volumeMeshLampPick,
  volumeModelFaces,
  volumeRoundWith,
} from "../src/volume.js";
import { modelCyl } from "../src/objectModels/kit.js";

const frame = { at: { x: 0, y: 0 }, u: { x: 1, y: 0 }, f: { x: 0, y: 1 }, widthMm: 400, depthMm: 400, heightMm: 500, bottomMm: 0 };
const stool = { key: "t", parts: [modelCyl("seat", { x: -0.5, y: -0.5, z: 0, width: 1, depth: 1, height: 1 })] };

test("отрезка ушей режет невыпуклый контур на n − 2 треугольника", () => {
  // Буква «Г»: шесть точек, четыре треугольника, площадь сохраняется.
  const xy = [0, 0, 4, 0, 4, 1, 1, 1, 1, 3, 0, 3];
  const tri = volumeMeshEarcut(xy);
  assert.equal(tri.length, 12);
  let area = 0;
  for (let i = 0; i < tri.length; i += 3) {
    const [a, b, c] = [tri[i], tri[i + 1], tri[i + 2]].map((at) => [xy[2 * at], xy[2 * at + 1]]);
    area += Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) / 2;
  }
  assert.equal(area, 6);
});

test("цвет линии читается из трёх записей", () => {
  assert.deepEqual(volumeMeshColor("#ff8000"), [255, 128, 0]);
  assert.deepEqual(volumeMeshColor("rgba(1, 2, 3, 0.5)"), [1, 2, 3]);
  assert.deepEqual(volumeMeshColor([9, 8, 7]), [9, 8, 7]);
  assert.deepEqual(volumeMeshColor(undefined, [5, 5, 5]), [5, 5, 5]);
});

test("грань становится треугольниками лицом к своей нормали, в метрах и осях сетки", () => {
  // Пол: нормаль вверх (z чертежа) — в сетке это ось Y.
  const floor = { p: [{ x: 0, y: 0, z: 0 }, { x: 1000, y: 0, z: 0 }, { x: 1000, y: 2000, z: 0 }, { x: 0, y: 2000, z: 0 }], n: { x: 0, y: 0, z: 1 }, rgb: [255, 255, 255] };
  const mesh = volumeMeshBuild([floor]);
  assert.equal(mesh.triangles, 2);
  assert.deepEqual([...mesh.solid.nor.slice(0, 3)], [0, 1, 0]);
  // Обход каждого треугольника — против часовой, если смотреть с нормали.
  const p = mesh.solid.pos;
  for (let i = 0; i < p.length; i += 9) {
    const u = [p[i + 3] - p[i], p[i + 4] - p[i + 1], p[i + 5] - p[i + 2]];
    const w = [p[i + 6] - p[i], p[i + 7] - p[i + 1], p[i + 8] - p[i + 2]];
    assert.ok(u[2] * w[0] - u[0] * w[2] > 0, "треугольник смотрит не туда");
  }
  assert.ok(Math.abs(Math.max(...p) - 2) < 1e-6);
  // Прозрачная грань уходит в своё тело и несёт альфу; двусторонняя — два лица.
  const glass = volumeMeshBuild([{ ...floor, clear: true, alpha: 0.25 }]);
  assert.equal(glass.solid.pos.length, 0);
  assert.equal(glass.clear.col[3], 0.25);
  assert.equal(volumeMeshBuild([{ ...floor, both: true }]).solid.pos.length, 36);
  // Линия — отрезками; замкнутая возвращается в начало.
  const line = { line: true, closed: true, color: "#000000", p: floor.p };
  assert.equal(volumeMeshBuild([line]).lines.pos.length, 4 * 6);
});

test("круглые тела — довод сборки: по умолчанию всё прежнее, с ним — 24 грани и пометка для сглаживания", () => {
  const plain = volumeModelFaces(frame, stool, [200, 200, 200]);
  // Восемь боков и крышки (днище на полу призма не рисует).
  assert.ok(plain.length >= 9 && plain.length <= 10);
  assert.ok(plain.every((face) => face.smooth === undefined));
  const round = volumeRoundWith(VOLUME_ROUND_SIDES, () => volumeModelFaces(frame, stool, [200, 200, 200]));
  assert.equal(round.length, plain.length + VOLUME_ROUND_SIDES - 8);
  assert.ok(round.every((face) => face.smooth === 1));
  // За собой довод снимается, и номера начинаются заново: две сборки одинаковы.
  assert.equal(volumeModelFaces(frame, stool, [200, 200, 200]).length, plain.length);
  const again = volumeRoundWith(VOLUME_ROUND_SIDES, () => volumeModelFaces(frame, stool, [200, 200, 200]));
  assert.deepEqual(again.map((face) => face.smooth), round.map((face) => face.smooth));
  // У сглаженного бока нормали вершин разные, у днища — одна.
  const mesh = volumeMeshBuild(round);
  const side = round.findIndex((face) => face.p.length === 4);
  const flat = volumeMeshBuild([round[side]]);
  const smooth = volumeMeshBuild(round, { keep: (face) => face.p.length === 4 });
  assert.equal(new Set([0, 3, 6].map((at) => [...flat.solid.nor.slice(at, at + 3)].join())).size, 1);
  assert.ok(new Set([0, 3, 6].map((at) => [...smooth.solid.nor.slice(at, at + 3)].map((v) => v.toFixed(3)).join())).size > 1);
  assert.ok(mesh.triangles > 24 * 2);
});

test("источники света: соседние сливаются, видеокарте достаются ближайшие", () => {
  const lamp = (x, y, power, down = true, room = "a") => ({ x, y, z: 2600, power, down, room, rgb: [255, 224, 176] });
  const joined = volumeMeshLampJoin([lamp(0, 0, 1), lamp(1000, 0, 1), lamp(5000, 0, 1), lamp(500, 0, 1, true, "b")]);
  assert.equal(joined.length, 3);
  assert.equal(joined[0].power, 2);
  assert.equal(joined[0].x, 500);
  const many = [];
  for (let at = 0; at < 12; at += 1) many.push(lamp(at * 3000, 0, 1));
  many.push(lamp(100, 100, 2, false));
  const pick = volumeMeshLampPick(many, { x: 0, y: 0 }, { spots: 8, points: 3 });
  assert.equal(pick.spots.length, 8);
  assert.equal(pick.spots[0].x, 0);
  assert.equal(pick.points.length, 1);
  assert.equal(pick.total, 13);
  assert.ok(pick.fill.power > 0);
  assert.equal(volumeMeshLampPick([], { x: 0, y: 0 }).fill, null);
});
