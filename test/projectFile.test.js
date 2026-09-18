// Шов projectFile: что упаковано, то распаковывается обратно без потерь,
// а чужой или битый файл отвергается с внятной причиной.
import test from "node:test";
import assert from "node:assert/strict";

import {
  packProject,
  unpackProject,
  writeZip,
  readZip,
  verifyProjectFile,
  crc32,
  projectFileName,
  FORMAT_VERSION,
} from "../src/projectFile.js";
import {
  acceptProblem,
  acceptedProblems,
  createProject,
  addScheme,
  addMark,
  addRoom,
  MARK_DIMENSION_FIELDS,
  markDimensions,
  setMarkDimensions,
  updateMark,
  problemAccepted,
  setMarkNumber,
  validate,
} from "../src/model.js";

// ——— вспомогательное ————————————————————————————————————————————————

async function bytesOf(blob) {
  return new Uint8Array(await blob.arrayBuffer());
}

function fakePng(seed, length = 512) {
  const bytes = new Uint8Array(length);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  for (let i = 8; i < length; i += 1) bytes[i] = (seed * 31 + i * 17) % 256;
  return new Blob([bytes], { type: "image/png" });
}

// Объект из двух схем и полусотни меток: то, что реально уходит в файл.
function sampleProject() {
  let project = createProject();
  project = addRoom(project, { name: "Спальная Оли" }).project;
  const roomId = project.rooms[0].id;

  const first = addScheme(project, { name: "1 этаж", imageId: "img-1", width: 1280, height: 1978 });
  project = first.project;
  const second = addScheme(project, { name: "2 этаж", imageId: "img-2", width: 1000, height: 1400 });
  project = second.project;

  const schemes = [first.scheme.id, second.scheme.id];
  const types = project.markTypes;
  for (let i = 0; i < 52; i += 1) {
    const type = types[i % types.length];
    const schemeId = schemes[i % 2];
    const added = addMark(project, {
      schemeId,
      typeId: type.id,
      kind: i % 13 === 0 ? "line" : "point",
      points:
        i % 13 === 0
          ? [{ x: 0.1, y: 0.1 + i / 1000 }, { x: 0.4, y: 0.2 }, { x: 0.6, y: 0.35 }]
          : [{ x: (i % 10) / 10 + 0.01, y: (i % 7) / 10 + 0.02 }],
    });
    project = added.project;
    project = updateMark(project, added.mark.id, {
      roomId,
      location: "над тумбой слева",
      labelOffset: { dx: 12, dy: -10 },
    }).project;
  }
  return project;
}

function sampleImages() {
  return new Map([
    ["img-1", fakePng(3, 900)],
    ["img-2", fakePng(7, 1500)],
  ]);
}

// ——— круговой прогон ——————————————————————————————————————————————

test("упакованный объект распаковывается без потерь", async () => {
  const project = sampleProject();
  const images = sampleImages();

  const file = await packProject(project, images);
  assert.ok(file instanceof Blob, "packProject отдаёт Blob");

  const restored = await unpackProject(file);

  assert.deepEqual(restored.project, project);
  assert.equal(restored.project.formatVersion, FORMAT_VERSION);
  assert.equal(restored.project.marks.length, project.marks.length);

  assert.deepEqual([...restored.images.keys()].sort(), ["img-1", "img-2"]);
  for (const [id, blob] of images) {
    assert.deepEqual(await bytesOf(restored.images.get(id)), await bytesOf(blob), "картинка " + id);
    assert.equal(restored.images.get(id).type, blob.type);
  }
});

// ——— устройство архива ————————————————————————————————————————————————

// Свой обход локальных заголовков: структуру архива проверяем не тем кодом,
// который его написал.
function listEntries(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder();
  const found = [];
  let at = 0;
  while (at + 30 <= bytes.length && view.getUint32(at, true) === 0x04034b50) {
    const flags = view.getUint16(at + 6, true);
    const method = view.getUint16(at + 8, true);
    const packed = view.getUint32(at + 18, true);
    const size = view.getUint32(at + 22, true);
    const nameLength = view.getUint16(at + 26, true);
    const extraLength = view.getUint16(at + 28, true);
    const name = decoder.decode(bytes.subarray(at + 30, at + 30 + nameLength));
    const dataAt = at + 30 + nameLength + extraLength;
    found.push({ name, flags, method, packed, size, dataAt });
    at = dataAt + packed;
  }
  return found;
}

test("в архиве лежат project.json, schemes/ и README.txt", async () => {
  const project = sampleProject();
  const file = await packProject(project, sampleImages());
  const bytes = await bytesOf(file);

  assert.equal(file.type, "application/zip");
  assert.deepEqual([...bytes.slice(0, 4)], [0x50, 0x4b, 0x03, 0x04], "подпись zip в начале файла");

  const entries = listEntries(bytes);
  const names = entries.map((entry) => entry.name);
  assert.ok(names.includes("project.json"), "project.json: " + names.join(", "));
  assert.ok(names.includes("README.txt"), "README.txt: " + names.join(", "));
  assert.deepEqual(names.filter((name) => name.startsWith("schemes/")).sort(), [
    "schemes/img-1.png",
    "schemes/img-2.png",
  ]);

  // Центральный каталог на месте — без него распаковщик ОС файл не откроет.
  const tail = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const endAt = bytes.length - 22;
  assert.equal(tail.getUint32(endAt, true), 0x06054b50, "подпись конца каталога");
  assert.equal(tail.getUint16(endAt + 10, true), entries.length, "записей в каталоге");

  const readme = new TextDecoder().decode(
    bytes.subarray(
      entries.find((entry) => entry.name === "README.txt").dataAt,
      entries.find((entry) => entry.name === "README.txt").dataAt +
        entries.find((entry) => entry.name === "README.txt").packed,
    ),
  );
  assert.ok(readme.length > 0, "README.txt не пустой");
});

test("картинки лежат как есть, project.json сжат, версия формата записана", async () => {
  const project = sampleProject();
  const file = await packProject(project, sampleImages());
  const entries = listEntries(await bytesOf(file));

  const json = entries.find((entry) => entry.name === "project.json");
  assert.equal(json.method, 8, "project.json сжат deflate-raw");
  assert.ok(json.packed < json.size, "сжатый project.json короче исходного");

  for (const entry of entries.filter((item) => item.name.startsWith("schemes/"))) {
    assert.equal(entry.method, 0, entry.name + " без пережатия");
    assert.equal(entry.packed, entry.size);
  }

  const restored = await unpackProject(file);
  assert.equal(restored.project.formatVersion, FORMAT_VERSION);
});

test("архив без сжатия читается так же, как сжатый", async () => {
  const project = sampleProject();
  const images = sampleImages();

  const stored = await packProject(project, images, { compress: false });
  for (const entry of listEntries(await bytesOf(stored))) {
    assert.equal(entry.method, 0, entry.name + " записан без сжатия");
  }

  const restored = await unpackProject(stored);
  assert.deepEqual(restored.project, project);
  assert.deepEqual(await bytesOf(restored.images.get("img-1")), await bytesOf(images.get("img-1")));

  const compressed = await packProject(project, images);
  assert.deepEqual((await unpackProject(compressed)).project, restored.project);
});

// ——— чужой и битый файл ————————————————————————————————————————————————

async function refusal(promise) {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof Error, "отказ приходит ошибкой");
    assert.ok(error.message.length > 0, "у отказа есть текст");
    return error;
  }
  assert.fail("файл приняли, хотя он не должен читаться");
}

test("не-zip отвергается понятной ошибкой", async () => {
  const text = new Blob(["Это просто письмо, а не проект"], { type: "text/plain" });
  assert.equal((await refusal(unpackProject(text))).code, "notAProject");

  const png = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10, 1, 2, 3, 4])]);
  assert.equal((await refusal(unpackProject(png))).code, "notAProject");

  assert.equal((await refusal(unpackProject(new Blob([])))).code, "notAProject");
  assert.equal((await refusal(unpackProject(null))).code, "notAProject");
});

test("zip без project.json отвергается", async () => {
  const foreign = await writeZip([
    { name: "отчёт.txt", data: "чужой архив" },
    { name: "schemes/img-1.png", data: new Uint8Array([1, 2, 3]) },
  ]);
  assert.equal((await refusal(unpackProject(foreign))).code, "noProjectJson");
});

test("project.json с чужой структурой отвергается", async () => {
  // Версия формата своя, а данные чужие: отказ должен давать именно проверка структуры.
  const alien = await writeZip([
    { name: "project.json", data: JSON.stringify({ formatVersion: FORMAT_VERSION, hello: "world" }) },
  ]);
  assert.equal((await refusal(unpackProject(alien))).code, "foreignProject");

  const alienList = await writeZip([
    { name: "project.json", data: JSON.stringify([{ formatVersion: FORMAT_VERSION }]) },
  ]);
  assert.equal((await refusal(unpackProject(alienList))).code, "foreignProject");

  const almost = await writeZip([
    {
      name: "project.json",
      data: JSON.stringify({ id: "x", name: "Объект", categories: [], markTypes: [] }),
    },
  ]);
  assert.equal((await refusal(unpackProject(almost))).code, "foreignProject");

  const noVersion = await writeZip([
    {
      name: "project.json",
      data: JSON.stringify({ id: "x", name: "О", categories: [], markTypes: [], schemes: [], marks: [] }),
    },
  ]);
  assert.equal((await refusal(unpackProject(noVersion))).code, "foreignProject");
});

test("битый project.json отвергается без падения", async () => {
  const broken = await writeZip([{ name: "project.json", data: '{"id": "x", "marks": [' }]);
  assert.equal((await refusal(unpackProject(broken))).code, "brokenProjectJson");
});

test("версия формата из будущего отвергается с внятным текстом", async () => {
  const project = sampleProject();
  const future = await writeZip([
    {
      name: "project.json",
      data: JSON.stringify({ ...project, formatVersion: FORMAT_VERSION + 1 }),
    },
  ]);
  const error = await refusal(unpackProject(future));
  assert.equal(error.code, "futureVersion");
  assert.ok(error.message.includes(String(FORMAT_VERSION + 1)), "в тексте названа версия файла");
});

test("повреждённые байты внутри архива не проходят проверку", async () => {
  const file = await packProject(sampleProject(), sampleImages());
  const bytes = await bytesOf(file);
  const entries = listEntries(bytes);
  const json = entries.find((entry) => entry.name === "project.json");
  bytes[json.dataAt + 4] ^= 0xff;
  const error = await refusal(unpackProject(new Blob([bytes])));
  assert.equal(error.code, "archiveBroken");
});

test("имя файла выгрузки — объект и дата", () => {
  assert.equal(
    projectFileName({ name: "Квартира на Ленина" }, new Date("2026-09-15T10:00:00Z")),
    "Квартира на Ленина-2026-09-15.zip",
  );
  assert.equal(
    projectFileName({ name: 'Дом/Иванов: "дача"' }, new Date("2026-01-03T00:00:00Z")),
    "Дом Иванов дача-2026-01-03.zip",
  );
});

test("без CompressionStream архив пишется без сжатия и читается", async () => {
  const project = sampleProject();
  const images = sampleImages();
  const saved = globalThis.CompressionStream;
  let file;
  try {
    globalThis.CompressionStream = undefined;
    file = await packProject(project, images);
  } finally {
    globalThis.CompressionStream = saved;
  }

  for (const entry of listEntries(await bytesOf(file))) {
    assert.equal(entry.method, 0, entry.name + " записан без сжатия");
  }
  const restored = await unpackProject(file);
  assert.deepEqual(restored.project, project);
  assert.deepEqual(await bytesOf(restored.images.get("img-2")), await bytesOf(images.get("img-2")));
});

test("прогресс упаковки и распаковки сообщается по шагам", async () => {
  const project = sampleProject();
  const images = sampleImages();

  const steps = [];
  const file = await packProject(project, images, { onProgress: (step) => steps.push(step) });

  // project.json + две картинки + README.txt
  const packing = steps.filter((step) => step.phase === "pack");
  assert.equal(packing.length, 4);
  assert.deepEqual(packing.map((step) => step.done), [1, 2, 3, 4]);
  assert.ok(packing.every((step) => step.total === 4));
  assert.equal(packing[0].name, "project.json");

  // …и сверка собранного архива: по шагу на план.
  const checking = steps.filter((step) => step.phase === "check");
  assert.deepEqual(checking.map((step) => step.done), [1, 2]);
  assert.ok(checking.every((step) => step.total === 2));
  assert.equal(steps.length, packing.length + checking.length, "шаг без фазы не проскочил");

  const unpacking = [];
  await unpackProject(file, { onProgress: (step) => unpacking.push(step) });
  assert.deepEqual(unpacking.map((step) => step.done), [1, 2]);
  assert.ok(unpacking.every((step) => step.total === 2));
});

// ——— согласие с форматом, а не с самим собой ——————————————————————————

test("crc32 сходится с эталоном формата", () => {
  // Контрольная величина из описания CRC-32/ISO-HDLC: crc32("123456789") = 0xCBF43926.
  assert.equal(crc32(new TextEncoder().encode("123456789")), 0xcbf43926);
  assert.equal(crc32(new Uint8Array(0)), 0);
  assert.equal(crc32(new TextEncoder().encode("a")), 0xe8b7be43);
});

test("порча картинки ловится сверкой CRC, а не разбором сжатия", async () => {
  const file = await packProject(sampleProject(), sampleImages());
  const bytes = await bytesOf(file);
  const image = listEntries(bytes).find((entry) => entry.name === "schemes/img-1.png");
  assert.equal(image.method, 0, "картинка лежит без сжатия — распаковывать нечего");
  bytes[image.dataAt + 10] ^= 0x5a;
  const error = await refusal(unpackProject(new Blob([bytes])));
  assert.equal(error.code, "archiveBroken");
});

// ——— чужие архивы и не-ASCII ————————————————————————————————————————

test("кириллица в имени объекта и в id картинки переживает круг", async () => {
  let project = sampleProject();
  project = { ...project, name: "Квартира на Ленина" };
  const png = fakePng(5, 260);
  const images = new Map([["план-1", png]]);

  const file = await packProject(project, images);
  const entries = listEntries(await bytesOf(file));
  const image = entries.find((entry) => entry.name.startsWith("schemes/"));
  assert.equal(image.name, "schemes/%D0%BF%D0%BB%D0%B0%D0%BD-1.png", "id в имени записи закодирован");
  for (const entry of entries) {
    assert.equal(entry.flags & 0x0800, 0x0800, entry.name + ": имя помечено как UTF-8");
  }

  const restored = await unpackProject(file);
  assert.equal(restored.project.name, "Квартира на Ленина");
  assert.deepEqual([...restored.images.keys()], ["план-1"]);
  assert.deepEqual(await bytesOf(restored.images.get("план-1")), await bytesOf(png));
  assert.equal(projectFileName(project, new Date("2026-09-15T10:00:00Z")), "Квартира на Ленина-2026-09-15.zip");
});

// Архив собран штатным упаковщиком macOS: zip -r -X «Объект на Ленина».
// Внутри — папка верхнего уровня, кириллические имена без флага UTF-8,
// записи-каталоги и project.json, сжатый чужим deflate.
const OS_ZIP_BASE64 =
  "UEsDBAoAAAAAALWFL10AAAAAAAAAAAAAAAAfAAAA0J7QsdGK0LXQutGCINC90LAg0JvQtdC90LjQvdCwL1BLAwQKAAAAAAC1" +
  "hS9dAAAAAAAAAAAAAAAAJwAAANCe0LHRitC10LrRgiDQvdCwINCb0LXQvdC40L3QsC9zY2hlbWVzL1BLAwQKAAAAAAC1hS9d" +
  "U7MGQxoAAAAaAAAANQAAANCe0LHRitC10LrRgiDQvdCwINCb0LXQvdC40L3QsC9zY2hlbWVzL9C/0LvQsNC9LTEucG5nUE5H" +
  "LWZpeHR1cmUtYnl0ZXMtMDEyMzQ1NjdQSwMEFAAAAAgAtYUvXYl17fPnAAAAOgEAACsAAADQntCx0YrQtdC60YIg0L3QsCDQ" +
  "m9C10L3QuNC90LAvcHJvamVjdC5qc29uTVDbSsNAEP2VMM8rND7uH/is+CI+rMk0WdrNls22VUOgFAQp9Bf8hlbxgtL4C7N/" +
  "5DRZoQ8D55wZ5pyZBsbWGeWv0dXaViBTAToHCWN9f5aCgEoZZEovtA8beqfvsE7oiz6T8BzWtOM6UEdv1CVMVuGJe6+93IUV" +
  "7XhBpjwW1mmsQd7cCjDKTa4eZv/UWWsirLMSTa83Q4b6JECahO3RkD5Y00YVeHEcoV/6YfHQZ13q3Jd8wkhAiboo/YCty9GB" +
  "HLXRPdoVzs5nEWd2Xnl+AcimFbDQuGTUD1/qRxzWTNUdTiM9b9s/UEsDBAoAAAAAALWFL12B1PQKGwAAABsAAAApAAAA0J7Q" +
  "sdGK0LXQutGCINC90LAg0JvQtdC90LjQvdCwL1JFQURNRS50eHTRh9GC0L4g0Y3RgtC+INC30LAg0YTQsNC50LtQSwECHgMK" +
  "AAAAAAC1hS9dAAAAAAAAAAAAAAAAHwAAAAAAAAAAABAA7UEAAAAA0J7QsdGK0LXQutGCINC90LAg0JvQtdC90LjQvdCwL1BL" +
  "AQIeAwoAAAAAALWFL10AAAAAAAAAAAAAAAAnAAAAAAAAAAAAEADtQT0AAADQntCx0YrQtdC60YIg0L3QsCDQm9C10L3QuNC9" +
  "0LAvc2NoZW1lcy9QSwECHgMKAAAAAAC1hS9dU7MGQxoAAAAaAAAANQAAAAAAAAABAAAApIGCAAAA0J7QsdGK0LXQutGCINC9" +
  "0LAg0JvQtdC90LjQvdCwL3NjaGVtZXMv0L/Qu9Cw0L0tMS5wbmdQSwECHgMUAAAACAC1hS9diXXt8+cAAAA6AQAAKwAAAAAA" +
  "AAABAAAApIHvAAAA0J7QsdGK0LXQutGCINC90LAg0JvQtdC90LjQvdCwL3Byb2plY3QuanNvblBLAQIeAwoAAAAAALWFL12B" +
  "1PQKGwAAABsAAAApAAAAAAAAAAEAAACkgR8CAADQntCx0YrQtdC60YIg0L3QsCDQm9C10L3QuNC90LAvUkVBRE1FLnR4dFBL" +
  "BQYAAAAABQAFALUBAACBAgAAAAA=";

test("архив от штатного упаковщика ОС читается", async () => {
  const blob = new Blob([Buffer.from(OS_ZIP_BASE64, "base64")]);

  const entries = await readZip(blob);
  const names = [...entries.keys()];
  assert.ok(names.includes("Объект на Ленина/project.json"), names.join(", "));
  assert.ok(names.includes("Объект на Ленина/schemes/план-1.png"), names.join(", "));
  assert.ok(!names.some((name) => name.endsWith("/")), "записи-каталоги пропущены");
  assert.equal(
    new TextDecoder().decode(entries.get("Объект на Ленина/schemes/план-1.png")),
    "PNG-fixture-bytes-01234567",
  );

  const { project, images } = await unpackProject(blob);
  assert.equal(project.name, "Объект из штатного архиватора");
  assert.equal(project.schemes[0].imageId, "план-1");
  assert.deepEqual([...images.keys()], ["план-1"]);
  assert.equal(images.get("план-1").type, "image/png");
});

test("из нескольких вложенных папок берётся самая неглубокая", async () => {
  const shallow = { ...sampleProject(), name: "Из верхней папки" };
  const deep = { ...sampleProject(), name: "Из глубокой папки" };
  const file = await writeZip([
    { name: "архив/копия/project.json", data: JSON.stringify(deep) },
    { name: "объект/project.json", data: JSON.stringify(shallow) },
    { name: "объект/schemes/img-9.png", data: new Uint8Array([1, 2, 3, 4]) },
  ]);

  const restored = await unpackProject(file);
  assert.equal(restored.project.name, "Из верхней папки");
  assert.deepEqual([...restored.images.keys()], ["img-9"]);
});

test("zip64 отвергается своей причиной, а не мнимым размером", async () => {
  const bytes = await bytesOf(await packProject(sampleProject(), sampleImages()));
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  view.setUint32(bytes.length - 22 + 16, 0xffffffff, true);
  const error = await refusal(unpackProject(new Blob([bytes])));
  // Метки zip64 ставят и на маленькие архивы: причина — формат, а не размер.
  assert.equal(error.code, "zip64Unsupported");
  assert.notEqual(error.code, "archiveTooBig");
});

test("картинки не Map — отказ, а не молча пустой архив", async () => {
  const project = sampleProject();
  const png = fakePng(2, 200);

  for (const wrong of [{ "img-1": png }, [["img-1", png]], "img-1", 42]) {
    assert.equal((await refusal(packProject(project, wrong))).code, "imagesNotMap");
  }

  // Планов может не быть вовсе — это не ошибка, а пустой раздел schemes/.
  const empty = await unpackProject(await packProject(project));
  assert.equal(empty.images.size, 0);
  assert.deepEqual(empty.project, project);
});

test("файл версии 1 читается: контуров в нём нет, и поле дописывается пустым", async () => {
  const project = sampleProject();
  // Так выглядел project.json до контуров помещений: ни outlines, ни roomManual.
  const old = { ...project, formatVersion: 1 };
  delete old.outlines;
  const file = await writeZip([{ name: "project.json", data: JSON.stringify(old) }]);
  const restored = await unpackProject(file);
  assert.equal(restored.project.formatVersion, FORMAT_VERSION);
  assert.deepEqual(restored.project.outlines, []);
  assert.equal(restored.project.marks.length, project.marks.length);
});

// ——— проверка zip: архив читается обратно сразу после записи ——————————

test("сверка проходит на только что собранном архиве", async () => {
  const project = sampleProject();
  const images = sampleImages();
  const file = await packProject(project, images);

  const checked = await verifyProjectFile(file, project, images);
  assert.equal(checked.ok, true);
  assert.equal(checked.images, 2);
  assert.equal(checked.marks, project.marks.length);
  assert.equal(checked.schemes, project.schemes.length);
  assert.equal(checked.bytes, file.size);
});

test("подпорченный план сверку не проходит", async () => {
  const project = sampleProject();
  const images = sampleImages();
  const bytes = await bytesOf(await packProject(project, images));
  const entry = listEntries(bytes).find((item) => item.name.startsWith("schemes/"));
  bytes[entry.dataAt + 7] ^= 0x33;

  const error = await refusal(verifyProjectFile(new Blob([bytes]), project, images));
  assert.equal(error.code, "fileCheckFailed");
  assert.ok(error.message.includes("schemes/"), "в отказе названо место: " + error.message);
});

test("в архиве не тот объект — сверка это видит", async () => {
  const project = sampleProject();
  const other = { ...project, name: "Совсем другой объект" };
  const images = sampleImages();
  const file = await packProject(other, images);

  const error = await refusal(verifyProjectFile(file, project, images));
  assert.equal(error.code, "fileCheckFailed");
  assert.ok(error.message.includes("project.json"), error.message);
});

test("потерянная запись сверку не проходит", async () => {
  const project = sampleProject();
  const images = sampleImages();

  // Архив без README.txt и архив без одного плана собираются в обход packProject:
  // так выглядел бы сбой, при котором запись не доехала до файла.
  const noReadme = await writeZip([
    { name: "project.json", data: JSON.stringify({ ...project }, null, 2) },
    { name: "schemes/img-1.png", data: images.get("img-1"), compress: false },
    { name: "schemes/img-2.png", data: images.get("img-2"), compress: false },
  ]);
  assert.equal((await refusal(verifyProjectFile(noReadme, project, images))).code, "fileCheckFailed");

  const noImage = await writeZip([
    { name: "project.json", data: JSON.stringify({ ...project }, null, 2) },
    { name: "schemes/img-1.png", data: images.get("img-1"), compress: false },
    { name: "README.txt", data: "про файл" },
  ]);
  const error = await refusal(verifyProjectFile(noImage, project, images));
  assert.equal(error.code, "fileCheckFailed");
  assert.ok(error.message.includes("schemes/"), error.message);
});

test("сломанное сжатие не отдаёт битый архив наружу", async () => {
  const project = sampleProject();
  const images = sampleImages();
  const saved = globalThis.CompressionStream;
  // Писатель, который «сжимает» во что попало: так выглядит сбой записи,
  // который без сверки всплыл бы в день восстановления.
  globalThis.CompressionStream = class {
    constructor() {
      const broken = new TransformStream({
        transform(chunk, controller) {
          controller.enqueue(new Uint8Array([0, 1, 2, 3]));
        },
      });
      this.readable = broken.readable;
      this.writable = broken.writable;
    }
  };
  try {
    const error = await refusal(packProject(project, images));
    assert.equal(error.code, "fileCheckFailed");

    // Без сверки тот же вызов молча отдаёт файл, который уже не открыть, —
    // ради этого она и стоит.
    const unchecked = await packProject(project, images, { verify: false });
    assert.ok(unchecked instanceof Blob);
    assert.equal((await refusal(unpackProject(unchecked))).code, "archiveBroken");
  } finally {
    globalThis.CompressionStream = saved;
  }
});

// ——— принятые предупреждения едут с файлом ————————————————————————————
//
// Ответ «так и задумано» живёт в объекте, а не в настройках браузера: файл
// открывают на другой машине и вторым человеком из общей папки.

test("принятое предупреждение переезжает вместе с файлом", async () => {
  let project = createProject();
  project = addScheme(project, { name: "1 этаж", imageId: "img-1", width: 1000, height: 600 }).project;
  const schemeId = project.schemes[0].id;
  const typeId = project.markTypes.find((type) => type.code === "Т").id;
  const ids = [];
  for (const at of [0.2, 0.4, 0.6]) {
    const added = addMark(project, { schemeId, typeId, kind: "point", points: [{ x: at, y: 0.3 }] });
    project = added.project;
    ids.push(added.mark.id);
  }
  project = setMarkNumber(project, ids[1], 1).project;
  project = setMarkNumber(project, ids[2], 1).project;

  const problem = validate(project).find((item) => item.code === "repeatedNumber");
  project = acceptProblem(project, problem).project;

  const file = await packProject(project, new Map([["img-1", fakePng(5, 700)]]));
  const restored = await unpackProject(file);
  assert.deepEqual(acceptedProblems(restored.project), acceptedProblems(project));
  assert.equal(problemAccepted(restored.project, problem.key), true);
  // Ключ считается по типу и номеру, а они пережили упаковку без правок.
  assert.equal(validate(restored.project).find((item) => item.code === "repeatedNumber").key, problem.key);
});

// G68: файл, сделанный до этого таска, списка принятых не знает — открывается
// он как раньше, и пустого поля у него не появляется.
test("файл без списка принятых открывается как раньше", async () => {
  const project = sampleProject();
  const old = { ...project };
  delete old.accepted;
  const restored = await unpackProject(await packProject(old, sampleImages()));
  assert.equal(restored.project.accepted, undefined);
  assert.deepEqual(acceptedProblems(restored.project), []);
  assert.equal(restored.project.marks.length, project.marks.length);
});

// Размеры метки — те же три необязательных числа, что в модели. Проверяется
// не «поле есть», а что в файл уезжает и ноль, и незаполненное поле: ноль,
// прочитанный обратно как пустота, был бы потерей ответа.
test("размеры метки доезжают до файла и обратно, ноль остаётся нулём", async () => {
  let project = createProject();
  const scheme = addScheme(project, { name: "1 этаж", imageId: "img-1", width: 1000, height: 800 });
  project = scheme.project;
  const sized = addMark(project, {
    schemeId: scheme.scheme.id,
    typeId: project.markTypes[0].id,
    points: [{ x: 0.2, y: 0.3 }],
  });
  project = sized.project;
  const plain = addMark(project, {
    schemeId: scheme.scheme.id,
    typeId: project.markTypes[0].id,
    points: [{ x: 0.5, y: 0.5 }],
  });
  project = plain.project;
  project = setMarkDimensions(project, sized.mark.id, {
    length: 600,
    width: 1.5,
    heightAboveFloor: 0,
  }).project;

  const restored = (await unpackProject(await packProject(project, new Map([["img-1", fakePng(1)]])))).project;
  assert.deepEqual(restored, project);
  const back = restored.marks.find((mark) => mark.id === sized.mark.id);
  assert.deepEqual(markDimensions(back), { length: 600, width: 1.5, heightAboveFloor: 0 });
  // У метки, которой размеров не ставили, все три пусты — и пустыми и приехали.
  assert.deepEqual(markDimensions(restored.marks.find((mark) => mark.id === plain.mark.id)), {
    length: null,
    width: null,
    heightAboveFloor: null,
  });
});

// G68: файл, сделанный до этого таска, полей размеров не знает вовсе.
test("файл прежней версии без полей размеров читается как раньше", async () => {
  let project = createProject();
  const scheme = addScheme(project, { name: "1 этаж", imageId: "img-1", width: 1000, height: 800 });
  project = scheme.project;
  for (let i = 0; i < 3; i += 1) {
    project = addMark(project, {
      schemeId: scheme.scheme.id,
      typeId: project.markTypes[i].id,
      points: [{ x: 0.1 * (i + 1), y: 0.3 }],
    }).project;
  }
  const old = {
    ...project,
    marks: project.marks.map((mark) => {
      const copy = { ...mark };
      for (const field of MARK_DIMENSION_FIELDS) delete copy[field];
      return copy;
    }),
  };

  const restored = (await unpackProject(await packProject(old, new Map([["img-1", fakePng(2)]])))).project;
  // Упаковка ничего не дописала: метки вернулись ровно такими, какими уходили.
  assert.deepEqual(restored.marks, old.marks);
  assert.deepEqual(restored.marks.map((mark) => mark.number), project.marks.map((mark) => mark.number));
  for (const mark of restored.marks) {
    assert.deepEqual(markDimensions(mark), { length: null, width: null, heightAboveFloor: null });
  }
});
