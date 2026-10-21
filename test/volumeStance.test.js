// Присед, прыжок и прицел в объёме (таск 159, требования G234 и G235).
//
// Слова заказчика: «Сделай на клавишу Control функцию Присесть, а на пробел -
// прыжок» и «Когда курсор не перехвачен - тоже прицел надо отображать, а клик
// на дверь должен тоже её открывать. Клик равноценен нажатию E на объект под
// курсором».
//
// За чем здесь следят, по важности:
//
//   1. **Сквозь низкое не проходят стоя, а присев — проходят.** Это и есть вся
//      новая клавиша: разойдись столкновения с высотой макушки, и присед
//      станет либо бесполезным (под шкаф не пролезть), либо читерским (сквозь
//      шкаф в полный рост).
//   2. **Встать негде — остаёмся присевшими.** Отпущенный под низким потолком
//      Control не имеет права протолкнуть макушку сквозь вещь и не имеет права
//      переставить человека в сторону.
//   3. **Числа.** Присед 550 мм, прыжок 300 мм, полсекунды дуги — они названы в
//      отчёте заказчику, и проверять их нужно счётом, а не словом.
//   4. **G68.** Стойка живёт в сеансе: ни присед, ни прыжок, ни выделение в
//      объект не пишутся.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  addOpening,
  addOutline,
  addRoom,
  addScheme,
  addSchemeObject,
  addWall,
  createProject,
  ensureSchemeObjectKinds,
  planMmToFraction,
  schemeObjectKindsInOrder,
  setPlanOrigin,
  setPlanScale,
  setSchemeWallHeight,
} from "../src/model.js";
import {
  VOLUME_BODY_MM,
  VOLUME_CROUCH_MM,
  VOLUME_STEP_MM,
  VOLUME_CROUCH_MM_S,
  VOLUME_CROWN_MM,
  VOLUME_EYE_MM,
  VOLUME_FALL_MM_S2,
  VOLUME_HEAD_MM,
  VOLUME_JUMP_MM,
  VOLUME_JUMP_MM_S,
  VOLUME_LINTEL_MM,
  volumeCanStand,
  volumeFreeMm,
  volumeGroundMm,
  volumeScene,
  volumeSolidBlocks,
  volumeStanceAir,
  volumeStanceBusy,
  volumeStanceEye,
  volumeStanceHead,
  volumeStanceJump,
  volumeStanceStart,
  volumeStanceStep,
  volumeStep,
  volumeWallLintels,
} from "../src/volume.js";
import { volumeAimAt, volumeStanceKey } from "../src/panels/volume.js";

// ——— стенд ———————————————————————————————————————————————————————————————
//
// Коридор 6 × 2 м: две длинные стены, две короткие, проход вдоль оси `x`.
// Нужен именно коридор, а не комната: присед проверяется проходом под вещью, и
// обойти её человек не должен иметь возможности.

function corridor() {
  const added = addScheme(createProject(), { name: "1 этаж", imageId: "plan-1", width: 1200, height: 800 });
  let project = setPlanScale(added.project, added.scheme.id, {
    a: { x: 0.1, y: 0.5 },
    b: { x: 0.6, y: 0.5 },
    meters: 6,
  }).project;
  project = setPlanOrigin(project, added.scheme.id, { at: { x: 0.5, y: 0.5 }, turn: 0 }).project;
  project = setSchemeWallHeight(project, added.scheme.id, 2700).project;
  const schemeId = added.scheme.id;
  const corners = [
    { x: -3000, y: -1000 },
    { x: 3000, y: -1000 },
    { x: 3000, y: 1000 },
    { x: -3000, y: 1000 },
  ];
  const walls = [];
  for (let index = 0; index < corners.length; index += 1) {
    const wall = addWall(project, {
      schemeId,
      aMm: corners[index],
      bMm: corners[(index + 1) % corners.length],
      thicknessMm: 200,
    });
    project = wall.project;
    walls.push(wall.wall.id);
  }
  const room = addRoom(project, "Коридор");
  project = room.project;
  const inner = [
    { x: -2900, y: -900 },
    { x: 2900, y: -900 },
    { x: 2900, y: 900 },
    { x: -2900, y: 900 },
  ];
  project = addOutline(project, {
    schemeId,
    roomId: room.room.id,
    points: inner.map((point) => planMmToFraction(project, schemeId, point)),
  }).project;
  return { project, schemeId, walls };
}

/** Вещь во всю ширину коридора: от `bottomMm` до `bottomMm + heightMm`. */
function withShelf(base, bottomMm, heightMm) {
  const withKinds = ensureSchemeObjectKinds(base.project).project;
  const kind = schemeObjectKindsInOrder(withKinds).find((item) => item.name === "Шкаф");
  return addSchemeObject(withKinds, {
    schemeId: base.schemeId,
    kindId: kind.id,
    shape: "rect",
    atMm: { x: 0, y: 0 },
    widthMm: 600,
    depthMm: 1800,
    turnDeg: 0,
    heightAboveFloorMm: bottomMm,
    heightMm,
  }).project;
}

/**
 * Лаз в дальней стене коридора: `heightMm` от пола. Присед проверяется им, а
 * не вещью: с таска 178 сквозь вещи проходят (G264), и низким остаётся только
 * то, что сделано стеной.
 */
function withHatch(base, heightMm) {
  return addOpening(base.project, {
    wallId: base.walls[1],
    kind: "opening",
    atMm: 800,
    widthMm: 900,
    heightMm,
    heightAboveFloorMm: 0,
  }).project;
}

/** Прошёл ли человек коридор насквозь с такой макушкой. */
function walked(scene, headMm) {
  let at = { x: -2400, y: 0 };
  for (let step = 0; step < 60; step += 1) at = volumeStep(scene, at, 100, 0, headMm);
  return at.x;
}

// ——— числа (G234) ————————————————————————————————————————————————————————

test("числа стойки названы: глаза 1600 и 1050, макушка 1900 и 1350", () => {
  const stand = volumeStanceStart();
  assert.equal(volumeStanceEye(stand), 1600);
  assert.equal(volumeStanceHead(stand), 1900);
  assert.equal(VOLUME_CROWN_MM, 300, "от глаз до макушки 300 мм — и стоя, и присев");
  const sat = { crouchMm: VOLUME_CROUCH_MM, liftMm: 0, speedMm: 0 };
  assert.equal(volumeStanceEye(sat), 1050, "присев, глаза на метре с небольшим");
  assert.equal(volumeStanceHead(sat), 1350, "а макушка — ниже низа навесного шкафа");
  // Низ навесного шкафа кухни — 1400–1500 мм: присед обязан пускать туда.
  assert.ok(volumeStanceHead(sat) < 1400, "иначе клавиша не делала бы ничего");
});

test("присед и подъём занимают 0,18 с на все 550 мм", () => {
  const seconds = VOLUME_CROUCH_MM / VOLUME_CROUCH_MM_S;
  assert.ok(seconds > 0.17 && seconds < 0.19, "0,18 с: " + seconds);
  // Присели за один длинный тик — ровно до низа и ни миллиметром ниже.
  const down = volumeStanceStep(volumeStanceStart(), 1, { crouch: true });
  assert.equal(down.crouchMm, VOLUME_CROUCH_MM);
  // И встали за один тик обратно.
  const up = volumeStanceStep(down, 1, { crouch: false });
  assert.equal(up.crouchMm, 0);
  // Дробными тиками — ровно со своей скоростью.
  const part = volumeStanceStep(volumeStanceStart(), 0.05, { crouch: true });
  assert.ok(Math.abs(part.crouchMm - 150) < 1e-9, "50 мс — 150 мм: " + part.crouchMm);
  assert.equal(volumeStanceEye(part), VOLUME_EYE_MM - part.crouchMm);
});

test("прыжок поднимает на 300 мм: взлёт четверть секунды, вся дуга полсекунды", () => {
  assert.ok(Math.abs(VOLUME_JUMP_MM_S - Math.sqrt(2 * VOLUME_FALL_MM_S2 * VOLUME_JUMP_MM)) < 1e-9);
  assert.ok(Math.abs(VOLUME_JUMP_MM_S - 2426) < 1, "начальная скорость 2426 мм/с: " + VOLUME_JUMP_MM_S);
  let stance = volumeStanceJump(volumeStanceStart());
  assert.ok(volumeStanceAir(stance), "оторвался от пола сразу");
  const tick = 1 / 240;
  let top = 0;
  let rise = 0;
  let airtime = 0;
  for (let step = 0; step < 400 && volumeStanceAir(stance); step += 1) {
    stance = volumeStanceStep(stance, tick, { crouch: false });
    airtime += tick;
    if (stance.liftMm > top) {
      top = stance.liftMm;
      rise = airtime;
    }
  }
  // Дуга считается тиками, и дискретный счёт не дотягивает до теоретического
  // верха пять миллиметров из трёхсот (на кадрах по 1/60 — около двадцати).
  // Выше 300 мм прыжок не поднимает никогда, и это важнее точности: доля
  // процента роста человека на глаз не видна, а перепрыгнутое препятствие —
  // видно сразу.
  assert.ok(top <= VOLUME_JUMP_MM, "выше 300 мм не подпрыгивает: " + top);
  assert.ok(top > VOLUME_JUMP_MM - 10, "и ниже 290 мм не остаётся: " + top);
  assert.ok(Math.abs(rise - 0.247) < 0.02, "взлёт четверть секунды: " + rise);
  assert.ok(Math.abs(airtime - 0.494) < 0.03, "и столько же падение: " + airtime);
  assert.equal(stance.liftMm, 0, "вернулся на пол ровно");
  assert.equal(stance.speedMm, 0, "и скорость погасил — иначе ушёл бы под пол");
  assert.equal(volumeStanceEye(stance), VOLUME_EYE_MM);
});

test("прыжок разовый: ни второго в воздухе, ни прыжка из приседа", () => {
  const air = volumeStanceJump(volumeStanceStart());
  assert.deepEqual(volumeStanceJump(air), air, "второго прыжка в воздухе не бывает");
  const sat = { crouchMm: VOLUME_CROUCH_MM, liftMm: 0, speedMm: 0 };
  assert.deepEqual(volumeStanceJump(sat), sat, "присев, не прыгают");
  const rising = { crouchMm: 100, liftMm: 0, speedMm: 0 };
  assert.deepEqual(volumeStanceJump(rising), rising, "и на полпути к полному росту тоже");
});

test("прыжок поднимает глаза, но не макушку: сквозь низкое не перепрыгнуть", () => {
  const air = volumeStanceStep(volumeStanceJump(volumeStanceStart()), 0.1, { crouch: false });
  assert.ok(air.liftMm > 100, "человек в воздухе: " + air.liftMm);
  assert.equal(volumeStanceEye(air), VOLUME_EYE_MM + air.liftMm, "видно выше");
  assert.equal(volumeStanceHead(air), VOLUME_HEAD_MM, "а проходимость та же");
});

test("часы идут, пока стойка не доехала, и останавливаются, когда встать негде", () => {
  assert.equal(volumeStanceBusy(volumeStanceStart(), false), false, "стоим — считать нечего");
  assert.equal(volumeStanceBusy(volumeStanceStart(), true), true, "сели — считаем присед");
  const sat = { crouchMm: VOLUME_CROUCH_MM, liftMm: 0, speedMm: 0 };
  assert.equal(volumeStanceBusy(sat, true), false, "присед доехал — часы стоят");
  assert.equal(volumeStanceBusy(sat, false), true, "встаём — считаем подъём");
  assert.equal(volumeStanceBusy(volumeStanceJump(volumeStanceStart()), false), true, "прыжок считается всегда");
});

// ——— столкновения по высоте макушки (G234) ———————————————————————————————

test("препятствие держит того, чья макушка выше его низа", () => {
  const shelf = { bottomMm: 1500, topMm: 2200 };
  assert.equal(volumeSolidBlocks(shelf, VOLUME_HEAD_MM), true, "стоя — держит");
  assert.equal(volumeSolidBlocks(shelf, 1350), false, "присев — пропускает");
  // Порожек ниже шага не держит никого, стена до потолка — всех.
  assert.equal(volumeSolidBlocks({ bottomMm: 0, topMm: 200 }, 1350), false);
  assert.equal(volumeSolidBlocks({ bottomMm: 0, topMm: 2700 }, 1350), true);
  // Препятствие без высот — «до потолка»: молча пропускать сквозь него нельзя.
  assert.equal(volumeSolidBlocks({}, 1350), true);
});

test("сквозь шкаф проходят в любой стойке (G264), и приседать для этого не надо", () => {
  const base = corridor();
  // Навесной шкаф от 1500 до 2200 и шкаф до пола — оба перестали держать:
  // «убери коллизию», слова заказчика (таск 178). Приседу осталась перемычка
  // над низким проёмом — она ниже по файлу и стеной, а не вещью.
  for (const scene of [
    volumeScene(withShelf(base, 1500, 700), base.schemeId),
    volumeScene(withShelf(base, 0, 2200), base.schemeId),
  ]) {
    assert.ok(walked(scene, VOLUME_HEAD_MM) > 2000, "стоя не прошёл сквозь вещь");
    assert.ok(walked(scene, 1350) > 2000, "присев не прошёл сквозь вещь");
  }
});

test("низкая перемычка стены держит стоящего и пропускает присевшего", () => {
  const base = corridor();
  const scene = volumeScene(withHatch(base, 1500), base.schemeId);
  // Идём серединой лаза: он от y = −200 до y = 700.
  const go = (headMm) => {
    let at = { x: 2000, y: 250 };
    for (let step = 0; step < 40; step += 1) at = volumeStep(scene, at, 100, 0, headMm);
    return at.x;
  };
  assert.ok(go(VOLUME_HEAD_MM) < 3000, "стоя перемычка держит: " + go(VOLUME_HEAD_MM));
  assert.ok(go(1350) > 3100, "присев прошёл: " + go(1350));
});

test("сквозь стену не пройти присевшим", () => {
  const base = corridor();
  const scene = volumeScene(base.project, base.schemeId);
  let at = { x: 0, y: 0 };
  for (let step = 0; step < 60; step += 1) at = volumeStep(scene, at, 0, 100, 1350);
  assert.ok(at.y < 900, "стена держит в любой стойке: " + at.y);
  assert.ok(volumeFreeMm(scene.solids, at.x, at.y, 1350) >= VOLUME_BODY_MM - 1);
});

test("встать негде под низким и можно у стены", () => {
  const base = corridor();
  const scene = volumeScene(withHatch(base, 1500), base.schemeId);
  // В лазе: встать нельзя, пока не выйдешь. Перемычка идёт по стене x = 3000,
  // середина лаза — y = 250.
  assert.equal(volumeCanStand(scene, { x: 3000, y: 250 }, 1350), false);
  // Шаг в сторону от лаза — и встаёт.
  assert.equal(volumeCanStand(scene, { x: 1200, y: 0 }, 1350), true);
  // Вплотную к стене: присевший у стенки обязан вставать всегда. Стена держит
  // в любой стойке, и сравнивать «на волос ближе» в double здесь нельзя.
  let at = { x: 1200, y: 0 };
  for (let step = 0; step < 30; step += 1) at = volumeStep(scene, at, 0, 100, 1350);
  assert.equal(volumeCanStand(scene, at, 1350), true, "у стены вставать можно");
  // И в полный рост вопрос не задаётся вовсе: стоящему вставать некуда.
  assert.equal(volumeCanStand(scene, { x: 0, y: 0 }, VOLUME_HEAD_MM), true);
});

test("присед не даёт пройти там, где перемычка ниже его макушки", () => {
  const base = corridor();
  // Лаз 1300 мм: перемычка от 1300, макушка присевшего 1350 — выше неё.
  const scene = volumeScene(withHatch(base, 1300), base.schemeId);
  let at = { x: 2000, y: 250 };
  for (let step = 0; step < 40; step += 1) at = volumeStep(scene, at, 100, 0, 1350);
  assert.ok(at.x < 3000, "1350 выше 1300 — держит: " + Math.round(at.x));
});

// ——— низкая перемычка над проёмом (G234) —————————————————————————————————

test("низкий проём держит стоя и пропускает присевшего, а дверь — дыра для обоих", () => {
  assert.equal(VOLUME_LINTEL_MM, 1700);
  // Лаз 1500 мм: перемычка от 1500 до верха стены.
  const low = volumeWallLintels([{ kind: "opening", atMm: 1000, widthMm: 900, heightMm: 1500, heightAboveFloorMm: 0 }], 2700);
  assert.deepEqual(low, [{ fromMm: 1000, toMm: 1900, bottomMm: 1500, topMm: 2700 }]);
  assert.equal(volumeSolidBlocks(low[0], VOLUME_HEAD_MM), true, "стоя не пройти");
  assert.equal(volumeSolidBlocks(low[0], 1350), false, "присев — пройти");
  // Обычная дверь 2100 и дверь 1800 перемычки не получают: высота полотна в
  // чертеже — не просвет, и ходивший сквозь неё человек ходить не перестанет.
  assert.deepEqual(volumeWallLintels([{ kind: "door", atMm: 0, widthMm: 900, heightMm: 2100, heightAboveFloorMm: 0 }], 2700), []);
  assert.deepEqual(volumeWallLintels([{ kind: "door", atMm: 0, widthMm: 900, heightMm: 1800, heightAboveFloorMm: 0 }], 2700), []);
  // Окно дыры не оставляет вовсе — перемычке над ним взяться негде.
  assert.deepEqual(volumeWallLintels([{ kind: "window", atMm: 0, widthMm: 1400, heightMm: 1400, heightAboveFloorMm: 800 }], 2700), []);
});

test("у арки просвет считается по дуге, и голова задевает пяту (дефект D71)", () => {
  // Арка 1200 × 2100 — умолчание каталога. Прямоугольником её просвет был
  // 2100 на всю ширину, то есть препятствия не заводилось вовсе; дуга
  // полуциркульная, пята на 1500 — ниже порога 1700, и под косяком стоя не
  // пройти. Числа дуги — те же, что у развёртки (`openingArchDropMm`).
  const arch = { kind: "arch", atMm: 1000, widthMm: 1200, heightMm: 2100, heightAboveFloorMm: 0 };
  const spans = volumeWallLintels([arch], 2700);
  assert.equal(spans.length, 2, "у арки 1200 × 2100 низки только пяты: " + JSON.stringify(spans));
  assert.deepEqual(
    spans.map((span) => [Math.round(span.fromMm), Math.round(span.toMm), Math.round(span.bottomMm)]),
    [
      [1000, 1100, 1500],
      [2100, 2200, 1500],
    ],
    "просвет у косяка — пята полуциркульной дуги",
  );
  assert.ok(spans.every((span) => span.topMm === 2700), "препятствие идёт до верха стены");
  assert.equal(volumeSolidBlocks(spans[0], VOLUME_HEAD_MM), true, "у пяты стоя не пройти");
  assert.equal(volumeSolidBlocks(spans[0], 1350), false, "присев — пройти");
  // Прямой проём той же высоты препятствия по-прежнему не получает: правило
  // тронуто только у арки.
  assert.deepEqual(
    volumeWallLintels([{ kind: "opening", atMm: 1000, widthMm: 1200, heightMm: 2100, heightAboveFloorMm: 0 }], 2700),
    [],
  );
  // Низкая арка: дуга сегментная, и под ней низко везде — препятствие идёт
  // всей дугой, по куску на отрезок.
  const low = volumeWallLintels([{ kind: "arch", atMm: 0, widthMm: 1200, heightMm: 1000, heightAboveFloorMm: 0 }], 2700);
  assert.equal(low.length, 12, "сегментная дуга режется на отрезки свода");
  assert.deepEqual(
    low.map((span) => Math.round(span.bottomMm)),
    [500, 739, 851, 921, 966, 992, 992, 966, 921, 851, 739, 500],
    "у каждого куска берётся низшая из его высот",
  );
  assert.ok(
    low.every((span) => span.bottomMm < 1700),
    "под низкой аркой стоя не пройти нигде",
  );
});

test("лаз в стене коридора пускает присевшего и не пускает стоящего", () => {
  const base = corridor();
  // Лаз в дальней стене коридора: 1500 мм высотой, от пола.
  const project = addOpening(base.project, {
    wallId: base.walls[1],
    kind: "opening",
    atMm: 800,
    widthMm: 900,
    heightMm: 1500,
    heightAboveFloorMm: 0,
  }).project;
  const scene = volumeScene(project, base.schemeId);
  // Стена x = 3000 идёт по `y` от −1000 к 1000; лаз на 800 мм от её начала и
  // шириной 900, то есть от y = −200 до y = 700 — идём его серединой.
  const go = (headMm) => {
    let at = { x: 2000, y: 250 };
    for (let step = 0; step < 40; step += 1) at = volumeStep(scene, at, 100, 0, headMm);
    return at.x;
  };
  assert.ok(go(VOLUME_HEAD_MM) < 3000, "стоя перемычка держит: " + go(VOLUME_HEAD_MM));
  assert.ok(go(1350) > 3100, "присев прошёл сквозь лаз: " + go(1350));
});

// ——— клавиши: Control и пробел против привычных сочетаний (G234) ——————————

test("Control приседает сам по себе и не приседает в сочетании", () => {
  assert.equal(volumeStanceKey({ code: "ControlLeft", ctrlKey: true }), "crouch");
  assert.equal(volumeStanceKey({ code: "ControlRight", ctrlKey: true }), "crouch");
  // Ctrl+Z, Ctrl+C, Ctrl+V: буква приходит с зажатым Control — присед отменён,
  // и клавиша уходит дальше, к отмене и к буферу.
  for (const code of ["KeyZ", "KeyC", "KeyV", "KeyY", "KeyS"]) {
    assert.equal(volumeStanceKey({ code, ctrlKey: true }), "combo", code);
    assert.equal(volumeStanceKey({ code, metaKey: true }), "combo", code + " с Cmd");
  }
});

test("пробел прыгает, а системные сочетания с ним — нет", () => {
  assert.equal(volumeStanceKey({ code: "Space" }), "jump");
  // Ctrl+Space (переключение ввода), Cmd+Space (поиск), Alt+Space (меню окна).
  assert.equal(volumeStanceKey({ code: "Space", ctrlKey: true }), "combo");
  assert.equal(volumeStanceKey({ code: "Space", metaKey: true }), "combo");
  assert.equal(volumeStanceKey({ code: "Space", altKey: true }), null);
  // Прочие клавиши стойке не принадлежат: ходьба, двери и виды разбираются сами.
  assert.equal(volumeStanceKey({ code: "KeyW" }), null);
  assert.equal(volumeStanceKey({ code: "KeyE" }), null);
  assert.equal(volumeStanceKey({ code: "ShiftLeft", shiftKey: true }), null);
});

// ——— куда целится прицел при свободном курсоре (G235) —————————————————————

test("прицел идёт за курсором, а под захваченной мышью стоит посреди поля", () => {
  const box = { width: 1000, height: 600 };
  const middle = { x: 500, y: 300 };
  // Мышь отдана виду — курсора нет вовсе, и целятся серединой поля.
  assert.deepEqual(volumeAimAt(box, { locked: true, pointer: { x: 10, y: 10 }, view: "person" }), middle);
  // Курсор свободен и над полем — целится он: «клик равноценен нажатию E на
  // объект под курсором» (слова заказчика), значит E и клик смотрят в одну точку.
  assert.deepEqual(volumeAimAt(box, { locked: false, pointer: { x: 120, y: 480 }, view: "person" }), {
    x: 120,
    y: 480,
  });
  // Курсор увели с поля — от первого лица снова середина: клавиша, переставшая
  // работать от того, что мышь лежит на панели, была бы загадкой.
  assert.deepEqual(volumeAimAt(box, { locked: false, pointer: null, view: "person" }), middle);
  // В обзоре середина поля не значит ничего, и прицела там нет.
  assert.equal(volumeAimAt(box, { locked: false, pointer: null, view: "around" }), null);
  // А курсор в обзоре целится: E действует на то, на что показывают.
  assert.deepEqual(volumeAimAt(box, { locked: false, pointer: { x: 7, y: 9 }, view: "around" }), { x: 7, y: 9 });
});


// ——— таск 192: сквозь стены и полёт (G292) ———————————————————————————————
//
// Слова заказчика: «2. Проходить сквозь стены 3. Летать (при движении летим в
// сторону курсора, пробел (прыжок) - выше, ctrl (присяд) - ниже)».
//
// За чем здесь следят, по важности:
//
//   1. **Без галок не изменилось ничего.** Обе отметки — необязательные доводы
//      у того же счёта; у них по умолчанию ноль и `false`, и ходьба обязана
//      остаться той же до миллиметра.
//   2. **Второго счёта высоты не завелось.** Полёт считает ту же `liftMm`, что
//      прыжок, и глаза ему считает тот же `volumeStanceEye`.
//   3. **Земля держит, потолка нет** — это решение, и оно проверяется счётом.
//   4. **Стойка в полёте остаётся стойкой**: присед, принесённый с земли,
//      расходится сам, и «встать негде» в полёте не бывает.

test("отметка «сквозь стены» снимает столкновения, снятая — ничего не меняет (таск 192)", () => {
  const base = corridor();
  const scene = volumeScene(base.project, base.schemeId);
  // Стена коридора по y = 1000: без галки она держит (та же проверка, что в
  // тесте «сквозь стену не пройти присевшим»).
  const go = (options) => {
    let at = { x: 0, y: 0 };
    for (let step = 0; step < 60; step += 1) at = volumeStep(scene, at, 0, 100, VOLUME_HEAD_MM, options);
    return at.y;
  };
  assert.ok(go(undefined) < 900, "без отметки стена держит: " + Math.round(go(undefined)));
  assert.equal(go({}), go(undefined), "пустые доводы — та же ходьба до числа");
  assert.equal(go({ ghost: false }), go(undefined), "снятая отметка — та же ходьба до числа");
  // С галкой шаг идёт ровно туда, куда просили: 60 шагов по 100 мм — 6000 мм.
  assert.equal(go({ ghost: true }), 6000, "сквозь стены проходим насквозь");
  // И сквозь низкую перемычку в полный рост — её держала та же проверка.
  const hatch = volumeScene(withHatch(base, 1300), base.schemeId);
  let at = { x: 2000, y: 250 };
  for (let step = 0; step < 40; step += 1) at = volumeStep(hatch, at, 100, 0, VOLUME_HEAD_MM, { ghost: true });
  assert.equal(Math.round(at.x), 6000, "перемычка тоже снята");
  // «Встать негде» — это и есть столкновение: снявший стены не застревает в
  // приседе под тем, сквозь что он только что прошёл. Лаз здесь 1500 мм —
  // ровно тот, под которым присевший стоит и не встаёт.
  const low = volumeScene(withHatch(base, 1500), base.schemeId);
  assert.equal(volumeCanStand(low, { x: 3000, y: 250 }, 1350), false);
  assert.equal(volumeCanStand(low, { x: 3000, y: 250 }, 1350, { ghost: true }), true);
  assert.equal(volumeCanStand(low, { x: 3000, y: 250 }, 1350, { ghost: false }), false);
});

test("высоты ног у столкновений больше нет: по стенам ходит только человек (таск 200)", () => {
  // Таск 192 давал стенам высоту ног, чтобы летящий проходил над тем, что
  // кончилось ниже его подошв. Полёт из первого лица ушёл в обзор (G304), а
  // камера обзора стены не спрашивает вовсе — и правило вернулось к тому, чем
  // было: препятствие держит, если его низ ниже макушки, а верх выше порога.
  const wall = { bottomMm: 0, topMm: 2700 };
  assert.equal(volumeSolidBlocks(wall, VOLUME_HEAD_MM), true);
  assert.equal(volumeSolidBlocks(wall, VOLUME_HEAD_MM, 2500), true, "лишний довод шага не отменяет");
  // Низкий порожек — через него переступают: верх не выше `VOLUME_STEP_MM`.
  assert.equal(volumeSolidBlocks({ bottomMm: 0, topMm: VOLUME_STEP_MM }, VOLUME_HEAD_MM), false);
  assert.equal(volumeSolidBlocks({ bottomMm: 0, topMm: VOLUME_STEP_MM + 1 }, VOLUME_HEAD_MM), true);
  // Препятствие без высот — «до потолка» (так строит рука в тестах, и молча
  // пропускать сквозь него нельзя).
  assert.equal(volumeSolidBlocks({}, VOLUME_HEAD_MM + 9000), true);
  // Высокой макушкой сквозь стену не пройти: шаг держит её на любой высоте.
  const base = corridor();
  const scene = volumeScene(base.project, base.schemeId);
  let at = { x: 0, y: 0 };
  for (let step = 0; step < 60; step += 1) at = volumeStep(scene, at, 0, 100, VOLUME_HEAD_MM + 3000);
  assert.ok(at.y < 900, "стена перестала держать: " + Math.round(at.y));
  // Сквозь стены ходит только отметка (G292) — и ровно она, а не высота.
  let ghost = { x: 0, y: 0 };
  for (let step = 0; step < 60; step += 1) ghost = volumeStep(scene, ghost, 0, 100, VOLUME_HEAD_MM, { ghost: true });
  assert.equal(ghost.y, 6000);
});

test("пол держит одним правилом: прыжок приземляется, камера не уходит под плиту (таск 200)", () => {
  // Правило пола названо **одно на оба тела** (`volumeGroundMm`): под полом не
  // нарисовано ничего, и провалившийся туда видел бы серое поле.
  assert.equal(volumeGroundMm(-5000), 0);
  assert.equal(volumeGroundMm(0), 0);
  assert.equal(volumeGroundMm(2500), 2500);
  assert.equal(volumeGroundMm("мусор"), 0, "нечисло — ноль, а не NaN");
  // Прыжок приземляется по нему: дуга кончается ровно на полу, скорость гаснет.
  let stance = volumeStanceJump(volumeStanceStart());
  assert.equal(volumeStanceAir(stance), true);
  let top = 0;
  for (let step = 0; step < 120 && (stance.liftMm > 0 || step === 0); step += 1) {
    stance = volumeStanceStep(stance, 1 / 60, {});
    top = Math.max(top, stance.liftMm);
  }
  // Шестидесятая секунды дробит дугу, и вершина чуть ниже расчётной: это
  // честная цена шага, а не чужое число.
  assert.ok(Math.abs(top - VOLUME_JUMP_MM) < 30, "высота прыжка уехала: " + Math.round(top));
  assert.equal(stance.liftMm, 0, "приземлился");
  assert.equal(stance.speedMm, 0);
  assert.equal(volumeStanceEye(stance), VOLUME_EYE_MM, "на полу глаза на своём месте");
});

test("полёта в первом лице больше нет: `flyMm` стойке не довод (таск 200, G304)", () => {
  // Отметку «Летать» заказчик убрал, и второго полёта в стойке не осталось:
  // лишний довод ничего не делает, а высота по-прежнему одна — прыжок.
  const start = volumeStanceStart();
  assert.deepEqual(volumeStanceStep(start, 1 / 60, { flyMm: 100 }), start, "стойка снова летает");
  const air = { crouchMm: 0, liftMm: 2500, speedMm: 0 };
  // Висеть в воздухе человеку больше нечем: он падает той же дугой, которой
  // приземляется после прыжка.
  const fell = volumeStanceStep(air, 1 / 60, { flyMm: 0 });
  assert.ok(fell.liftMm < air.liftMm, "висящий перестал падать: " + fell.liftMm);
  // Оторванность от пола сама просит кадров — иначе прыжок замер бы в воздухе.
  assert.equal(volumeStanceBusy(air, false), true);
  assert.equal(volumeStanceBusy(air, false, { fly: true }), true, "лишний довод отменил падение");
  // Control в первом лице снова значит только «присесть»: `canStand` спрашивают
  // всегда, и застрявший под низким остаётся внизу.
  let stuck = { crouchMm: VOLUME_CROUCH_MM, liftMm: 0, speedMm: 0 };
  for (let step = 0; step < 60; step += 1) stuck = volumeStanceStep(stuck, 1 / 60, { crouch: false, canStand: false });
  assert.equal(stuck.crouchMm, VOLUME_CROUCH_MM, "встал там, где встать негде");
});

// ——— полёт обзора: сверка по исходникам (таск 200, G304) ————————————————
//
// Полёт камеры живёт в замыкании поверхности, и тестом его не позвать. Но три
// обещания таска проверяются по исходникам, и проверяются надёжнее, чем глазом:
// у обзора нет своей цели, нет своей скорости и нет своего счёта столкновений.

test("у обзора нет ни своей цели, ни своей скорости, ни своих столкновений (таск 200)", () => {
  const panel = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "..", "src", "panels", "volume.js"),
    "utf8",
  );
  const code = stripComments(panel);
  // **Цель не хранится.** Храни её — и вращение крутило бы брошенную точку на
  // другом конце квартиры, а полёт уводил бы камеру от неё.
  assert.ok(!/around\.target/.test(code), "у обзора снова своя хранимая цель");
  assert.ok(/volumeAroundTarget\(around\.eye/.test(code), "цель считается не точкой перед камерой");
  // **Скорость общая** — слово заказчика: «скорость для камеры как и сейчас для
  // полёта». Своего числа «мм в секунду» в поле нет ни одного: шаг приходит
  // доводом из того же счёта, которым ходит человек.
  const fly = code.slice(code.indexOf("function aroundFly"));
  const body = fly.slice(0, fly.indexOf("\n  }\n"));
  assert.ok(body.includes("speed"), "полёт камеры считает скорость сам");
  assert.ok(!/\d{3,}/.test(body), "в полёте камеры завелось своё число: " + body);
  // **Пол — то же правило, что у прыжка**, и зовётся оно по имени.
  assert.ok(/volumeGroundMm\(around\.eye\.z/.test(body), "камера держится у земли своим правилом");
  // **Стены обзор не спрашивает вовсе**: `volumeStep` зовётся один раз, в ветке
  // первого лица, и отметка `ghost` до камеры не доходит.
  assert.equal((code.match(/volumeStep\(/g) || []).length, 1, "шаг со столкновениями зовётся не единожды");
  assert.ok(!body.includes("ghost"), "камере поставили отметку «сквозь стены»");
});

test("поворот взгляда считает одно место на оба вида (таск 207, G312)", () => {
  const panel = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "..", "src", "panels", "volume.js"),
    "utf8",
  );
  const code = stripComments(panel);
  // Орбиты больше нет ни следа: мышь вертит камеру на месте, как в первом лице.
  assert.ok(!/aroundSpin/.test(code), "орбитальный поворот обзора вернулся");
  // **Разбор один.** Мера поворота мышью встречается в поле ровно дважды —
  // ввоз и единственный счёт: заведись второй, виды разошлись бы молча.
  assert.equal((code.match(/VOLUME_LOOK_DEG_PX/g) || []).length, 2, "у поворота мышью завёлся второй разбор");
  // Поворот обзора **места не трогает**: `aroundTurn` отдаёт прежнее место.
  assert.ok(/function aroundTurn\(yaw, pitch\) \{\s*aroundSet\(around\.eye, yaw, pitch\);/.test(code), "поворот обзора двигает камеру");
  // Мера обзора не хранится как выбор: её пишет только `aroundSet`.
  assert.equal((code.match(/distance:/g) || []).length, 1, "расстояние обзора снова пишут мимо одной двери");
  assert.ok(/around = \{ eye, yaw, pitch, distance: volumeAroundReach\(eye, pitch\) \}/.test(code), "мера обзора перестала считаться");
});

// ——— G68 ————————————————————————————————————————————————————————————————

test("второго счёта высоты нет, и отметки не доходят до объекта (таск 192, G68)", () => {
  // Требование таска прямое: «не заводи второго счёта высоты». Проверяется это
  // по исходникам: `liftMm` живёт **только** в `volume.js`, а поле спрашивает
  // высоту дверью `volumeStanceEye`. Появись `liftMm` в панели — там и завёлся
  // бы второй счёт высоты человека.
  //
  // Высота камеры обзора — её собственная `z` (таск 200, G304), и она была у
  // обзора всегда: до таска это была `target.z`, теперь `eye.z`. Второго счёта
  // переездом не завелось — счётов по-прежнему по одному на каждое тело.
  const sources = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".js")) sources.push({ name: full, text: readFileSync(full, "utf8") });
    }
  };
  walk(join(dirname(fileURLToPath(import.meta.url)), "..", "src"));
  const owns = sources.filter((file) => file.text.includes("liftMm")).map((file) => basename(file.name));
  assert.deepEqual(owns, ["volume.js"], "высоту считает одно место: " + owns.join(", "));
  // Три отметки — настройки браузера, и в объект им нельзя (G68). Ни модель, ни
  // формат файла проекта о них не знают: миграции тут браться не от чего.
  for (const key of ["volumeSmoothSky", "volumeThroughWalls"]) {
    const where = sources.filter((file) => file.text.includes('"' + key + '"')).map((file) => basename(file.name));
    assert.deepEqual(where, ["volumeParams.js"], key + " уехал из настроек: " + where.join(", "));
  }
  // «Летать» убрал заказчик (таск 200, G304): имени этой настройки в коде нет
  // ни одного — ни в окне параметров, ни в поле.
  const live = sources.filter((file) => /volumeFly/.test(stripComments(file.text))).map((file) => basename(file.name));
  assert.deepEqual(live, [], "отметка «Летать» вернулась в код: " + live.join(", "));
});

/** Исходник без строчных комментариев: разбор решения — не код. */
function stripComments(text) {
  return text
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");
}

test("ни присед, ни прыжок, ни ходьба не меняют объект (G68)", () => {
  const base = corridor();
  const project = withShelf(base, 1500, 700);
  const before = JSON.stringify(project);
  const scene = volumeScene(project, base.schemeId);
  let stance = volumeStanceJump(volumeStanceStart());
  let at = { x: -2400, y: 0 };
  for (let step = 0; step < 120; step += 1) {
    stance = volumeStanceStep(stance, 1 / 60, { crouch: step > 20, canStand: volumeCanStand(scene, at, volumeStanceHead(stance)) });
    at = volumeStep(scene, at, 60, 0, volumeStanceHead(stance));
  }
  assert.ok(at.x > 2000, "присев, человек прошёл под шкафом");
  assert.equal(JSON.stringify(project), before, "объект изменился — это запрещено прямо (G68)");
});
