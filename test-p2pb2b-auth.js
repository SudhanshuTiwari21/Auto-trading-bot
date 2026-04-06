// Test script for P2PB2B API authentication
require('dotenv').config();
const P2PB2BExchange = require('./exchanges/p2pb2b');

// Create exchange instance
const exchange = new P2PB2BExchange(
    process.env.P2PB2B_API_KEY,
    process.env.P2PB2B_SECRET_KEY
);

// Test function to check authentication
async function testAuthentication() {
    try {
        console.log('=== Testing P2PB2B API Authentication ===');
        
        // Test balance API (requires authentication)
        console.log('\n1. Testing getBalance method...');
        const balance = await exchange.getBalance('USDT');
        console.log('Balance result:', balance);
        
        // Test market limits API (public endpoint)
        console.log('\n2. Testing getMarketLimits method...');
        const limits = await exchange.getMarketLimits('BRIL_USDT');
        console.log('Market limits:', limits);
        
        // Test order creation with small amount (requires authentication)
        console.log('\n3. Testing order creation...');
        
        // Get current market price
        const marketPriceData = await exchange.getMarketPrice('BRIL_USDT');
        console.log('Current market price data:', marketPriceData);
        
        // Use the bid price for our calculation
        const marketPrice = marketPriceData.bid;
        
        // Calculate buy price slightly below market price (5% below)
        const buyPrice = (marketPrice * 0.95).toFixed(6);
        console.log('Market price:', marketPrice);
        console.log('Buy price (5% below market):', buyPrice);
        
        // Make sure we have a valid price
        if (isNaN(parseFloat(buyPrice))) {
            throw new Error('Invalid buy price calculated');
        }
        
        // Create a small buy order
        // We need to set the amount high enough to meet the minimum total value (1 USDT)
        const minAmount = Math.ceil(1 / parseFloat(buyPrice) * 10) / 10; // Round to 0.1 precision
        console.log(`Using amount ${minAmount} to ensure minimum total value of 1 USDT`);
        
        const orderResult = await exchange.createOrder(
            'BRIL_USDT',
            'buy',
            minAmount.toString(),
            buyPrice
        );
        
        console.log('Order creation result:', orderResult);
        
        if (orderResult && orderResult.orderId) {
            const orderId = orderResult.orderId;
            console.log(`\n4. Testing getOrderStatus for order ${orderId}...`);
            const status = await exchange.getOrderStatus(orderId);
            console.log('Order status result:', status);
            
            console.log(`\n5. Testing getOrderDetails for order ${orderId}...`);
            const details = await exchange.getOrderDetails(orderId);
            console.log('Order details result:', details);
        }
        
        console.log('\n=== Authentication Test Completed Successfully ===');
    } catch (error) {
        console.error('Error in authentication test:', error.message);
        if (error.response) {
            console.error('Response data:', error.response.data);
            console.error('Response status:', error.response.status);
        }
    }
}

// Run the test
testAuthentication();
