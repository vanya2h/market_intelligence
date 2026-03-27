import { Link } from "react-router";

interface TabItem {
  key: string;
  label: string;
  to?: string;
}

export interface TabBarProps {
  items: TabItem[];
  activeKey: string;
  onSelect?: (key: string) => void;
  className?: string;
}

export function TabBar({ items, activeKey, onSelect, className = "" }: TabBarProps) {
  return (
    <div className={`flex items-center gap-0 ${className}`}>
      {items.map((item) => {
        const isActive = activeKey === item.key;
        const tabClassName = `flex h-full items-center relative shrink-0 cursor-pointer px-3 py-2 text-xs font-medium tracking-wide transition-colors ${isActive ? "tab-active" : ""}`;
        const style = {
          color: isActive ? "var(--text-primary)" : "var(--text-muted)",
        };

        if (item.to) {
          return (
            <Link key={item.key} to={item.to} className={tabClassName} style={style}>
              {item.label}
            </Link>
          );
        }

        return (
          <button key={item.key} onClick={() => onSelect?.(item.key)} className={tabClassName} style={style}>
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
