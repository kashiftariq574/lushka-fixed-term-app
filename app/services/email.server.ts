import { Resend } from "resend";

export type LushkaEmailType =
  | "DAY_0_WELCOME"
  | "DAY_30_CHECKIN"
  | "DAY_60_FINAL_RITUAL"
  | "DAY_75_CONTINUATION";

type SendLushkaEmailInput = {
  to: string;
  emailType: LushkaEmailType;
  customerName?: string | null;
  planType: string;
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

function getEmailContent({
  emailType,
  customerName,
  planType,
}: Omit<SendLushkaEmailInput, "to" | "idempotencyKey">) {
  const name = escapeHtml(customerName?.trim() || "there");
  const isComplete = planType === "COMPLETE_RECOVERY_90";

  switch (emailType) {
    case "DAY_0_WELCOME":
      return {
        subject: "Welcome to your LUSHKA 90-Day Root Ritual",
        html: `
          <h2>Welcome to your LUSHKA ritual</h2>
          <p>Hi ${name},</p>
          <p>Your 90-day LUSHKA journey has started.</p>
          ${
            isComplete
              ? `<p>Your first Complete Haircare Recovery 90 delivery includes the five-step haircare ritual plus your complimentary scalp massager.</p>`
              : `<p>Your first Serum Ritual 90 delivery includes your Multi-Peptide Hair Growth Serum.</p>`
          }
          <p>Consistency is key. Follow your ritual regularly and give your scalp and hair time to respond.</p>
          <p>With care,<br />LUSHKA</p>
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

    case "DAY_75_CONTINUATION":
      return {
        subject: "What Comes Next After Your LUSHKA 90-Day Ritual?",
        html: `
          <h2>Your next step</h2>
          <p>Hi ${name},</p>
          <p>You are approaching the end of your 90-day LUSHKA ritual.</p>
          <p>Your current programme will not automatically continue beyond the agreed three payments.</p>
          <p>If you would like to continue your routine or move into ongoing maintenance, we would love to help you choose the right next step.</p>
          <p>With care,<br />LUSHKA</p>
        `,
      };
  }
}

export async function sendLushkaEmail(input: SendLushkaEmailInput) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  const replyTo = process.env.EMAIL_REPLY_TO;

  if (!apiKey) {
    throw new Error("RESEND_API_KEY is not configured");
  }

  if (!from) {
    throw new Error("EMAIL_FROM is not configured");
  }

  const resend = new Resend(apiKey);
  const content = getEmailContent(input);

  const result = await resend.emails.send(
    {
      from,
      to: input.to,
      subject: content.subject,
      html: content.html,
      ...(replyTo ? { replyTo } : {}),
    },
    {
      idempotencyKey: input.idempotencyKey,
    },
  );

  if (result.error) {
    throw new Error(`Resend email failed: ${result.error.message}`);
  }

  return {
    providerMessageId: result.data?.id ?? null,
  };
}
