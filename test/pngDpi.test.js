// Физический размер в файле PNG: chunk `pHYs`.
//
// Проверять тут нужно две разные вещи, и они не заменяют друг друга: что
// разрешение **записано** по спецификации (иначе файл не откроется или
// откроется без разрешения) и что картинка при этом **не изменилась ни на
// байт** (иначе правка миллиметров тихо переписала бы содержимое листа).
//
// CRC32 здесь считается своей реализацией, а не берётся из `projectFile.js`:
// сверять код с ним же самим — значит проверить, что он равен себе. Числа в
// проверках тоже написаны руками.
import test from "node:test";
import assert from "node:assert/strict";
import { deflateSync } from "node:zlib";

import { pngDpiOf, pngPhysChunk, pngPixelsPerMetre, pngWithDpi } from "../src/pngDpi.js";

// ——— свой CRC32 и свой разбор файла ————————————————————————————————————

const CRC_TABLE = [...Array(256)].map((_, n) => {
  let value = n;
  for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

function crc(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) value = CRC_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

function chunks(bytes) {
  const out = [];
  let at = 8;
  while (at + 8 <= bytes.length) {
    const view = new DataView(bytes.buffer, bytes.byteOffset);
    const length = view.getUint32(at);
    const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8));
    out.push({
      type,
      at,
      length,
      data: bytes.subarray(at + 8, at + 8 + length),
      crc: view.getUint32(at + 8 + length),
      body: bytes.subarray(at + 4, at + 8 + length),
    });
    at += length + 12;
    if (type === "IEND") break;
  }
  return out;
}

// Настоящий маленький PNG: подпись, IHDR, два IDAT и IEND. Два куска данных —
// не придирка: `canvas.toBlob` в Chrome пишет именно несколько IDAT подряд, и
// вставка не должна их склеить, переставить или потерять.
function samplePng({ withPhys = false } = {}) {
  const parts = [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])];
  const chunk = (type, data) => {
    const out = new Uint8Array(data.length + 12);
    const view = new DataView(out.buffer);
    view.setUint32(0, data.length);
    out.set([...type].map((ch) => ch.charCodeAt(0)), 4);
    out.set(data, 8);
    view.setUint32(data.length + 8, crc(out.subarray(4, data.length + 8)));
    return out;
  };
  const header = new Uint8Array(13);
  const headerView = new DataView(header.buffer);
  headerView.setUint32(0, 4);
  headerView.setUint32(4, 2);
  header[8] = 8;
  header[9] = 2;
  parts.push(chunk("IHDR", header));
  if (withPhys) {
    // Чужое разрешение, которое мы обязаны заменить, а не продублировать.
    const old = new Uint8Array(9);
    new DataView(old.buffer).setUint32(0, 2835);
    new DataView(old.buffer).setUint32(4, 2835);
    old[8] = 1;
    parts.push(chunk("pHYs", old));
  }
  const pixels = deflateSync(Buffer.alloc(2 * (4 * 3 + 1)));
  parts.push(chunk("IDAT", pixels.subarray(0, 5)));
  parts.push(chunk("IDAT", pixels.subarray(5)));
  parts.push(chunk("IEND", new Uint8Array(0)));
  const size = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(size);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

// ——— сам чанк ————————————————————————————————————————————————————————

test("точек на метр считается из dpi и округляется до целого", () => {
  // 300 dpi — 11811 точек на метр: 300 / 0,0254 = 11811,02…
  assert.equal(pngPixelsPerMetre(300), 11811);
  assert.equal(pngPixelsPerMetre(150), 5906);
  assert.equal(pngPixelsPerMetre(600), 23622);
  assert.equal(pngPixelsPerMetre(96), 3780);
  assert.equal(pngPixelsPerMetre(0), 0);
  assert.equal(pngPixelsPerMetre(-5), 0);
  assert.equal(pngPixelsPerMetre("ерунда"), 0);
});

test("чанк pHYs собран по спецификации PNG", () => {
  const chunk = pngPhysChunk(300);
  const view = new DataView(chunk.buffer);
  assert.equal(chunk.length, 21, "9 байт данных плюс длина, тип и CRC");
  assert.equal(view.getUint32(0), 9, "в длину входят только данные");
  assert.equal(String.fromCharCode(...chunk.subarray(4, 8)), "pHYs");
  assert.equal(view.getUint32(8), 11811, "точек на метр по X");
  assert.equal(view.getUint32(12), 11811, "точек на метр по Y");
  assert.equal(chunk[16], 1, "единица измерения — метр");
  // CRC считается от типа вместе с данными, длина в него не входит.
  assert.equal(view.getUint32(17), crc(chunk.subarray(4, 17)));
});

// ——— вставка в файл ———————————————————————————————————————————————————

test("чанк встаёт сразу после IHDR и до первого IDAT", () => {
  const out = pngWithDpi(samplePng(), 300);
  const list = chunks(out).map((item) => item.type);
  assert.deepEqual(list, ["IHDR", "pHYs", "IDAT", "IDAT", "IEND"]);
});

test("CRC записанного чанка сходится, числа те самые", () => {
  const out = pngWithDpi(samplePng(), 300);
  const phys = chunks(out).find((item) => item.type === "pHYs");
  assert.equal(phys.length, 9);
  assert.equal(phys.crc, crc(phys.body), "CRC не сходится — файл битый");
  const view = new DataView(phys.data.buffer, phys.data.byteOffset);
  assert.deepEqual([view.getUint32(0), view.getUint32(4), phys.data[8]], [11811, 11811, 1]);
  assert.equal(pngDpiOf(out), 300, "записанное читается обратно тем же числом");
});

test("картинка не меняется ни на байт — только появляется чанк", () => {
  const before = samplePng();
  const after = pngWithDpi(before, 300);
  const dataOf = (bytes) =>
    chunks(bytes)
      .filter((item) => item.type === "IDAT")
      .map((item) => Buffer.from(item.data).toString("hex"));
  assert.deepEqual(dataOf(after), dataOf(before), "содержимое IDAT изменилось");
  assert.equal(after.length, before.length + 21, "вырос ровно на один чанк");
  // Заголовок и хвост тоже прежние: размеры, глубина цвета, конец файла.
  const headerOf = (bytes) => Buffer.from(chunks(bytes).find((item) => item.type === "IHDR").data).toString("hex");
  assert.equal(headerOf(after), headerOf(before));
  assert.equal(chunks(after).pop().type, "IEND");
  // Исходный массив не тронут: вызывающий держит тот же файл, что передал.
  assert.deepEqual([...before], [...samplePng()]);
});

test("второй вызов не плодит дублей — прежнее разрешение заменяется", () => {
  const once = pngWithDpi(samplePng(), 300);
  const twice = pngWithDpi(once, 600);
  const list = chunks(twice).filter((item) => item.type === "pHYs");
  assert.equal(list.length, 1, "чанков pHYs должно остаться ровно один");
  assert.equal(pngDpiOf(twice), 600);
  assert.equal(twice.length, once.length, "замена на месте, файл не растёт");
  // Чужое разрешение из входного файла тоже заменяется, а не добавляется рядом.
  const foreign = pngWithDpi(samplePng({ withPhys: true }), 300);
  assert.equal(chunks(foreign).filter((item) => item.type === "pHYs").length, 1);
  assert.equal(pngDpiOf(foreign), 300);
});

test("не PNG и бессмысленное разрешение возвращаются как есть", () => {
  const notPng = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21]);
  assert.equal(pngWithDpi(notPng, 300), notPng, "чужой файл не правим");
  assert.equal(pngDpiOf(notPng), null);
  const png = samplePng();
  assert.equal(pngWithDpi(png, 0), png, "нулевое разрешение писать нечем");
  assert.equal(pngWithDpi(png, -1), png);
  assert.equal(pngDpiOf(png), null, "в свежем файле разрешения нет — это и есть исходная беда");
  // Обрубленный файл не роняет выгрузку: картинка важнее отметки о ней.
  const broken = png.subarray(0, 30);
  assert.equal(pngWithDpi(broken, 300), broken);
});
