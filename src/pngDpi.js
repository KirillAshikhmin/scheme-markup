// Физический размер в самом файле PNG: chunk `pHYs`.
//
// **Зачем.** Лист по ГОСТ выверен в миллиметрах, но `canvas.toBlob` в Chrome
// пишет только `IHDR`, `IDAT` и `IEND` — разрешения в файле нет. Программа
// печати тогда предполагает своё (72 или 96 dpi), получает лист вчетверо
// больше страницы и ужимает его «по размеру листа». Линейка, приложенная к
// такому отпечатку, покажет не 210 мм, а что попало — и виноватой будет
// выглядеть рамка, хотя в пикселях всё сошлось до десятых.
//
// `pHYs` — девять байт: точек на единицу по X, по Y и сама единица. Единица 1
// значит «метр», и другого значения в спецификации PNG нет вовсе, поэтому
// dpi хранится как точек на метр.
//
// Картинку это не трогает: ни один байт `IDAT` не меняется, разбор файла
// программой, которая `pHYs` не читает, остаётся прежним. Поэтому чанк
// дописывается **всем** выгружаемым PNG, а не только листу по ГОСТ: подпись
// «217 × 335 мм при 300 dpi» прежние выгрузки показывали и раньше — обещание
// физического размера уже было дано, просто файл его не нёс.
//
// CRC32 берётся из `projectFile.js` — тот же многочлен, что у zip, и второй
// реализации в сборке быть не должно.
import { crc32 } from "./projectFile.js";

// Подпись файла PNG: 137 'P' 'N' 'G' CR LF ^Z LF.
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const PNG_HEADER_LENGTH = PNG_SIGNATURE.length;
// Заголовок чанка (длина и тип) плюс CRC в хвосте.
const PNG_CHUNK_OVERHEAD = 12;
// Единица измерения в `pHYs`: 1 — метр. Ноль значит «единица неизвестна», и
// тогда чанк задаёт только соотношение сторон — нам это не нужно.
const PNG_UNIT_METRE = 1;
const PNG_MM_PER_INCH = 25.4;

function pngIsPng(bytes) {
  if (!bytes || bytes.length < PNG_HEADER_LENGTH + PNG_CHUNK_OVERHEAD) return false;
  return PNG_SIGNATURE.every((byte, index) => bytes[index] === byte);
}

function pngChunkType(bytes, at) {
  return String.fromCharCode(bytes[at + 4], bytes[at + 5], bytes[at + 6], bytes[at + 7]);
}

function pngChunkLength(bytes, at) {
  return (bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3];
}

/**
 * Точек на метр для заданного dpi, целым числом: ровно то, что ляжет в файл.
 * 300 dpi — 11811 точек на метр.
 */
export function pngPixelsPerMetre(dpi) {
  const value = Number(dpi);
  if (!Number.isFinite(value) || !(value > 0)) return 0;
  return Math.round((value * 1000) / PNG_MM_PER_INCH);
}

/**
 * Собранный чанк `pHYs` целиком: длина, тип, девять байт данных и CRC32 от
 * типа вместе с данными (как велит спецификация PNG — длина в CRC не входит).
 */
export function pngPhysChunk(dpi) {
  const perMetre = pngPixelsPerMetre(dpi);
  const chunk = new Uint8Array(9 + PNG_CHUNK_OVERHEAD);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, 9);
  chunk[4] = 0x70; // p
  chunk[5] = 0x48; // H
  chunk[6] = 0x59; // Y
  chunk[7] = 0x73; // s
  view.setUint32(8, perMetre);
  view.setUint32(12, perMetre);
  chunk[16] = PNG_UNIT_METRE;
  view.setUint32(17, crc32(chunk.subarray(4, 17)));
  return chunk;
}

/**
 * Разрешение из файла или `null`, когда его там нет. Нужно проверке и тестам:
 * «записали» и «читается обратно» — это два разных утверждения.
 */
export function pngDpiOf(bytes) {
  if (!pngIsPng(bytes)) return null;
  let at = PNG_HEADER_LENGTH;
  while (at + 8 <= bytes.length) {
    const length = pngChunkLength(bytes, at);
    const type = pngChunkType(bytes, at);
    if (type === "pHYs") {
      const view = new DataView(bytes.buffer, bytes.byteOffset + at + 8, 9);
      if (view.getUint8(8) !== PNG_UNIT_METRE) return null;
      const perMetre = view.getUint32(0);
      return perMetre > 0 ? Math.round((perMetre * PNG_MM_PER_INCH) / 1000) : null;
    }
    if (type === "IEND") return null;
    at += length + PNG_CHUNK_OVERHEAD;
  }
  return null;
}

/**
 * Копия файла с записанным разрешением. Чанк встаёт **сразу после `IHDR`** —
 * до первого `IDAT`, как велит спецификация; уже стоявший `pHYs` заменяется на
 * месте, поэтому второй вызов не плодит дублей.
 *
 * Чужой или битый вход возвращается как есть: выгрузка не обязана падать на
 * том, что разрешение не записалось, — картинка важнее отметки о ней.
 */
export function pngWithDpi(bytes, dpi) {
  if (!pngIsPng(bytes) || !(pngPixelsPerMetre(dpi) > 0)) return bytes;
  const chunk = pngPhysChunk(dpi);
  let insertAt = -1;
  let replaceLength = 0;
  let at = PNG_HEADER_LENGTH;
  while (at + 8 <= bytes.length) {
    const length = pngChunkLength(bytes, at);
    const type = pngChunkType(bytes, at);
    if (length < 0 || at + length + PNG_CHUNK_OVERHEAD > bytes.length) return bytes;
    if (type === "pHYs") {
      insertAt = at;
      replaceLength = length + PNG_CHUNK_OVERHEAD;
      break;
    }
    at += length + PNG_CHUNK_OVERHEAD;
    if (type === "IHDR") {
      insertAt = at;
      // Дальше идём только затем, чтобы найти уже записанный `pHYs`: он по
      // спецификации стоит до `IDAT`, дальше искать нечего.
      if (pngChunkType(bytes, at) === "IDAT") break;
      continue;
    }
    if (type === "IDAT" || type === "IEND") break;
  }
  if (insertAt < 0) return bytes;
  const out = new Uint8Array(bytes.length - replaceLength + chunk.length);
  out.set(bytes.subarray(0, insertAt), 0);
  out.set(chunk, insertAt);
  out.set(bytes.subarray(insertAt + replaceLength), insertAt + chunk.length);
  return out;
}
