// Сцены стенда «Объёма» (tools/bench): объекты, на которых меряется кадр.
// Строятся командами модели, как их строил бы человек, — без файлов заказчика
// (`tmp/` в замеры не берётся: это настоящие объекты, G68).
//
//   flat — квартира с мебелью: гостиная, коридор, спальня в ряд, две двери,
//          окно, пять ламп, диван, столик, кресло, шкаф, кровать, комод.
//          На ней сняты числа §6.4 карты архитектуры;
//   hall — тяжёлый край: зал 14 × 10 м, 48 вещей и 20 ламп — пересборка
//          света и тени здесь в десятки раз дороже обычной.
import * as M from "../../src/model.js";

function sceneBase(width, height, meters) {
  const added = M.addScheme(M.createProject(), { name: "1 этаж", imageId: "plan", width, height });
  let project = M.setPlanScale(added.project, added.scheme.id, { a: { x: 0, y: 0.5 }, b: { x: 1, y: 0.5 }, meters }).project;
  project = M.setPlanOrigin(project, added.scheme.id, { at: { x: 0.5, y: 0.5 }, turn: 0 }).project;
  project = M.setSchemeWallHeight(project, added.scheme.id, 2700).project;
  return { project, schemeId: added.scheme.id, lamps: [], doors: [] };
}

function wallOf(box, a, b) {
  const made = M.addWall(box.project, { schemeId: box.schemeId, aMm: a, bMm: b, thicknessMm: 200 });
  box.project = made.project;
  return made.wall.id;
}

function roomOf(box, name, from, to) {
  const made = M.addRoom(box.project, { name });
  box.project = made.project;
  const fr = (p) => M.planMmToFraction(box.project, box.schemeId, p);
  const points = [
    { x: from.x, y: from.y },
    { x: to.x, y: from.y },
    { x: to.x, y: to.y },
    { x: from.x, y: to.y },
  ].map(fr);
  box.project = M.addOutline(box.project, { schemeId: box.schemeId, roomId: made.room.id, points }).project;
  return made.room.id;
}

function lampAt(box, x, y) {
  const type = box.project.markTypes.find((item) => item.code === "С");
  const made = M.addMark(box.project, {
    schemeId: box.schemeId,
    typeId: type.id,
    kind: "point",
    points: [M.planMmToFraction(box.project, box.schemeId, { x, y })],
  });
  box.project = M.applyMarkWalls(made.project, box.schemeId).project;
  box.lamps.push(made.mark ? made.mark.id : made.marks[0].id);
}

const BENCH_THINGS = {
  sofa: [2200, 900, 850],
  coffeeTable: [1000, 600, 450],
  armchair: [850, 850, 950],
  bed: [1600, 2000, 500],
  dresser: [1200, 500, 900],
  cabinet: [1000, 600, 2000],
};

function thingAt(box, catalogKey, x, y, turnDeg = 0) {
  const [widthMm, depthMm, heightMm] = BENCH_THINGS[catalogKey];
  box.project = M.addSchemeObject(box.project, {
    schemeId: box.schemeId,
    catalogKey,
    shape: "rect",
    atMm: { x, y },
    widthMm,
    depthMm,
    heightMm,
    turnDeg,
  }).project;
}

/** Квартира с мебелью: `{project, schemeId, lamps, doors}`. */
export function benchFlat() {
  const box = sceneBase(1200, 800, 12);
  const outer = [
    { x: -4500, y: -1800 },
    { x: 4500, y: -1800 },
    { x: 4500, y: 1800 },
    { x: -4500, y: 1800 },
  ];
  const walls = outer.map((p, at) => wallOf(box, p, outer[(at + 1) % 4]));
  const left = wallOf(box, { x: -1000, y: -1800 }, { x: -1000, y: 1800 });
  const right = wallOf(box, { x: 1000, y: -1800 }, { x: 1000, y: 1800 });
  roomOf(box, "Гостиная", { x: -4400, y: -1700 }, { x: -1100, y: 1700 });
  roomOf(box, "Коридор", { x: -900, y: -1700 }, { x: 900, y: 1700 });
  roomOf(box, "Спальня", { x: 1100, y: -1700 }, { x: 4400, y: 1700 });
  for (const [wallId, atMm] of [
    [left, 1500],
    [right, 2200],
  ]) {
    const made = M.addOpening(box.project, { wallId, kind: "door", atMm, widthMm: 900, heightMm: 2100, heightAboveFloorMm: 0, hinge: "start", swing: "left" });
    box.project = made.project;
    box.doors.push(made.opening.id);
  }
  box.project = M.addOpening(box.project, { wallId: walls[2], kind: "window", atMm: 6800, widthMm: 1400, heightMm: 1500, heightAboveFloorMm: 800 }).project;
  for (const [x, y] of [
    [-3600, -800],
    [-2000, -800],
    [-2800, 800],
    [0, 0],
    [2800, 0],
  ]) {
    lampAt(box, x, y);
  }
  thingAt(box, "sofa", -2750, -1150);
  thingAt(box, "coffeeTable", -2750, -100);
  thingAt(box, "armchair", -1700, 900, 90);
  thingAt(box, "cabinet", -4000, 900, 90);
  thingAt(box, "bed", 2900, 300);
  thingAt(box, "dresser", 1500, -1350);
  return box;
}

/** Зал 14 × 10 м: 48 вещей и 20 ламп — `{project, schemeId, lamps, doors}`. */
export function benchHall() {
  const box = sceneBase(1400, 1000, 16);
  const outer = [
    { x: -7000, y: -5000 },
    { x: 7000, y: -5000 },
    { x: 7000, y: 5000 },
    { x: -7000, y: 5000 },
  ];
  outer.forEach((p, at) => wallOf(box, p, outer[(at + 1) % 4]));
  roomOf(box, "Зал", { x: -6900, y: -4900 }, { x: 6900, y: 4900 });
  const kinds = ["sofa", "coffeeTable", "armchair", "cabinet"];
  for (let i = 0; i < 48; i += 1) thingAt(box, kinds[i % 4], -6000 + (i % 8) * 1700, -4000 + Math.floor(i / 8) * 1500, (i * 37) % 180);
  for (let i = 0; i < 20; i += 1) lampAt(box, -6000 + (i % 5) * 3000, -3600 + Math.floor(i / 5) * 2400);
  return box;
}

/** Все сцены стенда по имени. */
export const BENCH_SCENES = Object.freeze({ flat: benchFlat, hall: benchHall });

/** Живое состояние: все лампы сцены горят полностью — как `simLive` у запущенного дома. */
export function benchLive(box) {
  return new Map(box.lamps.map((id) => [id, { on: true, level: 1, kind: "light", roomId: null }]));
}

/**
 * Камеры обхода: `count` точек сеткой по габариту сцены на высоте глаз,
 * поворот и наклон меняются от точки к точке — кадры разные, как у идущего.
 */
export function benchCameras(box, count = 24) {
  const spanX = box === null ? 6000 : Math.max(...box.project.walls.map((w) => Math.max(Math.abs(w.aMm.x), Math.abs(w.bMm.x)))) - 600;
  const spanY = box === null ? 1500 : Math.max(...box.project.walls.map((w) => Math.max(Math.abs(w.aMm.y), Math.abs(w.bMm.y)))) - 600;
  const cols = 6;
  const rows = Math.ceil(count / cols);
  const cams = [];
  for (let i = 0; i < count; i += 1) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    cams.push({
      at: { x: -spanX + (2 * spanX * col) / (cols - 1), y: -spanY + (2 * spanY * row) / Math.max(1, rows - 1), z: 1600 },
      yaw: i * 0.7,
      pitch: -0.2,
    });
  }
  return cams;
}
