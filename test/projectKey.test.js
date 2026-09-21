// Постоянный ключ проекта (таск 97).
//
// `project.id` перевыдаётся при загрузке файла — иначе двое писали бы в один
// снимок, — поэтому у участников одного проекта он разный, и родство файлов
// приходилось угадывать по общим идентификаторам схем и меток. Ключ заводится
// при создании объекта и не меняется никогда: по нему родство становится
// ответом, а не догадкой. Догадка при этом остаётся — для копий, разошедшихся
// до того, как ключи появились.
import test from "node:test";
import assert from "node:assert/strict";

import { addMark, addScheme, createProject, ensureProjectKey, updateProject } from "../src/model.js";
import { packProject, unpackProject, verifyProjectFile } from "../src/projectFile.js";
import { areRelatedProjects, mergeProjects } from "../src/merge.js";
import { adoptLoadedProject, autosaveOwnArchive } from "../src/autosave.js";

const MEMBER = "b06278c4-1111-7000-8000-000000000001";

function project(name) {
  let made = createProject({ name });
  const added = addScheme(made, { name: "1 этаж", width: 1000, height: 800 });
  made = added.project;
  made = addMark(made, {
    schemeId: added.scheme.id,
    typeId: made.markTypes[0].id,
    kind: "point",
    points: [{ x: 0.3, y: 0.3 }],
  }).project;
  return made;
}

// Объект прежней сборки: ключа нет вовсе.
function keyless(source) {
  const copy = { ...source };
  delete copy.key;
  return copy;
}

test("ключ заводится при создании и переживает импорт, копирование и переименование", async () => {
  const mine = project("Квартира на Ленина");
  assert.ok(mine.key, "у нового объекта нет ключа");
  assert.notEqual(mine.key, mine.id, "ключ и идентификатор — разные вещи");

  // Переименование.
  assert.equal(updateProject(mine, { name: "Квартира Оли" }).project.key, mine.key);

  // Импорт: файл — приёмка — объект. Идентификатор новый, ключ прежний.
  const loaded = await unpackProject(await packProject(mine, new Map()));
  const adopted = adoptLoadedProject(loaded, { mode: "new" });
  assert.notEqual(adopted.project.id, mine.id, "идентификатор обязан смениться");
  assert.equal(adopted.project.key, mine.key, "ключ не пережил загрузку файла");

  // Вторая загрузка того же файла — тот же ключ и снова новый идентификатор.
  const twin = adoptLoadedProject(await unpackProject(await packProject(mine, new Map())), { mode: "new" });
  assert.equal(twin.project.key, mine.key);
  assert.notEqual(twin.project.id, adopted.project.id);
});

test("два участника одного проекта: ключ общий, идентификаторы разные", async () => {
  const mine = project("Дом Иванова");
  const loaded = await unpackProject(await packProject(mine, new Map()));
  const peer = adoptLoadedProject(loaded, { mode: "new" }).project;

  assert.equal(peer.key, mine.key);
  assert.notEqual(peer.id, mine.id);
  assert.equal(areRelatedProjects(mine, peer), true, "участники одного проекта не признаны роднёй");
});

test("два объекта из одного шаблона роднёй не считаются", () => {
  const one = project("Квартира на Ленина");
  const two = project("Квартира на Мира");

  assert.notEqual(one.key, two.key, "у двух объектов один ключ");
  assert.equal(areRelatedProjects(one, two), false, "чужие объекты сочтены роднёй");
});

test("ключ отвечает там, где догадка врёт: напарник заменил все схемы и метки", () => {
  const mine = project("Офис на Тверской");
  // У напарника от исходного объекта не осталось ни одной общей сущности —
  // свои схемы, свои метки, свой справочник. Догадка сказала бы «чужой файл».
  const theirs = { ...project("Офис на Тверской"), key: mine.key };

  assert.equal(
    areRelatedProjects(keyless(mine), keyless(theirs)),
    false,
    "догадка и не должна была их узнать — иначе проверять нечего",
  );
  assert.equal(areRelatedProjects(mine, theirs), true, "ключ не сработал");
});

test("файлы без ключа читаются по прежним правилам — догадкой", async () => {
  const mine = keyless(project("Дача Петровых"));
  const loaded = await unpackProject(await packProject(mine, new Map()));
  assert.equal(loaded.project.key, undefined, "в файле прежней сборки ключа быть не должно");
  assert.equal(loaded.projectKey, null, "в отметке взялся ключ, которого нет");

  // Тот же объект у второго участника: свой идентификатор, общие схемы и метки.
  const peer = { ...loaded.project, id: "peer-объект" };
  assert.equal(areRelatedProjects(mine, peer), true, "догадка выключена — старые файлы перестали сливаться");

  // И чужой объект без ключа по-прежнему чужой.
  assert.equal(areRelatedProjects(mine, keyless(project("Чужой объект"))), false);
});

test("ключ есть у одного: второй его принимает, и это применяется тихо", () => {
  const theirs = project("Квартира на Мира");
  const mine = keyless(theirs);

  const merged = mergeProjects(mine, theirs, null);

  assert.equal(merged.project.key, theirs.key, "ключ не доехал");
  assert.equal(merged.changed, true, "ключ обязан быть применён");
  assert.equal(merged.quiet, true, "появление ключа выглядит как чужая правка");
  assert.deepEqual(
    [merged.counts.added, merged.counts.updated, merged.counts.removed, merged.counts.conflicts],
    [0, 0, 0, 0],
    "в отчёте появилась несуществующая работа",
  );
});

test("копии, разошедшиеся до ключей, сливаются догадкой и сходятся на одном ключе", () => {
  const mine = project("Таунхаус");
  // Копия того же объекта, разошедшаяся раньше: сущности общие, ключи свои.
  const theirs = { ...mine, id: "peer-объект", key: "0000-раньше-нашего" };

  assert.notEqual(mine.key, theirs.key);
  assert.equal(areRelatedProjects(mine, theirs), true, "догадка выключена — копии перестали сливаться");

  const ours = mergeProjects(mine, theirs, null);
  const back = mergeProjects(theirs, mine, null);
  assert.equal(ours.project.key, back.project.key, "стороны разошлись в ключе — он гулял бы туда-сюда");
  assert.equal(ours.project.key, theirs.key, "берётся меньший по строке");
  assert.equal(ours.quiet, true, "сведение ключей выглядит как чужая правка");
});

test("ключ пишется в writer и сверяется вместе с архивом", async () => {
  const mine = project("Белый дом");
  const blob = await packProject(mine, new Map(), { member: MEMBER });
  const loaded = await unpackProject(blob);

  assert.equal(loaded.projectKey, mine.key, "ключа нет в отметке writer");
  assert.equal(loaded.project.key, mine.key, "ключа нет в самом объекте");
  await verifyProjectFile(blob, mine, new Map(), { member: MEMBER });

  // Отметка и объект разойтись не имеют права.
  await assert.rejects(
    () => verifyProjectFile(blob, { ...mine, key: "другой-ключ" }, new Map(), { member: MEMBER }),
    (error) => error.code === "fileCheckFailed",
  );
});

test("две копии одного проекта в одном браузере остаются разными объектами", async () => {
  const mine = project("Квартира на Ленина");
  const loaded = await unpackProject(await packProject(mine, new Map(), { member: MEMBER }));
  const twin = adoptLoadedProject(loaded, { mode: "new" }).project;

  // Ключ у них общий — это один проект, — но объекты в браузере разные, и
  // снимок соседней копии не должен считаться своим: иначе он попадёт в список
  // прежних файлов и под кнопку «Удалить» (дефект 95).
  assert.equal(twin.key, mine.key);
  assert.equal(
    autosaveOwnArchive(mine, { project: twin, member: MEMBER }, MEMBER),
    false,
    "снимок соседней копии сочтён своим",
  );
  assert.equal(autosaveOwnArchive(mine, { project: mine, member: MEMBER }, MEMBER), true);
});

test("объект прежней сборки получает ключ один раз и не меняется больше", async () => {
  const old = keyless(project("Дом у озера"));
  const first = ensureProjectKey(old);
  assert.equal(first.changed, true);
  assert.ok(first.project.key);
  assert.equal(first.project.updatedAt, old.updatedAt, "появление ключа тронуло отметку времени");

  const second = ensureProjectKey(first.project);
  assert.equal(second.changed, false, "ключ завёлся заново");
  assert.equal(second.project, first.project, "объект пересобрался на пустом месте");

  // Разметка при этом не изменилась ни в чём.
  assert.deepEqual(second.project.marks, old.marks);
  assert.deepEqual(second.project.schemes, old.schemes);
  assert.equal(JSON.stringify(keyless(second.project)), JSON.stringify(old), "объект изменился, а не помечен");
});
