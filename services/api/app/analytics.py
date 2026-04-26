from .schemas import (
    BacktestEvaluation,
    ConfidenceCalibrationBucket,
    DailyPerformance,
    HistoricalBatch,
    HistoricalRecommendationPlan,
    HorizonBacktestSummary,
    HorizonId,
    OutcomeResult,
    RecommendationDataset,
    StockPerformanceHistoryEntry,
)

CLOSED_RESULTS: set[OutcomeResult] = {"target_hit", "stop_loss_hit"}
HORIZON_LABELS: dict[HorizonId, str] = {
    "single_day": "Single-day",
    "swing": "Swing",
    "position": "Position",
    "long_term": "Long-term",
}
HORIZON_THRESHOLDS: dict[HorizonId, float] = {
    "single_day": 54,
    "swing": 56,
    "position": 58,
    "long_term": 60,
}


def _round_metric(value: float | None) -> float | None:
    if value is None:
        return None

    return round(value, 2)


def _is_closed_result(result: OutcomeResult) -> bool:
    return result in CLOSED_RESULTS


def _is_recommended(plan: object) -> bool:
    return getattr(plan, "isRecommended", True)


def _average(values: list[float | int | None]) -> float | None:
    resolved = [float(value) for value in values if value is not None]

    if not resolved:
        return None

    return _round_metric(sum(resolved) / len(resolved))


def _max_drawdown(
    dated_plans: list[tuple[str, HistoricalRecommendationPlan]]
) -> float | None:
    closed_plans = sorted(
        [
            (batch_date, plan)
            for batch_date, plan in dated_plans
            if _is_recommended(plan) and _is_closed_result(plan.outcome.result)
        ],
        key=lambda item: item[0],
    )

    if not closed_plans:
        return None

    equity = 100.0
    peak = 100.0
    worst_drawdown = 0.0

    for _, plan in closed_plans:
        equity *= 1 + plan.outcome.returnPct / 100
        peak = max(peak, equity)
        worst_drawdown = max(worst_drawdown, ((peak - equity) / peak) * 100)

    return _round_metric(worst_drawdown)


def _confidence_bucket_label(plan: HistoricalRecommendationPlan, horizon: HorizonId) -> str:
    threshold = HORIZON_THRESHOLDS[horizon]
    score = plan.score or 0

    if score >= threshold + 8:
        return "High confidence"

    if score >= threshold:
        return "Tradable"

    if score >= threshold - 8:
        return "Needs confirmation"

    return "Low score"


def _build_confidence_calibration(
    plans: list[HistoricalRecommendationPlan], horizon: HorizonId
) -> list[ConfidenceCalibrationBucket]:
    buckets: dict[str, list[HistoricalRecommendationPlan]] = {}

    for plan in [item for item in plans if _is_recommended(item)]:
        label = _confidence_bucket_label(plan, horizon)
        buckets.setdefault(label, []).append(plan)

    rows: list[ConfidenceCalibrationBucket] = []

    for label in ["High confidence", "Tradable", "Needs confirmation", "Low score"]:
        bucket_plans = buckets.get(label, [])
        if not bucket_plans:
            continue

        closed_plans = [
            plan for plan in bucket_plans if _is_closed_result(plan.outcome.result)
        ]
        wins = sum(1 for plan in closed_plans if plan.outcome.result == "target_hit")
        rows.append(
            ConfidenceCalibrationBucket(
                label=label,
                total=len(bucket_plans),
                closed=len(closed_plans),
                averageScore=_average([plan.score for plan in bucket_plans]),
                hitRate=(
                    _round_metric((wins / len(closed_plans)) * 100)
                    if closed_plans
                    else None
                ),
                averageReturnPct=_average([plan.outcome.returnPct for plan in closed_plans]),
            )
        )

    return rows


def build_daily_performance(dataset: RecommendationDataset, horizon: HorizonId) -> list[DailyPerformance]:
    rows: list[DailyPerformance] = []

    for batch in sorted(dataset.history, key=lambda item: item.batchDate, reverse=True):
        plans = [
            recommendation.profiles[horizon]
            for recommendation in batch.recommendations
            if _is_recommended(recommendation.profiles[horizon])
        ]
        successful = sum(1 for plan in plans if plan.outcome.result == "target_hit")
        failed = sum(1 for plan in plans if plan.outcome.result == "stop_loss_hit")
        open_count = sum(1 for plan in plans if plan.outcome.result == "open")
        closed = successful + failed
        closed_returns = [
            plan.outcome.returnPct for plan in plans if _is_closed_result(plan.outcome.result)
        ]

        rows.append(
            DailyPerformance(
                batchDate=batch.batchDate,
                publishedAt=batch.publishedAt,
                total=len(plans),
                closed=closed,
                open=open_count,
                successful=successful,
                failed=failed,
                successRate=_round_metric((successful / closed) * 100) if closed else None,
                averageReturnPct=(
                    _round_metric(sum(closed_returns) / len(closed_returns))
                    if closed_returns
                    else None
                ),
            )
        )

    return rows


def build_stock_history(
    dataset: RecommendationDataset, symbol: str, horizon: HorizonId
) -> list[StockPerformanceHistoryEntry]:
    rows: list[StockPerformanceHistoryEntry] = []
    requested_symbol = symbol.upper()

    for batch in sorted(dataset.history, key=lambda item: item.batchDate, reverse=True):
        for recommendation in batch.recommendations:
            if recommendation.symbol != requested_symbol:
                continue

            plan = recommendation.profiles[horizon]
            if not _is_recommended(plan):
                continue
            rows.append(
                StockPerformanceHistoryEntry(
                    batchDate=batch.batchDate,
                    publishedAt=batch.publishedAt,
                    symbol=recommendation.symbol,
                    companyName=recommendation.companyName,
                    sector=recommendation.sector,
                    horizon=horizon,
                    conviction=plan.conviction,
                    entryPrice=plan.entryPrice,
                    targetPrice=plan.targetPrice,
                    stopLoss=plan.stopLoss,
                    summary=plan.summary,
                    outcome=plan.outcome,
                )
            )

    return rows


def build_backtest_evaluation(dataset: RecommendationDataset) -> BacktestEvaluation:
    horizons: list[HorizonBacktestSummary] = []

    for profile in dataset.profiles:
        dated_plans: list[tuple[str, HistoricalRecommendationPlan]] = [
            (batch.batchDate, recommendation.profiles[profile.id])
            for batch in dataset.history
            for recommendation in batch.recommendations
        ]
        published_plans = [plan for _, plan in dated_plans if _is_recommended(plan)]
        closed_plans = [
            plan for plan in published_plans if _is_closed_result(plan.outcome.result)
        ]
        successful = sum(1 for plan in closed_plans if plan.outcome.result == "target_hit")
        benchmark_returns = [
            plan.outcome.benchmarkReturnPct
            for plan in closed_plans
            if plan.outcome.benchmarkReturnPct is not None
        ]
        average_return = _average([plan.outcome.returnPct for plan in closed_plans])
        benchmark_return = _average(benchmark_returns)

        horizons.append(
            HorizonBacktestSummary(
                horizon=profile.id,
                label=profile.label or HORIZON_LABELS[profile.id],
                total=len(published_plans),
                closed=len(closed_plans),
                open=len(published_plans) - len(closed_plans),
                hitRate=(
                    _round_metric((successful / len(closed_plans)) * 100)
                    if closed_plans
                    else None
                ),
                averageReturnPct=average_return,
                maxDrawdownPct=_max_drawdown(dated_plans),
                averageHoldingDays=_average([plan.outcome.holdingDays for plan in closed_plans]),
                benchmarkReturnPct=benchmark_return,
                benchmarkCoverage=len(benchmark_returns),
                alphaPct=(
                    _round_metric(average_return - benchmark_return)
                    if average_return is not None and benchmark_return is not None
                    else None
                ),
                confidenceCalibration=_build_confidence_calibration(published_plans, profile.id),
            )
        )

    return BacktestEvaluation(
        generatedAt=dataset.currentBatch.generatedAt,
        batchCount=len(dataset.history),
        benchmarkLabel="Nifty 50 where generated history includes benchmark returns",
        horizons=horizons,
    )
