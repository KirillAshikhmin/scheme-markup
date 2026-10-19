// Низкополигональные модели вещей и меток (таск 155, требование G221).
//
// Что проверяется здесь, а не глазами:
//
//   1. **Охват.** У каждого точечного типа стартового справочника модель есть,
//      у каждой вещи каталога — тоже. Промах в лестнице ключей оставил бы
//      кубик вместо вещи там, где её мало кто поставит, и заметить это можно
//      было бы только на том объекте, где такой тип стоит.
//   2. **Предел тел и граней.** «Низкополигонально» — это число, а не
//      настроение: пять тел и тридцать граней на вещь. Без теста предел
//      продержался бы до первой модели, которую захотелось «чуть подробнее».
//   3. **Различимость силуэтов.** Две разные вещи не должны давать один
//      силуэт — то же обещание, что у плоских изображений (таск 139), только
//      отпечаток снимается с трёх сторон. Где модель общая — она общая **одним
//      описанием**, а не двумя похожими.
//   4. **Задел под интерактив.** У каждого тела есть имя, и свечение
//      выключено у всех до единого (слова заказчика: заложить, но не делать).
//   5. **Нет модели — прежняя коробка.** Пока модели писались, объём не был
//      сломан ни минуты, и тип, заведённый человеком руками, остаётся с
//      коробкой навсегда.
import test from "node:test";
import assert from "node:assert/strict";

import {
  addMark,
  addOutline,
  addRoom,
  addScheme,
  addSchemeObject,
  addSchemeObjectKind,
  addType,
  addWall,
  createProject,
  defaultTemplate,
  ensureSchemeObjectKinds,
  planMmToFraction,
  schemeObjectKindsInOrder,
  setMarkWall,
  setPlanOrigin,
  setPlanScale,
  setSchemeWallHeight,
  setTypeSizes,
  typeObjectView,
  updateSchemeObjectKind,
  styleOf,
} from "../src/model.js";
import { markBoxMm } from "../src/markBox.js";
import { objectViewByName, objectViewForShape } from "../src/objectViews/registry.js";
import { MODEL_CYL_SIDES, MODEL_MATERIALS } from "../src/objectModels/kit.js";
import { objectCatalogDefaults, objectCatalogKeys } from "../src/objectCatalog.js";
import {
  OBJECT_MODEL_BODY_MAX,
  OBJECT_MODEL_FACE_MAX,
  objectModelByKey,
  objectModelClashes,
  objectModelFaceCount,
  objectModelForName,
  objectModelKeys,
} from "../src/objectModels/registry.js";
import {
  VOLUME_EYE_MM,
  VOLUME_OBJECT_RGB,
  volumeMarkFaces,
  volumeMarkPlacement,
  volumeModelPrisms,
  volumeModelRgb,
  volumeObjectFaces,
  volumeObjectFrame,
  volumeObjectModel,
  volumeObjectPrisms,
  volumeScene,
  volumeTubeFaces,
} from "../src/volume.js";
import { strings } from "../src/strings.js";

// ——— стенд ———————————————————————————————————————————————————————————————

function planProject() {
  const added = addScheme(createProject(), { name: "1 этаж", imageId: "plan-1", width: 1200, height: 800 });
  let project = setPlanScale(added.project, added.scheme.id, {
    a: { x: 0.1, y: 0.5 },
    b: { x: 0.6, y: 0.5 },
    meters: 6,
  }).project;
  project = setPlanOrigin(project, added.scheme.id, { at: { x: 0.5, y: 0.5 }, turn: 0 }).project;
  project = setSchemeWallHeight(project, added.scheme.id, 2700).project;
  return { project, schemeId: added.scheme.id };
}

// Комната 4 × 3 м: четыре стены кольцом и контур по внутренним граням.
function roomScene() {
  const base = planProject();
  let project = base.project;
  const half = { x: 2000, y: 1500 };
  const corners = [
    { x: -half.x, y: -half.y },
    { x: half.x, y: -half.y },
    { x: half.x, y: half.y },
    { x: -half.x, y: half.y },
  ];
  const walls = [];
  for (let index = 0; index < corners.length; index += 1) {
    const added = addWall(project, {
      schemeId: base.schemeId,
      aMm: corners[index],
      bMm: corners[(index + 1) % corners.length],
      thicknessMm: 200,
    });
    project = added.project;
    walls.push(added.wall.id);
  }
  const room = addRoom(project, "Кухня");
  project = room.project;
  const inner = [
    { x: -half.x + 100, y: -half.y + 100 },
    { x: half.x - 100, y: -half.y + 100 },
    { x: half.x - 100, y: half.y - 100 },
    { x: -half.x + 100, y: half.y - 100 },
  ];
  project = addOutline(project, {
    schemeId: base.schemeId,
    roomId: room.room.id,
    points: inner.map((point) => planMmToFraction(project, base.schemeId, point)),
  }).project;
  return { project, schemeId: base.schemeId, walls, roomId: room.room.id };
}

// Метка типа `code` на северной стене, в середине её длины.
//
// Точка берётся **внутри комнаты**, а не на осевой линии стены: по ней
// решается, с какой стороны стены вещь стоит (`markWallSideOn`), и точка ровно
// на оси стороны не называет — метка уезжает в воздух, а стенд начинает
// проверять не то, что собирался.
function wallMark(code) {
  const scene = roomScene();
  let project = scene.project;
  const type = project.markTypes.find((item) => item.code === code);
  const at = { x: 0, y: -1300 };
  const added = addMark(project, {
    schemeId: scene.schemeId,
    typeId: type.id,
    kind: "point",
    points: [planMmToFraction(project, scene.schemeId, at)],
  });
  project = setMarkWall(added.project, added.mark.id, { wallId: scene.walls[0], atMm: 2000 }).project;
  const mark = project.marks.find((item) => item.id === added.mark.id);
  return { project, schemeId: scene.schemeId, mark, type };
}

/**
 * Вещь чертежа вида `name` в середине комнаты. Вида, которого в нынешнем
 * справочнике нет (кровать, холодильник — они приедут каталогом таска 154),
 * человек сегодня завёл бы руками: ровно это здесь и делается.
 */
function objectScene(name, patch = {}) {
  const scene = roomScene();
  let project = ensureSchemeObjectKinds(scene.project).project;
  let kind = schemeObjectKindsInOrder(project).find((item) => item.name === name);
  if (!kind) {
    const own = addSchemeObjectKind(project, { name });
    project = own.project;
    kind = own.schemeObjectKind;
  }
  const added = addSchemeObject(project, {
    schemeId: scene.schemeId,
    kindId: kind.id,
    shape: "rect",
    atMm: { x: 0, y: 0 },
    widthMm: 1200,
    depthMm: 600,
    heightMm: 800,
    heightAboveFloorMm: 0,
    ...patch,
  });
  return { project: added.project, schemeId: scene.schemeId, object: added.schemeObject, kind };
}

const modelOf = (key) => objectModelByKey(key);
const bodies = (key) => modelOf(key).parts;

// ——— охват ———————————————————————————————————————————————————————————————

test("у каждого точечного типа стартового справочника есть модель", () => {
  const template = defaultTemplate();
  const categories = new Map(template.categories.map((item) => [item.id, item]));
  const missing = [];
  let covered = 0;
  for (const type of template.markTypes) {
    const category = categories.get(type.categoryId);
    const shape = type.shape || (category ? category.shape : null);
    const view = objectViewByName(typeObjectView(type)) || objectViewForShape(shape);
    const model = view ? objectModelByKey(view.name) : null;
    // Лента модели не получает и получить не может: это не вещь, а цепочка
    // звеньев по пути, и у звена нет ни лица, ни верха.
    if (type.kind === "line") {
      assert.equal(model && model.key, "lamp", type.code + ": у линейного типа изображение светильника");
      continue;
    }
    if (!model) missing.push(type.code + " " + type.name);
    else covered += 1;
  }
  assert.deepEqual(missing, [], "тип без модели");
  assert.equal(covered, 44, "сорок четыре точечных типа из сорока девяти");
});

// Мастер-выключатель (таск 160, G239). Слова заказчика: «Мастер выключатель -
// это тоже выключатель, а изображён как светильник, надо поменять». Светильник
// он получал по лестнице: знак «Круг с подвесом» разбирает изображение `lamp`,
// а на имя изображения садится модель — отсюда плафон в объёме.
//
// Лечится это знаком, и только им: поля `view` в интерфейсе нет, справочник
// правят обозначением. Поэтому «Круг с клавишей» обязан приводить за собой
// выключателя — и типу из стартового справочника, и типу, заведённому руками,
// одинаково.
test("мастер-выключатель — выключатель и на развёртке, и в объёме", () => {
  const view = objectViewForShape("circle-slash");
  assert.ok(view, "у круга с клавишей нет изображения — развёртка нарисует знак");
  assert.equal(view.name, "switch1", "круг с клавишей разобран не выключателем: " + view.name);
  const model = objectModelByKey(view.name);
  assert.ok(model, "у изображения выключателя нет модели");
  assert.equal(model.key, "switch1");
  // Клавиша в модели есть, плафона нет: имена тел говорят, что собрано.
  const bodies = model.parts.map((part) => part.name);
  assert.ok(bodies.includes("frame"), "у выключателя нет рамки: " + bodies.join(", "));
  assert.deepEqual(bodies, objectModelByKey("switch1").parts.map((part) => part.name));
  assert.notEqual(model, objectModelByKey("lamp"), "модель мастер-выключателя — светильник");

  // Тип стартового справочника проходит ту же лестницу целиком: имени
  // изображения у него нет, и ответ даёт форма знака.
  const template = defaultTemplate();
  const categories = new Map(template.categories.map((item) => [item.id, item]));
  const master = template.markTypes.find((type) => type.code === "МВ");
  assert.equal(typeObjectView(master), null, "у МВ появилось имя изображения — лестница короче, чем у его типа");
  const shape = master.shape || categories.get(master.categoryId).shape;
  assert.equal(objectViewForShape(shape).name, "switch1");

  // А круг с подвесом остался светильником: знак заказчика никуда не поехал,
  // и его объект до смены знака выглядит ровно как выглядел (G68).
  assert.equal(objectViewForShape("circle-rays").name, "lamp");
});

test("у каждой вещи каталога есть модель, и девять прежних видов узнаются по имени", () => {
  for (const key of objectCatalogKeys()) {
    assert.ok(objectModelByKey(key), key + ": вещь каталога без модели");
  }
  // Тридцать ключей: тринадцать вещей из брифа, девять нынешних видов (шкаф у
  // них общий), унитаз с ванной (таск 162) и шесть вещей таска 177.
  assert.equal(objectCatalogKeys().length, 30);
  // Мост до каталога: имена нынешних видов из словаря ведут к своим ключам.
  for (const [key, name] of Object.entries(strings.schemeObjectKinds)) {
    const found = objectModelForName(name);
    assert.ok(found, name + ": вид не узнан по имени");
    assert.equal(found.key, key, name + ": узнан как " + found.key);
  }
  // Терпимость та же, что у лестницы: регистр, «ё» и пробелы не считаются, а
  // корень ищется внутри строки.
  assert.equal(objectModelForName("  ШКАФ в прихожей ").key, "cabinet");
  assert.equal(objectModelForName("Лестница на 2 этаж").key, "stairs");
  assert.equal(objectModelForName("Полотенцесушитель").key, "towelDryer");
  // «Столешница» содержит «стол» — и всё же это не стол: слова ищутся от
  // самого длинного корня.
  assert.equal(objectModelForName("Столешница (кухонный фронт)").key, "counter");
  assert.equal(objectModelForName("Стол").key, "table");
  // Переименовал человек вид в то, чего в каталоге нет, — модели не будет, и
  // вещь нарисуется габаритом, как рисовалась до моделей.
  assert.equal(objectModelForName("Пенал"), null);
  assert.equal(objectModelForName(""), null);
  assert.equal(objectModelForName(null), null);
});

test("ни один ключ не занят двумя семьями", () => {
  assert.deepEqual(objectModelClashes(), []);
  assert.ok(objectModelKeys().length >= 55, "ключей за полсотни: " + objectModelKeys().length);
});

// ——— предел тел и граней ——————————————————————————————————————————————————

test("у модели не больше пяти тел и тридцати граней", () => {
  const worst = [];
  for (const key of objectModelKeys()) {
    const model = objectModelByKey(key);
    const faces = objectModelFaceCount(model);
    assert.ok(
      model.parts.length <= OBJECT_MODEL_BODY_MAX,
      key + ": тел " + model.parts.length + " — больше предела",
    );
    assert.ok(faces <= OBJECT_MODEL_FACE_MAX, key + ": граней " + faces + " — больше предела");
    worst.push(faces);
  }
  // Средняя цена вещи — то число, которым считается кадр. Прежняя коробка
  // стоила шесть граней; втрое дороже — предел, за которым сцена живого
  // объекта перестаёт быть «сотнями граней» и становится тысячами.
  const average = worst.reduce((sum, value) => sum + value, 0) / worst.length;
  assert.ok(average < 18, "средняя цена модели в гранях: " + average.toFixed(1));
});

test("у каждого тела есть имя, материал из набора и выключенное свечение", () => {
  for (const key of objectModelKeys()) {
    const names = new Set();
    for (const part of bodies(key)) {
      assert.ok(part.name && /^[a-zA-Z][a-zA-Z0-9]*$/.test(part.name), key + ": имя тела «" + part.name + "»");
      assert.ok(!names.has(part.name), key + ": два тела с именем " + part.name);
      names.add(part.name);
      assert.ok(MODEL_MATERIALS.includes(part.material), key + "." + part.name + ": материал " + part.material);
      // Слова заказчика: заложить, но не делать. Включённого свечения в сборке
      // нет ни одного, и этот тест — тот самый замок.
      assert.equal(part.lit, false, key + "." + part.name + ": свечение включено");
      // Видов тела три: коробка, стоячий цилиндр и лежачий (таск 177). У
      // лежачего обязательна ось — без неё непонятно, где у него круг.
      assert.ok(["box", "cyl", "tube"].includes(part.kind), key + "." + part.name + ": вид тела " + part.kind);
      if (part.kind === "tube") {
        assert.ok(["x", "y"].includes(part.axis), key + "." + part.name + ": ось лежачего цилиндра " + part.axis);
      }
    }
  }
});

test("тела не вылезают за свой габарит", () => {
  for (const key of objectModelKeys()) {
    for (const part of bodies(key)) {
      const label = key + "." + part.name;
      assert.ok(part.width > 0 && part.depth > 0 && part.height > 0, label + ": вырожденное тело");
      assert.ok(part.x >= -0.5 && part.x + part.width <= 0.5, label + ": вылезло по ширине");
      assert.ok(part.y >= -0.5 && part.y + part.depth <= 0.5, label + ": вылезло по глубине");
      assert.ok(part.z >= 0 && part.z + part.height <= 1, label + ": вылезло по высоте");
    }
  }
});

// ——— правка моделей таска 177 (G262) —————————————————————————————————————

test("барабан стиральной машины лежачий и внутри корпуса", () => {
  // Слова заказчика: «Почему у стиральной машины перед ней цилиндр
  // вертикальный, хотя логичнее его сделать как барабан — горизонтальный и
  // внутри». Проверяется ровно это, числами: ось горизонтальна, тело глубже
  // лица корпуса, стоячего цилиндра не осталось ни одного.
  const parts = bodies("washer");
  const drum = parts.find((part) => part.name === "drum");
  const box = parts.find((part) => part.name === "case");
  assert.ok(drum && box, "у машины нет барабана или корпуса");
  assert.equal(drum.kind, "tube", "барабан не лежачий цилиндр");
  assert.equal(drum.axis, "y", "ось барабана смотрит не из лица в глубину");
  assert.ok(drum.y > box.y, "барабан вылез перед корпусом");
  assert.ok(drum.y + drum.depth < box.y + box.depth, "барабан вылез за корпус");
  assert.ok(
    !parts.some((part) => part.kind === "cyl"),
    "у машины остался стоячий цилиндр — это и была жалоба",
  );
  // Круг барабана круглый не на словах: в габарите 600 × 850 доли 0.8 и 0.56
  // дают 480 и 476 мм. Расхождение больше сантиметра — уже овал.
  const defaults = objectCatalogDefaults("washer");
  const across = drum.width * defaults.widthMm;
  const tall = drum.height * defaults.heightMm;
  assert.ok(Math.abs(across - tall) <= 10, "барабан вышел овальным: " + across + " × " + tall);
  // Люк — круг в лице, и он плоский: это окно, а не второй выступающий цилиндр.
  const hatch = parts.find((part) => part.name === "hatch");
  assert.equal(hatch.kind, "tube");
  assert.ok(hatch.depth <= 0.1, "люк выпирает из лица машины: " + hatch.depth);
  assert.equal(bodies("washer"), bodies("dryerMachine"), "машины разошлись телами");
});

test("у душа нет поддона, и он по-прежнему стоит на полу", () => {
  // «У Душа убери поддон» (G262). Решение таска 154 «душ стоит на полу»
  // остаётся: стойка начинается от нуля.
  const parts = bodies("shower");
  assert.ok(!parts.some((part) => part.name === "tray"), "поддон вернулся");
  assert.ok(
    parts.some((part) => part.z === 0),
    "душ повис: ни одно тело не стоит на полу",
  );
});

test("люстра заняла свой габарит и обрела ярус", () => {
  // «а люстру сделай побольше и посимпатичнее» (G262). Модель у точечных типов
  // света одна, и разводит их габарит, — поэтому «побольше» здесь значит
  // «выше и шире в своих долях», а не второй ключ.
  const parts = bodies("lamp");
  const shade = parts.find((part) => part.name === "shade");
  const tier = parts.find((part) => part.name === "tier");
  const rod = parts.find((part) => part.name === "rod");
  assert.ok(shade && tier && rod, "у светильника нет яруса или подвеса");
  assert.equal(shade.width, 1, "плафон уже габарита");
  assert.ok(shade.height + tier.height >= 0.7, "плафон занял меньше трёх четвертей высоты");
  assert.ok(rod.width <= 0.12, "подвес остался толстым: " + rod.width);
  assert.ok(
    objectModelFaceCount(objectModelByKey("lamp")) <= OBJECT_MODEL_FACE_MAX,
    "люстра вышла за предел граней",
  );
});

test("подсветка зеркала — круглое зеркало, и знак ведёт на него", () => {
  // «Метку Подсветка зеркала отрисовывай как зеркало, круглое» (G262). Знак
  // «кольцо» обязан приводить зеркало сам: имён изображений у заказчика в
  // объекте нет ни одного, а формы проставлены, — иначе правка не доехала бы
  // до уже размеченного чертежа (G68).
  const view = objectViewForShape("circle-ring");
  assert.ok(view, "у кольца нет изображения");
  assert.equal(view.name, "mirror", "кольцо разобрано не зеркалом: " + view.name);
  const model = objectModelByKey(view.name);
  assert.ok(model, "у зеркала нет модели");
  // Оба тела — лежачие цилиндры осью в стену: ею круг и ложится на лицо.
  for (const part of model.parts) {
    assert.equal(part.kind, "tube", part.name + ": зеркало собрано не лежачим цилиндром");
    assert.equal(part.axis, "y", part.name + ": ось зеркала смотрит не в стену");
  }
  // И круглым оно выходит на умолчаниях справочника: 600 × 600 габарита дают
  // круг, а не овал.
  const type = defaultTemplate().markTypes.find((item) => item.code === "ПЗ");
  assert.equal(typeObjectView(type), "mirror", "имя изображения у ПЗ не стоит");
  assert.equal(type.sizes.length, 600, "габарит зеркала не квадратный");
  assert.equal(type.sizes.width, 600, "габарит зеркала не квадратный");
  const glass = model.parts.find((part) => part.name === "glass");
  assert.equal(glass.width * type.sizes.length, glass.height * type.sizes.width, "стекло вышло овальным");
  // А светильник кольца лишился, но своих четырёх знаков не потерял.
  assert.equal(objectViewForShape("circle-cross").name, "lamp");
  assert.equal(objectViewForShape("circle-rays").name, "lamp");
});

test("карниз штор висит шторами до пола", () => {
  // «Карниз штор, метку — отрисовывай как шторы на объеме» (G261). Полотно
  // выходит из габарита вниз — это единственное такое тело в сборке, и
  // проверяется оно числами: низ полотна на нуле, верх — под трубой карниза.
  const scene = wallMark("КШ");
  const place = volumeMarkPlacement(scene.project, scene.mark, []);
  assert.ok(place && place.model, "у карниза нет модели");
  const prisms = volumeModelPrisms(place.frame, place.model.parts);
  const folds = prisms.filter((prism) => prism.name.startsWith("fold"));
  const rod = prisms.find((prism) => prism.name === "rod");
  assert.equal(folds.length, 3, "складок не три");
  assert.ok(rod, "трубы карниза нет");
  for (const fold of folds) {
    assert.equal(fold.bottomMm, 0, "полотно не доходит до пола");
    assert.ok(fold.topMm > 2300, "полотно начинается не у карниза: " + fold.topMm);
    assert.ok(fold.topMm <= rod.bottomMm + 1, "полотно залезло на трубу");
  }
  // Сам карниз из габарита не вышел: выделение, рамка и размеры в колонке
  // по-прежнему считаются по нему.
  assert.ok(rod.bottomMm > 2300, "труба карниза уехала из габарита");
  // Складки разведены по глубине — тем и читается ткань.
  const depths = new Set(folds.map((fold) => Math.round(fold.corners[0].y)));
  assert.ok(depths.size > 1, "складки встали в одну плоскость");
});

test("лежачий цилиндр — замкнутое тело, и все его грани смотрят наружу", () => {
  // Новый вид тела строит грани сам, минуя призмы, и ошибка в обходе дала бы
  // вещь, половина которой не видна с одной стороны и не видна насквозь с
  // другой. Поймать это глазами можно, но только зная, куда смотреть.
  const frame = {
    at: { x: 1000, y: 2000 },
    bottomMm: 0,
    u: { x: 1, y: 0 },
    f: { x: 0, y: -1 },
    widthMm: 600,
    depthMm: 600,
    heightMm: 850,
  };
  for (const axis of ["x", "y"]) {
    const part = { kind: "tube", axis, name: "drum", material: "body", lit: false, x: -0.4, width: 0.8, y: -0.4, depth: 0.74, z: 0.2, height: 0.56 };
    const faces = volumeTubeFaces(frame, part, [120, 120, 120]);
    assert.equal(faces.length, MODEL_CYL_SIDES + 2, "ось " + axis + ": граней не восемь с днищами");
    const middle = { x: 0, y: 0, z: 0 };
    let count = 0;
    for (const face of faces) {
      for (const point of face.p) {
        middle.x += point.x;
        middle.y += point.y;
        middle.z += point.z;
        count += 1;
      }
    }
    middle.x /= count;
    middle.y /= count;
    middle.z /= count;
    for (const face of faces) {
      const mid = { x: 0, y: 0, z: 0 };
      for (const point of face.p) {
        mid.x += point.x / face.p.length;
        mid.y += point.y / face.p.length;
        mid.z += point.z / face.p.length;
      }
      const away =
        face.n.x * (mid.x - middle.x) + face.n.y * (mid.y - middle.y) + face.n.z * (mid.z - middle.z);
      assert.ok(away > 0, "ось " + axis + ": грань смотрит внутрь тела");
    }
  }
});

// ——— различимость силуэтов ———————————————————————————————————————————————

// Отпечаток — тот же приём, что у знаков плана и плоских изображений, только
// снимается с трёх сторон: модель раскладывается на сетку 16 × 16 спереди
// (ширина и высота), с боку (глубина и высота) и сверху (ширина и глубина). В
// клетке — буква материала того тела, которое в этой проекции ближе к глазу:
// две вещи, собранные из одинаковых кусков, но разными материалами, — тоже
// разные вещи.
const PRINT_GRID = 16;

function printOf(model) {
  const rows = [];
  for (const axes of ["front", "side", "top"]) {
    for (let row = 0; row < PRINT_GRID; row += 1) {
      let line = "";
      for (let col = 0; col < PRINT_GRID; col += 1) {
        const a = (col + 0.5) / PRINT_GRID - 0.5;
        const b = (row + 0.5) / PRINT_GRID;
        let best = null;
        for (const part of model.parts) {
          const inX = a >= part.x && a <= part.x + part.width;
          const inY = a >= part.y && a <= part.y + part.depth;
          const inZ = 1 - b >= part.z && 1 - b <= part.z + part.height;
          const spanX = Math.abs(a - (part.x + part.width / 2)) <= part.width / 2;
          const spanY = Math.abs(a - (part.y + part.depth / 2)) <= part.depth / 2;
          // Лежачий цилиндр (таск 177) в проекции **поперёк своей оси** —
          // круг, и ровно этим круглое зеркало отличается от плиты на стене.
          // Вдоль оси он прямоугольник, как и всё остальное.
          const round = (ca, ra, cb, rb, pa, pb) => {
            const da = ra > 0 ? (pa - ca) / ra : 0;
            const db = rb > 0 ? (pb - cb) / rb : 0;
            return da * da + db * db <= 1;
          };
          const tubeFace = (acrossIn) =>
            round(
              part.x + part.width / 2,
              part.width / 2,
              part.z + part.height / 2,
              part.height / 2,
              acrossIn ? a : 0,
              1 - b,
            );
          // Цилиндр в проекции на свою ось шире прямоугольника не бывает,
          // поэтому для двух боковых видов хватает той же полосы.
          let hit = false;
          let depth = 0;
          if (axes === "front") {
            if (part.kind === "tube") {
              hit =
                part.axis === "y"
                  ? tubeFace(true)
                  : inX && round(part.y + part.depth / 2, part.depth / 2, part.z + part.height / 2, part.height / 2, 0, 1 - b);
            } else {
              hit = (part.kind === "cyl" ? spanX : inX) && inZ;
            }
            depth = part.y;
          } else if (axes === "side") {
            if (part.kind === "tube") {
              hit =
                part.axis === "x"
                  ? round(part.y + part.depth / 2, part.depth / 2, part.z + part.height / 2, part.height / 2, a, 1 - b)
                  : inY && round(part.x + part.width / 2, part.width / 2, part.z + part.height / 2, part.height / 2, 0, 1 - b);
            } else {
              hit = (part.kind === "cyl" ? spanY : inY) && inZ;
            }
            depth = part.x;
          } else {
            const fx = a;
            const fy = (row + 0.5) / PRINT_GRID - 0.5;
            if (part.kind === "cyl") {
              const dx = (fx - (part.x + part.width / 2)) / (part.width / 2);
              const dy = (fy - (part.y + part.depth / 2)) / (part.depth / 2);
              hit = dx * dx + dy * dy <= 1;
            } else {
              hit = fx >= part.x && fx <= part.x + part.width && fy >= part.y && fy <= part.y + part.depth;
            }
            depth = -(part.z + part.height);
          }
          if (hit && (best === null || depth < best.depth)) best = { depth, material: part.material };
        }
        line += best ? best.material[0] : ".";
      }
      rows.push(line);
    }
  }
  return rows.join("/");
}

test("две разные модели не дают один силуэт", () => {
  const prints = new Map();
  const shared = new Map();
  for (const key of objectModelKeys()) {
    const model = objectModelByKey(key);
    // Общая модель — это **одно описание под двумя ключами**, и тогда
    // одинаковый отпечаток не совпадение, а правда: стиральная и сушильная
    // машины телом не отличаются ничем, щит метки и щит чертежа — одна вещь.
    const sameAs = shared.get(model.parts);
    if (sameAs) continue;
    shared.set(model.parts, key);
    const print = printOf(model);
    assert.ok(!prints.has(print), key + " выглядит так же, как " + prints.get(print));
    prints.set(print, key);
  }
  assert.ok(prints.size >= 50, "разных моделей должно быть за полсотни: " + prints.size);
});

test("общая модель заведена одним описанием, а не двумя похожими", () => {
  // Где модель общая — там она общая по ссылке, и правка одной правит обе.
  assert.equal(bodies("washer"), bodies("dryerMachine"), "стиральная и сушильная машины");
  assert.equal(bodies("panel"), bodies("panelBox"), "щит на чертеже и щит меткой");
  // Унитаз и общий вид «Сантехника» — тоже одно описание, и это **условие
  // G68**: прежний чертёж, где вещь узнаётся по имени «Унитаз», с таска 162
  // находит модель по ключу `toilet` — и обязан получить ровно то тело,
  // которое получал по ключу `plumbing`.
  assert.equal(bodies("plumbing"), bodies("toilet"), "унитаз и общий вид сантехники");
  // А восемь точечных типов света делят модель потому, что делят изображение:
  // ключ у них один, и разводит их габарит.
  assert.equal(objectModelByKey("lamp").key, "lamp");
});

// ——— цвет ————————————————————————————————————————————————————————————————

test("материалы считаются от цвета вещи и не приносят своей краски", () => {
  const red = [209, 36, 47];
  const blue = [31, 111, 235];
  // `body` — ровно то, чем вещь рисовалась до моделей: ни одного нового цвета.
  assert.deepEqual(volumeModelRgb("body", red), red);
  const light = volumeModelRgb("light", red);
  const dark = volumeModelRgb("dark", red);
  assert.ok(light[0] + light[1] + light[2] > red[0] + red[1] + red[2], "light светлее тела");
  assert.ok(dark[0] + dark[1] + dark[2] < red[0] + red[1] + red[2], "dark темнее тела");
  // Металл и стекло почти нейтральны, но оттенок вещи в них остаётся: иначе
  // перекрашенная категория оставила бы в кадре чужие серые пятна.
  for (const material of ["metal", "glass"]) {
    const onRed = volumeModelRgb(material, red);
    const onBlue = volumeModelRgb(material, blue);
    assert.notDeepEqual(onRed, onBlue, material + " не заметил цвета вещи");
    const spread = Math.max(...onRed) - Math.min(...onRed);
    assert.ok(spread < 60, material + " слишком цветной: разброс каналов " + spread);
  }
  // Перекрасил человек категорию — поехали все пять материалов.
  for (const material of MODEL_MATERIALS) {
    assert.notDeepEqual(volumeModelRgb(material, red), volumeModelRgb(material, blue), material);
  }
});

// ——— интерпретатор: метки —————————————————————————————————————————————————

test("модель метки стоит лицом в комнату, на том же месте, где была коробка", () => {
  const stand = wallMark("Р");
  const place = volumeMarkPlacement(stand.project, stand.mark, []);
  assert.equal(place.mode, "wall", "стенд обязан поставить метку на стену, иначе он проверяет другое");
  assert.equal(place.model.key, "socket", "розетка нашла свою модель по форме знака");
  const prisms = volumeModelPrisms(place.frame, place.model.parts);
  assert.equal(prisms.length, 2);
  // Стена северная, её наружная сторона смотрит в комнату (к большим `y`).
  // Лицо габарита — доля −0.5 по глубине; сердцевина розетки лежит на нём, и
  // ни одно тело не выходит за коробку, которая была до модели.
  const box = place.prisms[0];
  // Мерим по направлению лица: `f` габарита смотрит от лица назад, значит
  // перёд — это −`f`, и в какую сторону стены повернулась метка, тесту знать
  // незачем.
  const ahead = (points) =>
    Math.max(...points.map((point) => -(point.x * place.frame.f.x + point.y * place.frame.f.y)));
  const behind = (points) =>
    Math.min(...points.map((point) => -(point.x * place.frame.f.x + point.y * place.frame.f.y)));
  const boxAhead = ahead(box.corners);
  for (const prism of prisms) {
    assert.ok(ahead(prism.corners) <= boxAhead + 0.01, "тело вышло вперёд за габарит");
    assert.ok(behind(prism.corners) >= behind(box.corners) - 0.01, "тело вышло назад за габарит");
    assert.ok(prism.bottomMm >= box.bottomMm - 0.01 && prism.topMm <= box.topMm + 0.01, "тело вышло по высоте");
  }
  // Сердцевина — переднее тело: она ближе к комнате, чем рамка за ней.
  const core = prisms.find((prism) => prism.name === "core");
  const frame = prisms.find((prism) => prism.name === "frame");
  assert.ok(ahead(core.corners) > ahead(frame.corners), "сердцевина впереди рамки");
  // Лицо модели — лицо габарита, но **с точностью вписанности**: цилиндр вписан
  // в своё тело, и у восьмиугольника вершины не ложатся на плоскость боков —
  // круглая сердцевина не дотягивается до лица на 1,3 % своей глубины (здесь
  // это доли миллиметра). Это свойство низкополигонального круга, а не промах
  // счёта: у коробки недотяг ровно нулевой, и ниже это проверено на рамке.
  assert.ok(boxAhead - ahead(core.corners) < 0.5, "сердцевина стоит на лице габарита");
  const back = Math.min(...box.corners.map((point) => -(point.x * place.frame.f.x + point.y * place.frame.f.y)));
  assert.equal(Math.round(behind(frame.corners)), Math.round(back), "рамка коробкой упирается в задник ровно");
  // Лицо габарита — то же, на котором рисуется контур изображения: модель и
  // рисунок стоят на одной плоскости, а не спорят за неё.
  const faceAhead = -(place.face.origin.x * place.frame.f.x + place.face.origin.y * place.frame.f.y);
  assert.equal(Math.round(faceAhead), Math.round(boxAhead));
});

test("у всех граней модели хозяин — сама метка: выделяется вещь, а не одно тело", () => {
  const stand = wallMark("Р");
  const place = volumeMarkPlacement(stand.project, stand.mark, []);
  const faces = volumeMarkFaces(place);
  assert.ok(faces.length >= 10, "граней у двух тел: " + faces.length);
  for (const face of faces) assert.equal(face.markId, place.markId);
  // Выделение и прицел смотрят на лицо, а лицо модель не трогает.
  assert.ok(place.face, "лицо осталось на месте");
});

// Комната как список для размещения меток в воздухе.
const roomList = (scene) => [
  {
    roomId: scene.roomId,
    pointsMm: [
      { x: -1900, y: -1400 },
      { x: 1900, y: -1400 },
      { x: 1900, y: 1400 },
      { x: -1900, y: 1400 },
    ],
    heightMm: 2700,
  },
];

test("нет модели — прежняя коробка по габариту", () => {
  const scene = roomScene();
  // Тип, заведённый человеком руками: ни имени изображения, ни формы, которой
  // изображение завели, — и это обычная жизнь, а не исключение.
  const added = addType(scene.project, {
    categoryId: scene.project.categories[0].id,
    code: "ЩЩ",
    name: "Своя вещь",
    shape: "square-grid",
  });
  // Размеры у своего типа человек задаёт сам (G192): без них вещи в объёме нет
  // вовсе — ни коробки, ни модели, — и окно честно говорит об этом строкой.
  const sizes = { length: 300, width: 400, depth: 90, heightAboveFloor: 1400 };
  let project = setTypeSizes(added.project, added.type.id, sizes).project;
  const mark = addMark(project, {
    schemeId: scene.schemeId,
    typeId: added.type.id,
    kind: "point",
    points: [planMmToFraction(project, scene.schemeId, { x: 0, y: -1000 })],
  });
  project = mark.project;
  const place = volumeMarkPlacement(project, project.marks[0], roomList(scene));
  // У формы `square-grid` изображение есть (щит), значит и модель есть —
  // лестница работает и для типа, заведённого руками, и это ровно то, чего
  // хотелось: человек получает модель, ничего про модели не зная.
  assert.equal(place.model.key, "panelBox", "своя вещь нашла модель по форме знака");
  // А вот тип, у которого формы нет вовсе: он берёт треугольник у «Климата»,
  // изображения такой формы не завели, — и вещь остаётся коробкой.
  const bare = addType(project, { categoryId: project.categories[3].id, code: "ЮЮ", name: "Без знака" });
  const bareSized = setTypeSizes(bare.project, bare.type.id, sizes).project;
  const noView = addMark(bareSized, {
    schemeId: scene.schemeId,
    typeId: bare.type.id,
    kind: "point",
    points: [planMmToFraction(bareSized, scene.schemeId, { x: 500, y: -1000 })],
  });
  const plain = volumeMarkPlacement(noView.project, noView.mark, roomList(scene));
  assert.equal(plain.view, null, "у категории «Климат» форма треугольная, изображения у неё нет");
  assert.equal(plain.model, null);
  const faces = volumeMarkFaces(plain);
  assert.equal(faces.length, 6, "прежняя коробка: четыре боковины, верх и низ");
  for (const face of faces) {
    assert.deepEqual(face.rgb, plain.bodyRgb, "коробка рисуется прежним цветом");
  }
});

test("запасной габарит и модель берутся у одного изображения", () => {
  // Стык с таском 152 (G215): у вещи без размеров габарит берётся у её
  // плоского изображения. Модель приходит оттуда же, и поэтому они сходятся —
  // в запасном габарите кондиционера не оказывается чужого кубика.
  const scene = roomScene();
  const added = addType(scene.project, {
    categoryId: scene.project.categories[3].id,
    code: "КК",
    name: "Свой кондиционер",
    shape: "circle-thermo",
  });
  const mark = addMark(added.project, {
    schemeId: scene.schemeId,
    typeId: added.type.id,
    kind: "point",
    points: [planMmToFraction(added.project, scene.schemeId, { x: 0, y: -1000 })],
  });
  const place = volumeMarkPlacement(mark.project, mark.mark, roomList(scene));
  assert.equal(place.spare, true, "размеров нет — габарит запасной");
  assert.equal(place.model.key, "conditioner", "и модель та же, что у изображения");
  // Габарит спрашивают у общего правила (G226, `markBox.js`): у этой вещи не
  // названо ни одной стороны, значит обе пришли от изображения.
  const spare = markBoxMm({ lengthMm: null, widthMm: null }, place.view);
  assert.equal(spare.from, "conditioner");
  assert.equal(spare.lengthFrom, "view");
  const prisms = volumeModelPrisms(place.frame, place.model.parts);
  assert.equal(prisms.length, 3, "корпус, панель и жалюзи");
  const xs = prisms.flatMap((prism) => prism.corners.map((point) => point.x));
  assert.equal(Math.round(Math.max(...xs) - Math.min(...xs)), spare.lengthMm, "модель заняла весь запасной габарит");
});

test("у ленты модели нет: это цепочка звеньев, а не вещь", () => {
  const scene = roomScene();
  const strip = scene.project.markTypes.find((type) => type.code === "Л");
  const added = addMark(scene.project, {
    schemeId: scene.schemeId,
    typeId: strip.id,
    kind: "line",
    points: [
      planMmToFraction(scene.project, scene.schemeId, { x: -1000, y: 0 }),
      planMmToFraction(scene.project, scene.schemeId, { x: 1000, y: 0 }),
    ],
  });
  const place = volumeMarkPlacement(added.project, added.mark, roomList(scene));
  assert.equal(place.model, null);
  assert.equal(place.frame, null);
  assert.equal(place.kind, "line");
  assert.ok(volumeMarkFaces(place).length > 0, "звенья нарисованы по-прежнему");
});

// ——— интерпретатор: вещи чертежа ——————————————————————————————————————————

test("вещь чертежа находит модель по ключу каталога, а имя — запасной путь", () => {
  const stand = objectScene("Шкаф");
  assert.equal(volumeObjectModel(stand.project, stand.object).key, "cabinet", "по имени вида");
  // Переименованный вид модели не находит: имя — единственное, что у прежней
  // вещи есть, и выдумывать за человека нечего.
  const renamed = updateSchemeObjectKind(stand.project, stand.kind.id, { name: "Пенал" }).project;
  assert.equal(volumeObjectModel(renamed, stand.object), null, "без ключа и без знакомого имени — габарит");
  // Ключ каталога живёт **у самой вещи** (таск 154) и старше любого имени:
  // переименованный вид ему не указ.
  assert.equal(volumeObjectModel(renamed, { ...stand.object, catalogKey: "fridge" }).key, "fridge");
  // А у вещи, поставленной каталогом, справочника видов нет вовсе — и модель
  // всё равно находится: она пришла из сборки, а не из объекта.
  assert.equal(
    volumeObjectModel({ ...renamed, schemeObjectKinds: [] }, { id: "x", shape: "rect", catalogKey: "bed" }).key,
    "bed",
  );
});

test("перёд вещи берётся из поворота на чертеже", () => {
  const stand = objectScene("Шкаф");
  const frame = volumeObjectFrame(stand.project, stand.schemeId, stand.object, 2700);
  // При нулевом повороте вещь смотрит вниз по листу: доля −0.5 по глубине
  // лежит на той стороне, где `y` больше.
  const front = volumeModelPrisms(frame, [{ ...bodies("cabinet")[0] }]).shift();
  const maxY = Math.max(...front.corners.map((point) => point.y));
  assert.ok(maxY > 0, "фасад смотрит вниз по листу: " + maxY);
  // Повернули на 180° — смотрит вверх, и ничего больше в описании не менялось.
  const turned = volumeObjectFrame(
    stand.project,
    stand.schemeId,
    { ...stand.object, turnDeg: 180 },
    2700,
  );
  const back = volumeModelPrisms(turned, [{ ...bodies("cabinet")[0] }]).shift();
  assert.ok(Math.min(...back.corners.map((point) => point.y)) < 0, "фасад развернулся вместе с вещью");
  // Поворот на 90° ставит ширину вдоль `y`: габарит едет за вещью целиком.
  const side = volumeObjectFrame(stand.project, stand.schemeId, { ...stand.object, turnDeg: 90 }, 2700);
  assert.equal(Math.round(side.u.x), 0);
  assert.equal(Math.round(side.u.y), 1);
});

test("колонна: модель в одно тело во весь габарит ничего в кадре не меняет", () => {
  const stand = objectScene("Колонна", { widthMm: 400, depthMm: 400, heightMm: null });
  const model = volumeObjectFaces(stand.project, stand.schemeId, stand.object, 2700);
  assert.equal(model.length, 5, "четыре боковины и верх, низ лежит на полу");
  for (const face of model) assert.deepEqual(face.rgb, VOLUME_OBJECT_RGB, "цвет вещи не изменился");
  // Грани — те же, что давала призма по габариту: сверяем по вершинам.
  const prism = volumeObjectPrisms(stand.project, stand.schemeId, stand.object, 2700);
  assert.equal(prism.length, 1);
  const corners = prism[0].corners.map((point) => Math.round(point.x) + ":" + Math.round(point.y)).sort();
  const topFace = model.find((face) => face.n.z === 1);
  assert.deepEqual(
    topFace.p.map((point) => Math.round(point.x) + ":" + Math.round(point.y)).sort(),
    corners,
    "модель стоит ровно там, где стоял габарит",
  );
  assert.equal(Math.max(...topFace.p.map((point) => point.z)), 2700, "во всю высоту помещения");
});

test("у ломаной модели нет: по ней задают полосу, а не вещь", () => {
  const scene = roomScene();
  let project = ensureSchemeObjectKinds(scene.project).project;
  const kind = schemeObjectKindsInOrder(project).find((item) => item.name === "Шкаф");
  const added = addSchemeObject(project, {
    schemeId: scene.schemeId,
    kindId: kind.id,
    shape: "polyline",
    pointsMm: [
      { x: -1500, y: 0 },
      { x: 0, y: 0 },
      { x: 0, y: 1000 },
    ],
    depthMm: 600,
    heightMm: 800,
  });
  assert.equal(volumeObjectModel(added.project, added.schemeObject), null);
  assert.equal(volumeObjectFrame(added.project, added.schemeObject.schemeId, added.schemeObject, 2700), null);
  // Рисуется она по-прежнему цепочкой призм: по пять граней на звено.
  const faces = volumeObjectFaces(added.project, scene.schemeId, added.schemeObject, 2700);
  assert.equal(faces.length, 10);
});

test("модель не трогает ни столкновения, ни объект", () => {
  const stand = objectScene("Кровать", { widthMm: 1600, depthMm: 2000, heightMm: 500 });
  const before = JSON.stringify(stand.project);
  const built = volumeScene(stand.project, stand.schemeId);
  assert.equal(JSON.stringify(stand.project), before, "объект изменился — это запрещено прямо (G68)");
  // Держит человека габарит, а не модель: между ножками стола не пройти, и
  // сквозь кровать тоже.
  assert.equal(built.solids.filter((solid) => Math.round(solid.half * 2) === 1600).length, 1);
  const bed = built.faces.filter((face) => face.rgb[0] !== 216 && face.rgb[0] !== 170 && face.rgb[0] !== 238);
  assert.ok(bed.length >= 15, "кровать нарисована тремя телами: " + bed.length);
});

test("цилиндр стоит к стене стороной, а не ребром", () => {
  // Восемь сторон со сдвигом на полшага: грани смотрят вперёд, назад и по
  // бокам. Без сдвига к стене было бы обращено ребро, и колонка у стены
  // казалась бы повёрнутой.
  const stand = objectScene("Сантехника", { widthMm: 400, depthMm: 600, heightMm: 800 });
  const frame = volumeObjectFrame(stand.project, stand.schemeId, stand.object, 2700);
  const bowl = volumeModelPrisms(frame, bodies("plumbing")).find((prism) => prism.name === "bowl");
  assert.equal(bowl.corners.length, MODEL_CYL_SIDES);
  const xs = bowl.corners.map((point) => Math.round(point.x));
  const pairs = xs.filter((value) => value === Math.min(...xs)).length;
  assert.equal(pairs, 2, "по бокам у цилиндра плоская грань, а не вершина");
});

test("метка в воздухе: модель висит под потолком, как висела коробка", () => {
  const scene = roomScene();
  const lamp = scene.project.markTypes.find((type) => type.code === "ЛЮ");
  const added = addMark(scene.project, {
    schemeId: scene.schemeId,
    typeId: lamp.id,
    kind: "point",
    points: [planMmToFraction(scene.project, scene.schemeId, { x: 0, y: 0 })],
  });
  const place = volumeMarkPlacement(added.project, added.mark, [
    { roomId: scene.roomId, pointsMm: [{ x: -1900, y: -1400 }, { x: 1900, y: -1400 }, { x: 1900, y: 1400 }, { x: -1900, y: 1400 }], heightMm: 2700 },
  ]);
  assert.equal(place.mode, "ceiling");
  assert.equal(place.model.key, "lamp");
  const prisms = volumeModelPrisms(place.frame, place.model.parts);
  const tops = prisms.map((prism) => prism.topMm);
  assert.equal(Math.max(...tops), 2700, "подвес упирается в потолок");
  const shade = prisms.find((prism) => prism.name === "shade");
  assert.equal(shade.bottomMm, 2400, "плафон свисает на выступ люстры");
  assert.ok(shade.corners.length === MODEL_CYL_SIDES);
});

test("точечный светильник и люстра: одно описание, разные вещи в кадре", () => {
  // Та самая цена общей модели, объявленная вслух: разводит их габарит, и
  // разводит сильнее, чем развели бы два описания.
  const scene = roomScene();
  const rooms = [
    {
      roomId: scene.roomId,
      pointsMm: [{ x: -1900, y: -1400 }, { x: 1900, y: -1400 }, { x: 1900, y: 1400 }, { x: -1900, y: 1400 }],
      heightMm: 2700,
    },
  ];
  const sizeOf = (code) => {
    const type = scene.project.markTypes.find((item) => item.code === code);
    const added = addMark(scene.project, {
      schemeId: scene.schemeId,
      typeId: type.id,
      kind: "point",
      points: [planMmToFraction(scene.project, scene.schemeId, { x: 0, y: 0 })],
    });
    const place = volumeMarkPlacement(added.project, added.mark, rooms);
    const prisms = volumeModelPrisms(place.frame, place.model.parts);
    const xs = prisms.flatMap((prism) => prism.corners.map((point) => point.x));
    return {
      width: Math.round(Math.max(...xs) - Math.min(...xs)),
      drop: Math.round(2700 - Math.min(...prisms.map((prism) => prism.bottomMm))),
    };
  };
  const spot = sizeOf("Т");
  const chandelier = sizeOf("ЛЮ");
  assert.equal(spot.drop, 2, "точечный сидит в потолке: выступ у него нулевой");
  assert.equal(chandelier.drop, 300, "люстра свисает на свой выступ");
  assert.ok(chandelier.width > spot.width * 4, "и шире впятеро: " + chandelier.width + " против " + spot.width);
  assert.deepEqual(styleOf(scene.project, scene.project.markTypes.find((item) => item.code === "Т").id).shape, "circle-cross");
});
