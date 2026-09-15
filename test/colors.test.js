// Цвета помещений и категорий: палитра, выдача незанятого цвета и
// преобразования hex ↔ RGB ↔ HSV.
//
// Всё это ошибается молча: палитра с похожими соседями выглядит как палитра,
// а кривой перевод в HSV даёт цвет, который «почти тот же». Поэтому палитра
// проверяется числами, а не на глаз, и ожидаемые значения взяты снаружи:
// таблицы CIE Lab для базовых цветов и формула контраста из WCAG.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ROOM_PALETTE,
  addRoom,
  colorDistance,
  createProject,
  freeColor,
  hexToRgb,
  hsvToRgb,
  randomColor,
  rgbToHex,
  rgbToHsv,
  updateRoom,
} from "../src/model.js";

const HEX_RE = /^#[0-9A-F]{6}$/;

// Относительная яркость по WCAG 2.1 (формула из спецификации, не из кода).
function wcagLuminance(hex) {
  const parts = [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16) / 255);
  const [r, g, b] = parts.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function wcagContrast(hex, other) {
  const a = wcagLuminance(hex);
  const b = wcagLuminance(other);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

test("в палитре хватает цветов на квартиру, и все они разные", () => {
  assert.ok(ROOM_PALETTE.length >= 20, "цветов в палитре: " + ROOM_PALETTE.length);
  for (const color of ROOM_PALETTE) assert.match(color, HEX_RE);
  assert.equal(new Set(ROOM_PALETTE).size, ROOM_PALETTE.length, "цвет повторяется в палитре");
});

test("цвет палитры виден и на белом плане, и на карандашных стенах", () => {
  for (const color of ROOM_PALETTE) {
    assert.ok(wcagContrast(color, "#FFFFFF") >= 2.9, color + " теряется на белом плане");
    assert.ok(wcagContrast(color, "#000000") >= 2.4, color + " сливается с карандашной стеной");
  }
});

// Опорные значения — из таблиц CIE Lab для sRGB (D65): белый L=100,
// чёрный L=0, красный (53,24; 80,09; 67,20), синий (32,30; 79,19; −107,86).
// Отсюда и расстояния: белый/чёрный = 100, красный/синий ≈ 176,3.
test("расстояние между цветами считается в Lab, а не по сырым байтам", () => {
  assert.equal(colorDistance("#123456", "#123456"), 0);
  assert.ok(Math.abs(colorDistance("#FFFFFF", "#000000") - 100) < 0.5, "белый/чёрный");
  assert.ok(Math.abs(colorDistance("#FF0000", "#0000FF") - 176.3) < 1, "красный/синий");
  assert.ok(Math.abs(colorDistance("#FF0000", "#00FF00") - 170.6) < 1, "красный/зелёный");
  // Серые одной яркости, но разные байты: по сырому RGB далеко, в Lab — рядом.
  assert.ok(colorDistance("#808080", "#7F7F7F") < 1, "соседние серые");
});

test("соседние цвета палитры не спутать", () => {
  let worst = { distance: Infinity, pair: "" };
  for (let i = 0; i < ROOM_PALETTE.length; i += 1) {
    for (let j = i + 1; j < ROOM_PALETTE.length; j += 1) {
      const distance = colorDistance(ROOM_PALETTE[i], ROOM_PALETTE[j]);
      if (distance < worst.distance) worst = { distance, pair: ROOM_PALETTE[i] + " и " + ROOM_PALETTE[j] };
    }
  }
  assert.ok(worst.distance >= 22, "слишком похожи: " + worst.pair + " (" + worst.distance.toFixed(1) + ")");
});

// Разобранный вручную пример: #1F6FEB = (31, 111, 235); максимум — синий,
// размах 204, отсюда оттенок 60·((31−111)/204 + 4) = 216,47°,
// насыщенность 204/235 = 0,8681, яркость 235/255 = 0,9216.
test("hex, RGB и HSV переводятся друг в друга", () => {
  assert.deepEqual(hexToRgb("#1F6FEB"), { r: 31, g: 111, b: 235 });
  assert.deepEqual(hexToRgb("  #1f6feb "), { r: 31, g: 111, b: 235 });
  assert.equal(hexToRgb("синий"), null);
  assert.equal(hexToRgb("#1F6FE"), null);
  assert.equal(rgbToHex({ r: 31, g: 111, b: 235 }), "#1F6FEB");
  // Поля R, G, B принимают что угодно — байт обязан остаться байтом.
  assert.equal(rgbToHex({ r: 300, g: -5, b: 12.6 }), "#FF000D");

  const hsv = rgbToHsv({ r: 31, g: 111, b: 235 });
  assert.ok(Math.abs(hsv.h - 216.47) < 0.05, "оттенок: " + hsv.h);
  assert.ok(Math.abs(hsv.s - 0.8681) < 0.001, "насыщенность: " + hsv.s);
  assert.ok(Math.abs(hsv.v - 0.9216) < 0.001, "яркость: " + hsv.v);
  assert.deepEqual(rgbToHsv({ r: 255, g: 0, b: 0 }), { h: 0, s: 1, v: 1 });
  assert.deepEqual(rgbToHsv({ r: 128, g: 128, b: 128 }), { h: 0, s: 0, v: 128 / 255 });

  assert.deepEqual(hsvToRgb({ h: 0, s: 1, v: 1 }), { r: 255, g: 0, b: 0 });
  assert.deepEqual(hsvToRgb({ h: 120, s: 1, v: 128 / 255 }), { r: 0, g: 128, b: 0 });
  assert.deepEqual(hsvToRgb({ h: 0, s: 0, v: 1 }), { r: 255, g: 255, b: 255 });
  // 360° — тот же красный, что и 0°: ползунок оттенка ходит по кругу.
  assert.deepEqual(hsvToRgb({ h: 360, s: 1, v: 1 }), hsvToRgb({ h: 0, s: 1, v: 1 }));
});

test("цвет палитры переживает поездку в HSV и обратно", () => {
  for (const color of ROOM_PALETTE) {
    assert.equal(rgbToHex(hsvToRgb(rgbToHsv(hexToRgb(color)))), color);
  }
});

test("свободный цвет — первый незанятый, а не следующий по кругу", () => {
  assert.equal(freeColor([]), ROOM_PALETTE[0]);
  assert.equal(freeColor([ROOM_PALETTE[0]]), ROOM_PALETTE[1]);
  assert.equal(freeColor([ROOM_PALETTE[0], ROOM_PALETTE[2]]), ROOM_PALETTE[1]);
  // Занятость считается на глаз, а не побайтно: #0F766F от #0F766E не отличить.
  assert.equal(freeColor(["#0F766F"]), ROOM_PALETTE[1]);
  // Чужой цвет и мусор ничего не занимают.
  assert.equal(freeColor(["#FFFFFF", "не цвет", null, ""]), ROOM_PALETTE[0]);
});

test("когда палитра кончилась, повторяется самый редкий цвет", () => {
  assert.equal(freeColor([...ROOM_PALETTE]), ROOM_PALETTE[0]);
  assert.equal(freeColor([...ROOM_PALETTE, ROOM_PALETTE[0]]), ROOM_PALETTE[1]);
  assert.equal(freeColor([...ROOM_PALETTE, ROOM_PALETTE[0], ROOM_PALETTE[1]]), ROOM_PALETTE[2]);
});

test("новая комната берёт незанятый цвет, освободившийся — снова в дело", () => {
  let project = createProject({ name: "Тест" });
  const rooms = [];
  for (const name of ["Кухня", "Спальная", "Гостиная", "Ванная"]) {
    const added = addRoom(project, name);
    project = added.project;
    rooms.push(added.room);
  }
  assert.deepEqual(rooms.map((room) => room.color), ROOM_PALETTE.slice(0, 4));

  // Вторую комнату перекрасили вручную — её цвет палитры снова свободен.
  project = updateRoom(project, rooms[1].id, { color: "#112233" }).project;
  const next = addRoom(project, "Холл");
  assert.equal(next.room.color, ROOM_PALETTE[1]);
});

// Свой генератор вместо Math.random: падение должно повторяться, а не
// «иногда краснеть».
function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test("случайный цвет годится для плана и не повторяет занятые", () => {
  const busy = ROOM_PALETTE.slice(0, 6);
  for (let seed = 1; seed <= 60; seed += 1) {
    const color = randomColor(busy, { random: seededRandom(seed) });
    assert.match(color, HEX_RE, "семя " + seed);
    assert.ok(wcagContrast(color, "#FFFFFF") >= 2.9, color + " теряется на белом плане (семя " + seed + ")");
    assert.ok(wcagContrast(color, "#000000") >= 2.4, color + " сливается со стеной (семя " + seed + ")");
    for (const taken of busy) {
      assert.ok(colorDistance(color, taken) >= 22, color + " повторяет занятый " + taken + " (семя " + seed + ")");
    }
  }
});

test("случайный цвет воспроизводится: тот же генератор — тот же цвет", () => {
  assert.equal(randomColor([], { random: seededRandom(7) }), randomColor([], { random: seededRandom(7) }));
  assert.notEqual(randomColor([], { random: seededRandom(7) }), randomColor([], { random: seededRandom(8) }));
  // Генератор-пустышка не даёт ни одного годного цвета — возвращается
  // свободный цвет палитры, а не мусор.
  assert.equal(randomColor([ROOM_PALETTE[0]], { random: () => 0 }), ROOM_PALETTE[1]);
});
