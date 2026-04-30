import {
  ArrowLeft,
  Database,
  EllipsisVertical,
  FileJson,
  Plus,
  Save,
  ScrollText,
  Settings,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { confirm } from "@/components/common/ConfirmDialog";
import { EmptyState } from "@/components/common/EmptyState";
import { PageTransition } from "@/components/common/PageTransition";
import { ResponsiveHeaderActions } from "@/components/common/ResponsiveHeaderActions";
import { SearchFilterBar } from "@/components/common/SearchFilterBar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { RefreshButton } from "@/components/ui/refresh-button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn, formatBytes } from "@/lib/utils";
import { api } from "@/services/api";
import { useAuthStore } from "@/stores/auth";
import type {
  LoggingEnvironment,
  LoggingFeatureStatus,
  LoggingSchema,
  LoggingSchemaMode,
} from "@/types";
import { LoggingEnvironmentDialog } from "./logging/LoggingEnvironmentDialog";
import { LoggingExplorer } from "./logging/LoggingExplorer";
import { LoggingSchemaEditor } from "./logging/LoggingSchemaEditor";
import { LoggingTokenPanel } from "./logging/LoggingTokenPanel";

const TOP_TABS = [
  { value: "environments", label: "Environments", icon: Database },
  { value: "schemas", label: "Schemas", icon: FileJson },
  { value: "settings", label: "Settings", icon: Settings },
] as const;

const ENV_TABS = ["logs", "tokens", "settings"] as const;

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizedNullableNumber(value: number | null | undefined) {
  return value ?? null;
}

function isLoggingEnvironmentSettingsDirty(
  environment: LoggingEnvironment,
  draft: Partial<LoggingEnvironment>
) {
  return (
    (draft.schemaId ?? null) !== environment.schemaId ||
    (draft.enabled ?? environment.enabled) !== environment.enabled ||
    (draft.retentionDays ?? environment.retentionDays) !== environment.retentionDays ||
    normalizedNullableNumber(draft.rateLimitRequestsPerWindow) !==
      normalizedNullableNumber(environment.rateLimitRequestsPerWindow) ||
    normalizedNullableNumber(draft.rateLimitEventsPerWindow) !==
      normalizedNullableNumber(environment.rateLimitEventsPerWindow)
  );
}

function isLoggingSchemaDirty(schema: LoggingSchema, draft: Partial<LoggingSchema>) {
  return (
    (draft.name ?? "") !== schema.name ||
    (draft.slug ?? "") !== schema.slug ||
    (draft.description ?? null) !== schema.description ||
    (draft.schemaMode ?? schema.schemaMode) !== schema.schemaMode ||
    JSON.stringify(draft.fieldSchema ?? schema.fieldSchema) !== JSON.stringify(schema.fieldSchema)
  );
}

export function Logging() {
  const { section, id, tab } = useParams<{ section?: string; id?: string; tab?: string }>();
  const navigate = useNavigate();
  const { user, hasAnyScope } = useAuthStore();
  const [status, setStatus] = useState<LoggingFeatureStatus | null>(null);
  const [environments, setEnvironments] = useState<LoggingEnvironment[]>([]);
  const [schemas, setSchemas] = useState<LoggingSchema[]>([]);
  const [environmentSearch, setEnvironmentSearch] = useState("");
  const [schemaSearch, setSchemaSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [environmentDialogOpen, setEnvironmentDialogOpen] = useState(false);
  const [schemaDialogOpen, setSchemaDialogOpen] = useState(false);

  const isEnvironmentDetail = section === "environments" && !!id;
  const isSchemaDetail = section === "schemas" && !!id;
  const canAccessEnvironments = hasAnyScope(
    "logs:environments:list",
    "logs:environments:view",
    "logs:read",
    "logs:manage"
  );
  const hasResourceScopedSchemaView = useMemo(
    () => user?.scopes.some((scope) => scope.startsWith("logs:schemas:view:")) ?? false,
    [user?.scopes]
  );
  const canListSchemas =
    hasAnyScope("logs:schemas:list", "logs:manage") || hasResourceScopedSchemaView;
  const canAccessSchemas = canListSchemas || hasAnyScope("logs:schemas:create");
  const canViewSchemaDetails = hasAnyScope("logs:schemas:list", "logs:schemas:view", "logs:manage");
  const canViewSelectedSchema =
    isSchemaDetail &&
    !!id &&
    hasAnyScope("logs:schemas:view", `logs:schemas:view:${id}`, "logs:manage");
  const canAccessLoggingSettings = canAccessEnvironments || canAccessSchemas;
  const visibleTopTabs = useMemo(
    () =>
      TOP_TABS.filter((item) => {
        if (item.value === "environments") return canAccessEnvironments;
        if (item.value === "schemas") return canAccessSchemas;
        return canAccessLoggingSettings;
      }),
    [canAccessEnvironments, canAccessLoggingSettings, canAccessSchemas]
  );
  const defaultTopTab = canAccessEnvironments
    ? "environments"
    : canAccessSchemas
      ? "schemas"
      : "settings";
  const requestedTopTab =
    TOP_TABS.some((item) => item.value === section) && !isEnvironmentDetail && !isSchemaDetail
      ? section!
      : defaultTopTab;
  const topTab = visibleTopTabs.some((item) => item.value === requestedTopTab)
    ? requestedTopTab
    : defaultTopTab;
  const activeEnvironmentTab = ENV_TABS.includes(tab as any) ? tab! : "logs";
  const selectedEnvironment = environments.find((environment) => environment.id === id) ?? null;
  const selectedSchema = schemas.find((schema) => schema.id === id) ?? null;

  const canCreateEnvironment = hasAnyScope("logs:environments:create", "logs:manage");
  const canCreateSchema = hasAnyScope("logs:schemas:create", "logs:manage");
  const canEditEnvironment =
    !!selectedEnvironment &&
    hasAnyScope(
      "logs:environments:edit",
      `logs:environments:edit:${selectedEnvironment.id}`,
      "logs:manage"
    );
  const canDeleteEnvironment =
    !!selectedEnvironment &&
    hasAnyScope(
      "logs:environments:delete",
      `logs:environments:delete:${selectedEnvironment.id}`,
      "logs:manage"
    );
  const canCreateToken =
    !!selectedEnvironment &&
    hasAnyScope(
      "logs:tokens:create",
      `logs:tokens:create:${selectedEnvironment.id}`,
      "logs:manage"
    );
  const canDeleteToken =
    !!selectedEnvironment &&
    hasAnyScope(
      "logs:tokens:delete",
      `logs:tokens:delete:${selectedEnvironment.id}`,
      "logs:manage"
    );
  const canEditSchema =
    !!selectedSchema &&
    hasAnyScope("logs:schemas:edit", `logs:schemas:edit:${selectedSchema.id}`, "logs:manage");
  const canDeleteSchema =
    !!selectedSchema &&
    hasAnyScope("logs:schemas:delete", `logs:schemas:delete:${selectedSchema.id}`, "logs:manage");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [featureStatus, environmentList, schemaList] = await Promise.all([
        api.getLoggingStatus(),
        canAccessEnvironments ? api.listLoggingEnvironments() : Promise.resolve([]),
        canListSchemas
          ? api.listLoggingSchemas()
          : canViewSelectedSchema
            ? api.getLoggingSchema(id).then((schema) => [schema])
            : Promise.resolve([]),
      ]);
      setStatus(featureStatus);
      setEnvironments(environmentList);
      setSchemas(schemaList);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to load logging");
    } finally {
      setLoading(false);
    }
  }, [canAccessEnvironments, canListSchemas, canViewSelectedSchema, id]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (section && !TOP_TABS.some((item) => item.value === section)) {
      navigate(`/logging/environments/${section}/${id ?? "logs"}`, { replace: true });
    }
  }, [id, navigate, section]);

  const filteredEnvironments = useMemo(() => {
    const needle = environmentSearch.trim().toLowerCase();
    if (!needle) return environments;
    return environments.filter(
      (environment) =>
        environment.name.toLowerCase().includes(needle) ||
        environment.slug.toLowerCase().includes(needle) ||
        (environment.schemaName ?? "").toLowerCase().includes(needle)
    );
  }, [environments, environmentSearch]);

  const filteredSchemas = useMemo(() => {
    const needle = schemaSearch.trim().toLowerCase();
    if (!needle) return schemas;
    return schemas.filter(
      (schema) =>
        schema.name.toLowerCase().includes(needle) || schema.slug.toLowerCase().includes(needle)
    );
  }, [schemaSearch, schemas]);

  const createEnvironment = async (data: Partial<LoggingEnvironment>) => {
    const created = await api.createLoggingEnvironment({
      ...data,
      schemaId: data.schemaId ?? null,
      schemaMode: data.schemaId ? "reject" : "loose",
      fieldSchema: [],
      retentionDays: data.retentionDays ?? 30,
    });
    toast.success("Logging environment created");
    await load();
    navigate(`/logging/environments/${created.id}/logs`);
  };

  const updateEnvironment = async (environmentId: string, patch: Partial<LoggingEnvironment>) => {
    const updated = await api.updateLoggingEnvironment(environmentId, patch);
    setEnvironments((current) =>
      current.map((environment) => (environment.id === updated.id ? updated : environment))
    );
  };

  const createSchema = async (data: Partial<LoggingSchema>) => {
    const created = await api.createLoggingSchema(data);
    setSchemas((current) => [...current, created].sort((a, b) => a.name.localeCompare(b.name)));
    toast.success("Logging schema created");
    if (hasAnyScope("logs:schemas:view", `logs:schemas:view:${created.id}`, "logs:manage")) {
      navigate(`/logging/schemas/${created.id}`);
    } else {
      navigate("/logging/schemas");
    }
  };

  const updateSchema = async (schemaId: string, data: Partial<LoggingSchema>) => {
    const updated = await api.updateLoggingSchema(schemaId, data);
    setSchemas((current) => current.map((schema) => (schema.id === updated.id ? updated : schema)));
    toast.success("Logging schema updated");
  };

  const deleteSchema = async (schema: LoggingSchema) => {
    if (
      !(await confirm({
        title: "Delete logging schema",
        description: `Delete ${schema.name}? Environments using it will keep running without an attached schema.`,
        confirmLabel: "Delete",
        variant: "destructive",
      }))
    ) {
      return false;
    }
    await api.deleteLoggingSchema(schema.id);
    toast.success("Logging schema deleted");
    await load();
    return true;
  };

  if (isEnvironmentDetail) {
    return (
      <LoggingEnvironmentDetail
        environment={selectedEnvironment}
        schemas={schemas}
        status={status}
        loading={loading}
        activeTab={activeEnvironmentTab as (typeof ENV_TABS)[number]}
        canEdit={canEditEnvironment}
        canDelete={canDeleteEnvironment}
        canCreateToken={canCreateToken}
        canDeleteToken={canDeleteToken}
        onUpdate={updateEnvironment}
        onDelete={async (environment) => {
          await api.deleteLoggingEnvironment(environment.id);
          toast.success("Logging environment deleted");
          await load();
          navigate("/logging/environments", { replace: true });
        }}
      />
    );
  }

  if (isSchemaDetail) {
    return (
      <LoggingSchemaDetail
        schema={selectedSchema}
        loading={loading}
        canEdit={canEditSchema}
        canDelete={canDeleteSchema}
        onSave={(patch) => updateSchema(id!, patch)}
        onDelete={async (schema) => {
          const deleted = await deleteSchema(schema);
          if (deleted) navigate("/logging/schemas", { replace: true });
          return deleted;
        }}
      />
    );
  }

  const activeTabLoading = loading;

  return (
    <PageTransition>
      <div className={cn("h-full overflow-y-auto p-6 space-y-4", topTab === "schemas" && "pb-3")}>
        <div className="flex shrink-0 items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-bold">Logging</h1>
            <p className="text-sm text-muted-foreground">
              Manage external log environments and reusable schemas
            </p>
          </div>
          <ResponsiveHeaderActions
            actions={[
              { label: "Refresh", onClick: load, disabled: activeTabLoading },
              ...(topTab === "environments" && canCreateEnvironment
                ? [
                    {
                      label: "Create Environment",
                      icon: <Plus className="h-4 w-4" />,
                      onClick: () => setEnvironmentDialogOpen(true),
                    },
                  ]
                : []),
              ...(topTab === "schemas" && canCreateSchema
                ? [
                    {
                      label: "Create Schema",
                      icon: <Plus className="h-4 w-4" />,
                      onClick: () => setSchemaDialogOpen(true),
                    },
                  ]
                : []),
            ]}
          >
            <RefreshButton onClick={load} disabled={activeTabLoading} />
            {topTab === "environments" && canCreateEnvironment && (
              <Button onClick={() => setEnvironmentDialogOpen(true)}>
                <Plus className="h-4 w-4 mr-1" />
                Create Environment
              </Button>
            )}
            {topTab === "schemas" && canCreateSchema && (
              <Button onClick={() => setSchemaDialogOpen(true)}>
                <Plus className="h-4 w-4 mr-1" />
                Create Schema
              </Button>
            )}
          </ResponsiveHeaderActions>
        </div>

        <Tabs
          value={topTab}
          onValueChange={(value) => navigate(`/logging/${value}`, { replace: true })}
          className="flex flex-col"
        >
          <TabsList className="shrink-0">
            {visibleTopTabs.map((item) => (
              <TabsTrigger key={item.value} value={item.value} className="gap-1.5">
                <item.icon className="h-3.5 w-3.5" />
                {item.label}
              </TabsTrigger>
            ))}
          </TabsList>

          <TabsContent value="environments">
            <LoggingEnvironmentsTab
              environments={filteredEnvironments}
              search={environmentSearch}
              loading={loading}
              canCreate={canCreateEnvironment}
              onSearchChange={setEnvironmentSearch}
              onCreate={() => setEnvironmentDialogOpen(true)}
              onOpen={(environment) => navigate(`/logging/environments/${environment.id}/logs`)}
            />
          </TabsContent>

          <TabsContent value="schemas">
            <LoggingSchemasTab
              schemas={filteredSchemas}
              search={schemaSearch}
              loading={loading}
              canCreate={canCreateSchema}
              canEdit={(schema) =>
                hasAnyScope("logs:schemas:edit", `logs:schemas:edit:${schema.id}`, "logs:manage")
              }
              canDelete={(schema) =>
                hasAnyScope(
                  "logs:schemas:delete",
                  `logs:schemas:delete:${schema.id}`,
                  "logs:manage"
                )
              }
              canOpen={(schema) =>
                canViewSchemaDetails || hasAnyScope(`logs:schemas:view:${schema.id}`)
              }
              onSearchChange={setSchemaSearch}
              onCreate={() => {
                setSchemaDialogOpen(true);
              }}
              onOpen={(schema) => navigate(`/logging/schemas/${schema.id}`)}
              onDelete={deleteSchema}
            />
          </TabsContent>

          <TabsContent value="settings">
            <LoggingGlobalSettings
              status={status}
              environmentCount={environments.length}
              schemaCount={schemas.length}
            />
          </TabsContent>
        </Tabs>

        <LoggingEnvironmentDialog
          open={environmentDialogOpen}
          environment={null}
          onOpenChange={setEnvironmentDialogOpen}
          onSave={createEnvironment}
        />
        <LoggingSchemaDialog
          open={schemaDialogOpen}
          onOpenChange={setSchemaDialogOpen}
          onSave={createSchema}
        />
      </div>
    </PageTransition>
  );
}

function LoggingEnvironmentsTab({
  environments,
  search,
  loading,
  canCreate,
  onSearchChange,
  onCreate,
  onOpen,
}: {
  environments: LoggingEnvironment[];
  search: string;
  loading: boolean;
  canCreate: boolean;
  onSearchChange: (value: string) => void;
  onCreate: () => void;
  onOpen: (environment: LoggingEnvironment) => void;
}) {
  return (
    <div className="space-y-4">
      <SearchFilterBar
        placeholder="Search environments..."
        search={search}
        onSearchChange={onSearchChange}
        hasActiveFilters={search !== ""}
        onReset={() => onSearchChange("")}
      />

      {loading ? (
        <div className="border border-border bg-card p-8 text-sm text-muted-foreground">
          Loading logging environments...
        </div>
      ) : environments.length === 0 ? (
        <EmptyState
          message="No logging environments. Create an environment to receive logs from an external service."
          {...(canCreate ? { actionLabel: "Create Environment", onAction: onCreate } : {})}
        />
      ) : (
        <div className="overflow-x-auto border border-border rounded-lg bg-card md:overflow-x-visible">
          <div className="min-w-[920px] divide-y divide-border -mb-px md:min-w-0 [&>*:last-child]:border-b [&>*:last-child]:border-border">
            {environments.map((environment) => (
              <div
                key={environment.id}
                className="flex items-center gap-4 p-4 transition-colors cursor-pointer hover:bg-muted/50"
                onClick={() => onOpen(environment)}
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted">
                  <ScrollText className="h-5 w-5 text-muted-foreground" />
                </div>
                <div className="min-w-[320px] flex-1 md:min-w-0">
                  <p className="truncate text-sm font-medium">{environment.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {environment.slug}
                    {environment.description ? ` · ${environment.description}` : ""}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Badge variant="outline" className="text-xs shrink-0">
                    {environment.schemaName ?? "No schema"}
                  </Badge>
                  <Badge variant="secondary" className="text-xs uppercase shrink-0">
                    {environment.schemaMode}
                  </Badge>
                  <Badge variant="outline" className="text-xs shrink-0">
                    {environment.retentionDays}d
                  </Badge>
                  <Badge
                    variant={environment.enabled ? "success" : "secondary"}
                    className="text-xs uppercase shrink-0"
                  >
                    {environment.enabled ? "Enabled" : "Disabled"}
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function LoggingSchemasTab({
  schemas,
  search,
  loading,
  canCreate,
  canEdit,
  canDelete,
  canOpen,
  onSearchChange,
  onCreate,
  onOpen,
  onDelete,
}: {
  schemas: LoggingSchema[];
  search: string;
  loading: boolean;
  canCreate: boolean;
  canEdit: (schema: LoggingSchema) => boolean;
  canDelete: (schema: LoggingSchema) => boolean;
  canOpen: (schema: LoggingSchema) => boolean;
  onSearchChange: (value: string) => void;
  onCreate: () => void;
  onOpen: (schema: LoggingSchema) => void;
  onDelete: (schema: LoggingSchema) => Promise<boolean>;
}) {
  return (
    <div className="space-y-4">
      <SearchFilterBar
        placeholder="Search schemas..."
        search={search}
        onSearchChange={onSearchChange}
        hasActiveFilters={search !== ""}
        onReset={() => onSearchChange("")}
      />

      {loading ? (
        <div className="border border-border bg-card p-8 text-sm text-muted-foreground">
          Loading logging schemas...
        </div>
      ) : schemas.length === 0 ? (
        <EmptyState
          message="No logging schemas. Create a reusable schema and attach it to environments."
          {...(canCreate ? { actionLabel: "Create Schema", onAction: onCreate } : {})}
        />
      ) : (
        <div className="overflow-x-auto border border-border rounded-lg bg-card md:overflow-x-visible">
          <div className="min-w-[920px] divide-y divide-border -mb-px md:min-w-0 [&>*:last-child]:border-b [&>*:last-child]:border-border">
            {schemas.map((schema) => (
              <div
                key={schema.id}
                className={cn(
                  "flex items-center gap-4 p-4 transition-colors",
                  canOpen(schema) && "cursor-pointer hover:bg-muted/50"
                )}
                onClick={canOpen(schema) ? () => onOpen(schema) : undefined}
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted">
                  <FileJson className="h-5 w-5 text-muted-foreground" />
                </div>
                <div className="min-w-[320px] flex-1 md:min-w-0">
                  <p className="truncate text-sm font-medium">{schema.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {schema.slug}
                    {schema.description ? ` · ${schema.description}` : ""}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Badge variant="secondary" className="text-xs uppercase shrink-0">
                    {schema.schemaMode}
                  </Badge>
                  <Badge variant="outline" className="text-xs shrink-0">
                    {schema.fieldSchema.length} fields
                  </Badge>
                  <Badge variant="outline" className="text-xs shrink-0">
                    {new Date(schema.updatedAt).toLocaleDateString()}
                  </Badge>
                  {(canEdit(schema) || canDelete(schema)) && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="outline"
                          size="icon"
                          onClick={(event) => event.stopPropagation()}
                        >
                          <EllipsisVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {canEdit(schema) && (
                          <DropdownMenuItem
                            onClick={(event) => {
                              event.stopPropagation();
                              onOpen(schema);
                            }}
                          >
                            <Settings className="h-3.5 w-3.5 mr-2" />
                            Edit
                          </DropdownMenuItem>
                        )}
                        {canEdit(schema) && canDelete(schema) && <DropdownMenuSeparator />}
                        {canDelete(schema) && (
                          <DropdownMenuItem
                            onClick={(event) => {
                              event.stopPropagation();
                              void onDelete(schema);
                            }}
                            className="text-destructive"
                          >
                            <Trash2 className="h-3.5 w-3.5 mr-2" />
                            Delete
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function LoggingSchemaDetail({
  schema,
  loading,
  canEdit,
  canDelete,
  onSave,
  onDelete,
}: {
  schema: LoggingSchema | null;
  loading: boolean;
  canEdit: boolean;
  canDelete: boolean;
  onSave: (patch: Partial<LoggingSchema>) => Promise<void>;
  onDelete: (schema: LoggingSchema) => Promise<boolean>;
}) {
  const navigate = useNavigate();
  const [draft, setDraft] = useState<Partial<LoggingSchema>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!schema) return;
    setDraft({
      name: schema.name,
      slug: schema.slug,
      description: schema.description,
      schemaMode: schema.schemaMode,
      fieldSchema: schema.fieldSchema,
    });
  }, [schema]);

  if (loading || !schema) {
    return (
      <PageTransition>
        <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
          {loading ? "Loading logging schema..." : "Logging schema not found."}
        </div>
      </PageTransition>
    );
  }

  const save = async () => {
    setSaving(true);
    try {
      await onSave(draft);
    } finally {
      setSaving(false);
    }
  };
  const dirty = isLoggingSchemaDirty(schema, draft);

  return (
    <PageTransition>
      <div className="h-full overflow-y-auto p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => navigate("/logging/schemas")}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="truncate text-2xl font-bold">{schema.name}</h1>
                <Badge variant="secondary" className="uppercase">
                  {draft.schemaMode ?? schema.schemaMode}
                </Badge>
                <Badge variant="outline">
                  {(draft.fieldSchema ?? schema.fieldSchema).length} fields
                </Badge>
              </div>
              <p className="truncate text-sm text-muted-foreground">
                {schema.slug} · Updated {new Date(schema.updatedAt).toLocaleString()}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {canEdit && (
              <Button disabled={saving || !dirty} onClick={() => void save()}>
                <Save className="h-4 w-4" />
                {saving ? "Saving..." : "Save Changes"}
              </Button>
            )}
            {canDelete && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="icon">
                    <EllipsisVertical className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    onClick={() => void onDelete(schema)}
                    className="text-destructive"
                  >
                    <Trash2 className="h-3.5 w-3.5 mr-2" />
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <SettingsPanel title="Metadata" description="Reusable schema identity">
            <SettingsTextRow
              label="Name"
              description="Display name used in schema lists"
              value={draft.name ?? ""}
              disabled={!canEdit}
              onChange={(name) => setDraft({ ...draft, name })}
            />
            <SettingsTextRow
              label="Slug"
              description="Stable lowercase identifier"
              value={draft.slug ?? ""}
              disabled={!canEdit}
              onChange={(slug) => setDraft({ ...draft, slug: slugify(slug) })}
            />
            <SettingsTextRow
              label="Description"
              description="Optional operator-facing note"
              value={draft.description ?? ""}
              disabled={!canEdit}
              onChange={(description) => setDraft({ ...draft, description })}
            />
          </SettingsPanel>

          <SettingsPanel title="Behavior" description="Validation mode for attached environments">
            <div className="flex items-center justify-between gap-4 px-4 py-3">
              <div>
                <p className="text-sm font-medium">Mode</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Unknown labels and fields are handled during ingest
                </p>
              </div>
              <Select
                disabled={!canEdit}
                value={draft.schemaMode ?? schema.schemaMode}
                onValueChange={(schemaMode) =>
                  setDraft({ ...draft, schemaMode: schemaMode as LoggingSchemaMode })
                }
              >
                <SelectTrigger className="w-[180px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="reject">Reject</SelectItem>
                  <SelectItem value="strip">Strip</SelectItem>
                  <SelectItem value="loose">Loose</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </SettingsPanel>
        </div>

        <LoggingSchemaEditor
          schema={{
            schemaMode: draft.schemaMode ?? schema.schemaMode,
            fieldSchema: draft.fieldSchema ?? schema.fieldSchema,
          }}
          canEdit={canEdit}
          onSave={async (patch) => setDraft((current) => ({ ...current, ...patch }))}
        />
      </div>
    </PageTransition>
  );
}

function LoggingEnvironmentDetail({
  environment,
  schemas,
  status,
  loading,
  activeTab,
  canEdit,
  canDelete,
  canCreateToken,
  canDeleteToken,
  onUpdate,
  onDelete,
}: {
  environment: LoggingEnvironment | null;
  schemas: LoggingSchema[];
  status: LoggingFeatureStatus | null;
  loading: boolean;
  activeTab: (typeof ENV_TABS)[number];
  canEdit: boolean;
  canDelete: boolean;
  canCreateToken: boolean;
  canDeleteToken: boolean;
  onUpdate: (environmentId: string, patch: Partial<LoggingEnvironment>) => Promise<void>;
  onDelete: (environment: LoggingEnvironment) => Promise<void>;
}) {
  const navigate = useNavigate();
  const [settingsDraft, setSettingsDraft] = useState<Partial<LoggingEnvironment>>({});
  const [logsRefreshKey, setLogsRefreshKey] = useState(0);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [tokenDialogOpen, setTokenDialogOpen] = useState(false);

  useEffect(() => {
    if (!environment) return;
    setSettingsDraft(environment);
  }, [environment]);

  if (loading || !environment) {
    return (
      <PageTransition>
        <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
          {loading ? "Loading logging environment..." : "Logging environment not found."}
        </div>
      </PageTransition>
    );
  }

  const isFullHeightTab = activeTab === "logs";
  const settingsDirty = isLoggingEnvironmentSettingsDirty(environment, settingsDraft);
  const saveSettings = async () => {
    setSettingsSaving(true);
    try {
      await onUpdate(environment.id, settingsDraft);
      toast.success("Environment settings saved");
    } finally {
      setSettingsSaving(false);
    }
  };

  return (
    <PageTransition>
      <div
        className={
          isFullHeightTab
            ? "h-full flex flex-col overflow-hidden gap-4 p-6"
            : "h-full overflow-y-auto p-6 space-y-4"
        }
      >
        <div className="flex flex-wrap items-center justify-between gap-2 shrink-0">
          <div className="flex min-w-0 items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => navigate("/logging/environments")}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="truncate text-2xl font-bold">{environment.name}</h1>
                <Badge variant={environment.enabled ? "success" : "secondary"}>
                  {environment.enabled ? "Enabled" : "Disabled"}
                </Badge>
                <Badge variant="secondary">{environment.schemaMode}</Badge>
              </div>
              <p className="truncate text-sm text-muted-foreground">
                {environment.slug} · {environment.schemaName ?? "No schema attached"} ·{" "}
                {environment.retentionDays}d retention
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {activeTab === "logs" && (
              <RefreshButton
                onClick={() => setLogsRefreshKey((current) => current + 1)}
                disabled={status?.available !== true}
                minDurationMs={1000}
              />
            )}
            {activeTab === "tokens" && canCreateToken && (
              <Button onClick={() => setTokenDialogOpen(true)}>
                <Plus className="h-4 w-4" />
                New Token
              </Button>
            )}
            {activeTab === "settings" && canEdit && (
              <Button
                disabled={!settingsDirty || settingsSaving}
                onClick={() => void saveSettings()}
              >
                <Save className="h-4 w-4" />
                {settingsSaving ? "Saving..." : "Save Changes"}
              </Button>
            )}
            {activeTab === "settings" && canDelete && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="icon">
                    <EllipsisVertical className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    onClick={() => void onDelete(environment)}
                    className="text-destructive"
                  >
                    <Trash2 className="h-3.5 w-3.5 mr-2" />
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </div>

        <Tabs
          value={activeTab}
          onValueChange={(value) => navigate(`/logging/environments/${environment.id}/${value}`)}
          className={cn("flex flex-col", isFullHeightTab && "flex-1 min-h-0")}
        >
          <TabsList className="shrink-0">
            <TabsTrigger value="logs">Logs</TabsTrigger>
            <TabsTrigger value="tokens">Tokens</TabsTrigger>
            <TabsTrigger value="settings">
              <Settings className="mr-1 h-3.5 w-3.5" />
              Settings
            </TabsTrigger>
          </TabsList>
          <TabsContent value="logs" className="flex flex-col flex-1 min-h-0">
            <LoggingExplorer
              environment={environment}
              storageAvailable={status?.available === true}
              refreshKey={logsRefreshKey}
            />
          </TabsContent>
          <TabsContent value="tokens">
            <LoggingTokenPanel
              environment={environment}
              canDelete={canDeleteToken}
              createDialogOpen={tokenDialogOpen}
              onCreateDialogOpenChange={setTokenDialogOpen}
            />
          </TabsContent>
          <TabsContent value="settings">
            <LoggingEnvironmentSettings
              environment={environment}
              schemas={schemas}
              canEdit={canEdit}
              draft={settingsDraft}
              onDraftChange={setSettingsDraft}
            />
          </TabsContent>
        </Tabs>
      </div>
    </PageTransition>
  );
}

function LoggingEnvironmentSettings({
  environment,
  schemas,
  canEdit,
  draft,
  onDraftChange,
}: {
  environment: LoggingEnvironment;
  schemas: LoggingSchema[];
  canEdit: boolean;
  draft: Partial<LoggingEnvironment>;
  onDraftChange: (draft: Partial<LoggingEnvironment>) => void;
}) {
  const selectedSchemaId = draft.schemaId === undefined ? environment.schemaId : draft.schemaId;
  const selectedSchema = schemas.find((schema) => schema.id === selectedSchemaId) ?? null;
  const effectiveSchemaMode = selectedSchema?.schemaMode ?? "loose";

  return (
    <div className="space-y-6 pb-6">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <SettingsPanel
          title="Schema"
          description="Reusable validation attached to this environment"
        >
          <div className="flex items-center justify-between gap-4 px-4 py-3">
            <div>
              <p className="text-sm font-medium">Attached schema</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Reusable labels, fields, and schema mode
              </p>
            </div>
            <Select
              disabled={!canEdit}
              value={draft.schemaId ?? "none"}
              onValueChange={(schemaId) =>
                onDraftChange({ ...draft, schemaId: schemaId === "none" ? null : schemaId })
              }
            >
              <SelectTrigger className="w-[240px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No schema</SelectItem>
                {schemas.map((schema) => (
                  <SelectItem key={schema.id} value={schema.id}>
                    {schema.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center justify-between gap-4 px-4 py-3">
            <div>
              <p className="text-sm font-medium">Mode</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Effective unknown-field behavior for this environment
              </p>
            </div>
            <Badge variant="secondary" className="uppercase">
              {effectiveSchemaMode}
            </Badge>
          </div>
          <div className="flex items-center justify-between gap-4 px-4 py-3">
            <div>
              <p className="text-sm font-medium">Enabled</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Disabled environments reject ingest tokens and hide new writes
              </p>
            </div>
            <Switch
              disabled={!canEdit}
              checked={draft.enabled ?? environment.enabled}
              onChange={(enabled: boolean) => onDraftChange({ ...draft, enabled })}
            />
          </div>
        </SettingsPanel>

        <SettingsPanel title="Ingest" description="Environment-specific retention and throttles">
          <SettingsNumberRow
            label="Retention days"
            description="Stored per event and enforced by ClickHouse TTL"
            value={draft.retentionDays ?? environment.retentionDays}
            min={1}
            max={365}
            disabled={!canEdit}
            onChange={(retentionDays) =>
              onDraftChange({
                ...draft,
                retentionDays: retentionDays ?? environment.retentionDays,
              })
            }
          />
          <SettingsNumberRow
            label="Request limit"
            description="Per-window request limit for this environment"
            value={draft.rateLimitRequestsPerWindow ?? ""}
            min={1}
            disabled={!canEdit}
            onChange={(rateLimitRequestsPerWindow) =>
              onDraftChange({ ...draft, rateLimitRequestsPerWindow })
            }
          />
          <SettingsNumberRow
            label="Event limit"
            description="Per-window event limit for this environment"
            value={draft.rateLimitEventsPerWindow ?? ""}
            min={1}
            disabled={!canEdit}
            onChange={(rateLimitEventsPerWindow) =>
              onDraftChange({ ...draft, rateLimitEventsPerWindow })
            }
          />
        </SettingsPanel>
      </div>
    </div>
  );
}

function SettingsPanel({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="border border-border bg-card overflow-hidden">
      <div className="border-b border-border px-4 py-3">
        <h3 className="text-sm font-semibold">{title}</h3>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <div className="divide-y divide-border -mb-px [&>*:last-child]:border-b [&>*:last-child]:border-border">
        {children}
      </div>
    </div>
  );
}

function SettingsTextRow({
  label,
  description,
  value,
  disabled,
  onChange,
}: {
  label: string;
  description: string;
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3">
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
      </div>
      <Input
        className="w-[260px]"
        disabled={disabled}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

function SettingsNumberRow({
  label,
  description,
  value,
  min,
  max,
  disabled,
  onChange,
}: {
  label: string;
  description: string;
  value: number | "";
  min?: number;
  max?: number;
  disabled?: boolean;
  onChange: (value: number | null) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3">
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
      </div>
      <Input
        className="w-[180px]"
        type="number"
        min={min}
        max={max}
        disabled={disabled}
        value={value}
        onChange={(event) => onChange(event.target.value ? Number(event.target.value) : null)}
      />
    </div>
  );
}

function SettingsValueRow({
  label,
  description,
  value,
}: {
  label: string;
  description: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3">
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
      </div>
      <div className="text-right text-sm text-muted-foreground">{value}</div>
    </div>
  );
}

function LoggingGlobalSettings({
  status,
  environmentCount,
  schemaCount,
}: {
  status: LoggingFeatureStatus | null;
  environmentCount: number;
  schemaCount: number;
}) {
  const config = status?.config;

  return (
    <div className="space-y-6 pb-6">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <SettingsPanel title="Storage" description="ClickHouse storage backend">
          <SettingsValueRow
            label="Status"
            description="External structured log storage"
            value={
              <Badge
                variant={
                  status?.enabled ? (status.available ? "success" : "destructive") : "secondary"
                }
              >
                {status?.enabled ? (status.available ? "Available" : "Unavailable") : "Disabled"}
              </Badge>
            }
          />
          {status?.reason && (
            <div className="px-4 py-3 text-sm text-muted-foreground">{status.reason}</div>
          )}
          <SettingsValueRow
            label="Database"
            description="Configured ClickHouse database"
            value={<span className="font-mono">{config?.database ?? "-"}</span>}
          />
          <SettingsValueRow
            label="Table"
            description="Shared log event table"
            value={<span className="font-mono">{config?.table ?? "-"}</span>}
          />
          <SettingsValueRow
            label="Request timeout"
            description="ClickHouse request timeout"
            value={config ? `${config.requestTimeoutMs} ms` : "-"}
          />
        </SettingsPanel>

        <SettingsPanel title="Inventory" description="Configured logging metadata">
          <SettingsValueRow
            label="Environments"
            description="Configured ingest boundaries"
            value={<Badge variant="outline">{environmentCount}</Badge>}
          />
          <SettingsValueRow
            label="Schemas"
            description="Reusable validation schemas"
            value={<Badge variant="outline">{schemaCount}</Badge>}
          />
        </SettingsPanel>

        <SettingsPanel title="Ingest Limits" description="Global payload guardrails">
          <SettingsValueRow
            label="Body size"
            description="Maximum request body"
            value={config ? formatBytes(config.ingestMaxBodyBytes) : "-"}
          />
          <SettingsValueRow
            label="Batch size"
            description="Maximum events per batch"
            value={config?.ingestMaxBatchSize ?? "-"}
          />
          <SettingsValueRow
            label="Message size"
            description="Maximum message field size"
            value={config ? formatBytes(config.ingestMaxMessageBytes) : "-"}
          />
          <SettingsValueRow
            label="Labels"
            description="Maximum labels per event"
            value={config?.ingestMaxLabels ?? "-"}
          />
          <SettingsValueRow
            label="Fields"
            description="Maximum typed fields per event"
            value={config?.ingestMaxFields ?? "-"}
          />
          <SettingsValueRow
            label="Key length"
            description="Maximum label or field key length"
            value={config?.ingestMaxKeyLength ?? "-"}
          />
          <SettingsValueRow
            label="Value size"
            description="Maximum custom value size"
            value={config ? formatBytes(config.ingestMaxValueBytes) : "-"}
          />
          <SettingsValueRow
            label="JSON depth"
            description="Maximum nested JSON depth"
            value={config?.ingestMaxJsonDepth ?? "-"}
          />
        </SettingsPanel>

        <SettingsPanel title="Rate Limits" description="Fixed-window ingest throttles">
          <SettingsValueRow
            label="Window"
            description="Rate-limit accounting period"
            value={config ? `${config.rateLimitWindowSeconds}s` : "-"}
          />
          <SettingsValueRow
            label="Global requests"
            description="Requests across all logging tokens"
            value={config?.globalRequestsPerWindow ?? "-"}
          />
          <SettingsValueRow
            label="Global events"
            description="Events across all logging tokens"
            value={config?.globalEventsPerWindow ?? "-"}
          />
          <SettingsValueRow
            label="Token requests"
            description="Default request limit per token"
            value={config?.tokenRequestsPerWindow ?? "-"}
          />
          <SettingsValueRow
            label="Token events"
            description="Default event limit per token"
            value={config?.tokenEventsPerWindow ?? "-"}
          />
        </SettingsPanel>
      </div>
    </div>
  );
}

function LoggingSchemaDialog({
  open,
  onOpenChange,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (data: Partial<LoggingSchema>) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");
  const [schemaMode, setSchemaMode] = useState<LoggingSchemaMode>("reject");
  const [fieldSchema, setFieldSchema] = useState<LoggingSchema["fieldSchema"]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName("");
    setSlug("");
    setDescription("");
    setSchemaMode("reject");
    setFieldSchema([]);
  }, [open]);

  const save = async () => {
    setSaving(true);
    try {
      await onSave({
        name,
        slug: slug || slugify(name),
        description: description || null,
        schemaMode,
        fieldSchema,
      });
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[calc(100vw-2rem)] sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Create Logging Schema</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <label className="block space-y-1">
              <span className="text-sm font-medium">Name</span>
              <Input
                value={name}
                onChange={(event) => {
                  setName(event.target.value);
                  setSlug(slugify(event.target.value));
                }}
              />
            </label>
            <label className="block space-y-1">
              <span className="text-sm font-medium">Slug</span>
              <Input value={slug} onChange={(event) => setSlug(slugify(event.target.value))} />
            </label>
          </div>
          <label className="block space-y-1">
            <span className="text-sm font-medium">Description</span>
            <Input value={description} onChange={(event) => setDescription(event.target.value)} />
          </label>
          <label className="block space-y-1">
            <span className="text-sm font-medium">Mode</span>
            <Select
              value={schemaMode}
              onValueChange={(value) => setSchemaMode(value as LoggingSchemaMode)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="reject">Reject</SelectItem>
                <SelectItem value="strip">Strip</SelectItem>
                <SelectItem value="loose">Loose</SelectItem>
              </SelectContent>
            </Select>
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!name.trim() || !slug.trim() || saving} onClick={() => void save()}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
