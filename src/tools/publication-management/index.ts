import { listPublicationsSchema, listPublicationsHandler } from "./list-publications.js";
import { createPublicationSchema, createPublicationHandler } from "./create-publication.js";
import { updatePublicationSchema, updatePublicationHandler } from "./update-publication.js";
import { deletePublicationSchema, deletePublicationHandler } from "./delete-publication.js";
import { ToolDefinition } from "../../types.js";

// Export all publication management tools
export const publicationManagementTools: ToolDefinition[] = [
  {
    name: "list-publications",
    description: "List all publications or get details about specific publications",
    schema: listPublicationsSchema,
    handler: listPublicationsHandler
  },
  {
    name: "create-publication",
    description: "Create a new database publication",
    schema: createPublicationSchema,
    handler: createPublicationHandler
  },
  {
    name: "update-publication",
    description: "Update an existing database publication",
    schema: updatePublicationSchema,
    handler: updatePublicationHandler
  },
  {
    name: "delete-publication",
    description: "Remove a publication from the database",
    schema: deletePublicationSchema,
    handler: deletePublicationHandler
  }
];

// Export individual tools for direct access
export {
  listPublicationsSchema,
  listPublicationsHandler,
  createPublicationSchema,
  createPublicationHandler,
  updatePublicationSchema,
  updatePublicationHandler,
  deletePublicationSchema,
  deletePublicationHandler
}; 