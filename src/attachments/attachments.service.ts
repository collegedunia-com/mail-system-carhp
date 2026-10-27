import { basename } from "node:path";
import type { CloudAttachment } from "../common/types.js";
import type { GoogleService } from "../google/google.service.js";

const MAX_FILE = 10 * 1024 * 1024;
const TYPES = new Set(["application/pdf", "image/png", "image/jpeg"]);

export function driveFileId(ref: string): string | undefined {
  if (/^drive:[a-zA-Z0-9_-]+$/.test(ref)) return ref.slice(6);
  try {
    const url = new URL(ref);
    if (url.protocol !== "https:" || url.hostname !== "drive.google.com")
      return;
    const id =
      url.pathname.match(/^\/file\/d\/([a-zA-Z0-9_-]+)/)?.[1] ||
      url.searchParams.get("id");
    if (id && /^[a-zA-Z0-9_-]+$/.test(id)) return id;
  } catch {}
}

export function validateCloudRef(ref: string, hosts: string[]): void {
  if (driveFileId(ref)) return;
  let url: URL;
  try {
    url = new URL(ref);
  } catch {
    throw new Error(
      "Attachment must be a Google Drive link or an allowed HTTPS cloud URL",
    );
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    (url.port && url.port !== "443") ||
    !hosts.includes(url.hostname.toLowerCase())
  ) {
    throw new Error(
      "Attachment host is not allowed; configure ATTACHMENT_ALLOWED_HOSTS",
    );
  }
}

async function boundedBody(response: Response): Promise<Buffer> {
  if (!response.ok)
    throw new Error(
      `Cloud attachment could not be downloaded (${response.status})`,
    );
  if (Number(response.headers.get("content-length")) > MAX_FILE)
    throw new Error("Attachment exceeds 10 MB");
  if (!response.body) throw new Error("Attachment is empty");
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
    size += chunk.length;
    if (size > MAX_FILE) {
      await response.body.cancel().catch(() => undefined);
      throw new Error("Attachment exceeds 10 MB");
    }
    chunks.push(Buffer.from(chunk));
  }
  if (!size) throw new Error("Attachment is empty");
  return Buffer.concat(chunks);
}

export class CloudAttachments {
  constructor(
    private google: GoogleService,
    private hosts: string[],
  ) {}

  async load(refs: string[]): Promise<CloudAttachment[]> {
    if (refs.length > 5) throw new Error("At most 5 attachments are allowed");
    const files: CloudAttachment[] = [];
    for (const ref of refs) {
      validateCloudRef(ref, this.hosts);
      const driveId = driveFileId(ref);
      let url: string,
        filename: string,
        contentType: string,
        headers: Record<string, string> = {};
      if (driveId) {
        const base = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
          driveId,
        )}`;
        const metadata = await this.google.json<{
          name: string;
          mimeType: string;
          size?: string;
        }>(`${base}?fields=name,mimeType,size&supportsAllDrives=true`);
        if (Number(metadata.size) > MAX_FILE)
          throw new Error("Attachment exceeds 10 MB");
        filename = basename(metadata.name);
        contentType = metadata.mimeType;
        url = `${base}?alt=media&supportsAllDrives=true`;
        headers = { Authorization: `Bearer ${await this.google.token()}` };
      } else {
        url = ref;
        filename = basename(new URL(ref).pathname) || "attachment";
        contentType = "";
      }
      const response = await fetch(url, {
        headers,
        redirect: "error",
        signal: AbortSignal.timeout(30_000),
      });
      contentType ||= (response.headers.get("content-type") || "")
        .split(";")[0]
        .trim()
        .toLowerCase();
      if (!TYPES.has(contentType))
        throw new Error(
          "Only PDF, PNG and JPEG cloud attachments are supported",
        );
      const content = await boundedBody(response);
      const signatureOkay =
        contentType === "application/pdf"
          ? content.subarray(0, 5).toString() === "%PDF-"
          : contentType === "image/png"
            ? content
                .subarray(0, 8)
                .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
            : content[0] === 0xff && content[1] === 0xd8 && content[2] === 0xff;
      if (!signatureOkay)
        throw new Error("Attachment content does not match its file type");
      files.push({ filename, contentType, content });
    }
    return files;
  }
}
