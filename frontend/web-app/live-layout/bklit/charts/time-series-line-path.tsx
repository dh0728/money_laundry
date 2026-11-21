import type { Ref, SVGProps } from "react";

export type LinePathProps = Omit<SVGProps<SVGPathElement>, "d" | "ref"> & {
  /** Path data, e.g. from {@link linePathD}. */
  d: string;
  /** Ref to the `<path>` (React 18 compatible, like visx `innerRef`). */
  innerRef?: Ref<SVGPathElement>;
};

/**
 * The `<path>` visx `LinePath` rendered, minus its `visx-linepath` class:
 * `d`, then `fill` (default `transparent`), then `strokeLinecap="round"` (so a
 * lone defined point between gaps stays visible), then every other prop in
 * the order given. Props that repeat an earlier key keep its position.
 */
export function LinePath({
  d,
  fill = "transparent",
  innerRef,
  ...rest
}: LinePathProps) {
  return (
    <path d={d} fill={fill} ref={innerRef} strokeLinecap="round" {...rest} />
  );
}
