import { ImageResponse } from "next/og";

export const runtime = "edge";
export const alt = "Botcoin Pool - Trustless Mining on Base";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OgImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(135deg, #0a0a12 0%, #0d1117 50%, #0a0f1a 100%)",
          fontFamily: "Inter, system-ui, sans-serif",
        }}
      >
        {/* Grid pattern overlay */}
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundImage:
              "radial-gradient(circle at 1px 1px, rgba(99,102,241,0.15) 1px, transparent 0)",
            backgroundSize: "40px 40px",
          }}
        />

        {/* Glow effect */}
        <div
          style={{
            position: "absolute",
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            width: 400,
            height: 400,
            borderRadius: "50%",
            background:
              "radial-gradient(circle, rgba(99,102,241,0.2) 0%, transparent 70%)",
          }}
        />

        {/* Main title */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 16,
          }}
        >
          <div
            style={{
              fontSize: 72,
              fontWeight: 800,
              color: "#e2e8f0",
              letterSpacing: "-2px",
              display: "flex",
            }}
          >
            Botcoin{" "}
            <span style={{ color: "#818cf8", marginLeft: 16 }}>Pool</span>
          </div>

          <div
            style={{
              fontSize: 28,
              color: "#94a3b8",
              letterSpacing: "0.5px",
            }}
          >
            Trustless Mining on Base
          </div>

          {/* Feature badges */}
          <div
            style={{
              display: "flex",
              gap: 24,
              marginTop: 32,
            }}
          >
            {["Permissionless", "O(1) Gas Claims", "EIP-1271", "On-Chain"].map(
              (label) => (
                <div
                  key={label}
                  style={{
                    padding: "8px 20px",
                    borderRadius: 8,
                    border: "1px solid rgba(99,102,241,0.3)",
                    background: "rgba(99,102,241,0.08)",
                    color: "#a5b4fc",
                    fontSize: 16,
                    fontWeight: 600,
                  }}
                >
                  {label}
                </div>
              )
            )}
          </div>
        </div>

        {/* Bottom bar */}
        <div
          style={{
            position: "absolute",
            bottom: 32,
            display: "flex",
            alignItems: "center",
            gap: 8,
            color: "#64748b",
            fontSize: 16,
          }}
        >
          <div
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: "#22c55e",
            }}
          />
          Base Mainnet
        </div>
      </div>
    ),
    { ...size }
  );
}
