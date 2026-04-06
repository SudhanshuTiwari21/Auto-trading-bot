// Test script for P2PB2B order details API
require('dotenv').config();
const axios = require('axios');
const crypto = require('crypto');

// API credentials from environment variables
const API_KEY = process.env.P2PB2B_API_KEY;
const SECRET_KEY = process.env.P2PB2B_SECRET_KEY;
const BASE_URL = 'https://api.p2pb2b.com';

// Order ID to check (pass as command line argument)
const orderId = process.argv[2];

if (!orderId) {
    console.error('Please provide an order ID as a command line argument');
    console.error('Example: node test-order-details.js 123456789');
    process.exit(1);
}

// Generate signature for API authentication
function generateSignature(payload) {
    return crypto
        .createHmac('sha512', SECRET_KEY)
        .update(payload)
        .digest('hex');
}

// Generate headers for API request
function generateHeaders(endpoint, data = {}) {
    // Create the payload with request and nonce
    const nonce = Date.now();
    const payload = {
        ...data,
        request: endpoint,
        nonce: nonce
    };

    // Convert payload to base64
    const payloadBase64 = Buffer.from(JSON.stringify(payload)).toString('base64');
    
    // Generate signature
    const signature = generateSignature(payloadBase64);
    
    // Return headers
    return {
        'Content-Type': 'application/json',
        'X-TXC-APIKEY': API_KEY,
        'X-TXC-PAYLOAD': payloadBase64,
        'X-TXC-SIGNATURE': signature
    };
}

// Get order details using account/order endpoint
async function getOrderDetails(orderId) {
    try {
        const endpoint = '/api/v2/account/order';
        
        // Create the request body according to P2PB2B API docs
        const data = {
            orderId: orderId.toString(),
            limit: 50,
            offset: 0
        };
        
        // The request body must include the request and nonce fields
        const nonce = Date.now();
        const requestBody = {
            ...data,
            request: endpoint,
            nonce: nonce
        };
        
        // Generate headers
        const headers = generateHeaders(endpoint, data);

        console.log(`Getting details for order ${orderId}...`);
        console.log('Request body:', JSON.stringify(requestBody, null, 2));
        console.log('Headers:', JSON.stringify(headers, null, 2));
        
        const response = await axios.post(
            `${BASE_URL}${endpoint}`,
            requestBody,
            { headers }
        );

        if (!response.data.success) {
            console.error('P2PB2B API Error:', response.data);
            return { 
                id: orderId,
                status: 'error', 
                error: response.data.message || 'Unknown error' 
            };
        }

        // Process the order details
        const result = response.data.result;
        console.log(`Order details response:`, JSON.stringify(result, null, 2));
        
        // Determine order status based on records (trades)
        let status = 'open';
        let filled = '0';
        let totalDeal = '0';
        
        // If there are trade records, the order has been at least partially filled
        if (result.records && result.records.length > 0) {
            // Calculate total amount from all trades
            let totalAmount = 0;
            result.records.forEach(trade => {
                totalAmount += parseFloat(trade.amount);
                totalDeal = (parseFloat(totalDeal) + parseFloat(trade.deal)).toString();
            });
            
            // For more accurate fill percentage, we would need to combine this with getOrderStatus
            filled = totalAmount.toString();
            status = 'partially_filled'; // Default to partially filled when we have trades
            
            // If we have trades but don't know if it's fully filled, we'll assume it's completed
            if (result.records.length > 0) {
                status = 'completed';
                filled = '100';
            }
        }

        return {
            id: orderId,
            status: status,
            filled: filled,
            totalDeal: totalDeal,
            trades: result.records || []
        };
    } catch (error) {
        console.error('Error getting order details:', error.message);
        if (error.response) {
            console.error('Response data:', error.response.data);
            console.error('Response status:', error.response.status);
            console.error('Response headers:', error.response.headers);
        }
        console.error(error.stack);
        
        // Return a default response with unknown status
        return {
            id: orderId,
            status: 'unknown',
            error: error.message
        };
    }
}

// Get order status using order/status endpoint
async function getOrderStatus(orderId) {
    try {
        const endpoint = '/api/v2/order/status';
        const data = {
            orderId: orderId.toString()
        };
        
        // The request body must include the request and nonce fields
        const nonce = Date.now();
        const requestBody = {
            ...data,
            request: endpoint,
            nonce: nonce
        };
        
        // Generate headers
        const headers = generateHeaders(endpoint, data);

        console.log(`Getting status for order ${orderId}...`);
        console.log('Request body:', JSON.stringify(requestBody, null, 2));
        
        const response = await axios.post(
            `${BASE_URL}${endpoint}`,
            requestBody,
            { headers }
        );

        if (!response.data.success) {
            console.error('P2PB2B API Error:', response.data);
            return { status: 'error', message: response.data.message || 'Unknown error' };
        }

        // Calculate fill percentage
        const result = response.data.result;
        console.log(`Order status response:`, JSON.stringify(result, null, 2));
        
        // Handle case where result might be empty or missing expected fields
        if (!result || !result.amount) {
            return { 
                status: 'unknown',
                message: 'Invalid response format from P2PB2B API'
            };
        }
        
        const amount = parseFloat(result.amount);
        const remaining = parseFloat(result.left);
        const filled = amount > 0 ? ((amount - remaining) / amount) * 100 : 0;

        return {
            status: 'success',
            filled: filled.toFixed(2),
            amount: result.amount,
            price: result.price,
            side: result.side,
            remaining: result.left
        };
    } catch (error) {
        console.error('Error getting order status:', error.message);
        if (error.response) {
            console.error('Response data:', error.response.data);
            console.error('Response status:', error.response.status);
            console.error('Response headers:', error.response.headers);
        }
        
        return { 
            status: 'error', 
            message: error.message 
        };
    }
}

// Run both API calls to compare results
async function run() {
    console.log('=== Testing P2PB2B Order Details API ===');
    console.log(`Order ID: ${orderId}`);
    
    try {
        // Get order status
        console.log('\n=== Order Status ===');
        const statusResult = await getOrderStatus(orderId);
        console.log('Status Result:', JSON.stringify(statusResult, null, 2));
        
        // Get order details
        console.log('\n=== Order Details ===');
        const detailsResult = await getOrderDetails(orderId);
        console.log('Details Result:', JSON.stringify(detailsResult, null, 2));
        
        console.log('\n=== Summary ===');
        console.log(`Order ID: ${orderId}`);
        console.log(`Status: ${statusResult.status === 'success' ? 'Available' : 'Not Available'}`);
        console.log(`Details: ${detailsResult.trades && detailsResult.trades.length > 0 ? 'Available' : 'Not Available'}`);
        
        if (statusResult.status === 'success') {
            console.log(`Fill Percentage: ${statusResult.filled}%`);
            console.log(`Amount: ${statusResult.amount}`);
            console.log(`Price: ${statusResult.price}`);
            console.log(`Side: ${statusResult.side}`);
        }
        
        if (detailsResult.trades && detailsResult.trades.length > 0) {
            console.log(`Trade Count: ${detailsResult.trades.length}`);
            console.log(`Total Deal Value: ${detailsResult.totalDeal}`);
        }
    } catch (error) {
        console.error('Error running test:', error.message);
    }
}

// Execute the test
run();
