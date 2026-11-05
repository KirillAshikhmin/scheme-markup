// Порядок меток на экране (таск 238, требование G359).
//
// Слова заказчика: «Порядок меток на экране (на передний план, на задний план,
// ниже, выше)». До этого таска порядок был порядком массива `project.marks`, и
// управлять им человек не мог ничем.
//
// Здесь проверяется три вещи, и третья — главная:
//
// 1. четыре команды делают то, что обещают их имена;
// 2. **рисование и попадание по клику — одно правило**: клик достаётся той
//    метке, которую видно сверху. Поэтому рядом с каждым переносом стоит
//    `hitTest`, как в тесте стопки;
// 3. **место в массиве осталось порядком постановки**. Его читают трое, и у
//    каждого от этого зависят не пиксели, а данные: смыкание номеров, перечень
//    «чем управляет» и выбор ведущей метки устройства. Ради них порядок и
//    хранится своим полем `mark.z`, а не перестановкой массива, — и тесты ниже
//    упадут, если кто-нибудь однажды «упростит» это обратно.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  MARK_ORDER_BACK,
  MARK_ORDER_DOWN,
  MARK_ORDER_FRONT,
  MARK_ORDER_MOVES,
  MARK_ORDER_UP,
  addMark,
  addRoom,
  addScheme,
  addToGroup,
  compactNumbers,
  createProject,
  findMark,
  labelOf,
  markControls,
  markDeviceLeader,
  markOrderCan,
  markZ,
  marksInDrawOrder,
  moveMarkOrder,
  setMarkControls,
  setMarkNumber,
  updateMark,
} from "../src/model.js";
import { strings } from "../src/strings.js";
import { packProject, unpackProject } from "../src/projectFile.js";
import { drawScheme, hitTest, markStackPoints, markStacks, visibleMarks } from "../src/render.js";

const WIDTH = 1200;
const HEIGHT = 800;
const MARK_SIZE = 10;
const viewOf = (patch) => ({ zoom: 1, offsetX: 0, offsetY: 0, markSize: MARK_SIZE, labelSize: 12, ...patch });
const typeId = (project, code) => project.markTypes.find((type) => type.code === code).id;

// Знаки наезжают друг на друга, но стоят не в одной точке: 15 пикселей плана
// между центрами при радиусе знака 10 — порог стопки (`MARK_STACK_REACH_RATIO`)
// пройден, и разводить их отрисовка не станет. Это и есть случай заказчика:
// «блок розеток под выключателем», метка на метке в тесном углу.
const STEP_PX = 15;
const SPOT = { x: 0.5, y: 0.5 };
const centerX = (index) => SPOT.x * WIDTH + index * STEP_PX;

// `gap: 0` — метки ровно в одной точке: там за дело берётся стопка (G181), и
// порядок решает уже не «кто виден», а «кто остался на настоящей точке».
function near(count, { code = "Р", gap = STEP_PX } = {}) {
  let project = createProject({ name: "Порядок" });
  const added = addScheme(project, { name: "1 этаж", width: WIDTH, height: HEIGHT });
  project = added.project;
  const ids = [];
  for (let index = 0; index < count; index += 1) {
    const mark = addMark(project, {
      schemeId: added.scheme.id,
      typeId: typeId(project, code),
      kind: "point",
      points: [{ x: SPOT.x + (index * gap) / WIDTH, y: SPOT.y }],
    });
    project = mark.project;
    ids.push(mark.mark.id);
  }
  return { project, scheme: project.schemes[0], ids };
}

// Клик в накладке соседних знаков: ровно посередине между их центрами.
const between = (first, second) => ({ x: (centerX(first) + centerX(second)) / 2, y: SPOT.y * HEIGHT });
// Запись холста: что нарисовано и каким текстом. Тот же приём, что у стопки и
// развёртки (`test/markStack.test.js`) — DOM и canvas тестами не покрываются,
// проверяется вызов.
function recorder() {
  const log = [];
  const ctx = new Proxy(
    { measureText: (value) => ({ width: String(value).length * 6 }) },
    {
      get: (target, key) => (key in target ? target[key] : (...args) => log.push(String(key) + ":" + args.join(","))),
      set: (target, key, value) => ((target[key] = value), log.push(String(key) + "=" + String(value)), true),
    },
  );
  return { ctx, log };
}

// Обозначения в том порядке, в каком их нарисовал кадр.
function frame(project, scheme) {
  const { ctx, log } = recorder();
  drawScheme(ctx, { project, scheme, filter: null, view: viewOf(), selectedIds: [] });
  return log.filter((line) => line.startsWith("fillText:")).map((line) => line.slice(9).split(",")[0]);
}

const clicked = (project, scheme, at) => {
  const hit = hitTest(project, scheme, at, viewOf(), null);
  return hit ? hit.markId : null;
};

// Порядок рисования схемы обозначениями: «Р1, Р2, Р3» — снизу вверх.
const shown = (project, scheme, filter = null) =>
  visibleMarks(project, scheme, filter).map((mark) => labelOf(project, mark.id));

const move = (project, ids, kind, options) => moveMarkOrder(project, ids, kind, options).project;

// ——— порядок по умолчанию: как было до таска ——————————————————————————

test("без яруса порядок рисования — порядок массива, и ни одного поля в метках", () => {
  const built = near(3);
  assert.deepEqual(shown(built.project, built.scheme), ["Р1", "Р2", "Р3"]);
  assert.deepEqual(
    marksInDrawOrder(built.project.marks).map((mark) => mark.id),
    built.ids,
    "порядок массива не сохранился: сортировка перестала быть устойчивой",
  );
  for (const id of built.ids) {
    assert.ok(!("z" in findMark(built.project, id)), "поле яруса появилось само");
    assert.equal(markZ(findMark(built.project, id)), 0, "ярус по умолчанию не нуль");
  }
});

test("клик достаётся верхней метке — той, что нарисована последней", () => {
  const built = near(3);
  // В накладке первой и второй побеждает вторая, во второй накладке — третья:
  // `hitTest` обходит метки сверху вниз, а сверху — последняя по порядку.
  assert.equal(clicked(built.project, built.scheme, between(0, 1)), built.ids[1]);
  assert.equal(clicked(built.project, built.scheme, between(1, 2)), built.ids[2]);
});

// ——— четыре команды —————————————————————————————————————————————————

test("на передний план поднимает поверх всех, и клик уходит к ней", () => {
  const built = near(3);
  const after = move(built.project, [built.ids[0]], MARK_ORDER_FRONT);
  assert.deepEqual(shown(after, built.scheme), ["Р2", "Р3", "Р1"]);
  assert.equal(clicked(after, built.scheme, between(0, 1)), built.ids[0], "поднятая метка не забрала клик");
});

test("на задний план убирает под все, и клик достаётся соседке", () => {
  const built = near(3);
  const after = move(built.project, [built.ids[2]], MARK_ORDER_BACK);
  assert.deepEqual(shown(after, built.scheme), ["Р3", "Р1", "Р2"]);
  assert.equal(clicked(after, built.scheme, between(1, 2)), built.ids[1], "опущенная метка всё ещё ловит клик");
});

test("выше и ниже — ровно один шаг, а не до края", () => {
  const built = near(4);
  const up = move(built.project, [built.ids[0]], MARK_ORDER_UP);
  assert.deepEqual(shown(up, built.scheme), ["Р2", "Р1", "Р3", "Р4"]);
  const down = move(built.project, [built.ids[3]], MARK_ORDER_DOWN);
  assert.deepEqual(shown(down, built.scheme), ["Р1", "Р2", "Р4", "Р3"]);
  // Шаг за шагом доходит до края — и дальше не идёт.
  let walk = built.project;
  for (let step = 0; step < 10; step += 1) walk = move(walk, [built.ids[0]], MARK_ORDER_UP);
  assert.deepEqual(shown(walk, built.scheme), ["Р2", "Р3", "Р4", "Р1"]);
});

test("команда, которой некуда двигать, ничего не меняет и не просит шага истории", () => {
  const built = near(3);
  for (const kind of [MARK_ORDER_FRONT, MARK_ORDER_UP]) {
    const result = moveMarkOrder(built.project, [built.ids[2]], kind);
    assert.equal(result.moved, false, kind + ": верхнюю метку ещё раз подняли");
    assert.equal(result.project, built.project, kind + ": объект пересобран без нужды");
    assert.equal(markOrderCan(built.project, [built.ids[2]], kind), false, kind + ": кнопка не погасла");
  }
  for (const kind of [MARK_ORDER_BACK, MARK_ORDER_DOWN]) {
    assert.equal(moveMarkOrder(built.project, [built.ids[0]], kind).moved, false, kind + ": нижнюю метку опустили");
    assert.equal(markOrderCan(built.project, [built.ids[0]], kind), false, kind + ": кнопка не погасла");
  }
  // А те, которым есть куда, — наоборот.
  for (const kind of MARK_ORDER_MOVES) {
    assert.equal(markOrderCan(built.project, [built.ids[1]], kind), true, kind + ": кнопка у средней метки погасла");
  }
  // Метка одна на схеме — двигать нечего ни в одну сторону.
  const alone = near(1);
  for (const kind of MARK_ORDER_MOVES) {
    assert.equal(markOrderCan(alone.project, [alone.ids[0]], kind), false, kind + ": одинокую метку двигают");
  }
});

// ——— ноль — это верх ————————————————————————————————————————————————

test("ярусы раздаются от нуля вниз, и нуль поля не получает", () => {
  const built = near(3);
  const after = move(built.project, [built.ids[0]], MARK_ORDER_FRONT);
  const zOf = (index) => findMark(after, built.ids[index]);
  assert.equal(markZ(zOf(1)), -2);
  assert.equal(markZ(zOf(2)), -1);
  assert.equal(markZ(zOf(0)), 0);
  assert.ok(!("z" in zOf(0)), "у верхней метки поле яруса всё-таки записано");
});

test("новая метка встаёт наверх и после правки порядка", () => {
  const built = near(2);
  // Порядок правили руками: Р1 поверх Р2.
  const after = move(built.project, [built.ids[0]], MARK_ORDER_FRONT);
  const added = addMark(after, {
    schemeId: built.scheme.id,
    typeId: typeId(after, "Р"),
    kind: "point",
    points: [{ x: SPOT.x + (2 * STEP_PX) / WIDTH, y: SPOT.y }],
  });
  assert.deepEqual(shown(added.project, built.scheme), ["Р2", "Р1", "Р3"], "поставленная метка ушла под старые");
  assert.equal(
    clicked(added.project, built.scheme, between(1, 2)),
    added.mark.id,
    "клик достался не только что поставленной метке",
  );
});

// ——— фильтр и блок —————————————————————————————————————————————————

test("шаг «выше» шагает через видимую метку, а края поднимают над всем листом", () => {
  const built = near(3);
  // Человек видит только Р1 и Р3: Р2 спрятана фильтром.
  const among = [built.ids[0], built.ids[2]];
  const up = move(built.project, [built.ids[0]], MARK_ORDER_UP, { among });
  assert.deepEqual(shown(up, built.scheme), ["Р2", "Р3", "Р1"], "шаг остановился на спрятанной метке");
  // «На передний план» фильтр не слушает: поднятая метка обязана остаться
  // наверху и после того, как фильтр сняли.
  const front = move(built.project, [built.ids[1]], MARK_ORDER_FRONT, { among });
  assert.deepEqual(shown(front, built.scheme), ["Р1", "Р3", "Р2"]);
});

test("метка из блока переставляется вместе со всем блоком, порядок внутри не сбивается", () => {
  const built = near(1);
  // Блок из трёх розеток и выключатель поверх него.
  let project = addToGroup(built.project, built.ids[0], "right").project;
  project = addToGroup(project, project.marks[project.marks.length - 1].id, "right").project;
  const group = project.groups[0];
  const switchMark = addMark(project, {
    schemeId: built.scheme.id,
    typeId: typeId(project, "В"),
    kind: "point",
    points: [{ x: 0.45, y: 0.5 }],
  });
  project = switchMark.project;
  const blockIds = group.markIds;
  assert.equal(blockIds.length, 3, "блок не собрался");

  const after = move(project, blockIds, MARK_ORDER_FRONT);
  const order = visibleMarks(after, after.schemes[0], null).map((mark) => mark.id);
  assert.deepEqual(order, [switchMark.mark.id, ...blockIds], "блок уехал наверх не целиком или перемешался");
  // И обратно: весь блок под выключатель.
  const back = move(after, blockIds, MARK_ORDER_BACK);
  assert.deepEqual(
    visibleMarks(back, back.schemes[0], null).map((mark) => mark.id),
    [...blockIds, switchMark.mark.id],
  );
});

test("метки чужой схемы в переносе не участвуют", () => {
  const built = near(2);
  const second = addScheme(built.project, { name: "2 этаж", width: WIDTH, height: HEIGHT });
  const added = addMark(second.project, {
    schemeId: second.scheme.id,
    typeId: typeId(second.project, "Р"),
    kind: "point",
    points: [{ x: 0.5, y: 0.5 }],
  });
  const after = move(added.project, [built.ids[0]], MARK_ORDER_FRONT);
  assert.equal(markZ(findMark(after, added.mark.id)), 0, "метке второго этажа переписали ярус");
  assert.deepEqual(shown(after, after.schemes[1]), ["Р3"], "порядок второго этажа поехал");
});

// ——— порядок переживает файл ————————————————————————————————————————

test("порядок уезжает в файл и возвращается им же", async () => {
  const built = near(3);
  const after = move(built.project, [built.ids[2]], MARK_ORDER_BACK);
  const packed = await packProject(after, new Map(), { date: new Date(2026, 0, 1, 12, 0, 0) });
  const opened = (await unpackProject(packed)).project;
  assert.deepEqual(shown(opened, opened.schemes[0]), ["Р3", "Р1", "Р2"], "порядок не доехал до файла");
  assert.deepEqual(opened.marks.map((mark) => markZ(mark)), [-1, 0, -2]);
  // Место в массиве — прежнее: в файл уехал ярус, а не перестановка.
  assert.deepEqual(opened.marks.map((mark) => mark.id), built.ids);
});

test("G68: объект без правок порядка — побайтно прежний файл", async () => {
  const built = near(3);
  const packedAt = new Date(2026, 0, 1, 12, 0, 0);
  const before = await packProject(built.project, new Map(), { date: packedAt });
  // Всё, что умеет порядок, — на том же объекте: кадр, клик, расчёт кнопок.
  visibleMarks(built.project, built.scheme, null);
  hitTest(built.project, built.scheme, { x: 600, y: 400 }, viewOf(), null);
  for (const kind of MARK_ORDER_MOVES) markOrderCan(built.project, [built.ids[1]], kind);
  const after = await packProject(built.project, new Map(), { date: packedAt });
  assert.deepEqual(
    new Uint8Array(await after.arrayBuffer()),
    new Uint8Array(await before.arrayBuffer()),
    "объект изменился от одного только показа порядка",
  );
});

// ——— место в массиве осталось порядком постановки ————————————————————

test("порядок на экране не трогает смыкание номеров", () => {
  // Два светильника в одной комнате с дырой в нумерации: Т1 и Т3.
  let project = createProject({ name: "Номера" });
  const scheme = addScheme(project, { name: "1 этаж", width: WIDTH, height: HEIGHT });
  project = scheme.project;
  const room = addRoom(project, { name: "Спальная" });
  project = room.project;
  const code = typeId(project, "Т");
  const ids = [];
  for (const at of [{ x: 0.3, y: 0.5 }, { x: 0.6, y: 0.5 }]) {
    const added = addMark(project, { schemeId: scheme.scheme.id, typeId: code, kind: "point", points: [at] });
    project = updateMark(added.project, added.mark.id, { roomId: room.room.id }).project;
    ids.push(added.mark.id);
  }
  project = setMarkNumber(project, ids[1], 3).project;
  const plain = compactNumbers(project, code).changes.map((change) => change.markId + ":" + change.to);

  // Второй светильник поднят на передний план — смыкание обязано ответить то
  // же самое. Переставь порядок массива вместо яруса, и номера разъехались бы.
  const raised = move(project, [ids[0]], MARK_ORDER_FRONT);
  const after = compactNumbers(raised, code).changes.map((change) => change.markId + ":" + change.to);
  assert.deepEqual(after, plain, "порядок на экране переписал раздачу номеров");
});

test("порядок на экране не трогает перечень «чем управляет»", () => {
  const built = near(1);
  let project = built.project;
  const lamps = [];
  for (const at of [{ x: 0.5, y: 0.4 }, { x: 0.7, y: 0.4 }]) {
    const added = addMark(project, {
      schemeId: built.scheme.id,
      typeId: typeId(project, "Т"),
      kind: "point",
      points: [at],
    });
    project = added.project;
    lamps.push(added.mark.id);
  }
  project = setMarkControls(project, built.ids[0], [lamps[1], lamps[0]]).project;
  const plain = markControls(project, built.ids[0]).map((mark) => mark.id);
  assert.deepEqual(plain, lamps, "перечень хранится не в порядке объекта");

  const raised = move(project, [lamps[1]], MARK_ORDER_FRONT);
  assert.deepEqual(markControls(raised, built.ids[0]).map((mark) => mark.id), plain, "перечень связей переехал");
  assert.deepEqual(
    findMark(raised, built.ids[0]).controls,
    findMark(project, built.ids[0]).controls,
    "запись связей в объекте переписана",
  );
});

test("порядок на экране не передаёт аксессуар другой метке", () => {
  // Два светильника с одним обозначением: ведущая — первая по массиву.
  const built = near(2, { code: "Т" });
  const project = setMarkNumber(built.project, built.ids[1], 1).project;
  assert.equal(markDeviceLeader(project, built.ids[1]), built.ids[0], "ведущая не первая по массиву");

  const raised = move(project, [built.ids[1]], MARK_ORDER_FRONT);
  assert.equal(markDeviceLeader(raised, built.ids[1]), built.ids[0], "аксессуар уехал к другой метке");
  assert.equal(markDeviceLeader(raised, built.ids[0]), null);
});

// ——— кадр и выгрузки ——————————————————————————————————————————————————

test("кадр рисует метки в том же порядке — а значит, и PNG, и лист, и печать", () => {
  const built = near(3);
  // Запись холста: порядок обозначений в журнале — порядок прохода меток.
  // Выгрузки (PNG схемы, лист ГОСТ, печать, архив всех схем) рисуют тем же
  // `drawScheme`, поэтому своего порядка у листа нет и быть не может.
  assert.deepEqual(frame(built.project, built.scheme), ["Р1", "Р2", "Р3"]);
  const after = move(built.project, [built.ids[0]], MARK_ORDER_FRONT);
  assert.deepEqual(frame(after, built.scheme), ["Р2", "Р3", "Р1"], "кадр рисует метки в прежнем порядке");
});

// ——— совпавшие метки: порядок решает, кто остался на точке ————————————

test("у метки на метке порядок решает стопку: верхняя уезжает, нижняя стоит на точке", () => {
  // Знаки ровно в одной точке — здесь их разводит стопка (G181), и вопрос
  // «кто виден» она снимает сама. Порядок остаётся старшим ключом её ряда:
  // на настоящей точке стоит нижняя по порядку метка, читается стопка от неё.
  const built = near(2, { gap: 0 });
  const view = viewOf();
  const base = (project) => {
    const stacks = markStacks(project, project.schemes[0], null, view);
    return visibleMarks(project, project.schemes[0], null)
      .map((mark) => ({ id: mark.id, place: stacks.get(mark.id) }))
      .find((item) => item.place && item.place.index === 0).id;
  };
  assert.equal(base(built.project), built.ids[0], "на точке остался не первый по порядку знак");
  const after = move(built.project, [built.ids[1]], MARK_ORDER_BACK);
  assert.equal(base(after), built.ids[1], "опущенная метка не стала началом стопки");
  // Точки в объекте при этом не двигались ни на долю: стопка — отрисовка.
  for (const id of built.ids) {
    assert.deepEqual(findMark(after, id).points, [{ x: SPOT.x, y: SPOT.y }], "метка переехала");
  }
  // И знаки по-прежнему разъехались — порядок стопку не отменил.
  const stacks = markStacks(after, after.schemes[0], null, view);
  assert.notDeepEqual(
    markStackPoints(findMark(after, built.ids[0]), stacks)[0],
    markStackPoints(findMark(after, built.ids[1]), stacks)[0],
  );
});

// ——— где живут команды и чем они пишут ————————————————————————————————
//
// Окно и состояние сеанса тестами не покрыты (DOM и canvas не покрываются
// нарочно), поэтому здесь держится то, что покрыть можно: правка идёт через
// отмену, ряд кнопок стоит там, где обещано, и в чужих раскладках его нет.
const CANVAS_SRC = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "src", "canvas.js"), "utf8");
const CARD_SRC = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "..", "src", "panels", "markCard.js"),
  "utf8",
);
const VOLUME_SRC = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "..", "src", "panels", "volume.js"),
  "utf8",
);

const bodyOf = (source, head) => {
  const from = source.indexOf(head);
  assert.ok(from > 0, "пропала дверь: " + head);
  const rest = source.slice(from + head.length);
  const end = rest.indexOf("\n}\n");
  return rest.slice(0, end > 0 ? end : rest.length);
};

test("порядок правится через отмену, своим ярлыком и ни разу напрямую", () => {
  const body = bodyOf(CANVAS_SRC, "export function canvasMarkOrder(markId, move) {");
  assert.ok(body.includes("canvasCommit("), "порядок меток снова идёт мимо истории");
  assert.ok(body.includes("strings.history.markOrder"), "у шага пропал свой ярлык");
  assert.ok(!/setState\(\s*\{[^}]*project:/.test(body), "порядок меток пишет объект напрямую");
  assert.ok(body.includes("if (!result.moved) return;"), "команда без правки снова кладёт шаг в историю");
  assert.ok(strings.history.markOrder.length > 3, "ярлык шага пустой");
});

test("ряд команд порядка стоит в карточке метки и только в правке плана", () => {
  const body = bodyOf(CARD_SRC, "export function markCardOrderRow(state, markId) {");
  assert.ok(body.includes("canvasEditAllowed(state)"), "ряд порядка появился в просмотре и при запущенном доме");
  assert.ok(body.includes("canvasOnScreen(state)"), "ряд порядка остался на чужом поле");
  assert.ok(body.includes("canvasMarkOrderCan(state, markId, move)"), "кнопки порядка перестали гаснуть");
  for (const kind of MARK_ORDER_MOVES) {
    assert.ok(body.includes('MARK_ORDER_' + kind.toUpperCase()), "в ряду нет команды " + kind);
  }
  // Карточка объёма собирается тем же `markCardParts`, но ряда порядка не
  // получает: порядок плана в объёме не значит ничего.
  assert.ok(!/order:\s*markCardOrderRow/.test(VOLUME_SRC), "ряд порядка уехал в карточку объёма");
  assert.ok(CARD_SRC.includes("order: markCardOrderRow(state, model.id)"), "карточка плана не показывает ряд порядка");
});
