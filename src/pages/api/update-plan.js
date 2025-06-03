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
const dodopayment_api_key = import.meta.env.DODOPAYMENT_API_KEY;

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
    const subscriptionId = requestBody.subscriptionId;

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
    let product_type;

    try {
      const apiUrl = `https://test.dodopayments.com/subscriptions/${subscriptionId}`;
      const response = await fetch(apiUrl, {
        headers: {
          'Authorization': `Bearer ${dodopayment_api_key}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch payment data: ${response.statusText}`);
      }

      payment = await response.json();
    } catch (error) {
      return new Response(JSON.stringify({
        error: 'Payment verification failed',
        message: 'Could not verify payment status'
      }), {
        status: 502,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const client = await pool.connect();
    try {
      let updatequery;
      let updatevalues;

      if (payment && payment.status === 'active') {
        if (payment.product_id == 'pdt_IwvOy1RQ0NzKldpDy0n6u') {
          updatequery = 'update profiles set is_pro = true, is_business = false, subscription_id = $2 where email = $1';
          product_type = 'pro';
        }
        if (payment.product_id == 'pdt_7NR5zqHCZtltX7k21VGP5') {
          updatequery = 'update profiles set is_pro = false, is_business = true, subscription_id = $2 where email = $1';
          product_type = 'business';
        }
      }

      await client.query(updatequery, [email, subscriptionId]);
    } finally {
      client.release();
    }
    
    return new Response(JSON.stringify({ 
      message: 'Profile data updated successfully',
      product_type: product_type || '',
    }), {
      status: 200,
      headers: { 
        'Content-Type': 'application/json',
        ...(origin && { 'Access-Control-Allow-Origin': origin }),
        'Vary': 'Origin'
      }
    });

  } catch (error) {
    console.error(error);
    
    return new Response(JSON.stringify({ 
      message: error.message,
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
