import { useEffect } from "react";
import {
  BadgeInfo, FileText, Gauge, Globe2, KeyRound, Languages, MonitorSmartphone,
  Moon, Server, Settings as SettingsIcon, ShieldCheck, Sun, Terminal as TerminalIcon, Users, Wand2, X,
} from "lucide-react";
import { NavLink, useLocation } from "react-router-dom";
import { useT, type Locale } from "@/i18n";
import { useUI } from "@/stores/ui";
import { useStatus } from "@/lib/queries";
import { cn } from "@/lib/utils";

type NavGroup = {
  label: string;
  items: { to: string; key: string; icon: React.ElementType }[];
};

const GROUPS: NavGroup[] = [
  {
    label: "console",
    items: [
      { to: "/", key: "nav.home", icon: Gauge },
      { to: "/accounts", key: "nav.accounts", icon: Users },
      { to: "/logs", key: "nav.logs", icon: FileText },
    ],
  },
  {
    label: "configure",
    items: [
      { to: "/settings", key: "nav.settings", icon: SettingsIcon },
      { to: "/certificate", key: "nav.cert", icon: ShieldCheck },
      { to: "/terminal", key: "nav.terminal", icon: TerminalIcon },
    ],
  },
  {
    label: "guides",
    items: [
      { to: "/wizard", key: "nav.wizard", icon: Wand2 },
      { to: "/python-relay", key: "nav.pythonRelayGuide", icon: Server },
      { to: "/vercel-relay", key: "nav.vercelRelayGuide", icon: Globe2 },
      { to: "/about", key: "nav.about", icon: BadgeInfo },
    ],
  },
];

export function Sidebar() {
  const t = useT();
  const locale = useUI((s) => s.locale);
  const theme = useUI((s) => s.theme);
  const setLocale = useUI((s) => s.setLocale);
  const setTheme = useUI((s) => s.setTheme);
  const mobileNavOpen = useUI((s) => s.mobileNavOpen);
  const setMobileNavOpen = useUI((s) => s.setMobileNavOpen);
  const status = useStatus().data;
  const location = useLocation();

  const nextLocale: Locale = locale === "en" ? "fa" : "en";

  // Auto-close drawer on route change
  useEffect(() => {
    if (mobileNavOpen) setMobileNavOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  // Lock body scroll while drawer is open
  useEffect(() => {
    if (mobileNavOpen) {
      const prev = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = prev;
      };
    }
  }, [mobileNavOpen]);

  // Close on Escape
  useEffect(() => {
    if (!mobileNavOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMobileNavOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mobileNavOpen, setMobileNavOpen]);

  return (
    <>
      {/* Backdrop — only present on small screens when drawer is open */}
      <div
        onClick={() => setMobileNavOpen(false)}
        aria-hidden
        className={cn(
          "fixed inset-0 z-30 bg-black/60 backdrop-blur-sm transition-opacity duration-200 lg:hidden",
          mobileNavOpen ? "opacity-100" : "pointer-events-none opacity-0",
        )}
      />

      <aside
        className={cn(
          "z-40 flex w-[260px] shrink-0 flex-col border-r border-line-subtle bg-bg-raised/90 backdrop-blur-md",
          // Mobile: fixed off-canvas drawer
          "fixed inset-y-0 left-0 transition-transform duration-300 ease-out",
          mobileNavOpen ? "translate-x-0" : "-translate-x-full",
          // Desktop: in-flow, persistent
          "lg:relative lg:translate-x-0 lg:bg-bg-raised/40",
        )}
        aria-label="Primary navigation"
      >
        {/* Brand row */}
        <div className="flex items-center gap-3 px-5 py-5">
          <div className="relative">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-signal/40 bg-signal/10">
              <KeyRound className="size-4 text-signal" />
            </div>
            <span className="absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full bg-signal shadow-[0_0_8px_hsl(var(--signal))]" />
          </div>
          <div className="flex flex-1 min-w-0 flex-col leading-tight">
            <span className="display text-[19px] tracking-tight text-ink-1">XenRelay</span>
            <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-3 truncate">
              v{status?.version ?? "1.4.1"} · proxy
            </span>
          </div>
          <button
            onClick={() => setMobileNavOpen(false)}
            className="lg:hidden flex h-8 w-8 items-center justify-center rounded-full text-ink-3 hover:bg-bg-inset hover:text-ink-1 transition-colors"
            aria-label="Close navigation"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="hairline h-px mx-5" />

        {/* Nav groups */}
        <nav className="flex-1 overflow-y-auto px-3 py-4">
          {GROUPS.map((g, gi) => (
            <div key={g.label} className={cn(gi > 0 && "mt-5")}>
              <div className="px-3 mb-2 font-mono text-[10px] uppercase tracking-[0.22em] text-ink-3">
                {g.label}
              </div>
              <ul className="space-y-0.5">
                {g.items.map((it) => (
                  <li key={it.to}>
                    <NavLink
                      to={it.to}
                      end={it.to === "/"}
                      className={({ isActive }) =>
                        cn(
                          "group relative flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] transition-colors",
                          isActive
                            ? "text-ink-1 bg-bg-inset"
                            : "text-ink-2 hover:text-ink-1 hover:bg-bg-inset/60",
                        )
                      }
                    >
                      {({ isActive }) => (
                        <>
                          {isActive && (
                            <span className="absolute inset-y-1.5 left-0 w-[2px] rounded-r-full bg-signal" />
                          )}
                          <it.icon className="size-3.5 shrink-0" />
                          <span className="truncate">{t(it.key)}</span>
                        </>
                      )}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>

        {/* Footer: lang + theme */}
        <div className="flex items-center justify-between border-t border-line-subtle px-3 py-3">
          <button
            onClick={() => setLocale(nextLocale)}
            className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-[12px] text-ink-2 hover:text-ink-1 hover:bg-bg-inset transition-colors"
          >
            <Languages className="size-3.5" />
            <span className="font-mono uppercase tracking-wider text-[10.5px]">
              {t("lang.toggle")}
            </span>
          </button>
          <div className="inline-flex items-center gap-0.5 rounded-full border border-line-subtle bg-bg-inset/60 p-0.5">
            <ThemeBtn
              active={theme === "dark"}
              onClick={() => setTheme("dark")}
              icon={<Moon className="size-3.5" />}
              label="Dark"
            />
            <ThemeBtn
              active={theme === "light"}
              onClick={() => setTheme("light")}
              icon={<Sun className="size-3.5" />}
              label="Light"
            />
          </div>
        </div>
      </aside>
    </>
  );
}

function ThemeBtn({
  active, onClick, icon, label,
}: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      className={cn(
        "flex items-center justify-center rounded-full p-1.5 transition-colors",
        active ? "bg-bg-overlay text-ink-1 shadow-ring" : "text-ink-3 hover:text-ink-1",
      )}
    >
      {icon}
    </button>
  );
}
