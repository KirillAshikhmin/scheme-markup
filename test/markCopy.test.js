// Копирование метки: пипетка Q, Ctrl+C и Ctrl+V (таск 90).
//
// Слова заказчика: «добавь хоткей Q — скопировать тип метки, чтобы добавить
// новую такую же, а также через command (control) V \ C копировать и вставлять
// метки (по сути копируем тип и вставляем туда, где курсор, если он на поле
// схемы, или рядом, если за пределами, и выделяем его сразу)».
//
// Сами нажатия проверяются руками — клавиатура холста тестами не покрывается.
// Здесь закрыты два шва, которые могут разойтись молча:
//   1. что переезжает в копию, а что остаётся у исходной метки (`markSnapshot`
//      и `pasteMark`) — в том числе у метки из объекта прежнего формата;
//   2. лесенка повторных вставок (`canvasPasteSpot`): вторая копия в то же
//      место обязана отойти в сторону, иначе стопка меток выглядит как одна.
import test from "node:test";
import assert from "node:assert/strict";
import {
  MARK_COPY_FIELDS,
  addMark,
  addScheme,
  createProject,
  deleteMark,
  findMark,
  markSnapshot,
  pasteMark,
  setMarkControls,
  updateMark,
  updateType,
} from "../src/model.js";
import { canvasHintText, canvasPasteSpot } from "../src/canvas.js";
import { strings } from "../src/strings.js";

const WIDTH = 1600;
const HEIGHT = 1000;

function scene() {
  const made = addScheme(createProject({ name: "Копия" }), { name: "1 этаж", width: WIDTH, height: HEIGHT });
  return { project: made.project, schemeId: made.scheme.id };
}

const typeId = (project, code) => project.markTypes.find((type) => type.code === code).id;

const point = (base, at, code = "Р") =>
  addMark(base.project, { schemeId: base.schemeId, typeId: typeId(base.project, code), kind: "point", points: [at] });

// ——— что переезжает в копию ——————————————————————————————————————————

test("копия получает тип, форму и поля описания, но свой номер", () => {
  const base = scene();
  const placed = point(base, { x: 0.3, y: 0.5 });
  // Ровно тот случай, ради которого копируют: розетка у кровати слева, чтобы
  // поставить такую же справа. Одинаковы у них не только тип.
  const filled = updateMark(placed.project, placed.mark.id, {
    location: "у кровати слева",
    original: "Р-12",
    length: 80,
    width: 80,
    heightAboveFloor: 300,
  }).project;
  const source = findMark(filled, placed.mark.id);

  const pasted = pasteMark(filled, markSnapshot(filled, placed.mark.id), {
    schemeId: base.schemeId,
    point: { x: 0.7, y: 0.5 },
  });
  const copy = findMark(pasted.project, pasted.mark.id);

  assert.notEqual(copy.id, source.id, "вставилась та же метка, а не копия");
  assert.equal(copy.typeId, source.typeId);
  for (const field of MARK_COPY_FIELDS) {
    assert.deepEqual(copy[field], source[field], "поле не переехало в копию: " + field);
  }
  assert.equal(copy.number, source.number + 1, "нумерация сквозная: копии положен следующий номер");
  assert.deepEqual(copy.points, [{ x: 0.7, y: 0.5 }], "копия легла мимо заданной точки");
  // Исходная метка при этом не тронута ни в чём.
  assert.deepEqual(findMark(pasted.project, source.id), source);
});

test("блок, подпись, помещение и связи в копию не переезжают", () => {
  const base = scene();
  const lamp = point(base, { x: 0.2, y: 0.2 }, "Т");
  const withSwitch = point({ project: lamp.project, schemeId: base.schemeId }, { x: 0.3, y: 0.5 }, "В");
  // Выключатель с полным приданым: подпись отодвинута, помещение вписано
  // руками, светильник в списке «чем управляет».
  const rooms = updateMark(withSwitch.project, withSwitch.mark.id, {
    labelOffset: { x: 40, y: -20 },
    labelAngle: 90,
    roomId: null,
    roomManual: true,
  }).project;
  const linked = setMarkControls(rooms, withSwitch.mark.id, [lamp.mark.id]).project;

  const pasted = pasteMark(linked, markSnapshot(linked, withSwitch.mark.id), {
    schemeId: base.schemeId,
    point: { x: 0.6, y: 0.5 },
  });
  const copy = findMark(pasted.project, pasted.mark.id);

  assert.equal(copy.groupId, null, "копия утащила за собой блок");
  assert.equal(copy.labelOffset, null, "смещение подписи относится к месту, а не к метке");
  assert.equal(copy.roomManual, false, "копия объявила себя вписанной руками");
  assert.deepEqual(copy.controls, [], "копия молча повторила чужие связи — в таблице появится то, чего не говорили");
  assert.equal(pasted.project.groups.length, linked.groups.length, "вставка завела группу на пустом месте");
});

test("линия копируется формой, а не отрезком по умолчанию", () => {
  const base = scene();
  const drawn = addMark(base.project, {
    schemeId: base.schemeId,
    typeId: typeId(base.project, "Л"),
    kind: "line",
    points: [
      { x: 0.1, y: 0.1 },
      { x: 0.3, y: 0.1 },
      { x: 0.3, y: 0.4 },
    ],
  });
  const closed = updateMark(drawn.project, drawn.mark.id, { closed: true }).project;

  const pasted = pasteMark(closed, markSnapshot(closed, drawn.mark.id), {
    schemeId: base.schemeId,
    point: { x: 0.5, y: 0.6 },
  });
  const copy = findMark(pasted.project, pasted.mark.id);

  assert.equal(copy.kind, "line");
  assert.equal(copy.closed, true, "замкнутая линия открылась при вставке");
  assert.deepEqual(copy.points, [
    { x: 0.5, y: 0.6 },
    { x: 0.7, y: 0.6 },
    { x: 0.7, y: 0.9 },
  ]);
});

test("у края плана ломаная не мнётся: сдвиг общий на все вершины", () => {
  const base = scene();
  const drawn = addMark(base.project, {
    schemeId: base.schemeId,
    typeId: typeId(base.project, "Л"),
    kind: "line",
    points: [
      { x: 0.1, y: 0.1 },
      { x: 0.4, y: 0.3 },
    ],
  });
  // Целимся вплотную к правому нижнему углу: вершины порознь подрезались бы
  // в одну точку, и лента по периметру комнаты вышла бы другой формы.
  const pasted = pasteMark(drawn.project, markSnapshot(drawn.project, drawn.mark.id), {
    schemeId: base.schemeId,
    point: { x: 0.99, y: 0.99 },
  });
  const copy = findMark(pasted.project, pasted.mark.id);

  const was = drawn.mark.points;
  assert.equal(
    Math.round((copy.points[1].x - copy.points[0].x) * 1e6),
    Math.round((was[1].x - was[0].x) * 1e6),
    "форма ломаной поехала по горизонтали",
  );
  assert.equal(
    Math.round((copy.points[1].y - copy.points[0].y) * 1e6),
    Math.round((was[1].y - was[0].y) * 1e6),
    "форма ломаной поехала по вертикали",
  );
  for (const item of copy.points) {
    assert.ok(item.x >= 0 && item.x <= 1 && item.y >= 0 && item.y <= 1, "вершина уехала за край плана");
  }
});

test("метка «одна на блок» остаётся одной меткой, а не рассыпается", () => {
  const base = scene();
  const single = updateType(base.project, typeId(base.project, "Р"), { blockMode: "single" }).project;
  const placed = addMark(single, {
    schemeId: base.schemeId,
    typeId: typeId(single, "Р"),
    kind: "point",
    points: [
      { x: 0.2, y: 0.2 },
      { x: 0.24, y: 0.2 },
      { x: 0.28, y: 0.2 },
    ],
  });
  assert.equal(placed.marks.length, 1, "фикстура не та: блок и так рассыпался");

  const pasted = pasteMark(placed.project, markSnapshot(placed.project, placed.mark.id), {
    schemeId: base.schemeId,
    point: { x: 0.6, y: 0.6 },
  });
  const copy = findMark(pasted.project, pasted.mark.id);

  assert.equal(pasted.project.marks.length, placed.project.marks.length + 1, "копия рассыпалась на несколько меток");
  assert.equal(copy.points.length, 3, "копия потеряла точки блока");
  assert.deepEqual(copy.points[0], { x: 0.6, y: 0.6 });
});

test("буфер — снимок: исходную метку удалили, вставка всё равно работает", () => {
  const base = scene();
  const placed = point(base, { x: 0.3, y: 0.5 });
  const snapshot = markSnapshot(placed.project, placed.mark.id);
  const gone = deleteMark(placed.project, placed.mark.id).project;

  const pasted = pasteMark(gone, snapshot, { schemeId: base.schemeId, point: { x: 0.4, y: 0.4 } });
  assert.equal(findMark(pasted.project, pasted.mark.id).typeId, snapshot.typeId);
  // Номер счётчика после удаления не откатывается — копия получает свой.
  assert.equal(findMark(pasted.project, pasted.mark.id).number, placed.mark.number + 1);
});

test("метка из объекта прежнего формата копируется без мусора в полях", () => {
  const base = scene();
  const placed = point(base, { x: 0.3, y: 0.5 });
  // Метка, размеченная до появления размеров, расположения и связей: полей
  // в ней нет вовсе, и `undefined` из снимка доехал бы до файла проекта.
  const old = {
    ...placed.project,
    marks: placed.project.marks.map((mark) => {
      const copy = { ...mark };
      for (const field of [...MARK_COPY_FIELDS, "controls", "roomManual"]) delete copy[field];
      return copy;
    }),
  };
  const snapshot = markSnapshot(old, placed.mark.id);
  for (const field of MARK_COPY_FIELDS) {
    assert.notEqual(snapshot[field], undefined, "в снимке undefined вместо пустоты: " + field);
  }

  const pasted = pasteMark(old, snapshot, { schemeId: base.schemeId, point: { x: 0.6, y: 0.5 } });
  const copy = findMark(pasted.project, pasted.mark.id);
  // Копия обязана выйти такой же, как метка, поставленная кликом: пустота —
  // это `""` и `null`, а не отсутствующее поле и не `undefined`.
  assert.equal(copy.location, "");
  assert.equal(copy.original, "");
  for (const field of ["length", "width", "heightAboveFloor"]) assert.equal(copy[field], null, field);
});

test("вставлять нечего — модель отказывается вслух", () => {
  const base = scene();
  const placed = point(base, { x: 0.3, y: 0.5 });
  const snapshot = markSnapshot(placed.project, placed.mark.id);

  assert.throws(
    () => pasteMark(placed.project, null, { schemeId: base.schemeId, point: { x: 0.5, y: 0.5 } }),
    (error) => error.code === "nothingToPaste",
  );
  // Тип успели удалить из справочника — копия без типа не встаёт.
  assert.throws(
    () => pasteMark(placed.project, { ...snapshot, typeId: "нет-такого-типа" }, {
      schemeId: base.schemeId,
      point: { x: 0.5, y: 0.5 },
    }),
    (error) => error.code === "typeNotFound",
  );
  assert.throws(
    () => pasteMark(placed.project, snapshot, { schemeId: "нет-такой-схемы", point: { x: 0.5, y: 0.5 } }),
    (error) => error.code === "schemeNotFound",
  );
});

// ——— лесенка повторных вставок ————————————————————————————————————————

const STEP = { x: 0.02, y: 0.03 };

test("вставили дважды в то же место — вторая копия отошла в сторону", () => {
  const first = canvasPasteSpot({ x: 0.5, y: 0.5 }, null, STEP);
  assert.deepEqual(first.point, { x: 0.5, y: 0.5 }, "первая копия обязана лечь ровно под курсор");

  const second = canvasPasteSpot({ x: 0.5, y: 0.5 }, first.run, STEP);
  assert.deepEqual(second.point, { x: 0.5 + STEP.x, y: 0.5 + STEP.y }, "вторая копия легла на первую");

  const third = canvasPasteSpot({ x: 0.5, y: 0.5 }, second.run, STEP);
  assert.deepEqual(third.point, { x: 0.5 + STEP.x * 2, y: 0.5 + STEP.y * 2 }, "лесенка не растёт");
});

test("показали в другое место — лесенка начинается заново", () => {
  const first = canvasPasteSpot({ x: 0.5, y: 0.5 }, null, STEP);
  const away = canvasPasteSpot({ x: 0.2, y: 0.8 }, first.run, STEP);
  assert.deepEqual(away.point, { x: 0.2, y: 0.8 }, "копия легла не туда, куда показали");
  assert.equal(away.run.count, 1);
});

test("дрогнувшая рука лесенку не сбивает, а осознанный сдвиг — сбивает", () => {
  const first = canvasPasteSpot({ x: 0.5, y: 0.5 }, null, STEP);
  // Мышь съехала на четверть шага: ближе половины шага метки всё равно
  // наложились бы — значит это та же точка и продолжение серии.
  const jitter = canvasPasteSpot({ x: 0.5 + STEP.x / 4, y: 0.5 }, first.run, STEP);
  assert.equal(jitter.run.count, 2, "дрожание руки сбило серию — копии лягут стопкой");
  // Отодвинулись на полтора шага — это уже новое место.
  const moved = canvasPasteSpot({ x: 0.5 + STEP.x * 1.5, y: 0.5 }, first.run, STEP);
  assert.equal(moved.run.count, 1);
  assert.deepEqual(moved.point, { x: 0.5 + STEP.x * 1.5, y: 0.5 });
});

test("лесенка не уводит копию за край плана", () => {
  let run = null;
  let last = null;
  for (let i = 0; i < 200; i += 1) {
    const spot = canvasPasteSpot({ x: 0.99, y: 0.99 }, run, STEP);
    run = spot.run;
    last = spot.point;
  }
  assert.deepEqual(last, { x: 1, y: 1 }, "копия уехала за край плана");
});

// ——— подсказка и словарь ——————————————————————————————————————————————

test("подсказка холста знает про Q, Ctrl+C и Ctrl+V", () => {
  const base = scene();
  const stateOf = (patch) => ({
    project: base.project,
    schemeId: base.schemeId,
    activeTypeId: null,
    activeRoomId: null,
    mode: "select",
    layout: "desktop",
    guidesShown: true,
    ...patch,
  });
  const socket = typeId(base.project, "Р");
  for (const state of [stateOf({}), stateOf({ activeTypeId: socket }), stateOf({ mode: "add", activeTypeId: socket })]) {
    const hint = canvasHintText(state);
    assert.ok(hint.includes("Q"), "подсказка молчит про пипетку: " + hint);
    assert.ok(hint.includes("Ctrl+C") && hint.includes("Ctrl+V"), "подсказка молчит про копирование: " + hint);
  }
  // В просмотре править нечего — и обещать жесты нельзя.
  assert.ok(!canvasHintText(stateOf({ layout: "mobile" })).includes("Ctrl+C"));
});

test("уведомления жестов есть в словаре и не пустые", () => {
  for (const key of ["needMark", "typeTaken", "copied", "pasted", "pasteEmpty", "hintCopy"]) {
    assert.equal(typeof strings.canvas[key], "string", "нет строки canvas." + key);
    assert.ok(strings.canvas[key].length > 0, "пустая строка canvas." + key);
  }
  assert.equal(typeof strings.history.pasteMark, "string", "у вставки нет ярлыка в истории");
  for (const key of ["typeTaken", "copied", "pasted"]) {
    assert.ok(strings.canvas[key].includes("{label}"), "уведомление не называет метку: " + key);
  }
});
