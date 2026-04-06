// Modified P2PB2B bot with both buy and sell orders below ask price
require('dotenv').config();
const { AutoTradingBot2 } = require('./bot2');
const P2PB2BExchange = require('./exchanges/p2pb2b');

class BothBelowAskP2PB2BBot extends AutoTradingBot2 {
    constructor() {
        super();
        console.log('Initializing P2PB2B Trading Bot (Both Orders Below Ask)');
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
            
            // Calculate token amount and price based on current price
            let tokenAmount, price;
            
            // For both buy and sell orders, set price below current ask (0.001 below)
            const askPrice = parseFloat(marketPrice.ask);
            price = (askPrice - 0.001).toFixed(6);
            
            console.log(`Original ask price: ${askPrice}`);
            console.log(`Setting ${action} price to ${price} (0.001 below ask)`);
            
            // Calculate token amount based on USDT amount and price
            tokenAmount = (parseFloat(tradeAmount) / parseFloat(price)).toFixed(1);
            console.log(`Token amount: ${tokenAmount}`);
            
            // Calculate total order value
            const totalOrderValue = parseFloat(tokenAmount) * parseFloat(price);
            const minTotalValue = 1; // P2PB2B requires minimum total order value of 1 USDT
            
            // Check if total order value meets minimum requirement
            if (totalOrderValue < minTotalValue) {
                console.log(`\nWarning: Total order value ${totalOrderValue} is below minimum ${minTotalValue}`);
                // Adjust amount to meet minimum total value requirement
                const adjustedAmount = Math.ceil(minTotalValue / parseFloat(price) * 10) / 10;
                console.log(`Adjusting amount from ${tokenAmount} to ${adjustedAmount} to meet minimum total value`);
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
                
                // Try to cancel the first order
                console.log('Cancelling the first order...');
                await this.exchange.cancelOrder(orderResult.orderId, symbol.replace('/', '_'));
                
                return false;
            }
            
            console.log(`Matching order created successfully with ID: ${matchingOrderResult.orderId}`);
            
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
                
                // If orders are not filled after 5 attempts, try to cancel and recreate with better prices
                if (retryCount === 5 && (!firstOrderFilled || !matchingOrderFilled)) {
                    console.log('Orders not filled after 5 attempts, adjusting prices...');
                    
                    // Cancel both orders
                    console.log('Cancelling both orders...');
                    if (!firstOrderFilled) {
                        await this.exchange.cancelOrder(orderResult.orderId, symbol.replace('/', '_'));
                    }
                    if (!matchingOrderFilled) {
                        await this.exchange.cancelOrder(matchingOrderResult.orderId, symbol.replace('/', '_'));
                    }
                    
                    // Get fresh market price
                    const newMarketPrice = await this.exchange.getMarketPrice(symbol);
                    
                    // Set more aggressive prices - use exact ask price
                    const newPrice = parseFloat(newMarketPrice.ask).toFixed(6);
                    console.log(`Setting new price to ${newPrice} (at current ask)`);
                    
                    // Create new orders with improved prices
                    console.log(`Creating new ${action} order with improved price...`);
                    const newOrderResult = await this.exchange.createOrder(
                        symbol,
                        action,
                        tokenAmount,
                        newPrice
                    );
                    
                    if (!newOrderResult || !newOrderResult.orderId) {
                        console.error('Failed to create new first order');
                        return false;
                    }
                    
                    console.log(`New first order created successfully with ID: ${newOrderResult.orderId}`);
                    
                    // Create new matching order
                    console.log(`Creating new matching ${matchingSide} order...`);
                    const newMatchingOrderResult = await this.exchange.createOrder(
                        symbol,
                        matchingSide,
                        tokenAmount,
                        newPrice
                    );
                    
                    if (!newMatchingOrderResult || !newMatchingOrderResult.orderId) {
                        console.error('Failed to create new matching order');
                        
                        // Try to cancel the new first order
                        console.log('Cancelling the new first order...');
                        await this.exchange.cancelOrder(newOrderResult.orderId, symbol.replace('/', '_'));
                        
                        return false;
                    }
                    
                    console.log(`New matching order created successfully with ID: ${newMatchingOrderResult.orderId}`);
                    
                    // Update order IDs for continued status checking
                    orderResult.orderId = newOrderResult.orderId;
                    matchingOrderResult.orderId = newMatchingOrderResult.orderId;
                }
                
                // Wait before checking again
                await new Promise(resolve => setTimeout(resolve, 3000));
            }
            
            // If orders are still not filled after max retries, cancel them
            if (!areOrdersFilled) {
                console.log(`\nOrders not filled after ${maxRetries} attempts, cancelling...`);
                try {
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
            return false;
        }
    }
}

// Create a test function to run the bot
async function runBothBelowAskBot() {
    try {
        console.log('=== Starting P2PB2B Trading Bot (Both Orders Below Ask) ===');
        
        const bot = new BothBelowAskP2PB2BBot();
        
        // Force a specific number of orders for testing
        bot.targetOrdersInCurrentCycle = 2; // Set to 2 orders for testing
        bot.ordersInCurrentCycle = 0;
        bot.currentCycle = 1;
        
        // Start trading with P2PB2B exchange and BRIL_USDT symbol
        await bot.startTrading('P2PB2B', 'BRIL/USDT');
        
    } catch (error) {
        console.error('Error running Both Below Ask bot:', error.message);
    }
}

// Run the bot if this file is executed directly
if (require.main === module) {
    runBothBelowAskBot();
}

module.exports = { BothBelowAskP2PB2BBot };
