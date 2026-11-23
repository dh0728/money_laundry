// Split from series-point-marker.tsx so that file exports only components (react-refresh lint).

export interface SeriesPointMarkerStyle {
  /** Fill color for the inner circle */
  fill?: string;
  /** Outer ring stroke color. Default: same as `fill` */
  stroke?: string;
  /** Outer ring stroke width in px. Default: 2. Set to 0 to disable. */
  strokeWidth?: number;
  /** Gap between the inner fill and outer ring in px. Default: 2 */
  ringGap?: number;
  /** Optional outer outline beyond the ring. Default: 0 */
  outlineWidth?: number;
  /** Outer outline color. Default: same as `stroke` */
  outlineColor?: string;
  /** Point radius in px. Default: 5 */
  radius?: number;
  /** Dim non-active points while hovering. Default: true */
  fadeOnHover?: boolean;
  /** Opacity for non-hovered points when `fadeOnHover` is true. Default: 0.5 */
  inactiveOpacity?: number;
  /**
   * Blur in px for non-hovered points when `fadeOnHover` is true.
   * Applied once on the dimmed layer (not per dot) for performance. Default: 2
   */
  inactiveBlur?: number;
  /** Initial blur in px during enter animation. Default: 2 */
  enterBlur?: number;
  /** Enlarge the active point while hovering. Default: true */
  showActiveHighlight?: boolean;
}
export function getSeriesMarkerVisualExtent(
  style: Pick<
    SeriesPointMarkerStyle,
    | "radius"
    | "strokeWidth"
    | "ringGap"
    | "outlineWidth"
    | "showActiveHighlight"
  >
): number {
  const radius = style.radius ?? 5;
  const strokeWidth = style.strokeWidth ?? 2;
  const ringGap = style.ringGap ?? 2;
  const outlineWidth = style.outlineWidth ?? 0;
  const showActiveHighlight = style.showActiveHighlight ?? true;
  const ring = strokeWidth > 0 ? ringGap + strokeWidth : 0;
  const outline = outlineWidth > 0 ? outlineWidth : 0;
  const highlightPad = showActiveHighlight ? radius * 0.35 : 0;
  return radius + ring + outline + highlightPad + 2;
}
