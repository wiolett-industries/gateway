import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";

interface EmptyStateProps {
  message: string;
  /** Optional link text like "Create one" */
  actionLabel?: string;
  /** Route for the action link */
  actionHref?: string;
  /** Callback for button action (used instead of href) */
  onAction?: () => void;
  /** Show "Clear filters" button */
  hasActiveFilters?: boolean;
  /** Callback when clearing filters */
  onReset?: () => void;
  /** Use inside an already bordered/card section. */
  embedded?: boolean;
}

export function EmptyState({
  message,
  actionLabel,
  actionHref,
  onAction,
  hasActiveFilters,
  onReset,
  embedded,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-2 bg-card",
        embedded ? "py-8" : "py-16 border border-border"
      )}
    >
      <p className="text-sm text-muted-foreground">
        {message}
        {actionLabel && actionHref && (
          <>
            {" "}
            <Link to={actionHref} className="text-foreground hover:underline">
              {actionLabel}
            </Link>
          </>
        )}
        {actionLabel && onAction && !actionHref && (
          <>
            {" "}
            <button onClick={onAction} className="text-foreground hover:underline">
              {actionLabel}
            </button>
          </>
        )}
        {hasActiveFilters && onReset && (
          <>
            {" "}
            <button type="button" onClick={onReset} className="text-foreground hover:underline">
              Clear filters
            </button>
          </>
        )}
      </p>
    </div>
  );
}
