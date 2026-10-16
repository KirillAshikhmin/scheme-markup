// Ручная привязка метки к стене — по именам стен (таск 143, требование G202).
//
// Слова заказчика: «Сделай ручную привязку меток к стене, при чем уже именно по
// обозначениям из задачи 2… Ну и привязку в свойствах метки должна быть
// возможность убрать».
//
// Правило взято у помещения (`roomManual`) и повторено один в один: поставил
// руками — автоматика больше не перебивает. Третьего способа в сборке нет.
//
// Чего ручная привязка **не** назначает: отступ вдоль стены. Человек говорит
// «эта метка на стене БВ», а метр на стене остаётся следствием места метки —
// иначе подвинутая вдоль стены розетка осталась бы на развёртке стоять там,
// где её привязали (дефект D27 ровно про такой разъезд).
import test from "node:test";
import assert from "node:assert/strict";

import {
  MARK_WALL_REACH_MM,
  addMark,
  addScheme,
  addWall,
  applyMarkWalls,
  createProject,
  deleteWall,
  findMark,
  markWall,
  markWallAlong,
  markWallManual,
  planMmToFraction,
  setMarkWall,
  setPlanOrigin,
  setPlanScale,
  setSchemeWallHeight,
  updateMark,
  wallName,
  wallNames,
} from "../src/model.js";
import { packProject, unpackProject } from "../src/projectFile.js";
import { marksWallChoices, marksWallText } from "../src/panels/marks.js";

// Комната четыре на три метра: стены по 200, нуль чертежа в середине, сто
// точек плана на метр. Та же сцена, что в `markWall.test.js`.
function room() {
  const added = addScheme(createProject(), { name: "1 этаж", imageId: "plan-1", width: 1200, height: 800 });
  let project = setPlanScale(added.project, added.scheme.id, {
    a: { x: 0.1, y: 0.5 },
    b: { x: 0.6, y: 0.5 },
    meters: 6,
  }).project;
  project = setPlanOrigin(project, added.scheme.id, { at: { x: 0.5, y: 0.5 }, turn: 0 }).project;
  const corners = [
    [{ x: -2000, y: -1500 }, { x: 2000, y: -1500 }],
    [{ x: 2000, y: -1500 }, { x: 2000, y: 1500 }],
    [{ x: 2000, y: 1500 }, { x: -2000, y: 1500 }],
    [{ x: -2000, y: 1500 }, { x: -2000, y: -1500 }],
  ];
  const wallIds = [];
  for (const [aMm, bMm] of corners) {
    const put = addWall(project, { schemeId: added.scheme.id, aMm, bMm, thicknessMm: 200 });
    project = put.project;
    wallIds.push(put.wall.id);
  }
  project = setSchemeWallHeight(project, added.scheme.id, 2700).project;
  return { project, schemeId: added.scheme.id, wallIds };
}

const typeId = (project, code) => project.markTypes.find((type) => type.code === code).id;

function putMark(project, schemeId, code, pointMm) {
  const added = addMark(project, {
    schemeId,
    typeId: typeId(project, code),
    points: [planMmToFraction(project, schemeId, pointMm)],
  });
  return { project: applyMarkWalls(added.project).project, markId: added.mark.id };
}

// Привязать рукой так, как это делает панель: стену называет человек, отступ
// считает модель.
function bindByHand(project, markId, wallId) {
  const along = wallId ? markWallAlong(project, findMark(project, markId), wallId) : null;
  return setMarkWall(project, markId, along, { manual: true }).project;
}

test("стены названы по-человечески, и выбор идёт по этим именам", () => {
  const box = room();
  const names = wallNames(box.project, box.schemeId).map((item) => item.name);
  assert.deepEqual(names, ["АБ", "БВ", "ВГ", "АГ"], "имена стен комнаты разошлись с таском 142");

  // Розетка у нижней стены (ВГ): автоматика привязала её сама.
  const put = putMark(box.project, box.schemeId, "Р", { x: 0, y: 1300 });
  assert.equal(markWall(findMark(put.project, put.markId)).wallId, box.wallIds[2]);
  assert.equal(wallName(put.project, box.wallIds[2]), "ВГ");
  // И сказала об этом строкой с именем стены.
  assert.equal(marksWallText(put.project, findMark(put.project, put.markId)), "На стене ВГ, 2 м от угла");

  // Выбор для руки — все четыре стены схемы, каждая с именем, отступом и, если
  // стена далеко, с расстоянием до неё.
  const choices = marksWallChoices(put.project, findMark(put.project, put.markId));
  assert.deepEqual(choices.map((item) => item.name), ["АБ", "БВ", "ВГ", "АГ"]);
  const near = choices.find((item) => item.wallId === box.wallIds[2]);
  assert.deepEqual({ atMm: near.atMm, gapMm: near.gapMm }, { atMm: 2000, gapMm: 100 });
  assert.equal(near.text, "ВГ · 2 м");
  // Верхняя стена — та же метка, но до её грани 2,7 м: выбрать её человек
  // вправе, а молчать о расстоянии нельзя.
  const far = choices.find((item) => item.wallId === box.wallIds[0]);
  assert.ok(far.gapMm > MARK_WALL_REACH_MM);
  assert.equal(far.text, "АБ · 2 м, 2,7 м от стены");
});

test("выбранную рукой стену автоматика не перебивает", () => {
  const box = room();
  // Метка стоит у нижней стены (ВГ) — автоматика взяла её.
  const put = putMark(box.project, box.schemeId, "Р", { x: 1700, y: 1300 });
  assert.equal(markWall(findMark(put.project, put.markId)).wallId, box.wallIds[2]);

  // Человек говорит: нет, она на правой стене (БВ). Там и остаётся — сколько
  // бы раз объект ни правили.
  const hand = bindByHand(put.project, put.markId, box.wallIds[1]);
  const mark = findMark(hand, put.markId);
  assert.equal(markWallManual(mark), true);
  assert.equal(markWall(mark).wallId, box.wallIds[1]);
  const again = applyMarkWalls(applyMarkWalls(hand).project).project;
  assert.equal(markWall(findMark(again, put.markId)).wallId, box.wallIds[1], "автоматика отобрала стену у руки");
  assert.equal(marksWallText(again, findMark(again, put.markId)), "На стене БВ, 2,8 м от угла");
});

test("рукой выбирают стену, а не метр на ней: отступ едет за меткой", () => {
  const box = room();
  const put = putMark(box.project, box.schemeId, "Р", { x: 1700, y: 1300 });
  let project = bindByHand(put.project, put.markId, box.wallIds[1]);
  assert.equal(markWall(findMark(project, put.markId)).atMm, 2800);

  // Метку подняли на метр вверх по плану. Стена та же — её назвала рука, —
  // а отступ пересчитался: на развёртке метка стоит там, где стоит на плане.
  project = updateMark(project, put.markId, {
    points: [planMmToFraction(project, box.schemeId, { x: 1700, y: 300 })],
  }).project;
  project = applyMarkWalls(project).project;
  const moved = markWall(findMark(project, put.markId));
  assert.equal(moved.wallId, box.wallIds[1], "стена, выбранная рукой, уехала за меткой");
  assert.equal(moved.atMm, 1800, "отступ вдоль ручной стены не пересчитался");
});

test("привязку можно снять рукой, и автоматика её не возвращает", () => {
  const box = room();
  const put = putMark(box.project, box.schemeId, "Р", { x: 0, y: 1300 });
  assert.ok(markWall(findMark(put.project, put.markId)), "метка у стены не привязалась");

  const bare = bindByHand(put.project, put.markId, null);
  assert.equal(markWall(findMark(bare, put.markId)), null);
  assert.equal(markWallManual(findMark(bare, put.markId)), true);
  const after = applyMarkWalls(bare).project;
  assert.equal(markWall(findMark(after, put.markId)), null, "снятая рукой привязка вернулась сама");
  assert.equal(marksWallText(after, findMark(after, put.markId)), "", "строка стены осталась у метки без стены");
  // Метка при этом никуда не уехала: привязка — следствие места, а не наоборот.
  assert.deepEqual(findMark(after, put.markId).points, findMark(put.project, put.markId).points);
});

test("метку можно вернуть автоматике — тем же способом, что помещение", () => {
  const box = room();
  const put = putMark(box.project, box.schemeId, "Р", { x: 0, y: 1300 });
  const hand = bindByHand(put.project, put.markId, box.wallIds[0]);
  assert.equal(markWall(findMark(hand, put.markId)).wallId, box.wallIds[0]);

  // «По месту метки» — признак снят, и ближайший пересчёт ставит стену по
  // месту: нижнюю, у которой метка и стоит.
  const back = setMarkWall(hand, put.markId, null).project;
  assert.equal(markWallManual(findMark(back, put.markId)), false);
  const auto = applyMarkWalls(back).project;
  assert.equal(markWall(findMark(auto, put.markId)).wallId, box.wallIds[2]);
});

test("стену, которой больше нет, не удержит и рука", () => {
  const box = room();
  const put = putMark(box.project, box.schemeId, "Р", { x: 0, y: 1300 });
  const hand = bindByHand(put.project, put.markId, box.wallIds[0]);
  // Верхнюю стену удалили: выбора больше не существует, и метка возвращается
  // автоматике вместе с признаком — иначе она осталась бы без стены навсегда.
  const gone = deleteWall(hand, box.wallIds[0]).project;
  assert.equal(markWallManual(findMark(gone, put.markId)), false);
  assert.equal(markWall(findMark(gone, put.markId)), null);
  const auto = applyMarkWalls(gone).project;
  assert.equal(markWall(findMark(auto, put.markId)).wallId, box.wallIds[2], "метка не вернулась автоматике");
});

test("G68: метка прежней разметки признака не знает и привязана автоматикой", async () => {
  const box = room();
  const put = putMark(box.project, box.schemeId, "Р", { x: 0, y: 1300 });
  const mark = findMark(put.project, put.markId);
  // Поля в метке нет вовсе — ни `true`, ни `false`.
  assert.equal(Object.prototype.hasOwnProperty.call(mark, "wallManual"), false);
  assert.equal(markWallManual(mark), false);

  // Круг «упаковать — распаковать» поля не дописывает.
  const packedAt = new Date(2026, 0, 1, 12, 0, 0);
  const opened = (await unpackProject(await packProject(put.project, new Map(), { date: packedAt }))).project;
  assert.equal(Object.prototype.hasOwnProperty.call(findMark(opened, put.markId), "wallManual"), false);

  // А привязанная рукой и снятая рукой метка после того же круга остаётся
  // такой, какой была: признак — обычное поле объекта.
  const hand = bindByHand(put.project, put.markId, box.wallIds[1]);
  const back = (await unpackProject(await packProject(hand, new Map(), { date: packedAt }))).project;
  assert.equal(markWallManual(findMark(back, put.markId)), true);
  assert.equal(markWall(findMark(back, put.markId)).wallId, box.wallIds[1]);
});
