"use client";

import { useEffect, useMemo, useState } from "react";
import { type LatestPriceOverlay, readLatestPriceOverlay } from "@/components/market-ui";

const LIVE_PRICE_SYNC_INTERVAL_MS = 5_000;

export function useLatestPriceOverlay(
  symbols: string[],
  refreshIntervalMs = LIVE_PRICE_SYNC_INTERVAL_MS
) {
  const normalizedSymbols = useMemo(
    () => [...new Set(symbols.map((symbol) => symbol.trim().toUpperCase()).filter(Boolean))],
    [symbols]
  );
  const symbolsKey = useMemo(() => normalizedSymbols.join("|"), [normalizedSymbols]);
  const [prices, setPrices] = useState<LatestPriceOverlay>({});

  useEffect(() => {
    if (!normalizedSymbols.length) {
      setPrices({});
      return;
    }

    let cancelled = false;
    let refreshInFlight = false;
    const controller = new AbortController();

    const refreshPrices = async (signal?: AbortSignal) => {
      if (cancelled || refreshInFlight) {
        return;
      }

      refreshInFlight = true;

      try {
        const nextPrices = await readLatestPriceOverlay(normalizedSymbols, signal);

        if (!cancelled) {
          setPrices(nextPrices);
        }
      } catch (error) {
        if (signal?.aborted || cancelled) {
          return;
        }

        console.warn("Latest market price sync failed; keeping saved snapshot prices.", error);
      } finally {
        refreshInFlight = false;
      }
    };

    void refreshPrices(controller.signal);

    const intervalId = window.setInterval(() => {
      void refreshPrices();
    }, refreshIntervalMs);
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void refreshPrices();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      cancelled = true;
      controller.abort();
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [refreshIntervalMs, symbolsKey]);

  return prices;
}
