import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center justify-center px-2 py-1 text-[11px] font-semibold uppercase tracking-wider leading-none whitespace-nowrap",
  {
    variants: {
      variant: {
        default: "bg-foreground/10 text-foreground",
        secondary: "bg-foreground/5 text-muted-foreground",
        destructive: "bg-foreground/10 text-foreground",
        outline: "border border-border text-muted-foreground",
        success: "bg-foreground/10 text-foreground",
        warning: "bg-foreground/10 text-foreground",
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

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
