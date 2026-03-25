import {
  Award,
  FileText,
  Globe,
  LayoutDashboard,
  Lock,
  LogOut,
  Monitor,
  Moon,
  PanelLeft,
  Plus,
  ScrollText,
  Settings,
  Shield,
  ShieldAlert,
  Sun,
  Users,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command";
import { api } from "@/services/api";
import { useAuthStore } from "@/stores/auth";
import { useCAStore } from "@/stores/ca";
import { useUIStore } from "@/stores/ui";

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const { hasRole, logout } = useAuthStore();
  const { cas } = useCAStore();
  const { setTheme, theme, toggleSidebar, sidebarOpen } = useUIStore();

  useEffect(() => {
    if (!open) setSearch("");
  }, [open]);

  const handleSelect = (callback: () => void) => {
    callback();
    onOpenChange(false);
  };

  const handleLogout = async () => {
    try {
      await api.logout();
    } catch {
      logout();
    }
    navigate("/login");
  };

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput
        placeholder="Search or type a command..."
        value={search}
        onValueChange={setSearch}
      />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>

        {/* CAs */}
        {(cas || []).length > 0 && (
          <CommandGroup heading="Certificate Authorities">
            {(cas || []).slice(0, 5).map((ca) => (
              <CommandItem
                key={ca.id}
                value={`ca ${ca.commonName}`}
                onSelect={() => handleSelect(() => navigate(`/cas/${ca.id}`))}
              >
                <Shield className="mr-2 h-4 w-4" />
                <span className="truncate">{ca.commonName}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {/* Navigation */}
        <CommandGroup heading="Navigation">
          <CommandItem onSelect={() => handleSelect(() => navigate("/"))}>
            <LayoutDashboard className="mr-2 h-4 w-4" />
            Dashboard
          </CommandItem>
          <CommandItem onSelect={() => handleSelect(() => navigate("/proxy-hosts"))}>
            <Globe className="mr-2 h-4 w-4" />
            Proxy Hosts
          </CommandItem>
          <CommandItem onSelect={() => handleSelect(() => navigate("/ssl-certificates"))}>
            <Lock className="mr-2 h-4 w-4" />
            SSL Certificates
          </CommandItem>
          <CommandItem onSelect={() => handleSelect(() => navigate("/access-lists"))}>
            <ShieldAlert className="mr-2 h-4 w-4" />
            Access Lists
          </CommandItem>
          <CommandItem onSelect={() => handleSelect(() => navigate("/certificates"))}>
            <Award className="mr-2 h-4 w-4" />
            Certificates
          </CommandItem>
          <CommandItem onSelect={() => handleSelect(() => navigate("/templates"))}>
            <FileText className="mr-2 h-4 w-4" />
            Templates
          </CommandItem>
          {hasRole("admin") && (
            <>
              <CommandItem onSelect={() => handleSelect(() => navigate("/audit"))}>
                <ScrollText className="mr-2 h-4 w-4" />
                Audit Log
              </CommandItem>
              <CommandItem onSelect={() => handleSelect(() => navigate("/admin/users"))}>
                <Users className="mr-2 h-4 w-4" />
                Users
              </CommandItem>
            </>
          )}
          <CommandItem onSelect={() => handleSelect(() => navigate("/settings"))}>
            <Settings className="mr-2 h-4 w-4" />
            Settings
          </CommandItem>
        </CommandGroup>

        {/* Actions */}
        <CommandGroup heading="Actions">
          <CommandItem value="toggle sidebar" onSelect={() => handleSelect(() => toggleSidebar())}>
            <PanelLeft className="mr-2 h-4 w-4" />
            {sidebarOpen ? "Hide sidebar" : "Show sidebar"}
            <CommandShortcut>⌘J</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={() => handleSelect(() => navigate("/proxy-hosts/new"))}>
            <Plus className="mr-2 h-4 w-4" />
            New Proxy Host
          </CommandItem>
          <CommandItem onSelect={() => handleSelect(() => navigate("/ssl-certificates/new"))}>
            <Plus className="mr-2 h-4 w-4" />
            New SSL Certificate
          </CommandItem>
          {hasRole("admin") && (
            <CommandItem
              onSelect={() =>
                handleSelect(() => {
                  useUIStore.getState().openModal("createCA");
                  navigate("/");
                })
              }
            >
              <Plus className="mr-2 h-4 w-4" />
              Create Root CA
            </CommandItem>
          )}
        </CommandGroup>

        <CommandGroup heading="Theme">
          <CommandItem onSelect={() => handleSelect(() => setTheme("light"))}>
            <Sun className="mr-2 h-4 w-4" />
            Light{theme === "light" && <CommandShortcut>✓</CommandShortcut>}
          </CommandItem>
          <CommandItem onSelect={() => handleSelect(() => setTheme("dark"))}>
            <Moon className="mr-2 h-4 w-4" />
            Dark{theme === "dark" && <CommandShortcut>✓</CommandShortcut>}
          </CommandItem>
          <CommandItem onSelect={() => handleSelect(() => setTheme("system"))}>
            <Monitor className="mr-2 h-4 w-4" />
            System{theme === "system" && <CommandShortcut>✓</CommandShortcut>}
          </CommandItem>
        </CommandGroup>

        <CommandGroup heading="Account">
          <CommandItem onSelect={() => handleSelect(handleLogout)}>
            <LogOut className="mr-2 h-4 w-4" />
            Log out
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
