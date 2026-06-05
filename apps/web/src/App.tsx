import { useCallback, useEffect, useState } from "react";
import type { OrderSnapshot, PublicAd } from "@baze/shared";
import { cancelOrder, createOrder, disputeOrder, getOrder, listAds, markPaid, releaseOrder } from "./api";
import { Marketplace } from "./components/Marketplace";
import { OrderPanel } from "./components/OrderPanel";
import { usePWAResilience } from "./hooks/usePWAResilience";

const DEV_BUYER_ID = "22222222-2222-4222-8222-222222222222";
const DEV_SELLER_ID = "11111111-1111-4111-8111-111111111111";

export function App() {
  const [ads, setAds] = useState<PublicAd[]>([]);
  const [order, setOrder] = useState<OrderSnapshot | null>(null);
  const [amount, setAmount] = useState(25);
  const [sourceAccountName, setSourceAccountName] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void listAds().then(setAds).catch((err) => setError(err.message));
  }, []);

  const refreshOrder = useCallback(async () => {
    if (!order?.id) return;
    const fresh = await getOrder(order.id);
    setOrder(fresh);
  }, [order?.id]);

  const { connected } = usePWAResilience(order?.id ?? null, order?.lastEventId ?? 0, (snapshot) => setOrder(snapshot));

  async function handleBuy(ad: PublicAd) {
    setError(null);
    try {
      const result = await createOrder(ad.id, DEV_BUYER_ID, amount);
      const snapshot = await getOrder(result.id);
      setOrder(snapshot);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Order failed");
    }
  }

  async function handleMarkPaid() {
    if (!order) return;
    await markPaid(order.id, DEV_BUYER_ID, sourceAccountName);
    await refreshOrder();
  }

  async function handleRelease() {
    if (!order) return;
    await releaseOrder(order.id, DEV_SELLER_ID, pin);
    await refreshOrder();
  }

  async function handleCancel() {
    if (!order) return;
    await cancelOrder(order.id, DEV_BUYER_ID);
    await refreshOrder();
  }

  async function handleDispute() {
    if (!order) return;
    await disputeOrder(order.id, DEV_BUYER_ID, "Payment evidence requires review");
    await refreshOrder();
  }

  return (
    <main>
      {error && <div className="toast">{error}</div>}
      {!order ? (
        <Marketplace ads={ads} amount={amount} setAmount={setAmount} onBuy={handleBuy} />
      ) : (
        <OrderPanel
          order={order}
          connected={connected}
          sourceAccountName={sourceAccountName}
          setSourceAccountName={setSourceAccountName}
          pin={pin}
          setPin={setPin}
          onMarkPaid={handleMarkPaid}
          onRelease={handleRelease}
          onCancel={handleCancel}
          onDispute={handleDispute}
        />
      )}
    </main>
  );
}
