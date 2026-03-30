import { create } from "zustand";
import { persist } from "zustand/middleware";

type Theme = "light" | "dark" | "system";
type ResolvedTheme = "light" | "dark";

interface ModalState {
  type: string | null;
  props?: Record<string, unknown>;
}

interface UIState {
  // Theme
  theme: Theme;
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: Theme) => void;
  setResolvedTheme: (theme: ResolvedTheme) => void;

  // Sidebar
  sidebarOpen: boolean;
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;

  // Mobile
  isMobile: boolean;
  setIsMobile: (isMobile: boolean) => void;
  mobileMenuOpen: boolean;
  setMobileMenuOpen: (open: boolean) => void;

  // Preferences
  showUpdateNotifications: boolean;
  setShowUpdateNotifications: (show: boolean) => void;

  // AI Approval Bypass
  aiBypassCreateApprovals: boolean;
  aiBypassEditApprovals: boolean;
  aiBypassDeleteApprovals: boolean;
  setAIBypassCreateApprovals: (v: boolean) => void;
  setAIBypassEditApprovals: (v: boolean) => void;
  setAIBypassDeleteApprovals: (v: boolean) => void;

  // Command palette
  commandPaletteOpen: boolean;
  setCommandPaletteOpen: (open: boolean) => void;

  // AI Panel
  aiPanelOpen: boolean;
  setAIPanelOpen: (open: boolean) => void;
  toggleAIPanel: () => void;

  // Modal
  modal: ModalState;
  openModal: (type: string, props?: Record<string, unknown>) => void;
  closeModal: () => void;
}

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      // Theme
      theme: "system",
      resolvedTheme: "light",
      setTheme: (theme) => set({ theme }),
      setResolvedTheme: (resolvedTheme) => set({ resolvedTheme }),

      // Sidebar
      sidebarOpen: true,
      sidebarCollapsed: false,
      toggleSidebar: () =>
        set((state) => ({
          sidebarOpen: !state.sidebarOpen,
          sidebarCollapsed: !state.sidebarCollapsed,
        })),
      setSidebarCollapsed: (sidebarCollapsed) =>
        set({ sidebarCollapsed, sidebarOpen: !sidebarCollapsed }),

      // Mobile
      isMobile: false,
      setIsMobile: (isMobile) => set({ isMobile }),
      mobileMenuOpen: false,
      setMobileMenuOpen: (mobileMenuOpen) => set({ mobileMenuOpen }),

      // Preferences
      showUpdateNotifications: true,
      setShowUpdateNotifications: (showUpdateNotifications) => set({ showUpdateNotifications }),

      // AI Approval Bypass
      aiBypassCreateApprovals: false,
      aiBypassEditApprovals: false,
      aiBypassDeleteApprovals: false,
      setAIBypassCreateApprovals: (aiBypassCreateApprovals) => set({ aiBypassCreateApprovals }),
      setAIBypassEditApprovals: (aiBypassEditApprovals) => set({ aiBypassEditApprovals }),
      setAIBypassDeleteApprovals: (aiBypassDeleteApprovals) => set({ aiBypassDeleteApprovals }),

      // Command palette
      commandPaletteOpen: false,
      setCommandPaletteOpen: (commandPaletteOpen) => set({ commandPaletteOpen }),

      // AI Panel
      aiPanelOpen: false,
      setAIPanelOpen: (aiPanelOpen) => set({ aiPanelOpen }),
      toggleAIPanel: () => set((state) => ({ aiPanelOpen: !state.aiPanelOpen })),

      // Modal
      modal: { type: null },
      openModal: (type, props) => set({ modal: { type, props } }),
      closeModal: () => set({ modal: { type: null } }),
    }),
    {
      name: "gateway-ui",
      partialize: (state) => ({
        theme: state.theme,
        sidebarOpen: state.sidebarOpen,
        sidebarCollapsed: state.sidebarCollapsed,
        showUpdateNotifications: state.showUpdateNotifications,
        aiPanelOpen: state.aiPanelOpen,
        aiBypassCreateApprovals: state.aiBypassCreateApprovals,
        aiBypassEditApprovals: state.aiBypassEditApprovals,
        aiBypassDeleteApprovals: state.aiBypassDeleteApprovals,
      }),
    }
  )
);
