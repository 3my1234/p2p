import { createHash, randomInt } from "node:crypto";
import { signupSchema, type UserSession } from "@baze/shared";
import { pool, withTransaction } from "../db.js";

function normalizeName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function pseudonym(): string {
  return `Trader_${randomInt(10000, 99999)}`;
}

export async function signup(input: unknown): Promise<UserSession> {
  const body = signupSchema.parse(input);
  const normalizedName = normalizeName(body.legalName);
  const legalNameHash = sha256(normalizedName);
  const passcodeHash = sha256(body.passcode);

  const user = await withTransaction("SERIALIZABLE", async (client) => {
    const existing = await client.query("select id from users where email = $1", [body.email.toLowerCase()]);
    if (existing.rows[0]) throw new Error("Account already exists");

    let created;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const handle = pseudonym();
      try {
        const result = await client.query(
          `insert into users(email, pseudonym, password_hash, kyc_status, trade_pin_hash, is_mfa_enabled)
           values ($1,$2,$3,'VERIFIED',$4,true)
           returning id, email, pseudonym, kyc_status`,
          [body.email.toLowerCase(), handle, passcodeHash, passcodeHash]
        );
        created = result.rows[0];
        break;
      } catch (error) {
        if (attempt === 4) throw error;
      }
    }

    if (!created) throw new Error("Could not create account");

    await client.query(
      `insert into vault.kyc_vault(user_id, encrypted_legal_name, legal_name_hash, legal_name_match_key, country_code)
       values ($1, convert_to($2, 'UTF8'), $3, $4, $5)`,
      [created.id, body.legalName.trim(), legalNameHash, normalizedName, body.countryCode.toUpperCase()]
    );

    await client.query(
      `insert into wallet_accounts(user_id, asset, available_balance, escrow_balance)
       values ($1,'USDT',0,0), ($1,'USDC',0,0)
       on conflict(user_id, asset) do nothing`,
      [created.id]
    );

    return created;
  });

  return getSession(user.id);
}

export async function getSession(userId: string): Promise<UserSession> {
  const result = await pool.query("select id, email, pseudonym, kyc_status from users where id = $1", [userId]);
  const user = result.rows[0];
  if (!user) throw new Error("User not found");

  const wallets = await pool.query(
    `select asset, available_balance, escrow_balance
     from wallet_accounts
     where user_id = $1
     order by asset desc`,
    [userId]
  );

  return {
    id: user.id,
    email: user.email,
    pseudonym: user.pseudonym,
    kycStatus: user.kyc_status,
    wallets: wallets.rows.map((row) => ({
      asset: row.asset,
      availableBalance: row.available_balance,
      escrowBalance: row.escrow_balance
    }))
  };
}
