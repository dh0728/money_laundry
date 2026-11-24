import { sankeyLinkHorizontal, type SankeyLink } from "d3-sankey";
import type { SankeyLinkDatum, SankeyNodeDatum } from "./sankey-context";

const horizontal = sankeyLinkHorizontal<SankeyNodeDatum, SankeyLinkDatum>();

export function sankeyLinkPath(
  link: SankeyLink<SankeyNodeDatum, SankeyLinkDatum>,
  returnBend: number,
): string {
  const { source, target, y0, y1, returnY } = link;
  if (typeof returnY !== "number") return horizontal(link) ?? "";
  if (typeof source === "number" || typeof target === "number" ||
      source.x1 === undefined || target.x0 === undefined || y0 === undefined || y1 === undefined) {
    return "";
  }

  const start = source.x1;
  const end = target.x0;
  const out = start + returnBend;
  const back = end - returnBend;
  return `M ${start} ${y0} C ${out} ${y0}, ${out} ${returnY}, ${start} ${returnY} H ${end} C ${back} ${returnY}, ${back} ${y1}, ${end} ${y1}`;
}
