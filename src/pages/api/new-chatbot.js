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
const api_type = import.meta.env.BUILDER_API_TYPE; 
const api_url = API_TYPE === 'test' 
  ? import.meta.env.TEST_API_URL + '/create' 
  : import.meta.env.PRODUCTION_API_URL + '/create';

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
  if (!contentType.includes('multipart/form-data')) {
    return new Response(JSON.stringify({ 
      error: 'Invalid content type',
      message: 'Expected form data'
    }), {
      status: 415,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    let requestBody;
    try {
      requestBody = await request.formData();
    } catch (e) {
      return new Response(JSON.stringify({ 
        error: 'Invalid form data',
        message: 'The request body contains invalid form data'
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const emailCode = requestBody.get('emailCode');
    const chatbotData = requestBody.get('chatbotData');

    if (!emailCode || !chatbotData) {
      return new Response(JSON.stringify({ 
        error: 'Missing required fields',
        message: 'Missing required chatbotData'
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (!verifyCode(email_secret, emailCode)) {
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

    let apiData;

    try {
        const headers = {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${import.meta.env.API_KEY}`
        };

        if (import.meta.env.API_TYPE === 'test') {
          headers['ngrok-skip-browser-warning'] = 'true';
        }

        const apiResponse = await fetch(api_url, {
          method: 'POST',
          headers: headers, 
          body: JSON.stringify({
            chatbotData: chatbotData
          })
        });

        if (!apiResponse.ok) {
          return new Response(JSON.stringify({
            error: 'Chatbot creation failed',
            message: 'An error occurred while creating chatbot.'
          }), {
            status: apiResponse.status,
            headers: { 'Content-Type': 'application/json' }
          });
        }

        apiData = await apiResponse.json();
        console.log('API response:', apiData);

      } catch (apiError) {
        console.error('API Error:', apiError);
        throw apiError; 
      }
    }

    const client = await pool.connect();
    try {
      const insertQuery = `
        INSERT INTO chatbots (id, owner_email, chatbot_data, )
        VALUES ($1, $2, $3)
        RETURNING id, owner_email, chatbot_data
      `;

      const insertResult = await client.query(insertQuery, [
          apiData.id,
          email,
          apiData.chatbotData
      ]);

      const profileQuery = 'SELECT active_chatbots FROM profiles WHERE email = $1';
      const profileResult = await client.query(profileQuery, [email]);

      let activeChatbots = profileResult.rows[0].active_chatbots;
      activeChatbots += 1;

      const updateProfileDataQuery = 'UPDATE profiles SET activeChatbots = $1 WHERE email = $2';
      await client.query(updateProfileDataQuery, [activeChatbots, email]);

    } finally {
      client.release();
    }

    return new Response(JSON.stringify({ 
      message: 'Successfully made chatbot.',
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
