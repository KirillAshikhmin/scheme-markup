// Участок развёртки задаётся парой углов (таск 197, требование G302).
//
// Слова заказчика: «там должны быть не стены слева справа, а углы. Вот на
// примере текущей схемы — выделил я Л-М стену, но хочу посмотреть участок
// стены, и вот в правом выпадающем списке выбираю Ю, отображается уже Л-Ю,
// потом хочу другую, и вместо Л выбираю К и смотрю другую стену кухни. И вот в
// выпадающих списках должны быть только связанные стеной углы».
//
// Здесь проверяется то, из-за чего участок может соврать молча:
//
//   - **«связаны стеной» значит «лежат на одной стене»** — концами или местом,
//     где в неё уткнулась чужая. Ни общего ребра, ни пути по стенам между Л и Ю
//     на объекте заказчика нет, а участок Л-Ю есть;
//   - **участок режет лист**: что за парой углов — уходит, что пара пересекла —
//     обрезается, и отступы считаются от левого угла участка;
//   - **стена целиком осталась прежней** (G68): выгрузки развёрток ходят тем же
//     путём, и сдвинься у них отсчёт — разъехались бы листы;
//   - **комната и высота у участка свои**: длинная стена идёт мимо нескольких
//     комнат, и её середина отвечает за всю длину неверно;
//   - **сторона при переходе**: первое слово за помещением (довод таска 179),
//     второе — за полем, в которое человек положил угол;
//   - **тупик**: стена, у которой других углов нет, говорит об этом словом.
import test from "node:test";
import assert from "node:assert/strict";

import {
  WALL_SIDES,
  addMark,
  addOpening,
  addOutline,
  addRoom,
  addScheme,
  addWall,
  applyMarkWalls,
  createProject,
  planMmToFraction,
  setPlanOrigin,
  setPlanScale,
  setRoomWallHeight,
  setSchemeWallHeight,
  wallCornerMoves,
  wallCornerSpan,
  wallCornersOn,
  wallElevation,
  wallNames,
} from "../src/model.js";
import { ELEVATION_EDGES, elevationCorners, elevationTitle } from "../src/panels/elevation.js";

// План 1200 × 800 точек, сто точек на метр, нуль чертежа в левой верхней
// четверти: контуры живут в долях плана, и без калибровки их не разложить.
function planScene() {
  const added = addScheme(createProject(), { name: "1 этаж", imageId: "plan-1", width: 1200, height: 800 });
  let project = setPlanScale(added.project, added.scheme.id, {
    a: { x: 0.1, y: 0.5 },
    b: { x: 0.6, y: 0.5 },
    meters: 6,
  }).project;
  project = setPlanOrigin(project, added.scheme.id, { at: { x: 0.25, y: 0.75 }, turn: 0 }).project;
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

/**
 * Чертёж той же породы, что у заказчика, — на нём и держится весь таск.
 *
 * Длинная стена (нарисованная справа налево, как ЛМ), уткнувшаяся в неё сверху
 * перегородка, не доехавшая до оси 24 мм (как Ю), уткнувшаяся в **эту**
 * перегородку третья стена в 5 мм от её оси (как К) и стена, делящая с длинной
 * её конец (обычный угол комнаты).
 */
const SCENE = [
  [{ x: 6000, y: 0 }, { x: 0, y: 0 }],
  [{ x: 2000, y: -24 }, { x: 2000, y: -3000 }],
  [{ x: 1995, y: -1500 }, { x: 500, y: -1500 }],
  [{ x: 0, y: 0 }, { x: 0, y: -3000 }],
];

const LONG = 0;
const CROSS = 1;

const nameOf = (scene, wallId) =>
  (wallNames(scene.project, scene.schemeId).find((named) => named.wallId === wallId) || {}).name;

// Буква угла по месту: буквы выдаёт обход чертежа, и вписывать их в тест руками
// значило бы проверять свою же догадку, а не сборку.
function letterAt(scene, wallId, alongMm, side = "left") {
  const found = wallCornersOn(scene.project, wallId, side).find(
    (corner) => Math.abs(corner.alongMm - alongMm) <= 30,
  );
  assert.ok(found, "угла в " + alongMm + " мм от конца `a` не нашлось");
  return found.letter;
}

function cornerScene() {
  const scene = withWalls(planScene(), SCENE);
  const long = scene.wallIds[LONG];
  const cross = scene.wallIds[CROSS];
  return {
    ...scene,
    long,
    cross,
    // Концы длинной стены и угол, которым в неё уткнулась перегородка.
    far: letterAt(scene, long, 0),
    near: letterAt(scene, long, 6000),
    cut: letterAt(scene, long, 4000),
    // На перегородке: её дальний конец и место, где в неё уткнулась третья.
    spur: letterAt(scene, cross, 1476),
    crossEnd: letterAt(scene, cross, 2976),
  };
}

// ——— что значит «связаны стеной» ——————————————————————————————————————

test("углы стены — её концы и места, где в неё уткнулись чужие стены", () => {
  const scene = cornerScene();
  // Длинная стена: два своих конца и один угол перегородки, не доехавшей 24 мм.
  assert.deepEqual(
    wallCornersOn(scene.project, scene.long, "left").map((corner) => [corner.letter, corner.atMm, corner.end]),
    [
      [scene.near, 0, true],
      [scene.cut, 2000, false],
      [scene.far, 6000, true],
    ],
  );
  // Отсчёт зеркалится вместе со стороной — как у проёмов и меток.
  assert.deepEqual(
    wallCornersOn(scene.project, scene.long, "right").map((corner) => [corner.letter, corner.atMm]),
    [
      [scene.far, 0],
      [scene.cut, 4000],
      [scene.near, 6000],
    ],
  );
  // На перегородке — её концы и угол третьей стены в 5 мм от оси.
  assert.deepEqual(
    wallCornersOn(scene.project, scene.cross, "right").map((corner) => [corner.letter, corner.atMm]),
    [
      [scene.cut, 0],
      [scene.spur, 1476],
      [scene.crossEnd, 2976],
    ],
  );
});

test("угол за концом стены её углом не считается", () => {
  // Две стены на одной линии, не касающиеся друг друга: концы второй лежат на
  // продолжении первой, но на ней самой их нет.
  const scene = withWalls(planScene(), [
    [{ x: 0, y: 0 }, { x: 2000, y: 0 }],
    [{ x: 3000, y: 0 }, { x: 5000, y: 0 }],
  ]);
  const letters = wallCornersOn(scene.project, scene.wallIds[0], "left").map((corner) => corner.letter);
  assert.equal(letters.length, 2, "у стены только её собственные концы: " + letters.join(","));
});

test("угол принадлежит стене, а не её грани: список сторон не делит", () => {
  // Перегородка уткнулась в длинную стену сверху, и с нижней стороны её торца
  // на листе не видно. Угол при этом на месте: резать по нему стену можно с
  // любой грани, и без этого пример заказчика ломался бы первым шагом — он
  // открыл стену стороной по умолчанию.
  const scene = cornerScene();
  for (const side of WALL_SIDES) {
    const letters = wallCornersOn(scene.project, scene.long, side).map((corner) => corner.letter);
    assert.ok(letters.includes(scene.cut), side + ": угол перегородки пропал из списка");
  }
  const seen = wallElevation(scene.project, scene.long, "left").crossings;
  assert.deepEqual(seen, [], "с этой стороны торца перегородки и не должно быть видно");
});

// ——— пример заказчика: Л-М → Л-Ю → К-Ю —————————————————————————————————

test("смена угла показывает участок между новой парой", () => {
  const scene = cornerScene();
  // Шаг первый: выделена стена целиком, поля — её концы.
  const whole = wallElevation(scene.project, scene.long, "left");
  assert.deepEqual([whole.fromLetter, whole.toLetter], [scene.near, scene.far]);
  assert.equal(whole.lengthMm, 6000);
  assert.equal(whole.partial, false);
  assert.equal(whole.sectionName, nameOf(scene, scene.long), "у целой стены имя участка — её имя");

  // Шаг второй: в правом поле выбран угол перегородки — показан участок от
  // прежнего левого угла до него.
  const right = elevationCorners(scene.project, whole).find((field) => field.edge === "to");
  const toCut = right.options.find((option) => option.letter === scene.cut);
  assert.ok(toCut, "угла перегородки нет в правом списке: " + right.options.map((o) => o.letter).join(","));
  assert.equal(toCut.wallId, scene.long, "это та же стена, другой её участок");
  assert.equal(toCut.side, "left", "участок той же стены показан той же гранью");
  const part = wallElevation(scene.project, toCut.wallId, toCut.side, toCut.cut);
  assert.deepEqual([part.fromLetter, part.toLetter], [scene.near, scene.cut]);
  assert.equal(part.lengthMm, 2000);
  assert.equal(part.partial, true);

  // Шаг третий: вместо левого угла выбран угол на перегородке — показана другая
  // стена, участком между новой парой.
  const left = elevationCorners(scene.project, part).find((field) => field.edge === "from");
  const toSpur = left.options.find((option) => option.letter === scene.spur);
  assert.ok(toSpur, "угла третьей стены нет в левом списке: " + left.options.map((o) => o.letter).join(","));
  assert.equal(toSpur.wallId, scene.cross, "пара углов привела на перегородку");
  const next = wallElevation(scene.project, toSpur.wallId, toSpur.side, toSpur.cut);
  assert.deepEqual([next.fromLetter, next.toLetter], [scene.spur, scene.cut]);
  // 1476, а не 1500: перегородка не доехала до оси длинной стены 24 мм, и
  // участок меряется по настоящему чертежу, а не по круглому числу.
  assert.equal(next.lengthMm, 1476, "участок перегородки от третьей стены до длинной");
});

test("в списке только углы, связанные стеной с углом противоположного поля", () => {
  const scene = cornerScene();
  const whole = wallElevation(scene.project, scene.long, "left");
  const fields = elevationCorners(scene.project, whole);
  assert.deepEqual(fields.map((field) => field.edge), ELEVATION_EDGES);
  // Левое поле считается от правого угла листа — это конец `a` длинной стены, и
  // лежит он только на ней. Связан он с обоими её углами, но угол, который в
  // этом поле уже стоит, не повторяется: он и есть первая запись «этот угол».
  const left = fields.find((field) => field.edge === "from");
  assert.deepEqual(left.options.map((option) => option.letter), [scene.cut]);
  // Правое поле считается от левого угла, а в нём сходятся длинная стена и
  // четвёртая: к углу перегородки добавился дальний конец четвёртой. И ничего
  // из чужого куска чертежа — третья стена связана с перегородкой, а не с нами.
  const right = fields.find((field) => field.edge === "to");
  assert.deepEqual(
    right.options.map((option) => option.letter).sort(),
    [scene.cut, letterAt(scene, scene.wallIds[3], 3000)].sort(),
  );
  assert.ok(!right.options.some((option) => option.letter === scene.spur), "чужой угол попал в список");
  assert.ok(!right.options.some((option) => option.letter === scene.crossEnd), "чужой угол попал в список");
  // Опорный угол сам себе не предлагается: участок нулевой длины не участок.
  for (const field of fields) {
    assert.ok(!field.options.some((option) => option.letter === field.letter), "угол предложен сам себе");
  }
});

test("имя участка — в порядке букв, как имя стены, и от стороны не зависит", () => {
  const scene = cornerScene();
  const cut = { fromLetter: scene.near, toLetter: scene.cut };
  const left = wallElevation(scene.project, scene.long, "left", cut);
  const right = wallElevation(scene.project, scene.long, "right", cut);
  assert.equal(left.sectionName, right.sectionName);
  // Лист при смене стороны переворачивается, и углы меняются полями вместе с
  // ним: это не перескок, на листе они ровно там, где написаны.
  assert.deepEqual([left.fromLetter, left.toLetter], [scene.near, scene.cut]);
  assert.deepEqual([right.fromLetter, right.toLetter], [scene.cut, scene.near]);
  assert.equal(left.lengthMm, right.lengthMm);
});

// ——— участок режет лист ————————————————————————————————————————————————

function fittedScene() {
  const scene = cornerScene();
  // Окно верхом на угле: по стене 3500…4500 от конца `a`, то есть прямо через
  // место, где в стену уткнулась перегородка.
  let project = addOpening(scene.project, {
    wallId: scene.long,
    kind: "window",
    atMm: 3500,
    widthMm: 1000,
    heightMm: 1400,
    heightAboveFloorMm: 800,
  }).project;
  const socket = project.markTypes.find((type) => type.code === "Р").id;
  const inside = addMark(project, {
    schemeId: scene.schemeId,
    typeId: socket,
    points: [planMmToFraction(project, scene.schemeId, { x: 1000, y: 100 })],
  });
  project = inside.project;
  const outside = addMark(project, {
    schemeId: scene.schemeId,
    typeId: socket,
    points: [planMmToFraction(project, scene.schemeId, { x: 4000, y: 100 })],
  });
  project = applyMarkWalls(outside.project).project;
  return { ...scene, project, insideId: inside.mark.id, outsideId: outside.mark.id };
}

test("за парой углов на листе ничего нет, а разрезанное обрезано по ней", () => {
  const scene = fittedScene();
  const whole = wallElevation(scene.project, scene.long, "left");
  assert.deepEqual(
    whole.openings.map((opening) => [opening.fromMm, opening.toMm]),
    [[1500, 2500]],
  );
  assert.deepEqual(whole.marks.map((mark) => mark.id).sort(), [scene.insideId, scene.outsideId].sort());

  const part = wallElevation(scene.project, scene.long, "left", {
    fromLetter: scene.near,
    toLetter: scene.cut,
  });
  // Окно пересекло правый край участка — на листе осталась его половина, и
  // отступы считаются от левого угла участка.
  assert.deepEqual(
    part.openings.map((opening) => [opening.fromMm, opening.toMm]),
    [[1500, 2000]],
  );
  // Метка за парой углов ушла с листа целиком, метка внутри осталась на месте.
  assert.deepEqual(part.marks.map((mark) => mark.id), [scene.insideId]);
  assert.equal(part.marks[0].fromMm, 1000);
});

test("торец угла, которым режут, виден на участке половиной", () => {
  const scene = cornerScene();
  const whole = wallElevation(scene.project, scene.long, "right");
  // Два торца: перегородка в середине и четвёртая стена у самого конца листа.
  assert.deepEqual(
    whole.crossings.map((cross) => [cross.fromMm, cross.toMm]),
    [
      [3950, 4050],
      [5950, 6000],
    ],
  );
  // Участок от угла перегородки до дальнего конца: сам угол стоит у левого края
  // листа, и половина его торца на листе остаётся — тем и видно, что здесь угол.
  const part = wallElevation(scene.project, scene.long, "right", {
    fromLetter: scene.cut,
    toLetter: scene.near,
  });
  assert.deepEqual(
    part.crossings.map((cross) => [cross.fromMm, cross.toMm]),
    [
      [0, 50],
      [1950, 2000],
    ],
  );
});

test("G68: стена целиком осталась той же, какой была", () => {
  const scene = fittedScene();
  for (const side of WALL_SIDES) {
    const bare = wallElevation(scene.project, scene.long, side);
    // Пара концов — это и есть вся стена, и лист у неё обязан быть тот же.
    const ends = wallElevation(scene.project, scene.long, side, {
      fromLetter: scene.near,
      toLetter: scene.far,
    });
    assert.deepEqual(ends, bare, side + ": пара концов дала не ту же стену");
    // Негодная пара — стену поправили, буквы поехали — читается как целая
    // стена: развёртка не обязана пропадать с экрана.
    assert.deepEqual(wallElevation(scene.project, scene.long, side, { fromLetter: "ЯЯ", toLetter: "ЯЮ" }), bare);
    assert.deepEqual(wallElevation(scene.project, scene.long, side, { fromLetter: scene.near }), bare);
  }
  const before = JSON.stringify(scene.project);
  wallCornerMoves(scene.project, {
    wallId: scene.long,
    side: "left",
    fromLetter: scene.near,
    toLetter: scene.far,
    edge: "to",
  });
  wallCornerSpan(scene.project, scene.long, "left", { fromLetter: scene.near, toLetter: scene.cut });
  assert.equal(JSON.stringify(scene.project), before, "объект изменился");
});

// ——— комната и высота у участка свои ——————————————————————————————————

function roomScene() {
  const scene = cornerScene();
  const kitchen = addRoom(scene.project, "Кухня");
  let project = kitchen.project;
  const atFraction = (point) => planMmToFraction(project, scene.schemeId, point);
  // Комната в углу: от четвёртой стены до перегородки, от третьей стены до
  // длинной. Накрывает **первые два метра** длинной стены, а не всю её.
  project = addOutline(project, {
    schemeId: scene.schemeId,
    roomId: kitchen.room.id,
    points: [
      atFraction({ x: 60, y: -1440 }),
      atFraction({ x: 1940, y: -1440 }),
      atFraction({ x: 1940, y: -60 }),
      atFraction({ x: 60, y: -60 }),
    ],
  }).project;
  project = setRoomWallHeight(project, kitchen.room.id, 3100).project;
  return { ...scene, project, roomId: kitchen.room.id };
}

test("у участка своя комната и своя высота: середина стены за всю длину не отвечает", () => {
  const scene = roomScene();
  // Вся стена: её середина (x = 3000) лежит вне контура, и комнаты у листа нет.
  const whole = wallElevation(scene.project, scene.long, "right");
  assert.equal(whole.roomName, "");
  assert.equal(whole.heightMm, 2700, "высота этажа");
  // Участок у кухни: середина участка (x = 1000) накрыта её контуром.
  const part = wallElevation(scene.project, scene.long, "right", {
    fromLetter: scene.near,
    toLetter: scene.cut,
  });
  assert.equal(part.roomId, scene.roomId);
  assert.equal(part.heightMm, 3100, "высота кухни");
  assert.ok(elevationTitle(part).includes("Кухня"), elevationTitle(part));
  assert.ok(elevationTitle(part).includes("участок"), elevationTitle(part));
});

test("при переходе на другую стену первое слово за помещением", () => {
  const scene = roomScene();
  // Смотрим на кухонную грань участка длинной стены: на листе слева угол
  // перегородки, справа конец стены.
  const part = wallElevation(scene.project, scene.long, "right", {
    fromLetter: scene.near,
    toLetter: scene.cut,
  });
  assert.deepEqual([part.fromLetter, part.toLetter], [scene.cut, scene.near]);
  assert.equal(part.roomId, scene.roomId);
  // Угол третьей стены ставим в **правое** поле. Грань, при которой он остался
  // бы у правого края листа, смотрит из кухни наружу — и помещение её
  // перебивает: наружная грань это соседняя квартира, а не другая стена кухни.
  const right = elevationCorners(scene.project, part).find((field) => field.edge === "to");
  const toSpur = right.options.find((option) => option.letter === scene.spur);
  assert.ok(toSpur, "угол третьей стены не предложен");
  assert.equal(toSpur.side, "left", "показана не кухонная грань перегородки");
  const next = wallElevation(scene.project, toSpur.wallId, toSpur.side, toSpur.cut);
  assert.equal(next.roomId, scene.roomId, "перешли из кухни наружу");
  // Поля при этом поменялись местами: выбранный угол на листе оказался слева,
  // и поле называет его там, где он нарисован.
  assert.deepEqual([next.fromLetter, next.toLetter], [scene.spur, scene.cut]);
});

test("помещение не ответило — выбранный угол остаётся у своего края листа", () => {
  // Контуров нет вовсе: спросить «в какой комнате эта грань» не у кого.
  const scene = cornerScene();
  // Левое поле: лист стороны «слева» читается от дальнего конца, и участок
  // идёт от конца стены до угла перегородки.
  const part = wallElevation(scene.project, scene.long, "left", {
    fromLetter: scene.near,
    toLetter: scene.cut,
  });
  const left = elevationCorners(scene.project, part).find((field) => field.edge === "from");
  const toSpur = left.options.find((option) => option.letter === scene.spur);
  assert.ok(toSpur, "угол третьей стены не предложен левому полю");
  const next = wallElevation(scene.project, toSpur.wallId, toSpur.side, toSpur.cut);
  assert.equal(next.fromLetter, scene.spur, "угол из левого поля встал не у левого края");
  // И наоборот: с обратной стороны тот же угол стоит в правом поле — и встаёт
  // у правого края.
  const mirror = wallElevation(scene.project, scene.long, "right", {
    fromLetter: scene.near,
    toLetter: scene.cut,
  });
  const right = elevationCorners(scene.project, mirror).find((field) => field.edge === "to");
  const other = right.options.find((option) => option.letter === scene.spur);
  assert.ok(other, "угол третьей стены не предложен правому полю");
  const mirrored = wallElevation(scene.project, other.wallId, other.side, other.cut);
  assert.equal(mirrored.toLetter, scene.spur, "угол из правого поля встал не у правого края");
});

// ——— тупики ————————————————————————————————————————————————————————————

test("стена без связанных углов: поля пустые, и сказано об этом словом", () => {
  // Одинокая перегородка: концы ни с кем не сошлись, ни в кого не уткнулись.
  const scene = withWalls(planScene(), [[{ x: 500, y: 500 }, { x: 2500, y: 500 }]]);
  const whole = wallElevation(scene.project, scene.wallIds[0], "left");
  for (const field of elevationCorners(scene.project, whole)) {
    assert.deepEqual(field.options, []);
    assert.ok(field.none.includes("участок один"), field.none);
    assert.ok(field.here.includes(field.letter), field.here);
    assert.ok(field.here.includes("этот угол"), field.here);
  }
});

test("участок из одного угла не бывает: пара сходится — лист остаётся стеной", () => {
  const scene = cornerScene();
  const same = wallElevation(scene.project, scene.long, "left", {
    fromLetter: scene.cut,
    toLetter: scene.cut,
  });
  assert.deepEqual(same, wallElevation(scene.project, scene.long, "left"));
  // Угол, попавший в ту же точку листа, в список не идёт: лист нулевой ширины
  // никому не нужен. Вторая перегородка в ту же точку с другой стороны.
  const doubled = withWalls(planScene(), [...SCENE, [{ x: 2000, y: 24 }, { x: 2000, y: 1500 }]]);
  const long = doubled.wallIds[LONG];
  const onLong = wallCornersOn(doubled.project, long, "left");
  const twins = onLong.filter((corner) => corner.atMm === 2000);
  assert.equal(twins.length, 2, "обе перегородки обязаны быть в списке углов");
  const moves = wallCornerMoves(doubled.project, {
    wallId: long,
    side: "left",
    fromLetter: twins[0].letter,
    toLetter: letterAt(doubled, long, 6000),
    edge: "to",
  });
  assert.ok(
    !moves.some((move) => move.letter === twins[1].letter),
    "угол в той же точке листа предложен участком нулевой длины",
  );
});

// ——— слова полей ———————————————————————————————————————————————————————

test("подпись пункта начинается с буквы угла", () => {
  const scene = cornerScene();
  const part = wallElevation(scene.project, scene.long, "left", {
    fromLetter: scene.near,
    toLetter: scene.cut,
  });
  const fields = elevationCorners(scene.project, part);
  assert.deepEqual(fields.map((field) => field.label), ["Левый угол", "Правый угол"]);
  for (const field of fields) {
    for (const option of field.options) {
      assert.ok(option.text.startsWith(option.letter + " ·"), option.text);
      // У своей стены в подписи длина участка, у чужой — ещё и её имя.
      assert.match(option.text, option.wallId === scene.long ? /участок \d+ мм$/u : /стена [А-Я-]+, \d+ мм$/u);
    }
  }
});

test("углы показанной стены идут первыми, слева направо по её листу", () => {
  const scene = cornerScene();
  const whole = wallElevation(scene.project, scene.long, "left");
  // Правое поле считается от левого угла листа, а в нём сходятся две стены:
  // в списке есть и свои углы, и чужой.
  const right = elevationCorners(scene.project, whole).find((field) => field.edge === "to");
  const mine = right.options.filter((option) => option.wallId === scene.long);
  const alien = right.options.filter((option) => option.wallId !== scene.long);
  assert.ok(mine.length > 0 && alien.length > 0, "в списке нужны углы и своей стены, и чужой");
  assert.deepEqual(
    right.options.slice(0, mine.length).map((option) => option.letter),
    mine.map((option) => option.letter),
    "чужой угол встал раньше своего",
  );
  const places = mine.map(
    (option) =>
      wallCornersOn(scene.project, scene.long, "left").find((corner) => corner.letter === option.letter).atMm,
  );
  assert.deepEqual([...places].sort((first, second) => first - second), places, "свои углы идут не по листу");
});

test("стены нет вовсе — списков нет, и ничего не падает (G68)", () => {
  const scene = planScene();
  assert.deepEqual(wallCornersOn(scene.project, "нет такой", "left"), []);
  assert.deepEqual(wallCornerSpan(scene.project, null, "left"), null);
  assert.deepEqual(wallCornerMoves(scene.project, { wallId: "нет такой", side: "left" }), []);
  assert.deepEqual(elevationCorners(scene.project, null), []);
  // Непонятная сторона читается как «слева», как во всей модели развёртки.
  const walls = withWalls(scene, SCENE);
  assert.deepEqual(
    wallCornersOn(walls.project, walls.wallIds[LONG], "чепуха"),
    wallCornersOn(walls.project, walls.wallIds[LONG], "left"),
  );
});
