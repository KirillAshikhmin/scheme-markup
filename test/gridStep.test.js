// Шаг сетки чертежа лежит в объекте (таск 175, требование G258).
//
// Слова заказчика: «Раздел Сетка в левом меню перенеси под Высота и сделай по
// умолчанию значение 100 и сохраняй выбранное значение в проекте».
//
// Это **правка формата**, и держать здесь надо не окно (DOM тестами не
// покрыт), а то, от чего зависит готовая работа:
//
//   1. **Умолчание — сто миллиметров**, и оно же стоит в списке шагов: разойдись
//      они — список предлагал бы один шаг, а сетка рисовалась бы другим.
//   2. **Поле необязательное** (G68, образец — `floor` схемы): пустое значение
//      ключ **удаляет**, а не кладёт в него `null`; объект, которому шага не
//      задавали, открывается и упаковывается прежним файлом.
//   3. **Объект прежней сборки не меняется**: ключа в нём не появляется ни
//      при открытии, ни при круге «упаковали — распаковали», метки, номера и
//      подписи те же.
//   4. **Мусор в ключе не роняет объект**: правка файла руками читается как
//      «не задано», а чужое число остаётся числом и встаёт своим пунктом в
//      списке шагов — иначе сетка, в которой чертили, молча сменилась бы на
//      соседнюю.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  GRID_STEP_DEFAULT_MM,
  addMark,
  addScheme,
  createProject,
  gridStepOf,
  gridStepSet,
  labelOf,
  setGridStep,
  typesInOrder,
} from "../src/model.js";
import { WORKSHOP_GRID_STEPS_MM, workshopGridOptions } from "../src/panels/workshop.js";
import { packProject, unpackProject } from "../src/projectFile.js";

const HERE = dirname(fileURLToPath(import.meta.url));
// Байты `project.json` опубликованной сборки: объект со схемой, комнатой,
// метками, размерами и штампом — тот же файл, которым таск 123 держит чертёж.
const LEGACY_TEXT = readFileSync(join(HERE, "legacy-project.json"), "utf8").replace(/\n$/, "");

function scene() {
  const project = createProject();
  const added = addScheme(project, { name: "1 этаж", imageId: "скан", width: 2400, height: 1600 });
  return added.project;
}

test("умолчание — сто миллиметров, и у нового объекта ключа нет вовсе", () => {
  assert.equal(GRID_STEP_DEFAULT_MM, 100, "заказчик назвал сто");
  const project = scene();
  assert.equal(gridStepOf(project), GRID_STEP_DEFAULT_MM);
  assert.equal(gridStepSet(project), false);
  assert.equal(Object.prototype.hasOwnProperty.call(project.view, "gridStepMm"), false, "умолчание уехало в объект");
});

test("умолчание стоит в списке шагов окна", () => {
  // Два числа на одну мерку — это будущее расхождение: пункт, которого нет в
  // списке, встал бы в поле пустым.
  assert.ok(WORKSHOP_GRID_STEPS_MM.includes(GRID_STEP_DEFAULT_MM), "умолчания нет среди шагов");
});

test("выбранный шаг живёт в объекте и доезжает через файл", async () => {
  const project = scene();
  const set = setGridStep(project, 500);
  assert.equal(set.changed, true);
  assert.equal(gridStepOf(set.project), 500);
  assert.equal(gridStepSet(set.project), true);
  assert.equal(set.project.view.gridStepMm, 500);
  // Размеры меток и подписей шаг не задел: он лёг рядом с ними, а не вместо них.
  assert.equal(set.project.view.markSize, project.view.markSize);
  assert.equal(set.project.view.labelSize, project.view.labelSize);
  const restored = await unpackProject(await packProject(set.project, new Map()));
  assert.equal(gridStepOf(restored.project), 500, "шаг не доехал до файла");
  // Повторная установка того же числа — не правка: шага истории на неё не нужно.
  assert.equal(setGridStep(set.project, 500).changed, false);
  assert.equal(setGridStep(set.project, "250").changed, true, "строка из поля разбирается числом");
  assert.equal(gridStepOf(setGridStep(set.project, "250").project), 250);
});

test("пустое значение удаляет ключ: ни gridStepMm, ни null", async () => {
  const set = setGridStep(scene(), 2000);
  const cleared = setGridStep(set.project, "");
  assert.equal(cleared.changed, true);
  assert.equal(Object.prototype.hasOwnProperty.call(cleared.project.view, "gridStepMm"), false, "ключ остался");
  assert.equal(gridStepOf(cleared.project), GRID_STEP_DEFAULT_MM);
  assert.equal(gridStepSet(cleared.project), false);
  // Снятый шаг не возвращается кругом «упаковали — распаковали».
  const restored = await unpackProject(await packProject(cleared.project, new Map()));
  assert.equal(
    Object.prototype.hasOwnProperty.call(restored.project.view, "gridStepMm"),
    false,
    "ключ вернулся из файла",
  );
  // Снимать нечего — и шага истории на это не нужно.
  assert.equal(setGridStep(cleared.project, null).changed, false);
});

test("негодное число окно не принимает, а объект не трогает", () => {
  const project = scene();
  for (const bad of ["абв", 0, -100, 2000000]) {
    assert.throws(() => setGridStep(project, bad), /.+/, "принято негодное: " + bad);
  }
  assert.equal(Object.prototype.hasOwnProperty.call(project.view, "gridStepMm"), false);
});

test("G68: объект прежней сборки шага не получает, разметка не меняется", async () => {
  const legacy = JSON.parse(LEGACY_TEXT);
  assert.equal(gridStepOf(legacy), GRID_STEP_DEFAULT_MM, "объект без шага читается умолчанием");
  assert.equal(gridStepSet(legacy), false);
  const labels = legacy.marks.map((mark) => labelOf(legacy, mark.id));
  const restored = await unpackProject(await packProject(legacy, new Map()));
  assert.equal(
    Object.prototype.hasOwnProperty.call(restored.project.view, "gridStepMm"),
    false,
    "открытие дописало объекту шаг сетки",
  );
  assert.deepEqual(restored.project.marks.map((mark) => mark.id), legacy.marks.map((mark) => mark.id));
  assert.deepEqual(restored.project.marks.map((mark) => mark.number), legacy.marks.map((mark) => mark.number));
  assert.deepEqual(restored.project.marks.map((mark) => labelOf(restored.project, mark.id)), labels);
  assert.deepEqual(restored.project.counters, legacy.counters, "счётчики нумерации тронуты");
  // Шаг, заданный в таком объекте, остаётся единственной правкой: метки,
  // номера и подписи после неё те же.
  const set = setGridStep(legacy, 250).project;
  assert.deepEqual(set.marks, legacy.marks);
  assert.deepEqual(set.marks.map((mark) => labelOf(set, mark.id)), labels);
  assert.deepEqual(
    typesInOrder(set).flatMap((group) => group.types.map((type) => type.code)),
    typesInOrder(legacy).flatMap((group) => group.types.map((type) => type.code)),
  );
});

test("чужое число из файла остаётся числом и встаёт своим пунктом в списке", () => {
  const project = scene();
  const alien = { ...project, view: { ...project.view, gridStepMm: 300 } };
  assert.equal(gridStepOf(alien), 300, "число из файла подменили умолчанием");
  assert.deepEqual(workshopGridOptions(300), [50, 100, 200, 250, 300, 500, 1000, 2000]);
  assert.deepEqual(workshopGridOptions(500), WORKSHOP_GRID_STEPS_MM, "обычный шаг не удвоился");
  assert.deepEqual(workshopGridOptions(0), WORKSHOP_GRID_STEPS_MM);
  assert.deepEqual(workshopGridOptions(null), WORKSHOP_GRID_STEPS_MM);
});

test("мусор в ключе читается как «не задано», а не роняет объект", () => {
  const project = scene();
  for (const junk of ["500", null, 0, -1, Number.NaN, {}]) {
    const broken = { ...project, view: { ...project.view, gridStepMm: junk } };
    assert.equal(gridStepOf(broken), GRID_STEP_DEFAULT_MM, "мусор прочитан шагом: " + String(junk));
    assert.equal(gridStepSet(broken), false);
  }
  assert.equal(gridStepOf({}), GRID_STEP_DEFAULT_MM, "объект без `view` — тоже умолчание");
  assert.equal(gridStepOf(null), GRID_STEP_DEFAULT_MM);
});

test("метка в объекте с заданным шагом ставится как в любом другом", () => {
  // Шаг — вид объекта, а не правило разметки: постановка метки его не знает.
  const project = setGridStep(scene(), 1000).project;
  const type = typesInOrder(project)[0].types[0];
  const scheme = project.schemes[0];
  const added = addMark(project, { schemeId: scheme.id, typeId: type.id, points: [{ x: 0.5, y: 0.5 }] });
  assert.equal(gridStepOf(added.project), 1000, "постановка метки сбросила шаг");
  assert.equal(added.mark.number, 1);
});
