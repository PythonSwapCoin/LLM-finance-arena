
import { GoogleGenAI, Type } from "@google/genai";
import type { Agent, MarketData, Trade, TradeAction } from '../types';
import { MAX_POSITION_SIZE_PERCENT } from '../constants';

const API_KEY = process.env.API_KEY;
if (!API_KEY) {
    throw new Error("API_KEY environment variable not set");
}
const ai = new GoogleGenAI({ apiKey: API_KEY });

const PROMPT_TEMPLATES = {
    'gemini-2.5-pro': `You are a virtual portfolio manager operating within a simulated equity-trading environment.
Your goal is to maximize risk-adjusted returns while adhering to the trading rules.
Evaluate macro signals, sector performance, and stock momentum based on the provided data.
Return only your trade decisions in the specified JSON schema.
Avoid excessive turnover and maintain diversification.`,
    'gemini-2.5-flash': `You are an aggressive momentum-based virtual portfolio manager in a simulated trading environment.
Your goal is to maximize short-term returns.
Focus on stocks with high positive momentum.
Return only your trade decisions in the specified JSON schema.
High turnover is acceptable for capturing trends.`,
    'prudent-value-investor': `You are a prudent, value-oriented virtual portfolio manager in a simulated equity-trading environment.
Your goal is to achieve long-term capital appreciation with below-average risk.
Focus on identifying undervalued assets and avoid speculative, high-momentum stocks.
Return only your trade decisions in the specified JSON schema.
Prioritize capital preservation, low turnover, and diversification.`,
    'momentum-trader-9000': `You are Momentum Trader 9000, a hyper-aggressive AI portfolio manager.
Your sole directive is to maximize returns by exploiting short-term market momentum.
You must analyze the market data and identify the top performers to buy and laggards to sell.
Return only your trade decisions in the specified JSON schema.
Do not hold cash unless absolutely necessary. Be fully invested.`
};

const getAgentPrompt = (agent: Agent): string => {
    if (agent.id.includes('pro')) return PROMPT_TEMPLATES['gemini-2.5-pro'];
    if (agent.id.includes('flash')) return PROMPT_TEMPLATES['gemini-2.5-flash'];
    if (agent.id.includes('prudent')) return PROMPT_TEMPLATES['prudent-value-investor'];
    if (agent.id.includes('momentum')) return PROMPT_TEMPLATES['momentum-trader-9000'];
    return PROMPT_TEMPLATES['gemini-2.5-pro'];
};


export const getTradeDecisions = async (
  agent: Agent,
  marketData: MarketData,
  day: number
): Promise<{ trades: Omit<Trade, 'price' | 'timestamp'>[], rationale: string }> => {
  const portfolioValue = Object.values(agent.portfolio.positions).reduce((acc, pos) => acc + pos.quantity * (marketData[pos.ticker]?.price || 0), agent.portfolio.cash);
  
  const systemInstruction = getAgentPrompt(agent);

  const prompt = `
    Timestamp: Day ${day}
    
    Market Snapshot:
    ${Object.values(marketData).map(d => `- ${d.ticker}: $${d.price.toFixed(2)} (Change: ${ (d.dailyChangePercent * 100).toFixed(2)}%)`).join('\n')}
    
    Portfolio State:
    - Cash: $${agent.portfolio.cash.toFixed(2)}
    - Total Value: $${portfolioValue.toFixed(2)}
    - Positions:
    ${Object.values(agent.portfolio.positions).length > 0 ? Object.values(agent.portfolio.positions).map(p => `  - ${p.ticker}: ${p.quantity} shares @ avg $${p.averageCost.toFixed(2)}`).join('\n') : '  No positions held.'}
    
    Rules:
    - No margin or short selling.
    - Maximum position size: ${MAX_POSITION_SIZE_PERCENT * 100}% of total portfolio value.
    - Provide a brief (1-2 sentence) rationale for your overall strategy this turn.

    Based on the above, provide your trade decisions and rationale.
    `;
    
  try {
    const response = await ai.models.generateContent({
      model: agent.model,
      contents: prompt,
      config: {
        systemInstruction,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            rationale: {
              type: Type.STRING,
              description: "A brief 1-2 sentence explanation of the trading strategy for this turn."
            },
            trades: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  ticker: { type: Type.STRING },
                  action: { type: Type.STRING, enum: ['buy', 'sell', 'hold'] },
                  quantity: { type: Type.INTEGER }
                },
                required: ["ticker", "action", "quantity"]
              }
            }
          },
          required: ["rationale", "trades"]
        }
      }
    });

    const jsonText = response.text.trim();
    const result = JSON.parse(jsonText);
    
    // Validate trades
    const validTrades = (result.trades as any[])
      .filter(t => t.action !== 'hold' && t.quantity > 0 && marketData[t.ticker])
      .map(t => ({
          ticker: t.ticker,
          action: t.action as TradeAction,
          quantity: t.quantity,
      }));

    return { trades: validTrades, rationale: result.rationale || "No rationale provided." };

  } catch (error) {
    console.error("Error fetching trade decisions from Gemini:", error);
    return { trades: [], rationale: `Error communicating with AI model: ${error instanceof Error ? error.message : "Unknown error"}` };
  }
};
