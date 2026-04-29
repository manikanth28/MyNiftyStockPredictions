import { mkdir, readFile, readdir, writeFile } from "fs/promises";
import path from "path";
import { calculateWalletMetrics } from "@/lib/portfolio-wallet";
import type { PortfolioWallet, WalletOpenPosition, WalletTradeExitReason } from "@/lib/portfolio-wallet";
import { fetchLatestPriceOverlay, loadRecommendationSnapshot } from "@/lib/recommendation-data";
import { buySharedWalletPosition, getSharedDataDirectory, readSharedWallet, sellSharedWalletPosition } from "@/lib/server-wallet";
import type { HorizonId, RecommendationDataset, RecommendationPlan, StockAnalysis } from "@/lib/types";

type BotActionType = "buy" | "sell" | "skip" | "hold" | "report";

export type PortfolioBotAction = {
  type: BotActionType;
  symbol: string | null;
  reason: string;
  quantity?: number;
  price?: number;
  amount?: number;
  horizon?: HorizonId;
  createdAt: string;
};

export type TradingReportPosition = {
  symbol: string;
  companyName: string;
  quantity: number;
  averageCost: number;
  ltp: number;
  invested: number;
  currentValue: number;
  pnl: number;
  netChangePct: number;
  dayChangePct: number | null;
};

export type TradingReport = {
  reportDate: string;
  generatedAt: string;
  batchDate: string;
  cashBalance: number;
  totalInvestment: number;
  currentValue: number;
  dayPnl: number | null;
  totalPnl: number;
  actions: PortfolioBotAction[];
  positions: TradingReportPosition[];
};

export type TradingReportIndexEntry = {
  reportDate: string;
  generatedAt: string;
  markdownFile: string;
  jsonFile: string;
  buys: number;
  sells: number;
  openPositions: number;
  totalPnl: number;
};

export type PortfolioBotRunResult = {
  ranAt: string;
  marketSession: boolean;
  reportWritten: boolean;
  report: TradingReport | null;
  actions: PortfolioBotAction[];
  wallet: PortfolioWallet;
};

type Candidate = {
  stock: StockAnalysis;
  plan: RecommendationPlan;
  horizon: HorizonId;
  rankScore: number;
};

const REPORT_DIRECTORY_NAME = "trading-reports";
const ENTRY_DRIFT_LIMIT_PCT = 1.5;
const EXECUTION_SLIPPAGE_PCT = 0.08;
const MODEL_SCORE_DROP_EXIT = 12;
const MIN_MODEL_RISK_REWARD = 1.1;
const BOT_MIN_SCORE: Record<HorizonId, number> = {
  single_day: 68,
  swing: 66,
  position: 64,
  long_term: 62
};
const BOT_MIN_RISK_REWARD: Record<HorizonId, number> = {
  single_day: 1.7,
  swing: 2.0,
  position: 1.9,
  long_term: 1.8
};
const MARKET_TIME_ZONE = "Asia/Kolkata";
const MARKET_OPEN_HOUR = 9;
const MARKET_OPEN_MINUTE = 15;
const MARKET_CLOSE_HOUR = 15;
const MARKET_CLOSE_MINUTE = 30;
const HORIZON_PRIORITY: Record<HorizonId, number> = {
  swing: 4,
  position: 3,
  single_day: 2,
  long_term: 1
};

function nowIso() {
  return new Date().toISOString();
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function pctChange(current: number, previous: number) {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous <= 0) {
    return null;
  }

  return ((current - previous) / previous) * 100;
}

function normalizeSymbol(value: string) {
  return value.trim().toUpperCase().replace(/\.NS$/i, "");
}

function marketClockParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: MARKET_TIME_ZONE,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";

  return {
    weekday: read("weekday"),
    year: read("year"),
    month: read("month"),
    day: read("day"),
    hour: Number.parseInt(read("hour"), 10) || 0,
    minute: Number.parseInt(read("minute"), 10) || 0
  };
}

function marketDateString(date = new Date()) {
  const parts = marketClockParts(date);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function marketMinuteOfDay(parts = marketClockParts()) {
  return parts.hour * 60 + parts.minute;
}

function isMarketTradingDay(date = new Date()) {
  const weekday = marketClockParts(date).weekday.toLowerCase();
  return !weekday.startsWith("sat") && !weekday.startsWith("sun");
}

function isMarketSession(date = new Date()) {
  if (!isMarketTradingDay(date)) {
    return false;
  }

  const minute = marketMinuteOfDay(marketClockParts(date));
  const open = MARKET_OPEN_HOUR * 60 + MARKET_OPEN_MINUTE;
  const close = MARKET_CLOSE_HOUR * 60 + MARKET_CLOSE_MINUTE;
  return minute >= open && minute <= close;
}

function action(type: BotActionType, reason: string, fields: Partial<PortfolioBotAction> = {}): PortfolioBotAction {
  return {
    type,
    symbol: fields.symbol ?? null,
    reason,
    quantity: fields.quantity,
    price: fields.price,
    amount: fields.amount,
    horizon: fields.horizon,
    createdAt: fields.createdAt ?? nowIso()
  };
}

function stockBySymbol(dataset: RecommendationDataset) {
  return new Map(dataset.currentBatch.recommendations.map((stock) => [normalizeSymbol(stock.symbol), stock]));
}

function modelDriftExitReason(position: WalletOpenPosition, dataset: RecommendationDataset) {
  const stock = stockBySymbol(dataset).get(normalizeSymbol(position.symbol));
  const plan = stock?.profiles[position.horizon];

  if (!stock || !plan) {
    return "Latest recommendation batch no longer contains this held stock/horizon.";
  }

  if (plan.isRecommended === false) {
    return "Latest recommendation no longer qualifies as a buy for this horizon.";
  }

  if (position.sourceScore !== null && typeof plan.score === "number" && plan.score <= position.sourceScore - MODEL_SCORE_DROP_EXIT) {
    return `Model score dropped from ${position.sourceScore.toFixed(1)} to ${plan.score.toFixed(1)}.`;
  }

  if (plan.riskReward < MIN_MODEL_RISK_REWARD) {
    return `Risk/reward weakened to ${plan.riskReward.toFixed(2)}.`;
  }

  return null;
}

function recommendedCandidates(dataset: RecommendationDataset) {
  const bestBySymbol = new Map<string, Candidate>();

  for (const stock of dataset.currentBatch.recommendations) {
    for (const profile of dataset.profiles) {
      const plan = stock.profiles[profile.id];

      if (!plan?.isRecommended) {
        continue;
      }

      const minScore = BOT_MIN_SCORE[profile.id];
      const minRiskReward = BOT_MIN_RISK_REWARD[profile.id];
      const planScore = plan.score ?? plan.expectedReturnPct;
      const convictionOk = plan.conviction === "High" || (plan.conviction === "Medium" && profile.id !== "single_day");

      if (!convictionOk || planScore < minScore || plan.riskReward < minRiskReward) {
        continue;
      }

      const score = planScore;
      const rankScore = score + plan.riskReward * 6 + HORIZON_PRIORITY[profile.id] * 2;
      const existing = bestBySymbol.get(normalizeSymbol(stock.symbol));

      if (!existing || rankScore > existing.rankScore) {
        bestBySymbol.set(normalizeSymbol(stock.symbol), {
          stock,
          plan,
          horizon: profile.id,
          rankScore
        });
      }
    }
  }

  return [...bestBySymbol.values()].sort((left, right) => right.rankScore - left.rankScore);
}

function adjustedExecutionPrice(price: number, side: "buy" | "sell") {
  if (!Number.isFinite(price) || price <= 0) {
    return price;
  }

  const multiplier = side === "buy" ? 1 + EXECUTION_SLIPPAGE_PCT / 100 : 1 - EXECUTION_SLIPPAGE_PCT / 100;
  return roundMoney(price * multiplier);
}

function executionAlignedPlan(plan: RecommendationPlan, filledEntry: number): RecommendationPlan {
  const targetPct = Math.max(0, (plan.targetPrice - plan.entryPrice) / Math.max(plan.entryPrice, 0.01));
  const stopPct = Math.max(0, (plan.entryPrice - plan.stopLoss) / Math.max(plan.entryPrice, 0.01));

  return {
    ...plan,
    entryPrice: filledEntry,
    targetPrice: roundMoney(filledEntry * (1 + targetPct)),
    stopLoss: roundMoney(filledEntry * (1 - stopPct))
  };
}

async function runSellDecisions(
  wallet: PortfolioWallet,
  dataset: RecommendationDataset,
  prices: Record<string, { currentMarketPrice: number }>,
  actions: PortfolioBotAction[]
) {
  let nextWallet = wallet;

  for (const position of wallet.openPositions) {
    const ltp = prices[position.symbol]?.currentMarketPrice ?? position.entryPrice;
    const executableSellPrice = adjustedExecutionPrice(ltp, "sell");
    let exitReason: WalletTradeExitReason | null = null;
    let exitNote = "";

    if (position.autoSellAtTarget && ltp >= position.targetPrice) {
      exitReason = "target_hit";
      exitNote = `Background bot sold because LTP ${ltp} reached target ${position.targetPrice}.`;
    } else if (position.autoSellAtStopLoss && ltp <= position.stopLoss) {
      exitReason = "stop_loss_hit";
      exitNote = `Background bot sold because LTP ${ltp} hit stop-loss ${position.stopLoss}.`;
    } else {
      const driftReason = modelDriftExitReason(position, dataset);

      if (driftReason) {
        exitReason = "manual";
        exitNote = `Background bot model-drift exit: ${driftReason}`;
      }
    }

    if (!exitReason) {
      actions.push(action("hold", "No exit rule triggered.", { symbol: position.symbol, price: ltp, horizon: position.horizon }));
      continue;
    }

    nextWallet = await sellSharedWalletPosition(position.id, executableSellPrice, exitReason, {
      exitNote
    });
    actions.push(action("sell", exitNote, {
      symbol: position.symbol,
      quantity: position.quantity,
      price: executableSellPrice,
      amount: roundMoney(position.quantity * executableSellPrice),
      horizon: position.horizon
    }));
  }

  return nextWallet;
}

async function runBuyDecisions(
  wallet: PortfolioWallet,
  dataset: RecommendationDataset,
  prices: Record<string, { currentMarketPrice: number }>,
  actions: PortfolioBotAction[]
) {
  let nextWallet = wallet;
  const openSymbols = new Set(wallet.openPositions.map((position) => normalizeSymbol(position.symbol)));
  const candidates = recommendedCandidates(dataset);
  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    const symbol = normalizeSymbol(candidate.stock.symbol);

    if (openSymbols.has(symbol)) {
      actions.push(action("skip", "Skipped duplicate exposure; symbol is already held.", { symbol }));
      continue;
    }

    const ltp = prices[symbol]?.currentMarketPrice ?? candidate.stock.currentMarketPrice;
    const executableBuyPrice = adjustedExecutionPrice(ltp, "buy");

    if (!Number.isFinite(ltp) || ltp <= 0) {
      actions.push(action("skip", "Skipped because live price was unavailable.", { symbol }));
      continue;
    }

    if (executableBuyPrice > candidate.plan.entryPrice * (1 + ENTRY_DRIFT_LIMIT_PCT / 100)) {
      actions.push(action("skip", "Skipped because price moved too far above recommended entry.", {
        symbol,
        price: executableBuyPrice,
        horizon: candidate.horizon
      }));
      continue;
    }

    if (executableBuyPrice >= candidate.plan.targetPrice || executableBuyPrice <= candidate.plan.stopLoss) {
      actions.push(action("skip", "Skipped because live price is already outside the planned trade band.", {
        symbol,
        price: executableBuyPrice,
        horizon: candidate.horizon
      }));
      continue;
    }

    const remainingCandidates = Math.max(1, candidates.length - index);
    const buyBudget = Math.max(0, nextWallet.cashBalance / remainingCandidates);
    const quantity = Math.floor(buyBudget / executableBuyPrice);

    if (quantity <= 0) {
      actions.push(action("skip", "Skipped because allocation rules left no affordable quantity.", {
        symbol,
        price: executableBuyPrice,
        horizon: candidate.horizon
      }));
      continue;
    }

    const fillPlan = executionAlignedPlan(candidate.plan, executableBuyPrice);

    nextWallet = await buySharedWalletPosition({
      stock: candidate.stock,
      plan: fillPlan,
      horizon: candidate.horizon,
      quantity,
      sourceBatchDate: dataset.currentBatch.batchDate,
      sourceGeneratedAt: dataset.currentBatch.generatedAt,
      autoSellAtTarget: true,
      autoSellAtStopLoss: true,
      notes: "Background bot buy. Uncapped mode: buying all eligible recommendations within available cash."
    });
    openSymbols.add(symbol);
    actions.push(action("buy", "Bought recommended setup in uncapped buying mode.", {
      symbol,
      quantity,
      price: executableBuyPrice,
      amount: roundMoney(quantity * executableBuyPrice),
      horizon: candidate.horizon
    }));
  }

  return nextWallet;
}

async function reportsDirectoryPath() {
  const directory = path.join(await getSharedDataDirectory(), REPORT_DIRECTORY_NAME);

  await mkdir(directory, { recursive: true });
  return directory;
}

function reportPositions(wallet: PortfolioWallet, prices: Record<string, { currentMarketPrice: number; latestSessionChangePct: number | null; dayStartPrice: number | null }>) {
  return wallet.openPositions.map((position) => {
    const price = prices[position.symbol];
    const ltp = price?.currentMarketPrice ?? position.entryPrice;
    const invested = roundMoney(position.quantity * position.entryPrice);
    const currentValue = roundMoney(position.quantity * ltp);
    const pnl = roundMoney(currentValue - invested);

    return {
      symbol: position.symbol,
      companyName: position.companyName,
      quantity: position.quantity,
      averageCost: position.entryPrice,
      ltp,
      invested,
      currentValue,
      pnl,
      netChangePct: roundMoney(pctChange(currentValue, invested) ?? 0),
      dayChangePct: price?.latestSessionChangePct ?? null
    } satisfies TradingReportPosition;
  });
}

function reportMarkdown(report: TradingReport) {
  const lines = [
    `# Trading Report - ${report.reportDate}`,
    "",
    `Generated: ${report.generatedAt}`,
    `Recommendation batch: ${report.batchDate}`,
    "",
    "## Summary",
    "",
    `- Cash balance: ${report.cashBalance}`,
    `- Total investment: ${report.totalInvestment}`,
    `- Current value: ${report.currentValue}`,
    `- Day P&L: ${report.dayPnl ?? "n/a"}`,
    `- Total P&L: ${report.totalPnl}`,
    "",
    "## Actions",
    "",
    ...(
      report.actions.length
        ? report.actions.map((item) => `- ${item.type.toUpperCase()} ${item.symbol ?? ""}: ${item.reason}`)
        : ["- No bot actions were taken."]
    ),
    "",
    "## Open Positions",
    "",
    "| Instrument | Qty. | Avg. cost | LTP | Invested | Cur. val | P&L | Net chg. | Day chg. |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...(
      report.positions.length
        ? report.positions.map(
            (position) =>
              `| ${position.symbol} | ${position.quantity} | ${position.averageCost} | ${position.ltp} | ${position.invested} | ${position.currentValue} | ${position.pnl} | ${position.netChangePct}% | ${position.dayChangePct ?? "n/a"} |`
          )
        : ["| No open positions | 0 | 0 | 0 | 0 | 0 | 0 | 0 | n/a |"]
    ),
    ""
  ];

  return lines.join("\n");
}

export async function writeTradingReport(
  wallet: PortfolioWallet,
  dataset: RecommendationDataset,
  actions: PortfolioBotAction[]
) {
  const reportDate = marketDateString();
  const symbols = wallet.openPositions.map((position) => position.symbol);
  const prices = await fetchLatestPriceOverlay(symbols);
  const currentPrices = Object.fromEntries(
    wallet.openPositions.map((position) => [
      position.symbol,
      prices[position.symbol]?.currentMarketPrice ?? position.entryPrice
    ])
  );
  const metrics = calculateWalletMetrics(wallet, currentPrices);
  const positions = reportPositions(wallet, prices);
  const rowsWithDayPnl = wallet.openPositions
    .map((position) => {
      const price = prices[position.symbol];
      return price?.dayStartPrice
        ? position.quantity * ((price.currentMarketPrice ?? position.entryPrice) - price.dayStartPrice)
        : null;
    })
    .filter((value): value is number => value !== null);
  const report: TradingReport = {
    reportDate,
    generatedAt: nowIso(),
    batchDate: dataset.currentBatch.batchDate,
    cashBalance: metrics.availableCash,
    totalInvestment: metrics.investedValue,
    currentValue: metrics.currentValue,
    dayPnl: rowsWithDayPnl.length ? roundMoney(rowsWithDayPnl.reduce((sum, value) => sum + value, 0)) : null,
    totalPnl: metrics.totalPnl,
    actions: [...actions, action("report", "Daily trading report was written.")],
    positions
  };
  const directory = await reportsDirectoryPath();
  const jsonPath = path.join(directory, `${reportDate}.json`);
  const markdownPath = path.join(directory, `${reportDate}.md`);

  await writeFile(jsonPath, JSON.stringify(report, null, 2), "utf-8");
  await writeFile(markdownPath, reportMarkdown(report), "utf-8");

  return report;
}

export async function listTradingReports(limit = 10): Promise<TradingReportIndexEntry[]> {
  const directory = await reportsDirectoryPath();
  const files = await readdir(directory).catch(() => []);
  const jsonFiles = files.filter((file) => file.endsWith(".json")).sort().reverse().slice(0, limit);
  const reports = await Promise.all(
    jsonFiles.map(async (file) => {
      const payload = JSON.parse(await readFile(path.join(directory, file), "utf-8")) as TradingReport;

      return {
        reportDate: payload.reportDate,
        generatedAt: payload.generatedAt,
        markdownFile: `${payload.reportDate}.md`,
        jsonFile: file,
        buys: payload.actions.filter((item) => item.type === "buy").length,
        sells: payload.actions.filter((item) => item.type === "sell").length,
        openPositions: payload.positions.length,
        totalPnl: payload.totalPnl
      } satisfies TradingReportIndexEntry;
    })
  );

  return reports;
}

export async function runPortfolioBotTick(options: { writeReport?: boolean } = {}): Promise<PortfolioBotRunResult> {
  const ranAt = nowIso();
  const dataset = await loadRecommendationSnapshot();
  let wallet = await readSharedWallet();
  const actions: PortfolioBotAction[] = [];
  const symbols = [
    ...wallet.openPositions.map((position) => position.symbol),
    ...recommendedCandidates(dataset).slice(0, 18).map((candidate) => candidate.stock.symbol)
  ];
  const prices = await fetchLatestPriceOverlay(symbols);

  wallet = await runSellDecisions(wallet, dataset, prices, actions);

  if (isMarketSession()) {
    wallet = await runBuyDecisions(wallet, dataset, prices, actions);
  } else {
    actions.push(action("skip", "Buy checks skipped because NSE market session is closed."));
  }

  const report = options.writeReport ? await writeTradingReport(wallet, dataset, actions) : null;

  return {
    ranAt,
    marketSession: isMarketSession(),
    reportWritten: report !== null,
    report,
    actions,
    wallet
  };
}
