// Тени мебели от ламп и цена кадра «Объёма» (правка после сборки сценариев).
//
// Слова заказчика: «Мебель должна отбрасывать тень от ламп. А так же подумай,
// может можно как-то оптимизировать весь Объём. Это тут макбук очень мощный, а
// мобильные девайсы слабее заметно и уже начинают подлагивать. Главное ничего
// не сломать».
//
// Проверяются чистые швы: тени (`volumeLampShades`, `volumeShadeAlpha`), швы
// пятен (`volumeSeamGrow`), рисование без обводки пятен (`volumeDraw`),
// плотность холста (`volumeRatio`) и снег одной заливкой (`volumeRainDraw`).
import test from "node:test";
import assert from "node:assert/strict";

import {
  addMark,
  addOpening,
  addOutline,
  addRoom,
  addScheme,
  addSchemeObject,
  addWall,
  applyMarkWalls,
  createProject,
  planMmToFraction,
  setPlanOrigin,
  setPlanScale,
  setSchemeWallHeight,
} from "../src/model.js";
import {
  VOLUME_FLOOR_RGB,
  VOLUME_NIGHT_RGB,
  VOLUME_SEAM_GROW_PX,
  volumeDraw,
  volumeFrame,
  volumeLampDecals,
  volumeLampShades,
  volumeLiveLight,
  volumeScene,
  volumeSeamGrow,
  volumeShadeAlpha,
} from "../src/volume.js";
import { VOLUME_RATIO_MAX, volumeRatio } from "../src/panels/volume.js";
import { volumeRainDraw } from "../src/panels/volumeRain.js";

// ——— стенд: гостиная с двумя лампами и коридор за дверью ————————————————
//
// Гостиная −4000…0 по x, коридор 0…2000, обе 3 м в глубину (y −1500…1500);
// перегородка x = 0 с дверью. В гостиной две потолочные лампы, в коридоре одна.

function shadowStand(things = []) {
  const added = addScheme(createProject(), { name: "1 этаж", imageId: "plan-1", width: 1200, height: 800 });
  let project = setPlanScale(added.project, added.scheme.id, { a: { x: 0.1, y: 0.5 }, b: { x: 0.6, y: 0.5 }, meters: 6 }).project;
  project = setPlanOrigin(project, added.scheme.id, { at: { x: 0.5, y: 0.5 }, turn: 0 }).project;
  project = setSchemeWallHeight(project, added.scheme.id, 2700).project;
  const schemeId = added.scheme.id;
  const fr = (point) => planMmToFraction(project, schemeId, point);
  const wall = (a, b) => {
    const put = addWall(project, { schemeId, aMm: a, bMm: b, thicknessMm: 200 });
    project = put.project;
    return put.wall.id;
  };
  const outer = [
    { x: -4000, y: -1500 },
    { x: 2000, y: -1500 },
    { x: 2000, y: 1500 },
    { x: -4000, y: 1500 },
  ];
  outer.forEach((point, index) => wall(point, outer[(index + 1) % outer.length]));
  const middle = wall({ x: 0, y: -1500 }, { x: 0, y: 1500 });
  const rooms = {};
  for (const [key, from, to] of [
    ["living", -3900, -100],
    ["hall", 100, 1900],
  ]) {
    const made = addRoom(project, key);
    project = made.project;
    rooms[key] = made.room.id;
    project = addOutline(project, {
      schemeId,
      roomId: made.room.id,
      points: [{ x: from, y: -1400 }, { x: to, y: -1400 }, { x: to, y: 1400 }, { x: from, y: 1400 }].map(fr),
    }).project;
  }
  const door = addOpening(project, { wallId: middle, kind: "door", atMm: 1000, widthMm: 900, heightMm: 2100, heightAboveFloorMm: 0, hinge: "start", swing: "left" });
  project = door.project;
  const marks = {};
  const lamp = (key, at) => {
    const type = project.markTypes.find((item) => item.code === "С");
    const made = addMark(project, { schemeId, typeId: type.id, kind: "point", points: [fr(at)] });
    project = applyMarkWalls(made.project, schemeId).project;
    marks[key] = made.marks[0].id;
  };
  lamp("east", { x: -2000, y: 0 });
  lamp("west", { x: -3200, y: 0 });
  lamp("hall", { x: 1000, y: 0 });
  const objects = {};
  for (const thing of things) {
    const made = addSchemeObject(project, { schemeId, shape: "rect", ...thing.spec });
    project = made.project;
    objects[thing.key] = made.schemeObject.id;
  }
  const scene = volumeScene(project, schemeId, { roofOff: true, openDoorIds: new Set() });
  return { project, schemeId, rooms, marks, objects, scene, doorId: door.opening.id };
}

/** Состояние дома: `{ключ лампы: яркость}` — горят названные. */
function liveOf(box, lit) {
  const map = new Map();
  for (const [key, id] of Object.entries(box.marks)) {
    const on = lit[key] !== undefined;
    map.set(id, { on, level: on ? lit[key] : 1, kind: "light", roomId: null });
  }
  return map;
}

const NIGHT = { rgb: VOLUME_NIGHT_RGB, share: 0.8 };
const SOFA = { key: "sofa", spec: { catalogKey: "sofa", atMm: { x: -2000, y: -900 }, widthMm: 2200, depthMm: 900, heightMm: 850 } };
const TABLE = { key: "table", spec: { catalogKey: "coffeeTable", atMm: { x: -2600, y: 600 }, widthMm: 1000, depthMm: 600, heightMm: 450 } };

const floorOf = (host) => host.rgb === VOLUME_FLOOR_RGB && host.n.z > 0.9;

// ——— тени ————————————————————————————————————————————————————————————————

test("диван отбрасывает тень от лампы — за собой, на пол и на стену за ним, а не перед собой", () => {
  const box = shadowStand([SOFA]);
  assert.equal(box.scene.occluders.length, 1, "габарит дивана не дошёл до теней");
  const live = liveOf(box, { east: 1 });
  const shades = volumeLampShades(box.scene, live);
  // Геометрия считается на все лампы сразу, горящие или нет (как пятна): здесь
  // — тени восточной.
  const all = [...shades.entries()]
    .map(([host, list]) => [host, list.filter((shade) => shade.markId === box.marks.east)])
    .filter(([, list]) => list.length > 0);
  assert.ok(all.length > 0, "тени нет");
  // Диван — от y −1350 до −450, лампа — над y = 0: тень уходит от лампы к
  // северной стене и не ложится между диваном и лампой.
  const floor = all.filter(([host]) => floorOf(host));
  assert.ok(floor.length > 0, "тени на полу нет");
  for (const [, list] of floor) {
    for (const shade of list) {
      assert.equal(shade.markId, box.marks.east);
      for (const point of shade.p) assert.ok(point.y <= -450 + 1, "тень дивана легла перед ним: y " + point.y);
    }
  }
  assert.ok(floor.some(([, list]) => list.some((shade) => shade.p.some((point) => point.y <= -1350))), "тень не дошла до стены за диваном");
  const wall = all.filter(([host]) => Math.abs(host.n.y) > 0.9 && host.n.y > 0);
  assert.ok(wall.length > 0, "на стену за диваном тень не поднялась");
  // Всё — в гостиной, и на самом диване своей тени нет.
  for (const [host] of all) {
    assert.equal(host.room, box.rooms.living, "тень легла за пределы комнаты лампы");
    assert.notEqual(host.thing, box.objects.sofa, "диван затенил сам себя");
  }
  // Лампа коридора за закрытой дверью тени дивана не даёт.
  const hallOnly = volumeLampShades(box.scene, liveOf(box, { hall: 1 }));
  assert.ok([...hallOnly.values()].every((list) => list.every((shade) => shade.markId !== box.marks.hall)));
});

test("в тени одной лампы кусок — ровно свой цвет без пятна, и тень идёт в кадр сразу за кольцами куска", () => {
  const box = shadowStand([SOFA]);
  const light = volumeLiveLight(box.scene, liveOf(box, { east: 1 }), { physical: true });
  assert.ok(light.shades && light.shades.size > 0, "теней в свете дома нет");
  for (const list of light.shades.values()) {
    for (const shade of list) assert.equal(volumeShadeAlpha(shade, light.lamps), shade.markId === box.marks.east ? 1 : 0);
  }
  // Камера в гостиной смотрит на диван и стену за ним.
  const camera = { at: { x: -2000, y: 1200, z: 1700 }, yaw: -Math.PI / 2, pitch: -0.45 };
  const frameBox = { width: 800, height: 500 };
  const frame = volumeFrame(box.scene, camera, frameBox, null, NIGHT, light);
  // Тень одной лампы — непрозрачный кусок в своём цвете: такой же, как у
  // своего куска перед кольцами.
  const shadows = frame.filter((polygon) => polygon.soft && polygon.fill.startsWith("rgb("));
  assert.ok(shadows.length > 0, "теней в кадре нет");
  for (const shadow of shadows) {
    const at = frame.indexOf(shadow);
    const host = frame
      .slice(0, at)
      .reverse()
      .find((polygon) => polygon.order === shadow.order && !polygon.soft);
    assert.ok(host, "тень легла в кадр раньше своего куска");
    assert.equal(shadow.fill, host.fill, "в тени лампы пол не своего цвета");
  }
  // Без физического света теней нет вовсе.
  const flat = volumeLiveLight(box.scene, liveOf(box, { east: 1 }), { physical: false });
  assert.equal(flat.shades, null);
});

test("две лампы: тень одной снимает только её свет, а под столом, где тени обеих, — темно", () => {
  const box = shadowStand([TABLE]);
  const live = liveOf(box, { east: 1, west: 1 });
  const light = volumeLiveLight(box.scene, live, { physical: true });
  const floor = [...light.shades.entries()].filter(([host]) => floorOf(host));
  // Стол — x −3100…−2100, y 300…900; лампы над y = 0 по обе стороны от него по
  // x. Середина стола: какие тени на неё легли — в порядке кадра.
  const at = { x: -2600, y: 600 };
  const inside = (points) => {
    let hit = false;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      const a = points[i];
      const b = points[j];
      if (a.y > at.y !== b.y > at.y && at.x < ((b.x - a.x) * (at.y - a.y)) / (b.y - a.y) + a.x) hit = !hit;
    }
    return hit;
  };
  const under = floor.find(([host]) => inside(host.p));
  assert.ok(under, "под столом нет куска пола в тени");
  const list = under[1].filter((shade) => inside(shade.p));
  const marks = new Set(list.map((shade) => shade.markId));
  assert.ok(marks.has(box.marks.east) && marks.has(box.marks.west), "под столом не обе тени");
  // Свет, оставшийся после всех теней, — ноль: под столом темно.
  const keep = list.reduce((rest, shade) => rest * (1 - volumeShadeAlpha(shade, light.lamps)), 1);
  assert.ok(keep < 0.02, "под столом светло: осталось " + keep);
  // Тень, куда светит и вторая лампа, снимает не всё.
  const partial = floor.flatMap(([, items]) => items).filter((shade) => shade.gone.length === 0 && shade.mix.length >= 4);
  assert.ok(partial.length > 0, "нет тени, куда светит вторая лампа");
  for (const shade of partial) {
    const alpha = volumeShadeAlpha(shade, light.lamps);
    assert.ok(alpha > 0 && alpha < 1, "тень одной лампы при второй снимает весь свет: " + alpha);
  }
  // Погасла вторая лампа — тень первой снова полная.
  const one = volumeLiveLight(box.scene, liveOf(box, { east: 1 }), { physical: true });
  for (const items of one.shades.values()) for (const shade of items) if (shade.markId === box.marks.east) assert.equal(volumeShadeAlpha(shade, one.lamps), 1);
});

test("лампа внутри вещи тени не даёт; старый объект без мебели — без теней", () => {
  // Шкаф до потолка вокруг лампы: она в нём, как в абажуре.
  const box = shadowStand([{ key: "cabinet", spec: { catalogKey: "cabinet", atMm: { x: -2000, y: 0 }, widthMm: 600, depthMm: 600, heightMm: 2700 } }]);
  const shades = volumeLampShades(box.scene, liveOf(box, { east: 1 }));
  assert.ok([...shades.values()].every((list) => list.every((shade) => shade.markId !== box.marks.east)), "лампа в шкафу затенила комнату шкафом");
  const bare = shadowStand();
  assert.deepEqual(bare.scene.occluders, []);
  assert.equal(volumeLampShades(bare.scene, liveOf(bare, { east: 1, west: 1 })).size, 0);
});

// ——— пятна дешевле ———————————————————————————————————————————————————————

test("кольца, накрывшие кусок целиком, — одним многоугольником на любом куске, не только на вещи", () => {
  const box = shadowStand([SOFA]);
  const decals = volumeLampDecals(box.scene, liveOf(box, { east: 1, west: 1 }));
  let merged = 0;
  for (const [host, list] of decals) {
    const bySource = new Map();
    for (const ring of list) {
      const key = JSON.stringify(ring.p);
      const seen = bySource.get(ring.src) || new Set();
      assert.ok(!seen.has(key), "на куске стопка одинаковых колец одного источника");
      seen.add(key);
      bySource.set(ring.src, seen);
      if (ring.p.length === host.p.length && !host.thing) merged += 1;
    }
  }
  assert.ok(merged > 0, "у стен и пола кольца не сливаются");
});

test("швы пятна — только встык с куском той же комнаты: свет гостиной не раздаётся в коридор", () => {
  const box = shadowStand();
  const decals = volumeLampDecals(box.scene, liveOf(box, { east: 1, west: 1 }));
  let seamed = 0;
  const mine = new Set([box.marks.east, box.marks.west]);
  for (const [host, list] of decals) {
    for (const ring of list) {
      if (!mine.has(ring.markId)) continue;
      for (const index of ring.seams) {
        seamed += 1;
        const a = ring.p[index];
        const b = ring.p[(index + 1) % ring.p.length];
        // Перегородка гостиной с коридором — x = 0: по её оси шва нет.
        assert.ok(!(Math.abs(a.x) < 1 && Math.abs(b.x) < 1), "пятно гостиной раздаётся через ось перегородки");
      }
      assert.equal(host.room, box.rooms.living);
    }
  }
  assert.ok(seamed > 0, "у пятен нет ни одного шва — дерево не режет пол?");
});

test("раздача по шву: обе точки ребра уходят наружу на полточки, остальные стоят", () => {
  // Квадрат 10 × 10 в экранных точках, шов — нижнее ребро (y = 10).
  for (const xy of [
    [0, 0, 10, 0, 10, 10, 0, 10],
    [0, 0, 0, 10, 10, 10, 10, 0],
  ]) {
    const grown = volumeSeamGrow([...xy], [xy[3] === 0 ? 2 : 1]);
    const moved = [];
    for (let index = 0; index < xy.length; index += 2) {
      const dx = grown[index] - xy[index];
      const dy = grown[index + 1] - xy[index + 1];
      if (dx !== 0 || dy !== 0) moved.push([xy[index], xy[index + 1], dx, dy]);
    }
    assert.equal(moved.length, 2, "сдвинулось не две точки");
    for (const [, y, dx, dy] of moved) {
      assert.equal(y, 10);
      assert.ok(Math.abs(dx) < 1e-9 && Math.abs(dy - VOLUME_SEAM_GROW_PX) < 1e-9, "точка шва ушла не наружу: " + dx + ", " + dy);
    }
  }
});

test("рисование: пятна и тени — одна заливка без обводки, грани — заливка с обводкой, как были", () => {
  const log = [];
  const ctx = new Proxy(
    {},
    {
      get: (target, name) => (name in target ? target[name] : (...args) => log.push(String(name))),
      set: (target, name, value) => {
        log.push(String(name) + "=" + value);
        return true;
      },
    },
  );
  volumeDraw(ctx, [
    { xy: [0, 0, 10, 0, 10, 10], fill: "rgb(1,2,3)", soft: false },
    { xy: [0, 0, 10, 0, 10, 10], fill: "rgba(4,5,6,0.3)", soft: true },
  ]);
  const second = log.lastIndexOf("beginPath");
  assert.deepEqual(log.slice(second), ["beginPath", "moveTo", "lineTo", "lineTo", "closePath", "fillStyle=rgba(4,5,6,0.3)", "fill"]);
  const first = log.slice(log.indexOf("beginPath"), second);
  assert.deepEqual(first.slice(-4), ["fillStyle=rgb(1,2,3)", "strokeStyle=rgb(1,2,3)", "fill", "stroke"]);
});

// ——— холст и осадки ——————————————————————————————————————————————————————

test("плотность холста «Объёма» — не больше двух точек на точку стиля", () => {
  assert.equal(VOLUME_RATIO_MAX, 2);
  assert.equal(volumeRatio(3), 2);
  assert.equal(volumeRatio(2.75), 2);
  assert.equal(volumeRatio(2), 2);
  assert.equal(volumeRatio(1.5), 1.5);
  assert.equal(volumeRatio(1), 1);
  for (const bad of [undefined, null, 0, -1, Number.NaN, "x"]) assert.equal(volumeRatio(bad), 1);
});

test("снег — одной заливкой на кадр, дождь — одной обводкой", () => {
  const calls = [];
  const ctx = new Proxy(
    {},
    {
      get: (target, name) => (...args) => calls.push(String(name)),
      set: () => true,
    },
  );
  const drops = Array.from({ length: 50 }, (item, index) => ({ x: index * 10, y: index * 5, size: 2 }));
  volumeRainDraw(ctx, "snow", drops, 0);
  assert.equal(calls.filter((name) => name === "fill").length, 1);
  assert.equal(calls.filter((name) => name === "arc").length, 50);
  calls.length = 0;
  volumeRainDraw(ctx, "rain", drops, 0.5);
  assert.equal(calls.filter((name) => name === "stroke").length, 1);
  assert.equal(calls.filter((name) => name === "fill").length, 0);
});
