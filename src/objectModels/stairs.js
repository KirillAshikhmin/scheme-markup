// Модели четырёх маршей лестницы — **сборкой по габариту**, а не записью
// (правка 2026-10-27).
//
// Слова заказчика: «Лестницу сделай минималистичней, только ступени плоские, а
// не блоки от пола и количество ступеней увеличь, особенно в п-образной, а сами
// ступени поменьше в ширину процентов на 20». И вторым словом: «Так же сделай у
// ней опцию поворота вокруг оси, например сейчас у G-образной если смотреть на
// неё спереди нижняя ступень слева, а надо что бы справа».
//
// ——— почему сборкой ———
//
// Было пять ступеней-коробок от пола (таски 149, 216): модель вещи держит
// предел в пять тел и тридцать граней (`OBJECT_MODEL_BODY_MAX`), и ступеней
// выходило столько, сколько в него влезало. Плоских ступеней в настоящем марше
// пятнадцать: подъём этажа на ступень в 175 мм. В предел они не влезают, и
// предел здесь снят **нарочно и только для лестниц** — лестниц на объекте одна
// или две, а не три сотни, как меток. Ступень — плита в 40 мм, шесть граней;
// марш в 2,8 м — шестнадцать ступеней, сто граней с небольшим.
//
// Число ступеней считается **от высоты**, а не пишется: модель не знает
// высоты помещения, пока её не поставили, поэтому собирается по габариту
// (`objectStairModel`). В реестре моделей лежит та же сборка по габариту
// каталога — ею марш узнают тесты и картинки, а в объёме он собирается заново
// по своей высоте и своему отражению (`volumeObjectFaces`).
//
// ——— ход ———
//
// Лестница поднимается **от лица вещи к заднику** (таск 149, на этом стоит
// выход с лестницы `stairsExit`). Ход каждого марша, если смотреть в лицо:
//
//   прямой — от лица к заднику;
//   Г-образный — от лица вглубь по левой стороне, площадка в дальнем левом
//     углу, дальше вправо вдоль задника;
//   П-образный — вглубь по левому ходу, площадка у задника во всю ширину,
//     назад к лицу по правому;
//   спиральный — вокруг столба, первая ступень у лица, и ход уходит влево.
//
// **Отражение** (`mirror`) меняет лево и право: нижняя ступень Г-образного
// уходит направо, спиральный закручивается в другую сторону. Прямому отражать
// нечего.
//
// Ступень **уже хода на пятую часть** (`STAIR_TREAD_SHARE`) и стоит по его
// середине — по слову заказчика. Площадка — та же ступень, только квадратная.
import { modelBox, modelCyl, modelParts, modelPlate } from "./kit.js";

/** Ключи маршей, которые собираются по габариту. */
export const OBJECT_STAIR_KEYS = Object.freeze(["stairs", "stairsL", "stairsU", "stairsSpiral"]);
/** У каких маршей есть лево и право — их отражают. */
export const OBJECT_STAIR_MIRRORED = Object.freeze(["stairsL", "stairsU", "stairsSpiral"]);
/** Подъём ступени, мм: этаж 2800 — шестнадцать ступеней. */
export const STAIR_RISE_MM = 175;
/** Толщина плиты ступени, мм. */
export const STAIR_TREAD_MM = 40;
/** Ширина ступени — доля ширины хода: «поменьше в ширину процентов на 20». */
export const STAIR_TREAD_SHARE = 0.8;
/** Сколько ступеней бывает: низкий подиум и двусветная гостиная — пределы. */
export const STAIR_STEPS_MIN = 4;
export const STAIR_STEPS_MAX = 30;
/** Ширина хода Г-образного и П-образного марша в каталоге, мм. */
const STAIR_RUN_MM = 1100;
/** Каталожный габарит Г-образного (2700) и П-образного (2300) марша в ширину. */
const STAIR_L_SIDE_MM = 2700;
const STAIR_U_WIDTH_MM = 2300;
/** Столб спиральной — доля габарита в поперечнике. */
const STAIR_POST_SHARE = 0.16;
/** На сколько оборотов закручен спиральный марш. */
const STAIR_SPIRAL_TURNS = 1;

/** Лестница ли это, которую собирают по габариту. */
export function objectStairKey(key) {
  return OBJECT_STAIR_KEYS.includes(key);
}

/** Сколько ступеней в марше этой высоты, площадка — тоже ступень. */
export function objectStairSteps(heightMm) {
  const rises = Math.round(Math.max(0, Number(heightMm) || 0) / STAIR_RISE_MM);
  return Math.min(STAIR_STEPS_MAX, Math.max(STAIR_STEPS_MIN, rises - 1));
}

/**
 * Модель марша по габариту: `{widthMm, depthMm, heightMm, mirror}`. `null` —
 * ключ не лестничный или габарит пустой.
 */
export function objectStairModel(key, { widthMm, depthMm, heightMm, mirror = false } = {}) {
  const width = Number(widthMm);
  const depth = Number(depthMm);
  const height = Number(heightMm);
  if (!objectStairKey(key) || !(width > 0) || !(depth > 0) || !(height > 0)) return null;
  const steps = objectStairSteps(height);
  const thick = Math.min(STAIR_TREAD_MM, height / (steps + 1) / 2) / height;
  // Ступень `index` (с нуля) — плита, верх которой на `index + 1` подъёмах.
  const z = (index) => (index + 1) / (steps + 1) - thick;
  const flip = mirror === true && OBJECT_STAIR_MIRRORED.includes(key);
  const plan = { width, depth, steps, z, thick, flip };
  if (key === "stairsSpiral") return objectStairSpiral(plan);
  const boards = key === "stairsL" ? objectStairL(plan) : key === "stairsU" ? objectStairU(plan) : objectStairStraight(plan);
  return modelParts(
    boards.map((board, index) =>
      modelBox("step" + (index + 1), {
        x: flip ? -(board.x + board.width) : board.x,
        width: board.width,
        y: board.y,
        depth: board.depth,
        z: z(index),
        height: thick,
        material: board.landing ? "light" : index % 2 === 0 ? "body" : "light",
      }),
    ),
  );
}

// Ступень по середине хода: `across` — середина и ширина хода поперёк него в
// долях, вдоль — от `from` до `to`. Площадка — квадрат той же ширины.
function stairTread(axis, middle, span, from, to, landing = false) {
  const narrow = span * STAIR_TREAD_SHARE;
  const low = Math.min(from, to);
  const run = Math.abs(to - from);
  if (axis === "y") return { x: middle - narrow / 2, width: narrow, y: low, depth: run, landing };
  return { x: low, width: run, y: middle - narrow / 2, depth: narrow, landing };
}

function objectStairStraight({ steps }) {
  const out = [];
  for (let index = 0; index < steps; index += 1) {
    out.push(stairTread("y", 0, 1, -0.5 + index / steps, -0.5 + (index + 1) / steps));
  }
  return out;
}

// Ход вдоль одной стороны: `count` ступеней от `from` до `to` (доли).
function stairRun(out, axis, middle, span, from, to, count) {
  for (let index = 0; index < count; index += 1) {
    const a = from + ((to - from) * index) / count;
    const b = from + ((to - from) * (index + 1)) / count;
    out.push(stairTread(axis, middle, span, a, b));
  }
}

// Сколько ступеней на первый ход из двух длиной `first` и `second`, если одна
// из всех — площадка.
function stairSplit(steps, first, second) {
  const runs = Math.max(2, steps - 1);
  const one = Math.min(runs - 1, Math.max(1, Math.round((runs * first) / Math.max(1e-9, first + second))));
  return { one, two: runs - one };
}

function objectStairL({ width, depth, steps }) {
  // Ход — каталожная доля стороны: 1100 из 2700.
  const runX = (Math.min(width, depth) * (STAIR_RUN_MM / STAIR_L_SIDE_MM)) / width;
  const runY = (Math.min(width, depth) * (STAIR_RUN_MM / STAIR_L_SIDE_MM)) / depth;
  const split = stairSplit(steps, 1 - runY, 1 - runX);
  const out = [];
  stairRun(out, "y", -0.5 + runX / 2, runX, -0.5, 0.5 - runY, split.one);
  const corner = stairTread("y", -0.5 + runX / 2, runX, 0.5 - runY / 2 - (runY * STAIR_TREAD_SHARE) / 2, 0.5 - runY / 2 + (runY * STAIR_TREAD_SHARE) / 2, true);
  out.push(corner);
  stairRun(out, "x", 0.5 - runY / 2, runY, -0.5 + runX, 0.5, split.two);
  return out;
}

function objectStairU({ width, depth, steps }) {
  // Ход — каталожная доля ширины: 1100 из 2300, между ходами зазор. Площадка
  // у задника — квадратом хода, но не глубже половины габарита.
  const run = STAIR_RUN_MM / STAIR_U_WIDTH_MM;
  const runY = Math.min(0.45, (width * run) / depth);
  const split = stairSplit(steps, 1 - runY, 1 - runY);
  const out = [];
  stairRun(out, "y", -0.5 + run / 2, run, -0.5, 0.5 - runY, split.one);
  // Площадка у задника — во всю ширину, на пятую часть уже по краям, как ступени.
  const narrowY = runY * STAIR_TREAD_SHARE;
  const edge = (run * (1 - STAIR_TREAD_SHARE)) / 2;
  out.push({ x: -0.5 + edge, width: 1 - edge * 2, y: 0.5 - runY / 2 - narrowY / 2, depth: narrowY, landing: true });
  stairRun(out, "y", 0.5 - run / 2, run, 0.5 - runY, -0.5, split.two);
  return out;
}

/**
 * Спиральный: столб посередине и ступени клиньями вокруг него. Клин — плита по
 * контуру (`modelPlate`): повернуть коробку набор тел не умеет, а ступени
 * винтовой лестницы — это и есть повёрнутые плиты.
 */
function objectStairSpiral({ steps, z, thick, flip }) {
  const post = STAIR_POST_SHARE / 2;
  const outer = post + (0.5 - post) * STAIR_TREAD_SHARE;
  const turn = (Math.PI * 2 * STAIR_SPIRAL_TURNS) / steps;
  // Первая ступень — у лица (`y` −0.5), дальше влево (`x` убывает); отражение
  // ведёт вправо.
  const start = -Math.PI / 2;
  const sign = flip ? 1 : -1;
  const point = (radius, angle) => [Math.cos(angle) * radius, Math.sin(angle) * radius];
  const treads = [];
  for (let index = 0; index < steps; index += 1) {
    const a = start + sign * turn * index;
    const b = start + sign * turn * (index + 1);
    const mid = (a + b) / 2;
    treads.push(
      modelPlate("step" + (index + 1), [point(post, a), point(outer, a), point(outer, mid), point(outer, b), point(post, b)], {
        z: z(index),
        height: thick,
        material: index % 2 === 0 ? "body" : "light",
      }),
    );
  }
  return modelParts(modelCyl("post", { x: -post, width: post * 2, y: -post, depth: post * 2, z: 0, height: 1, material: "metal" }), treads);
}
