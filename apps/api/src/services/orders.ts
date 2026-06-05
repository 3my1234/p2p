import { createHash } from "node:crypto";
import {
  cancelOrderSchema,
  canTransition,
  createOrderSchema,
  disputeOrderSchema,
  markPaidSchema,
  releaseOrderSchema,
  type OrderSnapshot,
  type OrderStatus
} from "@baze/shared";
import { z } from "zod";
import { pool, withTransaction, type DbClient } from "../db.js";
import { redis, redisPub } from "../redis.js";

const FEE_RATE = 0.002;

function money(value: string | number): string {
  return Number(value).toFixed(12);
}

function hashName(name: string): string {
  return createHash("sha256").update(normalizeName(name)).digest("hex");
}

function normalizeName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function strictRegexNameMatch(inputName: string, verifiedName: string): boolean {
  const source = normalizeName(inputName);
  const expected = normalizeName(verifiedName);
  if (!source || !expected) return false;
  if (source === expected) return true;

  const expectedTokens = expected.split(" ").filter((token) => token.length > 1);
  if (expectedTokens.length < 2) return false;
  const matchedTokens = expectedTokens.filter((token) => new RegExp(`(^|\\s)${token}(\\s|$)`, "i").test(source));
  return matchedTokens.length === expectedTokens.length;
}

function decodeVaultName(value: Buffer | null | undefined): string {
  if (!value) return "Verified buyer";
  const decoded = value.toString("utf8").replace(/\0/g, "").trim();
  return decoded || "Verified buyer";
}

async function writeEvent(
  client: DbClient,
  orderId: string,
  actorId: string | null,
  fromStatus: OrderStatus | null,
  toStatus: OrderStatus,
  eventType: string,
  payload: Record<string, unknown> = {}
) {
  const event = await client.query(
    `insert into order_events(order_id, actor_id, from_status, to_status, event_type, payload)
     values ($1, $2, $3, $4, $5, $6)
     returning id`,
    [orderId, actorId, fromStatus, toStatus, eventType, JSON.stringify(payload)]
  );
  const eventId = Number(event.rows[0].id);
  await client.query("update orders set last_event_id = $1, updated_at = now() where id = $2", [eventId, orderId]);
  return eventId;
}

async function publishOrder(orderId: string, type: string, payload: Record<string, unknown>) {
  await redisPub.publish(`order:${orderId}`, JSON.stringify({ type, orderId, payload, ts: new Date().toISOString() }));
}

export async function cacheOrderSnapshot(orderId: string) {
  await redis.del(`order:${orderId}`);
  const snapshot = await getOrderSnapshot(orderId);
  if (snapshot) {
    await redis.hset(`order:${orderId}`, {
      snapshot: JSON.stringify(snapshot),
      lastEventId: String(snapshot.lastEventId),
      status: snapshot.status,
      riskLevel: snapshot.riskLevel
    });
    await redis.expire(`order:${orderId}`, 60 * 60);
  }
  return snapshot;
}

export async function createOrder(input: unknown) {
  const body = createOrderSchema.parse(input);

  const result = await withTransaction("SERIALIZABLE", async (client) => {
    const adResult = await client.query(
      `select a.*, u.kyc_status as seller_kyc_status
       from ads a
       join users u on u.id = a.seller_id
       where a.id = $1
       for update of a`,
      [body.adId]
    );
    const ad = adResult.rows[0];
    if (!ad || ad.status !== "ACTIVE") throw new Error("Ad is not available");
    if (ad.seller_id === body.buyerId) throw new Error("Seller cannot buy their own ad");
    if (ad.seller_kyc_status !== "VERIFIED") throw new Error("Seller KYC is not verified");

    const buyerResult = await client.query("select id, kyc_status from users where id = $1", [body.buyerId]);
    const buyer = buyerResult.rows[0];
    if (!buyer || buyer.kyc_status !== "VERIFIED") throw new Error("Buyer KYC is not verified");

    const assetAmount = Number(body.assetAmount);
    if (assetAmount < Number(ad.min_amount) || assetAmount > Number(ad.max_amount)) throw new Error("Order outside ad limits");
    if (assetAmount > Number(ad.available_amount)) throw new Error("Insufficient ad liquidity");

    const feeAmount = assetAmount * FEE_RATE;
    const fiatAmount = assetAmount * Number(ad.price);

    const walletResult = await client.query(
      `select * from wallet_accounts where user_id = $1 and asset = $2 for update`,
      [ad.seller_id, ad.asset]
    );
    const wallet = walletResult.rows[0];
    if (!wallet || Number(wallet.available_balance) < assetAmount + feeAmount) {
      throw new Error("Seller balance cannot cover escrow and maker fee");
    }

    const paymentMethodResult = await client.query(
      `select id from payment_methods where user_id = $1 and is_verified = true limit 1`,
      [ad.seller_id]
    );
    const sellerPaymentMethodId = paymentMethodResult.rows[0]?.id ?? null;

    const orderResult = await client.query(
      `insert into orders(
        ad_id, buyer_id, seller_id, seller_payment_method_id, asset, fiat_currency,
        asset_amount, fiat_amount, price, fee_amount, status, payment_deadline
       )
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'ESCROW_LOCKED', now() + interval '15 minutes')
       returning *`,
      [
        body.adId,
        body.buyerId,
        ad.seller_id,
        sellerPaymentMethodId,
        ad.asset,
        ad.fiat_currency,
        money(assetAmount),
        money(fiatAmount),
        ad.price,
        money(feeAmount)
      ]
    );
    const order = orderResult.rows[0];

    await client.query(
      `update wallet_accounts
       set available_balance = available_balance - $1::numeric,
           escrow_balance = escrow_balance + $2::numeric,
           updated_at = now()
       where user_id = $3 and asset = $4`,
      [money(assetAmount + feeAmount), money(assetAmount + feeAmount), ad.seller_id, ad.asset]
    );
    await client.query("update ads set available_amount = available_amount - $1::numeric, updated_at = now() where id = $2", [
      money(assetAmount),
      body.adId
    ]);
    await client.query(
      `insert into escrow_ledger(order_id, seller_id, buyer_id, asset, amount, fee_amount)
       values ($1,$2,$3,$4,$5,$6)`,
      [order.id, ad.seller_id, body.buyerId, ad.asset, money(assetAmount), money(feeAmount)]
    );
    await client.query(
      `insert into ledger_entries(user_id, order_id, asset, entry_type, amount, direction, idempotency_key, metadata)
       values ($1,$2,$3,'ESCROW_LOCK',$4,'DEBIT',$5,$6)`,
      [
        ad.seller_id,
        order.id,
        ad.asset,
        money(assetAmount + feeAmount),
        `escrow-lock:${order.id}`,
        JSON.stringify({ assetAmount: money(assetAmount), feeAmount: money(feeAmount) })
      ]
    );
    await writeEvent(client, order.id, body.buyerId, "ORDER_CREATED", "ESCROW_LOCKED", "ORDER_OPENED", {
      assetAmount: money(assetAmount),
      fiatAmount: money(fiatAmount)
    });
    const paymentEventId = await writeEvent(client, order.id, null, "ESCROW_LOCKED", "PAYMENT_PENDING", "PAYMENT_WINDOW_OPENED", {});
    await client.query("update orders set status = 'PAYMENT_PENDING', last_event_id = $1, updated_at = now() where id = $2", [
      paymentEventId,
      order.id
    ]);
    order.last_event_id = paymentEventId;
    order.status = "PAYMENT_PENDING";
    return order;
  });

  await cacheOrderSnapshot(result.id);
  await publishOrder(result.id, "ORDER_OPENED", { status: "PAYMENT_PENDING" });
  return result;
}

export async function markPaid(orderId: string, input: unknown) {
  const body = markPaidSchema.parse(input);
  const result = await withTransaction("REPEATABLE READ", async (client) => {
    const orderResult = await client.query("select * from orders where id = $1 for update", [orderId]);
    const order = orderResult.rows[0];
    if (!order) throw new Error("Order not found");
    if (order.buyer_id !== body.buyerId) throw new Error("Only buyer can mark paid");
    if (!canTransition(order.status, "BUYER_MARKED_PAID")) throw new Error(`Cannot mark paid from ${order.status}`);

    const kycResult = await client.query("select encrypted_legal_name, legal_name_hash from vault.kyc_vault where user_id = $1", [body.buyerId]);
    const verifiedName = decodeVaultName(kycResult.rows[0]?.encrypted_legal_name);
    const legalHash = kycResult.rows[0]?.legal_name_hash;
    const mismatch = legalHash ? hashName(body.sourceAccountName) !== legalHash && !strictRegexNameMatch(body.sourceAccountName, verifiedName) : true;
    const riskLevel = mismatch ? "HIGH_RISK_SUSPECTED" : "NORMAL";

    await client.query(
      `insert into payment_proofs(order_id, buyer_id, source_account_name, receipt_url)
       values ($1,$2,$3,$4)`,
      [orderId, body.buyerId, body.sourceAccountName, body.receiptUrl ?? null]
    );
    if (mismatch) {
      await client.query(
        `insert into risk_signals(user_id, order_id, signal_type, severity, payload)
         values ($1,$2,'PAYMENT_NAME_REVIEW_REQUIRED',5,$3)`,
        [body.buyerId, orderId, JSON.stringify({ sourceAccountName: body.sourceAccountName })]
      );
    }
    const eventId = await writeEvent(client, orderId, body.buyerId, order.status, "BUYER_MARKED_PAID", "BUYER_MARKED_PAID", {
      sourceAccountName: body.sourceAccountName,
      receiptUrl: body.receiptUrl ?? null,
      mismatch
    });
    await client.query(
      `update orders
       set status = 'BUYER_MARKED_PAID',
           buyer_marked_paid_at = now(),
           source_account_name = $1,
           flagged_payment_name_mismatch = $2,
           risk_level = $3,
           last_event_id = $4,
           updated_at = now()
       where id = $5`,
      [body.sourceAccountName, mismatch, riskLevel, eventId, orderId]
    );
    return { ...order, status: "BUYER_MARKED_PAID", last_event_id: eventId, flagged_payment_name_mismatch: mismatch, risk_level: riskLevel };
  });
  await cacheOrderSnapshot(orderId);
  await publishOrder(orderId, "BUYER_MARKED_PAID", {
    status: "BUYER_MARKED_PAID",
    riskLevel: result.risk_level,
    sellerSecurityAlert: result.flagged_payment_name_mismatch
      ? "Warning: Input sender name mismatch. Verify bank statement thoroughly before releasing."
      : undefined
  });
  return result;
}

export async function releaseOrder(orderId: string, input: unknown) {
  const body = releaseOrderSchema.parse(input);
  const result = await withTransaction("SERIALIZABLE", async (client) => {
    const orderResult = await client.query("select * from orders where id = $1 for update", [orderId]);
    const order = orderResult.rows[0];
    if (!order) throw new Error("Order not found");
    if (order.seller_id !== body.sellerId) throw new Error("Only seller can release");
    if (!["BUYER_MARKED_PAID", "SELLER_RELEASE_PENDING"].includes(order.status)) throw new Error(`Cannot release from ${order.status}`);

    const escrowResult = await client.query("select * from escrow_ledger where order_id = $1 for update", [orderId]);
    const escrow = escrowResult.rows[0];
    if (!escrow || escrow.status !== "LOCKED") throw new Error("Escrow is not locked");

    await client.query("select * from wallet_accounts where user_id in ($1,$2) and asset = $3 for update", [
      order.seller_id,
      order.buyer_id,
      order.asset
    ]);
    await client.query(
      `insert into wallet_accounts(user_id, asset, available_balance, escrow_balance)
       values ($1,$2,0,0) on conflict (user_id, asset) do nothing`,
      [order.buyer_id, order.asset]
    );
    await client.query("select * from platform_treasury_accounts where asset = $1 for update", [order.asset]);
    await client.query(
      `update wallet_accounts set escrow_balance = escrow_balance - $1::numeric, updated_at = now()
       where user_id = $2 and asset = $3`,
      [money(Number(order.asset_amount) + Number(order.fee_amount)), order.seller_id, order.asset]
    );
    await client.query(
      `update wallet_accounts set available_balance = available_balance + $1::numeric, updated_at = now()
       where user_id = $2 and asset = $3`,
      [order.asset_amount, order.buyer_id, order.asset]
    );
    await client.query(
      `insert into platform_treasury_accounts(asset, balance)
       values ($1,$2)
       on conflict (asset) do update set balance = platform_treasury_accounts.balance + excluded.balance, updated_at = now()`,
      [order.asset, order.fee_amount]
    );
    await client.query(
      `insert into platform_revenue_ledger(order_id, asset, fee_amount, fee_rate)
       values ($1,$2,$3,$4)
       on conflict(order_id) do nothing`,
      [orderId, order.asset, order.fee_amount, FEE_RATE]
    );
    await client.query("update escrow_ledger set status = 'RELEASED', released_at = now() where order_id = $1", [orderId]);

    const ledgerRows = [
      [order.seller_id, "ESCROW_RELEASE", Number(order.asset_amount) + Number(order.fee_amount), "DEBIT", `escrow-release:${orderId}`],
      [order.buyer_id, "TRADE_CREDIT", Number(order.asset_amount), "CREDIT", `buyer-credit:${orderId}`],
      [null, "FEE_CREDIT", Number(order.fee_amount), "CREDIT", `fee-credit:${orderId}`]
    ] as const;
    for (const [userId, type, amount, direction, key] of ledgerRows) {
      await client.query(
        `insert into ledger_entries(user_id, treasury_asset, order_id, asset, entry_type, amount, direction, idempotency_key)
         values ($1,$2,$3,$4,$5,$6,$7,$8)
         on conflict (idempotency_key) do nothing`,
        [userId, userId ? null : order.asset, orderId, order.asset, type, money(amount), direction, key]
      );
    }
    const eventId = await writeEvent(client, orderId, body.sellerId, order.status, "COMPLETED", "ATOMIC_RELEASE", {});
    await client.query(
      `insert into audit_logs(actor_id, action, target_type, target_id, payload)
       values ($1,'P2P_ATOMIC_RELEASE','order',$2,$3)`,
      [
        body.sellerId,
        orderId,
        JSON.stringify({
          buyerId: order.buyer_id,
          sellerId: order.seller_id,
          asset: order.asset,
          assetAmount: order.asset_amount,
          feeAmount: order.fee_amount,
          feeRate: FEE_RATE,
          escrowLedger: "escrow_ledger",
          revenueLedger: "platform_revenue_ledger"
        })
      ]
    );
    await client.query(
      `update orders set status = 'COMPLETED', released_at = now(), last_event_id = $1, updated_at = now() where id = $2`,
      [eventId, orderId]
    );
    return { ...order, status: "COMPLETED", last_event_id: eventId };
  });
  await cacheOrderSnapshot(orderId);
  await publishOrder(orderId, "ORDER_COMPLETED", { status: "COMPLETED" });
  return result;
}

export async function cancelOrder(orderId: string, input: unknown) {
  const body = cancelOrderSchema.parse(input);
  const result = await withTransaction("SERIALIZABLE", async (client) => {
    const orderResult = await client.query("select * from orders where id = $1 for update", [orderId]);
    const order = orderResult.rows[0];
    if (!order) throw new Error("Order not found");
    if (order.buyer_id !== body.userId) throw new Error("Only buyer can cancel before payment");
    if (order.status !== "PAYMENT_PENDING") throw new Error(`Cannot cancel from ${order.status}`);
    await returnEscrow(client, order, "CANCELLED_BY_BUYER_BEFORE_PAYMENT", body.userId);
    return { ...order, status: "CANCELLED_BY_BUYER_BEFORE_PAYMENT" };
  });
  await cacheOrderSnapshot(orderId);
  await publishOrder(orderId, "ORDER_CANCELLED", { status: result.status });
  return result;
}

export async function disputeOrder(orderId: string, input: unknown) {
  const body = disputeOrderSchema.parse(input);
  const result = await withTransaction("REPEATABLE READ", async (client) => {
    const orderResult = await client.query("select * from orders where id = $1 for update", [orderId]);
    const order = orderResult.rows[0];
    if (!order) throw new Error("Order not found");
    if (![order.buyer_id, order.seller_id].includes(body.userId)) throw new Error("Only order participants can dispute");
    if (!["BUYER_MARKED_PAID", "SELLER_RELEASE_PENDING"].includes(order.status)) throw new Error(`Cannot dispute from ${order.status}`);
    await client.query(
      `insert into disputes(order_id, opened_by, reason) values ($1,$2,$3)
       on conflict(order_id) do nothing`,
      [orderId, body.userId, body.reason]
    );
    const eventId = await writeEvent(client, orderId, body.userId, order.status, "DISPUTED", "DISPUTE_OPENED", { reason: body.reason });
    await client.query("update orders set status = 'DISPUTED', last_event_id = $1, updated_at = now() where id = $2", [eventId, orderId]);
    return { ...order, status: "DISPUTED" };
  });
  await cacheOrderSnapshot(orderId);
  await publishOrder(orderId, "ORDER_DISPUTED", { status: "DISPUTED" });
  return result;
}

async function returnEscrow(client: DbClient, order: Record<string, any>, status: OrderStatus, actorId: string | null) {
  await client.query("select * from escrow_ledger where order_id = $1 for update", [order.id]);
  const total = Number(order.asset_amount) + Number(order.fee_amount);
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
    [order.seller_id, order.id, order.asset, money(total), `escrow-return:${order.id}:${status}`]
  );
  const eventId = await writeEvent(client, order.id, actorId, order.status, status, "ESCROW_RETURNED", {});
  await client.query("update orders set status = $1, last_event_id = $2, updated_at = now() where id = $3", [status, eventId, order.id]);
}

export async function getOrderSnapshot(orderId: string): Promise<OrderSnapshot | null> {
  const cached = await redis.hgetall(`order:${orderId}`);
  if (cached.snapshot) return JSON.parse(cached.snapshot) as OrderSnapshot;

  const orderResult = await pool.query(
    `select o.*, bu.pseudonym as buyer_pseudonym, su.pseudonym as seller_pseudonym,
            bk.encrypted_legal_name as buyer_encrypted_legal_name
     from orders o
     join users bu on bu.id = o.buyer_id
     join users su on su.id = o.seller_id
     left join vault.kyc_vault bk on bk.user_id = o.buyer_id
     where o.id = $1`,
    [orderId]
  );
  const order = orderResult.rows[0];
  if (!order) return null;

  const chatResult = await pool.query(
    `select m.id, u.pseudonym as sender_pseudonym, m.body, m.created_at
     from order_chat_messages m
     join users u on u.id = m.sender_id
     where m.order_id = $1
     order by m.created_at asc
     limit 100`,
    [orderId]
  );

  return {
    id: order.id,
    status: order.status,
    asset: order.asset,
    fiatCurrency: order.fiat_currency,
    assetAmount: order.asset_amount,
    fiatAmount: order.fiat_amount,
    price: order.price,
    buyerPseudonym: order.buyer_pseudonym,
    sellerPseudonym: order.seller_pseudonym,
    buyerVerifiedNameForSeller: decodeVaultName(order.buyer_encrypted_legal_name),
    paymentDeadline: order.payment_deadline.toISOString(),
    lastEventId: Number(order.last_event_id),
    flaggedPaymentNameMismatch: order.flagged_payment_name_mismatch,
    riskLevel: order.risk_level,
    sellerSecurityAlert: order.flagged_payment_name_mismatch
      ? "Warning: Input sender name mismatch. Verify bank statement thoroughly before releasing."
      : undefined,
    chat: chatResult.rows.map((row) => ({
      id: row.id,
      senderPseudonym: row.sender_pseudonym,
      body: row.body,
      createdAt: row.created_at.toISOString()
    }))
  };
}

export async function syncOrder(orderId: string, sinceEventId: number) {
  const snapshot = await getOrderSnapshot(orderId);
  const events = await pool.query(
    `select id, event_type, to_status, payload, created_at
     from order_events
     where order_id = $1 and id > $2
     order by id asc`,
    [orderId, sinceEventId]
  );
  return { snapshot, events: events.rows };
}

export async function addChatMessage(orderId: string, senderId: string, body: string) {
  const result = await pool.query(
    `insert into order_chat_messages(order_id, sender_id, body) values ($1,$2,$3) returning id, created_at`,
    [orderId, senderId, body]
  );
  await redis.del(`order:${orderId}`);
  await publishOrder(orderId, "CHAT_MESSAGE", { id: result.rows[0].id, senderId, body, createdAt: result.rows[0].created_at });
  return result.rows[0];
}

export async function listAds() {
  const result = await pool.query(
    `select a.*, u.pseudonym, u.completion_rate, u.average_release_seconds
     from ads a
     join users u on u.id = a.seller_id
     where a.status = 'ACTIVE' and a.available_amount > 0
     order by a.price asc
     limit 50`
  );
  return result.rows.map((row) => ({
    id: row.id,
    merchantPseudonym: row.pseudonym,
    asset: row.asset,
    fiatCurrency: row.fiat_currency,
    price: row.price,
    availableAmount: row.available_amount,
    minAmount: row.min_amount,
    maxAmount: row.max_amount,
    paymentMethods: ["Bank Transfer"],
    completionRate: Number(row.completion_rate),
    averageReleaseSeconds: Number(row.average_release_seconds)
  }));
}

export async function createAd(input: unknown) {
  const schema = z.object({
    sellerId: z.string().uuid(),
    asset: z.enum(["USDT", "USDC"]),
    fiatCurrency: z.enum(["NGN", "USD", "GHS", "KES", "ZAR"]),
    price: z.coerce.number().positive(),
    availableAmount: z.coerce.number().positive(),
    minAmount: z.coerce.number().positive(),
    maxAmount: z.coerce.number().positive(),
    terms: z.string().max(1000).optional()
  });
  const body = schema.parse(input);
  const seller = await pool.query("select kyc_status from users where id = $1", [body.sellerId]);
  if (seller.rows[0]?.kyc_status !== "VERIFIED") throw new Error("Seller KYC is not verified");
  const result = await pool.query(
    `insert into ads(seller_id, asset, fiat_currency, price, available_amount, min_amount, max_amount, terms)
     values ($1,$2,$3,$4,$5,$6,$7,$8)
     returning *`,
    [body.sellerId, body.asset, body.fiatCurrency, body.price, body.availableAmount, body.minAmount, body.maxAmount, body.terms ?? null]
  );
  return result.rows[0];
}

export async function disclosureExport(masterKey: string | undefined, orderId: string) {
  if (!masterKey || masterKey !== process.env.DISCLOSURE_MASTER_KEY) throw new Error("Unauthorized disclosure request");
  const result = await pool.query(
    `select o.*, bu.email as buyer_email, su.email as seller_email, bk.legal_name_hash as buyer_legal_name_hash,
            sk.legal_name_hash as seller_legal_name_hash
     from orders o
     join users bu on bu.id = o.buyer_id
     join users su on su.id = o.seller_id
     left join vault.kyc_vault bk on bk.user_id = o.buyer_id
     left join vault.kyc_vault sk on sk.user_id = o.seller_id
     where o.id = $1`,
    [orderId]
  );
  await pool.query(
    `insert into audit_logs(action, target_type, target_id, payload)
     values ('COMPLIANCE_DISCLOSURE_EXPORT','order',$1,$2)`,
    [orderId, JSON.stringify({ reason: "master-key export" })]
  );
  return result.rows[0] ?? null;
}
