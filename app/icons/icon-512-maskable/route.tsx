import { ImageResponse } from "next/og";

export const dynamic = "force-static";

// Maskable icons are cropped to a shape (circle, squircle, ...) by the OS, so
// content must stay inside the ~80% central "safe zone" with the background
// filling the full canvas edge-to-edge.
export function GET() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#f2c00e",
        fontSize: 160,
        fontWeight: 700,
        color: "#1a1a1a",
      }}
    >
      HP
    </div>,
    { width: 512, height: 512 }
  );
}
