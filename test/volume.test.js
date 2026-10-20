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
  projectCoords,
  projectTopAzimuth,
  setProjectSite,
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
  wallsOnScheme,
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
  VOLUME_LAYER_SHADOW,
  VOLUME_LAYER_MARK,
  VOLUME_LAYER_SUN,
  VOLUME_SHEER_SHARE,
  VOLUME_SUN_PROBE_MM,
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
  VOLUME_SHEER_ALPHA,
  volumeClearAlpha,
  VOLUME_MITER_MAX,
  VOLUME_WALL_RGB,
  VOLUME_SHADOW_RGB,
  VOLUME_NEAR_MM,
  VOLUME_PITCH_MAX_DEG,
  VOLUME_AROUND_PAN_TILT_MIN,
  VOLUME_HILLS,
  VOLUME_FLOOR_LAP,
  VOLUME_FLOOR_RGB,
  VOLUME_LAND_RGB,
  VOLUME_MOUNTAINS,
  VOLUME_SUN_AT,
  VOLUME_SUNRISE_MIN,
  VOLUME_SUNSET_MIN,
  VOLUME_DAY_MIN,
  VOLUME_CLOCK_SPEEDS,
  VOLUME_CLOCK_SPEED_DEFAULT,
  VOLUME_CLOCK_SPEED_REAL,
  VOLUME_MOON_MONTH_DAYS,
  VOLUME_NIGHT_RGB,
  VOLUME_NIGHT_SHARE,
  VOLUME_BACKDROP_KINDS,
  VOLUME_BACKDROP_DEFAULT,
  VOLUME_MOOD_NOON,
  VOLUME_CITY,
  VOLUME_MARKER_RGB,
  VOLUME_RIVER,
  VOLUME_RIVER_GREENS,
  VOLUME_ROAD,
  VOLUME_SELECT_COLOR,
  VOLUME_STAIR_REACH_MM,
  volumeArea,
  volumeAroundCamera,
  volumeAroundFit,
  volumeAroundPan,
  volumeAroundStand,
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
  volumePush,
  volumeDepthMm,
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
  volumeModelKeys,
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
  volumeShadowFaces,
  volumeGroundScale,
  VOLUME_PANORAMA_NEAR_DEG,
  VOLUME_LAND_OUT_MM,
  volumeSunSpotFaces,
  volumeSunSpotRgb,
  volumeSunOpenings,
  volumeSheerPlace,
  volumeCurtainOpen,
  volumeClipPolygon,
  volumeClockNow,
  volumeClockFixed,
  volumeClockMinutes,
  volumeClockAt,
  volumeClockSpeedOf,
  volumeClockDayMinutes,
  volumeClockOnDay,
  volumeClockStamp,
  volumeClockText,
  volumeDateParse,
  volumeDayMinutesOf,
  volumeDateShort,
  volumeDateText,
  volumeDayDateOf,
  volumeDayNumberOf,
  volumeClockParse,
  volumeSiteOf,
  volumeDayTimes,
  volumeDayPhase,
  volumePanoramaAz,
  volumeSkyPlace,
  volumeSunAt,
  volumeMoonAgeDays,
  volumeMoonAt,
  volumeMoonShape,
  volumeMoonTiltDeg,
  volumeNightShare,
  volumeSkyColors,
  volumeTintRgb,
  volumeMood,
  volumeCityWindowLit,
  volumeBackdropKindOf,
  volumeShadowShift,
  volumeShade,
  volumeFloors,
  volumeStairNear,
  volumeStairs,
  volumeStart,
  volumeStep,
  volumeWallSolids,
  volumeWallTiles,
  volumeWallMiters,
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
  volumeMinimapAt,
  volumePlanCentre,
  volumePlanViewAt,
  volumeMinimapView,
  volumeNotes,
  volumeFieldBottom,
  VOLUME_FIELD_EDGE,
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
import {
  volumeParamsDay,
  volumeParamsFix,
  volumeParamsLine,
  volumeParamsNow,
  volumeParamsRead,
  volumeParamsSpeed,
  volumeParamsSunLine,
  volumeDayLabel,
  volumePhaseWord,
  volumeSpeedLabel,
} from "../src/panels/volumeParams.js";
import {
  screenPlaceDrawing,
  screenPlaceForget,
  screenPlaceOfDrawing,
  screenPlaceTake,
  screenPlaceWant,
} from "../src/screenPlace.js";
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
  // Пол и потолок помещения и полоса пола под каждой из четырёх стен (она
  // закрывает порог в проёме и щель между контуром и гранью стены, D37).
  // Тени стен (D43) в сцене больше не лежат гранями: с таска 181 солнце ходит
  // по небу, и тень собирается вместе со снимком часа — в сцене остались
  // габариты стен, от часа не зависящие.
  assert.equal(ground.length, 2 + 4, "пол, потолок и пол под стенами");
  assert.equal(built.shadowBoxes.length, 4, "габарит тени под каждой стеной");
  const shadows = volumeShadowFaces(built.shadowBoxes, { az: 90, rise: 14, fade: 1 });
  assert.equal(shadows.length, 4, "тень под каждой стеной");
  assert.ok(
    shadows.every((face) => face.layer === VOLUME_LAYER_SHADOW && face.flat && face.n.z > 0),
    "тень лежит на земле своим ярусом: выше плиты, ниже полов (D49)",
  );
  assert.ok(VOLUME_LAYER_BASE < VOLUME_LAYER_SHADOW && VOLUME_LAYER_SHADOW < VOLUME_LAYER_GROUND);
  assert.deepEqual(shadows[0].rgb, VOLUME_SHADOW_RGB, "в полную силу тень того же тона, что была");
  // Солнце у горизонта — тени нет вовсе: она гаснет цветом, а не прозрачностью.
  assert.deepEqual(volumeShadowFaces(built.shadowBoxes, { az: 90, rise: 1, fade: 0 }), []);
  assert.deepEqual(volumeShadowFaces(built.shadowBoxes, { az: 90, rise: 7, fade: 0.5 })[0].rgb, [
    Math.round((123 + 89) / 2),
    Math.round((160 + 115) / 2),
    Math.round((93 + 67) / 2),
  ]);
  const ceiling = ground.find((face) => face.n.z < 0);
  const floors = ground.filter((face) => face.n.z > 0);
  assert.equal(floors.length, 5, "у пола нормаль вверх, у потолка вниз");
  assert.ok(floors.every((face) => face.p.every((point) => point.z === 0)), "весь пол лежит на нуле");
  assert.ok(ceiling.p.every((point) => point.z === 2700), "потолок — на высоте схемы");
  // Под ними — плита по габариту чертежа. Полом она больше не работает: пол у
  // помещений свой, а плита стала землёй вокруг дома (G237).
  assert.equal(built.faces.filter((face) => face.layer === VOLUME_LAYER_BASE).length, 1);
  // У стены без проёмов две стороны и верх, низ не рисуется — он под полом.
  // Метровой сетки, которой стороны резались в тасках 148–150 ради порядка,
  // больше нет (таск 151): сторона без проёмов — один многоугольник. Торцов у
  // стен этой комнаты нет вовсе: все четыре угла сведены усом (G265), и на
  // сведённом конце стена переходит в соседку.
  const body = built.faces.filter((face) => face.layer === VOLUME_LAYER_BODY);
  assert.equal(body.length, 4 * (2 + 1), "по три грани на стену: две стороны и верх");
});

// ——— D49: внутри дома пол, а не зелень ————————————————————————————————
//
// «баг отрисовки тени внутри дома — просвечивает пол». Проверка числами: в
// точке посреди комнаты перебираются **все** грани земли, накрывающие её, и
// спрашивается, какая ложится последней. Раньше это решала дальность середин, и
// ответ переворачивался от часа; теперь решает ярус.

test("тень дома не просвечивает сквозь пол ни в один час (D49)", () => {
  const scene = roomScene();
  const built = volumeScene(scene.project, scene.schemeId);
  // Полы подписаны: `markId` — единственное поле, которое кадр переносит в
  // многоугольник (`pick`), и спор читается по имени, а не по цвету.
  const named = {
    ...built,
    order: undefined,
    faces: built.faces.map((face) =>
      face.layer === VOLUME_LAYER_GROUND && face.n.z > 0 ? { ...face, markId: "пол" } : face,
    ),
  };
  const box = { width: 972, height: 778 };
  const camera = volumeAroundCamera({ x: 0, y: 0, z: 0 }, 0.6, -0.73, 14000);
  const inside = (xy, x, y) => {
    let hit = false;
    for (let i = 0, j = xy.length - 2; i < xy.length; j = i, i += 2) {
      const ax = xy[i];
      const ay = xy[i + 1];
      const bx = xy[j];
      const by = xy[j + 1];
      if (ay > y !== by > y && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) hit = !hit;
    }
    return hit;
  };
  let nearerSomewhere = false;
  for (const hour of [6, 10, 12, 15, 19]) {
    const mood = volumeMood({ minutes: hour * 60, times: { riseMin: 540, setMin: 1260, north: true }, kind: "nature" });
    // Тень подписана так же, как полы: сравнение не должно опираться на ярус —
    // иначе стенд проверял бы сам себя.
    const shadow = volumeShadowFaces(built.shadowBoxes, mood.shadow).map((face) => ({ ...face, markId: "тень" }));
    const frame = volumeFrame(named, camera, box, shadow, mood.tint);
    const ground = frame.filter((polygon) => !polygon.stroke && polygon.layer <= VOLUME_LAYER_GROUND);
    const floor = ground.find((polygon) => polygon.pick === "пол");
    assert.ok(floor, "пол комнаты в кадре — иначе стенд ничего не проверяет");
    let x = 0;
    let y = 0;
    for (let i = 0; i < floor.xy.length; i += 2) {
      x += floor.xy[i];
      y += floor.xy[i + 1];
    }
    x /= floor.xy.length / 2;
    y /= floor.xy.length / 2;
    const here = ground.filter((polygon) => inside(polygon.xy, x, y));
    const shadows = here.filter((polygon) => polygon.pick === "тень");
    if (mood.shadow.fade > 0) {
      assert.ok(shadows.length > 0, "в " + hour + ":00 тень не дотягивается до середины комнаты — стенд пуст");
      // Та самая дальность, на которую полагался таск 178: хотя бы в одном часе
      // тень **ближе** пола, то есть по дальности она бы его и закрасила.
      if (shadows.some((polygon) => polygon.depth < floor.depth)) nearerSomewhere = true;
    }
    const last = here[here.length - 1];
    assert.equal(last.pick, "пол", "в " + hour + ":00 поверх пола легло что-то ещё: ярус " + last.layer);
    assert.ok(
      shadows.every((polygon) => polygon.layer < floor.layer),
      "тень обязана лежать ярусом ниже пола, а не рядом с ним",
    );
  }
  assert.ok(nearerSomewhere, "ни в один час тень не оказалась ближе пола — стенд перестал ловить D49");
});

// ——— таск 196: солнце входит в комнату через проёмы (D51, G301) ——————————
//
// Внутреннего света в сборке не было никогда: тень дома лежит на земле, а
// внутри комнат её не видно ярусом (D49). Здесь проверяется то, чего не было, —
// пятно, которое солнце кладёт на пол через проём, и четыре правила, которыми
// оно живёт: ярус, сторона света, контур комнаты и штора перед проёмом.

const SUN_DAY = { riseMin: 540, setMin: 1260 };
const moodAt = (hour, project = null) =>
  volumeMood({
    minutes: hour * 60,
    times: SUN_DAY,
    kind: "nature",
    topDeg: project ? projectTopAzimuth(project) : 0,
  });

/**
 * Комната с окном в **южной** стене (`walls[2]`, ось y = +1500): комната от неё
 * к северу, улица к югу — то есть ровно с той стороны, откуда в этих широтах
 * светит солнце. Окно 600 × 1400 на высоте 800: обычное кухонное.
 */
function sunScene(options = {}) {
  const scene = roomScene();
  const put = addOpening(scene.project, {
    wallId: scene.walls[options.wall === undefined ? 2 : options.wall],
    kind: options.kind || "window",
    atMm: options.atMm === undefined ? 1700 : options.atMm,
    widthMm: options.widthMm === undefined ? 600 : options.widthMm,
    heightMm: options.heightMm === undefined ? 1400 : options.heightMm,
    heightAboveFloorMm: options.heightAboveFloorMm === undefined ? 800 : options.heightAboveFloorMm,
    ...(options.kind === "door" ? { hinge: "start", swing: "left" } : {}),
  });
  return { ...scene, project: put.project, openingId: put.opening.id };
}

/** Две комнаты 8 × 3 м через общую стену с дверью и окно в южной стене левой. */
function twoRoomScene() {
  const base = planProject();
  let project = base.project;
  const corners = [
    { x: -4000, y: -1500 },
    { x: 4000, y: -1500 },
    { x: 4000, y: 1500 },
    { x: -4000, y: 1500 },
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
  const middle = addWall(project, {
    schemeId: base.schemeId,
    aMm: { x: 0, y: -1500 },
    bMm: { x: 0, y: 1500 },
    thicknessMm: 200,
  });
  project = middle.project;
  const outline = (name, from, to) => {
    const room = addRoom(project, name);
    project = room.project;
    project = addOutline(project, {
      schemeId: base.schemeId,
      roomId: room.room.id,
      points: [
        { x: from, y: -1400 },
        { x: to, y: -1400 },
        { x: to, y: 1400 },
        { x: from, y: 1400 },
      ].map((point) => fraction(project, base.schemeId, point)),
    }).project;
    return room.room.id;
  };
  const left = outline("Гостиная", -3900, -100);
  const right = outline("Спальня", 100, 3900);
  // Дверь в общей стене: обе её стороны — комнаты.
  const door = addOpening(project, {
    wallId: middle.wall.id,
    kind: "door",
    atMm: 1000,
    widthMm: 900,
    heightMm: 2100,
    heightAboveFloorMm: 0,
    hinge: "start",
    swing: "left",
  });
  project = door.project;
  // Окно в южной стене левой комнаты: `walls[2]` идёт от (4000, 1500) к
  // (−4000, 1500), то есть отступ 5000 приходится на x = −1000.
  const window = addOpening(project, {
    wallId: walls[2],
    kind: "window",
    atMm: 5000,
    widthMm: 1200,
    heightMm: 2200,
    heightAboveFloorMm: 0,
  });
  project = window.project;
  return {
    project,
    schemeId: base.schemeId,
    walls: [...walls, middle.wall.id],
    doorId: door.opening.id,
    windowId: window.opening.id,
    rooms: { left, right },
  };
}

test("через окно солнце кладёт на пол пятно, и ярус у пятна свой", () => {
  const scene = sunScene();
  const built = volumeScene(scene.project, scene.schemeId);
  assert.equal(built.sunSpots.length, 1, "проём сцены собран один");
  // Солнце ровно на юге и высоко: вынос считается в уме, и пятно целиком
  // влезает в комнату — числа можно назвать точно. `rise` 45° даёт вынос
  // «миллиметр на миллиметр высоты», `az` 90° — свет ровно вдоль −y.
  const faces = volumeSunSpotFaces(built.sunSpots, { az: 90, rise: 45, fade: 1 });
  assert.equal(faces.length, 1, "южное окно светит, когда солнце на юге");
  const spot = faces[0];
  assert.equal(spot.layer, VOLUME_LAYER_SUN, "ярус у пятна свой");
  assert.ok(VOLUME_LAYER_GROUND < VOLUME_LAYER_SUN && VOLUME_LAYER_SUN < VOLUME_LAYER_BODY, "выше полов, ниже тел");
  assert.ok(spot.flat, "пятно не затеняется лампой сцены: его светлота и есть свет");
  assert.ok(spot.n.z > 0, "пятно смотрит вверх");
  assert.ok(
    spot.p.every((point) => point.z === 0),
    "пятно лежит на нулевой отметке — там же, где пол",
  );
  // Пятно уехало от окна **прочь от солнца**: солнце на юге (+y), значит пятно
  // к северу от окна, то есть в сторону меньших y.
  const room = built.rooms[0].pointsMm;
  assert.ok(
    spot.p.every((point) => volumePointInside(point, room)),
    "пятно лежит внутри комнаты",
  );
  // Низ окна 800 мм сносится на 800, верх 2200 — на 2200; внутренняя грань
  // стены стоит на y = 1400. Значит пятно лежит от y = 600 до y = −800 и
  // шириной ровно в окно: 600 мм, от x = −300 до x = 300.
  const xs = spot.p.map((point) => Math.round(point.x)).sort((a, b) => a - b);
  const ys = spot.p.map((point) => Math.round(point.y)).sort((a, b) => a - b);
  assert.deepEqual(xs, [-300, -300, 300, 300], "пятно шириной в окно");
  assert.deepEqual(ys, [-800, -800, 600, 600], "низ окна снесён на 800, верх на 2200");
  assert.ok(Math.abs(volumeArea(spot.p) - 600 * 1400) < 1, "площадь пятна — окно, снесённое по высоте");
  // И настоящий час кладёт пятно туда же, только со скосом: солнце в полдень
  // стоит не ровно на юге, и параллелограмм перекошен.
  const noon = volumeSunSpotFaces(built.sunSpots, moodAt(12).shadow);
  assert.equal(noon.length, 1, "в полдень южное окно светит");
  assert.ok(
    noon[0].p.every((point) => volumePointInside(point, room)),
    "полуденное пятно вышло за комнату",
  );
});

test("солнце зашло или стоит за стеной — пятна нет", () => {
  const scene = sunScene();
  const built = volumeScene(scene.project, scene.schemeId);
  // Ночь: `fade` ноль, и луна пятен не даёт.
  for (const hour of [0, 3, 6, 23]) {
    const mood = moodAt(hour);
    assert.equal(mood.shadow.fade, 0, hour + ":00 — солнце под горизонтом");
    assert.deepEqual(volumeSunSpotFaces(built.sunSpots, mood.shadow), [], hour + ":00 даёт пятно");
  }
  // Сумерки гаснут тем же `fade`, что тень дома: пятно сводится к полу.
  const dim = volumeSunSpotFaces(built.sunSpots, { az: 90, rise: 45, fade: 0.5 });
  assert.equal(dim.length, 1);
  assert.deepEqual(dim[0].rgb, volumeSunSpotRgb(0.5));
  // Солнце с другой стороны стены: то же окно, тот же час, свет развёрнут на
  // полоборота — пятну негде лежать.
  assert.deepEqual(
    volumeSunSpotFaces(built.sunSpots, { az: 270, rise: 45, fade: 1 }),
    [],
    "окно светит, когда солнце за его стеной",
  );
  // Окно в северной стене той же комнаты не светит с юга вовсе.
  const north = sunScene({ wall: 0 });
  const builtNorth = volumeScene(north.project, north.schemeId);
  assert.equal(volumeSunSpotFaces(builtNorth.sunSpots, { az: 270, rise: 45, fade: 1 }).length, 1, "стенд пуст");
  assert.deepEqual(
    volumeSunSpotFaces(builtNorth.sunSpots, { az: 90, rise: 45, fade: 1 }),
    [],
    "северное окно светит с юга",
  );
});

test("пятно светлое, и его цвет — пол при самой светлой грани сцены", () => {
  // Пол — самая тёмная грань сцены (`volumeShade` вверх = 0,46), и пятно это
  // он же при светлоте 1. Отношение 2,17 — обратное тому 0,72, которым тень
  // темнит землю.
  const dim = volumeShade({ x: 0, y: 0, z: 1 });
  assert.ok(Math.abs(dim - 0.502) < 0.001, "светлота пола: " + dim.toFixed(3));
  assert.deepEqual(volumeSunSpotRgb(1), [170, 142, 110], "полный свет — пол без затенения");
  assert.deepEqual(volumeSunSpotRgb(1), VOLUME_FLOOR_RGB);
  // Погасшее пятно совпадает с полом точка в точку: ни ступеньки, ни канта.
  const floor = VOLUME_FLOOR_RGB.map((value) => Math.round(value * dim));
  assert.deepEqual(volumeSunSpotRgb(0), floor, "гаснет пятно в самый пол");
  assert.deepEqual(floor, [85, 71, 55]);
  // Пятно светлее пола ровно вдвое (1 / 0,502 = 1,99) — и это та же мера, что
  // у наружной тени, только в другую сторону: там земля × 0,72.
  assert.ok(Math.abs(volumeSunSpotRgb(1)[0] / floor[0] - 2) < 0.01, "пятно светлее пола вдвое");
  assert.ok(volumeSunSpotRgb(0.5)[0] > floor[0] && volumeSunSpotRgb(0.5)[0] < 170, "полусвет между полом и светом");
});

test("пятно обрезано контуром своей комнаты и в соседнюю не уходит", () => {
  const scene = twoRoomScene();
  const built = volumeScene(scene.project, scene.schemeId);
  // Низкое солнце: вынос больше комнаты, и без обрезки пятно ушло бы сквозь
  // стены. Высота 10° даёт от верха окна 2,2 м вынос 12,5 м при комнате в 2,8 м.
  const reach = 2200 / Math.tan((10 * Math.PI) / 180);
  assert.ok(reach > 12000, "стенд пуст: пятно и так влезает в комнату");
  const faces = volumeSunSpotFaces(built.sunSpots, { az: 90, rise: 10, fade: 1 });
  assert.equal(faces.length, 1, "светит одно окно: дверь между комнатами не светит");
  const left = built.rooms.find((room) => room.roomId === scene.rooms.left);
  const right = built.rooms.find((room) => room.roomId === scene.rooms.right);
  // Точка на самой кромке контура «внутри» не считается (луч задевает ребро),
  // поэтому обрезка проверяется габаритом комнаты и площадью, а не строгим
  // попаданием каждой вершины.
  for (const point of faces[0].p) {
    assert.ok(point.x >= -3900 - 1 && point.x <= -100 + 1, "пятно вышло за комнату по x: " + point.x);
    assert.ok(point.y >= -1400 - 1 && point.y <= 1400 + 1, "пятно вышло за комнату по y: " + point.y);
    assert.ok(!volumePointInside(point, right.pointsMm), "пятно уехало в соседнюю комнату");
  }
  assert.ok(volumePointInside({ x: -1600, y: 0 }, left.pointsMm), "стенд считает комнаты верно");
  // Обрезка оставила ровно полосу через комнату: окно 1200 мм на глубину 2800.
  assert.ok(Math.abs(volumeArea(faces[0].p) - 1200 * 2800) < 1, "обрезка съела не то: " + volumeArea(faces[0].p));
  // Без обрезки пятно было бы вчетверо длиннее комнаты — проверяется тем же
  // счётом, но по контуру, который заведомо шире дома.
  const wide = volumeClipPolygon(
    [{ x: -40000, y: -40000 }, { x: 40000, y: -40000 }, { x: 40000, y: 40000 }, { x: -40000, y: 40000 }],
    faces[0].p,
  );
  assert.ok(volumeArea(wide) <= volumeArea(faces[0].p) + 1, "пятно уже обрезано: второй раз резать нечего");
});

test("дверь между двумя комнатами пятна не даёт: светить в неё нечему", () => {
  const scene = twoRoomScene();
  const built = volumeScene(scene.project, scene.schemeId);
  const door = built.sunSpots.find((spot) => spot.openingId === scene.doorId);
  assert.ok(door, "дверь в списке проёмов есть");
  assert.ok(door.left && door.right, "у двери между комнатами обе стороны — комнаты");
  const window = built.sunSpots.find((spot) => spot.openingId === scene.windowId);
  assert.ok(
    Boolean(window.left) !== Boolean(window.right),
    "у окна наружной стены комната ровно с одной стороны, улица с другой",
  );
  // Ни в один час внутренняя дверь пятна не даёт — и это решение, а не промах:
  // свет сквозь неё был бы вторым шагом, то есть трассировкой.
  for (const hour of [8, 10, 12, 15, 18, 20]) {
    const faces = volumeSunSpotFaces([door], moodAt(hour).shadow);
    assert.deepEqual(faces, [], hour + ":00 — внутренняя дверь положила пятно");
  }
});

test("направление верха чертежа доезжает до пятна (G288)", () => {
  const scene = sunScene();
  const turned = setProjectSite(scene.project, { topAzimuthDeg: 180 }).project;
  const built = volumeScene(turned, scene.schemeId);
  // Верх чертежа развёрнут на юг: то же окно смотрит теперь на север, и в
  // полдень оно не светит. Час один и тот же — меняется только чертёж.
  const plain = volumeSunSpotFaces(built.sunSpots, moodAt(12).shadow);
  assert.equal(plain.length, 1, "без поворота окно светит");
  const spun = volumeSunSpotFaces(built.sunSpots, moodAt(12, turned).shadow);
  assert.deepEqual(spun, [], "развёрнутый чертёж — и южное окно стало северным");
  assert.equal(projectTopAzimuth(turned), 180);
});

test("закрытая штора гасит пятно своего окна, открытая — пропускает (G301)", () => {
  const scene = sunScene();
  // Карниз штор у окна: метка с тюлевой моделью, привязанная к той же стене.
  // Окно стоит отступом 1700…2300 от конца стены (4000, 1500), то есть по
  // x = −300…300; штора в 400 мм закрывает две трети его ширины.
  const put = markAt(scene.project, scene.schemeId, "КШ", [{ x: 0, y: 1150 }]);
  const built = volumeScene(put.project, scene.schemeId);
  const place = built.marks.find((mark) => mark.markId === put.markId);
  assert.ok(volumeSheerPlace(place), "штора узнана по тюлевому телу модели, а не по коду типа");
  assert.equal(built.sunSpots.length, 1);
  assert.equal(built.sunSpots[0].sheerMarkId, put.markId, "штора связана со своим проёмом");
  assert.deepEqual(volumeSunSpotFaces(built.sunSpots, moodAt(12).shadow), [], "закрытая штора пропустила солнце");
  // Открывание шторы — отметка состояния, как у двери (G207), и счёт пятна от
  // неё не меняется: та же сцена, тот же час, в объекте ни строки.
  const open = volumeScene(put.project, scene.schemeId, { openCurtainIds: new Set([put.markId]) });
  assert.equal(open.sunSpots[0].sheerMarkId, null, "открытая штора проём не держит");
  assert.equal(volumeSunSpotFaces(open.sunSpots, moodAt(12).shadow).length, 1, "за открытой шторой пятно вернулось");
  assert.equal(volumeCurtainOpen(new Set([put.markId]), put.markId), true);
  assert.equal(volumeCurtainOpen(null, put.markId), false, "список пустой — закрыты все");
  assert.equal(JSON.stringify(put.project), JSON.stringify(volumeScene(put.project, scene.schemeId) && put.project));
});

test("штора гасит только то, что закрывает: порог — половина ширины проёма", () => {
  // Широкое окно 2200 мм и та же штора в 400: перекрытие 0,18 — пятно остаётся.
  const wide = sunScene({ atMm: 900, widthMm: 2200 });
  const put = markAt(wide.project, wide.schemeId, "КШ", [{ x: 0, y: 1150 }]);
  const built = volumeScene(put.project, wide.schemeId);
  assert.equal(built.sunSpots[0].sheerMarkId, null, "четверть окна не гасит пятно целиком");
  assert.equal(volumeSunSpotFaces(built.sunSpots, moodAt(12).shadow).length, 1);
  assert.equal(VOLUME_SHEER_SHARE, 0.5);
  // Штора на **другой** стене того же помещения проём не держит: правило
  // спрашивает стену, а не расстояние.
  const side = sunScene();
  const aside = markAt(side.project, side.schemeId, "КШ", [{ x: 1850, y: 0 }]);
  const near = volumeScene(aside.project, side.schemeId);
  const place = near.marks.find((mark) => mark.markId === aside.markId);
  assert.ok(volumeSheerPlace(place), "штора на боковой стене — тоже штора");
  assert.notEqual(place.wallId, near.sunSpots[0].wallId, "и висит она на другой стене");
  assert.equal(near.sunSpots[0].sheerMarkId, null, "чужая стена погасила пятно");
});

test("в кадре пятно ложится поверх пола и под телами, а земля сквозь пол не светит", () => {
  // Окно от пола до верха: у такого пятно начинается у самой стены и попадает
  // в комнату в любой час, когда солнце с его стороны.
  const scene = sunScene({ heightAboveFloorMm: 0, heightMm: 2200, widthMm: 1200, atMm: 1400 });
  const built = volumeScene(scene.project, scene.schemeId);
  const named = {
    ...built,
    order: undefined,
    faces: built.faces.map((face) =>
      face.layer === VOLUME_LAYER_GROUND && face.n.z > 0 ? { ...face, markId: "пол" } : face,
    ),
  };
  const box = { width: 972, height: 778 };
  const camera = volumeAroundCamera({ x: 0, y: 0, z: 0 }, 0.6, -0.73, 14000);
  const inside = (xy, x, y) => {
    let hit = false;
    for (let i = 0, j = xy.length - 2; i < xy.length; j = i, i += 2) {
      const ax = xy[i];
      const ay = xy[i + 1];
      const bx = xy[j];
      const by = xy[j + 1];
      if (ay > y !== by > y && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) hit = !hit;
    }
    return hit;
  };
  let seen = 0;
  for (const hour of [6, 10, 12, 15, 19]) {
    const mood = moodAt(hour);
    const shadow = volumeShadowFaces(built.shadowBoxes, mood.shadow).map((face) => ({ ...face, markId: "тень" }));
    const spots = volumeSunSpotFaces(built.sunSpots, mood.shadow).map((face) => ({ ...face, markId: "пятно" }));
    const frame = volumeFrame(named, camera, box, [...shadow, ...spots], mood.tint);
    const ground = frame.filter((polygon) => !polygon.stroke && polygon.layer <= VOLUME_LAYER_SUN);
    const floor = ground.find((polygon) => polygon.pick === "пол");
    assert.ok(floor, "пол комнаты в кадре");
    // Точка, в которой пятно лежит: его собственная середина.
    const spot = ground.find((polygon) => polygon.pick === "пятно");
    if (!spot) continue;
    seen += 1;
    let x = 0;
    let y = 0;
    for (let i = 0; i < spot.xy.length; i += 2) {
      x += spot.xy[i];
      y += spot.xy[i + 1];
    }
    x /= spot.xy.length / 2;
    y /= spot.xy.length / 2;
    const here = ground.filter((polygon) => inside(polygon.xy, x, y));
    assert.equal(here[here.length - 1].pick, "пятно", hour + ":00 — поверх пятна легло что-то ещё");
    assert.ok(
      here.some((polygon) => polygon.pick === "пол"),
      hour + ":00 — пятно лежит не на полу, а на земле",
    );
    assert.ok(
      here.every((polygon) => polygon.pick !== "тень" || polygon.layer < floor.layer),
      "наружная тень осталась ниже пола (D49)",
    );
    // Тела комнаты рисуются после пятна: стены и вещи его закрывают.
    const body = frame.find((polygon) => polygon.layer === VOLUME_LAYER_BODY);
    assert.ok(body, "тела в кадре");
    assert.ok(frame.indexOf(spot) < frame.indexOf(body), "пятно легло после тел");
  }
  assert.ok(seen >= 3, "пятно попало в кадр меньше чем в трёх часах — стенд пуст");
});

test("обрезка выпуклым отсекателем режет и невыпуклый контур", () => {
  // Г-образная комната: отсекатель выпуклый, отсекаемое — нет.
  const room = [
    { x: 0, y: 0 },
    { x: 4000, y: 0 },
    { x: 4000, y: 2000 },
    { x: 2000, y: 2000 },
    { x: 2000, y: 4000 },
    { x: 0, y: 4000 },
  ];
  const whole = volumeClipPolygon(room, [
    { x: -1000, y: -1000 },
    { x: 5000, y: -1000 },
    { x: 5000, y: 5000 },
    { x: -1000, y: 5000 },
  ]);
  assert.ok(Math.abs(volumeArea(whole) - volumeArea(room)) < 1, "отсекатель шире комнаты — комната целиком");
  // Полоса по правому крылу: вырезается только то, что в крыле и есть.
  const band = volumeClipPolygon(room, [
    { x: 2500, y: -500 },
    { x: 3500, y: -500 },
    { x: 3500, y: 4500 },
    { x: 2500, y: 4500 },
  ]);
  assert.ok(Math.abs(volumeArea(band) - 1000 * 2000) < 1, "площадь полосы: " + volumeArea(band));
  // Обход отсекателя не значит ничего: тот же ответ при обратном порядке.
  const back = volumeClipPolygon(room, [
    { x: 2500, y: 4500 },
    { x: 3500, y: 4500 },
    { x: 3500, y: -500 },
    { x: 2500, y: -500 },
  ]);
  assert.ok(Math.abs(volumeArea(back) - volumeArea(band)) < 1, "обход отсекателя поменял ответ");
  assert.deepEqual(volumeClipPolygon(room, [{ x: 9000, y: 9000 }, { x: 9500, y: 9000 }, { x: 9500, y: 9500 }]), []);
  assert.equal(VOLUME_SUN_PROBE_MM, 150);
});

// ——— D52: земля сцены и земля фона — одна мера —————————————————————————————
//
// Слова заказчика: «но пол дома всё равно летает, вот границей перекрыл
// машинки», «Фундамент в воздухе относительно фона». Две земли считались
// по-разному: сцена — настоящей плоскостью по габариту чертежа, фон — заливкой
// ниже строки горизонта с вещами **на бесконечности**. Числа — у
// `volumeGroundScale`; здесь проверяется, что мера одна.

test("земля фона начинается ровно там, где кончается земля сцены (D52)", () => {
  const scene = roomScene();
  const built = volumeScene(scene.project, scene.schemeId);
  const land = built.landMm;
  assert.ok(land, "плита работает землёй — у неё есть прямоугольник");
  // Кромка плиты от середины чертежа — полудиагональ, и считается она от
  // выноса под тень дома: `volumeShadowShift` при полуденной высоте плюс запас.
  const out = Math.hypot(...Object.values(volumeShadowShift(2700))) + VOLUME_LAND_OUT_MM;
  assert.ok(Math.abs(land.maxX - (2000 + out)) < 1, "вынос плиты считается тенью дома");
  const reach = Math.hypot((land.maxX - land.minX) / 2, (land.maxY - land.minY) / 2);
  // Человек стоит: кромка плиты видна под малым углом, и земля фона отодвинута
  // так, что её самое близкое колено ложится ровно на эту кромку.
  const camera = { at: { x: 0, y: 0, z: VOLUME_EYE_MM }, yaw: 0, pitch: 0 };
  const push = volumeGroundScale(camera, land);
  assert.ok(push > 0 && push < 1, "земля фона отодвинута: " + push.toFixed(3));
  const edgeDeg = (Math.atan(VOLUME_EYE_MM / reach) * 180) / Math.PI;
  const box = { width: 1400, height: 900 };
  const aim = volumeSkyAim(camera, box, push);
  const nearest = volumeSkyPoint(aim, 0, -VOLUME_PANORAMA_NEAR_DEG);
  const edge = volumeSkyPoint(volumeSkyAim(camera, box), 0, -edgeDeg);
  assert.ok(Math.abs(nearest.y - edge.y) < 0.5, "ближнее колено панорамы не село на кромку плиты");
  // Всё остальное — дальше кромки, то есть выше её на экране.
  for (const rise of [-9.3, -6.9, -4.2, -0.6]) {
    const point = volumeSkyPoint(aim, 0, rise);
    assert.ok(point.y <= edge.y + 0.5, rise + "° осталось ближе кромки: y " + point.y.toFixed(0));
  }
  // Угловой размер уехавшей вещи уменьшается тем же множителем.
  const plain = volumeSkyPoint(volumeSkyAim(camera, box), 0, -7.5);
  const moved = volumeSkyPoint(aim, 0, -7.5);
  assert.ok(Math.abs(moved.scale / plain.scale - push) < 0.02, "дерево отодвинули, а размер оставили");
  // Небо не двигается вовсе: отодвигать бесконечность некуда.
  for (const rise of [0, 2.6, 16]) {
    assert.deepEqual(volumeSkyPoint(aim, 30, rise), volumeSkyPoint(volumeSkyAim(camera, box), 30, rise));
  }
});

test("ближе кромки земля фона не придвигается, а дальше — стоит как стояла", () => {
  const scene = roomScene();
  const land = volumeScene(scene.project, scene.schemeId).landMm;
  // Обзор: камера поднята, кромка плиты ушла глубоко под горизонт — панорама
  // остаётся ровно той, что была до таска 196.
  const around = volumeAroundCamera({ x: 0, y: 0, z: 0 }, 0, -0.73, 20000);
  assert.equal(volumeGroundScale(around, land), 1, "обзор панораму не двигает");
  // Поднялись на второй этаж — кромка видна ниже, и кольцу можно подойти ближе.
  const first = volumeGroundScale({ at: { x: 0, y: 0, z: VOLUME_EYE_MM } }, land);
  const second = volumeGroundScale({ at: { x: 0, y: 0, z: 2800 + VOLUME_EYE_MM } }, land);
  assert.ok(second > first, "со второго этажа кольцо дальше, чем с первого");
  // Нет земли — нечего и отодвигать: плита работает полом (помещения не
  // обведены), и фон остаётся прежним.
  const bareScene = roomScene({ room: false });
  const bare = volumeScene(bareScene.project, bareScene.schemeId);
  assert.equal(bare.landMm, null, "плита-пол землёй не считается");
  assert.equal(volumeGroundScale({ at: { x: 0, y: 0, z: VOLUME_EYE_MM } }, null), 1);
  // Шаг человека панораму не колышет: мера считается от середины чертежа.
  const here = volumeGroundScale({ at: { x: 0, y: 0, z: VOLUME_EYE_MM } }, land);
  const there = volumeGroundScale({ at: { x: 1800, y: -1200, z: VOLUME_EYE_MM } }, land);
  assert.equal(here, there, "фон задышал при шаге");
});

test("светило и звёзды смотрят своим прицелом, а не земным (D52)", () => {
  const box = { x: 0, y: 0, width: 1280, height: 720 };
  const seen = [];
  const fade = { addColorStop: () => {} };
  const ctx = {
    createLinearGradient: () => fade,
    beginPath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    closePath: () => {},
    fill: () => {},
    fillRect: () => {},
    arc: (x, y, r) => seen.push([Math.round(x), Math.round(y), Math.round(r)]),
    ellipse: (x, y, r) => seen.push([Math.round(x), Math.round(y), Math.round(r)]),
    save: () => {},
    restore: () => {},
    fillStyle: "",
  };
  const camera = { at: { x: 0, y: 0, z: VOLUME_EYE_MM }, yaw: (90 * Math.PI) / 180, pitch: -0.08 };
  const mood = volumeMood({ minutes: 10 * 60, times: SUN_DAY, kind: "plain" });
  volumeDrawBackdrop(ctx, box, camera, mood);
  const bare = [...seen];
  seen.length = 0;
  // Та же минута, тот же ракурс, но у сцены есть земля: светило обязано
  // остаться на месте — кромка плиты ему не указ.
  volumeDrawBackdrop(ctx, box, camera, mood, { minX: -18000, minY: -18000, maxX: 18000, maxY: 18000 });
  assert.deepEqual(seen, bare, "светило уехало вместе с землёй фона");
  assert.ok(bare.length > 0, "стенд пуст: светило не нарисовано");
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

// ——— дефект D39: «застревает и начинает прыгать» ————————————————————————
//
// Стенд — два препятствия, которые требуют разного. Просвет 250 мм между
// гранями стен при диаметре тела 440: нижняя стена толкает на +190, верхняя на
// −190. Прежний код двигал тело по очереди и оставлял последнее слово за
// последним в списке — то есть за порядком стен в объекте.

function slotSolids() {
  const wall = (cy) => ({ cx: 0, cy, ux: 1, uy: 0, nx: 0, ny: -1, half: 2000, halfT: 50, bottomMm: 0, topMm: 2800 });
  return [wall(-200), wall(200)];
}

test("тесное место не дрожит: выталкивание стоит на месте и не зависит от порядка стен", () => {
  const solids = slotSolids();
  const at = { x: 0, y: 0 };
  const once = volumePush(solids, at, VOLUME_BODY_MM);
  // Требования погасили друг друга — человек остался там, где был.
  assert.equal(Math.round(once.x), 0);
  assert.equal(Math.round(once.y), 0);
  // Второй раз — то же место: цикла длиной два больше нет.
  const twice = volumePush(solids, once, VOLUME_BODY_MM);
  assert.ok(Math.hypot(twice.x - once.x, twice.y - once.y) < 0.01, "выталкивание не неподвижно");
  // И порядок препятствий ничего не решает.
  const flipped = volumePush([...solids].reverse(), at, VOLUME_BODY_MM);
  assert.ok(Math.hypot(flipped.x - once.x, flipped.y - once.y) < 0.01, "порядок стен сменил ответ");
});

test("в тесном месте шаг не дёргает человека, а вдоль него пускает", () => {
  const scene = { solids: slotSolids() };
  // Жмём «вперёд» поперёк щели: шага нет вовсе, и места не меняются.
  let at = { x: 0, y: 0 };
  const seen = [];
  for (let frame = 0; frame < 30; frame += 1) {
    at = volumeStep(scene, at, 0, 40);
    seen.push({ ...at });
  }
  for (const point of seen) {
    assert.ok(Math.hypot(point.x, point.y) < 0.01, "человек съехал с места: " + JSON.stringify(point));
  }
  // А вдоль щели — идёт: выйти из тесного места можно всегда.
  let along = { x: 0, y: 0 };
  for (let frame = 0; frame < 30; frame += 1) along = volumeStep(scene, along, 40, 0);
  assert.ok(along.x > 1000, "вдоль щели не пошёл: " + Math.round(along.x));
});

test("перенос в тесное место ставит рядом, а не в щель (D39)", () => {
  const scene = { solids: slotSolids(), boundsMm: null };
  const put = volumeMoveTo(scene, { x: 0, y: 0 });
  assert.equal(volumeDepthMm(scene.solids, put.x, put.y), 0, "встали в щель шириной 250 мм");
  // «Рядом» — именно рядом: от показанного места не дальше метра.
  assert.ok(Math.hypot(put.x, put.y) <= 1000, "ушли далеко от показанного: " + Math.round(Math.hypot(put.x, put.y)));
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
          // непрозрачной, иначе точка закрашена не той поверхностью. Плотность
          // берётся **у самой грани** (таск 189): их теперь две — 0,4 у вещи и
          // 0,6 у ткани шторы, — и подставить сюда одну константу значило бы
          // сверять кадр не с ним самим.
          truth = { t, fill: volumeFill(face.rgb, volumeShade(normal), face.alpha === undefined ? 1 : face.alpha) };
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

// ——— час суток: одно непрерывное время (таск 181, G282) ———————————————————
//
// «сразу заложи по фону что бы можно было указывать время суток и фон менялся,
// утро, день, вечер, ночь. при чем плавно менялся… ночь не сильно тёмная должна
// быть, что бы было понятно что ночь, но различимо всё».

const DAY_TIMES = { riseMin: VOLUME_SUNRISE_MIN, setMin: VOLUME_SUNSET_MIN, north: true };

test("часы объёма: идущее время — формула, стоячее не идёт вовсе", () => {
  const start = volumeClockNow(1000, new Date(2026, 9, 20, 12, 30), 60);
  assert.equal(volumeClockMinutes(start, 1000), 12 * 60 + 30, "при открытии стоит реальное время");
  assert.equal(start.fromDay, volumeDayNumberOf(new Date(2026, 9, 20)), "и реальная дата (G289)");
  // Минута настоящего времени при ускорении 60 — час в объёме.
  assert.equal(volumeClockMinutes(start, 1000 + 60000), 13 * 60 + 30);
  // Сутки проходят за 24 минуты — и это ровно то, что написано в подписи.
  assert.equal(volumeClockDayMinutes(60), 24);
  assert.deepEqual(VOLUME_CLOCK_SPEEDS.map(volumeClockDayMinutes), [1440, 24, 12, 6, 3, 1.5]);
  // «Без ускорения» — первым пунктом, и это идущее время: сутки идут сутки
  // (G287).
  assert.equal(VOLUME_CLOCK_SPEEDS[0], VOLUME_CLOCK_SPEED_REAL);
  assert.equal(VOLUME_CLOCK_SPEED_REAL, 1);
  assert.equal(volumeClockDayMinutes(VOLUME_CLOCK_SPEED_REAL), VOLUME_DAY_MIN);
  const real = volumeClockNow(1000, new Date(2026, 9, 20, 12, 30), VOLUME_CLOCK_SPEED_REAL);
  assert.equal(real.fixed, false, "единица — идущее время, а не стоячее");
  assert.equal(volumeClockMinutes(real, 1000 + 60000), 12 * 60 + 31, "минута снаружи — минута внутри");
  // Через полночь время не ломается, а **дата переводится** (G289).
  assert.equal(volumeClockMinutes(start, 1000 + 12 * 60000), 0 * 60 + 30);
  assert.equal(volumeClockStamp(start, 1000 + 12 * 60000).day, start.fromDay + 1, "сутки кончились — число сменилось");
  assert.equal(volumeClockStamp(start, 1000 + 11 * 60000).day, start.fromDay, "до полуночи — то же число");
  // При ускорении 960 полночь приходит каждые полторы минуты настоящего
  // времени: случай не книжный, он живой.
  const fast = volumeClockNow(0, new Date(2026, 9, 20, 23, 0), 960);
  assert.equal(volumeClockStamp(fast, 0).day, fast.fromDay);
  assert.equal(volumeClockStamp(fast, 62_500).day, fast.fromDay + 1, "час до полуночи при 960 — это 62,5 с");
  assert.equal(volumeClockStamp(fast, 62_500 + 90_000).day, fast.fromDay + 2, "и дальше по сутками за 90 с");
  // Назад через полночь — тоже сутки назад, а не нулевой день.
  const back = { ...start, atMs: 1000 + 13 * 60000 };
  assert.equal(volumeClockStamp(back, 1000).day, start.fromDay - 1, "время, отведённое назад, уводит и число");
  assert.equal(volumeClockStamp(back, 1000).minutes, 23 * 60 + 30);
  // Стоячее время не зависит от того, сколько прошло снаружи: ни пересчёта, ни
  // перерисовки — это и есть «при фиксированном времени фон не меняется вовсе».
  const fixed = volumeClockFixed(23 * 60 + 15, 240, 20000);
  assert.equal(volumeClockMinutes(fixed, 1000), 23 * 60 + 15);
  assert.equal(volumeClockMinutes(fixed, 9e9), 23 * 60 + 15);
  assert.equal(volumeClockStamp(fixed, 9e9).day, 20000, "и число стоит вместе с часом");
  // Смена ускорения не сдвигает время: часы перецепляются за ту минуту, которую
  // показывают. Иначе выбор «быстрее» прыгал бы временем.
  const faster = volumeClockAt(start, 1000 + 60000, 960);
  assert.equal(volumeClockMinutes(faster, 1000 + 60000), 13 * 60 + 30);
  assert.equal(faster.speed, 960);
  assert.equal(faster.fromDay, start.fromDay, "и дату не трогает");
  const overnight = volumeClockAt(start, 1000 + 12 * 60000, 1);
  assert.equal(overnight.fromDay, start.fromDay + 1, "перецепка за полночью помнит новые сутки");
  assert.equal(volumeClockAt(fixed, 7777, 120).fixed, true, "стоячие часы остаются стоячими");
  assert.equal(volumeClockAt(fixed, 7777, 120).fromDay, 20000);
  // Другое число — без правки часа и хода (поле даты в окне).
  const moved = volumeClockOnDay(start, 1000 + 60000, start.fromDay + 10);
  assert.equal(moved.fromDay, start.fromDay + 10);
  assert.equal(volumeClockMinutes(moved, 1000 + 60000), 13 * 60 + 30, "час остался тем же");
  assert.equal(moved.fixed, false, "и время идёт дальше");
  assert.equal(volumeClockOnDay(fixed, 9e9, 20005).fixed, true, "стоячим часам дата не даёт хода");
  assert.equal(volumeClockOnDay(start, 1000, "мусор").fromDay, start.fromDay, "мусор числа не меняет");
  // Чужое ускорение не берётся: в списке ровно шесть пунктов.
  assert.equal(volumeClockSpeedOf(7), VOLUME_CLOCK_SPEED_DEFAULT);
  assert.equal(volumeClockSpeedOf("480"), 480, "строку из настроек читаем числом");
  assert.equal(volumeClockSpeedOf(480), 480);
  assert.equal(volumeClockSpeedOf(1), 1);
});

test("дата — номер суток: читается, пишется и не зависит от часового пояса (G289)", () => {
  const day = volumeDayNumberOf(new Date(2026, 9, 20, 23, 59));
  assert.equal(volumeDateText(day), "2026-10-20", "вечер не уезжает в соседние сутки");
  assert.equal(volumeDayNumberOf(new Date(2026, 9, 20, 0, 1)), day, "и утро тоже");
  assert.equal(volumeDateParse("2026-10-20"), day);
  assert.equal(volumeDateText(volumeDateParse("2026-01-01")), "2026-01-01");
  assert.equal(volumeDateText(volumeDateParse("2026-12-31")), "2026-12-31");
  assert.equal(volumeDateParse("2026-02-30"), null, "тридцатого февраля не бывает — и мы не переносим в март");
  assert.equal(volumeDateParse("20.10.2026"), null);
  assert.equal(volumeDateParse(""), null);
  assert.equal(volumeDateParse("вчера"), null);
  // Сутки туда и обратно: год целиком, без сдвига на день.
  for (let shift = 0; shift < 365; shift += 1) {
    assert.equal(volumeDateParse(volumeDateText(day + shift)), day + shift, "сутки " + shift);
  }
  // Переход на летнее время (в Европе — последнее воскресенье марта) номер
  // суток не сдвигает: он считается по дате, а не по миллисекундам.
  const march = volumeDayNumberOf(new Date(2026, 2, 29, 3, 30));
  assert.equal(volumeDateText(march), "2026-03-29");
  assert.equal(volumeDayDateOf(march).getDate(), 29);
});

// ——— полоса часов в углу поля (таск 191, G300) ————————————————————————————
//
// «Справа снизу в Объёме пиши текущие дату и время симуляции». Строку собирают
// две чистые двери — дата по-человечески и час, — а место полосы живёт в
// стилях (`test/fieldBare.test.js`).

test("дата в полосе часов читается глазом, а ISO остаётся полю ввода", () => {
  const day = volumeDayNumberOf(new Date(2026, 9, 20, 23, 59));
  assert.equal(volumeDateShort(day), "20.10.2026", "в углу поля дата по-человечески");
  assert.equal(volumeDateText(day), "2026-10-20", "а у поля ввода — та, которую просит браузер");
  // Ноль впереди стоит у обоих — иначе строка прыгала бы в ширине на каждом
  // переходе через десятое число.
  assert.equal(volumeDateShort(volumeDateParse("2026-01-01")), "01.01.2026");
  assert.equal(volumeDateShort(volumeDateParse("2026-12-31")), "31.12.2026");
  // Год целиком: человек вправе поставить другой, и «20.10.26» читалось бы как
  // день месяца. Проверено на годе целиком — сдвига на сутки нет нигде.
  for (let shift = 0; shift < 365; shift += 1) {
    const text = volumeDateShort(day + shift);
    const back = volumeDateParse(text.slice(6) + "-" + text.slice(3, 5) + "-" + text.slice(0, 2));
    assert.equal(back, day + shift, "сутки " + shift);
  }
});

test("контрол с часами: строка и разбор", () => {
  assert.equal(volumeClockText(0), "00:00");
  assert.equal(volumeClockText(9 * 60 + 5), "09:05");
  assert.equal(volumeClockText(23 * 60 + 59.7), "23:59", "секунды не округляют минуту вверх");
  assert.equal(volumeClockText(1440 + 75), "01:15", "сутки заворачиваются");
  assert.equal(volumeClockParse("09:30"), 570);
  assert.equal(volumeClockParse("9:5"), 545);
  assert.equal(volumeClockParse("24:00"), null);
  assert.equal(volumeClockParse("12:60"), null);
  assert.equal(volumeClockParse(""), null);
  assert.equal(volumeClockParse("вечер"), null);
});

test("рассвет и закат: умолчание заказчика, а с координатами — по ним", () => {
  // Нет координат — 9:00 и 21:00, прямые слова заказчика.
  const plain = volumeDayTimes(volumeSiteOf(createProject()), new Date(2026, 5, 21, 12));
  assert.equal(plain.riseMin, 9 * 60);
  assert.equal(plain.setMin, 21 * 60);
  assert.equal(plain.bySite, false);
  // Мусор в координатах — тоже умолчание: объём не гадает.
  assert.equal(volumeDayTimes({ latDeg: "север", lonDeg: 37 }).bySite, false);
  assert.equal(volumeDayTimes({ latDeg: 555, lonDeg: 37 }).bySite, false);
  assert.equal(volumeDayTimes(null).riseMin, 9 * 60);
  // Есть координаты — считается по ним. Москва в июне: день длиннее 17 часов,
  // в декабре — короче 7.5. Числа проверяются мерой, а не минутой: уравнения
  // времени здесь нет нарочно (до четверти часа), и минуту обещать нельзя.
  const site = { latDeg: 55.7558, lonDeg: 37.6173 };
  const june = volumeDayTimes(site, new Date(2026, 5, 21, 12));
  const december = volumeDayTimes(site, new Date(2026, 11, 21, 12));
  assert.equal(june.bySite, true);
  const hours = (times) => (times.setMin - times.riseMin) / 60;
  assert.ok(hours(june) > 17 && hours(june) < 17.8, "июньский день в Москве: " + hours(june));
  assert.ok(hours(december) > 6.9 && hours(december) < 7.6, "декабрьский день: " + hours(december));
  assert.ok(june.riseMin < december.riseMin, "в июне светает раньше");
  // Полярная ночь и полярный день не ломают счёт, а честно отвечают сутками.
  const polar = { latDeg: 78.2, lonDeg: 15.6 };
  const dark = volumeDayTimes(polar, new Date(2026, 11, 21, 12));
  assert.equal(dark.setMin - dark.riseMin, 0, "полярная ночь: дня нет вовсе");
  assert.equal(volumeSunAt(720, dark).up, false, "и солнце в полдень не встаёт");
  const light = volumeDayTimes(polar, new Date(2026, 5, 21, 12));
  assert.equal(light.setMin - light.riseMin, VOLUME_DAY_MIN, "полярный день: сутки целиком день");
  assert.equal(volumeSunAt(60, light).up, true, "и в час ночи солнце над горизонтом");
});

test("место объекта объём читает чужой дверью — свойствами объекта (таск 188)", () => {
  // Сегодняшний объект свойств не знает вовсе — и это не ошибка.
  const bare = volumeSiteOf(createProject());
  assert.equal(bare.latDeg, null);
  assert.equal(bare.lonDeg, null);
  assert.equal(bare.topDeg, 0, "верх чертежа смотрит на север");
  assert.deepEqual(volumeSiteOf(null), { latDeg: null, lonDeg: null, topDeg: 0 });
  // Координаты и направление живут в свойствах объекта (G283, G284), и хозяин
  // у них один — `projectCoords`/`projectTopAzimuth`. Своего разбора у объёма
  // нет: разойдись они, дом стоял бы в двух местах сразу.
  const sited = setProjectSite(createProject(), { coords: "55.7558, 37.6173", topAzimuthDeg: 90 }).project;
  assert.deepEqual(volumeSiteOf(sited), { latDeg: 55.7558, lonDeg: 37.6173, topDeg: 90 });
  assert.deepEqual(volumeSiteOf(sited), {
    latDeg: projectCoords(sited).lat,
    lonDeg: projectCoords(sited).lon,
    topDeg: projectTopAzimuth(sited),
  });
  // Половина пары — не точка: широта без долготы читается как «координат нет».
  const half = { ...sited, site: { ...sited.site, lon: null } };
  assert.equal(volumeSiteOf(half).latDeg, null);
  // И по этим координатам считается уже не умолчание.
  assert.equal(volumeDayTimes(volumeSiteOf(sited), new Date(2026, 5, 21, 12)).bySite, true);
  assert.equal(volumeDayTimes(volumeSiteOf(createProject()), new Date(2026, 5, 21, 12)).bySite, false);
});

test("утро, день, вечер и ночь — слова, а не состояния", () => {
  const phase = (hour) => volumeDayPhase(hour * 60, DAY_TIMES);
  assert.equal(phase(3), "night");
  assert.equal(phase(8), "morning", "утро начинается за час до рассвета");
  assert.equal(phase(11), "morning");
  assert.equal(phase(12), "day");
  assert.equal(phase(17), "day");
  assert.equal(phase(18), "evening");
  assert.equal(phase(21.5), "evening", "вечер держится час после заката");
  assert.equal(phase(22), "night");
  assert.equal(phase(0), "night");
  // Слова сдвигаются вместе с рассветом: это отрезки от светила, а не от
  // полуночи.
  const early = { riseMin: 4 * 60, setMin: 22 * 60, north: true };
  assert.equal(volumeDayPhase(4 * 60, early), "morning");
  assert.equal(volumeDayPhase(8 * 60, early), "day");
});

test("солнце стоит там, где стоит: высота и азимут по дате, времени и координатам (G288)", () => {
  // Сторона света панорамы: ноль смотрит вправо по листу, 90° — вниз. При верхе
  // чертежа на север вправо уходит восток, значит юг приходится на 90°.
  assert.equal(volumePanoramaAz(180, 0), 90, "юг при верхе на север — вниз по листу");
  assert.equal(volumePanoramaAz(90, 0), 0, "восток — вправо");
  assert.equal(volumePanoramaAz(270, 0), 180, "запад — влево");
  assert.equal(volumePanoramaAz(180, 90), 0, "верх смотрит на восток — юг уехал вправо");
  // ——— настоящая высота, а не число в коде ———
  //
  // Москва: в полдень 21 июня солнце стоит около 58°, 21 декабря — около 12°,
  // в равноденствие — 90° минус широта. Справочные числа — 57,5°, 10,6° и
  // 34,2°; сходимся в градус, и это сказано прямо: уравнения времени и
  // настоящей эклиптики здесь нет.
  const site = { latDeg: 55.7558, lonDeg: 37.6173 };
  const noonOf = (times) => volumeSunAt((times.riseMin + times.setMin) / 2, times);
  const june = volumeDayTimes(site, new Date(2026, 5, 21, 12));
  const december = volumeDayTimes(site, new Date(2026, 11, 21, 12));
  const march = volumeDayTimes(site, new Date(2026, 2, 20, 12));
  assert.ok(Math.abs(noonOf(june).rise - 57.5) < 1.5, "полдень в июне: " + noonOf(june).rise.toFixed(1));
  assert.ok(Math.abs(noonOf(december).rise - 10.6) < 1.5, "полдень в декабре: " + noonOf(december).rise.toFixed(1));
  assert.ok(Math.abs(noonOf(march).rise - (90 - site.latDeg)) < 1.5, "равноденствие: " + noonOf(march).rise.toFixed(1));
  assert.ok(noonOf(june).rise > 3 * noonOf(december).rise, "лето и зима обязаны различаться втрое, а не числом в коде");
  assert.equal(Math.round(noonOf(june).az), 90, "в полдень солнце на юге — вниз по листу");
  assert.equal(Math.round(noonOf(december).az), 90);
  // ——— рассвет и закат сходятся с подписью окна ———
  //
  // Высота отсчитана от того же горизонта (−0,833°), по которому посчитаны
  // рассвет и закат, поэтому её ноль приходится **ровно** на их минуту.
  for (const times of [june, december, march, volumeDayTimes(null)]) {
    assert.ok(Math.abs(volumeSunAt(times.riseMin, times).height) < 1e-6, "рассвет разошёлся с нулём высоты");
    assert.ok(Math.abs(volumeSunAt(times.setMin, times).height) < 1e-6, "закат разошёлся с нулём высоты");
    assert.equal(volumeSunAt(times.riseMin + 5, times).up, true, "через пять минут после рассвета солнце уже над горизонтом");
    assert.equal(volumeSunAt(times.riseMin - 5, times).up, false, "а за пять минут до него — ещё под ним");
  }
  // Восход на востоке, закат на западе — и летом севернее, зимой южнее.
  const compass = (az) => (az + 90 + 360) % 360;
  assert.ok(compass(volumeSunAt(june.riseMin + 1, june).az) < 60, "в июне светает на северо-востоке");
  assert.ok(compass(volumeSunAt(december.riseMin + 1, december).az) > 120, "в декабре — на юго-востоке");
  assert.ok(Math.abs(compass(volumeSunAt(march.riseMin + 1, march).az) - 90) < 2, "в равноденствие — ровно на востоке");
  assert.ok(compass(volumeSunAt(march.setMin - 1, march).az) > 268, "и садится ровно на западе");
  // ——— одна формула на оба случая ———
  //
  // По координатам часовой угол идёт настоящей угловой скоростью — 15° в час,
  // то есть 0,25° в минуту; без них та же дуга растягивается на окно заказчика.
  // Двух формул здесь нет, и видно это числом.
  assert.ok(Math.abs(volumeSkyPlace(june).hourScale - 0.25) < 1e-9, "по координатам растяжки нет вовсе");
  assert.ok(Math.abs(volumeSkyPlace(december).hourScale - 0.25) < 1e-9);
  assert.ok(volumeSkyPlace(volumeDayTimes(null)).hourScale > 0.25, "а окно 9:00…21:00 дугу растягивает");
  // ——— без координат остаются слова заказчика ———
  const plain = volumeDayTimes(volumeSiteOf(createProject()));
  assert.equal(plain.riseMin, 9 * 60);
  assert.equal(plain.setMin, 21 * 60);
  const plainNoon = volumeSunAt(15 * 60, plain);
  assert.ok(plainNoon.rise > 30 && plainNoon.rise < 40, "дуга всё равно настоящая: " + plainNoon.rise.toFixed(1));
  assert.equal(Math.round(plainNoon.az), 90, "верх дуги — на юге");
  assert.equal(volumeSunAt(12 * 60, plain).up, true);
  assert.equal(volumeSunAt(3 * 60, plain).up, false);
  // Непрерывность: за сутки высота не прыгает ни на шаге минуты. Настоящее
  // солнце у горизонта идёт быстрее нарисованной синусоиды — 0,15° в минуту
  // против 0,06°, — и это предел, а не оговорка.
  for (const times of [plain, june, december]) {
    let was = volumeSunAt(0, times).height;
    for (let minute = 1; minute <= VOLUME_DAY_MIN; minute += 1) {
      const now = volumeSunAt(minute % VOLUME_DAY_MIN, times).height;
      assert.ok(Math.abs(now - was) < 0.2, "скачок высоты на минуте " + minute);
      was = now;
    }
  }
  // Направление верха чертежа (таск 188) разворачивает светило вокруг дома и
  // больше ничего: иначе окна южной стороны освещались бы как северные.
  const turned = volumeSunAt((june.riseMin + june.setMin) / 2, june, 90);
  assert.equal(Math.round(turned.az) % 360, 0);
  assert.ok(Math.abs(turned.rise - noonOf(june).rise) < 1e-9, "высота от поворота листа не зависит");
  // В южном полушарии полдень на севере — и это выходит из той же формулы, без
  // отражённой дуги.
  const south = volumeDayTimes({ latDeg: -33.9, lonDeg: 151.2 }, new Date(2026, 0, 15, 12));
  const southNoon = noonOf(south);
  assert.equal(Math.round(southNoon.az), 270, "север при верхе на север — вверх по листу");
  assert.ok(southNoon.rise > 70, "в середине января в Сиднее солнце почти в зените: " + southNoon.rise.toFixed(1));
});

test("полярный день и полярная ночь выходят из той же формулы", () => {
  const polar = { latDeg: 78.2, lonDeg: 15.6 };
  const dark = volumeDayTimes(polar, new Date(2026, 11, 21, 12));
  assert.equal(dark.setMin - dark.riseMin, 0, "полярная ночь: дня нет вовсе");
  assert.equal(volumeSunAt(720, dark).up, false, "и солнце в полдень не встаёт");
  assert.ok(volumeSunAt(720, dark).rise < -5, "в полдень оно глубоко под горизонтом: " + volumeSunAt(720, dark).rise.toFixed(1));
  for (let minute = 0; minute < VOLUME_DAY_MIN; minute += 10) {
    assert.equal(volumeSunAt(minute, dark).up, false, "полярная ночь на минуте " + minute);
  }
  const light = volumeDayTimes(polar, new Date(2026, 5, 21, 12));
  assert.equal(light.setMin - light.riseMin, VOLUME_DAY_MIN, "полярный день: сутки целиком день");
  for (let minute = 0; minute < VOLUME_DAY_MIN; minute += 10) {
    assert.equal(volumeSunAt(minute, light).up, true, "полярный день на минуте " + minute);
  }
  // Полночь ниже полудня, но обе над горизонтом — это и есть незакатное солнце.
  assert.ok(volumeSunAt(0, light).rise > 5, "в полночь солнце над горизонтом");
  assert.ok(volumeSunAt(720, light).rise > volumeSunAt(0, light).rise + 10, "а в полдень выше");
});

test("месяц ходит своим путём, и фаза у него по лунному месяцу (G288, G290)", () => {
  const site = { latDeg: 55.7558, lonDeg: 37.6173 };
  const dayOf = (year, month, day) => volumeDayTimes(site, new Date(year, month, day, 12));
  // Возраст луны: от новолуния до новолуния — месяц, и ни суток больше.
  const first = volumeMoonAgeDays(volumeDayNumberOf(new Date(2000, 0, 6)), 18 * 60 + 14, 0);
  assert.ok(first < 0.01 || first > VOLUME_MOON_MONTH_DAYS - 0.01, "опорное новолуние: " + first.toFixed(3));
  const age = (times) => volumeMoonAgeDays(times.dayNumber, 0, times.tzHours);
  let was = age(dayOf(2026, 0, 1));
  let turns = 0;
  for (let day = 2; day <= 60; day += 1) {
    const now = age(dayOf(2026, 0, day));
    if (now < was) turns += 1;
    else assert.ok(Math.abs(now - was - 1) < 0.01, "возраст растёт по суткам: " + now.toFixed(2));
    was = now;
  }
  assert.equal(turns, 2, "за два месяца круг замкнулся дважды");
  // ——— весь круг фаз из одного числа ———
  //
  // Освещённая доля идёт от новолуния к полнолунию и обратно, и подписанная
  // полуось кромки (`edge`) проходит путь +1 → 0 → −1 → 0 → +1.
  const atAge = (want) => {
    // Подбираем дату и час, при которых возраст ближе всего к нужному.
    let best = null;
    for (let day = 0; day < 40; day += 1) {
      for (let hour = 0; hour < 24; hour += 1) {
        const times = dayOf(2026, 9, 1 + day);
        const got = volumeMoonAgeDays(times.dayNumber, hour * 60, times.tzHours);
        const miss = Math.abs(got - want);
        if (!best || miss < best.miss) best = { miss, times, minutes: hour * 60, got };
      }
    }
    return { ...best, moon: volumeMoonAt(best.minutes, best.times) };
  };
  const phases = [
    ["новолуние", 0, 0, 1],
    ["растущий серп", 3.7, 0.146, 0.707],
    ["первая четверть", 7.38, 0.5, 0],
    ["растущая горбатая", 11, 0.854, -0.707],
    ["полнолуние", 14.77, 1, -1],
    ["убывающая горбатая", 18.4, 0.854, -0.707],
    ["последняя четверть", 22.1, 0.5, 0],
    ["старый месяц", 25.8, 0.146, 0.707],
  ];
  for (const [name, want, lit, edge] of phases) {
    const got = atAge(want);
    assert.ok(Math.abs(got.moon.lit - lit) < 0.05, name + ": доля " + got.moon.lit.toFixed(3) + ", ждали " + lit);
    assert.ok(Math.abs(got.moon.edge - edge) < 0.07, name + ": кромка " + got.moon.edge.toFixed(3) + ", ждали " + edge);
  }
  // ——— луна не ходит по солнечной дуге ———
  //
  // Полная луна стоит всю ночь и прячется днём, молодой серп садится вслед за
  // солнцем — вот этим «свой путь» и отличается от прежней ночной дуги.
  const full = atAge(14.77);
  const midnight = volumeMoonAt(0, full.times);
  const noon = volumeMoonAt(720, full.times);
  assert.ok(midnight.rise > 30, "полная луна в полночь высоко: " + midnight.rise.toFixed(1));
  assert.ok(noon.rise < 0, "и в полдень её нет над горизонтом: " + noon.rise.toFixed(1));
  const young = atAge(3.5);
  const evening = volumeMoonAt(young.times.setMin + 30, young.times);
  assert.ok(evening.rise > 0, "молодой серп виден сразу после заката: " + evening.rise.toFixed(1));
  assert.ok(volumeMoonAt(young.times.setMin + 240, young.times).rise < evening.rise, "и садится вслед за солнцем");
  // Высота у луны своя: за месяц она обходит эклиптику целиком, то есть ходит
  // то высоко, то низко — на одной борозде её держать нельзя.
  let low = 90;
  let high = -90;
  for (let day = 0; day < 30; day += 1) {
    const times = dayOf(2026, 9, 1 + day);
    const best = Array.from({ length: 48 }, (unused, step) => volumeMoonAt(step * 30, times).rise).reduce(
      (most, value) => Math.max(most, value),
      -90,
    );
    low = Math.min(low, best);
    high = Math.max(high, best);
  }
  assert.ok(high - low > 20, "верхняя точка луны за месяц гуляет: от " + low.toFixed(0) + "° до " + high.toFixed(0) + "°");
  // Направление верха чертежа разворачивает и месяц.
  assert.equal(
    Math.round(volumeMoonAt(0, full.times, 90).az),
    Math.round((volumeMoonAt(0, full.times).az - 90 + 360) % 360),
  );
});

test("очерк месяца: серп на всех фазах и прямая кромка в четверть (D48, G290)", () => {
  const radius = 20;
  const area = (points) => {
    let sum = 0;
    for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
      sum += points[j].x * points[i].y - points[i].x * points[j].y;
    }
    return Math.abs(sum) / 2;
  };
  const disc = area(volumeMoonShape(radius, -1, 0));
  // Полнолуние — полный диск; площадь ломаной на 48 точках отстаёт от круга на
  // треть процента, и это единственная её неточность.
  assert.ok(Math.abs(disc - Math.PI * radius * radius) / (Math.PI * radius * radius) < 0.005, "полный диск: " + disc.toFixed(1));
  assert.ok(area(volumeMoonShape(radius, 1, 0)) < 1e-9, "новолуние — фигура без площади");
  // Площадь равна освещённой доле — на каждой фазе, а не только в четверти.
  for (let edge = -1; edge <= 1.0001; edge += 0.05) {
    const lit = (1 - edge) / 2;
    const got = area(volumeMoonShape(radius, edge, 0)) / disc;
    assert.ok(Math.abs(got - lit) < 0.005, "кромка " + edge.toFixed(2) + ": доля " + got.toFixed(3) + " против " + lit.toFixed(3));
  }
  // ——— обе кромки выгнуты в одну сторону ———
  //
  // Именно этого и не было в дефекте D48: внутренняя кромка торчала за диск, и
  // фигура читалась линзой. Проверяем прямо: ни одна точка очерка не выходит за
  // круг, и у серпа **вся** фигура лежит в освещённой половине.
  for (const edge of [0.95, 0.707, 0.3, 0.05]) {
    const points = volumeMoonShape(radius, edge, 0);
    assert.ok(
      points.every((point) => Math.hypot(point.x, point.y) <= radius + 1e-9),
      "кромка " + edge + ": точка вышла за диск",
    );
    // Освещённая сторона при нулевом наклоне — вверх по экрану, то есть `y < 0`.
    assert.ok(points.every((point) => point.y <= 1e-9), "кромка " + edge + ": серп полез в тёмную половину");
  }
  // Четверть — ровно половина диска с прямой кромкой: все точки терминатора
  // лежат на одной прямой.
  const quarter = volumeMoonShape(radius, 0, 0);
  const flat = quarter.filter((point) => Math.abs(point.y) < 1e-9);
  assert.ok(flat.length > radius / 2, "прямая кромка собралась из " + flat.length + " точек");
  assert.ok(Math.abs(area(quarter) / disc - 0.5) < 0.005, "четверть — половина диска");
  // Через четверть фигура проходит **без скачка**: шаг кромки на 0,01 двигает
  // очерк на доли точки.
  const step = (edge) => {
    const before = volumeMoonShape(radius, edge - 0.005, 0);
    const after = volumeMoonShape(radius, edge + 0.005, 0);
    return Math.max(...before.map((point, index) => Math.hypot(point.x - after[index].x, point.y - after[index].y)));
  };
  assert.ok(step(0) < 0.3, "на переходе через четверть очерк дёрнулся на " + step(0).toFixed(3) + " точки");
  assert.ok(step(0.5) < 0.3 && step(-0.5) < 0.3, "и на серпе с горбатой тоже гладко");
  // Наклон разворачивает фигуру целиком и площади не меняет: рожки смотрят
  // туда, куда сказано, а серп остаётся серпом.
  const tilted = volumeMoonShape(radius, 0.5, 90);
  assert.ok(Math.abs(area(tilted) - area(volumeMoonShape(radius, 0.5, 0))) < 1e-9);
  assert.ok(tilted.every((point) => point.x >= -1e-9), "при наклоне 90° освещённая сторона смотрит вправо");
});

test("рожки месяца смотрят прочь от солнца", () => {
  // Угол считается от «вверх по экрану» по часовой стрелке. Солнце прямо над
  // месяцем — освещён верх; под ним — освещён низ; слева — освещён левый край.
  const up = volumeMoonTiltDeg({ az: 90, rise: 40 }, { az: 90, rise: 20 });
  assert.ok(Math.abs(up) < 1e-6, "солнце выше месяца: " + up.toFixed(3));
  const down = volumeMoonTiltDeg({ az: 90, rise: -10 }, { az: 90, rise: 20 });
  assert.ok(Math.abs(Math.abs(down) - 180) < 1e-6, "солнце под горизонтом: " + down.toFixed(3));
  const left = volumeMoonTiltDeg({ az: 0, rise: 0 }, { az: 90, rise: 0 });
  assert.ok(Math.abs(left + 90) < 1e-6, "солнце левее месяца: " + left.toFixed(3));
  const right = volumeMoonTiltDeg({ az: 180, rise: 0 }, { az: 90, rise: 0 });
  assert.ok(Math.abs(right - 90) < 1e-6, "солнце правее месяца: " + right.toFixed(3));
  // И на живом небе: у вечернего серпа освещённая сторона смотрит вниз, к
  // закатившемуся солнцу, а у утреннего — вниз с другой стороны.
  const site = { latDeg: 55.7558, lonDeg: 37.6173 };
  const times = volumeDayTimes(site, new Date(2026, 9, 15, 12));
  const evening = volumeMood({ minutes: times.setMin + 40, times, kind: "plain" });
  assert.ok(Math.abs(evening.moon.tiltDeg) > 60, "вечерний серп светит книзу: " + evening.moon.tiltDeg.toFixed(0));
  // Месяца днём не видно вовсе — яркость у него от высоты солнца, а не от своей.
  const noon = volumeMood({ minutes: (times.riseMin + times.setMin) / 2, times, kind: "plain" });
  assert.equal(noon.moon.glow, 0, "в полдень месяц не рисуется");
  assert.equal(volumeMood({ minutes: 0, times, kind: "plain" }).moon.glow, 1, "а ночью рисуется в полную силу");
});

test("ночь узнаётся тоном, но всё остаётся различимым", () => {
  // Темнеет не на закате, а когда солнце уже низко: ступенька ровно на
  // горизонте читалась бы выключателем.
  assert.equal(volumeNightShare(14), 0, "в полдень цвет как написан");
  assert.equal(volumeNightShare(6), 0);
  assert.ok(volumeNightShare(0) > 0.1 && volumeNightShare(0) < 0.25, "на закате сумерки: " + volumeNightShare(0));
  assert.equal(volumeNightShare(-8), VOLUME_NIGHT_SHARE, "глубже потолка ночь не темнеет");
  assert.equal(volumeNightShare(-30), VOLUME_NIGHT_SHARE);
  // И главное: ночная стена остаётся стеной, а не чернотой. Слова заказчика —
  // «что бы было понятно что ночь, но различимо всё».
  const night = { rgb: VOLUME_NIGHT_RGB, share: VOLUME_NIGHT_SHARE };
  const wall = volumeTintRgb(VOLUME_WALL_RGB, night);
  assert.ok(Math.min(...wall) > 110, "ночная стена ушла в черноту: " + wall.join(","));
  const floor = volumeTintRgb(VOLUME_FLOOR_RGB, night);
  assert.ok(Math.min(...floor) > 70, "ночной пол ушёл в черноту: " + floor.join(","));
  // Метка остаётся заметно синее стены: цвет метки ночью не сереет.
  const marker = volumeTintRgb(VOLUME_MARKER_RGB, night);
  assert.ok(marker[2] - marker[0] > 40, "метка потеряла цвет: " + marker.join(","));
  // Полдень не красится вовсе — ни одного числа мимо.
  assert.equal(volumeTintRgb(VOLUME_WALL_RGB, { rgb: VOLUME_NIGHT_RGB, share: 0 }), VOLUME_WALL_RGB);
  assert.equal(volumeTintRgb(VOLUME_WALL_RGB, null), VOLUME_WALL_RGB);
  // Цвет грани считает час в том же месте, где считает светлоту лампы, —
  // другого места для темноты в сборке нет.
  const lit = volumeFill(VOLUME_WALL_RGB, 1, 1, null);
  const dim = volumeFill(VOLUME_WALL_RGB, 1, 1, night);
  assert.notEqual(lit, dim);
  assert.equal(dim, "rgb(" + wall.join(",") + ")");
  assert.equal(volumeFill(VOLUME_WALL_RGB, 1, 0.4, night), "rgba(" + wall.join(",") + ",0.4)");
});

test("земля у дома, земля за ним и её тень темнеют одной краской", () => {
  // G237 держится и во времени: разойдись счёт — дом снова «залетал» бы над
  // землёй, только теперь к ночи.
  const mood = volumeMood({ minutes: 0, times: DAY_TIMES, kind: "nature" });
  const plate = volumeFill(VOLUME_LAND_RGB, 1, 1, mood.tint);
  assert.equal(mood.palette.land, plate, "поле панорамы и плита чертежа — один тон");
  // Тень гаснет к горизонту и ночью её нет вовсе.
  assert.equal(mood.shadow.fade, 0, "ночью тени от солнца нет");
  const noon = volumeMood({ minutes: 900, times: DAY_TIMES, kind: "nature" });
  assert.equal(noon.shadow.fade, 1, "в полдень тень в полную силу");
  assert.equal(Math.round(noon.shadow.az), VOLUME_SUN_AT.az, "тень кладёт то солнце, которое видно");
  const evening = volumeMood({ minutes: 1230, times: DAY_TIMES, kind: "nature" });
  assert.ok(evening.shadow.fade > 0 && evening.shadow.fade < 1, "к вечеру тень слабеет: " + evening.shadow.fade);
  // Длина тени не растёт за вынос плиты: ниже полуденной высоты солнце для
  // тени не опускается (иначе тень уехала бы с земли на небо).
  const low = volumeShadowShift(2800, { az: 90, rise: 2 });
  const high = volumeShadowShift(2800, { az: 90, rise: VOLUME_SUN_AT.rise });
  assert.ok(Math.abs(Math.hypot(low.x, low.y) - Math.hypot(high.x, high.y)) < 1);
  assert.equal(Math.round(Math.hypot(high.x, high.y)), 11230, "та же тень, что считал таск 178");
  // И направление у тени — ровно прочь от солнца.
  const shift = volumeShadowShift(2800, { az: 0, rise: 14 });
  assert.ok(shift.x < 0 && Math.abs(shift.y) < 1e-9, "солнце на востоке — тень на запад");
});

test("небо меняется плавно и в полдень остаётся прежним", () => {
  // Полуденные цвета — ровно те, что были до таска 181.
  const noon = volumeSkyColors(VOLUME_SUN_AT.rise);
  assert.deepEqual(noon.top, [141, 191, 230], "#8dbfe6");
  assert.deepEqual(noon.low, [220, 234, 244], "#dceaf4");
  assert.deepEqual(volumeSkyColors(40).top, noon.top, "выше полудня небо не светлеет");
  // Ночное небо темнее комнаты: ночь обязана узнаваться небом, а не потерей
  // зрения в комнате.
  const night = volumeSkyColors(-12);
  const room = volumeTintRgb(VOLUME_WALL_RGB, { rgb: VOLUME_NIGHT_RGB, share: VOLUME_NIGHT_SHARE });
  assert.ok(Math.max(...night.top) + 40 < Math.min(...room), "ночное небо не темнее стены");
  // Заря: у горизонта небо теплее, чем в зените — это и есть закат.
  const dusk = volumeSkyColors(1);
  assert.ok(dusk.low[0] > dusk.low[2] + 60, "у горизонта не разгорелась заря: " + dusk.low.join(","));
  assert.ok(dusk.top[2] > dusk.top[0], "зенит на закате всё ещё синий");
  // Плавность: ни одного скачка цвета за сутки.
  let was = volumeSkyColors(volumeSunAt(0, DAY_TIMES).height);
  for (let minute = 1; minute <= VOLUME_DAY_MIN; minute += 1) {
    const now = volumeSkyColors(volumeSunAt(minute % VOLUME_DAY_MIN, DAY_TIMES).height);
    for (const key of ["top", "low"]) {
      for (let channel = 0; channel < 3; channel += 1) {
        // Пять единиц на минуту — предел настоящего солнца у горизонта: оно
        // идёт 0,15° в минуту, а шаг цвета у неба — 60 единиц на четыре
        // градуса. Это плавность, а не ступенька: глазу нужен скачок в
        // полтора десятка.
        assert.ok(Math.abs(now[key][channel] - was[key][channel]) <= 5, "скачок неба на минуте " + minute);
      }
    }
    was = now;
  }
});

test("в городе к ночи загораются окна — и не мигают", () => {
  const night = volumeMood({ minutes: 0, times: DAY_TIMES, kind: "city" });
  const day = volumeMood({ minutes: 900, times: DAY_TIMES, kind: "city" });
  assert.equal(day.cityLit, 0, "днём свет в окнах погашен");
  assert.ok(night.cityLit > 0.5, "ночью город живой: " + night.cityLit);
  const litCount = (share) => {
    let count = 0;
    for (let block = 0; block < VOLUME_CITY.length; block += 1) {
      for (let floor = 0; floor < VOLUME_CITY[block].floors; floor += 1) {
        for (let bay = 0; bay < VOLUME_CITY[block].bays; bay += 1) {
          if (volumeCityWindowLit(block, floor, bay, share)) count += 1;
        }
      }
    }
    return count;
  };
  const all = litCount(1);
  assert.ok(all > 300, "в городе меньше трёх сотен окон: " + all);
  assert.equal(litCount(0), 0, "днём не светится ни одно");
  // К вечеру окна загораются по одному: зажжённое не гаснет обратно, иначе
  // город мигал бы на каждом снимке часа — то есть каждую секунду.
  let was = 0;
  for (const share of [0.1, 0.2, 0.3, 0.4, 0.55]) {
    const now = litCount(share);
    assert.ok(now > was, "свет не прибавился на доле " + share);
    was = now;
  }
  for (let block = 0; block < 4; block += 1) {
    for (let floor = 0; floor < 5; floor += 1) {
      if (!volumeCityWindowLit(block, floor, 0, 0.3)) continue;
      assert.ok(volumeCityWindowLit(block, floor, 0, 0.55), "окно потухло к ночи");
    }
  }
  // Один и тот же ответ на один и тот же вопрос — свет не случаен.
  assert.equal(volumeCityWindowLit(3, 2, 1, 0.4), volumeCityWindowLit(3, 2, 1, 0.4));
});

test("три фона рисуют разное, и цена кадра у каждого фоновая", () => {
  const box = { x: 0, y: 0, width: 1280, height: 720 };
  const at = { x: 0, y: 0, z: 1600 };
  const count = (kind, minutes) => {
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
    const mood = volumeMood({ minutes, times: DAY_TIMES, kind });
    for (const yaw of [0, 60, 120, 180, 240, 300]) {
      volumeDrawBackdrop(ctx, box, { at, yaw: (yaw * Math.PI) / 180, pitch: -0.08 }, mood);
    }
    return ops;
  };
  const plain = count("plain", 900);
  const nature = count("nature", 900);
  const city = count("city", 900);
  // «Простой» — земля, небо и светило. Больше ничего: ни дороги, ни гор, ни
  // деревьев, и это видно по счёту — у него одна растяжка на кадр (небо).
  assert.equal(plain.fade, 6, "у простого фона лишние растяжки: " + plain.fade);
  assert.ok(plain.fill + plain.arc < 20, "на простом фоне что-то нарисовалось: " + (plain.fill + plain.arc));
  assert.ok(nature.fill > plain.fill * 8, "природа не богаче простого фона");
  assert.ok(city.fill + city.rect > plain.fill * 8, "город не богаче простого фона");
  // Город узнаётся прямоугольниками окон, природа — пятнами крон: счёт заливок
  // у них разной природы, и это не придирка, а проверка, что фоны разные.
  assert.ok(city.rect > 100, "окон в городе не нарисовано: " + city.rect);
  assert.ok(nature.arc > city.arc, "у природы круглых крон больше, чем у города");
  // Сторож цены: фон — это фон. Кадр сцены в таске 146 стоил 0,1 мс на 650
  // гранях, и фону нельзя разрастаться до его доли незаметно. Счёт здесь за
  // шесть кадров (полный оборот), поэтому и мера шестикратная.
  for (const [name, ops] of [["простой", plain], ["природа", nature], ["город", city]]) {
    const total = ops.fill + ops.arc + ops.rect + ops.fade;
    assert.ok(total < 1700, "фон «" + name + "» разросся: операций на шесть кадров " + total);
  }
  // Ночью прибавляются звёзды и месяц, а не вторая картинка.
  const nightPlain = count("plain", 0);
  assert.ok(nightPlain.arc > plain.arc, "ночью не зажглось ни одной звезды");
  // Звёзд сорок восемь на весь круг, и в кадр попадает около трети — вместе с
  // месяцем это десятки точек на кадр, а не вторая картинка.
  assert.ok(nightPlain.arc - plain.arc < 200, "звёзды разрослись: " + (nightPlain.arc - plain.arc));
  // И фон остаётся фоном: строка горизонта по-прежнему возвращается.
  const noMood = count("nature", 900);
  assert.ok(noMood.fade > 0, "без снимка часа фон рисуется полуденным");
});

test("кадр берёт час готовым, а не считает его сам", () => {
  // Снимок часа — единственное место, где время превращается в цвета. Кадр о
  // времени не знает ничего: ему дают `mood`, и при стоячем времени это один и
  // тот же объект на все кадры.
  const mood = volumeMood({ minutes: 1200, times: DAY_TIMES, kind: "city" });
  assert.deepEqual(volumeMood({ minutes: 1200, times: DAY_TIMES, kind: "city" }), mood, "снимок часа чист");
  assert.equal(mood.kind, "city");
  assert.equal(volumeMood({ minutes: 1200, kind: "ничего такого" }).kind, VOLUME_BACKDROP_DEFAULT);
  assert.deepEqual(VOLUME_BACKDROP_KINDS, ["plain", "nature", "city"]);
  assert.equal(volumeBackdropKindOf(undefined), "nature");
  assert.equal(volumeBackdropKindOf("city"), "city");
  // Полдень по умолчанию — тот фон, что был до таска 181.
  assert.equal(VOLUME_MOOD_NOON.tint.share, 0);
  assert.equal(VOLUME_MOOD_NOON.kind, "nature");
  assert.equal(VOLUME_MOOD_NOON.sky.top, "rgb(141,191,230)");
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
  // Считается по телам: земля и тень дома нарочно шире кадра (D43) — они
  // земля, а не схема, и обрезаются краем поля, как обрезает их горизонт.
  const house = frame.filter((polygon) => polygon.layer === VOLUME_LAYER_BODY);
  const xs = house.flatMap((polygon) => polygon.xy.filter((value, index) => index % 2 === 0));
  const ys = house.flatMap((polygon) => polygon.xy.filter((value, index) => index % 2 === 1));
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

test("вещь на полу занимает место, а короб под потолком — нет", () => {
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
  const bare = volumeScene(project, scene.schemeId).objectBoxes.length;
  // Шкаф на полу занимает место: сквозь него проходят (G264), но вставать в
  // него, открыв окно, незачем.
  assert.equal(volumeScene(place(2200, 0), scene.schemeId).objectBoxes.length, bare + 1);
  // Короб под потолком — над головой, место под ним свободно.
  assert.equal(volumeScene(place(400, 2200), scene.schemeId).objectBoxes.length, bare);
  // Порожек в сто миллиметров — переступили.
  assert.equal(volumeScene(place(100, 0), scene.schemeId).objectBoxes.length, bare);
  // И ни один из трёх не стал препятствием: вещи человека не держат.
  assert.equal(volumeScene(place(2200, 0), scene.schemeId).solids.length, volumeScene(project, scene.schemeId).solids.length);
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

test("камера обзора не ныряет под крышу: место зажато расстоянием", () => {
  const lift = 1900;
  // Отошли далеко — стоять можно почти вдоль земли, но всё же сверху.
  const far = volumeAroundStand(0, 20000, lift);
  assert.ok(far < 0, "камера обзора всегда выше цели: " + far);
  assert.ok(Math.abs(Math.sin(-far) * 20000 - lift) < 1, "подъём над целью ровно по крыше");
  // Подошли вплотную — место становится отвесным.
  assert.ok(volumeAroundStand(0, 2000, lift) < volumeAroundStand(0, 20000, lift));
  // Ближе, чем крыша высока, — почти отвес, и за него не заходим.
  assert.ok(volumeAroundStand(0, 500, lift) <= -((VOLUME_PITCH_MAX_DEG * Math.PI) / 180) + 1e-9);
  // Круче ограничения стоять не запрещено — запрещено положе.
  assert.ok(volumeAroundStand(-1.2, 20000, lift) < far);
  // Крыши нет (стенд, тест) — зажат один отвес.
  assert.equal(volumeAroundStand(0.4, 20000, 0), 0.4);
  const limit = (VOLUME_PITCH_MAX_DEG * Math.PI) / 180;
  assert.ok(Math.abs(volumeAroundStand(Math.PI / 2, 20000, 0) - limit) < 1e-9, "за отвес не заводится");
});

test("обзор задирает взгляд к небу, а камеру оставляет над крышей (G298)", () => {
  // Та самая беда, из-за которой предел стоял: цель на полу, семь метров.
  const lift = 1900;
  const target = { x: 0, y: 0, z: 1200 };
  const sky = (60 * Math.PI) / 180;
  const camera = volumeAroundCamera(target, 0.4, sky, 7000, lift);
  // Взгляд — тот, что задали: солнце в полдень лета стоит на 58°, и смотреть
  // туда обзор теперь вправе.
  assert.equal(camera.pitch, sky);
  // А место камеры — прежнее, по крыше: подъём над целью ровно `lift`, и внутрь
  // стены соседней комнаты она не попадает ни на миллиметр.
  assert.ok(Math.abs(camera.at.z - (target.z + lift)) < 1, "камера съехала с крыши: " + camera.at.z);
  // Больше крыши её поднимает только собственный наклон, и ниже неё она не
  // опускается ни на каком взгляде — пройдём весь диапазон.
  for (let deg = -85; deg <= 85; deg += 5) {
    const at = volumeAroundCamera(target, 0.4, (deg * Math.PI) / 180, 7000, lift).at;
    assert.ok(at.z >= target.z + lift - 1, "на " + deg + "° камера нырнула к полу: " + Math.round(at.z));
  }
  // Задранный взгляд камеру с места **не сдвигает**: от предела и выше она
  // стоит там же, где стояла.
  const edge = volumeAroundCamera(target, 0.4, volumeAroundStand(0, 7000, lift), 7000, lift);
  assert.deepEqual(camera.at, edge.at);
  // Приближение на задранном взгляде — шаг камеры к цели, а не поворот головы:
  // взгляд тот же, место ближе и круче.
  const near = volumeAroundCamera(target, 0.4, sky, 3500, lift);
  assert.equal(near.pitch, sky);
  assert.ok(Math.hypot(near.at.x, near.at.y) < Math.hypot(camera.at.x, camera.at.y), "камера не подошла");
  assert.ok(near.at.z >= target.z + lift - 1, "подошедшая камера ушла под крышу");
  // Опущенный взгляд — как было до таска 195: место и взгляд одно и то же.
  const down = (-70 * Math.PI) / 180;
  assert.deepEqual(
    volumeAroundCamera(target, 0.4, down, 7000, lift),
    volumeAroundCamera(target, 0.4, down, 7000, 0),
    "опущенный взгляд перестал ставить камеру по себе",
  );
});

test("щелчок по небу в обзоре никуда не переносит", () => {
  // Луч из задранного кадра в пол не упирается — и выдуманной точки не бывает.
  const camera = volumeAroundCamera({ x: 0, y: 0, z: 1200 }, 0.4, (60 * Math.PI) / 180, 7000, 1900);
  const box = { width: 1200, height: 700 };
  assert.equal(volumeFloorAt(camera, box, box.width / 2, 40), null);
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

test("на задранном взгляде карта едет туда же, а не наоборот (таск 195)", () => {
  // Рысканье ноль — экранное «вверх» это +x плана. Опущенный взгляд: палец
  // вверх — карта вверх, цель вперёд.
  const box = panBox;
  const down = volumeAroundPan({ yaw: 0, pitch: (-40 * Math.PI) / 180, distance: 9000 }, box, 0, -100);
  const up = volumeAroundPan({ yaw: 0, pitch: (40 * Math.PI) / 180, distance: 9000 }, box, 0, -100);
  // Задрали взгляд на столько же вверх — сторона та же. Считай сторону по
  // экранному «верху», как до таска 195, и знак бы перевернулся: карта поехала
  // бы от пальца в обратную сторону.
  assert.ok(down.dx < 0 && up.dx < 0, "сторона перевернулась: " + down.dx.toFixed(1) + " против " + up.dx.toFixed(1));
  assert.ok(Math.abs(Math.abs(up.dx) - Math.abs(down.dx)) < 1e-9, "мера сжатия пола зависит от знака наклона");
  // Поперёк взгляда задранность не значит ничего: пол сжат вдоль, а не поперёк.
  const across = volumeAroundPan({ yaw: 0, pitch: (40 * Math.PI) / 180, distance: 9000 }, box, 100, 0);
  assert.ok(across.dy < 0 && Math.abs(across.dx) < 1e-6, "поперёк сбилось: " + JSON.stringify(across));
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
  // Отметка «Показывать миникарту» (таск 181, G273) — второй повод не
  // показывать карту, а не второе правило о том, где она помещается: снятая
  // убирает её с любого поля, взведённая правила по размеру не отменяет.
  assert.equal(volumeMinimapBox(box, bounds, false), null);
  assert.deepEqual(volumeMinimapBox(box, bounds, true), place);
  assert.equal(volumeMinimapBox({ width: 420, height: 580 }, bounds, true), null);
  // Одно место отвечает «есть ли карта» — его же спрашивают щелчок по карте и
  // отступ столбика стойки, иначе столбик встал бы над картой, которой нет.
  assert.equal(volumeMinimapView(box, bounds, false), null);
  assert.equal(volumeMinimapAt(box, bounds, { x: place.x + 10, y: place.y + 10 }, false), null);
  assert.equal(volumeFieldBottom(box, bounds, false), VOLUME_FIELD_EDGE);
  assert.ok(volumeFieldBottom(box, bounds, true) > VOLUME_FIELD_EDGE);
});

test("окно параметров: подписи ускорения и строка состояния часов (таск 181)", () => {
  // Подпись называет то, что заказчик просил назвать: за сколько минут проходят
  // сутки. Число — счёт, а не словарная строка, и 1,5 пишется с запятой.
  assert.equal(volumeSpeedLabel(60), "×60 — сутки за 24 мин");
  assert.equal(volumeSpeedLabel(960), "×960 — сутки за 1,5 мин");
  assert.equal(volumeSpeedLabel(7), volumeSpeedLabel(VOLUME_CLOCK_SPEED_DEFAULT), "чужое ускорение — умолчание");
  // «Без ускорения» подписано словами, а не «×1 — сутки за 1440 мин» (G287).
  assert.equal(volumeSpeedLabel(VOLUME_CLOCK_SPEED_REAL), strings.volume.speedNone);
  assert.ok(!volumeSpeedLabel(VOLUME_CLOCK_SPEED_REAL).includes("1440"), "сутки за сутки в минутах не считают");
  // Слова часа — те же четыре, которыми названы отрезки суток.
  assert.equal(volumePhaseWord("night"), strings.volume.phaseNight);
  assert.equal(volumePhaseWord("morning"), strings.volume.phaseMorning);
  assert.equal(volumePhaseWord("day"), strings.volume.phaseDay);
  assert.equal(volumePhaseWord("evening"), strings.volume.phaseEvening);
  assert.equal(volumePhaseWord("пятница"), strings.volume.phaseNight, "неизвестный час — ночь, а не пустота");
  // Строка состояния говорит и который час, и идёт ли он: «время стоит» — это
  // то же самое, что «фон не пересчитывается вовсе», словами человека.
  const day = volumeDayNumberOf(new Date(2026, 9, 20));
  const running = volumeClockNow(0, new Date(2026, 9, 20, 2, 14), 240);
  const line = volumeParamsLine(running, 134, "night", day);
  assert.ok(line.includes("02:14") && line.includes("ночь") && line.includes("6"), line);
  // И какое число (G289): дата двигает рассвет, значит человек обязан её видеть.
  assert.ok(line.includes("20.10.2026"), line);
  assert.equal(volumeDayLabel(day), "20.10.2026");
  const fixed = volumeParamsLine(volumeClockFixed(134, 240, day), 134, "night", day);
  assert.ok(fixed.includes("02:14") && fixed.includes("стоит") && fixed.includes("20.10.2026"), fixed);
  assert.ok(!fixed.includes("сутки"), "у стоячего времени суток не бывает: " + fixed);
  // Без ускорения строка не врёт про минуты: сутки идут сутки.
  const real = volumeParamsLine(volumeClockNow(0, new Date(2026, 9, 20, 2, 14), VOLUME_CLOCK_SPEED_REAL), 134, "night", day);
  assert.ok(real.includes("идёт") && !real.includes("1440"), real);
  // Рассвет и закат: сказано, откуда они взялись.
  const own = volumeParamsSunLine({ riseMin: 300, setMin: 1300, bySite: true });
  assert.ok(own.includes("05:00") && own.includes("21:40") && own.includes("координат"), own);
  const plain = volumeParamsSunLine({ riseMin: VOLUME_SUNRISE_MIN, setMin: VOLUME_SUNSET_MIN, bySite: false });
  assert.ok(plain.includes("09:00") && plain.includes("21:00") && plain.includes("умолчание"), plain);
});

test("окно параметров: «Сейчас» ставит дату, время и «Без ускорения» (G287, G289)", () => {
  // Двери окна правят один и тот же выбор, и спрашивается он одним
  // `volumeParamsRead` — второго места для часов объёма нет.
  const nowMs = 10_000;
  volumeParamsSpeed(240, nowMs);
  assert.equal(volumeParamsRead().speed, 240);
  // Своё время — часы стоят, но дата у них остаётся та же.
  volumeParamsFix(5 * 60, nowMs);
  const stopped = volumeParamsRead().clock;
  assert.equal(stopped.fixed, true);
  assert.equal(volumeClockMinutes(stopped, nowMs + 9e6), 5 * 60, "стоячее время не идёт");
  const today = volumeDayNumberOf(new Date());
  assert.equal(volumeClockStamp(stopped, nowMs).day, today);
  // Другая дата — число меняется, час стоит, ход не возвращается.
  volumeParamsDay(today - 200, nowMs);
  assert.equal(volumeClockStamp(volumeParamsRead().clock, nowMs).day, today - 200);
  assert.equal(volumeClockStamp(volumeParamsRead().clock, nowMs).minutes, 5 * 60);
  assert.equal(volumeParamsRead().clock.fixed, true, "дата не пускает стоячее время");
  // «Сейчас» — сегодняшняя дата, настоящий час и «Без ускорения».
  volumeParamsNow(nowMs);
  const now = volumeParamsRead();
  assert.equal(now.speed, VOLUME_CLOCK_SPEED_REAL, "кнопка выбирает первый пункт ряда сама");
  assert.equal(now.clock.fixed, false, "и пускает время по-настоящему");
  assert.equal(volumeClockStamp(now.clock, nowMs).day, today);
  assert.ok(
    Math.abs(volumeClockMinutes(now.clock, nowMs) - volumeDayMinutesOf(new Date())) < 1,
    "час — настоящий",
  );
  // Минута снаружи — минута внутри: это и есть «реальное время».
  assert.ok(
    Math.abs(volumeClockMinutes(now.clock, nowMs + 60_000) - volumeClockMinutes(now.clock, nowMs) - 1) < 1e-6,
    "без ускорения время идёт один к одному",
  );
  volumeParamsSpeed(VOLUME_CLOCK_SPEED_DEFAULT, nowMs);
});

test("щелчок по миникарте читается местом на плане (G270)", () => {
  const bounds = { minX: -2000, minY: -1500, maxX: 2000, maxY: 1500, widthMm: 4000, heightMm: 3000 };
  const box = { width: 1432, height: 580 };
  const place = volumeMinimapBox(box, bounds);
  const middle = { x: place.x + place.width / 2, y: place.y + place.height / 2 };
  const centre = volumeMinimapAt(box, bounds, middle);
  // Середина карты — середина чертежа.
  assert.ok(Math.abs(centre.x) < 1 && Math.abs(centre.y) < 1, "середина уехала: " + JSON.stringify(centre));
  // Углы карты (с полями в 8 точек) — углы чертежа.
  const view = volumeMinimapView(box, bounds);
  const corner = volumeMinimapAt(box, bounds, {
    x: view.offsetX + bounds.minX * view.zoom,
    y: view.offsetY + bounds.minY * view.zoom,
  });
  assert.ok(Math.abs(corner.x - bounds.minX) < 1 && Math.abs(corner.y - bounds.minY) < 1, "угол уехал");
  // Четверть вправо по карте — четверть вправо по чертежу.
  const right = volumeMinimapAt(box, bounds, { x: middle.x + view.zoom * 1000, y: middle.y });
  assert.ok(Math.abs(right.x - 1000) < 1, "масштаб карты не сошёлся: " + JSON.stringify(right));
  // Мимо карты — не её дело: щелчок уходит дальше, к двери и к вещи.
  assert.equal(volumeMinimapAt(box, bounds, { x: place.x + place.width + 5, y: middle.y }), null);
  assert.equal(volumeMinimapAt(box, bounds, { x: middle.x, y: place.y - 5 }), null);
  // Карты нет вовсе — переносить нечем.
  assert.equal(volumeMinimapAt({ width: 420, height: 580 }, bounds, middle), null);
});

// ——— общее место трёх режимов (G276) ————————————————————————————————————
//
// «При переключении Схема - Чертёж - объём мы должны находиться в одном
// месте… центр схемы\чертежа это расположение камеры в объёме».

test("середина поля плана читается местом на чертеже и ставится обратно (G276)", () => {
  const scene = planProject();
  const box = { width: 900, height: 600 };
  const view = { zoom: 0.5, offsetX: 120, offsetY: -40 };
  const middle = volumePlanCentre(scene.project, scene.schemeId, box, view);
  assert.ok(middle, "моста план → миллиметры нет");
  // Поставить вид на то же место — и середина поля не сдвинется ни на
  // миллиметр: два перевода обязаны сойтись.
  const back = volumePlanViewAt(scene.project, scene.schemeId, box, view, middle);
  assert.equal(back.zoom, view.zoom, "масштаб трогать нельзя — его выбрал человек");
  const again = volumePlanCentre(scene.project, scene.schemeId, box, back);
  assert.ok(Math.abs(again.x - middle.x) <= 1 && Math.abs(again.y - middle.y) <= 1, "место уехало: " + JSON.stringify([middle, again]));
  // Показать на точку чертежа — середина поля встаёт ровно на неё.
  const want = { x: 2500, y: -1200 };
  const put = volumePlanViewAt(scene.project, scene.schemeId, box, view, want);
  const got = volumePlanCentre(scene.project, scene.schemeId, box, put);
  assert.ok(Math.abs(got.x - want.x) <= 1 && Math.abs(got.y - want.y) <= 1, "встали не туда: " + JSON.stringify(got));
});

test("без калибровки плана переносить нечем — и это молчание, а не ошибка (G276)", () => {
  const bare = addScheme(createProject(), { name: "1 этаж", imageId: "plan-1", width: 1200, height: 800 });
  const box = { width: 900, height: 600 };
  const view = { zoom: 1, offsetX: 0, offsetY: 0 };
  assert.equal(volumePlanCentre(bare.project, bare.scheme.id, box, view), null);
  assert.equal(volumePlanViewAt(bare.project, bare.scheme.id, box, view, { x: 0, y: 0 }), null);
  // И чужой схемы тоже нет.
  assert.equal(volumePlanCentre(bare.project, "нет такой", box, view), null);
});

test("мастерская говорит, где стоит, и забирает просьбу один раз (G276)", () => {
  screenPlaceForget();
  assert.equal(screenPlaceOfDrawing("схема-1"), null, "на пустом месте мастерская молчит");
  screenPlaceDrawing("схема-1", { x: 1500, y: -800 });
  assert.deepEqual(screenPlaceOfDrawing("схема-1"), { x: 1500, y: -800 });
  // Чужая схема — чужое место: этаж сменили, и середина прежнего не годится.
  assert.equal(screenPlaceOfDrawing("схема-2"), null);
  // Просьба забирается ровно один раз: второй вход в чертёж не должен
  // возвращать человека туда, откуда он уже ушёл руками.
  screenPlaceWant("схема-1", { x: -200, y: 400 });
  assert.deepEqual(screenPlaceTake("схема-1"), { x: -200, y: 400 });
  assert.equal(screenPlaceTake("схема-1"), null);
  // И просьба к чужой схеме не исполняется.
  screenPlaceWant("схема-1", { x: 1, y: 2 });
  assert.equal(screenPlaceTake("схема-2"), null);
  screenPlaceForget();
  assert.equal(screenPlaceTake("схема-1"), null);
});

test("перенос по миникарте не ставит в стену: работает то же правило, что у пола (G270, G212)", () => {
  const scene = roomScene();
  const built = volumeScene(scene.project, scene.schemeId);
  const bounds = built.boundsMm;
  const box = { width: 1432, height: 580 };
  const view = volumeMinimapView(box, bounds);
  // Тычем в саму стену комнаты: верхняя стена идёт по y = −1500.
  const at = { x: view.offsetX + 0 * view.zoom, y: view.offsetY + -1500 * view.zoom };
  const spot = volumeMinimapAt(box, bounds, at);
  assert.ok(Math.abs(spot.y + 1500) < 50, "карта показала не на стену: " + JSON.stringify(spot));
  const moved = volumeMoveTo(built, spot);
  assert.equal(volumeDepthMm(built.solids, moved.x, moved.y), 0, "встали в стену");
  assert.ok(Math.hypot(moved.x - spot.x, moved.y - spot.y) < 1000, "ушли далеко от показанного места");
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
  // Метки плотные — все, кроме ткани шторы (таск 189): в этом стенде стоит
  // розетка, и ей просвечивать нечем. Тюль проверяется своим стендом ниже.
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

// ——— ткань шторы: прозрачная метка (таск 189, G286; плотность — таск 191, G297) —
//
// Слова заказчика таска 189: «модель штор сделай полупрозрачной, по сути как
// тюль пусть будет», и его же слова таска 191: «давай шторе поставим
// прозрачность 0.6, сейчас её почти не видно». Шторы — исключение среди меток,
// и здесь проверяется ровно то, чем исключение отличается от правила таска 169:
//
//   1. Просвечивает **ткань**, а не метка: труба карниза плотная.
//   2. Плотность у ткани **своя** — 0,6 против 0,4 у вещей, и число приходит из
//      описания тела, а не из одной константы на всё прозрачное.
//   3. Прозрачная **метка взгляд останавливает**: её выделяют, и пропусти её
//      взгляд — выделить шторы стало бы нельзя вовсе.
//
// Стенд — живой случай заказчика: карниз у него **линейный**, проведён по окну
// линией, и шторы ему даёт повтор вдоль пути.

/** Комната с окном в северной стене, линейным карнизом у окна и розеткой за тканью. */
function sheerStand() {
  const scene = roomScene();
  let project = addOpening(scene.project, {
    wallId: scene.walls[0],
    kind: "window",
    atMm: 1000,
    widthMm: 2000,
    heightMm: 1500,
    heightAboveFloorMm: 800,
  }).project;
  // Розетка на той же стене, посередине окна и на высоте окна: тюль закрывает
  // её целиком — это и есть точка, в которой спорят метка и прозрачная метка.
  const put = markAt(project, scene.schemeId, "Р", [{ x: 0, y: -1350 }]);
  project = setMarkDimensions(put.project, put.markId, { heightAboveFloor: 1200 }).project;
  // Карниз линией вдоль окна, в 150 мм от внутренней грани стены.
  const rail = markAt(project, scene.schemeId, "КШ", [
    { x: -1000, y: -1250 },
    { x: 1000, y: -1250 },
  ], "line");
  return {
    project: rail.project,
    schemeId: scene.schemeId,
    railId: rail.markId,
    socketId: put.markId,
    // Стоим в комнате и смотрим в окно: тюль между глазами и окном.
    camera: { at: { x: 0, y: 900, z: VOLUME_EYE_MM }, yaw: -Math.PI / 2, pitch: -0.05 },
    box: { width: 1000, height: 640 },
  };
}

test("просвечивает ткань шторы, а труба карниза — нет (G286)", () => {
  const stand = sheerStand();
  const built = volumeScene(stand.project, stand.schemeId, {});
  const mine = built.faces.filter((face) => face.markId === stand.railId && !face.line);
  const sheer = mine.filter((face) => face.clear);
  const solid = mine.filter((face) => !face.clear);
  assert.ok(sheer.length > 0, "у шторы нет ни одной прозрачной грани");
  assert.ok(solid.length > 0, "у шторы не осталось плотных граней — труба карниза тоже просвечивает");
  // Полотнищ семь (2 м пути при шаге 300), по шесть граней на каждое; полоса
  // карниза — шесть граней одного звена (у метки рисуется и низ: на карниз
  // смотрят и снизу).
  assert.equal(sheer.length, 42, "прозрачных граней у штор: " + sheer.length);
  assert.equal(solid.length, 6, "плотных граней у карниза: " + solid.length);
  for (const face of sheer) assert.equal(face.alpha, VOLUME_SHEER_ALPHA, "плотность ткани взялась не из её описания");
  for (const face of solid) assert.equal(face.alpha, 1, "труба карниза перестала быть плотной");
  // Остальные метки стенда — как были. Это и есть «не раздавая её остальным».
  const others = built.faces.filter((face) => face.markId && face.markId !== stand.railId && !face.line);
  assert.ok(others.length > 0, "в стенде есть другие метки");
  assert.ok(others.every((face) => !face.clear && face.alpha === 1), "прозрачной стала метка, которая не штора");
  // И вещи чертежа со своей плотностью не перепутались: у них 0,4.
  assert.notEqual(VOLUME_SHEER_ALPHA, VOLUME_CLEAR_ALPHA, "у ткани шторы обязана быть своя плотность");
  assert.equal(volumeClearAlpha(true), VOLUME_CLEAR_ALPHA, "вещь чертежа потеряла свою плотность");
  assert.equal(volumeClearAlpha("sheer"), VOLUME_SHEER_ALPHA);
  assert.equal(volumeClearAlpha(false), 1, "плотная грань обязана остаться плотной");
});

test("сквозь тюль видно окно: в кадре он смешан с тем, что за ним", () => {
  const stand = sheerStand();
  const built = volumeScene(stand.project, stand.schemeId, {});
  const frame = volumeFrame(built, stand.camera, stand.box);
  const sheer = frame.filter((polygon) => polygon.clear && polygon.pick === stand.railId);
  assert.ok(sheer.length > 0, "тюля в кадре нет — стенд смотрит не туда");
  for (const polygon of sheer) {
    assert.ok(polygon.fill.startsWith("rgba("), "тюль нарисован плотным цветом: " + polygon.fill);
    assert.ok(polygon.fill.endsWith("," + VOLUME_SHEER_ALPHA + ")"), polygon.fill);
  }
  // Смешивание некоммутативно: тюль обязан быть нарисован **после** того, что
  // за ним, иначе он не просветит, а закрасится сам. Точка берётся там, где за
  // тюлем стоит розетка стенда: её видно глазами как красное пятно сквозь
  // ткань, и очередь в этой точке проверяется целиком.
  const at = markPointAt(frame, stand.socketId);
  const cover = coverAt(frame, at.x, at.y);
  const tulle = cover.filter((item) => item.polygon.pick === stand.railId && item.polygon.clear);
  const behind = cover.filter((item) => item.polygon.pick === stand.socketId);
  assert.ok(tulle.length > 0 && behind.length > 0, "в этой точке спорят тюль и розетка за ним");
  assert.ok(
    Math.max(...behind.map((item) => item.index)) < Math.min(...tulle.map((item) => item.index)),
    "тюль нарисован раньше того, что за ним, — и значит ничего не просветил",
  );
  // Слоёв ткани на луче один-два: на живом объекте заказчика один слой в
  // 96,4 % точек, два в 3,6 %, трёх не встретилось вовсе (замер таска 191).
  assert.ok(tulle.length <= 2, "слоёв ткани в этой точке больше двух: " + tulle.length);
  // Сколько света окну остаётся. С таска 191 плотность выведена из самой шторы
  // («её должно быть видно»), а не из доли окну, и числа эти — следствие, а не
  // довод: 0,40 за одним полотнищем, 0,16 за двумя. Стоят они здесь, чтобы
  // смена плотности не прошла молча: окно сквозь ткань остаётся светлее стены
  // (замер — в `VOLUME_SHEER_ALPHA`), и за этим следит человек на снимке.
  assert.equal(Math.round((1 - VOLUME_SHEER_ALPHA) * 100), 40, "за одним полотнищем окну остаётся 0,40");
  assert.equal(Math.round((1 - VOLUME_SHEER_ALPHA) ** 2 * 100), 16, "за двумя полотнищами окну остаётся 0,16");
});

test("прозрачная метка взгляд останавливает — иначе шторы стало бы не выделить (G286)", () => {
  const stand = sheerStand();
  const built = volumeScene(stand.project, stand.schemeId, {});
  const frame = volumeFrame(built, stand.camera, stand.box);
  const at = markPointAt(frame, stand.railId);
  // 1. Смотрим на тюль — выделяется штора. Пропусти взгляд прозрачную метку,
  // ответом стало бы окно за ней, то есть `null`: выделить шторы взглядом
  // нельзя было бы вовсе.
  assert.equal(volumeSightAt(frame, at.x, at.y), stand.railId, "взгляд на тюль обязан отвечать шторой");
  assert.equal(volumePickAt(frame, at.x, at.y), stand.railId, "и щелчок по тюлю — тоже");
  // 2. Правило — не «прозрачное пропускается», а «пропускается то, за чем всё
  // равно никого не выделить». Тот же кадр с плотными шторами отвечает **то же
  // самое**: прозрачность поменяла, как штора выглядит, а не что выделяется.
  const opaque = volumeFrame(
    { ...built, faces: built.faces.map((face) => (face.markId ? { ...face, clear: false, alpha: 1 } : face)) },
    stand.camera,
    stand.box,
  );
  assert.equal(volumeSightAt(opaque, at.x, at.y), stand.railId, "до прозрачности взгляд отвечал той же шторой");
  // 3. Цена названа прямо: розетка за тюлем остаётся закрытой — и взгляду, и
  // руке. Это ровно то, что было с плотной шторой, то есть не потеря.
  assert.notEqual(volumeSightAt(frame, at.x, at.y), stand.socketId, "метка за тюлем взглядом не достаётся");
  assert.equal(volumeSightAt(opaque, at.x, at.y), volumeSightAt(frame, at.x, at.y), "ответ не изменился");
  // 4. А вещь чертежа по-прежнему пропускает взгляд: у неё хозяина нет, и
  // пропуск не отнимает ответа — правило таска 169 цело.
  const closet = clearStand();
  const closetScene = volumeScene(closet.project, closet.schemeId, {});
  const closetFrame = volumeFrame(closetScene, closet.camera, closet.box);
  const atMark = markPointAt(closetFrame, closet.markId);
  assert.equal(volumeSightAt(closetFrame, atMark.x, atMark.y), closet.markId, "сквозь шкаф взгляд смотреть перестал");
});

test("шторы в объект не пишут ничего (G68)", () => {
  const stand = sheerStand();
  const before = JSON.stringify(stand.project);
  const built = volumeScene(stand.project, stand.schemeId, {});
  volumeFrame(built, stand.camera, stand.box);
  assert.equal(JSON.stringify(stand.project), before, "сборка сцены поменяла объект");
  const rail = findMark(stand.project, stand.railId);
  assert.ok(!("clear" in rail), "у метки завелось поле прозрачности");
  const type = stand.project.markTypes.find((item) => item.id === rail.typeId);
  assert.ok(!("clear" in type), "у типа завелось поле прозрачности");
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

// ——— ус на углу стен (G265) ——————————————————————————————————————————————
//
// «Внешние углы под 90 градусов в стенах сделай так же как пофиксил
// столешницу» — то есть тем же усом по биссектрисе, что в D38.

/** Две стены буквой «Г» с общей вершиной в начале координат. */
function cornerWalls(thicknessMm = 100, second = { x: 0, y: 3000 }) {
  const scene = planProject();
  let project = scene.project;
  project = addWall(project, { schemeId: scene.schemeId, aMm: { x: -4000, y: 0 }, bMm: { x: 0, y: 0 }, thicknessMm }).project;
  project = addWall(project, { schemeId: scene.schemeId, aMm: { x: 0, y: 0 }, bMm: second, thicknessMm }).project;
  return { project, schemeId: scene.schemeId, walls: wallsOnScheme(project, scene.schemeId) };
}

/** Сколько верхних граней стен накрывают точку плана. */
function wallCover(faces, point) {
  let count = 0;
  for (const face of faces) {
    if (face.line || !face.n || !(face.n.z > 0.9)) continue;
    if (face.rgb[0] !== VOLUME_WALL_RGB[0]) continue;
    if (!(face.p[0].z > 1000)) continue;
    if (volumePointInside(point, face.p)) count += 1;
  }
  return count;
}

test("внешний угол стен сведён усом: ни двойного слоя, ни выреза (G265)", () => {
  const stand = cornerWalls();
  const built = volumeScene(stand.project, stand.schemeId, {});
  // Стены 100 мм, вершина в (0,0): внешний угол — (50, −50), внутренний —
  // (−50, 50). Прежде внешний не был накрыт ничем, внутренний — дважды.
  assert.equal(wallCover(built.faces, { x: 40, y: -40 }), 1, "внешний угол пуст");
  assert.equal(wallCover(built.faces, { x: -40, y: 40 }), 1, "внутренний угол накрыт дважды");
  // Торцов на сведённых концах нет: там стена переходит в соседку.
  const caps = built.faces.filter(
    (face) => !face.line && face.n && Math.abs(face.n.z) < 0.01 && face.rgb[0] === VOLUME_WALL_RGB[0],
  );
  // Четыре стороны (по две на стену) и два свободных торца на дальних концах.
  assert.equal(caps.length, 4 + 2, "торцы на сведённом углу остались: " + caps.length);
  // Кромка общая: обе стены кончаются в одних и тех же точках.
  const miters = volumeWallMiters(stand.walls, () => 2700);
  const first = miters.get(stand.walls[0].id);
  const second = miters.get(stand.walls[1].id);
  assert.ok(first && first.end, "у первой стены нет уса");
  assert.ok(second && second.start, "у второй стены нет уса");
  // Первая идёт вдоль +x: её левая кромка (−y) наружная и выходит за вершину
  // на полтолщины, правая (+y) отступает на столько же.
  assert.equal(Math.round(first.end.left), 4050);
  assert.equal(Math.round(first.end.right), 3950);
  assert.equal(Math.round(second.start.left), -50);
  assert.equal(Math.round(second.start.right), 50);
});

test("ус неприменим: тройник, разная высота, стены вдоль одной прямой", () => {
  // Тройник: в вершину приходит третья стена — какую пару сводить, сказать
  // нечем.
  const tee = cornerWalls();
  const third = addWall(tee.project, {
    schemeId: tee.schemeId,
    aMm: { x: 0, y: 0 },
    bMm: { x: 3000, y: 0 },
    thicknessMm: 100,
  }).project;
  const teeMiters = volumeWallMiters(wallsOnScheme(third, tee.schemeId), () => 2700);
  assert.equal([...teeMiters.values()].filter((item) => item.start || item.end).length, 0, "тройник свели усом");
  // Разная высота: ус срезал бы торец, а над соседкой осталась бы дыра.
  const pair = cornerWalls();
  const byHeight = volumeWallMiters(pair.walls, (wall) => (wall.id === pair.walls[0].id ? 2700 : 2200));
  assert.equal([...byHeight.values()].filter((item) => item.start || item.end).length, 0, "свели стены разной высоты");
  // Вдоль одной прямой: кромки параллельны и не пересекаются.
  const straight = cornerWalls(100, { x: 3000, y: 0 });
  const flat = volumeWallMiters(straight.walls, () => 2700);
  assert.equal([...flat.values()].filter((item) => item.start || item.end).length, 0, "свели прямую");
});

test("острый угол стен: ус срезан по пределу, как у полосы", () => {
  // Излом около 20°: ус ушёл бы на шесть полутолщин.
  const sharp = cornerWalls(200, { x: -3000, y: 1000 });
  const miters = volumeWallMiters(sharp.walls, () => 2700);
  const first = miters.get(sharp.walls[0].id);
  assert.ok(first && first.end, "ус не поставлен вовсе");
  const limit = VOLUME_MITER_MAX * 100;
  assert.ok(Math.abs(first.end.left - 4000) <= limit + 0.01, "ус длиннее предела");
  assert.ok(Math.abs(first.end.right - 4000) <= limit + 0.01, "ус длиннее предела");
  assert.ok(Math.abs(first.end.right - 4000) > 100, "предел ни при чём: ус короче полутолщины");
});

test("прозрачность — вид, а не свойство вещи: объект цел, сквозь шкаф проходят (G68, G264)", () => {
  const stand = clearStand();
  const before = JSON.stringify(stand.project);
  const built = volumeScene(stand.project, stand.schemeId, {});
  assert.equal(JSON.stringify(stand.project), before, "в объект не пишется ничего (G68)");
  assert.equal(
    JSON.stringify(stand.project.schemeObjects),
    JSON.stringify(JSON.parse(before).schemeObjects),
    "и у вещи не завелось поля прозрачности",
  );
  // Габарит шкафа 1200 × 600 остался занятым местом, но препятствием быть
  // перестал (G264): сквозь вещи проходят.
  const box = built.objectBoxes.find((item) => Math.round(item.half * 2) === 1200 && Math.round(item.halfT * 2) === 600);
  assert.ok(box, "габарит шкафа на месте");
  assert.ok(
    !built.solids.some((item) => Math.round(item.half * 2) === 1200 && Math.round(item.halfT * 2) === 600),
    "шкаф остался препятствием",
  );
  // Шкаф стоит от y = −1400 до −800: прежде человек упирался в его лицо на
  // −580 (−800 плюс радиус тела). Теперь он входит в габарит и доходит до
  // стены за ним — её держит `solids`.
  let at = { x: -500, y: 0 };
  for (let step = 0; step < 40; step += 1) at = volumeStep(built, at, 0, -200);
  assert.ok(at.y < -1000, "сквозь прозрачный шкаф не прошли: y = " + Math.round(at.y));
  assert.ok(volumeFreeMm(built.solids, at.x, at.y) > -1, "но в стену за ним не вошли");
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
  // Связь без канала у **многоклавишной** метки не приписывается первой
  // клавише: какая из двух — в данных не записано (правило таска 177).
  const first = volumeChannelLinks(links, { markId: "вв", channel: 1 }, 2);
  assert.deepEqual(
    first.lines.map((line) => line.toId),
    ["т1"],
  );
  // Не сказали, сколько клавиш, — метка считается многоклавишной: осторожное
  // умолчание, а не «одна».
  assert.deepEqual(
    volumeChannelLinks(links, { markId: "вв", channel: 1 }).lines.map((line) => line.toId),
    ["т1"],
  );
});

// ——— одноклавишный выключатель: связь без номера — его канал (таск 191, D50) —
//
// Слова заказчика: «Если в Объёме нажать на клавишу 1 клавишного выключателя,
// то пишет: Канал 1: на этой клавише нет ни одной нагрузки. Хотя по факту
// 1 канал там и в „Чем управляет“ не указывается канал. Соответственно
// выбранное и есть первый канал».
//
// Это **не** отмена правила таска 177, а его граница: домысливать нечего там,
// где канал один. На объекте заказчика ровно этот случай и стоит — три
// одноклавишных выключателя, и все три связи у них без номера.

test("у одноклавишной метки связь без номера канала — её собственная", () => {
  const links = {
    lines: [
      { fromId: "в", toId: "т1", channel: null },
      { fromId: "в", toId: "т2", channel: 1 },
      { fromId: "в", toId: "т3", channel: 2 },
      { fromId: "другой", toId: "т4", channel: null },
    ],
    ties: [],
    groups: [],
    offScheme: [],
  };
  const one = volumeChannelLinks(links, { markId: "в", channel: 1 }, 1);
  assert.deepEqual(
    one.lines.map((line) => line.toId),
    ["т1", "т2"],
    "одна клавиша обязана забрать и связь без номера, и свою по номеру",
  );
  // Чужая метка не задета, и второй канал у одноклавишной не выдумывается: если
  // в данных стоит «канал 2», это ошибка разметки, а не её клавиша.
  assert.deepEqual(
    volumeChannelLinks(links, { markId: "в", channel: 2 }, 1).lines.map((line) => line.toId),
    ["т3"],
    "вторая клавиша у одноклавишной метки берёт только то, что названо её номером",
  );
});

test("клавиши считаются по телу модели, а не вторым счётом", () => {
  const scene = roomScene();
  const one = markAt(scene.project, scene.schemeId, "В", [{ x: -900, y: -1100 }]);
  const two = markAt(one.project, scene.schemeId, "ВВ", [{ x: -500, y: -1100 }]);
  const socket = markAt(two.project, scene.schemeId, "Р", [{ x: 0, y: -1100 }]);
  const built = volumeScene(socket.project, scene.schemeId, {});
  assert.equal(volumeModelKeys(placeOf(built, one.markId).model), 1, "у «В» одна клавиша");
  assert.equal(volumeModelKeys(placeOf(built, two.markId).model), 2, "у «ВВ» две клавиши");
  // У неклавишной вещи ноль — и ноль не значит «одна»: правило одной клавиши
  // про неё не говорит ничего.
  assert.equal(volumeModelKeys(placeOf(built, socket.markId).model), 0, "у розетки клавиш нет");
  assert.equal(volumeModelKeys(null), 0);
  assert.equal(volumeModelKeys({ parts: [] }), 0);
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
