// Габарит вещи в миллиметрах — один ответ на обе поверхности (таск 156, G226).
//
// Правило было написано дважды и разошлось: развёртка подтягивала недостающую
// сторону из габарита изображения объекта **по каждой стороне отдельно**, а
// объём брал запас только когда не задано **ни одной** и тянул вторую до
// нижнего предела видимости. Вещь с длиной 600 и пустой шириной выходила
// 600 × 90 на листе и 600 × 20 в объёме.
//
// Поэтому здесь проверяются три разных вещи, и каждая важна по-своему:
//
//   1. **само правило** — чистой функцией, без холста;
//   2. **что обе поверхности зовут его** — развёртка и объём на одном объекте
//      обязаны назвать одни и те же миллиметры. Разойдись они снова — падает
//      этот тест, а не глаз человека, который смотрит то туда, то сюда;
//   3. **G68** — файл прежнего формата открывается, ведёт себя предсказуемо и
//      не меняется ни байтом: догадка живёт в сцене, а не в справочнике.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { MARK_BOX_FRAME_DEPTH_MM, MARK_BOX_FRAME_MM, markBoxMm } from "../src/markBox.js";
import { markSizes, typeSizes, wallElevation, wallsOnScheme } from "../src/model.js";
import { objectViewByName } from "../src/objectViews/registry.js";
import { elevationMarkBox } from "../src/render.js";
import { unpackProject, writeZip } from "../src/projectFile.js";
import { VOLUME_MARK_LIFT_MM, volumeScene } from "../src/volume.js";

const HERE = dirname(fileURLToPath(import.meta.url));

// ——— само правило ————————————————————————————————————————————————————————

test("каждая сторона отвечает за себя: своя остаётся, пустая берётся у изображения", () => {
  const conditioner = objectViewByName("conditioner");
  assert.deepEqual(conditioner.mm, { width: 900, height: 300 }, "габарит изображения — часть договора");
  // Названа длина — вторая сторона приходит из изображения, а не из предела
  // видимости: это и есть вся правка таска 156.
  const along = markBoxMm({ lengthMm: 600, widthMm: null }, conditioner);
  assert.equal(along.lengthMm, 600);
  assert.equal(along.widthMm, 300);
  assert.equal(along.lengthFrom, "own");
  assert.equal(along.widthFrom, "view");
  assert.equal(along.guessed, true);
  assert.equal(along.from, "conditioner");
  // Названа вторая — то же в другую сторону.
  const across = markBoxMm({ lengthMm: null, widthMm: 600 }, conditioner);
  assert.equal(across.lengthMm, 900);
  assert.equal(across.widthMm, 600);
  assert.equal(across.lengthFrom, "view");
  assert.equal(across.widthFrom, "own");
});

test("названы обе стороны — догадки нет вовсе", () => {
  const box = markBoxMm({ lengthMm: 500, widthMm: 400 }, objectViewByName("lamp"));
  assert.equal(box.lengthMm, 500);
  assert.equal(box.widthMm, 400);
  assert.equal(box.guessed, false);
  assert.equal(box.from, null, "изображение не спрашивали — и ссылаться на него незачем");
  // Изображения нет совсем — вещь всё равно своя: рамка нужна только пустой
  // стороне.
  const noView = markBoxMm({ lengthMm: 500, widthMm: 400 }, null);
  assert.equal(noView.lengthMm, 500);
  assert.equal(noView.widthMm, 400);
  assert.equal(noView.guessed, false);
});

test("не задано ни одной — габарит изображения целиком (G215)", () => {
  // «Мастер-выключатель» заказчика: своя форма `circle-rays` входит в
  // светильник, и его габарит — честный запас из того же реестра, которым
  // рисуются лица вещей.
  const lamp = objectViewByName("lamp");
  const box = markBoxMm({ lengthMm: null, widthMm: null }, lamp);
  assert.equal(box.lengthMm, lamp.mm.width);
  assert.equal(box.widthMm, lamp.mm.height);
  assert.equal(box.lengthFrom, "view");
  assert.equal(box.widthFrom, "view");
  assert.equal(box.guessed, true);
});

test("изображения нет — общая рамка стартового справочника", () => {
  const box = markBoxMm({ lengthMm: null, widthMm: null }, null);
  assert.equal(box.lengthMm, MARK_BOX_FRAME_MM);
  assert.equal(box.widthMm, MARK_BOX_FRAME_MM);
  assert.equal(box.lengthFrom, "frame");
  assert.equal(box.widthFrom, "frame");
  assert.equal(box.from, null);
  assert.equal(MARK_BOX_FRAME_MM, 80, "рамка — подрозетник стартового справочника");
  assert.equal(MARK_BOX_FRAME_DEPTH_MM, 10);
  // Запись без габарита (такой в реестре нет, но правило обязано отвечать и на
  // неё) уходит в ту же рамку — по каждой стороне отдельно.
  const broken = markBoxMm({ lengthMm: null, widthMm: null }, { name: "x", mm: { width: 0, height: 120 } });
  assert.equal(broken.lengthMm, MARK_BOX_FRAME_MM);
  assert.equal(broken.lengthFrom, "frame");
  assert.equal(broken.widthMm, 120);
  assert.equal(broken.widthFrom, "view");
});

test("ноль, пустота и мусор на стороне лица значат одно — «не сказано»", () => {
  const lamp = objectViewByName("lamp");
  // Вещи нулевой длины не бывает, и ноль читается как пустота: так развёртка
  // считала с самого начала (`Number(size.width) || view.mm.width`). Ноль у
  // выступа — другое дело, он значит «встроенный», и живёт это правило в
  // объёме, а не здесь.
  for (const value of [0, null, undefined, "", NaN, -5, "шестьсот"]) {
    const box = markBoxMm({ lengthMm: value, widthMm: 400 }, lamp);
    assert.equal(box.lengthMm, lamp.mm.width, String(value));
    assert.equal(box.lengthFrom, "view", String(value));
  }
  // Размеров нет вовсе — спрашивать нечего, и правило не падает.
  assert.equal(markBoxMm(null, lamp).lengthMm, lamp.mm.width);
  assert.equal(markBoxMm(undefined, null).widthMm, MARK_BOX_FRAME_MM);
  // Строка с числом — число: размеры приходят из полей ввода, и «600» из
  // старого объекта так же законно, как 600.
  assert.equal(markBoxMm({ lengthMm: "600", widthMm: null }, lamp).lengthMm, 600);
});

// ——— один ответ: развёртка и объём ————————————————————————————————————————

// Габарит метки на листе развёртки — в миллиметрах. Масштаб и единицу берём
// единицей: нижняя граница масштаба (`ELEVATION_VIEW_MIN_PX`, 13 точек) при
// ней не включается ни для одного размера фикстуры, и видно чистый габарит.
function elevationBoxesMm(project, schemeId) {
  const out = new Map();
  for (const wall of wallsOnScheme(project, schemeId)) {
    for (const side of ["left", "right"]) {
      const sheet = wallElevation(project, wall.id, side);
      for (const mark of sheet.marks) {
        const box = elevationMarkBox(mark, 1, 1, true);
        out.set(mark.id, box.view ? { lengthMm: box.width, widthMm: box.height } : null);
      }
    }
  }
  return out;
}

function volumeBoxesMm(project, schemeId) {
  const out = new Map();
  for (const place of volumeScene(project, schemeId, {}).marks) {
    if (!place.face) continue;
    // У лица вещи `widthMm` — вдоль поверхности, `heightMm` — вторая сторона:
    // те же длина и ширина, что у развёртки, только названные по лицу.
    out.set(place.markId, { lengthMm: place.face.widthMm, widthMm: place.face.heightMm });
  }
  return out;
}

// ——— G68: файл прежнего формата ——————————————————————————————————————————

async function openLegacyFile() {
  const text = readFileSync(join(HERE, "legacy-sizes-project.json"), "utf8");
  const blob = await writeZip([{ name: "project.json", data: text }]);
  const opened = await unpackProject(blob);
  return { ...opened, text, loaded: JSON.parse(text) };
}

test("файл прежнего формата: обе поверхности называют один габарит, объект не меняется (G68)", async () => {
  const { project, loaded, text } = await openLegacyFile();
  const schemeId = project.schemes[0].id;
  const byCode = (code) => project.markTypes.find((type) => type.code === code);
  const markOf = (code) => project.marks.find((mark) => mark.typeId === byCode(code).id);

  // Что лежит в файле: у «ЛН» задана одна длина, у «ЗВ» — ни одного размера и
  // форма, которую не разбирает ни одно изображение, у «КД» — обе стороны.
  assert.deepEqual(typeSizes(byCode("ЛН")), { length: 600, width: null, depth: null, heightAboveFloor: null });
  assert.deepEqual(typeSizes(byCode("ЗВ")), { length: null, width: null, depth: null, heightAboveFloor: null });
  assert.equal(typeSizes(byCode("КД")).length, 900);

  const elevation = elevationBoxesMm(project, schemeId);
  const volume = volumeBoxesMm(project, schemeId);

  // Вещь с одной названной стороной: 600 вдоль стены, вторая — от изображения
  // светильника (90). До таска 156 в объёме здесь стояло 600 × 20.
  const lamp = objectViewByName("lamp");
  assert.deepEqual(volume.get(markOf("ЛН").id), { lengthMm: 600, widthMm: lamp.mm.height });
  assert.deepEqual(elevation.get(markOf("ЛН").id), volume.get(markOf("ЛН").id), "один ответ на обе поверхности");

  // Вещь с обеими сторонами — ровно как была, ни на миллиметр не сдвинулась.
  assert.deepEqual(volume.get(markOf("КД").id), { lengthMm: 900, widthMm: 300 });
  assert.deepEqual(elevation.get(markOf("КД").id), volume.get(markOf("КД").id));

  // Вещь без размеров и без изображения: в объёме — общая рамка, на развёртке
  // — условный знак. Это не расхождение правила: знак не изображает вещь и
  // масштаба не обещает, поэтому габарита у него нет вовсе.
  assert.deepEqual(volume.get(markOf("ЗВ").id), { lengthMm: MARK_BOX_FRAME_MM, widthMm: MARK_BOX_FRAME_MM });
  assert.equal(elevation.get(markOf("ЗВ").id), null);

  // Все три поставлены и названы: ни одна не потерялась, а догадки
  // перечислены вслух.
  const built = volumeScene(project, schemeId, {});
  assert.deepEqual(built.unplaced, []);
  assert.deepEqual(
    built.spare.map((item) => item.markId).sort(),
    [markOf("ЛН").id, markOf("ЗВ").id].sort(),
    "догадка названа у обеих вещей, у которых сторону взяли не из файла",
  );

  // G68. Главное: догадка живёт в сцене. В справочнике у «ЛН» по-прежнему одна
  // длина, у «ЗВ» — ни одного размера, и метки не получили ни одного поля.
  assert.deepEqual(byCode("ЛН").sizes, { length: 600 });
  assert.equal(byCode("ЗВ").sizes, undefined);
  assert.deepEqual(project.marks, loaded.marks, "ни одна метка не изменилась");
  assert.equal(JSON.stringify(loaded), JSON.stringify(JSON.parse(text)), "сборка сцены не тронула прочитанное");
});

test("выступ у вещи с одной названной стороной остаётся своим, а не рамочным", async () => {
  const { project } = await openLegacyFile();
  const schemeId = project.schemes[0].id;
  const byCode = (code) => project.markTypes.find((type) => type.code === code);
  const place = volumeScene(project, schemeId, {}).marks.find(
    (item) => item.markId === project.marks.find((mark) => mark.typeId === byCode("ЛН").id).id,
  );
  const corners = place.prisms[0].corners;
  const sides = corners.map((corner, index) => {
    const next = corners[(index + 1) % corners.length];
    return Math.hypot(next.x - corner.x, next.y - corner.y);
  });
  // Выступ — третье измерение, и подтягивать его по одной названной стороне
  // нечем: вещь остаётся плоской (2 мм), как и до таска 156. Рамочные 10 мм
  // достаются только той вещи, о размерах которой не сказано ничего.
  assert.ok(Math.abs(Math.min(...sides) - VOLUME_MARK_LIFT_MM) < 0.01, String(Math.min(...sides)));
});

test("умолчания типа остаются умолчаниями: правка размера у типа везёт обе поверхности за собой", async () => {
  const { project } = await openLegacyFile();
  const schemeId = project.schemes[0].id;
  const typeId = project.markTypes.find((type) => type.code === "ЛН").id;
  // Сторона была догадкой — человек вписал её у типа, и обе поверхности взяли
  // число. Это и есть ответ на «почему не записью в справочник»: запись сделала
  // бы догадку неотличимой от этого числа.
  const filled = {
    ...project,
    markTypes: project.markTypes.map((type) => (type.id === typeId ? { ...type, sizes: { length: 600, width: 220 } } : type)),
  };
  const mark = filled.marks.find((item) => item.typeId === typeId);
  assert.equal(markSizes(filled, mark).width, 220);
  assert.deepEqual(volumeBoxesMm(filled, schemeId).get(mark.id), { lengthMm: 600, widthMm: 220 });
  assert.deepEqual(elevationBoxesMm(filled, schemeId).get(mark.id), { lengthMm: 600, widthMm: 220 });
  assert.deepEqual(volumeScene(filled, schemeId, {}).spare.map((item) => item.markId), [
    filled.marks.find((item) => item.typeId === filled.markTypes.find((type) => type.code === "ЗВ").id).id,
  ], "догадка осталась только у той вещи, о которой по-прежнему ничего не сказано");
});
