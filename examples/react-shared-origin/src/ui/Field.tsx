import type { ReactNode } from "react";

/** Labelled text input (mono). Use `below` for a resolved-address / hint line. */
export function Field({
  label,
  value,
  onChange,
  placeholder,
  below,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  below?: ReactNode;
}) {
  return (
    <div className="field">
      <label className="field-label">{label}</label>
      <input
        className="field-input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
      {below}
    </div>
  );
}
