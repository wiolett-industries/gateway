import { useEffect, useRef } from "react";
import { Navigate } from "react-router-dom";
import { toast } from "sonner";
import { useAuthStore } from "@/stores/auth";

interface RequireScopeProps {
  scope: string;
  children: React.ReactNode;
}

export function RequireScope({ scope, children }: RequireScopeProps) {
  const hasScope = useAuthStore((s) => s.hasScope);
  const toasted = useRef(false);

  const allowed = hasScope(scope);

  useEffect(() => {
    if (!allowed && !toasted.current) {
      toasted.current = true;
      toast.error("You don't have permission to access this page");
    }
  }, [allowed]);

  if (!allowed) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}
