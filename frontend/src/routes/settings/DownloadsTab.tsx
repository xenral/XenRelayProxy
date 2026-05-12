import { useT } from "@/i18n";
import { Field, SettingsCard, TextField } from "./_shared";
import { Input } from "@/components/ui/input";
import type { Config } from "@/types/domain";

interface Props {
  cfg: Config;
  setCfg: (c: Config) => void;
}

export function DownloadsTab({ cfg, setCfg }: Props) {
  const t = useT();
  return (
    <SettingsCard
      kicker="chunking"
      title={t("settings.dl.section")}
      description={t("settings.dl.sectionHelp")}
    >
      <div className="grid gap-4 md:grid-cols-2">
        <Field label={t("settings.dl.maxResponseMB")} hint={t("settings.dl.maxResponseMBHelp")}>
          <Input
            type="number"
            min={1}
            value={Math.round(cfg.max_response_body_bytes / (1024 * 1024))}
            onChange={(e) =>
              setCfg({
                ...cfg,
                max_response_body_bytes: Math.max(1, Number(e.target.value)) * 1024 * 1024,
              })
            }
          />
        </Field>
        <Field label={t("settings.dl.minSizeMB")} hint={t("settings.dl.minSizeMBHelp")}>
          <Input
            type="number"
            min={1}
            value={Math.round(cfg.chunked_download_min_size / (1024 * 1024))}
            onChange={(e) =>
              setCfg({
                ...cfg,
                chunked_download_min_size: Math.max(1, Number(e.target.value)) * 1024 * 1024,
              })
            }
          />
        </Field>
        <Field label={t("settings.dl.chunkSizeKB")} hint={t("settings.dl.chunkSizeKBHelp")}>
          <Input
            type="number"
            min={64}
            value={Math.round(cfg.chunked_download_chunk_size / 1024)}
            onChange={(e) =>
              setCfg({
                ...cfg,
                chunked_download_chunk_size: Math.max(64, Number(e.target.value)) * 1024,
              })
            }
          />
        </Field>
        <Field label={t("settings.dl.maxParallel")} hint={t("settings.dl.maxParallelHelp")}>
          <Input
            type="number"
            min={1}
            max={32}
            value={cfg.chunked_download_max_parallel}
            onChange={(e) =>
              setCfg({
                ...cfg,
                chunked_download_max_parallel: Math.max(1, Number(e.target.value)),
              })
            }
          />
        </Field>
        <Field label={t("settings.dl.maxChunks")} hint={t("settings.dl.maxChunksHelp")} className="md:col-span-2">
          <Input
            type="number"
            min={1}
            value={cfg.chunked_download_max_chunks}
            onChange={(e) =>
              setCfg({
                ...cfg,
                chunked_download_max_chunks: Math.max(1, Number(e.target.value)),
              })
            }
            className="max-w-[200px]"
          />
        </Field>
      </div>

      <Field label={t("settings.dl.extensions")} hint={t("settings.dl.extensionsHelp")}>
        <Input
          value={(cfg.chunked_download_extensions ?? []).join(", ")}
          onChange={(e) =>
            setCfg({
              ...cfg,
              chunked_download_extensions: e.target.value
                .split(",")
                .map((s) => {
                  const v = s.trim().toLowerCase();
                  if (!v) return "";
                  return v.startsWith(".") ? v : "." + v;
                })
                .filter(Boolean),
            })
          }
          placeholder=".zip, .pdf, .mp4, .iso"
          className="font-mono text-[12px]"
        />
      </Field>
    </SettingsCard>
  );
}
