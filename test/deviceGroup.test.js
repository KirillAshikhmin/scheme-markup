// Общий аксессуар группы меток (правка после сборки сценариев).
//
// Слова заказчика: «Если в группе несколько светильников или других меток, то
// аксессуар пусть задаётся у первой, а у других нельзя менять — берётся от
// первой что бы и сценарию на одну делать, а распространяется на все метки в
// группе».
import test from "node:test";
import assert from "node:assert/strict";

import {
  addMark,
  addToGroup,
  deviceFollowers,
  findMark,
  markDeviceLeader,
  markDeviceOf,
  markDeviceOwn,
  markDeviceProfile,
  setMarkControls,
  setMarkDevice,
} from "../src/model.js";
import { buildHomeSpec, homeAccessories, homeLeadScenario, markAccessory } from "../src/sim/home.js";
import { deviceMarkField } from "../src/panels/deviceSettings.js";
import { deviceLiveKinds } from "../src/panels/deviceCard.js";
import { scenariosDeviceGroups } from "../src/panels/scenarios.js";
import { simHouse } from "./fixtures/simHome.js";

const typeByCode = (project, code) => project.markTypes.find((type) => type.code === code);

/** Квартира фикстуры и группа из трёх ламп «С» в ряд. */
function lampGroup() {
  const box = simHouse();
  const added = addMark(box.project, {
    schemeId: box.schemeId,
    typeId: typeByCode(box.project, "С").id,
    points: [
      { x: 0.3, y: 0.3 },
      { x: 0.35, y: 0.3 },
      { x: 0.4, y: 0.3 },
    ],
  });
  box.project = added.project;
  return { box, group: added.group, lamps: added.marks.map((mark) => mark.id) };
}

test("ведущая — первая метка группы своего типа; у другого типа в той же рамке ведущая своя", () => {
  const { box, group, lamps } = lampGroup();
  assert.ok(group && group.markIds.length === 3);
  const followers = deviceFollowers(box.project);
  assert.equal(followers.get(lamps[1]), lamps[0]);
  assert.equal(followers.get(lamps[2]), lamps[0]);
  assert.equal(markDeviceLeader(box.project, lamps[0]), null, "первая ведёт сама");
  // Розетка в ту же группу: своего типа она первая — ведёт сама.
  const socket = addToGroup(box.project, lamps[2], "right", { typeId: typeByCode(box.project, "Р").id });
  assert.equal(markDeviceLeader(socket.project, socket.mark.id), null);
  assert.equal(markDeviceLeader(socket.project, lamps[1]), lamps[0]);
  // Метки вне групп ведомыми не бывают.
  assert.equal(markDeviceLeader(box.project, box.marks["С1"]), null);
});

test("аксессуар ведомой — аксессуар первой: читается от неё, правится только у неё", () => {
  const { box, lamps } = lampGroup();
  // Первой задали свою настройку — ведомые видят её же.
  let project = setMarkDevice(box.project, lamps[0], { kind: "lightCct" }).project;
  assert.equal(markDeviceProfile(project, lamps[1]).kind, "lightCct");
  assert.equal(markDeviceProfile(project, lamps[1]).leader, lamps[0]);
  assert.equal(markDeviceOf(project, lamps[2]).kind, "lightCct");
  assert.equal(markDeviceOwn(project, lamps[1]), false, "у ведомой своей настройки нет");
  // Править ведомую нельзя — словами, кто ведёт.
  assert.throws(() => setMarkDevice(project, lamps[1], { kind: "light" }), /С\d+.*первой меткой группы/);
  assert.throws(() => setMarkDevice(project, lamps[1], undefined), /первой меткой группы/);
  // Строка метки говорит, чей аксессуар.
  const field = deviceMarkField(project, lamps[1]);
  assert.equal(field.leader, lamps[0]);
  assert.match(field.summary, /как у С\d+/);
  assert.deepEqual(Object.keys(deviceMarkField(project, lamps[0])).sort(), ["own", "summary"]);
});

test("G68: своя настройка, записанная ведомой до правки, не стирается — просто не читается", () => {
  const { box, lamps } = lampGroup();
  // Так лежит метка прежнего объекта: своя настройка у второй лампы группы.
  const marks = box.project.marks.map((mark) => (mark.id === lamps[1] ? { ...mark, device: { kind: "lightRgb" } } : mark));
  const project = { ...box.project, marks };
  assert.equal(markDeviceProfile(project, lamps[1]).kind, markDeviceProfile(project, lamps[0]).kind);
  assert.deepEqual(findMark(project, lamps[1]).device, { kind: "lightRgb" }, "запись ведомой пропала");
});

test("в доме имитации группа — один аксессуар: связи, сценарии и щелчок достаются первой", () => {
  const { box, lamps } = lampGroup();
  // Клавиша В1 управляет **второй** лампой группы.
  let project = setMarkControls(box.project, box.marks["В1"], [{ id: lamps[1], channel: null }]).project;
  const ids = homeAccessories(project).map((accessory) => accessory.markId);
  assert.ok(ids.includes(lamps[0]));
  assert.ok(!ids.includes(lamps[1]) && !ids.includes(lamps[2]), "у ведомых свой аксессуар");
  // Щелчок по любой лампе группы — её общий аксессуар.
  assert.equal(markAccessory(project, lamps[2]).markId, lamps[0]);
  const spec = buildHomeSpec(project);
  const link = spec.links.find((item) => item.markId === box.marks["В1"]);
  assert.deepEqual(link.targets, [lamps[0]], "клавиша управляет не общим аксессуаром");
  // Сценарий, собранный на ведомую, исполняется на первой.
  const scenario = { id: "s", kind: "block", targets: [{ type: "device", ref: { markId: lamps[2], service: 0 }, items: [] }] };
  assert.equal(homeLeadScenario(project, scenario).targets[0].ref.markId, lamps[0]);
  assert.equal(scenario.targets[0].ref.markId, lamps[2], "сценарий объекта переписан");
  // В списке устройств сценариев группа — одной строкой.
  const listed = scenariosDeviceGroups(project).flatMap((group) => group.devices.map((device) => device.markId));
  assert.ok(listed.includes(lamps[0]) && !listed.includes(lamps[1]));
});

test("знак состояния: ведомая рисуется видом ведущей и светит своё помещение", () => {
  const { box, lamps } = lampGroup();
  const kinds = deviceLiveKinds(box.project);
  assert.ok(kinds.get(lamps[0]), "у ведущей нет знака");
  for (const lamp of lamps.slice(1)) {
    assert.ok(kinds.get(lamp), "ведомая без знака — «Объём» её не зажжёт");
    assert.equal(kinds.get(lamp).kind, kinds.get(lamps[0]).kind);
  }
});
