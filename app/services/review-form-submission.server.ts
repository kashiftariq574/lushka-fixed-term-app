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
}: {
  graphql: AdminGraphql;
  name: string;
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
