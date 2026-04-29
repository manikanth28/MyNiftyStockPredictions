import { NextResponse } from "next/server";
import { fetchLatestPriceOverlay } from "@/lib/recommendation-data";

export const dynamic = "force-dynamic";

type LatestPriceRequestBody = {
  symbols?: string[];
};

export async function POST(request: Request) {
  let body: LatestPriceRequestBody = {};

  try {
    body = (await request.json()) as LatestPriceRequestBody;
  } catch {
    body = {};
  }

  const symbols = Array.isArray(body.symbols)
    ? body.symbols.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    : [];

  const uniqueSymbols = [...new Set(symbols)];
  const chunkSize = 25;
  const pricesList = await Promise.all(
    Array.from({ length: Math.ceil(uniqueSymbols.length / chunkSize) }, (_, index) =>
      fetchLatestPriceOverlay(uniqueSymbols.slice(index * chunkSize, (index + 1) * chunkSize))
    )
  );
  const prices = Object.assign({}, ...pricesList);

  return NextResponse.json({
    prices,
    syncedAt: new Date().toISOString()
  });
}
