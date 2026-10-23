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
import {
  PLAN_NAV_DRAG_SLOP_PX,
  PLAN_NAV_PAN_STEP_PX,
  PLAN_NAV_TOUCH_SLOP_PX,
  PLAN_NAV_ZOOM_MAX,
  PLAN_NAV_ZOOM_MIN,
  createPlanNav,
  planNavZoomAt,
} from "../src/planNav.js";
import { CANVAS_PAN_STEP_PX, canvasDragSlop, canvasPanSpeed, canvasZoomKey } from "../src/canvas.js";
import { miniPlanMarkAt, miniPlanSized } from "../src/panels/miniPlan.js";
import { planPickerSchemes } from "../src/panels/planPicker.js";
import { scenarioScriptFieldMarks, scenarioScriptSetOptions } from "../src/panels/scenarioScript.js";
import { SCENARIOS_LOGIC_GROUP, scenariosDeviceGroups } from "../src/panels/scenarios.js";
import { simHouse } from "./fixtures/simHome.js";

// Поле с видом в памяти — так ход видит любая поверхность.
function field(start = { zoom: 1, offsetX: 0, offsetY: 0 }) {
  let view = { ...start };
  const frames = { schedule: () => 1, cancel: () => {} };
  const nav = createPlanNav({ getView: () => view, setView: (next) => (view = next), box: () => ({ width: 800, height: 600 }), frames });
  return { nav, view: () => view };
}

test("ход один на все поля: мерки «Схемы» и окна — одни и те же числа", () => {
  // Правка после сборки сценариев: «в окне выбора метки двигаться как и на
  // схеме, включая все жесты… Переиспользуй везде один механизм».
  assert.equal(CANVAS_PAN_STEP_PX, PLAN_NAV_PAN_STEP_PX);
  assert.equal(canvasDragSlop({ touch: false }), PLAN_NAV_DRAG_SLOP_PX);
  assert.equal(canvasDragSlop({ touch: true }), PLAN_NAV_TOUCH_SLOP_PX);
  assert.equal(canvasZoomKey({ code: "Equal", key: "=" }), 1.2);
  assert.equal(canvasPanSpeed(0), 0, "короткое нажатие — шаг, а не ход");
});

test("масштаб к точке: точка под рукой стоит, пределы — как у «Схемы»", () => {
  const view = { zoom: 2, offsetX: 100, offsetY: 50 };
  const at = { x: 400, y: 300 };
  const zoomed = planNavZoomAt(view, at, 1.25);
  assert.equal(zoomed.zoom, 2.5);
  assert.ok(Math.abs((at.x - view.offsetX) / view.zoom - (at.x - zoomed.offsetX) / zoomed.zoom) < 1e-9);
  assert.ok(Math.abs((at.y - view.offsetY) / view.zoom - (at.y - zoomed.offsetY) / zoomed.zoom) < 1e-9);
  assert.equal(planNavZoomAt(view, at, 1e6).zoom, PLAN_NAV_ZOOM_MAX);
  assert.equal(planNavZoomAt(view, at, 1e-6).zoom, PLAN_NAV_ZOOM_MIN);
});

test("жесты поля: колесо мыши приближает, трекпад листает, стрелка шагает, «+» приближает середину", () => {
  const { nav, view } = field();
  // Щелчок колеса мыши — целые 100 по вертикали: масштаб.
  nav.wheel({ deltaX: 0, deltaY: -100, deltaMode: 0, ctrlKey: false, metaKey: false, timeStamp: 1000, preventDefault() {} }, { x: 0, y: 0 });
  assert.ok(view().zoom > 1, "колесо мыши не приблизило");
  // Двухпальцевый свайп трекпада — дробный шаг с горизонталью: ход.
  const { nav: pad, view: padView } = field();
  pad.wheel({ deltaX: 3.5, deltaY: 7.25, deltaMode: 0, ctrlKey: false, metaKey: false, timeStamp: 5000, preventDefault() {} }, { x: 0, y: 0 });
  assert.equal(padView().zoom, 1, "трекпад приблизил вместо хода");
  assert.notEqual(padView().offsetY, 0, "трекпад не листает");
  // Стрелка — шаг сразу.
  const { nav: keys, view: keysView } = field();
  assert.equal(keys.panKeyDown("ArrowRight"), true);
  assert.equal(keysView().offsetX, -PLAN_NAV_PAN_STEP_PX, "стрелка вправо не показала то, что правее");
  keys.panKeyUp(null);
  assert.equal(keys.zoomKey({ code: "Equal", key: "=" }), true);
  assert.ok(keysView().zoom > 1);
  assert.equal(keys.zoomKey({ code: "KeyA", key: "a" }), false);
});

test("перетаскивание: мышь поехала за три точки, палец — за десять; щипок приближает", () => {
  const { nav, view } = field();
  nav.dragStart({ x: 100, y: 100 }, { touch: false });
  assert.equal(nav.dragMove({ x: 102, y: 100 }), false, "дрожь руки стала ходом");
  assert.equal(nav.dragMove({ x: 140, y: 120 }), true);
  assert.deepEqual([view().offsetX, view().offsetY], [40, 20], "план отстал от руки");
  assert.equal(nav.dragEnd(), true);
  const { nav: finger } = field();
  finger.dragStart({ x: 100, y: 100 }, { touch: true });
  assert.equal(finger.dragMove({ x: 106, y: 100 }), false, "тап пальцем стал ходом");
  assert.equal(finger.dragEnd(), false);
  const { nav: pinch, view: pinchView } = field();
  pinch.pinchStart([{ x: 100, y: 100 }, { x: 200, y: 100 }]);
  assert.equal(pinch.pinchMove([{ x: 50, y: 100 }, { x: 250, y: 100 }]), true);
  assert.ok(pinchView().zoom > 1, "щипок не приблизил");
});

test("выбор на поле: ближайшая к руке метка из тех, что можно выбрать; «только эти метки» прячет остальные", () => {
  const box = simHouse();
  const scheme = findScheme(box.project, box.schemeId);
  const view = miniPlanSized(box.project, fitView(scheme, { width: 1200, height: 800 }));
  const lamp = box.project.marks.find((mark) => mark.id === box.marks["С1"]);
  const at = planToScreen(lamp.points[0], scheme, view);
  assert.equal(miniPlanMarkAt(box.project, scheme, at, view, null), box.marks["С1"]);
  assert.notEqual(miniPlanMarkAt(box.project, scheme, at, view, null, (id) => id === box.marks["В1"]), box.marks["С1"]);
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
