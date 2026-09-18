// Слияние двух экземпляров одного объекта. Молчаливая потеря чужой работы —
// главная опасность этой темы, поэтому здесь проверяется не «функция что-то
// вернула», а что именно выживает: разные метки складываются, спорные не
// исчезают, удаление не побеждает правку, номера не повторяются.
import test from "node:test";
import assert from "node:assert/strict";

import { mergeProjects, mergeWinner, areRelatedProjects } from "../src/merge.js";
import {
  createProject,
  addScheme,
  addMark,
  addRoom,
  addOutline,
  updateMark,
  deleteMark,
  addEquipment,
  addPlacement,
  acceptProblem,
  problemAccepted,
  setMarkNumber,
  validate,
} from "../src/model.js";

// Общий предок: объект с одной схемой, комнатой и парой меток.
function ancestor() {
  let project = createProject();
  const room = addRoom(project, { name: "Спальная" });
  project = room.project;
  const scheme = addScheme(project, { name: "1 этаж", imageId: "plan-1", width: 1000, height: 800 });
  project = scheme.project;
  for (let i = 0; i < 2; i += 1) {
    project = addMark(project, {
      schemeId: scheme.scheme.id,
      typeId: project.markTypes[0].id,
      points: [{ x: 0.2 + i / 10, y: 0.3 }],
    }).project;
  }
  return { project, schemeId: scheme.scheme.id, roomId: room.room.id };
}

// Второй браузер видит тот же объект через файл: копия, а не та же ссылка.
function copyOf(project, updatedAt) {
  const copy = JSON.parse(JSON.stringify(project));
  if (updatedAt) copy.updatedAt = updatedAt;
  return copy;
}

function stamp(project, updatedAt) {
  return { ...project, updatedAt };
}

function markLabels(project) {
  const codes = new Map(project.markTypes.map((type) => [type.id, type.code]));
  return project.marks.map((mark) => codes.get(mark.typeId) + mark.number).sort();
}

test("разные метки с двух сторон складываются без вопросов", () => {
  const { project: base, schemeId } = ancestor();
  const typeId = base.markTypes[0].id;

  const ours = stamp(
    addMark(base, { schemeId, typeId, points: [{ x: 0.5, y: 0.5 }] }).project,
    "2026-09-17T10:00:00.000Z",
  );
  const theirs = stamp(
    addMark(copyOf(base), { schemeId, typeId, points: [{ x: 0.7, y: 0.7 }] }).project,
    "2026-09-17T10:00:05.000Z",
  );

  const merged = mergeProjects(ours, theirs, base);
  assert.equal(merged.project.marks.length, 4, "обе новые метки на месте");
  assert.equal(merged.counts.added, 1, "со стороны пришла одна метка");
  assert.deepEqual(merged.conflicts, []);
  assert.equal(merged.changed, true);
  assert.equal(merged.changes[0].entity, "marks");
  assert.ok(merged.changes[0].label.length > 0, "у пришедшей метки есть подпись");
});

test("одну метку правили с двух сторон — остаётся вариант того, кто правил позже", () => {
  const { project: base, schemeId } = ancestor();
  const markId = base.marks[0].id;

  const ours = stamp(
    updateMark(base, markId, { location: "над тумбой" }).project,
    "2026-09-17T10:00:00.000Z",
  );
  const theirs = stamp(
    updateMark(copyOf(base), markId, { location: "у окна" }).project,
    "2026-09-17T10:05:00.000Z",
  );

  const merged = mergeProjects(ours, theirs, base);
  const kept = merged.project.marks.find((mark) => mark.id === markId);
  assert.equal(kept.location, "у окна");
  assert.equal(merged.conflicts.length, 1);
  assert.equal(merged.conflicts[0].code, "bothChanged");
  assert.equal(merged.conflicts[0].kept, "theirs");
  assert.equal(merged.conflicts[0].other.location, "над тумбой", "проигравший вариант не пропал из отчёта");

  // Обратный порядок сторон даёт тот же ответ: иначе файлы в папке ходили бы
  // по кругу, переписывая друг друга.
  const mirror = mergeProjects(theirs, ours, base);
  assert.equal(mirror.project.marks.find((mark) => mark.id === markId).location, "у окна");
  assert.deepEqual(markLabels(mirror.project), markLabels(merged.project));
});

test("удаление не побеждает правку, но чистое удаление принимается", () => {
  const { project: base, schemeId } = ancestor();
  const editedId = base.marks[0].id;
  const untouchedId = base.marks[1].id;

  // Мы правили первую метку, они её удалили; вторую они удалили, а мы не трогали.
  const ours = stamp(updateMark(base, editedId, { location: "у двери" }).project, "2026-09-17T10:00:00.000Z");
  let theirs = deleteMark(copyOf(base), editedId).project;
  theirs = stamp(deleteMark(theirs, untouchedId).project, "2026-09-17T10:09:00.000Z");

  const merged = mergeProjects(ours, theirs, base);
  const ids = merged.project.marks.map((mark) => mark.id);
  assert.ok(ids.includes(editedId), "правленая метка пережила чужое удаление");
  assert.ok(!ids.includes(untouchedId), "никем не тронутая метка удалена как просили");
  assert.equal(merged.counts.removed, 1);
  assert.equal(merged.conflicts.filter((conflict) => conflict.code === "deletedElsewhere").length, 1);
});

test("метку удалили у нас, а правили у них — она возвращается с пометкой", () => {
  const { project: base } = ancestor();
  const markId = base.marks[0].id;

  const ours = stamp(deleteMark(base, markId).project, "2026-09-17T10:00:00.000Z");
  const theirs = stamp(updateMark(copyOf(base), markId, { location: "перенесли" }).project, "2026-09-17T10:01:00.000Z");

  const merged = mergeProjects(ours, theirs, base);
  assert.ok(merged.project.marks.some((mark) => mark.id === markId), "правка вернула метку");
  assert.equal(merged.conflicts[0].code, "deletedHere");
  assert.equal(merged.conflicts[0].kept, "theirs");
});

test("двое выдали один номер — второй номер переезжает, а не дублируется", () => {
  const { project: base, schemeId } = ancestor();
  const typeId = base.markTypes[0].id;

  const ours = stamp(addMark(base, { schemeId, typeId, points: [{ x: 0.5, y: 0.5 }] }).project, "2026-09-17T10:00:00.000Z");
  const theirs = stamp(addMark(copyOf(base), { schemeId, typeId, points: [{ x: 0.9, y: 0.1 }] }).project, "2026-09-17T10:00:30.000Z");

  // Обе стороны выдали своей метке один и тот же следующий номер.
  const oursNumber = ours.marks[ours.marks.length - 1].number;
  assert.equal(theirs.marks[theirs.marks.length - 1].number, oursNumber);

  const merged = mergeProjects(ours, theirs, base);
  const labels = markLabels(merged.project);
  assert.equal(new Set(labels).size, labels.length, "обозначения не повторяются: " + labels.join(", "));
  assert.equal(merged.renumbered.length, 1);
  assert.equal(merged.renumbered[0].from, oursNumber);
  assert.equal(merged.renumbered[0].to, oursNumber + 1);
  const code = merged.renumbered[0].code;
  assert.ok(merged.project.counters[code] >= oursNumber + 1, "счётчик догнал выданный номер");

  // Тот же ответ с другой стороны: номера обязаны сойтись у обоих.
  assert.deepEqual(markLabels(mergeProjects(theirs, ours, base).project), labels);
});

test("ссылки на исчезнувшее снимаются: контуры, группы, связи", () => {
  const { project: base, schemeId, roomId } = ancestor();
  const typeId = base.markTypes[0].id;

  // У них: контур комнаты и блок из двух меток.
  let theirs = addOutline(copyOf(base), {
    schemeId,
    roomId,
    points: [{ x: 0.1, y: 0.1 }, { x: 0.4, y: 0.1 }, { x: 0.4, y: 0.5 }],
  }).project;
  const block = addMark(theirs, {
    schemeId,
    typeId,
    points: [{ x: 0.6, y: 0.6 }, { x: 0.65, y: 0.6 }],
  });
  theirs = stamp(block.project, "2026-09-17T10:10:00.000Z");
  assert.equal(theirs.groups.length, 1, "блок собрался группой");

  // У нас той же комнаты уже нет, а одна метка блока — ссылка в никуда.
  const ours = stamp({ ...base, rooms: [] }, "2026-09-17T10:00:00.000Z");

  const merged = mergeProjects(ours, theirs, base);
  assert.equal(merged.project.outlines.length, 0, "контур без комнаты снят");
  assert.ok(
    merged.conflicts.some((conflict) => conflict.code === "danglingRef" && conflict.entity === "outlines"),
    "о снятом контуре сказано",
  );
  for (const mark of merged.project.marks) {
    if (mark.groupId) assert.ok(merged.project.groups.some((group) => group.id === mark.groupId));
    for (const id of mark.controls || []) {
      assert.ok(merged.project.marks.some((other) => other.id === id), "связь ведёт в живую метку");
    }
  }
});

test("без общего предка стороны объединяются, и ничего не пропадает", () => {
  const { project: base, schemeId } = ancestor();
  const typeId = base.markTypes[0].id;
  const ours = stamp(addMark(base, { schemeId, typeId, points: [{ x: 0.5, y: 0.5 }] }).project, "2026-09-17T10:00:00.000Z");
  const theirs = stamp(deleteMark(copyOf(base), base.marks[0].id).project, "2026-09-17T10:02:00.000Z");

  const merged = mergeProjects(ours, theirs, null);
  assert.equal(merged.project.marks.length, 3, "без предка удаление не видно — метка остаётся");
  assert.equal(merged.counts.removed, 0);
});

test("чужой файл не сливается, а свой узнаётся", () => {
  const { project: base } = ancestor();
  const stranger = ancestor().project;
  assert.equal(areRelatedProjects(base, copyOf(base)), true);
  assert.equal(areRelatedProjects(base, stranger), false);
  assert.equal(mergeWinner({ updatedAt: "2026-01-01T00:00:00Z" }, { updatedAt: "2026-01-02T00:00:00Z" }), "theirs");
  assert.equal(mergeWinner({ updatedAt: "2026-01-03T00:00:00Z" }, { updatedAt: "2026-01-02T00:00:00Z" }), "ours");
});

test("две стороны сходятся к одному объекту, и повторный обмен уже ничего не меняет", () => {
  const { project: base, schemeId } = ancestor();
  const typeId = base.markTypes[0].id;
  const ours = stamp(addMark(base, { schemeId, typeId, points: [{ x: 0.5, y: 0.5 }] }).project, "2026-09-17T10:00:00.000Z");
  const theirs = stamp(addMark(copyOf(base), { schemeId, typeId, points: [{ x: 0.7, y: 0.2 }] }).project, "2026-09-17T10:00:10.000Z");

  const here = mergeProjects(ours, theirs, base).project;
  const there = mergeProjects(theirs, ours, base).project;
  assert.deepEqual(markLabels(here), markLabels(there), "обозначения разошлись у двух сторон");
  assert.deepEqual(
    here.marks.map((mark) => mark.id).sort(),
    there.marks.map((mark) => mark.id).sort(),
    "состав меток разошёлся",
  );

  const again = mergeProjects(here, there, base);
  assert.equal(again.changed, false, "второй обмен снова что-то поменял — файлы будут ходить по кругу");
});

test("слияние ничего не правит на месте: обе стороны остаются как были", () => {
  const { project: base, schemeId } = ancestor();
  const typeId = base.markTypes[0].id;
  const ours = stamp(addMark(base, { schemeId, typeId, points: [{ x: 0.5, y: 0.5 }] }).project, "2026-09-17T10:00:00.000Z");
  const theirs = stamp(deleteMark(copyOf(base), base.marks[0].id).project, "2026-09-17T10:04:00.000Z");
  const oursBefore = JSON.stringify(ours);
  const theirsBefore = JSON.stringify(theirs);

  mergeProjects(ours, theirs, base);

  assert.equal(JSON.stringify(ours), oursBefore, "наш объект правили на месте");
  assert.equal(JSON.stringify(theirs), theirsBefore, "чужой объект правили на месте");
});

test("оборудование и его привязки сливаются, привязка без метки снимается", () => {
  const { project: base } = ancestor();

  // У них заведено оборудование и привязано к метке.
  const gear = addEquipment(copyOf(base), { name: "Щит 1", vendor: "ABB", code: "SH1" });
  const placed = addPlacement(gear.project, { equipmentId: gear.equipment.id, markId: base.marks[0].id });
  const theirs = stamp(placed.project, "2026-09-17T11:00:00.000Z");

  // Мы ту метку не трогали, но завели своё оборудование.
  const mine = addEquipment(base, { name: "Бризер", vendor: "Tion", code: "B1" });
  const ours = stamp(mine.project, "2026-09-17T10:00:00.000Z");

  const merged = mergeProjects(ours, theirs, base);
  const names = merged.project.equipment.map((item) => item.name).sort();
  assert.deepEqual(names, ["Бризер", "Щит 1"], "оборудование сложилось: " + names.join(", "));
  assert.equal(merged.project.placements.length, 1, "привязка пришла со стороны");

  // А если метки, на которую ссылается привязка, уже нет — привязка снимается.
  const without = stamp(deleteMark(base, base.marks[0].id).project, "2026-09-17T12:00:00.000Z");
  const cleaned = mergeProjects(without, theirs, base);
  assert.equal(cleaned.project.placements.length, 0, "привязка ведёт в никуда");
  assert.ok(cleaned.conflicts.some((conflict) => conflict.entity === "placements" && conflict.code === "danglingRef"));
});

// ——— принятые предупреждения ——————————————————————————————————————————
//
// Пользователь: «добавь слияние списка принятых». Принятие — не правка
// разметки, а ответ на вопрос: «так и задумано». Значит слияние здесь не выбор
// стороны, а объединение — иначе второй человек из общей папки отвечает на те
// же повторы заново.
function acceptedKeys(project) {
  return (project.accepted || []).map((item) => item.key).sort();
}

// Повтор номера с двух сторон: у нас принят один, у них другой.
function withRepeats(base) {
  const [first, second] = base.project.marks;
  // Номер правится своей функцией: у `updateMark` его в белом списке нет.
  const project = setMarkNumber(base.project, second.id, first.number).project;
  const problems = validate(project);
  return { project, problems };
}

test("принятое одной стороной приезжает ко второй, и обмен не плодит дублей", () => {
  const base = ancestor();
  const start = withRepeats(base);
  const problem = start.problems.find((item) => item.code === "repeatedNumber");
  assert.ok(problem, "пример не тот: повтора номера нет");

  const ours = stamp(copyOf(start.project), "2026-02-01T10:00:00.000Z");
  const theirs = stamp(acceptProblem(copyOf(start.project), problem).project, "2026-02-01T11:00:00.000Z");
  assert.deepEqual(acceptedKeys(ours), [], "пример не тот: у нас принятого быть не должно");

  // Приехало к нам.
  const toUs = mergeProjects(ours, theirs, start.project).project;
  assert.deepEqual(acceptedKeys(toUs), [problem.key], "принятое не приехало");
  assert.equal(problemAccepted(toUs, problem.key), true);
  assert.ok(!validate(toUs).some((item) => item.key === problem.key), "принятое всё ещё спрашивают");

  // И в обратную сторону — тот же ответ.
  const toThem = mergeProjects(theirs, ours, start.project).project;
  assert.deepEqual(acceptedKeys(toThem), [problem.key], "своё принятое потерялось");

  // Повторный обмен файлами ничего не добавляет: ключ у записи один.
  const again = mergeProjects(toUs, toThem, start.project).project;
  assert.deepEqual(acceptedKeys(again), [problem.key], "список принятых вырос дублями");
  assert.equal(mergeProjects(again, again, start.project).project.accepted.length, 1);
});

test("принятое своё при совпадении ключа остаётся своим — со своим временем", () => {
  const base = ancestor();
  const start = withRepeats(base);
  const problem = start.problems.find((item) => item.code === "repeatedNumber");
  const mine = acceptProblem(copyOf(start.project), problem).project;
  const other = acceptProblem(copyOf(start.project), problem).project;
  other.accepted[0] = { ...other.accepted[0], at: "2020-01-01T00:00:00.000Z", label: "чужой текст" };

  const merged = mergeProjects(stamp(mine, "2026-02-02T10:00:00.000Z"), stamp(other, "2026-02-02T11:00:00.000Z"), start.project).project;
  assert.equal(merged.accepted.length, 1, "одна и та же строка приехала дважды");
  assert.equal(merged.accepted[0].at, mine.accepted[0].at, "своё время принятия подменили чужим");
  assert.equal(merged.accepted[0].label, mine.accepted[0].label);
});

// Объект прежней разметки поля не знает вовсе, и слияние не должно его заводить
// на пустом месте.
test("объекты без принятых сливаются как раньше", () => {
  const base = ancestor();
  const bare = copyOf(base.project);
  delete bare.accepted;
  const other = copyOf(bare);
  const merged = mergeProjects(stamp(bare, "2026-02-03T10:00:00.000Z"), stamp(other, "2026-02-03T11:00:00.000Z"), bare).project;
  assert.equal(merged.accepted, undefined, "поле завелось само у объекта, который его не знал");
  assert.deepEqual(acceptedKeys(merged), []);
});
