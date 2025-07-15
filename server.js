const express = require('express');
const crypto = require('crypto');
const axios = require('axios');
const cors = require('cors');
require('dotenv').config();

const app = express();

// Fixed CORS for mobile apps
app.use(cors({
  origin: '*', // Allow all origins for mobile apps
  credentials: false, // Mobile apps don't need credentials
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());

// Mock mode for testing - set to false when you have real PayPay credentials
const MOCK_MODE = false; // Using real PayPay credentials from client

// PayPay Configuration
const PAYPAY_API_BASE = 'https://stg-api.paypay.ne.jp'; // Sandbox URL

const API_KEY = process.env.PAYPAY_API_KEY;
const API_SECRET = process.env.PAYPAY_API_SECRET;
const MERCHANT_ID = process.env.PAYPAY_MERCHANT_ID;

// Health check endpoint for Render
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    mockMode: MOCK_MODE 
  });
});

// Alternative test endpoint with different API base URLs
app.get('/test-paypay-environments', async (req, res) => {
  const environments = [
    { name: 'Sandbox', url: 'https://stg-api.paypay.ne.jp' },
    { name: 'Production', url: 'https://api.paypay.ne.jp' }
  ];
  
  const results = [];
  
  for (const env of environments) {
    try {
      const testPaymentData = {
        merchantPaymentId: `test_${Date.now()}_${env.name.toLowerCase()}`,
        amount: {
          amount: 100,
          currency: 'JPY'
        },
        orderDescription: `Test Payment ${env.name}`,
        codeType: 'ORDER_QR',
        redirectUrl: 'paypayflutterdemo://payment-success',
        redirectType: 'APP_DEEP_LINK',
        requestedAt: Math.floor(Date.now() / 1000)
      };

      const resourceUrl = '/v2/codes';
      const headers = generateAuthHeader('POST', resourceUrl, JSON.stringify(testPaymentData));

      console.log(`=== TESTING ${env.name.toUpperCase()} ENVIRONMENT ===`);
      console.log('URL:', `${env.url}${resourceUrl}`);

      const response = await axios.post(
        `${env.url}${resourceUrl}`,
        testPaymentData,
        { 
          headers,
          timeout: 10000
        }
      );

      results.push({
        environment: env.name,
        success: true,
        response: response.data
      });

      console.log(`${env.name} SUCCESS:`, response.data);

    } catch (error) {
      const errorData = {
        environment: env.name,
        success: false,
        error: error.response?.data || error.message,
        status: error.response?.status
      };
      
      results.push(errorData);
      console.error(`${env.name} ERROR:`, error.response?.data || error.message);
    }
  }
  
  res.json({
    message: 'Tested PayPay environments',
    results: results
  });
});
app.get('/test-paypay', async (req, res) => {
  try {
    const testPaymentData = {
      merchantPaymentId: `test_${Date.now()}`,
      amount: {
        amount: 100,
        currency: 'JPY'
      },
      orderDescription: 'Test Payment',
      codeType: 'ORDER_QR',
      redirectUrl: 'paypayflutterdemo://payment-success',
      redirectType: 'APP_DEEP_LINK',
      requestedAt: Math.floor(Date.now() / 1000)
    };

    const resourceUrl = '/v2/codes';
    const headers = generateAuthHeader('POST', resourceUrl, JSON.stringify(testPaymentData));

    console.log('=== TEST PAYPAY API REQUEST ===');
    console.log('URL:', `${PAYPAY_API_BASE}${resourceUrl}`);
    console.log('Headers:', JSON.stringify(headers, null, 2));
    console.log('Body:', JSON.stringify(testPaymentData, null, 2));
    console.log('===============================');

    const response = await axios.post(
      `${PAYPAY_API_BASE}${resourceUrl}`,
      testPaymentData,
      { 
        headers,
        timeout: 30000
      }
    );

    res.json({
      success: true,
      message: 'PayPay API test successful!',
      response: response.data
    });

  } catch (error) {
    console.error('=== TEST PAYPAY API ERROR ===');
    console.error('Error:', error.response?.data || error.message);
    console.error('Status:', error.response?.status);
    console.error('Headers:', error.response?.headers);
    console.error('============================');

    res.status(500).json({
      success: false,
      error: error.response?.data || error.message,
      status: error.response?.status,
      details: 'Check server logs for full error details'
    });
  }
});
app.get('/debug', (req, res) => {
  res.json({
    mockMode: MOCK_MODE,
    hasApiKey: !!API_KEY,
    hasApiSecret: !!API_SECRET,
    hasMerchantId: !!MERCHANT_ID,
    apiKeyPreview: API_KEY ? `${API_KEY.substring(0, 8)}...` : 'MISSING',
    apiSecretPreview: API_SECRET ? `${API_SECRET.substring(0, 8)}...` : 'MISSING',
    merchantIdPreview: MERCHANT_ID ? `${MERCHANT_ID.substring(0, 8)}...` : 'MISSING',
    nodeEnv: process.env.NODE_ENV || 'development',
    apiBase: PAYPAY_API_BASE,
    allEnvKeys: Object.keys(process.env).filter(key => key.includes('PAYPAY')),
    // Add credential validation
    credentialsValid: {
      apiKey: API_KEY === 'a_upOegjZBZE_yVtZ',
      apiSecret: API_SECRET === 'dTDIJthE4wPLmRMTId5DKUIi4+/nSjgCWsJ6YzWUs8s=',
      merchantId: MERCHANT_ID === '934417530954326016'
    }
  });
});

// Validate required environment variables (only if not in mock mode)
if (!MOCK_MODE && (!API_KEY || !API_SECRET || !MERCHANT_ID)) {
  console.error('Missing required PayPay credentials in environment variables');
  console.error('Set MOCK_MODE = true to test without credentials');
  process.exit(1);
}

// Generate PayPay Authorization Header
function generateAuthHeader(method, resourceUrl, body = '') {
  const timestamp = Math.floor(Date.now() / 1000);
  const nonce = crypto.randomBytes(16).toString('hex');
  
  // Step 1: Create content hash (MD5 of content-type + body) or "empty" for GET
  let contentHash = 'empty';
  if (body && body.trim() !== '' && method !== 'GET') {
    const md5 = crypto.createHash('md5');
    md5.update('application/json'); // content-type
    md5.update(body);
    contentHash = md5.digest('base64');
  }
  
  // Step 2: Build signature string according to PayPay spec
  // Format: method\nresourceUrl\napi_key\ntimestamp\nnonce\ncontentHash\n
  const signatureString = `${method}\n${resourceUrl}\n${API_KEY}\n${timestamp}\n${nonce}\n${contentHash}\n`;
  
  console.log('=== HMAC DEBUG ===');
  console.log('Signature String:', JSON.stringify(signatureString));
  console.log('API Secret:', API_SECRET.substring(0, 10) + '...');
  console.log('==================');
  
  // Step 3: Generate HMAC-SHA256 signature
  const signature = crypto.createHmac('sha256', API_SECRET).update(signatureString).digest('base64');
  
  // Step 4: Build authorization header - PayPay format without contentHash at end
  // Correct format: hmac OPA-Auth:api_key:signature:nonce:timestamp
  const authValue = `hmac OPA-Auth:${API_KEY}:${signature}:${nonce}:${timestamp}`;
  
  console.log('=== AUTH HEADER ===');
  console.log('Authorization:', authValue);
  console.log('==================');
  
  return {
    'Authorization': authValue,
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

    // MOCK MODE - Return fake success response for testing
    if (MOCK_MODE) {
      console.log(`MOCK MODE: Creating fake payment for amount: ${amount} JPY`);
      console.log(`Mock merchant payment ID: ${merchantPaymentId}`);
      
      // Simulate API delay
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      return res.json({
        success: true,
        data: {
          resultInfo: {
            code: "SUCCESS",
            message: "Success",
            codeId: "08100001"
          },
          data: {
            codeId: `mock_code_${merchantPaymentId}`,
            url: `https://sandbox-app.paypay.ne.jp/bff/v2/cod?codeId=mock_code_${merchantPaymentId}`,
            deeplink: `paypay://payment?link_id=mock_${merchantPaymentId}&amount=${amount}`,
            expiryDate: Math.floor(Date.now() / 1000) + 300, // 5 minutes from now
            merchantPaymentId: merchantPaymentId,
            amount: {
              amount: amount,
              currency: "JPY"
            },
            orderDescription: description,
            codeType: "ORDER_QR",
            redirectUrl: "paypayflutterdemo://payment-success",
            redirectType: "APP_DEEP_LINK"
          }
        },
        deeplink: `paypay://payment?link_id=mock_${merchantPaymentId}&amount=${amount}`,
        mockMode: true
      });
    }

    // Real PayPay API call
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
    console.log('DEBUG - Request details:');
    console.log('- URL:', `${PAYPAY_API_BASE}${resourceUrl}`);
    console.log('- Method: POST');
    console.log('- Headers:', JSON.stringify(headers, null, 2));
    console.log('- Body:', JSON.stringify(paymentData, null, 2));

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
      deeplink: response.data.data.deeplink,
      mockMode: false
    });

  } catch (error) {
    console.error('Payment creation error:', error.response?.data || error.message);
    res.status(500).json({
      success: false,
      error: error.response?.data || 'Payment creation failed',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined,
      mockMode: MOCK_MODE
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

    // MOCK MODE - Return fake payment status
    if (MOCK_MODE) {
      console.log(`MOCK MODE: Checking payment status for: ${merchantPaymentId}`);
      
      // Simulate API delay
      await new Promise(resolve => setTimeout(resolve, 500));
      
      return res.json({
        success: true,
        data: {
          resultInfo: {
            code: "SUCCESS",
            message: "Success"
          },
          data: {
            paymentId: `mock_payment_${merchantPaymentId}`,
            status: "COMPLETED", // Mock successful payment
            acceptedAt: Math.floor(Date.now() / 1000),
            merchantPaymentId: merchantPaymentId,
            amount: {
              amount: 100,
              currency: "JPY"
            },
            orderDescription: "Flutter PayPay Test Payment",
            paymentMethods: [
              {
                amount: {
                  amount: 100,
                  currency: "JPY"
                },
                type: "WALLET"
              }
            ]
          }
        },
        mockMode: true
      });
    }

    // Real PayPay API call
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
      data: response.data,
      mockMode: false
    });

  } catch (error) {
    console.error('Payment status error:', error.response?.data || error.message);
    
    if (error.response?.status === 404) {
      return res.status(404).json({
        success: false,
        error: 'Payment not found',
        mockMode: MOCK_MODE
      });
    }

    res.status(500).json({
      success: false,
      error: error.response?.data || 'Failed to get payment status',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined,
      mockMode: MOCK_MODE
    });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    success: false,
    error: 'Internal server error',
    mockMode: MOCK_MODE
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    error: 'Endpoint not found',
    mockMode: MOCK_MODE
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`PayPay backend server running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`PayPay API Base: ${PAYPAY_API_BASE}`);
  console.log(`Mock Mode: ${MOCK_MODE ? 'ENABLED (for testing)' : 'DISABLED (using real PayPay API)'}`);
  
  if (MOCK_MODE) {
    console.log('🎭 MOCK MODE ACTIVE - Returning fake successful responses');
    console.log('💡 Set MOCK_MODE = false when you have valid PayPay credentials');
  }
});