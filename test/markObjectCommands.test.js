// Команды связи метки и вещи чертежа (требования R01, R01.1, R01.3, R01.5, R04.1, G10.1).
//
// Холст и карточка не собираются без DOM, поэтому здесь держится то, что
// проверяется без него: правило гашения команды (право + причина), список
// вещей для связи, предложение связать при постановке метки на вещь, номер и
// имя вещи в модели карточки, и то, что каждая команда пишет только через
// `canvasCommit` со своим ярлыком.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  addMark,
  addScheme,
  addSchemeObject,
  createProject,
  setMarkObject,
  setPlanOrigin,
  setPlanScale,
} from "../src/model.js";
import {
  CANVAS_MODE_BLOCK_JOIN,
  canvasHintText,
  canvasLinkCandidates,
  canvasLinkOffer,
  canvasObjectAt,
  canvasObjectJoining,
  canvasObjectLinkCan,
} from "../src/canvas.js";
import { markCardModel } from "../src/panels/markCard.js";
import { strings } from "../src/strings.js";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src");

// План 1200 × 800 точек, в метре 100 точек: тысяча мм = 0,0833 доли по ширине.
function scene() {
  const added = addScheme(createProject({ name: "Связь" }), { name: "1 этаж", imageId: "plan-1", width: 1200, height: 800 });
  const schemeId = added.scheme.id;
  let project = setPlanScale(added.project, schemeId, { a: { x: 0.1, y: 0.5 }, b: { x: 0.6, y: 0.5 }, meters: 6 }).project;
  project = setPlanOrigin(project, schemeId, { at: { x: 0, y: 0 }, turn: 0 }).project;
  return { project, schemeId };
}

function thing(base, patch = {}) {
  const added = addSchemeObject(base.project, {
    schemeId: base.schemeId,
    catalogKey: "tv",
    shape: "rect",
    atMm: { x: 2000, y: 1000 },
    widthMm: 1000,
    depthMm: 500,
    heightMm: 700,
    heightAboveFloorMm: 500,
    turnDeg: 0,
    ...patch,
  });
  return { project: added.project, object: added.schemeObject };
}

function markAt(project, schemeId, code, point) {
  const type = project.markTypes.find((item) => item.code === code);
  return addMark(project, { schemeId, typeId: type.id, kind: "point", points: [point] });
}

const stateOf = (project, patch = {}) => ({ project, layout: "desktop", mode: "select", selectedMarkIds: [], ...patch });

test("команда связи гаснет с причиной: просмотр, запущенный дом, чужая схема, занятая вещь", () => {
  const base = scene();
  const { project, object } = thing(base);
  const mark = markAt(project, base.schemeId, "ТВ", { x: 0.3, y: 0.3 });

  assert.deepEqual(canvasObjectLinkCan(stateOf(mark.project), mark.mark.id, object.id), { ok: true });

  const viewing = canvasObjectLinkCan(stateOf(mark.project, { layout: "mobile" }), mark.mark.id, object.id);
  assert.equal(viewing.ok, false);
  assert.equal(viewing.why, strings.markObject.whyLocked, "просмотр закрыт без причины");

  // Дом запущен на «Схеме» — та же дверь, что у прочих правок.
  const running = canvasObjectLinkCan(
    stateOf(mark.project, { simRunning: true, screen: "scheme" }),
    mark.mark.id,
    object.id,
  );
  assert.equal(running.ok, false, "при запущенном доме связать можно");

  const other = addScheme(mark.project, { name: "2 этаж", width: 1000, height: 500 });
  const second = markAt(other.project, other.scheme.id, "ТВ", { x: 0.2, y: 0.2 });
  const foreign = canvasObjectLinkCan(stateOf(second.project), second.mark.id, object.id);
  assert.equal(foreign.ok, false);
  assert.equal(foreign.why, strings.markObject.whyOtherScheme);

  const taken = setMarkObject(mark.project, mark.mark.id, object.id).project;
  const rival = markAt(taken, base.schemeId, "ТВ", { x: 0.5, y: 0.5 });
  const busy = canvasObjectLinkCan(stateOf(rival.project), rival.mark.id, object.id);
  assert.equal(busy.ok, false);
  assert.match(busy.why, /уже связана/);
});

test("к связи предлагаются только свободные вещи схемы метки", () => {
  const base = scene();
  const first = thing(base);
  const second = thing({ project: first.project, schemeId: base.schemeId }, { atMm: { x: 5000, y: 3000 } });
  const mark = markAt(second.project, base.schemeId, "ТВ", { x: 0.9, y: 0.9 });
  assert.deepEqual(
    canvasLinkCandidates(mark.project, mark.mark.id).map((item) => item.id).sort(),
    [first.object.id, second.object.id].sort(),
  );
  const linked = setMarkObject(mark.project, mark.mark.id, first.object.id).project;
  const other = markAt(linked, base.schemeId, "ТВ", { x: 0.8, y: 0.8 });
  assert.deepEqual(canvasLinkCandidates(other.project, other.mark.id).map((item) => item.id), [second.object.id]);
});

test("метка, поставленная на вещь, получает предложение связать; мимо вещи, на чужую и связанная — нет", () => {
  const base = scene();
  const { project, object } = thing(base);
  // Вещь на 2000 × 1000 мм при 100 точках в метре: центр — (200; 100) точки,
  // то есть доли (0,1667; 0,125).
  const inside = markAt(project, base.schemeId, "ТВ", { x: 200 / 1200, y: 100 / 800 });
  assert.equal(canvasLinkOffer(inside.project, inside.mark.id).id, object.id);

  const outside = markAt(project, base.schemeId, "ТВ", { x: 0.8, y: 0.8 });
  assert.equal(canvasLinkOffer(outside.project, outside.mark.id), null, "предложение мимо вещи");

  // Из двух вещей под меткой выбирается меньшая: телевизор на тумбе, а не тумба.
  const big = thing({ project: inside.project, schemeId: base.schemeId }, { widthMm: 3000, depthMm: 2000 });
  const onTumba = markAt(big.project, base.schemeId, "ТВ", { x: 200 / 1200, y: 100 / 800 });
  assert.equal(canvasLinkOffer(onTumba.project, onTumba.mark.id).id, object.id);

  // Уже связанной метке предлагать нечего.
  const linked = setMarkObject(inside.project, inside.mark.id, object.id).project;
  assert.equal(canvasLinkOffer(linked, inside.mark.id), null);

  // Без моста мм ↔ доли — догадку не показывают.
  const bare = addScheme(createProject(), { name: "Без масштаба", width: 1200, height: 800 });
  const barePlaced = thing({ project: bare.project, schemeId: bare.scheme.id });
  const bareMark = markAt(barePlaced.project, bare.scheme.id, "ТВ", { x: 0.2, y: 0.2 });
  assert.equal(canvasLinkOffer(bareMark.project, bareMark.mark.id), null);
});

test("карточка метки: номер рядом с обозначением и имя связанной вещи", () => {
  const base = scene();
  const { project, object } = thing(base);
  const mark = markAt(project, base.schemeId, "ТВ", { x: 0.2, y: 0.15 });
  const bare = markCardModel(mark.project, mark.mark.id);
  assert.equal(bare.number, mark.mark.id, "номер метки не в карточке");
  assert.equal(
    bare.rows.some((row) => row.label === strings.markCard.objectRow.label),
    false,
    "у несвязанной метки есть строка вещи",
  );
  const linked = setMarkObject(mark.project, mark.mark.id, object.id).project;
  const card = markCardModel(linked, mark.mark.id);
  const row = card.rows.find((item) => item.label === strings.markCard.objectRow.label);
  assert.ok(row && row.value.length > 0, "имя связанной вещи не показано");
});

test("команды связи пишут только через canvasCommit и каждая — своим ярлыком", () => {
  const source = readFileSync(join(SRC, "canvas.js"), "utf8");
  const bodyOf = (head) => {
    const from = source.indexOf(head);
    assert.ok(from > 0, "пропала дверь: " + head);
    const rest = source.slice(from);
    return rest.slice(0, rest.indexOf("\n}\n"));
  };
  const doors = [
    ["export function canvasLinkMarkObject(", "strings.history.markObjectLink"],
    ["export function canvasUnlinkMarkObject(", "strings.history.markObjectUnlink"],
    ["export function canvasObjectDeviceMake(", "strings.history.objectDeviceMake"],
    ["export function canvasObjectDeviceDrop(", "strings.history.objectDeviceDrop"],
  ];
  for (const [head, label] of doors) {
    const body = bodyOf(head);
    assert.ok(body.includes("canvasCommit("), head + " пишет мимо canvasCommit");
    assert.ok(body.includes(label), head + " без своего ярлыка истории");
    assert.ok(body.includes("canvasEditAllowed(state)") || body.includes("canvasObjectLinkCan("), head + " без двери прав");
    assert.equal(body.includes("setState({ project"), false, head + " кладёт объект напрямую");
  }
  // Предложение при постановке метки идёт из постановки точки.
  assert.ok(bodyOf("function canvasPlacePoint(").includes("canvasOfferLink("), "постановка не предлагает связать");
});

test("ожидание вещи — готовый режим блока с отметкой; щелчок находит меньшую накрывающую вещь", () => {
  const base = scene();
  const small = thing(base);
  const big = thing({ project: small.project, schemeId: base.schemeId }, { widthMm: 3000, depthMm: 2000 });
  const mark = markAt(big.project, base.schemeId, "ТВ", { x: 0.7, y: 0.7 });
  const centre = { x: 200 / 1200, y: 100 / 800 };
  assert.equal(canvasObjectAt(mark.project, base.schemeId, centre).id, small.object.id);
  assert.equal(canvasObjectAt(mark.project, base.schemeId, centre, [small.object.id]).id, big.object.id, "спрятанная вещь ловится");
  assert.equal(canvasObjectAt(mark.project, base.schemeId, { x: 0.95, y: 0.95 }), null);

  const waiting = stateOf(mark.project, { mode: CANVAS_MODE_BLOCK_JOIN, blockJoinWhat: "object", schemeId: base.schemeId, selectedMarkIds: [mark.mark.id] });
  assert.equal(canvasObjectJoining(waiting, mark.mark.id), true);
  assert.equal(canvasObjectJoining({ ...waiting, blockJoinWhat: null }, mark.mark.id), false, "ожидание блока принято за ожидание вещи");
  assert.match(canvasHintText(waiting), /вещью/);
});

test("предложение связать приходит и после переноса метки на вещь", () => {
  const source = readFileSync(join(SRC, "canvas.js"), "utf8");
  const at = source.indexOf("canvasMoveStepLabel(drag.before, drag)");
  assert.ok(at > 0);
  assert.ok(source.slice(at, at + 1200).includes("canvasOfferLink(drag.markId)"), "перенос не предлагает связать");
});

// Полосу (`shape: "polyline"`) — столешницу с подсветкой, плинтус — модель
// связывать разрешает (`markObjectCan`, `markPlace`, `canvasLinkCandidates`), а
// щелчок и подсветка её пропускали: на схеме, где вещи нарисованы полосами,
// кнопка горела, подсветки не было, и любой щелчок отвечал «здесь нет вещи
// чертежа» — тупик без выхода, кроме Esc.
test("полоса ловится щелчком и предлагается связи, как всякая вещь", () => {
  const base = scene();
  // Полоса шириной 600 мм по отрезку (1000;1000) — (4000;1000).
  const band = addSchemeObject(base.project, {
    schemeId: base.schemeId,
    catalogKey: "counter",
    shape: "polyline",
    pointsMm: [{ x: 1000, y: 1000 }, { x: 4000, y: 1000 }],
    depthMm: 600,
    heightMm: 40,
    heightAboveFloorMm: 850,
  });
  // Метка стоит на полосе: 2500 мм при 100 точках на метр — доля 250/1200,
  // 1000 мм — доля 100/800.
  const onBand = { x: 250 / 1200, y: 100 / 800 };
  const mark = markAt(band.project, base.schemeId, "Р", onBand);

  assert.ok(
    canvasLinkCandidates(mark.project, mark.mark.id).some((item) => item.id === band.schemeObject.id),
    "полоса не в кандидатах — пример не тот",
  );
  assert.equal(canvasObjectAt(mark.project, base.schemeId, onBand).id, band.schemeObject.id, "щелчок по полосе не нашёл вещи");
  assert.equal(canvasLinkOffer(mark.project, mark.mark.id).id, band.schemeObject.id, "связь с полосой не предложена");
  assert.equal(canvasObjectLinkCan(stateOf(mark.project, { schemeId: base.schemeId }), mark.mark.id, band.schemeObject.id).ok, true);

  // Мимо полосы — по-прежнему ничего: ширина у неё 600 мм, то есть ±300 от оси.
  const past = { x: 250 / 1200, y: 160 / 800 };
  assert.equal(canvasObjectAt(mark.project, base.schemeId, past), null, "щелчок в 600 мм от полосы нашёл вещь");

  // Из накрывших берётся меньшая: у полосы площадь считается длиной на ширину,
  // а не `widthMm * depthMm` (у неё ширины нет вовсе, и выходил `NaN`).
  const big = addSchemeObject(band.project, {
    schemeId: base.schemeId,
    catalogKey: "tv",
    shape: "rect",
    atMm: { x: 2500, y: 1000 },
    widthMm: 4000,
    depthMm: 3000,
    heightMm: 700,
    heightAboveFloorMm: 0,
  });
  assert.equal(canvasObjectAt(big.project, base.schemeId, onBand).id, band.schemeObject.id, "вещь побольше отобрала щелчок у полосы");
});
