// Открытие файла проекта — одна дверь на всю сборку.
//
// Кнопок, ведущих к файлу, теперь две: в шапке и в стартовом окне. Разбор
// архива, вопрос «новым объектом или вместо текущего», переприсваивание
// идентификаторов и отметка выгрузки — всё это живёт в одной панели, и второй
// такой путь развёл бы поведение молча: одна кнопка чинилась бы, другая нет.
// Проверка идёт по исходникам — DOM здесь не нужен.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
const read = (...parts) => readFileSync(join(SRC, ...parts), "utf8");

const filePanel = read("panels", "file.js");
const projectsPanel = read("panels", "projects.js");

test("выбор zip-файла объявлен ровно в одной панели", () => {
  const owners = [];
  for (const name of ["file.js", "projects.js", "schemes.js", "types.js", "equipment.js", "export.js"]) {
    if (/accept:\s*"\.zip/.test(read("panels", name))) owners.push(name);
  }
  assert.deepEqual(owners, ["file.js"], "поле выбора архива должно быть одно — в панели файла");
});

test("стартовое окно зовёт ту же дверь, а не свою", () => {
  assert.match(filePanel, /export function openProjectFileDialog\(/);
  assert.match(projectsPanel, /import \{ openProjectFileDialog \} from "\.\/file\.js"/);
  assert.match(projectsPanel, /openProjectFileDialog\(\)/);
});

test("панель объектов архивов не разбирает", () => {
  // Ни распаковки, ни приёмки загруженного: всё это — работа панели файла.
  assert.equal(/unpackProject|adoptLoadedProject|readZip/.test(projectsPanel), false);
});

test("панели файла и объектов не держатся друг за друга", () => {
  // Импорт в обе стороны — циклический, и сборка на нём падает. Поэтому общий
  // ключ настройки уехал в каркас, а не остался в панели объектов.
  assert.equal(/from "\.\/projects\.js"/.test(filePanel), false, "панель файла не должна импортировать панель объектов");
  assert.match(filePanel, /LAST_PROJECT_KEY[^\n]*from "\.\.\/app\.js"/);
  assert.match(projectsPanel, /LAST_PROJECT_KEY[^\n]*from "\.\.\/app\.js"/);
});

test("стартовое окно закрывается по появившемуся объекту, а не по кнопке", () => {
  // Объект приходит тремя путями (создали, открыли файл, пришёл со стороны), и
  // закрывать окно должен сам факт его появления: иначе оно висит поверх
  // открытого объекта после загрузки из файла.
  const welcome = projectsPanel.slice(projectsPanel.indexOf("function showWelcome"));
  const body = welcome.slice(0, welcome.indexOf("\n  function "));
  assert.match(body, /subscribe\(/);
  assert.match(body, /"project" in changed && state\.project/);
});
