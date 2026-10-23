// Изображения объектов на развёртке: климат.
//
// Здесь живёт тот самый кондиционер, ради которого таск 135 и затевался: его
// внутренний блок под метр по стене, и влезет он над дверью или нет — вопрос,
// на который отвечает только контур в настоящем размере.
import { viewCircle, viewDrop, viewLine, viewLouvers, viewParts, viewPoly, viewRect } from "./kit.js";

export const VIEWS_CLIMATE = {
  // Термостат (правка после сборки сценариев): рамка с экраном и двумя
  // кнопками под ним.
  thermostat: {
    // Знак свой у типа (поле `view`), за формой изображение не закрепляется.
    shapes: [],
    mm: { width: 86, height: 86 },
    parts: viewParts(
      viewRect(-0.5, -0.5, 1, 1, 0.12),
      viewRect(-0.3, -0.32, 0.6, 0.34, 0.04),
      viewCircle(-0.16, 0.24, 0.07),
      viewCircle(0.16, 0.24, 0.07),
    ),
  },
  // Тёплый пол: мат с греющим кабелем змейкой.
  warmFloor: {
    // Знак свой у типа (поле `view`), за формой изображение не закрепляется.
    shapes: [],
    mm: { width: 1000, height: 1000 },
    parts: viewParts(
      viewRect(-0.5, -0.5, 1, 1, 0.02),
      viewPoly(
        [
          [-0.38, -0.38],
          [0.38, -0.38],
          [0.38, -0.13],
          [-0.38, -0.13],
          [-0.38, 0.13],
          [0.38, 0.13],
          [0.38, 0.38],
          [-0.38, 0.38],
        ],
        false,
      ),
    ),
  },
  // Внутренний блок кондиционера: корпус с решёткой и индикатором.
  conditioner: {
    shapes: ["circle-thermo"],
    mm: { width: 900, height: 300 },
    parts: viewParts(
      viewRect(-0.5, -0.5, 1, 0.75, 0.16),
      viewLouvers(3, 0, 0.22, -0.4, 0.4),
      viewLine(-0.5, 0.25, 0.5, 0.25),
      viewCircle(0.36, -0.28, 0.05),
    ),
  },
  // Бризер: приточная коробка с круглой решёткой.
  breezer: {
    shapes: ["dome-dot", "dome"],
    mm: { width: 600, height: 350 },
    parts: viewParts(
      viewRect(-0.5, -0.5, 1, 1, 0.14),
      viewCircle(0, 0, 0.26),
      viewCircle(0, 0, 0.1),
      viewLine(-0.26, 0, 0.26, 0),
      viewLine(0, -0.26, 0, 0.26),
    ),
  },
  // Вытяжка: зонт над плитой.
  hood: {
    shapes: ["circle-fill"],
    mm: { width: 600, height: 350 },
    parts: viewParts(
      viewPoly([[-0.5, 0.5], [-0.28, -0.2], [0.28, -0.2], [0.5, 0.5]], true),
      viewRect(-0.12, -0.5, 0.24, 0.3, 0.03),
      viewLouvers(2, 0.1, 0.4, -0.3, 0.3),
    ),
  },
  // Вентиляция: решётка канального вентилятора — рамка панели, круг рабочего
  // колеса за ней и три жалюзи поперёк. Жалюзи не выходят за круг: на листе
  // это одна вещь, а не решётка поверх кольца.
  vent: {
    shapes: ["rect-horizontal-ticks"],
    mm: { width: 150, height: 150 },
    parts: viewParts(
      viewRect(-0.5, -0.5, 1, 1, 0.1),
      viewCircle(0, 0, 0.3),
      viewLouvers(3, -0.24, 0.24, -0.2, 0.2),
    ),
  },
  // Осушитель: напольная коробка с решёткой и каплей.
  dehumidifier: {
    shapes: ["drop-dot"],
    mm: { width: 400, height: 600 },
    parts: viewParts(
      viewRect(-0.5, -0.5, 1, 1, 0.12),
      viewLouvers(3, -0.3, 0.05, -0.3, 0.3),
      viewDrop(0, 0.26, 0.16),
    ),
  },
};
