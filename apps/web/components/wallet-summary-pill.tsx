"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { formatPrice } from "@/components/market-ui";
import { useLatestPriceOverlay } from "@/components/use-latest-price-overlay";
import {
  WALLET_STORAGE_EVENT,
  calculateWalletMetrics,
  createDefaultWallet,
  persistWallet,
  readStoredWallet
} from "@/lib/portfolio-wallet";
import type { PortfolioWallet } from "@/lib/portfolio-wallet";

function formatSignedPrice(value: number) {
  const prefix = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${prefix}${formatPrice(Math.abs(value))}`;
}

function readOrCreateWallet() {
  const storedWallet = readStoredWallet();

  if (storedWallet) {
    return storedWallet;
  }

  const wallet = createDefaultWallet();
  persistWallet(wallet);
  return wallet;
}

export function WalletSummaryPill() {
  const [wallet, setWallet] = useState<PortfolioWallet | null>(null);

  useEffect(() => {
    setWallet(readOrCreateWallet());

    const refreshWallet = () => {
      setWallet(readStoredWallet());
    };
    const handleStorage = (event: StorageEvent) => {
      if (!event.key || event.key.includes("paper-wallet")) {
        refreshWallet();
      }
    };

    window.addEventListener(WALLET_STORAGE_EVENT, refreshWallet);
    window.addEventListener("storage", handleStorage);

    return () => {
      window.removeEventListener(WALLET_STORAGE_EVENT, refreshWallet);
      window.removeEventListener("storage", handleStorage);
    };
  }, []);

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
  const pnlTone = metrics && metrics.totalPnl < 0 ? "danger" : "success";

  return (
    <Link className={`wallet-summary-pill ${pnlTone}`} href="/portfolio" title="Open paper portfolio">
      <span>Portfolio value</span>
      <strong>{metrics ? formatPrice(metrics.totalEquity) : "Loading"}</strong>
      <small>
        {metrics
          ? `${metrics.openPositionCount} open · P&L ${formatSignedPrice(metrics.totalPnl)}`
          : "Reading wallet"}
      </small>
    </Link>
  );
}
