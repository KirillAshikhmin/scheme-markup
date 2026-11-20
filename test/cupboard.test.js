// Шкафы открываются, а подсветка внутри идёт за дверцами (правка без
// автопилота, 2026-11-20). Слова заказчика: «сделай что бы шкафы открывались и
// подсветку в них реализуй».
import test from "node:test";
import assert from "node:assert/strict";
import {
  addMark,
  addScheme,
  addSchemeObject,
  createProject,
  setPlanOrigin,
  setPlanScale,
  updateMark,
} from "../src/model.js";
import { objectModelByKey } from "../src/objectModels/registry.js";
import {
  VOLUME_CUPBOARD_LEAF_MM,
  volumeCupboardId,
  volumeCupboardMarks,
  volumeCupboardModel,
  volumeCupboardObjectId,
  volumeModelOpens,
  volumeScene,
} from "../src/volume.js";
import { volumeCupboardLamps, volumeCupboardLine, volumeOpenAlive } from "../src/panels/volume.js";

function home() {
  let project = createProject();
  const added = addScheme(project, { name: "План", imageId: "i", width: 1000, height: 1000 });
  project = added.project;
  const schemeId = added.scheme.id;
  // 1000 точек плана — 10 метров: точка плана — 10 мм.
  project = setPlanScale(project, schemeId, { a: { x: 0, y: 0 }, b: { x: 1, y: 0 }, meters: 10 }).project;
  project = setPlanOrigin(project, schemeId, { at: { x: 0, y: 0 }, turn: 0 }).project;
  return { project, schemeId };
}

test("створки есть у шкафа и кухонного шкафа, у стеллажа и радиатора их нет", () => {
  assert.equal(volumeModelOpens(objectModelByKey("cabinet")), true);
  assert.equal(volumeModelOpens(objectModelByKey("kitchenCabinet")), true);
  assert.equal(volumeModelOpens(objectModelByKey("shelving")), false);
  assert.equal(volumeModelOpens(objectModelByKey("radiator")), false);
});

test("имя шкафа в множестве открытого — с приставкой и читается обратно", () => {
  assert.equal(volumeCupboardObjectId(volumeCupboardId("5")), "5");
  // Голый номер — дверь или окно: проём 5 и вещь 5 живут одновременно.
  assert.equal(volumeCupboardObjectId("5"), null);
});

test("открытая створка стоит перед лицом доской, широкая делится, петли чередуются", () => {
  const model = objectModelByKey("cabinet");
  const frame = { widthMm: 2400, depthMm: 600, heightMm: 2500 };
  const parts = volumeCupboardModel(model, frame);
  const leaves = parts.filter((part) => part.leaf);
  assert.equal(leaves.length, Math.round((0.92 * 2400) / VOLUME_CUPBOARD_LEAF_MM));
  for (const leaf of leaves) {
    assert.ok(leaf.y + leaf.depth <= -0.5 + 1e-9, "створка осталась внутри габарита");
    assert.ok(Math.abs(leaf.width * frame.widthMm - 20) < 1e-6, "створка не доска");
    assert.ok(Math.abs(leaf.depth * frame.depthMm - (0.92 * 2400) / leaves.length) < 1e-6, "створка другой ширины");
  }
  // Первая висит на левом краю своего места, вторая — на правом.
  assert.ok(Math.abs(leaves[0].x - -0.46) < 1e-9);
  assert.ok(Math.abs(leaves[1].x + leaves[1].width - (-0.46 + (2 * 0.92) / leaves.length)) < 1e-9);
  // Корпус на месте, закрытого фасада больше нет.
  assert.ok(parts.some((part) => part.name === "case"));
  assert.ok(!parts.some((part) => part.name === "door"));
});

test("сцена знает шкафы, створки отвечают на щелчок, открытый шкаф выходит из габарита", () => {
  let { project, schemeId } = home();
  const added = addSchemeObject(project, { schemeId, catalogKey: "cabinet", atMm: { x: 2000, y: 2000 }, widthMm: 1000, depthMm: 600, turnDeg: 0, heightMm: 2000 });
  project = added.project;
  const shelf = addSchemeObject(project, { schemeId, catalogKey: "shelving", atMm: { x: 5000, y: 2000 }, widthMm: 1000, depthMm: 400, turnDeg: 0, heightMm: 2000 });
  project = shelf.project;
  const id = volumeCupboardId(added.schemeObject.id);
  const shut = volumeScene(project, schemeId, {});
  assert.deepEqual(shut.cupboards, [id]);
  const leafShut = shut.faces.filter((face) => face.doorId === id);
  assert.ok(leafShut.length > 0, "у закрытого шкафа створка без хозяина");
  const open = volumeScene(project, schemeId, { openDoorIds: new Set([id]) });
  const leafOpen = open.faces.filter((face) => face.doorId === id);
  const reach = (faces) => Math.max(...faces.flatMap((face) => face.p.map((point) => point.y)));
  // При нулевом повороте вещь смотрит вниз по листу: лицо на y = 2300.
  assert.ok(reach(leafShut) <= 2300 + 1e-6);
  assert.ok(reach(leafOpen) > 2300 + 400, "открытая створка не распахнулась");
  assert.deepEqual(volumeOpenAlive(open, { doors: [id, "thing:нет такой"], sheers: [] }).doors, [id]);
});

test("лампы шкафа — метки внутри его габарита, по высоте и по аксессуару", () => {
  let { project, schemeId } = home();
  const cabinet = addSchemeObject(project, { schemeId, catalogKey: "cabinet", atMm: { x: 2000, y: 2000 }, widthMm: 1000, depthMm: 600, turnDeg: 0, heightMm: 2400 });
  project = cabinet.project;
  const low = addSchemeObject(project, { schemeId, catalogKey: "cabinet", atMm: { x: 6000, y: 2000 }, widthMm: 1000, depthMm: 600, turnDeg: 0, heightMm: 800 });
  project = low.project;
  const type = (code) => project.markTypes.find((item) => item.code === code);
  const put = (code, points, patch = {}) => {
    const made = addMark(project, { schemeId, typeId: type(code).id, kind: type(code).kind, points });
    project = Object.keys(patch).length ? updateMark(made.project, made.mark.id, patch).project : made.project;
    return made.mark.id;
  };
  const strip = put("ПШ", [{ x: 0.16, y: 0.2 }, { x: 0.24, y: 0.2 }]);
  const outside = put("ПШ", [{ x: 0.4, y: 0.2 }, { x: 0.45, y: 0.2 }]);
  const socket = put("Р", [{ x: 0.2, y: 0.21 }], { heightAboveFloor: 300 });
  const spotOverLow = put("Т", [{ x: 0.6, y: 0.2 }]);
  const inLow = put("Л", [{ x: 0.58, y: 0.2 }, { x: 0.62, y: 0.2 }], { heightAboveFloor: 700 });
  const inside = volumeCupboardMarks(project, schemeId, cabinet.schemeObject, 2700);
  assert.ok(inside.includes(strip) && inside.includes(socket) && !inside.includes(outside));
  // Розетка в шкафу — не лампа: зажигать её нечем.
  assert.deepEqual(volumeCupboardLamps(project, schemeId, cabinet.schemeObject.id, 2700).map((lamp) => lamp.markId), [strip]);
  // Точечный светильник над комодом — не подсветка комода; лента на его высоте — подсветка.
  assert.deepEqual(volumeCupboardMarks(project, schemeId, low.schemeObject, 2700), [inLow]);
  assert.ok(!volumeCupboardMarks(project, schemeId, low.schemeObject, 2700).includes(spotOverLow));
});

test("строка подсказки про шкафы", () => {
  const open = new Set(["thing:1"]);
  assert.equal(volumeCupboardLine([], open, null, false), "");
  assert.match(volumeCupboardLine(["thing:1", "thing:2"], open, "thing:1", false), /Шкафы: открыто 1 из 2\. Клик или E откроют и закроют дверцы этого шкафа/);
  assert.match(volumeCupboardLine(["thing:1"], open, null, true), /Касание по шкафу/);
});
