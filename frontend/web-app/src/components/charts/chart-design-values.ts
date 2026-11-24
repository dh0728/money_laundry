function readChartToken(token: string) {
  return typeof document === "undefined"
    ? ""
    : getComputedStyle(document.documentElement).getPropertyValue(token).trim();
}

export function readChartNumber(token: string, fallback: number) {
  const value = Number.parseFloat(readChartToken(token));
  return Number.isFinite(value) ? value : fallback;
}

export function readChartDurationSeconds(token: string, fallback: number) {
  const value = readChartToken(token);
  const duration = Number.parseFloat(value);
  return Number.isFinite(duration) ? duration / (value.endsWith("ms") ? 1000 : 1) : fallback;
}

export function readCanvasColors(element: HTMLElement, sources: Record<string, string>) {
  const originalStyle = element.getAttribute("style");
  try {
    return Object.fromEntries(Object.entries(sources).map(([role, source]) => {
      element.style.setProperty("--chart-canvas-color", source);
      const style = getComputedStyle(element);
      const color = style.getPropertyValue("--chart-canvas-color").trim();
      return [role, !color || color === "currentcolor" ? style.color : color];
    }));
  } finally {
    if (originalStyle === null) {
      // Flush the browser's pending style attribute update before removing it.
      element.getAttribute("style");
      element.removeAttribute("style");
    } else {
      element.setAttribute("style", originalStyle);
    }
  }
}
