import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { Locale } from "@/i18n";

type Theme = "dark" | "light";

interface UIState {
  locale: Locale;
  theme: Theme;
  sidebarCollapsed: boolean;
  setLocale: (l: Locale) => void;
  setTheme: (t: Theme) => void;
  toggleSidebar: () => void;
}

export const useUI = create<UIState>()(
  persist(
    (set) => ({
      locale: "en",
      theme: "dark",
      sidebarCollapsed: false,
      setLocale: (locale) => set({ locale }),
      setTheme: (theme) => set({ theme }),
      toggleSidebar: () =>
        set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
    }),
    {
      name: "xenrelayproxy.ui",
      storage: createJSONStorage(() => localStorage),
    },
  ),
);
