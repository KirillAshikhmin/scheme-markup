// Карточка устройства в имитации и правила щелчка по метке-устройству (таск 08
// сценариев; истории 2.5–2.7, 2.10, 2.13).
//
// Две части, и обе чистые там, где можно:
//
//   — **план щелчка** (`deviceClickPlan`, `deviceClickAct`): что делает щелчок
//     по метке в «Схеме» и клавиша `E`. Светильник, реле, розетка, ТВ, вентилятор,
//     штора — переключаются; датчик — срабатывает; клавиша выключателя — по её
//     привязке: у привязанной щелчок переключает «Выключатель» канала, у отвязанной
//     (и у отдельной кнопки) — одиночное, двойное, долгое по `pressDetector`;
//     у многоклавишного выключателя щелчок только выделяет метку, а клавишу
//     выбирают в карточке;
//   — **карточка** (`deviceCardModel` — чистая модель, `deviceCardView` — узлы):
//     клавиши с тремя кнопками нажатий, сервисы с органом управления по формату
//     характеристики и раздел «Логика» — привязки логических сценариев с
//     формой опций (`scenarioScript.js`, история 5.7). Её кладут в
//     `#canvas-card` через `markCardParts(…, {extra})`.
//
// Состояние дома — зеркало `simulation.js`; здесь ничего не пишется в объект.
import { simAct, simPress, simRunning, simValue, simWatch } from "../simulation.js";
import { markAccessory } from "../sim/home.js";
import { pressDetector } from "../sim/presses.js";
import { strings, text } from "../strings.js";
import { scenarioScriptLogicOf, scenarioScriptLogicView } from "./scenarioScript.js";
import { uiButton, uiEl } from "./ui.js";

// Что срабатывает как датчик (движок: `SIM_ENGINE_SENSORS`).
const DEVICE_CARD_SENSORS = new Set(["MotionSensor", "OccupancySensor", "ContactSensor", "LeakSensor", "SmokeSensor"]);
// Что переключается щелчком (нагрузки и прочее, что понимает `toggle`).
const DEVICE_CARD_TOGGLES = new Set([
  "Lightbulb",
  "Switch",
  "Outlet",
  "Fan",
  "HeaterCooler",
  "Television",
  "Valve",
  "WindowCovering",
  "Thermostat",
  "LockMechanism",
  "Speaker",
]);
// Клавиши: кнопка канала и звонок.
const DEVICE_CARD_KEYS = new Set(["StatelessProgrammableSwitch", "Doorbell"]);
// Сервисы и характеристики, которых в списке значений нет: клавиши показаны
// отдельно, номер клавиши — константа.
const DEVICE_CARD_HIDDEN = new Set(["ProgrammableSwitchEvent", "ServiceLabelIndex"]);

/** Три нажатия клавиши по порядку. */
export const DEVICE_CARD_PRESSES = Object.freeze(["single", "double", "long"]);

function deviceCardList(value) {
  return Array.isArray(value) ? value : [];
}

function deviceCardChannel(service) {
  return Number.isInteger(service.channel) && service.channel >= 1 ? service.channel : 1;
}

/**
 * Клавиши аксессуара: `[{index, channel, relay, decoupled, detect, bell}]`.
 * `relay` — индекс «Выключателя» того же канала или `null` (профиль до G11 и
 * отдельная кнопка); `detect` — клавиша шлёт нажатия, которые различает
 * `pressDetector` (отвязанная и без «Выключателя»); привязанная с «Выключателем»
 * и звонок отвечают сразу на одиночное.
 */
export function deviceKeysOf(accessory) {
  const services = deviceCardList(accessory && accessory.services);
  const relays = new Map();
  for (const service of services) {
    if (service.type === "Switch" && !relays.has(deviceCardChannel(service))) relays.set(deviceCardChannel(service), service.index);
  }
  const used = new Set();
  const out = [];
  for (const service of services) {
    if (!DEVICE_CARD_KEYS.has(service.type)) continue;
    const bell = service.type === "Doorbell";
    const channel = deviceCardChannel(service);
    let relay = !bell && relays.has(channel) && !used.has(relays.get(channel)) ? relays.get(channel) : null;
    if (relay !== null) used.add(relay);
    const decoupled = service.decoupled === true;
    out.push({
      index: service.index,
      channel,
      relay,
      decoupled,
      bell,
      detect: !bell && (decoupled || relay === null),
    });
  }
  return out;
}

/**
 * Что делает щелчок по метке-устройству:
 *   `{kind: "key", key}` — одна клавиша (нажатие по её правилу);
 *   `{kind: "keys", keys}` — несколько клавиш: щелчок выделяет, выбор — в карточке;
 *   `{kind: "sensor", service}` — датчик срабатывает;
 *   `{kind: "toggle"}` — переключается основной сервис;
 *   `{kind: "none"}` — щелкать нечем (датчик температуры, реле без сервиса).
 */
export function deviceClickPlan(accessory) {
  if (!accessory) return { kind: "none" };
  const keys = deviceKeysOf(accessory);
  if (keys.length === 1) return { kind: "key", key: keys[0] };
  if (keys.length > 1) return { kind: "keys", keys };
  const services = deviceCardList(accessory.services);
  const sensor = services.find((service) => DEVICE_CARD_SENSORS.has(service.type));
  if (sensor) return { kind: "sensor", service: sensor.index };
  if (services.some((service) => DEVICE_CARD_TOGGLES.has(service.type))) return { kind: "toggle" };
  return { kind: "none" };
}

/**
 * Исполнить щелчок немедленно — то, что делает клавиша `E` у выделенной метки и
 * щелчок по метке без нажатий: у клавиши — одиночное, у датчика — срабатывание,
 * у остального — переключение. Многоклавишный выключатель и «нечем щёлкать» —
 * `false`. Остальное — ответ `simAct`: `true`, если дом запущен. `io` —
 * `{press(markId, index, press), act(action)}`; по умолчанию — имитация сеанса
 * (тесту подставляется запись).
 */
export function deviceClickAct(markId, plan, io = { press: simPress, act: simAct }) {
  if (!plan || !markId) return false;
  if (plan.kind === "key") return io.press(markId, plan.key.index, "single");
  if (plan.kind === "sensor") return io.act({ kind: "sensor", markId, service: plan.service });
  if (plan.kind === "toggle") return io.act({ kind: "toggle", markId });
  return false;
}

/**
 * Щелчок по метке по её объекту: аксессуар → план → действие. Дом остановлен —
 * ничего не происходит (`false`).
 */
export function deviceClickMark(project, markId, io = undefined) {
  if (!simRunning()) return false;
  return deviceClickAct(markId, deviceClickPlan(markAccessory(project, markId)), io);
}

/**
 * Нажатия одной клавиши мышью, пальцем или клавишей: `down`/`up` — нажали и
 * отпустили; распознанное (`pressDetector`) уходит в `fire("single" | "double" |
 * "long")`. Долгое приходит, пока клавиша ещё зажата, одиночное — когда истекло
 * окно двойного. `abort` — жест оказался панорамой: начатое нажатие брошено.
 * Часы и таймеры подаёт хозяин (тесту — подставные).
 */
export function deviceKeyPresser({ fire, now, later, clear }) {
  let detector = pressDetector();
  let timer = null;

  const stop = () => {
    if (timer !== null) clear(timer);
    timer = null;
  };
  const schedule = () => {
    stop();
    const at = detector.nextDue();
    if (at === null) return;
    timer = later(pump, Math.max(0, at - now()));
  };
  function pump() {
    timer = null;
    const time = now();
    for (let press = detector.due(time); press !== null; press = detector.due(time)) fire(press);
    schedule();
  }
  return {
    down() {
      detector.down(now());
      pump();
    },
    up() {
      detector.up(now());
      pump();
    },
    abort() {
      stop();
      detector = pressDetector();
    },
    /** Ждать больше нечего — распознаватель свободен. */
    idle: () => timer === null && detector.nextDue() === null,
  };
}

// ——— карточка: модель ————————————————————————————————————————————————

function deviceCardUnit(meta) {
  return meta && meta.unit && strings.sim.units[meta.unit] ? strings.sim.units[meta.unit] : "";
}

/** Подпись константы перечисления; нет подписи — сама константа. */
export function deviceValueLabel(char, key) {
  const labels = strings.sim.values[char];
  return labels && typeof labels[key] === "string" ? labels[key] : String(key);
}

/** Значение характеристики словами: «да», «Включено», «22 °C». */
export function deviceValueText(meta, char, value) {
  if (value === null || value === undefined) return strings.sim.card.noValue;
  if (typeof value === "boolean") return value ? strings.sim.card.yes : strings.sim.card.no;
  // Перечисления и события (нажатие кнопки) читаются подписями констант.
  if (meta && Array.isArray(meta.values) && typeof value === "string") return deviceValueLabel(char, value);
  if (typeof value === "number") {
    const unit = deviceCardUnit(meta);
    const shown = Number.isInteger(value) ? String(value) : String(Math.round(value * 100) / 100).replace(".", ",");
    return unit ? shown + (unit === "%" || unit === "°" || unit === "°C" ? "" : " ") + unit : shown;
  }
  return String(value);
}

// Орган управления по формату и доступу характеристики.
function deviceCardControl(meta) {
  if (!meta || !Array.isArray(meta.perms) || !meta.perms.includes("write")) return { kind: "readout" };
  if (meta.format === "bool") return { kind: "toggle" };
  if (meta.format === "int" || meta.format === "float") {
    return { kind: "range", min: meta.min, max: meta.max, step: meta.step || 1 };
  }
  if (meta.format === "enum" && Array.isArray(meta.values)) {
    return { kind: "select", options: meta.values.map((item) => item.key) };
  }
  return { kind: "readout" };
}

/**
 * Модель карточки устройства: `{markId, label, running, keys, services,
 * logic}` — или `null`, если метка не устройство. `read(service, char)` отдаёт
 * значение (по умолчанию — зеркало имитации); `logic` — раздел «Логика»
 * (`scenarioScriptLogicOf`: привязки метки и подходящие сервису сценарии,
 * формы опций читаются у имитации; `readForms` подменяет их в тесте).
 *
 *   keys     — `[{index, channel, relay, decoupled, bell, detect, on, presses:
 *              [{press, enabled}]}]`; «двойное» и «долгое» у привязанной
 *              клавиши с «Выключателем» выключены (их у неё нет);
 *   services — видимые сервисы (без клавиш) с характеристиками: `{type, name,
 *              value, text, control: {kind: "toggle" | "range" | "select" |
 *              "readout", …}}`.
 */
export function deviceCardModel(project, markId, read = null, readForms = undefined) {
  const accessory = markAccessory(project, markId);
  if (!accessory) return null;
  const value = typeof read === "function" ? read : (service, char) => simValue(markId, service, char);
  const keys = deviceKeysOf(accessory).map((key) => {
    const own = accessory.services.find((service) => service.index === key.index);
    const bound = key.relay !== null && !key.decoupled;
    return {
      ...key,
      sid: own ? own.sid : null,
      on: key.relay === null ? null : value(key.relay, "On") === true,
      presses: DEVICE_CARD_PRESSES.map((press) => ({ press, enabled: !bound || press === "single" })),
    };
  });
  const services = [];
  // Несколько сервисов одного типа («Выключатель» на каждый канал) различаются
  // номером канала.
  const sameType = new Map();
  for (const service of accessory.services) sameType.set(service.type, (sameType.get(service.type) || 0) + 1);
  for (const service of accessory.services) {
    if (DEVICE_CARD_KEYS.has(service.type)) continue;
    const chars = [];
    for (const char of service.chars) {
      if (DEVICE_CARD_HIDDEN.has(char.type) || !char.meta) continue;
      const current = value(service.index, char.type);
      chars.push({
        type: char.type,
        name: text("sim.chars." + char.type),
        address: char.address,
        value: current === undefined ? null : current,
        text: deviceValueText(char.meta, char.type, current === undefined ? null : current),
        unitKey: char.meta.unit || null,
        control: deviceCardControl(char.meta),
      });
    }
    if (chars.length === 0) continue;
    services.push({
      index: service.index,
      type: service.type,
      name:
        service.name ||
        text("sim.services." + service.type) +
          (sameType.get(service.type) > 1 && Number.isInteger(service.channel) ? " " + service.channel : ""),
      address: service.address,
      aux: service.aux === true,
      chars,
    });
  }
  const logic = scenarioScriptLogicOf(project, markId, readForms);
  return { markId, label: accessory.label, aid: accessory.aid, running: simRunning(), keys, services, logic };
}

// ——— карточка: узлы ———————————————————————————————————————————————————

function deviceCardSet(markId, service, char, value) {
  return simAct({ kind: "set", markId, service, char, value });
}

function deviceCardKeyRow(markId, key) {
  const bound = key.relay !== null && !key.decoupled;
  const title = key.bell ? "" : bound ? strings.sim.card.keyBound : strings.sim.card.keyDecoupled;
  const name = key.bell || (key.channel === 1 && key.relay === null) ? strings.sim.card.keyButton : text("sim.card.key", { channel: key.channel });
  const buttons = key.presses.map(({ press, enabled }) =>
    uiButton(strings.sim.card.presses[press], {
      class: "ui-btn sim-card__press",
      title: enabled ? text("sim.card.pressHint", { press: strings.sim.card.presses[press] }) : title,
      attrs: enabled ? {} : { disabled: "disabled" },
      on: { click: () => simPress(markId, key.index, press) },
    }),
  );
  return uiEl("div", { class: "sim-card__key", title }, [
    uiEl("span", { class: "sim-card__keyname", text: name }),
    uiEl("span", {
      class: "sim-card__keystate",
      attrs: { "data-key-state": String(key.index) },
      text: key.on === null ? "" : key.on ? strings.sim.card.yes : strings.sim.card.no,
    }),
    uiEl("span", { class: "sim-card__presses" }, buttons),
  ]);
}

function deviceCardCharRow(markId, service, char, refs) {
  const control = char.control;
  const label = uiEl("span", { class: "sim-card__charname", text: char.name, title: text("sim.card.address", { address: char.address }) });
  let field = null;
  if (control.kind === "toggle") {
    field = uiEl("input", {
      type: "checkbox",
      class: "sim-card__check",
      attrs: { "aria-label": char.name },
      on: { change: (event) => deviceCardSet(markId, service.index, char.type, event.target.checked) },
    });
    field.checked = char.value === true;
  } else if (control.kind === "range") {
    const readout = uiEl("span", { class: "sim-card__value", text: char.text });
    field = uiEl("span", { class: "sim-card__range" }, [
      uiEl("input", {
        type: "range",
        class: "sim-card__slider",
        attrs: { min: String(control.min), max: String(control.max), step: String(control.step), "aria-label": char.name },
        on: {
          input: (event) => {
            readout.textContent = deviceValueText({ format: "float", unit: char.unitKey }, char.type, Number(event.target.value));
          },
          change: (event) => deviceCardSet(markId, service.index, char.type, Number(event.target.value)),
        },
      }),
      readout,
    ]);
    field.querySelector("input").value = String(char.value ?? control.min);
    refs.readouts.set(service.index + "." + char.type, readout);
  } else if (control.kind === "select") {
    field = uiEl(
      "select",
      {
        class: "ui-select sim-card__select",
        attrs: { "aria-label": char.name },
        on: { change: (event) => deviceCardSet(markId, service.index, char.type, event.target.value) },
      },
      control.options.map((option) => {
        const node = uiEl("option", { text: deviceValueLabel(char.type, option), attrs: { value: option } });
        return node;
      }),
    );
    field.value = String(char.value);
  } else {
    field = uiEl("span", { class: "sim-card__value", text: char.text });
    refs.readouts.set(service.index + "." + char.type, field);
  }
  refs.fields.set(service.index + "." + char.type, { field, control });
  return uiEl("div", { class: "sim-card__char" }, [label, field]);
}

/**
 * Узлы карточки устройства: `{node, dispose}`. Значения обновляются сами по
 * подписке на имитацию; поле, в котором сейчас стоит курсор или идёт ведение
 * ползунка, не трогается. `dispose` снимает подписку — звать, когда карточку
 * сменили.
 */
export function deviceCardView(project, markId) {
  const model = deviceCardModel(project, markId);
  const node = uiEl("div", { class: "sim-card" });
  if (!model) return { node, dispose: () => {} };
  const refs = {
    readouts: new Map(),
    fields: new Map(),
  };
  if (model.keys.length > 0) {
    node.append(uiEl("p", { class: "sim-card__head", text: strings.sim.card.keys }));
    for (const key of model.keys) node.append(deviceCardKeyRow(markId, key));
  }
  for (const service of model.services) {
    node.append(
      uiEl("p", { class: "sim-card__head" + (service.aux ? " is-aux" : ""), title: text("sim.card.address", { address: service.address }), text: service.name }),
    );
    for (const char of service.chars) node.append(deviceCardCharRow(markId, service, char, refs));
  }

  // Раздел «Логика» перерисовывает себя сам: привязки живут в объекте и
  // меняются, пока карточка открыта.
  const logic = scenarioScriptLogicView(markId);
  node.append(logic.node);

  const refresh = () => {
    const fresh = deviceCardModel(project, markId);
    if (!fresh) return;
    for (const service of fresh.services) {
      for (const char of service.chars) {
        const id = service.index + "." + char.type;
        const own = refs.fields.get(id);
        if (!own) continue;
        const readout = refs.readouts.get(id);
        const active = typeof document !== "undefined" ? document.activeElement : null;
        if (own.control.kind === "toggle") own.field.checked = char.value === true;
        else if (own.control.kind === "range") {
          const slider = own.field.querySelector("input");
          if (slider !== active) slider.value = String(char.value ?? own.control.min);
          if (readout && slider !== active) readout.textContent = char.text;
        } else if (own.control.kind === "select") {
          if (own.field !== active) own.field.value = String(char.value);
        } else if (readout) readout.textContent = char.text;
      }
    }
    for (const key of fresh.keys) {
      const cell = node.querySelector('[data-key-state="' + key.index + '"]');
      if (cell && key.on !== null) cell.textContent = key.on ? strings.sim.card.yes : strings.sim.card.no;
    }
  };
  let off = simWatch((payload) => {
    if (!node.isConnected && node.dataset.seen === "1") {
      if (off) off();
      off = null;
      logic.dispose();
      return;
    }
    if (node.isConnected) node.dataset.seen = "1";
    if (payload.changes.length > 0) refresh();
  });
  return {
    node,
    dispose: () => {
      if (off) off();
      off = null;
      logic.dispose();
    },
  };
}
