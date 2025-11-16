import clientPromise from '../lib/mongodb.js';

// Rate limiting storage (in-memory for simplicity)
const rateLimitMap = new Map();

// Email validation regex
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Ethereum wallet validation regex
const WALLET_REGEX = /^0x[a-fA-F0-9]{40}$/;

// Check if reCAPTCHA is enabled in settings
async function isRecaptchaEnabled(db) {
  try {
    const settingsCollection = db.collection('settings');
    const setting = await settingsCollection.findOne({ key: 'recaptcha_enabled' });
    return setting ? setting.value : true; // Default to enabled
  } catch (error) {
    console.error('Error checking reCAPTCHA setting:', error);
    return true; // Default to enabled on error
  }
}

// Verify reCAPTCHA
async function verifyRecaptcha(token) {
  const secret = process.env.RECAPTCHA_SECRET_KEY;
  
  if (!secret) {
    console.warn('RECAPTCHA_SECRET_KEY not set, skipping verification');
    return true; // Skip in development
  }

  try {
    const response = await fetch('https://www.google.com/recaptcha/api/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `secret=${secret}&response=${token}`
    });

    const data = await response.json();
    return data.success && data.score > 0.5; // Score threshold for v3
  } catch (error) {
    console.error('reCAPTCHA verification error:', error);
    return false;
  }
}

// Rate limiting check
function checkRateLimit(identifier) {
  const now = Date.now();
  const windowMs = 3600000; // 1 hour
  const maxRequests = 5;

  if (!rateLimitMap.has(identifier)) {
    rateLimitMap.set(identifier, []);
  }

  const requests = rateLimitMap.get(identifier);
  const recentRequests = requests.filter(time => now - time < windowMs);

  if (recentRequests.length >= maxRequests) {
    return false;
  }

  recentRequests.push(now);
  rateLimitMap.set(identifier, recentRequests);
  return true;
}

// Get user data from request
function getUserData(req) {
  const forwardedFor = req.headers['x-forwarded-for'];
  const ip = forwardedFor ? forwardedFor.split(',')[0] : req.socket?.remoteAddress || 'unknown';
  
  return {
    ip,
    userAgent: req.headers['user-agent'] || 'unknown',
    referer: req.headers['referer'] || null,
    acceptLanguage: req.headers['accept-language'] || null,
    timestamp: new Date()
  };
}

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Connect to MongoDB for all operations
  const client = await clientPromise;
  const db = client.db('bloodcraft');

  // GET: Return count and reCAPTCHA status
  if (req.method === 'GET') {
    try {
      const collection = db.collection('waitlist');
      const count = await collection.countDocuments();
      const recaptchaEnabled = await isRecaptchaEnabled(db);

      return res.status(200).json({ 
        success: true, 
        count,
        recaptchaEnabled
      });
    } catch (error) {
      console.error('GET Error:', error);
      return res.status(500).json({ 
        success: false, 
        message: 'Failed to fetch count' 
      });
    }
  }

  // POST: Add to waitlist
  if (req.method === 'POST') {
    try {
      const { email, wallet, recaptchaToken } = req.body;

      // Validate required fields
      if (!email) {
        return res.status(400).json({ 
          success: false, 
          message: 'Email is required' 
        });
      }

      // Validate email format
      if (!EMAIL_REGEX.test(email)) {
        return res.status(400).json({ 
          success: false, 
          message: 'Invalid email format' 
        });
      }

      // Validate wallet format (if provided)
      if (wallet && !WALLET_REGEX.test(wallet)) {
        return res.status(400).json({ 
          success: false, 
          message: 'Invalid wallet address. Must start with 0x and be 42 characters long' 
        });
      }

      // Check if reCAPTCHA is enabled
      const recaptchaEnabled = await isRecaptchaEnabled(db);

      // Verify reCAPTCHA only if enabled
      if (recaptchaEnabled) {
        if (!recaptchaToken) {
          return res.status(400).json({ 
            success: false, 
            message: 'reCAPTCHA token is required' 
          });
        }

        const isHuman = await verifyRecaptcha(recaptchaToken);
        if (!isHuman) {
          return res.status(400).json({ 
            success: false, 
            message: 'reCAPTCHA verification failed. Please try again.' 
          });
        }
      }

      // Rate limiting
      const userData = getUserData(req);
      if (!checkRateLimit(userData.ip)) {
        return res.status(429).json({ 
          success: false, 
          message: 'Too many requests. Please try again later.' 
        });
      }

      const collection = db.collection('waitlist');

      // Check if email already exists
      const existingEntry = await collection.findOne({ email: email.toLowerCase() });
      if (existingEntry) {
        return res.status(409).json({ 
          success: false, 
          message: 'This email is already on the waitlist!' 
        });
      }

      // Insert new entry
      const entry = {
        email: email.toLowerCase(),
        wallet: wallet || null,
        ...userData,
        createdAt: new Date(),
        updatedAt: new Date()
      };

      await collection.insertOne(entry);

      // Get updated count
      const count = await collection.countDocuments();

      return res.status(201).json({ 
        success: true, 
        message: 'Successfully joined the waitlist!',
        count
      });

    } catch (error) {
      console.error('POST Error:', error);
      return res.status(500).json({ 
        success: false, 
        message: 'Internal server error. Please try again.' 
      });
    }
  }

  // Method not allowed
  return res.status(405).json({ 
    success: false, 
    message: 'Method not allowed' 
  });
}
