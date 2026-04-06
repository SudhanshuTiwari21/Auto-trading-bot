// Test script for P2PB2B immediate orders
require('dotenv').config();
const P2PB2BExchange = require('./exchanges/p2pb2b');

// Create exchange instance
const exchange = new P2PB2BExchange(
    process.env.P2PB2B_API_KEY,
    process.env.P2PB2B_SECRET_KEY
);

// Test function to check immediate orders
async function testImmediateOrders() {
    try {
        console.log('=== Testing P2PB2B Immediate Orders ===');
        
        // Get balance to ensure we have enough funds
        console.log('\n1. Checking USDT balance...');
        const balance = await exchange.getBalance('USDT');
        console.log('USDT Balance:', balance);
        
        if (parseFloat(balance) < 2) {
            console.error('Insufficient USDT balance for testing. Need at least 2 USDT.');
            return;
        }
        
        // Get market price for reference
        console.log('\n2. Getting current market price...');
        const marketPrice = await exchange.getMarketPrice('BRIL/USDT');
        console.log('Current market price:', marketPrice);
        
        // Create a small buy limit order
        console.log('\n3. Creating buy limit order...');
        // Set price slightly below current bid to avoid immediate fill
        const buyPrice = (marketPrice.bid * 0.98).toFixed(6);
        console.log(`Buy price (2% below bid): ${buyPrice}`);
        
        // Calculate amount to meet minimum total value (1 USDT)
        const amount = Math.ceil(1.5 / parseFloat(buyPrice) * 10) / 10;
        console.log(`Buy amount: ${amount} BRIL`);
        
        const buyOrder = await exchange.createOrder('BRIL/USDT', 'buy', amount.toString(), buyPrice);
        console.log('Buy limit order created:', buyOrder);
        
        // Create a matching sell immediate order
        console.log('\n4. Creating matching sell immediate order...');
        const sellOrder = await exchange.createImmediateOrder('BRIL/USDT', 'sell', amount.toString());
        console.log('Sell immediate order created:', sellOrder);
        
        // Check status of buy order - should be filled by the immediate sell
        console.log('\n5. Checking buy order status after immediate sell...');
        // Wait a moment for the order to be processed
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        const buyOrderStatus = await exchange.getOrderStatus(buyOrder.orderId);
        console.log('Buy order status:', buyOrderStatus);
        
        console.log('\n=== Immediate Order Test Completed ===');
    } catch (error) {
        console.error('Error in immediate order test:', error.message);
        if (error.response) {
            console.error('Response data:', error.response.data);
            console.error('Response status:', error.response.status);
        }
    }
}

// Run the test
testImmediateOrders();
