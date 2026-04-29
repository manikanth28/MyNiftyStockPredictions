"use client";

import { useEffect, useState } from "react";
import { WALLET_STORAGE_EVENT } from "@/lib/portfolio-wallet";
import type { PortfolioWallet } from "@/lib/portfolio-wallet";
import { readSharedWallet } from "@/lib/wallet-client";

export function useSharedWallet(refreshIntervalMs = 15000) {
  const [wallet, setWallet] = useState<PortfolioWallet | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    let refreshInFlight = false;
    const controller = new AbortController();

    const refreshWallet = async (signal?: AbortSignal) => {
      if (cancelled || refreshInFlight) {
        return;
      }

      refreshInFlight = true;

      try {
        const nextWallet = await readSharedWallet(signal);

        if (!cancelled) {
          setWallet(nextWallet);
          setError(null);
        }
      } catch (requestError) {
        if (!cancelled && !signal?.aborted) {
          setError(requestError instanceof Error ? requestError.message : "Unable to read shared wallet.");
        }
      } finally {
        refreshInFlight = false;

        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    const handleWalletEvent = (event: Event) => {
      const walletEvent = event as CustomEvent<PortfolioWallet>;

      if (walletEvent.detail) {
        setWallet(walletEvent.detail);
      } else {
        void refreshWallet();
      }
    };

    void refreshWallet(controller.signal);
    window.addEventListener(WALLET_STORAGE_EVENT, handleWalletEvent);

    const intervalId = window.setInterval(() => {
      void refreshWallet();
    }, refreshIntervalMs);

    return () => {
      cancelled = true;
      controller.abort();
      window.clearInterval(intervalId);
      window.removeEventListener(WALLET_STORAGE_EVENT, handleWalletEvent);
    };
  }, [refreshIntervalMs]);

  return {
    wallet,
    setWallet,
    error,
    isLoading
  };
}
