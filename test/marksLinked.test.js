// Связка метки словами: вся связная группа, а не только прямые связи.
//
// Слова заказчика: «например когда 2 выключателя управляют одним светом, при
// этом напрямую выключатели не связаны. Но вот эта связь же известна и надо
// именно это указывать». На плане она уже рисуется — при выделении метки
// поднимается вся её связная группа (таск 84), — а словами её не было нигде.
//
// Проверяется здесь три решения, и разойтись они могут молча:
//
// 1. Перечень берётся у модели (`linkedMarkIds`) и ничего не считает заново:
//    разойдись он с планом — метка была бы подсвечена, но не названа.
// 2. Прямые связи из перечня вычитаются — по метке, а не по имени: иначе одна
//    метка стояла бы в строке дважды, а тёзки по номеру пропали бы вовсе.
// 3. Большая группа сворачивается числом: у реле на пять групп замыкание
//    поднимает три десятка меток, и строка списка живёт в колонке 264 точки.
import test from "node:test";
import assert from "node:assert/strict";
import {
  addMark,
  addScheme,
  createProject,
  linkedMarkIds,
  markControlIds,
  markControlledBy,
  setMarkControls,
  setMarkNumber,
} from "../src/model.js";
import {
  MARKS_LINKED_SHOWN,
  marksLinkedList,
  marksLinkedText,
  marksLinkedTitle,
  marksRowModel,
} from "../src/panels/marks.js";
import { filtersMarkRows } from "../src/panels/filters.js";
import { strings, text } from "../src/strings.js";

function plan() {
  let project = createProject({ name: "Квартира" });
  const scheme = addScheme(project, { name: "1 этаж", width: 1000, height: 800 });
  project = scheme.project;
  const typeOf = (code) => project.markTypes.find((type) => type.code === code).id;
  let at = 0;
  const put = (code) => {
    at += 0.02;
    const result = addMark(project, {
      schemeId: scheme.scheme.id,
      typeId: typeOf(code),
      kind: "point",
      points: [{ x: at, y: 0.5 }],
    });
    project = result.project;
    return result.mark.id;
  };
  return {
    get project() {
      return project;
    },
    set project(value) {
      project = value;
    },
    schemeId: scheme.scheme.id,
    put,
  };
}

// Сколько меток названо прямыми связями — вместе с самой меткой. Ровно это
// перечень связки и вычитает.
function directCount(project, markId) {
  const named = new Set([markId]);
  for (const id of markControlIds(project.marks.find((mark) => mark.id === markId))) named.add(id);
  for (const mark of markControlledBy(project, markId)) named.add(mark.id);
  return named.size;
}

test("два выключателя одного светильника названы друг у друга", () => {
  const box = plan();
  const lamp = box.put("Т");
  const first = box.put("В");
  const second = box.put("П");
  box.project = setMarkControls(box.project, first, [lamp]).project;
  box.project = setMarkControls(box.project, second, [lamp]).project;

  // Напрямую выключатели не связаны — связь идёт через светильник.
  assert.equal(markControlIds(box.project.marks.find((mark) => mark.id === first)).includes(second), false);
  const view = marksLinkedList(box.project, first);
  assert.deepEqual(view.entries, ["П1"]);
  assert.equal(view.total, 1);
  assert.equal(view.more, 0);
  // Светильник в перечень не попадает: он уже назван в «Чем управляет».
  assert.equal(view.entries.includes("Т1"), false);
  // И наоборот: у второго выключателя назван первый.
  assert.deepEqual(marksLinkedList(box.project, second).entries, ["В1"]);
});

test("у светильника в связке не остаётся никого: оба выключателя уже названы", () => {
  const box = plan();
  const lamp = box.put("Т");
  const first = box.put("В");
  const second = box.put("П");
  box.project = setMarkControls(box.project, first, [lamp]).project;
  box.project = setMarkControls(box.project, second, [lamp]).project;
  const view = marksLinkedList(box.project, lamp);
  // Вся связка у светильника — это он сам и два его выключателя, и оба стоят
  // в «Чем управляется». Повторять их третий раз незачем.
  assert.deepEqual(view.entries, []);
  assert.equal(view.total, 0);
  assert.equal(marksLinkedText(view), "");
  assert.equal(linkedMarkIds(box.project, lamp).length, 3);
});

test("тёзки по номеру видны, даже когда выключатель управляет одним из них", () => {
  const box = plan();
  const one = box.put("Т");
  const two = box.put("Т");
  const three = box.put("Т");
  const switchMark = box.put("В");
  box.project = setMarkNumber(box.project, two, 1).project;
  box.project = setMarkNumber(box.project, three, 1).project;
  box.project = setMarkControls(box.project, switchMark, [one]).project;

  // Вычитание по метке, а не по имени: прямой Т1 из перечня ушёл, а два его
  // тёзки остались — и свёрнуты числом, как в перечне связей.
  const view = marksLinkedList(box.project, switchMark);
  assert.deepEqual(view.entries, ["Т1 ×2"]);
  assert.equal(view.total, 2);
  // У самих тёзок связка — остальные метки того же номера и выключатель.
  assert.deepEqual(marksLinkedList(box.project, two).entries, ["Т1 ×2", "В1"]);
});

test("перечень — это замыкание модели минус прямые связи, и ничего больше", () => {
  const box = plan();
  const lamp = box.put("Т");
  const first = box.put("В");
  const second = box.put("П");
  box.project = setMarkControls(box.project, first, [lamp]).project;
  box.project = setMarkControls(box.project, second, [lamp]).project;
  for (const markId of [lamp, first, second]) {
    const view = marksLinkedList(box.project, markId);
    assert.equal(
      view.total,
      linkedMarkIds(box.project, markId).length - directCount(box.project, markId),
      "перечень считается не из linkedMarkIds",
    );
  }
});

test("большая связка сворачивается числом, а целиком остаётся в подсказке", () => {
  const box = plan();
  const panel = box.put("Щ");
  const lamps = [];
  for (let index = 0; index < 10; index += 1) lamps.push(box.put("Т"));
  const switchMark = box.put("В");
  // Щит держит десять светильников, выключатель — один из них: связка
  // выключателя поднимает весь щит целиком.
  box.project = setMarkControls(box.project, panel, lamps).project;
  box.project = setMarkControls(box.project, switchMark, [lamps[0]]).project;

  const view = marksLinkedList(box.project, switchMark);
  assert.equal(view.total, 10, "щит и девять светильников, кроме прямого");
  assert.equal(view.entries.length, MARKS_LINKED_SHOWN);
  assert.equal(view.all.length, 10);
  assert.equal(view.more, 10 - MARKS_LINKED_SHOWN);
  const line = marksLinkedText(view);
  assert.ok(line.endsWith(text("marks.linkedMore", { count: view.more })), line);
  // Свернуть в строке и потерять насовсем — разные вещи: весь перечень уходит
  // в подсказку при наведении.
  const title = marksLinkedTitle(view);
  assert.ok(title.includes(strings.marks.linkedTitle));
  for (const label of view.all) assert.ok(title.includes(label), label);
  // Нетронутый перечень подсказку списком не засоряет.
  assert.equal(marksLinkedTitle(marksLinkedList(box.project, panel, 100)), strings.marks.linkedTitle);
});

test("метка себя в связку не берёт, и одиночке показывать нечего", () => {
  const box = plan();
  const lonely = box.put("Т");
  const view = marksLinkedList(box.project, lonely);
  assert.deepEqual(view.entries, []);
  assert.equal(view.total, 0);
  assert.equal(marksLinkedText(view), "");
  // Нет объекта, нет метки — нет и перечня: падать тут нельзя.
  assert.deepEqual(marksLinkedList(null, lonely).entries, []);
  assert.deepEqual(marksLinkedList(box.project, "нет такой").entries, []);
  assert.equal(marksLinkedText(null), "");
  assert.equal(marksLinkedTitle(null), strings.marks.linkedTitle);
});

test("связка едет в строку списка только у раскрытой метки", () => {
  const box = plan();
  const lamp = box.put("Т");
  const first = box.put("В");
  const second = box.put("П");
  box.project = setMarkControls(box.project, first, [lamp]).project;
  box.project = setMarkControls(box.project, second, [lamp]).project;
  const row = filtersMarkRows(box.project, box.schemeId, null).find((item) => item.mark.id === first);
  const open = marksRowModel(box.project, row, { open: true });
  assert.deepEqual(open.fields.linked.entries, ["П1"]);
  // Свёрнутая строка полей не поднимает вовсе — замыкание считается по всему
  // объекту, а раскрыта в списке всегда одна метка.
  assert.equal(marksRowModel(box.project, row, { open: false }).fields, null);
});
