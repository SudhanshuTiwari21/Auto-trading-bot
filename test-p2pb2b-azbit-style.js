// Test script for P2PB2B bot with Azbit-style trading approach
require('dotenv').config();
const { AzbitStyleP2PB2BBot } = require('./p2pb2b-azbit-style');

async function testAzbitStyleBot() {
    try {
        console.log('=== Testing P2PB2B Bot with Azbit-style Trading Approach ===');
        
        // Create bot instance
        const bot = new AzbitStyleP2PB2BBot();
        
        // Force a specific number of orders for testing
        bot.targetOrdersInCurrentCycle = 2; // Set to 2 orders for testing
        bot.ordersInCurrentCycle = 0;
        bot.currentCycle = 1;
        
        console.log('\nStarting test with 2 orders...');
        console.log('This will create orders with the Azbit-style approach:');
        console.log('1. Create first order at price 2% better than market');
        console.log('2. Immediately create matching order with same price to fill it');
        
        // Override the executeTrade method to stop after one cycle
        const originalExecuteTrade = bot.executeTrade;
        let cycleCompleted = false;
        
        bot.executeTrade = async function(exchange, symbol) {
            if (cycleCompleted) {
                console.log('\n=== Test completed successfully ===');
                console.log('Completed one full trading cycle with Azbit-style approach');
                return;
            }
            
            // Call original method
            await originalExecuteTrade.call(this, exchange, symbol);
            
            // Check if cycle is completed
            if (this.ordersInCurrentCycle >= this.targetOrdersInCurrentCycle) {
                cycleCompleted = true;
                console.log('\n=== Full cycle test completed successfully ===');
                console.log(`Completed ${this.ordersInCurrentCycle} orders in cycle #${this.currentCycle}`);
                console.log('The bot is now using the Azbit-style trading approach');
            }
        };
        
        // Start trading with P2PB2B exchange and BRIL_USDT symbol
        await bot.startTrading('P2PB2B', 'BRIL/USDT');
        
    } catch (error) {
        console.error('Error in Azbit-style bot test:', error.message);
    }
}

// Run the test
testAzbitStyleBot();
