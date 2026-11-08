// Блок из двух готовых меток и выход из блока (таск 244, требования G366 и
// G367).
//
// Слова заказчика: «у метки кнопку - добавить в блок. При наатии предлагает
// кликнуть на метку в другом блоке. Если метка уже была в блоке, то эти блоки
// мёржатся в один, позиция меток остаётся. Если же нажали на метку без блока,
// то они обе создают блок»; и следом — «Убрать из блока - тоже сделай».
//
// Проверяется здесь пять вещей, и первая — главное обещание команды:
//
// 1. **ни одна точка не двинулась** — ни при сборе, ни при выходе;
// 2. блок остался блоком: подпись-перечисление, порядок внутри, `validate` без
//    находок, правило «группа меньше двух меток недопустима»;
// 3. **данные, висящие на порядке массива `project.marks`**, целы: нумерация,
//    связи «чем управляет» и ведущая метка устройства (`deviceFollowers` берёт
//    первую по массиву) — перестановка молча передала бы аксессуар другой
//    метке;
// 4. отказы: та же метка, комментарий, линия, чужая схема, один и тот же блок;
// 5. ожидание щелчка — **готовый механизм холста**, а не третий способ: тот же
//    режим состояния, что у калибровки и у помещения по чертежу.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  COMMENT_TYPE_ID,
  MARK_KIND_COMMENT,
  addMark,
  addScheme,
  addToGroup,
  blockLabel,
  blockMembers,
  createProject,
  deviceFollowers,
  findGroup,
  findMark,
  joinToBlock,
  blockLabelOf,
  labelOf,
  leaveBlock,
  markDeviceLeader,
  setMarkControls,
  setMarkNumber,
  updateMark,
  validate,
} from "../src/model.js";
import {
  CANVAS_MODE_BLOCK_JOIN,
  CANVAS_MODE_NOTES,
  canvasBlockJoining,
  canvasGrabKind,
  canvasHintText,
  canvasTapKind,
} from "../src/canvas.js";
import { strings } from "../src/strings.js";

const SRC_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
const read = (name) => readFileSync(join(SRC_DIR, name), "utf8");

const PLAN = { width: 1000, height: 500 };

// Оснастка: схема и столько одиночных меток заданных типов, сколько просят.
// Точки разведены по плану — на то и проверка, что команда их не трогает.
function scene(codes) {
  let project = addScheme(createProject(), { name: "1 этаж", ...PLAN }).project;
  const typeOf = (code) => project.markTypes.find((type) => type.code === code).id;
  const schemeId = project.schemes[0].id;
  const ids = [];
  codes.forEach((code, index) => {
    const made = addMark(project, {
      schemeId,
      typeId: typeOf(code),
      kind: code === MARK_KIND_COMMENT ? MARK_KIND_COMMENT : "point",
      points: [{ x: 0.1 + index * 0.15, y: 0.2 + index * 0.1 }],
    });
    project = made.project;
    ids.push(made.mark.id);
  });
  return { project, schemeId, ids, typeOf };
}

// Блок «каждая своя» из метки и её соседок справа: тем же путём, которым его
// собирает ручка «+».
function grown(project, markId, count, typeId) {
  let next = project;
  const ids = [markId];
  let last = markId;
  for (let index = 0; index < count; index += 1) {
    const step = addToGroup(next, last, "right", typeId ? { typeId } : {});
    next = step.project;
    last = step.mark.id;
    ids.push(step.mark.id);
  }
  return { project: next, ids };
}

// Точки всех меток объекта — снимком для сверки «ничего не двинулось».
const placesOf = (project) =>
  JSON.stringify(project.marks.map((mark) => ({ id: mark.id, points: mark.points })));

// Порядок массива меток: на нём висят нумерация, связи и ведущая устройства.
const orderOf = (project) => project.marks.map((mark) => mark.id).join(" ");

// Находки про блок: `validate` на стартовом справочнике говорит и о своём
// (одинаковые формы, близкие цвета) — к блокам это отношения не имеет.
const blockProblems = (project) =>
  validate(project)
    .filter((problem) => /group|block/i.test(problem.code))
    .map((problem) => problem.code);

// ——— две одиночные метки собираются в блок ——————————————————————————————

test("две метки без блока образуют новый блок, и ни одна не сдвинулась", () => {
  const base = scene(["В", "Р"]);
  const places = placesOf(base.project);
  const result = joinToBlock(base.project, base.ids[0], base.ids[1]);

  assert.equal(result.project.groups.length, 1, "блок не завёлся");
  assert.deepEqual([...result.group.markIds].sort(), [...base.ids].sort(), "в блоке не те метки");
  for (const id of base.ids) {
    assert.equal(findMark(result.project, id).groupId, result.group.id, "метка не попала в блок: " + id);
  }
  assert.equal(placesOf(result.project), places, "метка сдвинулась — это и есть запрет требования");
  // Подпись блока — перечисление, и собирает её та же `blockLabelParts`.
  assert.equal(blockLabel(result.project, result.group.markIds), "В1, Р1");
  assert.equal(blockLabelOf(result.project, result.group.id), "В1, Р1");
  assert.deepEqual(blockProblems(result.project), [], "у собранного блока нашлись находки");
});

test("хозяин нового блока — вторая метка: подпись блока встаёт по её смещению", () => {
  const base = scene(["В", "Р"]);
  // Обе подписи оттащены рукой, и у блока она может быть только одна.
  let project = updateMark(base.project, base.ids[0], { labelOffset: { dx: 40, dy: 0 } }).project;
  project = updateMark(project, base.ids[1], { labelOffset: { dx: -30, dy: 12 } }).project;
  const result = joinToBlock(project, base.ids[0], base.ids[1]);
  // Смещение подписи блока модель хранит у первой метки списка
  // (`render.labelOffsetOf`), и первой стоит та, по которой щёлкнули.
  assert.equal(result.group.markIds[0], base.ids[1], "хозяином блока стала не показанная метка");
  // Отданное смещение не стёрто: метку однажды вынут, и подпись вернётся туда,
  // где её оставили рукой (G68 — своего пользователь не теряет).
  assert.deepEqual(findMark(result.project, base.ids[0]).labelOffset, { dx: 40, dy: 0 });
});

// ——— блок с блоком ——————————————————————————————————————————————————————

test("два блока сливаются в один, позиции меток остаются", () => {
  const base = scene(["В", "Р"]);
  const left = grown(base.project, base.ids[0], 1);
  const right = grown(left.project, base.ids[1], 2);
  const project = right.project;
  assert.equal(project.groups.length, 2, "оснастка собрала не два блока");
  const places = placesOf(project);
  const order = orderOf(project);

  const result = joinToBlock(project, left.ids[0], right.ids[0]);
  assert.equal(result.project.groups.length, 1, "блоки не слились");
  assert.equal(result.group.markIds.length, 5, "в слитом блоке не все метки");
  assert.deepEqual(
    [...result.group.markIds].sort(),
    [...left.ids, ...right.ids].sort(),
    "в слитом блоке не те метки",
  );
  for (const id of [...left.ids, ...right.ids]) {
    assert.equal(findMark(result.project, id).groupId, result.group.id, "метка осталась в прежнем блоке: " + id);
  }
  assert.equal(placesOf(result.project), places, "слияние блоков двинуло метку");
  assert.equal(orderOf(result.project), order, "порядок массива меток переставлен");
  // Хозяин — блок показанной метки, и первым в списке остаётся его первая метка.
  assert.equal(result.group.markIds[0], right.ids[0], "хозяином стал не показанный блок");
  assert.deepEqual(blockProblems(result.project), [], "у слитого блока нашлись находки");
});

test("подпись, порядок внутри и нумерация слитого блока целы", () => {
  const base = scene(["В", "Р"]);
  const left = grown(base.project, base.ids[0], 1);
  const right = grown(left.project, base.ids[1], 2);
  const counters = JSON.stringify(right.project.counters);
  const numbers = right.project.marks.map((mark) => mark.number).join(" ");

  const result = joinToBlock(right.project, left.ids[0], right.ids[0]);
  // Подпись — перечисление по справочнику и номеру, а не по порядку слияния:
  // выключатели раньше розеток, внутри подряд идущие номера свёрнуты.
  assert.equal(blockLabel(result.project, result.group.markIds), "В1В2, Р1–3");
  assert.deepEqual(
    blockMembers(result.project, result.group.markIds).map((mark) => labelOf(result.project, mark.id)),
    ["В1", "В2", "Р1", "Р2", "Р3"],
    "порядок внутри блока сложился не по справочнику и номеру",
  );
  // Номера и счётчики — ни один не тронут: сбор блока их не выдаёт и не сдвигает.
  assert.equal(JSON.stringify(result.project.counters), counters, "счётчики нумерации поехали");
  assert.equal(result.project.marks.map((mark) => mark.number).join(" "), numbers, "номер метки изменился");
});

test("связи и аксессуар ведущей метки слияние не трогает", () => {
  const base = scene(["В", "Т", "Т"]);
  // Два светильника с одним обозначением — одно устройство: ведущая первая по
  // массиву, у неё и аксессуар (`deviceFollowers`).
  let project = setMarkNumber(base.project, base.ids[2], findMark(base.project, base.ids[1]).number).project;
  project = setMarkControls(project, base.ids[0], [base.ids[1]]).project;
  const left = grown(project, base.ids[0], 1);
  const right = grown(left.project, base.ids[1], 1);
  const leaderBefore = markDeviceLeader(right.project, base.ids[2]);
  assert.equal(leaderBefore, base.ids[1], "оснастка не свела два светильника в одно устройство");

  const result = joinToBlock(right.project, left.ids[0], right.ids[0]);
  assert.equal(markDeviceLeader(result.project, base.ids[2]), base.ids[1], "аксессуар уехал к другой метке");
  assert.equal(deviceFollowers(result.project).size, deviceFollowers(right.project).size);
  assert.deepEqual(findMark(result.project, base.ids[0]).controls, [base.ids[1]], "связь «чем управляет» потерялась");
});

test("одиночная метка входит в готовый блок с любой стороны щелчка", () => {
  const base = scene(["В", "Р"]);
  const block = grown(base.project, base.ids[1], 2);
  const lone = base.ids[0];

  // Щёлкнули по метке блока: блок и остаётся хозяином.
  const into = joinToBlock(block.project, lone, block.ids[0]);
  assert.equal(into.project.groups.length, 1);
  assert.equal(into.group.markIds.length, 4);
  assert.equal(into.group.id, block.project.groups[0].id, "блок завёлся заново вместо роста");

  // Щёлкнули наоборот — по одиночной метке, стоя в блоке: блока у неё нет,
  // значит хозяином остаётся тот единственный, который есть.
  const back = joinToBlock(block.project, block.ids[0], lone);
  assert.equal(back.project.groups.length, 1);
  assert.equal(back.group.markIds.length, 4);
  assert.equal(findMark(back.project, lone).groupId, back.group.id, "одиночная метка не вошла в блок");
});

// ——— отказы —————————————————————————————————————————————————————————————

test("отказы названы причиной, а не молчанием", () => {
  const base = scene(["В", "Р"]);
  assert.throws(() => joinToBlock(base.project, base.ids[0], base.ids[0]), { code: "blockJoinSelf" });

  // Комментарий — надпись на плане, а не изделие.
  const plate = addMark(base.project, {
    schemeId: base.schemeId,
    typeId: COMMENT_TYPE_ID,
    kind: MARK_KIND_COMMENT,
    points: [{ x: 0.6, y: 0.6 }],
  });
  assert.throws(() => joinToBlock(plate.project, base.ids[0], plate.mark.id), { code: "commentNoBlock" });
  assert.throws(() => joinToBlock(plate.project, plate.mark.id, base.ids[0]), { code: "commentNoBlock" });

  // Линия: блок собирается только из точек — это правило старше таска.
  const lineType = base.project.markTypes.find((type) => type.kind === "line");
  const line = addMark(base.project, {
    schemeId: base.schemeId,
    typeId: lineType.id,
    kind: "line",
    points: [
      { x: 0.2, y: 0.8 },
      { x: 0.5, y: 0.8 },
    ],
  });
  assert.throws(() => joinToBlock(line.project, base.ids[0], line.mark.id), { code: "blockOnlyForPoints" });

  // Чужая схема: группа меток двух схем — уже поломка (`groupAcrossSchemes`).
  const second = addScheme(base.project, { name: "2 этаж", ...PLAN });
  const far = addMark(second.project, {
    schemeId: second.scheme.id,
    typeId: base.typeOf("Р"),
    points: [{ x: 0.4, y: 0.4 }],
  });
  assert.throws(() => joinToBlock(far.project, base.ids[0], far.mark.id), { code: "blockJoinScheme" });

  // Уже в одном блоке: сливать нечего, и делать вид, что что-то случилось, нельзя.
  const block = grown(base.project, base.ids[0], 1);
  assert.throws(() => joinToBlock(block.project, block.ids[0], block.ids[1]), { code: "blockJoinSame" });
});

// ——— выход из блока ————————————————————————————————————————————————————

test("метка выходит из блока и остаётся на своём месте", () => {
  const base = scene(["Р"]);
  const block = grown(base.project, base.ids[0], 2);
  const places = placesOf(block.project);
  const order = orderOf(block.project);

  const result = leaveBlock(block.project, block.ids[1]);
  assert.equal(result.dissolved, false, "блок из трёх распался от выхода одной");
  assert.equal(findMark(result.project, block.ids[1]).groupId, null, "метка осталась в блоке");
  assert.equal(result.project.groups.length, 1, "блок исчез вместе с меткой");
  assert.deepEqual(findGroup(result.project, block.project.groups[0].id).markIds, [block.ids[0], block.ids[2]]);
  assert.equal(placesOf(result.project), places, "выход из блока двинул метку");
  assert.equal(orderOf(result.project), order, "порядок массива меток переставлен");
  // Подпись осталась подписью блока — только без вышедшей метки.
  assert.equal(blockLabel(result.project, [block.ids[0], block.ids[2]]), "Р1, Р3");
  assert.equal(labelOf(result.project, block.ids[1]), "Р2", "обозначение вышедшей метки изменилось");
  assert.deepEqual(blockProblems(result.project), [], "после выхода нашлись находки");
});

test("блок из двух распадается целиком: группа меньше двух меток недопустима", () => {
  const base = scene(["Р"]);
  const block = grown(base.project, base.ids[0], 1);
  const places = placesOf(block.project);
  const counters = JSON.stringify(block.project.counters);

  const result = leaveBlock(block.project, block.ids[1]);
  assert.equal(result.dissolved, true, "блок из двух не распался");
  assert.deepEqual(result.project.groups, [], "от блока осталась группа из одной метки");
  for (const id of block.ids) {
    assert.equal(findMark(result.project, id).groupId, null, "метка держится за исчезнувший блок: " + id);
  }
  assert.equal(placesOf(result.project), places, "распад блока двинул метку");
  assert.equal(JSON.stringify(result.project.counters), counters, "счётчики нумерации поехали");
  assert.deepEqual(blockProblems(result.project), [], "после распада нашлись находки");
  // Обозначения целы у обеих: распался блок, а не разметка.
  assert.deepEqual(block.ids.map((id) => labelOf(result.project, id)), ["Р1", "Р2"]);
});

test("связи вышедшей метки и её соседей остаются", () => {
  const base = scene(["В", "Т"]);
  const project = setMarkControls(base.project, base.ids[0], [base.ids[1]]).project;
  const block = grown(project, base.ids[0], 1);
  const result = leaveBlock(block.project, block.ids[1]);
  assert.deepEqual(findMark(result.project, base.ids[0]).controls, [base.ids[1]], "связь потерялась при выходе");
});

test("метке без блока выходить некуда, и команда говорит это словом", () => {
  const base = scene(["Р"]);
  assert.throws(() => leaveBlock(base.project, base.ids[0]), { code: "blockLeaveAlone" });
  // Блок-одна-метка (метка со многими точками) сюда не ходит вовсе: вынимать
  // из неё нечего — она сама себе блок, и «убрать» означало бы для неё удалить
  // точку, то есть потерять место установки.
  const many = updateMark(base.project, base.ids[0], {
    points: [
      { x: 0.3, y: 0.3 },
      { x: 0.32, y: 0.3 },
    ],
  }).project;
  assert.throws(() => leaveBlock(many, base.ids[0]), { code: "blockLeaveAlone" });
});

test("собранное разбирается обратно: объект возвращается к прежнему виду", () => {
  const base = scene(["В", "Р"]);
  const before = JSON.stringify({ marks: base.project.marks, groups: base.project.groups });
  const joined = joinToBlock(base.project, base.ids[0], base.ids[1]);
  const back = leaveBlock(joined.project, base.ids[0]);
  assert.equal(
    JSON.stringify({ marks: back.project.marks, groups: back.project.groups }),
    before,
    "сбор и выход вернули не то, с чего начинали",
  );
});

// ——— ожидание щелчка: тот же механизм, что у калибровки ————————————————

test("режим забирает клик себе: ручка выделенной метки его не отбирает", () => {
  const base = scene(["В", "Р"]);
  const state = {
    project: base.project,
    schemeId: base.schemeId,
    activeTypeId: base.typeOf("Р"),
    activeRoomId: null,
    selectedMarkIds: [base.ids[0]],
    selectedOutlineId: null,
    editPathId: null,
    mode: CANVAS_MODE_BLOCK_JOIN,
    layout: "desktop",
    view: { zoom: 1, offsetX: 0, offsetY: 0 },
  };
  // Ручка «+» висит ровно на шаге блока, то есть накрывает соседа — как раз ту
  // метку, по которой человек и целится. Тап достаётся команде.
  assert.equal(canvasTapKind(state, { blockSide: "right", markId: base.ids[1] }), "blockJoin");
  assert.equal(canvasTapKind(state, { labelTurn: true }), "blockJoin");
  assert.equal(canvasTapKind(state, { pathHandle: { kind: "vertex", index: 0 } }), "blockJoin");
  // Долгое нажатие не берёт ничего: метку сейчас показывают, а не возят, —
  // уехавшая под пальцем метка была бы тем самым сдвигом, которого быть не должно.
  assert.equal(canvasGrabKind(state, { markId: base.ids[1] }), null);
  // Выделение в режиме живо: первую метку блока команда берёт оттуда.
  assert.ok(canvasBlockJoining(state, base.ids[0]));
  assert.ok(!canvasBlockJoining(state, base.ids[1]), "ждущей показана не та метка");
  assert.ok(!canvasBlockJoining({ ...state, mode: "select" }, base.ids[0]));
  // Подсказка называет первую метку и обещает, что ничего не сдвинется.
  const hint = canvasHintText(state);
  assert.match(hint, /В1/);
  assert.match(hint, /не сдвин/);
  assert.match(hint, /Esc/);
  // О входе в режим говорит плашка: своей кнопки в ряду «Режим» у него нет, но
  // имя есть — без строки ряд показал бы ключ режима латиницей.
  assert.equal(CANVAS_MODE_NOTES[CANVAS_MODE_BLOCK_JOIN], strings.canvas.modeBlockJoinSaid);
  assert.equal(typeof strings.tools["mode_" + CANVAS_MODE_BLOCK_JOIN], "string");
  assert.equal(typeof strings.tools["modeNow_" + CANVAS_MODE_BLOCK_JOIN], "string");
});

test("третьего способа «подожди, пока ткнут» не завелось", () => {
  const canvas = read("canvas.js");
  // Ожидание — режим состояния, как калибровка и помещение по чертежу: своей
  // подписки на документ, своего таймера и своего слушателя клика у команды нет.
  const body = canvas.slice(canvas.indexOf("function canvasBlockJoinClick"));
  const command = body.slice(0, body.indexOf("\n}\n"));
  assert.ok(!/addEventListener/.test(command), "команда блока завела свой слушатель клика");
  // Попадание считается тем же `hitTest`, что и выделение: второго правила
  // «какая метка под рукой» в сборке быть не должно.
  assert.ok(command.includes("hitTest("), "команда блока ищет метку не общим попаданием");
  // Дверь в режим одна (как у калибровки и у помещения по чертежу): второй
  // вход однажды забыл бы снять выделение или вернуть поле на план.
  assert.equal(
    (canvas.match(/mode: CANVAS_MODE_BLOCK_JOIN/g) || []).length,
    1,
    "в ожидание входят из двух мест — дверь должна быть одна (`canvasStartBlockJoin`)",
  );
  // И дверь наружу одна: Esc, уведённое выделение и повторное нажатие кнопки
  // уходят через `canvasStopBlockJoin`, а не каждый своим `setState`.
  const card = read(join("panels", "markCard.js"));
  assert.ok(canvas.includes("canvasStopBlockJoin();"), "Esc и сторож режима не зовут общий выход");
  assert.ok(card.includes("canvasStopBlockJoin()"), "повторное нажатие кнопки не снимает ожидание общей дверью");
});

test("ряд «Блок» живёт в карточке плана, а в объёме его нет", () => {
  const card = read(join("panels", "markCard.js"));
  const volume = read(join("panels", "volume.js"));
  assert.ok(card.includes("block: markCardBlockRow(state, model.id)"), "карточка плана не показывает ряд блока");
  assert.ok(!/block:\s*markCardBlockRow/.test(volume), "ряд блока уехал в карточку объёма");
  // Правка объекта идёт одной дверью: `canvasCommit` со своим ярлыком истории.
  const canvas = read("canvas.js");
  assert.ok(canvas.includes("strings.history.blockJoin"), "сбор блока пишется в историю без своего ярлыка");
  assert.ok(canvas.includes("strings.history.blockLeave"), "выход из блока пишется в историю без своего ярлыка");
  assert.notEqual(strings.history.blockJoin, strings.history.blockLeave, "сбор и разбор названы одинаково");
});

// ——— G68: объект новых полей не получил ————————————————————————————————

test("ни у метки, ни у блока не завелось нового поля", () => {
  const base = scene(["В", "Р"]);
  const fieldsOf = (project) =>
    JSON.stringify([
      [...new Set(project.marks.flatMap((mark) => Object.keys(mark)))].sort(),
      [...new Set(project.groups.flatMap((group) => Object.keys(group)))].sort(),
    ]);
  const grownUp = grown(base.project, base.ids[1], 1);
  const known = fieldsOf(grownUp.project);
  const joined = joinToBlock(grownUp.project, base.ids[0], grownUp.ids[0]);
  assert.equal(fieldsOf(joined.project), known, "сбор блока дописал объекту поле");
  const left = leaveBlock(joined.project, base.ids[0]);
  assert.equal(fieldsOf(left.project), known, "выход из блока дописал объекту поле");
});
