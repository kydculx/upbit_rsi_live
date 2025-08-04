/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';

// --- CORS Proxy ---
const CORS_PROXY = 'https://corsproxy.io/?';


// --- Type Definitions for Upbit API responses ---
interface Market {
  market: string;
  korean_name: string;
  english_name: string;
}

interface Ticker {
    market: string;
    acc_trade_price_24h: number;
}

interface Candle {
  market: string;
  opening_price: number;
  trade_price: number; // This is the closing price for the candle
}

interface MarketWithData {
    market: string;
    korean_name: string;
    english_name: string;
    acc_trade_price_24h: number;
    changeRate?: number | null;
    rsi?: number | null;
}

// --- Constants ---
const intervals = [
    { label: '1분', value: 'minutes/1' },
    { label: '3분', value: 'minutes/3' },
    { label: '5분', value: 'minutes/5' },
    { label: '10분', value: 'minutes/10' },
    { label: '15분', value: 'minutes/15' },
    { label: '30분', value: 'minutes/30' },
    { label: '1시간', value: 'minutes/60' },
    { label: '4시간', value: 'minutes/240' },
    { label: '1일', value: 'days' },
];
const RSI_PERIOD = 14;

// --- Utility Functions ---
const formatVolume = (volume: number): string => {
    const trillion = 1_000_000_000_000;
    const billion = 1_000_000_000;
    if (volume >= trillion) {
        return `${(volume / trillion).toFixed(2)}조`;
    }
    if (volume >= billion) {
        return `${(volume / billion).toFixed(2)}억`;
    }
    return `${Math.round(volume / 1_000_000).toLocaleString()}백만`;
};

const calculateRSI = (prices: number[], period: number = RSI_PERIOD): number | null => {
    if (prices.length <= period) {
        return null;
    }

    const changes = prices.slice(1).map((price, i) => price - prices[i]);
    const initialGains = changes.slice(0, period).filter(change => change > 0).reduce((acc, val) => acc + val, 0);
    const initialLosses = changes.slice(0, period).filter(change => change < 0).reduce((acc, val) => acc + Math.abs(val), 0);
    
    let avgGain = initialGains / period;
    let avgLoss = initialLosses / period;

    for (let i = period; i < changes.length; i++) {
        const change = changes[i];
        const gain = change > 0 ? change : 0;
        const loss = change < 0 ? Math.abs(change) : 0;
        avgGain = (avgGain * (period - 1) + gain) / period;
        avgLoss = (avgLoss * (period - 1) + loss) / period;
    }

    if (avgLoss === 0) {
        return 100;
    }

    const rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
};


// --- Main Application Component ---
function App() {
  const [markets, setMarkets] = useState<MarketWithData[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isIntervalLoading, setIsIntervalLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedInterval, setSelectedInterval] = useState<string>('24h');

  // Effect for fetching the initial top 15 markets by 24h volume
  useEffect(() => {
    const fetchTopMarkets = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const marketResponse = await fetch(`${CORS_PROXY}https://api.upbit.com/v1/market/all`);
        if (!marketResponse.ok) throw new Error(`Failed to fetch market list. Status: ${marketResponse.status}`);
        
        const allMarkets: Market[] = await marketResponse.json();
        const krwMarkets = allMarkets.filter(m => m.market.startsWith('KRW-'));
        const krwMarketCodes = krwMarkets.map(m => m.market);

        const tickerData: Ticker[] = [];
        const BATCH_SIZE = 100;
        for (let i = 0; i < krwMarketCodes.length; i += BATCH_SIZE) {
            const batch = krwMarketCodes.slice(i, i + BATCH_SIZE);
            const tickerResponse = await fetch(`${CORS_PROXY}https://api.upbit.com/v1/ticker?markets=${batch.join(',')}`);
            if (!tickerResponse.ok) throw new Error(`Failed to fetch ticker data. Status: ${tickerResponse.status}`);
            const batchData: Ticker[] = await tickerResponse.json();
            tickerData.push(...batchData);
        }

        const marketInfoMap = new Map(krwMarkets.map(m => [m.market, { korean_name: m.korean_name, english_name: m.english_name }]));
        const combinedData: MarketWithData[] = tickerData.map(ticker => ({
            ...ticker,
            korean_name: marketInfoMap.get(ticker.market)?.korean_name || '',
            english_name: marketInfoMap.get(ticker.market)?.english_name || '',
        }));

        const top15Markets = combinedData
            .sort((a, b) => b.acc_trade_price_24h - a.acc_trade_price_24h)
            .slice(0, 15);
        
        setMarkets(top15Markets);

      } catch (e) {
        setError(e instanceof Error ? e.message : 'An unknown error occurred.');
      } finally {
        setIsLoading(false);
      }
    };
    fetchTopMarkets();
  }, []);

  // Effect for fetching candle data when interval changes
  useEffect(() => {
    if (selectedInterval === '24h') {
        setMarkets(currentMarkets => currentMarkets.map(m => ({...m, changeRate: undefined, rsi: undefined})));
        return;
    }

    if (markets.length === 0) return;

    const fetchIntervalData = async () => {
        setIsIntervalLoading(true);
        try {
            const promises = markets.map(async (market) => {
                const response = await fetch(`${CORS_PROXY}https://api.upbit.com/v1/candles/${selectedInterval}?market=${market.market}&count=100`);
                if (!response.ok) return { market: market.market, changeRate: null, rsi: null };

                const candleData: Candle[] = await response.json();
                let changeRate: number | null = null;
                let rsi: number | null = null;

                if (candleData && candleData.length > 0) {
                    const latestCandle = candleData[0];
                    changeRate = ((latestCandle.trade_price - latestCandle.opening_price) / latestCandle.opening_price) * 100;
                    
                    if (candleData.length > RSI_PERIOD) {
                        const prices = candleData.map(c => c.trade_price).reverse(); // oldest to newest
                        rsi = calculateRSI(prices);
                    }
                }
                return { market: market.market, changeRate, rsi };
            });

            const results = await Promise.all(promises);
            const newIntervalData = new Map(results.map(r => [r.market, { changeRate: r.changeRate, rsi: r.rsi }]));

            setMarkets(currentMarkets => 
                currentMarkets.map(m => ({
                    ...m,
                    changeRate: newIntervalData.get(m.market)?.changeRate,
                    rsi: newIntervalData.get(m.market)?.rsi
                }))
            );

        } catch (e) {
            setError('캔들 데이터 로딩 실패');
        } finally {
            setIsIntervalLoading(false);
        }
    };

    fetchIntervalData();
  }, [selectedInterval, markets.length]);


  return (
    <div className="app-container">
      <header>
        <h1>업비트 KRW 마켓 Top 15</h1>
        <p className="subtitle">24시간 거래량 기준</p>
      </header>

      <div className="interval-selector">
        <button
            key="24h"
            className={`interval-button ${selectedInterval === '24h' ? 'active' : ''}`}
            onClick={() => setSelectedInterval('24h')}>
            24시간
        </button>
        {intervals.map(interval => (
            <button
                key={interval.value}
                className={`interval-button ${selectedInterval === interval.value ? 'active' : ''}`}
                onClick={() => setSelectedInterval(interval.value)}>
                {interval.label}
            </button>
        ))}
      </div>
      
      {error && <p className="error-text">오류: {error}</p>}
      
      {isLoading && <p className="loading-text">시장 목록을 불러오는 중...</p>}

      {!isLoading && !error && (
        <div className="market-list-container">
          <ul className={`market-list ${isIntervalLoading ? 'list-loading' : ''}`}>
            {markets.map((market, index) => {
                const changeRate = market.changeRate;
                const changeRateClass = changeRate == null ? 'neutral' : changeRate >= 0 ? 'positive' : 'negative';
                
                const rsi = market.rsi;
                let rsiClass = 'rsi-neutral';
                if (rsi != null) {
                    if (rsi >= 70) rsiClass = 'rsi-overbought';
                    else if (rsi <= 30) rsiClass = 'rsi-oversold';
                }

                return (
                    <li key={market.market} className="market-list-item">
                        <span className="rank">{index + 1}</span>
                        <div className="market-info">
                            <span className="korean-name">{market.korean_name}</span>
                            <span className="market-code">{market.market}</span>
                        </div>
                        <span className={`change-rate ${changeRateClass}`}>
                            {selectedInterval === '24h'
                                ? '—'
                                : isIntervalLoading
                                ? '...'
                                : changeRate != null
                                ? `${changeRate.toFixed(2)}%`
                                : '-'}
                        </span>
                        <span className={`rsi-value ${rsiClass}`}>
                            {selectedInterval === '24h'
                                ? '—'
                                : isIntervalLoading
                                ? '...'
                                : rsi != null
                                ? rsi.toFixed(2)
                                : '-'}
                        </span>
                        <span className="trade-volume">
                            {formatVolume(market.acc_trade_price_24h)}
                        </span>
                    </li>
                );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

const root = ReactDOM.createRoot(document.getElementById('root') as HTMLElement);
root.render(<App />);
