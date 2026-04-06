// Test script for P2PB2B trading cycle
require('dotenv').config();
const { AutoTradingBot2 } = require('./bot2');

async function testTradingCycle() {
    try {
        console.log('=== Testing P2PB2B Trading Cycle ===');
        
        // Create bot instance
        const bot = new AutoTradingBot2();
        
        // Start trading with a single cycle
        console.log('\nStarting trading cycle test...');
        
        // Override the executeTrade method to only run one cycle
        const originalExecuteTrade = bot.executeTrade;
        let cycleCount = 0;
        
        bot.executeTrade = async function(exchange, symbol) {
            if (cycleCount > 0) {
                console.log('\n=== Test completed successfully ===');
                console.log('Completed one full trading cycle');
                return;
            }
            
            cycleCount++;
            return originalExecuteTrade.call(this, exchange, symbol);
        };
        
        // Start trading with P2PB2B exchange and BRIL_USDT symbol
        await bot.startTrading('P2PB2B', 'BRIL/USDT');
        
    } catch (error) {
        console.error('Error in trading cycle test:', error.message);
    }
}

// Run the test
testTradingCycle();
