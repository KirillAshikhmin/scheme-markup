// Идентификатор участника: кто пишет в общую папку. Заводится один раз на
// браузер, живёт в настройках хранилища и в объект не попадает.
//
// IndexedDB в Node нет — store работает в памяти, и это ровно тот случай, ради
// которого у идентификатора есть запасная полка: без неё каждая перезагрузка
// заводила бы в папке пользователя ещё один файл.
import test from "node:test";
import assert from "node:assert/strict";

import { getSetting, setSetting, storeForgetMember, storeMemberId, STORE_MEMBER_KEY } from "../src/store.js";
import { createProject } from "../src/model.js";
import { autosaveMemberId, autosaveSnapshotName } from "../src/autosave.js";

test("идентификатор участника заводится один раз и не меняется", async () => {
  const first = await storeMemberId();
  assert.equal(typeof first, "string");
  assert.ok(first.length >= 16, "идентификатор подозрительно короткий: " + first);
  assert.equal(await storeMemberId(), first, "второй вызов выдал другого участника");

  // Новый сеанс той же вкладки: кэш пуст, а идентификатор обязан подняться из
  // настроек тем же — иначе в папке завёлся бы второй файл.
  storeForgetMember();
  assert.equal(await storeMemberId(), first, "после перезапуска участник сменился");
  assert.equal(await getSetting(STORE_MEMBER_KEY), first, "участник живёт не в настройках");
});

test("участник не попадает в объект", async () => {
  const member = await storeMemberId();
  const project = createProject({ name: "Квартира на Ленина" });
  assert.equal(JSON.stringify(project).includes(member), false, "участник уехал в объект");
});

test("автосохранение берёт того же участника, что и хранилище", async () => {
  const member = await autosaveMemberId();
  assert.equal(member, await storeMemberId());

  const project = createProject({ name: "Квартира на Ленина" });
  const name = autosaveSnapshotName(project, member);
  assert.ok(name.endsWith("-" + member.replace(/[^0-9a-z]/gi, "").slice(0, 8).toLowerCase() + ".zip"), name);
});

test("уже записанный участник поднимается из настроек, а не заводится заново", async () => {
  await setSetting(STORE_MEMBER_KEY, "0191b7d4-bbbb-7000-8000-000000000002");
  storeForgetMember();
  assert.equal(await storeMemberId(), "0191b7d4-bbbb-7000-8000-000000000002");
});
