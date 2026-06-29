import { Check, Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface CopyButtonProps {
  value: string;
  label: string;
  className?: string;
  iconClassName?: string;
}

export function CopyButton({ value, label, className, iconClassName }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);
  const copiedTimerRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (copiedTimerRef.current !== null) window.clearTimeout(copiedTimerRef.current);
    },
    []
  );

  const handleCopy = () => {
    navigator.clipboard.writeText(value);
    setCopied(true);
    toast.success("Copied");
    if (copiedTimerRef.current !== null) window.clearTimeout(copiedTimerRef.current);
    copiedTimerRef.current = window.setTimeout(() => {
      setCopied(false);
      copiedTimerRef.current = null;
    }, 2000);
  };

  return (
    <Button
      variant="ghost"
      size="icon"
      className={cn(
        "relative shrink-0 rounded-none bg-muted text-muted-foreground hover:bg-muted hover:text-foreground",
        className
      )}
      onClick={handleCopy}
      aria-label={`Copy ${label}`}
      title={copied ? "Copied" : `Copy ${label}`}
    >
      <Check
        className={cn(
          "absolute transition-all duration-200",
          iconClassName,
          copied ? "scale-100 opacity-100" : "scale-0 opacity-0"
        )}
      />
      <Copy
        className={cn(
          "transition-all duration-200",
          iconClassName,
          copied ? "scale-0 opacity-0" : "scale-100 opacity-100"
        )}
      />
    </Button>
  );
}
