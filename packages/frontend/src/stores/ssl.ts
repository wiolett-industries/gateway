import { create } from "zustand";
import { api } from "@/services/api";
import { useAuthStore } from "@/stores/auth";
import { useUIStore } from "@/stores/ui";
import type {
  LinkInternalCertRequest,
  RequestACMECertRequest,
  SSLCertificate,
  SSLCertificateOperationResult,
  SSLCertStatus,
  SSLCertType,
  UploadCertRequest,
} from "@/types";

interface SSLCertFilters {
  search: string;
  type: SSLCertType | "all";
  status: SSLCertStatus | "all";
}

interface SSLState {
  certificates: SSLCertificate[];
  selectedCert: SSLCertificate | null;
  isLoading: boolean;
  error: string | null;
  filters: SSLCertFilters;
  page: number;
  limit: number;
  total: number;
  totalPages: number;

  fetchCertificates: () => Promise<void>;
  selectCertificate: (id: string) => Promise<void>;
  clearSelected: () => void;
  requestACME: (
    data: RequestACMECertRequest
  ) => Promise<SSLCertificateOperationResult>;
  uploadCert: (data: UploadCertRequest) => Promise<SSLCertificate>;
  linkInternal: (data: LinkInternalCertRequest) => Promise<SSLCertificate>;
  renewCert: (id: string) => Promise<SSLCertificate | SSLCertificateOperationResult>;
  deleteCert: (id: string) => Promise<void>;
  completeDNSVerify: (id: string) => Promise<SSLCertificate>;
  setFilters: (filters: Partial<SSLCertFilters>) => void;
  setPage: (page: number) => void;
  resetFilters: () => void;
}

const defaultFilters: SSLCertFilters = {
  search: "",
  type: "all",
  status: "active",
};

export const useSSLStore = create<SSLState>()((set, get) => ({
  certificates: [],
  selectedCert: null,
  isLoading: false,
  error: null,
  filters: { ...defaultFilters },
  page: 1,
  limit: 25,
  total: 0,
  totalPages: 0,

  fetchCertificates: async () => {
    const { filters, page, limit } = get();
    const showSystem =
      useUIStore.getState().showSystemCertificates &&
      useAuthStore.getState().hasScope("admin:details:certificates");
    const isDefault =
      page === 1 && !filters.search && filters.type === "all" && filters.status === "active";
    const cacheKey = `ssl:list:${showSystem ? "system" : "default"}`;

    // Show cached data instantly for default view
    if (isDefault && get().certificates.length === 0) {
      const cached = api.getCached<{
        data: SSLCertificate[];
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
      const response = await api.listSSLCertificates({
        page,
        limit,
        search: filters.search || undefined,
        type: filters.type !== "all" ? filters.type : undefined,
        status: filters.status !== "all" ? filters.status : undefined,
        showSystem,
      });
      if (isDefault) api.setCache(cacheKey, response);
      set({
        certificates: response.data || [],
        total: response.pagination?.total ?? 0,
        totalPages: response.pagination?.totalPages ?? 0,
        isLoading: false,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to fetch SSL certificates";
      set({ error: message, isLoading: false });
    }
  },

  selectCertificate: async (id: string) => {
    const existing = get().certificates.find((c) => c.id === id);
    if (existing) {
      set({ selectedCert: existing });
    }
    try {
      const cert = await api.getSSLCertificate(id);
      set({ selectedCert: cert });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to fetch SSL certificate";
      set({ error: message });
    }
  },

  clearSelected: () => set({ selectedCert: null }),

  requestACME: async (data: RequestACMECertRequest) => {
    const result = await api.requestACMECert(data);
    get().fetchCertificates();
    return result;
  },

  uploadCert: async (data: UploadCertRequest) => {
    const cert = await api.uploadCert(data);
    get().fetchCertificates();
    return cert;
  },

  linkInternal: async (data: LinkInternalCertRequest) => {
    const cert = await api.linkInternalCert(data);
    get().fetchCertificates();
    return cert;
  },

  renewCert: async (id: string) => {
    const result = await api.renewSSLCert(id);
    const cert = "certificate" in result ? result.certificate : result;
    set((state) => ({
      certificates: state.certificates.map((c) => (c.id === id ? cert : c)),
      selectedCert: state.selectedCert?.id === id ? cert : state.selectedCert,
    }));
    return result;
  },

  deleteCert: async (id: string) => {
    await api.deleteSSLCert(id);
    set((state) => ({
      certificates: state.certificates.filter((c) => c.id !== id),
      selectedCert: state.selectedCert?.id === id ? null : state.selectedCert,
    }));
  },

  completeDNSVerify: async (id: string) => {
    const cert = await api.completeDNSVerify(id);
    set((state) => ({
      certificates: state.certificates.map((c) => (c.id === id ? cert : c)),
      selectedCert: state.selectedCert?.id === id ? cert : state.selectedCert,
    }));
    return cert;
  },

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
