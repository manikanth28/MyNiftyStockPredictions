"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  formatDate,
  formatDateTime,
  formatNumber,
  formatPercent,
  formatPrice,
  isRecommendedPlan,
  normalizeSymbol,
  priceMoveMeta
} from "@/components/market-ui";
import { useLatestPriceOverlay } from "@/components/use-latest-price-overlay";
import {
  buyWalletPosition,
  calculateWalletMetrics,
  createDefaultWallet,
  persistWallet,
  readStoredWallet,
  resetWallet,
  sellWalletPosition,
  suggestWalletCheckboxDefaults
} from "@/lib/portfolio-wallet";
import type { PortfolioWallet, WalletOpenPosition, WalletTradeExitReason } from "@/lib/portfolio-wallet";
import type { HorizonId, RecommendationDataset, StockAnalysis } from "@/lib/types";

type PortfolioDashboardProps = {
  data: RecommendationDataset;
  initialSymbol?: string;
  initialHorizon?: HorizonId;
};

type FeedbackTone = "success" | "danger" | "neutral";

const DEFAULT_TICKET_NOTES = "";

function parseQuantity(value: string) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function formatSignedPrice(value: number) {
  const prefix = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${prefix}${formatPrice(Math.abs(value))}`;
}

function formatSignedPercent(value: number) {
  const prefix = value > 0 ? "+" : "";
  return `${prefix}${value.toFixed(2)}%`;
}

function exitReasonLabel(reason: WalletTradeExitReason) {
  switch (reason) {
    case "target_hit":
      return "Target hit";
    case "stop_loss_hit":
      return "Stop-loss hit";
    case "manual":
      return "Manual exit";
  }
}

function exitReasonTone(reason: WalletTradeExitReason) {
  switch (reason) {
    case "target_hit":
      return "success";
    case "stop_loss_hit":
      return "danger";
    case "manual":
      return "neutral";
  }
}

function defaultHorizon(data: RecommendationDataset, initialHorizon?: HorizonId) {
  if (initialHorizon && data.profiles.some((profile) => profile.id === initialHorizon)) {
    return initialHorizon;
  }

  return data.profiles[0]?.id ?? "single_day";
}

function recommendedStocks(data: RecommendationDataset, horizon: HorizonId) {
  return data.currentBatch.recommendations
    .filter((stock) => isRecommendedPlan(stock.profiles[horizon]))
    .sort((left, right) => (right.profiles[horizon].score ?? 0) - (left.profiles[horizon].score ?? 0));
}

function stockCurrentPrice(stock: StockAnalysis, latestPrice?: number | null) {
  return latestPrice && Number.isFinite(latestPrice) ? latestPrice : stock.currentMarketPrice;
}

export function PortfolioDashboard({ data, initialSymbol, initialHorizon }: PortfolioDashboardProps) {
  const [wallet, setWallet] = useState<PortfolioWallet | null>(null);
  const [activeHorizon, setActiveHorizon] = useState<HorizonId>(() => defaultHorizon(data, initialHorizon));
  const [selectedSymbol, setSelectedSymbol] = useState("");
  const [quantityInput, setQuantityInput] = useState("1");
  const [startingCashInput, setStartingCashInput] = useState("1000000");
  const [autoSellAtTarget, setAutoSellAtTarget] = useState(false);
  const [autoSellAtStopLoss, setAutoSellAtStopLoss] = useState(true);
  const [notes, setNotes] = useState(DEFAULT_TICKET_NOTES);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [feedbackTone, setFeedbackTone] = useState<FeedbackTone>("neutral");

  const stockBySymbol = useMemo(
    () => new Map(data.currentBatch.recommendations.map((stock) => [normalizeSymbol(stock.symbol), stock])),
    [data.currentBatch.recommendations]
  );
  const visibleRecommendations = useMemo(() => recommendedStocks(data, activeHorizon), [activeHorizon, data]);
  const selectedStock = stockBySymbol.get(normalizeSymbol(selectedSymbol)) ?? visibleRecommendations[0] ?? null;
  const selectedPlan = selectedStock?.profiles[activeHorizon] ?? null;
  const openSymbols = wallet?.openPositions.map((position) => position.symbol) ?? [];
  const liveSymbols = [
    ...openSymbols,
    ...(selectedStock ? [selectedStock.symbol] : []),
    ...visibleRecommendations.slice(0, 12).map((stock) => stock.symbol)
  ];
  const livePriceOverlay = useLatestPriceOverlay(liveSymbols);

  useEffect(() => {
    const stored = readStoredWallet();
    const nextWallet = stored ?? createDefaultWallet();

    if (!stored) {
      persistWallet(nextWallet);
    }

    setWallet(nextWallet);
    setStartingCashInput(String(nextWallet.settings.startingCash));
  }, []);

  useEffect(() => {
    const normalizedInitial = normalizeSymbol(initialSymbol ?? "");
    const preferredStock = normalizedInitial ? stockBySymbol.get(normalizedInitial) : null;
    const fallbackStock = visibleRecommendations[0] ?? data.currentBatch.recommendations[0] ?? null;

    setSelectedSymbol((preferredStock ?? fallbackStock)?.symbol ?? "");
  }, [data.currentBatch.recommendations, initialSymbol, stockBySymbol, visibleRecommendations]);

  useEffect(() => {
    if (!selectedPlan || !wallet) {
      return;
    }

    const defaults = suggestWalletCheckboxDefaults(selectedPlan, activeHorizon);
    const riskAmount = wallet.cashBalance * (wallet.settings.defaultRiskPct / 100);
    const riskPerShare = Math.max(selectedPlan.entryPrice - selectedPlan.stopLoss, 0.01);
    const maxAffordableQuantity = Math.floor(wallet.cashBalance / Math.max(selectedPlan.entryPrice, 0.01));
    const riskSizedQuantity = Math.floor(riskAmount / riskPerShare);
    const nextQuantity = Math.max(1, Math.min(maxAffordableQuantity, Math.max(1, riskSizedQuantity)));

    setAutoSellAtTarget(defaults.autoSellAtTarget);
    setAutoSellAtStopLoss(defaults.autoSellAtStopLoss);
    setQuantityInput(maxAffordableQuantity > 0 ? String(nextQuantity) : "0");
    setNotes(DEFAULT_TICKET_NOTES);
  }, [activeHorizon, selectedPlan, wallet]);

  const currentPriceBySymbol = useMemo(() => {
    const prices: Record<string, number> = {};

    for (const position of wallet?.openPositions ?? []) {
      const normalized = normalizeSymbol(position.symbol);
      const stock = stockBySymbol.get(normalized);
      prices[position.symbol] =
        livePriceOverlay[position.symbol]?.currentMarketPrice ?? stock?.currentMarketPrice ?? position.entryPrice;
    }

    for (const stock of visibleRecommendations) {
      prices[stock.symbol] = stockCurrentPrice(stock, livePriceOverlay[stock.symbol]?.currentMarketPrice);
    }

    if (selectedStock) {
      prices[selectedStock.symbol] = stockCurrentPrice(
        selectedStock,
        livePriceOverlay[selectedStock.symbol]?.currentMarketPrice
      );
    }

    return prices;
  }, [livePriceOverlay, selectedStock, stockBySymbol, visibleRecommendations, wallet?.openPositions]);

  const metrics = useMemo(
    () => (wallet ? calculateWalletMetrics(wallet, currentPriceBySymbol) : null),
    [currentPriceBySymbol, wallet]
  );
  const selectedDefaults = selectedPlan
    ? suggestWalletCheckboxDefaults(selectedPlan, activeHorizon)
    : null;
  const selectedCurrentPrice = selectedStock
    ? currentPriceBySymbol[selectedStock.symbol] ?? selectedStock.currentMarketPrice
    : null;
  const selectedMove =
    selectedPlan && selectedCurrentPrice !== null ? priceMoveMeta(selectedCurrentPrice, selectedPlan.entryPrice) : null;
  const ticketQuantity = parseQuantity(quantityInput);
  const ticketCost = selectedPlan ? ticketQuantity * selectedPlan.entryPrice : 0;
  const maxAffordableQuantity =
    wallet && selectedPlan ? Math.floor(wallet.cashBalance / Math.max(selectedPlan.entryPrice, 0.01)) : 0;

  function commitWallet(nextWallet: PortfolioWallet) {
    persistWallet(nextWallet);
    setWallet(nextWallet);
  }

  function showFeedback(message: string, tone: FeedbackTone) {
    setFeedback(message);
    setFeedbackTone(tone);
  }

  function handleResetWallet() {
    const parsedCash = Number.parseFloat(startingCashInput);
    const nextWallet = resetWallet(Number.isFinite(parsedCash) && parsedCash > 0 ? parsedCash : undefined);

    setWallet(nextWallet);
    setStartingCashInput(String(nextWallet.settings.startingCash));
    showFeedback("Paper wallet reset with fresh starting cash.", "neutral");
  }

  function handleBuy() {
    if (!wallet || !selectedStock || !selectedPlan) {
      return;
    }

    try {
      const nextWallet = buyWalletPosition(wallet, {
        stock: selectedStock,
        plan: selectedPlan,
        horizon: activeHorizon,
        quantity: ticketQuantity,
        sourceBatchDate: data.currentBatch.batchDate,
        sourceGeneratedAt: data.currentBatch.generatedAt,
        autoSellAtTarget,
        autoSellAtStopLoss,
        notes
      });

      commitWallet(nextWallet);
      showFeedback(`Bought ${ticketQuantity} ${selectedStock.symbol} in paper wallet.`, "success");
    } catch (error) {
      showFeedback(error instanceof Error ? error.message : "Unable to buy this position.", "danger");
    }
  }

  function handleSell(position: WalletOpenPosition, reason: WalletTradeExitReason) {
    if (!wallet) {
      return;
    }

    try {
      const exitPrice = currentPriceBySymbol[position.symbol] ?? position.entryPrice;
      const nextWallet = sellWalletPosition(wallet, position.id, exitPrice, reason);

      commitWallet(nextWallet);
      showFeedback(`Closed ${position.symbol} at ${formatPrice(exitPrice)}.`, "success");
    } catch (error) {
      showFeedback(error instanceof Error ? error.message : "Unable to close this position.", "danger");
    }
  }

  useEffect(() => {
    if (!wallet || !wallet.openPositions.length) {
      return;
    }

    let nextWallet = wallet;
    const triggered: string[] = [];

    for (const position of wallet.openPositions) {
      const currentPrice = currentPriceBySymbol[position.symbol];

      if (!currentPrice || !Number.isFinite(currentPrice)) {
        continue;
      }

      if (position.autoSellAtTarget && currentPrice >= position.targetPrice) {
        nextWallet = sellWalletPosition(nextWallet, position.id, currentPrice, "target_hit");
        triggered.push(`${position.symbol} target`);
        continue;
      }

      if (position.autoSellAtStopLoss && currentPrice <= position.stopLoss) {
        nextWallet = sellWalletPosition(nextWallet, position.id, currentPrice, "stop_loss_hit");
        triggered.push(`${position.symbol} stop-loss`);
      }
    }

    if (triggered.length && nextWallet !== wallet) {
      commitWallet(nextWallet);
      showFeedback(`Auto-exit completed for ${triggered.join(", ")}.`, "success");
    }
  }, [currentPriceBySymbol, wallet]);

  if (!wallet || !metrics) {
    return (
      <main className="shell portfolio-shell">
        <section className="card portfolio-hero-card">
          <span className="section-eyebrow">Paper wallet</span>
          <h1>Loading wallet...</h1>
        </section>
      </main>
    );
  }

  return (
    <main className="shell portfolio-shell">
      <section className="card portfolio-hero-card">
        <div className="portfolio-hero-copy">
          <span className="section-eyebrow">Paper wallet</span>
          <h1>Simulate recommendations before risking real capital.</h1>
          <p>
            Buy model setups into a local browser wallet, track live mark-to-market P&L, and let optional target or
            stop-loss rules close positions automatically.
          </p>
        </div>

        <div className="portfolio-settings-card">
          <label>
            <span>Starting cash</span>
            <input
              min={1000}
              onChange={(event) => setStartingCashInput(event.target.value)}
              type="number"
              value={startingCashInput}
            />
          </label>
          <button className="portfolio-secondary-button" onClick={handleResetWallet} type="button">
            Reset wallet
          </button>
        </div>
      </section>

      <section className="portfolio-metric-grid">
        <article className="portfolio-metric-card">
          <span>Available cash</span>
          <strong>{formatPrice(metrics.availableCash)}</strong>
          <small>{formatNumber(wallet.ledger.length)} ledger events</small>
        </article>
        <article className="portfolio-metric-card">
          <span>Total equity</span>
          <strong>{formatPrice(metrics.totalEquity)}</strong>
          <small>{formatSignedPercent(metrics.totalReturnPct)} total return</small>
        </article>
        <article className={`portfolio-metric-card ${metrics.unrealizedPnl >= 0 ? "success" : "danger"}`}>
          <span>Unrealized P&L</span>
          <strong>{formatSignedPrice(metrics.unrealizedPnl)}</strong>
          <small>{formatPrice(metrics.currentValue)} current open value</small>
        </article>
        <article className={`portfolio-metric-card ${metrics.realizedPnl >= 0 ? "success" : "danger"}`}>
          <span>Realized P&L</span>
          <strong>{formatSignedPrice(metrics.realizedPnl)}</strong>
          <small>{metrics.winRate === null ? "No closed trades" : `${metrics.winRate.toFixed(1)}% win rate`}</small>
        </article>
      </section>

      {feedback ? <div className={`portfolio-feedback ${feedbackTone}`}>{feedback}</div> : null}

      <div className="portfolio-grid">
        <section className="card portfolio-ticket-card">
          <div className="portfolio-section-head">
            <div>
              <span className="section-eyebrow">Trade ticket</span>
              <h2>Add a recommendation</h2>
            </div>
            <span className="portfolio-batch-pill">Batch {formatDate(data.currentBatch.batchDate)}</span>
          </div>

          <div className="portfolio-horizon-row">
            {data.profiles.map((profile) => (
              <button
                className={`portfolio-horizon-pill${profile.id === activeHorizon ? " active" : ""}`}
                key={profile.id}
                onClick={() => setActiveHorizon(profile.id)}
                type="button"
              >
                <span>{profile.label}</span>
                <small>{profile.window}</small>
              </button>
            ))}
          </div>

          <label className="portfolio-field">
            <span>Stock</span>
            <select value={selectedStock?.symbol ?? ""} onChange={(event) => setSelectedSymbol(event.target.value)}>
              {visibleRecommendations.map((stock) => (
                <option key={`${activeHorizon}-${stock.symbol}`} value={stock.symbol}>
                  {stock.symbol} - {stock.companyName}
                </option>
              ))}
            </select>
          </label>

          {selectedStock && selectedPlan ? (
            <>
              <div className="portfolio-selected-stock">
                <div>
                  <strong>{selectedStock.companyName}</strong>
                  <span>
                    {selectedStock.symbol} - {selectedStock.sector} - Score{" "}
                    {selectedPlan.score?.toFixed(1) ?? "n/a"}
                  </span>
                </div>
                <Link className="portfolio-inline-link" href={`/stocks/${selectedStock.symbol}`}>
                  Open stock
                </Link>
              </div>

              <div className="portfolio-ticket-price-grid">
                <article>
                  <span>Entry</span>
                  <strong>{formatPrice(selectedPlan.entryPrice)}</strong>
                </article>
                <article>
                  <span>Now</span>
                  <strong>{selectedCurrentPrice !== null ? formatPrice(selectedCurrentPrice) : "n/a"}</strong>
                  {selectedMove ? <small className={selectedMove.tone}>{selectedMove.move}</small> : null}
                </article>
                <article>
                  <span>Target</span>
                  <strong>{formatPrice(selectedPlan.targetPrice)}</strong>
                </article>
                <article>
                  <span>Stop-loss</span>
                  <strong>{formatPrice(selectedPlan.stopLoss)}</strong>
                </article>
              </div>

              <div className="portfolio-ticket-controls">
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
                  <input readOnly value={formatPrice(ticketCost)} />
                  <small>Cash after buy: {formatPrice(Math.max(wallet.cashBalance - ticketCost, 0))}</small>
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
                    <small>{selectedDefaults?.targetReason}</small>
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
                    <small>{selectedDefaults?.stopLossReason}</small>
                  </span>
                </label>
              </div>

              <label className="portfolio-field">
                <span>Notes</span>
                <textarea
                  onChange={(event) => setNotes(event.target.value)}
                  placeholder={selectedPlan.summary}
                  value={notes}
                />
              </label>

              <button
                className="portfolio-primary-button"
                disabled={ticketQuantity <= 0 || ticketCost <= 0 || ticketCost > wallet.cashBalance}
                onClick={handleBuy}
                type="button"
              >
                Buy in paper wallet
              </button>
            </>
          ) : (
            <p className="portfolio-empty-copy">No tradable recommendations are available for this horizon.</p>
          )}
        </section>

        <section className="card portfolio-positions-card">
          <div className="portfolio-section-head">
            <div>
              <span className="section-eyebrow">Open positions</span>
              <h2>{metrics.openPositionCount} active lots</h2>
            </div>
          </div>

          {wallet.openPositions.length ? (
            <div className="portfolio-position-list">
              {wallet.openPositions.map((position) => {
                const currentPrice = currentPriceBySymbol[position.symbol] ?? position.entryPrice;
                const currentValue = currentPrice * position.quantity;
                const costBasis = position.entryPrice * position.quantity;
                const pnl = currentValue - costBasis;
                const pnlPct = (pnl / Math.max(costBasis, 0.01)) * 100;
                const move = priceMoveMeta(currentPrice, position.entryPrice);

                return (
                  <article className="portfolio-position-card" key={position.id}>
                    <div className="portfolio-position-top">
                      <div>
                        <strong>{position.symbol}</strong>
                        <span>{position.companyName}</span>
                      </div>
                      <span className={`portfolio-position-pnl ${pnl >= 0 ? "success" : "danger"}`}>
                        {formatSignedPrice(pnl)} / {formatSignedPercent(pnlPct)}
                      </span>
                    </div>
                    <div className="portfolio-position-grid">
                      <span>Qty {formatNumber(position.quantity)}</span>
                      <span>Entry {formatPrice(position.entryPrice)}</span>
                      <span>Now {formatPrice(currentPrice)}</span>
                      <span className={move.tone}>{move.move}</span>
                      <span>Target {formatPrice(position.targetPrice)}</span>
                      <span>Stop {formatPrice(position.stopLoss)}</span>
                    </div>
                    <div className="portfolio-position-rules">
                      <span>{position.autoSellAtTarget ? "Target auto-sell on" : "Target auto-sell off"}</span>
                      <span>{position.autoSellAtStopLoss ? "Stop auto-sell on" : "Stop auto-sell off"}</span>
                      <span>Opened {formatDateTime(position.openedAt)}</span>
                    </div>
                    <div className="portfolio-position-actions">
                      <Link className="portfolio-secondary-button compact" href={`/stocks/${position.symbol}`}>
                        Review
                      </Link>
                      <button
                        className="portfolio-secondary-button compact"
                        onClick={() => handleSell(position, "manual")}
                        type="button"
                      >
                        Manual sell
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <p className="portfolio-empty-copy">No open positions yet. Add a recommendation from the trade ticket.</p>
          )}
        </section>
      </div>

      <section className="card portfolio-history-card">
        <div className="portfolio-section-head">
          <div>
            <span className="section-eyebrow">Closed trades</span>
            <h2>Realized outcome log</h2>
          </div>
          <span className="portfolio-batch-pill">{metrics.closedTradeCount} closed</span>
        </div>

        {wallet.closedTrades.length ? (
          <div className="portfolio-history-table-wrap">
            <table className="portfolio-history-table">
              <thead>
                <tr>
                  <th>Stock</th>
                  <th>Horizon</th>
                  <th>Entry</th>
                  <th>Exit</th>
                  <th>Reason</th>
                  <th>P&L</th>
                  <th>Closed</th>
                </tr>
              </thead>
              <tbody>
                {wallet.closedTrades.map((trade) => (
                  <tr key={`${trade.id}-${trade.closedAt}`}>
                    <td>
                      <strong>{trade.symbol}</strong>
                      <span>{trade.companyName}</span>
                    </td>
                    <td>{data.profiles.find((profile) => profile.id === trade.horizon)?.label ?? trade.horizon}</td>
                    <td>{formatPrice(trade.entryPrice)}</td>
                    <td>{formatPrice(trade.exitPrice)}</td>
                    <td>
                      <span className={`portfolio-outcome-pill ${exitReasonTone(trade.exitReason)}`}>
                        {exitReasonLabel(trade.exitReason)}
                      </span>
                    </td>
                    <td className={trade.realizedPnl >= 0 ? "success" : "danger"}>
                      {formatSignedPrice(trade.realizedPnl)} / {formatPercent(trade.returnPct)}
                    </td>
                    <td>{formatDateTime(trade.closedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="portfolio-empty-copy">Closed trades will appear after a manual sell or auto target/stop exit.</p>
        )}
      </section>
    </main>
  );
}
