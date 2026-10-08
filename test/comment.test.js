// Метка-комментарий: плашка с текстом вместо знака, указатель свойством
// метки — и главное, что о ней надо проверять: её нет ни в одном списке.
//
// Требование G167 заказчик сформулировал одной фразой — «В список меток в
// таблицу и т.д. эти комментарии не должны попадать», — но мест, где её надо
// отрезать, оказалось восемь. Поэтому здесь не один тест «нигде не видно», а
// по тесту на место: пропусти одно, и числа разойдутся с тем, что на экране,
// а в закупку уедет позиция, которой нет.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MARK_KIND_COMMENT,
  addMark,
  addPlacement,
  addEquipment,
  addRoom,
  addScheme,
  addToGroup,
  changeMarkType,
  compactAllNumbers,
  createProject,
  deleteMark,
  findMark,
  labelOf,
  listedMarks,
  markCommentText,
  markIsComment,
  markPointer,
  markSnapshot,
  pasteMark,
  repeatedNumbers,
  searchProject,
  setMarkControls,
  setMarkNumber,
  setMarkPointer,
  typeIsComment,
  typeKindOf,
  updateMark,
  validate,
} from "../src/model.js";
import { marksTable, typesTable, toCsv } from "../src/tables.js";
import { filtersMarkRows } from "../src/panels/filters.js";
import { marksSchemeTotal } from "../src/panels/marks.js";
import { roomsUsage } from "../src/panels/rooms.js";
import {
  commentPlateLines,
  drawLegend,
  hitTest,
  labelBox,
  labelLeaderShown,
  planToScreen,
} from "../src/render.js";
import { markCardModel } from "../src/panels/markCard.js";
import { strings } from "../src/strings.js";

// Комната с двумя обычными метками и одним комментарием: этого достаточно,
// чтобы любое «не попадает» было видно числом, а не на глаз.
function fixture() {
  let project = createProject({ name: "Квартира" });
  const scheme = addScheme(project, { name: "1 этаж", width: 1000, height: 500 });
  project = scheme.project;
  const schemeId = scheme.scheme.id;
  const typeOf = (code) => project.markTypes.find((type) => type.code === code).id;
  const put = (code, x, patch) => {
    const added = addMark(project, {
      schemeId,
      typeId: typeOf(code),
      kind: typeKindOf(project, typeOf(code)),
      points: [{ x, y: 0.5 }],
    });
    project = patch ? updateMark(added.project, added.mark.id, patch).project : added.project;
    return added.mark.id;
  };
  const socket = put("Р", 0.2);
  const spot = put("Т", 0.4);
  const note = put("Коммент", 0.6, { original: "Щит в коридоре" });
  return {
    get project() {
      return project;
    },
    set project(value) {
      project = value;
    },
    schemeId,
    typeOf,
    put,
    socket,
    spot,
    note,
  };
}

const viewOf = (patch = {}) => ({ zoom: 1, offsetX: 0, offsetY: 0, markSize: 10, labelSize: 12, ...patch });

// ——— вид, указатель, текст ——————————————————————————————————————————

test("комментарий — третий вид метки: плашка, номер и код «Коммент»", () => {
  const box = fixture();
  const note = findMark(box.project, box.note);
  assert.equal(note.kind, MARK_KIND_COMMENT);
  assert.equal(markIsComment(note), true);
  assert.equal(typeIsComment(box.project, note.typeId), true);
  // Номер сквозной, как у всех: заказчик просил и код, и номер.
  assert.equal(labelOf(box.project, box.note), "Коммент1");
  const second = box.put("Коммент", 0.7);
  assert.equal(labelOf(box.project, second), "Коммент2");
  // Своя нумерация с чужой не пересекается: счётчик ведётся на код типа.
  assert.equal(labelOf(box.project, box.socket), "Р1");
  assert.equal(markCommentText(findMark(box.project, box.note)), "Щит в коридоре");
});

test("указатель — свойство метки: по умолчанию его нет, команда его переключает", () => {
  const box = fixture();
  assert.equal(markPointer(findMark(box.project, box.note)), false);
  const on = setMarkPointer(box.project, box.note, true);
  assert.equal(markPointer(on.mark), true);
  const off = setMarkPointer(on.project, box.note, false);
  assert.equal(markPointer(off.mark), false);
  // Указателя не бывает у знака: поле у розетки ничего не значило бы, и
  // записать его нельзя ни командой, ни правкой метки.
  assert.throws(() => setMarkPointer(box.project, box.socket, true), /указател/i);
  assert.throws(() => updateMark(box.project, box.socket, { pointer: true }), /указател/i);
});

test("у комментария одна точка, блока и связей у него нет", () => {
  const box = fixture();
  assert.throws(
    () =>
      addMark(box.project, {
        schemeId: box.schemeId,
        typeId: box.typeOf("Коммент"),
        kind: MARK_KIND_COMMENT,
        points: [{ x: 0.1, y: 0.1 }, { x: 0.2, y: 0.2 }],
      }),
    /одна точка/i,
  );
  assert.throws(() => addToGroup(box.project, box.note, "right"), /точек|точки/i);
  assert.throws(() => setMarkControls(box.project, box.note, [box.spot]), /Комментарий/);
  const equipment = addEquipment(box.project, { name: "Реле", vendor: "Вендор" });
  assert.throws(
    () => addPlacement(equipment.project, { equipmentId: equipment.equipment.id, markId: box.note }),
    /комментарий/i,
  );
});

test("плашку меняют только на плашку, а знак — только на знак", () => {
  const box = fixture();
  assert.throws(() => changeMarkType(box.project, box.note, box.typeOf("Р")), /комментарий/i);
  assert.throws(() => changeMarkType(box.project, box.socket, box.typeOf("Коммент")), /точечны|комментарий/i);
});

test("копия комментария остаётся комментарием и несёт свой текст", () => {
  const box = fixture();
  const snapshot = markSnapshot(box.project, box.note);
  const pasted = pasteMark(box.project, snapshot, { schemeId: box.schemeId, point: { x: 0.8, y: 0.8 } });
  const copy = findMark(pasted.project, pasted.mark.id);
  assert.equal(copy.kind, MARK_KIND_COMMENT);
  assert.equal(markCommentText(copy), "Щит в коридоре");
  assert.equal(labelOf(pasted.project, copy.id), "Коммент2");
});

// ——— G167: по тесту на каждое место ————————————————————————————————

test("G167: комментария нет в списке меток", () => {
  const box = fixture();
  const rows = filtersMarkRows(box.project, box.schemeId, null);
  assert.deepEqual(rows.map((row) => row.label), ["Т1", "Р1"]);
  assert.equal(rows.some((row) => markIsComment(row.mark)), false);
  // `listedMarks` — то самое единственное место, где комментарий отрезается.
  assert.equal(listedMarks(box.project.marks).length, 2);
});

test("G167: комментария нет в счётчике «Показано N из M»", () => {
  const box = fixture();
  // Три метки на схеме, но «из M» обещает две: иначе в пустом фильтре число
  // разошлось бы с числом строк в списке.
  assert.equal(box.project.marks.length, 3);
  assert.equal(marksSchemeTotal(box.project, box.schemeId), 2);
  assert.equal(filtersMarkRows(box.project, box.schemeId, null).length, 2);
});

test("G167: комментария нет в листе меток и в его выгрузке", () => {
  const box = fixture();
  const table = marksTable(box.project, null, "category");
  const labels = table.groups.flatMap((group) => group.rows.map((row) => row.cells[0]));
  assert.deepEqual(labels, ["Т1", "Р1"]);
  assert.equal(table.groups.some((group) => group.title.includes("Комментарии")), false);
  const csv = toCsv(table);
  // «Коммент1» — обозначение плашки; имя колонки «Комментарий» тут ни при чём.
  assert.equal(csv.includes("Коммент1"), false, "комментарий уехал в CSV");
  assert.equal(csv.includes("Щит в коридоре"), false, "текст плашки уехал в CSV");
});

test("G167: комментария нет в подвале «Итого» и в подсчётах по категориям", () => {
  const box = fixture();
  const table = marksTable(box.project, null, "category");
  assert.equal(table.totalCount, 2);
  assert.deepEqual(
    table.totals.filter((row) => row.level === 1).map((row) => row.title),
    ["Свет", "Розетки"],
  );
  assert.equal(table.totals.some((row) => String(row.title).includes("Коммент")), false);
});

test("G167: комментария нет в справочнике листа и в легенде плана", () => {
  const box = fixture();
  const types = typesTable(box.project);
  assert.equal(types.groups.some((group) => group.title.includes("Комментарии")), false);
  assert.equal(
    types.groups.flatMap((group) => group.rows).some((row) => row.cells[0] === "Коммент"),
    false,
  );

  // Легенда объясняет знаки, а у плашки знака нет — её читают саму.
  const probe = {
    texts: [],
    measureText: (value) => ({ width: String(value).length * 7 }),
  };
  const sink = new Proxy(probe, {
    get: (obj, key) => {
      if (key === "fillText") return (value) => obj.texts.push(value);
      return key in obj ? obj[key] : () => {};
    },
    set: (obj, key, value) => ((obj[key] = value), true),
  });
  drawLegend(sink, { project: box.project, scheme: box.project.schemes[0], filter: null, view: viewOf() });
  assert.deepEqual(probe.texts, ["Т — Точечный светильник", "Р — Розетка"]);
});

test("G167: комментарий не считается в метках помещения", () => {
  const box = fixture();
  const room = addRoom(box.project, "Коридор");
  box.project = room.project;
  const id = room.room.id;
  box.project = updateMark(box.project, box.socket, { roomId: id }).project;
  box.project = updateMark(box.project, box.note, { roomId: id }).project;
  // Помещение комментарию проставить можно — его ставит автоматика по контуру,
  // и фильтр по комнате обязан оставить замечания об этой комнате на плане.
  // А вот число у комнаты читают как «сколько тут позиций».
  assert.equal(roomsUsage(box.project, id), 1);
});

test("G167: «сомкнуть номера у всех» и проверка дублей идут по обычным типам", () => {
  const box = fixture();
  const second = box.put("Коммент", 0.7);
  box.project = deleteMark(box.project, box.note).project;
  // Дыра в нумерации комментариев осталась дырой: «сомкнуть у всех» её не
  // трогает — номер плашки нигде не виден, и сверять список замен не с чем.
  const all = compactAllNumbers(box.project);
  assert.equal(all.groups.some((group) => group.code === "Коммент"), false);
  assert.equal(labelOf(all.project, second), "Коммент2");

  // Повтор номера у комментариев не предупреждение: номера их не видно.
  const third = box.put("Коммент", 0.8);
  box.project = setMarkNumber(box.project, third, 2).project;
  assert.equal(repeatedNumbers(box.project).some((item) => item.code === "Коммент"), false);
  assert.equal(validate(box.project).some((problem) => problem.code === "repeatedNumber"), false);
});

// ——— что о комментарии всё-таки говорят ————————————————————————————

// Поиск по объекту — исключение из G167, и сознательное. Список меток,
// листы и подсчёты — это перечень позиций, и плашке там не место. Поиск —
// не перечень, а способ дойти до метки: он ищет по всему объекту и ведёт к
// найденному. Выбрось из него комментарии, и до плашки, которую человек
// написал и забыл где, он бы не добрался вовсе — в списке её нет.
test("поиск находит комментарий по тексту плашки", () => {
  const box = fixture();
  const rows = searchProject(box.project, "коридор");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].markId, box.note);
  assert.equal(rows[0].field, "original");
  assert.equal(rows[0].value, "Щит в коридоре");
});

test("пустая плашка — находка панели предупреждений, а не молчание", () => {
  const box = fixture();
  const empty = box.put("Коммент", 0.9);
  const found = validate(box.project).filter((problem) => problem.code === "commentEmpty");
  assert.equal(found.length, 1);
  assert.equal(found[0].ref, empty);
  assert.equal(found[0].kind, "warning");
  assert.ok(found[0].message.includes("Коммент"), "в предупреждении не названа метка");

  // Текст дописали — находка ушла.
  box.project = updateMark(box.project, empty, { original: "Проверить фазировку" }).project;
  assert.equal(validate(box.project).some((problem) => problem.code === "commentEmpty"), false);
});

test("карточка метки — единственная дверь к тексту плашки", () => {
  const box = fixture();
  const card = markCardModel(box.project, box.note);
  assert.equal(card.comment, true);
  assert.equal(card.pointer, false);
  assert.equal(card.kind, MARK_KIND_COMMENT);
  assert.deepEqual(
    card.rows.map((row) => [row.label, row.value]),
    [[strings.marks.comment, "Щит в коридоре"]],
  );
  box.project = setMarkPointer(box.project, box.note, true).project;
  assert.equal(markCardModel(box.project, box.note).pointer, true);

  // У обычной метки карточка прежняя: признака комментария в ней нет.
  const plain = markCardModel(box.project, box.socket);
  assert.equal(plain.comment, false);
  assert.equal(plain.kind, "point");
});

// ——— плашка на плане ——————————————————————————————————————————————

test("плашка переносит текст по словам и обрезается многоточием", () => {
  assert.deepEqual(commentPlateLines("Щит в коридоре"), ["Щит в коридоре"]);
  assert.deepEqual(commentPlateLines(""), [""]);
  const wrapped = commentPlateLines("Щит в коридоре, автомат С16 на группу света спальни");
  assert.ok(wrapped.length > 1, "длинная строка не перенеслась");
  for (const line of wrapped) assert.ok(line.length <= 26, "строка плашки шире потолка: " + line);
  const many = commentPlateLines("раз два три четыре пять шесть семь восемь девять десять", 10, 2);
  assert.equal(many.length, 2);
  assert.ok(many[1].endsWith("…"), "обрезка без многоточия: " + many[1]);
  // Слово длиннее строки рубится, а не распирает плашку на полплана.
  for (const line of commentPlateLines("ЩСвводнойкабельбезпробеловиещёкусок")) {
    assert.ok(line.length <= 26, "слово не порубилось: " + line);
  }
});

test("без указателя плашка стоит на своей точке, с указателем — отдельно и с линией", () => {
  const box = fixture();
  const scheme = box.project.schemes[0];
  const view = viewOf();
  const note = () => findMark(box.project, box.note);
  const anchor = planToScreen(note().points[0], scheme, view);

  const pinned = labelBox(box.project, scheme, note(), view, null);
  assert.ok(pinned.plate, "плашка не посчиталась");
  assert.deepEqual(pinned.plate.lines, ["Щит в коридоре"]);
  // Середина плашки — ровно точка метки.
  assert.ok(Math.abs(pinned.x + pinned.width / 2 - anchor.x) < 0.001, "плашка не на точке: " + pinned.x);
  assert.equal(pinned.dy, 0);
  assert.equal(labelLeaderShown(box.project, note(), pinned), false);

  box.project = setMarkPointer(box.project, box.note, true).project;
  const aside = labelBox(box.project, scheme, note(), view, null);
  assert.ok(Math.abs(aside.x + aside.width / 2 - anchor.x) > 1, "плашка с указателем осталась на точке");
  assert.equal(labelLeaderShown(box.project, note(), aside), true);

  // Оттащенная рукой плашка слушается своего смещения, а выключенный указатель
  // его не стирает: включат обратно — плашка вернётся туда же.
  box.project = updateMark(box.project, box.note, { labelOffset: { dx: 120, dy: -60 } }).project;
  const moved = labelBox(box.project, scheme, note(), view, null);
  assert.ok(Math.abs(moved.x - (anchor.x + 120)) < 0.001, "смещение плашки не применилось");
  box.project = setMarkPointer(box.project, box.note, false).project;
  const back = labelBox(box.project, scheme, note(), view, null);
  assert.ok(Math.abs(back.x + back.width / 2 - anchor.x) < 0.001, "плашка без указателя ушла со своей точки");
  assert.deepEqual(findMark(box.project, box.note).labelOffset, { dx: 120, dy: -60 });
});

test("пустая плашка видна и ловится: в ней стоит название поля", () => {
  const box = fixture();
  const empty = box.put("Коммент", 0.9);
  const scheme = box.project.schemes[0];
  const view = viewOf();
  const target = findMark(box.project, empty);
  const boxOf = labelBox(box.project, scheme, target, view, null);
  assert.equal(boxOf.text, strings.marks.comment);
  const at = planToScreen(target.points[0], scheme, view);
  const hit = hitTest(box.project, scheme, at, view, null);
  assert.equal(hit.markId, empty);
});

test("клик по плашке без указателя двигает всю метку, с указателем — только плашку", () => {
  const box = fixture();
  const scheme = box.project.schemes[0];
  const view = viewOf();
  const plate = () => labelBox(box.project, scheme, findMark(box.project, box.note), view, null);
  const inside = (boxOf) => ({ x: boxOf.x + boxOf.width / 2, y: boxOf.y });

  const pinnedHit = hitTest(box.project, scheme, inside(plate()), view, null);
  assert.equal(pinnedHit.markId, box.note);
  assert.equal(pinnedHit.part, "mark", "плашку без указателя тащили бы как подпись — а точка пришита к ней");

  box.project = setMarkPointer(box.project, box.note, true).project;
  box.project = updateMark(box.project, box.note, { labelOffset: { dx: 150, dy: -80 } }).project;
  const asideHit = hitTest(box.project, scheme, inside(plate()), view, null);
  assert.equal(asideHit.markId, box.note);
  assert.equal(asideHit.part, "label", "плашка с указателем перестала быть подписью");
});

// ——— G68: прежние объекты открываются как были ——————————————————————

test("G68: объект прежней разметки открывается без изменений", () => {
  // Объект, размеченный до этого таска: ни одной метки-комментария, ни одного
  // поля `pointer`, справочник без категории «Комментарии».
  let project = createProject({ name: "Старый объект" });
  project = {
    ...project,
    categories: project.categories.filter((category) => category.name !== "Комментарии"),
    markTypes: project.markTypes.filter((type) => type.code !== "Коммент"),
  };
  const scheme = addScheme(project, { name: "1 этаж", width: 1000, height: 500 });
  project = scheme.project;
  const typeOf = (code) => project.markTypes.find((type) => type.code === code).id;
  const first = addMark(project, {
    schemeId: scheme.scheme.id,
    typeId: typeOf("Р"),
    kind: "point",
    points: [{ x: 0.2, y: 0.5 }],
  });
  project = updateMark(first.project, first.mark.id, { location: "у кресла", original: "Р-12" }).project;
  const second = addMark(project, {
    schemeId: scheme.scheme.id,
    typeId: typeOf("Л"),
    kind: "line",
    points: [{ x: 0.1, y: 0.1 }, { x: 0.5, y: 0.1 }],
  });
  project = second.project;

  const before = {
    labels: project.marks.map((mark) => labelOf(project, mark.id)),
    numbers: project.marks.map((mark) => mark.number),
    kinds: project.marks.map((mark) => mark.kind),
    marks: JSON.stringify(project.marks),
  };

  // Ни одна проверка не нашла комментария там, где его нет.
  const problems = validate(project);
  assert.equal(problems.some((problem) => problem.code === "commentEmpty"), false);
  assert.equal(problems.some((problem) => problem.code === "typeKindMixed"), false);

  // Списки, листы и счётчики видят ровно то, что видели прежде.
  assert.equal(marksSchemeTotal(project, scheme.scheme.id), 2);
  assert.equal(filtersMarkRows(project, scheme.scheme.id, null).length, 2);
  const table = marksTable(project, null, "category");
  assert.equal(table.totalCount, 2);
  assert.deepEqual(
    table.groups.flatMap((group) => group.rows.map((row) => row.cells[0])),
    before.labels.slice().reverse(),
  );
  // Поле «Комментарий» читается из прежнего ключа данных (таск 117).
  assert.equal(
    table.groups.flatMap((group) => group.rows).find((row) => row.cells[0] === "Р1").cells.at(-1),
    "Р-12",
  );

  // Ни метка, ни номер, ни подпись не изменились — объект тот же, что закрыли.
  assert.equal(JSON.stringify(project.marks), before.marks);
  assert.deepEqual(project.marks.map((mark) => labelOf(project, mark.id)), before.labels);
  assert.deepEqual(project.marks.map((mark) => mark.number), before.numbers);
  assert.deepEqual(project.marks.map((mark) => mark.kind), before.kinds);
  // Поля `pointer` в прежних метках не появилось: `markPointer` читает его
  // отсутствие как «указателя нет», и дописывать его незачем.
  for (const mark of project.marks) {
    assert.equal(Object.prototype.hasOwnProperty.call(mark, "pointer"), false);
    assert.equal(markPointer(mark), false);
    assert.equal(markIsComment(mark), false);
  }
});
