// Цвет и яркость лампы (правка после сборки сценариев).
//
// Слова заказчика: «Цветовая температура по умолчанию регулируется в
// диапазоне 50-400 миред. А так же добавь что бы у света можно было менять
// цветовую температуру и оттенок/насыщенность… свечение всегда одно, надо
// поправить»; «по умолчанию светильники умеют всё, если у сервиса включили
// нужную характеристику»; «если у лампочки поставили яркость 0%, то она
// выключается, а, если была выключена и поставили яркость больше 0, то
// включается».
import test from "node:test";
import assert from "node:assert/strict";

import { setMarkDevice } from "../src/model.js";
import { simCharMeta } from "../src/sim/catalog.js";
import { createSimEngine } from "../src/sim/engine.js";
import { buildHomeSpec, markAccessory } from "../src/sim/home.js";
import { simHueRgb, simLiveOf, simMiredRgb } from "../src/sim/live.js";
import { drawMarkLive } from "../src/render.js";
import { VOLUME_GLOW_RGB, volumeLiveLight, volumeRoomTint } from "../src/volume.js";
import { simHouse, simRecorder } from "./fixtures/simHome.js";

const RGB_LAMP = ["On", "Brightness", "ColorTemperature", "Hue", "Saturation", "C_ColorMode"];

function home(chars = RGB_LAMP) {
  const box = simHouse();
  // Светильник умеет то, что включили у его сервиса, — вид не важен.
  box.project = setMarkDevice(box.project, box.marks["С1"], { services: [{ type: "Lightbulb", chars }] }).project;
  const engine = createSimEngine({ emit: simRecorder().emit });
  engine.load(buildHomeSpec(box.project));
  engine.setClock({ simMs: Date.UTC(2026, 9, 23, 12) });
  engine.start();
  const id = box.marks["С1"];
  return {
    box,
    engine,
    set: (char, value) => engine.act({ kind: "set", markId: id, service: 0, char, value }),
    value: (char) => engine.value(id, 0, char),
    accessory: markAccessory(box.project, id),
  };
}

test("цветовая температура — 50…400 миред, как в словаре хаба", () => {
  const meta = simCharMeta("ColorTemperature");
  assert.equal(meta.min, 50);
  assert.equal(meta.max, 400);
});

test("яркость 0 % выключает лампу, больше нуля у выключенной — включает; включённая с нулём вспоминает прежнюю", () => {
  const lamp = home(["On", "Brightness"]);
  lamp.set("On", true);
  lamp.set("Brightness", 30);
  assert.equal(lamp.value("On"), true);
  lamp.set("Brightness", 0);
  assert.equal(lamp.value("On"), false, "яркость 0 % не выключила лампу");
  lamp.set("Brightness", 45);
  assert.equal(lamp.value("On"), true, "яркость у выключенной лампы её не включила");
  lamp.set("Brightness", 0);
  lamp.set("On", true);
  assert.equal(lamp.value("Brightness"), 45, "включённая лампа осталась тёмной");
  // Выключение яркость не трогает.
  lamp.set("On", false);
  assert.equal(lamp.value("Brightness"), 45);
});

test("режим цвета — что меняли последним: оттенок и насыщенность или цветовую температуру", () => {
  const lamp = home();
  lamp.set("Hue", 120);
  assert.equal(lamp.value("C_ColorMode"), "HUE");
  lamp.set("ColorTemperature", 300);
  assert.equal(lamp.value("C_ColorMode"), "TEMPERATURE");
  lamp.set("Saturation", 80);
  assert.equal(lamp.value("C_ColorMode"), "HUE");
});

test("свечение — цветом лампы: оттенок в режиме оттенка, температура в режиме температуры, у лампы без цвета — как было", () => {
  const lamp = home();
  const on = { "0.On": true, "0.Brightness": 100 };
  const hue = simLiveOf(lamp.accessory, { ...on, "0.Hue": 0, "0.Saturation": 100, "0.C_ColorMode": "HUE" });
  assert.deepEqual(hue.color, [255, 0, 0]);
  const warm = simLiveOf(lamp.accessory, { ...on, "0.ColorTemperature": 400, "0.Saturation": 100, "0.C_ColorMode": "TEMPERATURE" });
  assert.deepEqual(warm.color, simMiredRgb(400));
  assert.ok(warm.color[0] > warm.color[2], "400 миред — не тёплый");
  const cold = simMiredRgb(50);
  assert.ok(cold[2] > cold[0], "50 миред — не холодный");
  assert.deepEqual(simHueRgb(240, 0), [255, 255, 255], "без насыщенности — белый");
  // Без режима: оттенок, если насыщенность не ноль, иначе температура.
  const plainHs = home(["On", "Hue", "Saturation", "ColorTemperature"]);
  assert.deepEqual(simLiveOf(plainHs.accessory, { "0.On": true, "0.Hue": 120, "0.Saturation": 100 }).color, [0, 255, 0]);
  assert.deepEqual(simLiveOf(plainHs.accessory, { "0.On": true, "0.Saturation": 0, "0.ColorTemperature": 200 }).color, simMiredRgb(200));
  // Лампа без цвета и погасшая лампа цвета не дают.
  assert.equal(simLiveOf(home(["On", "Brightness"]).accessory, on).color, null);
  assert.equal(simLiveOf(lamp.accessory, { "0.On": false, "0.Hue": 0, "0.Saturation": 100 }).color, null);
});

test("«Объём»: тело лампы, свет комнаты и её пятна — цветом лампы; лампа без цвета — прежний тёплый", () => {
  const red = new Map([["m1", { kind: "light", on: true, level: 1, roomId: "r1", color: [255, 0, 0] }]]);
  const light = volumeLiveLight(null, red, {});
  assert.deepEqual(light.glow.get("m1").rgb, [255, 0, 0]);
  assert.deepEqual(light.colors.get("m1"), [255, 0, 0]);
  const plain = volumeLiveLight(null, new Map([["m1", { kind: "light", on: true, level: 1, roomId: "r1" }]]), {});
  assert.deepEqual(plain.glow.get("m1").rgb, VOLUME_GLOW_RGB);
  assert.equal(plain.colors, undefined);
  assert.equal(plain.roomRgb, undefined);
  const night = { rgb: [20, 24, 40], share: 0.8 };
  const tinted = volumeRoomTint(night, 1, [255, 0, 0]);
  const warm = volumeRoomTint(night, 1);
  assert.ok(tinted.rgb[0] - tinted.rgb[1] > warm.rgb[0] - warm.rgb[1], "красная лампа не покраснила комнату");
  assert.deepEqual(volumeRoomTint(night, 1, null), warm, "без цвета тон комнаты стал другим");
});

test("план: ореол лампы — её цвет", () => {
  const stops = [];
  const ctx = {
    save() {},
    restore() {},
    beginPath() {},
    arc() {},
    fill() {},
    createRadialGradient: () => ({ addColorStop: (at, color) => stops.push(color) }),
  };
  const mark = { id: "m1", kind: "point", points: [{ x: 0.5, y: 0.5 }] };
  const scheme = { id: "s", width: 100, height: 100 };
  const view = { zoom: 1, offsetX: 0, offsetY: 0, markSize: 10, labelSize: 10 };
  drawMarkLive(ctx, null, scheme, mark, view, { kind: "light", on: true, level: 1, color: [0, 128, 255] }, {}, { layer: "glow" });
  assert.ok(stops.length > 0, "ореол не нарисован");
  assert.ok(stops.every((color) => color.startsWith("rgba(0, 128, 255,")), "ореол не цветом лампы: " + stops.join(" "));
});
