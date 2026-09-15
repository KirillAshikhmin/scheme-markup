// Шов: пересчёт долей при повороте и обрезке плана. Чистая арифметика,
// без DOM и canvas — рисование проверяется приёмкой.
import test from "node:test";
import assert from "node:assert/strict";
import {
  isIdentityTransform,
  isPlanImageFile,
  planTypeOf,
  identityTransform,
  normalizeTransform,
  rotateTransform,
  cropTransform,
  transformPoint,
  transformOffset,
  transformSize,
  transformMarkPoints,
  countPointsOutside,
} from "../src/imagePrep.js";

const close = (actual, expected, message) =>
  assert.ok(Math.abs(actual - expected) < 1e-9, message + ": " + actual + " ≠ " + expected);

test("поворот вправо переносит точку в доли повёрнутого плана", () => {
  const point = transformPoint({ x: 0.25, y: 0.1 }, { rotate: 90 });
  close(point.x, 0.9, "x");
  close(point.y, 0.25, "y");
});

test("поворот влево и поворот на 180° считаются по тем же правилам", () => {
  const left = transformPoint({ x: 0.25, y: 0.1 }, { rotate: 270 });
  close(left.x, 0.1, "x влево");
  close(left.y, 0.75, "y влево");
  const half = transformPoint({ x: 0.25, y: 0.1 }, { rotate: 180 });
  close(half.x, 0.75, "x на 180°");
  close(half.y, 0.9, "y на 180°");
});

test("метка остаётся на том же месте изображения: доли совпадают с пикселями", () => {
  // План 1000×500, метка в пикселе (400, 100). После поворота вправо план
  // становится 500×1000, а тот же пиксель уезжает в (500 − 100, 400) = (400, 400).
  const size = transformSize({ width: 1000, height: 500 }, { rotate: 90 });
  assert.equal(size.width, 500);
  assert.equal(size.height, 1000);
  const point = transformPoint({ x: 400 / 1000, y: 100 / 500 }, { rotate: 90 });
  close(point.x, 400 / 500, "x в долях повёрнутого плана");
  close(point.y, 400 / 1000, "y в долях повёрнутого плана");
});

test("обрезка пересчитывает доли относительно рамки", () => {
  const crop = { x: 0.2, y: 0, width: 0.5, height: 0.5 };
  const point = transformPoint({ x: 0.45, y: 0.1 }, { rotate: 0, crop });
  close(point.x, 0.5, "x");
  close(point.y, 0.2, "y");
  const size = transformSize({ width: 1200, height: 800 }, { rotate: 0, crop });
  assert.equal(size.width, 600);
  assert.equal(size.height, 400);
});

test("поворот и обрезка в одном шаге применяются по порядку: сперва поворот", () => {
  const transform = { rotate: 90, crop: { x: 0.5, y: 0, width: 0.5, height: 1 } };
  const point = transformPoint({ x: 0.25, y: 0.1 }, transform);
  close(point.x, 0.8, "x");
  close(point.y, 0.25, "y");
  const size = transformSize({ width: 1200, height: 800 }, transform);
  assert.equal(size.width, 400);
  assert.equal(size.height, 1200);
});

test("поворот туда и обратно возвращает исходные доли", () => {
  const start = { x: 0.31, y: 0.77 };
  const there = transformPoint(start, { rotate: 90 });
  const back = transformPoint(there, { rotate: 270 });
  close(back.x, start.x, "x");
  close(back.y, start.y, "y");
});

test("смещение подписи поворачивается вместе с планом", () => {
  const right = transformOffset({ dx: 12, dy: -10 }, { rotate: 90 });
  assert.deepEqual(right, { dx: 10, dy: 12 });
  const left = transformOffset({ dx: 12, dy: -10 }, { rotate: 270 });
  assert.deepEqual(left, { dx: -10, dy: -12 });
  const cropOnly = transformOffset({ dx: 12, dy: -10 }, { rotate: 0, crop: { x: 0.1, y: 0.1, width: 0.5, height: 0.5 } });
  assert.deepEqual(cropOnly, { dx: 12, dy: -10 });
});

test("пустое преобразование ничего не меняет", () => {
  const transform = identityTransform();
  assert.equal(isIdentityTransform(transform), true);
  assert.equal(isIdentityTransform({ rotate: 360 }), true);
  assert.equal(isIdentityTransform({ rotate: 90 }), false);
  assert.equal(isIdentityTransform({ rotate: 0, crop: { x: 0.1, y: 0, width: 0.5, height: 1 } }), false);
  const point = transformPoint({ x: 0.42, y: 0.13 }, transform);
  close(point.x, 0.42, "x");
  close(point.y, 0.13, "y");
  const size = transformSize({ width: 1280, height: 1978 }, transform);
  assert.deepEqual(size, { width: 1280, height: 1978 });
});

test("нормализация приводит поворот к четверти оборота и чинит рамку", () => {
  assert.equal(normalizeTransform({ rotate: -90 }).rotate, 270);
  assert.equal(normalizeTransform({ rotate: 450 }).rotate, 90);
  assert.equal(normalizeTransform({}).crop, null);
  const crop = normalizeTransform({ crop: { x: -0.2, y: 0.5, width: 2, height: 0.9 } }).crop;
  close(crop.x, 0, "x рамки");
  close(crop.width, 1, "ширина рамки");
  close(crop.height, 0.5, "высота рамки в пределах плана");
});

test("план принимается только картинкой PNG или JPG", () => {
  assert.equal(isPlanImageFile({ name: "plan.png", type: "image/png" }), true);
  assert.equal(isPlanImageFile({ name: "plan.jpg", type: "image/jpeg" }), true);
  assert.equal(isPlanImageFile({ name: "plan.JPEG", type: "" }), true);
  assert.equal(isPlanImageFile({ name: "plan.pdf", type: "application/pdf" }), false);
  assert.equal(isPlanImageFile({ name: "plan.svg", type: "image/svg+xml" }), false);
  assert.equal(isPlanImageFile(null), false);
});

test("рамка режется по обеим сторонам: ширина к 1−x, высота к 1−y", () => {
  const crop = normalizeTransform({ crop: { x: 0.5, y: 0.6, width: 0.9, height: 0.9 } }).crop;
  close(crop.width, 0.5, "ширина");
  close(crop.height, 0.4, "высота");
});

test("точки за рамкой считаются и прижимаются к краю плана", () => {
  const transform = { rotate: 0, crop: { x: 0.2, y: 0, width: 0.5, height: 1 } };
  const points = [{ x: 0.05, y: 0.5 }, { x: 0.45, y: 0.5 }];
  assert.equal(countPointsOutside(points, transform), 1);
  const moved = transformMarkPoints(points, transform);
  close(moved[0].x, 0, "первая точка прижата к левому краю");
  close(moved[0].y, 0.5, "y первой точки");
  close(moved[1].x, 0.5, "вторая точка осталась на месте");
  assert.equal(countPointsOutside(moved, { rotate: 0 }), 0);
});

test("накопленный поворот поворачивает и уже поставленную рамку", () => {
  const cropped = cropTransform(identityTransform(), { x: 0.2, y: 0, width: 0.5, height: 0.5 });
  const turned = rotateTransform(cropped, 90);
  assert.equal(turned.rotate, 90);
  close(turned.crop.x, 0.5, "x рамки");
  close(turned.crop.y, 0.2, "y рамки");
  close(turned.crop.width, 0.5, "ширина рамки");
  close(turned.crop.height, 0.5, "высота рамки");
  assert.equal(rotateTransform({ rotate: 270 }, 180).rotate, 90);
});

test("вторая рамка отсчитывается от того, что видно после первой", () => {
  const first = cropTransform(identityTransform(), { x: 0.2, y: 0, width: 0.5, height: 0.5 });
  const second = cropTransform(first, { x: 0.5, y: 0, width: 0.5, height: 1 });
  close(second.crop.x, 0.45, "x второй рамки");
  close(second.crop.width, 0.25, "ширина второй рамки");
  close(second.crop.height, 0.5, "высота второй рамки");
});

// Ради этого преобразования и копятся: одно применение к исходнику вместо
// цепочки пережатий, и метки считаются один раз.
test("накопленное преобразование двигает точку так же, как шаги по очереди", () => {
  const point = { x: 0.25, y: 0.1 };
  const frame = { x: 0.2, y: 0, width: 0.5, height: 0.5 };
  const bySteps = transformPoint(transformPoint(point, { rotate: 0, crop: frame }), { rotate: 90 });
  const atOnce = transformPoint(point, rotateTransform(cropTransform(identityTransform(), frame), 90));
  close(atOnce.x, bySteps.x, "x");
  close(atOnce.y, bySteps.y, "y");
  close(atOnce.x, 0.8, "x по разобранному вручную примеру");
  close(atOnce.y, 0.1, "y по разобранному вручную примеру");
});

test("тип плана берётся из расширения, когда браузер его не назвал", () => {
  assert.equal(planTypeOf({ name: "plan.JPG", type: "" }), "image/jpeg");
  assert.equal(planTypeOf({ name: "plan.jpeg", type: "" }), "image/jpeg");
  assert.equal(planTypeOf({ name: "plan.png", type: "" }), "image/png");
  assert.equal(planTypeOf({ name: "снимок", type: "image/jpeg" }), "image/jpeg");
});
