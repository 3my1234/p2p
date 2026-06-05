# BAZE P2P Codex Implementation Prompt

You are Codex acting as a principal engineer for BAZE P2P: a fast, mobile-first, PWA-based peer-to-peer stablecoin marketplace for USDT and USDC, deployed on `sportbanter.online` using Hetzner + Coolify.

Build this as a scalable, secure, efficient production system. Do not build a generic exchange. BAZE is strictly P2P for now: users post ads, counterparties take ads, fiat moves outside the platform by bank transfer or approved payment methods, and crypto is locked by BAZE escrow until the seller confirms full fiat receipt or a dispute resolver/admin resolves the order.

## 1. Market Reference: How Binance, OKX, and Bybit P2P Work

Use these flows as the baseline:

- A merchant/seller posts an ad with asset, fiat currency, price, available quantity, min/max order size, payment methods, payment time limit, and trade terms.
- A buyer opens a trade against the ad.
- The platform locks the seller's crypto in escrow immediately, preventing double-spend or withdrawal.
- The buyer sees the seller's payment details and must transfer fiat externally within a fixed payment window.
- The buyer clicks `I have paid` only after sending fiat.
- The seller must verify the money in their bank/payment app, not only trust screenshots or chat.
- If seller confirms full receipt, seller clicks `Release`, and the escrowed crypto is credited to the buyer.
- If payment is not made, the order expires or is cancelled and crypto is returned to seller available balance.
- If buyer claims payment but seller denies receipt, the order enters dispute/appeal and crypto remains locked until resolution.
- Most major platforms strongly warn against third-party payments. The payer bank/account name should match the verified identity of the buyer, and the receiving account should match the verified identity/payment profile of the seller.

Competitor weaknesses BAZE should attack:

- Slow disputes and locked capital during appeals.
- Third-party payment scams that expose sellers to bank freezes.
- Weak payment-name verification at the moment the buyer marks paid.
- Poor mobile resilience when users switch from P2P app to banking app and back.
- Merchant onboarding that can be deposit-heavy, bureaucratic, or hostile to serious local operators.
- Limited built-in automation for pricing, risk controls, and merchant operations.

## 2. BAZE Differentiators

Implement these as first-class product requirements:

### Anti-Scam Payment Name Guard

- Every user must complete KYC before trading.
- Public ad boards must show pseudonymous trader names only, such as `Baze_Trader_8421`.
- During an active order, reveal only the minimum identity data required for payment safety.
- Buyer payment account name must match the buyer's verified KYC name or an approved business/payment profile.
- Seller receiving account name must match the seller's verified KYC name or an approved business/payment profile.
- Buyer cannot click `I have paid` until they:
  - confirm the source account name used for payment,
  - upload receipt/proof,
  - certify no third-party payment was used,
  - acknowledge that false payment claims can cause account restriction and evidence review.
- Seller release screen must clearly show:
  - expected fiat amount,
  - expected buyer legal/payment name,
  - expected reference/code if used,
  - warning: release only after confirming bank/payment app receipt from the matching name.
- Add `Flag third-party payment` and `Payment name mismatch` actions.

### Fast Dispute Triage

- Crypto remains locked during disputes.
- Build evidence collection early, not after support asks manually:
  - buyer receipt upload,
  - seller bank statement/screenshot upload,
  - payment account names,
  - timestamps,
  - chat transcript,
  - order event log.
- Implement admin dispute queue with SLA timers and structured resolution actions:
  - release to buyer,
  - return to seller,
  - request more evidence,
  - freeze account pending compliance review.
- Optional later feature: trusted merchant reviewers can provide non-final recommendations, but final release authority must stay with BAZE admins/compliance until legal and operational controls are mature.

### Merchant-Friendly Onboarding

- Do not require a massive deposit at launch.
- Use tiered limits:
  - Tier 0: KYC passed, small limits.
  - Tier 1: successful trade history, higher limits.
  - Tier 2: high completion rate and low disputes, merchant badge.
  - Tier 3: manual review, larger limits, advanced tools.
- Add rolling risk controls:
  - max open orders,
  - daily volume cap,
  - dispute-rate throttle,
  - cooling period after suspicious events,
  - ad visibility scoring.

### Built-In Merchant Automation

- Ad pricing modes:
  - fixed price,
  - market index plus/minus margin,
  - competitor-aware local spread,
  - minimum profit guard.
- Merchant dashboard:
  - open orders,
  - available/escrowed balances,
  - completion rate,
  - average release time,
  - dispute rate,
  - ad performance.

### PWA Speed and Resilience

- The app must behave well when a user switches to a bank app and returns.
- Use WebSockets for live order state, chat, and push-like updates while online.
- Use Web Push/FCM for important state changes when the browser is backgrounded.
- Add `visibilitychange`, `online`, and `focus` handlers.
- On return to foreground, immediately call a delta-sync endpoint for the active order before rendering stale state.
- The order screen must be lightweight, cached, and recoverable after reload.

## 3. Correct Technical Architecture

Use a TypeScript modular monolith unless the existing repo dictates otherwise:

```txt
apps/
  web/        Next.js PWA frontend
  api/        Fastify or NestJS API, WebSocket gateway, workers
packages/
  db/         Prisma or Drizzle schema and migrations
  shared/     types, validation schemas, constants
  config/     environment and deployment helpers
```

Infrastructure for Coolify on Hetzner:

- PostgreSQL is the source of truth for users, balances, ledger entries, ads, orders, disputes, KYC status, and audit logs.
- Redis is used for caching, rate limiting, WebSocket presence, ephemeral locks, queues, and pub/sub. Redis must not be the only source of truth for financial state.
- Use transaction-safe balance accounting in PostgreSQL. Never rely on client state or Redis-only state for money movement.
- Use row-level locks or serializable/repeatable-read transactions for balance mutations and order transitions.
- Use idempotency keys for all order, payment, release, cancel, dispute, and webhook operations.
- Use an append-only ledger. Do not mutate balances without corresponding ledger entries.

## 4. Core Data Model

Implement tables/entities similar to:

- `users`: account identity, pseudonym, role flags, status.
- `kyc_profiles`: verification status, provider reference, verified legal name hash/reference, country, risk tier. Store sensitive KYC data encrypted or in provider vault where possible.
- `payment_methods`: user-owned payment accounts, account holder name, bank/payment provider, masked account number, verification status.
- `wallet_accounts`: user balances by asset.
- `ledger_entries`: append-only debits/credits with asset, amount, reason, order id, idempotency key.
- `ads`: maker ads with asset, fiat, side, price mode, price, limits, terms, payment methods, status.
- `orders`: taker order with ad, buyer, seller, asset amount, fiat amount, status, timers, escrow fields.
- `order_events`: append-only state transition log.
- `order_chat_messages`: active order chat.
- `payment_proofs`: receipt uploads and parsed metadata.
- `disputes`: dispute state, reason, SLA, assigned admin, resolution.
- `audit_logs`: admin/compliance actions.
- `push_subscriptions`: PWA push endpoints/tokens.
- `risk_signals`: velocity, mismatch, chargeback/freeze reports, abnormal patterns.

## 5. Required Order State Machine

Use explicit states. Do not allow skipping states.

```txt
AD_OPEN
ORDER_CREATED
ESCROW_LOCKED
PAYMENT_PENDING
BUYER_MARKED_PAID
SELLER_RELEASE_PENDING
COMPLETED
CANCELLED_EXPIRED
CANCELLED_BY_BUYER_BEFORE_PAYMENT
DISPUTED
RESOLVED_RELEASED_TO_BUYER
RESOLVED_RETURNED_TO_SELLER
FROZEN_COMPLIANCE_REVIEW
```

### Buy Flow

1. Buyer selects a sell ad.
2. API validates buyer KYC, ad availability, limits, risk score, and payment method compatibility.
3. API starts a database transaction:
   - lock ad row,
   - lock seller wallet row,
   - ensure seller available balance covers amount,
   - debit seller available balance,
   - credit seller escrow balance,
   - create ledger entries,
   - create order,
   - write order event.
4. Notify seller immediately through WebSocket and push notification.
5. Buyer sees seller payment details and countdown.
6. Buyer sends fiat outside BAZE.
7. Buyer marks paid with source account name and receipt.
8. API validates the source account name against verified payment/KYC profile. If mismatch, allow submission only into flagged state requiring seller/admin caution.
9. Notify seller.
10. Seller checks bank/payment app.
11. Seller releases only after full receipt from expected name.
12. API starts a database transaction:
   - lock order,
   - lock buyer and seller wallet rows,
   - ensure order is releasable,
   - debit seller escrow balance,
   - credit buyer available balance,
   - credit BAZE fee/treasury if configured,
   - create ledger entries,
   - mark order completed,
   - write order event.
13. Notify both parties.

### Expiry/Cancel

- Buyer can cancel only before marking paid.
- If payment window expires before `BUYER_MARKED_PAID`, return escrow to seller.
- Once buyer marks paid, buyer cannot cancel without dispute/admin workflow.

### Dispute

- Either party can open dispute after buyer marks paid or after seller claims mismatch/non-receipt.
- Lock order from release/cancel until admin resolution.
- Preserve all evidence and chat.
- Admin resolution must create ledger entries and audit logs.

## 6. Fees and Profit Model

Implement fee configuration, but make it flexible:

- Launch option: zero taker fee and small maker fee on completed trades.
- Alternative: maker/taker percentage by fiat zone and merchant tier.
- Premium merchant subscription for automation, higher limits, and faster dispute SLA.
- Withdrawal fees or network fee pass-through for on-chain transfers.
- Do not take spread silently unless BAZE is acting as principal. In P2P marketplace mode, fees should be explicit.

Fee accounting:

- Fees are charged only on completed trades unless a specific penalty is documented.
- Fee ledger entries must credit a BAZE treasury account.
- Show fees clearly before order confirmation.

## 7. KYC, Privacy, and Legal Disclosure Rules

Mandatory KYC is a risk control, not a guarantee against fraud.

Build privacy-by-design:

- Public marketplace never exposes legal names, documents, phone numbers, emails, or full payment account data.
- Active trade reveals only what is necessary for payment verification.
- Sensitive KYC data must be encrypted, access-controlled, and audited.
- Customer identity should not be released to counterparties except where required for the payment transaction and platform rules.

But do not promise identity can never be released:

- Add legal/compliance process for law enforcement requests, court orders, sanctions inquiries, fraud investigations, and regulator requests.
- Admin access to KYC data must require elevated permission and produce audit logs.
- Terms must say BAZE may preserve, freeze, disclose, or provide information where legally required or to investigate fraud/abuse.

Add compliance TODOs:

- Get Nigerian and target-market legal advice before launch.
- Review whether BAZE is a VASP, money service business, payment intermediary, or crypto asset service provider in each market.
- Implement AML/sanctions screening appropriate to operating countries.
- Add suspicious activity reporting workflow if required by law.

## 8. Security Requirements

- Passwordless/auth provider or secure auth with MFA.
- Mandatory MFA for merchants and admins.
- Signed upload URLs for evidence files.
- Malware/file type checks for uploaded receipts.
- Rate limits on auth, order creation, chat, upload, mark-paid, release, and dispute endpoints.
- Admin RBAC with least privilege.
- Device/session management.
- Withdrawal address allowlisting if withdrawals exist.
- Immutable audit log for admin actions.
- Idempotent APIs and optimistic UI rollback.
- Never allow client to submit final ledger amounts without server recomputation.

## 9. API Deliverables

Implement endpoints or route handlers for:

- `POST /auth/...`
- `GET /p2p/ads`
- `POST /p2p/ads`
- `PATCH /p2p/ads/:id`
- `POST /p2p/orders`
- `GET /p2p/orders/:id`
- `GET /p2p/orders/:id/sync?sinceEventId=...`
- `POST /p2p/orders/:id/mark-paid`
- `POST /p2p/orders/:id/release`
- `POST /p2p/orders/:id/cancel`
- `POST /p2p/orders/:id/dispute`
- `POST /p2p/orders/:id/chat`
- `GET /merchant/dashboard`
- `GET /admin/disputes`
- `POST /admin/disputes/:id/resolve`
- `GET /admin/audit`

WebSocket channels:

- `order:{orderId}` for order state and chat.
- `user:{userId}` for private notifications.
- `merchant:{merchantId}` for dashboard/order queue updates.

## 10. Frontend Deliverables

Build a polished mobile-first PWA:

- Installable PWA manifest and service worker.
- Fast ad list with filters: buy/sell, asset, fiat, amount, payment method, merchant tier.
- Order detail screen optimized for the exact P2P flow.
- Seller release screen with strong anti-scam warnings and expected payer details.
- Buyer payment screen with countdown, payment details, receipt upload, and mark-paid barrier.
- Merchant dashboard.
- Dispute/evidence upload UI.
- Admin dispute UI if admin scope is included.
- Foreground delta-sync hook:

```ts
useEffect(() => {
  const sync = () => {
    if (document.visibilityState === "visible") {
      syncActiveOrderDelta();
      reconnectOrderSocket();
    }
  };
  document.addEventListener("visibilitychange", sync);
  window.addEventListener("focus", sync);
  window.addEventListener("online", sync);
  return () => {
    document.removeEventListener("visibilitychange", sync);
    window.removeEventListener("focus", sync);
    window.removeEventListener("online", sync);
  };
}, [activeOrderId]);
```

## 11. Performance Targets

- Marketplace first load: under 2 seconds on mid-range mobile after cache warmup.
- Order state transitions: server response normally under 300ms on Hetzner.
- WebSocket fanout: near-real-time under normal load.
- No blocking image-heavy UI on order screens.
- Use pagination/cursor loading for ads and chat.
- Use database indexes for ad search, order status, user active orders, and dispute queues.
- Background workers for notifications, receipt parsing, risk scoring, and non-critical tasks.

## 12. Testing Requirements

Write tests for:

- escrow lock cannot exceed seller available balance,
- concurrent buyers cannot take the same ad liquidity twice,
- buyer cannot cancel after marking paid,
- seller cannot release before buyer marks paid unless admin override exists,
- release is idempotent,
- expired unpaid order returns escrow,
- disputed order cannot be released by normal seller action,
- ledger remains balanced after every state transition,
- third-party payment mismatch creates risk flag,
- foreground sync updates stale PWA state.

## 13. Implementation Rules

- Read the existing repo structure first and follow its framework choices.
- If no repo exists, scaffold a TypeScript monorepo suitable for Coolify deployment.
- Use PostgreSQL as financial source of truth.
- Use Redis for speed, not financial truth.
- Use server-side validation schemas.
- Keep sensitive data out of public routes.
- Prefer simple, reliable architecture over premature microservices.
- Document environment variables and Coolify deployment steps.
- Include seed data for local P2P testing.
- Include a minimal admin user creation path.
- Do not implement fake “AI receipt parsing” as a black box. If receipt parsing is not ready, build manual review plus metadata extraction placeholders.

## 14. First Milestone Scope

Build MVP v1 in this order:

1. Auth, KYC status gates, pseudonymous profiles.
2. Wallet balances and append-only ledger.
3. Ads and marketplace filters.
4. Order creation with escrow lock.
5. Buyer payment flow and mark-paid proof upload.
6. Seller release flow.
7. Expiry/cancel worker.
8. WebSocket order updates and PWA foreground sync.
9. Dispute queue and admin resolution.
10. Merchant dashboard and tier limits.

Do not move to advanced automation until the escrow ledger, order state machine, and dispute flow are correct.

