// Проверка zip на шве автосохранения в папку: снимок, легший на диск,
// перечитывается оттуда и сверяется с объектом. Здесь же — политика сверки:
// каждую запись подряд проверять незачем, а первую, после смены состава
// планов и раз в десять минут — нужно.
import test from "node:test";
import assert from "node:assert/strict";

import {
  autosavePickFolder,
  autosaveWrite,
  autosaveVerifyDue,
  autosaveResetVerify,
} from "../src/autosave.js";
import { unpackProject } from "../src/projectFile.js";
import { createProject, addScheme, addMark } from "../src/model.js";
import { putImage } from "../src/store.js";

// Папка на диске, которую можно попросить испортить запись: так выглядит сбой,
// о котором без сверки узнали бы в день восстановления.
function fakeFolder() {
  const files = new Map();
  const folder = {
    name: "Схемы",
    files,
    breakWrites: false,
    async getFileHandle(name) {
      return {
        async createWritable() {
          let bytes = null;
          return {
            async write(blob) {
              bytes = new Uint8Array(await blob.arrayBuffer());
            },
            async close() {
              if (folder.breakWrites && bytes && bytes.length > 80) bytes[60] ^= 0xff;
              files.set(name, bytes);
            },
          };
        },
        async getFile() {
          return new Blob([files.get(name) || new Uint8Array(0)]);
        },
      };
    },
  };
  return folder;
}

function plan(seed, length = 400) {
  const bytes = new Uint8Array(length);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  for (let i = 8; i < length; i += 1) bytes[i] = (seed * 29 + i * 13) % 256;
  return new Blob([bytes], { type: "image/png" });
}

async function objectWithPlan() {
  let project = createProject();
  const imageId = await putImage(plan(3));
  const scheme = addScheme(project, { name: "1 этаж", imageId, width: 1000, height: 800 });
  project = scheme.project;
  project = addMark(project, {
    schemeId: scheme.scheme.id,
    typeId: project.markTypes[0].id,
    points: [{ x: 0.3, y: 0.4 }],
  }).project;
  return { project, imageId };
}

const folder = fakeFolder();
globalThis.window = { showDirectoryPicker: async () => folder };

test("первая запись в папку сверяется, и файл на диске равен объекту", async () => {
  const { project } = await objectWithPlan();
  await autosavePickFolder();

  const result = await autosaveWrite(project);
  assert.equal(result.ok, true, result.error && result.error.message);

  const written = folder.files.get(result.name);
  assert.ok(written && written.length > 0, "снимок лёг в папку");
  const restored = await unpackProject(new Blob([written]));
  assert.equal(restored.project.id, project.id);
  assert.equal(restored.project.marks.length, project.marks.length);
  assert.equal(restored.images.size, 1);
});

test("сверка снимка идёт не на каждой правке, но на смене планов и по времени", async () => {
  const { project, imageId } = await objectWithPlan();
  await autosavePickFolder();
  const now = new Date("2026-09-16T10:00:00Z");
  const images = new Map([[imageId, plan(3)]]);

  await autosaveWrite(project, { date: now });
  // Только что сверили тот же объект с тем же составом планов.
  assert.equal(autosaveVerifyDue(project, images, now), false);
  assert.equal(autosaveVerifyDue(project, images, new Date(now.getTime() + 60000)), false);

  // Появился новый план — архив стал другим, сверять снова есть смысл.
  const grown = new Map([...images, ["план-2", plan(9)]]);
  assert.equal(autosaveVerifyDue(project, grown, now), true);

  // И раз в десять минут на всякий случай.
  assert.equal(autosaveVerifyDue(project, images, new Date(now.getTime() + 11 * 60000)), true);
});

test("битая запись на диск ловится сверкой, а не молчит", async () => {
  const { project } = await objectWithPlan();
  await autosavePickFolder();
  autosaveResetVerify();
  folder.breakWrites = true;
  try {
    const result = await autosaveWrite(project);
    assert.equal(result.ok, false, "испорченный снимок нельзя считать записанным");
    assert.equal(result.error.code, "fileCheckFailed");
    assert.ok(result.error.message.length > 0);
  } finally {
    folder.breakWrites = false;
  }
});
