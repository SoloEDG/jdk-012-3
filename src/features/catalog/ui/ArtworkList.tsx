import { ArrowUpRight } from "lucide-react";
import { useServices } from "../../exhibition/ServicesProvider";

export function ArtworkList({
  active,
  onSelect,
}: {
  active: string | null;
  onSelect: (id: string) => void;
}) {
  const { runtime } = useServices();
  return (
    <div className="artwork-list">
      {runtime.artworks.map((a, i) => (
        <button
          className={active === a.id ? "art-row active" : "art-row"}
          onClick={() => onSelect(a.id)}
          key={a.id}
        >
          <span className="art-number">{String(i + 1).padStart(2, "0")}</span>
          <span>
            <strong>{a.title}</strong>
            <small>
              {a.artist} · {a.year}
            </small>
          </span>
          <ArrowUpRight size={16} />
        </button>
      ))}
    </div>
  );
}
