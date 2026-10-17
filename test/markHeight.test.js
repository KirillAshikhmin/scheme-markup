// Высота метки — третий габарит вещи (таск 158, требование G233).
//
// Слова заказчика: «у меток ещё должна быть характеристика Высота. И в
// интерфейсе сделай 3 поля рядом : Длина, Ширина, Высота. Напримре ленте
// вертикальной надо указать высоту от пола до потолка».
//
// ——— что здесь проверяется и почему именно это ————————————————————————————
//
// Таск оказался не про новое число, а про имена: у вещи три габарита, и все
// три в объекте лежали. Врали подписи — `width` звался «Шириной», хотя его
// рисуют **вверх**, а `depth` звался «Выступом от стены», хотя это и есть
// ширина вещи поперёк поверхности. Поэтому тест держит две разные вещи:
//
//   1. **словарь** — какое поле как подписано и в каком порядке стоит в окне:
//      разойдись подпись с осью снова, и чертёж прочтут неверно;
//   2. **G68** — объект прежнего формата рисуется **ровно теми же**
//      миллиметрами. Правка таска — переименование подписей, и ни одна вещь
//      не имеет права сдвинуться ни на миллиметр. Числа ниже сняты с кода
//      **до** правки и вписаны руками: это и есть «было».
//
// Фикстура `legacy-height-project.json` — объект прежнего формата (версия 3),
// и в ней собраны три случая, которые выводят имена осей на свет:
//
//   - **КД** кондиционер 900 × 300 при выступе 200 — вещь, на которой спор и
//     начался: 300 это высота корпуса, а не глубина;
//   - **ЛВ** вертикальная лента, **линейная** метка со своей высотой 2600 при
//     умолчании типа 2700 — тот самый пример заказчика «от пола до потолка»;
//   - **СУШ** сушилка 500 × 800 × 110 — вещь, у которой высота отличается и
//     от длины, и от ширины: по ней видно, что модель (таск 155) садится в
//     габарит, а не в куб.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  findMark,
  markSizes,
  wallElevation,
  wallsOnScheme,
} from "../src/model.js";
import { elevationMarkBox } from "../src/render.js";
import { unpackProject, writeZip } from "../src/projectFile.js";
import { volumeScene } from "../src/volume.js";

const HERE = dirname(fileURLToPath(import.meta.url));

async function openLegacyFile() {
  const text = readFileSync(join(HERE, "legacy-height-project.json"), "utf8");
  const blob = await writeZip([{ name: "project.json", data: text }]);
  const opened = await unpackProject(blob);
  return { project: opened.project, text, loaded: JSON.parse(text) };
}

// Тело вещи в объёме: сколько оно занимает вдоль стены, поперёк неё и вверх.
// Снимается с призмы, а не с полей размещения: рисуется именно призма, и
// спрашивать надо то, что видит глаз.
function bodyMm(place) {
  const prism = place.prisms[0];
  const xs = prism.corners.map((corner) => corner.x);
  const ys = prism.corners.map((corner) => corner.y);
  return {
    // Стена фикстуры идёт по `x`, поэтому вдоль неё — разброс по `x`, поперёк
    // — по `y`. Округление — от поворотов нормали: грань стоит ровно.
    alongMm: Math.round(Math.max(...xs) - Math.min(...xs)),
    acrossMm: Math.round(Math.max(...ys) - Math.min(...ys)),
    upMm: Math.round(prism.topMm - prism.bottomMm),
    bottomMm: Math.round(prism.bottomMm),
  };
}

function placedByLabel(project, schemeId) {
  const out = new Map();
  for (const place of volumeScene(project, schemeId, {}).marks) out.set(place.label, place);
  return out;
}

function sheetByLabel(project, schemeId) {
  const out = new Map();
  for (const wall of wallsOnScheme(project, schemeId)) {
    for (const side of ["left", "right"]) {
      for (const mark of wallElevation(project, wall.id, side).marks) {
        out.set(mark.label, { mark, box: elevationMarkBox(mark, 1, 1, true) });
      }
    }
  }
  return out;
}

test("объект прежнего формата рисуется теми же миллиметрами (G68)", async () => {
  const { project, loaded, text } = await openLegacyFile();
  const schemeId = project.schemes[0].id;
  const placed = placedByLabel(project, schemeId);
  const sheet = sheetByLabel(project, schemeId);

  // ——— кондиционер: 900 вдоль стены, 200 от стены, 300 вверх ———
  //
  // Вот он, распутанный спор: поле `width` = 300 рисуется **вверх**, а выступ
  // 200 — **поперёк**. Поэтому 300 это высота корпуса, и подпись «Ширина» на
  // нём врала.
  assert.deepEqual(bodyMm(placed.get("КД1")), { alongMm: 900, acrossMm: 200, upMm: 300, bottomMm: 2150 });
  // Высота над полом — середина вещи: 2300 ± 150. Это прежнее правило, и
  // таск его не трогает.
  assert.equal(placed.get("КД1").heightMm, 2300);
  // Габарит модели (таск 155) берётся оттуда же: тело в нём, а не куб.
  assert.deepEqual(
    {
      widthMm: placed.get("КД1").frame.widthMm,
      depthMm: placed.get("КД1").frame.depthMm,
      heightMm: placed.get("КД1").frame.heightMm,
    },
    { widthMm: 900, depthMm: 200, heightMm: 300 },
  );

  // ——— сушилка: высота 800 не равна ни длине 500, ни ширине 110 ———
  assert.deepEqual(bodyMm(placed.get("СУШ1")), { alongMm: 110, acrossMm: 500, upMm: 800, bottomMm: 500 });
  assert.deepEqual(
    {
      widthMm: placed.get("СУШ1").frame.widthMm,
      depthMm: placed.get("СУШ1").frame.depthMm,
      heightMm: placed.get("СУШ1").frame.heightMm,
    },
    { widthMm: 500, depthMm: 110, heightMm: 800 },
    "модель садится в габарит вещи, а не в куб по одной стороне",
  );

  // ——— вертикальная лента: высота задана числом и доходит до картинки ———
  //
  // Пример заказчика целиком: линейная метка, у которой **своя** высота 2600
  // старше умолчания типа 2700, а длина берётся с плана (60 мм отрезка).
  const strip = markSizes(project, findMark(project, placed.get("ЛВ1").markId));
  assert.equal(strip.width, 2600, "своя высота метки старше умолчания типа");
  assert.equal(strip.widthOwn, true);
  assert.deepEqual(bodyMm(placed.get("ЛВ1")), { alongMm: 60, acrossMm: 15, upMm: 2600, bottomMm: 0 });

  // ——— один ответ о габарите на обеих поверхностях (G226, таск 156) ———
  //
  // Спрашиваются **точечные** метки: лист развёртки рисует линейную росчерком
  // по отрезку плана (`lines` в `elevationSheet`) и о габарите её не
  // спрашивает вовсе — поэтому и расходиться тут нечему, а высота ленты видна
  // в объёме. Это не дыра таска, а место, которое он нашёл: на листе высота
  // линейной метки пока не нарисована ничем.
  for (const label of ["КД1", "СУШ1"]) {
    const place = placed.get(label);
    const box = sheet.get(label).box;
    assert.deepEqual(
      { lengthMm: box.width, heightMm: box.height },
      { lengthMm: place.face.widthMm, heightMm: place.face.heightMm },
      "развёртка и объём разошлись о габарите вещи: " + label,
    );
  }
  assert.equal(sheet.get("ЛВ1").mark.kind, "line");
  assert.deepEqual(sheet.get("ЛВ1").mark.sizeMm, { width: 40, height: 2600 },
    "высота ленты доходит до листа данными, даже пока он рисует её росчерком");
  // На листе развёртки вторая сторона лица давно зовётся высотой — именно это
  // имя таск и вернул справочнику.
  assert.deepEqual(sheet.get("КД1").mark.sizeMm, { width: 900, height: 300 });

  // ——— G68: размеров в объекте правка не коснулась ———
  //
  // Открытие объекта прежнего формата правит ровно две вещи, и обе — не наши:
  // версию формата и выведенный вид типа (`typeKindOf`, таск 150). Размеры
  // после этого таска не переписываются вовсе: имена поменялись в подписях, а
  // не в файле.
  assert.equal(loaded.formatVersion, 3, "фикстура обязана остаться объектом прежнего формата");
  const opened = JSON.parse(JSON.stringify(project));
  assert.deepEqual(
    { ...opened, formatVersion: 3, markTypes: opened.markTypes.map(({ kind, ...rest }) => rest) },
    { ...loaded, markTypes: loaded.markTypes.map(({ kind, ...rest }) => rest) },
    "открытие объекта тронуло что-то кроме версии формата и выведенного вида типа",
  );
  // Ни один тип не получил числа, которого человек не вписывал, и ни одна
  // метка — поля, которого у неё не было.
  for (let index = 0; index < loaded.markTypes.length; index += 1) {
    assert.deepEqual(opened.markTypes[index].sizes, loaded.markTypes[index].sizes, "размеры типа переписаны");
  }
  assert.deepEqual(Object.keys(loaded.markTypes[0].sizes), ["length", "width", "depth", "heightAboveFloor"]);
  assert.equal(loaded.marks[0].width, null);
  assert.equal(JSON.stringify(loaded), JSON.stringify(JSON.parse(text)));
});
