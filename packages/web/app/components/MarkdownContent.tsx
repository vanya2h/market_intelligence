import Markdown from "react-markdown";

export function MarkdownContent({ children, className }: { children: string; className?: string }) {
  return (
    <div className={`text-xs leading-relaxed max-w-none ${className ?? ""}`} style={{ color: "var(--text-secondary)" }}>
      <Markdown
        components={{
          h1: ({ children }) => <h1 className="mb-3 mt-4 first:mt-0 text-base font-semibold" style={{ color: "var(--text-primary)" }}>{children}</h1>,
          h2: ({ children }) => <h2 className="mb-2 mt-3 first:mt-0 text-sm font-semibold" style={{ color: "var(--text-primary)" }}>{children}</h2>,
          h3: ({ children }) => <h3 className="mb-2 mt-3 first:mt-0 text-xs font-semibold" style={{ color: "var(--text-primary)" }}>{children}</h3>,
          p: ({ children }) => <p className="mb-3 last:mb-0">{children}</p>,
          strong: ({ children }) => (
            <strong className="font-semibold" style={{ color: "var(--text-primary)" }}>
              {children}
            </strong>
          ),
          ul: ({ children }) => <ul className="mb-3 list-disc pl-4 last:mb-0">{children}</ul>,
          ol: ({ children }) => <ol className="mb-3 list-decimal pl-4 last:mb-0">{children}</ol>,
          li: ({ children }) => <li className="mb-1">{children}</li>,
        }}
      >
        {children}
      </Markdown>
    </div>
  );
}
