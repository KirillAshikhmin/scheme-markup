// Номера вместо uuid (требования G08–G11).
//
// Слова заказчика: «Давай переделаем метки на инкремент, начиная с 1, вместо
// UUID. При чем он постоянно увеличивается»; на вопрос «у чего» — «Всё, у чего
// есть id», «Свой у каждого объекта».
//
// Что проверяется здесь, а не глазами:
//
//   1. **Номер выдаётся из счётчика объекта и не выдаётся второй раз** (G09).
//      Дыра в номерах — то же сознательное решение, что у номеров меток: номер
//      удалённой сущности никому больше не достаётся.
//   2. **Новая сущность заводится номером**, а не uuid, — и это касается всех
//      видов сразу: метки, схемы, помещения, стены, проёма, вещи, типа,
//      сценария.
//   3. **Номера уникальны по всем видам**: ссылка на число не может попасть не
//      в ту коллекцию.
//   4. **`project.id`, `project.key` и `imageId` остались прежними** (G08.1) —
//      это ключи в хранилищах браузера, общих для **всех** объектов заказчика.
//      Два объекта с номером 1 затёрли бы друг друга.
//   5. **Перенумерация переписывает каждую ссылку и идемпотентна** (G11): это
//      дверь для миграции готовых объектов, и пропущенное место означало бы
//      объект, у которого розетка управляет чужим светильником.
import test from "node:test";
import assert from "node:assert/strict";

import {
  ID_COUNTER_KEY,
  addLogicBinding,
  addMark,
  addOpening,
  addRoom,
  addScenario,
  addScheme,
  addSchemeObject,
  addType,
  addWall,
  addSchemeObjectKind,
  createProject,
  deleteMark,
  deleteOpening,
  deleteSchemeObjectKind,
  deleteWall,
  findMark,
  findOpening,
  splitWall,
  idNumberOf,
  idsMigrate,
  idsReplace,
  nextId,
  nextIds,
  setMarkControls,
  setMarkDevice,
} from "../src/model.js";

const isNumbered = (id) => idNumberOf(id) !== null;

// Объект со схемой, помещением, стеной, проёмом и вещью чертежа.
function house() {
  let project = createProject({ name: "Номера" });
  const scheme = addScheme(project, { name: "1 этаж", width: 1000, height: 800 });
  project = scheme.project;
  const room = addRoom(project, "Кухня");
  project = room.project;
  const wall = addWall(project, {
    schemeId: scheme.scheme.id,
    aMm: { x: 0, y: 0 },
    bMm: { x: 4000, y: 0 },
    thicknessMm: 100,
  });
  project = wall.project;
  const opening = addOpening(project, {
    wallId: wall.wall.id,
    kind: "door",
    atMm: 500,
    widthMm: 900,
    heightMm: 2100,
  });
  project = opening.project;
  const object = addSchemeObject(project, {
    schemeId: scheme.scheme.id,
    catalogKey: "tv",
    atMm: { x: 2000, y: 200 },
    widthMm: 1240,
    depthMm: 80,
    heightMm: 720,
    heightAboveFloorMm: 500,
  });
  project = object.project;
  return {
    project,
    schemeId: scheme.scheme.id,
    roomId: room.room.id,
    wallId: wall.wall.id,
    openingId: opening.opening.id,
    objectId: object.schemeObject.id,
  };
}

function markAt(project, schemeId, typeCode, point) {
  const type = project.markTypes.find((item) => item.code === typeCode);
  return addMark(project, { schemeId, typeId: type.id, kind: "point", points: [point] });
}

// ——— счётчик ————————————————————————————————————————————————————————————

test("номер выдаётся из счётчика объекта и второй раз не достаётся никому", () => {
  const project = createProject({ name: "Счёт" });
  const was = project.counters[ID_COUNTER_KEY];
  assert.ok(was > 0, "у нового объекта не стоит счётчик номеров");

  const first = nextId(project);
  assert.equal(first.id, String(was + 1));
  assert.equal(first.project.counters[ID_COUNTER_KEY], was + 1);

  // Счётчик живёт в объекте: тот же объект даёт тот же номер, сдвинутый — следующий.
  assert.equal(nextId(project).id, first.id, "счётчик уехал мимо объекта");
  assert.equal(nextId(first.project).id, String(was + 2));

  // Пачкой — одна правка счётчика на всех.
  const batch = nextIds(first.project, 3);
  assert.deepEqual(batch.ids, [String(was + 2), String(was + 3), String(was + 4)]);
  assert.equal(batch.project.counters[ID_COUNTER_KEY], was + 4);
  assert.deepEqual(nextIds(project, 0).ids, []);
});

// **Правило проверяется у каждой двери, а не у одной.** Стоял этот тест только
// на `addMark` — единственном создателе, который счётчик и так закрепляет, —
// и был зелёным при нарушенном правиле: стена, проём, деление стены и вид вещи
// номер брали, а счётчик в патч не кладли, и после удаления он доставался
// второй сущности. Поэтому дверь здесь называется каждая поимённо: новая
// обязана попасть в список, а не проскочить мимо.
//
// `make` ставит сущность, `drop` её убирает — больше про дверь знать нечего.
const ID_DOORS = [
  {
    what: "метка",
    make: (project, scene) => {
      const added = markAt(project, scene.schemeId, "Р", { x: 0.2 + Math.random() / 4, y: 0.2 });
      return { project: added.project, id: added.mark.id };
    },
    drop: (project, id) => deleteMark(project, id).project,
  },
  {
    what: "стена",
    make: (project, scene) => {
      const added = addWall(project, {
        schemeId: scene.schemeId,
        aMm: { x: 0, y: 1000 },
        bMm: { x: 3000, y: 1000 },
        thicknessMm: 100,
      });
      return { project: added.project, id: added.wall.id };
    },
    drop: (project, id) => deleteWall(project, id).project,
  },
  {
    what: "проём",
    make: (project, scene) => {
      const added = addOpening(project, {
        wallId: scene.wallId,
        kind: "door",
        atMm: 1800,
        widthMm: 900,
        heightMm: 2100,
      });
      return { project: added.project, id: added.opening.id };
    },
    drop: (project, id) => deleteOpening(project, id).project,
  },
  {
    // Делится **своя** стена, а не стена сцены: у той проём на 500…1400, и
    // второй отрез пришёлся бы по нему. Номеров такая правка тратит два —
    // стену и её половину, — и об этом сказано `cost`.
    what: "деление стены",
    cost: 2,
    make: (project, scene, attempt) => {
      const fresh = addWall(project, {
        schemeId: scene.schemeId,
        aMm: { x: 0, y: 2000 + attempt * 500 },
        bMm: { x: 3000, y: 2000 + attempt * 500 },
        thicknessMm: 100,
      });
      const split = splitWall(fresh.project, fresh.wall.id, 1500);
      return { project: split.project, id: split.second.id };
    },
    drop: (project, id) => deleteWall(project, id).project,
  },
  {
    what: "вид вещи",
    make: (project) => {
      const added = addSchemeObjectKind(project, { name: "Вид " + Math.random() });
      return { project: added.project, id: added.schemeObjectKind.id };
    },
    drop: (project, id) => deleteSchemeObjectKind(project, id).project,
  },
];

test("удаление не возвращает номер в оборот — ни у одной двери (G09)", () => {
  for (const door of ID_DOORS) {
    const scene = house();
    const first = door.make(scene.project, scene, 0);
    // Счётчик закреплён **в объекте**, а не только в кассе правки: иначе
    // `idFloor` прикрывал бы выдачу лишь до тех пор, пока сущность жива.
    assert.equal(
      first.project.counters[ID_COUNTER_KEY],
      idNumberOf(first.id),
      door.what + ": счётчик объекта отстал от выданного номера",
    );
    const gone = door.drop(first.project, first.id);
    const second = door.make(gone, scene, 1);
    assert.notEqual(second.id, first.id, door.what + ": номер удалённой сущности достался новой");
    assert.equal(
      idNumberOf(second.id),
      idNumberOf(first.id) + (door.cost || 1),
      door.what + ": номер выдан не следующим",
    );
  }
});

test("датчик открытия не пересаживается на другую дверь: номер удалённого проёма свободным не становится", () => {
  const scene = house();
  const first = addOpening(scene.project, {
    wallId: scene.wallId,
    kind: "door",
    atMm: 1800,
    widthMm: 900,
    heightMm: 2100,
  });
  // Метка «Датчик открытия» смотрит на этот проём своей настройкой аксессуара.
  const sensor = markAt(first.project, scene.schemeId, "ДО", { x: 0.45, y: 0.05 });
  const bound = setMarkDevice(sensor.project, sensor.mark.id, { doorId: first.opening.id });
  // Дверь датчика — **место метки, а не аксессуар**, и в профиле её нет: она
  // лежит в записи метки, и оттуда её читает дом (`sim/home.js: markDoorOf`).
  const doorOf = (project) => findMark(project, sensor.mark.id).device.doorId;
  assert.equal(doorOf(bound.project), first.opening.id);

  // Проём удалили. Ссылку `deleteOpening` не чистит нарочно — она у метки, и
  // метка остаётся на месте; дверь при этом **не находится**.
  const gone = deleteOpening(bound.project, first.opening.id);
  assert.equal(findOpening(gone.project, first.opening.id), null);

  // Поставили другую дверь. Её номер обязан быть новым: достанься ей номер
  // удалённой, и датчик молча стал бы датчиком **этой** двери — дом поехал бы
  // на другой проём, и никто бы об этом не узнал.
  const second = addOpening(gone.project, {
    wallId: scene.wallId,
    kind: "door",
    atMm: 2800,
    widthMm: 900,
    heightMm: 2100,
  });
  assert.notEqual(second.opening.id, first.opening.id, "новый проём занял номер удалённого");
  assert.equal(doorOf(second.project), first.opening.id, "ссылка метки поехала сама");
  assert.equal(findOpening(second.project, doorOf(second.project)), null, "датчик пересел на другую дверь");
});

test("номер — это номер, и `idNumberOf` не принимает похожее", () => {
  assert.equal(idNumberOf("17"), 17);
  assert.equal(idNumberOf(17), 17);
  for (const value of ["0", "01", " 17 ", "17px", "1e3", "-1", "", null, undefined, "comment", {}]) {
    assert.equal(idNumberOf(value), null, "принят не номер: " + String(value));
  }
});

// ——— новые сущности ————————————————————————————————————————————————————

test("новая сущность заводится номером: метка, схема, помещение, стена, проём, вещь, тип, сценарий", () => {
  const scene = house();
  const mark = markAt(scene.project, scene.schemeId, "В", { x: 0.5, y: 0.5 });
  const type = addType(mark.project, { code: "ЭКС", name: "Экспериментальный", categoryId: scene.project.categories[0].id });
  const scenario = addScenario(type.project, { kind: "logic", name: "Логика" });
  const binding = addLogicBinding(scenario.project, { scenarioId: scenario.scenario.id, markId: mark.mark.id });

  const named = {
    схема: scene.schemeId,
    помещение: scene.roomId,
    стена: scene.wallId,
    проём: scene.openingId,
    вещь: scene.objectId,
    метка: mark.mark.id,
    тип: type.type.id,
    сценарий: scenario.scenario.id,
    привязка: binding.binding.id,
  };
  for (const [what, id] of Object.entries(named)) {
    assert.ok(isNumbered(id), what + " заведена не номером: " + id);
  }
  // И ни одного uuid во всём объекте, кроме названных исключений.
  const text = JSON.stringify(binding.project);
  assert.equal(
    (text.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g) || []).length,
    2,
    "в объекте остались uuid, кроме `id` и `key` самого объекта",
  );
});

test("номера уникальны по всем видам сразу", () => {
  const scene = house();
  let project = markAt(scene.project, scene.schemeId, "Т", { x: 0.1, y: 0.1 }).project;
  project = markAt(project, scene.schemeId, "Т", { x: 0.2, y: 0.2 }).project;
  const ids = [];
  for (const entity of [
    "categories",
    "markTypes",
    "rooms",
    "schemes",
    "marks",
    "groups",
    "walls",
    "openings",
    "schemeObjects",
    "equipmentTypes",
  ]) {
    for (const item of project[entity] || []) ids.push(item.id);
  }
  assert.equal(new Set(ids).size, ids.length, "один номер занят дважды");
  assert.deepEqual(ids.filter((id) => !isNumbered(id)), [], "в номерах остался не номер");
  // Счётчик не отстаёт от занятого: иначе следующий номер лёг бы поверх чужого.
  assert.ok(project.counters[ID_COUNTER_KEY] >= Math.max(...ids.map(idNumberOf)));
});

// ——— исключение: ключи хранилищ (G08.1) ————————————————————————————————

test("`project.id`, `key` и `imageId` остались прежними — два объекта в одном браузере не сталкиваются", () => {
  const first = createProject({ name: "Первый" });
  const second = createProject({ name: "Второй" });
  // Ключи хранилищ — не номера: номер 1 в двух объектах затёр бы один снимок
  // другим, а картинки — чужие подложки.
  for (const id of [first.id, first.key, second.id, second.key]) {
    assert.equal(idNumberOf(id), null, "ключ хранилища стал номером: " + id);
  }
  assert.notEqual(first.id, second.id);
  assert.notEqual(first.key, second.key);

  // А номера справочника у них совпадают — счётчик живёт в объекте (G08,
  // «Свой у каждого объекта»), и это решение, а не промах.
  assert.deepEqual(first.markTypes.map((type) => type.id), second.markTypes.map((type) => type.id));

  // `imageId` схемы — то, что ей дали: модель его не выдумывает и номером не
  // подменяет.
  const added = addScheme(first, { name: "1 этаж", imageId: "img-" + first.id, width: 10, height: 10 });
  assert.equal(added.scheme.imageId, "img-" + first.id);
  assert.ok(isNumbered(added.scheme.id), "схема заведена не номером");
});

// ——— перенумерация (G11) —————————————————————————————————————————————

// Объект поры uuid: ни одного номера, зато все ссылки на месте.
function uuidBuild() {
  const scene = house();
  let project = scene.project;
  const lamp = markAt(project, scene.schemeId, "Т", { x: 0.3, y: 0.3 });
  project = lamp.project;
  const switcher = markAt(project, scene.schemeId, "В", { x: 0.4, y: 0.4 });
  project = switcher.project;
  project = setMarkControls(project, switcher.mark.id, [lamp.mark.id]).project;
  project = setMarkDevice(project, lamp.mark.id, { kind: "lightOnOff" }).project;
  const scenario = addScenario(project, { kind: "block", name: "Свет по датчику" });
  project = scenario.project;
  // Блочный сценарий ссылается на метку из глубины дерева.
  project = {
    ...project,
    scenarios: project.scenarios.map((item) =>
      item.id === scenario.scenario.id
        ? { ...item, targets: [{ type: "if", blocks: [{ type: "act", markId: lamp.mark.id, service: 0 }] }] }
        : item,
    ),
  };
  const binding = addScenario(project, { kind: "logic", name: "Логика" });
  project = addLogicBinding(binding.project, { scenarioId: binding.scenario.id, markId: switcher.mark.id }).project;

  // Переводим всё в uuid-подобные строки — объект «до номеров».
  const was = new Map();
  for (const entity of [
    "categories",
    "markTypes",
    "rooms",
    "schemes",
    "marks",
    "groups",
    "walls",
    "openings",
    "schemeObjects",
    "equipmentTypes",
    "scenarios",
    "logicBindings",
  ]) {
    for (const item of project[entity] || []) was.set(item.id, "old-" + item.id);
  }
  const old = idsReplace(project, was).project;
  delete old.counters[ID_COUNTER_KEY];
  return { project: old, lampId: "old-" + lamp.mark.id, switchId: "old-" + switcher.mark.id };
}

test("перенумерация: метки получают 1…N, и каждая ссылка переписана", () => {
  const before = uuidBuild();
  const after = idsMigrate(before.project);
  assert.equal(after.changed, true);

  // Метки — первой коллекцией: заказчик просил «начиная с 1».
  assert.deepEqual(
    after.project.marks.map((mark) => mark.id),
    after.project.marks.map((mark, index) => String(index + 1)),
    "метки получили не 1…N подряд",
  );

  const lamp = after.project.marks.find((mark) => mark.device);
  const switcher = after.project.marks.find((mark) => (mark.controls || []).length > 0);
  assert.ok(lamp && switcher, "метки потерялись при перенумерации");
  // Связь «чем управляет» смотрит на новый номер светильника.
  assert.deepEqual(switcher.controls, [lamp.id]);
  // Схема, тип, помещение, стена, вещь — все ссылки переписаны и все живые.
  for (const mark of after.project.marks) {
    assert.ok(after.project.schemes.some((scheme) => scheme.id === mark.schemeId), "метка осталась без схемы");
    assert.ok(after.project.markTypes.some((type) => type.id === mark.typeId), "метка осталась без типа");
  }
  assert.ok(after.project.walls.every((wall) => after.project.schemes.some((scheme) => scheme.id === wall.schemeId)));
  assert.ok(after.project.openings.every((hole) => after.project.walls.some((wall) => wall.id === hole.wallId)));
  assert.ok(
    after.project.schemeObjects.every((object) => after.project.schemes.some((scheme) => scheme.id === object.schemeId)),
  );
  assert.ok(after.project.markTypes.every((type) => after.project.categories.some((one) => one.id === type.categoryId)));
  // Блок сценария и привязка логики — тоже.
  const block = after.project.scenarios.find((item) => item.kind === "block");
  assert.equal(block.targets[0].blocks[0].markId, lamp.id, "блок сценария смотрит в пустоту");
  const binding = after.project.logicBindings[0];
  assert.ok(after.project.marks.some((mark) => mark.id === binding.markId), "привязка логики смотрит в пустоту");
  assert.ok(after.project.scenarios.some((item) => item.id === binding.scenarioId));
  // Ни одного прежнего идентификатора нигде.
  assert.equal(JSON.stringify(after.project).includes("old-"), false, "прежний идентификатор где-то остался");
  // Счётчик доведён до последнего выданного номера.
  assert.equal(after.project.counters[ID_COUNTER_KEY], after.renumbered);
});

test("перенумерация идемпотентна: второе открытие даёт тот же объект", () => {
  const once = idsMigrate(uuidBuild().project);
  const twice = idsMigrate(once.project);
  assert.equal(twice.changed, false, "вторая перенумерация переписала объект");
  assert.equal(twice.project, once.project, "вернулся не тот же объект по ссылке");
  // И у объекта, который уже пронумерован с рождения, менять нечего.
  const fresh = createProject({ name: "Свежий" });
  assert.equal(idsMigrate(fresh).project, fresh);
});

test("перенумерация не трогает ключи хранилищ и встроенный тип комментария", () => {
  const before = uuidBuild();
  const comment = addMark(before.project, {
    schemeId: before.project.schemes[0].id,
    typeId: "comment",
    kind: "comment",
    points: [{ x: 0.6, y: 0.6 }],
  });
  const after = idsMigrate(comment.project);
  assert.equal(after.project.id, before.project.id, "перенумерация тронула ключ объекта");
  assert.equal(after.project.key, before.project.key, "перенумерация тронула постоянный ключ");
  // Встроенного типа в справочнике нет, и его зарезервированный идентификатор
  // проходит насквозь: иначе плашки потеряли бы тип.
  const plate = after.project.marks.find((mark) => mark.kind === "comment");
  assert.equal(plate.typeId, "comment");
});

test("поимённый переезд номера переписывает ссылки и ничего больше", () => {
  const scene = house();
  const lamp = markAt(scene.project, scene.schemeId, "Т", { x: 0.3, y: 0.3 });
  const switcher = markAt(lamp.project, scene.schemeId, "В", { x: 0.4, y: 0.4 });
  const linked = setMarkControls(switcher.project, switcher.mark.id, [lamp.mark.id]).project;

  const moved = idsReplace(linked, { [lamp.mark.id]: "9001" });
  assert.equal(moved.changed, true);
  assert.equal(findMark(moved.project, lamp.mark.id), null, "метка осталась на прежнем номере");
  assert.ok(findMark(moved.project, "9001"), "метка не переехала");
  assert.deepEqual(findMark(moved.project, switcher.mark.id).controls, ["9001"], "связь осталась в пустоте");
  // Переселять нечего — тот же объект по ссылке.
  assert.equal(idsReplace(linked, {}).project, linked);
  assert.equal(idsReplace(linked, { [lamp.mark.id]: lamp.mark.id }).project, linked);
});
