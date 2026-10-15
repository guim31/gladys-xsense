// -----------------------------------------------------------------------------
// A simulated X-Sense cloud behind a `fetch` function: the X-Sense API, AWS
// Cognito (with a real SRP server side: a wrong password is refused, a right
// one accepted), and the AWS IoT shadows.
//
// The account is made up but shaped like the payloads the reference libraries
// parse (python-xsense, the Home Assistant integration's APK 1400 notes): one
// SBS50 base station with RF detectors of every family, a thermo-hygrometer
// and a camera this integration ignores, and two Wi-Fi detectors. Serial
// numbers and addresses are invented (192.0.2.x, RFC 5737).
// -----------------------------------------------------------------------------

import { createHash, createHmac, randomBytes } from 'node:crypto';
import { padHex, requestMac, secretHash } from '../../src/xsense/crypto.js';

export const EMAIL = 'someone@example.com';
export const PASSWORD = 'correct horse battery';
export const CLIENT_ID = 'fakeclientid0123456789';
const CLIENT_SECRET = 'FakeClientSecretValue';
const POOL_ID = 'eu-west-1_FakePool';
const REGION = 'eu-west-1';
const USER_ID = 'a1b2c3d4-0000-4000-8000-000000000001';

export const HOUSE_ID = 'HOUSE0000000000000000000000000001';
export const SBS50 = 'SBS50SN0001';
export const SERIALS = {
  smoke: 'XS01M000001',
  co: 'XC01M000002',
  combi: 'XP0AMR00003',
  heat: 'XH02M000004',
  water: 'SWS51000005',
  thermo: 'STH51000006',
  wifiSmoke: 'XS01WX00007',
  wifiCo: 'XC04WX00008',
};

/** The account as 102007 / 102008 / 103007 answer it. */
export function accountFixture() {
  return {
    houses: [
      {
        houseId: HOUSE_ID,
        houseName: 'Maison',
        houseRegion: 'EU',
        mqttRegion: 'eu-central-1',
        mqttServer: 'fake-ats.iot.eu-central-1.amazonaws.com',
        createTime: '20240101120000',
        loraBand: 'EU868',
      },
    ],
    rooms: {
      houseRooms: [
        { roomId: 'R1', roomName: 'Cuisine' },
        { roomId: 'R2', roomName: 'Salon' },
        { roomId: 'R3', roomName: 'Entrée' },
        { roomId: 'R4', roomName: 'Garage' },
        { roomId: 'R5', roomName: 'Buanderie' },
        { roomId: 'R6', roomName: 'Chambre' },
      ],
      roomSort: ['R1', 'R2', 'R3', 'R4', 'R5', 'R6'],
    },
    stations: {
      stationSort: ['ST1', 'ST2', 'ST3', 'ST4'],
      stations: [
        {
          stationId: 'ST1',
          stationName: 'Station de base',
          stationSn: SBS50,
          category: 'SBS50',
          onLine: '1',
          roomId: 'R3',
          safeMode: '0',
          deviceSort: ['D1', 'D2', 'D3', 'D4', 'D5', 'D6'],
          devices: [
            {
              deviceId: 'D1',
              deviceName: 'Fumée cuisine',
              deviceSn: SERIALS.smoke,
              deviceType: 'XS01-M',
              roomId: 'R1',
            },
            {
              deviceId: 'D2',
              deviceName: 'CO salon',
              deviceSn: SERIALS.co,
              deviceType: 'XC01-M',
              roomId: 'R2',
            },
            {
              deviceId: 'D3',
              deviceName: 'Combiné entrée',
              deviceSn: SERIALS.combi,
              deviceType: 'XP0A-MR',
              roomId: 'R3',
            },
            {
              deviceId: 'D4',
              deviceName: 'Chaleur garage',
              deviceSn: SERIALS.heat,
              deviceType: 'XH02-M',
              roomId: 'R4',
            },
            {
              deviceId: 'D5',
              deviceName: 'Fuite buanderie',
              deviceSn: SERIALS.water,
              deviceType: 'SWS51',
              roomId: 'R5',
            },
            {
              deviceId: 'D6',
              deviceName: 'Thermomètre',
              deviceSn: SERIALS.thermo,
              deviceType: 'STH51',
              roomId: 'R6',
            },
          ],
        },
        {
          stationId: 'ST2',
          stationName: 'Fumée chambre',
          stationSn: SERIALS.wifiSmoke,
          category: 'XS01-WX',
          onLine: '1',
          roomId: 'R6',
          devices: [],
        },
        {
          stationId: 'ST3',
          stationName: 'CO chaudière',
          stationSn: SERIALS.wifiCo,
          category: 'XC04-WX',
          roomId: 'R5',
          devices: [],
        },
        {
          stationId: 'ST4',
          stationName: 'Caméra',
          stationSn: 'SSC0A000009',
          category: 'SSC0A',
          devices: [],
        },
      ],
    },
  };
}

/** The reported shadows, by `<thing>/<shadow name>`. */
export function shadowsFixture() {
  return {
    [`SBS50${SBS50}/2nd_mainpage`]: {
      stationSN: SBS50,
      activate: '0',
      devs: {
        [SERIALS.smoke]: {
          type: 'XS01-M',
          batInfo: '3',
          rfLevel: '3',
          online: '1',
          alarmStatus: '0',
          muteStatus: '1',
          time: '20261015080000',
        },
        [SERIALS.co]: {
          type: 'XC01-M',
          batInfo: '2',
          rfLevel: '2',
          online: '1',
          alarmStatus: '0',
          coPpm: '0',
          coLevel: '0',
        },
        [SERIALS.combi]: {
          type: 'XP0A-MR',
          batInfo: '3',
          rfLevel: '3',
          online: '1',
          alarmStatus: '0',
          coPpm: '0',
          isLifeEnd: '0',
        },
        [SERIALS.heat]: {
          type: 'XH02-M',
          batInfo: '3',
          rfLevel: '1',
          online: '1',
          alarmStatus: '0',
        },
        [SERIALS.water]: {
          type: 'SWS51',
          batInfo: '3',
          rfLevel: '2',
          online: '1',
          alarmStatus: '0',
          muteStatus: '0',
        },
        [SERIALS.thermo]: { type: 'STH51', batInfo: '3', b: '21.5', c: '48.0' },
      },
    },
    [`SBS50${SBS50}/2nd_info_${SBS50}`]: {
      wifiRSSI: '-58',
      sw: 'v1.6.4',
      ip: '192.0.2.20',
      ssid: 'home-network',
      onLine: '1',
    },
    [`${HOUSE_ID}/2nd_mainpage`]: {
      [SERIALS.wifiSmoke]: { batInfo: '3', alarmStatus: '0', online: '1', wifiRssi: '-63' },
      [SERIALS.wifiCo]: { batInfo: '1', alarmStatus: '0', coPpm: '0', online: '1' },
    },
    [`XC04-WX-${SERIALS.wifiCo}/2nd_info_${SERIALS.wifiCo}`]: { wifiRSSI: '-71' },
  };
}

// --- SRP server side (RFC 5054 group of Cognito) ----------------------------------

const N = BigInt(
  '0x' +
    'FFFFFFFFFFFFFFFFC90FDAA22168C234C4C6628B80DC1CD129024E088A67CC74020BBEA63B139B22514A08798E3404DD' +
    'EF9519B3CD3A431B302B0A6DF25F14374FE1356D6D51C245E485B576625E7EC6F44C42E9A637ED6B0BFF5CB6F406B7ED' +
    'EE386BFB5A899FA5AE9F24117C4B1FE649286651ECE45B3DC2007CB8A163BF0598DA48361C55D39A69163FA8FD24CF5F' +
    '83655D23DCA3AD961C62F356208552BB9ED529077096966D670C354E4ABC9804F1746C08CA18217C32905E462E36CE3B' +
    'E39E772C180E86039B2783A2EC07A28FB5C55DF06F4C52C9DE2BCBF6955817183995497CEA956AE515D2261898FA0510' +
    '15728E5A8AAAC42DAD33170D04507A33A85521ABDF1CBA64ECFB850458DBEF0A8AEA71575D060C7DB3970F85A6E1E4C7' +
    'ABF5AE8CDB0933D71E8C94E04A25619DCEE3D2261AD2EE6BF12FFA06D98A0864D87602733EC86A64521F2B18177B200C' +
    'BBE117577A615D6C770988C0BAD946E208E24FA074E5AB3143DB5BFCE0FD108E4B82D120A93AD2CAFFFFFFFFFFFFFFFF',
);
const G = 2n;
const sha = (b) => createHash('sha256').update(b).digest('hex');
const hexHash = (hex) => sha(Buffer.from(hex, 'hex'));
const K = BigInt(`0x${hexHash(padHex(N) + padHex(G))}`);
const modPow = (base, exp, mod) => {
  let r = 1n;
  let b = ((base % mod) + mod) % mod;
  let e = exp;
  while (e > 0n) {
    if (e & 1n) r = (r * b) % mod;
    b = (b * b) % mod;
    e >>= 1n;
  }
  return r;
};

function srpVerifier(password, salt) {
  const inner = sha(Buffer.from(`${POOL_ID.split('_')[1]}${USER_ID}:${password}`));
  const x = BigInt(`0x${hexHash(padHex(salt) + inner)}`);
  return modPow(G, x, N);
}

/**
 * @param {object} [options]
 * @param {object} [options.account] accountFixture() by default
 * @param {object} [options.shadows] shadowsFixture() by default
 * @param {string} [options.password] the right password
 */
export function createFakeXSense({
  account = accountFixture(),
  shadows = shadowsFixture(),
  password = PASSWORD,
} = {}) {
  const salt = randomBytes(16).toString('hex');
  let pending = null; // { A, b, B, secretBlock }
  let tokenCounter = 0;
  const validTokens = new Set();
  const refreshTokens = new Set();
  const awsKeys = new Set();
  const calls = [];
  let down = false;
  let refuseRefresh = false;
  const secret = Buffer.from(CLIENT_SECRET);

  const json = (status, body) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  function issueTokens() {
    tokenCounter += 1;
    const access = `access-token-${tokenCounter}`;
    const refresh = `refresh-token-${tokenCounter}`;
    validTokens.add(access);
    refreshTokens.add(refresh);
    return {
      AccessToken: access,
      IdToken: `id-token-${tokenCounter}`,
      RefreshToken: refresh,
      ExpiresIn: 3600,
    };
  }

  function cognito(target, body) {
    if (body.ClientId !== CLIENT_ID) {
      return json(400, { __type: 'ResourceNotFoundException', message: 'bad client' });
    }
    if (target === 'InitiateAuth' && body.AuthFlow === 'USER_SRP_AUTH') {
      const params = body.AuthParameters;
      if (params.SECRET_HASH !== secretHash(secret, params.USERNAME, CLIENT_ID)) {
        return json(400, { __type: 'NotAuthorizedException', message: 'secret hash' });
      }
      if (params.USERNAME !== EMAIL) {
        return json(400, { __type: 'UserNotFoundException', message: 'User does not exist.' });
      }
      const A = BigInt(`0x${params.SRP_A}`);
      const b = BigInt(`0x${randomBytes(64).toString('hex')}`);
      const v = srpVerifier(password, salt);
      const B = (K * v + modPow(G, b, N)) % N;
      const secretBlock = randomBytes(32).toString('base64');
      pending = { A, b, B, v, secretBlock };
      return json(200, {
        ChallengeName: 'PASSWORD_VERIFIER',
        ChallengeParameters: {
          SALT: salt,
          SRP_B: B.toString(16),
          SECRET_BLOCK: secretBlock,
          USER_ID_FOR_SRP: USER_ID,
          USERNAME: USER_ID,
        },
      });
    }
    if (target === 'RespondToAuthChallenge') {
      const r = body.ChallengeResponses;
      if (
        !pending ||
        r.USERNAME !== USER_ID ||
        r.SECRET_HASH !== secretHash(secret, USER_ID, CLIENT_ID)
      ) {
        return json(400, {
          __type: 'NotAuthorizedException',
          message: 'Incorrect username or password.',
        });
      }
      const { A, b, B, v, secretBlock } = pending;
      pending = null;
      const u = BigInt(`0x${hexHash(padHex(A) + padHex(B))}`);
      const S = modPow(A * modPow(v, u, N), b, N);
      const prk = createHmac('sha256', Buffer.from(padHex(u), 'hex'))
        .update(Buffer.from(padHex(S), 'hex'))
        .digest();
      const key = createHmac('sha256', prk)
        .update(Buffer.concat([Buffer.from('Caldera Derived Key'), Buffer.from([1])]))
        .digest()
        .subarray(0, 16);
      const expected = createHmac('sha256', key)
        .update(
          Buffer.concat([
            Buffer.from(POOL_ID.split('_')[1]),
            Buffer.from(USER_ID),
            Buffer.from(secretBlock, 'base64'),
            Buffer.from(r.TIMESTAMP),
          ]),
        )
        .digest('base64');
      if (
        r.PASSWORD_CLAIM_SIGNATURE !== expected ||
        r.PASSWORD_CLAIM_SECRET_BLOCK !== secretBlock
      ) {
        return json(400, {
          __type: 'NotAuthorizedException',
          message: 'Incorrect username or password.',
        });
      }
      return json(200, { AuthenticationResult: issueTokens() });
    }
    if (target === 'InitiateAuth' && body.AuthFlow === 'REFRESH_TOKEN_AUTH') {
      if (refuseRefresh || !refreshTokens.has(body.AuthParameters.REFRESH_TOKEN)) {
        return json(400, { __type: 'NotAuthorizedException', message: 'Invalid Refresh Token' });
      }
      const { AccessToken, IdToken, ExpiresIn } = issueTokens();
      return json(200, { AuthenticationResult: { AccessToken, IdToken, ExpiresIn } });
    }
    return json(400, { __type: 'InvalidParameterException' });
  }

  function api(body, headers) {
    const { bizCode, mac, clientType, appVersion, appCode, ...fields } = body;
    if (!clientType || !appVersion || !appCode) {
      return json(200, { reCode: 400, errCode: 'bad-app' });
    }
    if (bizCode === '101001') {
      return json(200, {
        reCode: 200,
        reData: {
          clientId: CLIENT_ID,
          clientSecret: Buffer.concat([Buffer.from('1400'), secret, Buffer.from([0])]).toString(
            'base64',
          ),
          cgtRegion: REGION,
          userPoolId: POOL_ID,
        },
      });
    }
    if (!validTokens.has(headers.get('authorization'))) {
      return json(200, { reCode: 400, errCode: '10000008', reMsg: 'token expired' });
    }
    if (mac !== requestMac(fields, secret)) {
      return json(200, { reCode: 400, errCode: '10000001', reMsg: 'mac error' });
    }
    switch (bizCode) {
      case '101003': {
        const key = `ASIAFAKE${awsKeys.size + 1}`;
        awsKeys.add(key);
        return json(200, {
          reCode: 200,
          reData: {
            accessKeyId: key,
            secretAccessKey: 'fake/secret+key',
            sessionToken: 'fake-session-token',
            expiration: '2099-01-01 00:00:00+0000',
          },
        });
      }
      case '102007':
        return json(200, { reCode: 200, reData: account.houses });
      case '102008':
        return json(200, { reCode: 200, reData: account.rooms });
      case '103007':
        return json(200, { reCode: 200, reData: account.stations });
      default:
        return json(200, { reCode: 400, errCode: 'unknown' });
    }
  }

  function shadow(url, headers) {
    const auth = headers.get('authorization') ?? '';
    const key = auth.match(/Credential=([^/]+)\//)?.[1];
    if (!awsKeys.has(key) || headers.get('x-amz-security-token') !== 'fake-session-token') {
      return json(403, { message: 'Forbidden' });
    }
    const thing = decodeURIComponent(url.pathname.split('/')[2]);
    const name = url.searchParams.get('name');
    const reported = shadows[`${thing}/${name}`];
    if (!reported) {
      return json(404, { code: 404, message: `No shadow exists with name: '${name}'` });
    }
    return json(200, { state: { reported }, metadata: {}, version: 12, timestamp: 1760515200 });
  }

  async function fetchImpl(input, init = {}) {
    const url = new URL(input);
    const headers = new Headers(init.headers);
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({
      host: url.host,
      path: url.pathname + url.search,
      bizCode: body?.bizCode,
      target: headers.get('x-amz-target'),
    });
    if (down) {
      throw new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } });
    }
    if (url.host === 'api.x-sense-iot.com') {
      return api(body, headers);
    }
    if (url.host === `cognito-idp.${REGION}.amazonaws.com`) {
      return cognito(headers.get('x-amz-target').split('.')[1], body);
    }
    if (url.host.endsWith('.x-sense-iot.com')) {
      return shadow(url, headers);
    }
    throw new TypeError('fetch failed', { cause: { code: 'ENOTFOUND' } });
  }

  return {
    fetch: fetchImpl,
    account,
    shadows,
    calls,
    /** Every request fails like a network outage. */
    setDown(value) {
      down = value;
    },
    /** Invalidate every access token (the API answers "session expired"). */
    expireTokens() {
      validTokens.clear();
    },
    refuseRefresh(value = true) {
      refuseRefresh = value;
    },
    /** Revoke the AWS credentials (shadows answer 403 until new ones). */
    revokeAws() {
      awsKeys.clear();
    },
    signIns: () => calls.filter((c) => c.target?.endsWith('RespondToAuthChallenge')).length,
  };
}
