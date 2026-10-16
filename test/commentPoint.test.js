// Точка комментария двигается отдельно от плашки (таск 141, G199).
//
// Слова заказчика: «У комментария должна быть возможность сдвигать метку, куда
// указывает независимо от текст». У комментария с указателем на плане две
// сущности — плашка с текстом и точка, в которую смотрит остриё, — и обе живут
// в одной метке: точка это `points[0]` (доли плана, ADR 002), плашка отведена
// пиксельным `labelOffset` (таск 116).
//
// Отсюда и всё, что здесь проверяется. Перенос плашки был независимым и
// раньше: правится смещение, точка стоит. А перенос точки тащил плашку за
// собой — смещение-то считается от точки. Развести их нового поля не
// потребовало: точку везёт обычная правка `points`, а плашка остаётся на месте
// поправкой того же смещения на тот же сдвиг со знаком минус.
//
// Сам обработчик DOM отсюда не поднимается (его проверяет живой прогон) —
// проверяются чистые правила: кто забирает клик, что делает сдвиг, как
// называется шаг истории и что прежний комментарий открывается как был.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { canvasDragsCommentPoint, canvasMoveCommentPoint, canvasMoveMarks, canvasMoveStepLabel } from "../src/canvas.js";
import {
  COMMENT_TYPE_ID,
  MARK_KIND_COMMENT,
  addMark,
  addScheme,
  addToGroup,
  blockStepPx,
  createProject,
  findMark,
  migrateCommentType,
  setMarkPointer,
  typeKindOf,
  updateMark,
} from "../src/model.js";
import {
  commentPointRadius,
  hitTest,
  labelBox,
  markRadius,
  planToScreen,
  renderInternals,
} from "../src/render.js";
import { markCardModel } from "../src/panels/markCard.js";
import { packProject, unpackProject } from "../src/projectFile.js";
import { strings } from "../src/strings.js";

const WIDTH = 1000;
const HEIGHT = 500;
const view = { zoom: 1, offsetX: 0, offsetY: 0, markSize: 10, labelSize: 12 };

/**
 * План с розеткой и комментарием. `offset` — отведённая рукой плашка, то есть
 * ровно тот случай, ради которого таск и существует: текст стоит в свободном
 * месте, остриё смотрит на точку.
 */
function scene({ pointer = true, offset = { dx: 150, dy: -80 } } = {}) {
  const made = addScheme(createProject({ name: "Комментарий" }), { name: "1 этаж", width: WIDTH, height: HEIGHT });
  let project = made.project;
  const schemeId = made.scheme.id;
  const socket = addMark(project, {
    schemeId,
    typeId: project.markTypes.find((type) => type.code === "Р").id,
    kind: "point",
    points: [{ x: 0.2, y: 0.5 }],
  });
  project = socket.project;
  const note = addMark(project, {
    schemeId,
    typeId: COMMENT_TYPE_ID,
    kind: typeKindOf(project, COMMENT_TYPE_ID),
    points: [{ x: 0.6, y: 0.5 }],
  });
  project = updateMark(note.project, note.mark.id, { original: "Щит в коридоре" }).project;
  if (pointer) project = setMarkPointer(project, note.mark.id, true).project;
  if (offset) project = updateMark(project, note.mark.id, { labelOffset: offset }).project;
  return { project, scheme: project.schemes[0], socketId: socket.mark.id, noteId: note.mark.id };
}

const pointAt = (project, scheme, markId) => planToScreen(findMark(project, markId).points[0], scheme, view);
const plateOf = (project, scheme, markId) => labelBox(project, scheme, findMark(project, markId), view, null);
const plateCorner = (box) => ({ x: box.x, y: box.y });

// ——— кто забирает клик ————————————————————————————————————————————————

test("у комментария с указателем две ручки: плашка отдаёт «label», точка — «mark»", () => {
  const built = scene();
  const plate = plateOf(built.project, built.scheme, built.noteId);
  const inPlate = { x: plate.x + plate.width / 2, y: plate.y + plate.height / 2 };
  const onPoint = pointAt(built.project, built.scheme, built.noteId);

  const plateHit = hitTest(built.project, built.scheme, inPlate, view, null);
  assert.equal(plateHit.markId, built.noteId);
  assert.equal(plateHit.part, "label", "плашка перестала быть подписью — её смещение больше не поедет");

  const pointHit = hitTest(built.project, built.scheme, onPoint, view, null);
  assert.equal(pointHit.markId, built.noteId);
  assert.equal(pointHit.part, "mark", "точку указателя клик не берёт — двигать остриё нечем");
  // Ручки одной метки, но разные: по одному клику разводятся два жеста.
  assert.notEqual(plateHit.part, pointHit.part);
  assert.equal(canvasDragsCommentPoint(built.project, pointHit.markId, pointHit.part), true);
  assert.equal(canvasDragsCommentPoint(built.project, plateHit.markId, plateHit.part), false);
});

test("попадание по точке считается нарисованной кляксой, а не знаком плашки", () => {
  // Знак встроенного типа — `rect-horizontal`, то есть сама плашка: мерить им
  // попадание по точке значило бы ловить клик прямоугольником во весь знак
  // вокруг точки, нарисованной вчетверо меньше.
  const built = scene();
  const at = pointAt(built.project, built.scheme, built.noteId);
  const drawn = commentPointRadius(view);
  assert.equal(drawn, markRadius(view) * 0.4, "клякса точки нарисована не тем радиусом, которым ловится");
  const reach = drawn + renderInternals.HIT_SLACK_PX;

  const near = hitTest(built.project, built.scheme, { x: at.x + reach - 0.5, y: at.y }, view, null);
  assert.equal(near && near.markId, built.noteId, "у самой кляксы клик мимо — точку не взять");
  // Запас знака был радиусом метки (10) с тем же `HIT_SLACK_PX` сверху: клик в
  // десятке пикселей от точки попадал в пустое место и брал комментарий.
  // Теперь он мимо — и это не придирка: в этом десятке стоят соседние метки.
  const beyond = { x: at.x + markRadius(view) + 1, y: at.y };
  assert.ok(Math.hypot(beyond.x - at.x, beyond.y - at.y) > reach, "проверка ослабла: клик всё ещё в запасе точки");
  assert.ok(
    Math.hypot(beyond.x - at.x, beyond.y - at.y) <= markRadius(view) + renderInternals.HIT_SLACK_PX,
    "проверка ослабла: прежний запас знака до этого клика не доставал",
  );
  assert.equal(hitTest(built.project, built.scheme, beyond, view, null), null, "клик вдали от точки всё ещё берёт её знаком плашки");
});

test("без указателя разводить нечего: клик по плашке везёт весь комментарий", () => {
  const built = scene({ pointer: false });
  const plate = plateOf(built.project, built.scheme, built.noteId);
  const hit = hitTest(built.project, built.scheme, { x: plate.x + plate.width / 2, y: plate.y + 1 }, view, null);
  assert.equal(hit.markId, built.noteId);
  assert.equal(hit.part, "mark", "плашка без указателя стала подписью — ей некуда отходить от своей точки");
  // Жест везёт метку целиком — то же, что было до таска: точка пришита к
  // плашке, и «независимо» тут значило бы разорвать то, что человек не
  // разводил. Разводит он кнопкой указателя у самой плашки.
  assert.equal(canvasDragsCommentPoint(built.project, built.noteId, hit.part), false);
  const after = canvasMoveMarks(built.project, [built.noteId], { x: 0.1, y: 0 });
  assert.equal(findMark(after, built.noteId).points[0].x, 0.7);
  // Смещение, оставшееся от прежнего указателя, перенос не трогает: включат
  // указатель — плашка вернётся туда, где её бросили рукой (таск 116).
  assert.deepEqual(findMark(after, built.noteId).labelOffset, findMark(built.project, built.noteId).labelOffset);
});

test("у знака и у линии ручка одна: точка комментария — правило только для комментария", () => {
  const built = scene();
  assert.equal(canvasDragsCommentPoint(built.project, built.socketId, "mark"), false);
  assert.equal(canvasDragsCommentPoint(built.project, built.socketId, "label"), false);
  assert.equal(canvasDragsCommentPoint(built.project, null, "mark"), false);
  assert.equal(canvasDragsCommentPoint(built.project, "mark-which-is-gone", "mark"), false);
});

// ——— что делает сдвиг —————————————————————————————————————————————————

test("повезли точку — плашка осталась там же, где была", () => {
  const built = scene();
  const plate = plateOf(built.project, built.scheme, built.noteId);
  const shift = { x: 0.1, y: 0.08 };
  const after = canvasMoveCommentPoint(built.project, built.scheme, built.noteId, shift, {
    dx: plate.dx,
    dy: plate.dy,
  });

  const moved = findMark(after, built.noteId);
  assert.ok(Math.abs(moved.points[0].x - 0.7) < 1e-12, "точка уехала не на тот сдвиг");
  assert.ok(Math.abs(moved.points[0].y - 0.58) < 1e-12, "точка уехала не на тот сдвиг");
  // Главное обещание таска: текст не шевельнулся ни на пиксель.
  assert.deepEqual(plateCorner(plateOf(after, built.scheme, built.noteId)), plateCorner(plate));
  // Тронуты ровно два поля: точки и смещение плашки. Текст, указатель, номер
  // и помещение переносом не правятся.
  const was = findMark(built.project, built.noteId);
  assert.deepEqual(
    { ...moved, points: was.points, labelOffset: was.labelOffset },
    was,
    "перенос точки тронул не только координаты и смещение",
  );
});

test("повезли плашку — точка осталась там же, где была", () => {
  // Тот же счёт, что у ветки `label` в `canvasDragTo`: база — там, где плашку
  // видно сейчас, плюс сдвиг в пикселях плана. Точки этот жест не касается
  // вовсе, и это и есть независимость с другой стороны.
  const built = scene();
  const plate = plateOf(built.project, built.scheme, built.noteId);
  const shift = { x: -0.2, y: 0.1 };
  const after = updateMark(built.project, built.noteId, {
    labelOffset: { dx: plate.dx + shift.x * WIDTH, dy: plate.dy + shift.y * HEIGHT },
  }).project;

  assert.deepEqual(
    findMark(after, built.noteId).points,
    findMark(built.project, built.noteId).points,
    "перенос плашки сдвинул точку",
  );
  const moved = plateOf(after, built.scheme, built.noteId);
  assert.ok(Math.abs(moved.x - (plate.x + shift.x * WIDTH)) < 1e-9, "плашка уехала не на тот сдвиг");
  assert.ok(Math.abs(moved.y - (plate.y + shift.y * HEIGHT)) < 1e-9, "плашка уехала не на тот сдвиг");
});

test("плашка, которую ставила раскладка, при переносе точки не прыгает в стандартное место", () => {
  // Смещения в метке нет вовсе — плашку с указателем поставила раскладка.
  // Поправлять нечего, и записать «минус сдвиг» от нуля значило бы дёрнуть
  // текст в другое место в тот миг, когда повезли точку.
  const built = scene({ offset: null });
  const plate = plateOf(built.project, built.scheme, built.noteId);
  assert.equal(findMark(built.project, built.noteId).labelOffset, null);
  const after = canvasMoveCommentPoint(built.project, built.scheme, built.noteId, { x: 0.15, y: 0 }, {
    dx: plate.dx,
    dy: plate.dy,
  });
  assert.deepEqual(plateCorner(plateOf(after, built.scheme, built.noteId)), plateCorner(plate));
  // Смещение у плашки теперь есть: место ей выбрал человек, и раскладка
  // больше её не двигает — то же правило, что у оттащенной рукой подписи.
  assert.ok(findMark(after, built.noteId).labelOffset, "плашка осталась на попечении раскладки — она уедет от соседа");
});

test("исчезнувшая метка не роняет жест, а план без размеров не рвёт смещение", () => {
  const built = scene();
  assert.equal(canvasMoveCommentPoint(built.project, built.scheme, "mark-which-is-gone", { x: 1, y: 1 }, null), built.project);
  const after = canvasMoveCommentPoint(built.project, { width: 0, height: 0 }, built.noteId, { x: 0.1, y: 0 }, { dx: 12, dy: 0 });
  assert.deepEqual(findMark(after, built.noteId).labelOffset, { dx: 12, dy: 0 });
});

// ——— каждый перенос отменяется отдельно ————————————————————————————————

test("шаги истории названы врозь: плашка комментария, его точка, метка, блок", () => {
  const built = scene();
  const note = { markId: built.noteId };
  assert.equal(
    canvasMoveStepLabel(built.project, { ...note, kind: "mark", commentPoint: true, moving: [built.noteId] }),
    strings.history.moveCommentPoint,
  );
  assert.equal(
    canvasMoveStepLabel(built.project, { ...note, kind: "label", commentPoint: false }),
    strings.history.moveCommentPlate,
  );
  // У обычной метки ярлыки прежние: ни «перемещение метки», ни «перенос
  // блока», ни «смещение подписи» таск не переименовывает.
  const socket = { markId: built.socketId };
  assert.equal(canvasMoveStepLabel(built.project, { ...socket, kind: "mark", moving: [built.socketId] }), strings.history.move);
  assert.equal(canvasMoveStepLabel(built.project, { ...socket, kind: "label" }), strings.history.moveLabel);
  const block = addToGroup(built.project, built.socketId, "right", { step: blockStepPx(view.markSize) });
  const ids = [built.socketId, block.mark.id];
  assert.equal(canvasMoveStepLabel(block.project, { markId: built.socketId, kind: "mark", moving: ids }), strings.history.moveBlock);
  assert.equal(canvasMoveStepLabel(built.project, null), strings.history.move);
});

const SOURCE = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "src", "canvas.js"), "utf8");
const withoutComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, "");
const bodyOf = (name) => {
  const rest = SOURCE.slice(SOURCE.indexOf(name));
  return withoutComments(rest.slice(0, rest.indexOf("\nfunction ")));
};

test("плашка это или точка, решается на нажатии — как и состав группы", () => {
  // Жест, у которого смысл меняется посреди ведения, нельзя ни показать, ни
  // отменить одним шагом: ответ снимается в `canvasPointerDown` (и в
  // `canvasGrabDrag` у пальца), дальше только читается флаг.
  const down = withoutComments(bodyOf("function canvasPointerDown("));
  assert.ok(down.includes("canvasDragsCommentPoint("), "на нажатии больше не решается, плашку везут или точку");
  const grab = withoutComments(bodyOf("function canvasGrabDrag("));
  assert.ok(grab.includes("canvasDragsCommentPoint("), "долгое нажатие пальцем перестало разводить плашку и точку");
  const move = withoutComments(bodyOf("function canvasPointerMove("));
  assert.ok(!move.includes("canvasDragsCommentPoint("), "смысл жеста пересчитывается посреди ведения");
  // Один жест — один шаг истории: в ведении объект «после» собирается одной
  // командой модели, а не по шагу на поле.
  const body = withoutComments(bodyOf("export function canvasMoveCommentPoint("));
  assert.equal(body.split("updateMark(").length - 1, 1, "точка и плашка правятся двумя командами — Ctrl+Z вернёт половину");
});

// ——— G68: прежние комментарии открываются как были ————————————————————

test("G68: комментарий прежней сборки открывается как был — плашка там же, точка там же", async () => {
  // Объект, размеченный до этого таска: комментарий с указателем и отведённой
  // рукой плашкой, обычная метка рядом. Поля `points` и `labelOffset` — те
  // самые, которые таск и трогает.
  const old = {
    formatVersion: 1,
    id: "old-project",
    name: "Объект прежней сборки",
    createdAt: "2026-01-01T00:00:00+03:00",
    updatedAt: "2026-01-01T00:00:00+03:00",
    categories: [{ id: "cat-1", name: "Розетки", color: "#D1242F", shape: "circle-socket", order: 0 }],
    markTypes: [{ id: "type-1", categoryId: "cat-1", code: "Р", name: "Розетка", shape: null, blockMode: "each", order: 0 }],
    rooms: [],
    schemes: [{ id: "scheme-1", name: "1 этаж", imageId: null, width: WIDTH, height: HEIGHT, order: 0 }],
    marks: [
      { id: "mark-1", schemeId: "scheme-1", typeId: "type-1", number: 1, kind: "point", points: [{ x: 0.2, y: 0.5 }], groupId: null, labelOffset: null },
      {
        id: "note-1",
        schemeId: "scheme-1",
        typeId: COMMENT_TYPE_ID,
        number: 1,
        kind: MARK_KIND_COMMENT,
        points: [{ x: 0.62, y: 0.44 }],
        groupId: null,
        labelOffset: { dx: 170, dy: -90 },
        original: "Щит в коридоре",
        pointer: true,
      },
    ],
    groups: [],
    counters: { Р: 1, Коммент: 1 },
    view: { markSize: 10, labelSize: 12 },
  };
  const opened = (await unpackProject(await packProject(old, new Map()))).project;
  // Открылся как закрывался: ни одна метка не изменилась ни на поле, ни на
  // долю. Миграции у таска нет вовсе — нового поля он не завёл.
  assert.deepEqual(opened.marks, old.marks.map((mark) => ({ ...mark })), "метка прежнего объекта изменилась");
  assert.equal(migrateCommentType(opened).changed, false);

  // Плашка и точка — ровно там, где их оставили: место плашки считается от
  // записанного смещения, место точки — от записанных долей.
  const scheme = opened.schemes[0];
  assert.deepEqual(pointAt(opened, scheme, "note-1"), { x: 0.62 * WIDTH, y: 0.44 * HEIGHT });
  const plate = plateOf(opened, scheme, "note-1");
  assert.equal(plate.dx, 170);
  assert.equal(plate.dy, -90);
  assert.equal(plate.x, 0.62 * WIDTH + 170);
  assert.equal(plate.y, 0.44 * HEIGHT - 90);

  // И обе ручки на месте: клик по плашке берёт её, клик по точке — точку.
  assert.equal(hitTest(opened, scheme, { x: plate.x + 2, y: plate.y + plate.height / 2 }, view, null).part, "label");
  assert.equal(hitTest(opened, scheme, pointAt(opened, scheme, "note-1"), view, null).part, "mark");
});

// ——— видно, за что берёшься ————————————————————————————————————————————

test("карточка комментария с указателем говорит про две ручки, без указателя — про кнопку", () => {
  const built = scene();
  assert.equal(markCardModel(built.project, built.noteId).pointer, true);
  const off = setMarkPointer(built.project, built.noteId, false).project;
  assert.equal(markCardModel(off, built.noteId).pointer, false);
  // Текст подсказки — в словаре, и обе её половины говорят о своём: одна про
  // кнопку указателя, другая про то, что плашку и точку возят врозь.
  assert.match(strings.markCard.pointerHintOn, /плашку и точку/i);
  assert.match(strings.markCard.pointerHint, /кнопк/i);
});
