// Сжатие ссылки на объект: brotli копией рядом со страницей (G18).
//
// Это **единственная зависимость** сборки, и правило «ни одной зависимости»
// (ADR 001) снято здесь решением заказчика: объект заказчика в адресе должен
// быть коротким, а браузер brotli сам не отдаёт. Проверено в Chrome 156:
// `CompressionStream`/`DecompressionStream` знают только `deflate`, `gzip` и
// `deflate-raw`; brotli браузер распаковывает лишь из сети по
// `Content-Encoding`, синтетический `Response` его не читает.
//
// Почему файлом рядом, а не модулем в `src/`:
//
//   - в бандл попадает **каждый** файл `src/**/*.js` (списка включения в
//     сборке нет), и кодек — 1,2 МБ wasm — уехал бы в обе страницы разом;
//   - `<script src=` в собранной странице запрещён (`assertCodeInside`),
//     поэтому единственный путь к соседнему файлу — **динамический**
//     `import("./…")`. Статический втянул бы его в бандл обратно.
//
// Отсюда два следствия, и оба нарочные:
//
//   - **путь считается от страницы**, а не от этого модуля: в собранной
//     странице код лежит внутри `dist/index.html` (и `dist/view.html`), и
//     адрес `./vendor/…` ведёт в `dist/vendor/`;
//   - **со страницы на диске (`file://`) кодек не грузится**: модуль по
//     `file://` браузер отвергает (чужой источник). Это не беда просмотра —
//     заказчик приходит по ссылке на сайт, — но «Ссылкой» с диска отвечает
//     словами (`strings.exportPanel.linkNoCodec`), а не молчанием.
//
// Распаковщик и кодировщик — **разные копии**: заказчику нужен только первый
// (208 КБ), и он идёт в офлайн-кэш установки; кодировщик (1,03 МБ) нужен
// только «Разметке» и тянется по нажатию. Что за копии и откуда — в
// `web/vendor/README.md`.

/** Распаковщик: нужен странице просмотра сразу, лежит в офлайн-кэше. */
export const BROTLI_DECODER_MODULE = "./vendor/brotli-dec-wasm/brotli_dec_wasm.js";
/** Кодировщик: нужен только «Разметке» и только по нажатию «Ссылкой». */
export const BROTLI_ENCODER_MODULE = "./vendor/brotli-wasm/brotli_wasm.js";
// Одиннадцатый — предел brotli: ссылку собирают раз и смотрят на её длину,
// секунда счёта здесь дешевле двух тысяч лишних знаков в адресе.
export const BROTLI_QUALITY = 11;

// Модуль поднимается один раз на вкладку: wasm весит мегабайт, и второй раз
// его грузить незачем.
let brotliDecoderPromise = null;
let brotliEncoderPromise = null;

function brotliLoad(path) {
  // Адрес собирается на месте: статический `import` из этого модуля сборка
  // втянула бы в бандл, а разбор `import(…)` переменной она не трогает.
  return import(path);
}

async function brotliDecoder() {
  if (!brotliDecoderPromise) {
    brotliDecoderPromise = brotliLoad(BROTLI_DECODER_MODULE).then(async (module) => {
      // Первый вызов поднимает wasm: он лежит рядом с самим модулем, и адрес
      // его считает сам кодек (`import.meta.url`).
      await module.default();
      return module;
    });
  }
  return brotliDecoderPromise;
}

async function brotliEncoder() {
  if (!brotliEncoderPromise) {
    brotliEncoderPromise = brotliLoad(BROTLI_ENCODER_MODULE).then(async (module) => {
      await module.default();
      return module;
    });
  }
  return brotliEncoderPromise;
}

/**
 * Сжать байты. Тот же вид, что ждёт `viewLink.js`:
 * `(Uint8Array) -> Promise<Uint8Array>` — кодек приходит туда аргументом, и в
 * тестах на его место встаёт `zlib`.
 */
export async function brotliCompress(bytes, options = {}) {
  const module = await brotliEncoder();
  const quality = Number.isFinite(options.quality) ? options.quality : BROTLI_QUALITY;
  return module.compress(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes), { quality });
}

/** Распаковать байты: `(Uint8Array) -> Promise<Uint8Array>`. */
export async function brotliDecompress(bytes) {
  const module = await brotliDecoder();
  return module.decompress(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
}

/** Есть ли надежда загрузить кодек: по `file://` модули браузер отвергает. */
export function brotliReachable() {
  if (typeof location === "undefined" || !location.protocol) return true;
  return location.protocol !== "file:";
}
