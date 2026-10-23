// Группы параметров «Объёма» (правка после сборки сценариев).
//
// Слова заказчика: «Теперь в левом столбце Объём, да и аналогичное окно в
// мобильном интерфейсе надо как-то сгруппировать, плюс разворачивать отдельно
// их и т.д. организуй, а то свалка уже».
import test from "node:test";
import assert from "node:assert/strict";

import { getSetting, setSetting } from "../src/store.js";
import { strings } from "../src/strings.js";
import {
  VOLUME_GROUPS_SETTING,
  VOLUME_PARAM_GROUPS,
  createVolumeParamsFields,
  volumeParamsClockShort,
  volumeParamsFloorsShort,
  volumeParamsGroupOpen,
  volumeParamsGroupSet,
  volumeParamsGroupsOf,
  volumeParamsSceneShort,
} from "../src/panels/volumeParams.js";

function settled() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

// Своя маленькая страница: ряды собираются из `document.createElement`.
function fakeDocument() {
  class FakeNode {
    constructor(tag) {
      this.tagName = String(tag).toUpperCase();
      this.children = [];
      this.attributes = {};
      this.listeners = {};
      this.className = "";
      this.textContent = "";
      this.title = "";
      this.hidden = false;
      this.value = "";
      this.dataset = {};
      this.style = {};
    }
    get classList() {
      const names = () => this.className.split(/\s+/).filter(Boolean);
      const write = (list) => (this.className = [...new Set(list)].join(" "));
      return {
        add: (...more) => write([...names(), ...more]),
        remove: (...less) => write(names().filter((name) => !less.includes(name))),
        contains: (name) => names().includes(name),
        toggle: (name, on) => {
          const want = on === undefined ? !names().includes(name) : Boolean(on);
          write(want ? [...names(), name] : names().filter((item) => item !== name));
          return want;
        },
      };
    }
    setAttribute(name, value) {
      this.attributes[name] = String(value);
    }
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(this.attributes, name) ? this.attributes[name] : null;
    }
    addEventListener(type, fn) {
      (this.listeners[type] = this.listeners[type] || []).push(fn);
    }
    removeEventListener() {}
    click() {
      for (const fn of this.listeners.click || []) fn({ type: "click", target: this, preventDefault() {} });
    }
    append(...nodes) {
      for (const node of nodes) if (node !== null && node !== undefined) this.children.push(node);
    }
    replaceChildren(...nodes) {
      this.children = [];
      this.append(...nodes);
    }
    querySelector() {
      return null;
    }
  }
  return { createElement: (tag) => new FakeNode(tag), activeElement: null, getElementById: () => null };
}

function nodesOf(root) {
  const out = [];
  const walk = (node) => {
    for (const child of node.children || []) {
      if (typeof child !== "object") continue;
      out.push(child);
      walk(child);
    }
  };
  walk(root);
  return out;
}
const withClass = (root, name) => nodesOf(root).filter((node) => node.classList.contains(name));

function mount(extra = {}) {
  return createVolumeParamsFields({
    now: () => Date.now(),
    hour: () => ({ minutes: 21 * 60 + 34, phase: "evening", weather: { season: "autumn", sky: "overcast", tempC: 6.2, humidity: 84 } }),
    times: () => ({ riseMin: 7 * 60, setMin: 17 * 60, bySite: false }),
    rooms: () => [
      { id: "r1", name: "Кухня" },
      { id: "r2", name: "Спальня" },
    ],
    ...extra,
  });
}

test("группы по порядку, у каждой заголовок; раскрыты по умолчанию только этажи и время", () => {
  assert.deepEqual(VOLUME_PARAM_GROUPS, ["floors", "time", "scene", "frame", "home", "climate", "walking"]);
  for (const id of VOLUME_PARAM_GROUPS) assert.ok(strings.volume.groups[id], "у группы нет имени: " + id);
  assert.deepEqual(
    VOLUME_PARAM_GROUPS.filter((id) => volumeParamsGroupOpen(id)),
    ["floors", "time"],
  );
});

test("ряды разложены по группам: заголовок сворачивает только свою, колонка и окно видят одно", async () => {
  globalThis.document = fakeDocument();
  const column = mount();
  const window = mount({ window: true });
  try {
    const groups = withClass(column.node, "volume__group");
    assert.deepEqual(
      groups.map((node) => node.attributes["data-group"]),
      VOLUME_PARAM_GROUPS,
      "группы не те или не в том порядке",
    );
    const byId = (root, id) => withClass(root, "volume__group").find((node) => node.attributes["data-group"] === id);
    const bodyOf = (node) => withClass(node, "volume__groupBody")[0];
    const headOf = (node) => withClass(node, "volume__groupHead")[0];
    // Умолчание: этажи и время раскрыты, остальное свёрнуто.
    assert.equal(bodyOf(byId(column.node, "time")).hidden, false);
    assert.equal(bodyOf(byId(column.node, "scene")).hidden, true);
    assert.ok(byId(column.node, "scene").classList.contains("is-collapsed"));
    assert.equal(headOf(byId(column.node, "scene")).attributes["aria-expanded"], "false");
    // Свёрнутая группа говорит главное о себе в заголовке.
    assert.equal(withClass(byId(column.node, "time"), "volume__groupSum")[0].textContent.slice(0, 5), "21:34");
    assert.match(withClass(byId(column.node, "scene"), "volume__groupSum")[0].textContent, /пасмурно, \+6,2 °C/);
    assert.equal(withClass(byId(column.node, "climate"), "volume__groupSum")[0].textContent, "помещений: 2");
    // Щелчок по заголовку «Фон и погода» раскрывает её — и только её, и в окне тоже.
    headOf(byId(column.node, "scene")).click();
    assert.equal(bodyOf(byId(column.node, "scene")).hidden, false);
    assert.equal(bodyOf(byId(window.node, "scene")).hidden, false, "окно не узнало о раскрытой группе");
    assert.equal(bodyOf(byId(column.node, "frame")).hidden, true, "раскрылась соседняя группа");
    assert.equal(headOf(byId(column.node, "scene")).attributes["aria-expanded"], "true");
    // Пересборка рядов (сменили отметку, этаж) раскрытую группу не сворачивает.
    column.refresh();
    assert.equal(bodyOf(byId(column.node, "scene")).hidden, false, "пересборка забыла раскрытую группу");
    // Свернули время — запомнилось в настройках браузера.
    headOf(byId(window.node, "time")).click();
    assert.equal(bodyOf(byId(column.node, "time")).hidden, true);
    await settled();
    const saved = await getSetting(VOLUME_GROUPS_SETTING);
    assert.equal(saved.scene, true);
    assert.equal(saved.time, false);
    // Помещений нет — нет и группы климата.
    const bare = mount({ rooms: () => [] });
    assert.ok(!withClass(bare.node, "volume__group").some((node) => node.attributes["data-group"] === "climate"));
    bare.dispose();
  } finally {
    column.dispose();
    window.dispose();
    volumeParamsGroupSet("scene", false);
    volumeParamsGroupSet("time", true);
    delete globalThis.document;
  }
});

test("раскрытые группы поднимаются из настроек при открытии страницы; мусор не принимается", async () => {
  await setSetting(VOLUME_GROUPS_SETTING, { climate: true, floors: false, чужая: true, time: "да" });
  const fresh = await import("../src/panels/volumeParams.js?groups-fresh");
  fresh.volumeParamsLoad();
  await fresh.volumeParamsReady();
  assert.equal(fresh.volumeParamsGroupOpen("climate"), true);
  assert.equal(fresh.volumeParamsGroupOpen("floors"), false);
  assert.equal(fresh.volumeParamsGroupOpen("time"), true, "строка вместо «да/нет» перебила умолчание");
  assert.deepEqual(volumeParamsGroupsOf({ climate: true, чужая: true, time: "да" }), { climate: true });
  assert.deepEqual(volumeParamsGroupsOf(["climate"]), {});
  assert.deepEqual(volumeParamsGroupsOf(null), {});
  await setSetting(VOLUME_GROUPS_SETTING, {});
});

test("сводки заголовков: этажи, час и фон с погодой", () => {
  assert.equal(volumeParamsFloorsShort(false, true), "одна схема · без крыши");
  assert.equal(volumeParamsFloorsShort(true, false), "все этажи");
  assert.equal(volumeParamsClockShort({ fixed: true, speed: 60 }, 21 * 60 + 34), "21:34 · стоит");
  assert.equal(volumeParamsClockShort({ fixed: false, speed: 1 }, 9 * 60 + 5), "09:05 · идёт");
  assert.equal(volumeParamsClockShort({ fixed: false, speed: 60 }, 0), "00:00 · ×60");
  assert.equal(volumeParamsSceneShort("city", null), strings.volume.backdropCity);
  assert.equal(volumeParamsSceneShort("nature", { sky: "snow", tempC: -3 }), "Природа · снег, −3 °C");
});
