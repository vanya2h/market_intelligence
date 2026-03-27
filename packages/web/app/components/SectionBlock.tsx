import type { ReactNode } from "react";
import { InfoCircledIcon } from "@radix-ui/react-icons";
import { Tooltip } from "./Tooltip";

export function SectionBlock({
  title,
  children,
  className,
  tooltip,
}: {
  title: string;
  children: ReactNode;
  className?: string;
  tooltip?: ReactNode;
}) {
  return (
    <div className={className}>
      <div
        className="mb-2 flex items-center gap-1 text-[0.625rem] font-medium uppercase tracking-widest"
        style={{ color: "var(--text-muted)" }}
      >
        {title}
        {tooltip && (
          <Tooltip content={tooltip} side="right">
            <span className="inline-flex cursor-default">
              <InfoCircledIcon />
            </span>
          </Tooltip>
        )}
      </div>
      {children}
    </div>
  );
}
