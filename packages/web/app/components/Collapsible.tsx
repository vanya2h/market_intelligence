import type { ReactNode } from "react";

export function Collapsible({
  title,
  children,
  defaultOpen = false,
  variant = "surface",
}: {
  title: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  /** "surface" uses bg-surface + border (cards). "subtle" uses bg-hover (inline FAQ-style). */
  variant?: "surface" | "subtle";
}) {
  const styles =
    variant === "surface"
      ? { background: "var(--bg-surface)", border: "1px solid var(--border-subtle)" }
      : { background: "var(--bg-hover)" };

  return (
    <details className="group rounded-md" open={defaultOpen || undefined} style={styles}>
      <summary
        className="flex cursor-pointer select-none items-center gap-2 p-3 text-sm font-medium"
        style={{ color: "var(--text-primary)" }}
      >
        <span
          className="flex h-4 w-4 shrink-0 items-center justify-center text-[0.625rem] transition-transform group-open:rotate-90"
          style={{ color: "var(--text-muted)" }}
        >
          ▶
        </span>
        {title}
      </summary>
      <div className="px-3 pb-3 pl-9">{children}</div>
    </details>
  );
}
