import type { HorizonId, RecommendationPlan, StockAnalysis } from "@/lib/types";

export type WalletTradeExitReason = "manual" | "target_hit" | "stop_loss_hit";

export type WalletSettings = {
  startingCash: number;
  defaultRiskPct: number;
  createdAt: string;
  updatedAt: string;
};

export type WalletOpenPosition = {
  id: string;
  symbol: string;
  companyName: string;
  sector: string;
  horizon: HorizonId;
  quantity: number;
  entryPrice: number;
  targetPrice: number;
  stopLoss: number;
  sourceBatchDate: string;
  sourceGeneratedAt: string;
  sourceScore: number | null;
  conviction: RecommendationPlan["conviction"];
  openedAt: string;
  autoSellAtTarget: boolean;
  autoSellAtStopLoss: boolean;
  notes: string;
};

export type WalletClosedTrade = WalletOpenPosition & {
  closedAt: string;
  exitPrice: number;
  exitReason: WalletTradeExitReason;
  realizedPnl: number;
  returnPct: number;
  exitNote?: string;
  archiveEvaluatedOn?: string | null;
  archiveHoldingDays?: number | null;
};

export type WalletLedgerEntry = {
  id: string;
  occurredAt: string;
  type: "deposit" | "buy" | "sell" | "reset";
  symbol: string | null;
  description: string;
  amount: number;
  cashAfter: number;
};

export type PortfolioWallet = {
  version: 1;
  settings: WalletSettings;
  cashBalance: number;
  openPositions: WalletOpenPosition[];
  closedTrades: WalletClosedTrade[];
  ledger: WalletLedgerEntry[];
};

export type WalletCheckboxDefaults = {
  autoSellAtTarget: boolean;
  autoSellAtStopLoss: boolean;
  targetReason: string;
  stopLossReason: string;
};

export type WalletMetrics = {
  investedValue: number;
  currentValue: number;
  availableCash: number;
  totalEquity: number;
  realizedPnl: number;
  unrealizedPnl: number;
  totalPnl: number;
  totalReturnPct: number;
  openPositionCount: number;
  closedTradeCount: number;
  winRate: number | null;
};

export type BuyPositionInput = {
  stock: StockAnalysis;
  plan: RecommendationPlan;
  horizon: HorizonId;
  quantity: number;
  sourceBatchDate: string;
  sourceGeneratedAt: string;
  autoSellAtTarget: boolean;
  autoSellAtStopLoss: boolean;
  notes?: string;
};

export type SellPositionOptions = {
  quantity?: number;
  closedAt?: string;
  exitNote?: string;
  archiveEvaluatedOn?: string | null;
  archiveHoldingDays?: number | null;
};

export const WALLET_STORAGE_KEY = "stock-research-paper-wallet-v1";
export const WALLET_STORAGE_EVENT = "stock-research-paper-wallet-updated";
export const DEFAULT_STARTING_CASH = 1_000_000;
const DEFAULT_RISK_PCT = 1;
const LEDGER_LIMIT = 200;

const HORIZON_THRESHOLDS: Record<HorizonId, number> = {
  single_day: 54,
  swing: 56,
  position: 58,
  long_term: 60
};

function nowIso() {
  return new Date().toISOString();
}

function makeId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function sanitizeAmount(value: number, fallback = 0) {
  return Number.isFinite(value) && value >= 0 ? roundMoney(value) : fallback;
}

function sanitizeQuantity(value: number) {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function scoreFor(plan: RecommendationPlan) {
  return typeof plan.score === "number" && Number.isFinite(plan.score) ? plan.score : 0;
}

function createLedgerEntry(
  type: WalletLedgerEntry["type"],
  description: string,
  amount: number,
  cashAfter: number,
  symbol: string | null = null
): WalletLedgerEntry {
  return {
    id: makeId("ledger"),
    occurredAt: nowIso(),
    type,
    symbol,
    description,
    amount: roundMoney(amount),
    cashAfter: roundMoney(cashAfter)
  };
}

function withLedger(wallet: PortfolioWallet, entry: WalletLedgerEntry): PortfolioWallet {
  return {
    ...wallet,
    ledger: [entry, ...wallet.ledger].slice(0, LEDGER_LIMIT)
  };
}

export function createDefaultWallet(startingCash = DEFAULT_STARTING_CASH): PortfolioWallet {
  const createdAt = nowIso();
  const cash = sanitizeAmount(startingCash, DEFAULT_STARTING_CASH);
  const wallet: PortfolioWallet = {
    version: 1,
    settings: {
      startingCash: cash,
      defaultRiskPct: DEFAULT_RISK_PCT,
      createdAt,
      updatedAt: createdAt
    },
    cashBalance: cash,
    openPositions: [],
    closedTrades: [],
    ledger: []
  };

  return withLedger(wallet, createLedgerEntry("deposit", "Initial paper wallet funding", cash, cash));
}

export function isPortfolioWallet(value: unknown): value is PortfolioWallet {
  if (!value || typeof value !== "object") {
    return false;
  }

  const wallet = value as Partial<PortfolioWallet>;

  return (
    wallet.version === 1 &&
    typeof wallet.cashBalance === "number" &&
    Array.isArray(wallet.openPositions) &&
    Array.isArray(wallet.closedTrades) &&
    Array.isArray(wallet.ledger) &&
    typeof wallet.settings?.startingCash === "number"
  );
}

export function readStoredWallet(): PortfolioWallet | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const payload = window.localStorage.getItem(WALLET_STORAGE_KEY);

    if (!payload) {
      return null;
    }

    const parsed = JSON.parse(payload);
    return isPortfolioWallet(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function persistWallet(wallet: PortfolioWallet) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(WALLET_STORAGE_KEY, JSON.stringify(wallet));
  window.dispatchEvent(
    new CustomEvent(WALLET_STORAGE_EVENT, {
      detail: wallet
    })
  );
}

export function resetWallet(startingCash = DEFAULT_STARTING_CASH) {
  const wallet = createDefaultWallet(startingCash);
  persistWallet(wallet);
  return wallet;
}

export function suggestWalletCheckboxDefaults(plan: RecommendationPlan, horizon: HorizonId): WalletCheckboxDefaults {
  const threshold = HORIZON_THRESHOLDS[horizon];
  const score = scoreFor(plan);
  const isTradable = plan.isRecommended ?? score >= threshold;
  const strongScore = score >= threshold + 10;
  const strongPayoff = plan.riskReward >= 1.5;
  const fragilePayoff = plan.riskReward < 1.25;

  return {
    autoSellAtTarget: isTradable && strongScore && strongPayoff,
    autoSellAtStopLoss: isTradable || fragilePayoff,
    targetReason:
      isTradable && strongScore && strongPayoff
        ? "Default on because the score and risk/reward are strong enough to lock gains mechanically."
        : "Default off because this setup may need manual review before taking profits.",
    stopLossReason:
      isTradable || fragilePayoff
        ? "Default on because the stop-loss is the model's maximum planned downside for this setup."
        : "Default off because the setup is not a confirmed buy; use manual monitoring if you still track it."
  };
}

export function buyWalletPosition(wallet: PortfolioWallet, input: BuyPositionInput): PortfolioWallet {
  const quantity = sanitizeQuantity(input.quantity);

  if (quantity <= 0) {
    throw new Error("Quantity must be at least 1 share.");
  }

  const investedAmount = roundMoney(quantity * input.plan.entryPrice);

  if (investedAmount > wallet.cashBalance) {
    throw new Error("Not enough paper cash for this position.");
  }

  const openedAt = nowIso();
  const nextCash = roundMoney(wallet.cashBalance - investedAmount);
  const position: WalletOpenPosition = {
    id: makeId("lot"),
    symbol: input.stock.symbol,
    companyName: input.stock.companyName,
    sector: input.stock.sector,
    horizon: input.horizon,
    quantity,
    entryPrice: input.plan.entryPrice,
    targetPrice: input.plan.targetPrice,
    stopLoss: input.plan.stopLoss,
    sourceBatchDate: input.sourceBatchDate,
    sourceGeneratedAt: input.sourceGeneratedAt,
    sourceScore: typeof input.plan.score === "number" ? input.plan.score : null,
    conviction: input.plan.conviction,
    openedAt,
    autoSellAtTarget: input.autoSellAtTarget,
    autoSellAtStopLoss: input.autoSellAtStopLoss,
    notes: input.notes?.trim() || input.plan.summary
  };
  const updatedWallet: PortfolioWallet = {
    ...wallet,
    settings: {
      ...wallet.settings,
      updatedAt: openedAt
    },
    cashBalance: nextCash,
    openPositions: [position, ...wallet.openPositions]
  };

  return withLedger(
    updatedWallet,
    createLedgerEntry("buy", `Bought ${quantity} ${input.stock.symbol}`, -investedAmount, nextCash, input.stock.symbol)
  );
}

export function sellWalletPosition(
  wallet: PortfolioWallet,
  positionId: string,
  exitPrice: number,
  exitReason: WalletTradeExitReason,
  options: SellPositionOptions = {}
): PortfolioWallet {
  const position = wallet.openPositions.find((item) => item.id === positionId);

  if (!position) {
    return wallet;
  }

  if (!Number.isFinite(exitPrice) || exitPrice <= 0) {
    throw new Error("Exit price must be greater than zero.");
  }

  const requestedQuantity = sanitizeQuantity(options.quantity ?? position.quantity);

  if (requestedQuantity <= 0) {
    throw new Error("Exit quantity must be at least 1 share.");
  }

  const closedQuantity = Math.min(requestedQuantity, position.quantity);
  const remainingQuantity = position.quantity - closedQuantity;
  const closedAt = options.closedAt ?? nowIso();
  const exitValue = roundMoney(closedQuantity * exitPrice);
  const costBasis = roundMoney(closedQuantity * position.entryPrice);
  const realizedPnl = roundMoney(exitValue - costBasis);
  const returnPct = roundMoney((realizedPnl / Math.max(costBasis, 0.01)) * 100);
  const closedTrade: WalletClosedTrade = {
    ...position,
    quantity: closedQuantity,
    closedAt,
    exitPrice: roundMoney(exitPrice),
    exitReason,
    realizedPnl,
    returnPct,
    exitNote: options.exitNote,
    archiveEvaluatedOn: options.archiveEvaluatedOn ?? null,
    archiveHoldingDays: options.archiveHoldingDays ?? null
  };
  const nextCash = roundMoney(wallet.cashBalance + exitValue);
  const updatedWallet: PortfolioWallet = {
    ...wallet,
    settings: {
      ...wallet.settings,
      updatedAt: closedAt
    },
    cashBalance: nextCash,
    openPositions:
      remainingQuantity > 0
        ? wallet.openPositions.map((item) =>
            item.id === positionId
              ? {
                  ...item,
                  quantity: remainingQuantity
                }
              : item
          )
        : wallet.openPositions.filter((item) => item.id !== positionId),
    closedTrades: [closedTrade, ...wallet.closedTrades]
  };

  return withLedger(
    updatedWallet,
    createLedgerEntry(
      "sell",
      `Sold ${closedQuantity} ${position.symbol}${remainingQuantity > 0 ? ` (${remainingQuantity} remaining)` : ""}`,
      exitValue,
      nextCash,
      position.symbol
    )
  );
}

export function calculateWalletMetrics(
  wallet: PortfolioWallet,
  currentPrices: Record<string, number | null | undefined>
): WalletMetrics {
  const investedValue = roundMoney(
    wallet.openPositions.reduce((sum, position) => sum + position.quantity * position.entryPrice, 0)
  );
  const currentValue = roundMoney(
    wallet.openPositions.reduce((sum, position) => {
      const currentPrice = currentPrices[position.symbol] ?? position.entryPrice;
      return sum + position.quantity * currentPrice;
    }, 0)
  );
  const realizedPnl = roundMoney(wallet.closedTrades.reduce((sum, trade) => sum + trade.realizedPnl, 0));
  const unrealizedPnl = roundMoney(currentValue - investedValue);
  const totalPnl = roundMoney(realizedPnl + unrealizedPnl);
  const totalEquity = roundMoney(wallet.cashBalance + currentValue);
  const winCount = wallet.closedTrades.filter((trade) => trade.realizedPnl > 0).length;
  const winRate = wallet.closedTrades.length ? (winCount / wallet.closedTrades.length) * 100 : null;

  return {
    investedValue,
    currentValue,
    availableCash: wallet.cashBalance,
    totalEquity,
    realizedPnl,
    unrealizedPnl,
    totalPnl,
    totalReturnPct: roundMoney((totalPnl / Math.max(wallet.settings.startingCash, 0.01)) * 100),
    openPositionCount: wallet.openPositions.length,
    closedTradeCount: wallet.closedTrades.length,
    winRate
  };
}
