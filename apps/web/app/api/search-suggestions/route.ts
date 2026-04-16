import { NextResponse } from "next/server";
import { lookupNseSuggestions } from "@/lib/company-research";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get("q")?.trim() ?? "";

  if (!query) {
    return NextResponse.json({ suggestions: [] });
  }

  try {
    const suggestions = await lookupNseSuggestions(query, 8);

    return NextResponse.json({ suggestions });
  } catch {
    return NextResponse.json(
      {
        suggestions: [],
        error: "Live suggestions are unavailable right now."
      },
      { status: 502 }
    );
  }
}
