export type BarValueLabelOrientation = "auto" | "horizontal" | "vertical";
export type BarValueLabelPosition = "top" | "center" | "bottom";

/** Distance between a top/bottom-aligned label and the bar edge. */
const LABEL_INSET = 6;

export function getBarValueLabelLayout({
  x,
  y,
  width,
  height,
  labelWidth,
  labelSize,
  isHorizontal,
  orientation,
  position,
}: {
  x: number;
  y: number;
  width: number;
  height: number;
  labelWidth: number;
  labelSize: number;
  isHorizontal: boolean;
  orientation: BarValueLabelOrientation;
  position: BarValueLabelPosition;
}) {
  const minimumCrossSize = labelSize + LABEL_INSET;
  const normalFits = width >= labelWidth + 10 && height >= minimumCrossSize;
  const rotatedFits = height >= labelWidth + 10 && width >= minimumCrossSize;
  let fits = normalFits || rotatedFits;
  if (orientation === "horizontal") {
    fits = normalFits;
  } else if (orientation === "vertical") {
    fits = rotatedFits;
  }

  const rotated =
    fits &&
    (orientation === "vertical" || (orientation === "auto" && !normalFits));
  // Footprint of the (possibly rotated) label, so top/bottom placement keeps
  // the whole label inside the bar instead of just its centre point.
  const extentX = rotated ? labelSize : labelWidth;
  const extentY = rotated ? labelWidth : labelSize;

  let labelX = x + width / 2;
  let labelY = y + height / 2;
  if (isHorizontal) {
    // Horizontal bars: "top" is the value end (right), "bottom" the base (left).
    if (position === "top") {
      labelX = x + width - LABEL_INSET - extentX / 2;
    } else if (position === "bottom") {
      labelX = x + LABEL_INSET + extentX / 2;
    }
  } else if (position === "top") {
    labelY = y + LABEL_INSET + extentY / 2;
  } else if (position === "bottom") {
    labelY = y + height - LABEL_INSET - extentY / 2;
  }

  return { fits, rotated, x: labelX, y: labelY };
}
