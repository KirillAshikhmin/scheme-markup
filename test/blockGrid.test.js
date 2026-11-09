// Сетка блока: метку внутри блока рука кладёт в узел полметки (таск 262, G380).
//
// Слова заказчика: «если в шахматном порядке или ещё как-то, то так и рисуй.
// Кстати может на схеме в одном блоке метки тоже двигать по сетке с шагом пол
// метки?» — и следом «Про сетку на схеме - давай».
//
// Проверяется четыре вещи, и последняя — главная:
//
// 1. узлы считаются от **первой метки блока**, а не от листа: сетка едет с
//    блоком, а не блок по сетке;
// 2. клетка квадратная в пикселях плана, а шаг — ровно половина шага блока,
//    то есть ползунок величины меток двигает её вместе с собой;
// 3. ручка «+» попадает **в узел** той же сетки: целый шаг — это две клетки;
// 4. одиночную метку сетка не ловит, Alt отпускает руку, а блок, который
//    везут целиком, едет свободно — G68: уже нарисованный блок не двигается
//    задним числом ни на долю.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  BLOCK_STEP_RATIO,
  addMark,
  addScheme,
  addToGroup,
  blockGridPx,
  blockGridSnap,
  blockStepPx,
  createProject,
  findMark,
  joinToBlock,
  updateProject,
} from "../src/model.js";
import { canvasBlockSnap } from "../src/canvas.js";

const WIDTH = 1600;
const HEIGHT = 1000;
const MARK_SIZE = 10;
const SIZES = [4, 10, 16, 36];

const typeId = (project, code) => project.markTypes.find((type) => type.code === code).id;

// Блок из `count` меток, собранный ручкой «+» вправо — ровно так, как его
// собирает холст.
function block(count = 3, { markSize = MARK_SIZE, at = { x: 0.3, y: 0.5 }, code = "Р" } = {}) {
  const made = addScheme(createProject({ name: "Сетка" }), { name: "1 этаж", width: WIDTH, height: HEIGHT });
  let project = updateProject(made.project, { view: { ...made.project.view, markSize } }).project;
  const first = addMark(project, { schemeId: made.scheme.id, typeId: typeId(project, code), kind: "point", points: [at] });
  project = first.project;
  const ids = [first.mark.id];
  for (let index = 1; index < count; index += 1) {
    const grown = addToGroup(project, ids[ids.length - 1], "right", { step: blockStepPx(markSize) });
    project = grown.project;
    ids.push(grown.mark.id);
  }
  return { project, scheme: project.schemes[0], ids };
}

const pointOf = (project, id) => findMark(project, id).points[0];
// Доли плана в пиксели плана — в них и живёт клетка.
const px = (point) => ({ x: point.x * WIDTH, y: point.y * HEIGHT });

/**
 * Стоит ли точка в узле сетки: сдвиг от начала отсчёта кратен клетке.
 *
 * Сверяется кратность, а не байты: доля плана — число с плавающей точкой, и
 * метка через два шага ручки «+» отличается от посчитанной сеткой на один
 * последний бит. Четверть клетки — это 2,8 пикселя плана, так что допуск
 * 1e-6 клетки говорит ровно о том, о чём тест: промах виден с запасом.
 */
function assertInNode(project, originId, point, label) {
  const origin = pointOf(project, originId);
  const cell = blockGridPx(project);
  const steps = {
    x: (point.x * WIDTH - origin.x * WIDTH) / cell,
    y: (point.y * HEIGHT - origin.y * HEIGHT) / cell,
  };
  for (const axis of ["x", "y"]) {
    const off = Math.abs(steps[axis] - Math.round(steps[axis]));
    assert.ok(off < 1e-6, `${label}: по оси ${axis} метка стоит в ${steps[axis].toFixed(4)} клетки от начала отсчёта`);
  }
}

// ——— шаг сетки ————————————————————————————————————————————————————————

test("шаг сетки — ровно половина шага блока и своего числа не имеет", () => {
  for (const markSize of SIZES) {
    const built = block(2, { markSize });
    assert.equal(blockGridPx(built.project), blockStepPx(markSize) / 2);
    assert.equal(blockGridPx(built.project), (markSize * BLOCK_STEP_RATIO) / 2);
  }
  // Величины у объекта нет (прежний формат) — шаг по умолчанию, как у блока.
  const bare = { ...block(2).project, view: {} };
  assert.equal(blockGridPx(bare), blockStepPx() / 2);
});

// ——— откуда отсчёт ————————————————————————————————————————————————————

test("узлы отсчитываются от первой метки блока, а не от края плана", () => {
  // Первая метка стоит не в узле листа нарочно: 0,3 плана — это 480 пикселей,
  // а клетка 11,1. Сетка от листа дёрнула бы её соседей, сетка от блока — нет.
  const built = block(3);
  const origin = pointOf(built.project, built.ids[0]);
  const cell = blockGridPx(built.project);

  // Ведём третью метку мимо узла: на четверть клетки за два шага вправо.
  const target = { x: origin.x + (2 * cell + cell / 4) / WIDTH, y: origin.y };
  const landed = blockGridSnap(built.project, built.ids[2], target);
  assert.ok(Math.abs(px(landed).x - (px(origin).x + 2 * cell)) < 1e-6, "метка легла не в узел от первой метки блока");
  assert.equal(landed.y, origin.y, "сетка сдвинула метку по вертикали на ровном месте");

  // Та же точка, но отсчёт «от листа» дал бы другой ответ — значит сетка и
  // правда привязана к блоку.
  assert.ok(Math.abs(px(landed).x % cell) > 1e-6, "узлы блока случайно совпали с узлами листа — проверка ничего не говорит");
});

test("первая метка блока сама ложится на свою сетку — узлы остаются теми же", () => {
  // Отсчёт идёт от неё, значит её собственные переносы кратны клетке, и вся
  // решётка после них остаётся на месте: соседи, стоявшие в узлах, в узлах и
  // остаются.
  const built = block(3);
  const origin = pointOf(built.project, built.ids[0]);
  const cell = blockGridPx(built.project);
  const target = { x: origin.x + (cell * 3 + cell / 3) / WIDTH, y: origin.y + (cell + cell / 3) / HEIGHT };
  const landed = blockGridSnap(built.project, built.ids[0], target);
  const shift = { x: px(landed).x - px(origin).x, y: px(landed).y - px(origin).y };
  for (const value of [shift.x, shift.y]) {
    assert.ok(Math.abs(value / cell - Math.round(value / cell)) < 1e-9, "перенос первой метки не кратен клетке: сетка уехала");
  }
});

test("клетка квадратная в пикселях плана, а не в долях", () => {
  // План шире, чем выше (1600 × 1000): считай сетку долями — и шахматный
  // порядок вышел бы вытянутым прямоугольником.
  const built = block(2);
  const origin = pointOf(built.project, built.ids[0]);
  const cell = blockGridPx(built.project);
  const landed = blockGridSnap(built.project, built.ids[1], {
    x: origin.x + (cell * 0.9) / WIDTH,
    y: origin.y + (cell * 0.9) / HEIGHT,
  });
  const at = px(landed);
  const from = px(origin);
  assert.ok(Math.abs(at.x - from.x - cell) < 1e-6, "клетка по горизонтали не равна шагу сетки");
  assert.ok(Math.abs(at.y - from.y - cell) < 1e-6, "клетка по вертикали разошлась с горизонтальной");
});

// ——— ручка «+» попадает в узел ————————————————————————————————————————

test("ручка «+» ставит метку в узел сетки: целый шаг — это две клетки", () => {
  for (const markSize of SIZES) {
    for (const side of ["right", "left", "up", "down"]) {
      const built = block(1, { markSize });
      const grown = addToGroup(built.project, built.ids[0], side, { step: blockStepPx(markSize) });
      const put = grown.mark.points[0];
      const label = `метка от ручки «+» (${side}, величина ${markSize})`;
      assertInNode(grown.project, built.ids[0], put, label);
      // И притяжка эту точку не двигает: она уже в узле.
      assertInNode(grown.project, built.ids[0], blockGridSnap(grown.project, grown.mark.id, put), label + " после сетки");
    }
  }
});

test("блок, выращенный ручкой «+» в две стороны, целиком стоит в узлах", () => {
  // Шахматный порядок собирают именно так: ряд вправо, потом вниз от крайних.
  const built = block(3);
  let project = built.project;
  const lower = addToGroup(project, built.ids[0], "down", { step: blockStepPx(MARK_SIZE) });
  project = lower.project;
  const lowerRight = addToGroup(project, lower.mark.id, "right", { step: blockStepPx(MARK_SIZE) });
  project = lowerRight.project;
  for (const id of [...built.ids, lower.mark.id, lowerRight.mark.id]) {
    assertInNode(project, built.ids[0], pointOf(project, id), "метка блока");
  }
  // Второй ряд и правда ряд: он лежит ровно под первым, через две клетки.
  const cell = blockGridPx(project);
  assert.ok(
    Math.abs((pointOf(project, lower.mark.id).y - pointOf(project, built.ids[0]).y) * HEIGHT - 2 * cell) < 1e-6,
    "ряд ушёл не на целый шаг блока",
  );
});

// ——— кого сетка не ловит ——————————————————————————————————————————————

test("одиночную метку сетка не ловит — ей это ни к чему", () => {
  const built = block(1);
  const target = { x: 0.3123, y: 0.5077 };
  assert.deepEqual(blockGridSnap(built.project, built.ids[0], target), target, "одинокую метку притянуло к узлу");
  // И метку, у которой блок распался до одной: висячая группа — та же
  // одиночка.
  const pair = block(2);
  const alone = { ...pair.project, groups: pair.project.groups.map((group) => ({ ...group, markIds: [pair.ids[0]] })) };
  assert.deepEqual(blockGridSnap(alone, pair.ids[0], target), target, "метка распавшегося блока поймана сеткой");
});

test("сетка ловит руку только у метки, которая едет одна внутри блока", () => {
  const built = block(3);
  const origin = pointOf(built.project, built.ids[0]);
  const cell = blockGridPx(built.project);
  const target = { x: origin.x + (2 * cell + cell / 4) / WIDTH, y: origin.y };
  const solo = { markId: built.ids[2], moving: [built.ids[2]] };
  const whole = { markId: built.ids[2], moving: built.ids };

  const landed = canvasBlockSnap(built.project, solo, target, false);
  assert.ok(Math.abs(px(landed).x - (px(origin).x + 2 * cell)) < 1e-6, "одну метку блока сетка не поймала");

  // Блок едет целиком — он везёт сетку с собой, и узлы руку не держат.
  assert.deepEqual(canvasBlockSnap(built.project, whole, target, false), target, "блок целиком притянуло к своей же сетке");
  // Alt — та же клавиша «без магнита», что у направляющих.
  assert.deepEqual(canvasBlockSnap(built.project, solo, target, true), target, "Alt не отпустил руку");
  // Жеста нет вовсе (подпись, вершина ломаной) — точка как пришла.
  assert.deepEqual(canvasBlockSnap(built.project, null, target, false), target);
  assert.deepEqual(canvasBlockSnap(built.project, { markId: null, moving: null }, target, false), target);
});

test("собранный из готовых меток блок сетку получает, но сам не двигается", () => {
  // `joinToBlock` (таск 244) не двигает ни одной точки — сетка появляется
  // только под рукой.
  const first = block(1, { at: { x: 0.2, y: 0.4 } });
  const second = addMark(first.project, {
    schemeId: first.scheme.id,
    typeId: typeId(first.project, "В"),
    kind: "point",
    points: [{ x: 0.2377, y: 0.4123 }],
  });
  const joined = joinToBlock(second.project, second.mark.id, first.ids[0]).project;
  assert.deepEqual(pointOf(joined, second.mark.id), { x: 0.2377, y: 0.4123 }, "сведение блока сдвинуло метку");
  assert.deepEqual(pointOf(joined, first.ids[0]), { x: 0.2, y: 0.4 });

  // А рука кладёт пришедшую метку в узел — от первой метки блока (ею осталась
  // та, чей блок стал хозяином: `joinToBlock` оставляет его список впереди).
  const cell = blockGridPx(joined);
  const origin = pointOf(joined, first.ids[0]);
  const landed = blockGridSnap(joined, second.mark.id, pointOf(joined, second.mark.id));
  const steps = {
    x: (px(landed).x - px(origin).x) / cell,
    y: (px(landed).y - px(origin).y) / cell,
  };
  for (const value of [steps.x, steps.y]) {
    assert.ok(Math.abs(value - Math.round(value)) < 1e-9, "метка легла между узлами: " + JSON.stringify(steps));
  }
});

// ——— где живёт сетка ——————————————————————————————————————————————————

test("сетка стоит на пути ведения, перед направляющими, и шагов истории не добавляет", () => {
  const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "src", "canvas.js"), "utf8");
  const from = source.indexOf("function canvasDragTo(");
  assert.ok(from > 0, "пропала дверь ведения");
  const body = source.slice(from, source.indexOf("\n/**", from));
  // Порядок притяжек назван: сперва сетка блока, потом направляющая — её
  // человек провёл сам и видит подсвеченной, её слово последнее.
  const call = body.indexOf("canvasBlockSnap(before, canvasDrag, anchor, free)");
  assert.ok(call > 0, "ведение перестало спрашивать сетку блока");
  assert.ok(body.indexOf("canvasGuideSnap(canvasBlockSnap(") > 0, "сетка и направляющие разошлись по разным дверям");
  // Ни одного своего шага истории: ведение только готовит предпросмотр,
  // в историю пишет отпускание — одним `canvasCommit` на жест.
  assert.ok(!body.includes("canvasCommit("), "сетка завела свой шаг истории внутри ведения");
  // Второй притяжки «по полметки» рядом не появилось: все узлы считает модель.
  assert.equal(source.split("blockGridSnap(").length - 1, 1, "в холсте появился второй счёт сетки");
});

// ——— G68 ——————————————————————————————————————————————————————————————

test("G68: сетка не правит объект — она только отвечает, куда ляжет рука", () => {
  const built = block(3);
  const before = JSON.stringify(built.project);
  const origin = pointOf(built.project, built.ids[0]);
  blockGridSnap(built.project, built.ids[1], { x: origin.x + 0.01, y: origin.y + 0.01 });
  blockGridPx(built.project);
  canvasBlockSnap(built.project, { markId: built.ids[1], moving: [built.ids[1]] }, origin, false);
  assert.equal(JSON.stringify(built.project), before, "сетка переписала объект");
});

test("G68: неровный блок прежнего объекта остаётся неровным, пока его не повели рукой", () => {
  // Блок, размеченный до таска: метки стоят как придётся. Ни открытие, ни
  // кадр, ни расчёт сетки их не трогают — двигает только рука.
  const made = addScheme(createProject({ name: "Прежний" }), { name: "1 этаж", width: WIDTH, height: HEIGHT });
  let project = made.project;
  const points = [
    { x: 0.4, y: 0.5 },
    { x: 0.4137, y: 0.5021 },
    { x: 0.4259, y: 0.5109 },
  ];
  const ids = [];
  for (const point of points) {
    const added = addMark(project, {
      schemeId: made.scheme.id,
      typeId: typeId(project, "Р"),
      kind: "point",
      points: [point],
    });
    project = added.project;
    ids.push(added.mark.id);
  }
  let built = project;
  for (let index = 1; index < ids.length; index += 1) built = joinToBlock(built, ids[index], ids[0]).project;
  for (let index = 0; index < ids.length; index += 1) {
    assert.deepEqual(pointOf(built, ids[index]), points[index], "метка прежнего блока переехала сама");
  }
  // Повели вторую — легла в узел; третья осталась там, где была.
  const landed = blockGridSnap(built, ids[1], pointOf(built, ids[1]));
  assert.notDeepEqual(landed, points[1], "сетка не поправила метку, которую повели");
  assert.deepEqual(pointOf(built, ids[2]), points[2], "сетка задним числом подровняла соседа");
});
