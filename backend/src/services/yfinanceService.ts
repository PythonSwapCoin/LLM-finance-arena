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
  [key: string]: any;
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

export class Ticker {
  private symbol: string;
  private _info: TickerInfo | null = null;
  private _historyCache: HistoricalDataPoint[] | null = null;

  constructor(symbol: string) {
    this.symbol = symbol.toUpperCase();
  }

  async info(): Promise<TickerInfo | null> {
    if (this._info) {
      return this._info;
    }

    try {
      const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${this.symbol}?modules=summaryProfile,price,defaultKeyStatistics,financialData`;
      
      // Server-side: direct fetch (no CORS proxy needed)
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
        },
        signal: AbortSignal.timeout(30000),
      });

      if (!response.ok) {
        // Don't throw, just return null - let the caller handle the error gracefully
        return null;
      }

      const data = await response.json() as any;
      const result = data.quoteSummary?.result?.[0];

      if (!result) {
        // Return null instead of throwing - let the caller handle gracefully
        return null;
      }

      const price = result.price || {};
      const summary = result.summaryProfile || {};
      const stats = result.defaultKeyStatistics || {};
      const financialData = result.financialData || {};

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
      // Don't log to console.error - these are expected when market is closed or rate-limited
      // Return null to let the caller handle gracefully via cascade fallback
      return null;
    }
  }

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

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
        },
        signal: AbortSignal.timeout(30000),
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch history for ${this.symbol}`);
      }

      const data = await response.json() as any;
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
        if (closes[i] == null) continue;

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

  async fastInfo(): Promise<{ price: number; change: number; changePercent: number }> {
    try {
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${this.symbol}?interval=1d&range=2d`;
      
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
        },
        signal: AbortSignal.timeout(30000),
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch data for ${this.symbol}`);
      }

      const data = await response.json() as any;
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

  get ticker(): string {
    return this.symbol;
  }
}

