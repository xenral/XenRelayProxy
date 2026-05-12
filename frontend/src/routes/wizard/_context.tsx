import { createContext, useContext } from "react";
import type { RelayMode } from "./_utils";

export interface WizardState {
  mode: RelayMode;
  setMode: (m: RelayMode) => void;

  authKey: string;
  setAuthKey: (s: string) => void;

  frontDomain: string;
  setFrontDomain: (s: string) => void;

  googleIP: string;
  setGoogleIP: (s: string) => void;

  accLabel: string;
  setAccLabel: (s: string) => void;

  accEmail: string;
  setAccEmail: (s: string) => void;

  scriptIDs: string[];
  setScriptIDs: (a: string[]) => void;

  vercelURL: string;
  setVercelURL: (s: string) => void;

  dailyQuota: number;
  setDailyQuota: (n: number) => void;
}

export const WizardCtx = createContext<WizardState | null>(null);

export function useWizard(): WizardState {
  const v = useContext(WizardCtx);
  if (!v) throw new Error("useWizard must be used within WizardCtx.Provider");
  return v;
}
