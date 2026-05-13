import * as React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { LocaleContext } from "@/i18n";
import { useUI } from "@/stores/ui";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 0,
      refetchOnWindowFocus: false,
      staleTime: 5_000,
    },
  },
});

export function AppProviders({ children }: { children: React.ReactNode }) {
  const locale = useUI((s) => s.locale);
  const theme = useUI((s) => s.theme);

  React.useEffect(() => {
    const root = document.documentElement;
    root.classList.remove("theme-light", "theme-dark");
    root.classList.add(theme === "light" ? "theme-light" : "theme-dark");
    root.setAttribute("dir", locale === "fa" ? "rtl" : "ltr");
    root.setAttribute("lang", locale);
  }, [theme, locale]);

  return (
    <QueryClientProvider client={queryClient}>
      <LocaleContext.Provider value={locale}>
        <TooltipProvider delayDuration={200}>
          {children}
          <Toaster
            position="bottom-right"
            theme={theme}
            toastOptions={{
              style: {
                background: "hsl(var(--bg-overlay))",
                color: "hsl(var(--ink-1))",
                border: "1px solid hsl(var(--line-strong))",
                fontFamily: "Geist, system-ui, sans-serif",
                fontSize: "13px",
                borderRadius: "10px",
              },
            }}
          />
        </TooltipProvider>
      </LocaleContext.Provider>
    </QueryClientProvider>
  );
}
