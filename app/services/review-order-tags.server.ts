type AdminGraphql = (
  query: string,
  options?: {
    variables?: Record<string, unknown>;
  },
) => Promise<Response>;

type TagMutationResponse = {
  data?: {
    tagsAdd?: {
      node?: {
        id: string;
      } | null;
      userErrors: Array<{
        field?: string[] | null;
        message: string;
      }>;
    };
    tagsRemove?: {
      node?: {
        id: string;
      } | null;
      userErrors: Array<{
        field?: string[] | null;
        message: string;
      }>;
    };
  };
  errors?: Array<{
    message?: string;
  }>;
};

const TAGS_ADD_MUTATION = `#graphql
  mutation ReviewOrderTagsAdd(
    $id: ID!
    $tags: [String!]!
  ) {
    tagsAdd(id: $id, tags: $tags) {
      node {
        id
      }

      userErrors {
        field
        message
      }
    }
  }
`;

const TAGS_REMOVE_MUTATION = `#graphql
  mutation ReviewOrderTagsRemove(
    $id: ID!
    $tags: [String!]!
  ) {
    tagsRemove(id: $id, tags: $tags) {
      node {
        id
      }

      userErrors {
        field
        message
      }
    }
  }
`;

function topLevelErrors(
  json: TagMutationResponse,
): string | null {
  if (!json.errors?.length) {
    return null;
  }

  return (
    json.errors
      .map((error) => error.message)
      .filter(Boolean)
      .join("; ") ||
    "Shopify GraphQL error"
  );
}

function userErrorMessage(
  errors:
    | Array<{
        field?: string[] | null;
        message: string;
      }>
    | undefined,
): string | null {
  if (!errors?.length) {
    return null;
  }

  return errors
    .map((error) => {
      const field =
        error.field?.join(".") || null;

      return field
        ? `${field}: ${error.message}`
        : error.message;
    })
    .join("; ");
}

export async function addReviewOrderTags({
  graphql,
  orderId,
  tags,
}: {
  graphql: AdminGraphql;
  orderId: string;
  tags: string[];
}) {
  const uniqueTags = [
    ...new Set(
      tags
        .map((tag) => tag.trim())
        .filter(Boolean),
    ),
  ];

  if (uniqueTags.length === 0) {
    return;
  }

  const response = await graphql(
    TAGS_ADD_MUTATION,
    {
      variables: {
        id: orderId,
        tags: uniqueTags,
      },
    },
  );

  const json =
    (await response.json()) as TagMutationResponse;

  const graphqlErrors = topLevelErrors(json);

  if (graphqlErrors) {
    throw new Error(
      `Unable to add review order tags: ${graphqlErrors}`,
    );
  }

  const mutation =
    json.data?.tagsAdd;

  if (!mutation) {
    throw new Error(
      "Shopify tagsAdd response is missing",
    );
  }

  const mutationErrors =
    userErrorMessage(mutation.userErrors);

  if (mutationErrors) {
    throw new Error(
      `Unable to add review order tags: ${mutationErrors}`,
    );
  }
}

export async function removeReviewOrderTags({
  graphql,
  orderId,
  tags,
}: {
  graphql: AdminGraphql;
  orderId: string;
  tags: string[];
}) {
  const uniqueTags = [
    ...new Set(
      tags
        .map((tag) => tag.trim())
        .filter(Boolean),
    ),
  ];

  if (uniqueTags.length === 0) {
    return;
  }

  const response = await graphql(
    TAGS_REMOVE_MUTATION,
    {
      variables: {
        id: orderId,
        tags: uniqueTags,
      },
    },
  );

  const json =
    (await response.json()) as TagMutationResponse;

  const graphqlErrors = topLevelErrors(json);

  if (graphqlErrors) {
    throw new Error(
      `Unable to remove review order tags: ${graphqlErrors}`,
    );
  }

  const mutation =
    json.data?.tagsRemove;

  if (!mutation) {
    throw new Error(
      "Shopify tagsRemove response is missing",
    );
  }

  const mutationErrors =
    userErrorMessage(mutation.userErrors);

  if (mutationErrors) {
    throw new Error(
      `Unable to remove review order tags: ${mutationErrors}`,
    );
  }
}

export async function transitionReviewOrderTags({
  graphql,
  orderId,
  readyTag,
  finalTags,
}: {
  graphql: AdminGraphql;
  orderId: string;
  readyTag: string;
  finalTags: string[];
}) {
  /*
   * Add the durable final state first.
   *
   * If removing READY fails afterwards, the next webhook can still
   * see the final state and reconciliation can safely clean READY.
   */
  await addReviewOrderTags({
    graphql,
    orderId,
    tags: finalTags,
  });

  await removeReviewOrderTags({
    graphql,
    orderId,
    tags: [readyTag],
  });
}
