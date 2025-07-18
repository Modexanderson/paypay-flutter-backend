const express = require('express');
const crypto = require('crypto');
const axios = require('axios');
const cors = require('cors');
require('dotenv').config();

const app = express();

app.use(cors({
  origin: '*',
  credentials: false,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());

const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const MOCK_MODE = process.env.MOCK_MODE === 'true' || false;

const PAYPAY_API_BASE = IS_PRODUCTION 
  ? 'https://api.paypay.ne.jp' 
  : 'https://stg-api.paypay.ne.jp';

const API_KEY = process.env.PAYPAY_API_KEY;
const API_SECRET = process.env.PAYPAY_API_SECRET;
const MERCHANT_ID = process.env.PAYPAY_MERCHANT_ID;

app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    environment: IS_PRODUCTION ? 'production' : 'development',
    mockMode: MOCK_MODE 
  });
});

app.get('/debug', (req, res) => {
  res.json({
    environment: IS_PRODUCTION ? 'production' : 'development',
    mockMode: MOCK_MODE,
    hasApiKey: !!API_KEY,
    hasApiSecret: !!API_SECRET,
    hasMerchantId: !!MERCHANT_ID,
    apiKeyPreview: API_KEY ? `${API_KEY.substring(0, 8)}...` : 'MISSING',
    apiSecretPreview: API_SECRET ? `${API_SECRET.substring(0, 8)}...` : 'MISSING',
    merchantIdPreview: MERCHANT_ID ? `${MERCHANT_ID.substring(0, 8)}...` : 'MISSING',
    apiBase: PAYPAY_API_BASE,
    allEnvKeys: Object.keys(process.env).filter(key => key.includes('PAYPAY'))
  });
});

if (!MOCK_MODE && (!API_KEY || !API_SECRET || !MERCHANT_ID)) {
  console.error('Missing required PayPay credentials');
  process.exit(1);
}

function generateAuthHeader(method, resourceUrl, body = '') {
  const timestamp = Math.floor(Date.now() / 1000);
  const nonce = crypto.randomBytes(16).toString('hex');
  
  let contentHash = 'empty';
  if (body && body.trim() !== '' && method !== 'GET') {
    const md5 = crypto.createHash('md5');
    md5.update('application/json');
    md5.update(body);
    contentHash = md5.digest('base64');
  }
  
  const signatureString = `${method}\n${resourceUrl}\n${API_KEY}\n${timestamp}\n${nonce}\n${contentHash}\n`;
  const signature = crypto.createHmac('sha256', API_SECRET).update(signatureString).digest('base64');
  const authValue = `hmac OPA-Auth:${API_KEY}:${signature}:${nonce}:${timestamp}`;
  
  return {
    'Authorization': authValue,
    'Content-Type': 'application/json',
    'X-ASSUME-MERCHANT': MERCHANT_ID
  };
}

app.post('/create-payment', async (req, res) => {
  try {
    const { amount, merchantPaymentId, description } = req.body;
    
    if (!amount || !merchantPaymentId || !description) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: amount, merchantPaymentId, description'
      });
    }

    if (MOCK_MODE) {
      console.log(`Mock payment created: ${amount} JPY - ${merchantPaymentId}`);
      
      await new Promise(resolve => setTimeout(resolve, 1500));
      
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
            expiryDate: Math.floor(Date.now() / 1000) + 300,
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

    console.log(`Creating payment: ${amount} JPY - ${merchantPaymentId}`);

    const response = await axios.post(
      `${PAYPAY_API_BASE}${resourceUrl}`,
      paymentData,
      { 
        headers,
        timeout: 30000
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
      mockMode: MOCK_MODE
    });
  }
});

app.get('/payment-status/:merchantPaymentId', async (req, res) => {
  try {
    const { merchantPaymentId } = req.params;
    
    if (!merchantPaymentId) {
      return res.status(400).json({
        success: false,
        error: 'Missing merchantPaymentId parameter'
      });
    }

    if (MOCK_MODE) {
      console.log(`Mock payment status check: ${merchantPaymentId}`);
      
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
            status: "COMPLETED",
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

    const resourceUrl = `/v2/payments/${merchantPaymentId}`;
    const headers = generateAuthHeader('GET', resourceUrl);

    console.log(`Checking payment status: ${merchantPaymentId}`);

    const response = await axios.get(
      `${PAYPAY_API_BASE}${resourceUrl}`,
      { 
        headers,
        timeout: 15000
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
      mockMode: MOCK_MODE
    });
  }
});

app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    success: false,
    error: 'Internal server error',
    mockMode: MOCK_MODE
  });
});

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
  console.log(`Environment: ${IS_PRODUCTION ? 'production' : 'development'}`);
  console.log(`PayPay API: ${PAYPAY_API_BASE}`);
  console.log(`Mock Mode: ${MOCK_MODE ? 'enabled' : 'disabled'}`);
});