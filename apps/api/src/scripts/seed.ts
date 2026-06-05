import { createHash } from "node:crypto";
import { pool } from "../db.js";

function hashName(name: string) {
  return createHash("sha256")
    .update(
      name
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-zA-Z0-9 ]/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase()
    )
    .digest("hex");
}

const sellerId = "11111111-1111-4111-8111-111111111111";
const buyerId = "22222222-2222-4222-8222-222222222222";

const seller = await pool.query(
  `insert into users(id, email, pseudonym, kyc_status, trade_pin_hash, is_mfa_enabled)
   values ($1, 'merchant@sportbanter.online','Merchant_77102','VERIFIED','dev-pin',true)
   on conflict(email) do update set kyc_status = 'VERIFIED'
   returning id`,
  [sellerId]
);
const buyer = await pool.query(
  `insert into users(id, email, pseudonym, kyc_status, trade_pin_hash, is_mfa_enabled)
   values ($1, 'buyer@sportbanter.online','Trader_X_882','VERIFIED','dev-pin',true)
   on conflict(email) do update set kyc_status = 'VERIFIED'
   returning id`,
  [buyerId]
);

await pool.query(
  `insert into vault.kyc_vault(user_id, encrypted_legal_name, legal_name_hash, legal_name_match_key, country_code)
   values ($1, convert_to('Baze Merchant','UTF8'), $2, 'baze merchant', 'NG')
   on conflict(user_id) do nothing`,
  [sellerId, hashName("Baze Merchant")]
);
await pool.query(
  `insert into vault.kyc_vault(user_id, encrypted_legal_name, legal_name_hash, legal_name_match_key, country_code)
   values ($1, convert_to('Baze Buyer','UTF8'), $2, 'baze buyer', 'NG')
   on conflict(user_id) do nothing`,
  [buyerId, hashName("Baze Buyer")]
);
await pool.query(
  `insert into payment_methods(user_id, label, provider, account_holder_name, account_holder_name_hash, masked_account_number, payment_instructions, is_verified)
   values ($1,'Primary Bank','Bank Transfer','Baze Merchant',$2,'1234****90','Transfer exact amount only from your verified account name.',true)
   on conflict do nothing`,
  [sellerId, hashName("Baze Merchant")]
);
await pool.query(
  `insert into wallet_accounts(user_id, asset, available_balance, escrow_balance)
   values ($1,'USDT',1000,0), ($2,'USDT',0,0)
   on conflict(user_id, asset) do update set available_balance = excluded.available_balance`,
  [sellerId, buyerId]
);
await pool.query(
  `insert into platform_treasury_accounts(asset, balance)
   values ('USDT',0), ('USDC',0)
   on conflict(asset) do nothing`
);
await pool.query(
  `insert into ads(seller_id, asset, fiat_currency, price, available_amount, min_amount, max_amount, terms)
   values ($1,'USDT','NGN',1510,500,10,250,'No third-party payment. Sender name must match verified BAZE identity.')
   on conflict do nothing`,
  [sellerId]
);

await pool.end();
console.log({ sellerId, buyerId });
