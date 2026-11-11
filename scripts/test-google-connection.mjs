import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
import { google } from "googleapis";

// Attempt to load .env.local if present
const envPath = resolve(process.cwd(), ".env.local");
if (existsSync(envPath)) {
  const content = readFileSync(envPath, "utf-8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith("#")) {
      const idx = trimmed.indexOf("=");
      if (idx !== -1) {
        const key = trimmed.slice(0, idx).trim();
        const value = trimmed.slice(idx + 1).trim();
        if (!process.env[key]) {
          process.env[key] = value;
        }
      }
    }
  }
}

console.log("\n==============================================");
console.log("  MBA Web App - Google Integration Diagnostic ");
console.log("==============================================\n");

let hasErrors = false;

// 1. Check Service Account
console.log("1. Checking GOOGLE_SERVICE_ACCOUNT...");
const rawSA = process.env.GOOGLE_SERVICE_ACCOUNT;
let credentials = null;

if (!rawSA) {
  console.log("   ❌ GOOGLE_SERVICE_ACCOUNT is missing.");
  hasErrors = true;
} else {
  try {
    const trimmed = rawSA.trim();
    if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
      credentials = JSON.parse(trimmed);
    } else {
      const decoded = Buffer.from(trimmed, "base64").toString("utf-8");
      credentials = JSON.parse(decoded);
    }

    if (credentials.client_email) {
      console.log(`   ✅ Service Account recognized: ${credentials.client_email}`);
    } else {
      console.log("   ❌ JSON parsed, but 'client_email' is missing.");
      hasErrors = true;
    }
  } catch (err) {
    console.log(`   ❌ Failed to parse Service Account JSON: ${err.message}`);
    hasErrors = true;
  }
}

// If credentials valid, test APIs
if (credentials) {
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: [
      "https://www.googleapis.com/auth/drive",
      "https://www.googleapis.com/auth/spreadsheets",
    ],
  });

  // 2. Check Spreadsheet
  console.log("\n2. Checking REPORTS_SPREADSHEET_ID & Sheet Tabs...");
  const sheetId = process.env.REPORTS_SPREADSHEET_ID;
  if (!sheetId) {
    console.log("   ❌ REPORTS_SPREADSHEET_ID is missing.");
    hasErrors = true;
  } else {
    try {
      const sheets = google.sheets({ version: "v4", auth });
      const meta = await sheets.spreadsheets.get({ spreadsheetId: sheetId });
      console.log(`   ✅ Spreadsheet connected: "${meta.data.properties?.title}"`);

      const tabNames = meta.data.sheets?.map((s) => s.properties?.title) || [];
      const requiredTabs = ["main", "sections", "images"];
      for (const tab of requiredTabs) {
        if (tabNames.includes(tab)) {
          console.log(`      ✅ Tab "${tab}" found.`);
        } else {
          console.log(`      ❌ Tab "${tab}" missing! (Required for app to work)`);
          hasErrors = true;
        }
      }
    } catch (err) {
      console.log(`   ❌ Failed to access spreadsheet: ${err.message}`);
      console.log("      👉 Ensure the sheet is shared with: " + credentials.client_email);
      hasErrors = true;
    }
  }

  // 3. Check Drive access
  console.log("\n3. Testing Google Drive API connection...");
  try {
    const drive = google.drive({ version: "v3", auth });
    const about = await drive.about.get({ fields: "user" });
    console.log(`   ✅ Drive API connected as: ${about.data.user?.displayName || "Service Account"}`);
  } catch (err) {
    console.log(`   ❌ Google Drive API error: ${err.message}`);
    hasErrors = true;
  }
}

// 4. Check Upload Endpoint
console.log("\n4. Checking IMAGE_UPLOAD_ENDPOINT...");
const uploadEndpoint = process.env.IMAGE_UPLOAD_ENDPOINT;
if (!uploadEndpoint) {
  console.log("   ⚠️  IMAGE_UPLOAD_ENDPOINT is not set (needed for image uploads).");
} else {
  console.log(`   ✅ Configured: ${uploadEndpoint.slice(0, 35)}...`);
}

console.log("\n==============================================");
if (hasErrors) {
  console.log("  Diagnostic finished with issues to resolve. ");
} else {
  console.log("  All integration checks passed successfully! ");
}
console.log("==============================================\n");
