// Vercel serverless function: GET /api/simulation/state
import { initializeSimulation, getSimulationState } from '../simulation.js';

export default async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Initialize if not already initialized
    const state = await initializeSimulation();
    
    return res.status(200).json(state);
  } catch (error) {
    console.error('Error getting simulation state:', error);
    return res.status(500).json({ 
      error: 'Failed to get simulation state', 
      message: error.message 
    });
  }
}

