require('dotenv').config();
const axios = require('axios');
const crypto = require('crypto');

// P2PB2B API authentication test
async function testP2PB2BAuth() {
    console.log('=== P2PB2B Authentication Test ===');
    
    // Get API credentials
    const apiKey = process.env.P2PB2B_API_KEY;
    const secretKey = process.env.P2PB2B_SECRET_KEY;
    
    if (!apiKey || !secretKey) {
        console.error('API keys are missing. Please check your .env file.');
        return;
    }
    
    console.log('API Key:', apiKey.substring(0, 5) + '...');
    console.log('Secret Key Length:', secretKey.length);
    
    try {
        // Test account balance endpoint (requires authentication)
        const baseUrl = 'https://api.p2pb2b.com';
        const endpoint = '/api/v2/account/balances';
        
        // Create request payload according to P2PB2B API docs
        const nonce = Date.now();
        const requestBody = {
            request: endpoint,
            nonce: nonce
        };
        
        // Generate authentication headers
        const payload = Buffer.from(JSON.stringify(requestBody)).toString('base64');
        const signature = crypto
            .createHmac('sha512', secretKey)
            .update(payload)
            .digest('hex');
        
        const headers = {
            'Content-Type': 'application/json',
            'X-TXC-APIKEY': apiKey,
            'X-TXC-PAYLOAD': payload,
            'X-TXC-SIGNATURE': signature
        };
        
        console.log('\nSending authenticated request to P2PB2B...');
        console.log('Endpoint:', endpoint);
        console.log('Request Body:', JSON.stringify(requestBody));
        console.log('Headers:', {
            'X-TXC-APIKEY': apiKey.substring(0, 5) + '...',
            'X-TXC-PAYLOAD': payload.substring(0, 10) + '...',
            'X-TXC-SIGNATURE': signature.substring(0, 10) + '...'
        });
        
        // Make the API request
        const response = await axios.post(
            `${baseUrl}${endpoint}`,
            requestBody,
            { headers }
        );
        
        console.log('\nResponse Status:', response.status);
        
        if (response.data.success) {
            console.log('Authentication successful!');
            console.log('Available balances:');
            
            // Display a few balances as example
            const balances = response.data.result;
            const currencies = Object.keys(balances).slice(0, 5);
            
            currencies.forEach(currency => {
                console.log(`${currency}: Available: ${balances[currency].available}, Freeze: ${balances[currency].freeze}`);
            });
            
            if (currencies.length < Object.keys(balances).length) {
                console.log(`... and ${Object.keys(balances).length - currencies.length} more currencies`);
            }
        } else {
            console.error('API returned error:', response.data);
        }
    } catch (error) {
        console.error('\nError testing P2PB2B authentication:');
        
        if (error.response) {
            console.error('Status:', error.response.status);
            console.error('Response:', error.response.data);
        } else {
            console.error(error.message);
        }
    }
}

// Run the test
testP2PB2BAuth();
