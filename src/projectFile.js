// Формат файла проекта: один zip с project.json, планами в schemes/ и README.txt.
// Zip пишется и читается здесь же, без библиотек: CompressionStream("deflate-raw")
// там, где он есть, и «stored» (без сжатия) там, где его нет. Читаются оба варианта.
import { strings, text } from "./strings.js";
import { FORMAT_VERSION } from "./model.js";

export { FORMAT_VERSION };

export const PROJECT_ENTRY = "project.json";
export const SCHEMES_DIR = "schemes/";
export const README_ENTRY = "README.txt";

const LOCAL_SIGNATURE = 0x04034b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const END_SIGNATURE = 0x06054b50;
const LOCAL_HEADER_SIZE = 30;
const CENTRAL_HEADER_SIZE = 46;
const END_HEADER_SIZE = 22;
const METHOD_STORED = 0;
const METHOD_DEFLATE = 8;
const UTF8_FLAG = 0x0800;
const ZIP64_MARK = 0xffffffff;
const MAX_ZIP_BYTES = 0xfffffffe;

// Тип картинки восстанавливается по расширению: имя файла в архиве — всё,
// что о ней известно после распаковки.
const IMAGE_TYPES = [
  ["image/png", "png"],
  ["image/jpeg", "jpg"],
  ["image/jpeg", "jpeg"],
];

function fileError(key, vars) {
  const error = new Error(text("errors." + key, vars));
  error.code = key;
  return error;
}

// ——— байты ———————————————————————————————————————————————————————————

const utf8Encoder = new TextEncoder();
const utf8Decoder = new TextDecoder("utf-8");

function encodeText(value) {
  return utf8Encoder.encode(value);
}

function decodeText(bytes) {
  return utf8Decoder.decode(bytes);
}

async function toBytes(data) {
  if (data == null) return new Uint8Array(0);
  if (data instanceof Uint8Array) return data;
  if (typeof data === "string") return encodeText(data);
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  if (typeof data.arrayBuffer === "function") return new Uint8Array(await data.arrayBuffer());
  throw fileError("archiveBroken");
}

let crcTable = null;

export function crc32(bytes) {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let value = n;
      for (let bit = 0; bit < 8; bit += 1) {
        value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
      }
      crcTable[n] = value >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    crc = (crc >>> 8) ^ crcTable[(crc ^ bytes[i]) & 0xff];
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function hasCompression() {
  return typeof CompressionStream === "function" && typeof DecompressionStream === "function";
}

async function collectStream(readable) {
  const reader = readable.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const step = await reader.read();
    if (step.done) break;
    const chunk = step.value instanceof Uint8Array ? step.value : new Uint8Array(step.value);
    chunks.push(chunk);
    total += chunk.length;
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

// Поток, а не один кусок: большой план не держит вкладку — между чтениями
// управление возвращается странице.
async function pipeBytes(bytes, transform) {
  const source = new Blob([bytes]).stream().pipeThrough(transform);
  return collectStream(source);
}

async function deflateRaw(bytes) {
  return pipeBytes(bytes, new CompressionStream("deflate-raw"));
}

async function inflateRaw(bytes) {
  try {
    return await pipeBytes(bytes, new DecompressionStream("deflate-raw"));
  } catch {
    throw fileError("archiveBroken");
  }
}

// ——— запись zip ——————————————————————————————————————————————————————

function dosStamp(date) {
  const year = date.getUTCFullYear();
  if (year < 1980) return { time: 0, date: (1 << 5) | 1 };
  return {
    time: (date.getUTCHours() << 11) | (date.getUTCMinutes() << 5) | (date.getUTCSeconds() >> 1),
    date: ((year - 1980) << 9) | ((date.getUTCMonth() + 1) << 5) | date.getUTCDate(),
  };
}

function headerBuffer(size) {
  const bytes = new Uint8Array(size);
  return { bytes, view: new DataView(bytes.buffer) };
}

/**
 * Собирает zip из списка {name, data, compress}. `data` — Uint8Array, ArrayBuffer,
 * строка или Blob. Размеры известны заранее, дескрипторов данных нет — архив
 * открывается штатным распаковщиком ОС.
 */
export async function writeZip(files, options = {}) {
  const allowCompression = options.compress !== false && hasCompression();
  const stamp = dosStamp(options.date instanceof Date ? options.date : new Date());
  const onProgress = typeof options.onProgress === "function" ? options.onProgress : null;
  const list = [...files];

  const parts = [];
  const central = [];
  let offset = 0;

  for (let index = 0; index < list.length; index += 1) {
    const entry = list[index];
    const nameBytes = encodeText(entry.name);
    const source = await toBytes(entry.data);
    const wantCompression = entry.compress === false ? false : allowCompression;

    let method = METHOD_STORED;
    let payload = source;
    if (wantCompression && source.length > 0) {
      const packed = await deflateRaw(source);
      if (packed.length < source.length) {
        method = METHOD_DEFLATE;
        payload = packed;
      }
    }
    const crc = crc32(source);

    const local = headerBuffer(LOCAL_HEADER_SIZE + nameBytes.length);
    local.view.setUint32(0, LOCAL_SIGNATURE, true);
    local.view.setUint16(4, 20, true);
    local.view.setUint16(6, UTF8_FLAG, true);
    local.view.setUint16(8, method, true);
    local.view.setUint16(10, stamp.time, true);
    local.view.setUint16(12, stamp.date, true);
    local.view.setUint32(14, crc, true);
    local.view.setUint32(18, payload.length, true);
    local.view.setUint32(22, source.length, true);
    local.view.setUint16(26, nameBytes.length, true);
    local.view.setUint16(28, 0, true);
    local.bytes.set(nameBytes, LOCAL_HEADER_SIZE);

    parts.push(local.bytes, payload);
    central.push({ nameBytes, method, crc, packedSize: payload.length, size: source.length, offset });
    offset += local.bytes.length + payload.length;
    if (offset > MAX_ZIP_BYTES) throw fileError("archiveTooBig");
    if (onProgress) onProgress({ done: index + 1, total: list.length, name: entry.name });
  }

  const directoryOffset = offset;
  let directorySize = 0;
  for (const entry of central) {
    const header = headerBuffer(CENTRAL_HEADER_SIZE + entry.nameBytes.length);
    header.view.setUint32(0, CENTRAL_SIGNATURE, true);
    header.view.setUint16(4, 20, true);
    header.view.setUint16(6, 20, true);
    header.view.setUint16(8, UTF8_FLAG, true);
    header.view.setUint16(10, entry.method, true);
    header.view.setUint16(12, stamp.time, true);
    header.view.setUint16(14, stamp.date, true);
    header.view.setUint32(16, entry.crc, true);
    header.view.setUint32(20, entry.packedSize, true);
    header.view.setUint32(24, entry.size, true);
    header.view.setUint16(28, entry.nameBytes.length, true);
    header.view.setUint32(42, entry.offset, true);
    header.bytes.set(entry.nameBytes, CENTRAL_HEADER_SIZE);
    parts.push(header.bytes);
    directorySize += header.bytes.length;
  }

  const end = headerBuffer(END_HEADER_SIZE);
  end.view.setUint32(0, END_SIGNATURE, true);
  end.view.setUint16(8, central.length, true);
  end.view.setUint16(10, central.length, true);
  end.view.setUint32(12, directorySize, true);
  end.view.setUint32(16, directoryOffset, true);
  parts.push(end.bytes);
  if (directoryOffset + directorySize + END_HEADER_SIZE > MAX_ZIP_BYTES) throw fileError("archiveTooBig");

  return new Blob(parts, { type: "application/zip" });
}

// ——— чтение zip ——————————————————————————————————————————————————————

function findEndHeader(bytes, view) {
  const limit = Math.max(0, bytes.length - 0xffff - END_HEADER_SIZE);
  for (let at = bytes.length - END_HEADER_SIZE; at >= limit; at -= 1) {
    if (view.getUint32(at, true) === END_SIGNATURE) return at;
  }
  return -1;
}

/** Распаковывает zip в Map «имя файла → байты». Понимает stored и deflate. */
export async function readZip(blob) {
  const bytes = await toBytes(blob);
  if (bytes.length < END_HEADER_SIZE) throw fileError("notAProject");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  const endAt = findEndHeader(bytes, view);
  if (endAt < 0) throw fileError("notAProject");

  const count = view.getUint16(endAt + 10, true);
  const directorySize = view.getUint32(endAt + 12, true);
  const directoryOffset = view.getUint32(endAt + 16, true);
  if (directoryOffset === ZIP64_MARK || directorySize === ZIP64_MARK || count === 0xffff) {
    throw fileError("zip64Unsupported");
  }
  if (directoryOffset + directorySize > bytes.length) throw fileError("archiveBroken");

  const entries = new Map();
  let at = directoryOffset;
  for (let index = 0; index < count; index += 1) {
    if (at + CENTRAL_HEADER_SIZE > bytes.length) throw fileError("archiveBroken");
    if (view.getUint32(at, true) !== CENTRAL_SIGNATURE) throw fileError("archiveBroken");
    const method = view.getUint16(at + 10, true);
    const crc = view.getUint32(at + 16, true);
    const packedSize = view.getUint32(at + 20, true);
    const size = view.getUint32(at + 24, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const localOffset = view.getUint32(at + 42, true);
    const name = decodeText(bytes.subarray(at + CENTRAL_HEADER_SIZE, at + CENTRAL_HEADER_SIZE + nameLength));
    at += CENTRAL_HEADER_SIZE + nameLength + extraLength + commentLength;

    if (name.endsWith("/")) continue;
    if (packedSize === ZIP64_MARK || size === ZIP64_MARK || localOffset === ZIP64_MARK) {
      throw fileError("zip64Unsupported");
    }
    if (localOffset + LOCAL_HEADER_SIZE > bytes.length) throw fileError("archiveBroken");
    if (view.getUint32(localOffset, true) !== LOCAL_SIGNATURE) throw fileError("archiveBroken");

    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const dataAt = localOffset + LOCAL_HEADER_SIZE + localNameLength + localExtraLength;
    if (dataAt + packedSize > bytes.length) throw fileError("archiveBroken");

    const payload = bytes.subarray(dataAt, dataAt + packedSize);
    let content;
    if (method === METHOD_STORED) content = payload.slice();
    else if (method === METHOD_DEFLATE) content = await inflateRaw(payload);
    else throw fileError("archiveBroken");

    if (content.length !== size || crc32(content) !== crc) throw fileError("archiveBroken");
    entries.set(name, content);
  }
  return entries;
}

// ——— файл проекта ————————————————————————————————————————————————————

function extensionFor(type) {
  const found = IMAGE_TYPES.find((pair) => pair[0] === String(type || "").toLowerCase());
  return found ? found[1] : "bin";
}

function typeForExtension(extension) {
  const found = IMAGE_TYPES.find((pair) => pair[1] === String(extension || "").toLowerCase());
  return found ? found[0] : "";
}

// Идентификатор изображения попадает в имя файла: кодируем, чтобы «/» и прочее
// не разъехались по папкам, и раскодируем обратно — id восстанавливается точно.
function encodeImageId(id) {
  return encodeURIComponent(String(id));
}

function decodeImageId(name) {
  try {
    return decodeURIComponent(name);
  } catch {
    return name;
  }
}

// Поставщик один — store отдаёт Map. Всё остальное отвергается: тихо вернуть
// пустой список значило бы упаковать объект без единого плана и промолчать.
function imageEntries(images) {
  if (images == null) return [];
  if (!(images instanceof Map)) throw fileError("imagesNotMap");
  return [...images.entries()];
}

function looksLikeProject(value) {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    typeof value.id === "string" &&
    Array.isArray(value.categories) &&
    Array.isArray(value.markTypes) &&
    Array.isArray(value.schemes) &&
    Array.isArray(value.marks)
  );
}

// Единственное место, где живут миграции формата: версия из будущего отвергается,
// прошлые версии доводятся до текущей здесь.
function migrateProject(loaded) {
  const version = Number(loaded.formatVersion);
  if (!Number.isFinite(version) || version < 1) throw fileError("foreignProject");
  if (version > FORMAT_VERSION) {
    throw fileError("futureVersion", { version, current: FORMAT_VERSION });
  }
  return {
    ...loaded,
    formatVersion: FORMAT_VERSION,
    rooms: Array.isArray(loaded.rooms) ? loaded.rooms : [],
    groups: Array.isArray(loaded.groups) ? loaded.groups : [],
    counters: loaded.counters && typeof loaded.counters === "object" ? loaded.counters : {},
  };
}

function readmeText(project, date) {
  return text("file.readme", {
    name: project.name || strings.project.untitled,
    date: date.toISOString(),
    schemes: project.schemes.length,
    marks: project.marks.length,
    version: FORMAT_VERSION,
  }) + "\n";
}

/** Имя для выгрузки: «<объект>-<дата>.zip». */
export function projectFileName(project, now) {
  const date = now instanceof Date ? now : new Date();
  const day = date.toISOString().slice(0, 10);
  const raw = String((project && project.name) || strings.project.untitled);
  const safe = raw
    .replace(/[\\/:*?"<>|\x00-\x1f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
  return (safe || strings.project.untitled) + "-" + day + ".zip";
}

/**
 * Упаковывает объект и планы в один zip.
 * `images` — Map «imageId → Blob» (или ничего, если планов нет); картинки кладутся
 * как есть, без пережатия. `options.onProgress({done, total, name})`.
 */
export async function packProject(project, images, options = {}) {
  if (!looksLikeProject(project)) throw fileError("foreignProject");
  const date = options.date instanceof Date ? options.date : new Date();
  const forFile = { ...project, formatVersion: FORMAT_VERSION };

  const files = [{ name: PROJECT_ENTRY, data: JSON.stringify(forFile, null, 2) }];
  for (const [id, blob] of imageEntries(images)) {
    if (!id || !blob) continue;
    const extension = extensionFor(blob.type);
    files.push({
      name: SCHEMES_DIR + encodeImageId(id) + "." + extension,
      data: blob,
      compress: false,
    });
  }
  files.push({ name: README_ENTRY, data: readmeText(forFile, date) });

  return writeZip(files, {
    date,
    compress: options.compress,
    onProgress: options.onProgress,
  });
}

// Свой архив кладёт project.json в корень; перепакованный вместе с папкой —
// на уровень глубже. Из нескольких кандидатов берётся самый неглубокий:
// сравниваются префиксы с префиксами, а не имя файла с префиксом.
function projectPrefix(entries) {
  let prefix = null;
  for (const name of entries.keys()) {
    if (name === PROJECT_ENTRY) return "";
    if (name.endsWith("/" + PROJECT_ENTRY)) {
      const candidate = name.slice(0, -PROJECT_ENTRY.length);
      if (prefix === null || candidate.length < prefix.length) prefix = candidate;
    }
  }
  return prefix;
}

/**
 * Читает файл проекта: `{project, images}`, где images — Map «imageId → Blob».
 * Чужой или битый файл отвергается ошибкой с `.code` из strings.errors,
 * текущий объект при этом не трогается — вызывающий получает исключение
 * до того, как что-то заменит.
 */
export async function unpackProject(blob, options = {}) {
  if (!blob) throw fileError("notAProject");
  const entries = await readZip(blob);

  const prefix = projectPrefix(entries);
  if (prefix === null) throw fileError("noProjectJson");

  let loaded;
  try {
    loaded = JSON.parse(decodeText(entries.get(prefix + PROJECT_ENTRY)));
  } catch {
    throw fileError("brokenProjectJson");
  }
  if (!looksLikeProject(loaded)) throw fileError("foreignProject");
  const project = migrateProject(loaded);

  const onProgress = typeof options.onProgress === "function" ? options.onProgress : null;
  const imageNames = [...entries.keys()].filter(
    (name) => name.startsWith(prefix + SCHEMES_DIR) && name.length > (prefix + SCHEMES_DIR).length,
  );
  const images = new Map();
  for (let index = 0; index < imageNames.length; index += 1) {
    const name = imageNames[index];
    const tail = name.slice((prefix + SCHEMES_DIR).length);
    const dot = tail.lastIndexOf(".");
    const id = decodeImageId(dot > 0 ? tail.slice(0, dot) : tail);
    const type = typeForExtension(dot > 0 ? tail.slice(dot + 1) : "");
    images.set(id, new Blob([entries.get(name)], type ? { type } : undefined));
    if (onProgress) onProgress({ done: index + 1, total: imageNames.length, name });
  }

  return { project, images };
}
