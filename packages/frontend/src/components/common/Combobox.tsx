import { ChevronDown } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export interface ComboboxOption {
  value: string;
  label: string;
  keywords?: string;
  disabled?: boolean;
}

interface ComboboxProps {
  value: string;
  options: ComboboxOption[];
  onValueChange: (value: string) => void;
  freeText?: boolean;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyMessage?: string;
  disabled?: boolean;
  className?: string;
  inputClassName?: string;
  contentClassName?: string;
  renderOption?: (option: ComboboxOption) => ReactNode;
}

export function Combobox({
  value,
  options,
  onValueChange,
  freeText = false,
  placeholder = "Select...",
  searchPlaceholder = "Search...",
  emptyMessage = "No results found.",
  disabled,
  className,
  inputClassName,
  contentClassName,
  renderOption,
}: ComboboxProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(-1);
  const selected = useMemo(
    () => options.find((option) => option.value === value) ?? null,
    [options, value]
  );
  const filteredOptions = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    if (!normalizedQuery) return options;
    return options.filter((option) =>
      [option.label, option.keywords, option.value]
        .filter(Boolean)
        .join(" ")
        .toLocaleLowerCase()
        .includes(normalizedQuery)
    );
  }, [options, query]);

  useEffect(() => {
    setActiveIndex(filteredOptions.length > 0 ? 0 : -1);
  }, [filteredOptions]);

  const close = () => {
    setOpen(false);
    setQuery("");
    setActiveIndex(-1);
  };

  const selectOption = (option: ComboboxOption) => {
    if (option.disabled) return;
    onValueChange(option.value);
    close();
  };

  return (
    <div
      className={cn("relative w-full", className)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) close();
      }}
    >
      <Input
        role="combobox"
        aria-expanded={open}
        value={open ? query : freeText ? value : (selected?.label ?? "")}
        onFocus={() => {
          setQuery(freeText ? value : "");
          setOpen(true);
        }}
        onChange={(event) => {
          const nextValue = event.target.value;
          setQuery(nextValue);
          setOpen(true);
          if (freeText) onValueChange(nextValue);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            close();
            event.currentTarget.blur();
            return;
          }
          if (!open || filteredOptions.length === 0) return;
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setActiveIndex((index) => (index + 1) % filteredOptions.length);
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setActiveIndex((index) => (index <= 0 ? filteredOptions.length - 1 : index - 1));
          } else if (event.key === "Enter" && activeIndex >= 0) {
            event.preventDefault();
            selectOption(filteredOptions[activeIndex]!);
          }
        }}
        placeholder={open ? searchPlaceholder : placeholder}
        className={cn("pr-10", inputClassName)}
        disabled={disabled}
      />
      <ChevronDown className="pointer-events-none absolute right-3 top-[18px] h-4 w-4 -translate-y-1/2 opacity-50" />
      {open && !disabled && (!freeText || filteredOptions.length > 0) && (
        <div
          data-state="open"
          className={cn(
            "dropdown-content absolute left-0 top-full z-50 mt-1 w-max min-w-full max-w-[calc(100vw-2rem)] overflow-y-auto border border-border bg-popover p-1 text-popover-foreground shadow-md",
            contentClassName
          )}
        >
          {filteredOptions.length === 0 ? (
            <div className="px-2 py-1.5 text-sm text-muted-foreground">{emptyMessage}</div>
          ) : (
            filteredOptions.map((option, index) => (
              <button
                type="button"
                key={option.value}
                aria-disabled={option.disabled}
                className={cn(
                  "relative flex w-full items-center gap-2 whitespace-nowrap px-2 py-1.5 text-left text-sm outline-none hover:bg-accent hover:text-accent-foreground aria-disabled:opacity-50",
                  index === activeIndex && "bg-accent text-accent-foreground"
                )}
                onMouseEnter={() => setActiveIndex(index)}
                onMouseDown={(event) => {
                  event.preventDefault();
                  selectOption(option);
                }}
              >
                {renderOption?.(option) ?? option.label}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
