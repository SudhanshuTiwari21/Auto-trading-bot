require('dotenv').config();
const P2PB2BExchange = require('./exchanges/p2pb2b');

// Function to test API connectivity
async function testApiConnection() {
    console.log('=== P2PB2B API Key Test ===');
    
    // Check if API keys are set in environment variables
    const apiKey = process.env.P2PB2B_API_KEY;
    const secretKey = process.env.P2PB2B_SECRET_KEY;
    
    console.log('API Key:', apiKey ? `Present (starts with ${apiKey.substring(0, 3)}...)` : 'Missing');
    console.log('Secret Key:', secretKey ? `Present (length: ${secretKey.length})` : 'Missing');
    
    if (!apiKey || !secretKey) {
        console.error('\nERROR: API keys are missing. Please check your .env file.');
        console.log('\nYour .env file should contain:');
        console.log('P2PB2B_API_KEY=your_api_key_here');
        console.log('P2PB2B_SECRET_KEY=your_secret_key_here');
        return;
    }
    
    try {
        // Initialize exchange
        const exchange = new P2PB2BExchange(apiKey, secretKey);
        
        // Test a simple API call that requires authentication
        console.log('\nTesting API connection...');
        const balances = await exchange.getBalance();
        console.log('API connection successful!');
        console.log('Balance:', balances);
        
        // Test market data retrieval
        console.log('\nTesting market data retrieval...');
        const marketPrice = await exchange.getMarketPrice('BRIL/USDT');
        console.log('Market price retrieved successfully:');
        console.log(marketPrice);
        
        console.log('\nAll tests passed! Your API keys are working correctly.');
    } catch (error) {
        console.error('\nAPI Test Failed:', error.message);
        console.error('\nPlease check your API keys and make sure they have the correct permissions.');
    }
}

// Run the test
testApiConnection();
