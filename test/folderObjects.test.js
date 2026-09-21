// Два объекта в одной папке и в одном браузере (дефект 95).
//
// Метка участника у них общая — браузер один, — и по ней файл соседнего
// объекта считался «своим»: он попадал в окно «Прежние файлы объекта», а окно
// предлагает удалить. Имена в тесте — дословно из жалобы: у «Белого дома»
// хвост объекта 317072d5, у «Данковой 60» — 142721c8, хвост участника у обоих
// b06278c4.
import test from "node:test";
import assert from "node:assert/strict";

import { setSetting, storeForgetMember, STORE_MEMBER_KEY } from "../src/store.js";
import { createProject } from "../src/model.js";
import { packProject } from "../src/projectFile.js";

const MEMBER = "b06278c4-1111-7000-8000-000000000001";
// Метка участника ставится до первого обращения к автосохранению: дальше она
// кэшируется на весь сеанс, как в браузере.
await setSetting(STORE_MEMBER_KEY, MEMBER);
storeForgetMember();

const {
  autosaveAdoptFolder,
  autosaveMemberId,
  autosaveOwnArchive,
  autosaveOwnSnapshot,
  autosaveOwnSnapshots,
  autosavePickFolder,
  autosaveRemoveSnapshots,
  autosaveResetSync,
  autosaveScanExternal,
  autosaveSnapshotName,
  autosaveWrite,
} = await import("../src/autosave.js");

const WHITE = { ...createProject({ name: "Белый дом" }), id: "317072d5-2222-7000-8000-000000000002" };
const DANKOVA = { ...createProject({ name: "Данкова 60" }), id: "142721c8-3333-7000-8000-000000000003" };
// Имя из жалобы, слово в слово.
const DANKOVA_FILE = "Данкова 60-142721c8-b06278c4.zip";

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
      if (!files.has(name)) throw new Error("нет такого файла");
      files.delete(name);
    },
    async *values() {
      for (const name of files.keys()) yield entryFor(name);
    },
  };
}

const folder = fakeFolder();
globalThis.window = { showDirectoryPicker: async () => folder };

async function bytesOf(project) {
  const blob = await packProject(project, new Map(), { member: MEMBER });
  return new Uint8Array(await blob.arrayBuffer());
}

test("имя из жалобы: файл «Данковой» не свой для «Белого дома»", async () => {
  assert.equal(await autosaveMemberId(), MEMBER, "метка участника не та");
  assert.equal(autosaveSnapshotName(DANKOVA, MEMBER), DANKOVA_FILE, "имя снимка собирается иначе, чем в жалобе");

  assert.equal(autosaveOwnSnapshot(WHITE, DANKOVA_FILE, MEMBER), false, "по имени принят за свой");
  assert.equal(autosaveOwnSnapshot(DANKOVA, DANKOVA_FILE, MEMBER), true, "свой же файл не узнан");
  assert.equal(
    autosaveOwnArchive(WHITE, { project: DANKOVA, member: MEMBER }, MEMBER),
    false,
    "по содержимому принят за свой — такой файл дали бы удалить",
  );
  assert.equal(autosaveOwnArchive(DANKOVA, { project: DANKOVA, member: MEMBER }, MEMBER), true);
});

test("два объекта в одном браузере: списки прежних файлов не пересекаются", async () => {
  folder.files.clear();
  autosaveResetSync();
  await autosavePickFolder();

  // У каждого объекта по снимку — как у заказчика после второго объекта.
  const white = await autosaveWrite(WHITE);
  assert.equal(white.ok, true, white.error && white.error.message);
  folder.put(DANKOVA_FILE, await bytesOf(DANKOVA), Date.now());

  const whiteOwn = (await autosaveOwnSnapshots(WHITE)).map((item) => item.name);
  assert.deepEqual(whiteOwn, [white.name], "в списке «Белого дома» лишнее: " + whiteOwn.join(", "));

  autosaveResetSync();
  const dankovaOwn = (await autosaveOwnSnapshots(DANKOVA)).map((item) => item.name);
  assert.deepEqual(dankovaOwn, [DANKOVA_FILE], "в списке «Данковой» лишнее: " + dankovaOwn.join(", "));

  // И окно про прежние файлы у обоих молчит: у каждого объекта по одному файлу.
  autosaveResetSync();
  const found = await autosaveAdoptFolder(WHITE);
  assert.deepEqual(found.stale, [], "окно поднялось бы на пустом месте");
});

test("удалить файл другого объекта нельзя даже прямой просьбой", async () => {
  folder.files.clear();
  autosaveResetSync();
  await autosavePickFolder();
  const white = await autosaveWrite(WHITE);
  folder.put(DANKOVA_FILE, await bytesOf(DANKOVA), Date.now());

  const result = await autosaveRemoveSnapshots(WHITE, [DANKOVA_FILE, white.name]);

  assert.deepEqual(result.removed, [], "снесён снимок работающего проекта");
  assert.ok(folder.files.has(DANKOVA_FILE), "файл «Данковой» удалён");
  assert.ok(folder.files.has(white.name), "удалён текущий снимок");
});

test("снимок соседнего объекта не приезжает как чужая работа", async () => {
  folder.files.clear();
  autosaveResetSync();
  await autosavePickFolder();
  await autosaveWrite(WHITE);

  // Объект, заведённый загрузкой того же файла: идентификаторы схем и меток у
  // него общие с нашим, и родство сработало бы — а писали файл всё равно мы.
  const twin = { ...WHITE, id: "142721c8-3333-7000-8000-000000000003", name: "Белый дом (копия)" };
  folder.put("Белый дом (копия)-142721c8-b06278c4.zip", await bytesOf(twin), Date.now() + 60000);

  assert.equal(await autosaveScanExternal(WHITE), null, "свой же файл поехал в слияние");
  autosaveResetSync();
});

test("прежний файл этого объекта в списке остаётся", async () => {
  folder.files.clear();
  autosaveResetSync();
  await autosavePickFolder();
  const white = await autosaveWrite(WHITE);
  // Имя прежней сборки: только хвост объекта, отметки участника внутри нет.
  const legacy = "Белый дом-317072d5.zip";
  const plain = await packProject(WHITE, new Map());
  folder.put(legacy, new Uint8Array(await plain.arrayBuffer()), Date.now() - 86400000);
  folder.put(DANKOVA_FILE, await bytesOf(DANKOVA), Date.now());

  const own = (await autosaveOwnSnapshots(WHITE)).map((item) => item.name).sort();
  assert.deepEqual(own, [legacy, white.name].sort(), "прежний файл объекта потерялся или пришёл чужой");

  const removed = await autosaveRemoveSnapshots(WHITE, [legacy, DANKOVA_FILE]);
  assert.deepEqual(removed.removed, [legacy], "удалено не то");
  assert.ok(folder.files.has(DANKOVA_FILE), "задет файл соседнего объекта");
});
