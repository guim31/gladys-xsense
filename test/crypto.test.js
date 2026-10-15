// -----------------------------------------------------------------------------
// The cryptography of src/xsense/crypto.js against values computed by the
// Python references run locally: pycognito (Cognito SRP, used by
// python-xsense), the AWS SigV4 signer of python-xsense, and the request mac /
// client secret helpers of the Home Assistant integration's vendored library.
// Any drift breaks the sign-in or every shadow read, without hardware to see it.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cognitoTimestamp,
  createSrpClient,
  decodeClientSecret,
  padHex,
  presignMqttUrl,
  requestMac,
  secretHash,
  signRequest,
} from '../src/xsense/crypto.js';

// Computed by pycognito 2024.x (AWSSRP with a pinned small a).
const SRP = {
  smallA: '1234567890abcdef'.repeat(16),
  srpA:
    '87ef46e6f23037298b68c9527f88af1cf90151a2246908b3a011df7c24e0a982d7b9294aa7a6ea4c1d23f6d327a0e890' +
    'bf350612fe5e9e9ca2f5274217124f89f08c325dfa1ea7c176ff3845adf0bd3505bc955b2ddab697c3d7f1412ab47b14' +
    'b20b9979de107fd8d4d60c6a958170fef3665fee5b1e3944290bd2c7e97174bd4f3c7ec8a69a5b90fde2d3bfee2535ef' +
    'a64e34d96156528ed87cb62440054d0150cb5425dade3372615c79c7181acd25f1061da667a5694941fd5101d6210af6' +
    '3b9fac8fea9b0e957817842df2a2e77280d3c48e3e3387adf138ea78379ea7cfe3fc2214ffe06af24a216680aebc78c4' +
    '7bf995c7cd3b2c7a1d2b5081a0d4369409e45f5433e65fb805f57e76d5eea7de2adefa7ddb0e20a9d5f7f86e43a6ce5a' +
    'd5158e00c6073076c73749d8dadff58dc7060b982f2971357789b8228d42b184da440dad64ae8b9f97003e8cd3100fb8' +
    '07fba0f32402a365ecae4330fe5ca87da96f3422aa04a88be63b0efb796046f641e54e0551cf7d2d8f9b973ef4cc29df',
  srpB:
    'eb09cbb130531cf5fc53bb620fc4d4662d3c52669c8f7ea731a39f73497184eb860d6042daff9cb6acae70290ffacb08' +
    '4fa0078e00c3834201768ee08ca8f233050500fcdd9b564e7c2ae171d40b1f13fd8f06ed0ac5bc595ceef5851324dec3' +
    '5adaac1d9b4ababde1c966436f23a6e3da40b54183f2cec28ce57707545a832527f753890c3eb530c3cc9b26098d98c3' +
    'ad5059a5a9fec41d2ff2bdfcdae2a0762dd33433861536f72e3f4b795c0b3fd643e38979f83084f60e64d200040b1cb5' +
    'cdee978f0c3931aa776ab880b945edc5b92ddfe65b02fca55e832b7fd9237fe15194273a5ad5dc83612be92ffff6b4b4' +
    'd4ef4f1c0c42dfdf0b389b6b36531e50c67968e043f30ce6103c0a276de55d871d2f3f0d0bf5c506e2986ff0c0ee43a7' +
    'c9141b986d6391aa544fdffa8e4e72d70ef00c0121f2fe28bdd8883d42ee2ad9c2f057900d0c44b3fa76a6fe1ea8cd18' +
    'acaef15f37161f98c0dcebbf43cbb061d653caeef3615655a33c40df7f4dedabf4d94a60061fef0960da4ca2ba1450a9',
  salt: 'a1b2c3d4e5f60718293a4b5c6d7e8f90',
  secretBlock: 'c2VjcmV0LWJsb2NrLWJ5dGVzLTAxMjM0NTY3ODk=',
  timestamp: 'Tue Oct 6 08:04:03 UTC 2026',
  signature: 'Y6UycGYIUr+Ik/m606EMO3w9puxmw0N10hoQxy5vNo0=',
};

test('the SRP public value and password claim match pycognito', () => {
  const srp = createSrpClient({ smallA: BigInt(`0x${SRP.smallA}`) });
  assert.equal(srp.srpA, SRP.srpA);
  const claim = srp.passwordClaim({
    poolId: 'eu-west-1_TestPool',
    userIdForSrp: 'user-id-for-srp',
    password: 'Pa55word!',
    srpB: SRP.srpB,
    salt: SRP.salt,
    secretBlock: SRP.secretBlock,
    date: new Date(Date.UTC(2026, 9, 6, 8, 4, 3)),
  });
  assert.equal(claim.timestamp, SRP.timestamp);
  assert.equal(claim.signature, SRP.signature);
});

test('a fresh SRP client draws a new secret each time', () => {
  assert.notEqual(createSrpClient().srpA, createSrpClient().srpA);
});

test('the SRP client refuses a server value of zero', () => {
  const srp = createSrpClient();
  assert.throws(() =>
    srp.passwordClaim({
      poolId: 'x_y',
      userIdForSrp: 'u',
      password: 'p',
      srpB: '0',
      salt: '01',
      secretBlock: '',
    }),
  );
});

test('the Cognito timestamp does not pad the day of the month', () => {
  assert.equal(
    cognitoTimestamp(new Date(Date.UTC(2026, 0, 4, 1, 2, 3))),
    'Sun Jan 4 01:02:03 UTC 2026',
  );
  assert.equal(
    cognitoTimestamp(new Date(Date.UTC(2026, 11, 25, 23, 59, 9))),
    'Fri Dec 25 23:59:09 UTC 2026',
  );
});

test('padHex adds a byte when the number would read as negative', () => {
  assert.equal(padHex(0xabn), '00ab');
  assert.equal(padHex(0x7fn), '7f');
  assert.equal(padHex(0xfffn), '0fff');
  assert.equal(padHex('a1'), '00a1');
});

// Computed by the Home Assistant integration's vendored library (base.py).
test('client secret, request mac and secret hash match the reference library', () => {
  const secret = decodeClientSecret('MTQwME15Q2xpZW50U2VjcmV0VmFsdWUA', '1400');
  assert.equal(secret.toString(), 'MyClientSecretValue');
  assert.equal(
    requestMac({ userName: 'user@example.com' }, secret),
    'f1353394a534642a8b982bdf5605f1f8',
  );
  assert.equal(
    requestMac({ houseId: 'H1', utctimestamp: '0' }, secret),
    'ccd0bbd40830ef0f4c0c0400eb2add44',
  );
  assert.equal(
    requestMac({ a: true, b: null, c: ['x', 'y'], d: [], e: { k: 1, l: 'é' }, f: 12 }, secret),
    'af5b2a37481704a04f81a4f686b720b1',
  );
  assert.equal(
    secretHash(secret, 'user@example.com', 'clientid123'),
    'x9P5U2NpztF8YdYHq62elcEGKkqoI8jLB7oGfgKE3Ak=',
  );
});

// Computed by python-xsense's AWSSigner with the clock pinned.
const CREDENTIALS = {
  accessKeyId: 'ASIAEXAMPLEKEY',
  secretAccessKey: 'secretKeyExample/abc+def',
  sessionToken: 'session/Token+With=Chars',
};
const DATE = new Date(Date.UTC(2026, 9, 15, 9, 30, 5));

test('the shadow request signature matches python-xsense', () => {
  const headers = signRequest({
    method: 'GET',
    url: 'https://eu-central-1.x-sense-iot.com/things/SBS5000000001/shadow?name=2nd_mainpage',
    region: 'eu-central-1',
    credentials: CREDENTIALS,
    headers: {
      'Content-Type': 'application/x-amz-json-1.0',
      'User-Agent': 'aws-sdk-iOS/2.26.5 iOS/17.3 nl_NL',
      'X-Amz-Security-Token': CREDENTIALS.sessionToken,
    },
    date: DATE,
  });
  assert.equal(headers['X-Amz-Date'], '20261015T093005Z');
  assert.equal(headers.host, 'eu-central-1.x-sense-iot.com');
  assert.equal(
    headers.Authorization,
    'AWS4-HMAC-SHA256 Credential=ASIAEXAMPLEKEY/20261015/eu-central-1/iotdata/aws4_request, ' +
      'SignedHeaders=content-type;host;user-agent;x-amz-date;x-amz-security-token, ' +
      'Signature=dd5f76ce1325c611e1f70f695785064b2f458fea30fb01a7e6350f3bf6df6e64',
  );
});

test('the presigned MQTT URL carries the python-xsense signature', () => {
  const url = presignMqttUrl({
    server: 'abc-ats.iot.eu-central-1.amazonaws.com',
    region: 'eu-central-1',
    credentials: CREDENTIALS,
    date: DATE,
  });
  const params = new URL(url).searchParams;
  assert.equal(
    params.get('X-Amz-Signature'),
    '12018c0de99aa955e5897161b2035c331a92115da04996e3df1c3d779b360595',
  );
  // The token is not signed, only appended: same decoded value either way.
  assert.equal(params.get('X-Amz-Security-Token'), CREDENTIALS.sessionToken);
  assert.equal(
    params.get('X-Amz-Credential'),
    'ASIAEXAMPLEKEY/20261015/eu-central-1/iotdata/aws4_request',
  );
  assert.ok(url.startsWith('wss://abc-ats.iot.eu-central-1.amazonaws.com/mqtt?'));
});
