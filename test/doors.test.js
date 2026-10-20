// Двери: четыре состояния по `Q`/`E` и стеклянная дверь (таск 180, G268, G269).
//
// Слова заказчика — два требования:
//
//   «при установке дверей так же вращай их по Q/E причём сразу по 4 значениям —
//   сперва сторона петель, потом сторона открытия»;
//
//   «Добавь Стеклянные двери. (как на французский балкон — с рамой, но не
//   глухая, а по центру стекло, ну и тоже ручки)».
//
// Что проверяется здесь:
//
//   1. **Кольцо из четырёх состояний.** Каждый шаг меняет ровно один признак,
//      первый — петли; четыре шага возвращают дверь к исходной; `Q` и `E` идут
//      по одному кольцу в разные стороны. Это и есть «сперва сторона петель,
//      потом сторона открытия», записанное так, что его нельзя переставить
//      молча.
//   2. **Стеклянная дверь — дверь.** Полотно, петли, сторона открывания и
//      ручка у неё те же; вопрос «есть ли полотно» задаётся одним
//      `openingHasLeaf`, а не сравнением с видом.
//   3. **Рама и стекло.** На плане полотно обведено контуром с бумагой внутри
//      (а не нарисовано линией, как глухое), на развёртке у него рама по
//      контуру и стекло в середине.
//   4. **G68 буквально.** Кадр прежних проёмов — окна, двух дверей, проёма без
//      полотна и арки — обязан состоять из тех же вызовов холста, что и до
//      таска. Отпечаток снят на прежнем коде и лежит в
//      `fixtures/openings-before.json`: обещанием это не проверить, слой
//      проёмов не смеет добавить ни одного вызова и ни одной краски.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  OPENING_DOOR_KINDS,
  OPENING_DOOR_STATES,
  OPENING_GLASS_FRAME_MM,
  OPENING_HINGES,
  OPENING_KINDS,
  OPENING_KIND_DOOR,
  OPENING_KIND_GLASS_DOOR,
  OPENING_SWINGS,
  addOpening,
  addScheme,
  addWall,
  createProject,
  findScheme,
  openingDoorStateIndex,
  openingDoorStep,
  openingHasLeaf,
  setPlanOrigin,
  setPlanScale,
  updateOpening,
  wallElevation,
} from "../src/model.js";
import { drawDrawingOpening, drawElevation, drawingBridge, drawingDoorLeaf } from "../src/render.js";
import {
  VOLUME_CLEAR_ALPHA,
  VOLUME_EYE_MM,
  VOLUME_FRAME_RGB,
  VOLUME_GLASS_RGB,
  VOLUME_HANDLE_RGB,
  volumeDoorAt,
  volumeFrame,
  volumeOpeningWalkable,
  volumeScene,
  volumeSightAt,
} from "../src/volume.js";
import { strings } from "../src/strings.js";

const PRINTS_BEFORE = JSON.parse(readFileSync(new URL("./fixtures/openings-before.json", import.meta.url), "utf8"));

// Журнал вызовов холста: и вызовы, и присвоенные краски. Числа округляются до
// сотой — иначе отпечаток падал бы от разницы в последнем бите.
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

// Та же сцена, на которой снят отпечаток: план 1200 × 800, в метре 100 точек,
// стена шесть метров и пять проёмов прежних видов вдоль неё.
const LEGACY_SPECS = [
  { kind: "window", atMm: 200, widthMm: 1500, heightMm: 1400, heightAboveFloorMm: 800 },
  { kind: "door", atMm: 2000, widthMm: 900, heightMm: 2100, heightAboveFloorMm: 0, hinge: "start", swing: "left" },
  { kind: "door", atMm: 3000, widthMm: 900, heightMm: 2100, heightAboveFloorMm: 0, hinge: "end", swing: "right" },
  { kind: "opening", atMm: 4000, widthMm: 900, heightMm: 2100, heightAboveFloorMm: 0 },
  { kind: "arch", atMm: 5000, widthMm: 900, heightMm: 2100, heightAboveFloorMm: 0 },
];

function wallScene(specs) {
  const added = addScheme(createProject(), { name: "1", imageId: "p", width: 1200, height: 800 });
  let project = setPlanScale(added.project, added.scheme.id, {
    a: { x: 0.1, y: 0.5 },
    b: { x: 0.6, y: 0.5 },
    meters: 6,
  }).project;
  project = setPlanOrigin(project, added.scheme.id, { at: { x: 0.2, y: 0.8 }, turn: 0 }).project;
  const wall = addWall(project, {
    schemeId: added.scheme.id,
    aMm: { x: 0, y: 0 },
    bMm: { x: 6000, y: 0 },
    thicknessMm: 100,
  });
  project = wall.project;
  for (const spec of specs) {
    project = addOpening(project, { wallId: wall.wall.id, ...spec }).project;
  }
  const scheme = findScheme(project, added.scheme.id);
  const view = { zoom: 1, offsetX: 0, offsetY: 0, markSize: 10, labelSize: 12 };
  return { project, schemeId: added.scheme.id, wall: wall.wall, bridge: drawingBridge(project, scheme, view) };
}

function planLog(scene, opening, options = {}) {
  const log = [];
  drawDrawingOpening(scribe(log), scene.bridge, scene.wall, opening, options);
  return log;
}

// ——— четыре состояния кольцом (G268) ——————————————————————————————————

test("четыре состояния двери — кольцо, и каждый шаг меняет ровно один признак", () => {
  assert.equal(OPENING_DOOR_STATES.length, 4);
  // Все четыре сочетания есть, и ни одно не повторено.
  const keys = OPENING_DOOR_STATES.map((state) => state.hinge + "/" + state.swing);
  assert.equal(new Set(keys).size, 4, keys.join(" "));
  for (const hinge of OPENING_HINGES) {
    for (const swing of OPENING_SWINGS) {
      assert.ok(keys.includes(hinge + "/" + swing), "нет состояния " + hinge + "/" + swing);
    }
  }
  // Шаг по кольцу меняет один признак — и так все четыре шага, включая
  // замыкающий. Двоичный счётчик упал бы здесь на двух шагах из четырёх.
  for (let index = 0; index < 4; index += 1) {
    const now = OPENING_DOOR_STATES[index];
    const next = OPENING_DOOR_STATES[(index + 1) % 4];
    const changed = (now.hinge !== next.hinge ? 1 : 0) + (now.swing !== next.swing ? 1 : 0);
    assert.equal(changed, 1, "шаг " + index + " переставил не один признак");
  }
  // Первый шаг — петли: «сперва сторона петель, потом сторона открытия».
  const first = openingDoorStep(OPENING_DOOR_STATES[0], 1);
  assert.notEqual(first.hinge, OPENING_DOOR_STATES[0].hinge, "первый шаг обязан переставить петли");
  assert.equal(first.swing, OPENING_DOOR_STATES[0].swing, "сторона открывания на первом шаге стоит");
  const second = openingDoorStep(first, 1);
  assert.equal(second.hinge, first.hinge, "петли на втором шаге стоят");
  assert.notEqual(second.swing, first.swing, "второй шаг обязан переставить сторону");
});

test("E ведёт по кольцу вперёд, Q назад, четыре шага возвращают дверь на место", () => {
  let state = { hinge: "start", swing: "left" };
  const seen = [];
  for (let step = 0; step < 4; step += 1) {
    state = openingDoorStep(state, 1);
    seen.push(state.hinge + "/" + state.swing);
  }
  assert.equal(seen.length, 4);
  assert.equal(new Set(seen).size, 4, "кольцо обязано пройти все четыре: " + seen.join(" "));
  assert.deepEqual(state, { hinge: "start", swing: "left" }, "четыре шага — и дверь та же");
  // `Q` — то же кольцо в другую сторону: шаг туда и шаг обратно возвращают.
  const forward = openingDoorStep({ hinge: "start", swing: "left" }, 1);
  assert.deepEqual(openingDoorStep(forward, -1), { hinge: "start", swing: "left" });
  // Назад от первого состояния — последнее кольца, а не ничто.
  assert.deepEqual(openingDoorStep(OPENING_DOOR_STATES[0], -1), OPENING_DOOR_STATES[3]);
});

test("состояние двери узнаётся, а чужое и пустое читается первым", () => {
  OPENING_DOOR_STATES.forEach((state, index) => {
    assert.equal(openingDoorStateIndex(state), index);
  });
  assert.equal(openingDoorStateIndex(null), 0);
  assert.equal(openingDoorStateIndex({}), 0);
  assert.equal(openingDoorStateIndex({ hinge: "вбок", swing: "вверх" }), 0);
  // Шаг отдаёт **новый** объект: мутировать состояние двери никто не вправе.
  const source = { hinge: "start", swing: "left" };
  const stepped = openingDoorStep(source, 1);
  assert.notEqual(stepped, source);
  assert.deepEqual(source, { hinge: "start", swing: "left" });
});

// ——— стеклянная дверь — это дверь (G269) ———————————————————————————————

test("полотно есть у двери и у стеклянной двери, и спрашивается это одним местом", () => {
  assert.deepEqual(OPENING_DOOR_KINDS, [OPENING_KIND_DOOR, OPENING_KIND_GLASS_DOOR]);
  for (const kind of OPENING_KINDS) {
    assert.equal(openingHasLeaf(kind), kind === OPENING_KIND_DOOR || kind === OPENING_KIND_GLASS_DOOR, kind);
  }
  assert.equal(openingHasLeaf("люк"), false);
  assert.equal(openingHasLeaf(undefined), false);
  // Имя вида есть в словаре: забытое вышло бы в колонку по-английски.
  assert.equal(typeof strings.openingKinds[OPENING_KIND_GLASS_DOOR], "string");
});

test("створка стеклянной двери считается той же геометрией, что у обычной", () => {
  const scene = wallScene([
    { kind: "glassDoor", atMm: 1000, widthMm: 800, heightMm: 2200, heightAboveFloorMm: 0, hinge: "end", swing: "right" },
    { kind: "door", atMm: 3000, widthMm: 800, heightMm: 2100, heightAboveFloorMm: 0, hinge: "end", swing: "right" },
  ]);
  const [glass, plain] = scene.project.openings;
  const glassLeaf = drawingDoorLeaf(scene.wall, glass);
  const plainLeaf = drawingDoorLeaf(scene.wall, plain);
  assert.ok(glassLeaf && plainLeaf);
  // Одна ширина, одни петли, одна сторона — один рисунок створки: кончик
  // полотна уходит от петли на ту же сторону стены и на ту же длину.
  assert.equal(glassLeaf.side, plainLeaf.side);
  assert.equal(glassLeaf.radius, plainLeaf.radius);
  assert.equal(Math.round(glassLeaf.tip.y - glassLeaf.hinge.y), Math.round(plainLeaf.tip.y - plainLeaf.hinge.y));
});

test("на плане полотно стеклянной двери — рама с бумагой внутри, а глухое — линия", () => {
  const scene = wallScene([
    { kind: "glassDoor", atMm: 1000, widthMm: 800, heightMm: 2200, heightAboveFloorMm: 0, hinge: "start", swing: "left" },
    { kind: "door", atMm: 3000, widthMm: 800, heightMm: 2100, heightAboveFloorMm: 0, hinge: "start", swing: "left" },
  ]);
  const [glass, plain] = scene.project.openings;
  const glassLog = planLog(scene, glass);
  const plainLog = planLog(scene, plain);
  // Дуга открывания есть у обеих: четыре состояния видно по ней одинаково.
  assert.ok(
    glassLog.some((call) => call.startsWith("arc(")),
    glassLog.join(" "),
  );
  assert.ok(plainLog.some((call) => call.startsWith("arc(")));
  // У стеклянной полотно замкнуто и залито бумагой — это и есть стекло.
  // Заливок бумагой две: дырка проёма и полотно; у глухой — только дырка.
  const paper = (log) => log.filter((call) => call === "fillStyle=#f6f8fa").length;
  assert.equal(paper(glassLog), 2, glassLog.join(" "));
  assert.equal(paper(plainLog), 1, plainLog.join(" "));
  assert.ok(glassLog.filter((call) => call === "closePath()").length > plainLog.filter((call) => call === "closePath()").length);
  // Красный призрак не сядет — и краснеет он весь, вместе с рамой полотна.
  const bad = planLog(scene, glass, { ghost: true, bad: true });
  assert.ok(
    bad.some((call) => call === "strokeStyle=#d1242f"),
    bad.join(" "),
  );
  assert.ok(bad.includes("globalAlpha=0.65"), "призрак бледнее того, что встанет");
});

test("на развёртке у стеклянной двери рама по контуру и стекло в середине", () => {
  const scene = wallScene([
    { kind: "glassDoor", atMm: 1000, widthMm: 800, heightMm: 2200, heightAboveFloorMm: 0, hinge: "start", swing: "left" },
  ]);
  const elevation = wallElevation(scene.project, scene.wall.id, "right");
  const log = [];
  drawElevation(scribe(log), elevation, { x: 0, y: 0, width: 800, height: 400 });
  const rects = log.filter((call) => call.startsWith("strokeRect("));
  // Два прямоугольника полотна: проём и стекло внутри него. Внутренний уже и
  // ниже внешнего ровно на две ширины рамы.
  assert.ok(rects.length >= 2, rects.join(" "));
  const numbers = (call) => call.slice(call.indexOf("(") + 1, -1).split(",").map(Number);
  const outer = numbers(rects[rects.length - 2]);
  const inner = numbers(rects[rects.length - 1]);
  const scale = (outer[3] - inner[3]) / (2 * OPENING_GLASS_FRAME_MM);
  assert.ok(scale > 0, "рама отложена внутрь: " + rects.join(" "));
  assert.ok(Math.abs(inner[0] - (outer[0] + OPENING_GLASS_FRAME_MM * scale)) < 0.01, rects.join(" "));
  assert.ok(Math.abs(inner[2] - (outer[2] - 2 * OPENING_GLASS_FRAME_MM * scale)) < 0.01, rects.join(" "));
  // У прежней двери второго прямоугольника нет — развёртка её не изменилась.
  const plain = wallScene([
    { kind: "door", atMm: 1000, widthMm: 800, heightMm: 2100, heightAboveFloorMm: 0, hinge: "start", swing: "left" },
  ]);
  const plainLog = [];
  drawElevation(scribe(plainLog), wallElevation(plain.project, plain.wall.id, "right"), {
    x: 0,
    y: 0,
    width: 800,
    height: 400,
  });
  assert.equal(
    plainLog.filter((call) => call.startsWith("strokeRect(")).length,
    rects.length - 1,
    "у глухой двери прямоугольник один",
  );
});

// ——— G68: прежние проёмы рисуются ровно как прежде ——————————————————————

test("G68: кадр прежних проёмов — вызов в вызов тот же, что до стеклянной двери", () => {
  const scene = wallScene(LEGACY_SPECS);
  scene.project.openings.forEach((opening, index) => {
    const key = "plan:" + opening.kind + ":" + index;
    assert.deepEqual(planLog(scene, opening), PRINTS_BEFORE[key], key);
  });
  const log = [];
  drawElevation(scribe(log), wallElevation(scene.project, scene.wall.id, "right"), {
    x: 0,
    y: 0,
    width: 800,
    height: 400,
  });
  assert.deepEqual(log, PRINTS_BEFORE.elevation, "развёртка прежних проёмов не изменилась");
});

test("G68: прежний проём не обзавёлся ни одним новым полем", () => {
  const scene = wallScene(LEGACY_SPECS);
  const [window, door, , plain, arch] = scene.project.openings;
  assert.deepEqual(Object.keys(window).sort(), ["atMm", "heightAboveFloorMm", "heightMm", "id", "kind", "widthMm", "wallId"].sort());
  assert.deepEqual(
    Object.keys(door).sort(),
    ["atMm", "heightAboveFloorMm", "heightMm", "hinge", "id", "kind", "swing", "widthMm", "wallId"].sort(),
  );
  assert.equal(Object.prototype.hasOwnProperty.call(plain, "hinge"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(arch, "swing"), false);
  // Стеклянная дверь появляется только там, где её поставили: у соседей по
  // стене вид не менялся.
  const glass = addOpening(scene.project, {
    wallId: scene.wall.id,
    kind: OPENING_KIND_GLASS_DOOR,
    atMm: 5950,
    widthMm: 50,
    heightMm: 2200,
  });
  assert.deepEqual(
    glass.project.openings.map((opening) => opening.kind),
    ["window", "door", "door", "opening", "arch", OPENING_KIND_GLASS_DOOR],
  );
  // И обратно: стеклянная дверь стала окном — полей полотна не осталось.
  const asWindow = updateOpening(glass.project, glass.opening.id, { kind: "window", heightMm: 1400, heightAboveFloorMm: 800 });
  assert.equal(Object.prototype.hasOwnProperty.call(asWindow.opening, "hinge"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(asWindow.opening, "swing"), false);
});

// ——— объём: рама непрозрачна, стекло просвечивает (G269) ————————————————
//
// Прозрачность берётся **готовая** — та, которой просвечивает вещь чертежа
// (таск 169): признак `clear` у грани и доля `VOLUME_CLEAR_ALPHA` в цвете.
// Второй прозрачности в сборке быть не должно, иначе стекло двери и стекло
// шкафа смешивались бы по-разному в одном кадре.

/** Комната 4 × 3 из четырёх стен; проёмы ставятся в первую — она по y = −1500. */
function room(specs) {
  const added = addScheme(createProject(), { name: "1 этаж", imageId: "p", width: 1200, height: 800 });
  let project = setPlanScale(added.project, added.scheme.id, {
    a: { x: 0.1, y: 0.5 },
    b: { x: 0.6, y: 0.5 },
    meters: 6,
  }).project;
  const half = { x: 2000, y: 1500 };
  const corners = [
    { x: -half.x, y: -half.y },
    { x: half.x, y: -half.y },
    { x: half.x, y: half.y },
    { x: -half.x, y: half.y },
  ];
  const walls = [];
  for (let index = 0; index < corners.length; index += 1) {
    const wall = addWall(project, {
      schemeId: added.scheme.id,
      aMm: corners[index],
      bMm: corners[(index + 1) % corners.length],
      thicknessMm: 200,
    });
    project = wall.project;
    walls.push(wall.wall.id);
  }
  const ids = [];
  for (const spec of specs) {
    const put = addOpening(project, { wallId: walls[0], ...spec });
    project = put.project;
    ids.push(put.opening.id);
  }
  return { project, schemeId: added.scheme.id, walls, ids };
}

const GLASS_DOOR = {
  kind: OPENING_KIND_GLASS_DOOR,
  atMm: 1500,
  widthMm: 900,
  heightMm: 2100,
  heightAboveFloorMm: 0,
  hinge: "start",
  swing: "left",
};

const leafOf = (built, doorId) => built.faces.filter((face) => face.doorId === doorId && face.both);

test("полотно стеклянной двери — четыре бруска рамы и стекло в середине", () => {
  const scene = room([GLASS_DOOR]);
  const built = volumeScene(scene.project, scene.schemeId);
  const leaf = leafOf(built, scene.ids[0]);
  assert.equal(leaf.length, 5, "четыре бруска рамы и одно стекло: " + leaf.length);
  const glass = leaf.filter((face) => face.clear);
  assert.equal(glass.length, 1, "стекло одно");
  assert.deepEqual(glass[0].rgb, VOLUME_GLASS_RGB);
  for (const face of leaf.filter((item) => !item.clear)) {
    assert.deepEqual(face.rgb, VOLUME_FRAME_RGB, "рама — тот же брусок, что у окна");
    assert.equal(face.clear, false, "рама непрозрачна: сквозь раму видно быть не должно");
  }
  // Стекло отступает от края полотна на ширину рамы — по всем четырём краям.
  const span = (faces, axis) => ({
    min: Math.min(...faces.flatMap((face) => face.p.map((point) => point[axis]))),
    max: Math.max(...faces.flatMap((face) => face.p.map((point) => point[axis]))),
  });
  const whole = span(leaf, "x");
  const inner = span(glass, "x");
  assert.ok(Math.abs(inner.min - (whole.min + OPENING_GLASS_FRAME_MM)) < 1, "рама слева: " + (inner.min - whole.min));
  assert.ok(Math.abs(whole.max - inner.max - OPENING_GLASS_FRAME_MM) < 1, "рама справа");
  const zWhole = span(leaf, "z");
  const zInner = span(glass, "z");
  assert.ok(Math.abs(zInner.min - (zWhole.min + OPENING_GLASS_FRAME_MM)) < 1, "рама снизу");
  assert.ok(Math.abs(zWhole.max - zInner.max - OPENING_GLASS_FRAME_MM) < 1, "рама сверху");
  // Ручка у стеклянной двери та же и тоже непрозрачная: её берут рукой.
  const handle = built.faces.filter((face) => face.rgb === VOLUME_HANDLE_RGB && face.doorId === scene.ids[0]);
  assert.ok(handle.length >= 5, "ручка — призма: " + handle.length);
  for (const face of handle) assert.equal(face.clear, false);
});

test("рама и стекло лежат в одной плоскости и друг на друга не налезают", () => {
  const scene = room([GLASS_DOOR]);
  const leaf = leafOf(volumeScene(scene.project, scene.schemeId), scene.ids[0]);
  // Коплоскостность — не прихоть: дерево порядка (таск 151) порядок внутри
  // плоскости не обещает, и прозрачному стеклу он нужен только относительно
  // того, что **за** полотном. Поэтому пять граней обязаны стоять в одной
  // плоскости и не перекрывать друг друга — тогда их взаимный порядок не
  // значит ничего.
  const ys = leaf.flatMap((face) => face.p.map((point) => point.y));
  assert.ok(Math.max(...ys) - Math.min(...ys) < 1, "полотно плоское: " + (Math.max(...ys) - Math.min(...ys)));
  const boxes = leaf.map((face) => ({
    x0: Math.min(...face.p.map((point) => point.x)),
    x1: Math.max(...face.p.map((point) => point.x)),
    z0: Math.min(...face.p.map((point) => point.z)),
    z1: Math.max(...face.p.map((point) => point.z)),
  }));
  for (let i = 0; i < boxes.length; i += 1) {
    for (let j = i + 1; j < boxes.length; j += 1) {
      const over = Math.min(boxes[i].x1, boxes[j].x1) - Math.max(boxes[i].x0, boxes[j].x0);
      const up = Math.min(boxes[i].z1, boxes[j].z1) - Math.max(boxes[i].z0, boxes[j].z0);
      assert.ok(over <= 0.01 || up <= 0.01, "грани " + i + " и " + j + " налезли друг на друга");
    }
  }
});

test("на узкое полотно рама не влезает — и стекла там не обещают", () => {
  // Дверь шириной в три рамы: стекло выродилось бы в щель, и честнее
  // нарисовать полотно глухим, чем обещать стекло.
  const scene = room([{ ...GLASS_DOOR, widthMm: OPENING_GLASS_FRAME_MM * 3 }]);
  const leaf = leafOf(volumeScene(scene.project, scene.schemeId), scene.ids[0]);
  assert.equal(leaf.length, 1, "одно глухое полотно");
  assert.equal(leaf[0].clear, false);
});

test("стеклянная дверь открывается, закрывается и попадает в «все двери»", () => {
  const scene = room([
    GLASS_DOOR,
    { kind: OPENING_KIND_DOOR, atMm: 2600, widthMm: 900, heightMm: 2100, heightAboveFloorMm: 0 },
  ]);
  const built = volumeScene(scene.project, scene.schemeId);
  // Обе двери в списке сцены — по нему `R` открывает все разом (G210).
  assert.deepEqual(built.doors, scene.ids, "сцена знает обе двери");
  const away = (faces) => Math.max(...faces.flatMap((face) => face.p.map((point) => Math.abs(point.y + 1500))));
  assert.ok(away(leafOf(built, scene.ids[0])) < 1, "закрытая стоит в проёме");
  const open = volumeScene(scene.project, scene.schemeId, { openDoorIds: new Set([scene.ids[0]]) });
  const spread = away(leafOf(open, scene.ids[0]));
  assert.ok(spread > 800, "раскрытая уходит от стены на четверть оборота: " + spread);
  // Стекло и рама уехали вместе с полотном: ни одна грань не осталась в проёме.
  const glass = open.faces.filter((face) => face.doorId === scene.ids[0] && face.clear);
  assert.equal(glass.length, 1);
  assert.ok(Math.min(...glass[0].p.map((point) => Math.abs(point.y + 1500))) > 80, "стекло уехало со створкой");
  // Соседняя глухая дверь при этом закрыта: список двери именной.
  assert.ok(away(leafOf(open, scene.ids[1])) < 1, "глухая осталась закрытой");
  // Сквозь проём стеклянной двери ходят, как сквозь дверной (решение таска 150).
  assert.equal(volumeOpeningWalkable(scene.project.openings[0]), true);
});

test("щелчок по стеклу открывает дверь, а взгляд смотрит сквозь него", () => {
  const scene = room([GLASS_DOOR]);
  const built = volumeScene(scene.project, scene.schemeId);
  const box = { width: 1200, height: 700 };
  // Стоим в комнате перед дверью: стена по y = −1500, дверь на отступе
  // 1500…2400 от начала стены (x = −2000), то есть около x = −50.
  const camera = { at: { x: -50, y: 0, z: VOLUME_EYE_MM }, yaw: -Math.PI / 2, pitch: 0 };
  const frame = volumeFrame(built, camera, box);
  const middle = { x: box.width / 2, y: box.height / 2 };
  // Прицел стоит на стекле — и дверь он всё равно показывает: щелчок и `E`
  // спрашивают `volumeDoorAt`, а она прозрачную грань не пропускает.
  assert.equal(volumeDoorAt(frame, middle.x, middle.y), scene.ids[0], "дверь под прицелом");
  // Кусков стекла в кадре может быть несколько: дерево порядка (таск 151)
  // режет грани плоскостями соседей, и это ровно то, чем оно и точно. Важно
  // другое — **каждый** кусок смешивается с тем, что за ним.
  const glass = frame.filter((polygon) => polygon.clear && polygon.door === scene.ids[0] && !polygon.stroke);
  assert.ok(glass.length >= 1, "стекло в кадре есть");
  for (const piece of glass) {
    assert.ok(piece.fill.startsWith("rgba("), "стекло смешивается с тем, что за ним: " + piece.fill);
    // Доля стекла — та же, что у вещи чертежа: своей прозрачности у двери нет.
    assert.ok(piece.fill.endsWith("," + VOLUME_CLEAR_ALPHA + ")"), piece.fill);
  }
  const bars = frame.filter((polygon) => polygon.door === scene.ids[0] && !polygon.clear && !polygon.stroke);
  assert.ok(bars.length >= 4, "брусков рамы в кадре: " + bars.length);
  for (const bar of bars) assert.ok(bar.fill.startsWith("rgb("), "рама непрозрачна: " + bar.fill);
  // Взгляд сквозь стекло идёт дальше (правило таска 169): за этой дверью ничего
  // нет, и ответ — «ничего», а не «дверь». Спор между ними разводит
  // `volumeAimChoice`: двери достаётся всё, на что взгляд не ответил.
  assert.equal(volumeSightAt(frame, middle.x, middle.y), null, "сквозь стекло взгляд не упирается в полотно");
});

test("G68: стеклянная дверь в объект ничего не пишет и объём только читает", () => {
  const scene = room([GLASS_DOOR]);
  const before = JSON.stringify(scene.project);
  volumeScene(scene.project, scene.schemeId);
  volumeScene(scene.project, scene.schemeId, { openDoorIds: new Set(scene.ids) });
  assert.equal(JSON.stringify(scene.project), before, "объём только читает");
  // Открытая дверь живёт в сеансе окна: в проёме её состояния нет.
  assert.equal(Object.prototype.hasOwnProperty.call(scene.project.openings[0], "open"), false);
});

// ——— один хозяин вопроса «есть ли полотно» ——————————————————————————————
//
// Стеклянная дверь — дверь в восьми местах сборки, и сломаться это может тихо:
// забытое сравнение `kind === OPENING_KIND_DOOR` оставило бы её без петель в
// колонке, без ручек на плане или без открывания в объёме. Поэтому вопрос
// задаётся одним `openingHasLeaf`, и это проверяется по исходникам, а не
// обещанием.

test("вид двери не сравнивают напрямую: вопрос о полотне задаётся одним местом", () => {
  const files = [
    "../src/render.js",
    "../src/volume.js",
    "../src/panels/workshop.js",
    "../src/panels/volume.js",
    "../src/panels/drawPicker.js",
  ];
  for (const file of files) {
    const source = readFileSync(new URL(file, import.meta.url), "utf8");
    assert.equal(
      source.includes("OPENING_KIND_DOOR"),
      false,
      file + ": вид двери сравнивается напрямую — стеклянная дверь мимо этого места и проедет",
    );
  }
  // Кольцо из четырёх состояний тоже одно: шаг по нему считает модель, а
  // панель только зовёт её.
  const panel = readFileSync(new URL("../src/panels/workshop.js", import.meta.url), "utf8");
  assert.equal((panel.match(/openingDoorStep\(/g) || []).length, 1, "шаг по кольцу зовётся из одного места");
  // И зовут его обе клавиши — `Q` и `E` — одной строкой, а не двумя путями.
  assert.match(panel, /KeyQ[\s\S]{0,400}doorTurnable\(\)/, "у двери свои `Q` и `E` в том же обработчике");
});
