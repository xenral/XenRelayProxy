import { Eye, EyeOff, KeyRound, RefreshCw } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useT } from "@/i18n";
import { useGenerateAuthKey } from "@/lib/queries";
import { Button } from "@/components/ui/button";
import { Input, Label, FieldHint } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SettingsCard, ToggleRow } from "./_shared";
import type { Config } from "@/types/domain";

interface Props {
  cfg: Config;
  setCfg: (c: Config) => void;
}

const LOG_LEVELS = ["DEBUG", "INFO", "WARN", "ERROR"] as const;

export function SecurityTab({ cfg, setCfg }: Props) {
  const t = useT();
  const gen = useGenerateAuthKey();
  const [reveal, setReveal] = useState(false);

  async function regenerate() {
    try {
      const k = await gen.mutateAsync();
      setCfg({ ...cfg, auth_key: k });
      toast.success("New auth key generated. Update Code.gs / RELAY_TOKEN.");
    } catch (err) {
      toast.error(String(err));
    }
  }

  return (
    <div className="space-y-4">
      <SettingsCard
        kicker="secret"
        title="Authentication"
        description="Shared secret between this client and your Apps Script / Vercel relay. Both sides must hold the same value."
      >
        <div className="space-y-1.5">
          <Label className="inline-flex items-center gap-1.5">
            <KeyRound className="size-3" />
            {t("settings.authKey")}
          </Label>
          <div className="flex gap-2">
            <Input
              type={reveal ? "text" : "password"}
              value={cfg.auth_key}
              onChange={(e) => setCfg({ ...cfg, auth_key: e.target.value })}
              className="flex-1 font-mono text-[12px]"
            />
            <Button
              variant="secondary"
              size="icon"
              onClick={() => setReveal((r) => !r)}
              aria-label={reveal ? "Hide" : "Reveal"}
            >
              {reveal ? <EyeOff /> : <Eye />}
            </Button>
            <Button variant="secondary" onClick={regenerate} disabled={gen.isPending}>
              <RefreshCw className={gen.isPending ? "animate-spin" : ""} />
              Regenerate
            </Button>
          </div>
          <FieldHint>Re-deploy Apps Script or update RELAY_TOKEN env var after rotating.</FieldHint>
        </div>

        <div className="space-y-1.5">
          <Label>{t("settings.logLevel")}</Label>
          <Select value={cfg.log_level} onValueChange={(v) => setCfg({ ...cfg, log_level: v })}>
            <SelectTrigger className="max-w-[200px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LOG_LEVELS.map((l) => (
                <SelectItem key={l} value={l}>
                  {l}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </SettingsCard>

      <SettingsCard
        kicker="behavior"
        title="Traffic routing"
        description="Fine-tune which hosts bypass the relay and how cookies are logged."
      >
        <ToggleRow
          label={t("settings.forceRelaySNI")}
          hint={t("settings.forceRelaySNIHelp")}
          checked={!!cfg.force_relay_sni_hosts}
          onChange={(v) => setCfg({ ...cfg, force_relay_sni_hosts: v })}
        />
        <ToggleRow
          label={t("settings.cookieDebug")}
          hint={t("settings.cookieDebugHelp")}
          checked={!!cfg.cookie_debug_mode}
          onChange={(v) => setCfg({ ...cfg, cookie_debug_mode: v })}
        />
      </SettingsCard>
    </div>
  );
}
