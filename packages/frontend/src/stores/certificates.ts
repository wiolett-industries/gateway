import { create } from "zustand";
import { api } from "@/services/api";
import { useAuthStore } from "@/stores/auth";
import { useUIStore } from "@/stores/ui";
import type { Certificate, CertificateStatus, CertificateType } from "@/types";

interface CertificateFilters {
  search: string;
  status: CertificateStatus | "all";
  type: CertificateType | "all";
  caId: string | "all";
}

interface CertificatesState {
  certificates: Certificate[];
  selectedCertificate: Certificate | null;
  isLoading: boolean;
  error: string | null;
  filters: CertificateFilters;
  page: number;
  limit: number;
  total: number;
  totalPages: number;

  fetchCertificates: () => Promise<void>;
  selectCertificate: (id: string) => Promise<void>;
  clearSelected: () => void;
  setFilters: (filters: Partial<CertificateFilters>) => void;
  setPage: (page: number) => void;
  resetFilters: () => void;
}

const defaultFilters: CertificateFilters = {
  search: "",
  status: "active",
  type: "all",
  caId: "all",
};

let fetchCertificatesRequestId = 0;

export const useCertificatesStore = create<CertificatesState>()((set, get) => ({
  certificates: [],
  selectedCertificate: null,
  isLoading: false,
  error: null,
  filters: { ...defaultFilters },
  page: 1,
  limit: 25,
  total: 0,
  totalPages: 0,

  fetchCertificates: async () => {
    const requestId = ++fetchCertificatesRequestId;
    const { filters, page, limit } = get();
    const showSystem =
      useUIStore.getState().showSystemCertificates &&
      useAuthStore.getState().hasScope("admin:details:certificates");
    const isDefault =
      page === 1 &&
      !filters.search &&
      filters.status === "active" &&
      filters.type === "all" &&
      filters.caId === "all";
    const cacheKey = `certificates:list:${showSystem ? "system" : "default"}`;

    // Show cached data instantly for default view
    if (isDefault && get().certificates.length === 0) {
      const cached = api.getCached<{
        data: Certificate[];
        pagination: { total: number; totalPages: number };
      }>(cacheKey);
      if (cached)
        set({
          certificates: cached.data || [],
          total: cached.pagination?.total ?? 0,
          totalPages: cached.pagination?.totalPages ?? 0,
        });
    }

    const hasData = get().certificates.length > 0;
    set({ isLoading: !hasData, error: null });
    try {
      const response = await api.listCertificates({
        page,
        limit,
        search: filters.search || undefined,
        status: filters.status !== "all" ? filters.status : undefined,
        type: filters.type !== "all" ? filters.type : undefined,
        caId: filters.caId !== "all" ? filters.caId : undefined,
        showSystem,
      });
      if (requestId !== fetchCertificatesRequestId) return;
      if (isDefault) api.setCache(cacheKey, response);
      set({
        certificates: response.data || [],
        total: response.pagination?.total ?? 0,
        totalPages: response.pagination?.totalPages ?? 0,
        isLoading: false,
      });
    } catch (err) {
      if (requestId !== fetchCertificatesRequestId) return;
      const message = err instanceof Error ? err.message : "Failed to fetch certificates";
      set({ error: message, isLoading: false });
    }
  },

  selectCertificate: async (id: string) => {
    try {
      const cert = await api.getCertificate(id);
      set({ selectedCertificate: cert });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to fetch certificate";
      set({ error: message });
    }
  },

  clearSelected: () => set({ selectedCertificate: null }),

  setFilters: (newFilters) => {
    set((state) => ({
      filters: { ...state.filters, ...newFilters },
      page: 1,
    }));
    get().fetchCertificates();
  },

  setPage: (page) => {
    set({ page });
    get().fetchCertificates();
  },

  resetFilters: () => {
    set({ filters: { ...defaultFilters }, page: 1 });
    get().fetchCertificates();
  },
}));
