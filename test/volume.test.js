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
  WALL_HEIGHT_FALLBACK_MM,
  addMark,
  addOpening,
  addOutline,
  addRoom,
  addScheme,
  addSchemeObject,
  addSchemeObjectKind,
  addType,
  addWall,
  applyMarkWalls,
  createProject,
  SCHEME_FLOOR_MAX,
  SCHEME_FLOOR_MIN,
  ensureSchemeObjectKinds,
  findMark,
  findScheme,
  labelOf,
  markWall,
  markWallSide,
  planMmToFraction,
  schemeFloorOf,
  schemeObjectKindsInOrder,
  setMarkDimensions,
  setPlanOrigin,
  setPlanScale,
  setMarkControls,
  setRoomWallHeight,
  setSchemeFloor,
  setSchemeWallHeight,
  styleOf,
  wallElevation,
} from "../src/model.js";
import { MARK_BOX_FRAME_DEPTH_MM, MARK_BOX_FRAME_MM } from "../src/markBox.js";
import { objectViewByName, objectViewNames, objectViewShapes } from "../src/objectViews/registry.js";
import { objectCatalogKeyByName } from "../src/objectCatalog.js";
import {
  VOLUME_BODY_MM,
  VOLUME_EYE_MM,
  VOLUME_LAYER_BASE,
  VOLUME_LAYER_BODY,
  VOLUME_LAYER_GROUND,
  VOLUME_LAYER_MARK,
  VOLUME_DOOR_RGB,
  VOLUME_PLANE_EPS_MM,
  VOLUME_HANDLE_RGB,
  VOLUME_MARKER_MM,
  VOLUME_MARK_CEILING,
  VOLUME_MARK_LIFT_MM,
  VOLUME_MARK_MIN_MM,
  VOLUME_MARK_NO_PLACE,
  VOLUME_MARK_NO_SIZE,
  VOLUME_MARK_ROOM,
  VOLUME_MARK_WALL,
  VOLUME_OBJECT_RGB,
  VOLUME_CLEAR_ALPHA,
  VOLUME_MITER_MAX,
  VOLUME_WALL_RGB,
  VOLUME_NEAR_MM,
  VOLUME_PITCH_MAX_DEG,
  VOLUME_AROUND_PAN_TILT_MIN,
  VOLUME_HILLS,
  VOLUME_FLOOR_LAP,
  VOLUME_FLOOR_RGB,
  VOLUME_LAND_RGB,
  VOLUME_MOUNTAINS,
  VOLUME_SUN_AT,
  VOLUME_RIVER,
  VOLUME_RIVER_GREENS,
  VOLUME_ROAD,
  VOLUME_SELECT_COLOR,
  VOLUME_STAIR_REACH_MM,
  volumeArea,
  volumeAroundCamera,
  volumeAroundFit,
  volumeAroundPan,
  volumeAroundPitch,
  volumeClipNear,
  volumeClipDepth,
  volumeFaceSide,
  volumeOrderRank,
  volumeOrderTree,
  volumeOrderWalk,
  volumeSplitFace,
  volumeDoorAt,
  volumeFloorAt,
  volumeMoveTo,
  volumeSkyAim,
  volumeSkyPoint,
  volumeStripRuns,
  volumeRiverGreens,
  volumeDrawBackdrop,
  volumeBasis,
  volumeFill,
  volumeFocal,
  volumeFrame,
  volumeFreeMm,
  volumeHeightMm,
  volumeHorizon,
  volumeChannelAt,
  volumeChannelLines,
  volumeChannelLinks,
  volumeLinkLines,
  volumeMarkFaces,
  volumeMarkOnFloor,
  volumeMarkViewLines,
  volumeMarkerFaces,
  volumePickAt,
  volumeSightAt,
  volumeFacePoint,
  volumeModelRgb,
  volumeSelectLines,
  volumeViewPolylines,
  volumeObjectFaces,
  volumeObjectPrisms,
  volumePrismSolid,
  volumeObjectModel,
  volumeOpeningWalkable,
  volumePointInside,
  volumeRoomAt,
  volumeScene,
  volumeShade,
  volumeFloors,
  volumeStairNear,
  volumeStairs,
  volumeStart,
  volumeStep,
  volumeWallSolids,
  volumeWallTiles,
} from "../src/volume.js";
import {
  VOLUME_UNPLACED_SHOWN,
  volumeAltKey,
  volumeClampPitch,
  volumeAimChoice,
  volumeDoorLine,
  volumeDoorsAfterAll,
  volumeHasDrawing,
  volumeHintText,
  volumeKeyMove,
  volumeMinimapBox,
  volumeNotes,
  volumeFieldBottom,
  volumePadVector,
  volumeFloorAction,
  volumeFloorName,
  volumeTitle,
  volumeTypingTarget,
  volumeViewSwitch,
  volumeUnplacedLine,
  volumeUnplacedTitle,
  volumeWhere,
} from "../src/panels/volume.js";
import { elevationNote } from "../src/panels/elevation.js";
import { plateUnseen } from "../src/panels/plate.js";
import { strings, text } from "../src/strings.js";

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
  // Пол и потолок помещения — и полоса пола под каждой из четырёх стен: она
  // закрывает порог в проёме и щель между контуром и гранью стены (D37).
  assert.equal(ground.length, 2 + 4, "пол, потолок и пол под каждой стеной");
  const ceiling = ground.find((face) => face.n.z < 0);
  const floors = ground.filter((face) => face.n.z > 0);
  assert.equal(floors.length, 5, "у пола нормаль вверх, у потолка вниз");
  assert.ok(floors.every((face) => face.p.every((point) => point.z === 0)), "весь пол лежит на нуле");
  assert.ok(ceiling.p.every((point) => point.z === 2700), "потолок — на высоте схемы");
  // Под ними — плита по габариту чертежа. Полом она больше не работает: пол у
  // помещений свой, а плита стала землёй вокруг дома (G237).
  assert.equal(built.faces.filter((face) => face.layer === VOLUME_LAYER_BASE).length, 1);
  // Толщина стены видна по торцам: у стены без проёмов две стороны, два торца
  // и верх, низ не рисуется — он под полом. Метровой сетки, которой стороны
  // резались в тасках 148–150 ради порядка, больше нет (таск 151): сторона без
  // проёмов — один многоугольник.
  const body = built.faces.filter((face) => face.layer === VOLUME_LAYER_BODY);
  assert.equal(body.length, 4 * (2 + 3), "по пять граней на стену: две стороны, два торца, верх");
});

// ——— D37: под проёмом и под стеной есть пол ———————————————————————————————
//
// Слова заказчика: «под дверными проёмами нет пола». Пол лежит по контурам
// помещений, под стенами его нет никогда, а проём — дыра в стене на всю её
// толщину. Раньше щели затыкала плита чертежа, крашенная полом; с тех пор как
// плита стала землёй (G237), сквозь них видно траву.

// Накрыта ли точка плана полом на нулевой отметке.
function floorUnder(built, point) {
  return built.faces.some(
    (face) =>
      face.n.z > 0 &&
      face.p.every((corner) => corner.z === 0) &&
      face.rgb === VOLUME_FLOOR_RGB &&
      volumePointInside(point, face.p),
  );
}

test("под дверным проёмом есть пол, а не земля (D37)", () => {
  const scene = roomScene();
  // Дверь в нижней стене комнаты: ось стены идёт по y = −1500, толщина 200.
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
  // Середина проёма — ровно та точка, где человек переступает порог: пол там
  // обязан быть, и он не кончается ни у одной грани стены.
  const middle = { x: -2000 + 1500 + 450, y: -1500 };
  assert.ok(floorUnder(built, middle), "в проёме пола нет — видно землю");
  for (const across of [-90, -40, 0, 40, 90]) {
    assert.ok(floorUnder(built, { x: middle.x, y: -1500 + across }), "порог дырявый на " + across + " мм");
  }
  // И щель под самой стеной — между контуром помещения и гранью стены — тоже
  // закрыта: контур обведён на 100 мм внутрь от оси, стена уходит на 100 мм
  // наружу.
  assert.ok(floorUnder(built, { x: 0, y: -1500 }), "под стеной пола нет");
  assert.ok(floorUnder(built, { x: 0, y: -1450 }), "щель между полом комнаты и стеной открыта");
});

test("полоса пола прячется под стеной и не лезет кантом наружу", () => {
  const scene = roomScene();
  const built = volumeScene(scene.project, scene.schemeId);
  // Наружная грань нижней стены — y = −1600. Дальше полоса уходит ровно на
  // напуск и не больше: иначе пол был бы виден из-под дома.
  assert.ok(floorUnder(built, { x: 0, y: -1600 - VOLUME_FLOOR_LAP + 5 }), "полоса не доходит до наружной грани");
  assert.ok(!floorUnder(built, { x: 0, y: -1600 - VOLUME_FLOOR_LAP - 5 }), "пол вылез из-под стены на землю");
  // Обзор «вся схема» обязан вмещать то, что рисуется, — с выносом стен и
  // напуском пола.
  assert.ok(built.outsetMm >= 100 + VOLUME_FLOOR_LAP - 1e-9, "вынос посчитан не по толщине стены: " + built.outsetMm);
});

test("помещения не обведены — плита остаётся полом, и подкладывать под стену нечего (D37)", () => {
  const bare = roomScene({ room: false });
  const built = volumeScene(bare.project, bare.schemeId);
  assert.equal(built.faces.filter((face) => face.layer === VOLUME_LAYER_GROUND).length, 0, "полос под стенами нет");
  const plate = built.faces.find((face) => face.layer === VOLUME_LAYER_BASE);
  assert.deepEqual(plate.rgb, VOLUME_FLOOR_RGB, "плита сама пол — красить её землёй нельзя");
  assert.ok(floorUnder(built, { x: 0, y: -1500 }), "пол под стеной есть — это сама плита");
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
  assert.equal(ceiling.p[0].z, WALL_HEIGHT_FALLBACK_MM);
  assert.ok(volumeNotes(built)[0].includes(String(WALL_HEIGHT_FALLBACK_MM)), "число названо в строке");
});

test("стена без своего числа — одно умолчание на объём и развёртку (таск 173)", () => {
  const scene = roomScene();
  const project = setSchemeWallHeight(scene.project, scene.schemeId, "").project;
  const built = volumeScene(project, scene.schemeId);
  const wallId = scene.walls[0];
  const view = wallElevation(project, wallId, "left");
  // Главное этого таска: про одну и ту же стену обе поверхности говорят одно
  // число. Прежде окно обещало это комментарием, а числа были 2700 и «не ниже
  // 2000» — и совпадали они только случайно.
  assert.equal(view.heightShownMm, WALL_HEIGHT_FALLBACK_MM);
  assert.equal(volumeHeightMm(project, scene.schemeId, null).mm, view.heightShownMm);
  const said = String(WALL_HEIGHT_FALLBACK_MM);
  assert.ok(volumeNotes(built)[0].includes(said), "объём называет умолчание");
  assert.ok(elevationNote(view).includes(said), "развёртка называет то же самое");
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

// ——— двери (G207, G210, таск 150) —————————————————————————————————————
//
// Решение таска 146 отменено заказчиком: «По умолчанию пусть все двери будут
// закрыты, по клику на них или когда наведён курсор, то по нажатию клавиши E
// надо открывать и закрывать дверь, ну и на дверях ручки нарисуй».
//
// Главное, за чем здесь следят: состояние двери **в объект не попадает** — оно
// живёт в сеансе окна и приходит аргументом сборки сцены (G68).

/** Комната с дверью в первой стене и окном во второй. */
function doorScene() {
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
  const doorId = project.openings[project.openings.length - 1].id;
  project = addOpening(project, {
    wallId: scene.walls[1],
    kind: "window",
    atMm: 800,
    widthMm: 1400,
    heightMm: 1400,
    heightAboveFloorMm: 800,
  }).project;
  return { ...scene, project, doorId };
}

const doorLeafOf = (built) => built.faces.find((face) => face.both && face.rgb[0] === VOLUME_DOOR_RGB[0]);

test("дверь закрыта по умолчанию: полотно стоит в проёме, а не поперёк комнаты", () => {
  const scene = doorScene();
  const built = volumeScene(scene.project, scene.schemeId);
  const twoSided = built.faces.filter((face) => face.both);
  assert.equal(twoSided.length, 5, "одно полотно двери и четыре бруска рамы окна");
  const leaf = doorLeafOf(built);
  // Стена идёт по y = −1500. Закрытое полотно лежит вдоль неё: от стены оно не
  // отходит, а проём перекрывает по всей ширине.
  const away = Math.max(...leaf.p.map((point) => Math.abs(point.y + 1500)));
  assert.ok(away < 1, "закрытое полотно стоит в проёме: " + away);
  const along = Math.max(...leaf.p.map((point) => point.x)) - Math.min(...leaf.p.map((point) => point.x));
  assert.ok(Math.abs(along - 900) < 1, "перекрывает проём во всю ширину: " + along);
  assert.equal(leaf.doorId, scene.doorId, "полотно знает свою дверь — ею распоряжается E");
});

test("у закрытой двери есть ручка, и она на высоте руки по обе стороны полотна", () => {
  const scene = doorScene();
  const built = volumeScene(scene.project, scene.schemeId);
  const handle = built.faces.filter((face) => face.rgb === VOLUME_HANDLE_RGB);
  assert.ok(handle.length >= 5, "ручка — призма: бока, верх и низ, а не одна грань");
  const zs = handle.flatMap((face) => face.p.map((point) => point.z));
  assert.ok(Math.min(...zs) > 900 && Math.max(...zs) < 1200, "ручка на высоте руки: " + Math.min(...zs) + "…" + Math.max(...zs));
  // Выступает на обе стороны полотна: дверь открывают с той стороны, с которой
  // подошли. Полотно стоит по y = −1500, значит ручка обязана его перекрыть.
  const ys = handle.flatMap((face) => face.p.map((point) => point.y));
  assert.ok(Math.min(...ys) < -1500 && Math.max(...ys) > -1500, "ручка по обе стороны полотна");
  for (const face of handle) assert.equal(face.doorId, scene.doorId, "ручка принадлежит своей двери");
});

test("названная дверь раскрывается, остальные остаются закрытыми", () => {
  const scene = doorScene();
  const closed = doorLeafOf(volumeScene(scene.project, scene.schemeId));
  const open = doorLeafOf(volumeScene(scene.project, scene.schemeId, { openDoorIds: new Set([scene.doorId]) }));
  const spread = Math.max(...open.p.map((point) => Math.abs(point.y + 1500)));
  assert.ok(spread > 800, "раскрытое полотно уходит от стены на четверть оборота: " + spread);
  assert.ok(Math.max(...closed.p.map((point) => Math.abs(point.y + 1500))) < 1, "закрытое — нет");
  // Чужое имя двери ничего не раскрывает: список — именной, а не «открыть всё».
  const other = doorLeafOf(volumeScene(scene.project, scene.schemeId, { openDoorIds: new Set(["нет такой"]) }));
  assert.ok(Math.max(...other.p.map((point) => Math.abs(point.y + 1500))) < 1);
  assert.deepEqual(volumeScene(scene.project, scene.schemeId).doors, [scene.doorId], "сцена знает все двери схемы");
});

test("G68: состояние двери в объект не попадает ни при открытии, ни при закрытии", () => {
  const scene = doorScene();
  const before = JSON.stringify(scene.project);
  volumeScene(scene.project, scene.schemeId);
  volumeScene(scene.project, scene.schemeId, { openDoorIds: new Set([scene.doorId]) });
  assert.equal(JSON.stringify(scene.project), before, "объём только читает");
});

test("«все двери» одной клавишей: есть закрытая — открываются все, иначе закрываются все", () => {
  const doors = ["a", "b", "c"];
  assert.deepEqual(volumeDoorsAfterAll(doors, new Set()), doors, "все закрыты — открываем все");
  assert.deepEqual(volumeDoorsAfterAll(doors, new Set(["b"])), doors, "одна открыта — открываем остальные");
  assert.deepEqual(volumeDoorsAfterAll(doors, new Set(doors)), [], "все открыты — закрываем все");
  assert.deepEqual(volumeDoorsAfterAll([], new Set()), [], "дверей нет — и делать нечего");
});

test("строка про двери считает открытые и называет клавиши, а без дверей молчит", () => {
  assert.equal(volumeDoorLine([], new Set(), null), "");
  const line = volumeDoorLine(["a", "b"], new Set(["a"]), null);
  assert.match(line, /открыто 1 из 2/);
  assert.match(line, /E/);
  assert.match(line, /R/);
  assert.match(volumeDoorLine(["a"], new Set(), "a"), /эту дверь/);
});

test("E действует на то, на что смотришь: спор двери и вещи решает точность (G214)", () => {
  // «нажатием на E на выключатель он должен выделяться». Одна клавиша — одно
  // правило, и разбор «дверь или вещь» проверяется, а не читается в коде.
  assert.deepEqual(volumeAimChoice({ markExact: "в1", door: null, markNear: "в1" }), { kind: "mark", id: "в1" });
  assert.deepEqual(
    volumeAimChoice({ markExact: "в1", door: "д1", markNear: "в1" }),
    { kind: "mark", id: "в1" },
    "точное попадание в вещь старше двери: в розетку целятся нарочно, под полотно попадают заодно",
  );
  assert.deepEqual(
    volumeAimChoice({ markExact: null, door: "д1", markNear: "в1" }),
    { kind: "door", id: "д1" },
    "а вещь, в которую попали только с запасом, двери уступает",
  );
  assert.deepEqual(
    volumeAimChoice({ markExact: null, door: null, markNear: "в1" }),
    { kind: "mark", id: "в1" },
    "двери нет вовсе — хватит и запаса",
  );
  assert.deepEqual(volumeAimChoice({ markExact: null, door: null, markNear: null }), { kind: "none", id: null });
});

test("дверь ловится кликом по полотну и по ручке, а стена под ними — нет", () => {
  const scene = doorScene();
  const built = volumeScene(scene.project, scene.schemeId);
  const box = { width: 1200, height: 700 };
  // Стоим в комнате и смотрим на стену с дверью: она по y = −1500, дверь на
  // отступе 1500…2400 от начала стены (x = −2000), то есть около x = −50.
  const camera = { at: { x: -50, y: 0, z: VOLUME_EYE_MM }, yaw: -Math.PI / 2, pitch: 0 };
  const frame = volumeFrame(built, camera, box);
  const found = volumeDoorAt(frame, box.width / 2, box.height / 2);
  assert.equal(found, scene.doorId, "прицел в середине поля смотрит в дверь");
  // Угол поля — стена, и дверью он быть не может: иначе E открывал бы двери,
  // на которые никто не показывал.
  assert.equal(volumeDoorAt(frame, 2, 2), null);
});

test("Alt он же Option: узнаётся и по имени клавиши, и по её коду", () => {
  assert.equal(volumeAltKey({ key: "Alt", code: "AltLeft" }), true);
  assert.equal(volumeAltKey({ key: "Dead", code: "AltRight" }), true, "на Mac Option правит ввод, но код у него свой");
  assert.equal(volumeAltKey({ key: "a", code: "KeyA" }), false);
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
  // По дальности выкладываются **только** ярусы вне дерева порядка: плита,
  // полы и потолки. Ярус тел с таска 151 выкладывает дерево, и дальность
  // середины там ничего не решает — это и есть лекарство от D32 и D33.
  //
  // Дальность сравнивается **внутри яруса**, а не поперёк них: ярусы идут
  // своим порядком (земля под полом всегда, как бы далеко ни лежал её
  // середина), и мерить их одной линейкой нельзя.
  for (const layer of [VOLUME_LAYER_BASE, VOLUME_LAYER_GROUND]) {
    const part = frame.slice(0, firstBody).filter((polygon) => polygon.layer === layer);
    for (let index = 1; index < part.length; index += 1) {
      assert.ok(part[index - 1].depth >= part[index].depth - 1e-9, "порядок по дальности сбился");
    }
  }
});

// ——— порядок граней: D32 (таск 150) и D33 (таск 151) ————————————————————
//
// D32 — «иногда бывает что стены просвечивают, при определённом повороте»:
// порядок решала средняя дальность грани, а перекрытие в кадре решает
// дальность в пикселе. Таск 150 лечил это ломтями глубины; заказчик увидел
// цену — D33, «на границах и углах появились треугольные артефакты»: ошибка
// измельчала до шага ломтя, но стала видна на каждом кадре, а у разрезанной
// грани появились швы.
//
// Таск 151 убрал обе разом: порядок выкладывает дерево разбиения
// (`volumeOrderTree`), и он верен в каждом пикселе, а не «с точностью до шага».

test("грань делится плоскостью начисто: площадь сходится, поля сохраняются", () => {
  const area = (points) => {
    let sum = 0;
    for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
      sum += points[j].x * points[i].y - points[i].x * points[j].y;
    }
    return Math.abs(sum) / 2;
  };
  const quad = {
    p: [
      { x: -100, y: -100, z: 0 },
      { x: 300, y: -100, z: 0 },
      { x: 300, y: 100, z: 0 },
      { x: -100, y: 100, z: 0 },
    ],
    n: { x: 0, y: 0, z: 1 },
    rgb: VOLUME_WALL_RGB,
    layer: VOLUME_LAYER_BODY,
    markId: "вещь",
    doorId: "дверь",
  };
  const plane = { x: 1, y: 0, z: 0, d: 0 };
  assert.equal(volumeFaceSide(plane, quad), 2, "плоскость грань пересекает");
  const cut = volumeSplitFace(quad, plane);
  assert.ok(cut.front && cut.back, "вышли обе половины");
  assert.ok(Math.abs(area(quad.p) - area(cut.front.p) - area(cut.back.p)) < 1e-6, "площадь не потерялась");
  assert.ok(cut.front.p.every((point) => point.x >= -1e-9), "перед плоскостью — только перед");
  assert.ok(cut.back.p.every((point) => point.x <= 1e-9), "за плоскостью — только за");
  for (const half of [cut.front, cut.back]) {
    assert.equal(half.markId, "вещь", "хозяин половины — та же метка: иначе клик перестанет в неё попадать");
    assert.equal(half.doorId, "дверь");
    assert.equal(half.rgb, VOLUME_WALL_RGB);
    assert.deepEqual(half.n, quad.n, "нормаль у половины та же — светлота не меняется");
  }
  // Грань, плоскости не касающаяся, не режется вовсе: лишних граней в сцене
  // дерево не заводит.
  const far = { ...quad, p: quad.p.map((point) => ({ ...point, x: point.x + 1000 })) };
  assert.equal(volumeFaceSide(plane, far), 1);
  assert.equal(volumeSplitFace(far, plane).front, far, "грань вернулась собой, а не копией");
  assert.equal(volumeSplitFace(far, plane).back, null);
  // Грань в самой плоскости — ни перед, ни за: такие лежат в узле.
  assert.equal(volumeFaceSide({ x: 0, y: 0, z: 1, d: 0 }, quad), 0);
  // Отступ, внутри которого точка считается лежащей на плоскости, заведомо
  // меньше того, на что в сцене отодвигают нарочно (вещь от стены — 2 мм).
  assert.ok(VOLUME_PLANE_EPS_MM < VOLUME_MARK_LIFT_MM / 10);
});

test("дерево порядка выкладывает грани от дальней к ближней с любой стороны", () => {
  // Две стенки поперёк взгляда: одна в метре, другая в трёх.
  const wall = (atX, id) => ({
    p: [
      { x: atX, y: -500, z: 0 },
      { x: atX, y: 500, z: 0 },
      { x: atX, y: 500, z: 1000 },
      { x: atX, y: -500, z: 1000 },
    ],
    n: { x: -1, y: 0, z: 0 },
    rgb: VOLUME_WALL_RGB,
    layer: VOLUME_LAYER_BODY,
    markId: id,
  });
  const near = wall(1000, "ближняя");
  const far = wall(3000, "дальняя");
  const tree = volumeOrderTree([near, far]);
  const fromLeft = volumeOrderWalk(tree, { x: 0, y: 0, z: 500 }).map((face) => face.markId);
  assert.deepEqual(fromLeft, ["дальняя", "ближняя"], "смотрим слева — дальняя рисуется первой");
  const fromRight = volumeOrderWalk(tree, { x: 5000, y: 0, z: 500 }).map((face) => face.markId);
  assert.deepEqual(fromRight, ["ближняя", "дальняя"], "обошли кругом — порядок перевернулся сам");
  // Линии в дереве не лежат: им считают место по середине. Точка между
  // стенками встаёт после дальней и до ближней — с одной стороны и с другой.
  assert.equal(volumeOrderRank(tree, { x: 0, y: 0, z: 500 }, { x: 2000, y: 0, z: 500 }), 1);
  assert.equal(volumeOrderRank(tree, { x: 5000, y: 0, z: 500 }, { x: 2000, y: 0, z: 500 }), 1);
  // Грань, которую плоскость соседа пересекает, дерево режет — и считает
  // половины врозь. Это единственный рез, который в сборке остался.
  const across = {
    p: [
      { x: 0, y: 0, z: 0 },
      { x: 5000, y: 0, z: 0 },
      { x: 5000, y: 0, z: 1000 },
      { x: 0, y: 0, z: 1000 },
    ],
    n: { x: 0, y: -1, z: 0 },
    rgb: VOLUME_WALL_RGB,
    layer: VOLUME_LAYER_BODY,
    markId: "поперёк",
  };
  const mixed = volumeOrderWalk(volumeOrderTree([near, far, across]), { x: 0, y: -2000, z: 500 });
  assert.equal(mixed.filter((face) => face.markId === "поперёк").length, 3, "поперечная грань разрезана обеими стенками");
  // Пол и потолок в дерево не попадают: у них свой ярус.
  const floor = { ...across, layer: VOLUME_LAYER_GROUND };
  assert.equal(volumeOrderWalk(volumeOrderTree([floor]), { x: 0, y: 0, z: 0 }).length, 0);
});

test("порядок кадра совпадает с истиной в каждом пикселе", () => {
  // Самая честная проверка, какую можно написать: кадр против луча. Для сетки
  // точек поля считается, какая поверхность в этой точке **на самом деле**
  // ближе всех, и сверяется с тем, чем точка закрашена. Разойдись они — это и
  // есть «стена просвечивает» (D32) или клин на стыке (D33).
  const base = planProject();
  let project = ensureSchemeObjectKinds(base.project).project;
  const kind = schemeObjectKindsInOrder(project)[0];
  // Вещь, уходящая от камеры вдаль, — тот самый случай, на котором «художник»
  // врал: её бок тянется с метра на пять.
  project = addSchemeObject(project, {
    schemeId: base.schemeId,
    kindId: kind.id,
    shape: "rect",
    atMm: { x: 3000, y: -500 },
    widthMm: 4000,
    depthMm: 500,
    heightMm: 2200,
    heightAboveFloorMm: 0,
  }).project;
  project = addWall(project, {
    schemeId: base.schemeId,
    aMm: { x: 2050, y: -3000 },
    bMm: { x: 2050, y: 3000 },
    thicknessMm: 100,
  }).project;
  project = addWall(project, {
    schemeId: base.schemeId,
    aMm: { x: -2000, y: 1200 },
    bMm: { x: 6000, y: 1600 },
    thicknessMm: 150,
  }).project;
  const built = volumeScene(project, base.schemeId);
  const box = { width: 320, height: 200 };
  const inside = (points, point, axis) => {
    const u = axis === 0 ? "y" : "x";
    const v = axis === 2 ? "y" : "z";
    let hit = false;
    for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
      const ax = points[i][u], ay = points[i][v], bx = points[j][u], by = points[j][v];
      if (ay > point[v] !== by > point[v] && point[u] < ((bx - ax) * (point[v] - ay)) / (by - ay) + ax) hit = !hit;
    }
    return hit;
  };
  const hit2 = (xy, x, y) => {
    let got = false;
    for (let i = 0, j = xy.length - 2; i < xy.length; j = i, i += 2) {
      const ax = xy[i], ay = xy[i + 1], bx = xy[j], by = xy[j + 1];
      if (ay > y !== by > y && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) got = !got;
    }
    return got;
  };
  let samples = 0;
  const wrong = [];
  for (const yaw of [0, 0.5, -0.9, 2.2]) {
    const camera = { at: { x: 0, y: 0, z: VOLUME_EYE_MM }, yaw, pitch: -0.15 };
    const frame = volumeFrame(built, camera, box);
    const basis = volumeBasis(camera);
    const focal = volumeFocal(box);
    for (let py = 2; py < box.height; py += 7) {
      for (let px = 2; px < box.width; px += 7) {
        const cx = (px - box.width / 2) / focal;
        const cy = -(py - box.height / 2) / focal;
        const dir = {
          x: basis.right.x * cx + basis.up.x * cy + basis.fwd.x,
          y: basis.right.y * cx + basis.up.y * cy + basis.fwd.y,
          z: basis.right.z * cx + basis.up.z * cy + basis.fwd.z,
        };
        // Истина: ближайшая лицевая грань на луче.
        let truth = null;
        for (const face of built.faces) {
          if (face.line) continue;
          let normal = face.n;
          let facing =
            normal.x * (camera.at.x - face.p[0].x) +
            normal.y * (camera.at.y - face.p[0].y) +
            normal.z * (camera.at.z - face.p[0].z);
          if (face.both && facing < 0) {
            normal = { x: -normal.x, y: -normal.y, z: -normal.z };
            facing = -facing;
          }
          if (facing <= 0) continue;
          const denom = face.n.x * dir.x + face.n.y * dir.y + face.n.z * dir.z;
          if (!(Math.abs(denom) > 1e-12)) continue;
          const d = face.n.x * face.p[0].x + face.n.y * face.p[0].y + face.n.z * face.p[0].z;
          const t = (d - (face.n.x * camera.at.x + face.n.y * camera.at.y + face.n.z * camera.at.z)) / denom;
          if (!(t >= VOLUME_NEAR_MM)) continue;
          if (truth && t >= truth.t - 1e-6) continue;
          const at = { x: camera.at.x + dir.x * t, y: camera.at.y + dir.y * t, z: camera.at.z + dir.z * t };
          const axis =
            Math.abs(face.n.x) >= Math.abs(face.n.y) && Math.abs(face.n.x) >= Math.abs(face.n.z)
              ? 0
              : Math.abs(face.n.y) >= Math.abs(face.n.z)
                ? 1
                : 2;
          if (!inside(face.p, at, axis)) continue;
          // Прозрачность — часть цвета (таск 169), и стенд сверяет её вместе с
          // ним: грань вещи обязана быть нарисована прозрачной, а грань стены —
          // непрозрачной, иначе точка закрашена не той поверхностью.
          truth = { t, fill: volumeFill(face.rgb, volumeShade(normal), face.clear ? VOLUME_CLEAR_ALPHA : 1) };
        }
        // Что нарисовано: последний накрывший точку многоугольник.
        let painted = null;
        for (const polygon of frame) {
          if (polygon.stroke) continue;
          if (hit2(polygon.xy, px, py)) painted = polygon;
        }
        if (!truth || !painted) continue;
        samples += 1;
        if (painted.fill !== truth.fill) wrong.push({ yaw, px, py, want: truth.fill, got: painted.fill });
      }
    }
  }
  assert.ok(samples > 2000, "стенд обязан быть плотным: точек " + samples);
  assert.deepEqual(wrong.slice(0, 4), [], "в этих точках нарисована не та поверхность, которая ближе");
});

test("дальняя стена больше не рисуется поверх ближней вещи (D32)", () => {
  // Стенд — тот самый случай, на котором «художник» врёт. Ближняя вещь уходит
  // от камеры вдаль: её бок тянется с метра на пять, а серединой сидит на
  // трёх — дальше стены, стоящей поперёк взгляда в двух метрах. По средним
  // дальностям стена рисуется второй и закрашивает собой ту часть вещи, что
  // лежит к камере ближе неё. Это и видно на снимке заказчика.
  const base = planProject();
  let project = ensureSchemeObjectKinds(base.project).project;
  const kind = schemeObjectKindsInOrder(project)[0];
  project = addSchemeObject(project, {
    schemeId: base.schemeId,
    kindId: kind.id,
    shape: "rect",
    atMm: { x: 3000, y: -500 },
    widthMm: 4000,
    depthMm: 500,
    heightMm: 2200,
    heightAboveFloorMm: 0,
  }).project;
  project = addWall(project, {
    schemeId: base.schemeId,
    aMm: { x: 2050, y: -3000 },
    bMm: { x: 2050, y: 3000 },
    thicknessMm: 100,
  }).project;
  const built = volumeScene(project, base.schemeId);
  const box = { width: 1432, height: 580 };
  const camera = { at: { x: 0, y: 0, z: VOLUME_EYE_MM }, yaw: 0, pitch: 0 };
  const frame = volumeFrame(built, camera, box);
  const focal = volumeFocal(box);
  // Точка кадра, в которой бок вещи стоит в полутора метрах от камеры: его
  // плоскость y = −250 видна под долей −250/1500 от фокуса. Стена в этой точке
  // лежит на двух метрах, то есть за вещью.
  const px = box.width / 2 - (focal * 250) / 1500;
  const py = box.height / 2 + 60;
  const inside = (xy) => {
    let hit = false;
    for (let i = 0, j = xy.length - 2; i < xy.length; j = i, i += 2) {
      const ax = xy[i];
      const ay = xy[i + 1];
      const bx = xy[j];
      const by = xy[j + 1];
      if (ay > py !== by > py && px < ((bx - ax) * (py - ay)) / (by - ay) + ax) hit = !hit;
    }
    return hit;
  };
  const here = frame.filter((polygon) => !polygon.stroke && inside(polygon.xy));
  const wallFill = volumeFill(VOLUME_WALL_RGB, volumeShade({ x: -1, y: 0, z: 0 }));
  const sideFill = volumeFill(VOLUME_OBJECT_RGB, volumeShade({ x: 0, y: 1, z: 0 }), VOLUME_CLEAR_ALPHA);
  assert.ok(
    here.some((polygon) => polygon.fill === wallFill) && here.some((polygon) => polygon.fill === sideFill),
    "в этой точке спорят бок вещи и дальняя стена — иначе стенд ничего не проверяет",
  );
  const last = here[here.length - 1];
  assert.equal(last.fill, sideFill, "последним нарисован бок ближней вещи, а не стена за ней");
  // Чинит это дерево порядка (таск 151): бок вещи разрезан **плоскостью той
  // самой стены**, из-за которой шёл спор, и кусок, видимый в этой точке,
  // честно лежит ближе неё. Рез при этом один — по настоящей геометрии, а не
  // пять по сетке дальностей, как давали ломти таска 150.
  const wallHere = here.find((polygon) => polygon.fill === wallFill);
  assert.ok(
    last.depth < wallHere.depth,
    "видимый кусок бока ближе стены: " + Math.round(last.depth) + " против " + Math.round(wallHere.depth),
  );
  assert.equal(frame.filter((polygon) => polygon.fill === sideFill).length, 2, "бок разрезан надвое, а не на ломти");
});

test("у призмы нормали смотрят наружу: видна ближняя сторона шкафа, а не его задник", () => {
  // Дефект, найденный замером D32 (таск 150): обход приводился к обратному, и
  // у всякой призмы — вещи чертежа, тела метки — боковые нормали смотрели
  // внутрь. Ближняя сторона отсекалась как отвёрнутая, и вместо неё рисовалась
  // дальняя. Плит пола и потолка это не касалось: у них нормаль задана прямо, —
  // поэтому и тестами не ловилось.
  const scene = roomScene();
  const kinds = ensureSchemeObjectKinds(scene.project);
  let project = kinds.project;
  project = addSchemeObject(project, {
    schemeId: scene.schemeId,
    kindId: schemeObjectKindsInOrder(project)[0].id,
    shape: "rect",
    atMm: { x: 0, y: -800 },
    widthMm: 1200,
    depthMm: 400,
    heightMm: 2000,
    heightAboveFloorMm: 0,
  }).project;
  const built = volumeScene(project, scene.schemeId);
  const sides = built.faces.filter((face) => face.rgb === VOLUME_OBJECT_RGB && face.n.z === 0);
  for (const face of sides) {
    const middle = {
      x: face.p.reduce((sum, point) => sum + point.x, 0) / face.p.length,
      y: face.p.reduce((sum, point) => sum + point.y, 0) / face.p.length,
    };
    // Наружу — значит от середины вещи (она стоит в x = 0, y = −800).
    const away = (middle.x - 0) * face.n.x + (middle.y + 800) * face.n.y;
    assert.ok(away > 0, "нормаль смотрит от вещи, а не в неё: " + JSON.stringify(face.n));
  }
  // И то же самое в кадре: стоя перед вещью, видим её ближнюю сторону.
  const box = { width: 900, height: 600 };
  const camera = { at: { x: 0, y: 0, z: VOLUME_EYE_MM }, yaw: -Math.PI / 2, pitch: 0 };
  const frame = volumeFrame(built, camera, box);
  const faceFill = volumeFill(VOLUME_OBJECT_RGB, volumeShade({ x: 0, y: 1, z: 0 }), VOLUME_CLEAR_ALPHA);
  const backFill = volumeFill(VOLUME_OBJECT_RGB, volumeShade({ x: 0, y: -1, z: 0 }), VOLUME_CLEAR_ALPHA);
  assert.ok(frame.some((polygon) => polygon.fill === faceFill), "ближняя сторона в кадре есть");
  assert.ok(!frame.some((polygon) => polygon.fill === backFill), "а дальней в нём нет");
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

// ——— фон: настоящая панорама (G208, таск 150) ——————————————————————————
//
// «при повороте от 1 лица дом крутится, а фон нет, как будто сам дом вращается
// на местности — не хорошо… Ну и вращаться в след за поворотом, то есть как
// реальный фон».

test("горизонт не зависит от рысканья — и это теперь следствие, а не упрощение", () => {
  const box = { width: 1200, height: 700 };
  const level = volumeHorizon({ yaw: 0, pitch: 0 }, box);
  assert.equal(level, box.height / 2, "на ровном взгляде горизонт посередине");
  for (const yaw of [0, 1, 2, 3]) {
    assert.equal(volumeHorizon({ yaw, pitch: 0.3 }, box), volumeHorizon({ yaw: 0, pitch: 0.3 }, box));
  }
  // Опустили взгляд — горизонт поднялся, и поле ушло вниз.
  assert.ok(volumeHorizon({ yaw: 0, pitch: -0.5 }, box) < level);
  assert.ok(volumeHorizon({ yaw: 0, pitch: 0.5 }, box) > level);
  // Главное: точка панорамы с нулевой высотой над горизонтом ложится **ровно**
  // на эту строку при любой стороне света. Разойдись эти два счёта — деревья
  // стояли бы не на горизонте, а над ним или под ним.
  for (const pitch of [-0.4, -0.17, 0, 0.3]) {
    const camera = { at: { x: 0, y: 0, z: 1600 }, yaw: 0.7, pitch };
    const aim = volumeSkyAim(camera, box);
    const line = volumeHorizon(camera, box);
    for (const away of [-30, -10, 0, 12, 35]) {
      const at = volumeSkyPoint(aim, 0.7 * 180 / Math.PI + away, 0);
      assert.ok(at, "направление в поле зрения");
      assert.ok(Math.abs(at.y - line) < 1e-6, "горизонт панорамы и volumeHorizon — одно число");
    }
  }
});

test("фон вращается вслед за поворотом, а небо при наклоне едет вместе со всем кадром", () => {
  const box = { width: 1200, height: 700 };
  const aim = (yaw, pitch) => volumeSkyAim({ at: { x: 0, y: 0, z: 1600 }, yaw, pitch }, box);
  // Вещь, стоящая прямо по курсу, стоит в середине поля — при любом курсе.
  for (const yaw of [0, 1.2, 3.4, 5.9]) {
    const at = volumeSkyPoint(aim(yaw, 0), (yaw * 180) / Math.PI, 0);
    assert.ok(Math.abs(at.x - box.width / 2) < 1e-6, "по курсу — середина поля");
  }
  // Повернули голову на 20° — вещь уехала в ту же сторону и ровно настолько же.
  const straight = volumeSkyPoint(aim(0, 0), 0, 0);
  const turned = volumeSkyPoint(aim((20 * Math.PI) / 180, 0), 0, 0);
  assert.ok(turned.x < straight.x - 100, "фон едет за поворотом, а не стоит на месте кадра");
  assert.ok(Math.abs(turned.y - straight.y) < 1e-6, "по вертикали при чистом повороте он не дёргается");
  // Наклонили взгляд вниз — солнце ушло вверх ровно так же, как ушёл горизонт:
  // никакого собственного хода у неба нет (это и значит «статичны»).
  const flatSun = volumeSkyPoint(aim(0, 0), 0, 14);
  const downSun = volumeSkyPoint(aim(0, -0.2), 0, 14);
  const flatLine = volumeHorizon({ yaw: 0, pitch: 0 }, box);
  const downLine = volumeHorizon({ yaw: 0, pitch: -0.2 }, box);
  assert.ok(
    Math.abs((downSun.y - downLine) / (flatSun.y - flatLine) - 1) < 0.2,
    "солнце держится горизонта, а не долей высоты неба: " + (downSun.y - downLine) + " против " + (flatSun.y - flatLine),
  );
  // За спиной вещи нет вовсе: делить на нуль и рисовать её наизнанку нельзя.
  assert.equal(volumeSkyPoint(aim(0, 0), 180, 0), null);
});

// ——— дорога, река и небольшой ландшафт (G231, G232, таск 157) ——————————————
//
// «И дорисуй фон, нарисуй там гдже-нибудь дорогу и речку. Чуть оживить» и «И
// небольшой ландшафт сделай на фоне, а у реки кусты и деревья по берегам».
//
// Дорога и река — вещи той же панорамы, но не точки, а полосы: вереница узлов,
// у каждого сторона света и две высоты. Поэтому проверяется здесь, что «уходит
// вдаль» лежит **в числах**, а не в приёме рисования, и что ближний край не
// подползает человеку под ноги.

test("полоса уходит вдаль числами: высота, толщина и изгиб", () => {
  for (const [name, band] of [
    ["дорога", VOLUME_ROAD],
    ["река", VOLUME_RIVER],
  ]) {
    const middles = band.map((node) => (node.top + node.bottom) / 2);
    const thick = band.map((node) => node.top - node.bottom);
    for (let index = 1; index < band.length; index += 1) {
      assert.ok(middles[index] > middles[index - 1], name + ": колено не поднялось к горизонту");
      assert.ok(thick[index] < thick[index - 1], name + ": дальнее колено не сузилось");
    }
    assert.ok(middles[0] < -6, name + ": ближний конец должен быть низко, иначе полоса не уходит, а лежит");
    assert.ok(Math.abs(middles[middles.length - 1]) < 0.3, name + ": дальний конец не пришёл к горизонту");
    // Изгиб: шаги по стороне света неравные — прямая дорога в панораме и
    // обязана быть кривой.
    const steps = band.slice(1).map((node, index) => node.az - band[index].az);
    assert.ok(Math.max(...steps) - Math.min(...steps) > 1, name + ": полоса идёт ровными шагами, то есть не гнётся");
  }
});

test("фон разведён с домом: полосы не подползают к ногам", () => {
  // Самое низкое место полосы — около десяти градусов под горизонтом: при
  // росте глаз это метров десять от человека. Ближе — и дорога полезла бы в
  // окно, а дорога под окном хуже, чем её отсутствие.
  for (const band of [VOLUME_ROAD, VOLUME_RIVER]) {
    const lowest = Math.min(...band.map((node) => node.bottom));
    assert.ok(lowest > -10, "полоса подошла слишком близко: " + lowest);
    assert.ok(lowest < -8, "полоса висит у горизонта и не читается как уходящая: " + lowest);
  }
  // Дорога и река разведены по стороне света: в одно окно попадает что-то
  // одно, перекрестием они не сходятся.
  const roadAz = VOLUME_ROAD.map((node) => node.az);
  const riverAz = VOLUME_RIVER.map((node) => node.az);
  assert.ok(Math.min(...riverAz) - Math.max(...roadAz.filter((az) => az < 100)) > 60, "дорога и река рядом");
});

test("ландшафт небольшой: гряды у горизонта, а не горы над домом", () => {
  assert.equal(VOLUME_HILLS.length, 2, "две гряды: дальняя сквозь воздух, ближняя своим цветом");
  const tops = VOLUME_HILLS.flatMap((ridge) => ridge.nodes.map((node) => node.top));
  assert.ok(Math.max(...tops) <= 2.6, "гряда выше «небольшого»: " + Math.max(...tops));
  assert.ok(Math.max(...tops) > 1, "гряда ниже заметного — ландшафта не видно");
  // Ближняя гряда ниже дальней: иначе дальнюю не было бы видно вовсе.
  const high = (ridge) => Math.max(...ridge.nodes.map((node) => node.top));
  assert.ok(high(VOLUME_HILLS[0]) > high(VOLUME_HILLS[1]));
  for (const ridge of VOLUME_HILLS) {
    for (const node of ridge.nodes) assert.ok(node.bottom < 0, "низ гряды обязан уйти под горизонт, иначе на стыке щель");
  }
  // Для меры: ближнее дерево панорамы — девятнадцать градусов, то есть холмы
  // ровно фон.
  assert.ok(Math.max(...tops) * 5 < 19);
});

test("зелень стоит по обоим берегам реки и считается из самой реки", () => {
  const greens = volumeRiverGreens(VOLUME_RIVER);
  assert.deepEqual(greens, VOLUME_RIVER_GREENS, "список собран из узлов реки, а не выписан второй таблицей");
  assert.ok(greens.length >= 10 && greens.length <= 16, "мера «чуть»: " + greens.length);
  const near = VOLUME_RIVER[0];
  const atNear = greens.filter((green) => Math.abs(green.az - near.az) < 6);
  assert.ok(
    atNear.some((green) => green.rise < near.bottom) && atNear.some((green) => green.rise > near.top),
    "у ближнего колена обжиты оба берега",
  );
  // Ближе к воде гуще: у ближних колен зелени больше, чем у дальних.
  const far = VOLUME_RIVER[4];
  assert.ok(atNear.length > greens.filter((green) => Math.abs(green.az - far.az) < 6).length);
  // И дальняя зелень мельче ближней — это та же перспектива, что у полосы.
  const sizeAt = (node) => Math.max(...greens.filter((green) => Math.abs(green.az - node.az) < 6).map((g) => g.size));
  assert.ok(sizeAt(near) > sizeAt(far) * 3);
  // На самых дальних коленах зелени нет вовсе: там она выродилась бы в точку.
  const tail = VOLUME_RIVER[VOLUME_RIVER.length - 1];
  assert.equal(greens.filter((green) => Math.abs(green.az - tail.az) < 3).length, 0);
});

test("горы стоят напротив солнца и дальше всего, а шапки у них светлее камня", () => {
  // «Напротив солнца» — буквально: сторона света берётся у солнца и
  // поворачивается на половину оборота. Подвинется солнце — уедут и горы.
  const away = (VOLUME_SUN_AT.az + 180) % 360;
  for (const peak of VOLUME_MOUNTAINS) {
    const turn = Math.abs(((peak.az - away + 540) % 360) - 180);
    assert.ok(turn < 35, "вершина ушла от стороны, противоположной солнцу: " + turn);
    // Гряда выше ландшафта, но втрое ниже ближнего дерева панорамы — дальний
    // план, а не стена над домом.
    assert.ok(peak.size > 2.6 && peak.size < 8, "мера вершины: " + peak.size);
    assert.ok(peak.snow > 0.2 && peak.snow < 0.5, "шапка на всю гору или её нет вовсе: " + peak.snow);
    assert.ok(peak.half > peak.size, "подножие уже вершины — это игла, а не гора");
  }
  assert.ok(VOLUME_MOUNTAINS.length >= 5, "гряда, а не одна вершина");
  // Пики перекрывают друг друга: у соседей подножия заходят одно на другое.
  // Считается по сдвигу от середины гряды, а не по самой стороне света: она
  // переходит через нуль, и соседи 358° и 4° числами далеки друг от друга.
  const offset = (peak) => ((peak.az - away + 540) % 360) - 180;
  const sorted = [...VOLUME_MOUNTAINS].sort((a, b) => offset(a) - offset(b));
  for (let index = 1; index < sorted.length; index += 1) {
    const gap = offset(sorted[index]) - offset(sorted[index - 1]);
    assert.ok(gap < sorted[index].half + sorted[index - 1].half, "вершины не перекрываются: " + gap);
  }
  // Снег светлее камня, а камень — не чернота: склон к зрителю в тени, но
  // различим.
  const light = (hex) => parseInt(hex.slice(1, 3), 16) + parseInt(hex.slice(3, 5), 16) + parseInt(hex.slice(5, 7), 16);
  for (const peak of VOLUME_MOUNTAINS) {
    assert.ok(light(peak.snowColor) > light(peak.rock) + 120, "шапка не светлее камня");
    assert.ok(light(peak.rock) > 330, "камень ушёл в черноту: " + peak.rock);
  }
  // И гряда дальше ландшафта: холмы ниже самой низкой вершины.
  const hills = Math.max(...VOLUME_HILLS.flatMap((ridge) => ridge.nodes.map((node) => node.top)));
  assert.ok(hills < Math.min(...VOLUME_MOUNTAINS.map((peak) => peak.size)));
});

test("земля у дома и земля за ним — один тон (G237)", () => {
  // Плита чертежа — это земля вокруг дома, когда помещения обведены: свой пол
  // у них есть, и красить плиту полом значит класть дом на доску.
  const scene = roomScene();
  const built = volumeScene(scene.project, scene.schemeId);
  const base = built.faces.find((face) => face.layer === VOLUME_LAYER_BASE);
  assert.deepEqual(base.rgb, VOLUME_LAND_RGB);
  assert.equal(base.flat, true, "землю не затеняет лампа сцены — иначе она вдвое темнее поля панорамы");
  const painted = volumeFrame(built, volumeAroundCamera({ x: 0, y: 0, z: 0 }, 0.6, -0.5, 12000), {
    width: 1200,
    height: 700,
  });
  const ground = painted.find((polygon) => polygon.layer === VOLUME_LAYER_BASE);
  assert.equal(ground.fill, "rgb(" + VOLUME_LAND_RGB.join(",") + ")", "тон земли на экране — тот же, что у поля");
  // Помещений нет — плита снова пол, и цвет у неё половой.
  const empty = roomScene({ room: false });
  const bare = volumeScene(empty.project, empty.schemeId);
  const bareBase = bare.faces.find((face) => face.layer === VOLUME_LAYER_BASE);
  assert.deepEqual(bareBase.rgb, VOLUME_FLOOR_RGB);
  assert.equal(bareBase.flat, false);
});

test("полоса рвётся за спиной и не склеивается через край кадра", () => {
  const box = { width: 1200, height: 700 };
  const aim = volumeSkyAim({ at: { x: 0, y: 0, z: 1600 }, yaw: 0, pitch: 0 }, box);
  // Три узла впереди — один прогон; узел за спиной между ними рвёт полосу.
  const ahead = [
    { az: -10, top: -1, bottom: -2 },
    { az: 0, top: -1, bottom: -2 },
    { az: 10, top: -1, bottom: -2 },
  ];
  assert.equal(volumeStripRuns(aim, ahead).length, 1);
  assert.equal(volumeStripRuns(aim, ahead)[0].length, 3);
  const broken = [ahead[0], { az: 180, top: -1, bottom: -2 }, ahead[2]];
  assert.equal(volumeStripRuns(aim, broken).length, 0, "одинокие узлы — не полоса");
  const twoRuns = [ahead[0], ahead[1], { az: 180, top: -1, bottom: -2 }, ahead[2], { az: 20, top: -1, bottom: -2 }];
  assert.equal(volumeStripRuns(aim, twoRuns).length, 2);
});

test("фон рисует дорогу, реку, гряды и зелень — и цена кадра остаётся фоновой", () => {
  const box = { x: 0, y: 0, width: 1280, height: 720 };
  const ops = { fill: 0, arc: 0, rect: 0, fade: 0 };
  const fade = { addColorStop: () => {} };
  const ctx = {
    createLinearGradient: () => (ops.fade += 1, fade),
    beginPath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    closePath: () => {},
    fill: () => (ops.fill += 1),
    fillRect: () => (ops.rect += 1),
    arc: () => (ops.arc += 1),
    ellipse: () => (ops.arc += 1),
    save: () => {},
    restore: () => {},
    fillStyle: "",
  };
  const at = { x: 0, y: 0, z: 1600 };
  // Два ракурса: на дорогу (северо-запад) и на реку (юго-восток). Полоса,
  // оказавшаяся за спиной, не рисуется вовсе — и это видно по счёту растяжек.
  const line = volumeDrawBackdrop(ctx, box, { at, yaw: (320 * Math.PI) / 180, pitch: -0.08 });
  assert.ok(Number.isFinite(line), "строка горизонта по-прежнему возвращается");
  // Небо и растяжка дороги: земля залита плоским тоном (G237), а вода за
  // спиной своей растяжки не просит.
  assert.equal(ops.fade, 2, "растяжек не столько, сколько полос в кадре: " + ops.fade);
  const roadFills = ops.fill;
  volumeDrawBackdrop(ctx, box, { at, yaw: (150 * Math.PI) / 180, pitch: -0.08 });
  assert.equal(ops.fade, 4, "у реки своя растяжка: " + ops.fade);
  assert.ok(ops.fill - roadFills > 10, "река и зелень по берегам не нарисованы");
  assert.ok(roadFills > 8, "дорога и гряды не нарисованы: " + roadFills);
  // Сторож цены: фон — это фон. Кадр сцены в таске 146 стоил 0,1 мс на 650
  // гранях, и фону нельзя разрастаться до его доли незаметно. Счёт здесь за
  // два кадра, поэтому и мера вдвое.
  const total = ops.fill + ops.arc + ops.rect + ops.fade;
  assert.ok(total < 560, "фон разросся: операций холста на два кадра " + total);
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
  // Своим цветом рисуются колонна (одно тело во весь габарит) и фасад
  // столешницы: по пять граней — четыре боковины и верх, низ лежит на полу.
  // Светлая плита столешницы — второе тело её модели (таск 155), и цвет у неё
  // материальный, от того же цвета вещи.
  const object = built.faces.filter((face) => face.rgb[0] === VOLUME_OBJECT_RGB[0]);
  assert.equal(object.length, 10);
  const slab = built.faces.filter((face) => face.rgb[0] === volumeModelRgb("light", VOLUME_OBJECT_RGB)[0]);
  assert.equal(slab.length, 6, "плита столешницы — отдельное тело, с низом: она лежит на фасаде");
  const top = Math.max(...object.flatMap((face) => face.p.map((point) => point.z)));
  assert.equal(top, 3100, "колонна встала во всю высоту комнаты, а не в выдуманную");
  const counterTop = Math.max(...slab.flatMap((face) => face.p.map((point) => point.z)));
  assert.equal(counterTop, 900, "верх столешницы — та высота, от которой отмеряют розетки над ней");
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
  assert.deepEqual(volumeHeightMm(bare, "нет", null), { mm: WALL_HEIGHT_FALLBACK_MM, known: false });
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

// ——— карта возится двумя пальцами (таск 174, G256) ————————————————————————
//
// Проверяется не «есть сдвиг», а **сходимость двух счётов**: перенос считает
// `volumeAroundPan`, а куда смотрит пиксель — рисовальщик (`volumeFloorAt`,
// тот же луч, которым переносят человека кликом). Разойдись они — карта поедет
// не за пальцем, а мимо, и глазом это видно только на живой странице.

// Поле и цель **на полу** (`z` ноль): луч `volumeFloorAt` упирается в ту же
// плоскость, на которой стоит цель, и сходимость можно требовать числом.
const panBox = { width: 1200, height: 700 };
const panLen = (step) => Math.hypot(step.dx, step.dy);
const panSlip = (view, panX, panY) => {
  const centre = { x: panBox.width / 2, y: panBox.height / 2 };
  const camera = volumeAroundCamera({ x: 0, y: 0, z: 0 }, view.yaw, view.pitch, view.distance);
  const before = volumeFloorAt(camera, panBox, centre.x, centre.y);
  const moved = volumeAroundPan(view, panBox, panX, panY);
  const next = volumeAroundCamera({ x: moved.dx, y: moved.dy, z: 0 }, view.yaw, view.pitch, view.distance);
  const after = volumeFloorAt(next, panBox, centre.x + panX, centre.y + panY);
  assert.ok(before && after, "луч в пол упирается с обоих концов жеста");
  const step = Math.hypot(moved.dx, moved.dy);
  return { step, slip: Math.hypot(after.x - before.x, after.y - before.y), moved };
};

test("два пальца в обзоре: пол остаётся под серединой между пальцами", () => {
  // Отвесный взгляд: середина уехала вправо и вверх — та точка пола, что была
  // под пальцами, под ними и осталась.
  const steep = panSlip({ yaw: 0.7, pitch: (-80 * Math.PI) / 180, distance: 12000 }, 60, -40);
  assert.ok(steep.step > 1000, "жест на шесть десятков точек с двенадцати метров возит метрами: " + Math.round(steep.step));
  assert.ok(steep.slip < steep.step * 0.03, "пол уехал из-под пальцев на " + Math.round(steep.slip) + " мм из " + Math.round(steep.step));
  // Наклон по умолчанию (−42°) — то же самое, и обе оси сразу.
  const tilted = panSlip({ yaw: -1.1, pitch: (-42 * Math.PI) / 180, distance: 20000 }, 6, 4);
  assert.ok(tilted.slip < tilted.step * 0.03, "при наклоне пол уехал на " + Math.round(tilted.slip) + " мм из " + Math.round(tilted.step));
  // Мелкий ход — сходимость точная: вся разница это перспектива на длинном
  // махе, а не кривой счёт.
  const small = panSlip({ yaw: 0.3, pitch: (-55 * Math.PI) / 180, distance: 9000 }, 3, -2);
  assert.ok(small.slip < small.step * 0.01, "мелкий ход разошёлся: " + small.slip.toFixed(1) + " мм из " + small.step.toFixed(1));
});

test("палец везёт карту, а не камеру: сдвиг идёт в обратную сторону", () => {
  // Рысканье ноль — экранное «вправо» это +y плана, «вверх» это +x.
  const view = { yaw: 0, pitch: -Math.PI / 2, distance: 10000 };
  const right = volumeAroundPan(view, panBox, 100, 0);
  assert.ok(right.dy < 0, "палец вправо — карта вправо, камера влево: " + right.dy);
  assert.ok(Math.abs(right.dx) < 1e-6, "поперёк взгляда чистое поперёк");
  const up = volumeAroundPan(view, panBox, 0, -100);
  assert.ok(up.dx < 0, "палец вверх — карта вверх, камера назад: " + up.dx);
  // Отвесный взгляд — та самая «карта в режиме сверху»: мера пикселя одна на
  // обе оси, и это `distance / focal`.
  const perPixel = view.distance / volumeFocal(panBox);
  assert.ok(Math.abs(Math.abs(right.dy) - 100 * perPixel) < 1e-6, "поперёк: " + right.dy);
  assert.ok(Math.abs(Math.abs(up.dx) - 100 * perPixel) < 1e-6, "вдоль: " + up.dx);
});

test("отошёл дальше — палец возит крупнее, и ровно во столько же раз", () => {
  const near = volumeAroundPan({ yaw: 0.4, pitch: -1, distance: 5000 }, panBox, 40, 25);
  const far = volumeAroundPan({ yaw: 0.4, pitch: -1, distance: 20000 }, panBox, 40, 25);
  const ratio = Math.hypot(far.dx, far.dy) / Math.hypot(near.dx, near.dy);
  assert.ok(Math.abs(ratio - 4) < 1e-9, "вчетверо дальше — вчетверо крупнее шаг: " + ratio.toFixed(3));
  // Мерить не от чего — ноль, а не бесконечность: щипок мог свести камеру в точку.
  assert.deepEqual(volumeAroundPan({ yaw: 0, pitch: -1, distance: 0 }, panBox, 10, 10), { dx: 0, dy: 0 });
  assert.deepEqual(volumeAroundPan({ yaw: 0, pitch: -1, distance: 9000 }, { width: 0, height: 0 }, 10, 10), { dx: 0, dy: 0 });
});

test("поправка на наклон есть, но у горизонта не уходит в бесконечность", () => {
  const box = panBox;
  const across = panLen(volumeAroundPan({ yaw: 0, pitch: (-42 * Math.PI) / 180, distance: 20000 }, box, 100, 0));
  const along = panLen(volumeAroundPan({ yaw: 0, pitch: (-42 * Math.PI) / 180, distance: 20000 }, box, 0, 100));
  // Пол на экране сжат синусом наклона — вдоль палец возит ровно во столько же
  // раз крупнее, иначе карта отставала бы вверх-вниз.
  assert.ok(Math.abs(along / across - 1 / Math.sin((42 * Math.PI) / 180)) < 1e-9, "отношение: " + (along / across).toFixed(3));
  // Положе двадцати градусов поправка стоит: у почти горизонтального взгляда
  // пол под пальцем лежит у горизонта, и без предела один мах уносил бы обзор
  // за километры.
  const shallow = panLen(volumeAroundPan({ yaw: 0, pitch: (-5 * Math.PI) / 180, distance: 20000 }, box, 0, 100));
  const limit = panLen(volumeAroundPan({ yaw: 0, pitch: (-20 * Math.PI) / 180, distance: 20000 }, box, 0, 100));
  assert.ok(Math.abs(shallow - limit) < 1e-6, "положе предела шаг не растёт: " + shallow.toFixed(1) + " против " + limit.toFixed(1));
  assert.ok(Math.abs(limit - (100 * 20000) / volumeFocal(box) / VOLUME_AROUND_PAN_TILT_MIN) < 1e-6, "предел считается по тому же числу");
  // Взгляд ровно вдоль земли (в обзоре такого не бывает) — сторона берётся у
  // самого взгляда, и ответ не ноль и не NaN.
  const flat = volumeAroundPan({ yaw: 0, pitch: 0, distance: 9000 }, box, 0, 100);
  assert.ok(Number.isFinite(flat.dx) && Math.abs(flat.dx) > 0, "вдоль земли ответ есть: " + JSON.stringify(flat));
});

test("клавиши разложены по осям камеры, а стрелки влево-вправо вертят", () => {
  assert.deepEqual(volumeKeyMove("KeyW"), { forward: 1, side: 0, turn: 0 });
  assert.deepEqual(volumeKeyMove("ArrowUp"), { forward: 1, side: 0, turn: 0 });
  assert.deepEqual(volumeKeyMove("KeyA"), { forward: 0, side: -1, turn: 0 });
  assert.deepEqual(volumeKeyMove("ArrowLeft"), { forward: 0, side: 0, turn: -1 });
  assert.equal(volumeKeyMove("KeyZ"), null);
  // E отдан двери (G207), Q ушёл вместе с ним: поворот остался у стрелок.
  assert.equal(volumeKeyMove("KeyE"), null, "E больше не вертит — он открывает дверь");
  assert.equal(volumeKeyMove("KeyQ"), null, "и Q не вертит: пара была симметричной, одиночка читалась бы опечаткой");
  assert.equal(volumeKeyMove("KeyR"), null, "R занят всеми дверьми разом (G210)");
});

// ——— указатель, перенос кликом и миникарта (G212, таск 150) —————————————

test("указатель «вы здесь» стал мельче, но остался указателем", () => {
  const marker = volumeMarkerFaces({ x: 0, y: 0 }, 0);
  const reach = Math.max(...marker.flatMap((face) => face.p.map((point) => Math.hypot(point.x, point.y))));
  assert.ok(VOLUME_MARKER_MM < 320, "радиус меньше прежнего: " + VOLUME_MARKER_MM);
  assert.ok(reach <= VOLUME_MARKER_MM * 2.5, "и вместе с ним укоротился треугольник взгляда: " + Math.round(reach));
  assert.equal(marker.length, 2, "кружок и треугольник остались на месте");
});

test("клик по обзору переносит туда, куда показали, а в стену — вплотную к ней", () => {
  const scene = roomScene();
  const built = volumeScene(scene.project, scene.schemeId);
  const box = { width: 1200, height: 700 };
  // Обзор смотрит на середину комнаты сверху и сбоку (камера стоит по −x и
  // выше пола): луч сквозь середину поля упирается в цель, а сквозь точку ниже
  // — в пол ближе к камере.
  const camera = volumeAroundCamera({ x: 0, y: 0, z: 0 }, 0, -Math.PI / 4, 9000);
  const middle = volumeFloorAt(camera, box, box.width / 2, box.height / 2);
  assert.ok(middle, "луч в пол упирается");
  assert.ok(Math.hypot(middle.x, middle.y) < 50, "середина поля — середина комнаты: " + JSON.stringify(middle));
  const lower = volumeFloorAt(camera, box, box.width / 2, box.height / 2 + 100);
  assert.ok(lower.x < middle.x - 100, "точка ниже в кадре лежит ближе к камере: " + Math.round(lower.x));
  // Взгляд вверх ни во что не упирается, и выдумывать точку нельзя.
  assert.equal(volumeFloorAt({ at: { x: 0, y: 0, z: 1600 }, yaw: 0, pitch: 0.5 }, box, box.width / 2, 10), null);
  // Показали в стену — встаём вплотную: комната 4 × 3 м со стенами в 200 мм,
  // то есть внутренняя грань по y = −1400, и тело радиусом 220 мм встанет перед ней.
  const inside = volumeMoveTo(built, { x: 0, y: -1450 });
  assert.ok(inside.y > -1400 + VOLUME_BODY_MM - 1, "тело вытолкнуто из стены: " + Math.round(inside.y));
  assert.ok(inside.y < -1400 + VOLUME_BODY_MM + 1, "и встало вплотную к ней, а не в середину комнаты");
  // Показали далеко за пределы плана — то же правило: зажали габаритом и
  // вытолкнули, человек оказался у внутренней грани наружной стены, а не
  // снаружи дома (габарит идёт по осевым линиям стен — см. `volumeMoveTo`).
  const far = volumeMoveTo(built, { x: 0, y: -40000 });
  assert.ok(far.y >= -1400 + VOLUME_BODY_MM - 1, "за пределами плана — внутри дома: " + Math.round(far.y));
  assert.ok(far.y < -1400 + VOLUME_BODY_MM + 220, "и вплотную к стене: " + Math.round(far.y));
});

test("миникарта живёт в левом нижнем углу и уходит с узкого поля", () => {
  const bounds = { minX: -2000, minY: -1500, maxX: 2000, maxY: 1500, widthMm: 4000, heightMm: 3000 };
  const box = { width: 1432, height: 580 };
  const place = volumeMinimapBox(box, bounds);
  assert.ok(place.x < 20, "прижата к левому краю");
  assert.ok(place.y + place.height > box.height - 20, "и к нижнему");
  assert.ok(place.width <= 220 && place.width >= 110, "шириной в пятую часть поля, но в своих пределах");
  assert.ok(place.height <= box.height * 0.3 + 1, "и не выше трети поля");
  // Узкое или низкое поле: честнее не показывать, чем загораживать комнату.
  assert.equal(volumeMinimapBox({ width: 420, height: 580 }, bounds), null);
  assert.equal(volumeMinimapBox({ width: 1432, height: 300 }, bounds), null);
  // Нет габарита чертежа — нечего и рисовать.
  assert.equal(volumeMinimapBox(box, null), null);
});

// Кнопки поля — стойка (таск 163, G242) и смена вида (таск 165, G244).
// Заказчик назвал условие сам: кнопки не должны спорить с площадкой ходьбы и
// миникартой. С площадкой они разведены по сторонам поля (она справа, они
// слева), а с миникартой — по высоте, и вот это считается, а не ставится на
// глаз: миникарта то есть, то нет, и высота у неё своя на каждом поле.
test("столбик кнопок встаёт над миникартой, а без неё — в самый угол", () => {
  const bounds = { minX: -2000, minY: -1500, maxX: 2000, maxY: 1500, widthMm: 4000, heightMm: 3000 };
  const box = { width: 1432, height: 580 };
  const place = volumeMinimapBox(box, bounds);
  const bottom = volumeFieldBottom(box, bounds);
  // Низ столбика выше верхней кромки миникарты: перекрытия нет ни точкой.
  assert.ok(bottom > box.height - place.y, "столбик налез на миникарту");
  assert.ok(bottom < box.height - place.y + 40, "и не улетел от неё к потолку");
  // Телефон: миникарты на узком поле нет вовсе, и столбик опускается в угол.
  const phone = { width: 360, height: 620 };
  assert.equal(volumeMinimapBox(phone, bounds), null);
  assert.equal(volumeFieldBottom(phone, bounds), 18);
  // Чертежа нет — миникарты нет, и считать нечего.
  assert.equal(volumeFieldBottom(box, null), 18);
});

// Смена вида кнопкой на поле (таск 165, G244): «а как перейти в режим от 1 лица
// на мобильном интерфейсе? сделай кнопку». Кнопка одна, и всё, что ей нужно
// знать, — куда она ведёт; это же знание у клавиши V, и оно обязано быть одним.
test("кнопка смены вида называет тот вид, в который переведёт", () => {
  const fromPerson = volumeViewSwitch("person");
  assert.equal(fromPerson.next, "around", "из первого лица кнопка ведёт в обзор");
  assert.equal(fromPerson.label, strings.volume.viewAround, "и названа его же словом, что и в колонке");
  const fromAround = volumeViewSwitch("around");
  assert.equal(fromAround.next, "person");
  assert.equal(fromAround.label, strings.volume.viewPerson);
  // Подсказка добавляет к имени действие: «Обзор» само по себе читалось бы как
  // «вы в обзоре», а кнопка в него ведёт.
  assert.equal(fromAround.title, text("volume.viewSwitch", { name: strings.volume.viewPerson }));
  assert.ok(fromAround.title.includes(strings.volume.viewPerson), "в подсказке назван тот же вид");
  // Два нажатия возвращают туда, откуда ушли: переключатель, а не дорога в один
  // конец.
  assert.equal(volumeViewSwitch(volumeViewSwitch("person").next).next, "person");
  // Неизвестный вид — первое лицо: оно главное, и кнопка, не знающая, где
  // стоит, обязана вести в комнату, а не в никуда.
  assert.equal(volumeViewSwitch(undefined).next, "person");
});

test("кнопка 3D знает, есть ли в схеме чертёж", () => {
  const empty = planProject();
  assert.equal(volumeHasDrawing(empty.project, empty.schemeId), false, "без стен и объектов показывать нечего");
  const scene = roomScene();
  assert.equal(volumeHasDrawing(scene.project, scene.schemeId), true);
  assert.equal(volumeHasDrawing(null, null), false);
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

// ——— D34: нулевая высота — это «на полу» ——————————————————————————————————
//
// Высота над полом — середина вещи, и на этом правиле вещь с высотой нуль
// (осушитель, робот-пылесос, датчик протечки) стояла серединой на нуле, то есть
// нижней половиной под полом. Признак — сама нулевая высота: вещи, у которой
// середина на уровне пола, не бывает.

test("правило различает «стоит на полу» и «висит»: двигается только нулевая высота", () => {
  assert.equal(volumeMarkOnFloor(0), true);
  assert.equal(volumeMarkOnFloor(300), false);
  // Высоты нет вовсе — это потолочная вещь, и к полу она не имеет отношения.
  assert.equal(volumeMarkOnFloor(null), false);
  // Сто миллиметров человек написал сам — и перетолковывать его число нельзя,
  // даже если низ вещи при этом уйдёт ниже нуля.
  assert.equal(volumeMarkOnFloor(100), false);
});

test("осушитель у стены стоит на полу, а не половиной под ним", () => {
  const scene = roomScene();
  // Осушитель «ОВ» из стартового справочника: 400 × 600 × 250, высота 0.
  const put = markAt(scene.project, scene.schemeId, "ОВ", [{ x: -500, y: -1100 }]);
  const built = volumeScene(put.project, scene.schemeId, {});
  const place = placeOf(built, put.markId);
  assert.equal(place.mode, VOLUME_MARK_WALL, "привязался к стене — случай тот самый");
  const span = faceSpanZ(place);
  assert.equal(span.bottomMm, 0, "низ на полу");
  assert.equal(span.topMm, 600, "вверх ушла вся ширина вещи");
  // Середина тела — по ней лицо, рамка выделения и стрелка связи.
  assert.equal(place.heightMm, 300);
  assert.equal(place.face.origin.z, 300);
  assert.equal(place.anchor.z, 300);
  assert.equal(place.frame.bottomMm, 0, "модель садится на тот же пол");
});

test("робот-пылесос посреди комнаты лежит на полу и лицом вверх", () => {
  const scene = roomScene();
  // Середина комнаты: до стен больше порога автопривязки — вещь стоит в своём
  // месте по плану, а не на стене. Вверх у неё идёт выступ (100 мм).
  const put = markAt(scene.project, scene.schemeId, "РП", [{ x: 0, y: 0 }]);
  const built = volumeScene(put.project, scene.schemeId, {});
  const place = placeOf(built, put.markId);
  assert.equal(place.mode, VOLUME_MARK_ROOM);
  const span = faceSpanZ(place);
  assert.equal(span.bottomMm, 0, "низ на полу");
  assert.equal(span.topMm, 100, "вверх — выступ вещи");
  assert.equal(place.heightMm, 50);
  // Лицо смотрит вверх: оставь его внизу — изображение легло бы в плоскость
  // пола, ушло бы под неё вместе с контуром и отсеклось бы по нормали.
  assert.equal(place.face.normal.z, 1);
  assert.equal(place.face.origin.z, 100);
  assert.ok(volumeMarkViewLines(place).length > 0, "контур вещи есть");
  for (const line of volumeMarkViewLines(place)) {
    for (const point of line.p) assert.ok(point.z > 0, "контур не ушёл под пол: " + point.z);
  }
});

test("висящая на стене вещь от правки не сдвинулась", () => {
  const scene = roomScene();
  const put = markAt(scene.project, scene.schemeId, "Р", [{ x: -500, y: -1100 }]);
  const built = volumeScene(put.project, scene.schemeId, {});
  const span = faceSpanZ(placeOf(built, put.markId));
  // Розетка на 300 — ровно середина минус половина ширины, как и была.
  assert.deepEqual(span, { bottomMm: 260, topMm: 340 });
});

test("вещь на полу: сцена собралась, а объект не изменился (G68)", () => {
  const scene = roomScene();
  const put = markAt(scene.project, scene.schemeId, "ДПр", [{ x: 0, y: 0 }]);
  const before = JSON.stringify(put.project);
  const built = volumeScene(put.project, scene.schemeId, {});
  assert.equal(faceSpanZ(placeOf(built, put.markId)).bottomMm, 0);
  assert.equal(JSON.stringify(put.project), before, "посадка живёт в сцене, а не в объекте");
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

// ——— запасной габарит (G215, G226) ———————————————————————————————————————
//
// Тип, заведённый рукой с незнакомой формой, из объёма выпадал: умолчания
// (G192) ищут донора по коду и по форме, а такой формы в шаблоне нет вовсе. Это
// дыра в правиле, а не в данных — и закрывается она на время рисования, в
// сцене, без единой записи в справочник (G68).
//
// Само правило габарита здесь не проверяется: оно общее с развёрткой и живёт в
// `markBox.js` (`test/markBox.test.js`). Здесь — что объём зовёт его и что
// сцена от этого получается та, которую человек увидит.

test("вещь без размеров рисуется запасным габаритом и называется вслух", () => {
  const scene = roomScene();
  const category = scene.project.categories[0];
  // Тип заказчика как он есть: своя форма, размеров нет ни одного, высота
  // записана у самой метки — то есть вещь висит на своей стене. Код здесь
  // «МВЗ»: сам «МВ» с таска 160 живёт в стартовом справочнике и со своими
  // размерами, а запас проверяется как раз на типе без них.
  const added = addType(scene.project, {
    code: "МВЗ",
    name: "Мастер-выключатель заказчика",
    categoryId: category.id,
    shape: "circle-rays",
  });
  const put = markAt(added.project, scene.schemeId, "МВЗ", [{ x: 0, y: -1100 }]);
  const withHeight = setMarkDimensions(put.project, put.markId, { heightAboveFloor: 1400 }).project;
  const before = JSON.stringify(withHeight);
  const built = volumeScene(withHeight, scene.schemeId, {});
  assert.equal(built.unplaced.length, 0, "места ей больше не выдумывают — её рисуют");
  const place = placeOf(built, put.markId);
  assert.equal(place.mode, VOLUME_MARK_WALL);
  assert.equal(place.heightMm, 1400);
  // Габарит — светильника: 90 вдоль стены, 90 по высоте.
  const lamp = objectViewByName("lamp");
  assert.equal(place.face.widthMm, lamp.mm.width);
  assert.equal(place.face.heightMm, lamp.mm.height);
  const span = faceSpanZ(place);
  assert.equal(span.topMm - span.bottomMm, lamp.mm.height);
  // И об этом сказано: вещь в списке запасных, а не потерянных.
  assert.deepEqual(built.spare, [{ markId: put.markId, label: labelOf(withHeight, put.markId) }]);
  assert.equal(place.spare, true);
  assert.equal(JSON.stringify(withHeight), before, "запас живёт в сцене: в справочник не записано ничего (G68)");
});

test("незнакомая форма без изображения рисуется общей рамкой", () => {
  const scene = roomScene();
  const category = scene.project.categories[0];
  // Звезду ни одно изображение объекта не разбирает (таких форм в сетке
  // тринадцать из пятидесяти с лишним: круг с клавишей ушёл к выключателю в
  // таске 160) — остаётся рамка.
  assert.ok(!objectViewShapes().includes("star"));
  const added = addType(scene.project, {
    code: "ЩЩ",
    name: "Своя вещь",
    categoryId: category.id,
    shape: "star",
  });
  const put = markAt(added.project, scene.schemeId, "ЩЩ", [{ x: 0, y: -1100 }]);
  const withHeight = setMarkDimensions(put.project, put.markId, { heightAboveFloor: 900 }).project;
  const place = placeOf(volumeScene(withHeight, scene.schemeId, {}), put.markId);
  assert.equal(place.face.widthMm, MARK_BOX_FRAME_MM);
  assert.equal(place.face.heightMm, MARK_BOX_FRAME_MM);
  // Выступ у плоского изображения взять негде, и он тоже из рамки: тело вещи
  // на стене толщиной в этот выступ, а не в плёнку.
  const corners = place.prisms[0].corners;
  const sides = corners.map((corner, index) => {
    const next = corners[(index + 1) % corners.length];
    return Math.hypot(next.x - corner.x, next.y - corner.y);
  });
  assert.ok(
    Math.abs(Math.min(...sides) - MARK_BOX_FRAME_DEPTH_MM) < 0.01,
    "запасной выступ — рамка справочника, а не плёнка",
  );
});

test("названа одна сторона — вторая подтягивается габаритом, а не нижним пределом (G226)", () => {
  const scene = roomScene();
  const category = scene.project.categories[0];
  const added = addType(scene.project, { code: "ЩЩ", name: "Своя вещь", categoryId: category.id, shape: "star" });
  const put = markAt(added.project, scene.schemeId, "ЩЩ", [{ x: 0, y: -1100 }]);
  // Своя длина у метки, ширины нет нигде. До таска 156 вторая сторона уходила
  // в нижний предел видимости (20 мм) и вещь выходила 600 × 20 здесь против
  // 600 × 80 на листе развёртки. Правило теперь одно, развёрточное: сторона
  // подтягивается габаритом — у звезды изображения нет, значит рамкой.
  const own = setMarkDimensions(put.project, put.markId, { length: 600, heightAboveFloor: 900 }).project;
  const before = JSON.stringify(own);
  const built = volumeScene(own, scene.schemeId, {});
  const place = placeOf(built, put.markId);
  assert.equal(place.face.widthMm, 600, "названная сторона — своя, её никто не трогает");
  assert.equal(place.face.heightMm, MARK_BOX_FRAME_MM);
  // Догадка названа вслух: сторона взята сборкой, и человек об этом читает.
  assert.equal(place.spare, true);
  assert.deepEqual(built.spare, [{ markId: put.markId, label: labelOf(own, put.markId) }]);
  // Выступ при этом остаётся своим: о третьем измерении по одной названной
  // стороне догадываться нечем, и вещь от правки не толстеет.
  const span = faceSpanZ(place);
  assert.equal(span.topMm - span.bottomMm, MARK_BOX_FRAME_MM, "по высоте вещь встала подтянутой стороной");
  const corners = place.prisms[0].corners;
  const sides = corners.map((corner, index) => {
    const next = corners[(index + 1) % corners.length];
    return Math.hypot(next.x - corner.x, next.y - corner.y);
  });
  assert.ok(Math.abs(Math.min(...sides) - VOLUME_MARK_LIFT_MM) < 0.01, "выступ прежний: 2 мм, а не рамка");
  assert.equal(JSON.stringify(own), before, "догадка живёт в сцене: в объект не записано ничего (G68)");
});

test("обе стороны названы — вещь не двигается ни на миллиметр (G226)", () => {
  const scene = roomScene();
  const category = scene.project.categories[0];
  const added = addType(scene.project, { code: "ЩЩ", name: "Своя вещь", categoryId: category.id, shape: "star" });
  const put = markAt(added.project, scene.schemeId, "ЩЩ", [{ x: 0, y: -1100 }]);
  const own = setMarkDimensions(put.project, put.markId, {
    length: 600,
    width: 300,
    depth: 40,
    heightAboveFloor: 900,
  }).project;
  const place = placeOf(volumeScene(own, scene.schemeId, {}), put.markId);
  assert.equal(place.face.widthMm, 600);
  assert.equal(place.face.heightMm, 300);
  assert.equal(place.spare, false, "догадываться не о чем — и слова об этом нет");
  const span = faceSpanZ(place);
  assert.equal(span.topMm - span.bottomMm, 300);
});

test("ноль на стороне лица — пустота, а не ноль: вещи нулевой длины не бывает", () => {
  const scene = roomScene();
  const category = scene.project.categories[0];
  const added = addType(scene.project, { code: "ЩЩ", name: "Своя вещь", categoryId: category.id, shape: "star" });
  const put = markAt(added.project, scene.schemeId, "ЩЩ", [{ x: 0, y: -1100 }]);
  // Ноль у выступа — это «встроенный» (и он остаётся нулём), а ноль у длины
  // читается как «не сказано»: так развёртка считала с самого начала.
  const own = setMarkDimensions(put.project, put.markId, { length: 0, width: 300, heightAboveFloor: 900 }).project;
  const place = placeOf(volumeScene(own, scene.schemeId, {}), put.markId);
  assert.equal(place.face.widthMm, MARK_BOX_FRAME_MM);
  assert.equal(place.face.heightMm, 300);
  assert.equal(place.spare, true);
});

test("встроенная вещь не толстеет от запасного выступа", () => {
  const scene = roomScene();
  const put = markAt(scene.project, scene.schemeId, "Т", [{ x: 0, y: 0 }]);
  // У точечного светильника шаблона выступ записан нулём — это «встроенный», а
  // не пустота, и запас его не касается.
  const place = placeOf(volumeScene(put.project, scene.schemeId, {}), put.markId);
  const span = faceSpanZ(place);
  assert.equal(span.topMm - span.bottomMm, VOLUME_MARK_LIFT_MM);
  assert.equal(place.spare, false);
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

test("прицел видит только то, что видно: вещь за стеной в него не попадает (G214)", () => {
  // Рука целится с запасом и сквозь стену — ей прощается промах (`volumePickAt`).
  // Взгляд не прощает ничего: `volumeSightAt` отвечает тем, что в этой точке
  // нарисовано последним, то есть ровно тем, что человек видит.
  const scene = roomScene();
  const put = markAt(scene.project, scene.schemeId, "К", [{ x: 0, y: -1100 }]);
  const built = volumeScene(put.project, scene.schemeId, {});
  const box = { width: 800, height: 600 };
  const camera = { at: { x: 0, y: 500, z: VOLUME_EYE_MM }, yaw: -Math.PI / 2, pitch: 0 };
  const frame = volumeFrame(built, camera, box);
  const mine = frame.filter((polygon) => polygon.pick === put.markId && !polygon.stroke);
  const xy = mine[mine.length - 1].xy;
  const centre = { x: (xy[0] + xy[4]) / 2, y: (xy[1] + xy[5]) / 2 };
  assert.equal(volumeSightAt(frame, centre.x, centre.y), put.markId, "вещь перед глазами — видно её");
  // Та же вещь с изнанки стены: рука её достаёт, взгляд — нет.
  const behind = { at: { x: 0, y: -2500, z: VOLUME_EYE_MM }, yaw: Math.PI / 2, pitch: 0 };
  const back = volumeFrame(built, behind, box);
  const blocked = back.filter((polygon) => polygon.pick === put.markId && !polygon.stroke);
  assert.ok(blocked.length > 0, "грани вещи в кадре есть — она просто закрыта стеной");
  const hidden = blocked[blocked.length - 1].xy;
  const at = { x: (hidden[0] + hidden[4]) / 2, y: (hidden[1] + hidden[5]) / 2 };
  assert.equal(volumePickAt(back, at.x, at.y), put.markId, "рука достаёт её и сквозь стену — так было и в таске 148");
  assert.equal(volumeSightAt(back, at.x, at.y), null, "а взгляд упирается в стену");
  // Пустое место — пусто и для взгляда.
  assert.equal(volumeSightAt(frame, 5, 5), null);
});

// ——— прозрачные вещи (таск 169, требование G251) ————————————————————————
//
// Слова заказчика: «сделай так же все объекты (мебель, сантехника и т.д.)
// полупрозрачными, что бы можно было видеть метки, которые, например в шкафу, и
// взаимодействовать с ними».
//
// Стенд — ровно его случай: шкаф 1200 × 600 × 2000 стоит у стены, а розетка
// висит **внутри него** (шкаф задником стоит на той же грани стены, на которой
// сидит метка). Дальше проверяется три вещи, и каждая из них — предмет тикета:
// что просвечивает только вещь, что порядок остался точным (прозрачность его не
// терпит приблизительным) и что взгляд теперь отвечает меткой за шкафом.

function clearStand() {
  const scene = roomScene();
  const put = markAt(scene.project, scene.schemeId, "Р", [{ x: -500, y: -1100 }]);
  let project = ensureSchemeObjectKinds(put.project).project;
  const kind = schemeObjectKindsInOrder(project).find((item) => item.name === "Шкаф");
  const added = addSchemeObject(project, {
    schemeId: scene.schemeId,
    kindId: kind.id,
    shape: "rect",
    atMm: { x: -500, y: -1100 },
    widthMm: 1200,
    depthMm: 600,
    heightMm: 2000,
    heightAboveFloorMm: 0,
  });
  return {
    project: added.project,
    schemeId: scene.schemeId,
    markId: put.markId,
    object: added.schemeObject,
    // Смотрим на шкаф из комнаты и сверху вниз: розетка сидит на 300 мм, глаза
    // на 1600, между ними полтора метра пола.
    camera: { at: { x: -500, y: 600, z: VOLUME_EYE_MM }, yaw: -Math.PI / 2, pitch: -0.58 },
    box: { width: 900, height: 600 },
  };
}

/** Все непрозрачные и прозрачные многоугольники, накрывшие точку, по порядку рисования. */
function coverAt(frame, x, y) {
  const out = [];
  for (let index = 0; index < frame.length; index += 1) {
    const polygon = frame[index];
    if (polygon.stroke) continue;
    let inside = false;
    const xy = polygon.xy;
    for (let i = 0, j = xy.length - 2; i < xy.length; j = i, i += 2) {
      const ax = xy[i];
      const ay = xy[i + 1];
      const bx = xy[j];
      const by = xy[j + 1];
      if (ay > y !== by > y && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) inside = !inside;
    }
    if (inside) out.push({ index, polygon });
  }
  return out;
}

/** Середина экранного многоугольника метки — та же точка, которой целятся прицелом. */
function markPointAt(frame, markId) {
  const mine = frame.filter((polygon) => polygon.pick === markId && !polygon.stroke);
  assert.ok(mine.length > 0, "грани метки в кадре есть");
  const xy = mine[mine.length - 1].xy;
  return { x: (xy[0] + xy[4]) / 2, y: (xy[1] + xy[5]) / 2 };
}

test("просвечивает вещь чертежа — и только она (G251)", () => {
  const stand = clearStand();
  const built = volumeScene(stand.project, stand.schemeId, {});
  const own = volumeObjectFaces(stand.project, stand.schemeId, stand.object, WALL_HEIGHT_FALLBACK_MM);
  const clear = built.faces.filter((face) => face.clear);
  assert.equal(clear.length, own.length, "прозрачны ровно грани вещи: " + clear.length + " против " + own.length);
  assert.equal(clear.length, 11, "шкаф нарисован моделью из двух тел");
  for (const face of clear) assert.equal(face.markId, null, "у вещи чертежа хозяина нет — и не появилось");
  // Стены, пол, потолок, плита и метки — как были. Это правило таска 146:
  // сквозь стену видно быть не должно.
  for (const rgb of [VOLUME_WALL_RGB, VOLUME_FLOOR_RGB, VOLUME_LAND_RGB]) {
    const same = built.faces.filter((face) => face.rgb === rgb);
    assert.ok(same.length > 0, "стенд обязан содержать такие грани");
    assert.ok(
      same.every((face) => !face.clear),
      "прозрачной стала поверхность комнаты, а не вещь",
    );
  }
  const markFaces = built.faces.filter((face) => face.markId && !face.line);
  assert.ok(markFaces.length > 0);
  assert.ok(markFaces.every((face) => !face.clear), "метки прозрачными не делаем — их и смотрят");

  // В кадре прозрачность живёт **в цвете**: заливка грани вещи — `rgba` с тем
  // самым числом, заливка стены — прежний `rgb`.
  const frame = volumeFrame(built, stand.camera, stand.box);
  const painted = frame.filter((polygon) => polygon.clear);
  assert.ok(painted.length > 0, "прозрачные грани в кадре есть");
  for (const polygon of painted) {
    assert.ok(polygon.fill.startsWith("rgba("), polygon.fill);
    assert.ok(polygon.fill.endsWith("," + VOLUME_CLEAR_ALPHA + ")"), polygon.fill);
  }
  for (const polygon of frame) {
    if (polygon.clear || polygon.stroke) continue;
    assert.ok(polygon.fill.startsWith("rgb("), "непрозрачная грань не должна смешиваться: " + polygon.fill);
  }
});

test("просвечивает любая порода вещи: модель, запасной габарит и звено полосы", () => {
  // Прозрачность ставится в одном месте (`volumeObjectFaces`), и все три пути
  // рисования идут через него. Разойдись они — одна вещь оказалась бы
  // прозрачной в кадре, а другая нет, и человек не понял бы правила.
  const scene = roomScene();
  let project = ensureSchemeObjectKinds(scene.project).project;
  const own = addSchemeObjectKind(project, { name: "Верстак" });
  project = own.project;
  const box = addSchemeObject(project, {
    schemeId: scene.schemeId,
    kindId: own.schemeObjectKind.id,
    shape: "rect",
    atMm: { x: 0, y: 0 },
    widthMm: 1200,
    depthMm: 600,
    heightMm: 900,
    heightAboveFloorMm: 0,
  });
  assert.equal(volumeObjectModel(box.project, box.schemeObject), null, "у вида, заведённого руками, модели нет");
  const boxFaces = volumeObjectFaces(box.project, scene.schemeId, box.schemeObject, WALL_HEIGHT_FALLBACK_MM);
  assert.equal(boxFaces.length, 5, "запасной габарит — призма");
  assert.ok(boxFaces.every((face) => face.clear), "габарит просвечивает так же, как модель");
  const strip = addSchemeObject(box.project, {
    schemeId: scene.schemeId,
    kindId: own.schemeObjectKind.id,
    shape: "polyline",
    pointsMm: [
      { x: -1500, y: 800 },
      { x: 0, y: 800 },
      { x: 0, y: 1200 },
    ],
    depthMm: 600,
    heightMm: 800,
  });
  const stripFaces = volumeObjectFaces(strip.project, scene.schemeId, strip.schemeObject, WALL_HEIGHT_FALLBACK_MM);
  assert.equal(stripFaces.length, 10, "два звена по пять граней");
  assert.ok(stripFaces.every((face) => face.clear), "звено полосы просвечивает так же");
});

test("метка в шкафу нарисована раньше его прозрачных граней — это и значит «от дальних к ближним»", () => {
  // Прозрачность не терпит приблизительного порядка: смешивание
  // некоммутативно, и грань, нарисованная не в свой черёд, даёт не тот цвет, а
  // не только не тот верх. Проверяется поэтому не «вещь поверх», а вся очередь
  // в одной точке кадра.
  const stand = clearStand();
  const built = volumeScene(stand.project, stand.schemeId, {});
  const frame = volumeFrame(built, stand.camera, stand.box);
  const at = markPointAt(frame, stand.markId);
  const cover = coverAt(frame, at.x, at.y);
  const mark = cover.filter((item) => item.polygon.pick === stand.markId);
  const clear = cover.filter((item) => item.polygon.clear);
  assert.ok(mark.length > 0 && clear.length > 0, "в этой точке спорят метка и шкаф — иначе стенд ничего не проверяет");
  assert.ok(
    Math.max(...mark.map((item) => item.index)) < Math.min(...clear.map((item) => item.index)),
    "метка обязана быть нарисована раньше шкафа, иначе она не просветит сквозь него",
  );
  // Лицевых граней шкафа на луче **две** — фасад и лицо корпуса, — и ровно из
  // этого числа посчитана прозрачность (`VOLUME_CLEAR_ALPHA`): за двумя гранями
  // остаётся 0.6 × 0.6 = 0.36 того, что за ними.
  assert.equal(clear.length, 2, "сквозь шкаф луч проходит две лицевые грани: " + clear.length);
  assert.ok(
    clear[0].polygon.depth > clear[1].polygon.depth,
    "и они сами легли от дальней к ближней: " + clear.map((item) => Math.round(item.polygon.depth)).join(" → "),
  );
  assert.ok(
    Math.round((1 - VOLUME_CLEAR_ALPHA) ** clear.length * 100) === 36,
    "за шкафом остаётся треть того, что за ним",
  );
});

test("взгляд смотрит сквозь прозрачную вещь и выделяет метку за ней (G251)", () => {
  const stand = clearStand();
  const built = volumeScene(stand.project, stand.schemeId, {});
  const frame = volumeFrame(built, stand.camera, stand.box);
  const at = markPointAt(frame, stand.markId);
  assert.equal(volumeSightAt(frame, at.x, at.y), stand.markId, "розетка в шкафу — то, на что человек смотрит");
  assert.equal(volumePickAt(frame, at.x, at.y), stand.markId, "рука достаёт её, как и прежде");
  // Тот же кадр с непрозрачной вещью — это поведение до таска 169: взгляд
  // упирался в шкаф, у которого хозяина нет, и отвечал «ничего». Прозрачная
  // грань не отняла ни одного ответа — она перестала закрывать чужой.
  const opaque = volumeFrame({ faces: built.faces.map((face) => ({ ...face, clear: false })) }, stand.camera, stand.box);
  assert.equal(volumeSightAt(opaque, at.x, at.y), null, "непрозрачный шкаф закрывал метку от взгляда");
});

test("стену взгляд по-прежнему не пробивает, а за прозрачной вещью может не быть ничего", () => {
  const stand = clearStand();
  const built = volumeScene(stand.project, stand.schemeId, {});
  // 1. Стена. Та же розетка снаружи комнаты: перед ней непрозрачная стена, и
  // обход упирается в неё — правило таска 146 прозрачность не отменила.
  const outside = { at: { x: -500, y: -2600, z: VOLUME_EYE_MM }, yaw: Math.PI / 2, pitch: -0.5 };
  const back = volumeFrame(built, outside, stand.box);
  const far = markPointAt(back, stand.markId);
  assert.equal(volumeSightAt(back, far.x, far.y), null, "сквозь стену не видно ни метки, ни шкафа за ней");
  assert.equal(volumePickAt(back, far.x, far.y), stand.markId, "а рука достаёт сквозь стену — так было с таска 148");
  // 2. Пусто. Середина лица шкафа: за ней его собственный корпус и стена, и
  // ответ — «ничего», ровно как до правки. Для `E` это слово «тут ничего нет»,
  // для щелчка — снятие выделения.
  const frame = volumeFrame(built, stand.camera, stand.box);
  const area = (xy) => {
    let sum = 0;
    for (let i = 0, j = xy.length - 2; i < xy.length; j = i, i += 2) sum += xy[j] * xy[i + 1] - xy[i] * xy[j + 1];
    return Math.abs(sum / 2);
  };
  const face = frame.filter((polygon) => polygon.clear).sort((a, b) => area(b.xy) - area(a.xy))[0];
  let x = 0;
  let y = 0;
  for (let index = 0; index < face.xy.length; index += 2) {
    x += face.xy[index];
    y += face.xy[index + 1];
  }
  x /= face.xy.length / 2;
  y /= face.xy.length / 2;
  assert.ok(
    coverAt(frame, x, y).some((item) => item.polygon.clear),
    "точка обязана лежать на прозрачной вещи",
  );
  assert.equal(volumeSightAt(frame, x, y), null, "за лицом шкафа метки нет — и взгляду отвечать нечем");
});

// ——— ус на изломе полосы (дефект D38) ———————————————————————————————————
//
// Слова заказчика по снимку объёма: «не должно быть такого, ни двойного на
// углу, ни пустоты в другом углу». Нашлось это ровно потому, что вещи стали
// прозрачными: непрозрачные звенья прятали и нахлёст, и клин.

/** Полоса с изломом: буква «Г» из двух звеньев по 2 м, ширина 600. */
function stripStand(points) {
  const scene = roomScene();
  let project = ensureSchemeObjectKinds(scene.project).project;
  const kind = schemeObjectKindsInOrder(project)[0];
  const added = addSchemeObject(project, {
    schemeId: scene.schemeId,
    kindId: kind.id,
    shape: "polyline",
    pointsMm: points,
    depthMm: 600,
    heightMm: 900,
    heightAboveFloorMm: 0,
  });
  return { project: added.project, schemeId: scene.schemeId, object: added.schemeObject };
}

const polygonAreaMm = (corners) => {
  let sum = 0;
  for (let i = 0, j = corners.length - 1; i < corners.length; j = i, i += 1) {
    sum += corners[j].x * corners[i].y - corners[i].x * corners[j].y;
  }
  return Math.abs(sum / 2);
};
const samePoint = (a, b) => Math.hypot(a.x - b.x, a.y - b.y) < 0.01;

test("звенья полосы сходятся усом: ни нахлёста, ни клина (D38)", () => {
  // Излом в прямой угол: звено вдоль −x, затем вдоль −y, как кухонный фронт на
  // объекте заказчика.
  const stand = stripStand([
    { x: 1000, y: 0 },
    { x: -1000, y: 0 },
    { x: -1000, y: -1200 },
  ]);
  const prisms = volumeObjectPrisms(stand.project, stand.schemeId, stand.object, WALL_HEIGHT_FALLBACK_MM);
  assert.equal(prisms.length, 2, "два звена");
  // Общих точек у соседних звеньев ровно две — это и есть общая кромка по
  // биссектрисе. До правки их не было ни одной: звенья кончались поперёк оси.
  const shared = [];
  for (const point of prisms[0].corners) {
    for (const other of prisms[1].corners) if (samePoint(point, other)) shared.push(point);
  }
  assert.equal(shared.length, 2, "звенья сходятся по общей кромке: " + JSON.stringify(shared));
  // Кромка идёт по биссектрисе угла: внешний её конец отстоит от вершины на
  // полуширину, умноженную на √2, внутренний — ровно столько же внутрь.
  const vertex = { x: -1000, y: 0 };
  for (const point of shared) {
    assert.ok(
      Math.abs(Math.hypot(point.x - vertex.x, point.y - vertex.y) - 300 * Math.SQRT2) < 0.01,
      "конец кромки не на биссектрисе: " + JSON.stringify(point),
    );
  }
  // Внешний клин закрыт: угол (−1300, 300) — тот самый, где до правки была
  // пустота, — теперь лежит в звене.
  const outer = shared.find((point) => point.x < vertex.x);
  assert.ok(outer && Math.round(outer.x) === -1300 && Math.round(outer.y) === 300, JSON.stringify(outer));
  // Нахлёста нет: площадь двух звеньев равна площади полосы с усом. Прежние
  // прямоугольники давали ту же сумму, но 0,09 м² из неё приходились на
  // дважды закрашенный квадрат у внутреннего угла.
  const drawn = prisms.reduce((sum, prism) => sum + polygonAreaMm(prism.corners), 0);
  const boxes = prisms.reduce((sum, prism) => sum + polygonAreaMm(prism.solidCorners), 0);
  assert.ok(Math.abs(drawn - boxes) < 1, "площадь не изменилась: " + Math.round(drawn) + " против " + Math.round(boxes));
  // Ни одна точка одного звена не лежит **внутри** другого: нахлёста нет.
  const inside = (point, corners) => {
    let hit = false;
    for (let i = 0, j = corners.length - 1; i < corners.length; j = i, i += 1) {
      const a = corners[i];
      const b = corners[j];
      if (a.y > point.y !== b.y > point.y && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) hit = !hit;
    }
    return hit;
  };
  // Середина квадрата, который до правки красился дважды.
  const wasDouble = { x: -1150, y: -150 };
  const covers = prisms.filter((prism) => inside(wasDouble, prism.corners)).length;
  assert.equal(covers, 1, "внутренний угол закрашен ровно одним звеном, а было двумя");
  // И столько же граней, сколько было: ус меняет координаты, а не число тел.
  const faces = volumeObjectFaces(stand.project, stand.schemeId, stand.object, WALL_HEIGHT_FALLBACK_MM);
  assert.equal(faces.length, 10, "два звена по пять граней — как до правки");
});

test("ус меняет рисунок, а не то, где полоса держит человека (D38)", () => {
  const stand = stripStand([
    { x: 1000, y: 0 },
    { x: -1000, y: 0 },
    { x: -1000, y: -1200 },
  ]);
  const prisms = volumeObjectPrisms(stand.project, stand.schemeId, stand.object, WALL_HEIGHT_FALLBACK_MM);
  // Препятствие первого звена — прежний прямоугольник: середина на оси звена,
  // половина длины 1000, половина толщины 300.
  const solid = volumePrismSolid(prisms[0]);
  assert.equal(Math.round(solid.cx), 0);
  assert.equal(Math.round(solid.cy), 0);
  assert.equal(Math.round(solid.half), 1000);
  assert.equal(Math.round(solid.halfT), 300);
  // И он не зависит от уса: ровно такой же выходит из звена без излома.
  const plain = stripStand([
    { x: 1000, y: 0 },
    { x: -1000, y: 0 },
  ]);
  const alone = volumePrismSolid(volumeObjectPrisms(plain.project, plain.schemeId, plain.object, WALL_HEIGHT_FALLBACK_MM)[0]);
  assert.deepEqual(
    [Math.round(solid.cx), Math.round(solid.cy), Math.round(solid.half), Math.round(solid.halfT)],
    [Math.round(alone.cx), Math.round(alone.cy), Math.round(alone.half), Math.round(alone.halfT)],
  );
  // У прямоугольной вещи второго набора углов нет вовсе: усу там негде быть.
  const scene = roomScene();
  let project = ensureSchemeObjectKinds(scene.project).project;
  const box = addSchemeObject(project, {
    schemeId: scene.schemeId,
    kindId: schemeObjectKindsInOrder(project)[0].id,
    shape: "rect",
    atMm: { x: 0, y: 0 },
    widthMm: 1200,
    depthMm: 600,
    heightMm: 900,
    heightAboveFloorMm: 0,
  });
  const rect = volumeObjectPrisms(box.project, scene.schemeId, box.schemeObject, WALL_HEIGHT_FALLBACK_MM)[0];
  assert.equal(rect.solidCorners, undefined);
});

test("прямая полоса усом не ведётся, а острый излом срезается по пределу (D38)", () => {
  // Две точки на одной прямой: излома нет, и кромки остаются поперечными —
  // полоса обязана выйти той же, какой была до правки.
  const straight = stripStand([
    { x: 1500, y: 0 },
    { x: 0, y: 0 },
    { x: -1500, y: 0 },
  ]);
  for (const prism of volumeObjectPrisms(straight.project, straight.schemeId, straight.object, WALL_HEIGHT_FALLBACK_MM)) {
    for (const point of prism.corners) assert.ok(Math.abs(Math.abs(point.y) - 300) < 0.01, JSON.stringify(point));
  }
  // Полоса, сложенная почти вдвое: ус ушёл бы на метры, и он срезан пределом.
  const sharp = stripStand([
    { x: 2000, y: 0 },
    { x: 0, y: 0 },
    { x: 1980, y: 100 },
  ]);
  const prisms = volumeObjectPrisms(sharp.project, sharp.schemeId, sharp.object, WALL_HEIGHT_FALLBACK_MM);
  const vertex = { x: 0, y: 0 };
  let most = 0;
  for (const prism of prisms) {
    for (const point of prism.corners) {
      const reach = Math.hypot(point.x - vertex.x, point.y - vertex.y);
      if (reach < 2000) most = Math.max(most, reach);
    }
  }
  assert.ok(most <= VOLUME_MITER_MAX * 300 + 0.01, "ус длиннее предела: " + Math.round(most));
  assert.ok(most > 300, "но длиннее поперечной кромки — иначе предел ни при чём: " + Math.round(most));
});

test("прозрачность — вид, а не свойство вещи: объект цел, сквозь шкаф не пройти (G68)", () => {
  const stand = clearStand();
  const before = JSON.stringify(stand.project);
  const built = volumeScene(stand.project, stand.schemeId, {});
  assert.equal(JSON.stringify(stand.project), before, "в объект не пишется ничего (G68)");
  assert.equal(
    JSON.stringify(stand.project.schemeObjects),
    JSON.stringify(JSON.parse(before).schemeObjects),
    "и у вещи не завелось поля прозрачности",
  );
  // Препятствие — прежний габарит: шкаф 1200 × 600 держит так же, как держал.
  const solid = built.solids.find((item) => Math.round(item.half * 2) === 1200 && Math.round(item.halfT * 2) === 600);
  assert.ok(solid, "препятствие шкафа на месте");
  let at = { x: -500, y: 0 };
  for (let step = 0; step < 40; step += 1) at = volumeStep(built, at, 0, -200);
  assert.ok(at.y > -800, "сквозь прозрачный шкаф не прошли: y = " + Math.round(at.y));
  assert.equal(Math.round(volumeFreeMm(built.solids, at.x, at.y)), VOLUME_BODY_MM, "тело стоит вплотную к шкафу");
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

// ——— каналы многоклавишного выключателя (таск 177, G274) ——————————————————
//
// Слова заказчика: «В объёме Многоканальные выключатели (многоклавишные) рисуй
// так же с несколькими вертикальными клавишами, и обрабатывай клик на каждый
// канал отдельно рисуя стрелки только на соответствующий канал».

test("у клавиш выключателя стоит номер канала, и доезжает он до грани", () => {
  const scene = roomScene();
  const put = markAt(scene.project, scene.schemeId, "ВВ", [{ x: -500, y: -1100 }]);
  const built = volumeScene(put.project, scene.schemeId, {});
  const place = placeOf(built, put.markId);
  assert.ok(place.model, "у двухклавишного нет модели");
  const keys = place.model.parts.filter((part) => part.channel);
  assert.deepEqual(
    keys.map((part) => part.channel),
    [1, 2],
    "клавиш не две или номера не по порядку",
  );
  // Номер доезжает до грани: по ней кадр и отвечает, в какой канал попал клик.
  const faces = volumeMarkFaces(place);
  const channels = new Set(faces.map((face) => face.channel));
  assert.ok(channels.has(1) && channels.has(2), "у граней клавиш нет номеров");
  assert.ok(channels.has(null), "у рамки появился номер канала");
  assert.ok(
    faces.every((face) => face.markId === place.markId),
    "хозяин грани клавиши — не метка",
  );
  // Трёхклавишный получает три клавиши, одноклавишный — одну: число берётся у
  // типа, а не у записи реестра.
  const triple = markAt(scene.project, scene.schemeId, "ВВВ", [{ x: 0, y: -1100 }]);
  const tripled = placeOf(volumeScene(triple.project, scene.schemeId, {}), triple.markId);
  assert.equal(tripled.model.parts.filter((part) => part.channel).length, 3);
  const single = markAt(scene.project, scene.schemeId, "В", [{ x: 500, y: -1100 }]);
  const one = placeOf(volumeScene(single.project, scene.schemeId, {}), single.markId);
  assert.equal(one.model.parts.filter((part) => part.channel).length, 1);
});

test("двухканальный переключатель получает две клавиши, а не одну", () => {
  // «ПП» — переключатель на два канала, а изображение у него с одной клавишей:
  // до таска 177 он стоял на стене одноклавишным, то есть врал о себе.
  const scene = roomScene();
  const put = markAt(scene.project, scene.schemeId, "ПП", [{ x: -500, y: -1100 }]);
  const place = placeOf(volumeScene(put.project, scene.schemeId, {}), put.markId);
  assert.equal(place.model.parts.filter((part) => part.channel).length, 2);
  // Качалка никуда не делась — ею переключатель и отличается от выключателя.
  assert.ok(place.model.parts.some((part) => part.name === "lever"), "качалка пропала");
  assert.ok(place.model.parts.length <= 5, "тел стало больше предела");
});

test("щелчок по клавише попадает в её канал, а промах — ни в какой", () => {
  // Правило взгляда: клавиша должна быть **видна** в этой точке кадра. Промах
  // здесь не прощается — соседние клавиши стоят в десятке миллиметров, и
  // «ближайшая в пределах промаха» выбрала бы канал, по которому не целились.
  const key = (channel, x) => ({
    xy: [x, 0, x + 10, 0, x + 10, 10, x, 10],
    pick: "мет",
    channel,
    fill: "rgb(0,0,0)",
  });
  const polygons = [{ xy: [0, 0, 100, 0, 100, 100, 0, 100], pick: null, channel: null }, key(1, 10), key(2, 30)];
  assert.deepEqual(volumeChannelAt(polygons, 15, 5), { markId: "мет", channel: 1 });
  assert.deepEqual(volumeChannelAt(polygons, 35, 5), { markId: "мет", channel: 2 });
  // Мимо клавиш — ни в какой канал: под точкой рамка, стена или пол.
  assert.equal(volumeChannelAt(polygons, 60, 50), null);
  assert.equal(volumeChannelAt(polygons, 500, 500), null);
  // Клавишу закрыли непрозрачной гранью — щелчок попадает в неё, а не сквозь.
  const covered = [...polygons, { xy: [0, 0, 100, 0, 100, 100, 0, 100], pick: null, channel: null }];
  assert.equal(volumeChannelAt(covered, 15, 5), null);
});

test("выбранный канал оставляет стрелки только своей клавиши", () => {
  const links = {
    lines: [
      { fromId: "вв", toId: "т1", channel: 1 },
      { fromId: "вв", toId: "т2", channel: 2 },
      { fromId: "вв", toId: "т3", channel: null },
      { fromId: "другой", toId: "т1", channel: 1 },
    ],
    ties: [{ fromId: "вв", toId: "другой" }],
    groups: [{ key: "т#1", markIds: ["т1", "т2"] }],
    offScheme: [{ markId: "вв", count: 1 }],
  };
  // Канал не выбран — связи идут как шли: это обычная жизнь окна.
  assert.equal(volumeChannelLinks(links, null), links);
  assert.equal(volumeChannelLinks(links, { markId: "вв", channel: null }), links);
  // Выбран — остаётся управление **с этой клавиши этой метки**, и больше ничего.
  const only = volumeChannelLinks(links, { markId: "вв", channel: 2 });
  assert.deepEqual(only.lines, [{ fromId: "вв", toId: "т2", channel: 2 }]);
  assert.deepEqual(only.ties, [], "общее управление про клавишу не знает");
  assert.deepEqual(only.groups, [], "общий номер — тождество меток, а не клавиша");
  assert.deepEqual(only.offScheme, []);
  // Связь без канала у той же метки не приписывается первой клавише: этого в
  // данных нет.
  const first = volumeChannelLinks(links, { markId: "вв", channel: 1 });
  assert.deepEqual(
    first.lines.map((line) => line.toId),
    ["т1"],
  );
});

test("рамка выбранной клавиши идёт по ней, а не по лицу вещи", () => {
  const scene = roomScene();
  const put = markAt(scene.project, scene.schemeId, "ВВ", [{ x: -500, y: -1100 }]);
  const built = volumeScene(put.project, scene.schemeId, {});
  const place = placeOf(built, put.markId);
  const frame = volumeSelectLines(place);
  const first = volumeChannelLines(place, 1);
  const second = volumeChannelLines(place, 2);
  assert.equal(first.length, 1);
  assert.equal(second.length, 1);
  assert.equal(first[0].color, VOLUME_SELECT_COLOR, "рамка клавиши другого цвета, чем выделение");
  assert.equal(first[0].dash, null, "рамка клавиши пунктирна — её не отличить от рамки вещи");
  assert.ok(frame[0].dash, "рамка вещи перестала быть пунктирной");
  // Клавиши стоят рядом, а не друг на друге: рамки разведены по стене.
  const along = (line) => line.p.reduce((sum, point) => sum + point.x, 0) / line.p.length;
  assert.notEqual(Math.round(along(first[0])), Math.round(along(second[0])));
  // Канала, которого у вещи нет, рамка не рисует вовсе.
  assert.deepEqual(volumeChannelLines(place, 3), []);
  assert.deepEqual(volumeChannelLines(place, null), []);
});

test("канал в объект не пишется: его знает только кадр (G68)", () => {
  const scene = roomScene();
  const put = markAt(scene.project, scene.schemeId, "ВВ", [{ x: -500, y: -1100 }]);
  const load = markAt(put.project, scene.schemeId, "Т", [{ x: 0, y: 0 }]);
  const wired = setMarkControls(load.project, put.markId, [{ id: load.markId, channel: 2 }]).project;
  const before = JSON.stringify(wired);
  const built = volumeScene(wired, scene.schemeId, {});
  const place = placeOf(built, put.markId);
  volumeMarkFaces(place);
  volumeChannelLines(place, 2);
  volumeChannelLinks({ lines: [{ fromId: put.markId, toId: load.markId, channel: 2 }] }, {
    markId: put.markId,
    channel: 2,
  });
  assert.equal(JSON.stringify(wired), before, "выбор канала доехал до объекта");
  // И у самой метки ни поля, ни следа: связь знает канал, метка — нет.
  assert.equal(findMark(wired, put.markId).channel, undefined);
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

test("вещь рисуется после своей стены — иначе стена закрашивает её собой", () => {
  // Дефект живого прогона таска 148: выключатель на стене пропадал целиком.
  // Порядок граней решала дальность их середин, и стена в четыре метра
  // серединой оказывалась ближе метки у своего края. Таски 148–150 лечили это
  // перестановкой очереди по ключу куска стены; с деревом порядка (таск 151)
  // лечить нечего — вещь стоит перед плоскостью стены, и дерево это видит.
  const scene = roomScene();
  const put = markAt(scene.project, scene.schemeId, "В", [{ x: 200, y: -1100 }]);
  const built = volumeScene(put.project, scene.schemeId, {});
  // Смотрим на эту стену из середины комнаты.
  // Взгляд опущен: выключатель висит на 900 мм, а глаза на 1600.
  const camera = { at: { x: 0, y: 0, z: VOLUME_EYE_MM }, yaw: -Math.PI / 2, pitch: -0.5 };
  const frame = volumeFrame(built, camera, { width: 900, height: 600 });
  const wallFill = volumeFill(VOLUME_WALL_RGB, volumeShade({ x: 0, y: 1, z: 0 }));
  let wallAt = -1;
  let markAtIndex = -1;
  frame.forEach((polygon, index) => {
    if (polygon.fill === wallFill) wallAt = Math.max(wallAt, index);
    if (polygon.pick === put.markId) markAtIndex = Math.max(markAtIndex, index);
  });
  assert.ok(wallAt >= 0, "стена, на которой висит вещь, в кадре есть");
  assert.ok(markAtIndex > wallAt, "вещь ложится поверх своей стены: " + markAtIndex + " против " + wallAt);
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

// ——— этажи, лестница, планшет и снимок (таск 149) ——————————————————————
//
// Три вещи, которые тихо врут, если за ними не следить:
//
//   1. **G68.** Этаж — единственное новое поле за весь объёмный режим, и оно
//      необязательное. Объект, которому этажей не задавали, обязан остаться
//      байт в байт тем же: пустое значение ключ **удаляет**, а не кладёт `null`.
//   2. **Кого считать лестницей.** Вид объекта узнаётся по имени, другого
//      способа у справочника видов нет вовсе — ни кода, ни ключа. Разойдись это
//      с терпимым сравнением, и лестница в объекте заказчика перестанет быть
//      лестницей молча.
//   3. **Куда ведёт переход.** В список этажей идёт не всякая схема: без
//      номера она не этаж, без чертежа — тупик.

function stairsKindId(project) {
  return schemeObjectKindsInOrder(project).find((kind) => kind.name === "Лестница").id;
}

// Комната с лестницей у левой стены: марш 1100 × 2700, как в стартовых
// размерах мастерской.
function stairScene(options = {}) {
  const scene = roomScene(options);
  let project = ensureSchemeObjectKinds(scene.project).project;
  const added = addSchemeObject(project, {
    schemeId: scene.schemeId,
    kindId: stairsKindId(project),
    shape: "rect",
    atMm: options.atMm || { x: -1200, y: 0 },
    widthMm: 1100,
    depthMm: 2700,
    turnDeg: 0,
    heightAboveFloorMm: 0,
  });
  return { ...scene, project: added.project, objectId: added.schemeObject.id };
}

test("этаж схемы задаётся, читается и снимается, не оставляя ключа", () => {
  const base = planProject();
  assert.equal(schemeFloorOf(base.project, base.schemeId), null, "без правки этажа нет");
  assert.equal(
    Object.prototype.hasOwnProperty.call(findScheme(base.project, base.schemeId), "floor"),
    false,
    "и ключа в схеме нет вовсе — иначе прежний объект изменился бы от чтения",
  );
  const set = setSchemeFloor(base.project, base.schemeId, 2);
  assert.equal(set.changed, true);
  assert.equal(schemeFloorOf(set.project, base.schemeId), 2);
  // Подвал и цоколь — это минус первый и нулевой, а не «не задано».
  assert.equal(schemeFloorOf(setSchemeFloor(set.project, base.schemeId, -1).project, base.schemeId), -1);
  assert.equal(schemeFloorOf(setSchemeFloor(set.project, base.schemeId, 0).project, base.schemeId), 0);
  const cleared = setSchemeFloor(set.project, base.schemeId, "");
  assert.equal(cleared.changed, true);
  assert.equal(schemeFloorOf(cleared.project, base.schemeId), null);
  assert.equal(
    Object.prototype.hasOwnProperty.call(findScheme(cleared.project, base.schemeId), "floor"),
    false,
    "снятый этаж уносит ключ с собой: пустые поля в файл не пишутся (G68)",
  );
  // Снимать нечего — объект тот же по ссылке, и шага истории на это не нужно.
  const again = setSchemeFloor(cleared.project, base.schemeId, null);
  assert.equal(again.changed, false);
  assert.equal(again.project, cleared.project);
});

test("этаж — целое число в разумных пределах, и остальное отвергается вслух", () => {
  const base = planProject();
  const code = (value) => {
    try {
      setSchemeFloor(base.project, base.schemeId, value);
      return "";
    } catch (error) {
      return error.code;
    }
  };
  assert.equal(code("1,5"), "schemeFloorInvalid", "половины этажа не бывает");
  assert.equal(code("2.5"), "schemeFloorInvalid");
  assert.equal(code("мансарда"), "schemeFloorInvalid");
  assert.equal(code(1000), "schemeFloorRange");
  assert.equal(code(-1000), "schemeFloorRange");
  assert.equal(code(SCHEME_FLOOR_MAX), "");
  assert.equal(code(SCHEME_FLOOR_MIN), "");
  // «2,0» — то же целое, что «2»: запятая здесь только разделитель.
  assert.equal(schemeFloorOf(setSchemeFloor(base.project, base.schemeId, "2,0").project, base.schemeId), 2);
});

test("объект прежней сборки не знает этажей — и не узнаёт о них от чтения (G68)", () => {
  const legacy = JSON.parse(readFileSync(join(HERE, "legacy-project.json"), "utf8"));
  const before = JSON.stringify(legacy);
  for (const scheme of legacy.schemes) {
    assert.equal(schemeFloorOf(legacy, scheme.id), null);
    const floors = volumeFloors(legacy, scheme.id);
    assert.equal(floors.floor, null);
    assert.deepEqual(floors.options, [], "перейти некуда: ни у одной схемы этажа нет");
    assert.deepEqual(volumeStairs(legacy, scheme.id), []);
  }
  assert.equal(JSON.stringify(legacy), before, "объект изменился — это запрещено прямо (G68)");
});

test("лестница узнаётся по ключу каталога, а прежняя — по имени вида", () => {
  // С таска 154 у лестницы есть ключ, и он не зависит от слов. Имя осталось
  // запасным путём для уже размеченных объектов — терпимым к регистру,
  // пробелам и приписке.
  for (const name of ["Лестница", "лестница", "  ЛЕСТНИЦА  ", "Лестничный марш", "Лестница на 2 этаж", "stairs"]) {
    assert.equal(objectCatalogKeyByName(name), "stairs", name);
  }
  for (const name of ["", null, "Марш"]) {
    assert.equal(objectCatalogKeyByName(name), null, String(name));
  }
  for (const name of ["Шкаф", "Колонна", "Щит"]) {
    assert.notEqual(objectCatalogKeyByName(name), "stairs", name);
  }
});

test("лестница чертежа попадает в сцену своей геометрией, а шкаф — нет", () => {
  const scene = stairScene();
  const built = volumeScene(scene.project, scene.schemeId);
  assert.equal(built.stairs.length, 1);
  assert.equal(built.stairs[0].objectId, scene.objectId);
  assert.equal(built.stairs[0].polygons.length, 1, "у прямоугольного марша один габарит");
  assert.deepEqual(
    built.stairs[0].atMm,
    { x: -1200, y: 0 },
    "середина лестницы — там, где её поставили: спрашивают у того места, где она нарисована",
  );
  // Та же вещь под другим видом лестницей не считается: справочник тот же,
  // габарит тот же, имя вида другое.
  const plain = roomScene();
  const withKinds = ensureSchemeObjectKinds(plain.project).project;
  const cabinet = schemeObjectKindsInOrder(withKinds).find((kind) => kind.name === "Шкаф");
  const other = addSchemeObject(withKinds, {
    schemeId: plain.schemeId,
    kindId: cabinet.id,
    shape: "rect",
    atMm: { x: -1200, y: 0 },
    widthMm: 1100,
    depthMm: 2700,
    turnDeg: 0,
  }).project;
  assert.deepEqual(volumeScene(other, plain.schemeId).stairs, [], "шкаф лестницей не стал");
  // И объект от сборки сцены не меняется.
  const before = JSON.stringify(scene.project);
  volumeScene(scene.project, scene.schemeId);
  assert.equal(JSON.stringify(scene.project), before);
});

test("подход к лестнице виден с метра, а из другого конца комнаты — нет", () => {
  const scene = stairScene();
  const stairs = volumeScene(scene.project, scene.schemeId).stairs;
  // Лестница занимает x от −1750 до −650. Встали в полуметре от её края.
  assert.ok(volumeStairNear(stairs, { x: -150, y: 0 }), "в полуметре от края — подошли");
  assert.equal(volumeStairNear(stairs, { x: 1500, y: 0 }), null, "через комнату — не подошли");
  // Ровно на границе досягаемости и чуть дальше.
  assert.ok(volumeStairNear(stairs, { x: -650 + VOLUME_STAIR_REACH_MM - 1, y: 0 }));
  assert.equal(volumeStairNear(stairs, { x: -650 + VOLUME_STAIR_REACH_MM + 1, y: 0 }), null);
  // Внутри габарита расстояние ноль: так бывает у лестницы, через которую
  // можно пройти (низкий марш, порожек).
  const inside = volumeStairNear(stairs, { x: -1200, y: 0 });
  assert.equal(inside.distanceMm, 0);
  assert.equal(volumeStairNear([], { x: 0, y: 0 }), null);
});

test("в список этажей идёт только схема с номером и чертежом, и по порядку снизу вверх", () => {
  const first = stairScene();
  let project = setSchemeFloor(first.project, first.schemeId, 1).project;
  // Второй этаж: своя схема со своим чертежом.
  const second = addScheme(project, { name: "2 этаж", imageId: "plan-2", width: 1200, height: 800 });
  project = second.project;
  project = addWall(project, {
    schemeId: second.scheme.id,
    aMm: { x: 0, y: 0 },
    bMm: { x: 4000, y: 0 },
    thicknessMm: 200,
  }).project;
  project = setSchemeFloor(project, second.scheme.id, 2).project;
  // Подвал — тоже со чертежом.
  const basement = addScheme(project, { name: "Подвал", imageId: "plan-0", width: 1200, height: 800 });
  project = basement.project;
  project = addWall(project, {
    schemeId: basement.scheme.id,
    aMm: { x: 0, y: 0 },
    bMm: { x: 4000, y: 0 },
    thicknessMm: 200,
  }).project;
  project = setSchemeFloor(project, basement.scheme.id, -1).project;
  // Схема с номером, но без чертежа — тупик, в список не идёт.
  const bare = addScheme(project, { name: "3 этаж", imageId: "plan-3", width: 1200, height: 800 });
  project = setSchemeFloor(bare.project, bare.scheme.id, 3).project;
  // Схема с чертежом, но без номера — не этаж вовсе.
  const noFloor = addScheme(project, { name: "Развёртка", imageId: "plan-4", width: 1200, height: 800 });
  project = addWall(noFloor.project, {
    schemeId: noFloor.scheme.id,
    aMm: { x: 0, y: 0 },
    bMm: { x: 1000, y: 0 },
    thicknessMm: 100,
  }).project;

  const floors = volumeFloors(project, first.schemeId);
  assert.equal(floors.floor, 1, "свой этаж известен");
  assert.deepEqual(
    floors.options.map((option) => option.floor),
    [-1, 2],
    "только этажи с чертежом, снизу вверх",
  );
  assert.deepEqual(
    floors.options.map((option) => option.name),
    ["Подвал", "2 этаж"],
  );
  assert.deepEqual(
    floors.options.map((option) => option.stairs),
    [false, false],
    "лестницы на тех этажах не нарисовано — об этом окно говорит вслух",
  );
  // Со второго этажа виден первый — и у него лестница есть.
  const fromSecond = volumeFloors(project, second.scheme.id);
  assert.deepEqual(
    fromSecond.options.map((option) => [option.floor, option.stairs]),
    [[-1, false], [1, true]],
  );
  // Своя схема в список не попадает никогда.
  assert.ok(floors.options.every((option) => option.schemeId !== first.schemeId));
});

test("у лестницы окно предлагает этаж, а без неё молчит или зовёт обратно", () => {
  const stair = { objectId: "s" };
  const floors = [{ floor: 2 }];
  // Ни лестницы, ни дороги назад — предлагать нечего, и строки нет.
  assert.deepEqual(volumeFloorAction(null, [], null), { kind: "none", label: "", title: "", hint: "" });
  assert.equal(volumeFloorAction(null, floors, null).kind, "none", "лестницы нет — этажи сами по себе не зовут");
  // Лестница есть, этажей не задано: кнопки нет, но молчать нельзя — человек
  // видит нарисованную лестницу.
  const dead = volumeFloorAction(stair, [], null);
  assert.equal(dead.kind, "none");
  assert.equal(dead.hint, strings.volume.stairNoFloors);
  // Лестница и этажи — обычный переход таска 149.
  const up = volumeFloorAction(stair, floors, null);
  assert.equal(up.kind, "stair");
  assert.equal(up.label, strings.volume.stairButton);
  assert.equal(up.hint, strings.volume.stairNear);
  // Лестницы нет, а пришли мы сюда переходом — возврат (G216).
  const back = volumeFloorAction(null, [], { schemeId: "s1", name: "1 этаж", floor: 1 });
  assert.equal(back.kind, "back");
  assert.equal(back.label, text("volume.backButton", { where: text("volume.floorNumber", { floor: 1 }) }));
  assert.equal(back.hint, strings.volume.backLine);
  // Лестница старше возврата: есть она — ею и пользуются, правило T149 цело.
  assert.equal(volumeFloorAction(stair, floors, { schemeId: "s1", name: "1", floor: 1 }).kind, "stair");
  // Схема без этажа зовётся именем, и падеж у обоих случаев один.
  const named = volumeFloorAction(null, [], { schemeId: "s2", name: "План", floor: null });
  assert.equal(named.label, text("volume.backButton", { where: text("volume.floorNamed", { name: "План" }) }));
  assert.equal(volumeFloorName(null), "");
});

test("клавиши окна не отбирают клавиши у поля ввода", () => {
  assert.equal(volumeTypingTarget({ tagName: "SELECT" }), true);
  assert.equal(volumeTypingTarget({ tagName: "INPUT" }), true);
  assert.equal(volumeTypingTarget({ tagName: "TEXTAREA" }), true);
  assert.equal(volumeTypingTarget({ tagName: "DIV", isContentEditable: true }), true);
  assert.equal(volumeTypingTarget({ tagName: "CANVAS" }), false);
  assert.equal(volumeTypingTarget({ tagName: "DIV" }), false);
  assert.equal(volumeTypingTarget(null), false);
});

test("заголовок окна называет этаж, когда он задан", () => {
  assert.equal(volumeTitle("1 этаж", null), text("volume.title", { name: "1 этаж" }));
  assert.equal(volumeTitle("Мансарда", 3), text("volume.titleFloor", { name: "Мансарда", floor: 3 }));
  assert.ok(volumeTitle("Подвал", -1).includes("-1"), "подвал называется своим номером, а не пропадает");
});

// ——— сенсорное управление ———————————————————————————————————————————————

test("площадка ходьбы: вверх — вперёд, в сторону — поворот, середина — покой", () => {
  const radius = 64;
  assert.deepEqual(volumePadVector(0, 0, radius), { forward: 0, turn: 0 }, "палец в середине не идёт");
  // Мёртвая зона: дрожание пальца ходьбой не считается.
  assert.deepEqual(volumePadVector(5, 5, radius), { forward: 0, turn: 0 });
  const up = volumePadVector(0, -radius, radius);
  assert.equal(up.forward, 1, "палец вверх — полный шаг вперёд");
  assert.equal(Math.abs(up.turn), 0);
  const down = volumePadVector(0, radius, radius);
  assert.equal(down.forward, -1);
  const right = volumePadVector(radius, 0, radius);
  assert.equal(right.turn, 1, "палец вправо — поворот вправо");
  assert.equal(Math.abs(right.forward), 0);
  assert.equal(volumePadVector(-radius, 0, radius).turn, -1);
  // Полпути — полшага: иначе пальцем нельзя было бы идти медленно.
  const half = volumePadVector(0, -radius * 0.6, radius);
  assert.ok(half.forward > 0.4 && half.forward < 0.65, "полшага остаётся полушагом: " + half.forward);
  // За краем площадки — то же, что на краю: больше единицы не бывает.
  const far = volumePadVector(0, -radius * 4, radius);
  assert.equal(far.forward, 1);
  assert.ok(Math.hypot(far.forward, far.turn) <= 1.0000001);
});

// ——— подсказка плашкой (G218) ————————————————————————————————————————————
//
// Вид плашки проверяется снимком — зелёный прогон про стили не говорит ничего.
// А вот текст её чистый, и собирается он из шести кусков: разойдись сборка —
// человек останется без клавиш, о которых больше написать негде.

test("текст подсказки говорит про тот вид и то управление, которые сейчас", () => {
  const base = {
    empty: false,
    view: "person",
    touching: false,
    locked: false,
    aim: true,
    doors: [],
    open: new Set(),
    aimedDoor: null,
    stair: null,
    floors: [],
  };
  const person = volumeHintText(base);
  assert.ok(person.includes(strings.volume.hintPerson), person);
  assert.ok(person.includes(strings.volume.hintGrab), "мышь не захвачена — про это и сказано");
  assert.ok(person.includes(strings.volume.aimHint), "прицел показан — про него есть строка");
  // Обзор говорит своё, и про прицел там молчит: его в обзоре нет.
  const around = volumeHintText({ ...base, view: "around", aim: false });
  assert.ok(around.includes(strings.volume.hintAround), around);
  assert.ok(!around.includes(strings.volume.aimHint), around);
  // Мышь у вида — другая строка про мышь, и обе разом не говорятся.
  const locked = volumeHintText({ ...base, locked: true });
  assert.ok(locked.includes(strings.volume.hintLocked) && !locked.includes(strings.volume.hintGrab), locked);
  // Пальцем про мышь не говорится вовсе (таск 149).
  const touch = volumeHintText({ ...base, touching: true });
  assert.ok(touch.includes(strings.volume.hintTouch), touch);
  assert.ok(!touch.includes(strings.volume.hintGrab) && !touch.includes(strings.volume.hintLocked), touch);
  // Двери и лестница дописываются теми же строками, что и прежде.
  const full = volumeHintText({ ...base, doors: ["d1"], stair: { objectId: "s" }, floors: [{ floor: 2 }] });
  assert.ok(full.includes(strings.volume.stairNear), full);
  // Возврат с этажа без лестницы (G216) говорится в той же строке.
  const back = volumeHintText({ ...base, back: { schemeId: "s", name: "1 этаж", floor: 1 } });
  assert.ok(back.includes(strings.volume.backLine), back);
  assert.ok(full.includes(volumeDoorLine(["d1"], new Set(), null, false)), full);
  // Схема без чертежа: подсказка говорит, чем рисуют чертёж, и ничего больше.
  assert.equal(volumeHintText({ ...base, empty: true }), strings.volume.emptyHint);
});

test("свёрнутая подсказка окна помечается, когда текст сменился", () => {
  // Правило то же, что на холсте, и считает его та же функция — второго
  // «текст сменился» в сборке нет.
  const open = new Set();
  const first = volumeHintText({
    empty: false, view: "person", touching: false, locked: false, aim: false,
    doors: ["d1"], open, aimedDoor: null, stair: null, floors: [],
  });
  const second = volumeHintText({
    empty: false, view: "person", touching: false, locked: false, aim: false,
    doors: ["d1"], open: new Set(["d1"]), aimedDoor: null, stair: null, floors: [],
  });
  assert.notEqual(first, second, "открытая дверь меняет текст — иначе проверять нечего");
  assert.equal(plateUnseen(first, second), true);
  assert.equal(plateUnseen(first, first), false);
  assert.equal(plateUnseen(null, second), false, "не видел ничего — и знака нет");
});

test("подсказка пальцем не обещает клавиш, которых на планшете нет", () => {
  const open = new Set();
  const mouse = volumeDoorLine(["d1", "d2"], open, null, false);
  const touch = volumeDoorLine(["d1", "d2"], open, null, true);
  assert.ok(mouse.includes("E"), "мышью клавиша названа: " + mouse);
  assert.equal(touch.includes(strings.volume.doorTouch), true);
  assert.equal(touch.includes("E открывает"), false, "пальцем клавиши E нет вовсе: " + touch);
  // Дверей нет — строки нет ни там, ни там.
  assert.equal(volumeDoorLine([], open, null, true), "");
});
