import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const publicDirectory = new URL('../public/', import.meta.url);
const html = await readFile(new URL('index.html', publicDirectory), 'utf8');
const pt = JSON.parse(
  await readFile(new URL('assets/i18n/pt.json', publicDirectory), 'utf8')
);
const en = JSON.parse(
  await readFile(new URL('assets/i18n/en.json', publicDirectory), 'utf8')
);

const usedKeys = new Set();

for (const match of html.matchAll(/\bdata-i18n(?:-html)?="([^"]+)"/g)) {
  usedKeys.add(match[1]);
}

for (const match of html.matchAll(/\bdata-i18n-attr="[^":]+:([^"]+)"/g)) {
  usedKeys.add(match[1]);
}

const ptKeys = Object.keys(pt).sort();
const enKeys = Object.keys(en).sort();

assert.deepEqual(
  ptKeys,
  enKeys,
  'pt.json e en.json devem ter exatamente as mesmas chaves'
);

for (const key of usedKeys) {
  assert.ok(
    Object.prototype.hasOwnProperty.call(pt, key),
    `chave usada no HTML ausente em pt.json: ${key}`
  );
  assert.ok(
    Object.prototype.hasOwnProperty.call(en, key),
    `chave usada no HTML ausente em en.json: ${key}`
  );
}

for (const language of [
  ['pt', pt],
  ['en', en]
]) {
  const [name, dictionary] = language;
  for (const [key, value] of Object.entries(dictionary)) {
    assert.equal(typeof value, 'string', `${name}.${key} deve ser texto`);
    assert.notEqual(value.trim(), '', `${name}.${key} nao pode estar vazio`);
  }
}

console.log(
  `i18n: ${usedKeys.size} chaves usadas no HTML, ${ptKeys.length} por idioma`
);
console.log('ok - paridade, cobertura e valores nao vazios');
