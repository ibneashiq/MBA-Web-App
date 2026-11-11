import { NextRequest, NextResponse } from "next/server";
import { getGoogleServices } from "../../utils/google";
import { Readable } from "stream";

export const dynamic = "force-dynamic";

/**
 * Handles uploading via Google Apps Script Web App.
 * Google Apps Script returns a 302 redirect with a Location header.
 * We manually follow the redirect to retrieve the resulting JSON.
 */
async function uploadToAppsScript(
  url: string,
  base64Image: string,
  filename: string
): Promise<{ id: string; url?: string }> {
  // Strip data URI prefix if present
  const cleanBase64 = base64Image.replace(/^data:image\/\w+;base64,/, "");

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      base64: cleanBase64,
      fileName: filename || "image.jpg",
    }),
    redirect: "manual",
  });

  // Handle Google Apps Script 302 / 301 redirect
  if (response.status === 302 || response.status === 301) {
    const redirectUrl = response.headers.get("location");
    if (!redirectUrl) {
      throw new Error("Apps Script returned 302 redirect without a Location header.");
    }

    const redirectResponse = await fetch(redirectUrl, {
      method: "GET",
    });

    if (!redirectResponse.ok) {
      const errText = await redirectResponse.text();
      throw new Error(`Google Apps Script redirect returned error: ${errText}`);
    }

    const data = await redirectResponse.json();
    if (data.error) {
      throw new Error(`Google Apps Script error: ${data.error}`);
    }

    const id = data.id || data.imageId || data.fileId;
    if (!id) {
      throw new Error("Google Apps Script did not return a valid file ID.");
    }

    return { id, url: data.url };
  }

  // If response is not redirected
  const data = await response.json();
  if (!response.ok || data.error) {
    throw new Error(data.error || `Upload endpoint returned status ${response.status}`);
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
          filename
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
