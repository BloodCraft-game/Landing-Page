import clientPromise from '../../lib/mongodb.js';

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ 
      success: false, 
      message: 'Method not allowed' 
    });
  }

  try {
    const { enabled } = req.body;

    if (typeof enabled !== 'boolean') {
      return res.status(400).json({
        success: false,
        message: 'Invalid parameter: enabled must be boolean'
      });
    }

    // Connect to MongoDB
    const client = await clientPromise;
    const db = client.db('bloodcraft');
    const settingsCollection = db.collection('settings');

    // Update or insert reCAPTCHA setting
    await settingsCollection.updateOne(
      { key: 'recaptcha_enabled' },
      { 
        $set: { 
          value: enabled,
          updatedAt: new Date()
        }
      },
      { upsert: true }
    );

    return res.status(200).json({
      success: true,
      message: `reCAPTCHA ${enabled ? 'enabled' : 'disabled'}`,
      enabled: enabled
    });

  } catch (error) {
    console.error('Toggle reCAPTCHA Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to update setting',
      error: error.message
    });
  }
}
