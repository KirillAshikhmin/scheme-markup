// Выжимка словаря Sprut.Hub для скриптов имитации: `src/sim/hubTypes.js` из
// `Sprut.Hub_Tools/ScenarioTemplate` (таск 06 сценариев).
//
//   node tools/hub-types.mjs [папка ScenarioTemplate]
//
// Папка по умолчанию — `../../Sprut.Hub_Tools/ScenarioTemplate` от
// `scheme_image/`. Имена перечислений берутся из `spruthub.js` (там все 94
// типа сервисов и 263 характеристики, в порядке хаба), метаданные — из
// `sh_types.json`: формат, диапазон, шаг, длина строки, единица, доступ и
// допустимые значения. Идентификаторы HAP в страницу не берутся.
//
// Вторая выжимка — **русские подписи** сервисов, характеристик и значений
// (правка после сборки сценариев: «вот тут все типы сервисов перечислены, с их
// характеристиками… Перенеси эту структуру»). Видимые строки живут только в
// `src/strings.js`, поэтому подписи пишутся туда, в собранный блок между
// `// <hub-labels>` и `// </hub-labels>`; всё остальное в словаре — руками, и
// подписи, написанные руками, главнее собранных. Системные сервисы хаба
// (`system` в `sh_types.json`: сведения об аксессуаре, транспорт, Siri) в
// подписи не идут — к метке их не добавляют.
//
// Повторный запуск на тех же файлах даёт тот же текст.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "..", "src", "sim", "hubTypes.js");
const STRINGS = join(HERE, "..", "src", "strings.js");
const LABELS_FROM = "// <hub-labels>";
const LABELS_TO = "// </hub-labels>";
const SOURCE = join(HERE, "..", "..", "..", "Sprut.Hub_Tools", "ScenarioTemplate");

function enumNames(declarations, name) {
  const match = new RegExp("declare enum " + name + "\\s*\\{([^}]*)\\}").exec(declarations);
  if (!match) throw new Error("hub-types: в spruthub.js нет перечисления " + name);
  return match[1]
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

// Формат файла как есть, кроме «rU» у оттенка — это опечатка: число с дробью.
function charFormat(format) {
  return format === "rU" ? "Double" : format || null;
}

function charMeta(char) {
  const values = Array.isArray(char.validValues)
    ? char.validValues
        .filter((item) => item && item.value && typeof item.value.intValue === "number")
        .map((item) => ({ code: item.value.intValue, key: String(item.key) }))
    : [];
  const perms = [];
  if (char.read !== false) perms.push("read");
  if (char.write === true) perms.push("write");
  if (char.events === true) perms.push("event");
  return {
    format: charFormat(char.format),
    min: typeof char.minValue === "number" ? char.minValue : null,
    max: typeof char.maxValue === "number" ? char.maxValue : null,
    step: typeof char.minStep === "number" ? char.minStep : null,
    maxLen: typeof char.maxLen === "number" ? char.maxLen : null,
    unit: typeof char.unit === "string" ? char.unit : null,
    perms,
    values: values.length > 0 ? values : null,
  };
}

const EMPTY_CHAR = { format: null, min: null, max: null, step: null, maxLen: null, unit: null, perms: [], values: null };

/**
 * Текст модуля `hubTypes.js` по содержимому `sh_types.json` и `spruthub.js`.
 * Характеристика описана в нескольких сервисах — берётся первое описание, а
 * доступ складывается (как у ScenarioSimulator).
 */
export function hubTypesSource(shTypesText, declarationsText) {
  const data = JSON.parse(shTypesText);
  const services = data && data.service && data.service.types && data.service.types.types;
  if (!Array.isArray(services)) throw new Error("hub-types: в sh_types.json нет service.types.types");
  const serviceNames = enumNames(declarationsText, "HS");
  const charNames = enumNames(declarationsText, "HC");
  const byService = new Map(services.map((service) => [service.type, service]));
  const chars = new Map();
  for (const service of services) {
    for (const char of [...(service.required || []), ...(service.optional || [])]) {
      if (!char || !char.type) continue;
      const meta = charMeta(char);
      const before = chars.get(char.type);
      if (!before) chars.set(char.type, meta);
      else before.perms = ["read", "write", "event"].filter((perm) => before.perms.includes(perm) || meta.perms.includes(perm));
    }
  }
  const lines = [];
  lines.push("// Словарь Sprut.Hub для скриптов имитации: перечисления `HS` и `HC` с");
  lines.push("// метаданными. ФАЙЛ СОБРАН `node tools/hub-types.mjs` из");
  lines.push("// `Sprut.Hub_Tools/ScenarioTemplate` (`spruthub.js` — имена, `sh_types.json` —");
  lines.push("// метаданные); руками не править, а пересобрать. Формат характеристики —");
  lines.push("// `Boolean | Integer | Long | Double | String` или `null`, если файл хаба её не");
  lines.push("// описывает; `values` — допустимые значения `[{code, key}]`.");
  lines.push("");
  lines.push("const HUB_TYPE_FREEZE = (value) => Object.freeze(value);");
  lines.push("");
  lines.push("/** Типы сервисов (94): `{[type]: {required: [char], optional: [char]}}`. */");
  lines.push("export const HUB_SERVICE_TYPES = HUB_TYPE_FREEZE({");
  for (const name of serviceNames) {
    const service = byService.get(name) || {};
    const required = (service.required || []).map((char) => char.type);
    const optional = (service.optional || []).map((char) => char.type);
    lines.push(
      "  " + JSON.stringify(name) + ": HUB_TYPE_FREEZE({ required: " + JSON.stringify(required) + ", optional: " + JSON.stringify(optional) + " }),",
    );
  }
  lines.push("});");
  lines.push("");
  lines.push("/** Системные сервисы хаба: к метке их не добавляют (`system` в `sh_types.json`). */");
  lines.push(
    "export const HUB_SYSTEM_SERVICES = HUB_TYPE_FREEZE(" +
      JSON.stringify(serviceNames.filter((name) => byService.get(name) && byService.get(name).system === true)) +
      ");",
  );
  lines.push("");
  lines.push("/**");
  lines.push(" * Типы характеристик (263): `{[type]: {format, min, max, step, maxLen, unit,");
  lines.push(" * perms, values}}`.");
  lines.push(" */");
  lines.push("export const HUB_CHAR_TYPES = HUB_TYPE_FREEZE({");
  for (const name of charNames) {
    const meta = chars.get(name) || EMPTY_CHAR;
    const values = meta.values ? "[" + meta.values.map((value) => JSON.stringify(value)).join(", ") + "]" : "null";
    lines.push(
      "  " +
        JSON.stringify(name) +
        ": HUB_TYPE_FREEZE({ format: " +
        JSON.stringify(meta.format) +
        ", min: " +
        JSON.stringify(meta.min) +
        ", max: " +
        JSON.stringify(meta.max) +
        ", step: " +
        JSON.stringify(meta.step) +
        ", maxLen: " +
        JSON.stringify(meta.maxLen) +
        ", unit: " +
        JSON.stringify(meta.unit) +
        ", perms: " +
        JSON.stringify(meta.perms) +
        ", values: " +
        values +
        " }),",
    );
  }
  lines.push("});");
  lines.push("");
  return lines.join("\n");
}

/**
 * Подписи несистемных сервисов, их характеристик и значений:
 * `{services: {type: name}, chars: {type: name}, values: {char: {key: name}}}`.
 * Подпись характеристики — первая встреченная, как и её описание.
 */
export function hubLabels(shTypesText) {
  const data = JSON.parse(shTypesText);
  const services = data.service.types.types.filter((service) => service && service.type && service.system !== true);
  const labels = { services: {}, chars: {}, values: {} };
  const name = (value) => String(value == null ? "" : value).trim();
  for (const service of services) {
    if (name(service.name)) labels.services[service.type] = name(service.name);
    for (const char of [...(service.required || []), ...(service.optional || [])]) {
      if (!char || !char.type || Object.prototype.hasOwnProperty.call(labels.chars, char.type)) continue;
      if (name(char.name)) labels.chars[char.type] = name(char.name);
      const values = {};
      for (const item of Array.isArray(char.validValues) ? char.validValues : []) {
        if (item && item.key && name(item.name)) values[String(item.key)] = name(item.name);
      }
      if (Object.keys(values).length > 0) labels.values[char.type] = values;
    }
  }
  return labels;
}

/** Собранный блок подписей для `strings.js` — строки между метками. */
export function hubLabelsBlock(labels) {
  const lines = [LABELS_FROM, "const SIM_HUB_LABELS = {"];
  for (const group of ["services", "chars"]) {
    lines.push("  " + group + ": {");
    for (const [key, value] of Object.entries(labels[group]).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
      lines.push("    " + JSON.stringify(key) + ": " + JSON.stringify(value) + ",");
    }
    lines.push("  },");
  }
  lines.push("  values: {");
  for (const [char, values] of Object.entries(labels.values).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    lines.push("    " + JSON.stringify(char) + ": " + JSON.stringify(values) + ",");
  }
  lines.push("  },");
  lines.push("};");
  lines.push(LABELS_TO);
  return lines.join("\n");
}

/** `strings.js` с подменённым собранным блоком; блока нет — ошибка, а не дописка. */
export function stringsWithLabels(stringsText, block) {
  const from = stringsText.indexOf(LABELS_FROM);
  const to = stringsText.indexOf(LABELS_TO);
  if (from < 0 || to < from) throw new Error("hub-types: в strings.js нет блока " + LABELS_FROM + " … " + LABELS_TO);
  return stringsText.slice(0, from) + block + stringsText.slice(to + LABELS_TO.length);
}

function main() {
  const from = resolve(process.argv[2] || SOURCE);
  const shTypes = readFileSync(join(from, "sh_types.json"), "utf8");
  const text = hubTypesSource(shTypes, readFileSync(join(from, "spruthub.js"), "utf8"));
  writeFileSync(OUT, text);
  process.stdout.write("hub-types: " + OUT + "\n");
  writeFileSync(STRINGS, stringsWithLabels(readFileSync(STRINGS, "utf8"), hubLabelsBlock(hubLabels(shTypes))));
  process.stdout.write("hub-types: " + STRINGS + " (подписи)\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
