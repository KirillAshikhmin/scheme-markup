// Тонкая рамка, включённый монитор и картинка на лице прибора (таск 255,
// требования G394 и G400).
//
// Слова заказчика: «У телевизора сделай тонкие рамки, точно так же как и у
// монитора компьютерного стола», «В Объекте Компьютерный стол с креслом тоже
// есть монитор на столе, вот он не включается», «ну и монитору тоже рамки
// нужны» и «на экране телевизора сделай какую-то примитивную картинку (можно
// природу, как в окне), так же на картине тоже (геометрическую картину
// какую-нибуд) и на экране монитора сделай пару прямоугольников как окна».
//
// Что проверяется здесь, а не глазами:
//
//   1. **Монитор включается от устройства вещи.** Это главный шов таска: живое
//      состояние дома лежит по хозяину грани (`markId`), а у вещи чертежа
//      хозяина не было вовсе — поэтому признака «может светиться» у тела было
//      мало. Стол без устройства обязан остаться тёмным.
//   2. **Мера рамки одна** на телевизор и монитор, и она в миллиметрах: доля
//      габарита дала бы рамку разной толщины у двух приборов и неровную у
//      каждого.
//   3. **Картинка видна, пока прибор горит.** Выключенный экран — тёмное стекло
//      в рамке и больше ничего; картина висит всегда.
//   4. **В дерево порядка картинка не идёт** и рисуется ровно один раз: грань,
//      попавшая и в дерево, и в поток бесхозных граней, рисовалась бы дважды.
import test from "node:test";
import assert from "node:assert/strict";

import {
  addOutline,
  addRoom,
  addScheme,
  addSchemeObject,
  addSchemeObjectKind,
  addWall,
  applyRoomOutlines,
  createProject,
  objectDeviceMake,
  planMmToFraction,
  setPlanOrigin,
  setPlanScale,
  setSchemeWallHeight,
} from "../src/model.js";
import { MODEL_ARTS } from "../src/objectModels/kit.js";
import { objectModelByKey } from "../src/objectModels/registry.js";
import {
  VOLUME_ART_FRAME_MM,
  VOLUME_ART_LIFT_MM,
  VOLUME_SCREEN_RGB,
  volumeArtFace,
  volumeArtFaceCount,
  volumeArtFaces,
  volumeArtNames,
  volumeFrame,
  volumeInTree,
  volumeModelPrisms,
  volumeMood,
  volumeOrderAll,
  volumeScene,
} from "../src/volume.js";

// Поле широкое нарочно: картинка мерится числом многоугольников, и прибор
// обязан попасть в кадр целиком.
const BOX = { width: 1400, height: 900 };
const DAY = volumeMood({ minutes: 13 * 60, times: { riseMin: 540, setMin: 1260 }, kind: "nature", topDeg: 0 });

/** Комната 5 × 4 м с мостом «доли ↔ миллиметры»: в неё ставятся вещи. */
function room() {
  const added = addScheme(createProject(), { name: "1 этаж", imageId: "plan-1", width: 1200, height: 800 });
  const schemeId = added.scheme.id;
  let project = setPlanScale(added.project, schemeId, { a: { x: 0.1, y: 0.5 }, b: { x: 0.6, y: 0.5 }, meters: 6 }).project;
  project = setPlanOrigin(project, schemeId, { at: { x: 0.5, y: 0.5 }, turn: 0 }).project;
  project = setSchemeWallHeight(project, schemeId, 2700).project;
  const corners = [
    { x: -2500, y: -2000 },
    { x: 2500, y: -2000 },
    { x: 2500, y: 2000 },
    { x: -2500, y: 2000 },
  ];
  for (let index = 0; index < corners.length; index += 1) {
    project = addWall(project, {
      schemeId,
      aMm: corners[index],
      bMm: corners[(index + 1) % corners.length],
      thicknessMm: 200,
    }).project;
  }
  const made = addRoom(project, "Кабинет");
  project = addOutline(made.project, {
    schemeId,
    roomId: made.room.id,
    points: [
      { x: -2400, y: -1900 },
      { x: 2400, y: -1900 },
      { x: 2400, y: 1900 },
      { x: -2400, y: 1900 },
    ].map((point) => planMmToFraction(made.project, schemeId, point)),
  }).project;
  project = applyRoomOutlines(project, schemeId).project;
  return { project, schemeId };
}

function thing(box, catalogKey, sizes) {
  const made = addSchemeObject(box.project, {
    schemeId: box.schemeId,
    catalogKey,
    shape: "rect",
    atMm: { x: 0, y: 1200 },
    turnDeg: 0,
    ...sizes,
  });
  return { ...box, project: made.project, object: made.schemeObject };
}

/** Компьютерный стол лицом к камере: монитор смотрит туда же, куда вещь. */
function deskRoom() {
  return thing(room(), "deskSet", { widthMm: 1400, depthMm: 1400, heightMm: 1200, heightAboveFloorMm: 0 });
}

/** Устройство вещи: метка типа ТВ на её месте (R02.1). */
function deviceOf(box) {
  const type = box.project.markTypes.find((item) => item.code === "ТВ");
  const made = objectDeviceMake(box.project, box.object.id, type.id);
  return { ...box, project: made.project, markId: made.mark.id };
}

const sceneOf = (box) => volumeScene(box.project, box.schemeId, { roofOff: true, markImages: false });
/** Камера перед лицом вещи: при нулевом повороте вещь смотрит вниз по листу. */
const CAMERA = { at: { x: 0, y: 4600, z: 1300 }, yaw: -Math.PI / 2, pitch: 0 };
const frameOf = (scene, glow = null) =>
  volumeFrame(scene, CAMERA, BOX, [], DAY.tint, glow ? { glow, rooms: new Map() } : null);
const glowOf = (markId) => new Map([[markId, { level: 1, rgb: VOLUME_SCREEN_RGB }]]);

// ——— монитор включается (G394) ——————————————————————————————————————————————

test("монитор компьютерного стола светится от устройства вещи, а стол без устройства остаётся тёмным", () => {
  // **Почему одного признака «может светиться» было мало.** Признак доезжает до
  // грани, но горит она по хозяину: `volumeLiveFill` ищет свечение в `live.glow`
  // по `face.markId`. У граней вещи чертежа хозяина не было вовсе, и экран
  // стола искать себя в состоянии дома не мог. Теперь хозяин у них — метка
  // связанного устройства (`volumeObjectFaces` → `markOfObject`).
  const plain = deskRoom();
  const plainScene = sceneOf(plain);
  const plainGlass = plainScene.faces.filter((face) => face.art === "glass");
  assert.equal(plainGlass.length, 1, "у стола не одно стекло экрана");
  assert.equal(plainGlass[0].lit, true, "стекло монитора не умеет светиться");
  assert.equal(plainGlass[0].markId, null, "у вещи без устройства взялся хозяин");
  // Тёмный стол остаётся тёмным, какое бы свечение в доме ни горело: искать
  // себя в состоянии дома ему нечем, и кадр у него тот же.
  assert.deepEqual(frameOf(plainScene, glowOf("1")), frameOf(plainScene), "стол без устройства засветился");

  const live = deviceOf(plain);
  const scene = sceneOf(live);
  const glass = scene.faces.filter((face) => face.art === "glass" && face.markId === live.markId);
  assert.ok(glass.length >= 1, "у вещи-устройства стекло без хозяина");
  // Хозяин достаётся **всем** граням вещи, а не только стеклу: по ним ловится
  // щелчок и взгляд, и это та же метка.
  const own = scene.faces.filter((face) => face.thing === live.object.id);
  assert.ok(own.length > 0 && own.every((face) => face.markId === live.markId), "хозяин достался не всем граням вещи");

  const off = frameOf(scene);
  const on = frameOf(scene, glowOf(live.markId));
  const mine = (frame) => frame.filter((polygon) => polygon.pick === live.markId);
  assert.ok(mine(off).length > 0, "монитора не видно в кадре вовсе");
  // Загорелось стекло: ровно один многоугольник сменил цвет на цвет экрана.
  const fills = new Map(mine(off).map((polygon) => [polygon.xy.join(","), polygon.fill]));
  const changed = mine(on).filter((polygon) => {
    const was = fills.get(polygon.xy.join(","));
    return was !== undefined && was !== polygon.fill;
  });
  // Место у перемены одно — стекло монитора: **тело у вещи-устройства одно**,
  // её собственное, и второго телевизора во весь габарит стола на нём не стоит
  // (разбор — `volumeScene`). Граней на этом месте у включённого две: само
  // стекло и рабочий стол поверх него.
  assert.equal(new Set(changed.map((polygon) => polygon.xy.join(","))).size, 1, "засветилось не одно стекло");
  for (const polygon of changed) {
    const [r, , b] = String(polygon.fill).match(/[\d.]+/g).map(Number);
    assert.ok(b > r, "экран светится не цветом экрана: " + polygon.fill);
  }
  // И показал картинку: рабочий стол с двумя окнами — пять фигур.
  assert.equal(on.length - off.length, volumeArtFaceCount("desktop"), "окна рабочего стола не появились");
});

// ——— рамка: одна мера, и она в миллиметрах (G394) ——————————————————————————

test("рамка у телевизора и монитора одна: десять миллиметров со всех четырёх сторон", () => {
  const screens = [
    { key: "tv", widthMm: 1240, depthMm: 80, heightMm: 720 },
    { key: "deskSet", widthMm: 1400, depthMm: 1400, heightMm: 1200 },
  ];
  for (const { key, widthMm, depthMm, heightMm } of screens) {
    const part = objectModelByKey(key).parts.find((item) => item.name === "screen");
    assert.equal(part.lit, true, key + ": экран не умеет светиться");
    assert.ok(MODEL_ARTS.includes(part.art), key + ": у экрана нет картинки");
    const frame = { at: { x: 0, y: 0 }, bottomMm: 500, u: { x: 1, y: 0 }, f: { x: 0, y: -1 }, widthMm, depthMm, heightMm };
    const face = volumeArtFace(frame, part);
    const faces = volumeArtFaces(frame, part, [120, 120, 120], [], { markId: "3" });
    const glass = faces[0];
    assert.equal(glass.art, "glass", key + ": первой гранью не стекло");
    const span = (pick) => Math.max(...glass.p.map(pick)) - Math.min(...glass.p.map(pick));
    // Рамка — разница лица тела и стекла, и она одна по обеим осям: это и
    // значит «ровная». Доля габарита дала бы 25 мм поперёк и 14 вдоль.
    assert.equal(Math.round(face.widthMm - span((point) => point.x)), VOLUME_ART_FRAME_MM * 2, key + ": рамка по ширине");
    assert.equal(Math.round(face.heightMm - span((point) => point.z)), VOLUME_ART_FRAME_MM * 2, key + ": рамка по высоте");
    // Стекло поднято над лицом тела — перед ним, а не в нём. Лицо при `f` =
    // (0, −1) — та сторона призмы, где `y` больше: она ближе к зрителю.
    const prism = volumeModelPrisms(frame, [part])[0];
    const faceY = Math.max(...prism.corners.map((point) => point.y));
    assert.equal(Math.round(glass.p[0].y - faceY), VOLUME_ART_LIFT_MM, key + ": стекло не поднято над лицом");
    // Светится стекло, а не тело: загорись тело, рамки не стало бы видно.
    assert.equal(glass.lit, true, key + ": стекло не светится");
    assert.ok(faces.slice(1).every((item) => item.lit === false), key + ": светится фигура картинки");
    assert.ok(faces.every((item) => item.markId === "3"), key + ": у картинки чужой хозяин");
  }
  // Прибору, которому рамки не хватает размером, стекло остаётся стеклом:
  // рамка сжимается до четверти стороны.
  const small = objectModelByKey("tv").parts.find((item) => item.name === "screen");
  const tiny = { at: { x: 0, y: 0 }, bottomMm: 0, u: { x: 1, y: 0 }, f: { x: 0, y: -1 }, widthMm: 40, depthMm: 20, heightMm: 24 };
  const glass = volumeArtFaces(tiny, small, [120, 120, 120], [])[0];
  assert.ok(Math.max(...glass.p.map((point) => point.x)) > Math.min(...glass.p.map((point) => point.x)), "стекло крошечного экрана выродилось");
});

// ——— картинки: имена, цена и когда их видно (G400) ————————————————————————

test("у каждого имени картинки есть фигуры, и стоит она столько граней, сколько в ней фигур", () => {
  // Имя стоит в описании тела, фигуры — в объёме: цвет тела принадлежит
  // категории (ADR 005), а у неба и травы цвет свой. Разойдись список имён с
  // картинками — экран остался бы пустым молча.
  assert.deepEqual(volumeArtNames(), [...MODEL_ARTS].sort(), "имена картинок и описания разошлись");
  // Цена названа числом: картинка — это заливки на каждом кадре.
  assert.equal(volumeArtFaceCount("nature"), 7, "природа подорожала");
  assert.equal(volumeArtFaceCount("desktop"), 5, "окна монитора подорожали");
  assert.equal(volumeArtFaceCount("geometry"), 4, "геометрия картины подорожала");
  // У экрана к фигурам прибавляется стекло, у полотна — нет.
  assert.equal(volumeArtFaceCount("nature", true), 8);
  assert.equal(volumeArtFaceCount("нет такой"), 0);
});

test("картинка видна, пока прибор горит; на полотне картины — всегда", () => {
  const base = thing(room(), "tv", { widthMm: 1240, depthMm: 80, heightMm: 720, heightAboveFloorMm: 900 });
  const live = deviceOf(base);
  const withPicture = thing(live, "picture", { widthMm: 800, depthMm: 40, heightMm: 600, heightAboveFloorMm: 1300 });
  const scene = sceneOf(withPicture);
  const kinds = (art) => scene.faces.filter((face) => face.art === art);
  assert.equal(kinds("glass").length, 1, "стекло не одно: у вещи-устройства тело одно");
  assert.equal(kinds("screen").length, volumeArtFaceCount("nature"), "природы на экране нет");
  assert.equal(kinds("canvas").length, volumeArtFaceCount("geometry"), "геометрии на полотне нет");
  // Фигуры работающего экрана светятся своим цветом без тона часа — как диод;
  // краска полотна не светится ничем: её освещает комната.
  assert.ok(kinds("screen").every((face) => face.led === true), "фигуры экрана не светятся");
  assert.ok(kinds("canvas").every((face) => face.led === false && face.lit === false), "полотно светится");
  // **Светится стекло, а не тело.** Тело экрана «может светиться» по описанию
  // (`lit` у `tv.screen`), но гореть ему нельзя: загорись оно — светилось бы всё
  // лицо, и рамки не стало бы видно. Поэтому у его граней признака нет.
  const screenBody = scene.faces.filter((face) => !face.art && face.markId && face.rgb === kinds("glass")[0].rgb);
  assert.equal(screenBody.length, 0, "мерка не та: цвет стекла совпал с цветом тела");
  assert.ok(
    scene.faces.filter((face) => !face.art && !face.line).every((face) => face.lit === false),
    "кроме стекла в сцене светится что-то ещё",
  );
  // Выключенный прибор картинки не рисует, а картина рисует её всегда — и без
  // запущенного дома тоже: её фигуры есть в кадре, которому состояния дома не
  // дали вовсе.
  const off = frameOf(scene);
  const on = frameOf(scene, glowOf(live.markId));
  assert.equal(on.length - off.length, volumeArtFaceCount("nature"), "картинка появилась не целиком");
  // А фигуры полотна в кадре есть и без состояния дома: кадр с ними дороже
  // кадра без них ровно на их число.
  const picture = thing(room(), "picture", { widthMm: 800, depthMm: 40, heightMm: 600, heightAboveFloorMm: 1300 });
  const bare = volumeScene(picture.project, picture.schemeId, { roofOff: true, markImages: false });
  const plain = { ...bare, faces: bare.faces.filter((face) => face.art !== "canvas") };
  plain.order = bare.order;
  assert.equal(
    frameOf(bare).length - frameOf(plain).length,
    volumeArtFaceCount("geometry"),
    "геометрия картины в кадр не попала",
  );
});

test("картинка не идёт в дерево порядка и рисуется один раз", () => {
  const live = deviceOf(thing(room(), "tv", { widthMm: 1240, depthMm: 80, heightMm: 720, heightAboveFloorMm: 900 }));
  const scene = sceneOf(live);
  const art = scene.faces.filter((face) => face.art);
  assert.ok(art.length > 0, "картинки в сцене нет вовсе");
  assert.ok(art.every((face) => !volumeInTree(face)), "картинка попала в дерево порядка");
  const inTree = new Set(volumeOrderAll(scene.order, []));
  assert.ok(art.every((face) => !inTree.has(face)), "грань картинки лежит в дереве");
  // **Один раз, а не дважды.** Пока таск писался, картинка попадала и в дерево
  // (`volumeOrderTree` спрашивал не `volumeInTree`), и в поток бесхозных граней
  // кадра — и рисовалась двумя многоугольниками на один. Ловится это счётом:
  // кадр со картинкой дороже кадра без неё ровно на число её граней.
  const bare = { ...scene, faces: scene.faces.filter((face) => !face.art) };
  bare.order = scene.order;
  const glow = glowOf(live.markId);
  assert.equal(
    frameOf(scene, glow).length - frameOf(bare, glow).length,
    volumeArtFaceCount("nature", true),
    "картинка нарисована не по разу на грань",
  );
});

// ——— тело у вещи-устройства одно (таск 255) ————————————————————————————————

test("у вещи с моделью тело одно: метка второго не рисует, а вещи без модели оставляет своё", () => {
  // До этого таска связанная метка рисовала **свою** модель в габарите вещи:
  // телевизор, которому миграция достроила вещь, рисовался дважды, а на
  // компьютерном столе вставал телевизор во весь его габарит — и монитора за
  // ним было не видно. Теперь тело даёт вещь, а метка несёт электрику.
  const tv = deviceOf(thing(room(), "tv", { widthMm: 1240, depthMm: 80, heightMm: 720, heightAboveFloorMm: 900 }));
  const scene = sceneOf(tv);
  const bodies = scene.faces.filter((face) => face.markId === tv.markId && !face.line && !face.art);
  // Модель телевизора — три тела, то есть восемнадцать граней. Было бы
  // тридцать шесть: по разу от вещи и от метки.
  assert.equal(bodies.length, 18, "тел у вещи-устройства не одно: граней " + bodies.length);
  assert.ok(bodies.every((face) => face.thing === tv.object.id), "грани достались не вещи");
  // Изображение прибора поверх вещи осталось: по нему и видно, что устройство
  // здесь есть.
  const scene2 = volumeScene(tv.project, tv.schemeId, { roofOff: true });
  assert.ok(scene2.faces.some((face) => face.line && face.markId === tv.markId), "изображение прибора пропало");

  // Вещь без модели (свой вид чертежа) рисуется габаритом — и метке тело
  // оставляет: иначе прибор пропал бы вовсе.
  const base = room();
  const kind = addSchemeObjectKind(base.project, { name: "Пенал" });
  const made = addSchemeObject(kind.project, {
    schemeId: base.schemeId,
    kindId: kind.schemeObjectKind.id,
    shape: "rect",
    atMm: { x: 0, y: 1200 },
    widthMm: 600,
    depthMm: 400,
    heightMm: 1800,
    turnDeg: 0,
  });
  const own = deviceOf({ ...base, project: made.project, object: made.schemeObject });
  const plain = sceneOf(own);
  const mine = plain.faces.filter((face) => face.markId === own.markId && !face.line && !face.art);
  assert.ok(mine.some((face) => face.thing === true), "у вещи без модели метка осталась без тела");
});

test("картинка бывает только у коробки: цилиндру лица не назначить", () => {
  // У цилиндра, лежачей трубы и конуса лица нет — есть бок, и плоская картинка
  // на нём повисла бы в воздухе. Сказано это в одном месте (`volumeArtFace`),
  // а не додумывается в каждом.
  const frame = { at: { x: 0, y: 0 }, bottomMm: 0, u: { x: 1, y: 0 }, f: { x: 0, y: -1 }, widthMm: 600, depthMm: 600, heightMm: 800 };
  const screen = objectModelByKey("tv").parts.find((item) => item.name === "screen");
  assert.ok(volumeArtFace(frame, screen), "коробке лица не нашлось");
  for (const kind of ["cyl", "tube", "cone", "plate"]) {
    assert.equal(volumeArtFace(frame, { ...screen, kind }), null, kind + ": лицо нашлось у тела без лица");
    assert.deepEqual(volumeArtFaces(frame, { ...screen, kind }, [120, 120, 120], []), [], kind + ": картинка нарисована");
  }
});
