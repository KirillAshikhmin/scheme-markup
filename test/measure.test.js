// Линейка: измерить расстояние в «Чертеже», «Схеме» и «Объёме» (таск 237,
// G356–G358).
//
// Чистых швов у инструмента три, и все три здесь:
//
//   арифметика отрезка и его подписи (`src/measure.js`) — миллиметры чертежа,
//     метры по калибровке плана, прямое расстояние с разложением в объёме;
//   хранение мерки на сеанс — один отрезок на поле, третий щелчок начинает
//     новый, смена схемы или объекта мерку снимает;
//   обратный ход «точка кадра → точка на грани» (`volumeSurfaceAt`) — то, чего
//     в сборке не было вовсе: что под прицелом, где это в миллиметрах и годится
//     ли оно под конец отрезка.
//
// DOM, холст и события тестами не покрываются нарочно — их держит живой прогон.
import test from "node:test";
import assert from "node:assert/strict";

import {
  MEASURE_COLOR,
  MEASURE_FIELDS,
  measureAdd,
  measureAim,
  measureDrawingLines,
  measureDrop,
  measureDropAll,
  measureEnds,
  measureKeyOf,
  measureMmText,
  measureParts,
  measurePlanLines,
  measureSpan,
  measureStarted,
  measureVolumeLines,
} from "../src/measure.js";
import { measureButtonShown, measureButtonStep } from "../src/panels/measureButton.js";
import { clearPlanScale, setPlanScale } from "../src/model.js";
import { strings } from "../src/strings.js";
import {
  VOLUME_NEAR_MM,
  volumeRayAt,
  volumeScene,
  volumeScreenAt,
  volumeSurfaceAt,
  volumeSurfaceHolds,
  volumeSurfaceKind,
} from "../src/volume.js";
import { benchFlat } from "../tools/bench/scenes.mjs";

// ——— арифметика ———————————————————————————————————————————————————————————

test("прямое расстояние — одна формула на плоские поля и на объём", () => {
  assert.equal(measureSpan({ x: 0, y: 0 }, { x: 3, y: 4 }), 5);
  // Третья ось необязательна: её отсутствие — то же, что ноль.
  assert.equal(measureSpan({ x: 0, y: 0, z: 0 }, { x: 3, y: 4, z: 0 }), 5);
  assert.equal(measureSpan({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 2500 }), 2500);
  assert.equal(measureSpan({ x: 0, y: 0, z: 0 }, { x: 3, y: 0, z: 4 }), 5);
  assert.equal(measureSpan(null, { x: 1, y: 1 }), 0);
  assert.equal(measureSpan({ x: 1, y: 1 }, null), 0);
});

test("расстояние втроём: прямое, по полу и по высоте", () => {
  const parts = measureParts({ x: 0, y: 0, z: 0 }, { x: 3000, y: 4000, z: 1200 });
  assert.equal(parts.floor, 5000);
  assert.equal(parts.rise, 1200);
  assert.equal(Math.round(parts.straight), 5142);
  // Высота — по модулю: мерят от розетки к люстре и обратно одинаково.
  assert.equal(measureParts({ x: 0, y: 0, z: 2500 }, { x: 0, y: 0, z: 300 }).rise, 2200);
  assert.deepEqual(measureParts(null, null), { straight: 0, floor: 0, rise: 0 });
});

test("миллиметры целые, и единица та же, что у длины стены в чертеже", () => {
  assert.equal(measureMmText(1234.4), "1234 мм");
  assert.equal(measureMmText(1234.6), "1235 мм");
  assert.deepEqual(measureDrawingLines({ x: 0, y: 0 }, { x: 1200, y: 1600 }), ["2000 мм"]);
  assert.deepEqual(measureDrawingLines({ x: 0, y: 0 }, null), []);
  // Единица приписана словарём, а не склеена здесь: второго формата чисел у
  // линейки нет.
  assert.ok(strings.measure.mm.includes("{value}"));
});

test("в объёме подпись — прямое расстояние и разложение под ним", () => {
  const lines = measureVolumeLines({ x: 0, y: 0, z: 0 }, { x: 3000, y: 4000, z: 1200 });
  assert.equal(lines.length, 2);
  assert.equal(lines[0], "5142 мм");
  assert.equal(lines[1], "по полу 5000 мм, по высоте 1200 мм");
  assert.deepEqual(measureVolumeLines({ x: 0, y: 0, z: 0 }, null), []);
});

test("на плане метры считает калибровка, а без неё стоит причина", () => {
  const box = benchFlat();
  const a = { x: 0.2, y: 0.5 };
  const b = { x: 0.8, y: 0.5 };
  // Калибровка по половине ширины плана: ровно десять метров, то есть двадцать
  // на весь план. Шестьдесят сотых ширины между точками — двенадцать метров.
  const scaled = setPlanScale(box.project, box.schemeId, { a: { x: 0, y: 0.5 }, b: { x: 0.5, y: 0.5 }, meters: 10 }).project;
  assert.deepEqual(measurePlanLines(scaled, box.schemeId, a, b), ["12 м"]);
  // Та же калибровка, тот же счёт, что у длины линейной метки: своего числа
  // линейка не заводит.
  assert.deepEqual(measurePlanLines(scaled, box.schemeId, { x: 0, y: 0 }, { x: 1, y: 0 }), ["20 м"]);
  assert.deepEqual(measurePlanLines(scaled, box.schemeId, a, null), []);
  // Плана без масштаба метрами не измерить: доли подложки длиной не являются,
  // и вместо числа стоит причина.
  const bare = clearPlanScale(scaled, box.schemeId).project;
  assert.deepEqual(measurePlanLines(bare, box.schemeId, a, b), [strings.measure.noMeters]);
  assert.notEqual(strings.measure.noMeters, "");
});

// ——— мерка на сеанс ———————————————————————————————————————————————————————

test("отрезок один на поле: третий щелчок начинает новый", () => {
  measureDropAll();
  const key = "объект|схема";
  assert.equal(measureEnds("scheme", key), null);
  assert.equal(measureStarted("scheme", key), false);
  measureAdd("scheme", key, { x: 1, y: 1 });
  assert.equal(measureStarted("scheme", key), true);
  assert.deepEqual(measureEnds("scheme", key), { from: { x: 1, y: 1 }, to: null, live: true });
  measureAdd("scheme", key, { x: 4, y: 5 });
  assert.deepEqual(measureEnds("scheme", key), { from: { x: 1, y: 1 }, to: { x: 4, y: 5 }, live: false });
  // Готовый отрезок остаётся на поле, пока не начали новый: измеренное читают
  // глазами, а не ловят.
  assert.equal(measureStarted("scheme", key), false);
  measureAdd("scheme", key, { x: 9, y: 9 });
  assert.deepEqual(measureEnds("scheme", key), { from: { x: 9, y: 9 }, to: null, live: true });
  measureDropAll();
});

test("второй конец идёт за рукой только пока он не поставлен", () => {
  measureDropAll();
  const key = "объект|схема";
  // Ход руки без первого конца ничего не значит.
  assert.equal(measureAim("scheme", key, { x: 2, y: 2 }), false);
  measureAdd("scheme", key, { x: 0, y: 0 });
  assert.equal(measureAim("scheme", key, { x: 2, y: 2 }), true);
  assert.deepEqual(measureEnds("scheme", key), { from: { x: 0, y: 0 }, to: { x: 2, y: 2 }, live: true });
  // Та же точка второй раз — кадр не заказывается.
  assert.equal(measureAim("scheme", key, { x: 2, y: 2 }), false);
  // Руку увели за край поля: конец пропал, первый остался.
  assert.equal(measureAim("scheme", key, null), true);
  assert.deepEqual(measureEnds("scheme", key), { from: { x: 0, y: 0 }, to: null, live: true });
  measureAdd("scheme", key, { x: 3, y: 4 });
  // Готовый отрезок рука больше не тянет.
  assert.equal(measureAim("scheme", key, { x: 7, y: 7 }), false);
  assert.deepEqual(measureEnds("scheme", key), { from: { x: 0, y: 0 }, to: { x: 3, y: 4 }, live: false });
  measureDropAll();
});

test("мерки трёх полей живут врозь, а смена схемы или объекта их снимает", () => {
  measureDropAll();
  assert.deepEqual(MEASURE_FIELDS, ["drawing", "scheme", "volume"]);
  for (const field of MEASURE_FIELDS) measureAdd(field, "объект|схема", { x: 1, y: 1 });
  for (const field of MEASURE_FIELDS) assert.ok(measureEnds(field, "объект|схема"), field);
  // Другая схема того же объекта — другая мерка: доли и миллиметры там свои.
  for (const field of MEASURE_FIELDS) assert.equal(measureEnds(field, "объект|другая"), null, field);
  // И снять её можно по одному полю.
  assert.equal(measureDrop("volume"), true);
  assert.equal(measureDrop("volume"), false);
  assert.equal(measureEnds("volume", "объект|схема"), null);
  assert.ok(measureEnds("scheme", "объект|схема"));
  assert.equal(measureDropAll(), true);
  assert.equal(measureDropAll(), false);
  assert.equal(measureEnds("scheme", "объект|схема"), null);
});

test("ключ мерки — объект и схема; без них мерки нет вовсе", () => {
  assert.equal(measureKeyOf(null), null);
  assert.equal(measureKeyOf({ project: null, schemeId: "с" }), null);
  assert.equal(measureKeyOf({ project: { id: "о" }, schemeId: null }), null);
  assert.equal(measureKeyOf({ project: { id: "о" }, schemeId: "с" }), "о|с");
  // Нет ключа — нечего и хранить: добавление молчит, а не падает.
  assert.equal(measureAdd("scheme", null, { x: 1, y: 1 }), null);
});

test("цвет линейки свой: не служебный синий калибровки", () => {
  assert.match(MEASURE_COLOR, /^#[0-9a-f]{6}$/i);
  assert.notEqual(MEASURE_COLOR.toLowerCase(), "#0969da");
});

// ——— кнопка в шапке ———————————————————————————————————————————————————————

test("кнопка есть в трёх полях из четырёх и только при открытом объекте", () => {
  const project = { id: "о" };
  assert.equal(measureButtonShown({ project, screen: "drawing" }), true);
  assert.equal(measureButtonShown({ project, screen: "scheme" }), true);
  assert.equal(measureButtonShown({ project, screen: "volume" }), true);
  assert.equal(measureButtonShown({ project, screen: "scenarios" }), false);
  assert.equal(measureButtonShown({ project: null, screen: "scheme" }), false);
  assert.equal(measureButtonShown(null), false);
});

test("нажатие кнопки: включить, выключить — а на схеме без масштаба сперва спросить", () => {
  const box = benchFlat();
  const scaled = box.project;
  const bare = clearPlanScale(box.project, box.schemeId).project;
  // Включённую линейку кнопка снимает — и спрашивать тут нечего.
  assert.equal(measureButtonStep({ measuring: true, screen: "scheme", project: bare, schemeId: box.schemeId }), "off");
  // Схема без калибровки: метров нет, и путь к ним — вопрос про масштаб.
  assert.equal(measureButtonStep({ screen: "scheme", project: bare, schemeId: box.schemeId }), "scale");
  assert.equal(measureButtonStep({ screen: "scheme", project: scaled, schemeId: box.schemeId }), "on");
  // Чертёж и объём живут в миллиметрах — калибровка плана им не нужна.
  assert.equal(measureButtonStep({ screen: "drawing", project: bare, schemeId: box.schemeId }), "on");
  assert.equal(measureButtonStep({ screen: "volume", project: bare, schemeId: box.schemeId }), "on");
  assert.equal(measureButtonStep(null), "on");
});

// ——— точка на грани в «Объёме» ————————————————————————————————————————————

// Камера стенда: середина коридора на высоте глаз. Поле — как у ноутбука.
const BOX = { width: 900, height: 600 };

function sceneOf() {
  const box = benchFlat();
  return { box, scene: volumeScene(box.project, box.schemeId) };
}

test("луч и обратная проекция сходятся: точка → экран → луч через ту же точку", () => {
  const camera = { at: { x: 0, y: 0, z: 1600 }, yaw: 0, pitch: 0 };
  const point = { x: 4000, y: 700, z: 2100 };
  const screen = volumeScreenAt(point, camera, BOX);
  assert.ok(screen, "точка впереди — экранная точка у неё есть");
  const ray = volumeRayAt(camera, BOX, screen.x, screen.y);
  // Луч идёт ровно в неё: доля хода по лучу одна и та же по всем трём осям.
  const away = (point.x - ray.at.x) / ray.dir.x;
  assert.ok(away > 0);
  assert.ok(Math.abs(ray.at.y + ray.dir.y * away - point.y) < 1e-6);
  assert.ok(Math.abs(ray.at.z + ray.dir.z * away - point.z) < 1e-6);
  // Середина поля — это прямо по курсу.
  const ahead = volumeRayAt(camera, BOX, BOX.width / 2, BOX.height / 2);
  assert.ok(Math.abs(ahead.dir.y) < 1e-9 && Math.abs(ahead.dir.z) < 1e-9);
  assert.ok(ahead.dir.x > 0);
  // Точка за спиной экранной точки не имеет: рисовать её нечем.
  assert.equal(volumeScreenAt({ x: -4000, y: 0, z: 1600 }, camera, BOX), null);
  assert.equal(volumeScreenAt({ x: VOLUME_NEAR_MM / 2, y: 0, z: 1600 }, camera, BOX), null);
});

test("прицел в стену коридора даёт точку на её грани, а не в воздухе", () => {
  const { scene } = sceneOf();
  // Из середины коридора смотрим вдоль +x — там перегородка на x = 1000.
  const camera = { at: { x: 0, y: 0, z: 1600 }, yaw: 0, pitch: 0 };
  const found = volumeSurfaceAt(scene, camera, BOX, BOX.width / 2, BOX.height / 2);
  assert.ok(found, "стена под прицелом нашлась");
  assert.equal(found.kind, "wall");
  assert.equal(volumeSurfaceHolds(found.kind), true);
  // Точка — на внутренней грани перегородки: ось стены на 1000, толщина своя,
  // значит грань чуть ближе. Высота — та, на которой стоит взгляд.
  assert.ok(found.point.x > 800 && found.point.x < 1000, "точка на грани стены: " + found.point.x);
  assert.ok(Math.abs(found.point.y) < 1, "взгляд прямо — точка по оси: " + found.point.y);
  assert.ok(Math.abs(found.point.z - 1600) < 1, "высота точки — высота взгляда: " + found.point.z);
});

test("прицел в пол и в потолок отвечает полом и потолком", () => {
  const { scene } = sceneOf();
  const down = { at: { x: 500, y: 1000, z: 1600 }, yaw: 0, pitch: -Math.PI / 2 + 0.01 };
  const floor = volumeSurfaceAt(scene, down, BOX, BOX.width / 2, BOX.height / 2);
  assert.ok(floor);
  assert.equal(floor.kind, "floor");
  assert.ok(Math.abs(floor.point.z) < 1, "пол на нуле: " + floor.point.z);
  // Вверх смотрим из места, где над головой нет лампы: тело светильника —
  // вещь, а не потолок, и ответом была бы она (проверено первым прогоном).
  const up = { at: { x: 500, y: 1000, z: 1600 }, yaw: 0, pitch: Math.PI / 2 - 0.01 };
  const ceiling = volumeSurfaceAt(scene, up, BOX, BOX.width / 2, BOX.height / 2);
  assert.ok(ceiling);
  assert.equal(ceiling.kind, "ceiling");
  assert.ok(ceiling.point.z > 2000, "потолок над головой: " + ceiling.point.z);
  assert.equal(volumeSurfaceHolds(floor.kind) && volumeSurfaceHolds(ceiling.kind), true);
});

test("взгляд мимо дома не ставит точку вовсе", () => {
  const { scene } = sceneOf();
  // Из середины коридора задираем голову в небо, стоя снаружи габарита.
  const away = { at: { x: 40000, y: 40000, z: 1600 }, yaw: 0, pitch: 0.9 };
  assert.equal(volumeSurfaceAt(scene, away, BOX, BOX.width / 2, BOX.height / 2), null);
  // Пустая сцена отвечает тем же: ни точки, ни падения.
  assert.equal(volumeSurfaceAt({ empty: true }, away, BOX, 10, 10), null);
  assert.equal(volumeSurfaceAt(null, away, BOX, 10, 10), null);
});

test("мебель поверхностью не считается, а дверь, рама и стекло — считаются (G358)", () => {
  // Правило отвечает по самой грани: сцену для этого поднимать не надо, а
  // породы граней в сборке ровно те, что ниже.
  const wallRgb = [0, 0, 0];
  assert.equal(volumeSurfaceKind({ rgb: wallRgb, paint: "wall" }), "wall");
  assert.equal(volumeSurfaceKind({ rgb: wallRgb, paint: "floor" }), "floor");
  assert.equal(volumeSurfaceKind({ rgb: wallRgb, paint: "ceiling" }), "ceiling");
  // Стекло — своё: у стеклянной стены краска снята, и «стеной» отвечать нельзя.
  assert.equal(volumeSurfaceKind({ rgb: wallRgb, paint: null, glass: true }), "glass");
  assert.equal(volumeSurfaceKind({ rgb: wallRgb, paint: "wall", glass: true }), "glass");
  // Полотно и створка узнаются по хозяину проёма, даже покрашенные иначе.
  assert.equal(volumeSurfaceKind({ rgb: wallRgb, paint: null, doorId: "д" }), "door");
  assert.equal(volumeSurfaceKind({ rgb: wallRgb, paint: null, doorway: "п" }), "door");
  // Вещь каталога и тело метки — не поверхности: заказчик их не называл.
  assert.equal(volumeSurfaceKind({ rgb: wallRgb, paint: null }), "other");
  assert.equal(volumeSurfaceKind(null), "other");
  assert.equal(volumeSurfaceHolds("other"), false);
  assert.equal(volumeSurfaceHolds(null), false);
  for (const kind of ["wall", "floor", "ceiling", "door", "frame", "glass"]) {
    assert.equal(volumeSurfaceHolds(kind), true, kind);
  }
});

test("полотно двери и окно в стене гостиной приходят своими породами", () => {
  const { scene } = sceneOf();
  // Все породы, которые сборка кладёт в сцену квартиры стенда: по ним и видно,
  // что правило G358 опирается на существующие грани, а не на выдуманные.
  const kinds = new Set(
    scene.faces.filter((face) => !face.line).map((face) => volumeSurfaceKind(face)),
  );
  for (const kind of ["wall", "floor", "ceiling", "door", "frame"]) {
    assert.ok(kinds.has(kind), "в сцене квартиры нет граней породы " + kind);
  }
  // И мебель в ней есть — её-то под конец отрезка и не ставят.
  assert.ok(kinds.has("other"), "в сцене квартиры нет ни одной грани вне поверхностей");
});

test("ближняя грань закрывает дальнюю, а прозрачная мебель — нет", () => {
  const { scene } = sceneOf();
  // Диван стоит в гостиной у стены; смотрим на него из середины гостиной.
  const camera = { at: { x: -2750, y: 300, z: 1000 }, yaw: -Math.PI / 2, pitch: -0.25 };
  const found = volumeSurfaceAt(scene, camera, BOX, BOX.width / 2, BOX.height / 2);
  assert.ok(found, "что-то под прицелом есть");
  // Что бы это ни было, точка лежит **перед** камерой и внутри габарита дома:
  // луч упёрся в грань, а не улетел.
  assert.ok(found.point.y < 300, "точка впереди по взгляду: " + found.point.y);
  assert.ok(found.point.x > -4600 && found.point.x < -1000, "точка внутри гостиной: " + found.point.x);
  // Грани-линии (контуры изображений вещей, стрелки связей) поверхностью не
  // считаются вовсе: попасть в линию толщиной в точку было бы случайностью, а
  // мерить до неё незачем — она рисунок на поверхности, а не поверхность.
  const lines = scene.faces.filter((face) => face.line);
  assert.ok(lines.length > 0, "в сцене квартиры стенда линии есть — значит правило не впустую");
  for (const line of lines) {
    const along = volumeSurfaceAt({ faces: [line] }, camera, BOX, BOX.width / 2, BOX.height / 2);
    assert.equal(along, null, "линия ответила поверхностью");
  }
  // Прозрачная вещь каталога луч пропускает — сквозь шкаф видно стену, и
  // мерить хотят до стены (разбор — в шапке раздела `pick.js`).
  const clear = scene.faces.filter((face) => face.clear && !face.glass);
  for (const face of clear.slice(0, 5)) {
    assert.equal(volumeSurfaceAt({ faces: [face] }, camera, BOX, BOX.width / 2, BOX.height / 2), null);
  }
});
