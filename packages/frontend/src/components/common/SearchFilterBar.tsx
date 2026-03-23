import { Filter, Search, X } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { type ReactNode, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface SearchFilterBarProps {
  /** Placeholder for the search input */
  placeholder?: string;
  /** Current search value */
  search: string;
  /** Called on every keystroke */
  onSearchChange: (value: string) => void;
  /** Called when user presses Enter (optional — for server-side search) */
  onSearchSubmit?: () => void;
  /** Whether any filters are active (controls Clear button visibility) */
  hasActiveFilters: boolean;
  /** Called when Clear is clicked */
  onReset: () => void;
  /** Filter dropdowns rendered inside the collapsible panel */
  filters?: ReactNode;
}

export function SearchFilterBar({
  placeholder = "Search...",
  search,
  onSearchChange,
  onSearchSubmit,
  hasActiveFilters,
  onReset,
  filters,
}: SearchFilterBarProps) {
  const [showFilters, setShowFilters] = useState(false);

  return (
    <div className="space-y-0">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={placeholder}
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            onKeyDown={onSearchSubmit ? (e) => e.key === "Enter" && onSearchSubmit() : undefined}
            className="pl-9"
          />
        </div>
        {filters && (
          <Button variant="outline" onClick={() => setShowFilters(!showFilters)}>
            <Filter className="h-4 w-4" />
            Filters
          </Button>
        )}
        {hasActiveFilters && (
          <Button variant="ghost" size="sm" onClick={onReset}>
            <X className="h-4 w-4" />
            Clear
          </Button>
        )}
      </div>

      {filters && (
        <AnimatePresence>
          {showFilters && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2, ease: [0.25, 0.1, 0.25, 1] }}
              className="overflow-hidden"
            >
              <div className="flex flex-wrap gap-3 border border-border bg-card p-3 mt-2">
                {filters}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      )}
    </div>
  );
}
