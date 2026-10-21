export function collectPracticeMistakes(quiz) {
    return (quiz?.questions || []).flatMap((question, index) => {
        const answer = quiz.answers?.[index];
        const feedback = quiz.feedback?.[index];
        if (!quiz.feedbackShown?.[index] || feedback?.isCorrect !== false || !answer) return [];
        const nonempty = question.type === 'fib'
            ? (answer.fibAnswers || []).some(value => String(value ?? '').trim())
            : question.type === 'short_answer' && String(answer.shortAnswer ?? '').trim();
        return nonempty ? [{ question, answer, feedback, index }] : [];
    });
}

export function sortPracticeMistakes(rows, order, feedbackPoints) {
    const sorted = [...rows];
    if (!['score-asc', 'score-desc'].includes(order)) return sorted.sort((a, b) => a.index - b.index);
    const ratio = row => {
        const points = feedbackPoints(row.feedback);
        const scored = Number(points.scored);
        const max = Number(points.max);
        return Number.isFinite(scored) && Number.isFinite(max) && max > 0 ? scored / max : null;
    };
    return sorted.sort((a, b) => {
        const left = ratio(a), right = ratio(b);
        if (left === null || right === null) return left === right ? a.index - b.index : left === null ? 1 : -1;
        return (order === 'score-asc' ? left - right : right - left) || a.index - b.index;
    });
}

export function initializePracticeMistakeReview({ isVisible, getAttempt, sanitizeRich, esc, renderRich, feedbackPoints, formatPoints, correctAnswerText, questionPromptText }) {
    const root = document.getElementById('practiceMistakeSidebar');
    const body = document.getElementById('practiceMistakeBody');
    const toggle = document.getElementById('practiceMistakeToggle');
    const content = document.getElementById('practiceMistakeContent');
    const count = document.getElementById('practiceMistakeCount');
    const layout = document.getElementById('quizView');
    const cardsButton = document.getElementById('practiceMistakeCards');
    const tableButton = document.getElementById('practiceMistakeTable');
    const sortSelect = document.getElementById('practiceMistakeSort');
    let view = 'cards';
    let expanded = false;
    let lastAttempt = null;
    let rows = [];
    const columns = ['Question', 'Student answer', 'Score', 'Teacher correct answer', 'Explanation text'];

    function rowValues({ question, answer, feedback, index }) {
        const language = answer.translationLanguage || '';
        const student = question.type === 'fib'
            ? Array.from({ length: Math.max(question.fibBanks?.length || 0, answer.fibAnswers?.length || 0) }, (_, i) => `${question.fibBanks?.[i]?.label || `Blank ${i + 1}`}: ${String(answer.fibAnswers?.[i] ?? '').trim() || '—'}`).join('\n')
            : String(answer.shortAnswer ?? '');
        const points = feedbackPoints(feedback);
        return [
            `<strong>Question ${index + 1} · ${question.type === 'fib' ? 'Fill in the Blank' : 'Short Answer'}</strong><div class="rich-content">${sanitizeRich(feedback.promptHtml || questionPromptText(question, language))}</div>`,
            `<span class="practice-mistake-value">${esc(student)}</span>`,
            `<span class="practice-stat-wrong">${formatPoints(points.scored)}/${formatPoints(points.max)}</span>`,
            `<span class="practice-mistake-value">${esc(feedback.correctAnswer || correctAnswerText(question, language) || 'Not provided')}</span>`,
            `<span class="practice-mistake-value">${esc(feedback.explanation || question.explanation || 'No explanation provided.')}</span>`
        ];
    }
    function renderContent() {
        const orderedRows = sortPracticeMistakes(rows, sortSelect.value, feedbackPoints);
        cardsButton.setAttribute('aria-pressed', String(view === 'cards'));
        tableButton.setAttribute('aria-pressed', String(view === 'table'));
        cardsButton.classList.toggle('primary', view === 'cards');
        tableButton.classList.toggle('primary', view === 'table');
        if (!rows.length) {
            content.innerHTML = '<p class="practice-stats-note">No incorrect answered FIB or short-answer questions yet. Skipped, empty, correct, and ungraded responses are excluded.</p>';
            return;
        }
        content.innerHTML = view === 'cards'
            ? `<div class="practice-mistake-cards">${orderedRows.map(row => {
                const values = rowValues(row);
                return `<article class="practice-mistake-card"><h3>Question</h3>${values[0]}<dl>${columns.slice(1).map((column, i) => `<div><dt>${column}</dt><dd>${values[i + 1]}</dd></div>`).join('')}</dl></article>`;
            }).join('')}</div>`
            : `<div class="practice-mistake-table-scroll" tabindex="0" role="region" aria-label="Incorrect answer table, scroll horizontally for all columns"><table class="practice-mistake-table"><caption>Incorrect answered FIB and short-answer questions</caption><thead><tr>${columns.map(column => `<th scope="col">${column}</th>`).join('')}</tr></thead><tbody>${orderedRows.map(row => `<tr>${rowValues(row).map(value => `<td>${value}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
        renderRich(content);
    }
    function render() {
        root.hidden = !isVisible();
        if (root.hidden) { layout.classList.remove('practice-review-open'); content.replaceChildren(); return; }
        const quiz = getAttempt();
        if (lastAttempt !== quiz) { view = 'cards'; sortSelect.value = 'question'; expanded = false; lastAttempt = quiz; }
        rows = collectPracticeMistakes(quiz);
        toggle.textContent = `${expanded ? 'Hide' : 'Review'} mistakes (${rows.length})`;
        toggle.setAttribute('aria-expanded', String(expanded));
        body.hidden = !expanded;
        layout.classList.toggle('practice-review-open', expanded);
        count.textContent = `${rows.length} incorrect answered question${rows.length === 1 ? '' : 's'}`;
        if (expanded) renderContent();
    }
    toggle.addEventListener('click', () => { if (!isVisible()) return; expanded = !expanded; render(); });
    cardsButton.addEventListener('click', () => { view = 'cards'; if (isVisible()) renderContent(); });
    tableButton.addEventListener('click', () => { view = 'table'; if (isVisible()) renderContent(); });
    sortSelect.addEventListener('change', () => { if (isVisible()) renderContent(); });
    new MutationObserver(render).observe(layout, { attributes: true, attributeFilter: ['hidden'] });
    render();
    return { render };
}
