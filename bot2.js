const axios = require('axios');
const crypto = require('crypto');
const P2PB2BExchange = require('./exchanges/p2pb2b');
require('dotenv').config(); // Load environment variables from .env file

class AutoTradingBot2 {
    constructor(apiKey, secretKey) {
        try {
            // Check if API keys are provided directly or should be loaded from environment variables
            const finalApiKey = apiKey || process.env.P2PB2B_API_KEY;
            const finalSecretKey = secretKey || process.env.P2PB2B_SECRET_KEY;
            
            if (!finalApiKey || !finalSecretKey) {
                throw new Error('API key and secret key are required. Please set P2PB2B_API_KEY and P2PB2B_SECRET_KEY in your .env file or pass them directly to the constructor.');
            }
            
            this.exchange = new P2PB2BExchange(finalApiKey, finalSecretKey);
            this.lastAction = 'sell';  // Start with buy since we'll flip it
            this.isShuttingDown = false;
            this.pendingOrders = new Map(); // Track orders that need matching orders
            // Track our own prices and orders for defence and ladders
            this.ourBuyPrice = null;
            this.ourSellPrice = null;
            /** Main-cycle quotes only (Step 3) — defence & replenish base; not matching/liquidity orders */
            this.ourMainBuyPrice = null;
            this.ourMainSellPrice = null;
            this.ourBuyOrderIds = new Set(); // all strategy buys we track (incl. matching buys)
            /** Only first-leg BUY action orders — replenish runs when these fill, not matching buys after SELL */
            this.ourMainBuyOrderIds = new Set();
            this.ourSellOrderIds = new Set();
            /** Replenish + buy-ladder orders — never pollute ourBuyOrderIds or ourBuyPrice (Step 2) */
            this.ourReplenishBuyOrderIds = new Set();
            /** Sell-ladder orders — do not overwrite ourSellPrice (Step 2) */
            this.ourLadderSellOrderIds = new Set();
            // Reserves: default 25; for small balances set USDT_RESERVE / BRIL_RESERVE in .env (e.g. 0 or 1)
            {
                const u = parseFloat(process.env.USDT_RESERVE ?? '25');
                const b = parseFloat(process.env.BRIL_RESERVE ?? '25');
                this.USDT_RESERVE = Number.isFinite(u) ? Math.max(0, u) : 25;
                this.BRIL_RESERVE = Number.isFinite(b) ? Math.max(0, b) : 25;
            }
            this.MIN_BUY_LADDER_ORDERS = 3;
            this.BUY_LADDER_STEP = 0.01;
            // Replenish caps (Step 1): avoid spending entire USDT in one replenish event
            // REPLENISH_BUDGET_PCT=0.2 → use at most 20% of (balance - USDT_reserve) per replenish
            // REPLENISH_MAX_LEG_USDT=50 → each ladder leg notional capped at 50 USDT
            this.REPLENISH_BUDGET_PCT = Math.min(
                1,
                Math.max(0.01, parseFloat(process.env.REPLENISH_BUDGET_PCT || '0.2'))
            );
            this.REPLENISH_MAX_LEG_USDT = Math.max(
                1,
                parseFloat(process.env.REPLENISH_MAX_LEG_USDT || '50')
            );
            // P2PB2B min_total is typically 1 USDT — legs below this are rejected or skipped
            this.MIN_NOTIONAL_USDT = Math.max(
                0.01,
                parseFloat(process.env.MIN_NOTIONAL_USDT || '1')
            );
            // When true: run checkAndReplenishBuys once per completed cycle (reduces overlap with same-cycle self-matches)
            this.REPLENISH_AFTER_CYCLE_ONLY = process.env.REPLENISH_AFTER_CYCLE_ONLY === 'true';
            // Stop the process when free USDT (after reserve) falls below threshold — client request when no USDT for buys
            this.STOP_BOT_ON_LOW_USDT = process.env.STOP_BOT_ON_LOW_USDT === 'true';
            this.MIN_FREE_USDT_TO_RUN = Math.max(
                0,
                parseFloat(process.env.MIN_FREE_USDT_TO_RUN || '1')
            );
            // Fraction of post-reserve USDT for one defence sweep (sell-side buy / buy-side sell)
            this.DEFENCE_BUDGET_PCT = Math.min(
                1,
                Math.max(0.01, parseFloat(process.env.DEFENCE_BUDGET_PCT || '0.25'))
            );

            // Add cycle tracking for random order quantities
            this.currentCycle = 0;
            this.ordersInCurrentCycle = 0;
            this.targetOrdersInCurrentCycle = 0;
            
            console.log('\n=== Bot Initialization ===');
            console.log('✓ API Keys configured');
            console.log('✓ Starting with BUY order (buy low, then sell high)');
            
            if (process.env.TEST_MODE === 'true') {
                const testBalance = parseFloat(process.env.TEST_BALANCE || '100');
                console.log('✓ Test Mode enabled');
                console.log(`✓ Test Balance: ${testBalance} USDT`);
            }
            if (this.REPLENISH_AFTER_CYCLE_ONLY) {
                console.log('✓ Replenish: after each full cycle only (REPLENISH_AFTER_CYCLE_ONLY=true)');
            }
            if (this.STOP_BOT_ON_LOW_USDT) {
                console.log(
                    `✓ Will stop bot when free USDT < ${this.MIN_FREE_USDT_TO_RUN} (after ${this.USDT_RESERVE} reserve) — STOP_BOT_ON_LOW_USDT=true`
                );
            }

            // Setup graceful shutdown
            this.setupShutdownHandlers();
        } catch (error) {
            console.error('Error initializing bot:', error.message);
            throw error;
        }
    }

    setupShutdownHandlers() {
        // Handle graceful shutdown
        const handleShutdown = async () => {
            if (this.isShuttingDown) return;
            
            console.log('\n=== Graceful Shutdown Initiated ===');
            this.isShuttingDown = true;
            
            // Check if there are any pending orders that need matching orders
            if (this.pendingOrders.size > 0) {
                console.log(`Creating matching orders for ${this.pendingOrders.size} pending orders before shutdown...`);
                
                // Create matching orders for all pending orders
                for (const [orderId, orderDetails] of this.pendingOrders.entries()) {
                    try {
                        console.log(`Creating matching order for order ID: ${orderId}`);
                        await this.createMatchingOrder(orderDetails);
                        console.log(`Successfully created matching order for order ID: ${orderId}`);
                        this.pendingOrders.delete(orderId);
                    } catch (error) {
                        console.error(`Failed to create matching order for order ID: ${orderId}`, error.message);
                    }
                }
            }
            
            console.log('Graceful shutdown complete. Exiting...');
            process.exit(0);
        };
        
        // Register shutdown handlers
        process.on('SIGINT', handleShutdown);
        process.on('SIGTERM', handleShutdown);
        process.on('exit', () => {
            if (!this.isShuttingDown) {
                console.log('\nProcess exiting without proper shutdown. Some orders may be left without matching orders.');
            }
        });
    }

    async startTrading(exchange, symbol) {
        try {
            console.log('\n=== Starting Trading Bot ===');
            console.log('Exchange:', exchange);
            console.log('Symbol:', symbol);
            console.log('Trade Amount:', process.env.TRADE_AMOUNT, 'USDT');
            
            // Start the trading cycle
            await this.executeTrade(exchange, symbol);
        } catch (error) {
            console.error('Error starting trading:', error.message);
            throw error;
        }
    }

    getRandomDelay() {
        const minMinutes = parseInt(process.env.TIME_MIN || '1');
        const maxMinutes = parseInt(process.env.TIME_MAX || '15');
        const minMs = minMinutes * 60 * 1000;
        const maxMs = maxMinutes * 60 * 1000;
        return Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
    }

    async getBalance() {
        try {
            return await this.exchange.getBalance('USDT');
        } catch (error) {
            console.error('\nError fetching wallet balance:', error.message);
            
            // If API fails and test mode is enabled, use test balance
            if (process.env.TEST_MODE === 'true') {
                const testBalance = parseFloat(process.env.TEST_BALANCE || '100');
                console.log('\nFalling back to test balance:', testBalance, 'USDT');
                return testBalance;
            }
            
            return 0;
        }
    }

    /** USDT that can actually be spent on new orders (not frozen). */
    async getSpendableUsdt() {
        try {
            if (typeof this.exchange.getAvailableBalance === 'function') {
                return await this.exchange.getAvailableBalance('USDT');
            }
        } catch (e) {
            console.error('getSpendableUsdt:', e.message);
        }
        return this.getBalance();
    }

    /** BRIL that can be sold on new orders (not frozen). */
    async getSpendableBril() {
        try {
            if (typeof this.exchange.getAvailableBalance === 'function') {
                return await this.exchange.getAvailableBalance('BRIL');
            }
        } catch (e) {
            console.error('getSpendableBril:', e.message);
        }
        try {
            return await this.exchange.getBalance('BRIL');
        } catch (e2) {
            return 0;
        }
    }

    /**
     * Split event budget across up to maxLegs orders so each leg is at least minNotional USDT when possible.
     */
    computeLegUsdBudget(totalEventBudget, maxLegs, maxLegUsd, minNotional) {
        if (totalEventBudget < minNotional) return null;
        const n = Math.min(maxLegs, Math.floor(totalEventBudget / minNotional));
        if (n < 1) return null;
        const perLeg = Math.min(totalEventBudget / n, maxLegUsd);
        if (perLeg < minNotional) return null;
        return { n, perLeg };
    }

    /** When first leg order is cancelled or replaced — keeps ourMainBuyOrderIds accurate for replenish. */
    removeFirstLegOrderTracking(action, orderId) {
        if (orderId == null) return;
        const id = String(orderId);
        if (action === 'buy') {
            this.ourMainBuyOrderIds.delete(id);
            this.ourBuyOrderIds.delete(id);
        } else if (action === 'sell') {
            this.ourSellOrderIds.delete(id);
        }
    }

    replaceFirstLegOrderId(action, oldId, newId, priceStr) {
        if (oldId == null || newId == null) return;
        const o = String(oldId);
        const n = String(newId);
        if (o === n) return;
        if (action === 'buy') {
            this.ourMainBuyOrderIds.delete(o);
            this.ourBuyOrderIds.delete(o);
            this.ourMainBuyOrderIds.add(n);
            this.ourBuyOrderIds.add(n);
            if (priceStr != null) {
                const p = parseFloat(priceStr);
                if (!Number.isNaN(p)) {
                    this.ourBuyPrice = p;
                    this.ourMainBuyPrice = p;
                }
            }
        } else if (action === 'sell') {
            this.ourSellOrderIds.delete(o);
            this.ourSellOrderIds.add(n);
            if (priceStr != null) {
                const p = parseFloat(priceStr);
                if (!Number.isNaN(p)) {
                    this.ourSellPrice = p;
                    this.ourMainSellPrice = p;
                }
            }
        }
    }

    replaceMatchingLegOrderId(matchingSide, oldId, newId) {
        if (oldId == null || newId == null) return;
        const o = String(oldId);
        const n = String(newId);
        if (o === n) return;
        if (matchingSide === 'buy') {
            this.ourBuyOrderIds.delete(o);
            this.ourBuyOrderIds.add(n);
        } else {
            this.ourSellOrderIds.delete(o);
            this.ourSellOrderIds.add(n);
        }
    }

    removeMatchingLegTracking(matchingSide, orderId) {
        if (orderId == null) return;
        const id = String(orderId);
        if (matchingSide === 'buy') {
            this.ourBuyOrderIds.delete(id);
        } else {
            this.ourSellOrderIds.delete(id);
        }
    }

    async getOrderBook(symbol) {
        try {
            // Get market price from P2PB2B
            const marketPrice = await this.exchange.getMarketPrice(symbol);
            
            if (!marketPrice || !marketPrice.bid || !marketPrice.ask) {
                throw new Error('Invalid market price data structure');
            }

            const bestBid = marketPrice.bid;
            const bestAsk = marketPrice.ask;
            const spread = ((bestAsk - bestBid) / bestBid) * 100;

            console.log('\nOrder Book Analysis:');
            console.log(`Best Bid: ${bestBid}`);
            console.log(`Best Ask: ${bestAsk}`);
            console.log(`Spread: ${spread.toFixed(2)}%`);

            return {
                bestBid,
                bestAsk
            };

        } catch (error) {
            console.error('Error fetching order book:', error.message);
            return null;
        }
    }

    async createOrder(symbol, side, amount, price) {
        try {
            console.log('\nCreating order:');
            console.log('Type:', side.toUpperCase());
            console.log('Amount:', amount);
            console.log('Price:', price);
            console.log('Total:', (parseFloat(amount) * parseFloat(price)).toFixed(8), 'USDT');

            const result = await this.exchange.createOrder(symbol, side, amount, price);
            console.log('Order created:', result);
            const orderId = result.orderId || result;

            // Update our tracked prices and order IDs for future logic
            const numericPrice = parseFloat(price);
            if (!Number.isNaN(numericPrice)) {
                if (side === 'buy') {
                    this.ourBuyPrice = numericPrice;
                    if (orderId) {
                        this.ourBuyOrderIds.add(orderId.toString());
                    }
                } else if (side === 'sell') {
                    this.ourSellPrice = numericPrice;
                    if (orderId) {
                        this.ourSellOrderIds.add(orderId.toString());
                    }
                }
            }

            return orderId;
        } catch (error) {
            console.error('Error creating order:', error.message);
            return null;
        }
    }

    /**
     * Place a buy for replenish / buy-ladder only: does NOT update ourBuyPrice or ourBuyOrderIds.
     * IDs go to ourReplenishBuyOrderIds so checkAndReplenishBuys ignores them (Step 2).
     */
    async createReplenishBuyOrder(symbol, amount, price) {
        try {
            console.log('\n[REPLENISH] Creating ladder buy (not tracked as main quote):');
            console.log('Amount:', amount);
            console.log('Price:', price);
            console.log('Total:', (parseFloat(amount) * parseFloat(price)).toFixed(8), 'USDT');

            const result = await this.exchange.createOrder(symbol, 'buy', amount, price);
            console.log('Order created:', result);
            const orderId = result.orderId || result;
            if (orderId) {
                this.ourReplenishBuyOrderIds.add(orderId.toString());
            }
            return orderId;
        } catch (error) {
            console.error('Error creating replenish buy:', error.message);
            return null;
        }
    }

    /**
     * Sell-ladder placement only: does not update ourSellPrice or ourSellOrderIds.
     */
    async createLadderSellOrder(symbol, amount, price) {
        try {
            console.log('\n[LADDER] Creating sell ladder order (not tracked as main quote):');
            console.log('Amount:', amount);
            console.log('Price:', price);
            const result = await this.exchange.createOrder(symbol, 'sell', amount, price);
            const orderId = result.orderId || result;
            if (orderId) {
                this.ourLadderSellOrderIds.add(orderId.toString());
            }
            return orderId;
        } catch (error) {
            console.error('Error creating ladder sell:', error.message);
            return null;
        }
    }

    /**
     * Check main-cycle buy orders only (first leg of a BUY action).
     * Matching buys after a SELL are not in ourMainBuyOrderIds — they do not trigger replenish.
     */
    async checkAndReplenishBuys(symbol) {
        try {
            if (this.ourMainBuyOrderIds.size === 0) {
                return;
            }

            const idsToRemove = [];
            let shouldReplenish = false;

            for (const orderId of this.ourMainBuyOrderIds) {
                const status = await this.exchange.getOrderStatus(orderId);
                if (!status || status.status === 'error') {
                    continue;
                }

                const filledPct = parseFloat(status.filled || '0');
                const remaining = parseFloat(status.remaining || status.left || '0');

                // Consider replenishing when order is basically filled or closed
                if (filledPct >= 99 || remaining === 0 || status.status === 'completed') {
                    shouldReplenish = true;
                    idsToRemove.push(orderId);
                }
            }

            idsToRemove.forEach((id) => {
                this.ourMainBuyOrderIds.delete(id);
                this.ourBuyOrderIds.delete(id);
            });

            if (shouldReplenish) {
                const base = this.ourMainBuyPrice ?? this.ourBuyPrice;
                console.log('\nDetected filled buy at our tracked price. Replenishing buy ladder...');
                await this.replenishBuys(symbol, base);
            }
        } catch (error) {
            console.error('Error in checkAndReplenishBuys:', error.message);
        }
    }

    /**
     * Place at least 3 buy orders:
     * - at basePrice
     * - at basePrice - 0.01
     * - at basePrice - 0.02
     * using available USDT above the configured reserve.
     */
    async replenishBuys(symbol, basePrice) {
        try {
            if (this.isShuttingDown) {
                console.log('Bot is shutting down, not replenishing buys');
                return;
            }

            const spendable = await this.getSpendableUsdt();
            if (!spendable || Number.isNaN(spendable)) {
                console.log('Cannot replenish buys, invalid spendable USDT');
                return;
            }

            const availableForBuys = spendable - this.USDT_RESERVE;
            if (availableForBuys <= 0) {
                console.log(`USDT available for buys (${availableForBuys}) is <= 0 after reserve, skipping replenishment`);
                return;
            }

            // Total USDT budget for this single replenish event (not whole wallet)
            const totalEventBudget = Math.min(
                availableForBuys * this.REPLENISH_BUDGET_PCT,
                availableForBuys
            );
            const legInfo = this.computeLegUsdBudget(
                totalEventBudget,
                this.MIN_BUY_LADDER_ORDERS,
                this.REPLENISH_MAX_LEG_USDT,
                this.MIN_NOTIONAL_USDT
            );
            if (!legInfo) {
                console.log(
                    `Replenish skipped: event budget ${totalEventBudget.toFixed(4)} USDT cannot split into legs ≥ ${this.MIN_NOTIONAL_USDT} USDT (min notional)`
                );
                return;
            }
            const { n: legCount, perLeg: perOrderBudget } = legInfo;

            console.log(
                `\nReplenishing buys around price ${basePrice} | spendable USDT (after reserve): ${availableForBuys.toFixed(4)} | ` +
                `event budget: ${totalEventBudget.toFixed(4)} (${(this.REPLENISH_BUDGET_PCT * 100).toFixed(0)}% of available) | ` +
                `${legCount} leg(s), ~${perOrderBudget.toFixed(4)} USDT per leg (min ${this.MIN_NOTIONAL_USDT}, cap ${this.REPLENISH_MAX_LEG_USDT})`
            );

            // Target prices for ladder
            const prices = [
                basePrice,
                Math.max(basePrice - this.BUY_LADDER_STEP, 0.000001),
                Math.max(basePrice - 2 * this.BUY_LADDER_STEP, 0.000001),
            ];

            for (let i = 0; i < legCount && i < prices.length; i++) {
                const p = prices[i];
                if (!p || p <= 0) continue;

                const amount = perOrderBudget / p;
                const roundedAmount = Math.max(0.1, parseFloat(amount.toFixed(1))); // BRIL step_size is 0.1

                if (roundedAmount * p < this.MIN_NOTIONAL_USDT) {
                    console.log(`Skipping buy at ${p}, total ${roundedAmount * p} USDT < min notional`);
                    continue;
                }

                const priceStr = p.toFixed(6);
                const amountStr = roundedAmount.toFixed(1);

                console.log(`Placing replenishment buy: ${amountStr} at ${priceStr}`);
                await this.createReplenishBuyOrder(symbol, amountStr, priceStr);
            }
        } catch (error) {
            console.error('Error in replenishBuys:', error.message);
        }
    }

    /**
     * Inspect current best bid/ask vs our tracked prices and log
     * potential defence actions, then optionally take small, controlled actions.
     *
     * - If best ask < ourSellPrice  => we should buy there (defend our sell).
     * - If best bid > ourBuyPrice  => we should sell there (defend our buy).
     */
    async checkDefenceOpportunities(symbol) {
        try {
            const refSell = this.ourMainSellPrice ?? this.ourSellPrice;
            const refBuy = this.ourMainBuyPrice ?? this.ourBuyPrice;

            if (!refBuy && !refSell) {
                return;
            }

            const orderBook = await this.getOrderBook(symbol);
            if (!orderBook) {
                return;
            }

            const { bestBid, bestAsk } = orderBook;

            if (refSell && bestAsk < refSell) {
                console.log(
                    `\n[DEFENCE] Detected best ask ${bestAsk} below our main sell ${refSell}. ` +
                    'Buying here to defend our sell level.'
                );
            } else if (process.env.LOG_DEFENCE_VERBOSE === 'true' && refSell && bestAsk >= refSell) {
                console.log(
                    `[DEFENCE] No sell-side sweep: best ask ${bestAsk} >= our main sell ${refSell} ` +
                    '(defence only buys when market ask is below our reference; aggressive self-quotes below market skip this).'
                );
            }

            if (refBuy && bestBid > refBuy) {
                console.log(
                    `\n[DEFENCE] Detected best bid ${bestBid} above our main buy ${refBuy}. ` +
                    'Selling here to capture higher bid.'
                );
            }

            if (refSell && bestAsk < refSell) {
                await this.defendSellSide(symbol, bestAsk);
            }

            if (refBuy && bestBid > refBuy) {
                await this.defendBuySide(symbol, bestBid);
            }
        } catch (error) {
            console.error('Error in checkDefenceOpportunities:', error.message);
        }
    }

    /**
     * Defend our sell side by buying a limited amount at/near bestAsk
     * when someone is selling below our sell price.
     */
    async defendSellSide(symbol, bestAsk) {
        try {
            if (this.isShuttingDown) return;
            const refSell = this.ourMainSellPrice ?? this.ourSellPrice;
            if (!refSell || bestAsk >= refSell) return;

            const usdtBalance = await this.getSpendableUsdt();
            if (!usdtBalance || Number.isNaN(usdtBalance)) {
                console.log('[DEFENCE] Cannot defend sell side, invalid USDT balance');
                return;
            }

            const availableForDefence = usdtBalance - this.USDT_RESERVE;
            if (availableForDefence <= 0) {
                console.log('[DEFENCE] USDT below reserve, skipping sell-side defence (no free USDT for defence buys)');
                return;
            }

            // Use DEFENCE_BUDGET_PCT of post-reserve USDT, but at least min-notional if affordable (avoids 10% of tiny balance < 1 USDT)
            let defenceBudget = availableForDefence * this.DEFENCE_BUDGET_PCT;
            if (availableForDefence >= this.MIN_NOTIONAL_USDT) {
                defenceBudget = Math.max(defenceBudget, Math.min(this.MIN_NOTIONAL_USDT, availableForDefence));
            }
            defenceBudget = Math.min(defenceBudget, availableForDefence);

            const price = bestAsk; // we buy at best ask to take the undercut
            const rawAmount = defenceBudget / price;
            const amount = Math.max(0.1, parseFloat(rawAmount.toFixed(1))); // step 0.1 BRIL

            if (amount * price < this.MIN_NOTIONAL_USDT) {
                console.log(
                    `[DEFENCE] Computed buy too small (${(amount * price).toFixed(4)} USDT < ${this.MIN_NOTIONAL_USDT}), skipping sell-side defence`
                );
                return;
            }

            console.log(
                `\n[DEFENCE] Executing sell-side defence: buying ~${amount} BRIL at ${price.toFixed(6)} ` +
                `to defend our main sell ${refSell}`
            );

            await this.createOrder(symbol, 'buy', amount.toFixed(1), price.toFixed(6));
        } catch (error) {
            console.error('Error in defendSellSide:', error.message);
        }
    }

    /**
     * Defend our buy side by selling a limited amount at/near bestBid
     * when someone is bidding above our buy price.
     */
    async defendBuySide(symbol, bestBid) {
        try {
            if (this.isShuttingDown) return;
            const refBuy = this.ourMainBuyPrice ?? this.ourBuyPrice;
            if (!refBuy || bestBid <= refBuy) return;

            // Try to get BRIL balance from exchange, fall back to a safe default if unsupported
            let brilBalance = 0;
            try {
                brilBalance = await this.getSpendableBril();
            } catch (e) {
                console.log('[DEFENCE] Could not fetch BRIL balance from exchange, skipping buy-side defence');
                return;
            }

            if (!brilBalance || Number.isNaN(brilBalance)) {
                console.log('[DEFENCE] Invalid BRIL balance, skipping buy-side defence');
                return;
            }

            const availableBril = brilBalance - this.BRIL_RESERVE;
            if (availableBril <= 0) {
                console.log('[DEFENCE] BRIL at or below reserve, skipping buy-side defence');
                return;
            }

            // Use only a small fraction of available BRIL per defence sweep (e.g. 10%)
            const defenceAmount = availableBril * 0.1;
            let amount = Math.max(0.1, parseFloat(defenceAmount.toFixed(1))); // step 0.1 BRIL
            amount = Math.min(amount, Math.max(0.1, parseFloat(availableBril.toFixed(1))));

            if (amount * bestBid < this.MIN_NOTIONAL_USDT) {
                console.log('[DEFENCE] Computed sell too small, skipping buy-side defence');
                return;
            }

            console.log(
                `\n[DEFENCE] Executing buy-side defence: selling ~${amount} BRIL at ${bestBid.toFixed(6)} ` +
                `to capture higher bid above our main buy ${refBuy}`
            );

            await this.createOrder(symbol, 'sell', amount.toFixed(1), bestBid.toFixed(6));
        } catch (error) {
            console.error('Error in defendBuySide:', error.message);
        }
    }

    /**
     * Maintain a simple sell ladder using BRIL above our reserve:
     * sell at ourSellPrice + 0.01, +0.02, +0.03, ... with 1–100 BRIL per level.
     */
    async maintainSellLadder(symbol) {
        try {
            if (this.isShuttingDown) return;
            const refSell = this.ourMainSellPrice ?? this.ourSellPrice;
            if (!refSell) return;

            let brilBalance = 0;
            try {
                brilBalance = await this.getSpendableBril();
            } catch (e) {
                console.log('[LADDER] Could not fetch BRIL balance, skipping sell ladder');
                return;
            }

            if (!brilBalance || Number.isNaN(brilBalance)) {
                console.log('[LADDER] Invalid BRIL balance, skipping sell ladder');
                return;
            }

            const excessBril = brilBalance - this.BRIL_RESERVE;
            if (excessBril <= 0) {
                console.log('[LADDER] No excess BRIL above reserve, skipping sell ladder');
                return;
            }

            console.log(`\n[LADDER] Maintaining sell ladder with ~${excessBril.toFixed(1)} BRIL above reserve`);

            // For now, create up to 3 ladder levels above our sell
            const maxLevels = 3;
            const perLevel = Math.min(100, Math.max(1, excessBril / maxLevels));

            for (let i = 1; i <= maxLevels; i++) {
                const price = refSell + i * 0.01;
                const amount = Math.max(0.1, parseFloat(perLevel.toFixed(1))); // step 0.1 BRIL

                // Skip too-small orders
                if (amount * price < this.MIN_NOTIONAL_USDT) {
                    console.log(`[LADDER] Sell level ${i} too small, skipping`);
                    continue;
                }

                console.log(`[LADDER] Placing sell ladder order: ~${amount} BRIL at ${price.toFixed(6)}`);
                await this.createLadderSellOrder(symbol, amount.toFixed(1), price.toFixed(6));
            }
        } catch (error) {
            console.error('Error in maintainSellLadder:', error.message);
        }
    }

    /**
     * Maintain a simple buy ladder using USDT above reserve:
     * from 2% to 10% below ourSellPrice.
     */
    async maintainBuyLadder(symbol) {
        try {
            if (this.isShuttingDown) return;
            const refSell = this.ourMainSellPrice ?? this.ourSellPrice;
            if (!refSell) return;

            const usdtBalance = await this.getSpendableUsdt();
            if (!usdtBalance || Number.isNaN(usdtBalance)) {
                console.log('[LADDER] Invalid USDT balance, skipping buy ladder');
                return;
            }

            const excessUsdt = usdtBalance - this.USDT_RESERVE;
            if (excessUsdt <= 0) {
                console.log('[LADDER] No excess USDT above reserve, skipping buy ladder');
                return;
            }

            const levels = 3;
            const totalEventBudget = Math.min(
                excessUsdt * this.REPLENISH_BUDGET_PCT,
                excessUsdt
            );
            const legInfo = this.computeLegUsdBudget(
                totalEventBudget,
                levels,
                this.REPLENISH_MAX_LEG_USDT,
                this.MIN_NOTIONAL_USDT
            );
            if (!legInfo) {
                console.log(
                    `[LADDER] Buy ladder skipped: budget ${totalEventBudget.toFixed(4)} USDT cannot split into legs ≥ ${this.MIN_NOTIONAL_USDT} USDT`
                );
                return;
            }
            const { n: legCount, perLeg: perLevelBudget } = legInfo;

            console.log(
                `\n[LADDER] Maintaining buy ladder | spendable USDT (after reserve): ${excessUsdt.toFixed(2)} | ` +
                `event budget: ${totalEventBudget.toFixed(4)} (${(this.REPLENISH_BUDGET_PCT * 100).toFixed(0)}% of excess) | ` +
                `${legCount} leg(s), ~${perLevelBudget.toFixed(4)} USDT per leg`
            );

            const base = refSell;
            const lower = base * (1 - 0.10); // 10% below main sell
            const upper = base * (1 - 0.02); // 2% below main sell

            for (let i = 0; i < legCount; i++) {
                const t = legCount <= 1 ? 0 : i / (legCount - 1);
                const price = upper - t * (upper - lower); // from upper down to lower

                if (price <= 0) continue;

                const rawAmount = perLevelBudget / price;
                const amount = Math.max(0.1, parseFloat(rawAmount.toFixed(1)));

                if (amount * price < this.MIN_NOTIONAL_USDT) {
                    console.log(`[LADDER] Buy level ${i + 1} too small, skipping`);
                    continue;
                }

                console.log(`[LADDER] Placing buy ladder order: ~${amount} BRIL at ${price.toFixed(6)}`);
                await this.createReplenishBuyOrder(symbol, amount.toFixed(1), price.toFixed(6));
            }
        } catch (error) {
            console.error('Error in maintainBuyLadder:', error.message);
        }
    }

    async createMatchingOrder(orderDetails) {
        try {
            if (!orderDetails.amount) {
                throw new Error('Invalid order details: missing amount');
            }

            if (!orderDetails.price) {
                throw new Error('Invalid order details: missing price');
            }

            // Create opposite order with same price and amount
            const matchingSide = orderDetails.type === 'buy' ? 'sell' : 'buy';
            
            console.log('\nCreating matching order:');
            console.log(`Type: ${matchingSide.toUpperCase()}`);
            console.log(`Price: ${orderDetails.price} USDT (same as first order)`);
            console.log(`Amount: ${orderDetails.amount}`);
            console.log(`Total: ${(parseFloat(orderDetails.price) * parseFloat(orderDetails.amount)).toFixed(8)} USDT`);

            const result = await this.exchange.createOrder(
                orderDetails.currencyPairCode.replace('_', '/'), 
                matchingSide, 
                orderDetails.amount, 
                orderDetails.price
            );
            
            console.log('Matching order created:', result);
            return result.orderId || result;
        } catch (error) {
            console.error('Error creating matching order:', error.message);
            return null;
        }
    }

    async executeTradeAction(action, symbol) {
        try {
            console.log(`\n=== Executing ${action.toUpperCase()} action for ${symbol} ===`);
            
            // Get current market price
            const marketPrice = await this.exchange.getMarketPrice(symbol);
            if (!marketPrice) {
                console.error('Failed to get market price');
                return false;
            }
            
            console.log(`Current market price: Bid: ${marketPrice.bid}, Ask: ${marketPrice.ask}`);
            
            // Calculate trade amount (in USDT)
            const tradeAmount = process.env.TRADE_AMOUNT || '1.5';
            console.log(`Trade amount: ${tradeAmount} USDT`);
            
            // Calculate token amount based on current price
            let tokenAmount, price;
            
            if (action === 'buy') {
                // For buy orders, set price slightly below current bid
                price = (parseFloat(marketPrice.bid) * 0.99).toFixed(6);
                console.log(`Setting buy price to ${price} (1% below current bid)`);
                
                // Calculate token amount based on USDT amount and price
                tokenAmount = (parseFloat(tradeAmount) / parseFloat(price)).toFixed(1);
            } else {
                // For sell orders, set price slightly above current ask
                price = (parseFloat(marketPrice.ask) * 1.01).toFixed(6);
                console.log(`Setting sell price to ${price} (1% above current ask)`);
                
                // Calculate token amount based on USDT amount and price
                tokenAmount = (parseFloat(tradeAmount) / parseFloat(price)).toFixed(1);
            }
            
            console.log(`Token amount: ${tokenAmount}`);
            
            // Create the order
            console.log(`Creating ${action} order...`);
            const orderResult = await this.exchange.createOrder(
                symbol,
                action,
                tokenAmount,
                price
            );
            
            if (!orderResult || !orderResult.orderId) {
                console.error('Failed to create order');
                return false;
            }
            
            console.log(`Order created successfully with ID: ${orderResult.orderId}`);
            
            // Add a small delay to allow the order to be processed
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            // Check if the order is filled
            let isOrderFilled = false;
            let retryCount = 0;
            const maxRetries = 10;
            
            while (!isOrderFilled && retryCount < maxRetries) {
                retryCount++;
                console.log(`\nChecking order status (attempt ${retryCount}/${maxRetries})...`);
                
                const orderStatus = await this.exchange.getOrderStatus(orderResult.orderId);
                console.log(`Order status:`, orderStatus);
                
                if (orderStatus && orderStatus.filled) {
                    const filledPercentage = parseFloat(orderStatus.filled);
                    console.log(`Order filled: ${filledPercentage}%`);
                    
                    // If order is at least 50% filled, consider it successful
                    if (filledPercentage >= 50) {
                        console.log('Order is at least 50% filled, considering it successful');
                        isOrderFilled = true;
                        
                        // Cancel the remaining part of the order
                        if (filledPercentage < 100) {
                            console.log('Cancelling the remaining part of the order...');
                            const cancelResult = await this.exchange.cancelOrder(orderResult.orderId, symbol.replace('/', '_'));
                            console.log('Cancel result:', cancelResult);
                        }
                        
                        break;
                    }
                }
                
                // If order is not filled after 5 attempts, try to improve the price
                if (retryCount === 5) {
                    console.log('Order not filled after 5 attempts, adjusting price to improve chances...');
                    
                    // Cancel the current order
                    console.log('Cancelling the current order...');
                    await this.exchange.cancelOrder(orderResult.orderId, symbol.replace('/', '_'));
                    
                    // Get fresh market price
                    const newMarketPrice = await this.exchange.getMarketPrice(symbol);
                    
                    // Set more aggressive price
                    if (action === 'buy') {
                        // For buy orders, set price at current ask
                        price = parseFloat(newMarketPrice.ask).toFixed(6);
                        console.log(`Setting new buy price to ${price} (at current ask)`);
                    } else {
                        // For sell orders, set price at current bid
                        price = parseFloat(newMarketPrice.bid).toFixed(6);
                        console.log(`Setting new sell price to ${price} (at current bid)`);
                    }
                    
                    // Create a new order with improved price
                    console.log(`Creating new ${action} order with improved price...`);
                    const newOrderResult = await this.exchange.createOrder(
                        symbol,
                        action,
                        tokenAmount,
                        price
                    );
                    
                    if (!newOrderResult || !newOrderResult.orderId) {
                        console.error('Failed to create new order with improved price');
                        return false;
                    }
                    
                    console.log(`New order created successfully with ID: ${newOrderResult.orderId}`);
                    orderResult.orderId = newOrderResult.orderId;
                }
                
                // Wait before checking again
                await new Promise(resolve => setTimeout(resolve, 3000));
            }
            
            // If order is still not filled after max retries, cancel it
            if (!isOrderFilled) {
                console.log(`\nOrder not filled after ${maxRetries} attempts, cancelling...`);
                await this.exchange.cancelOrder(orderResult.orderId, symbol.replace('/', '_'));
                return false;
            }
            
            console.log(`\n${action.toUpperCase()} action executed successfully`);
            return true;
        } catch (error) {
            console.error(`Error executing ${action} action:`, error.message);
            return false;
        }
    }

    async executeTrade(exchange, symbol) {
        try {
            if (this.isShuttingDown) {
                console.log('Bot is shutting down, not executing trade');
                return;
            }

            if (this.STOP_BOT_ON_LOW_USDT) {
                const spendable = await this.getSpendableUsdt();
                const free = spendable - this.USDT_RESERVE;
                if (free < this.MIN_FREE_USDT_TO_RUN) {
                    console.log(
                        `\n[STOP] Free USDT after reserve: ${free.toFixed(4)} (spendable ${spendable.toFixed(4)}, reserve ${this.USDT_RESERVE}) ` +
                        `< MIN_FREE_USDT_TO_RUN (${this.MIN_FREE_USDT_TO_RUN}). Stopping bot.`
                    );
                    this.isShuttingDown = true;
                    process.exit(0);
                    return;
                }
            }

            // Initialize cycle if this is the first run
            if (this.targetOrdersInCurrentCycle === 0) {
                // Set a random number of orders for this cycle (between 1 and 5)
                this.targetOrdersInCurrentCycle = Math.floor(Math.random() * 5) + 1;
                this.ordersInCurrentCycle = 0;
                this.currentCycle++;
                
                console.log(`\n=== Starting Cycle #${this.currentCycle} ===`);
                console.log(`Target orders for this cycle: ${this.targetOrdersInCurrentCycle}`);
            }
            
            // Determine action (buy or sell)
            // Alternate between buy and sell
            const action = this.lastAction === 'buy' ? 'sell' : 'buy';
            
            console.log(`\n=== Order ${this.ordersInCurrentCycle + 1}/${this.targetOrdersInCurrentCycle} in Cycle #${this.currentCycle} ===`);
            console.log(`Action: ${action.toUpperCase()}`);
            
            // Execute the trade action
            const success = await this.executeTradeAction(action, symbol);
            
            // Replenish after main buy fill — or once per cycle if REPLENISH_AFTER_CYCLE_ONLY=true
            if (!this.REPLENISH_AFTER_CYCLE_ONLY) {
                await this.checkAndReplenishBuys(symbol);
            }

            // Also log potential defence opportunities based on current order book
            // relative to our tracked buy/sell prices, WITHOUT placing extra orders yet.
            await this.checkDefenceOpportunities(symbol);

            if (success) {
                // Increment the orders in current cycle counter
                this.ordersInCurrentCycle++;
                
                // Save transaction data for UI
                this.saveTransactionData({
                    id: `tx-p2pb2b-${Date.now()}`,
                    type: action,
                    timestamp: new Date().toLocaleString(),
                    status: 'completed'
                });
                
                // Update last action
                this.lastAction = action;
                
                // Check if we've completed all orders for this cycle
                if (this.ordersInCurrentCycle >= this.targetOrdersInCurrentCycle) {
                    console.log(`\n=== Completed Cycle #${this.currentCycle} (${this.ordersInCurrentCycle}/${this.targetOrdersInCurrentCycle} orders) ===`);
                    
                    if (this.REPLENISH_AFTER_CYCLE_ONLY) {
                        await this.checkAndReplenishBuys(symbol);
                    }

                    // Reset for next cycle
                    this.targetOrdersInCurrentCycle = 0;
                    this.ordersInCurrentCycle = 0;
                    
                    // Add random delay before starting new cycle
                    const minDelay = parseInt(process.env.TIME_MIN || '10') * 1000;
                    const maxDelay = parseInt(process.env.TIME_MAX || '30') * 1000;
                    const delay = Math.floor(Math.random() * (maxDelay - minDelay + 1)) + minDelay;
                    
                    console.log(`Waiting ${delay/1000} seconds before starting next cycle...`);

                    // Less frequent maintenance: update ladders once per completed cycle
                    await this.maintainSellLadder(symbol);
                    await this.maintainBuyLadder(symbol);

                    await new Promise(resolve => setTimeout(resolve, delay));
                } else {
                    // Add a small delay between orders in the same cycle
                    console.log(`Waiting 5 seconds before next order...`);
                    await new Promise(resolve => setTimeout(resolve, 5000));
                }
                
                // Continue trading if not shutting down
                if (!this.isShuttingDown) {
                    await this.executeTrade(exchange, symbol);
                }
            } else {
                console.log(`\nTrade action failed, retrying with opposite action...`);
                
                // Try the opposite action
                const oppositeAction = action === 'buy' ? 'sell' : 'buy';
                const oppositeSuccess = await this.executeTradeAction(oppositeAction, symbol);
                
                if (oppositeSuccess) {
                    // Increment the orders in current cycle counter
                    this.ordersInCurrentCycle++;
                    
                    // Save transaction data for UI
                    this.saveTransactionData({
                        id: `tx-p2pb2b-${Date.now()}`,
                        type: oppositeAction,
                        timestamp: new Date().toLocaleString(),
                        status: 'completed'
                    });
                    
                    // Update last action
                    this.lastAction = oppositeAction;
                }
                
                // Check if we've completed all orders for this cycle
                if (this.ordersInCurrentCycle >= this.targetOrdersInCurrentCycle) {
                    console.log(`\n=== Completed Cycle #${this.currentCycle} (${this.ordersInCurrentCycle}/${this.targetOrdersInCurrentCycle} orders) ===`);
                    
                    if (this.REPLENISH_AFTER_CYCLE_ONLY) {
                        await this.checkAndReplenishBuys(symbol);
                    }

                    // Reset for next cycle
                    this.targetOrdersInCurrentCycle = 0;
                    this.ordersInCurrentCycle = 0;
                }
                
                // Add a delay before continuing
                console.log(`Waiting 10 seconds before continuing...`);
                await new Promise(resolve => setTimeout(resolve, 10000));
                
                // Continue trading if not shutting down
                if (!this.isShuttingDown) {
                    await this.executeTrade(exchange, symbol);
                }
            }
        } catch (error) {
            console.error('Error in executeTrade:', error.message);
            
            // Add a delay before retrying
            console.log('Waiting 30 seconds before retrying...');
            await new Promise(resolve => setTimeout(resolve, 30000));
            
            // Continue trading if not shutting down
            if (!this.isShuttingDown) {
                await this.executeTrade(exchange, symbol);
            }
        }
    }

    // Add method to get random order count between 1-5
    getRandomOrderCount() {
        return Math.floor(Math.random() * 5) + 1; // Random number between 1 and 5
    }

    // Helper methods to save data for the UI
    saveOrderBookData(orderBook) {
        try {
            const fs = require('fs');
            const data = {
                lowestSell: orderBook.bestAsk,
                highestBuy: orderBook.bestBid,
                spread: orderBook.bestAsk - orderBook.bestBid,
                lastOrderType: this.lastAction
            };
            fs.writeFileSync('p2pb2b-orderbook.json', JSON.stringify(data, null, 2));
        } catch (error) {
            console.error('Error saving order book data:', error.message);
        }
    }

    saveBalanceData(balance) {
        try {
            const fs = require('fs');
            // Get BRIL balance - in a real implementation, you'd fetch this from the exchange
            const brilBalance = 5000; // Mock value
            const data = {
                crypto: brilBalance,
                usdt: balance
            };
            fs.writeFileSync('p2pb2b-balance.json', JSON.stringify(data, null, 2));
        } catch (error) {
            console.error('Error saving balance data:', error.message);
        }
    }

    saveTransactionData(transaction) {
        try {
            const fs = require('fs');
            let transactions = [];
            
            // Read existing transactions if file exists
            if (fs.existsSync('p2pb2b-transactions.json')) {
                transactions = JSON.parse(fs.readFileSync('p2pb2b-transactions.json', 'utf8'));
            }
            
            // Add new transaction
            transactions.push(transaction);
            
            // Keep only the latest 20 transactions
            if (transactions.length > 20) {
                transactions = transactions.slice(-20);
            }
            
            fs.writeFileSync('p2pb2b-transactions.json', JSON.stringify(transactions, null, 2));
        } catch (error) {
            console.error('Error saving transaction data:', error.message);
        }
    }
}

module.exports = { AutoTradingBot2 };
