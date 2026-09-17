// Подпись комнаты: размер как у подписи метки, перенос и поворот.
//
// Заказчик: «сделай что бы подписи комнат были размером как и подписи меток,
// фиксированные, так же сделай что бы их аналогично подписям меток можно было
// переносить и вращать». Механика взята у меток целиком: смещение в пикселях
// плана, угол из того же списка, тот же габарит и то же попадание по клику.
//
// Главное здесь — миграция. Полей смещения и угла у контуров не было, и объект
// прежней разметки обязан открыться с подписями ровно там, где они стояли:
// серединой в середине контура, лёжа.
import test from "node:test";
import assert from "node:assert/strict";

import {
  addMark,
  addOutline,
  addRoom,
  addScheme,
  createProject,
  replaceSchemeImage,
  updateOutline,
} from "../src/model.js";
import { packProject, unpackProject } from "../src/projectFile.js";
import {
  hitOutline,
  hitOutlineLabelTurn,
  labelBounds,
  labelBox,
  outlineLabelBox,
  outlineLabelTurn,
  renderInternals,
} from "../src/render.js";

const viewOf = (patch) => ({ zoom: 1, offsetX: 0, offsetY: 0, markSize: 10, labelSize: 12, ...patch });

// Прямоугольная комната 0,2…0,6 по горизонтали и 0,2…0,5 по вертикали.
// На плане 1000×500 её середина — (400, 175) экранных пикселей при зуме 1.
const ROOM = [
  { x: 0.2, y: 0.2 },
  { x: 0.6, y: 0.2 },
  { x: 0.6, y: 0.5 },
  { x: 0.2, y: 0.5 },
];

function scene() {
  const made = addScheme(createProject(), { name: "1 этаж", width: 1000, height: 500 });
  const room = addRoom(made.project, "Гостиная");
  const outlined = addOutline(room.project, { schemeId: made.scheme.id, roomId: room.room.id, points: ROOM });
  return {
    project: outlined.project,
    scheme: outlined.project.schemes[0],
    room: room.room,
    outline: outlined.outline,
  };
}

const boxOf = (project, scheme, outlineId, view = viewOf()) =>
  outlineLabelBox(project, scheme, project.outlines.find((item) => item.id === outlineId), view);

// Объект прежней разметки: у контура полей подписи нет вовсе.
function legacy(project) {
  return {
    ...project,
    outlines: project.outlines.map(({ labelOffset, labelAngle, ...rest }) => rest),
  };
}

test("размер подписи комнаты — тем же правилом, что у подписи метки", () => {
  const base = scene();
  const added = addMark(base.project, {
    schemeId: base.scheme.id,
    typeId: base.project.markTypes[0].id,
    points: [{ x: 0.8, y: 0.8 }],
  });
  for (const view of [viewOf(), viewOf({ zoom: 0.4 }), viewOf({ zoom: 3, labelSize: 20 })]) {
    const mark = labelBox(added.project, base.scheme, added.mark, view, null);
    const room = boxOf(added.project, base.scheme, base.outline.id, view);
    assert.equal(room.font, mark.font, "кегль подписи комнаты разошёлся с кеглем подписи метки");
    assert.equal(room.height, mark.height, "высота строки разошлась");
  }
});

test("объект прежней разметки открывается с подписью в середине контура", () => {
  const base = scene();
  const old = legacy(base.project);
  const box = boxOf(old, base.scheme, base.outline.id);
  const rect = labelBounds(box);

  assert.equal(box.angle, 0, "у подписи прежнего объекта взялся угол");
  assert.equal(box.dx, 0);
  assert.equal(box.dy, 0);
  // Середина габарита — ровно середина контура, как было до этой правки.
  const center = renderInternals.outlineCenter(base.outline.points);
  assert.ok(Math.abs(rect.x + rect.width / 2 - center.x * 1000) < 1e-9, "подпись съехала по горизонтали");
  assert.ok(Math.abs(rect.y + rect.height / 2 - center.y * 500) < 1e-9, "подпись съехала по вертикали");

  // И ловится там же: клик в середину контура по-прежнему берёт подпись.
  const hit = hitOutline(old, base.scheme, { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }, viewOf(), null, null);
  assert.equal(hit && hit.part, "label", "по подписи прежнего объекта клик не попал");
});

test("файл прежнего формата распаковывается с подписями на прежних местах", async () => {
  const base = scene();
  const old = legacy(base.project);
  const before = labelBounds(boxOf(old, base.scheme, base.outline.id));
  const restored = (await unpackProject(await packProject(old, new Map()))).project;
  const after = labelBounds(boxOf(restored, restored.schemes[0], base.outline.id));

  assert.deepEqual(after, before, "подпись комнаты переехала при открытии файла прежней версии");
});

test("подпись переносится на столько пикселей плана, сколько записано", () => {
  const base = scene();
  const moved = updateOutline(base.project, base.outline.id, { labelOffset: { dx: 60, dy: -40 } }).project;
  const was = labelBounds(boxOf(base.project, base.scheme, base.outline.id));
  const now = labelBounds(boxOf(moved, base.scheme, base.outline.id));

  assert.ok(Math.abs(now.x - was.x - 60) < 1e-9, "смещение по горизонтали не доехало: " + (now.x - was.x));
  assert.ok(Math.abs(now.y - was.y + 40) < 1e-9, "смещение по вертикали не доехало: " + (now.y - was.y));

  // Смещение — в пикселях плана, поэтому на экране оно растёт с масштабом,
  // как и у подписи метки.
  const zoomed = labelBounds(boxOf(moved, base.scheme, base.outline.id, viewOf({ zoom: 2 })));
  const zoomedBase = labelBounds(boxOf(base.project, base.scheme, base.outline.id, viewOf({ zoom: 2 })));
  assert.ok(Math.abs(zoomed.x - zoomedBase.x - 120) < 1e-9);
  assert.ok(Math.abs(zoomed.y - zoomedBase.y + 80) < 1e-9);
});

test("подвинутая подпись ловится там, где нарисована, и в середине контура её больше нет", () => {
  const base = scene();
  const moved = updateOutline(base.project, base.outline.id, { labelOffset: { dx: 150, dy: 90 } }).project;
  const rect = labelBounds(boxOf(moved, base.scheme, base.outline.id));
  const middle = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };

  const hit = hitOutline(moved, base.scheme, middle, viewOf(), null, null);
  assert.equal(hit && hit.part, "label", "по подвинутой подписи клик не попал");

  const center = renderInternals.outlineCenter(base.outline.points);
  const atCenter = hitOutline(moved, base.scheme, { x: center.x * 1000, y: center.y * 500 }, viewOf(), null, null);
  assert.equal(atCenter, null, "подпись ловится там, где её уже нет");
});

test("поворот меняет габарит местами, а середина подписи остаётся на месте", () => {
  const base = scene();
  const lying = labelBounds(boxOf(base.project, base.scheme, base.outline.id));
  const turned = updateOutline(base.project, base.outline.id, { labelAngle: 90 }).project;
  const standing = labelBounds(boxOf(turned, base.scheme, base.outline.id));

  assert.ok(lying.width > lying.height * 2, "пример не тот: лежачая подпись должна быть длинной");
  assert.ok(Math.abs(standing.height - lying.width) < 1e-9, "повёрнутая не вытянулась по вертикали");
  assert.ok(Math.abs(standing.width - lying.height) < 1e-9, "повёрнутая не сузилась по горизонтали");
  assert.ok(Math.abs(standing.x + standing.width / 2 - (lying.x + lying.width / 2)) < 1e-9, "середина уехала вбок");
  assert.ok(Math.abs(standing.y + standing.height / 2 - (lying.y + lying.height / 2)) < 1e-9, "середина уехала вверх");

  // И ловится по своему габариту: клик в середину стоячей подписи берёт её.
  const hit = hitOutline(turned, base.scheme, { x: standing.x + 1, y: standing.y + 2 }, viewOf(), null, null);
  assert.equal(hit && hit.part, "label", "по повёрнутой подписи клик не попал");
});

test("угол подписи комнаты — только из списка", () => {
  const base = scene();
  const unknown = (error) => error.code === "labelAngleUnknown";
  assert.throws(() => updateOutline(base.project, base.outline.id, { labelAngle: 45 }), unknown);
  assert.throws(() => updateOutline(base.project, base.outline.id, { labelAngle: "90" }), unknown);
});

test("ручка поворота стоит у габарита подписи и ловится по нему", () => {
  const base = scene();
  const moved = updateOutline(base.project, base.outline.id, { labelOffset: { dx: 120, dy: 0 } }).project;
  const outline = moved.outlines[0];
  const rect = labelBounds(boxOf(moved, base.scheme, base.outline.id));
  const handle = outlineLabelTurn(moved, base.scheme, outline, viewOf());

  assert.ok(handle.x > rect.x + rect.width, "ручка налезла на текст");
  assert.ok(handle.y < rect.y + rect.height, "ручка уехала под подпись");
  assert.equal(hitOutlineLabelTurn(moved, base.scheme, outline, { x: handle.x, y: handle.y }, viewOf()), true);
  assert.equal(
    hitOutlineLabelTurn(moved, base.scheme, outline, { x: handle.x + handle.r * 4, y: handle.y }, viewOf()),
    false,
    "ручка ловит клик в стороне от себя",
  );
});

// Раскладка подписей разводит подписи меток — подпись комнаты в ней не
// участвует вовсе: она привязана к середине комнаты, а не к метке, и увести её
// оттуда может только рука.
test("подпись комнаты не двигает ни соседняя метка, ни её подпись", () => {
  const base = scene();
  const center = renderInternals.outlineCenter(ROOM);
  const crowded = addMark(base.project, {
    schemeId: base.scheme.id,
    typeId: base.project.markTypes[0].id,
    points: [center, { x: center.x + 0.01, y: center.y }, { x: center.x, y: center.y + 0.01 }],
  }).project;

  assert.deepEqual(
    labelBounds(boxOf(crowded, base.scheme, base.outline.id)),
    labelBounds(boxOf(base.project, base.scheme, base.outline.id)),
    "подпись комнаты уехала от чужих подписей",
  );
});

test("замена подложки уносит смещение подписи комнаты вместе с пикселями плана", () => {
  const base = scene();
  const moved = updateOutline(base.project, base.outline.id, { labelOffset: { dx: 50, dy: -20 } }).project;
  const scaled = replaceSchemeImage(moved, base.scheme.id, { imageId: "big", width: 2000, height: 1500 }).project;

  assert.deepEqual(scaled.outlines[0].labelOffset, { dx: 100, dy: -60 }, "смещение подписи комнаты не пересчиталось");
});
