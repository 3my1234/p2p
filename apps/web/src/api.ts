import type { OrderSnapshot, PublicAd } from "@baze/shared";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8080";
export const WS_URL = import.meta.env.VITE_WS_URL ?? "ws://localhost:8080/ws";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {})
    }
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(error.error ?? response.statusText);
  }
  return response.json() as Promise<T>;
}

export function listAds() {
  return request<PublicAd[]>("/api/v1/p2p/ads");
}

export function createOrder(adId: string, buyerId: string, assetAmount: number) {
  return request<{ id: string }>("/api/v1/p2p/orders", {
    method: "POST",
    body: JSON.stringify({ adId, buyerId, assetAmount })
  });
}

export function getOrder(id: string) {
  return request<OrderSnapshot>(`/api/v1/p2p/orders/${id}`);
}

export function syncOrder(id: string, sinceEventId: number) {
  return request<{ snapshot: OrderSnapshot | null; events: unknown[] }>(`/api/v1/trades/${id}/sync?sinceEventId=${sinceEventId}`);
}

export function markPaid(id: string, buyerId: string, sourceAccountName: string, receiptUrl?: string) {
  return request(`/api/v1/p2p/orders/${id}/mark-paid`, {
    method: "POST",
    body: JSON.stringify({ buyerId, sourceAccountName, receiptUrl, noThirdPartyPayment: true })
  });
}

export function releaseOrder(id: string, sellerId: string, pin: string) {
  return request(`/api/v1/p2p/orders/${id}/release`, {
    method: "POST",
    body: JSON.stringify({ sellerId, pin })
  });
}

export function cancelOrder(id: string, userId: string) {
  return request(`/api/v1/p2p/orders/${id}/cancel`, {
    method: "POST",
    body: JSON.stringify({ userId })
  });
}

export function disputeOrder(id: string, userId: string, reason: string) {
  return request(`/api/v1/p2p/orders/${id}/dispute`, {
    method: "POST",
    body: JSON.stringify({ userId, reason })
  });
}
