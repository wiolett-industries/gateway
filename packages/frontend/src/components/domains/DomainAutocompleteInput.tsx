import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { api } from "@/services/api";
import type { DomainSearchResult } from "@/types";
import { DnsStatusBadge } from "./DnsStatusBadge";

interface DomainAutocompleteInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

export function DomainAutocompleteInput({
  value,
  onChange,
  placeholder,
}: DomainAutocompleteInputProps) {
  const [suggestions, setSuggestions] = useState<DomainSearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const isFocusedRef = useRef(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const containerRef = useRef<HTMLDivElement>(null);

  // Fetch suggestions on value change, but only open dropdown if input is focused
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (value.length < 2) {
      setSuggestions([]);
      setOpen(false);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      try {
        const results = await api.searchDomains(value);
        setSuggestions(results);
        // Only open if input is currently focused
        if (isFocusedRef.current && results.length > 0) {
          setOpen(true);
        }
      } catch {
        setSuggestions([]);
      }
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [value]);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div ref={containerRef} className="relative flex-1">
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => {
          isFocusedRef.current = true;
          if (suggestions.length > 0) setOpen(true);
        }}
        onBlur={() => {
          isFocusedRef.current = false;
          // Delay close to allow click on suggestion
          setTimeout(() => {
            if (!isFocusedRef.current) setOpen(false);
          }, 200);
        }}
        placeholder={placeholder || "example.com"}
      />
      {open && suggestions.length > 0 && (
        <div className="absolute top-full left-0 right-0 z-50 mt-1 border border-border bg-popover shadow-md max-h-40 overflow-y-auto">
          {suggestions.map((s) => (
            <button
              key={s.id}
              type="button"
              className="flex items-center gap-2 w-full px-3 py-2 text-sm text-left hover:bg-accent transition-colors"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                onChange(s.domain);
                setOpen(false);
              }}
            >
              <span className="flex-1 truncate">{s.domain}</span>
              <DnsStatusBadge status={s.dnsStatus} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
