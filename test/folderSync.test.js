// Общая папка: замечаем чужой файл и сливаем его с нашим объектом, не затирая
// ни свою работу, ни чужую. Папка здесь поддельная — File System Access в Node
// нет, — но всё остальное настоящее: упаковка, чтение, слияние, хранилище.
import test from "node:test";
import assert from "node:assert/strict";

import {
  autosaveAdoptFolder,
  autosaveMemberId,
  autosaveOwnSnapshots,
  autosavePickFolder,
  autosaveRemoveSnapshots,
  autosaveWrite,
  autosaveScanExternal,
  autosaveResetSync,
  autosaveSnapshotName,
} from "../src/autosave.js";
import { packProject } from "../src/projectFile.js";
import { createProject, addScheme, addMark, deleteMark } from "../src/model.js";
import { putImage, getImage } from "../src/store.js";

function fakeFolder() {
  const files = new Map();
  const entryFor = (name) => ({
    kind: "file",
    name,
    async getFile() {
      const stored = files.get(name) || { bytes: new Uint8Array(0), at: 0 };
      const blob = new Blob([stored.bytes]);
      blob.lastModified = stored.at;
      return blob;
    },
  });
  return {
    name: "Общая",
    files,
    put(name, bytes, at) {
      files.set(name, { bytes, at });
    },
    async getFileHandle(name) {
      return {
        ...entryFor(name),
        async createWritable() {
          let bytes = null;
          return {
            async write(blob) {
              bytes = new Uint8Array(await blob.arrayBuffer());
            },
            async close() {
              files.set(name, { bytes, at: Date.now() });
            },
          };
        },
      };
    },
    async removeEntry(name) {
      if (!files.has(name)) throw new Error("NotFoundError: " + name);
      files.delete(name);
    },
    async *values() {
      for (const name of files.keys()) yield entryFor(name);
    },
  };
}

function plan(seed, length = 300) {
  const bytes = new Uint8Array(length);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  for (let i = 8; i < length; i += 1) bytes[i] = (seed * 37 + i * 11) % 256;
  return new Blob([bytes], { type: "image/png" });
}

async function objectWithPlan(name) {
  let project = createProject({ name });
  const imageId = await putImage(plan(1));
  const added = addScheme(project, { name: "1 этаж", imageId, width: 1000, height: 800 });
  project = added.project;
  project = addMark(project, {
    schemeId: added.scheme.id,
    typeId: project.markTypes[0].id,
    points: [{ x: 0.2, y: 0.2 }],
  }).project;
  return { project, schemeId: added.scheme.id, imageId };
}

// Второй инженер: тот же объект из общего файла, своя правка и свой план.
async function peerCopy(project, schemeId, tag = "peer") {
  const copy = JSON.parse(JSON.stringify(project));
  copy.id = tag + "-" + copy.id.slice(5);
  const withMark = addMark(copy, {
    schemeId,
    typeId: copy.markTypes[1].id,
    points: [{ x: 0.8, y: 0.8 }],
  }).project;
  const second = addScheme(withMark, {
    name: "2 этаж " + tag,
    imageId: tag + "-plan",
    width: 900,
    height: 700,
  });
  const peer = { ...second.project, updatedAt: new Date(Date.now() + 60000).toISOString() };
  const blob = await packProject(peer, new Map([[tag + "-plan", plan(9)]]));
  return { peer, bytes: new Uint8Array(await blob.arrayBuffer()) };
}

const folder = fakeFolder();
globalThis.window = { showDirectoryPicker: async () => folder };

test("чужой файл в папке замечается и сливается с нашим объектом", async () => {
  const { project, schemeId } = await objectWithPlan("Квартира на Ленина");
  await autosavePickFolder();
  const written = await autosaveWrite(project);
  assert.equal(written.ok, true, written.error && written.error.message);

  const { bytes } = await peerCopy(project, schemeId);
  folder.put("Квартира на Ленина-2026-09-17-peer1234.zip", bytes, Date.now() + 5000);

  const result = await autosaveScanExternal(project);
  assert.ok(result, "чужая правка не замечена");
  assert.equal(result.changed, true);
  assert.equal(result.project.marks.length, project.marks.length + 1, "чужая метка пришла");
  assert.equal(result.project.schemes.length, project.schemes.length + 1, "чужая схема пришла");
  assert.ok(result.project.marks.every((mark) => mark.id !== undefined));
  assert.equal(result.counts.added, 2, "в отчёте метка и схема");
  assert.deepEqual(result.conflicts, [], "спорить тут не о чем");

  // План чужой схемы попал в хранилище под своим идентификатором — иначе
  // схема ссылалась бы в никуда.
  assert.equal(result.plans, 1);
  assert.ok(await getImage("peer-plan"), "чужой план не сохранён");

  // Наша работа на месте.
  for (const mark of project.marks) {
    assert.ok(result.project.marks.some((other) => other.id === mark.id), "наша метка пропала");
  }
});

test("свой и устаревший файлы не сливаются, чужой объект — тоже", async () => {
  const { project, schemeId } = await objectWithPlan("Дом Иванова");
  await autosavePickFolder();
  await autosaveWrite(project);

  // Свой же снимок: сливать нечего, ответа нет.
  assert.equal(await autosaveScanExternal(project), null);

  // Протухший файл: записан раньше нашего снимка, и в нём нет нашей правки.
  // Слить его — значит откатить свою работу, поэтому он пропускается.
  const stale = await packProject({ ...project, marks: [], updatedAt: "2026-01-01T00:00:00.000Z" }, new Map());
  folder.put("старое.zip", new Uint8Array(await stale.arrayBuffer()), 1000);
  assert.equal(await autosaveScanExternal(project), null, "протухший файл пошёл в слияние");

  // Чужой объект в той же папке — не наш проект, трогать его нельзя.
  const stranger = createProject({ name: "Чужой объект" });
  const strangerFile = await packProject(stranger, new Map());
  folder.put("чужой.zip", new Uint8Array(await strangerFile.arrayBuffer()), Date.now() + 9000);
  assert.equal(await autosaveScanExternal(project), null, "чужой объект пошёл в слияние");

  // И мусор, который в общей папке лежит наравне со всем остальным.
  folder.put("заметки.zip", new TextEncoder().encode("это не архив"), Date.now() + 9500);
  assert.equal(await autosaveScanExternal(project), null);
  autosaveResetSync();
});

test("правки двух коллег подхватываются по очереди, а не теряются", async () => {
  const { project, schemeId } = await objectWithPlan("Офис на Тверской");
  await autosavePickFolder();
  await autosaveWrite(project);

  const first = await peerCopy(project, schemeId, "peer");
  const second = await peerCopy(project, schemeId, "kolya");
  folder.put("коллега-1.zip", first.bytes, Date.now() + 3000);
  folder.put("коллега-2.zip", second.bytes, Date.now() + 4000);

  const one = await autosaveScanExternal(project);
  assert.ok(one, "первый коллега не замечен");
  // Второй заход обязан принести второго: отметка о прочитанном — на каждый
  // файл, иначе сосед по папке остаётся неучтённым навсегда.
  const two = await autosaveScanExternal(one.project);
  assert.ok(two, "второй коллега потерялся");
  assert.equal(two.project.marks.length, project.marks.length + 2, "в объекте обе чужие метки");
  assert.equal(two.project.schemes.length, project.schemes.length + 2, "и обе чужие схемы");

  // Третий заход уже ничего не приносит: файлы прочитаны.
  assert.equal(await autosaveScanExternal(two.project), null);
  autosaveResetSync();
});

// ——— один файл на объект (дефект 87) ————————————————————————————————
//
// Снимок звался «<объект>-<дата>-<хвост>.zip», то есть заводился заново каждый
// день. У того, кто ведёт объект неделю, в папке лежала неделя файлов, и
// вчерашний приезжал в слияние как чужая работа: возвращал удалённое, а
// отменить было нечем — панель после слияния обрывает историю.

// Хвост объекта: прежние сборки ставили в имя только его, и тестам он нужен,
// чтобы собрать имя, каким его писали тогда. Из нынешнего имени его не выдрать
// последней группой — там стоит хвост участника.
function snapshotTag(project) {
  return String(project.id).replace(/[^0-9a-z]/gi, "").slice(0, 8).toLowerCase();
}

test("работа в разные дни оставляет в папке один файл", async () => {
  folder.files.clear();
  autosaveResetSync();
  const { project } = await objectWithPlan("Квартира на Мира");
  await autosavePickFolder();

  const monday = await autosaveWrite(project, { date: new Date("2026-09-14T09:00:00Z") });
  const friday = await autosaveWrite(project, { date: new Date("2026-09-18T20:00:00Z") });

  assert.equal(monday.ok, true, monday.error && monday.error.message);
  assert.equal(friday.ok, true, friday.error && friday.error.message);
  assert.equal(monday.name, friday.name, "за неделю имя снимка сменилось");
  assert.doesNotMatch(monday.name, /\d{4}-\d{2}-\d{2}/, "дата в имени снимка");
  assert.equal(folder.files.size, 1, "в папке не один файл: " + [...folder.files.keys()].join(", "));
});

test("вчерашний снимок того же объекта не приезжает как чужая правка", async () => {
  folder.files.clear();
  autosaveResetSync();
  const { project } = await objectWithPlan("Дом на Садовой");
  await autosavePickFolder();

  // Файл, оставшийся от прежней сборки: то же имя объекта, дата в имени и наш
  // хвост. Время записи новее нашего снимка — так и бывает, когда облачный
  // диск доставляет файл заново.
  const yesterday = await packProject(project, new Map());
  folder.put(
    "Дом на Садовой-2026-09-18-" + snapshotTag(project) + ".zip",
    new Uint8Array(await yesterday.arrayBuffer()),
    Date.now() + 60000,
  );

  // Сегодня метку удалили, и объект уехал в сегодняшний файл.
  const doomed = project.marks[0].id;
  const today = deleteMark(project, doomed).project;
  const written = await autosaveWrite(today);
  assert.equal(written.ok, true, written.error && written.error.message);

  assert.equal(await autosaveScanExternal(today), null, "вчерашний снимок пошёл в слияние");
});

test("снимок, переименованный руками, узнаётся по объекту внутри", async () => {
  folder.files.clear();
  autosaveResetSync();
  const { project } = await objectWithPlan("Таунхаус");
  await autosavePickFolder();
  await autosaveWrite(project);

  // Хвоста в имени нет — зато внутри лежит наш же объект с нашим id.
  const copy = await packProject(project, new Map());
  folder.put("копия работы.zip", new Uint8Array(await copy.arrayBuffer()), Date.now() + 60000);

  const doomed = project.marks[0].id;
  const today = deleteMark(project, doomed).project;
  assert.equal(await autosaveScanExternal(today), null, "наш же файл под чужим именем пошёл в слияние");
});

test("общий предок поднимается из своего снимка, и удаление коллеги доезжает", async () => {
  folder.files.clear();
  autosaveResetSync();
  const { project, schemeId } = await objectWithPlan("Офис на Правды");
  const withSecond = addMark(project, {
    schemeId,
    typeId: project.markTypes[0].id,
    points: [{ x: 0.6, y: 0.6 }],
  }).project;
  await autosavePickFolder();
  await autosaveWrite(withSecond);

  // Коллега удалил вторую метку и выложил свой файл.
  const gone = withSecond.marks[1].id;
  const copy = JSON.parse(JSON.stringify(withSecond));
  copy.id = "peer-" + copy.id.slice(5);
  const peer = {
    ...deleteMark(copy, gone).project,
    updatedAt: new Date(Date.now() + 60000).toISOString(),
  };
  const peerFile = await packProject(peer, new Map());
  const peerBytes = new Uint8Array(await peerFile.arrayBuffer());

  // Новая вкладка: своей записи в этом сеансе ещё не было, предка нет.
  autosaveResetSync();
  folder.put("коллега.zip", peerBytes, Date.now() + 70000);
  const blind = await autosaveScanExternal(withSecond);
  assert.ok(
    blind === null || blind.project.marks.some((mark) => mark.id === gone),
    "без предка удаление не должно было доехать — объединение его не видит",
  );

  // А теперь предок берётся из своего же снимка в папке.
  autosaveResetSync();
  const adopted = await autosaveAdoptFolder(withSecond);
  assert.ok(adopted && adopted.base, "предок не поднялся из своего снимка");
  assert.equal(adopted.base.id, withSecond.id);
  assert.equal(adopted.base.marks.length, withSecond.marks.length);
  assert.deepEqual(adopted.stale, [], "лишних файлов этого объекта в папке нет");

  const seen = await autosaveScanExternal(withSecond);
  assert.ok(seen, "чужое удаление не замечено");
  assert.equal(seen.project.marks.some((mark) => mark.id === gone), false, "удаление коллеги не доехало");
  autosaveResetSync();
});

test("прежние файлы объекта видны списком и удаляются только по просьбе", async () => {
  folder.files.clear();
  autosaveResetSync();
  const { project } = await objectWithPlan("Дача Петровых");
  await autosavePickFolder();
  const written = await autosaveWrite(project);
  const tag = snapshotTag(project);

  const ours = new Uint8Array(await (await packProject(project, new Map())).arrayBuffer());
  const stranger = createProject({ name: "Чужой объект" });
  const strangerBytes = new Uint8Array(await (await packProject(stranger, new Map())).arrayBuffer());
  folder.put("Дача Петровых-2026-09-18-" + tag + ".zip", ours, Date.now() - 86400000);
  folder.put("Прежнее имя-" + tag + ".zip", ours, Date.now() - 172800000);
  // Имя с нашим хвостом, а внутри чужой объект: удалять такое нельзя.
  folder.put("Подделка-" + tag + ".zip", strangerBytes, Date.now() - 1000);
  folder.put("коллега.zip", ours, Date.now() - 1000);

  const own = (await autosaveOwnSnapshots(project)).map((item) => item.name);
  assert.ok(own.includes(written.name), "текущий снимок не в списке своих");
  assert.ok(own.includes("Дача Петровых-2026-09-18-" + tag + ".zip"), "снимок прежнего дня не найден");
  assert.ok(own.includes("Прежнее имя-" + tag + ".zip"), "снимок прежнего имени не найден");
  assert.ok(!own.includes("коллега.zip"), "чужой файл попал в свои");

  // Подделка прошла отбор по имени, но внутри чужой объект — в список она не
  // идёт: список ведёт к кнопке «Удалить», и гадать там нельзя.
  assert.ok(!own.includes("Подделка-" + tag + ".zip"), "чужой объект попал в список прежних файлов");

  const found = await autosaveAdoptFolder(project);
  assert.deepEqual(
    found.stale.map((item) => item.name).sort(),
    ["Дача Петровых-2026-09-18-" + tag + ".zip", "Прежнее имя-" + tag + ".zip"],
    "прежние файлы посчитаны неверно",
  );

  const result = await autosaveRemoveSnapshots(project, [
    "Дача Петровых-2026-09-18-" + tag + ".zip",
    "Прежнее имя-" + tag + ".zip",
    "Подделка-" + tag + ".zip",
    "коллега.zip",
    written.name,
  ]);
  assert.deepEqual(
    result.removed.sort(),
    ["Дача Петровых-2026-09-18-" + tag + ".zip", "Прежнее имя-" + tag + ".zip"],
    "удалено не то, что просили",
  );
  assert.deepEqual(result.kept, ["Подделка-" + tag + ".zip"], "чужой объект внутри должен остаться");
  assert.ok(folder.files.has(written.name), "удалён текущий снимок");
  assert.ok(folder.files.has("коллега.zip"), "удалён чужой файл");
  assert.ok(folder.files.has("Подделка-" + tag + ".zip"), "удалён файл с чужим объектом внутри");
  autosaveResetSync();
});

// ——— свой файл узнаётся по участнику (таск 89) ————————————————————————
//
// Прежде признаком своего файла был идентификатор объекта. Он едет вместе с
// данными: копия профиля, восстановленная база, объект, открытый с заменой, — и
// двое пишут в один файл, а работа соседа читается как своя и не приезжает
// вовсе. Теперь признак — идентификатор участника: он живёт в настройках
// браузера, в объект и в файл проекта не попадает.

// Снимок, записанный соседом: тот же объект и тот же его идентификатор (так
// бывает после копии профиля), но своя отметка участника.
async function peerSnapshot(project, schemeId, member) {
  const withMark = addMark(project, {
    schemeId,
    typeId: project.markTypes[1].id,
    points: [{ x: 0.7, y: 0.7 }],
  }).project;
  const peer = { ...withMark, updatedAt: new Date(Date.now() + 60000).toISOString() };
  const blob = await packProject(peer, new Map(), { member });
  return { peer, bytes: new Uint8Array(await blob.arrayBuffer()) };
}

test("тот же объект у соседа — другой файл, и его правка приезжает", async () => {
  folder.files.clear();
  autosaveResetSync();
  const { project, schemeId } = await objectWithPlan("Пентхаус");
  await autosavePickFolder();

  const mine = await autosaveWrite(project);
  assert.equal(mine.ok, true, mine.error && mine.error.message);
  const member = await autosaveMemberId();
  assert.ok(member, "идентификатор участника не завёлся");
  assert.equal(mine.name, autosaveSnapshotName(project, member));

  // У соседа тот же объект с тем же идентификатором — и всё же свой файл.
  const theirMember = "0191b7d4-bbbb-7000-8000-000000000002";
  const theirName = autosaveSnapshotName(project, theirMember);
  assert.notEqual(theirName, mine.name, "два участника пишут в один файл");

  const { bytes } = await peerSnapshot(project, schemeId, theirMember);
  folder.put(theirName, bytes, Date.now() + 5000);

  const result = await autosaveScanExternal(project);
  assert.ok(result, "правка соседа с тем же идентификатором объекта не замечена");
  assert.equal(result.file, theirName);
  assert.equal(result.project.marks.length, project.marks.length + 1, "чужая метка не пришла");
  autosaveResetSync();
});

test("свой снимок не приезжает как чужая правка, даже переименованный руками", async () => {
  folder.files.clear();
  autosaveResetSync();
  const { project } = await objectWithPlan("Лофт");
  await autosavePickFolder();
  const member = await autosaveMemberId();
  await autosaveWrite(project);

  // Тот же снимок под именем, которого наши правила не знают.
  const copy = await packProject(project, new Map(), { member });
  folder.put("снимок от вторника.zip", new Uint8Array(await copy.arrayBuffer()), Date.now() + 60000);

  const today = deleteMark(project, project.marks[0].id).project;
  assert.equal(await autosaveScanExternal(today), null, "свой снимок пошёл в слияние");
  autosaveResetSync();
});

test("снимок прежней сборки опознан своим, принят предком и назван прежним файлом", async () => {
  folder.files.clear();
  autosaveResetSync();
  const { project } = await objectWithPlan("Дом у озера");
  await autosavePickFolder();
  const member = await autosaveMemberId();

  // То, что лежит у пользователя сейчас: имя с хвостом объекта, отметки
  // участника внутри нет.
  const legacyName = autosaveSnapshotName(project, null);
  assert.doesNotMatch(legacyName, /-0191/, "имя прежней сборки собрано неверно");
  const legacy = await packProject(project, new Map());
  folder.put(legacyName, new Uint8Array(await legacy.arrayBuffer()), Date.now() - 60000);

  // Открываем папку: прежний снимок узнан своим и стал общим предком.
  const found = await autosaveAdoptFolder(project);
  assert.ok(found && found.base, "прежний снимок не опознан своим");
  assert.equal(found.base.id, project.id);
  assert.equal(found.name, legacyName);
  assert.deepEqual(
    found.stale.map((item) => item.name),
    [legacyName],
    "про прежний файл человеку сказать нечего",
  );

  // Первая же запись заводит файл с новым именем, прежний остаётся лежать.
  const written = await autosaveWrite(deleteMark(project, project.marks[0].id).project);
  assert.equal(written.ok, true, written.error && written.error.message);
  assert.equal(written.name, autosaveSnapshotName(project, member));
  assert.notEqual(written.name, legacyName);
  assert.ok(folder.files.has(legacyName), "прежний файл удалён сам");

  // И в слияние он не идёт: иначе вернулась бы удалённая метка.
  const after = deleteMark(project, project.marks[0].id).project;
  assert.equal(await autosaveScanExternal(after), null, "прежний снимок пошёл в слияние");

  // Удалить его можно — но только по просьбе.
  const removed = await autosaveRemoveSnapshots(project, [legacyName]);
  assert.deepEqual(removed.removed, [legacyName]);
  assert.ok(folder.files.has(written.name), "удалён текущий снимок");
  autosaveResetSync();
});
