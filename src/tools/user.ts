import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { UserInfoResponse } from "../generated/client/types/index.js";
import { withErrorHandling } from "../utils/error-handler.js";
import { createJsonResponse } from "../utils/response-formatter.js";
import { readOnlyAnnotations } from "../utils/tool-annotations.js";
import type { InferToolParams } from "../utils/tool-helpers.js";

type HevyClient = ReturnType<
	typeof import("../utils/hevyClientKubb.js").createClient
>;

export function registerUserTools(
	server: McpServer,
	hevyClient: HevyClient | null,
) {
	// Get user info
	const getUserInfoSchema = {} as const;
	type GetUserInfoParams = InferToolParams<typeof getUserInfoSchema>;

	server.registerTool(
		"get-user-info",
		{
			description:
				"Get the authenticated user's account info, including user ID, display name, and public profile URL. Useful for verifying which account the API key belongs to.",
			inputSchema: getUserInfoSchema,
			outputSchema: { user: z.record(z.string(), z.unknown()) },
			annotations: readOnlyAnnotations("Get User Info"),
		},
		withErrorHandling(async (_args: GetUserInfoParams) => {
			if (!hevyClient) {
				throw new Error(
					"API client not initialized. Please provide HEVY_API_KEY.",
				);
			}
			const data: UserInfoResponse = await hevyClient.getUserInfo();
			if (!data?.data) {
				throw new Error("No user info found for the authenticated user");
			}
			return createJsonResponse({ user: data.data });
		}, "get-user-info"),
	);
}
