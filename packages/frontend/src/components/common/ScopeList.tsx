import type { CA, Node, ProxyHost } from "@/types";

interface ScopeItem {
  value: string;
  label: string;
  desc: string;
  group: string;
}

interface ResourceOption {
  id: string;
  label: string;
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
  nodes?: Node[];
  proxyHosts?: ProxyHost[];
  restrictableScopes?: readonly string[];
  /** Inherited scopes from parent group — shown as read-only checked at bottom */
  inheritedScopes?: string[];
  inheritedFromName?: string;
}

function matchesQuery(scope: ScopeItem, q: string): boolean {
  return (
    scope.label.toLowerCase().includes(q) ||
    scope.value.toLowerCase().includes(q) ||
    scope.desc.toLowerCase().includes(q)
  );
}

/** Determine which resource list to show for a scope */
function getResourceOptions(
  scope: string,
  cas?: CA[],
  nodes?: Node[],
  proxyHosts?: ProxyHost[],
): ResourceOption[] {
  if (scope.startsWith("nodes:")) {
    return (nodes ?? []).map((n) => ({ id: n.id, label: n.displayName || n.hostname }));
  }
  if (scope.startsWith("proxy:")) {
    return (proxyHosts ?? []).map((p) => ({ id: p.id, label: p.domainNames[0] || p.id }));
  }
  if (scope.startsWith("pki:cert:") || scope.startsWith("pki:ca:")) {
    return (cas ?? []).map((ca) => ({ id: ca.id, label: ca.commonName }));
  }
  return (cas ?? []).map((ca) => ({ id: ca.id, label: ca.commonName }));
}

function getResourceLabel(scope: string): string {
  if (scope.startsWith("nodes:")) return "Restrict to specific nodes (leave unchecked for all):";
  if (scope.startsWith("proxy:")) return "Restrict to specific proxy hosts (leave unchecked for all):";
  return "Restrict to specific CAs (leave unchecked for all):";
}

export function ScopeList({
  scopes,
  search,
  selected,
  onToggle,
  resources,
  onToggleResource,
  cas,
  nodes,
  proxyHosts,
  restrictableScopes,
  inheritedScopes,
  inheritedFromName,
}: ScopeListProps) {
  const q = search.toLowerCase().trim();

  // Build inherited scope items that reuse the same ScopeItem shape
  const inheritedSet = new Set(inheritedScopes ?? []);
  const inheritedItems: ScopeItem[] = inheritedSet.size > 0
    ? scopes.filter((s) => inheritedSet.has(s.value))
    : [];

  // Filter out inherited scopes from the regular list
  const ownScopes = inheritedSet.size > 0 ? scopes.filter((s) => !inheritedSet.has(s.value)) : scopes;
  const categories = [...new Set(ownScopes.map((s) => s.group))];

  const inheritedSection = inheritedItems.length > 0 ? (
    <div>
      <div className="px-3 py-1.5 bg-muted sticky top-0 z-10 border-b border-border border-t">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          Inherited{inheritedFromName ? ` from ${inheritedFromName}` : ""}
        </p>
      </div>
      {inheritedItems.map((scope) => (
        <ScopeRow
          key={`inherited-${scope.value}`}
          scope={scope}
          isSelected
          onToggle={() => {}}
          muted
          disabled
          resources={resources}
          cas={cas}
          nodes={nodes}
          proxyHosts={proxyHosts}
          restrictableScopes={restrictableScopes}
        />
      ))}
    </div>
  ) : null;

  // When searching: split into matches (top) and rest (muted below)
  if (q) {
    const matches = ownScopes.filter((s) => matchesQuery(s, q));
    const rest = ownScopes.filter((s) => !matchesQuery(s, q));

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
            nodes={nodes}
            proxyHosts={proxyHosts}
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
            nodes={nodes}
            proxyHosts={proxyHosts}
            restrictableScopes={restrictableScopes}
          />
        ))}
        {inheritedSection}
      </div>
    );
  }

  // No search: render grouped by category
  return (
    <div className="max-h-[40vh] overflow-y-auto">
      {categories.map((cat) => {
        const catScopes = ownScopes.filter((s) => s.group === cat);
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
                nodes={nodes}
                proxyHosts={proxyHosts}
                restrictableScopes={restrictableScopes}
              />
            ))}
          </div>
        );
      })}
      {inheritedSection}
    </div>
  );
}

function ScopeRow({
  scope,
  isSelected,
  onToggle,
  muted,
  disabled,
  resources,
  onToggleResource,
  cas,
  nodes,
  proxyHosts,
  restrictableScopes,
}: {
  scope: ScopeItem;
  isSelected: boolean;
  onToggle: (scope: string) => void;
  muted: boolean;
  disabled?: boolean;
  resources?: Record<string, string[]>;
  onToggleResource?: (scope: string, resourceId: string) => void;
  cas?: CA[];
  nodes?: Node[];
  proxyHosts?: ProxyHost[];
  restrictableScopes?: readonly string[];
}) {
  const canRestrict = !disabled && (restrictableScopes?.includes(scope.value) ?? false);
  const selectedIds = resources?.[scope.value] || [];
  const resourceOptions = canRestrict ? getResourceOptions(scope.value, cas, nodes, proxyHosts) : [];

  return (
    <div className={muted ? "opacity-40" : undefined}>
      <label className={`flex items-center gap-3 px-3 py-2 ${disabled ? "cursor-default" : "hover:bg-accent transition-colors cursor-pointer"}`}>
        <input
          type="checkbox"
          checked={isSelected}
          onChange={() => !disabled && onToggle(scope.value)}
          disabled={disabled}
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
      {canRestrict && isSelected && resourceOptions.length > 0 && onToggleResource && (
        <div className="px-3 pb-2 pl-10">
          <p className="text-xs text-muted-foreground mb-1">{getResourceLabel(scope.value)}</p>
          {resourceOptions.map((opt) => (
            <label key={opt.id} className="flex items-center gap-2 py-0.5 text-xs cursor-pointer">
              <input
                type="checkbox"
                checked={selectedIds.includes(opt.id)}
                onChange={() => onToggleResource(scope.value, opt.id)}
                className="form-checkbox"
              />
              <span>{opt.label}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
