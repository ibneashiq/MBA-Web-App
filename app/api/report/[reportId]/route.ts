import { NextRequest, NextResponse } from "next/server";
import { getReportFromSheets } from "../../../utils/sheetsWriter";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ reportId: string }> }
) {
  try {
    const { reportId } = await params;

    if (!reportId) {
      return NextResponse.json(
        { error: "Report ID is required" },
        { status: 400 }
      );
    }

    const formData = await getReportFromSheets(reportId);

    if (!formData) {
      return NextResponse.json(
        { error: "Report not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      reportId,
      data: formData,
    });
  } catch (error) {
    console.error("Error fetching report:", error);
    return NextResponse.json(
      {
        error: "Failed to fetch report",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
