import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

interface ResizeHandleProps {
  side: "left" | "right";
  onResize: (width: number) => void;
  onResizeStart?: () => void;
  onResizeEnd?: () => void;
  minWidth?: number;
  maxWidth?: number;
}

export function ResizeHandle({
  side,
  onResize,
  onResizeStart,
  onResizeEnd,
  minWidth = 200,
  maxWidth = 600,
}: ResizeHandleProps) {
  const [isDragging, setIsDragging] = useState(false);
  const startXRef = useRef(0);
  const startWidthRef = useRef(0);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const parent = (e.target as HTMLElement).parentElement;
      if (!parent) return;
      startXRef.current = e.clientX;
      startWidthRef.current = parent.getBoundingClientRect().width;
      setIsDragging(true);
      onResizeStart?.();
    },
    [onResizeStart]
  );

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const delta = e.clientX - startXRef.current;
      const newWidth =
        side === "right" ? startWidthRef.current - delta : startWidthRef.current + delta;
      const clamped = Math.max(minWidth, Math.min(maxWidth, newWidth));
      onResize(clamped);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      onResizeEnd?.();
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [isDragging, side, minWidth, maxWidth, onResize, onResizeEnd]);

  return (
    <div
      className={cn(
        "absolute top-0 bottom-0 z-20 w-3 cursor-col-resize group",
        "after:absolute after:top-0 after:bottom-0 after:left-1/2 after:w-px after:-translate-x-1/2 after:transition-colors",
        "hover:after:bg-primary/30",
        isDragging && "after:bg-primary/40",
        side === "left" ? "-right-1.5" : "-left-1.5"
      )}
      onMouseDown={handleMouseDown}
    />
  );
}
