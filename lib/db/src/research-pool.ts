import pg from "pg";
/** Explicit research connection; no application database fallback. */
export function createResearchPool(connectionString:string) {
 return new pg.Pool({connectionString,max:1,connectionTimeoutMillis:5000,idleTimeoutMillis:1000,statement_timeout:10000,query_timeout:12000});
}
