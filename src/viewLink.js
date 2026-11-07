// Объект в ссылке: упаковка и чтение нагрузки (G10, G11, G11.1, G14, G15, G18).
//
// Интегратор отдаёт объект заказчику одной ссылкой: весь объект лежит в части
// адреса **после решётки** и поэтому не уходит ни на сервер, ни в его логи
// (G14). Этот модуль владеет форматом нагрузки и ничем больше: ни DOM, ни
// сети, ни адреса, ни кнопки. Кодек приходит аргументом — в странице это
// brotli из `web/vendor/` (`brotliCodec.js`), в тестах `zlib`. Отсюда и
// чистота: формат проверяется в Node без браузера.
//
// Семь шагов упаковки, и порядок их не случаен:
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
//   4. переписать идентификаторы короткими — **с таблицей оригиналов**, чтобы
//      чтение вернуло те же id, и с **таблицей адресов хаба**, чтобы было чем
//      доказать, что ни одно устройство адреса не сменило (ADR 021);
//   5. заменить исходники сценариев ссылкой на библиотеку там, где она уже
//      известна (`scenario.lib`) или где реестр узнаёт исходник точно;
//   6. в оставшихся исходниках срезать комментарии и **проверить разбором**;
//      не разобралось — вернуть исходный текст (G11.1). Сценарий заказчика
//      дороже сотни знаков в адресе;
//   7. сжать кодеком и уложить в base64url.
//
// Шаги 1–3, 5 и 6 — это `viewLinkStrip`: чистка без сжатия, по которой удобно
// мерить и с которой **сверяется круговой прогон**. Шаги 4 и 7 обратимы
// целиком, поэтому `viewLinkRead(viewLinkPack(p))` даёт ровно
// `viewLinkStrip(p)` — поле в поле.
//
// **Почему оригиналы id едут в нагрузке, а не выбрасываются.** Короткие id
// без таблицы оригиналов делают ссылку вдвое короче — и это единственное, что
// они дают. Цена: адрес аксессуара считается из `mark.id`
// (`deviceAid`, ADR 012), и у переписанной метки он становится другим. Вернуть
// его, не храня id, можно было бы только одним способом — пройти по исходникам
// сценариев и переписать в них числа адресов. А адрес в тексте сценария — это
// обычное девятизначное число: отличить его от порога, задержки или цвета
// нечем, и такая правка молча испортила бы код интегратора. Догадку показывают,
// а не применяют: id остаются своими, адреса остаются своими, а длина ссылки —
// то, чем за это заплачено (ADR 021).

import { strings, text } from "./strings.js";
// Адреса хаба считает дом — второго счёта здесь не заводится: иначе таблица в
// нагрузке и таблица в доме разошлись бы на первой же правке `deviceAid`.
import { deviceAids } from "./sim/home.js";

/** Версия формата нагрузки. Поднимается, когда прежний читатель её не поймёт. */
export const VIEW_LINK_VERSION = 1;
/** Имя параметра в адресе: `#o=<нагрузка>`. */
export const VIEW_LINK_PARAM = "o";
/** Код отказа чтения: битая, обрезанная, чужая строка. */
export const VIEW_LINK_BROKEN = "viewLinkBroken";
/** Разделы объекта, которые в ссылку не едут (G10, G15). */
export const VIEW_LINK_DROPPED = Object.freeze(["accepted", "equipmentTypes", "equipment", "placements"]);
// Коллекции, по которым объект узнаётся объектом (`projectFile.looksLikeProject`):
// они остаются в нагрузке даже пустыми. Пустое поле вообще-то убирается, но эти
// четыре — удостоверение: без них объект, у которого ещё нет ни одной метки, не
// открылся бы ни файлом, ни ссылкой («данные не похожи на объект»).
const VIEW_LINK_KEPT = Object.freeze(["categories", "markTypes", "schemes", "marks"]);

// Знаков после точки. Шестой знак доли плана — пять сотых миллиметра на плане
// в сто метров (`test/viewLink.test.js` держит это числом).
const VIEW_LINK_DIGITS = 6;
const VIEW_LINK_SCALE = 10 ** VIEW_LINK_DIGITS;
// Выше этого числа не округляем: `v * 1e6` перестало бы влезать в точное целое
// (2^53), и округление само сдвинуло бы значение. В долях плана и
// миллиметрах таких чисел не бывает.
const VIEW_LINK_ROUND_MAX = 1e9;

// Короткий id — это знак-метка и номер в таблице по основанию 36. Знак-метка
// выбирается так, чтобы **ни одна строка объекта с него не начиналась**:
// иначе чтение приняло бы за номер чужое значение (скажем, место установки
// «~1») и подставило бы на его место идентификатор.
const VIEW_LINK_TOKEN_MARK = "~";
const VIEW_LINK_TOKEN_TRIES = 8;
const VIEW_LINK_TOKEN_BASE = 36;

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

// Перевод строки внутри комментария: четыре знака языка, два из них — не
// пробелы и не возврат, а разделители строк Unicode (0x2028, 0x2029).
function viewLinkHasBreak(body) {
  for (let at = 0; at < body.length; at += 1) {
    const code = body.charCodeAt(at);
    if (code === 10 || code === 13 || code === 0x2028 || code === 0x2029) return true;
  }
  return false;
}

/** Отказ чтения: один код на все причины, причина — отдельным полем. */
function viewLinkFail(reason, extra = {}) {
  const error = new Error(
    reason === "version"
      ? text("errors.futureVersion", { version: extra.version, current: VIEW_LINK_VERSION })
      : strings.view.linkBroken,
  );
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

// ——— шаг 6: комментарии из исходника ————————————————————————————————

/**
 * Исходник без комментариев. Строки, шаблоны и регулярные выражения
 * переписываются как есть — иначе `//` внутри кавычек съел бы половину строки.
 * Многострочный комментарий оставляет за собой перевод строки: без него две
 * строки склеились бы, и автоподстановка точки с запятой изменила бы смысл.
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
      while (i < source.length && source[i] !== "\n" && source[i] !== "\r") i += 1;
      continue;
    }
    if (ch === "/" && next === "*") {
      const end = source.indexOf("*/", i + 2);
      // Незакрытый комментарий — не наш случай: такой исходник и так не
      // разберётся, и стрижка вернёт исходный текст целиком.
      if (end < 0) return null;
      const body = source.slice(i, end + 2);
      i = end + 2;
      out.push(viewLinkHasBreak(body) ? "\n" : " ");
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
  // Хвосты пробелов и строки, ставшие пустыми: перевод строки у соседей свой,
  // склеить их выброшенная пустая строка не может.
  return out
    .join("")
    .split("\n")
    .map((line) => line.replace(/[ \t\r]+$/, ""))
    .filter((line) => line !== "")
    .join("\n");
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

// ——— шаг 5: ссылка на библиотеку —————————————————————————————————————

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
    const lib = scenario.lib && typeof scenario.lib === "object" ? scenario.lib : viewLinkLibRef(scenario.source, index);
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

// ——— шаги 1–3, 5, 6: чистка —————————————————————————————————————————

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
  for (const key of VIEW_LINK_KEPT) if (Array.isArray(next[key]) && !Array.isArray(cleaned[key])) cleaned[key] = [];
  return { project: cleaned, scenarios: { linked, inlined } };
}

// ——— шаг 4: короткие id и таблица адресов ————————————————————————————

/** Все строки-значения объекта: по ним выбирается знак-метка короткого id. */
function viewLinkWalkStrings(value, seen) {
  if (Array.isArray(value)) {
    for (const item of value) viewLinkWalkStrings(item, seen);
    return;
  }
  if (value && typeof value === "object") {
    for (const item of Object.values(value)) viewLinkWalkStrings(item, seen);
    return;
  }
  if (typeof value === "string") seen.push(value);
}

/**
 * Знак-метка, с которого не начинается ни одна строка объекта. Без такой
 * проверки короткий id `~1` нельзя было бы отличить от значения `~1`,
 * записанного человеком.
 */
function viewLinkTokenMark(project) {
  const seen = [];
  viewLinkWalkStrings(project, seen);
  for (let length = 1; length <= VIEW_LINK_TOKEN_TRIES; length += 1) {
    const mark = VIEW_LINK_TOKEN_MARK.repeat(length);
    if (!seen.some((item) => item.startsWith(mark))) return mark;
  }
  throw viewLinkFail("shape");
}

/** Идентификаторы объекта в порядке первой встречи: поля `id` на любой глубине. */
function viewLinkWalkIds(value, order, known) {
  if (Array.isArray(value)) {
    for (const item of value) viewLinkWalkIds(item, order, known);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, item] of Object.entries(value)) {
    if (key === "id" && typeof item === "string" && item !== "" && !known.has(item)) {
      known.set(item, order.length);
      order.push(item);
    }
    viewLinkWalkIds(item, order, known);
  }
}

/**
 * Замена строк по таблице — **целым значением, а не подстрокой**: ссылка на
 * метку лежит отдельным значением (`roomId`, `wallId`, запись связи), а
 * идентификатор, попавший в чьё-то примечание, остаётся словом в тексте.
 * Ключи объектов не трогаются: по ним в объекте ходят коды и имена полей, а не
 * идентификаторы.
 */
function viewLinkMapStrings(value, swap) {
  if (Array.isArray(value)) return value.map((item) => viewLinkMapStrings(item, swap));
  if (value && typeof value === "object") {
    const out = {};
    for (const [key, item] of Object.entries(value)) out[key] = viewLinkMapStrings(item, swap);
    return out;
  }
  if (typeof value !== "string") return value;
  const swapped = swap(value);
  return swapped === undefined ? value : swapped;
}

/**
 * Адреса аксессуаров объекта: `{<markId>: <aid>}`. Эта таблица уезжает в
 * нагрузку, и по ней чтение проверяет, что ни одно устройство адреса не
 * сменило (ADR 021). Считает её дом (`deviceAids`), второго счёта нет.
 */
export function viewLinkAids(project) {
  const table = {};
  for (const [markId, aid] of deviceAids(project)) table[markId] = aid;
  return table;
}

/**
 * Адреса в порядке `project.marks` — так в нагрузке лежит список, а не карта:
 * ключи в ней повторяли бы те же идентификаторы вторым разом.
 */
function viewLinkAidList(project) {
  const marks = Array.isArray(project.marks) ? project.marks : [];
  if (marks.length === 0) return null;
  // Таблица нужна там, где адрес бывает записан рукой — в тексте сценария и в
  // настройках привязки. Объекту без сценариев она не нужна, и платить за неё
  // длиной адреса незачем.
  const hasScripts =
    (Array.isArray(project.scenarios) && project.scenarios.length > 0) ||
    (Array.isArray(project.logicBindings) && project.logicBindings.length > 0);
  if (!hasScripts) return null;
  const table = deviceAids(project);
  return marks.map((mark) => (mark && table.has(mark.id) ? table.get(mark.id) : 0));
}

// ——— шаг 7: base64url ————————————————————————————————————————————————

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
  const body = stripped.project;
  const mark = viewLinkTokenMark(body);
  const order = [];
  const known = new Map();
  viewLinkWalkIds(body, order, known);
  const short = viewLinkMapStrings(body, (value) =>
    known.has(value) ? mark + known.get(value).toString(VIEW_LINK_TOKEN_BASE) : undefined,
  );
  const madeAt = opts.madeAt instanceof Date ? opts.madeAt.toISOString() : opts.madeAt || new Date().toISOString();
  const aids = viewLinkAidList(body);
  const payload = {
    v: VIEW_LINK_VERSION,
    at: String(madeAt),
    mark,
    ids: order,
    ...(aids ? { aids } : {}),
    p: short,
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
  if (typeof decompress !== "function") throw viewLinkFail("codec");
  if (typeof linkText !== "string" || linkText === "") throw viewLinkFail("payload");
  const dot = linkText.indexOf(".");
  if (dot <= 0) throw viewLinkFail("payload");
  const head = linkText.slice(0, dot);
  if (!/^[0-9]{1,4}$/.test(head)) throw viewLinkFail("payload");
  const version = Number(head);
  if (version !== VIEW_LINK_VERSION) throw viewLinkFail("version", { version });
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
  const short = payload.p;
  const mark = typeof payload.mark === "string" && payload.mark !== "" ? payload.mark : null;
  const ids = Array.isArray(payload.ids) ? payload.ids : null;
  if (!short || typeof short !== "object" || Array.isArray(short) || !mark || !ids) throw viewLinkFail("shape");
  const project = viewLinkMapStrings(short, (value) => {
    if (!value.startsWith(mark)) return undefined;
    const tail = value.slice(mark.length);
    if (!/^[0-9a-z]+$/.test(tail)) return undefined;
    const at = Number.parseInt(tail, VIEW_LINK_TOKEN_BASE);
    return Number.isInteger(at) && at >= 0 && at < ids.length && typeof ids[at] === "string" ? ids[at] : undefined;
  });
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
  const warnings = [];
  // Таблица адресов: доказательство, а не догадка. Сошлось — сценарий нашёл
  // своё устройство; не сошлось — страница скажет об этом, а не будет делать
  // вид, что дом цел.
  if (Array.isArray(payload.aids)) {
    const table = deviceAids(project);
    project.marks.forEach((item, at) => {
      const was = payload.aids[at];
      if (!item || typeof was !== "number" || was === 0) return;
      const now = table.get(item.id);
      if (now !== was) warnings.push({ code: "addressMoved", markId: item.id, was, now: now === undefined ? 0 : now });
    });
  }
  return {
    project,
    madeAt: typeof payload.at === "string" ? payload.at : "",
    version,
    warnings,
  };
}
