import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

interface TruncateStartProps extends HTMLAttributes<HTMLSpanElement> {
  text: string;
}

export function TruncateStart({ text, className, title, ...props }: TruncateStartProps) {
  return (
    <span
      className={cn(
        "block w-full min-w-0 overflow-hidden whitespace-nowrap text-left [direction:rtl]",
        className
      )}
      title={title ?? text}
      {...props}
    >
      <span className="block min-w-full overflow-hidden text-ellipsis whitespace-nowrap text-left [direction:ltr] [unicode-bidi:plaintext]">
        {text}
      </span>
    </span>
  );
}
