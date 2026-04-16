from .schemas import (
    DailyPerformance,
    HistoricalBatch,
    HorizonId,
    OutcomeResult,
    RecommendationDataset,
    StockPerformanceHistoryEntry,
)

CLOSED_RESULTS: set[OutcomeResult] = {"target_hit", "stop_loss_hit"}


def _round_metric(value: float | None) -> float | None:
    if value is None:
        return None

    return round(value, 2)


def _is_closed_result(result: OutcomeResult) -> bool:
    return result in CLOSED_RESULTS


def _is_recommended(plan: object) -> bool:
    return getattr(plan, "isRecommended", True)


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
