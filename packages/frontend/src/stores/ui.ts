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
  showSystemCertificates: boolean;
  setShowSystemCertificates: (show: boolean) => void;
  showAILiteModeCTA: boolean;
  setShowAILiteModeCTA: (show: boolean) => void;

  // AI Approval Bypass
  aiAlwaysAskApprovals: boolean;
  aiBypassCreateApprovals: boolean;
  aiBypassEditApprovals: boolean;
  aiBypassDeleteApprovals: boolean;
  setAIAlwaysAskApprovals: (v: boolean) => void;
  setAIBypassCreateApprovals: (v: boolean) => void;
  setAIBypassEditApprovals: (v: boolean) => void;
  setAIBypassDeleteApprovals: (v: boolean) => void;

  // Command palette
  commandPaletteOpen: boolean;
  setCommandPaletteOpen: (open: boolean) => void;

  // AI Panel
  aiPanelOpen: boolean;
  aiLiteMode: boolean;
  aiLiteModeIntroAccepted: boolean;
  pinnedAIConversationIds: string[];
  setAIPanelOpen: (open: boolean) => void;
  setAILiteMode: (enabled: boolean) => void;
  setAILiteModeIntroAccepted: (accepted: boolean) => void;
  togglePinnedAIConversation: (conversationId: string) => void;
  toggleAIPanel: () => void;
  toggleAILiteMode: () => void;

  // Recent pages
  recentPages: Array<{ path: string; label: string; icon?: string }>;
  addRecentPage: (path: string, label: string, icon?: string) => void;

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
      showSystemCertificates: false,
      setShowSystemCertificates: (showSystemCertificates) => set({ showSystemCertificates }),
      showAILiteModeCTA: true,
      setShowAILiteModeCTA: (showAILiteModeCTA) => set({ showAILiteModeCTA }),

      // AI Approval Bypass
      aiAlwaysAskApprovals: false,
      aiBypassCreateApprovals: false,
      aiBypassEditApprovals: false,
      aiBypassDeleteApprovals: false,
      setAIAlwaysAskApprovals: (aiAlwaysAskApprovals) => set({ aiAlwaysAskApprovals }),
      setAIBypassCreateApprovals: (aiBypassCreateApprovals) => set({ aiBypassCreateApprovals }),
      setAIBypassEditApprovals: (aiBypassEditApprovals) => set({ aiBypassEditApprovals }),
      setAIBypassDeleteApprovals: (aiBypassDeleteApprovals) => set({ aiBypassDeleteApprovals }),

      // Command palette
      commandPaletteOpen: false,
      setCommandPaletteOpen: (commandPaletteOpen) => set({ commandPaletteOpen }),

      // AI Panel
      aiPanelOpen: false,
      aiLiteMode: false,
      aiLiteModeIntroAccepted: false,
      pinnedAIConversationIds: [],
      setAIPanelOpen: (aiPanelOpen) => set({ aiPanelOpen }),
      setAILiteMode: (aiLiteMode) => set({ aiLiteMode }),
      setAILiteModeIntroAccepted: (aiLiteModeIntroAccepted) => set({ aiLiteModeIntroAccepted }),
      togglePinnedAIConversation: (conversationId) =>
        set((state) => ({
          pinnedAIConversationIds: state.pinnedAIConversationIds.includes(conversationId)
            ? state.pinnedAIConversationIds.filter((id) => id !== conversationId)
            : [conversationId, ...state.pinnedAIConversationIds],
        })),
      toggleAIPanel: () => set((state) => ({ aiPanelOpen: !state.aiPanelOpen })),
      toggleAILiteMode: () => set((state) => ({ aiLiteMode: !state.aiLiteMode })),

      // Recent pages
      recentPages: [],
      addRecentPage: (path, label, icon) =>
        set((s) => {
          const filtered = s.recentPages.filter((p) => p.path !== path);
          return { recentPages: [{ path, label, icon }, ...filtered].slice(0, 8) };
        }),

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
        showSystemCertificates: state.showSystemCertificates,
        showAILiteModeCTA: state.showAILiteModeCTA,
        aiPanelOpen: state.aiPanelOpen,
        aiLiteMode: state.aiLiteMode,
        aiLiteModeIntroAccepted: state.aiLiteModeIntroAccepted,
        pinnedAIConversationIds: state.pinnedAIConversationIds,
        aiBypassCreateApprovals: state.aiBypassCreateApprovals,
        aiBypassEditApprovals: state.aiBypassEditApprovals,
        aiBypassDeleteApprovals: state.aiBypassDeleteApprovals,
        recentPages: state.recentPages,
      }),
    }
  )
);
