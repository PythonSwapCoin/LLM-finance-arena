/**
 * TypeScript implementation of yfinance-like functionality
 * Mimics the Python yfinance library API for browser use
 * Based on: https://ranaroussi.github.io/yfinance/
 */

export interface TickerInfo {
  symbol: string;
  shortName?: string;
  longName?: string;
  currency?: string;
  exchange?: string;
  marketCap?: number;
  regularMarketPrice?: number;
  regularMarketChange?: number;
  regularMarketChangePercent?: number;
  regularMarketVolume?: number;
  previousClose?: number;
  open?: number;
  dayLow?: number;
  dayHigh?: number;
  fiftyTwoWeekLow?: number;
  fiftyTwoWeekHigh?: number;
  averageVolume?: number;
  // Financial metrics from defaultKeyStatistics
  trailingPE?: number;
  forwardPE?: number;
  priceToBook?: number;
  priceToSales?: number;
  enterpriseValue?: number;
  enterpriseToRevenue?: number;
  enterpriseToEbitda?: number;
  beta?: number;
  profitMargins?: number;
  grossMargins?: number;
  operatingMargins?: number;
  debtToEquity?: number;
  dividendYield?: number;
  payoutRatio?: number;
  fiftyTwoWeekChange?: number;
  sector?: string;
  industry?: string;
  [key: string]: any; // Allow additional properties
}

export interface HistoricalDataPoint {
  date: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  adjClose?: number;
}

export interface HistoryOptions {
  period?: '1d' | '5d' | '1mo' | '3mo' | '6mo' | '1y' | '2y' | '5y' | '10y' | 'ytd' | 'max';
  interval?: '1m' | '2m' | '5m' | '15m' | '30m' | '60m' | '90m' | '1h' | '1d' | '5d' | '1wk' | '1mo' | '3mo';
  start?: string | Date;
  end?: string | Date;
}

/**
 * Ticker class - mimics yfinance.Ticker
 */
export class Ticker {
  private symbol: string;
  private _info: TickerInfo | null = null;
  private _historyCache: HistoricalDataPoint[] | null = null;

  constructor(symbol: string) {
    this.symbol = symbol.toUpperCase();
  }

  /**
   * Get ticker info (similar to yfinance Ticker.info)
   */
  async info(): Promise<TickerInfo> {
    if (this._info) {
      return this._info;
    }

    try {
      const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${this.symbol}?modules=summaryProfile,price,defaultKeyStatistics,financialData`;
      // Try multiple CORS proxy options
      let response: Response | null = null;
      const proxies = [
        `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
        `https://corsproxy.io/?${encodeURIComponent(url)}`,
        `https://cors-anywhere.herokuapp.com/${url}`,
      ];
      
      for (const proxyUrl of proxies) {
        try {
          response = await fetch(proxyUrl, {
            method: 'GET',
            headers: {
              'Accept': 'application/json',
            },
            signal: AbortSignal.timeout(10000), // 10 second timeout
          });
          if (response.ok) break;
        } catch (error) {
          // Try next proxy
          continue;
        }
      }
      
      if (!response || !response.ok) {
        throw new Error(`Failed to fetch info for ${this.symbol}`);
      }

      const data = await response.json();
      const result = data.quoteSummary?.result?.[0];

      if (!result) {
        throw new Error(`No data found for ${this.symbol}`);
      }

      const price = result.price || {};
      const summary = result.summaryProfile || {};
      const stats = result.defaultKeyStatistics || {};
      const financialData = result.financialData || {};

      // Helper to extract raw value or fallback to direct value
      const getRaw = (obj: any, key: string) => obj?.[key]?.raw ?? obj?.[key];

      this._info = {
        symbol: this.symbol,
        shortName: price.shortName || summary.shortName,
        longName: price.longName || summary.longName,
        currency: price.currency,
        exchange: price.exchange,
        marketCap: getRaw(price, 'marketCap'),
        regularMarketPrice: getRaw(price, 'regularMarketPrice') || price.regularMarketPrice,
        regularMarketChange: getRaw(price, 'regularMarketChange') || price.regularMarketChange,
        regularMarketChangePercent: getRaw(price, 'regularMarketChangePercent') || price.regularMarketChangePercent,
        regularMarketVolume: getRaw(price, 'regularMarketVolume') || price.regularMarketVolume,
        previousClose: getRaw(price, 'regularMarketPreviousClose') || price.regularMarketPreviousClose,
        open: getRaw(price, 'regularMarketOpen') || price.regularMarketOpen,
        dayLow: getRaw(price, 'regularMarketDayLow') || price.regularMarketDayLow,
        dayHigh: getRaw(price, 'regularMarketDayHigh') || price.regularMarketDayHigh,
        fiftyTwoWeekLow: getRaw(price, 'fiftyTwoWeekLow') || price.fiftyTwoWeekLow,
        fiftyTwoWeekHigh: getRaw(price, 'fiftyTwoWeekHigh') || price.fiftyTwoWeekHigh,
        averageVolume: getRaw(stats, 'averageVolume') || stats.averageVolume,
        // Financial metrics from defaultKeyStatistics
        trailingPE: getRaw(stats, 'trailingPE') ?? stats.trailingPE,
        forwardPE: getRaw(stats, 'forwardPE') ?? stats.forwardPE,
        priceToBook: getRaw(stats, 'priceToBook') ?? stats.priceToBook,
        priceToSales: getRaw(stats, 'priceToSalesTrailing12Months') ?? stats.priceToSalesTrailing12Months,
        enterpriseValue: getRaw(stats, 'enterpriseValue') ?? stats.enterpriseValue,
        enterpriseToRevenue: getRaw(stats, 'enterpriseToRevenue') ?? stats.enterpriseToRevenue,
        enterpriseToEbitda: getRaw(stats, 'enterpriseToEbitda') ?? stats.enterpriseToEbitda,
        beta: getRaw(stats, 'beta') ?? stats.beta,
        profitMargins: getRaw(stats, 'profitMargins') ?? stats.profitMargins,
        grossMargins: getRaw(stats, 'grossMargins') ?? stats.grossMargins,
        operatingMargins: getRaw(stats, 'operatingMargins') ?? stats.operatingMargins,
        debtToEquity: getRaw(stats, 'debtToEquity') ?? stats.debtToEquity,
        dividendYield: getRaw(stats, 'dividendYield') ?? stats.dividendYield,
        payoutRatio: getRaw(stats, 'payoutRatio') ?? stats.payoutRatio,
        fiftyTwoWeekChange: getRaw(stats, '52WeekChange') ?? stats['52WeekChange'],
        sector: summary.sector,
        industry: summary.industry,
      };

      return this._info;
    } catch (error) {
      console.error(`Error fetching info for ${this.symbol}:`, error);
      throw error;
    }
  }

  /**
   * Get historical data (similar to yfinance Ticker.history)
   */
  async history(options: HistoryOptions = {}): Promise<HistoricalDataPoint[]> {
    try {
      const { period = '1mo', interval = '1d', start, end } = options;

      let url = `https://query1.finance.yahoo.com/v8/finance/chart/${this.symbol}?interval=${interval}`;

      if (start && end) {
        const startDate = typeof start === 'string' ? new Date(start) : start;
        const endDate = typeof end === 'string' ? new Date(end) : end;
        const period1 = Math.floor(startDate.getTime() / 1000);
        const period2 = Math.floor(endDate.getTime() / 1000);
        url += `&period1=${period1}&period2=${period2}`;
      } else {
        url += `&range=${period}`;
      }

      // Try multiple CORS proxy options
      let response: Response | null = null;
      const proxies = [
        `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
        `https://corsproxy.io/?${encodeURIComponent(url)}`,
        `https://cors-anywhere.herokuapp.com/${url}`,
      ];
      
      for (const proxyUrl of proxies) {
        try {
          response = await fetch(proxyUrl, {
            method: 'GET',
            headers: {
              'Accept': 'application/json',
            },
            signal: AbortSignal.timeout(10000), // 10 second timeout
          });
          if (response.ok) break;
        } catch (error) {
          // Try next proxy
          continue;
        }
      }
      
      if (!response || !response.ok) {
        throw new Error(`Failed to fetch history for ${this.symbol}`);
      }

      const data = await response.json();
      const result = data.chart?.result?.[0];

      if (!result) {
        throw new Error(`No historical data found for ${this.symbol}`);
      }

      const timestamps = result.timestamp || [];
      const quote = result.indicators?.quote?.[0] || {};
      const adjClose = result.indicators?.adjclose?.[0]?.adjclose || [];

      const opens = quote.open || [];
      const highs = quote.high || [];
      const lows = quote.low || [];
      const closes = quote.close || [];
      const volumes = quote.volume || [];

      const history: HistoricalDataPoint[] = [];

      for (let i = 0; i < timestamps.length; i++) {
        if (closes[i] == null) continue; // Skip null values

        history.push({
          date: new Date(timestamps[i] * 1000),
          open: opens[i] || closes[i],
          high: highs[i] || closes[i],
          low: lows[i] || closes[i],
          close: closes[i],
          volume: volumes[i] || 0,
          adjClose: adjClose[i] || closes[i],
        });
      }

      this._historyCache = history;
      return history;
    } catch (error) {
      console.error(`Error fetching history for ${this.symbol}:`, error);
      throw error;
    }
  }

  /**
   * Get current price quickly (lightweight)
   */
  async fastInfo(): Promise<{ price: number; change: number; changePercent: number }> {
    try {
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${this.symbol}?interval=1d&range=2d`;
      // Try multiple CORS proxy options
      let response: Response | null = null;
      const proxies = [
        `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
        `https://corsproxy.io/?${encodeURIComponent(url)}`,
        `https://cors-anywhere.herokuapp.com/${url}`,
      ];
      
      for (const proxyUrl of proxies) {
        try {
          response = await fetch(proxyUrl, {
            method: 'GET',
            headers: {
              'Accept': 'application/json',
            },
            signal: AbortSignal.timeout(10000), // 10 second timeout
          });
          if (response.ok) break;
        } catch (error) {
          // Try next proxy
          continue;
        }
      }
      
      if (!response || !response.ok) {
        throw new Error(`Failed to fetch data for ${this.symbol}`);
      }

      const data = await response.json();
      const result = data.chart?.result?.[0];

      if (!result || !result.indicators?.quote?.[0]) {
        throw new Error(`No data found for ${this.symbol}`);
      }

      const quote = result.indicators.quote[0];
      const closes = quote.close || [];
      const timestamps = result.timestamp || [];

      if (closes.length < 2) {
        throw new Error(`Insufficient data for ${this.symbol}`);
      }

      const currentPrice = closes[closes.length - 1];
      const prevPrice = closes[closes.length - 2];
      const change = currentPrice - prevPrice;
      const changePercent = prevPrice > 0 ? change / prevPrice : 0;

      return {
        price: currentPrice,
        change,
        changePercent,
      };
    } catch (error) {
      console.error(`Error fetching fast info for ${this.symbol}:`, error);
      throw error;
    }
  }

  /**
   * Get the symbol
   */
  get ticker(): string {
    return this.symbol;
  }
}

/**
 * Download multiple tickers (similar to yfinance.download)
 */
export async function download(
  tickers: string | string[],
  options: HistoryOptions = {}
): Promise<{ [symbol: string]: HistoricalDataPoint[] }> {
  const tickerList = Array.isArray(tickers) ? tickers : [tickers];
  const results: { [symbol: string]: HistoricalDataPoint[] } = {};

  await Promise.all(
    tickerList.map(async (symbol) => {
      try {
        const ticker = new Ticker(symbol);
        const history = await ticker.history(options);
        results[symbol] = history;
      } catch (error) {
        console.error(`Error downloading ${symbol}:`, error);
        results[symbol] = [];
      }
    })
  );

  return results;
}

/**
 * Create a Ticker instance (similar to yfinance.Ticker)
 */
export function createTicker(symbol: string): Ticker {
  return new Ticker(symbol);
}

