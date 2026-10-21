// Каталог видов проёма (таск 215, требования G321 и G325).
//
// Слова заказчика: «выбор проёмов сделай как и у объектов. Перечень будет
// такой: Двери (распашные, двустворчатые, сдвижные, у всех этих вариантов ещё и
// опция — стеклянные)… Окна (одинарные, двойные, тройные)… балконные для
// полного остекления… Арка. Проём. Гаражные ворота распашные, сдвижные,
// роллеты, Подъемно-секционные ворота»; и следом, про предложения: «давай
// добавим что предложил».
//
// Что проверяется здесь:
//
//   1. **Перечень заказчика на месте целиком** — и назван по ключам, а не
//      посчитан: пропавший вид обязан красить прогон, а не теряться в числе.
//   2. **Каталог самодостаточен.** У вещи чертежа ключ живёт в трёх реестрах
//      (каталог, изображение, модель); у проёма реестр **один** — этот каталог,
//      а изображение ему заменяет лицо, которое считается из той же записи.
//      Проверяется прямо: ни один вид проёма не ищет себя в реестре изображений
//      объектов.
//   3. **Отметка «стеклянная» — отметка, а не вид.** Пишется ключом `glazed` у
//      породы, читается двумя путями (G68: прежний вид `glassDoor` остеклён
//      сам), снимается удалением ключа.
//   4. **Числа умолчаний** — названы и обоснованы: прежние пять не сдвинулись
//      ни на миллиметр, ворота стоят в посадке, которую назвал заказчик, всё
//      влезает под потолок 2700.
//   5. **Сетка секций** — та, о которой он говорил: двойное делится пополам,
//      тройное на три, у балконного нижняя полоса до пояса, у роллетных полос
//      столько, сколько ламелей.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  OPENING_BELT_MM,
  OPENING_CATEGORIES,
  OPENING_FAMILIES,
  OPENING_MOTIONS,
  OPENING_SLAT_MM,
  openingCatalogCategory,
  openingCatalogDefaults,
  openingCatalogEntry,
  openingCatalogInOrder,
  openingCatalogKinds,
  openingCatalogName,
} from "../src/openingCatalog.js";
import {
  OPENING_DOOR_KINDS,
  OPENING_DOOR_STATES,
  OPENING_KINDS,
  OPENING_KIND_DEFAULT,
  OPENING_KIND_GLASS_DOOR,
  addOpening,
  addScheme,
  addWall,
  createProject,
  openingArchDropMm,
  openingArchGeometry,
  openingCanGlaze,
  openingDoorStates,
  openingDoorStep,
  openingFaceGrid,
  openingFamilyOf,
  openingGlazed,
  openingHasLeaf,
  openingKindBase,
  openingLeavesOf,
  openingMotionOf,
  openingTitle,
  openingWalkThrough,
  updateOpening,
} from "../src/model.js";
import { openingPickerGroups } from "../src/panels/openingPicker.js";
import { strings } from "../src/strings.js";

// Перечень заказчика — **словами тикета**, по разделам. Это и есть приёмка:
// снятый вид красит прогон здесь, а не в живом прогоне через три таска.
const ASKED = {
  doors: ["door", "doorDouble", "doorSliding", "doorFolding", "doorPocket", "glassDoor"],
  windows: ["window", "windowDouble", "windowTriple", "windowBalcony", "windowGlazing"],
  plain: ["opening", "arch"],
  gates: ["gateSwing", "gateSliding", "gateRoller", "gateSectional"],
};

function wall() {
  const added = addScheme(createProject(), { name: "1", imageId: "p", width: 1200, height: 800 });
  const put = addWall(added.project, {
    schemeId: added.scheme.id,
    aMm: { x: 0, y: 0 },
    bMm: { x: 9000, y: 0 },
    thicknessMm: 200,
  });
  return { project: put.project, wallId: put.wall.id };
}

const errorCode = (run) => {
  try {
    run();
    return null;
  } catch (error) {
    return error && error.code ? error.code : String(error);
  }
};

// ——— перечень ——————————————————————————————————————————————————————————

test("весь перечень заказчика стоит в каталоге, и каждый вид в своём разделе", () => {
  assert.deepEqual(OPENING_CATEGORIES, Object.keys(ASKED), "разделы каталога — разделы разговора");
  for (const [category, kinds] of Object.entries(ASKED)) {
    assert.deepEqual(
      openingCatalogCategory(category).map((entry) => entry.kind),
      kinds,
      "раздел " + category,
    );
  }
  // Порядок каталога — порядок разделов, и список видов модели — он же.
  assert.deepEqual(
    openingCatalogInOrder().map((entry) => entry.kind),
    Object.values(ASKED).flat(),
  );
  assert.deepEqual(OPENING_KINDS, openingCatalogKinds());
  // Пять прежних видов зовутся прежними ключами: ключ — это значение в
  // `project.json`, и переименовать его нельзя никогда (G68).
  for (const kind of ["window", "door", "glassDoor", "opening", "arch"]) {
    assert.ok(OPENING_KINDS.includes(kind), kind);
  }
  // Вид нового проёма по умолчанию — окно, как было всегда. Назван прямо, а не
  // взят первым в списке: пополнение каталога иначе переставило бы кнопку.
  assert.equal(OPENING_KIND_DEFAULT, "window");
  assert.ok(OPENING_KINDS.includes(OPENING_KIND_DEFAULT));
});

test("у каждого вида есть русское имя в словаре, и оно не ключ", () => {
  for (const kind of OPENING_KINDS) {
    const name = openingCatalogName(kind);
    assert.equal(typeof strings.openingKinds[kind], "string", "нет строки для " + kind);
    assert.ok(name.length > 2, kind + ": " + name);
    assert.notEqual(name, kind, kind + " вышел бы в окно по-английски");
    assert.ok(/[А-Яа-яЁё]/.test(name), kind + ": имя не по-русски — " + name);
  }
  for (const category of OPENING_CATEGORIES) {
    assert.equal(typeof strings.openingCategories[category], "string", "нет имени раздела " + category);
  }
  for (const motion of OPENING_MOTIONS) {
    assert.equal(typeof strings.openingMotions[motion], "string", "нет имени движения " + motion);
  }
  assert.equal(openingCatalogName("люк"), "", "чужой ключ — пустое имя, а не выдумка");
  assert.equal(openingCatalogEntry("люк"), null);
});

test("каталог проёмов — один реестр, а не три: изображения у вида проёма нет", () => {
  // У вещи чертежа ключ живёт в трёх реестрах, и один из них — реестр
  // изображений. У проёма такого реестра нет: он рисуется геометрией в стене, а
  // плитку выбора ему рисует его же лицо (`render.drawOpeningFace`). Проверяется
  // это по исходникам: заведись у проёмов второй реестр картинок — и плитка
  // разошлась бы с развёрткой молча.
  const picker = readFileSync(new URL("../src/panels/openingPicker.js", import.meta.url), "utf8");
  const catalog = readFileSync(new URL("../src/openingCatalog.js", import.meta.url), "utf8");
  // Ищется **ввоз** реестра, а не слово: про `objectViews` в этих файлах
  // написано в объяснении, зачем их у проёма нет.
  const imports = (source) => (source.match(/from "[^"]*objectViews[^"]*"/g) || []).length;
  assert.equal(imports(picker), 0, "плитка проёма полезла в реестр изображений вещей");
  assert.equal(imports(catalog), 0, "каталог проёмов полез в реестр изображений вещей");
  assert.match(picker, /drawOpeningFace\(/, "плитку проёма рисует лицо проёма, а не своя картинка");
  for (const kind of OPENING_KINDS) {
    const entry = openingCatalogEntry(kind);
    // Запись самодостаточна: по ней рисуются все три поверхности.
    assert.ok(OPENING_FAMILIES.includes(entry.family), kind + ": порода " + entry.family);
    assert.ok(entry.motion === null || OPENING_MOTIONS.includes(entry.motion), kind + ": движение");
    assert.ok([0, 1, 2].includes(entry.leaves), kind + ": створок " + entry.leaves);
    assert.ok(entry.face && entry.face.cols >= 1, kind + ": у вида нет лица");
  }
});

// ——— вид прежней разметки спрятан, но жив ————————————————————————————————

test("стеклянная дверь прежней разметки в плитках не стоит, а выделенная — стоит", () => {
  const entry = openingCatalogEntry(OPENING_KIND_GLASS_DOOR);
  assert.equal(entry.legacy, true);
  assert.equal(entry.glazed, true);
  assert.equal(openingKindBase(OPENING_KIND_GLASS_DOOR), "door", "горит плитка распашной двери");
  const kinds = (query, chosen) =>
    openingPickerGroups(query, { kind: chosen }).flatMap((group) => group.entries.map((entry) => entry.kind));
  assert.equal(kinds("", null).includes(OPENING_KIND_GLASS_DOOR), false, "в плитках её нет");
  assert.ok(kinds("", OPENING_KIND_GLASS_DOOR).includes(OPENING_KIND_GLASS_DOOR), "а у выделенной — есть");
  // Остальные виды в плитках все до одного: спрятан ровно один.
  assert.equal(kinds("", null).length, OPENING_KINDS.length - 1);
  // Поиск ищет по имени вида и по имени раздела.
  assert.deepEqual(kinds("ролл", null), ["gateRoller"]);
  assert.deepEqual(kinds("ворота", null), ASKED.gates);
  assert.deepEqual(kinds("витраж", null), ["windowGlazing"]);
  assert.deepEqual(kinds("нет такого", null), []);
  // У записи плитки есть `key` — по нему ходят общие стрелки сетки.
  for (const group of openingPickerGroups("", {})) {
    for (const entry of group.entries) assert.equal(entry.key, entry.kind);
  }
});

// ——— отметка «стеклянная» ————————————————————————————————————————————————

test("стеклянной бывает любая дверь, и это отметка, а не вид каталога", () => {
  for (const kind of OPENING_KINDS) {
    assert.equal(openingCanGlaze(kind), openingFamilyOf(kind) === "door", kind);
  }
  // Ни одного парного вида «такая же, но стеклянная» в каталоге нет: мнение
  // заказчика было то же — «иначе плиток вдвое больше, а разница в одном».
  const glazedKinds = OPENING_KINDS.filter((kind) => openingCatalogEntry(kind).glazed);
  assert.deepEqual(glazedKinds, [OPENING_KIND_GLASS_DOOR], "остеклён породой только прежний вид");
});

test("отметка пишется ключом, читается двумя путями и снимается удалением ключа", () => {
  const box = wall();
  const glassy = addOpening(box.project, {
    wallId: box.wallId,
    kind: "doorSliding",
    atMm: 100,
    widthMm: 900,
    heightMm: 2100,
    glazed: true,
  });
  assert.equal(glassy.opening.glazed, true);
  assert.equal(openingGlazed(glassy.opening), true);
  // Снятая отметка **удаляет ключ**, а не кладёт `false`: пустое значение
  // удаляет ключ — то же правило, что у `floor` схемы и `site` объекта.
  const plain = updateOpening(glassy.project, glassy.opening.id, { glazed: false });
  assert.equal(Object.prototype.hasOwnProperty.call(plain.opening, "glazed"), false);
  assert.equal(openingGlazed(plain.opening), false);
  // Правка размера отметку не теряет.
  const wider = updateOpening(glassy.project, glassy.opening.id, { widthMm: 1000 });
  assert.equal(wider.opening.glazed, true);
  // Вид прежней разметки остеклён сам, и ключа у него не появляется ни от
  // чего — даже от прямой просьбы: двух написаний одного и того же быть не
  // должно.
  const legacy = addOpening(box.project, {
    wallId: box.wallId,
    kind: OPENING_KIND_GLASS_DOOR,
    atMm: 2000,
    widthMm: 800,
    heightMm: 2200,
    glazed: true,
  });
  assert.equal(Object.prototype.hasOwnProperty.call(legacy.opening, "glazed"), false);
  assert.equal(openingGlazed(legacy.opening), true);
  // Стала распашной — стекло ушло вместе с видом; попросили стекло — вернулось
  // отметкой.
  const unglazed = updateOpening(legacy.project, legacy.opening.id, { kind: "door" });
  assert.equal(openingGlazed(unglazed.opening), false);
  const again = updateOpening(legacy.project, legacy.opening.id, { kind: "door", glazed: true });
  assert.equal(again.opening.glazed, true);
  assert.equal(again.opening.kind, "door", "новая разметка пишет породу плюс отметку");
});

test("у окна и арки стеклить нечего — отметку не принимают вслух", () => {
  const box = wall();
  for (const kind of ["window", "windowBalcony", "arch", "opening", "gateRoller"]) {
    assert.equal(
      errorCode(() =>
        addOpening(box.project, { wallId: box.wallId, kind, atMm: 0, widthMm: 900, heightMm: 1400, glazed: true }),
      ),
      "openingGlazedOnlyDoor",
      kind,
    );
  }
});

test("отметка у вида, который стеклянным не бывает, не значит ничего", () => {
  // В объект такая отметка не попадает — модель её не пустит, — но в настройках
  // окна «Что добавить» она переживает смену вида: поставил отметку у двери,
  // потом выбрал балконное окно. Строка «что поставит следующий клик» обещала
  // «Балконное окно, стеклянная» (поймано живым прогоном).
  assert.equal(openingGlazed({ kind: "windowBalcony", glazed: true }), false);
  assert.equal(openingTitle({ kind: "windowBalcony", glazed: true }), "Балконное окно");
  assert.equal(openingGlazed({ kind: "doorSliding", glazed: true }), true);
});

test("подпись проёма — имя вида и приписка отметки, одним местом", () => {
  assert.equal(openingTitle({ kind: "door" }), "Распашная дверь");
  assert.equal(openingTitle({ kind: "door", glazed: true }), "Распашная дверь, стеклянная");
  assert.equal(openingTitle({ kind: "doorSliding", glazed: true }), "Сдвижная дверь, стеклянная");
  // «Стеклянная дверь, стеклянная» — описка, а не подпись.
  assert.equal(openingTitle({ kind: OPENING_KIND_GLASS_DOOR }), "Стеклянная дверь");
  assert.equal(openingTitle({ kind: "windowBalcony" }), "Балконное окно");
  assert.equal(openingTitle({ kind: "gateSectional" }), "Подъёмно-секционные ворота");
  assert.equal(openingTitle(null), "");
});

// ——— створки, движение, кольцо ———————————————————————————————————————————

test("створка со стороной есть у дверей и распашных ворот, а у поднимающихся нет", () => {
  const leafy = OPENING_KINDS.filter((kind) => openingHasLeaf(kind));
  assert.deepEqual(leafy, OPENING_DOOR_KINDS);
  assert.deepEqual(leafy, [
    "door",
    "doorDouble",
    "doorSliding",
    "doorFolding",
    "doorPocket",
    "glassDoor",
    "gateSwing",
    "gateSliding",
  ]);
  // Роллетные и секционные полотно в сторону не уводят: ни петель, ни стороны
  // стены у него нет — оно уходит вверх.
  for (const kind of ["gateRoller", "gateSectional"]) {
    assert.equal(openingMotionOf(kind), "lift", kind);
    assert.equal(openingHasLeaf(kind), false, kind);
    assert.equal(openingLeavesOf(kind), 1, kind + ": полотно есть, стороны нет");
  }
  // У окна, проёма и арки полотна нет вовсе.
  for (const kind of [...ASKED.windows, ...ASKED.plain]) {
    assert.equal(openingMotionOf(kind), null, kind);
    assert.equal(openingLeavesOf(kind), 0, kind);
  }
  assert.equal(openingLeavesOf("doorDouble"), 2);
  assert.equal(openingLeavesOf("gateSwing"), 2);
});

test("кольцо Q/E — по виду: четыре положения у одностворчатой, два у двупольной", () => {
  assert.deepEqual(openingDoorStates("door"), OPENING_DOOR_STATES);
  assert.equal(openingDoorStates("doorSliding").length, 4, "сдвижная: сторона стены и сторона отъезда");
  for (const kind of ["doorDouble", "gateSwing"]) {
    const ring = openingDoorStates(kind);
    assert.equal(ring.length, 2, kind + ": петли у обоих косяков, переставлять нечего");
    assert.deepEqual(
      ring.map((state) => state.swing),
      ["left", "right"],
      kind,
    );
    // Шаг по кольцу из двух **меняет картинку** на каждом нажатии: щёлкать
    // впустую человек не должен.
    const first = openingDoorStep(ring[0], 1, kind);
    assert.notEqual(first.swing, ring[0].swing);
    assert.deepEqual(openingDoorStep(first, 1, kind), { ...ring[0] });
    // Дверь с петлями «у конца», которой сменили вид на двупольную, с кольца не
    // падает: шаг ведёт к соседнему положению, а не к первому.
    const odd = openingDoorStep({ hinge: "end", swing: "right" }, 1, kind);
    assert.equal(odd.swing, "left");
  }
  // Без вида кольцо прежнее, из четырёх: так его зовут таск 180 и его тесты.
  assert.equal(openingDoorStep({ hinge: "start", swing: "left" }, 1).hinge, "end");
});

// ——— числа ————————————————————————————————————————————————————————————————

test("умолчания прежних пяти видов не сдвинулись ни на миллиметр", () => {
  assert.deepEqual(openingCatalogDefaults("window"), { widthMm: 1500, heightMm: 1400, heightAboveFloorMm: 800 });
  assert.deepEqual(openingCatalogDefaults("door"), { widthMm: 900, heightMm: 2100, heightAboveFloorMm: 0 });
  assert.deepEqual(openingCatalogDefaults("glassDoor"), { widthMm: 800, heightMm: 2200, heightAboveFloorMm: 0 });
  assert.deepEqual(openingCatalogDefaults("opening"), { widthMm: 900, heightMm: 2100, heightAboveFloorMm: 0 });
  assert.deepEqual(openingCatalogDefaults("arch"), { widthMm: 1200, heightMm: 2100, heightAboveFloorMm: 0 });
  assert.equal(openingCatalogDefaults("люк"), null);
});

test("умолчания новых видов — то, что ставят, и всё влезает под потолок 2700", () => {
  for (const kind of OPENING_KINDS) {
    const sizes = openingCatalogDefaults(kind);
    assert.ok(sizes.widthMm > 0 && sizes.heightMm > 0 && sizes.heightAboveFloorMm >= 0, kind);
    assert.ok(sizes.heightAboveFloorMm + sizes.heightMm <= 2700, kind + " не влезает под потолок 2700");
  }
  // Двери: тот же проём, что у распашной, — меняется привод, а не дырка.
  for (const kind of ["doorSliding", "doorFolding", "doorPocket"]) {
    assert.deepEqual(openingCatalogDefaults(kind), openingCatalogDefaults("door"), kind);
  }
  // Двупольная шире одностворчатой: две створки по 600 плюс коробка.
  assert.equal(openingCatalogDefaults("doorDouble").widthMm, 1400);
  // Окна: двойное делит тот же проём, тройное шире — три стеклопакета по 700.
  assert.equal(openingCatalogDefaults("windowDouble").widthMm, openingCatalogDefaults("window").widthMm);
  assert.equal(openingCatalogDefaults("windowTriple").widthMm, 2100);
  // Балконное и витраж стоят от пола: это полное остекление, а не окно с
  // подоконником.
  for (const kind of ["windowBalcony", "windowGlazing"]) {
    assert.equal(openingCatalogDefaults(kind).heightAboveFloorMm, 0, kind);
    assert.ok(openingCatalogDefaults(kind).heightMm >= 2500, kind);
  }
  // Ворота — посадка, которую назвал заказчик: 2500…3000 × 2100…2500.
  for (const kind of ASKED.gates) {
    const sizes = openingCatalogDefaults(kind);
    assert.ok(sizes.widthMm >= 2500 && sizes.widthMm <= 3000, kind + ": ширина " + sizes.widthMm);
    assert.ok(sizes.heightMm >= 2100 && sizes.heightMm <= 2500, kind + ": высота " + sizes.heightMm);
    assert.equal(sizes.heightAboveFloorMm, 0, kind + " стоит на полу");
  }
});

// ——— сетка секций ————————————————————————————————————————————————————————

test("окна делятся на секции, а у балконного нижняя полоса — до пояса", () => {
  const grid = (kind) => openingFaceGrid({ kind, heightMm: openingCatalogDefaults(kind).heightMm });
  assert.deepEqual(grid("window"), { xs: [], ys: [] }, "одинарное не делится — кадр прежнего окна тот же");
  assert.deepEqual(grid("windowDouble"), { xs: [0.5], ys: [] });
  assert.deepEqual(grid("windowTriple").xs.map((part) => Math.round(part * 1000) / 1000), [0.333, 0.667]);
  assert.deepEqual(grid("windowGlazing"), { xs: [], ys: [] }, "витраж — одна большая секция без деления");
  // «Снизу 3 секции до пояса +-, и выше 3 секции большие по высоте»: три
  // столбца, две полосы, и нижняя ровно до пояса.
  const balcony = grid("windowBalcony");
  assert.equal(balcony.xs.length, 2, "три секции по ширине");
  assert.equal(balcony.ys.length, 1, "две полосы по высоте");
  const height = openingCatalogDefaults("windowBalcony").heightMm;
  assert.equal(Math.round(balcony.ys[0] * height), OPENING_BELT_MM);
  // Полосы не равны: верхняя выше нижней — «выше секции большие по высоте».
  assert.ok(balcony.ys[0] < 0.5, "пояс ниже половины: " + balcony.ys[0]);
});

test("у ворот полотно делится панелями, а у роллетных — ламелями по шагу", () => {
  const height = openingCatalogDefaults("gateSectional").heightMm;
  const sectional = openingFaceGrid({ kind: "gateSectional", heightMm: height });
  assert.deepEqual(sectional.xs, []);
  assert.equal(sectional.ys.length, 3, "четыре панели — три стыка");
  assert.ok(Math.abs(height / 4 - 562.5) < 1, "панель 560 мм — то, что ставят");
  const roller = openingFaceGrid({ kind: "gateRoller", heightMm: height });
  assert.equal(roller.ys.length, Math.round(height / OPENING_SLAT_MM) - 1, "ламелей столько, сколько влезло");
  assert.ok(roller.ys.length > 10, "роллета — полоса ламелей, а не четыре панели: " + roller.ys.length);
  // Распашные ворота — две створки, и стык у них посередине.
  assert.deepEqual(openingFaceGrid({ kind: "gateSwing", heightMm: 2250 }).xs, [0.5]);
  // Гармошка сложена в четыре звена — то же число, по которому она и рисуется.
  assert.equal(openingFaceGrid({ kind: "doorFolding", heightMm: 2100 }).xs.length, 3);
  // Чужой вид лица не выдумывает.
  assert.deepEqual(openingFaceGrid({ kind: "люк", heightMm: 800 }), { xs: [], ys: [] });
});

// ——— дуга арки (таск 219, G329) ——————————————————————————————————————————

test("G329: у арки дуга, и только у неё", () => {
  for (const kind of OPENING_KINDS) {
    const sizes = openingCatalogDefaults(kind);
    const arch = openingArchGeometry({ kind, ...sizes });
    assert.equal(Boolean(arch), kind === "arch", kind + ": дуга взялась не у арки");
  }
  // Умолчание каталога — 1200 × 2100: дуга полуциркульная, радиус в половину
  // ширины, пята на 1500 от пола.
  const usual = { kind: "arch", widthMm: 1200, heightMm: 2100 };
  assert.deepEqual(openingArchGeometry(usual), { riseMm: 600, radiusMm: 600 });
  assert.equal(openingArchDropMm(usual, 0.5), 0, "в середине дуга касается верха проёма");
  assert.equal(openingArchDropMm(usual, 0), 600, "у косяка дуга опускается на подъём");
  assert.equal(openingArchDropMm(usual, 1), 600);
  // На четверти ширины полуокружность опускается на R − √(R² − (R/2)²).
  assert.ok(Math.abs(openingArchDropMm(usual, 0.25) - (600 - Math.sqrt(600 * 600 - 300 * 300))) < 1e-9);
  // Дуга симметрична: слева и справа одно и то же.
  for (const part of [0.1, 0.3, 0.45]) {
    assert.ok(Math.abs(openingArchDropMm(usual, part) - openingArchDropMm(usual, 1 - part)) < 1e-9, String(part));
  }
});

test("G329: проём ниже своей полуширины получает сегментную дугу, а не обрезанную", () => {
  // 3000 × 1400: полуциркульной нужно 1500 подъёма, а всего высоты 1400 —
  // пята ушла бы ниже пола. Подъём зажат половиной высоты: 700 на дугу и 700
  // на прямые откосы.
  const low = { kind: "arch", widthMm: 3000, heightMm: 1400 };
  const arch = openingArchGeometry(low);
  assert.equal(arch.riseMm, 700);
  assert.ok(arch.radiusMm > 1500, "сегментная дуга положе полуциркульной: " + arch.radiusMm);
  // Та же окружность: на косяке дуга опускается ровно на подъём.
  assert.ok(Math.abs(openingArchDropMm(low, 0) - 700) < 1e-9);
  assert.ok(Math.abs(openingArchDropMm(low, 0.5)) < 1e-9);
  // Пята никогда не уходит ниже середины проёма — ни на каком отношении сторон.
  for (const [width, height] of [[900, 2100], [1200, 2100], [2500, 2250], [3000, 1400], [4000, 800], [600, 3000]]) {
    const some = { kind: "arch", widthMm: width, heightMm: height };
    const geometry = openingArchGeometry(some);
    assert.ok(geometry.riseMm <= height / 2 + 1e-9, width + "×" + height + ": подъём съел больше половины высоты");
    assert.ok(geometry.riseMm <= width / 2 + 1e-9, width + "×" + height + ": дуга выше полуциркульной");
    assert.ok(geometry.riseMm > 0);
    // Радиус той же окружности: на косяке она опускается ровно на подъём.
    assert.ok(Math.abs(openingArchDropMm(some, 0) - geometry.riseMm) < 1e-6, width + "×" + height);
  }
  // Вырожденный проём дуги не получает вовсе — и не падает.
  assert.equal(openingArchGeometry({ kind: "arch", widthMm: 0, heightMm: 2100 }), null);
  assert.equal(openingArchGeometry({ kind: "arch", widthMm: 1200, heightMm: 0 }), null);
  assert.equal(openingArchDropMm({ kind: "opening", widthMm: 900, heightMm: 2100 }, 0.3), 0);
});

// ——— сквозь что ходят ————————————————————————————————————————————————————

test("сквозь окно любого вида не ходят, сквозь дверь, проём и ворота — ходят", () => {
  for (const kind of ASKED.windows) assert.equal(openingWalkThrough(kind), false, kind);
  for (const kind of [...ASKED.doors, ...ASKED.plain, ...ASKED.gates]) {
    assert.equal(openingWalkThrough(kind), true, kind);
  }
  // Вид из чужого файла проходимостью не теряет: так отвечал и прежний счёт.
  assert.equal(openingWalkThrough("люк"), true);
});
