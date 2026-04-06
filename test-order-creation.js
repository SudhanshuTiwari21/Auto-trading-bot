require('dotenv').config();
const axios = require('axios');
const crypto = require('crypto');

// P2PB2B Order Creation Test
async function testOrderCreation() {
    console.log('=== P2PB2B Order Creation Test ===');
    
    // Get API credentials
    const apiKey = process.env.P2PB2B_API_KEY;
    const secretKey = process.env.P2PB2B_SECRET_KEY;
    
    if (!apiKey || !secretKey) {
        console.error('API keys are missing. Please check your .env file.');
        return;
    }
    
    console.log('API Key:', apiKey.substring(0, 5) + '...');
    
    try {
        // Market parameters
        const market = 'BRIL_USDT';
        const side = 'buy';
        const amount = '1.5'; // Increased amount to meet minimum total
        const price = '0.7'; // Set a price below market to avoid actual execution
        
        // Calculate total order value
        const totalValue = parseFloat(amount) * parseFloat(price);
        console.log(`Total order value: ${totalValue} USDT (minimum required: 1 USDT)`);
        
        // Create order directly using the API
        const baseUrl = 'https://api.p2pb2b.com';
        const endpoint = '/api/v2/order/new';
        
        // First, get market info to check limits
        console.log(`\nFetching market info for ${market}...`);
        const marketInfoResponse = await axios.get(`${baseUrl}/api/v2/public/market?market=${market}`);
        
        if (!marketInfoResponse.data.success) {
            throw new Error(`Failed to get market info: ${JSON.stringify(marketInfoResponse.data)}`);
        }
        
        const marketInfo = marketInfoResponse.data.result;
        console.log('Market limits:', marketInfo.limits);
        
        // Validate amount and price against limits
        const minAmount = parseFloat(marketInfo.limits.min_amount);
        const maxAmount = parseFloat(marketInfo.limits.max_amount);
        const stepSize = parseFloat(marketInfo.limits.step_size);
        const minPrice = parseFloat(marketInfo.limits.min_price);
        const maxPrice = parseFloat(marketInfo.limits.max_price);
        const tickSize = parseFloat(marketInfo.limits.tick_size);
        const minTotal = parseFloat(marketInfo.limits.min_total);
        
        // Round amount to step_size precision
        const roundedAmount = Math.ceil(parseFloat(amount) / stepSize) * stepSize;
        
        // Round price to tick_size precision
        const roundedPrice = Math.floor(parseFloat(price) / tickSize) * tickSize;
        
        // Format with proper precision
        const formattedAmount = roundedAmount.toFixed(String(stepSize).includes('.') ? String(stepSize).split('.')[1].length : 0);
        const formattedPrice = roundedPrice.toFixed(String(tickSize).includes('.') ? String(tickSize).split('.')[1].length : 0);
        
        console.log(`Rounded amount: ${formattedAmount} (min: ${minAmount}, step: ${stepSize})`);
        console.log(`Rounded price: ${formattedPrice} (min: ${minPrice}, tick: ${tickSize})`);
        
        // Calculate total order value
        const totalOrderValue = roundedAmount * roundedPrice;
        console.log(`Total order value: ${totalOrderValue} (min: ${minTotal})`);
        
        // Create request payload according to P2PB2B API docs
        const nonce = Date.now();
        const requestBody = {
            market: market,
            side: side,
            amount: formattedAmount,
            price: formattedPrice,
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
        
        console.log('\nSending order creation request to P2PB2B...');
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
            console.log('✅ Order created successfully!');
            console.log('Order ID:', response.data.result.orderId);
            console.log('Order Details:', JSON.stringify(response.data.result, null, 2));
        } else {
            console.error('❌ API returned error:', response.data);
        }
    } catch (error) {
        console.error('\nError creating order:');
        
        if (error.response) {
            console.error('Status:', error.response.status);
            console.error('Response:', error.response.data);
        } else {
            console.error(error.message);
        }
    }
}

// Run the test
testOrderCreation();
