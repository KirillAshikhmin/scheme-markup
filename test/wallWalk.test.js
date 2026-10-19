// Переход к соседней стене в окне развёртки (таск 179, требование G267).
//
// Слова заказчика: «Добавь 2 поля с выпадающим списком, в каждом поле одна и
// другая сторона текущей стены, что бы можно было выбрать другую стену или её
// часть. В каждом списке только те стены, с которыми граничит значение второго
// списка».
//
// Здесь проверяется то, из-за чего переход может соврать молча:
//
//   - **соседство считается по чертежу**, а не по полю в объекте: передвинул
//     стену — список стал другим сам;
//   - **сторона у каждого списка своя**: перегородка, упирающаяся с одной
//     стороны, с другой не видна — она за стеной, и предложить её значило бы
//     увести человека сквозь стену;
//   - **соседка поворачивается той гранью, что в том же помещении**: стороны
//     называются от направления самой стены, а направления соседок между собой
//     никак не связаны, и без этого правила переход по углу комнаты выводил бы
//     на наружную грань;
//   - **T-образный стык ловится**: перегородка, уткнутая в середину стены,
//     угла ни с кем не делит, и список по углам до неё не доводит ниоткуда. На
//     объекте заказчика таких стен две из двадцати пяти.
import test from "node:test";
import assert from "node:assert/strict";

import {
  WALL_SIDES,
  addOutline,
  addRoom,
  addScheme,
  addWall,
  createProject,
  planMmToFraction,
  setPlanOrigin,
  setPlanScale,
  setSchemeWallHeight,
  wallNames,
  wallNeighbours,
} from "../src/model.js";
import { elevationWalk } from "../src/panels/elevation.js";

// План 1200 × 800 точек, сто точек на метр, нуль чертежа в середине: контуры
// живут в долях плана, и без калибровки их не разложить.
function planScene() {
  const added = addScheme(createProject(), { name: "1 этаж", imageId: "plan-1", width: 1200, height: 800 });
  let project = setPlanScale(added.project, added.scheme.id, {
    a: { x: 0.1, y: 0.5 },
    b: { x: 0.6, y: 0.5 },
    meters: 6,
  }).project;
  project = setPlanOrigin(project, added.scheme.id, { at: { x: 0.25, y: 0.25 }, turn: 0 }).project;
  project = setSchemeWallHeight(project, added.scheme.id, 2700).project;
  return { project, schemeId: added.scheme.id };
}

function withWalls(scene, segments, thicknessMm = 100) {
  let project = scene.project;
  const wallIds = [];
  for (const [aMm, bMm] of segments) {
    const added = addWall(project, { schemeId: scene.schemeId, aMm, bMm, thicknessMm });
    project = added.project;
    wallIds.push(added.wall.id);
  }
  return { ...scene, project, wallIds };
}

// Комната 4000 × 3000 от нуля, стены по часовой: АБ сверху, БВ справа, ВГ
// снизу, АГ слева. Нутро комнаты — вниз-вправо от нуля.
const ROOM = [
  [{ x: 0, y: 0 }, { x: 4000, y: 0 }],
  [{ x: 4000, y: 0 }, { x: 4000, y: 3000 }],
  [{ x: 4000, y: 3000 }, { x: 0, y: 3000 }],
  [{ x: 0, y: 3000 }, { x: 0, y: 0 }],
];

const nameOf = (scene, wallId) =>
  (wallNames(scene.project, scene.schemeId).find((named) => named.wallId === wallId) || {}).name;

const listOf = (scene, wallId, side) => wallNeighbours(scene.project, wallId, side).map((item) => item.name);

/**
 * С какой стороны стены лежит нутро комнаты — та, с которой видны соседи.
 *
 * Считается, а не вписывается числом: стороны называются от направления самой
 * стены, и «справа» у стены, нарисованной справа налево, уже снаружи. Тест,
 * который это угадывает, однажды начнёт проверять не то, что обещает.
 */
function insideSide(scene, wallId) {
  const found = WALL_SIDES.filter((side) => listOf(scene, wallId, side).length > 0);
  assert.equal(found.length, 1, "нутро комнаты должно быть ровно с одной стороны");
  return found[0];
}

const other = (side) => (side === "left" ? "right" : "left");

test("в списке стороны — те стены, с которыми эта граничит, и только они", () => {
  const scene = withWalls(planScene(), ROOM);
  assert.deepEqual(wallNames(scene.project, scene.schemeId).map((n) => n.name), ["АБ", "БВ", "ВГ", "АГ"]);
  // У каждой стены комнаты изнутри ровно два соседа — те, с которыми она делит
  // углы, — и ни одной чужой стены.
  for (const wallId of scene.wallIds) {
    const inside = insideSide(scene, wallId);
    const names = listOf(scene, wallId, inside);
    assert.equal(names.length, 2, nameOf(scene, wallId) + ": соседей не два — " + names.join(","));
    const mine = nameOf(scene, wallId);
    for (const name of names) {
      assert.notEqual(name, mine, "стена не сосед сама себе");
      // Сосед делит с нами букву угла — иначе он не сосед, а просто стена.
      assert.ok([...mine].some((letter) => name.includes(letter)), mine + " и " + name + " не делят угла");
    }
    // Снаружи угла комнаты сосед не перекрывает нашу грань, и список пуст:
    // честнее пустого списка здесь ничего нет.
    assert.deepEqual(listOf(scene, wallId, other(inside)), []);
  }
});

test("сторона у списка своя: уткнувшаяся снаружи перегородка внутри не предлагается", () => {
  // Перегородка, уткнутая в верхнюю стену **снаружи**, то есть вверх от неё.
  // Изнутри комнаты её не видно — она за стеной.
  const scene = withWalls(planScene(), [...ROOM, [{ x: 2000, y: 0 }, { x: 2000, y: -1500 }]]);
  const top = scene.wallIds[0];
  const spur = nameOf(scene, scene.wallIds[4]);
  // Нутро верхней стены — та сторона, где два угловых соседа.
  const inside = WALL_SIDES.find((side) => listOf(scene, top, side).length === 2);
  assert.ok(inside, "угловых соседей у верхней стены не нашлось");
  assert.ok(!listOf(scene, top, inside).includes(spur), "изнутри перегородки быть не должно");
  assert.deepEqual(listOf(scene, top, other(inside)), [spur], "снаружи она одна и есть");
});

test("T-образный стык: перегородка без общего угла в списке есть", () => {
  // Перегородка от середины верхней стены вниз, в комнату. Общего угла у неё
  // нет ни с кем: её конец лежит в середине чужой стены, а не в её конце.
  const scene = withWalls(planScene(), [...ROOM, [{ x: 2000, y: 0 }, { x: 2000, y: 1500 }]]);
  const top = scene.wallIds[0];
  const spur = scene.wallIds[4];
  const topName = nameOf(scene, top);
  const spurName = nameOf(scene, spur);
  assert.ok(spurName, "перегородка получила имя");
  assert.deepEqual(
    [...topName].filter((letter) => spurName.includes(letter)),
    [],
    `общей буквы быть не должно: ${topName} и ${spurName}`,
  );
  // А в списке внутренней стороны она есть, и на своём отступе по листу.
  const inside = wallNeighbours(scene.project, top, insideSide(scene, top));
  const found = inside.find((item) => item.wallId === spur);
  assert.ok(found, "перегородка не попала в список: " + inside.map((item) => item.name).join(","));
  assert.equal(found.atMm, 2000, "отступ по листу — середина верхней стены");
});

test("список идёт слева направо по листу, и отсчёт зеркалится вместе со стеной", () => {
  // Две перегородки в комнату, на 1000 и на 3000 от левого конца верхней
  // стены, и одна снаружи — чтобы зеркало проверялось на непустом списке.
  const scene = withWalls(planScene(), [
    ...ROOM,
    [{ x: 1000, y: 0 }, { x: 1000, y: 1200 }],
    [{ x: 3000, y: 0 }, { x: 3000, y: 1200 }],
    [{ x: 1000, y: 0 }, { x: 1000, y: -1200 }],
  ]);
  const top = scene.wallIds[0];
  const near = nameOf(scene, scene.wallIds[4]);
  // Нутро — та сторона, где стоит ближняя внутренняя перегородка: `insideSide`
  // здесь не годится, соседи есть с обеих сторон.
  const from = WALL_SIDES.find((side) => listOf(scene, top, side).includes(near));
  assert.ok(from, "внутренняя перегородка не нашлась ни на одной стороне");
  const inside = wallNeighbours(scene.project, top, from);
  const ladder = inside.map((item) => item.atMm);
  assert.deepEqual([...ladder].sort((a, b) => a - b), ladder, "порядок — по отступу на листе: " + ladder.join(","));
  const at = (list, name) => (list.find((item) => item.name === name) || {}).atMm;
  const far = nameOf(scene, scene.wallIds[5]);
  assert.equal(at(inside, near), 1000);
  assert.equal(at(inside, far), 3000);
  // С обратной стороны отсчёт зеркалится — как у проёмов и меток
  // (`wallElevation`): лист читается слева направо, и то, что лежало в 1000 от
  // одного угла, стоит в 3000 от другого.
  const outside = wallNeighbours(scene.project, top, other(from));
  const spur = nameOf(scene, scene.wallIds[6]);
  assert.equal(at(outside, spur), 3000, "зеркало: 1000 от одного угла — 3000 от другого");
});

test("соседка поворачивается той гранью, что в том же помещении", () => {
  const walls = withWalls(planScene(), ROOM);
  const room = addRoom(walls.project, "Кухня");
  const inFraction = (point) => planMmToFraction(room.project, walls.schemeId, point);
  const scene = {
    ...walls,
    project: addOutline(room.project, {
      schemeId: walls.schemeId,
      roomId: room.room.id,
      points: [
        inFraction({ x: 60, y: 60 }),
        inFraction({ x: 3940, y: 60 }),
        inFraction({ x: 3940, y: 2940 }),
        inFraction({ x: 60, y: 2940 }),
      ],
    }).project,
  };
  const [top, , , left] = scene.wallIds;
  const from = insideSide(scene, top);
  const toLeft = wallNeighbours(scene.project, top, from).find((item) => item.wallId === left);
  assert.ok(toLeft, "левая стена не попала в список внутренней стороны");
  // Главное: сторона перехода посчитана по комнате, а не переписана с нашей.
  // Проверяется тем, что с неё наша стена снова видна — то есть мы остались в
  // той же комнате, а не вышли за её грань.
  const back = wallNeighbours(scene.project, left, toLeft.side).map((item) => item.wallId);
  assert.ok(back.includes(top), "перешли на грань, с которой наша стена не видна");
  assert.equal(toLeft.side, insideSide(scene, left), "перешли на внутреннюю грань соседки");
});

test("без помещений сторона остаётся наша: выдумывать нечего", () => {
  // Контуров нет — спросить «в какой комнате эта грань» не у кого, и переход
  // оставляет ту сторону, с которой смотрели. Кнопки «Слева» и «Справа» на
  // месте: одно нажатие, а не молчаливая догадка.
  const scene = withWalls(planScene(), ROOM);
  for (const wallId of scene.wallIds) {
    for (const side of WALL_SIDES) {
      for (const item of wallNeighbours(scene.project, wallId, side)) assert.equal(item.side, side);
    }
  }
});

test("два поля: по одному на сторону, выбранной записью — сама стена", () => {
  const scene = withWalls(planScene(), ROOM);
  const walk = elevationWalk(scene.project, scene.wallIds[0]);
  assert.equal(walk.length, 2, "ровно два поля — одно и другое");
  assert.deepEqual(walk.map((field) => field.side), WALL_SIDES);
  assert.deepEqual(walk.map((field) => field.label), ["Слева", "Справа"]);
  for (const field of walk) {
    // Запись «эта стена» называет стену по имени: поле отвечает и на «где я».
    assert.ok(field.here.includes("АБ"), field.here);
    assert.ok(field.here.includes("эта стена"), field.here);
    // Записи перехода — имя и отступ по листу, и каждая знает, куда ведёт.
    for (const option of field.options) {
      assert.ok(option.wallId, "запись без стены");
      assert.ok(WALL_SIDES.includes(option.side), "запись без стороны");
      assert.match(option.text, /^[А-Я-]+ · \d+ мм$/u, option.text);
    }
  }
  // Поля разные: у одной стороны соседи есть, у другой нет, и ни одно поле не
  // повторяет чужой список.
  const counts = walk.map((field) => field.options.length);
  assert.deepEqual([...counts].sort(), [0, 2], "списки сторон разошлись: " + counts.join(","));
});

test("стены без соседей: поле пустое, и сказано об этом словом", () => {
  // Одинокая перегородка: концы ни с кем не сошлись, ни в кого не уткнулись.
  const scene = withWalls(planScene(), [[{ x: 500, y: 500 }, { x: 2500, y: 500 }]]);
  for (const field of elevationWalk(scene.project, scene.wallIds[0])) {
    assert.deepEqual(field.options, []);
    assert.ok(field.none.includes("соседних стен нет"), field.none);
  }
});

test("стены нет вовсе — списки пустые, и ничего не падает (G68)", () => {
  const scene = planScene();
  assert.deepEqual(wallNeighbours(scene.project, "нет такой", "left"), []);
  assert.deepEqual(wallNeighbours(scene.project, null, "left"), []);
  // Непонятная сторона читается как «слева», как во всей модели развёртки.
  const walls = withWalls(scene, ROOM);
  assert.deepEqual(
    wallNeighbours(walls.project, walls.wallIds[0], "чепуха").map((item) => item.name),
    wallNeighbours(walls.project, walls.wallIds[0], "left").map((item) => item.name),
  );
});
