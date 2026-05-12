import { useEffect, useState } from "react";
import { Save, ShieldCheck, Network, Download, Cpu } from "lucide-react";
import { toast } from "sonner";
import { useT } from "@/i18n";
import { useConfig, useSaveConfig } from "@/lib/queries";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { BLANK_CONFIG, type Config } from "@/types/domain";
import { NetworkTab } from "./NetworkTab";
import { SecurityTab } from "./SecurityTab";
import { DownloadsTab } from "./DownloadsTab";
import { AdvancedTab } from "./AdvancedTab";

export default function SettingsPage() {
  const t = useT();
  const { data: serverCfg } = useConfig();
  const save = useSaveConfig();
  const [cfg, setCfg] = useState<Config>(BLANK_CONFIG);

  useEffect(() => {
    if (serverCfg) setCfg(serverCfg);
  }, [serverCfg]);

  const isDirty =
    JSON.stringify(serverCfg ?? BLANK_CONFIG) !== JSON.stringify(cfg);

  async function onSave() {
    try {
      await save.mutateAsync(cfg);
      toast.success(t("toast.settingsSaved"));
    } catch (err) {
      toast.error(String(err));
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-5 animate-fade-in">
      <div className="flex items-center justify-between gap-3">
        <div>
          <span className="label-kicker">configure</span>
          <p className="mt-1 text-[13px] text-ink-3 max-w-2xl">
            Tune network, security, download chunking, and scheduler behavior. Changes apply on save.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isDirty && <Badge tone="warn">unsaved</Badge>}
          <Button variant="primary" onClick={onSave} disabled={!isDirty || save.isPending}>
            <Save />
            {t("settings.save")}
          </Button>
        </div>
      </div>

      <Tabs defaultValue="network">
        <TabsList>
          <TabsTrigger value="network">
            <Network />
            Network
          </TabsTrigger>
          <TabsTrigger value="security">
            <ShieldCheck />
            Security
          </TabsTrigger>
          <TabsTrigger value="downloads">
            <Download />
            Downloads
          </TabsTrigger>
          <TabsTrigger value="advanced">
            <Cpu />
            Advanced
          </TabsTrigger>
        </TabsList>

        <TabsContent value="network">
          <NetworkTab cfg={cfg} setCfg={setCfg} />
        </TabsContent>
        <TabsContent value="security">
          <SecurityTab cfg={cfg} setCfg={setCfg} />
        </TabsContent>
        <TabsContent value="downloads">
          <DownloadsTab cfg={cfg} setCfg={setCfg} />
        </TabsContent>
        <TabsContent value="advanced">
          <AdvancedTab cfg={cfg} setCfg={setCfg} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
