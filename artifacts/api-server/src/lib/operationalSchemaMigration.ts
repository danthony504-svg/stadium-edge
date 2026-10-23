/** Explicit create-only repair. Does not grant entitlements or send messages. */
export async function applyOperationalSchemaMigration(
  client: { query: (sql: string) => Promise<any> }, migration: string,
) {
  const check = await client.query("SELECT current_database() AS name");
  if (check.rows[0]?.name !== "stadium_edge_production")
    throw Error("operational_migration_unexpected_database");
  try { await client.query(migration); }
  catch (error) { await client.query("ROLLBACK"); throw error; }
}
