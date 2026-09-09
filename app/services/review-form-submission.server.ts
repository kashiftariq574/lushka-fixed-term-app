type AdminGraphql = (
  query: string,
  options?: {
    variables?: Record<string, unknown>;
  },
) => Promise<Response>;

export type ReviewFormDefinition = {
  id: string;
  name: string;
  type: string;
  fieldDefinitions: Array<{
    key: string;
    name: string;
    type: string;
  }>;
};

export type ReviewFormSubmissionField = {
  key: string;
  value: string | null;
  jsonValue: unknown;
  definition: {
    key: string;
    name: string;
    type: string;
  } | null;
};

export type ReviewFormSubmission = {
  id: string;
  handle: string;
  type: string;
  fields: ReviewFormSubmissionField[];
};

type DefinitionsResponse = {
  data?: {
    metaobjectDefinitions?: {
      nodes: Array<{
        id: string;
        name: string;
        type: string;
        fieldDefinitions: Array<{
          key: string;
          name: string;
          type: {
            name: string;
          };
        }>;
      }>;
      pageInfo: {
        hasNextPage: boolean;
        endCursor?: string | null;
      };
    };
  };
  errors?: Array<{
    message?: string;
  }>;
};

type SubmissionResponse = {
  data?: {
    metaobjectByHandle?: {
      id: string;
      handle: string;
      type: string;
      fields: Array<{
        key: string;
        value?: string | null;
        jsonValue?: unknown;
        definition?: {
          key: string;
          name: string;
          type: {
            name: string;
          };
        } | null;
      }>;
    } | null;
  };
  errors?: Array<{
    message?: string;
  }>;
};

const DEFINITIONS_QUERY = `#graphql
  query ReviewFormDefinitions($after: String) {
    metaobjectDefinitions(first: 100, after: $after) {
      nodes {
        id
        name
        type

        fieldDefinitions {
          key
          name

          type {
            name
          }
        }
      }

      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

const SUBMISSION_QUERY = `#graphql
  query ReviewFormSubmission(
    $handle: MetaobjectHandleInput!
  ) {
    metaobjectByHandle(handle: $handle) {
      id
      handle
      type

      fields {
        key
        value
        jsonValue

        definition {
          key
          name

          type {
            name
          }
        }
      }
    }
  }
`;

function graphqlErrorMessage(
  errors:
    | Array<{
        message?: string;
      }>
    | undefined,
): string {
  return (
    errors
      ?.map((error) => error.message)
      .filter(Boolean)
      .join("; ") ||
    "Shopify GraphQL error"
  );
}

export async function findReviewFormDefinition({
  graphql,
  name,
  handle,
}: {
  graphql: AdminGraphql;
  name: string;
  handle?: string | null;
}): Promise<ReviewFormDefinition> {
  let after: string | null = null;

  do {
    const response = await graphql(DEFINITIONS_QUERY, {
      variables: {
        after,
      },
    });

    const json =
      (await response.json()) as DefinitionsResponse;

    if (json.errors?.length) {
      throw new Error(
        `Unable to read metaobject definitions: ${graphqlErrorMessage(
          json.errors,
        )}`,
      );
    }

    const connection =
      json.data?.metaobjectDefinitions;

    if (!connection) {
      throw new Error(
        "Metaobject definitions response is missing",
      );
    }

    const definition = connection.nodes.find(
      (item) =>
        item.name.trim().toLowerCase() ===
        name.trim().toLowerCase(),
    );

    if (definition) {
      return {
        id: definition.id,
        name: definition.name,
        type: definition.type,
        fieldDefinitions:
          definition.fieldDefinitions.map((field) => ({
            key: field.key,
            name: field.name,
            type: field.type.name,
          })),
      };
    }

    /*
     * Shopify Forms uses generated metaobject definition
     * names/types, so the merchant-facing form name may
     * not equal metaobjectDefinition.name.
     *
     * When we have the exact submission handle from Flow,
     * probe Shopify Forms definitions for that handle and
     * verify its stored form_display_name instead.
     */
    if (handle) {
      for (const candidate of connection.nodes) {
        const isShopifyFormsDefinition =
          candidate.type
            .toLowerCase()
            .includes("shopify-forms") ||
          candidate.fieldDefinitions.some(
            (field) =>
              normalizeFieldName(field.key) ===
              "formdisplayname",
          );

        if (!isShopifyFormsDefinition) {
          continue;
        }

        const submissionResponse =
          await graphql(
            SUBMISSION_QUERY,
            {
              variables: {
                handle: {
                  type: candidate.type,
                  handle,
                },
              },
            },
          );

        const submissionJson =
          (await submissionResponse.json()) as SubmissionResponse;

        if (submissionJson.errors?.length) {
          throw new Error(
            `Unable to inspect Shopify Forms submission ${handle}: ${graphqlErrorMessage(
              submissionJson.errors,
            )}`,
          );
        }

        const submission =
          submissionJson.data?.metaobjectByHandle;

        if (!submission) {
          continue;
        }

        const formDisplayNameField =
          submission.fields.find((field) => {
            const possibleNames = [
              field.key,
              field.definition?.key,
              field.definition?.name,
            ].filter(
              (value): value is string =>
                typeof value === "string",
            );

            return possibleNames.some(
              (value) =>
                normalizeFieldName(value) ===
                "formdisplayname",
            );
          });

        const formDisplayName =
          formDisplayNameField?.value?.trim() ??
          null;

        if (
          !formDisplayName ||
          normalizeFieldName(formDisplayName) !==
            normalizeFieldName(name)
        ) {
          continue;
        }

        return {
          id: candidate.id,
          name: candidate.name,
          type: candidate.type,
          fieldDefinitions:
            candidate.fieldDefinitions.map(
              (field) => ({
                key: field.key,
                name: field.name,
                type: field.type.name,
              }),
            ),
        };
      }
    }

    if (!connection.pageInfo.hasNextPage) {
      break;
    }

    after =
      connection.pageInfo.endCursor ?? null;
  } while (after);

  throw new Error(
    `Metaobject definition not found: ${name}`,
  );
}

export async function getReviewFormSubmission({
  graphql,
  type,
  handle,
}: {
  graphql: AdminGraphql;
  type: string;
  handle: string;
}): Promise<ReviewFormSubmission> {
  const response = await graphql(SUBMISSION_QUERY, {
    variables: {
      handle: {
        type,
        handle,
      },
    },
  });

  const json =
    (await response.json()) as SubmissionResponse;

  if (json.errors?.length) {
    throw new Error(
      `Unable to read form submission ${handle}: ${graphqlErrorMessage(
        json.errors,
      )}`,
    );
  }

  const submission =
    json.data?.metaobjectByHandle;

  if (!submission) {
    throw new Error(
      `Form submission not found: ${type}/${handle}`,
    );
  }

  return {
    id: submission.id,
    handle: submission.handle,
    type: submission.type,
    fields: submission.fields.map((field) => ({
      key: field.key,
      value: field.value ?? null,
      jsonValue: field.jsonValue ?? null,

      definition: field.definition
        ? {
            key: field.definition.key,
            name: field.definition.name,
            type: field.definition.type.name,
          }
        : null,
    })),
  };
}

function normalizeFieldName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

export function reviewFormFieldValue(
  submission: ReviewFormSubmission,
  candidateNames: string[],
): string | null {
  const wanted =
    candidateNames.map(normalizeFieldName);

  for (const field of submission.fields) {
    const possibleNames = [
      field.key,
      field.definition?.key,
      field.definition?.name,
    ].filter(
      (value): value is string =>
        typeof value === "string",
    );

    const matched = possibleNames.some(
      (name) =>
        wanted.includes(
          normalizeFieldName(name),
        ),
    );

    if (matched) {
      return field.value?.trim() || null;
    }
  }

  return null;
}
