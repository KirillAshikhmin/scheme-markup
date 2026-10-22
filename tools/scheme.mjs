#!/usr/bin/env node
// Одна дверь к объекту разметки: сведения, таблицы, сводки и картинки.
//
//   node tools/scheme.mjs <команда> <объект.zip> [ключи]
//   node tools/scheme.mjs --help
//
// ——— зачем это есть ——————————————————————————————————————————————————————
//
// Заказчику нужны сведения из объекта для проекта и технической документации,
// а исполнителю таска — числа и картинки для приёмки. За две сотни тасков это
// делалось каждый раз заново: свой разбор zip, свой сервер, свой скрипт CDP.
// Здесь это сделано один раз.
//
// ——— что без браузера, а что только в браузере ——————————————————————————
//
// **Без браузера** (`schemeData.mjs`) — всё, что в объекте **записано или
// посчитано**: сведения, метки, типы, помещения, чертёж, развёртки словами,
// связи, оборудование, сводки. Файл объекта — zip с `project.json`, и читают
// его те же `projectFile.js` с `model.js`, что и страница. Это быстро, без
// вкладок и годится в любой скрипт.
//
// **Только в браузере** (`schemeSheets.mjs`) — всё, что **рисуется**: PNG
// схемы, лист ГОСТ, развёртки листами, кадр объёма. Рисует это `canvas` и
// чертёжный шрифт, которых в Node нет, а второго рисования в сборке быть не
// должно: лист обязан выйти тем же `exporter.js`, которым его отдаёт страница.
// Поэтому мост поднимает свой сервер и свой Chrome, грузит в страницу-оснастку
// **копию** объекта по HTTP и зовёт те же функции сборки.
//
// Команда сама говорит, что ей нужно: всё, что оканчивается на `-png`, идёт
// через браузер, остальное — нет.
//
// ——— G68 ————————————————————————————————————————————————————————————————
//
// Инструмент только читает. Файл объекта открывается на чтение, мост отдаёт
// странице-оснастке его копию по HTTP, в IndexedDB ничего не пишется, и после
// любой команды файл заказчика байт в байт тот же.
import { writeFileSync } from "node:fs";
import { basename } from "node:path";
import { pathToFileURL } from "node:url";
import {
  commandTables,
  objectDrawing,
  objectInfo,
  objectMarks,
  objectRooms,
  objectSummary,
  objectTypes,
  objectWalls,
  openObject,
  pickRooms,
  pickSchemes,
  printTables,
  tableRecords,
} from "./schemeData.mjs";
import { renderSheets } from "./schemeSheets.mjs";

const DATA_COMMANDS = ["info", "marks", "types", "rooms", "drawing", "walls", "links", "equipment", "summary"];
const SHEET_COMMANDS = ["plan-png", "gost-png", "elevation-png", "volume-png"];

const HELP = `Одна дверь к объекту разметки: сведения, таблицы, сводки и картинки.

  node tools/scheme.mjs <команда> <объект.zip> [ключи]

Без браузера — данные:
  info          объект и его схемы: имя, адрес, координаты, верх чертежа,
                размер плана, калибровка, привязка, высота стен, счётчики
  marks         метки: обозначение, тип, категория, помещение, место,
                размеры с подписями, высота, стена, связи, каналы, группа
  types         справочник типов: код, имя, категория, вид, цвет, размеры
  rooms         помещения: площадь, периметр, высота стен, метки по категориям
  drawing       чертёж схемы: стены, проёмы, вещи каталога (в миллиметрах)
  walls         развёртки стен словами: что стоит на стене и на каком месте
  links         связи меток и каналы
  equipment     оборудование и расстановка
  summary       сводки для документации: по помещениям, по типам, по этажам,
                длины линейных меток, перечень оборудования

В браузере — картинки (свой сервер, свой Chrome, страница не трогается):
  plan-png      PNG схемы с метками
  gost-png      лист по ГОСТ с рамкой и основной надписью
  elevation-png развёртки стен листами
  volume-png    кадр объёма с заданной камерой

Ключи:
  --format json|csv|md|tsv   вид вывода данных (умолчание json)
  --out <путь>               файл для данных или папка для картинок
                             (умолчание: данные в stdout, картинки в ./)
  --scheme <номер|имя|all>   какая схема (умолчание — первая)
  --room <часть имени>       какое помещение
  --wall <часть имени>       какая стена (развёртки: «ИЛ», «АБ»)
  --group-by category|type|room  разбивка таблицы меток
  --by-room                  второй уровень разбивки — помещения
  --scale <1|2|4>            множитель картинки (умолчание 2)
  --sheet <A4|A3|A2|A1|A0>   формат листа ГОСТ (умолчание — подбор)
  --orientation portrait|landscape
  --mono                     чёрно-белый лист
  --no-legend                без легенды на PNG схемы
  --no-plan                  без подложки (только метки и чертёж)
  --camera x,y,z,yaw,pitch   камера объёма: миллиметры чертежа и градусы
  --size 1600x1000           размер кадра объёма в точках
  --time 14:30               час объёма (умолчание 13:00)
  --date 2026-06-21          сутки объёма (умолчание — сегодня)
  --backdrop simple|nature|city  фон объёма
  --no-roof                  снять крышу (кадр объёма сверху)
  --port <номер>             порт сервера моста (умолчание 8235)
  --chrome-port <номер>      порт отладки своего Chrome (умолчание 9235)
  --window                   показать окно Chrome (умолчание — headless)
  --quiet                    не писать ничего, кроме самого вывода

Примеры:
  node tools/scheme.mjs info "tmp/Объект.zip"
  node tools/scheme.mjs marks "tmp/Объект.zip" --format csv --out метки.csv
  node tools/scheme.mjs summary "tmp/Объект.zip" --format md
  node tools/scheme.mjs plan-png "tmp/Объект.zip" --scheme all --out shots/
  node tools/scheme.mjs volume-png "tmp/Объект.zip" --size 1400x900 --time 11:00
`;

/** Разбор ключей: `--ключ значение`, `--ключ=значение` и `--отметка`. */
export function parseArgs(argv) {
  const keys = new Map();
  const loose = [];
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith("--")) {
      loose.push(item);
      continue;
    }
    const body = item.slice(2);
    const eq = body.indexOf("=");
    if (eq > 0) {
      keys.set(body.slice(0, eq), body.slice(eq + 1));
      continue;
    }
    const next = argv[index + 1];
    if (next !== undefined && !next.startsWith("--")) {
      keys.set(body, next);
      index += 1;
      continue;
    }
    keys.set(body, true);
  }
  return { command: loose[0] || "", file: loose[1] || "", keys };
}

/** Сужение, одинаковое для таблиц и для картинок. */
function filterOf(project, keys) {
  const filter = {};
  const schemeKey = keys.get("scheme");
  if (schemeKey && String(schemeKey).toLowerCase() !== "all") {
    const found = pickSchemes(project, schemeKey);
    if (found.length === 1) filter.schemeId = found[0].id;
  }
  const roomKey = keys.get("room");
  if (roomKey) {
    const found = pickRooms(project, roomKey);
    if (found.length === 1) filter.roomId = found[0].id;
  }
  return Object.keys(filter).length > 0 ? filter : null;
}

function dataOf(command, { project, images, file, bytesInFile }, keys) {
  const filter = filterOf(project, keys);
  const scheme = () => pickSchemes(project, keys.get("scheme"))[0];
  switch (command) {
    case "info":
      return objectInfo(project, { images, file: basename(file), bytesInFile });
    case "marks":
      return objectMarks(project, { filter });
    case "types":
      return objectTypes(project);
    case "rooms":
      return objectRooms(project, { schemeId: filter && filter.schemeId ? filter.schemeId : null });
    case "drawing":
      return objectDrawing(project, { schemeId: scheme().id });
    case "walls":
      return objectWalls(project, {
        schemeId: scheme().id,
        roomId: filter && filter.roomId ? filter.roomId : null,
      });
    case "links":
    case "equipment":
      // У связей и у оборудования таблица страницы **и есть** ответ: JSON
      // собирается из её колонок, чтобы второго состава этих списков не было.
      return tableRecords(commandTables(command, null, project, { filter })[0]);
    case "summary":
      return objectSummary(project, { filter });
    default:
      throw new Error("неизвестная команда: " + command);
  }
}

async function main() {
  const { command, file, keys } = parseArgs(process.argv.slice(2));
  if (keys.has("help") || !command || command === "help") {
    process.stdout.write(HELP);
    return;
  }
  if (!file) throw new Error("не сказано, какой объект читать");
  const quiet = keys.has("quiet");
  const say = (line) => {
    if (!quiet) process.stderr.write(line + "\n");
  };

  const opened = await openObject(file);

  if (SHEET_COMMANDS.includes(command)) {
    const saved = await renderSheets(command, opened, keys, say);
    for (const item of saved) process.stdout.write(item.path + "\t" + item.bytes + "\n");
    return;
  }

  if (!DATA_COMMANDS.includes(command)) {
    throw new Error("неизвестная команда: " + command + "\n\n" + HELP);
  }

  const data = dataOf(command, opened, keys);
  const format = keys.get("format") || "json";
  const out =
    format === "json"
      ? JSON.stringify(data, null, 2) + "\n"
      : printTables(commandTables(command, data, opened.project, {
          filter: filterOf(opened.project, keys),
          groupBy: keys.get("group-by"),
          byRoom: keys.has("by-room"),
        }), format);
  const target = keys.get("out");
  if (typeof target === "string") {
    writeFileSync(target, out);
    say("записано: " + target + " (" + Buffer.byteLength(out) + " байт)");
    return;
  }
  process.stdout.write(out);
}

// Запуск — только когда файл **позвали**, а не когда его ввезли: разбор
// ключей проверяется прогоном, и импорт не должен ничего выполнять.
const called = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (called) {
  main().catch((error) => {
    process.stderr.write("tools/scheme.mjs: " + (error && error.message ? error.message : String(error)) + "\n");
    process.exitCode = 1;
  });
}
