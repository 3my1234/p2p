import { pool, withTransaction, type DbClient } from "../db.js";
import { redisPub } from "../redis.js";

function money(value: string | number): string {
  return Number(value).toFixed(12);
}

async function expireOrder(client: DbClient, order: Record<string, any>) {
  const total = Number(order.asset_amount) + Number(order.fee_amount);
  await client.query("select * from escrow_ledger where order_id = $1 for update", [order.id]);
  await client.query(
    `update wallet_accounts
     set available_balance = available_balance + $1::numeric,
         escrow_balance = escrow_balance - $1::numeric,
         updated_at = now()
     where user_id = $2 and asset = $3`,
    [money(total), order.seller_id, order.asset]
  );
  await client.query("update ads set available_amount = available_amount + $1::numeric, updated_at = now() where id = $2", [
    order.asset_amount,
    order.ad_id
  ]);
  await client.query("update escrow_ledger set status = 'RETURNED', released_at = now() where order_id = $1", [order.id]);
  await client.query(
    `insert into ledger_entries(user_id, order_id, asset, entry_type, amount, direction, idempotency_key)
     values ($1,$2,$3,'ESCROW_RETURN',$4,'CREDIT',$5)
     on conflict(idempotency_key) do nothing`,
    [order.seller_id, order.id, order.asset, money(total), `escrow-return:${order.id}:expired`]
  );
  const event = await client.query(
    `insert into order_events(order_id, from_status, to_status, event_type)
     values ($1,$2,'CANCELLED_EXPIRED','ORDER_EXPIRED')
     returning id`,
    [order.id, order.status]
  );
  await client.query("update orders set status = 'CANCELLED_EXPIRED', last_event_id = $1, updated_at = now() where id = $2", [
    event.rows[0].id,
    order.id
  ]);
}

export async function expireUnpaidOrders() {
  const candidates = await pool.query(
    `select * from orders
     where status = 'PAYMENT_PENDING'
       and payment_deadline < now()
     order by payment_deadline asc
     limit 50`
  );

  for (const order of candidates.rows) {
    await withTransaction("SERIALIZABLE", async (client) => {
      const locked = await client.query("select * from orders where id = $1 for update", [order.id]);
      const fresh = locked.rows[0];
      if (!fresh || fresh.status !== "PAYMENT_PENDING" || fresh.payment_deadline > new Date()) return;
      await expireOrder(client, fresh);
    });
    await redisPub.publish(`order:${order.id}`, JSON.stringify({ type: "ORDER_EXPIRED", orderId: order.id }));
  }
}

export function startExpiryWorker() {
  setInterval(() => {
    expireUnpaidOrders().catch((error) => {
      console.error("expiry worker failed", error);
    });
  }, 30_000);
}
