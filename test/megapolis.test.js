// Фон «Мегаполис» (правка без автопилота, 2026-11-20). Слова заказчика:
// «спроектировал новый вид фона "Мегаполис"» — и снимок большого города с
// высоты: кластер небоскрёбов вдали, плотная застройка, улицы.
import test from "node:test";
import assert from "node:assert/strict";
import {
  VOLUME_BACKDROP_KINDS,
  volumeBackdropKindOf,
  volumeCityWindowLit,
  volumeDrawBackdrop,
  volumeMood,
} from "../src/volume.js";
import { volumeMegaPlaces } from "../src/volume/backdrop.js";
import {
  VOLUME_MEGA_BLOCKS,
  VOLUME_MEGA_TOWERS,
  volumeDrawMegaBlock,
  volumeMegaLevels,
} from "../src/volume/megapolis.js";

const DAY_TIMES = { sunrise: 360, sunset: 1260 };

function counter() {
  const ops = { fill: 0, rect: 0, fade: 0 };
  const ctx = new Proxy(
    { fillStyle: "", strokeStyle: "", lineWidth: 1, globalAlpha: 1 },
    {
      get(target, key) {
        if (key in target) return target[key];
        if (key === "fill") return () => (ops.fill += 1);
        if (key === "fillRect") return () => (ops.rect += 1);
        if (key === "createLinearGradient" || key === "createRadialGradient") {
          return () => {
            ops.fade += 1;
            return { addColorStop: () => {} };
          };
        }
        return () => {};
      },
      set(target, key, value) {
        target[key] = value;
        return true;
      },
    },
  );
  return { ctx, ops };
}

test("«Мегаполис» — четвёртый вид фона; незнакомый вид по-прежнему читается «Природой»", () => {
  assert.deepEqual(VOLUME_BACKDROP_KINDS, ["plain", "nature", "city", "megapolis"]);
  assert.equal(volumeBackdropKindOf("megapolis"), "megapolis");
  assert.equal(volumeBackdropKindOf("такого нет"), "nature");
  assert.equal(volumeMood({ minutes: 900, times: DAY_TIMES, kind: "megapolis" }).kind, "megapolis");
});

test("таблицы: дома не лезут к объекту, башни стоят вдали, силуэты сложены снизу вверх", () => {
  const places = volumeMegaPlaces();
  assert.equal(places.blocks.length, VOLUME_MEGA_BLOCKS.length);
  assert.ok(places.blocks.length >= 60, "застройка редкая: " + places.blocks.length);
  for (const block of places.blocks) {
    // Ближний угол дома — не ближе пятидесяти метров от середины чертежа.
    assert.ok(block.awayMm - Math.hypot(block.halfMm, block.deepMm / 2) > 50000, "дом у самого объекта: " + block.awayMm);
    assert.equal(block.floors, Math.max(2, Math.round(block.heightMm / 3400)));
  }
  for (const [, away, , height, shape] of VOLUME_MEGA_TOWERS) {
    assert.ok(away >= 2500 && height >= 150, "башня кластера близко или низко");
    const levels = volumeMegaLevels(shape);
    assert.equal(levels[0].z, 0);
    assert.equal(levels[levels.length - 1].z, 1);
    for (let at = 1; at < levels.length; at += 1) assert.ok(levels[at].z >= levels[at - 1].z, shape + ": уровни не по порядку");
    for (const level of levels) assert.ok(level.l <= level.r && level.l >= -1 && level.r <= 1, shape + ": край за габаритом");
  }
});

test("дом стоит семь заливок при любой этажности — и днём, и ночью", () => {
  const point = (x, y, z) => ({ x: x / 100, y: 400 - (z || 0) / 100 + y / 1000, scale: 0.01, depth: 1 });
  for (const minutes of [900, 60]) {
    const hour = volumeMood({ minutes, times: DAY_TIMES, kind: "megapolis" });
    for (const floors of [5, 30, 70]) {
      const { ctx, ops } = counter();
      const block = { x: 80000, y: 30000, halfMm: 15000, deepMm: 16000, heightMm: floors * 3400, floors, tone: 1 };
      volumeDrawMegaBlock(ctx, point, { x: 0, y: 0 }, block, 3, hour, volumeCityWindowLit);
      assert.ok(ops.fill >= 3 && ops.fill <= 7, floors + " этажей: заливок " + ops.fill);
      assert.equal(ops.rect, 0, "окна рисуются поимённо");
    }
  }
});

test("цена кадра: мегаполис с земли и с высоты укладывается в потолок заливок", () => {
  const box = { width: 1600, height: 900 };
  for (const [name, z, minutes] of [["с земли днём", 1600, 900], ["с высоты днём", 70000, 900], ["с высоты ночью", 70000, 60]]) {
    const mood = volumeMood({ minutes, times: DAY_TIMES, kind: "megapolis" });
    let worst = 0;
    for (const yaw of [0, 30, 90, 150, 210, 270, 330]) {
      const { ctx, ops } = counter();
      volumeDrawBackdrop(ctx, box, { at: { x: 0, y: 0, z }, yaw: (yaw * Math.PI) / 180, pitch: -0.1 }, mood, null);
      worst = Math.max(worst, ops.fill + ops.rect);
    }
    // Потолок с запасом к замеру на день правки; вырос — прореживать средний
    // план или заводить уровни подробности, а не поднимать число молча.
    assert.ok(worst > 60, name + ": город не нарисовался (" + worst + ")");
    assert.ok(worst <= 520, name + ": заливок в кадре " + worst);
  }
});

test("остальные фоны мегаполиса не заметили: их счёт заливок прежний по порядку величины", () => {
  const box = { width: 1600, height: 900 };
  const count = (kind) => {
    const { ctx, ops } = counter();
    volumeDrawBackdrop(ctx, box, { at: { x: 0, y: 0, z: 1600 }, yaw: 0.5, pitch: -0.08 }, volumeMood({ minutes: 900, times: DAY_TIMES, kind }), null);
    return ops.fill + ops.rect;
  };
  assert.ok(count("plain") < 20);
  assert.ok(count("megapolis") > count("plain") * 5);
  assert.ok(count("nature") > count("plain") * 3);
});
