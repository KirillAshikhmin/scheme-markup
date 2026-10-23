// Мини-план режима «Сценарии» (таск 10 сценариев; истории 4.22, 4.23).
//
// Держит чистую половину: какую схему показать при выборе метки, как план
// вписан в рамку, какая метка лежит под щелчком, как строится кадр состояния
// дома и что состояния и подсветка рисуются только тогда, когда есть что
// показать.
import test from "node:test";
import assert from "node:assert/strict";

import {
  MINI_PLAN_MARK_PX,
  miniPlanKinds,
  miniPlanLiveFrame,
  miniPlanMarkAt,
  miniPlanPaint,
  miniPlanSchemeFor,
  miniPlanSchemes,
  miniPlanView,
} from "../src/panels/miniPlan.js";
import { addScheme, addMark } from "../src/model.js";
import { markAccessory } from "../src/sim/home.js";
import { markRadius, planToScreen } from "../src/render.js";
import { simHouse } from "./fixtures/simHome.js";

const house = simHouse();
const { project, marks } = house;
const scheme = project.schemes[0];
const BOX = { width: 400, height: 300 };

function scribe(log) {
  return new Proxy(
    {},
    {
      get(_target, key) {
        if (key === "canvas") return { width: BOX.width, height: BOX.height };
        if (key === "measureText") return (value) => ({ width: String(value).length * 6 });
        if (key === "createRadialGradient") return () => ({ addColorStop: () => {} });
        return (...args) => log.push(key + "(" + args.map((item) => (typeof item === "number" ? Math.round(item) : "?")).join(",") + ")");
      },
      set() {
        return true;
      },
    },
  );
}

test("выбранная метка на другом этаже переключает мини-план на её схему", () => {
  const second = addScheme(project, { name: "2 этаж", width: 600, height: 400 });
  const upstairs = addMark(second.project, {
    schemeId: second.scheme.id,
    typeId: project.marks.find((mark) => mark.id === marks.С1).typeId,
    kind: "point",
    points: [{ x: 0.5, y: 0.5 }],
  });
  assert.equal(miniPlanSchemeFor(upstairs.project, upstairs.mark.id, scheme.id), second.scheme.id);
  // Метка на открытом этаже, неизвестная метка и пустой выбор — оставить как есть.
  assert.equal(miniPlanSchemeFor(upstairs.project, marks.С1, scheme.id), null);
  assert.equal(miniPlanSchemeFor(upstairs.project, "нет", scheme.id), null);
  assert.equal(miniPlanSchemeFor(upstairs.project, null, scheme.id), null);
  assert.deepEqual(miniPlanSchemes(upstairs.project).map((item) => item.name), ["1 этаж", "2 этаж"]);
  assert.deepEqual(miniPlanSchemes(null), []);
});

test("план вписан в рамку целиком, а метка на нём не мельче читаемой", () => {
  const view = miniPlanView(project, scheme, BOX);
  const corner = planToScreen({ x: 1, y: 1 }, scheme, view);
  const origin = planToScreen({ x: 0, y: 0 }, scheme, view);
  assert.ok(origin.x >= 0 && origin.y >= 0, "план выходит за левый-верхний край рамки");
  assert.ok(corner.x <= BOX.width && corner.y <= BOX.height, "план выходит за правый-нижний край рамки");
  assert.ok(markRadius(view) >= MINI_PLAN_MARK_PX - 1e-9, "метка мельче читаемой: " + markRadius(view));
  // Рамка нулевая — план не пропадает в NaN.
  const flat = miniPlanView(project, scheme, { width: 0, height: 0 });
  assert.ok(Number.isFinite(flat.zoom) && flat.zoom > 0);
});

test("щелчок: под точкой метки — её устройство, мимо — ничего", () => {
  const view = miniPlanView(project, scheme, BOX);
  // Телевизор стоит в стороне от соседей: рядом метки с общими подписями
  // перекрывали бы друг друга уже на рамке в четыреста точек.
  const mark = project.marks.find((item) => item.id === marks.ТВ1);
  const at = planToScreen(mark.points[0], scheme, view);
  assert.equal(miniPlanMarkAt(project, scheme, at, view, undefined), marks.ТВ1);
  assert.equal(miniPlanMarkAt(project, scheme, { x: 2, y: BOX.height - 2 }, view, undefined), null);
  // Знаки теснятся (С1, В1 и ДД1 стоят в тринадцати точках друг от друга):
  // щелчок в центр выбирает ту метку, в которую целились, а не верхнюю из накрывших.
  for (const name of ["С1", "В1", "ДД1"]) {
    const near = project.marks.find((item) => item.id === marks[name]);
    assert.equal(miniPlanMarkAt(project, scheme, planToScreen(near.points[0], scheme, view), view, undefined), marks[name], name);
  }
});

test("метка без аксессуара устройством не выбирается", () => {
  const view = miniPlanView(project, scheme, BOX);
  // Точечный тип, у которого аксессуара нет (щит, например), ищем в справочнике.
  let bare = null;
  for (const type of project.markTypes) {
    if (type.kind === "line") continue;
    const added = addMark(project, { schemeId: scheme.id, typeId: type.id, kind: "point", points: [{ x: 0.9, y: 0.9 }] });
    if (!markAccessory(added.project, added.mark.id)) {
      bare = added;
      break;
    }
  }
  assert.ok(bare, "в справочнике нет точечного типа без аксессуара — тест не на чем проверять");
  const at = planToScreen(bare.mark.points[0], scheme, view);
  assert.equal(miniPlanMarkAt(bare.project, scheme, at, view, undefined), null);
});

test("виды знаков состояния — по меткам-устройствам объекта", () => {
  const kinds = miniPlanKinds(project);
  assert.equal(kinds.get(marks.С1), "light");
  assert.equal(kinds.get(marks.КШ1), "curtain");
  assert.equal(kinds.get(marks.ТВ1), "tv");
  assert.equal(kinds.get(marks.Р1), "outlet");
  assert.equal(kinds.get(marks.ДД1), "other");
});

test("кадр дома: вид знака приложен, пульс идёт у сработавшего датчика, вспышка гаснет", () => {
  const source = new Map([
    [marks.С1, { on: true, level: 1, alert: false, open: 0, pressedAt: null }],
    [marks.ДД1, { on: false, level: 0, alert: true, open: 0, pressedAt: null }],
    [marks.В1, { on: false, level: 0, alert: false, open: 0, pressedAt: 5000 }],
  ]);
  const kinds = miniPlanKinds(project);
  const flash = new Map();
  const first = miniPlanLiveFrame(source, kinds, flash, 10_000);
  assert.equal(first.live.get(marks.С1).kind, "light");
  assert.equal(first.live.get(marks.ДД1).alert, true);
  assert.equal(first.animate, true);
  assert.ok(first.fx.flash.get(marks.В1) > 0.99, "вспышка только началась");
  // Через 350 мс (полвспышки) — угасла наполовину; через секунду — нет вспышки.
  const half = miniPlanLiveFrame(source, kinds, flash, 10_350);
  assert.ok(Math.abs(half.fx.flash.get(marks.В1) - 0.5) < 0.01);
  const late = miniPlanLiveFrame(source, kinds, flash, 11_100);
  assert.equal(late.fx.flash.has(marks.В1), false);
  // Спокойный дом — кадр больше не нужен.
  const calm = miniPlanLiveFrame(new Map([[marks.С1, { on: true, level: 1, alert: false, open: 0, pressedAt: null }]]), kinds, new Map(), 0);
  assert.equal(calm.animate, false);
});

test("рисование: состояния — только при запущенном доме, кольцо — только подсвеченным", () => {
  const frame = (extra) => {
    const log = [];
    const rings = miniPlanPaint(scribe(log), { project, scheme, box: BOX, ...extra });
    return { log, rings };
  };
  const plain = frame({});
  assert.equal(plain.rings, 0);
  // Состояния дома добавляют ореол свету — вызовов холста становится больше.
  const live = new Map([[marks.С1, { on: true, level: 1, alert: false, open: 0, pressedAt: null, kind: "light" }]]);
  const lit = frame({ live, liveFx: { pulse: 0, flash: new Map() } });
  assert.ok(lit.log.length > plain.log.length, "включённый свет не добавил ни одного вызова");
  // Подсветка блока: найденная на этаже метка получает кольцо, чужая — нет.
  const ringed = frame({ highlight: [marks.С1, "нет-такой-метки"] });
  assert.equal(ringed.rings, 1);
  assert.ok(ringed.log.length > plain.log.length);
  // Нет схемы — рамка очищена и ничего больше.
  const empty = [];
  assert.equal(miniPlanPaint(scribe(empty), { project, scheme: null, box: BOX }), 0);
  assert.deepEqual(empty, ["clearRect(0,0,400,300)"]);
});
