"use client";

import type {
  SankeyLink as SankeyLinkType,
  SankeyNode as SankeyNodeType,
} from "d3-sankey";
import { m, useTransform } from "motion/react";
import { Fragment, type ReactNode, useCallback, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useMountProgress } from "../use-mount-progress";
import { readChartDurationSeconds } from "../../chart-design-values";
import {
  type SankeyLinkDatum,
  type SankeyNodeDatum,
  useSankey,
} from "./sankey-context";

// Helper to get node index from link source/target
type NodeOrIndex = SankeyNodeType<SankeyNodeDatum, SankeyLinkDatum> | number;
type FlowLink = SankeyLinkType<SankeyNodeDatum, SankeyLinkDatum>;
type LinkAction = { label: string; selected: boolean; emphasized?: boolean; activate: () => void };

function getNodeIndex(nodeOrIndex: NodeOrIndex): number | undefined {
  if (typeof nodeOrIndex === "number") {
    return nodeOrIndex;
  }
  return nodeOrIndex.index;
}

function getNodeObject(
  nodeOrIndex: NodeOrIndex
): SankeyNodeType<SankeyNodeDatum, SankeyLinkDatum> | null {
  if (typeof nodeOrIndex === "number") {
    return null;
  }
  return nodeOrIndex;
}

// Default node color palette using CSS variables
const defaultColors = [
  "var(--aml-sky-050)",
  "var(--aml-pink-050)",
  "var(--aml-lime-050)",
  "var(--palette-teal-500, var(--aml-sky-070))",
  "var(--chart-5)",
];

function getDefaultNodeColor(
  node: SankeyNodeType<SankeyNodeDatum, SankeyLinkDatum>
): string {
  const index = node.index ?? 0;
  return defaultColors[index % defaultColors.length] ?? "var(--aml-sky-050)";
}

export interface SankeyLinkProps {
  /** Animate the initial draw of the base ribbon. */
  reveal?: boolean;
  linkAction?: (link: FlowLink) => LinkAction | undefined;
  /** Temporary displacement of a node in chart coordinates. */
  getNodeOffset?: (index: number) => { x: number; y: number };
  /** Optional application overlay using the rendered link geometry. */
  renderLinkOverlay?: (link: FlowLink, path: string, width: number) => ReactNode;
  /** Stroke color for links (overrides gradient). Default: uses gradient */
  stroke?: string;
  /** Stroke opacity. Default: 0.5 */
  strokeOpacity?: number;
  /** Per-link stroke opacity (overrides strokeOpacity for that link) */
  getLinkOpacity?: (
    link: SankeyLinkType<SankeyNodeDatum, SankeyLinkDatum>,
    index: number
  ) => number | undefined;
  /** Opacity when another link/node is hovered. Default: 0.1 */
  fadedOpacity?: number;
  /** Use gradient from source to target color. Default: true */
  useGradient?: boolean;
  /** Custom function to get node color (for gradient) */
  getNodeColor?: (
    node: SankeyNodeType<SankeyNodeDatum, SankeyLinkDatum>,
    index: number
  ) => string;
  /** Custom link color function (overrides gradient) */
  getLinkColor?: (
    link: SankeyLinkType<SankeyNodeDatum, SankeyLinkDatum>,
    index: number
  ) => string;
  /** Pattern definitions to render in defs. Use the chart pattern components (PatternLines, PatternCircles, etc.) */
  patterns?: React.ReactNode;
  /** Return pattern ID for a link, or null/undefined to use gradient/solid color */
  getLinkPattern?: (
    link: SankeyLinkType<SankeyNodeDatum, SankeyLinkDatum>,
    index: number
  ) => string | null | undefined;
}

interface AnimatedLinkProps {
  reveal: boolean;
  path: string;
  width: number;
  stroke: string;
  strokeOpacity: number;
  index: number;
  totalLinks: number;
  isFaded: boolean;
  isHighlighted: boolean;
  fadedOpacity: number;
  animationDuration: number;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  action?: LinkAction;
}

function AnimatedLink({
  reveal,
  path,
  width,
  stroke,
  strokeOpacity,
  index,
  totalLinks,
  isFaded,
  isHighlighted,
  fadedOpacity,
  animationDuration,
  onMouseEnter,
  onMouseLeave,
  action,
}: AnimatedLinkProps) {
  const { enterTransition, revealEpoch } = useSankey();
  const pathRef = useRef<SVGPathElement>(null);
  const [pathLength, setPathLength] = useState(0);
  const [highlightDuration] = useState(() => readChartDurationSeconds("--chart-sankey-highlight-duration", 0.18));

  // Links animate during the last 80% of total duration, starting at 20%
  const linkStartDelay = animationDuration * 0.2;
  const linkAnimDuration = animationDuration * 0.8;
  const staggerDelaySeconds =
    (linkStartDelay + (index / totalLinks) * linkAnimDuration * 0.4) / 1000;

  useLayoutEffect(() => {
    if (reveal && pathRef.current) {
      const length = pathRef.current.getTotalLength();
      setPathLength(length);
    }
  }, [path, reveal]);

  const progress = useMountProgress(
    enterTransition,
    staggerDelaySeconds,
    `${revealEpoch}-${index}`
  );
  const strokeDashoffset = useTransform(progress, [0, 1], [pathLength, 0]);

  // Calculate target opacity
  const getTargetOpacity = () => {
    if (isFaded) {
      return fadedOpacity;
    }
    if (isHighlighted) {
      return Math.min(1, strokeOpacity * 1.3);
    }
    return strokeOpacity;
  };
  const targetOpacity = getTargetOpacity();

  // Dasharray for path reveal
  const dashArray = pathLength > 0 ? `${pathLength} ${pathLength}` : "none";

  // Ensure opacity values are always numbers
  const initialOpacity = strokeOpacity ?? 0.5;
  const animatedOpacity = targetOpacity ?? initialOpacity;

  return (
    <m.path
      animate={{ opacity: animatedOpacity }}
      className="sankey-interactive-mark"
      data-sankey-highlighted={isHighlighted || undefined}
      d={path}
      fill="none"
      initial={{ opacity: initialOpacity }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      role={action ? "button" : undefined}
      tabIndex={action ? 0 : undefined}
      aria-label={action?.label}
      aria-pressed={action?.selected}
      onClick={action?.activate}
      onKeyDown={action ? (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        action.activate();
      } : undefined}
      ref={pathRef}
      stroke={stroke}
      strokeDasharray={reveal ? dashArray : undefined}
      strokeDashoffset={reveal ? strokeDashoffset : undefined}
      strokeWidth={Math.max(1, width)}
      transition={{ duration: highlightDuration, ease: "easeOut" }}
    />
  );
}

export function SankeyLink({
  reveal = true,
  stroke,
  strokeOpacity = 0.5,
  getLinkOpacity,
  fadedOpacity = 0.1,
  useGradient = true,
  getNodeColor,
  getLinkColor,
  patterns,
  getLinkPattern,
  linkAction,
  getNodeOffset,
  renderLinkOverlay,
}: SankeyLinkProps) {
  const {
    links,
    hoveredNodeIndex,
    hoveredLinkIndex,
    setHoveredLinkIndex,
    setTooltipData,
    animationDuration,
    createPath,
  } = useSankey();
  const gradientPrefix = useId();

  // Get color for a node (for gradients)
  const getNodeColorFn = useCallback(
    (node: SankeyNodeType<SankeyNodeDatum, SankeyLinkDatum>): string => {
      if (getNodeColor) {
        return getNodeColor(node, node.index ?? 0);
      }
      return getDefaultNodeColor(node);
    },
    [getNodeColor]
  );

  // Get color for a link (solid color, when not using gradient)
  const getLinkColorFn = useCallback(
    (link: SankeyLinkType<SankeyNodeDatum, SankeyLinkDatum>, index: number) => {
      if (getLinkColor) {
        return getLinkColor(link, index);
      }
      return stroke || "var(--aml-sky-050)";
    },
    [getLinkColor, stroke]
  );

  // Check if any element is hovered
  const isAnyHovered = hoveredNodeIndex !== null || hoveredLinkIndex !== null;

  // Build gradient definitions for all links
  const gradientDefs = useMemo(() => {
    if (!useGradient || stroke || getLinkColor) {
      return null;
    }

    return links.map((link, index) => {
      const sourceNode = getNodeObject(link.source as NodeOrIndex);
      const targetNode = getNodeObject(link.target as NodeOrIndex);

      // Always define a gradient so `url(#...)` never points to a missing id.
      // Use fallback colors if nodes can't be resolved
      const sourceColor = sourceNode
        ? getNodeColorFn(sourceNode)
        : "var(--aml-sky-050)";
      const targetColor = targetNode
        ? getNodeColorFn(targetNode)
        : "var(--aml-sky-050)";
      const gradientId = `${gradientPrefix}-link-gradient-${index}`;

      // Get absolute x positions for gradient
      // Use userSpaceOnUse to avoid issues with horizontal links (where bounding box has zero height)
      const x1 = sourceNode?.x1 ?? 0;
      const x2 = targetNode?.x0 ?? 100;

      return (
        <linearGradient
          gradientUnits="userSpaceOnUse"
          id={gradientId}
          key={gradientId}
          x1={x1}
          x2={x2}
          y1="0"
          y2="0"
        >
          <stop offset="0%" stopColor={sourceColor} stopOpacity={1} />
          <stop offset="100%" stopColor={targetColor} stopOpacity={1} />
        </linearGradient>
      );
    });
  }, [links, useGradient, stroke, getLinkColor, getNodeColorFn, gradientPrefix]);

  return (
    <g className="sankey-links">
      {/* Pattern and gradient definitions */}
      <defs>
        {patterns}
        {gradientDefs}
      </defs>

      {/* Links */}
      {links.map((link, index) => {
        const source = getNodeObject(link.source as NodeOrIndex);
        const target = getNodeObject(link.target as NodeOrIndex);
        const from = source?.index === undefined ? undefined : getNodeOffset?.(source.index);
        const to = target?.index === undefined ? undefined : getNodeOffset?.(target.index);
        const displaced = from?.x || from?.y || to?.x || to?.y;
        const path = createPath(displaced && source && target ? {
          ...link,
          source: { ...source, x1: (source.x1 ?? 0) + (from?.x ?? 0) },
          target: { ...target, x0: (target.x0 ?? 0) + (to?.x ?? 0) },
          y0: (link.y0 ?? 0) + (from?.y ?? 0),
          y1: (link.y1 ?? 0) + (to?.y ?? 0),
        } : link);
        const linkWidth = link.width ?? 1;

        // Skip if path is empty
        if (!path || path.trim() === "") {
          return null;
        }

        const sIdx = getNodeIndex(link.source as NodeOrIndex);
        const tIdx = getNodeIndex(link.target as NodeOrIndex);

        // Use fallback indices if we can't resolve
        const sourceIdx =
          sIdx ?? (typeof link.source === "number" ? link.source : -1);
        const targetIdx =
          tIdx ?? (typeof link.target === "number" ? link.target : -1);

        const action = linkAction?.(link);
        const isHighlighted =
          action?.selected ||
          action?.emphasized ||
          hoveredLinkIndex === index ||
          hoveredNodeIndex === sourceIdx ||
          hoveredNodeIndex === targetIdx;
        const isFaded = (isAnyHovered || action?.emphasized === false) && !isHighlighted;

        const handleMouseEnter = () => {
          setHoveredLinkIndex(index);
          setTooltipData({
            type: "link",
            linkIndex: index,
            x: 0,
            y: 0,
            data: link,
          });
        };

        const handleMouseLeave = () => {
          setHoveredLinkIndex(null);
          setTooltipData(null);
        };

        // Determine stroke color (pattern URL, gradient URL, or solid color)
        let linkStroke: string;
        const patternId = getLinkPattern?.(link, index);
        if (patternId) {
          // Use pattern fill
          linkStroke = `url(#${patternId})`;
        } else if (useGradient && !stroke && !getLinkColor) {
          // Use gradient
          linkStroke = `url(#${gradientPrefix}-link-gradient-${index})`;
        } else {
          linkStroke = getLinkColorFn(link, index);
        }

        return (
          <Fragment key={`link-${sourceIdx}-${targetIdx}-${link.width ?? link.value ?? ""}`}>
            <AnimatedLink
              action={action}
              reveal={reveal}
              animationDuration={animationDuration}
              fadedOpacity={fadedOpacity}
              index={index}
              isFaded={isFaded}
              isHighlighted={isHighlighted}
              onMouseEnter={handleMouseEnter}
              onMouseLeave={handleMouseLeave}
              path={path}
              stroke={linkStroke}
              strokeOpacity={getLinkOpacity?.(link, index) ?? strokeOpacity}
              totalLinks={links.length}
              width={linkWidth}
            />
            {renderLinkOverlay?.(link, path, linkWidth)}
          </Fragment>
        );
      })}
    </g>
  );
}

SankeyLink.displayName = "SankeyLink";

export default SankeyLink;
