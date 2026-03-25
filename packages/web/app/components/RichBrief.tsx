/**
 * RichBrief — React bridge for Arrow.js infographic renderer.
 *
 * Dynamically imports the Arrow.js renderer only on the client
 * (inside useEffect) to avoid SSR issues since Arrow.js needs the DOM.
 */

import { useEffect, useRef } from "react";
import type { RichBlock } from "./rich-brief-types";

export type { RichBlock } from "./rich-brief-types";

export function RichBriefRenderer({ blocks }: { blocks: RichBlock[] }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || !blocks?.length) return;

    let cancelled = false;

    import("./rich-brief-renderer.client")
      .then(({ mountRichBrief }) => {
        if (!cancelled) {
          mountRichBrief(el, blocks);
        }
      })
      .catch((err) => {
        console.error("[RichBrief] Failed to load renderer:", err);
      });

    return () => {
      cancelled = true;
    };
  }, [blocks]);

  return (
    <div ref={containerRef} className="rich-brief-container" />
  );
}
