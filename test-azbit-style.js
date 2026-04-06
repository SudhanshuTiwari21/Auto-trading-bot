// Test script for P2PB2B using Azbit-style trading approach
require('dotenv').config();
const P2PB2BExchange = require('./exchanges/p2pb2b');

async function testAzbitStyleTrading() {
    try {
        console.log('=== Testing P2PB2B with Azbit-style Trading Approach ===');
        
        // Initialize exchange
        const exchange = new P2PB2BExchange();
        const symbol = 'BRIL/USDT';
        const formattedSymbol = symbol.replace('/', '_');
        
        console.log(`\nExchange: P2PB2B`);
        console.log(`Symbol: ${symbol}`);
        
        // Get market price
        const marketPrice = await exchange.getMarketPrice(symbol);
        if (!marketPrice) {
            console.error('Failed to get market price');
            return;
        }
        
        console.log(`\nCurrent market price: Bid: ${marketPrice.bid}, Ask: ${marketPrice.ask}`);
        
        // Calculate trade amount (in USDT)
        const tradeAmount = process.env.TRADE_AMOUNT || '1.5';
        console.log(`Trade amount: ${tradeAmount} USDT`);
        
        // Decide on action (buy or sell)
        const action = 'buy'; // You can change this to 'sell' for testing
        
        // Calculate token amount and price based on current price
        let tokenAmount, price;
        
        if (action === 'buy') {
            // For buy orders, set price slightly below current ask (2% below)
            price = (parseFloat(marketPrice.ask) * 0.98).toFixed(6);
            console.log(`Setting buy price to ${price} (2% below current ask)`);
            
            // Calculate token amount based on USDT amount and price
            tokenAmount = (parseFloat(tradeAmount) / parseFloat(price)).toFixed(1);
        } else {
            // For sell orders, set price slightly above current bid (2% above)
            price = (parseFloat(marketPrice.bid) * 1.02).toFixed(6);
            console.log(`Setting sell price to ${price} (2% above current bid)`);
            
            // Calculate token amount based on USDT amount and price
            tokenAmount = (parseFloat(tradeAmount) / parseFloat(price)).toFixed(1);
        }
        
        console.log(`Token amount: ${tokenAmount}`);
        
        // Calculate total order value
        const totalOrderValue = parseFloat(tokenAmount) * parseFloat(price);
        const minTotalValue = 1; // P2PB2B requires minimum total order value of 1 USDT
        
        // Check if total order value meets minimum requirement
        if (totalOrderValue < minTotalValue) {
            console.log(`\nWarning: Total order value ${totalOrderValue} is below minimum ${minTotalValue}`);
            // Adjust amount to meet minimum total value requirement
            const adjustedAmount = Math.ceil(minTotalValue / parseFloat(price) * 10) / 10;
            console.log(`Adjusting amount from ${tokenAmount} to ${adjustedAmount}`);
            console.log(`New total value: ${(adjustedAmount * parseFloat(price)).toFixed(7)} USDT (minimum: ${minTotalValue} USDT)`);
            tokenAmount = adjustedAmount.toFixed(1);
        }
        
        // Create the first order
        console.log(`\nCreating first ${action} order...`);
        const orderResult = await exchange.createOrder(
            symbol,
            action,
            tokenAmount,
            price
        );
        
        if (!orderResult || !orderResult.orderId) {
            console.error('Failed to create first order');
            return;
        }
        
        console.log(`First order created successfully with ID: ${orderResult.orderId}`);
        
        // Add a small delay to allow the order to be processed
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // Create a matching order to fill the first order
        console.log('\nCreating matching order to fill the first order...');
        
        // For the matching order, use the opposite action with the same price and amount
        const matchingSide = action === 'buy' ? 'sell' : 'buy';
        
        // Create matching order with the same price and amount
        const matchingOrderResult = await exchange.createOrder(
            symbol,
            matchingSide,
            tokenAmount,
            price
        );
        
        if (!matchingOrderResult || !matchingOrderResult.orderId) {
            console.error('Failed to create matching order');
            
            // Try to cancel the first order
            console.log('Cancelling the first order...');
            await exchange.cancelOrder(orderResult.orderId, formattedSymbol);
            
            return;
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
            const firstOrderStatus = await exchange.getOrderStatus(orderResult.orderId);
            const matchingOrderStatus = await exchange.getOrderStatus(matchingOrderResult.orderId);
            
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
            if (retryCount === 5) {
                console.log('Orders not filled after 5 attempts, adjusting prices...');
                
                // Cancel both orders
                console.log('Cancelling both orders...');
                await exchange.cancelOrder(orderResult.orderId, formattedSymbol);
                await exchange.cancelOrder(matchingOrderResult.orderId, formattedSymbol);
                
                // Get fresh market price
                const newMarketPrice = await exchange.getMarketPrice(symbol);
                
                // Set more aggressive prices
                let newPrice;
                if (action === 'buy') {
                    // For buy orders, set price at current ask
                    newPrice = parseFloat(newMarketPrice.ask).toFixed(6);
                    console.log(`Setting new buy price to ${newPrice} (at current ask)`);
                } else {
                    // For sell orders, set price at current bid
                    newPrice = parseFloat(newMarketPrice.bid).toFixed(6);
                    console.log(`Setting new sell price to ${newPrice} (at current bid)`);
                }
                
                // Create new orders with improved prices
                console.log(`Creating new ${action} order with improved price...`);
                const newOrderResult = await exchange.createOrder(
                    symbol,
                    action,
                    tokenAmount,
                    newPrice
                );
                
                if (!newOrderResult || !newOrderResult.orderId) {
                    console.error('Failed to create new first order');
                    return;
                }
                
                console.log(`New first order created successfully with ID: ${newOrderResult.orderId}`);
                
                // Create new matching order
                console.log(`Creating new matching ${matchingSide} order...`);
                const newMatchingOrderResult = await exchange.createOrder(
                    symbol,
                    matchingSide,
                    tokenAmount,
                    newPrice
                );
                
                if (!newMatchingOrderResult || !newMatchingOrderResult.orderId) {
                    console.error('Failed to create new matching order');
                    
                    // Try to cancel the new first order
                    console.log('Cancelling the new first order...');
                    await exchange.cancelOrder(newOrderResult.orderId, formattedSymbol);
                    
                    return;
                }
                
                console.log(`New matching order created successfully with ID: ${newMatchingOrderResult.orderId}`);
                
                // Update order IDs
                orderResult.orderId = newOrderResult.orderId;
                matchingOrderResult.orderId = newMatchingOrderResult.orderId;
            }
            
            // Wait before checking again
            await new Promise(resolve => setTimeout(resolve, 3000));
        }
        
        // If orders are still not filled after max retries, cancel them
        if (!areOrdersFilled) {
            console.log(`\nOrders not filled after ${maxRetries} attempts, cancelling...`);
            await exchange.cancelOrder(orderResult.orderId, formattedSymbol);
            await exchange.cancelOrder(matchingOrderResult.orderId, formattedSymbol);
            return;
        }
        
        console.log(`\n${action.toUpperCase()} action executed successfully`);
        console.log('\n=== Test completed successfully ===');
        
    } catch (error) {
        console.error('Error in Azbit-style trading test:', error.message);
    }
}

// Run the test
testAzbitStyleTrading();
