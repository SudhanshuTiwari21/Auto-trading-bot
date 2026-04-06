// Test script to demonstrate the precision price adjustment approach
require('dotenv').config();

// Function to demonstrate the price adjustment logic
function demonstratePriceAdjustment() {
    // Sample ask prices to test
    const testPrices = [
        0.808,
        0.123456,
        1.234567,
        0.000123,
        10.987654
    ];
    
    console.log('=== Testing Precision Price Adjustment Logic ===\n');
    console.log('This test demonstrates how the price is adjusted by 1% after the 3rd decimal place');
    
    testPrices.forEach(askPrice => {
        // Calculate buy price (reduce by 1% after 3rd decimal)
        const buyIntegerPart = Math.floor(askPrice * 1000) / 1000; // Keep first 3 decimal places
        const buyFractionalPart = askPrice - buyIntegerPart;
        const buyAdjustedFractionalPart = buyFractionalPart * 0.99; // Reduce by 1%
        const buyPrice = (buyIntegerPart + buyAdjustedFractionalPart).toFixed(6);
        
        // Calculate sell price (increase by 1% after 3rd decimal)
        const sellIntegerPart = Math.floor(askPrice * 1000) / 1000; // Keep first 3 decimal places
        const sellFractionalPart = askPrice - sellIntegerPart;
        const sellAdjustedFractionalPart = sellFractionalPart * 1.01; // Increase by 1%
        const sellPrice = (sellIntegerPart + sellAdjustedFractionalPart).toFixed(6);
        
        // Calculate the old way (whole price adjustment)
        const oldBuyPrice = (askPrice * 0.98).toFixed(6);
        const oldSellPrice = (askPrice * 1.02).toFixed(6);
        
        console.log(`\nOriginal ask price: ${askPrice}`);
        console.log('--- New Precision Adjustment Method ---');
        console.log(`Buy price: ${buyPrice} (adjusted after 3rd decimal place)`);
        console.log(`Sell price: ${sellPrice} (adjusted after 3rd decimal place)`);
        console.log('--- Old Percentage Method ---');
        console.log(`Buy price: ${oldBuyPrice} (2% below ask)`);
        console.log(`Sell price: ${oldSellPrice} (2% above ask)`);
        
        // Calculate and show the difference
        const buyDiff = Math.abs(parseFloat(buyPrice) - parseFloat(oldBuyPrice));
        const sellDiff = Math.abs(parseFloat(sellPrice) - parseFloat(oldSellPrice));
        
        console.log('--- Comparison ---');
        console.log(`Buy price difference: ${buyDiff.toFixed(6)}`);
        console.log(`Sell price difference: ${sellDiff.toFixed(6)}`);
    });
    
    console.log('\n=== Test completed ===');
}

// Run the demonstration
demonstratePriceAdjustment();
