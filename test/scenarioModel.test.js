// Сценарии и привязки логики в объекте (таск 01 сценариев, раздел 7
// спецификации; истории 1.15, 7.1–7.4): команды модели, удаление меток,
// предупреждение панели, версия файла и оба конвейера открытия.
import test from "node:test";
import assert from "node:assert/strict";

import {
  FORMAT_VERSION,
  FORMAT_VERSION_MAX,
  addLogicBinding,
  addMark,
  addScenario,
  addScheme,
  createProject,
  deleteLogicBinding,
  deleteMark,
  deleteScenario,
  deleteScheme,
  findLogicBinding,
  findScenario,
  logicBindingsOf,
  markDeviceOf,
  migrateScenarios,
  moveScenario,
  projectFormatVersion,
  scenariosInOrder,
  scenariosOf,
  setMarkDevice,
  setTypeDevice,
  updateLogicBinding,
  updateScenario,
  validate,
} from "../src/model.js";
import { PROJECT_ENTRY, packProject, readZip, unpackProject, writeZip } from "../src/projectFile.js";
import { adoptLoadedProject } from "../src/autosave.js";
import { projectsMigrateStored } from "../src/panels/projects.js";
import { WARNING_TARGETS, warningPlace, warningsModel } from "../src/panels/warnings.js";
import { strings } from "../src/strings.js";

function house() {
  const added = addScheme(createProject(), { name: "1 этаж", imageId: null, width: 1000, height: 800 });
  let project = added.project;
  const typeOf = (code) => project.markTypes.find((type) => type.code === code).id;
  const lamp = addMark(project, { schemeId: added.scheme.id, typeId: typeOf("Т"), points: [{ x: 0.2, y: 0.2 }] });
  project = lamp.project;
  const motion = addMark(project, { schemeId: added.scheme.id, typeId: typeOf("ДД"), points: [{ x: 0.4, y: 0.2 }] });
  project = motion.project;
  return { project, schemeId: added.scheme.id, lampId: lamp.mark.id, motionId: motion.mark.id };
}

// Блочный сценарий «движение — включить свет» в форме блоков договора.
function motionLight(box) {
  return {
    kind: "block",
    name: "Свет по движению",
    targets: [
      {
        type: "if",
        id: "b1",
        if: {
          type: "group",
          id: "g1",
          mode: "OR",
          conditions: [
            { type: "device", id: "c1", ref: { markId: box.motionId, service: 0, char: "MotionDetected" }, op: "eq", value: true, trigger: true },
          ],
        },
        then: [{ type: "device", id: "a1", ref: { markId: box.lampId, service: 0 }, items: [{ char: "On", verb: "set", value: true }] }],
        else: null,
        every: null,
      },
    ],
  };
}

test("сценарии: добавить, изменить, удалить, переставить — порядок только из модели", () => {
  const box = house();
  assert.deepEqual(scenariosOf(box.project), [], "у объекта без сценариев список читается пустым");
  assert.equal(Object.prototype.hasOwnProperty.call(box.project, "scenarios"), false, "пустой список заведён заранее");

  const first = addScenario(box.project, motionLight(box));
  assert.equal(first.scenario.kind, "block");
  assert.equal(first.scenario.active, true);
  assert.equal(first.scenario.onStart, false);
  assert.equal(first.scenario.targets[0].then[0].ref.markId, box.lampId);
  const second = addScenario(first.project, { kind: "logic", name: "  ", source: "info = {}", fileName: "a.js" });
  assert.equal(second.scenario.name, strings.sim.scenarioUntitled, "пустое имя — имя по умолчанию");
  const third = addScenario(second.project, { kind: "global", name: "Библиотека", id: first.scenario.id });
  assert.notEqual(third.scenario.id, first.scenario.id, "занятый id выдан второму сценарию");
  assert.equal(addScenario(third.project, { kind: "global", id: "свой-id" }).scenario.id, "свой-id");
  assert.throws(() => addScenario(box.project, { kind: "macro" }), (error) => error.code === "scenarioKindUnknown");

  let project = third.project;
  const names = () => scenariosInOrder(project).map((item) => item.name);
  assert.deepEqual(names(), ["Свет по движению", strings.sim.scenarioUntitled, "Библиотека"]);

  project = moveScenario(project, third.scenario.id, 0).project;
  assert.deepEqual(names(), ["Библиотека", "Свет по движению", strings.sim.scenarioUntitled]);
  assert.equal(moveScenario(project, third.scenario.id, 0).project, project, "перестановка на то же место — шаг истории");

  const renamed = updateScenario(project, first.scenario.id, { name: "Ночной свет", kind: "logic", order: 9, id: "x" });
  assert.equal(renamed.scenario.name, "Ночной свет");
  assert.equal(renamed.scenario.kind, "block", "правка поменяла вид сценария");
  assert.equal(renamed.scenario.id, first.scenario.id);
  assert.equal(findScenario(renamed.project, first.scenario.id).order, findScenario(project, first.scenario.id).order);
  assert.equal(updateScenario(renamed.project, first.scenario.id, { name: "Ночной свет" }).project, renamed.project, "пустая правка");
  project = renamed.project;

  const removed = deleteScenario(project, second.scenario.id);
  assert.equal(findScenario(removed.project, second.scenario.id), null);
  assert.deepEqual(scenariosInOrder(removed.project).map((item) => item.order), [0, 1], "порядок после удаления с дырой");
  assert.throws(() => deleteScenario(removed.project, "нет"), (error) => error.code === "scenarioNotFound");
});

test("привязки логики: добавить, изменить, удалить — только к логическому сценарию и живой метке", () => {
  const box = house();
  const logic = addScenario(box.project, { kind: "logic", name: "Свет по датчику", source: "info = {}" });
  const block = addScenario(logic.project, motionLight(box));
  let project = block.project;
  const added = addLogicBinding(project, { scenarioId: logic.scenario.id, markId: box.lampId, service: 0, options: { delay: 30 } });
  assert.equal(added.binding.active, true);
  assert.deepEqual(added.binding.options, { delay: 30 });
  project = added.project;
  assert.equal(logicBindingsOf(project).length, 1);

  const code = (fn) => {
    try {
      fn();
    } catch (error) {
      return error.code;
    }
    return null;
  };
  assert.equal(code(() => addLogicBinding(project, { scenarioId: block.scenario.id, markId: box.lampId })), "logicBindingNotLogic");
  assert.equal(code(() => addLogicBinding(project, { scenarioId: logic.scenario.id, markId: "нет" })), "markNotFound");
  assert.equal(code(() => addLogicBinding(project, { scenarioId: logic.scenario.id, markId: box.lampId, service: -1 })), "logicBindingService");
  assert.equal(code(() => addLogicBinding(project, { scenarioId: "нет", markId: box.lampId })), "scenarioNotFound");

  const edited = updateLogicBinding(project, added.binding.id, { options: { delay: 60 }, active: false });
  assert.deepEqual(findLogicBinding(edited.project, added.binding.id).options, { delay: 60 });
  assert.equal(findLogicBinding(edited.project, added.binding.id).active, false);
  assert.equal(updateLogicBinding(edited.project, added.binding.id, { active: false }).project, edited.project, "пустая правка");
  assert.equal(code(() => updateLogicBinding(edited.project, added.binding.id, { markId: "нет" })), "markNotFound");

  const gone = deleteLogicBinding(edited.project, added.binding.id).project;
  assert.deepEqual(logicBindingsOf(gone), []);
  // Удалённый логический сценарий уносит свои привязки.
  const again = addLogicBinding(gone, { scenarioId: logic.scenario.id, markId: box.lampId }).project;
  assert.deepEqual(logicBindingsOf(deleteScenario(again, logic.scenario.id).project), []);
});

test("удаление метки уносит её привязки логики, а ссылки сценариев на неё оставляет", () => {
  const box = house();
  const logic = addScenario(box.project, { kind: "logic", name: "Логика" });
  const block = addScenario(logic.project, motionLight(box));
  let project = addLogicBinding(block.project, { scenarioId: logic.scenario.id, markId: box.lampId }).project;
  project = addLogicBinding(project, { scenarioId: logic.scenario.id, markId: box.motionId }).project;

  const afterMark = deleteMark(project, box.lampId).project;
  assert.deepEqual(logicBindingsOf(afterMark).map((item) => item.markId), [box.motionId]);
  assert.equal(
    findScenario(afterMark, block.scenario.id).targets[0].then[0].ref.markId,
    box.lampId,
    "ссылка блока на удалённую метку пропала молча",
  );

  const afterScheme = deleteScheme(project, box.schemeId).project;
  assert.deepEqual(logicBindingsOf(afterScheme), [], "метки схемы ушли, а привязки остались");
  assert.equal(scenariosOf(afterScheme).length, 2, "удаление схемы унесло сценарии");

  // У объекта без привязок удаление метки списка не дописывает (G68).
  const bare = deleteMark(box.project, box.lampId).project;
  assert.equal(Object.prototype.hasOwnProperty.call(bare, "logicBindings"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(deleteScheme(box.project, box.schemeId).project, "logicBindings"), false);
});

test("сценарий со ссылкой на удалённое устройство — предупреждение в панели с переходом к сценарию", () => {
  const box = house();
  const block = addScenario(box.project, motionLight(box));
  assert.ok(!validate(block.project).some((item) => item.code === "scenarioDeviceMissing"), "живые метки — не предупреждение");

  const project = deleteMark(block.project, box.lampId).project;
  const problems = validate(project).filter((item) => item.code === "scenarioDeviceMissing");
  assert.equal(problems.length, 1, "одна строка на сценарий");
  assert.equal(problems[0].kind, "warning");
  assert.equal(problems[0].ref, block.scenario.id);
  assert.equal(problems[0].message, "Сценарий «Свет по движению» ссылается на удалённое устройство");

  const model = warningsModel(project);
  const group = model.groups.find((item) => item.code === "scenarioDeviceMissing");
  assert.ok(group, "в панели нет строки");
  assert.equal(group.title, "Сценариев со ссылкой на удалённое устройство: 1");
  assert.equal(WARNING_TARGETS.scenarioDeviceMissing, "scenario");
  assert.deepEqual(warningPlace(project, problems[0]), {
    markId: null,
    typeId: null,
    schemeId: null,
    point: null,
    scenarioId: block.scenario.id,
  });
  // Сценария больше нет — перехода нет.
  assert.equal(warningPlace(deleteScenario(project, block.scenario.id).project, problems[0]), null);
});

// ——— версия файла и упаковка ————————————————————————————————————————————

async function projectText(project) {
  const blob = await packProject(project, new Map());
  return { blob, text: new TextDecoder().decode((await readZip(blob)).get(PROJECT_ENTRY)) };
}

test("версия файла: 5 без сценариев и привязок, 6 — с ними", async () => {
  const box = house();
  assert.equal(FORMAT_VERSION, 5);
  assert.equal(FORMAT_VERSION_MAX, 6);
  assert.equal(projectFormatVersion(box.project), 5);
  const withScenario = addScenario(box.project, motionLight(box));
  assert.equal(projectFormatVersion(withScenario.project), 6);
  // Пустые списки — всё равно объект без сценариев.
  assert.equal(projectFormatVersion({ ...box.project, scenarios: [], logicBindings: [] }), 5);
  assert.equal(projectFormatVersion(deleteScenario(withScenario.project, withScenario.scenario.id).project), 5);

  const plain = await projectText(box.project);
  assert.equal(JSON.parse(plain.text).formatVersion, 5, "объект без сценариев пишется версией 5");
  const rich = await projectText(withScenario.project);
  assert.equal(JSON.parse(rich.text).formatVersion, 6, "объект со сценарием пишется версией 6");
  // Прежняя сборка принимала версии не выше 5: файл со сценариями она честно
  // отвергнет «файлом из более новой версии», а не потеряет сценарии слиянием.
  assert.ok(JSON.parse(rich.text).formatVersion > 5);
});

test("файл версии 6 читается, версии 7 — честный отказ futureVersion", async () => {
  const box = house();
  const project = addScenario(box.project, motionLight(box)).project;
  const text = (await projectText(project)).text;
  assert.match(text, /"formatVersion": 6/);
  const six = await unpackProject(await writeZip([{ name: PROJECT_ENTRY, data: text }]));
  assert.equal(six.project.formatVersion, 6);
  assert.equal(scenariosOf(six.project).length, 1);

  const seven = await writeZip([{ name: PROJECT_ENTRY, data: text.replace('"formatVersion": 6', '"formatVersion": 7') }]);
  await assert.rejects(unpackProject(seven), (error) => error.code === "futureVersion" && error.message.includes("7"));
});

test("упаковано = распаковано: сценарии, привязки, профили типов и свои настройки меток", async () => {
  const box = house();
  let project = setTypeDevice(box.project, box.project.markTypes.find((type) => type.code === "Т").id, { kind: "lightCct" }).project;
  project = setMarkDevice(project, box.motionId, { params: { resetSec: 15 } }).project;
  const logic = addScenario(project, { kind: "logic", name: "Логика", source: "info = {name: 'x'}", origin: "json", fileName: "x.json", template: { name: "x", active: true } });
  project = addScenario(logic.project, motionLight(box)).project;
  project = addLogicBinding(project, { scenarioId: logic.scenario.id, markId: box.lampId, service: 0, options: { level: 50 } }).project;

  const { blob } = await projectText(project);
  const restored = (await unpackProject(blob)).project;
  for (const key of ["scenarios", "logicBindings", "markTypes", "marks"]) {
    assert.deepEqual(restored[key], project[key], key + " потерялись при упаковке");
  }
  assert.equal(markDeviceOf(restored, box.lampId).kind, "lightCct");
  assert.equal(markDeviceOf(restored, box.motionId).params.resetSec, 15);

  // Повторная загрузка того же файла (7.4): id объекта новый, ссылки целы.
  const adopted = adoptLoadedProject({ project: restored, images: new Map() }, { mode: "new" }).project;
  assert.notEqual(adopted.id, restored.id);
  assert.deepEqual(adopted.scenarios, restored.scenarios);
  assert.deepEqual(adopted.logicBindings, restored.logicBindings);
});

test("миграция сценариев — в обоих конвейерах: висячие привязки уходят, объекту без них — тот же объект", async () => {
  const box = house();
  assert.equal(migrateScenarios(box.project).project, box.project);
  const logic = addScenario(box.project, { kind: "logic", name: "Логика" });
  let project = addLogicBinding(logic.project, { scenarioId: logic.scenario.id, markId: box.lampId }).project;
  assert.equal(migrateScenarios(project).project, project, "чистому объекту миграция что-то переписала");

  // Привязка на метку, которой нет, и на чужой сценарий — так объект мог
  // прийти из правки вне этой сборки.
  const dirty = {
    ...project,
    logicBindings: [
      ...project.logicBindings,
      { id: "висит-1", scenarioId: logic.scenario.id, markId: "нет-метки", service: 0, options: {}, active: true },
      { id: "висит-2", scenarioId: "нет-сценария", markId: box.lampId, service: 0, options: {}, active: true },
    ],
  };
  const migrated = migrateScenarios(dirty);
  assert.equal(migrated.changed, true);
  assert.deepEqual(logicBindingsOf(migrated.project).map((item) => item.id), [project.logicBindings[0].id]);
  assert.equal(migrateScenarios(migrated.project).project, migrated.project, "миграция не идемпотентна");

  // Конвейер базы браузера и конвейер файла приходят к одному.
  const stored = projectsMigrateStored(dirty);
  assert.deepEqual(stored.logicBindings, migrated.project.logicBindings);
  const text = JSON.stringify({ ...dirty, formatVersion: 6 });
  const opened = (await unpackProject(await writeZip([{ name: PROJECT_ENTRY, data: text }]))).project;
  assert.deepEqual(opened.logicBindings, migrated.project.logicBindings);
});
