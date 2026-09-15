// Подпись вдоль стены: поворот на 90°.
//
// На рукописном эталоне заказчика подписи написаны вдоль стены — в узком
// коридоре и у простенка горизонтальная не влезает. Поворот меняет три вещи
// разом, и разойтись им нельзя: габарит (повёрнутая занимает место иначе),
// попадание по клику (ловиться она обязана там, где нарисована) и разведение
// подписей (соседям она мешает по-другому).
import test from "node:test";
import assert from "node:assert/strict";
import {
  hitLabelTurn,
  hitTest,
  labelBounds,
  labelBox,
  labelLayout,
  labelTargetOf,
  labelTurnHandle,
  renderInternals,
} from "../src/render.js";
import { addMark, addScheme, addType, createProject, updateMark } from "../src/model.js";

const viewOf = (patch) => ({ zoom: 1, offsetX: 0, offsetY: 0, markSize: 10, labelSize: 12, ...patch });

// План 1000×500, длинный код: разница между лежачей и стоячей подписью видна.
const scene = () => {
  const made = addScheme(createProject(), { name: "1 этаж", width: 1000, height: 500 });
  const light = made.project.categories.find((item) => item.name === "Свет").id;
  const added = addType(made.project, { code: "ПОДСВЕТКА", name: "Подсветка", categoryId: light });
  return { project: added.project, schemeId: made.scheme.id, typeId: added.type.id, scheme: added.project.schemes[0] };
};

const oneMark = (at = { x: 0.5, y: 0.5 }) => {
  const base = scene();
  const added = addMark(base.project, { schemeId: base.schemeId, typeId: base.typeId, points: [at] });
  return { ...base, project: added.project, mark: added.mark };
};

test("повёрнутая подпись меняет габарит: ширина и высота меняются местами", () => {
  const flat = oneMark();
  const lying = labelBounds(labelBox(flat.project, flat.scheme, flat.mark, viewOf()));
  const turnedProject = updateMark(flat.project, flat.mark.id, { labelAngle: 90 }).project;
  const standing = labelBounds(labelBox(turnedProject, flat.scheme, turnedProject.marks[0], viewOf()));

  assert.ok(lying.width > lying.height * 3, "пример не тот: лежачая подпись должна быть длинной");
  assert.ok(Math.abs(standing.height - lying.width) < 1e-6, "повёрнутая не вытянулась по вертикали");
  assert.ok(Math.abs(standing.width - lying.height) < 1e-6, "повёрнутая не сузилась по горизонтали");
  // Подпись осталась при своей метке: (500, 250) на плане 1000×500.
  assert.ok(Math.abs(standing.x - 500) < 40 && Math.abs(standing.y + standing.height - 250) < 40);
});

test("клик по повёрнутой подписи попадает туда, где она нарисована", () => {
  const flat = oneMark();
  const before = labelBounds(labelBox(flat.project, flat.scheme, flat.mark, viewOf()));
  const project = updateMark(flat.project, flat.mark.id, { labelAngle: 90 }).project;
  const after = labelBounds(labelBox(project, flat.scheme, project.marks[0], viewOf()));

  // Середина стоячей подписи ловится.
  const inside = { x: after.x + after.width / 2, y: after.y + after.height / 2 };
  const hit = hitTest(project, flat.scheme, inside, viewOf(), null);
  assert.equal(hit && hit.part, "label", "по нарисованной подписи клик не попал");
  assert.equal(hit.markId, flat.mark.id);

  // А там, где подпись лежала до поворота, ловить уже нечего: конец прежней
  // строки от стоячей подписи далеко.
  const wasEnd = { x: before.x + before.width - 4, y: before.y + before.height / 2 };
  assert.ok(wasEnd.x > after.x + after.width + 4, "пример не тот: прежний конец строки внутри новой рамки");
  assert.equal(hitTest(project, flat.scheme, wasEnd, viewOf(), null), null, "подпись ловится там, где её нет");
});

test("разведение подписей считается с повёрнутым габаритом", () => {
  // Три метки в столбик через 30 пикселей плана. Лежачие подписи разошлись бы
  // по вертикали сами, а стоячие — это высокие столбцы, и места им нужно больше.
  const base = scene();
  let project = base.project;
  const ids = [];
  for (const y of [0.3, 0.36, 0.42]) {
    const added = addMark(project, { schemeId: base.schemeId, typeId: base.typeId, points: [{ x: 0.5, y }] });
    project = updateMark(added.project, added.mark.id, { labelAngle: 90 }).project;
    ids.push(added.mark.id);
  }
  const scheme = project.schemes[0];
  const layout = labelLayout(project, scheme, null, viewOf());
  const boxes = renderInternals
    .labelTargets(project, scheme, null)
    .map((target) => labelBounds(labelBox(project, scheme, target, viewOf(), null)));

  assert.equal(boxes.length, 3);
  assert.ok(layout.size === 3, "раскладка не знает про эти подписи");
  for (let i = 0; i < boxes.length; i += 1) {
    for (let j = i + 1; j < boxes.length; j += 1) {
      const a = boxes[i];
      const b = boxes[j];
      const apart =
        a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y;
      assert.ok(apart, `стоячие подписи ${i + 1} и ${j + 1} наложились`);
    }
  }
});

test("у блока поворот подписи один на всех и живёт у первой метки", () => {
  const base = scene();
  const block = addMark(base.project, {
    schemeId: base.schemeId,
    typeId: base.typeId,
    points: [
      { x: 0.3, y: 0.5 },
      { x: 0.34, y: 0.5 },
    ],
  });
  const project = updateMark(block.project, block.marks[0].id, { labelAngle: 90 }).project;
  const group = project.groups[0];
  const target = { ...group, shownIds: group.markIds };
  const box = labelBox(project, project.schemes[0], target, viewOf(), null);
  assert.equal(box.angle, 90, "подпись блока не повернулась вслед за первой меткой");
  const bounds = labelBounds(box);
  assert.ok(bounds.height > bounds.width, "подпись блока повёрнута только на словах");
});

// Кнопка поворота живёт на холсте, у самой подписи выделенной метки: подпись
// вдоль стены ставят, глядя на план, — влезает она или нет, — а не уводя руку
// в колонку. Панель к тому же скрыта на узком экране, холст виден всегда.
test("ручка поворота стоит у подписи, ловит клик и едет за ней", () => {
  const flat = oneMark();
  const target = labelTargetOf(flat.project, flat.scheme, flat.mark.id, null);
  assert.equal(target.id, flat.mark.id, "цель подписи одиночной метки — она сама");

  const handle = labelTurnHandle(flat.project, flat.scheme, target, viewOf(), null);
  const bounds = labelBounds(labelBox(flat.project, flat.scheme, flat.mark, viewOf(), null));
  assert.ok(handle.x >= bounds.x + bounds.width, "ручка налезла на текст подписи");
  assert.ok(handle.y <= bounds.y, "ручка ушла ниже верхнего края подписи");
  assert.equal(hitLabelTurn(flat.project, flat.scheme, target, { x: handle.x, y: handle.y }, viewOf(), null), true);
  assert.equal(
    hitLabelTurn(flat.project, flat.scheme, target, { x: handle.x + 60, y: handle.y }, viewOf(), null),
    false,
    "ручка ловит клик далеко от себя",
  );

  // Подпись встала вдоль стены — ручка поехала к её новому верхнему краю.
  const turned = updateMark(flat.project, flat.mark.id, { labelAngle: 90 }).project;
  const moved = labelTurnHandle(turned, flat.scheme, labelTargetOf(turned, flat.scheme, flat.mark.id, null), viewOf(), null);
  assert.ok(moved.y < handle.y - 20, "ручка осталась там, где подписи больше нет");

  // Метку спрятал фильтр — подписи нет, и поворачивать нечего.
  assert.equal(labelTargetOf(flat.project, flat.scheme, flat.mark.id, { typeIds: [] }), null);
  assert.equal(labelTurnHandle(flat.project, flat.scheme, null, viewOf(), null), null);
});
