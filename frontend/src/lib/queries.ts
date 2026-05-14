import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as api from "./api";
import type { Config } from "@/types/domain";

export const QK = {
  stats: ["stats"] as const,
  status: ["status"] as const,
  config: ["config"] as const,
  cert: ["cert"] as const,
  scan: ["scan"] as const,
  codegs: ["codegs"] as const,
  caTrusted: ["caTrusted"] as const,
};

export function useStats(interval = 1000) {
  return useQuery({
    queryKey: QK.stats,
    queryFn: api.getStats,
    refetchInterval: interval,
    refetchIntervalInBackground: true,
    staleTime: 0,
  });
}

export function useStatus(interval = 2000) {
  return useQuery({
    queryKey: QK.status,
    queryFn: api.getStatus,
    refetchInterval: interval,
    staleTime: 0,
  });
}

export function useConfig() {
  return useQuery({
    queryKey: QK.config,
    queryFn: api.getConfig,
    staleTime: Infinity,
  });
}

export function useCACertInfo() {
  return useQuery({
    queryKey: QK.cert,
    queryFn: api.getCACertInfo,
    staleTime: 30_000,
  });
}

export function useStartRelay() {
  const qc = useQueryClient();
  return useMutation({
    // Refetch status inside the mutationFn so `isPending` stays true until the
    // backend's running=true is in the cache. Otherwise the hero briefly shows
    // the disconnected/off state between the mutation resolving and the next
    // status poll, which kills the connecting animation.
    mutationFn: async () => {
      await api.startRelay();
      await qc.refetchQueries({ queryKey: QK.status });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: QK.stats }),
  });
}

export function useStopRelay() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      await api.stopRelay();
      await qc.refetchQueries({ queryKey: QK.status });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: QK.stats }),
  });
}

export function useSaveConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (c: Config) => {
      await api.validateConfig(c);
      await api.saveConfig(c);
      return c;
    },
    onSuccess: (c) => {
      qc.setQueryData(QK.config, c);
      qc.invalidateQueries({ queryKey: QK.stats });
    },
  });
}

export function useToggleAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ label, enabled }: { label: string; enabled: boolean }) =>
      api.toggleAccount(label, enabled),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QK.config });
      qc.invalidateQueries({ queryKey: QK.stats });
    },
  });
}

export function useInstallCA() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.installCA,
    onSuccess: () => qc.invalidateQueries({ queryKey: QK.cert }),
  });
}

export function useUninstallCA() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.uninstallCA,
    onSuccess: () => qc.invalidateQueries({ queryKey: QK.cert }),
  });
}

export function useScanIPs() {
  return useMutation({ mutationFn: api.scanFrontIPs });
}

export function useGenerateAuthKey() {
  return useMutation({ mutationFn: api.generateAuthKey });
}
