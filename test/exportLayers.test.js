// Подложка при выгрузке (G204).
//
// Слова заказчика: «при экспорте схемы должна быть опция рисовать ли подложку».
// На холсте выключатель подложки есть с таска 127, и один лист его слушал —
// а архив всех схем не слушал ни подложку, ни чертёж: лист, скачанный кнопкой
// «Скачать», уходил без фотографии, а такой же лист внутри zip — с фотографией.
//
// Рисование в Node не проверить — холста нет. Проверяется шов, на котором
// подложка отрезается: `exportSheetPlan` — единственное место, где архив и
// документ решают, досталась ли листу картинка.
import test from "node:test";
import assert from "node:assert/strict";
import { addScheme, createProject } from "../src/model.js";
import { exportSheetPlan } from "../src/exporter.js";

function world() {
  const made = addScheme(createProject(), { name: "1 этаж", width: 1000, height: 800 });
  const project = made.project;
  const scheme = { ...project.schemes[0], imageId: "image-1" };
  const blank = addScheme(project, { name: "2 этаж", width: 1000, height: 800 }).scheme;
  const images = new Map([["image-1", { blob: true }]]);
  return { images, scheme, blank };
}

// G68: архив с умолчаниями обязан остаться тем, чем был, — с подложкой.
test("без отметки подложка листу достаётся, как доставалась всегда", () => {
  const { images, scheme } = world();
  assert.equal(exportSheetPlan(images, scheme), images.get("image-1"));
  assert.equal(exportSheetPlan(images, scheme, {}), images.get("image-1"));
  assert.equal(exportSheetPlan(images, scheme, { plan: true }), images.get("image-1"));
});

test("снятая отметка отрезает подложку у всех листов архива", () => {
  const { images, scheme } = world();
  assert.equal(exportSheetPlan(images, scheme, { plan: false }), null);
});

test("схема без своей картинки подложки не получает и с поднятой отметкой", () => {
  const { images, blank } = world();
  assert.equal(exportSheetPlan(images, blank, { plan: true }), null);
});

test("картинки, которой нет в переданных, лист не ждёт", () => {
  const { scheme } = world();
  assert.equal(exportSheetPlan(new Map(), scheme, { plan: true }), null);
  assert.equal(exportSheetPlan(null, scheme, { plan: true }), null);
});
