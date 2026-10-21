// Новые виды проёма на всех трёх поверхностях (таск 215, G321 и G325).
//
// Вид проёма — не запись в справочнике, а **рисунок в трёх местах сразу**:
// план, развёртка, объём. Поэтому проверяется не «вид есть», а «вид нарисован
// и нарисован по-разному»: ворота, которые на плане выглядят дверью, человек
// примет за дверь.
//
// Что проверяется здесь:
//
//   1. **Все виды рисуются** — на плане, на лице (развёртка и плитка выбора) и
//      в объёме, и ни один не выглядит как другой.
//   2. **Секции доходят до всех трёх**: тройное окно делится на листе тремя
//      полями и в объёме тремя полями, а не на листе тремя, а в объёме двумя.
//   3. **G68 буквально.** Прежние пять видов рисуются вызов в вызов как до
//      таска — и на плане с развёрткой (отпечаток таска 180), и в объёме
//      (отпечаток, снятый на коде до таска 215). Объект прежней сборки
//      открывается, называется и считается как прежде, и ни одного нового ключа
//      в нём не появляется.
//   4. **Стеклянная дверь прежней разметки = распашная с отметкой**: два
//      написания одного и того же обязаны давать один кадр, иначе чертёж
//      заказчика поехал бы от первой же правки.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  OPENING_KINDS,
  OPENING_KIND_GLASS_DOOR,
  addOpening,
  addScheme,
  addWall,
  createProject,
  findScheme,
  openingCanGlaze,
  openingFamilyOf,
  openingMotionOf,
  openingsInWall,
  setPlanOrigin,
  setPlanScale,
  wallElevation,
  wallsOnScheme,
} from "../src/model.js";
import { openingCatalogDefaults } from "../src/openingCatalog.js";
import { drawDrawingOpening, drawElevation, drawOpeningFace, drawingBridge, drawingDoorLeaves } from "../src/render.js";
import { volumeDoorOpen, volumeOpeningWalkable, volumeScene } from "../src/volume.js";

const VOLUME_BEFORE = JSON.parse(readFileSync(new URL("./fixtures/openings-volume-before.json", import.meta.url), "utf8"));
const LEGACY_TEXT = readFileSync(new URL("./legacy-openings-project.json", import.meta.url), "utf8");

const round = (value) => (typeof value === "number" ? Math.round(value * 100) / 100 : value);
const PROPS = [
  "fillStyle",
  "strokeStyle",
  "lineWidth",
  "font",
  "textAlign",
  "textBaseline",
  "globalAlpha",
  "lineCap",
  "lineJoin",
  "miterLimit",
];

function scribe(log) {
  const state = {};
  return new Proxy(
    {},
    {
      get(_target, key) {
        if (key === "canvas") return { width: 800, height: 600 };
        if (key === "measureText") return (value) => ({ width: String(value).length * 6 });
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

/** Комната 7 × 4 из четырёх стен; проёмы ставятся в первую (по y = 0). */
function room(specs) {
  const added = addScheme(createProject(), { name: "1", imageId: "p", width: 1200, height: 800 });
  let project = setPlanScale(added.project, added.scheme.id, {
    a: { x: 0.1, y: 0.5 },
    b: { x: 0.6, y: 0.5 },
    meters: 6,
  }).project;
  project = setPlanOrigin(project, added.scheme.id, { at: { x: 0.2, y: 0.8 }, turn: 0 }).project;
  const corners = [
    { x: 0, y: 0 },
    { x: 7000, y: 0 },
    { x: 7000, y: 4000 },
    { x: 0, y: 4000 },
  ];
  const walls = [];
  for (let index = 0; index < corners.length; index += 1) {
    const put = addWall(project, {
      schemeId: added.scheme.id,
      aMm: corners[index],
      bMm: corners[(index + 1) % corners.length],
      thicknessMm: 200,
    });
    project = put.project;
    walls.push(put.wall.id);
  }
  const ids = [];
  for (const spec of specs) {
    const put = addOpening(project, { wallId: walls[0], ...spec });
    project = put.project;
    ids.push(put.opening.id);
  }
  const scheme = findScheme(project, added.scheme.id);
  const view = { zoom: 1, offsetX: 0, offsetY: 0, markSize: 10, labelSize: 12 };
  return {
    project,
    schemeId: added.scheme.id,
    walls,
    ids,
    wall: wallsOnScheme(project, added.scheme.id)[0],
    bridge: drawingBridge(project, scheme, view),
  };
}

/** Один проём этого вида в стене, с умолчаниями каталога. */
function one(kind, extra = {}) {
  const sizes = openingCatalogDefaults(kind);
  return room([{ kind, atMm: 1000, ...sizes, ...extra }]);
}

function planLog(scene, opening, options = {}) {
  const log = [];
  drawDrawingOpening(scribe(log), scene.bridge, scene.wall, opening, options);
  return log;
}

function elevationLog(scene) {
  const log = [];
  drawElevation(scribe(log), wallElevation(scene.project, scene.wall.id, "right"), {
    x: 0,
    y: 0,
    width: 900,
    height: 420,
  });
  return log;
}

const leafOf = (built, doorId) => built.faces.filter((face) => face.doorId === doorId);

// ——— все виды рисуются, и ни один не похож на другой ——————————————————————

test("каждый вид каталога рисуется на плане, и рисунки у видов разные", () => {
  const prints = new Map();
  for (const kind of OPENING_KINDS) {
    const scene = one(kind);
    const log = planLog(scene, scene.project.openings[0]);
    assert.ok(log.length > 0, kind + " не рисуется вовсе");
    // Призрак отличается от вставшего только силой краски (правило таска 203).
    const ghost = planLog(scene, scene.project.openings[0], { ghost: true });
    assert.ok(ghost.includes("globalAlpha=0.65"), kind + ": призрак не бледнее");
    prints.set(kind, log.join("|"));
  }
  // Виды, которые на плане совпадают, названы **вслух**, и список закрыт.
  // Сегодня в нём одна пара: роллетные и подъёмно-секционные ворота. Полотно у
  // обоих стоит в плоскости проёма — оно уходит вверх, и плану про это сказать
  // нечем: сверху вид у них один и тот же. Различают их развёртка (ламели
  // против четырёх панелей) и плитка выбора, нарисованная тем же лицом.
  const ALLOWED = [["gateRoller", "gateSectional"]];
  const same = [];
  const seen = new Map();
  for (const [kind, print] of prints) {
    if (seen.has(print)) same.push([seen.get(print), kind]);
    else seen.set(print, kind);
  }
  assert.deepEqual(same, ALLOWED, "на плане совпали виды: " + JSON.stringify(same));
});

test("сдвижное полотно лежит вдоль стены, а распашное уходит от петли поперёк", () => {
  const swing = one("door");
  const slide = one("doorSliding");
  const [swingLeaf] = drawingDoorLeaves(swing.wall, swing.project.openings[0]);
  const [slideLeaf] = drawingDoorLeaves(slide.wall, slide.project.openings[0]);
  // Распашная створка уходит от стены: кончик не на оси стены.
  assert.notEqual(round(swingLeaf.tip.y), 0);
  assert.equal(swingLeaf.motion, "swing");
  assert.equal(swingLeaf.pivot, true, "у распашной есть ручка петли");
  // Сдвижное полотно лежит вдоль стены: оба конца на её оси.
  assert.equal(slideLeaf.motion, "slide");
  assert.equal(round(slideLeaf.hinge.y), 0);
  assert.equal(round(slideLeaf.closed.y), 0);
  assert.equal(slideLeaf.inWall, false, "накладное полотно идёт по стороне стены");
  assert.equal(drawingDoorLeaves(slide.wall, { ...slide.project.openings[0], kind: "doorPocket" })[0].inWall, true);
  // Двустворчатая — две створки по половине проёма, от своих косяков, и ручки
  // петли у них нет: петли стоят у обоих косяков.
  const twin = one("doorDouble");
  const leaves = drawingDoorLeaves(twin.wall, twin.project.openings[0]);
  assert.equal(leaves.length, 2);
  assert.equal(leaves[0].radius, twin.project.openings[0].widthMm / 2);
  assert.equal(leaves[0].pivot, false);
  assert.notEqual(round(leaves[0].hinge.x), round(leaves[1].hinge.x));
  // У вида без полотна створок нет вовсе.
  for (const kind of ["window", "arch", "opening", "gateRoller"]) {
    const scene = one(kind);
    assert.deepEqual(drawingDoorLeaves(scene.wall, scene.project.openings[0]), [], kind);
  }
});

test("импосты окна доходят до плана короткими засечками, а у одинарного их нет", () => {
  const single = one("window");
  const triple = one("windowTriple");
  const lines = (log) => log.filter((call) => call.startsWith("lineTo(")).length;
  // У одинарного окна рисунок прежний — нитка стекла и два косяка.
  assert.equal(lines(planLog(triple, triple.project.openings[0])) - lines(planLog(single, single.project.openings[0])), 2);
  // На мелком масштабе засечки не ставятся: полоса их слилась бы в серое поле и
  // соврала бы про толщину линии.
  const far = room([{ kind: "windowTriple", atMm: 1000, ...openingCatalogDefaults("windowTriple") }]);
  const scheme = findScheme(far.project, far.schemeId);
  const tiny = drawingBridge(far.project, scheme, { zoom: 0.002, offsetX: 0, offsetY: 0, markSize: 10, labelSize: 12 });
  const small = [];
  drawDrawingOpening(scribe(small), tiny, far.wall, far.project.openings[0], {});
  assert.equal(lines(small), lines(planLog(single, single.project.openings[0])), "мелкие засечки сняты");
});

// ——— лицо: развёртка и плитка выбора ————————————————————————————————————

test("лицо проёма делится секциями, и это одно и то же на листе и в плитке", () => {
  const strokes = (face, box) => {
    const log = [];
    drawOpeningFace(scribe(log), box, face, { unit: 1, scale: box.height / 2100 });
    return log.filter((call) => call.startsWith("lineTo(") || call.startsWith("strokeRect(")).length;
  };
  const sheet = { x: 0, y: 0, width: 300, height: 210 };
  const tile = { x: 0, y: 0, width: 30, height: 21 };
  for (const kind of OPENING_KINDS) {
    const scene = one(kind);
    const face = wallElevation(scene.project, scene.wall.id, "right").openings[0];
    // Плитка — то же лицо в клетке, и число линий у них совпадает, пока
    // секции в клетку влезают: это и есть «человек видит на листе то, что
    // выбрал картинкой».
    if (kind !== "gateRoller") {
      assert.equal(strokes(face, sheet), strokes(face, tile), kind + ": лист и плитка разошлись");
    }
    assert.ok(strokes(face, sheet) > 0, kind + ": лицо пустое");
  }
  // Роллета — тот случай, когда в клетку сорока точек её две дюжины ламелей не
  // влезают: на листе они есть, в плитке их снимает порог частоты. Это
  // нарочно, и названо здесь, чтобы не починили молча.
  const roller = one("gateRoller");
  const rollerFace = wallElevation(roller.project, roller.wall.id, "right").openings[0];
  assert.ok(strokes(rollerFace, sheet) > strokes(rollerFace, tile), "ламели в клетке прореживаются");
});

test("на развёртке у балконного окна три секции и полоса пояса, у секционных — четыре панели", () => {
  const horizontals = (scene) => {
    const face = wallElevation(scene.project, scene.wall.id, "right").openings[0];
    return face.grid.ys.length;
  };
  const verticals = (scene) => {
    const face = wallElevation(scene.project, scene.wall.id, "right").openings[0];
    return face.grid.xs.length;
  };
  const balcony = one("windowBalcony");
  assert.equal(verticals(balcony), 2, "три секции по ширине");
  assert.equal(horizontals(balcony), 1, "две полосы: до пояса и выше");
  assert.equal(horizontals(one("gateSectional")), 3, "четыре панели");
  assert.ok(horizontals(one("gateRoller")) > 10, "роллета — полоса ламелей");
  assert.equal(verticals(one("windowGlazing")), 0, "витраж — одна секция без деления");
  // Лицо едет на лист из модели (`wallElevation`), а не считается на листе:
  // второго счёта секций в сборке нет.
  const face = wallElevation(balcony.project, balcony.wall.id, "right").openings[0];
  assert.equal(face.glazed, false);
  assert.equal(face.motion, null);
  assert.deepEqual(Object.keys(face.grid).sort(), ["xs", "ys"]);
});

test("на развёртке у двустворчатой двери две засечки петель, у сдвижной — стрелка", () => {
  // Засечка петель — единственный пунктир на лице проёма; `unit` листа зависит
  // от его размера, поэтому считаются не числа, а сами включения пунктира.
  const dashes = (scene) =>
    elevationLog(scene).filter((call) => call.startsWith("setLineDash(") && call !== "setLineDash()").length;
  assert.equal(dashes(one("door")), 1, "одна створка — одна засечка");
  assert.equal(dashes(one("doorDouble")), 2, "две створки — две засечки");
  // У сдвижной засечки петель нет (петель нет), зато есть стрелка хода.
  const slide = elevationLog(one("doorSliding"));
  assert.equal(dashes(one("doorSliding")), 0);
  assert.ok(slide.filter((call) => call.startsWith("moveTo(")).length >= 3, "стрелка хода на листе");
  // У поднимающихся ворот стрелка тоже есть — вверх.
  assert.ok(elevationLog(one("gateRoller")).filter((call) => call.startsWith("moveTo(")).length >= 3);
});

// ——— объём ————————————————————————————————————————————————————————————————

test("импосты окна стоят и в объёме: тройное — три поля, балконное — шесть", () => {
  const bars = (kind) => {
    const scene = one(kind);
    return volumeScene(scene.project, scene.schemeId).faces.filter(
      (face) => face.both && !face.doorId && face.rgb && face.rgb[0] === 240,
    ).length;
  };
  // Рама — четыре бруска; каждая стойка и каждая перекладина добавляют свои.
  assert.equal(bars("window"), 4, "одинарное — та же рама, что была");
  assert.equal(bars("windowDouble"), 5, "стойка посередине");
  assert.equal(bars("windowTriple"), 6, "две стойки");
  // Балконное: четыре бруска рамы, две стойки и пояс отрезками между ними.
  assert.equal(bars("windowBalcony"), 9);
  assert.equal(bars("windowGlazing"), 4, "витраж — одна секция");
});

test("полотно поднимающихся ворот стоит в проёме панелями и не открывается", () => {
  const panels = (kind) => {
    const scene = one(kind);
    const built = volumeScene(scene.project, scene.schemeId);
    return { built, scene, faces: built.faces.filter((face) => face.both && face.rgb[0] === 176) };
  };
  const sectional = panels("gateSectional");
  assert.equal(sectional.faces.length, 4, "четыре панели");
  const roller = panels("gateRoller");
  assert.ok(roller.faces.length > 10, "ламели: " + roller.faces.length);
  // Открытого положения у них нет: в список дверей сцены они не попадают, и
  // `R` их не откроет. Решение названо вслух — полотно уходит вверх, а не в
  // сторону.
  assert.deepEqual(sectional.built.doors, [], "секционные ворота не числятся дверью");
  assert.deepEqual(roller.built.doors, []);
  assert.equal(volumeDoorOpen(new Set(roller.scene.ids), null), false);
  // Панели лежат в одной плоскости и друг на друга не налезают.
  const ys = sectional.faces.flatMap((face) => face.p.map((point) => point.y));
  assert.ok(Math.max(...ys) - Math.min(...ys) < 1, "полотно плоское");
});

test("двустворчатая дверь — две створки с ручками, и обе уходят на сторону открывания", () => {
  const scene = one("doorDouble", { hinge: "start", swing: "left" });
  const built = volumeScene(scene.project, scene.schemeId);
  const leaf = leafOf(built, scene.ids[0]);
  const panels = leaf.filter((face) => face.both && face.rgb[0] === 176);
  assert.equal(panels.length, 2, "две створки");
  const handles = leaf.filter((face) => face.rgb[0] === 186);
  assert.ok(handles.length >= 10, "по ручке на створку: " + handles.length);
  assert.ok(built.doors.includes(scene.ids[0]), "двустворчатая открывается");
  const away = (faces) => Math.max(...faces.flatMap((face) => face.p.map((point) => Math.abs(point.y))));
  assert.ok(away(panels) < 1, "закрытые стоят в проёме");
  const open = volumeScene(scene.project, scene.schemeId, { openDoorIds: new Set(scene.ids) });
  const spread = leafOf(open, scene.ids[0]).filter((face) => face.both && face.rgb[0] === 176);
  assert.ok(away(spread) > 600, "раскрытые уходят от стены: " + away(spread));
});

test("сдвижное полотно съезжает за косяк, портальное прячется в стену", () => {
  const along = (faces) => faces.flatMap((face) => face.p.map((point) => point.x));
  for (const kind of ["doorSliding", "doorFolding"]) {
    const scene = one(kind, { hinge: "start", swing: "left" });
    const shut = volumeScene(scene.project, scene.schemeId);
    const open = volumeScene(scene.project, scene.schemeId, { openDoorIds: new Set(scene.ids) });
    const closed = leafOf(shut, scene.ids[0]).filter((face) => face.both);
    const moved = leafOf(open, scene.ids[0]).filter((face) => face.both);
    assert.equal(closed.length, 1, kind + ": закрытое полотно — одна грань");
    assert.ok(Math.min(...along(moved)) < Math.min(...along(closed)) - 100, kind + " не съехало");
    // Съехало **вдоль** стены, а не поперёк: это не распашная.
    const ys = moved.flatMap((face) => face.p.map((point) => point.y));
    assert.ok(Math.max(...ys.map(Math.abs)) < 1, kind + " ушло от стены, а должно было съехать вдоль");
  }
  // Портальная уезжает в стену, и открытой её не видно вовсе — это самый
  // честный вид «открыто», какой у неё бывает.
  const pocket = one("doorPocket", { hinge: "start", swing: "left" });
  assert.equal(leafOf(volumeScene(pocket.project, pocket.schemeId), pocket.ids[0]).length > 0, true);
  const open = volumeScene(pocket.project, pocket.schemeId, { openDoorIds: new Set(pocket.ids) });
  assert.deepEqual(leafOf(open, pocket.ids[0]), [], "раскрытая портальная не рисуется");
});

test("сквозь стекло в пол не ходят, а сквозь ворота ходят", () => {
  for (const kind of OPENING_KINDS) {
    const scene = one(kind);
    const opening = scene.project.openings[0];
    const expect = openingFamilyOf(kind) !== "window" && opening.heightAboveFloorMm === 0;
    assert.equal(volumeOpeningWalkable(opening), expect, kind);
  }
  // Витраж и балконное окно стоят от пола — и всё равно не дыра: раньше это
  // решало сравнение с `"window"`, и новый вид окна проехал бы мимо него.
  for (const kind of ["windowGlazing", "windowBalcony"]) {
    const scene = one(kind);
    assert.equal(volumeOpeningWalkable(scene.project.openings[0]), false, kind);
  }
});

// ——— G68 ——————————————————————————————————————————————————————————————————

test("G68: кадр прежних проёмов в объёме — грань в грань тот же, что до каталога", () => {
  const scene = room([
    { kind: "window", atMm: 200, widthMm: 1500, heightMm: 1400, heightAboveFloorMm: 800 },
    { kind: "door", atMm: 2000, widthMm: 900, heightMm: 2100, heightAboveFloorMm: 0, hinge: "start", swing: "left" },
    { kind: "glassDoor", atMm: 3000, widthMm: 800, heightMm: 2200, heightAboveFloorMm: 0, hinge: "end", swing: "right" },
    { kind: "opening", atMm: 4000, widthMm: 900, heightMm: 2100, heightAboveFloorMm: 0 },
    { kind: "arch", atMm: 5000, widthMm: 1200, heightMm: 2100, heightAboveFloorMm: 0 },
  ]);
  const built = volumeScene(scene.project, scene.schemeId);
  const print = built.faces.map((face) => ({
    rgb: face.rgb,
    clear: Boolean(face.clear),
    door: face.doorId ? scene.ids.indexOf(face.doorId) : null,
    p: face.p.map((point) => [round(point.x), round(point.y), round(point.z)]),
  }));
  assert.equal(built.doors.length, VOLUME_BEFORE.doors);
  assert.equal(print.length, VOLUME_BEFORE.faces, "число граней прежней сцены изменилось");
  assert.deepEqual(print, VOLUME_BEFORE.print, "кадр прежней сцены разошёлся с отпечатком");
});

test("G68: стеклянная дверь прежней разметки рисуется ровно как распашная с отметкой", () => {
  const legacy = one(OPENING_KIND_GLASS_DOOR, { hinge: "end", swing: "right" });
  const sizes = openingCatalogDefaults(OPENING_KIND_GLASS_DOOR);
  const fresh = one("door", { ...sizes, glazed: true, hinge: "end", swing: "right" });
  // План.
  assert.deepEqual(planLog(fresh, fresh.project.openings[0]), planLog(legacy, legacy.project.openings[0]));
  // Развёртка.
  assert.deepEqual(elevationLog(fresh), elevationLog(legacy));
  // Объём: те же грани, та же прозрачность, та же рама.
  const facesOf = (scene) =>
    leafOf(volumeScene(scene.project, scene.schemeId), scene.ids[0]).map((face) => ({
      rgb: face.rgb,
      clear: Boolean(face.clear),
      p: face.p.map((point) => [round(point.x), round(point.y), round(point.z)]),
    }));
  assert.deepEqual(facesOf(fresh), facesOf(legacy));
  // И отметка на другой породе двери работает тем же путём: сдвижная со
  // стеклом — это рама со стеклом, а не глухая полоса.
  const slide = one("doorSliding", { glazed: true });
  const plainSlide = one("doorSliding");
  assert.notDeepEqual(
    planLog(slide, slide.project.openings[0]),
    planLog(plainSlide, plainSlide.project.openings[0]),
    "отметка у сдвижной ничего не изменила",
  );
});

test("G68: объект прежней сборки открывается, называется и считается как прежде", () => {
  const project = JSON.parse(LEGACY_TEXT);
  // Ни одного нового ключа: файл, который не трогали, остаётся прежним.
  for (const opening of project.openings) {
    assert.equal(Object.prototype.hasOwnProperty.call(opening, "glazed"), false, opening.kind);
    assert.ok(OPENING_KINDS.includes(opening.kind), opening.kind);
  }
  assert.deepEqual(
    project.openings.map((opening) => opening.kind),
    ["window", "door", "glassDoor", "opening", "arch"],
  );
  // Рисуется он всеми тремя поверхностями и ни одного ключа себе не пишет:
  // отрисовка только читает.
  const before = JSON.stringify(project);
  const scheme = project.schemes[0];
  const bridge = drawingBridge(project, scheme, { zoom: 1, offsetX: 0, offsetY: 0, markSize: 10, labelSize: 12 });
  for (const wall of wallsOnScheme(project, scheme.id)) {
    for (const opening of openingsInWall(project, wall.id)) {
      const log = [];
      drawDrawingOpening(scribe(log), bridge, wall, opening, {});
      assert.ok(log.length > 0);
    }
    for (const side of ["left", "right"]) {
      const log = [];
      drawElevation(scribe(log), wallElevation(project, wall.id, side), { x: 0, y: 0, width: 900, height: 420 });
      assert.ok(log.length > 0);
    }
  }
  volumeScene(project, scheme.id);
  assert.equal(JSON.stringify(project), before, "отрисовка правит объект");
  // Номера и подписи меток не тронуты: каталог проёмов до них не достаёт.
  assert.deepEqual(
    project.marks.map((mark) => mark.number),
    [1, 2],
  );
  // Отметку «стеклянная» прежняя дверь читает, а глухая — нет.
  const kinds = project.openings.map((opening) => openingCanGlaze(opening.kind));
  assert.deepEqual(kinds, [false, true, true, false, false]);
  // Движение полотна у прежних видов то же, каким было: дверь на петлях,
  // остальные без полотна.
  assert.deepEqual(
    project.openings.map((opening) => openingMotionOf(opening.kind)),
    [null, "swing", "swing", null, null],
  );
});
