export const prerender = false;
import { Pool } from 'pg';
import { generateSecretKeyHash, generateCode, decryptCode, verifyCode } from "../../lib/generateCodes.js";

const pool = new Pool({
  user: import.meta.env.DB_USER,
  host: 'localhost', 
  database: import.meta.env.DB_NAME,
  password: import.meta.env.DB_PASSWORD,
  port: 5432,
  max: 100, 
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

const email_secret = generateSecretKeyHash(import.meta.env.EMAIL_SECRET);
const dodopayment_api_key=import.meta.env.DODOPAYMENT_API_KEY;

const payment_client = new DodoPayments({
  bearerToken: dodopayment_api_key, 
});

export async function POST({ request }) {
  const origin = request.headers.get('origin');
  const requestUrl = new URL(request.url);

  const getRootDomain = (hostname) => {
    const parts = hostname.split('.');
    return parts.slice(-2).join('.'); 
  };

  const apiRootDomain = getRootDomain(requestUrl.hostname);
  const originRootDomain = origin ? getRootDomain(new URL(origin).hostname) : null;
    
  if (origin && originRootDomain !== apiRootDomain) {
    return new Response(JSON.stringify({ 
      error: 'forbidden',
      message: 'Access Denied'
    }), {
      status: 403,
      headers: { 
        'Content-Type': 'application/json',
        'Vary': 'Origin'
      }
    });
  }

  const contentType = request.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    return new Response(JSON.stringify({ 
      error: 'Invalid content type',
      message: 'Request must be JSON formatted'
    }), {
      status: 415,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    let requestBody;
    try {
      requestBody = await request.json();
    } catch (e) {
      return new Response(JSON.stringify({ 
        error: 'Invalid JSON',
        message: 'The request body contains malformed JSON'
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const emailCode = requestBody.emailCode;

    if (!emailCode || !verifyCode(email_secret, emailCode)) {
      return new Response(JSON.stringify({ 
        error: 'Invalid email code',
        message: 'Invalid email code. Redirecting to login page...',
        redirect: '/login'
      }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const email = emailCode.slice(0, emailCode.indexOf(':'));

    let payment;

    (async () => {
      payment = await payment_client.payments.retrieve('payment_id');
    })();

    const client = await pool.connect();
    try {
      const profileQuery = 'SELECT is_pro, is_business FROM profiles WHERE email = $1';
      const profileResult = await client.query(profileQuery, [email]);

      if (payment && payment.status === 'succeeded') {
        if (payment.product_cart.product_id === 'pro') {
        }
        if (payment.product_cart.product_id === 'business') {
        }
      }

      let { is_pro: isPro, is_business: isBusiness } = profileResult.rows[0];

    } finally {
      client.release();
    }
    
    return new Response(JSON.stringify({ 
      message: 'Profile data updated successfully'
    }), {
      status: 200,
      headers: { 
        'Content-Type': 'application/json',
        ...(origin && { 'Access-Control-Allow-Origin': origin }),
        'Vary': 'Origin'
      }
    });

  } catch (error) {
    console.error('Registration error:', error);
    
    return new Response(JSON.stringify({ 
      error: 'Registration failed',
      message: error.message,
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    }), {
      status: 500,
      headers: { 
        'Content-Type': 'application/json',
        ...(origin && { 'Access-Control-Allow-Origin': origin })
      }
    });
  }
}

export async function OPTIONS({ request }) {
  const origin = request.headers.get('origin');
  const requestUrl = new URL(request.url);

  const getRootDomain = (hostname) => {
    const parts = hostname.split('.');
    return parts.slice(-2).join('.'); 
  };

  const apiRootDomain = getRootDomain(requestUrl.hostname);
  const originRootDomain = origin ? getRootDomain(new URL(origin).hostname) : null;

  const isAllowedOrigin = originRootDomain === apiRootDomain;
  
  return new Response(null, {
    status: isAllowedOrigin ? 204 : 403,
    headers: {
      'Access-Control-Allow-Origin': isAllowedOrigin ? origin : '',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400', 
      'Access-Control-Allow-Credentials': 'true',
      'Vary': 'Origin, Access-Control-Request-Headers',
      ...(!isAllowedOrigin && {
        'Content-Type': 'text/plain',
        'Content-Length': '0'
      })
    }
  });
}
