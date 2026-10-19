import { createHash } from "node:crypto";

export type LushkaEmailType =
  | "DAY_0_WELCOME"
  | "DAY_30_CHECKIN"
  | "DAY_60_FINAL_RITUAL"
  | "DAY_75_CONTINUATION"
  | "ROOT_WELCOME"
  | "ROOT_SECOND_DELIVERY"
  | "ROOT_FINAL_DELIVERY"
  | "ROOT_CONTINUATION";

type SendLushkaEmailInput = {
  to: string;
  emailType: LushkaEmailType;
  customerName?: string | null;
  planType: string;
  productImage?: {
    url: string;
    altText?: string | null;
  } | null;
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

function safeHttpUrl(
  value?: string | null,
): string | null {
  if (!value?.trim()) {
    return null;
  }

  try {
    const url = new URL(value.trim());

    if (
      url.protocol !== "https:" &&
      url.protocol !== "http:"
    ) {
      return null;
    }

    return url.toString();
  } catch {
    return null;
  }
}

function getEmailContent({
  emailType,
  customerName,
  planType,
  productImage,
}: Omit<SendLushkaEmailInput, "to" | "idempotencyKey">) {
  const name = escapeHtml(customerName?.trim() || "there");
  const isComplete = planType === "COMPLETE_RECOVERY_90";

  const day0ImageUrl =
    safeHttpUrl(productImage?.url);

  const day0ImageAlt = escapeHtml(
    productImage?.altText?.trim() ||
      (isComplete
        ? "Complete Haircare Recovery 90"
        : "Lushka Multi-Peptide Hair Growth Serum"),
  );

  switch (emailType) {
    case "DAY_0_WELCOME":
      return {
        subject: "Welcome to your LUSHKA 90-Day Root Ritual",
        html: `
          <div style="margin:0;padding:0;background:#f5efe7;font-family:Arial,Helvetica,sans-serif;color:#3a2a24;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f5efe7;padding:24px 12px;">
              <tr>
                <td align="center">
                  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:640px;background:#fffaf5;border-radius:18px;overflow:hidden;">

                    <tr>
                      <td align="center" style="background:#3b241c;padding:28px 24px;">
                        <div style="font-size:28px;line-height:34px;font-weight:700;letter-spacing:4px;color:#ffffff;">
                          LUSHKA
                        </div>
                      </td>
                    </tr>

                    <tr>
                      <td align="center" style="padding:38px 34px 20px 34px;">
                        <div style="font-size:12px;line-height:18px;font-weight:700;letter-spacing:2px;color:#9a7653;text-transform:uppercase;">
                          Your 90-Day Root Ritual Starts Here
                        </div>

                        <h1 style="margin:12px 0 0 0;font-size:30px;line-height:38px;font-weight:700;color:#3b241c;">
                          Welcome to your LUSHKA ritual
                        </h1>
                      </td>
                    </tr>

                    <tr>
                      <td style="padding:0 38px 24px 38px;font-size:16px;line-height:26px;color:#4a3931;">
                        <p style="margin:0 0 18px 0;">
                          Hi ${name},
                        </p>

                        <p style="margin:0 0 18px 0;">
                          Thank you for choosing LUSHKA. Your 90-day ritual has officially begun, and we’re delighted to be part of your scalp and hair-care journey.
                        </p>

                        ${
                          day0ImageUrl
                            ? `
                              <div style="margin:26px 0 28px 0;text-align:center;">
                                <img
                                  src="${escapeHtml(day0ImageUrl)}"
                                  alt="${day0ImageAlt}"
                                  width="280"
                              style="display:block;width:100%;max-width:280px;height:auto;margin:0 auto;border-radius:16px;background:#efe3d4;"
                                />
                              </div>
                            `
                            : ""
                        }

                        ${
                          isComplete
                            ? `
                            <div style="background:#efe3d4;border-radius:14px;padding:22px 24px;margin:26px 0;">
                                <div style="font-size:12px;line-height:18px;font-weight:700;letter-spacing:1.5px;color:#9a7653;text-transform:uppercase;margin-bottom:8px;">
                                  Your Ritual
                                </div>

                                <div style="font-size:21px;line-height:28px;font-weight:700;color:#3b241c;margin-bottom:10px;">
                                  Complete Haircare Recovery 90
                                </div>

                                <div style="font-size:15px;line-height:24px;color:#4a3931;">
                                  Your first delivery includes your complete five-step haircare ritual, together with your complimentary scalp massager.
                                </div>
                              </div>
                            `
                            : `
                              <div style="background:#efe3d4;border-radius:14px;padding:22px 24px;margin:26px 0;">
                                <div style="font-size:12px;line-height:18px;font-weight:700;letter-spacing:1.5px;color:#9a7653;text-transform:uppercase;margin-bottom:8px;">
                                  Your Ritual
                                </div>

                                <div style="font-size:21px;line-height:28px;font-weight:700;color:#3b241c;margin-bottom:10px;">
                                  Serum Ritual 90
                                </div>

                                <div style="font-size:15px;line-height:24px;color:#4a3931;">
                                  Your first delivery includes your Lushka Multi-Peptide Hair Growth Serum, ready to become part of your regular routine.
                                </div>
                              </div>
                            `
                        }

                        <h2 style="margin:30px 0 16px 0;font-size:21px;line-height:28px;color:#3b241c;">
                          Your next 90 days
                        </h2>

                        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                          <tr>
                            <td valign="top" width="44" style="padding:0 0 16px 0;">
                              <div style="width:32px;height:32px;line-height:32px;text-align:center;border-radius:50%;background:#c9a66b;color:#ffffff;font-weight:700;">
                                1
                              </div>
                            </td>
                            <td valign="top" style="padding:3px 0 16px 0;font-size:15px;line-height:23px;">
                              <strong style="color:#3b241c;">Stay consistent.</strong>
                              Follow your ritual regularly and give your scalp and hair time to respond.
                            </td>
                          </tr>

                          <tr>
                            <td valign="top" width="44" style="padding:0 0 16px 0;">
                              <div style="width:32px;height:32px;line-height:32px;text-align:center;border-radius:50%;background:#c9a66b;color:#ffffff;font-weight:700;">
                                2
                              </div>
                            </td>
                            <td valign="top" style="padding:3px 0 16px 0;font-size:15px;line-height:23px;">
                              <strong style="color:#3b241c;">Notice the small changes.</strong>
                              Pay attention to how your scalp and hair feel as your ritual progresses.
                            </td>
                          </tr>

                          <tr>
                            <td valign="top" width="44" style="padding:0;">
                              <div style="width:32px;height:32px;line-height:32px;text-align:center;border-radius:50%;background:#c9a66b;color:#ffffff;font-weight:700;">
                                3
                              </div>
                            </td>
                            <td valign="top" style="padding:3px 0 0 0;font-size:15px;line-height:23px;">
                              <strong style="color:#3b241c;">We’ll check in with you.</strong>
                              You’ll hear from us throughout your journey with guidance and reminders to help you stay on track.
                            </td>
                          </tr>
                        </table>

                        <div style="border-top:1px solid #e6d8ca;margin:32px 0 24px 0;"></div>

                        <p style="margin:0 0 12px 0;">
                          We’re here if you need any support along the way.
                        </p>

                        <p style="margin:0;font-size:16px;line-height:24px;">
                          With care,<br />
                          <strong style="color:#3b241c;">Samantha &amp; the LUSHKA team</strong>
                        </p>
                      </td>
              </tr>

                    <tr>
                      <td align="center" style="background:#3b241c;padding:24px 28px;color:#efe5da;font-size:12px;line-height:20px;">
                        <div style="font-weight:700;letter-spacing:2px;color:#ffffff;margin-bottom:6px;">
                          LUSHKA
                        </div>
                        <div>
                          Thoughtful scalp, hair and lash care.
                        </div>
                        <div style="margin-top:6px;">
                          <a
                            href="https://www.lushkacosmetics.net"
                            target="_blank"
                            style="color:#efe5da !important;text-decoration:none !important;"
                          >www.lushkacosmetics.net</a>
                        </div>
                      </td>
                    </tr>

                  </table>
                </td>
              </tr>
            </table>
          </div>
        `,
      };

    case "DAY_30_CHECKIN":
      return {
        subject: "Your 30-Day LUSHKA Check-In",
        html: `
          <h2>Your 30-day check-in</h2>
          <p>Hi ${name},</p>
          <p>You are now around 30 days into your LUSHKA 90-day ritual.</p>
          <p>Keep your routine consistent and take a moment to notice any changes in how your scalp and hair feel.</p>
          <p>Your next stage of the ritual is now underway.</p>
          <p>With care,<br />LUSHKA</p>
        `,
      };

    case "DAY_60_FINAL_RITUAL":
      return {
        subject: "Your Final 30 Days of the LUSHKA Ritual",
        html: `
          <h2>Your final 30 days</h2>
          <p>Hi ${name},</p>
          <p>You have reached the final stage of your 90-day LUSHKA ritual.</p>
          <p>Continue using your products consistently throughout these final 30 days.</p>
          <p>We will contact you again soon so you can decide whether you would like to continue with ongoing care.</p>
          <p>With care,<br />LUSHKA</p>
        `,
      };

    case "ROOT_WELCOME":
      return {
        subject: "Welcome to Your LUSHKA Root Revival Trio",
        html: `
          <div style="margin:0;padding:0;background:#f5efe7;font-family:Arial,Helvetica,sans-serif;color:#3a2a24;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f5efe7;padding:24px 12px;">
              <tr>
                <td align="center">
                  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:640px;background:#fffaf5;border-radius:18px;overflow:hidden;">
                    <tr>
                      <td align="center" style="background:#3b241c;padding:28px 24px;">
                        <div style="font-size:28px;line-height:34px;font-weight:700;letter-spacing:4px;color:#ffffff;">
                          LUSHKA
                        </div>
                      </td>
                    </tr>

                    <tr>
                      <td align="center" style="padding:38px 34px 20px;">
                        <div style="font-size:12px;line-height:18px;font-weight:700;letter-spacing:2px;color:#9a7653;text-transform:uppercase;">
                          Your Root Revival Journey Starts Here
                        </div>

                        <h1 style="margin:12px 0 0;font-size:30px;line-height:38px;font-weight:700;color:#3b241c;">
                          Welcome to your Root Revival ritual
                        </h1>
                      </td>
                    </tr>

                    <tr>
                      <td style="padding:0 38px 34px;font-size:16px;line-height:26px;color:#4a3931;">
                        <p style="margin:0 0 18px;">
                          Hi ${name},
                        </p>

                        <p style="margin:0 0 20px;">
                          Thank you for choosing the LUSHKA Root Revival Subscription Trio. Your programme has officially begun, and we’re delighted to be part of your scalp and hair-care journey.
                        </p>

                        <div style="background:#efe3d4;border-radius:14px;padding:22px 24px;margin:26px 0;">
                          <div style="font-size:12px;line-height:18px;font-weight:700;letter-spacing:1.5px;color:#9a7653;text-transform:uppercase;margin-bottom:8px;">
                            Your Programme
                          </div>

                          <div style="font-size:21px;line-height:28px;font-weight:700;color:#3b241c;margin-bottom:10px;">
                            Root Revival Subscription Trio
                          </div>

                          <div style="font-size:15px;line-height:24px;color:#4a3931;">
                            Multi-Peptide Hair Growth Serum, Root Revival Shampoo and Follicle Strength Conditioner — across three scheduled deliveries at the interval you selected.
                          </div>
                        </div>

                        <h2 style="margin:30px 0 16px;font-size:21px;line-height:28px;color:#3b241c;">
                          Your programme at a glance
                        </h2>

                        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                          <tr>
                            <td valign="top" width="44" style="padding:0 0 16px;">
                              <div style="width:32px;height:32px;line-height:32px;text-align:center;border-radius:50%;background:#c9a66b;color:#ffffff;font-weight:700;">1</div>
                            </td>
                            <td valign="top" style="padding:3px 0 16px;font-size:15px;line-height:23px;">
                              <strong style="color:#3b241c;">Three payments.</strong>
                              Your programme is fixed to three scheduled payments only.
                            </td>
                          </tr>

                          <tr>
                            <td valign="top" width="44" style="padding:0 0 16px;">
                              <div style="width:32px;height:32px;line-height:32px;text-align:center;border-radius:50%;background:#c9a66b;color:#ffffff;font-weight:700;">2</div>
                            </td>
                            <td valign="top" style="padding:3px 0 16px;font-size:15px;line-height:23px;">
                              <strong style="color:#3b241c;">Three deliveries.</strong>
                              Each delivery contains your Root Revival Trio.
                            </td>
                          </tr>

                          <tr>
                            <td valign="top" width="44">
                              <div style="width:32px;height:32px;line-height:32px;text-align:center;border-radius:50%;background:#c9a66b;color:#ffffff;font-weight:700;">3</div>
                            </td>
                            <td valign="top" style="padding:3px 0 0;font-size:15px;line-height:23px;">
                              <strong style="color:#3b241c;">No automatic continuation.</strong>
                              Your programme ends after the third payment and delivery.
                            </td>
                          </tr>
                        </table>

                        <div style="border-top:1px solid #e6d8ca;margin:32px 0 24px;"></div>

                        <p style="margin:0;">
                          With care,<br />
                          <strong style="color:#3b241c;">Samantha &amp; the LUSHKA team</strong>
                        </p>
                      </td>
                    </tr>

                    <tr>
                      <td align="center" style="background:#3b241c;padding:24px 28px;color:#efe5da;font-size:12px;line-height:20px;">
                        <div style="font-weight:700;letter-spacing:2px;color:#ffffff;margin-bottom:6px;">LUSHKA</div>
                        <div>Thoughtful scalp, hair and lash care.</div>
                        <div style="margin-top:6px;">
                          <a href="https://www.lushkacosmetics.net" target="_blank" style="color:#efe5da !important;text-decoration:none !important;">www.lushkacosmetics.net</a>
                        </div>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>
          </div>
        `,
      };

    case "ROOT_SECOND_DELIVERY":
      return {
        subject: "Your Next LUSHKA Root Revival Delivery",
        html: `
          <div style="margin:0;padding:0;background:#f5efe7;font-family:Arial,Helvetica,sans-serif;color:#3a2a24;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f5efe7;padding:24px 12px;">
              <tr>
                <td align="center">
                  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:640px;background:#fffaf5;border-radius:18px;overflow:hidden;">
                    <tr>
                      <td align="center" style="background:#3b241c;padding:28px 24px;">
                        <div style="font-size:28px;font-weight:700;letter-spacing:4px;color:#ffffff;">LUSHKA</div>
                      </td>
                    </tr>

                    <tr>
                      <td align="center" style="padding:38px 34px 20px;">
                        <div style="font-size:12px;font-weight:700;letter-spacing:2px;color:#9a7653;text-transform:uppercase;">
                          Payment &amp; Delivery 2 of 3
                        </div>
                        <h1 style="margin:12px 0 0;font-size:30px;line-height:38px;color:#3b241c;">
                          Your Root Revival journey continues
                        </h1>
                      </td>
                    </tr>

                    <tr>
                      <td style="padding:0 38px 34px;font-size:16px;line-height:26px;color:#4a3931;">
                        <p>Hi ${name},</p>

                        <p>
                          You’ve reached the second stage of your Root Revival programme.
                        </p>

                        <div style="background:#efe3d4;border-radius:14px;padding:22px 24px;margin:26px 0;">
                          <strong style="display:block;color:#3b241c;font-size:18px;margin-bottom:8px;">
                            Your next Root Revival Trio
                          </strong>
                          Multi-Peptide Hair Growth Serum, Root Revival Shampoo and Follicle Strength Conditioner.
                        </div>

                        <p>
                          Continue using your routine consistently and give your scalp and hair time to respond.
                        </p>

                        <div style="background:#ead6a3;border-radius:12px;padding:18px;margin:26px 0;">
                          <strong>Programme status</strong>
                          <p style="margin:8px 0 0;">
                            Payment and delivery 2 of 3. One final scheduled payment and delivery will remain after this stage.
                          </p>
                        </div>

                        <p style="margin:28px 0 0;">
                          With care,<br />
                          <strong style="color:#3b241c;">Samantha &amp; the LUSHKA team</strong>
                        </p>
                      </td>
                    </tr>

                    <tr>
                      <td align="center" style="background:#3b241c;padding:24px 28px;color:#efe5da;font-size:12px;line-height:20px;">
                        <div style="font-weight:700;letter-spacing:2px;color:#ffffff;margin-bottom:6px;">LUSHKA</div>
                        <div>Thoughtful scalp, hair and lash care.</div>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>
          </div>
        `,
      };

    case "ROOT_FINAL_DELIVERY":
      return {
        subject: "Your Final LUSHKA Root Revival Delivery",
        html: `
          <div style="margin:0;padding:0;background:#f5efe7;font-family:Arial,Helvetica,sans-serif;color:#3a2a24;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f5efe7;padding:24px 12px;">
              <tr>
                <td align="center">
                  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:640px;background:#fffaf5;border-radius:18px;overflow:hidden;">
                    <tr>
                      <td align="center" style="background:#3b241c;padding:28px 24px;">
                        <div style="font-size:28px;font-weight:700;letter-spacing:4px;color:#ffffff;">LUSHKA</div>
                      </td>
                    </tr>

                    <tr>
                      <td align="center" style="padding:38px 34px 20px;">
                        <div style="font-size:12px;font-weight:700;letter-spacing:2px;color:#9a7653;text-transform:uppercase;">
                          Payment &amp; Delivery 3 of 3
                        </div>
                        <h1 style="margin:12px 0 0;font-size:30px;line-height:38px;color:#3b241c;">
                          Your final Root Revival delivery
                        </h1>
                      </td>
                    </tr>

                    <tr>
                      <td style="padding:0 38px 34px;font-size:16px;line-height:26px;color:#4a3931;">
                        <p>Hi ${name},</p>

                        <p>
                          You’ve reached the third and final delivery of your Root Revival Trio programme.
                        </p>

                        <div style="background:#efe3d4;border-radius:14px;padding:22px 24px;margin:26px 0;">
                          <strong style="display:block;color:#3b241c;font-size:18px;margin-bottom:8px;">
                            Your three-payment programme is complete
                          </strong>
                          This is your final scheduled payment and delivery.
                        </div>

                        <p>
                          Keep following your routine consistently and enjoy the final stage of your programme.
                        </p>

                        <div style="background:#ead6a3;border-radius:12px;padding:18px;margin:26px 0;">
                          <strong>No automatic renewal</strong>
                          <p style="margin:8px 0 0;">
                            Your Root Revival programme will not automatically continue and no fourth programme payment is scheduled.
                          </p>
                        </div>

                        <p style="margin:28px 0 0;">
                          With care,<br />
                          <strong style="color:#3b241c;">Samantha &amp; the LUSHKA team</strong>
                        </p>
                      </td>
                    </tr>

                    <tr>
                      <td align="center" style="background:#3b241c;padding:24px 28px;color:#efe5da;font-size:12px;line-height:20px;">
                        <div style="font-weight:700;letter-spacing:2px;color:#ffffff;margin-bottom:6px;">LUSHKA</div>
                        <div>Thoughtful scalp, hair and lash care.</div>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>
          </div>
        `,
      };

    case "ROOT_CONTINUATION":
      return {
        subject: "What Comes Next After Your LUSHKA Root Revival Programme?",
        html: `
          <div style="
            max-width:620px;
            margin:0 auto;
            background:#f6f0e8;
            padding:28px 14px;
            font-family:Arial,sans-serif;
            color:#2a211d;
          ">
            <div style="
              background:#35180f;
              color:#ffffff;
              text-align:center;
              padding:36px 28px 32px;
              border-radius:16px 16px 0 0;
            ">
              <div style="
                font-size:13px;
                letter-spacing:2px;
                color:#d7ba78;
                margin-bottom:14px;
              ">
                LUSHKA
              </div>

              <h1 style="
                margin:0;
                font-size:30px;
                line-height:1.2;
                color:#ffffff;
              ">
                Your Root Revival programme<br />
                is complete
              </h1>

              <div style="
                margin-top:14px;
                font-size:11px;
                letter-spacing:1px;
                text-transform:uppercase;
                color:#d7ba78;
              ">
                Your journey · your choice · your next step
              </div>
            </div>

            <div style="
              background:#ffffff;
              padding:32px 30px;
              border-radius:0 0 16px 16px;
            ">
              <p style="font-size:18px;font-weight:700;">
                Hi ${name},
              </p>

              <p style="line-height:1.7;">
                Your three Root Revival Trio payments and deliveries are now complete.
                Your current programme will not automatically renew.
              </p>

              <div style="
                background:#f3eadc;
                border-radius:12px;
                padding:20px;
                margin:26px 0;
              ">
                <strong>What happens next?</strong>

                <p style="line-height:1.6;margin-bottom:0;">
                  The choice is completely yours. You can continue your
                  LUSHKA Root Revival routine with a new programme, or finish
                  here with no further subscription or payment.
                </p>
              </div>

              <h2 style="font-size:22px;margin:28px 0 10px;">
                Would you like to continue?
              </h2>

              <a
                href="https://lushkacosmetic.myshopify.com/pages/contact"
                style="
                  display:block;
                  background:#35180f;
                  color:#ffffff;
                  text-decoration:none;
                  text-align:center;
                  padding:16px 20px;
                  border-radius:8px;
                  font-weight:700;
                  margin:24px 0 12px;
                "
              >
                CONTINUE MY ROOT REVIVAL ROUTINE
              </a>

              <a
                href="mailto:lushkacosmetics3@gmail.com?subject=Finish%20my%20LUSHKA%20Root%20Revival%20programme"
                style="
                  display:block;
                  border:1px solid #35180f;
                  color:#35180f;
                  text-decoration:none;
                  text-align:center;
                  padding:15px 20px;
                  border-radius:8px;
                  font-weight:700;
                  margin-bottom:24px;
                "
              >
                FINISH MY PROGRAMME HERE
              </a>

              <div style="
                background:#ead6a3;
                border-radius:12px;
                padding:18px;
                margin:26px 0;
              ">
                <strong>No response? Nothing changes.</strong>

                <p style="line-height:1.6;margin-bottom:0;">
                  If you don’t take any action, your Root Revival programme simply
                  remains complete. There will be no automatic continuation
                  and no additional payment.
                </p>
              </div>

              <p style="font-weight:700;margin-top:28px;">
                With gratitude,<br />
                Samantha &amp; the LUSHKA team
              </p>
            </div>
          </div>
        `,
      };

    case "DAY_75_CONTINUATION":
      return {
        subject: "Your LUSHKA 90-Day Ritual Is Almost Complete",
        html: `
          <div style="
            max-width:620px;
            margin:0 auto;
            background:#f6f0e8;
            padding:28px 14px;
            font-family:Arial,sans-serif;
            color:#2a211d;
          ">
            <div style="
              background:#35180f;
              color:#ffffff;
              text-align:center;
              padding:36px 28px 32px;
              border-radius:16px 16px 0 0;
            ">
              <div style="
                font-size:13px;
                letter-spacing:2px;
                color:#d7ba78;
                margin-bottom:14px;
              ">
                LUSHKA
              </div>

              <h1 style="
                margin:0;
                font-size:30px;
                line-height:1.2;
                color:#ffffff;
              ">
                Your 90-day ritual is<br />
                almost complete
              </h1>

              <div style="
                margin-top:14px;
                font-size:11px;
                letter-spacing:1px;
                text-transform:uppercase;
                color:#d7ba78;
              ">
                Your journey · your choice · your next step
              </div>
            </div>

            <div style="
              background:#ffffff;
              padding:32px 30px;
              border-radius:0 0 16px 16px;
            ">
              <p style="font-size:18px;font-weight:700;">
                Hi ${name},
              </p>

              <p style="line-height:1.7;">
                You’re approaching the end of your 90-day LUSHKA ritual.
              ur three agreed programme payments are complete, and
                your current programme will not automatically renew.
              </p>

              <div style="
                background:#f3eadc;
                border-radius:12px;
                padding:20px;
                margin:26px 0;
              ">
                <strong>What happens next?</strong>

                <p style="line-height:1.6;margin-bottom:0;">
                  The choice is completely yours. You can continue your
                  LUSHKA ritual with a new programme, or finish here with
                  no further subscription or payment.
                </p>
              </div>

              <h2 style="font-size:22px;margin:28px 0 10px;">
                Would you like to continue?
              </h2>

              <a
                href="https://lushkacosmetic.myshopify.com/pages/contact"
                style="
                  display:block;
                  background:#35180f;
                  color:#ffffff;
                  text-decoration:none;
                  text-align:center;
                  padding:16px 20px;
                  border-radius:8px;
                  font-weight:700;
                  margin:24px 0 12px;
                "
              >
                CONTINUE MY LUSHKA RITUAL
              </a>

              <a
                href="mailto:lushkacosmetics3@gmail.com?subject=Finish%20my%20LUSHKA%20programme"
                style="
                  display:block;
                  border:1px solid #35180f;
                  color:#35180f;
                  text-decoration:none;
                  text-align:center;
                  padding:15px 20px;
                  border-radius:8px;
                  font-weight:700;
                  margin-bottom:24px;
                "
              >
                FINISH MY PROGRAMME HERE
              </a>

              <div style="
                background:#ead6a3;
                border-radius:12px;
                padding:18px;
                margin:26px 0;
              ">
                <strong>No response? Nothing changes.</strong>

                <p style="line-height:1.6;margin-bottom:0;">
                  If you don’t take any action, your programme simply
                  remains complete. There will be no automatic continuation
                  and no additional payment.
                </p>
              </div>

              <p style="font-weight:700;margin-top:28px;">
                With gratitude,<br />
                Samantha &amp; the LUSHKA team
              </p>
          </div>
          </div>
        `,
      };
  }
}

function brevoIdempotencyUuid(value: string): string {
  const hex = createHash("sha256")
    .update(value)
    .digest("hex")
    .slice(0, 32);

  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `4${hex.slice(13, 16)}`,
    `8${hex.slice(17, 20)}`,
    hex.slice(20, 32),
  ].join("-");
}

type BrevoSendResponse = {
  messageId?: string;
  messageIds?: string[];
  code?: string;
  message?: string;
};

export async function sendLushkaEmail(
  input: SendLushkaEmailInput,
) {
  const apiKey =
    process.env.BREVO_API_KEY?.trim();

  const fromAddress =
    process.env.EMAIL_FROM?.trim() ||
    process.env.REVIEW_EMAIL_FROM_ADDRESS?.trim();

  const fromName =
    process.env.EMAIL_FROM_NAME?.trim() ||
    process.env.REVIEW_EMAIL_FROM_NAME?.trim() ||
    "LUSHKA";

  const replyTo =
    process.env.EMAIL_REPLY_TO?.trim() ||
    process.env.REVIEW_EMAIL_REPLY_TO?.trim();

  if (!apiKey) {
    throw new Error(
      "BREVO_API_KEY is not configured",
    );
  }

  if (!fromAddress) {
    throw new Error(
      "EMAIL_FROM is not configured",
    );
  }

  const recipient = input.to.trim();

  if (!recipient) {
    throw new Error(
      "Lifecycle email recipient is required",
    );
  }

  const content = getEmailContent(input);

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

  let result: BrevoSendResponse = {};

  try {
    result =
      (await response.json()) as BrevoSendResponse;
  } catch {
    // Brevo may occasionally return no JSON body.
  }

  if (!response.ok) {
    const detail =
      result.message ||
      result.code ||
      "Unknown Brevo error";

    throw new Error(
      `Brevo lifecycle email failed (${response.status}): ${detail}`,
    );
  }

  return {
    providerMessageId:
      result.messageId ??
      result.messageIds?.[0] ??
      null,
  };
}
