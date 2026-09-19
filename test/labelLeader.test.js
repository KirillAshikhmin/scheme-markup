// Переключатель поводка у подписи (G122).
//
// Поводок — полоска от метки к её подписи. Правило раскладки было такое:
// подпись, которую развели от соседа, поводок получает, а оттащенная рукой —
// нет. Заказчик: «у названий меток на схеме у автоматических есть полоски
// указатели на метку, а у тех, которые подвинул — пропадают».
//
// Поэтому у метки появилась перебивка, и главное про неё — два решения,
// которые этот файл и стережёт:
//
// 1. **Переключатель на метку, а не на схему.** Поводок рисует `drawScheme`,
//    значит он уезжает в PNG и в печать: это часть чертежа, а не оснастка
//    рабочего места. Общая настройка вида жила бы в браузере — и распечатка у
//    второго участника вышла бы другой.
// 2. **Умолчание прежнее.** У метки прежней разметки поля нет вовсе, и правило
//    для неё то же, что было (G68).
import test from "node:test";
import assert from "node:assert/strict";

import {
  addMark,
  addScheme,
  addToGroup,
  createProject,
  markLabelLeader,
  updateMark,
} from "../src/model.js";
import { packProject, unpackProject } from "../src/projectFile.js";
import {
  drawScheme,
  hitLabelLeader,
  hitLabelTurn,
  labelLeaderHandle,
  labelLeaderHolder,
  labelLeaderShown,
  labelTargetOf,
  labelTurnHandle,
} from "../src/render.js";

const PLAN = { width: 1000, height: 500 };
const viewOf = (patch) => ({ zoom: 1, offsetX: 0, offsetY: 0, markSize: 10, labelSize: 12, ...patch });

function scene() {
  const made = addScheme(createProject(), { name: "1 этаж", width: PLAN.width, height: PLAN.height });
  const type = made.project.markTypes.find((item) => item.code === "В");
  const first = addMark(made.project, {
    schemeId: made.scheme.id,
    typeId: type.id,
    points: [{ x: 0.3, y: 0.5 }],
  });
  return {
    project: first.project,
    scheme: first.project.schemes[0],
    schemeId: made.scheme.id,
    markId: first.mark.id,
    typeId: type.id,
  };
}

const markOf = (project, id) => project.marks.find((mark) => mark.id === id);
const targetOf = (base) => labelTargetOf(base.project, base.scheme, base.markId, null);

// ——— умолчание — прежнее поведение ——————————————————————————————————————

test("у метки прежней разметки перебивки нет, и поводок решает раскладка", () => {
  const base = scene();
  const mark = markOf(base.project, base.markId);
  assert.equal(markLabelLeader(mark), null, "поле завелось само — это правка чужой разметки");
  assert.equal("labelLeader" in mark, false, "в метке появилось поле, которого в файле не было");

  const target = targetOf(base);
  assert.equal(labelLeaderShown(base.project, target, { row: 0 }), false, "подпись вплотную — поводок ни к чему");
  assert.equal(labelLeaderShown(base.project, target, { row: 2 }), true, "разведённой подписи поводок полагался всегда");
});

test("правка соседнего поля перебивку не заводит", () => {
  const base = scene();
  const moved = updateMark(base.project, base.markId, { labelOffset: { dx: 40, dy: -20 } }).project;
  assert.equal("labelLeader" in markOf(moved, base.markId), false);
  assert.equal(markLabelLeader(markOf(moved, base.markId)), null);
});

// ——— перебивка ————————————————————————————————————————————————————————

test("перебивка отвечает раньше правила — в обе стороны", () => {
  const base = scene();
  const on = updateMark(base.project, base.markId, { labelLeader: true }).project;
  const onTarget = labelTargetOf(on, base.scheme, base.markId, null);
  assert.equal(labelLeaderShown(on, onTarget, { row: 0 }), true, "включённый поводок обязан быть у любой подписи");

  const off = updateMark(base.project, base.markId, { labelLeader: false }).project;
  const offTarget = labelTargetOf(off, base.scheme, base.markId, null);
  assert.equal(labelLeaderShown(off, offTarget, { row: 3 }), false, "выключенный поводок не рисуется и у разведённой");
});

test("пустая перебивка возвращает подпись к правилу раскладки", () => {
  const base = scene();
  const on = updateMark(base.project, base.markId, { labelLeader: true }).project;
  const back = updateMark(on, base.markId, { labelLeader: null }).project;
  assert.equal(markLabelLeader(markOf(back, base.markId)), null);
  const target = labelTargetOf(back, base.scheme, base.markId, null);
  assert.equal(labelLeaderShown(back, target, { row: 0 }), false);
  assert.equal(labelLeaderShown(back, target, { row: 1 }), true);
});

test("в поле поводка не кладётся ничего, кроме да, нет и пустоты", () => {
  const base = scene();
  for (const bad of ["да", 1, 0, "true", {}]) {
    assert.throws(() => updateMark(base.project, base.markId, { labelLeader: bad }), /поводок/i, "прошло: " + bad);
  }
});

// Смещение и угол подписи блока держит его первая метка — своего поля модель
// группе не заводит. Перебивка поводка обязана жить там же: подпись у блока
// одна, и двух ответов у неё быть не может.
test("у блока перебивку держит первая метка", () => {
  const base = scene();
  const grown = addToGroup(base.project, base.markId, "right");
  const scheme = grown.project.schemes[0];
  const target = labelTargetOf(grown.project, scheme, base.markId, null);
  assert.ok(target.markIds, "пример не тот: должен получиться блок");
  assert.equal(labelLeaderHolder(target), target.markIds[0]);

  const on = updateMark(grown.project, target.markIds[0], { labelLeader: true }).project;
  const after = labelTargetOf(on, scheme, base.markId, null);
  assert.equal(labelLeaderShown(on, after, { row: 0 }), true);
  // Вторая метка блока своей подписи не имеет — и её поле ничего не решает.
  const wrong = updateMark(grown.project, target.markIds[1], { labelLeader: true }).project;
  assert.equal(labelLeaderShown(wrong, labelTargetOf(wrong, scheme, base.markId, null), { row: 0 }), false);
});

// ——— ручка на холсте ——————————————————————————————————————————————————

test("ручка поводка стоит рядом с поворотом и не перехватывает его клик", () => {
  const base = scene();
  const target = targetOf(base);
  const view = viewOf();
  const turn = labelTurnHandle(base.project, base.scheme, target, view, null);
  const leader = labelLeaderHandle(base.project, base.scheme, target, view, null);
  assert.ok(turn && leader);
  assert.equal(leader.y, turn.y, "кнопки одного ряда обязаны стоять на одном уровне");
  assert.ok(leader.x > turn.x, "поводок встал слева от поворота — заказчик просил «рядом», справа");
  assert.ok(leader.x - turn.x >= turn.r + leader.r, "круги ручек налезли друг на друга: " + (leader.x - turn.x));

  // Каждая ручка ловит свой клик и не ловит чужой.
  assert.equal(hitLabelLeader(base.project, base.scheme, target, leader, view, null), true);
  assert.equal(hitLabelTurn(base.project, base.scheme, target, leader, view, null), false);
  assert.equal(hitLabelTurn(base.project, base.scheme, target, turn, view, null), true);
  assert.equal(hitLabelLeader(base.project, base.scheme, target, turn, view, null), false);
});

test("у подписи, которой нет, ручки поводка нет тоже", () => {
  const base = scene();
  assert.equal(labelLeaderHandle(base.project, base.scheme, null, viewOf(), null), null);
});

// ——— поводок — часть чертежа ———————————————————————————————————————————
//
// Ради этого переключатель и сделан на метку: то, что видно на экране, обязано
// быть видно на бумаге. Заглушка считает штрихи из двух точек — поводок как раз
// такой, и его появление видно по счёту.
function strokeCount(project, scheme) {
  let path = null;
  let seen = 0;
  const impl = {
    canvas: { width: 900, height: 600 },
    getTransform: () => ({ a: 1 }),
    measureText: (value) => ({ width: String(value).length * 7 }),
    beginPath: () => {
      path = [];
    },
    moveTo: (x, y) => path && path.push({ x, y }),
    lineTo: (x, y) => path && path.push({ x, y }),
    stroke: () => {
      if (path && path.length === 2) seen += 1;
      path = null;
    },
  };
  const ctx = new Proxy(impl, { get: (object, key) => (key in object ? object[key] : () => {}), set: () => true });
  drawScheme(ctx, { project, scheme, image: null, filter: null, view: viewOf(), legend: false });
  return seen;
}

test("включённый поводок попадает в то, что уходит в PNG и в печать", () => {
  const base = scene();
  // Подпись оттащена рукой — по прежнему правилу поводка у неё нет.
  const moved = updateMark(base.project, base.markId, { labelOffset: { dx: 90, dy: -60 } }).project;
  const without = strokeCount(moved, moved.schemes[0]);
  const on = updateMark(moved, base.markId, { labelLeader: true }).project;
  assert.equal(strokeCount(on, on.schemes[0]), without + 1, "поводок не дошёл до чертежа");
});

// ——— файл проекта ——————————————————————————————————————————————————————

test("перебивка уезжает в файл проекта и возвращается, а старой метке ничего не дописывается", async () => {
  const base = scene();
  const second = addMark(base.project, {
    schemeId: base.schemeId,
    typeId: base.typeId,
    points: [{ x: 0.7, y: 0.5 }],
  });
  const on = updateMark(second.project, base.markId, { labelLeader: false }).project;
  const back = await unpackProject(await packProject(on, new Map()));
  assert.equal(markLabelLeader(markOf(back.project, base.markId)), false);
  assert.equal("labelLeader" in markOf(back.project, second.mark.id), false, "метке без перебивки дописали поле");
});
