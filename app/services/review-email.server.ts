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
  productImages?: Array<{
    url: string;
    altText?: string | null;
  }>;
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
  showBrandHeader = true,
  showSignature = true,
}: {
  preheader?: string | null;
  body: string;
  showBrandHeader?: boolean;
  showSignature?: boolean;
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
            ${
              showBrandHeader
                ? `
                  <h1
                    style="
                      margin:0 0 28px;
                      font-size:26px;
                      letter-spacing:1px;
                    "
                  >
                    LUSHKA
                  </h1>
                `
                : ""
            }

            ${body}

            ${
              showSignature
                ? `
                  <p style="margin:30px 0 0;">
                    With care,<br />
                    <strong>LUSHKA</strong>
                  </p>
                `
                : ""
            }
          </div>
        </div>
      </body>
    </html>
  `;
}

function productHeroHtml(
  images:
    | Array<{
        url: string;
        altText?: string | null;
      }>
    | undefined,
): string {
  const unique = new Map<
    string,
    {
      url: string;
      altText?: string | null;
    }
  >();

  for (const image of images ?? []) {
    const url = image.url?.trim();

    if (!url || unique.has(url)) {
      continue;
    }

    unique.set(url, {
      url,
      altText: image.altText,
    });
  }

  const items = [...unique.values()].slice(0, 5);

  if (items.length === 0) {
    return "";
  }

  if (items.length === 1) {
    const image = items[0];

    return `
      <div
        style="
          background:#eee5d8;
          text-align:center;
          overflow:hidden;
          border-radius:0 0 14px 14px;
          margin:0 0 28px;
        "
      >
        <img
          src="${escapeHtml(
            safeHttpUrl(image.url),
          )}"
          alt="${escapeHtml(
            image.altText?.trim() ||
              "Lushka product",
          )}"
          width="100%"
          style="
            display:block;
            width:100%;
            max-width:100%;
            height:auto;
            border:0;
          "
        />
      </div>
    `;
  }

  const columnWidth =
    Math.floor(100 / items.length);

  return `
    <div
      style="
        background:#eee5d8;
        padding:18px 10px;
        margin:0 0 28px;
        border-radius:0 0 14px 14px;
      "
    >
      <table
        role="presentation"
        width="100%"
        cellspacing="0"
        cellpadding="0"
        border="0"
      >
        <tr>
          ${items
            .map(
              (image) => `
                <td
                  width="${columnWidth}%"
                  align="center"
                  valign="middle"
                  style="padding:4px;"
                >
                  <img
                    src="${escapeHtml(
                      safeHttpUrl(image.url),
                    )}"
                    alt="${escapeHtml(
                      image.altText?.trim() ||
                        "Lushka product",
                    )}"
                    width="105"
                    style="
                      display:block;
                      width:100%;
                      max-width:105px;
                      height:auto;
                      border:0;
                      margin:0 auto;
                    "
                  />
                </td>
              `,
            )
            .join("")}
        </tr>
      </table>
    </div>
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

      const productName =
        input.productLabels
          .map((label) => escapeHtml(label.trim()))
          .filter(Boolean)
          .join(", ") ||
        "your Lushka product";

      return {
        subject:
          "How are you finding your Lushka ritual?",
        html: emailShell({
          preheader:
            "Share your honest experience and receive 10% off your next purchase.",
          showBrandHeader: false,
          showSignature: false,
          body: `
            <div
              style="
                background:#30150d;
                color:#ffffff;
                padding:18px 24px;
                border-radius:10px 10px 0 0;
              "
            >
              <table
                role="presentation"
                width="100%"
                cellspacing="0"
                cellpadding="0"
                border="0"
              >
                <tr>
                  <td
                    style="
                      font-size:24px;
                      font-weight:700;
                      letter-spacing:1.5px;
                      color:#ffffff;
                    "
                  >
                    ✦ LUSHKA
                  </td>

                  <td
                    align="right"
                    style="
                      font-size:9px;
                      letter-spacing:.7px;
                      text-transform:uprcase;
                      color:#d8bb72;
                    "
                  >
                    
                  </td>
                </tr>
              </table>
            </div>

            <div
              style="
                background:#30150d;
                color:#ffffff;
                text-align:center;
                padding:36px 24px 28px;
                margin-top:22px;
                border-radius:14px 14px 0 0;
              "
            >
              <div
                style="
                  color:#d8bb72;
                  font-size:28px;
                  line-height:1;
                  margin-bottom:12px;
                "
              >
                ✦
              </div>

              <h2
                style="
                  margin:0;
                  font-size:30px;
                  line-height:1.2;
                  color:#ffffff;
                "
              >
                How are you finding<br />
                your Lushka ritual?
              </h2>

              <div
                style="
                  margin-top:13px;
                  color:#d8bb72;
                  font-size:10px;
                  font-weight:700;
                  letter-spacing:.9px;
                  text-transform:uppercase;
                "
              >
                Two weeks in, we’d love to hear from you
              </div>
            </div>

            ${productHeroHtml(
              input.productImages,
            )}

            <div style="padding-top:28px;">
              <p
                style="
                  margin:0 0 12px;
                  font-size:18px;
                  font-weight:700;
                "
              >
                Hi ${name},
              </p>

              <p
                style="
                  margin:0 0 22px;
                  line-height:1.6;
                "
              >
                It’s been two weeks since you chose
                <strong>${productName}</strong>, and we hope
                it’s becoming a valued part of your scalp,
                hair or lash-care ritual.
              </p>

              <div
                style="
                  background:#f3eadc;
                  padding:18px;
                  border-radius:11px;
                  margin:22px 0 26px;
                "
              >
                <div
                  style="
                    color:#a68236;
                    font-size:11px;
                    font-weight:700;
                    letter-spacing:.6px;
                    text-transform:uppercase;
                    margin-bottom:7px;
                  "
                >
                  Thank you for supporting a heartfelt brand
                </div>

                <div
                  style="
                    line-height:1.5;
                  "
                >
                  Every purchase supports an independent,
                  founder-led Scottish brand born from a deeply
                personal hair-loss journey—and helps us continue
                  creating thoughtful, scalp-first care.
                </div>
              </div>

              <h2
                style="
                  margin:0 0 10px;
                  font-size:23px;
                  line-height:1.3;
                "
              >
                Share your experience
              </h2>

              <p
                style="
                  margin:0 0 24px;
                  line-height:1.6;
                "
              >
                Your honest feedback helps us improve and gives
                future customers greater confidence when choosing
                their routine. Tell us what you’ve enjoyed, how
                the product fits into your routine and anything
                you think another customer should know.
              </p>

              <div
                style="
                  text-align:center;
                  margin:24px 0 30px;
                "
          >
                <a
                  href="${escapeHtml(
                    safeHttpUrl(reviewUrl),
                  )}"
                  style="
                    display:inline-block;
                    width:70%;
                    max-width:360px;
                    box-sizing:border-box;
                    background:#30150d;
                    color:#ffffff;
                    text-decoration:none;
                    text-transform:uppercase;
                    text-align:center;
                    font-size:12px;
                    font-weight:700;
                    letter-spacing:.5px;
                    padding:15px 22px;
                    border-radius:30px;
                  "
                >
                  Leave an honest review
                </a>
              </div>

              <div
                style="
                  background:#ead49a;
                  padding:20px;
                  border-radius:11px;
                  margin:0 0 24px;
                "
              >
                <div
                  style="
                    font-size:12px;
                    font-weight:700;
                    text-transform:uppercase;
                    margin-bottom:8px;
                  "
                >
                  A little thank-you: 10% off your next purchase
                </div>

                <div
                  style="
                    line-height:1.5;
                  "
                >
                  Once your review is submitted, we’ll send you
                  a unique 10% discount code for your next
                  Lushka order.
                </div>
              </div>

              <div style="margin:0 0 24px;">
                <div
                  style="
                    font-size:15px;
                    font-weight:700;
                    margin-bottom:7px;
                  "
                >
                  A gentle reminder
                </div>

                <div
                 tyle="
                    line-height:1.6;
                  "
                >
                  Scalp, hair and lash routines reward consistency.
                  Continue following the product directions and
                  give your routine time.
                  <br /><br />
                  If you need help, simply reply to this email.
                </div>
              </div>

              <p
                style="
                  margin:0 0 28px;
                  font-weight:700;
                  line-height:1.5;
                "
              >
                With gratitude,<br />
                Samantha &amp; the Lushka team
              </p>

              <div
                style="
                  background:#30150d;
                  color:#ffffff;
                  text-align:center;
                  padding:20px 16px;
                  font-size:10px;
                  line-height:1.8;
                "
              >
                Lushka Cosmetics Ltd · 68 Nantwic Drive · Edinburgh EH7 6RB
                <br />
                www.lushkacosmetics.net · @lushka_cosmetics
                <br />

                <a
                  href="${escapeHtml(
                    safeHttpUrl(input.unsubscribeUrl),
                  )}"
                  style="
                    color:#d8bb72;
                    text-decoration:underline;
                  "
                >
                  Unsubscribe
                </a>
              </div>
            </div>
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
          showBrandHeader: false,
          showSignature: false,
          body: `
            <div
              style="
                background:#2b140d;
                color:#ffffff;
                text-align:center;
              padding:34px 24px 30px;
                border-radius:14px 14px 0 0;
              "
            >
              <div
                style="
                  font-size:13px;
                  letter-spacing:1.4px;
                  text-transform:uppercase;
                  color:#d7ba78;
                  margin-bottom:12px;
                "
              >
                LUSHKA
              </div>

              <h2
                style="
                  margin:0;
                  font-size:30px;
                  line-height:1.2;
                  color:#ffffff;
                "
              >
                Four weeks with Lushka—<br />
                show us your journey
              </h2>

              <div
                style="
                  margin-top:14px;
                  font-size:11px;
                  letter-spacing:1px;
                  text-transform:uppercase;
                  color:#d7ba78;
                "
              >
                Share your experice, in your own words and images
              </div>
            </div>

            <div style="padding-top:28px;">
              <p
                style="
                  font-size:18px;
                  font-weight:700;
                  margin-bottom:8px;
                "
              >
                Hi ${name},
              </p>

              <p>
                It’s been four weeks since your Lushka order,
                and we’d love to know how your product is
                fitting into your scalp, hair or lash-care routine.
              </p>

              <div
                style="
                  background:#f3eadc;
                  padding:18px;
                  border-radius:12px;
                  margin:24px 0;
                "
              >
                <div
                  style="
                    font-size:12px;
                    font-weight:700;
                    letter-spacing:.8px;
                    text-transform:uppercase;
                    r:#a3823d;
                    margin-bottom:8px;
                  "
                >
                  Thank you for helping a heartfelt brand grow
                </div>

                <div>
                  Your purchase supports an independent,
                  founder-led Scottish brand born from a
                  personal hair-loss journey—and helps us
                  keep creating thoughtful, scalp-first care.
                </div>
              </div>

              <h2
                style="
                  margin:26px 0 10px;
                  font-size:22px;
                "
              >
                Share your review and photos
              </h2>

              <p>
                Tell us what you’ve noticed, how the product
                feels in your routine and what you would say
                to someone considering it.
              </p>

              <p>
                If you’re comfortable, upload one or more clear
                images of your scalp, haihes, brows or
                product ritual. Real, unfiltered experiences are
                the most helpful.
              </p>

              <div
                style="
                  background:#faf7f2;
                  border-radius:10px;
                  padding:14px;
                  text-align:center;
                  margin:22px 0;
                  font-size:11px;
                  font-weight:700;
                  letter-spacing:.7px;
                  text-transform:uppercase;
                "
              >
                Clear light &nbsp;·&nbsp;
                No filters &nbsp;·&nbsp;
                Same angle where possible &nbsp;·&nbsp;
                Your own images
              </div>

              <p>
                <strong>Order:</strong> ${orderName}
              </p>

              ${products}

              ${buttonHtml({
                href: reviewUrl,
                label: "Share your review & photos",
              })}

              <div
               yle="
                  background:#ead6a3;
                  padding:18px;
                  border-radius:12px;
                  margin:28px 0 22px;
                "
              >
                <div
                  style="
                    font-weight:700;
                    text-transform:uppercase;
                    margin-bottom:8px;
                  "
                >
                  Your thank-you: 20% off · valid for 30 days
                </div>

                <div>
                  Once your honest review and image upload are
                  submitted, we’ll send you a unique 20%
                  discount code. Your code will be valid for
                  30 days from the date it is issued.
                </div>
              </div>

              <h3
                style="
                  margin:20px 0 8px;
                  font-size:17px;
                "
              >
                Your images, your choice
              </h3>

              <p>
             Please confirm that the images are yours and
                choose your image-use preference in the upload
                form. Wider marketing use should only occur
                with the permission you select.
              </p>

              <p
                style="
                  font-weight:700;
                  margin-top:26px;
                "
              >
                With gratitude,<br />
                Samantha &amp; the Lushka team
              </p>

              <div
                style="
                  background:#2b140d;
                  color:#ffffff;
                  text-align:center;
                  padding:18px;
                  margin-top:30px;
                  font-size:11px;
                  line-height:1.7;
                "
              >
                Lushka Cosmetics Ltd · 68 Nantwich Drive · Edinburgh EH7 6RB
                <br />
                www.lushkacosmetics.net · @lushka_cosmetics
              </div>

              ${unsubscribeHtml(
                input.unsubscribeUrl,
              )}
            </div>
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
            "Your review is already in—share your four-week progress photos and receive 20% off.",
          showBrandHeader: false,
          showSignature: false,
          body: `
            <div
              style="
                background:#2b140d;
                color:#ffffff;
            text-align:center;
                padding:36px 26px 32px;
                border-radius:14px 14px 0 0;
              "
            >
              <div
                style="
                  font-size:13px;
                  letter-spacing:2px;
                  text-transform:uppercase;
                  color:#d7ba78;
                  margin-bottom:14px;
                "
              >
                LUSHKA
              </div>

              <h2
                style="
                  margin:0;
                  font-size:30px;
                  line-height:1.2;
                  color:#ffffff;
                "
              >
                Four weeks with Lushka—<br />
                show us your journey
              </h2>

              <div
                style="
                  margin-top:14px;
                  font-size:11px;
                  letter-spacing:1px;
                  text-transform:uppercase;
                  color:#d7ba78;
                "
              >
                Your review is in · now show us your progress
              </div>
            </div>

            <div style="padding-top:30px;">
              <p
                style="
                  font-size:18px;
                  font-weight:700;
                  margin:0 0 10px;
                "
              >
                Hi ${name},
              </p>

              <p style="line-height:1.7;">
                Thank you for already sharing your Lushka review with us.
                There’s no need to submit another review.
              </p>

              <p style="line-height:1.7;">
           Now that you’ve reached four weeks, we’d love to see
                how your Lushka journey is progressing.
              </p>

              <div
                style="
                  background:#f3eadc;
                  padding:20px;
                  border-radius:12px;
                  margin:26px 0;
                "
              >
                <div
                  style="
                    font-size:12px;
                    font-weight:700;
                    letter-spacing:.9px;
                    text-transform:uppercase;
                    color:#9a7735;
                    margin-bottom:9px;
                  "
                >
                  Your next step
                </div>

                <div style="line-height:1.65;">
                  Upload clear, honest progress images showing your
                  scalp, hair, brows or product ritual after four weeks
                  with Lushka.
                </div>
              </div>

              <h2
            style="
                  margin:28px 0 10px;
                  font-size:22px;
                "
              >
                Share your progress photos
              </h2>

              <p style="line-height:1.7;">
                Your images help us understand your experience and
                help future customers see authentic Lushka journeys.
              </p>

              <div
                style="
                  background:#faf7f2;
                  border-radius:10px;
                  padding:15px;
                  text-align:center;
                  margin:22px 0;
                  font-size:11px;
                  font-weight:700;
                  letter-spacing:.7px;
                  line-height:1.8;
                  text-transform:uppercase;
                "
              >
                Clear light &nbsp;·&nbsp;
                No filters &nbsp;·&nbsp;
                Same angle where possible &nbsp;·&nbsp;
                Your own images
              </div>

           <div
                style="
                  margin:24px 0;
                  padding:18px;
                  border:1px solid #eadfce;
                  border-radius:10px;
                "
              >
                <div style="margin-bottom:8px;">
                  <strong>Order:</strong> ${orderName}
                </div>

                ${products}
              </div>

              ${buttonHtml({
                href: uploadUrl,
                label: "Upload your photos",
              })}

              <div
                style="
                  background:#ead6a3;
                  padding:20px;
                  border-radius:12px;
                  margin:28px 0 24px;
                "
              >
                <div
                  style="
                    font-size:13px;
                    font-weight:700;
                    letter-spacing:.5px;
                    text-transform:uppercase;
                    margin-bottom:9px;
                  "
                >
                  Your thank-you: 20% off · valid for 30 days
                </div>

                <div style="line-height:1.65;">
                  Once your eligible photo submission is complete,
                  we’ll send you a unique 20% discount code.
                  Your code will be valid for 30 days from the
                  date it is issued.
                </div>
              </div>

              <h3
                style="
                  margin:24px 0 8px;
                  font-size:18px;
                "
              >
                Your images, your choice
              </h3>

              <p style="line-height:1.7;">
                Please confirm that the images are yours and choose
                your image-use preference in the upload form.
                Wider marketing use will only occur with the
                permission you select.
              </p>

              <p
                style="
                  font-weight:700;
                  margin-to8px;
                  line-height:1.6;
                "
              >
                With gratitude,<br />
                Samantha &amp; the Lushka team
              </p>

              <div
                style="
                  background:#2b140d;
                  color:#ffffff;
                  text-align:center;
                  padding:18px;
                  margin-top:30px;
                  font-size:11px;
                  line-height:1.7;
                "
              >
                Lushka Cosmetics Ltd · 68 Nantwich Drive · Edinburgh EH7 6RB
                <br />
                www.lushkacosmetics.net · @lushka_cosmetics
              </div>

              ${unsubscribeHtml(
                input.unsubscribeUrl,
              )}
            </div>
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
