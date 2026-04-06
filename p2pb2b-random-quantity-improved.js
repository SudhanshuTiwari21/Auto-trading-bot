// Modified P2PB2B bot with both buy and sell orders below ask price and random quantities
require('dotenv').config();
const { AutoTradingBot2 } = require('./bot2');
class RandomQuantityP2PB2BBot extends AutoTradingBot2 {
    constructor() {
        super();
        console.log('Initializing P2PB2B Trading Bot (Random Quantity)');

        // Define min and max token amount for random quantity (exchange step_size 0.1)
        this.minTokenAmount = 0.1;
        this.maxTokenAmount = 5.0; // Set to 5.0 as requested
        
        // Define price variation parameters for randomization
        this.minPriceVariation = 0.001; // Minimum price variation (0.001 below ask)
        this.maxPriceVariation = 0.004; // Maximum price variation (0.004 below ask)
    }

    // Helper method to generate random token amount based on available funds
    async getRandomTokenAmount(symbol, price) {
        try {
            // Generate a random number between min and max
            const randomAmount = Math.random() * (this.maxTokenAmount - this.minTokenAmount) + this.minTokenAmount;
            
            // Add a small random offset for more variation
            const randomOffset = Math.random() * 0.2;
            const amountWithOffset = randomAmount + randomOffset;
            
            // Ensure we don't exceed the maximum
            const cappedAmount = Math.min(amountWithOffset, this.maxTokenAmount);
            
            // Round to 1 decimal place to match exchange step_size of 0.1
            const roundedAmount = Math.floor(cappedAmount * 10) / 10;
            
            // Ensure minimum amount
            const finalAmount = Math.max(roundedAmount, this.minTokenAmount);
            
            console.log(`Generated random amount: ${finalAmount.toFixed(1)} (range: ${this.minTokenAmount} - ${this.maxTokenAmount})`);
            return finalAmount;
        } catch (error) {
            console.error('Error generating random token amount:', error.message);
            return this.minTokenAmount; // Fallback to minimum amount
        }
    }

    // Helper method to generate random price variation
    getRandomPrice(basePrice, action) {
        // Generate a random price variation between min and max variation
        const variation = Math.random() * (this.maxPriceVariation - this.minPriceVariation) + this.minPriceVariation;
        
        // For both buy and sell orders, price should be below ask
        // This ensures all orders are created below the ask price
        const adjustedPrice = basePrice - variation;
        
        console.log(`Setting ${action} price to ${adjustedPrice.toFixed(6)} (${variation.toFixed(6)} below ask)`);
        
        // Add a tiny random offset to ensure variation between consecutive orders
        const microVariation = (Math.random() - 0.5) * 0.0001;
        const finalPrice = adjustedPrice + microVariation;
        
        // Format to 6 decimal places with different rounding patterns
        const roundingDigit = Math.floor(Math.random() * 3) + 4; // Random precision between 4-6 digits
        return finalPrice.toFixed(roundingDigit);
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

            // Calculate token amount and price based on current price
            let tokenAmount, price;

            // Get base price from current ask
            const askPrice = parseFloat(marketPrice.ask);
            console.log(`Original ask price: ${askPrice}`);

            // Generate a random price with variation
            price = this.getRandomPrice(askPrice, action);

            // Generate random token amount between minTokenAmount and maxTokenAmount
            tokenAmount = (await this.getRandomTokenAmount(symbol, parseFloat(price))).toFixed(1);
            console.log(`Random token amount: ${tokenAmount}`);

            // Calculate total order value
            const totalOrderValue = parseFloat(tokenAmount) * parseFloat(price);
            console.log(`Total order value: ${totalOrderValue.toFixed(6)} USDT`);

            const minTotalValue = 1; // P2PB2B requires minimum total order value of 1 USDT

            // Check if total order value meets minimum requirement
            if (totalOrderValue < minTotalValue) {
                console.log(`\nWarning: Total order value ${totalOrderValue} is below minimum ${minTotalValue}`);

                // Calculate the minimum required amount to meet the minimum total value  
                const minRequiredAmount = Math.ceil(minTotalValue / parseFloat(price) * 10) / 10;

                // Generate a random amount that is at least the minimum required amount  
                // Add a random additional amount between 0 and 0.5 tokens
                const randomAdditional = Math.round(Math.random() * 5) / 10; 
                const adjustedAmount = minRequiredAmount + randomAdditional;

                console.log(`Adjusting amount from ${tokenAmount} to ${adjustedAmount.toFixed(1)} to meet minimum total value`);
                console.log(`New total value: ${(adjustedAmount * parseFloat(price)).toFixed(7)} USDT (minimum: ${minTotalValue} USDT)`);
                tokenAmount = adjustedAmount.toFixed(1);
            }

            // Create the first order
            console.log(`\nCreating first ${action} order...`);
            const orderResult = await this.exchange.createOrder(
                symbol,
                action,
                tokenAmount,
                price
            );

            if (!orderResult || !orderResult.orderId) {
                console.error('Failed to create first order');
                return false;
            }

            console.log(`First order created successfully with ID: ${orderResult.orderId}`);

            // Update parent bot state so defence, replenish, and ladder logic can run
            const numericPrice = parseFloat(price);
            if (!Number.isNaN(numericPrice)) {
                if (action === 'buy') {
                    this.ourBuyPrice = numericPrice;
                    this.ourMainBuyPrice = numericPrice; // Step 3: main quote only (first leg)
                    const oid = String(orderResult.orderId);
                    this.ourBuyOrderIds.add(oid);
                    this.ourMainBuyOrderIds.add(oid); // replenish only when this leg fills, not matching buy
                } else {
                    this.ourSellPrice = numericPrice;
                    this.ourMainSellPrice = numericPrice; // Step 3: main quote only (first leg)
                    this.ourSellOrderIds.add(String(orderResult.orderId));
                }
            }

            // Add a small delay to allow the order to be processed
            await new Promise(resolve => setTimeout(resolve, 1000));

            // Create a matching order to fill the first order
            console.log('\nCreating matching order to fill the first order...');

            // For the matching order, use the opposite action with the same price and amount
            const matchingSide = action === 'buy' ? 'sell' : 'buy';

            // Create matching order with the same price and amount
            const matchingOrderResult = await this.exchange.createOrder(
                symbol,
                matchingSide,
                tokenAmount,
                price
            );

            if (!matchingOrderResult || !matchingOrderResult.orderId) {
                console.error('Failed to create matching order');

                console.log('Cancelling the first order...');
                this.removeFirstLegOrderTracking(action, orderResult.orderId);
                await this.exchange.cancelOrder(orderResult.orderId, symbol.replace('/', '_'));

                return false;
            }

            console.log(`Matching order created successfully with ID: ${matchingOrderResult.orderId}`);

            // Track matching order — do not update ourMain* or ourMainBuyOrderIds (no replenish on this fill)
            if (!Number.isNaN(numericPrice)) {
                if (matchingSide === 'buy') {
                    this.ourBuyPrice = numericPrice;
                    this.ourBuyOrderIds.add(String(matchingOrderResult.orderId));
                } else {
                    this.ourSellPrice = numericPrice;
                    this.ourSellOrderIds.add(String(matchingOrderResult.orderId));
                }
            }

            // Check if both orders are filled
            let areOrdersFilled = false;
            let retryCount = 0;
            const maxRetries = 10;

            while (!areOrdersFilled && retryCount < maxRetries) {
                retryCount++;
                console.log(`\nChecking order status (attempt ${retryCount}/${maxRetries})...`);

                // Check status of both orders
                const firstOrderStatus = await this.exchange.getOrderStatus(orderResult.orderId);
                const matchingOrderStatus = await this.exchange.getOrderStatus(matchingOrderResult.orderId);

                console.log(`First order status: ${firstOrderStatus.filled}% filled`);    
                console.log(`Matching order status: ${matchingOrderStatus.filled}% filled`);

                const firstOrderFilled = parseFloat(firstOrderStatus.filled) >= 90;       
                const matchingOrderFilled = parseFloat(matchingOrderStatus.filled) >= 90; 

                if (firstOrderFilled && matchingOrderFilled) {
                    console.log('Both orders are filled!');
                    areOrdersFilled = true;
                    break;
                }

                // If one order is filled but the other isn't after 3 attempts, cancel and recreate the unfilled order
                if (retryCount >= 3 && (firstOrderFilled !== matchingOrderFilled)) {      
                    console.log('One order filled but the other is not. Adjusting the unfilled order...');

                    // Get fresh market price
                    const newMarketPrice = await this.exchange.getMarketPrice(symbol);    
                    const newAskPrice = parseFloat(newMarketPrice.ask);

                    // If first order is not filled, cancel and recreate it
                    if (!firstOrderFilled) {
                        const prevFirstId = String(orderResult.orderId);
                        console.log('Cancelling the first order...');
                        await this.exchange.cancelOrder(orderResult.orderId, symbol.replace('/', '_'));

                        const newPrice = newAskPrice.toFixed(6);
                        console.log(`Setting new price to ${newPrice} (at current ask)`);

                        console.log(`Creating new ${action} order with improved price...`);
                        const newOrderResult = await this.exchange.createOrder(
                            symbol,
                            action,
                            tokenAmount,
                            newPrice
                        );

                        if (!newOrderResult || !newOrderResult.orderId) {
                            console.error('Failed to create new first order');
                            this.removeFirstLegOrderTracking(action, prevFirstId);
                            return false;
                        }

                        console.log(`New first order created successfully with ID: ${newOrderResult.orderId}`);
                        orderResult.orderId = newOrderResult.orderId;
                        this.replaceFirstLegOrderId(action, prevFirstId, orderResult.orderId, newPrice);
                    }

                    // If matching order is not filled, cancel and recreate it
                    if (!matchingOrderFilled) {
                        const prevMatchId = String(matchingOrderResult.orderId);
                        console.log('Cancelling the matching order...');
                        await this.exchange.cancelOrder(matchingOrderResult.orderId, symbol.replace('/', '_'));

                        const newPrice = newAskPrice.toFixed(6);
                        console.log(`Setting new price to ${newPrice} (at current ask)`);

                        console.log(`Creating new matching ${matchingSide} order...`);
                        const newMatchingOrderResult = await this.exchange.createOrder(
                            symbol,
                            matchingSide,
                            tokenAmount,
                            newPrice
                        );

                        if (!newMatchingOrderResult || !newMatchingOrderResult.orderId) {
                            console.error('Failed to create new matching order');
                            this.removeMatchingLegTracking(matchingSide, prevMatchId);
                            return false;
                        }

                        console.log(`New matching order created successfully with ID: ${newMatchingOrderResult.orderId}`);
                        matchingOrderResult.orderId = newMatchingOrderResult.orderId;
                        this.replaceMatchingLegOrderId(matchingSide, prevMatchId, matchingOrderResult.orderId);
                    }
                }
                // If orders are not filled after 5 attempts, try to cancel and recreate with better prices
                else if (retryCount === 5 && (!firstOrderFilled || !matchingOrderFilled)) 
{
                    console.log('Orders not filled after 5 attempts, adjusting prices...');

                    const prevFirstId = String(orderResult.orderId);
                    const prevMatchId = String(matchingOrderResult.orderId);

                    console.log('Cancelling both orders...');
                    if (!firstOrderFilled) {
                        await this.exchange.cancelOrder(orderResult.orderId, symbol.replace('/', '_'));
                    }
                    if (!matchingOrderFilled) {
                        await this.exchange.cancelOrder(matchingOrderResult.orderId, symbol.replace('/', '_'));
                    }

                    const newMarketPrice = await this.exchange.getMarketPrice(symbol);

                    const newPrice = parseFloat(newMarketPrice.ask).toFixed(6);
                    console.log(`Setting new price to ${newPrice} (at current ask)`);

                    console.log(`Creating new ${action} order with improved price...`);
                    const newOrderResult = await this.exchange.createOrder(
                        symbol,
                        action,
                        tokenAmount,
                        newPrice
                    );

                    if (!newOrderResult || !newOrderResult.orderId) {
                        console.error('Failed to create new first order');
                        this.removeFirstLegOrderTracking(action, prevFirstId);
                        this.removeMatchingLegTracking(matchingSide, prevMatchId);
                        return false;
                    }

                    console.log(`New first order created successfully with ID: ${newOrderResult.orderId}`);

                    console.log(`Creating new matching ${matchingSide} order...`);
                    const newMatchingOrderResult = await this.exchange.createOrder(
                        symbol,
                        matchingSide,
                        tokenAmount,
                        newPrice
                    );

                    if (!newMatchingOrderResult || !newMatchingOrderResult.orderId) {
                        console.error('Failed to create new matching order');
                        console.log('Cancelling the new first order...');
                        await this.exchange.cancelOrder(newOrderResult.orderId, symbol.replace('/', '_'));
                        this.removeFirstLegOrderTracking(action, newOrderResult.orderId);
                        this.removeMatchingLegTracking(matchingSide, prevMatchId);
                        return false;
                    }

                    console.log(`New matching order created successfully with ID: ${newMatchingOrderResult.orderId}`);

                    orderResult.orderId = newOrderResult.orderId;
                    matchingOrderResult.orderId = newMatchingOrderResult.orderId;
                    this.replaceFirstLegOrderId(action, prevFirstId, orderResult.orderId, newPrice);
                    this.replaceMatchingLegOrderId(matchingSide, prevMatchId, matchingOrderResult.orderId);
                }

                // Wait before checking again
                await new Promise(resolve => setTimeout(resolve, 3000));
            }

            // If orders are still not filled after max retries, cancel them
            if (!areOrdersFilled) {
                console.log(`\nOrders not filled after ${maxRetries} attempts, cancelling...`);
                try {
                    this.removeFirstLegOrderTracking(action, orderResult.orderId);
                    this.removeMatchingLegTracking(matchingSide, matchingOrderResult.orderId);
                    await this.exchange.cancelOrder(orderResult.orderId, symbol.replace('/', '_'));
                    await this.exchange.cancelOrder(matchingOrderResult.orderId, symbol.replace('/', '_'));
                } catch (cancelError) {
                    console.error('Error cancelling orders:', cancelError.message);
                }
                return false;
            }

            console.log(`\n${action.toUpperCase()} action executed successfully`);        
            return true;
        } catch (error) {
            console.error(`Error executing ${action} action:`, error.message);

            // Add graceful error handling for trade action failures
            console.log('Trade action failed, retrying with opposite action...');

            // If the current action fails, try the opposite action
            const oppositeAction = action === 'buy' ? 'sell' : 'buy';

            // Wait a bit before retrying
            await new Promise(resolve => setTimeout(resolve, 10000));

            // Return false to let the main loop handle the retry
            return false;
        }
    }
}

// Create a test function to run the bot
async function runRandomQuantityBot() {
    try {
        console.log('=== Starting P2PB2B Trading Bot (Random Quantity) ===');

        const bot = new RandomQuantityP2PB2BBot();

        // Force a specific number of orders for testing
        bot.targetOrdersInCurrentCycle = 3; // Set to 3 orders for testing
        bot.ordersInCurrentCycle = 0;
        bot.currentCycle = 1;

        // Start trading with P2PB2B exchange and BRIL_USDT symbol
        await bot.startTrading('P2PB2B', 'BRIL/USDT');

    } catch (error) {
        console.error('Error running Random Quantity bot:', error.message);
    }
}

// Run the bot if this file is executed directly
if (require.main === module) {
    runRandomQuantityBot();
}

module.exports = { RandomQuantityP2PB2BBot };
