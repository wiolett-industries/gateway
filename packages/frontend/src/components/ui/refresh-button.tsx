import { RefreshCw } from "lucide-react";
import { useState } from "react";
import { Button } from "./button";

export function RefreshButton({ onClick, disabled }: { onClick: () => void | Promise<void>; disabled?: boolean }) {
  const [spinning, setSpinning] = useState(false);

  const handleClick = async () => {
    if (spinning || disabled) return;
    setSpinning(true);
    const minDelay = new Promise((r) => setTimeout(r, 3000));
    try {
      await Promise.all([onClick(), minDelay]);
    } finally {
      setSpinning(false);
    }
  };

  return (
    <Button
      variant="outline"
      size="icon"
      onClick={handleClick}
      disabled={spinning || disabled}
    >
      <RefreshCw
        className="h-4 w-4"
        style={spinning ? {
          animation: "refresh-spin 3s linear infinite",
        } : undefined}
      />
      <style>{`
        @keyframes refresh-spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(720deg); }
        }
      `}</style>
    </Button>
  );
}
