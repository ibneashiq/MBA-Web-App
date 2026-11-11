import { NextRequest, NextResponse } from "next/server";
import { getGoogleServices } from "../../utils/google";
import { Readable } from "stream";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const { base64Image, filename } = await request.json();

    if (!base64Image) {
      return NextResponse.json(
        { error: "Base64 image data is required" },
        { status: 400 }
      );
    }

    // Attempt 1: If external IMAGE_UPLOAD_ENDPOINT is configured, try it first
    const uploadEndpoint = process.env.IMAGE_UPLOAD_ENDPOINT;
    if (uploadEndpoint && uploadEndpoint.trim()) {
      try {
        const response = await fetch(uploadEndpoint.trim(), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            base64: base64Image,
            fileName: filename || "image.jpg",
          }),
          redirect: "follow",
        });

        if (response.ok) {
          const result = await response.json();
          const imageId = result.id || result.imageId || result.fileId;
          if (imageId) {
            return NextResponse.json({
              success: true,
              imageId,
              url: result.url,
            });
          }
        } else {
          const errText = await response.text();
          console.warn("IMAGE_UPLOAD_ENDPOINT returned non-OK status:", response.status, errText);
        }
      } catch (endpointError) {
        console.warn(
          "External IMAGE_UPLOAD_ENDPOINT failed, falling back to direct Google Drive upload:",
          endpointError
        );
      }
    }

    // Attempt 2 (Direct): Upload directly to Google Drive via Service Account
    const { drive } = await getGoogleServices();

    // Strip data URI prefix if present
    const cleanBase64 = base64Image.replace(/^data:image\/\w+;base64,/, "");
    const buffer = Buffer.from(cleanBase64, "base64");
    const stream = Readable.from(buffer);

    const fileMetadata: { name: string; parents?: string[] } = {
      name: filename || `report-img-${Date.now()}.jpg`,
    };

    // If a target Google Drive folder is configured, put the image inside it
    const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
    if (folderId && folderId.trim()) {
      fileMetadata.parents = [folderId.trim()];
    }

    const driveResponse = await drive.files.create({
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
