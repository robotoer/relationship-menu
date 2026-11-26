import { useMemo } from "react";
import { encodeQr } from "./qr-encoder";

/** Light modules around the code, as the standard asks, so scanners find its edges. */
const QUIET_ZONE = 4;

/**
 * A QR code as one SVG path, dark on white in any theme (scanners need the
 * contrast). Sync settings loads this with `import()` only for "Add a device"
 * (SY-10), so it's never in the main download.
 *
 * `value` is often secret (a pairing link's key), so it goes only into the
 * drawing: `label` is what screen readers hear, and nothing else in the page
 * carries the value.
 */
export const QrCode = ({ value, label, className }: { value: string; label: string; className?: string }) => {
  const { path, side } = useMemo(() => {
    const { size, modules } = encodeQr(value);
    let d = "";
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (!modules[y * size + x]) continue;
        let run = 1;
        while (x + run < size && modules[y * size + x + run]) run++;
        d += `M${x + QUIET_ZONE} ${y + QUIET_ZONE}h${run}v1h-${run}z`;
        x += run - 1;
      }
    }
    return { path: d, side: size + 2 * QUIET_ZONE };
  }, [value]);
  return (
    <svg
      className={className}
      role="img"
      aria-label={label}
      viewBox={`0 0 ${side} ${side}`}
      shapeRendering="crispEdges"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect width={side} height={side} fill="#ffffff" />
      <path d={path} fill="#000000" />
    </svg>
  );
};

export default QrCode;
