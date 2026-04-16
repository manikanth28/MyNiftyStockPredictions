# Indian equities recommendation platform

This repository now includes a research-first stock recommendation system for **Indian equities**. The dashboard analyzes a live NSE watchlist using recent market history, produces ranked multi-horizon recommendations, and explains each idea with an entry, target, and stop-loss instead of acting like a black-box tip engine.

## Chosen product scope

- **User:** analyst or serious retail investor
- **Market:** liquid NSE equities, now starting from a dedicated **Nifty 100 universe master**
- **Delivery:** web dashboard
- **Mode:** research and decision support, not broker execution
- **Batch cadence:** run **after market close** on trading days and publish a next-session trade plan
- **MVP horizons:** single-day, swing, position, and long-term
- **Later phase:** intraday once a separate high-frequency data stack exists

## Chosen stack

| Area | Choice | Why |
| --- | --- | --- |
| Frontend | **Next.js + TypeScript** | Strong dashboard UX, routing, and server/client composition |
| UI style | **shadcn/ui-style patterns** | Clean analyst workflow without heavyweight theme lock-in |
| API | **FastAPI** | Good fit for Python-based data and model logic |
| Data and modeling | **Python + Pydantic** | Natural ecosystem for market data, features, and backtests |
| Operational database | **PostgreSQL** | Durable storage for batches, audit history, and app entities |
| Research store | **DuckDB / Parquet** | Efficient local analytics and reproducible snapshots |

## Current repository layout

```text
apps/
  web/          Next.js analyst dashboard
services/
  api/          FastAPI recommendation API
data/           Shared sample recommendation data used during scaffolding
```

## Live recommendation flow

- The web app fetches **live Yahoo Finance chart data** for the **Nifty 100 universe** plus the Nifty 50 benchmark.
- Recommendations are scored from recent momentum, relative strength, moving-average trend, volume, volatility, **chart-structure analysis** (breakouts, candlestick patterns, MACD, Bollinger-band behavior, range behavior, moving-average slope, and clearer bullish/bearish trend classification), richer fundamentals (P/E, P/B, ROE, ROCE, debt/equity, earnings growth, and cash-flow fields with sector-aware context), and a tagged news layer that now merges **NSE announcements** with **Google News**.
- The live model now also applies **stop-loss learning**: repeated recent stop-loss failures reduce future model aggressiveness for similar setups.
- Research fetches now track whether fundamentals and news were loaded **live**, reused from **cached snapshots**, or remain **unavailable** for the current batch.
- Fundamentals now prefer **NSE India quote endpoints** for live market-cap and valuation coverage, then enrich or fall back to **Screener.in**, and only then try **Yahoo Finance**. Screener requests retry, fall back from consolidated pages to standard company pages, and now run with cached NSE session reuse, fail-fast request timeouts, and a moderate default research concurrency to keep manual refresh responsive without spiking upstream dropouts. Yahoo fallback remains best-effort because public Yahoo finance endpoints can return 401 in some environments.
- The app also backtests prior daily batches from the same historical price series so the dashboard can maintain horizon-specific success rates.
- On a successful live refresh, the generated dataset is cached to `data/generated-recommendations.json`.
- The dashboard and stock workspace now include a **manual "Refresh all market data"** control that forces a full rebuild of prices, technical signals, fundamentals, sentiment, and the cached generated snapshot on demand.
- The dashboard shortlist and stock workspace now also auto-sync **current market prices** on a short interval for the symbols on screen, while the **suggested/entry price stays fixed** from the saved recommendation batch so you can track move-versus-suggestion cleanly.
- The live dashboard now keeps **tradable recommendations** separate from the **watchlist**, and the batch publisher no longer forces a minimum number of live calls on weak-signal days.
- If a live fundamentals or headline source fails, the loader now reuses the **last successful cached stock-level research snapshot** for that symbol whenever one exists instead of dropping the lens immediately.
- Each successful daily batch is also archived to `data/daily-batches/<batch-date>.json` for persistent run history.
- If persistent disk writes are not available on the host, the app falls back to **in-memory caching** for the running instance.
- If live requests fail later, the app falls back to the cached snapshot before falling back to the older sample data.

## MVP user experience

1. The dashboard shows the latest ranked recommendation batch with tradable ideas separated from watch-only setups.
2. Clicking a stock opens a detailed analysis view.
3. The detail view explains:
    - key factors behind the recommendation
    - recommended entry price
    - target price
    - stop-loss
    - risk-reward profile
    - horizon-specific analysis for single-day, swing, position, and long-term modes
4. The dashboard also reviews **previous daily recommendations**, explains why each call hit target or stop-loss, and maintains a **daily success-rate tracker** for every horizon.
5. The search panel offers **autocomplete suggestions while you type**, then analyzes the selected NSE stock and says whether it should be **considered or avoided** for each supported horizon.
6. Historical stop-loss outcomes now include a clearer explanation of **why the stop-loss was hit**, and the live model uses recent stop-loss history to reduce future aggressiveness for fragile setups.

## Windows quick start

- Double-click `run-app.bat` in the repository root.
- On the first run it installs npm dependencies automatically.
- It starts the dashboard server in a new window, waits for `http://localhost:3000`, and opens your browser automatically.
- The run card in the app shows whether the current batch is coming from **LIVE**, **CACHED**, or **SAMPLE** data.

## Analytics test command

- Run `npm run test:api` from `C:\copilot` to validate the current analytics helpers, payload normalization, and API response shape.

## Deployment and free hosting

### Production-readiness changes in this repo

- The Next.js app now exposes `GET /api/healthz` for simple uptime checks.
- The live dataset loader supports **in-memory runtime caching**, which is friendlier to serverless or ephemeral free hosts.
- `render.yaml` is included so you can deploy both the web app and the FastAPI service on Render with minimal setup.

### Recommended free hosting options

1. **Vercel** for the Next.js app only. This is the easiest choice for the dashboard because it handles Next.js SSR well. In Vercel, set the project root to `apps/web`.
2. **Render** if you want both the Next.js app and the FastAPI API hosted together for free. The included `render.yaml` is aimed at this option. Render free web services can sleep when idle, so expect cold starts.
3. **Cloudflare Pages** if you want a very low-cost global edge deployment for the web app and are comfortable with more setup than Vercel.

For this repository as it exists today, **Vercel** is the simplest free host for the dashboard, while **Render** is the simplest free option if you want to run both services from one repo.
