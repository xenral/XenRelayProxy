import { lazy, Suspense } from "react";
import { Outlet, Route, Routes, useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Sidebar } from "@/components/layout/Sidebar";
import { TopBar } from "@/components/layout/TopBar";
import { ErrorBoundary } from "./ErrorBoundary";
import { useUI } from "@/stores/ui";
import { isSetupCompleted } from "@/lib/api";

const Home = lazy(() => import("@/routes/home"));
const Accounts = lazy(() => import("@/routes/accounts"));
const Logs = lazy(() => import("@/routes/logs"));
const Settings = lazy(() => import("@/routes/settings"));
const Certificate = lazy(() => import("@/routes/certificate"));
const Terminal = lazy(() => import("@/routes/terminal"));
const Wizard = lazy(() => import("@/routes/wizard"));
const PythonRelay = lazy(() => import("@/routes/python-relay"));
const VercelRelay = lazy(() => import("@/routes/vercel-relay"));
const About = lazy(() => import("@/routes/about"));

function RouteFallback() {
  return (
    <div className="flex h-full items-center justify-center text-ink-3">
      <Loader2 className="size-4 animate-spin" />
    </div>
  );
}

function AppShell() {
  const locale = useUI((s) => s.locale);
  return (
    <div className="relative flex h-screen overflow-hidden">
      <div className="atmosphere" />
      <Sidebar />
      <div className="relative z-10 flex min-w-0 flex-1 flex-col">
        <TopBar />
        <main className="flex-1 overflow-y-auto px-4 py-5 sm:px-6 sm:py-6 md:px-7 md:py-7">
          <ErrorBoundary locale={locale}>
            <Suspense fallback={<RouteFallback />}>
              <Outlet />
            </Suspense>
          </ErrorBoundary>
        </main>
      </div>
    </div>
  );
}

function FirstRunGate({ children }: { children: React.ReactNode }) {
  const [checked, setChecked] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;
    isSetupCompleted()
      .then((done) => {
        if (cancelled) return;
        if (!done) navigate("/wizard", { replace: true });
        setChecked(true);
      })
      .catch(() => setChecked(true));
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  if (!checked) return <RouteFallback />;
  return <>{children}</>;
}

export function AppRouter() {
  return (
    <Routes>
      {/* Wizard renders standalone (no chrome) for first-run + manual visits */}
      <Route
        path="/wizard"
        element={
          <Suspense fallback={<RouteFallback />}>
            <Wizard />
          </Suspense>
        }
      />
      <Route
        element={
          <FirstRunGate>
            <AppShell />
          </FirstRunGate>
        }
      >
        <Route index element={<Home />} />
        <Route path="accounts" element={<Accounts />} />
        <Route path="logs" element={<Logs />} />
        <Route path="settings" element={<Settings />} />
        <Route path="certificate" element={<Certificate />} />
        <Route path="terminal" element={<Terminal />} />
        <Route path="python-relay" element={<PythonRelay />} />
        <Route path="vercel-relay" element={<VercelRelay />} />
        <Route path="about" element={<About />} />
      </Route>
    </Routes>
  );
}
