export function ChainSwitcher({
  chains,
  selected,
  onSelect,
}: {
  chains: { id: number; name: string }[];
  selected: number;
  onSelect: (id: number) => void;
}) {
  return (
    <div className="chains">
      {chains.map((c) => (
        // ui.css keys the selected style off aria-pressed, so the state a screen
        // reader announces and the state a user sees cannot drift apart.
        <button key={c.id} className="chain" aria-pressed={c.id === selected} onClick={() => onSelect(c.id)}>
          {c.name}
        </button>
      ))}
    </div>
  );
}
