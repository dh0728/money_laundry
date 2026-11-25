import type { ComponentProps, CSSProperties } from "react";
import { cn } from "@/lib/utils";
import "./interactive-graph-canvas.css";

type InteractiveGraphCanvasProps = Omit<ComponentProps<"canvas">, "width" | "height" | "style"> & {
  width: number;
  height: number;
};

export function InteractiveGraphCanvas({ width, height, className, ...props }: InteractiveGraphCanvasProps) {
  return <canvas {...props} className={cn("interactive-graph-canvas", className)} style={{
    "--graph-canvas-width": `${width}px`,
    "--graph-canvas-height": `${height}px`,
  } as CSSProperties} />;
}
