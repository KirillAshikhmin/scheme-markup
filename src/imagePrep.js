// Подготовка плана: проверка файла, поворот на четверть оборота и обрезка рамкой.
// Координаты меток — доли от размера плана, поэтому вместе с картинкой нужно
// пересчитать и доли: метка обязана остаться на том же месте изображения.
// Арифметика здесь чистая (проверяется тестами), браузерные части — ниже.

export const PLAN_IMAGE_TYPES = ["image/png", "image/jpeg"];
export const PLAN_IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg"];
export const ROTATION_STEPS = [0, 90, 180, 270];

// Тип у перетащенного файла иногда пустой — тогда решает расширение.
export function isPlanImageFile(file) {
  if (!file) return false;
  const type = String(file.type || "").toLowerCase();
  if (PLAN_IMAGE_TYPES.includes(type)) return true;
  if (type && type !== "application/octet-stream") return false;
  const name = String(file.name || "").toLowerCase();
  return PLAN_IMAGE_EXTENSIONS.some((extension) => name.endsWith(extension));
}

// Тип берётся из расширения, когда браузер его не назвал: у перетащенного
// файла type часто пуст, и JPEG иначе уехал бы в хранилище и в zip как png.
export function planTypeOf(file) {
  const type = String((file && file.type) || "").toLowerCase();
  if (PLAN_IMAGE_TYPES.includes(type)) return type;
  const name = String((file && file.name) || "").toLowerCase();
  if (name.endsWith(".jpg") || name.endsWith(".jpeg")) return "image/jpeg";
  return "image/png";
}

// Пропорция плана. Замена подложки на картинку другой пропорции сдвигает всю
// разметку относительно плана: доли остаются прежними, а содержимое картинки
// растянуто иначе. Допуск закрывает округление пикселей при экспорте плана.
function planAspect(size) {
  const width = Number(size && size.width);
  const height = Number(size && size.height);
  return width > 0 && height > 0 ? width / height : 0;
}

export function sameAspect(before, after, tolerance = 0.01) {
  const first = planAspect(before);
  const second = planAspect(after);
  if (!first || !second) return true;
  return Math.abs(first - second) / Math.max(first, second) <= tolerance;
}

export function identityTransform() {
  return { rotate: 0, crop: null };
}

function clampUnit(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(1, Math.max(0, number));
}

// Поворот приводится к четверти оборота, рамка — к прямоугольнику внутри плана.
export function normalizeTransform(transform) {
  const source = transform || {};
  const turns = Math.round(Number(source.rotate || 0) / 90);
  const rotate = ((turns % 4) + 4) % 4 * 90;
  const raw = source.crop;
  if (!raw) return { rotate, crop: null };
  const x = clampUnit(raw.x, 0);
  const y = clampUnit(raw.y, 0);
  const width = Math.min(clampUnit(raw.width, 1), 1 - x);
  const height = Math.min(clampUnit(raw.height, 1), 1 - y);
  if (width <= 0 || height <= 0) return { rotate, crop: null };
  if (x === 0 && y === 0 && width === 1 && height === 1) return { rotate, crop: null };
  return { rotate, crop: { x, y, width, height } };
}

// Доли в системе повёрнутого плана: вправо (x,y) -> (1−y, x), влево -> (y, 1−x).
function rotateFraction(point, rotate) {
  if (rotate === 90) return { x: 1 - point.y, y: point.x };
  if (rotate === 180) return { x: 1 - point.x, y: 1 - point.y };
  if (rotate === 270) return { x: point.y, y: 1 - point.x };
  return { x: point.x, y: point.y };
}

// Поворот и обрезка копятся в одно преобразование: (поворот на R, затем рамка
// в долях повёрнутого плана). Так исходник пережимается один раз, а метки
// пересчитываются одним шагом — и считаются один раз, а не на каждом шаге.
export function rotateTransform(transform, degrees) {
  const current = normalizeTransform(transform);
  const turns = ((Math.round(Number(degrees || 0) / 90) % 4) + 4) % 4;
  const rotate = (current.rotate + turns * 90) % 360;
  if (!current.crop) return { rotate, crop: null };
  const a = rotateFraction({ x: current.crop.x, y: current.crop.y }, turns * 90);
  const b = rotateFraction(
    { x: current.crop.x + current.crop.width, y: current.crop.y + current.crop.height },
    turns * 90,
  );
  return {
    rotate,
    crop: {
      x: Math.min(a.x, b.x),
      y: Math.min(a.y, b.y),
      width: Math.abs(a.x - b.x),
      height: Math.abs(a.y - b.y),
    },
  };
}

// Рамка задаётся в долях того, что видно сейчас, — то есть внутри прежней рамки.
export function cropTransform(transform, frame) {
  const current = normalizeTransform(transform);
  const box = normalizeTransform({ crop: frame }).crop;
  if (!box) return current;
  const base = current.crop || { x: 0, y: 0, width: 1, height: 1 };
  return normalizeTransform({
    rotate: current.rotate,
    crop: {
      x: base.x + box.x * base.width,
      y: base.y + box.y * base.height,
      width: box.width * base.width,
      height: box.height * base.height,
    },
  });
}

export function transformPoint(point, transform) {
  const { rotate, crop } = normalizeTransform(transform);
  const turned = rotateFraction({ x: Number(point.x), y: Number(point.y) }, rotate);
  if (!crop) return turned;
  return { x: (turned.x - crop.x) / crop.width, y: (turned.y - crop.y) / crop.height };
}

// Смещение подписи задано в пикселях экрана: обрезка его не трогает, поворот —
// поворачивает так же, как саму картинку, иначе подпись уедет на другую сторону.
export function transformOffset(offset, transform) {
  if (!offset) return offset;
  const { rotate } = normalizeTransform(transform);
  const dx = Number(offset.dx) || 0;
  const dy = Number(offset.dy) || 0;
  if (rotate === 90) return { dx: -dy, dy: dx };
  if (rotate === 180) return { dx: -dx, dy: -dy };
  if (rotate === 270) return { dx: dy, dy: -dx };
  return { dx, dy };
}

// Ничего не менялось — значит и переписывать план незачем.
export function isIdentityTransform(transform) {
  const settings = normalizeTransform(transform);
  return settings.rotate === 0 && !settings.crop;
}

export function transformSize(size, transform) {
  const { rotate, crop } = normalizeTransform(transform);
  const turned =
    rotate === 90 || rotate === 270
      ? { width: Number(size.height), height: Number(size.width) }
      : { width: Number(size.width), height: Number(size.height) };
  if (!crop) return { width: Math.round(turned.width), height: Math.round(turned.height) };
  return {
    width: Math.max(1, Math.round(turned.width * crop.width)),
    height: Math.max(1, Math.round(turned.height * crop.height)),
  };
}

// Пересчёт всех точек одной метки: используется панелью схем перед updateMark.
export function transformMarkPoints(points, transform) {
  return (points || []).map((point) => {
    const next = transformPoint(point, transform);
    return { x: Math.min(1, Math.max(0, next.x)), y: Math.min(1, Math.max(0, next.y)) };
  });
}

// Метка за рамкой обрезки была бы потеряна: считаем такие, чтобы предупредить.
export function countPointsOutside(points, transform) {
  let outside = 0;
  for (const point of points || []) {
    const next = transformPoint(point, transform);
    if (next.x < 0 || next.x > 1 || next.y < 0 || next.y > 1) outside += 1;
  }
  return outside;
}

// ——— браузерная часть ————————————————————————————————————————————————

function planOutputType(blob) {
  return planTypeOf(blob);
}

// createImageBitmap есть не везде (и не всегда по file://) — запасной путь <img>.
export async function decodePlanImage(blob) {
  const url = URL.createObjectURL(blob);
  try {
    if (typeof createImageBitmap === "function") {
      const bitmap = await createImageBitmap(blob);
      return { image: bitmap, width: bitmap.width, height: bitmap.height, url };
    }
    const image = await new Promise((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("decode"));
      element.src = url;
    });
    return { image, width: image.naturalWidth, height: image.naturalHeight, url };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}

export function releasePlanImage(decoded) {
  if (!decoded) return;
  if (decoded.url) URL.revokeObjectURL(decoded.url);
  if (decoded.image && typeof decoded.image.close === "function") decoded.image.close();
}

// Файл плана: проверка типа и настоящий размер картинки в пикселях.
export async function readPlanImage(file) {
  const blob = file.slice ? file.slice(0, file.size, planTypeOf(file)) : file;
  const decoded = await decodePlanImage(blob);
  const size = { width: decoded.width, height: decoded.height };
  releasePlanImage(decoded);
  return { blob, width: size.width, height: size.height };
}

function blobFromCanvas(canvas, type) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("toBlob"))),
      type,
      type === "image/jpeg" ? 0.92 : undefined,
    );
  });
}

// Новая картинка плана по тому же преобразованию, что и доли меток.
export async function renderPlanImage(blob, transform) {
  const settings = normalizeTransform(transform);
  const decoded = await decodePlanImage(blob);
  try {
    const turned = transformSize({ width: decoded.width, height: decoded.height }, { rotate: settings.rotate });
    const size = transformSize({ width: decoded.width, height: decoded.height }, settings);
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const ctx = canvas.getContext("2d");
    if (settings.crop) {
      ctx.translate(-Math.round(turned.width * settings.crop.x), -Math.round(turned.height * settings.crop.y));
    }
    if (settings.rotate === 90) {
      ctx.translate(turned.width, 0);
      ctx.rotate(Math.PI / 2);
    } else if (settings.rotate === 180) {
      ctx.translate(turned.width, turned.height);
      ctx.rotate(Math.PI);
    } else if (settings.rotate === 270) {
      ctx.translate(0, turned.height);
      ctx.rotate(-Math.PI / 2);
    }
    ctx.drawImage(decoded.image, 0, 0);
    const out = await blobFromCanvas(canvas, planOutputType(blob));
    return { blob: out, width: size.width, height: size.height };
  } finally {
    releasePlanImage(decoded);
  }
}
