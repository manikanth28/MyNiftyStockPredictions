"use client";

import Link from "next/link";
import type { MouseEvent } from "react";
import { useEffect, useMemo, useState } from "react";
import {
  formatNumber,
  formatPrice,
  priceMoveMeta
} from "@/components/market-ui";
import { useLatestPriceOverlay } from "@/components/use-latest-price-overlay";
import {
  buyWalletPosition,
  calculateWalletMetrics,
  createDefaultWallet,
  persistWallet,
  readStoredWallet,
  suggestWalletCheckboxDefaults
} from "@/lib/portfolio-wallet";
import type { PortfolioWallet } from "@/lib/portfolio-wallet";
import type { HorizonId, RecommendationPlan, StockAnalysis } from "@/lib/types";

type WalletBuyModalProps = {
  stock: StockAnalysis;
  plan: RecommendationPlan;
  horizon: HorizonId;
  sourceBatchDate: string;
  sourceGeneratedAt: string;
  currentPrice?: number | null;
  triggerClassName?: string;
  triggerLabel?: string;
  triggerTitle?: string;
};

type FeedbackTone = "success" | "danger" | "neutral";
type WalletNotice = {
  message: string;
  tone: FeedbackTone;
};

function parseQuantity(value: string) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function formatSignedPrice(value: number) {
  const prefix = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${prefix}${formatPrice(Math.abs(value))}`;
}

function positionSymbols(wallet: PortfolioWallet | null, stock: StockAnalysis) {
  return [
    stock.symbol,
    ...(wallet?.openPositions.map((position) => position.symbol) ?? [])
  ];
}

export function WalletBuyModal({
  stock,
  plan,
  horizon,
  sourceBatchDate,
  sourceGeneratedAt,
  currentPrice,
  triggerClassName = "portfolio-primary-button",
  triggerLabel = "Buy in wallet",
  triggerTitle = "Buy in paper wallet"
}: WalletBuyModalProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [wallet, setWallet] = useState<PortfolioWallet | null>(null);
  const [quantityInput, setQuantityInput] = useState("1");
  const [autoSellAtTarget, setAutoSellAtTarget] = useState(false);
  const [autoSellAtStopLoss, setAutoSellAtStopLoss] = useState(true);
  const [notes, setNotes] = useState("");
  const [feedback, setFeedback] = useState<string | null>(null);
  const [feedbackTone, setFeedbackTone] = useState<FeedbackTone>("neutral");
  const [notice, setNotice] = useState<WalletNotice | null>(null);
  const livePriceOverlay = useLatestPriceOverlay(positionSymbols(wallet, stock));

  useEffect(() => {
    const storedWallet = readStoredWallet();
    const nextWallet = storedWallet ?? createDefaultWallet();

    if (!storedWallet) {
      persistWallet(nextWallet);
    }

    setWallet(nextWallet);
  }, []);

  useEffect(() => {
    if (!wallet || !isOpen) {
      return;
    }

    const defaults = suggestWalletCheckboxDefaults(plan, horizon);
    const riskAmount = wallet.cashBalance * (wallet.settings.defaultRiskPct / 100);
    const riskPerShare = Math.max(plan.entryPrice - plan.stopLoss, 0.01);
    const maxAffordableQuantity = Math.floor(wallet.cashBalance / Math.max(plan.entryPrice, 0.01));
    const riskSizedQuantity = Math.floor(riskAmount / riskPerShare);
    const nextQuantity = Math.max(1, Math.min(maxAffordableQuantity, Math.max(1, riskSizedQuantity)));

    setAutoSellAtTarget(defaults.autoSellAtTarget);
    setAutoSellAtStopLoss(defaults.autoSellAtStopLoss);
    setQuantityInput(maxAffordableQuantity > 0 ? String(nextQuantity) : "0");
    setNotes("");
    setFeedback(null);
  }, [horizon, isOpen, plan, wallet]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    };

    document.addEventListener("keydown", handleKeyDown);

    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen]);

  useEffect(() => {
    if (!notice) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setNotice(null);
    }, 6500);

    return () => window.clearTimeout(timeoutId);
  }, [notice]);

  const currentPriceBySymbol = useMemo(() => {
    const prices: Record<string, number> = {};

    if (wallet) {
      for (const position of wallet.openPositions) {
        prices[position.symbol] =
          livePriceOverlay[position.symbol]?.currentMarketPrice ?? position.entryPrice;
      }
    }

    prices[stock.symbol] =
      currentPrice ??
      livePriceOverlay[stock.symbol]?.currentMarketPrice ??
      stock.currentMarketPrice;

    return prices;
  }, [currentPrice, livePriceOverlay, stock.currentMarketPrice, stock.symbol, wallet]);
  const metrics = wallet ? calculateWalletMetrics(wallet, currentPriceBySymbol) : null;
  const defaults = suggestWalletCheckboxDefaults(plan, horizon);
  const quantity = parseQuantity(quantityInput);
  const estimatedCost = quantity * plan.entryPrice;
  const cashAfterBuy = Math.max((wallet?.cashBalance ?? 0) - estimatedCost, 0);
  const maxAffordableQuantity = wallet ? Math.floor(wallet.cashBalance / Math.max(plan.entryPrice, 0.01)) : 0;
  const displayCurrentPrice = currentPriceBySymbol[stock.symbol] ?? stock.currentMarketPrice;
  const move = priceMoveMeta(displayCurrentPrice, plan.entryPrice);
  const buyBlockReason = !wallet
    ? "Wallet is still loading. Try again in a moment."
    : quantity <= 0
      ? "Enter a quantity of at least 1 share."
      : estimatedCost <= 0
        ? "Estimated cost is not valid for this trade."
        : estimatedCost > wallet.cashBalance
          ? `Not enough paper cash. This order needs ${formatPrice(estimatedCost)}, but available cash is ${formatPrice(wallet.cashBalance)}.`
          : null;

  function openModal(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();
    setIsOpen(true);
  }

  function closeModal() {
    setIsOpen(false);
  }

  function showFeedback(message: string, tone: FeedbackTone) {
    setFeedback(message);
    setFeedbackTone(tone);
  }

  function handleBuy() {
    if (buyBlockReason) {
      showFeedback(buyBlockReason, wallet ? "danger" : "neutral");
      return;
    }

    if (!wallet) {
      showFeedback("Wallet is still loading.", "neutral");
      return;
    }

    try {
      const nextWallet = buyWalletPosition(wallet, {
        stock,
        plan,
        horizon,
        quantity,
        sourceBatchDate,
        sourceGeneratedAt,
        autoSellAtTarget,
        autoSellAtStopLoss,
        notes
      });

      persistWallet(nextWallet);
      setWallet(nextWallet);
      setNotice({
        tone: "success",
        message: `Bought ${quantity} ${stock.symbol} for ${formatPrice(estimatedCost)}. Available cash: ${formatPrice(nextWallet.cashBalance)}.`
      });
      setFeedback(null);
      setIsOpen(false);
    } catch (error) {
      showFeedback(error instanceof Error ? error.message : "Unable to buy this position.", "danger");
    }
  }

  return (
    <>
      <button className={triggerClassName} onClick={openModal} title={triggerTitle} type="button">
        {triggerLabel}
      </button>

      {notice ? (
        <div className={`wallet-toast ${notice.tone}`} role="status">
          <strong>{notice.tone === "success" ? "Paper buy saved" : "Wallet update"}</strong>
          <span>{notice.message}</span>
          <Link href="/portfolio">View portfolio</Link>
        </div>
      ) : null}

      {isOpen ? (
        <div className="wallet-modal-backdrop" onClick={closeModal} role="presentation">
          <section
            aria-label={`Buy ${stock.symbol} in paper wallet`}
            aria-modal="true"
            className="wallet-modal"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
          >
            <div className="wallet-modal-head">
              <div>
                <span className="section-eyebrow">Paper wallet buy</span>
                <h2>{stock.companyName}</h2>
                <p>
                  {stock.symbol} - {stock.sector} - {horizon.replace("_", " ")}
                </p>
              </div>
              <button className="wallet-modal-close" onClick={closeModal} type="button">
                Close
              </button>
            </div>

            <div className="wallet-balance-grid">
              <article>
                <span>Available cash</span>
                <strong>{metrics ? formatPrice(metrics.availableCash) : "Loading"}</strong>
              </article>
              <article>
                <span>Total equity</span>
                <strong>{metrics ? formatPrice(metrics.totalEquity) : "Loading"}</strong>
              </article>
              <article>
                <span>Open value</span>
                <strong>{metrics ? formatPrice(metrics.currentValue) : "Loading"}</strong>
              </article>
              <article>
                <span>Unrealized P&L</span>
                <strong className={metrics && metrics.unrealizedPnl < 0 ? "danger" : "success"}>
                  {metrics ? formatSignedPrice(metrics.unrealizedPnl) : "Loading"}
                </strong>
              </article>
            </div>

            <div className="wallet-trade-grid">
              <article>
                <span>Entry</span>
                <strong>{formatPrice(plan.entryPrice)}</strong>
              </article>
              <article>
                <span>Now</span>
                <strong>{formatPrice(displayCurrentPrice)}</strong>
                <small className={move.tone}>{move.move}</small>
              </article>
              <article>
                <span>Target</span>
                <strong>{formatPrice(plan.targetPrice)}</strong>
              </article>
              <article>
                <span>Stop-loss</span>
                <strong>{formatPrice(plan.stopLoss)}</strong>
              </article>
            </div>

            <div className="wallet-ticket-controls">
              <label className="portfolio-field">
                <span>Quantity</span>
                <input
                  min={0}
                  onChange={(event) => setQuantityInput(event.target.value)}
                  type="number"
                  value={quantityInput}
                />
                <small>Max affordable: {formatNumber(maxAffordableQuantity)}</small>
              </label>
              <label className="portfolio-field">
                <span>Estimated cost</span>
                <input readOnly value={formatPrice(estimatedCost)} />
                <small>Cash after buy: {formatPrice(cashAfterBuy)}</small>
              </label>
            </div>

            <div className="portfolio-checkbox-panel">
              <label>
                <input
                  checked={autoSellAtTarget}
                  onChange={(event) => setAutoSellAtTarget(event.target.checked)}
                  type="checkbox"
                />
                <span>
                  Auto-sell at target
                  <small>{defaults.targetReason}</small>
                </span>
              </label>
              <label>
                <input
                  checked={autoSellAtStopLoss}
                  onChange={(event) => setAutoSellAtStopLoss(event.target.checked)}
                  type="checkbox"
                />
                <span>
                  Auto-sell at stop-loss
                  <small>{defaults.stopLossReason}</small>
                </span>
              </label>
            </div>

            <label className="portfolio-field">
              <span>Notes</span>
              <textarea
                onChange={(event) => setNotes(event.target.value)}
                placeholder={plan.summary}
                value={notes}
              />
            </label>

            {feedback ? <div className={`portfolio-feedback ${feedbackTone}`}>{feedback}</div> : null}

            <div className="wallet-modal-actions">
              <button
                className="portfolio-primary-button"
                onClick={handleBuy}
                type="button"
              >
                Confirm buy
              </button>
              <Link className="portfolio-secondary-button" href="/portfolio" onClick={closeModal}>
                Open portfolio
              </Link>
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
