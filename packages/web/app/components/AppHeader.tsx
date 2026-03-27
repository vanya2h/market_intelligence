import { useEffect, useState, type ReactNode } from "react";
import { Link, useLocation } from "react-router";
import { BriefHistoryDialog } from "./BriefHistoryDialog";
import { TabBar } from "./TabBar";

function LiveClock() {
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <span className="font-mono-jb text-[11px] tabular-nums">
      {now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
    </span>
  );
}

export function AppHeader({ children, currentBriefId }: { children?: ReactNode; currentBriefId?: string }) {
  const { pathname } = useLocation();
  const [historyOpen, setHistoryOpen] = useState(false);

  const activeKey = pathname.startsWith("/guide") ? "guide" : "home";

  function handleTabSelect(key: string) {
    if (key === "history") setHistoryOpen(true);
  }

  return (
    <div className="sticky top-0 z-30" style={{ background: "var(--bg-card)" }}>
      {/* Primary header: logo + nav + clock + live */}
      <nav
        className="flex h-10 items-center justify-between px-3 md:px-4"
        style={{ borderBottom: children ? "1px solid var(--border-subtle)" : "1px solid var(--border)" }}
      >
        <div className="flex flex-row gap-4 items-center">
          <Link to="/" className="flex items-center gap-2">
            <img src="/asterisk.png" alt="" className="h-5 w-5" />
            <span
              className="hidden text-sm font-semibold tracking-tight sm:inline"
              style={{ color: "var(--text-primary)" }}
            >
              Vanya2h's Intelligence System
            </span>
          </Link>
          <TabBar
            items={[
              { key: "home", label: "Home", to: "/" },
              { key: "history", label: "History" },
              { key: "guide", label: "Guide", to: "/guide" },
            ]}
            activeKey={activeKey}
            onSelect={handleTabSelect}
          />
          <BriefHistoryDialog currentBriefId={currentBriefId} open={historyOpen} onOpenChange={setHistoryOpen} />
        </div>
        <div className="flex items-center gap-3">
          <span className="hidden sm:inline-flex items-center">
            <LiveClock />
          </span>

          <div className="flex items-center gap-1.5">
            <div className="live-dot h-1.5 w-1.5 rounded-full" style={{ background: "var(--green)" }} />
            <span className="text-[11px] font-medium font-mono-jb" style={{ color: "var(--green)" }}>
              LIVE
            </span>
          </div>
        </div>
      </nav>

      {/* Subheader: page-specific content */}
      {children && (
        <div className="flex h-9 items-center px-3 md:px-4" style={{ borderBottom: "1px solid var(--border)" }}>
          {children}
        </div>
      )}
    </div>
  );
}
