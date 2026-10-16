// Объёмный режим: комната, по которой можно пройти (таск 146, требование G205).
//
// Что здесь проверяется в первую очередь — не красота, а три вещи, которые
// тихо врут, если за ними не следить:
//
//   1. **G68.** Режим только читает. Сцена собирается из объекта, и объект от
//      этого не меняется ни одним полем — ни новый, ни прежний.
//   2. **Что держит, а что нет.** Стены держат, дверные полотна нет, окно
//      держит стеной под собой. Это слова заказчика, и ошибка здесь
//      обнаруживается не глазом, а тем, что человек проходит сквозь стену.
//   3. **Порядок граней.** Пол и потолок ложатся до всего остального, дальнее
//      раньше ближнего. Разойдись это — пол комнаты закрасит дальнюю стену, и
//      кадр будет похож на поломку рисовальщика, а не на правило.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  addOpening,
  addOutline,
  addRoom,
  addScheme,
  addSchemeObject,
  addWall,
  createProject,
  ensureSchemeObjectKinds,
  planMmToFraction,
  schemeObjectKindsInOrder,
  setPlanOrigin,
  setPlanScale,
  setRoomWallHeight,
  setSchemeWallHeight,
} from "../src/model.js";
import {
  VOLUME_BODY_MM,
  VOLUME_EYE_MM,
  VOLUME_HEIGHT_FALLBACK_MM,
  VOLUME_NEAR_MM,
  volumeArea,
  volumeAroundCamera,
  volumeAroundFit,
  volumeClipNear,
  volumeFill,
  volumeFocal,
  volumeFrame,
  volumeFreeMm,
  volumeHeightMm,
  volumeHorizon,
  volumeMarkerFaces,
  volumeObjectFaces,
  volumeOpeningWalkable,
  volumePointInside,
  volumeRoomAt,
  volumeScene,
  volumeShade,
  volumeStart,
  volumeStep,
  volumeWallSolids,
  volumeWallTiles,
} from "../src/volume.js";
import { volumeClampPitch, volumeKeyMove, volumeNotes, volumeWhere } from "../src/panels/volume.js";

const HERE = dirname(fileURLToPath(import.meta.url));

// План 1200 × 800 точек, сто точек на метр, нуль чертежа в середине — тот же
// стенд, что у развёртки (таск 129): две системы координат должны быть
// настоящими, иначе мост в миллиметры не работает.
function planProject() {
  const added = addScheme(createProject(), { name: "1 этаж", imageId: "plan-1", width: 1200, height: 800 });
  let project = setPlanScale(added.project, added.scheme.id, {
    a: { x: 0.1, y: 0.5 },
    b: { x: 0.6, y: 0.5 },
    meters: 6,
  }).project;
  project = setPlanOrigin(project, added.scheme.id, { at: { x: 0.5, y: 0.5 }, turn: 0 }).project;
  project = setSchemeWallHeight(project, added.scheme.id, 2700).project;
  return { project, schemeId: added.scheme.id };
}

const fraction = (project, schemeId, mm) => planMmToFraction(project, schemeId, mm);

/**
 * Комната 4 × 3 м из четырёх стен по часовой, с контуром по внутренним граням.
 * Стены идут кольцом, концы совпадают точно — то есть это настоящая цепочка
 * (ADR 008), а не четыре отрезка рядом.
 */
function roomScene(options = {}) {
  const base = planProject();
  let project = base.project;
  const half = { x: 2000, y: 1500 };
  const corners = [
    { x: -half.x, y: -half.y },
    { x: half.x, y: -half.y },
    { x: half.x, y: half.y },
    { x: -half.x, y: half.y },
  ];
  const walls = [];
  for (let index = 0; index < corners.length; index += 1) {
    const added = addWall(project, {
      schemeId: base.schemeId,
      aMm: corners[index],
      bMm: corners[(index + 1) % corners.length],
      thicknessMm: 200,
    });
    project = added.project;
    walls.push(added.wall.id);
  }
  if (options.room !== false) {
    const room = addRoom(project, options.roomName || "Кухня");
    project = room.project;
    const inner = [
      { x: -half.x + 100, y: -half.y + 100 },
      { x: half.x - 100, y: -half.y + 100 },
      { x: half.x - 100, y: half.y - 100 },
      { x: -half.x + 100, y: half.y - 100 },
    ];
    project = addOutline(project, {
      schemeId: base.schemeId,
      roomId: room.room.id,
      points: inner.map((point) => fraction(project, base.schemeId, point)),
    }).project;
    if (options.roomHeightMm) project = setRoomWallHeight(project, room.room.id, options.roomHeightMm).project;
    return { project, schemeId: base.schemeId, walls, roomId: room.room.id };
  }
  return { project, schemeId: base.schemeId, walls, roomId: null };
}

// ——— G68: режим только читает —————————————————————————————————————————

test("сборка сцены не меняет объект ни одним полем", () => {
  const scene = roomScene();
  const before = JSON.stringify(scene.project);
  const built = volumeScene(scene.project, scene.schemeId);
  assert.equal(built.empty, false);
  assert.ok(built.faces.length > 0);
  assert.equal(JSON.stringify(scene.project), before, "объект изменился — это запрещено прямо (G68)");
});

test("объект прежней сборки открывается и не меняется", () => {
  const legacy = JSON.parse(readFileSync(join(HERE, "legacy-project.json"), "utf8"));
  const before = JSON.stringify(legacy);
  for (const scheme of legacy.schemes) {
    const built = volumeScene(legacy, scheme.id);
    assert.equal(built.empty, true, "у объекта без чертежа показывать нечего — и он так и говорит");
    assert.deepEqual(built.faces, []);
  }
  assert.equal(JSON.stringify(legacy), before);
});

test("схема без чертежа отвечает empty, а не пустой сценой без объяснения", () => {
  const added = addScheme(createProject(), { name: "План", imageId: "plan", width: 100, height: 100 });
  const built = volumeScene(added.project, added.scheme.id);
  assert.equal(built.empty, true);
  assert.deepEqual(built.notes, []);
  assert.equal(volumeScene(added.project, "нет такой схемы"), null);
});

// ——— полноценная комната: стены, пол, потолок —————————————————————————

test("у комнаты есть пол, потолок и стены с толщиной", () => {
  const scene = roomScene();
  const built = volumeScene(scene.project, scene.schemeId);
  const ground = built.faces.filter((face) => face.ground);
  assert.equal(ground.length, 2, "пол и потолок — по одному на обведённое помещение");
  const floor = ground.find((face) => face.n.z > 0);
  const ceiling = ground.find((face) => face.n.z < 0);
  assert.ok(floor && ceiling, "у пола нормаль вверх, у потолка вниз");
  assert.ok(floor.p.every((point) => point.z === 0), "пол лежит на нуле");
  assert.ok(ceiling.p.every((point) => point.z === 2700), "потолок — на высоте схемы");
  // Толщина стены видна по торцам: у стены без проёмов пять граней — две
  // стороны, два торца и верх. Низ не рисуется: он под полом.
  assert.equal(built.faces.filter((face) => !face.ground).length, 4 * 5);
});

test("переопределение высоты комнаты доходит до объёма", () => {
  const scene = roomScene({ roomHeightMm: 3100 });
  const built = volumeScene(scene.project, scene.schemeId);
  const ceiling = built.faces.find((face) => face.ground && face.n.z < 0);
  assert.equal(ceiling.p[0].z, 3100, "потолок встал по высоте комнаты");
  // Стена рисуется до верхнего из двух своих потолков: снаружи 2700, внутри
  // 3100 — иначе у более высокой комнаты осталась бы щель над стеной.
  const wallTop = Math.max(...built.faces.filter((face) => !face.ground).flatMap((face) => face.p.map((point) => point.z)));
  assert.equal(wallTop, 3100);
});

test("высоты нет вовсе — рисуется умолчание, и об этом сказано вслух", () => {
  const scene = roomScene();
  // Снимаем высоту схемы: пустое значение убирает поле.
  const project = setSchemeWallHeight(scene.project, scene.schemeId, "").project;
  const built = volumeScene(project, scene.schemeId);
  assert.deepEqual(built.notes, ["noHeight"]);
  const ceiling = built.faces.find((face) => face.ground && face.n.z < 0);
  assert.equal(ceiling.p[0].z, VOLUME_HEIGHT_FALLBACK_MM);
  assert.ok(volumeNotes(built)[0].includes(String(VOLUME_HEIGHT_FALLBACK_MM)), "число названо в строке");
});

test("помещения не обведены — пол плитой под чертежом, потолка нет", () => {
  const scene = roomScene({ room: false });
  const built = volumeScene(scene.project, scene.schemeId);
  assert.deepEqual(built.notes, ["noRooms"]);
  const ground = built.faces.filter((face) => face.ground);
  assert.equal(ground.length, 1, "одна плита пола");
  assert.ok(ground[0].n.z > 0, "и она смотрит вверх");
  assert.ok(volumeArea(ground[0].p) > volumeArea([{ x: -2000, y: -1500 }, { x: 2000, y: -1500 }, { x: 2000, y: 1500 }, { x: -2000, y: 1500 }]));
});

test("контуры есть, а моста к плану нет — помещения не считаются, и это названо", () => {
  const scene = roomScene();
  // Привязка снимается заменой подложки; здесь проще — чертим без привязки.
  const project = { ...scene.project, schemes: scene.project.schemes.map((item) => {
    const { origin, ...rest } = item;
    return rest;
  }) };
  const built = volumeScene(project, scene.schemeId);
  assert.deepEqual(built.notes, ["noBridge"]);
  assert.equal(built.rooms.length, 0);
  assert.equal(built.faces.filter((face) => face.ground).length, 1, "плита на месте — пола не лишаемся");
});

// ——— проёмы: что видно и что держит ———————————————————————————————————

test("разбивка грани стены вокруг проёма: промежутки, под и над", () => {
  // Окно посреди стены: слева, справа, под ним и над ним.
  const window = [{ atMm: 1000, widthMm: 1400, heightMm: 1400, heightAboveFloorMm: 800 }];
  const tiles = volumeWallTiles(4000, 2700, window);
  assert.equal(tiles.length, 4);
  assert.deepEqual(tiles.map((tile) => [tile.fromMm, tile.toMm, tile.bottomMm, tile.topMm]), [
    [0, 1000, 0, 2700],
    [1000, 2400, 0, 800],
    [1000, 2400, 2200, 2700],
    [2400, 4000, 0, 2700],
  ]);
});

test("дверь от пола не даёт куска под собой, проём до потолка — над собой", () => {
  const door = volumeWallTiles(4000, 2100, [{ atMm: 1000, widthMm: 900, heightMm: 2100, heightAboveFloorMm: 0 }]);
  assert.deepEqual(
    door.map((tile) => [tile.fromMm, tile.toMm]),
    [
      [0, 1000],
      [1900, 4000],
    ],
    "дверь во всю высоту оставляет только промежутки по бокам",
  );
});

test("сквозь дверь проходят, сквозь окно — нет", () => {
  assert.equal(volumeOpeningWalkable({ kind: "door", heightAboveFloorMm: 0 }), true);
  assert.equal(volumeOpeningWalkable({ kind: "arch", heightAboveFloorMm: 0 }), true);
  assert.equal(volumeOpeningWalkable({ kind: "opening", heightAboveFloorMm: 100 }), true);
  // Окно застеклено, и панорамное до пола держит так же, как стена под обычным.
  assert.equal(volumeOpeningWalkable({ kind: "window", heightAboveFloorMm: 0 }), false);
  // Проём, у которого низ выше порога: под ним стена, и через неё не шагнуть.
  assert.equal(volumeOpeningWalkable({ kind: "opening", heightAboveFloorMm: 900 }), false);
});

test("дверь оставляет дыру в препятствиях, окно не оставляет", () => {
  const wall = { aMm: { x: 0, y: 0 }, bMm: { x: 4000, y: 0 }, thicknessMm: 200 };
  const door = volumeWallSolids(wall, [{ kind: "door", atMm: 1000, widthMm: 900, heightMm: 2100, heightAboveFloorMm: 0 }]);
  assert.deepEqual(
    door.map((span) => [span.fromMm, span.toMm]),
    [
      [0, 1000],
      [1900, 4000],
    ],
  );
  const window = volumeWallSolids(wall, [{ kind: "window", atMm: 1000, widthMm: 1400, heightMm: 1400, heightAboveFloorMm: 800 }]);
  assert.deepEqual(window.map((span) => [span.fromMm, span.toMm]), [[0, 4000]], "под окном стена");
});

test("у двери есть полотно, и оно двустороннее; у окна — рама", () => {
  const scene = roomScene();
  let project = addOpening(scene.project, {
    wallId: scene.walls[0],
    kind: "door",
    atMm: 1500,
    widthMm: 900,
    heightMm: 2100,
    heightAboveFloorMm: 0,
    hinge: "start",
    swing: "left",
  }).project;
  project = addOpening(project, {
    wallId: scene.walls[1],
    kind: "window",
    atMm: 800,
    widthMm: 1400,
    heightMm: 1400,
    heightAboveFloorMm: 800,
  }).project;
  const built = volumeScene(project, scene.schemeId);
  const twoSided = built.faces.filter((face) => face.both);
  assert.equal(twoSided.length, 5, "одно полотно двери и четыре бруска рамы окна");
  // Полотно раскрыто: оно уходит от стены, а не лежит в её плоскости. Стена
  // идёт по y = −1500, значит полотно обязано отойти по y.
  const leaf = twoSided.find((face) => face.rgb[0] === 176);
  const spread = Math.max(...leaf.p.map((point) => Math.abs(point.y + 1500)));
  assert.ok(spread > 800, "полотно раскрыто на четверть оборота, а не закрывает проём: " + spread);
});

// ——— ходьба ———————————————————————————————————————————————————————————

test("сквозь стену не пройти: тело выталкивается и остаётся в комнате", () => {
  const scene = roomScene();
  const built = volumeScene(scene.project, scene.schemeId);
  let at = { x: 0, y: 0 };
  // Сто шагов по 200 мм прямо в стену: комната 4 × 3 м, то есть дойти до неё
  // хватит и десяти.
  for (let step = 0; step < 100; step += 1) at = volumeStep(built, at, 0, 200);
  assert.ok(at.y < 1500 - 200 / 2, "за внутреннюю грань стены не вышли: " + at.y);
  assert.ok(volumeFreeMm(built.solids, at.x, at.y) >= -1, "тело не внутри стены");
});

test("сквозь дверь проходят, и дальше по коридору", () => {
  const scene = roomScene();
  // Дверь в нижней стене комнаты (она идёт слева направо по y = −1500… нет:
  // кольцо по часовой, и вторая стена — правая, от (2000,−1500) к (2000,1500)).
  const project = addOpening(scene.project, {
    wallId: scene.walls[1],
    kind: "door",
    atMm: 1200,
    widthMm: 1200,
    heightMm: 2100,
    heightAboveFloorMm: 0,
    hinge: "start",
    swing: "left",
  }).project;
  const built = volumeScene(project, scene.schemeId);
  // Дверь стоит на отступе 1200…2400 от конца a = (2000, −1500), то есть по y
  // от −300 до 900. Идём сквозь неё наружу.
  let at = { x: 0, y: 300 };
  for (let step = 0; step < 100; step += 1) at = volumeStep(built, at, 200, 0);
  assert.ok(at.x > 2200, "вышли за стену сквозь проём: " + at.x);
});

test("начинают с самого просторного места самой большой комнаты", () => {
  const scene = roomScene();
  const built = volumeScene(scene.project, scene.schemeId);
  const start = volumeStart(built);
  assert.ok(volumePointInside(start, built.rooms[0].pointsMm), "встали внутри комнаты");
  assert.ok(volumeFreeMm(built.solids, start.x, start.y) > VOLUME_BODY_MM, "и не вплотную к стене");
  assert.ok(Number.isFinite(start.yaw));
});

test("узкое место не ломает кадр: тело не подпускает стену ближе ближней плоскости", () => {
  // Санузел 1,2 × 1,5 м — то самое место, где камера упирается носом в стену.
  const base = planProject();
  let project = base.project;
  const corners = [
    { x: -600, y: -750 },
    { x: 600, y: -750 },
    { x: 600, y: 750 },
    { x: -600, y: 750 },
  ];
  for (let index = 0; index < corners.length; index += 1) {
    project = addWall(project, {
      schemeId: base.schemeId,
      aMm: corners[index],
      bMm: corners[(index + 1) % corners.length],
      thicknessMm: 100,
    }).project;
  }
  const built = volumeScene(project, base.schemeId);
  let at = { x: 0, y: 0 };
  for (const [dx, dy] of [
    [0, 400],
    [400, 0],
    [0, -400],
    [-400, 0],
  ]) {
    for (let step = 0; step < 20; step += 1) at = volumeStep(built, at, dx, dy);
    const free = volumeFreeMm(built.solids, at.x, at.y);
    assert.ok(free > VOLUME_NEAR_MM, "грань стены не дошла до ближней плоскости: " + free);
  }
});

// ——— затенение ————————————————————————————————————————————————————————

test("пол темнее потолка, и это не вкус, а требование заказчика", () => {
  const floor = volumeShade({ x: 0, y: 0, z: 1 });
  const ceiling = volumeShade({ x: 0, y: 0, z: -1 });
  assert.ok(ceiling > floor, "потолок светлее пола: " + ceiling + " против " + floor);
});

test("четыре направления стены дают четыре разные светлоты", () => {
  const shades = [
    volumeShade({ x: 1, y: 0, z: 0 }),
    volumeShade({ x: -1, y: 0, z: 0 }),
    volumeShade({ x: 0, y: 1, z: 0 }),
    volumeShade({ x: 0, y: -1, z: 0 }),
  ];
  assert.equal(new Set(shades.map((value) => value.toFixed(4))).size, 4, "иначе угол комнаты пропадёт: " + shades);
  for (const shade of shades) assert.ok(shade > 0.3 && shade < 1.01, "светлота в пределах: " + shade);
});

test("цвет грани — материал, помноженный на светлоту, и в пределах байта", () => {
  assert.equal(volumeFill([200, 100, 50], 1), "rgb(200,100,50)");
  assert.equal(volumeFill([200, 100, 50], 0.5), "rgb(100,50,25)");
  assert.equal(volumeFill([255, 255, 255], 2), "rgb(255,255,255)", "выше 255 не уходим");
});

// ——— камера и кадр ————————————————————————————————————————————————————

test("грань, пересекающая плоскость камеры, отсекается, а не выворачивается", () => {
  const points = [
    { x: -100, y: -100, z: 1000 },
    { x: 100, y: -100, z: -1000 },
    { x: 100, y: 100, z: -1000 },
    { x: -100, y: 100, z: 1000 },
  ];
  const clipped = volumeClipNear(points);
  assert.ok(clipped.length >= 3);
  assert.ok(
    clipped.every((point) => point.z >= VOLUME_NEAR_MM - 1e-9),
    "за ближней плоскостью не осталось ни одной вершины",
  );
  // Грань целиком за спиной исчезает совсем.
  assert.equal(volumeClipNear(points.map((point) => ({ ...point, z: -500 }))).length, 0);
});

test("в кадре пол и потолок лежат раньше стен, а дальнее раньше ближнего", () => {
  const scene = roomScene();
  const built = volumeScene(scene.project, scene.schemeId);
  const box = { width: 1200, height: 700 };
  // Из угла наискосок и чуть вниз: так в кадр попадают и пол, и потолок, и
  // сразу две стены — то есть есть что сортировать.
  const frame = volumeFrame(
    built,
    { at: { x: -1500, y: -1000, z: VOLUME_EYE_MM }, yaw: Math.atan2(1000, 1500), pitch: -0.2 },
    box,
  );
  assert.ok(frame.length > 3, "внутри комнаты видно не меньше пола, потолка и двух стен: " + frame.length);
  assert.ok(frame.some((polygon) => polygon.ground), "пол и потолок в кадре");
  const firstBody = frame.findIndex((polygon) => !polygon.ground);
  assert.ok(
    frame.slice(0, firstBody).every((polygon) => polygon.ground),
    "пол и потолок стоят в начале списка",
  );
  for (const part of [frame.slice(0, firstBody), frame.slice(firstBody)]) {
    for (let index = 1; index < part.length; index += 1) {
      assert.ok(part[index - 1].depth >= part[index].depth - 1e-9, "порядок по дальности сбился");
    }
  }
});

test("отвёрнутые грани в кадр не попадают: изнутри комнаты видно её, а не коробку снаружи", () => {
  const scene = roomScene();
  const built = volumeScene(scene.project, scene.schemeId);
  const box = { width: 1200, height: 700 };
  // Стоим в середине и смотрим в нижнюю стену (она по y = −1500, то есть
  // рысканье −90°).
  const camera = { at: { x: 0, y: 0, z: VOLUME_EYE_MM }, yaw: -Math.PI / 2, pitch: 0 };
  const frame = volumeFrame(built, camera, box);
  const all = volumeFrame({ faces: built.faces.map((face) => ({ ...face, both: true })) }, camera, box);
  assert.ok(frame.length < all.length, "без отсева граней было бы больше — значит отсев работает");
});

test("через дверь видна соседняя комната, а не заглушка", () => {
  // Две комнаты рядом, общая стена с дверью. Заказчик: «Давай всю схему».
  const base = planProject();
  let project = base.project;
  const rect = (x0, x1, y0, y1) => [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ];
  const ids = [];
  for (const corners of [rect(-4000, 0, -1500, 1500), rect(0, 4000, -1500, 1500)]) {
    for (let index = 0; index < corners.length; index += 1) {
      const added = addWall(project, {
        schemeId: base.schemeId,
        aMm: corners[index],
        bMm: corners[(index + 1) % corners.length],
        thicknessMm: 200,
      });
      project = added.project;
      ids.push(added.wall.id);
    }
  }
  // Дверь в общей стене (вторая стена первой комнаты: от (0,−1500) к (0,1500)).
  project = addOpening(project, {
    wallId: ids[1],
    kind: "door",
    atMm: 1100,
    widthMm: 900,
    heightMm: 2100,
    heightAboveFloorMm: 0,
    hinge: "start",
    swing: "left",
  }).project;
  const built = volumeScene(project, base.schemeId);
  const box = { width: 1200, height: 700 };
  // Стоим в левой комнате и смотрим на дверь.
  const camera = { at: { x: -2000, y: -300, z: VOLUME_EYE_MM }, yaw: 0, pitch: 0 };
  const frame = volumeFrame(built, camera, box);
  // Дальняя стена правой комнаты стоит по x = 4000: её грань должна попасть в
  // кадр. Считаем по дальности — дальше, чем общая стена на x = 0.
  const far = frame.filter((polygon) => polygon.depth > 5000);
  assert.ok(far.length > 0, "за дверью должна быть видна настоящая соседняя комната");
});

test("задник держится горизонта и ничего не берёт у перспективы", () => {
  const box = { width: 1200, height: 700 };
  const level = volumeHorizon({ yaw: 0, pitch: 0 }, box);
  assert.equal(level, box.height / 2, "на ровном взгляде горизонт посередине");
  // Рысканье горизонта не трогает — это и значит «в перспективе не участвует».
  for (const yaw of [0, 1, 2, 3]) {
    assert.equal(volumeHorizon({ yaw, pitch: 0.3 }, box), volumeHorizon({ yaw: 0, pitch: 0.3 }, box));
  }
  // Опустили взгляд — горизонт поднялся, и поле ушло вниз.
  assert.ok(volumeHorizon({ yaw: 0, pitch: -0.5 }, box) < level);
  assert.ok(volumeHorizon({ yaw: 0, pitch: 0.5 }, box) > level);
});

test("обзор вписывает всю схему и смотрит на неё сверху", () => {
  const scene = roomScene();
  const built = volumeScene(scene.project, scene.schemeId);
  const box = { width: 1200, height: 700 };
  const fitted = volumeAroundFit(built, box);
  assert.ok(fitted.distance > 4000, "отошли хотя бы на длину комнаты: " + fitted.distance);
  const camera = volumeAroundCamera(fitted.target, 0.5, -0.7, fitted.distance);
  assert.ok(camera.at.z > fitted.target.z, "обзор стоит выше цели");
  const frame = volumeFrame(built, camera, box);
  // Весь габарит обязан уместиться в поле — иначе «вся схема» это неправда.
  const xs = frame.flatMap((polygon) => polygon.xy.filter((value, index) => index % 2 === 0));
  const ys = frame.flatMap((polygon) => polygon.xy.filter((value, index) => index % 2 === 1));
  assert.ok(Math.min(...xs) > -1 && Math.max(...xs) < box.width + 1, "по ширине уместилось");
  assert.ok(Math.min(...ys) > -1 && Math.max(...ys) < box.height + 1, "по высоте уместилось");
  assert.ok(volumeFocal(box) > 0);
});

test("кружок «вы здесь» идёт в общем потоке граней, а не в полу", () => {
  const marker = volumeMarkerFaces({ x: 100, y: 200 }, 0);
  assert.equal(marker.length, 2, "кружок и треугольник взгляда");
  for (const face of marker) {
    assert.equal(face.ground, false, "лежи он в полу — пол ближней комнаты закрасил бы его");
    assert.ok(face.n.z > 0, "смотрит вверх");
  }
  const scene = roomScene();
  const built = volumeScene(scene.project, scene.schemeId);
  const box = { width: 1200, height: 700 };
  const camera = volumeAroundCamera({ x: 0, y: 0, z: 1200 }, 0.5, -0.8, 9000);
  assert.equal(volumeFrame(built, camera, box, marker).length, volumeFrame(built, camera, box).length + 2);
});

// ——— объекты пола —————————————————————————————————————————————————————

test("объект пола становится призмой, а колонна без высоты — во всю высоту комнаты", () => {
  const scene = roomScene({ roomHeightMm: 3100 });
  const kinds = ensureSchemeObjectKinds(scene.project);
  let project = kinds.project;
  const column = schemeObjectKindsInOrder(project).find((kind) => kind.name === "Колонна");
  const counter = schemeObjectKindsInOrder(project).find((kind) => kind.name.startsWith("Столешница"));
  project = addSchemeObject(project, {
    schemeId: scene.schemeId,
    kindId: counter.id,
    shape: "rect",
    atMm: { x: -1000, y: 0 },
    widthMm: 1800,
    depthMm: 600,
    heightMm: 900,
    heightAboveFloorMm: 0,
  }).project;
  project = addSchemeObject(project, {
    schemeId: scene.schemeId,
    kindId: column.id,
    shape: "rect",
    atMm: { x: 1000, y: 0 },
    widthMm: 400,
    depthMm: 400,
    heightAboveFloorMm: 0,
  }).project;
  const built = volumeScene(project, scene.schemeId);
  const object = built.faces.filter((face) => face.rgb[0] === 150);
  // Две призмы по пять граней: четыре боковины и верх, низ лежит на полу.
  assert.equal(object.length, 10);
  const top = Math.max(...object.flatMap((face) => face.p.map((point) => point.z)));
  assert.equal(top, 3100, "колонна встала во всю высоту комнаты, а не в выдуманную");
});

test("висящий над полом объект получает и низ", () => {
  const scene = roomScene();
  const kinds = ensureSchemeObjectKinds(scene.project);
  const kind = schemeObjectKindsInOrder(kinds.project)[0];
  const faces = volumeObjectFaces(
    kinds.project,
    scene.schemeId,
    { shape: "rect", kindId: kind.id, atMm: { x: 0, y: 0 }, widthMm: 600, depthMm: 400, turnDeg: 0, heightMm: 500, heightAboveFloorMm: 1500 },
    2700,
  );
  assert.equal(faces.length, 6, "четыре боковины, верх и низ");
  assert.ok(faces.some((face) => face.n.z < 0), "низ есть и смотрит вниз");
});

test("ломаная становится цепочкой призм по звеньям", () => {
  const scene = roomScene();
  const kinds = ensureSchemeObjectKinds(scene.project);
  const kind = schemeObjectKindsInOrder(kinds.project)[0];
  const faces = volumeObjectFaces(
    kinds.project,
    scene.schemeId,
    {
      shape: "polyline",
      kindId: kind.id,
      pointsMm: [
        { x: -1000, y: 0 },
        { x: 0, y: 0 },
        { x: 0, y: 1000 },
      ],
      depthMm: 600,
      heightMm: 900,
      heightAboveFloorMm: 0,
    },
    2700,
  );
  assert.equal(faces.length, 10, "два звена по пять граней");
});

// ——— мелочи, которые некому проверить, кроме теста ————————————————————

test("высота читается через одну дверь, и неизвестная приходит с признаком", () => {
  const scene = roomScene({ roomHeightMm: 3100 });
  assert.deepEqual(volumeHeightMm(scene.project, scene.schemeId, scene.roomId), { mm: 3100, known: true });
  assert.deepEqual(volumeHeightMm(scene.project, scene.schemeId, null), { mm: 2700, known: true });
  const bare = createProject();
  assert.deepEqual(volumeHeightMm(bare, "нет", null), { mm: VOLUME_HEIGHT_FALLBACK_MM, known: false });
});

test("имя помещения называется вслух, а вне помещений об этом говорится прямо", () => {
  const scene = roomScene({ roomName: "Спальня" });
  const built = volumeScene(scene.project, scene.schemeId);
  assert.ok(volumeWhere(scene.project, built, { x: 0, y: 0 }).includes("Спальня"));
  assert.equal(volumeWhere(scene.project, built, { x: 9000, y: 9000 }), "Вне помещений");
  assert.equal(volumeRoomAt(built, { x: 9000, y: 9000 }), null);
});

test("клавиши разложены по осям камеры, а стрелки влево-вправо вертят", () => {
  assert.deepEqual(volumeKeyMove("KeyW"), { forward: 1, side: 0, turn: 0 });
  assert.deepEqual(volumeKeyMove("ArrowUp"), { forward: 1, side: 0, turn: 0 });
  assert.deepEqual(volumeKeyMove("KeyA"), { forward: 0, side: -1, turn: 0 });
  assert.deepEqual(volumeKeyMove("ArrowLeft"), { forward: 0, side: 0, turn: -1 });
  assert.equal(volumeKeyMove("KeyZ"), null);
});

test("взгляд не заводится за отвес", () => {
  assert.ok(volumeClampPitch(10) < Math.PI / 2);
  assert.ok(volumeClampPitch(-10) > -Math.PI / 2);
  assert.equal(volumeClampPitch(0), 0);
});
