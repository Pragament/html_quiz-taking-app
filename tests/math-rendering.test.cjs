const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ctx = vm.createContext({});
vm.runInContext(fs.readFileSync('math-rendering.js', 'utf8').replaceAll('export function', 'function'), ctx);
const parts = text => JSON.parse(JSON.stringify(ctx.splitBareMath(text)));

test('bare option math preserves the degree value and renders the summation', () => {
    assert.deepEqual(parts(String.raw`60° \sum_{i=1}^{n} i`), [
        { text: '60° ', math: false }, { text: String.raw`\sum_{i=1}^{n} i`, math: true }
    ]);
});
test('nested math groups and multiple expressions preserve surrounding prose', () => {
    assert.deepEqual(parts(String.raw`Use \frac{1}{\sqrt{4}} then \pi.`), [
        { text: 'Use ', math: false }, { text: String.raw`\frac{1}{\sqrt{4}}`, math: true },
        { text: ' then ', math: false }, { text: String.raw`\pi`, math: true }, { text: '.', math: false }
    ]);
});
test('plain text and incomplete groups remain intact', () => {
    assert.deepEqual(parts('90°'), [{ text: '90°', math: false }]);
    assert.equal(parts(String.raw`\frac{1}{2`).map(p => p.text).join(''), String.raw`\frac{1}{2`);
});
