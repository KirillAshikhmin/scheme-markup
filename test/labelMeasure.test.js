// Ширина подписи меряется шрифтом, а не числом знаков (правка 2026-10-27).
//
// Слова заказчика: «сделай что бы комментарий растягивался по ширине текста, а
// то сейчас сильно больше. А так же почему у текста меток место под текст
// выделяется больше, чем сам текст занимает (смотри кнопки их — на каком
// большом расстоянии, а должны быть прям рядом)». Рамка считалась как «знаки ×
// 0,75 кегля», а чертёжный шрифт вдвое уже: ручки поворота и поводка стояли у
// края пустой рамки, плашка выходила шире текста, подпись слева от метки
// отходила от неё на лишнюю ширину.
//
// В Node холста нет, и остальные тесты живут оценкой. Здесь холст замера
// подставляется — до первого замера: `labelTextWidth` берёт его лениво.
import test from "node:test";
import assert from "node:assert/strict";

// Подставной шрифт: знак — 0,4 кегля, почти вдвое уже оценки.
const RATIO = 0.4;
let fontsReady = true;
let measures = 0;
globalThis.OffscreenCanvas = class {
  getContext() {
    const ctx = {
      font: "",
      measureText(value) {
        measures += 1;
        const px = Number(/([\d.]+)px/.exec(ctx.font)[1]);
        return { width: [...String(value)].length * px * RATIO };
      },
    };
    return ctx;
  }
};
globalThis.document = { fonts: { check: () => fontsReady } };

const {
  COMMENT_TYPE_ID,
  addMark,
  addOutline,
  addRoom,
  addScheme,
  createProject,
  findMark,
  typeKindOf,
  updateMark,
} = await import("../src/model.js");
const {
  labelBounds,
  labelBox,
  labelLayout,
  labelTextWidth,
  labelTurnHandle,
  outlineLabelBox,
  planToScreen,
} = await import("../src/render.js");

const FAMILY = "TestFace";
const viewOf = (patch) => ({ zoom: 1, offsetX: 0, offsetY: 0, markSize: 10, labelSize: 12, fontFamily: FAMILY, ...patch });

function scene(x = 0.5) {
  let project = addScheme(createProject(), { name: "1 этаж", width: 1000, height: 500 }).project;
  const schemeId = project.schemes[0].id;
  const typeOf = (code) => project.markTypes.find((type) => type.code === code).id;
  const added = addMark(project, { schemeId, typeId: typeOf("Р"), points: [{ x, y: 0.5 }] });
  project = added.project;
  return { project, scheme: project.schemes[0], markId: added.mark.id };
}

test("рамка подписи метки — ширина самого текста", () => {
  const { project, scheme, markId } = scene();
  const box = labelBox(project, scheme, findMark(project, markId), viewOf(), null);
  assert.equal(box.text, "Р1");
  assert.ok(Math.abs(box.width - 2 * box.font * RATIO) < 1e-9, "рамка не по тексту: " + box.width);
  assert.equal(labelTextWidth("Р1", box.font, FAMILY, 600), box.width);
});

test("ручка поворота стоит у конца текста, а не у края пустой рамки", () => {
  const { project, scheme, markId } = scene();
  const view = viewOf();
  const target = findMark(project, markId);
  const box = labelBox(project, scheme, target, view, null);
  const handle = labelTurnHandle(project, scheme, target, view, null);
  const textEnd = box.x + 2 * box.font * RATIO;
  assert.ok(handle.x - textEnd <= handle.r, "ручка далеко от текста: " + (handle.x - textEnd));
});

test("подпись у правого края плана встаёт слева вплотную к метке", () => {
  const { project, scheme, markId } = scene(0.995);
  const view = viewOf();
  const target = findMark(project, markId);
  const box = labelBox(project, scheme, target, view, null);
  const anchor = planToScreen(target.points[0], scheme, view);
  const rect = labelBounds(box);
  assert.ok(rect.x + rect.width < anchor.x, "подпись не ушла влево");
  // Между концом текста и меткой — ровно просвет подписи (`LABEL_GAP` × знак).
  assert.ok(Math.abs(anchor.x - (rect.x + rect.width) - 15) < 1e-6, "подпись отошла от метки: " + (anchor.x - rect.x - rect.width));
});

test("плашка комментария растягивается по ширине текста", () => {
  let { project, scheme } = scene();
  const added = addMark(project, {
    schemeId: scheme.id,
    typeId: COMMENT_TYPE_ID,
    kind: typeKindOf(project, COMMENT_TYPE_ID),
    points: [{ x: 0.3, y: 0.3 }],
  });
  project = updateMark(added.project, added.mark.id, { original: "Никого нет" }).project;
  const box = labelBox(project, project.schemes[0], findMark(project, added.mark.id), viewOf(), null);
  assert.deepEqual(box.plate.lines, ["Никого нет"]);
  const text = "Никого нет".length * box.font * RATIO;
  assert.ok(Math.abs(box.width - (text + box.plate.pad * 2)) < 1e-9, "плашка шире текста: " + box.width);
});

test("рамка подписи комнаты — тоже по тексту", () => {
  const made = addScheme(createProject(), { name: "1 этаж", width: 1000, height: 500 });
  const room = addRoom(made.project, "Гостиная");
  const points = [
    { x: 0.2, y: 0.2 },
    { x: 0.6, y: 0.2 },
    { x: 0.6, y: 0.5 },
    { x: 0.2, y: 0.5 },
  ];
  const outlined = addOutline(room.project, { schemeId: made.scheme.id, roomId: room.room.id, points });
  const box = outlineLabelBox(outlined.project, outlined.project.schemes[0], outlined.outline, viewOf());
  assert.ok(Math.abs(box.width - "Гостиная".length * box.font * RATIO) < 1e-9, "рамка комнаты не по тексту: " + box.width);
});

test("пока файл шрифта не дошёл, замер не запоминается, а раскладка пересчитывается после", () => {
  const family = "LateFace";
  fontsReady = false;
  const before = measures;
  labelTextWidth("Р1", 12, family, 600);
  labelTextWidth("Р1", 12, family, 600);
  assert.equal(measures - before, 2, "замер запасным шрифтом запомнился");
  const { project, scheme } = scene();
  const view = viewOf({ fontFamily: family });
  const early = labelLayout(project, scheme, null, view);
  assert.equal(labelLayout(project, scheme, null, view), early, "раскладка не кэшируется");

  fontsReady = true;
  const late = labelLayout(project, scheme, null, view);
  assert.notEqual(late, early, "раскладка пережила приход шрифта");
  const after = measures;
  labelTextWidth("Р1", 12, family, 600);
  labelTextWidth("Р1", 12, family, 600);
  assert.equal(measures - after, 0, "замер дошедшим шрифтом не запомнился");
});
