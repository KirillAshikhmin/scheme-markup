// Евро-розетка с заземлением в «Объёме» (таск 15 сценариев, требование G18).
//
// Слова заказчика (2026-10-23): «а почему розетки выглядт не как розетки, а как
// выключатели? поправь им модель, должна быть классическая евро-розетка с
// заземлением». На его снимке розетки — пустые квадратные рамки: сердцевина
// была **стоячим** цилиндром, а стоячий цилиндр, если смотреть в лицо, —
// прямоугольник. Квадрат в рамке — это и есть одноклавишный выключатель.
//
// Проверяется то, что видит глаз, а не то, как записано описание: кадр лица
// снимается с **граней**, которые объём и правда рисует (`volumeMarkFaces`), —
// в каждой точке лица побеждает ближняя к комнате грань, и по её цвету
// узнаётся материал. Так тест не повторяет толкование видов тела (стоячий,
// лежачий, коробка) — ровно в этом толковании и пряталась ошибка.
//
// Что значит «евро-розетка» в числах:
//
//   1. **Рамка** — по краям лица везде цвет категории.
//   2. **Круглое углубление** — светлое пятно в середине, у которого граница
//      на диагоналях там же, где на осях. У квадрата она дальше в √2 раза.
//   3. **Два отверстия под штыри** — на средней линии внутри круга ровно два
//      тёмных пятна, симметрично от середины, и между ними — не тёмное.
//   4. **Заземляющие контакты сверху и снизу** — на вертикальной оси светлое
//      выходит за круг узким язычком, а сбоку от оси на той же высоте — рамка.
import test from "node:test";
import assert from "node:assert/strict";

import {
  addMark,
  addOutline,
  addRoom,
  addScheme,
  addToGroup,
  addType,
  addWall,
  createProject,
  planMmToFraction,
  setMarkWall,
  setPlanOrigin,
  setPlanScale,
  setSchemeWallHeight,
  setTypeSizes,
} from "../src/model.js";
import { MODEL_MATERIALS } from "../src/objectModels/kit.js";
import {
  OBJECT_MODEL_BODY_MAX,
  OBJECT_MODEL_FACE_MAX,
  objectModelByKey,
  objectModelFaceCount,
} from "../src/objectModels/registry.js";
import { volumeMarkFaces, volumeMarkPlacement, volumeMarkView, volumeModelRgb, volumeScene } from "../src/volume.js";

/** Изображения розеток: у типа с таким изображением модель — евро-розетка. */
const SOCKET_VIEWS = ["socket", "socket380"];

// ——— стенд: комната 4 × 3 м и розетка на северной стене ————————————————————

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

/** Метка типа `typeId` на северной стене, `atMm` от её начала. */
function putOnWall(scene, project, typeId, atMm) {
  const added = addMark(project, {
    schemeId: scene.schemeId,
    typeId,
    kind: "point",
    points: [planMmToFraction(project, scene.schemeId, { x: atMm - 2000, y: -1300 })],
  });
  const bound = setMarkWall(added.project, added.mark.id, { wallId: scene.walls[0], atMm }).project;
  return { project: bound, mark: bound.marks.find((item) => item.id === added.mark.id) };
}

const typeByCode = (project, code) => project.markTypes.find((type) => type.code === code);

function placeOf(project, mark) {
  const place = volumeMarkPlacement(project, mark, []);
  assert.equal(place.mode, "wall", "стенд обязан поставить метку на стену, иначе он проверяет другое");
  assert.ok(place.model && place.frame, "у метки нет модели — проверять нечего");
  return place;
}

// ——— кадр лица ——————————————————————————————————————————————————————————

/**
 * Что видно в точке лица: материал ближней к комнате грани, `null` — стена.
 * `s` — поперёк лица (−0.5…0.5, плюс вправо), `t` — вверх от низа (0…1).
 */
function frontView(place) {
  const { frame } = place;
  const local = (point) => {
    const dx = point.x - frame.at.x;
    const dy = point.y - frame.at.y;
    return {
      s: (dx * frame.u.x + dy * frame.u.y) / frame.widthMm,
      t: (point.z - frame.bottomMm) / frame.heightMm,
      d: dx * frame.f.x + dy * frame.f.y,
    };
  };
  const materials = MODEL_MATERIALS.map((name) => ({ name, rgb: volumeModelRgb(name, place.bodyRgb) }));
  const fronts = [];
  for (const face of volumeMarkFaces(place)) {
    // В лицо смотрят только грани, повёрнутые в комнату; бока стоят ребром.
    if (face.n.x * frame.f.x + face.n.y * frame.f.y > -0.99) continue;
    const points = face.p.map(local);
    const material = materials.find((item) => item.rgb.join() === face.rgb.join());
    fronts.push({ points, d: points[0].d, material: material ? material.name : "?" });
  }
  const inside = (points, s, t) => {
    let hit = false;
    for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
      const a = points[i];
      const b = points[j];
      if (a.t > t !== b.t > t && s < ((b.s - a.s) * (t - a.t)) / (b.t - a.t) + a.s) hit = !hit;
    }
    return hit;
  };
  return (s, t) => {
    let best = null;
    for (const face of fronts) {
      if (!inside(face.points, s, t)) continue;
      if (best === null || face.d < best.d) best = face;
    }
    return best ? best.material : null;
  };
}

/** Граница круга по направлению `angle` от середины лица: где начинается рамка. */
function edgeAlong(at, angle) {
  for (let r = 0.01; r < 0.6; r += 0.002) {
    if (at(Math.cos(angle) * r, 0.5 + Math.sin(angle) * r) === "body") return r;
  }
  return Infinity;
}

/** Отрезки подряд одного материала вдоль линии. */
function runsOf(at, from, to, point, wanted) {
  const runs = [];
  let open = null;
  const step = 0.002;
  for (let x = from; x <= to; x += step) {
    const hit = at(...point(x)) === wanted;
    if (hit && open === null) open = x;
    if (!hit && open !== null) {
      runs.push({ from: open, to: x - step });
      open = null;
    }
  }
  if (open !== null) runs.push({ from: open, to });
  return runs;
}

/**
 * Евро-розетка в кадре лица. Возвращает найденные размеры — ими тест сверяет
 * две розетки между собой, а сообщения называют, чего не хватило.
 */
function assertEuroSocket(place, label) {
  const at = frontView(place);
  // 1. Рамка: края лица — цвет категории.
  for (const [s, t] of [
    [-0.47, 0.03],
    [0.47, 0.03],
    [-0.47, 0.97],
    [0.47, 0.97],
    [-0.47, 0.5],
    [0.47, 0.5],
  ]) {
    assert.equal(at(s, t), "body", label + ": у края лица в (" + s + ", " + t + ") нет рамки");
  }
  // 2. Круглое углубление. Оси 90° и 270° пропущены нарочно: там контакты.
  const angles = [0, 45, 135, 180, 225, 315].map((degrees) => (degrees * Math.PI) / 180);
  const edges = angles.map((angle) => edgeAlong(at, angle));
  const radius = Math.min(...edges);
  assert.ok(radius > 0.2 && Math.max(...edges) < 0.47, label + ": углубления не видно — границы " + edges.join(", "));
  assert.ok(
    Math.max(...edges) / radius < 1.12,
    label + ": углубление не круглое — граница на диагонали дальше, чем на оси: " + edges.map((r) => r.toFixed(3)).join(", "),
  );
  // Цвет углубления — на диагоналях: на средней линии лежат гнёзда.
  const diagonals = [45, 135, 225, 315].map((degrees) => (degrees * Math.PI) / 180);
  const recess = at(Math.cos(diagonals[0]) * radius * 0.6, 0.5 + Math.sin(diagonals[0]) * radius * 0.6);
  for (const angle of diagonals) {
    assert.equal(at(Math.cos(angle) * radius * 0.6, 0.5 + Math.sin(angle) * radius * 0.6), recess, label + ": углубление пятнистое");
  }
  assert.ok(recess && recess !== "body" && recess !== "dark", label + ": углубление цвета " + recess + " — его не отличить");
  // 3. Два отверстия под штыри — на средней линии внутри круга.
  const holes = runsOf(at, -radius, radius, (s) => [s, 0.5], "dark");
  assert.equal(holes.length, 2, label + ": отверстий на средней линии " + holes.length + ", а не два");
  const centres = holes.map((run) => (run.from + run.to) / 2);
  assert.ok(centres[0] < 0 && centres[1] > 0, label + ": отверстия не по обе стороны от середины");
  assert.ok(Math.abs(centres[0] + centres[1]) < 0.01, label + ": отверстия стоят не симметрично");
  assert.equal(at(0, 0.5), recess, label + ": между отверстиями не углубление — это щель, а не два гнезда");
  for (const centre of centres) {
    // Отверстие — дырка в углублении, а не полоса через всё лицо.
    assert.equal(at(centre, 0.5 + radius * 0.5), recess, label + ": над отверстием не углубление");
    assert.equal(at(centre, 0.5 - radius * 0.5), recess, label + ": под отверстием не углубление");
  }
  // 4. Заземляющие контакты сверху и снизу: на вертикальной оси светлое
  // выходит за круг, а сбоку на той же высоте — рамка.
  const reach = (direction) => edgeAlong(at, direction);
  const up = reach(Math.PI / 2);
  const down = reach(-Math.PI / 2);
  for (const [name, span, sign] of [
    ["сверху", up, 1],
    ["снизу", down, -1],
  ]) {
    assert.ok(span > radius * 1.08, label + ": контакта " + name + " нет — за круг ничего не выходит (" + span.toFixed(3) + " при круге " + radius.toFixed(3) + ")");
    const t = 0.5 + sign * (radius * 1.04 + (span - radius * 1.04) / 2);
    const contact = at(0, t);
    assert.ok(contact && contact !== "body" && contact !== "dark", label + ": контакт " + name + " цвета " + contact);
    const width = runsOf(at, -radius, radius, (s) => [s, t], contact);
    assert.equal(width.length, 1, label + ": контакт " + name + " не одним язычком");
    const wide = width[0].to - width[0].from;
    assert.ok(wide > 0.03 && wide < radius * 0.8, label + ": контакт " + name + " шириной " + wide.toFixed(3) + " — это не язычок");
    assert.ok(Math.abs(width[0].from + width[0].to) < 0.01, label + ": контакт " + name + " не на оси");
  }
  assert.ok(Math.abs(up - down) < 0.01, label + ": контакты сверху и снизу разной длины");
  return { radius, holes: centres, reach: up };
}

// ——— тесты ———————————————————————————————————————————————————————————————

test("розетка в объёме — евро-розетка с заземлением: рамка, круг, два гнезда, контакты сверху и снизу", () => {
  const scene = roomScene();
  const typeId = typeByCode(scene.project, "Р").id;
  const put = putOnWall(scene, scene.project, typeId, 2000);
  const place = placeOf(put.project, put.mark);
  assert.equal(place.model.key, "socket");
  assertEuroSocket(place, "Р");
});

test("все типы с изображением розетки получают евро-розетку, и каждая держит предел тел и граней", () => {
  const scene = roomScene();
  // Изображение розетки — у «Р» и «РC» стартового справочника и у любого типа,
  // заведённого руками со знаком розетки или с её изображением.
  let project = scene.project;
  const category = project.categories.find((item) => item.name === "Розетки").id;
  for (const made of [
    { code: "РУ", name: "Розетка у плиты", categoryId: category, shape: "circle-socket" },
    { code: "РТ", name: "Розетка в тумбе", categoryId: category, shape: "square", view: "socket380" },
  ]) {
    const added = addType(project, made);
    // Высота над полом — чтобы метка встала на стену; размеров лица у типа,
    // заведённого руками, нет, и габарит берётся у изображения (G226).
    project = setTypeSizes(added.project, added.type.id, { heightAboveFloor: 300 }).project;
  }
  const sockets = project.markTypes.filter((type) => {
    const view = type.kind === "line" ? null : volumeMarkView(project, { typeId: type.id });
    return view && SOCKET_VIEWS.includes(view.name);
  });
  assert.deepEqual(sockets.map((type) => type.code).sort(), ["Р", "РC", "РТ", "РУ"].sort(), "типы с изображением розетки");
  const seen = new Map();
  for (const type of sockets) {
    const put = putOnWall(scene, project, type.id, 2000);
    const place = placeOf(put.project, put.mark);
    const found = assertEuroSocket(place, type.code);
    const model = objectModelByKey(place.model.key);
    assert.ok(model.parts.length <= OBJECT_MODEL_BODY_MAX, type.code + ": тел " + model.parts.length);
    assert.ok(objectModelFaceCount(model) <= OBJECT_MODEL_FACE_MAX, type.code + ": граней " + objectModelFaceCount(model));
    assert.ok(volumeMarkFaces(place).length <= OBJECT_MODEL_FACE_MAX, type.code + ": в кадре граней больше предела");
    seen.set(place.model.key, found);
  }
  // Силовая остаётся силовой: та же евро-розетка, но круг крупнее — иначе две
  // розетки на одной стене было бы не различить, а до правки различались.
  assert.deepEqual([...seen.keys()].sort(), ["socket", "socket380"]);
  assert.ok(seen.get("socket380").radius > seen.get("socket").radius * 1.1, "у силовой розетки круг не крупнее бытовой");
});

test("блок из трёх розеток — три евро-розетки рядом, каждая своя", () => {
  const scene = roomScene();
  const typeId = typeByCode(scene.project, "Р").id;
  const put = putOnWall(scene, scene.project, typeId, 1900);
  let project = put.project;
  const ids = [put.mark.id];
  for (const atMm of [1990, 2080]) {
    const grown = addToGroup(project, ids[ids.length - 1], "right", { typeId });
    project = setMarkWall(grown.project, grown.mark.id, { wallId: scene.walls[0], atMm }).project;
    ids.push(grown.mark.id);
  }
  const groups = new Set(ids.map((id) => project.marks.find((mark) => mark.id === id).groupId));
  assert.equal(groups.size, 1, "стенд обязан собрать один блок");
  const built = volumeScene(project, scene.schemeId, {});
  const centres = [];
  for (const id of ids) {
    const place = built.marks.find((item) => item.markId === id);
    assert.ok(place && place.model, "у розетки блока нет модели");
    assertEuroSocket(place, "розетка блока");
    centres.push(place.frame.at.x * place.frame.u.x + place.frame.at.y * place.frame.u.y);
  }
  // Три отдельных тела вдоль стены, а не одно растянутое.
  centres.sort((a, b) => a - b);
  assert.ok(centres[1] - centres[0] > 80 && centres[2] - centres[1] > 80, "розетки блока налезли друг на друга");
});

test("розетка больше не похожа на выключатель: у выключателя ни круга, ни гнёзд", () => {
  const scene = roomScene();
  const typeId = typeByCode(scene.project, "В").id;
  const put = putOnWall(scene, scene.project, typeId, 2000);
  const place = placeOf(put.project, put.mark);
  assert.equal(place.model.key, "switch1");
  const at = frontView(place);
  // Тот же кадр лица, что у розетки, видит у выключателя клавишу во всё лицо и
  // ни одного тёмного гнезда — по этой разнице их и различает глаз.
  assert.deepEqual(runsOf(at, -0.45, 0.45, (s) => [s, 0.5], "dark"), [], "у выключателя нашлись гнёзда");
  assert.equal(at(0.4, 0.9), at(0, 0.5), "у выключателя клавиша не во всё лицо");
});
