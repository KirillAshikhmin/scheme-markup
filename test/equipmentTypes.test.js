// Тип оборудования: свой справочник объекта, не тот, что у меток.
//
// Слова заказчика: «для оборудования добавь поле Тип, которое можно расширять,
// но по умолчанию добавь все что есть по меткам, а так же всё, что может
// применяться в умном доме». Проверяются три вещи: стартовый набор приезжает
// в новый объект и дальше живёт в нём, справочник правится, и объект, размеченный
// до появления типов, открывается как раньше.
import test from "node:test";
import assert from "node:assert/strict";
import {
  addEquipment,
  addEquipmentType,
  addMark,
  addScheme,
  createProject,
  defaultTemplate,
  deleteEquipmentType,
  equipmentTypeOf,
  equipmentTypeTemplate,
  equipmentTypeUsage,
  equipmentTypesInOrder,
  equipmentVendors,
  findEquipmentType,
  matchEquipmentExactly,
  searchEquipment,
  updateEquipment,
  updateEquipmentType,
} from "../src/model.js";
import { packProject, unpackProject } from "../src/projectFile.js";

function equipHouse() {
  let project = createProject({ name: "Квартира" });
  const scheme = addScheme(project, { name: "1 этаж", width: 1000, height: 800 });
  project = scheme.project;
  const typeOf = (code) => project.markTypes.find((type) => type.code === code).id;
  const added = addMark(project, {
    schemeId: scheme.scheme.id,
    typeId: typeOf("Т"),
    kind: "point",
    points: [{ x: 0.2, y: 0.5 }],
  });
  project = added.project;
  const kindOf = (name) => equipmentTypesInOrder(project).find((item) => item.name === name).id;
  const relay = addEquipment(project, { name: "Shelly 2PM", vendor: "Shelly", code: "SH-2PM", typeId: kindOf("Реле 2 канала") });
  project = relay.project;
  const power = addEquipment(project, { name: "Блок 12В 60Вт", vendor: "Mean Well", typeId: kindOf("Блок питания") });
  project = power.project;
  const lamp = addEquipment(project, { name: "Светильник Gu10" });
  project = lamp.project;
  return { project, markId: added.mark.id, relay: relay.equipment.id, power: power.equipment.id, lamp: lamp.equipment.id, kindOf };
}

test("новый объект получает стартовый справочник типов оборудования", () => {
  const project = createProject({ name: "Квартира" });
  const names = equipmentTypesInOrder(project).map((item) => item.name);
  assert.ok(names.length > 30, "стартовый набор подозрительно мал: " + names.length);

  // Часть первая — то, что размечено меткой на плане.
  for (const name of ["Светильник", "Розетка", "Выключатель", "Бризер", "Кондиционер", "Точка доступа WiFi", "Датчик движения"]) {
    assert.ok(names.includes(name), "нет типа по метке: " + name);
  }
  // Часть вторая — то, что ставят, но меткой не помечают: щит и обвязка.
  // Заказчик назвал направление поимённо, и оно обязано быть в наборе.
  for (const name of [
    "Реле 1 канал",
    "Реле 2 канала",
    "Реле 3 канала",
    "Реле 4 канала",
    "Диммер",
    "Контроллер одноцветной ленты",
    "Контроллер ленты RGB",
    "Контроллер ленты RGBW",
    "Контроллер ленты CCT",
    "Блок питания",
    "Беспроводная кнопка",
    "Сценарная панель",
    "Шлюз Zigbee или Z-Wave",
    "Встраиваемый модуль",
    "Привод штор",
    "Термостат",
    "ИК-передатчик",
    "Коммутатор",
  ]) {
    assert.ok(names.includes(name), "нет типа из щита и обвязки: " + name);
  }
  // Повторов в наборе нет: два одинаковых пункта в выпадающем списке
  // неотличимы друг от друга.
  assert.equal(new Set(names).size, names.length);
});

test("справочник объекта живёт своей жизнью: два объекта не делят один тип", () => {
  const first = createProject({ name: "Первый" });
  const second = createProject({ name: "Второй" });
  const ids = new Set(equipmentTypesInOrder(first).map((item) => item.id));
  assert.equal(
    equipmentTypesInOrder(second).some((item) => ids.has(item.id)),
    false,
    "объекты делят идентификаторы справочника",
  );
  // Правка в одном объекте второго не касается — как и у типов меток.
  const renamed = updateEquipmentType(first, equipmentTypesInOrder(first)[0].id, { name: "Своё название" });
  assert.equal(equipmentTypesInOrder(renamed.project)[0].name, "Своё название");
  assert.notEqual(equipmentTypesInOrder(second)[0].name, "Своё название");
});

test("шаблон без типов оборудования всё равно даёт объекту стартовый набор", () => {
  // Шаблон, сохранённый до появления типов, их не несёт: пустой справочник в
  // новом объекте был бы шагом назад, а не «как раньше».
  const template = defaultTemplate();
  delete template.equipmentTypes;
  const project = createProject(template);
  assert.ok(equipmentTypesInOrder(project).length > 30);
});

test("справочник правится: добавить, переименовать, удалить", () => {
  const box = equipHouse();
  const added = addEquipmentType(box.project, { name: "Реле 8 каналов" });
  assert.equal(added.equipmentType.name, "Реле 8 каналов");
  assert.equal(equipmentTypesInOrder(added.project).at(-1).name, "Реле 8 каналов");

  const renamed = updateEquipmentType(added.project, added.equipmentType.id, { name: "Реле восьмиканальное" });
  assert.equal(findEquipmentType(renamed.project, added.equipmentType.id).name, "Реле восьмиканальное");

  const removed = deleteEquipmentType(renamed.project, added.equipmentType.id);
  assert.equal(findEquipmentType(removed.project, added.equipmentType.id), null);
  // Порядок после удаления смыкается: дыр в справочнике не остаётся.
  assert.deepEqual(
    equipmentTypesInOrder(removed.project).map((item) => item.order),
    equipmentTypesInOrder(removed.project).map((item, index) => index),
  );

  assert.throws(() => addEquipmentType(box.project, { name: "   " }), /название/i);
  assert.throws(() => updateEquipmentType(box.project, "нет-такого", { name: "Х" }), /Тип оборудования не найден/);
});

test("тип, который стоит у моделей, не удаляется молча", () => {
  const box = equipHouse();
  const relayType = box.kindOf("Реле 2 канала");
  assert.equal(equipmentTypeUsage(box.project, relayType), 1);
  assert.throws(() => deleteEquipmentType(box.project, relayType), /стоит у моделей/);

  // Сняли тип у модели — тип удаляется.
  const freed = updateEquipment(box.project, box.relay, { typeId: "" }).project;
  assert.equal(equipmentTypeUsage(freed, relayType), 0);
  assert.equal(findEquipmentType(deleteEquipmentType(freed, relayType).project, relayType), null);
});

test("тип у модели необязателен, а ссылка в никуда не сохраняется", () => {
  const box = equipHouse();
  // Модель без типа — законная запись, а не поломка.
  assert.equal(equipmentTypeOf(box.project, box.lamp), null);

  // Несуществующий тип превращается в пустой: иначе в таблице он читался бы
  // как «тип есть, но не показывается».
  const patched = updateEquipment(box.project, box.lamp, { typeId: "нет-такого-типа" }).project;
  assert.equal(equipmentTypeOf(patched, box.lamp), null);
  const created = addEquipment(box.project, { name: "Чужое", typeId: "нет-такого-типа" });
  assert.equal(created.equipment.typeId, "");

  assert.equal(equipmentTypeOf(box.project, box.relay).name, "Реле 2 канала");
});

test("G68: объект, размеченный до появления типов, открывается как раньше", () => {
  const box = equipHouse();
  // Объект прежнего формата: справочника нет вовсе, у моделей нет поля типа.
  const old = {
    ...box.project,
    equipmentTypes: undefined,
    equipment: box.project.equipment.map(({ typeId, ...rest }) => rest),
  };
  delete old.equipmentTypes;

  // Ни одна из этих проверок не должна ни падать, ни ругаться: пустой тип —
  // не ошибка и не повод спрашивать.
  assert.deepEqual(equipmentTypesInOrder(old), []);
  assert.equal(findEquipmentType(old, "что-нибудь"), null);
  assert.equal(equipmentTypeOf(old, box.relay), null);
  assert.equal(equipmentTypeUsage(old, "что-нибудь"), 0);
  assert.deepEqual(searchEquipment(old, { query: "" }).map((item) => item.name), [
    "Shelly 2PM",
    "Блок 12В 60Вт",
    "Светильник Gu10",
  ]);
  // Метки, номера и подписи объекта при этом те же самые.
  assert.deepEqual(old.marks, box.project.marks);
  assert.deepEqual(old.counters, box.project.counters);

  // И справочник в таком объекте заводится обычным добавлением.
  const seeded = addEquipmentType(old, { name: "Реле 2 канала" });
  assert.deepEqual(equipmentTypesInOrder(seeded.project).map((item) => item.name), ["Реле 2 канала"]);
});

test("стартовый набор выдаётся свежими идентификаторами на каждый вызов", () => {
  const first = equipmentTypeTemplate();
  const second = equipmentTypeTemplate();
  assert.equal(first.length, second.length);
  assert.equal(
    first.some((item) => second.some((other) => other.id === item.id)),
    false,
  );
  assert.deepEqual(first.map((item) => item.order), first.map((item, index) => index));
});

test("справочник типов оборудования уезжает в файл проекта и возвращается", async () => {
  const box = equipHouse();
  const blob = await packProject(box.project, new Map());
  const loaded = await unpackProject(blob);
  assert.deepEqual(
    equipmentTypesInOrder(loaded.project).map((item) => item.name),
    equipmentTypesInOrder(box.project).map((item) => item.name),
  );
  assert.equal(equipmentTypeOf(loaded.project, box.relay).name, "Реле 2 канала");
});

// ——— поиск в окне выбора ————————————————————————————————————————————————

test("поиск модели ищет по названию, производителю и артикулу", () => {
  const box = equipHouse();
  const names = (options) => searchEquipment(box.project, options).map((item) => item.name);

  assert.deepEqual(names({ query: "" }), ["Shelly 2PM", "Блок 12В 60Вт", "Светильник Gu10"]);
  assert.deepEqual(names({ query: "shelly" }), ["Shelly 2PM"], "производитель тоже ищется");
  assert.deepEqual(names({ query: "SH-2PM" }), ["Shelly 2PM"], "артикул тоже ищется");
  assert.deepEqual(names({ query: "светильник" }), ["Светильник Gu10"], "регистр не важен");
  assert.deepEqual(names({ query: "ничего такого" }), []);
});

test("точное совпадение идёт первым — его и берёт Enter", () => {
  const box = equipHouse();
  let project = addEquipment(box.project, { name: "Блок", vendor: "Mean Well" }).project;
  // «Блок» и «Блок 12В 60Вт» оба подходят под строку «Блок»; первым обязан
  // стоять точный, иначе Enter заведёт не ту модель.
  assert.deepEqual(
    searchEquipment(project, { query: "Блок" }).map((item) => item.name),
    ["Блок", "Блок 12В 60Вт"],
  );
  // Без точного совпадения порядок — порядок справочника, а не алфавит:
  // список не перетасовывается от одной набранной буквы.
  assert.deepEqual(
    searchEquipment(project, { query: "Бло" }).map((item) => item.name),
    ["Блок 12В 60Вт", "Блок"],
  );
});

test("фильтры окна: по типу и по производителю, включая «без производителя»", () => {
  const box = equipHouse();
  const names = (options) => searchEquipment(box.project, options).map((item) => item.name);

  assert.deepEqual(names({ typeId: box.kindOf("Реле 2 канала") }), ["Shelly 2PM"]);
  assert.deepEqual(names({ typeId: box.kindOf("Блок питания") }), ["Блок 12В 60Вт"]);
  assert.deepEqual(names({ typeId: box.kindOf("Термостат") }), [], "тип без моделей — пустой список");

  assert.deepEqual(names({ vendor: "Shelly" }), ["Shelly 2PM"]);
  assert.deepEqual(names({ vendor: "shelly" }), ["Shelly 2PM"], "регистр производителя не важен");
  // Модель без производителя иначе было бы нечем найти в объекте, где у
  // остальных он заполнен.
  assert.deepEqual(names({ noVendor: true }), ["Светильник Gu10"]);

  // Фильтры складываются с поиском, а не заменяют его.
  assert.deepEqual(names({ query: "shelly", typeId: box.kindOf("Блок питания") }), []);
});

test("производители для фильтра — без повторов и без пустых", () => {
  const box = equipHouse();
  assert.deepEqual(equipmentVendors(box.project), ["Shelly", "Mean Well"]);
  const more = addEquipment(box.project, { name: "Shelly 1", vendor: "Shelly" }).project;
  assert.deepEqual(equipmentVendors(more), ["Shelly", "Mean Well"]);
});

test("такая модель уже есть — второй такой же окно заводить не предлагает", () => {
  const box = equipHouse();
  assert.equal(matchEquipmentExactly(box.project, "Shelly 2PM").id, box.relay);
  assert.equal(matchEquipmentExactly(box.project, "shelly 2pm").id, box.relay, "регистр не важен");
  assert.equal(matchEquipmentExactly(box.project, "SH-2PM").id, box.relay, "артикул тоже считается");
  assert.equal(matchEquipmentExactly(box.project, "Shelly"), null, "часть названия — не совпадение");
  assert.equal(matchEquipmentExactly(box.project, ""), null);
});
