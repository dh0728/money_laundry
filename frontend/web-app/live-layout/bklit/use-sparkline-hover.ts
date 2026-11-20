// Bklit UI Sparkline registry source. See LICENSE.
"use client";

import { useCallback, useMemo, useState } from "react";

/**
 * Lift a sparkline's hover state so you can display the hovered value.
 * Spread `sparklineProps` onto one sparkline — or several to sync their
 * crosshairs.
 *
 * ```tsx
 * const hover = useSparklineHover<Row>();
 * <span>{hover.datum?.value ?? latest}</span>
 * <LineSparkline data={rows} dataKey="value" {...hover.sparklineProps} />
 * ```
 */
export function useSparklineHover<T>() {
  const [state, setState] = useState<{ index: number | null; datum: T | null }>(
    { index: null, datum: null }
  );
  const onHoverChange = useCallback(
    (index: number | null, datum: T | null) => setState({ index, datum }),
    []
  );
  const sparklineProps = useMemo(
    () => ({ hoverIndex: state.index, onHoverChange }),
    [state.index, onHoverChange]
  );
  return {
    index: state.index,
    datum: state.datum,
    isHovering: state.index !== null,
    sparklineProps,
  };
}
