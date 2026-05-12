import { useState } from "react";
import {
  AlertTriangle, CheckCircle2, Copy, FolderOpen, KeyRound, ShieldCheck, ShieldOff,
} from "lucide-react";
import { toast } from "sonner";
import { useT } from "@/i18n";
import { useCACertInfo, useInstallCA, useUninstallCA } from "@/lib/queries";
import { revealCACert } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AutoGuide } from "./guides/Auto";
import { MacOSGuide } from "./guides/MacOS";
import { FirefoxGuide } from "./guides/Firefox";
import { WindowsGuide } from "./guides/Windows";
import { LinuxGuide } from "./guides/Linux";

export default function CertificatePage() {
  const t = useT();
  const { data: info } = useCACertInfo();
  const install = useInstallCA();
  const uninstall = useUninstallCA();
  const [copied, setCopied] = useState(false);

  const trusted = info?.trusted ?? false;
  const certPath = info?.cert_path ?? "";

  async function copyPEM() {
    if (!info?.pem) return;
    await navigator.clipboard.writeText(info.pem);
    setCopied(true);
    toast.success(t("toast.pemCopied"));
    setTimeout(() => setCopied(false), 1500);
  }

  async function onInstall() {
    try {
      await install.mutateAsync();
      toast.success(t("toast.caInstalled"));
    } catch (err) {
      toast.error(String(err));
    }
  }

  async function onUninstall() {
    try {
      await uninstall.mutateAsync();
      toast.info(t("toast.caRemoved"));
    } catch (err) {
      toast.error(String(err));
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-5 animate-fade-in">
      {info?.exists && (
        <Card className="p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <Badge tone={trusted ? "success" : "danger"}>
                {trusted ? (
                  <CheckCircle2 className="size-3" />
                ) : (
                  <AlertTriangle className="size-3" />
                )}
                {trusted ? t("cert.trustedBySystem") : t("cert.notTrusted")}
              </Badge>
              <span className="font-mono text-[10.5px] uppercase tracking-[0.18em] text-ink-3">
                {t("cert.status")}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={() => revealCACert().catch(() => {})}>
                <FolderOpen />
                {t("cert.showInFinder")}
              </Button>
              <Button variant="ghost" size="sm" onClick={copyPEM}>
                {copied ? <CheckCircle2 className="text-signal" /> : <Copy />}
                {t("cert.copyPEM")}
              </Button>
              {trusted && (
                <Button variant="danger" size="sm" onClick={onUninstall} disabled={uninstall.isPending}>
                  <ShieldOff />
                  {t("cert.remove")}
                </Button>
              )}
            </div>
          </div>

          <dl className="mt-5 grid gap-y-3 gap-x-6 md:grid-cols-2 text-[12.5px]">
            <DL label={t("cert.subject")} value={info.subject || "—"} />
            <DL
              label={t("cert.validUntil")}
              value={info.not_after || "—"}
              danger={!!info.not_after && new Date(info.not_after) < new Date()}
            />
            <DL label={t("cert.fingerprint")} value={info.fingerprint || "—"} mono full />
            <DL label={t("cert.path")} value={certPath} mono full />
          </dl>
        </Card>
      )}

      <Tabs defaultValue="auto">
        <TabsList>
          <TabsTrigger value="auto">
            <ShieldCheck />
            {t("cert.tab.auto")}
          </TabsTrigger>
          <TabsTrigger value="macos">{t("cert.tab.macos")}</TabsTrigger>
          <TabsTrigger value="firefox">{t("cert.tab.firefox")}</TabsTrigger>
          <TabsTrigger value="windows">{t("cert.tab.windows")}</TabsTrigger>
          <TabsTrigger value="linux">{t("cert.tab.linux")}</TabsTrigger>
        </TabsList>

        <TabsContent value="auto">
          <AutoGuide trusted={trusted} onInstall={onInstall} installing={install.isPending} />
        </TabsContent>
        <TabsContent value="macos">
          <MacOSGuide certPath={certPath} />
        </TabsContent>
        <TabsContent value="firefox">
          <FirefoxGuide certPath={certPath} />
        </TabsContent>
        <TabsContent value="windows">
          <WindowsGuide certPath={certPath} />
        </TabsContent>
        <TabsContent value="linux">
          <LinuxGuide certPath={certPath} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function DL({
  label, value, danger, mono, full,
}: {
  label: string;
  value: string;
  danger?: boolean;
  mono?: boolean;
  full?: boolean;
}) {
  return (
    <div className={`flex flex-col gap-1 ${full ? "md:col-span-2" : ""}`}>
      <dt className="label-kicker">{label}</dt>
      <dd className={`break-all text-ink-1 ${mono ? "font-mono text-[11.5px]" : "text-[13px]"} ${danger ? "text-danger" : ""}`}>
        {value}
      </dd>
    </div>
  );
}
