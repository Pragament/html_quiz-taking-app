const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('app.js', 'utf8');

async function setup() {
    const records = new Map();
    const panel = { innerHTML: '' };
    const question = { id: 'question1', type: 'mcq', options: [{ html: '<b>First</b>' }, { html: 'Second' }] };
    const answer = { selectedOptions: [1] };
    const ctx = vm.createContext({
        quiz: { questions: [question], answers: [answer] }, currentIndex: 0,
        studentProfile: { authUid: 'student1' }, questionReactions: new Map(),
        session: { classroomId: 'quiz-session-1' },
        $: () => panel, db: {}, COLLECTIONS: { reactions: 'qb_reactions_v1' },
        doc: (db, collection, id) => { assert.equal(collection, 'qb_reactions_v1'); return id; },
        getDoc: async id => { if (ctx.failRead) throw new Error('Offline'); return { exists: () => records.has(id), data: () => records.get(id) }; },
        setDoc: async (id, data) => { if (ctx.failWrite) throw new Error('Offline'); records.set(id, data); },
        serverTimestamp: () => 'server-timestamp', saveCurrentAnswer: () => { ctx.answerCaptured = true; },
        questionDisplayOptions: q => q.options.map(option => option.html),
        stripHtml: value => value.replace(/<[^>]*>/g, ''),
        esc: value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    });
    vm.runInContext(source.slice(source.indexOf('function currentReactionKey('), source.indexOf('function isPracticeDraft(')), ctx);
    ctx.renderQuestionReaction();
    await new Promise(resolve => setImmediate(resolve));
    return { ctx, records, panel, question, answer, reaction: () => ctx.questionReactions.get(ctx.currentReactionKey()) };
}

test('Like/Dislike prefills from selected answers and writes only when Save Feedback is clicked', async () => {
    const h = await setup();
    h.ctx.chooseQuestionReaction('like');
    assert.equal(h.reaction().comment, 'My answer(s):\nB. Second');
    assert.equal(h.records.size, 0);
    await h.ctx.saveQuestionReaction();
    const record = h.records.get('question1__student1');
    assert.equal(record.userId, 'student1');
    assert.equal(record.questionId, 'question1');
    assert.equal(record.value, 'like');
    assert.equal(record.comment, 'My answer(s):\nB. Second');
    assert.equal(record.updatedAt, 'server-timestamp');
    assert.equal(record.sourceType, 'quiz-session');
    assert.equal(record.sourceValue, 'quiz-session-1');
    assert.equal(h.reaction().saved, true);
});

test('source tracks the latest assigned session or homepage practice without duplicating the reaction', async () => {
    const h = await setup();
    h.ctx.chooseQuestionReaction('like');
    await h.ctx.saveQuestionReaction();
    h.ctx.session = { classroomId: 'quiz-session-2' };
    await h.ctx.saveQuestionReaction();
    assert.equal(h.records.get('question1__student1').sourceValue, 'quiz-session-2');
    h.ctx.session = { localPractice: true, classroom: { mode: 'practice' } };
    await h.ctx.saveQuestionReaction();
    assert.equal(h.records.size, 1);
    assert.equal(h.records.get('question1__student1').sourceType, 'practice');
    assert.equal(h.records.get('question1__student1').sourceValue, 'homepage');
});

test('switching reaction updates one document and users can edit or remove the optional comment', async () => {
    const h = await setup();
    h.ctx.chooseQuestionReaction('like');
    h.reaction().comment = 'Please clarify this wording';
    h.reaction().commentEdited = true;
    await h.ctx.saveQuestionReaction();
    h.ctx.chooseQuestionReaction('dislike');
    assert.equal(h.reaction().comment, 'Please clarify this wording');
    h.reaction().comment = ' ';
    await h.ctx.saveQuestionReaction();
    assert.equal(h.records.size, 1);
    assert.equal(h.records.get('question1__student1').value, 'dislike');
    assert.equal(Object.hasOwn(h.records.get('question1__student1'), 'comment'), false);
});

test('prefill handles multiple choices, True/False, fill blanks, short answers and unanswered questions', async () => {
    const { ctx, question } = await setup();
    assert.equal(ctx.reactionAnswerComment(question, { selectedOptions: [0, 1] }), 'My answer(s):\nA. First\nB. Second');
    assert.equal(ctx.reactionAnswerComment({ type: 'true_false' }, { trueFalseAnswer: false }), 'My answer(s):\nFalse');
    assert.equal(ctx.reactionAnswerComment({ type: 'true_false' }, { trueFalseAnswer: null }), '');
    assert.equal(ctx.reactionAnswerComment({ type: 'fib', fibBanks: [{ label: 'City' }, {}] }, { fibAnswers: ['Delhi', 'India'] }), 'My answer(s):\nCity: Delhi\nBlank 2: India');
    assert.equal(ctx.reactionAnswerComment({ type: 'short_answer', shortAnswerHtml: 'Expected answer' }, { shortAnswer: 'My own answer' }), 'My answer(s):\nMy own answer');
    assert.equal(ctx.reactionAnswerComment(question, { selectedOptions: [] }), '');
    assert.equal(ctx.reactionAnswerComment({ type: 'short_answer' }, { shortAnswer: 'x'.repeat(3000) }).length, 2000);
});

test('the latest answers are captured at save without replacing an explicitly edited comment', async () => {
    const h = await setup();
    h.ctx.chooseQuestionReaction('like');
    h.answer.selectedOptions = [0];
    await h.ctx.saveQuestionReaction();
    assert.equal(h.records.get('question1__student1').comment, 'My answer(s):\nA. First');
});

test('saved reactions load across sessions and error retries keep edits intact', async () => {
    const h = await setup();
    h.ctx.chooseQuestionReaction('dislike');
    h.reaction().comment = '<script>literal feedback</script>';
    h.reaction().commentEdited = true;
    h.ctx.failWrite = true;
    await h.ctx.saveQuestionReaction();
    assert.equal(h.records.size, 0);
    assert.equal(h.reaction().saved, false);
    assert.match(h.panel.innerHTML, /&lt;script&gt;/);
    assert.doesNotMatch(h.panel.innerHTML, /<script>/);
    h.ctx.failWrite = false;
    await h.ctx.saveQuestionReaction();
    h.ctx.questionReactions.clear();
    h.ctx.renderQuestionReaction();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(h.reaction().value, 'dislike');
    assert.equal(h.reaction().comment, '<script>literal feedback</script>');
    assert.equal(h.reaction().saved, true);
});

test('failed reads prevent overwrites until reload and switching users isolates cached reactions', async () => {
    const h = await setup();
    h.ctx.questionReactions.clear();
    h.ctx.failRead = true;
    h.ctx.renderQuestionReaction();
    await new Promise(resolve => setImmediate(resolve));
    h.ctx.chooseQuestionReaction('like');
    await h.ctx.saveQuestionReaction();
    assert.equal(h.records.size, 0);
    assert.equal(h.reaction().loadFailed, true);
    h.ctx.failRead = false;
    h.ctx.studentProfile = { authUid: 'student2' };
    h.ctx.renderQuestionReaction();
    await new Promise(resolve => setImmediate(resolve));
    h.ctx.chooseQuestionReaction('like');
    await h.ctx.saveQuestionReaction();
    assert.equal(h.records.get('question1__student2').userId, 'student2');
    assert.equal(h.records.has('question1__student1'), false);
});
