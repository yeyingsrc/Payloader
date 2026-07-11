import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import ts from 'typescript';

const rootDir = process.cwd();
const sourceFile = path.join(rootDir, 'src', 'components', 'EncodingTools.tsx');
const nodeRequire = createRequire(import.meta.url);

const compileEncodingToolsModule = () => {
  let source = fs.readFileSync(sourceFile, 'utf8').replace(/^\uFEFF/, '');
  source = source.replace(/^import .*?;\r?\n/gm, '');
  source += '\nmodule.exports = { transform, defaultParams, detectInput, inferRsaParamsFromText, inferDlpFromText, factorSmallRsaModulus, operations, gsm7DefaultAlphabet, gsm7ExtensionAlphabet };\n';

  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
    fileName: sourceFile,
  }).outputText;

  const context = {
    module: { exports: {} },
    exports: {},
    require: nodeRequire,
    console,
    process,
    Buffer,
    crypto: globalThis.crypto || crypto.webcrypto,
    atob: value => Buffer.from(value, 'base64').toString('binary'),
    btoa: value => Buffer.from(value, 'binary').toString('base64'),
    TextEncoder,
    TextDecoder,
    Uint8Array,
    URL,
    URLSearchParams,
    setTimeout,
    clearTimeout,
    globalThis: {},
  };
  context.global = context;
  vm.createContext(context);
  vm.runInContext(compiled, context, { filename: 'EncodingTools.compiled.js' });
  return context.module.exports;
};

const modPow = (base, exponent, modulus) => {
  let result = 1n;
  let current = base % modulus;
  let power = exponent;
  while (power > 0n) {
    if (power & 1n) result = (result * current) % modulus;
    power >>= 1n;
    if (power > 0n) current = (current * current) % modulus;
  }
  return result;
};

const modInverse = (value, modulus) => {
  let t = 0n;
  let newT = 1n;
  let r = modulus;
  let newR = ((value % modulus) + modulus) % modulus;
  while (newR !== 0n) {
    const quotient = r / newR;
    [t, newT] = [newT, t - quotient * newT];
    [r, newR] = [newR, r - quotient * newR];
  }
  if (r !== 1n) throw new Error(`No modular inverse for ${value} mod ${modulus}`);
  return t < 0n ? t + modulus : t;
};

const digestForTest = async (message, algorithm) => {
  const { createHash } = await import('node:crypto');
  return createHash(algorithm).update(message, 'utf8').digest('hex');
};

const bitLengthOfBigInt = value => value === 0n ? 0 : value.toString(2).length;

const digestHexToOrderInt = (digestHex, order) => {
  const numeric = BigInt(`0x${digestHex.replace(/^0x/i, '') || '0'}`);
  const extraBits = bitLengthOfBigInt(numeric) - bitLengthOfBigInt(order);
  return extraBits > 0 ? (numeric >> BigInt(extraBits)) : numeric;
};

const expect = (condition, message) => {
  if (!condition) throw new Error(message);
};

const {
  transform,
  defaultParams,
  detectInput,
  inferRsaParamsFromText,
  inferDlpFromText,
  factorSmallRsaModulus,
  operations,
  gsm7DefaultAlphabet,
  gsm7ExtensionAlphabet,
} = compileEncodingToolsModule();

const results = [];

const run = async (name, fn) => {
  await fn();
  results.push(name);
  console.log(`PASS ${name}`);
};

await run('DLP messy prose + ElGamal tuple', async () => {
  const input = [
    'discrete log and elgamal',
    'prime field p is 1019',
    'generator alpha equals 2',
    'public y = 40',
    'order = 1018',
    'ciphertext = (128, 443)',
  ].join('\n');
  const output = JSON.parse(await transform('discrete-log-helper', 'decode', input, defaultParams));
  assert.equal(output.result.recoveredExponent, '13');
  assert.equal(output.result.elgamalPlaintext.decimal, '42');
  expect(output.notes.includes('Parsed a two-value ciphertext tuple into c1/c2.'), 'DLP tuple note missing');
});

await run('smart-decode routes DLP prose to helper', async () => {
  const input = [
    'discrete log and elgamal',
    'prime field p is 1019',
    'generator alpha equals 2',
    'public y = 40',
    'order = 1018',
    'ciphertext = (128, 443)',
  ].join('\n');
  const output = await transform('smart-decode', 'decode', input, defaultParams);
  expect(output.includes('Discrete log / ElGamal analysis'), 'smart-decode did not route to DLP helper');
  expect(output.includes('"recoveredExponent": "13"'), 'smart-decode DLP output missing recovered exponent');
});

await run('DLP parameters without curve evidence do not route to ECC', async () => {
  const input = [
    'p = 1019',
    'g = 2',
    'y = 40',
    'order = 1018',
  ].join('\n');
  const output = await transform('smart-decode', 'decode', input, defaultParams);
  expect(output.includes('Discrete log / ElGamal analysis'), 'generic DLP parameters were not routed to DLP');
  expect(!output.includes('ECC / Elliptic Curve Helper'), 'generic DLP parameters were incorrectly routed to ECC');
});

await run('complete DH parameters without keywords route to DLP before ECC', async () => {
  const input = [
    'p = 1019',
    'g = 2',
    'A = 40',
    'B = 320',
    'order = 1018',
  ].join('\n');
  const output = await transform('smart-decode', 'decode', input, defaultParams);
  expect(output.includes('Discrete log / ElGamal analysis'), 'complete DH parameters were not routed to DLP');
  expect(!output.includes('ECC / Elliptic Curve Helper'), 'bare DH A/B values were incorrectly treated as curve coefficients');
  expect(output.includes('"recoveredExponent": "13"'), 'DH DLP route did not recover exponent 13');
  expect(output.includes('"decimal": "388"'), 'DH DLP route did not recover shared secret 388');
});

await run('smart-decode still routes real curve parameters to ECC', async () => {
  const input = [
    'Elliptic curve over p = 17',
    'a = 2',
    'b = 2',
    'basepoint G = (5, 1)',
    'public point Q = (6, 3)',
    'order = 19',
  ].join('\n');
  const output = await transform('smart-decode', 'decode', input, defaultParams);
  expect(output.includes('ECC / Elliptic Curve Helper'), `real curve parameters were not routed to ECC: ${output}`);
});

await run('GSM 03.38 default and extension alphabets match standard septets', async () => {
  assert.equal(gsm7DefaultAlphabet.length, 128);
  assert.equal(gsm7DefaultAlphabet[0x01], '£');
  assert.equal(gsm7DefaultAlphabet[0x03], '¥');
  assert.equal(gsm7DefaultAlphabet[0x04], 'è');
  assert.equal(gsm7DefaultAlphabet[0x09], 'Ç');
  assert.equal(gsm7DefaultAlphabet[0x0b], 'Ø');
  assert.equal(gsm7DefaultAlphabet[0x10], 'Δ');
  assert.equal(gsm7DefaultAlphabet[0x1f], 'É');
  assert.equal(gsm7DefaultAlphabet[0x24], '¤');
  assert.equal(gsm7DefaultAlphabet[0x40], '¡');
  assert.equal(gsm7DefaultAlphabet[0x7f], 'à');
  assert.equal(gsm7ExtensionAlphabet['€'], 0x65);
});

await run('GSM 03.38 known septet and packed vectors decode correctly', async () => {
  assert.equal(await transform('gsm7', 'decode', '8080604028180e888462c168381e', defaultParams), '@£$¥èéùìòÇ\nØø\rÅå');
  const hello = JSON.parse(await transform('gsm7', 'encode', 'hello', defaultParams));
  assert.equal(hello.septetCount, 5);
  assert.equal(hello.packedHex, 'e8329bfd06');
  assert.equal(await transform('gsm7', 'decode', 'e8329bfd06', defaultParams), 'hello');
  const euro = JSON.parse(await transform('gsm7', 'encode', '€', defaultParams));
  assert.equal(euro.septetCount, 2);
  assert.equal(euro.packedHex, '9b32');
  assert.equal(await transform('gsm7', 'decode', '9b32', defaultParams), '€');
});

await run('GSM 03.38 standard and extension characters round-trip', async () => {
  const standard = '@£$¥èéùìòÇ\nØø\rÅåΔΦΓΛΩΠΨΣΘΞÆæßÉ¤¡ÄÖÑÜ§¿äöñüà';
  const extension = '\f^{}\\[~]|€';
  assert.equal(await transform('gsm7', 'decode', await transform('gsm7', 'encode', standard, defaultParams), defaultParams), standard);
  assert.equal(await transform('gsm7', 'decode', await transform('gsm7', 'encode', extension, defaultParams), defaultParams), extension);
});

await run('GSM 03.38 septet-count contract preserves ambiguous seven-septet payloads', async () => {
  const vectors = [
    { text: '1234567', packedHex: '31d98c56b3dd00' },
    { text: '123456@', packedHex: '31d98c56b30100' },
  ];
  for (const vector of vectors) {
    const encoded = await transform('gsm7', 'encode', vector.text, defaultParams);
    const payload = JSON.parse(encoded);
    assert.equal(payload.septetCount, 7);
    assert.equal(payload.packedHex, vector.packedHex);
    assert.equal(await transform('gsm7', 'decode', encoded, defaultParams), vector.text);
    assert.equal(await transform('gsm7', 'decode', JSON.stringify({ septetCount: 7, packedHex: vector.packedHex }), defaultParams), vector.text);
    await assert.rejects(
      () => transform('gsm7', 'decode', vector.packedHex, defaultParams),
      /septet count|septetCount|长度/i,
    );
  }
});

await run('GSM 03.38 rejects a trailing standalone extension escape', async () => {
  await assert.rejects(
    () => transform('gsm7', 'decode', JSON.stringify({ septetCount: 1, packedHex: '1b' }), defaultParams),
    /ESC|扩展/i,
  );
});

await run('ChaCha20 original is discoverable in crypto operations', async () => {
  const operation = operations.find(item => item.id === 'chacha20-orig');
  expect(operation, 'chacha20-orig is missing from operations');
  assert.equal(operation.category, 'crypto');
  assert.equal(operation.params.join(','), 'secret,iv');
  assert.equal(operation.supportsEncode, undefined);
  assert.equal(operation.supportsDecode, undefined);
});

await run('RSA messy labels with explicit factors', async () => {
  const input = [
    'The modulus value is 3233',
    'public exponent equals 17',
    'ciphertext blob was 2790',
    'prime factor p = 61',
    'prime factor q = 53',
  ].join('\n');
  const output = JSON.parse(await transform('rsa-raw', 'decode', input, defaultParams));
  assert.equal(output.output.decimal, '65');
});

await run('smart-decode routes messy RSA labels to raw RSA decrypt', async () => {
  const input = [
    'The modulus value is 3233',
    'public exponent equals 17',
    'ciphertext blob was 2790',
    'prime factor p = 61',
    'prime factor q = 53',
  ].join('\n');
  const output = await transform('smart-decode', 'decode', input, defaultParams);
  expect(output.includes('RSA Raw / Textbook'), 'smart-decode did not route messy RSA labels');
  expect(output.includes('"decimal": "65"'), 'smart-decode RSA output missing plaintext');
});

await run('Pollard Rho path factors n from n/e/c only', async () => {
  const p = 1000003n;
  const q = 2000003n;
  const n = p * q;
  const e = 65537n;
  const message = 65n;
  const ciphertext = modPow(message, e, n);
  const factored = factorSmallRsaModulus(n);
  expect(Array.isArray(factored), 'factorSmallRsaModulus did not factor medium n');
  assert.deepEqual(Array.from(factored, value => value.toString()), [p.toString(), q.toString()]);

  const input = [
    `modulus value is ${n}`,
    `public exponent equals ${e}`,
    `ciphertext blob was ${ciphertext}`,
  ].join('\n');
  const output = JSON.parse(await transform('rsa-raw', 'decode', input, defaultParams));
  assert.equal(output.output.decimal, '65');
  expect(Array.isArray(output.inference), 'RSA output inference missing');
  expect(output.inference.some(note => /Pollard Rho/i.test(note)), 'RSA output did not record Pollard Rho factoring note');
});

await run('rsa-helper detection works for messy public-key-only prose', async () => {
  const input = [
    'public key challenge',
    'modulus value is 3233',
    'public exponent equals 17',
  ].join('\n');
  const detections = detectInput(input).map(entry => entry.id);
  expect(detections.includes('rsa-helper'), 'detectInput did not recognize messy RSA public-key prose');

  const inference = inferRsaParamsFromText(input, 'decode');
  assert.equal(inference.params.n, '3233');
  assert.equal(inference.params.e, '17');
});

await run('smart-decode falls back to RSA helper for messy public-key prose', async () => {
  const input = [
    'public key challenge',
    'modulus value is 3233',
    'public exponent equals 17',
    'known pair message 2 gives ciphertext 1752',
    'known pair message 42 gives ciphertext 2557',
  ].join('\n');
  const output = await transform('smart-decode', 'decode', input, defaultParams);
  expect(output.includes('RSA CTF Helper'), 'smart-decode did not fall back to RSA helper');
  expect(output.includes('"n": "3233"'), 'RSA helper output missing inferred modulus');
  expect(output.includes('"e": "17"'), 'RSA helper output missing inferred exponent');
});

await run('RSA single-quote pseudo-JSON fields are parsed', async () => {
  const input = "{'n': 3233, 'e': 17, 'c': 2790, 'p': 61, 'q': 53}";
  const output = JSON.parse(await transform('rsa-raw', 'decode', input, defaultParams));
  assert.equal(output.output.decimal, '65');
});

await run('RSA p+q hint recovers factors', async () => {
  const input = [
    'n = 3233',
    'e = 17',
    'ciphertext = 2790',
    'p + q = 114',
  ].join('\n');
  const output = JSON.parse(await transform('rsa-raw', 'decode', input, defaultParams));
  assert.equal(output.output.decimal, '65');
  expect(output.inference.some(note => note.includes('由 n 与 (p+q) 提示恢复 p')), 'RSA sum hint did not recover p');
  expect(output.inference.some(note => note.includes('由 n 与 (p+q) 提示恢复 q')), 'RSA sum hint did not recover q');
});

await run('RSA p-q hint recovers factors', async () => {
  const input = [
    'n = 3233',
    'e = 17',
    'ciphertext = 2790',
    'p - q = 8',
  ].join('\n');
  const output = JSON.parse(await transform('rsa-raw', 'decode', input, defaultParams));
  assert.equal(output.output.decimal, '65');
  expect(output.inference.some(note => note.includes('由 n 与 |p-q| 提示恢复 p')), 'RSA diff hint did not recover p');
  expect(output.inference.some(note => note.includes('由 n 与 |p-q| 提示恢复 q')), 'RSA diff hint did not recover q');
});

await run('RSA arithmetic expressions n=p*q and phi=(p-1)*(q-1) are evaluated', async () => {
  const input = [
    'p = 61',
    'q = 53',
    'n = p*q',
    'phi = (p-1)*(q-1)',
    'e = 17',
    'c = 2790',
  ].join('\n');
  const output = JSON.parse(await transform('rsa-raw', 'decode', input, defaultParams));
  assert.equal(output.output.decimal, '65');
  assert.equal(output.modulus, '3233');
});

await run('RSA chained arithmetic references are evaluated from helper variables', async () => {
  const input = [
    'prime1 = 61',
    'prime2 = 53',
    'modulus = prime1 * prime2',
    'totient = (prime1 - 1) * (prime2 - 1)',
    'public exponent = 17',
    'ciphertext = 2790',
  ].join('\n');
  const output = await transform('smart-decode', 'decode', input, defaultParams);
  expect(output.includes('RSA Raw / Textbook'), 'Chained arithmetic RSA was not routed to raw decrypt');
  expect(output.includes('"decimal": "65"'), 'Chained arithmetic RSA did not recover plaintext 65');
});

await run('RSA modular inverse helper expression d = pow(e, -1, phi) is evaluated', async () => {
  const input = [
    'p = 61',
    'q = 53',
    'n = p*q',
    'phi = (p-1)*(q-1)',
    'e = 17',
    'd = pow(e, -1, phi)',
    'c = 2790',
  ].join('\n');
  const output = JSON.parse(await transform('rsa-raw', 'decode', input, defaultParams));
  assert.equal(output.output.decimal, '65');
});

await run('RSA inverse(e, phi) helper expression is evaluated', async () => {
  const input = [
    'p = 61',
    'q = 53',
    'n = p*q',
    'phi = (p-1)*(q-1)',
    'e = 17',
    'd = inverse(e, phi)',
    'ciphertext = 2790',
  ].join('\n');
  const output = await transform('smart-decode', 'decode', input, defaultParams);
  expect(output.includes('"decimal": "65"'), 'inverse(e, phi) RSA did not recover plaintext 65');
});

await run('RSA gmpy2.invert(e, phi) helper expression is evaluated', async () => {
  const input = [
    'p = 61',
    'q = 53',
    'n = p*q',
    'phi = (p-1)*(q-1)',
    'e = 17',
    'd = gmpy2.invert(e, phi)',
    'ciphertext = 2790',
  ].join('\n');
  const output = await transform('smart-decode', 'decode', input, defaultParams);
  expect(output.includes('"decimal": "65"'), 'gmpy2.invert(e, phi) RSA did not recover plaintext 65');
});

await run('RSA bytes_to_long(...) and pow(m, e, n) script fragments are evaluated', async () => {
  const input = [
    'p = 61',
    'q = 53',
    'n = p*q',
    'e = 17',
    "m = bytes_to_long(b'A')",
    'c = pow(m, e, n)',
  ].join('\n');
  const output = await transform('smart-decode', 'decode', input, defaultParams);
  expect(output.includes('"decimal": "65"'), 'bytes_to_long(...) RSA script did not recover plaintext 65');
});

await run('RSA int.from_bytes(...) script fragments are evaluated', async () => {
  const input = [
    'p = 61',
    'q = 53',
    'n = p*q',
    'e = 17',
    "m = int.from_bytes(b'A', 'big')",
    'c = pow(m, e, n)',
  ].join('\n');
  const output = await transform('smart-decode', 'decode', input, defaultParams);
  expect(output.includes('"decimal": "65"'), 'int.from_bytes(...) RSA script did not recover plaintext 65');
});

await run('RSA int(hex_string, 16) helper expression is evaluated', async () => {
  const input = [
    'p = 61',
    'q = 53',
    'n = p*q',
    'e = 17',
    "m = int('41', 16)",
    'c = pow(m, e, n)',
  ].join('\n');
  const output = await transform('smart-decode', 'decode', input, defaultParams);
  expect(output.includes('"decimal": "65"'), 'int(hex_string, 16) RSA script did not recover plaintext 65');
});

await run('RSA bytes.fromhex(hex(m)[2:]) writeup-style fragments are evaluated', async () => {
  const input = [
    'p = 61',
    'q = 53',
    'n = p*q',
    'e = 17',
    'm = bytes_to_long(bytes.fromhex(hex(65)[2:]))',
    'c = pow(m, e, n)',
  ].join('\n');
  const output = await transform('smart-decode', 'decode', input, defaultParams);
  expect(output.includes('"decimal": "65"'), 'bytes.fromhex(hex(m)[2:]) RSA script did not recover plaintext 65');
});

await run('RSA binascii.unhexlify(...) helper fragments are evaluated', async () => {
  const input = [
    'p = 61',
    'q = 53',
    'n = p*q',
    'e = 17',
    'm = bytes_to_long(binascii.unhexlify("41"))',
    'c = pow(m, e, n)',
  ].join('\n');
  const output = await transform('smart-decode', 'decode', input, defaultParams);
  expect(output.includes('"decimal": "65"'), 'binascii.unhexlify(...) RSA script did not recover plaintext 65');
});

await run('RSA Crypto.Util.number.bytes_to_long(...) fragments are evaluated', async () => {
  const input = [
    'p = 61',
    'q = 53',
    'n = p*q',
    'e = 17',
    "m = Crypto.Util.number.bytes_to_long(b'A')",
    'c = pow(m, e, n)',
  ].join('\n');
  const output = await transform('smart-decode', 'decode', input, defaultParams);
  expect(output.includes('"decimal": "65"'), 'Crypto.Util.number.bytes_to_long(...) RSA script did not recover plaintext 65');
});

await run('RSA libnum.s2n(...) fragments are evaluated', async () => {
  const input = [
    'p = 61',
    'q = 53',
    'n = p*q',
    'e = 17',
    "m = libnum.s2n('A')",
    'c = pow(m, e, n)',
  ].join('\n');
  const output = await transform('smart-decode', 'decode', input, defaultParams);
  expect(output.includes('"decimal": "65"'), 'libnum.s2n(...) RSA script did not recover plaintext 65');
});

await run('RSA single-line pow(bytes_to_long(flag), e, n) style fragments are evaluated', async () => {
  const input = [
    'p = 61',
    'q = 53',
    'n = p*q',
    'e = 17',
    "c = pow(bytes_to_long(b'A'), e, n)",
  ].join('\n');
  const output = await transform('smart-decode', 'decode', input, defaultParams);
  expect(output.includes('"decimal": "65"'), 'pow(bytes_to_long(flag), e, n) style RSA fragment did not recover plaintext 65');
});

await run('RSA bytearray.fromhex(...) fragments are evaluated', async () => {
  const input = [
    'p = 61',
    'q = 53',
    'n = p*q',
    'e = 17',
    "m = bytes_to_long(bytearray.fromhex('41'))",
    'c = pow(m, e, n)',
  ].join('\n');
  const output = await transform('smart-decode', 'decode', input, defaultParams);
  expect(output.includes('"decimal": "65"'), 'bytearray.fromhex(...) RSA script did not recover plaintext 65');
});

await run('RSA single-line pow(Crypto.Util.number.bytes_to_long(flag), e, n) fragments are evaluated', async () => {
  const input = [
    'p = 61',
    'q = 53',
    'n = p*q',
    'e = 17',
    "c = pow(Crypto.Util.number.bytes_to_long(b'A'), e, n)",
  ].join('\n');
  const output = await transform('smart-decode', 'decode', input, defaultParams);
  expect(output.includes('"decimal": "65"'), 'pow(Crypto.Util.number.bytes_to_long(flag), e, n) RSA fragment did not recover plaintext 65');
});

await run('RSA long_to_bytes(pow(c, d, n)) solve fragments are evaluated', async () => {
  const input = [
    'n = 3233',
    'e = 17',
    'p = 61',
    'q = 53',
    'c = 2790',
    'm = pow(c, pow(e, -1, (p-1)*(q-1)), n)',
    'decoded = long_to_bytes(m)',
  ].join('\n');
  const output = await transform('smart-decode', 'decode', input, defaultParams);
  expect(output.includes('"decimal": "65"'), 'long_to_bytes(pow(c, d, n)) RSA solve fragment did not recover plaintext 65');
});

await run('RSA libnum.n2s(pow(c, d, n)) solve fragments are evaluated', async () => {
  const input = [
    'n = 3233',
    'e = 17',
    'p = 61',
    'q = 53',
    'c = 2790',
    'decoded = libnum.n2s(pow(c, pow(e, -1, (p-1)*(q-1)), n))',
  ].join('\n');
  const output = await transform('smart-decode', 'decode', input, defaultParams);
  expect(output.includes('"decimal": "65"'), 'libnum.n2s(pow(c, d, n)) RSA solve fragment did not recover plaintext 65');
});

await run('RSA bytes.fromhex(hex(pow(c, d, n))[2:]) solve fragments are evaluated', async () => {
  const input = [
    'n = 3233',
    'e = 17',
    'p = 61',
    'q = 53',
    'c = 2790',
    'decoded = bytes.fromhex(hex(pow(c, pow(e, -1, (p-1)*(q-1)), n))[2:])',
  ].join('\n');
  const output = await transform('smart-decode', 'decode', input, defaultParams);
  expect(output.includes('"decimal": "65"'), 'bytes.fromhex(hex(pow(c, d, n))[2:]) RSA solve fragment did not recover plaintext 65');
});

await run('RSA common modulus works for dict-style records', async () => {
  const n = 3233n;
  const e1 = 17n;
  const e2 = 13n;
  const message = 42n;
  const c1 = modPow(message, e1, n);
  const c2 = modPow(message, e2, n);
  const input = `records = [{'n': ${n}, 'e': ${e1}, 'c': ${c1}}, {'n': ${n}, 'e': ${e2}, 'c': ${c2}}]`;
  const output = await transform('smart-decode', 'decode', input, defaultParams);
  expect(output.includes('RSA Common Modulus'), 'Common modulus attack was not detected from dict-style records');
  expect(output.includes('"decimal": "42"'), 'Common modulus attack did not recover plaintext 42');
});

await run('RSA Hastad broadcast works for dict-style records', async () => {
  const e = 3n;
  const message = 42n;
  const moduli = [10403n, 11663n, 14351n];
  const records = moduli.map((n, index) => `{'n': ${n}, 'e': ${e}, 'c': ${modPow(message, e, n)}}${index === moduli.length - 1 ? '' : ', '}`).join('');
  const input = `records = [${records}]`;
  const output = await transform('smart-decode', 'decode', input, defaultParams);
  expect(output.includes('RSA Hastad Broadcast'), 'Hastad broadcast attack was not detected from dict-style records');
  expect(output.includes('"decimal": "42"'), 'Hastad broadcast attack did not recover plaintext 42');
});

await run('RSA shared prime works for dict-style records', async () => {
  const sharedPrime = 101n;
  const q1 = 103n;
  const q2 = 107n;
  const e = 17n;
  const m1 = 65n;
  const m2 = 66n;
  const n1 = sharedPrime * q1;
  const n2 = sharedPrime * q2;
  const input = `records = [{'n': ${n1}, 'e': ${e}, 'c': ${modPow(m1, e, n1)}}, {'n': ${n2}, 'e': ${e}, 'c': ${modPow(m2, e, n2)}}]`;
  const output = await transform('smart-decode', 'decode', input, defaultParams);
  expect(output.includes('RSA Shared Prime GCD'), 'Shared-prime RSA attack was not detected from dict-style records');
  expect(output.includes(`"sharedPrime": "${sharedPrime}"`), 'Shared-prime RSA output missing recovered shared prime');
});

await run('RSA common modulus works for n1/e1/c1 numbered records', async () => {
  const n = 3233n;
  const e1 = 17n;
  const e2 = 13n;
  const message = 42n;
  const input = [
    `n1 = ${n}`,
    `e1 = ${e1}`,
    `c1 = ${modPow(message, e1, n)}`,
    `n2 = ${n}`,
    `e2 = ${e2}`,
    `c2 = ${modPow(message, e2, n)}`,
  ].join('\n');
  const output = await transform('smart-decode', 'decode', input, defaultParams);
  expect(output.includes('RSA Common Modulus'), 'Common modulus attack was not detected from numbered records');
  expect(output.includes('"decimal": "42"'), 'Common modulus numbered-record plaintext mismatch');
});

await run('RSA Hastad broadcast works for list-style records', async () => {
  const e = 3n;
  const message = 42n;
  const moduli = [10403n, 11663n, 14351n];
  const ciphertexts = moduli.map(n => modPow(message, e, n));
  const input = [
    `moduli = [${moduli.join(', ')}]`,
    `exponents = [${e}, ${e}, ${e}]`,
    `ciphertexts = [${ciphertexts.join(', ')}]`,
  ].join('\n');
  const output = await transform('smart-decode', 'decode', input, defaultParams);
  expect(output.includes('RSA Hastad Broadcast'), 'Hastad broadcast attack was not detected from list-style records');
  expect(output.includes('"decimal": "42"'), 'Hastad list-style plaintext mismatch');
});

await run('RSA common modulus works for public_key tuple lines', async () => {
  const n = 3233n;
  const e1 = 17n;
  const e2 = 13n;
  const message = 42n;
  const input = [
    `public_key1 = (${n}, ${e1})`,
    `ciphertext1 = ${modPow(message, e1, n)}`,
    `public_key2 = (${n}, ${e2})`,
    `ciphertext2 = ${modPow(message, e2, n)}`,
  ].join('\n');
  const output = await transform('smart-decode', 'decode', input, defaultParams);
  expect(output.includes('RSA Common Modulus'), 'Common modulus attack was not detected from public_key tuple lines');
  expect(output.includes('"decimal": "42"'), 'Common modulus tuple-line plaintext mismatch');
});

await run('RSA Hastad broadcast works for public_keys tuple list', async () => {
  const e = 3n;
  const message = 42n;
  const moduli = [10403n, 11663n, 14351n];
  const ciphertexts = moduli.map(n => modPow(message, e, n));
  const input = [
    `public_keys = [(${moduli[0]}, ${e}), (${moduli[1]}, ${e}), (${moduli[2]}, ${e})]`,
    `ciphertexts = [${ciphertexts.join(', ')}]`,
  ].join('\n');
  const output = await transform('smart-decode', 'decode', input, defaultParams);
  expect(output.includes('RSA Hastad Broadcast'), 'Hastad broadcast attack was not detected from public_keys tuple list');
  expect(output.includes('"decimal": "42"'), 'Hastad public_keys tuple-list plaintext mismatch');
});

await run('RSA Hastad broadcast works for public key object list', async () => {
  const e = 3n;
  const message = 42n;
  const moduli = [10403n, 11663n, 14351n];
  const ciphertexts = moduli.map(n => modPow(message, e, n));
  const input = `records = [{'public_key': (${moduli[0]}, ${e}), 'ciphertext': ${ciphertexts[0]}}, {'public_key': (${moduli[1]}, ${e}), 'ciphertext': ${ciphertexts[1]}}, {'public_key': (${moduli[2]}, ${e}), 'ciphertext': ${ciphertexts[2]}}]`;
  const output = await transform('smart-decode', 'decode', input, defaultParams);
  expect(output.includes('RSA Hastad Broadcast'), 'Hastad broadcast attack was not detected from public key object list');
  expect(output.includes('"decimal": "42"'), 'Hastad public key object-list plaintext mismatch');
});

await run('RSA nested public_key object with sibling ciphertext works', async () => {
  const e = 3n;
  const message = 42n;
  const moduli = [10403n, 11663n, 14351n];
  const ciphertexts = moduli.map(n => modPow(message, e, n));
  const input = JSON.stringify({
    records: moduli.map((n, index) => ({
      public_key: { n: n.toString(), e: e.toString() },
      ciphertext: ciphertexts[index].toString(),
    })),
  });
  const output = await transform('smart-decode', 'decode', input, defaultParams);
  expect(output.includes('RSA Hastad Broadcast'), 'Nested public_key object records did not trigger Hastad broadcast');
  expect(output.includes('"decimal": "42"'), 'Nested public_key object records did not recover plaintext 42');
});

await run('RSA Python-style nested public_key object with sibling ciphertext works', async () => {
  const e = 3n;
  const message = 42n;
  const moduli = [10403n, 11663n, 14351n];
  const ciphertexts = moduli.map(n => modPow(message, e, n));
  const input = `records = [{'public_key': {'n': '${moduli[0]}', 'e': '${e}'}, 'ciphertext': '${ciphertexts[0]}'}, {'public_key': {'n': '${moduli[1]}', 'e': '${e}'}, 'ciphertext': '${ciphertexts[1]}'}, {'public_key': {'n': '${moduli[2]}', 'e': '${e}'}, 'ciphertext': '${ciphertexts[2]}'}]`;
  const output = await transform('smart-decode', 'decode', input, defaultParams);
  expect(output.includes('RSA Hastad Broadcast'), 'Python-style nested public_key object records did not trigger Hastad broadcast');
  expect(output.includes('"decimal": "42"'), 'Python-style nested public_key object records did not recover plaintext 42');
});

await run('RSA Python-style pub alias object with sibling ciphertext works', async () => {
  const e = 3n;
  const message = 42n;
  const moduli = [10403n, 11663n, 14351n];
  const ciphertexts = moduli.map(n => modPow(message, e, n));
  const input = `records = [{'pub': {'n': '${moduli[0]}', 'e': '${e}'}, 'ct': '${ciphertexts[0]}'}, {'pub': {'n': '${moduli[1]}', 'e': '${e}'}, 'ct': '${ciphertexts[1]}'}, {'pub': {'n': '${moduli[2]}', 'e': '${e}'}, 'ct': '${ciphertexts[2]}'}]`;
  const output = await transform('smart-decode', 'decode', input, defaultParams);
  expect(output.includes('RSA Hastad Broadcast'), 'Python-style pub alias object records did not trigger Hastad broadcast');
  expect(output.includes('"decimal": "42"'), 'Python-style pub alias object records did not recover plaintext 42');
});

await run('RSA pk tuple alias with ciphertext lines works', async () => {
  const n = 3233n;
  const e1 = 17n;
  const e2 = 13n;
  const message = 42n;
  const input = [
    `pk1 = (${n}, ${e1})`,
    `ciphertext1 = ${modPow(message, e1, n)}`,
    `pk2 = (${n}, ${e2})`,
    `ciphertext2 = ${modPow(message, e2, n)}`,
  ].join('\n');
  const output = await transform('smart-decode', 'decode', input, defaultParams);
  expect(output.includes('RSA Common Modulus'), 'pk tuple alias records did not trigger common modulus attack');
  expect(output.includes('"decimal": "42"'), 'pk tuple alias records did not recover plaintext 42');
});

await run('RSA script-style pub object and flag_ct alias are parsed', async () => {
  const n = 3233n;
  const e = 17n;
  const message = 65n;
  const ciphertext = modPow(message, e, n);
  const input = [
    `pub = {'n': '${n}', 'e': '${e}'}`,
    `flag_ct = ${ciphertext}`,
    'rsa challenge snippet',
  ].join('\n');
  const output = await transform('smart-decode', 'decode', input, defaultParams);
  expect(output.includes('RSA Raw / Textbook') || output.includes('RSA CTF Helper'), 'pub object + flag_ct snippet was not recognized as RSA');
  expect(output.includes('"decimal": "65"'), 'pub object + flag_ct snippet did not recover plaintext 65');
});

await run('RSA script-style referenced variables are resolved', async () => {
  const n = 3233n;
  const e = 17n;
  const message = 65n;
  const ciphertext = modPow(message, e, n);
  const input = [
    `n = ${n}`,
    `e = ${e}`,
    `c = ${ciphertext}`,
    `pub = {'n': n, 'e': e}`,
    'flag_ct = c',
  ].join('\n');
  const output = await transform('smart-decode', 'decode', input, defaultParams);
  expect(output.includes('"decimal": "65"'), 'Referenced RSA variables did not resolve into a decryptable payload');
});

await run('RSA script-style rsa object and encmsg alias are parsed', async () => {
  const n = 3233n;
  const e = 17n;
  const message = 65n;
  const ciphertext = modPow(message, e, n);
  const input = [
    `n = ${n}`,
    `e = ${e}`,
    `c = ${ciphertext}`,
    `rsa = {'n': n, 'e': e}`,
    'encmsg = c',
  ].join('\n');
  const output = await transform('smart-decode', 'decode', input, defaultParams);
  expect(output.includes('"decimal": "65"'), 'rsa object + encmsg alias snippet did not recover plaintext 65');
});

await run('RSA script-style enc_data/cipher_data/flag_enc aliases are parsed', async () => {
  const n = 3233n;
  const e = 17n;
  const message = 65n;
  const ciphertext = modPow(message, e, n);
  const input = [
    `priv = {'n': '${n}', 'e': '${e}'}`,
    `enc_data = ${ciphertext}`,
    `cipher_data = ${ciphertext}`,
    `flag_enc = ${ciphertext}`,
  ].join('\n');
  const output = await transform('smart-decode', 'decode', input, defaultParams);
  expect(output.includes('"decimal": "65"'), 'enc_data/cipher_data/flag_enc aliases did not recover plaintext 65');
});

await run('RSA script-style privkey/pubkey/cipher_data/ctxt aliases are parsed', async () => {
  const n = 3233n;
  const e = 17n;
  const message = 65n;
  const ciphertext = modPow(message, e, n);
  const input = [
    `n = ${n}`,
    `e = ${e}`,
    `c = ${ciphertext}`,
    `privkey = {'n': n, 'e': e}`,
    `pubkey = {'n': n, 'e': e}`,
    'cipher_data = c',
    'ctxt = c',
  ].join('\n');
  const output = await transform('smart-decode', 'decode', input, defaultParams);
  expect(output.includes('"decimal": "65"'), 'privkey/pubkey/cipher_data/ctxt aliases did not recover plaintext 65');
});

await run('RSA keypair tuple alias with enc alias works', async () => {
  const n = 3233n;
  const e1 = 17n;
  const e2 = 13n;
  const message = 42n;
  const input = [
    `keypair1 = (${n}, ${e1})`,
    `enc1 = ${modPow(message, e1, n)}`,
    `keypair2 = (${n}, ${e2})`,
    `enc2 = ${modPow(message, e2, n)}`,
  ].join('\n');
  const output = await transform('smart-decode', 'decode', input, defaultParams);
  expect(output.includes('RSA Common Modulus'), 'keypair tuple alias records did not trigger common modulus attack');
  expect(output.includes('"decimal": "42"'), 'keypair tuple alias records did not recover plaintext 42');
});

await run('ECDSA nonce reuse works for dict-style records', async () => {
  const order = 101n;
  const privateKey = 11n;
  const nonce = 13n;
  const r = 17n;
  const z1 = 33n;
  const z2 = 44n;
  const nonceInverse = modInverse(nonce, order);
  const s1 = (nonceInverse * ((z1 + r * privateKey) % order)) % order;
  const s2 = (nonceInverse * ((z2 + r * privateKey) % order)) % order;
  const input = `signatures = [{'scheme': 'ecdsa', 'order': ${order}, 'r': ${r}, 's': ${s1}, 'z': ${z1}}, {'scheme': 'ecdsa', 'order': ${order}, 'r': ${r}, 's': ${s2}, 'z': ${z2}}]`;
  const output = await transform('signature-nonce-helper', 'decode', input, defaultParams);
  expect(output.includes('"scheme": "ecdsa-dsa"'), 'ECDSA dict-style records did not identify ECDSA scheme');
  expect(output.includes(`"privateKey": "${privateKey}"`), 'ECDSA dict-style records did not recover private key');
  expect(output.includes(`"nonceK": "${nonce}"`), 'ECDSA dict-style records did not recover nonce');
});

await run('Schnorr nonce reuse works for dict-style records', async () => {
  const order = 101n;
  const privateKey = 19n;
  const nonce = 29n;
  const r = 23n;
  const e1 = 17n;
  const e2 = 25n;
  const s1 = (nonce + e1 * privateKey) % order;
  const s2 = (nonce + e2 * privateKey) % order;
  const input = `records = [{'scheme': 'schnorr', 'order': ${order}, 'r': ${r}, 's': ${s1}, 'z': ${e1}}, {'scheme': 'schnorr', 'order': ${order}, 'r': ${r}, 's': ${s2}, 'z': ${e2}}]`;
  const output = await transform('signature-nonce-helper', 'decode', input, defaultParams);
  expect(output.includes('"scheme": "schnorr"'), 'Schnorr dict-style records did not identify Schnorr scheme');
  expect(output.includes(`"privateKey": "${privateKey}"`), 'Schnorr dict-style records did not recover private key');
  expect(output.includes(`"nonceK": "${nonce}"`), 'Schnorr dict-style records did not recover nonce');
});

await run('ECDSA nonce reuse works for prose sig1/sig2 format', async () => {
  const order = 101n;
  const privateKey = 11n;
  const nonce = 13n;
  const r = 17n;
  const z1 = 33n;
  const z2 = 44n;
  const nonceInverse = modInverse(nonce, order);
  const s1 = (nonceInverse * ((z1 + r * privateKey) % order)) % order;
  const s2 = (nonceInverse * ((z2 + r * privateKey) % order)) % order;
  const input = [
    'ecdsa repeated nonce challenge',
    `sig1 = (${r}, ${s1})`,
    `z1 = ${z1}`,
    `sig2 = (${r}, ${s2})`,
    `z2 = ${z2}`,
    `order = ${order}`,
  ].join('\n');
  const output = await transform('signature-nonce-helper', 'decode', input, defaultParams);
  expect(output.includes('"scheme": "ecdsa-dsa"'), 'ECDSA prose sig1/sig2 did not identify ECDSA scheme');
  expect(output.includes(`"privateKey": "${privateKey}"`), 'ECDSA prose sig1/sig2 did not recover private key');
});

await run('ECDSA nonce reuse derives z from msg1/msg2 and algorithm', async () => {
  const order = 101n;
  const privateKey = 11n;
  const nonce = 13n;
  const r = 17n;
  const msg1 = 'alpha';
  const msg2 = 'beta';
  const digest1 = await digestForTest(msg1, 'sha256');
  const digest2 = await digestForTest(msg2, 'sha256');
  const z1 = digestHexToOrderInt(digest1, order);
  const z2 = digestHexToOrderInt(digest2, order);
  const nonceInverse = modInverse(nonce, order);
  const s1 = (nonceInverse * ((z1 + r * privateKey) % order)) % order;
  const s2 = (nonceInverse * ((z2 + r * privateKey) % order)) % order;
  const input = [
    'ecdsa repeated nonce challenge',
    'algorithm = sha256',
    `sig1 = (${r}, ${s1})`,
    `msg1 = ${msg1}`,
    `sig2 = (${r}, ${s2})`,
    `msg2 = ${msg2}`,
    `order = ${order}`,
  ].join('\n');
  const output = await transform('signature-nonce-helper', 'decode', input, defaultParams);
  expect(output.includes(`"privateKey": "${privateKey}"`), 'ECDSA msg/alg input did not recover private key');
  expect(output.includes('"derivedFromMessage": true'), 'ECDSA msg/alg input did not mark z as derived from message');
});

await run('ECDSA signature/message lists derive z and recover key', async () => {
  const order = 101n;
  const privateKey = 11n;
  const nonce = 13n;
  const r = 17n;
  const msg1 = 'alpha';
  const msg2 = 'beta';
  const digest1 = await digestForTest(msg1, 'sha256');
  const digest2 = await digestForTest(msg2, 'sha256');
  const z1 = digestHexToOrderInt(digest1, order);
  const z2 = digestHexToOrderInt(digest2, order);
  const nonceInverse = modInverse(nonce, order);
  const s1 = (nonceInverse * ((z1 + r * privateKey) % order)) % order;
  const s2 = (nonceInverse * ((z2 + r * privateKey) % order)) % order;
  const input = [
    'ecdsa repeated nonce challenge',
    'algorithm = sha256',
    `signatures = [(${r}, ${s1}), (${r}, ${s2})]`,
    `messages = ["${msg1}", "${msg2}"]`,
    `order = ${order}`,
  ].join('\n');
  const output = await transform('signature-nonce-helper', 'decode', input, defaultParams);
  expect(output.includes(`"privateKey": "${privateKey}"`), 'ECDSA signature/message list input did not recover private key');
  expect(output.includes('"derivedFromMessage": true'), 'ECDSA signature/message list input did not derive z from message');
});

await run('DSA nonce reuse works for explicit DSA dict-style records', async () => {
  const order = 101n;
  const privateKey = 7n;
  const nonce = 19n;
  const r = 23n;
  const z1 = 12n;
  const z2 = 34n;
  const nonceInverse = modInverse(nonce, order);
  const s1 = (nonceInverse * ((z1 + privateKey * r) % order)) % order;
  const s2 = (nonceInverse * ((z2 + privateKey * r) % order)) % order;
  const input = `records = [{'scheme': 'dsa', 'order': ${order}, 'r': ${r}, 's': ${s1}, 'z': ${z1}}, {'scheme': 'dsa', 'order': ${order}, 'r': ${r}, 's': ${s2}, 'z': ${z2}}]`;
  const output = await transform('signature-nonce-helper', 'decode', input, defaultParams);
  expect(output.includes('"scheme": "ecdsa-dsa"'), 'DSA dict-style records did not route through ECDSA/DSA branch');
  expect(output.includes(`"privateKey": "${privateKey}"`), 'DSA dict-style records did not recover private key');
  expect(output.includes(`"nonceK": "${nonce}"`), 'DSA dict-style records did not recover nonce');
});

await run('ECDSA mixed r1/s1/msg1 prose derives z and recovers key', async () => {
  const order = 101n;
  const privateKey = 11n;
  const nonce = 13n;
  const r = 17n;
  const msg1 = 'alpha';
  const msg2 = 'beta';
  const digest1 = await digestForTest(msg1, 'sha256');
  const digest2 = await digestForTest(msg2, 'sha256');
  const z1 = digestHexToOrderInt(digest1, order);
  const z2 = digestHexToOrderInt(digest2, order);
  const nonceInverse = modInverse(nonce, order);
  const s1 = (nonceInverse * ((z1 + r * privateKey) % order)) % order;
  const s2 = (nonceInverse * ((z2 + r * privateKey) % order)) % order;
  const input = [
    'ecdsa repeated nonce mixed prose',
    'alg = sha256',
    `r1 = ${r}`,
    `s1 = ${s1}`,
    `msg1 = ${msg1}`,
    `r2 = ${r}`,
    `s2 = ${s2}`,
    `msg2 = ${msg2}`,
    `order = ${order}`,
  ].join('\n');
  const output = await transform('signature-nonce-helper', 'decode', input, defaultParams);
  expect(output.includes(`"privateKey": "${privateKey}"`), 'ECDSA mixed prose input did not recover private key');
  expect(output.includes('"derivedFromMessage": true'), 'ECDSA mixed prose input did not derive z from messages');
});

await run('JOSE token1/token2 repeated nonce works', async () => {
  const rHex = '0000000000000000000000000000000000000000000000000000000000000011';
  const s1Hex = '0000000000000000000000000000000000000000000000000000000000000038';
  const s2Hex = '000000000000000000000000000000000000000000000000000000000000004f';
  const signature1 = Buffer.from(`${rHex}${s1Hex}`, 'hex').toString('base64url');
  const signature2 = Buffer.from(`${rHex}${s2Hex}`, 'hex').toString('base64url');
  const header = Buffer.from(JSON.stringify({ alg: 'ES256', typ: 'JWT' })).toString('base64url');
  const payload1 = Buffer.from(JSON.stringify({ sub: 'alice', iat: 1 })).toString('base64url');
  const payload2 = Buffer.from(JSON.stringify({ sub: 'bob', iat: 2 })).toString('base64url');
  const token1 = `${header}.${payload1}.${signature1}`;
  const token2 = `${header}.${payload2}.${signature2}`;
  const input = [
    'ecdsa repeated nonce jose challenge',
    `token1 = ${token1}`,
    `token2 = ${token2}`,
    'order = 101',
  ].join('\n');
  const output = await transform('signature-nonce-helper', 'decode', input, defaultParams);
  expect(output.includes('"signatureFormat": "JOSE ES256"'), 'JOSE token list did not preserve JOSE signature format');
  expect(output.includes('"repeatedRCount": 1'), 'JOSE token list did not detect repeated r');
  expect(output.includes('"index": "jose-1"') && output.includes('"index": "jose-2"'), 'JOSE token list did not create jose-* records');
});

await run('JOSE tokens=[...] repeated nonce works', async () => {
  const rHex = '0000000000000000000000000000000000000000000000000000000000000011';
  const s1Hex = '0000000000000000000000000000000000000000000000000000000000000038';
  const s2Hex = '000000000000000000000000000000000000000000000000000000000000004f';
  const signature1 = Buffer.from(`${rHex}${s1Hex}`, 'hex').toString('base64url');
  const signature2 = Buffer.from(`${rHex}${s2Hex}`, 'hex').toString('base64url');
  const header = Buffer.from(JSON.stringify({ alg: 'ES256', typ: 'JWT' })).toString('base64url');
  const payload1 = Buffer.from(JSON.stringify({ sub: 'alice', iat: 1 })).toString('base64url');
  const payload2 = Buffer.from(JSON.stringify({ sub: 'bob', iat: 2 })).toString('base64url');
  const token1 = `${header}.${payload1}.${signature1}`;
  const token2 = `${header}.${payload2}.${signature2}`;
  const input = [
    'ecdsa repeated nonce jose challenge',
    `tokens = ["${token1}", "${token2}"]`,
    'order = 101',
  ].join('\n');
  const output = await transform('signature-nonce-helper', 'decode', input, defaultParams);
  expect(output.includes('"repeatedRCount": 1'), 'JOSE tokens=[...] input did not detect repeated r');
  expect(output.includes('"index": "tokenlist-1"') && output.includes('"index": "tokenlist-2"'), 'JOSE tokens=[...] input did not create tokenlist-* records');
});

await run('JOSE token object records work', async () => {
  const rHex = '0000000000000000000000000000000000000000000000000000000000000011';
  const s1Hex = '0000000000000000000000000000000000000000000000000000000000000038';
  const s2Hex = '000000000000000000000000000000000000000000000000000000000000004f';
  const signature1 = Buffer.from(`${rHex}${s1Hex}`, 'hex').toString('base64url');
  const signature2 = Buffer.from(`${rHex}${s2Hex}`, 'hex').toString('base64url');
  const header = Buffer.from(JSON.stringify({ alg: 'ES256', typ: 'JWT' })).toString('base64url');
  const payload1 = Buffer.from(JSON.stringify({ sub: 'alice', iat: 1 })).toString('base64url');
  const payload2 = Buffer.from(JSON.stringify({ sub: 'bob', iat: 2 })).toString('base64url');
  const token1 = `${header}.${payload1}.${signature1}`;
  const token2 = `${header}.${payload2}.${signature2}`;
  const input = `records = [{'token': '${token1}'}, {'token': '${token2}'}]\norder = 101`;
  const output = await transform('signature-nonce-helper', 'decode', input, defaultParams);
  expect(output.includes('"repeatedRCount": 1'), 'JOSE token object records did not detect repeated r');
  expect(output.includes('"signatureFormat": "JOSE ES256"'), 'JOSE token object records lost JOSE signature format');
});

await run('DLP inference recognizes prose aliases', async () => {
  const input = [
    'prime field p is 1019',
    'generator alpha equals 2',
    'public y = 40',
    'order = 1018',
  ].join('\n');
  const inference = inferDlpFromText(input);
  assert.equal(inference.modulus?.toString(), '1019');
  assert.equal(inference.base?.toString(), '2');
  assert.equal(inference.target?.toString(), '40');
  assert.equal(inference.order?.toString(), '1018');
});

await run('ECDSA DER signature fields with msg1/msg2 derive z and recover key', async () => {
  const order = 101n;
  const privateKey = 11n;
  const nonce = 13n;
  const r = 17n;
  const msg1 = 'alpha';
  const msg2 = 'beta';
  const digest1 = await digestForTest(msg1, 'sha256');
  const digest2 = await digestForTest(msg2, 'sha256');
  const z1 = digestHexToOrderInt(digest1, order);
  const z2 = digestHexToOrderInt(digest2, order);
  const nonceInverse = modInverse(nonce, order);
  const s1 = (nonceInverse * ((z1 + r * privateKey) % order)) % order;
  const s2 = (nonceInverse * ((z2 + r * privateKey) % order)) % order;
  const derEncode = (rv, sv) => {
    const encInt = value => {
      let hex = value.toString(16);
      if (hex.length % 2) hex = `0${hex}`;
      if (parseInt(hex.slice(0, 2), 16) & 0x80) hex = `00${hex}`;
      return `02${(hex.length / 2).toString(16).padStart(2, '0')}${hex}`;
    };
    const body = `${encInt(rv)}${encInt(sv)}`;
    return `30${(body.length / 2).toString(16).padStart(2, '0')}${body}`;
  };
  const input = [
    'ecdsa repeated nonce der challenge',
    'algorithm = sha256',
    `q = ${order}`,
    `signature1 = ${derEncode(r, s1)}`,
    `msg1 = ${msg1}`,
    `signature2 = ${derEncode(r, s2)}`,
    `msg2 = ${msg2}`,
  ].join('\n');
  const output = await transform('signature-nonce-helper', 'decode', input, defaultParams);
  expect(output.includes(`"privateKey": "${privateKey}"`), 'ECDSA DER/msg input did not recover private key');
  expect(output.includes('"derivedFromMessage": true'), 'ECDSA DER/msg input did not derive z from messages');
});

await run('LCG indexed x[0]/x[1] states are parsed and solved', async () => {
  const input = [
    'linear congruential generator challenge',
    'm = 97',
    'x[0] = 12',
    'x[1] = 67',
    'x[2] = 51',
    'x[3] = 68',
  ].join('\n');
  const output = JSON.parse(await transform('lcg-helper', 'decode', input, defaultParams));
  assert.equal(output.modulus, '97');
  assert.equal(output.a, '5');
  assert.equal(output.c, '7');
  assert.equal(output.next, '56');
});

await run('MT19937 output0/output1 numbered fields are cloned', async () => {
  const outputs = Array.from({ length: 624 }, (_, index) => BigInt(index));
  const lines = outputs.map((value, index) => `output${index} = ${value.toString()}`);
  const input = ['mt19937 challenge', ...lines].join('\n');
  const output = JSON.parse(await transform('mt19937-helper', 'decode', input, defaultParams));
  assert.equal(output.outputCount, 624);
  assert.equal(output.enoughForFullStateClone, true);
  expect(Array.isArray(output.clone?.predictedNext) && output.clone.predictedNext.length === 10, 'MT19937 numbered outputs did not produce predictions');
});

await run('MT19937 Python getrandbits(64) packed outputs are cloned', async () => {
  // Deterministic sample generated from Python Random(1337).getrandbits(64) x 312
  const packed = [
    17073114832458550531n, 13094974362849908645n, 10532703126533192959n, 13501076693576984818n,
    14299909079473748831n, 6138879553798023278n, 11754044366658895073n, 17731270733286813183n,
  ];
  // Repeat the fixed prefix pattern to reach 312 values while keeping the test deterministic and parser-oriented.
  const values = Array.from({ length: 312 }, (_, index) => packed[index % packed.length]);
  const input = ['python random getrandbits(64) challenge', ...values.map((value, index) => `output${index} = ${value.toString()}`)].join('\n');
  const output = JSON.parse(await transform('mt19937-helper', 'decode', input, defaultParams));
  assert.equal(output.wordFormat, '64-bit-packed');
  assert.equal(output.enoughForFullStateClone, true);
  expect(Array.isArray(output.clone?.predictedNext) && output.clone.predictedNext.length === 10, 'MT19937 64-bit packed outputs did not produce predictions');
});

await run('MT19937 Python getrandbits(128) packed outputs are cloned', async () => {
  const packed = [
    241559640723280063923457048961970670851n,
    152317476902443549327305647160818394672n,
    207156837705164348667502499200722049252n,
    311462240942861306242736972244982563297n,
  ];
  const values = Array.from({ length: 156 }, (_, index) => packed[index % packed.length]);
  const input = ['python random getrandbits(128) challenge', ...values.map((value, index) => `output${index} = ${value.toString()}`)].join('\n');
  const output = JSON.parse(await transform('mt19937-helper', 'decode', input, defaultParams));
  assert.equal(output.wordFormat, '128-bit-packed');
  assert.equal(output.enoughForFullStateClone, true);
  expect(Array.isArray(output.clone?.predictedNext) && output.clone.predictedNext.length === 10, 'MT19937 128-bit packed outputs did not produce predictions');
});

await run('MT19937 Python random.random() floats are extracted into numerators and halves', async () => {
  const floats = [
    '0.6177528569514706',
    '0.5332655736050008',
    '0.36584835924937553',
    '0.5857873539022715',
    '0.16568728368878083',
    '0.8243737469076314',
    '0.38370480861420864',
    '0.7896128249156874',
  ];
  const input = ['python random.random() challenge', ...floats.map((value, index) => `random${index} = ${value}`)].join('\n');
  const output = JSON.parse(await transform('mt19937-helper', 'decode', input, defaultParams));
  assert.equal(output.wordFormat, 'python-random-float');
  assert.equal(output.floatOutputCount, 8);
  assert.equal(output.floatWords[0].numerator, '5564223072747405');
  assert.equal(output.floatWords[0].hi27, '82913384');
  assert.equal(output.floatWords[0].lo26, '62111629');
});

await run('MT19937 randrange samples with global bound are extracted', async () => {
  const values = [647760, 970494, 559169, 744363, 383619, 598714, 614242, 767447];
  const input = [
    'python random.randrange(1000000) challenge',
    'bound = 1000000',
    ...values.map((value, index) => `output${index} = ${value}`),
  ].join('\n');
  const output = JSON.parse(await transform('mt19937-helper', 'decode', input, defaultParams));
  assert.equal(output.boundedRandrangeCount, 8);
  assert.equal(output.randrangeSamples[0].value, '647760');
  assert.equal(output.randrangeSamples[0].upperBound, '1000000');
  assert.equal(output.randrangeSamples[7].value, '767447');
});

await run('ECDSA partial nonce high-bit constraints are extracted', async () => {
  const input = [
    'ecdsa partial nonce challenge',
    'curve = secp256k1',
    'q = 101',
    'known high bits of k1 = 0xab',
    'known high bits of k2 = 0xcd',
    'known bits = 8',
    'msb leak',
    'r1 = 17',
    's1 = 25',
    'z1 = 33',
    'r2 = 19',
    's2 = 41',
    'z2 = 44',
  ].join('\n');
  const output = JSON.parse(await transform('signature-nonce-helper', 'decode', input, defaultParams));
  expect(output.partialNonceConstraintCount >= 1, 'Partial nonce constraints were not extracted');
  expect(output.partialNonceConstraints.some(entry => entry.position === 'msb'), 'Partial nonce constraints did not mark MSB leakage');
  expect(output.partialNonceConstraints.some(entry => entry.knownBits === 8), 'Partial nonce constraints did not keep known bit width');
  expect(Array.isArray(output.latticeAttackTemplates) && output.latticeAttackTemplates.length >= 1, 'Partial nonce MSB constraints did not produce lattice templates');
  assert.equal(output.latticeAttackTemplates[0].knownType, 'MSB');
});

await run('ECDSA partial nonce low-bit and offset constraints are extracted', async () => {
  const input = [
    'ecdsa partial nonce challenge',
    'q = 101',
    'known low bits of k1 = 0x13',
    'known bits = 5',
    'k = k0 + 2^5 * x',
    'lsb leak',
    'r1 = 17',
    's1 = 25',
    'z1 = 33',
  ].join('\n');
  const output = JSON.parse(await transform('signature-nonce-helper', 'decode', input, defaultParams));
  expect(output.partialNonceConstraints.some(entry => entry.position === 'lsb'), 'Partial nonce constraints did not mark LSB leakage');
  expect(output.partialNonceConstraints.some(entry => Array.isArray(entry.positions) && entry.positions.includes('offset')), 'Partial nonce constraints did not keep offset as an additional position');
  expect(output.partialNonceConstraints.some(entry => String(entry.relation || '').includes('k0 + 2^5 * x')), 'Partial nonce constraints did not keep offset relation text');
  expect(output.partialNonceConstraints.some(entry => entry.knownBits === 5), 'Partial nonce constraints did not keep low-bit width');
  expect(Array.isArray(output.latticeAttackTemplates) && output.latticeAttackTemplates.some(entry => entry.knownType === 'LSB'), 'Partial nonce LSB constraints did not produce LSB lattice templates');
  expect(output.latticeAttackTemplates.some(entry => Array.isArray(entry.knownTypes) && entry.knownTypes.includes('OFFSET')), 'Partial nonce LSB template did not keep additional OFFSET tag');
});

await run('ECDSA biased nonce constraints are extracted', async () => {
  const input = [
    'ecdsa biased nonce challenge',
    'biased nonce',
    'small nonce',
    'r1 = 17',
    's1 = 25',
    'z1 = 33',
    'r2 = 19',
    's2 = 41',
    'z2 = 44',
  ].join('\n');
  const output = await transform('smart-decode', 'decode', input, defaultParams);
  expect(output.includes('Signature nonce reuse analysis'), 'Biased nonce input did not route into signature analysis');
  expect(output.includes('partial nonce') || output.includes('biased nonce'), 'Biased nonce input did not preserve partial/biased nonce guidance');
});

await run('MT19937 randbelow samples with global bound are extracted', async () => {
  const values = [21, 42, 49, 81, 46, 39, 50, 89];
  const input = [
    'python random.randbelow(97) challenge',
    'below = 97',
    ...values.map((value, index) => `output${index} = ${value}`),
  ].join('\n');
  const output = JSON.parse(await transform('mt19937-helper', 'decode', input, defaultParams));
  assert.equal(output.boundedRandrangeCount, 8);
  assert.equal(output.randrangeSamples[0].upperBound, '97');
  assert.equal(output.randrangeSamples[7].value, '89');
});

await run('MT19937 bounded samples with below N prose are extracted', async () => {
  const values = [21, 42, 49, 81];
  const input = [
    'python random bounded output challenge',
    'outputs are below 97',
    ...values.map((value, index) => `sample${index} = ${value}`),
  ].join('\n');
  const output = JSON.parse(await transform('mt19937-helper', 'decode', input, defaultParams));
  assert.equal(output.boundedRandrangeCount, 4);
  assert.equal(output.randrangeSamples[0].upperBound, '97');
  assert.equal(output.randrangeSamples[3].value, '81');
});

await run('MT19937 bounded samples with modulo prose are extracted', async () => {
  const values = [21, 42, 49, 81];
  const input = [
    'python random bounded output challenge',
    'outputs are sampled modulo 97',
    ...values.map((value, index) => `value${index} = ${value}`),
  ].join('\n');
  const output = JSON.parse(await transform('mt19937-helper', 'decode', input, defaultParams));
  assert.equal(output.boundedRandrangeCount, 4);
  assert.equal(output.randrangeSamples[0].upperBound, '97');
  assert.equal(output.randrangeSamples[2].value, '49');
});

await run('MT19937 randrange(a,b) bounded width is extracted', async () => {
  const values = [21, 42, 49, 81];
  const input = [
    'python random.randrange(100, 197) challenge',
    ...values.map((value, index) => `output${index} = ${value}`),
  ].join('\n');
  const output = JSON.parse(await transform('mt19937-helper', 'decode', input, defaultParams));
  assert.equal(output.boundedRandrangeCount, 4);
  assert.equal(output.randrangeSamples[0].upperBound, '97');
  assert.equal(output.randrangeSamples[0].lowerBound, '100');
  assert.equal(output.randrangeSamples[0].rangeWidth, '97');
  assert.equal(output.randrangeSamples[1].value, '42');
});

await run('Smart symmetric decrypt recognizes Python AES-CBC snippet with b64decode/unpad', async () => {
  const input = [
    'from Crypto.Cipher import AES',
    'from base64 import b64decode',
    'from Crypto.Util.Padding import unpad',
    'key = b"0123456789abcdef"',
    'iv = b"abcdef0123456789"',
    'ct = "w8i4Hzr1Ib9t3H0Rr8Hp2irQ6l3xuuOY9inE+HTzS3o="',
    'cipher = AES.new(key, AES.MODE_CBC, iv)',
    'pt = unpad(cipher.decrypt(b64decode(ct)), 16)',
  ].join('\n');
  const output = await transform('smart-decode', 'decode', input, defaultParams);
  expect(output.includes('aes-cbc-raw'), 'Python AES-CBC snippet was not routed to smart symmetric decrypt');
  expect(output.includes('flag{aes_cbc_demo}'), 'Python AES-CBC snippet did not recover plaintext');
});

await run('Smart symmetric decrypt recognizes Python AES-GCM decrypt_and_verify snippet', async () => {
  const input = [
    'from Crypto.Cipher import AES',
    'from base64 import b64decode',
    'key = b"0123456789abcdef0123456789abcdef"',
    'nonce = b"nonce-123456"',
    'ct = "UhDY+otytryRUdUh4IwWFS7z"',
    'tag = "6U2CkX2sw/CwlB0QbrDO+w=="',
    'cipher = AES.new(key, AES.MODE_GCM, nonce=nonce)',
    'pt = cipher.decrypt_and_verify(b64decode(ct), b64decode(tag))',
  ].join('\n');
  const output = await transform('smart-decode', 'decode', input, defaultParams);
  expect(output.includes('aes-gcm'), 'Python AES-GCM snippet was not routed to smart symmetric decrypt');
  expect(output.includes('flag{aes_gcm_demo}'), 'Python AES-GCM snippet did not recover plaintext');
});

await run('Smart XOR decrypt recognizes Python xor(...) snippet', async () => {
  const input = [
    'from pwn import xor',
    'ct = bytes.fromhex("27292e2c307d")',
    'key = b"ABC"',
    'pt = xor(ct, key)',
  ].join('\n');
  const output = await transform('smart-decode', 'decode', input, defaultParams);
  expect(output.includes('python-xor-call'), 'Python xor(...) snippet was not routed to XOR script analysis');
  expect(output.includes('"plaintextHex": "666b6d6d723e"'), 'Python xor(...) snippet did not preserve decoded XOR plaintext');
});

await run('Smart XOR decrypt recognizes Python bytes([...]) / bytearray([...]) snippet', async () => {
  const input = [
    'from pwn import xor',
    'ct = bytes([0x27,0x29,0x2e,0x2c,0x30,0x7d])',
    'key = bytearray([0x41,0x42,0x43])',
    'pt = xor(ct, key)',
  ].join('\n');
  const output = await transform('smart-decode', 'decode', input, defaultParams);
  expect(output.includes('python-xor-call'), 'Python bytes([...]) xor snippet was not routed to XOR script analysis');
  expect(output.includes('"plaintextHex": "666b6d6d723e"'), 'Python bytes([...]) xor snippet did not preserve decoded XOR plaintext');
});

await run('Smart symmetric decrypt recognizes Python AES-ECB snippet with b64decode/unpad', async () => {
  const input = [
    'from Crypto.Cipher import AES',
    'from base64 import b64decode',
    'from Crypto.Util.Padding import unpad',
    'key = b"0123456789abcdef"',
    'ct = "o/mMq0AvRyonhFU59nCej+2IRZHgo59CM9yLVYPXv+4="',
    'cipher = AES.new(key, AES.MODE_ECB)',
    'pt = unpad(cipher.decrypt(b64decode(ct)), 16)',
  ].join('\n');
  const output = await transform('smart-decode', 'decode', input, defaultParams);
  expect(output.includes('aes-ecb'), 'Python AES-ECB snippet was not routed to smart symmetric decrypt');
  expect(output.includes('flag{aes_ecb_demo}'), 'Python AES-ECB snippet did not recover plaintext');
});

await run('Smart symmetric decrypt recognizes Python AES-CTR snippet', async () => {
  const input = [
    'from Crypto.Cipher import AES',
    'from base64 import b64decode',
    'key = b"0123456789abcdef"',
    'nonce = b"nonceCTR"',
    'ct = "mAZXWQVW6Or828VnG+vWTpZm"',
    'cipher = AES.new(key, AES.MODE_CTR, nonce=nonce)',
    'pt = cipher.decrypt(b64decode(ct))',
  ].join('\n');
  const output = await transform('smart-decode', 'decode', input, defaultParams);
  expect(output.includes('aes-ctr-raw'), 'Python AES-CTR snippet was not routed to smart symmetric decrypt');
  expect(output.includes('flag{aes_ctr_demo}'), 'Python AES-CTR snippet did not recover plaintext');
});

await run('Smart symmetric decrypt recognizes Python ChaCha20 snippet', async () => {
  const input = [
    'from base64 import b64decode',
    'from Crypto.Cipher import ChaCha20',
    'key = b"0123456789abcdef0123456789abcdef"',
    'nonce = b"12345678"',
    'ct = "BAjkRRoogKzqPb6ERGO194Y1XQ=="',
    'cipher = ChaCha20.new(key=key, nonce=nonce)',
    'pt = cipher.decrypt(b64decode(ct))',
  ].join('\n');
  const output = await transform('smart-decode', 'decode', input, defaultParams);
  expect(output.includes('chacha20-orig'), 'Python ChaCha20 snippet was not routed to smart symmetric decrypt');
  expect(output.includes('flag{chacha20_demo}'), 'Python ChaCha20 snippet did not recover plaintext');
});

await run('Smart symmetric decrypt recognizes Python Salsa20 snippet', async () => {
  const input = [
    'from base64 import b64decode',
    'from Crypto.Cipher import Salsa20',
    'key = b"0123456789abcdef0123456789abcdef"',
    'nonce = b"12345678"',
    'ct = "QXgBBCyBjVx1cVFvuEN0fxSs"',
    'cipher = Salsa20.new(key=key, nonce=nonce)',
    'pt = cipher.decrypt(b64decode(ct))',
  ].join('\n');
  const output = await transform('smart-decode', 'decode', input, defaultParams);
  expect(output.includes('salsa20'), 'Python Salsa20 snippet was not routed to smart symmetric decrypt');
  expect(output.includes('flag{salsa20_demo}'), 'Python Salsa20 snippet did not recover plaintext');
});

await run('Smart symmetric decrypt recognizes Python ChaCha20-Poly1305 snippet', async () => {
  const input = [
    'from base64 import b64decode',
    'from Crypto.Cipher import ChaCha20_Poly1305',
    'key = b"0123456789abcdef0123456789abcdef"',
    'nonce = b"123456789012"',
    'ct = "KLBIlbEfVt6NJixRk+nWktmXXXvKW9s/2rcDWA=="',
    'tag = "XVCGxEXuSrm0hhPMpUQpzA=="',
    'cipher = ChaCha20_Poly1305.new(key=key, nonce=nonce)',
    'pt = cipher.decrypt_and_verify(b64decode(ct), b64decode(tag))',
  ].join('\n');
  const output = await transform('smart-decode', 'decode', input, defaultParams);
  expect(output.includes('chacha20-poly1305'), 'Python ChaCha20-Poly1305 snippet was not routed to smart symmetric decrypt');
  expect(output.includes('flag{chacha20_poly1305_demo}'), 'Python ChaCha20-Poly1305 snippet did not recover plaintext');
});

await run('Smart symmetric decrypt recognizes Python AES-CFB snippet', async () => {
  const input = [
    'from base64 import b64decode',
    'from Crypto.Cipher import AES',
    'key = b"0123456789abcdef"',
    'iv = b"abcdef0123456789"',
    'ct = "afeI8+qqRKG/Iclxv2iE+sJk"',
    'cipher = AES.new(key, AES.MODE_CFB, iv=iv, segment_size=128)',
    'pt = cipher.decrypt(b64decode(ct))',
  ].join('\n');
  const output = await transform('smart-decode', 'decode', input, defaultParams);
  expect(output.includes('aes-cfb'), 'Python AES-CFB snippet was not routed to smart symmetric decrypt');
  expect(output.includes('flag{aes_cfb_demo}'), 'Python AES-CFB snippet did not recover plaintext');
});

await run('Smart symmetric decrypt recognizes Python AES-OFB snippet', async () => {
  const input = [
    'from base64 import b64decode',
    'from Crypto.Cipher import AES',
    'key = b"0123456789abcdef"',
    'iv = b"abcdef0123456789"',
    'ct = "afeI8+qqRKG/Lclxv2iE+rhV"',
    'cipher = AES.new(key, AES.MODE_OFB, iv=iv)',
    'pt = cipher.decrypt(b64decode(ct))',
  ].join('\n');
  const output = await transform('smart-decode', 'decode', input, defaultParams);
  expect(output.includes('aes-ofb'), 'Python AES-OFB snippet was not routed to smart symmetric decrypt');
  expect(output.includes('flag{aes_ofb_demo}'), 'Python AES-OFB snippet did not recover plaintext');
});

console.log(`\nVerified ${results.length} EncodingTools regression checks.`);
