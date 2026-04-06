// Test script for P2PB2B bot with fixed price adjustment approach
require('dotenv').config();
const { FixedAdjustmentP2PB2BBot } = require('./p2pb2b-fixed-adjustment');

async function testFixedAdjustmentBot() {
    try {
        console.log('=== Testing P2PB2B Bot with Fixed Price Adjustment Approach ===');
        
        // Create bot instance
        const bot = new FixedAdjustmentP2PB2BBot();
        
        // Force a specific number of orders for testing
        bot.targetOrdersInCurrentCycle = 2; // Set to 2 orders for testing
        bot.ordersInCurrentCycle = 0;
        bot.currentCycle = 1;
        
        console.log('\nStarting test with 2 orders...');
        console.log('This will create orders with the fixed price adjustment approach:');
        console.log('1. For BUY orders: Create order at 0.001 below current ask price');
        console.log('2. For SELL orders: Create order at 0.001 above current ask price');
        console.log('3. Immediately create matching order with same price to fill it');
        
        // Override the executeTrade method to stop after one cycle
        const originalExecuteTrade = bot.executeTrade;
        let cycleCompleted = false;
        
        bot.executeTrade = async function(exchange, symbol) {
            if (cycleCompleted) {
                console.log('\n=== Test completed successfully ===');
                console.log('Completed one full trading cycle with fixed price adjustment approach');
                return;
            }
            
            // Call original method
            await originalExecuteTrade.call(this, exchange, symbol);
            
            // Check if cycle is completed
            if (this.ordersInCurrentCycle >= this.targetOrdersInCurrentCycle) {
                cycleCompleted = true;
                console.log('\n=== Full cycle test completed successfully ===');
                console.log(`Completed ${this.ordersInCurrentCycle} orders in cycle #${this.currentCycle}`);
                console.log('The bot is now using the fixed price adjustment approach');
            }
        };
        
        // Start trading with P2PB2B exchange and BRIL_USDT symbol
        await bot.startTrading('P2PB2B', 'BRIL/USDT');
        
    } catch (error) {
        console.error('Error in fixed adjustment bot test:', error.message);
    }
}

// Run the test
testFixedAdjustmentBot();
