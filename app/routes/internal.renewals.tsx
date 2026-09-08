import type { LoaderFunctionArgs } from "react-router";
import { processDueRenewals } from "../services/renewals.server";
import { processExpiredPaymentHolds } from "../services/payment-holds.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const expectedSecret = process.env.CRON_SECRET;

  if (!expectedSecret) {
    console.error("CRON_SECRET is not configured");
    return Response.json(
      { ok: false, error: "Cron is not configured" },
      { status: 500 },
    );
  }

  const authorization = request.headers.get("authorization");

  if (authorization !== `Bearer ${expectedSecret}`) {
    return Response.json(
      { ok: false, error: "Unauthorized" },
      { status: 401 },
    );
  }

  try {
    const paymentHolds =
      await processExpiredPaymentHolds();

    const result = await processDueRenewals();

    return Response.json({
      ok: true,
      paymentHolds,
      ...result,
    });
  } catch (error) {
    console.error("Renewal worker failed", error);

    return Response.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Unknown renewal worker error",
      },
      { status: 500 },
    );
  }
};
