// Документ PDF: страница в настоящих миллиметрах, лист — картинкой на всю страницу.
//
// **Зачем вообще PDF.** Слова заказчика: «И так и так. И экспорт в pdf».
// Против PNG у документа два преимущества, и оба он обязан отдать целиком:
//
// 1. **Размер страницы задан в самом файле, в пунктах.** У PNG физический
//    размер — подсказка (`pHYs`, см. `pngDpi.js`), которую программа печати
//    может и перебить своим «подогнать под страницу». У PDF страница — часть
//    документа: A4 это `[0 0 595.28 841.89]`, и печать «как есть» (100 %)
//    кладёт её на бумагу один к одному. Заказчик печатает A4 и проверяет
//    линейкой — ради этого формат и взят.
// 2. **Несколько листов одним файлом.** Таблица на три листа и объект на
//    двадцать схем перестают быть архивом картинок, который получателю надо
//    распаковывать и открывать по одной.
//
// **Чем рисуется страница: картинкой, а не объектами PDF.** Выбор сознательный
// и платный, поэтому цена названа здесь, а не в отчёте:
//
// - Лист по ГОСТ уже выверен в миллиметрах и нарисован `gostSheet.js` по
//   холсту. Нарисовать его второй раз линиями и текстом PDF — это **второй
//   путь отрисовки той же бумаги**, и он разойдётся с первым: ровно от этого
//   предостерегает G169 («второй формулы для того же числа в сборке нет»).
//   Разойдутся они не на экране, а на распечатке, которую уже отдали монтажнику.
// - Картинке **не нужен шрифт в документе**. Знаки уже нарисованы холстом тем
//   самым чертёжным шрифтом из `assets/gost-type-a.ttf`: кириллица не может
//   «поехать на чужой машине» — её там попросту нечем подменить. Это сильнее
//   встроенного шрифта и дешевле: ни кодировки, ни подмножества глифов, ни
//   лицензии шрифта в публикуемом файле.
// - Чёрно-белый режим (`mono.js`) достаётся даром: он живёт в холсте, а здесь
//   холст уже готов.
//
// Чем платим: **текст в PDF не выделяется и не ищется**, а при увеличении
// виден растр. Для чертежа, который печатают и читают глазами, это приемлемо;
// для документа, из которого копируют строки, — нет. Если понадобится второе,
// это отдельное решение с отдельным ADR, а не доработка «заодно».
//
// **Библиотеки здесь нет.** Правило «ноль зависимостей» (ADR 001) заказчик снял
// для PDF, но покупать на эти деньги было нечего: страница с одной картинкой —
// это несколько сотен байт служебных словарей вокруг готового потока пикселей.
// `pdf-lib` 1.17.1 (MIT) весит 511 КБ минифицированной и 1 551 КБ исходником,
// последний выпуск — ноябрь 2021; встраивание TrueType требует ещё
// `@pdf-lib/fontkit` (698 КБ минифицированной). Это удвоило бы страницу ради
// кода, который здесь уместился в один файл, — и, главное, библиотеку пришлось
// бы подключать `<script src>`, а это в собранной странице ошибка сборки
// (ADR 006 снял правило про ресурсы, а не про способ сборки бандла).
//
// Модуль чистый: ни DOM, ни холста, ни строк интерфейса. Вход — байты пикселей
// и миллиметры, выход — байты файла. Поэтому он целиком проверяется в Node
// (`test/pdf.test.js`): тест разбирает собранный документ своим кодом и
// распаковывает поток своим `zlib`.

const PDF_MM_PER_INCH = 25.4;
// Пункт PDF — 1/72 дюйма. Это единица страницы, другой у документа нет.
export const PDF_POINTS_PER_INCH = 72;
export const PDF_POINTS_PER_MM = PDF_POINTS_PER_INCH / PDF_MM_PER_INCH;
// Версия документа. 1.4 — всё, что нужно картинке со `FlateDecode`; выше
// задирать версию нечем, а ниже `DecodeParms` с предсказателем уже не везде.
const PDF_VERSION = "1.4";
// Признак двоичного файла: четыре байта старше 127 в комментарии второй
// строки. Без них программа передачи может решить, что файл текстовый, и
// «починить» переводы строк — а это сломает смещения в таблице ссылок.
const PDF_BINARY_MARK = [0xe2, 0xe3, 0xcf, 0xd3];
// Запись таблицы ссылок — ровно 20 байт: десять цифр смещения, пробел, пять
// цифр поколения, пробел, буква вида и два знака конца строки. Любая другая
// длина — испорченный файл. Число вынесено наружу, потому что по нему тест
// разбирает таблицу: разойдись запись со спецификацией, прогон покраснеет.
export const PDF_XREF_ENTRY = 20;

/** Миллиметры в пункты, с точностью до сотой пункта (это 3,5 мкм бумаги). */
export function pdfPoints(mm) {
  const value = Number(mm);
  if (!Number.isFinite(value) || !(value > 0)) return 0;
  return Math.round(value * PDF_POINTS_PER_MM * 100) / 100;
}

/**
 * Число в записи PDF: максимум две цифры после запятой, без хвостовых нулей,
 * всегда с точкой (в файле нет локали, и запятая в нём — разделитель массива).
 */
export function pdfNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "0";
  const rounded = Math.round(number * 100) / 100;
  if (rounded === 0) return "0";
  return rounded.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

/**
 * Строка документа в шестнадцатеричной записи UTF-16BE с меткой порядка байтов.
 *
 * Имя объекта по-русски, а однобайтовой кодировки, в которой его можно было бы
 * написать прямо, у PDF нет: `PDFDocEncoding` кириллицу не содержит. Поэтому
 * имя и название идут сюда — это единственный текст в документе, и шрифта он
 * не требует (его рисует программа просмотра своим).
 */
export function pdfTextString(value) {
  const source = value == null ? "" : String(value);
  let out = "FEFF";
  for (const char of source) {
    const code = char.codePointAt(0);
    if (code > 0xffff) {
      const rest = code - 0x10000;
      out += pdfHex4(0xd800 + (rest >> 10)) + pdfHex4(0xdc00 + (rest & 0x3ff));
    } else {
      out += pdfHex4(code);
    }
  }
  return "<" + out + ">";
}

function pdfHex4(code) {
  return code.toString(16).toUpperCase().padStart(4, "0");
}

/**
 * Дата документа: `D:20261009153000+03'00'`.
 *
 * День и час — местные, как и дата в основной надписи листа: UTC соврал бы на
 * вечерней выгрузке так же, как в имени файла проекта.
 */
export function pdfDate(date) {
  const at = date instanceof Date ? date : new Date();
  const pad = (value, size = 2) => String(Math.abs(value)).padStart(size, "0");
  // getTimezoneOffset считает «сколько прибавить к местному, чтобы получить
  // UTC» — знак обратный тому, что пишут в документе.
  const offset = -at.getTimezoneOffset();
  const sign = offset < 0 ? "-" : "+";
  return (
    "D:" +
    pad(at.getFullYear(), 4) +
    pad(at.getMonth() + 1) +
    pad(at.getDate()) +
    pad(at.getHours()) +
    pad(at.getMinutes()) +
    pad(at.getSeconds()) +
    sign +
    pad(Math.trunc(Math.abs(offset) / 60)) +
    "'" +
    pad(Math.abs(offset) % 60) +
    "'"
  );
}

/**
 * Пиксели холста (RGBA) в поток для картинки PDF: по три байта на точку и
 * **байт фильтра PNG перед каждой строкой**.
 *
 * Альфа отбрасывается, и это безопасно: все холсты выгрузки заливаются белым до
 * первой линии (`schemePng`, `drawGostFrame`), прозрачных точек на листе нет.
 * Четвёртого канала у `DeviceRGB` нет вовсе, а тащить его отдельной маской
 * значило бы положить в файл вдвое больше ради заведомо непрозрачного листа.
 *
 * Фильтр — «Up» (код 2): из байта вычитается байт над ним. Это та же разность
 * по вертикали, которой PNG сжимает чертёж, и `FlateDecode` умеет её разбирать
 * сам (`/Predictor 15`). На листе с рамкой, таблицей и подписями она стоит
 * одного вычитания на байт и отыгрывает кратную разницу в размере: ряды
 * одинаковых строк и белые поля становятся нулями.
 */
export function pdfImageRows(rgba, width, height) {
  const columns = Math.max(0, Math.trunc(width));
  const stride = columns * 3;
  const rows = Math.max(0, Math.trunc(height));
  const out = new Uint8Array(rows * (stride + 1));
  const previous = new Uint8Array(stride);
  const current = new Uint8Array(stride);
  for (let y = 0; y < rows; y += 1) {
    let from = y * columns * 4;
    for (let x = 0; x < stride; x += 3) {
      current[x] = rgba[from];
      current[x + 1] = rgba[from + 1];
      current[x + 2] = rgba[from + 2];
      from += 4;
    }
    const at = y * (stride + 1);
    out[at] = 2;
    for (let i = 0; i < stride; i += 1) out[at + 1 + i] = (current[i] - previous[i]) & 0xff;
    previous.set(current);
  }
  return out;
}

/**
 * Те же пиксели без сжатия и без байтов фильтра — запасной путь для браузера
 * без `CompressionStream`. Лист A4 при 300 dpi весит тогда 26 МБ вместо
 * полумегабайта, но открывается и печатается: пустой файл был бы хуже.
 */
export function pdfImageBytes(rgba, width, height) {
  const points = Math.max(0, Math.trunc(width)) * Math.max(0, Math.trunc(height));
  const out = new Uint8Array(points * 3);
  for (let i = 0, from = 0, at = 0; i < points; i += 1) {
    out[at] = rgba[from];
    out[at + 1] = rgba[from + 1];
    out[at + 2] = rgba[from + 2];
    at += 3;
    from += 4;
  }
  return out;
}

async function pdfCollect(readable) {
  const reader = readable.getReader();
  const parts = [];
  let total = 0;
  for (;;) {
    const step = await reader.read();
    if (step.done) break;
    const chunk = step.value instanceof Uint8Array ? step.value : new Uint8Array(step.value);
    parts.push(chunk);
    total += chunk.length;
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/**
 * Сжатие потока картинки. `null` — браузер не умеет, лист пойдёт как есть.
 *
 * Это **не вторая реализация zip**: своего сжатия в сборке по-прежнему одно —
 * никакого, алгоритм в обоих местах браузерный. Отличается обёртка: zip
 * требует «сырой» deflate (`deflate-raw`), `FlateDecode` в PDF — zlib
 * (RFC 1950, с заголовком и контрольной суммой). Поэтому вызов свой, а не
 * позаимствованный у `projectFile.js`: взять там значило бы отдать PDF поток
 * без заголовка, и документ не открылся бы.
 */
export async function pdfDeflate(bytes) {
  if (typeof CompressionStream !== "function") return null;
  return pdfCollect(new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate")));
}

/**
 * Картинка страницы из пикселей холста: `{width, height, data, flate}`.
 * Готова к укладке в документ — `pdfDocument` байтов больше не трогает.
 */
export async function pdfImage(rgba, width, height) {
  const rows = pdfImageRows(rgba, width, height);
  const packed = await pdfDeflate(rows);
  if (packed) return { width, height, data: packed, flate: true };
  return { width, height, data: pdfImageBytes(rgba, width, height), flate: false };
}

function pdfLatin(value) {
  const out = new Uint8Array(value.length);
  for (let i = 0; i < value.length; i += 1) out[i] = value.charCodeAt(i) & 0xff;
  return out;
}

function pdfImageDict(image) {
  const parms = image.flate
    ? " /Filter /FlateDecode /DecodeParms << /Predictor 15 /Colors 3 /BitsPerComponent 8 /Columns " +
      image.width +
      " >>"
    : "";
  return (
    "<< /Type /XObject /Subtype /Image /Width " +
    image.width +
    " /Height " +
    image.height +
    " /ColorSpace /DeviceRGB /BitsPerComponent 8" +
    parms +
    " /Length " +
    image.data.length +
    " >>"
  );
}

/**
 * Документ целиком: байты файла.
 *
 * `pages` — массив `{widthMm, heightMm, image}`, по странице на лист. Миллиметры
 * берутся **у формата листа**, а не пересчитываются из пикселей: холст
 * округляется до целой точки (A4 при 300 dpi — 2480 px вместо 2480,31), и
 * обратный пересчёт дал бы 209,97 мм вместо 210. Картинка растягивается на
 * страницу целиком — на 0,03 мм её никто не поймает, а бумага обязана быть
 * ровно той, что написана на коробке.
 *
 * Строение простое и нарочно плоское: каталог, список страниц, словарь
 * документа, а дальше по три объекта на страницу (страница, её содержимое,
 * картинка). Таблица ссылок — классическая, со смещениями: поток ссылок
 * (PDF 1.5) сэкономил бы десятки байт на файле в полмегабайта и потребовал бы
 * сжатия там, где его может не быть.
 */
export function pdfDocument(pages, meta = {}) {
  const sheets = Array.isArray(pages) ? pages : [];
  if (sheets.length === 0) throw new Error("PDF без страниц");
  const parts = [];
  let size = 0;
  const put = (part) => {
    const bytes = typeof part === "string" ? pdfLatin(part) : part;
    parts.push(bytes);
    size += bytes.length;
  };
  // Смещение каждого объекта от начала файла: именно их читает программа
  // просмотра, и соврать в них нельзя — файл станет нечитаемым.
  const offsets = [];
  const object = (number, dict, stream) => {
    offsets[number] = size;
    put(number + " 0 obj\n" + dict + "\n");
    if (stream) {
      put("stream\n");
      put(stream);
      put("\nendstream\n");
    }
    put("endobj\n");
  };

  put("%PDF-" + PDF_VERSION + "\n");
  put(new Uint8Array([0x25, ...PDF_BINARY_MARK, 0x0a]));

  // Номера объектов: 1 — каталог, 2 — список страниц, 3 — словарь документа,
  // дальше тройками. Считается это одной формулой, чтобы ссылки страницы на
  // своё содержимое и свою картинку не могли разойтись с их номерами.
  const first = 4;
  const pageNumber = (index) => first + index * 3;
  const last = first + sheets.length * 3;

  object(1, "<< /Type /Catalog /Pages 2 0 R >>");
  object(
    2,
    "<< /Type /Pages /Count " +
      sheets.length +
      " /Kids [" +
      sheets.map((_, index) => pageNumber(index) + " 0 R").join(" ") +
      "] >>",
  );
  object(
    3,
    "<< /Title " +
      pdfTextString(meta.title) +
      " /Producer " +
      pdfTextString(meta.producer) +
      " /CreationDate (" +
      pdfDate(meta.date) +
      ") >>",
  );

  for (let index = 0; index < sheets.length; index += 1) {
    const sheet = sheets[index];
    const image = sheet && sheet.image;
    if (!image || !(image.width > 0) || !(image.height > 0)) throw new Error("Страница PDF без картинки");
    const number = pageNumber(index);
    const width = pdfNumber(pdfPoints(sheet.widthMm));
    const height = pdfNumber(pdfPoints(sheet.heightMm));
    // Картинка кладётся преобразованием «растянуть на страницу»: единичный
    // квадрат картинки умножается на размер страницы в пунктах.
    const content = pdfLatin("q\n" + width + " 0 0 " + height + " 0 0 cm\n/Im0 Do\nQ\n");
    object(
      number,
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 " +
        width +
        " " +
        height +
        "] /Resources << /XObject << /Im0 " +
        (number + 2) +
        " 0 R >> >> /Contents " +
        (number + 1) +
        " 0 R >>",
    );
    object(number + 1, "<< /Length " + content.length + " >>", content);
    object(number + 2, pdfImageDict(image), image.data);
  }

  const xrefAt = size;
  let table = "xref\n0 " + last + "\n0000000000 65535 f \n";
  for (let number = 1; number < last; number += 1) {
    table += String(offsets[number]).padStart(10, "0") + " 00000 n \n";
  }
  put(table);
  put("trailer\n<< /Size " + last + " /Root 1 0 R /Info 3 0 R >>\nstartxref\n" + xrefAt + "\n%%EOF\n");

  const out = new Uint8Array(size);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}
