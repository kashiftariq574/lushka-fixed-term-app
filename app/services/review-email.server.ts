import { createHash } from "node:crypto";

export type ReviewEmailType =
  | "DAY_14_REVIEW_REQUEST"
  | "DAY_28_REVIEW_PHOTOS_REQUEST"
  | "DAY_28_PHOTOS_ONLY_REQUEST"
  | "DAY_14_REVIEW_REWARD"
  | "DAY_28_REVIEW_REWARD";

type SendReviewEmailInput = {
  to: string;
  emailType: ReviewEmailType;
  customerName?: string | null;
  orderName: string;
  productLabels: string[];
  storefrontUrl: string;
  unsubscribeUrl?: string | null;
  discountCode?: string | null;
  discountEndsAt?: Date | null;
  idempotencyKey: string;
};

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function safeHttpUrl(value: string): string {
  const url = new URL(value);

  if (
    url.protocol !== "https:" &&
    url.protocol !== "http:"
  ) {
    throw new Error(
      `Unsupported review email URL protocol: ${url.protocol}`,
    );
  }

  return url.toString();
}

function storefrontPageUrl(
  storefrontUrl: string,
  path: string,
): string {
  const base = safeHttpUrl(storefrontUrl);

  return new URL(path, base).toString();
}

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
}

function uniqueProductLabels(
  values: string[],
): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const trimmed = value.trim();

    if (!trimmed) {
      continue;
    }

    const key = trimmed.toLowerCase();

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(trimmed);
  }

  return result;
}

function productHtml(
  productLabels: string[],
): string {
  const products =
    uniqueProductLabels(productLabels);

  if (products.length === 0) {
    return "";
  }

  if (products.length === 1) {
    return `
      <p style="margin:0 0 18px;">
        <strong>Product:</strong>
        ${escapeHtml(products[0])}
      </p>
    `;
  }

  return `
    <p style="margin:0 0 8px;">
      <strong>Products from your order:</strong>
    </p>

    <ul style="margin:0 0 18px;padding-left:22px;">
      ${products
        .map(
          (product) =>
            `<li>${escapeHtml(product)}</li>`,
        )
        .join("")}
    </ul>
  `;
}

function preheaderHtml(
  value: string,
): string {
  return `
    <div
      style="
        display:none;
        max-height:0;
        overflow:hidden;
        opacity:0;
        color:transparent;
      "
    >
      ${escapeHtml(value)}
    </div>
  `;
}

function buttonHtml({
  href,
  label,
}: {
  href: string;
  label: string;
}): string {
  return `
    <p style="margin:28px 0;">
      <a
        href="${escapeHtml(safeHttpUrl(href))}"
        style="
          display:inline-block;
          background:#111111;
          color:#ffffff;
          text-decoration:none;
          padding:14px 24px;
          border-radius:4px;
          font-weight:600;
        "
      >
        ${escapeHtml(label)}
      </a>
    </p>
  `;
}

function unsubscribeHtml(
  unsubscribeUrl?: string | null,
): string {
  if (!unsubscribeUrl?.trim()) {
    return "";
  }

  return `
    <p
      style="
        margin-top:32px;
        font-size:12px;
        color:#777777;
      "
    >
      You can
      <a href="${escapeHtml(
        safeHttpUrl(unsubscribeUrl),
      )}">
        unsubscribe from marketing emails
      </a>
      at any time.
    </p>
  `;
}

function emailShell({
  preheader,
  body,
}: {
  preheader?: string | null;
  body: string;
}): string {
  return `
    <!doctype html>
    <html>
      <body
        style="
          margin:0;
          padding:0;
          background:#f7f5f2;
          font-family:Arial,Helvetica,sans-serif;
          color:#222222;
        "
      >
        ${
          preheader
            ? preheaderHtml(preheader)
            : ""
        }

        <div
          style="
            max-width:620px;
            margin:0 auto;
            padding:32px 20px;
          "
        >
          <div
            style="
              background:#ffffff;
              padding:36px 32px;
              border-radius:6px;
            "
          >
            <h1
              style="
                margin:0 0 28px;
                font-size:26px;
                letter-spacing:1px;
              "
            >
              LUSHKA
            </h1>

            ${body}

            <p style="margin:30px 0 0;">
              With care,<br />
              <strong>LUSHKA</strong>
            </p>
          </div>
        </div>
      </body>
    </html>
  `;
}

function getReviewEmailContent(
  input: SendReviewEmailInput,
): {
  subject: string;
  html: string;
} {
  const name =
    escapeHtml(
      input.customerName?.trim() ||
        "there",
    );

  const orderName =
    escapeHtml(input.orderName);

  const products =
    productHtml(input.productLabels);

  switch (input.emailType) {
    case "DAY_14_REVIEW_REQUEST": {
      if (!input.unsubscribeUrl) {
        throw new Error(
          "Unsubscribe URL is required for the 14-day review request email",
        );
      }

      const reviewUrl =
        storefrontPageUrl(
          input.storefrontUrl,
          "/pages/lushka-14-day-review",
        );

      return {
        subject:
          "How are you finding your Lushka ritual?",
        html: emailShell({
          preheader:
            "Share your honest experience and receive 10% off your next purchase.",
          body: `
            <h2 style="margin:0 0 20px;">
              How are you finding your Lushka ritual?
            </h2>

            <p>Hi ${name},</p>

            <p>
              It has been around two weeks since your
              Lushka order was fulfilled, and we would
              love to hear how your experience is going.
            </p>

            <p>
              Share your honest review and, once your
              eligible review is submitted, we will send
              you a unique 10% thank-you code.
            </p>

            <p>
              <strong>Order:</strong> ${orderName}
            </p>

            ${products}

            ${buttonHtml({
              href: reviewUrl,
              label: "Share your review",
            })}

            <p>
              Your feedback can be positive, mixed or
              critical — the reward is for an eligible
              honest review, not for a particular rating.
            </p>

            ${unsubscribeHtml(
              input.unsubscribeUrl,
            )}
          `,
        }),
      };
    }

    case "DAY_28_REVIEW_PHOTOS_REQUEST": {
      if (!input.unsubscribeUrl) {
        throw new Error(
          "Unsubscribe URL is required for the 28-day review request email",
        );
      }

      const reviewUrl =
        storefrontPageUrl(
          input.storefrontUrl,
          "/pages/lushka-28-day-review-photos",
        );

      return {
        subject:
        "Four weeks with Lushka—show us your journey",
        html: emailShell({
          preheader:
            "Share an honest review and images to receive 20% off, valid for 30 days.",
          body: `
            <h2 style="margin:0 0 20px;">
              Four weeks with Lushka
            </h2>

            <p>Hi ${name},</p>

            <p>
              You are now around four weeks into your
              Lushka journey. We would love to hear how
              things are going and see your progress.
            </p>

            <p>
              Submit your honest review together with
              the required image upload and, once the
              submission is eligible, we will send you
              a unique 20% thank-you code valid for
              30 days.
            </p>

            <p>
              <strong>Order:</strong> ${orderName}
            </p>

            ${products}

            ${buttonHtml({
              href: reviewUrl,
              label: "Share review & photos",
          })}

            <p>
              For photos, use clear natural light,
              avoid beauty filters, and make sure no
              private documents, addresses or sensitive
              information are visible.
            </p>

            ${unsubscribeHtml(
              input.unsubscribeUrl,
            )}
          `,
        }),
      };
    }

    case "DAY_28_PHOTOS_ONLY_REQUEST": {
      if (!input.unsubscribeUrl) {
        throw new Error(
          "Unsubscribe URL is required for the 28-day photo request email",
        );
      }

      const uploadUrl =
        storefrontPageUrl(
          input.storefrontUrl,
          "/pages/lushka-28-day-photos-only",
        );

      return {
        subject:
          "Four weeks with Lushka—show us your journey",
        html: emailShell({
          preheader:
            "Share your Lushka journey in images to receive 20% off, valid for 30 days.",
          body: `
            <h2 style="margin:0 0 20px;">
              Show us your ur-week journey
            </h2>

            <p>Hi ${name},</p>

            <p>
              Thank you for already sharing your
              Lushka review with us.
            </p>

            <p>
              At this stage, we only need your progress
              images — there is no need to submit the
              same review again.
            </p>

            <p>
              Once your eligible photo submission is
              complete, we will send you a unique 20%
              thank-you code valid for 30 days.
            </p>

            <p>
              <strong>Order:</strong> ${orderName}
            </p>

            ${products}

            ${buttonHtml({
              href: uploadUrl,
              label: "Upload your photos",
            })}

            <p>
              Please use clear natural light, avoid
              beauty filters, and only upload images
              that you own and have permission to share.
            </p>

            ${unsubscribeHtml(
            input.unsubscribeUrl,
            )}
          `,
        }),
      };
    }

    case "DAY_14_REVIEW_REWARD": {
      const discountCode =
        input.discountCode?.trim();

      if (!discountCode) {
        throw new Error(
          "Discount code is required for the 14-day review reward email",
        );
      }

      return {
        subject:
          "Your 10% Lushka thank-you code",
        html: emailShell({
          body: `
            <h2 style="margin:0 0 20px;">
              Thank you for your review
            </h2>

            <p>Hi ${name},</p>

            <p>
              Thank you for taking the time to share
              your honest Lushka experience.
            </p>

            <p>Your unique 10% code is:</p>

            <p
              style="
                font-size:24px;
                font-weight:700;
                letter-spacing:2px;
                padding:16px;
                background:#f5f5f5;
                text-align:center;
              "
            >
              ${escapeHtml(discountCode)}
            </p>

            <p>
              <strong>Order:</strong> ${orderName}
            </p>

            ${products}
          `,
        }),
      };
    }

    case "DAY_28_REVIEW_REWARD": {
      const discountCode =
        input.discountCode?.trim();

      if (!discountCode) {
        throw new Error(
          "Discount code is required for the 28-day review reward email",
        );
      }

      if (!input.discountEndsAt) {
        throw new Error(
          "Expiry date is required for the 28-day review reward email",
        );
      }

      return {
        subject:
          "Your 20% Lushka thank-you code",
        html: emailShell({
          body: `
            <h2 style="margin:0 0 20px;">
              Thank you for sharing your journey
            </h2>

            <p>Hi ${name},</p>

            <p>
              Thank you for sharing your eligible
              Lushka review and/or progress images.
            </p>

            <p>Your unique 20% code is:</p>

            <p
              style="
                font-size:24px;
                font-weight:700;
                letter-spacing:2px;
                padding:16px;
                background:#f5f5f5;
                text-align:center;
              "
            >
              ${escapeHtml(discountCode)}
            </p>

            <p>
              This code expires on
              <strong>${escapeHtml(
                formatDate(
                  input.discountEndsAt,
                ),
              )}</strong>.
            </p>

            <p>
              <strong>Order:</strong> ${orderName}
            </p>

            ${products}
          `,
        }),
      };
    }
  }
}

function brevoIdempotencyUuid(
  value: string,
): string {
  const bytes = createHash("sha256")
    .update(value)
    .digest()
    .subarray(0, 16);

  /*
   * Produce a deterministic RFC-4122-compatible UUID so retries of
   * the same review signal use the same Brevo idempotency key.
   */
  bytes[6] =
    (bytes[6] & 0x0f) | 0x50;
  bytes[8] =
    (bytes[8] & 0x3f) | 0x80;

  const hex = bytes.toString("hex");

  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}

type BrevoSendResponse = {
  messageId?: string;
  messageIds?: string[];
  code?: string;
  message?: string;
};

export async function sendReviewEmail(
  input: SendReviewEmailInput,
) {
  const apiKey =
    process.env.BREVO_API_KEY?.trim();

  const fromName =
    process.env.REVIEW_EMAIL_FROM_NAME?.trim();

  const fromAddress =
    process.env.REVIEW_EMAIL_FROM_ADDRESS?.trim();

  const replyTo =
    process.env.REVIEW_EMAIL_REPLY_TO?.trim();

  if (!apiKey) {
    throw new Error(
      "BREVO_API_KEY is not configured",
    );
  }

  if (!fromName) {
    throw new Error(
      "REVIEW_EMAIL_FROM_NAME is not configured",
    );
  }

  if (!fromAddress) {
    throw new Error(
      "REVIEW_EMAIL_FROM_ADDRESS is not configured",
    );
  }

  const recipient =
    input.to.trim();

  if (!recipient) {
    throw new Error(
      "Review email recipient is required",
    );
  }

  const content =
    getReviewEmailContent(input);

  const response = await fetch(
    "https://api.brevo.com/v3/smtp/email",
    {
      method: "POST",
      headers: {
        accept: "application/json",
        "api-key": apiKey,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        sender: {
          name: fromName,
          email: fromAddress,
        },
        to: [
          {
            email: recipient,
          },
        ],
        subject: content.subject,
        htmlContent: content.html,
        /*
         * Brevo supports Idempotency-Key as a custom transactional
         * email header. The webhook/database layer remains the primary
         * durable idempotency guard; this adds provider-side protection
         * around retries.
         */
        headers: {
          idempotencyKey:
            brevoIdempotencyUuid(
              input.idempotencyKey,
            ),
        },
        ...(replyTo
          ? {
              replyTo: {
                email: replyTo,
              },
            }
          : {}),
      }),
    },
  );

  const rawBody =
    await response.text();

  let result: BrevoSendResponse = {};

  if (rawBody) {
    try {
      result =
        JSON.parse(
          rawBody,
        ) as BrevoSendResponse;
    } catch {
      if (!response.ok) {
        throw new Error(
          `Brevo review email failed (${response.status})`,
        );
      }
    }
  }

  if (!response.ok) {
    const detail =
      result.message?.trim() ||
      response.statusText ||
      "Unknown Brevo error";

    throw new Error(
      `Brevo review email failed (${response.status}): ${detail}`,
    );
  }

  return {
    providerMessageId:
      result.messageId ??
      result.messageIds?.[0] ??
      null,
  };
}
