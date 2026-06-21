import { Database, FileJson, Plus, Settings } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { confirm } from "@/components/common/ConfirmDialog";
import { PageTransition } from "@/components/common/PageTransition";
import { ResponsiveHeaderActions } from "@/components/common/ResponsiveHeaderActions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { RefreshButton } from "@/components/ui/refresh-button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { deriveAllowedResourceIdsByScope, scopeMatches } from "@/lib/scope-utils";
import { cn } from "@/lib/utils";
import { api } from "@/services/api";
import { useAuthStore } from "@/stores/auth";
import type {
  LoggingEnvironment,
  LoggingFeatureStatus,
  LoggingSchema,
  LoggingSchemaMode,
} from "@/types";
import {
  LoggingEnvironmentDetail,
  LoggingGlobalSettings,
  LoggingSchemaDetail,
} from "./logging/LoggingDetails";
import { LoggingEnvironmentDialog } from "./logging/LoggingEnvironmentDialog";
import { LoggingEnvironmentsTab, LoggingSchemasTab } from "./logging/LoggingTabs";
import { slugify } from "./logging/logging-state";

const TOP_TABS = [
  { value: "environments", label: "Environments", icon: Database },
  { value: "schemas", label: "Schemas", icon: FileJson },
  { value: "settings", label: "Settings", icon: Settings },
] as const;

const ENV_TABS = ["logs", "tokens", "settings"] as const;

export function Logging() {
  const { section, id, tab } = useParams<{ section?: string; id?: string; tab?: string }>();
  const navigate = useNavigate();
  const { user, hasAnyScope, hasScopedAccess } = useAuthStore();
  const isEnvironmentDetail = section === "environments" && !!id;
  const isSchemaDetail = section === "schemas" && !!id;
  const canAccessEnvironments =
    hasScopedAccess("logs:environments:view") ||
    hasAnyScope("logs:environments:view", "logs:read", "logs:manage");
  const userScopes = user?.scopes ?? [];
  const hasResourceScopedSchemaView =
    (deriveAllowedResourceIdsByScope(userScopes)["logs:schemas:view"]?.length ?? 0) > 0;
  const canListSchemas =
    hasAnyScope("logs:schemas:view", "logs:manage") || hasResourceScopedSchemaView;
  const canAccessSchemas = canListSchemas || hasAnyScope("logs:schemas:create");
  const canViewSchemaDetails = hasAnyScope("logs:schemas:view", "logs:schemas:view", "logs:manage");
  const canViewSelectedSchema =
    isSchemaDetail &&
    !!id &&
    (hasAnyScope("logs:schemas:view", "logs:manage") ||
      scopeMatches(userScopes, `logs:schemas:view:${id}`));
  const canAccessLoggingSettings = canAccessEnvironments || canAccessSchemas;
  const [status, setStatus] = useState<LoggingFeatureStatus | null>(
    () => api.getCached<LoggingFeatureStatus>("logging:status") ?? null
  );
  const [environments, setEnvironments] = useState<LoggingEnvironment[]>(() =>
    canAccessEnvironments ? (api.getCached<LoggingEnvironment[]>("logging:environments") ?? []) : []
  );
  const [schemas, setSchemas] = useState<LoggingSchema[]>(() =>
    canListSchemas ? (api.getCached<LoggingSchema[]>("logging:schemas") ?? []) : []
  );
  const [environmentSearch, setEnvironmentSearch] = useState("");
  const [schemaSearch, setSchemaSearch] = useState("");
  const [statusLoading, setStatusLoading] = useState(
    () => api.getCached<LoggingFeatureStatus>("logging:status") === undefined
  );
  const [environmentsLoading, setEnvironmentsLoading] = useState(
    () =>
      canAccessEnvironments &&
      api.getCached<LoggingEnvironment[]>("logging:environments") === undefined
  );
  const [schemasLoading, setSchemasLoading] = useState(
    () =>
      (canListSchemas || canViewSelectedSchema) &&
      api.getCached<LoggingSchema[]>("logging:schemas") === undefined
  );
  const [environmentDialogOpen, setEnvironmentDialogOpen] = useState(false);
  const [schemaDialogOpen, setSchemaDialogOpen] = useState(false);

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
  const visibleEnvironments = canAccessEnvironments ? environments : [];
  const visibleSchemas = canListSchemas || canViewSelectedSchema ? schemas : [];
  const selectedEnvironment =
    visibleEnvironments.find((environment) => environment.id === id) ?? null;
  const selectedSchema = visibleSchemas.find((schema) => schema.id === id) ?? null;

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
    const cachedStatus = api.getCached<LoggingFeatureStatus>("logging:status");
    const cachedEnvironments = api.getCached<LoggingEnvironment[]>("logging:environments");
    const cachedSchemas = api.getCached<LoggingSchema[]>("logging:schemas");
    if (cachedStatus) setStatus(cachedStatus);
    if (canAccessEnvironments && cachedEnvironments) setEnvironments(cachedEnvironments);
    if (!canAccessEnvironments) setEnvironments([]);
    if (canListSchemas && cachedSchemas) setSchemas(cachedSchemas);
    if (!canListSchemas && !canViewSelectedSchema) setSchemas([]);
    setStatusLoading(cachedStatus === undefined);
    setEnvironmentsLoading(canAccessEnvironments && cachedEnvironments === undefined);
    setSchemasLoading((canListSchemas || canViewSelectedSchema) && cachedSchemas === undefined);
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
      api.setCache("logging:status", featureStatus);
      if (canAccessEnvironments) api.setCache("logging:environments", environmentList);
      if (canListSchemas) api.setCache("logging:schemas", schemaList);
      setStatus(featureStatus);
      setEnvironments(environmentList);
      setSchemas(schemaList);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to load logging");
    } finally {
      setStatusLoading(false);
      setEnvironmentsLoading(false);
      setSchemasLoading(false);
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
    if (!needle) return visibleEnvironments;
    return visibleEnvironments.filter(
      (environment) =>
        environment.name.toLowerCase().includes(needle) ||
        environment.slug.toLowerCase().includes(needle) ||
        (environment.schemaName ?? "").toLowerCase().includes(needle)
    );
  }, [environmentSearch, visibleEnvironments]);

  const filteredSchemas = useMemo(() => {
    const needle = schemaSearch.trim().toLowerCase();
    if (!needle) return visibleSchemas;
    return visibleSchemas.filter(
      (schema) =>
        schema.name.toLowerCase().includes(needle) || schema.slug.toLowerCase().includes(needle)
    );
  }, [schemaSearch, visibleSchemas]);

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
    api.setCache(
      "logging:environments",
      (api.getCached<LoggingEnvironment[]>("logging:environments") ?? environments).map(
        (environment) => (environment.id === updated.id ? updated : environment)
      )
    );
  };

  const createSchema = async (data: Partial<LoggingSchema>) => {
    const created = await api.createLoggingSchema(data);
    setSchemas((current) => {
      const next = [...current, created].sort((a, b) => a.name.localeCompare(b.name));
      api.setCache("logging:schemas", next);
      return next;
    });
    toast.success("Logging schema created");
    if (hasAnyScope("logs:schemas:view", `logs:schemas:view:${created.id}`, "logs:manage")) {
      navigate(`/logging/schemas/${created.id}`);
    } else {
      navigate("/logging/schemas");
    }
  };

  const updateSchema = async (schemaId: string, data: Partial<LoggingSchema>) => {
    const updated = await api.updateLoggingSchema(schemaId, data);
    setSchemas((current) => {
      const next = current.map((schema) => (schema.id === updated.id ? updated : schema));
      api.setCache("logging:schemas", next);
      return next;
    });
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
        loading={environmentsLoading}
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
        loading={schemasLoading}
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

  const activeTabLoading =
    topTab === "environments"
      ? environmentsLoading
      : topTab === "schemas"
        ? schemasLoading
        : statusLoading;

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
              loading={environmentsLoading}
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
              loading={schemasLoading}
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
