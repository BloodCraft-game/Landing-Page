import clientPromise from '../lib/mongodb.js';

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Only allow GET requests
  if (req.method !== 'GET') {
    return res.status(405).json({ 
      success: false, 
      message: 'Method not allowed' 
    });
  }

  try {
    // Connect to MongoDB
    const client = await clientPromise;
    const db = client.db('bloodcraft');
    const collection = db.collection('waitlist');

    // Fetch all waitlist entries, sorted by newest first
    const data = await collection
      .find({})
      .sort({ createdAt: -1 })
      .limit(1000) // Limit to 1000 entries for performance
      .toArray();

    return res.status(200).json({
      success: true,
      data: data,
      count: data.length
    });

  } catch (error) {
    console.error('Admin API Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch data',
      error: error.message
    });
  }
}
