# Trading Bot – Scope of Changes (Phase 2)

**Document version:** 1.0  
**Quoted price:** ₹10,000 (INR)  
**Valid for:** P2PB2B / BRIL trading bot enhancements  

---

## Overview

This document lists the changes and new behaviour to be implemented in the existing trading bot. All items are based on the client’s requirements to improve quote defence, liquidity management, and automation.

---

## 1. Defence & Immediate Execution

### 1.1 Buy any sell below our sell price
- **Requirement:** If any order on the book is selling BRIL **below** the bot’s current sell price, the bot must **buy that offer immediately** (market or aggressive limit).
- **Reason:** Prevents others from undercutting our sell and taking our flow or tokens.

### 1.2 Sell to any buy above our buy price
- **Requirement:** If any order on the book is buying BRIL **above** the bot’s current buy price, the bot must **sell to that bid immediately**.
- **Reason:** Captures better prices and prevents others from taking margin above our bid.

---

## 2. Buy-side replenishment

### 2.1 Replace and ladder after our buy is hit
- **Requirement:** When someone sells to our buy (our buy order gets filled), the bot must place **at least 3 buy orders** within a few seconds:
  - Same price as the last buy that was filled, and  
  - Additional buys at **0.01 price step below** (e.g. last buy price, last buy −0.01, last buy −0.02).
- **Reason:** Keeps buy-side liquidity so we keep accumulating at our levels.

---

## 3. Reserve & stop rules

### 3.1 USDT reserve and stop when exhausted
- **Requirement:** Keep a **reserve of 25 USDT**. Do not use this for new buy orders.
- **Requirement:** When available USDT (after reserve) is not enough to place or maintain buys, **stop placing new buy orders** and/or pause the buy side of the bot.
- **Reason:** Avoids overcommitting and keeps a safety buffer.

### 3.2 BRIL reserve
- **Requirement:** Keep a **reserve of 25 BRIL**. This balance is not used for new sell orders.
- **Reason:** Ensures a minimum BRIL holding before automating sells.

---

## 4. Automated sell ladder (excess BRIL)

### 4.1 Sell ladder above our sell price
- **Requirement:** For BRIL balance **above the 25 BRIL reserve**, place sell orders in a ladder **0.01 above** the bot’s current sell price.
  - Example: If our sell price is 2.00, place sells at 2.01, 2.02, 2.03, etc.
- **Requirement:** Quantity per level: between 1 and 100 BRIL (exact min/max to be confirmed with client).
- **Reason:** Automatically lists excess BRIL at improving prices so we don’t leave value on the table.

---

## 5. Automated buy ladder (excess USDT)

### 5.1 Buy ladder below our sell price
- **Requirement:** For USDT **above the 25 USDT reserve**, place buy orders at **2% to 10% below** the bot’s current **sell price** (e.g. if sell is 2.00, buys in the range 1.80–1.96).
- **Requirement:** All such buys are based on the bot’s own sell price, not external data.
- **Reason:** Uses spare USDT to accumulate BRIL at a discount to our sell level.

---

## 6. Price reference (our prices)

### 6.1 All logic based on bot’s own orders
- **Requirement:** “Our buy price” and “Our sell price” are defined only from the **orders placed by this bot** (e.g. last placed buy price, last placed sell price).
- **Requirement:** Sweeps, ladders, and replenishment all use these prices; no unrelated or random prices.
- **Reason:** Consistent and predictable behaviour; no conflict with external or manual orders.

---

## 7. Summary of deliverables

| # | Deliverable | Description |
|---|-------------|-------------|
| 1 | Order book monitoring | Monitor order book (and/or fills) to detect our prices and others’ orders. |
| 2 | Sweep – buy below our sell | When someone sells below our sell price → buy immediately. |
| 3 | Sweep – sell above our buy | When someone buys above our buy price → sell immediately. |
| 4 | Buy replenishment | When our buy is filled → place ≥3 buys (same price + 0.01 steps). |
| 5 | USDT reserve (25) + stop | Reserve 25 USDT; stop new buys when USDT for buying is exhausted. |
| 6 | BRIL reserve (25) | Reserve 25 BRIL; only excess is used for sell ladder. |
| 7 | Sell ladder | Excess BRIL → sell at +0.01 ladder above our sell (e.g. 2.01, 2.02, …). |
| 8 | Buy ladder | Excess USDT → buy at 2–10% below our sell price. |
| 9 | Our-price tracking | Maintain and use “our buy price” and “our sell price” everywhere. |
| 10 | Config & testing | Configurable reserves and %; basic testing and edge-case handling. |

---

## 8. Out of scope (unless agreed separately)

- Changes to frontend/UI beyond what’s needed to support the above.
- New exchanges or new trading pairs.
- Backtesting or reporting tools.
- Guarantees on PnL or fill rates.

---

## 9. Pricing

| Item | Amount (INR) |
|------|------------------|
| **Total quoted price** | **₹10,000** |

- **Payment:** As per mutual agreement (e.g. 50% advance, 50% on delivery).
- **Revisions:** One round of minor bug fixes or small tweaks within the above scope, after first delivery.
- **Timeline:** To be agreed (typically 2–3 weeks from kick-off).

---

## 10. Acceptance

- Delivery is considered complete when the bot behaves as per sections 1–7 on the agreed environment (e.g. P2PB2B BRIL/USDT).
- Any change that adds new features or significantly changes behaviour beyond this document may be quoted separately.

---

*Document prepared for client. Scope and price valid as of the date of sharing.*
