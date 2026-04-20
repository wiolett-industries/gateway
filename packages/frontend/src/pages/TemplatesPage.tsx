import { Award, FileCode, Plus } from "lucide-react";
import { useRef } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { PageTransition } from "@/components/common/PageTransition";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuthStore } from "@/stores/auth";
import { NginxTemplates } from "./NginxTemplates";
import { Templates } from "./Templates";

const TABS = [
  {
    value: "pki",
    label: "PKI Certificates",
    icon: Award,
    scope: "pki:templates:list",
    createScope: "pki:templates:edit",
  },
  {
    value: "nginx",
    label: "Nginx Config",
    icon: FileCode,
    scope: "proxy:list",
    createScope: "proxy:edit",
  },
] as const;

export function TemplatesPage() {
  const { tab: tabParam } = useParams<{ tab?: string }>();
  const navigate = useNavigate();
  const { hasScope } = useAuthStore();

  const pkiCreateRef = useRef<(() => void) | null>(null);
  const nginxCreateRef = useRef<(() => void) | null>(null);

  const visibleTabs = TABS.filter((t) => hasScope(t.scope));
  const activeTab =
    tabParam && visibleTabs.some((t) => t.value === tabParam)
      ? tabParam
      : visibleTabs[0]?.value || "pki";

  if (visibleTabs.length === 0) {
    return <Navigate to="/" replace />;
  }

  const handleTabChange = (value: string) => {
    navigate(`/templates/${value}`, { replace: true });
  };

  const renderActions = () => {
    const tab = TABS.find((t) => t.value === activeTab);
    if (!tab || !hasScope(tab.createScope)) return null;

    switch (activeTab) {
      case "pki":
        return (
          <Button onClick={() => pkiCreateRef.current?.()}>
            <Plus className="h-4 w-4 mr-1" />
            Create Template
          </Button>
        );
      case "nginx":
        return (
          <Button onClick={() => nginxCreateRef.current?.()}>
            <Plus className="h-4 w-4 mr-1" />
            Create Template
          </Button>
        );
      default:
        return null;
    }
  };

  return (
    <PageTransition>
      <div className="h-full flex flex-col p-6 gap-4">
        <div className="flex flex-wrap items-center justify-between gap-2 shrink-0">
          <div>
            <h1 className="text-2xl font-bold">Templates</h1>
            <p className="text-sm text-muted-foreground">
              Certificate and nginx configuration templates
            </p>
          </div>
          <div className="flex items-center gap-2">{renderActions()}</div>
        </div>

        <Tabs
          value={activeTab}
          onValueChange={handleTabChange}
          className="flex flex-col flex-1 min-h-0"
        >
          <TabsList className="shrink-0">
            {visibleTabs.map((tab) => (
              <TabsTrigger key={tab.value} value={tab.value} className="gap-1.5">
                <tab.icon className="h-3.5 w-3.5" />
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>

          <TabsContent value="pki" className="flex flex-col flex-1 min-h-0">
            <Templates
              embedded
              onCreateRef={(fn) => {
                pkiCreateRef.current = fn;
              }}
            />
          </TabsContent>
          <TabsContent value="nginx" className="flex flex-col flex-1 min-h-0">
            <NginxTemplates
              embedded
              onCreateRef={(fn) => {
                nginxCreateRef.current = fn;
              }}
            />
          </TabsContent>
        </Tabs>
      </div>
    </PageTransition>
  );
}
