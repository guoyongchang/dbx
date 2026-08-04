import { tokenizeSqlSemantic } from "@/lib/sql/semantic/tokens";

export type SqlSelectionCaseMode = "upper" | "lower";

type SqlSelectionRange = {
  from: number;
  to: number;
};

function convertCase(text: string, mode: SqlSelectionCaseMode): string {
  return mode === "upper" ? text.toUpperCase() : text.toLowerCase();
}

export function convertSqlSelectionCase(sql: string, range: SqlSelectionRange, mode: SqlSelectionCaseMode, dialectId?: "mysql" | "postgres" | "sqlserver"): string {
  const from = Math.max(0, Math.min(range.from, sql.length));
  const to = Math.max(from, Math.min(range.to, sql.length));
  const stringTokens = tokenizeSqlSemantic(sql, dialectId).filter((item) => item.kind === "string" && item.span.end > from && item.span.start < to);
  if (stringTokens.length === 0) return convertCase(sql.slice(from, to), mode);

  let converted = "";
  let cursor = from;
  for (const item of stringTokens) {
    const literalFrom = Math.max(from, item.span.start);
    const literalTo = Math.min(to, item.span.end);
    converted += convertCase(sql.slice(cursor, literalFrom), mode);
    converted += sql.slice(literalFrom, literalTo);
    cursor = literalTo;
  }
  converted += convertCase(sql.slice(cursor, to), mode);
  return converted;
}
