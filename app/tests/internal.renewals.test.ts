import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  processDueRenewalsMock,
  processExpiredPaymentHoldsMock,
  processDueLifecycleEmailsMock,
} = vi.hoisted(() => ({
  processDueRenewalsMock: vi.fn(),
  processExpiredPaymentHoldsMock: vi.fn(),
  processDueLifecycleEmailsMock: vi.fn(),
}));

vi.mock("../services/renewals.server", () => ({
  processDueRenewals: processDueRenewalsMock,
}));

vi.mock("../services/payment-holds.server", () => ({
  processExpiredPaymentHolds:
    processExpiredPaymentHoldsMock,
}));

vi.mock("../services/lifecycle-email-events.server", () => ({
  processDueLifecycleEmails:
    processDueLifecycleEmailsMock,
}));

import { loader } from "../routes/internal.renewals";

describe("internal renewals cron route", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    process.env.CRON_SECRET = "test-cron-secret";

    processExpiredPaymentHoldsMock.mockResolvedValue({
      checkedAt: "2026-09-08T04:00:00.000Z",
      dueCount: 1,
      results: [
        {
          contractId:
            "gid://shopify/SubscriptionContract/123",
          expired: true,
        },
      ],
    });

    processDueLifecycleEmailsMock.mockResolvedValue({
      checkedAt: "2026-09-08T04:00:00.500Z",
      dueCount: 1,
      results: [
        {
          eventId: "email-event-1",
          emailType: "DAY_30_CHECKIN",
          sent: true,
        },
      ],
    });

    processDueRenewalsMock.mockResolvedValue({
      checkedAt: "2026-09-08T04:00:01.000Z",
      dueCount: 2,
      results: [],
    });
  });

  it("rejects requests without the cron secret", async () => {
    const request = new Request(
      "https://example.com/internal/renewals",
    );

    const response = await loader({
      request,
      params: {},
      context: {},
    } as any);

    expect(response.status).toBe(401);

    expect(
      processExpiredPaymentHoldsMock,
    ).not.toHaveBeenCalled();

    expect(
      processDueLifecycleEmailsMock,
    ).not.toHaveBeenCalled();

    expect(
      processDueRenewalsMock,
    ).not.toHaveBeenCalled();
  });

  it("processes expired payment holds before normal renewals", async () => {
    const request = new Request(
      "https://example.com/internal/renewals",
      {
        headers: {
          authorization:
            "Bearer test-cron-secret",
        },
      },
    );

    const response = await loader({
      request,
      params: {},
      context: {},
    } as any);

    expect(response.status).toBe(200);

    expect(
      processExpiredPaymentHoldsMock,
    ).toHaveBeenCalledTimes(1);

    expect(
      processDueLifecycleEmailsMock,
    ).toHaveBeenCalledTimes(1);

    expect(
      processDueRenewalsMock,
    ).toHaveBeenCalledTimes(1);

    expect(
      processExpiredPaymentHoldsMock.mock.invocationCallOrder[0],
    ).toBeLessThan(
      processDueLifecycleEmailsMock.mock.invocationCallOrder[0],
    );

    expect(
      processDueLifecycleEmailsMock.mock.invocationCallOrder[0],
    ).toBeLessThan(
      processDueRenewalsMock.mock.invocationCallOrder[0],
    );

    const body = await response.json();

    expect(body).toMatchObject({
      ok: true,
      paymentHolds: {
        dueCount: 1,
      },
      lifecycleEmails: {
        dueCount: 1,
      },
      dueCount: 2,
    });
  });
});
