// Кирпичи, из которых сложены значки развёртки (таск 135, G187).
//
// Каждый значок рисуется **долями своего прямоугольника**: −0.5…0.5 по обеим
// осям, где −0.5 — левый (верхний) край, 0.5 — правый (нижний). Кирпичи
// переводят доли в точки холста сами, поэтому значок один и тот же и в двадцати
// точках экрана, и в сантиметре бумаги, и в масштабе стены.
//
// **Почему доли переводятся здесь, а не `ctx.scale`.** Прямоугольник значка
// бывает непропорциональным: внутренний блок кондиционера — три к одному. От
// `ctx.scale(width, height)` вместе с геометрией растянулась бы и толщина
// линии: вертикальные штрихи стали бы втрое толще горизонтальных, а круги —
// овалами. Здесь масштаб применяется к координатам, а `lineWidth` остаётся в
// точках холста и одинаков во всех направлениях.
//
// Имена с приставкой `icon`: бандл — одна область видимости, и `line` с
// `circle` в ней уже заняты.

// Доля → точка холста. Радиусы меряются по короткой стороне: круг обязан
// остаться кругом на любом прямоугольнике.
const atX = (box, value) => box.x + (0.5 + value) * box.width;
const atY = (box, value) => box.y + (0.5 + value) * box.height;
const atR = (box, value) => value * Math.min(box.width, box.height);

export function iconRoundRect(ctx, box, x, y, width, height, radius) {
  const left = atX(box, x);
  const top = atY(box, y);
  const right = atX(box, x + width);
  const bottom = atY(box, y + height);
  const r = Math.max(0, Math.min(atR(box, radius), Math.min(Math.abs(right - left), Math.abs(bottom - top)) / 2));
  ctx.beginPath();
  ctx.moveTo(left + r, top);
  ctx.lineTo(right - r, top);
  ctx.arcTo(right, top, right, top + r, r);
  ctx.lineTo(right, bottom - r);
  ctx.arcTo(right, bottom, right - r, bottom, r);
  ctx.lineTo(left + r, bottom);
  ctx.arcTo(left, bottom, left, bottom - r, r);
  ctx.lineTo(left, top + r);
  ctx.arcTo(left, top, left + r, top, r);
  ctx.closePath();
  ctx.stroke();
}

/** Плашка прибора во весь прямоугольник значка. */
export function iconPlate(ctx, box, inset = 0.04, radius = 0.1) {
  iconRoundRect(ctx, box, -0.5 + inset, -0.5 + inset, 1 - inset * 2, 1 - inset * 2, radius);
}

export function iconCircle(ctx, box, cx, cy, r) {
  ctx.beginPath();
  ctx.arc(atX(box, cx), atY(box, cy), atR(box, r), 0, Math.PI * 2);
  ctx.stroke();
}

export function iconLine(ctx, box, x1, y1, x2, y2) {
  ctx.beginPath();
  ctx.moveTo(atX(box, x1), atY(box, y1));
  ctx.lineTo(atX(box, x2), atY(box, y2));
  ctx.stroke();
}

/** Дуга долями: купол светильника, обзор датчика, складка шторы. */
export function iconArc(ctx, box, cx, cy, r, from, to, close) {
  ctx.beginPath();
  ctx.arc(atX(box, cx), atY(box, cy), atR(box, r), from, to);
  if (close) ctx.closePath();
  ctx.stroke();
}

/** Ломаная долями: зонт вытяжки, объектив камеры. */
export function iconPoly(ctx, box, points, close) {
  ctx.beginPath();
  points.forEach(([x, y], index) => {
    if (index === 0) ctx.moveTo(atX(box, x), atY(box, y));
    else ctx.lineTo(atX(box, x), atY(box, y));
  });
  if (close) ctx.closePath();
  ctx.stroke();
}

/** Решётка: ею читаются кондиционер, бризер и вытяжка — у всех троих она лицо. */
export function iconLouvers(ctx, box, count, from, to, left, right) {
  for (let index = 0; index < count; index += 1) {
    const y = from + ((to - from) * (index + 0.5)) / count;
    iconLine(ctx, box, left, y, right, y);
  }
}

/** Дуги сигнала: присутствие, движение, WiFi. */
export function iconWaves(ctx, box, cx, cy, radii, from, to) {
  for (const r of radii) iconArc(ctx, box, cx, cy, r, from, to, false);
}

/** Капля: протечка, осушитель, водорозетка. */
export function iconDrop(ctx, box, cx, cy, size) {
  const x = atX(box, cx);
  const y = atY(box, cy);
  const r = atR(box, size);
  ctx.beginPath();
  ctx.moveTo(x, y - r);
  ctx.quadraticCurveTo(x + r * 0.9, y + r * 0.35, x, y + r * 0.8);
  ctx.quadraticCurveTo(x - r * 0.9, y + r * 0.35, x, y - r);
  ctx.closePath();
  ctx.stroke();
}

/** Плашка с клавишами: столько, сколько каналов у выключателя. */
export function iconKeys(ctx, box, count) {
  iconPlate(ctx, box);
  const width = 0.62 / count;
  for (let index = 0; index < count; index += 1) {
    iconRoundRect(ctx, box, -0.31 + index * width, -0.26, width * 0.84, 0.52, 0.04);
  }
}
