// Чёрно-белый лист (G170). Проверяется то, что можно проверить без холста:
//
// 1) правило перекраски — чистая функция `monoPaint`;
// 2) что через подставку `monoContext` на лист **не попадает ни одной
//    цветной краски**: сцена со всем сразу (метки пяти категорий, линия,
//    плашка комментария, контур помещения, три рода связей, легенда, план
//    картинкой) рисуется настоящим `drawScheme`, а холст-писец записывает
//    каждое присваивание краски;
// 3) что **без** подставки та же сцена красится по-прежнему цветом — иначе
//    «обычная выгрузка не изменилась» было бы обещанием, а не проверкой;
// 4) что совпадения знаков считаются по тому самому листу, который выгружают.
//
// Отпечаток пикселей выгруженного PNG снимается в живом прогоне: холста в Node
// нет, и подменять его своим растеризатором ради этой проверки незачем —
// записанная краска говорит то же самое раньше и точнее.
import test from "node:test";
import assert from "node:assert/strict";
import {
  MONO_CLEAR,
  MONO_INK,
  MONO_PAPER,
  monoContext,
  monoPaint,
  monoSameShapes,
  monoSameText,
} from "../src/mono.js";
import { drawScheme, markLinks } from "../src/render.js";
import {
  addMark,
  addOutline,
  addRoom,
  addScheme,
  addToGroup,
  createProject,
  setMarkControls,
  setMarkNumber,
  setMarkPointer,
  styleOf,
  typeKindOf,
  typesInOrder,
  updateMark,
} from "../src/model.js";

// ——— правило перекраски ————————————————————————————————————————————————

test("цвет категории становится тушью, бумага — бумагой, подкраска снимается", () => {
  // Цвета категорий стартового справочника: свет, выключатели, связи.
  for (const color of ["#1F6FEB", "#2DA44E", "#BF3989", "#0F2E7A", "#111418"]) {
    assert.equal(monoPaint(color, "fill"), MONO_INK, color + " должен стать тушью");
    assert.equal(monoPaint(color, "stroke"), MONO_INK, color + " должен стать тушью");
  }
  // Короткая запись и верхний регистр — та же тушь.
  assert.equal(monoPaint("#1f6feb", "fill"), MONO_INK);
  assert.equal(monoPaint("#f00", "fill"), MONO_INK);

  // Подложка подписи, поле плашки, фон легенды — бумага, и прозрачность с них
  // снимается: белое в 0,92 поверх серого плана давало бы серую подпись.
  assert.equal(monoPaint("#ffffff", "fill"), MONO_PAPER);
  assert.equal(monoPaint("rgba(255, 255, 255, 0.92)", "stroke"), MONO_PAPER);
  assert.equal(monoPaint("rgb(255,255,255)", "fill"), MONO_PAPER);

  // Заливка помещения (`outlineTint` с 0,05 на бумаге) снимается целиком, а
  // линия того же контура остаётся тушью: комнату на листе держит контур.
  assert.equal(monoPaint("rgba(31, 111, 235, 0.05)", "fill"), MONO_CLEAR);
  assert.equal(monoPaint("rgba(31, 111, 235, 0.9)", "stroke"), MONO_INK);
  assert.equal(monoPaint("rgba(31, 111, 235, 0.6)", "fill"), MONO_INK, "0,6 — уже краска, а не подкраска");

  // Прозрачное остаётся прозрачным, незнакомая запись уходит в тушь (лучше
  // чёрное, чем невесть какое пятно), градиент проходит как есть.
  assert.equal(monoPaint("rgba(0, 0, 0, 0)", "fill"), MONO_CLEAR);
  assert.equal(monoPaint("cornflowerblue", "fill"), MONO_INK);
  const pattern = { gradient: true };
  assert.equal(monoPaint(pattern, "fill"), pattern);
});

// ——— сцена со всем сразу ———————————————————————————————————————————————

// Холст-писец: записывает каждое присваивание краски и прозрачности кисти,
// меряет текст заглушкой (холста в Node нет) и считает, с каким фильтром
// рисовался план. Неизвестные методы — пустышки, как у измерителя легенды.
function monoScribe() {
  const probe = {
    paints: [],
    alphas: [],
    images: [],
    measureText: (value) => ({ width: String(value).length * 7 }),
    canvas: { width: 1200, height: 900 },
  };
  let filter = "none";
  let fill = "#000000";
  let stroke = "#000000";
  let alpha = 1;
  Object.defineProperty(probe, "filter", {
    configurable: true,
    get: () => filter,
    set: (value) => {
      filter = value;
    },
  });
  Object.defineProperty(probe, "fillStyle", {
    configurable: true,
    get: () => fill,
    set: (value) => {
      fill = value;
      probe.paints.push(value);
    },
  });
  Object.defineProperty(probe, "strokeStyle", {
    configurable: true,
    get: () => stroke,
    set: (value) => {
      stroke = value;
      probe.paints.push(value);
    },
  });
  Object.defineProperty(probe, "globalAlpha", {
    configurable: true,
    get: () => alpha,
    set: (value) => {
      alpha = value;
      probe.alphas.push(value);
    },
  });
  probe.drawImage = () => probe.images.push(filter);
  return new Proxy(probe, {
    get: (obj, key) => (key in obj ? obj[key] : () => {}),
    set: (obj, key, value) => ((obj[key] = value), true),
  });
}

// Объект, в котором есть всё, что умеет красить лист.
function monoWorld() {
  let project = createProject({ name: "Квартира на Ленина" });
  const added = addScheme(project, { name: "1 этаж", width: 1000, height: 800 });
  project = added.project;
  const schemeId = added.scheme.id;
  const idOf = (code) => project.markTypes.find((type) => type.code === code).id;

  // Помещение с контуром: заливка, линия и название.
  const room = addRoom(project, { name: "Кухня" });
  project = room.project;
  project = addOutline(project, {
    schemeId,
    roomId: room.room.id,
    points: [
      { x: 0.05, y: 0.05 },
      { x: 0.5, y: 0.05 },
      { x: 0.5, y: 0.6 },
      { x: 0.05, y: 0.6 },
    ],
  }).project;

  const put = (code, points, kind) => {
    const typeId = idOf(code);
    const result = addMark(project, { schemeId, typeId, kind: kind || typeKindOf(project, typeId), points });
    project = result.project;
    return result.mark.id;
  };

  // Точки пяти категорий — пять разных цветов на листе.
  const lamp = put("Т", [{ x: 0.2, y: 0.2 }]);
  const twin = put("Т", [{ x: 0.3, y: 0.2 }]);
  const socket = put("Р", [{ x: 0.2, y: 0.4 }]);
  const switchOne = put("В", [{ x: 0.12, y: 0.3 }]);
  const switchTwo = put("В", [{ x: 0.12, y: 0.45 }]);
  put("КН", [{ x: 0.42, y: 0.5 }]);
  put("Н", [{ x: 0.35, y: 0.35 }]);
  // Линейный тип: начертание вместо фигуры.
  put("Л", [
    { x: 0.6, y: 0.2 },
    { x: 0.9, y: 0.2 },
    { x: 0.9, y: 0.5 },
  ], "line");
  // Смешанный блок: одна подпись-перечисление, куски разных цветов.
  const block = put("Р", [{ x: 0.7, y: 0.7 }]);
  project = addToGroup(project, block, "right", { typeId: idOf("В") }).project;
  // Плашка комментария с указателем.
  const note = put("Коммент", [{ x: 0.55, y: 0.85 }]);
  project = updateMark(project, note, { original: "Щит в коридоре, кабель сверху" }).project;
  project = setMarkPointer(project, note, true).project;

  // Три рода связей: управление с каналом, общая цепь (два выключателя на одну
  // нагрузку) и общий номер (две метки одного типа с одним номером).
  project = setMarkControls(project, switchOne, [{ id: lamp, channel: 1 }]).project;
  project = setMarkControls(project, switchTwo, [lamp]).project;
  project = setMarkNumber(project, twin, 1).project;
  project = updateMark(project, socket, { roomId: room.room.id }).project;

  return { project, scheme: project.schemes[0] };
}

function monoPaintsOf(ctx, world) {
  drawScheme(ctx, {
    project: world.project,
    scheme: world.scheme,
    // Картинка плана: рисование её — вызов drawImage, больше от неё ничего
    // не нужно.
    image: { width: 1000, height: 800 },
    filter: null,
    view: { zoom: 2, offsetX: 0, offsetY: 0 },
    legend: { x: 16, y: 16 },
    links: markLinks(world.project, world.scheme, null),
    outlines: "pale",
  });
}

test("через чёрно-белую подставку на лист не попадает ни одной цветной краски", () => {
  const world = monoWorld();
  const scribe = monoScribe();
  monoPaintsOf(monoContext(scribe), world);

  // Сцена нарисовалась: пустой список красок зеленел бы молча.
  assert.ok(scribe.paints.length > 40, "красок записано подозрительно мало: " + scribe.paints.length);
  const allowed = new Set([MONO_INK, MONO_PAPER, MONO_CLEAR]);
  const strange = [...new Set(scribe.paints)].filter((paint) => !allowed.has(paint));
  assert.deepEqual(strange, [], "на лист попала краска, которой на чёрно-белом листе быть не должно");
  // Прозрачность кисти прижата: связи и пустая плашка рисуются в полную силу,
  // иначе чёрное в 0,45 вышло бы серым волоском.
  assert.ok(scribe.alphas.length > 0, "прозрачность кисти никто не ставил — пример не тот");
  assert.deepEqual([...new Set(scribe.alphas)], [1], "кисть осталась прозрачной — на бумаге это серый");
  // План обесцвечен: он единственное, что остаётся серым, и фильтр ставится
  // ровно на его отрисовку.
  assert.deepEqual(scribe.images, ["grayscale(1)"], "план нарисован без обесцвечивания");
});

test("без подставки та же сцена красится цветом — обычная выгрузка не тронута", () => {
  const world = monoWorld();
  const scribe = monoScribe();
  monoPaintsOf(scribe, world);

  const paints = new Set(scribe.paints);
  const light = styleOf(world.project, world.project.markTypes.find((type) => type.code === "Т").id).color;
  assert.ok(paints.has(light), "цвет категории «Свет» на лист не попал: пример не тот");
  // Заливка помещения — та самая подкраска, которую чёрно-белый снимает.
  assert.ok([...paints].some((paint) => /^rgba\(.*0\.05\)$/.test(String(paint))), "заливки помещения нет");
  assert.ok(paints.size > 5, "цветов подозрительно мало: " + paints.size);
  assert.ok(scribe.alphas.some((value) => value < 1), "прозрачность кисти не встретилась");
  assert.deepEqual(scribe.images, ["none"], "план обесцвечен без отметки");
});

test("объект от рисования чёрно-белого листа не меняется (G68)", () => {
  const world = monoWorld();
  const before = JSON.stringify(world.project);
  monoPaintsOf(monoContext(monoScribe()), world);
  assert.equal(JSON.stringify(world.project), before, "рисование листа поправило объект");
});

// ——— лист таблицы ——————————————————————————————————————————————————————
//
// Сам `tablePng` в Node не позвать — ему нужен холст, — поэтому здесь
// проверяется то, на чём он держится: все краски листа таблицы уходят в тушь,
// включая полоску категории слева у строки. Пиксели готового файла считает
// живой прогон.


test("краски листа таблицы без цвета становятся тушью", () => {
  // Чем красит `tablePng`: тон текста, приглушённый тон шапки и подытогов,
  // тон линий (он же — запасной цвет полоски у строки без категории).
  for (const color of ["#1f2328", "#57606a", "#d0d7de"]) {
    assert.equal(monoPaint(color, "fill"), MONO_INK, color + " должен стать тушью");
  }
  // Бумага листа остаётся бумагой: лист таблицы заливается белым целиком.
  assert.equal(monoPaint("#ffffff", "fill"), MONO_PAPER);
});

// ——— что теряется вместе с цветом ———————————————————————————————————————

// Все точечные типы справочника — по метке на каждый: так на листе есть всё,
// что справочник умеет нарисовать.
function monoFullSheet() {
  let project = createProject({ name: "Объект" });
  const added = addScheme(project, { name: "1 этаж", width: 1000, height: 800 });
  project = added.project;
  const schemeId = added.scheme.id;
  let at = 0;
  for (const { types } of typesInOrder(project)) {
    for (const type of types) {
      if (typeKindOf(project, type.id) !== "point") continue;
      at += 1;
      project = addMark(project, {
        schemeId,
        typeId: type.id,
        kind: "point",
        points: [{ x: ((at % 20) + 1) / 24, y: (Math.floor(at / 20) + 1) / 8 }],
      }).project;
    }
  }
  return { project, scheme: project.schemes[0] };
}

test("совпадения знаков на листе — только из разных категорий, и только что на листе есть", () => {
  const { project, scheme } = monoFullSheet();
  const groups = monoSameShapes(project, scheme, null);

  // Ровно три группы стартового справочника — те, где знак один, а категории
  // разные. Семь кодов «Света» под кругом с крестом сюда не входят: в цвете
  // они и так нарисованы одинаково.
  assert.deepEqual(
    groups.map((group) => group.shape),
    ["circle-drain", "square-cross", "drop-dot"],
  );
  assert.deepEqual(
    groups.map((group) => group.types.map((type) => type.code)),
    [
      ["Н", "КН"],
      ["ПП", "ВП", "ЩС"],
      ["ОВ", "ВР"],
    ],
  );
  for (const group of groups) {
    for (const type of group.types) {
      assert.ok(type.category, "категория у типа не названа: " + type.code);
      assert.ok(type.name, "имя у типа не названо: " + type.code);
    }
  }

  // Строка для окна: число впереди, список следом, имена типов внутри.
  const line = monoSameText(groups);
  assert.match(line, /: 3\./);
  assert.match(line, /Ночник/);
  assert.match(line, /Выход канализации/);
  assert.equal(monoSameText([]), "", "пустую находку не о чем объявлять");
});

test("знака нет на листе — нет и совпадения: счёт идёт по этой схеме и её фильтру", () => {
  let project = createProject({ name: "Объект" });
  const added = addScheme(project, { name: "1 этаж", width: 1000, height: 800 });
  project = added.project;
  const schemeId = added.scheme.id;
  const idOf = (code) => project.markTypes.find((type) => type.code === code).id;
  const kitchen = addRoom(project, { name: "Кухня" });
  project = kitchen.project;
  const bath = addRoom(project, { name: "Санузел" });
  project = bath.project;

  // Ночник на кухне, выход канализации в санузле — один знак, разные категории.
  const night = addMark(project, { schemeId, typeId: idOf("Н"), kind: "point", points: [{ x: 0.2, y: 0.2 }] });
  project = night.project;
  project = updateMark(project, night.mark.id, { roomId: kitchen.room.id }).project;

  // Пока на схеме только ночник — совпадать нечему.
  assert.deepEqual(monoSameShapes(project, project.schemes[0], null), []);

  const drain = addMark(project, { schemeId, typeId: idOf("КН"), kind: "point", points: [{ x: 0.8, y: 0.8 }] });
  project = drain.project;
  project = updateMark(project, drain.mark.id, { roomId: bath.room.id }).project;
  const scheme = project.schemes[0];
  assert.deepEqual(
    monoSameShapes(project, scheme, null).map((group) => group.shape),
    ["circle-drain"],
    "на общем листе знаки совпали — об этом надо сказать",
  );

  // Лист одной комнаты: на нём только её метки, и совпадения на нём нет.
  assert.deepEqual(monoSameShapes(project, scheme, { roomId: kitchen.room.id }), []);
  assert.deepEqual(monoSameShapes(project, scheme, { roomId: bath.room.id }), []);
});

test("объект прежнего формата считается так же: вид типа выводится по меткам (G68)", () => {
  const { project, scheme } = monoFullSheet();
  // Так выглядел project.json до того, как у типа появился вид.
  const old = {
    ...project,
    formatVersion: 2,
    markTypes: project.markTypes.map((type) => {
      const copy = { ...type };
      delete copy.kind;
      delete copy.kindGuessed;
      return copy;
    }),
  };
  assert.deepEqual(
    monoSameShapes(old, scheme, null).map((group) => group.shape),
    monoSameShapes(project, scheme, null).map((group) => group.shape),
  );
});

test("без схемы и без объекта считать нечего", () => {
  const { project, scheme } = monoFullSheet();
  assert.deepEqual(monoSameShapes(null, scheme, null), []);
  assert.deepEqual(monoSameShapes(project, null, null), []);
});
