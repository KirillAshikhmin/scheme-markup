// Канал связи: какая клавиша выключателя ведёт к какой нагрузке (G140).
//
// Слова заказчика: «если выключатель одинарный, то он управляет своей
// нагрузкой и связь 1 к 1. а вот если двойной, то связи получаются к 2
// нагрузкам сразу и фактически какой канал выключателя к какой нагрузке идёт —
// не понятно».
//
// Главное, что здесь проверяется, — не «канал записался», а четыре обещания,
// каждое из которых ломается молча:
//
// 1. **Объект прежнего формата открывается как закрывался.** Связь без канала
//    законна, записана строкой и строкой остаётся; ни перечень в строке метки,
//    ни таблица, ни план, ни панель предупреждений не меняются.
// 2. **Канал не теряется.** Ни при удалении соседней метки, ни при упаковке в
//    файл, ни при слиянии копий — канал часть связи и ездит вместе с ней.
// 3. **Канал сверх числа каналов типа не пропадает молча.** Уменьшили каналы у
//    типа — связь остаётся, а о ней говорит панель предупреждений.
// 4. **Проходная схема — это не каналы.** В1 и ВП1 на одной нагрузке, у обоих
//    первый канал: общая цепь между ними остаётся такой же, как была.
import test from "node:test";
import assert from "node:assert/strict";

import {
  TYPE_CHANNELS_MAX,
  addMark,
  addScheme,
  addType,
  addTypesFromCatalog,
  channelLabel,
  createProject,
  defaultTemplate,
  deleteMark,
  labelOf,
  markControlChannel,
  markControlIds,
  markControlLinks,
  markControlsByChannel,
  setMarkControls,
  typeChannels,
  updateType,
  validate,
} from "../src/model.js";
import { markLinks, drawMarkLinks } from "../src/render.js";
import { linksTable, toCsv } from "../src/tables.js";
import { marksControlsText } from "../src/panels/marks.js";
import { mergeProjects } from "../src/merge.js";
import { packProject, unpackProject } from "../src/projectFile.js";

const PLAN = { width: 1000, height: 800 };

// Двухклавишный выключатель и три нагрузки: две лампы на одной клавише,
// светильник на другой. Ровно тот случай, с которого начался тикет.
function flat() {
  let project = createProject({ name: "Квартира" });
  const made = addScheme(project, { name: "1 этаж", ...PLAN });
  project = made.project;
  const schemeId = made.scheme.id;
  const typeOf = (code) => project.markTypes.find((type) => type.code === code).id;
  const put = (code, x) => {
    const result = addMark(project, { schemeId, typeId: typeOf(code), kind: "point", points: [{ x, y: 0.5 }] });
    project = result.project;
    return result.mark.id;
  };
  const twoWay = put("ВВ", 0.1);
  const oneWay = put("В", 0.2);
  const through = put("ВП", 0.25);
  const spotOne = put("Т", 0.4);
  const spotTwo = put("Т", 0.5);
  const lamp = put("С", 0.6);
  return {
    get project() {
      return project;
    },
    set project(value) {
      project = value;
    },
    schemeId,
    typeOf,
    twoWay,
    oneWay,
    through,
    spotOne,
    spotTwo,
    lamp,
  };
}

// Объект, размеченный до появления каналов: у типов нет поля `channels`, у
// связей — только идентификаторы. Ровно то, что лежит у заказчика в браузере и
// в zip-файлах.
function legacy() {
  const box = flat();
  box.project = setMarkControls(box.project, box.twoWay, [box.spotOne, box.spotTwo]).project;
  return {
    ...box,
    project: {
      ...box.project,
      markTypes: box.project.markTypes.map((type) => {
        const copy = { ...type };
        delete copy.channels;
        return copy;
      }),
    },
  };
}

test("у типа есть число каналов: в шаблоне В — 1, ВВ — 2, ВВВ — 3", () => {
  const project = createProject({ name: "Квартира" });
  const channelsOf = (code) => typeChannels(project, project.markTypes.find((type) => type.code === code).id);
  assert.equal(channelsOf("В"), 1);
  assert.equal(channelsOf("ВВ"), 2);
  assert.equal(channelsOf("ВВВ"), 3);
  // Проходной переключатель — не многоканальный: у него своя единственная
  // клавиша, а «второе место» — это другая метка, а не другой канал.
  assert.equal(channelsOf("ВП"), 1);
  assert.equal(channelsOf("Т"), 1);
});

test("у типа без поля каналов их один, и заведённый руками тип тоже одноканальный", () => {
  const box = legacy();
  assert.equal(typeChannels(box.project, box.typeOf("ВВ")), 1, "поля нет — значит один канал");
  const added = addType(box.project, {
    code: "РЕЛЕ",
    name: "Реле",
    categoryId: box.project.categories[0].id,
  });
  assert.equal(added.type.channels, 1, "умолчание не гадает за пользователя");
  assert.equal(typeChannels(added.project, added.type.id), 1);
  const four = updateType(added.project, added.type.id, { channels: 4 });
  assert.equal(typeChannels(four.project, four.type.id), 4);
  assert.throws(() => updateType(four.project, added.type.id, { channels: 0 }), /Каналов у типа/);
  assert.throws(() => updateType(four.project, added.type.id, { channels: TYPE_CHANNELS_MAX + 1 }), /Каналов у типа/);
});

test("ВВ из общей базы приезжает двухканальным, а не «таким же, но без клавиш»", () => {
  const box = legacy();
  const trimmed = {
    ...box.project,
    markTypes: box.project.markTypes.filter((type) => type.code !== "ВВ"),
  };
  const result = addTypesFromCatalog(trimmed, defaultTemplate(), ["ВВ"]);
  const type = result.project.markTypes.find((item) => item.code === "ВВ");
  assert.equal(typeChannels(result.project, type.id), 2);
});

test("канал — свойство связи: пишется на связь, а не на метку", () => {
  const box = flat();
  const result = setMarkControls(box.project, box.twoWay, [
    { id: box.spotOne, channel: 1 },
    { id: box.spotTwo, channel: 1 },
    { id: box.lamp, channel: 2 },
  ]);
  box.project = result.project;
  const mark = result.mark;
  assert.deepEqual(markControlIds(mark), [box.spotOne, box.spotTwo, box.lamp]);
  assert.equal(markControlChannel(mark, box.spotOne), 1);
  assert.equal(markControlChannel(mark, box.lamp), 2);
  // Один канал на несколько нагрузок — норма, а не оплошность: клавиша на
  // группу из шести светильников.
  const byChannel = markControlsByChannel(box.project, box.twoWay);
  assert.deepEqual(
    byChannel.map((group) => [group.channel, group.marks.map((item) => labelOf(box.project, item.id))]),
    [
      [1, ["Т1", "Т2"]],
      [2, ["С1"]],
    ],
  );
  assert.throws(() => setMarkControls(box.project, box.twoWay, [{ id: box.spotOne, channel: 0 }]), /Канал связи/);
  assert.throws(
    () => setMarkControls(box.project, box.twoWay, [{ id: box.spotOne, channel: TYPE_CHANNELS_MAX + 1 }]),
    /Канал связи/,
  );
});

test("связь без канала пишется строкой: файл объекта прежнего формата не растёт ни на байт", () => {
  const box = flat();
  const plain = setMarkControls(box.project, box.twoWay, [box.spotOne, box.spotTwo]);
  assert.deepEqual(plain.mark.controls, [box.spotOne, box.spotTwo], "строка, а не объект с пустым каналом");
  // Смешанный список: одна связь с каналом, другая без — и вторая остаётся
  // строкой. Иначе назначение канала одной нагрузке переписывало бы запись
  // всех соседних.
  const mixed = setMarkControls(plain.project, box.twoWay, [{ id: box.spotOne, channel: 2 }, box.spotTwo]);
  assert.deepEqual(mixed.mark.controls, [{ id: box.spotOne, channel: 2 }, box.spotTwo]);
});

test("объект прежнего формата открывается как закрывался: план, перечень, таблица и предупреждения те же", () => {
  const box = legacy();
  const before = JSON.stringify(box.project.marks);

  // Перечень в строке метки — ровно тот, что был до каналов.
  assert.equal(marksControlsText(box.project, box.twoWay), "Т1, Т2");

  // На плане — две дуги без единой цифры канала.
  const scheme = box.project.schemes[0];
  const links = markLinks(box.project, scheme, null);
  assert.equal(links.lines.length, 2);
  assert.deepEqual(links.lines.map((line) => line.channel), [null, null]);
  const probe = textProbe();
  drawMarkLinks(probe.ctx, links, scheme, { zoom: 1, offsetX: 0, offsetY: 0, markSize: 10, labelSize: 12 });
  assert.deepEqual(probe.texts, [], "у объекта без каналов на плане не появилось ни одной цифры");

  // В таблице — одна строка на метку, колонка канала пустая.
  const forward = linksTable(box.project, null).groups[0];
  assert.equal(forward.rows.length, 1);
  assert.equal(forward.rows[0].cells[4], "");
  assert.equal(forward.rows[0].cells[5], "Т1, Т2");

  // Ни одного нового предупреждения: у типа один канал, спрашивать нечего.
  assert.deepEqual(
    validate(box.project).filter((problem) => problem.code.startsWith("controlsChannel")),
    [],
  );

  // И сам объект не тронут: ни поля, ни порядка, ни формы записи.
  assert.equal(JSON.stringify(box.project.marks), before);
});

test("перечень в строке метки группируется по каналам", () => {
  const box = flat();
  box.project = setMarkControls(box.project, box.twoWay, [
    { id: box.spotOne, channel: 1 },
    { id: box.spotTwo, channel: 1 },
    { id: box.lamp, channel: 2 },
  ]).project;
  assert.equal(marksControlsText(box.project, box.twoWay), "① Т1, Т2 · ② С1");
  assert.equal(channelLabel(1), "①");
  assert.equal(channelLabel(null), "", "канал не указан — значка нет вовсе");

  // Нагрузка без канала стоит хвостом: сперва разложенное по клавишам, потом
  // то, что ещё не разложили.
  box.project = setMarkControls(box.project, box.twoWay, [
    { id: box.spotOne, channel: 2 },
    box.spotTwo,
    { id: box.lamp, channel: 1 },
  ]).project;
  assert.equal(marksControlsText(box.project, box.twoWay), "① С1 · ② Т1 · Т2");
});

test("на плане у основания дуги стоит цифра канала", () => {
  const box = flat();
  box.project = setMarkControls(box.project, box.twoWay, [
    { id: box.spotOne, channel: 1 },
    { id: box.lamp, channel: 2 },
  ]).project;
  const scheme = box.project.schemes[0];
  const links = markLinks(box.project, scheme, null);
  assert.deepEqual(links.lines.map((line) => line.channel), [1, 2]);

  const probe = textProbe();
  const view = { zoom: 1, offsetX: 0, offsetY: 0, markSize: 10, labelSize: 12 };
  drawMarkLinks(probe.ctx, links, scheme, view);
  assert.deepEqual(
    probe.texts.map((item) => item.value),
    ["1", "1", "2", "2"],
    "каждая цифра рисуется дважды: светлая обводка под ней и сама цифра",
  );

  // Клавиша на группу светильников — обычное дело, и цифра у неё одна:
  // шесть одинаковых цифр у одного знака легли бы друг на друга кляксой.
  const group = setMarkControls(box.project, box.twoWay, [
    { id: box.spotOne, channel: 1 },
    { id: box.spotTwo, channel: 1 },
    { id: box.lamp, channel: 2 },
  ]).project;
  const many = textProbe();
  drawMarkLinks(many.ctx, markLinks(group, group.schemes[0], null), scheme, view);
  assert.deepEqual(many.texts.map((item) => item.value), ["1", "1", "2", "2"], "цифра рисуется на дугу, а не на клавишу");
  // Цифра стоит у своей метки, а не у нагрузки: канал — свойство управляющей
  // стороны, и у метки с двумя дугами цифры сравнивают рядом.
  const from = { x: 0.1 * PLAN.width, y: 0.5 * PLAN.height };
  for (const item of probe.texts) {
    assert.ok(Math.hypot(item.x - from.x, item.y - from.y) < 40, "цифра ушла от основания дуги");
  }
  // И не лежит на самой линии — иначе читалась бы как часть знака.
  for (const item of probe.texts) {
    assert.ok(Math.abs(item.y - from.y) > 2, "цифра легла прямо на дугу");
  }
});

test("таблица связей: строка на канал, колонка «Канал» уезжает в CSV", () => {
  const box = flat();
  box.project = setMarkControls(box.project, box.twoWay, [
    { id: box.spotOne, channel: 1 },
    { id: box.spotTwo, channel: 1 },
    { id: box.lamp, channel: 2 },
  ]).project;
  const table = linksTable(box.project, null);
  assert.equal(table.columns[4], "Канал");

  const forward = table.groups[0];
  assert.deepEqual(
    forward.rows.map((row) => [row.cells[0], row.cells[4], row.cells[5]]),
    [
      ["ВВ1", "1", "Т1, Т2"],
      ["ВВ1", "2", "С1"],
    ],
  );
  // Обратная сторона называет канал управляющего: у щита читают лист с другой
  // стороны, и «от какой клавиши» там тот же вопрос.
  const back = table.groups[1];
  assert.deepEqual(
    back.rows.map((row) => [row.cells[0], row.cells[4], row.cells[5]]),
    [
      ["Т1", "1", "ВВ1"],
      ["Т2", "1", "ВВ1"],
      ["С1", "2", "ВВ1"],
    ],
  );
  const csv = toCsv(table);
  assert.ok(csv.includes("Канал"), "колонка не доехала до CSV");
  assert.ok(
    csv.split("\n").some((line) => line.includes("ВВ1") && line.includes(";2;С1")),
    "канал не доехал до CSV",
  );
});

test("нагрузки без канала у многоканального типа попадают в предупреждения", () => {
  const box = flat();
  box.project = setMarkControls(box.project, box.twoWay, [box.spotOne, box.lamp]).project;
  const problem = validate(box.project).find((item) => item.code === "controlsChannelMissing");
  assert.ok(problem, "две нагрузки у двухклавишного и ни одного канала — а панель молчит");
  assert.equal(problem.kind, "warning", "это предупреждение, а не ошибка");
  assert.equal(problem.message, "ВВ1 — нагрузок 2, канал не указан");

  // Одна нагрузка загадки не создаёт, и одноканальный тип — тем более.
  const single = setMarkControls(box.project, box.twoWay, [box.spotOne]).project;
  assert.equal(
    validate(single).some((item) => item.code === "controlsChannelMissing"),
    false,
  );
  const plain = setMarkControls(box.project, box.oneWay, [box.spotOne, box.spotTwo]).project;
  assert.equal(
    validate(plain).filter((item) => item.code === "controlsChannelMissing" && item.ref === box.oneWay).length,
    0,
    "один канал на группу светильников — приём заказчика, а не предупреждение",
  );
});

test("канал сверх числа каналов типа остаётся, и о нём сказано вслух", () => {
  const box = flat();
  box.project = updateType(box.project, box.typeOf("ВВ"), { channels: 3 }).project;
  box.project = setMarkControls(box.project, box.twoWay, [
    { id: box.spotOne, channel: 1 },
    { id: box.lamp, channel: 3 },
  ]).project;
  assert.equal(
    validate(box.project).some((item) => item.code === "controlsChannelBeyond"),
    false,
    "три канала у типа — третий канал в порядке",
  );

  // Передумали: у типа снова два канала. Связь на третьем остаётся как была.
  box.project = updateType(box.project, box.typeOf("ВВ"), { channels: 2 }).project;
  const mark = box.project.marks.find((item) => item.id === box.twoWay);
  assert.equal(markControlChannel(mark, box.lamp), 3, "связь на отпавшем канале потеряна молча");
  const problem = validate(box.project).find((item) => item.code === "controlsChannelBeyond");
  assert.ok(problem);
  assert.equal(problem.kind, "warning");
  assert.equal(problem.message, "ВВ1 — связь на канале 3, а у типа ВВ каналов 2");
});

test("проходная схема — не каналы: общая цепь между В1 и ВП1 осталась как была", () => {
  const box = flat();
  box.project = setMarkControls(box.project, box.oneWay, [{ id: box.spotOne, channel: 1 }]).project;
  box.project = setMarkControls(box.project, box.through, [{ id: box.spotOne, channel: 1 }]).project;
  const links = markLinks(box.project, box.project.schemes[0], null);
  assert.equal(links.ties.length, 1, "цепь равных между двумя управляющими пропала");
  assert.deepEqual(
    [links.ties[0].fromId, links.ties[0].toId].sort(),
    [box.oneWay, box.through].sort(),
  );
  // У обоих свой первый канал, и в обратной таблице они стоят одной строкой:
  // «Т1 ← В1, ВП1» — это одна цепь, а не две разные клавиши.
  const back = linksTable(box.project, null).groups[1];
  const row = back.rows.find((item) => item.cells[0] === "Т1");
  assert.deepEqual([row.cells[4], row.cells[5]], ["1", "В1, ВП1"]);
});

test("канал переживает удаление соседней метки, файл проекта и слияние копий", async () => {
  const box = flat();
  box.project = setMarkControls(box.project, box.twoWay, [
    { id: box.spotOne, channel: 1 },
    { id: box.spotTwo, channel: 1 },
    { id: box.lamp, channel: 2 },
  ]).project;

  // Удаление нагрузки снимает её связь и не трогает канал у соседних.
  const cut = deleteMark(box.project, box.spotTwo).project;
  const after = cut.marks.find((item) => item.id === box.twoWay);
  assert.deepEqual(markControlIds(after), [box.spotOne, box.lamp]);
  assert.equal(markControlChannel(after, box.lamp), 2);

  // Файл проекта: что упаковано — то распаковано.
  const restored = await unpackProject(await packProject(box.project, new Map()));
  const packed = restored.project.marks.find((item) => item.id === box.twoWay);
  assert.deepEqual(markControlLinks(packed), markControlLinks(box.project.marks.find((i) => i.id === box.twoWay)));

  // Слияние копий: канал — часть связи, и правка второй стороны доезжает.
  const base = JSON.parse(JSON.stringify(box.project));
  const ours = { ...JSON.parse(JSON.stringify(base)), updatedAt: "2026-09-17T10:00:00.000Z" };
  const theirsSource = setMarkControls(JSON.parse(JSON.stringify(base)), box.twoWay, [
    { id: box.spotOne, channel: 1 },
    { id: box.spotTwo, channel: 2 },
    { id: box.lamp, channel: 2 },
  ]).project;
  const theirs = { ...theirsSource, updatedAt: "2026-09-17T10:05:00.000Z" };
  const merged = mergeProjects(ours, theirs, base);
  const mine = merged.project.marks.find((item) => item.id === box.twoWay);
  assert.equal(markControlChannel(mine, box.spotTwo), 2, "чужая правка канала потерялась при слиянии");

  // И чистка висячих ссылок каналы не переписывает: связь на удалённую метку
  // уходит, соседняя остаётся объектом с каналом.
  const without = { ...merged.project, marks: merged.project.marks.filter((item) => item.id !== box.spotOne) };
  const cleaned = mergeProjects(
    { ...without, updatedAt: "2026-09-17T11:00:00.000Z" },
    { ...JSON.parse(JSON.stringify(without)), updatedAt: "2026-09-17T11:01:00.000Z" },
    without,
  );
  const survivor = cleaned.project.marks.find((item) => item.id === box.twoWay);
  assert.deepEqual(markControlIds(survivor), [box.spotTwo, box.lamp]);
  assert.equal(markControlChannel(survivor, box.lamp), 2);
});

// Заглушка холста, которая помнит нарисованный текст: цифра канала проверяется
// по ней, а не глазами.
function textProbe() {
  const texts = [];
  const impl = {
    canvas: { width: 900, height: 600 },
    lineWidth: 1,
    globalAlpha: 1,
    strokeStyle: "",
    fillStyle: "",
    font: "",
    measureText: (value) => ({ width: String(value).length * 7 }),
    getTransform: () => ({ a: 1 }),
    fillText(value, x, y) {
      texts.push({ value: String(value), x, y });
    },
    strokeText(value, x, y) {
      texts.push({ value: String(value), x, y });
    },
  };
  return {
    texts,
    ctx: new Proxy(impl, {
      get: (object, key) => (key in object ? object[key] : () => {}),
      set: (object, key, value) => {
        object[key] = value;
        return true;
      },
    }),
  };
}
