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
import { simLiveKindOf } from "../render.js";
import { simAct, simPress, simRunning, simValue, simWatch } from "../simulation.js";
import { homeAccessories, markAccessory } from "../sim/home.js";
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
  let held = false;
  // Кто ждёт конца жеста (`whenIdle`, F2): нажатие распознано, клавиша отпущена.
  const waiters = [];

  const idle = () => timer === null && detector.nextDue() === null;
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
  const flush = () => {
    if (held || !idle()) return;
    for (const fn of waiters.splice(0)) fn();
  };
  function pump() {
    timer = null;
    const time = now();
    for (let press = detector.due(time); press !== null; press = detector.due(time)) fire(press);
    schedule();
    flush();
  }
  return {
    down() {
      held = true;
      detector.down(now());
      pump();
    },
    up() {
      held = false;
      detector.up(now());
      pump();
    },
    abort() {
      stop();
      held = false;
      waiters.length = 0;
      detector = pressDetector();
    },
    /** Ждать больше нечего — распознаватель свободен. */
    idle,
    /**
     * Позвать `fn`, когда жест кончился: нажатие распознано и клавиша
     * отпущена (сразу, если уже так). Брошенный жест (`abort`) не зовёт.
     */
    whenIdle(fn) {
      if (typeof fn !== "function") return;
      waiters.push(fn);
      flush();
    },
  };
}

// ——— щелчок по метке как жест (слепая приёмка, F2) ———————————————————————
//
// Двойной щелчок по отвязанной клавише засчитывался одиночным: первый щелчок
// выделял метку, карточка всплывала поверх неё, и второй щелчок попадал в
// карточку. Поэтому выделение — а с ним карточка — приходит, когда жест
// кончился: нажатие распознано и клавиша отпущена. Пока жест идёт, под рукой
// ничего не меняется, где бы на плане ни стояла метка и где бы ни встала
// карточка.

/**
 * Начало жеста по метке-устройству в запущенном доме: план щелчка и, у
 * клавиши с нажатиями, начатое нажатие. Ответ — `{markId, plan, presser}`
 * для `deviceGestureEnd`. `io` — `{presserOf(markId, index), select(markId),
 * press, act}`; метку здесь ещё не выделяют.
 */
export function deviceGestureStart(project, markId, io) {
  const plan = deviceClickPlan(markAccessory(project, markId));
  const gesture = { markId, plan, presser: null };
  if (plan.kind === "key" && plan.key.detect) {
    gesture.presser = io.presserOf(markId, plan.key.index);
    gesture.presser.down();
  }
  return gesture;
}

/**
 * Конец жеста. `moved` — это была панорама (или жест отменён): нажатие
 * брошено, ничего не выполняется и не выделяется. Иначе клавиша с нажатиями
 * отпускается, и метка выделяется, когда нажатие распознано; мгновенное
 * действие (переключить, датчик, привязанная клавиша) выполняется сразу, и
 * метка выделяется следом.
 */
export function deviceGestureEnd(gesture, moved, io) {
  if (!gesture) return;
  if (gesture.presser) {
    if (moved) {
      gesture.presser.abort();
      return;
    }
    gesture.presser.up();
    gesture.presser.whenIdle(() => io.select(gesture.markId));
    return;
  }
  if (moved) return;
  deviceClickAct(gesture.markId, gesture.plan, io);
  io.select(gesture.markId);
}

// ——— общее «Схеме», мини-плану и «Объёму» (ревью ветки, F1) ——————————————

/**
 * Реестр распознавателей нажатий: один `deviceKeyPresser` на клавишу
 * `"markId|index"`. `io` — `{fire(markId, index, press), now, later, clear}`.
 * Ответ — `{of(markId, index) -> presser}`.
 */
export function devicePressers(io) {
  const pressers = new Map();
  return {
    of(markId, index) {
      const key = markId + "|" + index;
      if (!pressers.has(key)) {
        pressers.set(
          key,
          deviceKeyPresser({ fire: (press) => io.fire(markId, index, press), now: io.now, later: io.later, clear: io.clear }),
        );
      }
      return pressers.get(key);
    },
  };
}

function devicePressNow() {
  const clock = typeof performance === "object" && performance !== null ? performance : null;
  return clock && typeof clock.now === "function" ? clock.now() : Date.now();
}

const DEVICE_PRESSERS = devicePressers({
  fire: (markId, index, press) => simPress(markId, index, press),
  now: devicePressNow,
  later: (fn, ms) => setTimeout(fn, ms),
  clear: (id) => clearTimeout(id),
});

/**
 * Распознаватель нажатий клавиши сеанса — один на клавишу для «Схемы»,
 * мини-плана и «Объёма»: нажатие, начатое мышью на плане, доводит палец или E
 * в другом виде той же клавиши.
 */
export function devicePresserOf(markId, index) {
  return DEVICE_PRESSERS.of(markId, index);
}

const DEVICE_LIVE_KINDS = new WeakMap();

/**
 * Вид знака состояния и помещение каждой метки-устройства объекта:
 * `Map<markId, {kind, roomId}>` (`simLiveKindOf`). Кэш по ссылке на объект —
 * один ответ «Схеме», мини-плану и «Объёму».
 */
export function deviceLiveKinds(project) {
  if (!project || typeof project !== "object") return new Map();
  let kinds = DEVICE_LIVE_KINDS.get(project);
  if (!kinds) {
    kinds = new Map(homeAccessories(project).map((accessory) => [accessory.markId, { kind: simLiveKindOf(accessory), roomId: accessory.roomId || null }]));
    DEVICE_LIVE_KINDS.set(project, kinds);
  }
  return kinds;
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
/**
 * Подпись сервиса по виду устройства (правка после сборки сценариев): у
 * бризера «Выключатель» — это подогрев, у ели две лампы — гирлянда и звезда, у
 * тёплого пола термостат — сам пол. Имени в профиле у них нет: оно выводится,
 * а не пишется (ADR 013). `null` — у вида своих подписей нет.
 */
export function deviceServiceRole(kind, service) {
  const roles = strings.sim.roles || {};
  if (kind === "breezer" && service.type === "Switch") return roles.breezerHeat || null;
  if (kind === "xmasTree" && service.type === "Lightbulb") return (service.index === 0 ? roles.treeGarland : roles.treeStar) || null;
  if (kind === "warmFloor" && service.type === "Thermostat") return roles.warmFloor || null;
  return null;
}

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
        deviceServiceRole(accessory.kind, service) ||
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

/**
 * Что карточка метки показывает об устройстве (F2): `"remote"` — пульт
 * (`deviceCardView`, дом запущен) с разделом «Логика»; `"logic"` — дом
 * остановлен, и пульта нет, а к привязкам логики дорога есть
 * (`deviceLogicEntry`); `null` — метка не аксессуар. Привязка — настройка
 * сценария, а не правка метки: из карточки до неё доходят при любом доме.
 */
export function deviceCardPart(project, markId, running) {
  if (!project || !markAccessory(project, markId)) return null;
  return running === true ? "remote" : "logic";
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

// ——— «Логика» у остановленного дома (слепая приёмка, F2) ——————————————————

/**
 * Сколько у метки привязок логики — словами для строки карточки: `{count,
 * text}`; метка не аксессуар — `null`.
 */
export function deviceLogicSummary(project, markId) {
  const logic = project ? scenarioScriptLogicOf(project, markId, () => null) : null;
  if (!logic) return null;
  const count = logic.bindings.length;
  return { count, text: count === 0 ? strings.sim.card.logic.none : text("sim.card.logic.count", { count }) };
}

/**
 * Раздел «Логика» устройства — тот же, что в пульте запущенного дома
 * (`scenarioScriptLogicView`): привязки, опции, «Активна», «Снять» и
 * «+ сценарий». Сам перерисовывается на правку объекта. `{node, dispose}`.
 */
export function deviceLogicSection(markId) {
  return scenarioScriptLogicView(markId);
}

/**
 * «Логика» в карточке метки при остановленном доме (F2): строка — сколько
 * привязок, и кнопка, которая раскрывает раздел `deviceLogicSection` прямо в
 * карточке. Кнопка — `ui-btn`: на компьютере она ловит щелчок сквозь
 * сквозную карточку. `open` — раздел раскрыт; `section` — уже собранный
 * раздел (хозяин карточки держит его между перерисовками, чтобы раскрытые
 * опции не схлопывались от каждой правки); `onToggle()` — нажали кнопку.
 * Ответ — `{node, dispose}` или `null` (не аксессуар); `dispose` снимает только
 * раздел, собранный здесь же.
 */
export function deviceLogicEntry(project, markId, { open = false, section = null, onToggle = null } = {}) {
  const summary = deviceLogicSummary(project, markId);
  if (!summary) return null;
  const toggle = uiButton(strings.sim.card.logic.title, {
    class: "ui-btn mark-card__edit",
    title: open ? strings.sim.card.logic.closeHint : strings.sim.card.logic.openHint,
    attrs: { "aria-expanded": open ? "true" : "false" },
    on: { click: () => (typeof onToggle === "function" ? onToggle() : undefined) },
  });
  // Раскрытый раздел сам говорит, что привязано, — строка остаётся кнопкой.
  const row = uiEl("div", { class: "mark-card__row mark-card__row--act" }, open ? [toggle] : [toggle, uiEl("span", { class: "mark-card__value", text: summary.text })]);
  if (!open) return { node: row, dispose: () => {} };
  const own = section ? null : deviceLogicSection(markId);
  const body = section || own;
  return {
    node: uiEl("div", { class: "sim-card" }, [row, body.node]),
    dispose: () => {
      if (own) own.dispose();
    },
  };
}
