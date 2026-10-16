// Имена углов и стен, перпендикулярные стены на развёртке (таск 142,
// требования G200 и G201).
//
// Главное, что здесь проверяется, — **устойчивость**. Буква принадлежит углу, и
// по именам видно, какие стены сходятся; но стоит порядку обхода зависеть от
// порядка стен в списке или от того, в какую сторону их рисовали, — и ручная
// привязка метки к «стене БВ» однажды покажет на другую стену (G202). Поэтому
// тот же чертёж проверяется трижды: в другом порядке, обратными направлениями
// и после прогона через файл.
import test from "node:test";
import assert from "node:assert/strict";

import {
  WALL_CROSS_MIN_DEG,
  WALL_CROSS_REACH_MM,
  WALL_LETTERS,
  addMark,
  addScheme,
  addWall,
  createProject,
  setSchemeWallHeight,
  wallCornerLetter,
  wallCorners,
  wallCrossings,
  wallElevation,
  wallName,
  wallNameOf,
  wallNames,
} from "../src/model.js";

// Схема без подложки: чертёж живёт в своих миллиметрах и ничего от картинки не
// ждёт (ADR 008), а имена считаются по чертежу — калибровка им не нужна.
function bareScheme() {
  const added = addScheme(createProject(), { name: "1 этаж", imageId: null, width: 0, height: 0 });
  return { project: setSchemeWallHeight(added.project, added.scheme.id, 2700).project, schemeId: added.scheme.id };
}

// Комната 4000 × 3000 от нуля, стены по часовой: левый верхний угол в нуле.
const ROOM = [
  [{ x: 0, y: 0 }, { x: 4000, y: 0 }],
  [{ x: 4000, y: 0 }, { x: 4000, y: 3000 }],
  [{ x: 4000, y: 3000 }, { x: 0, y: 3000 }],
  [{ x: 0, y: 3000 }, { x: 0, y: 0 }],
];

function withWalls(scene, segments, thicknessMm = 200) {
  let project = scene.project;
  const wallIds = [];
  for (const [aMm, bMm] of segments) {
    const added = addWall(project, { schemeId: scene.schemeId, aMm, bMm, thicknessMm });
    project = added.project;
    wallIds.push(added.wall.id);
  }
  return { ...scene, project, wallIds };
}

const lettersOf = (scene) => wallCorners(scene.project, scene.schemeId).map((corner) => corner.letter).join("");
const namesOf = (scene) => wallNames(scene.project, scene.schemeId).map((named) => named.name);

// ——— буква принадлежит углу ———————————————————————————————————————————

test("угол получает букву, стена — имя из двух букв", () => {
  const scene = withWalls(bareScheme(), ROOM);
  const corners = wallCorners(scene.project, scene.schemeId);
  assert.equal(corners.length, 4, "четыре стены сошлись в четырёх углах, а не в восьми концах");
  // Обход нормализован: А — в левом верхнем углу, дальше по часовой.
  assert.deepEqual(
    corners.map((corner) => [corner.letter, corner.atMm.x, corner.atMm.y]),
    [
      ["А", 0, 0],
      ["Б", 4000, 0],
      ["В", 4000, 3000],
      ["Г", 0, 3000],
    ],
  );
  assert.deepEqual(namesOf(scene), ["АБ", "БВ", "ВГ", "АГ"]);
});

test("смежные стены делят букву общего угла", () => {
  const scene = withWalls(bareScheme(), ROOM);
  const names = namesOf(scene);
  // Верхняя и правая сходятся в Б, правая и нижняя — в В: буква общая, и по
  // именам это видно без всякого чертежа.
  assert.ok(names[0].includes("Б") && names[1].includes("Б"), "верхняя и правая должны делить Б");
  assert.ok(names[1].includes("В") && names[2].includes("В"), "правая и нижняя должны делить В");
  // Угол знает все свои стены — по нему и видно, что их две.
  const corner = wallCorners(scene.project, scene.schemeId).find((item) => item.letter === "Б");
  assert.deepEqual(corner.wallIds.slice().sort(), [scene.wallIds[0], scene.wallIds[1]].sort());
});

test("стена, ни с кем не сошедшаяся, получает свои две буквы", () => {
  const scene = withWalls(bareScheme(), [[{ x: 0, y: 0 }, { x: 3000, y: 0 }]]);
  assert.equal(lettersOf(scene), "АБ");
  assert.deepEqual(namesOf(scene), ["АБ"]);
});

test("две стены, которые не сошлись, букв не делят", () => {
  const scene = withWalls(bareScheme(), [
    [{ x: 0, y: 0 }, { x: 3000, y: 0 }],
    // Конец в миллиметре от чужого — это не угол: совпадение проверяется
    // равенством, без допуска (ADR 008).
    [{ x: 3001, y: 0 }, { x: 3001, y: 2000 }],
  ]);
  assert.equal(wallCorners(scene.project, scene.schemeId).length, 4);
  const names = namesOf(scene);
  assert.equal(names.length, 2);
  assert.equal(new Set([...names[0], ...names[1]]).size, 4, "общей буквы быть не должно");
});

// ——— устойчивость порядка —————————————————————————————————————————————

test("порядок стен в списке на буквы не влияет", () => {
  const straight = withWalls(bareScheme(), ROOM);
  const shuffled = withWalls(bareScheme(), [ROOM[2], ROOM[0], ROOM[3], ROOM[1]]);
  assert.equal(lettersOf(shuffled), lettersOf(straight));
  assert.deepEqual(
    wallCorners(shuffled.project, shuffled.schemeId).map((corner) => [corner.letter, corner.atMm.x, corner.atMm.y]),
    wallCorners(straight.project, straight.schemeId).map((corner) => [corner.letter, corner.atMm.x, corner.atMm.y]),
  );
});

test("направление рисования на имя стены не влияет", () => {
  const straight = withWalls(bareScheme(), ROOM);
  // Та же комната, обведённая против часовой и с другого угла.
  const back = withWalls(
    bareScheme(),
    ROOM.slice().reverse().map(([aMm, bMm]) => [bMm, aMm]),
  );
  const byCorner = (scene) =>
    wallNames(scene.project, scene.schemeId)
      .map((named) => named.name)
      .sort();
  assert.deepEqual(byCorner(back), byCorner(straight), "имена те же, пусть и в другом порядке списка");
  // Имя собрано в порядке букв, а не концов: «БА» не бывает.
  for (const named of wallNames(back.project, back.schemeId)) {
    assert.ok(/^[А-Я]{2}$/.test(named.name), named.name);
    assert.ok(WALL_LETTERS.indexOf(named.name[0]) < WALL_LETTERS.indexOf(named.name[1]), named.name);
  }
});

test("на симметричной комнате буквы не зависят от того, какая стена первая", () => {
  // Квадрат: до левого верхнего угла габарита одинаково далеко сразу двум
  // вершинам, и без разводки равенства буквы поехали бы от порядка стен.
  const square = [
    [{ x: 0, y: 0 }, { x: 3000, y: 0 }],
    [{ x: 3000, y: 0 }, { x: 3000, y: 3000 }],
    [{ x: 3000, y: 3000 }, { x: 0, y: 3000 }],
    [{ x: 0, y: 3000 }, { x: 0, y: 0 }],
  ];
  const first = withWalls(bareScheme(), square);
  const second = withWalls(bareScheme(), [square[3], square[2], square[1], square[0]]);
  assert.deepEqual(
    wallCorners(second.project, second.schemeId).map((corner) => corner.letter + corner.atMm.x + "," + corner.atMm.y),
    wallCorners(first.project, first.schemeId).map((corner) => corner.letter + corner.atMm.x + "," + corner.atMm.y),
  );
});

test("отдельные куски чертежа идут сверху вниз, а не как попало", () => {
  const scene = withWalls(bareScheme(), [
    // Нижний кусок заведён первым — буквы всё равно начинаются с верхнего.
    [{ x: 0, y: 9000 }, { x: 2000, y: 9000 }],
    [{ x: 0, y: 0 }, { x: 2000, y: 0 }],
  ]);
  const corners = wallCorners(scene.project, scene.schemeId);
  assert.deepEqual(
    corners.map((corner) => [corner.letter, corner.atMm.y]),
    [
      ["А", 0],
      ["Б", 0],
      ["В", 9000],
      ["Г", 9000],
    ],
  );
});

test("имена не пишутся в объект", () => {
  const scene = withWalls(bareScheme(), ROOM);
  const before = JSON.stringify(scene.project);
  wallCorners(scene.project, scene.schemeId);
  wallNames(scene.project, scene.schemeId);
  wallName(scene.project, scene.wallIds[0]);
  wallElevation(scene.project, scene.wallIds[0], "left");
  assert.equal(JSON.stringify(scene.project), before);
  // И ни одного поля с именем у самой стены: имя — производная, а не данные.
  const wall = scene.project.walls[0];
  assert.deepEqual(Object.keys(wall).sort(), ["aMm", "bMm", "id", "schemeId", "thicknessMm"]);
});

test("G68: у объекта без чертежа углов нет, и ни одного поля не появляется", () => {
  const bare = createProject();
  const before = JSON.stringify(bare);
  assert.deepEqual(wallCorners(bare, "нет-такой"), []);
  assert.deepEqual(wallNames(bare, "нет-такой"), []);
  assert.equal(wallName(bare, "нет-такой"), "");
  assert.equal(JSON.stringify(bare), before);
  assert.ok(!("walls" in bare), "списка стен у объекта без чертежа нет вовсе");
});

// ——— буквы ————————————————————————————————————————————————————————————

test("неудобные буквы пропущены — список взят у ГОСТ 21.101", () => {
  // Ровно эти одиннадцать букв ГОСТ запрещает для координационных осей, то
  // есть для того же дела: Ё и Й теряют точки при печати, З и О читаются как
  // 3 и 0, Х похожа на знак умножения, Ц, Ч и Щ путаются между собой, а Ъ, Ы
  // и Ь прописными не бывают.
  for (const letter of "ЁЗЙОХЦЧЩЪЫЬ") {
    assert.ok(!WALL_LETTERS.includes(letter), "буква " + letter + " не должна попадать в обозначения");
  }
  assert.equal(WALL_LETTERS.length, 22);
  assert.equal(new Set(WALL_LETTERS).size, 22, "повторов быть не должно");
});

test("после алфавита идут двухбуквенные", () => {
  assert.equal(wallCornerLetter(0), "А");
  assert.equal(wallCornerLetter(21), "Я");
  assert.equal(wallCornerLetter(22), "АА");
  assert.equal(wallCornerLetter(23), "АБ");
  assert.equal(wallCornerLetter(43), "АЯ");
  assert.equal(wallCornerLetter(44), "БА");
  assert.equal(wallCornerLetter(505), "ЯЯ");
  assert.equal(wallCornerLetter(506), "ААА", "и дальше трёхбуквенные, а не повтор");
  // Повторов в первых пяти сотнях нет ни одного — иначе две стены звались бы
  // одинаково.
  const all = [];
  for (let index = 0; index < 506; index += 1) all.push(wallCornerLetter(index));
  assert.equal(new Set(all).size, 506);
});

test("двухбуквенные углы пишутся через дефис — иначе имя читается двояко", () => {
  assert.equal(wallNameOf("А", "Б"), "АБ");
  // «ААБ» слитно читалось бы и как «АА + Б», и как «А + АБ».
  assert.equal(wallNameOf("АА", "Б"), "АА-Б");
  assert.equal(wallNameOf("А", "АБ"), "А-АБ");
  assert.equal(wallNameOf("АА", "АБ"), "АА-АБ");
  assert.equal(wallNameOf("", "Б"), "");
});

test("на чертеже из двадцати трёх углов появляется АА", () => {
  // Лестница из двадцати двух стен: двадцать три угла, последнему букв
  // алфавита уже не хватает.
  const steps = [];
  for (let index = 0; index < 22; index += 1) {
    steps.push([
      { x: index * 1000, y: index * 1000 },
      { x: (index + 1) * 1000, y: (index + 1) * 1000 },
    ]);
  }
  const scene = withWalls(bareScheme(), steps, 100);
  const corners = wallCorners(scene.project, scene.schemeId);
  assert.equal(corners.length, 23);
  assert.equal(corners[21].letter, "Я");
  assert.equal(corners[22].letter, "АА");
  assert.equal(wallName(scene.project, scene.wallIds[21]), "Я-АА");
});

// ——— перпендикулярные стены на развёртке ——————————————————————————————

// Комната 4000 × 3000 и перегородки, упирающиеся в её нижнюю стену изнутри.
// Нижняя стена идёт справа налево (от (4000, 3000) к (0, 3000)), значит внутрь
// комнаты смотрит её **правая** сторона.
function crossScene(extra = [], thicknessMm = 100) {
  const room = withWalls(bareScheme(), ROOM);
  const added = withWalls({ ...room, project: room.project }, extra, thicknessMm);
  return { ...added, wallIds: room.wallIds, extraIds: added.wallIds, bottomId: room.wallIds[2] };
}

test("перпендикулярная стена видна на развёртке с торца, на своём месте", () => {
  // Перегородка 100 мм упирается в грань нижней стены по середине.
  const scene = crossScene([[{ x: 2000, y: 2900 }, { x: 2000, y: 1500 }]]);
  const inside = wallCrossings(scene.project, scene.bottomId, "right");
  const partition = inside.find((item) => item.wallId === scene.extraIds[0]);
  assert.ok(partition, "перегородки нет на развёртке");
  assert.deepEqual(
    { from: partition.fromMm, to: partition.toMm },
    { from: 1950, to: 2050 },
    "торец встал своей толщиной вокруг места, где перегородка упирается",
  );
  assert.equal(partition.name, wallName(scene.project, scene.extraIds[0]), "и подписан своим именем");
  // Имя делит с нашей стеной букву общего угла? Нет: перегородка упёрлась в
  // середину грани, а не в конец — там концы стен не сошлись, и угол свой.
  assert.ok(partition.name.length === 2);
});

test("смежные стены комнаты видны на развёртке своими торцами", () => {
  const scene = crossScene();
  const inside = wallCrossings(scene.project, scene.bottomId, "right");
  // Правая и левая стены комнаты (200 мм) занимают по сто миллиметров у
  // краёв: ровно столько нижней стены и съедает угол.
  assert.deepEqual(
    inside.map((item) => [item.name, item.fromMm, item.toMm]),
    [
      ["БВ", 0, 100],
      ["АГ", 3900, 4000],
    ],
  );
  // И каждая делит с нижней стеной букву общего угла — по имени видно, что это
  // её угол, а не чужая стена.
  const own = wallName(scene.project, scene.bottomId);
  for (const item of inside) {
    assert.ok([...item.name].some((letter) => own.includes(letter)), item.name + " и " + own + " не сходятся");
  }
});

test("перегородка с другой стороны на этой развёртке не показана", () => {
  const scene = crossScene([[{ x: 2000, y: 2900 }, { x: 2000, y: 1500 }]]);
  const outside = wallCrossings(scene.project, scene.bottomId, "left");
  assert.deepEqual(
    outside.map((item) => item.wallId),
    [],
    "снаружи не видно ни перегородки, ни углов комнаты: они за стеной",
  );
});

test("стена, прошедшая сквозь нашу, видна с обеих сторон", () => {
  const scene = crossScene([[{ x: 2000, y: 2000 }, { x: 2000, y: 4000 }]]);
  for (const side of ["left", "right"]) {
    const found = wallCrossings(scene.project, scene.bottomId, side).filter(
      (item) => item.wallId === scene.extraIds[0],
    );
    assert.equal(found.length, 1, "сквозная стена обязана быть видна со стороны " + side);
  }
});

test("отступ торца зеркалится вместе со стороной", () => {
  // Перегородка ближе к концу `a` нижней стены (x = 4000).
  const scene = crossScene([[{ x: 3500, y: 2900 }, { x: 3500, y: 1500 }]]);
  const inside = wallCrossings(scene.project, scene.bottomId, "right").find(
    (item) => item.wallId === scene.extraIds[0],
  );
  // Нижняя стена идёт от x = 4000: отступ 500 от её конца `a`.
  assert.deepEqual({ from: inside.fromMm, to: inside.toMm }, { from: 450, to: 550 });
  // А та же перегородка, видимая с левой стороны (если бы она торчала наружу),
  // легла бы зеркально — проверяем на сквозной.
  const through = crossScene([[{ x: 3500, y: 2000 }, { x: 3500, y: 4000 }]]);
  const left = wallCrossings(through.project, through.bottomId, "left").find(
    (item) => item.wallId === through.extraIds[0],
  );
  assert.deepEqual({ from: left.fromMm, to: left.toMm }, { from: 3450, to: 3550 });
});

test("косая стена считается упирающейся, и место её шире толщины", () => {
  // Косая под 45°: торец ложится на стену в √2 раза шире своей толщины —
  // ровно столько места она и занимает.
  const scene = crossScene([[{ x: 2000, y: 3000 }, { x: 3000, y: 2000 }]]);
  const inside = wallCrossings(scene.project, scene.bottomId, "right").find(
    (item) => item.wallId === scene.extraIds[0],
  );
  assert.ok(inside, "косая стена — такой же угол, как прямая");
  const width = inside.toMm - inside.fromMm;
  assert.ok(Math.abs(width - Math.round(100 * Math.SQRT2)) <= 1, "ширина торца: " + width);
});

test("стена почти вдоль — не угол, а второй слой", () => {
  // Пять градусов к нижней стене: торец размазался бы на одиннадцать её
  // толщин и читался бы участком стены, а не углом.
  const scene = crossScene([[{ x: 1000, y: 2860 }, { x: 2000, y: 2773 }]]);
  assert.deepEqual(
    wallCrossings(scene.project, scene.bottomId, "right")
      .filter((item) => item.wallId === scene.extraIds[0])
      .map((item) => item.name),
    [],
  );
  assert.ok(WALL_CROSS_MIN_DEG > 5 && WALL_CROSS_MIN_DEG < 90);
});

test("конец, не доехавший до грани на сантиметр, остаётся углом", () => {
  const scene = crossScene([
    // Не доехала 40 мм — неточность чертежа.
    [{ x: 2000, y: 2860 }, { x: 2000, y: 1500 }],
    // Отошла на 300 мм — это человек оставил нарочно.
    [{ x: 1000, y: 2600 }, { x: 1000, y: 1500 }],
  ]);
  const inside = wallCrossings(scene.project, scene.bottomId, "right");
  assert.ok(
    inside.some((item) => item.wallId === scene.extraIds[0]),
    "сорок миллиметров щели — всё ещё угол",
  );
  assert.ok(
    !inside.some((item) => item.wallId === scene.extraIds[1]),
    "триста миллиметров щели — уже не угол",
  );
  assert.ok(WALL_CROSS_REACH_MM >= 50 && WALL_CROSS_REACH_MM < 300);
});

test("стена за концом нашей на развёртку не попадает", () => {
  const scene = crossScene([[{ x: 4600, y: 2900 }, { x: 4600, y: 1500 }]]);
  assert.deepEqual(
    wallCrossings(scene.project, scene.bottomId, "right").filter((item) => item.wallId === scene.extraIds[0]),
    [],
  );
});

test("развёртка несёт имя стены, буквы её краёв и упирающиеся стены", () => {
  const scene = crossScene([[{ x: 2000, y: 2900 }, { x: 2000, y: 1500 }]]);
  const inside = wallElevation(scene.project, scene.bottomId, "right");
  assert.equal(inside.name, "ВГ");
  // Нижняя стена идёт от В (4000, 3000) к Г (0, 3000). С правой стороны
  // отсчёт идёт от её конца `a`, то есть слева на листе стоит В.
  assert.deepEqual({ from: inside.fromLetter, to: inside.toLetter }, { from: "В", to: "Г" });
  const outside = wallElevation(scene.project, scene.bottomId, "left");
  assert.deepEqual(
    { from: outside.fromLetter, to: outside.toLetter },
    { from: "Г", to: "В" },
    "с левой стороны отсчёт зеркалится — и углы меняются местами",
  );
  assert.equal(inside.crossings.length, 3, "перегородка и два угла комнаты");
  assert.deepEqual(outside.crossings, []);
});

test("метка привязана к стене — имя стены при этом не меняется", () => {
  const scene = crossScene();
  const typeId = scene.project.markTypes.find((type) => type.code === "Р").id;
  const before = wallName(scene.project, scene.bottomId);
  // Метка ставится долями плана, и у схемы без подложки они свои; имя стены от
  // разметки не зависит вовсе — считается по чертежу.
  const added = addMark(scene.project, { schemeId: scene.schemeId, typeId, points: [{ x: 0.5, y: 0.9 }] });
  assert.equal(wallName(added.project, scene.bottomId), before);
});
