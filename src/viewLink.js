// Объект в ссылке: упаковка и чтение нагрузки (G10, G11, G11.1, G14, G15, G18).
//
// Интегратор отдаёт объект заказчику одной ссылкой: весь объект лежит в части
// адреса **после решётки** и поэтому не уходит ни на сервер, ни в его логи
// (G14). Этот модуль владеет форматом нагрузки и ничем больше: ни DOM, ни
// сети, ни адреса, ни кнопки. Кодек приходит аргументом — в странице это
// brotli из `web/vendor/` (`brotliCodec.js`), в тестах `zlib`. Отсюда и
// чистота: формат проверяется в Node без браузера.
//
// Шесть шагов упаковки, и порядок их не случаен:
//
//   1. выкинуть то, что не рисуется и не работает: `accepted`,
//      `equipmentTypes`, `equipment`, `placements` (G10, G15). Фотоподложек в
//      `project.json` нет вовсе — они лежат в zip файлами, — поэтому в ссылке
//      достаточно снять ссылку на картинку (`scheme.imageId`): схема без
//      подложки рисуется чертежом и метками, и это то же состояние, в котором
//      живёт схема, которой картинку не заводили (G17);
//   2. округлить числа до шести знаков после точки. Точки меток — доли плана
//      0…1 (ADR 002), и шестой знак на плане в сто метров — это пять сотых
//      миллиметра: столько не стоит ни одного знака в адресе;
//   3. убрать пустые значения (`null`, `""`, `[]`, `{}`). Это не догадка:
//      модель сама **удаляет** поле, когда значение стало пустым
//      (`setSchemeFloor`, `setSchemeAnchor`, `moveMarkOrder`), и читают такие
//      поля через умолчания. «Нет поля» и «поле пустое» в объекте — одно и то
//      же состояние;
//   4. заменить исходники сценариев ссылкой на библиотеку там, где она уже
//      известна (`scenario.lib`) или где реестр узнаёт исходник точно;
//   5. в оставшихся исходниках срезать комментарии и **проверить разбором**;
//      не разобралось — вернуть исходный текст (G11.1). Сценарий заказчика
//      дороже сотни знаков в адресе;
//   6. сжать кодеком и уложить в base64url.
//
// Шаги 1–5 — это `viewLinkStrip`: чистка без сжатия, по которой удобно мерить
// и с которой **сверяется круговой прогон**. Шаг 6 обратим целиком, поэтому
// `viewLinkRead(viewLinkPack(p))` даёт ровно `viewLinkStrip(p)` — поле в поле.
//
// **Идентификаторы едут в нагрузке как есть** (таск 04 связи меток и вещей,
// G10). Прежде шагов было семь, и четвёртым id переписывались знаками
// (`~0`, `~1`) **с таблицей оригиналов** (`ids`), потому что без неё чтение не
// вернуло бы те же id, и с **таблицей адресов хаба** (`aids`), потому что
// адрес аксессуара считался хэшем от `mark.id` и у переписанной метки
// становился другим. Обе таблицы держались на одном: id был 36-значным uuid.
//
// Теперь id сущности — короткий номер (`"17"`), уникальный внутри своего вида
// (ADR 038), а адрес аксессуара — номер метки, и своей двери у него нет
// (ADR 012, 034, 039: `idNumberOf(mark.id)` по месту). Переписывать короткое
// коротким нечего, таблица оригиналов повторяла бы те же номера вторым разом,
// а таблица адресов доказывала бы то, что теперь верно по условию: адрес не
// может переехать, пока не переехал номер.
//
// Чем это заплачено по замеру на четырёх рабочих объектах: снятие таблиц даёт
// 5,3–7,2% знаков, а вместе с самой перенумерацией ссылка короче на 28–50%.
// Большую часть выигрыша дают номера, а не снятие таблиц, — и это ответ на
// прикидку «таблица занимала 27–50%»: столько она занимала, пока в ней лежали
// uuid.
//
// Поэтому версия нагрузки поднята: прежняя ссылка несёт короткие id и без
// таблицы читается мусором, и такую нагрузку читатель обязан отвергнуть
// словами, а не принять криво (ADR 021: мигрировать ссылку некому — она живёт
// в адресе, а не в файле).

// Ссылку на библиотечный скрипт принимает **модель** и только она
// (`scenarioLibOf`: отпечаток — 64 знака SHA-256, иначе ссылки нет). Своей
// проверки здесь не заводится: разойдись они, упаковка снимала бы текст против
// ссылки, которой в объекте не существует, — и заказчик остался бы без
// сценария вовсе (ревью ветки, F1).
import { scenarioLibOf } from "./model.js";
import { strings, text } from "./strings.js";

/**
 * Версия формата нагрузки. Поднимается, когда прежний читатель её не поймёт.
 * Вторая — нагрузка без таблицы прежних номеров меток и без коротких id (таск
 * 04 связи меток и вещей): ссылка первой версии читается мусором, и чтение
 * отказывает ей по версии.
 */
export const VIEW_LINK_VERSION = 2;
/** Имя параметра в адресе: `#o=<нагрузка>`. */
export const VIEW_LINK_PARAM = "o";
/** Код отказа чтения: битая, обрезанная, чужая строка. */
export const VIEW_LINK_BROKEN = "viewLinkBroken";
/** Разделы объекта, которые в ссылку не едут (G10, G15). */
export const VIEW_LINK_DROPPED = Object.freeze(["accepted", "equipmentTypes", "equipment", "placements"]);
// Коллекции, которые есть у **любого** объекта, и потому остаются в нагрузке
// даже пустыми. Пустое поле вообще-то убирается, но здесь «нет поля» и «поле
// пустое» — разные состояния, и это не теория:
//
//   — `categories`, `markTypes`, `schemes`, `marks` — удостоверение объекта
//     (`projectFile.looksLikeProject`): без них объект, у которого ещё нет ни
//     одной метки, не открылся бы ни файлом, ни ссылкой;
//   — `rooms`, `outlines`, `groups`, `counters` дописывает обе трубы открытия
//     (`projectFile.migrateProject`, `projectsMigrateStored`), и читатели ходят
//     в них без оглядки: `project.rooms.map` в фильтрах, `project.groups.find`
//     в сцене «Объёма», `project.counters[code]` в нумерации. Объект, пришедший
//     ссылкой, обязан нести те же коллекции, что объект из файла, — иначе дом
//     без групп или без помещений не открывается вовсе (ревью ветки, F1).
//
// `counters` — объект, остальные — списки: пустые значения у них разные, и
// восстанавливается то, что стояло в объекте.
const VIEW_LINK_KEPT = Object.freeze([
  "categories",
  "markTypes",
  "schemes",
  "marks",
  "rooms",
  "outlines",
  "groups",
  "counters",
]);

// Знаков после точки. Шестой знак доли плана — пять сотых миллиметра на плане
// в сто метров (`test/viewLink.test.js` держит это числом).
const VIEW_LINK_DIGITS = 6;
const VIEW_LINK_SCALE = 10 ** VIEW_LINK_DIGITS;
// Выше этого числа не округляем: `v * 1e6` перестало бы влезать в точное целое
// (2^53), и округление само сдвинуло бы значение. В долях плана и
// миллиметрах таких чисел не бывает.
const VIEW_LINK_ROUND_MAX = 1e9;

const VIEW_LINK_B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
// Обратная таблица: номер знака по его коду. Знак не из алфавита даёт
// `VIEW_LINK_B64_NONE`, и такая строка — битая ссылка, а не мусорный объект.
const VIEW_LINK_B64_NONE = 255;
const VIEW_LINK_B64_BACK = (() => {
  const back = new Uint8Array(128).fill(VIEW_LINK_B64_NONE);
  for (let index = 0; index < VIEW_LINK_B64.length; index += 1) back[VIEW_LINK_B64.charCodeAt(index)] = index;
  return back;
})();

// Разбор исходника сценария: слова, после которых косая черта открывает
// регулярное выражение, а не делит. Тот же разбор, которым сборка срезает
// комментарии (`build.stripComments`) — своего правила здесь не заводится,
// повторяется только то, что в бандл страницы не попадает.
const VIEW_LINK_REGEX_AFTER = new Set([
  "return", "typeof", "instanceof", "in", "of", "new", "delete", "void", "throw", "case", "do", "else", "yield", "await",
]);
// Знак слова или числа — по коду, а не по набору: за латиницей и цифрами
// начинается всё остальное письмо, и имя переменной по-русски здесь законно.
function viewLinkIsWord(ch) {
  if (ch === undefined) return false;
  const code = ch.charCodeAt(0);
  if (code >= 0x80) return true;
  if (code >= 48 && code <= 57) return true;
  if (code >= 65 && code <= 90) return true;
  if (code >= 97 && code <= 122) return true;
  return ch === "_" || ch === "$";
}

/**
 * Переводы строк, которые были внутри комментария, — в том же порядке и тем же
 * знаком. Их четыре: перевод, возврат и два разделителя строк Unicode (0x2028,
 * 0x2029); записаны они числами, потому что экран ` ` в исходнике —
 * настоящий разделитель строк для движка JS.
 *
 * Зачем они нужны: комментарий уходит, а разметка текста остаётся прежней —
 * строки кода не склеиваются (автоподстановка точки с запятой не меняет смысл)
 * и номера строк в сообщениях об ошибке остаются своими.
 */
function viewLinkBreaksOf(body) {
  let breaks = "";
  for (let at = 0; at < body.length; at += 1) {
    const code = body.charCodeAt(at);
    if (code === 10 || code === 13 || code === 0x2028 || code === 0x2029) breaks += body[at];
  }
  return breaks;
}

/**
 * **Слова отказа по версии нагрузки — одно место на сборку** (таск 273).
 *
 * У ссылки прежней сборки и у ссылки более новой разные ответы: первую чинить
 * нечего — надо просить новую; у второй старая страница, и достаточно её
 * обновить. Прежде это решалось дважды: `viewLinkRead` брал готовую
 * `errors.futureVersion` на **любую** чужую версию — то есть говорил про
 * **файл** и про **более новую** версию каждой уже разосланной ссылке, — а
 * страница просмотра выбирала слова сама. Две развилки на один вопрос
 * расходятся; теперь развилка здесь, у хозяина формата, а дверь страницы
 * (`viewStartLinkRefusal`) её зовёт.
 */
export function viewLinkVersionSaid(version) {
  const got = Number(version);
  return Number.isFinite(got) && got > VIEW_LINK_VERSION
    ? text("view.linkNewVersion", { version: got, current: VIEW_LINK_VERSION })
    : strings.view.linkOldVersion;
}

/** Отказ чтения: один код на все причины, причина — отдельным полем. */
function viewLinkFail(reason, extra = {}) {
  const error = new Error(reason === "version" ? viewLinkVersionSaid(extra.version) : strings.view.linkBroken);
  error.code = VIEW_LINK_BROKEN;
  error.reason = reason;
  Object.assign(error, extra);
  return error;
}

// ——— шаг 2: округление ———————————————————————————————————————————————

function viewLinkRound(value) {
  if (!Number.isFinite(value) || Number.isInteger(value)) return value;
  if (Math.abs(value) >= VIEW_LINK_ROUND_MAX) return value;
  const rounded = Math.round(value * VIEW_LINK_SCALE) / VIEW_LINK_SCALE;
  // Минус ноль после округления: в JSON он пишется нулём, и обратный прогон
  // разошёлся бы с исходником на знаке, которого в числе нет.
  return rounded === 0 ? 0 : rounded;
}

// ——— шаги 2 и 3: округление и пустые поля ————————————————————————————
//
// Пустое убирается **только у ключей объекта**: в массиве на этом месте стоит
// порядок (точки ломаной, каналы связи), и выброшенный элемент сдвинул бы
// соседей.
function viewLinkClean(value) {
  if (Array.isArray(value)) return value.map(viewLinkClean);
  if (value && typeof value === "object") {
    const out = {};
    for (const [key, raw] of Object.entries(value)) {
      const cleaned = viewLinkClean(raw);
      if (cleaned === null || cleaned === undefined || cleaned === "") continue;
      if (Array.isArray(cleaned) && cleaned.length === 0) continue;
      if (cleaned && typeof cleaned === "object" && !Array.isArray(cleaned) && Object.keys(cleaned).length === 0) {
        continue;
      }
      out[key] = cleaned;
    }
    return out;
  }
  return typeof value === "number" ? viewLinkRound(value) : value;
}

// ——— шаг 5: комментарии из исходника —————————————————————————————————

/**
 * Исходник без комментариев — и **только** без них: от исходного текста он
 * отличается ровно на выкинутые комментарии, ни знаком больше.
 *
 * Строки, шаблоны и регулярные выражения переписываются дословно — иначе `//`
 * внутри кавычек съел бы половину строки. Хвостовые пробелы и пустые строки не
 * трогаются **нигде**: многострочный шаблон — это значение, и его пустая строка
 * или пробел в конце строки значат ровно столько же, сколько буква. Проверка
 * разбором такой правки не поймала бы: текст остался бы разбираемым, а строка
 * у заказчика стала бы другой.
 *
 * На месте комментария остаётся: у строчного — ничего (перевод строки за ним
 * свой и выписывается отдельно); у блочного — переводы строк, которые были
 * внутри него, а если их не было — один пробел: блочный комментарий между двумя
 * словами обязан оставить их двумя словами, а не склеить в одно.
 */
function viewLinkNoComments(source) {
  const out = [];
  let i = 0;
  let last = "punct";
  let lastWord = "";
  const frames = [];
  let depth = 0;
  // Шаблон с позиции после «`» или «}» подстановки: до «`» или «${».
  const template = () => {
    const from = i;
    while (i < source.length) {
      const ch = source[i];
      if (ch === "\\") {
        i += 2;
        continue;
      }
      if (ch === "`") {
        i += 1;
        out.push(source.slice(from, i));
        last = "value";
        return true;
      }
      if (ch === "$" && source[i + 1] === "{") {
        i += 2;
        out.push(source.slice(from, i));
        frames.push(depth);
        last = "punct";
        return true;
      }
      i += 1;
    }
    return false;
  };
  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1];
    if (ch === "/" && next === "/") {
      // До конца строки — и концом строки считается всё, что им считает движок
      // JS: иначе разделитель 0x2028 посреди файла унёс бы с собой код.
      while (i < source.length && viewLinkBreaksOf(source[i]) === "") i += 1;
      continue;
    }
    if (ch === "/" && next === "*") {
      const end = source.indexOf("*/", i + 2);
      // Незакрытый комментарий — не наш случай: такой исходник и так не
      // разберётся, и стрижка вернёт исходный текст целиком.
      if (end < 0) return null;
      const body = source.slice(i, end + 2);
      i = end + 2;
      const breaks = viewLinkBreaksOf(body);
      out.push(breaks === "" ? " " : breaks);
      continue;
    }
    if (ch === '"' || ch === "'") {
      const from = i;
      i += 1;
      while (i < source.length && source[i] !== ch) i += source[i] === "\\" ? 2 : 1;
      i += 1;
      out.push(source.slice(from, i));
      last = "value";
      continue;
    }
    if (ch === "`") {
      out.push("`");
      i += 1;
      if (!template()) return null;
      continue;
    }
    if (ch === "/" && (last === "punct" || (last === "word" && VIEW_LINK_REGEX_AFTER.has(lastWord)))) {
      const from = i;
      let inClass = false;
      i += 1;
      while (i < source.length) {
        const c = source[i];
        if (c === "\\") {
          i += 2;
          continue;
        }
        if (c === "\n") return null;
        i += 1;
        if (c === "[") inClass = true;
        else if (c === "]") inClass = false;
        else if (c === "/" && !inClass) break;
      }
      while (i < source.length && viewLinkIsWord(source[i])) i += 1;
      out.push(source.slice(from, i));
      last = "value";
      continue;
    }
    if (viewLinkIsWord(ch)) {
      const from = i;
      while (i < source.length && viewLinkIsWord(source[i])) i += 1;
      const word = source.slice(from, i);
      out.push(word);
      last = /^[0-9]/.test(word) ? "value" : "word";
      lastWord = word;
      continue;
    }
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      if (frames.length > 0 && frames[frames.length - 1] === depth) {
        frames.pop();
        out.push("}");
        i += 1;
        if (!template()) return null;
        continue;
      }
      depth -= 1;
    }
    out.push(ch);
    i += 1;
    if (ch !== " " && ch !== "\t" && ch !== "\n" && ch !== "\r") {
      last = ch === ")" || ch === "]" || ch === "}" ? "value" : "punct";
    }
  }
  // Ни хвостов пробелов, ни пустых строк здесь не срезается: такой проход шёл
  // бы по всему тексту разом — и по содержимому шаблонов, которое выше
  // переписано дословно. Пустая строка внутри многострочного шаблона — часть
  // значения, и выбросить её значит отдать заказчику другую строку.
  return out.join("");
}

/**
 * Разбирается ли текст движком JS. Не исполняет: `Function` только
 * компилирует. Имя берётся у глобала нарочно — так же, как в `hubApi.js`: в
 * потоке код из строки заперт, и прямое чтение имени здесь было бы обещанием,
 * которого модуль не даёт.
 */
function viewLinkParses(source) {
  const make = globalThis.Function;
  if (typeof make !== "function") return false;
  try {
    // Создание функции — это разбор и компиляция, а не запуск: тело не
    // исполняется ни разу, и исходник заказчика здесь ничего не делает.
    new make(source);
    return true;
  } catch {
    return false;
  }
}

/** Исходник без комментариев, если он после стрижки разбирается (G11.1). */
function viewLinkTrimSource(source) {
  if (typeof source !== "string" || source === "") return source;
  const short = viewLinkNoComments(source);
  if (short === null || short === source) return source;
  return viewLinkParses(short) ? short : source;
}

// ——— шаг 4: ссылка на библиотеку —————————————————————————————————————

/**
 * Ссылка на библиотечный скрипт для исходника или `null`. Реестр приходит
 * аргументом и делает его **таск библиотеки** (`src/scenarioLib.js`:
 * `scenarioLibRefOf`), поэтому здесь он только спрашивается:
 *
 *   — реестр с дверью `refOf(source)` отвечает сам (так его подаёт страница);
 *   — реестр записями (`Map(hash -> entry)` или список) узнаёт исходник
 *     побайтовым совпадением, если запись несёт текст (G24.1);
 *   — реестра нет — исходник едет текстом. Это не отказ: ссылка станет длиннее,
 *     и всё.
 */
function viewLinkLibRef(source, index) {
  if (!index || typeof source !== "string" || source === "") return null;
  if (typeof index.refOf === "function") {
    const ref = index.refOf(source);
    return ref && typeof ref === "object" ? ref : null;
  }
  const entries = typeof index.values === "function" ? [...index.values()] : Array.isArray(index) ? index : [];
  for (const entry of entries) {
    if (entry && typeof entry === "object" && typeof entry.source === "string" && entry.source === source) {
      return { name: entry.name, version: entry.version, hash: entry.hash };
    }
  }
  return null;
}

/**
 * Сценарии нагрузки: исходник уезжает ссылкой на библиотеку, где она есть, и
 * текстом без комментариев, где её нет. Считает заодно, чего сколько
 * (`stats.scenarios`).
 */
function viewLinkScenarios(list, options) {
  const index = options.libraryIndex || null;
  const stripJs = options.stripJs !== false;
  let linked = 0;
  let inlined = 0;
  const scenarios = list.map((scenario) => {
    if (!scenario || typeof scenario !== "object") return scenario;
    // Ссылка — только та, которую приняла модель: и та, что уже стоит в записи,
    // и та, которую подсказал реестр. Запись, несущая текст и негодный `lib`,
    // уезжает текстом — иначе он выбрасывался бы в пользу ссылки в никуда.
    const lib = scenarioLibOf(scenario) || scenarioLibOf({ lib: viewLinkLibRef(scenario.source, index) });
    if (lib) {
      linked += 1;
      // Исходник библиотечного сценария в нагрузке не нужен: страница скачает
      // его по ссылке и держит в кэше (G23–G27).
      const { source: dropped, ...rest } = scenario;
      return { ...rest, lib };
    }
    if (typeof scenario.source !== "string" || scenario.source === "") return scenario;
    inlined += 1;
    return stripJs ? { ...scenario, source: viewLinkTrimSource(scenario.source) } : scenario;
  });
  return { scenarios, linked, inlined };
}

// ——— шаги 1–5: чистка ————————————————————————————————————————————————

/**
 * Объект, очищенный для ссылки: без выкинутых разделов и подложек, с
 * округлёнными числами, без пустых полей и без комментариев в исходниках
 * сценариев. Сжатия и коротких id здесь нет — это то, с чем сверяется круговой
 * прогон и на чём мерят длину.
 *
 * `opts`: `{libraryIndex, stripJs}` (см. `viewLinkPack`).
 */
export function viewLinkStrip(project, opts = {}) {
  return viewLinkStripped(project, opts).project;
}

function viewLinkStripped(project, opts = {}) {
  if (!project || typeof project !== "object") throw viewLinkFail("shape");
  const next = {};
  for (const [key, value] of Object.entries(project)) {
    if (VIEW_LINK_DROPPED.includes(key)) continue;
    next[key] = value;
  }
  // Фотоподложка в ссылку не едет (G17): остаётся схема без картинки — то же
  // состояние, в котором живёт схема, которой подложку не заводили.
  if (Array.isArray(next.schemes)) {
    next.schemes = next.schemes.map((scheme) => {
      if (!scheme || typeof scheme !== "object" || scheme.imageId === undefined) return scheme;
      const { imageId: dropped, ...rest } = scheme;
      return rest;
    });
  }
  let linked = 0;
  let inlined = 0;
  if (Array.isArray(next.scenarios)) {
    const done = viewLinkScenarios(next.scenarios, opts);
    next.scenarios = done.scenarios;
    linked = done.linked;
    inlined = done.inlined;
  }
  const cleaned = viewLinkClean(next);
  // Пустая коллекция возвращается на место такой, какой была: список списком,
  // карта картой. Чего в объекте не было, не дописывается — догадку показывают,
  // а не применяют (G68).
  for (const key of VIEW_LINK_KEPT) {
    if (cleaned[key] !== undefined) continue;
    if (Array.isArray(next[key])) cleaned[key] = [];
    else if (next[key] && typeof next[key] === "object") cleaned[key] = {};
  }
  return { project: cleaned, scenarios: { linked, inlined } };
}

// ——— шаг 6: base64url ————————————————————————————————————————————————

function viewLinkEncode(bytes) {
  let out = "";
  for (let at = 0; at < bytes.length; at += 3) {
    const a = bytes[at];
    const b = bytes[at + 1];
    const c = bytes[at + 2];
    out += VIEW_LINK_B64[a >> 2];
    out += VIEW_LINK_B64[((a & 3) << 4) | (b === undefined ? 0 : b >> 4)];
    if (b === undefined) break;
    out += VIEW_LINK_B64[((b & 15) << 2) | (c === undefined ? 0 : c >> 6)];
    if (c === undefined) break;
    out += VIEW_LINK_B64[c & 63];
  }
  return out;
}

function viewLinkDecode(chars) {
  const length = chars.length;
  // Хвост в один знак невозможен: он не несёт целого байта, и такая строка
  // обрезана.
  if (length % 4 === 1) throw viewLinkFail("payload");
  const bytes = new Uint8Array(Math.floor((length * 3) / 4));
  let out = 0;
  let bits = 0;
  let acc = 0;
  for (let at = 0; at < length; at += 1) {
    const code = chars.charCodeAt(at);
    const digit = code < 128 ? VIEW_LINK_B64_BACK[code] : VIEW_LINK_B64_NONE;
    if (digit === VIEW_LINK_B64_NONE) throw viewLinkFail("payload");
    acc = (acc << 6) | digit;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes[out] = (acc >> bits) & 0xff;
      out += 1;
    }
  }
  return bytes.subarray(0, out);
}

// ——— упаковка и чтение ———————————————————————————————————————————————

/**
 * Собрать нагрузку ссылки.
 *
 * `opts`:
 *   `compress`  — `(Uint8Array) -> Promise<Uint8Array>`, обязателен (в
 *                 странице brotli, в тестах `zlib`); модуль сам ничего не
 *                 грузит;
 *   `libraryIndex` — реестр библиотеки сценариев или ничего;
 *   `madeAt`    — дата выгрузки (`Date` или строка ISO), умолчание — сейчас;
 *   `stripJs`   — срезать комментарии в исходниках (умолчание — да).
 *
 * Отдаёт `{text, bytes, stats:{json, packed, chars, scenarios:{linked,
 * inlined}}}`. `chars` — длина `text` знак в знак: по ней окно выгрузки
 * говорит заказчику, влезет ли ссылка в сообщение.
 */
export async function viewLinkPack(project, opts = {}) {
  const compress = opts.compress;
  if (typeof compress !== "function") throw viewLinkFail("codec");
  const stripped = viewLinkStripped(project, opts);
  const madeAt = opts.madeAt instanceof Date ? opts.madeAt.toISOString() : opts.madeAt || new Date().toISOString();
  // Объект едет как есть: id в нём — номера, и ни переписывать их короткими, ни
  // вести таблицы прежних номеров и адресов больше незачем (шапка модуля).
  const payload = {
    v: VIEW_LINK_VERSION,
    at: String(madeAt),
    p: stripped.project,
  };
  const json = new TextEncoder().encode(JSON.stringify(payload));
  const packed = await compress(json);
  const bytes = packed instanceof Uint8Array ? packed : new Uint8Array(packed);
  // Версия стоит **перед** сжатым куском: читатель узнаёт чужой формат, не
  // распаковывая, и может сказать об этом словами, а не «ссылка битая».
  const result = VIEW_LINK_VERSION + "." + viewLinkEncode(bytes);
  return {
    text: result,
    bytes,
    stats: {
      json: json.length,
      packed: bytes.length,
      chars: result.length,
      scenarios: stripped.scenarios,
    },
  };
}

/**
 * Прочитать нагрузку ссылки: `{project, madeAt, version, warnings}`.
 *
 * `opts.decompress` — `(Uint8Array) -> Promise<Uint8Array>`, обязателен.
 *
 * Битая, обрезанная и чужая строка бросают ошибку с `code ===
 * VIEW_LINK_BROKEN` и причиной в `reason` (`payload`, `codec`, `shape`,
 * `version`) — мусорного объекта наружу не выходит.
 */
export async function viewLinkRead(linkText, opts = {}) {
  const decompress = opts.decompress;
  if (typeof linkText !== "string" || linkText === "") throw viewLinkFail("payload");
  const dot = linkText.indexOf(".");
  if (dot <= 0) throw viewLinkFail("payload");
  const head = linkText.slice(0, dot);
  if (!/^[0-9]{1,4}$/.test(head)) throw viewLinkFail("payload");
  const version = Number(head);
  // **Версия спрашивается раньше кодека** (таск 273), и ровно для этого она
  // стоит перед сжатым куском: по `file://` кодек не грузится (ADR 022), и
  // ссылка прежней сборки получала там «повреждена или обрезана» — то есть
  // отказ по версии, который мы знаем наверняка, подменялся догадкой о порче.
  // Отсутствие кодека ссылке своей версии по-прежнему отказ: распаковать её
  // нечем.
  if (version !== VIEW_LINK_VERSION) throw viewLinkFail("version", { version });
  if (typeof decompress !== "function") throw viewLinkFail("codec");
  const body = linkText.slice(dot + 1);
  if (body === "") throw viewLinkFail("payload");
  const bytes = viewLinkDecode(body);
  let json = null;
  try {
    const plain = await decompress(bytes);
    json = new TextDecoder().decode(plain instanceof Uint8Array ? plain : new Uint8Array(plain));
  } catch {
    throw viewLinkFail("codec");
  }
  let payload = null;
  try {
    payload = JSON.parse(json);
  } catch {
    throw viewLinkFail("payload");
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw viewLinkFail("shape");
  if (payload.v !== VIEW_LINK_VERSION) throw viewLinkFail("version", { version: payload.v });
  const project = payload.p;
  if (!project || typeof project !== "object" || Array.isArray(project)) throw viewLinkFail("shape");
  // Объект это или чужая строка, случайно давшаяся распаковать: тот же вопрос,
  // что задаёт файлу `looksLikeProject`.
  if (
    typeof project.id !== "string" ||
    !Array.isArray(project.markTypes) ||
    !Array.isArray(project.schemes) ||
    !Array.isArray(project.marks)
  ) {
    throw viewLinkFail("shape");
  }
  return {
    project,
    madeAt: typeof payload.at === "string" ? payload.at : "",
    version,
    // Замечаний у чтения больше не бывает: прежде здесь сверялась таблица
    // адресов хаба (`addressMoved`), а адрес — номер метки, и переехать он без
    // номера не может. Поле остаётся дверью: страница просмотра читает его
    // списком и скажет о новом замечании, не меняя своего кода.
    warnings: [],
  };
}
