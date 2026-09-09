import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { sendReviewEmail } from "../services/review-email.server";

type BrevoRequestBody = {
  sender: {
    name: string;
    email: string;
  };
  to: Array<{
    email: string;
  }>;
  subject: string;
  htmlContent: string;
  headers: Record<string, string>;
};

describe("review email Brevo transport", () => {
  beforeEach(() => {
    vi.stubEnv(
      "BREVO_API_KEY",
      "test-brevo-api-key",
    );
    vi.stubEnv(
      "REVIEW_EMAIL_FROM_NAME",
      "Lushka Reviews",
    );
    vi.stubEnv(
      "REVIEW_EMAIL_FROM_ADDRESS",
      "lushkacosmetics3@gmail.com",
    );

    delete process.env
      .REVIEW_EMAIL_REPLY_TO;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it(
    "sends review email through Brevo and returns message id",
    async () => {
      const fetchMock = vi.fn(
        async (
          _input: string | URL | Request,
          _init?: RequestInit,
        ): Promise<Response> => {
          void _input;
          void _init;

          return new Response(
            JSON.stringify({
              messageId:
                "<brevo-message-123@example>",
            }),
            {
              status: 201,
              headers: {
                "content-type":
                  "application/json",
              },
            },
          );
        },
      );

      vi.stubGlobal(
        "fetch",
        fetchMock,
      );

      const result =
        await sendReviewEmail({
          to: "customer@example.com",
          emailType:
            "DAY_14_REVIEW_REQUEST",
          customerName: "Samantha",
          orderName: "#1001",
          productLabels: [
            "Multi-Peptide Hair Growth Serum",
          ],
          storefrontUrl:
            "https://lushkacosmetic.myshopify.com",
          unsubscribeUrl:
            "https://example.com/unsubscribe",
          idempotencyKey:
            "review-email:test-signal",
        });

      expect(fetchMock).toHaveBeenCalledTimes(
        1,
      );

      const [url, options] =
        fetchMock.mock.calls[0];

      expect(url).toBe(
        "https://api.brevo.com/v3/smtp/email",
      );

      expect(options?.method).toBe(
        "POST",
      );

      const requestHeaders =
        options?.headers as Record<
          string,
          string
        >;

      expect(
        requestHeaders["api-key"],
      ).toBe(
        "test-brevo-api-key",
      );

      expect(
        requestHeaders[
          "content-type"
        ],
      ).toBe(
        "application/json",
      );

      const body = JSON.parse(
        String(options?.body),
      ) as BrevoRequestBody;

      expect(body.sender).toEqual({
        name: "Lushka Reviews",
        email:
          "lushkacosmetics3@gmail.com",
      });

      expect(body.to).toEqual([
        {
          email:
            "customer@example.com",
        },
      ]);

      expect(body.subject).toBe(
        "How are you finding your Lushka ritual?",
      );

      expect(
        body.htmlContent,
      ).toContain(
        "Share your honest experience",
      );

      expect(
        body.headers.idempotencyKey,
      ).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );

      expect(result).toEqual({
        providerMessageId:
          "<brevo-message-123@example>",
      });
    },
  );

  it(
    "throws a useful error when Brevo rejects the email",
    async () => {
      const fetchMock = vi.fn(
        async (): Promise<Response> =>
          new Response(
            JSON.stringify({
              code: "invalid_parameter",
              message:
                "Invalid sender",
            }),
            {
              status: 400,
              statusText:
                "Bad Request",
              headers: {
                "content-type":
                  "application/json",
              },
            },
          ),
      );

      vi.stubGlobal(
        "fetch",
        fetchMock,
      );

      await expect(
        sendReviewEmail({
          to: "customer@example.com",
          emailType:
            "DAY_14_REVIEW_REQUEST",
          customerName: "Samantha",
          orderName: "#1001",
          productLabels: [
            "Multi-Peptide Hair Growth Serum",
          ],
          storefrontUrl:
            "https://lushkacosmetic.myshopify.com",
          unsubscribeUrl:
            "https://example.com/unsubscribe",
          idempotencyKey:
            "review-email:test-failure",
        }),
      ).rejects.toThrow(
        "Brevo review email failed (400): Invalid sender",
      );
    },
  );
});
