// Номера вместо uuid, **свой счётчик у каждого вида** (требования G08–G11,
// G391; ADR 030, 034–036, 038).
//
// Слова заказчика: «Давай переделаем метки на инкремент, начиная с 1, вместо
// UUID. При чем он постоянно увеличивается»; на вопрос «у чего» — «Всё, у чего
// есть id», «Свой у каждого объекта». И поправка таска 251, когда он прочёл,
// что на новом объекте первая метка получает №117:
//
//     «в смысле я так сказал? у каждого свои идентификаторы. У типов свои, у
//     меток свои, у помещений свои, и все инкремент. Справочник не должен
//     пересекаться с готовыми митками, это же бред».
//
// Про пересечение номеров между видами он сказал отдельно, и это снимает
// главный страх прежней сборки:
//
//     «метка №5 и помещение №5 будут жить в одном объекте — это же нормально.
//     И мы же не только по идентификатору определяем что имеется ввиду, а по
//     объекту целиком».
//
// Что проверяется здесь, а не глазами:
//
//   1. **Первая метка нового объекта — №1**, и двести типов справочника её не
//      касаются (G391).
//   2. **Счётчик вида не меньше выданного — после любой команды** (G09). Это
//      критерий, а не перечень случаев: двери берутся из `ID_OWNER_KEYS`
//      модели, и вид без двери роняет прогон. Прежний список вёлся руками,
//      отстал на двенадцать коллекций и был зелёным при нарушенном правиле.
//   3. **Номер удалённой сущности не достаётся новой в своём виде**.
//   4. **Пересечение номеров между видами не ломает ни одной ссылки**.
//   5. **`project.id`, `project.key` и `imageId` остались прежними** (G08.1) —
//      это ключи в хранилищах браузера, общих для **всех** объектов заказчика.
//   6. **Перенумерация переписывает каждую ссылку и идемпотентна** (G11): это
//      дверь для миграции готовых объектов, и пропущенное место означало бы
//      объект, у которого розетка управляет чужим светильником.
//   7. **Вид числа назван, а не угадан** — у ключей принятых предупреждений
//      (`ID_KEY_PROBLEM_CODES` против словаря) и у таблиц переездов.
import test from "node:test";
import assert from "node:assert/strict";

import {
  ID_COUNTER_SHARED_KEY,
  ID_KEY_PROBLEM_CODES,
  ID_OWNER_KEYS,
  acceptProblem,
  acceptedProblems,
  addCategory,
  addEquipment,
  addEquipmentType,
  addLogicBinding,
  addMark,
  addOpening,
  addOutline,
  addPlacement,
  addRoom,
  addScenario,
  addScheme,
  addSchemeGuide,
  addSchemeObject,
  addSchemeObjectKind,
  addToGroup,
  addType,
  addWall,
  createProject,
  deleteCategory,
  deleteEquipment,
  deleteEquipmentType,
  deleteLogicBinding,
  deleteMark,
  deleteOpening,
  deleteOutline,
  deletePlacement,
  deleteRoom,
  deleteScenario,
  deleteScheme,
  deleteSchemeGuide,
  deleteSchemeObject,
  deleteSchemeObjectKind,
  deleteType,
  deleteWall,
  findMark,
  findOpening,
  findRoom,
  findScenario,
  idCounterKey,
  idNumberOf,
  idsMigrate,
  idsReplace,
  nextId,
  nextIds,
  problemAccepted,
  setMarkControls,
  setMarkDevice,
  setMarkNumber,
  splitWall,
  validate,
} from "../src/model.js";
import { strings } from "../src/strings.js";

const isNumbered = (id) => idNumberOf(id) !== null;
const counterOf = (project, collection) => Number(project.counters[idCounterKey(collection)]) || 0;

// Сущности вида — своим обходом: направляющие лежат внутри схем, остальные
// коллекцией верхнего уровня.
function listOf(project, collection) {
  return collection === "guides"
    ? (project.schemes || []).flatMap((scheme) => scheme.guides || [])
    : project[collection] || [];
}

// Самый большой занятый номер вида — считается здесь своим обходом, а не
// дверью модели: иначе критерий сверялся бы сам с собой.
function topOf(project, collection) {
  const list = listOf(project, collection);
  let top = 0;
  for (const item of list) {
    const number = idNumberOf(item && item.id);
    if (number !== null && number > top) top = number;
  }
  return top;
}

// Критерий из тикета: **после любой команды счётчик вида не меньше выданного**.
// Проверяется у всех видов разом — промахнись команда видом, и счётчик чужого
// вида отстал бы от своих номеров.
function assertCounters(project, what) {
  for (const collection of ID_OWNER_KEYS) {
    const top = topOf(project, collection);
    if (top === 0) continue;
    assert.ok(
      counterOf(project, collection) >= top,
      what + ": счётчик вида «" + collection + "» отстал от выданного номера (" + counterOf(project, collection) + " < " + top + ")",
    );
  }
}

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

// ——— первая метка нового объекта (G391) ——————————————————————————————————

test("на новом объекте первая метка — №1, и двести типов справочника её не касаются", () => {
  const scene = house();
  assert.ok(scene.project.markTypes.length > 40, "пример не тот: справочник пуст");
  const first = markAt(scene.project, scene.schemeId, "Р", { x: 0.2, y: 0.2 });
  assert.equal(first.mark.id, "1", "первая метка получила не №1");
  const second = markAt(first.project, scene.schemeId, "Р", { x: 0.3, y: 0.2 });
  assert.equal(second.mark.id, "2");
  // Каждый вид считает со своей единицы, и справочник меток не съедает.
  assert.equal(scene.project.categories[0].id, "1");
  assert.equal(scene.project.markTypes[0].id, "1");
  assert.equal(scene.roomId, "1");
  assert.equal(scene.schemeId, "1");
  assert.equal(scene.wallId, "1");
  assert.equal(scene.openingId, "1");
  // Общего счётчика в объекте не осталось ни одного (ADR 038).
  assert.equal(
    Object.prototype.hasOwnProperty.call(second.project.counters, ID_COUNTER_SHARED_KEY),
    false,
    "в объекте остался общий счётчик",
  );
});

// ——— счётчик ————————————————————————————————————————————————————————————

test("номер выдаётся из счётчика своего вида и второй раз не достаётся никому", () => {
  const project = createProject({ name: "Счёт" });
  const was = counterOf(project, "markTypes");
  assert.ok(was > 0, "у нового объекта не стоит счётчик типов");
  assert.equal(counterOf(project, "marks"), 0, "у объекта без меток завёлся счётчик меток");

  const first = nextId(project, "markTypes");
  assert.equal(first.id, String(was + 1));
  assert.equal(counterOf(first.project, "markTypes"), was + 1);
  // Счётчик соседнего вида при этом не двинулся.
  assert.equal(counterOf(first.project, "marks"), 0, "выдача номера типа тронула счётчик меток");
  assert.equal(nextId(project, "marks").id, "1", "метка взяла номер из счётчика типов");

  // Счётчик живёт в объекте: тот же объект даёт тот же номер, сдвинутый — следующий.
  assert.equal(nextId(project, "markTypes").id, first.id, "счётчик уехал мимо объекта");
  assert.equal(nextId(first.project, "markTypes").id, String(was + 2));

  // Пачкой — одна правка счётчика на всех.
  const batch = nextIds(first.project, "markTypes", 3);
  assert.deepEqual(batch.ids, [String(was + 2), String(was + 3), String(was + 4)]);
  assert.equal(counterOf(batch.project, "markTypes"), was + 4);
  assert.deepEqual(nextIds(project, "marks", 0).ids, []);
});

// **Правило проверяется у каждого вида, а не у одного.** Двери называются
// поимённо, а полнота списка держится сверкой с `ID_OWNER_KEYS`: завелась новая
// коллекция — её дверь обязана попасть сюда, иначе прогон краснеет.
//
// Входные данные **постоянные**: прежний список брал их у `Math.random()`, и
// упавший прогон не повторялся.
const ID_DOORS = [
  {
    what: "marks",
    make: (project, scene, attempt) => {
      const added = markAt(project, scene.schemeId, "Р", { x: 0.2 + attempt / 20, y: 0.2 });
      return { project: added.project, id: added.mark.id };
    },
    drop: (project, id) => deleteMark(project, id).project,
  },
  {
    // Блок из трёх точек тратит три номера меток и один номер группы.
    what: "groups",
    cost: 1,
    make: (project, scene, attempt) => {
      const type = project.markTypes.find((item) => item.code === "Р");
      const added = addMark(project, {
        schemeId: scene.schemeId,
        typeId: type.id,
        kind: "point",
        points: [
          { x: 0.3 + attempt / 20, y: 0.4 },
          { x: 0.32 + attempt / 20, y: 0.4 },
        ],
      });
      return { project: added.project, id: added.group.id };
    },
    drop: (project, id, project0) => {
      const group = project.groups.find((item) => item.id === id);
      let next = project;
      for (const markId of [...group.markIds]) next = deleteMark(next, markId).project;
      return next;
    },
  },
  {
    what: "outlines",
    make: (project, scene, attempt) => {
      const added = addOutline(project, {
        schemeId: scene.schemeId,
        roomId: scene.roomId,
        points: [
          { x: 0.1, y: 0.1 + attempt / 20 },
          { x: 0.4, y: 0.1 + attempt / 20 },
          { x: 0.4, y: 0.3 + attempt / 20 },
          { x: 0.1, y: 0.3 + attempt / 20 },
        ],
      });
      return { project: added.project, id: added.outline.id };
    },
    drop: (project, id) => deleteOutline(project, id).project,
  },
  {
    what: "schemes",
    make: (project, scene, attempt) => {
      const added = addScheme(project, { name: "Этаж " + attempt, width: 1000, height: 800 });
      return { project: added.project, id: added.scheme.id };
    },
    drop: (project, id) => deleteScheme(project, id).project,
  },
  {
    what: "guides",
    make: (project, scene, attempt) => {
      const added = addSchemeGuide(project, scene.schemeId, { axis: "h", at: 0.2 + attempt / 20 });
      return { project: added.project, id: added.guide.id };
    },
    drop: (project, id, scene) => deleteSchemeGuide(project, scene.schemeId, id).project,
  },
  {
    what: "rooms",
    make: (project, scene, attempt) => {
      const added = addRoom(project, "Комната " + attempt);
      return { project: added.project, id: added.room.id };
    },
    drop: (project, id) => deleteRoom(project, id).project,
  },
  {
    what: "categories",
    make: (project, scene, attempt) => {
      const added = addCategory(project, { name: "Категория " + attempt, color: "#123456", shape: "circle" });
      return { project: added.project, id: added.category.id };
    },
    drop: (project, id) => deleteCategory(project, id).project,
  },
  {
    what: "markTypes",
    make: (project, scene, attempt) => {
      const added = addType(project, {
        code: "ЭКС" + "Я".repeat(attempt),
        name: "Экспериментальный " + attempt,
        categoryId: project.categories[0].id,
      });
      return { project: added.project, id: added.type.id };
    },
    drop: (project, id) => deleteType(project, id).project,
  },
  {
    what: "walls",
    make: (project, scene, attempt) => {
      const added = addWall(project, {
        schemeId: scene.schemeId,
        aMm: { x: 0, y: 1000 + attempt * 500 },
        bMm: { x: 3000, y: 1000 + attempt * 500 },
        thicknessMm: 100,
      });
      return { project: added.project, id: added.wall.id };
    },
    drop: (project, id) => deleteWall(project, id).project,
  },
  {
    // Делится **своя** стена, а не стена сцены: у той проём на 500…1400, и
    // второй отрез пришёлся бы по нему. Номеров такая правка тратит два —
    // стену и её половину, — и об этом сказано `cost`.
    what: "walls (деление)",
    collection: "walls",
    cost: 2,
    make: (project, scene, attempt) => {
      const fresh = addWall(project, {
        schemeId: scene.schemeId,
        aMm: { x: 0, y: 4000 + attempt * 500 },
        bMm: { x: 3000, y: 4000 + attempt * 500 },
        thicknessMm: 100,
      });
      const split = splitWall(fresh.project, fresh.wall.id, 1500);
      return { project: split.project, id: split.second.id };
    },
    drop: (project, id) => deleteWall(project, id).project,
  },
  {
    what: "openings",
    make: (project, scene, attempt) => {
      const added = addOpening(project, {
        wallId: scene.wallId,
        kind: "door",
        atMm: 1800 + attempt * 1000,
        widthMm: 900,
        heightMm: 2100,
      });
      return { project: added.project, id: added.opening.id };
    },
    drop: (project, id) => deleteOpening(project, id).project,
  },
  {
    what: "schemeObjects",
    make: (project, scene, attempt) => {
      const added = addSchemeObject(project, {
        schemeId: scene.schemeId,
        catalogKey: "tv",
        atMm: { x: 2000, y: 1200 + attempt * 500 },
        widthMm: 1240,
        depthMm: 80,
        heightMm: 720,
        heightAboveFloorMm: 500,
      });
      return { project: added.project, id: added.schemeObject.id };
    },
    drop: (project, id) => deleteSchemeObject(project, id).project,
  },
  {
    what: "schemeObjectKinds",
    make: (project, scene, attempt) => {
      const added = addSchemeObjectKind(project, { name: "Вид " + attempt });
      return { project: added.project, id: added.schemeObjectKind.id };
    },
    drop: (project, id) => deleteSchemeObjectKind(project, id).project,
  },
  {
    what: "equipmentTypes",
    make: (project, scene, attempt) => {
      const added = addEquipmentType(project, { name: "Тип оборудования " + attempt });
      return { project: added.project, id: added.equipmentType.id };
    },
    drop: (project, id) => deleteEquipmentType(project, id).project,
  },
  {
    what: "equipment",
    make: (project, scene, attempt) => {
      const added = addEquipment(project, { name: "Прибор " + attempt, vendor: "V", code: "C" + attempt });
      return { project: added.project, id: added.equipment.id };
    },
    drop: (project, id) => deleteEquipment(project, id).project,
  },
  {
    what: "placements",
    make: (project, scene, attempt) => {
      const gear = addEquipment(project, { name: "Прибор под место " + attempt });
      const mark = markAt(gear.project, scene.schemeId, "Т", { x: 0.6 + attempt / 20, y: 0.6 });
      const added = addPlacement(mark.project, { equipmentId: gear.equipment.id, markId: mark.mark.id });
      return { project: added.project, id: added.placement.id };
    },
    drop: (project, id) => deletePlacement(project, id).project,
  },
  {
    what: "scenarios",
    make: (project, scene, attempt) => {
      const added = addScenario(project, { kind: "logic", name: "Логика " + attempt });
      return { project: added.project, id: added.scenario.id };
    },
    drop: (project, id) => deleteScenario(project, id).project,
  },
  {
    what: "logicBindings",
    make: (project, scene, attempt) => {
      const scenario = addScenario(project, { kind: "logic", name: "Привязанная логика " + attempt });
      const mark = markAt(scenario.project, scene.schemeId, "Т", { x: 0.7 + attempt / 20, y: 0.7 });
      const added = addLogicBinding(mark.project, { scenarioId: scenario.scenario.id, markId: mark.mark.id });
      return { project: added.project, id: added.binding.id };
    },
    drop: (project, id) => deleteLogicBinding(project, id).project,
  },
];

test("дверь есть у каждого вида: список не ведётся руками", () => {
  const covered = new Set(ID_DOORS.map((door) => door.collection || door.what));
  assert.deepEqual(
    ID_OWNER_KEYS.filter((key) => !covered.has(key)),
    [],
    "у вида нет двери в тесте — его счётчик никто не проверяет",
  );
  assert.deepEqual(
    [...covered].filter((key) => !ID_OWNER_KEYS.includes(key)),
    [],
    "в тесте названа коллекция, которой нет в `ID_OWNER_KEYS`",
  );
});

test("после любой команды счётчик вида не меньше выданного, и удаление номер не возвращает (G09)", () => {
  for (const door of ID_DOORS) {
    const collection = door.collection || door.what;
    const scene = house();
    assertCounters(scene.project, "новый объект");

    const first = door.make(scene.project, scene, 0);
    assertCounters(first.project, door.what);
    // Счётчик закреплён **в объекте**, а не только в кассе правки: иначе
    // занятый номер прикрывал бы выдачу лишь до тех пор, пока сущность жива.
    assert.equal(
      counterOf(first.project, collection),
      idNumberOf(first.id),
      door.what + ": счётчик вида отстал от выданного номера",
    );

    const gone = door.drop(first.project, first.id, scene);
    assertCounters(gone, door.what + " после удаления");
    const second = door.make(gone, scene, 1);
    assertCounters(second.project, door.what + " после второй постановки");
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

// **Счётчик прикрывает номер, пока сущность жива; занятый номер — пока она
// есть.** Счётчик теряется: объект собран руками, пришёл ссылкой без
// `counters`, слит из двух. Выдать номер поверх занятого — значит сшить две
// разные сущности в одну, самая дорогая из поломок (`idFloors` в модели), и
// проверяется это у **каждой** двери: промахнись одна видом или не спроси
// занятый номер — новая сущность встала бы поверх живой.
test("счётчики потеряны — ни одна дверь не выдаёт номер поверх занятого", () => {
  for (const door of ID_DOORS) {
    const collection = door.collection || door.what;
    const scene = house();
    const first = door.make(scene.project, scene, 0);
    const top = topOf(first.project, collection);
    assert.ok(top > 0, door.what + ": пример не тот, занятых номеров нет");

    // Объект без счётчиков — так он приходит собранным руками и слитым.
    const lost = { ...first.project, counters: {} };
    const second = door.make(lost, scene, 1);
    assert.ok(
      idNumberOf(second.id) > top,
      door.what + ": номер выдан поверх занятого (" + second.id + " при занятом " + top + ")",
    );
    // И ни одного номера, занятого дважды: сущности не сшились.
    const ids = listOf(second.project, collection).map((item) => item.id);
    assert.equal(new Set(ids).size, ids.length, door.what + ": один номер достался двум сущностям");
    // Счётчик своего вида при этом встал на выданное — второй раз этот номер
    // не выйдет. Соседние виды остаются без счётчиков нарочно: команда правит
    // счётчик только своего вида, и это её право.
    assert.ok(
      counterOf(second.project, collection) >= idNumberOf(second.id),
      door.what + ": счётчик вида не догнал выданный номер",
    );
  }
});

// Свой идентификатор вызывающего принимается **только** свободным номером
// (ADR 038) — и обязан пройти через счётчик своего вида. Прими его молча, и
// счётчик останется позади: занятый номер прикрывает выдачу лишь пока сценарий
// жив, а удалённый из обхода уходит — номер выдаётся второй раз, и ссылка
// «запусти сценарий», которую `deleteScenario` не чистит нарочно, оживает
// чужим сценарием молча. Живых вызовов с `id` нет ни одного: это защита.
test("принятый снаружи номер сценария двигает счётчик своего вида", () => {
  const project = createProject({ name: "Сценарии" });
  assert.equal(counterOf(project, "scenarios"), 0, "пример не тот: у нового объекта есть сценарии");

  const taken = addScenario(project, { kind: "logic", name: "Своя логика", id: "9001" });
  assert.equal(taken.scenario.id, "9001", "свободный номер не принят");
  assert.equal(counterOf(taken.project, "scenarios"), 9001, "счётчик вида остался позади принятого номера");
  assertCounters(taken.project, "сценарий с принятым номером");

  // Номер удалённого сценария новому не достаётся — это и есть цена молчания:
  // ссылка на удалённый сценарий осталась бы в объекте и ожила бы новым.
  const gone = deleteScenario(taken.project, "9001").project;
  const next = addScenario(gone, { kind: "logic", name: "Следующая" });
  assert.equal(next.scenario.id, "9002", "номер удалённого сценария достался новому");
  assert.equal(findScenario(next.project, "9001"), null, "ссылка в никуда ожила новым сценарием");

  // Занятый номер в дверь не проходит: выдаётся свой, следующий по счётчику.
  const twin = addScenario(taken.project, { kind: "logic", name: "Двойник", id: "9001" });
  assert.equal(twin.scenario.id, "9002", "принят занятый номер");

  // И не номер — тоже: uuid прежней разметки сделал бы объект
  // непронумерованным по видам, а следующее открытие перенумеровало бы его
  // целиком, сдвинув адреса аксессуаров у всех меток.
  for (const bad of ["s1", "0", "01", "acts", "7b1e2f3c-0000-4000-8000-0123456789ab", 17, " 9002 "]) {
    const made = addScenario(taken.project, { kind: "logic", name: "Чужой id", id: bad });
    assert.equal(made.scenario.id, "9002", "в дверь прошёл не номер: " + String(bad));
    assertCounters(made.project, "сценарий с чужим id");
  }
});

test("номер — это номер, и `idNumberOf` не принимает похожее", () => {
  assert.equal(idNumberOf("17"), 17);
  // **Число идентификатором не считается** (D01, ADR 035; G392, когда дверь
  // адреса аксессуара была снята в пользу этой): прими здесь `17` — и `17` с
  // `"17"` дали бы один адрес аксессуара, а второй аксессуар того же адреса
  // хаб молча потерял бы (`byAid` в `hubApi`).
  assert.equal(idNumberOf(17), null);
  for (const value of ["0", "01", " 17 ", "17px", "1e3", "-1", "", null, undefined, "comment", {}, 0, -1, 1.5]) {
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

test("номера пересекаются между видами — и ни одна ссылка от этого не ломается", () => {
  const scene = house();
  let project = markAt(scene.project, scene.schemeId, "Т", { x: 0.1, y: 0.1 }).project;
  project = markAt(project, scene.schemeId, "Т", { x: 0.2, y: 0.2 }).project;

  // Пересечение — обычное состояние: у метки, помещения, схемы, стены и проёма
  // в этом объекте номер 1 занят у каждого.
  const crossing = ["marks", "rooms", "schemes", "walls", "openings"].map((key) => project[key][0].id);
  assert.deepEqual(crossing, ["1", "1", "1", "1", "1"], "пример не тот: номера разошлись сами");

  // Внутри своего вида номер по-прежнему один.
  for (const collection of ID_OWNER_KEYS) {
    const list = collection === "guides" ? [] : project[collection] || [];
    const ids = list.map((item) => item.id);
    assert.equal(new Set(ids).size, ids.length, collection + ": один номер занят дважды");
    assert.deepEqual(ids.filter((id) => !isNumbered(id)), [], collection + ": в номерах остался не номер");
  }

  // И каждая ссылка ведёт в свой вид, а не в чужой с тем же числом.
  for (const mark of project.marks) {
    assert.ok(project.schemes.some((scheme) => scheme.id === mark.schemeId), "метка осталась без схемы");
    assert.ok(project.markTypes.some((type) => type.id === mark.typeId), "метка осталась без типа");
  }
  assert.ok(project.openings.every((hole) => project.walls.some((wall) => wall.id === hole.wallId)));
  assert.ok(project.walls.every((wall) => project.schemes.some((scheme) => scheme.id === wall.schemeId)));
  assertCounters(project, "объект с пересечениями");
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
    const table = new Map();
    for (const item of project[entity] || []) table.set(item.id, "old-" + entity + "-" + item.id);
    if (table.size > 0) was.set(entity, table);
  }
  const old = idsReplace(project, was).project;
  old.counters = Object.fromEntries(Object.entries(old.counters).filter(([key]) => !key.startsWith("#")));
  return {
    project: old,
    lampId: "old-marks-" + lamp.mark.id,
    switchId: "old-marks-" + switcher.mark.id,
  };
}

test("перенумерация: метки получают 1…N, каждый вид считает со своей единицы, каждая ссылка переписана", () => {
  const before = uuidBuild();
  const after = idsMigrate(before.project);
  assert.equal(after.changed, true);

  // Метки 1…N — слова заказчика «начиная с 1».
  assert.deepEqual(
    after.project.marks.map((mark) => mark.id),
    after.project.marks.map((mark, index) => String(index + 1)),
    "метки получили не 1…N подряд",
  );
  // И каждый другой вид тоже считает со своей единицы, а не продолжает чужую.
  for (const collection of ["schemes", "rooms", "categories", "markTypes", "walls", "openings", "scenarios"]) {
    const ids = (after.project[collection] || []).map((item) => item.id);
    if (ids.length === 0) continue;
    assert.deepEqual(ids, ids.map((id, index) => String(index + 1)), collection + ": вид нумерован не с единицы");
  }
  assertCounters(after.project, "после перенумерации");

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

// Второй вход в миграцию (ADR 038): объект **формата 8** — номера у всех, но
// раздавал их один общий счётчик, и справочник сидит на номерах меток. Такой
// объект обязан перенумероваться по видам, а не считаться готовым.
function sharedBuild() {
  const before = uuidBuild();
  // Прежняя сборка: один счётчик на весь объект, номера подряд по коллекциям.
  let last = 0;
  const moves = new Map();
  const order = [
    "marks",
    "groups",
    "outlines",
    "schemes",
    "rooms",
    "categories",
    "markTypes",
    "walls",
    "openings",
    "schemeObjects",
    "schemeObjectKinds",
    "equipmentTypes",
    "equipment",
    "placements",
    "scenarios",
    "logicBindings",
  ];
  for (const collection of order) {
    const table = new Map();
    for (const item of before.project[collection] || []) {
      last += 1;
      table.set(item.id, String(last));
    }
    if (table.size > 0) moves.set(collection, table);
  }
  const shared = idsReplace(before.project, moves).project;
  return { project: { ...shared, counters: { ...shared.counters, [ID_COUNTER_SHARED_KEY]: last } }, lastShared: last };
}

test("объект формата 8 с общими номерами перенумеровывается по видам, а не считается готовым", () => {
  const shared = sharedBuild();
  // Так он и выглядел у заказчика: метки съели первую сотню номеров, справочник
  // сидит на номерах после них.
  assert.ok(shared.project.marks.every((mark) => isNumbered(mark.id)), "пример не тот: номера не у всех");
  assert.ok(idNumberOf(shared.project.markTypes[0].id) > shared.project.marks.length, "пример не тот: справочник не сдвинут");

  const after = idsMigrate(shared.project);
  assert.equal(after.changed, true, "объект формата 8 остался с общим счётчиком");
  assert.deepEqual(
    after.project.marks.map((mark) => mark.id),
    after.project.marks.map((mark, index) => String(index + 1)),
    "метки формата 8 не стали 1…N",
  );
  assert.equal(after.project.markTypes[0].id, "1", "справочник остался на номерах меток");
  assert.equal(
    Object.prototype.hasOwnProperty.call(after.project.counters, ID_COUNTER_SHARED_KEY),
    false,
    "общий счётчик остался в объекте",
  );
  assertCounters(after.project, "формат 8 после перенумерации");
  // И третий вход: перенумерованный по видам объект не меняется ни на байт.
  assert.equal(idsMigrate(after.project).project, after.project, "третье открытие переписало объект");
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

test("поимённый переезд номера переписывает ссылки своего вида и ничего больше", () => {
  const scene = house();
  const lamp = markAt(scene.project, scene.schemeId, "Т", { x: 0.3, y: 0.3 });
  const switcher = markAt(lamp.project, scene.schemeId, "В", { x: 0.4, y: 0.4 });
  const linked = setMarkControls(switcher.project, switcher.mark.id, [lamp.mark.id]).project;

  const moved = idsReplace(linked, { marks: { [lamp.mark.id]: "9001" } });
  assert.equal(moved.changed, true);
  assert.equal(findMark(moved.project, lamp.mark.id), null, "метка осталась на прежнем номере");
  assert.ok(findMark(moved.project, "9001"), "метка не переехала");
  assert.deepEqual(findMark(moved.project, switcher.mark.id).controls, ["9001"], "связь осталась в пустоте");
  // Переселять нечего — тот же объект по ссылке.
  assert.equal(idsReplace(linked, {}).project, linked);
  assert.equal(idsReplace(linked, { marks: { [lamp.mark.id]: lamp.mark.id } }).project, linked);
});

// **Вид в таблице переездов — не формальность.** Помещение и метка в этом
// объекте носят один номер, и таблица без вида увезла бы обоих.
test("переезд помещения не трогает метку того же номера", () => {
  const scene = house();
  const lamp = markAt(scene.project, scene.schemeId, "Т", { x: 0.3, y: 0.3 });
  const project = lamp.project;
  assert.equal(lamp.mark.id, scene.roomId, "пример не тот: номера разошлись сами");

  const moved = idsReplace(project, { rooms: { [scene.roomId]: "9001" } });
  assert.ok(findRoom(moved.project, "9001"), "помещение не переехало");
  assert.ok(findMark(moved.project, lamp.mark.id), "метка уехала вместе с помещением");
  assert.equal(findMark(moved.project, "9001"), null, "метка встала на номер помещения");
});

// ——— ключи принятых предупреждений: вид назван кодом проблемы ————————————

test("вид сегментов ключа назван у каждого кода проблемы", () => {
  // Новая проверка `validate` обязана попасть в таблицу `ID_KEY_SUBJECTS`:
  // иначе ответ «так и задумано» на её вопрос не переживёт перенумерацию, и
  // человек получит заново строку, на которую уже ответил.
  assert.deepEqual(
    Object.keys(strings.problems).filter((code) => !ID_KEY_PROBLEM_CODES.includes(code)),
    [],
    "у кода проблемы не назван вид сегментов ключа",
  );
  assert.deepEqual(
    ID_KEY_PROBLEM_CODES.filter((code) => !Object.prototype.hasOwnProperty.call(strings.problems, code)),
    [],
    "в таблице назван код, которого нет в словаре",
  );
});

// Ключ принятого повтора — `repeatedNumber:<typeId>#<номер>`, и второй сегмент
// там **видимый номер метки**, а не идентификатор сущности: его переносит своя
// дверь (`renumberAccepted`, `renumberAcceptedRepeats`). Пройди он через
// таблицу переездов — и на объекте заказчика в 592 метки переезд сущности 16
// превратил бы `repeatedNumber:741#16` в `…#5000`: ответ повис бы на номере,
// которого нет, а на настоящем номере вопрос задался бы заново.
test("номер метки в ключе принятого повтора по таблице переездов не едет", () => {
  const scene = house();
  const first = markAt(scene.project, scene.schemeId, "Т", { x: 0.3, y: 0.3 });
  const second = markAt(first.project, scene.schemeId, "Т", { x: 0.4, y: 0.4 });
  const number = findMark(first.project, first.mark.id).number;
  let project = setMarkNumber(second.project, second.mark.id, number).project;
  const repeat = validate(project).find((item) => item.code === "repeatedNumber");
  assert.ok(repeat, "пример не тот: повтора номера нет");
  project = acceptProblem(project, repeat).project;
  assert.equal(problemAccepted(project, repeat.key), true, "ответ не записался");

  // Переезжает **тип**, чей номер совпал с номером метки: именно так и было у
  // заказчика. Вид в таблице назван, поэтому номер метки в хвосте ключа цел.
  const typeId = findMark(project, first.mark.id).typeId;
  const moved = idsReplace(project, { markTypes: { [typeId]: "9001" } });
  assert.equal(problemAccepted(moved.project, "repeatedNumber:9001#" + number), true, "ключ принятия не переехал за типом");
  // И ни одной записи-сироты: объект задаёт тот же вопрос, на который ответ дан.
  const asked = validate(moved.project).find((item) => item.code === "repeatedNumber");
  assert.ok(asked, "повтор пропал из вопросов");
  assert.equal(problemAccepted(moved.project, asked.key), true, "на повтор вопрос задался заново");
  assert.equal(acceptedProblems(moved.project).length, acceptedProblems(project).length, "список принятых поехал");
});

// А вот переезд **метки** того же номера ключ принятия не трогает: первый
// сегмент там тип, и вид его назван.
test("переезд метки ключа принятого повтора не задевает", () => {
  const scene = house();
  const first = markAt(scene.project, scene.schemeId, "Т", { x: 0.3, y: 0.3 });
  const second = markAt(first.project, scene.schemeId, "Т", { x: 0.4, y: 0.4 });
  const number = findMark(first.project, first.mark.id).number;
  let project = setMarkNumber(second.project, second.mark.id, number).project;
  const repeat = validate(project).find((item) => item.code === "repeatedNumber");
  project = acceptProblem(project, repeat).project;

  const moved = idsReplace(project, { marks: { [first.mark.id]: "9001" } });
  assert.equal(problemAccepted(moved.project, repeat.key), true, "ответ «так и задумано» уехал за меткой");
  const asked = validate(moved.project).find((item) => item.code === "repeatedNumber");
  assert.ok(asked, "повтор пропал из вопросов");
  assert.equal(problemAccepted(moved.project, asked.key), true, "на повтор вопрос задался заново");
});
