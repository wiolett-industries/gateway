import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";

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
}

export function EmptyState({
  message,
  actionLabel,
  actionHref,
  onAction,
  hasActiveFilters,
  onReset,
}: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center gap-2 py-16 border border-border bg-card">
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
      </p>
      {hasActiveFilters && onReset && (
        <Button variant="outline" size="sm" onClick={onReset}>
          Clear filters
        </Button>
      )}
    </div>
  );
}
