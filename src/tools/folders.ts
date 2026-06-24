import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
// Import types from generated client
import type {
	GetV1RoutineFolders200,
	GetV1RoutineFoldersFolderid200,
	PostV1RoutineFolders201,
	RoutineFolder,
} from "../generated/client/types/index.js";
import { withErrorHandling } from "../utils/error-handler.js";
import {
	formatRoutineFolder,
	formattedRoutineFolderSchema,
} from "../utils/formatters.js";
import { createJsonResponse } from "../utils/response-formatter.js";
import {
	createAnnotations,
	readOnlyAnnotations,
} from "../utils/tool-annotations.js";
import type { InferToolParams } from "../utils/tool-helpers.js";

// Type definitions for the folder operations
type HevyClient = ReturnType<
	typeof import("../utils/hevyClientKubb.js").createClient
>;

/**
 * Register all routine folder-related tools with the MCP server
 */
export function registerFolderTools(
	server: McpServer,
	hevyClient: HevyClient | null,
) {
	// Get routine folders
	const getRoutineFoldersSchema = {
		page: z.coerce.number().int().gte(1).default(1),
		pageSize: z.coerce.number().int().gte(1).lte(10).default(5),
	} as const;
	type GetRoutineFoldersParams = InferToolParams<
		typeof getRoutineFoldersSchema
	>;

	server.registerTool(
		"get-routine-folders",
		{
			description:
				"Get a paginated list of your routine folders, including both default and custom folders. Useful for organizing and browsing your workout routines.",
			inputSchema: getRoutineFoldersSchema,
			outputSchema: { routineFolders: z.array(formattedRoutineFolderSchema) },
			annotations: readOnlyAnnotations("Get Routine Folders"),
		},
		withErrorHandling(async (args: GetRoutineFoldersParams) => {
			if (!hevyClient) {
				throw new Error(
					"API client not initialized. Please provide HEVY_API_KEY.",
				);
			}
			const { page, pageSize } = args;
			const data: GetV1RoutineFolders200 = await hevyClient.getRoutineFolders({
				page,
				pageSize,
			});

			// Process routine folders to extract relevant information
			const routineFolders =
				data?.routine_folders?.map((folder: RoutineFolder) =>
					formatRoutineFolder(folder),
				) || [];

			return createJsonResponse({ routineFolders });
		}, "get-routine-folders"),
	);

	// Get single routine folder by ID
	const getRoutineFolderSchema = {
		folderId: z.string().min(1),
	} as const;
	type GetRoutineFolderParams = InferToolParams<typeof getRoutineFolderSchema>;

	server.registerTool(
		"get-routine-folder",
		{
			description:
				"Get complete details of a specific routine folder by its ID, including name, creation date, and associated routines.",
			inputSchema: getRoutineFolderSchema,
			outputSchema: { routineFolder: formattedRoutineFolderSchema },
			annotations: readOnlyAnnotations("Get Routine Folder"),
		},
		withErrorHandling(async (args: GetRoutineFolderParams) => {
			if (!hevyClient) {
				throw new Error(
					"API client not initialized. Please provide HEVY_API_KEY.",
				);
			}
			const { folderId } = args;
			const data: GetV1RoutineFoldersFolderid200 =
				await hevyClient.getRoutineFolder(folderId);

			if (!data) {
				throw new Error(`Routine folder with ID ${folderId} not found`);
			}

			const routineFolder = formatRoutineFolder(data);
			return createJsonResponse({ routineFolder });
		}, "get-routine-folder"),
	);

	// Create new routine folder
	const createRoutineFolderSchema = {
		name: z.string().min(1),
	} as const;
	type CreateRoutineFolderParams = InferToolParams<
		typeof createRoutineFolderSchema
	>;

	server.registerTool(
		"create-routine-folder",
		{
			description:
				"Create a new routine folder in your Hevy account. Requires a name for the folder. Returns the full folder details including the new folder ID.",
			inputSchema: createRoutineFolderSchema,
			outputSchema: { routineFolder: formattedRoutineFolderSchema },
			annotations: createAnnotations("Create Routine Folder"),
		},
		withErrorHandling(async (args: CreateRoutineFolderParams) => {
			if (!hevyClient) {
				throw new Error(
					"API client not initialized. Please provide HEVY_API_KEY.",
				);
			}
			const { name } = args;
			const data: PostV1RoutineFolders201 =
				await hevyClient.createRoutineFolder({
					routine_folder: {
						title: name,
					},
				});

			if (!data) {
				throw new Error(
					"Failed to create routine folder: Server returned no data",
				);
			}

			const routineFolder = formatRoutineFolder(data);
			return createJsonResponse({ routineFolder });
		}, "create-routine-folder"),
	);
}
