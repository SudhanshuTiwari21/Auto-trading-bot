// Test script for P2PB2B bot with both buy and sell orders below ask price
require('dotenv').config();
const { BothBelowAskP2PB2BBot } = require('./p2pb2b-both-below');

async function testBothBelowAskBot() {
    try {
        console.log('=== Testing P2PB2B Bot with Both Orders Below Ask Price ===');
        
        // Create bot instance
        const bot = new BothBelowAskP2PB2BBot();
        
        // Force a specific number of orders for testing
        bot.targetOrdersInCurrentCycle = 2; // Set to 2 orders for testing
        bot.ordersInCurrentCycle = 0;
        bot.currentCycle = 1;
        
        console.log('\nStarting test with 2 orders...');
        console.log('This will create orders with both buy and sell below ask price:');
        console.log('1. For BUY orders: Create order at 0.001 below current ask price');
        console.log('2. For SELL orders: Also create order at 0.001 below current ask price');
        console.log('3. Immediately create matching order with same price to fill it');
        
        // Override the executeTrade method to stop after one cycle
        const originalExecuteTrade = bot.executeTrade;
        let cycleCompleted = false;
        
        bot.executeTrade = async function(exchange, symbol) {
            if (cycleCompleted) {
                console.log('\n=== Test completed successfully ===');
                console.log('Completed one full trading cycle with both orders below ask price');
                return;
            }
            
            // Call original method
            await originalExecuteTrade.call(this, exchange, symbol);
            
            // Check if cycle is completed
            if (this.ordersInCurrentCycle >= this.targetOrdersInCurrentCycle) {
                cycleCompleted = true;
                console.log('\n=== Full cycle test completed successfully ===');
                console.log(`Completed ${this.ordersInCurrentCycle} orders in cycle #${this.currentCycle}`);
                console.log('The bot is now using the both-below-ask pricing approach');
            }
        };
        
        // Start trading with P2PB2B exchange and BRIL_USDT symbol
        await bot.startTrading('P2PB2B', 'BRIL/USDT');
        
    } catch (error) {
        console.error('Error in both-below-ask bot test:', error.message);
    }
}

// Run the test
testBothBelowAskBot();
