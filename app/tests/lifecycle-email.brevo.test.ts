import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { sendLushkaEmail } from "../services/email.server";

describe("lifecycle email Brevo transport", () => {
  beforeEach(() => {
    process.env.BREVO_API_KEY =
      "test-brevo-api-key";
    process.env.EMAIL_FROM =
      "hello@lushka.example";
    process.env.EMAIL_FROM_NAME =
      "LUSHKA";
    process.env.EMAIL_REPLY_TO =
      "support@lushka.example";
  });

  afterEach(() => {
    vi.unstubAllGlobals();

    delete process.env.BREVO_API_KEY;
    delete process.env.EMAIL_FROM;
    delete process.env.EMAIL_FROM_NAME;
    delete process.env.EMAIL_REPLY_TO;
  });

  it(
    "sends Day-75 continuation email through Brevo",
    async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            messageId:
              "<brevo-lifecycle-123@example>",
          }),
          {
            status: 201,
            headers: {
              "content-type":
                "application/json",
            },
          },
        ),
      );

      vi.stubGlobal("fetch", fetchMock);

      const result =
        await sendLushkaEmail({
          to: "customer@example.com",
          emailType:
            "DAY_75_CONTINUATION",
          customerName: "Samantha",
          planType:
            "COMPLETE_RECOVERY_90",
          idempotencyKey:
            "lushka:contract-123:DAY_75_CONTINUATION",
        });

      expect(result).toEqual({
        providerMessageId:
          "<brevo-lifecycle-123@example>",
      });

      expect(fetchMock).toHaveBeenCalledTimes(
        1,
      );

      const [url, options] =
        fetchMock.mock.calls[0];

      expect(url).toBe(
        "https://api.brevo.com/v3/smtp/email",
      );

      expect(options.method).toBe("POST");

      expect(options.headers).toMatchObject({
        "api-key": "test-brevo-api-key",
        "content-type":
          "application/json",
      });

      const body = JSON.parse(
        String(options.body),
      );

      expect(body.sender).toEqual({
        name: "LUSHKA",
        email: "hello@lushka.example",
      });

      expect(body.to).toEqual([
        {
          email:
            "customer@example.com",
        },
      ]);

      expect(body.replyTo).toEqual({
        email:
          "support@lushka.example",
      });

      expect(body.subject).toBe(
        "What Comes Next After Your LUSHKA 90-Day Ritual?",
      );

      expect(body.htmlContent).toContain(
        "Hi Samantha",
      );

      expect(
        body.headers.idempotencyKey,
      ).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/,
      );
    },
  );

  it.each([
    {
      emailType: "ROOT_WELCOME" as const,
      subject: "Welcome to Your LUSHKA Root Revival Trio",
      htmlText: "Your programme is fixed to three scheduled payments only.",
    },
    {
      emailType: "ROOT_SECOND_DELIVERY" as const,
      subject: "Your Next LUSHKA Root Revival Delivery",
      htmlText: "Payment and delivery 2 of 3.",
    },
    {
      emailType: "ROOT_FINAL_DELIVERY" as const,
      subject: "Your Final LUSHKA Root Revival Delivery",
      htmlText: "third and final delivery of your Root Revival Trio programme.",
    },
    {
      emailType: "ROOT_CONTINUATION" as const,
      subject: "What Comes Next After Your LUSHKA Root Revival Programme?",
      htmlText: "No response? Nothing changes.",
    },
  ])(
    "sends $emailType through Brevo",
    async ({
      emailType,
      subject,
      htmlText,
    }) => {
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            messageId:
              "<brevo-root@example>",
          }),
          {
            status: 201,
            headers: {
              "content-type":
                "application/json",
            },
          },
        ),
      );

      vi.stubGlobal("fetch", fetchMock);

      await sendLushkaEmail({
        to: "customer@example.com",
        emailType,
        customerName: "Samantha",
        planType: "ROOT_REVIVAL_TRIO",
        idempotencyKey:
          `lushka:root-123:${emailType}`,
      });

      const [, options] =
        fetchMock.mock.calls[0];

      const body = JSON.parse(
        String(options.body),
      );

      expect(body.subject).toBe(subject);
      expect(body.htmlContent).toContain(
        "Hi Samantha",
      );
      expect(body.htmlContent).toContain(
        htmlText,
      );
      expect(body.htmlContent).not.toContain(
        "90-day",
      );
    },
  );

  it(
    "throws a useful error when Brevo rejects lifecycle email",
    async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          new Response(
            JSON.stringify({
              message:
                "Invalid sender",
            }),
            {
              status: 400,
              headers: {
                "content-type":
                  "application/json",
              },
            },
          ),
        ),
      );

      await expect(
        sendLushkaEmail({
          to: "customer@example.com",
          emailType:
            "DAY_30_CHECKIN",
          customerName: "Samantha",
          planType:
            "SERUM_RITUAL_90",
          idempotencyKey:
            "lushka:contract-123:DAY_30_CHECKIN",
        }),
      ).rejects.toThrow(
        "Brevo lifecycle email failed (400): Invalid sender",
      );
    },
  );
});
