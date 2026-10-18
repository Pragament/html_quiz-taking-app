const { test } = require('node:test');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const coach = import(pathToFileURL(path.resolve('coach.js')).href);

test('Coach words are deduplicated and limited for bounded English lookups', async () => {
    const { coachWords } = await coach;
    assert.deepEqual(coachWords('Water water FLOWS'), ['water', 'flows']);
    assert.equal(coachWords('एक शब्द').length, 0);
    assert.equal(coachWords('one two three four five six seven eight nine ten eleven twelve thirteen').length, 12);
});

test('local Sentence Formation provides a sentence starter or punctuation draft', async () => {
    const { sentenceDraft } = await coach;
    assert.equal(sentenceDraft('water'), 'I am learning about water.');
    assert.equal(sentenceDraft('water flows into the sea'), 'Water flows into the sea.');
    assert.equal(sentenceDraft('where can i find water?'), 'Where can I find water?');
    assert.equal(sentenceDraft('  '), '');
});

test('Dictionary parses meanings, pronunciation and examples with no student identity in the request', async () => {
    const { dictionaryAgent } = await coach;
    const result = await dictionaryAgent('water', null, async (url, options) => {
        assert.equal(url, 'https://api.dictionaryapi.dev/api/v2/entries/en/water');
        assert.equal(options.credentials, 'omit');
        assert.equal(options.referrerPolicy, 'no-referrer');
        return { ok: true, json: async () => [{ phonetic: '/water/', meanings: [{ partOfSpeech: 'noun', definitions: [{ definition: 'A liquid.', example: 'Drink water.' }] }] }] };
    });
    assert.equal(result.title, 'water');
    assert.ok(result.lines.includes('noun: A liquid.'));
    assert.ok(result.lines.includes('Example: Drink water.'));
});

test('Dictionary handles missing entries and rejects unsupported input before making a request', async () => {
    const { dictionaryAgent } = await coach;
    const result = await dictionaryAgent('unknown', null, async () => ({ status: 404 }));
    assert.match(result.lines[0], /No dictionary entry/);
    await assert.rejects(dictionaryAgent('दो शब्द', null, () => { throw new Error('Should not fetch'); }), /English word/);
});

test('Spelling distinguishes exact vocabulary matches from suggestions without silently replacing words', async () => {
    const { spellingAgent } = await coach;
    const result = await spellingAgent('water wter', null, async url => ({ ok: true, json: async () => url.includes('sp=water&') ? [{ word: 'water' }] : [{ word: 'water' }, { word: 'wetter' }] }));
    assert.match(result.lines[0], /water: found/);
    assert.match(result.lines[1], /wter: possible alternatives/);
    assert.match(result.lines.at(-1), /not automatic corrections/);
});

test('lookup failures are surfaced instead of being reported as correct spelling', async () => {
    const { spellingAgent, coachJson } = await coach;
    await assert.rejects(spellingAgent('water', null, async () => ({ ok: false, status: 503 })), /unavailable/);
    await assert.rejects(coachJson('https://example.com', AbortSignal.abort(), async (url, { signal }) => {
        assert.equal(signal.aborted, true);
        throw new DOMException('Cancelled', 'AbortError');
    }), { name: 'AbortError' });
});
