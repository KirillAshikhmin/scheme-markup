// «Объём»: камера — базис взгляда, фокус, горизонт, отсечение ближней плоскостью.
//
// Часть «Объёма», вынесенная из `src/volume.js` (2026-10-25) переносом без
// переименований: снаружи модуль читают через дверь `volume.js`, а соседи по
// `src/volume/` — напрямую. Зависимости идут только вниз по слоям (порядок —
// в шапке `volume.js`), циклов нет. Решения и доводы — в шапках разделов ниже.
import { VOLUME_FOV_DEG, VOLUME_NEAR_MM } from "./measures.js";

// ——— камера ——————————————————————————————————————————————————————————————

/**
 * Оси камеры по рысканью и наклону. Плановые оси — те же, что у чертежа: `x`
 * вправо, `y` вниз; `z` растёт вверх от пола. Рысканье считается от оси `x` по
 * часовой на плане, наклон — вверх положительный.
 */
export function volumeBasis(camera) {
  const yaw = camera.yaw || 0;
  const pitch = camera.pitch || 0;
  const cosYaw = Math.cos(yaw);
  const sinYaw = Math.sin(yaw);
  const cosPitch = Math.cos(pitch);
  const sinPitch = Math.sin(pitch);
  return {
    fwd: { x: cosYaw * cosPitch, y: sinYaw * cosPitch, z: sinPitch },
    right: { x: -sinYaw, y: cosYaw, z: 0 },
    up: { x: -sinPitch * cosYaw, y: -sinPitch * sinYaw, z: cosPitch },
  };
}

/** Фокус в экранных точках: поле зрения меряется по длинной стороне окна. */
export function volumeFocal(box) {
  const side = Math.max(box.width, box.height);
  return (side / 2) / Math.tan(((VOLUME_FOV_DEG / 2) * Math.PI) / 180);
}

/**
 * Экранная строка горизонта: куда уходит всё, что лежит на уровне глаз.
 * Зависит только от наклона — и поэтому задник, привязанный к ней, рысканья не
 * знает и в перспективе не участвует.
 */
export function volumeHorizon(camera, box) {
  return box.height / 2 + volumeFocal(box) * Math.tan(camera.pitch || 0);
}

export function volumeToCamera(point, eye, basis) {
  const dx = point.x - eye.x;
  const dy = point.y - eye.y;
  const dz = point.z - eye.z;
  return {
    x: dx * basis.right.x + dy * basis.right.y + dz * basis.right.z,
    y: dx * basis.up.x + dy * basis.up.y + dz * basis.up.z,
    z: dx * basis.fwd.x + dy * basis.fwd.y + dz * basis.fwd.z,
  };
}

/**
 * Отсечение многоугольника ближней плоскостью. Без него грань, пересекающая
 * плоскость камеры, выворачивается наизнанку через бесконечность — и это не
 * мелкая погрешность, а клякса на весь кадр.
 */
export function volumeClipNear(points, near = VOLUME_NEAR_MM) {
  return volumeClipDepth(points, near, Infinity);
}

/**
 * Отсечение многоугольника слоем глубины `[near, far]` — тем же обходом рёбер,
 * что ближней плоскостью, только с двумя сторонами. Общий случай; кадру нужен
 * его частный — `volumeClipNear`.
 */
export function volumeClipDepth(points, near = VOLUME_NEAR_MM, far = Infinity) {
  const side = (list, keep, cut) => {
    const out = [];
    for (let index = 0; index < list.length; index += 1) {
      const a = list[index];
      const b = list[(index + 1) % list.length];
      const aIn = keep(a);
      const bIn = keep(b);
      if (aIn) out.push(a);
      if (aIn !== bIn) out.push(cut(a, b));
    }
    return out;
  };
  let poly = side(
    points,
    (point) => point.z >= near,
    (a, b) => {
      const t = (near - a.z) / (b.z - a.z);
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: near };
    },
  );
  if (!(far < Infinity) || poly.length < 3) return poly;
  poly = side(
    poly,
    (point) => point.z <= far,
    (a, b) => {
      const t = (far - a.z) / (b.z - a.z);
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: far };
    },
  );
  return poly.length < 3 ? [] : poly;
}
