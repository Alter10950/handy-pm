import { ImageResponse } from "next/og";

export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#f2c00e",
        borderRadius: 6,
        fontSize: 16,
        fontWeight: 700,
        color: "#1a1a1a",
      }}
    >
      HP
    </div>,
    { ...size }
  );
}
