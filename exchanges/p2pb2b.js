const axios = require('axios');
const crypto = require('crypto');

class P2PB2BExchange {
    constructor(apiKey, secretKey) {
        this.apiKey = apiKey;
        this.secretKey = secretKey;
        this.baseUrl = 'https://api.p2pb2b.com';
        this.marketLimitsCache = {};
    }

    formatMarketSymbol(market) {
        // Convert BRIL/USDT to BRIL_USDT
        return market.replace('/', '_').toUpperCase();
    }

    generateSignature(payload) {
        return crypto
            .createHmac('sha512', this.secretKey)
            .update(payload)
            .digest('hex');
    }

    generateHeaders(endpoint, data = {}) {
        // Create the request body with required fields
        const nonce = Date.now();
        const requestBody = {
            ...data,
            request: endpoint,
            nonce: nonce
        };

        // According to P2PB2B API docs, payload must be a base64 encoded JSON string
        const payload = Buffer.from(JSON.stringify(requestBody)).toString('base64');
        const signature = this.generateSignature(payload);

        console.log('Sending request to P2PB2B with headers:', {
            'X-TXC-APIKEY': this.apiKey ? this.apiKey.substring(0, 5) + '...' : 'undefined',
            'X-TXC-PAYLOAD': payload ? payload.substring(0, 10) + '...' : 'undefined',
            'X-TXC-SIGNATURE': signature ? signature.substring(0, 10) + '...' : 'undefined'
        });

        // Return only the authentication headers, Content-Type will be added separately
        return {
            'X-TXC-APIKEY': this.apiKey,
            'X-TXC-PAYLOAD': payload,
            'X-TXC-SIGNATURE': signature
        };
    }

    async getBalance(currency = 'USDT') {
        try {
            if (process.env.TEST_MODE === 'true') {
                const testBalance = parseFloat(process.env.TEST_BALANCE || '100');
                console.log('\nUsing test balance:', testBalance, 'USDT');
                return testBalance;
            }

            const endpoint = '/api/v2/account/balances';
            const requestBody = {
                request: endpoint,
                nonce: Date.now()
            };

            const payload = Buffer.from(JSON.stringify(requestBody)).toString('base64');
            const signature = this.generateSignature(payload);

            const headers = {
                'Content-Type': 'application/json',
                'X-TXC-APIKEY': this.apiKey,
                'X-TXC-PAYLOAD': payload,
                'X-TXC-SIGNATURE': signature
            };

            console.log('Sending request to P2PB2B with headers:', {
                'X-TXC-APIKEY': this.apiKey.substring(0, 5) + '...',
                'X-TXC-PAYLOAD': payload.substring(0, 10) + '...',
                'X-TXC-SIGNATURE': signature.substring(0, 10) + '...'
            });

            const response = await axios.post(
                `${this.baseUrl}${endpoint}`,
                requestBody,
                { headers }
            );

            if (!response.data.success) {
                throw new Error(`P2PB2B API Error: ${JSON.stringify(response.data)}`);
            }

            const balances = response.data.result;
            const balance = balances[currency];

            if (!balance) {
                throw new Error(`Balance for ${currency} not found`);
            }

            return parseFloat(balance.available) + parseFloat(balance.freeze);
        } catch (error) {
            console.error('Error getting P2PB2B balance:', error.message);
            throw error;
        }
    }

    /** Free balance only — use for sizing new orders (available + freeze overstates spendable USDT/BRIL). */
    async getAvailableBalance(currency = 'USDT') {
        try {
            if (process.env.TEST_MODE === 'true') {
                if (currency === 'USDT') {
                    return parseFloat(process.env.TEST_BALANCE || '100');
                }
                return parseFloat(process.env.TEST_BRIL_BALANCE || process.env.TEST_BALANCE || '100');
            }

            const endpoint = '/api/v2/account/balances';
            const requestBody = { request: endpoint, nonce: Date.now() };
            const payload = Buffer.from(JSON.stringify(requestBody)).toString('base64');
            const signature = this.generateSignature(payload);
            const headers = {
                'Content-Type': 'application/json',
                'X-TXC-APIKEY': this.apiKey,
                'X-TXC-PAYLOAD': payload,
                'X-TXC-SIGNATURE': signature
            };

            const response = await axios.post(`${this.baseUrl}${endpoint}`, requestBody, { headers });
            if (!response.data.success) {
                throw new Error(`P2PB2B API Error: ${JSON.stringify(response.data)}`);
            }
            const balances = response.data.result;
            const row = balances[currency];
            if (!row) {
                throw new Error(`Balance for ${currency} not found`);
            }
            return parseFloat(row.available);
        } catch (error) {
            console.error('Error getting P2PB2B available balance:', error.message);
            throw error;
        }
    }

    /**
     * Some pairs (e.g. BRIL_USDT) are listed under /api/v2/alpha/markets only (`enabledInPublicAPI: false`).
     * Public ticker/market return 400 for those; use /api/v2/alpha/ticker and /api/v2/alpha/market.
     * @see https://api.p2pb2b.com/api/v2/alpha/markets
     */
    async _fetchTicker(formattedMarket) {
        let response;
        try {
            response = await axios.get(
                `${this.baseUrl}/api/v2/public/ticker?market=${formattedMarket}`
            );
            if (response.data?.success && response.data.result) {
                return response;
            }
        } catch (e) {
            const status = e.response?.status;
            if (status !== 400 && status !== 404) {
                throw e;
            }
        }
        response = await axios.get(
            `${this.baseUrl}/api/v2/alpha/ticker?market=${formattedMarket}`
        );
        if (!response.data?.success || !response.data.result) {
            throw new Error(
                `P2PB2B ticker error: ${response.data?.message || 'alpha ticker failed'}`
            );
        }
        return response;
    }

    async _fetchMarketMeta(formattedMarket) {
        let response;
        try {
            response = await axios.get(
                `${this.baseUrl}/api/v2/public/market?market=${formattedMarket}`
            );
            if (response.data?.success && response.data.result) {
                return response;
            }
        } catch (e) {
            const status = e.response?.status;
            if (status !== 400 && status !== 404) {
                throw e;
            }
        }
        response = await axios.get(
            `${this.baseUrl}/api/v2/alpha/market?market=${formattedMarket}`
        );
        if (!response.data?.success || !response.data.result) {
            throw new Error(
                `P2PB2B market info error: ${response.data?.message || 'alpha market failed'}`
            );
        }
        return response;
    }

    async getMarketPrice(market) {
        try {
            const formattedMarket = this.formatMarketSymbol(market);
            console.log('Getting market price for:', formattedMarket);

            // First check if the market exists
            const markets = await this.getMarkets();
            if (!markets.includes(formattedMarket)) {
                throw new Error(`Market ${formattedMarket} not found. Available markets: ${markets.join(', ')}`);
            }

            const response = await this._fetchTicker(formattedMarket);
            const r = response.data.result;

            return {
                bid: parseFloat(r.bid),
                ask: parseFloat(r.ask),
                last: parseFloat(r.last)
            };
        } catch (error) {
            console.error('Error getting P2PB2B market price:', error.message);
            throw error;
        }
    }

    async getMarkets() {
        const names = new Set();
        try {
            const pub = await axios.get(`${this.baseUrl}/api/v2/public/markets`);
            if (pub.data?.success && Array.isArray(pub.data.result)) {
                pub.data.result.forEach((m) => names.add(m.name));
            }
        } catch (error) {
            console.error('Error getting public markets:', error.message);
        }
        try {
            const alpha = await axios.get(`${this.baseUrl}/api/v2/alpha/markets`);
            if (alpha.data?.success && Array.isArray(alpha.data.result)) {
                alpha.data.result.forEach((m) => names.add(m.name));
            }
        } catch (error) {
            console.error('Error getting alpha markets:', error.message);
        }
        if (names.size === 0) {
            throw new Error('Could not load markets from P2PB2B (public + alpha)');
        }
        return [...names].sort();
    }

    async getMarketLimits(market) {
        try {
            const formattedMarket = this.formatMarketSymbol(market);
            const response = await this._fetchMarketMeta(formattedMarket);

            const marketInfo = response.data.result;
            console.log(`Market limits for ${market}:`, marketInfo.limits);

            // Cache the market limits
            this.marketLimitsCache[market] = {
                limits: marketInfo.limits,
                timestamp: Date.now()
            };

            return marketInfo.limits;
        } catch (error) {
            console.error(`Error fetching market limits for ${market}:`, error.message);

            // If we have cached limits, use them as fallback
            if (this.marketLimitsCache[market]) {
                console.log(`Using cached market limits for ${market} as fallback`);
                return this.marketLimitsCache[market].limits;
            }

            // If no cached limits, use default limits for BRIL_USDT
            if (market === 'BRIL_USDT') {
                console.log('Using default limits for BRIL_USDT');
                return {
                    min_amount: '0.1',
                    max_amount: '10000000',
                    step_size: '0.1',
                    min_price: '0.0001',
                    max_price: '100000',
                    tick_size: '0.0001',
                    min_total: '1'  // Minimum total order value in USDT
                };
            }

            throw error;
        }
    }

    async createOrder(market, side, amount, price) {
        try {
            if (process.env.TEST_MODE === 'true') {
                console.log(`Test mode: Creating ${side} order for ${market}`);
                return {
                    orderId: Math.floor(Math.random() * 1000000000).toString(),
                    market: market,
                    side: side,
                    amount: amount,
                    price: price,
                    timestamp: Date.now()
                };
            }

            // Format market symbol
            const formattedMarket = this.formatMarketSymbol(market);
            console.log('Creating order for market:', formattedMarket);

            // Validate amount and price against market limits
            const limits = await this.getMarketLimits(formattedMarket);

            // Round amount to step_size precision
            const stepSize = parseFloat(limits.step_size);
            const roundedAmount = Math.ceil(parseFloat(amount) / stepSize) * stepSize;

            // Round price to tick_size precision
            const tickSize = parseFloat(limits.tick_size);
            const roundedPrice = Math.floor(parseFloat(price) / tickSize) * tickSize;

            // Format with proper precision to avoid scientific notation
            let formattedAmount = roundedAmount.toFixed(String(stepSize).includes('.') ? String(stepSize).split('.')[1].length : 0);
            const formattedPrice = roundedPrice.toFixed(String(tickSize).includes('.') ? String(tickSize).split('.')[1].length : 6);

            // Calculate total order value
            const totalOrderValue = roundedAmount * roundedPrice;
            const minTotalValue = parseFloat(limits.min_total);

            console.log(`Rounded amount: ${formattedAmount} (min: ${limits.min_amount}, step: ${limits.step_size})`);
            console.log(`Rounded price: ${formattedPrice} (min: ${limits.min_price}, tick: ${limits.tick_size})`);
            console.log(`Total order value: ${totalOrderValue} (min: ${minTotalValue})`);

            // Validate amount against limits
            if (roundedAmount < parseFloat(limits.min_amount)) {
                throw new Error(`Amount ${formattedAmount} is below minimum ${limits.min_amount}`);
            }
            if (roundedAmount > parseFloat(limits.max_amount)) {
                throw new Error(`Amount ${formattedAmount} is above maximum ${limits.max_amount}`);
            }

            // Validate price against limits
            if (roundedPrice < parseFloat(limits.min_price)) {
                throw new Error(`Price ${formattedPrice} is below minimum ${limits.min_price}`);
            }
            if (roundedPrice > parseFloat(limits.max_price)) {
                throw new Error(`Price ${formattedPrice} is above maximum ${limits.max_price}`);
            }

            // Check if total order value meets minimum requirement
            if (totalOrderValue < minTotalValue) {
                // Calculate the minimum amount needed at the current price
                const minAmountNeeded = Math.ceil(minTotalValue / roundedPrice / stepSize) * stepSize;        
                const adjustedAmount = minAmountNeeded.toFixed(String(stepSize).includes('.') ? String(stepSize).split('.')[1].length : 0);

                console.log(`\nWARNING: Total order value ${totalOrderValue} is below minimum ${minTotalValue}`);
                console.log(`Adjusting amount from ${formattedAmount} to ${adjustedAmount} to meet minimum total value`);

                // Update the amount to meet minimum total value
                formattedAmount = adjustedAmount;
                const newTotalValue = parseFloat(adjustedAmount) * roundedPrice;
                console.log(`New total value: ${newTotalValue} USDT (minimum: ${minTotalValue} USDT)`);       
            }

            const endpoint = '/api/v2/order/new';

            // Create the data object according to P2PB2B API docs
            const data = {
                market: formattedMarket,
                side: side.toLowerCase(),
                amount: formattedAmount,
                price: formattedPrice
            };

            // Log the exact request data being sent
            console.log('Order request data:', JSON.stringify(data));

            // Generate headers with the request endpoint and data
            const headers = this.generateHeaders(endpoint, data);

            // The request body must include the request and nonce fields
            // This should match exactly what was used to generate the headers
            const requestBody = JSON.parse(Buffer.from(headers['X-TXC-PAYLOAD'], 'base64').toString());       

            try {
                const response = await axios.post(
                    `${this.baseUrl}${endpoint}`,
                    requestBody,
                    { headers: { ...headers, 'Content-Type': 'application/json' } }
                );

                if (!response.data.success) {
                    console.error('P2PB2B API Error:', response.data);
                    throw new Error(`P2PB2B API Error: ${response.data.message || 'Unknown error'}`);
                }

                console.log('Order created:', response.data.result);
                return response.data.result;
            } catch (apiError) {
                console.error('API Error Details:', apiError.response ? {
                    status: apiError.response.status,
                    statusText: apiError.response.statusText,
                    data: apiError.response.data
                } : apiError.message);

                throw apiError;
            }
        } catch (error) {
            console.error('Error creating P2PB2B order:', error.message);
            throw error;
        }
    }

    async getOrderStatus(orderId) {
        try {
            if (process.env.TEST_MODE === 'true') {
                console.log(`Test mode: Getting status for order ${orderId}`);
                return {
                    status: 'success',
                    filled: '100',
                    amount: '1',
                    price: '0.1',
                    side: 'buy',
                    remaining: '0'
                };
            }

            // First try to get order details using account/order endpoint
            // This seems more reliable than the order/status endpoint
            try {
                console.log(`Getting details for order ${orderId} using account/order endpoint...`);
                const orderDetails = await this.getOrderDetails(orderId);

                // If we have order details, use them to determine status
                if (orderDetails) {
                    // Determine if the order is completed based on trades
                    const isCompleted = orderDetails.trades && orderDetails.trades.length > 0;
                    const status = isCompleted ? 'completed' : 'open';

                    // If we have trades, calculate filled percentage
                    let filled = '0';
                    let amount = '0';
                    let price = '0';
                    let remaining = '0';

                    if (isCompleted) {
                        filled = '100';
                        amount = orderDetails.totalAmount || '0';
                        price = orderDetails.trades[0]?.price || '0';
                        remaining = '0';
                    }

                    return {
                        status: 'success',
                        filled: filled,
                        amount: amount,
                        price: price,
                        side: 'unknown', // We don't get side from account/order
                        remaining: remaining
                    };
                }
            } catch (detailsError) {
                console.error('Error getting order details:', detailsError.message);
                // Continue to try the order/status endpoint as fallback
            }

            // Fallback to order/status endpoint
            const endpoint = '/api/v2/order/status';
            const data = {
                orderId: orderId.toString()
            };

            // Generate headers with the request endpoint and data
            const headers = this.generateHeaders(endpoint, data);

            // The request body must match exactly what was used to generate the headers
            const requestBody = JSON.parse(Buffer.from(headers['X-TXC-PAYLOAD'], 'base64').toString());       

            try {
                console.log(`Getting status for order ${orderId} using order/status endpoint...`);
                const response = await axios.post(
                    `${this.baseUrl}${endpoint}`,
                    requestBody,
                    { headers: { ...headers, "Content-Type": "application/json" } }
                );

                if (!response.data.success) {
                    console.error('P2PB2B API Error:', response.data);
                    return { status: 'error', message: response.data.message || 'Unknown error' };
                }

                // Calculate fill percentage
                const result = response.data.result;
                console.log(`Order status response:`, result);

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
            } catch (apiError) {
                console.error('API Error Details:', apiError.response ? {
                    status: apiError.response.status,
                    statusText: apiError.response.statusText,
                    data: apiError.response.data
                } : apiError.message);

                // If we've already tried the account/order endpoint, just return error
                return {
                    status: 'error',
                    message: apiError.response?.data?.message || apiError.message
                };
            }
        } catch (error) {
            console.error('Error getting P2PB2B order status:', error.message);
            return { status: 'error', message: error.message };
        }
    }

    async getOrderDetails(orderId) {
        try {
            if (process.env.TEST_MODE === 'true') {
                console.log(`Test mode: Getting details for order ${orderId}`);
                return {
                    id: orderId,
                    status: 'completed',
                    totalAmount: '1',
                    totalDeal: '1',
                    trades: [{
                        id: '12345',
                        price: '0.1',
                        amount: '1',
                        deal: '0.1',
                        fee: '0',
                        time: Date.now() / 1000
                    }]
                };
            }

            const endpoint = '/api/v2/account/order';

            // Create the request body according to P2PB2B API docs
            const data = {
                orderId: orderId.toString(),
                limit: 50,
                offset: 0
            };

            // Generate headers with the request endpoint and data
            const headers = this.generateHeaders(endpoint, data);

            // The request body must match exactly what was used to generate the headers
            const requestBody = JSON.parse(Buffer.from(headers['X-TXC-PAYLOAD'], 'base64').toString());       

            console.log(`Getting details for order ${orderId}...`);
            const response = await axios.post(
                `${this.baseUrl}${endpoint}`,
                requestBody,
                { headers: { ...headers, "Content-Type": "application/json" } }
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
            let totalAmount = '0';
            let totalDeal = '0';

            // If there are trade records, the order has been at least partially filled
            if (result.records && result.records.length > 0) {
                // Calculate total amount and deal value from all trades
                let amountSum = 0;
                let dealSum = 0;

                result.records.forEach(trade => {
                    amountSum += parseFloat(trade.amount || 0);
                    dealSum += parseFloat(trade.deal || 0);
                });

                totalAmount = amountSum.toString();
                totalDeal = dealSum.toString();

                // If we have trades, consider the order completed
                // This is a simplification - in reality, an order could be partially filled
                status = 'completed';
            }

            return {
                id: orderId,
                status: status,
                totalAmount: totalAmount,
                totalDeal: totalDeal,
                trades: result.records || []
            };
        } catch (error) {
            console.error('Error getting order details:', error.message);
            if (error.response) {
                console.error('Response data:', error.response.data);
                console.error('Response status:', error.response.status);
            }

            // Return a default response with unknown status
            return {
                id: orderId,
                status: 'unknown',
                error: error.message
            };
        }
    }

    // Cancel an existing order
    async cancelOrder(orderId, market) {
        try {
            if (process.env.TEST_MODE === 'true') {
                console.log(`Test mode: Cancelling order ${orderId} for market ${market}`);
                return { success: true, message: 'Order cancelled in test mode' };
            }

            const endpoint = '/api/v2/order/cancel';
            const data = {
                market: market,
                orderId: orderId.toString()
            };

            // Generate headers with the request endpoint and data
            const headers = this.generateHeaders(endpoint, data);

            // The request body must match exactly what was used to generate the headers
            const requestBody = JSON.parse(Buffer.from(headers['X-TXC-PAYLOAD'], 'base64').toString());       

            console.log(`Cancelling order ${orderId} for market ${market}...`);
            const response = await axios.post(
                `${this.baseUrl}${endpoint}`,
                requestBody,
                { headers: { ...headers, "Content-Type": "application/json" } }
            );

            if (!response.data.success) {
                console.error('P2PB2B API Error:', response.data);
                return {
                    success: false,
                    message: response.data.message || 'Unknown error'
                };
            }

            console.log('Order cancelled successfully:', response.data.result);
            return {
                success: true,
                result: response.data.result
            };
        } catch (error) {
            console.error('Error cancelling P2PB2B order:', error.message);
            if (error.response) {
                console.error('Response data:', error.response.data);
                console.error('Response status:', error.response.status);
            }
            return {
                success: false,
                message: error.message
            };
        }
    }

    // Create a market order (guaranteed to execute immediately at market price)
    async createMarketOrder(market, side, amount) {
        try {
            if (process.env.TEST_MODE === 'true') {
                console.log(`Test mode: Creating ${side} market order for ${amount} ${market}`);
                return {
                    orderId: `test-market-${Date.now()}`,
                    market: market,
                    side: side,
                    amount: amount,
                    type: 'market',
                    timestamp: Date.now() / 1000
                };
            }

            // Format the market symbol
            const formattedMarket = market.replace('/', '_');

            // Get market limits to ensure amount is valid
            const limits = await this.getMarketLimits(formattedMarket);

            // Round amount according to market step_size
            const minAmount = parseFloat(limits.min_amount);
            const stepSize = parseFloat(limits.step_size);
            const roundedAmount = Math.max(minAmount, Math.round(parseFloat(amount) / stepSize) * stepSize);  
            const formattedAmount = roundedAmount.toFixed(1); // BRIL uses 1 decimal place

            console.log(`Creating market order for ${formattedMarket}`);
            console.log(`Rounded amount: ${formattedAmount} (min: ${limits.min_amount}, step: ${limits.step_size})`);

            const endpoint = '/api/v2/order/new';
            const data = {
                market: formattedMarket,
                side: side.toLowerCase(),
                amount: formattedAmount,
                type: 'market'  // This is the key - using market order type
            };

            // Generate headers with the request endpoint and data
            const headers = this.generateHeaders(endpoint, data);

            // The request body must match exactly what was used to generate the headers
            const requestBody = JSON.parse(Buffer.from(headers['X-TXC-PAYLOAD'], 'base64').toString());       

            console.log(`Order request data:`, JSON.stringify(data));

            const response = await axios.post(
                `${this.baseUrl}${endpoint}`,
                requestBody,
                { headers: { ...headers, "Content-Type": "application/json" } }
            );

            if (!response.data.success) {
                console.error('P2PB2B API Error:', response.data);
                throw new Error(response.data.message || 'Unknown error');
            }

            console.log('Market order created:', response.data.result);
            return response.data.result;
        } catch (error) {
            console.error('Error creating P2PB2B market order:', error.message);
            if (error.response) {
                console.error('API Error Details:', {
                    status: error.response.status,
                    statusText: error.response.statusText,
                    data: error.response.data
                });
            }
            throw error;
        }
    }

    // Create a limit order with price that guarantees immediate execution
    async createImmediateOrder(market, side, amount) {
        try {
            if (process.env.TEST_MODE === 'true') {
                console.log(`Test mode: Creating immediate ${side} order for ${amount} ${market}`);
                return {
                    orderId: `test-immediate-${Date.now()}`,
                    market: market,
                    side: side,
                    amount: amount,
                    type: 'limit',
                    timestamp: Date.now() / 1000
                };
            }

            // Format the market symbol
            const formattedMarket = market.replace('/', '_');

            // Get market limits to ensure amount is valid
            const limits = await this.getMarketLimits(formattedMarket);

            // Round amount according to market step_size
            const minAmount = parseFloat(limits.min_amount);
            const stepSize = parseFloat(limits.step_size);
            const roundedAmount = Math.max(minAmount, Math.round(parseFloat(amount) / stepSize) * stepSize);  
            const formattedAmount = roundedAmount.toFixed(1); // BRIL uses 1 decimal place

            // Get current market price
            const marketPrice = await this.getMarketPrice(formattedMarket);
            if (!marketPrice || !marketPrice.bid || !marketPrice.ask) {
                throw new Error('Could not get current market price');
            }

            // Set price to ensure immediate execution
            let price;
            if (side.toLowerCase() === 'buy') {
                // For buy orders, set price higher than current ask
                price = (parseFloat(marketPrice.ask) * 1.05).toFixed(6);
                console.log(`Setting buy price to ${price} (5% above current ask ${marketPrice.ask})`);       
            } else {
                // For sell orders, set price lower than current bid
                price = (parseFloat(marketPrice.bid) * 0.95).toFixed(6);
                console.log(`Setting sell price to ${price} (5% below current bid ${marketPrice.bid})`);      
            }

            console.log(`Creating immediate ${side} order for ${formattedMarket}`);
            console.log(`Rounded amount: ${formattedAmount} (min: ${limits.min_amount}, step: ${limits.step_size})`);

            const endpoint = '/api/v2/order/new';
            const data = {
                market: formattedMarket,
                side: side.toLowerCase(),
                amount: formattedAmount,
                price: price
            };

            // Generate headers with the request endpoint and data
            const headers = this.generateHeaders(endpoint, data);

            // The request body must match exactly what was used to generate the headers
            const requestBody = JSON.parse(Buffer.from(headers['X-TXC-PAYLOAD'], 'base64').toString());       

            console.log(`Order request data:`, JSON.stringify(data));

            const response = await axios.post(
                `${this.baseUrl}${endpoint}`,
                requestBody,
                { headers: { ...headers, "Content-Type": "application/json" } }
            );

            if (!response.data.success) {
                console.error('P2PB2B API Error:', response.data);
                throw new Error(response.data.message || 'Unknown error');
            }

            console.log('Immediate order created:', response.data.result);
            return response.data.result;
        } catch (error) {
            console.error('Error creating P2PB2B immediate order:', error.message);
            if (error.response) {
                console.error('API Error Details:', {
                    status: error.response.status,
                    statusText: error.response.statusText,
                    data: error.response.data
                });
            }
            throw error;
        }
    }
}

module.exports = P2PB2BExchange;
