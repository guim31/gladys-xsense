// -----------------------------------------------------------------------------
// The cryptography the X-Sense cloud asks for, with nothing but node:crypto.
//
//   - Cognito SRP (USER_SRP_AUTH): the X-Sense app signs in to an AWS Cognito
//     user pool with the Secure Remote Password protocol, the password never
//     leaves the container. Same arithmetic as amazon-cognito-identity-js'
//     AuthenticationHelper and pycognito (used by python-xsense).
//   - The Cognito SECRET_HASH of an app client that has a secret.
//   - The MD5 "mac" every X-Sense API request carries (values of the request
//     fields + the client secret).
//   - AWS Signature V4 for the AWS IoT device shadows (service `iotdata`), and
//     the presigned WebSocket URL of the AWS IoT MQTT broker.
//
// Every function is pure (the random value, the clock are parameters), so the
// tests check them against values computed by the Python references.
// -----------------------------------------------------------------------------

import { createHash, createHmac, randomBytes } from 'node:crypto';

// RFC 5054 3072-bit group, the one Cognito uses (AuthenticationHelper.js).
const N_HEX =
  'FFFFFFFFFFFFFFFFC90FDAA22168C234C4C6628B80DC1CD1' +
  '29024E088A67CC74020BBEA63B139B22514A08798E3404DD' +
  'EF9519B3CD3A431B302B0A6DF25F14374FE1356D6D51C245' +
  'E485B576625E7EC6F44C42E9A637ED6B0BFF5CB6F406B7ED' +
  'EE386BFB5A899FA5AE9F24117C4B1FE649286651ECE45B3D' +
  'C2007CB8A163BF0598DA48361C55D39A69163FA8FD24CF5F' +
  '83655D23DCA3AD961C62F356208552BB9ED529077096966D' +
  '670C354E4ABC9804F1746C08CA18217C32905E462E36CE3B' +
  'E39E772C180E86039B2783A2EC07A28FB5C55DF06F4C52C9' +
  'DE2BCBF6955817183995497CEA956AE515D2261898FA0510' +
  '15728E5A8AAAC42DAD33170D04507A33A85521ABDF1CBA64' +
  'ECFB850458DBEF0A8AEA71575D060C7DB3970F85A6E1E4C7' +
  'ABF5AE8CDB0933D71E8C94E04A25619DCEE3D2261AD2EE6B' +
  'F12FFA06D98A0864D87602733EC86A64521F2B18177B200C' +
  'BBE117577A615D6C770988C0BAD946E208E24FA074E5AB31' +
  '43DB5BFCE0FD108E4B82D120A93AD2CAFFFFFFFFFFFFFFFF';
const N = BigInt(`0x${N_HEX}`);
const G = 2n;
const INFO = Buffer.from('Caldera Derived Key', 'utf8');

const sha256Hex = (buffer) => createHash('sha256').update(buffer).digest('hex');
const hexHash = (hex) => sha256Hex(Buffer.from(hex, 'hex'));
const toHex = (value) => value.toString(16);
const fromHex = (hex) => BigInt(`0x${hex}`);

/**
 * Hex of a non-negative number (or a hex string), padded the Cognito way: an
 * even length, and a leading 00 when the first digit would read as negative.
 * @param {bigint|string} value
 */
export function padHex(value) {
  let hex = typeof value === 'string' ? value : toHex(value);
  if (hex.length % 2 === 1) {
    hex = `0${hex}`;
  } else if ('89abcdefABCDEF'.includes(hex[0])) {
    hex = `00${hex}`;
  }
  return hex;
}

function modPow(base, exponent, modulus) {
  let result = 1n;
  let b = ((base % modulus) + modulus) % modulus;
  let e = exponent;
  while (e > 0n) {
    if (e & 1n) {
      result = (result * b) % modulus;
    }
    b = (b * b) % modulus;
    e >>= 1n;
  }
  return result;
}

const K = fromHex(hexHash(`00${N_HEX}0${toHex(G)}`));

/**
 * The client half of a Cognito SRP sign-in.
 * @param {object} [options]
 * @param {bigint} [options.smallA] the secret random value (tests only)
 */
export function createSrpClient({ smallA } = {}) {
  const a = smallA ?? fromHex(randomBytes(128).toString('hex')) % N;
  const A = modPow(G, a, N);
  if (A % N === 0n) {
    throw new Error('SRP safety check failed');
  }
  return {
    /** SRP_A, for InitiateAuth. */
    srpA: toHex(A),

    /**
     * The PASSWORD_VERIFIER answer.
     * @param {object} params
     * @param {string} params.poolId e.g. `eu-west-1_AbCdEf`
     * @param {string} params.userIdForSrp USER_ID_FOR_SRP of the challenge
     * @param {string} params.password
     * @param {string} params.srpB SRP_B of the challenge (hex)
     * @param {string} params.salt SALT of the challenge (hex)
     * @param {string} params.secretBlock SECRET_BLOCK of the challenge (base64)
     * @param {Date} [params.date]
     * @returns {{ timestamp: string, signature: string }}
     */
    passwordClaim({ poolId, userIdForSrp, password, srpB, salt, secretBlock, date = new Date() }) {
      const B = fromHex(srpB);
      if (B % N === 0n) {
        throw new Error('SRP safety check failed (B)');
      }
      const u = fromHex(hexHash(padHex(A) + padHex(B)));
      if (u === 0n) {
        throw new Error('SRP safety check failed (u)');
      }
      const poolName = poolId.split('_')[1];
      const userPasswordHash = sha256Hex(Buffer.from(`${poolName}${userIdForSrp}:${password}`));
      const x = fromHex(hexHash(padHex(salt) + userPasswordHash));
      const S = modPow(B - K * modPow(G, x, N), a + u * x, N);
      const prk = createHmac('sha256', Buffer.from(padHex(u), 'hex'))
        .update(Buffer.from(padHex(S), 'hex'))
        .digest();
      const hkdf = createHmac('sha256', prk)
        .update(Buffer.concat([INFO, Buffer.from([1])]))
        .digest()
        .subarray(0, 16);
      const timestamp = cognitoTimestamp(date);
      const signature = createHmac('sha256', hkdf)
        .update(
          Buffer.concat([
            Buffer.from(poolName, 'utf8'),
            Buffer.from(userIdForSrp, 'utf8'),
            Buffer.from(secretBlock, 'base64'),
            Buffer.from(timestamp, 'utf8'),
          ]),
        )
        .digest('base64');
      return { timestamp, signature };
    },
  };
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const two = (n) => String(n).padStart(2, '0');

/** `Tue Oct 5 08:04:03 UTC 2026`: the day of the month is not padded. */
export function cognitoTimestamp(date) {
  return (
    `${DAYS[date.getUTCDay()]} ${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()} ` +
    `${two(date.getUTCHours())}:${two(date.getUTCMinutes())}:${two(date.getUTCSeconds())} ` +
    `UTC ${date.getUTCFullYear()}`
  );
}

/**
 * Cognito SECRET_HASH: base64(HMAC-SHA256(client secret, username + client id)).
 * @param {Buffer} clientSecret
 * @param {string} username
 * @param {string} clientId
 */
export function secretHash(clientSecret, username, clientId) {
  return createHmac('sha256', clientSecret).update(`${username}${clientId}`).digest('base64');
}

/**
 * The client secret 101001 returns is base64 of `<app code><secret><1 byte>`:
 * strip the app code prefix and the last byte (python-xsense, APK 1400).
 * @param {string} encoded
 * @param {string} appCode
 */
export function decodeClientSecret(encoded, appCode) {
  const raw = Buffer.from(encoded, 'base64');
  return raw.subarray(String(appCode).length, raw.length - 1);
}

// Gson-style text of a value, as the Android app builds its mac input.
function macText(value) {
  if (value === null || value === undefined) {
    return 'null';
  }
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }
  return String(value);
}

/**
 * The `mac` of an authenticated API request: MD5 of the request field values,
 * in order, followed by the client secret.
 * @param {Record<string, unknown>} fields the business fields only
 * @param {Buffer} clientSecret
 */
export function requestMac(fields, clientSecret) {
  const parts = [];
  for (const value of Object.values(fields)) {
    if (Array.isArray(value)) {
      if (value.length === 0) {
        continue;
      }
      if (typeof value[0] === 'string') {
        parts.push(...value.map(macText));
      } else {
        parts.push(JSON.stringify(value));
      }
    } else if (value !== null && typeof value === 'object') {
      parts.push(JSON.stringify(value));
    } else {
      parts.push(macText(value));
    }
  }
  return createHash('md5')
    .update(Buffer.concat([Buffer.from(parts.join(''), 'utf8'), clientSecret]))
    .digest('hex');
}

// --- AWS Signature V4 ----------------------------------------------------------

const ALGORITHM = 'AWS4-HMAC-SHA256';
const SERVICE = 'iotdata';

function amzDates(date) {
  const iso = date
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
  return { amzDate: iso, dateStamp: iso.slice(0, 8) };
}

function signingKey(secretKey, dateStamp, region) {
  const kDate = createHmac('sha256', `AWS4${secretKey}`).update(dateStamp).digest();
  const kRegion = createHmac('sha256', kDate).update(region).digest();
  const kService = createHmac('sha256', kRegion).update(SERVICE).digest();
  return createHmac('sha256', kService).update('aws4_request').digest();
}

// RFC 3986 encoding, as AWS wants it in a canonical query string.
const awsEncode = (text) =>
  encodeURIComponent(text).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );

/**
 * Sign a request to the AWS IoT device shadow endpoint.
 * @param {object} params
 * @param {string} params.method GET | POST
 * @param {string} params.url
 * @param {string} params.region
 * @param {{ accessKeyId: string, secretAccessKey: string, sessionToken: string }} params.credentials
 * @param {Record<string, string>} params.headers headers to send (and sign)
 * @param {string} [params.body]
 * @param {Date} [params.date]
 * @returns {Record<string, string>} every header to send, Authorization included
 */
export function signRequest({
  method,
  url,
  region,
  credentials,
  headers,
  body = '',
  date = new Date(),
}) {
  const parsed = new URL(url);
  const { amzDate, dateStamp } = amzDates(date);
  const all = { ...headers, host: parsed.host, 'X-Amz-Date': amzDate };
  const canonicalHeaders = Object.entries(all)
    .map(([key, value]) => [key.toLowerCase(), String(value).trim()])
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const signedHeaders = canonicalHeaders.map(([key]) => key).join(';');
  const query = [...parsed.searchParams.entries()]
    .sort(([a, av], [b, bv]) => (a === b ? (av < bv ? -1 : 1) : a < b ? -1 : 1))
    .map(([key, value]) => `${awsEncode(key)}=${awsEncode(value)}`)
    .join('&');
  const canonicalRequest = [
    method,
    parsed.pathname,
    query,
    canonicalHeaders.map(([key, value]) => `${key}:${value}`).join('\n'),
    '',
    signedHeaders,
    sha256Hex(Buffer.from(body, 'utf8')),
  ].join('\n');
  const scope = `${dateStamp}/${region}/${SERVICE}/aws4_request`;
  const stringToSign = [ALGORITHM, amzDate, scope, sha256Hex(Buffer.from(canonicalRequest))].join(
    '\n',
  );
  const signature = createHmac('sha256', signingKey(credentials.secretAccessKey, dateStamp, region))
    .update(stringToSign)
    .digest('hex');
  return {
    ...headers,
    host: parsed.host,
    'X-Amz-Date': amzDate,
    Authorization:
      `${ALGORITHM} Credential=${credentials.accessKeyId}/${scope}, ` +
      `SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}

/**
 * The presigned `wss://<server>/mqtt?...` URL of the AWS IoT broker. The
 * session token is appended after the signature, as the AWS SDKs do for IoT.
 * @param {object} params
 * @param {string} params.server MQTT host
 * @param {string} params.region
 * @param {{ accessKeyId: string, secretAccessKey: string, sessionToken: string }} params.credentials
 * @param {Date} [params.date]
 */
export function presignMqttUrl({ server, region, credentials, date = new Date() }) {
  const { amzDate, dateStamp } = amzDates(date);
  const scope = `${dateStamp}/${region}/${SERVICE}/aws4_request`;
  const query = [
    ['X-Amz-Algorithm', ALGORITHM],
    ['X-Amz-Credential', awsEncode(`${credentials.accessKeyId}/${scope}`)],
    ['X-Amz-Date', amzDate],
    ['X-Amz-SignedHeaders', 'host'],
  ]
    .map(([key, value]) => `${key}=${value}`)
    .join('&');
  const canonicalRequest = [
    'GET',
    '/mqtt',
    query,
    `host:${server}`,
    '',
    'host',
    sha256Hex(Buffer.alloc(0)),
  ].join('\n');
  const stringToSign = [ALGORITHM, amzDate, scope, sha256Hex(Buffer.from(canonicalRequest))].join(
    '\n',
  );
  const signature = createHmac('sha256', signingKey(credentials.secretAccessKey, dateStamp, region))
    .update(stringToSign)
    .digest('hex');
  return (
    `wss://${server}/mqtt?${query}` +
    `&X-Amz-Security-Token=${awsEncode(credentials.sessionToken)}` +
    `&X-Amz-Signature=${signature}`
  );
}
