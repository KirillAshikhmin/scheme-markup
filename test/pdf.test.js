// Документ PDF: страница в миллиметрах и лист картинкой.
//
// Проверять тут нужно три разные вещи, и одна другую не заменяет:
//
// 1. **Страница ровно того размера, что написан на коробке бумаги.** A4 —
//    595,28 × 841,89 пункта; заказчик печатает и прикладывает линейку, и
//    ошибка в последней сотой здесь дороже любой красоты кода.
// 2. **Файл читаемый.** Таблица ссылок указывает на начала объектов байт в
//    байт: соврёт одно смещение — документ не откроется вовсе. Поэтому разбор
//    в тесте свой, а не «в целом похоже на PDF».
// 3. **Пиксели дошли без потерь.** Поток распаковывается `zlib` самого Node (а
//    не нашим `DecompressionStream`: сверять код с ним же — значит проверить,
//    что он равен себе), предсказатель разворачивается руками, и результат
//    сравнивается с теми байтами, что положили на вход.
//
// Числа в проверках написаны руками, а не получены тем же кодом.
import test from "node:test";
import assert from "node:assert/strict";
import { inflateSync } from "node:zlib";

import {
  PDF_POINTS_PER_MM,
  PDF_XREF_ENTRY,
  pdfDate,
  pdfDeflate,
  pdfDocument,
  pdfImage,
  pdfImageBytes,
  pdfImageRows,
  pdfNumber,
  pdfPoints,
  pdfTextString,
} from "../src/pdf.js";

// ——— свой разбор документа ————————————————————————————————————————————

function latin(bytes) {
  let out = "";
  for (const byte of bytes) out += String.fromCharCode(byte);
  return out;
}

// Объекты находятся по смещениям из таблицы ссылок — то есть проверяется
// именно то, по чему пойдёт программа просмотра, а не поиск текста в файле.
function parsePdf(bytes) {
  const source = latin(bytes);
  const startAt = source.lastIndexOf("startxref");
  assert.ok(startAt > 0, "в файле нет startxref");
  const startxref = Number(source.slice(startAt + 9).trim().split(/\s/)[0]);
  assert.equal(source.slice(startxref, startxref + 4), "xref", "startxref указывает не на таблицу");
  const head = source.slice(startxref + 5);
  const [zero, count] = head.slice(0, head.indexOf("\n")).trim().split(/\s+/).map(Number);
  assert.equal(zero, 0, "подраздел таблицы должен начинаться с нулевого объекта");
  const tableAt = startxref + 5 + head.indexOf("\n") + 1;
  const entries = [];
  for (let index = 0; index < count; index += 1) {
    const entry = source.slice(tableAt + index * PDF_XREF_ENTRY, tableAt + (index + 1) * PDF_XREF_ENTRY);
    assert.equal(entry.length, PDF_XREF_ENTRY, "запись таблицы не 20 байт: «" + entry + "»");
    const match = /^(\d{10}) (\d{5}) ([nf]) \n$/.exec(entry);
    assert.ok(match, "запись таблицы не по спецификации: «" + entry + "»");
    entries.push({ offset: Number(match[1]), kind: match[3] });
  }
  const objects = new Map();
  for (let number = 1; number < count; number += 1) {
    const { offset, kind } = entries[number];
    assert.equal(kind, "n", "объект " + number + " объявлен свободным");
    const header = number + " 0 obj\n";
    assert.equal(source.slice(offset, offset + header.length), header, "смещение объекта " + number + " врёт");
    const body = source.slice(offset + header.length);
    const dict = body.slice(0, body.indexOf("\n"));
    const streamAt = body.startsWith(dict + "\nstream\n") ? offset + header.length + dict.length + 8 : -1;
    let stream = null;
    if (streamAt > 0) {
      const length = Number(/\/Length (\d+)/.exec(dict)[1]);
      stream = bytes.subarray(streamAt, streamAt + length);
      assert.equal(
        source.slice(streamAt + length, streamAt + length + 11),
        "\nendstream\n",
        "поток объекта " + number + " не той длины, что объявлена в /Length",
      );
    }
    objects.set(number, { dict, stream });
  }
  const trailer = source.slice(source.lastIndexOf("trailer"));
  return { source, count, objects, trailer, startxref, entries };
}

// Разворот предсказателя PNG «Up»: байт плюс байт над ним.
function unpredict(rows, width, height) {
  const stride = width * 3;
  const out = new Uint8Array(stride * height);
  for (let y = 0; y < height; y += 1) {
    const at = y * (stride + 1);
    assert.equal(rows[at], 2, "строка " + y + " должна быть помечена фильтром «Up»");
    for (let i = 0; i < stride; i += 1) {
      const above = y === 0 ? 0 : out[(y - 1) * stride + i];
      out[y * stride + i] = (rows[at + 1 + i] + above) & 0xff;
    }
  }
  return out;
}

// Холст: RGBA, альфа везде 255 — так его и заливает выгрузка.
function samplePixels(width, height) {
  const out = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    out[i * 4] = (i * 7) & 0xff;
    out[i * 4 + 1] = (i * 13 + 5) & 0xff;
    out[i * 4 + 2] = (i * 29 + 100) & 0xff;
    out[i * 4 + 3] = 255;
  }
  return out;
}

async function samplePage(widthMm, heightMm, width = 4, height = 3) {
  return { widthMm, heightMm, image: await pdfImage(samplePixels(width, height), width, height) };
}

// ——— миллиметры в пункты ——————————————————————————————————————————————

test("пункт — одна семьдесят вторая дюйма", () => {
  assert.equal(PDF_POINTS_PER_MM, 72 / 25.4);
  assert.equal(pdfPoints(25.4), 72);
});

test("форматы ГОСТ в пунктах — числа, написанные руками", () => {
  assert.equal(pdfPoints(210), 595.28);
  assert.equal(pdfPoints(297), 841.89);
  assert.equal(pdfPoints(420), 1190.55);
  assert.equal(pdfPoints(594), 1683.78);
  assert.equal(pdfPoints(841), 2383.94);
});

test("мусор на входе даёт ноль, а не NaN в файле", () => {
  assert.equal(pdfPoints(0), 0);
  assert.equal(pdfPoints(-5), 0);
  assert.equal(pdfPoints("нет"), 0);
  assert.equal(pdfPoints(undefined), 0);
});

test("число в файле — с точкой, без хвостовых нулей и без минус-нуля", () => {
  assert.equal(pdfNumber(595.2755905511811), "595.28");
  assert.equal(pdfNumber(841.8897637795275), "841.89");
  assert.equal(pdfNumber(100), "100");
  assert.equal(pdfNumber(841.9), "841.9");
  assert.equal(pdfNumber(0), "0");
  assert.equal(pdfNumber(-0.001), "0");
  assert.equal(pdfNumber(NaN), "0");
  assert.equal(pdfNumber(-12.5), "-12.5");
});

// ——— строки и дата ————————————————————————————————————————————————————

test("имя объекта по-русски уходит в UTF-16BE с меткой порядка байтов", () => {
  // «Дом» — U+0414 U+043E U+043C.
  assert.equal(pdfTextString("Дом"), "<FEFF0414043E043C>");
  assert.equal(pdfTextString("A"), "<FEFF0041>");
  assert.equal(pdfTextString(""), "<FEFF>");
  assert.equal(pdfTextString(null), "<FEFF>");
});

test("знак вне основной плоскости пишется парой — иначе файл испорчен", () => {
  // U+1F4D0 — треугольник с линейкой; старшая часть D83D, младшая DCD0.
  assert.equal(pdfTextString("\u{1F4D0}"), "<FEFFD83DDCD0>");
});

test("дата документа — местная, со своей зоной", () => {
  const at = new Date(2026, 9, 9, 15, 30, 0);
  const got = pdfDate(at);
  assert.match(got, /^D:20261009153000[+-]\d\d'\d\d'$/);
  // Зона берётся у машины прогона, и сравнивать её с «+03'00'» было бы
  // проверкой настроек, а не кода. Проверяем, что она та же, что у Date.
  const offset = -at.getTimezoneOffset();
  const sign = offset < 0 ? "-" : "+";
  const pad = (value) => String(Math.abs(value)).padStart(2, "0");
  assert.equal(got.slice(16), sign + pad(Math.trunc(Math.abs(offset) / 60)) + "'" + pad(Math.abs(offset) % 60) + "'");
});

// ——— пиксели ——————————————————————————————————————————————————————————

test("альфа отбрасывается, порядок точек сохраняется", () => {
  const rgba = new Uint8Array([1, 2, 3, 255, 4, 5, 6, 128]);
  assert.deepEqual([...pdfImageBytes(rgba, 2, 1)], [1, 2, 3, 4, 5, 6]);
});

test("предсказатель «Up» — вычитание байта над ним, посчитанное руками", () => {
  // Две строки по две точки: вторая строка на единицу светлее первой.
  const rgba = new Uint8Array([
    10, 20, 30, 255, 40, 50, 60, 255, //
    11, 21, 31, 255, 41, 51, 61, 255,
  ]);
  const rows = pdfImageRows(rgba, 2, 2);
  // Первая строка идёт как есть (над ней нули), вторая — одними единицами.
  assert.deepEqual([...rows], [2, 10, 20, 30, 40, 50, 60, 2, 1, 1, 1, 1, 1, 1]);
});

test("вычитание идёт по кругу — 0 минус 1 это 255, а не −1", () => {
  const rgba = new Uint8Array([0, 0, 0, 255, 0, 0, 0, 255]);
  rgba[0] = 1;
  const rows = pdfImageRows(rgba, 1, 2);
  assert.deepEqual([...rows], [2, 1, 0, 0, 2, 255, 0, 0]);
});

test("сжатый поток разворачивается в те же байты, что были на входе", async () => {
  const width = 17;
  const height = 9;
  const rgba = samplePixels(width, height);
  const image = await pdfImage(rgba, width, height);
  assert.equal(image.flate, true, "в Node CompressionStream есть — поток обязан быть сжатым");
  const rows = inflateSync(Buffer.from(image.data));
  assert.deepEqual([...unpredict(rows, width, height)], [...pdfImageBytes(rgba, width, height)]);
});

test("без CompressionStream поток идёт без сжатия, а не пустым", async () => {
  const saved = globalThis.CompressionStream;
  try {
    delete globalThis.CompressionStream;
    assert.equal(await pdfDeflate(new Uint8Array([1, 2, 3])), null);
    const image = await pdfImage(samplePixels(3, 2), 3, 2);
    assert.equal(image.flate, false);
    assert.equal(image.data.length, 3 * 2 * 3);
  } finally {
    globalThis.CompressionStream = saved;
  }
});

// ——— документ —————————————————————————————————————————————————————————

test("страница A4 — ровно 595,28 × 841,89 пункта", async () => {
  const pdf = parsePdf(pdfDocument([await samplePage(210, 297)], {}));
  const page = pdf.objects.get(4);
  assert.match(page.dict, /\/MediaBox \[0 0 595\.28 841\.89\]/);
  // Та же пара чисел и в преобразовании картинки: страница и лист на ней
  // обязаны совпасть, иначе на бумаге останется белая полоса.
  assert.equal(latin(pdf.objects.get(5).stream), "q\n595.28 0 0 841.89 0 0 cm\n/Im0 Do\nQ\n");
});

test("альбомный A3 — те же числа, переставленные местами", async () => {
  const pdf = parsePdf(pdfDocument([await samplePage(420, 297)], {}));
  assert.match(pdf.objects.get(4).dict, /\/MediaBox \[0 0 1190\.55 841\.89\]/);
});

test("файл начинается подписью и двоичной меткой", async () => {
  const bytes = pdfDocument([await samplePage(210, 297)], {});
  assert.equal(latin(bytes.subarray(0, 9)), "%PDF-1.4\n");
  assert.equal(bytes[9], 0x25);
  assert.ok(
    [...bytes.subarray(10, 14)].every((byte) => byte > 127),
    "без байтов старше 127 файл могут принять за текстовый",
  );
});

test("каталог, список страниц и словарь документа стоят на своих номерах", async () => {
  const pdf = parsePdf(pdfDocument([await samplePage(210, 297)], { title: "Дом", producer: "Разметка" }));
  assert.match(pdf.objects.get(1).dict, /^<< \/Type \/Catalog \/Pages 2 0 R >>$/);
  assert.match(pdf.objects.get(2).dict, /\/Type \/Pages \/Count 1 \/Kids \[4 0 R\]/);
  assert.match(pdf.objects.get(3).dict, /\/Title <FEFF0414043E043C>/);
  assert.match(pdf.objects.get(3).dict, /\/CreationDate \(D:\d{14}[+-]\d\d'\d\d'\)/);
  assert.match(pdf.trailer, /\/Size 7 \/Root 1 0 R \/Info 3 0 R/);
});

test("картинка объявлена как RGB с предсказателем — иначе лист вышел бы кашей", async () => {
  const pdf = parsePdf(pdfDocument([await samplePage(210, 297, 5, 4)], {}));
  const image = pdf.objects.get(6);
  assert.match(image.dict, /\/Subtype \/Image/);
  assert.match(image.dict, /\/Width 5 \/Height 4/);
  assert.match(image.dict, /\/ColorSpace \/DeviceRGB \/BitsPerComponent 8/);
  assert.match(image.dict, /\/Filter \/FlateDecode/);
  assert.match(image.dict, /\/DecodeParms << \/Predictor 15 \/Colors 3 \/BitsPerComponent 8 \/Columns 5 >>/);
  // И поток в файле — тот самый, который разворачивается в наши пиксели.
  const rows = inflateSync(Buffer.from(image.stream));
  assert.deepEqual([...unpredict(rows, 5, 4)], [...pdfImageBytes(samplePixels(5, 4), 5, 4)]);
});

test("три листа — один файл с тремя страницами", async () => {
  const bytes = pdfDocument(
    [await samplePage(210, 297), await samplePage(210, 297), await samplePage(297, 210)],
    {},
  );
  const pdf = parsePdf(bytes);
  assert.match(pdf.objects.get(2).dict, /\/Count 3 \/Kids \[4 0 R 7 0 R 10 0 R\]/);
  assert.match(pdf.objects.get(4).dict, /\/Contents 5 0 R/);
  assert.match(pdf.objects.get(7).dict, /\/XObject << \/Im0 9 0 R >>/);
  assert.match(pdf.objects.get(10).dict, /\/MediaBox \[0 0 841\.89 595\.28\]/);
  assert.match(pdf.trailer, /\/Size 13 /);
  assert.equal(pdf.count, 13);
  // Каждая страница ссылается на свою картинку: перепутай номера, и один лист
  // напечатался бы трижды.
  const used = [4, 7, 10].map((number) => /\/Im0 (\d+) 0 R/.exec(pdf.objects.get(number).dict)[1]);
  assert.deepEqual(used, ["6", "9", "12"]);
});

test("страниц ноль или лист без картинки — ошибка, а не пустой файл", async () => {
  assert.throws(() => pdfDocument([], {}));
  assert.throws(() => pdfDocument(null, {}));
  assert.throws(() => pdfDocument([{ widthMm: 210, heightMm: 297 }], {}));
  assert.throws(() => pdfDocument([{ widthMm: 210, heightMm: 297, image: { width: 0, height: 0 } }], {}));
});

test("таблица ссылок указывает ровно на начала объектов", async () => {
  // Разбор parsePdf уже сверяет каждое смещение с «N 0 obj»; здесь проверяется
  // то, что он не мог проверить сам: число записей и нулевая запись.
  const pdf = parsePdf(pdfDocument([await samplePage(210, 297), await samplePage(594, 841)], {}));
  assert.equal(pdf.count, 10);
  assert.equal(pdf.entries[0].offset, 0);
  assert.equal(pdf.entries[0].kind, "f");
  assert.ok(pdf.startxref > 0 && pdf.startxref < pdf.source.length);
  assert.ok(pdf.source.endsWith("%%EOF\n"));
});

test("вес файла — это вес картинок плюс словари, а не вдвое больше", async () => {
  // Лист на 60 000 точек: сжатый поток + несколько сотен байт обвязки. Если
  // кто-то положит картинку в файл дважды или забудет сжатие, это видно сразу.
  const page = await samplePage(210, 297, 300, 200);
  const bytes = pdfDocument([page], {});
  assert.ok(
    bytes.length < page.image.data.length + 900,
    "обвязка документа раздулась: " + (bytes.length - page.image.data.length) + " байт",
  );
  assert.ok(bytes.length > page.image.data.length, "картинка в файл не попала");
});
