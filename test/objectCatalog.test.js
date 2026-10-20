// Встроенный каталог вещей чертежа (таск 154, требования G220, G223–G225).
//
// Что здесь держится:
//
//   1. **Состав каталога.** Двадцать две вещи в шести категориях, у каждой имя
//      в словаре, положительный габарит и известное место установки. Вещь,
//      забытая в словаре, вышла бы в колонку своим ключом по-английски.
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
} from "../src/objectCatalog.js";
import {
  SCHEME_OBJECT_SHAPES,
  addScheme,
  addSchemeObject,
  createProject,
  deleteSchemeObject,
  findSchemeObject,
  schemeObjectKeyOf,
  schemeObjectMountOf,
  schemeObjectNameOf,
  schemeObjectsOnScheme,
  updateSchemeObject,
  wallObjectsOn,
  addWall,
} from "../src/model.js";
import { drawDrawing, drawingUnitBridge } from "../src/render.js";
import { workshopObjectDefaultsByKey, workshopObjectDefaultsByName, workshopPick } from "../src/panels/workshop.js";
import {
  VOLUME_BODY_MM,
  volumeObjectModel,
  volumeScene,
  volumeStairNear,
  volumeStairs,
  volumeStep,
} from "../src/volume.js";
import { objectModelByKey } from "../src/objectModels/registry.js";
import { packProject, unpackProject } from "../src/projectFile.js";
import { strings } from "../src/strings.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const LEGACY_TEXT = readFileSync(join(HERE, "legacy-drawing-project.json"), "utf8");
const legacyProject = () => JSON.parse(LEGACY_TEXT);

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

test("в каталоге тридцать вещей, и каждая стоит ровно в одной категории", () => {
  const keys = objectCatalogKeys();
  assert.equal(keys.length, 30, "вещей в каталоге стало другое число: " + keys.length);
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
    "towelDryer",
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
  // И шесть вещей таска 177 (G262): «В технику добавь телевизор. А так же в
  // мебель диван, кресло, журнальный стол, компьютерные стол и кресло (один
  // объект), табуретки». Компьютерный стол с креслом — одна вещь, а не две.
  for (const key of ["tv", "sofa", "armchair", "coffeeTable", "deskSet", "stool"]) {
    assert.ok(objectCatalogEntry(key), "вещь таска 177 пропала: " + key);
  }
  assert.equal(objectCatalogEntry("tv").category, "appliances", "телевизор ушёл не в технику");
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

test("имя прежнего вида переводится в ключ терпимо, и столешница не становится столом", () => {
  assert.equal(objectCatalogKeyByName("Шкаф"), "cabinet");
  assert.equal(objectCatalogKeyByName("  ШКАФ в прихожей "), "cabinet");
  assert.equal(objectCatalogKeyByName("Лестница на 2 этаж"), "stairs");
  assert.equal(objectCatalogKeyByName("stairs"), "stairs");
  assert.equal(objectCatalogKeyByName("Столешница (кухонный фронт)"), "counter");
  assert.equal(objectCatalogKeyByName("Стол"), "table");
  assert.equal(objectCatalogKeyByName("Полотенцесушитель"), "towelDryer");
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
  assert.equal(objectCatalogKeyByName("Телевизор"), "tv");
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
