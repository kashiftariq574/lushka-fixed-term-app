import prisma from "../db.server";
import {
  sendLushkaEmail,
  type LushkaEmailType,
} from "./email.server";

const DAY_MS = 24 * 60 * 60 * 1000;

const LIFECYCLE_SCHEDULE: ReadonlyArray<{
  emailType: LushkaEmailType;
  daysAfterStart: number;
}> = [
  {
    emailType: "DAY_0_WELCOME",
    daysAfterStart: 0,
  },
  {
    emailType: "DAY_30_CHECKIN",
    daysAfterStart: 30,
  },
  {
    emailType: "DAY_60_FINAL_RITUAL",
    daysAfterStart: 60,
  },
  {
    emailType: "DAY_75_CONTINUATION",
    daysAfterStart: 75,
  },
];

function dueDate(
  startedAt: Date,
  daysAfterStart: number,
) {
  return new Date(
    startedAt.getTime() +
      daysAfterStart * DAY_MS,
  );
}

export async function scheduleLifecycleEmails({
  shop,
  contractId,
  recipientEmail,
  startedAt,
}: {
  shop: string;
  contractId: string;
  recipientEmail: string;
  startedAt: Date;
}) {
  const recipient =
    recipientEmail.trim();

  if (!recipient) {
    throw new Error(
      "Cannot schedule lifecycle emails without recipient email",
    );
  }

  for (const item of LIFECYCLE_SCHEDULE) {
    await prisma.emailEvent.upsert({
      where: {
        contractId_emailType: {
          contractId,
          emailType: item.emailType,
        },
      },
      update: {
        shop,
        recipientEmail: recipient,
      },
      create: {
        shop,
        contractId,
        emailType: item.emailType,
        recipientEmail: recipient,
        idempotencyKey:
          `lushka:${contractId}:${item.emailType}`,
        status: "PENDING",
        dueAt: dueDate(
          startedAt,
          item.daysAfterStart,
        ),
      },
    });
  }

  return {
    scheduled: LIFECYCLE_SCHEDULE.length,
  };
}

export async function scheduleRootRevivalLifecycleEmails({
  shop,
  contractId,
  recipientEmail,
  startedAt,
  intervalWeeks,
}: {
  shop: string;
  contractId: string;
  recipientEmail: string;
  startedAt: Date;
  intervalWeeks: 4 | 6 | 8;
}) {
  const recipient = recipientEmail.trim();

  if (!recipient) {
    throw new Error(
      "Cannot schedule Root Revival lifecycle emails without recipient email",
    );
  }

  const intervalDays = intervalWeeks * 7;

  const schedule: ReadonlyArray<{
    emailType: LushkaEmailType;
    daysAfterStart: number;
  }> = [
    {
      emailType: "ROOT_WELCOME",
      daysAfterStart: 0,
    },
    {
      emailType: "ROOT_SECOND_DELIVERY",
      daysAfterStart: intervalDays,
    },
    {
      emailType: "ROOT_FINAL_DELIVERY",
      daysAfterStart: intervalDays * 2,
    },
    {
      emailType: "ROOT_CONTINUATION",
      daysAfterStart: intervalDays * 2 + 15,
    },
  ];

  for (const item of schedule) {
    await prisma.emailEvent.upsert({
      where: {
        contractId_emailType: {
          contractId,
          emailType: item.emailType,
        },
      },
      update: {
        shop,
        recipientEmail: recipient,
      },
      create: {
        shop,
        contractId,
        emailType: item.emailType,
        recipientEmail: recipient,
        idempotencyKey:
          `lushka:${contractId}:${item.emailType}`,
        status: "PENDING",
        dueAt: dueDate(
          startedAt,
          item.daysAfterStart,
        ),
      },
    });
  }

  return {
    scheduled: schedule.length,
    intervalWeeks,
  };
}

const CONTRACT_EMAIL_CONTEXT_QUERY = `#graphql
  query LifecycleEmailContext($id: ID!) {
    subscriptionContract(id: $id) {
      customer {
        firstName
      }
      lines(first: 10) {
        nodes {
          title
          variantImage {
            url
            altText
          }
        }
      }
    }
  }
`;

async function emailContextForContract({
  shop,
  contractId,
}: {
  shop: string;
  contractId: string;
}) {
  try {
    const { unauthenticated } =
      await import("../shopify.server");

    const { admin } =
      await unauthenticated.admin(shop);

    const response =
      await admin.graphql(
        CONTRACT_EMAIL_CONTEXT_QUERY,
        {
          variables: {
            id: contractId,
          },
        },
      );

    const json: any =
      await response.json();

    if (json.errors?.length) {
      console.warn(
        "Unable to read lifecycle email contract context",
        {
          shop,
          contractId,
          errors: json.errors,
        },
      );

      return {
        customerName: null,
        productImage: null,
      };
    }

    const contract =
      json.data?.subscriptionContract;

    const imageLine =
      contract?.lines?.nodes?.find(
        (line: any) =>
          Boolean(line?.variantImage?.url),
      );

    return {
      customerName:
        contract?.customer?.firstName?.trim() ||
        null,

      productImage:
        imageLine?.variantImage?.url
          ? {
              url: String(
                imageLine.variantImage.url,
              ).trim(),
              altText:
                imageLine.variantImage
                  .altText?.trim() ||
                imageLine.title?.trim() ||
                null,
            }
          : null,
    };
  } catch (error) {
    console.warn(
      "Unable to load lifecycle email contract context",
      {
        shop,
        contractId,
        error,
      },
    );

    return {
      customerName: null,
      productImage: null,
    };
  }
}

export async function processDueLifecycleEmails(
  now = new Date(),
) {
  const dueEvents =
    await prisma.emailEvent.findMany({
      where: {
        status: "PENDING",
        dueAt: {
          lte: now,
        },
      },
      orderBy: {
        dueAt: "asc",
      },
      take: 50,
    });

  const results: Array<
    Record<string, unknown>
  > = [];

  for (const event of dueEvents) {
    const claim =
      await prisma.emailEvent.updateMany({
        where: {
          id: event.id,
          status: "PENDING",
        },
        data: {
          status: "PROCESSING",
          attemptCount: {
            increment: 1,
          },
          error: null,
        },
      });

    if (claim.count === 0) {
      results.push({
        eventId: event.id,
        skipped: true,
        reason: "Already claimed",
      });

      continue;
    }

    try {
      const emailContext =
        await emailContextForContract({
          shop: event.shop,
          contractId:
            event.contractId,
        });

      const sent =
        await sendLushkaEmail({
          to: event.recipientEmail,
          emailType:
            event.emailType as LushkaEmailType,
          customerName:
            emailContext.customerName,
          productImage:
            emailContext.productImage,
          planType:
            (
              await prisma.contractState.findUnique(
                {
                  where: {
                    contractId:
                      event.contractId,
                  },
                  select: {
                    planType: true,
                  },
                },
              )
            )?.planType ?? "UNKNOWN",
          idempotencyKey:
            event.idempotencyKey,
        });

      await prisma.emailEvent.update({
        where: {
          id: event.id,
        },
        data: {
          status: "SENT",
          sentAt: new Date(),
          providerMessageId:
            sent.providerMessageId,
          error: null,
        },
      });

      results.push({
        eventId: event.id,
        emailType: event.emailType,
        sent: true,
      });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Unknown lifecycle email error";

      /*
       * Return to PENDING so the next cron run can retry.
       * Brevo receives a deterministic idempotency key as
       * additional provider-side duplicate protection.
       */
      await prisma.emailEvent.update({
        where: {
          id: event.id,
        },
        data: {
          status: "PENDING",
          error: message,
        },
      });

      console.error(
        "Lifecycle email delivery failed",
        {
          eventId: event.id,
          contractId:
            event.contractId,
          emailType:
            event.emailType,
          error: message,
        },
      );

      results.push({
        eventId: event.id,
        emailType:
          event.emailType,
        sent: false,
        error: message,
      });
    }
  }

  return {
    checkedAt: now.toISOString(),
    dueCount: dueEvents.length,
    results,
  };
}
