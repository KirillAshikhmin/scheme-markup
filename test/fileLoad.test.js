// Приёмка файла проекта: объект, пришедший из архива, обязан получить свежие
// идентификаторы — свой и у картинок. Иначе повторная загрузка того же файла
// молча перезапишет объект в базе, а картинки склеятся с чужими.
// DOM здесь не участвует: проверяется чистая часть загрузки.
import test from "node:test";
import assert from "node:assert/strict";
import { addMark, addScheme, createProject } from "../src/model.js";
import { packProject, projectFileName, unpackProject } from "../src/projectFile.js";
import {
  adoptLoadedProject,
  autosaveAgoText,
  autosaveOwnSnapshot,
  autosaveSnapshotName,
} from "../src/autosave.js";

function pixels(byte) {
  return new Blob([new Uint8Array([byte, byte + 1, byte + 2, byte + 3])], { type: "image/png" });
}

async function packed() {
  let project = createProject({ name: "Квартира на Ленина" });
  const first = addScheme(project, { name: "1 этаж", imageId: "img-1", width: 1000, height: 800 });
  project = first.project;
  const second = addScheme(project, { name: "2 этаж", imageId: "img-2", width: 900, height: 700 });
  project = second.project;
  const typeId = project.markTypes[0].id;
  project = addMark(project, {
    schemeId: first.scheme.id,
    typeId,
    kind: "point",
    points: [{ x: 0.5, y: 0.5 }],
  }).project;

  const images = new Map([
    ["img-1", pixels(1)],
    ["img-2", pixels(9)],
  ]);
  const blob = await packProject(project, images);
  return { project, blob };
}

test("загрузка новым объектом переприсваивает id объекта и картинок", async () => {
  const source = await packed();
  const loaded = await unpackProject(source.blob);

  const adopted = adoptLoadedProject(loaded, { mode: "new" });

  assert.notEqual(adopted.project.id, source.project.id, "id объекта обязан смениться");
  assert.equal(adopted.project.name, source.project.name);
  assert.equal(adopted.project.marks.length, 1);
  assert.equal(adopted.images.size, 2);

  const oldIds = new Set(["img-1", "img-2"]);
  for (const scheme of adopted.project.schemes) {
    assert.ok(scheme.imageId, "схема без картинки — потеря плана");
    assert.ok(!oldIds.has(scheme.imageId), "ссылка схемы осталась на старый id картинки");
    assert.ok(adopted.images.has(scheme.imageId), "в наборе нет картинки под новым id схемы");
  }
  for (const id of adopted.images.keys()) assert.ok(!oldIds.has(id), "старый id картинки уцелел");
});

test("две загрузки одного файла дают разные объекты и разные картинки", async () => {
  const source = await packed();
  const first = adoptLoadedProject(await unpackProject(source.blob), { mode: "new" });
  const second = adoptLoadedProject(await unpackProject(source.blob), { mode: "new" });

  assert.notEqual(first.project.id, second.project.id);
  const firstImages = new Set(first.images.keys());
  for (const id of second.images.keys()) {
    assert.ok(!firstImages.has(id), "второй загрузке достался id картинки первой");
  }
});

test("загрузка поверх текущего сохраняет id объекта, но не id картинок", async () => {
  const source = await packed();
  const loaded = await unpackProject(source.blob);

  const adopted = adoptLoadedProject(loaded, { mode: "replace", currentId: "keep-me" });

  assert.equal(adopted.project.id, "keep-me");
  for (const scheme of adopted.project.schemes) {
    assert.ok(adopted.images.has(scheme.imageId));
    assert.notEqual(scheme.imageId, "img-1");
    assert.notEqual(scheme.imageId, "img-2");
  }
});

test("схема без картинки в архиве остаётся без плана, а не со ссылкой в никуда", async () => {
  const source = await packed();
  const loaded = await unpackProject(source.blob);
  loaded.images.delete([...loaded.images.keys()][0]);

  const adopted = adoptLoadedProject(loaded, { mode: "new" });

  const lost = adopted.project.schemes.filter((scheme) => scheme.imageId === null);
  assert.equal(lost.length, 1, "ссылка на пропавшую картинку должна обнулиться");
  assert.equal(adopted.images.size, 1);
});

// Строка «в файл выгружено: N назад» из истории 71. Считается от отметки
// выгрузки, а не от «сейчас» в коде под тестом: время передаётся явно.
test("давность выгрузки читается по-русски и склоняется", () => {
  const at = "2026-09-15T12:00:00.000Z";
  const after = (minutes) => new Date(Date.parse(at) + minutes * 60000);

  assert.equal(autosaveAgoText(at, after(0)), "только что");
  assert.equal(autosaveAgoText(at, after(0.5)), "только что");
  assert.equal(autosaveAgoText(at, after(1)), "1 минуту назад");
  assert.equal(autosaveAgoText(at, after(2)), "2 минуты назад");
  assert.equal(autosaveAgoText(at, after(5)), "5 минут назад");
  assert.equal(autosaveAgoText(at, after(60)), "1 час назад");
  assert.equal(autosaveAgoText(at, after(3 * 60)), "3 часа назад");
  assert.equal(autosaveAgoText(at, after(24 * 60)), "1 день назад");
  assert.equal(autosaveAgoText(at, after(3 * 24 * 60)), "3 дня назад");
  assert.equal(autosaveAgoText(at, after(11 * 24 * 60)), "11 дней назад");
  assert.equal(autosaveAgoText(at, after(21 * 24 * 60)), "21 день назад");
});

test("без отметки выгрузки строка говорит, что файла ещё не было", () => {
  assert.equal(autosaveAgoText(null, new Date()), "ещё ни разу");
});

// Картинки кладёт в хранилище браузера store.putImage — идентификатор он
// выдаёт сам. Чтобы переприсваивание оставалось в одном месте, эти же
// идентификаторы отдаются приёмке, и второго remap в панели не заводится.
test("идентификаторы картинок можно задать снаружи — хранилищем", async () => {
  const source = await packed();
  const loaded = await unpackProject(source.blob);
  const fromStore = new Map([...loaded.images.keys()].map((old, index) => [old, "store-" + index]));

  const adopted = adoptLoadedProject(loaded, { mode: "new", imageIds: fromStore });

  assert.deepEqual([...adopted.images.keys()].sort(), ["store-0", "store-1"]);
  for (const scheme of adopted.project.schemes) {
    assert.ok(String(scheme.imageId).startsWith("store-"), "схема должна ссылаться на id хранилища");
    assert.ok(adopted.images.has(scheme.imageId));
  }
});

// Одна картинка на две схемы — обычное дело: этаж и его же план с другой
// разметкой. Переприсваивание обязано оставить обеим схемам одну и ту же
// новую ссылку, а картинку — одну.
test("картинка, общая для двух схем, остаётся одной и общей", async () => {
  let project = createProject({ name: "Двухсхемный" });
  const first = addScheme(project, { name: "Свет", imageId: "shared", width: 1000, height: 800 });
  project = first.project;
  const second = addScheme(project, { name: "Розетки", imageId: "shared", width: 1000, height: 800 });
  project = second.project;
  const blob = await packProject(project, new Map([["shared", pixels(7)]]));

  const adopted = adoptLoadedProject(await unpackProject(blob), { mode: "new" });

  const ids = adopted.project.schemes.map((scheme) => scheme.imageId);
  assert.equal(ids.length, 2);
  assert.ok(ids[0], "первая схема осталась без плана");
  assert.equal(ids[0], ids[1], "схемы должны делить одну ссылку на картинку");
  assert.notEqual(ids[0], "shared", "ссылка осталась на старый id");
  assert.equal(adopted.images.size, 1, "общая картинка не должна раздваиваться");
  assert.ok(adopted.images.has(ids[0]));
});

// Снимок в папку автосохранения именуется по объекту и хвосту его
// идентификатора — без даты. Двух объектов с одним именем достаточно, чтобы
// один затёр другого, поэтому хвост нужен; дата же заводила бы по файлу на
// каждый день, и вчерашний снимок приезжал бы как чужая работа.
test("снимки разных объектов не попадают в один файл", () => {
  const one = createProject({ name: "Квартира на Ленина" });
  const two = createProject({ name: "Квартира на Ленина" });

  const nameOne = autosaveSnapshotName(one);
  const nameTwo = autosaveSnapshotName(two);

  assert.notEqual(one.id, two.id);
  assert.notEqual(nameOne, nameTwo, "одинаковые имена объектов дали один файл");
  assert.match(nameOne, /^Квартира на Ленина-[0-9a-f]{8}\.zip$/);
  assert.equal(autosaveSnapshotName(one), nameOne, "имя снимка обязано быть тем же");
});

// Имя снимка не зависит от дня: работа неделю — по-прежнему один файл. Дата
// остаётся в имени ручной выгрузки, это копия «на память».
test("имя снимка не двигается со дня на день, а имя выгрузки — двигается", () => {
  const project = createProject({ name: "Квартира на Ленина" });
  const monday = new Date("2026-09-14T10:00:00.000Z");
  const friday = new Date("2026-09-18T10:00:00.000Z");

  assert.equal(autosaveSnapshotName(project, monday), autosaveSnapshotName(project, friday));
  assert.doesNotMatch(autosaveSnapshotName(project), /\d{4}-\d{2}-\d{2}/, "дата в имени снимка");
  assert.notEqual(projectFileName(project, monday), projectFileName(project, friday));
  assert.match(projectFileName(project, friday), /-2026-09-18\.zip$/);
});

// Свой снимок узнаётся по хвосту-идентификатору — под любым именем объекта и с
// датой в имени, как его писали прежние сборки.
test("прежние снимки того же объекта узнаются своими, чужие — нет", () => {
  const project = createProject({ name: "Квартира на Ленина" });
  const stranger = createProject({ name: "Квартира на Ленина" });
  const tag = autosaveSnapshotName(project).replace(/^.*-([0-9a-f]{8})\.zip$/, "$1");

  assert.equal(autosaveOwnSnapshot(project, autosaveSnapshotName(project)), true);
  assert.equal(
    autosaveOwnSnapshot(project, "Квартира на Ленина-2026-09-15-" + tag + ".zip"),
    true,
    "снимок прежнего дня не узнан своим",
  );
  assert.equal(
    autosaveOwnSnapshot(project, "Старое имя объекта-" + tag + ".zip"),
    true,
    "снимок прежнего имени объекта не узнан своим",
  );
  assert.equal(autosaveOwnSnapshot(project, autosaveSnapshotName(stranger)), false, "чужой файл принят за свой");
  assert.equal(autosaveOwnSnapshot(project, "Квартира на Ленина-2026-09-15.zip"), false);
});
