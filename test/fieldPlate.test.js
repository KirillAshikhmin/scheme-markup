// Плашка над полем: умолчание свёрнутости (ревью ветки, F1).
//
// Подсказка «Объёма» на странице просмотра заводится сложенной: это 1131 знак
// про клавиши, захват мыши и двери, и развёрнутой она занимала на телефоне две
// трети экрана, накрывая строки просмотра. Живой прогон нашёл здесь ошибку,
// которой не было видно ни в тестах, ни в консоли: довод `collapsed` затирался
// одноимённой функцией внутри плашки, и умолчание не доезжало вовсе.
import test from "node:test";
import assert from "node:assert/strict";

import { createFieldPlate, plateUnseen } from "../src/panels/plate.js";

// Своя маленькая страница: плашке нужны `createElement`, `createElementNS` и
// горсть свойств узла (тот же приём, что в `volumeParamGroups.test.js`).
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
      this.dataset = {};
      this.style = { setProperty() {} };
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
    click() {
      for (const fn of this.listeners.click || []) fn({ type: "click", target: this });
    }
    append(...nodes) {
      for (const node of nodes) if (node !== null && node !== undefined) this.children.push(node);
    }
    replaceChildren(...nodes) {
      this.children = [];
      this.append(...nodes);
    }
  }
  return {
    createElement: (tag) => new FakeNode(tag),
    createElementNS: (ns, tag) => new FakeNode(tag),
    activeElement: null,
    getElementById: () => null,
  };
}

function withPage(run) {
  const had = Object.prototype.hasOwnProperty.call(globalThis, "document");
  const was = globalThis.document;
  globalThis.document = fakeDocument();
  try {
    return run();
  } finally {
    if (had) globalThis.document = was;
    else delete globalThis.document;
  }
}

const body = (plate) => plate.node.children.find((child) => child.className === "canvas-hint__text");

test("плашка заводится свёрнутой, когда об этом сказано, и развёрнутой — когда нет", () => {
  withPage(() => {
    const shut = createFieldPlate({ side: "left", setting: "test-plate-shut", collapsed: true });
    shut.update("Мышь поворачивает камеру на месте");
    assert.ok(shut.node.classList.contains("is-collapsed"), "сложенной плашке нужен класс");
    assert.equal(body(shut).hidden, true, "текста сложенной плашки не видно");

    const open = createFieldPlate({ side: "left", setting: "test-plate-open" });
    open.update("Мышь поворачивает камеру на месте");
    assert.equal(open.node.classList.contains("is-collapsed"), false, "без довода плашка как была — развёрнутой");
    assert.equal(body(open).hidden, false);

    // Умолчание — не выбор человека: нажатие на знак разворачивает её, и
    // дальше она его.
    const toggle = shut.node.children.find((child) => child.className === "canvas-hint__toggle");
    toggle.click();
    assert.equal(shut.node.classList.contains("is-collapsed"), false, "знак разворачивает сложенную по умолчанию");
    // Правило «текст сменился» плашка не потеряла.
    assert.equal(plateUnseen("было", "стало"), true);
    assert.equal(plateUnseen(null, "стало"), false);
  });
});
