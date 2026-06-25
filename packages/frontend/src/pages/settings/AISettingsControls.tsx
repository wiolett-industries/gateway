import { Save } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function SettingsControlRow({
  title,
  description,
  children,
  controlsClassName = "",
}: {
  title: string;
  description: string;
  children: ReactNode;
  controlsClassName?: string;
}) {
  return (
    <div className="grid gap-3 border-b border-border px-4 py-3 last:border-b-0 sm:grid-cols-[minmax(12rem,1fr)_auto] sm:items-center">
      <div className="min-w-0">
        <p className="text-sm font-medium">{title}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
      </div>
      <div
        className={cn(
          "w-full shrink-0 sm:w-auto sm:min-w-[14rem] sm:max-w-[24rem]",
          controlsClassName
        )}
      >
        {children}
      </div>
    </div>
  );
}

export function SaveSettingsButton({
  onClick,
  disabled,
}: {
  onClick: () => void;
  disabled: boolean;
}) {
  return (
    <Button onClick={onClick} disabled={disabled}>
      <Save className="h-4 w-4" />
      Save
    </Button>
  );
}
