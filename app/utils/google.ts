import { google } from "googleapis";

const SCOPES = [
  "https://www.googleapis.com/auth/drive",
  "https://www.googleapis.com/auth/spreadsheets",
];

function parseServiceAccount(): any {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT;
  if (!raw || !raw.trim()) {
    throw new Error(
      "GOOGLE_SERVICE_ACCOUNT environment variable is not configured. Please add it in Vercel or your .env.local file."
    );
  }

  const trimmed = raw.trim();

  // If user provided raw JSON directly
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    try {
      return JSON.parse(trimmed);
    } catch (e) {
      throw new Error(`Failed to parse GOOGLE_SERVICE_ACCOUNT JSON: ${(e as Error).message}`);
    }
  }

  // Otherwise decode base64
  try {
    const decoded = Buffer.from(trimmed, "base64").toString("utf-8");
    return JSON.parse(decoded);
  } catch {
    // Fallback attempt to parse trimmed string directly as JSON
    try {
      return JSON.parse(trimmed);
    } catch {
      throw new Error(
        "Invalid GOOGLE_SERVICE_ACCOUNT format. Must be a valid JSON or base64-encoded JSON key."
      );
    }
  }
}

let cachedServices: {
  drive: ReturnType<typeof google.drive>;
  sheets: ReturnType<typeof google.sheets>;
} | null = null;

export const getGoogleServices = () => {
  if (cachedServices) {
    return cachedServices;
  }

  const credentials = parseServiceAccount();
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: SCOPES,
  });

  const drive = google.drive({ version: "v3", auth });
  const sheets = google.sheets({ version: "v4", auth });

  cachedServices = { drive, sheets };
  return cachedServices;
};
