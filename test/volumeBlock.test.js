// Рамка блока в «Объёме» (таск 239, требование G360; раскладка — таск 241,
// требование G361).
//
// Слова заказчика: «Выключатели и розетки в 1 группе (в 1 блоке) располагать в
// объёме рядом друг с другом, в одном блоке, как и в жизни блоки
// розеток\выключаетелей, с межцентровым расстоянием 71 мм. Если только не
// указано иное. Например можно задать высоту, когда розетка снизу, на высоте 10
// см, на той же вертикали выключатель на высотк 90 см, а выше на высоте 150 см
// расположен термостат — тут высота от пола у каждого указывается.» И о
// готовой работе: «да, так и надо, столбиком. Хотя тут зависит от того как они
// на схеме расположены или по горизонтали или по вертикали».
//
// Проверяется **место тела в сцене**, а не толкование полей: отступ вдоль стены
// снимается с габарита модели (`place.frame.at`), высота — с его низа. Так тест
// не повторяет код размещения, а меряет то, что увидит глаз.
//
// Чего тест держать обязан: шаг 71 мм, середину блока точкой отсчёта, ряд вдоль
// стены и столбик поперёк неё — с теми же высотами, решётку в смешанном блоке,
// равные высоты поперёк, букву Г, стопку, порядок по плану (а не по
// справочнику), две рамки на углу, наклонную стену, нетронутое потолочное место
// и G68 — объект от показа не меняется ни байтом.
//
// Таск 245 добавил сюда два правила, и первое держится **только тестом**:
// многорядных рамок на объектах заказчика нет вовсе, и ближний к стене ряд
// (G368) проверить не на чем, кроме стенда — отсюда же вторая проверка, на
// другой стороне стены. Второе правило (G369) — пост без заданной высоты берёт
// её у соседей, а потолочный остаётся под потолком.
//
// Таск 284 держится тестом целиком и по той же причине: шахмата из постов со
// своими высотами на объектах заказчика нет ни одного. Поэтому рядом с ним
// стоят два сторожа принятых картинок — диагональ, у которой у каждого поста
// своя колонка (её решает направление, как с таска 241), и столбик с
// вписанными высотами (его раскладывает уже рисунок, а стоит он как стоял).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  addMark,
  addOutline,
  addRoom,
  addScheme,
  addToGroup,
  addType,
  addWall,
  applyMarkWalls,
  createProject,
  findMark,
  markSizes,
  planFractionToMm,
  planMmToFraction,
  setMarkWall,
  setPlanOrigin,
  setPlanScale,
  setSchemeWallHeight,
  sizesHeightSaid,
  updateMark,
  updateType,
} from "../src/model.js";
import { markSpareLine } from "../src/markSpare.js";
import { VOLUME_BLOCK_STEP_MM, volumeBlockSeats, volumeLampSources, volumeMarkFaces, volumeScene } from "../src/volume.js";

const BEFORE = JSON.parse(readFileSync(new URL("./fixtures/t263-volume-before.json", import.meta.url), "utf8"));

// ——— стенд: комната 4 × 3 м, северная стена по оси X ————————————————————————
//
// Та же комната, что у `volumeSocket.test.js`, и по той же причине: северная
// стена идёт вдоль `x`, поэтому отступ вдоль неё читается прямо координатой.

function roomScene() {
  const added = addScheme(createProject(), { name: "1 этаж", imageId: "plan-1", width: 1200, height: 800 });
  let project = setPlanScale(added.project, added.scheme.id, {
    a: { x: 0.1, y: 0.5 },
    b: { x: 0.6, y: 0.5 },
    meters: 6,
  }).project;
  const schemeId = added.scheme.id;
  project = setPlanOrigin(project, schemeId, { at: { x: 0.5, y: 0.5 }, turn: 0 }).project;
  project = setSchemeWallHeight(project, schemeId, 2700).project;
  const corners = [
    { x: -2000, y: -1500 },
    { x: 2000, y: -1500 },
    { x: 2000, y: 1500 },
    { x: -2000, y: 1500 },
  ];
  const walls = [];
  for (let index = 0; index < corners.length; index += 1) {
    const wall = addWall(project, { schemeId, aMm: corners[index], bMm: corners[(index + 1) % 4], thicknessMm: 200 });
    project = wall.project;
    walls.push(wall.wall.id);
  }
  const room = addRoom(project, "Кухня");
  project = addOutline(room.project, {
    schemeId,
    roomId: room.room.id,
    points: [
      { x: -1900, y: -1400 },
      { x: 1900, y: -1400 },
      { x: 1900, y: 1400 },
      { x: -1900, y: 1400 },
    ].map((point) => planMmToFraction(room.project, schemeId, point)),
  }).project;
  return { project, schemeId, walls };
}

const typeByCode = (project, code) => project.markTypes.find((type) => type.code === code);

/** Метка типа `code` на стене `wall`, `atMm` от её начала. Точка — по отступу. */
function putOnWall(scene, project, code, atMm, { wall = 0, y = -1300 } = {}) {
  const typeId = typeByCode(project, code).id;
  const added = addMark(project, {
    schemeId: scene.schemeId,
    typeId,
    kind: "point",
    points: [planMmToFraction(project, scene.schemeId, { x: atMm - 2000, y })],
  });
  const bound = setMarkWall(added.project, added.mark.id, { wallId: scene.walls[wall], atMm }).project;
  return { project: bound, markId: added.mark.id };
}

/**
 * Блок из меток: первая ставится, остальные добавляются к ней как соседние
 * точки — тем же путём, каким их ставит холст (`addToGroup`). Привязка каждой
 * ставится по её отступу, как это делает автоматика таска 127.
 *
 * `options.side` (и `part.side`) — сторона ручки «+», которой блок нарисован:
 * `"right"` ведёт точки **вдоль** северной стены, `"down"` — **поперёк** неё, в
 * глубину комнаты. С таска 241 от этого зависит раскладка (правило 2), поэтому
 * сторона у стенда называется вслух.
 */
function blockOnWall(scene, project, parts, options = {}) {
  const first = putOnWall(scene, project, parts[0].code, parts[0].atMm, options);
  let next = first.project;
  const ids = [first.markId];
  for (const part of parts.slice(1)) {
    const typeId = typeByCode(next, part.code).id;
    const grown = addToGroup(next, ids[ids.length - 1], part.side || options.side || "right", { typeId });
    next = setMarkWall(grown.project, grown.mark.id, {
      wallId: scene.walls[options.wall || 0],
      atMm: part.atMm,
    }).project;
    ids.push(grown.mark.id);
  }
  for (let index = 0; index < parts.length; index += 1) {
    if (parts[index].heightMm === undefined) continue;
    next = updateMark(next, ids[index], { heightAboveFloor: parts[index].heightMm }).project;
  }
  return { project: next, ids };
}

/** Отступ точки вдоль оси стены — от её начала. Своя арифметика теста. */
function alongWall(wall, at) {
  const dx = Number(wall.bMm.x) - Number(wall.aMm.x);
  const dy = Number(wall.bMm.y) - Number(wall.aMm.y);
  const len = Math.hypot(dx, dy);
  return ((at.x - Number(wall.aMm.x)) * dx + (at.y - Number(wall.aMm.y)) * dy) / len;
}

/** Тела метки в сцене: отступ вдоль оси своей стены и высота середины. */
function bodiesOf(scene, project, markId) {
  const built = volumeScene(project, scene.schemeId, {});
  return built.marks
    .filter((place) => place.markId === markId)
    .map((place) => {
      const wall = place.wallId ? project.walls.find((item) => item.id === place.wallId) : null;
      return {
        alongMm: wall ? alongWall(wall, place.frame.at) : null,
        heightMm: place.heightMm,
        place,
      };
    });
}

/** Одно тело метки — и падение со словами, если их больше или меньше. */
function bodyOf(scene, project, markId, label) {
  const bodies = bodiesOf(scene, project, markId);
  assert.equal(bodies.length, 1, label + ": тел у метки не одно, а " + bodies.length);
  return bodies[0];
}

// ——— ряд ———————————————————————————————————————————————————————————————————

test("блок из трёх на одной высоте — ряд через 71 мм от середины блока", () => {
  const scene = roomScene();
  // Привязки стенда нарочно неровные: 1900 · 2050 · 2100. Шаг знака на плане
  // меряется знаком (G182), и в миллиметрах выходит какой угодно.
  const block = blockOnWall(scene, scene.project, [
    { code: "Р", atMm: 1900 },
    { code: "Р", atMm: 2050 },
    { code: "Р", atMm: 2100 },
  ]);
  const along = block.ids.map((id) => bodyOf(scene, block.project, id, "розетка").alongMm);
  assert.equal(along[1] - along[0], VOLUME_BLOCK_STEP_MM, "первый шаг не 71 мм");
  assert.equal(along[2] - along[1], VOLUME_BLOCK_STEP_MM, "второй шаг не 71 мм");
  // Середина блока — половина между крайними привязками, (1900 + 2100) / 2.
  assert.equal((along[0] + along[2]) / 2, 2000, "ряд отсчитан не от середины блока");
  // Высота у всех одна: ряд по горизонтали, а не лесенкой.
  const heights = block.ids.map((id) => bodyOf(scene, block.project, id, "розетка").heightMm);
  assert.deepEqual(heights, [300, 300, 300], "ряд разъехался по высоте");
});

test("ряд из двух стоит симметрично середине: по 35,5 мм в каждую сторону", () => {
  const scene = roomScene();
  const block = blockOnWall(scene, scene.project, [
    { code: "Р", atMm: 1000 },
    { code: "Р", atMm: 1300 },
  ]);
  const along = block.ids.map((id) => bodyOf(scene, block.project, id, "розетка").alongMm);
  assert.deepEqual(along, [1150 - 35.5, 1150 + 35.5], "ряд из двух не симметричен середине блока");
});

// ——— столбик поперёк стены (пример заказчика) —————————————————————————————
//
// Блок, нарисованный **в глубину комнаты**: с таска 241 столбик решает
// направление точек, а высоты — только вертикаль. Тот же пример, нарисованный
// вдоль стены, идёт рядом (тест ниже).

test("поперёк стены блок встаёт на одну вертикаль: 100 · 900 · 1500", () => {
  const scene = roomScene();
  const block = blockOnWall(
    scene,
    scene.project,
    [
      { code: "Р", atMm: 1900, heightMm: 100 },
      { code: "В", atMm: 1990, heightMm: 900 },
      { code: "Д", atMm: 2080, heightMm: 1500 },
    ],
    { side: "down" },
  );
  const bodies = block.ids.map((id) => bodyOf(scene, block.project, id, "пост блока"));
  for (const body of bodies) {
    assert.equal(body.alongMm, 1990, "пост ушёл с оси блока: " + body.alongMm);
  }
  assert.deepEqual(
    bodies.map((body) => body.heightMm),
    [100, 900, 1500],
    "высоты разошлись с заданными",
  );
});

test("смешанный блок поперёк — решётка: ряд из совпавших высот, одиночка на оси", () => {
  const scene = roomScene();
  const block = blockOnWall(
    scene,
    scene.project,
    [
      { code: "Р", atMm: 1900, heightMm: 300 },
      { code: "Р", atMm: 1990, heightMm: 300 },
      { code: "В", atMm: 2080, heightMm: 900 },
    ],
    { side: "down" },
  );
  const bodies = block.ids.map((id) => bodyOf(scene, block.project, id, "пост блока"));
  // Ось блока — половина между 1900 и 2080.
  const axis = 1990;
  assert.deepEqual(
    bodies.map((body) => body.alongMm),
    [axis - 35.5, axis + 35.5, axis],
    "решётка собралась не по оси блока",
  );
  assert.deepEqual(
    bodies.map((body) => body.heightMm),
    [300, 300, 900],
    "высоты в решётке разошлись с заданными",
  );
});

// ——— блок без рамок: план расставляет приборы (таск 241, требование G361) ———
//
// Те же высоты, что в двух тестах выше, но на каждой высоте — **по одному
// посту**: рамок в блоке нет, есть отдельные приборы. Нарисованы вдоль стены —
// идут рядом, лесенкой; нарисованы в глубину — встают столбиком (тест выше).
// Это тот самый блок «Р78 В45» с объекта заказчика, ради которого таск 241 и
// делался: таск 242 его не трогает.

test("вдоль стены разные высоты идут рядом: один ряд через 71 мм, лесенкой", () => {
  const scene = roomScene();
  const block = blockOnWall(scene, scene.project, [
    { code: "Р", atMm: 1900, heightMm: 300 },
    { code: "В", atMm: 1990, heightMm: 900 },
    { code: "Д", atMm: 2080, heightMm: 1500 },
  ]);
  const bodies = block.ids.map((id) => bodyOf(scene, block.project, id, "пост блока"));
  const axis = 1990;
  assert.deepEqual(
    bodies.map((body) => body.alongMm),
    [axis - VOLUME_BLOCK_STEP_MM, axis, axis + VOLUME_BLOCK_STEP_MM],
    "ряд вдоль стены собрался не по одному посту на точку",
  );
  // Вертикаль у каждого своя: ряд не равняет высоты и не сводит их в одну.
  assert.deepEqual(
    bodies.map((body) => body.heightMm),
    [300, 900, 1500],
    "высоты в ряду разошлись с заданными",
  );
});

// ——— рамка собирается по высотам (таск 242, требование G363) ————————————————
//
// Стоило высоте повториться — и это уже рамка, а рамки встают друг над другом
// по середине блока, как бы блок ни был нарисован. На объекте заказчика так
// нарисованы четыре блока: «Р1 Р2 В5», «Р3 Р4 В4», «Р53 Р135 В69 В70» и
// «Р12 Р13 В6» (второй объект).

test("решётка 2 × 2: две розетки 300 и два выключателя 900, нарисованные в строчку", () => {
  const scene = roomScene();
  // Случай заказчика «Р53 Р135 В69 В70»: четыре поста подряд вдоль стены, но в
  // жизни это две рамки по два поста, одна над другой.
  const block = blockOnWall(scene, scene.project, [
    { code: "Р", atMm: 1900, heightMm: 300 },
    { code: "Р", atMm: 1990, heightMm: 300 },
    { code: "В", atMm: 2080, heightMm: 900 },
    { code: "В", atMm: 2170, heightMm: 900 },
  ]);
  const bodies = block.ids.map((id) => bodyOf(scene, block.project, id, "пост решётки"));
  const axis = 2035;
  assert.deepEqual(
    bodies.map((body) => body.alongMm),
    [axis - 35.5, axis + 35.5, axis - 35.5, axis + 35.5],
    "рамки не встали одна над другой по середине блока",
  );
  assert.deepEqual(
    bodies.map((body) => body.heightMm),
    [300, 300, 900, 900],
    "высоты рамок разошлись с заданными",
  );
});

test("рамка из двух и одиночка над ней: «Р1 Р2 В5» вдоль стены", () => {
  const scene = roomScene();
  const block = blockOnWall(scene, scene.project, [
    { code: "Р", atMm: 1900, heightMm: 300 },
    { code: "Р", atMm: 1990, heightMm: 300 },
    { code: "В", atMm: 2080, heightMm: 900 },
  ]);
  const bodies = block.ids.map((id) => bodyOf(scene, block.project, id, "пост блока"));
  const axis = 1990;
  assert.deepEqual(
    bodies.map((body) => body.alongMm),
    [axis - 35.5, axis + 35.5, axis],
    "рамка из двух и одиночка над ней собрались не по середине блока",
  );
  assert.deepEqual(
    bodies.map((body) => body.heightMm),
    [300, 300, 900],
    "высоты разошлись с заданными",
  );
});

test("равные высоты поперёк стены расходятся вдоль неё: в одном месте двух вещей не бывает", () => {
  const scene = roomScene();
  // Настоящий случай объекта заказчика («Р94 Р95»): две розетки на 300,
  // нарисованные одна за другой в глубину комнаты. Рамка, нарисованная в одну
  // колонку, остаётся одним рядом и ложится вдоль стены — это та же рамка,
  // повёрнутая на плане от тесноты (таск 239, правило цело с таска 242).
  const block = blockOnWall(
    scene,
    scene.project,
    [
      { code: "Р", atMm: 1000, heightMm: 300 },
      { code: "Р", atMm: 1300, heightMm: 300 },
    ],
    { side: "down" },
  );
  const bodies = block.ids.map((id) => bodyOf(scene, block.project, id, "розетка"));
  assert.deepEqual(
    bodies.map((body) => body.alongMm),
    [1150 - 35.5, 1150 + 35.5],
    "совпавшие высоты поперёк стены не разошлись вдоль неё",
  );
});

test("рамка 2 × 2 на плане встаёт рамкой 2 × 2 на стене", () => {
  const scene = roomScene();
  // Случай заказчика: «Алчему выключатели в ряд все, а не в блок 2*2?» Четыре
  // выключателя **одной** высоты, нарисованные на плане двумя рядами. Высотам
  // тут делить нечего — рамку делит рисунок: ряд, нарисованный ближе к стене,
  // **верхний**, уведённый в комнату — нижний (таск 245, G368, слова заказчика
  // «Ближе к стене — выше»; до него было наоборот). Заданные 900 становятся
  // серединой рамки, и ряды расходятся на те же 71 мм.
  const block = blockOnWall(scene, scene.project, [
    { code: "В", atMm: 1900, heightMm: 900 },
    { code: "В", atMm: 1990, heightMm: 900 },
    { code: "В", atMm: 1910, heightMm: 900 },
    { code: "В", atMm: 2000, heightMm: 900 },
  ]);
  // Точки плана ставятся прямо: ручка «+» шагает по одной оси, а здесь нужен
  // настоящий квадрат. Стена идёт по `y = −1500`, комната — ниже неё.
  const plan = [
    { x: -100, y: -1300 },
    { x: -10, y: -1300 },
    { x: -90, y: -1200 },
    { x: 0, y: -1200 },
  ];
  let project = block.project;
  for (let index = 0; index < block.ids.length; index += 1) {
    project = updateMark(project, block.ids[index], {
      points: [planMmToFraction(project, scene.schemeId, plan[index])],
    }).project;
  }
  const bodies = block.ids.map((id) => bodyOf(scene, project, id, "пост рамки"));
  assert.deepEqual(
    bodies.map((body) => body.heightMm),
    [900 + 35.5, 900 + 35.5, 900 - 35.5, 900 - 35.5],
    "ближний к стене ряд рамки 2 × 2 перестал быть верхним",
  );
  const axis = 1950;
  assert.deepEqual(
    bodies.map((body) => body.alongMm),
    [axis - 35.5, axis + 35.5, axis - 35.5, axis + 35.5],
    "ряды рамки 2 × 2 встали не по середине блока",
  );
});

test("ближний к стене ряд — верхний и на другой стороне стены", () => {
  const scene = roomScene();
  // Тот же случай, что выше, но на южной стене: комната от неё лежит в минус по
  // `y`, и «ближе к стене» значит на плане ровно обратное. Верх рамки идёт за
  // стеной и её стороной, а не за осью плана (G368) — иначе на половине стен
  // объекта рамка перевернулась бы.
  const south = 2;
  const block = blockOnWall(
    scene,
    scene.project,
    [
      { code: "В", atMm: 2100, heightMm: 900 },
      { code: "В", atMm: 2010, heightMm: 900 },
      { code: "В", atMm: 2090, heightMm: 900 },
      { code: "В", atMm: 2000, heightMm: 900 },
    ],
    { wall: south, y: 1300 },
  );
  // Стена идёт по `y = 1500` из угла (2000, 1500) в угол (−2000, 1500): отступ
  // вдоль неё считается в минус по `x`, а комната — выше по чертежу (`y` меньше).
  const plan = [
    { x: -100, y: 1300 },
    { x: -10, y: 1300 },
    { x: -90, y: 1200 },
    { x: 0, y: 1200 },
  ];
  let project = block.project;
  for (let index = 0; index < block.ids.length; index += 1) {
    project = updateMark(project, block.ids[index], {
      points: [planMmToFraction(project, scene.schemeId, plan[index])],
    }).project;
  }
  const bodies = block.ids.map((id) => bodyOf(scene, project, id, "пост рамки"));
  assert.deepEqual(
    bodies.map((body) => body.heightMm),
    [900 + 35.5, 900 + 35.5, 900 - 35.5, 900 - 35.5],
    "на южной стене ближний к ней ряд не стал верхним",
  );
});

test("блок буквой Г решается целиком — по длинной стороне габарита", () => {
  const scene = roomScene();
  // Блок без рамок (на каждой высоте по одному посту): три поста вдоль стены и
  // четвёртый, уведённый в глубину. Габарит длиннее вдоль — значит весь блок
  // идёт рядом и по углу не загибается.
  const bent = blockOnWall(scene, scene.project, [
    { code: "Р", atMm: 1900, heightMm: 300 },
    { code: "Р", atMm: 1990, heightMm: 900 },
    { code: "Р", atMm: 2080, heightMm: 1500 },
    { code: "В", atMm: 2170, heightMm: 2000, side: "down" },
  ]);
  const along = bent.ids.map((id) => bodyOf(scene, bent.project, id, "пост Г").alongMm);
  const axis = 2035;
  assert.deepEqual(
    along,
    [axis - 106.5, axis - 35.5, axis + 35.5, axis + 106.5],
    "блок буквой Г с длинной стороной вдоль стены встал не рядом",
  );
  // И наоборот: длинная сторона в глубину — вертикаль, разбитая высотами.
  const deep = blockOnWall(scene, scene.project, [
    { code: "Р", atMm: 1900, heightMm: 300 },
    { code: "Р", atMm: 1990, heightMm: 900, side: "down" },
    { code: "В", atMm: 2080, heightMm: 1500, side: "down" },
    { code: "В", atMm: 2170, heightMm: 2000, side: "down" },
  ]);
  for (const body of deep.ids.map((id) => bodyOf(scene, deep.project, id, "пост Г"))) {
    assert.equal(body.alongMm, 2035, "блок буквой Г с длинной стороной в глубину ушёл с оси");
  }
});

test("совпавшие посты о направлении молчат: решают высоты", () => {
  const scene = roomScene();
  // Стопка (G181): все точки блока в одном месте плана — направления нет
  // вовсе, и картинка остаётся той, что была до таска 241. Сюда же приходит
  // «развели только чтобы знаки не слиплись»: порог в миллиметрах не выдуман, а
  // мерятся два разброса между собой.
  const block = blockOnWall(scene, scene.project, [
    { code: "Р", atMm: 1900, heightMm: 100 },
    { code: "В", atMm: 1990, heightMm: 900 },
    { code: "Д", atMm: 2080, heightMm: 1500 },
  ]);
  let project = block.project;
  const at = planMmToFraction(project, scene.schemeId, { x: -100, y: -1300 });
  for (const id of block.ids) project = updateMark(project, id, { points: [at] }).project;
  for (const id of block.ids) {
    const body = bodyOf(scene, project, id, "пост стопки");
    assert.equal(body.alongMm, 1990, "стопка разъехалась вдоль стены: " + body.alongMm);
  }
});

test("наклонная стена: направление меряется её осью, а не осями плана", () => {
  const scene = roomScene();
  const added = addWall(scene.project, {
    schemeId: scene.schemeId,
    aMm: { x: -1000, y: 1000 },
    bMm: { x: 1000, y: -1000 },
    thicknessMm: 100,
  });
  let project = added.project;
  const u = { x: Math.SQRT1_2, y: -Math.SQRT1_2 };
  // Нормаль стены — та же, что в модели: влево от хода `a → b`.
  const n = { x: u.y, y: -u.x };
  /**
   * Пара постов на наклонной: розетка на 300 и выключатель на 900, второй
   * сдвинут на 300 мм в осях **стены**, а не плана. Блок собирается ручкой «+»,
   * как на холсте, и точка соседа потом ставится куда нужно — холст то же
   * делает перетаскиванием.
   */
  const pair = (shift) => {
    // −500 по нормали — внутрь комнаты: ровно на оси сторона стены не
    // определена (`markWallSideOn` отдаёт `null`), и метка на стену бы не встала.
    const base = { x: -1000 + 1000 * u.x - 500 * n.x, y: 1000 + 1000 * u.y - 500 * n.y };
    const typeId = typeByCode(project, "Р").id;
    const first = addMark(project, {
      schemeId: scene.schemeId,
      typeId,
      kind: "point",
      points: [planMmToFraction(project, scene.schemeId, base)],
    });
    let next = setMarkWall(first.project, first.mark.id, { wallId: added.wall.id, atMm: 1000 }).project;
    // Высота у розетки своя, а не справочная: иначе её перебьёт высота группы
    // (G203, «в группе высота распространяется на всех»), и столбика из двух
    // высот не вышло бы вовсе.
    next = updateMark(next, first.mark.id, { heightAboveFloor: 300 }).project;
    const grown = addToGroup(next, first.mark.id, "right", { typeId: typeByCode(next, "В").id });
    next = updateMark(grown.project, grown.mark.id, {
      points: [planMmToFraction(next, scene.schemeId, { x: base.x + shift.x, y: base.y + shift.y })],
      heightAboveFloor: 900,
    }).project;
    next = setMarkWall(next, grown.mark.id, { wallId: added.wall.id, atMm: 1090 }).project;
    return { project: next, ids: [first.mark.id, grown.mark.id] };
  };
  // Вдоль стены (сдвиг по её оси): высоты 300 и 900 не мешают ряду.
  const sideways = pair({ x: u.x * 300, y: u.y * 300 });
  const row = sideways.ids.map((id) => bodyOf(scene, sideways.project, id, "пост наклонной"));
  const gap = Math.hypot(
    row[1].place.frame.at.x - row[0].place.frame.at.x,
    row[1].place.frame.at.y - row[0].place.frame.at.y,
  );
  assert.ok(Math.abs(gap - VOLUME_BLOCK_STEP_MM) < 1e-6, "вдоль наклонной стены ряд вышел " + gap + " вместо 71");
  // Поперёк стены (сдвиг по её нормали): столбик, оба поста на одной вертикали.
  const deep = pair({ x: -n.x * 300, y: -n.y * 300 });
  const stack = deep.ids.map((id) => bodyOf(scene, deep.project, id, "пост наклонной"));
  const apart = Math.hypot(
    stack[1].place.frame.at.x - stack[0].place.frame.at.x,
    stack[1].place.frame.at.y - stack[0].place.frame.at.y,
  );
  assert.ok(apart < 1e-6, "поперёк наклонной стены посты разъехались на " + apart + " мм");
});

// ——— порядок в ряду ————————————————————————————————————————————————————————

test("порядок в ряду — порядок на плане, а не порядок справочника", () => {
  const scene = roomScene();
  // Розетка слева, выключатель справа, высота у обоих одна — значит ряд. В
  // справочнике выключатели идут раньше розеток (`blockMembers`), и возьми
  // объём порядок у модели — они бы поменялись местами вопреки плану.
  const block = blockOnWall(scene, scene.project, [
    { code: "Р", atMm: 1000, heightMm: 900 },
    { code: "В", atMm: 1200, heightMm: 900 },
  ]);
  const socket = bodyOf(scene, block.project, block.ids[0], "розетка");
  const switcher = bodyOf(scene, block.project, block.ids[1], "выключатель");
  assert.ok(socket.alongMm < switcher.alongMm, "розетка, нарисованная слева, встала в объёме справа");
  assert.equal(switcher.alongMm - socket.alongMm, VOLUME_BLOCK_STEP_MM, "шаг смешанного ряда не 71 мм");
});

// ——— одна метка со многими точками ————————————————————————————————————————

test("метка со многими точками — тело на точку, ряд через 71 мм", () => {
  const scene = roomScene();
  const socket = typeByCode(scene.project, "Р");
  // «Одна метка на блок»: режим берётся у типа (`blockModeOf`).
  let project = updateType(scene.project, socket.id, { blockMode: "single" }).project;
  const put = putOnWall(scene, project, "Р", 1900);
  project = put.project;
  let markId = put.markId;
  for (let step = 0; step < 2; step += 1) {
    const grown = addToGroup(project, markId, "right", { typeId: socket.id });
    project = grown.project;
    markId = grown.mark.id;
  }
  const mark = project.marks.find((item) => item.id === markId);
  assert.equal(mark.points.length, 3, "стенд обязан собрать одну метку с тремя точками");
  assert.equal(project.marks.filter((item) => item.schemeId === scene.schemeId).length, 1, "меток стало больше одной");
  const bodies = bodiesOf(scene, project, markId);
  assert.equal(bodies.length, 3, "у метки с тремя точками в объёме не три тела, а " + bodies.length);
  const along = bodies.map((body) => body.alongMm).sort((a, b) => a - b);
  assert.equal(along[1] - along[0], VOLUME_BLOCK_STEP_MM, "первый шаг не 71 мм");
  assert.equal(along[2] - along[1], VOLUME_BLOCK_STEP_MM, "второй шаг не 71 мм");
  // Середина ряда — середина нарисованного блока: половина между крайними
  // точками метки на плане. Считается здесь своей арифметикой, по плану, а не
  // по шагу знака: сам шаг — мера плана (G182) и тесту не нужен.
  const wall = project.walls.find((item) => item.id === scene.walls[0]);
  const own = mark.points.map((point) => alongWall(wall, planFractionToMm(project, scene.schemeId, point)));
  const middle = (Math.min(...own) + Math.max(...own)) / 2;
  assert.ok(
    Math.abs((along[0] + along[2]) / 2 - middle) <= 1,
    "ряд отсчитан не от середины блока: " + (along[0] + along[2]) / 2 + " вместо " + middle,
  );
  // Хозяин у всех трёх тел один — сама метка: иначе щелчок, связи и свет
  // перестали бы её находить.
  for (const body of bodies) assert.equal(body.place.markId, markId, "у тела блока чужой хозяин");
});

// ——— угол, наклонная стена, потолок ——————————————————————————————————————

test("блок через угол — две рамки: каждая на своей стене, со своей серединой", () => {
  const scene = roomScene();
  // Первая метка на северной стене у самого угла, вторая и третья — на
  // восточной. Подрозетник за угол не загибается.
  const first = putOnWall(scene, scene.project, "Р", 3900);
  let project = first.project;
  const ids = [first.markId];
  for (const part of [
    { atMm: 100, wall: 1 },
    { atMm: 200, wall: 1 },
  ]) {
    const typeId = typeByCode(project, "Р").id;
    const grown = addToGroup(project, ids[ids.length - 1], "right", { typeId });
    project = setMarkWall(grown.project, grown.mark.id, { wallId: scene.walls[part.wall], atMm: part.atMm }).project;
    ids.push(grown.mark.id);
  }
  const lone = bodyOf(scene, project, ids[0], "метка за углом");
  // Пост один на своей стене — двигать нечего: он остался на своей привязке.
  assert.equal(lone.alongMm, 3900, "одинокий пост блока сдвинули с его привязки");
  assert.equal(lone.place.wallId, scene.walls[0], "пост ушёл с северной стены");
  const pair = ids.slice(1).map((id) => bodyOf(scene, project, id, "пост за углом"));
  for (const body of pair) assert.equal(body.place.wallId, scene.walls[1], "пост ушёл с восточной стены");
  // Вторая рамка живёт своей серединой: (100 + 200) / 2 = 150.
  const along = pair.map((body) => body.alongMm);
  assert.deepEqual(along, [150 - 35.5, 150 + 35.5], "рамка на второй стене отсчитана не от своей середины");
});

test("наклонная стена: шаг 71 мм меряется вдоль неё, а не по осям плана", () => {
  const scene = roomScene();
  const added = addWall(scene.project, {
    schemeId: scene.schemeId,
    aMm: { x: -1000, y: 1000 },
    bMm: { x: 1000, y: -1000 },
    thicknessMm: 100,
  });
  let project = added.project;
  const typeId = typeByCode(project, "Р").id;
  // Шаг ручки «+» идёт по оси плана, а стена — под 45°: вдоль и поперёк выходит
  // ровно поровну, и о направлении такой рисунок не говорит ничего (правило 2,
  // таск 241). Высота у обеих розеток одна, и ряд — единственная раскладка,
  // какая им остаётся: на одной вертикали два тела совпали бы.
  //
  // Стена идёт под 45°; отступ 1000 от её начала — это точка (−293, 293). Точки
  // отодвинуты от оси на полметра: ровно на оси сторона стены не определена
  // (`markWallSideOn` отдаёт `null`), и метка на стену бы не встала.
  const u = Math.SQRT1_2;
  const first = addMark(project, {
    schemeId: scene.schemeId,
    typeId,
    kind: "point",
    points: [
      planMmToFraction(project, scene.schemeId, {
        x: -1000 + 1000 * u + 500 * u,
        y: 1000 - 1000 * u + 500 * u,
      }),
    ],
  });
  project = setMarkWall(first.project, first.mark.id, { wallId: added.wall.id, atMm: 1000 }).project;
  // Блок собирается тем же путём, что на холсте: соседняя точка.
  const grown = addToGroup(project, first.mark.id, "right", { typeId });
  project = setMarkWall(grown.project, grown.mark.id, { wallId: added.wall.id, atMm: 1200 }).project;
  const bodies = [first.mark.id, grown.mark.id].map((id) => bodyOf(scene, project, id, "пост на наклонной"));
  const gap = Math.hypot(
    bodies[1].place.frame.at.x - bodies[0].place.frame.at.x,
    bodies[1].place.frame.at.y - bodies[0].place.frame.at.y,
  );
  assert.ok(Math.abs(gap - VOLUME_BLOCK_STEP_MM) < 1e-6, "по наклонной стене шаг вышел " + gap + " вместо 71");
});

test("потолочная метка в посты не идёт: тело на точку, и каждое на своей точке", () => {
  const scene = roomScene();
  // Точечный светильник высоты в справочнике не имеет — он потолочный.
  const light = typeByCode(scene.project, "Т");
  assert.ok(light, "в справочнике есть точечный светильник");
  let project = updateType(scene.project, light.id, { blockMode: "single" }).project;
  const added = addMark(project, {
    schemeId: scene.schemeId,
    typeId: light.id,
    kind: "point",
    points: [{ x: 0.4, y: 0.4 }],
  });
  project = added.project;
  let markId = added.mark.id;
  const grown = addToGroup(project, markId, "right", { typeId: light.id });
  project = grown.project;
  markId = grown.mark.id;
  const mark = project.marks.find((item) => item.id === markId);
  assert.equal(mark.points.length, 2, "стенд обязан собрать метку с двумя точками");
  // Таск 263, G382: «Люстры и т.д. не объединяются в блоки. и двигать так не
  // надо ничего. где нарисовали, там и отображается». Тел столько, сколько
  // точек, и каждое стоит ровно на своей — ни межцентрового, ни середины блока.
  const bodies = bodiesOf(scene, project, markId);
  assert.equal(bodies.length, 2, "потолочная метка дала не по телу на точку");
  for (const body of bodies) {
    assert.equal(body.place.mode, "ceiling", "потолочная метка перестала быть потолочной");
    assert.equal(body.alongMm, null, "потолочное тело село на стену");
  }
  const drawn = mark.points.map((point) => planFractionToMm(project, scene.schemeId, point));
  for (let index = 0; index < drawn.length; index += 1) {
    const at = bodies[index].place.frame.at;
    assert.ok(
      Math.hypot(at.x - drawn[index].x, at.y - drawn[index].y) < 1e-6,
      "тело " + index + " уехало с нарисованной точки на " + Math.hypot(at.x - drawn[index].x, at.y - drawn[index].y) + " мм",
    );
  }
  // И посты у такой метки не считаются вовсе: её в блоке нет ни одним путём.
  assert.equal(
    volumeBlockSeats(project, project.marks).has(markId),
    false,
    "потолочная метка попала в посты блока",
  );
});

// ——— кто старше: заданная высота или рисунок (таск 263, G379, G381) ————————
//
// Слова заказчика: «если высота указана, то используется она. Если не указана,
// то рисонок важнее». Спорят они в одном месте — у рамки, нарисованной одной
// колонкой в глубину: заданное число держит её одним рядом вдоль стены (таск
// 242), а незаданное уступает рисунку. Высота из справочника при этом остаётся
// высотой поста: меняется только место.

test("дверь одна: «задана ли высота» отвечает лестнице, а не числу", () => {
  const scene = roomScene();
  // Четыре источника высоты и один ответ на каждый: своя и группы — слово
  // человека, умолчание типа и пустота — нет. Второго ответа в сборке быть не
  // должно (`sizesHeightSaid`, рядом с `markSizes` и `sizesSaidNothing`).
  const block = blockOnWall(scene, scene.project, [
    { code: "Р", atMm: 1000, heightMm: 300 },
    { code: "Р", atMm: 1100 },
  ]);
  const said = (project, markId) => sizesHeightSaid(markSizes(project, findMark(project, markId)));
  assert.equal(said(block.project, block.ids[0]), true, "своя высота не прочлась заданной");
  assert.equal(markSizes(block.project, findMark(block.project, block.ids[1])).heightAboveFloorFrom, "group");
  assert.equal(said(block.project, block.ids[1]), true, "высота от соседа по блоку (G203) не прочлась заданной");
  // Тот же блок без единой своей высоты: обе берут 300 у справочника.
  const type = blockOnWall(scene, scene.project, [
    { code: "Р", atMm: 1000 },
    { code: "Р", atMm: 1100 },
  ]);
  for (const id of type.ids) {
    assert.equal(markSizes(type.project, findMark(type.project, id)).heightAboveFloorFrom, "type");
    assert.equal(said(type.project, id), false, "высота из справочника прочлась заданной");
  }
  // И высоты нет вовсе — у потолочного света: назвать её некому.
  const light = typeByCode(scene.project, "Т");
  const added = addMark(scene.project, {
    schemeId: scene.schemeId,
    typeId: light.id,
    kind: "point",
    points: [{ x: 0.4, y: 0.4 }],
  });
  assert.equal(said(added.project, added.mark.id), false, "высота, которой нет, прочлась заданной");
});

test("высота из справочника раскладку не решает: пара в глубину встаёт вертикально", () => {
  const scene = roomScene();
  // Настоящий случай заказчика «Р94 Р95»: две розетки одна за другой в глубину
  // комнаты, и высоту 300 им никто не вписывал — она из справочника. До таска
  // 263 разбивка отменялась и пара ложилась вдоль стены (тест выше, с
  // **заданными** высотами, это правило и держит).
  //
  // Привязка у обоих постов одна: у заказчика они разведены на 2 мм, то есть
  // вдоль стены стоят в одном месте, а в глубину — друг за другом. Колонка
  // считается по привязке (правило 7: место — по привязке), и колонка у такой
  // пары одна.
  const block = blockOnWall(
    scene,
    scene.project,
    [
      { code: "Р", atMm: 1000 },
      { code: "Р", atMm: 1000 },
    ],
    { side: "down" },
  );
  const bodies = block.ids.map((id) => bodyOf(scene, block.project, id, "розетка"));
  for (const body of bodies) {
    assert.equal(body.alongMm, 1000, "пара в глубину не встала на одну вертикаль: " + body.alongMm);
  }
  // Ближний к стене — верхний (G368), и ряды расходятся на те же 71 мм вокруг
  // справочных 300: само число не подменяется ничем.
  assert.deepEqual(
    bodies.map((body) => body.heightMm),
    [300 + 35.5, 300 - 35.5],
    "ряды вертикальной пары разошлись не вокруг справочной высоты",
  );
});

test("шахматный блок встаёт шахматом, а не одним рядом вдоль стены", () => {
  const scene = roomScene();
  // Хвост таска 262 (G380): «если в шахматном порядке или ещё как-то, то так и
  // рисуй». Четыре выключателя справочной высоты, нарисованные через клетку: у
  // каждого своя глубина, то есть после разбивки в каждом ряду по одному посту
  // — и до таска 263 разбивка отменялась, а блок ложился одним рядом.
  const block = blockOnWall(scene, scene.project, [
    { code: "В", atMm: 1900 },
    { code: "В", atMm: 1990 },
    { code: "В", atMm: 2080 },
    { code: "В", atMm: 2170 },
  ]);
  const plan = [
    { x: -100, y: -1300 },
    { x: -10, y: -1210 },
    { x: 80, y: -1300 },
    { x: 170, y: -1210 },
  ];
  let project = block.project;
  for (let index = 0; index < block.ids.length; index += 1) {
    project = updateMark(project, block.ids[index], {
      points: [planMmToFraction(project, scene.schemeId, plan[index])],
    }).project;
  }
  const bodies = block.ids.map((id) => bodyOf(scene, project, id, "пост шахмата"));
  // Два ряда: ближний к стене (`y = −1300`) — верхний, уведённый в комнату —
  // нижний. Середина рамки — справочные 900.
  assert.deepEqual(
    bodies.map((body) => body.heightMm),
    [900 + 35.5, 900 - 35.5, 900 + 35.5, 900 - 35.5],
    "шахмат собрался в один ряд: высоты не разошлись по рядам",
  );
  // Колонки — по рисунку: четыре отступа, разведённые на 90 мм, дают четыре
  // колонки через модуль от середины блока (2035).
  assert.deepEqual(
    bodies.map((body) => body.alongMm),
    [2035 - 106.5, 2035 - 35.5, 2035 + 35.5, 2035 + 106.5],
    "колонки шахмата разошлись с рисунком",
  );
});

test("заданная высота рисунку не уступает: рамку в одну колонку держит число", () => {
  const scene = roomScene();
  // Тот же шахмат, но высоту каждому посту вписали рукой. «Если высота указана,
  // то используется она»: разведи ряды — и записанные 900 уехали бы на 35,5 мм.
  const block = blockOnWall(
    scene,
    scene.project,
    [
      { code: "В", atMm: 1000, heightMm: 900 },
      { code: "В", atMm: 1300, heightMm: 900 },
    ],
    { side: "down" },
  );
  const bodies = block.ids.map((id) => bodyOf(scene, block.project, id, "пост рамки"));
  assert.deepEqual(
    bodies.map((body) => body.heightMm),
    [900, 900],
    "заданная высота уехала с записанного числа",
  );
  assert.deepEqual(
    bodies.map((body) => body.alongMm),
    [1150 - 35.5, 1150 + 35.5],
    "рамка с заданной высотой не осталась одним рядом вдоль стены",
  );
});

test("высота от соседа по блоку — заданная: рамка остаётся одним рядом", () => {
  const scene = roomScene();
  // Второму посту высоту вписали рукой, первому — нет, и он берёт её у группы
  // (G203, `markSizes` делится только **своими** высотами соседей). Это слово
  // человека, просто сказанное у другой метки той же рамки, — значит заданное,
  // и разбивка в одну колонку отменяется на весь ярус: уедет именно записанное
  // число. Мера так и считается — «хоть у одного поста яруса высота задана».
  const block = blockOnWall(
    scene,
    scene.project,
    [
      { code: "Р", atMm: 1000 },
      { code: "Р", atMm: 1300, heightMm: 300 },
    ],
    { side: "down" },
  );
  const bodies = block.ids.map((id) => bodyOf(scene, block.project, id, "розетка"));
  assert.deepEqual(
    bodies.map((body) => body.heightMm),
    [300, 300],
    "ярус с одной заданной высотой разъехался по рядам",
  );
  assert.deepEqual(
    bodies.map((body) => body.alongMm),
    [1150 - 35.5, 1150 + 35.5],
    "ярус с одной заданной высотой не остался рядом вдоль стены",
  );
});

// ——— шахмат с заданными высотами (таск 284, требование G417) ———————————————
//
// Открытый случай, названный исполнителем таска 263: у блока, где на каждой
// высоте по одному посту, рамок нет вовсе, и рисунок читался одной мерой —
// направлением относительно стены (таск 241). Поэтому шахмат из постов с
// **вписанными** высотами вставал рядом или столбиком: ряды в глубину у него не
// читались. Ответ заказчика — «Делай».
//
// Правило теперь делится надвое и обеими половинами держится: **высота держит
// пост** (своё число не двигается ни на миллиметр), **рисунок держит место
// вдоль стены** (колонка). Мера рисунка та же, что у рамки, и третьей не
// заведено: колонок меньше, чем постов, — значит пост стоит над постом, и блок
// встаёт как нарисован; колонок столько же, сколько постов, — рисунок молчит, и
// решает направление, как с таска 241.

test("шахмат из заданных высот встаёт шахматом: колонки от рисунка, высоты свои", () => {
  const scene = roomScene();
  // Четыре поста, у каждого своя вписанная высота — рамок в блоке нет ни одной.
  // Нарисованы они 2 × 2: две привязки вдоль стены (1000 и 1200) и две глубины
  // (−1380 у стены, −1280 в комнату). До таска 284 вдоль стены разброс больше
  // (200 против 100), и блок ложился одним рядом из четырёх.
  const chess = frameOnWall(scene, scene.project, [
    { code: "Р", atMm: 1000, deepMm: -1380, heightMm: 100 },
    { code: "В", atMm: 1200, deepMm: -1380, heightMm: 900 },
    { code: "Р", atMm: 1000, deepMm: -1280, heightMm: 300 },
    { code: "В", atMm: 1200, deepMm: -1280, heightMm: 1100 },
  ]);
  const bodies = chess.ids.map((id) => bodyOf(scene, chess.project, id, "пост шахмата"));
  // Две колонки: середина блока — 1100, и колонки стоят по 35,5 мм от неё.
  assert.deepEqual(
    bodies.map((body) => body.alongMm),
    [1100 - 35.5, 1100 + 35.5, 1100 - 35.5, 1100 + 35.5],
    "колонки шахмата разошлись с рисунком",
  );
  // Высоты — записанные, все четыре. Ряд в такой раскладке говорит только о
  // колонке: поднимать посты ему нечем, у каждого своё число (G379).
  assert.deepEqual(
    bodies.map((body) => body.heightMm),
    [100, 900, 300, 1100],
    "заданная высота уехала с записанного числа",
  );
  // Лицо режется вдоль стены модулем — колонок две, и накладка одна (G372);
  // по вертикали до соседнего яруса 200 мм, резать нечем.
  for (const body of bodies) {
    assert.deepEqual(faceOf(body), [71, 80], "пост шахмата не поделил накладку с соседней колонкой");
  }
});

test("шахмат из справочных высот — тем же правилом: «задана ли» тут не спрашивается", () => {
  const scene = roomScene();
  // Та же картинка, но высоты не вписаны: 300 у розетки и 900 у выключателя из
  // справочника. Ответ обязан быть тот же — у блока без рамок рисунок не
  // поднимает ни одного поста, значит и спорить заданному числу не с чем; а
  // «если не указана, то рисонок важнее» (G379) и так на стороне рисунка.
  const chess = frameOnWall(
    scene,
    scene.project,
    [
      { code: "Р", atMm: 1000, deepMm: -1380 },
      { code: "В", atMm: 1200, deepMm: -1380 },
      { code: "Д", atMm: 1000, deepMm: -1280 },
      { code: "Бр", atMm: 1200, deepMm: -1280 },
    ],
    { typeHeights: true },
  );
  // Высоты у четырёх типов справочника разные — рамок в блоке нет.
  const heights = chess.ids.map((id) => markSizes(chess.project, findMark(chess.project, id)).heightAboveFloor);
  assert.equal(new Set(heights).size, 4, "стенд обязан собрать блок без единой рамки");
  for (const id of chess.ids) {
    assert.equal(
      sizesHeightSaid(markSizes(chess.project, findMark(chess.project, id))),
      false,
      "стенд обязан стоять на справочных высотах",
    );
  }
  const bodies = chess.ids.map((id) => bodyOf(scene, chess.project, id, "пост шахмата"));
  assert.deepEqual(
    bodies.map((body) => body.alongMm),
    [1100 - 35.5, 1100 + 35.5, 1100 - 35.5, 1100 + 35.5],
    "колонки шахмата из справочных высот разошлись с рисунком",
  );
  assert.deepEqual(bodies.map((body) => body.heightMm), heights, "справочная высота поста подменена раскладкой");
});

test("у каждого поста своя колонка — рисунок молчит, и решает направление", () => {
  const scene = roomScene();
  // Три поста по диагонали: вдоль стены разведены на 90 мм (у каждого своя
  // колонка), в глубину — на 150 мм (у каждого свой ряд). Над постом не стоит
  // никто, рядов и колонок рисунок не образует — значит это прежний случай
  // таска 241, и его решает направление: в глубину больше, чем вдоль, —
  // столбик на оси блока. Картинка заказчика, принятая словами, не меняется.
  const slope = frameOnWall(scene, scene.project, [
    { code: "Р", atMm: 1900, deepMm: -1380, heightMm: 300 },
    { code: "В", atMm: 1990, deepMm: -1230, heightMm: 900 },
    { code: "Д", atMm: 2080, deepMm: -1080, heightMm: 1500 },
  ]);
  const bodies = slope.ids.map((id) => bodyOf(scene, slope.project, id, "пост диагонали"));
  for (const body of bodies) {
    assert.equal(body.alongMm, 1990, "диагональ ушла с оси блока: " + body.alongMm);
  }
  assert.deepEqual(bodies.map((body) => body.heightMm), [300, 900, 1500], "высоты диагонали разошлись с заданными");
});

test("столбик с заданными высотами стоит, как стоял: одна колонка — он и есть", () => {
  const scene = roomScene();
  // Две метки с вписанными высотами, нарисованные друг за другом в глубину на
  // одной привязке: колонка у них одна, и раскладывает их теперь рисунок — а
  // ответ прежний, столбик. Ряд при этом не поднимает ничего: у стены стоит
  // та высота, которая вписана, даже если у стены вписана **нижняя** (G368 — о
  // рядах рамки, а не о заданных числах).
  const column = frameOnWall(scene, scene.project, [
    { code: "В", atMm: 1200, deepMm: -1380, heightMm: 300 },
    { code: "Р", atMm: 1200, deepMm: -1280, heightMm: 900 },
  ]);
  const bodies = column.ids.map((id) => bodyOf(scene, column.project, id, "пост столбика"));
  for (const body of bodies) {
    assert.equal(body.alongMm, 1200, "столбик ушёл с привязки: " + body.alongMm);
  }
  assert.deepEqual(bodies.map((body) => body.heightMm), [300, 900], "столбик разъехался с записанных чисел");
  // И лица он не теряет: колонка одна, делить накладку вдоль стены не с кем.
  for (const body of bodies) {
    assert.deepEqual(faceOf(body), [80, 80], "столбику урезали лицо из-за новой раскладки");
  }
});

// ——— высота от соседей по блоку (таск 245, требование G369) ————————————————
//
// Слова заказчика: «Брать высоту соседей по блоку». «Высоты нет» значит в
// сборке две разные вещи, и правило их различает (`sizesSaidNothing`): о
// потолочной вещи сказан габарит и умолчано о посадке, а о вещи без заданной
// высоты не сказано ничего. На объекте заказчика такой случай один —
// «кабель-канал» в блоке розеток на 300: ни у него, ни у его типа не заполнено
// ни одно поле.

/**
 * Тип, о котором не сказано ничего: «высота не задана», а не «её не бывает».
 *
 * Заводится руками и без фигуры — иначе размеры ему проставит миграция
 * `fillTypeSizes` (по коду, потом по форме знака), и случай заказчика не
 * воспроизведётся. Его «кабель-канал» и «не определено» уцелели ровно потому,
 * что сборка не узнала ни код, ни знак.
 */
function bareType(project) {
  const added = addType(project, {
    code: "КК",
    name: "Кабель канал",
    categoryId: typeByCode(project, "ВП").categoryId,
    shape: null,
  });
  assert.equal(added.type.sizes, undefined, "у заведённого руками типа не должно быть размеров");
  return added.project;
}

test("пост без заданной высоты встаёт в рамку с соседями", () => {
  const scene = roomScene();
  // Настоящий случай заказчика: три поста в ряд, у третьего высоты нет вовсе.
  // До таска он оставался под потолком и молча; теперь это третий пост рамки.
  const project = bareType(scene.project);
  // Высоты розеток — **из справочника**, а не свои: именно так они стоят у
  // заказчика. Это важно, и вот почему: лестница `markSizes` делится по группе
  // только **своей** высотой соседа (G203), значит от типа она не достаётся, и
  // без этой правки третий пост остался бы без высоты.
  const block = blockOnWall(scene, project, [
    { code: "Р", atMm: 1900 },
    { code: "Р", atMm: 1990 },
    { code: "КК", atMm: 2080 },
  ]);
  const bodies = block.ids.map((id) => bodyOf(scene, block.project, id, "пост блока"));
  const axis = 1990;
  assert.deepEqual(
    bodies.map((body) => body.alongMm),
    [axis - VOLUME_BLOCK_STEP_MM, axis, axis + VOLUME_BLOCK_STEP_MM],
    "пост без высоты не встал в ряд с соседями",
  );
  assert.deepEqual(
    bodies.map((body) => body.heightMm),
    [300, 300, 300],
    "пост без высоты не взял высоту блока",
  );
  assert.equal(bodies[2].place.mode, "wall", "пост без высоты остался висеть под потолком");
});

test("высоты у соседей разные — пост берёт нижнюю", () => {
  const scene = roomScene();
  // Розетка 300 и выключатель 900: пост без высоты садится в нижнюю рамку — то
  // же правило, по которому высотой группы делится `markSizes` (G203, а та — за
  // развёрткой G191: «одну высоту указывать у группы по нижнему объекту»).
  const project = bareType(scene.project);
  const block = blockOnWall(scene, project, [
    { code: "Р", atMm: 1900 },
    { code: "В", atMm: 1990 },
    { code: "КК", atMm: 2080 },
  ]);
  const bodies = block.ids.map((id) => bodyOf(scene, block.project, id, "пост блока"));
  assert.deepEqual(
    bodies.map((body) => body.heightMm),
    [300, 900, 300],
    "пост без высоты взял не нижнюю высоту блока",
  );
  const axis = 1990;
  assert.deepEqual(
    bodies.map((body) => body.alongMm),
    [axis - 35.5, axis, axis + 35.5],
    "рамка из двух и одиночка над ней собрались не по середине блока",
  );
});

test("потолочной метке высоту соседей не дают: о габарите сказано", () => {
  const scene = roomScene();
  // Точечный светильник: габарит у типа есть (90 × 90), высоты нет — такая вещь
  // потолочная, и на стену к розетке она не уезжает. Розетка от этого тоже не
  // двигается: рамки из одного поста не бывает.
  //
  // Высота розетки — из справочника. Задай ей **свою** — и светильник возьмёт
  // 300 у лестницы `markSizes` (G203) ещё до всякой рамки: это картинка,
  // которая была до таска, и трогать её нельзя (G68).
  const block = blockOnWall(scene, scene.project, [
    { code: "Р", atMm: 1900 },
    { code: "Т", atMm: 1990 },
  ]);
  const socket = bodyOf(scene, block.project, block.ids[0], "розетка");
  const light = bodyOf(scene, block.project, block.ids[1], "светильник");
  assert.equal(light.place.mode, "ceiling", "потолочный светильник уехал на стену к розетке");
  assert.equal(socket.alongMm, 1900, "розетка поехала из-за потолочной соседки");
});

test("блоку делиться нечем: высоты нет ни у одного поста", () => {
  const scene = roomScene();
  // Настоящий случай заказчика: две метки «не определено» в одном блоке. Брать
  // высоту не у кого, и обе остаются там, где стояли, — дотасковая картинка.
  const project = bareType(scene.project);
  const block = blockOnWall(scene, project, [
    { code: "КК", atMm: 1900 },
    { code: "КК", atMm: 1990 },
  ]);
  for (const id of block.ids) {
    const body = bodyOf(scene, block.project, id, "пост без высоты");
    assert.equal(body.place.mode, "ceiling", "пост блока без единой высоты уехал на стену");
  }
});

test("фильтр блок не двигает: спрятанная розетка не уносит соседку", () => {
  const scene = roomScene();
  const block = blockOnWall(scene, scene.project, [
    { code: "Р", atMm: 1900 },
    { code: "Р", atMm: 2000 },
    { code: "Р", atMm: 2100 },
  ]);
  const all = block.ids.map((id) => bodyOf(scene, block.project, id, "розетка").alongMm);
  // Та же сцена, но на плане видны только две метки из трёх — так окно отдаёт
  // в объём отфильтрованный список. Рамка на стене от этого не едет.
  const shown = block.project.marks.filter((mark) => mark.id !== block.ids[2]);
  const built = volumeScene(block.project, scene.schemeId, { marks: shown });
  const wall = block.project.walls.find((item) => item.id === scene.walls[0]);
  for (let index = 0; index < 2; index += 1) {
    const place = built.marks.find((item) => item.markId === block.ids[index]);
    assert.ok(place, "видимая розетка пропала из сцены");
    assert.equal(alongWall(wall, place.frame.at), all[index], "видимая розетка поехала из-за спрятанной соседки");
  }
});

// ——— колонки рамки (таск 246, требование G371) ———————————————————————————————
//
// Слова заказчика по снимку его объекта: «метки расставлены так,
// соответственно сверху должны быть выключатели, которые ближе к стене, по
// центру три двойных, и ниже ещё 2 одинарных, при чем выровнены по левому краю
// (ближе к углу), как и расставлены на схеме, а они почему-то выравнены по
// центру в объёме».
//
// Блок с того снимка на объекте есть: семь выключателей 900 одной группой, три
// ряда 2 / 3 / 2 и три колонки с шагом 88…93 мм. До таска место поста задавал
// его номер **в своём ряду**, и короткие ряды центрировались сами по себе —
// вставали между колонками длинного.

/**
 * Рамка из рядов разной длины: `atMm` задаёт колонку (отступ вдоль стены),
 * `deepMm` — ряд (как далеко пост нарисован в комнату). Точки ставятся прямо:
 * ручка «+» шагает по одной оси, а здесь нужна решётка.
 */
function frameOnWall(scene, project, posts, options = {}) {
  const block = blockOnWall(
    scene,
    project,
    posts.map((post) => ({
      code: post.code || "В",
      atMm: post.atMm,
      // Умолчание стенда — 900 у всех: так посты собираются одним ярусом, то
      // есть одной рамкой. `options.typeHeights` не вписывает высоту вовсе
      // (таск 284) — каждый код берёт свою справочную, и рамок в блоке не
      // образуется ни одной.
      heightMm: options.typeHeights ? undefined : post.heightMm || 900,
    })),
  );
  let next = block.project;
  for (let index = 0; index < block.ids.length; index += 1) {
    next = updateMark(next, block.ids[index], {
      points: [planMmToFraction(next, scene.schemeId, { x: posts[index].atMm - 2000, y: posts[index].deepMm })],
    }).project;
  }
  return { project: next, ids: block.ids };
}

test("рамка 2 / 3 / 2: короткие ряды встают в колонки рисунка, а не по своей середине", () => {
  const scene = roomScene();
  // Блок заказчика целиком: колонки 1900 · 1990 · 2080 (шаг 90), ряды −1380
  // (ближний к стене) · −1280 · −1180. В коротких рядах нет первой колонки —
  // значит и в объёме её быть не должно.
  const frame = frameOnWall(scene, scene.project, [
    { atMm: 1990, deepMm: -1380 },
    { atMm: 2080, deepMm: -1380 },
    { atMm: 1900, deepMm: -1280 },
    { atMm: 1990, deepMm: -1280 },
    { atMm: 2080, deepMm: -1280 },
    { atMm: 1990, deepMm: -1180 },
    { atMm: 2080, deepMm: -1180 },
  ]);
  const bodies = frame.ids.map((id) => bodyOf(scene, frame.project, id, "пост рамки 2/3/2"));
  // Середина блока — половина между крайними привязками, (1900 + 2080) / 2.
  const axis = 1990;
  assert.deepEqual(
    bodies.map((body) => body.alongMm),
    [axis, axis + 71, axis - 71, axis, axis + 71, axis, axis + 71],
    "короткие ряды рамки встали не по колонкам рисунка",
  );
  // Ближний к стене ряд — верхний (G368), и заданные 900 остаются серединой.
  assert.deepEqual(
    bodies.map((body) => body.heightMm),
    [971, 971, 900, 900, 900, 829, 829],
    "ряды рамки 2 / 3 / 2 разошлись по высоте не на 71 мм",
  );
});

test("однорядная рамка: колонка совпадает с местом в ряду, картинка дотасковая", () => {
  const scene = roomScene();
  // То же, что у первого теста файла, но проверяется именно колонка: в ряду
  // каждый пост заводит свою, и формула выходит прежней. Этим держится
  // обещание «кадр готового объекта совпадает байт в байт».
  const block = blockOnWall(scene, scene.project, [
    { code: "Р", atMm: 1900 },
    { code: "Р", atMm: 2050 },
    { code: "Р", atMm: 2100 },
  ]);
  assert.deepEqual(
    block.ids.map((id) => bodyOf(scene, block.project, id, "розетка").alongMm),
    [2000 - 71, 2000, 2000 + 71],
    "однорядная рамка поехала от колонок",
  );
});

test("совпавшие посты одного ряда расходятся по колонкам, а не слипаются в одну", () => {
  const scene = roomScene();
  // Настоящий случай заказчика: «П16 П17 П18» — два поста стоят на одном
  // отступе. Ближе полпоста друг к другу посты сходятся в одну колонку, но
  // двум постам **одного ряда** в одной колонке не разойтись, и каждый заводит
  // свою — иначе два тела встали бы одно в другое.
  const block = blockOnWall(scene, scene.project, [
    { code: "В", atMm: 1900, heightMm: 900 },
    { code: "В", atMm: 2000, heightMm: 900 },
    { code: "В", atMm: 2000, heightMm: 900 },
  ]);
  const along = block.ids.map((id) => bodyOf(scene, block.project, id, "пост стопки").alongMm).sort((a, b) => a - b);
  assert.deepEqual(along, [1950 - 71, 1950, 1950 + 71], "совпавшие посты ряда слиплись в одну колонку");
});

// ——— мера лица (таск 246, требование G372) ————————————————————————————————————
//
// Слова заказчика о той же картинке: «и, кажется, что вертикально друг на
// друга налезают». Ряды рамки разведены на 71 мм — это межцентровое
// подрозетников, и оно верное, — а лицо поста рисовалось габаритом метки: у
// «Розетки» и «Выключателя» это 80 × 80, то есть девять миллиметров внахлёст.
// В жизни посты одной рамки делят накладку, и каждому достаётся ровно модуль.

/** Лицо тела: длина вдоль стены × высота. */
const faceOf = (body) => [body.place.frame.widthMm, body.place.frame.heightMm];

test("одинокая метка своего габарита не теряет: 80 × 80 как записано", () => {
  const scene = roomScene();
  const lone = putOnWall(scene, scene.project, "Р", 1900);
  const body = bodyOf(scene, lone.project, lone.markId, "одинокая розетка");
  assert.deepEqual(faceOf(body), [80, 80], "одинокой метке урезали лицо");
});

test("ряд через 71 мм: лицо режется шагом вдоль стены, высота цела", () => {
  const scene = roomScene();
  const block = blockOnWall(scene, scene.project, [
    { code: "Р", atMm: 1900 },
    { code: "Р", atMm: 2000 },
    { code: "Р", atMm: 2100 },
  ]);
  for (const id of block.ids) {
    assert.deepEqual(faceOf(bodyOf(scene, block.project, id, "розетка ряда")), [71, 80], "пост ряда не стал модулем");
  }
});

test("многорядная рамка: модуль и по вертикали — 71 × 71", () => {
  const scene = roomScene();
  const frame = frameOnWall(scene, scene.project, [
    { atMm: 1990, deepMm: -1380 },
    { atMm: 2080, deepMm: -1380 },
    { atMm: 1900, deepMm: -1280 },
    { atMm: 1990, deepMm: -1280 },
    { atMm: 2080, deepMm: -1280 },
  ]);
  for (const id of frame.ids) {
    const face = faceOf(bodyOf(scene, frame.project, id, "пост рамки"));
    assert.deepEqual(face, [71, 71], "пост многорядной рамки налезает на соседний ряд");
  }
});

test("столбик из разных высот лица не теряет: колонка у него одна", () => {
  const scene = roomScene();
  // Блок без рамок, нарисованный в глубину (пример заказчика 100 · 900 · 1500):
  // все посты на одной вертикали, колонка одна, делить накладку не с кем — и
  // габарит остаётся записанным.
  const block = blockOnWall(
    scene,
    scene.project,
    [
      { code: "Р", atMm: 1900, heightMm: 100 },
      { code: "В", atMm: 1990, heightMm: 900 },
      { code: "Д", atMm: 2080, heightMm: 1500 },
    ],
    { side: "down" },
  );
  // Розетка и выключатель справочника — 80 мм вдоль стены, домофон — 150.
  assert.deepEqual(
    block.ids.map((id) => bodyOf(scene, block.project, id, "пост столбика").place.frame.widthMm),
    [80, 80, 150],
    "столбику урезали длину лица",
  );
  // И по вертикали целое: до соседнего яруса 600 и 800 мм, резать нечем
  // (домофон справочника — 150 × 200).
  assert.deepEqual(
    block.ids.map((id) => bodyOf(scene, block.project, id, "пост столбика").place.frame.heightMm),
    [80, 80, 200],
    "столбику урезали высоту лица",
  );
});

// ——— теснота по вертикали (таск 247, требование G374) ————————————————————————
//
// Счёт по четырём объектам заказчика нашёл четыре пары тел **одного блока**,
// заходящих друг на друга: человек собирал столбик руками и вписывал высоты
// через 70 мм при лице 80 (Р16 · Р17 · Р18 на 2000 · 2070 · 2140 и две пары
// 900 / 970). Рамок такой блок не образует (таск 241), и шаг лица ему таск 246
// не резал. Мера у таска 247 одна с таском 246 и названа по-человечески: посту
// достаётся столько, сколько есть **до соседнего яруса блока**, — в рамке это
// ровно модуль, и её кадр не меняется ни пикселем.

/** Низ и верх тела: по ним и видно, налезают ли соседи друг на друга. */
const spanOf = (body) => [body.place.frame.bottomMm, body.place.frame.bottomMm + body.place.frame.heightMm];

test("столбик с высотами через 70 мм: лицо режется до соседа, а не до модуля", () => {
  const scene = roomScene();
  // Настоящий случай заказчика «Резеденция ГЧ» (Р16 · Р17 · Р18): три розетки
  // 80 × 80 на одной вертикали через 70 мм — по 10 мм внахлёст.
  const block = blockOnWall(
    scene,
    scene.project,
    [
      { code: "Р", atMm: 1900, heightMm: 2000 },
      { code: "Р", atMm: 1990, heightMm: 2070 },
      { code: "Р", atMm: 2080, heightMm: 2140 },
    ],
    { side: "down" },
  );
  const bodies = block.ids.map((id) => bodyOf(scene, block.project, id, "пост столбика"));
  // Лицо — до соседа (70), а не до модуля (71): модулем остался бы миллиметр
  // нахлёста. Длина вдоль стены цела: колонка у столбика одна.
  for (const body of bodies) assert.deepEqual(faceOf(body), [80, 70], "пост столбика налезает на соседа");
  // Середина тела осталась записанной высотой: по ней целится рамка выделения и
  // приходит стрелка связи, и уехать ей нельзя — поэтому мера симметрична, а не
  // своя у каждой стороны. Это и есть ответ на «пост с двумя соседями».
  assert.deepEqual(
    bodies.map((body) => body.heightMm),
    [2000, 2070, 2140],
    "середина тела уехала с записанной высоты",
  );
  const spans = bodies.map(spanOf);
  assert.deepEqual(spans, [[1965, 2035], [2035, 2105], [2105, 2175]], "тела столбика стоят не вплотную");
});

test("рамки блока на 900 и 970: лицо режется разницей их чисел", () => {
  const scene = roomScene();
  // Пара заказчика «Данково 60» (ВВ6 × В6) и «Резеденция ГЧ» (ВВ3 × ВВ4):
  // высоты заданы через 70 мм, и рамка над рамкой стоит теснее своего лица.
  // Высоты заданных чисел сборка не подгоняет под модуль — это слово человека
  // (G68), — а режет лицо до того, что есть.
  const block = blockOnWall(
    scene,
    scene.project,
    [
      { code: "В", atMm: 1900, heightMm: 900 },
      { code: "В", atMm: 1990, heightMm: 970 },
    ],
    { side: "down" },
  );
  const bodies = block.ids.map((id) => bodyOf(scene, block.project, id, "пост рамки"));
  for (const body of bodies) assert.deepEqual(faceOf(body), [80, 70], "рамки блока налезают друг на друга");
  assert.deepEqual(bodies.map(spanOf), [[865, 935], [935, 1005]], "рамки блока стоят не вплотную");
});

test("рамка с рядами меряется своим модулем, а не далёкой соседкой", () => {
  const scene = roomScene();
  // Многорядная рамка на 900 и одиночная розетка на 300 в одном блоке: у рамки
  // мера своя (ряды через 71), у розетки соседа ближе 529 мм нет — и её лицо
  // остаётся записанным. Этим и держится обещание «кадр таска 246 не изменился»:
  // мера общая на рамку, а не на блок.
  const frame = frameOnWall(scene, scene.project, [
    { atMm: 1990, deepMm: -1380 },
    { atMm: 2080, deepMm: -1380 },
    { atMm: 1900, deepMm: -1280 },
    { atMm: 1990, deepMm: -1280 },
    { atMm: 2080, deepMm: -1280 },
    { atMm: 1990, deepMm: -1180, code: "Р", heightMm: 300 },
  ]);
  const posts = frame.ids.slice(0, 5).map((id) => bodyOf(scene, frame.project, id, "пост рамки"));
  for (const body of posts) assert.deepEqual(faceOf(body), [71, 71], "пост многорядной рамки потерял модуль");
  const socket = bodyOf(scene, frame.project, frame.ids[5], "розетка 300");
  assert.deepEqual(faceOf(socket), [80, 80], "одиночной рамке блока урезали лицо из-за далёкой соседки");
});

// ——— пост без размеров — модуль (таск 247, требование G373) ——————————————————
//
// Слова заказчика о работе таска 246: «исправь хвосты». Первый — «Кабель-канал»
// в блоке розеток: размеров у него нет ни одного, габарит лица берётся у
// изображения объекта (400 × 500), и в рамке он стоял полуметровым столбом.
// Честная догадка в рамке подрозетников — пост, а не силуэт вещи во всю стену.

/**
 * Тип, о котором не сказано ничего, но со знаком: ровно «Кабель-канал»
 * заказчика (`shape: "square-bolt"`). Знак даёт изображение «appliance» с
 * габаритом 400 × 500, а размеров у типа нет — и миграция `fillTypeSizes` этой
 * формы не узнаёт, поэтому случай воспроизводится как на объекте.
 */
function boltType(project) {
  const added = addType(project, {
    code: "КК",
    name: "Кабель канал",
    categoryId: typeByCode(project, "ВП").categoryId,
    shape: "square-bolt",
  });
  assert.equal(added.type.sizes, undefined, "у заведённого руками типа не должно быть размеров");
  return added.project;
}

test("пост блока без размеров рисуется модулем, а не габаритом изображения", () => {
  const scene = roomScene();
  const project = boltType(scene.project);
  const block = blockOnWall(scene, project, [
    { code: "Р", atMm: 1900 },
    { code: "Р", atMm: 1990 },
    { code: "КК", atMm: 2080 },
  ]);
  const post = bodyOf(scene, block.project, block.ids[2], "пост без размеров");
  assert.deepEqual(faceOf(post), [71, 71], "пост без размеров остался полуметровым столбом");
  // Из блока он не выкинут (G369 таска 245): высоту взял у соседей и стоит в
  // рамке третьей колонкой.
  assert.equal(post.heightMm, 300, "пост без размеров потерял высоту соседей");
  assert.equal(post.alongMm, 1990 + VOLUME_BLOCK_STEP_MM, "пост без размеров вышел из рамки");
  // А соседи остались при своём: модуль — ответ о вещи, а не о рамке.
  assert.deepEqual(
    faceOf(bodyOf(scene, block.project, block.ids[0], "розетка")),
    [71, 80],
    "соседняя розетка потеряла лицо",
  );
});

test("одинокая метка без размеров запасной габарит не теряет", () => {
  const scene = roomScene();
  // Про неё договорено отдельно (G226, G230) и менять это не надо: рамки у неё
  // нет, подменять габарит нечем, и строка о догадке говорит о том же.
  const project = boltType(scene.project);
  const lone = putOnWall(scene, project, "КК", 1900);
  const bare = updateMark(lone.project, lone.markId, { heightAboveFloor: 300 }).project;
  const body = bodyOf(scene, bare, lone.markId, "одинокая вещь без размеров");
  assert.deepEqual(faceOf(body), [400, 500], "одинокой метке подменили габарит модулем");
});

test("строка о запасном габарите называет модуль поста", () => {
  const scene = roomScene();
  const project = boltType(scene.project);
  const block = blockOnWall(scene, project, [
    { code: "Р", atMm: 1900 },
    { code: "КК", atMm: 1990 },
  ]);
  const built = volumeScene(block.project, scene.schemeId, {});
  assert.deepEqual(
    built.spare.map((item) => item.label),
    ["КК1"],
    "о догаданном габарите сборка молчит",
  );
  assert.equal(built.spare[0].postMm, VOLUME_BLOCK_STEP_MM, "модуль поста не дошёл до строки");
  const said = markSpareLine(built.spare, { why: true });
  assert.ok(said.includes("КК1"), said);
  assert.ok(said.includes(String(VOLUME_BLOCK_STEP_MM)), "строка не назвала модуль: " + said);
  // Голова строки прежняя: факт «размер догадан» никуда не делся.
  assert.ok(said.startsWith(markSpareLine(built.spare)), said);
});

// ——— G68 ———————————————————————————————————————————————————————————————————

test("G68: показ блока в объёме не меняет объект ни на байт", () => {
  const scene = roomScene();
  const block = blockOnWall(scene, scene.project, [
    { code: "Р", atMm: 1900, heightMm: 100 },
    { code: "В", atMm: 1990, heightMm: 900 },
    { code: "Д", atMm: 2080, heightMm: 1500 },
  ]);
  const before = JSON.stringify(block.project);
  volumeScene(block.project, scene.schemeId, {});
  volumeScene(block.project, scene.schemeId, {});
  assert.equal(JSON.stringify(block.project), before, "сборка сцены правит объект");
  // И точки на плане остались прежними: ряд в объёме плана не двигает.
  const points = block.ids.map((id) => block.project.marks.find((mark) => mark.id === id).points[0]);
  assert.equal(points.length, 3, "метки блока на месте");
  for (const point of points) assert.ok(point.x >= 0 && point.x <= 1, "точка метки уехала из долей плана");
});

// ——— G68: объект без блоков собирается грань в грань прежним ————————————————
//
// Таск 263 трогает две двери, которые зовутся **у каждой** метки: место тела
// (`volumeMarkPlacement` получил номер нарисованной точки) и свет
// (`volumeLampSources` раздаётся по телам). Отпечаток кадра снят на прежнем
// коде и лежит в `fixtures/t263-volume-before.json`: комната без единого блока
// — розетка на стене, спот и люстра под потолком, лента ломаной, — и в ней не
// должно измениться ни грани, ни источника света.

/** Комната 6 × 4 без блоков: у каждой метки своя точка и своя группа — ничья. */
function blockFreeStand() {
  const added = addScheme(createProject(), { name: "1 этаж", imageId: "plan-1", width: 1200, height: 800 });
  let project = setPlanScale(added.project, added.scheme.id, { a: { x: 0.1, y: 0.5 }, b: { x: 0.6, y: 0.5 }, meters: 6 }).project;
  const schemeId = added.scheme.id;
  project = setPlanOrigin(project, schemeId, { at: { x: 0.5, y: 0.5 }, turn: 0 }).project;
  project = setSchemeWallHeight(project, schemeId, 2700).project;
  const corners = [
    { x: -3000, y: -2000 },
    { x: 3000, y: -2000 },
    { x: 3000, y: 2000 },
    { x: -3000, y: 2000 },
  ];
  corners.forEach((point, index) => {
    project = addWall(project, { schemeId, aMm: point, bMm: corners[(index + 1) % 4], thicknessMm: 200 }).project;
  });
  const made = addRoom(project, "Гостиная");
  project = made.project;
  const fr = (point) => planMmToFraction(project, schemeId, point);
  project = addOutline(project, {
    schemeId,
    roomId: made.room.id,
    points: [
      { x: -2900, y: -1900 },
      { x: 2900, y: -1900 },
      { x: 2900, y: 1900 },
      { x: -2900, y: 1900 },
    ].map(fr),
  }).project;
  const typeId = (code) => project.markTypes.find((item) => item.code === code).id;
  const put = (code, points, kind = "point") => {
    const one = addMark(project, { schemeId, typeId: typeId(code), kind, points: points.map(fr) });
    project = applyMarkWalls(one.project, schemeId).project;
    return (one.mark || one.marks[0]).id;
  };
  const socket = put("Р", [{ x: -1000, y: -1890 }]);
  const spot = put("Т", [{ x: 0, y: 0 }]);
  const chandelier = put("ЛЮ", [{ x: 1200, y: 600 }]);
  const tape = put("Л", [
    { x: -2000, y: 1000 },
    { x: 1000, y: 1000 },
  ]);
  project = updateMark(project, socket, { heightAboveFloor: 300 }).project;
  return { project, schemeId, marks: { socket, spot, chandelier, tape } };
}

test("G68: объект без блоков собирается грань в грань прежним", () => {
  const round = (value) => Math.round(Number(value) * 1000) / 1000;
  const box = blockFreeStand();
  const built = volumeScene(box.project, box.schemeId, {});
  const print = {};
  for (const [name, markId] of Object.entries(box.marks)) {
    print[name] = (built.marks || [])
      .filter((place) => place.markId === markId)
      .map((place) => ({
        mode: place.mode,
        heightMm: round(place.heightMm),
        anchor: [round(place.anchor.x), round(place.anchor.y), round(place.anchor.z)],
        frame: place.frame
          ? [
              round(place.frame.at.x),
              round(place.frame.at.y),
              round(place.frame.bottomMm),
              round(place.frame.widthMm),
              round(place.frame.depthMm),
              round(place.frame.heightMm),
            ]
          : null,
        faces: volumeMarkFaces(place, []).map((face) => ({
          rgb: face.rgb,
          lit: face.lit === true,
          p: face.p.map((point) => [round(point.x), round(point.y), round(point.z)]),
        })),
        lamps: volumeLampSources(place, built, null).map((source) => ({
          at: [round(source.at.x), round(source.at.y), round(source.at.z)],
          power: round(source.power),
          beam: round(source.beam),
          room: source.room || null,
        })),
      }));
  }
  assert.deepEqual(print, BEFORE, "кадр объекта без блоков разошёлся с отпечатком прежнего кода");
  // И тело у каждой метки одно: ни у одной из них нет второй нарисованной точки
  // (у ленты их две, но она — ломаная, и её рисует весь её путь).
  for (const name of Object.keys(box.marks)) assert.equal(print[name].length, 1, name + ": тел не одно");
});
