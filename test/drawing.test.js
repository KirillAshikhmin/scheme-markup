// Модель чертежа: стены, проёмы, объекты схемы, высоты и привязка метки к
// стене (таск 123, требование G174).
//
// Здесь проверяется не «функция что-то вернула», а три вещи, в которых ошибка
// дороже всего:
//
//   1. **Миллиметры не едут.** Чертёж живёт в своей системе координат (ADR
//      008), и ни поворот, ни обрезка, ни замена подложки не смеют тронуть ни
//      одну стену. Из этого вырастут развёртка и 3D, и дорисовать их потом к
//      растру нельзя.
//   2. **Числа, которых не бывает, отвергаются вслух.** Ноль, минус, проём
//      шире стены, проём за её концом, окно выше потолка — на каждое модель
//      отвечает понятной ошибкой, а не молчанием: молчание уехало бы в
//      развёртку и в закупку.
//   3. **G68.** Объект, в котором чертежа нет, открывается, выгружается и
//      сливается ровно как прежде — сверкой с байтами опубликованной сборки,
//      а не обещанием.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  DRAWING_MM_MAX,
  OPENING_HINGES,
  OPENING_KINDS,
  OPENING_SWINGS,
  SCHEME_OBJECT_SHAPES,
  WALL_THICKNESS_MM_MAX,
  addMark,
  addOpening,
  addRoom,
  addScheme,
  addSchemeObject,
  addSchemeObjectKind,
  addWall,
  createProject,
  deleteOpening,
  deleteScheme,
  deleteSchemeObject,
  deleteSchemeObjectKind,
  deleteWall,
  drawingBoundsMm,
  drawingMmValue,
  ensureSchemeObjectKinds,
  findSchemeObjectKind,
  findWall,
  markWall,
  openingsInWall,
  planFractionToMm,
  planMmToFraction,
  planOriginOf,
  clearPlanOrigin,
  replaceSchemeImage,
  schemeObjectKindUsage,
  schemeObjectKindsInOrder,
  schemeObjectTopMm,
  schemeObjectsOnScheme,
  setMarkWall,
  setPlanOrigin,
  setPlanScale,
  setRoomWallHeight,
  setSchemeWallHeight,
  updateOpening,
  updateSchemeObject,
  updateWall,
  wallHeightOf,
  wallLengthMm,
  wallsOnScheme,
} from "../src/model.js";
import { applyPlanEdit } from "../src/panels/schemes.js";
import { identityTransform, rotateTransform, cropTransform, transformPoint } from "../src/imagePrep.js";
import { packProject, unpackProject } from "../src/projectFile.js";
import { mergeProjects } from "../src/merge.js";
import { strings } from "../src/strings.js";

// План 1200 × 800 точек, откалиброванный так, что в метре ровно 100 точек:
// половина ширины (600 точек) объявлена шестью метрами. Тогда миллиметр — это
// десятая доля точки, и перевод в доли считается в уме.
function planProject() {
  let project = createProject();
  const added = addScheme(project, { name: "1 этаж", imageId: "plan-1", width: 1200, height: 800 });
  project = added.project;
  const schemeId = added.scheme.id;
  project = setPlanScale(project, schemeId, { a: { x: 0.1, y: 0.5 }, b: { x: 0.6, y: 0.5 }, meters: 6 }).project;
  return { project, schemeId };
}

// Чертёж комнаты: четыре стены по 4 × 3 метра, начало координат в левом
// верхнем углу плана.
function drawnRoom() {
  const base = planProject();
  let project = setPlanOrigin(base.project, base.schemeId, { at: { x: 0.1, y: 0.1 }, turn: 0 }).project;
  const corners = [
    [{ x: 0, y: 0 }, { x: 4000, y: 0 }],
    [{ x: 4000, y: 0 }, { x: 4000, y: 3000 }],
    [{ x: 4000, y: 3000 }, { x: 0, y: 3000 }],
    [{ x: 0, y: 3000 }, { x: 0, y: 0 }],
  ];
  const wallIds = [];
  for (const [aMm, bMm] of corners) {
    const added = addWall(project, { schemeId: base.schemeId, aMm, bMm, thicknessMm: 100 });
    project = added.project;
    wallIds.push(added.wall.id);
  }
  project = setSchemeWallHeight(project, base.schemeId, 2700).project;
  return { project, schemeId: base.schemeId, wallIds };
}

function errorCode(fn) {
  try {
    fn();
  } catch (error) {
    return error.code;
  }
  return null;
}

// ——— единицы ——————————————————————————————————————————————————————————

test("стена заводится целыми миллиметрами, дробное на входе округляется", () => {
  const { project, schemeId } = planProject();
  const added = addWall(project, {
    schemeId,
    aMm: { x: 0, y: "0,4" },
    bMm: { x: 2999.6, y: 0 },
    thicknessMm: 100,
  });
  assert.deepEqual(added.wall.aMm, { x: 0, y: 0 });
  assert.deepEqual(added.wall.bMm, { x: 3000, y: 0 });
  assert.equal(added.wall.thicknessMm, 100);
  assert.equal(wallLengthMm(added.wall), 3000);
  assert.equal(wallsOnScheme(added.project, schemeId).length, 1);
});

test("отрицательная координата законна: начало отсчёта лежит внутри плана", () => {
  const { project, schemeId } = planProject();
  const added = addWall(project, { schemeId, aMm: { x: -2000, y: -500 }, bMm: { x: 0, y: -500 }, thicknessMm: 200 });
  assert.equal(added.wall.aMm.x, -2000);
  assert.equal(wallLengthMm(added.wall), 2000);
});

test("несуразные числа стены дают понятную ошибку, а не молчание", () => {
  const { project, schemeId } = planProject();
  const wall = { schemeId, aMm: { x: 0, y: 0 }, bMm: { x: 3000, y: 0 } };
  assert.equal(errorCode(() => addWall(project, { ...wall, thicknessMm: 0 })), "drawingMmNotPositive");
  assert.equal(errorCode(() => addWall(project, { ...wall, thicknessMm: -100 })), "drawingMmNotPositive");
  assert.equal(
    errorCode(() => addWall(project, { ...wall, thicknessMm: WALL_THICKNESS_MM_MAX + 1 })),
    "wallThicknessTooBig",
  );
  assert.equal(errorCode(() => addWall(project, { ...wall, thicknessMm: "толстая" })), "drawingMmInvalid");
  assert.equal(
    errorCode(() => addWall(project, { schemeId, aMm: { x: 0, y: 0 }, bMm: { x: 0, y: 0 }, thicknessMm: 100 })),
    "wallPointsSame",
  );
  assert.equal(
    errorCode(() =>
      addWall(project, { schemeId, aMm: { x: 0, y: 0 }, bMm: { x: DRAWING_MM_MAX + 1, y: 0 }, thicknessMm: 100 }),
    ),
    "drawingMmTooBig",
  );
  // Каждая ошибка — русская строка словаря, а не склеенный код.
  for (const code of ["drawingMmNotPositive", "wallThicknessTooBig", "drawingMmInvalid", "wallPointsSame"]) {
    assert.equal(typeof strings.errors[code], "string");
  }
});

test("drawingMmValue — одна дверь для чисел чертежа: запятая, округление, потолок", () => {
  assert.equal(drawingMmValue("2700"), 2700);
  assert.equal(drawingMmValue("2,7"), 3);
  assert.equal(drawingMmValue(-0.4), 0);
  assert.equal(errorCode(() => drawingMmValue("")), "drawingMmInvalid");
  assert.equal(errorCode(() => drawingMmValue(null)), "drawingMmInvalid");
  assert.equal(errorCode(() => drawingMmValue(Infinity)), "drawingMmInvalid");
});

// ——— начало координат и мост к долям —————————————————————————————————

test("без калибровки или без привязки чертёж на подложку не ложится", () => {
  const { project, schemeId } = planProject();
  assert.equal(planOriginOf(project, schemeId), null);
  assert.equal(planMmToFraction(project, schemeId, { x: 1000, y: 0 }), null);
  const anchored = setPlanOrigin(project, schemeId, { at: { x: 0.1, y: 0.1 }, turn: 0 }).project;
  assert.deepEqual(planOriginOf(anchored, schemeId), { at: { x: 0.1, y: 0.1 }, turn: 0 });
  // Схема без масштаба: привязка есть, пикселей на метр нет.
  let noScale = createProject();
  const added = addScheme(noScale, { name: "без масштаба", imageId: "p", width: 1000, height: 1000 });
  noScale = setPlanOrigin(added.project, added.scheme.id, { at: { x: 0, y: 0 }, turn: 0 }).project;
  assert.equal(planMmToFraction(noScale, added.scheme.id, { x: 1000, y: 0 }), null);
});

test("мост между системами: миллиметры в доли и обратно без потери", () => {
  const { project, schemeId } = drawnRoom();
  // Метр — сто точек плана, план шириной 1200: метр это доля 1/12.
  const point = planMmToFraction(project, schemeId, { x: 1200, y: 800 });
  assert.ok(Math.abs(point.x - (0.1 + 120 / 1200)) < 1e-9, "доля по ширине: " + point.x);
  assert.ok(Math.abs(point.y - (0.1 + 80 / 800)) < 1e-9, "доля по высоте: " + point.y);
  assert.deepEqual(planFractionToMm(project, schemeId, point), { x: 1200, y: 800 });
  assert.deepEqual(planFractionToMm(project, schemeId, { x: 0.1, y: 0.1 }), { x: 0, y: 0 });
});

test("поворот подложки не трогает ни одной стены, а чертёж поворачивается с ней", () => {
  const { project, schemeId } = drawnRoom();
  const before = JSON.stringify(project.walls);
  const spot = { x: 2000, y: 1000 };
  const was = planMmToFraction(project, schemeId, spot);

  const transform = rotateTransform(identityTransform(), 90);
  const turned = applyPlanEdit(project, schemeId, { imageId: "plan-1", width: 800, height: 1200, transform });

  assert.equal(JSON.stringify(turned.project.walls), before, "миллиметры стен уехали при повороте плана");
  assert.equal(planOriginOf(turned.project, schemeId).turn, 90);
  // Та же точка чертежа лежит на том же месте картинки: доли пересчитаны тем
  // же преобразованием, что точки меток.
  const expected = { x: 1 - was.y, y: was.x };
  const now = planMmToFraction(turned.project, schemeId, spot);
  assert.ok(Math.abs(now.x - expected.x) < 1e-9, "x после поворота: " + now.x + " вместо " + expected.x);
  assert.ok(Math.abs(now.y - expected.y) < 1e-9, "y после поворота: " + now.y + " вместо " + expected.y);
});

test("четыре поворота по кругу возвращают чертёж туда, где он был", () => {
  const { project, schemeId } = drawnRoom();
  let next = project;
  let size = { width: 1200, height: 800 };
  for (let step = 0; step < 4; step += 1) {
    size = { width: size.height, height: size.width };
    next = applyPlanEdit(next, schemeId, {
      imageId: "plan-1",
      width: size.width,
      height: size.height,
      transform: rotateTransform(identityTransform(), 90),
    }).project;
  }
  const was = planOriginOf(project, schemeId);
  const now = planOriginOf(next, schemeId);
  assert.equal(now.turn, was.turn, "четверти оборота не сошлись — а они целые и сходиться обязаны");
  // Доля, в отличие от четверти оборота, точного круга не даёт: `1 − 0,1`
  // и обратно оставляет 0,09999999999999998 (ADR 002 платит этим за
  // независимость от разрешения). Миллиметры стен, наоборот, целы точно —
  // ровно за это чертёж и живёт в них.
  assert.ok(Math.abs(now.at.x - was.at.x) < 1e-12, "привязка уехала: " + now.at.x);
  assert.ok(Math.abs(now.at.y - was.at.y) < 1e-12, "привязка уехала: " + now.at.y);
  assert.equal(JSON.stringify(next.walls), JSON.stringify(project.walls));
});

test("обрезка не теряет начало координат, даже если оно осталось за рамкой", () => {
  const { project, schemeId } = drawnRoom();
  const before = JSON.stringify(project.walls);
  const spot = { x: 2000, y: 0 };
  const was = planMmToFraction(project, schemeId, spot);
  // Рамка отрезает верх плана: отрезок калибровки (y = 0,5) внутри, а начало
  // координат чертежа (y = 0,1) — снаружи.
  const transform = cropTransform(identityTransform(), { x: 0.05, y: 0.3, width: 0.95, height: 0.7 });
  const result = applyPlanEdit(project, schemeId, { imageId: "plan-1", width: 1140, height: 560, transform });
  assert.equal(result.scaleLost, false, "калибровка потерялась — проверять было бы нечего");
  const origin = planOriginOf(result.project, schemeId);
  assert.ok(origin, "привязка пропала при обрезке");
  assert.ok(origin.at.y < 0, "начало координат прижали к краю — уехал бы весь чертёж: " + origin.at.y);
  assert.equal(JSON.stringify(result.project.walls), before);
  // Точка чертежа осталась на том же месте картинки — там, куда её переносит
  // то же преобразование, что точки меток.
  const expected = transformPoint(was, transform);
  const now = planMmToFraction(result.project, schemeId, spot);
  assert.ok(Math.abs(now.x - expected.x) < 1e-9, "x после обрезки: " + now.x + " вместо " + expected.x);
  assert.ok(Math.abs(now.y - expected.y) < 1e-9, "y после обрезки: " + now.y + " вместо " + expected.y);
});

test("замена подложки снимает привязку, но чертёж цел до миллиметра", () => {
  const { project, schemeId } = drawnRoom();
  const before = JSON.stringify(project.walls);
  const result = replaceSchemeImage(project, schemeId, { imageId: "plan-2", width: 2400, height: 1600 });
  assert.equal(result.originDropped, true);
  assert.equal(result.scaleDropped, true);
  assert.equal(planOriginOf(result.project, schemeId), null);
  assert.equal(
    Object.prototype.hasOwnProperty.call(result.project.schemes[0], "origin"),
    false,
    "поле привязки обнулили вместо того, чтобы убрать",
  );
  assert.equal(JSON.stringify(result.project.walls), before);
});

test("снятие привязки убирает поле, а повторное снятие ничего не правит", () => {
  const { project, schemeId } = drawnRoom();
  const cleared = clearPlanOrigin(project, schemeId);
  assert.equal(cleared.cleared, true);
  assert.equal(Object.prototype.hasOwnProperty.call(cleared.scheme, "origin"), false);
  const again = clearPlanOrigin(cleared.project, schemeId);
  assert.equal(again.cleared, false);
  assert.equal(again.project, cleared.project, "правки не было, а объект подменили");
});

test("привязка принимает только четверти оборота и точку", () => {
  const { project, schemeId } = planProject();
  assert.equal(errorCode(() => setPlanOrigin(project, schemeId, { at: { x: 0, y: 0 }, turn: 45 })), "originTurnUnknown");
  assert.equal(errorCode(() => setPlanOrigin(project, schemeId, { at: null })), "originPointInvalid");
});

test("схема без подложки живёт, и размер у неё — габарит чертежа", () => {
  let project = createProject();
  const added = addScheme(project, { name: "от руки" });
  project = added.project;
  assert.equal(added.scheme.imageId, null);
  assert.equal(added.scheme.width, 0);
  assert.equal(drawingBoundsMm(project, added.scheme.id), null, "не нарисовано ничего, а габарит нашёлся");
  project = addWall(project, {
    schemeId: added.scheme.id,
    aMm: { x: -500, y: 0 },
    bMm: { x: 3500, y: 0 },
    thicknessMm: 100,
  }).project;
  project = addWall(project, {
    schemeId: added.scheme.id,
    aMm: { x: 3500, y: 0 },
    bMm: { x: 3500, y: 2500 },
    thicknessMm: 100,
  }).project;
  assert.deepEqual(drawingBoundsMm(project, added.scheme.id), {
    minX: -500,
    minY: 0,
    maxX: 3500,
    maxY: 2500,
    widthMm: 4000,
    heightMm: 2500,
  });
  // Подложки нет — моста к долям тоже нет, и показывать чертёж поверх картинки
  // нечем. Это и есть зона таска 126.
  assert.equal(planMmToFraction(project, added.scheme.id, { x: 0, y: 0 }), null);
});

// ——— проёмы ———————————————————————————————————————————————————————————

test("проём живёт в стене и едет вместе с ней", () => {
  const { project, wallIds } = drawnRoom();
  const added = addOpening(project, {
    wallId: wallIds[0],
    kind: "window",
    atMm: 1000,
    widthMm: 1500,
    heightMm: 1400,
    heightAboveFloorMm: 900,
  });
  assert.equal(added.opening.wallId, wallIds[0]);
  assert.equal(added.opening.atMm, 1000);
  assert.equal(openingsInWall(added.project, wallIds[0]).length, 1);
  // Двинули конец стены — проём остался на своём отступе от начала.
  const moved = updateWall(added.project, wallIds[0], { bMm: { x: 3800, y: 0 } });
  assert.equal(openingsInWall(moved.project, wallIds[0])[0].atMm, 1000);
  assert.equal(wallLengthMm(findWall(moved.project, wallIds[0])), 3800);
});

test("проёмы стены перечисляются вдоль неё, а не в порядке набивки", () => {
  const { project, wallIds } = drawnRoom();
  let next = addOpening(project, { wallId: wallIds[0], kind: "window", atMm: 2500, widthMm: 900, heightMm: 1400, heightAboveFloorMm: 900 }).project;
  next = addOpening(next, { wallId: wallIds[0], kind: "door", atMm: 200, widthMm: 900, heightMm: 2100 }).project;
  assert.deepEqual(
    openingsInWall(next, wallIds[0]).map((opening) => opening.atMm),
    [200, 2500],
  );
});

test("проём шире стены, за её концом и внахлёст с соседом — три разные ошибки", () => {
  const { project, wallIds } = drawnRoom();
  const wallId = wallIds[0];
  assert.equal(
    errorCode(() => addOpening(project, { wallId, kind: "window", atMm: 0, widthMm: 5000, heightMm: 1400 })),
    "openingWiderThanWall",
  );
  assert.equal(
    errorCode(() => addOpening(project, { wallId, kind: "window", atMm: 3500, widthMm: 1000, heightMm: 1400 })),
    "openingOutsideWall",
  );
  const first = addOpening(project, { wallId, kind: "window", atMm: 1000, widthMm: 1500, heightMm: 1400, heightAboveFloorMm: 900 });
  assert.equal(
    errorCode(() => addOpening(first.project, { wallId, kind: "door", atMm: 2000, widthMm: 900, heightMm: 2100 })),
    "openingsOverlap",
  );
  // Встык — не внахлёст: проём от 2500 законен.
  const second = addOpening(first.project, { wallId, kind: "door", atMm: 2500, widthMm: 900, heightMm: 2100 });
  assert.equal(openingsInWall(second.project, wallId).length, 2);
});

test("окно выше потолка не проходит, а без высоты у схемы сверять нечего", () => {
  const { project, schemeId, wallIds } = drawnRoom();
  assert.equal(
    errorCode(() =>
      addOpening(project, { wallId: wallIds[0], kind: "window", atMm: 0, widthMm: 1000, heightMm: 1400, heightAboveFloorMm: 1500 }),
    ),
    "openingAboveHeight",
  );
  const noHeight = setSchemeWallHeight(project, schemeId, null).project;
  const added = addOpening(noHeight, {
    wallId: wallIds[0],
    kind: "window",
    atMm: 0,
    widthMm: 1000,
    heightMm: 1400,
    heightAboveFloorMm: 1500,
  });
  assert.equal(added.opening.heightAboveFloorMm, 1500);
});

test("сторона открывания есть у двери и только у неё", () => {
  const { project, wallIds } = drawnRoom();
  const door = addOpening(project, { wallId: wallIds[0], kind: "door", atMm: 100, widthMm: 900, heightMm: 2100 });
  assert.equal(door.opening.hinge, OPENING_HINGES[0]);
  assert.equal(door.opening.swing, OPENING_SWINGS[0]);
  const other = addOpening(project, {
    wallId: wallIds[0],
    kind: "door",
    atMm: 100,
    widthMm: 900,
    heightMm: 2100,
    hinge: "end",
    swing: "right",
  });
  assert.deepEqual([other.opening.hinge, other.opening.swing], ["end", "right"]);

  const window = addOpening(project, { wallId: wallIds[0], kind: "window", atMm: 100, widthMm: 900, heightMm: 1400, heightAboveFloorMm: 900 });
  assert.equal(Object.prototype.hasOwnProperty.call(window.opening, "hinge"), false);
  assert.equal(
    errorCode(() =>
      addOpening(project, { wallId: wallIds[0], kind: "window", atMm: 100, widthMm: 900, heightMm: 1400, hinge: "start" }),
    ),
    "openingSwingOnlyDoor",
  );
  assert.equal(
    errorCode(() => addOpening(project, { wallId: wallIds[0], kind: "door", atMm: 100, widthMm: 900, heightMm: 2100, hinge: "внутрь" })),
    "openingHingeUnknown",
  );
  assert.equal(
    errorCode(() => addOpening(project, { wallId: wallIds[0], kind: "door", atMm: 100, widthMm: 900, heightMm: 2100, swing: "наружу" })),
    "openingSwingUnknown",
  );
  assert.equal(errorCode(() => addOpening(project, { wallId: wallIds[0], kind: "люк", atMm: 0, widthMm: 900, heightMm: 2100 })), "openingKindUnknown");
  assert.deepEqual(OPENING_KINDS, ["window", "door", "opening", "arch"]);
});

test("дверь стала окном — сторона открывания убирается, а не остаётся врать", () => {
  const { project, wallIds } = drawnRoom();
  const door = addOpening(project, { wallId: wallIds[0], kind: "door", atMm: 100, widthMm: 900, heightMm: 2100, swing: "right" });
  const changed = updateOpening(door.project, door.opening.id, { kind: "window", heightAboveFloorMm: 900, heightMm: 1400 });
  assert.equal(changed.opening.kind, "window");
  assert.equal(Object.prototype.hasOwnProperty.call(changed.opening, "swing"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(changed.opening, "hinge"), false);
  // И обратно: окно стало дверью — сторона появилась со умолчанием.
  const back = updateOpening(changed.project, door.opening.id, { kind: "door", heightAboveFloorMm: 0, heightMm: 2100 });
  assert.equal(back.opening.swing, OPENING_SWINGS[0]);
});

test("укоротить стену под проёмом нельзя, а удалить её можно — проём уйдёт с ней", () => {
  const { project, wallIds } = drawnRoom();
  const added = addOpening(project, { wallId: wallIds[0], kind: "door", atMm: 2500, widthMm: 900, heightMm: 2100 });
  assert.equal(
    errorCode(() => updateWall(added.project, wallIds[0], { bMm: { x: 2000, y: 0 } })),
    "openingOutsideWall",
  );
  const removed = deleteWall(added.project, wallIds[0]);
  const schemeOfWall = removed.deleted.schemeId;
  assert.equal(removed.project.openings.length, 0);
  assert.equal(wallsOnScheme(removed.project, schemeOfWall).length, 3);
  // Проём удаляется и сам по себе — стена при этом остаётся.
  const single = deleteOpening(added.project, added.opening.id);
  assert.equal(single.project.openings.length, 0);
  assert.equal(wallsOnScheme(single.project, schemeOfWall).length, 4);
  // А после его удаления стену можно и укоротить.
  assert.equal(updateWall(single.project, wallIds[0], { bMm: { x: 2000, y: 0 } }).wall.bMm.x, 2000);
});

test("опустить потолок под уже стоящим окном модель не даёт", () => {
  const { project, schemeId, wallIds } = drawnRoom();
  const added = addOpening(project, {
    wallId: wallIds[0],
    kind: "window",
    atMm: 0,
    widthMm: 1500,
    heightMm: 1400,
    heightAboveFloorMm: 900,
  });
  assert.equal(errorCode(() => setSchemeWallHeight(added.project, schemeId, 2000)), "openingAboveHeight");
  assert.equal(setSchemeWallHeight(added.project, schemeId, 2400).scheme.wallHeightMm, 2400);
});

// ——— высоты ———————————————————————————————————————————————————————————

test("высота общая у схемы, у помещения — своя, у объекта прежней разметки — никакой", () => {
  const base = planProject();
  let project = base.project;
  const room = addRoom(project, { name: "Санузел" });
  project = room.project;
  assert.equal(wallHeightOf(project, { schemeId: base.schemeId }), null);
  project = setSchemeWallHeight(project, base.schemeId, 2700).project;
  assert.equal(wallHeightOf(project, { schemeId: base.schemeId }), 2700);
  assert.equal(wallHeightOf(project, { schemeId: base.schemeId, roomId: room.room.id }), 2700);
  project = setRoomWallHeight(project, room.room.id, 2500).project;
  assert.equal(wallHeightOf(project, { schemeId: base.schemeId, roomId: room.room.id }), 2500);
  assert.equal(wallHeightOf(project, { schemeId: base.schemeId }), 2700, "переопределение комнаты перебило схему");
  // Пустое значение убирает поле, а не пишет ноль.
  const cleared = setRoomWallHeight(project, room.room.id, "");
  assert.equal(Object.prototype.hasOwnProperty.call(cleared.room, "wallHeightMm"), false);
  assert.equal(wallHeightOf(cleared.project, { schemeId: base.schemeId, roomId: room.room.id }), 2700);
  assert.equal(setRoomWallHeight(cleared.project, room.room.id, null).changed, false);
  assert.equal(errorCode(() => setSchemeWallHeight(project, base.schemeId, 0)), "drawingMmNotPositive");
  assert.equal(errorCode(() => setSchemeWallHeight(project, base.schemeId, 200000)), "drawingHeightTooBig");
});

// ——— объекты схемы ————————————————————————————————————————————————————

test("справочник видов заводится по первой надобности, а не при открытии", () => {
  const { project } = planProject();
  assert.equal(Object.prototype.hasOwnProperty.call(project, "schemeObjectKinds"), false);
  assert.deepEqual(schemeObjectKindsInOrder(project), []);
  const first = ensureSchemeObjectKinds(project);
  assert.equal(first.added, true);
  const names = schemeObjectKindsInOrder(first.project).map((kind) => kind.name);
  assert.deepEqual(names, [
    strings.schemeObjectKinds.column,
    strings.schemeObjectKinds.niche,
    strings.schemeObjectKinds.duct,
    strings.schemeObjectKinds.stairs,
    strings.schemeObjectKinds.panel,
    strings.schemeObjectKinds.radiator,
    strings.schemeObjectKinds.counter,
    strings.schemeObjectKinds.plumbing,
    strings.schemeObjectKinds.cabinet,
  ]);
  // Второй раз заводить нечего — тот же объект по ссылке, без правки времени.
  const again = ensureSchemeObjectKinds(first.project);
  assert.equal(again.added, false);
  assert.equal(again.project, first.project);
  // Свой вид добавляется, как тип меток, а не правкой кода.
  const mine = addSchemeObjectKind(first.project, { name: "Инсталляция" });
  assert.equal(schemeObjectKindsInOrder(mine.project).length, 10);
  assert.equal(errorCode(() => addSchemeObjectKind(first.project, { name: "  " })), "nameRequired");
});

test("радиатор и столешница выражают то, ради чего заведены", () => {
  const base = drawnRoom();
  let project = ensureSchemeObjectKinds(base.project).project;
  const kindOf = (name) => schemeObjectKindsInOrder(project).find((kind) => kind.name === name).id;

  // Радиатор под окном: своя высота и высота от пола — иначе на развёртке он
  // окажется там же, где розетка.
  const radiator = addSchemeObject(project, {
    schemeId: base.schemeId,
    kindId: kindOf(strings.schemeObjectKinds.radiator),
    shape: "rect",
    atMm: { x: 1800, y: 60 },
    widthMm: 1200,
    depthMm: 80,
    turnDeg: 0,
    heightMm: 500,
    heightAboveFloorMm: 150,
  });
  project = radiator.project;
  assert.equal(schemeObjectTopMm(radiator.schemeObject), 650);

  // Столешница — полоса по стене: ломаная с поворотом и одной глубиной.
  const counter = addSchemeObject(project, {
    schemeId: base.schemeId,
    kindId: kindOf(strings.schemeObjectKinds.counter),
    shape: "polyline",
    pointsMm: [{ x: 0, y: 300 }, { x: 2400, y: 300 }, { x: 2400, y: 1800 }],
    depthMm: 600,
    heightMm: 900,
    heightAboveFloorMm: 0,
  });
  project = counter.project;
  // Верх столешницы — та самая высота, от которой отмеряют розетки над ней.
  assert.equal(schemeObjectTopMm(counter.schemeObject), 900);
  assert.equal(counter.schemeObject.depthMm, 600);
  assert.equal(schemeObjectsOnScheme(project, base.schemeId).length, 2);

  // Колонна во всю высоту помещения: высота не задана, и выдумывать её нельзя.
  const column = addSchemeObject(project, {
    schemeId: base.schemeId,
    kindId: kindOf(strings.schemeObjectKinds.column),
    shape: "rect",
    atMm: { x: 2000, y: 1500 },
    widthMm: 400,
    depthMm: 400,
    heightMm: "",
  });
  assert.equal(column.schemeObject.heightMm, null);
  assert.equal(schemeObjectTopMm(column.schemeObject), null);
});

test("повёрнутый прямоугольник входит в габарит чертежа своими углами", () => {
  const base = drawnRoom();
  let project = ensureSchemeObjectKinds(base.project).project;
  const kindId = schemeObjectKindsInOrder(project)[0].id;
  project = addSchemeObject(project, {
    schemeId: base.schemeId,
    kindId,
    shape: "rect",
    atMm: { x: 0, y: 0 },
    widthMm: 1000,
    depthMm: 1000,
    turnDeg: 45,
    heightMm: 2000,
  }).project;
  const bounds = drawingBoundsMm(project, base.schemeId);
  // Квадрат 1000 × 1000, повёрнутый на 45°, высовывается за ноль на полдиагонали.
  assert.equal(bounds.minX, -707);
  assert.equal(bounds.minY, -707);
});

test("объект схемы правится, меняет форму и не тащит поля прежней", () => {
  const base = drawnRoom();
  let project = ensureSchemeObjectKinds(base.project).project;
  const kindId = schemeObjectKindsInOrder(project)[0].id;
  const added = addSchemeObject(project, {
    schemeId: base.schemeId,
    kindId,
    shape: "rect",
    atMm: { x: 1000, y: 1000 },
    widthMm: 600,
    depthMm: 600,
    heightMm: 2500,
  });
  const turned = updateSchemeObject(added.project, added.schemeObject.id, { turnDeg: 390 });
  assert.equal(turned.schemeObject.turnDeg, 30, "поворот не приведён к одному обороту");
  const line = updateSchemeObject(turned.project, added.schemeObject.id, {
    shape: "polyline",
    pointsMm: [{ x: 0, y: 0 }, { x: 1000, y: 0 }],
    depthMm: 300,
  });
  assert.equal(Object.prototype.hasOwnProperty.call(line.schemeObject, "atMm"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(line.schemeObject, "turnDeg"), false);
  assert.equal(line.schemeObject.heightMm, 2500, "высота потерялась при смене формы");
  assert.equal(
    errorCode(() => updateSchemeObject(line.project, added.schemeObject.id, { shape: "круг" })),
    "schemeObjectShapeUnknown",
  );
  assert.equal(
    errorCode(() =>
      updateSchemeObject(line.project, added.schemeObject.id, { shape: "polyline", pointsMm: [{ x: 0, y: 0 }], depthMm: 300 }),
    ),
    "schemeObjectShortLine",
  );
  assert.deepEqual(SCHEME_OBJECT_SHAPES, ["rect", "polyline"]);
  const gone = deleteSchemeObject(line.project, added.schemeObject.id);
  assert.equal(schemeObjectsOnScheme(gone.project, base.schemeId).length, 0);
});

test("вид, которым пользуются, не удаляется — как тип меток", () => {
  const base = drawnRoom();
  let project = ensureSchemeObjectKinds(base.project).project;
  const kindId = schemeObjectKindsInOrder(project)[0].id;
  project = addSchemeObject(project, {
    schemeId: base.schemeId,
    kindId,
    shape: "rect",
    atMm: { x: 0, y: 0 },
    widthMm: 400,
    depthMm: 400,
  }).project;
  assert.equal(schemeObjectKindUsage(project, kindId), 1);
  assert.equal(errorCode(() => deleteSchemeObjectKind(project, kindId)), "schemeObjectKindInUse");
  const free = schemeObjectKindsInOrder(project)[1].id;
  const removed = deleteSchemeObjectKind(project, free);
  assert.equal(findSchemeObjectKind(removed.project, free), null);
  assert.equal(
    errorCode(() => addSchemeObject(project, { schemeId: base.schemeId, kindId: "нет такого", shape: "rect", atMm: { x: 0, y: 0 }, widthMm: 100, depthMm: 100 })),
    "schemeObjectKindNotFound",
  );
});

// ——— привязка метки к стене ————————————————————————————————————————————

test("привязка метки к стене необязательна и снимается без следа", () => {
  const base = drawnRoom();
  let project = base.project;
  const added = addMark(project, {
    schemeId: base.schemeId,
    typeId: project.markTypes[0].id,
    points: [{ x: 0.3, y: 0.2 }],
  });
  project = added.project;
  const markId = added.mark.id;
  assert.equal(markWall(added.mark), null, "у новой метки взялась привязка неизвестно откуда");
  assert.equal(Object.prototype.hasOwnProperty.call(added.mark, "wallId"), false);

  const bound = setMarkWall(project, markId, { wallId: base.wallIds[0], atMm: 1200 });
  assert.deepEqual(markWall(bound.mark), { wallId: base.wallIds[0], atMm: 1200 });

  const free = setMarkWall(bound.project, markId, null);
  assert.equal(markWall(free.mark), null);
  assert.equal(Object.prototype.hasOwnProperty.call(free.mark, "wallId"), false, "поле обнулили вместо того, чтобы убрать");
  assert.equal(Object.prototype.hasOwnProperty.call(free.mark, "wallAtMm"), false);
  assert.equal(setMarkWall(free.project, markId, null).changed, false);
});

test("привязка проверяет стену: своя схема, свой конец", () => {
  const base = drawnRoom();
  let project = base.project;
  const other = addScheme(project, { name: "2 этаж", imageId: "plan-2", width: 1200, height: 800 });
  project = other.project;
  const foreign = addWall(project, {
    schemeId: other.scheme.id,
    aMm: { x: 0, y: 0 },
    bMm: { x: 2000, y: 0 },
    thicknessMm: 100,
  });
  project = foreign.project;
  const mark = addMark(project, { schemeId: base.schemeId, typeId: project.markTypes[0].id, points: [{ x: 0.3, y: 0.2 }] });
  project = mark.project;
  assert.equal(
    errorCode(() => setMarkWall(project, mark.mark.id, { wallId: foreign.wall.id, atMm: 100 })),
    "wallOtherScheme",
  );
  assert.equal(
    errorCode(() => setMarkWall(project, mark.mark.id, { wallId: base.wallIds[0], atMm: 5000 })),
    "markWallAtOutside",
  );
  assert.equal(errorCode(() => setMarkWall(project, mark.mark.id, { wallId: "нет такой", atMm: 0 })), "wallNotFound");
  assert.equal(
    errorCode(() => setMarkWall(project, mark.mark.id, { wallId: base.wallIds[0], atMm: -10 })),
    "drawingMmNegative",
  );
});

test("стена ушла — привязка снялась, а метка осталась на месте", () => {
  const base = drawnRoom();
  let project = base.project;
  const mark = addMark(project, { schemeId: base.schemeId, typeId: project.markTypes[0].id, points: [{ x: 0.3, y: 0.2 }] });
  project = setMarkWall(mark.project, mark.mark.id, { wallId: base.wallIds[0], atMm: 500 }).project;
  const removed = deleteWall(project, base.wallIds[0]);
  const after = removed.project.marks.find((item) => item.id === mark.mark.id);
  assert.equal(markWall(after), null);
  assert.equal(Object.prototype.hasOwnProperty.call(after, "wallId"), false);
  assert.deepEqual(after.points, [{ x: 0.3, y: 0.2 }]);
});

test("удаление схемы уносит её чертёж целиком", () => {
  const base = drawnRoom();
  let project = ensureSchemeObjectKinds(base.project).project;
  project = addOpening(project, { wallId: base.wallIds[0], kind: "door", atMm: 100, widthMm: 900, heightMm: 2100 }).project;
  project = addSchemeObject(project, {
    schemeId: base.schemeId,
    kindId: schemeObjectKindsInOrder(project)[0].id,
    shape: "rect",
    atMm: { x: 0, y: 0 },
    widthMm: 400,
    depthMm: 400,
  }).project;
  const removed = deleteScheme(project, base.schemeId);
  assert.deepEqual(removed.project.walls, []);
  assert.deepEqual(removed.project.openings, []);
  assert.deepEqual(removed.project.schemeObjects, []);
  // Справочник видов — не чертёж: он остаётся, как остаётся справочник типов.
  assert.equal(schemeObjectKindsInOrder(removed.project).length, 9);
});

// ——— G68: объект без чертежа ———————————————————————————————————————————

const LEGACY_PATH = join(dirname(fileURLToPath(import.meta.url)), "legacy-project.json");
// Байты `project.json`, которые выдала **опубликованная сборка** (до таска
// 123): объект со схемой, калибровкой, комнатой и контуром, тремя метками,
// плашкой комментария, размерами, оборудованием и штампом. Сверка идёт с этим
// текстом, а не с тем, что сейчас соберёт `createProject`, — иначе проверка
// сравнивала бы новый код с самим собой.
const LEGACY_TEXT = readFileSync(LEGACY_PATH, "utf8").replace(/\n$/, "");

function legacyProject() {
  return JSON.parse(LEGACY_TEXT);
}

test("G68: объект прежней сборки доезжает через файл байт в байт", async () => {
  const project = legacyProject();
  const file = await packProject(project, new Map());
  const { project: loaded } = await unpackProject(file);
  assert.equal(JSON.stringify(loaded, null, 2), LEGACY_TEXT, "в объекте без чертежа завелись новые поля");
  for (const key of ["walls", "openings", "schemeObjects", "schemeObjectKinds"]) {
    assert.equal(Object.prototype.hasOwnProperty.call(loaded, key), false, "пустой список уехал в файл: " + key);
  }
  assert.equal(Object.prototype.hasOwnProperty.call(loaded.schemes[0], "origin"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(loaded.schemes[0], "wallHeightMm"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(loaded.marks[0], "wallId"), false);
});

test("G68: чертёж ничего не знает об объекте прежней сборки", () => {
  const project = legacyProject();
  const schemeId = project.schemes[0].id;
  assert.deepEqual(wallsOnScheme(project, schemeId), []);
  assert.deepEqual(schemeObjectsOnScheme(project, schemeId), []);
  assert.equal(planOriginOf(project, schemeId), null);
  assert.equal(wallHeightOf(project, { schemeId, roomId: project.rooms[0].id }), null);
  assert.equal(drawingBoundsMm(project, schemeId), null);
  assert.equal(markWall(project.marks[0]), null);
  // Поворот плана у такого объекта проходит ровно как раньше: привязки нет —
  // и заводить её не на чем.
  const turned = applyPlanEdit(project, schemeId, {
    imageId: "plan-1",
    width: 800,
    height: 1200,
    transform: rotateTransform(identityTransform(), 90),
  });
  assert.equal(Object.prototype.hasOwnProperty.call(turned.project.schemes[0], "origin"), false);
  assert.equal(turned.project.schemes[0].scale.meters, 6, "калибровка уехала");
});

test("G68: удаление схемы у объекта без чертежа не заводит пустых списков", () => {
  const project = legacyProject();
  const removed = deleteScheme(project, project.schemes[0].id);
  for (const key of ["walls", "openings", "schemeObjects"]) {
    assert.equal(Object.prototype.hasOwnProperty.call(removed.project, key), false, "завёлся пустой список " + key);
  }
});

test("G68: слияние двух одинаковых объектов прежней сборки молчит", () => {
  const ours = legacyProject();
  const theirs = legacyProject();
  const merged = mergeProjects(ours, theirs, legacyProject());
  assert.equal(merged.changed, false);
  assert.equal(merged.quiet, true);
  assert.deepEqual(merged.conflicts, []);
  assert.equal(JSON.stringify(merged.project, null, 2), LEGACY_TEXT, "слияние дописало объекту поля чертежа");
});

// ——— слияние чертежей двух напарников —————————————————————————————————

// Общий предок: объект с чертежом из одной стены и справочником видов.
function sharedDrawing() {
  const base = drawnRoom();
  const project = ensureSchemeObjectKinds(base.project).project;
  return { project, schemeId: base.schemeId, wallIds: base.wallIds };
}

function copyOf(project, updatedAt) {
  const copy = JSON.parse(JSON.stringify(project));
  if (updatedAt) copy.updatedAt = updatedAt;
  return copy;
}

function stamped(project, updatedAt) {
  return { ...project, updatedAt };
}

test("чертёж напарника не пропадает, когда у нас чертежа нет вовсе", () => {
  // Тот самый случай таска 121: коллекция, о которой слияние не знает, уходит
  // целиком и молча. Здесь у «нас» объект прежней разметки, у «них» — он же с
  // нарисованной комнатой.
  const plain = legacyProject();
  const schemeId = plain.schemes[0].id;
  let theirs = copyOf(plain);
  theirs = ensureSchemeObjectKinds(theirs).project;
  theirs = setPlanOrigin(theirs, schemeId, { at: { x: 0.1, y: 0.1 }, turn: 0 }).project;
  theirs = setSchemeWallHeight(theirs, schemeId, 2700).project;
  const wall = addWall(theirs, { schemeId, aMm: { x: 0, y: 0 }, bMm: { x: 4000, y: 0 }, thicknessMm: 200 });
  theirs = addOpening(wall.project, { wallId: wall.wall.id, kind: "door", atMm: 500, widthMm: 900, heightMm: 2100 }).project;
  theirs = addSchemeObject(theirs, {
    schemeId,
    kindId: schemeObjectKindsInOrder(theirs)[5].id,
    shape: "rect",
    atMm: { x: 2000, y: 100 },
    widthMm: 1200,
    depthMm: 80,
    heightMm: 500,
    heightAboveFloorMm: 150,
  }).project;

  const merged = mergeProjects(stamped(plain, "2026-10-09T10:00:00.000Z"), stamped(theirs, "2026-10-09T10:05:00.000Z"), plain);
  assert.equal(merged.project.walls.length, 1, "стена напарника пропала при слиянии");
  assert.equal(merged.project.openings.length, 1, "проём напарника пропал при слиянии");
  assert.equal(merged.project.schemeObjects.length, 1, "объект схемы напарника пропал при слиянии");
  assert.equal(schemeObjectKindsInOrder(merged.project).length, 9, "справочник видов не приехал");
  assert.deepEqual(merged.conflicts, []);
  // Привязка чертежа к подложке и высота — часть схемы, и едут вместе с ней.
  assert.deepEqual(planOriginOf(merged.project, schemeId), { at: { x: 0.1, y: 0.1 }, turn: 0 });
  assert.equal(wallHeightOf(merged.project, { schemeId }), 2700);
  // В отчёте у стены, проёма и объекта есть подлежащее, а не пустое место.
  const labels = merged.changes.map((change) => change.label);
  assert.ok(labels.includes(strings.subjects.wall), "стена в отчёте без подписи: " + labels.join(" | "));
  assert.ok(labels.includes(strings.subjects.opening));
  assert.ok(labels.includes(strings.subjects.schemeObject));
});

test("двое нарисовали разные стены — чертёж складывается без вопросов", () => {
  const { project: base, schemeId } = sharedDrawing();
  const ours = stamped(
    addWall(base, { schemeId, aMm: { x: 0, y: 1500 }, bMm: { x: 2000, y: 1500 }, thicknessMm: 100 }).project,
    "2026-10-09T10:00:00.000Z",
  );
  const theirs = stamped(
    addWall(copyOf(base), { schemeId, aMm: { x: 2000, y: 1500 }, bMm: { x: 4000, y: 1500 }, thicknessMm: 100 }).project,
    "2026-10-09T10:00:05.000Z",
  );
  const merged = mergeProjects(ours, theirs, base);
  assert.equal(merged.project.walls.length, 6);
  assert.equal(merged.counts.added, 1);
  assert.deepEqual(merged.conflicts, []);
});

test("одну стену правили с двух сторон — остаётся вариант того, кто правил позже", () => {
  const { project: base, wallIds } = sharedDrawing();
  const ours = stamped(updateWall(base, wallIds[0], { thicknessMm: 200 }).project, "2026-10-09T10:00:00.000Z");
  const theirs = stamped(updateWall(copyOf(base), wallIds[0], { thicknessMm: 380 }).project, "2026-10-09T10:05:00.000Z");
  const merged = mergeProjects(ours, theirs, base);
  assert.equal(findWall(merged.project, wallIds[0]).thicknessMm, 380);
  assert.equal(merged.conflicts.length, 1);
  assert.equal(merged.conflicts[0].code, "bothChanged");
  assert.equal(merged.conflicts[0].entity, "walls");
  assert.equal(merged.conflicts[0].label, strings.subjects.wall);
});

test("стену удалили, а в неё поставили окно — стена ушла, и о потере сказано вслух", () => {
  const { project: base, wallIds } = sharedDrawing();
  const ours = stamped(deleteWall(base, wallIds[0]).project, "2026-10-09T10:05:00.000Z");
  const theirs = stamped(
    addOpening(copyOf(base), { wallId: wallIds[0], kind: "window", atMm: 1000, widthMm: 1500, heightMm: 1400, heightAboveFloorMm: 900 }).project,
    "2026-10-09T10:00:00.000Z",
  );
  const merged = mergeProjects(ours, theirs, base);
  assert.equal(findWall(merged.project, wallIds[0]), null, "стену вернуло воскрешение ради проёма");
  assert.equal(merged.project.openings.length, 0);
  const dangling = merged.conflicts.filter((conflict) => conflict.entity === "openings");
  assert.equal(dangling.length, 1);
  assert.equal(dangling[0].code, "danglingRef");
  assert.equal(dangling[0].label, strings.subjects.opening);
});

test("правка стены важнее её удаления: проём напарника остаётся на месте", () => {
  const { project: base, wallIds } = sharedDrawing();
  // Мы стену удалили, а напарник её же подвинул — значит она ещё нужна.
  const ours = stamped(deleteWall(base, wallIds[0]).project, "2026-10-09T10:05:00.000Z");
  let theirs = updateWall(copyOf(base), wallIds[0], { bMm: { x: 4200, y: 0 } }).project;
  theirs = stamped(
    addOpening(theirs, { wallId: wallIds[0], kind: "door", atMm: 1000, widthMm: 900, heightMm: 2100 }).project,
    "2026-10-09T10:00:00.000Z",
  );
  const merged = mergeProjects(ours, theirs, base);
  assert.ok(findWall(merged.project, wallIds[0]), "стена исчезла, хотя её правили");
  assert.equal(merged.project.openings.length, 1);
  assert.ok(merged.conflicts.some((conflict) => conflict.code === "deletedHere" && conflict.entity === "walls"));
});

test("вид объекта удалён на одной стороне, а на другой им пользуются — вид возвращается", () => {
  const { project: base, schemeId } = sharedDrawing();
  const kindId = schemeObjectKindsInOrder(base)[5].id;
  const ours = stamped(deleteSchemeObjectKind(base, kindId).project, "2026-10-09T10:05:00.000Z");
  const theirs = stamped(
    addSchemeObject(copyOf(base), {
      schemeId,
      kindId,
      shape: "rect",
      atMm: { x: 1000, y: 100 },
      widthMm: 1200,
      depthMm: 80,
      heightMm: 500,
      heightAboveFloorMm: 150,
    }).project,
    "2026-10-09T10:00:00.000Z",
  );
  const merged = mergeProjects(ours, theirs, base);
  assert.equal(merged.project.schemeObjects.length, 1, "объект схемы унесло вместе с видом");
  assert.ok(findSchemeObjectKind(merged.project, kindId), "вид не вернулся");
  assert.ok(merged.conflicts.some((conflict) => conflict.code === "restoredRef" && conflict.entity === "schemeObjectKinds"));
});

test("схему удалили — её чертёж уходит с ней, а привязка метки снимается без новых полей", () => {
  const { project: base, schemeId, wallIds } = sharedDrawing();
  let withMark = addMark(base, { schemeId, typeId: base.markTypes[0].id, points: [{ x: 0.3, y: 0.2 }] });
  const markId = withMark.mark.id;
  const prepared = setMarkWall(withMark.project, markId, { wallId: wallIds[0], atMm: 700 }).project;

  // Мы удалили стену, напарник её не трогал — привязка метки должна уйти.
  const ours = stamped(deleteWall(prepared, wallIds[0]).project, "2026-10-09T10:05:00.000Z");
  const theirs = stamped(copyOf(prepared), "2026-10-09T10:00:00.000Z");
  const merged = mergeProjects(ours, theirs, prepared);
  const mark = merged.project.marks.find((item) => item.id === markId);
  assert.equal(markWall(mark), null);
  assert.equal(Object.prototype.hasOwnProperty.call(mark, "wallId"), false, "слияние обнулило поле вместо того, чтобы убрать");
  assert.equal(Object.prototype.hasOwnProperty.call(mark, "wallAtMm"), false);
});
