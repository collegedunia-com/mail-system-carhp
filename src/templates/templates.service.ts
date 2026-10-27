import Handlebars from "handlebars";
import type { RenderedEmail } from "../common/types.js";
import type { Config } from "../common/config.js";
import type {
  TemplateLibraryPort,
  TemplateLibraryRow,
} from "./template-library.service.js";

export class TemplatesService {
  private definitions: Map<string, TemplateDefinition> | null = null;

  constructor(
    private cfg: Pick<Config, "maxFollowups">,
    private catalog: TemplateLibraryPort,
  ) {}

  async refresh(): Promise<void> {
    const rows = await this.catalog.read();
    this.definitions = buildTemplateDefinitions(rows, this.cfg.maxFollowups);
  }

  async render(
    key: string,
    data: Record<string, unknown>,
  ): Promise<RenderedEmail[]> {
    if (!this.definitions) await this.refresh();
    const definition = this.definitions?.get(key);
    if (!definition)
      throw new Error("Template " + key + " was not found in Template Library");
    return renderTemplateSequence(key, definition, data, this.cfg.maxFollowups);
  }
}

interface TemplateDefinition {
  requiredFields: string[];
  subjects: string[];
  steps: string[];
  complianceSensitive: boolean;
  status: string;
}

const STEP_ORDER = ["INITIAL", "FU1", "FU2", "FU3"];
const OPT_OUT = "If you'd prefer not to hear from us, reply and let us know.";

export function emailAddress(value: string): string {
  const normalised = value.trim().toLowerCase();
  if (
    !/^[a-z0-9.!#$%&'*+/=?^_\x60{|}~-]+@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/i.test(
      normalised,
    ) ||
    /[\r\n]/.test(value)
  )
    throw new Error("Invalid email address");
  return normalised;
}

function buildTemplateDefinitions(
  rows: TemplateLibraryRow[],
  maxFollowups: number,
): Map<string, TemplateDefinition> {
  const groups = new Map<
    string,
    {
      requiredFields: string[];
      complianceSensitive: boolean;
      status: string;
      subjects: Map<number, string>;
      steps: Map<number, string>;
    }
  >();

  for (const row of rows) {
    const key = row.template_key?.trim() || "";
    if (!/^[a-z][a-z0-9_-]{0,63}$/.test(key))
      throw new Error("Template Library has an invalid template_key");
    const step = (row.step || "").trim().toUpperCase();
    const stepIndex = STEP_ORDER.indexOf(step);
    if (stepIndex < 0)
      throw new Error("Template " + key + " has an invalid step: " + step);
    const subject = (row.subject_pattern || "").trim();
    const body = (row.body_pattern || "").trim();
    if (!subject || !body)
      throw new Error("Template " + key + " has an empty subject or body");
    let requiredFields: unknown;
    try {
      requiredFields = JSON.parse(row.required_fields || "[]");
    } catch {
      throw new Error("Template " + key + " has invalid required_fields JSON");
    }
    if (
      !Array.isArray(requiredFields) ||
      requiredFields.some((field) => typeof field !== "string")
    )
      throw new Error(
        "Template " + key + " required_fields must be a JSON string array",
      );
    const complianceValue = (row.compliance_sensitive || "")
      .trim()
      .toLowerCase();
    if (!["true", "false"].includes(complianceValue))
      throw new Error("Template " + key + " has invalid compliance_sensitive");
    const complianceSensitive = complianceValue === "true";
    const status = (row.status || "").trim().toLowerCase();
    if (
      ![
        "draft",
        "approved",
        "pending_admin_approval",
        "blocked_needs_definition",
      ].includes(status)
    )
      throw new Error("Template " + key + " has an unsupported status");

    let group = groups.get(key);
    if (!group) {
      group = {
        requiredFields: requiredFields as string[],
        complianceSensitive,
        status,
        subjects: new Map(),
        steps: new Map(),
      };
      groups.set(key, group);
    } else if (
      JSON.stringify(group.requiredFields) !== JSON.stringify(requiredFields) ||
      group.complianceSensitive !== complianceSensitive ||
      group.status !== status
    ) {
      throw new Error(
        "Template " + key + " has inconsistent metadata between steps",
      );
    }
    if (group.steps.has(stepIndex))
      throw new Error("Template " + key + " has a duplicate step: " + step);
    group.subjects.set(stepIndex, subject);
    group.steps.set(stepIndex, body);
  }

  const definitions = new Map<string, TemplateDefinition>();
  for (const [key, group] of groups) {
    if (group.steps.size < maxFollowups + 1)
      throw new Error(
        "Template " +
          key +
          " needs " +
          (maxFollowups + 1) +
          " steps in Template Library",
      );
    const subjects: string[] = [];
    const steps: string[] = [];
    for (let index = 0; index <= maxFollowups; index++) {
      const subject = group.subjects.get(index);
      const body = group.steps.get(index);
      if (subject === undefined || body === undefined)
        throw new Error(
          "Template " + key + " is missing step " + STEP_ORDER[index],
        );
      subjects.push(subject);
      steps.push(body);
    }
    definitions.set(key, {
      requiredFields: group.requiredFields,
      subjects,
      steps,
      complianceSensitive: group.complianceSensitive,
      status: group.status,
    });
  }
  return definitions;
}

function requiredData(
  requiredFields: string[],
  key: string,
  data: Record<string, unknown>,
): void {
  for (const field of requiredFields)
    if (
      data[field] === undefined ||
      data[field] === null ||
      String(data[field]).trim() === ""
    )
      throw new Error(
        "Missing required merge field: " + field + " (template " + key + ")",
      );
}

function renderText(source: string, data: Record<string, unknown>): string {
  const hb = Handlebars.create();
  const text = hb
    .compile(source, { strict: true, noEscape: true })(data)
    .trim();
  if (!text || text.includes("{{"))
    throw new Error("Empty output or unresolved merge field");
  return text;
}

function renderTemplateSequence(
  key: string,
  definition: TemplateDefinition,
  data: Record<string, unknown>,
  maxFollowups: number,
): RenderedEmail[] {
  if (definition.status === "blocked_needs_definition")
    throw new Error("Template " + key + " needs a niche definition before use");
  if (
    definition.status === "pending_admin_approval" ||
    (definition.complianceSensitive && definition.status !== "approved")
  )
    throw new Error(
      "Compliance-sensitive template " +
        key +
        " requires Administrator approval",
    );
  requiredData(definition.requiredFields, key, data);
  return definition.steps.slice(0, maxFollowups + 1).map((source, step) => {
    const subject = renderText(definition.subjects[step], data);
    if (/[\r\n]/.test(subject) || subject.length > 250)
      throw new Error("Invalid subject");
    return {
      subject:
        step === 0 || /^(Re:\s*)/i.test(subject) ? subject : "Re: " + subject,
      text: renderText(source, data) + "\n\n" + OPT_OUT,
    };
  });
}
