// Масштаб в окне правки плана: ступеньки кнопок, «вписать в окно», перенос
// рамки через поворот и строка с разрешением.
//
// Окно показывает план вписанным, и на большом плане рамку обрезки не
// поставить точно — отсюда масштаб. Опасность у него одна: рамка задана долями
// картинки, а рисуется пикселями экрана, и стоит спутать одно с другим —
// рамка поедет по плану от каждого щелчка «+» или поворота. Поэтому вся
// арифметика вынесена сюда, в чистые функции, и проверяется без DOM: сам
// `<img>`, прокрутку и щипок проверяет ручная приёмка.
import test from "node:test";
import assert from "node:assert/strict";

import {
  PLAN_ZOOM_STEPS,
  planFitScale,
  planRotateFrame,
  planSizeLine,
  planZoomClamp,
  planZoomStep,
} from "../src/panels/schemes.js";
import { transformSize } from "../src/imagePrep.js";

const close = (value, expected, what) =>
  assert.ok(Math.abs(value - expected) < 1e-9, what + ": " + value + " вместо " + expected);

test("ступеньки идут от «вписано» вверх и никуда больше", () => {
  assert.equal(PLAN_ZOOM_STEPS[0], 1, "мельче вписанного плана смотреть нечего");
  const sorted = [...PLAN_ZOOM_STEPS].sort((a, b) => a - b);
  assert.deepEqual(PLAN_ZOOM_STEPS, sorted, "ступеньки должны идти по возрастанию");
  assert.equal(new Set(PLAN_ZOOM_STEPS).size, PLAN_ZOOM_STEPS.length, "повторов среди ступенек быть не должно");
});

test("кнопки ведут по ступенькам и упираются в края", () => {
  assert.equal(planZoomStep(1, 1), PLAN_ZOOM_STEPS[1]);
  assert.equal(planZoomStep(1, -1), 1, "на вписанном плане «−» ничего не меняет");
  const last = PLAN_ZOOM_STEPS[PLAN_ZOOM_STEPS.length - 1];
  assert.equal(planZoomStep(last, 1), last, "дальше последней ступеньки хода нет");
  assert.equal(planZoomStep(last, -1), PLAN_ZOOM_STEPS[PLAN_ZOOM_STEPS.length - 2]);
});

test("после колеса и щипка кнопка ведёт к следующей ступеньке, а не назад", () => {
  // Колесо оставляет дробный масштаб: 2.3 — это между 2 и 3.
  assert.equal(planZoomStep(2.3, 1), 3, "«+» после колеса обязан увеличить");
  assert.equal(planZoomStep(2.3, -1), 2, "«−» после колеса обязан уменьшить");
  // Ровно на ступеньке «+» тоже идёт дальше, а не стоит на месте.
  assert.equal(planZoomStep(2, 1), 3);
  assert.equal(planZoomStep(2, -1), 1.5);
});

test("масштаб держится в своих краях, мусор считается вписанным видом", () => {
  const last = PLAN_ZOOM_STEPS[PLAN_ZOOM_STEPS.length - 1];
  assert.equal(planZoomClamp(0.2), 1);
  assert.equal(planZoomClamp(1000), last);
  assert.equal(planZoomClamp(NaN), 1);
  assert.equal(planZoomClamp(undefined), 1);
  assert.equal(planZoomClamp(2.5), 2.5, "дробный масштаб колеса и щипка проходит как есть");
});

test("«вписать в окно»: большой план уменьшается, мелкий не растягивается", () => {
  // Широкий план упирается в ширину окна, высокий — в высоту.
  close(planFitScale({ width: 2000, height: 1000 }, { width: 500, height: 500 }), 0.25, "по ширине");
  close(planFitScale({ width: 1000, height: 2000 }, { width: 500, height: 500 }), 0.25, "по высоте");
  // Мелкая картинка остаётся в своих пикселях: растянутый план — это каша.
  assert.equal(planFitScale({ width: 100, height: 80 }, { width: 500, height: 500 }), 1);
  // Окно ещё не измерено (диалог спрятан под другим) — вписывать нечего.
  assert.equal(planFitScale({ width: 2000, height: 1000 }, { width: 0, height: 0 }), 1);
  assert.equal(planFitScale(null, { width: 500, height: 500 }), 1);
});

test("поворот переносит рамку на то же место плана", () => {
  // Рамка в левой верхней четверти: после поворота вправо она обязана
  // оказаться в правой верхней — там же, где и обведённый ею угол плана.
  const frame = { x: 0, y: 0, width: 0.25, height: 0.5 };
  const right = planRotateFrame(frame, 90);
  close(right.x, 0.5, "x рамки");
  close(right.y, 0, "y рамки");
  close(right.width, 0.5, "ширина рамки");
  close(right.height, 0.25, "высота рамки");

  // Четыре поворота вправо — рамка на своём месте, без накопленного сноса.
  let turned = frame;
  for (let step = 0; step < 4; step += 1) turned = planRotateFrame(turned, 90);
  close(turned.x, frame.x, "x после круга");
  close(turned.y, frame.y, "y после круга");
  close(turned.width, frame.width, "ширина после круга");
  close(turned.height, frame.height, "высота после круга");

  // Влево и вправо — взаимно обратны.
  const back = planRotateFrame(planRotateFrame(frame, 90), -90);
  close(back.x, frame.x, "x обратно");
  close(back.y, frame.y, "y обратно");
  assert.equal(planRotateFrame(null, 90), null, "нет рамки — нечего поворачивать");
});

test("снизу видно разрешение плана и масштаб в процентах настоящих пикселей", () => {
  const line = planSizeLine({ width: 4000, height: 3000, frame: null, scale: 0.25 });
  assert.ok(line.includes("4000 × 3000"), "разрешение плана: " + line);
  assert.ok(line.includes("25 %"), "масштаб: " + line);
  assert.ok(!line.includes("Выбрано"), "рамки нет — выбирать нечего: " + line);
  // Сотня — это «пиксель в пиксель», и округляется она к целым процентам.
  assert.ok(planSizeLine({ width: 10, height: 10, frame: null, scale: 1 }).includes("100 %"));
  assert.ok(planSizeLine({ width: 10, height: 10, frame: null, scale: 0.333 }).includes("33 %"));
});

test("с рамкой строка говорит и размер выбранной области — ровно тот, что получится", () => {
  const size = { width: 4000, height: 3000 };
  const frame = { x: 0.1, y: 0.2, width: 0.3, height: 0.25 };
  const line = planSizeLine({ ...size, frame, scale: 0.25 });
  // Число под рамкой обязано совпадать с размером будущей картинки, поэтому
  // считает его та же функция, что потом и нарежет план.
  const crop = transformSize(size, { rotate: 0, crop: frame });
  assert.deepEqual(crop, { width: 1200, height: 750 });
  assert.ok(line.includes("1200 × 750"), "размер выбранной области: " + line);
  assert.ok(line.includes("4000 × 3000"), "разрешение плана никуда не девается: " + line);
});
