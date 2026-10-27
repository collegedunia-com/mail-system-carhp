import type { GoogleService } from "../google/google.service.js";

export const TEMPLATE_LIBRARY_HEADERS = [
  "template_key",
  "niche_no",
  "niche_name",
  "step",
  "subject_pattern",
  "body_pattern",
  "required_fields",
  "compliance_sensitive",
  "status",
  "version",
  "approved_by",
] as const;

export type TemplateLibraryRow = Record<string, string>;

export interface TemplateLibraryPort {
  read(): Promise<TemplateLibraryRow[]>;
}

export class GoogleTemplateLibrary implements TemplateLibraryPort {
  private readonly base: string;

  constructor(
    private readonly spreadsheetId: string,
    private readonly tab: string,
    private readonly google: GoogleService,
  ) {
    this.base =
      "https://sheets.googleapis.com/v4/spreadsheets/" +
      encodeURIComponent(spreadsheetId);
  }

  private range(): string {
    const quotedTab = "'" + this.tab.replace(/'/g, "''") + "'";
    return encodeURIComponent(quotedTab + "!A:Z");
  }

  async read(): Promise<TemplateLibraryRow[]> {
    if (!this.spreadsheetId)
      throw new Error("SPREADSHEET_ID must be configured for cloud templates");
    const result = await this.google.json<{ values?: unknown[][] }>(
      this.base + "/values/" + this.range(),
    );
    const [first = [], ...rows] = (result.values || []).map((row) =>
      row.map((value) => String(value ?? "")),
    );
    const headers = first.map((value) => value.trim());
    const namedHeaders = headers.filter(Boolean);
    if (new Set(namedHeaders).size !== namedHeaders.length)
      throw new Error("Template Library tab contains duplicate column headers");
    for (const header of TEMPLATE_LIBRARY_HEADERS)
      if (!headers.includes(header))
        throw new Error(
          "Template Library tab is missing column " +
            header +
            "; add it to the cloud sheet",
        );
    const content = rows.filter((row) => row.some((value) => value.trim()));
    if (!content.length)
      throw new Error(
        "Template Library tab is empty; add templates to the cloud sheet",
      );
    return content.map((row) =>
      Object.fromEntries(
        headers.flatMap((header, index) =>
          header ? [[header, row[index] || ""]] : [],
        ),
      ),
    );
  }
}
