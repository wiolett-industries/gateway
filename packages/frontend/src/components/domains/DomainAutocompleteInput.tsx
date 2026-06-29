import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { api } from "@/services/api";
import type {
  Domain,
  DomainSearchResult,
  FolderTreeNode,
  GroupedProxyHostsResponse,
} from "@/types";
import { DnsStatusBadge } from "./DnsStatusBadge";

let cachedDomains: DomainSearchResult[] | null = null;
let domainsLoadPromise: Promise<DomainSearchResult[]> | null = null;

function mapDomains(domains: Domain[]): DomainSearchResult[] {
  return domains.map((domain) => ({
    id: domain.id,
    domain: domain.domain,
    dnsStatus: domain.dnsStatus,
  }));
}

function collectFolderDomains(folder: FolderTreeNode, domains: Set<string>) {
  for (const host of folder.hosts) {
    for (const domain of host.domainNames) domains.add(domain);
  }
  for (const child of folder.children) collectFolderDomains(child, domains);
}

function getCachedDomainSuggestions() {
  const cachedDomainList = api.getCached<{ data: Domain[] }>("domains:list");
  if (cachedDomainList?.data?.length) return mapDomains(cachedDomainList.data);
  return [];
}

function getProxyHostDomainSuggestions() {
  const groupedProxyHosts = api.getCached<GroupedProxyHostsResponse>("proxy:grouped");
  if (!groupedProxyHosts) return [];

  const domains = new Set<string>();
  for (const host of groupedProxyHosts.ungroupedHosts) {
    for (const domain of host.domainNames) domains.add(domain);
  }
  for (const folder of groupedProxyHosts.folders) collectFolderDomains(folder, domains);

  return Array.from(domains)
    .sort((a, b) => a.localeCompare(b))
    .map((domain) => ({
      id: domain,
      domain,
      dnsStatus: "unknown" as const,
    }));
}

function loadDomainSuggestions() {
  if (cachedDomains) return Promise.resolve(cachedDomains);
  const cached = getCachedDomainSuggestions();
  if (cached.length > 0) {
    cachedDomains = cached;
    return Promise.resolve(cachedDomains);
  }
  domainsLoadPromise ??= api
    .listDomains({ limit: 100 })
    .then((result) => mapDomains(result.data))
    .catch(() => [])
    .then((domains) => (domains.length > 0 ? domains : getProxyHostDomainSuggestions()))
    .then((domains) => {
      if (domains.length > 0) cachedDomains = domains;
      return domains;
    })
    .finally(() => {
      domainsLoadPromise = null;
    });
  return domainsLoadPromise;
}

function filterDomains(domains: DomainSearchResult[], query: string) {
  const normalizedQuery = query.trim().toLowerCase();
  const filtered = normalizedQuery
    ? domains.filter((domain) => domain.domain.toLowerCase().includes(normalizedQuery))
    : domains;
  return filtered.slice(0, 10);
}

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
  const [inputValue, setInputValue] = useState(value);
  const [domains, setDomains] = useState<DomainSearchResult[]>(cachedDomains ?? []);
  const [suggestions, setSuggestions] = useState<DomainSearchResult[]>([]);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [keyboardActive, setKeyboardActive] = useState(false);
  const [open, setOpen] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const isFocusedRef = useRef(false);
  const fallbackSearchSeqRef = useRef(0);
  const suppressNextOpenRef = useRef(false);
  const anchorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setInputValue(value);
  }, [value]);

  useEffect(() => {
    let cancelled = false;
    loadDomainSuggestions()
      .then((loadedDomains) => {
        if (!cancelled) setDomains(loadedDomains);
      })
      .catch(() => {
        if (!cancelled) setDomains([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!isFocused) {
      setOpen(false);
      return;
    }
    const query = inputValue.trim();
    if (domains.length === 0) {
      setSuggestions([]);
      setOpen(false);
      const searchSeq = fallbackSearchSeqRef.current + 1;
      fallbackSearchSeqRef.current = searchSeq;
      const timeout = setTimeout(async () => {
        try {
          const results = await api.searchDomains(query);
          if (fallbackSearchSeqRef.current !== searchSeq) return;
          setSuggestions(results);
          setOpen(results.length > 0 && isFocusedRef.current);
        } catch {
          if (fallbackSearchSeqRef.current !== searchSeq) return;
          setSuggestions([]);
          setOpen(false);
        }
      }, 100);
      return () => clearTimeout(timeout);
    }
    const nextSuggestions = filterDomains(domains, inputValue);
    setSuggestions(nextSuggestions);
    setActiveIndex(nextSuggestions.length > 0 ? 0 : -1);
    if (suppressNextOpenRef.current) {
      suppressNextOpenRef.current = false;
      setOpen(false);
      return;
    }
    setOpen(nextSuggestions.length > 0 && isFocusedRef.current);
  }, [domains, inputValue, isFocused]);

  const selectDomain = (domain: string) => {
    suppressNextOpenRef.current = true;
    setInputValue(domain);
    onChange(domain);
    setOpen(false);
    setKeyboardActive(false);
  };

  return (
    <Popover
      open={open && suggestions.length > 0}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && anchorRef.current?.contains(document.activeElement)) return;
        setOpen(nextOpen);
        if (!nextOpen) setKeyboardActive(false);
      }}
    >
      <PopoverAnchor asChild>
        <div ref={anchorRef} className="flex-1">
          <Input
            value={inputValue}
            onChange={(e) => {
              const nextValue = e.target.value;
              suppressNextOpenRef.current = false;
              setInputValue(nextValue);
              onChange(nextValue);
              isFocusedRef.current = true;
              setIsFocused(true);
              if (domains.length > 0) {
                const nextSuggestions = filterDomains(domains, nextValue);
                setSuggestions(nextSuggestions);
                setActiveIndex(nextSuggestions.length > 0 ? 0 : -1);
                setOpen(nextSuggestions.length > 0);
              }
            }}
            onKeyDown={(e) => {
              if (!open || suggestions.length === 0) return;
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setKeyboardActive(true);
                setActiveIndex((index) => (index + 1) % suggestions.length);
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setKeyboardActive(true);
                setActiveIndex((index) => (index <= 0 ? suggestions.length - 1 : index - 1));
              } else if (e.key === "Enter" && activeIndex >= 0) {
                e.preventDefault();
                selectDomain(suggestions[activeIndex].domain);
              } else if (e.key === "Escape") {
                setOpen(false);
                setKeyboardActive(false);
              }
            }}
            onFocus={() => {
              isFocusedRef.current = true;
              setIsFocused(true);
              const nextSuggestions =
                suggestions.length > 0 ? suggestions : filterDomains(domains, inputValue);
              setSuggestions(nextSuggestions);
              setActiveIndex(nextSuggestions.length > 0 ? 0 : -1);
              setOpen(nextSuggestions.length > 0);
            }}
            onBlur={() => {
              isFocusedRef.current = false;
              setIsFocused(false);
              setTimeout(() => {
                if (!isFocusedRef.current) setOpen(false);
              }, 200);
              setKeyboardActive(false);
            }}
            placeholder={placeholder || "example.com"}
          />
        </div>
      </PopoverAnchor>
      <PopoverContent
        align="start"
        className="pointer-events-auto max-h-[min(10rem,var(--radix-popover-content-available-height))] overflow-y-auto p-0"
        onOpenAutoFocus={(e) => e.preventDefault()}
        onCloseAutoFocus={(e) => e.preventDefault()}
        style={{ width: "var(--radix-popover-trigger-width)" }}
      >
        {suggestions.map((s, index) => (
          <button
            key={s.id}
            type="button"
            className={cn(
              "flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground focus:outline-none",
              keyboardActive && index === activeIndex && "bg-accent text-accent-foreground"
            )}
            onMouseDown={(e) => e.preventDefault()}
            onMouseEnter={() => {
              setActiveIndex(index);
              setKeyboardActive(false);
            }}
            onClick={() => selectDomain(s.domain)}
          >
            <span className="flex-1 truncate">{s.domain}</span>
            <DnsStatusBadge status={s.dnsStatus} />
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}
