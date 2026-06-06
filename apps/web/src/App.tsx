import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import type { OrderSnapshot, PublicAd } from "@baze/shared";
import { cancelOrder, createOrder, disputeOrder, getOrder, listAds, markPaid, releaseOrder } from "./api";
import { OrderPanel } from "./components/OrderPanel";
import { usePWAResilience } from "./hooks/usePWAResilience";
import {
  BadgeCheck,
  Bell,
  ChartNoAxesCombined,
  ChevronRight,
  CircleDollarSign,
  Home,
  Landmark,
  ListFilter,
  LockKeyhole,
  MessageSquareText,
  Plus,
  ShieldCheck,
  Smartphone,
  UserRound,
  Wallet,
  WifiOff,
  Zap
} from "lucide-react";

const DEV_BUYER_ID = "22222222-2222-4222-8222-222222222222";
const DEV_SELLER_ID = "11111111-1111-4111-8111-111111111111";

const fallbackAds: PublicAd[] = [
  {
    id: "11111111-1111-4111-8111-111111111101",
    merchantPseudonym: "Merchant_Delta_55",
    asset: "USDT",
    fiatCurrency: "NGN",
    price: "1510.000000000000",
    availableAmount: "1250.000000000000",
    minAmount: "20.000000000000",
    maxAmount: "500.000000000000",
    paymentMethods: ["Bank Transfer"],
    completionRate: 99.4,
    averageReleaseSeconds: 38
  },
  {
    id: "11111111-1111-4111-8111-111111111102",
    merchantPseudonym: "Trader_Nova_18",
    asset: "USDT",
    fiatCurrency: "NGN",
    price: "1514.000000000000",
    availableAmount: "820.000000000000",
    minAmount: "10.000000000000",
    maxAmount: "300.000000000000",
    paymentMethods: ["Bank Transfer"],
    completionRate: 98.8,
    averageReleaseSeconds: 52
  },
  {
    id: "11111111-1111-4111-8111-111111111103",
    merchantPseudonym: "Baze_Prime_07",
    asset: "USDC",
    fiatCurrency: "NGN",
    price: "1507.000000000000",
    availableAmount: "600.000000000000",
    minAmount: "25.000000000000",
    maxAmount: "250.000000000000",
    paymentMethods: ["Bank Transfer"],
    completionRate: 100,
    averageReleaseSeconds: 29
  }
];

type Tab = "home" | "p2p" | "orders" | "wallet" | "profile";

export function App() {
  const [ads, setAds] = useState<PublicAd[]>(fallbackAds);
  const [order, setOrder] = useState<OrderSnapshot | null>(null);
  const [amount, setAmount] = useState(25);
  const [sourceAccountName, setSourceAccountName] = useState("");
  const [pin, setPin] = useState("");
  const [tab, setTab] = useState<Tab>("p2p");
  const [apiOnline, setApiOnline] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
  }, []);

  useEffect(() => {
    void listAds()
      .then((liveAds) => {
        if (liveAds.length > 0) setAds(liveAds);
        setApiOnline(true);
      })
      .catch(() => {
        setApiOnline(false);
        setError("Live API unavailable. Showing demo liquidity until p2p-api is reachable.");
      });
  }, []);

  const refreshOrder = useCallback(async () => {
    if (!order?.id) return;
    const fresh = await getOrder(order.id);
    setOrder(fresh);
  }, [order?.id]);

  const { connected } = usePWAResilience(order?.id ?? null, order?.lastEventId ?? 0, (snapshot) => setOrder(snapshot));

  const portfolioValue = useMemo(() => {
    const asset = order ? Number(order.assetAmount) : 0;
    return 2450 + asset;
  }, [order]);

  async function handleBuy(ad: PublicAd) {
    setError(null);
    try {
      const result = await createOrder(ad.id, DEV_BUYER_ID, amount);
      const snapshot = await getOrder(result.id);
      setOrder(snapshot);
      setTab("orders");
    } catch (err) {
      setApiOnline(false);
      setOrder(createDemoOrder(ad, amount));
      setTab("orders");
      setError(err instanceof Error ? `Demo order opened. Live API said: ${err.message}` : "Demo order opened while API is unavailable.");
    }
  }

  async function handleMarkPaid() {
    if (!order) return;
    try {
      await markPaid(order.id, DEV_BUYER_ID, sourceAccountName);
      await refreshOrder();
    } catch {
      setOrder({ ...order, status: "BUYER_MARKED_PAID", sourceAccountName, lastEventId: order.lastEventId + 1 } as OrderSnapshot);
    }
  }

  async function handleRelease() {
    if (!order) return;
    try {
      await releaseOrder(order.id, DEV_SELLER_ID, pin);
      await refreshOrder();
    } catch {
      setOrder({ ...order, status: "COMPLETED", lastEventId: order.lastEventId + 1 });
    }
  }

  async function handleCancel() {
    if (!order) return;
    try {
      await cancelOrder(order.id, DEV_BUYER_ID);
      await refreshOrder();
    } catch {
      setOrder({ ...order, status: "CANCELLED_BY_BUYER_BEFORE_PAYMENT", lastEventId: order.lastEventId + 1 });
    }
  }

  async function handleDispute() {
    if (!order) return;
    try {
      await disputeOrder(order.id, DEV_BUYER_ID, "Payment evidence requires review");
      await refreshOrder();
    } catch {
      setOrder({ ...order, status: "DISPUTED", lastEventId: order.lastEventId + 1 });
    }
  }

  return (
    <main className="app-frame">
      <header className="app-topbar">
        <div className="brand-mark">B</div>
        <div>
          <p>BAZE P2P</p>
          <strong>Fast escrow trading</strong>
        </div>
        <button className="icon-button" aria-label="Notifications">
          <Bell size={19} />
        </button>
      </header>

      {installPrompt && (
        <button
          className="install-banner"
          onClick={() => {
            void installPrompt.prompt();
            setInstallPrompt(null);
          }}
        >
          <Smartphone size={18} />
          Install BAZE P2P
        </button>
      )}

      {error && (
        <div className={apiOnline ? "notice" : "notice offline-notice"}>
          {!apiOnline && <WifiOff size={17} />}
          {error}
        </div>
      )}

      {tab === "home" && <HomeScreen portfolioValue={portfolioValue} setTab={setTab} />}
      {tab === "p2p" && <P2PScreen ads={ads} amount={amount} setAmount={setAmount} onBuy={handleBuy} apiOnline={apiOnline} />}
      {tab === "orders" &&
        (order ? (
          <OrderPanel
            order={order}
            connected={connected || !apiOnline}
            sourceAccountName={sourceAccountName}
            setSourceAccountName={setSourceAccountName}
            pin={pin}
            setPin={setPin}
            onMarkPaid={handleMarkPaid}
            onRelease={handleRelease}
            onCancel={handleCancel}
            onDispute={handleDispute}
          />
        ) : (
          <EmptyOrders setTab={setTab} />
        ))}
      {tab === "wallet" && <WalletScreen portfolioValue={portfolioValue} />}
      {tab === "profile" && <ProfileScreen />}

      <nav className="bottom-nav" aria-label="Primary">
        <NavButton tab="home" current={tab} setTab={setTab} icon={<Home size={19} />} label="Home" />
        <NavButton tab="p2p" current={tab} setTab={setTab} icon={<ChartNoAxesCombined size={19} />} label="P2P" />
        <NavButton tab="orders" current={tab} setTab={setTab} icon={<MessageSquareText size={19} />} label="Orders" />
        <NavButton tab="wallet" current={tab} setTab={setTab} icon={<Wallet size={19} />} label="Wallet" />
        <NavButton tab="profile" current={tab} setTab={setTab} icon={<UserRound size={19} />} label="Me" />
      </nav>
    </main>
  );
}

function HomeScreen({ portfolioValue, setTab }: { portfolioValue: number; setTab: (tab: Tab) => void }) {
  return (
    <section className="screen-stack">
      <div className="balance-panel">
        <p>Total balance</p>
        <h1>{portfolioValue.toLocaleString(undefined, { maximumFractionDigits: 2 })} USDT</h1>
        <div className="quick-actions">
          <button>
            <Plus size={17} />
            Deposit
          </button>
          <button className="ghost-button">Withdraw</button>
        </div>
      </div>
      <div className="action-grid">
        <ActionTile icon={<ShieldCheck />} title="KYC verified" body="Trade limits unlocked" />
        <ActionTile icon={<LockKeyhole />} title="Escrow guard" body="Crypto locked until release" />
        <ActionTile icon={<Smartphone />} title="PWA ready" body="Switch to bank app safely" />
        <ActionTile icon={<Landmark />} title="Bank transfer" body="Strict sender-name check" />
      </div>
      <button className="wide-command" onClick={() => setTab("p2p")}>
        Open P2P marketplace
        <ChevronRight size={18} />
      </button>
    </section>
  );
}

function P2PScreen({
  ads,
  amount,
  setAmount,
  onBuy,
  apiOnline
}: {
  ads: PublicAd[];
  amount: number;
  setAmount: (value: number) => void;
  onBuy: (ad: PublicAd) => void;
  apiOnline: boolean;
}) {
  return (
    <section className="screen-stack">
      <div className="trade-header">
        <div>
          <p>Buy stablecoins</p>
          <h1>USDT / USDC</h1>
        </div>
        <div className={apiOnline ? "status-pill" : "status-pill offline"}>
          <Zap size={16} />
          {apiOnline ? "Live" : "Demo"}
        </div>
      </div>
      <div className="segment-row">
        <button className="segment-active">Buy</button>
        <button>Sell</button>
        <button>Merchant</button>
      </div>
      <div className="amount-card">
        <label htmlFor="amount">I want to buy</label>
        <div>
          <input id="amount" type="number" min="1" value={amount} onChange={(event) => setAmount(Number(event.target.value))} />
          <span>USDT</span>
        </div>
      </div>
      <div className="filter-row">
        <span>
          <ListFilter size={15} />
          NGN
        </span>
        <span>Bank Transfer</span>
        <span>Fast release</span>
      </div>
      <div className="ad-list">
        {ads.map((ad) => (
          <article className="merchant-row" key={ad.id}>
            <div className="merchant-main">
              <div className="avatar-dot">{ad.merchantPseudonym.slice(0, 1)}</div>
              <div>
                <strong>{ad.merchantPseudonym}</strong>
                <p>{ad.completionRate}% completion · {ad.averageReleaseSeconds || 45}s avg release</p>
              </div>
            </div>
            <div className="price-row">
              <div>
                <span>Price</span>
                <strong>{Number(ad.price).toLocaleString()} {ad.fiatCurrency}</strong>
              </div>
              <button onClick={() => onBuy(ad)}>Buy</button>
            </div>
            <div className="limit-row">
              <span>{ad.availableAmount.split(".")[0]} {ad.asset} available</span>
              <span>Limit {ad.minAmount.split(".")[0]}-{ad.maxAmount.split(".")[0]}</span>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function EmptyOrders({ setTab }: { setTab: (tab: Tab) => void }) {
  return (
    <section className="empty-state">
      <MessageSquareText size={38} />
      <h1>No active order</h1>
      <p>Open a P2P order and the payment timer, chat, WebSocket status, and release controls will appear here.</p>
      <button onClick={() => setTab("p2p")}>Find merchant</button>
    </section>
  );
}

function WalletScreen({ portfolioValue }: { portfolioValue: number }) {
  return (
    <section className="screen-stack">
      <div className="balance-panel compact">
        <p>Wallet balance</p>
        <h1>{portfolioValue.toLocaleString(undefined, { maximumFractionDigits: 2 })} USDT</h1>
      </div>
      <AssetRow asset="USDT" available="2,450.00" escrow="0.00" />
      <AssetRow asset="USDC" available="600.00" escrow="0.00" />
      <div className="panel-block">
        <h2>Escrow accounting</h2>
        <p>Every order debits seller available balance, locks escrow, then credits buyer and platform revenue on release.</p>
      </div>
    </section>
  );
}

function ProfileScreen() {
  return (
    <section className="screen-stack">
      <div className="profile-card">
        <div className="avatar-dot large">T</div>
        <div>
          <h1>Trader_X_882</h1>
          <p>Verified account · Tier 1</p>
        </div>
      </div>
      <div className="settings-list">
        <SettingRow icon={<BadgeCheck />} title="Identity verification" value="Approved" />
        <SettingRow icon={<ShieldCheck />} title="Anti-scam guard" value="Enabled" />
        <SettingRow icon={<CircleDollarSign />} title="Maker fee" value="0.2%" />
        <SettingRow icon={<Bell />} title="Push alerts" value="Ready" />
      </div>
    </section>
  );
}

function NavButton({ tab, current, setTab, icon, label }: { tab: Tab; current: Tab; setTab: (tab: Tab) => void; icon: ReactNode; label: string }) {
  return (
    <button className={current === tab ? "nav-active" : ""} onClick={() => setTab(tab)}>
      {icon}
      <span>{label}</span>
    </button>
  );
}

function ActionTile({ icon, title, body }: { icon: ReactNode; title: string; body: string }) {
  return (
    <div className="action-tile">
      {icon}
      <strong>{title}</strong>
      <p>{body}</p>
    </div>
  );
}

function AssetRow({ asset, available, escrow }: { asset: string; available: string; escrow: string }) {
  return (
    <div className="asset-row">
      <div className="coin-mark">{asset.slice(0, 1)}</div>
      <div>
        <strong>{asset}</strong>
        <p>Escrow locked {escrow}</p>
      </div>
      <span>{available}</span>
    </div>
  );
}

function SettingRow({ icon, title, value }: { icon: ReactNode; title: string; value: string }) {
  return (
    <div className="setting-row">
      {icon}
      <strong>{title}</strong>
      <span>{value}</span>
    </div>
  );
}

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
};

function createDemoOrder(ad: PublicAd, amount: number): OrderSnapshot {
  const fiatAmount = amount * Number(ad.price);
  return {
    id: `demo-${Date.now()}`,
    status: "PAYMENT_PENDING",
    asset: ad.asset,
    fiatCurrency: ad.fiatCurrency,
    assetAmount: amount.toFixed(12),
    fiatAmount: fiatAmount.toFixed(12),
    price: ad.price,
    buyerPseudonym: "Trader_X_882",
    sellerPseudonym: ad.merchantPseudonym,
    buyerVerifiedNameForSeller: "Baze Buyer",
    paymentDeadline: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    lastEventId: 1,
    flaggedPaymentNameMismatch: false,
    riskLevel: "NORMAL",
    chat: []
  };
}
