import { PoolClient } from "pg";
import { q } from "../db";

const exec = async (client: PoolClient | undefined, sql: string, params: any[]) =>
  client ? void (await client.query(sql, params)) : void (await q(sql, params));

/** In-app notification to one user. */
export const notifyUser = (userId: string, body: string, linkPath?: string, client?: PoolClient) =>
  exec(client, "INSERT INTO notifications (user_id, body, link_path) VALUES ($1, $2, $3)", [
    userId,
    body,
    linkPath ?? null,
  ]);

/** Fan out a notification to every active admin. */
export const notifyAdmins = (body: string, linkPath?: string, client?: PoolClient) =>
  exec(
    client,
    `INSERT INTO notifications (user_id, body, link_path)
     SELECT id, $1, $2 FROM users WHERE role = 'admin' AND is_active`,
    [body, linkPath ?? null]
  );

export const audit = (
  actorId: string | null,
  action: string,
  entityType: string,
  entityId: string,
  detail?: object,
  client?: PoolClient
) =>
  exec(
    client,
    "INSERT INTO audit_log (actor_id, action, entity_type, entity_id, detail) VALUES ($1, $2, $3, $4, $5)",
    [actorId, action, entityType, entityId, detail ? JSON.stringify(detail) : null]
  );
