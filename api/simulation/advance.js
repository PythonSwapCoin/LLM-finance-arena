// Vercel serverless function: POST /api/simulation/advance
import { advanceIntraday, advanceDay } from '../simulation.js';

export default async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { type } = req.body; // 'intraday' or 'day'
    
    let state;
    if (type === 'day') {
      state = await advanceDay();
    } else {
      state = await advanceIntraday();
    }
    
    return res.status(200).json(state);
  } catch (error) {
    console.error('Error advancing simulation:', error);
    return res.status(500).json({ 
      error: 'Failed to advance simulation', 
      message: error.message 
    });
  }
}

