import { NextResponse } from "next/server";
import { getNextProjectNumber } from "../../utils/sheetsWriter";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const nextProjectNo = await getNextProjectNumber();

    return NextResponse.json({
      projectNo: nextProjectNo,
    });
  } catch (error) {
    console.error("Error getting next project number:", error);
    return NextResponse.json(
      {
        error: "Failed to get next project number",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
