import { Text } from "./Text.js";

/**
 * Renders human-readable consent lines in a mono card. Lines carrying a ⚠
 * marker (raw/approve-unlimited/authorization) are tinted caution. Text is
 * rendered as plain text nodes — never dangerouslySetInnerHTML — so nothing in
 * a line can inject markup.
 */
export function ConsentLines({ lines }: { lines: string[] }) {
  return (
    <div className="consent">
      {lines.map((line, i) => (
        <Text key={i} as="div" variant="micro" mono tone={line.includes("⚠") ? "caution" : "default"}>
          {line}
        </Text>
      ))}
    </div>
  );
}
