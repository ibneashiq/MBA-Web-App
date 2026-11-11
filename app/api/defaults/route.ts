import { NextResponse } from "next/server";
import { getDefaultValues } from "../../utils/defaults";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const defaults = await getDefaultValues();
    return NextResponse.json(defaults);
  } catch (error) {
    console.error("Error fetching defaults:", error);
    return NextResponse.json(
      { error: "Failed to fetch default values" },
      { status: 500 }
    );
  }
}


