// Оборудование: справочник моделей объекта и размещённые единицы.
//
// Заказчик разделил две вещи. Модель — это товар: «Shelly 1PM», одна модель
// стоит на многих метках, и по ней считается закупка. Размещённая единица —
// это «одна штука тут»: модель, метка места и связи с другими метками (реле
// стоит в щите, а связано со светильниками и выключателем).
import test from "node:test";
import assert from "node:assert/strict";
import {
  addEquipment,
  addMark,
  addPlacement,
  addScheme,
  createProject,
  deleteEquipment,
  deleteMark,
  deletePlacement,
  deleteScheme,
  equipmentInOrder,
  equipmentUsage,
  findEquipment,
  findPlacement,
  labelOf,
  placementLinkIds,
  placementsAt,
  placementsInOrder,
  placementsLinkedTo,
  updateEquipment,
  updatePlacement,
  validate,
} from "../src/model.js";

function flat() {
  let project = createProject({ name: "Квартира" });
  const scheme = addScheme(project, { name: "1 этаж", width: 1000, height: 800 });
  project = scheme.project;
  const typeOf = (code) => project.markTypes.find((type) => type.code === code).id;
  const put = (code, x) => {
    const result = addMark(project, {
      schemeId: scheme.scheme.id,
      typeId: typeOf(code),
      kind: "point",
      points: [{ x, y: 0.5 }],
    });
    project = result.project;
    return result.mark.id;
  };
  const board = put("Р", 0.1); // щит — место реле
  const lampOne = put("Т", 0.2);
  const lampTwo = put("Т", 0.3);
  const switchOne = put("В", 0.4);
  return {
    get project() {
      return project;
    },
    set project(value) {
      project = value;
    },
    schemeId: scheme.scheme.id,
    typeOf,
    board,
    lampOne,
    lampTwo,
    switchOne,
  };
}

function withRelay(box) {
  const model = addEquipment(box.project, { name: "Shelly 1PM", vendor: "Shelly", code: "SH-1PM" });
  box.project = model.project;
  const placed = addPlacement(box.project, {
    equipmentId: model.equipment.id,
    markId: box.board,
    links: [box.lampOne, box.lampTwo, box.switchOne],
  });
  box.project = placed.project;
  return { modelId: model.equipment.id, placementId: placed.placement.id };
}

test("справочник моделей: заводится, правится, читается в своём порядке", () => {
  const box = flat();
  const first = addEquipment(box.project, { name: "Shelly 1PM", vendor: "Shelly", code: "SH-1PM" });
  box.project = first.project;
  const second = addEquipment(box.project, { name: "Светильник Maytoni 12W" });
  box.project = second.project;

  assert.deepEqual(
    equipmentInOrder(box.project).map((item) => item.name),
    ["Shelly 1PM", "Светильник Maytoni 12W"],
  );
  assert.equal(findEquipment(box.project, first.equipment.id).code, "SH-1PM");
  // Необязательные поля пустые, а не «undefined»: их печатают в таблице закупки.
  assert.equal(second.equipment.vendor, "");
  assert.equal(second.equipment.code, "");

  box.project = updateEquipment(box.project, second.equipment.id, { name: "Maytoni 12W", vendor: "Maytoni" }).project;
  assert.equal(findEquipment(box.project, second.equipment.id).name, "Maytoni 12W");
  assert.equal(findEquipment(box.project, second.equipment.id).vendor, "Maytoni");
  assert.throws(() => addEquipment(box.project, { name: "  " }), { code: "nameRequired" });
});

test("единица встаёт на метку места и связывается с несколькими метками", () => {
  const box = flat();
  const { modelId, placementId } = withRelay(box);
  const placement = findPlacement(box.project, placementId);
  assert.equal(placement.equipmentId, modelId);
  assert.equal(placement.markId, box.board);
  assert.deepEqual(placementLinkIds(placement), [box.lampOne, box.lampTwo, box.switchOne]);

  // Кто где стоит и с чем связан — два разных вопроса.
  assert.deepEqual(
    placementsAt(box.project, box.board).map((item) => item.id),
    [placementId],
  );
  assert.deepEqual(placementsAt(box.project, box.lampOne), []);
  assert.deepEqual(
    placementsLinkedTo(box.project, box.lampOne).map((item) => item.id),
    [placementId],
  );
  assert.deepEqual(placementsInOrder(box.project).length, 1);
  assert.equal(labelOf(box.project, placement.markId), "Р1");
});

test("одна модель стоит на многих метках — по этому считается закупка", () => {
  const box = flat();
  const model = addEquipment(box.project, { name: "Светильник Maytoni 12W" });
  box.project = model.project;
  for (const markId of [box.lampOne, box.lampTwo]) {
    box.project = addPlacement(box.project, { equipmentId: model.equipment.id, markId }).project;
  }
  assert.equal(equipmentUsage(box.project, model.equipment.id), 2);
  assert.equal(placementsInOrder(box.project).length, 2);
  // Модель, которая где-то стоит, из справочника не пропадает молча.
  assert.throws(() => deleteEquipment(box.project, model.equipment.id), { code: "equipmentInUse" });
  box.project = deletePlacement(box.project, placementsInOrder(box.project)[0].id).project;
  assert.equal(equipmentUsage(box.project, model.equipment.id), 1);
});

test("у единицы правятся и место, и связи", () => {
  const box = flat();
  const { placementId } = withRelay(box);
  box.project = updatePlacement(box.project, placementId, { markId: box.switchOne, links: [box.lampOne] }).project;
  const placement = findPlacement(box.project, placementId);
  assert.equal(placement.markId, box.switchOne);
  assert.deepEqual(placementLinkIds(placement), [box.lampOne]);
  // Место — обязательная метка, связь на несуществующую метку не принимается.
  assert.throws(() => updatePlacement(box.project, placementId, { markId: "нет такой" }), { code: "markNotFound" });
  assert.throws(() => updatePlacement(box.project, placementId, { links: ["нет такой"] }), { code: "markNotFound" });
});

test("удалённая метка не оставляет висящих единиц и связей", () => {
  const box = flat();
  const { placementId } = withRelay(box);
  // Ушёл светильник — ушла связь, единица осталась на своём месте.
  box.project = deleteMark(box.project, box.lampOne).project;
  assert.deepEqual(placementLinkIds(findPlacement(box.project, placementId)), [box.lampTwo, box.switchOne]);
  // Ушла метка места — единице стоять негде, она уходит вместе с ней.
  box.project = deleteMark(box.project, box.board).project;
  assert.equal(findPlacement(box.project, placementId), null);
  assert.deepEqual(validate(box.project).filter((item) => item.code.startsWith("placement")), []);
});

test("схема уходит вместе с метками — единицы и связи на них тоже", () => {
  const box = flat();
  const { placementId } = withRelay(box);
  const second = addScheme(box.project, { name: "2 этаж", width: 800, height: 600 });
  box.project = second.project;
  const upstairs = addMark(box.project, {
    schemeId: second.scheme.id,
    typeId: box.typeOf("Т"),
    kind: "point",
    points: [{ x: 0.5, y: 0.5 }],
  });
  box.project = upstairs.project;
  box.project = updatePlacement(box.project, placementId, {
    links: [box.lampOne, upstairs.mark.id],
  }).project;
  box.project = deleteScheme(box.project, second.scheme.id).project;
  assert.deepEqual(placementLinkIds(findPlacement(box.project, placementId)), [box.lampOne]);
  assert.deepEqual(validate(box.project).filter((item) => item.code.startsWith("placement")), []);
});

test("объект старого формата без оборудования читается как пустой справочник", () => {
  const box = flat();
  const old = { ...box.project };
  delete old.equipment;
  delete old.placements;
  assert.deepEqual(equipmentInOrder(old), []);
  assert.deepEqual(placementsInOrder(old), []);
  assert.deepEqual(placementsAt(old, box.board), []);
  assert.equal(equipmentUsage(old, "нет такой"), 0);
  assert.deepEqual(validate(old).filter((item) => item.code.startsWith("placement")), []);
  // И сразу после чтения справочник заводится как обычно.
  const model = addEquipment(old, { name: "Shelly 1PM" });
  assert.deepEqual(
    equipmentInOrder(model.project).map((item) => item.name),
    ["Shelly 1PM"],
  );
});

test("битые данные видны в проверке объекта, а не молча", () => {
  const box = flat();
  const { modelId, placementId } = withRelay(box);
  const broken = {
    ...box.project,
    placements: [
      { ...findPlacement(box.project, placementId), links: [box.lampOne, "потерянная-метка"] },
      { id: "п2", equipmentId: "нет такой модели", markId: box.board, links: [] },
      { id: "п3", equipmentId: modelId, markId: "нет такой метки", links: [] },
    ],
  };
  const codes = validate(broken)
    .filter((item) => item.code.startsWith("placement"))
    .map((item) => item.code)
    .sort();
  assert.deepEqual(codes, ["placementLinkMissing", "placementWithoutEquipment", "placementWithoutMark"]);
});
