// Встроенный каталог вещей чертежа (таск 154, требования G220, G223–G225).
//
// Что здесь держится:
//
//   1. **Состав каталога.** Пятьдесят две вещи в семи категориях (последняя —
//      «Транспорт», таск 204), у каждой имя в словаре, положительный габарит и
//      известное место установки. Вещь, забытая в словаре, вышла бы в колонку
//      своим ключом по-английски.
//   2. **Мост до прежних видов.** Имя вида переводится в ключ терпимо, и
//      «Столешница» не становится «Столом».
//   3. **Две породы вещей в одном списке.** У новой ключ каталога, у прежней
//      вид справочника; читаются они одним местом и не мешают друг другу.
//   4. **G68 на объекте прежней сборки** (`legacy-drawing-project.json`):
//      открывается как был, имена видов целы, геометрия не сдвинулась, вещь
//      вне каталога остаётся на чертеже, а файл переживает круг «упаковали —
//      распаковали» без единой новой записи у вещей.
//   5. **Скрытие — только экран.** Спрятанная вещь не рисуется, не берётся
//      кликом и не попадает в объём; выгрузки о ней не знают вовсе.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  OBJECT_CATEGORIES,
  OBJECT_MOUNTS,
  objectCatalogCategory,
  objectCatalogDefaults,
  objectCatalogEntry,
  objectCatalogInOrder,
  objectCatalogKeyByName,
  objectCatalogKeys,
  objectCatalogName,
  objectCatalogRetired,
  objectCatalogRetiredKeys,
} from "../src/objectCatalog.js";
import {
  SCHEME_ANCHOR_OBJECT_KEYS,
  SCHEME_OBJECT_SHAPES,
  addScheme,
  addSchemeObject,
  createProject,
  deleteSchemeObject,
  findSchemeObject,
  schemeObjectKeyOf,
  schemeObjectMountOf,
  schemeObjectNameOf,
  schemeAnchorCandidates,
  schemeObjectsOnScheme,
  updateSchemeObject,
  wallObjectsOn,
  addWall,
} from "../src/model.js";
import { drawDrawing, drawingUnitBridge } from "../src/render.js";
import { workshopObjectDefaultsByKey, workshopObjectDefaultsByName, workshopPick } from "../src/panels/workshop.js";
import {
  VOLUME_BODY_MM,
  VOLUME_STEP_MM,
  volumeObjectModel,
  volumeScene,
  volumeStairNear,
  volumeStairs,
  volumeStep,
} from "../src/volume.js";
import { objectModelByKey, objectModelClashes } from "../src/objectModels/registry.js";
import { objectViewByName, objectViewClashes } from "../src/objectViews/registry.js";
import { packProject, unpackProject } from "../src/projectFile.js";
import { strings } from "../src/strings.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const LEGACY_TEXT = readFileSync(join(HERE, "legacy-drawing-project.json"), "utf8");
const legacyProject = () => JSON.parse(LEGACY_TEXT);
// Чертёж **прошлой сборки**, где телевизор и полотенцесушитель ещё были вещами
// каталога (таск 177): телевизор и полотенцесушитель поставлены ключом, а
// третья вещь — видом справочника по имени «Полотенцесушитель», как ставили до
// каталога. Рядом стоит радиатор: по нему видно, что сосед не поехал.
const RETIRED_TEXT = readFileSync(join(HERE, "retired-objects-project.json"), "utf8");
const retiredProject = () => JSON.parse(RETIRED_TEXT);

function scribe(log) {
  return new Proxy(
    {
      measureText: (value) => ({ width: String(value).length * 6 }),
      save: () => {},
      restore: () => {},
    },
    {
      get:
        (target, key) =>
        key in target
          ? target[key]
          : (...args) =>
              log.push(
                String(key) + "(" + args.map((value) => (typeof value === "number" ? Math.round(value) : String(value))).join(",") + ")",
              ),
      set: (target, key, value) => {
        log.push(String(key) + "=" + String(value));
        return true;
      },
    },
  );
}

// Комната со стенами и схемой — на ней ставят вещи.
function room() {
  const base = addScheme(createProject(), { name: "1 этаж", imageId: null, width: 1200, height: 900 });
  const schemeId = base.scheme.id;
  let project = base.project;
  const corners = [
    [{ x: 0, y: 0 }, { x: 4000, y: 0 }],
    [{ x: 4000, y: 0 }, { x: 4000, y: 3000 }],
    [{ x: 4000, y: 3000 }, { x: 0, y: 3000 }],
    [{ x: 0, y: 3000 }, { x: 0, y: 0 }],
  ];
  for (const [aMm, bMm] of corners) {
    project = addWall(project, { schemeId, aMm, bMm, thicknessMm: 100 }).project;
  }
  return { project, schemeId };
}

function place(scene, catalogKey, patch = {}) {
  const sizes = objectCatalogDefaults(catalogKey);
  const added = addSchemeObject(scene.project, {
    schemeId: scene.schemeId,
    catalogKey,
    shape: "rect",
    atMm: { x: 2000, y: 1500 },
    widthMm: sizes.widthMm,
    depthMm: sizes.depthMm,
    turnDeg: 0,
    heightMm: sizes.heightMm,
    heightAboveFloorMm: sizes.heightAboveFloorMm,
    ...patch,
  });
  return { ...scene, project: added.project, object: added.schemeObject };
}

// ——— состав каталога ————————————————————————————————————————————————————

test("в каталоге пятьдесят две вещи, и каждая стоит ровно в одной категории", () => {
  const keys = objectCatalogKeys();
  assert.equal(keys.length, 52, "вещей в каталоге стало другое число: " + keys.length);
  assert.equal(new Set(keys).size, keys.length, "ключ занят дважды");
  // Тринадцать из брифа заказчика — поимённо: список называли словами, и
  // пропажа любой из них должна краснеть, а не теряться в числе.
  for (const key of [
    "table",
    "bed",
    "pool",
    "washer",
    "dryerMachine",
    "sink",
    "shower",
    "dresser",
    "picture",
    "stove",
    "dishwasher",
    "fridge",
  ]) {
    assert.ok(objectCatalogEntry(key), "вещь из брифа пропала: " + key);
  }
  // И девять прежних видов справочника — тоже поимённо: ими размечены чужие
  // чертежи, и выкинуть их нельзя (G68).
  for (const key of ["column", "niche", "duct", "stairs", "panel", "radiator", "counter", "plumbing", "cabinet"]) {
    assert.ok(objectCatalogEntry(key), "прежний вид не попал в каталог: " + key);
  }
  // Шкаф общий у брифа и у справочника — поэтому ключей было двадцать два, а
  // не двадцать три.
  // И мебель таска 177 (G262): «в мебель диван, кресло, журнальный стол,
  // компьютерные стол и кресло (один объект), табуретки». Компьютерный стол с
  // креслом — одна вещь, а не две. Телевизор был шестым — и ушёл в метки
  // (таск 186).
  for (const key of ["sofa", "armchair", "coffeeTable", "deskSet", "stool"]) {
    assert.ok(objectCatalogEntry(key), "вещь таска 177 пропала: " + key);
  }
  // И четыре вещи таска 204 (G308): «Добавь ещё в объекты для чертежа
  // Автомобиль, беговую дорожку, экран проектора, а так же выход с лестницы».
  for (const key of ["treadmill", "projectorScreen", "stairsExit", "car"]) {
    assert.ok(objectCatalogEntry(key), "вещь таска 204 пропала: " + key);
  }
  // Телевизор и полотенцесушитель — метки (таск 186, G279), и в каталоге их
  // нет ни одной дверью: ни ключом, ни плиткой, ни умолчанием.
  for (const key of objectCatalogRetiredKeys()) {
    assert.equal(objectCatalogEntry(key), null, key + ": ушедшая в метки вещь осталась в каталоге");
    assert.equal(objectCatalogDefaults(key), null, key + ": у ушедшей вещи остались умолчания");
    assert.equal(objectCatalogName(key), "", key + ": ушедшая вещь всё ещё называется каталогом");
    assert.ok(!keys.includes(key), key + ": ушедшая вещь осталась в ключах каталога");
    assert.ok(
      !objectCatalogInOrder().some((entry) => entry.key === key),
      key + ": ушедшая вещь всё ещё стоит в плитках",
    );
  }
  assert.deepEqual(objectCatalogRetiredKeys(), ["tv", "towelDryer"]);
  for (const key of ["sofa", "armchair", "coffeeTable", "deskSet", "stool"]) {
    assert.equal(objectCatalogEntry(key).category, "furniture", key + ": вещь ушла не в мебель");
  }
  assert.equal(objectCatalogEntry("cabinet").name, strings.schemeObjectKinds.cabinet);
  // И две вещи таска 162: «А где в перечне сантехники унитаз и ванна?»
  for (const key of ["toilet", "bathtub"]) {
    assert.equal(objectCatalogEntry(key).category, "sanitary", key + ": вещь ушла из сантехники");
  }
  const counted = OBJECT_CATEGORIES.reduce((sum, category) => sum + objectCatalogCategory(category).length, 0);
  assert.equal(counted, keys.length, "вещь стоит вне категорий или в двух сразу");
  assert.deepEqual(objectCatalogInOrder().map((entry) => entry.key).sort(), [...keys].sort());
});

test("у каждой вещи есть имя в словаре, габарит и место установки", () => {
  for (const entry of objectCatalogInOrder()) {
    assert.equal(entry.name, strings.schemeObjectKinds[entry.key], entry.key + ": имя не из словаря");
    assert.ok(entry.name && entry.name.trim() !== "", entry.key + ": имя пустое");
    assert.ok(SCHEME_OBJECT_SHAPES.includes(entry.shape), entry.key + ": форма неизвестна");
    assert.ok(entry.widthMm > 0 && entry.depthMm > 0, entry.key + ": габарит не положительный");
    assert.ok(entry.heightMm === null || entry.heightMm > 0, entry.key + ": высота не положительная");
    assert.ok(entry.heightAboveFloorMm >= 0, entry.key + ": высота от пола отрицательная");
    assert.ok(OBJECT_MOUNTS.includes(entry.mount), entry.key + ": место установки неизвестно");
    // Вещь на стене обязана висеть: нулевая высота от пола у картины значила
    // бы, что она стоит на полу, — а это уже другая вещь.
    if (entry.mount === "wall") assert.ok(entry.heightAboveFloorMm > 0, entry.key + ": на стене, а лежит на полу");
    if (entry.mount === "floor" && entry.key !== "counter") {
      assert.equal(entry.heightAboveFloorMm, 0, entry.key + ": на полу, а висит");
    }
    assert.ok(strings.schemeObjectMounts[entry.mount], entry.mount + ": у места установки нет строки");
  }
  for (const category of OBJECT_CATEGORIES) {
    assert.ok(strings.schemeObjectCategories[category], category + ": у категории нет имени");
  }
});

test("числа прежних девяти видов не поехали — чертежи, набранные по ним, остаются прежними", () => {
  // Радиатор висит под окном ровно там, где хочется розетка, а верх
  // столешницы — то число, от которого отмеряют розетки над кухонным фронтом.
  // Ради них объекты на чертеже и заведены (таск 122), и сменить эти числа
  // значило бы увести все новые вещи у того, кто ставит их по привычке.
  assert.deepEqual(objectCatalogDefaults("radiator"), {
    shape: "rect",
    widthMm: 1200,
    depthMm: 100,
    heightMm: 500,
    heightAboveFloorMm: 150,
  });
  const counter = objectCatalogDefaults("counter");
  assert.equal(counter.shape, "polyline", "кухонный фронт идёт полосой по стене");
  assert.equal(counter.depthMm, 600);
  assert.equal(counter.heightAboveFloorMm + counter.heightMm, 900, "верх столешницы — 900 мм");
  for (const key of ["column", "niche", "duct", "stairs"]) {
    assert.equal(objectCatalogDefaults(key).heightMm, null, key + ": высота во всю высоту помещения");
  }
  // Числа заказчика из тикета — дословно.
  assert.deepEqual(
    [objectCatalogDefaults("bed").widthMm, objectCatalogDefaults("bed").depthMm, objectCatalogDefaults("bed").heightMm],
    [1600, 2000, 500],
  );
  assert.deepEqual(
    [
      objectCatalogDefaults("fridge").widthMm,
      objectCatalogDefaults("fridge").depthMm,
      objectCatalogDefaults("fridge").heightMm,
    ],
    [600, 600, 1850],
  );
  assert.equal(objectCatalogDefaults("какая-то вещь"), null);
});

test("унитаз и ванна встали ходовым размером, а общий вид «Сантехника» остался на месте", () => {
  // Компакт: ширина чаши 340–380, вылет от стены с бачком 600–700, верх бачка
  // 780–800 — взяты середины рядов. Ванна: 1700 × 700 — ходовой размер и
  // стального (ГОСТ 1154-80), и акрилового ряда, борт на 600.
  assert.deepEqual(objectCatalogDefaults("toilet"), {
    shape: "rect",
    widthMm: 360,
    depthMm: 650,
    heightMm: 780,
    heightAboveFloorMm: 0,
  });
  assert.deepEqual(objectCatalogDefaults("bathtub"), {
    shape: "rect",
    widthMm: 1700,
    depthMm: 700,
    heightMm: 600,
    heightAboveFloorMm: 0,
  });
  // Общий вид никуда не делся и числа его целы: по нему открываются чужие
  // чертежи (G68).
  assert.deepEqual(objectCatalogDefaults("plumbing"), {
    shape: "rect",
    widthMm: 700,
    depthMm: 400,
    heightMm: 400,
    heightAboveFloorMm: 0,
  });
  // Он один во всём каталоге помечен прежним — и значит, прячется из плиток
  // ровно он, а не «всё, что старше».
  assert.deepEqual(
    objectCatalogInOrder().filter((entry) => entry.legacy).map((entry) => entry.key),
    ["plumbing"],
  );
});

// ——— четыре вещи таска 204 (G308) ————————————————————————————————————————

test("дорожка, экран, выход и автомобиль встали своими числами и своей посадкой", () => {
  // Дорожка домашняя: длина у ходовых 1700–2100, ширина 800–900, высота по
  // консоли 1300–1450 — взяты середины. В «Технике», потому что просит розетку
  // под свои 1,5–3 кВт, а не в «Мебели», где провода ни у кого нет.
  assert.deepEqual(objectCatalogDefaults("treadmill"), {
    shape: "rect",
    widthMm: 850,
    depthMm: 1900,
    heightMm: 1400,
    heightAboveFloorMm: 0,
  });
  assert.equal(objectCatalogEntry("treadmill").category, "appliances");
  // Экран проектора: 100 дюймов 16:9 — полотно 2214 × 1245, кассета длиннее
  // полотна, глубина кассеты 100–130. Габарит описывает **развёрнутый** экран,
  // поэтому важна посадка: висит на стене, низ полотна на 1000, верх на 2250 —
  // под потолком 2800 кассете есть куда встать.
  assert.deepEqual(objectCatalogDefaults("projectorScreen"), {
    shape: "rect",
    widthMm: 2300,
    depthMm: 120,
    heightMm: 1250,
    heightAboveFloorMm: 1000,
  });
  assert.equal(objectCatalogEntry("projectorScreen").mount, "wall", "экран обязан висеть, а не стоять на полу");
  assert.equal(objectCatalogEntry("projectorScreen").heightAboveFloorMm + 1250, 2250);
  // Автомобиль легковой, не фура: середина ряда C/D класса. И это ровно то, что
  // встаёт в машиноместо 5300 × 2500 (СП 113.13330) с проходом вокруг.
  assert.deepEqual(objectCatalogDefaults("car"), {
    shape: "rect",
    widthMm: 1800,
    depthMm: 4600,
    heightMm: 1500,
    heightAboveFloorMm: 0,
  });
  assert.ok(objectCatalogDefaults("car").depthMm < 5300, "легковая, а не фура: должна влезать в машиноместо");
  assert.equal(objectCatalogEntry("car").category, "transport");
  // Раздел заведён под неё и стоит последним — порядок категорий это порядок
  // колонок в окне выбора.
  assert.equal(OBJECT_CATEGORIES[OBJECT_CATEGORIES.length - 1], "transport");
  assert.deepEqual(objectCatalogCategory("transport").map((entry) => entry.key), ["car"]);
});

test("выход с лестницы — парный лестнице элемент: свой ключ, её габарит и своя высота", () => {
  const stairs = objectCatalogDefaults("stairs");
  const exit = objectCatalogDefaults("stairsExit");
  // **Габарит тот же до миллиметра**: выход накрывает проём над лестницей, и
  // совмещаются два этажа именно этим (таск 205). Разойдись числа — выход
  // пришёлся бы не над лестницей.
  assert.equal(exit.widthMm, stairs.widthMm, "ширина выхода разошлась с лестничной");
  assert.equal(exit.depthMm, stairs.depthMm, "длина выхода разошлась с лестничной");
  assert.equal(exit.widthMm, 1100);
  assert.equal(exit.depthMm, 2700);
  // А высота **своя и низкая**: лестница стоит призмой до потолка, выход — пол
  // верхнего этажа, по которому ходят. Объём переступает через всё, что не выше
  // `VOLUME_STEP_MM`, — поэтому выход виден, но человека не держит.
  assert.equal(stairs.heightMm, null, "лестница по-прежнему во всю высоту помещения");
  assert.equal(exit.heightMm, 200);
  assert.ok(exit.heightMm <= VOLUME_STEP_MM, "через выход обязаны переступать, иначе на него не сойти");
  assert.equal(objectCatalogEntry("stairsExit").category, "stairway", "выход ушёл из лестничного раздела");
  assert.equal(objectCatalogEntry("stairsExit").mount, "floor");
  // **Ключ свой**, а не имя вида: по нему выход будут искать (таск 205), как по
  // ключу ищут лестницу (таск 149).
  assert.ok(objectCatalogKeys().includes("stairsExit"));
  assert.notEqual(objectCatalogName("stairsExit"), objectCatalogName("stairs"));
  // Имя выхода узнаётся выходом, хотя внутри него сидит и лестничный корень:
  // слова ищутся от самого длинного, и путать их нельзя — иначе выход прежней
  // разметки переводил бы по этажам не оттуда.
  assert.equal(objectCatalogKeyByName("Выход с лестницы"), "stairsExit");
  assert.equal(objectCatalogKeyByName("  ВЫХОД С ЛЕСТНИЦЫ  "), "stairsExit");
  assert.equal(objectCatalogKeyByName("Сход с лестницы на 1 этаж"), "stairsExit");
  // А сама лестница — по-прежнему лестница, и это главное: переход по этажам
  // (таск 149) узнаёт её по этому ключу.
  assert.equal(objectCatalogKeyByName("Лестница"), "stairs");
  assert.equal(objectCatalogKeyByName("Лестница на 2 этаж"), "stairs");
  // Имена новых вещей чужих корней не отбирают: «Стиральная машина» осталась
  // машиной, а не автомобилем, и «Экран радиатора» — радиатором.
  assert.equal(objectCatalogKeyByName("Автомобиль"), "car");
  assert.equal(objectCatalogKeyByName("Стиральная машина"), "washer");
  assert.equal(objectCatalogKeyByName("Экран проектора"), "projectorScreen");
  assert.equal(objectCatalogKeyByName("Экран радиатора"), "radiator");
  assert.equal(objectCatalogKeyByName("Беговая дорожка"), "treadmill");
});

test("девятнадцать вещей таска 216 на месте, и каждая знает своё место установки", () => {
  // Перечень заказчика (G322) и принятые им предложения (G325): «давай
  // добавим что предложил». Поимённо — потому что список называли словами, и
  // пропажа любой должна краснеть, а не теряться в числе.
  const asked = {
    railing: "structures",
    fence: "structures",
    stairsL: "stairway",
    stairsU: "stairway",
    stairsSpiral: "stairway",
    plant: "decor",
    treePot: "decor",
    floorLamp: "decor",
  };
  const offered = {
    rack: "engineering",
    boiler: "engineering",
    waterHeater: "engineering",
    manifold: "engineering",
    ventUnit: "engineering",
    fireplace: "decor",
    wallMirror: "decor",
    rug: "decor",
    kitchenIsland: "furniture",
    barCounter: "furniture",
    chest: "furniture",
    shelving: "furniture",
  };
  for (const [key, category] of Object.entries({ ...asked, ...offered })) {
    const entry = objectCatalogEntry(key);
    assert.ok(entry, "вещь таска 216 пропала: " + key);
    assert.equal(entry.category, category, key + ": вещь ушла не в свой раздел");
    assert.equal(entry.name, strings.schemeObjectKinds[key], key + ": имя не из словаря");
    assert.equal(objectCatalogKeyByName(entry.name), key, key + ": имя не узнаётся своим ключом");
  }
  // Инженерия вся на стене и вся висит: котёл, бойлер и рэк на полу не стоят,
  // и нулевая высота у них значила бы, что вещь поставили, а не повесили.
  for (const key of Object.keys(offered).filter((key) => offered[key] === "engineering")) {
    assert.equal(objectCatalogEntry(key).mount, "wall", key + ": инженерия должна висеть");
    assert.ok(objectCatalogEntry(key).heightAboveFloorMm > 0, key + ": висит на нулевой высоте");
  }
  // Перила и забор — **полосы**: у них длина идёт по месту с поворотами.
  for (const key of ["railing", "fence"]) {
    assert.equal(objectCatalogDefaults(key).shape, "polyline", key + ": линейная вещь стала прямоугольником");
  }
  // Зеркало-вещь и «Подсветка зеркала»-метка — **разные ключи**: у метки своё
  // круглое зеркало с подсветкой (таск 177), у вещи своё настенное в рост.
  assert.ok(objectViewByName("wallMirror"), "у зеркала-вещи нет изображения");
  assert.ok(objectViewByName("mirror"), "изображение подсветки зеркала пропало");
  assert.notEqual(objectCatalogEntry("wallMirror").widthMm, 600, "вещь взяла габарит метки");
  // И ни одного ключа дважды: реестры плоские, и вещь с именем метки затёрла
  // бы ей тело.
  assert.deepEqual(objectViewClashes(), []);
  assert.deepEqual(objectModelClashes(), []);
});

test("раскладка названа: восемь разделов, и «Лестницы» — ровно лестничная клетка (G326)", () => {
  // Заказчик разрешил перегруппировать («можешь перегруппировать»), и
  // раскладка после этого — решение, а не то, как сложилось. Поэтому она
  // названа здесь числом: перестановка вещи между разделами обязана краснеть,
  // потому что человек видит разделы в окне выбора.
  assert.deepEqual(OBJECT_CATEGORIES, [
    "furniture",
    "sanitary",
    "appliances",
    "stairway",
    "structures",
    "engineering",
    "decor",
    "transport",
  ]);
  const sizes = OBJECT_CATEGORIES.map((category) => objectCatalogCategory(category).length);
  assert.deepEqual(sizes, [14, 6, 7, 5, 5, 7, 7, 1], "вещи переехали между разделами: " + sizes.join(","));
  assert.equal(sizes.reduce((sum, value) => sum + value, 0), objectCatalogKeys().length);
  // **Раздел «Лестницы» и лестничная клетка — одно и то же.** Это не
  // совпадение, а то, ради чего раздел и заведён: по этим же ключам объём
  // переводит по этажам (T149), а привязка берёт точку (T205). Разойдись они —
  // в разделе стояла бы лестница, которая не лестница.
  assert.deepEqual(
    objectCatalogCategory("stairway").map((entry) => entry.key),
    SCHEME_ANCHOR_OBJECT_KEYS,
    "раздел «Лестницы» разошёлся с лестничной клеткой",
  );
  // Переезд раздела — правка сборки, а не формата: у поставленной вещи в
  // объекте лежит ключ, и категории там нет вовсе (G68).
  const scene = room();
  const put = place(scene, "stairsSpiral");
  assert.ok(!Object.prototype.hasOwnProperty.call(put.object, "category"), "категория уехала в объект");
  assert.ok(!JSON.stringify(put.project).includes('"category"'), "категория появилась в файле объекта");
});

test("пара лестница — выход стала точкой привязки сама, без правки привязки", () => {
  // Таск 205 положил ключи заранее и написал у себя: «придёт запись в каталог
  // — выход начнёт предлагаться сам». Проверяю, что пришла именно та запись:
  // слово в списке привязки и ключ каталога — одно и то же слово, и другого
  // места, где выход знают по ключу, у привязки нет.
  for (const key of SCHEME_ANCHOR_OBJECT_KEYS) {
    assert.ok(objectCatalogEntry(key), key + ": привязка ждёт вещь, которой в каталоге нет");
  }
  const scene = room();
  const withExit = place(scene, "stairsExit", { atMm: { x: 2000, y: 1500 } });
  const found = schemeAnchorCandidates(withExit.project, scene.schemeId);
  assert.deepEqual(
    found.map((item) => [item.key, item.name]),
    [["stairsExit", strings.schemeObjectKinds.stairsExit]],
  );
  assert.deepEqual(found[0].atMm, { x: 2000, y: 1500 }, "точка берётся из середины габарита выхода");
});

test("имя прежнего вида переводится в ключ терпимо, и столешница не становится столом", () => {
  assert.equal(objectCatalogKeyByName("Шкаф"), "cabinet");
  assert.equal(objectCatalogKeyByName("  ШКАФ в прихожей "), "cabinet");
  assert.equal(objectCatalogKeyByName("Лестница на 2 этаж"), "stairs");
  assert.equal(objectCatalogKeyByName("stairs"), "stairs");
  assert.equal(objectCatalogKeyByName("Столешница (кухонный фронт)"), "counter");
  assert.equal(objectCatalogKeyByName("Стол"), "table");
  assert.equal(objectCatalogKeyByName("Сушильная машина"), "dryerMachine");
  // Имена словаря ведут каждое к своему ключу — иначе выбор плитки показывал
  // бы одну вещь, а чертёж называл другую.
  for (const [key, name] of Object.entries(strings.schemeObjectKinds)) {
    assert.equal(objectCatalogKeyByName(name), key, name + ": узнан как " + objectCatalogKeyByName(name));
  }
  // Корень «унитаз» переехал от общего вида к унитазу: хозяин у слова теперь
  // честный, а прежний чертёж с видом по имени «Унитаз» от этого не меняется —
  // тело в объёме у них одно и то же, а на чертеже вещь рисуется габаритом и
  // своим именем. Имя «Сантехника» по-прежнему ведёт к общему виду.
  assert.equal(objectCatalogKeyByName("Унитаз"), "toilet");
  assert.equal(objectCatalogKeyByName("Сантехника"), "plumbing");
  assert.equal(objectCatalogKeyByName("Ванна"), "bathtub");
  assert.equal(objectCatalogKeyByName("ванная"), "bathtub");
  // Диван с таска 177 — своя вещь каталога, и ванной он не становится: корень
  // «ванн», а не «ван». А «Диванная подушка» содержит оба корня — и побеждает
  // длинный, как и задумано.
  assert.equal(objectCatalogKeyByName("Диван"), "sofa");
  assert.equal(objectCatalogKeyByName("Диванная подушка"), "sofa");
  // Вещи таска 177 узнаются по своим корням, и длинный корень забирает имя у
  // короткого: журнальный и компьютерный столы столом не становятся.
  assert.equal(objectCatalogKeyByName("Журнальный стол"), "coffeeTable");
  assert.equal(objectCatalogKeyByName("Компьютерный стол"), "deskSet");
  assert.equal(objectCatalogKeyByName("Компьютерное кресло"), "deskSet");
  assert.equal(objectCatalogKeyByName("Кресло"), "armchair");
  assert.equal(objectCatalogKeyByName("Табуретки на кухне"), "stool");
  // Имена ушедших в метки вещей по-прежнему переводятся в ключ: вид прежней
  // разметки, названный «Телевизор» или «Полотенцесушитель», обязан узнаваться
  // так же, как узнавался вчера (G68). В самом каталоге этих вещей при этом
  // нет — надгробие отвечает только на вопрос «чем названо то, что уже стоит».
  assert.equal(objectCatalogKeyByName("Телевизор"), "tv");
  assert.equal(objectCatalogKeyByName("Полотенцесушитель"), "towelDryer");
  assert.equal(objectCatalogRetired("tv").name, "Телевизор");
  assert.equal(objectCatalogRetired("towelDryer").mount, "wall");
  assert.equal(objectCatalogRetired("fridge"), null, "вещь каталога прочлась ушедшей");
  assert.equal(objectCatalogRetired("нет такого"), null);
  assert.equal(objectCatalogKeyByName("Аквариум"), null);
  assert.equal(objectCatalogKeyByName(""), null);
  assert.equal(objectCatalogKeyByName(null), null);
  assert.equal(objectCatalogName("table"), "Стол");
  assert.equal(objectCatalogName("нет такого"), "");
});

test("умолчания колонки берутся у каталога — и по ключу, и по имени прежнего вида", () => {
  assert.deepEqual(workshopObjectDefaultsByKey("fridge"), objectCatalogDefaults("fridge"));
  assert.deepEqual(workshopObjectDefaultsByName("Холодильник"), objectCatalogDefaults("fridge"));
  // Вид вне каталога получает запасной квадрат — ровно как до каталога.
  const own = workshopObjectDefaultsByName("Аквариум");
  assert.equal(own.shape, "rect");
  assert.ok(own.widthMm > 0 && own.depthMm > 0);
  assert.equal(own.heightMm, null);
});

// ——— вещь на чертеже ——————————————————————————————————————————————————

test("вещь каталога ставится ключом и справочника видов в объекте не заводит", () => {
  const scene = place(room(), "fridge");
  assert.equal(scene.object.catalogKey, "fridge");
  assert.ok(!Object.prototype.hasOwnProperty.call(scene.object, "kindId"), "у вещи каталога остался вид справочника");
  assert.ok(
    !Object.prototype.hasOwnProperty.call(scene.project, "schemeObjectKinds"),
    "каталог завёл в объекте справочник видов — а он больше не нужен",
  );
  assert.equal(schemeObjectKeyOf(scene.project, scene.object), "fridge");
  assert.equal(schemeObjectNameOf(scene.project, scene.object), "Холодильник");
  assert.equal(schemeObjectMountOf(scene.project, scene.object), "floor");
  // Имя едет и на развёртку: вещь у стены подписана тем же словом, что на
  // чертеже.
  const wall = scene.project.walls[0];
  const standing = place(scene, "radiator", { atMm: { x: 2000, y: 120 } });
  const names = wallObjectsOn(standing.project, wall.id, "right").map((item) => item.name);
  assert.ok(names.includes("Радиатор"), "вещь каталога пришла на развёртку без имени: " + names.join(", "));
});

test("ключа вне каталога не бывает: отказ называет ключ, а объект не меняется", () => {
  const scene = room();
  assert.throws(
    () =>
      addSchemeObject(scene.project, {
        schemeId: scene.schemeId,
        catalogKey: "диван",
        atMm: { x: 0, y: 0 },
        widthMm: 100,
        depthMm: 100,
      }),
    /диван/,
  );
  const placed = place(scene, "table");
  assert.throws(() => updateSchemeObject(placed.project, placed.object.id, { catalogKey: "диван" }), /диван/);
  assert.equal(findSchemeObject(placed.project, placed.object.id).catalogKey, "table", "отказ сменил вещь");
});

test("вещь каталога и вид справочника — два взаимоисключающих ответа", () => {
  const legacy = legacyProject();
  const aquarium = legacy.schemeObjects[2];
  assert.equal(schemeObjectNameOf(legacy, aquarium), "Аквариум");
  // Выбрали плитку у прежней вещи — ключ встал, вид ушёл вместе со своим полем.
  const swapped = updateSchemeObject(legacy, aquarium.id, { catalogKey: "cabinet" }).schemeObject;
  assert.equal(swapped.catalogKey, "cabinet");
  assert.ok(!Object.prototype.hasOwnProperty.call(swapped, "kindId"), "у вещи осталось два ответа о том, что она такое");
  assert.equal(schemeObjectNameOf(legacy, swapped), "Шкаф");
  // Сам справочник при этом цел: им названы другие вещи того же чертежа.
  assert.equal(legacy.schemeObjectKinds.length, 4);
});

// ——— G68: объект прежней сборки ————————————————————————————————————————

test("G68: объект прежней сборки открывается как был — имена, размеры и места целы", () => {
  const project = legacyProject();
  const objects = schemeObjectsOnScheme(project, project.schemes[0].id);
  assert.equal(objects.length, 4);
  assert.deepEqual(
    objects.map((object) => schemeObjectNameOf(project, object)),
    ["Радиатор", "Лестница на 2 этаж", "Аквариум", "Столешница (кухонный фронт)"],
    "имена видов подменены каталожными — а человек называл их сам",
  );
  // Ключ выводится из имени и **нигде не записывается**: объект, который не
  // трогали, обязан остаться тем же текстом.
  assert.deepEqual(
    objects.map((object) => schemeObjectKeyOf(project, object)),
    ["radiator", "stairs", null, "counter"],
  );
  assert.equal(JSON.stringify(project), JSON.stringify(legacyProject()), "чтение изменило объект");
  // Вещь вне каталога остаётся вещью: своё имя, свой габарит, своё место.
  const aquarium = objects[2];
  assert.equal(aquarium.widthMm, 1500);
  assert.equal(aquarium.heightAboveFloorMm, 400);
  assert.equal(schemeObjectMountOf(project, aquarium), null, "месту установки взяться неоткуда — и выдумывать его нельзя");
  // Модель у неё не находится, и это честно: в объёме она рисуется габаритом,
  // как рисовалась до моделей.
  assert.equal(volumeObjectModel(project, aquarium), null);
  assert.equal(volumeObjectModel(project, objects[0]).key, "radiator");
});

test("G68: прежний чертёж с видом «Унитаз» в объёме не изменился — тело у него то же", () => {
  // Чертёж прежней сборки, на котором сантехнику заводили видами справочника:
  // кто-то назвал вид «Унитаз», кто-то — «Ванна». Таск 162 отдал корень
  // «унитаз» новой вещи каталога, и этот тест держит цену переезда на нуле.
  const project = legacyProject();
  const schemeId = project.schemes[0].id;
  const kinds = [
    { id: "kind-toilet", name: "Унитаз", order: 4 },
    { id: "kind-bath", name: "Ванна", order: 5 },
  ];
  project.schemeObjectKinds = [...project.schemeObjectKinds, ...kinds];
  const made = (id, kindId, widthMm, depthMm, heightMm) => ({
    id,
    schemeId,
    kindId,
    shape: "rect",
    atMm: { x: 500, y: 2800 },
    widthMm,
    depthMm,
    turnDeg: 0,
    heightMm,
    heightAboveFloorMm: 0,
  });
  const toilet = made("object-toilet", "kind-toilet", 700, 400, 400);
  const bath = made("object-bath", "kind-bath", 1700, 700, 600);
  project.schemeObjects = [...project.schemeObjects, toilet, bath];

  // Имя — своё, из справочника объекта: каталог его не подменяет.
  assert.equal(schemeObjectNameOf(project, toilet), "Унитаз");
  assert.equal(schemeObjectNameOf(project, bath), "Ванна");
  // Ключ сменился на точный — а **тело осталось тем же**: унитаз и общий вид
  // «Сантехника» описаны одним списком тел (`objectModels/objects.js`).
  assert.equal(schemeObjectKeyOf(project, toilet), "toilet");
  assert.deepEqual(volumeObjectModel(project, toilet).parts, objectModelByKey("plumbing").parts);
  // Габарит у вещи свой и записан в объекте: умолчания каталога его не трогают
  // ни при чтении, ни в объёме.
  assert.equal(toilet.widthMm, 700);
  assert.equal(toilet.depthMm, 400);
  // Ванна прежде модели не находила вовсе и рисовалась габаритом. Теперь мост
  // по имени её узнаёт — это **названная** правка: в объекте и на чертеже
  // ничего не меняется (вещь там рисуется габаритом и своим именем), меняется
  // только кадр объёма, где у неё появилось тело.
  assert.equal(schemeObjectKeyOf(project, bath), "bathtub");
  assert.equal(volumeObjectModel(project, bath).key, "bathtub");
  // Прежние вещи того же чертежа не поехали ни одной.
  assert.deepEqual(
    schemeObjectsOnScheme(project, schemeId)
      .filter((object) => object.id !== toilet.id && object.id !== bath.id)
      .map((object) => schemeObjectKeyOf(project, object)),
    ["radiator", "stairs", null, "counter"],
  );
});

// ——— G68: вещи, ушедшие в метки (таск 186) ——————————————————————————————

test("G68: чертёж с телевизором и полотенцесушителем-вещами открывается как был", () => {
  const project = retiredProject();
  const schemeId = project.schemes[0].id;
  const objects = schemeObjectsOnScheme(project, schemeId);
  assert.equal(objects.length, 4);
  const [tv, dryer, dryerKind, radiator] = objects;

  // Имя — на месте у обеих пород: у вещи с ключом его даёт надгробие, у вещи
  // прежней разметки — её собственный вид. Пустое имя здесь значило бы, что
  // человек открыл свой чертёж и не понял, что на нём стоит.
  assert.deepEqual(
    objects.map((object) => schemeObjectNameOf(project, object)),
    ["Телевизор", "Полотенцесушитель", "Полотенцесушитель", "Радиатор"],
  );
  // Ключ, место установки и тело в объёме — те же, что были вчера.
  assert.deepEqual(
    objects.map((object) => schemeObjectKeyOf(project, object)),
    ["tv", "towelDryer", "towelDryer", "radiator"],
  );
  assert.deepEqual(
    objects.map((object) => schemeObjectMountOf(project, object)),
    ["wall", "wall", "wall", "wall"],
  );
  assert.equal(volumeObjectModel(project, tv).key, "tv");
  assert.deepEqual(volumeObjectModel(project, tv).parts, objectModelByKey("tv").parts);
  assert.deepEqual(volumeObjectModel(project, dryer).parts, objectModelByKey("towelDryer").parts);
  assert.deepEqual(volumeObjectModel(project, dryerKind).parts, objectModelByKey("towelDryer").parts);
  assert.equal(volumeObjectModel(project, radiator).key, "radiator");
  // И картинка у ключа цела: плитка выделенной вещи рисуется ею же.
  assert.ok(objectViewByName("tv"), "у телевизора пропало изображение");
  assert.ok(objectViewByName("towelDryer"), "у полотенцесушителя пропало изображение");

  // Габарит и место не сдвинулись ни на миллиметр, и чтение не тронуло объект.
  assert.deepEqual(
    [tv.widthMm, tv.depthMm, tv.heightMm, tv.heightAboveFloorMm, tv.atMm],
    [1240, 80, 720, 850, { x: 1800, y: 140 }],
  );
  assert.deepEqual([dryer.widthMm, dryer.heightAboveFloorMm, dryer.turnDeg], [600, 950, 90]);
  assert.equal(JSON.stringify(project), JSON.stringify(retiredProject()), "чтение изменило объект");

  // Вещь на чертеже нарисована и подписана своим именем — она не пропала с
  // поля вместе с записью каталога.
  const bridge = drawingUnitBridge({ zoom: 0.5, offsetX: 0, offsetY: 0 });
  const log = [];
  drawDrawing(scribe(log), { project, schemeId, bridge });
  const painted = log.join("\n");
  assert.ok(painted.includes("Телевизор"), "телевизор пропал с чертежа");
  assert.ok(painted.includes("Полотенцесушитель"), "полотенцесушитель пропал с чертежа");
});

test("G68: файл с ушедшими вещами переживает круг «упаковали — распаковали» без новых полей", async () => {
  const project = retiredProject();
  const file = await packProject(project, new Map());
  const { project: loaded } = await unpackProject(file);
  assert.deepEqual(loaded.schemeObjects, project.schemeObjects, "у вещей чертежа появилось или пропало поле");
  assert.deepEqual(loaded.schemeObjectKinds, project.schemeObjectKinds, "справочник видов поехал");
});

test("ушедшую в метки вещь больше не поставить, а поставленную по-прежнему можно двигать", () => {
  // Поставить вещью то, что стало меткой, нельзя — и отказ называет ключ.
  const scene = room();
  assert.throws(
    () =>
      addSchemeObject(scene.project, {
        schemeId: scene.schemeId,
        catalogKey: "tv",
        atMm: { x: 2000, y: 1500 },
        widthMm: 1240,
        depthMm: 80,
      }),
    /tv/,
  );
  // А та, что уже стоит, правится как любая другая: ни переезд, ни правка
  // габарита не спотыкаются о пропавшую запись каталога.
  const project = retiredProject();
  const tvId = project.schemeObjects[0].id;
  const moved = updateSchemeObject(project, tvId, { atMm: { x: 2200, y: 140 }, widthMm: 1600 });
  assert.equal(moved.schemeObject.catalogKey, "tv", "вещь потеряла своё имя от переезда");
  assert.deepEqual(moved.schemeObject.atMm, { x: 2200, y: 140 });
  assert.equal(moved.schemeObject.widthMm, 1600);
  assert.equal(schemeObjectNameOf(moved.project, moved.schemeObject), "Телевизор");
});

test("G68: лестница прежнего объекта узнаётся по имени — объём по-прежнему переводит по этажам", () => {
  const project = legacyProject();
  const schemeId = project.schemes[0].id;
  const stairs = volumeStairs(project, schemeId);
  assert.equal(stairs.length, 1, "лестница прежнего объекта потерялась");
  assert.equal(stairs[0].objectId, project.schemeObjects[1].id);
  // И у вещи каталога она находится по ключу, как бы её ни звали.
  const keyed = place(room(), "stairs");
  assert.equal(volumeStairs(keyed.project, keyed.schemeId).length, 1);
});

test("G68: файл прежней сборки переживает круг «упаковали — распаковали» без новых полей у вещей", async () => {
  const project = legacyProject();
  const file = await packProject(project, new Map());
  const { project: loaded } = await unpackProject(file);
  assert.equal(loaded.formatVersion, 5, "файл сохраняется нынешней версией формата");
  assert.deepEqual(loaded.schemeObjectKinds, project.schemeObjectKinds, "справочник видов поехал");
  assert.deepEqual(loaded.schemeObjects, project.schemeObjects, "у вещей чертежа появилось или пропало поле");
  assert.deepEqual(loaded.walls, project.walls);
});

// ——— скрытие: только экран ————————————————————————————————————————————

test("спрятанная вещь не рисуется, а выгрузка о ней не знает", () => {
  const scene = place(room(), "fridge");
  // Масштаб покрупнее: имя вещи ставится только когда оно читается на экране
  // (`DRAWING_CAPTION_MIN_PX`), и на общем виде квартиры его нет вовсе.
  const bridge = drawingUnitBridge({ zoom: 0.5, offsetX: 0, offsetY: 0 });
  const shown = [];
  drawDrawing(scribe(shown), { project: scene.project, schemeId: scene.schemeId, bridge });
  const hidden = [];
  drawDrawing(scribe(hidden), {
    project: scene.project,
    schemeId: scene.schemeId,
    bridge,
    hiddenObjectIds: [scene.object.id],
  });
  const name = (log) => log.filter((line) => line.includes("Холодильник"));
  assert.ok(name(shown).length > 0, "вещь не нарисовалась вовсе — пример не тот");
  assert.deepEqual(name(hidden), [], "спрятанная вещь всё равно на чертеже");
  assert.ok(hidden.length > 10, "вместе с вещью пропал и весь чертёж");
  // Выгрузка зовёт тот же `drawDrawing` без списка — и получает вещь обратно:
  // «на экране, а для выгрузок у нас же свои параметры видимости».
  const sheet = [];
  drawDrawing(scribe(sheet), { project: scene.project, schemeId: scene.schemeId, bridge });
  assert.ok(name(sheet).length > 0, "скрытие уехало в выгрузку");
  // «Скрыть все» — тот же путь, только разом.
  const none = [];
  drawDrawing(scribe(none), { project: scene.project, schemeId: scene.schemeId, bridge, objects: false });
  assert.deepEqual(name(none), []);
});

test("спрятанную вещь не взять кликом в поле", () => {
  const scene = place(room(), "fridge");
  const at = { x: 2000, y: 1500 };
  const view = { zoom: 0.1, offsetX: 0, offsetY: 0 };
  assert.equal(workshopPick(scene.project, scene.schemeId, at, view, null).kind, "object");
  const pick = workshopPick(scene.project, scene.schemeId, at, view, null, [scene.object.id]);
  assert.ok(!pick || pick.kind !== "object", "взяли за угол то, чего на поле не видно");
});

test("спрятанной вещи нет в объёме — ни гранью, ни занятым местом, ни лестницей", () => {
  const scene = place(room(), "stairs", { atMm: { x: 3000, y: 1500 } });
  const whole = volumeScene(scene.project, scene.schemeId, {});
  const without = volumeScene(scene.project, scene.schemeId, { hiddenObjectIds: [scene.object.id] });
  assert.equal(whole.stairs.length, 1);
  assert.deepEqual(without.stairs, [], "спрятанная лестница всё равно спрашивает про этаж");
  assert.ok(without.faces.length < whole.faces.length, "грани спрятанной вещи остались в сцене");
  assert.ok(without.objectBoxes.length < whole.objectBoxes.length, "место спрятанной вещи всё ещё занято");
  // Вещь вернули — вернулась и сцена: отметка нигде не записана.
  const back = volumeScene(scene.project, scene.schemeId, { hiddenObjectIds: [] });
  assert.equal(back.faces.length, whole.faces.length);
});

test("сквозь колонну и лестницу проходят (G264), а сквозь стену — нет", () => {
  // Колонна 400 × 400 во всю высоту посреди комнаты 4 × 3 м: самая «несущая»
  // вещь каталога. Исключением она не стала — список исключений завёл бы
  // второго хозяина правила.
  const scene = place(room(), "column", { atMm: { x: 2000, y: 1500 } });
  const built = volumeScene(scene.project, scene.schemeId, {});
  assert.equal(built.solids.length, 4, "препятствий ровно четыре — это стены комнаты");
  assert.equal(built.objectBoxes.length, 1, "а место колонны занято");
  let at = { x: 2000, y: 200 };
  for (let step = 0; step < 40; step += 1) at = volumeStep(built, at, 0, 100);
  assert.ok(at.y > 2000, "сквозь колонну не прошли: y = " + Math.round(at.y));
  assert.ok(at.y < 3000 - VOLUME_BODY_MM + 1, "и вышли сквозь стену: y = " + Math.round(at.y));

  // Лестница: сквозь неё тоже проходят, а переход по этажам спрашивается по
  // расстоянию до габарита и работает даже стоя внутри марша.
  const steps = place(room(), "stairs", { atMm: { x: 2000, y: 1500 } });
  const withStairs = volumeScene(steps.project, steps.schemeId, {});
  assert.equal(withStairs.solids.length, 4, "лестница стала препятствием");
  let on = { x: 2000, y: 200 };
  for (let step = 0; step < 40; step += 1) on = volumeStep(withStairs, on, 0, 100);
  assert.ok(on.y > 2000, "сквозь лестницу не прошли: y = " + Math.round(on.y));
  assert.ok(volumeStairNear(withStairs.stairs, { x: 2000, y: 1500 }), "стоя на лестнице про этаж не спросили");
});

test("удалённая вещь уносит и свою отметку скрытия — её id больше ничей", () => {
  // Отметка живёт в настройках браузера и чистится о живые вещи объекта
  // (`setObjectHidden`), но и модель обязана отвечать честно: вещи нет —
  // спрашивать о ней нечего.
  const scene = place(room(), "table");
  const gone = deleteSchemeObject(scene.project, scene.object.id).project;
  assert.equal(findSchemeObject(gone, scene.object.id), null);
  assert.deepEqual(schemeObjectsOnScheme(gone, scene.schemeId), []);
});
