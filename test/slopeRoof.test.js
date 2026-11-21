// Крыша из скатов — доработки 2026-11-21 (правка без автопилота).
//
// Слова заказчика о кадрах «Белого дома»: «как будто просто лист приложили. не
// хорошо» (скат под плоским потолком), «ступенчатая лента смотрится очень
// плохо», «Балки и короба с подсветкой вдоль конька… Воздуховоды включи».
//
// Что этот тест держит:
//
//   1. **Щёки.** Стык кусков потолка, не сошедшихся по высоте, закрыт
//      вертикальной гранью; сошедшиеся скаты (конёк, ендова) щёк не дают;
//      полоска плоского потолка между скатом и стеной — погрешность обводки,
//      её не рисуют и щеки к ней не ставят.
//   2. **Запас ската не перебивает скат над точкой:** у ендовы стена идёт по
//      настоящему потолку, а не по продлённому соседу.
//   3. **Лента под скатом — наклонными кусками**, без ступеней: кусок на звено,
//      излом только на коньке; источники света стоят на самой ленте.
//   4. **Вещь под потолком** (балка, короб, воздуховод): высоту даёт потолок,
//      под скатом она лежит по его уклону, грани остаются плоскими.
//   5. **G68.** Объект без скатов собирается грань в грань прежним.
import test from "node:test";
import assert from "node:assert/strict";
import {
  addMark,
  addOutline,
  addOutlineSlope,
  addRoom,
  addScheme,
  addSchemeObject,
  addWall,
  ceilingHeightAt,
  createProject,
  planMmToFraction,
  schemeObjectCeilingSeat,
  schemeObjectIsCeiling,
  schemeObjectMountOf,
  setPlanOrigin,
  setPlanScale,
  setSchemeWallHeight,
  wallObjectsOn,
  wallTopProfile,
} from "../src/model.js";
import { objectCatalogEntry, objectCatalogKeyByName } from "../src/objectCatalog.js";
import { objectModelByKey, objectModelFaceCount, objectModelLimits } from "../src/objectModels/registry.js";
import { slopeCeilingPieces, slopeCheeks, slopePieceStray, slopeProfile, slopeProfileAt, slopesHeightAt } from "../src/slopes.js";
import { volumeCeilingUnderVoid, volumeLampSources, volumeMarkFaces, volumeMarkPlace, volumeObjectFaces, volumeScene } from "../src/volume.js";

function attic() {
  let project = createProject();
  const added = addScheme(project, { name: "Мансарда", imageId: "i", width: 1000, height: 1000 });
  project = added.project;
  const schemeId = added.scheme.id;
  project = setPlanScale(project, schemeId, { a: { x: 0, y: 0 }, b: { x: 1, y: 0 }, meters: 10 }).project;
  project = setPlanOrigin(project, schemeId, { at: { x: 0, y: 0 }, turn: 0 }).project;
  project = setSchemeWallHeight(project, schemeId, 3000).project;
  const wall = (a, b) => {
    const made = addWall(project, { schemeId, aMm: a, bMm: b, thicknessMm: 200 });
    project = made.project;
    return made.wall.id;
  };
  const north = wall({ x: 1000, y: 1000 }, { x: 7000, y: 1000 });
  const east = wall({ x: 7000, y: 1000 }, { x: 7000, y: 5000 });
  const south = wall({ x: 7000, y: 5000 }, { x: 1000, y: 5000 });
  const west = wall({ x: 1000, y: 5000 }, { x: 1000, y: 1000 });
  const room = addRoom(project, { name: "Кабинет" });
  project = room.project;
  const outline = addOutline(project, {
    schemeId,
    roomId: room.room.id,
    points: [{ x: 0.11, y: 0.11 }, { x: 0.69, y: 0.11 }, { x: 0.69, y: 0.49 }, { x: 0.11, y: 0.49 }],
  });
  project = outline.project;
  return { project, schemeId, outlineId: outline.outline.id, walls: { north, east, south, west } };
}

const ROOM = [{ x: 1100, y: 1100 }, { x: 6900, y: 1100 }, { x: 6900, y: 4900 }, { x: 1100, y: 4900 }];
// Скат на всю комнату: 1000 у южной стены, 3000 у северной.
const WHOLE = { pointsMm: ROOM, edge: 2, lowMm: 1000, highMm: 3000 };
// Скат на западную половину: остальное — плоский потолок 3000.
const HALF = { pointsMm: [{ x: 1100, y: 1100 }, { x: 4000, y: 1100 }, { x: 4000, y: 4900 }, { x: 1100, y: 4900 }], edge: 2, lowMm: 1000, highMm: 3000 };
// Двускатная крыша: конёк на x = 4000, 1000 у стен и 2500 в коньке.
const GABLE = [
  { pointsMm: [{ x: 1100, y: 1100 }, { x: 4000, y: 1100 }, { x: 4000, y: 4900 }, { x: 1100, y: 4900 }], edge: 3, lowMm: 1000, highMm: 2500 },
  { pointsMm: [{ x: 4000, y: 1100 }, { x: 6900, y: 1100 }, { x: 6900, y: 4900 }, { x: 4000, y: 4900 }], edge: 1, lowMm: 1000, highMm: 2500 },
];

const near = (actual, expected, message, eps = 1) => assert.ok(Math.abs(actual - expected) <= eps, message + ": " + actual + " вместо " + expected);
const flat = (face) => {
  // Все точки грани в одной плоскости: смешанное произведение от первой тройки.
  const [a, b, c] = face.p;
  const n = {
    x: (b.y - a.y) * (c.z - a.z) - (b.z - a.z) * (c.y - a.y),
    y: (b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z),
    z: (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x),
  };
  const size = Math.hypot(n.x, n.y, n.z) || 1;
  return face.p.every((point) => Math.abs(((point.x - a.x) * n.x + (point.y - a.y) * n.y + (point.z - a.z) * n.z) / size) < 0.01);
};

test("щёки: край ската под плоским потолком закрыт вертикальной гранью, сошедшиеся скаты щёк не дают", () => {
  const half = slopeCheeks(slopeCeilingPieces(ROOM, [HALF], 3000));
  assert.equal(half.length, 1, "у ската на полкомнаты одна щека — по его боковой кромке");
  const cheek = half[0].points;
  assert.ok(cheek.every((point) => Math.abs(point.x - 4000) < 0.01), "щека не на кромке ската");
  // Треугольник: у северной стены скат сошёлся с потолком (3000), у южной — 1000 против 3000.
  assert.equal(cheek.length, 3);
  near(Math.min(...cheek.map((point) => point.z)), 1000, "низ щеки — кромка ската");
  near(Math.max(...cheek.map((point) => point.z)), 3000, "верх щеки — плоский потолок");
  assert.deepEqual(slopeCheeks(slopeCeilingPieces(ROOM, GABLE, 3000)), [], "конёк получил щеку");
  assert.deepEqual(slopeCheeks(slopeCeilingPieces(ROOM, [WHOLE], 3000)), [], "скат на всю комнату получил щеку");
  assert.deepEqual(slopeCheeks(slopeCeilingPieces(ROOM, [], 3000)), [], "плоский потолок получил щеку");
  assert.deepEqual(slopeCheeks(null), []);
});

test("щёки: уступ между двумя скатами закрыт; пересёкшиеся по высоте — двумя треугольниками", () => {
  // Восточный скат поднят на 600: вдоль конька уступ.
  const step = [GABLE[0], { ...GABLE[1], lowMm: 1600, highMm: 3100 }];
  const cheeks = slopeCheeks(slopeCeilingPieces(ROOM, step, 3200));
  assert.equal(cheeks.length, 1);
  assert.equal(cheeks[0].points.length, 4, "уступ вдоль конька — прямоугольник");
  near(Math.min(...cheeks[0].points.map((point) => point.z)), 2500, "низ уступа");
  near(Math.max(...cheeks[0].points.map((point) => point.z)), 3100, "верх уступа");
  // Куски с общей кромкой, у которых высоты меняются местами посреди стыка.
  const cross = slopeCheeks([
    { slope: 0, points: [{ x: 0, y: 0, z: 1000 }, { x: 1000, y: 0, z: 1000 }, { x: 1000, y: 1000, z: 2000 }, { x: 0, y: 1000, z: 1000 }] },
    { slope: 1, points: [{ x: 1000, y: 0, z: 2000 }, { x: 2000, y: 0, z: 2000 }, { x: 2000, y: 1000, z: 1000 }, { x: 1000, y: 1000, z: 1000 }] },
  ]);
  assert.equal(cross.length, 2, "пересёкшийся стык не разрезан на два треугольника");
  assert.ok(cross.every((item) => item.points.length === 3));
});

test("полоска плоского потолка между скатом и стеной — погрешность обводки: её нет в сцене, и щеки к ней нет", () => {
  // Участок обведён на 60 мм внутри контура по всем сторонам.
  const inset = { pointsMm: [{ x: 1160, y: 1160 }, { x: 6840, y: 1160 }, { x: 6840, y: 4840 }, { x: 1160, y: 4840 }], edge: 2, lowMm: 1000, highMm: 3000 };
  const pieces = slopeCeilingPieces(ROOM, [inset], 3000);
  const strays = pieces.filter(slopePieceStray);
  assert.ok(strays.length >= 4, "полоски вдоль стен не узнаны");
  assert.ok(strays.every((piece) => piece.slope === -1), "обрезком назван кусок ската");
  assert.deepEqual(slopeCheeks(pieces), [], "к полоске у стены поставлена щека во всю высоту");
  // Настоящая плоская часть в полкомнаты — не обрезок.
  assert.equal(slopeCeilingPieces(ROOM, [HALF], 3000).filter(slopePieceStray).length, 0);
  // Сцена: над скатом не осталось ни одной грани потолка на высоте помещения.
  const base = attic();
  const project = addOutlineSlope(base.project, base.outlineId, inset).project;
  const ceilings = volumeScene(project, base.schemeId).faces.filter((face) => face.paint === "ceiling" || (face.n && face.n.z < -0.5 && face.both));
  assert.ok(ceilings.length > 0);
  for (const face of ceilings) {
    assert.ok(!face.p.every((point) => Math.abs(point.z - 3000) < 1), "полоска плоского потолка осталась висеть над скатом");
  }
});

test("сцена: щека — грань потолка своего помещения, двусторонняя; потолок из сошедшихся скатов прежний", () => {
  const base = attic();
  const count = (project) => volumeScene(project, base.schemeId).faces.length;
  const whole = addOutlineSlope(base.project, base.outlineId, WHOLE).project;
  const half = addOutlineSlope(base.project, base.outlineId, HALF).project;
  // У ската на всю комнату щёк нет: граней столько же, сколько кусков потолка.
  const scene = volumeScene(half, base.schemeId);
  const cheeks = scene.faces.filter((face) => face.n && Math.abs(face.n.z) < 0.01 && face.both && face.p.every((point) => Math.abs(point.x - 4000) < 0.01));
  assert.equal(cheeks.length, 1, "щека не попала в сцену");
  assert.ok(cheeks[0].room, "у щеки нет помещения");
  assert.ok(flat(cheeks[0]));
  assert.ok(count(whole) > 0);
  // Стопка двигает точки на месте: у щеки они свои.
  const others = scene.faces.filter((face) => face !== cheeks[0]);
  for (const point of cheeks[0].p) assert.ok(!others.some((face) => face.p.includes(point)), "щека делит точку с другой гранью");
});

test("запас ската не перебивает скат над точкой: у ендовы высота — настоящего потолка", () => {
  // Две плоскости сходятся ендовой на x = 4000: западная поднимается к западу, восточная — к востоку.
  const valley = [
    { pointsMm: [{ x: 1100, y: 1100 }, { x: 4000, y: 1100 }, { x: 4000, y: 4900 }, { x: 1100, y: 4900 }], edge: 1, lowMm: 1000, highMm: 2500 },
    { pointsMm: [{ x: 4000, y: 1100 }, { x: 6900, y: 1100 }, { x: 6900, y: 4900 }, { x: 4000, y: 4900 }], edge: 3, lowMm: 1000, highMm: 2500 },
  ];
  // В 200 мм от ендовы западный скат уже на 1103; продлённый восточный там был бы ниже нуля.
  near(slopesHeightAt(valley, { x: 3800, y: 3000 }, 3000, 400), slopesHeightAt(valley, { x: 3800, y: 3000 }, 3000), "запас подменил скат над точкой");
  assert.ok(slopesHeightAt(valley, { x: 3800, y: 3000 }, 3000, 400) > 1050);
  // Профиль вдоль стены поперёк ендовы: V без провалов.
  const profile = slopeProfile(valley, { x: 1100, y: 3000 }, { x: 6900, y: 3000 }, 3000);
  for (let along = 100; along < 5800; along += 100) {
    near(slopeProfileAt(profile, along), slopesHeightAt(valley, { x: 1100 + along, y: 3000 }, 3000), "профиль у ендовы ниже потолка, " + along, 2);
  }
  // За краем ската запас по-прежнему работает: точка в стене берёт высоту ската.
  near(slopesHeightAt([WHOLE], { x: 1050, y: 4950 }, 3000, 400), 1000, "запас за краем перестал работать", 60);
  assert.equal(slopesHeightAt([WHOLE], { x: 1050, y: 4950 }, 3000), 3000);
});

function withTape(base, slopes, path) {
  let project = base.project;
  for (const slope of slopes) project = addOutlineSlope(project, base.outlineId, slope).project;
  const type = project.markTypes.find((item) => item.code === "Л");
  const made = addMark(project, { schemeId: base.schemeId, typeId: type.id, kind: "line", points: path.map((point) => planMmToFraction(project, base.schemeId, point)) });
  return { project: made.project, markId: made.marks[0].id };
}

test("лента под скатом — один наклонный кусок на звено, без ступеней; вдоль ската — ровная", () => {
  const base = attic();
  // Лента вверх по скату: от южной стены к северной.
  const up = withTape(base, [WHOLE], [{ x: 3000, y: 4700 }, { x: 3000, y: 1300 }]);
  const place = volumeMarkPlace(volumeScene(up.project, base.schemeId), up.markId);
  assert.equal(place.prisms.length, 1, "лента по скату нарезана кусками: " + place.prisms.length);
  const prism = place.prisms[0];
  assert.ok(prism.tilt, "куску не записан наклон");
  near(Math.abs(prism.tilt.perMm), 2000 / 3800, "уклон ленты не равен уклону ската", 0.001);
  // Грани плоские, верх ленты лежит под самым скатом на всей длине.
  const faces = volumeMarkFaces(place, [], 1);
  assert.equal(faces.length, 6);
  for (const face of faces) assert.ok(flat(face), "грань наклонной ленты не плоская");
  for (const point of faces.flatMap((face) => face.p)) {
    const gap = slopesHeightAt([WHOLE], point, 3000) - point.z;
    assert.ok(gap > -1 && gap < 40, "лента отошла от ската или врезалась в него: " + gap);
  }
  // Источники света — на самой ленте, а не на её средней высоте.
  const sources = volumeLampSources(place, null);
  assert.ok(sources.length >= 3);
  for (const source of sources) {
    const gap = slopesHeightAt([WHOLE], source.at, 3000) - source.at.z;
    assert.ok(gap > 0 && gap < 40, "источник света не на ленте: " + gap);
  }
  // Лента вдоль ската (по горизонтали) — ровная призма без наклона.
  const along = withTape(base, [WHOLE], [{ x: 1500, y: 3000 }, { x: 6500, y: 3000 }]);
  const level = volumeMarkPlace(volumeScene(along.project, base.schemeId), along.markId);
  assert.equal(level.prisms.length, 1);
  assert.equal(level.prisms[0].tilt, undefined, "ровной ленте записан наклон");
});

test("лента через конёк ломается на коньке и только на нём", () => {
  const base = attic();
  const tape = withTape(base, GABLE, [{ x: 1500, y: 3000 }, { x: 6500, y: 3000 }]);
  const place = volumeMarkPlace(volumeScene(tape.project, base.schemeId), tape.markId);
  // Два длинных куска и, может быть, короткий переходный у самого конька.
  assert.ok(place.prisms.length >= 2 && place.prisms.length <= 3, "кусков: " + place.prisms.length);
  const long = place.prisms.filter((prism) => prism.tilt && Math.abs(prism.tilt.perMm) > 0.4);
  assert.equal(long.length, 2, "двух скатов у ленты не видно");
  assert.ok(long[0].tilt.perMm * long[1].tilt.perMm < 0, "оба куска наклонены в одну сторону");
  for (const face of volumeMarkFaces(place, [], 1)) assert.ok(flat(face));
});

test("G68: лента под ровным потолком — прежняя призма, без наклона и без новых ключей", () => {
  const base = attic();
  const tape = withTape(base, [], [{ x: 1500, y: 3000 }, { x: 6500, y: 3000 }]);
  const place = volumeMarkPlace(volumeScene(tape.project, base.schemeId), tape.markId);
  assert.equal(place.prisms.length, 1);
  assert.deepEqual(Object.keys(place.prisms[0]).sort(), ["bottomMm", "corners", "topMm"]);
});

const thing = (base, key, at, size, extra = {}) => ({
  schemeId: base.schemeId,
  catalogKey: key,
  shape: "rect",
  atMm: at,
  widthMm: size[0],
  depthMm: size[1],
  heightMm: size[2],
  heightAboveFloorMm: 0,
  turnDeg: 0,
  ...extra,
});

test("каталог: балка, потолочный короб и воздуховод висят под потолком и узнаются по имени", () => {
  for (const key of ["beam", "ceilingBox", "airDuct"]) {
    const entry = objectCatalogEntry(key);
    assert.equal(entry.mount, "ceiling", key);
    assert.equal(entry.category, "structures", key);
    const model = objectModelByKey(key);
    const limits = objectModelLimits(key);
    assert.ok(model.parts.length <= limits.bodies && objectModelFaceCount(model) <= limits.faces, key + ": модель вышла за предел");
  }
  assert.equal(objectCatalogKeyByName("Балка"), "beam");
  assert.equal(objectCatalogKeyByName("Воздуховод круглый"), "airDuct");
  // «Короб потолочный» не уходит к стояку, а «Короб» остаётся стояком (G68).
  assert.equal(objectCatalogKeyByName("Короб потолочный"), "ceilingBox");
  assert.equal(objectCatalogKeyByName("Короб"), "duct");
  assert.equal(objectCatalogKeyByName("Короб (стояк)"), "duct");
  // Воздуховод — труба лёжа вдоль длины и решётки по длине.
  const duct = objectModelByKey("airDuct");
  assert.equal(duct.parts[0].kind, "tube");
  assert.equal(duct.parts[0].axis, "x");
  assert.equal(duct.parts.filter((part) => part.name.startsWith("grille")).length, 4);
});

test("посадка под потолком: под ровным — горизонтально под ним, под скатом — по его уклону, опуск опускает", () => {
  const base = attic();
  // Ровный потолок 3000: балка 200 висит верхом под потолком.
  const flatRoom = addSchemeObject(base.project, thing(base, "beam", { x: 4000, y: 3000 }, [3000, 150, 200]));
  const level = schemeObjectCeilingSeat(flatRoom.project, flatRoom.schemeObject);
  near(level.topMm, 3000 - 2, "верх балки не под потолком");
  near(level.bottomMm, 2800 - 2, "низ балки");
  assert.equal(level.perMm, 0);
  assert.equal(schemeObjectIsCeiling(flatRoom.project, flatRoom.schemeObject), true);
  assert.equal(schemeObjectMountOf(flatRoom.project, flatRoom.schemeObject), "ceiling");
  // Опуск: то же поле, что «от пола» у прочих вещей.
  const hung = addSchemeObject(base.project, thing(base, "airDuct", { x: 4000, y: 3000 }, [3000, 300, 300], { heightAboveFloorMm: 250 }));
  near(schemeObjectCeilingSeat(hung.project, hung.schemeObject).topMm, 3000 - 250 - 2, "опуск не опустил");
  // Вещь на полу посадки под потолком не получает.
  const table = addSchemeObject(base.project, thing(base, "table", { x: 4000, y: 3000 }, [1200, 800, 750]));
  assert.equal(schemeObjectCeilingSeat(table.project, table.schemeObject), null);
  assert.equal(schemeObjectIsCeiling(table.project, table.schemeObject), false);

  // Под скатом: балка повёрнута вдоль уклона (длина по y), лежит по плоскости ската.
  const sloped = addOutlineSlope(base.project, base.outlineId, WHOLE).project;
  const rafter = addSchemeObject(sloped, thing(base, "beam", { x: 4000, y: 3000 }, [3000, 150, 200], { turnDeg: 90 }));
  const seat = schemeObjectCeilingSeat(rafter.project, rafter.schemeObject);
  near(Math.abs(seat.perMm), 2000 / 3800, "уклон балки не равен уклону ската", 0.001);
  near(seat.topMm, ceilingHeightAt(rafter.project, base.schemeId, { x: 4000, y: 3000 }) - 2, "середина балки не под скатом", 1);
  const faces = volumeObjectFaces(rafter.project, base.schemeId, rafter.schemeObject, 3000, []);
  assert.equal(faces.length, 12, "у балки два тела по шесть граней");
  for (const face of faces) {
    assert.ok(flat(face), "грань наклонной балки не плоская");
    near(Math.hypot(face.n.x, face.n.y, face.n.z), 1, "нормаль не единичная", 0.001);
  }
  for (const point of faces.flatMap((face) => face.p)) {
    const gap = ceilingHeightAt(rafter.project, base.schemeId, { x: point.x, y: point.y }) - point.z;
    assert.ok(gap > 0.5 && gap < 210, "балка вышла из-под ската: " + gap);
  }
  // Поперёк ската (длина по горизонтали): балка ровная и висит от нижней своей кромки.
  const purlin = addSchemeObject(sloped, thing(base, "beam", { x: 4000, y: 3000 }, [3000, 150, 200]));
  const across = schemeObjectCeilingSeat(purlin.project, purlin.schemeObject);
  assert.equal(across.perMm, 0);
  near(across.topMm, ceilingHeightAt(purlin.project, base.schemeId, { x: 4000, y: 3075 }) - 2, "балка поперёк ската врезалась в него", 1);
  // Развёртка стены вещь под потолком не рисует: у неё нет высоты от пола.
  const byWall = addSchemeObject(sloped, thing(base, "beam", { x: 4000, y: 1250 }, [3000, 150, 200]));
  assert.deepEqual(wallObjectsOn(byWall.project, base.walls.north, "left").concat(wallObjectsOn(byWall.project, base.walls.north, "right")), []);
});

test("G68: вещь на полу и объект без вещей под потолком собираются прежними гранями", () => {
  const base = attic();
  const table = addSchemeObject(base.project, thing(base, "table", { x: 4000, y: 3000 }, [1200, 800, 750]));
  const faces = volumeObjectFaces(table.project, base.schemeId, table.schemeObject, 3000, []);
  assert.ok(faces.length > 0);
  assert.equal(Math.min(...faces.flatMap((face) => face.p.map((point) => point.z))), 0, "стол оторвался от пола");
  near(Math.max(...faces.flatMap((face) => face.p.map((point) => point.z))), 750, "высота стола");
  // Профиль стены без скатов по-прежнему пуст.
  assert.equal(wallTopProfile(base.project, base.walls.north), null);
});

test("двусвет под дырой со скатами своего потолка не рисует, какой бы высоты он ни был", () => {
  const square = (half) => [{ x: -half, y: -half }, { x: half, y: -half }, { x: half, y: half }, { x: -half, y: half }];
  const capMm = 3200;
  const tall = { heightMm: 6000, pointsMm: square(2000) };
  // Прежнее правило: комната выше этажа держит свой потолок.
  assert.equal(volumeCeilingUnderVoid(tall, [square(2000)], capMm), false);
  assert.equal(volumeCeilingUnderVoid(tall, [square(2000)], capMm, []), false);
  // Над ней дыра со скатами — потолком стала крыша этажа выше.
  assert.equal(volumeCeilingUnderVoid(tall, [square(2000)], capMm, [square(2000)]), true);
  // Дыра со скатами в стороне комнату не трогает.
  const aside = square(2000).map((point) => ({ x: point.x + 9000, y: point.y }));
  assert.equal(volumeCeilingUnderVoid(tall, [square(2000), aside], capMm, [aside]), false);
  // Комната в высоту этажа — прежним правилом, со скатами или без.
  const plain = { heightMm: capMm - 200, pointsMm: square(2000) };
  assert.equal(volumeCeilingUnderVoid(plain, [square(2000)], capMm, [square(2000)]), volumeCeilingUnderVoid(plain, [square(2000)], capMm));
});
