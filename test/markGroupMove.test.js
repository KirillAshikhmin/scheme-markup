// Группа двигается как одна метка (таск 136, G189).
//
// Заказчик: «группы выключателей\розеток давай двигать вместе, как одну метку
// по умолчанию, а с зажатым ctrl\command уже отдельно каждую точку». До этого
// рамка, собранная ручкой «+», разъезжалась по одной метке.
//
// Группа здесь — та, что в ADR 004 зовётся «каждая своя»: самостоятельные
// метки, связанные `group {markIds}`. Второй механизм того же ADR — «одна
// метка на блок» — ездил целиком всегда, и это тоже проверяется: правило одно
// на оба, третьего механизма не заведено.
//
// Сам обработчик DOM отсюда не поднимается (его проверяет живой прогон) —
// проверяются чистые правила: кого везёт жест, что с ними делает сдвиг и
// сколько шагов истории получается.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { canvasDragSolo, canvasMoveIds, canvasMoveMarks } from "../src/canvas.js";
import {
  addMark,
  addScheme,
  addToGroup,
  blockStepPx,
  createProject,
  findGroup,
  findMark,
  updateType,
} from "../src/model.js";
import { packProject, unpackProject } from "../src/projectFile.js";

const WIDTH = 1200;
const HEIGHT = 800;
const MARK_SIZE = 10;

const typeId = (project, code) => project.markTypes.find((type) => type.code === code).id;

/**
 * Рамка розеток, собранная ручкой «+»: три метки вплотную, связанные группой.
 * Ровно то, что заказчик собирает на плане и что разъезжалось по одной.
 */
function frame(count = 3, code = "Р") {
  const made = addScheme(createProject({ name: "Блок" }), { name: "1 этаж", width: WIDTH, height: HEIGHT });
  let project = made.project;
  const first = addMark(project, {
    schemeId: made.scheme.id,
    typeId: typeId(project, code),
    kind: "point",
    points: [{ x: 0.4, y: 0.5 }],
  });
  project = first.project;
  const ids = [first.mark.id];
  for (let index = 1; index < count; index += 1) {
    const grown = addToGroup(project, ids[ids.length - 1], "right", { step: blockStepPx(MARK_SIZE) });
    project = grown.project;
    ids.push(grown.mark.id);
  }
  return { project, scheme: project.schemes[0], ids, groupId: findMark(project, ids[0]).groupId };
}

const pointsOf = (project, ids) => ids.map((id) => findMark(project, id).points.map((point) => ({ ...point })));

// ——— чем разнимают группу ——————————————————————————————————————————————

test("группу разнимает Ctrl на Windows и Cmd на Mac — обе клавиши, как у копирования", () => {
  assert.equal(canvasDragSolo({ ctrlKey: true, metaKey: false }), true);
  assert.equal(canvasDragSolo({ ctrlKey: false, metaKey: true }), true, "Cmd на Mac группу не разнял");
  assert.equal(canvasDragSolo({ ctrlKey: false, metaKey: false }), false);
  // Alt занят свободным ведением (без притяжки к направляющим) и группу не
  // разнимает: иначе одна клавиша отвечала бы за две разные вещи.
  assert.equal(canvasDragSolo({ altKey: true, shiftKey: true }), false);
  assert.equal(canvasDragSolo(null), false);
});

// ——— кого везёт жест ——————————————————————————————————————————————————

test("по умолчанию жест везёт всю группу, с Ctrl — одну взятую метку", () => {
  const built = frame(3);
  const middle = built.ids[1];
  assert.deepEqual(
    canvasMoveIds(built.project, middle, built.groupId, false).slice().sort(),
    built.ids.slice().sort(),
    "взяли метку из блока, а поехала не вся группа",
  );
  assert.deepEqual(canvasMoveIds(built.project, middle, built.groupId, true), [middle]);
  // Порядок — модельный `blockMembers`, своей сортировки холст не заводит.
  assert.deepEqual(
    canvasMoveIds(built.project, middle, built.groupId, false),
    findGroup(built.project, built.groupId).markIds,
  );
});

test("одинокая метка остаётся одинокой, а висячая группа не роняет жест", () => {
  const built = frame(1);
  const [only] = built.ids;
  assert.equal(built.groupId, null, "у одной метки завелась группа");
  assert.deepEqual(canvasMoveIds(built.project, only, null, false), [only]);
  // Группы с таким id в объекте нет — везём то, что взяли, а не падаем.
  assert.deepEqual(canvasMoveIds(built.project, only, "group-which-is-gone", false), [only]);
  assert.deepEqual(canvasMoveIds(built.project, null, null, false), []);
});

// ——— что делает сдвиг —————————————————————————————————————————————————

test("группа едет целиком и не меняет формы: взаимные расстояния те же", () => {
  const built = frame(3);
  const before = pointsOf(built.project, built.ids);
  const shift = { x: 0.1, y: -0.05 };
  const after = canvasMoveMarks(built.project, canvasMoveIds(built.project, built.ids[1], built.groupId, false), shift);
  const moved = pointsOf(after, built.ids);
  built.ids.forEach((id, index) => {
    assert.ok(Math.abs(moved[index][0].x - (before[index][0].x + shift.x)) < 1e-12, "метка блока уехала не на тот сдвиг");
    assert.ok(Math.abs(moved[index][0].y - (before[index][0].y + shift.y)) < 1e-12, "метка блока уехала не на тот сдвиг");
  });
  // Шаг между соседями — тот же: рамка не растянулась и не сжалась.
  const gapBefore = before[1][0].x - before[0][0].x;
  const gapAfter = moved[1][0].x - moved[0][0].x;
  assert.ok(Math.abs(gapBefore - gapAfter) < 1e-12, "рамка розеток разъехалась при переносе");
  // Группа цела: состав и связи не тронуты, переехали только координаты.
  assert.deepEqual(findGroup(after, built.groupId).markIds, findGroup(built.project, built.groupId).markIds);
});

test("с Ctrl едет одна метка, а соседи остаются побайтно теми же", () => {
  const built = frame(3);
  const middle = built.ids[1];
  const after = canvasMoveMarks(built.project, canvasMoveIds(built.project, middle, built.groupId, true), { x: 0.2, y: 0.2 });
  assert.notDeepEqual(findMark(after, middle).points, findMark(built.project, middle).points);
  for (const id of [built.ids[0], built.ids[2]]) {
    assert.deepEqual(findMark(after, id), findMark(built.project, id), "сосед поехал вместе со взятой меткой");
  }
  // Метка из блока не выпала: разняли жест, а не блок.
  assert.equal(findMark(after, middle).groupId, built.groupId);
});

test("«одна метка на блок» (ADR 004) ездила целиком и ездит: правило одно на оба механизма", () => {
  const made = addScheme(createProject({ name: "Блок одной меткой" }), { name: "1 этаж", width: WIDTH, height: HEIGHT });
  let project = updateType(made.project, typeId(made.project, "Р"), { blockMode: "single" }).project;
  const first = addMark(project, {
    schemeId: made.scheme.id,
    typeId: typeId(project, "Р"),
    kind: "point",
    points: [{ x: 0.4, y: 0.5 }],
  });
  project = addToGroup(first.project, first.mark.id, "right", { step: blockStepPx(MARK_SIZE) }).project;
  const host = findMark(project, first.mark.id);
  assert.equal(host.points.length, 2, "второй механизм дал не одну метку с двумя точками");
  assert.equal(host.groupId, null, "у метки-блока завелась ещё и группа — это третий механизм");
  // Группы нет, везётся сама метка — и обе её точки уезжают на один сдвиг.
  const ids = canvasMoveIds(project, host.id, host.groupId, false);
  assert.deepEqual(ids, [host.id]);
  const after = canvasMoveMarks(project, ids, { x: 0.05, y: 0.05 });
  findMark(after, host.id).points.forEach((point, index) => {
    assert.ok(Math.abs(point.x - (host.points[index].x + 0.05)) < 1e-12, "точка блока уехала не на тот сдвиг");
    assert.ok(Math.abs(point.y - (host.points[index].y + 0.05)) < 1e-12, "точка блока уехала не на тот сдвиг");
  });
});

test("исчезнувшая метка в списке не роняет перенос остальных", () => {
  const built = frame(2);
  const after = canvasMoveMarks(built.project, [built.ids[0], "mark-which-is-gone", built.ids[1]], { x: 0.01, y: 0 });
  assert.equal(findMark(after, built.ids[0]).points[0].x, findMark(built.project, built.ids[0]).points[0].x + 0.01);
  assert.equal(findMark(after, built.ids[1]).points[0].x, findMark(built.project, built.ids[1]).points[0].x + 0.01);
});

// ——— G68: блок прежнего объекта подчиняется новому правилу ——————————————

test("G68: группа из объекта прежнего формата открывается как была и едет целиком", async () => {
  const old = {
    formatVersion: 1,
    id: "old-project",
    name: "Объект прежнего формата",
    createdAt: "2026-01-01T00:00:00+03:00",
    updatedAt: "2026-01-01T00:00:00+03:00",
    categories: [{ id: "cat-1", name: "Розетки", color: "#D1242F", shape: "circle-socket", order: 0 }],
    markTypes: [{ id: "type-1", categoryId: "cat-1", code: "Р", name: "Розетка", shape: null, blockMode: "each", order: 0 }],
    rooms: [],
    schemes: [{ id: "scheme-1", name: "1 этаж", imageId: null, width: 1000, height: 1000, order: 0 }],
    marks: [
      { id: "mark-1", schemeId: "scheme-1", typeId: "type-1", number: 1, kind: "point", points: [{ x: 0.4, y: 0.5 }], groupId: "group-1", labelOffset: null },
      { id: "mark-2", schemeId: "scheme-1", typeId: "type-1", number: 2, kind: "point", points: [{ x: 0.42, y: 0.5 }], groupId: "group-1", labelOffset: null },
    ],
    groups: [{ id: "group-1", schemeId: "scheme-1", markIds: ["mark-1", "mark-2"], labelOffset: null }],
    counters: { Р: 2 },
    view: { markSize: 10, labelSize: 12 },
  };
  const opened = (await unpackProject(await packProject(old, new Map()))).project;
  // Открылся как закрывался: ни одна метка не изменилась ни на поле, ни на долю.
  assert.deepEqual(opened.marks, old.marks.map((mark) => ({ ...mark })), "метка старого объекта изменилась");
  assert.deepEqual(opened.groups, old.groups.map((group) => ({ ...group })), "группа старого объекта изменилась");

  // А новое правило на неё распространяется — это исправление, а не поломка:
  // взяли вторую метку, поехали обе.
  const ids = canvasMoveIds(opened, "mark-2", "group-1", false);
  assert.deepEqual(ids, ["mark-1", "mark-2"]);
  const after = canvasMoveMarks(opened, ids, { x: 0.1, y: 0 });
  assert.deepEqual(
    after.marks.map((mark) => mark.points[0].x.toFixed(6)),
    ["0.500000", "0.520000"],
  );
  // Перенос — обычная правка координат: ничего, кроме точек, не тронуто.
  for (const mark of after.marks) {
    const was = old.marks.find((item) => item.id === mark.id);
    assert.deepEqual({ ...mark, points: was.points }, was, "перенос блока тронул не только координаты");
  }
});

// ——— один жест — один шаг истории ——————————————————————————————————————

const SOURCE = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "src", "canvas.js"), "utf8");
const withoutComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, "");
const bodyOf = (name) => {
  const rest = SOURCE.slice(SOURCE.indexOf(name));
  return withoutComments(rest.slice(0, rest.indexOf("\nfunction ")));
};

test("перенос группы — один шаг истории, а не по шагу на метку", () => {
  // Ctrl+Z обязан вернуть блок целиком. Держится это тем, что весь жест даёт
  // один объект «после» и один вызов `canvasCommit`: цикл по меткам живёт
  // внутри `canvasMoveMarks`, а не вокруг команды истории.
  const body = bodyOf("function canvasPointerUp(");
  const commits = body.split("canvasCommit(").length - 1;
  assert.ok(commits > 0, "отпускание больше не пишет в историю — проверять нечего");
  const branch = body.slice(body.indexOf('drag.kind === "mark" || drag.kind === "label"'));
  assert.equal(
    branch.slice(0, branch.indexOf("}")).split("canvasCommit(").length - 1,
    1,
    "перенос пишет в историю больше одного раза — Ctrl+Z вернёт половину блока",
  );
  // Внутри переноса нет ни цикла, ни второй команды модели: объект «после»
  // собирает `canvasMoveMarks` одним проходом.
  const moveBody = bodyOf("export function canvasMoveMarks(");
  assert.ok(moveBody.includes("updateMark("), "перенос перестал ходить в модель");
  assert.ok(!withoutComments(bodyOf("function canvasDragTo(")).includes("for (const id of"), "цикл по меткам вернулся в ведение");
});

test("кого везти, решается на нажатии — один раз на жест", () => {
  // Жест, меняющий смысл посреди ведения, нельзя ни показать выделением, ни
  // отменить одним шагом: список меток собирается в `canvasPointerDown` и
  // дальше только читается.
  const down = withoutComments(bodyOf("function canvasPointerDown("));
  assert.ok(down.includes("canvasMoveIds("), "список везомых меток больше не собирается на нажатии");
  assert.ok(down.includes("canvasDragSolo(event)"), "Ctrl/Cmd на нажатии не спрашивается");
  const move = withoutComments(bodyOf("function canvasPointerMove("));
  assert.ok(!move.includes("canvasMoveIds("), "состав группы пересчитывается посреди ведения");
});
