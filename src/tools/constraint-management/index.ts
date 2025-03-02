import { addConstraintSchema, addConstraintHandler } from "./add-constraint.js";
import { removeConstraintSchema, removeConstraintHandler } from "./remove-constraint.js";
import { listConstraintsSchema, listConstraintsHandler } from "./list-constraints.js";
import { updateConstraintSchema, updateConstraintHandler } from "./update-constraint.js";
import { ToolDefinition } from "../../types.js";

export const constraintManagementTools: ToolDefinition[] = [
  {
    name: "add_constraint",
    description: "Add a new constraint to a table",
    schema: addConstraintSchema,
    handler: addConstraintHandler
  },
  {
    name: "remove_constraint",
    description: "Remove a constraint from a table",
    schema: removeConstraintSchema,
    handler: removeConstraintHandler
  },
  {
    name: "list_constraints",
    description: "List all constraints or get details about specific constraints",
    schema: listConstraintsSchema,
    handler: listConstraintsHandler
  },
  {
    name: "update_constraint",
    description: "Update an existing constraint",
    schema: updateConstraintSchema,
    handler: updateConstraintHandler
  }
];
