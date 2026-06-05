import { z } from "zod";

export const ASSETS = ["USDT", "USDC"] as const;
export const FIAT_CURRENCIES = ["NGN", "USD", "GHS", "KES", "ZAR"] as const;

export const ORDER_STATUSES = [
  "ORDER_CREATED",
  "ESCROW_LOCKED",
  "PAYMENT_PENDING",
  "BUYER_MARKED_PAID",
  "SELLER_RELEASE_PENDING",
  "COMPLETED",
  "CANCELLED_EXPIRED",
  "CANCELLED_BY_BUYER_BEFORE_PAYMENT",
  "DISPUTED",
  "RESOLVED_RELEASED_TO_BUYER",
  "RESOLVED_RETURNED_TO_SELLER",
  "FROZEN_COMPLIANCE_REVIEW"
] as const;

export type Asset = (typeof ASSETS)[number];
export type FiatCurrency = (typeof FIAT_CURRENCIES)[number];
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const createOrderSchema = z.object({
  adId: z.string().uuid(),
  buyerId: z.string().uuid(),
  assetAmount: z.coerce.number().positive()
});

export const markPaidSchema = z.object({
  buyerId: z.string().uuid(),
  sourceAccountName: z.string().min(2).max(160),
  receiptUrl: z.string().url().optional(),
  noThirdPartyPayment: z.literal(true)
});

export const releaseOrderSchema = z.object({
  sellerId: z.string().uuid(),
  pin: z.string().min(4).max(12)
});

export const cancelOrderSchema = z.object({
  userId: z.string().uuid()
});

export const disputeOrderSchema = z.object({
  userId: z.string().uuid(),
  reason: z.string().min(5).max(500)
});

export type PublicAd = {
  id: string;
  merchantPseudonym: string;
  asset: Asset;
  fiatCurrency: FiatCurrency;
  price: string;
  availableAmount: string;
  minAmount: string;
  maxAmount: string;
  paymentMethods: string[];
  completionRate: number;
  averageReleaseSeconds: number;
};

export type OrderSnapshot = {
  id: string;
  status: OrderStatus;
  asset: Asset;
  fiatCurrency: FiatCurrency;
  assetAmount: string;
  fiatAmount: string;
  price: string;
  buyerPseudonym: string;
  sellerPseudonym: string;
  buyerVerifiedNameForSeller: string;
  paymentDeadline: string;
  lastEventId: number;
  flaggedPaymentNameMismatch: boolean;
  riskLevel: "NORMAL" | "HIGH_RISK_SUSPECTED";
  sellerSecurityAlert?: string;
  chat: Array<{
    id: string;
    senderPseudonym: string;
    body: string;
    createdAt: string;
  }>;
};

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  const allowed: Record<OrderStatus, OrderStatus[]> = {
    ORDER_CREATED: ["ESCROW_LOCKED", "CANCELLED_EXPIRED"],
    ESCROW_LOCKED: ["PAYMENT_PENDING", "CANCELLED_EXPIRED"],
    PAYMENT_PENDING: ["BUYER_MARKED_PAID", "CANCELLED_BY_BUYER_BEFORE_PAYMENT", "CANCELLED_EXPIRED"],
    BUYER_MARKED_PAID: ["SELLER_RELEASE_PENDING", "DISPUTED"],
    SELLER_RELEASE_PENDING: ["COMPLETED", "DISPUTED"],
    COMPLETED: [],
    CANCELLED_EXPIRED: [],
    CANCELLED_BY_BUYER_BEFORE_PAYMENT: [],
    DISPUTED: ["RESOLVED_RELEASED_TO_BUYER", "RESOLVED_RETURNED_TO_SELLER", "FROZEN_COMPLIANCE_REVIEW"],
    RESOLVED_RELEASED_TO_BUYER: [],
    RESOLVED_RETURNED_TO_SELLER: [],
    FROZEN_COMPLIANCE_REVIEW: ["RESOLVED_RELEASED_TO_BUYER", "RESOLVED_RETURNED_TO_SELLER"]
  };

  return allowed[from]?.includes(to) ?? false;
}
