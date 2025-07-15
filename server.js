const express = require('express');
const crypto = require('crypto');
const axios = require('axios');
const cors = require('cors');
require('dotenv').config();

const app = express();

// Enhanced CORS configuration
app.use(cors({
  origin: process.env.NODE_ENV === 'production' 
    ? ['https://your-flutter-app-domain.com'] // Update with your actual domain
    : '*', // Allow all origins in development
  credentials: true
}));

app.use(express.json());

// Health check endpoint for Render
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK', timestamp: new Date().toISOString() });
});

// PayPay Configuration
const PAYPAY_API_BASE = 'https://stg-api.paypay.ne.jp';
// const PAYPAY_API_BASE = process.env.NODE_ENV === 'production' 
//   ? 'https://api.paypay.ne.jp'  // Production URL
//   : 'https://stg-api.paypay.ne.jp'; // Sandbox URL

const API_KEY = process.env.PAYPAY_API_KEY;
const API_SECRET = process.env.PAYPAY_API_SECRET;
const MERCHANT_ID = process.env.PAYPAY_MERCHANT_ID;

// Validate required environment variables
if (!API_KEY || !API_SECRET || !MERCHANT_ID) {
  console.error('Missing required PayPay credentials in environment variables');
  process.exit(1);
}

// Generate PayPay Authorization Header
function generateAuthHeader(method, resourceUrl, body = '') {
  const timestamp = Math.floor(Date.now() / 1000);
  const nonce = crypto.randomBytes(16).toString('hex');
  
  const signatureString = `${method}\n${resourceUrl}\n${API_KEY}\n${timestamp}\n${nonce}\n${body}\n`;
  const signature = crypto.createHmac('sha256', API_SECRET).update(signatureString).digest('base64');
  
  return {
    'Authorization': `hmac OPA-Auth:${API_KEY}:${signature}:${nonce}:${timestamp}`,
    'Content-Type': 'application/json',
    'X-ASSUME-MERCHANT': MERCHANT_ID
  };
}

// Create Payment
app.post('/create-payment', async (req, res) => {
  try {
    const { amount, merchantPaymentId, description } = req.body;
    
    // Validation
    if (!amount || !merchantPaymentId || !description) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: amount, merchantPaymentId, description'
      });
    }

    const paymentData = {
      merchantPaymentId,
      amount: {
        amount: amount,
        currency: 'JPY'
      },
      orderDescription: description,
      codeType: 'ORDER_QR',
      redirectUrl: 'paypayflutterdemo://payment-success',
      redirectType: 'APP_DEEP_LINK',
      requestedAt: Math.floor(Date.now() / 1000)
    };

    const resourceUrl = '/v2/codes';
    const headers = generateAuthHeader('POST', resourceUrl, JSON.stringify(paymentData));

    console.log(`Creating payment for amount: ${amount} JPY`);

    const response = await axios.post(
      `${PAYPAY_API_BASE}${resourceUrl}`,
      paymentData,
      { 
        headers,
        timeout: 30000 // 30 second timeout
      }
    );

    console.log('Payment created successfully');

    res.json({
      success: true,
      data: response.data,
      deeplink: response.data.data.deeplink
    });

  } catch (error) {
    console.error('Payment creation error:', error.response?.data || error.message);
    res.status(500).json({
      success: false,
      error: error.response?.data || 'Payment creation failed',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Check Payment Status
app.get('/payment-status/:merchantPaymentId', async (req, res) => {
  try {
    const { merchantPaymentId } = req.params;
    
    if (!merchantPaymentId) {
      return res.status(400).json({
        success: false,
        error: 'Missing merchantPaymentId parameter'
      });
    }

    const resourceUrl = `/v2/payments/${merchantPaymentId}`;
    const headers = generateAuthHeader('GET', resourceUrl);

    console.log(`Checking payment status for: ${merchantPaymentId}`);

    const response = await axios.get(
      `${PAYPAY_API_BASE}${resourceUrl}`,
      { 
        headers,
        timeout: 15000 // 15 second timeout
      }
    );

    res.json({
      success: true,
      data: response.data
    });

  } catch (error) {
    console.error('Payment status error:', error.response?.data || error.message);
    
    if (error.response?.status === 404) {
      return res.status(404).json({
        success: false,
        error: 'Payment not found'
      });
    }

    res.status(500).json({
      success: false,
      error: error.response?.data || 'Failed to get payment status',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    success: false,
    error: 'Internal server error'
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    error: 'Endpoint not found'
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`PayPay backend server running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`PayPay API Base: ${PAYPAY_API_BASE}`);
});