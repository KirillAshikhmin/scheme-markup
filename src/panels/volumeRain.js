// Дождь и снег в «Объёме» (правка после сборки сценариев): «Может быть туман,
// снег и дождь».
//
// Осадки — **своё поле поверх кадра**, а не грани сцены. Кадр «Объёма»
// рисуется по событию и молчит, пока ничего не движется (D80), а капля
// движется всегда: соберись она гранями, сцену пришлось бы перерисовывать
// шестьдесят раз в секунду ради того, что от чертежа не зависит. Здесь у капель
// свой холст и свой счёт кадров — несколько сотен штрихов, без сцены.
//
// Видны осадки там, где они идут, — снаружи: в обзоре и от первого лица на
// улице. В комнате их нет — там над головой потолок; через окно погоду видно
// небом, тучами и туманом, а капли за стеклом поле не рисует (у поверх-кадра
// нет знания, где окно). Это названная граница, а не недосмотр.
import { uiEl } from "./ui.js";
import { volumeRainMask } from "../volume.js";

/** Сколько капель и хлопьев на миллион точек поля при полной силе осадков. */
const VOLUME_RAIN_PER_MPX = { rain: 520, snow: 360 };
/** Не больше этого — на большом экране счёт не растёт без меры. */
const VOLUME_RAIN_MAX = 700;

/**
 * Частицы на поле `width × height`: `[{x, y, speed, size, phase}]` — место,
 * скорость падения (точек в секунду), размер и сдвиг качания у снега. Жребий
 * — свой простой, чтобы поле от запуска к запуску было тем же.
 */
export function volumeRainSeed(kind, strength, width, height) {
  const share = Math.max(0, Math.min(1, Number(strength) || 0));
  const per = VOLUME_RAIN_PER_MPX[kind] || 0;
  const count = Math.min(VOLUME_RAIN_MAX, Math.round((per * share * width * height) / 1e6));
  const out = [];
  let seed = 7;
  const next = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  for (let index = 0; index < count; index += 1) {
    out.push({
      x: next() * width,
      y: next() * height,
      speed: kind === "snow" ? 40 + next() * 50 : 650 + next() * 450,
      size: kind === "snow" ? 1 + next() * 1.8 : 10 + next() * 12,
      phase: next() * Math.PI * 2,
    });
  }
  return out;
}

/**
 * Шаг частиц на `dt` секунд: падают, снег качается, ушедшая за низ — сверху
 * снова. Дождь косой — ветер сносит его вбок на четверть хода.
 */
export function volumeRainStep(drops, kind, dt, width, height, at = 0) {
  const wind = kind === "snow" ? 0 : 0.25;
  for (const drop of drops) {
    drop.y += drop.speed * dt;
    drop.x += kind === "snow" ? Math.sin(at * 1.3 + drop.phase) * 18 * dt : drop.speed * wind * dt;
    if (drop.y > height + 20) {
      drop.y -= height + 40;
      drop.x = (drop.x + width * 0.37) % width;
    }
    if (drop.x > width + 20) drop.x -= width + 40;
    if (drop.x < -20) drop.x += width + 40;
  }
  return drops;
}

/**
 * Частицы на кадр: снег — кружками, дождь — штрихами. **Одна заливка или одна
 * обводка на все** (правка «оптимизировать весь Объём»): снежинка своей
 * заливкой — это семьсот заливок на кадр, и телефону они дороги.
 */
export function volumeRainDraw(ctx, kind, drops, night = 0) {
  // Ночью осадки темнее: белая крупа на чёрном небе светилась бы.
  const light = Math.round(225 - 120 * night);
  if (kind === "snow") {
    ctx.fillStyle = "rgba(" + light + "," + light + "," + (light + 10) + ",0.85)";
    ctx.beginPath();
    for (const drop of drops) {
      ctx.moveTo(drop.x + drop.size, drop.y);
      ctx.arc(drop.x, drop.y, drop.size, 0, Math.PI * 2);
    }
    ctx.fill();
    return;
  }
  ctx.strokeStyle = "rgba(" + (light - 20) + "," + (light - 10) + "," + light + ",0.45)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (const drop of drops) {
    ctx.moveTo(drop.x, drop.y);
    ctx.lineTo(drop.x - drop.size * 0.25, drop.y - drop.size);
  }
  ctx.stroke();
}

/**
 * Поле осадков: `{node, set(kind, strength, night), show(on), resize(w, h, ratio), dispose()}`.
 * `kind` — `"rain" | "snow" | null`. Пока поле не видно или осадков нет, кадры
 * не заказываются вовсе.
 */
export function volumeRainCreate() {
  const node = uiEl("canvas", { class: "volume__rain", attrs: { "aria-hidden": "true" } });
  const ctx = node.getContext ? node.getContext("2d") : null;
  let kind = null;
  let strength = 0;
  let night = 0;
  let shown = false;
  let width = 0;
  let height = 0;
  let ratio = 1;
  let drops = [];
  let frame = 0;
  let last = 0;
  // Маска дома (`volumeRainMask`): где кадр показывает комнату, капель нет —
  // за окном они идут. `null` — маски нет, осадки по всему полю.
  let maskNode = null;
  let masked = false;
  const live = () => shown && kind && strength > 0 && width > 0 && height > 0;
  const clear = () => {
    if (ctx) ctx.clearRect(0, 0, node.width, node.height);
  };
  const reseed = () => {
    drops = kind ? volumeRainSeed(kind, strength, width, height) : [];
  };
  const paint = (time) => {
    frame = 0;
    if (!live() || !ctx) {
      clear();
      return;
    }
    const dt = last ? Math.min(0.05, (time - last) / 1000) : 0;
    last = time;
    volumeRainStep(drops, kind, dt, width, height, time / 1000);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, width, height);
    volumeRainDraw(ctx, kind, drops, night);
    if (masked && maskNode) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalCompositeOperation = "destination-out";
      ctx.drawImage(maskNode, 0, 0);
      ctx.globalCompositeOperation = "source-over";
    }
    schedule();
  };
  const schedule = () => {
    if (frame || !live() || typeof requestAnimationFrame !== "function") return;
    frame = requestAnimationFrame(paint);
  };
  const sync = () => {
    node.hidden = !live();
    if (!live()) {
      if (frame && typeof cancelAnimationFrame === "function") cancelAnimationFrame(frame);
      frame = 0;
      last = 0;
      clear();
      return;
    }
    schedule();
  };
  return {
    node,
    set(nextKind, nextStrength, nextNight = 0) {
      const changed = nextKind !== kind || Math.abs((Number(nextStrength) || 0) - strength) > 0.05;
      kind = nextKind || null;
      strength = Math.max(0, Math.min(1, Number(nextStrength) || 0));
      night = Math.max(0, Math.min(1, Number(nextNight) || 0));
      if (changed) reseed();
      sync();
    },
    show(on) {
      if (shown === Boolean(on)) return;
      shown = Boolean(on);
      sync();
    },
    resize(nextWidth, nextHeight, nextRatio = 1) {
      if (nextWidth === width && nextHeight === height && nextRatio === ratio) return;
      width = nextWidth;
      height = nextHeight;
      ratio = nextRatio;
      node.style.width = width + "px";
      node.style.height = height + "px";
      node.width = Math.round(width * ratio);
      node.height = Math.round(height * ratio);
      reseed();
      sync();
    },
    /**
     * Маска дома по многоугольникам кадра (`polygons`) — или `null`: осадки
     * по всему полю (обзор, улица от первого лица).
     */
    mask(polygons) {
      if (!polygons) {
        masked = false;
        return;
      }
      if (!maskNode) maskNode = uiEl("canvas", {});
      if (maskNode.width !== node.width || maskNode.height !== node.height) {
        maskNode.width = node.width;
        maskNode.height = node.height;
      }
      const own = maskNode.getContext ? maskNode.getContext("2d") : null;
      if (!own) return;
      own.setTransform(1, 0, 0, 1, 0, 0);
      own.clearRect(0, 0, maskNode.width, maskNode.height);
      own.setTransform(ratio, 0, 0, ratio, 0, 0);
      volumeRainMask(own, polygons);
      masked = true;
    },
    dispose() {
      shown = false;
      sync();
    },
  };
}
