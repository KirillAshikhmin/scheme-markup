// Магнит направления при рисовании линий и контуров — чистая функция от двух
// точек плана и порога.
//
// Зачем он: этим рисуют светодиодную ленту по периметру комнаты и треки. Стены
// в квартире прямые, инженер каждый раз целится в горизонталь и промахивается
// на пару градусов — на распечатке косина видна. Магнит дотягивает почти ровное
// направление до ровного, а всё остальное оставляет как есть: косые стены и
// эркеры в квартирах тоже бывают.
import test from "node:test";
import assert from "node:assert/strict";
import { SNAP_ANGLE_DEG, renderInternals, snapSegment } from "../src/render.js";

// План не квадратный нарочно: доля по горизонтали и доля по вертикали стоят
// разных пикселей, и угол, посчитанный по долям, — это не тот угол, который
// видит инженер.
const plan = { id: "s", width: 1000, height: 500 };

test("порог магнита — не жадный и не робкий", () => {
  assert.ok(SNAP_ANGLE_DEG > 0, "магнита нет вовсе");
  // Сорок пять градусов — половина между ровными направлениями: с таким порогом
  // наклонный отрезок поставить было бы нельзя вообще.
  assert.ok(SNAP_ANGLE_DEG < 20, "магнит съедает наклонные отрезки: " + SNAP_ANGLE_DEG);
});

test("почти горизонтальный отрезок дотягивается до горизонтали", () => {
  // Вправо на 300 пикселей плана и вниз на 10 — это 1,9°.
  const from = { x: 0.2, y: 0.5 };
  const to = { x: 0.5, y: 0.52 };
  const snap = snapSegment(from, to, plan);

  assert.equal(snap.snapped, true);
  assert.equal(snap.angle, 0, "угол после притяжения должен быть ровным");
  assert.equal(snap.point.y, from.y, "поперечная координата не выровнялась");
  assert.equal(snap.point.x, to.x, "продольную координату магнит трогать не должен");
});

test("почти вертикальный отрезок дотягивается до вертикали, вверх — это 90°", () => {
  const from = { x: 0.5, y: 0.8 };
  // Вверх на 200 пикселей плана и вправо на 8 — это 2,3°.
  const up = snapSegment(from, { x: 0.508, y: 0.4 }, plan);
  assert.equal(up.snapped, true);
  assert.equal(up.angle, 90, "вверх — 90°");
  assert.equal(up.point.x, from.x);
  assert.equal(up.point.y, 0.4, "продольную координату магнит трогать не должен");

  const down = snapSegment(from, { x: 0.492, y: 0.95 }, plan);
  assert.equal(down.angle, 270, "вниз — 270°");
  assert.equal(down.point.x, from.x);
});

test("наклонный отрезок магнит не трогает, но угол показывает честно", () => {
  // Вправо 300 и вверх 300 пикселей плана — ровные 45°, до ровного направления
  // отсюда далеко.
  const from = { x: 0.2, y: 0.8 };
  const to = { x: 0.5, y: 0.2 };
  const snap = snapSegment(from, to, plan);

  assert.equal(snap.snapped, false);
  assert.equal(snap.angle, 45, "угол считается в пикселях плана, а не в долях");
  assert.deepEqual(snap.point, to, "свободный отрезок сдвинулся");
});

test("магнит снимается на лету и отпускает почти ровный отрезок", () => {
  const from = { x: 0.2, y: 0.5 };
  const to = { x: 0.5, y: 0.52 };
  const free = snapSegment(from, to, plan, { free: true });

  assert.equal(free.snapped, false);
  assert.deepEqual(free.point, to, "при снятом магните точка обязана остаться под курсором");
  // Угол виден и без магнита: он же и подсказывает, насколько инженер промахнулся.
  assert.ok(Math.abs(free.angle - 358.1) < 0.1, "угол свободного отрезка: " + free.angle);
});

test("отрезка ещё нет — магниту не за что тянуть", () => {
  const point = { x: 0.3, y: 0.3 };
  const snap = snapSegment(point, point, plan);
  assert.equal(snap.snapped, false);
  assert.deepEqual(snap.point, point);
});

// Холста в тестах нет, поэтому рисованию подставляется заглушка: она принимает
// любые вызовы и записывает только напечатанное. Это тот же приём, которым
// проверяется легенда.
const drawProbe = () => {
  const target = {
    texts: [],
    measureText: (value) => ({ width: String(value).length * 7 }),
    fillText: (value, x, y) => target.texts.push({ value, x, y }),
  };
  return new Proxy(target, {
    get: (object, key) => (key in object ? object[key] : () => {}),
    set: () => true,
  });
};

const drawnAngle = (draft, color = "#1F6FEB") => {
  const ctx = drawProbe();
  renderInternals.drawDraft(ctx, plan, draft, { zoom: 1, offsetX: 0, offsetY: 0, markSize: 10, labelSize: 12 }, color);
  return ctx.texts;
};

// Заказчик просил, чтобы при рисовании был виден текущий градус. Стоит он у
// курсора, а не в углу холста: инженер смотрит на конец линии, и по числу в
// углу не понять, к какому отрезку оно относится.
test("при рисовании у курсора виден градус, и сработавший магнит по нему заметен", () => {
  const from = { x: 0.2, y: 0.5 };
  const snap = snapSegment(from, { x: 0.5, y: 0.52 }, plan);

  const magnet = drawnAngle({ points: [from], cursor: snap.point, snapped: true });
  assert.equal(magnet.length, 1, "подсказки угла у курсора нет");
  assert.ok(magnet[0].value.includes("0°"), "градус не написан: " + magnet[0].value);
  // Курсор в долях 0,5 — это 500 пикселей плана; подсказка стоит рядом с ним.
  assert.ok(Math.abs(magnet[0].x - 500) < 40, "подсказка уехала от курсора: " + magnet[0].x);

  // Тот же отрезок без магнита читается иначе — иначе непонятно, почему линия
  // не идёт за рукой.
  const byHand = drawnAngle({ points: [from], cursor: snap.point, snapped: false });
  assert.ok(byHand[0].value.includes("0°"));
  assert.notEqual(byHand[0].value, magnet[0].value, "сработавший магнит ничем не отличается от свободной руки");

  // Наклонный отрезок показывает свой настоящий угол: 300 вправо и 150 вверх.
  const slanted = drawnAngle({ points: [from], cursor: { x: 0.5, y: 0.2 }, snapped: false });
  assert.ok(slanted[0].value.includes("27°"), "угол наклонного отрезка: " + slanted[0].value);
});

test("вершина ещё не сдвинулась — градус не пишется", () => {
  const from = { x: 0.2, y: 0.5 };
  assert.deepEqual(drawnAngle({ points: [from], cursor: from, snapped: false }), []);
});
