import json
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException

from .analytics import build_daily_performance, build_stock_history
from .schemas import (
    HorizonId,
    RecommendationDataset,
    RecommendationSummary,
    StockAnalysis,
    StockDetailResponse,
)

DATA_DIRECTORY = Path(__file__).resolve().parents[3] / "data"
GENERATED_DATA_PATH = DATA_DIRECTORY / "generated-recommendations.json"
SAMPLE_DATA_PATH = DATA_DIRECTORY / "sample-recommendations.json"

app = FastAPI(
    title="Recommendation API",
    version="0.1.0",
    description="Explainable API for Indian equities recommendation batches.",
)


def _clamp(value: float, minimum: float, maximum: float) -> float:
    return min(max(value, minimum), maximum)


def _pct_change(current: float, previous: float) -> float:
    if previous == 0:
        return 0.0

    return ((current - previous) / previous) * 100


def _derive_single_day_plan(plan: dict[str, Any]) -> dict[str, Any]:
    entry_price = round(float(plan["entryPrice"]), 2)
    target_pct = _clamp(
        abs(_pct_change(float(plan["targetPrice"]), entry_price)) * 0.38,
        1.2,
        3.4,
    )
    stop_pct = _clamp(
        abs(_pct_change(float(plan["stopLoss"]), entry_price)) * 0.45,
        0.7,
        1.9,
    )
    target_price = round(entry_price * (1 + target_pct / 100), 2)
    stop_loss = round(max(entry_price * (1 - stop_pct / 100), entry_price * 0.85), 2)

    return {
        **plan,
        "score": plan.get("score", 55),
        "conviction": "Medium" if plan.get("conviction") == "High" else plan.get("conviction"),
        "entryPrice": entry_price,
        "targetPrice": target_price,
        "stopLoss": stop_loss,
        "expectedReturnPct": round(_pct_change(target_price, entry_price), 2),
        "riskReward": round((target_price - entry_price) / max(entry_price - stop_loss, 0.01), 2),
        "summary": f"Fallback single-day setup derived from the saved swing profile. {plan['summary']}",
        "drivers": [
            "This single-day view was synthesized from the saved swing setup because the cached dataset predates the single-day model.",
            *plan.get("drivers", []),
        ][:4],
        "analysisDrivers": [
            {
                "area": "risk",
                "impact": "neutral",
                "title": "Compatibility mode",
                "detail": "This single-day view was synthesized from the saved swing setup because the cached dataset predates the current single-day reasoning model.",
            },
            *plan.get("analysisDrivers", []),
        ][:6],
        "technicalSignals": [
            {"name": "Compatibility mode", "value": "Derived from swing profile"},
            *plan.get("technicalSignals", []),
        ][:6],
        "riskSignals": plan.get("riskSignals")
        or [{"name": "Learning status", "value": "Awaiting refreshed live batch"}],
    }


def _derive_single_day_history(plan: dict[str, Any]) -> dict[str, Any]:
    outcome = plan["outcome"]

    return {
        **plan,
        "conviction": "Medium" if plan.get("conviction") == "High" else plan.get("conviction"),
        "summary": f"Fallback single-day history derived from the saved swing result. {plan['summary']}",
        "outcome": {
            **outcome,
            "notes": f"This single-day history row reuses the saved swing outcome because the cached dataset predates the single-day model. {outcome['notes']}",
        },
    }


def _normalize_payload(payload: dict[str, Any]) -> dict[str, Any]:
    profile_lookup = {profile["id"]: profile for profile in payload.get("profiles", [])}
    payload["profiles"] = [
        profile_lookup.get("single_day", {"id": "single_day", "label": "Single-day", "window": "Next trading day"}),
        profile_lookup.get("swing", {"id": "swing", "label": "Swing", "window": "5-20 trading days"}),
        profile_lookup.get("position", {"id": "position", "label": "Position", "window": "20-60 trading days"}),
        profile_lookup.get("long_term", {"id": "long_term", "label": "Long-term", "window": "3-12 months"}),
    ]

    for recommendation in payload.get("currentBatch", {}).get("recommendations", []):
        profiles = recommendation.get("profiles", {})
        if "single_day" not in profiles and "swing" in profiles:
            profiles["single_day"] = _derive_single_day_plan(profiles["swing"])

    for batch in payload.get("history", []):
        for recommendation in batch.get("recommendations", []):
            profiles = recommendation.get("profiles", {})
            if "single_day" not in profiles and "swing" in profiles:
                profiles["single_day"] = _derive_single_day_history(profiles["swing"])

    return payload


def load_dataset(prefer_generated: bool = True) -> RecommendationDataset:
    data_path = GENERATED_DATA_PATH if prefer_generated and GENERATED_DATA_PATH.exists() else SAMPLE_DATA_PATH
    payload = _normalize_payload(json.loads(data_path.read_text(encoding="utf-8")))
    return RecommendationDataset.model_validate(payload)


def build_summary(stock: StockAnalysis, horizon: HorizonId) -> RecommendationSummary:
    plan = stock.profiles[horizon]

    return RecommendationSummary(
        symbol=stock.symbol,
        companyName=stock.companyName,
        sector=stock.sector,
        currentMarketPrice=stock.currentMarketPrice,
        horizon=horizon,
        score=plan.score,
        rank=plan.rank,
        isRecommended=plan.isRecommended,
        conviction=plan.conviction,
        entryPrice=plan.entryPrice,
        targetPrice=plan.targetPrice,
        stopLoss=plan.stopLoss,
        expectedReturnPct=plan.expectedReturnPct,
        riskReward=plan.riskReward,
        summary=plan.summary,
    )


@app.get("/healthz")
def healthcheck() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/v1/recommendations")
def list_recommendations(horizon: HorizonId = "swing") -> dict[str, object]:
    dataset = load_dataset()
    ordered_recommendations = sorted(
        dataset.currentBatch.recommendations,
        key=lambda stock: (
            stock.profiles[horizon].score
            if stock.profiles[horizon].score is not None
            else stock.profiles[horizon].expectedReturnPct
        ),
        reverse=True,
    )
    recommended_rows = [
        build_summary(stock, horizon).model_dump()
        for stock in ordered_recommendations
        if stock.profiles[horizon].isRecommended
    ]
    rows = recommended_rows or [
        build_summary(stock, horizon).model_dump()
        for stock in ordered_recommendations[:5]
    ]
    performance = build_daily_performance(dataset, horizon)

    return {
        "batchDate": dataset.currentBatch.batchDate,
        "generatedAt": dataset.currentBatch.generatedAt,
        "market": dataset.market,
        "exchange": dataset.exchange,
        "universe": dataset.universe,
        "selectedHorizon": horizon,
        "dailyPerformance": [row.model_dump() for row in performance],
        "recommendations": rows,
    }


@app.get("/api/v1/performance/daily")
def get_daily_performance(horizon: HorizonId = "swing") -> dict[str, object]:
    dataset = load_dataset()
    performance = build_daily_performance(dataset, horizon)

    return {
        "selectedHorizon": horizon,
        "performance": [row.model_dump() for row in performance],
    }


@app.get("/api/v1/recommendations/{symbol}")
def get_recommendation(symbol: str, horizon: HorizonId = "swing") -> StockDetailResponse:
    dataset = load_dataset()
    stock = next(
        (
            row
            for row in dataset.currentBatch.recommendations
            if row.symbol == symbol.upper()
        ),
        None,
    )

    if stock is None:
        raise HTTPException(status_code=404, detail=f"Unknown stock symbol: {symbol}")

    return StockDetailResponse(
        generatedAt=dataset.currentBatch.generatedAt,
        batchDate=dataset.currentBatch.batchDate,
        market=dataset.market,
        exchange=dataset.exchange,
        universe=dataset.universe,
        selectedHorizon=horizon,
        stock=stock,
        history=build_stock_history(dataset, symbol, horizon),
    )
