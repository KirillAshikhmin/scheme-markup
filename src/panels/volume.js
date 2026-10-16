// Окно объёмного режима: комната, по которой ходят.
//
// Требование G205, шаг первый (таск 146). Слова заказчика: «просто открывается
// окно, где можно перемещаться по комнатам… суть как в игре».
//
// Счёт — в `src/volume.js` (сцена, камера, затенение, порядок граней,
// столкновения). Здесь окно, клавиши, мышь и кадр: окно ничего не считает
// само, иначе арифметика разошлась бы с той, что проверена тестами.
//
// ——— что это окно не делает ————————————————————————————————————————————
//
// **Ничего не пишет** (G68). Объёмный режим читает чертёж и только: ни правок,
// ни шагов истории, ни новых полей. Открыть и закрыть его у любого объекта —
// ноль изменений.
//
// Меток в нём пока нет (таск 148), этажей, лестницы, сенсорного управления и
// снимка вида — тоже (таск 149). Разбито так нарочно: первый шаг можно
// посмотреть глазами, не дожидаясь остального.
//
// ——— окно открывается обзором ———————————————————————————————————————————
//
// Не от первого лица, хотя первое лицо — главный вид. Заказчик: обзор нужен
// потому, что «без него не понять, где стоишь», а «показать заказчику»
// начинается с общего вида. Поэтому первый кадр — вся схема сверху, а человек
// переходит к первому лицу, уже зная, куда попал.
import { layoutAllows } from "../app.js";
import { FULLSCREEN_EVENTS, canvasFullscreenLabel, canvasFullscreenOn, canvasFullscreenSupported, canvasFullscreenToggle } from "../canvas.js";
import { findRoom, findScheme } from "../model.js";
import { strings, text } from "../strings.js";
import {
  VOLUME_AROUND_NEAR_MM,
  VOLUME_AROUND_PITCH_DEG,
  VOLUME_EYE_MM,
  VOLUME_HEIGHT_FALLBACK_MM,
  VOLUME_LOOK_DEG_PX,
  VOLUME_PITCH_MAX_DEG,
  VOLUME_RUN_MM_S,
  VOLUME_START_PITCH_DEG,
  VOLUME_WALK_MM_S,
  volumeAroundCamera,
  volumeAroundDistance,
  volumeAroundFit,
  volumeBasis,
  volumeDraw,
  volumeDrawBackdrop,
  volumeFrame,
  volumeHorizon,
  volumeMarkerFaces,
  volumeRoomAt,
  volumeScene,
  volumeStart,
  volumeStep,
} from "../volume.js";
import { uiButton, uiDialogDepth, uiEl, uiIcon, uiIconButton, uiModal } from "./ui.js";

// Окно одно: второе показывало бы ту же сцену второй камерой и сжирало бы
// кадры у первого. То же правило, что у мастерской.
let volumeOpened = false;

/** Клавиша → куда шагаем: вперёд/назад и в сторону, в осях камеры. */
export function volumeKeyMove(code) {
  if (code === "KeyW" || code === "ArrowUp") return { forward: 1, side: 0, turn: 0 };
  if (code === "KeyS" || code === "ArrowDown") return { forward: -1, side: 0, turn: 0 };
  if (code === "KeyA") return { forward: 0, side: -1, turn: 0 };
  if (code === "KeyD") return { forward: 0, side: 1, turn: 0 };
  // Стрелки влево-вправо вертят, а не ходят: без мыши повернуться иначе нечем,
  // а боком ходят по A и D, как привыкли.
  if (code === "ArrowLeft" || code === "KeyQ") return { forward: 0, side: 0, turn: -1 };
  if (code === "ArrowRight" || code === "KeyE") return { forward: 0, side: 0, turn: 1 };
  return null;
}

/** Наклон взгляда не заводится за отвес: вверх ногами смотреть незачем. */
export function volumeClampPitch(radians) {
  const limit = (VOLUME_PITCH_MAX_DEG * Math.PI) / 180;
  return Math.max(-limit, Math.min(limit, radians));
}

/**
 * Подпись места: имя помещения, в котором стоит человек, или честное «вне
 * помещений». Отдельной функцией — её проверяет тест: строка, собранная в
 * обработчике кадра, не проверяется ничем.
 */
export function volumeWhere(project, scene, at) {
  const room = volumeRoomAt(scene, at);
  const found = room && room.roomId ? findRoom(project, room.roomId) : null;
  if (found) return text("volume.inRoom", { name: found.name });
  return strings.volume.outside;
}

/** Строки про то, чего в сцене не хватает. Порядок — порядок важности. */
export function volumeNotes(scene) {
  const lines = [];
  for (const note of scene.notes || []) {
    if (note === "noRooms") lines.push(strings.volume.noRooms);
    if (note === "noBridge") lines.push(strings.volume.noBridge);
    if (note === "noHeight") lines.push(text("volume.noHeight", { height: VOLUME_HEIGHT_FALLBACK_MM }));
  }
  return lines;
}

export function openVolume({ schemeId, api }) {
  if (volumeOpened) return null;
  const { getState, notify, subscribe } = api;
  const project = getState().project;
  if (!findScheme(project, schemeId)) return null;
  volumeOpened = true;

  let scene = volumeScene(project, schemeId);
  let view = "around";
  let closed = false;
  let frame = 0;
  let walking = 0;
  let clock = 0;
  const keys = new Map();
  let look = null; // перетаскивание мышью: {x, y}
  let locked = false;
  let denied = false;

  const start = scene.empty ? { x: 0, y: 0, yaw: 0 } : volumeStart(scene);
  // Человек: место на плане, рысканье и наклон. Высота глаз постоянная —
  // приседать и прыгать в этом режиме незачем.
  const person = { x: start.x, y: start.y, yaw: start.yaw, pitch: (VOLUME_START_PITCH_DEG * Math.PI) / 180 };
  // Обзор: цель, вокруг которой ходит камера, и расстояние до неё.
  let around = { target: { x: start.x, y: start.y, z: 1200 }, yaw: start.yaw, pitch: (VOLUME_AROUND_PITCH_DEG * Math.PI) / 180, distance: VOLUME_AROUND_NEAR_MM };

  const node = uiEl("canvas", { class: "volume__canvas" });
  const stage = uiEl("div", { class: "volume__stage", attrs: { tabindex: "-1" } }, [node]);
  const ctx = node.getContext ? node.getContext("2d") : null;

  const personButton = uiButton(strings.volume.viewPerson, {
    title: strings.volume.viewPersonHint,
    on: { click: () => setView("person") },
  });
  const aroundButton = uiButton(strings.volume.viewAround, {
    title: strings.volume.viewAroundHint,
    on: { click: () => setView("around") },
  });
  const fitButton = uiButton(strings.volume.fit, { title: strings.volume.fitHint, on: { click: () => fit() } });
  const fullButton = uiIconButton("fullscreen", {
    label: canvasFullscreenLabel(false),
    on: { click: () => toggleFullscreen() },
  });
  const where = uiEl("span", { class: "volume__where" });
  const meta = uiEl("p", { class: "volume__meta" });
  const hint = uiEl("p", { class: "modal__hint" });

  const bar = uiEl("div", { class: "volume__tools" }, [
    uiEl("span", { class: "volume__toolsLabel", text: strings.volume.view }),
    personButton,
    aroundButton,
    where,
    uiEl("span", { class: "volume__spacer" }, [fitButton, fullButton]),
  ]);
  const body = uiEl("div", { class: "volume" }, [bar, stage, meta, hint]);

  const scheme = findScheme(project, schemeId);
  const closeButton = uiButton(strings.volume.close, {
    class: "ui-btn ui-btn--accent",
    on: { click: () => finish() },
  });
  const modal = uiModal({
    title: text("volume.title", { name: scheme.name }),
    body,
    actions: [closeButton],
    onCancel: () => cleanup(),
  });
  modal.card.classList.add("modal--volume");
  const depth = uiDialogDepth();

  // ——— вид ———

  function ours() {
    return !closed && uiDialogDepth() === depth;
  }

  function setView(next) {
    if (view === next) return;
    // Переход к обзору ставит цель туда, где стоит человек: обзор нужен, чтобы
    // понять, где стоишь, а не чтобы потерять себя из виду.
    if (next === "around") {
      around = { ...around, target: { x: person.x, y: person.y, z: 1200 }, yaw: person.yaw, distance: VOLUME_AROUND_NEAR_MM };
    }
    view = next;
    sync();
  }

  function fit() {
    if (scene.empty) return;
    const fitted = volumeAroundFit(scene, viewport());
    around = { ...around, target: fitted.target, distance: fitted.distance };
    if (view !== "around") {
      view = "around";
      sync();
      return;
    }
    paint();
  }

  function camera() {
    if (view === "person") {
      return { at: { x: person.x, y: person.y, z: VOLUME_EYE_MM }, yaw: person.yaw, pitch: person.pitch };
    }
    return volumeAroundCamera(around.target, around.yaw, around.pitch, around.distance);
  }

  function viewport() {
    return { width: Math.max(1, stage.clientWidth), height: Math.max(1, stage.clientHeight) };
  }

  // ——— кадр ———

  function resize() {
    if (!(stage.clientWidth > 0) || !(stage.clientHeight > 0)) return;
    const ratio = (typeof window !== "undefined" && window.devicePixelRatio) || 1;
    const box = viewport();
    node.style.width = box.width + "px";
    node.style.height = box.height + "px";
    node.width = Math.round(box.width * ratio);
    node.height = Math.round(box.height * ratio);
    paint();
  }

  function paint() {
    if (!ctx || closed) return;
    const ratio = (typeof window !== "undefined" && window.devicePixelRatio) || 1;
    const box = viewport();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, node.width, node.height);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    const spot = camera();
    volumeDrawBackdrop(ctx, box, volumeHorizon(spot, box));
    if (scene.empty) return;
    // Кружок «вы здесь» рисуется только в обзоре: от первого лица человек и
    // так знает, где стоит, а под ногами кружок закрыл бы пол.
    const marker = view === "around" ? volumeMarkerFaces({ x: person.x, y: person.y }, person.yaw) : null;
    volumeDraw(ctx, volumeFrame(scene, spot, box, marker));
  }

  function redraw() {
    if (frame || closed) return;
    const schedule = typeof requestAnimationFrame === "function" ? requestAnimationFrame : (fn) => setTimeout(fn, 16);
    frame = schedule(() => {
      frame = 0;
      paint();
    });
  }

  // ——— ход ———
  //
  // Часы идут, только пока держат клавишу: окно, которое молотит кадры на
  // пустом месте, греет машину и съедает заряд планшета. Отпустили — последний
  // кадр нарисован, и до следующего события ничего не считается.

  function now() {
    return typeof performance !== "undefined" && performance.now ? performance.now() : Date.now();
  }

  function walkSchedule() {
    if (walking || keys.size === 0 || closed) return;
    const schedule = typeof requestAnimationFrame === "function" ? requestAnimationFrame : (fn) => setTimeout(fn, 16);
    clock = now();
    walking = schedule(walkTick);
  }

  function walkTick() {
    walking = 0;
    if (keys.size === 0 || closed) return;
    const time = now();
    const step = Math.min(0.1, Math.max(0, (time - clock) / 1000));
    clock = time;
    let forward = 0;
    let side = 0;
    let turn = 0;
    let run = false;
    for (const code of keys.keys()) {
      if (code === "ShiftLeft" || code === "ShiftRight") {
        run = true;
        continue;
      }
      const move = volumeKeyMove(code);
      if (!move) continue;
      forward += move.forward;
      side += move.side;
      turn += move.turn;
    }
    const speed = (run ? VOLUME_RUN_MM_S : VOLUME_WALK_MM_S) * step;
    if (turn !== 0) {
      const spin = turn * step * 2.2;
      if (view === "person") person.yaw += spin;
      else around = { ...around, yaw: around.yaw + spin };
    }
    if (forward !== 0 || side !== 0) {
      const length = Math.hypot(forward, side);
      const basis = volumeBasis(view === "person" ? person : around);
      // Ход по плану, а не по направлению взгляда: с опущенным взглядом иначе
      // уходишь в пол, и это чувствуется как провал, а не как шаг.
      const flat = Math.hypot(basis.fwd.x, basis.fwd.y) || 1;
      const dx = ((basis.fwd.x / flat) * forward + basis.right.x * side) / length * speed;
      const dy = ((basis.fwd.y / flat) * forward + basis.right.y * side) / length * speed;
      if (view === "person") {
        const moved = volumeStep(scene, person, dx, dy);
        person.x = moved.x;
        person.y = moved.y;
        syncWhere();
      } else {
        around = { ...around, target: { ...around.target, x: around.target.x + dx, y: around.target.y + dy } };
      }
    }
    paint();
    walkSchedule();
  }

  function keyStop(code) {
    if (code) keys.delete(code);
    else keys.clear();
    if (keys.size > 0 || !walking) return;
    const cancel = typeof cancelAnimationFrame === "function" ? cancelAnimationFrame : clearTimeout;
    cancel(walking);
    walking = 0;
  }

  // ——— мышь ———
  //
  // Голову вертят двумя способами, и оба нужны. Захват указателя — то самое
  // «как в игре»: мышь водит взглядом без нажатой кнопки. Но захват даёт не
  // каждый браузер и не во всякой вкладке, поэтому перетаскивание работает
  // всегда и само по себе.

  function lookBy(dx, dy) {
    const perPixel = (VOLUME_LOOK_DEG_PX * Math.PI) / 180;
    if (view === "person") {
      person.yaw += dx * perPixel;
      person.pitch = volumeClampPitch(person.pitch - dy * perPixel);
    } else {
      around = { ...around, yaw: around.yaw + dx * perPixel, pitch: volumeClampPitch(around.pitch - dy * perPixel) };
    }
    paint();
  }

  function onPointerDown(event) {
    if (event.button !== 0) return;
    stage.focus({ preventScroll: true });
    look = { x: event.clientX, y: event.clientY, moved: false };
  }

  function onPointerMove(event) {
    if (locked) {
      lookBy(event.movementX || 0, event.movementY || 0);
      return;
    }
    if (!look) return;
    const dx = event.clientX - look.x;
    const dy = event.clientY - look.y;
    look = { x: event.clientX, y: event.clientY, moved: look.moved || Math.hypot(dx, dy) > 2 };
    lookBy(dx, dy);
  }

  function onPointerUp() {
    // Щёлкнули, не поведя мышью — просим захват: это и есть «как в игре».
    // Отказ браузера не беда, перетаскивание никуда не делось.
    if (look && !look.moved && !locked && typeof stage.requestPointerLock === "function") {
      try {
        stage.requestPointerLock();
      } catch (error) {
        // захват не дали — молчим: способ водить взглядом остаётся
      }
    }
    look = null;
  }

  function onLockChange() {
    locked = document.pointerLockElement === stage;
    syncHint();
  }

  function onWheel(event) {
    if (view !== "around") return;
    event.preventDefault();
    around = { ...around, distance: volumeAroundDistance(around.distance * Math.exp(event.deltaY / 400)) };
    paint();
  }

  // ——— клавиатура ———

  function onKeyDown(event) {
    if (!ours()) return;
    // Esc при захвате отпускает мышь и окна не закрывает: человек жмёт его,
    // чтобы вернуть курсор, а не чтобы уйти. Перехват в фазе погружения —
    // слушатель диалогов стоит на всплытии.
    if (event.key === "Escape" && locked) {
      event.stopPropagation();
      if (typeof document.exitPointerLock === "function") document.exitPointerLock();
      return;
    }
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.code === "KeyV") {
      event.preventDefault();
      setView(view === "person" ? "around" : "person");
      return;
    }
    if (event.code === "KeyF") {
      event.preventDefault();
      fit();
      return;
    }
    const known = volumeKeyMove(event.code) || event.code === "ShiftLeft" || event.code === "ShiftRight";
    if (!known) return;
    event.preventDefault();
    if (!keys.has(event.code)) keys.set(event.code, now());
    walkSchedule();
  }

  function onKeyUp(event) {
    keyStop(event.code);
  }

  function onBlur() {
    keyStop(null);
  }

  function onResize() {
    if (closed) return;
    resize();
  }

  // ——— полный экран ———
  //
  // Разворачивается **само окно**, а не страница: заказчик просил «окно с
  // разворотом на полный экран», и панели за затемнением в нём не нужны.

  function toggleFullscreen() {
    Promise.resolve()
      .then(() => canvasFullscreenToggle(document, modal.card))
      .then(() => syncFullscreen())
      // Браузер отказал — кнопка уходит до перезагрузки, как на холсте:
      // спрашивать его ещё раз тем же жестом нечем.
      .catch(() => {
        denied = true;
        notify(strings.canvas.fullscreenDenied, "error");
        syncFullscreen();
      });
  }

  function onFullscreenChange() {
    if (closed) return;
    syncFullscreen();
    resize();
  }

  function syncFullscreen() {
    const on = canvasFullscreenOn(document);
    fullButton.hidden = denied || !canvasFullscreenSupported(document, modal.card);
    const label = canvasFullscreenLabel(on);
    fullButton.replaceChildren(uiIcon(on ? "fullscreenExit" : "fullscreen"));
    fullButton.title = label;
    fullButton.setAttribute("aria-label", label);
    fullButton.setAttribute("aria-pressed", on ? "true" : "false");
  }

  // ——— подписи ———

  function syncWhere() {
    where.textContent = scene.empty || view !== "person" ? "" : volumeWhere(getState().project, scene, person);
  }

  function syncHint() {
    if (scene.empty) {
      hint.textContent = strings.volume.emptyHint;
      return;
    }
    const base = view === "person" ? strings.volume.hintPerson : strings.volume.hintAround;
    hint.textContent = locked ? base + " " + strings.volume.hintLocked : base + " " + strings.volume.hintGrab;
  }

  function sync() {
    personButton.className = "ui-btn" + (view === "person" ? " is-on" : "");
    aroundButton.className = "ui-btn" + (view === "around" ? " is-on" : "");
    stage.classList.toggle("volume__stage--person", view === "person");
    if (scene.empty) {
      meta.textContent = strings.volume.empty;
    } else {
      const lines = [
        text("volume.counts", {
          walls: scene.solids.length,
          faces: scene.faces.length,
          rooms: scene.rooms.length,
        }),
        ...volumeNotes(scene),
      ];
      meta.textContent = lines.join(" ");
    }
    syncWhere();
    syncHint();
    paint();
  }

  // ——— жизнь окна ———

  function cleanup() {
    if (closed) return;
    closed = true;
    volumeOpened = false;
    keyStop(null);
    if (frame) {
      const cancel = typeof cancelAnimationFrame === "function" ? cancelAnimationFrame : clearTimeout;
      cancel(frame);
      frame = 0;
    }
    if (locked && typeof document.exitPointerLock === "function") document.exitPointerLock();
    if (canvasFullscreenOn(document)) canvasFullscreenToggle(document, modal.card).catch(() => {});
    if (unsubscribe) unsubscribe();
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
    window.removeEventListener("pointercancel", onPointerUp);
    window.removeEventListener("resize", onResize);
    window.removeEventListener("blur", onBlur);
    document.removeEventListener("keydown", onKeyDown, true);
    document.removeEventListener("keyup", onKeyUp, true);
    document.removeEventListener("pointerlockchange", onLockChange);
    for (const name of FULLSCREEN_EVENTS) document.removeEventListener(name, onFullscreenChange);
  }

  function finish() {
    cleanup();
    modal.close();
  }

  // Чертёж могли поправить в другой вкладке того же объекта или отменой на
  // холсте — сцена пересобирается на каждое изменение объекта. Считать её
  // заново дешевле, чем следить за тем, что именно изменилось.
  const unsubscribe = subscribe
    ? subscribe((state, changed) => {
        if (closed) return;
        // Схему удалили под окном — закрываемся: смотреть нечего.
        if (!findScheme(state.project, schemeId)) {
          finish();
          return;
        }
        if (!("project" in changed)) return;
        scene = volumeScene(state.project, schemeId) || scene;
        sync();
      })
    : null;

  stage.addEventListener("pointerdown", onPointerDown);
  stage.addEventListener("wheel", onWheel, { passive: false });
  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp);
  window.addEventListener("pointercancel", onPointerUp);
  window.addEventListener("resize", onResize);
  window.addEventListener("blur", onBlur);
  document.addEventListener("keydown", onKeyDown, true);
  document.addEventListener("keyup", onKeyUp, true);
  document.addEventListener("pointerlockchange", onLockChange);
  for (const name of FULLSCREEN_EVENTS) document.addEventListener(name, onFullscreenChange);

  syncFullscreen();
  sync();
  resize();
  if (!scene.empty) fit();
  if (typeof stage.focus === "function") stage.focus({ preventScroll: true });
  return { close: finish };
}

/** Доступен ли объёмный режим в этой раскладке. */
export function volumeAllowed(state) {
  return layoutAllows("viewVolume", state && state.layout);
}
