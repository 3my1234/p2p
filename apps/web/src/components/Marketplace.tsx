import { ShieldCheck, Timer, Zap } from "lucide-react";
import type { PublicAd } from "@baze/shared";

type Props = {
  ads: PublicAd[];
  amount: number;
  setAmount: (value: number) => void;
  onBuy: (ad: PublicAd) => void;
};

export function Marketplace({ ads, amount, setAmount, onBuy }: Props) {
  return (
    <section className="space-y-3">
      <div className="toolbar">
        <div>
          <p className="label">Buy USDT</p>
          <h1>BAZE P2P</h1>
        </div>
        <div className="status-pill">
          <Zap size={16} />
          Live
        </div>
      </div>

      <div className="amount-row">
        <label htmlFor="amount">Amount</label>
        <input id="amount" type="number" min="1" value={amount} onChange={(event) => setAmount(Number(event.target.value))} />
      </div>

      <div className="trust-strip">
        <span>
          <ShieldCheck size={16} /> KYC gated
        </span>
        <span>
          <Timer size={16} /> 15 min payment window
        </span>
      </div>

      <div className="ad-list">
        {ads.map((ad) => (
          <article className="ad-card" key={ad.id}>
            <div className="ad-top">
              <div>
                <strong>{ad.merchantPseudonym}</strong>
                <p>{ad.completionRate}% completion</p>
              </div>
              <span className="price">{Number(ad.price).toLocaleString()} {ad.fiatCurrency}</span>
            </div>
            <div className="ad-meta">
              <span>{ad.availableAmount} {ad.asset}</span>
              <span>{ad.minAmount}-{ad.maxAmount} {ad.asset}</span>
              <span>{ad.averageReleaseSeconds || 45}s avg release</span>
            </div>
            <button onClick={() => onBuy(ad)}>Buy</button>
          </article>
        ))}
      </div>
    </section>
  );
}

