export function StickyFooter() {
  return (
    <footer
      className="sticky bottom-0 z-30 flex items-center justify-between gap-4 px-3 py-2 text-[0.6875rem] md:px-4"
      style={{
        background: "var(--bg-card)",
        borderTop: "1px solid var(--border)",
        color: "var(--text-muted)",
      }}
    >
      <span>Beta version — data may contain inconsistencies</span>
      <div className="flex items-center gap-3">
        <a
          href="https://x.com/vanya2h4u"
          target="_blank"
          rel="noopener noreferrer"
          className="transition-colors"
          onMouseEnter={(e) => (e.currentTarget.style.color = "var(--text-secondary)")}
          onMouseLeave={(e) => (e.currentTarget.style.color = "var(--text-muted)")}
        >
          Me in X
        </a>
        <span>&middot;</span>
        <a
          href="https://t.me/vanya2htrades"
          target="_blank"
          rel="noopener noreferrer"
          className="transition-colors"
          onMouseEnter={(e) => (e.currentTarget.style.color = "var(--text-secondary)")}
          onMouseLeave={(e) => (e.currentTarget.style.color = "var(--text-muted)")}
        >
          My Telegram Channel
        </a>
      </div>
    </footer>
  );
}
