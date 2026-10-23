// Одно обозначение — один аксессуар (правка после сборки сценариев).
//
// Слова заказчика: «Если в группе несколько светильников или других меток, то
// аксессуар пусть задаётся у первой, а у других нельзя менять — берётся от
// первой что бы и сценарию на одну делать, а распространяется на все метки в
// группе»; и уточнение: «Речь была не про группы меток, например розеток, а
// именно метки с одним идентификатором, например 4 точечных светильника с
// идентификатором Т1, в сценариях она должны быть одной сущностью».
import test from "node:test";
import assert from "node:assert/strict";

import {
  addMark,
  deviceFollowers,
  findMark,
  labelOf,
  markDeviceLeader,
  markDeviceOf,
  markDeviceOwn,
  markDeviceProfile,
  markDeviceShared,
  setMarkControls,
  setMarkDevice,
  setMarkNumber,
} from "../src/model.js";
import { buildHomeSpec, homeAccessories, homeLeadScenario, markAccessory } from "../src/sim/home.js";
import { deviceMarkField } from "../src/panels/deviceSettings.js";
import { deviceLiveKinds } from "../src/panels/deviceCard.js";
import { scenariosDeviceGroups } from "../src/panels/scenarios.js";
import { simHouse } from "./fixtures/simHome.js";

const typeByCode = (project, code) => project.markTypes.find((type) => type.code === code);

/** Квартира фикстуры и три точечных светильника «Т» с одним номером — как Т5, Т5, Т5 на плане. */
function sameLabel() {
  const box = simHouse();
  const added = addMark(box.project, {
    schemeId: box.schemeId,
    typeId: typeByCode(box.project, "Т").id,
    points: [
      { x: 0.3, y: 0.3 },
      { x: 0.35, y: 0.3 },
      { x: 0.4, y: 0.3 },
    ],
  });
  const lamps = added.marks.map((mark) => mark.id);
  let project = added.project;
  const number = findMark(project, lamps[0]).number;
  for (const id of lamps.slice(1)) project = setMarkNumber(project, id, number).project;
  box.project = project;
  return { box, lamps, group: added.group };
}

test("ведущая — первая метка с этим обозначением; группа-блок с разными номерами — каждая сама по себе", () => {
  const { box, lamps } = sameLabel();
  assert.equal(labelOf(box.project, lamps[0]), labelOf(box.project, lamps[2]), "номера не совпали");
  const followers = deviceFollowers(box.project);
  assert.equal(followers.get(lamps[1]), lamps[0]);
  assert.equal(followers.get(lamps[2]), lamps[0]);
  assert.equal(markDeviceLeader(box.project, lamps[0]), null, "первая ведёт сама");
  assert.equal(markDeviceShared(box.project, lamps[1]), 3);
  // Блок из трёх розеток — три номера, три аксессуара: группа тут ни при чём.
  const block = addMark(box.project, {
    schemeId: box.schemeId,
    typeId: typeByCode(box.project, "Р").id,
    points: [
      { x: 0.6, y: 0.6 },
      { x: 0.62, y: 0.6 },
    ],
  });
  assert.ok(block.group, "блок не сложился группой");
  for (const mark of block.marks) assert.equal(markDeviceLeader(block.project, mark.id), null, "розетка блока стала ведомой");
  assert.equal(markDeviceLeader(box.project, box.marks["С1"]), null);
});

test("аксессуар ведомой — аксессуар первой: читается от неё, правится только у неё", () => {
  const { box, lamps } = sameLabel();
  const project = setMarkDevice(box.project, lamps[0], { kind: "lightCct" }).project;
  assert.equal(markDeviceProfile(project, lamps[1]).kind, "lightCct");
  assert.equal(markDeviceProfile(project, lamps[1]).leader, lamps[0]);
  assert.equal(markDeviceOf(project, lamps[2]).kind, "lightCct");
  assert.equal(markDeviceOwn(project, lamps[1]), false, "у ведомой своей настройки нет");
  assert.throws(() => setMarkDevice(project, lamps[1], { kind: "light" }), /у первой Т\d+/);
  assert.throws(() => setMarkDevice(project, lamps[1], undefined), /у первой/);
  const field = deviceMarkField(project, lamps[1]);
  assert.equal(field.leader, lamps[0]);
  assert.match(field.summary, /общий для 3 меток Т\d+/);
  assert.match(deviceMarkField(project, lamps[0]).summary, /общий для 3 меток/, "у ведущей не сказано, что аксессуар общий");
  assert.deepEqual(Object.keys(deviceMarkField(project, box.marks["С1"])).sort(), ["own", "summary"]);
});

test("G68: своя настройка, записанная ведомой до правки, не стирается — просто не читается", () => {
  const { box, lamps } = sameLabel();
  const marks = box.project.marks.map((mark) => (mark.id === lamps[1] ? { ...mark, device: { kind: "lightRgb" } } : mark));
  const project = { ...box.project, marks };
  assert.equal(markDeviceProfile(project, lamps[1]).kind, markDeviceProfile(project, lamps[0]).kind);
  assert.deepEqual(findMark(project, lamps[1]).device, { kind: "lightRgb" }, "запись ведомой пропала");
  // Дали свой номер — своя настройка снова действует.
  const own = setMarkNumber(project, lamps[1], 99).project;
  assert.equal(markDeviceProfile(own, lamps[1]).kind, "lightRgb");
});

test("в доме имитации одно обозначение — один аксессуар: связи, сценарии и щелчок достаются первой", () => {
  const { box, lamps } = sameLabel();
  // Клавиша В1 управляет всеми тремя Т — как их и связывают на плане.
  const project = setMarkControls(box.project, box.marks["В1"], lamps.map((id) => ({ id, channel: null }))).project;
  const ids = homeAccessories(project).map((accessory) => accessory.markId);
  assert.ok(ids.includes(lamps[0]));
  assert.ok(!ids.includes(lamps[1]) && !ids.includes(lamps[2]), "у ведомых свой аксессуар");
  assert.equal(markAccessory(project, lamps[2]).markId, lamps[0]);
  const link = buildHomeSpec(project).links.find((item) => item.markId === box.marks["В1"]);
  assert.deepEqual(link.targets, [lamps[0]], "клавиша управляет не одним устройством");
  const scenario = { id: "s", kind: "block", targets: [{ type: "device", ref: { markId: lamps[2], service: 0 }, items: [] }] };
  assert.equal(homeLeadScenario(project, scenario).targets[0].ref.markId, lamps[0]);
  assert.equal(scenario.targets[0].ref.markId, lamps[2], "сценарий объекта переписан");
  const listed = scenariosDeviceGroups(project).flatMap((group) => group.devices.map((device) => device.markId));
  assert.ok(listed.includes(lamps[0]) && !listed.includes(lamps[1]), "в списке устройств сценариев Т не одной строкой");
});

test("знак состояния: ведомая рисуется видом ведущей и светит своё помещение", () => {
  const { box, lamps } = sameLabel();
  const kinds = deviceLiveKinds(box.project);
  assert.ok(kinds.get(lamps[0]), "у ведущей нет знака");
  for (const lamp of lamps.slice(1)) {
    assert.ok(kinds.get(lamp), "ведомая без знака — «Объём» её не зажжёт");
    assert.equal(kinds.get(lamp).kind, kinds.get(lamps[0]).kind);
  }
});
