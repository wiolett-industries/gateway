import { LogIn } from "lucide-react";
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { api } from "@/services/api";
import { useAuthStore } from "@/stores/auth";

export function LoginPage() {
  const navigate = useNavigate();
  const { isAuthenticated } = useAuthStore();

  useEffect(() => {
    if (isAuthenticated) {
      navigate("/");
    }
  }, [isAuthenticated, navigate]);

  const handleLogin = () => {
    window.location.href = api.getLoginUrl();
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm space-y-8 text-center">
        <div className="flex flex-col items-center gap-4">
          <div className="flex items-center gap-4">
            <img src="/android-chrome-192x192.png" alt="Gateway" className="h-10 w-10" />
            <h1 className="text-3xl font-bold tracking-tight text-foreground">Gateway</h1>
          </div>
          <p className="text-sm text-muted-foreground">
            Certificate manager and reverse proxy gateway
          </p>
        </div>

        <div className="space-y-4">
          <Button onClick={handleLogin} className="w-full" size="lg">
            <LogIn className="h-4 w-4" />
            Sign in with OIDC
          </Button>
          <div className="space-y-1">
          <p className="text-xs text-muted-foreground">
            Authenticate via your organization's identity provider
          </p>
          <p className="text-xs text-muted-foreground">
            Powered by{" "}
            <a href="https://wiolett.net" target="_blank" rel="noopener noreferrer" className="text-foreground hover:underline">
              Wiolett
            </a>
          </p>
          </div>
        </div>
      </div>
    </div>
  );
}
