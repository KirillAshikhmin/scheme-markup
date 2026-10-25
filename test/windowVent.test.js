// Окна со створкой (правка без автопилота, 2026-10-25): окно, кроме витража в
// пол, открывается в «Объёме» той же рукой, что дверь; створка распахивается
// внутрь, климат проветривает комнату её площадью, датчик открытия в проёме
// окна ходит вместе с ним. В объект не пишется ничего (G68).
import test from "node:test";
import assert from "node:assert/strict";

import { addMark, applyMarkWalls, markDimensions, openingVentCell, openingVents, planMmToFraction, setMarkDimensions } from "../src/model.js";
import { climateStep } from "../src/sim/climate.js";
import { createSimEngine } from "../src/sim/engine.js";
import { buildHomeSpec, markDoorOf } from "../src/sim/home.js";
import { volumeClimateGeometry, volumeScene } from "../src/volume.js";
import { volumeDoorLine, volumeWindowLine } from "../src/panels/volume.js";
import { benchFlat } from "../tools/bench/scenes.mjs";

function flatWithWindow() {
  const box = benchFlat();
  const window = box.project.openings.find((opening) => opening.kind === "window");
  return { ...box, windowId: window.id, window };
}

test("какие окна открываются и какая у них створка", () => {
  for (const kind of ["window", "windowDouble", "windowTriple", "windowBalcony"]) assert.equal(openingVents(kind), true, kind);
  for (const kind of ["windowGlazing", "door", "arch", "opening"]) assert.equal(openingVents(kind), false, kind);
  assert.deepEqual(openingVentCell({ kind: "window", widthMm: 1500, heightMm: 1400 }), { fromShare: 0, toShare: 1, bottomShare: 0, topShare: 1 });
  assert.equal(openingVentCell({ kind: "windowDouble", widthMm: 1500, heightMm: 1400 }).toShare, 0.5);
  // Балконное: первая секция над поясом.
  const balcony = openingVentCell({ kind: "windowBalcony", widthMm: 3000, heightMm: 2500 });
  assert.ok(balcony.bottomShare > 0.3 && balcony.toShare < 0.34);
  assert.equal(openingVentCell({ kind: "windowGlazing", widthMm: 2000, heightMm: 2500 }), null);
});

test("в «Объёме» окно в своём списке, закрытое рисуется как прежде, открытое — створкой под прицелом", () => {
  const box = flatWithWindow();
  const closed = volumeScene(box.project, box.schemeId, { roofOff: true });
  assert.deepEqual(closed.windows, [box.windowId]);
  assert.ok(!closed.doors.includes(box.windowId), "окно попало в «все двери»");
  const open = volumeScene(box.project, box.schemeId, { roofOff: true, openDoorIds: new Set([box.windowId]) });
  const sash = open.faces.filter((face) => face.doorId === box.windowId);
  assert.equal(sash.length, 4, "у открытой створки четыре бруска");
  assert.equal(closed.faces.filter((face) => face.doorId === box.windowId).length, 0, "закрытое окно получило створку");
  assert.equal(open.faces.length, closed.faces.length + 4, "открытое окно изменило что-то кроме створки");
  // Откосы окна помечены им: глядя в проём, E находит окно.
  assert.ok(closed.faces.some((face) => face.doorway === box.windowId));
  // Створка — внутри комнаты: бруски не выходят за стену наружу.
  const wall = box.project.walls.find((item) => item.id === box.window.wallId);
  const outside = Math.max(wall.aMm.y, wall.bMm.y);
  for (const face of sash) for (const point of face.p) assert.ok(point.y <= outside + 1, "створка ушла на улицу: " + point.y);
});

test("климат: открытое окно проветривает комнату площадью створки, закрытое — нет", () => {
  const box = flatWithWindow();
  const geometry = volumeClimateGeometry(box.project);
  const way = geometry.ways.find((item) => item.id === box.windowId);
  assert.ok(way && way.window && way.ventMm2 > 0, "у окна нет площади створки");
  assert.equal(way.ventMm2, way.areaMm2, "одностворчатое окно открывается целиком");
  const room = way.a || way.b;
  const run = (open) => {
    const state = new Map(geometry.rooms.map((item) => [item.id, { t: 22, ah: 8, co2: 1200, people: 0 }]));
    for (let i = 0; i < 30; i += 1) climateStep(state, { tempC: -10, humidity: 80 }, geometry, open, new Map(), false, 60);
    return state.get(room);
  };
  const shut = run(new Set());
  const aired = run(new Set([box.windowId]));
  assert.ok(aired.t < shut.t - 1, "открытое окно не выстудило комнату: " + aired.t + " против " + shut.t);
  assert.ok(aired.co2 < shut.co2 - 100, "открытое окно не проветрило комнату: " + aired.co2 + " против " + shut.co2);
});

test("датчик открытия в проёме окна ходит вместе с окном", () => {
  const box = flatWithWindow();
  const wall = box.project.walls.find((item) => item.id === box.window.wallId);
  const along = Number(box.window.atMm) + Number(box.window.widthMm) / 2;
  const dx = wall.bMm.x - wall.aMm.x;
  const dy = wall.bMm.y - wall.aMm.y;
  const length = Math.hypot(dx, dy);
  const at = { x: wall.aMm.x + (dx / length) * along, y: wall.aMm.y + (dy / length) * along };
  const type = box.project.markTypes.find((item) => item.code === "ДО");
  const made = addMark(box.project, { schemeId: box.schemeId, typeId: type.id, kind: "point", points: [planMmToFraction(box.project, box.schemeId, at)] });
  const placed = applyMarkWalls(made.project, box.schemeId).project;
  // Геркон на раме — на высоте окна (800…2300).
  const mark = placed.marks.find((item) => item.id === made.mark.id);
  const project = setMarkDimensions(placed, made.mark.id, { ...markDimensions(mark), heightAboveFloor: 2000 }).project;
  assert.equal(markDoorOf(project, made.mark.id), box.windowId, "датчик в окне не нашёл своё окно");

  const sent = [];
  const engine = createSimEngine({ emit: (message) => sent.push(message) });
  engine.load(buildHomeSpec(project));
  engine.start({});
  engine.act({ kind: "door", openingId: box.windowId, open: true });
  const contact = engine.value(made.mark.id, 0, "ContactSensorState");
  assert.equal(contact, "CONTACT_NOT_DETECTED", "датчик не заметил открытое окно");
});

test("подсказка: про окна — своей строкой, «эта дверь» про окно не говорит", () => {
  const open = new Set(["w1"]);
  assert.equal(volumeWindowLine([], open, null, false), "");
  assert.match(volumeWindowLine(["w1", "w2"], open, "w1", false), /Окна: открыто 1 из 2\. Клик или E откроют и закроют створку этого окна\./);
  assert.match(volumeWindowLine(["w1"], open, null, true), /Касание по окну/);
  assert.doesNotMatch(volumeDoorLine(["d1"], new Set(), "w1", false), /эту дверь/);
});
