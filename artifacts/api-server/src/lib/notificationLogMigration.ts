/** Explicit, create-only repair; never changes an existing table or sends a push. */
export async function applyNotificationLogMigration(
  client: { query: (sql: string) => Promise<any> },
  migration: string,
) {
  const check = await client.query("SELECT current_database() AS name");
  if (check.rows[0]?.name !== "stadium_edge_production")
    throw Error("notification_migration_unexpected_database");
  try {
    await client.query(migration);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}
