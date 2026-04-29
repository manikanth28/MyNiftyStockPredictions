import { NextResponse } from "next/server";
import {
  buySharedWalletPosition,
  readSharedWallet,
  replaceSharedWallet,
  resetSharedWallet,
  sellSharedWalletPosition
} from "@/lib/server-wallet";
import { isPortfolioWallet } from "@/lib/portfolio-wallet";
import type { BuyPositionInput, WalletTradeExitReason } from "@/lib/portfolio-wallet";

export const dynamic = "force-dynamic";

type WalletActionRequest =
  | ({
      action: "buy";
    } & BuyPositionInput)
  | {
      action: "sell";
      positionId?: string;
      exitPrice?: number;
      exitReason?: WalletTradeExitReason;
      quantity?: number;
      closedAt?: string;
      exitNote?: string;
      archiveEvaluatedOn?: string | null;
      archiveHoldingDays?: number | null;
    }
  | {
      action: "reset";
      startingCash?: number;
    }
  | {
      action: "replace";
      wallet?: unknown;
    };

function errorResponse(message: string, status = 400) {
  return NextResponse.json(
    {
      error: message
    },
    {
      status,
      headers: {
        "Cache-Control": "no-store"
      }
    }
  );
}

export async function GET() {
  return NextResponse.json(
    {
      wallet: await readSharedWallet()
    },
    {
      headers: {
        "Cache-Control": "no-store"
      }
    }
  );
}

export async function POST(request: Request) {
  let body: WalletActionRequest;

  try {
    body = (await request.json()) as WalletActionRequest;
  } catch {
    return errorResponse("Wallet request body must be valid JSON.");
  }

  try {
    switch (body.action) {
      case "buy":
        return NextResponse.json({
          wallet: await buySharedWalletPosition({
            stock: body.stock,
            plan: body.plan,
            horizon: body.horizon,
            quantity: body.quantity,
            sourceBatchDate: body.sourceBatchDate,
            sourceGeneratedAt: body.sourceGeneratedAt,
            autoSellAtTarget: body.autoSellAtTarget,
            autoSellAtStopLoss: body.autoSellAtStopLoss,
            notes: body.notes
          })
        });
      case "sell":
        if (!body.positionId) {
          return errorResponse("positionId is required for sell actions.");
        }

        if (!body.exitReason) {
          return errorResponse("exitReason is required for sell actions.");
        }

        return NextResponse.json({
          wallet: await sellSharedWalletPosition(body.positionId, Number(body.exitPrice), body.exitReason, {
            quantity: body.quantity,
            closedAt: body.closedAt,
            exitNote: body.exitNote,
            archiveEvaluatedOn: body.archiveEvaluatedOn,
            archiveHoldingDays: body.archiveHoldingDays
          })
        });
      case "reset":
        return NextResponse.json({
          wallet: await resetSharedWallet(body.startingCash)
        });
      case "replace":
        if (!isPortfolioWallet(body.wallet)) {
          return errorResponse("wallet must be a valid portfolio wallet.");
        }

        return NextResponse.json({
          wallet: await replaceSharedWallet(body.wallet)
        });
      default:
        return errorResponse("Unsupported wallet action.");
    }
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : "Wallet action failed.", 500);
  }
}
