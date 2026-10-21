// Этаж схемы в её свойствах (таск 170, требование G254).
//
// Слова заказчика: «Этаж этой схемы — вынеси из отдельного параметра вообще в
// параметры схемы». Поле переехало из колонки чертежа в окно свойств схемы, и
// держать здесь надо не окно (DOM тестами не покрыт), а то, что от переезда
// зависит:
//
//   1. **Строка под именем схемы** говорит этаж — иначе номер стал бы виден
//      только внутри окна, и список схем перестал бы отвечать на «какой из них
//      какой этаж». Этаж стоит первым: в узкой колонке строка ужимается
//      многоточием, и обрезаться должен размер плана.
//   2. **Поле осталось необязательным** (G68, решение таска 149): пустое
//      значение **удаляет** ключ `floor`, а не кладёт в него `null`, — и объект,
//      которому этажей не задавали, выглядит и упаковывается как прежде.
//   3. **Объём и лестница видят этаж как прежде**: дверь к нему одна и та же
//      (`setSchemeFloor`), и переезд поля её не касается.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  SCHEME_ANCHOR_OBJECT_KEYS,
  addScheme,
  addSchemeObject,
  createProject,
  schemeAnchorCandidates,
  schemeAnchorOf,
  schemeAnchorOriginMm,
  schemeFloorOf,
  setSchemeAnchor,
  setSchemeFloor,
  validate,
} from "../src/model.js";
import { schemesAnchorView, schemesRowMeta } from "../src/panels/schemes.js";
import { volumeFloors } from "../src/volume.js";
import { packProject, unpackProject } from "../src/projectFile.js";
import { strings } from "../src/strings.js";

const HERE = dirname(fileURLToPath(import.meta.url));

// Схема с планом: по ней и строится строка под именем.
function scene() {
  const project = createProject();
  const added = addScheme(project, { name: "1 этаж", imageId: "скан", width: 2400, height: 1600 });
  return { project: added.project, schemeId: added.scheme.id };
}

test("строка под именем схемы: без этажа — только размер плана", () => {
  const base = scene();
  assert.equal(schemesRowMeta(base.project, base.schemeId), "2400 × 1600");
  assert.equal(schemesRowMeta(base.project, "нет такой схемы"), "", "чужой идентификатор — пустая строка, не падение");
});

test("этаж стоит в строке первым, размер плана за ним", () => {
  const base = scene();
  const set = setSchemeFloor(base.project, base.schemeId, 2);
  const meta = schemesRowMeta(set.project, base.schemeId);
  assert.equal(meta, "этаж 2 · 2400 × 1600");
  // Первым — чтобы многоточие съело размер плана (он же в подсказке и в окне
  // масштаба), а не номер этажа, ради которого строка и выросла.
  assert.ok(meta.indexOf("этаж") < meta.indexOf("2400"), "размер плана обогнал этаж: " + meta);
  // Подвал и цоколь — тоже этажи.
  assert.equal(schemesRowMeta(setSchemeFloor(base.project, base.schemeId, -1).project, base.schemeId), "этаж -1 · 2400 × 1600");
  assert.equal(schemesRowMeta(setSchemeFloor(base.project, base.schemeId, 0).project, base.schemeId), "этаж 0 · 2400 × 1600");
});

test("схема без подложки говорит об этом и с этажом, и без него", () => {
  const project = createProject();
  const added = addScheme(project, { name: "Подвал", width: 1000, height: 800 });
  assert.equal(schemesRowMeta(added.project, added.scheme.id), strings.schemes.noImage);
  const set = setSchemeFloor(added.project, added.scheme.id, -1);
  assert.equal(schemesRowMeta(set.project, added.scheme.id), "этаж -1 · " + strings.schemes.noImage);
});

test("пустое значение удаляет ключ: в схеме не остаётся ни floor, ни null", async () => {
  const base = scene();
  const set = setSchemeFloor(base.project, base.schemeId, 3);
  const cleared = setSchemeFloor(set.project, base.schemeId, "");
  const scheme = cleared.project.schemes.find((item) => item.id === base.schemeId);
  assert.equal(Object.prototype.hasOwnProperty.call(scheme, "floor"), false, "ключ остался в схеме");
  assert.equal(schemeFloorOf(cleared.project, base.schemeId), null);
  assert.equal(schemesRowMeta(cleared.project, base.schemeId), "2400 × 1600");
  // Снятый этаж не возвращается кругом «упаковали — распаковали».
  const restored = await unpackProject(await packProject(cleared.project, new Map()));
  const back = restored.project.schemes.find((item) => item.id === base.schemeId);
  assert.equal(Object.prototype.hasOwnProperty.call(back, "floor"), false, "ключ вернулся из файла");
});

test("объём и лестница видят этаж из свойств схемы как прежде", () => {
  const base = scene();
  // Два этажа с чертежом: объём берёт их у той же `setSchemeFloor`, которой
  // пишет окно свойств, — своей двери к этажу у панели нет.
  let project = setSchemeFloor(base.project, base.schemeId, 1).project;
  const second = addScheme(project, { name: "2 этаж", imageId: "скан-2", width: 2400, height: 1600 });
  project = setSchemeFloor(second.project, second.scheme.id, 2).project;
  project = addSchemeObject(project, {
    schemeId: second.scheme.id,
    catalogKey: "stairs",
    shape: "rect",
    atMm: { x: 1000, y: 1000 },
    widthMm: 1000,
    depthMm: 2000,
  }).project;
  const floors = volumeFloors(project, base.schemeId);
  assert.equal(floors.floor, 1, "свой этаж объём не увидел");
  assert.deepEqual(
    floors.options.map((option) => ({ floor: option.floor, stairs: option.stairs })),
    [{ floor: 2, stairs: true }],
  );
});

test("G68: у объекта прежней сборки этажа нет, и строка схемы молчит о нём", () => {
  const raw = readFileSync(join(HERE, "legacy-drawing-project.json"), "utf8");
  const legacy = JSON.parse(raw);
  for (const scheme of legacy.schemes) {
    assert.equal(schemeFloorOf(legacy, scheme.id), null);
    const meta = schemesRowMeta(legacy, scheme.id);
    assert.ok(!meta.includes("этаж"), "в строке чужой схемы появился этаж: " + meta);
  }
  // Объект не изменился ни на байт: панель его не трогает, читать — не писать.
  assert.equal(JSON.stringify(legacy), JSON.stringify(JSON.parse(raw)));
});

// ——— точка привязки схемы (таск 205, требование G309) ————————————————————
//
// Слова заказчика: «надо синхронизировать схемы для наложения одной на другую.
// Можно точку привязки указать например. Кстати лестница как раз таки может
// стать такой. Указываем в 1 месте лестницу и над ней выход с лестницы».
//
// Держать надо не окно (DOM тестами не покрыт), а то, на чём держится
// совмещение:
//
//   1. **Шов стопки этажей** — `schemeAnchorOriginMm`: где начало координат
//      схемы в общем плане дома. Его зовёт таск 202 и больше никто; разойдись
//      знак — этажи поехали бы в противоположную сторону, а увидел бы это
//      только глаз.
//   2. **Точка остаётся необязательной** (G68): пустое значение **удаляет**
//      ключ `anchor`, объект без привязки совмещается по началу координат — то
//      есть ровно как до таска.
//   3. **Лестница — дверь, а не второй источник**: кнопка подставляет её
//      середину в поля, догадка показывается, а не применяется сама.

// Два этажа с чертежом: на каждом стоит лестница, и планы начерчены от разных
// углов дома — ровно тот случай, из-за которого таск и заведён.
function house({ lowerAnchor = null, upperAnchor = null } = {}) {
  const base = scene();
  let project = setSchemeFloor(base.project, base.schemeId, 1).project;
  const second = addScheme(project, { name: "2 этаж", imageId: "скан-2", width: 2400, height: 1600 });
  project = setSchemeFloor(second.project, second.scheme.id, 2).project;
  const stairsOn = (schemeId, atMm) =>
    addSchemeObject(project, {
      schemeId,
      catalogKey: "stairs",
      shape: "rect",
      atMm,
      widthMm: 1100,
      depthMm: 2700,
    }).project;
  project = stairsOn(base.schemeId, { x: 3200, y: 4500 });
  project = stairsOn(second.scheme.id, { x: 1200, y: 800 });
  if (lowerAnchor) project = setSchemeAnchor(project, base.schemeId, lowerAnchor).project;
  if (upperAnchor) project = setSchemeAnchor(project, second.scheme.id, upperAnchor).project;
  return { project, lower: base.schemeId, upper: second.scheme.id };
}

test("точка привязки: целые миллиметры чертежа, запятая считается точкой", () => {
  const base = scene();
  const set = setSchemeAnchor(base.project, base.schemeId, { x: "3200", y: "-1450" });
  assert.equal(set.changed, true);
  assert.deepEqual(schemeAnchorOf(set.project, base.schemeId), { x: 3200, y: -1450 });
  // Доли миллиметра у чертежа не бывает (ADR 008) — число округляется.
  const dotted = setSchemeAnchor(base.project, base.schemeId, { x: "1200,6", y: 0 });
  assert.deepEqual(schemeAnchorOf(dotted.project, base.schemeId), { x: 1201, y: 0 });
  // Ноль — значение, а не пустота: привязка в начале координат законна.
  assert.deepEqual(schemeAnchorOf(setSchemeAnchor(base.project, base.schemeId, { x: 0, y: 0 }).project, base.schemeId), {
    x: 0,
    y: 0,
  });
  // Та же точка второй раз — не шаг истории.
  assert.equal(setSchemeAnchor(set.project, base.schemeId, { x: 3200, y: -1450 }).changed, false);
  assert.equal(schemeAnchorOf(base.project, base.schemeId), null, "у свежей схемы привязки нет");
  assert.equal(schemeAnchorOf(base.project, "нет такой схемы"), null, "чужой идентификатор — null, не падение");
});

test("половина точки — отказ, а не нуль по второй координате", () => {
  const base = scene();
  for (const value of [{ x: 1200, y: "" }, { x: "", y: 1200 }, { x: 1200, y: null }]) {
    assert.throws(() => setSchemeAnchor(base.project, base.schemeId, value), {
      message: strings.errors.schemeAnchorHalf,
    });
  }
  // Не пара вовсе — свой отказ: точка это две координаты, а не число.
  assert.throws(() => setSchemeAnchor(base.project, base.schemeId, 1200), {
    message: strings.errors.schemeAnchorInvalid,
  });
  // Мусор в координате отвергает общая проверка миллиметров чертежа.
  assert.throws(() => setSchemeAnchor(base.project, base.schemeId, { x: "ага", y: 0 }));
  assert.throws(() => setSchemeAnchor(base.project, base.schemeId, { x: 0, y: 1e9 }));
});

test("пустое значение удаляет ключ: в схеме не остаётся ни anchor, ни null", async () => {
  const base = scene();
  const set = setSchemeAnchor(base.project, base.schemeId, { x: 500, y: 900 });
  for (const blank of [{ x: "", y: "" }, null, undefined, ""]) {
    const cleared = setSchemeAnchor(set.project, base.schemeId, blank);
    const scheme = cleared.project.schemes.find((item) => item.id === base.schemeId);
    assert.equal(Object.prototype.hasOwnProperty.call(scheme, "anchor"), false, "ключ остался в схеме");
    assert.equal(schemeAnchorOf(cleared.project, base.schemeId), null);
  }
  // Снятая привязка не возвращается кругом «упаковали — распаковали».
  const cleared = setSchemeAnchor(set.project, base.schemeId, null);
  const restored = await unpackProject(await packProject(cleared.project, new Map()));
  const back = restored.project.schemes.find((item) => item.id === base.schemeId);
  assert.equal(Object.prototype.hasOwnProperty.call(back, "anchor"), false, "ключ вернулся из файла");
  // А заданная — переживает круг целиком.
  const kept = await unpackProject(await packProject(set.project, new Map()));
  assert.deepEqual(schemeAnchorOf(kept.project, base.schemeId), { x: 500, y: 900 });
  // Снимать нечего — шага истории нет.
  assert.equal(setSchemeAnchor(base.project, base.schemeId, null).changed, false);
});

test("шов стопки этажей: начало координат схемы стоит в минус привязке", () => {
  const box = house({ lowerAnchor: { x: 3200, y: 4500 }, upperAnchor: { x: 1200, y: 800 } });
  // Привязка `a` — общий ноль дома, значит ноль схемы лежит в `−a`.
  assert.deepEqual(schemeAnchorOriginMm(box.project, box.lower), { x: -3200, y: -4500 });
  assert.deepEqual(schemeAnchorOriginMm(box.project, box.upper), { x: -1200, y: -800 });
  // Так это и складывает таск 202: смещение этажа — разница начал.
  const here = schemeAnchorOriginMm(box.project, box.lower);
  const there = schemeAnchorOriginMm(box.project, box.upper);
  const shift = { x: there.x - here.x, y: there.y - here.y };
  assert.deepEqual(shift, { x: 2000, y: 3700 });
  // И главное: привязка верхнего этажа после сдвига попадает ровно в привязку
  // нижнего — то есть лестница встаёт над лестницей.
  const upper = schemeAnchorOf(box.project, box.upper);
  assert.deepEqual({ x: upper.x + shift.x, y: upper.y + shift.y }, schemeAnchorOf(box.project, box.lower));
});

test("без привязки шов отдаёт ноль — этажи совмещаются как до таска", () => {
  const box = house();
  assert.deepEqual(schemeAnchorOriginMm(box.project, box.lower), { x: 0, y: 0 });
  assert.deepEqual(schemeAnchorOriginMm(box.project, box.upper), { x: 0, y: 0 });
  // Смешанный случай определён тем же правилом: у кого точка есть — встаёт по
  // ней, у кого нет — по своему нулю.
  const half = house({ upperAnchor: { x: 1200, y: 800 } });
  assert.deepEqual(schemeAnchorOriginMm(half.project, half.lower), { x: 0, y: 0 });
  assert.deepEqual(schemeAnchorOriginMm(half.project, half.upper), { x: -1200, y: -800 });
  assert.deepEqual(schemeAnchorOriginMm(box.project, "нет такой схемы"), { x: 0, y: 0 });
});

test("лестница предлагается точкой: середина габарита, в порядке ключей", () => {
  const box = house();
  const found = schemeAnchorCandidates(box.project, box.lower);
  assert.equal(found.length, 1);
  assert.equal(found[0].key, "stairs");
  assert.equal(found[0].name, strings.schemeObjectKinds.stairs, "имя марша берётся из словаря");
  // Середина габарита, а не угол: у прямоугольника это его `atMm`.
  assert.deepEqual(found[0].atMm, { x: 3200, y: 4500 });
  // Выход с лестницы — вторая половина пары (таск 204). Ключ стоит в списке
  // заранее: придёт запись в каталог — выход начнёт предлагаться сам, без
  // правки привязки.
  // Марш с таска 216 не один, а четыре вида (G322), и все они — лестничная
  // клетка: по этому же списку объём узнаёт лестницу и переводит по этажам.
  assert.deepEqual(SCHEME_ANCHOR_OBJECT_KEYS, ["stairs", "stairsL", "stairsU", "stairsSpiral", "stairsExit"]);
  // Лестницы нет вовсе — пустой список, а не догадка.
  const bare = scene();
  assert.deepEqual(schemeAnchorCandidates(bare.project, bare.schemeId), []);
});

test("несколько лестниц: предлагаются все, и ни одна не берётся сама", () => {
  const box = house();
  const second = addSchemeObject(box.project, {
    schemeId: box.lower,
    catalogKey: "stairs",
    shape: "rect",
    atMm: { x: 8000, y: 1000 },
    widthMm: 1100,
    depthMm: 2700,
  }).project;
  const found = schemeAnchorCandidates(second, box.lower);
  assert.equal(found.length, 2, "вторая лестница пропала из списка");
  assert.deepEqual(
    found.map((item) => item.atMm),
    [
      { x: 3200, y: 4500 },
      { x: 8000, y: 1000 },
    ],
    "порядок не совпал с порядком вещей на схеме",
  );
  // Главное: привязка от этого **не появилась**. Две лестницы — это догадка, а
  // догадка по G68 показывается, а не применяется (выбирает человек в окне).
  assert.equal(schemeAnchorOf(second, box.lower), null);
  assert.deepEqual(schemeAnchorOriginMm(second, box.lower), { x: 0, y: 0 });
});

test("лестница, обведённая контуром, даёт середину своего габарита", () => {
  const base = scene();
  const project = addSchemeObject(base.project, {
    schemeId: base.schemeId,
    catalogKey: "stairs",
    shape: "polyline",
    pointsMm: [
      { x: 1000, y: 1000 },
      { x: 1000, y: 3000 },
      { x: 2000, y: 3000 },
    ],
    depthMm: 300,
  }).project;
  // У ломаной `atMm` нет вовсе — точка берётся из габарита её вершин.
  assert.deepEqual(schemeAnchorCandidates(project, base.schemeId)[0].atMm, { x: 1500, y: 2000 });
});

test("строка под именем схемы говорит о привязке, когда она задана", () => {
  const base = scene();
  const anchored = setSchemeAnchor(base.project, base.schemeId, { x: 120, y: 340 }).project;
  assert.equal(schemesRowMeta(anchored, base.schemeId), "привязка · 2400 × 1600");
  const both = setSchemeFloor(anchored, base.schemeId, 2).project;
  const meta = schemesRowMeta(both, base.schemeId);
  assert.equal(meta, "этаж 2 · привязка · 2400 × 1600");
  // Этаж по-прежнему первым: многоточие в узкой колонке съедает хвост.
  assert.ok(meta.indexOf("этаж") < meta.indexOf("привязка"), "привязка обогнала этаж: " + meta);
  assert.ok(meta.indexOf("привязка") < meta.indexOf("2400"), "размер плана обогнал привязку: " + meta);
  // Нет привязки — нет и слова о ней.
  assert.equal(schemesRowMeta(setSchemeFloor(base.project, base.schemeId, 2).project, base.schemeId), "этаж 2 · 2400 × 1600");
});

test("окно свойств: без привязки строка зовёт и объясняет, с привязкой — называет числа", () => {
  assert.deepEqual(schemesAnchorView(null), { set: false, label: strings.schemes.anchorNone });
  const set = schemesAnchorView({ x: 3200, y: -1450 });
  assert.equal(set.set, true);
  assert.equal(set.label, "Привязка: 3200, -1450 мм");
  // Строка без привязки обязана сказать, что будет вместо неё: иначе человек
  // гадает, почему дом в объёме сложился из кусков вразнобой.
  assert.ok(strings.schemes.anchorNone.includes("начал"), strings.schemes.anchorNone);
});

test("привязка на полпути — находка панели; без привязки вовсе панель молчит", () => {
  const silent = house();
  assert.equal(
    validate(silent.project).filter((item) => item.code === "schemeAnchorMissing").length,
    0,
    "привязки нет ни у одного этажа — ломаться нечему, строка была бы шумом",
  );
  const half = house({ upperAnchor: { x: 1200, y: 800 } });
  const found = validate(half.project).filter((item) => item.code === "schemeAnchorMissing");
  assert.equal(found.length, 1, "брошенная на полпути привязка прошла молча");
  assert.equal(found[0].kind, "warning", "это находка, а не поломка: объект цел");
  assert.equal(found[0].ref, half.lower, "виновник — та схема, у которой точки нет");
  assert.ok(found[0].message.includes("1 этаж"), found[0].message);
  // Привязали оба — панели сказать нечего.
  const whole = house({ lowerAnchor: { x: 3200, y: 4500 }, upperAnchor: { x: 1200, y: 800 } });
  assert.equal(validate(whole.project).filter((item) => item.code === "schemeAnchorMissing").length, 0);
  // Этаж один — совмещать не с чем, и спрашивать не о чем.
  const alone = scene();
  let one = setSchemeFloor(alone.project, alone.schemeId, 1).project;
  one = setSchemeAnchor(one, alone.schemeId, { x: 10, y: 20 }).project;
  assert.equal(validate(one).filter((item) => item.code === "schemeAnchorMissing").length, 0);
});

test("G68: у объекта прежней сборки привязки нет, а лестница в нём уже предлагается", async () => {
  const raw = readFileSync(join(HERE, "legacy-drawing-project.json"), "utf8");
  const legacy = JSON.parse(raw);
  for (const scheme of legacy.schemes) {
    // Открывается как закрывался: привязки нет, совмещение по началу координат.
    assert.equal(schemeAnchorOf(legacy, scheme.id), null);
    assert.deepEqual(schemeAnchorOriginMm(legacy, scheme.id), { x: 0, y: 0 });
    const meta = schemesRowMeta(legacy, scheme.id);
    assert.ok(!meta.includes("привязка"), "в строке чужой схемы появилась привязка: " + meta);
  }
  // Догадка при этом **видна**: лестница прежней разметки (вид из справочника
  // объекта, ключа у вещи нет вовсе) узнаётся по имени и предлагается точкой.
  const found = schemeAnchorCandidates(legacy, legacy.schemes[0].id);
  assert.equal(found.length, 1);
  assert.equal(found[0].name, "Лестница на 2 этаж");
  assert.deepEqual(found[0].atMm, { x: 3200, y: 1600 });
  // Панель предупреждений молчит: привязку в этом объекте не начинали.
  assert.equal(validate(legacy).filter((item) => item.code === "schemeAnchorMissing").length, 0);
  // Объект не изменился ни на байт: читать — не писать.
  assert.equal(JSON.stringify(legacy), JSON.stringify(JSON.parse(raw)));
  // И упаковывается тем же файлом: нового ключа в схемах не появилось.
  const circled = await unpackProject(await packProject(legacy, new Map()));
  for (const scheme of circled.project.schemes) {
    assert.equal(Object.prototype.hasOwnProperty.call(scheme, "anchor"), false, "привязка приписалась старой схеме");
  }
});

test("знак привязки живёт в мастерской и на бумагу не уходит", () => {
  // Привязка — служебный знак, а не часть чертежа: её рисует мастерская
  // (`paintAnchor` рядом с нулём чертежа), а общий слой `render.drawDrawing` о
  // ней не знает. Поэтому её нет ни в PNG, ни на листе ГОСТ, ни в развёртке,
  // ни в миникарте объёма — они зовут тот же общий слой.
  //
  // Держится это сверкой по исходникам, как вид чертежа у таска 188: забытый
  // импорт в рисовальщике листа вынес бы фиолетовое кольцо в печать, и увидел
  // бы это заказчик, а не прогон.
  const read = (name) => readFileSync(join(HERE, "..", "src", name), "utf8");
  for (const name of ["render.js", "exporter.js", "gostSheet.js", "pdf.js"]) {
    assert.ok(!read(name).includes("schemeAnchorOf"), "привязка добралась до бумаги через " + name);
  }
  const workshop = read(join("panels", "workshop.js"));
  assert.ok(workshop.includes("function paintAnchor()"), "знак привязки пропал из мастерской");
  assert.ok(workshop.includes("paintAnchor();"), "знак привязки перестали рисовать");
});
