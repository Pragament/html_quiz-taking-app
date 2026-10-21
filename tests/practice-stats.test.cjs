const { test } = require('node:test');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const statsModule = import(pathToFileURL(path.resolve('practice-stats.js')).href);

test('statistics group checked correct/wrong answers across all six metadata fields', async () => {
    const { summarizePracticeStats } = await statsModule;
    const metadata = { topicId: 'topic1', topic: 'Listening basics', difficulty: 'Easy', skill: 'Listening', actfl_level: 'Novice Low', actfl_sublevel: 'Low', actfl_mode: 'Interpretive' };
    const questions = Array.from({ length: 4 }, () => ({ ...metadata }));
    const stats = summarizePracticeStats(questions, [{ isCorrect: true }, { isCorrect: false }, { isCorrect: null }, { isCorrect: false }], [true, true, true, false]);
    assert.deepEqual(stats.totals, { correct: 1, wrong: 1, ungraded: 1, unchecked: 1 });
    assert.equal(stats.groups.length, 6);
    for (const group of stats.groups) {
        assert.equal(group.rows[0].label, metadata[group.field]);
        assert.equal(group.rows[0].correct, 1);
        assert.equal(group.rows[0].wrong, 1);
    }
});

test('empty metadata is explicit and distinct topic IDs do not merge when their labels match', async () => {
    const { summarizePracticeStats } = await statsModule;
    const stats = summarizePracticeStats([
        { topicId: 'one', topic: 'Basics' }, { topicId: 'two', topic: 'Basics' }, {}
    ], [{ isCorrect: true }, { isCorrect: false }], [true, true]);
    const topics = stats.groups.find(group => group.field === 'topic').rows;
    assert.equal(topics.length, 3);
    assert.equal(topics.filter(row => row.label === 'Basics').length, 2);
    assert.equal(topics.find(row => row.label === 'Not specified').unchecked, 1);
    assert.equal(stats.groups.find(group => group.field === 'difficulty').rows[0].label, 'Not specified');
});

test('counts are derived from restored state and remain stable after question reordering', async () => {
    const { summarizePracticeStats } = await statsModule;
    const questions = [{ topic: 'A', difficulty: 'Hard' }, { topic: 'B', difficulty: 'Easy' }];
    const feedback = [{ isCorrect: true }, { isCorrect: false }];
    const restored = JSON.parse(JSON.stringify({ questions, feedback, shown: [true, true] }));
    const expected = summarizePracticeStats(restored.questions, restored.feedback, restored.shown);
    assert.deepEqual(summarizePracticeStats([...questions].reverse(), [...feedback].reverse(), [true, true]), expected);
    assert.deepEqual(summarizePracticeStats(questions, feedback, [true, true]), expected);
    assert.deepEqual(summarizePracticeStats(questions, [], [] ).totals, { correct: 0, wrong: 0, ungraded: 0, unchecked: 2 });
});

test('sidebar renderer escapes labels and hides statistics outside practice', async () => {
    const { summarizePracticeStats } = await statsModule;
    const nodes = new Map();
    const node = id => { if (!nodes.has(id)) nodes.set(id, {}); return nodes.get(id); };
    const classes = new Set();
    let practice = true;
    const ctx = vm.createContext({
        quiz: { questions: [{ topic: '<script>topic</script>' }], feedback: [{ isCorrect: false }], feedbackShown: [true] },
        $: node, shouldShowPracticeQuizSettings: () => practice, summarizePracticeStats,
        els: { quizView: { classList: { toggle: (name, enabled) => enabled ? classes.add(name) : classes.delete(name) } } },
        esc: value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    });
    const source = fs.readFileSync('app.js', 'utf8');
    vm.runInContext(source.slice(source.indexOf('function renderPracticeStats('), source.indexOf('function renderSelectionMemory(')), ctx);
    ctx.renderPracticeStats();
    assert.equal(node('practiceStatsSidebar').hidden, false);
    assert.match(node('practiceStatsGroups').innerHTML, /&lt;script&gt;/);
    assert.match(node('practiceStatsSummary').innerHTML, /1 wrong/);
    practice = false;
    ctx.renderPracticeStats();
    assert.equal(node('practiceStatsSidebar').hidden, true);
    assert.equal(classes.has('has-practice-stats'), false);
});
