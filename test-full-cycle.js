// Test script for P2PB2B full trading cycle
require('dotenv').config();
const { AutoTradingBot2 } = require('./bot2');

async function testFullCycle() {
    try {
        console.log('=== Testing P2PB2B Full Trading Cycle ===');
        
        // Create bot instance
        const bot = new AutoTradingBot2();
        
        // Force a specific number of orders for testing
        bot.targetOrdersInCurrentCycle = 2; // Set to 2 orders for testing
        bot.ordersInCurrentCycle = 0;
        bot.currentCycle = 1;
        
        console.log('\nStarting full cycle test with 2 orders...');
        console.log('This will create 1 buy order and 1 sell order');
        
        // Override the executeTrade method to stop after one cycle
        const originalExecuteTrade = bot.executeTrade;
        let cycleCompleted = false;
        
        bot.executeTrade = async function(exchange, symbol) {
            if (cycleCompleted) {
                console.log('\n=== Test completed successfully ===');
                console.log('Completed one full trading cycle with multiple orders');
                return;
            }
            
            // Call original method
            await originalExecuteTrade.call(this, exchange, symbol);
            
            // Check if cycle is completed
            if (this.ordersInCurrentCycle >= this.targetOrdersInCurrentCycle) {
                cycleCompleted = true;
                console.log('\n=== Full cycle test completed successfully ===');
                console.log(`Completed ${this.ordersInCurrentCycle} orders in cycle #${this.currentCycle}`);
            }
        };
        
        // Start trading with P2PB2B exchange and BRIL_USDT symbol
        await bot.startTrading('P2PB2B', 'BRIL/USDT');
        
    } catch (error) {
        console.error('Error in full cycle test:', error.message);
    }
}

// Run the test
testFullCycle();
