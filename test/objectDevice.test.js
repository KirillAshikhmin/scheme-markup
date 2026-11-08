// «Сделать устройством» у вещи и два хвоста справочника (R02.1–R02.3, G03).
//
// Окно выбора типа и кнопка в строке вещи DOM-овые, поэтому проверяются двери:
// модельный шаг (метка выбранного типа на месте вещи, связь, отмена одним
// шагом) и то, как к нему подключена кнопка чертежа; плюс справочник типов —
// заголовок колонки «Аксессуар» и сетка изображений без двойных плиток.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  addScheme,
  addSchemeObject,
  createProject,
  markObjectId,
  markOfObject,
  objectDeviceDrop,
  objectDeviceMake,
  setPlanOrigin,
  setPlanScale,
} from "../src/model.js";
import { typeViewGroups } from "../src/panels/types.js";
import { strings } from "../src/strings.js";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
const read = (name) => readFileSync(join(SRC, name), "utf8");

function sofa() {
  const added = addScheme(createProject({ name: "Устройство" }), { name: "1 этаж", imageId: "plan-1", width: 1200, height: 800 });
  const schemeId = added.scheme.id;
  let project = setPlanScale(added.project, schemeId, { a: { x: 0.1, y: 0.5 }, b: { x: 0.6, y: 0.5 }, meters: 6 }).project;
  project = setPlanOrigin(project, schemeId, { at: { x: 0, y: 0 }, turn: 0 }).project;
  const made = addSchemeObject(project, {
    schemeId,
    catalogKey: "sofa",
    shape: "rect",
    atMm: { x: 2000, y: 1000 },
    widthMm: 2000,
    depthMm: 900,
    heightMm: 800,
    turnDeg: 0,
  });
  return { project: made.project, object: made.schemeObject };
}

test("любая вещь каталога становится устройством выбранного типа, а «Убрать» возвращает вещь одну", () => {
  const { project, object } = sofa();
  assert.equal(markOfObject(project, object.id), null);
  const type = project.markTypes.find((item) => item.code === "Р");
  const made = objectDeviceMake(project, object.id, type.id);
  assert.equal(made.mark.typeId, type.id, "тип взят не из справочника");
  assert.equal(markObjectId(made.mark), object.id);
  assert.equal(markOfObject(made.project, object.id).id, made.mark.id);
  assert.ok(made.mark.number > 0, "обозначение и номер — обычными правилами нумерации типа");

  const dropped = objectDeviceDrop(made.project, object.id);
  assert.equal(markOfObject(dropped.project, object.id), null, "связь осталась");
  assert.equal(dropped.project.marks.some((mark) => mark.id === made.mark.id), false, "метка осталась");
  assert.equal(dropped.project.schemeObjects.some((item) => item.id === object.id), true, "вещь ушла вместе с устройством");
});

test("кнопка вещи идёт через дверь холста, не берёт комментарий и сама проверяет, что вещь жива", () => {
  const workshop = read("panels/workshop.js");
  const from = workshop.indexOf("async function toggleDevice()");
  assert.ok(from > 0, "пропала команда чертежа");
  const body = workshop.slice(from, workshop.indexOf("function runRemove(", from));
  assert.ok(body.includes("openTypePicker("), "тип не из справочника");
  assert.ok(body.includes("canvasObjectDeviceMake("), "не через дверь холста");
  assert.ok(body.includes("canvasObjectDeviceDrop("), "«Убрать устройство» не через дверь холста");
  assert.ok(body.includes("COMMENT_TYPE_ID"), "плашку-комментарий можно выбрать типом устройства");
  assert.ok(workshop.includes("strings.workshop.deviceMake"), "подпись кнопки не из словаря");
});

test("у колонки «Аксессуар» в справочнике типов есть заголовок", () => {
  assert.equal(strings.dictionary.deviceHead, "Аксессуар");
  assert.ok(read("panels/types.js").includes("strings.dictionary.deviceHead"), "заголовок не выведен над колонкой");
});

test("в сетке выбора изображения телевизор, полотенцесушитель и вытяжка стоят по одному разу", () => {
  const keys = typeViewGroups("").flatMap((group) => group.entries.map((entry) => entry.key));
  for (const key of ["tv", "towelDryer", "hood"]) {
    assert.equal(keys.filter((item) => item === key).length, 1, key + " стоит в сетке не один раз");
  }
  assert.equal(new Set(keys).size, keys.length, "в сетке есть плитки-двойники");
});
