document.addEventListener('DOMContentLoaded', () => {
    // --- DOM Elements ---
    const geminiKeyInput = document.getElementById('geminiKey');
    const riskAmountInput = document.getElementById('riskAmount');
    const rrRatioInput = document.getElementById('rrRatio');
    const coinCountInput = document.getElementById('coinCount');
    const momentumThresholdInput = document.getElementById('momentumThreshold');
    const runAnalysisBtn = document.getElementById('runAnalysisBtn');
    const outputDiv = document.getElementById('output');
    const themeToggle = document.getElementById('themeToggle');

    // --- API Configuration ---
    const COINGECKO_BASE_URL = 'https://api.coingecko.com/api/v3';

    // --- Settings Management ---
    const loadSettings = () => {
        geminiKeyInput.value = localStorage.getItem('geminiApiKey') || '';
        riskAmountInput.value = localStorage.getItem('riskAmount') || '10';
        rrRatioInput.value = localStorage.getItem('rrRatio') || '3';
        coinCountInput.value = localStorage.getItem('coinCount') || '50';
        momentumThresholdInput.value = localStorage.getItem('momentumThreshold') || '3';
        const isDarkMode = localStorage.getItem('darkMode') === 'true';
        themeToggle.checked = isDarkMode;
        document.documentElement.setAttribute('data-theme', isDarkMode ? 'dark' : 'light');
    };

    const saveSettings = () => {
        localStorage.setItem('geminiApiKey', geminiKeyInput.value);
        localStorage.setItem('riskAmount', riskAmountInput.value);
        localStorage.setItem('rrRatio', rrRatioInput.value);
        localStorage.setItem('coinCount', coinCountInput.value);
        localStorage.setItem('momentumThreshold', momentumThresholdInput.value);
    };

    // --- Theme Management ---
    themeToggle.addEventListener('change', () => {
        const isDarkMode = themeToggle.checked;
        document.documentElement.setAttribute('data-theme', isDarkMode ? 'dark' : 'light');
        localStorage.setItem('darkMode', isDarkMode);
    });

    // --- UI Update Functions ---
    const showLoading = (message) => {
        runAnalysisBtn.disabled = true;
        runAnalysisBtn.innerHTML = `<div class="spinner"></div><span>${message}</span>`;
    };

    const hideLoading = () => {
        runAnalysisBtn.disabled = false;
        runAnalysisBtn.innerHTML = '<i class="fas fa-bolt"></i> Run Analysis';
    };

    const logMessage = (message, type = 'log') => {
        const p = document.createElement('div');
        p.className = type === 'error' ? 'error-message' : 'log-message';
        p.textContent = message;
        outputDiv.appendChild(p);
    };

    const createTradeCard = (trade) => {
        const card = document.createElement('div');
        const directionClass = trade.direction.toLowerCase();
        card.className = `trade-card ${directionClass}`;
        card.innerHTML = `
            <div class="card-header ${directionClass}">
                <h3 class="card-title">${trade.name} (${trade.symbol})</h3>
                <span class="card-direction">${trade.direction}</span>
            </div>
            <div class="card-body">
                <p><strong>Entry:</strong> $${trade.entry}</p>
                <p><strong>Stop Loss:</strong> $${trade.sl}</p>
                <p><strong>Take Profit:</strong> $${trade.tp}</p>
                <p><strong>Lot Size:</strong> ${trade.lotSize} ${trade.symbol}</p>
                <p><strong>R:R Ratio:</strong> ${trade.rr}:1</p>
                <p class="notes"><strong>AI Rationale:</strong> ${trade.notes}</p>
            </div>
        `;
        return card;
    };

    // --- Gemini AI API Call ---
    async function callGemini(prompt, apiKey) {
        const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';
        const body = { contents: [{ parts: [{ text: prompt }] }] };

        const response = await fetch(`${url}?key=${apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Gemini API error (${response.status}): ${errorText}`);
        }

        const data = await response.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!text) throw new Error('No response text from Gemini.');

        // Robust JSON parsing
        const jsonMatch = text.match(/```json\s*(\{[\s\S]*?\})\s*```/);
        if (!jsonMatch) throw new Error('Gemini response did not contain a valid JSON code block.');
        
        try {
            return JSON.parse(jsonMatch[1]);
        } catch (e) {
            throw new Error(`Failed to parse JSON from Gemini: ${e.message}`);
        }
    }

    // --- Main Analysis Logic ---
    runAnalysisBtn.addEventListener('click', async () => {
        saveSettings();
        const GEMINI_API_KEY = geminiKeyInput.value.trim();
        if (!GEMINI_API_KEY) {
            alert('Please enter your Gemini API key!');
            return;
        }

        outputDiv.innerHTML = ''; // Clear previous results
        showLoading('Fetching market data...');

        try {
            // 1. Fetch Top Cryptos from CoinGecko
            const marketsUrl = `${COINGECKO_BASE_URL}/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=${coinCountInput.value}&page=1&sparkline=false&price_change_percentage=24h`;
            const marketsRes = await fetch(marketsUrl);
            if (!marketsRes.ok) throw new Error(`CoinGecko API error (${marketsRes.status})`);
            const topCryptos = await marketsRes.json();

            // 2. Filter Candidates
            const threshold = parseFloat(momentumThresholdInput.value);
            const bullishCandidates = topCryptos.filter(c => c.price_change_percentage_24h > threshold);
            const bearishCandidates = topCryptos.filter(c => c.price_change_percentage_24h < -threshold);
            const allCandidates = [
                ...bullishCandidates.map(c => ({ coin: c, direction: 'bullish' })),
                ...bearishCandidates.map(c => ({ coin: c, direction: 'bearish' }))
            ];
            
            if (allCandidates.length === 0) {
                logMessage('No coins found matching the momentum threshold. Try widening your criteria.', 'error');
                hideLoading();
                return;
            }

            logMessage(`Found ${allCandidates.length} candidates. Analyzing in parallel with Gemini AI...`);
            showLoading(`Analyzing 0 / ${allCandidates.length} coins...`);

            // 3. Run Analysis in Parallel
            let analyzedCount = 0;
            const analysisPromises = allCandidates.map(candidate => 
                analyzeCandidate(candidate.coin, candidate.direction, GEMINI_API_KEY)
                    .then(result => {
                        analyzedCount++;
                        showLoading(`Analyzing ${analyzedCount} / ${allCandidates.length} coins...`);
                        return result;
                    })
            );

            const results = await Promise.allSettled(analysisPromises);
            
            // 4. Process and Display Results
            outputDiv.innerHTML = ''; // Clear logs for final results
            const validTrades = results
                .filter(r => r.status === 'fulfilled' && r.value !== null)
                .map(r => r.value);

            const longTrades = validTrades.filter(t => t.direction === 'Long');
            const shortTrades = validTrades.filter(t => t.direction === 'Short');

            if (longTrades.length > 0) {
                const header = document.createElement('div');
                header.className = 'summary-header';
                header.textContent = `🎯 Valid Long Setups (${longTrades.length})`;
                outputDiv.appendChild(header);
                const container = document.createElement('div');
                container.className = 'trades-container';
                longTrades.forEach(trade => container.appendChild(createTradeCard(trade)));
                outputDiv.appendChild(container);
            }

            if (shortTrades.length > 0) {
                const header = document.createElement('div');
                header.className = 'summary-header';
                header.textContent = `🎯 Valid Short Setups (${shortTrades.length})`;
                outputDiv.appendChild(header);
                const container = document.createElement('div');
                container.className = 'trades-container';
                shortTrades.forEach(trade => container.appendChild(createTradeCard(trade)));
                outputDiv.appendChild(container);
            }

            if (validTrades.length === 0) {
                 logMessage('Analysis complete. No high-confluence ICT setups found based on the current rules.', 'log');
            }

            // Log any errors that occurred during analysis
            results.filter(r => r.status === 'rejected').forEach(r => {
                logMessage(r.reason.message, 'error');
            });

        } catch (error) {
            logMessage(`A global error occurred: ${error.message}`, 'error');
        } finally {
            hideLoading();
        }
    });

    // --- Individual Coin Analysis Function ---
    async function analyzeCandidate(coin, direction, apiKey) {
        const riskAmount = parseFloat(riskAmountInput.value);
        const rrRatio = parseFloat(rrRatioInput.value);

        // Fetch 24h of 5-min data for LTF analysis
        const from1d = Math.floor((Date.now() / 1000) - 86400);
        const toNow = Math.floor(Date.now() / 1000);
        const chartUrl = `${COINGECKO_BASE_URL}/coins/${coin.id}/market_chart/range?vs_currency=usd&from=${from1d}&to=${toNow}`;
        const chartRes = await fetch(chartUrl);
        if (!chartRes.ok) return null; // Silently fail for this coin
        const chartData = await chartRes.json();
        const closes = chartData.prices.map(p => p[1]);

        if (closes.length < 50) return null; // Not enough data
        
        // ** THE NEW, ADVANCED PROMPT **
        const prompt = `You are an expert Inner Circle Trader (ICT) analyst. Your task is to identify a high-probability ${direction} setup for ${coin.symbol.toUpperCase()} based on the provided price data and strict ICT principles.

Current Price: $${coin.current_price.toFixed(5)}
24h Momentum: ${coin.price_change_percentage_24h.toFixed(2)}%

Recent 24h Price Data (closes): [${closes.slice(-100).join(', ')}]

**Analysis Rules for a Valid Setup:**
1.  **Market Structure Shift (MSS):** Confirm a recent break of structure that aligns with the desired direction (${direction === 'bullish' ? 'higher-highs' : 'lower-lows'}).
2.  **Liquidity Displacement:** The move causing the MSS must be energetic, creating a Fair Value Gap (FVG) or imbalance.
3.  **Optimal Trade Entry (OTE):** Price must be trading back into a discount (for longs) or premium (for shorts) area of the displacement leg. This area must contain a clear Point of Interest (POI).
4.  **Point of Interest (POI):** The POI must be a clear FVG or an Order Block (OB) that initiated the displacement. This is the entry zone.

**Your Task:**
If a valid setup exists that meets ALL the above criteria, provide a trade plan. The entry should be at the POI, not the current price. If price is already past the POI, the setup is invalid.

Respond ONLY with a JSON object in a markdown code block.

**Valid Setup JSON format:**
\`\`\`json
{
  "isValid": true,
  "entry": <number, price at the FVG/OB>,
  "stopLoss": <number, placed just below the low for longs, or above the high for shorts, of the displacement leg>,
  "rationale": "Clear MSS on the 5min chart. Price is retracing into a FVG at [price range] which aligns with the 0.618 fib level. This provides a high-probability entry."
}
\`\`\`

**Invalid Setup JSON format:**
\`\`\`json
{
  "isValid": false,
  "entry": null,
  "stopLoss": null,
  "rationale": "No clear Market Structure Shift found. Price is consolidating without a clear displacement move."
}
\`\`\`
`;
        const analysis = await callGemini(prompt, apiKey);

        if (analysis.isValid && analysis.entry && analysis.stopLoss) {
            const entry = parseFloat(analysis.entry);
            const sl = parseFloat(analysis.stopLoss);

            if (isNaN(entry) || isNaN(sl) || entry === 0 || sl === 0) return null;

            // Calculate TP and Lot Size based on user settings
            const slDistance = Math.abs(entry - sl);
            const tp = direction === 'bullish' ? entry + (slDistance * rrRatio) : entry - (slDistance * rrRatio);
            const riskPct = slDistance / entry;
            const positionUSD = riskAmount / riskPct;
            const lotSize = (positionUSD / entry).toFixed(4);

            return {
                name: coin.name,
                symbol: coin.symbol.toUpperCase(),
                entry: entry.toFixed(5),
                sl: sl.toFixed(5),
                tp: tp.toFixed(5),
                lotSize,
                rr: rrRatio,
                notes: analysis.rationale,
                direction: direction === 'bullish' ? 'Long' : 'Short'
            };
        }
        return null; // No valid trade found
    }

    // --- Initial Load ---
    loadSettings();
});
