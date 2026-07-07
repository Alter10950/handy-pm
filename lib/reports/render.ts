import type { ProjectReportData } from "@/lib/reports/data";

function formatDate(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// Plain, table-based HTML — the lowest-common-denominator layout that
// renders reliably across email clients (no flexbox/grid, no external
// stylesheet — most clients strip <style> blocks or ignore modern CSS).
// A hot-linked signed URL for the drawing image, not an attachment or a
// base64 inline: Resend (and every mainstream email client) supports a
// plain <img src>, and a signed URL avoids bloating the message with
// embedded image bytes.
export function renderProjectReportHtml(data: ProjectReportData): string {
  const pctLabel = `${Math.round(data.pct * 100)}%`;
  const spiLabel = data.spi !== null ? data.spi.toFixed(2) : "—";

  const blockersHtml =
    data.blockersInPeriod.length === 0
      ? `<p style="color:#666;font-size:14px;">No blockers reported ${escapeHtml(data.periodLabel)}.</p>`
      : `<ul style="padding-left:20px;margin:8px 0;">${data.blockersInPeriod
          .map(
            (b) =>
              `<li style="font-size:14px;margin-bottom:4px;">${escapeHtml(b.code)}${
                b.note ? ` — ${escapeHtml(b.note)}` : ""
              } (${formatDate(b.workDate)})${b.resolved ? " — resolved" : " — <strong>open</strong>"}</li>`
          )
          .join("")}</ul>`;

  const drawingHtml = data.markingDrawingUrl
    ? `<img src="${data.markingDrawingUrl}" alt="Marked drawing" style="max-width:100%;border:1px solid #ddd;border-radius:6px;margin:12px 0;" />`
    : "";

  // Only rendered when there's CO news in the window — most weeks most
  // projects have none, and an empty "Change orders: none" section is
  // noise in an email.
  const changeOrdersHtml =
    data.changeOrdersInPeriod.length === 0
      ? ""
      : `<h2 style="font-size:16px;margin-bottom:4px;">Change orders ${escapeHtml(data.periodLabel)}</h2>
        <ul style="padding-left:20px;margin:8px 0;">${data.changeOrdersInPeriod
          .map(
            (co) =>
              `<li style="font-size:14px;margin-bottom:4px;">CO-${co.number}: ${escapeHtml(co.title)} — ${escapeHtml(co.status)}${
                co.addedDays !== null && co.addedDays > 0 ? `, +${co.addedDays} day(s)` : ""
              }${co.price !== null ? `, $${co.price.toLocaleString()}` : ""}</li>`
          )
          .join("")}</ul>`;

  return `
    <div style="font-family:Arial,Helvetica,sans-serif;max-width:640px;margin:0 auto;color:#1a1a1a;">
      <h1 style="font-size:20px;margin-bottom:4px;">${escapeHtml(data.projectName)}</h1>
      <p style="color:#666;font-size:14px;margin-top:0;">
        Report for ${escapeHtml(data.periodLabel)} — ${formatDate(new Date().toISOString().slice(0, 10))}
      </p>

      <table style="width:100%;border-collapse:collapse;margin:16px 0;">
        <tr>
          <td style="padding:8px;border:1px solid #eee;font-size:13px;color:#666;">Complete</td>
          <td style="padding:8px;border:1px solid #eee;font-size:15px;font-weight:bold;">${pctLabel}</td>
        </tr>
        <tr>
          <td style="padding:8px;border:1px solid #eee;font-size:13px;color:#666;">Status</td>
          <td style="padding:8px;border:1px solid #eee;font-size:15px;font-weight:bold;">${escapeHtml(data.riskLabel)} (SPI ${spiLabel})</td>
        </tr>
        <tr>
          <td style="padding:8px;border:1px solid #eee;font-size:13px;color:#666;">Installed ${escapeHtml(data.periodLabel)}</td>
          <td style="padding:8px;border:1px solid #eee;font-size:15px;font-weight:bold;">${data.installsInPeriod} units</td>
        </tr>
        <tr>
          <td style="padding:8px;border:1px solid #eee;font-size:13px;color:#666;">Forecast finish</td>
          <td style="padding:8px;border:1px solid #eee;font-size:15px;font-weight:bold;">${
            data.forecastFinish ? formatDate(data.forecastFinish) : "Not yet estimated"
          }</td>
        </tr>
      </table>

      ${drawingHtml}

      <h2 style="font-size:16px;margin-bottom:4px;">Blockers ${escapeHtml(data.periodLabel)}</h2>
      ${blockersHtml}

      ${changeOrdersHtml}

      <p style="color:#999;font-size:12px;margin-top:24px;">Sent automatically by Handy PM.</p>
    </div>
  `;
}

export function reportSubject(data: ProjectReportData, period: "daily" | "weekly"): string {
  const kind = period === "daily" ? "Daily" : "Weekly";
  return `${kind} update: ${data.projectName} — ${Math.round(data.pct * 100)}% complete (${data.riskLabel})`;
}
