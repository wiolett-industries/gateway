import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type {
  DatabaseConnection,
  DatabaseType,
  PostgresDatabaseConfig,
  RedisDatabaseConfig,
} from "@/types";

export interface DatabaseConnectionDraft {
  name: string;
  description: string;
  tags: string;
  manualSizeLimitMb: string;
  type: DatabaseType;
  connectionString: string;
  host: string;
  port: string;
  database: string;
  username: string;
  password: string;
  sslEnabled: boolean;
  db: string;
  tlsEnabled: boolean;
  hasStoredPassword?: boolean;
}

export function draftFromConnection(
  connection?: DatabaseConnection | null
): DatabaseConnectionDraft {
  if (!connection) {
    return {
      name: "",
      description: "",
      tags: "",
      manualSizeLimitMb: "",
      type: "postgres",
      connectionString: "",
      host: "",
      port: "5432",
      database: "",
      username: "",
      password: "",
      sslEnabled: false,
      db: "0",
      tlsEnabled: false,
      hasStoredPassword: false,
    };
  }

  if (connection.type === "postgres") {
    const config = connection.config as PostgresDatabaseConfig;
    return {
      name: connection.name,
      description: connection.description ?? "",
      tags: connection.tags.join(", "),
      manualSizeLimitMb:
        connection.manualSizeLimitMb != null ? String(connection.manualSizeLimitMb) : "",
      type: "postgres",
      connectionString: "",
      host: config.host,
      port: String(config.port),
      database: config.database,
      username: config.username,
      password: "",
      sslEnabled: config.sslEnabled,
      db: "0",
      tlsEnabled: false,
      hasStoredPassword: connection.hasStoredPassword,
    };
  }

  const config = connection.config as RedisDatabaseConfig;
  return {
    name: connection.name,
    description: connection.description ?? "",
    tags: connection.tags.join(", "),
    manualSizeLimitMb: "",
    type: "redis",
    connectionString: "",
    host: config.host,
    port: String(config.port),
    database: "",
    username: config.username ?? "",
    password: "",
    sslEnabled: false,
    db: String(config.db),
    tlsEnabled: config.tlsEnabled,
    hasStoredPassword: connection.hasStoredPassword,
  };
}

export function buildDatabasePayload(draft: DatabaseConnectionDraft): Record<string, unknown> {
  const tags = draft.tags
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);

  if (draft.type === "postgres") {
    return {
      name: draft.name.trim(),
      description: draft.description.trim() || null,
      tags,
      manualSizeLimitMb:
        draft.manualSizeLimitMb.trim() === "" ? null : Number(draft.manualSizeLimitMb),
      type: "postgres",
      config: {
        ...(draft.connectionString.trim()
          ? { connectionString: draft.connectionString.trim() }
          : {}),
        ...(draft.host.trim() ? { host: draft.host.trim() } : {}),
        ...(draft.port.trim() ? { port: Number(draft.port) } : {}),
        ...(draft.database.trim() ? { database: draft.database.trim() } : {}),
        ...(draft.username.trim() ? { username: draft.username.trim() } : {}),
        ...(draft.password !== "" ? { password: draft.password } : {}),
        sslEnabled: draft.sslEnabled,
      },
    };
  }

  return {
    name: draft.name.trim(),
    description: draft.description.trim() || null,
    tags,
    type: "redis",
    config: {
      ...(draft.connectionString.trim() ? { connectionString: draft.connectionString.trim() } : {}),
      ...(draft.host.trim() ? { host: draft.host.trim() } : {}),
      ...(draft.port.trim() ? { port: Number(draft.port) } : {}),
      ...(draft.username.trim() ? { username: draft.username.trim() } : {}),
      ...(draft.password !== "" ? { password: draft.password } : {}),
      db: Number(draft.db || "0"),
      tlsEnabled: draft.tlsEnabled,
    },
  };
}

export function DatabaseConnectionForm({
  draft,
  onChange,
  disableType = false,
  mode = "full",
}: {
  draft: DatabaseConnectionDraft;
  onChange: (next: DatabaseConnectionDraft) => void;
  disableType?: boolean;
  mode?: "full" | "metadata";
}) {
  const set = <K extends keyof DatabaseConnectionDraft>(
    key: K,
    value: DatabaseConnectionDraft[K]
  ) => onChange({ ...draft, [key]: value });
  const metadataOnly = mode === "metadata";

  return (
    <div className="space-y-3">
      <div className={`grid gap-3 ${metadataOnly ? "md:grid-cols-1" : "md:grid-cols-2"}`}>
        <div className="space-y-1.5">
          <label className="text-sm font-medium">Name</label>
          <Input value={draft.name} onChange={(e) => set("name", e.target.value)} />
        </div>
        {!metadataOnly && (
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Type</label>
            <Select
              value={draft.type}
              onValueChange={(value) =>
                onChange({
                  ...draft,
                  type: value as DatabaseType,
                  port: value === "postgres" ? "5432" : "6379",
                })
              }
              disabled={disableType}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="postgres">Postgres</SelectItem>
                <SelectItem value="redis">Redis</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      <div className="space-y-1.5">
        <label className="text-sm font-medium">Description</label>
        <Input value={draft.description} onChange={(e) => set("description", e.target.value)} />
      </div>

      <div className="space-y-1.5">
        <label className="text-sm font-medium">Tags</label>
        <Input
          placeholder="team, red:production, green:analytics"
          value={draft.tags}
          onChange={(e) => set("tags", e.target.value)}
        />
        <p className="text-xs text-muted-foreground">
          Use color:name for colored tags. Supported colors: blue, red, green, yellow, purple, pink,
          orange, gray.
        </p>
      </div>

      {metadataOnly && draft.type === "postgres" && (
        <div className="space-y-1.5">
          <label className="text-sm font-medium">Size Limit (MB)</label>
          <Input
            type="number"
            min="1"
            step="1"
            placeholder="Optional"
            value={draft.manualSizeLimitMb}
            onChange={(e) => set("manualSizeLimitMb", e.target.value)}
          />
        </div>
      )}

      {!metadataOnly && (
        <>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Connection String</label>
            <Input
              placeholder={
                draft.type === "postgres"
                  ? "postgresql://user:password@host:5432/database"
                  : "redis://:password@host:6379/0"
              }
              value={draft.connectionString}
              onChange={(e) => set("connectionString", e.target.value)}
            />
          </div>

          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr),140px]">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Host</label>
              <Input value={draft.host} onChange={(e) => set("host", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Port</label>
              <Input value={draft.port} onChange={(e) => set("port", e.target.value)} />
            </div>
          </div>
        </>
      )}

      {draft.type === "postgres" ? (
        <>
          {!metadataOnly && (
            <>
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Database</label>
                  <Input value={draft.database} onChange={(e) => set("database", e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Username</label>
                  <Input value={draft.username} onChange={(e) => set("username", e.target.value)} />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-medium">Password</label>
                <Input
                  type="password"
                  placeholder={
                    draft.hasStoredPassword ? "Leave blank to keep current password" : ""
                  }
                  value={draft.password}
                  onChange={(e) => set("password", e.target.value)}
                />
                {draft.hasStoredPassword && draft.password === "" && (
                  <Badge variant="secondary" className="text-xs">
                    Existing password preserved
                  </Badge>
                )}
              </div>
            </>
          )}

          {!metadataOnly && (
            <div className="flex items-center justify-between gap-4 border border-border bg-card px-3 py-2.5">
              <div>
                <p className="text-sm font-medium">TLS / SSL</p>
                <p className="text-xs text-muted-foreground">
                  Require TLS for the Postgres connection
                </p>
              </div>
              <Switch
                checked={draft.sslEnabled}
                onChange={(checked) => set("sslEnabled", checked)}
              />
            </div>
          )}
        </>
      ) : (
        <>
          {!metadataOnly && (
            <>
              <div className="grid gap-3 md:grid-cols-[minmax(0,1fr),140px]">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Username</label>
                  <Input value={draft.username} onChange={(e) => set("username", e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Redis DB</label>
                  <Input value={draft.db} onChange={(e) => set("db", e.target.value)} />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-medium">Password</label>
                <Input
                  type="password"
                  placeholder={
                    draft.hasStoredPassword ? "Leave blank to keep current password" : ""
                  }
                  value={draft.password}
                  onChange={(e) => set("password", e.target.value)}
                />
                {draft.hasStoredPassword && draft.password === "" && (
                  <Badge variant="secondary" className="text-xs">
                    Existing password preserved
                  </Badge>
                )}
              </div>
            </>
          )}

          {!metadataOnly && (
            <div className="flex items-center justify-between gap-4 border border-border bg-card px-3 py-2.5">
              <div>
                <p className="text-sm font-medium">TLS</p>
                <p className="text-xs text-muted-foreground">Use TLS when connecting to Redis</p>
              </div>
              <Switch
                checked={draft.tlsEnabled}
                onChange={(checked) => set("tlsEnabled", checked)}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}
