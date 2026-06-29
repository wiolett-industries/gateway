import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";
import { Children } from "react";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex h-6 max-w-full min-w-0 shrink items-center justify-center overflow-hidden text-ellipsis whitespace-nowrap px-2 py-0 text-[11px] font-semibold uppercase tracking-wider leading-none [&>*]:max-w-full [&>*]:min-w-0 [&>*]:overflow-hidden [&>*]:text-ellipsis [&>*]:whitespace-nowrap",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground",
        secondary: "bg-muted dark:bg-white/5 text-muted-foreground",
        destructive: "bg-red-500/15 text-red-600 dark:text-red-400",
        outline: "border border-border text-muted-foreground",
        success: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
        warning: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
        info: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function renderBadgeChildren(children: React.ReactNode) {
  const output: React.ReactNode[] = [];
  let text = "";

  const flushText = () => {
    if (!text) return;
    output.push(
      <span key={`text-${output.length}`} className="block min-w-0 max-w-full truncate">
        {text}
      </span>
    );
    text = "";
  };

  Children.forEach(children, (child) => {
    if (typeof child === "string" || typeof child === "number") {
      text += String(child);
      return;
    }
    flushText();
    output.push(child);
  });
  flushText();

  return output;
}

function Badge({ className, variant, children, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props}>
      {renderBadgeChildren(children)}
    </div>
  );
}

export { Badge, badgeVariants };
