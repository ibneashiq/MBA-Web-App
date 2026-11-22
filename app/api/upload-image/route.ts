import { NextRequest, NextResponse } from "next/server";
import { getGoogleServices } from "../../utils/google";
import { Readable } from "stream";

export const dynamic = "force-dynamic";

/**
 * Handles uploading via Google Apps Script Web App.
 * Google Apps Script returns a 302 redirect with a Location header.
 * We manually follow the redirect to retrieve the resulting JSON safely.
 */
async function uploadToAppsScript(
  url: string,
  base64Image: string,
  filename: string,
  folderId?: string
): Promise<{ id: string; url?: string }> {
  let trimmedUrl = url.trim();

  // If the user pasted only an ID instead of a full URL
  if (!trimmedUrl.startsWith("http://") && !trimmedUrl.startsWith("https://")) {
    if (trimmedUrl.startsWith("AKfy")) {
      trimmedUrl = `https://script.google.com/macros/s/${trimmedUrl}/exec`;
    } else {
      throw new Error(
        `IMAGE_UPLOAD_ENDPOINT must be a full URL (starting with "https://script.google.com/macros/s/.../exec"). You entered an ID ("${trimmedUrl}") instead of the Web App URL.`
      );
    }
  }

  // Validate that the URL is a Web App /exec URL
  if (trimmedUrl.includes("/dev")) {
    throw new Error(
      "Your IMAGE_UPLOAD_ENDPOINT ends with /dev. You must use the production Web App URL ending with /exec."
    );
  }
  if (trimmedUrl.includes("/edit")) {
    throw new Error(
      "Your IMAGE_UPLOAD_ENDPOINT is the Apps Script editor URL. You must deploy it as a Web App (Deploy > Manage Deployments) and use the /exec URL."
    );
  }

  // Strip data URI prefix if present
  const cleanBase64 = base64Image.replace(/^data:image\/\w+;base64,/, "");

  const response = await fetch(trimmedUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      base64: cleanBase64,
      fileName: filename || "image.jpg",
      folderId: folderId && folderId.trim() ? folderId.trim() : undefined,
    }),
    redirect: "manual",
  });

  let rawText = "";

  // Handle Google Apps Script 302 / 301 redirect
  if (response.status === 302 || response.status === 301) {
    const redirectUrl = response.headers.get("location");
    if (!redirectUrl) {
      throw new Error("Apps Script returned 302 redirect without a Location header.");
    }

    const redirectResponse = await fetch(redirectUrl, {
      method: "GET",
    });

    rawText = await redirectResponse.text();
  } else {
    rawText = await response.text();
  }

  // Parse response safely
  let data: any;
  try {
    data = JSON.parse(rawText);
  } catch {
    // If the response is HTML, analyze what Google returned
    if (
      rawText.includes("accounts.google.com") ||
      rawText.includes("Sign in") ||
      rawText.includes("ServiceLogin")
    ) {
      throw new Error(
        "Google Apps Script requires sign-in. In Google Apps Script, click Deploy > Manage deployments > Edit (pencil icon), and set 'Who has access' to 'Anyone', then click Deploy."
      );
    }

    if (rawText.includes("Script function not found")) {
      throw new Error(
        "Google Apps Script could not find the 'doPost' function. Ensure your script code has 'function doPost(e)' and deploy a New Version."
      );
    }

    const titleMatch = rawText.match(/<title>([^<]+)<\/title>/i);
    const pageTitle = titleMatch ? ` (${titleMatch[1].trim()})` : "";
    throw new Error(
      `Google Apps Script returned an HTML page${pageTitle} instead of JSON. Ensure 'Who has access' is set to 'Anyone', and check the 'Executions' tab in script.google.com to see the error details.`
    );
  }

  if (data.error) {
    throw new Error(`Google Apps Script error: ${data.error}`);
  }

  const id = data.id || data.imageId || data.fileId;
  if (!id) {
    throw new Error("Upload endpoint did not return a valid file ID.");
  }

  return { id, url: data.url };
}

export async function POST(request: NextRequest) {
  try {
    const { base64Image, filename } = await request.json();

    if (!base64Image) {
      return NextResponse.json(
        { error: "Base64 image data is required" },
        { status: 400 }
      );
    }

    // Method 1 (Recommended for Personal Google Accounts):
    // Use IMAGE_UPLOAD_ENDPOINT (Google Apps Script) which executes under the user's account and uses personal storage
    const uploadEndpoint = process.env.IMAGE_UPLOAD_ENDPOINT;
    if (uploadEndpoint && uploadEndpoint.trim()) {
      try {
        const result = await uploadToAppsScript(
          uploadEndpoint.trim(),
          base64Image,
          filename,
          process.env.GOOGLE_DRIVE_FOLDER_ID
        );
        return NextResponse.json({
          success: true,
          imageId: result.id,
          url: result.url || `/api/image/${result.id}`,
        });
      } catch (scriptErr) {
        console.error("IMAGE_UPLOAD_ENDPOINT upload failed:", scriptErr);
        throw scriptErr;
      }
    }

    // Method 2: Direct Google Drive API (Only works on Google Workspace Shared Drives)
    try {
      const { drive } = await getGoogleServices();

      const cleanBase64 = base64Image.replace(/^data:image\/\w+;base64,/, "");
      const buffer = Buffer.from(cleanBase64, "base64");
      const stream = Readable.from(buffer);

      const fileMetadata: { name: string; parents?: string[] } = {
        name: filename || `report-img-${Date.now()}.jpg`,
      };

      const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
      if (folderId && folderId.trim()) {
        fileMetadata.parents = [folderId.trim()];
      }

      const driveResponse = await drive.files.create({
        supportsAllDrives: true,
        requestBody: fileMetadata,
        media: {
          mimeType: "image/jpeg",
          body: stream,
        },
        fields: "id, name, webViewLink",
      });

      const fileId = driveResponse.data.id;
      if (!fileId) {
        throw new Error("Google Drive did not return a valid file ID.");
      }

      return NextResponse.json({
        success: true,
        imageId: fileId,
        url: driveResponse.data.webViewLink || `/api/image/${fileId}`,
      });
    } catch (driveErr: any) {
      const msg = driveErr?.message || "";
      if (
        msg.includes("Service Accounts do not have storage quota") ||
        msg.includes("storageQuotaExceeded")
      ) {
        throw new Error(
          "Personal Google accounts do not allow Service Accounts to upload files directly (0 bytes quota). Please deploy the Google Apps Script Web App and set the IMAGE_UPLOAD_ENDPOINT environment variable in Vercel."
        );
      }
      throw driveErr;
    }
  } catch (error) {
    console.error("Error uploading image:", error);
    return NextResponse.json(
      {
        error: "Failed to upload image",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
