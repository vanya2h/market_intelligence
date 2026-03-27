import * as TooltipPrimitive from "@radix-ui/react-tooltip";

interface TooltipProps {
  children: React.ReactNode;
  content: React.ReactNode;
  side?: "top" | "right" | "bottom" | "left";
  delayDuration?: number;
}

export function Tooltip({ children, content, side = "top", delayDuration = 200 }: TooltipProps) {
  return (
    <TooltipPrimitive.Provider delayDuration={delayDuration}>
      <TooltipPrimitive.Root>
        <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content
            side={side}
            sideOffset={6}
            className="tooltip-content"
            style={{
              padding: "0.375rem 0.625rem",
              fontSize: "0.6875rem",
              lineHeight: 1.4,
              color: "var(--text-primary)",
              background: "var(--bg-surface)",
              border: "1px solid var(--border)",
              borderRadius: "6px",
              boxShadow: "0 4px 12px rgba(0, 0, 0, 0.4)",
              maxWidth: 240,
              zIndex: 50,
              animationDuration: "150ms",
              animationTimingFunction: "ease-out",
            }}
          >
            {content}
            <TooltipPrimitive.Arrow
              style={{ fill: "var(--bg-surface)" }}
              width={10}
              height={5}
            />
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
}
