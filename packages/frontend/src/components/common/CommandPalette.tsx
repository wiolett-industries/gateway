import {
  Award,
  Box,
  FileCode,
  FileCode2,
  FileText,
  Globe,
  Globe2,
  HardDrive,
  Layers,
  LayoutDashboard,
  ListTodo,
  Lock,
  LogOut,
  Monitor,
  Moon,
  Network,
  PanelLeft,
  Plus,
  ScrollText,
  Server,
  Settings,
  Shield,
  ShieldAlert,
  ShieldCheck,
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
  CommandSeparator,
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
  const { hasScope, logout } = useAuthStore();
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
        {hasScope("pki:ca:list:root") && (cas || []).length > 0 && (
          <>
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
            <CommandSeparator />
          </>
        )}

        {/* Navigation */}
        <CommandGroup heading="Navigation">
          <CommandItem onSelect={() => handleSelect(() => navigate("/"))}>
            <LayoutDashboard className="mr-2 h-4 w-4" />
            Dashboard
            <CommandShortcut>⌘1</CommandShortcut>
          </CommandItem>
        </CommandGroup>

        {(hasScope("proxy:list") || hasScope("ssl:cert:list")) && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Reverse Proxy">
              {hasScope("proxy:list") && (
                <CommandItem onSelect={() => handleSelect(() => navigate("/proxy-hosts"))}>
                  <Globe className="mr-2 h-4 w-4" />
                  Proxy Hosts
                  <CommandShortcut>⌘2</CommandShortcut>
                </CommandItem>
              )}
              {hasScope("proxy:list") && (
                <CommandItem onSelect={() => handleSelect(() => navigate("/domains"))}>
                  <Globe2 className="mr-2 h-4 w-4" />
                  Domains
                  <CommandShortcut>⌘3</CommandShortcut>
                </CommandItem>
              )}
              {hasScope("proxy:list") && (
                <CommandItem onSelect={() => handleSelect(() => navigate("/nginx-templates"))}>
                  <FileCode className="mr-2 h-4 w-4" />
                  Config Templates
                  <CommandShortcut>⌘4</CommandShortcut>
                </CommandItem>
              )}
              {hasScope("ssl:cert:list") && (
                <CommandItem onSelect={() => handleSelect(() => navigate("/ssl-certificates"))}>
                  <Lock className="mr-2 h-4 w-4" />
                  SSL Certificates
                  <CommandShortcut>⌘5</CommandShortcut>
                </CommandItem>
              )}
            </CommandGroup>
          </>
        )}

        {(hasScope("pki:ca:list:root") || hasScope("pki:cert:list") || hasScope("pki:templates:list")) && (
          <>
            <CommandSeparator />
            <CommandGroup heading="PKI">
              {hasScope("pki:ca:list:root") && (
                <CommandItem onSelect={() => handleSelect(() => navigate("/cas"))}>
                  <ShieldCheck className="mr-2 h-4 w-4" />
                  Authorities
                  <CommandShortcut>⌘6</CommandShortcut>
                </CommandItem>
              )}
              {hasScope("pki:cert:list") && (
                <CommandItem onSelect={() => handleSelect(() => navigate("/certificates"))}>
                  <FileText className="mr-2 h-4 w-4" />
                  Certificates
                  <CommandShortcut>⌘7</CommandShortcut>
                </CommandItem>
              )}
              {hasScope("pki:templates:list") && (
                <CommandItem onSelect={() => handleSelect(() => navigate("/templates"))}>
                  <Award className="mr-2 h-4 w-4" />
                  Templates
                  <CommandShortcut>⌘8</CommandShortcut>
                </CommandItem>
              )}
            </CommandGroup>
          </>
        )}

        {hasScope("docker:containers:list") && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Docker">
              <CommandItem onSelect={() => handleSelect(() => navigate("/docker/containers"))}>
                <Box className="mr-2 h-4 w-4" />
                Containers
              </CommandItem>
              {hasScope("docker:images:list") && (
                <CommandItem onSelect={() => handleSelect(() => navigate("/docker/images"))}>
                  <Layers className="mr-2 h-4 w-4" />
                  Images
                </CommandItem>
              )}
              {hasScope("docker:volumes:list") && (
                <CommandItem onSelect={() => handleSelect(() => navigate("/docker/volumes"))}>
                  <HardDrive className="mr-2 h-4 w-4" />
                  Volumes
                </CommandItem>
              )}
              {hasScope("docker:networks:list") && (
                <CommandItem onSelect={() => handleSelect(() => navigate("/docker/networks"))}>
                  <Network className="mr-2 h-4 w-4" />
                  Networks
                </CommandItem>
              )}
              {hasScope("docker:templates:list") && (
                <CommandItem onSelect={() => handleSelect(() => navigate("/docker/templates"))}>
                  <FileCode2 className="mr-2 h-4 w-4" />
                  Templates
                </CommandItem>
              )}
              {hasScope("docker:tasks") && (
                <CommandItem onSelect={() => handleSelect(() => navigate("/docker/tasks"))}>
                  <ListTodo className="mr-2 h-4 w-4" />
                  Tasks
                </CommandItem>
              )}
            </CommandGroup>
          </>
        )}

        <CommandSeparator />

        <CommandGroup heading="Management">
          {hasScope("nodes:list") && (
            <CommandItem onSelect={() => handleSelect(() => navigate("/nodes"))}>
              <Server className="mr-2 h-4 w-4" />
              Nodes
              <CommandShortcut>⌘9</CommandShortcut>
            </CommandItem>
          )}
          {hasScope("acl:list") && (
            <CommandItem onSelect={() => handleSelect(() => navigate("/access-lists"))}>
              <ShieldAlert className="mr-2 h-4 w-4" />
              Access Lists
              <CommandShortcut>⌘0</CommandShortcut>
            </CommandItem>
          )}
          {hasScope("admin:audit") && (
            <CommandItem onSelect={() => handleSelect(() => navigate("/audit"))}>
              <ScrollText className="mr-2 h-4 w-4" />
              Audit Log
            </CommandItem>
          )}
          {hasScope("admin:users") && (
            <CommandItem onSelect={() => handleSelect(() => navigate("/admin/users"))}>
              <Users className="mr-2 h-4 w-4" />
              Users
            </CommandItem>
          )}
          {hasScope("admin:groups") && (
            <CommandItem onSelect={() => handleSelect(() => navigate("/admin/groups"))}>
              <Shield className="mr-2 h-4 w-4" />
              Groups
            </CommandItem>
          )}
          <CommandItem onSelect={() => handleSelect(() => navigate("/settings"))}>
            <Settings className="mr-2 h-4 w-4" />
            Settings
            <CommandShortcut>⌘,</CommandShortcut>
          </CommandItem>
        </CommandGroup>

        <CommandSeparator />

        {/* Actions */}
        <CommandGroup heading="Actions">
          <CommandItem value="toggle sidebar" onSelect={() => handleSelect(() => toggleSidebar())}>
            <PanelLeft className="mr-2 h-4 w-4" />
            {sidebarOpen ? "Hide sidebar" : "Show sidebar"}
            <CommandShortcut>⌘J</CommandShortcut>
          </CommandItem>
          {hasScope("proxy:create") && (
            <CommandItem onSelect={() => handleSelect(() => navigate("/proxy-hosts/new"))}>
              <Plus className="mr-2 h-4 w-4" />
              New Proxy Host
              <CommandShortcut>⌃H</CommandShortcut>
            </CommandItem>
          )}
          {hasScope("ssl:cert:issue") && (
            <CommandItem
              onSelect={() =>
                handleSelect(() => {
                  navigate("/ssl-certificates");
                  useUIStore.getState().openModal("createSSLCert");
                })
              }
            >
              <Plus className="mr-2 h-4 w-4" />
              New SSL Certificate
              <CommandShortcut>⌃S</CommandShortcut>
            </CommandItem>
          )}
          {hasScope("pki:ca:create:root") && (
            <CommandItem
              onSelect={() =>
                handleSelect(() => {
                  navigate("/cas");
                  useUIStore.getState().openModal("createCA");
                })
              }
            >
              <Plus className="mr-2 h-4 w-4" />
              Create Root CA
              <CommandShortcut>⌃R</CommandShortcut>
            </CommandItem>
          )}
        </CommandGroup>

        <CommandSeparator />

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

        <CommandSeparator />

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
