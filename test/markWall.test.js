// Метка знает свою стену (таск 128, последний этап G174).
//
// Здесь две разные проверки, и вторая важнее первой.
//
//   1. **Привязка ставится сама и остаётся правдой.** Поставил метку у стены —
//      привязалась, утащил в середину комнаты — снялась, подвинул стену —
//      пересчиталась. Привязку никто не правит руками, поэтому она обязана
//      совпадать с тем, что видно на плане, всегда.
//   2. **Хватает ли данных для развёртки.** Это главный вопрос таска, и ответ
//      на него — не «да», а стена с двумя метками, радиатором под окном и
//      дверью, из которой тест выписывает всё, что понадобится рисующему. Чего
//      не хватило — названо прямо здесь, в тесте, а не в отчёте: модель
//      молодая, и менять её дёшево именно сейчас.
import test from "node:test";
import assert from "node:assert/strict";

import {
  COMMENT_TYPE_ID,
  MARK_KIND_COMMENT,
  MARK_WALL_REACH_MM,
  addMark,
  addOpening,
  addScheme,
  addSchemeObject,
  addWall,
  applyMarkWalls,
  createProject,
  ensureSchemeObjectKinds,
  findSchemeObjectKind,
  findWall,
  labelOf,
  markDimensions,
  markOpeningHit,
  markWall,
  markWallBindable,
  markWallNear,
  markWallSide,
  openingsInWall,
  planFractionToMm,
  planMmToFraction,
  schemeObjectKindsInOrder,
  schemeObjectTopMm,
  schemeObjectsOnScheme,
  setMarkDimensions,
  setPlanOrigin,
  setPlanScale,
  setSchemeWallHeight,
  styleOf,
  updateWall,
  validate,
  schemeObjectCorners,
  segmentDistanceMm,
  wallHeightOf,
  wallLengthMm,
  wallVectors,
} from "../src/model.js";

// План 1200 × 800 точек, сто точек на метр, нуль чертежа в середине: та же
// сцена, что в тестах модели чертежа, мастерской и холста.
function planProject() {
  const added = addScheme(createProject(), { name: "1 этаж", imageId: "plan-1", width: 1200, height: 800 });
  let project = setPlanScale(added.project, added.scheme.id, {
    a: { x: 0.1, y: 0.5 },
    b: { x: 0.6, y: 0.5 },
    meters: 6,
  }).project;
  project = setPlanOrigin(project, added.scheme.id, { at: { x: 0.5, y: 0.5 }, turn: 0 }).project;
  return { project, schemeId: added.scheme.id };
}

function typeId(project, code) {
  return project.markTypes.find((type) => type.code === code).id;
}

// Метка ставится **миллиметрами чертежа** — так же, как её поставила бы рука
// на холсте: доли считает мост, а не тест.
function putMark(project, schemeId, code, pointMm, dimensions) {
  const point = planMmToFraction(project, schemeId, pointMm);
  assert.ok(point, "мост чертежа обязан работать: без него метку не поставить");
  const added = addMark(project, { schemeId, typeId: typeId(project, code), points: [point] });
  if (!dimensions) return { project: added.project, markId: added.mark.id };
  return { project: setMarkDimensions(added.project, added.mark.id, dimensions).project, markId: added.mark.id };
}

// Комната четыре на три метра: нижняя стена идёт слева направо, значит её
// «левая» сторона — наружу (вверх по экрану), правая — внутрь комнаты.
function room() {
  const base = planProject();
  let project = base.project;
  const corners = [
    [{ x: -2000, y: -1500 }, { x: 2000, y: -1500 }],
    [{ x: 2000, y: -1500 }, { x: 2000, y: 1500 }],
    [{ x: 2000, y: 1500 }, { x: -2000, y: 1500 }],
    [{ x: -2000, y: 1500 }, { x: -2000, y: -1500 }],
  ];
  const wallIds = [];
  for (const [aMm, bMm] of corners) {
    const added = addWall(project, { schemeId: base.schemeId, aMm, bMm, thicknessMm: 200 });
    project = added.project;
    wallIds.push(added.wall.id);
  }
  project = setSchemeWallHeight(project, base.schemeId, 2700).project;
  return { project, schemeId: base.schemeId, wallIds };
}

// ——— привязка ставится сама ———————————————————————————————————————————

test("метка у стены привязывается, метка посреди комнаты — нет", () => {
  const box = room();
  // Розетка в ста миллиметрах от грани нижней стены — на стене.
  const near = putMark(box.project, box.schemeId, "Р", { x: 0, y: 1300 });
  const bound = applyMarkWalls(near.project);
  assert.deepEqual(markWall(bound.project.marks.find((mark) => mark.id === near.markId)), {
    wallId: box.wallIds[2],
    atMm: 2000,
    toMm: null,
  });
  assert.deepEqual(bound.changed, [near.markId]);

  // Потолочный светильник посреди комнаты стены не имеет и иметь не должен.
  const middle = putMark(bound.project, box.schemeId, "Т", { x: 0, y: 0 });
  const after = applyMarkWalls(middle.project);
  assert.equal(markWall(after.project.marks.find((mark) => mark.id === middle.markId)), null);
});

test("порог меряется от грани стены, а не от её оси", () => {
  const box = room();
  // Нижняя стена: ось на y = 1500, толщина 200 — грань на 1400.
  const inside = putMark(box.project, box.schemeId, "Р", { x: 0, y: 1400 - MARK_WALL_REACH_MM + 10 });
  assert.ok(markWallNear(inside.project, inside.project.marks[0]), "в пределах порога — на стене");
  const outside = putMark(box.project, box.schemeId, "Р", { x: 0, y: 1400 - MARK_WALL_REACH_MM - 10 });
  assert.equal(markWallNear(outside.project, outside.project.marks[0]), null, "за порогом — не на стене");
});

test("спорят стены расстоянием: ближняя забирает метку", () => {
  const box = room();
  // Угол: метка ближе к нижней стене, чем к правой.
  const corner = putMark(box.project, box.schemeId, "Р", { x: 1700, y: 1350 });
  const bound = applyMarkWalls(corner.project);
  assert.equal(markWall(bound.project.marks[0]).wallId, box.wallIds[2], "нижняя стена ближе");
});

test("лента вдоль стены привязывается отрезком, а не точкой", () => {
  // Дыра таска 128, закрытая в 129: у линии два конца, и одним отступом их не
  // назвать — поэтому у привязки появился второй, `toMm`.
  const box = room();
  const line = addMark(box.project, {
    schemeId: box.schemeId,
    typeId: typeId(box.project, "ТР"),
    kind: "line",
    points: [
      planMmToFraction(box.project, box.schemeId, { x: -1500, y: 1350 }),
      planMmToFraction(box.project, box.schemeId, { x: 1500, y: 1350 }),
    ],
  });
  assert.equal(markWallBindable(line.mark), true);
  const bound = applyMarkWalls(line.project);
  const binding = markWall(bound.project.marks[0]);
  assert.equal(binding.wallId, box.wallIds[2]);
  // Нижняя стена идёт справа налево: конец ленты в x = −1500 это 3500 от её
  // начала, конец в x = 1500 — 500. Порядок сохранён тот, каким рисовали.
  assert.deepEqual({ at: binding.atMm, to: binding.toMm }, { at: 3500, to: 500 });
});

test("лента, уходящая от стены в комнату, не привязывается", () => {
  const box = room();
  const line = addMark(box.project, {
    schemeId: box.schemeId,
    typeId: typeId(box.project, "ТР"),
    kind: "line",
    points: [
      planMmToFraction(box.project, box.schemeId, { x: -1500, y: 1350 }),
      planMmToFraction(box.project, box.schemeId, { x: 1500, y: 0 }),
    ],
  });
  const bound = applyMarkWalls(line.project);
  assert.equal(markWall(bound.project.marks[0]), null, "один конец у стены — это не лента по стене");
});

test("плашка комментария не привязывается никогда", () => {
  const box = room();
  const plate = addMark(box.project, {
    schemeId: box.schemeId,
    typeId: COMMENT_TYPE_ID,
    kind: MARK_KIND_COMMENT,
    points: [planMmToFraction(box.project, box.schemeId, { x: 0, y: 1300 })],
  });
  assert.equal(markWallBindable(plate.mark), false, "надпись на чертеже — не изделие");
  const bound = applyMarkWalls(plate.project);
  assert.equal(bound.project, plate.project);
});

// ——— жизнь привязки ———————————————————————————————————————————————————

test("стену подвинули — расстояние пересчиталось", () => {
  const box = room();
  const put = putMark(box.project, box.schemeId, "Р", { x: 0, y: 1300 });
  let project = applyMarkWalls(put.project).project;
  assert.equal(markWall(project.marks[0]).atMm, 2000);
  // Нижняя стена уезжает на метр вправо: метка осталась на месте, а расстояние
  // от её угла стало другим.
  const wall = findWall(project, box.wallIds[2]);
  project = updateWall(project, wall.id, {
    aMm: { x: wall.aMm.x + 1000, y: wall.aMm.y },
    bMm: { x: wall.bMm.x + 1000, y: wall.bMm.y },
  }).project;
  project = applyMarkWalls(project).project;
  assert.equal(markWall(project.marks[0]).atMm, 3000, "отсчёт идёт от нового положения угла");
});

test("стену увели далеко — привязка снялась, а метка осталась где была", () => {
  const box = room();
  const put = putMark(box.project, box.schemeId, "Р", { x: 0, y: 1300 });
  let project = applyMarkWalls(put.project).project;
  const before = project.marks[0].points[0];
  const wall = findWall(project, box.wallIds[2]);
  project = updateWall(project, wall.id, {
    aMm: { x: wall.aMm.x, y: wall.aMm.y + 5000 },
    bMm: { x: wall.bMm.x, y: wall.bMm.y + 5000 },
  }).project;
  project = applyMarkWalls(project).project;
  assert.equal(markWall(project.marks[0]), null, "метка не может остаться «на стене» в пяти метрах от неё");
  assert.deepEqual(project.marks[0].points[0], before, "саму метку при этом никто не двигал");
});

test("стену укоротили из-под метки — привязка снялась", () => {
  const box = room();
  // Метку ставим не в углу: в углу её подхватила бы соседняя стена, и
  // проверка говорила бы про спор стен, а не про укорачивание.
  const put = putMark(box.project, box.schemeId, "Р", { x: 1000, y: 1300 });
  let project = applyMarkWalls(put.project).project;
  assert.ok(markWall(project.marks[0]));
  const wall = findWall(project, box.wallIds[2]);
  // Нижняя стена идёт справа налево; метка стоит у её конца `a`. Укорачиваем
  // именно оттуда: конец `a` уезжает к середине, и метка остаётся за стеной.
  project = updateWall(project, wall.id, { aMm: { x: 0, y: wall.aMm.y } }).project;
  project = applyMarkWalls(project).project;
  assert.equal(markWall(project.marks[0]), null);
});

test("второй прогон ничего не меняет — тот же объект по ссылке", () => {
  const box = room();
  const put = putMark(box.project, box.schemeId, "Р", { x: 0, y: 1300 });
  const once = applyMarkWalls(put.project);
  const twice = applyMarkWalls(once.project);
  assert.equal(twice.project, once.project);
  assert.deepEqual(twice.changed, []);
});

test("G68: у объекта без чертежа привязка не делает ничего", () => {
  const plain = addScheme(createProject(), { name: "фотография", imageId: "p", width: 1000, height: 800 });
  const put = addMark(plain.project, {
    schemeId: plain.scheme.id,
    typeId: typeId(plain.project, "Р"),
    points: [{ x: 0.5, y: 0.5 }],
  });
  const after = applyMarkWalls(put.project);
  assert.equal(after.project, put.project, "тот же объект по ссылке — ни шага истории, ни updatedAt");
  assert.deepEqual(after.changed, []);
  const mark = after.project.marks[0];
  assert.ok(!Object.prototype.hasOwnProperty.call(mark, "wallId"), "новых полей у метки не появилось");
  assert.ok(!Object.prototype.hasOwnProperty.call(mark, "wallAtMm"));
});

// ——— сторона стены ————————————————————————————————————————————————————

test("сторона считается, а не хранится, и зовётся как у двери", () => {
  const box = room();
  // Верхняя стена идёт слева направо: «слева» от направления — вверх по
  // экрану, то есть наружу комнаты; «справа» — внутрь.
  const inside = putMark(box.project, box.schemeId, "Р", { x: 0, y: -1300 });
  const bound = applyMarkWalls(inside.project).project;
  const mark = bound.marks[0];
  assert.equal(markWall(mark).wallId, box.wallIds[0]);
  assert.equal(markWallSide(bound, mark), "right", "внутри комнаты — справа от направления верхней стены");
  assert.ok(!Object.prototype.hasOwnProperty.call(mark, "wallSide"), "в объекте стороны нет — она производная");

  const outside = putMark(box.project, box.schemeId, "Р", { x: 0, y: -1700 });
  const other = applyMarkWalls(outside.project).project;
  assert.equal(markWallSide(other, other.marks[0]), "left", "снаружи — слева");
});

test("метка ровно на оси стены стороны не имеет — и не врёт, что имеет", () => {
  const box = room();
  const put = putMark(box.project, box.schemeId, "Р", { x: 0, y: -1500 });
  const bound = applyMarkWalls(put.project).project;
  assert.ok(markWall(bound.marks[0]), "привязка есть");
  assert.equal(markWallSide(bound, bound.marks[0]), null, "стороны нет, и выдумывать её нельзя");
});

// ——— метка в проёме ———————————————————————————————————————————————————

test("розетка в дверном проёме названа — при любой её высоте", () => {
  const box = room();
  let project = addOpening(box.project, {
    wallId: box.wallIds[2],
    kind: "door",
    atMm: 1500,
    widthMm: 900,
    heightMm: 2100,
    heightAboveFloorMm: 0,
  }).project;
  // Нижняя стена идёт справа налево: отступ 1500 от её конца `a` (x = 2000)
  // это x = 500.
  const put = putMark(project, box.schemeId, "Р", { x: 100, y: 1300 });
  project = applyMarkWalls(put.project).project;
  const mark = project.marks[0];
  assert.ok(markOpeningHit(project, mark), "проём от пола перекрывает стену во всю полосу");
  const found = validate(project).find((item) => item.code === "markInOpening");
  assert.ok(found, JSON.stringify(validate(project).map((item) => item.code)));
  assert.match(found.message, /Дверь/);
  assert.equal(found.kind, "warning", "это находка, а не поломка: иногда розетка у косяка и задумана");
});

test("под окном розетка в порядке, а в самом окне — находка", () => {
  const box = room();
  let project = addOpening(box.project, {
    wallId: box.wallIds[2],
    kind: "window",
    atMm: 1500,
    widthMm: 1400,
    heightMm: 1400,
    heightAboveFloorMm: 800,
  }).project;
  const under = putMark(project, box.schemeId, "Р", { x: 0, y: 1300 }, { heightAboveFloor: 300 });
  project = applyMarkWalls(under.project).project;
  assert.equal(markOpeningHit(project, project.marks[0]), null, "под подоконником розетке место");

  const inside = putMark(project, box.schemeId, "Р", { x: 0, y: 1300 }, { heightAboveFloor: 1200 });
  project = applyMarkWalls(inside.project).project;
  const mark = project.marks.find((item) => item.id === inside.markId);
  assert.ok(markOpeningHit(project, mark), "на высоте окна — находка");
});

test("высота не задана и проём над полом — молчим, а не гадаем", () => {
  const box = room();
  let project = addOpening(box.project, {
    wallId: box.wallIds[2],
    kind: "window",
    atMm: 1500,
    widthMm: 1400,
    heightMm: 1400,
    heightAboveFloorMm: 800,
  }).project;
  const put = putMark(project, box.schemeId, "Р", { x: 0, y: 1300 });
  project = applyMarkWalls(put.project).project;
  assert.equal(markOpeningHit(project, project.marks[0]), null);
});

test("G68: у объекта без чертежа находок про проёмы не бывает", () => {
  const plain = addScheme(createProject(), { name: "фотография", imageId: "p", width: 1000, height: 800 });
  const put = addMark(plain.project, {
    schemeId: plain.scheme.id,
    typeId: typeId(plain.project, "Р"),
    points: [{ x: 0.5, y: 0.5 }],
  });
  assert.ok(!validate(put.project).some((item) => item.code === "markInOpening"));
});

// ——— главный вопрос: хватает ли данных для развёртки ————————————————
//
// Сцена: нижняя стена комнаты, в ней окно и дверь, под окном радиатор, на
// стене две розетки на разной высоте. Тест выписывает всё, что понадобится
// рисующему развёртку, и проверяет каждую величину по отдельности. Чего не
// хватает — названо в самом тесте: там, где это увидят раньше отчёта.

function elevationScene() {
  const box = room();
  let project = box.project;
  const wallId = box.wallIds[2]; // нижняя стена, идёт от (2000, 1500) к (−2000, 1500)
  project = addOpening(project, {
    wallId,
    kind: "window",
    atMm: 600,
    widthMm: 1400,
    heightMm: 1400,
    heightAboveFloorMm: 800,
  }).project;
  project = addOpening(project, {
    wallId,
    kind: "door",
    atMm: 2600,
    widthMm: 900,
    heightMm: 2100,
    heightAboveFloorMm: 0,
    hinge: "start",
    swing: "right",
  }).project;
  // Радиатор под окном: середина окна по стене — 1300 мм от её конца `a`,
  // то есть x = 2000 − 1300 = 700.
  const kinds = ensureSchemeObjectKinds(project);
  project = kinds.project;
  const radiator = schemeObjectKindsInOrder(project).find((kind) => kind.name === "Радиатор");
  project = addSchemeObject(project, {
    schemeId: box.schemeId,
    kindId: radiator.id,
    shape: "rect",
    atMm: { x: 700, y: 1330 },
    widthMm: 1200,
    depthMm: 100,
    heightMm: 500,
    heightAboveFloorMm: 150,
  }).project;
  // Две розетки: одна у двери на 300, одна над радиатором на 600.
  const first = putMark(project, box.schemeId, "Р", { x: -1100, y: 1330 }, { heightAboveFloor: 300 });
  project = first.project;
  // Розетка над радиатором: верх радиатора на 650, розетка на 900 — так её и
  // ставят, чтобы вилка не упиралась в прибор.
  const second = putMark(project, box.schemeId, "Р", { x: 700, y: 1330 }, { heightAboveFloor: 900 });
  project = applyMarkWalls(second.project).project;
  return { project, schemeId: box.schemeId, wallId };
}

/**
 * Всё, что нужно рисующему развёртку одной стены, собранное **только из
 * публичных функций модели**. Если здесь что-то приходится выдумывать — это и
 * есть дыра в модели, и её видно прямо в этом коде.
 */
function elevationOf(project, schemeId, wallId) {
  const wall = findWall(project, wallId);
  const vectors = wallVectors(wall);
  return {
    lengthMm: wallLengthMm(wall),
    thicknessMm: wall.thicknessMm,
    // Высота берётся у схемы: помещения у стены нет — модель их не связывает
    // (ADR 008), и переопределение высоты комнаты до стены не доходит.
    heightMm: wallHeightOf(project, { schemeId }),
    openings: openingsInWall(project, wallId).map((opening) => ({
      kind: opening.kind,
      atMm: opening.atMm,
      widthMm: opening.widthMm,
      heightMm: opening.heightMm,
      floorMm: opening.heightAboveFloorMm,
      hinge: opening.hinge || null,
      swing: opening.swing || null,
    })),
    marks: project.marks
      .filter((mark) => {
        const binding = markWall(mark);
        return binding && binding.wallId === wallId;
      })
      .map((mark) => ({
        label: labelOf(project, mark.id),
        color: styleOf(project, mark.typeId).color,
        atMm: markWall(mark).atMm,
        heightMm: markDimensions(mark).heightAboveFloor,
        side: markWallSide(project, mark),
      }))
      .sort((first, second) => first.atMm - second.atMm),
    // Объекты к стене **не привязаны**: у `schemeObject` нет `wallId`, и
    // рисующий развёртку должен сам спроецировать их на стену. Арифметика
    // ровно та же, что у метки, — и то, что её приходится писать здесь,
    // названо в отчёте как находка, а не спрятано.
    objects: schemeObjectsOnScheme(project, schemeId)
      .map((object) => {
        const corners = schemeObjectCorners(object);
        const along = corners.map(
          (point) => (point.x - wall.aMm.x) * vectors.u.x + (point.y - wall.aMm.y) * vectors.u.y,
        );
        const gap = Math.min(...corners.map((point) => segmentDistanceMm(point, wall.aMm, wall.bMm)));
        if (gap - wall.thicknessMm / 2 > MARK_WALL_REACH_MM) return null;
        return {
          name: (findSchemeObjectKind(project, object.kindId) || {}).name || "",
          fromMm: Math.round(Math.min(...along)),
          toMm: Math.round(Math.max(...along)),
          floorMm: object.heightAboveFloorMm,
          topMm: schemeObjectTopMm(object),
        };
      })
      .filter(Boolean),
  };
}

test("развёртка стены собирается из того, что в модели уже есть", () => {
  const scene = elevationScene();
  const wall = elevationOf(scene.project, scene.schemeId, scene.wallId);

  // Сама стена: длина, толщина, высота.
  assert.equal(wall.lengthMm, 4000);
  assert.equal(wall.thicknessMm, 200);
  assert.equal(wall.heightMm, 2700);

  // Проёмы — вдоль стены и со всем, что нужно нарисовать их в разрезе.
  assert.deepEqual(wall.openings, [
    { kind: "window", atMm: 600, widthMm: 1400, heightMm: 1400, floorMm: 800, hinge: null, swing: null },
    { kind: "door", atMm: 2600, widthMm: 900, heightMm: 2100, floorMm: 0, hinge: "start", swing: "right" },
  ]);

  // Метки: где по стене, на какой высоте, с какой стороны и чем подписаны.
  assert.equal(wall.marks.length, 2);
  assert.deepEqual(
    wall.marks.map((mark) => ({ at: mark.atMm, height: mark.heightMm, side: mark.side })),
    // Нижняя стена идёт справа налево, поэтому «справа от направления» — это
    // внутрь комнаты. Слово то же, что у стороны открывания двери, и считается
    // оно от стены, а не от комнаты: помещения стена не знает.
    [
      { at: 1300, height: 900, side: "right" },
      { at: 3100, height: 300, side: "right" },
    ],
  );
  for (const mark of wall.marks) {
    assert.match(mark.label, /^Р\d+$/, "обозначение для подписи на развёртке есть");
    assert.match(mark.color, /^#/, "и цвет, которым его рисуют на плане");
  }

  // Радиатор: он попал на ту же стену и стоит ровно под окном.
  assert.equal(wall.objects.length, 1);
  const radiator = wall.objects[0];
  assert.equal(radiator.name, "Радиатор");
  assert.deepEqual({ from: radiator.fromMm, to: radiator.toMm }, { from: 700, to: 1900 });
  const window = wall.openings[0];
  assert.ok(
    radiator.fromMm >= window.atMm && radiator.toMm <= window.atMm + window.widthMm,
    "радиатор обязан оказаться под окном: " + JSON.stringify(radiator),
  );
  assert.equal(radiator.floorMm, 150);
  assert.equal(radiator.topMm, 650);

  // Розетка над радиатором — выше его верха, и это видно из тех же чисел.
  const above = wall.marks.find((mark) => mark.atMm === 1300);
  assert.ok(above.heightMm > radiator.topMm, "розетку над радиатором рисовать есть от чего");
});

test("развёртку можно нарисовать с любой стороны стены: отступ отражается", () => {
  // Смотрим на стену изнутри комнаты — направление вдоль неё меняется на
  // обратное, и отступ метки считается от другого конца. Данных для этого
  // хватает: есть длина стены и сторона метки, больше ничего не нужно.
  const scene = elevationScene();
  const wall = elevationOf(scene.project, scene.schemeId, scene.wallId);
  const mirrored = wall.marks.map((mark) => wall.lengthMm - mark.atMm);
  assert.deepEqual(mirrored, [2700, 900]);
});

test("чего в модели для развёртки нет — названо здесь, а не забыто", () => {
  const scene = elevationScene();
  const wall = findWall(scene.project, scene.wallId);

  // 1. У стены нет помещения, значит переопределение высоты комнаты до неё не
  //    доходит: развёртка стены в комнате с другой высотой возьмёт высоту
  //    этажа. Проверяется прямо: высота по схеме и по комнате — разные ответы,
  //    и спросить «высоту этой стены» негде.
  assert.ok(!Object.prototype.hasOwnProperty.call(wall, "roomId"), "стена не знает своего помещения");

  // 2. У объекта схемы нет привязки к стене: `wallId` у него не бывает, и
  //    рисующий развёртку проецирует его сам (как это сделано в `elevationOf`).
  const object = schemeObjectsOnScheme(scene.project, scene.schemeId)[0];
  assert.ok(!Object.prototype.hasOwnProperty.call(object, "wallId"));

  // 3. Линейная метка привязывается отрезком — дыра закрыта в таске 129.
  assert.equal(
    markWallBindable({ id: "x", kind: "line", points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] }),
    true,
  );
});
