import type { Point } from "../../../shared/types";
import { useServices } from "../../exhibition/ServicesProvider";

export function Map({
  position,
  active,
  onSelect,
  large = false,
}: {
  position: Point;
  active: string | null;
  onSelect: (id: string) => void;
  large?: boolean;
}) {
  const { runtime } = useServices();
  const { width, depth } = runtime.space;
  const scale = 10;
  const roomX = 80 - (width / 2) * scale;
  const roomY = 90 - (depth / 2) * scale;
  return (
    <svg
      className={large ? "map large" : "map"}
      viewBox="0 0 160 190"
      aria-label="展馆平面导航"
    >
      <rect
        x={roomX}
        y={roomY}
        width={width * scale}
        height={depth * scale}
        rx="2"
        fill="#e6e2d7"
      />
      <rect x="67" y="88" width="26" height="20" fill="#b8ad94" />
      {runtime.artworks.map((a, i) => (
        <g
          key={a.id}
          onClick={() => onSelect(a.id)}
          role="button"
          tabIndex={0}
          aria-label={"前往" + a.title}
          onKeyDown={(e) => {
            if (e.key === "Enter") onSelect(a.id);
          }}
        >
          <circle
            cx={80 + a.position.x * scale}
            cy={90 + a.position.z * scale}
            r={active === a.id ? 9 : 7}
            fill={active === a.id ? "#c5a66d" : "#797c72"}
          />
          <text
            x={80 + a.position.x * scale}
            y={93 + a.position.z * scale}
            textAnchor="middle"
            fill="white"
            fontSize="8"
          >
            {i + 1}
          </text>
        </g>
      ))}
      <circle
        data-testid="map-position"
        cx={80 + position.x * scale}
        cy={90 + position.z * scale}
        r="5"
        fill="#282c26"
        stroke="white"
        strokeWidth="2"
      />
      <text x="80" y="187" textAnchor="middle" fontSize="9" fill="#77796d">
        南入口 · SOUTH ENTRANCE
      </text>
    </svg>
  );
}
