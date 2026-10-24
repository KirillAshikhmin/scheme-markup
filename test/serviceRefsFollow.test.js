// Ссылка сценария на сервис идёт за сервисом (известный баг «ВВ 2→3»): блоки и
// привязки логики помнят место сервиса в развёрнутом профиле, а смена числа
// каналов, профиля или типа это место сдвигает. Команды модели переводят ссылки
// сами, ссылка на пропавшую клавишу не оживает чужим сервисом.
import test from "node:test";
import assert from "node:assert/strict";

import {
  addLogicBinding,
  addMark,
  addScenario,
  addScheme,
  changeMarkType,
  createProject,
  findLogicBinding,
  findScenario,
  followServiceRefs,
  markDeviceOf,
  setMarkDevice,
  updateType,
  validate,
} from "../src/model.js";
import { WARNING_TARGETS } from "../src/panels/warnings.js";

function switchHouse(code = "ВВ") {
  const added = addScheme(createProject(), { name: "1 этаж", imageId: null, width: 1000, height: 800 });
  let project = added.project;
  const typeOf = (wanted) => project.markTypes.find((type) => type.code === wanted).id;
  const key = addMark(project, { schemeId: added.scheme.id, typeId: typeOf(code), points: [{ x: 0.2, y: 0.2 }] });
  project = key.project;
  const lamp = addMark(project, { schemeId: added.scheme.id, typeId: typeOf("Т"), points: [{ x: 0.4, y: 0.2 }] });
  project = lamp.project;
  return { project, typeOf, switchId: key.mark.id, lampId: lamp.mark.id, typeId: typeOf(code) };
}

// Место сервиса метки по виду и каналу.
function placeOf(project, markId, type, channel) {
  return markDeviceOf(project, markId).services.findIndex((service) => service.type === type && service.channel === channel);
}

// «Нажали клавишу `channel` — включить свет»: триггер по кнопке, действие — на лампу.
function pressLight(box, project, channel) {
  return {
    kind: "block",
    name: "Клавиша " + channel,
    targets: [
      {
        type: "if",
        id: "b" + channel,
        if: {
          type: "group",
          id: "g" + channel,
          mode: "OR",
          conditions: [
            {
              type: "device",
              id: "c" + channel,
              ref: { markId: box.switchId, service: placeOf(project, box.switchId, "StatelessProgrammableSwitch", channel), char: "ProgrammableSwitchEvent" },
              op: "eq",
              value: 0,
              trigger: true,
            },
          ],
        },
        then: [{ type: "device", id: "a" + channel, ref: { markId: box.lampId, service: 0 }, items: [{ char: "On", verb: "set", value: true }] }],
        else: null,
        every: null,
      },
    ],
  };
}

function refOf(project, scenarioId) {
  return findScenario(project, scenarioId).targets[0].if.conditions[0].ref;
}

test("ВВ → три клавиши: ссылки блоков и привязки логики остаются на своих кнопках и реле", () => {
  const box = switchHouse();
  let project = box.project;
  const first = addScenario(project, pressLight(box, project, 1));
  const second = addScenario(first.project, pressLight(box, first.project, 2));
  const logic = addScenario(second.project, { kind: "logic", name: "Логика", source: "info = {}" });
  const relay = addLogicBinding(logic.project, {
    scenarioId: logic.scenario.id,
    markId: box.switchId,
    service: placeOf(logic.project, box.switchId, "Switch", 2),
  });
  const button = addLogicBinding(relay.project, {
    scenarioId: logic.scenario.id,
    markId: box.switchId,
    service: placeOf(relay.project, box.switchId, "StatelessProgrammableSwitch", 1),
  });
  project = button.project;
  assert.equal(refOf(project, first.scenario.id).service, 2, "фикстура: кнопка 1 у ВВ — место 2");

  const wider = updateType(project, box.typeId, { channels: 3 }).project;
  assert.equal(refOf(wider, first.scenario.id).service, placeOf(wider, box.switchId, "StatelessProgrammableSwitch", 1));
  assert.equal(refOf(wider, second.scenario.id).service, placeOf(wider, box.switchId, "StatelessProgrammableSwitch", 2));
  assert.equal(findLogicBinding(wider, relay.binding.id).service, placeOf(wider, box.switchId, "Switch", 2), "привязка к реле 2 уехала");
  assert.equal(findLogicBinding(wider, button.binding.id).service, placeOf(wider, box.switchId, "StatelessProgrammableSwitch", 1));
  assert.equal(findScenario(wider, first.scenario.id).targets[0].then[0].ref.service, 0, "ссылка на лампу тронута");
  assert.equal(findScenario(wider, logic.scenario.id), findScenario(project, logic.scenario.id), "логический сценарий переписан зря");
  assert.ok(!validate(wider).some((item) => item.code === "scenarioServiceMissing"));

  // Обратно 3 → 2 — ссылки возвращаются на прежние места.
  const back = updateType(wider, box.typeId, { channels: 2 }).project;
  assert.equal(refOf(back, first.scenario.id).service, 2);
  assert.equal(refOf(back, second.scenario.id).service, 3);
  assert.equal(findLogicBinding(back, relay.binding.id).service, 1);
});

test("ВВВ → две клавиши: ссылка на третью кнопку не переезжает на чужой сервис и даёт предупреждение", () => {
  const box = switchHouse("ВВВ");
  const third = addScenario(box.project, pressLight(box, box.project, 3));
  const first = addScenario(third.project, pressLight(box, third.project, 1));
  const narrow = updateType(first.project, box.typeId, { channels: 2 }).project;
  const services = markDeviceOf(narrow, box.switchId).services;
  assert.ok(refOf(narrow, third.scenario.id).service >= services.length, "ссылка на пропавшую кнопку смотрит на живой сервис");
  assert.equal(refOf(narrow, first.scenario.id).service, placeOf(narrow, box.switchId, "StatelessProgrammableSwitch", 1));

  const problems = validate(narrow).filter((item) => item.code === "scenarioServiceMissing");
  assert.equal(problems.length, 1, "одна строка на сценарий с пропавшим сервисом");
  assert.equal(problems[0].ref, third.scenario.id);
  assert.equal(problems[0].message, "Сценарий «Клавиша 3» ссылается на сервис, которого у аксессуара больше нет");
  assert.equal(WARNING_TARGETS.scenarioServiceMissing, "scenario");

  // Канал вернули — пропавшая ссылка сама не оживает: её выбирают заново.
  const again = updateType(narrow, box.typeId, { channels: 3 }).project;
  assert.ok(refOf(again, third.scenario.id).service >= markDeviceOf(again, box.switchId).services.length);
  assert.ok(validate(again).some((item) => item.code === "scenarioServiceMissing"));
});

test("смена типа метки и своя настройка аксессуара тоже переводят ссылки", () => {
  const box = switchHouse();
  const scenario = addScenario(box.project, pressLight(box, box.project, 2));
  const retyped = changeMarkType(scenario.project, box.switchId, box.typeOf("ВВВ")).project;
  assert.equal(refOf(retyped, scenario.scenario.id).service, placeOf(retyped, box.switchId, "StatelessProgrammableSwitch", 2));

  // Свой профиль метки: кнопок больше нет — ссылка уходит за конец списка.
  const relaysOnly = setMarkDevice(scenario.project, box.switchId, { services: [{ type: "Switch", chars: ["On"], perChannel: true }] }).project;
  assert.equal(markDeviceOf(relaysOnly, box.switchId).services.length, 2);
  assert.ok(refOf(relaysOnly, scenario.scenario.id).service >= 2);
});

test("без сдвига — тот же объект: правка имени типа и объект без сценариев не переписываются", () => {
  const box = switchHouse();
  const scenario = addScenario(box.project, pressLight(box, box.project, 1));
  const renamed = updateType(scenario.project, box.typeId, { name: "Двухклавишный" }).project;
  assert.equal(findScenario(renamed, scenario.scenario.id), findScenario(scenario.project, scenario.scenario.id));
  const bare = updateType(box.project, box.typeId, { channels: 3 }).project;
  assert.equal(Object.prototype.hasOwnProperty.call(bare, "scenarios"), false, "объекту без сценариев дописан список (G68)");
  assert.equal(followServiceRefs(scenario.project, scenario.project), scenario.project);
});
