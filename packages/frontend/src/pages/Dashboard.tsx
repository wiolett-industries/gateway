import {
  AlertTriangle,
  Award,
  CheckCircle,
  Clock,
  Plus,
  Shield,
  ShieldAlert,
  XCircle,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { PageTransition } from "@/components/common/PageTransition";
import { CATree } from "@/components/ca/CATree";
import { CACreateDialog } from "@/components/ca/CACreateDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

import { api } from "@/services/api";
import { useAuthStore } from "@/stores/auth";
import { useCAStore } from "@/stores/ca";
import type { CA } from "@/types";

function StatCard({
  title,
  value,
  icon: Icon,
  description,
  variant = "default",
}: {
  title: string;
  value: number;
  icon: React.ElementType;
  description?: string;
  variant?: "default" | "success" | "warning" | "destructive";
}) {
  const variantClasses = {
    default: "text-foreground",
    success: "text-green-600 dark:text-green-400",
    warning: "text-yellow-600 dark:text-yellow-400",
    destructive: "text-destructive",
  };

  return (
    <div className="border border-border bg-card p-4 space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{title}</p>
        <Icon className={`h-4 w-4 ${variantClasses[variant]}`} />
      </div>
      <p className={`text-2xl font-bold ${variantClasses[variant]}`}>{value}</p>
      {description && (
        <p className="text-xs text-muted-foreground">{description}</p>
      )}
    </div>
  );
}

function computeStats(cas: CA[]) {
  const activeCAs = cas.filter((ca) => ca.status === "active").length;
  const totalCAs = cas.length;
  const totalCerts = cas.reduce((sum, ca) => sum + (ca.certCount || 0), 0);

  return { activeCAs, totalCAs, totalCerts };
}

export function Dashboard() {
  const navigate = useNavigate();
  const { hasRole } = useAuthStore();
  const { cas, fetchCAs, isLoading } = useCAStore();
  const [createDialogOpen, setCreateDialogOpen] = useState(false);

  useEffect(() => {
    fetchCAs();
  }, [fetchCAs]);

  const stats = computeStats(cas || []);

  if (isLoading) {
    return (
        <div className="flex items-center justify-center py-16">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
    );
  }

  return (
    <PageTransition>
    <div className="h-full overflow-y-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Dashboard</h1>
          <p className="text-sm text-muted-foreground">PKI infrastructure overview</p>
        </div>
        {hasRole("admin") && (
          <Button onClick={() => setCreateDialogOpen(true)}>
            <Plus className="h-4 w-4" />
            Create Root CA
          </Button>
        )}
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard
          title="Certificate Authorities"
          value={stats.activeCAs}
          icon={Shield}
          description={`${stats.totalCAs} total`}
          variant="success"
        />
        <StatCard
          title="Certificates Issued"
          value={stats.totalCerts}
          icon={Award}
          variant="default"
        />
        <StatCard
          title="Active CAs"
          value={stats.activeCAs}
          icon={CheckCircle}
          variant="success"
        />
      </div>

      {/* CA Hierarchy */}
      <div className="border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border p-4">
          <h2 className="font-semibold">CA Hierarchy</h2>
          <Link to="/certificates" className="text-sm text-muted-foreground hover:text-foreground">
            View all certificates
          </Link>
        </div>
        <div className="p-4">
          {(cas || []).length > 0 ? (
            <CATree cas={cas} onSelect={(id) => navigate(`/cas/${id}`)} />
          ) : (
            <div className="flex flex-col items-center gap-2 py-8 text-center">
              <ShieldAlert className="h-8 w-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">No certificate authorities yet</p>
              <p className="text-xs text-muted-foreground">
                Create a Root CA to get started with your PKI infrastructure.
              </p>
              {hasRole("admin") && (
                <Button variant="outline" size="sm" onClick={() => setCreateDialogOpen(true)}>
                  <Plus className="h-4 w-4" />
                  Create Root CA
                </Button>
              )}
            </div>
          )}
        </div>
      </div>

      <CACreateDialog open={createDialogOpen} onOpenChange={setCreateDialogOpen} />
    </div>
    </PageTransition>
  );
}
