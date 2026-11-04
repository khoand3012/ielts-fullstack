import { itemKey, itemLabel } from "@/lib/content/items";
import type { QuestionItem as Item } from "@/lib/content/schema";

/** Wrapper for one item: the navigation anchor (#q-<key>) and its number label. */
export function QuestionItem({ item, children }: { item: Item; children: React.ReactNode }) {
  return (
    <div id={`q-${itemKey(item)}`} className="flex scroll-mt-28 gap-3">
      <span className="mt-0.5 inline-flex h-6 min-w-6 shrink-0 items-center justify-center rounded-md border px-1.5 text-xs font-semibold tabular-nums">
        {itemLabel(item)}
      </span>
      <div className="grid min-w-0 flex-1 gap-2">{children}</div>
    </div>
  );
}
