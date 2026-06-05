import { AlertTriangle, CheckCircle2, RadioTower, ShieldAlert } from "lucide-react";
import type { OrderSnapshot } from "@baze/shared";

type Props = {
  order: OrderSnapshot;
  connected: boolean;
  sourceAccountName: string;
  setSourceAccountName: (value: string) => void;
  pin: string;
  setPin: (value: string) => void;
  onMarkPaid: () => void;
  onRelease: () => void;
  onCancel: () => void;
  onDispute: () => void;
};

export function OrderPanel(props: Props) {
  const { order, connected, sourceAccountName, setSourceAccountName, pin, setPin, onMarkPaid, onRelease, onCancel, onDispute } = props;
  const deadline = new Date(order.paymentDeadline).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  return (
    <section className="order-shell">
      <div className="toolbar">
        <div>
          <p className="label">Active order</p>
          <h1>{order.assetAmount} {order.asset}</h1>
        </div>
        <div className={connected ? "status-pill" : "status-pill offline"}>
          <RadioTower size={16} />
          {connected ? "Socket live" : "Syncing"}
        </div>
      </div>

      <div className="order-grid">
        <div>
          <span>Status</span>
          <strong>{order.status.replaceAll("_", " ")}</strong>
        </div>
        <div>
          <span>Fiat</span>
          <strong>{Number(order.fiatAmount).toLocaleString()} {order.fiatCurrency}</strong>
        </div>
        <div>
          <span>Buyer</span>
          <strong>{order.buyerPseudonym}</strong>
        </div>
        <div>
          <span>Seller</span>
          <strong>{order.sellerPseudonym}</strong>
        </div>
      </div>

      <div className="warning">
        <ShieldAlert size={18} />
        Expected payer: {order.buyerVerifiedNameForSeller}. Release only after the exact fiat amount is visible in your bank app from this verified name. Do not trust screenshots alone.
      </div>

      {order.flaggedPaymentNameMismatch && (
        <div className="danger">
          <AlertTriangle size={18} />
          {order.sellerSecurityAlert ?? "Warning: Input sender name mismatch. Verify bank statement thoroughly before releasing."}
        </div>
      )}

      <div className="panel-block">
        <h2>Buyer Payment</h2>
        <p>Payment window closes at {deadline}. Buyer must send from their verified account name.</p>
        <input
          placeholder="Source account name used for transfer"
          value={sourceAccountName}
          onChange={(event) => setSourceAccountName(event.target.value)}
        />
        <button disabled={!sourceAccountName.trim()} onClick={onMarkPaid}>
          <CheckCircle2 size={16} />
          I Have Paid
        </button>
      </div>

      <div className="panel-block">
        <h2>Seller Release</h2>
        <p>Enter secure transaction PIN after confirming full receipt in your bank app.</p>
        <input placeholder="Transaction PIN" value={pin} onChange={(event) => setPin(event.target.value)} type="password" />
        <button disabled={pin.length < 4} onClick={onRelease}>Release Crypto</button>
      </div>

      <div className="chat-terminal">
        <h2>Chat Terminal</h2>
        {order.riskLevel === "HIGH_RISK_SUSPECTED" && (
          <div className="terminal-alert">
            Warning: Input sender name mismatch. Verify bank statement thoroughly before releasing.
          </div>
        )}
        {order.chat.length === 0 ? (
          <p>No messages yet.</p>
        ) : (
          order.chat.map((message) => (
            <div className="chat-line" key={message.id}>
              <strong>{message.senderPseudonym}</strong>
              <span>{message.body}</span>
            </div>
          ))
        )}
      </div>

      <div className="actions-row">
        <button className="secondary" onClick={onCancel}>Cancel</button>
        <button className="secondary danger-button" onClick={onDispute}>Dispute</button>
      </div>
    </section>
  );
}
