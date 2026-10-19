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

import { addScheme, addSchemeObject, createProject, schemeFloorOf, setSchemeFloor } from "../src/model.js";
import { schemesRowMeta } from "../src/panels/schemes.js";
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
