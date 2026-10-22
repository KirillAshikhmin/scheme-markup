// Выключатель с тонкой рамкой и опция «Подсвечивать метки» (таск 14 сценариев,
// требования G14 и G15).
//
// Слова заказчика (2026-10-23): «поправь модель выключателя да и изображение
// его, сделав рамку сильно меньше, буквально пару миллиметров, что бы кнопки
// были больше. А ещё сделай опцию вида, отключённую по умолчанию —
// Подсвечивать метки, которая убирает изображение метки поверх её модели».
//
// Проверяется числами то, что на скриншоте видно глазом: рамка вокруг клавиш
// — около двух миллиметров на выключателе 80 × 80 (умолчание справочника),
// клавиши занимают почти всё лицо, щелчок в правую часть лица попадает во
// вторую клавишу; без опции контура изображения поверх модели в сцене нет, с
// ней — сцена та же, что была до опции.
import test from "node:test";
import assert from "node:assert/strict";

import {
  addMark,
  addOutline,
  addRoom,
  addScheme,
  addWall,
  applyMarkWalls,
  createProject,
  planMmToFraction,
  setPlanOrigin,
  setPlanScale,
  setSchemeWallHeight,
} from "../src/model.js";
import {
  VOLUME_SELECT_COLOR,
  volumeBasis,
  volumeChannelAt,
  volumeFacePoint,
  volumeFloorKey,
  volumeFloorKeySame,
  volumeFocal,
  volumeFrame,
  volumeScene,
  volumeSelectLines,
} from "../src/volume.js";
import { objectModelByKey, objectModelChannels } from "../src/objectModels/registry.js";
import { MODELS_KEYED } from "../src/objectModels/power.js";
import { objectViewByName } from "../src/objectViews/registry.js";
import * as app from "../src/app.js";

/** Выключатель стартового справочника: 80 × 80 мм (`TEMPLATE_TYPES`). */
const SWITCH_MM = 80;
/** «Буквально пару миллиметров»: допуск вокруг двух. */
const FRAME_MIN_MM = 1.5;
const FRAME_MAX_MM = 3;

// ——— модель ————————————————————————————————————————————————————————————

test("G14: у клавишных моделей рамка вокруг клавиш — около двух миллиметров", () => {
  const keyed = Object.keys(MODELS_KEYED);
  assert.ok(keyed.length >= 4, "клавишных моделей меньше, чем выключателей: " + keyed.join(", "));
  for (const key of keyed) {
    const base = objectModelByKey(key);
    for (let channels = 1; channels <= MODELS_KEYED[key].max; channels += 1) {
      const model = objectModelChannels(base, channels);
      const keys = model.parts.filter((part) => part.channel);
      const label = key + " на " + channels;
      assert.equal(keys.length, channels, label + ": клавиш не столько, сколько каналов");
      const left = (Math.min(...keys.map((part) => part.x)) + 0.5) * SWITCH_MM;
      const right = (0.5 - Math.max(...keys.map((part) => part.x + part.width))) * SWITCH_MM;
      const bottom = Math.min(...keys.map((part) => part.z)) * SWITCH_MM;
      const top = (1 - Math.max(...keys.map((part) => part.z + part.height))) * SWITCH_MM;
      for (const [side, mm] of Object.entries({ left, right, bottom, top })) {
        assert.ok(mm >= FRAME_MIN_MM && mm <= FRAME_MAX_MM, label + ": рамка " + side + " " + mm.toFixed(1) + " мм");
      }
      // Клавиши занимают почти всё лицо: зазоры между ними — щель, а не рамка.
      // Прежняя модель отдавала клавишам 37 % лица; четыре клавиши с тремя
      // щелями и рамкой по 2 мм — это 85 %.
      const area = keys.reduce((sum, part) => sum + part.width * part.height, 0);
      assert.ok(area >= 0.8, label + ": клавиши занимают " + Math.round(area * 100) + " % лица");
      for (let index = 1; index < keys.length; index += 1) {
        const gapMm = (keys[index].x - (keys[index - 1].x + keys[index - 1].width)) * SWITCH_MM;
        assert.ok(gapMm > 0 && gapMm <= FRAME_MAX_MM, label + ": щель между клавишами " + gapMm.toFixed(1) + " мм");
      }
      // Рамка — тело позади клавиш во весь габарит: без неё тонкой рамки нет.
      const frame = model.parts.find((part) => part.name === "frame");
      assert.ok(frame, label + ": рамки нет");
      assert.equal(frame.width, 1, label + ": рамка не во всю ширину");
      assert.equal(frame.height, 1, label + ": рамка не во всю высоту");
      for (const part of keys) assert.ok(part.y + part.depth <= frame.y + 1e-9, label + ": клавиша вошла в рамку");
    }
  }
});

// ——— изображение ————————————————————————————————————————————————————————

test("G14: у изображения выключателя та же тонкая рамка и крупные клавиши", () => {
  for (const name of ["switch1", "switch2", "switch3", "switchToggle"]) {
    const rects = objectViewByName(name).parts.filter((part) => part.kind === "rect");
    const area = (part) => part.width * part.height;
    const plate = rects.reduce((best, part) => (area(part) > area(best) ? part : best));
    const keys = rects.filter((part) => part !== plate);
    assert.ok(keys.length >= 1, name + ": клавиш нет");
    const left = (Math.min(...keys.map((part) => part.x)) - plate.x) * SWITCH_MM;
    const right = (plate.x + plate.width - Math.max(...keys.map((part) => part.x + part.width))) * SWITCH_MM;
    const top = (Math.min(...keys.map((part) => part.y)) - plate.y) * SWITCH_MM;
    const bottom = (plate.y + plate.height - Math.max(...keys.map((part) => part.y + part.height))) * SWITCH_MM;
    for (const [side, mm] of Object.entries({ left, right, top, bottom })) {
      assert.ok(mm >= FRAME_MIN_MM && mm <= FRAME_MAX_MM, name + ": рамка " + side + " " + mm.toFixed(1) + " мм");
    }
    const share = keys.reduce((sum, part) => sum + area(part), 0) / area(plate);
    assert.ok(share >= 0.8, name + ": клавиши занимают " + Math.round(share * 100) + " % плашки");
  }
});

// ——— сцена: стенд с выключателем на стене ————————————————————————————————

function switchStand(code = "ВВ") {
  const added = addScheme(createProject(), { name: "1 этаж", imageId: "plan-1", width: 1200, height: 800 });
  const schemeId = added.scheme.id;
  let project = setPlanScale(added.project, schemeId, { a: { x: 0.1, y: 0.5 }, b: { x: 0.6, y: 0.5 }, meters: 6 }).project;
  project = setPlanOrigin(project, schemeId, { at: { x: 0.5, y: 0.5 }, turn: 0 }).project;
  project = setSchemeWallHeight(project, schemeId, 2700).project;
  const corners = [
    { x: -2000, y: -1500 },
    { x: 2000, y: -1500 },
    { x: 2000, y: 1500 },
    { x: -2000, y: 1500 },
  ];
  for (let index = 0; index < corners.length; index += 1) {
    project = addWall(project, { schemeId, aMm: corners[index], bMm: corners[(index + 1) % 4], thicknessMm: 200 }).project;
  }
  const room = addRoom(project, "Кухня");
  project = addOutline(room.project, {
    schemeId,
    roomId: room.room.id,
    points: corners.map((point) =>
      planMmToFraction(room.project, schemeId, { x: Math.sign(point.x) * 1900, y: Math.sign(point.y) * 1400 }),
    ),
  }).project;
  // Выключатель у верхней стены, в 300 мм от её грани: автопривязка берёт его.
  const mark = addMark(project, {
    schemeId,
    typeId: project.markTypes.find((type) => type.code === code).id,
    kind: "point",
    points: [planMmToFraction(project, schemeId, { x: 0, y: -1100 })],
  });
  project = applyMarkWalls(mark.project, schemeId).project;
  return {
    project,
    schemeId,
    markId: mark.marks[0].id,
    // Стоим в 40 см перед выключателем на его высоте и смотрим в стену.
    camera: { at: { x: 0, y: -1000, z: 900 }, yaw: -Math.PI / 2, pitch: 0 },
    box: { width: 900, height: 600 },
  };
}

// Точка мира → экран: та же камера, что у кадра (оси и фокус — его же).
function screenOf(camera, box, point) {
  const basis = volumeBasis(camera);
  const focal = volumeFocal(box);
  const d = { x: point.x - camera.at.x, y: point.y - camera.at.y, z: point.z - camera.at.z };
  const dot = (axis) => d.x * axis.x + d.y * axis.y + d.z * axis.z;
  const depth = dot(basis.fwd);
  return { x: box.width / 2 + (dot(basis.right) * focal) / depth, y: box.height / 2 - (dot(basis.up) * focal) / depth };
}

const placeOf = (built, markId) => built.marks.find((place) => place.markId === markId) || null;
const imageLines = (built, markId) => built.faces.filter((face) => face.line && face.markId === markId);

test("G14: щелчок по крупной клавише выбирает её канал, по рамке — ни один", () => {
  const stand = switchStand("ВВ");
  for (const options of [{}, { markImages: false }]) {
    const built = volumeScene(stand.project, stand.schemeId, options);
    const place = placeOf(built, stand.markId);
    assert.ok(place && place.face && place.model, "выключатель стоит на стене моделью");
    const frame = volumeFrame(built, stand.camera, stand.box);
    const at = (fx, fy) => {
      const point = screenOf(stand.camera, stand.box, volumeFacePoint(place.face, fx, fy));
      return volumeChannelAt(frame, point.x, point.y);
    };
    // Доли лица: плюс — вправо, если смотреть вещи в лицо, `fy` — вниз. В
    // десяти процентах от края лица прежняя модель ещё стояла рамкой.
    assert.deepEqual(at(0.4, -0.35), { markId: stand.markId, channel: 2 }, "правый верх лица — вторая клавиша");
    assert.deepEqual(at(-0.4, 0.35), { markId: stand.markId, channel: 1 }, "левый низ лица — первая клавиша");
    assert.deepEqual(at(0.2, 0), { markId: stand.markId, channel: 2 });
    assert.deepEqual(at(-0.2, 0), { markId: stand.markId, channel: 1 });
    // Самый край лица — рамка: канала у неё нет.
    assert.equal(at(0.49, 0), null, "край лица — рамка");
    assert.equal(at(0, 0.49), null, "низ лица — рамка");
  }
});

// ——— опция «Подсвечивать метки» ——————————————————————————————————————————

test("G15: опция выключена — картинки метки поверх модели в сцене нет, остальное то же", () => {
  const stand = switchStand("ВВ");
  const full = volumeScene(stand.project, stand.schemeId, {});
  const bare = volumeScene(stand.project, stand.schemeId, { markImages: false });
  // Салатовая картинка со скриншота — это контур изображения цветом метки:
  // линии с хозяином-меткой поверх её лица (`volumeMarkViewLines`).
  assert.ok(imageLines(full, stand.markId).length > 0, "с опцией контур изображения есть");
  assert.deepEqual(imageLines(bare, stand.markId), [], "без опции контура изображения нет");
  // Всё прочее — грань в грань: модель, стены, пол — опция их не трогает.
  assert.deepEqual(
    bare.faces,
    full.faces.filter((face) => !(face.line && face.markId)),
    "без опции пропал не только контур",
  );
  assert.deepEqual(placeOf(bare, stand.markId), placeOf(full, stand.markId), "место метки то же");
  // В кадре ни одной линии цветом метки.
  const color = placeOf(full, stand.markId).color;
  const strokes = (built) =>
    volumeFrame(built, stand.camera, stand.box).filter((polygon) => polygon.stroke && polygon.pick === stand.markId);
  assert.ok(strokes(full).length > 0, "стенд обязан видеть контур, когда он есть");
  assert.ok(strokes(full).every((polygon) => polygon.stroke === color));
  assert.deepEqual(strokes(bare), [], "без опции в кадре нет линий метки");
});

test("G15: опция включена — сцена та же, что без неё до правки", () => {
  const stand = switchStand("ВВВ");
  const before = volumeScene(stand.project, stand.schemeId, {});
  const on = volumeScene(stand.project, stand.schemeId, { markImages: true });
  assert.deepEqual(on.faces, before.faces, "грани с опцией — те же, что без довода");
  const camera = stand.camera;
  assert.deepEqual(volumeFrame(on, camera, stand.box), volumeFrame(before, camera, stand.box), "кадр вызов в вызов");
});

test("G15: выделенная метка без опции по-прежнему отличима — рамкой выделения", () => {
  const stand = switchStand("ВВ");
  const built = volumeScene(stand.project, stand.schemeId, { markImages: false });
  const place = placeOf(built, stand.markId);
  const overlay = volumeSelectLines(place);
  assert.ok(overlay.length > 0, "рамки выделения нет");
  assert.ok(overlay.every((line) => line.color === VOLUME_SELECT_COLOR));
  const frame = volumeFrame(built, stand.camera, stand.box, overlay);
  const selected = frame.filter((polygon) => polygon.stroke === VOLUME_SELECT_COLOR);
  assert.ok(selected.length > 0, "рамка выделения не попала в кадр");
  // Без выделения синей рамки нет: отличие — это она.
  assert.equal(
    volumeFrame(built, stand.camera, stand.box).filter((polygon) => polygon.stroke === VOLUME_SELECT_COLOR).length,
    0,
  );
});

test("G15: этаж стопки собирается заново, когда опцию переключили", () => {
  const stand = switchStand("В");
  const key = (options) => volumeFloorKey(stand.project, stand.schemeId, options, null, false, null);
  assert.equal(volumeFloorKeySame(key({}), key({ markImages: false })), false, "готовый этаж взят бы с контуром");
  assert.equal(volumeFloorKeySame(key({}), key({ markImages: true })), true, "умолчание довода — как до опции");
  assert.equal(volumeFloorKeySame(key({ markImages: false }), key({ markImages: false })), true);
});

test("G15: умолчание — выключено, помнится ключом настроек браузера, а не в объекте", () => {
  assert.equal(app.getState().marksHighlight, false, "опция по умолчанию включена");
  assert.equal(typeof app.MARKS_HIGHLIGHT_SETTING, "string", "ключа настроек нет");
  assert.ok(app.MARKS_HIGHLIGHT_SETTING.length > 0);
});
