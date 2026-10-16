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
  COMMENT_TYPE_ID,
  addMark,
  addOpening,
  addOutline,
  addRoom,
  addScheme,
  addSchemeObject,
  addType,
  addWall,
  applyMarkWalls,
  createProject,
  ensureSchemeObjectKinds,
  findMark,
  labelOf,
  markWall,
  markWallSide,
  planMmToFraction,
  schemeObjectKindsInOrder,
  setMarkDimensions,
  setPlanOrigin,
  setPlanScale,
  setRoomWallHeight,
  setSchemeWallHeight,
  styleOf,
} from "../src/model.js";
import { objectViewByName, objectViewNames } from "../src/objectViews/registry.js";
import {
  VOLUME_BODY_MM,
  VOLUME_EYE_MM,
  VOLUME_HEIGHT_FALLBACK_MM,
  VOLUME_LAYER_BASE,
  VOLUME_LAYER_BODY,
  VOLUME_LAYER_GROUND,
  VOLUME_LAYER_MARK,
  VOLUME_MARK_CEILING,
  VOLUME_MARK_LIFT_MM,
  VOLUME_MARK_NO_PLACE,
  VOLUME_MARK_NO_SIZE,
  VOLUME_MARK_ROOM,
  VOLUME_MARK_WALL,
  VOLUME_NEAR_MM,
  VOLUME_PITCH_MAX_DEG,
  VOLUME_SELECT_COLOR,
  volumeArea,
  volumeAroundCamera,
  volumeAroundFit,
  volumeAroundPitch,
  volumeClipNear,
  volumeFill,
  volumeFocal,
  volumeFrame,
  volumeFreeMm,
  volumeHeightMm,
  volumeHorizon,
  volumeLinkLines,
  volumeMarkerFaces,
  volumePickAt,
  volumeFacePoint,
  volumeSelectLines,
  volumeViewPolylines,
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
import {
  VOLUME_UNPLACED_SHOWN,
  volumeClampPitch,
  volumeKeyMove,
  volumeNotes,
  volumeUnplacedLine,
  volumeUnplacedTitle,
  volumeWhere,
} from "../src/panels/volume.js";

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
  const ground = built.faces.filter((face) => face.layer === VOLUME_LAYER_GROUND);
  assert.equal(ground.length, 2, "пол и потолок — по одному на обведённое помещение");
  const floor = ground.find((face) => face.n.z > 0);
  const ceiling = ground.find((face) => face.n.z < 0);
  assert.ok(floor && ceiling, "у пола нормаль вверх, у потолка вниз");
  assert.ok(floor.p.every((point) => point.z === 0), "пол лежит на нуле");
  assert.ok(ceiling.p.every((point) => point.z === 2700), "потолок — на высоте схемы");
  // Под ними — плита по габариту чертежа: она закрывает пороги дверей, где
  // пола нет ни у одной комнаты.
  assert.equal(built.faces.filter((face) => face.layer === VOLUME_LAYER_BASE).length, 1);
  // Толщина стены видна по торцам: у стены без проёмов два торца и верх, а
  // каждая её сторона нарезана **метровой сеткой** (таск 148): по куску стены
  // вещь и встаёт в очередь отрисовки. Низ не рисуется: он под полом.
  // Стены комнаты 4 × 3 м: у четырёхметровой по четыре куска на сторону, у
  // трёхметровой по три, плюс три грани торцов и верха у каждой.
  const body = built.faces.filter((face) => face.layer === VOLUME_LAYER_BODY);
  assert.equal(body.length, 2 * (4 * 2 + 3) + 2 * (3 * 2 + 3));
  assert.equal(body.filter((face) => face.host).length, 2 * 4 * 2 + 2 * 3 * 2, "куски сторон знают свой ключ");
});

test("окно считает стены и проёмы чертежа, а не препятствия", () => {
  const scene = roomScene();
  const project = addOpening(scene.project, {
    wallId: scene.walls[0],
    kind: "door",
    atMm: 1500,
    widthMm: 900,
    heightMm: 2100,
    heightAboveFloorMm: 0,
    hinge: "start",
    swing: "left",
  }).project;
  const built = volumeScene(project, scene.schemeId);
  assert.equal(built.wallCount, 4, "стен ровно столько, сколько нарисовано");
  assert.equal(built.openingCount, 1);
  // Препятствий больше: проём разрезал стену надвое.
  assert.equal(built.solids.length, 5);
});

test("переопределение высоты комнаты доходит до объёма", () => {
  const scene = roomScene({ roomHeightMm: 3100 });
  const built = volumeScene(scene.project, scene.schemeId);
  const ceiling = built.faces.find((face) => face.layer === VOLUME_LAYER_GROUND && face.n.z < 0);
  assert.equal(ceiling.p[0].z, 3100, "потолок встал по высоте комнаты");
  // Стена рисуется до верхнего из двух своих потолков: снаружи 2700, внутри
  // 3100 — иначе у более высокой комнаты осталась бы щель над стеной.
  const wallTop = Math.max(
    ...built.faces.filter((face) => face.layer === VOLUME_LAYER_BODY).flatMap((face) => face.p.map((point) => point.z)),
  );
  assert.equal(wallTop, 3100);
});

test("высоты нет вовсе — рисуется умолчание, и об этом сказано вслух", () => {
  const scene = roomScene();
  // Снимаем высоту схемы: пустое значение убирает поле.
  const project = setSchemeWallHeight(scene.project, scene.schemeId, "").project;
  const built = volumeScene(project, scene.schemeId);
  assert.deepEqual(built.notes, ["noHeight"]);
  const ceiling = built.faces.find((face) => face.layer === VOLUME_LAYER_GROUND && face.n.z < 0);
  assert.equal(ceiling.p[0].z, VOLUME_HEIGHT_FALLBACK_MM);
  assert.ok(volumeNotes(built)[0].includes(String(VOLUME_HEIGHT_FALLBACK_MM)), "число названо в строке");
});

test("помещения не обведены — пол плитой под чертежом, потолка нет", () => {
  const scene = roomScene({ room: false });
  const built = volumeScene(scene.project, scene.schemeId);
  assert.deepEqual(built.notes, ["noRooms"]);
  assert.equal(built.faces.filter((face) => face.layer === VOLUME_LAYER_GROUND).length, 0, "ни полов, ни потолков комнат");
  const plate = built.faces.filter((face) => face.layer === VOLUME_LAYER_BASE);
  assert.equal(plate.length, 1, "одна плита пола");
  assert.ok(plate[0].n.z > 0, "и она смотрит вверх");
  // Плита идёт по габариту чертежа, то есть по осевым линиям наружных стен:
  // дальше неё лезть нельзя — за осевой начинается улица.
  assert.equal(volumeArea(plate[0].p), 4000 * 3000);
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
  assert.equal(built.faces.filter((face) => face.layer === VOLUME_LAYER_BASE).length, 1, "плита на месте — пола не лишаемся");
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

test("длинный шаг не проскакивает сквозь тонкую перегородку", () => {
  // Перегородка в 50 мм поперёк пути и прыжок на пять метров: выталкивание
  // разбирает перекрытие, а не путь, поэтому шаг обязан дробиться.
  const base = planProject();
  const project = addWall(base.project, {
    schemeId: base.schemeId,
    aMm: { x: -3000, y: 0 },
    bMm: { x: 3000, y: 0 },
    thicknessMm: 50,
  }).project;
  const built = volumeScene(project, base.schemeId);
  const after = volumeStep(built, { x: 0, y: -2000 }, 0, 5000);
  assert.ok(after.y < 0, "остались по свою сторону перегородки: " + after.y);
});

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
  assert.ok(frame.some((polygon) => polygon.layer === VOLUME_LAYER_GROUND), "пол и потолок в кадре");
  assert.equal(frame[0].layer, VOLUME_LAYER_BASE, "плита ложится первой");
  const firstBody = frame.findIndex((polygon) => polygon.layer === VOLUME_LAYER_BODY);
  assert.ok(
    frame.slice(0, firstBody).every((polygon) => polygon.layer < VOLUME_LAYER_BODY),
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
  // Взгляд опущен: выключатель висит на 900 мм, а глаза на 1600.
  const camera = { at: { x: 0, y: 0, z: VOLUME_EYE_MM }, yaw: -Math.PI / 2, pitch: -0.5 };
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
    assert.equal(face.layer, VOLUME_LAYER_MARK, "указатель рисуется поверх всего — иначе ближняя стена спрячет его");
    assert.ok(face.n.z > 0, "смотрит вверх");
  }
  const scene = roomScene();
  const built = volumeScene(scene.project, scene.schemeId);
  const box = { width: 1200, height: 700 };
  const camera = volumeAroundCamera({ x: 0, y: 0, z: 1200 }, 0.5, -0.8, 9000);
  const frame = volumeFrame(built, camera, box, marker);
  assert.equal(frame.length, volumeFrame(built, camera, box).length + 2);
  // И ложится он последним: ближняя стена прячет за собой полосу пола, а
  // указатель обязан быть виден всегда.
  assert.equal(frame[frame.length - 1].layer, VOLUME_LAYER_MARK);
  assert.equal(frame[frame.length - 2].layer, VOLUME_LAYER_MARK);
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

test("вещь на полу держит человека, а короб под потолком — нет", () => {
  const scene = roomScene();
  const kinds = ensureSchemeObjectKinds(scene.project);
  let project = kinds.project;
  const kind = schemeObjectKindsInOrder(project)[0];
  const place = (heightMm, heightAboveFloorMm) =>
    addSchemeObject(project, {
      schemeId: scene.schemeId,
      kindId: kind.id,
      shape: "rect",
      atMm: { x: 0, y: 0 },
      widthMm: 1200,
      depthMm: 600,
      turnDeg: 0,
      heightMm,
      heightAboveFloorMm,
    }).project;
  const bare = volumeScene(project, scene.schemeId).solids.length;
  // Шкаф на полу — препятствие.
  assert.equal(volumeScene(place(2200, 0), scene.schemeId).solids.length, bare + 1);
  // Короб под потолком — над головой, проходим.
  assert.equal(volumeScene(place(400, 2200), scene.schemeId).solids.length, bare);
  // Порожек в сто миллиметров — переступили.
  assert.equal(volumeScene(place(100, 0), scene.schemeId).solids.length, bare);
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

test("в тесном месте окно говорит об этом словом, а не чинит само", () => {
  const scene = roomScene({ roomName: "Санузел" });
  const built = volumeScene(scene.project, scene.schemeId);
  // Посередине комнаты 4 × 3 м просторно.
  assert.equal(volumeWhere(scene.project, built, { x: 0, y: 0 }), "Вы в помещении «Санузел»");
  // Вплотную к стене — тесно, и названо это вслух.
  const wall = volumeStep(built, { x: 0, y: 0 }, 0, 5000);
  assert.ok(volumeWhere(scene.project, built, wall).includes("тесно"), "про тесноту сказано: " + volumeWhere(scene.project, built, wall));
  // Но геометрия цела: стена не ближе ближней плоскости.
  assert.ok(volumeFreeMm(built.solids, wall.x, wall.y) > VOLUME_NEAR_MM);
});

test("обзор не ныряет под крышу: наклон ограничен расстоянием", () => {
  const lift = 1900;
  // Отошли далеко — можно смотреть почти вдоль земли, но всё же сверху.
  const far = volumeAroundPitch(0, 20000, lift);
  assert.ok(far < 0, "обзор всегда смотрит сверху: " + far);
  assert.ok(Math.abs(Math.sin(-far) * 20000 - lift) < 1, "подъём над целью ровно по крыше");
  // Подошли вплотную — вид становится отвесным.
  assert.ok(volumeAroundPitch(0, 2000, lift) < volumeAroundPitch(0, 20000, lift));
  // Ближе, чем крыша высока, — почти отвес, и за него не заходим.
  assert.ok(volumeAroundPitch(0, 500, lift) <= -((VOLUME_PITCH_MAX_DEG * Math.PI) / 180) + 1e-9);
  // Круче ограничения смотреть не запрещено — запрещено положе.
  assert.ok(volumeAroundPitch(-1.2, 20000, lift) < far);
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

// ——— метки в объёме (таск 148) ————————————————————————————————————————
//
// Три вещи, которые тихо врут, если за ними не следить:
//
//   1. **Где стоит вещь.** Правила места — слова заказчика, и проверяются они
//      числами: отступ, высота и сторона у стенной, потолок у потолочной.
//   2. **Что не размещено.** Выдумывать место нельзя, молча терять — тоже.
//      Список обязан называть метку и причину.
//   3. **Что изображение разбирается тем же списком** (обещание таска 139):
//      второй интерпретатор читает те же пять примитивов и не вылезает из
//      прямоугольника вещи.

const typeByCode = (project, code) => project.markTypes.find((type) => type.code === code);

// Метка на схеме с автопривязкой к стене — тем же путём, каким её ставит холст
// (`canvasCommit` → `applyMarkWalls`): привязка обязана быть следствием места.
function markAt(project, schemeId, code, pointsMm, kind = "point") {
  const added = addMark(project, {
    schemeId,
    typeId: typeByCode(project, code).id,
    kind,
    points: pointsMm.map((point) => planMmToFraction(project, schemeId, point)),
  });
  const bound = applyMarkWalls(added.project, schemeId);
  return { project: bound.project, markId: added.marks[0].id };
}

const placeOf = (built, markId) => built.marks.find((place) => place.markId === markId) || null;
const faceSpanZ = (place) => ({
  bottomMm: Math.min(...place.prisms.map((prism) => prism.bottomMm)),
  topMm: Math.max(...place.prisms.map((prism) => prism.topMm)),
});

test("метка на стене стоит по отступу, высоте и стороне", () => {
  const scene = roomScene();
  // Розетка у верхней стены, внутри комнаты: 300 мм от грани — автопривязка
  // берёт её (порог 600).
  const put = markAt(scene.project, scene.schemeId, "Р", [{ x: -500, y: -1100 }]);
  const built = volumeScene(put.project, scene.schemeId, {});
  const place = placeOf(built, put.markId);
  assert.ok(place, "розетка размещена");
  assert.equal(place.mode, VOLUME_MARK_WALL);
  assert.equal(place.side, markWallSide(put.project, findMark(put.project, put.markId)));
  // Высота — умолчание типа (G192): 300 мм до середины розетки.
  assert.equal(place.heightMm, 300);
  const span = faceSpanZ(place);
  assert.equal(span.bottomMm, 260, "низ розетки — середина минус половина ширины");
  assert.equal(span.topMm, 340);
  // Сторона: вещь стоит внутри комнаты, то есть с той же стороны оси стены,
  // что и сама метка, и не глубже грани.
  const binding = markWall(findMark(put.project, put.markId));
  assert.equal(binding.wallId, scene.walls[0]);
  for (const corner of place.prisms[0].corners) {
    assert.ok(corner.y > -1400 - 1e-9, "вещь не утоплена в стену: " + corner.y);
    assert.ok(corner.y < -1400 + VOLUME_MARK_LIFT_MM + 10 + 1e-9, "и не улетела в комнату: " + corner.y);
    // Выступ рамки — десять миллиметров, и вещь выходит ровно на них.
    // Отступ вдоль стены — из привязки, своей длиной в обе стороны.
    assert.ok(Math.abs(corner.x - (-2000 + binding.atMm)) <= 40 + 1e-9);
  }
  // Лицо вещи смотрит в комнату, и изображение объекта рисуется по нему.
  assert.ok(place.face.normal.y > 0, "лицо розетки смотрит внутрь комнаты");
  assert.equal(place.face.widthMm, 80);
  assert.equal(place.face.heightMm, 80);
});

test("утопленное лицом остаётся в плоскости стены, а телом уходит внутрь", () => {
  const scene = roomScene();
  // Щит: выступ −30 (встроен в нишу), высота 1400.
  const put = markAt(scene.project, scene.schemeId, "Щ", [{ x: 0, y: -1100 }]);
  const built = volumeScene(put.project, scene.schemeId, {});
  const place = placeOf(built, put.markId);
  assert.equal(place.mode, VOLUME_MARK_WALL);
  const ys = place.prisms[0].corners.map((corner) => corner.y);
  // Лицо — у самой грани стены (−1400 плюс подъём), тело на 30 мм в стену.
  assert.ok(Math.max(...ys) <= -1400 + VOLUME_MARK_LIFT_MM + 1e-9);
  assert.ok(Math.min(...ys) < -1400, "утопленное уходит в стену, а не наружу");
  assert.ok(Math.max(...ys) - Math.min(...ys) >= 29, "глубина ниши — его выступ");
});

test("потолочная без высоты встаёт под потолок, с высотой — на свою", () => {
  const scene = roomScene();
  // Точечный светильник: в справочнике у него нет высоты вовсе — и это не
  // пропуск, а то, как заказчик отмечает потолочное.
  const put = markAt(scene.project, scene.schemeId, "Т", [{ x: 0, y: 0 }]);
  const ceiling = placeOf(volumeScene(put.project, scene.schemeId, {}), put.markId);
  assert.equal(ceiling.mode, VOLUME_MARK_CEILING);
  assert.equal(faceSpanZ(ceiling).topMm, 2700, "верх вещи — потолок комнаты");
  assert.ok(ceiling.face.normal.z < 0, "лицо потолочной вещи смотрит вниз");
  // Высоту поставили руками — вещь уходит на неё, оставаясь на своём месте.
  const lowered = setMarkDimensions(put.project, put.markId, { heightAboveFloor: 2400 }).project;
  const own = placeOf(volumeScene(lowered, scene.schemeId, {}), put.markId);
  assert.equal(own.mode, VOLUME_MARK_ROOM);
  assert.equal(own.heightMm, 2400);
  assert.deepEqual(own.anchor.x, ceiling.anchor.x, "место по плану не изменилось");
  assert.deepEqual(own.anchor.y, ceiling.anchor.y);
});

test("точечная лента встаёт вертикальной лентой", () => {
  const scene = roomScene();
  // ЛВ — лента вертикальная: 40 вдоль стены, 600 вверх, высота 900.
  const put = markAt(scene.project, scene.schemeId, "ЛВ", [{ x: 800, y: -1100 }]);
  const place = placeOf(volumeScene(put.project, scene.schemeId, {}), put.markId);
  assert.equal(place.mode, VOLUME_MARK_WALL);
  const span = faceSpanZ(place);
  assert.equal(span.bottomMm, 600);
  assert.equal(span.topMm, 1200);
  assert.equal(place.face.widthMm, 40);
  assert.equal(place.face.heightMm, 600);
  assert.ok(place.face.heightMm > place.face.widthMm * 10, "лента стоит стоймя, а не лежит");
});

test("линейная метка идёт по своей линии, а высота у неё по общему правилу", () => {
  const scene = roomScene();
  // Подсветка карниза штор: линейная, высота 2400 — вдоль верхней стены.
  const strip = markAt(
    scene.project,
    scene.schemeId,
    "ПКШ",
    [{ x: -1500, y: -1100 }, { x: 1500, y: -1100 }],
    "line",
  );
  const onWall = placeOf(volumeScene(strip.project, scene.schemeId, {}), strip.markId);
  assert.equal(onWall.mode, VOLUME_MARK_WALL);
  assert.equal(onWall.heightMm, 2400);
  assert.equal(onWall.kind, "line");
  const binding = markWall(findMark(strip.project, strip.markId));
  const alongMm = Math.abs(binding.toMm - binding.atMm);
  const xs = onWall.prisms[0].corners.map((corner) => corner.x);
  assert.ok(Math.abs(Math.max(...xs) - Math.min(...xs) - alongMm) < 1, "лента идёт от своего начала до конца");
  // Трек без высоты — по своей линии под потолком, а не на стене.
  const track = markAt(
    scene.project,
    scene.schemeId,
    "ТР",
    [{ x: -800, y: -200 }, { x: 800, y: -200 }, { x: 800, y: 800 }],
    "line",
  );
  const above = placeOf(volumeScene(track.project, scene.schemeId, {}), track.markId);
  assert.equal(above.mode, VOLUME_MARK_CEILING);
  assert.equal(above.prisms.length, 2, "по призме на звено ломаной");
  assert.equal(faceSpanZ(above).topMm, 2700);
  assert.equal(above.face, null, "у ленты лица нет: изображение объекта принадлежит вещи, а не линии");
});

test("метка без высоты и без потолка над ней не размещается, а называется", () => {
  const scene = roomScene();
  // Светильник за пределами обведённого помещения: высоты у типа нет, потолка
  // над меткой тоже — вешать не на что.
  const put = markAt(scene.project, scene.schemeId, "Т", [{ x: 3500, y: 3000 }]);
  const built = volumeScene(put.project, scene.schemeId, {});
  assert.equal(placeOf(built, put.markId), null);
  assert.equal(built.unplaced.length, 1);
  assert.equal(built.unplaced[0].markId, put.markId);
  assert.equal(built.unplaced[0].reason, VOLUME_MARK_NO_PLACE);
  assert.equal(built.unplaced[0].label, labelOf(put.project, put.markId));
});

test("вещь без размеров не размещается: рисовать её нечем", () => {
  const scene = roomScene();
  const category = scene.project.categories[0];
  const added = addType(scene.project, { code: "МВ", name: "Мастер-выключатель", categoryId: category.id });
  const put = markAt(added.project, scene.schemeId, "МВ", [{ x: 0, y: -1100 }]);
  const built = volumeScene(put.project, scene.schemeId, {});
  assert.equal(built.marks.length, 0);
  assert.equal(built.unplaced[0].reason, VOLUME_MARK_NO_SIZE);
});

test("плашка комментария в объём не идёт вовсе — ни вещью, ни строкой списка", () => {
  const scene = roomScene();
  const comment = addMark(scene.project, {
    schemeId: scene.schemeId,
    typeId: COMMENT_TYPE_ID,
    kind: "comment",
    points: [planMmToFraction(scene.project, scene.schemeId, { x: 0, y: 0 })],
  });
  const built = volumeScene(comment.project, scene.schemeId, {});
  assert.equal(built.marks.length, 0);
  assert.equal(built.unplaced.length, 0, "надпись на чертеже — не потерянная вещь");
});

test("фильтр плана и объём показывают одно и то же", () => {
  const scene = roomScene();
  const first = markAt(scene.project, scene.schemeId, "Р", [{ x: -500, y: -1100 }]);
  const second = markAt(first.project, scene.schemeId, "В", [{ x: 500, y: -1100 }]);
  const all = volumeScene(second.project, scene.schemeId, {});
  assert.equal(all.marks.length, 2);
  const only = volumeScene(second.project, scene.schemeId, {
    marks: second.project.marks.filter((mark) => mark.id === first.markId),
  });
  assert.equal(only.marks.length, 1);
  assert.equal(only.marks[0].markId, first.markId);
});

// ——— изображение объекта: второй интерпретатор ————————————————————————

test("второй интерпретатор разбирает те же пять примитивов", () => {
  const lines = volumeViewPolylines({
    parts: [
      { kind: "rect", x: -0.4, y: -0.3, width: 0.8, height: 0.6, radius: 0 },
      { kind: "circle", cx: 0, cy: 0, r: 0.2 },
      { kind: "line", x1: -0.5, y1: 0, x2: 0.5, y2: 0 },
      { kind: "arc", cx: 0, cy: 0, r: 0.3, from: 0, to: Math.PI, close: true },
      { kind: "poly", points: [[-0.2, -0.2], [0.2, -0.2], [0, 0.2]], close: true },
    ],
  });
  assert.equal(lines.length, 5, "ни один вид записи не потерян");
  assert.deepEqual(lines[0].points.length, 4, "прямоугольник без скругления — четыре вершины");
  assert.ok(lines[1].points.length >= 12 && lines[1].closed, "окружность разобрана на отрезки и замкнута");
  assert.equal(lines[2].closed, false, "отрезок не замыкается");
  assert.ok(lines[3].points.length >= 3 && lines[3].closed, "дуга с замыканием");
  assert.deepEqual(lines[4].points.length, 3);
});

test("все изображения справочника умещаются в свой прямоугольник и в объёме", () => {
  for (const name of objectViewNames()) {
    const lines = volumeViewPolylines(objectViewByName(name));
    assert.ok(lines.length > 0, "у изображения «" + name + "» нет ни одной линии");
    for (const line of lines) {
      for (const point of line.points) {
        // Та же мера, что у плоского обмера в `objectViews.test.js`: десятая
        // доля запаса (объектив проектора выходит на 0,52). Двух разных
        // ответов на «умещается ли контур» в сборке быть не должно.
        assert.ok(Math.abs(point.x) <= 0.55, name + ": контур вылез по ширине — " + point.x);
        assert.ok(Math.abs(point.y) <= 0.55, name + ": контур вылез по высоте — " + point.y);
      }
    }
  }
});

test("контур вещи рисуется её цветом и лежит на её лице", () => {
  const scene = roomScene();
  const put = markAt(scene.project, scene.schemeId, "Р", [{ x: -500, y: -1100 }]);
  const built = volumeScene(put.project, scene.schemeId, {});
  const place = placeOf(built, put.markId);
  assert.ok(place.view, "у розетки есть изображение объекта (по форме знака)");
  const lines = built.faces.filter((face) => face.line && face.markId === put.markId);
  assert.ok(lines.length >= 3, "контур розетки — несколько линий");
  const style = styleOf(put.project, findMark(put.project, put.markId).typeId);
  for (const line of lines) {
    assert.equal(line.color, style.color, "контур рисуется цветом метки");
    for (const point of line.p) {
      // Точка контура обязана лежать в пределах лица вещи: вдоль — половина
      // длины, по высоте — половина ширины. Это тот же обмер, которым таск 139
      // проверял плоские изображения, только в объёме.
      const along =
        (point.x - place.face.origin.x) * place.face.u.x + (point.y - place.face.origin.y) * place.face.u.y;
      assert.ok(Math.abs(along) <= place.face.widthMm * 0.55, "контур вылез вдоль стены: " + along);
      assert.ok(Math.abs(point.z - place.face.origin.z) <= place.face.heightMm * 0.55, "контур вылез по высоте");
    }
  }
});

// ——— выделение, клик и связи —————————————————————————————————————————

test("клик попадает в вещь, а не в стену за ней", () => {
  const scene = roomScene();
  const put = markAt(scene.project, scene.schemeId, "К", [{ x: 0, y: -1100 }]);
  const built = volumeScene(put.project, scene.schemeId, {});
  const place = placeOf(built, put.markId);
  const box = { width: 800, height: 600 };
  // Смотрим на кондиционер из середины комнаты.
  const camera = { at: { x: 0, y: 500, z: VOLUME_EYE_MM }, yaw: -Math.PI / 2, pitch: 0 };
  const frame = volumeFrame(built, camera, box);
  const mine = frame.filter((polygon) => polygon.pick === put.markId && !polygon.stroke);
  assert.ok(mine.length > 0, "грани вещи знают, чьи они");
  const xy = mine[mine.length - 1].xy;
  const centre = { x: (xy[0] + xy[4]) / 2, y: (xy[1] + xy[5]) / 2 };
  assert.equal(volumePickAt(frame, centre.x, centre.y), put.markId);
  // Мимо всего — пусто: клик по стене выделение снимает, а не оставляет.
  assert.equal(volumePickAt(frame, 5, 5), null);
  assert.ok(place.anchor.z > 0);
});

test("рамка выделения лежит поверх всего: вещь за стеной не теряется", () => {
  const scene = roomScene();
  const put = markAt(scene.project, scene.schemeId, "Р", [{ x: -500, y: -1100 }]);
  const built = volumeScene(put.project, scene.schemeId, {});
  const lines = volumeSelectLines(placeOf(built, put.markId));
  assert.equal(lines.length, 1);
  assert.equal(lines[0].layer, VOLUME_LAYER_MARK);
  assert.ok(lines[0].closed && lines[0].dash, "рамка замкнута и пунктирна — как кольцо выделения на плане");
  assert.equal(lines[0].color, VOLUME_SELECT_COLOR);
});

test("связь рисуется дважды: сплошной в сцене и пунктиром сквозь стену", () => {
  const anchors = { a: { x: 0, y: 0, z: 900 }, b: { x: 3000, y: 0, z: 2700 } };
  const lines = volumeLinkLines({ lines: [{ fromId: "a", toId: "b" }] }, (id) => anchors[id] || null);
  assert.equal(lines.length, 2);
  const solid = lines.find((line) => line.layer !== VOLUME_LAYER_MARK);
  const through = lines.find((line) => line.layer === VOLUME_LAYER_MARK);
  assert.ok(solid && through, "одна линия в общем потоке, вторая поверх всего");
  assert.equal(solid.dash, null, "видимая часть связи — сплошная");
  assert.ok(through.dash, "сквозная — пунктиром: по нему и видно, что цель за стеной");
  assert.ok(solid.arrow && through.arrow, "управление — отношение направленное");
  assert.ok(through.width < solid.width);
  // Общее управление — отношение равных, и стрелки у него нет.
  const ties = volumeLinkLines({ ties: [{ fromId: "a", toId: "b" }] }, (id) => anchors[id] || null);
  assert.ok(ties.every((line) => !line.arrow));
  // Неразмещённой вещи в объёме нет — нет и стрелки в пустоту.
  assert.deepEqual(volumeLinkLines({ lines: [{ fromId: "a", toId: "нет" }] }, (id) => anchors[id] || null), []);
});

test("строка «не размещены» называет метки и причину, а длинный список обрывает", () => {
  assert.equal(volumeUnplacedLine([]), "");
  const one = volumeUnplacedLine([{ markId: "1", label: "ДД1", reason: VOLUME_MARK_NO_PLACE }]);
  assert.ok(one.includes("ДД1"), one);
  assert.ok(one.includes("1"), one);
  const many = [];
  for (let index = 0; index < VOLUME_UNPLACED_SHOWN + 3; index += 1) {
    many.push({ markId: String(index), label: "Т" + index, reason: VOLUME_MARK_NO_SIZE });
  }
  const line = volumeUnplacedLine(many);
  assert.ok(line.includes("Т0") && !line.includes("Т10"), line);
  assert.ok(volumeUnplacedTitle(many).includes("Т10"), "все обозначения остаются в подсказке");
  assert.equal(volumeUnplacedTitle([{ markId: "1", label: "Т1", reason: VOLUME_MARK_NO_SIZE }]), "");
});

test("метки в сцене не меняют объект (G68)", () => {
  const scene = roomScene();
  const put = markAt(scene.project, scene.schemeId, "Р", [{ x: -500, y: -1100 }]);
  const before = JSON.stringify(put.project);
  const built = volumeScene(put.project, scene.schemeId, {});
  assert.equal(built.marks.length, 1);
  assert.equal(JSON.stringify(put.project), before, "объём только читает (G68)");
});

test("вещь рисуется после своего куска стены — иначе стена закрашивает её собой", () => {
  // Дефект живого прогона: выключатель на стене пропадал целиком. Порядок
  // граней решала дальность их середин, и стена в четыре метра серединой
  // оказывалась ближе метки у своего края.
  const scene = roomScene();
  const put = markAt(scene.project, scene.schemeId, "В", [{ x: 200, y: -1100 }]);
  const built = volumeScene(put.project, scene.schemeId, {});
  const place = placeOf(built, put.markId);
  assert.ok(Array.isArray(place.host) && place.host.length > 0, "вещь знает свой кусок стены");
  // Смотрим на эту стену из середины комнаты.
  // Взгляд опущен: выключатель висит на 900 мм, а глаза на 1600.
  const camera = { at: { x: 0, y: 0, z: VOLUME_EYE_MM }, yaw: -Math.PI / 2, pitch: -0.5 };
  const frame = volumeFrame(built, camera, { width: 900, height: 600 });
  let wallAt = -1;
  let markAtIndex = -1;
  frame.forEach((polygon, index) => {
    if (polygon.host && place.host.includes(polygon.host)) wallAt = Math.max(wallAt, index);
    if (polygon.pick === put.markId) markAtIndex = Math.max(markAtIndex, index);
  });
  assert.ok(wallAt >= 0, "кусок стены в кадре есть");
  assert.ok(markAtIndex > wallAt, "вещь ложится поверх своего куска стены: " + markAtIndex + " против " + wallAt);
});

test("контур едет в очереди вместе со своим телом, а не под ним", () => {
  // Дефект живого прогона: контур рисовался, но тело метки ложилось поверх
  // него — у кондиционера от решётки оставался один индикатор. Тело и контур
  // обязаны идти в кадре подряд, и порядок этот проверяется, а не смотрится.
  const scene = roomScene();
  const put = markAt(scene.project, scene.schemeId, "К", [{ x: 200, y: -1100 }]);
  const built = volumeScene(put.project, scene.schemeId, {});
  const place = placeOf(built, put.markId);
  assert.ok(place.view, "у кондиционера есть изображение объекта");
  const camera = { at: { x: 0, y: 0, z: VOLUME_EYE_MM }, yaw: -Math.PI / 2, pitch: 0.2 };
  const frame = volumeFrame(built, camera, { width: 900, height: 600 });
  let lastBody = -1;
  let firstLine = Infinity;
  frame.forEach((polygon, index) => {
    if (polygon.pick !== put.markId) return;
    if (polygon.stroke) firstLine = Math.min(firstLine, index);
    else lastBody = Math.max(lastBody, index);
  });
  assert.ok(firstLine < Infinity, "контур в кадре есть");
  assert.ok(firstLine > lastBody, "контур ложится поверх тела: " + firstLine + " против " + lastBody);
});

test("изображение не встаёт вверх ногами: низ картинки — низ вещи", () => {
  // У плоского интерпретатора ось y растёт вниз (холст), у объёма — вверх.
  const scene = roomScene();
  const put = markAt(scene.project, scene.schemeId, "К", [{ x: 200, y: -1100 }]);
  const place = placeOf(volumeScene(put.project, scene.schemeId, {}), put.markId);
  const top = volumeFacePoint(place.face, 0, -0.5);
  const bottom = volumeFacePoint(place.face, 0, 0.5);
  assert.ok(top.z > bottom.z, "верх изображения выше его низа: " + top.z + " против " + bottom.z);
  assert.equal(Math.round(top.z - bottom.z), place.face.heightMm);
});
