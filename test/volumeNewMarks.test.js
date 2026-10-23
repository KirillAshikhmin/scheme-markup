// Датчик климата, тёплый пол, термостат и новогодняя ель в «Объёме» (правки
// после сборки сценариев).
//
// Слова заказчика: «Датчики климата (метку) изображай как 3 шкалы вертикальных
// как на ртутном градуснике. С реальным значением в комнате расположения»;
// «добавь теплые полы и им значение можно напрямую задавать или через
// термостат»; «добавь метку Новогодняя ель. Ставится на пол, модель — ёлка, у
// которой можно включить гирлянду и звезду наверху».
import test from "node:test";
import assert from "node:assert/strict";

import { addMark, addOutline, addRoom, addScheme, applyMarkWalls, createProject, planMmToFraction, setPlanOrigin, setPlanScale, setSchemeWallHeight, addWall } from "../src/model.js";
import { markAccessory } from "../src/sim/home.js";
import { simLiveOf } from "../src/sim/live.js";
import {
  VOLUME_HEAT_GLOW_RGB,
  VOLUME_SCALES,
  volumeCo2Rgb,
  volumeLiveLight,
  volumeLiveSigns,
  volumeMarkPlace,
  volumeScene,
} from "../src/volume.js";
import { deviceServiceRole } from "../src/panels/deviceSettings.js";

function stand() {
  const added = addScheme(createProject(), { name: "1 этаж", imageId: "plan-1", width: 1200, height: 800 });
  let project = setPlanScale(added.project, added.scheme.id, { a: { x: 0.1, y: 0.5 }, b: { x: 0.6, y: 0.5 }, meters: 6 }).project;
  project = setPlanOrigin(project, added.scheme.id, { at: { x: 0.5, y: 0.5 }, turn: 0 }).project;
  project = setSchemeWallHeight(project, added.scheme.id, 2700).project;
  const schemeId = added.scheme.id;
  const fr = (point) => planMmToFraction(project, schemeId, point);
  const outer = [
    { x: -3000, y: -2000 },
    { x: 3000, y: -2000 },
    { x: 3000, y: 2000 },
    { x: -3000, y: 2000 },
  ];
  outer.forEach((point, index) => {
    project = addWall(project, { schemeId, aMm: point, bMm: outer[(index + 1) % 4], thicknessMm: 200 }).project;
  });
  const made = addRoom(project, "Гостиная");
  project = made.project;
  project = addOutline(project, {
    schemeId,
    roomId: made.room.id,
    points: [{ x: -2900, y: -1900 }, { x: 2900, y: -1900 }, { x: 2900, y: 1900 }, { x: -2900, y: 1900 }].map(fr),
  }).project;
  const marks = {};
  const put = (key, code, at) => {
    const type = project.markTypes.find((item) => item.code === code);
    const added = addMark(project, { schemeId, typeId: type.id, kind: "point", points: [fr(at)] });
    project = added.project;
    marks[key] = added.marks[0].id;
  };
  put("sensor", "ДК", { x: -2950, y: 0 });
  put("tree", "НЕ", { x: 0, y: 0 });
  put("floor", "ТП", { x: 1500, y: 1000 });
  project = applyMarkWalls(project, schemeId).project;
  return { project, schemeId, marks, roomId: made.room.id };
}

const liveOf = (box, key, values) => {
  const accessory = markAccessory(box.project, box.marks[key]);
  return { ...simLiveOf(accessory, values), kind: accessory.services.some((service) => service.type === "Lightbulb") ? "light" : "other", roomId: box.roomId };
};

test("датчик климата: три трубки, столбики по значениям его комнаты", () => {
  const box = stand();
  const scene = volumeScene(box.project, box.schemeId, { roofOff: true });
  const place = volumeMarkPlace(scene, box.marks.sensor);
  assert.equal(place.view.name, "climateSensor", "датчик климата не своей моделью");
  assert.equal(place.model.parts.filter((part) => part.name.startsWith("tube")).length, 3, "трубок не три");
  const accessory = markAccessory(box.project, box.marks.sensor);
  assert.deepEqual(accessory.services.map((service) => service.type), ["TemperatureSensor", "HumiditySensor", "CarbonDioxideSensor"]);
  const signsAt = (t, rh, co2) =>
    volumeLiveSigns(scene, new Map([[box.marks.sensor, liveOf(box, "sensor", { "0.CurrentTemperature": t, "1.CurrentRelativeHumidity": rh, "2.CarbonDioxideLevel": co2 })]]));
  const heightOf = (face) => Math.max(...face.p.map((point) => point.z)) - Math.min(...face.p.map((point) => point.z));
  const bars = (signs) => signs.filter((face) => face.p.length === 4);
  const cold = bars(signsAt(0, 30, 450));
  const warm = bars(signsAt(30, 80, 1500));
  assert.equal(cold.length, 3, "столбиков не три");
  for (let index = 0; index < 3; index += 1) assert.ok(heightOf(warm[index]) > heightOf(cold[index]), VOLUME_SCALES[index].key + ": столбик не растёт со значением");
  // CO₂ меняет цвет: свежо — зелёный, душно — красный.
  assert.deepEqual(warm[2].rgb, volumeCo2Rgb(1500));
  assert.notDeepEqual(cold[2].rgb, warm[2].rgb);
  // Дом не идёт — живого состояния нет — столбиков нет.
  assert.equal(volumeLiveSigns(scene, new Map()).length, 0);
});

test("ель: стоит на полу, гирлянда и звезда горят порознь", () => {
  const box = stand();
  const scene = volumeScene(box.project, box.schemeId, { roofOff: true });
  const place = volumeMarkPlace(scene, box.marks.tree);
  assert.equal(place.view.name, "xmasTree");
  assert.equal(place.frame.bottomMm, 0, "ель не стоит на полу");
  assert.ok(place.model.parts.some((part) => part.kind === "cone"), "хвоя не конусом");
  const accessory = markAccessory(box.project, box.marks.tree);
  assert.deepEqual(accessory.services.map((service) => service.type), ["Lightbulb", "Lightbulb"]);
  assert.equal(deviceServiceRole(accessory.kind, accessory.services[0]), "Гирлянда");
  assert.equal(deviceServiceRole(accessory.kind, accessory.services[1]), "Звезда");
  const lit = (values) => volumeLiveSigns(scene, new Map([[box.marks.tree, liveOf(box, "tree", values)]]));
  const garlandOnly = lit({ "0.On": true, "1.On": false });
  const starOnly = lit({ "0.On": false, "1.On": true });
  const star = (signs) => signs.filter((face) => face.p.length === 10);
  const bulbs = (signs) => signs.filter((face) => face.p.length !== 10);
  assert.ok(bulbs(garlandOnly).length > 20 && bulbs(garlandOnly).every((face) => face.led === true), "гирлянда не горит");
  assert.ok(star(garlandOnly).every((face) => face.led !== true), "звезда горит без своей лампы");
  assert.ok(star(starOnly).length === 2 && star(starOnly).every((face) => face.led === true), "звезда не горит");
  assert.ok(bulbs(starOnly).every((face) => face.led !== true), "гирлянда горит без своей лампы");
  // Звезда модели — тело второй лампы.
  const light = volumeLiveLight(scene, new Map([[box.marks.tree, liveOf(box, "tree", { "0.On": true, "1.On": false })]]));
  assert.equal(light.glow.get(box.marks.tree).lamps[1], 0);
});

test("тёплый пол: на полу, свой термостат; греет — рдеет", () => {
  const box = stand();
  const scene = volumeScene(box.project, box.schemeId, { roofOff: true });
  const place = volumeMarkPlace(scene, box.marks.floor);
  assert.equal(place.view.name, "warmFloor");
  assert.equal(place.frame.bottomMm, 0);
  const accessory = markAccessory(box.project, box.marks.floor);
  assert.equal(accessory.kind, "warmFloor");
  assert.equal(accessory.services[0].type, "Thermostat");
  const heating = liveOf(box, "floor", { "0.TargetHeatingCoolingState": "HEAT", "0.CurrentHeatingCoolingState": "HEAT" });
  assert.equal(heating.heat, true);
  const light = volumeLiveLight(scene, new Map([[box.marks.floor, heating]]));
  assert.deepEqual(light.glow.get(box.marks.floor).rgb, VOLUME_HEAT_GLOW_RGB, "греющий пол не рдеет");
  const idle = liveOf(box, "floor", { "0.TargetHeatingCoolingState": "HEAT", "0.CurrentHeatingCoolingState": "OFF" });
  assert.equal(idle.heat, false);
});

// ——— сторона открывания шторы ——————————————————————————————————————————————

test("штора: сторона открывания — своя или та, что была; ткань собирается к ней", async () => {
  const { markCurtainSide, markIsCurtain, setMarkCurtainSide, updateMark } = await import("../src/model.js");
  const { volumeCurtainGather, volumeMarkFaces } = await import("../src/volume.js");
  const box = stand();
  let project = box.project;
  const type = project.markTypes.find((item) => item.code === "КШ");
  const fr = (point) => planMmToFraction(project, box.schemeId, point);
  const added = addMark(project, { schemeId: box.schemeId, typeId: type.id, kind: "point", points: [fr({ x: 0, y: -1950 })] });
  project = applyMarkWalls(added.project, box.schemeId).project;
  const id = added.marks[0].id;
  assert.equal(markIsCurtain(project, id), true, "карниз штор не штора");
  assert.equal(markIsCurtain(project, box.marks.sensor), false);
  // Своей стороны нет — штора открывается, как до правки, и сторона названа.
  const legacy = markCurtainSide(project, id);
  assert.ok(["left", "right"].includes(legacy));
  const sceneOf = (source) => volumeScene(source, box.schemeId, { roofOff: true });
  const xs = (source) => {
    const place = volumeMarkPlace(sceneOf(source), id);
    const cloth = volumeMarkFaces(place, [], 1).filter((face) => face.clear);
    const along = (point) => (point.x - place.frame.at.x) * place.frame.u.x + (point.y - place.frame.at.y) * place.frame.u.y;
    const values = cloth.flatMap((face) => face.p.map(along));
    return { min: Math.min(...values), max: Math.max(...values), place };
  };
  const before = xs(project);
  assert.equal(volumeCurtainGather(before.place, before.place.frame.u), "min", "без стороны ткань не к началу оси");
  // Та же сторона, названная руками, — та же картинка.
  const same = setMarkCurtainSide(project, id, legacy).project;
  assert.deepEqual(xs(same).min, before.min);
  // Другая сторона — ткань у другого края.
  const other = setMarkCurtainSide(project, id, legacy === "left" ? "right" : "left").project;
  const flipped = xs(other);
  assert.ok(flipped.max > before.max + 100, "другая сторона не увела ткань к другому краю");
  // От центра — ткань у обоих краёв.
  const both = xs(setMarkCurtainSide(project, id, "center").project);
  assert.ok(both.min <= before.min + 1 && both.max >= flipped.max - 1, "от центра — не к обоим краям");
  // Чужое значение модель не пишет; `null` возвращает «как было».
  assert.throws(() => setMarkCurtainSide(project, id, "up"));
  assert.equal(markCurtainSide(setMarkCurtainSide(other, id, null).project, id), legacy);
  // Старая метка без поля открывается как была (G68): поля не дописано.
  assert.equal(Object.prototype.hasOwnProperty.call(project.marks.find((mark) => mark.id === id), "curtainSide"), false);
  void updateMark;
});

test("бризер — тот же «Бризер», у которого в составе «Подогрев»", async () => {
  const { typeDeviceOf } = await import("../src/model.js");
  const { deviceWindowModel } = await import("../src/panels/deviceSettings.js");
  const { strings } = await import("../src/strings.js");
  const project = createProject();
  const type = project.markTypes.find((item) => item.code === "Б");
  const profile = typeDeviceOf(project, type.id);
  assert.equal(profile.kind, "breezer");
  // Вид назван просто «Бризер» — слова заказчика: «Бризер с подогревом это не
  // отдельный тип, это тот же бризер, у которого есть сервис Подогрев».
  assert.equal(strings.sim.kinds.breezer, "Бризер");
  const model = deviceWindowModel({ ...profile, decoupled: [], params: { ...profile.params } });
  assert.deepEqual(model.services.map((service) => service.label), [strings.sim.services.Fan, "Подогрев"]);
});

test("«Прозрачные объекты»: по умолчанию вещи чертежа просвечивают, снята — плотные", async () => {
  const { addSchemeObject, objectCatalogKeys } = await import("../src/model.js").then(async (model) => ({
    ...model,
    ...(await import("../src/objectCatalog.js")),
  }));
  const box = stand();
  const key = objectCatalogKeys().includes("sofa") ? "sofa" : objectCatalogKeys()[0];
  const project = addSchemeObject(box.project, {
    schemeId: box.schemeId,
    catalogKey: key,
    shape: "rect",
    atMm: { x: 1000, y: -1000 },
    widthMm: 1800,
    depthMm: 900,
  }).project;
  const objectFaces = (scene) => scene.faces.filter((face) => face.rgb && face.clear === true);
  const clear = volumeScene(project, box.schemeId, { roofOff: true });
  assert.ok(objectFaces(clear).length > 0 && objectFaces(clear).every((face) => face.alpha < 1), "по умолчанию вещь не просвечивает");
  assert.equal(clear.objectsClear, true);
  const solid = volumeScene(project, box.schemeId, { roofOff: true, objectsClear: false });
  assert.equal(objectFaces(solid).length, 0, "снятая отметка — а вещь просвечивает");
  assert.equal(solid.objectsClear, false);
  assert.equal(solid.faces.length, clear.faces.length, "плотная вещь — не та же вещь");
});

test("улица и дом в кадре: земля — улица (снег виден в окно и в дверь), пол и стены комнаты — дом", async () => {
  const { VOLUME_LAND_RGB, VOLUME_FLOOR_RGB, volumeFrame } = await import("../src/volume.js");
  const box = stand();
  const scene = volumeScene(box.project, box.schemeId, { roofOff: false });
  const land = scene.faces.filter((face) => face.rgb === VOLUME_LAND_RGB);
  assert.ok(land.length > 0 && land.every((face) => !face.indoor && !face.room), "земля записана в дом");
  const floors = scene.faces.filter((face) => face.rgb === VOLUME_FLOOR_RGB);
  assert.ok(floors.every((face) => face.room || face.indoor), "пол оказался улицей");
  // Кадр знает, где дом: многоугольники пола — дом, земли — улица.
  const frame = volumeFrame(scene, { at: { x: 0, y: 6000, z: 3000 }, yaw: -Math.PI / 2, pitch: -0.5 }, { width: 800, height: 500 });
  assert.ok(frame.some((polygon) => polygon.inside === false && !polygon.stroke), "в кадре нет улицы");
  assert.ok(frame.some((polygon) => polygon.inside === true), "в кадре нет дома");
});

test("«Стрелки связей» в «Объёме»: по умолчанию видны, отметка снимает и возвращает", async () => {
  // «Сделай опцией показ стрелок связей в объёме».
  const { volumeParamsFlag, volumeParamsRead, VOLUME_LINK_ARROWS_SETTING } = await import("../src/panels/volumeParams.js");
  assert.equal(VOLUME_LINK_ARROWS_SETTING, "volumeLinkArrows");
  assert.equal(volumeParamsRead().linkArrows, true, "по умолчанию стрелок нет");
  volumeParamsFlag("linkArrows", false);
  assert.equal(volumeParamsRead().linkArrows, false);
  volumeParamsFlag("linkArrows", true);
  assert.equal(volumeParamsRead().linkArrows, true);
});

test("Q — окно метки под прицелом: клавиша своя и ни с ходьбой, ни с дверями не спорит", async () => {
  // «В объёме по нажатию Q или на сенсоре по дополнительной кнопочке
  // открывать окно метки, иногда оно нужно».
  const { VOLUME_CARD_KEY, VOLUME_DOOR_KEY, VOLUME_DOORS_KEY, volumeKeyMove } = await import("../src/panels/volume.js");
  assert.equal(VOLUME_CARD_KEY, "KeyQ");
  assert.equal(volumeKeyMove(VOLUME_CARD_KEY), null, "Q снова ходит или вертит");
  assert.ok(VOLUME_CARD_KEY !== VOLUME_DOOR_KEY && VOLUME_CARD_KEY !== VOLUME_DOORS_KEY);
  const { strings } = await import("../src/strings.js");
  assert.match(strings.volume.pickHint, /Q — окно метки/, "про Q нигде не сказано");
  assert.match(strings.volume.hintTouch, /«i» — окно метки/, "про кнопку «i» нигде не сказано");
});
