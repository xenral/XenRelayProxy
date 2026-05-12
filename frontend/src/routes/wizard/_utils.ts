import {
  Cloud,
  KeyRound,
  Rocket,
  ShieldCheck,
  Sparkles,
  Wand2,
  type LucideIcon,
} from "lucide-react";

export type RelayMode = "apps_script" | "vercel";

export type WizardStep = "welcome" | "mode" | "auth" | "account" | "cert" | "done";

export const ORDER: WizardStep[] = ["welcome", "mode", "auth", "account", "cert", "done"];

export const VERCEL_DEPLOY_URL =
  "https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FAlimorshedZade%2FXenRelayProxy&root-directory=vercel&env=RELAY_TOKEN&envDescription=Shared%20secret%20your%20XenRelayProxy%20client%20presents.";

export const RAIL: { id: WizardStep; labelKey: string; icon: LucideIcon }[] = [
  { id: "welcome", labelKey: "wizard.rail.welcome", icon: Sparkles },
  { id: "mode", labelKey: "wizard.rail.mode", icon: Cloud },
  { id: "auth", labelKey: "wizard.rail.auth", icon: KeyRound },
  { id: "account", labelKey: "wizard.rail.account", icon: Wand2 },
  { id: "cert", labelKey: "wizard.rail.cert", icon: ShieldCheck },
  { id: "done", labelKey: "wizard.rail.done", icon: Rocket },
];

export function isPlaceholderKey(k: string): boolean {
  const v = (k || "").trim();
  if (!v) return true;
  if (v === "CHANGE_ME_TO_A_STRONG_SECRET") return true;
  if (v === "your-secret-password-here") return true;
  return false;
}

export function maskKey(k: string): string {
  if (!k) return "—";
  if (k.length < 12) return k;
  return k.slice(0, 6) + "…" + k.slice(-4);
}
