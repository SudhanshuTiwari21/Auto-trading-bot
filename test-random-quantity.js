// Test script for P2PB2B bot with random quantity for each order
require('dotenv').config();
const { RandomQuantityP2PB2BBot } = require('./p2pb2b-random-quantity');

async function testRandomQuantityBot() {
    try {
        console.log('=== Testing P2PB2B Bot with Random Quantity ===');
        
        // Create bot instance
        const bot = new RandomQuantityP2PB2BBot();
        
        // Force a specific number of orders for testing
        bot.targetOrdersInCurrentCycle = 3; // Set to 3 orders for testing
        bot.ordersInCurrentCycle = 0;
        bot.currentCycle = 1;
        
        console.log('\nStarting test with 3 orders...');
        console.log('This bot will:');
        console.log('1. Generate a random token amount between 0.2 and 1.0 for each order');
        console.log('2. Create both buy and sell orders at 0.001 below the current ask price');
        console.log('3. Immediately create matching orders with the same price and amount');
        
        // Display min and max token amounts
        console.log(`\nRandom token amount range: ${bot.minTokenAmount} to ${bot.maxTokenAmount}`);
        
        // Show some sample random amounts
        console.log('\nSample random token amounts:');
        for (let i = 0; i < 5; i++) {
            console.log(`Sample ${i+1}: ${bot.getRandomTokenAmount().toFixed(1)}`);
        }
        
        // Override the executeTrade method to stop after one cycle
        const originalExecuteTrade = bot.executeTrade;
        let cycleCompleted = false;
        
        bot.executeTrade = async function(exchange, symbol) {
            if (cycleCompleted) {
                console.log('\n=== Test completed successfully ===');
                console.log('Completed one full trading cycle with random quantity for each order');
                return;
            }
            
            // Call original method
            await originalExecuteTrade.call(this, exchange, symbol);
            
            // Check if cycle is completed
            if (this.ordersInCurrentCycle >= this.targetOrdersInCurrentCycle) {
                cycleCompleted = true;
                console.log('\n=== Full cycle test completed successfully ===');
                console.log(`Completed ${this.ordersInCurrentCycle} orders in cycle #${this.currentCycle}`);
                console.log('The bot is now using random quantities for each order');
            }
        };
        
        // Start trading with P2PB2B exchange and BRIL_USDT symbol
        await bot.startTrading('P2PB2B', 'BRIL/USDT');
        
    } catch (error) {
        console.error('Error in random quantity bot test:', error.message);
    }
}

// Run the test
testRandomQuantityBot();
