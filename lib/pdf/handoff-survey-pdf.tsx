import {
  Document,
  Image,
  Page,
  StyleSheet,
  Text,
  View,
} from "@react-pdf/renderer";

export interface HandoffPdfConstraints {
  liveWarehouse: boolean;
  accessNotes: string;
  forkliftOnsite: boolean;
  workingHours: string;
  floorCondition: string;
  permitsNeeded: boolean;
}

export interface HandoffPdfData {
  orgName: string;
  orgAddress: string | null;
  orgLogoUrl: string | null;
  projectName: string;
  projectAddress: string | null;
  siteVisitDate: string | null;
  existingRackingCondition: string | null;
  teardownRequired: boolean;
  teardownNotes: string | null;
  constraints: HandoffPdfConstraints;
  photoUrls: string[];
  estimatorName: string | null;
  estimatorSignedAt: string | null;
  pmName: string | null;
  pmSignedAt: string | null;
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
  body: { fontSize: 9.5, lineHeight: 1.4 },
  empty: { fontSize: 9, color: "#999999", marginBottom: 8 },
  table: { display: "flex", width: "auto" },
  tableRow: { flexDirection: "row", borderBottom: "1 solid #eeeeee" },
  th: {
    flex: 1,
    fontWeight: 700,
    fontSize: 8,
    color: "#666666",
    paddingVertical: 3,
  },
  td: { flex: 1, fontSize: 9, paddingVertical: 3 },
  photoGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 8,
  },
  photo: { width: 150, height: 112, objectFit: "cover" },
  signRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 32,
  },
  signBlock: { width: "45%" },
  signLine: { borderBottom: "1 solid #333333", marginBottom: 4, height: 24 },
  signLabel: { fontSize: 9, color: "#666666" },
  signedText: { fontSize: 9.5 },
});

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso.length > 10 ? iso : `${iso}T00:00:00`).toLocaleDateString(
    undefined,
    { month: "short", day: "numeric", year: "numeric" }
  );
}

function SignBlock({
  role,
  name,
  signedAt,
}: {
  role: string;
  name: string | null;
  signedAt: string | null;
}) {
  return (
    <View style={styles.signBlock}>
      <View style={styles.signLine} />
      {signedAt ? (
        <Text style={styles.signedText}>
          {name ?? "Unknown"} — signed {formatDate(signedAt)}
        </Text>
      ) : (
        <Text style={styles.signedText}>Not signed</Text>
      )}
      <Text style={styles.signLabel}>{role}</Text>
    </View>
  );
}

export function HandoffPdfDocument({ data }: { data: HandoffPdfData }) {
  return (
    <Document title={`${data.projectName} — Handoff Survey`}>
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

        <Text style={styles.title}>{data.projectName} — Handoff Survey</Text>
        <Text style={styles.subtitle}>
          {data.projectAddress ? `${data.projectAddress} — ` : ""}
          Site visit {formatDate(data.siteVisitDate)}
        </Text>

        <Text style={styles.sectionTitle}>Existing racking condition</Text>
        <Text
          style={data.existingRackingCondition ? styles.body : styles.empty}
        >
          {data.existingRackingCondition ?? "Not recorded."}
        </Text>

        <Text style={styles.sectionTitle}>Teardown</Text>
        <Text style={styles.body}>
          {data.teardownRequired
            ? "Teardown required."
            : "No teardown required."}
        </Text>
        {data.teardownRequired && data.teardownNotes ? (
          <Text style={[styles.body, { marginTop: 3 }]}>
            {data.teardownNotes}
          </Text>
        ) : null}

        <Text style={styles.sectionTitle}>Site constraints</Text>
        <View style={styles.table}>
          <View style={styles.tableRow}>
            <Text style={styles.th}>Warehouse live during install</Text>
            <Text style={styles.td}>
              {data.constraints.liveWarehouse ? "Yes" : "No"}
            </Text>
          </View>
          <View style={styles.tableRow}>
            <Text style={styles.th}>Forklift onsite</Text>
            <Text style={styles.td}>
              {data.constraints.forkliftOnsite ? "Yes" : "No"}
            </Text>
          </View>
          <View style={styles.tableRow}>
            <Text style={styles.th}>Permits needed</Text>
            <Text style={styles.td}>
              {data.constraints.permitsNeeded ? "Yes" : "No"}
            </Text>
          </View>
          <View style={styles.tableRow}>
            <Text style={styles.th}>Working hours allowed</Text>
            <Text style={styles.td}>
              {data.constraints.workingHours || "—"}
            </Text>
          </View>
          <View style={styles.tableRow}>
            <Text style={styles.th}>Floor condition</Text>
            <Text style={styles.td}>
              {data.constraints.floorCondition || "—"}
            </Text>
          </View>
          <View style={styles.tableRow}>
            <Text style={styles.th}>Access notes</Text>
            <Text style={styles.td}>{data.constraints.accessNotes || "—"}</Text>
          </View>
        </View>

        <Text style={styles.sectionTitle}>Site photos</Text>
        {data.photoUrls.length === 0 ? (
          <Text style={styles.empty}>No photos on file.</Text>
        ) : (
          <View style={styles.photoGrid}>
            {data.photoUrls.map((url, i) => (
              // eslint-disable-next-line jsx-a11y/alt-text -- react-pdf's Image has no alt prop
              <Image key={i} src={url} style={styles.photo} />
            ))}
          </View>
        )}

        <View style={styles.signRow}>
          <SignBlock
            role="Estimator sign-off"
            name={data.estimatorName}
            signedAt={data.estimatorSignedAt}
          />
          <SignBlock
            role="PM sign-off"
            name={data.pmName}
            signedAt={data.pmSignedAt}
          />
        </View>
      </Page>
    </Document>
  );
}
