const axios = require('axios');
const crypto = require('crypto');

class AutoTradingBot {
    constructor(apiKey, secretKey) {
        try {
            if (!apiKey || !secretKey) {
                throw new Error('API key and secret key are required');
            }
            
            this.azbitApiKey = apiKey;
            this.azbitSecretKey = secretKey;
            this.azbitUrl = 'https://data.azbit.com/api/';
            this.lastAction = 'sell';  // Start with buy since we'll flip it
            this.isShuttingDown = false;
            this.pendingOrders = new Map(); // Track orders that need matching orders
            
            // Add cycle tracking for random order quantities
            this.currentCycle = 0;
            this.ordersInCurrentCycle = 0;
            this.targetOrdersInCycle = this.getRandomOrderCount();
            
            console.log('\n=== Bot Initialization ===');
            console.log('✓ API Keys configured');
            console.log('✓ Starting with BUY order (buy low, then sell high)');
            console.log(`✓ First cycle will create ${this.targetOrdersInCycle} orders`);
            
            if (process.env.TEST_MODE === 'true') {
                const testBalance = parseFloat(process.env.TEST_BALANCE || '100');
                console.log('✓ Test Mode enabled');
                console.log(`✓ Test Balance: ${testBalance} USDT`);
            }

            // Setup graceful shutdown
            this.setupShutdownHandlers();
        } catch (error) {
            console.error('Error initializing bot:', error.message);
            throw error;
        }
    }

    setupShutdownHandlers() {
        // Handle graceful shutdown
        const handleShutdown = async () => {
            if (this.isShuttingDown) return;
            
            console.log('\n=== Graceful Shutdown Initiated ===');
            this.isShuttingDown = true;
            
            // Check if there are any pending orders that need matching orders
            if (this.pendingOrders.size > 0) {
                console.log(`Creating matching orders for ${this.pendingOrders.size} pending orders before shutdown...`);
                
                // Create matching orders for all pending orders
                for (const [orderId, orderDetails] of this.pendingOrders.entries()) {
                    try {
                        console.log(`Creating matching order for order ID: ${orderId}`);
                        await this.createMatchingOrder(orderDetails);
                        console.log(`Successfully created matching order for order ID: ${orderId}`);
                        this.pendingOrders.delete(orderId);
                    } catch (error) {
                        console.error(`Failed to create matching order for order ID: ${orderId}`, error.message);
                    }
                }
            }
            
            console.log('Graceful shutdown complete. Exiting...');
            process.exit(0);
        };
        
        // Register shutdown handlers
        process.on('SIGINT', handleShutdown);
        process.on('SIGTERM', handleShutdown);
        process.on('exit', () => {
            if (!this.isShuttingDown) {
                console.log('\nProcess exiting without proper shutdown. Some orders may be left without matching orders.');
            }
        });
    }

    async startTrading(exchange, symbol) {
        try {
            console.log('\n=== Starting Trading Bot ===');
            console.log('Exchange:', exchange);
            console.log('Symbol:', symbol);
            console.log('Trade Amount:', process.env.TRADE_AMOUNT, 'USDT');
            
            // Start the trading cycle
            await this.executeTrade(exchange, symbol);
        } catch (error) {
            console.error('Error starting trading:', error.message);
            throw error;
        }
    }

    getRandomDelay() {
        const minMinutes = parseInt(process.env.TIME_MIN || '1');
        const maxMinutes = parseInt(process.env.TIME_MAX || '15');
        const minMs = minMinutes * 60 * 1000;
        const maxMs = maxMinutes * 60 * 1000;
        return Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
    }

    generateSignature(requestUrl, requestBody = '') {
        try {
            if (!this.azbitApiKey || !this.azbitSecretKey) {
                throw new Error('API key or secret key is missing');
            }

            // Format: publicKey + requestUrl + requestBodyString
            const signatureText = this.azbitApiKey + requestUrl + requestBody;

            // Convert to UTF8 bytes and compute HMACSHA256
            const signature = crypto
                .createHmac('sha256', this.azbitSecretKey)
                .update(signatureText)
                .digest('hex');

            return signature;
        } catch (error) {
            console.error('Error generating signature:', error.message);
            return '';
        }
    }

    async getBalance() {
        try {
            // If test mode is enabled, return test balance
            if (process.env.TEST_MODE === 'true') {
                const testBalance = parseFloat(process.env.TEST_BALANCE || '100');
                console.log('\nUsing test balance:', testBalance, 'USDT');
                return testBalance;
            }

            const endpoint = 'wallets/balances';
            const url = `${this.azbitUrl}${endpoint}`;
            
            // Generate signature for balance request
            const signature = this.generateSignature(url, '');
            
            console.log('\nChecking Azbit Wallet Balance:');
            console.log('URL:', url);
            
            const response = await axios.get(url, {
                headers: {
                    'API-PublicKey': this.azbitApiKey,
                    'API-Signature': signature,
                    'Content-Type': 'application/json'
                }
            });

            if (response.data && response.data.balances) {
                console.log('\nAll Balances:', JSON.stringify(response.data.balances, null, 2));
                
                // Find USDT balance
                const usdtBalance = response.data.balances.find(b => b.currencyCode === 'USDT');
                if (usdtBalance) {
                    console.log('\nUSDT Balance Details:');
                    console.log('Available:', usdtBalance.amount);
                    console.log('In Orders:', response.data.balancesBlockedInOrder.find(b => b.currencyCode === 'USDT')?.amount || 0);
                    console.log('Total USDT Value:', usdtBalance.amountUsdt);
                    return parseFloat(usdtBalance.amount);
                }
            }
            return 0;
        } catch (error) {
            console.error('\nError fetching wallet balance:', error.message);
            if (error.response) {
                console.error('Status:', error.response.status);
                console.error('Data:', JSON.stringify(error.response.data, null, 2));
            }
            
            // If API fails and test mode is enabled, use test balance
            if (process.env.TEST_MODE === 'true') {
                const testBalance = parseFloat(process.env.TEST_BALANCE || '100');
                console.log('\nFalling back to test balance:', testBalance, 'USDT');
                return testBalance;
            }
            
            return 0;
        }
    }

    async getOrderBook(symbol) {
        try {
            const currencyPairCode = symbol.replace('/', '_');
            const url = `${this.azbitUrl}orderbook?currencyPairCode=${currencyPairCode}`;
            
            console.log('\nFetching Order Book:');
            console.log('URL:', url);

            const response = await axios.get(url);
            const orderBook = response.data;

            if (!Array.isArray(orderBook) || orderBook.length === 0) {
                throw new Error('Invalid order book data structure');
            }

            // Find best bid (highest buy price)
            const bids = orderBook.filter(order => order.isBid === true);
            const bestBid = bids.length > 0 ? 
                Math.max(...bids.map(bid => parseFloat(bid.price))) : 0;

            // Find best ask (lowest sell price)
            const asks = orderBook.filter(order => order.isBid === false);
            const bestAsk = asks.length > 0 ? 
                Math.min(...asks.map(ask => parseFloat(ask.price))) : 0;

            if (bestBid === 0 || bestAsk === 0) {
                throw new Error('No valid bid or ask prices found');
            }

            console.log('\nOrder Book Analysis:');
            console.log(`Number of Bids: ${bids.length}`);
            console.log(`Number of Asks: ${asks.length}`);
            console.log(`Best Bid: ${bestBid}`);
            console.log(`Best Ask: ${bestAsk}`);

            return {
                bestBid,
                bestAsk,
                bids,
                asks
            };

        } catch (error) {
            console.error('Error fetching order book:', error.message);
            if (error.response) {
                console.error('Status:', error.response.status);
                console.error('Response Data:', error.response.data);
            }
            return null;
        }
    }

    async getOrderStatus(orderId) {
        try {
            const endpoint = `orders/${orderId}/deals`;
            const url = `${this.azbitUrl}${endpoint}`;
            
            console.log('\nChecking Order Status:');
            console.log('URL:', url);
            console.log('Order ID:', orderId);

            // For GET requests, body is empty string
            const signature = this.generateSignature(url, '');

            const response = await axios.get(url, {
                headers: {
                    'API-PublicKey': this.azbitApiKey,
                    'API-Signature': signature,
                    'Content-Type': 'application/json'
                }
            });

            const orderData = response.data;

            if (!orderData) {
                throw new Error('Invalid order data');
            }

            console.log('\nOrder Details:');
            console.log(`Status: ${orderData.status}`);
            console.log(`Type: ${orderData.isBid ? 'buy' : 'sell'}`);
            console.log(`Amount: ${orderData.amount}`);
            console.log(`Initial Amount: ${orderData.initialAmount}`);
            console.log(`Price: ${orderData.price}`);
            console.log(`Total Value: ${(parseFloat(orderData.price) * parseFloat(orderData.initialAmount)).toFixed(8)} USDT`);

            // Calculate filled percentage
            const filledAmount = parseFloat(orderData.initialAmount) - parseFloat(orderData.amount);
            const filledPercentage = (filledAmount / parseFloat(orderData.initialAmount)) * 100;
            console.log(`Filled: ${filledPercentage.toFixed(2)}%`);

            // Log deals if any
            if (orderData.deals && orderData.deals.length > 0) {
                console.log('\nDeals:');
                orderData.deals.forEach(deal => {
                    console.log(`- ${deal.dealDateUtc}: ${deal.volume} @ ${deal.price} (${deal.isUserBuyer ? 'Buy' : 'Sell'})`);
                });
            }

            return {
                status: orderData.status,
                type: orderData.isBid ? 'buy' : 'sell',
                amount: orderData.amount,
                initialAmount: orderData.initialAmount,
                price: orderData.price,
                filled: filledPercentage.toFixed(2),
                deals: orderData.deals || []
            };

        } catch (error) {
            console.error('\nError checking order status:', error.message);
            if (error.response) {
                console.error('Status:', error.response.status);
                console.error('Response Data:', error.response.data);

                if (error.response.status === 401) {
                    console.error('Authentication Error: Please check API keys and signature');
                } else if (error.response.status === 404) {
                    console.error('Order not found. It might have been filled or cancelled.');
                }
            }
            return { status: 'error' };
        }
    }

    async cancelOrder(orderId) {
        try {
            console.log(`\nCancelling unfilled order: ${orderId}`);
            
            const endpoint = `orders/${orderId}`;
            const url = `${this.azbitUrl}${endpoint}`;
            
            // Generate signature for DELETE request
            const signature = this.generateSignature(url, '');
            
            const response = await axios.delete(url, {
                headers: {
                    'API-PublicKey': this.azbitApiKey,
                    'API-Signature': signature,
                    'Content-Type': 'application/json'
                }
            });
            
            console.log(`Order ${orderId} cancelled successfully`);
            console.log('Response:', response.data);
            
            return true;
        } catch (error) {
            console.error(`Error cancelling order ${orderId}:`, error.message);
            if (error.response) {
                console.error('Status:', error.response.status);
                console.error('Response Data:', error.response.data);
            }
            return false;
        }
    }

    async createOrder(symbol, side, amount, price) {
        try {
            const orderData = {
                currencyPairCode: symbol.replace('/', '_'),
                side: side.toLowerCase(),
                type: 'limit',
                amount: amount.toString(),
                price: price.toString()
            };

            console.log('\nCreating order:');
            console.log('Type:', side.toUpperCase());
            console.log('Amount:', amount, 'BTCR');
            console.log('Price:', price, 'USDT');
            console.log('Total:', (parseFloat(amount) * parseFloat(price)).toFixed(8), 'USDT');

            const endpoint = 'orders';
            const url = `${this.azbitUrl}${endpoint}`;
            
            // For POST requests, include request body in signature
            const requestBody = JSON.stringify(orderData);
            const signature = this.generateSignature(url, requestBody);

            const response = await axios.post(url, orderData, {
                headers: {
                    'API-PublicKey': this.azbitApiKey,
                    'API-Signature': signature,
                    'Content-Type': 'application/json'
                }
            });

            console.log('Order created:', response.data);
            return response.data;

        } catch (error) {
            console.error('Error creating order:', error.message);
            if (error.response) {
                console.error('Status:', error.response.status);
                console.error('Response Data:', error.response.data);
            }
            return null;
        }
    }

    async createMatchingOrder(orderDetails) {
        try {
            if (!orderDetails.amount) {
                throw new Error('Invalid order details: missing amount');
            }

            if (!orderDetails.price) {
                throw new Error('Invalid order details: missing price');
            }

            // Create opposite order with same price and amount
            const matchingOrderData = {
                currencyPairCode: orderDetails.currencyPairCode,
                side: orderDetails.type === 'buy' ? 'sell' : 'buy',
                type: 'limit',
                amount: orderDetails.amount,
                price: orderDetails.price
            };

            console.log('\nCreating matching order:');
            console.log(`Type: ${matchingOrderData.side.toUpperCase()}`);
            console.log(`Price: ${matchingOrderData.price} USDT (same as first order)`);
            console.log(`Amount: ${matchingOrderData.amount} BTCR`);
            console.log(`Total: ${(parseFloat(matchingOrderData.price) * parseFloat(matchingOrderData.amount)).toFixed(8)} USDT`);

            const endpoint = 'orders';
            const url = `${this.azbitUrl}${endpoint}`;
            
            // For POST requests, include request body in signature
            const requestBody = JSON.stringify(matchingOrderData);
            const signature = this.generateSignature(url, requestBody);

            const response = await axios.post(url, matchingOrderData, {
                headers: {
                    'API-PublicKey': this.azbitApiKey,
                    'API-Signature': signature,
                    'Content-Type': 'application/json'
                }
            });

            console.log('Matching order created:', response.data);
            return response.data;
        } catch (error) {
            console.error('Error creating matching order:', error.message);
            if (error.response) {
                console.error('Status:', error.response.status);
                console.error('Response Data:', error.response.data);
            }
            return null;
        }
    }

    async executeTradeAction(action, symbol, price, amount) {
        try {
            // Parse and format numbers before creating order
            const formattedPrice = price.toString();
            const formattedAmount = amount.toString();
            
            const orderData = await this.createOrder(symbol, action, formattedAmount, formattedPrice);
            if (!orderData) {
                console.error('Failed to create first order');
                return;
            }

            console.log(`\n${action.toUpperCase()} order created successfully`);
            console.log('Order ID:', orderData);

            // Get order details
            const orderDetails = await this.getOrderStatus(orderData);
            if (orderDetails.status === 'error') {
                console.error('Error getting order details');
                return;
            }

            // Track this order as pending a matching order
            this.pendingOrders.set(orderData, {
                type: action,
                amount: formattedAmount,
                price: formattedPrice,
                currencyPairCode: symbol.replace('/', '_')
            });

            // Create matching order to fill our own order
            console.log('\nCreating matching order to fill our order...');
            
            // Use the same amount and price from our first order
            const matchingOrderId = await this.createMatchingOrder({
                type: action,
                amount: formattedAmount,
                price: formattedPrice,
                currencyPairCode: symbol.replace('/', '_')
            });

            // Remove from pending orders since we've created a matching order
            this.pendingOrders.delete(orderData);

            if (matchingOrderId) {
                console.log('\nBoth orders created successfully!');
                console.log('First Order ID:', orderData);
                console.log('Matching Order ID:', matchingOrderId);

                // Maximum retries and delay between checks
                const maxRetries = 5; // Increased from 3 to 5 retries
                const checkDelay = 2000; // 2 seconds
                let retryCount = 0;
                let bothOrdersFilled = false;

                while (retryCount < maxRetries && !bothOrdersFilled && !this.isShuttingDown) {
                    // Wait between checks
                    await new Promise(resolve => setTimeout(resolve, checkDelay));

                    // Check both orders with retry on connection error
                    let firstOrderStatus, matchingOrderStatus;
                    try {
                        [firstOrderStatus, matchingOrderStatus] = await Promise.all([
                            this.getOrderStatus(orderData),
                            this.getOrderStatus(matchingOrderId)
                        ]);
                    } catch (error) {
                        console.error(`\nError checking order status (attempt ${retryCount + 1}/${maxRetries}):`, error.message);
                        retryCount++;
                        continue;
                    }

                    // Skip if either status check failed
                    if (firstOrderStatus.status === 'error' || matchingOrderStatus.status === 'error') {
                        retryCount++;
                        continue;
                    }

                    const firstOrderFilled = parseFloat(firstOrderStatus.filled) >= 99;
                    const matchingOrderFilled = parseFloat(matchingOrderStatus.filled) >= 99;

                    console.log('\nOrder Fill Status:');
                    console.log(`First Order: ${firstOrderStatus.filled}% filled`);
                    console.log(`Matching Order: ${matchingOrderStatus.filled}% filled`);

                    if (firstOrderFilled && matchingOrderFilled) {
                        bothOrdersFilled = true;
                        console.log('\n✓ Both orders filled successfully!');
                        
                        // Add delay before starting new cycle
                        console.log('\nWaiting 5 seconds before starting new cycle...');
                        await new Promise(resolve => setTimeout(resolve, 5000));
                        
                        // Only start a new cycle if we're not shutting down
                        if (!this.isShuttingDown) {
                            console.log('\n=== Starting New Cycle ===');
                            this.lastAction = action;
                            await this.executeTrade('Azbit', symbol);
                        } else {
                            console.log('Bot is shutting down, not starting a new cycle.');
                        }
                        break;
                    }

                    retryCount++;
                    
                    // If we've reached the maximum retries and orders aren't filled
                    if (retryCount >= maxRetries && !bothOrdersFilled) {
                        console.log('\n⚠️ Orders not filled after maximum retries. Cancelling unfilled orders...');
                        
                        // Cancel first order if not filled
                        if (!firstOrderFilled) {
                            console.log(`Cancelling first order ${orderData} (${firstOrderStatus.filled}% filled)`);
                            const cancelResult = await this.cancelOrder(orderData);
                            if (cancelResult) {
                                console.log(`Successfully cancelled order ${orderData}`);
                            } else {
                                console.log(`Failed to cancel order ${orderData}`);
                            }
                        }
                        
                        // Cancel matching order if not filled
                        if (!matchingOrderFilled) {
                            console.log(`Cancelling matching order ${matchingOrderId} (${matchingOrderStatus.filled}% filled)`);
                            const cancelResult = await this.cancelOrder(matchingOrderId);
                            if (cancelResult) {
                                console.log(`Successfully cancelled order ${matchingOrderId}`);
                            } else {
                                console.log(`Failed to cancel order ${matchingOrderId}`);
                            }
                        }
                        
                        // Try creating new orders at the exact ask price to increase fill probability
                        console.log('\nCreating new orders at exact ask price to increase fill probability...');
                        
                        // Get fresh market price
                        const orderBook = await this.getOrderBook(symbol);
                        if (orderBook) {
                            const exactAskPrice = orderBook.bestAsk.toString();
                            console.log(`Using exact ask price: ${exactAskPrice}`);
                            
                            // Create new orders at exact ask price
                            await this.executeTradeAction(action, symbol, exactAskPrice, formattedAmount);
                        } else {
                            console.log('Failed to get fresh market price, will retry in next cycle');
                            
                            // Wait before starting new cycle
                            console.log('\nWaiting 30 seconds before starting new cycle...');
                            await new Promise(resolve => setTimeout(resolve, 30000));
                            
                            if (!this.isShuttingDown) {
                                console.log('\n=== Starting New Cycle ===');
                                this.lastAction = action;
                                await this.executeTrade('Azbit', symbol);
                            }
                        }
                    }
                }
            }

        } catch (error) {
            console.error('Error in executeTradeAction:', error.message);
        }
    }

    async executeTrade(exchange, symbol) {
        try {
            // Check if we're shutting down
            if (this.isShuttingDown) {
                console.log('Bot is shutting down, not executing new trades.');
                return;
            }
            
            // Get current market prices
            const orderBook = await this.getOrderBook(symbol);
            if (!orderBook) {
                console.error('Failed to get order book, retrying in 30 seconds...');
                await new Promise(resolve => setTimeout(resolve, 30000));
                return this.executeTrade(exchange, symbol);
            }

            const { bestBid, bestAsk } = orderBook;
            const spread = ((bestAsk - bestBid) / bestBid) * 100;

            // Check if we need to start a new cycle
            if (this.ordersInCurrentCycle >= this.targetOrdersInCycle) {
                this.currentCycle++;
                this.ordersInCurrentCycle = 0;
                this.targetOrdersInCycle = this.getRandomOrderCount();
                
                console.log('\n=== Starting New Trading Cycle ===');
                console.log(`Cycle #${this.currentCycle}`);
                console.log(`Target Orders for this cycle: ${this.targetOrdersInCycle}`);
                
                // Flip the last action to alternate between buy and sell for the first order of the new cycle
                this.lastAction = this.lastAction === 'buy' ? 'sell' : 'buy';
            }

            console.log('\n=== Trading Cycle ===');
            console.log(`Cycle #${this.currentCycle} - Order ${this.ordersInCurrentCycle + 1}/${this.targetOrdersInCycle}`);
            console.log('Market Status for BTCR/USDT:');
            console.log(`Best Bid: ${bestBid.toFixed(8)}`);
            console.log(`Best Ask: ${bestAsk.toFixed(8)}`);
            console.log(`Spread: ${spread.toFixed(2)}%`);

            // Get account balance for dynamic trade sizing
            const balance = await this.getBalance();
            if (!balance) {
                console.error('Failed to get balance, retrying in 30 seconds...');
                await new Promise(resolve => setTimeout(resolve, 30000));
                return this.executeTrade(exchange, symbol);
            }

            // Calculate dynamic trade amount based on account balance
            // Use 30% of available balance for each trade
            const maxTradeValueUSDT = balance * 0.3;
            let tradeAmount;

            // Determine action based on last action
            const action = this.lastAction === 'sell' ? 'buy' : 'sell';
            
            console.log('\nTrading Strategy:');
            console.log(`Previous Action: ${this.lastAction || 'None'}`);
            console.log(`Current Action: ${action}`);
            console.log(`Available Balance: ${balance.toFixed(8)} USDT`);

            // Calculate price with dynamic adjustment based on spread
            let price;
            if (action === 'buy') {
                // Use best ask price for buy orders
                const currentBestAsk = bestAsk;
                // Calculate a random percentage between 2-5% for dynamic pricing
                const randomAdjustment = (2 + Math.random() * 3).toFixed(2);
                // Buy slightly below the best ask price
                price = (currentBestAsk * (1 - randomAdjustment/100)).toFixed(8);
                tradeAmount = (maxTradeValueUSDT / parseFloat(price)).toFixed(8);
                
                console.log('\nBUY Strategy:');
                console.log(`Current Best Ask: ${currentBestAsk}`);
                console.log(`Random Adjustment: -${randomAdjustment}%`);
                console.log(`Our Buy Price: ${price}`);
            } else {
                // Get fresh best ask from order book
                const currentBestAsk = bestAsk;
                // Calculate a random percentage between 2-5% for dynamic pricing
                const randomAdjustment = (2 + Math.random() * 3).toFixed(2);
                price = (currentBestAsk * (1 - randomAdjustment/100)).toFixed(8);
                tradeAmount = (maxTradeValueUSDT / parseFloat(price)).toFixed(8);
                
                console.log('\nSELL Strategy:');
                console.log(`Current Best Ask: ${currentBestAsk}`);
                console.log(`Random Adjustment: -${randomAdjustment}%`);
                console.log(`Our Sell Price: ${price}`);
            }

            // Ensure minimum trade amount of 0.1 BTCR
            tradeAmount = Math.max(0.1, parseFloat(tradeAmount)).toFixed(8);

            console.log(`\n${action.toUpperCase()} Order Details:`);
            console.log(`Amount: ${tradeAmount} BTCR`);
            console.log(`Price: ${price} USDT`);
            console.log(`Total Value: ${(parseFloat(tradeAmount) * parseFloat(price)).toFixed(8)} USDT`);

            // Execute the trade with retry mechanism
            let retryCount = 0;
            const maxRetries = 3;
            
            while (retryCount < maxRetries && !this.isShuttingDown) {
                try {
                    await this.executeTradeAction(action, symbol, price, tradeAmount);
                    
                    // Increment the orders in current cycle counter
                    this.ordersInCurrentCycle++;
                    
                    // Update last action for the next order
                    this.lastAction = action;
                    
                    // If we still have orders to create in this cycle and not shutting down,
                    // continue with the next order after a short delay
                    if (this.ordersInCurrentCycle < this.targetOrdersInCycle && !this.isShuttingDown) {
                        console.log(`\nCompleted order ${this.ordersInCurrentCycle}/${this.targetOrdersInCycle} in cycle ${this.currentCycle}`);
                        console.log('Waiting 5 seconds before creating next order...');
                        await new Promise(resolve => setTimeout(resolve, 5000));
                        return this.executeTrade(exchange, symbol);
                    }
                    
                    break;
                } catch (error) {
                    retryCount++;
                    if (retryCount === maxRetries) {
                        console.error(`Failed to execute trade after ${maxRetries} attempts`);
                        // Wait 1 minute before starting new cycle
                        console.log('Waiting 1 minute before starting new cycle...');
                        await new Promise(resolve => setTimeout(resolve, 60000));
                        return this.executeTrade(exchange, symbol);
                    }
                    console.log(`Retrying trade execution (${retryCount}/${maxRetries})...`);
                    await new Promise(resolve => setTimeout(resolve, 5000));
                }
            }
        } catch (error) {
            console.error('\nTrade execution error:', error.message);
        }
    }

    // Add method to get random order count between 1-5
    getRandomOrderCount() {
        return Math.floor(Math.random() * 5) + 1; // Random number between 1 and 5
    }

    // Helper methods to save data for the UI
    saveOrderBookData(orderBook) {
        try {
            const fs = require('fs');
            const data = {
                lowestSell: orderBook.bestAsk,
                highestBuy: orderBook.bestBid,
                spread: orderBook.bestAsk - orderBook.bestBid,
                lastOrderType: this.lastAction
            };
            fs.writeFileSync('azbit-orderbook.json', JSON.stringify(data, null, 2));
        } catch (error) {
            console.error('Error saving order book data:', error.message);
        }
    }

    saveBalanceData(balance) {
        try {
            const fs = require('fs');
            // Get BTCR balance - in a real implementation, you'd fetch this from the exchange
            const btcrBalance = 1.5; // Mock value
            const data = {
                crypto: btcrBalance,
                usdt: balance
            };
            fs.writeFileSync('azbit-balance.json', JSON.stringify(data, null, 2));
        } catch (error) {
            console.error('Error saving balance data:', error.message);
        }
    }

    saveTransactionData(transaction) {
        try {
            const fs = require('fs');
            let transactions = [];
            
            // Read existing transactions if file exists
            if (fs.existsSync('azbit-transactions.json')) {
                transactions = JSON.parse(fs.readFileSync('azbit-transactions.json', 'utf8'));
            }
            
            // Add new transaction
            transactions.push(transaction);
            
            // Keep only the latest 20 transactions
            if (transactions.length > 20) {
                transactions = transactions.slice(-20);
            }
            
            fs.writeFileSync('azbit-transactions.json', JSON.stringify(transactions, null, 2));
        } catch (error) {
            console.error('Error saving transaction data:', error.message);
        }
    }
}

module.exports = { AutoTradingBot };
