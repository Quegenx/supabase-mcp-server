import { z } from "zod";
import { ToolHandlerParams, ToolHandlerResult } from "../../types.js";

// Schema for add-constraint tool
export const addConstraintSchema = {
  schema: z.string().default("public").describe("Schema name"),
  table: z.string().describe("Table name"),
  name: z.string().describe("Constraint name"),
  type: z.enum(["PRIMARY KEY", "FOREIGN KEY", "UNIQUE", "CHECK", "NOT NULL"]).describe("Constraint type"),
  columns: z.array(z.string()).describe("Column(s) to apply the constraint to"),
  definition: z.string().optional().describe("Additional constraint definition (e.g., CHECK condition or REFERENCES clause)"),
  deferrable: z.boolean().default(false).describe("Whether the constraint is deferrable"),
  initiallyDeferred: z.boolean().default(false).describe("Whether the constraint is initially deferred"),
  validateExisting: z.boolean().default(true).describe("Whether to validate existing data against the constraint")
};

// Handler for add-constraint tool
export const addConstraintHandler = async ({ pool, params }: ToolHandlerParams): Promise<ToolHandlerResult> => {
  try {
    const { 
      schema = "public", 
      table, 
      name, 
      type, 
      columns, 
      definition,
      deferrable = false,
      initiallyDeferred = false,
      validateExisting = true
    } = params as {
      schema: string;
      table: string;
      name: string;
      type: "PRIMARY KEY" | "FOREIGN KEY" | "UNIQUE" | "CHECK" | "NOT NULL";
      columns: string[];
      definition?: string;
      deferrable?: boolean;
      initiallyDeferred?: boolean;
      validateExisting?: boolean;
    };

    // Check if table exists
    const tableExistsQuery = `
      SELECT EXISTS (
        SELECT 1 
        FROM information_schema.tables 
        WHERE table_schema = $1 
        AND table_name = $2
      );
    `;
    const tableExistsResult = await pool.query(tableExistsQuery, [schema, table]);
    
    if (!tableExistsResult.rows[0].exists) {
      throw new Error(`Table "${schema}.${table}" does not exist`);
    }

    // Check if constraint name already exists
    const constraintExistsQuery = `
      SELECT EXISTS (
        SELECT 1 
        FROM information_schema.table_constraints 
        WHERE constraint_schema = $1 
        AND table_name = $2 
        AND constraint_name = $3
      );
    `;
    const constraintExistsResult = await pool.query(constraintExistsQuery, [schema, table, name]);
    
    if (constraintExistsResult.rows[0].exists) {
      throw new Error(`Constraint "${name}" already exists on table "${schema}.${table}"`);
    }

    // Build the ALTER TABLE statement based on constraint type
    let sql = `ALTER TABLE "${schema}"."${table}" ADD CONSTRAINT "${name}" `;
    
    // Handle different constraint types
    switch (type) {
      case "PRIMARY KEY":
        sql += `PRIMARY KEY (${columns.map(col => `"${col}"`).join(", ")})`;
        break;
        
      case "FOREIGN KEY":
        if (!definition) {
          throw new Error("Definition is required for FOREIGN KEY constraints (e.g., 'REFERENCES other_table(id)')");
        }
        sql += `FOREIGN KEY (${columns.map(col => `"${col}"`).join(", ")}) ${definition}`;
        break;
        
      case "UNIQUE":
        sql += `UNIQUE (${columns.map(col => `"${col}"`).join(", ")})`;
        break;
        
      case "CHECK":
        if (!definition) {
          throw new Error("Definition is required for CHECK constraints (e.g., 'CHECK (price > 0)')");
        }
        sql += `CHECK (${definition})`;
        break;
        
      case "NOT NULL":
        // NOT NULL is a column constraint, not a table constraint
        // We need to handle it differently
        if (columns.length !== 1) {
          throw new Error("NOT NULL constraint can only be applied to a single column");
        }
        
        sql = `ALTER TABLE "${schema}"."${table}" ALTER COLUMN "${columns[0]}" SET NOT NULL`;
        break;
    }
    
    // Add deferrable clause if applicable (not applicable for NOT NULL)
    if (type !== "NOT NULL" && deferrable) {
      sql += " DEFERRABLE";
      
      if (initiallyDeferred) {
        sql += " INITIALLY DEFERRED";
      } else {
        sql += " INITIALLY IMMEDIATE";
      }
    }
    
    // Add NOT VALID clause if not validating existing data (not applicable for NOT NULL)
    if (type !== "NOT NULL" && !validateExisting) {
      sql += " NOT VALID";
    }
    
    // Execute the ALTER TABLE statement
    await pool.query(sql);
    
    // If NOT VALID was used and we have a foreign key, we might want to validate it separately
    if (!validateExisting && type === "FOREIGN KEY") {
      // Return information about how to validate the constraint later
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            message: `Successfully added ${type} constraint "${name}" to table "${schema}.${table}" without validating existing data`,
            constraint: {
              schema,
              table,
              name,
              type,
              columns,
              definition,
              deferrable,
              initiallyDeferred,
              validated: false
            },
            validationCommand: `ALTER TABLE "${schema}"."${table}" VALIDATE CONSTRAINT "${name}";`
          }, null, 2)
        }]
      };
    }
    
    // Get constraint details
    const constraintDetailsQuery = `
      SELECT 
        tc.constraint_name,
        tc.constraint_type,
        tc.table_name,
        tc.constraint_schema,
        array_agg(kcu.column_name) as columns,
        tc.is_deferrable,
        tc.initially_deferred
      FROM 
        information_schema.table_constraints tc
      JOIN 
        information_schema.key_column_usage kcu 
        ON tc.constraint_name = kcu.constraint_name 
        AND tc.table_name = kcu.table_name
        AND tc.constraint_schema = kcu.constraint_schema
      WHERE 
        tc.constraint_schema = $1
        AND tc.table_name = $2
        AND tc.constraint_name = $3
      GROUP BY 
        tc.constraint_name, tc.constraint_type, tc.table_name, tc.constraint_schema, tc.is_deferrable, tc.initially_deferred;
    `;
    
    let constraintDetails;
    
    try {
      // This query works for most constraint types but might not work for CHECK constraints
      const constraintDetailsResult = await pool.query(constraintDetailsQuery, [schema, table, name]);
      constraintDetails = constraintDetailsResult.rows[0];
    } catch (error) {
      // Fallback for CHECK constraints or if the previous query fails
      constraintDetails = {
        constraint_name: name,
        constraint_type: type,
        table_name: table,
        constraint_schema: schema,
        columns: columns,
        is_deferrable: deferrable ? "YES" : "NO",
        initially_deferred: initiallyDeferred ? "YES" : "NO"
      };
    }
    
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          message: `Successfully added ${type} constraint "${name}" to table "${schema}.${table}"`,
          constraint: constraintDetails
        }, null, 2)
      }]
    };
  } catch (error) {
    console.error("Error adding constraint:", error);
    throw new Error(`Failed to add constraint: ${error}`);
  }
};
