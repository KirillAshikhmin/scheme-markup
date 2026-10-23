// Схема в окне и выбор устройства на ней (правка после сборки сценариев).
//
// Слова заказчика: «в режиме сценарии у карты сделай кнопку, которая
// разворачивает её в большое окно, по которому можно двигаться как и по
// схеме, зумить и т.д. и выбирать так метку нужную, так же и в логике при
// выборе устройства из списка … рядом с полем добавь кнопку, которая тоже
// откроет эту карту — схему в окне, но только с теми метками, которые можно
// выбрать. Плюс после того как настроил логику, то что бы у устройства в
// списке по нажатию Опции не разворачивался список, а открывалось окно
// параметров логики, как и при добавлении. а так же устройства с
// активированной логикой пусть справа в списке меток помещаются наверху».
import test from "node:test";
import assert from "node:assert/strict";

import { addLogicBinding, addScenario, findLogicBinding, findScheme } from "../src/model.js";
import { fitView, planToScreen, visibleMarks } from "../src/render.js";
import { deviceAids } from "../src/sim/home.js";
import { planPickerMarkAt, planPickerSchemes, planPickerView, planPickerZoomAt, PLAN_PICKER_ZOOM_MAX } from "../src/panels/planPicker.js";
import { scenarioScriptFieldMarks, scenarioScriptSetOptions } from "../src/panels/scenarioScript.js";
import { SCENARIOS_LOGIC_GROUP, scenariosDeviceGroups } from "../src/panels/scenarios.js";
import { simHouse } from "./fixtures/simHome.js";

test("масштаб в окне — вокруг руки: точка под рукой остаётся на месте, приближение не бесконечно", () => {
  const view = { zoom: 2, offsetX: 100, offsetY: 50 };
  const at = { x: 400, y: 300 };
  const zoomed = planPickerZoomAt(view, at, 1.25, 2);
  assert.equal(zoomed.zoom, 2.5);
  // Точка плана под рукой: (at − offset) / zoom — одна и та же до и после.
  assert.ok(Math.abs((at.x - view.offsetX) / view.zoom - (at.x - zoomed.offsetX) / zoomed.zoom) < 1e-9);
  assert.ok(Math.abs((at.y - view.offsetY) / view.zoom - (at.y - zoomed.offsetY) / zoomed.zoom) < 1e-9);
  assert.equal(planPickerZoomAt(view, at, 1e6, 2).zoom, 2 * PLAN_PICKER_ZOOM_MAX);
});

test("выбор на схеме: ближайшая к руке метка из тех, что можно выбрать; «только эти метки» прячет остальные", () => {
  const box = simHouse();
  const scheme = findScheme(box.project, box.schemeId);
  const view = planPickerView(box.project, fitView(scheme, { width: 1200, height: 800 }));
  const lamp = box.project.marks.find((mark) => mark.id === box.marks["С1"]);
  const at = planToScreen(lamp.points[0], scheme, view);
  assert.equal(planPickerMarkAt(box.project, scheme, at, view, null, null), box.marks["С1"]);
  // Выбрать можно только выключатель — лампа под рукой не берётся.
  assert.notEqual(planPickerMarkAt(box.project, scheme, at, view, null, (id) => id === box.marks["В1"]), box.marks["С1"]);
  // Фильтр плана «только эти метки» (`markIds`) — поле опций логики.
  const only = new Set([box.marks["ДД1"], box.marks["С2"]]);
  assert.deepEqual(new Set(visibleMarks(box.project, scheme, { markIds: only }).map((mark) => mark.id)), only);
  assert.deepEqual(planPickerSchemes(box.project, only).map((item) => item.id), [box.schemeId]);
  assert.deepEqual(planPickerSchemes(box.project, new Set(["нет такой"])), []);
});

test("поле опций со списком устройств узнаётся по адресам хаба: aid, aid.sid, aid.sid.cid → метка", () => {
  const box = simHouse();
  const aids = deviceAids(box.project);
  const sensor = box.marks["ДТВ1"];
  const lamp = box.marks["С1"];
  const field = {
    key: "sensor",
    formType: "list",
    values: [
      { value: "", label: "Не выбрано" },
      { value: aids.get(sensor) + ".13", label: "Температура" },
      { value: aids.get(sensor) + ".15", label: "Влажность" },
      { value: String(aids.get(lamp)), label: "Лампа" },
      { value: 30, label: "30 минут" },
    ],
  };
  const marks = scenarioScriptFieldMarks(box.project, field);
  assert.deepEqual([...marks.keys()].sort(), [sensor, lamp].sort());
  assert.deepEqual(marks.get(sensor).map((item) => item.index), [1, 2], "у датчика два варианта");
  // Список без устройств — кнопки «на схеме» у него нет.
  assert.equal(scenarioScriptFieldMarks(box.project, { formType: "list", values: [{ value: 0, label: "Выкл" }, { value: 30, label: "30" }] }).size, 0);
  assert.equal(scenarioScriptFieldMarks(box.project, { formType: null, type: "Integer" }).size, 0);
});

test("опции привязки — окном и одним шагом; устройства с включённой логикой — первой группой списка", () => {
  const box = simHouse();
  const added = addScenario(box.project, { kind: "logic", name: "Свет", source: "info = {name: 'Свет'};\nfunction trigger(){}" });
  const bound = addLogicBinding(added.project, { scenarioId: added.scenario.id, markId: box.marks["С3"], service: 0, options: { delay: 9, mode: "a" } });
  const saved = scenarioScriptSetOptions(bound.project, bound.binding.id, { delay: 12, mode: "b" });
  assert.deepEqual(findLogicBinding(saved.project, bound.binding.id).options, { delay: 12, mode: "b" });
  assert.equal(scenarioScriptSetOptions(bound.project, bound.binding.id, {}), null, "пустая правка — шаг истории");
  // Список устройств справа: С3 с логикой — наверху, в своём помещении его нет.
  const groups = scenariosDeviceGroups(bound.project);
  assert.equal(groups[0].roomId, SCENARIOS_LOGIC_GROUP);
  assert.deepEqual(groups[0].devices.map((device) => device.markId), [box.marks["С3"]]);
  assert.ok(groups.slice(1).every((group) => group.devices.every((device) => device.markId !== box.marks["С3"])));
  // Выключенная привязка наверх не поднимает.
  const off = addLogicBinding(added.project, { scenarioId: added.scenario.id, markId: box.marks["С3"], service: 0, active: false });
  assert.notEqual(scenariosDeviceGroups(off.project)[0].roomId, SCENARIOS_LOGIC_GROUP);
});
