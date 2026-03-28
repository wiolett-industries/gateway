import { create } from "zustand";
import type {
  SSLCertificate,
  SSLCertType,
  SSLCertStatus,
  RequestACMECertRequest,
  UploadCertRequest,
  LinkInternalCertRequest,
  DNSChallenge,
} from "@/types";
import { api } from "@/services/api";

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
  requestACME: (data: RequestACMECertRequest) => Promise<SSLCertificate | { challenges: DNSChallenge[] }>;
  uploadCert: (data: UploadCertRequest) => Promise<SSLCertificate>;
  linkInternal: (data: LinkInternalCertRequest) => Promise<SSLCertificate>;
  renewCert: (id: string) => Promise<SSLCertificate>;
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
    set({ isLoading: true, error: null });
    try {
      const response = await api.listSSLCertificates({
        page,
        limit,
        search: filters.search || undefined,
        type: filters.type !== "all" ? filters.type : undefined,
        status: filters.status !== "all" ? filters.status : undefined,
      });
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
    const cert = await api.renewSSLCert(id);
    set((state) => ({
      certificates: state.certificates.map((c) => (c.id === id ? cert : c)),
      selectedCert: state.selectedCert?.id === id ? cert : state.selectedCert,
    }));
    return cert;
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
