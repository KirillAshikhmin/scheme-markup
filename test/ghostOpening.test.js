// Призрак проёма под курсором (таск 203, дефект D55). Слова заказчика: «Сейчас
// при добавлении проёмов\дверей\окон они не отрисовываются под курсором на
// стене, что-то сломалось».
//
// Сломалось не рисование: `drawDrawingOpening` с приметой `ghost` работал всё
// это время, и постановка брала точку у призрака, как ей и велено. Сломался
// **кадр**: таск 187 унёс из колонки узел `subjectNote`, а две записи в него
// остались в ветке призрака разбора движения мыши — и `ReferenceError` рвал
// ветку ровно перед `redraw()`. Призрак считался на каждом шаге курсора и не
// попадал на холст ни разу.
//
// Поэтому здесь закрыто три вещи:
//
//   1) призрак рисуется **тем же кодом**, что вставший проём, — все пять видов;
//   2) слова под кнопками считает одна чистая функция (`workshopModeNote`), и
//      записывает их одно место: ровно на двух записях врозь и погорел T187;
//   3) у призрака и постановки одна дверь — `ghost.opening`, второго счёта
//      места у клика нет.
//
// Общую проверку «имя читается, а объявления ему нет» держит
// `test/danglingNames.test.js` — она и есть тот тест, который поймал бы это
// раньше.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { OPENING_KINDS } from "../src/model.js";
import { drawDrawingOpening, drawingUnitBridge } from "../src/render.js";
import { WORKSHOP_OPENING_DEFAULTS, workshopModeNote, workshopOpeningAt } from "../src/panels/workshop.js";
import { strings } from "../src/strings.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const WORKSHOP_SRC = readFileSync(join(HERE, "..", "src", "panels", "workshop.js"), "utf8");

// Холст-писец: записывает каждый вызов и каждое присваивание — тот же приём,
// которым снят отпечаток призрака вещи (`ghostObject.test.js`).
function scribe() {
  const log = [];
  const impl = { canvas: { width: 1200, height: 900 }, measureText: (value) => ({ width: String(value).length * 7 }) };
  return {
    log,
    ctx: new Proxy(impl, {
      get(target, key) {
        if (key in target) return target[key];
        return (...args) => log.push(String(key) + "(" + args.map((value) => JSON.stringify(value)).join(",") + ")");
      },
      set(target, key, value) {
        log.push(String(key) + "=" + String(value));
        target[key] = value;
        return true;
      },
    }),
  };
}

const wall = { id: "w1", aMm: { x: 0, y: 0 }, bMm: { x: 6000, y: 0 }, thicknessMm: 100 };
const bridge = drawingUnitBridge({ zoom: 0.1, offsetX: 20, offsetY: 400, markSize: 10, labelSize: 12 });

function openingOf(kind) {
  const sizes = WORKSHOP_OPENING_DEFAULTS[kind];
  const draft = { kind, wallId: wall.id, atMm: workshopOpeningAt(wall, { x: 3000, y: 0 }, sizes.widthMm), ...sizes };
  return { ...draft, hinge: "start", swing: "left" };
}

function frameOf(kind, options) {
  const probe = scribe();
  drawDrawingOpening(probe.ctx, bridge, wall, openingOf(kind), options);
  return probe.log;
}

// ——— призрак рисуется тем же кодом, что вставший проём ————————————————————

test("призрак проёма и вставший проём — один кадр с точностью до полсилы цвета", () => {
  for (const kind of OPENING_KINDS) {
    const placed = frameOf(kind, {});
    const ghost = frameOf(kind, { ghost: true });
    assert.ok(placed.length > 0, "вид " + kind + " не рисуется вовсе");
    // Единственная примета призрака у проёма — вполсилы. Пунктира у него нет:
    // пунктиром у проёма рисуется арка, и второй пунктир спутал бы их.
    assert.deepEqual(
      ghost.filter((line) => !/^globalAlpha=/.test(line)),
      placed.filter((line) => !/^globalAlpha=/.test(line)),
      "призрак вида " + kind + " рисуется не тем же кодом, что вставший проём",
    );
    assert.ok(
      ghost.some((line) => /^globalAlpha=0\.\d+$/.test(line)),
      "призрак вида " + kind + " нарисован в полную силу — его не отличить от вставшего",
    );
    // Косяки — две линии поперёк стены — у призрака те же: именно по ним видно,
    // что проём **прижат к стене**, а не висит под курсором сам по себе.
    assert.ok(ghost.filter((line) => line.startsWith("stroke(")).length >= 2, "у призрака " + kind + " нет косяков");
  }
});

test("красный призрак отличается от обычного только краской", () => {
  const ok = frameOf("window", { ghost: true });
  const bad = frameOf("window", { ghost: true, bad: true });
  assert.notDeepEqual(ok, bad, "отказ ничем не виден");
  assert.deepEqual(
    ok.filter((line) => !line.startsWith("strokeStyle=")),
    bad.filter((line) => !line.startsWith("strokeStyle=")),
  );
});

// ——— слова под кнопками: одна чистая функция и одно место записи ——————————

test("строка под кнопками называет причину отказа и краснеет вместе с призраком", () => {
  const refusal = "Проём шире стены: проём 1500 мм, стена 1200 мм";
  assert.deepEqual(workshopModeNote({ mode: "add", tool: "openings", wallCount: 3, refusal }), {
    text: refusal,
    bad: true,
  });
  // Призрак зелёный — обычные слова, без красного.
  assert.deepEqual(workshopModeNote({ mode: "add", tool: "openings", wallCount: 3, refusal: "" }), {
    text: strings.workshop.toolOpeningsHint,
    bad: false,
  });
});

test("проём без стен: сперва стены, и это не отказ призрака", () => {
  const line = workshopModeNote({ mode: "add", tool: "openings", wallCount: 0, refusal: "" });
  assert.deepEqual(line, { text: strings.workshop.openingNeedWall, bad: false });
  // Режим выделения про постановку не говорит вовсе — ни словами, ни красным.
  assert.deepEqual(workshopModeNote({ mode: "select", tool: "openings", wallCount: 0 }), {
    text: strings.workshop.modeSelectHint,
    bad: false,
  });
});

test("у строки под кнопками одна дверь, и ветка призрака зовёт её же", () => {
  // Второй записи в узел быть не должно: именно две записи врозь и разошлись в
  // таске 187 — одна уехала с колонкой, другая осталась в разборе мыши.
  const writes = WORKSHOP_SRC.match(/modeNote\.(?:textContent|classList)/g) || [];
  assert.equal(writes.length, 2, "в `modeNote` пишут не из одного места: " + writes.join(", "));
  assert.match(
    WORKSHOP_SRC,
    /function syncModeNote\(\)\s*\{[\s\S]*?modeNote\.textContent = line\.text;[\s\S]*?modeNote\.classList\.toggle\("is-bad", line\.bad\);/,
    "строку под кнопками пишет не `syncModeNote`",
  );
  // Ветка призрака: пересчитать, написать слова, перерисовать. Без `redraw()`
  // призрак снова считался бы впустую.
  assert.match(
    WORKSHOP_SRC,
    /if \(tool === "openings"\) \{\s*const before = ghostStamp\(\);\s*updateGhost\(mmOf\(event\)\);\s*if \(ghostStamp\(\) !== before\) \{[\s\S]*?syncModeNote\(\);\s*redraw\(\);/,
    "ветка призрака проёма больше не перерисовывает кадр",
  );
});

// ——— одна дверь у призрака и постановки ——————————————————————————————————

test("постановка проёма берёт то, что показал призрак", () => {
  // Клик пересчитывает призрака по точке отпускания и ставит **его** проём:
  // ни места, ни вида, ни створки он не считает заново.
  assert.match(
    WORKSHOP_SRC,
    /if \(tool === "openings"\) \{\s*updateGhost\(mmOf\(event\)\);\s*placeOpening\(\);/,
    "клик по стене больше не пересчитывает призрака перед постановкой",
  );
  assert.match(
    WORKSHOP_SRC,
    /function placeOpening\(\) \{[\s\S]*?workshopTryOpening\(project\(\), ghost\.opening, null\)/,
    "постановка проёма считает место сама, а не берёт его у призрака",
  );
  // Место на стене считает одно `workshopOpeningAt`, и у призрака оно общее с
  // переносом выделенного проёма — своего счёта у постановки нет.
  const spots = WORKSHOP_SRC.match(/workshopOpeningAt\(/g) || [];
  assert.equal(spots.length, 3, "мест, где считается отступ проёма, стало " + spots.length);
});
