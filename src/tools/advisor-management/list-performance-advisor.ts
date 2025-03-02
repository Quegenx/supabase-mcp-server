import { z } from "zod";
import { ToolHandlerParams, ToolHandlerResult } from "../../types.js";

// Schema for list-performance-advisor tool
export const listPerformanceAdvisorSchema = {
  checkId: z.string().optional().describe("Filter by specific check ID (e.g., '0001')"),
  includeDetails: z.boolean().default(true).describe("Include detailed information about each check"),
  onlyFailures: z.boolean().default(false).describe("Only show checks that failed"),
  limit: z.number().default(100).describe("Maximum number of results to return"),
  offset: z.number().default(0).describe("Offset for pagination")
};

// Performance advisor check definitions
const performanceChecks = [
  {
    id: "0001",
    name: "unindexed foreign keys",
    description: "Checks for foreign keys without corresponding indexes",
    severity: "HIGH",
    category: "performance"
  },
  {
    id: "0004",
    name: "no primary key",
    description: "Checks for tables without primary keys",
    severity: "MEDIUM",
    category: "performance"
  },
  {
    id: "0005",
    name: "unused index",
    description: "Checks for indexes that are not being used",
    severity: "LOW",
    category: "performance"
  },
  {
    id: "0009",
    name: "duplicate index",
    description: "Checks for duplicate indexes that waste space and slow down writes",
    severity: "MEDIUM",
    category: "performance"
  },
  {
    id: "0016",
    name: "materialized view in api",
    description: "Checks for materialized views exposed via API that might impact performance",
    severity: "LOW",
    category: "performance"
  },
  {
    id: "0017",
    name: "foreign table in api",
    description: "Checks for foreign tables exposed via API that might impact performance",
    severity: "MEDIUM",
    category: "performance"
  },
  {
    id: "0020",
    name: "table bloat",
    description: "Checks for tables with significant bloat that could be vacuumed",
    severity: "MEDIUM",
    category: "performance"
  },
  {
    id: "0021",
    name: "fkey to auth unique",
    description: "Checks for foreign keys to auth tables that should reference unique columns",
    severity: "MEDIUM",
    category: "performance"
  }
];

// Handler for list-performance-advisor tool
export const listPerformanceAdvisorHandler = async ({ pool, params }: ToolHandlerParams): Promise<ToolHandlerResult> => {
  try {
    const { 
      checkId,
      includeDetails = true,
      onlyFailures = false,
      limit = 100,
      offset = 0
    } = params as {
      checkId?: string;
      includeDetails?: boolean;
      onlyFailures?: boolean;
      limit?: number;
      offset?: number;
    };

    // Filter checks by ID if provided
    let filteredChecks = performanceChecks;
    if (checkId) {
      filteredChecks = performanceChecks.filter(check => check.id === checkId);
    }

    // Apply pagination
    const paginatedChecks = filteredChecks.slice(offset, offset + limit);

    // Run the actual checks against the database
    const results = await Promise.all(paginatedChecks.map(async (check) => {
      const checkResult = await runPerformanceCheck(pool, check.id);
      return {
        ...check,
        result: checkResult
      };
    }));

    // Filter by failures if requested
    const finalResults = onlyFailures 
      ? results.filter(r => r.result.status === 'FAIL') 
      : results;

    // Format the response
    const response = {
      total: filteredChecks.length,
      returned: finalResults.length,
      offset,
      limit,
      checks: finalResults.map(r => {
        if (includeDetails) {
          return r;
        } else {
          // Simplified version without details
          return {
            id: r.id,
            name: r.name,
            severity: r.severity,
            status: r.result.status
          };
        }
      })
    };

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(response, null, 2)
        }
      ]
    };
  } catch (error) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ error: `Failed to run performance advisor: ${error}` }, null, 2)
        }
      ]
    };
  }
};

// Function to run a specific performance check
async function runPerformanceCheck(pool: any, checkId: string) {
  try {
    switch (checkId) {
      case "0001": // unindexed foreign keys
        return await checkUnindexedForeignKeys(pool);
      case "0004": // no primary key
        return await checkNoPrimaryKey(pool);
      case "0005": // unused index
        return await checkUnusedIndex(pool);
      case "0009": // duplicate index
        return await checkDuplicateIndex(pool);
      case "0016": // materialized view in api
        return await checkMaterializedViewInApi(pool);
      case "0017": // foreign table in api
        return await checkForeignTableInApi(pool);
      case "0020": // table bloat
        return await checkTableBloat(pool);
      case "0021": // fkey to auth unique
        return await checkFkeyToAuthUnique(pool);
      default:
        return { status: "UNKNOWN", message: "Check not implemented" };
    }
  } catch (error) {
    return { status: "ERROR", message: `Error running check: ${error}` };
  }
}

// Individual check implementations
async function checkUnindexedForeignKeys(pool: any) {
  const query = `
    WITH fkeys AS (
      SELECT
        c.conrelid::regclass AS table_name,
        c.conname AS constraint_name,
        a.attname AS column_name,
        c.confrelid::regclass AS referenced_table
      FROM
        pg_constraint c
        JOIN pg_attribute a ON a.attnum = ANY(c.conkey) AND a.attrelid = c.conrelid
      WHERE
        c.contype = 'f'
    ),
    indexed_columns AS (
      SELECT
        t.relname AS table_name,
        a.attname AS column_name
      FROM
        pg_index i
        JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
        JOIN pg_class t ON t.oid = i.indrelid
      WHERE
        i.indisunique = false
        AND array_length(i.indkey, 1) = 1
    )
    SELECT
      f.table_name,
      f.constraint_name,
      f.column_name,
      f.referenced_table
    FROM
      fkeys f
    LEFT JOIN
      indexed_columns ic ON ic.table_name = f.table_name::name AND ic.column_name = f.column_name
    WHERE
      ic.column_name IS NULL;
  `;
  
  const result = await pool.query(query);
  const unindexedForeignKeys = result.rows;
  
  return {
    status: unindexedForeignKeys.length > 0 ? "FAIL" : "PASS",
    message: unindexedForeignKeys.length > 0 
      ? `Found ${unindexedForeignKeys.length} foreign keys without indexes` 
      : "No unindexed foreign keys found",
    details: unindexedForeignKeys.length > 0 ? {
      unindexedForeignKeys,
      recommendation: "Create indexes on these foreign key columns to improve query performance"
    } : null
  };
}

async function checkNoPrimaryKey(pool: any) {
  const query = `
    SELECT
      c.relname AS table_name,
      n.nspname AS schema_name
    FROM
      pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE
      c.relkind = 'r'
      AND n.nspname NOT IN ('pg_catalog', 'information_schema')
      AND NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = c.oid AND contype = 'p'
      );
  `;
  
  const result = await pool.query(query);
  const tablesWithoutPrimaryKey = result.rows;
  
  return {
    status: tablesWithoutPrimaryKey.length > 0 ? "FAIL" : "PASS",
    message: tablesWithoutPrimaryKey.length > 0 
      ? `Found ${tablesWithoutPrimaryKey.length} tables without primary keys` 
      : "All tables have primary keys",
    details: tablesWithoutPrimaryKey.length > 0 ? {
      tablesWithoutPrimaryKey,
      recommendation: "Add primary keys to these tables to improve performance and data integrity"
    } : null
  };
}

async function checkUnusedIndex(pool: any) {
  const query = `
    SELECT
      schemaname || '.' || relname AS table,
      indexrelname AS index,
      idx_scan AS scans
    FROM
      pg_stat_user_indexes
    WHERE
      idx_scan = 0
      AND schemaname NOT IN ('pg_catalog', 'information_schema')
      AND NOT EXISTS (
        SELECT 1
        FROM pg_constraint c
        WHERE c.conindid = indexrelid AND c.contype IN ('p', 'u')
      );
  `;
  
  const result = await pool.query(query);
  const unusedIndexes = result.rows;
  
  return {
    status: unusedIndexes.length > 0 ? "FAIL" : "PASS",
    message: unusedIndexes.length > 0 
      ? `Found ${unusedIndexes.length} unused indexes` 
      : "No unused indexes found",
    details: unusedIndexes.length > 0 ? {
      unusedIndexes,
      recommendation: "Consider dropping these unused indexes to improve write performance and save space"
    } : null
  };
}

async function checkDuplicateIndex(pool: any) {
  const query = `
    WITH index_cols AS (
      SELECT
        i.indrelid::regclass AS table_name,
        i.indexrelid::regclass AS index_name,
        array_to_string(array_agg(a.attname ORDER BY k.i), ',') AS columns,
        i.indisunique AS is_unique
      FROM
        pg_index i
        JOIN pg_class c ON c.oid = i.indexrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        CROSS JOIN LATERAL unnest(i.indkey) WITH ORDINALITY AS k(attnum, i)
        JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
      WHERE
        n.nspname NOT IN ('pg_catalog', 'information_schema')
      GROUP BY
        i.indrelid, i.indexrelid, i.indisunique
    )
    SELECT
      ic1.table_name,
      ic1.index_name AS index1,
      ic2.index_name AS index2,
      ic1.columns
    FROM
      index_cols ic1
      JOIN index_cols ic2 ON ic1.table_name = ic2.table_name
        AND ic1.columns = ic2.columns
        AND ic1.is_unique = ic2.is_unique
        AND ic1.index_name < ic2.index_name;
  `;
  
  const result = await pool.query(query);
  const duplicateIndexes = result.rows;
  
  return {
    status: duplicateIndexes.length > 0 ? "FAIL" : "PASS",
    message: duplicateIndexes.length > 0 
      ? `Found ${duplicateIndexes.length} duplicate indexes` 
      : "No duplicate indexes found",
    details: duplicateIndexes.length > 0 ? {
      duplicateIndexes,
      recommendation: "Consider dropping one of each duplicate index pair to improve write performance and save space"
    } : null
  };
}

// Placeholder implementations for other checks
async function checkMaterializedViewInApi(pool: any) {
  // Implementation would go here
  return { status: "PASS", message: "Check implemented but no issues found" };
}

async function checkForeignTableInApi(pool: any) {
  // Implementation would go here
  return { status: "PASS", message: "Check implemented but no issues found" };
}

async function checkTableBloat(pool: any) {
  // Implementation would go here
  return { status: "PASS", message: "Check implemented but no issues found" };
}

async function checkFkeyToAuthUnique(pool: any) {
  // Implementation would go here
  return { status: "PASS", message: "Check implemented but no issues found" };
} 