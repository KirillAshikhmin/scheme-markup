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
import test from "node:test";
import assert from "node:assert/strict";

import {
  addMark,
  addOutline,
  addRoom,
  addScheme,
  addToGroup,
  addWall,
  createProject,
  planFractionToMm,
  planMmToFraction,
  setMarkWall,
  setPlanOrigin,
  setPlanScale,
  setSchemeWallHeight,
  updateMark,
  updateType,
} from "../src/model.js";
import { VOLUME_BLOCK_STEP_MM, volumeScene } from "../src/volume.js";

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

test("потолочное место в ряд не идёт: метка без высоты стоит там, где стояла", () => {
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
  const bodies = bodiesOf(scene, project, markId);
  assert.equal(bodies.length, 1, "потолочную метку разобрали на тела, хотя ряда у неё нет");
  assert.equal(bodies[0].place.mode, "ceiling", "потолочная метка перестала быть потолочной");
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
