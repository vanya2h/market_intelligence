import type { AssetType } from "@market-intel/api";
import * as Dialog from "@radix-ui/react-dialog";
import * as Tabs from "@radix-ui/react-tabs";
import { format } from "date-fns";
import { useEffect, useState } from "react";
import { Link, useFetcher } from "react-router";

type Asset = AssetType;

interface BriefHistoryEntry {
  id: string;
  timestamp: string;
}

interface FetcherData {
  briefs: BriefHistoryEntry[];
}

interface BriefHistoryDialogProps {
  currentBriefId?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function BriefHistoryDialog({ currentBriefId, open, onOpenChange }: BriefHistoryDialogProps) {
  const [asset, setAsset] = useState<Asset>("BTC");

  function handleAssetChange(value: string) {
    setAsset(value as Asset);
  }
  const fetcher = useFetcher<FetcherData>();

  useEffect(() => {
    if (open) {
      fetcher.load(`/brief-history?asset=${asset}`);
    }
  }, [open, asset]);

  const briefs = fetcher.data?.briefs ?? [];
  const isLoading = fetcher.state === "loading";

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50" style={{ background: "rgba(0,0,0,0.4)" }} />
        <Dialog.Content
          className="fixed right-0 top-0 z-50 flex h-full w-72 flex-col focus:outline-none"
          style={{
            background: "var(--bg-card)",
            borderLeft: "1px solid var(--border)",
          }}
        >
          {/* Header */}
          <div
            className="flex h-10 shrink-0 items-center justify-between px-4"
            style={{ borderBottom: "1px solid var(--border)" }}
          >
            <Dialog.Title
              className="text-xs font-semibold uppercase tracking-wider"
              style={{ color: "var(--text-primary)" }}
            >
              Brief History
            </Dialog.Title>
            <Dialog.Close asChild>
              <button
                className="flex h-6 w-6 items-center justify-center rounded text-xs transition-colors"
                style={{ color: "var(--text-muted)" }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-hover)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
              >
                ✕
              </button>
            </Dialog.Close>
          </div>

          {/* Asset switcher */}
          <Tabs.Root
            value={asset}
            onValueChange={handleAssetChange}
            className="shrink-0"
            style={{ borderBottom: "1px solid var(--border)" }}
          >
            <Tabs.List className="flex w-full items-center gap-0">
              {(["BTC", "ETH"] as Asset[]).map((a) => (
                <Tabs.Trigger
                  key={a}
                  value={a}
                  className={`relative flex-1 py-2 text-xs font-medium tracking-wide transition-colors ${asset === a ? "tab-active" : ""}`}
                  style={{
                    color: asset === a ? "var(--text-primary)" : "var(--text-muted)",
                  }}
                >
                  {a}
                </Tabs.Trigger>
              ))}
            </Tabs.List>
          </Tabs.Root>

          {/* Brief list */}
          <div className="flex-1 overflow-y-auto">
            {isLoading ? (
              <div className="flex h-20 items-center justify-center">
                <span className="text-[0.6875rem]" style={{ color: "var(--text-muted)" }}>
                  Loading…
                </span>
              </div>
            ) : briefs.length === 0 ? (
              <div className="flex h-20 items-center justify-center">
                <span className="text-[0.6875rem]" style={{ color: "var(--text-muted)" }}>
                  No briefs found
                </span>
              </div>
            ) : (
              <nav className="py-1">
                {briefs.map((brief) => {
                  const isActive = brief.id === currentBriefId;
                  return (
                    <Link
                      key={brief.id}
                      to={`/brief/${brief.id}`}
                      onClick={() => onOpenChange(false)}
                      className="flex items-center px-4 py-2.5 text-xs transition-colors"
                      style={{
                        color: isActive ? "var(--text-primary)" : "var(--text-secondary)",
                        background: isActive ? "var(--bg-hover)" : "transparent",
                        borderLeft: isActive ? "2px solid var(--green)" : "2px solid transparent",
                      }}
                      onMouseEnter={(e) => {
                        if (!isActive) (e.currentTarget as HTMLAnchorElement).style.background = "var(--bg-hover)";
                      }}
                      onMouseLeave={(e) => {
                        if (!isActive) (e.currentTarget as HTMLAnchorElement).style.background = "transparent";
                      }}
                    >
                      <span className="font-mono-jb tabular-nums">
                        {format(brief.timestamp, "MMM d, yyyy · HH:mm")}
                      </span>
                    </Link>
                  );
                })}
              </nav>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
