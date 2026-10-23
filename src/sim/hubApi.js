// Эмуляция API Sprut.Hub для логических и глобальных JS-сценариев, условий-кода
// и блоков-кода блочных сценариев (таск 06 сценариев; истории 3.7, 4.11,
// 4.20, 5.1, 5.3, 5.5–5.10, 5.13, 5.14; `research/spruthub-tools.md`).
//
// Чистый модуль без DOM: живёт в бандле движка (Worker) и в странице. Здесь:
//
//   — разбор файла (`hubScriptRead`): `.js` и JSON экспорта `scenarioTemplate`;
//   — сканер исходника (строки, шаблоны, регулярные выражения, комментарии,
//     скобки) — для имён верхнего уровня, строки синтаксической ошибки и
//     предупреждений совместимости с Nashorn хаба (`hubCompatWarnings`);
//   — компиляция в своей области (`hubScriptCompile`): код идёт внутри
//     `with (область)` в нестрогом режиме, область — `Proxy`, который ловит
//     **все** свободные имена. Присваивание без `var` (`info = {…}`) и `var`
//     верхнего уровня оседают в памяти **этого** сценария и не протекают ни в
//     соседний сценарий, ни в `globalThis`; общая память — только
//     `GlobalVariables`/`global`. Окно, документ, объект проекта, `postMessage`
//     сценарию не видны: из стандартных имён отдаются только имена языка.
//     Это изоляция сценариев друг от друга, а не песочница от злого умысла;
//     от зависания защищает Worker (таск 07);
//   — мир хаба над дверью движка (`hubWorld`): `Hub`, `Accessory`, `Service`,
//     `Characteristic`, `Room`, таймеры `Task` и `Cron` по времени имитации,
//     `Date` имитации, журнал с `{}`, заглушки сети и почты;
//   — хозяин скриптов для движка (`createHubOwner`): цикл хаба `trigger`/
//     `compute`/`onStart`, эхо собственной записи, цепочки `context`,
//     привязки к сервисам с опциями и `variables`, формы опций и исполнитель
//     кода для блочного хозяина (`runCode`).
//
// Значения. Скрипт видит значения так, как их отдаёт хаб: логика — `true/
// false`, числа — числами, перечисления и нажатия — **числовыми кодами**
// (`OccupancyDetected === 1`, одиночное нажатие — `0`). Движок хранит
// перечисления именами констант; перевод — по словарю `sim/catalog.js`.
//
// Время. «Сейчас» — часы движка (`host.now()`, местные миллисекунды). `Date`
// сценария собирает местное время из `getUTC`-частей этого числа: у имитации
// нет часового пояса, `getHours()` — час на стене (`interfaces.md`, таск 02).
import { CLOCK_DAY_MS } from "../clockMath.js";
import { text } from "../strings.js";
import { HUB_CHAR_TYPES, HUB_SERVICE_TYPES } from "./hubTypes.js";
import { cronNextAt, sunTimes } from "./schedule.js";

/** Имя хозяина скриптов в движке. */
export const HUB_OWNER_NAME = "hub";
/** Виды сценариев, которые исполняет хозяин скриптов. */
export const HUB_KINDS = Object.freeze(["logic", "global"]);
/** Сколько символов строки журнала от `console` оставляется. */
export const HUB_LOG_MAX = 2000;
/** Источник действия человека в цепочке `context` (`WEB[Имитация]_<время>`). */
export const HUB_WEB_SOURCE = "Имитация";

// Перечисления для скриптов: значение — имя (как в ScenarioSimulator,
// `HC.On === "On"`), опечатка в имени даёт `undefined`, а не исключение.
const HUB_HS = Object.freeze(Object.fromEntries(Object.keys(HUB_SERVICE_TYPES).map((name) => [name, name])));
const HUB_HC = Object.freeze(Object.fromEntries(Object.keys(HUB_CHAR_TYPES).map((name) => [name, name])));

// Конструктор функций берётся у языка, а не голым именем: имя `Function`
// сценарию не отдаётся вовсе.
const HubFunction = globalThis.Function;
const HUB_SCOPE = "__hubScope__";
const HUB_EXPORT = "__hubExport__";
// Стандартные имена языка, которые видит сценарий; остальное у `globalThis`
// (окно, документ, `postMessage`, `fetch`…) — `undefined`.
const HUB_BUILTINS = new Set(
  (
    "Object Array Number String Boolean Symbol Math JSON RegExp Error TypeError RangeError SyntaxError " +
    "ReferenceError EvalError URIError Map Set WeakMap WeakSet parseInt parseFloat isNaN isFinite encodeURI " +
    "encodeURIComponent decodeURI decodeURIComponent escape unescape Infinity NaN undefined ArrayBuffer " +
    "DataView Int8Array Uint8Array Uint8ClampedArray Int16Array Uint16Array Int32Array Uint32Array " +
    "Float32Array Float64Array Intl Reflect"
  ).split(" "),
);
const HUB_OWN = Object.prototype.hasOwnProperty;

function hubHas(object, key) {
  return object !== null && object !== undefined && HUB_OWN.call(object, key);
}

function hubList(value) {
  return Array.isArray(value) ? value : [];
}

// ——— сканер исходника ————————————————————————————————————————————————————

const HUB_ID_START = /[\p{ID_Start}$_]/u;
const HUB_ID_PART = /[\p{ID_Continue}$\u200c\u200d]/u;
const HUB_NUMBER = /^(?:0[xXoObB][\da-fA-F_]+n?|(?:\d[\d_]*\.?[\d_]*|\.\d[\d_]*)(?:[eE][+-]?\d+)?n?)/;
const HUB_PUNCTS = [
  ">>>=", "...", "===", "!==", "**=", "<<=", ">>=", ">>>", "&&=", "||=", "??=",
  "=>", "==", "!=", "<=", ">=", "&&", "||", "??", "?.", "++", "--", "+=", "-=", "*=", "/=", "%=", "&=", "|=", "^=",
  "<<", ">>", "**",
];
// После этих слов косая черта начинает регулярное выражение, а не деление.
const HUB_REGEX_AFTER = new Set([
  "return", "typeof", "instanceof", "in", "of", "new", "delete", "void", "throw", "case", "do", "else", "yield", "await",
]);
const HUB_OPENERS = { "(": ")", "[": "]", "{": "}" };

/**
 * Лексемы исходника: `{type: "name"|"num"|"str"|"tpl"|"regex"|"punct", value,
 * line, depth}` (`depth` — сколько скобок открыто; у пары скобок он один и
 * тот же, у содержимого — на единицу больше) и первая ошибка разбора `{line,
 * message}` — незакрытая строка, шаблон, комментарий, регулярное выражение,
 * лишняя или незакрытая скобка.
 */
function hubScan(source) {
  const code = String(source);
  const tokens = [];
  const stack = [];
  let index = 0;
  let line = 1;
  let error = null;
  const fail = (at, message) => {
    if (!error) error = { line: at, message };
  };
  const regexAllowed = () => {
    const prev = tokens.length > 0 ? tokens[tokens.length - 1] : null;
    if (!prev) return true;
    if (prev.type === "name") return HUB_REGEX_AFTER.has(prev.value);
    if (prev.type === "punct") return !(prev.value === ")" || prev.value === "]" || prev.value === "}" || prev.value === "++" || prev.value === "--");
    return false;
  };
  const push = (type, value, at, depth) => tokens.push({ type, value, line: at, depth });

  // Шаблон с позиции после «`» или после «}» подстановки; true — дошёл до «${».
  const template = () => {
    const at = line;
    while (index < code.length) {
      const ch = code[index];
      if (ch === "\\") {
        if (code[index + 1] === "\n") line += 1;
        index += 2;
        continue;
      }
      if (ch === "`") {
        index += 1;
        push("tpl", "`", at, stack.length);
        return false;
      }
      if (ch === "$" && code[index + 1] === "{") {
        index += 2;
        push("tpl", "${", at, stack.length);
        stack.push({ ch: "${", line });
        return true;
      }
      if (ch === "\n") line += 1;
      index += 1;
    }
    fail(at, "Unterminated template literal");
    return false;
  };

  while (index < code.length && !error) {
    const ch = code[index];
    if (ch === "\n") {
      line += 1;
      index += 1;
      continue;
    }
    if (ch === " " || ch === "\t" || ch === "\r" || ch === "\f" || ch === "\v" || ch === "\u00a0" || ch === "\ufeff" || ch === "\u2028" || ch === "\u2029") {
      index += 1;
      continue;
    }
    if (ch === "/" && code[index + 1] === "/") {
      while (index < code.length && code[index] !== "\n") index += 1;
      continue;
    }
    if (ch === "/" && code[index + 1] === "*") {
      const at = line;
      const end = code.indexOf("*/", index + 2);
      if (end < 0) {
        fail(at, "Unexpected end of input");
        break;
      }
      for (let k = index; k < end; k += 1) if (code[k] === "\n") line += 1;
      index = end + 2;
      continue;
    }
    if (ch === "'" || ch === '"') {
      const at = line;
      let k = index + 1;
      let closed = false;
      while (k < code.length) {
        const c = code[k];
        if (c === "\\") {
          if (code[k + 1] === "\n") line += 1;
          if (code[k + 1] === "\r" && code[k + 2] === "\n") {
            line += 1;
            k += 1;
          }
          k += 2;
          continue;
        }
        if (c === ch) {
          closed = true;
          break;
        }
        if (c === "\n") break;
        k += 1;
      }
      if (!closed) {
        fail(at, "Invalid or unexpected token");
        break;
      }
      push("str", code.slice(index + 1, k), at, stack.length);
      index = k + 1;
      continue;
    }
    if (ch === "`") {
      index += 1;
      template();
      continue;
    }
    if (HUB_ID_START.test(ch)) {
      let k = index + 1;
      while (k < code.length && HUB_ID_PART.test(code[k])) k += 1;
      push("name", code.slice(index, k), line, stack.length);
      index = k;
      continue;
    }
    if (/\d/.test(ch) || (ch === "." && /\d/.test(code[index + 1] || ""))) {
      const match = HUB_NUMBER.exec(code.slice(index, index + 64));
      const length = match ? match[0].length : 1;
      push("num", code.slice(index, index + length), line, stack.length);
      index += length;
      continue;
    }
    if (ch === "/" && regexAllowed()) {
      const at = line;
      let k = index + 1;
      let inClass = false;
      let closed = false;
      while (k < code.length) {
        const c = code[k];
        if (c === "\n") break;
        if (c === "\\") {
          k += 2;
          continue;
        }
        if (c === "[") inClass = true;
        else if (c === "]") inClass = false;
        else if (c === "/" && !inClass) {
          closed = true;
          break;
        }
        k += 1;
      }
      if (!closed) {
        fail(at, "Invalid regular expression: missing /");
        break;
      }
      k += 1;
      while (k < code.length && HUB_ID_PART.test(code[k])) k += 1;
      push("regex", code.slice(index, k), at, stack.length);
      index = k;
      continue;
    }
    if (ch === "(" || ch === "[" || ch === "{") {
      push("punct", ch, line, stack.length);
      stack.push({ ch, line });
      index += 1;
      continue;
    }
    if (ch === ")" || ch === "]" || ch === "}") {
      const top = stack.length > 0 ? stack[stack.length - 1] : null;
      if (ch === "}" && top && top.ch === "${") {
        stack.pop();
        index += 1;
        template();
        continue;
      }
      if (!top || HUB_OPENERS[top.ch] !== ch) {
        fail(line, "Unexpected token '" + ch + "'");
        break;
      }
      stack.pop();
      push("punct", ch, line, stack.length);
      index += 1;
      continue;
    }
    let punct = ch;
    for (const candidate of HUB_PUNCTS) {
      if (code.startsWith(candidate, index)) {
        punct = candidate;
        break;
      }
    }
    // «a ? .5 : 1» — тернарный оператор с дробью, а не «?.».
    if (punct === "?." && /\d/.test(code[index + 2] || "")) punct = "?";
    push("punct", punct, line, stack.length);
    index += punct.length;
  }
  if (!error && stack.length > 0) {
    const open = stack[stack.length - 1];
    fail(open.line, open.ch === "${" ? "Unterminated template literal" : "Unexpected end of input");
  }
  return { tokens, error, lines: line };
}

// Индекс парной скобки для лексемы-скобки `at` (или -1).
function hubPair(tokens, at) {
  const open = tokens[at];
  const close = HUB_OPENERS[open.value];
  for (let k = at + 1; k < tokens.length; k += 1) {
    const token = tokens[k];
    if (token.depth === open.depth && token.type === "punct" && token.value === close) return k;
  }
  return -1;
}

function hubPairBack(tokens, at) {
  const close = tokens[at];
  const open = close.value === ")" ? "(" : close.value === "]" ? "[" : "{";
  for (let k = at - 1; k >= 0; k -= 1) {
    const token = tokens[k];
    if (token.depth === close.depth && token.type === "punct" && token.value === open) return k;
  }
  return -1;
}

// Есть ли внутри пары скобок `{` или `[` прямо на первом уровне.
function hubPatternInside(tokens, from, to) {
  const depth = tokens[from].depth + 1;
  for (let k = from + 1; k < to; k += 1) {
    const token = tokens[k];
    if (token.depth === depth && token.type === "punct" && (token.value === "{" || token.value === "[")) return true;
  }
  return false;
}

function hubIsWord(token, value) {
  return Boolean(token) && token.type === "name" && token.value === value;
}

function hubIsPunct(token, value) {
  return Boolean(token) && token.type === "punct" && token.value === value;
}

// Свойство (`a.class`) или ключ объекта (`{class: 1}`) — не ключевое слово.
function hubIsProperty(tokens, at) {
  const prev = tokens[at - 1];
  const next = tokens[at + 1];
  return hubIsPunct(prev, ".") || hubIsPunct(prev, "?.") || (hubIsPunct(next, ":") && (hubIsPunct(prev, "{") || hubIsPunct(prev, ",")));
}

/**
 * Предупреждения совместимости с хабом (история 5.13): `[{code, line}]` в
 * порядке исходника, коды `class`, `async` (и `await`), `destructuring`,
 * `optionalChain`, `spread` (и rest). Nashorn хаба этих конструкций не знает;
 * имитация их исполняет, предупреждение исполнению не мешает.
 */
export function hubCompatWarnings(source) {
  const { tokens } = hubScan(source);
  const out = [];
  const add = (code, line) => out.push({ code, line });
  for (let at = 0; at < tokens.length; at += 1) {
    const token = tokens[at];
    const next = tokens[at + 1];
    if (token.type === "punct") {
      if (token.value === "?.") add("optionalChain", token.line);
      else if (token.value === "...") add("spread", token.line);
      else if (token.value === "=>") {
        const prev = tokens[at - 1];
        if (hubIsPunct(prev, ")")) {
          const open = hubPairBack(tokens, at - 1);
          if (open >= 0 && hubPatternInside(tokens, open, at - 1)) add("destructuring", tokens[open].line);
        }
      }
      continue;
    }
    if (token.type !== "name" || hubIsProperty(tokens, at)) continue;
    switch (token.value) {
      case "class":
        if (next && (next.type === "name" || hubIsPunct(next, "{"))) add("class", token.line);
        break;
      case "async":
        if (hubIsWord(next, "function") || (next && next.type === "name" && hubIsPunct(tokens[at + 2], "=>"))) add("async", token.line);
        else if (hubIsPunct(next, "(")) {
          const close = hubPair(tokens, at + 1);
          if (close > 0 && hubIsPunct(tokens[close + 1], "=>")) add("async", token.line);
        }
        break;
      case "await":
        if (next && (next.type === "name" || next.type === "num" || next.type === "str" || hubIsPunct(next, "("))) add("async", token.line);
        break;
      case "var":
      case "let":
      case "const":
        if (hubIsPunct(next, "{") || hubIsPunct(next, "[")) add("destructuring", token.line);
        break;
      case "function": {
        let k = at + 1;
        if (hubIsPunct(tokens[k], "*")) k += 1;
        if (tokens[k] && tokens[k].type === "name") k += 1;
        if (hubIsPunct(tokens[k], "(")) {
          const close = hubPair(tokens, k);
          if (close > 0 && hubPatternInside(tokens, k, close)) add("destructuring", token.line);
        }
        break;
      }
      default:
        break;
    }
  }
  return out;
}

// Имена, объявленные на верхнем уровне сценария: `function`, `let`, `const`,
// `class` (они живут в блоке обёртки) и `var`; плюс признаки вида.
function hubTopLevel(tokens) {
  const block = new Set();
  let info = false;
  let trigger = false;
  for (let at = 0; at < tokens.length; at += 1) {
    const token = tokens[at];
    if (token.depth !== 0 || token.type !== "name" || hubIsPunct(tokens[at - 1], ".")) continue;
    const next = tokens[at + 1];
    if (token.value === "function") {
      let k = at + 1;
      if (hubIsPunct(tokens[k], "*")) k += 1;
      const name = tokens[k];
      if (name && name.type === "name") {
        block.add(name.value);
        if (name.value === "trigger" || name.value === "compute") trigger = true;
      }
    } else if (token.value === "class") {
      if (next && next.type === "name") block.add(next.value);
    } else if (token.value === "let" || token.value === "const" || token.value === "var") {
      // Имена через запятую на том же уровне: `const a = f(1, 2), b = 3`.
      let expectName = true;
      for (let k = at + 1; k < tokens.length; k += 1) {
        const item = tokens[k];
        if (item.depth !== 0) continue;
        if (expectName) {
          if (item.type !== "name") break;
          if (token.value !== "var") block.add(item.value);
          if (item.value === "info" && hubIsPunct(tokens[k + 1], "=") && hubIsPunct(tokens[k + 2], "{")) info = true;
          expectName = false;
          continue;
        }
        if (hubIsPunct(item, ",")) expectName = true;
        else if (hubIsPunct(item, ";") || (item.type === "name" && (item.value === "var" || item.value === "let" || item.value === "const" || item.value === "function"))) break;
        else if (item.line !== tokens[k - 1].line && !hubIsPunct(tokens[k - 1], "=") && !hubIsPunct(tokens[k - 1], ",") && item.type === "name") break;
      }
    } else if (token.value === "info" && hubIsPunct(next, "=") && hubIsPunct(tokens[at + 2], "{")) {
      info = true;
    }
  }
  return { block: [...block], logic: info && trigger };
}

// ——— компиляция ——————————————————————————————————————————————————————————

let hubCompileSeq = 0;
let hubLineShift = null;

// На сколько строк обёртка сдвигает исходник в стеке ошибки — узнаётся пробой:
// у разных движков заголовок `new Function` разный.
function hubLineOffset() {
  if (hubLineShift !== null) return hubLineShift;
  hubLineShift = 0;
  try {
    const probe = new HubFunction(HUB_SCOPE, "with (" + HUB_SCOPE + ") {\nthrow new Error('probe');\n}\n//# sourceURL=hub-probe.js");
    probe({});
  } catch (error) {
    const found = hubStackLine(error, "hub-probe.js");
    if (found !== null) hubLineShift = found - 1;
  }
  return hubLineShift;
}

function hubStackLine(error, url) {
  const stack = error && typeof error.stack === "string" ? error.stack : "";
  const at = stack.indexOf(url + ":");
  if (at < 0) return null;
  const match = /^:(\d+)/.exec(stack.slice(at + url.length));
  return match ? Number(match[1]) : null;
}

function hubErrorMessage(error) {
  if (error && typeof error.message === "string") return error.message;
  return String(error);
}

// Строка синтаксической ошибки: сначала — что нашёл сканер; иначе — самая
// короткая голова исходника (целыми строками), которая падает с тем же
// текстом ошибки, что и весь исходник. Пока ошибки в голове нет, её разбор
// кончается «неожиданным концом» — текст другой; поиск двоичный.
function hubSyntaxLine(source, scan, message) {
  if (scan.error) return scan.error.line;
  const lines = source.split("\n");
  const fails = (count) => {
    try {
      new HubFunction(HUB_SCOPE, "with (" + HUB_SCOPE + ") {\n" + lines.slice(0, count).join("\n"));
      return false;
    } catch (error) {
      return hubErrorMessage(error) === message;
    }
  };
  if (!fails(lines.length)) {
    for (let k = lines.length; k >= 1; k -= 1) if (lines[k - 1].trim()) return k;
    return 1;
  }
  let low = 1;
  let high = lines.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (fails(middle)) high = middle;
    else low = middle + 1;
  }
  return low;
}

// Область сценария: свободное имя ищется в своей памяти, потом в API хаба,
// потом среди имён языка; запись свободного имени — только в свою память.
function hubScope(store, globals) {
  return new Proxy(Object.create(null), {
    has: (target, key) => typeof key === "string",
    get: (target, key) => {
      if (typeof key !== "string") return undefined;
      if (HUB_OWN.call(store, key)) return store[key];
      if (HUB_OWN.call(globals, key)) return globals[key];
      if (HUB_BUILTINS.has(key)) return globalThis[key];
      return undefined;
    },
    set: (target, key, value) => {
      if (typeof key === "string") store[key] = value;
      return true;
    },
    deleteProperty: (target, key) => {
      if (typeof key === "string") delete store[key];
      return true;
    },
  });
}

function hubTypeofRead(name) {
  return "(typeof " + name + ' === "undefined" ? undefined : ' + name + ")";
}

/**
 * Скомпилировать исходник сценария. `mode`: `"script"` — логический или
 * глобальный (наружу — `info`, `trigger`, `compute` и все имена верхнего
 * уровня), `"code"` — условие-код или блок-код (тело функции: `return` на
 * верхнем уровне — результат).
 *
 * Ответ — `{run(globals) -> {info, trigger, compute, exports, value, scope},
 * lineOf(error) -> line | null, url, lines}` или `{error, line}` при
 * синтаксической ошибке (текст движка JS и строка исходника, с 1). `run`
 * исполняет верхний уровень в свежей памяти; исключение летит наружу,
 * `lineOf` переводит его в строку исходника.
 */
export function hubScriptCompile(source, { mode = "script" } = {}) {
  const code = String(source === null || source === undefined ? "" : source);
  const scan = hubScan(code);
  hubCompileSeq += 1;
  const url = "hub-" + hubCompileSeq + ".js";
  const head = "with (" + HUB_SCOPE + ") {\n";
  let body = head + code + "\n}";
  if (mode === "script") {
    const names = new Set(["info", "trigger", "compute", ...hubTopLevel(scan.tokens).block]);
    const picks = [...names].map((name) => JSON.stringify(name) + ": " + hubTypeofRead(name));
    body = head + code + "\n;return { " + HUB_EXPORT + ": true, names: { " + picks.join(", ") + " } };\n}";
  }
  let fn;
  try {
    fn = new HubFunction(HUB_SCOPE, body + "\n//# sourceURL=" + url);
  } catch (error) {
    const message = hubErrorMessage(error);
    let plain = null;
    try {
      new HubFunction(HUB_SCOPE, head + code + "\n}");
    } catch (inner) {
      plain = hubErrorMessage(inner);
    }
    return { error: message, line: plain === null ? null : hubSyntaxLine(code, scan, plain) };
  }
  const lines = scan.lines;
  return {
    url,
    lines,
    lineOf(error) {
      const at = hubStackLine(error, url);
      if (at === null) return null;
      const line = at - hubLineOffset();
      return line >= 1 && line <= lines ? line : null;
    },
    run(globals) {
      const store = Object.create(null);
      const scope = hubScope(store, globals && typeof globals === "object" ? globals : {});
      const value = fn.call(scope, scope);
      if (mode !== "script") return { value, scope, store, exports: store, info: undefined, trigger: undefined, compute: undefined };
      const marked = value && typeof value === "object" && value[HUB_EXPORT] === true ? value.names : null;
      const exports = {};
      for (const key of Object.keys(store)) exports[key] = store[key];
      if (marked) for (const key of Object.keys(marked)) if (marked[key] !== undefined) exports[key] = marked[key];
      return { value, scope, store, exports, info: exports.info, trigger: exports.trigger, compute: exports.compute };
    },
  };
}

// ——— разбор файла ————————————————————————————————————————————————————————

function hubFileStem(fileName) {
  const base = String(fileName || "").split(/[\\/]/).pop() || "";
  return base.replace(/\.(js|json)$/i, "");
}

function hubTemplateOf(template) {
  return {
    name: typeof template.name === "string" ? template.name : "",
    desc: typeof template.desc === "string" ? template.desc : "",
    active: template.active !== false,
    onStart: template.onStart === true,
    sync: template.sync === true,
  };
}

function hubReadScript(kind, source, origin, fileName, template) {
  const compiled = hubScriptCompile(source);
  const out = {
    kind,
    source,
    origin,
    fileName: fileName || "",
    name: template ? template.name : hubFileStem(fileName),
    syntax: compiled.error === undefined ? null : { line: compiled.line, message: compiled.error },
    warnings: hubCompatWarnings(source),
  };
  if (template) out.template = template;
  return out;
}

/** Вид исходника по содержимому: `info = {…}` и `trigger`/`compute` верхнего уровня — логический. */
function hubKindOf(source) {
  return hubTopLevel(hubScan(source).tokens).logic ? "logic" : "global";
}

// ——— имя сценария без исполнения (ревью ветки, F1) —————————————————————————
//
// Загрузка и вставка текста в странице код сценария не исполняют: `while(true)`
// повесил бы страницу насовсем, а верхний уровень дотянулся бы до `window`.
// Имя берётся разбором лексем: `info = {name: …}` верхнего уровня, где `name`
// — строка, константа верхнего уровня или её поле (`scenarioName.ru`), или
// объект `{ru, en}`. Всё, что без исполнения не узнать, — `null`.

const HUB_NAME_ESCAPES = { n: "\n", t: "\t", r: "\r", b: "\b", f: "\f", v: "\v", 0: "\0" };
const HUB_NAME_DEPTH = 4;

// Текст строкового литерала из его сырого содержимого (без кавычек).
function hubUnquote(raw) {
  let out = "";
  for (let at = 0; at < raw.length; at += 1) {
    const ch = raw[at];
    if (ch !== "\\") {
      out += ch;
      continue;
    }
    const next = raw[at + 1];
    at += 1;
    if (next === undefined) break;
    if (next === "\n") continue;
    if (next === "\r") {
      if (raw[at + 1] === "\n") at += 1;
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(HUB_NAME_ESCAPES, next) && !(next === "0" && /\d/.test(raw[at + 1] || ""))) {
      out += HUB_NAME_ESCAPES[next];
      continue;
    }
    if (next === "x" && /^[0-9a-fA-F]{2}$/.test(raw.slice(at + 1, at + 3))) {
      out += String.fromCharCode(parseInt(raw.slice(at + 1, at + 3), 16));
      at += 2;
      continue;
    }
    if (next === "u" && raw[at + 1] === "{") {
      const end = raw.indexOf("}", at + 2);
      const code = end > 0 ? parseInt(raw.slice(at + 2, end), 16) : NaN;
      if (Number.isFinite(code) && code <= 0x10ffff) {
        out += String.fromCodePoint(code);
        at = end;
        continue;
      }
    }
    if (next === "u" && /^[0-9a-fA-F]{4}$/.test(raw.slice(at + 1, at + 5))) {
      out += String.fromCharCode(parseInt(raw.slice(at + 1, at + 5), 16));
      at += 4;
      continue;
    }
    out += next;
  }
  return out;
}

// Значение кончается здесь: дальше разделитель, конец текста или новая строка.
function hubNameEnds(tokens, end) {
  const next = tokens[end];
  if (!next) return true;
  if (next.type === "punct") return next.value === ";" || next.value === "," || next.value === "}" || next.value === ")" || next.value === "]";
  return next.line !== tokens[end - 1].line;
}

// Начало значения поля `key` в литерале объекта, открытом скобкой `open`; -1 — нет.
function hubNameField(tokens, open, key) {
  const close = hubPair(tokens, open);
  if (close < 0) return -1;
  const depth = tokens[open].depth + 1;
  for (let at = open + 1; at < close; at += 1) {
    const token = tokens[at];
    if (token.depth !== depth || (token.type !== "name" && token.type !== "str") || token.value !== key) continue;
    const before = tokens[at - 1];
    if (!(hubIsPunct(before, "{") || hubIsPunct(before, ",")) || !hubIsPunct(tokens[at + 1], ":")) continue;
    return at + 2 < close ? at + 2 : -1;
  }
  return -1;
}

// Начало значения объявления верхнего уровня `name = …` (`const`/`let`/`var` или без них); -1 — нет.
function hubNameDecl(tokens, name) {
  for (let at = 0; at < tokens.length; at += 1) {
    const token = tokens[at];
    if (token.depth !== 0 || token.type !== "name" || token.value !== name || !hubIsPunct(tokens[at + 1], "=")) continue;
    const before = tokens[at - 1];
    if (before && hubIsPunct(before, ".")) continue;
    return at + 2;
  }
  return -1;
}

// Строка, которую выражение с лексемы `at` даёт без исполнения, или `null`.
function hubNameValue(tokens, at, depth) {
  const token = tokens[at];
  if (!token || depth > HUB_NAME_DEPTH) return null;
  if (token.type === "str") return hubNameEnds(tokens, at + 1) ? hubUnquote(token.value) : null;
  if (hubIsPunct(token, "{")) {
    const close = hubPair(tokens, at);
    if (close < 0 || !hubNameEnds(tokens, close + 1)) return null;
    for (const key of ["ru", "en"]) {
      const field = hubNameField(tokens, at, key);
      if (field >= 0) return hubNameValue(tokens, field, depth + 1);
    }
    return null;
  }
  if (token.type !== "name") return null;
  const path = [token.value];
  let end = at + 1;
  while (hubIsPunct(tokens[end], ".") && tokens[end + 1] && tokens[end + 1].type === "name") {
    path.push(tokens[end + 1].value);
    end += 2;
  }
  if (!hubNameEnds(tokens, end)) return null;
  let value = hubNameDecl(tokens, path[0]);
  for (const key of path.slice(1)) {
    if (value < 0 || !hubIsPunct(tokens[value], "{")) return null;
    value = hubNameField(tokens, value, key);
  }
  return value < 0 ? null : hubNameValue(tokens, value, depth + 1);
}

/**
 * Имя логического сценария из `info.name` — разбором текста, без исполнения:
 * строка, константа верхнего уровня, её поле или `{ru, en}`. Узнать без
 * исполнения нельзя (склейка, вызов, шаблон) — `null`.
 */
export function hubScriptInfoName(source) {
  const tokens = hubScan(String(source === null || source === undefined ? "" : source)).tokens;
  for (let at = 0; at < tokens.length; at += 1) {
    const token = tokens[at];
    if (token.depth !== 0 || token.type !== "name" || token.value !== "info" || hubIsPunct(tokens[at - 1], ".")) continue;
    if (!hubIsPunct(tokens[at + 1], "=") || !hubIsPunct(tokens[at + 2], "{")) continue;
    const field = hubNameField(tokens, at + 2, "name");
    const name = field >= 0 ? hubNameValue(tokens, field, 0) : null;
    if (typeof name === "string" && name.trim()) return name.trim();
  }
  return null;
}

/**
 * Разобрать загруженный файл сценария (история 5.1). `.js` — логический,
 * если на верхнем уровне есть `info = {…}` и `function trigger`/`compute`,
 * иначе глобальный. JSON экспорта хаба `{scenarioTemplate: {name, desc,
 * active, onStart, sync, data, type}}` — вид из `type` (`LOGIC`/`GLOBAL`).
 *
 * Ответ — `{kind: "logic"|"global", source, origin: "js"|"json", fileName,
 * name, template?: {name, desc, active, onStart, sync}, syntax: {line,
 * message} | null, warnings: [{code, line}]}`; синтаксическая ошибка не
 * мешает сохранить (`syntax`), только исполнить. Отказ — `{error}`:
 * `hubBlocks` (`TEMPLATE`, `BLOCK` и блочный экспорт — «Блочные сценарии хаба
 * загружать пока нельзя»), `hubFileUnknown` (JSON не экспорт сценария),
 * `hubFileEmpty` (пустой файл).
 */
export function hubScriptRead(source, fileName) {
  const textIn = String(source === null || source === undefined ? "" : source).replace(/^\ufeff/, "");
  if (!textIn.trim()) return { error: "hubFileEmpty" };
  const jsonName = /\.json$/i.test(String(fileName || ""));
  let data;
  let parsed = false;
  if (jsonName || textIn.trim().startsWith("{")) {
    try {
      data = JSON.parse(textIn);
      parsed = true;
    } catch {
      if (jsonName) return { error: "hubFileUnknown" };
    }
  }
  if (!parsed) return hubReadScript(hubKindOf(textIn), textIn, "js", fileName, null);
  if (!data || typeof data !== "object" || Array.isArray(data)) return { error: "hubFileUnknown" };
  const template = data.scenarioTemplate;
  if (!template || typeof template !== "object") {
    if (Array.isArray(data.targets)) return { error: "hubBlocks" };
    return { error: "hubFileUnknown" };
  }
  const type = String(template.type || "").toUpperCase();
  if (type === "TEMPLATE" || type === "BLOCK") return { error: "hubBlocks" };
  if (template.data && typeof template.data === "object") return { error: "hubBlocks" };
  if (typeof template.data !== "string") return { error: "hubFileUnknown" };
  const kind = type === "LOGIC" ? "logic" : type === "GLOBAL" ? "global" : null;
  if (!kind) return { error: "hubFileUnknown" };
  return hubReadScript(kind, template.data, "json", fileName, hubTemplateOf(template));
}

// ——— значения: движок ↔ скрипт ——————————————————————————————————————————

/** Значение движка → значение для скрипта: перечисление и нажатие — числовым кодом. */
function hubToScript(meta, value) {
  if (value === undefined || value === null) return null;
  if (meta && (meta.format === "enum" || meta.format === "event") && Array.isArray(meta.values)) {
    const found = meta.values.find((item) => item.key === value);
    return found ? found.code : value;
  }
  return value;
}

/** Значение скрипта → запись в движок (зажимает и переводит коды сам движок). */
function hubToEngine(meta, value) {
  if (meta && (meta.format === "enum" || meta.format === "event") && typeof value === "boolean") return value ? 1 : 0;
  return value;
}

function hubComparable(value) {
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    if (value === "true") return 1;
    if (value === "false") return 0;
    const number = Number(value);
    if (value.trim() !== "" && !Number.isNaN(number)) return number;
  }
  return value;
}

/** Условие `Hub.subscribeWithCondition` — как у ScenarioSimulator (`MatchEngine`). */
function hubCompare(actual, cond, expected) {
  const op = String(cond === null || cond === undefined ? "" : cond).trim();
  if (!op) return true;
  const a = hubComparable(actual);
  const b = hubComparable(String(expected === null || expected === undefined ? "" : expected));
  switch (op) {
    case "=":
    case "==":
      return a === b || String(actual) === String(expected);
    case "!=":
    case "<>":
      return a !== b && String(actual) !== String(expected);
    case ">":
      return Number(a) > Number(b);
    case "<":
      return Number(a) < Number(b);
    case ">=":
      return Number(a) >= Number(b);
    case "<=":
      return Number(a) <= Number(b);
    default:
      return true;
  }
}

// Глубокая копия начальных `variables` привязки: объекты и массивы — свои,
// остальное (числа, строки, функции) — как есть.
function hubCopy(value, seen = new Map()) {
  if (!value || typeof value !== "object") return value;
  if (seen.has(value)) return seen.get(value);
  if (Array.isArray(value)) {
    const out = [];
    seen.set(value, out);
    for (const item of value) out.push(hubCopy(item, seen));
    return out;
  }
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return value;
  const out = {};
  seen.set(value, out);
  for (const key of Object.keys(value)) out[key] = hubCopy(value[key], seen);
  return out;
}

// ——— цепочка `context` ——————————————————————————————————————————————————

function hubFrameName(value) {
  return String(value === null || value === undefined ? "" : value)
    .replace(/[[\]]/g, "")
    .replace(/\s+/g, "_");
}

function hubSeconds(at) {
  return Math.floor((Number(at) || 0) / 1000);
}

/**
 * Цепочка причин движка → строка `context` хаба (история 5.6): звенья через
 * `" <- "`, от ближайшего к исходному. `logic` — `LOGIC[<имя>_Service
 * aid.sid]` (у глобального — `GLOBAL[<имя>]`); `char` — `C[aid.sid.cid
 * Сервис.Характеристика]`; `hub` — `HUB[OnStart]`; действие человека (`web`,
 * `walk`, `door`) — `WEB[Имитация]_<секунды>`; `timer` —
 * `TIMER[<что>]_<секунды>`; `scenario` — `SCENARIO[<имя>]`. `nameOf(scenarioId)`
 * подсказывает имя, если звено его не несёт.
 */
export function hubContext(chain, nameOf) {
  const name = (cause) => {
    if (typeof cause.name === "string" && cause.name) return cause.name;
    const given = typeof nameOf === "function" ? nameOf(cause.scenarioId) : null;
    return given || cause.scenarioId || "";
  };
  return hubList(chain)
    .filter((cause) => cause && typeof cause === "object")
    .map((cause) => {
      switch (cause.k) {
        case "logic":
          if (cause.global) return "GLOBAL[" + hubFrameName(name(cause)) + "]";
          return "LOGIC[" + hubFrameName(name(cause)) + (cause.address ? "_Service " + cause.address : "") + "]";
        case "char":
          return "C[" + cause.address + " " + cause.serviceType + "." + cause.char + "]";
        case "hub":
          return "HUB[OnStart]";
        case "web":
        case "walk":
        case "door":
          return "WEB[" + HUB_WEB_SOURCE + "]_" + hubSeconds(cause.at);
        case "timer":
          return "TIMER[" + hubFrameName(cause.what || "") + "]_" + hubSeconds(cause.at);
        case "scenario":
          return "SCENARIO[" + hubFrameName(name(cause)) + "]";
        // Команда «Выполнить команду» (G16): звено между сценарием и щелчком.
        case "command":
          return "COMMAND[" + hubFrameName(cause.text || "") + "]";
        default:
          return String(cause.k || "").toUpperCase() + "[]";
      }
    })
    .join(" <- ");
}

// ——— опции привязки ————————————————————————————————————————————————————

const HUB_OPTION_TYPES = new Set(["Boolean", "Integer", "Double", "String"]);
const HUB_FORM_TYPES = new Set(["list", "status", "html"]);

function hubLabel(value) {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    if (typeof value.ru === "string") return value.ru;
    if (typeof value.en === "string") return value.en;
    const first = Object.values(value).find((item) => typeof item === "string");
    if (first) return first;
  }
  return "";
}

function hubOptionsOf(info) {
  const options = info && typeof info === "object" ? info.options : null;
  if (!options || typeof options !== "object") return [];
  return Object.entries(options).filter(([, option]) => option && typeof option === "object");
}

function hubNumberOr(value, fallback) {
  const number = typeof value === "string" && value.trim() === "" ? NaN : Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function hubCoerce(option, raw) {
  const type = HUB_OPTION_TYPES.has(option.type) ? option.type : null;
  switch (type) {
    case "Boolean":
      if (raw === true || raw === 1 || raw === "true" || raw === "1") return true;
      if (raw === false || raw === 0 || raw === "false" || raw === "0" || raw === null || raw === undefined || raw === "") return false;
      return Boolean(raw);
    case "Integer":
    case "Double": {
      let number = hubNumberOr(raw, hubNumberOr(option.value, 0));
      if (type === "Integer") number = Math.round(number);
      if (typeof option.minValue === "number") number = Math.max(number, option.minValue);
      if (typeof option.maxValue === "number") number = Math.min(number, option.maxValue);
      return number;
    }
    case "String": {
      const value = raw === null || raw === undefined ? "" : String(raw);
      return typeof option.maxLength === "number" && option.maxLength >= 0 ? value.slice(0, option.maxLength) : value;
    }
    default:
      return raw === undefined ? null : raw;
  }
}

/**
 * Значения опций привязки: на каждую опцию `info.options` — значение
 * привязки или умолчание `value`, приведённое к типу (`Boolean`, `Integer` и
 * `Double` с `minValue…maxValue`, `String` с `maxLength`). Как на хабе: опция
 * всегда есть и всегда своего типа; ключей, которых `info` не знает, нет.
 */
export function hubOptionValues(info, given) {
  const out = {};
  for (const [key, option] of hubOptionsOf(info)) {
    out[key] = hubCoerce(option, hubHas(given, key) ? given[key] : option.value);
  }
  return out;
}

/**
 * Форма опций привязки (история 5.7): `{name, description, onStart,
 * sourceServices, sourceCharacteristics, fields: [{key, type, formType,
 * label, hint, value, min, max, step, maxLength, unit, readOnly, values:
 * [{value, key, label}] | null, html?}]}`. `formType: "status"` — только
 * чтение (заголовок группы), `"html"` — текст `html` (не исполняется),
 * `"list"` — выбор из `values`. Значения — `hubOptionValues(info, values)`.
 */
export function hubOptionsForm(info, values) {
  const given = info && typeof info === "object" ? info : {};
  const resolved = hubOptionValues(given, values);
  const strings = (list) => hubList(list).filter((item) => typeof item === "string");
  return {
    name: hubLabel(given.name),
    description: hubLabel(given.description),
    onStart: given.onStart === true,
    sourceServices: strings(given.sourceServices),
    sourceCharacteristics: strings(given.sourceCharacteristics),
    fields: hubOptionsOf(given).map(([key, option]) => {
      const formType = HUB_FORM_TYPES.has(option.formType) ? option.formType : null;
      const field = {
        key,
        type: HUB_OPTION_TYPES.has(option.type) ? option.type : "String",
        formType,
        label: hubLabel(option.name) || key,
        hint: hubLabel(option.desc),
        value: resolved[key],
        min: typeof option.minValue === "number" ? option.minValue : null,
        max: typeof option.maxValue === "number" ? option.maxValue : null,
        step: typeof option.step === "number" ? option.step : typeof option.minStep === "number" ? option.minStep : null,
        maxLength: typeof option.maxLength === "number" ? option.maxLength : null,
        unit: typeof option.unit === "string" ? option.unit : null,
        readOnly: formType === "status" || formType === "html",
        values:
          formType === "list"
            ? hubList(option.values)
                .filter((item) => item && typeof item === "object")
                .map((item) => ({
                  value: item.value === undefined ? null : item.value,
                  key: typeof item.key === "string" ? item.key : null,
                  label: hubLabel(item.name) || String(item.value === undefined ? "" : item.value),
                }))
            : null,
      };
      if (formType === "html") field.html = option.value === null || option.value === undefined ? "" : String(option.value);
      return field;
    }),
  };
}

/**
 * Подходит ли логический сценарий сервису (история 5.7): тип сервиса — в
 * `info.sourceServices`, и у сервиса есть характеристика из
 * `info.sourceCharacteristics`. `service` — сервис аксессуара `{type, chars:
 * [{type}]}`.
 */
export function hubFits(info, service) {
  if (!info || !service) return false;
  const services = hubList(info.sourceServices).filter((item) => typeof item === "string");
  const chars = hubList(info.sourceCharacteristics).filter((item) => typeof item === "string");
  if (services.length === 0 && chars.length === 0) return false;
  if (services.length > 0 && !services.includes(service.type)) return false;
  if (chars.length > 0 && !hubList(service.chars).some((char) => chars.includes(char && char.type))) return false;
  return true;
}

// ——— журнал: формат `{}` ————————————————————————————————————————————————

function hubText(value) {
  if (typeof value === "string") return value;
  if (value === undefined) return "undefined";
  if (value === null) return "null";
  if (value instanceof Error) return value.message;
  if (typeof value === "object") {
    if (!Array.isArray(value) && typeof value.toString === "function" && value.toString !== Object.prototype.toString) {
      return String(value);
    }
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

/** Строка журнала хаба: `{}` по порядку берут аргументы, лишние идут через пробел. */
function hubFormat(format, args) {
  const list = hubList(args);
  let used = 0;
  const head = (typeof format === "string" ? format : hubText(format)).replace(/\{\}/g, (match) =>
    used < list.length ? hubText(list[used++]) : match,
  );
  const tail = list.slice(used).map(hubText);
  const message = tail.length > 0 ? head + " " + tail.join(" ") : head;
  return message.length > HUB_LOG_MAX ? message.slice(0, HUB_LOG_MAX) + "…" : message;
}

// ——— `Date` имитации ————————————————————————————————————————————————————

// Строка даты без пояса читается как местное время имитации, то есть как UTC.
function hubDateParse(value) {
  const textIn = String(value).trim();
  if (/(?:Z|[+-]\d\d:?\d\d|\bGMT\b|\bUTC\b)$/i.test(textIn) || /^\d{4}-\d\d-\d\d$/.test(textIn)) return Date.parse(textIn);
  if (/^\d{4}-\d\d-\d\dT[\d:.]+$/.test(textIn)) return Date.parse(textIn + "Z");
  const local = Date.parse(textIn);
  if (!Number.isFinite(local)) return local;
  return local - new Date(local).getTimezoneOffset() * 60000;
}

const HUB_DATE_LOCAL = [
  ["getFullYear", "getUTCFullYear"],
  ["getMonth", "getUTCMonth"],
  ["getDate", "getUTCDate"],
  ["getDay", "getUTCDay"],
  ["getHours", "getUTCHours"],
  ["getMinutes", "getUTCMinutes"],
  ["getSeconds", "getUTCSeconds"],
  ["getMilliseconds", "getUTCMilliseconds"],
  ["setFullYear", "setUTCFullYear"],
  ["setMonth", "setUTCMonth"],
  ["setDate", "setUTCDate"],
  ["setHours", "setUTCHours"],
  ["setMinutes", "setUTCMinutes"],
  ["setSeconds", "setUTCSeconds"],
  ["setMilliseconds", "setUTCMilliseconds"],
];

/**
 * `Date` для сценариев: `new Date()` и `Date.now()` — время имитации
 * `now()`; местные части (`getHours`, `setDate`…) — `getUTC`-части, пояса
 * нет (`getTimezoneOffset() === 0`); `new Date(год, месяц, …)` — местное
 * время имитации. `instanceof Date` по-прежнему верно.
 */
function hubDateClass(now) {
  const HubDate = function (...args) {
    if (!new.target) return new HubDate().toString();
    let value;
    if (args.length === 0) value = now();
    else if (args.length === 1) {
      const given = args[0];
      value = given instanceof Date ? given.getTime() : typeof given === "string" ? hubDateParse(given) : Number(given);
    } else {
      value = Date.UTC(...args.map(Number));
    }
    const date = new Date(value);
    Object.setPrototypeOf(date, HubDate.prototype);
    return date;
  };
  HubDate.prototype = Object.create(Date.prototype, { constructor: { value: HubDate, writable: true, configurable: true } });
  for (const [local, utc] of HUB_DATE_LOCAL) {
    HubDate.prototype[local] = function (...args) {
      return Date.prototype[utc].apply(this, args);
    };
  }
  HubDate.prototype.getYear = function () {
    return this.getUTCFullYear() - 1900;
  };
  HubDate.prototype.getTimezoneOffset = () => 0;
  HubDate.prototype.toString = function () {
    return Number.isNaN(this.getTime()) ? "Invalid Date" : this.toUTCString().replace("GMT", "GMT+0000");
  };
  HubDate.prototype.toDateString = function () {
    return this.toUTCString().slice(0, 16);
  };
  HubDate.prototype.toTimeString = function () {
    return this.toUTCString().slice(17).replace("GMT", "GMT+0000");
  };
  for (const name of ["toLocaleString", "toLocaleDateString", "toLocaleTimeString"]) {
    HubDate.prototype[name] = function (locales, options) {
      return Date.prototype[name].call(this, locales, { ...(options && typeof options === "object" ? options : {}), timeZone: "UTC" });
    };
  }
  HubDate.now = () => now();
  HubDate.UTC = (...args) => Date.UTC(...args);
  HubDate.parse = (value) => hubDateParse(value);
  return HubDate;
}

// ——— солнце `Cron.sunrise` / `Cron.sunset` ——————————————————————————————

// Сутки, которые разрешает выражение cron (поля дня, месяца и дня недели);
// выражения нет или полей не шесть — каждый день.
function hubSunDay(spec, dayStart) {
  const parts = String(spec === null || spec === undefined ? "" : spec)
    .trim()
    .split(/\s+/);
  if (parts.length !== 6) return true;
  return cronNextAt("0 0 0 " + parts.slice(3).join(" "), dayStart - 1) === dayStart;
}

function hubSunNext(kind, spec, offsetMin, after, site) {
  const offset = (Number(offsetMin) || 0) * 60000;
  const first = Math.floor(after / CLOCK_DAY_MS) - 1;
  for (let day = first; day <= first + 400; day += 1) {
    const start = day * CLOCK_DAY_MS;
    if (!hubSunDay(spec, start)) continue;
    const times = sunTimes(start, site);
    const span = times.setMin - times.riseMin;
    if (times.bySite && !(span > 0 && span < 1440)) continue;
    const at = (kind === "sunrise" ? times.riseAt : times.setAt) + offset;
    if (at > after) return at;
  }
  return null;
}

// ——— мир хаба над дверью движка —————————————————————————————————————————

// Сервис «Информация об аксессуаре», который у хаба есть у каждого
// аксессуара (`research/spruthub-tools.md` §7 п.18): номер 1, характеристики
// 2…7 — свободные номера до первого сервиса профиля (13).
const HUB_INFO_CHARS = ["Name", "Manufacturer", "Model", "SerialNumber", "FirmwareRevision", "C_Online"];

const HUB_FORMATS = { bool: "Boolean", int: "Integer", float: "Double", enum: "Integer", event: "Integer", string: "String" };

function hubTask(record) {
  const task = {
    clear: () => record.cancel(),
    cancel: () => record.cancel(),
    isCancelled: () => record.gone,
    toString: () => "Task[" + record.kind + "]",
  };
  return task;
}

/**
 * Мир хаба над дверью движка (`host` хозяина, `interfaces.md` «Из таска 04»):
 * обёртки `Accessory`/`Service`/`Characteristic`/`Room` над домом
 * `host.home()`, запись через `host.write` с цепочкой исполняющего сценария,
 * подписки через `host.subscribe`, `Task` таймеров и `Cron` через
 * `host.timer`, журнал через `host.log`. `dry: true` — сухой прогон (форма
 * опций без запущенного дома): записи, таймеры, подписки и журнал немы.
 *
 * Исполняющий сценарий — вершина стопки `call(context, fn)`: `context =
 * {instance, binding, chain}`; функция глобального сценария, вызванная из
 * логического, исполняется от имени логического (как на хабе).
 */
export function hubWorld(host, { dry = false } = {}) {
  const stack = [];
  const wraps = new Map();
  const names = new Map();
  const visible = new Map();
  const statusVisible = new Map();
  const notify = new Map();
  const infoValues = new Map();
  const lastEvents = new Map();
  const scripts = new Map();
  let byAid = new Map();
  let accessoryList = [];
  let roomList = [];
  let uuidSeq = 0;

  const world = {
    host,
    dry,
    globalVars: {},
    Date: hubDateClass(() => host.now()),
    acting: () => (stack.length > 0 ? stack[stack.length - 1] : null),
    reindex,
    call,
    guard,
    log,
    causeOf,
    charByAddress,
    scriptsUrl: scripts,
    resetDevices,
    noteEvent: (address, value) => lastEvents.set(address, value),
  };

  function causeOf(context) {
    const instance = context && context.instance;
    if (!instance) return null;
    if (instance.kind === "block") return { k: "scenario", scenarioId: instance.id, name: instance.name };
    const binding = context.binding;
    return {
      k: "logic",
      scenarioId: instance.id,
      bindingId: binding ? binding.binding.id : null,
      address: binding ? binding.address : null,
      name: instance.name,
      ...(instance.kind === "global" ? { global: true } : {}),
    };
  }

  function resetDevices() {
    names.clear();
    visible.clear();
    statusVisible.clear();
    notify.clear();
    infoValues.clear();
    lastEvents.clear();
  }

  // ——— индекс дома ———

  function infoService(accessory) {
    const aid = accessory.aid;
    return {
      sid: 1,
      index: -1,
      type: "AccessoryInformation",
      virtual: true,
      address: aid + ".1",
      chars: HUB_INFO_CHARS.map((type, position) => ({ cid: position + 2, type, address: aid + ".1." + (position + 2), meta: null, virtual: true })),
    };
  }

  function reindex() {
    wraps.clear();
    byAid = new Map();
    accessoryList = [];
    const home = host.home() || {};
    for (const accessory of hubList(home.accessories)) {
      if (!accessory || !Number.isFinite(accessory.aid) || byAid.has(accessory.aid)) continue;
      const services = [infoService(accessory), ...hubList(accessory.services)];
      const entry = { accessory, services, bySid: new Map(), byCid: new Map() };
      for (const service of services) {
        entry.bySid.set(service.sid, service);
        for (const char of hubList(service.chars)) entry.byCid.set(char.cid, { service, char });
      }
      byAid.set(accessory.aid, entry);
      accessoryList.push(entry);
    }
    const rooms = home.rooms;
    const named = Array.isArray(rooms)
      ? rooms.filter((room) => room && typeof room.id === "string").map((room) => ({ id: room.id, name: String(room.name || "") }))
      : rooms && typeof rooms === "object"
        ? Object.entries(rooms).map(([id, name]) => ({ id, name: String(name || "") }))
        : [];
    const known = new Set(named.map((room) => room.id));
    roomList = named.map((room) => ({ ...room }));
    if (accessoryList.some((entry) => !known.has(entry.accessory.roomId))) roomList.push({ id: null, name: text("rooms.none") });
  }

  function roomOf(entry) {
    const id = entry.accessory.roomId;
    return roomList.find((room) => room.id === id) || roomList.find((room) => room.id === null) || null;
  }

  // ——— обёртки ———

  function wrapOnce(key, make) {
    if (!wraps.has(key)) wraps.set(key, make());
    return wraps.get(key);
  }

  function accessoryWrap(entry) {
    if (!entry) return null;
    const accessory = entry.accessory;
    return wrapOnce("a" + accessory.aid, () => {
      const self = {
        getServices: (...args) => {
          let wantVisible = null;
          let wantType = null;
          for (const arg of args) {
            if (typeof arg === "boolean") wantVisible = arg;
            else if (typeof arg === "string") wantType = arg;
          }
          return entry.services
            .filter((service) => wantType === null || service.type === wantType)
            .map((service) => serviceWrap(entry, service))
            .filter((service) => wantVisible === null || service.isVisible() === wantVisible);
        },
        getService: (key) => {
          const service = serviceByKey(entry, key);
          return service ? serviceWrap(entry, service) : null;
        },
        getCharacteristic: (cid) => {
          const found = entry.byCid.get(Number(cid));
          return found ? charWrap(entry, found.service, found.char) : null;
        },
        getRoom: () => roomWrap(roomOf(entry)),
        getUUID: () => String(accessory.aid),
        getId: () => accessory.aid,
        getName: () => (names.has("a" + accessory.aid) ? names.get("a" + accessory.aid) : accessory.label || String(accessory.aid)),
        setName: (name) => {
          names.set("a" + accessory.aid, String(name));
        },
        getModel: () => text("sim.kinds." + accessory.kind),
        getModelId: () => String(accessory.kind || ""),
        getManufacturer: () => "",
        getManufacturerId: () => "",
        getSerial: () => String(accessory.markId || ""),
        getFirmware: () => "",
        getSnapshot: () => [],
        toString: () => "A[" + accessory.aid + " " + self.getName() + "]",
      };
      return self;
    });
  }

  function serviceByKey(entry, key) {
    if (typeof key === "number" || (typeof key === "string" && /^\d+$/.test(key))) return entry.bySid.get(Number(key)) || null;
    if (typeof key === "string") return entry.services.find((service) => service.type === key) || null;
    return null;
  }

  function serviceName(entry, service) {
    if (service.name) return service.name;
    const same = entry.services.filter((item) => item.type === service.type);
    const label = text("sim.services." + service.type);
    const word = label.startsWith("sim.") ? service.type : label;
    if (same.length > 1) return word + " " + (service.channel || same.indexOf(service) + 1);
    const main = entry.services.find((item) => !item.virtual && !item.aux);
    return service === main || service.virtual ? accessoryWrap(entry).getName() : word;
  }

  function serviceWrap(entry, service) {
    return wrapOnce(service.address, () => {
      const self = {
        getAccessory: () => accessoryWrap(entry),
        getCharacteristic: (key) => {
          const char =
            typeof key === "number" || (typeof key === "string" && /^\d+$/.test(key))
              ? hubList(service.chars).find((item) => item.cid === Number(key))
              : hubList(service.chars).find((item) => item.type === key);
          return char ? charWrap(entry, service, char) : null;
        },
        getCharacteristics: () => hubList(service.chars).map((char) => charWrap(entry, service, char)),
        getType: () => service.type,
        isVisible: () => (visible.has(service.address) ? visible.get(service.address) : true),
        setVisible: (on) => {
          const next = Boolean(on);
          const was = self.isVisible();
          visible.set(service.address, next);
          if (was !== next) {
            log("system", "hubVisible", { label: entry.accessory.label || "", service: self.getName(), visible: next }, { markId: entry.accessory.markId, service: service.index });
          }
        },
        getUUID: () => service.address,
        getId: () => service.sid,
        getName: () => (names.has(service.address) ? names.get(service.address) : serviceName(entry, service)),
        setName: (name) => {
          names.set(service.address, String(name));
        },
        toString: () => "S[" + service.address + " " + service.type + "]",
      };
      return self;
    });
  }

  function infoValue(entry, char) {
    if (infoValues.has(char.address)) return infoValues.get(char.address);
    const accessory = entry.accessory;
    switch (char.type) {
      case "Name":
        return accessoryWrap(entry).getName();
      case "Model":
        return text("sim.kinds." + accessory.kind);
      case "SerialNumber":
        return String(accessory.markId || "");
      case "C_Online":
        return true;
      default:
        return "";
    }
  }

  function read(entry, service, char) {
    if (char.virtual) return infoValue(entry, char);
    if (char.meta && char.meta.format === "event") return hubToScript(char.meta, lastEvents.has(char.address) ? lastEvents.get(char.address) : null);
    return hubToScript(char.meta, host.value(entry.accessory.markId, service.index, char.type));
  }

  function write(entry, service, char, value) {
    if (dry) return;
    if (char.virtual) {
      infoValues.set(char.address, value);
      return;
    }
    const context = world.acting();
    if (context && context.instance && context.instance.kind === "global") {
      // Как на хабе: код, вызванный самим глобальным сценарием, характеристик не меняет.
      log("error", "hubGlobalWrite", { label: entry.accessory.label || "", char: text("sim.chars." + char.type) }, { markId: entry.accessory.markId, service: service.index, char: char.type });
      return;
    }
    host.write({
      markId: entry.accessory.markId,
      service: service.index,
      char: char.type,
      value: hubToEngine(char.meta, value),
      chain: context ? context.chain : [],
    });
  }

  function charMetaOf(char) {
    const hub = HUB_CHAR_TYPES[char.type] || null;
    const meta = char.meta || null;
    return {
      format: meta ? HUB_FORMATS[meta.format] || "String" : hub && hub.format ? hub.format : "String",
      min: meta && meta.min !== null ? meta.min : hub ? hub.min : null,
      max: meta && meta.max !== null ? meta.max : hub ? hub.max : null,
      step: meta && meta.step !== null ? meta.step : hub ? hub.step : null,
    };
  }

  function formatValue(char, value) {
    if (char.meta && Array.isArray(char.meta.values)) {
      const found = char.meta.values.find((item) => item.code === value || item.key === value);
      if (found) {
        const label = text("sim.values." + char.type + "." + found.key);
        return label.startsWith("sim.") ? found.key : label;
      }
    }
    return value === null || value === undefined ? "" : String(value);
  }

  function charWrap(entry, service, char) {
    return wrapOnce(char.address, () => {
      const self = {
        getAccessory: () => accessoryWrap(entry),
        getService: () => serviceWrap(entry, service),
        getValue: () => read(entry, service, char),
        setValue: (value) => {
          write(entry, service, char, value);
        },
        toggle: () => {
          const value = read(entry, service, char);
          if (typeof value === "boolean") write(entry, service, char, !value);
        },
        isStatusVisible: () => (statusVisible.has(char.address) ? statusVisible.get(char.address) : true),
        setStatusVisible: (on) => {
          statusVisible.set(char.address, Boolean(on));
        },
        isNotify: () => (notify.has(char.address) ? notify.get(char.address) : false),
        setNotify: (on) => {
          notify.set(char.address, Boolean(on));
        },
        getType: () => char.type,
        getUUID: () => char.address,
        getId: () => char.cid,
        format: () => formatValue(char, read(entry, service, char)),
        getFormat: () => charMetaOf(char).format,
        getMinValue: () => charMetaOf(char).min,
        getMaxValue: () => charMetaOf(char).max,
        getMinStep: () => charMetaOf(char).step,
        getName: () => {
          const label = text("sim.chars." + char.type);
          return label.startsWith("sim.") ? char.type : label;
        },
        toString: () => "C[" + char.address + " " + service.type + "." + char.type + "]",
      };
      return self;
    });
  }

  function roomWrap(room) {
    if (!room) return null;
    return wrapOnce("r" + (room.id === null ? "" : room.id), () => ({
      getAccessories: () => accessoryList.filter((entry) => roomOf(entry) === room).map(accessoryWrap),
      getName: () => room.name,
      setName: (name) => {
        room.name = String(name);
      },
      getUUID: () => String(room.id === null ? "" : room.id),
      toString: () => "R[" + room.name + "]",
    }));
  }

  function charByAddress(aid, cid) {
    const entry = byAid.get(Number(aid));
    const found = entry ? entry.byCid.get(Number(cid)) : null;
    return found ? charWrap(entry, found.service, found.char) : null;
  }

  // ——— исполнение кода сценариев ———

  /** Исполнить `fn` от имени `context`; `{ok, value}` или `{ok: false, error}`. */
  function call(context, fn) {
    stack.push(context);
    try {
      return { ok: true, value: fn() };
    } catch (error) {
      return { ok: false, error };
    } finally {
      stack.pop();
    }
  }

  // Строка ошибки: в своём исходнике, иначе — в исходнике другого сценария
  // (функция глобального, вызванная логическим).
  function errorPlace(error, instance) {
    const own = instance && instance.compiled;
    const line = own && own.lineOf ? own.lineOf(error) : null;
    if (line !== null) return { line, script: instance.name };
    for (const [url, item] of scripts) {
      if (own && own.url === url) continue;
      const at = item.compiled.lineOf(error);
      if (at !== null) return { line: at, script: item.name };
    }
    return { line: null, script: instance ? instance.name : "" };
  }

  /** Исполнить и записать исключение в журнал (`hubError`); `true` — без исключения. */
  function guard(context, where, fn) {
    const result = call(context, fn);
    if (result.ok) return result;
    const instance = context.instance;
    const place = errorPlace(result.error, instance);
    const binding = context.binding;
    log(
      "error",
      "hubError",
      {
        name: instance ? instance.name : "",
        label: binding ? binding.accessory.label || "" : "",
        where,
        line: place.line === null ? "?" : place.line,
        script: place.script,
        message: hubErrorMessage(result.error),
      },
      { line: place.line, chain: context.chain, scenarioId: instance ? instance.id : undefined, bindingId: binding ? binding.binding.id : undefined },
    );
    result.line = place.line;
    return result;
  }

  function log(kind, code, vars, extra = {}) {
    if (dry) return;
    const context = world.acting();
    const instance = context && context.instance;
    const entry = { kind, code, vars, chain: context ? context.chain : [], ...extra };
    if (entry.scenarioId === undefined && instance) entry.scenarioId = instance.id;
    if (entry.bindingId === undefined && context && context.binding) entry.bindingId = context.binding.binding.id;
    if (entry.scenarioId === undefined) delete entry.scenarioId;
    if (entry.bindingId === undefined) delete entry.bindingId;
    host.log(entry);
  }

  // ——— задачи: подписки, таймеры, cron ———

  function actingContext() {
    return world.acting() || { instance: null, binding: null, chain: [] };
  }

  function alive(instance) {
    return !instance || (instance.alive !== false && instance.active !== false);
  }

  // `revive` — поднять задачу заново после перестройки дома (F2): движок на
  // `load` снимает подписки и таймеры хозяина, а сценарий, которого правка не
  // коснулась, хозяин не перезапускает — его задачи возвращаются сюда же.
  // `armed` — когда и что сработает у таймера, пока он ждёт.
  function makeRecord(instance, kind) {
    const record = {
      kind,
      instance,
      gone: false,
      timer: null,
      off: null,
      armed: null,
      revive: null,
      cancel: () => {
        if (record.gone) return;
        record.gone = true;
        if (record.timer !== null) host.cancelTimer(record.timer);
        record.timer = null;
        if (record.off) record.off();
        record.off = null;
        if (instance && instance.tasks) instance.tasks.delete(record);
      },
    };
    record.task = hubTask(record);
    if (instance && instance.tasks) instance.tasks.add(record);
    return record;
  }

  const records = new WeakMap();

  function remember(record) {
    records.set(record.task, record);
    return record.task;
  }

  function cancelTask(task) {
    const record = task && typeof task === "object" ? records.get(task) : null;
    if (record) record.cancel();
  }

  function subscribe(filter, handler, args) {
    if (typeof handler !== "function") throw new TypeError("Hub.subscribe: handler is not a function");
    const context = actingContext();
    const owner = { instance: context.instance, binding: context.binding };
    const record = makeRecord(owner.instance, "subscribe");
    if (dry || !host.running()) return remember(record);
    const types = (list) => {
      const out = hubList(list).filter((item) => typeof item === "string");
      return out.length > 0 ? out : undefined;
    };
    const listen = () =>
      host.subscribe({ serviceTypes: filter ? types(filter.hs) : undefined, charTypes: filter ? types(filter.hc) : undefined }, (event) => {
        if (record.gone || !alive(owner.instance)) return;
        const char = charByAddress(event.aid, event.cid);
        if (!char) return;
        const entry = byAid.get(event.aid);
        const found = entry ? entry.byCid.get(event.cid) : null;
        const value = hubToScript(found ? found.char.meta : null, event.value);
        if (filter && !hubCompare(value, filter.cond, filter.value)) return;
        const chain = [causeOf(owner), ...event.chain].filter(Boolean);
        guard({ instance: owner.instance, binding: owner.binding, chain }, "subscribe", () =>
          handler.call(owner.instance && owner.instance.self ? owner.instance.self : {}, char, value, ...args),
        );
      });
    record.off = listen();
    record.revive = () => {
      if (!record.gone) record.off = listen();
    };
    return remember(record);
  }

  function arm(record, at, fire) {
    record.armed = { at, fire };
    record.revive = () => {
      if (record.gone || !record.armed) return;
      arm(record, record.armed.at, record.armed.fire);
    };
    record.timer = host.timer(at, (when) => {
      record.timer = null;
      record.armed = null;
      if (record.gone) return;
      fire(when);
    }, record.instance ? record.instance.tag : undefined);
  }

  function timeout(fn, ms, args, repeat) {
    if (typeof fn !== "function") throw new TypeError((repeat ? "setInterval" : "setTimeout") + ": handler is not a function");
    const context = actingContext();
    const owner = { instance: context.instance, binding: context.binding };
    const record = makeRecord(owner.instance, repeat ? "interval" : "timeout");
    if (dry || !host.running()) return remember(record);
    const delay = Math.max(repeat ? 1 : 0, Number(ms) || 0);
    const what = repeat ? "setInterval" : "setTimeout";
    const fire = (at) => {
      if (!repeat) record.cancel();
      if (alive(owner.instance)) {
        const chain = [causeOf(owner), { k: "timer", at, what }].filter(Boolean);
        guard({ instance: owner.instance, binding: owner.binding, chain }, "timer", () =>
          fn.call(owner.instance && owner.instance.self ? owner.instance.self : {}, ...args),
        );
      }
      if (repeat && !record.gone) arm(record, at + delay, fire);
    };
    arm(record, host.now() + delay, fire);
    return remember(record);
  }

  function cron(kind, spec, offsetMin, fn, args) {
    if (typeof fn !== "function") throw new TypeError("Cron." + kind + ": handler is not a function");
    const next = (after) =>
      kind === "schedule" ? cronNextAt(spec, after) : hubSunNext(kind, spec, offsetMin, after, host.site ? host.site() : null);
    if (kind === "schedule" && next(host.now()) === null) throw new Error('Cron: invalid expression "' + String(spec) + '"');
    const context = actingContext();
    const owner = { instance: context.instance, binding: context.binding };
    const record = makeRecord(owner.instance, "cron");
    if (dry || !host.running()) return remember(record);
    const fire = (at) => {
      if (alive(owner.instance)) {
        const chain = [causeOf(owner), { k: "timer", at, what: "cron" }].filter(Boolean);
        guard({ instance: owner.instance, binding: owner.binding, chain }, "cron", () =>
          fn.call(owner.instance && owner.instance.self ? owner.instance.self : {}, ...args),
        );
      }
      if (!record.gone) schedule(at);
    };
    const schedule = (after) => {
      const at = next(after);
      if (at !== null && !record.gone) arm(record, at, fire);
    };
    // Перевод часов: следующий миг — от нового «сейчас».
    record.rearm = () => {
      if (record.gone) return;
      if (record.timer !== null) host.cancelTimer(record.timer);
      record.timer = null;
      schedule(host.now());
    };
    schedule(host.now());
    return remember(record);
  }

  // ——— API: заглушки сети и почты ———

  function stubLog(kind, code, vars) {
    const context = world.acting();
    log(kind, code, { name: context && context.instance ? context.instance.name : "", ...vars });
  }

  function httpRequest(method, url) {
    const state = { method, url: String(url === undefined ? "" : url), path: [], query: [] };
    const target = () => {
      let out = state.url + state.path.map((part) => "/" + encodeURIComponent(String(part))).join("");
      if (state.query.length > 0) out += (out.includes("?") ? "&" : "?") + state.query.join("&");
      return out;
    };
    const request = {};
    const chain = (name, fn) => {
      request[name] = (...args) => {
        if (fn) fn(...args);
        return request;
      };
    };
    chain("setURL", (value) => {
      state.url = String(value);
    });
    chain("queryString", (name, value) => {
      state.query.push(encodeURIComponent(String(name)) + "=" + encodeURIComponent(String(value === undefined ? "" : value)));
    });
    chain("path", (part) => state.path.push(part));
    chain("method", (value) => {
      state.method = String(value).toUpperCase();
    });
    for (const name of [
      "userInfo", "port", "header", "cookie", "reset", "field", "fieldMultipart", "body", "timeout", "connectTimeout", "readTimeout", "noCheckCertificate",
    ]) {
      chain(name);
    }
    request.send = () => {
      stubLog("http", "hubHttp", { method: state.method, url: target() });
      const response = {
        back: () => request,
        getStatus: () => 0,
        getStatusText: () => "",
        getHeaders: () => ({}),
        getCookies: () => ({}),
        getBody: () => "",
        getBinary: () => [],
        getHistory: () => [],
      };
      return response;
    };
    return request;
  }

  function builder(fields, finish) {
    const state = {};
    const made = {};
    for (const field of fields) {
      made[field] = (value) => {
        state[field] = value;
        return made;
      };
    }
    Object.assign(made, finish(state));
    return made;
  }

  function mailBuilder() {
    return builder(["host", "port", "username", "password", "from", "to", "subject", "body"], (state) => ({
      send: () => {
        stubLog("system", "hubMail", { to: hubText(state.to === undefined ? "" : state.to), subject: hubText(state.subject === undefined ? "" : state.subject) });
      },
    }));
  }

  function sshBuilder() {
    return builder(["host", "port", "username", "password"], (state) => ({
      connect: () => {
        const run = (command) => {
          stubLog("system", "hubSsh", { host: hubText(state.host === undefined ? "" : state.host), command: hubText(command) });
          return "";
        };
        return { execute: run, request: run, close: () => {}, disconnect: () => {}, isConnected: () => false };
      },
    }));
  }

  // Конструктор и одновременно построитель: `new Mail().host(…)` и `Mail.host(…)`.
  function fluent(make, fields) {
    const Fluent = function () {
      return make();
    };
    for (const field of fields) Fluent[field] = (value) => make()[field](value);
    return Fluent;
  }

  function notifyBuilder(textIn, args) {
    const state = { text: hubFormat(textIn, args), to: [] };
    const made = {
      text: (value, ...more) => {
        state.text = hubFormat(value, more);
        return made;
      },
      image: () => made,
      silent: () => made,
      debugText: () => made,
      to: (channel, ...clients) => {
        state.to.push([channel, ...clients].map(hubText).join(" "));
        return made;
      },
      send: () => {
        stubLog("notify", "hubNotify", { text: state.text, to: state.to.join(", ") });
      },
    };
    return made;
  }

  function consoleOf() {
    const write = (level) => (format, ...args) => {
      const context = world.acting();
      log(level === "error" ? "error" : "system", "hubLog", {
        name: context && context.instance ? context.instance.name : "",
        level,
        message: hubFormat(format, args),
      });
    };
    const out = {
      message: write("message"),
      info: write("info"),
      warn: write("warn"),
      error: write("error"),
      debug: write("debug"),
      trace: write("debug"),
    };
    out.log = out.message;
    return Object.freeze(out);
  }

  const consoleApi = consoleOf();

  world.api = Object.freeze({
    Hub: Object.freeze({
      getAccessory: (id) => accessoryWrap(byAid.get(Number(id)) || null),
      getAccessories: () => accessoryList.map(accessoryWrap),
      getRooms: () => roomList.map(roomWrap),
      getCharacteristic: (aid, cid) => charByAddress(aid, cid),
      getCharacteristicValue: (aid, cid) => {
        const char = charByAddress(aid, cid);
        return char ? char.getValue() : null;
      },
      setCharacteristicValue: (aid, cid, value) => {
        const char = charByAddress(aid, cid);
        if (char) char.setValue(value);
      },
      toggleCharacteristicValue: (aid, cid) => {
        const char = charByAddress(aid, cid);
        if (char) char.toggle();
      },
      subscribe: (handler, ...args) => subscribe(null, handler, args),
      subscribeWithCondition: (cond, value, hs, hc, handler, ...args) => subscribe({ cond, value, hs, hc }, handler, args),
    }),
    HS: HUB_HS,
    HC: HUB_HC,
    Cron: Object.freeze({
      schedule: (spec, handler, ...args) => cron("schedule", spec, 0, handler, args),
      sunrise: (spec, offset, handler, ...args) => cron("sunrise", spec, offset, handler, args),
      sunset: (spec, offset, handler, ...args) => cron("sunset", spec, offset, handler, args),
    }),
    setTimeout: (handler, ms, ...args) => timeout(handler, ms, args, false),
    setInterval: (handler, ms, ...args) => timeout(handler, ms, args, true),
    clearTimeout: cancelTask,
    clearInterval: cancelTask,
    clear: cancelTask,
    console: consoleApi,
    log: consoleApi,
    print: (...args) => consoleApi.message(args.map(hubText).join(" ")),
    Notify: Object.freeze({ text: (value, ...args) => notifyBuilder(value, args) }),
    HttpClient: Object.freeze(
      Object.fromEntries(["GET", "POST", "PUT", "HEAD", "DELETE", "OPTIONS", "PATCH"].map((method) => [method, (url) => httpRequest(method, url)])),
    ),
    Mail: fluent(mailBuilder, ["host", "port", "username", "password", "from", "to", "subject", "body"]),
    SSH: fluent(sshBuilder, ["host", "port", "username", "password"]),
    Utils: Object.freeze({
      uuid: () => {
        uuidSeq += 1;
        return "00000000-0000-4000-8000-" + uuidSeq.toString(16).padStart(12, "0");
      },
    }),
    UtilsNet: Object.freeze({
      wakeOnLan: (mac) => {
        stubLog("system", "hubNet", { what: "wakeOnLan", target: hubText(mac) });
      },
      getMacAddress: (target) => {
        stubLog("system", "hubNet", { what: "getMacAddress", target: hubText(target) });
        return "";
      },
      ping: (target) => {
        stubLog("system", "hubNet", { what: "ping", target: hubText(target) });
        return false;
      },
    }),
  });

  reindex();
  return world;
}

/**
 * Имена, которые видит сценарий (история 5.3): `Hub, HS, HC, Cron,
 * setTimeout, setInterval, clearTimeout, clearInterval, clear, console, log,
 * print, Notify, HttpClient, Mail, SSH, Utils, UtilsNet, GlobalVariables,
 * global, LocalVariables, Date`. `world` — `hubWorld(host)`, `instance` —
 * сценарий `{local}` (память `LocalVariables`). `GlobalVariables` и `global`
 * — одна общая память мира.
 */
export function hubGlobalsFor(world, instance) {
  return {
    ...world.api,
    GlobalVariables: world.globalVars,
    global: world.globalVars,
    LocalVariables: instance && instance.local && typeof instance.local === "object" ? instance.local : {},
    Date: world.Date,
  };
}

// ——— хозяин скриптов для движка ————————————————————————————————————————

function hubScenarioName(scenario) {
  if (scenario && typeof scenario.name === "string" && scenario.name) return scenario.name;
  if (scenario && scenario.template && typeof scenario.template.name === "string" && scenario.template.name) return scenario.template.name;
  return scenario && scenario.id ? String(scenario.id) : "";
}

/**
 * Ключ того, от чего зависит скрипт на доме `spec` (`buildHomeSpec`), — по
 * нему перестройка дома на ходу решает, перезапускать ли сценарий (F2):
 * сам сценарий (всё, кроме места в списке) и, у логического, его привязки с
 * адресами привязанных сервисов. Ключ тот же — правка сценария не коснулась:
 * хаб его не перезапускает, как не перезапускает логику правка чужого
 * сценария или устройства. Не скрипт или нет такого — `null`.
 */
export function hubScriptKey(spec, scenarioId) {
  const source = spec && typeof spec === "object" ? spec : {};
  const scenario = hubList(source.scenarios).find((item) => item && item.id === scenarioId) || null;
  if (!scenario || !HUB_KINDS.includes(scenario.kind)) return null;
  const { order: _order, ...own } = scenario;
  const bindings = [];
  if (scenario.kind === "logic") {
    for (const binding of hubList(source.logicBindings)) {
      if (!binding || binding.scenarioId !== scenarioId) continue;
      const accessory = hubList(source.accessories).find((item) => item && item.markId === binding.markId) || null;
      const service = accessory && Number.isInteger(binding.service) ? hubList(accessory.services)[binding.service] || null : null;
      bindings.push({
        binding,
        target: service
          ? { aid: accessory.aid, sid: service.sid, type: service.type, chars: hubList(service.chars).map((char) => [char.type, char.cid]) }
          : null,
      });
    }
  }
  return JSON.stringify([own, bindings]);
}

function hubIsCondition(kind) {
  return kind === "condition" || kind === "cond" || kind === "if" || kind === "check";
}

// Сухая дверь: тот же дом и те же значения, но записи, подписки, таймеры и
// журнал немы. По ней скрипт исполняется ради `info` при остановленном доме.
function hubDryHost(host) {
  return {
    ...host,
    running: () => false,
    write: () => false,
    subscribe: () => () => {},
    timer: () => null,
    cancelTimer: () => {},
    cancelTimers: () => {},
    log: () => {},
    post: () => {},
  };
}

// Дверь над одним `spec` дома без движка: значения — начальные значения
// аксессуаров (`value` у характеристик). Для формы опций в странице.
function hubSpecHost(home, { now = 0, site = null } = {}) {
  const values = new Map();
  for (const accessory of hubList(home && home.accessories)) {
    for (const service of hubList(accessory.services)) {
      for (const char of hubList(service.chars)) values.set(accessory.markId + "|" + service.index + "|" + char.type, char.value);
    }
  }
  return hubDryHost({
    name: HUB_OWNER_NAME,
    now: () => now,
    home: () => home || {},
    site: () => site || (home && home.site) || null,
    accessory: (markId) => hubList(home && home.accessories).find((item) => item.markId === markId) || null,
    value: (markId, service, char) => values.get(markId + "|" + service + "|" + char),
    values: () => ({}),
  });
}

/**
 * Хозяин скриптов для движка (`createSimEngine({owners: [createHubOwner(),
 * blocksOwner()]})`, `interfaces.md` «Из таска 04»): `name: "hub"`, `kinds:
 * ["logic", "global"]`, хуки `load, start, stop, reset, compute, run,
 * setActive, resetScenario, runCode, clock, scenarios`.
 *
 * Запуск дома — как старт хаба (истории 2.3, 5.6, 5.9): свежая
 * `GlobalVariables`; верхний уровень глобальных сценариев по порядку списка,
 * их имена — в `global`; затем верхний уровень логических (на доме объекта —
 * списки устройств для опций); затем у логических с `info.onStart` —
 * `trigger` каждой активной привязки с `context` `LOGIC[…] <- HUB[OnStart]`.
 * Дальше `trigger(source, value, variables, options, context)` — после
 * каждой записи `sourceCharacteristics` привязанного сервиса, в том числе
 * собственной (эхо: `LOGIC[X] <- C[…] <- LOGIC[X] <- …`); `compute` — до
 * записи, его значение записывается. У каждой привязки свои `options` (из
 * `info.options` и привязки) и `variables` (копия `info.variables`).
 * Перестройка дома на ходу (`start({reload: true})`) — как пересохранение:
 * скрипты исполняются заново, `GlobalVariables` остаются.
 *
 * Наружу, кроме журнала: `{type: "forms", scenarioId, bindingId, form,
 * fault}` — форма опций (`hubOptionsForm`) на каждый логический сценарий
 * (`bindingId: null` — для новой привязки) и на каждую привязку; после
 * `load` и запуска, только когда форма изменилась.
 */
export function createHubOwner() {
  let world = null;
  let dryWorld = null;
  let home = { accessories: [], scenarios: [], logicBindings: [] };
  const instances = new Map();
  const dryInstances = new Map();
  const blockInstances = new Map();
  const activeFlags = new Map();
  const cache = new Map();
  const forms = new Map();
  let computeIndex = new Map();
  let eventsOff = null;
  // Сценарии, которые перестройка дома на ходу оставила как есть (F2): `load`
  // откладывает их сюда, `start({reload: true})` возвращает им задачи.
  let held = new Map();

  function worldOf(host) {
    if (!world) world = hubWorld(host);
    return world;
  }

  function scripts() {
    return hubList(home.scenarios).filter((scenario) => scenario && HUB_KINDS.includes(scenario.kind));
  }

  function scenarioById(id) {
    return scripts().find((scenario) => scenario.id === id) || null;
  }

  function activeOf(id) {
    return activeFlags.has(id) ? activeFlags.get(id) : true;
  }

  function compileOf(source, mode) {
    const key = mode + "\u0000" + source;
    if (!cache.has(key)) cache.set(key, hubScriptCompile(source, { mode }));
    return cache.get(key);
  }

  function makeInstance(scenario, kind) {
    return {
      id: scenario.id,
      kind,
      name: hubScenarioName(scenario),
      scenario,
      local: {},
      tasks: new Set(),
      tag: "hub:" + scenario.id,
      alive: true,
      active: true,
      fault: null,
      self: null,
      compiled: null,
      info: null,
      trigger: null,
      compute: null,
      bindings: [],
    };
  }

  function kill(instance) {
    if (!instance) return;
    instance.alive = false;
    for (const record of [...instance.tasks]) record.cancel();
    for (const binding of instance.bindings) if (binding.off) binding.off();
    instance.bindings = [];
  }

  // Исполнить верхний уровень сценария в мире `into`.
  function execute(instance, into, chain) {
    const source = typeof instance.scenario.source === "string" ? instance.scenario.source : "";
    const compiled = compileOf(source, "script");
    if (compiled.error !== undefined) {
      instance.fault = { code: "syntax", line: compiled.line, message: compiled.error };
      instance.alive = false;
      into.log("error", "hubSyntax", { name: instance.name, line: compiled.line === null ? "?" : compiled.line, message: compiled.error }, { scenarioId: instance.id, line: compiled.line });
      return null;
    }
    instance.compiled = compiled;
    into.scriptsUrl.set(compiled.url, { compiled, name: instance.name });
    const context = { instance, binding: null, chain: [into.causeOf({ instance, binding: null }), ...chain] };
    let out = null;
    const result = into.guard(context, "start", () => {
      out = compiled.run(hubGlobalsFor(into, instance));
    });
    if (!result.ok || !out) {
      instance.fault = { code: "start", line: result.line === undefined ? null : result.line, message: hubErrorMessage(result.error) };
      instance.alive = false;
      return null;
    }
    instance.self = out.scope;
    if (instance.kind === "global") {
      for (const key of Object.keys(out.exports)) into.globalVars[key] = out.exports[key];
    } else {
      instance.info = out.info && typeof out.info === "object" ? out.info : null;
      instance.trigger = typeof out.trigger === "function" ? out.trigger : null;
      instance.compute = typeof out.compute === "function" ? out.compute : null;
    }
    return out;
  }

  function bindingsOf(scenarioId) {
    return hubList(home.logicBindings).filter((binding) => binding && binding.scenarioId === scenarioId);
  }

  function serviceOfBinding(host, binding) {
    const accessory = host.accessory(binding.markId);
    const service = accessory && Number.isInteger(binding.service) ? hubList(accessory.services)[binding.service] || null : null;
    return service ? { accessory, service } : null;
  }

  function sourceChars(info) {
    const list = hubList(info && info.sourceCharacteristics).filter((item) => typeof item === "string");
    return list.length > 0 ? list : null;
  }

  // Привязки логического сценария: опции, переменные, подписка движка.
  // `previous` — привязки того же сценария до перестройки дома (F2): их
  // `variables` и сами записи остаются, о пропавшем устройстве журнал уже знает.
  function bind(instance, host, previous = null) {
    for (const binding of bindingsOf(instance.id)) {
      const found = serviceOfBinding(host, binding);
      if (!found) {
        if (previous) continue;
        world.log("error", "hubBindingMissing", { name: instance.name, label: (host.accessory(binding.markId) || {}).label || "" }, {
          scenarioId: instance.id,
          bindingId: binding.id,
          markId: binding.markId,
        });
        continue;
      }
      const kept = previous ? previous.get(binding.id) || null : null;
      const runtime = kept || {
        binding,
        instance,
        variables: hubCopy(instance.info && instance.info.variables && typeof instance.info.variables === "object" ? instance.info.variables : {}),
      };
      Object.assign(runtime, {
        binding,
        accessory: found.accessory,
        service: found.service,
        address: found.service.address,
        active: binding.active !== false,
        options: Object.freeze(hubOptionValues(instance.info, binding.options)),
        chars: sourceChars(instance.info),
        off: null,
      });
      runtime.cause = world.causeOf({ instance, binding: runtime });
      instance.bindings.push(runtime);
      if (!runtime.active) continue;
      if (instance.trigger) {
        runtime.off = host.subscribe(
          { markId: binding.markId, service: found.service.index, charTypes: runtime.chars || undefined },
          (event) => fire(runtime, event, host),
        );
      }
      if (instance.compute) {
        const key = binding.markId + "|" + found.service.index;
        if (!computeIndex.has(key)) computeIndex.set(key, []);
        computeIndex.get(key).push(runtime);
      }
    }
  }

  function charOf(runtime, type) {
    return world.charByAddress(runtime.accessory.aid, (hubList(runtime.service.chars).find((char) => char.type === type) || {}).cid);
  }

  function metaOf(runtime, type) {
    const char = hubList(runtime.service.chars).find((item) => item.type === type);
    return char ? char.meta : null;
  }

  function usable(runtime) {
    return runtime.instance.alive && activeOf(runtime.instance.id) && runtime.active && runtime.instance.trigger;
  }

  function callTrigger(runtime, source, value, chain, host) {
    const instance = runtime.instance;
    host.log({
      kind: "run",
      code: "hubTrigger",
      scenarioId: instance.id,
      bindingId: runtime.binding.id,
      markId: runtime.accessory.markId,
      service: runtime.service.index,
      char: source.getType(),
      vars: { name: instance.name, label: runtime.accessory.label || "", char: text("sim.chars." + source.getType()) },
      chain,
    });
    world.guard({ instance, binding: runtime, chain }, "trigger", () =>
      instance.trigger.call(instance.self, source, value, runtime.variables, runtime.options, hubContext(chain)),
    );
  }

  function fire(runtime, event, host) {
    if (!usable(runtime)) return;
    const source = charOf(runtime, event.char);
    if (!source) return;
    callTrigger(runtime, source, hubToScript(metaOf(runtime, event.char), event.value), [runtime.cause, ...hubList(event.chain)], host);
  }

  function onStart(instance, chain, host) {
    if (!instance.alive || !instance.trigger || !instance.info || instance.info.onStart !== true) return;
    for (const runtime of instance.bindings) {
      if (!usable(runtime)) continue;
      const char = hubList(runtime.service.chars).find((item) => !runtime.chars || runtime.chars.includes(item.type));
      if (!char) continue;
      const source = charOf(runtime, char.type);
      callTrigger(runtime, source, source.getValue(), [runtime.cause, ...chain], host);
    }
  }

  // ——— формы опций ———

  function postForm(host, scenarioId, bindingId, form, fault) {
    const key = scenarioId + "|" + (bindingId === null ? "" : bindingId);
    const message = { type: "forms", scenarioId, bindingId, form, fault };
    const textOut = JSON.stringify(message);
    if (forms.get(key) === textOut) return;
    forms.set(key, textOut);
    host.post(message);
  }

  function postForms(host, list) {
    for (const instance of list.values()) {
      if (instance.kind !== "logic") continue;
      const info = instance.info;
      const fault = info ? null : instance.fault;
      postForm(host, instance.id, null, info ? hubOptionsForm(info, {}) : null, fault);
      for (const binding of bindingsOf(instance.id)) {
        postForm(host, instance.id, binding.id, info ? hubOptionsForm(info, binding.options) : null, fault);
      }
    }
  }

  // Сухой прогон: что увидит форма опций, пока дом не запущен.
  function evaluateDry(host) {
    dryWorld = hubWorld(hubDryHost(host), { dry: true });
    dryInstances.clear();
    for (const kind of ["global", "logic"]) {
      for (const scenario of scripts()) {
        if (scenario.kind !== kind) continue;
        const instance = makeInstance(scenario, kind);
        dryInstances.set(scenario.id, instance);
        execute(instance, dryWorld, [{ k: "hub", at: host.now(), what: "load" }]);
      }
    }
    postForms(host, dryInstances);
  }

  function startOne(scenario, chain, host) {
    const old = instances.get(scenario.id);
    if (old) kill(old);
    const instance = makeInstance(scenario, scenario.kind);
    instance.active = activeOf(scenario.id);
    instance.key = hubScriptKey(home, scenario.id);
    instances.set(scenario.id, instance);
    if (!instance.active) {
      instance.alive = false;
      return instance;
    }
    if (execute(instance, world, chain) && instance.kind === "logic") bind(instance, host);
    return instance;
  }

  // Сценарий, которого перестройка не коснулась, возвращается как был: те же
  // `self`, `LocalVariables`, `variables` привязок, задачи и подписки — ни
  // верхний уровень, ни `onStart` заново не исполняются (F2).
  function revive(instance, scenario, host) {
    instance.scenario = scenario;
    for (const record of [...instance.tasks]) if (typeof record.revive === "function") record.revive();
    const previous = new Map(instance.bindings.map((runtime) => [runtime.binding.id, runtime]));
    instance.bindings = [];
    if (instance.alive && instance.kind === "logic") bind(instance, host, previous);
  }

  // Оставить ли сценарий как есть при перестройке дома на ходу: ключ тот же
  // (`hubScriptKey`) и он в том же состоянии, в каком его оставил бы
  // перезапуск: жив, упал с ошибкой или выключен в объекте. Выключенный на
  // ходу (сторожем, отметкой) перестройка, как и прежде, включает заново.
  function keepable(instance) {
    if (instance.key !== hubScriptKey(home, instance.id)) return false;
    if (instance.active !== activeOf(instance.id)) return false;
    return instance.alive || instance.fault !== null || !instance.active;
  }

  function startAll(chain, host, fresh) {
    const keep = fresh ? new Map() : held;
    held = new Map();
    for (const instance of instances.values()) if (keep.get(instance.id) !== instance) kill(instance);
    if (fresh) for (const instance of keep.values()) kill(instance);
    instances.clear();
    computeIndex = new Map();
    if (fresh) {
      world.globalVars = {};
      world.resetDevices();
      blockInstances.clear();
    }
    // Последнее нажатие каждой кнопки — для `getValue()` события.
    if (eventsOff) eventsOff();
    eventsOff = host.subscribe({ charTypes: ["ProgrammableSwitchEvent"] }, (event) => world.noteEvent(event.address, event.value));
    for (const kind of ["global", "logic"]) {
      for (const scenario of scripts()) {
        if (scenario.kind !== kind) continue;
        const old = keep.get(scenario.id);
        if (old) {
          instances.set(scenario.id, old);
          revive(old, scenario, host);
        } else startOne(scenario, chain, host);
      }
    }
    postForms(host, instances);
    for (const instance of instances.values()) if (instance.kind === "logic" && !keep.has(instance.id)) onStart(instance, chain, host);
    host.scenariosChanged();
  }

  function restart(id, host, chain) {
    const scenario = scenarioById(id);
    if (!scenario || !host.running()) return;
    const old = instances.get(id);
    if (old) {
      kill(old);
      for (const [key, list] of computeIndex) computeIndex.set(key, list.filter((runtime) => runtime.instance !== old));
    }
    const instance = startOne(scenario, chain, host);
    if (instance.kind === "logic") {
      postForms(host, new Map([[id, instance]]));
      onStart(instance, chain, host);
    }
  }

  function blockInstance(request) {
    const id = request && request.scenarioId !== undefined && request.scenarioId !== null ? String(request.scenarioId) : "";
    if (!blockInstances.has(id)) {
      const scenario = { id, name: request && typeof request.name === "string" ? request.name : "" };
      const instance = makeInstance(scenario, "block");
      if (!instance.name) {
        const found = hubList(home.scenarios).find((item) => item && item.id === id);
        instance.name = found ? hubScenarioName(found) : id;
      }
      blockInstances.set(id, instance);
    }
    return blockInstances.get(id);
  }

  return {
    name: HUB_OWNER_NAME,
    kinds: [...HUB_KINDS],

    load(spec, host) {
      home = spec && typeof spec === "object" ? spec : { accessories: [], scenarios: [], logicBindings: [] };
      worldOf(host).reindex();
      activeFlags.clear();
      for (const scenario of scripts()) activeFlags.set(scenario.id, scenario.active !== false);
      // Перестройка дома на ходу — как сохранение на хабе (F2): перезапуск
      // ждёт только сценарий, которого правка коснулась; остальные отложены
      // и вернутся в `start({reload: true})`.
      for (const instance of held.values()) kill(instance);
      held = new Map();
      for (const instance of instances.values()) {
        if (host.running() && keepable(instance)) held.set(instance.id, instance);
        else kill(instance);
      }
      instances.clear();
      computeIndex = new Map();
      eventsOff = null;
      const used = new Set(scripts().map((scenario) => "script\u0000" + (typeof scenario.source === "string" ? scenario.source : "")));
      for (const key of [...cache.keys()]) if (key.startsWith("script\u0000") && !used.has(key)) cache.delete(key);
      if (!host.running()) evaluateDry(host);
    },

    start({ reload, chain }, host) {
      worldOf(host);
      startAll(hubList(chain), host, reload !== true);
    },

    stop() {
      eventsOff = null;
      for (const instance of held.values()) kill(instance);
      held = new Map();
      for (const instance of instances.values()) kill(instance);
      for (const instance of blockInstances.values()) kill(instance);
      instances.clear();
      blockInstances.clear();
      computeIndex = new Map();
    },

    reset({ chain }, host) {
      // «Сбросить дом» для скриптов — как перезагрузка хаба: всё заново.
      for (const instance of blockInstances.values()) kill(instance);
      startAll(hubList(chain), host, true);
    },

    compute(write, host) {
      const list = computeIndex.get(write.markId + "|" + write.service);
      if (!list || list.length === 0) return undefined;
      let value = write.value;
      let changed = false;
      for (const runtime of list) {
        const instance = runtime.instance;
        if (!instance.alive || !instance.compute || !activeOf(instance.id) || !runtime.active) continue;
        if (runtime.chars && !runtime.chars.includes(write.char)) continue;
        const source = charOf(runtime, write.char);
        if (!source) continue;
        const meta = metaOf(runtime, write.char);
        const cause = {
          k: "char",
          markId: write.markId,
          aid: runtime.accessory.aid,
          service: write.service,
          sid: runtime.service.sid,
          serviceType: runtime.service.type,
          char: write.char,
          cid: Number(source.getId()),
          address: source.getUUID(),
          value,
        };
        const chain = [runtime.cause, cause, ...hubList(write.chain)];
        let out;
        world.guard({ instance, binding: runtime, chain }, "compute", () => {
          out = instance.compute.call(instance.self, source, hubToScript(meta, value), runtime.variables, runtime.options, hubContext(chain));
        });
        if (out !== undefined) {
          value = hubToEngine(meta, out);
          changed = true;
        }
      }
      return changed ? value : undefined;
    },

    run(id, info, host) {
      const scenario = scenarioById(id);
      if (!scenario || !host.running()) return;
      if (scenario.kind === "global") {
        restart(id, host, hubList(info && info.chain));
        return;
      }
      // Логический сценарий кнопкой не запускается — только своим событием (вики).
      host.log({ kind: "system", code: "hubLogicManual", scenarioId: id, vars: { name: hubScenarioName(scenario) }, chain: hubList(info && info.chain) });
    },

    setActive(id, on, host) {
      if (!scenarioById(id)) return;
      activeFlags.set(id, on === true);
      if (!host.running()) return;
      if (on === true) restart(id, host, [{ k: "hub", at: host.now(), what: "start" }]);
      else {
        const instance = instances.get(id);
        if (instance) {
          kill(instance);
          instance.active = false;
        }
      }
    },

    resetScenario(id, host) {
      if (scenarioById(id) && activeOf(id)) restart(id, host, [{ k: "hub", at: host.now(), what: "reset" }]);
    },

    runCode(request, host) {
      worldOf(host);
      const given = typeof request === "string" ? { code: request } : request && typeof request === "object" ? request : {};
      const code = typeof given.code === "string" ? given.code : typeof given.source === "string" ? given.source : typeof given.text === "string" ? given.text : null;
      if (code === null) return { ok: false, error: "no code", line: null, code: "hubCodeMissing" };
      const compiled = compileOf(code, "code");
      if (compiled.error !== undefined) return { ok: false, error: compiled.error, line: compiled.line, code: "hubSyntax" };
      const instance = blockInstance(given);
      instance.compiled = compiled;
      world.scriptsUrl.set(compiled.url, { compiled, name: instance.name });
      const chain = hubList(given.chain);
      const own = chain[0] && chain[0].k === "scenario" && chain[0].scenarioId === given.scenarioId;
      const context = {
        instance,
        binding: null,
        chain: own || given.scenarioId === undefined ? chain : [{ k: "scenario", scenarioId: given.scenarioId, blockId: given.blockId }, ...chain],
      };
      let out = null;
      const result = world.call(context, () => {
        out = compiled.run(hubGlobalsFor(world, instance));
      });
      if (!result.ok) {
        const line = compiled.lineOf(result.error);
        return { ok: false, error: hubErrorMessage(result.error), line, code: "hubCodeError" };
      }
      instance.self = out.scope;
      return { ok: true, value: hubIsCondition(given.kind) ? Boolean(out.value) : out.value };
    },

    clock() {
      // Перевод часов: `Cron` считает следующий миг от нового «сейчас»;
      // таймеры `setTimeout` ждут своего времени (история 3.4).
      for (const instance of [...instances.values(), ...blockInstances.values()]) {
        for (const record of [...instance.tasks]) if (typeof record.rearm === "function") record.rearm();
      }
    },

    scenarios() {
      return scripts().map((scenario) => {
        const instance = instances.get(scenario.id) || dryInstances.get(scenario.id) || null;
        const live = instances.get(scenario.id);
        const timers = live ? [...live.tasks].some((record) => record.kind !== "subscribe" && !record.gone) : false;
        return {
          id: scenario.id,
          active: activeOf(scenario.id),
          running: Boolean(live && live.alive && timers),
          fault: instance && instance.fault ? { ...instance.fault } : null,
        };
      });
    },
  };
}

/**
 * Исполнить скрипт ради `info` на доме `home` (`buildHomeSpec` объекта) без
 * движка — для формы опций в странице (история 5.8): `{info, fault}`;
 * `globals` — исходники глобальных сценариев, исполняемые раньше (их имена
 * видны через `global`). Записи, таймеры и подписки немы.
 */
export function hubScriptInfo(source, home, { globals = [], now = 0, site = null } = {}) {
  const host = hubSpecHost(home, { now, site });
  const world = hubWorld(host, { dry: true });
  const run = (code, kind) => {
    const compiled = hubScriptCompile(code);
    if (compiled.error !== undefined) return { fault: { code: "syntax", line: compiled.line, message: compiled.error } };
    const instance = { id: "", kind, name: "", local: {}, tasks: new Set(), alive: true, compiled };
    let out = null;
    const result = world.call({ instance, binding: null, chain: [] }, () => {
      out = compiled.run(hubGlobalsFor(world, instance));
    });
    if (!result.ok) return { fault: { code: "start", line: compiled.lineOf(result.error), message: hubErrorMessage(result.error) } };
    if (kind === "global") for (const key of Object.keys(out.exports)) world.globalVars[key] = out.exports[key];
    return { info: out.info && typeof out.info === "object" ? out.info : null, fault: null };
  };
  for (const code of hubList(globals)) if (typeof code === "string") run(code, "global");
  const result = run(typeof source === "string" ? source : "", "logic");
  return { info: result.info || null, fault: result.fault || null };
}
