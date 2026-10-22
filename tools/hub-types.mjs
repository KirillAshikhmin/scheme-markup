// Выжимка словаря Sprut.Hub для скриптов имитации: `src/sim/hubTypes.js` из
// `Sprut.Hub_Tools/ScenarioTemplate` (таск 06 сценариев).
//
//   node tools/hub-types.mjs [папка ScenarioTemplate]
//
// Папка по умолчанию — `../../Sprut.Hub_Tools/ScenarioTemplate` от
// `scheme_image/`. Имена перечислений берутся из `spruthub.js` (там все 94
// типа сервисов и 263 характеристики, в порядке хаба), метаданные — из
// `sh_types.json`: формат, диапазон, шаг, длина строки, единица, доступ и
// допустимые значения. Остальное (идентификаторы HAP, русские подписи) в
// страницу не берётся. Повторный запуск на тех же файлах даёт тот же текст.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "..", "src", "sim", "hubTypes.js");
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

function main() {
  const from = resolve(process.argv[2] || SOURCE);
  const text = hubTypesSource(readFileSync(join(from, "sh_types.json"), "utf8"), readFileSync(join(from, "spruthub.js"), "utf8"));
  writeFileSync(OUT, text);
  process.stdout.write("hub-types: " + OUT + "\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
