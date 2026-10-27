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
  openingHasLeaf,
  openingOpens,
  addOpening,
  addScheme,
  addWall,
  createProject,
  findScheme,
  openingCanGlaze,
  openingFaceGrid,
  openingFamilyOf,
  openingFoldLinks,
  openingMotionOf,
  openingsInWall,
  setPlanOrigin,
  setPlanScale,
  wallElevation,
  wallsOnScheme,
} from "../src/model.js";
import { openingArchGeometry } from "../src/model.js";
import { openingCatalogDefaults } from "../src/openingCatalog.js";
import { drawDrawingOpening, drawElevation, drawOpeningFace, drawingBridge, drawingDoorLeaves } from "../src/render.js";
import {
  VOLUME_ARCH_SEGMENTS,
  VOLUME_DOOR_LEAF_MM,
  VOLUME_FOLD_GAP_MM,
  VOLUME_FOLD_LEAF_MM,
  VOLUME_FRAME_RGB,
  VOLUME_SLIDE_GAP_MM,
  VOLUME_ROLL_MM,
  volumeDoorOpen,
  volumeInnerSide,
  volumeOpeningWalkable,
  volumeScene,
} from "../src/volume.js";

const VOLUME_BEFORE = JSON.parse(readFileSync(new URL("./fixtures/openings-volume-before.json", import.meta.url), "utf8"));
// Кадр **после** правки G329 (таск 219): у арки свод и пазухи. Разбор — у теста.
const VOLUME_AFTER = JSON.parse(readFileSync(new URL("./fixtures/openings-after-g329.json", import.meta.url), "utf8"));
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

/**
 * Полотна двери: с правки 2026-10-27 («полотно двери имеет толщину в 1
 * пиксель, сделай нормальные») каждое — призма в толщину полотна, шесть граней
 * подряд (`volumePrismFaces`: четыре бока, верх, низ). `{faces, xs, ys,
 * x, y}` — точки и середина полотна; по середине сверяются места, как прежде
 * по единственной грани.
 */
function boardsOf(faces) {
  const own = faces.filter((face) => face.rgb[0] === 176);
  const boards = [];
  for (let index = 0; index + 6 <= own.length; index += 6) {
    const group = own.slice(index, index + 6);
    const xs = group.flatMap((face) => face.p.map((point) => point.x));
    const ys = group.flatMap((face) => face.p.map((point) => point.y));
    const mid = (list) => (Math.min(...list) + Math.max(...list)) / 2;
    boards.push({ faces: group, xs, ys, x: mid(xs), y: mid(ys) });
  }
  assert.equal(own.length, boards.length * 6, "полотно не призмой");
  return boards;
}
const spanOf = (list) => Math.max(...list) - Math.min(...list);

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
    // Брусок с правки 2026-10-27 объёмный: у каждого ровно одно лицо в сторону
    // нормали стены (стена стенда идёт вдоль x).
    return volumeScene(scene.project, scene.schemeId).faces.filter(
      (face) => !face.doorId && face.rgb && face.rgb[0] === 240 && face.n.y > 0.9,
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

test("закрытые поднимающиеся ворота стоят полотном в проёме", () => {
  const panels = (kind) => {
    const scene = one(kind);
    const built = volumeScene(scene.project, scene.schemeId);
    return { built, scene, faces: built.faces.filter((face) => face.both && face.rgb[0] === 176) };
  };
  const sectional = panels("gateSectional");
  assert.equal(sectional.faces.length, 4, "четыре панели");
  const roller = panels("gateRoller");
  assert.ok(roller.faces.length > 10, "ламели: " + roller.faces.length);
  // Панели лежат в одной плоскости и друг на друга не налезают.
  const ys = sectional.faces.flatMap((face) => face.p.map((point) => point.y));
  assert.ok(Math.max(...ys) - Math.min(...ys) < 1, "полотно плоское");
  // Полотно именное: щелчок по нему открывает **эти** ворота, а не соседние.
  for (const face of sectional.faces) assert.equal(face.doorId, sectional.scene.ids[0]);
});

// ——— ворота поднимаются (таск 219, G328) —————————————————————————————————
//
// Слова заказчика: «Ворота-роллеты и секционные не открываются — должны
// открываться в объёме. Да, пусть лист будет». В таске 215 открытого положения
// у них не было, и довод был назван: полотно уходит вверх, и показывать это
// пришлось бы горизонтальным листом в комнате. Лист принят.

test("G328: поднимающиеся ворота — двери сцены: R их открывает, счётчик их считает", () => {
  for (const kind of ["gateRoller", "gateSectional"]) {
    const scene = one(kind);
    const built = volumeScene(scene.project, scene.schemeId);
    assert.deepEqual(built.doors, [scene.ids[0]], kind + " не попали в список дверей сцены");
    assert.equal(volumeDoorOpen(new Set(built.doors), scene.ids[0]), true, kind);
  }
  // Положений у них **два**, а не четыре: ни петель, ни стороны стены у
  // полотна нет — кольцо `Q`/`E` их не водит, и полей створки у них в объекте
  // не появляется.
  for (const kind of ["gateRoller", "gateSectional"]) {
    assert.equal(openingHasLeaf(kind), false, kind + ": сторона у полотна появилась");
    assert.equal(openingOpens(kind), true, kind + ": полотно есть, и оно открывается");
    const scene = one(kind);
    assert.equal(Object.prototype.hasOwnProperty.call(scene.project.openings[0], "hinge"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(scene.project.openings[0], "swing"), false);
  }
  // Распашные и сдвижные ворота открывались и раньше — список от этого не
  // сбился: в нём теперь все четверо.
  const all = room([
    { kind: "gateRoller", atMm: 0, ...openingCatalogDefaults("gateRoller") },
    { kind: "gateSectional", atMm: 2600, ...openingCatalogDefaults("gateSectional") },
  ]);
  assert.equal(volumeScene(all.project, all.schemeId).doors.length, 2);
});

test("G328: роллета сворачивается в вал, а секционные уходят листом в комнату", () => {
  const opened = (kind) => {
    const scene = one(kind);
    const shut = volumeScene(scene.project, scene.schemeId);
    const open = volumeScene(scene.project, scene.schemeId, { openDoorIds: new Set(scene.ids) });
    return { scene, shut: leafOf(shut, scene.ids[0]), open: leafOf(open, scene.ids[0]) };
  };
  const roller = opened("gateRoller");
  // Полотна в проёме не осталось: сквозь открытые ворота видно.
  const inOpening = (faces) => faces.filter((face) => face.p.every((point) => Math.abs(point.y) < 1));
  assert.ok(inOpening(roller.shut).length > 10, "закрытая роллета стоит ламелями в проёме");
  assert.equal(inOpening(roller.open).length, 0, "открытая роллета из проёма ушла");
  // Вал — короб над проёмом: его грани стоят **выше** верха полотна.
  const top = openingCatalogDefaults("gateRoller").heightMm;
  const zs = roller.open.flatMap((face) => face.p.map((point) => point.z));
  assert.ok(Math.min(...zs) >= top - 1, "вал встал под перемычкой: низ " + Math.min(...zs));
  assert.ok(Math.max(...zs) <= top + VOLUME_ROLL_MM + 1, "вал не толще своей меры");
  // Рулон занимает место поперёк стены, но в комнату не выступает дальше
  // полутолщины: его ставят коробом под перемычку.
  const away = Math.max(...roller.open.flatMap((face) => face.p.map((point) => Math.abs(point.y))));
  assert.ok(away <= 101, "вал не вылез в комнату: " + away);

  const sectional = opened("gateSectional");
  assert.equal(inOpening(sectional.open).length, 0, "открытые секционные из проёма ушли");
  // Пакет панелей — **один горизонтальный лист** под перемычкой: все четыре
  // угла на одной высоте, и уходит он от стены внутрь на высоту полотна.
  assert.equal(sectional.open.length, 1, "лист один");
  const sheet = sectional.open[0];
  const heights = sheet.p.map((point) => point.z);
  assert.ok(Math.max(...heights) - Math.min(...heights) < 1, "лист горизонтален");
  assert.ok(Math.abs(Math.max(...heights) - openingCatalogDefaults("gateSectional").heightMm) < 1, "лист под перемычкой");
  const deep = Math.max(...sheet.p.map((point) => Math.abs(point.y)));
  assert.ok(deep > 2000, "лист уходит в комнату на высоту полотна: " + deep);
});

test("G328: лист секционных уходит в комнату, а не на улицу", () => {
  // Сторону спрашивают у контуров помещений — тем же щупом, которым солнце
  // выясняет, куда ему светить. Комната здесь по y > 0 (стена по y = 0, а
  // прямоугольник комнаты уходит вниз по чертежу).
  const scene = one("gateSectional");
  const outlined = volumeInnerSide(scene.wall, [{ pointsMm: [
    { x: 100, y: 100 }, { x: 6900, y: 100 }, { x: 6900, y: 3900 }, { x: 100, y: 3900 },
  ] }], 1500);
  assert.equal(outlined, -1, "комната — та сторона, где её контур");
  // Контуров нет — ответа нет, и сторону выбирает тот, кто спрашивал.
  assert.equal(volumeInnerSide(scene.wall, [], 1500), 0);
  assert.equal(volumeInnerSide(scene.wall, null, 1500), 0);
});

test("двустворчатая дверь — две створки с ручками, и обе уходят на сторону открывания", () => {
  const scene = one("doorDouble", { hinge: "start", swing: "left" });
  const built = volumeScene(scene.project, scene.schemeId);
  const leaf = leafOf(built, scene.ids[0]);
  const panels = boardsOf(leaf);
  assert.equal(panels.length, 2, "две створки");
  const handles = leaf.filter((face) => face.rgb[0] === 186);
  assert.ok(handles.length >= 10, "по ручке на створку: " + handles.length);
  assert.ok(built.doors.includes(scene.ids[0]), "двустворчатая открывается");
  const away = (boards) => Math.max(...boards.flatMap((board) => board.ys.map(Math.abs)));
  assert.ok(away(panels) <= VOLUME_DOOR_LEAF_MM / 2 + 0.01, "закрытые стоят в проёме");
  for (const panel of panels) assert.ok(Math.abs(spanOf(panel.ys) - VOLUME_DOOR_LEAF_MM) < 0.01, "у створки нет толщины");
  const open = volumeScene(scene.project, scene.schemeId, { openDoorIds: new Set(scene.ids) });
  const spread = boardsOf(leafOf(open, scene.ids[0]));
  assert.ok(away(spread) > 600, "раскрытые уходят от стены: " + away(spread));
});

test("сдвижное полотно съезжает за косяк, портальное прячется в стену", () => {
  // Гармошки здесь нет нарочно: с таска 226 она не съезжает, а складывается
  // пакетом звеньев — у неё свой тест ниже (G338).
  const scene = one("doorSliding", { hinge: "start", swing: "left" });
  const shut = volumeScene(scene.project, scene.schemeId);
  const open = volumeScene(scene.project, scene.schemeId, { openDoorIds: new Set(scene.ids) });
  const [closed, ...moreClosed] = boardsOf(leafOf(shut, scene.ids[0]));
  const [moved, ...moreMoved] = boardsOf(leafOf(open, scene.ids[0]));
  assert.equal(moreClosed.length, 0, "закрытое полотно — одно");
  assert.equal(moreMoved.length, 0, "уехавшее полотно — то же одно");
  assert.ok(Math.min(...moved.xs) < Math.min(...closed.xs) - 100, "сдвижное не съехало");
  // Съехало **вдоль** стены, а не распахнулось: длина полотна по стене та же.
  assert.ok(Math.abs(spanOf(moved.xs) - spanOf(closed.xs)) < 1, "уехавшее полотно другой длины");
  // И уехало **по стороне стены**, а не внутри неё (дефект D78): закрытое
  // стоит в середине толщины, уехавшее — за гранью стены, на зазоре.
  assert.ok(Math.max(...closed.ys.map(Math.abs)) <= VOLUME_DOOR_LEAF_MM / 2 + 0.01, "закрытое полотно ушло из проёма");
  const wall = Number(scene.wall.thicknessMm) / 2;
  for (const y of moved.ys) assert.ok(Math.abs(y) > wall, "уехавшее полотно осталось в стене: " + y);
  const inner = Math.min(...moved.ys.map(Math.abs));
  assert.ok(Math.abs(inner - (wall + VOLUME_SLIDE_GAP_MM)) < 1, "полотно встало не на зазор: " + inner);
  assert.ok(Math.abs(spanOf(moved.ys) - VOLUME_DOOR_LEAF_MM) < 0.01, "у уехавшего полотна нет толщины");
  // Портальная уезжает в стену, и открытой её не видно вовсе — это самый
  // честный вид «открыто», какой у неё бывает.
  const pocket = one("doorPocket", { hinge: "start", swing: "left" });
  assert.equal(leafOf(volumeScene(pocket.project, pocket.schemeId), pocket.ids[0]).length > 0, true);
  const hidden = volumeScene(pocket.project, pocket.schemeId, { openDoorIds: new Set(pocket.ids) });
  assert.deepEqual(leafOf(hidden, pocket.ids[0]), [], "раскрытая портальная не рисуется");
});

// ——— таск 226: гармошка складывается пакетом (G338) ————————————————————————
//
// Долг таска 215: «гармошка в объёме складывается в половину своей ширины —
// приближение, а не пакет звеньев». Приближение врало дважды: полотно съезжало
// за косяк, как сдвижное, и оставалось одной полосой вдвое короче себя.
//
// Проверяется здесь то, в чём врать некуда: число звеньев взято из той же
// сетки, что рисунок на плане и на развёртке; звенья стоят поперёк стены; пакет
// стоит у косяка с петлями и из проёма не вылезает; толщина его — считанная,
// а не на глаз.

test("G338: раскрытая гармошка складывается пакетом звеньев у косяка", () => {
  const scene = one("doorFolding", { hinge: "start", swing: "left" });
  const opening = scene.project.openings[0];
  const links = openingFoldLinks(opening);
  // Число звеньев — то же, которым полотно нарисовано на плане и на развёртке.
  // Второго числа для гармошки в сборке нет, и это ровно решение таска 215.
  assert.equal(links, openingFaceGrid(opening).xs.length + 1, "у объёма своё число звеньев");
  assert.equal(links, 4, "у гармошки каталога звеньев не четыре");
  const shut = boardsOf(leafOf(volumeScene(scene.project, scene.schemeId), scene.ids[0]));
  const open = leafOf(volumeScene(scene.project, scene.schemeId, { openDoorIds: new Set(scene.ids) }), scene.ids[0]);
  const boards = boardsOf(open);
  assert.equal(shut.length, 1, "закрытая гармошка стоит в проёме одним полотном");
  assert.equal(boards.length, links, "звеньев в пакете не столько, сколько секций: " + boards.length);
  // Каждое звено — поперёк стены, толщиной в звено и шириной в свою секцию:
  // 900 / 4 = 225 мм.
  const link = opening.widthMm / links;
  for (const board of boards) {
    assert.ok(Math.abs(spanOf(board.xs) - VOLUME_FOLD_LEAF_MM) < 0.01, "звено легло вдоль стены, а не поперёк");
    assert.ok(Math.abs(spanOf(board.ys) - link) < 1, "звено не в секцию шириной");
  }
  // Пакет стоит у того косяка, где петли (проём начинается на 1000), и толщина
  // его считается, а не пишется: звено на звено плюс зазор. Четыре звена по 40
  // и три зазора по 10 — 190 мм.
  const planes = boards.map((board) => board.x).sort((one, two) => one - two);
  const pack = links * VOLUME_FOLD_LEAF_MM + (links - 1) * VOLUME_FOLD_GAP_MM;
  assert.equal(pack, 190);
  assert.ok(Math.abs(planes[0] - (1000 + VOLUME_FOLD_LEAF_MM / 2)) < 1, "пакет не у косяка: " + planes[0]);
  assert.ok(
    Math.abs(planes[links - 1] - planes[0] - (links - 1) * (VOLUME_FOLD_LEAF_MM + VOLUME_FOLD_GAP_MM)) < 1,
    "шаг пакета не звено с зазором",
  );
  assert.ok(planes[links - 1] + VOLUME_FOLD_LEAF_MM / 2 <= 1000 + opening.widthMm, "пакет вылез за проём");
  // Ручка уехала вместе с последним звеном: в воздухе посреди проёма её нет.
  const handles = open.filter((face) => face.rgb[0] === 186);
  assert.ok(handles.length >= 6, "ручки у пакета нет: " + handles.length);
  // Ручка — коробок **на** звене: вдоль стены она выступает на обе стороны
  // полотна, поэтому сверяется середина, а не края.
  const handleX = handles.flatMap((face) => face.p.map((point) => point.x));
  const middle = (Math.min(...handleX) + Math.max(...handleX)) / 2;
  assert.ok(Math.abs(middle - planes[links - 1]) < 1, "ручка стоит не на последнем звене: " + middle);
  const handleY = handles.flatMap((face) => face.p.map((point) => Math.abs(point.y)));
  assert.ok(Math.max(...handleY) > link / 2, "ручка не у свободного края звена: " + Math.max(...handleY));
  // Петли у другого косяка — пакет собирается у него, а не ломится сквозь
  // стену: на знаке здесь легко ошибиться, и видно это было бы только глазом.
  const other = one("doorFolding", { hinge: "end", swing: "left" });
  const far = boardsOf(leafOf(volumeScene(other.project, other.schemeId, { openDoorIds: new Set(other.ids) }), other.ids[0]))
    .map((board) => board.x)
    .sort((one, two) => one - two);
  assert.ok(Math.abs(far[links - 1] - (1900 - VOLUME_FOLD_LEAF_MM / 2)) < 1, "пакет не у второго косяка: " + far[links - 1]);
  assert.ok(far[0] > 1000, "пакет от второго косяка ушёл за первый");
});

test("G338: пакет у́же проёма — а проём у́же пакета жмёт звенья, но не рисует их в стене", () => {
  // Такой гармошки не бывает, но ширину задаёт человек: 160 мм на четыре звена
  // по 40 — пакету негде встать во всю свою толщину. Жмётся шаг, а звенья
  // остаются в проёме: нарисовать их сквозь косяк было бы хуже всего.
  const scene = one("doorFolding", { widthMm: 160, hinge: "start", swing: "left" });
  const open = leafOf(volumeScene(scene.project, scene.schemeId, { openDoorIds: new Set(scene.ids) }), scene.ids[0]);
  const boards = boardsOf(open);
  assert.equal(boards.length, 4, "звеньев всё те же четыре");
  const xs = boards.flatMap((board) => board.xs);
  assert.ok(Math.min(...xs) >= 1000 - 1 && Math.max(...xs) <= 1160 + 1, "звенья ушли в стену");
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

// ——— дуга арки на трёх поверхностях (таск 219, G329) —————————————————————

test("G329: дуга есть на листе и в плитке выбора, а на плане у арки прежний пунктир", () => {
  const scene = one("arch");
  const face = wallElevation(scene.project, scene.wall.id, "right").openings[0];
  assert.ok(face.arch && face.arch.riseMm > 0, "лист не знает про дугу");
  const sheet = [];
  drawOpeningFace(scribe(sheet), { x: 0, y: 0, width: 240, height: 420 }, face, { unit: 1, scale: 0.2 });
  assert.equal(sheet.filter((call) => call.startsWith("arc(")).length, 1, "дуги на листе нет");
  assert.equal(sheet.filter((call) => call.startsWith("strokeRect(")).length, 0, "арка обведена прямоугольником");
  // Плитка выбора рисуется тем же лицом, и дуга на ней та же: до таска 219
  // «Проём» и «Арка» в окне выбора были неразличимы.
  const plain = [];
  const plainScene = one("opening");
  const plainFace = wallElevation(plainScene.project, plainScene.wall.id, "right").openings[0];
  drawOpeningFace(scribe(plain), { x: 0, y: 0, width: 240, height: 420 }, plainFace, { unit: 1, scale: 0.2 });
  assert.equal(plain.filter((call) => call.startsWith("arc(")).length, 0, "у проёма дуги быть не должно");
  assert.notDeepEqual(sheet, plain, "арка и проём на лице снова совпали");
  // На плане у арки — пунктир, и он не изменился: это проверяет отпечаток
  // таска 180 (`doors.test.js`), а здесь — что дуга туда не просочилась.
  assert.equal(planLog(scene, scene.project.openings[0]).filter((call) => call.startsWith("arc(")).length, 0);
  // На клетке, в которой дуге негде встать (просвет ниже её подъёма), проём
  // обводится прямоугольником — как обводился всегда, а не рвётся.
  const tiny = [];
  drawOpeningFace(scribe(tiny), { x: 0, y: 0, width: 6, height: 2 }, face, { unit: 1, scale: 0.002 });
  assert.equal(tiny.filter((call) => call.startsWith("strokeRect(")).length, 1);
  assert.equal(tiny.filter((call) => call.startsWith("arc(")).length, 0);
});

test("G329: в объёме у арки свод по дуге, откосы до пяты и пазухи по сторонам", () => {
  const scene = one("arch");
  const built = volumeScene(scene.project, scene.schemeId);
  const arch = openingArchGeometry(scene.project.openings[0]);
  const span = { from: 1000, to: 1000 + openingCatalogDefaults("arch").widthMm };
  const inArch = built.faces.filter((face) =>
    face.p.every((point) => point.x >= span.from - 0.01 && point.x <= span.to + 0.01 && Math.abs(point.y) <= 100.01),
  );
  // Свод: отрезков столько, на сколько режется дуга, и все они стоят между
  // пятой и верхом проёма.
  const top = openingCatalogDefaults("arch").heightMm;
  // Грани свода — те, у которых все четыре точки лежат на окружности дуги.
  const centre = top - arch.radiusMm;
  const onArc = (face) =>
    face.p.every((point) => Math.abs(Math.hypot(point.x - (span.from + span.to) / 2, point.z - centre) - arch.radiusMm) < 1);
  assert.equal(inArch.filter(onArc).length, VOLUME_ARCH_SEGMENTS, "свод режется дугой");
  // Откосы кончаются на пяте: выше неё стена не стоит, там свод.
  const isJamb = (face) =>
    !onArc(face) && face.p.every((point) => Math.abs(point.x - span.from) < 0.01 || Math.abs(point.x - span.to) < 0.01);
  const jambs = inArch.filter(isJamb);
  assert.equal(jambs.length, 2, "откосов двое");
  for (const jamb of jambs) {
    assert.ok(Math.max(...jamb.p.map((point) => point.z)) <= top - arch.riseMm + 0.01, "откос залез выше пяты");
  }
  // Пазухи: по двенадцать трапеций на сторону, у каждой нижняя кромка
  // наклонная — она и садится на дугу.
  const spandrel = inArch.filter((face) => !onArc(face) && !isJamb(face));
  assert.equal(spandrel.length, VOLUME_ARCH_SEGMENTS * 2, "пазух не по двенадцать на сторону: " + spandrel.length);
  const sloped = spandrel.filter((face) => {
    const low = face.p.map((point) => point.z).sort((a, b) => a - b).slice(0, 2);
    return Math.abs(low[0] - low[1]) > 0.01;
  });
  assert.ok(sloped.length >= spandrel.length - 2, "нижняя кромка пазухи обязана идти по дуге");
  // Сквозь арку по-прежнему ходят, и свет сквозь неё идёт: проём с дугой —
  // всё ещё проём.
  assert.equal(volumeOpeningWalkable(scene.project.openings[0]), true);
});

// ——— G68 ——————————————————————————————————————————————————————————————————

// ——— ВНИМАНИЕ: отпечаток объёма обновлён **по требованию заказчика** ————————
//
// Таск 219, требование G329: «У арки дорисуй дугу и на развёртке и в объёме».
// Кадр прежней сцены изменился — у арки появились свод и пазухи, — и это
// решение заказчика, а не поломка. Прежний отпечаток
// (`openings-volume-before.json`) **оставлен на месте**: по нему здесь
// проверяется, что всё, кроме самой арки, не изменилось ни на грань. Новый
// (`openings-after-g329.json`) держит кадр с дугой.
//
// Следующему исполнителю: покрасневший тест — не разрешение обновить
// отпечаток. Кадр прежнего объекта меняется только по слову заказчика, с
// номером требования.

test("G329: в объёме у арки появились свод и пазухи — и больше не изменилось ничего", () => {
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
  assert.equal(built.doors.length, VOLUME_BEFORE.doors, "дверей в сцене столько же");
  // Полотна дверей с правки 2026-10-27 объёмные — слово заказчика «полотно
  // двери имеет толщину в 1 пиксель, сделай нормальные», — и рама окна вслед
  // за ними. Отпечатки сверяются без граней полотен (`door`) и брусков рамы
  // (её цвет), сами они проверяются тестами дверей и импостов.
  const frame = (face) => Array.isArray(face.rgb) && face.rgb.join(",") === VOLUME_FRAME_RGB.join(",");
  const still = (list) => list.filter((face) => face.door === null && !frame(face));
  assert.deepEqual(still(print), still(VOLUME_AFTER.volume.print), "кадр сцены разошёлся с отпечатком таска 219");
  // Арка стоит пятой, на отступе 5000 шириной 1200, в стене по y = 0 толщиной
  // 200. Её грани — те, что целиком лежат в этой коробке; всё остальное к арке
  // отношения не имеет и обязано совпасть с прежним отпечатком **грань в
  // грань**.
  const archy = (face) =>
    face.p.every((point) => point[0] >= 4999.99 && point[0] <= 6200.01 && Math.abs(point[1]) <= 100.01);
  assert.deepEqual(
    still(print).filter((face) => !archy(face)),
    still(VOLUME_BEFORE.print).filter((face) => !archy(face)),
    "G329 тронул что-то кроме арки",
  );
  // Чем именно стала арка — числами. Было пять граней: перемычка, два откоса и
  // два куска стены над проёмом. Стало сорок: двенадцать отрезков свода,
  // двенадцать трапеций пазухи на каждой стороне и те же два откоса, которые
  // теперь кончаются на пяте.
  assert.equal(VOLUME_BEFORE.print.filter(archy).length, 5);
  assert.equal(print.filter(archy).length, 2 + VOLUME_ARCH_SEGMENTS * 3);
  assert.equal(still(print).length - still(VOLUME_BEFORE.print).length, 33);
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
