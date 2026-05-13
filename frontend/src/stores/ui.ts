import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { Locale } from "@/i18n";

type Theme = "dark" | "light";

interface UIState {
  locale: Locale;
  theme: Theme;
  sidebarCollapsed: boolean;
  mobileNavOpen: boolean;
  setLocale: (l: Locale) => void;
  setTheme: (t: Theme) => void;
  toggleSidebar: () => void;
  setMobileNavOpen: (v: boolean) => void;
  toggleMobileNav: () => void;
}

export const useUI = create<UIState>()(
  persist(
    (set) => ({
      locale: "en",
      theme: "dark",
      sidebarCollapsed: false,
      mobileNavOpen: false,
      setLocale: (locale) => set({ locale }),
      setTheme: (theme) => set({ theme }),
      toggleSidebar: () =>
        set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      setMobileNavOpen: (v) => set({ mobileNavOpen: v }),
      toggleMobileNav: () => set((s) => ({ mobileNavOpen: !s.mobileNavOpen })),
    }),
    {
      name: "xenrelayproxy.ui",
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({
        locale: s.locale,
        theme: s.theme,
        sidebarCollapsed: s.sidebarCollapsed,
      }),
    },
  ),
);
