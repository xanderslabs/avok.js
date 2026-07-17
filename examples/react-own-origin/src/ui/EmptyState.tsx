import type { ReactNode } from "react";
import { Text } from "./Text.js";

export function EmptyState({ loading, children }: { loading?: boolean; children: ReactNode }) {
  return (
    <div className="empty-state">
      <Text variant="body" tone="subtle">
        {loading ? "Loading…" : children}
      </Text>
    </div>
  );
}
