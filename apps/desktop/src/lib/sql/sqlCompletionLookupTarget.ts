import type { SqlCompletionContext } from "@/lib/sql/sqlCompletion";
import { executableStatementRanges } from "@/lib/sql/sqlStatementRanges";
import type { DatabaseType } from "@/types/database";

export interface SqlCompletionTableLookupTarget {
  database: string;
  schema?: string;
  filter: string;
  qualifierDatabase?: string;
}

export interface SqlCompletionRoutineLookupTarget {
  schema?: string;
  mask: string;
}

export interface SqlCompletionScope {
  database: string;
  schema?: string;
  completionContext: SqlCompletionContext;
}

function sqlStatementWithoutLeadingComments(statement: string): string {
  let remaining = statement.trimStart();
  while (remaining) {
    if (remaining.startsWith("--")) {
      const newline = remaining.indexOf("\n");
      remaining = newline < 0 ? "" : remaining.slice(newline + 1).trimStart();
      continue;
    }
    if (remaining.startsWith("/*")) {
      const end = remaining.indexOf("*/", 2);
      if (end < 0) return "";
      remaining = remaining.slice(end + 2).trimStart();
      continue;
    }
    break;
  }
  return remaining;
}

function sqlServerUseDatabase(statement: string): string | undefined {
  const match = /^USE\s+(?:\[((?:[^\]]|\]\])*)\]|"((?:[^"]|"")*)"|([\p{L}_@#][\p{L}\p{N}_@$#]*))\s*;?\s*$/iu.exec(sqlStatementWithoutLeadingComments(statement));
  if (!match) return undefined;
  if (match[1] !== undefined) return match[1].replaceAll("]]", "]");
  if (match[2] !== undefined) return match[2].replaceAll('""', '"');
  return match[3];
}

function sqlServerUseDatabaseBeforeCursor(sql: string, cursor: number): string | undefined {
  const position = Math.max(0, Math.min(cursor, sql.length));
  let database: string | undefined;
  for (const statement of executableStatementRanges(sql, "sqlserver")) {
    if (statement.from >= position || statement.to >= position) break;
    database = sqlServerUseDatabase(statement.sql) ?? database;
  }
  return database;
}

export function resolveSqlCompletionScope(options: { sql: string; cursor: number; databaseType?: DatabaseType; currentDatabase: string; currentSchema?: string; completionContext: SqlCompletionContext }): SqlCompletionScope {
  if (options.databaseType !== "sqlserver") {
    return {
      database: options.currentDatabase,
      schema: options.currentSchema,
      completionContext: options.completionContext,
    };
  }
  const database = sqlServerUseDatabaseBeforeCursor(options.sql, options.cursor);
  if (!database) {
    return {
      database: options.currentDatabase,
      schema: options.currentSchema,
      completionContext: options.completionContext,
    };
  }
  const schema = "dbo";
  return {
    database,
    schema,
    completionContext: {
      ...options.completionContext,
      insertDatabase: options.completionContext.insertTable && !options.completionContext.insertDatabase ? database : options.completionContext.insertDatabase,
      insertSchema: options.completionContext.insertTable && !options.completionContext.insertSchema ? schema : options.completionContext.insertSchema,
      referencedTables: options.completionContext.referencedTables.map((table) =>
        table.database
          ? table
          : {
              ...table,
              database,
              schema: table.schema ?? schema,
            },
      ),
    },
  };
}

function findExactName(names: readonly string[] | undefined, value: string): string | undefined {
  return names?.find((name) => name.toLowerCase() === value.toLowerCase());
}

function findCaseSensitiveName(names: readonly string[] | undefined, value: string): string | undefined {
  return names?.find((name) => name === value);
}

export function mergeSqlCompletionQualifierNames(primary: readonly string[], secondary: readonly string[]): string[] {
  return [...new Set([...primary, ...secondary])];
}

export function resolveSqlCompletionSchemaLookupDatabase(options: {
  supportsDatabaseSchemaQualifier?: boolean;
  completionContext: Pick<SqlCompletionContext, "qualifier" | "qualifierParts" | "suggestTables" | "insertTable">;
  knownDatabases?: readonly string[];
  knownSchemas?: readonly string[];
}): string | undefined {
  const { completionContext } = options;
  if (!options.supportsDatabaseSchemaQualifier || !completionContext.suggestTables || completionContext.insertTable) return undefined;
  const qualifier = completionContext.qualifier?.trim();
  const qualifierParts = completionContext.qualifierParts?.filter(Boolean) ?? qualifier?.split(".").filter(Boolean) ?? [];
  if (qualifierParts.length !== 1) return undefined;
  if (findCaseSensitiveName(options.knownSchemas, qualifierParts[0]!)) return undefined;
  return findCaseSensitiveName(options.knownDatabases, qualifierParts[0]!);
}

export function resolveSqlCompletionTableLookupTarget(options: {
  currentDatabase: string;
  currentSchema?: string;
  supportsDatabaseQualifier: boolean;
  supportsDatabaseSchemaQualifier?: boolean;
  completionContext: Pick<SqlCompletionContext, "qualifier" | "qualifierParts" | "prefix" | "suggestTables" | "insertTable">;
  knownDatabases?: readonly string[];
}): SqlCompletionTableLookupTarget {
  const { completionContext } = options;
  const qualifier = completionContext.qualifier?.trim();
  const qualifierParts = completionContext.qualifierParts?.filter(Boolean) ?? qualifier?.split(".").filter(Boolean) ?? [];
  if (options.supportsDatabaseSchemaQualifier && completionContext.suggestTables && !completionContext.insertTable && qualifierParts.length >= 2) {
    const databaseQualifier = qualifierParts[qualifierParts.length - 2]!;
    const schema = qualifierParts[qualifierParts.length - 1]!;
    const database = findExactName(options.knownDatabases, databaseQualifier) ?? databaseQualifier;
    return {
      database,
      schema,
      filter: completionContext.prefix,
      qualifierDatabase: database,
    };
  }
  const qualifierIsDatabase = options.supportsDatabaseQualifier && !!qualifier && completionContext.suggestTables && !completionContext.insertTable;

  if (qualifierIsDatabase) {
    // MySQL-compatible engines, including OceanBase MySQL mode, use
    // database.table. Do not block table completion on a separate database-list
    // request when the user already typed the database qualifier.
    const database = findExactName(options.knownDatabases, qualifier) ?? qualifier;
    return {
      database,
      filter: completionContext.prefix,
      qualifierDatabase: database,
    };
  }

  return {
    database: options.currentDatabase,
    schema: qualifier && completionContext.suggestTables ? qualifier : options.currentSchema,
    filter: qualifier && completionContext.suggestTables ? completionContext.prefix : qualifier || completionContext.prefix,
  };
}

export function resolveSqlCompletionRoutineLookupTarget(options: { currentSchema?: string; completionContext: Pick<SqlCompletionContext, "qualifier" | "qualifierParts" | "prefix"> }): SqlCompletionRoutineLookupTarget {
  const qualifierParts = options.completionContext.qualifierParts?.filter(Boolean);
  const schema = qualifierParts?.[qualifierParts.length - 1] ?? options.completionContext.qualifier?.trim() ?? options.currentSchema;

  // A qualified routine uses the qualifier as metadata scope; only the final
  // identifier fragment is the function/procedure name mask.
  return {
    schema: schema || undefined,
    mask: options.completionContext.prefix,
  };
}
