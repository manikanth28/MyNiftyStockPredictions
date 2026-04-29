"use client";

import { persistWallet, readStoredWallet } from "@/lib/portfolio-wallet";
import type {
  BuyPositionInput,
  PortfolioWallet,
  SellPositionOptions,
  WalletTradeExitReason
} from "@/lib/portfolio-wallet";

type WalletResponse = {
  wallet: PortfolioWallet;
};

function shouldMigrateLegacyWallet(serverWallet: PortfolioWallet, legacyWallet: PortfolioWallet | null) {
  if (!legacyWallet) {
    return false;
  }

  const serverLooksUnused =
    serverWallet.openPositions.length === 0 &&
    serverWallet.closedTrades.length === 0 &&
    serverWallet.cashBalance === serverWallet.settings.startingCash;
  const legacyHasActivity =
    legacyWallet.openPositions.length > 0 ||
    legacyWallet.closedTrades.length > 0 ||
    legacyWallet.cashBalance !== legacyWallet.settings.startingCash;

  return serverLooksUnused && legacyHasActivity;
}

function dispatchWalletUpdate(wallet: PortfolioWallet) {
  persistWallet(wallet);
}

async function readWalletResponse(response: Response) {
  const payload = (await response.json().catch(() => ({}))) as Partial<WalletResponse> & {
    error?: string;
  };

  if (!response.ok || !payload.wallet) {
    throw new Error(payload.error || `Wallet request failed with HTTP ${response.status}.`);
  }

  dispatchWalletUpdate(payload.wallet);
  return payload.wallet;
}

export async function readSharedWallet(signal?: AbortSignal) {
  const legacyWallet = readStoredWallet();
  const wallet = await readWalletResponse(
    await fetch("/api/wallet", {
      cache: "no-store",
      signal
    })
  );

  if (legacyWallet && shouldMigrateLegacyWallet(wallet, legacyWallet)) {
    return replaceSharedWallet(legacyWallet);
  }

  return wallet;
}

export async function buySharedWallet(input: BuyPositionInput) {
  return readWalletResponse(
    await fetch("/api/wallet", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        action: "buy",
        ...input
      })
    })
  );
}

export async function sellSharedWallet(
  positionId: string,
  exitPrice: number,
  exitReason: WalletTradeExitReason,
  options: SellPositionOptions = {}
) {
  return readWalletResponse(
    await fetch("/api/wallet", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        action: "sell",
        positionId,
        exitPrice,
        exitReason,
        ...options
      })
    })
  );
}

export async function resetSharedWallet(startingCash?: number) {
  return readWalletResponse(
    await fetch("/api/wallet", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        action: "reset",
        startingCash
      })
    })
  );
}

export async function replaceSharedWallet(wallet: PortfolioWallet) {
  return readWalletResponse(
    await fetch("/api/wallet", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        action: "replace",
        wallet
      })
    })
  );
}
