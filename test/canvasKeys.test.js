// Разгон хода холста стрелками — чистая функция от времени удержания.
//
// Требование заказчика: короткое нажатие двигает на чуть-чуть, удержание везёт
// непрерывно и с плавным ускорением, чтобы дотащить план через весь экран одним
// нажатием. Две эти половины противоречат друг другу, поэтому обе и проверяются:
// первые полсекунды удержания — мелкий ход (иначе не подвинуть на пару
// пикселей), к двум секундам — уже целый экран.
import test from "node:test";
import assert from "node:assert/strict";
import { canvasPanSpeed, canvasPanVector } from "../src/canvas.js";
import { planToScreen } from "../src/render.js";

// Путь за время удержания: скорость умножается на шаг и складывается —
// так же, как это делают кадры холста.
const travel = (fromMs, toMs, stepMs = 4) => {
  let distance = 0;
  for (let time = fromMs; time < toMs; time += stepMs) distance += canvasPanSpeed(time) * (stepMs / 1000);
  return distance;
};

test("короткое нажатие непрерывный ход не запускает", () => {
  // Нажали и отпустили — холст двигает один шаг, а не разгоняется: клавиша,
  // которая едет от первого касания, не даёт подвинуть план на чуть-чуть.
  assert.equal(canvasPanSpeed(0), 0);
  assert.equal(canvasPanSpeed(100), 0, "ход начался раньше, чем человек решил держать клавишу");
  assert.ok(canvasPanSpeed(400) > 0, "клавишу держат, а холст стоит");
});

test("ход разгоняется и упирается в потолок", () => {
  const speeds = [400, 700, 1000, 1400, 2000, 4000].map(canvasPanSpeed);
  for (let i = 1; i < speeds.length; i += 1) {
    assert.ok(speeds[i] >= speeds[i - 1], "скорость просела на шаге " + i + ": " + speeds.join(", "));
  }
  // Потолок нужен: без него удержание за секунду улетает в другой конец плана.
  assert.equal(canvasPanSpeed(4000), canvasPanSpeed(9000), "разгон не кончается");
  assert.ok(canvasPanSpeed(9000) <= 4000, "потолок скорости неуправляемый: " + canvasPanSpeed(9000));
});

test("ускорение плавное: разгон набирает, а не идёт ровной ступенькой", () => {
  // «Плавно» здесь значит: прибавка скорости со временем растёт, а не постоянна.
  // У равномерного разгона обе прибавки были бы одинаковы.
  const early = canvasPanSpeed(700) - canvasPanSpeed(500);
  const later = canvasPanSpeed(1300) - canvasPanSpeed(1100);
  assert.ok(early > 0 && later > 0, "разгона нет вовсе");
  assert.ok(later > early * 1.5, "разгон равномерный, мягкого начала нет: " + early + " против " + later);
});

test("полсекунды удержания — подвинуть на чуть-чуть, две секунды — целый экран", () => {
  const short = travel(0, 500);
  const long = travel(0, 2000);
  assert.ok(short < 400, "за полсекунды план улетает: " + Math.round(short));
  assert.ok(long > 1500, "за две секунды экран не пересечь: " + Math.round(long));
});

// Стрелки листают план, как прокрутка: «вправо» показывает то, что правее, —
// значит содержимое уезжает влево, а не едет за стрелкой. Проверяется это не
// знаком в таблице, а тем, куда после хода попадает точка плана: считает её
// та же формула, что рисует холст и выгрузку.
const plan = { id: "s", width: 1000, height: 500 };
const still = { zoom: 1, offsetX: 0, offsetY: 0, markSize: 10, labelSize: 12 };

const moved = (code, at = { x: 0.5, y: 0.5 }) => {
  const vector = canvasPanVector(code);
  assert.ok(vector, "стрелка не двигает холст: " + code);
  const after = { ...still, offsetX: still.offsetX + vector.x * 100, offsetY: still.offsetY + vector.y * 100 };
  const was = planToScreen(at, plan, still);
  const now = planToScreen(at, plan, after);
  return { dx: now.x - was.x, dy: now.y - was.y };
};

test("стрелки листают план, как прокрутка: камера едет в сторону стрелки", () => {
  assert.ok(moved("ArrowRight").dx < 0, "«вправо» обязана показывать то, что правее");
  assert.ok(moved("ArrowLeft").dx > 0, "«влево» обязана показывать то, что левее");
  assert.ok(moved("ArrowDown").dy < 0, "«вниз» обязана показывать то, что ниже");
  assert.ok(moved("ArrowUp").dy > 0, "«вверх» обязана показывать то, что выше");

  // Противоположные стрелки возвращают вид на место, а не уводят его косо.
  assert.deepEqual(moved("ArrowRight").dx, -moved("ArrowLeft").dx);
  assert.deepEqual(moved("ArrowUp").dy, -moved("ArrowDown").dy);
  assert.equal(moved("ArrowRight").dy, 0, "горизонтальная стрелка увела вид по вертикали");
  assert.equal(moved("ArrowDown").dx, 0, "вертикальная стрелка увела вид по горизонтали");
  assert.equal(canvasPanVector("KeyA"), null, "холст двигает не своей клавишей");
});
