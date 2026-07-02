import { ImageResponse } from "next/og";

export const dynamic = "force-static";

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
        fontSize: 224,
        fontWeight: 700,
        color: "#1a1a1a",
      }}
    >
      HP
    </div>,
    { width: 512, height: 512 }
  );
}
