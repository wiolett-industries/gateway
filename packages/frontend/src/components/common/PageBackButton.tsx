import { ArrowLeft } from "lucide-react";
import type * as React from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type PageBackButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement>;

export function PageBackButton({ className, ...props }: PageBackButtonProps) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className={cn("h-9 w-9 shrink-0", className)}
      aria-label="Back"
      {...props}
    >
      <ArrowLeft className="h-4 w-4" />
    </Button>
  );
}
