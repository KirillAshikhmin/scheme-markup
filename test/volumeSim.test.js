// Имитация умного дома в «Объёме» (таск 09 сценариев; истории 2.2, 2.5, 2.6,
// 2.8, 2.9, 2.12, 2.13, 7.6).
//
// Швы, которые здесь проверяются, — чистые: сцена и кадр (`volumeScene`,
// `volumeFrame`), правила поверхности «Объёма» (`volumeSim*` в
// `panels/volume.js`) и отметка «Имитация умного дома» окна параметров. Окно с
// холстом тестами не покрывается (правило проекта) — его подтверждает живой
// прогон.
import test from "node:test";
import assert from "node:assert/strict";

import {
  addMark,
  addOpening,
  addOutline,
  addRoom,
  addScheme,
  addWall,
  applyMarkWalls,
  applyRoomOutlines,
  createProject,
  planMmToFraction,
  setMarkDevice,
  setMarkDimensions,
  setPlanOrigin,
  setPlanScale,
  setSchemeWallHeight,
} from "../src/model.js";
import {
  VOLUME_CEILING_RGB,
  VOLUME_EYE_MM,
  VOLUME_FLOOR_RGB,
  VOLUME_GLOW_RGB,
  VOLUME_LED_ALERT_RGB,
  VOLUME_LED_KEY_RGB,
  VOLUME_LED_OFF_RGB,
  VOLUME_LED_ON_RGB,
  VOLUME_NIGHT_RGB,
  VOLUME_SCREEN_RGB,
  VOLUME_WALL_RGB,
  volumeCurtainShare,
  volumeDraw,
  volumeFloorKey,
  volumeFloorKeySame,
  volumeLiveLight,
  volumeLiveSigns,
  volumeFrame,
  volumeMood,
  volumeScene,
} from "../src/volume.js";

import { markAccessory } from "../src/sim/home.js";
import { simLiveOf } from "../src/sim/live.js";
import { strings } from "../src/strings.js";
import {
  volumeCardPlace,
  volumeHintText,
  volumeSimAction,
  volumeSimCurtains,
  volumeSimLive,
  volumeSimRooms,
  volumeSimSeed,
} from "../src/panels/volume.js";

// ——— стенд ———————————————————————————————————————————————————————————————
//
// Гостиная 4 × 3 м с контуром по внутренним граням стен: окно в северной стене
// (y = −1500) и штора линией вдоль него, дверь в восточной (x = +2000) и датчик
// открытия у неё, светильник под потолком посередине, ночник у пола, телевизор
// на западной стене, точечная штора на южной, выключатели у двери и датчик
// движения под потолком.

function standProject() {
  const added = addScheme(createProject(), { name: "1 этаж", imageId: "plan-1", width: 1200, height: 800 });
  let project = setPlanScale(added.project, added.scheme.id, { a: { x: 0.1, y: 0.5 }, b: { x: 0.6, y: 0.5 }, meters: 6 }).project;
  project = setPlanOrigin(project, added.scheme.id, { at: { x: 0.5, y: 0.5 }, turn: 0 }).project;
  project = setSchemeWallHeight(project, added.scheme.id, 2700).project;
  return { project, schemeId: added.scheme.id };
}

const typeByCode = (project, code) => project.markTypes.find((type) => type.code === code);

function put(box, key, code, pointsMm, kind = "point") {
  const added = addMark(box.project, {
    schemeId: box.schemeId,
    typeId: typeByCode(box.project, code).id,
    kind,
    points: pointsMm.map((point) => planMmToFraction(box.project, box.schemeId, point)),
  });
  box.project = applyMarkWalls(added.project, box.schemeId).project;
  box.marks[key] = added.marks[0].id;
  return added.marks[0].id;
}

function simStand() {
  const box = { ...standProject(), marks: {}, walls: [], doorId: null, roomId: null };
  const corners = [
    { x: -2000, y: -1500 },
    { x: 2000, y: -1500 },
    { x: 2000, y: 1500 },
    { x: -2000, y: 1500 },
  ];
  for (let index = 0; index < corners.length; index += 1) {
    const wall = addWall(box.project, {
      schemeId: box.schemeId,
      aMm: corners[index],
      bMm: corners[(index + 1) % corners.length],
      thicknessMm: 200,
    });
    box.project = wall.project;
    box.walls.push(wall.wall.id);
  }
  const room = addRoom(box.project, "Гостиная");
  box.project = room.project;
  box.roomId = room.room.id;
  box.project = addOutline(box.project, {
    schemeId: box.schemeId,
    roomId: room.room.id,
    points: [
      { x: -1900, y: -1400 },
      { x: 1900, y: -1400 },
      { x: 1900, y: 1400 },
      { x: -1900, y: 1400 },
    ].map((point) => planMmToFraction(box.project, box.schemeId, point)),
  }).project;
  box.project = addOpening(box.project, {
    wallId: box.walls[0],
    kind: "window",
    atMm: 1000,
    widthMm: 2000,
    heightMm: 1500,
    heightAboveFloorMm: 800,
  }).project;
  const door = addOpening(box.project, {
    wallId: box.walls[1],
    kind: "door",
    atMm: 1700,
    widthMm: 900,
    heightMm: 2100,
    hinge: "start",
    swing: "left",
  });
  box.project = door.project;
  box.doorId = door.opening.id;
  put(box, "lamp", "С", [{ x: 0, y: 0 }]);
  put(box, "night", "Н", [{ x: -1000, y: 1350 }]);
  put(box, "tv", "ТВ", [{ x: -1850, y: 0 }]);
  put(box, "rail", "КШ", [{ x: -1000, y: -1250 }, { x: 1000, y: -1250 }], "line");
  put(box, "curtain", "КШ", [{ x: 800, y: 1350 }]);
  put(box, "switch", "В", [{ x: 1850, y: -600 }]);
  put(box, "double", "ВВ", [{ x: 1850, y: -350 }]);
  put(box, "motion", "ДД", [{ x: 600, y: 600 }]);
  put(box, "contact", "ДО", [{ x: 1850, y: 750 }]);
  box.project = setMarkDimensions(box.project, box.marks.contact, { heightAboveFloor: 2000 }).project;
  box.project = applyRoomOutlines(box.project, box.schemeId).project;
  return box;
}

// ——— журнал кадра ————————————————————————————————————————————————————————

const round = (value) => (typeof value === "number" ? Math.round(value * 100) / 100 : value);
const PROPS = ["fillStyle", "strokeStyle", "lineWidth", "lineJoin", "lineCap", "globalAlpha"];

function scribe(log) {
  const state = {};
  return new Proxy(
    {},
    {
      get(_target, key) {
        if (typeof key === "string" && PROPS.includes(key)) return state[key];
        return (...args) => log.push(key + "(" + args.map(round).join(",") + ")");
      },
      set(_target, key, value) {
        state[key] = value;
        log.push(key + "=" + round(value));
        return true;
      },
    },
  );
}

/** Отпечаток журнала: число вызовов и FNV-1a по тексту — сравнивать, а не хранить мегабайт. */
function print(log) {
  let hash = 0x811c9dc5;
  const textOf = log.join("\n");
  for (let index = 0; index < textOf.length; index += 1) {
    hash ^= textOf.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return { calls: log.length, hash: hash.toString(16) };
}

const STAND_BOX = { width: 960, height: 600 };
// Две камеры: обзор сверху (крыша снята) и взгляд изнутри на окно со шторой.
const STAND_CAMERAS = [
  { at: { x: 0, y: 4200, z: 4600 }, yaw: -Math.PI / 2, pitch: -0.75 },
  { at: { x: 0, y: 900, z: VOLUME_EYE_MM }, yaw: -Math.PI / 2, pitch: 0.12 },
];
const NIGHT = volumeMood({ minutes: 23 * 60, times: { riseMin: 540, setMin: 1260 }, kind: "nature", topDeg: 0 });

function frameLog(scene, camera, tint, live) {
  const log = [];
  const polygons = live === undefined ? volumeFrame(scene, camera, STAND_BOX, [], tint) : volumeFrame(scene, camera, STAND_BOX, [], tint, live);
  volumeDraw(scribe(log), polygons);
  return log;
}

// Снято сборкой **до** таска 09 (коммит 68627f1): тот же стенд, те же доводы
// сцены, что даёт «Объём» без отметки «Имитация умного дома» — открытая дверь и
// открытая штора из памяти показа, крыша снята.
//
// **Отпечаток переснят правкой после сборки сценариев** — по словам заказчика:
// «В проёмах и у стены какая странная тень и почему подсвечивается справа стена
// с проёмом… При чем даже с закрытой дверью». Полоса пола под стеной, откосы,
// перемычки, торцы и ручка двери стали половинами по сторонам стены, а сторона
// стены — кусками по помещениям: граней больше, и журнал вызовов другой. Цвет
// каждой грани без имитации прежний: кадр старой и новой сборки сверен
// попиксельно — разница только в однопиксельных швах по новым кромкам. Прежние
// числа: `{1654, c640ce0d}` и `{682, d4990f84}`.
const BEFORE_T09 = [
  { calls: 1752, hash: "a1ac147b" },
  { calls: 672, hash: "633e3348" },
];

test("7.6: без имитации кадр «Объёма» — вызов в вызов тот, что до таска", () => {
  const stand = simStand();
  const scene = volumeScene(stand.project, stand.schemeId, {
    openDoorIds: new Set([stand.doorId]),
    openCurtainIds: new Set([stand.marks.curtain]),
    roofOff: true,
    markImages: false,
  });
  // Отпечатки сняты при прежней ночи — доле 0,45 без луны; ночь с тех пор
  // темнее («сделай ночь темнее процентов на 40») и светлеет от луны, а кадр
  // без имитации обязан остаться прежним при прежнем тоне.
  const before = { rgb: VOLUME_NIGHT_RGB, share: 0.45 };
  const prints = STAND_CAMERAS.map((camera) => print(frameLog(scene, camera, before)));
  assert.deepEqual(prints, BEFORE_T09);
});

// ——— грани знают, что может светиться и в какой они комнате ————————————————

test("2.12: светиться могут абажур лампы, свечение ночника и экран ТВ — грани это знают", () => {
  const stand = simStand();
  const scene = volumeScene(stand.project, stand.schemeId, { roofOff: true });
  const of = (key) => scene.faces.filter((face) => face.markId === stand.marks[key] && !face.line);
  assert.ok(of("lamp").some((face) => face.lit === true), "у лампы ни одной светящейся грани");
  assert.ok(of("lamp").some((face) => face.lit === false), "у лампы светится и подвес");
  assert.ok(of("night").some((face) => face.lit === true), "у ночника не светится свечение");
  assert.ok(of("tv").some((face) => face.lit === true), "у телевизора не светится экран");
  // Розетка, выключатель, штора, датчик — не светятся, сколько их ни включай.
  for (const key of ["switch", "double", "curtain", "rail", "motion", "contact"]) {
    assert.ok(of(key).every((face) => face.lit === false), key + ": светится то, что светиться не может");
  }
  // Стены, пол и потолок не светятся сами — их светлит свет комнаты.
  assert.ok(scene.faces.filter((face) => !face.markId && !face.line).every((face) => face.lit === false));
});

test("2.12: пол, потолок, стены изнутри и вещи комнаты знают свою комнату, улица — нет", () => {
  const stand = simStand();
  const scene = volumeScene(stand.project, stand.schemeId, { roofOff: true });
  const floor = scene.faces.find((face) => face.rgb === VOLUME_FLOOR_RGB && face.n.z === 1 && face.p.length === 4 && Math.abs(face.p[0].x) === 1900);
  assert.ok(floor, "в стенде нет пола комнаты");
  assert.equal(floor.room, stand.roomId, "пол не знает своей комнаты");
  // Потолок — на высоте комнаты; тем же цветом крашен низ плиты пола, он ниже нуля.
  const ceiling = scene.faces.find((face) => face.rgb === VOLUME_CEILING_RGB && face.n.z === -1 && face.p[0].z > 0);
  assert.equal(ceiling.room, stand.roomId, "потолок не знает своей комнаты");
  // Сторона стены, смотрящая в комнату, — её; наружная — ничья.
  // Стороны северной и южной стен: грань целиком в плоскости y = ±1400 (в
  // комнату) или y = ±1600 (на улицу).
  const flatAt = (face, y) => face.p.every((point) => Math.abs(Math.abs(point.y) - y) < 1e-6);
  const sides = scene.faces.filter((face) => face.rgb === VOLUME_WALL_RGB && face.n.z === 0 && Math.abs(face.n.y) === 1);
  const inner = sides.filter((face) => flatAt(face, 1400));
  const outer = sides.filter((face) => flatAt(face, 1600));
  assert.ok(inner.length >= 2 && outer.length >= 2, "в стенде нет сторон стен: " + inner.length + "/" + outer.length);
  assert.ok(inner.every((face) => face.room === stand.roomId), "внутренняя сторона стены не знает комнаты");
  assert.ok(outer.every((face) => face.room === null), "наружная сторона стены приписана комнате");
  // Метки в комнате — тоже её: включённый свет светлит и их.
  for (const key of ["lamp", "tv", "switch", "motion"]) {
    const faces = scene.faces.filter((face) => face.markId === stand.marks[key] && !face.line);
    assert.ok(faces.every((face) => face.room === stand.roomId), key + ": метка не знает своей комнаты");
  }
});

// ——— кадр с имитацией: свечение и свет комнаты ———————————————————————————

const DAY = volumeMood({ minutes: 13 * 60, times: { riseMin: 540, setMin: 1260 }, kind: "nature", topDeg: 0 });
const lightOf = (fill) => {
  const parts = String(fill).match(/[\d.]+/g).map(Number);
  return parts[0] + parts[1] + parts[2];
};

function standFrame(stand, scene, tint, live) {
  return volumeFrame(scene, STAND_CAMERAS[0], STAND_BOX, [], tint, live);
}

test("2.12: включённая лампа светится по яркости и не темнеет ночью, выключенная — как была", () => {
  const stand = simStand();
  const scene = volumeScene(stand.project, stand.schemeId, { roofOff: true });
  const plain = standFrame(stand, scene, NIGHT.tint);
  const glowAt = (level, tint = NIGHT.tint) =>
    standFrame(stand, scene, tint, { glow: new Map([[stand.marks.lamp, { level, rgb: VOLUME_GLOW_RGB }]]), rooms: new Map() });
  const full = glowAt(1);
  assert.equal(full.length, plain.length, "свечение добавило или убрало многоугольники");
  const changed = full.map((polygon, index) => (polygon.fill !== plain[index].fill ? index : -1)).filter((index) => index >= 0);
  assert.ok(changed.length > 0, "лампа не засветилась");
  assert.ok(changed.every((index) => full[index].pick === stand.marks.lamp), "засветилось то, что не лампа");
  assert.ok(changed.every((index) => lightOf(full[index].fill) > lightOf(plain[index].fill)), "свечение темнее выключенной");
  // Свет не темнеет ночью: светящаяся грань одинакова в полдень и в полночь.
  const day = glowAt(1, DAY.tint);
  for (const index of changed) assert.equal(day[index].fill, full[index].fill, "свечение покрашено часом");
  // По яркости: 20 % — тусклее, чем 100 %, но светлее выключенной.
  const dim = glowAt(0.2);
  for (const index of changed) {
    assert.ok(lightOf(dim[index].fill) < lightOf(full[index].fill), "20 % ярче или равно 100 %");
    assert.ok(lightOf(dim[index].fill) > lightOf(plain[index].fill), "20 % не светится вовсе");
  }
  // Пустое состояние дома — кадр тот же, что без него.
  assert.deepEqual(standFrame(stand, scene, NIGHT.tint, { glow: new Map(), rooms: new Map() }), plain);
});

test("2.12: экран включённого телевизора загорается своим цветом", () => {
  const stand = simStand();
  const scene = volumeScene(stand.project, stand.schemeId, { roofOff: true });
  const camera = { at: { x: 0, y: 0, z: 1300 }, yaw: Math.PI, pitch: 0 };
  const plain = volumeFrame(scene, camera, STAND_BOX, [], NIGHT.tint);
  const on = volumeFrame(scene, camera, STAND_BOX, [], NIGHT.tint, {
    glow: new Map([[stand.marks.tv, { level: 1, rgb: VOLUME_SCREEN_RGB }]]),
    rooms: new Map(),
  });
  const changed = on.filter((polygon, index) => polygon.fill !== plain[index].fill);
  assert.ok(changed.length > 0, "экран не загорелся");
  assert.ok(changed.every((polygon) => polygon.pick === stand.marks.tv));
  const [r, g, b] = String(changed[0].fill).match(/[\d.]+/g).map(Number);
  assert.ok(b > r, "экран светится тёплым, а не своим холодным цветом: " + changed[0].fill);
});

test("2.12: комната с включённым светом ночью светлее по яркости, днём — чуть теплее и светлее", () => {
  const stand = simStand();
  const scene = volumeScene(stand.project, stand.schemeId, { roofOff: true });
  const roomAt = (level, tint) => standFrame(stand, scene, tint, { glow: new Map(), rooms: new Map([[stand.roomId, level]]) });
  const night = standFrame(stand, scene, NIGHT.tint);
  const lit = roomAt(1, NIGHT.tint);
  const half = roomAt(0.5, NIGHT.tint);
  const changed = lit.map((polygon, index) => (polygon.fill !== night[index].fill ? index : -1)).filter((index) => index >= 0);
  assert.ok(changed.length >= 10, "ночью комната не посветлела: " + changed.length);
  for (const index of changed) {
    assert.ok(lightOf(lit[index].fill) > lightOf(night[index].fill), "свет сделал грань темнее");
    assert.ok(lightOf(half[index].fill) <= lightOf(lit[index].fill), "половина яркости светлее полной");
    assert.ok(lightOf(half[index].fill) >= lightOf(night[index].fill), "половина яркости темнее тёмной комнаты");
  }
  const sum = (frame) => changed.reduce((total, index) => total + lightOf(frame[index].fill), 0);
  assert.ok(sum(half) > sum(night) && sum(half) < sum(lit), "свет не пропорционален яркости");
  // Днём лампу тоже видно — слова заказчика: «днём сейчас их вообще не видно»:
  // грани комнаты светлеют, но не темнеют и не уходят в белое — не больше чем
  // на 15 %.
  const noon = standFrame(stand, scene, DAY.tint);
  const noonLit = roomAt(1, DAY.tint);
  let brighter = 0;
  noonLit.forEach((polygon, index) => {
    if (!polygon.fill) return;
    const before = lightOf(noon[index].fill);
    const after = lightOf(polygon.fill);
    if (after > before) brighter += 1;
    assert.ok(after >= before - 1 && after <= before * 1.15 + 1, "днём свет комнаты не тот: " + polygon.fill + " против " + noon[index].fill);
  });
  assert.ok(brighter >= 10, "днём горящую лампу не видно: " + brighter);
  // Улица и чужое не светлеют: наружные стороны стен и земля — как были.
  const outside = night.map((polygon, index) => index).filter((index) => !changed.includes(index));
  assert.ok(outside.length > 0, "посветлело всё подряд, включая улицу");
});

// ——— шторы по позиции (история 2.12) ————————————————————————————————————————

test("2.12: позиция шторы читается терпимо — прежняя память открытых штор значит «открыта на 100»", () => {
  // Прежняя память (`screenPlace.open.sheers`) — список id открытых штор: он
  // читается как позиция 1, то есть 100 %.
  assert.equal(volumeCurtainShare(new Set(["a"]), "a"), 1);
  assert.equal(volumeCurtainShare(new Set(["a"]), "b"), 0);
  assert.equal(volumeCurtainShare(["a"], "a"), 1);
  // Позиция дома — доля 0…1 по метке.
  assert.equal(volumeCurtainShare(new Map([["a", 0.5]]), "a"), 0.5);
  assert.equal(volumeCurtainShare(new Map([["a", 7]]), "a"), 1);
  assert.equal(volumeCurtainShare(new Map([["a", -1]]), "a"), 0);
  assert.equal(volumeCurtainShare(new Map([["a", "мусор"]]), "a"), 0);
  assert.equal(volumeCurtainShare(null, "a"), 0);
  assert.equal(volumeCurtainShare(new Map(), "a"), 0);
});

// Протяжённость ткани шторы вдоль её стены: грани с `clear` у метки.
function sheerSpan(scene, markId, axis) {
  const values = scene.faces
    .filter((face) => face.markId === markId && face.clear && !face.line)
    .flatMap((face) => face.p.map((point) => point[axis]));
  return { min: Math.min(...values), max: Math.max(...values), length: Math.max(...values) - Math.min(...values) };
}
const solidFaces = (scene, markId) =>
  scene.faces.filter((face) => face.markId === markId && !face.clear && !face.line).map((face) => face.p);

test("2.12: штора рисуется по позиции: 0 — закрыта, 100 — собрана у края, 50 — наполовину", () => {
  const stand = simStand();
  const at = (shares) =>
    volumeScene(stand.project, stand.schemeId, { roofOff: true, ...(shares ? { curtainShares: new Map(shares) } : {}) });
  const plain = at(null);
  for (const key of ["curtain", "rail"]) {
    const id = stand.marks[key];
    const closed = sheerSpan(plain, id, "x");
    // 0 — та же штора, что без позиции, грань в грань.
    const zero = at([[id, 0]]);
    assert.deepEqual(
      zero.faces.filter((face) => face.markId === id).map((face) => face.p),
      plain.faces.filter((face) => face.markId === id).map((face) => face.p),
      key + ": закрытая штора нарисована не так, как без позиции",
    );
    const open = sheerSpan(at([[id, 1]]), id, "x");
    const half = sheerSpan(at([[id, 0.5]]), id, "x");
    assert.ok(open.length <= closed.length * 0.3, key + ": открытая штора не собрана: " + open.length + " из " + closed.length);
    assert.ok(half.length < closed.length * 0.75 && half.length > open.length, key + ": наполовину открытая — не наполовину: " + half.length);
    // Собирается к краю, а не тает посередине: один край ткани остался на месте.
    assert.ok(Math.abs(open.min - closed.min) < 1 || Math.abs(open.max - closed.max) < 1, key + ": штора уехала от обоих краёв");
    // Карниз штору не провожает: плотные тела на месте.
    assert.deepEqual(solidFaces(at([[id, 1]]), id), solidFaces(plain, id), key + ": карниз поехал вместе с тканью");
  }
  // Чужая позиция чужую штору не трогает.
  const other = at([[stand.marks.rail, 1]]);
  assert.deepEqual(sheerSpan(other, stand.marks.curtain, "x"), sheerSpan(plain, stand.marks.curtain, "x"));
});

test("2.12: позиция шторы входит в ключ этажа стопки — сдвинутая штора не берётся из готового этажа", () => {
  const stand = stand0();
  const key = (shares) =>
    volumeFloorKey(stand.project, stand.schemeId, { curtainShares: new Map(shares) }, null, false, { doors: [], sheers: [stand.marks.curtain], objects: [] });
  assert.ok(volumeFloorKeySame(key([[stand.marks.curtain, 0.3]]), key([[stand.marks.curtain, 0.3]])));
  assert.ok(!volumeFloorKeySame(key([[stand.marks.curtain, 0.3]]), key([[stand.marks.curtain, 0.6]])), "позиция не в ключе");
  assert.ok(volumeFloorKeySame(key([]), key([[stand.marks.curtain, 0]])), "закрытая и без позиции — одна штора");
});

let standCached = null;
function stand0() {
  if (!standCached) standCached = simStand();
  return standCached;
}

// ——— правила поверхности «Объёма» при запущенном доме ———————————————————————

// Состояние дома, как его отдаёт зеркало имитации (`simLive`): `Map<markId,
// Live>` по `simLiveOf` — значения задаются ключами `"индекс.Характеристика"`.
function liveOf(stand, values) {
  const map = new Map();
  for (const id of Object.values(stand.marks)) {
    const accessory = markAccessory(stand.project, id);
    if (accessory) map.set(id, simLiveOf(accessory, values[id] || {}));
  }
  return map;
}

test("2.12: что светится и где горит свет — по состоянию дома", () => {
  const stand = simStand();
  const scene = volumeScene(stand.project, stand.schemeId, { roofOff: true });
  const dark = volumeSimLive(stand.project, liveOf(stand, {}));
  assert.equal(volumeLiveLight(scene, dark), null, "в выключенном доме светится что-то");
  const live = volumeSimLive(
    stand.project,
    liveOf(stand, {
      [stand.marks.lamp]: { "0.On": true, "0.Brightness": 40 },
      [stand.marks.tv]: { "0.Active": "ACTIVE" },
    }),
  );
  const light = volumeLiveLight(scene, live);
  assert.ok(light, "включённый свет не дал свечения");
  assert.deepEqual(light.glow.get(stand.marks.lamp), { level: 0.4, rgb: VOLUME_GLOW_RGB, fade: 1 }, "лампа светится не по яркости");
  assert.deepEqual(light.glow.get(stand.marks.tv), { level: 1, rgb: VOLUME_SCREEN_RGB, fade: 1 }, "экран ТВ светится не своим цветом");
  assert.equal(light.glow.has(stand.marks.switch), false, "светится выключатель");
  // Свет комнаты — от светильников, не от телевизора: комната светлеет по
  // яркости лампы.
  const one = light.rooms.get(stand.roomId);
  // С правки «свет от светильников сделай ярче» одна лампа на 40 % светит
  // комнату наполовину — но не целиком.
  assert.ok(one > 0 && one < 0.6, "одна лампа на 40 % залила комнату: " + one);
  // «Чем больше света включено, тем ярче в комнате» (правка после сборки
  // сценариев): яркость лампы и вторая лампа добавляют, а светлее полной
  // комната не бывает.
  const both = volumeSimLive(
    stand.project,
    liveOf(stand, {
      [stand.marks.lamp]: { "0.On": true, "0.Brightness": 80 },
      [stand.marks.night]: { "0.On": true, "0.Brightness": 70 },
    }),
  );
  const two = volumeLiveLight(scene, both).rooms.get(stand.roomId);
  assert.ok(two > one && two < 1, "две лампы не светлее одной: " + one + " → " + two);
});

test("2.12: позиции штор — у штор, что в доме шторы; прежняя память без дома не трогается", () => {
  const stand = simStand();
  const scene = volumeScene(stand.project, stand.schemeId, { roofOff: true });
  const live = volumeSimLive(
    stand.project,
    liveOf(stand, { [stand.marks.curtain]: { "0.CurrentPosition": 50 }, [stand.marks.rail]: { "0.CurrentPosition": 100 } }),
  );
  const shares = volumeSimCurtains(scene, live);
  assert.equal(shares.get(stand.marks.curtain), 0.5);
  assert.equal(shares.get(stand.marks.rail), 1);
  assert.equal(shares.size, 2, "позиция у того, что не штора");
  // Штора без аксессуара (профиль «без устройства») позиции дома не получает:
  // она открывается, как до имитации, своей памятью.
  const none = setMarkDevice(stand.project, stand.marks.curtain, { kind: "none" }).project;
  const noneScene = volumeScene(none, stand.schemeId, { roofOff: true });
  assert.equal(volumeSimCurtains(noneScene, volumeSimLive(none, liveOf({ ...stand, project: none }, {}))).has(stand.marks.curtain), false);
});

test("2.8: датчик видит того, кто стоит в его помещении; на улице — никого", () => {
  const stand = simStand();
  const scene = volumeScene(stand.project, stand.schemeId, { roofOff: true });
  assert.deepEqual(volumeSimRooms(scene, { x: 0, y: 0 }), [stand.roomId]);
  assert.deepEqual(volumeSimRooms(scene, { x: 0, y: 5000 }), []);
  assert.deepEqual(volumeSimRooms(scene, null), []);
});

test("2.5, 2.6: E и щелчок — привязанная клавиша переключает сразу, отвязанная ждёт одиночное/двойное/долгое", () => {
  const stand = simStand();
  const of = (project, key) => markAccessory(project, stand.marks[key]);
  // В — одна привязанная клавиша: нажатие сразу (одиночное переключает её
  // «Выключатель», нагрузки идут за ним).
  const single = volumeSimAction(of(stand.project, "switch"), null);
  assert.equal(single.kind, "press");
  assert.equal(of(stand.project, "switch").services[single.index].type, "StatelessProgrammableSwitch");
  // ВВ — клавиша по каналу под рукой; мимо клавиши — только выделить.
  const second = volumeSimAction(of(stand.project, "double"), 2);
  assert.equal(second.kind, "press");
  assert.equal(of(stand.project, "double").services[second.index].chars.find((char) => char.type === "ServiceLabelIndex").value, 2);
  assert.equal(volumeSimAction(of(stand.project, "double"), null).kind, "none");
  // Отвязанная клавиша — нажатие распознаётся: одиночное, двойное, долгое.
  const decoupled = setMarkDevice(stand.project, stand.marks.switch, { decoupled: [1] }).project;
  const hold = volumeSimAction(of(decoupled, "switch"), null);
  assert.equal(hold.kind, "hold");
  assert.equal(hold.index, single.index, "отвязанная клавиша жмёт не свою кнопку");
  // Остальное: свет, штора, телевизор переключаются; датчик срабатывает.
  for (const key of ["lamp", "curtain", "rail", "tv"]) assert.equal(volumeSimAction(of(stand.project, key), null).kind, "toggle", key);
  assert.equal(volumeSimAction(of(stand.project, "motion"), null).kind, "sensor");
  assert.equal(volumeSimAction(null, null).kind, "none");
});

test("2.12: прежняя память открытых штор открывает их в доме, который здесь ещё не запускали", () => {
  const sheers = ["a", "b", "c"];
  const memory = new Set(["a", "c", "dead"]);
  const curtains = new Set(["a", "b"]);
  // Дом впервые: открытая в памяти штора-аксессуар открывается и в доме.
  assert.deepEqual(volumeSimSeed(sheers, memory, curtains, false), ["a"]);
  // Дом уже помнит себя — его память старше: ничего не трогаем.
  assert.deepEqual(volumeSimSeed(sheers, memory, curtains, true), []);
});

// ——— телефон: карточка не заползает под кнопки управления (G21, история 8.6) ——

const overlaps = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
// Карточка по месту, которое ей дали: отступы от краёв поля → прямоугольник.
const cardRect = (box, place) => ({
  left: place.left,
  right: box.width - place.right,
  bottom: box.height - place.bottom,
  top: box.height - place.bottom - place.maxHeight,
});

test("8.6: на телефоне карточка метки не перекрывает кнопки ходьбы, стойки и «Действие» — стоя и лёжа", () => {
  // Замеры живого поля: столбик стойки (прыжок, присед, «Действие» по 44 точки
  // через 10) над миникартой слева, площадка ходьбы 128 справа, верхний ряд
  // угловых кнопок кончается на 122.
  const cases = [
    { name: "стоя", box: { width: 390, height: 780 }, minimapTop: 600 },
    { name: "лёжа", box: { width: 844, height: 390 }, minimapTop: 372 },
  ];
  for (const { name, box, minimapTop } of cases) {
    const stance = { left: 18, right: 62, bottom: minimapTop - 10, top: minimapTop - 10 - 152 };
    const pad = { left: box.width - 18 - 128, right: box.width - 18, top: box.height - 18 - 128, bottom: box.height - 18 };
    const place = volumeCardPlace(box, [stance, pad], 122);
    assert.ok(place, name + ": карточке не нашлось места");
    const rect = cardRect(box, place);
    assert.ok(!overlaps(rect, stance), name + ": карточка легла на столбик стойки " + JSON.stringify(rect));
    assert.ok(!overlaps(rect, pad), name + ": карточка легла на площадку ходьбы " + JSON.stringify(rect));
    assert.ok(rect.top >= 122, name + ": карточка залезла под верхние кнопки");
    assert.ok(place.maxHeight >= 96, name + ": карточка ужата до щели: " + place.maxHeight);
    assert.ok(rect.right - rect.left >= 240, name + ": карточка ужата по ширине: " + (rect.right - rect.left));
  }
  // Без сенсорной оснастки — места не назначается: карточка стоит, как стояла.
  assert.equal(volumeCardPlace({ width: 1200, height: 800 }, [], 0), null);
});

test("2.6, 8.5: подсказка говорит, что делают руки при запущенном доме — мышью про E, пальцем про «Действие»", () => {
  const base = { empty: false, view: "person", touching: false, locked: false, aim: true, doors: [], open: new Set(), sheers: [], openSheers: new Set() };
  assert.ok(!volumeHintText(base).includes(strings.volume.homeHint), "без дома подсказка говорит про дом");
  assert.ok(volumeHintText({ ...base, home: true }).includes(strings.volume.homeHint));
  const touch = volumeHintText({ ...base, home: true, touching: true });
  assert.ok(touch.includes(strings.volume.homeTouchHint), "пальцем не сказано про кнопку «Действие»");
  assert.ok(!touch.includes(strings.volume.homeHint));
});

// ——— видно, что работает (правка после сборки сценариев) ————————————————————
//
// «На выключателях можно диодик на кнопке канала снизу разместить, на розетке
// сверху справа светодиод активности и т.д. придумай как визуально отличать
// работающие от отключенных устройств», «На вентиляции должны быть потоки
// воздуха».

test("признаки работы: диод под каждой клавишей по её реле, розетка, датчик, поток бризера", () => {
  const box = simStand();
  put(box, "socket", "Р", [{ x: 1850, y: 300 }]);
  put(box, "breezer", "Б", [{ x: -1000, y: -1350 }]);
  const scene = volumeScene(box.project, box.schemeId, { roofOff: true });
  const ledsOf = (signs, id) => signs.filter((face) => !face.line && face.markId === id);
  // Дом выключен: у клавиш и розетки диоды тёмные, у датчика и бризера — ничего.
  const dark = volumeSimLive(box.project, liveOf(box, {}));
  const quiet = volumeLiveSigns(scene, dark);
  const doubleOff = ledsOf(quiet, box.marks.double);
  assert.equal(doubleOff.length, 2, "у ВВ не два диода");
  for (const led of doubleOff) assert.deepEqual(led.rgb, VOLUME_LED_OFF_RGB);
  assert.deepEqual(ledsOf(quiet, box.marks.socket).map((led) => led.rgb), [VOLUME_LED_OFF_RGB]);
  assert.equal(ledsOf(quiet, box.marks.motion).length, 0, "у спокойного датчика горит диод");
  assert.equal(quiet.filter((face) => face.line).length, 0, "выключенный бризер дует");
  // Вторая клавиша ВВ включена: горит её диод, и только он.
  const double = markAccessory(box.project, box.marks.double);
  const second = double.services.find((service) => service.type === "Switch" && service.channel === 2).index;
  const breezer = markAccessory(box.project, box.marks.breezer);
  const fan = breezer.services.find((service) => service.type === "Fan").index;
  const live = volumeSimLive(
    box.project,
    liveOf(box, {
      [box.marks.double]: { [second + ".On"]: true },
      [box.marks.socket]: { "0.On": true },
      [box.marks.motion]: { "0.MotionDetected": true },
      [box.marks.breezer]: { [fan + ".Active"]: "ACTIVE", [fan + ".RotationSpeed"]: 100 },
    }),
  );
  const signs = volumeLiveSigns(scene, live);
  const keys = ledsOf(signs, box.marks.double);
  assert.deepEqual(keys.map((led) => led.rgb).sort(), [VOLUME_LED_KEY_RGB, VOLUME_LED_OFF_RGB].sort());
  assert.equal(keys.filter((led) => led.led).length, 1, "горит не один диод");
  // Диод клавиши — внизу клавиши: ниже середины лица.
  const place = scene.marks.find((item) => item.markId === box.marks.double);
  for (const led of keys) {
    const z = led.p.reduce((sum, point) => sum + point.z, 0) / led.p.length;
    assert.ok(z < place.face.origin.z, "диод клавиши не внизу");
  }
  assert.deepEqual(ledsOf(signs, box.marks.socket).map((led) => led.rgb), [VOLUME_LED_ON_RGB]);
  assert.deepEqual(ledsOf(signs, box.marks.motion).map((led) => led.rgb), [VOLUME_LED_ALERT_RGB]);
  // Бризер: струи со стрелкой уходят от лица в комнату.
  const flows = signs.filter((face) => face.line);
  assert.equal(flows.length, 3, "у бризера не три струи");
  const breezerPlace = scene.marks.find((item) => item.markId === box.marks.breezer);
  for (const flow of flows) {
    assert.equal(flow.arrow, true);
    const end = flow.p[flow.p.length - 1];
    const out = (end.x - breezerPlace.face.origin.x) * breezerPlace.face.normal.x + (end.y - breezerPlace.face.origin.y) * breezerPlace.face.normal.y;
    assert.ok(out > 500, "струя не ушла от лица: " + out);
  }
  // Свет, экран и штора своё показывают сами — признаков у них нет.
  for (const key of ["lamp", "tv", "curtain"]) assert.equal(ledsOf(signs, box.marks[key]).length, 0, key);
  // Горящий диод светится своим цветом и ночью: в кадре он без тона часа.
  const camera = { at: { x: 0, y: 0, z: 1600 }, yaw: 0, pitch: 0 };
  const lit = keys.find((led) => led.led);
  const frame = volumeFrame(scene, camera, { width: 800, height: 500 }, [lit], { rgb: [18, 26, 54], share: 0.8 }, null);
  const shown = frame.find((polygon) => polygon.pick === box.marks.double && polygon.fill === "rgb(" + VOLUME_LED_KEY_RGB.join(",") + ")");
  assert.ok(shown, "горящий диод ночью потемнел");
});
