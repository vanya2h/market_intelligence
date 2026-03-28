import { Link } from "react-router";

export function InlineLink({ to, children, className }: { to: string; children: React.ReactNode; className?: string }) {
  return (
    <Link
      to={to}
      className={`font-medium text-(--text-muted) transition-colors hover:text-(--text-primary) focus-visible:text-(--text-primary) focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-(--border) focus-visible:rounded-sm ${className ?? ""}`}
    >
      {children}
    </Link>
  );
}
