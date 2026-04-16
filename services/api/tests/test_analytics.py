import unittest
from unittest.mock import patch

from fastapi import HTTPException

from app import main as api_main
from app.analytics import build_daily_performance, build_stock_history
from app.main import load_dataset
from app.schemas import FundamentalSnapshot, ResearchSourceStatus, StockResearchStatus


class RecommendationAnalyticsTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.dataset = load_dataset(prefer_generated=False)

    def test_swing_daily_performance_counts_successes_and_failures(self) -> None:
        performance = build_daily_performance(self.dataset, "swing")
        latest = next(row for row in performance if row.batchDate == "2026-04-14")

        self.assertEqual(latest.successful, 2)
        self.assertEqual(latest.failed, 1)
        self.assertEqual(latest.closed, 3)
        self.assertEqual(latest.open, 0)
        self.assertAlmostEqual(latest.successRate or 0, 66.67, places=2)

    def test_position_success_rate_ignores_open_trades(self) -> None:
        performance = build_daily_performance(self.dataset, "position")
        latest = next(row for row in performance if row.batchDate == "2026-04-14")

        self.assertEqual(latest.successful, 1)
        self.assertEqual(latest.failed, 1)
        self.assertEqual(latest.open, 1)
        self.assertEqual(latest.closed, 2)
        self.assertAlmostEqual(latest.successRate or 0, 50.0, places=2)

    def test_long_term_daily_performance_is_pending_when_nothing_is_closed(self) -> None:
        performance = build_daily_performance(self.dataset, "long_term")
        latest = next(row for row in performance if row.batchDate == "2026-04-14")

        self.assertEqual(latest.open, 3)
        self.assertEqual(latest.closed, 0)
        self.assertIsNone(latest.successRate)
        self.assertIsNone(latest.averageReturnPct)

    def test_stock_history_filters_by_symbol_in_latest_first_order(self) -> None:
        history = build_stock_history(self.dataset, "RELIANCE", "swing")

        self.assertEqual(
            [entry.batchDate for entry in history],
            ["2026-04-14", "2026-04-11", "2026-04-10"],
        )
        self.assertTrue(all(entry.symbol == "RELIANCE" for entry in history))

    def test_dataset_normalization_adds_single_day_profile(self) -> None:
        self.assertIn("single_day", self.dataset.currentBatch.recommendations[0].profiles)
        self.assertEqual(self.dataset.profiles[0].id, "single_day")

    def test_dataset_normalization_adds_single_day_history_profile(self) -> None:
        profile = self.dataset.history[0].recommendations[0].profiles["single_day"]

        self.assertTrue(
            profile.summary.startswith("Fallback single-day history derived from the saved swing result.")
        )


class RecommendationApiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.dataset = load_dataset(prefer_generated=False)

    def _dataset_with_research_status(self, include_fundamentals: bool):
        dataset = self.dataset.model_copy(deep=True)
        stock = dataset.currentBatch.recommendations[0]
        observed_at = "2026-04-16T05:40:38.681Z"

        stock.researchStatus = StockResearchStatus(
            fundamentals=ResearchSourceStatus(
                provider="Screener.in" if include_fundamentals else "Screener.in + Yahoo Finance",
                state="live" if include_fundamentals else "unavailable",
                detail=(
                    "Live fundamentals loaded from Screener.in."
                    if include_fundamentals
                    else "Live fundamental providers were unavailable in this batch and no cached snapshot existed for fallback."
                ),
                observedAt=observed_at,
                itemCount=1 if include_fundamentals else 0,
            ),
            sentiment=ResearchSourceStatus(
                provider="NSE Announcements + Google News",
                state="unavailable",
                detail="Live headline sources were unavailable in this batch and no cached tagged headlines existed for fallback.",
                observedAt=observed_at,
                itemCount=0,
            ),
        )
        stock.fundamentals = (
            FundamentalSnapshot(
                source="Screener.in",
                summary="Synthetic live fundamentals for API regression coverage.",
                marketCapCrore=123456,
                marketCapChange1YPct=18.4,
                revenueCrore=48200,
                profitCrore=6120,
                netMarginPct=12.7,
                priceToEarnings=22.4,
                priceToBook=3.8,
                salesGrowth5YPct=9.2,
                salesGrowthLabel="strong",
                earningsGrowthPct=11.3,
                returnOnEquityPct=18.5,
                returnOnEquityLabel="good",
                returnOnCapitalEmployedPct=21.1,
                debtToEquity=0.32,
                operatingCashFlowCrore=8010,
                freeCashFlowCrore=3440,
                promoterHoldingPct=52.6,
            )
            if include_fundamentals
            else None
        )

        return dataset, stock.symbol

    def test_healthcheck_returns_ok_status(self) -> None:
        self.assertEqual(api_main.healthcheck(), {"status": "ok"})

    def test_recommendations_endpoint_returns_normalized_single_day_rows(self) -> None:
        with patch.object(api_main, "load_dataset", return_value=self.dataset):
            payload = api_main.list_recommendations("single_day")

        self.assertEqual(payload["selectedHorizon"], "single_day")
        self.assertGreater(len(payload["recommendations"]), 0)
        first = payload["recommendations"][0]
        self.assertEqual(first["horizon"], "single_day")
        self.assertIn("symbol", first)
        self.assertIn("sector", first)
        self.assertIn("summary", first)
        self.assertIn("riskReward", first)

    def test_daily_performance_endpoint_uses_requested_horizon(self) -> None:
        with patch.object(api_main, "load_dataset", return_value=self.dataset):
            payload = api_main.get_daily_performance("position")

        self.assertEqual(payload["selectedHorizon"], "position")
        latest = next(row for row in payload["performance"] if row["batchDate"] == "2026-04-14")
        self.assertEqual(latest["successful"], 1)
        self.assertEqual(latest["failed"], 1)
        self.assertEqual(latest["open"], 1)
        self.assertAlmostEqual(latest["successRate"] or 0, 50.0, places=2)

    def test_stock_detail_endpoint_returns_history_and_profiles(self) -> None:
        with patch.object(api_main, "load_dataset", return_value=self.dataset):
            response = api_main.get_recommendation("RELIANCE", "single_day")

        self.assertEqual(response.selectedHorizon, "single_day")
        self.assertEqual(response.stock.symbol, "RELIANCE")
        self.assertEqual(response.stock.sector, "Energy")
        self.assertIn("single_day", response.stock.profiles)
        self.assertGreater(len(response.history), 0)
        self.assertTrue(all(entry.horizon == "single_day" for entry in response.history))

    def test_stock_detail_endpoint_exposes_live_fundamentals_status(self) -> None:
        dataset, symbol = self._dataset_with_research_status(include_fundamentals=True)

        with patch.object(api_main, "load_dataset", return_value=dataset):
            response = api_main.get_recommendation(symbol, "swing")

        self.assertIsNotNone(response.stock.fundamentals)
        self.assertIsNotNone(response.stock.researchStatus)
        self.assertEqual(response.stock.fundamentals.source, "Screener.in")
        self.assertEqual(response.stock.researchStatus.fundamentals.state, "live")
        self.assertEqual(response.stock.researchStatus.fundamentals.provider, "Screener.in")

    def test_stock_detail_endpoint_exposes_unavailable_fundamentals_status(self) -> None:
        dataset, symbol = self._dataset_with_research_status(include_fundamentals=False)

        with patch.object(api_main, "load_dataset", return_value=dataset):
            response = api_main.get_recommendation(symbol, "swing")

        self.assertIsNone(response.stock.fundamentals)
        self.assertIsNotNone(response.stock.researchStatus)
        self.assertEqual(response.stock.researchStatus.fundamentals.state, "unavailable")
        self.assertEqual(
            response.stock.researchStatus.fundamentals.provider,
            "Screener.in + Yahoo Finance",
        )
        self.assertIn(
            "no cached snapshot existed for fallback",
            response.stock.researchStatus.fundamentals.detail.lower(),
        )

    def test_stock_detail_endpoint_raises_404_for_unknown_symbol(self) -> None:
        with patch.object(api_main, "load_dataset", return_value=self.dataset):
            with self.assertRaises(HTTPException) as context:
                api_main.get_recommendation("UNKNOWN", "swing")

        self.assertEqual(context.exception.status_code, 404)


if __name__ == "__main__":
    unittest.main()
