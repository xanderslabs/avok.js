import type { SendErrorKind } from "@avokjs/helpers";
import { Text } from "./Text.js";

export function ErrorNote({ kind, message }: { kind: SendErrorKind; message: string }) {
  return (
    <div className="error-note" role="alert" data-error-kind={kind}>
      <Text variant="label" tone="danger">
        {message}
      </Text>
    </div>
  );
}
