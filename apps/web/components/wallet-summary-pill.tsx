"use client";

import Link from "next/link";
import { useMemo } from "react";
import { formatPrice } from "@/components/market-ui";
import { useSharedWallet } from "@/components/use-shared-wallet";
import { useLatestPriceOverlay } from "@/components/use-latest-price-overlay";
import { calculateWalletMetrics } from "@/lib/portfolio-wallet";

function formatSignedPrice(value: number) {
  const prefix = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${prefix}${formatPrice(Math.abs(value))}`;
}

export function WalletSummaryPill() {
  const { wallet } = useSharedWallet();

  const symbols = useMemo(() => wallet?.openPositions.map((position) => position.symbol) ?? [], [wallet]);
  const livePriceOverlay = useLatestPriceOverlay(symbols, 15000);
  const currentPriceBySymbol = useMemo(() => {
    const prices: Record<string, number> = {};

    for (const position of wallet?.openPositions ?? []) {
      prices[position.symbol] =
        livePriceOverlay[position.symbol]?.currentMarketPrice ?? position.entryPrice;
    }

    return prices;
  }, [livePriceOverlay, wallet?.openPositions]);
  const metrics = wallet ? calculateWalletMetrics(wallet, currentPriceBySymbol) : null;
  const pnlTone = metrics && metrics.unrealizedPnl < 0 ? "danger" : "success";

  return (
    <Link
      className={`wallet-summary-pill ${pnlTone}`}
      href="/portfolio"
      title={
        metrics
          ? `Open paper portfolio. Cash ${formatPrice(metrics.availableCash)}. Total equity ${formatPrice(metrics.totalEquity)}.`
          : "Open paper portfolio"
      }
    >
      <span>Portfolio value</span>
      <strong>{metrics ? formatPrice(metrics.currentValue) : "Loading"}</strong>
      <small className="wallet-summary-pnl">
        {metrics
          ? `P&L ${formatSignedPrice(metrics.unrealizedPnl)}`
          : "Reading wallet"}
      </small>
    </Link>
  );
}
