// -----------------------------------------------------------------------------
// The X-Sense cloud client: read only.
//
// The X-Sense app talks to three services, all of them in AWS:
//   1. the X-Sense API (`https://api.x-sense-iot.com/app`, POST, one `bizCode`
//      per operation, every request signed with an MD5 `mac`);
//   2. AWS Cognito, where the app signs in with SRP (the password never travels);
//   3. AWS IoT, where each base station and Wi-Fi detector keeps "device
//      shadows" (its last reported state), read over HTTPS with SigV4 and
//      pushed live over MQTT (src/xsense/mqtt.js).
//
// The protocol was reverse-engineered by python-xsense (theosnel) and the Home
// Assistant integration of Jarnsen (APK 1400 audit); this is a reading of
// their work in JavaScript, limited to what Gladys needs: sign in, list the
// homes, stations and detectors, read the shadows. Nothing here writes to the
// cloud: no command is ever sent to a detector.
//
// The Cognito tokens are kept in /data (src/store.js) to avoid a full sign-in
// at every restart; the password stays in the Gladys configuration. Neither
// ever reaches a log line or an error message.
// -----------------------------------------------------------------------------

import {
  createSrpClient,
  decodeClientSecret,
  requestMac,
  secretHash,
  signRequest,
} from './crypto.js';

/** Identity of the Android app the API expects (APK v1.40.0, code 1400). */
export const APP = {
  api: 'https://api.x-sense-iot.com/app',
  version: 'v1.40.0_20260612',
  code: '1400',
  clientType: '2',
};

// The user agent of the AWS SDK the app embeds, sent with the shadow reads.
const SHADOW_USER_AGENT = 'aws-sdk-iOS/2.26.5 iOS/17.3 nl_NL';

// The app's password field is capped at 50 characters, and Cognito received
// what the app sent: same normalization, or a long password never matches.
const PASSWORD_MAX_LENGTH = 50;

// Refresh a token one minute before it expires.
const EXPIRY_MARGIN_MS = 60 * 1000;

// API error codes meaning "sign in again".
const SESSION_EXPIRED_CODES = new Set(['10000008', '10000020']);

// Cognito errors that mean the e-mail or the password is wrong: anything else
// (throttling, network) is temporary and must not ask the user to retype.
const CREDENTIAL_ERRORS = new Set([
  'NotAuthorizedException',
  'UserNotFoundException',
  'UserNotConfirmedException',
  'PasswordResetRequiredException',
]);

/**
 * kind: 'auth' (wrong e-mail or password), 'network' (unreachable), 'api'
 * (the service answered with an error).
 */
export class XSenseError extends Error {
  constructor(kind, message, { code } = {}) {
    super(message);
    this.name = 'XSenseError';
    this.kind = kind;
    this.code = code;
  }
}

/**
 * @param {object} options
 * @param {typeof fetch} [options.fetch]
 * @param {{ get: Function, set: Function }} [options.store] persisted session (src/store.js)
 * @param {() => number} [options.now]
 * @param {number} [options.timeoutMs]
 */
export function createXSenseClient({
  fetch: fetchImpl = globalThis.fetch,
  store,
  now = () => Date.now(),
  timeoutMs = 20000,
} = {}) {
  let email = '';
  let password = '';
  let app = null; // { clientId, clientSecret, region, userPoolId }
  let session = null; // { email, userId, accessToken, idToken, refreshToken, expiresAt }
  let aws = null; // { accessKeyId, secretAccessKey, sessionToken, expiresAt }
  let forgetSaved = false; // the saved session belongs to the previous credentials

  async function request(url, init) {
    let response;
    try {
      response = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    } catch (err) {
      const host = new URL(url).host;
      throw new XSenseError('network', `${host} unreachable (${err.cause?.code ?? err.name})`);
    }
    const text = await response.text();
    let body;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }
    return { status: response.status, body, headers: response.headers };
  }

  /** One X-Sense API call; authenticated unless `unauth`. */
  async function api(bizCode, fields = {}, { unauth = false, retried = false } = {}) {
    if (!unauth) {
      await ensureSession();
    }
    const payload = {
      ...fields,
      clientType: APP.clientType,
      mac: unauth ? 'abcdefg' : requestMac(fields, app.clientSecret),
      appVersion: APP.version,
      bizCode,
      appCode: APP.code,
    };
    const headers = { 'Content-Type': 'application/json' };
    if (!unauth) {
      headers.Authorization = session.accessToken;
    }
    const { status, body } = await request(APP.api, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });
    if (status >= 400 || !body || typeof body !== 'object') {
      throw new XSenseError('api', `X-Sense API ${bizCode}: HTTP ${status}`);
    }
    if (body.reCode !== 200) {
      const errCode = String(body.errCode ?? '');
      if (!unauth && !retried && SESSION_EXPIRED_CODES.has(errCode)) {
        // The access token was refused: sign in again, once.
        session = null;
        await store?.set('session', null);
        return api(bizCode, fields, { retried: true });
      }
      throw new XSenseError('api', `X-Sense API ${bizCode}: error ${errCode || body.reCode}`, {
        code: errCode,
      });
    }
    return body.reData;
  }

  /** 101001: the Cognito user pool and app client of the app, unauthenticated. */
  async function loadAppInfo() {
    if (app) {
      return app;
    }
    const data = await api('101001', {}, { unauth: true });
    if (!data?.clientId || !data?.clientSecret || !data?.cgtRegion || !data?.userPoolId) {
      throw new XSenseError('api', 'X-Sense API 101001: incomplete answer');
    }
    app = {
      clientId: data.clientId,
      clientSecret: decodeClientSecret(data.clientSecret, APP.code),
      region: data.cgtRegion,
      userPoolId: data.userPoolId,
    };
    return app;
  }

  async function cognito(target, body) {
    const { status, body: answer } = await request(
      `https://cognito-idp.${app.region}.amazonaws.com/`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-amz-json-1.1',
          'X-Amz-Target': `AWSCognitoIdentityProviderService.${target}`,
        },
        body: JSON.stringify(body),
      },
    );
    if (status >= 400) {
      // `__type` is the error class, e.g. "NotAuthorizedException" (sometimes
      // prefixed with a namespace and '#'). The message may quote the user
      // name: it is never logged.
      const type =
        String(answer?.__type ?? '')
          .split('#')
          .pop() || `HTTP ${status}`;
      if (CREDENTIAL_ERRORS.has(type)) {
        throw new XSenseError('auth', `sign-in refused (${type})`, { code: type });
      }
      throw new XSenseError('api', `Cognito ${target} failed (${type})`, { code: type });
    }
    return answer;
  }

  function keepTokens(result, userId) {
    session = {
      email,
      userId: userId ?? session?.userId,
      accessToken: result.AccessToken,
      idToken: result.IdToken ?? session?.idToken,
      refreshToken: result.RefreshToken ?? session?.refreshToken,
      expiresAt: now() + Number(result.ExpiresIn ?? 3600) * 1000,
    };
  }

  /** Full SRP sign-in with the e-mail and the password. */
  async function signIn() {
    await loadAppInfo();
    const srp = createSrpClient();
    const initiate = await cognito('InitiateAuth', {
      AuthFlow: 'USER_SRP_AUTH',
      ClientId: app.clientId,
      AuthParameters: {
        USERNAME: email,
        SRP_A: srp.srpA,
        SECRET_HASH: secretHash(app.clientSecret, email, app.clientId),
      },
    });
    const challenge = initiate?.ChallengeParameters;
    if (initiate?.ChallengeName !== 'PASSWORD_VERIFIER' || !challenge) {
      throw new XSenseError('api', `unexpected sign-in challenge (${initiate?.ChallengeName})`);
    }
    const userId = challenge.USERNAME ?? challenge.USER_ID_FOR_SRP;
    const claim = srp.passwordClaim({
      poolId: app.userPoolId,
      userIdForSrp: challenge.USER_ID_FOR_SRP,
      password: password.trim().slice(0, PASSWORD_MAX_LENGTH),
      srpB: challenge.SRP_B,
      salt: challenge.SALT,
      secretBlock: challenge.SECRET_BLOCK,
      date: new Date(now()),
    });
    const answer = await cognito('RespondToAuthChallenge', {
      ClientId: app.clientId,
      ChallengeName: 'PASSWORD_VERIFIER',
      ChallengeResponses: {
        USERNAME: userId,
        TIMESTAMP: claim.timestamp,
        PASSWORD_CLAIM_SECRET_BLOCK: challenge.SECRET_BLOCK,
        PASSWORD_CLAIM_SIGNATURE: claim.signature,
        SECRET_HASH: secretHash(app.clientSecret, userId, app.clientId),
      },
    });
    if (!answer?.AuthenticationResult?.AccessToken) {
      // MFA or a new password required: the app would ask the user, not us.
      throw new XSenseError('auth', `sign-in needs ${answer?.ChallengeName ?? 'another step'}`);
    }
    keepTokens(answer.AuthenticationResult, userId);
    aws = null;
    await store?.set('session', session);
  }

  /** Refresh the access token; false when the refresh token is refused. */
  async function refreshTokens() {
    await loadAppInfo();
    try {
      const answer = await cognito('InitiateAuth', {
        AuthFlow: 'REFRESH_TOKEN_AUTH',
        ClientId: app.clientId,
        AuthParameters: {
          REFRESH_TOKEN: session.refreshToken,
          // What the app (and python-xsense) sends on a refresh.
          SECRET_HASH: app.clientSecret.toString('utf8'),
        },
      });
      if (!answer?.AuthenticationResult?.AccessToken) {
        return false;
      }
      keepTokens(answer.AuthenticationResult);
      await store?.set('session', session);
      return true;
    } catch (err) {
      if (err.kind === 'network') {
        throw err;
      }
      return false;
    }
  }

  async function ensureSession() {
    if (!email || !password) {
      throw new XSenseError('auth', 'e-mail or password missing');
    }
    await loadAppInfo();
    if (forgetSaved) {
      forgetSaved = false;
      await store?.set('session', null);
    }
    if (!session) {
      const saved = await store?.get('session');
      if (saved?.email === email && saved.refreshToken) {
        session = saved;
      }
    }
    if (session && session.expiresAt - EXPIRY_MARGIN_MS > now()) {
      return;
    }
    if (session?.refreshToken && (await refreshTokens())) {
      return;
    }
    await signIn();
  }

  /** 101003: temporary AWS credentials for the IoT shadows and MQTT. */
  async function awsCredentials({ force = false } = {}) {
    if (!force && aws && aws.expiresAt - EXPIRY_MARGIN_MS > now()) {
      return aws;
    }
    const data = await api('101003', { userName: email });
    if (!data?.accessKeyId || !data?.secretAccessKey || !data?.sessionToken) {
      throw new XSenseError('api', 'X-Sense API 101003: incomplete answer');
    }
    aws = {
      accessKeyId: data.accessKeyId,
      secretAccessKey: data.secretAccessKey,
      sessionToken: data.sessionToken,
      expiresAt: parseExpiration(data.expiration) ?? now() + 30 * 60 * 1000,
    };
    return aws;
  }

  /**
   * Reported state of one named shadow of a thing, null when it does not exist.
   * @param {object} params
   * @param {string} params.region the house mqttRegion
   * @param {string} params.thing AWS IoT thing name
   * @param {string} params.name shadow name
   */
  async function getShadow({ region, thing, name }, retried = false) {
    const credentials = await awsCredentials({ force: retried });
    const url =
      `https://${region}.x-sense-iot.com/things/${encodeURIComponent(thing)}` +
      `/shadow?name=${encodeURIComponent(name)}`;
    const headers = signRequest({
      method: 'GET',
      url,
      region,
      credentials,
      headers: {
        'Content-Type': 'application/x-amz-json-1.0',
        'User-Agent': SHADOW_USER_AGENT,
        'X-Amz-Security-Token': credentials.sessionToken,
      },
      date: new Date(now()),
    });
    delete headers.host; // set by fetch itself
    const { status, body } = await request(url, { method: 'GET', headers });
    if (status === 404) {
      return null;
    }
    if ((status === 401 || status === 403) && !retried) {
      // Expired or revoked credentials (or a host clock off by minutes): fetch
      // fresh ones once.
      return getShadow({ region, thing, name }, true);
    }
    if (status >= 400) {
      throw new XSenseError('api', `shadow ${name}: HTTP ${status}`);
    }
    return body?.state?.reported ?? null;
  }

  return {
    /**
     * Set the account. New credentials while running (the user edited the
     * configuration) also forget the saved session: the next connection
     * signs in, so a wrong new password is reported instead of hidden by the
     * old session.
     */
    setCredentials(newEmail, newPassword) {
      const nextEmail = String(newEmail ?? '').trim();
      const nextPassword = String(newPassword ?? '');
      if (nextEmail === email && nextPassword === password) {
        return;
      }
      const edited = email !== '' || password !== '';
      email = nextEmail;
      password = nextPassword;
      session = null;
      aws = null;
      if (edited) {
        forgetSaved = true;
      }
    },

    /** Sign in (or restore the saved session) and check the account answers. */
    async connect() {
      await ensureSession();
      await awsCredentials();
    },

    /** Homes, rooms and stations (with their detectors) of the account. */
    async loadAccount() {
      const houses = (await api('102007', { utctimestamp: '0' })) ?? [];
      const result = [];
      for (const house of Array.isArray(houses) ? houses : []) {
        const rooms = await api('102008', { houseId: house.houseId, utctimestamp: '0' });
        const stations = await api('103007', { houseId: house.houseId, utctimestamp: '0' });
        result.push({ house, rooms, stations });
      }
      return result;
    },

    getShadow,
    awsCredentials,

    /** The user id of the session (MQTT topics, nothing else). */
    get userId() {
      return session?.userId;
    },

    /** Forget the persisted session (the account changed). */
    async forgetSession() {
      session = null;
      aws = null;
      await store?.set('session', null);
    },
  };
}

/**
 * "2026-10-15 10:20:30+0000" (or ISO) → epoch milliseconds, null if unreadable.
 * @param {unknown} value
 */
export function parseExpiration(value) {
  if (typeof value !== 'string' || value === '') {
    return null;
  }
  const iso = value
    .trim()
    .replace(' ', 'T')
    .replace(/([+-]\d{2})(\d{2})$/, '$1:$2');
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}
