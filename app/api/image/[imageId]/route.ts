import { NextRequest, NextResponse } from "next/server";
import { getGoogleServices } from "../../../utils/google";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ imageId: string }> }
) {
  try {
    const { imageId } = await params;

    if (!imageId) {
      return NextResponse.json(
        { error: "Image ID is required" },
        { status: 400 }
      );
    }

    const { drive } = await getGoogleServices();

    // Get the file from Google Drive
    const response = await drive.files.get(
      {
        fileId: imageId,
        alt: "media",
      },
      {
        responseType: "arraybuffer",
      }
    );

    // Get file metadata for content type
    const metadata = await drive.files.get({
      fileId: imageId,
      fields: "mimeType",
    });

    const mimeType = metadata.data.mimeType || "image/jpeg";
    const imageBuffer = Buffer.from(response.data as ArrayBuffer);

    return new NextResponse(imageBuffer, {
      headers: {
        "Content-Type": mimeType,
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch (error) {
    console.error("Error fetching image:", error);
    return NextResponse.json(
      {
        error: "Failed to fetch image",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
