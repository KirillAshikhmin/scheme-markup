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

/**
 * Луч сквозь точку кадра: `{at, dir}` в мировых миллиметрах (таск 237).
 *
 * **Обратный ход кадра, и хозяин у него один.** Кадр считает точку экрана как
 * `halfWidth + camX · focal / camZ` (`volumeFacePolygons`); здесь то же деление
 * раскручивается обратно: доли экрана переводятся в оси камеры, и из них
 * собирается направление. Длина `dir` произвольна — важно только направление.
 *
 * Эта арифметика жила внутри `volumeFloorAt` (перенос по полу кликом, G212), и
 * теперь она нужна дважды: линейка целится тем же лучом, только упирается не в
 * плоскость пола, а в грани сцены (`volumeSurfaceAt`). Второго экземпляра быть
 * не должно — разойдись они на знак, перенос и мерка показывали бы разные места
 * под одной и той же точкой экрана.
 */
export function volumeRayAt(camera, box, x, y) {
  const basis = volumeBasis(camera);
  const focal = volumeFocal(box);
  const right = (x - box.width / 2) / focal;
  const up = (box.height / 2 - y) / focal;
  return {
    at: { x: camera.at.x, y: camera.at.y, z: camera.at.z },
    dir: {
      x: basis.fwd.x + basis.right.x * right + basis.up.x * up,
      y: basis.fwd.y + basis.right.y * right + basis.up.y * up,
      z: basis.fwd.z + basis.right.z * right + basis.up.z * up,
    },
  };
}

/**
 * Куда точка мира попадает на кадре: `{x, y}` или `null` — ближе ближней
 * плоскости, то есть позади головы. Прямой ход того же деления, что
 * раскручивает `volumeRayAt`; нужен подписи мерки, которая встаёт у середины
 * отрезка, а не у его концов.
 */
export function volumeScreenAt(point, camera, box) {
  const basis = volumeBasis(camera);
  const spot = volumeToCamera(point, camera.at, basis);
  if (!(spot.z >= VOLUME_NEAR_MM)) return null;
  const scale = volumeFocal(box) / spot.z;
  return { x: box.width / 2 + spot.x * scale, y: box.height / 2 - spot.y * scale };
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
