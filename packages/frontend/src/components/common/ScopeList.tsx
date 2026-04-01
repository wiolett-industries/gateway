import type { CA } from "@/types";

interface ScopeItem {
  value: string;
  label: string;
  desc: string;
  group: string;
}

interface ScopeListProps {
  scopes: readonly ScopeItem[];
  search: string;
  selected: string[];
  onToggle: (scope: string) => void;
  /** Resource restrictions per scope (e.g. cert:issue → [ca-id-1, ca-id-2]) */
  resources?: Record<string, string[]>;
  onToggleResource?: (scope: string, resourceId: string) => void;
  cas?: CA[];
  restrictableScopes?: readonly string[];
}

function matchesQuery(scope: ScopeItem, q: string): boolean {
  return (
    scope.label.toLowerCase().includes(q) ||
    scope.value.toLowerCase().includes(q) ||
    scope.desc.toLowerCase().includes(q)
  );
}

export function ScopeList({
  scopes,
  search,
  selected,
  onToggle,
  resources,
  onToggleResource,
  cas,
  restrictableScopes,
}: ScopeListProps) {
  const q = search.toLowerCase().trim();
  const categories = [...new Set(scopes.map((s) => s.group))];

  // When searching: split into matches (top) and rest (muted below)
  if (q) {
    const matches = scopes.filter((s) => matchesQuery(s, q));
    const rest = scopes.filter((s) => !matchesQuery(s, q));

    return (
      <div className="max-h-[40vh] overflow-y-auto">
        {matches.map((scope) => (
          <ScopeRow
            key={scope.value}
            scope={scope}
            isSelected={selected.includes(scope.value)}
            onToggle={onToggle}
            muted={false}
            resources={resources}
            onToggleResource={onToggleResource}
            cas={cas}
            restrictableScopes={restrictableScopes}
          />
        ))}
        {rest.length > 0 && matches.length > 0 && <div className="border-t border-border" />}
        {rest.map((scope) => (
          <ScopeRow
            key={scope.value}
            scope={scope}
            isSelected={selected.includes(scope.value)}
            onToggle={onToggle}
            muted
            resources={resources}
            onToggleResource={onToggleResource}
            cas={cas}
            restrictableScopes={restrictableScopes}
          />
        ))}
      </div>
    );
  }

  // No search: render grouped by category
  return (
    <div className="max-h-[40vh] overflow-y-auto">
      {categories.map((cat) => {
        const catScopes = scopes.filter((s) => s.group === cat);
        if (catScopes.length === 0) return null;
        return (
          <div key={cat}>
            <div className="px-3 py-1.5 bg-muted sticky top-0 z-10 border-b border-border">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                {cat}
              </p>
            </div>
            {catScopes.map((scope) => (
              <ScopeRow
                key={scope.value}
                scope={scope}
                isSelected={selected.includes(scope.value)}
                onToggle={onToggle}
                muted={false}
                resources={resources}
                onToggleResource={onToggleResource}
                cas={cas}
                restrictableScopes={restrictableScopes}
              />
            ))}
          </div>
        );
      })}
    </div>
  );
}

function ScopeRow({
  scope,
  isSelected,
  onToggle,
  muted,
  resources,
  onToggleResource,
  cas,
  restrictableScopes,
}: {
  scope: ScopeItem;
  isSelected: boolean;
  onToggle: (scope: string) => void;
  muted: boolean;
  resources?: Record<string, string[]>;
  onToggleResource?: (scope: string, resourceId: string) => void;
  cas?: CA[];
  restrictableScopes?: readonly string[];
}) {
  const canLimitToCA = restrictableScopes?.includes(scope.value) ?? false;
  const selectedCAs = resources?.[scope.value] || [];

  return (
    <div className={muted ? "opacity-40" : undefined}>
      <label className="flex items-center gap-3 px-3 py-2 hover:bg-accent transition-colors cursor-pointer">
        <input
          type="checkbox"
          checked={isSelected}
          onChange={() => onToggle(scope.value)}
          className="form-checkbox"
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2">
            <p className="text-sm">{scope.label}</p>
            <p className="text-[10px] text-muted-foreground font-mono">{scope.value}</p>
          </div>
          <p className="text-xs text-muted-foreground">{scope.desc}</p>
        </div>
      </label>
      {canLimitToCA && isSelected && (cas || []).length > 0 && onToggleResource && (
        <div className="px-3 pb-2 pl-10">
          <p className="text-xs text-muted-foreground mb-1">
            Restrict to specific CAs (leave unchecked for all):
          </p>
          {(cas || []).map((ca) => (
            <label key={ca.id} className="flex items-center gap-2 py-0.5 text-xs cursor-pointer">
              <input
                type="checkbox"
                checked={selectedCAs.includes(ca.id)}
                onChange={() => onToggleResource(scope.value, ca.id)}
                className="form-checkbox"
              />
              <span>{ca.commonName}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
