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
  addEquipmentType,
  addPlacement,
  acceptProblem,
  deleteCategory,
  deleteEquipment,
  deleteEquipmentType,
  deleteScheme,
  deleteType,
  MARK_NUMBER_MAX,
  problemAccepted,
  repeatedNumbers,
  setMarkNumber,
  updateEquipment,
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

// Обозначения в порядке постановки меток: для намеренного повтора важен не
// только состав, но и то, что номер остался у той же метки.
function numbersById(project) {
  const codes = new Map(project.markTypes.map((type) => [type.id, type.code]));
  const pairs = project.marks.map((mark) => [mark.id, codes.get(mark.typeId) + mark.number]);
  return Object.fromEntries(pairs.sort((a, b) => (a[0] < b[0] ? -1 : 1)));
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
  // Ключ принятия обязан по-прежнему указывать на живой повтор: пока он жив,
  // утверждение выше что-то значит. Раньше повтор уничтожался самим слиянием,
  // и «принятое не спрашивают» выполнялось оттого, что спрашивать стало не о
  // чем, — такая проверка не могла покраснеть ни при какой поломке принятий.
  const stillAsked = validate(toUs).find((item) => item.key === problem.key);
  assert.ok(stillAsked, "повтор не пережил слияния — проверка принятия обессмыслилась");
  assert.equal(stillAsked.code, "repeatedNumber");
  assert.deepEqual(numbersById(toUs), numbersById(start.project), "слияние переписало номера");

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

// ——— намеренный повтор номера ————————————————————————————————————————
//
// Повтор номера — приём заказчика, а не поломка: «надо разрешить указание
// цифры для метки (например несколько точечных светильников в 1 группе)»
// (G25), «Повтор номера это не предупреждение тут, а специально сделано»
// (G96). Модель это бережёт — `compactNumbers` намеренный повтор переживает, —
// и слияние обязано беречь тоже: номер уже написан на схеме и в таблице,
// применяется слияние без спроса, а следом обрывается история. Ctrl+Z не
// вернёт.
//
// Общего предка при этом часто нет вовсе: `autosaveBase` до первой своей
// записи в сеансе — `null`. Поэтому каждая проверка идёт и без предка тоже.
function withLights(count, number) {
  let project = createProject();
  const scheme = addScheme(project, { name: "1 этаж", imageId: "plan-1", width: 1000, height: 800 });
  project = scheme.project;
  const typeId = project.markTypes[0].id;
  const ids = [];
  for (let i = 0; i < count; i += 1) {
    const added = addMark(project, { schemeId: scheme.scheme.id, typeId, points: [{ x: 0.1 + i / 20, y: 0.3 }] });
    project = added.project;
    ids.push(added.mark.id);
  }
  // Номер правится своей командой: у `updateMark` его в белом списке нет.
  for (const id of ids) project = setMarkNumber(project, id, number).project;
  return { project, schemeId: scheme.scheme.id, typeId, ids };
}

test("шесть светильников одной группы носят один номер и после слияния", () => {
  const start = withLights(6, 1);
  const before = numbersById(start.project);
  assert.deepEqual(Object.values(before), ["Т1", "Т1", "Т1", "Т1", "Т1", "Т1"], "пример не тот");

  const ours = stamp(copyOf(start.project), "2026-09-17T10:00:00.000Z");
  const theirs = stamp(copyOf(start.project), "2026-09-17T10:00:05.000Z");

  for (const base of [null, start.project]) {
    const merged = mergeProjects(ours, theirs, base);
    assert.deepEqual(numbersById(merged.project), before, "слияние развело намеренный повтор");
    assert.deepEqual(merged.renumbered, [], "слияние переномеровало то, что никто не просил");
    // И с другой стороны — тот же ответ.
    assert.deepEqual(numbersById(mergeProjects(theirs, ours, base).project), before);
  }
});

test("слияние двух копий одного файла без правок ничего не меняет", () => {
  const start = withLights(4, 2);
  const project = stamp(start.project, "2026-09-17T09:00:00.000Z");
  const twin = copyOf(project);

  // Общего предка нет — самый частый случай: `autosaveBase` в начале сеанса пуст.
  const first = mergeProjects(project, twin, null);
  assert.equal(first.changed, false, "слияние копии с копией объявило объект изменённым");
  assert.deepEqual(first.renumbered, []);
  assert.deepEqual(first.conflicts, []);

  // Третья копия из той же папки — тоже ничего.
  const third = mergeProjects(first.project, copyOf(project), null);
  assert.equal(third.changed, false, "третий файл в папке снова переписал объект");
  assert.deepEqual(numbersById(third.project), numbersById(project));
});

test("метка из общего предка номер сохраняет, а разъезжается новая", () => {
  const { project: base, schemeId } = ancestor();
  const typeId = base.markTypes[0].id;
  const oldId = base.marks[1].id;

  // У нас новая метка получила следующий номер; у них тот же номер поставили
  // руками метке, которая была в общем предке.
  const added = addMark(base, { schemeId, typeId, points: [{ x: 0.5, y: 0.5 }] });
  const ours = stamp(added.project, "2026-09-17T10:00:00.000Z");
  const newId = added.mark.id;
  const theirs = stamp(setMarkNumber(copyOf(base), oldId, added.mark.number).project, "2026-09-17T10:05:00.000Z");

  const merged = mergeProjects(ours, theirs, base);
  const numbers = numbersById(merged.project);
  assert.equal(numbers[oldId], "Т" + added.mark.number, "метке из общего предка переписали номер");
  assert.notEqual(numbers[newId], numbers[oldId], "номера остались одинаковыми");
  assert.equal(merged.renumbered.length, 1);
  assert.equal(merged.renumbered[0].markId, newId, "переехала не та метка");
});

test("столкнувшаяся группа переезжает целиком, и принятое едет за ней", () => {
  const { project: base, schemeId } = ancestor();
  const typeId = base.markTypes[0].id;

  // У нас — намеренная группа из трёх светильников под одним номером, и ответ
  // «так и задумано» на неё уже дан.
  let mine = base;
  const group = [];
  for (let i = 0; i < 3; i += 1) {
    const added = addMark(mine, { schemeId, typeId, points: [{ x: 0.4 + i / 20, y: 0.6 }] });
    mine = added.project;
    group.push(added.mark.id);
  }
  for (const id of group) mine = setMarkNumber(mine, id, 7).project;
  const repeat = validate(mine).find((item) => item.code === "repeatedNumber");
  assert.ok(repeat, "пример не тот: повтора нет");
  const ours = stamp(acceptProblem(mine, repeat).project, "2026-09-17T10:00:00.000Z");

  // У них под тем же номером — своя, ничего не знающая об этом метка.
  const alien = addMark(copyOf(base), { schemeId, typeId, points: [{ x: 0.9, y: 0.9 }] });
  const theirs = stamp(setMarkNumber(alien.project, alien.mark.id, 7).project, "2026-09-17T10:05:00.000Z");

  const merged = mergeProjects(ours, theirs, base);
  const numbers = numbersById(merged.project);
  const groupNumbers = new Set(group.map((id) => numbers[id]));
  assert.equal(groupNumbers.size, 1, "группу разорвало по разным номерам: " + [...groupNumbers].join(", "));
  assert.notEqual(numbers[alien.mark.id], [...groupNumbers][0], "чужая метка осталась в группе");

  // Повтор уцелел, и ответ на него по-прежнему закрыт — на том номере, на
  // котором группа оказалась.
  const live = repeatedNumbers(merged.project).find((item) => item.markIds.length === 3);
  assert.ok(live, "намеренный повтор из трёх меток не пережил слияния");
  assert.equal(problemAccepted(merged.project, "repeatedNumber:" + typeId + "#" + live.number), true, "ответ «так и задумано» остался на номере, которого больше нет");
  assert.equal(merged.project.accepted.length, 1, "список принятых вырос");
});

// ——— справочник типов оборудования ——————————————————————————————————
//
// Тип модели — такой же справочник объекта, как категории и типы меток. Не
// сливайся он — «Реле 4 канала», заведённое вторым участником, пропадало бы у
// обоих молча, а его модели оставались бы с пустой колонкой типа.
test("типы оборудования сливаются в обе стороны, и модели не остаются без типа", () => {
  const { project: base } = ancestor();

  const myType = addEquipmentType(copyOf(base), { name: "Шина заземления" });
  const ours = stamp(
    addEquipment(myType.project, { name: "Шина ШЗ-12", vendor: "ABB", typeId: myType.equipmentType.id }).project,
    "2026-09-17T10:00:00.000Z",
  );
  const theirType = addEquipmentType(copyOf(base), { name: "Реле 8 каналов" });
  const theirs = stamp(
    addEquipment(theirType.project, { name: "Реле Р8", vendor: "Wirenboard", typeId: theirType.equipmentType.id }).project,
    "2026-09-17T11:00:00.000Z",
  );

  for (const [a, b] of [[ours, theirs], [theirs, ours]]) {
    const merged = mergeProjects(a, b, base).project;
    const names = merged.equipmentTypes.map((type) => type.name);
    assert.ok(names.includes("Шина заземления"), "наш тип пропал: " + names.length + " типов");
    assert.ok(names.includes("Реле 8 каналов"), "тип со стороны пропал: " + names.length + " типов");
    assert.equal(merged.equipmentTypes.length, base.equipmentTypes.length + 2);
    assert.equal(merged.equipment.length, 2, "модель потерялась");
    for (const item of merged.equipment) {
      assert.ok(
        merged.equipmentTypes.some((type) => type.id === item.typeId),
        "у модели «" + item.name + "» тип ведёт в никуда",
      );
    }
    // Порядок справочника пересобирается без дыр — как у категорий и типов меток.
    assert.deepEqual(
      merged.equipmentTypes.map((type) => type.order),
      merged.equipmentTypes.map((type, index) => index),
    );
  }
});

test("тип оборудования, удалённый на другой стороне, возвращается — на нём чужая модель", () => {
  const { project: base } = ancestor();
  const seeded = addEquipmentType(base, { name: "Реле 8 каналов" });
  const start = seeded.project;
  const typeId = seeded.equipmentType.id;

  // Мы тип убрали (моделей на нём не было), они в это же время завели на него модель.
  const ours = stamp(deleteEquipmentType(start, typeId).project, "2026-09-17T10:00:00.000Z");
  const theirs = stamp(
    addEquipment(copyOf(start), { name: "Реле Р8", typeId }).project,
    "2026-09-17T11:00:00.000Z",
  );

  for (const [name, a, b] of [["нам ← им", ours, theirs], ["им ← нам", theirs, ours]]) {
    const merged = mergeProjects(a, b, start);
    const item = merged.project.equipment.find((entry) => entry.name === "Реле Р8");
    assert.ok(item, name + ": модель со стороны потерялась");
    assert.equal(item.typeId, typeId, name + ": модель осталась без типа");
    assert.ok(
      merged.project.equipmentTypes.some((type) => type.id === typeId && type.name === "Реле 8 каналов"),
      name + ": тип не вернулся",
    );
    const said = merged.conflicts.find((conflict) => conflict.code === "restoredRef");
    assert.ok(said, name + ": тип вернулся молча");
    assert.equal(said.entity, "equipmentTypes");
    assert.equal(said.label, "Реле 8 каналов", name + ": в отчёте не названо, что вернулось");
  }
});

// ——— ссылка важнее удаления ——————————————————————————————————————————
//
// Модель не даёт удалить то, чем пользуются: `typeHasMarks`, `categoryHasTypes`,
// `equipmentTypeInUse`, `equipmentInUse`. Через двух участников это правило
// обходилось — у меня меток на типе нет, я его удаляю; у вас в это же время
// появляются метки этого типа, — и слияние сносило вашу работу. Рядом
// `clearHistory()`: вернуть нечем.
test("тип метки возвращается, а его метки не идут под нож", () => {
  const { project: base, schemeId } = ancestor();
  // Тип, на котором меток нет ни у кого: удалить его модель разрешает.
  const spare = base.markTypes.find((type) => !base.marks.some((mark) => mark.typeId === type.id));

  const ours = stamp(deleteType(base, spare.id).project, "2026-09-17T10:00:00.000Z");
  let mine = copyOf(base);
  for (let i = 0; i < 5; i += 1) {
    mine = addMark(mine, { schemeId, typeId: spare.id, points: [{ x: 0.1 + i / 10, y: 0.8 }] }).project;
  }
  const theirs = stamp(mine, "2026-09-17T11:00:00.000Z");
  assert.equal(theirs.marks.length, base.marks.length + 5, "пример не тот");

  // Версия берётся у той стороны, которая тип не удаляла: только она могла его
  // переименовать или перекрасить, у удалившей ничего нет.
  for (const [name, a, b, side] of [["нам ← им", ours, theirs, "theirs"], ["им ← нам", theirs, ours, "ours"]]) {
    const merged = mergeProjects(a, b, base);
    assert.equal(merged.project.marks.length, base.marks.length + 5, name + ": метки снесены удалением типа");
    const back = merged.project.markTypes.find((type) => type.id === spare.id);
    assert.ok(back, name + ": тип не вернулся, метки остались без типа");
    assert.equal(back.name, spare.name, name + ": вернулась не та версия типа");
    const said = merged.conflicts.find((conflict) => conflict.code === "restoredRef" && conflict.entity === "markTypes");
    assert.ok(said, name + ": тип вернулся молча");
    assert.equal(said.kept, side, name + ": в отчёте названа не та сторона");
    assert.equal(said.label, spare.code, name + ": в отчёте не названо, что вернулось");
    // Порядок справочника — без дыр, как и после обычного слияния.
    assert.deepEqual(
      merged.project.markTypes.map((type) => type.order),
      merged.project.markTypes.map((type, index) => index),
    );
  }
});

test("вместе с типом возвращается и его категория", () => {
  const { project: base, schemeId } = ancestor();
  // Категория, на типах которой меток нет ни у кого: только такую модель и даёт
  // вычистить целиком.
  const used = new Set(base.marks.map((mark) => mark.typeId));
  const categoryId = base.categories
    .map((category) => category.id)
    .find((id) => base.markTypes.some((type) => type.categoryId === id) &&
      !base.markTypes.some((type) => type.categoryId === id && used.has(type.id)));
  const alone = base.markTypes.filter((type) => type.categoryId === categoryId);
  const spare = alone[0];

  // Мы вычистили целую категорию: сперва её типы, потом её саму.
  let clean = base;
  for (const type of alone) clean = deleteType(clean, type.id).project;
  const ours = stamp(deleteCategory(clean, categoryId).project, "2026-09-17T10:00:00.000Z");
  // Они в это время поставили метку одного из этих типов.
  const theirs = stamp(
    addMark(copyOf(base), { schemeId, typeId: spare.id, points: [{ x: 0.6, y: 0.9 }] }).project,
    "2026-09-17T11:00:00.000Z",
  );

  const merged = mergeProjects(ours, theirs, base);
  assert.equal(merged.project.marks.length, base.marks.length + 1, "метка со стороны снесена");
  const type = merged.project.markTypes.find((item) => item.id === spare.id);
  assert.ok(type, "тип не вернулся");
  assert.ok(
    merged.project.categories.some((category) => category.id === type.categoryId),
    "тип вернулся без категории — он не покажется ни в справочнике, ни в легенде",
  );
  const restored = merged.conflicts.filter((conflict) => conflict.code === "restoredRef").map((item) => item.entity);
  assert.ok(restored.includes("markTypes") && restored.includes("categories"), "о возврате сказано не про всё: " + restored.join(", "));
});

test("модель оборудования возвращается ради чужого размещения", () => {
  const { project: base } = ancestor();
  const gear = addEquipment(base, { name: "Щит 1", vendor: "ABB" });
  const start = gear.project;

  // Мы модель удалили (нигде не стояла), они её в это время поставили на метку.
  const ours = stamp(deleteEquipment(start, gear.equipment.id).project, "2026-09-17T10:00:00.000Z");
  const theirs = stamp(
    addPlacement(copyOf(start), { equipmentId: gear.equipment.id, markId: base.marks[0].id }).project,
    "2026-09-17T11:00:00.000Z",
  );

  const merged = mergeProjects(ours, theirs, start);
  assert.equal(merged.project.placements.length, 1, "размещение снесено удалением модели");
  assert.ok(merged.project.equipment.some((item) => item.id === gear.equipment.id), "модель не вернулась");
  assert.ok(
    merged.conflicts.some((conflict) => conflict.code === "restoredRef" && conflict.entity === "equipment"),
    "модель вернулась молча",
  );
});

test("вернуть неоткуда — ссылка снимается по-старому и об этом сказано", () => {
  const { project: base } = ancestor();
  const gear = addEquipment(base, { name: "Реле Р8" });
  // Тип, которого нет ни у кого: такого объекта модель не соберёт, а вот
  // правленный руками файл из общей папки — вполне.
  const broken = copyOf(gear.project);
  broken.equipment[0].typeId = "00000000-0000-4000-8000-000000000000";
  const ours = stamp(broken, "2026-09-17T10:00:00.000Z");
  const theirs = stamp(copyOf(broken), "2026-09-17T11:00:00.000Z");

  const merged = mergeProjects(ours, theirs, null);
  const item = merged.project.equipment.find((entry) => entry.name === "Реле Р8");
  assert.equal(item.typeId, "", "ссылка в никуда осталась висеть");
  const said = merged.conflicts.find((conflict) => conflict.code === "danglingType");
  assert.ok(said, "поле очистили молча");
  assert.equal(said.label, "Реле Р8");
});

// Схему и помещение модель удалять **разрешает** и сама говорит, что при этом
// уходит (`deleteScheme` — свои метки, блоки и контуры; `deleteRoom` — свои
// контуры). Слияние повторяет её правило, а не выдумывает своё: подложка лежит
// вне объекта, и воскрешать схему значило бы гадать. Потеря должна быть
// громкой — это и проверяется.
test("схема удалением не воскресает, но о снятых метках сказано", () => {
  const { project: base, schemeId } = ancestor();
  const typeId = base.markTypes[0].id;

  const ours = stamp(deleteScheme(base, schemeId).project, "2026-09-17T10:00:00.000Z");
  const theirs = stamp(
    addMark(copyOf(base), { schemeId, typeId, points: [{ x: 0.5, y: 0.5 }] }).project,
    "2026-09-17T11:00:00.000Z",
  );

  const merged = mergeProjects(ours, theirs, base);
  assert.equal(merged.project.schemes.length, 0, "схема вернулась — а её подложки в базе картинок уже может не быть");
  assert.equal(merged.project.marks.length, 0);
  // Метки общего предка ушли вместе со схемой ещё в слиянии коллекций (мы их
  // удалили, они не трогали), а вот новая метка со стороны обязана быть названа.
  const dropped = merged.conflicts.filter((conflict) => conflict.code === "danglingRef" && conflict.entity === "marks");
  assert.equal(dropped.length, 1, "о снятой метке со стороны не сказано");
  assert.equal(dropped[0].id, theirs.marks[theirs.marks.length - 1].id);
  // Нам удаление схемы не пересказывают — мы его сами и сделали. А вот второму
  // участнику оно приезжает строкой «удалено: 1 этаж», и там причина видна.
  const mirror = mergeProjects(theirs, ours, base);
  assert.ok(
    mirror.changes.some((change) => change.entity === "schemes" && change.action === "removed" && change.label === "1 этаж"),
    "второй стороне про удалённую схему не сказано",
  );
});

test("номер выше потолка слияние не выдаёт", () => {
  const { project: base, schemeId } = ancestor();
  const typeId = base.markTypes[0].id;

  // Обе стороны поставили по метке и вручную довели номер до потолка.
  const mine = addMark(base, { schemeId, typeId, points: [{ x: 0.5, y: 0.5 }] });
  const ours = stamp(setMarkNumber(mine.project, mine.mark.id, MARK_NUMBER_MAX).project, "2026-09-17T10:00:00.000Z");
  const alien = addMark(copyOf(base), { schemeId, typeId, points: [{ x: 0.9, y: 0.9 }] });
  const theirs = stamp(setMarkNumber(alien.project, alien.mark.id, MARK_NUMBER_MAX).project, "2026-09-17T11:00:00.000Z");

  const merged = mergeProjects(ours, theirs, base);
  const numbers = merged.project.marks.map((mark) => mark.number);
  assert.ok(Math.max(...numbers) <= MARK_NUMBER_MAX, "слияние выдало номер, которого руками не поставить: " + Math.max(...numbers));
  assert.deepEqual(merged.renumbered, [], "разводить было некуда, а функция сделала вид, что развела");
  // Повтор никуда не делся — о нём скажет панель предупреждений, как о любом другом.
  assert.ok(validate(merged.project).some((item) => item.code === "repeatedNumber"));
});

test("правка модели не воскрешает пустой справочник у объекта прежнего формата", () => {
  const { project: base } = ancestor();
  const bare = copyOf(base);
  delete bare.equipmentTypes;
  delete bare.equipment;
  delete bare.placements;
  delete bare.outlines;
  const twin = copyOf(bare);

  const merged = mergeProjects(stamp(bare, "2026-02-03T10:00:00.000Z"), stamp(twin, "2026-02-03T10:00:00.000Z"), bare);
  assert.equal(merged.changed, false, "слияние двух одинаковых старых файлов объявило объект изменённым");
  for (const key of ["equipmentTypes", "equipment", "placements", "outlines"]) {
    assert.equal(merged.project[key], undefined, "поле «" + key + "» завелось само");
  }
});

test("модель, правленная с двух сторон, не теряет тип", () => {
  const { project: base } = ancestor();
  const seeded = addEquipmentType(base, { name: "Диммер DIN" });
  const withGear = addEquipment(seeded.project, { name: "Диммер Д1", typeId: seeded.equipmentType.id });
  const start = stamp(withGear.project, "2026-09-17T09:00:00.000Z");
  const gearId = withGear.equipment.id;

  const ours = stamp(updateEquipment(start, gearId, { vendor: "ABB" }).project, "2026-09-17T10:00:00.000Z");
  const theirs = stamp(updateEquipment(copyOf(start), gearId, { code: "D-1" }).project, "2026-09-17T10:05:00.000Z");

  const merged = mergeProjects(ours, theirs, start).project;
  const item = merged.equipment.find((entry) => entry.id === gearId);
  assert.equal(item.typeId, seeded.equipmentType.id, "тип модели потерялся в споре");
  assert.ok(merged.equipmentTypes.some((type) => type.id === item.typeId));
});
