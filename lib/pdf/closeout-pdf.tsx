import { Document, Image, Page, StyleSheet, Text, View } from "@react-pdf/renderer";

import type { BlockerCode } from "@/lib/supabase/database.types";

export interface CloseoutReconciliationRow {
  name: string;
  needed: number;
  received: number;
  assigned: number;
  installed: number;
  leftQty: number;
  toOrder: number;
}

export interface CloseoutBlocker {
  code: BlockerCode;
  note: string | null;
  workDate: string;
  resolvedAt: string | null;
}

export interface CloseoutDayLog {
  workDate: string;
  crewName: string;
  arrivedAt: string | null;
  departedAt: string | null;
  note: string | null;
}

export interface CloseoutPdfData {
  orgName: string;
  orgAddress: string | null;
  orgLogoUrl: string | null;
  projectName: string;
  projectAddress: string | null;
  createdAt: string;
  pct: number;
  drawingUrl: string | null;
  reconciliation: CloseoutReconciliationRow[];
  blockers: CloseoutBlocker[];
  dayLogs: CloseoutDayLog[];
}

const styles = StyleSheet.create({
  page: { padding: 32, fontSize: 9, fontFamily: "Helvetica" },
  headerRow: { flexDirection: "row", alignItems: "center", marginBottom: 16 },
  logo: { width: 48, height: 48, marginRight: 12, objectFit: "contain" },
  orgName: { fontSize: 14, fontWeight: 700 },
  orgAddress: { fontSize: 9, color: "#666666" },
  title: { fontSize: 18, fontWeight: 700, marginBottom: 2 },
  subtitle: { fontSize: 10, color: "#666666", marginBottom: 16 },
  sectionTitle: {
    fontSize: 12,
    fontWeight: 700,
    marginTop: 16,
    marginBottom: 6,
    borderBottom: "1 solid #cccccc",
    paddingBottom: 3,
  },
  drawing: { width: "100%", maxHeight: 320, objectFit: "contain", marginBottom: 8 },
  table: { display: "flex", width: "auto" },
  tableRow: { flexDirection: "row", borderBottom: "1 solid #eeeeee" },
  tableHeaderRow: { flexDirection: "row", borderBottom: "1 solid #333333", paddingBottom: 3 },
  th: { flex: 1, fontWeight: 700, fontSize: 8, color: "#666666" },
  td: { flex: 1, fontSize: 9, paddingVertical: 3 },
  empty: { fontSize: 9, color: "#999999", marginBottom: 8 },
  signRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 48 },
  signBlock: { width: "45%" },
  signLine: { borderBottom: "1 solid #333333", marginBottom: 4, height: 24 },
  signLabel: { fontSize: 9, color: "#666666" },
});

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function CloseoutPdfDocument({ data }: { data: CloseoutPdfData }) {
  return (
    <Document title={`${data.projectName} — Closeout Report`}>
      <Page size="LETTER" style={styles.page}>
        <View style={styles.headerRow}>
          {data.orgLogoUrl ? (
            // eslint-disable-next-line jsx-a11y/alt-text -- react-pdf's Image has no alt prop
            <Image src={data.orgLogoUrl} style={styles.logo} />
          ) : null}
          <View>
            <Text style={styles.orgName}>{data.orgName}</Text>
            {data.orgAddress ? (
              <Text style={styles.orgAddress}>{data.orgAddress}</Text>
            ) : null}
          </View>
        </View>

        <Text style={styles.title}>{data.projectName} — Closeout Report</Text>
        <Text style={styles.subtitle}>
          {data.projectAddress ? `${data.projectAddress} — ` : ""}
          Started {formatDate(data.createdAt)} — {Math.round(data.pct * 100)}% complete
        </Text>

        <Text style={styles.sectionTitle}>As-built drawing</Text>
        {data.drawingUrl ? (
          // eslint-disable-next-line jsx-a11y/alt-text -- react-pdf's Image has no alt prop
          <Image src={data.drawingUrl} style={styles.drawing} />
        ) : (
          <Text style={styles.empty}>No marking drawing on file.</Text>
        )}

        <Text style={styles.sectionTitle}>Material reconciliation</Text>
        {data.reconciliation.length === 0 ? (
          <Text style={styles.empty}>No materials recorded.</Text>
        ) : (
          <View style={styles.table}>
            <View style={styles.tableHeaderRow}>
              <Text style={styles.th}>Material</Text>
              <Text style={styles.th}>Needed</Text>
              <Text style={styles.th}>Received</Text>
              <Text style={styles.th}>Assigned</Text>
              <Text style={styles.th}>Installed</Text>
              <Text style={styles.th}>Left</Text>
              <Text style={styles.th}>To order</Text>
            </View>
            {data.reconciliation.map((row, i) => (
              <View key={i} style={styles.tableRow}>
                <Text style={styles.td}>{row.name}</Text>
                <Text style={styles.td}>{row.needed}</Text>
                <Text style={styles.td}>{row.received}</Text>
                <Text style={styles.td}>{row.assigned}</Text>
                <Text style={styles.td}>{row.installed}</Text>
                <Text style={styles.td}>{row.leftQty}</Text>
                <Text style={styles.td}>{row.toOrder}</Text>
              </View>
            ))}
          </View>
        )}

        <Text style={styles.sectionTitle}>Blocker log</Text>
        {data.blockers.length === 0 ? (
          <Text style={styles.empty}>No blockers reported.</Text>
        ) : (
          <View style={styles.table}>
            <View style={styles.tableHeaderRow}>
              <Text style={styles.th}>Date</Text>
              <Text style={styles.th}>Code</Text>
              <Text style={[styles.th, { flex: 2 }]}>Note</Text>
              <Text style={styles.th}>Resolved</Text>
            </View>
            {data.blockers.map((b, i) => (
              <View key={i} style={styles.tableRow}>
                <Text style={styles.td}>{formatDate(b.workDate)}</Text>
                <Text style={styles.td}>{b.code}</Text>
                <Text style={[styles.td, { flex: 2 }]}>{b.note ?? ""}</Text>
                <Text style={styles.td}>
                  {b.resolvedAt ? formatDate(b.resolvedAt) : "Open"}
                </Text>
              </View>
            ))}
          </View>
        )}

        <Text style={styles.sectionTitle}>Day logs</Text>
        {data.dayLogs.length === 0 ? (
          <Text style={styles.empty}>No day logs recorded.</Text>
        ) : (
          <View style={styles.table}>
            <View style={styles.tableHeaderRow}>
              <Text style={styles.th}>Date</Text>
              <Text style={styles.th}>Crew</Text>
              <Text style={styles.th}>Arrived</Text>
              <Text style={styles.th}>Departed</Text>
              <Text style={[styles.th, { flex: 2 }]}>Note</Text>
            </View>
            {data.dayLogs.map((log, i) => (
              <View key={i} style={styles.tableRow}>
                <Text style={styles.td}>{formatDate(log.workDate)}</Text>
                <Text style={styles.td}>{log.crewName}</Text>
                <Text style={styles.td}>{formatDateTime(log.arrivedAt)}</Text>
                <Text style={styles.td}>{formatDateTime(log.departedAt)}</Text>
                <Text style={[styles.td, { flex: 2 }]}>{log.note ?? ""}</Text>
              </View>
            ))}
          </View>
        )}

        <View style={styles.signRow}>
          <View style={styles.signBlock}>
            <View style={styles.signLine} />
            <Text style={styles.signLabel}>Customer signature / date</Text>
          </View>
          <View style={styles.signBlock}>
            <View style={styles.signLine} />
            <Text style={styles.signLabel}>{data.orgName} representative / date</Text>
          </View>
        </View>
      </Page>
    </Document>
  );
}
