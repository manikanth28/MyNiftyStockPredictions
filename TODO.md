# Project TODOs

This file captures the todos discussed so far and mirrors the current tracked todo state.

## Summary

| Status | Count |
| --- | ---: |
| In progress | 4 |
| Pending | 7 |
| Blocked | 12 |
| Done | 32 |

## In progress

- **Backtesting and evaluation** (`backtesting-and-evaluation`) - Archive outcomes, daily success-rate views, basic historical outcome tracking, and archive-vs-live comparison are present. Still missing multi-day hit rate, average return, max drawdown, horizon-wise performance, benchmark comparison, and confidence calibration.
- **Data and news pipeline** (`data-and-news-pipeline`) - Google News sentiment, earnings and analyst classification, NSE announcement merge path, research-source status, cached NSE session reuse, request timeouts, and moderate research concurrency are present. Still missing stronger live coverage, MoneyControl decisioning, better stock and sector tagging, and better relevance ranking.
- **QA and testing** (`qa-and-testing`) - IDE diagnostics are clean on touched files. Broader regression and runtime coverage are still needed for sorting, live-price overlays, refresh flows, and stricter recommendation gating after more observed batches.
- **Research console UI** (`research-console-ui`) - Redesigned dashboard, search, archive, stronger stock detail workspace, tradable-vs-waiting separation, fixed suggested price, live current-price overlay, move split, and sortable live tables are present. Still missing richer filters, top gainers/losers views, final sector cleanup, and more UI polish.

## Pending

- **API and monitoring** (`api-and-monitoring`) - Health check, cached fallback, source visibility, research coverage visibility, and refresh endpoint/basic error handling are present. Still missing structured logs, centralized source success/failure tracking, freshness checks, retry handling, and a simple monitoring view. Depends on: `data-and-news-pipeline`.
- **Daily automation** (`daily-automation`) - Live/cached generation, daily batch persistence, and manual refresh exist. Still missing scheduled EOD runs, market-calendar-aware execution, retries, run tracking, and end-to-end automation. Depends on: `data-and-news-pipeline`.
- **Suggest checkbox defaults** (`portfolio-checkbox-guidance`) - Add deterministic guidance for target and stop-loss auto-sell checkbox defaults based on confidence, score strength, and risk/reward. Depends on: `portfolio-wallet-model`.
- **Add portfolio trade actions** (`portfolio-trade-actions`) - Add buy flows from recommendation surfaces with quantity, source batch, horizon, saved entry/target/stop, two buy-time checkboxes, model-guided suggestions, and manual sell controls. Depends on: `portfolio-checkbox-guidance`, `portfolio-wallet-model`.
- **Reconcile wallet outcomes** (`portfolio-wallet-evaluator`) - Connect paper trades to archived outcomes and live price overlays so target-hit, stop-loss-hit, and manual-sell events update realized P&L and return cash correctly. Depends on: `portfolio-wallet-model`.
- **Create paper wallet model** (`portfolio-wallet-model`) - Add a limited-cash browser-persisted wallet with settings, cash balance, ledger, open lots, closed trades, checkbox selections, and derived portfolio metrics.
- **Build portfolio page** (`portfolio-wallet-page`) - Add `/portfolio` and navigation with starting cash, available cash, invested value, total equity, realized/unrealized P&L, open positions, closed trades, and month-scale performance review. Depends on: `portfolio-trade-actions`, `portfolio-wallet-evaluator`, `portfolio-wallet-model`.

## Blocked

- **Add current system tests** (`add-current-tests`) - Merged into `qa-and-testing`. Extend the existing Python unittest suite for current API and analytics behavior.
- **Add monitoring and retraining** (`add-monitoring`) - Merged into `api-and-monitoring`. Track freshness, drift, recommendation quality, and retraining triggers. Depends on: `build-ingestion`, `build-recommendation-api`, `train-baseline-model`.
- **Add sector columns in UI** (`add-sector-columns-ui`) - Merged into `research-console-ui`. Make sector consistently visible across stock-linked UI surfaces.
- **Add TradingView charts** (`add-tradingview-charts`) - Blocked by product direction change. The chosen path is chart-analysis logic in the model, not a TradingView widget.
- **Build backtesting and evaluation** (`build-backtesting`) - Merged into `backtesting-and-evaluation`. Compare recommendations against benchmarks and simpler strategies. Depends on: `train-baseline-model`.
- **Build ingestion pipeline** (`build-ingestion`) - Merged into `data-and-news-pipeline`. Implement live market price-history ingestion, snapshot caching, live Screener fundamentals, and Google News analysis. Depends on: `design-data-model`.
- **Build recommendation API** (`build-recommendation-api`) - Merged into `api-and-monitoring`. Expose ranked recommendations, explanations, confidence, and audit metadata. Depends on: `build-backtesting`, `build-trade-plan-engine`, `train-baseline-model`.
- **Expand UI and API tests** (`expand-ui-api-tests`) - Merged into `qa-and-testing`. Add broader automated API/UI coverage using existing test setup where possible.
- **Fix archive layout regression** (`fix-archive-layout-regression`) - Merged into `research-console-ui`. Refactor history dashboard to use shared stable card/layout styles.
- **Redesign dashboard UX** (`redesign-dashboard-ux`) - Merged into `research-console-ui`. Move to a decision-first dashboard layout with sticky context, KPI strip, compact table, and structured sidebar.
- **Redesign stock workspace** (`redesign-stock-workspace`) - Merged into `research-console-ui`. Rework stock detail around stronger CTAs, KPIs, score/risk presentation, and clearer horizon tabs.
- **Schedule daily market runs** (`schedule-daily-runs`) - Merged into `daily-automation`. Add market-calendar-aware orchestration for supported trading days. Depends on: `build-ingestion`, `build-recommendation-api`.

## Done

- **Add chart analysis model** (`add-chart-analysis-model`) - Integrated breakout, candle-quality, range-behavior, and moving-average-slope signals into the technical model and downside-fragility logic.
- **Add recommendation history menu** (`add-history-menu`) - Added prior-batch navigation so older calls can be inspected for target hit, failure, or open status.
- **Add search autocomplete** (`add-search-autocomplete`) - Added live NSE search suggestions from local data plus Yahoo search suggestions.
- **Add single-day horizon** (`add-single-day-horizon`) - Added a single-day recommendation horizon across model, dashboard, search, fallback normalization, history, and API compatibility.
- **Add stock search analyzer** (`add-stock-search`) - Added a symbol search flow that analyzes an NSE stock with the live model.
- **Add stop-loss learning** (`add-stop-loss-learning`) - Added stop-loss-hit reasoning and model aggressiveness reduction based on recent stop-loss feedback.
- **Align stock detail panels** (`align-stock-detail-panels`) - Reworked the stock detail page into aligned analysis rows.
- **Audit feature coverage** (`audit-feature-coverage`) - Reviewed the current system against the requested checklist and identified present, partial, and missing pieces.
- **Build research features** (`build-features`) - Built reusable momentum, valuation, quality, volatility, liquidity, and regime features.
- **Build operator dashboard** (`build-operator-ui`) - Created a lightweight research dashboard with ranked recommendations and stock detail view.
- **Build trade plan engine** (`build-trade-plan-engine`) - Added transparent entry, target, and stop-loss generation across supported horizons.
- **Choose technical stack** (`choose-stack`) - Selected the architecture, storage, orchestration, model-serving pattern, and deployment target.
- **Define product scope** (`define-scope`) - Defined target user, market scope, recommendation-batch contents, and supported horizons.
- **Design data model** (`design-data-model`) - Defined source adapters, schemas, identifier normalization, snapshots, and feature contracts.
- **Design horizon strategy profiles** (`design-horizon-profiles`) - Defined swing, position, and long-term profiles and the later intraday path.
- **Enhance stock table** (`enhance-stock-table`) - Added explicit symbol and current market price columns to the dashboard table.
- **Expand chart analysis** (`expand-chart-analysis`) - Added cause-and-effect explainability, score-to-reasoning navigation, and hover guidance across analysis panels.
- **Expand live coverage** (`expand-live-coverage`) - Expanded the live watchlist beyond the original ten names and surfaced a broader shortlist.
- **Expand Nifty 100 coverage** (`expand-nifty100-coverage`) - Expanded the live universe to Nifty 100 with safer concurrency and dated snapshot persistence.
- **Sync live prices** (`fix-sample-prices`) - Replaced stale mock CMP behavior with live reference pricing at runtime.
- **Improve Windows launcher** (`improve-launcher`) - Updated `run-app.bat` to install dependencies if needed, start the server, wait for localhost, and open the browser.
- **Polish dashboard UI** (`polish-dashboard-ui`) - Redesigned the dashboard into a clearer card-based layout with better sectioning and scrolling behavior.
- **Prepare free hosting** (`prepare-free-hosting`) - Reduced filesystem dependence, added a health endpoint, added Render config, and documented free hosting options.
- **Redesign archive dashboard** (`redesign-archive-dashboard`) - Turned the archive workspace into a purpose-first dashboard with KPIs, filters, and connected details.
- **Redesign stock detail UX** (`redesign-stock-detail-ux`) - Replaced the old stock detail page with a compact decision-first layout.
- **Reorganize dashboard pages** (`reorganize-dashboard-pages`) - Split the unstable single page into dedicated home, history, and stock workspace routes.
- **Retune dashboard colors** (`retune-dashboard-colors`) - Refined the light theme hierarchy and header surface styling.
- **Separate dashboard watchlist** (`separate-dashboard-watchlist`) - Kept below-threshold names out of the main recommendation list and showed them in a separate section.
- **Train baseline ranking model** (`train-baseline-model`) - Implemented the first ranking and scoring pipeline for return, downside risk, and confidence.
- **Upgrade fundamental engine** (`upgrade-fundamental-engine`) - Extended the fundamentals layer with richer valuation, leverage, return, earnings-growth, cash-flow, and sector-aware reasoning.
- **Upgrade technical engine** (`upgrade-technical-engine`) - Added MACD, Bollinger-band context, stronger volume-trend analysis, candlestick labels, and clearer trend classification.
- **Wire panel score reasoning** (`wire-panel-score-reasoning`) - Added explicit earnings and analyst reasoning and linked score tiles to explanation panels.
