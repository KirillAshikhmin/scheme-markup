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

// ——— G68 ————————————————————————————————————————————————————————————————

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
