export interface ParsedMaterialLine {
  name: string;
  qty: number;
}

// "Upright frame, 220" / "Beam 96in\t1500" / "Wire deck 760" — a name
// followed by a trailing integer qty, separated by commas/tabs/spaces.
const LINE_PATTERN = /^(.*?)[\s,]+(\d+)\s*$/;

export function parseMaterialList(text: string): ParsedMaterialLine[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = LINE_PATTERN.exec(line);
      if (!match) return null;
      const name = match[1].trim().replace(/,$/, "");
      const qty = Number.parseInt(match[2], 10);
      if (!name || !Number.isFinite(qty)) return null;
      return { name, qty };
    })
    .filter((line): line is ParsedMaterialLine => line !== null);
}
