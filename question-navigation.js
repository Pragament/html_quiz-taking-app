export const QUESTION_STATES = {
    unanswered: 'Not answered', answered: 'Answered, not checked', correct: 'Correct', wrong: 'Incorrect', ungraded: 'Checked, ungraded'
};

export const QUESTION_FILTER_FIELDS = [
    { field: 'difficulty', label: 'Difficulty' },
    { field: 'skill', label: 'Skill' },
    { field: 'actfl_level', label: 'ACTFL level' },
    { field: 'actfl_sublevel', label: 'ACTFL sublevel' },
    { field: 'actfl_mode', label: 'ACTFL mode' }
];

export function practiceQuestionFilterOptions(questions, field) {
    return [...new Set(questions.map(question => String(question[field] || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

export function filteredPracticeQuestionIndices(questions, filters = {}) {
    return questions.flatMap((question, index) => QUESTION_FILTER_FIELDS.every(({ field }) => !filters[field] || String(question[field] || '').trim() === filters[field]) ? [index] : []);
}

export function practiceQuestionState(quiz, index, isAnswered) {
    if (quiz.feedbackShown?.[index] && quiz.feedback?.[index]) {
        const result = quiz.feedback[index].isCorrect;
        return result === true ? 'correct' : result === false ? 'wrong' : 'ungraded';
    }
    return isAnswered(quiz.questions[index], quiz.answers[index]) ? 'answered' : 'unanswered';
}

export function initializePracticeQuestionNavigation({ isVisible, getAttempt, getIndex, isAnswered, isBusy, onJump }) {
    const root = document.getElementById('practiceQuestionNavigation');
    const track = document.getElementById('practiceQuestionTrack');
    const previous = document.getElementById('practiceQuestionScrollBack');
    const next = document.getElementById('practiceQuestionScrollForward');
    const skip = document.getElementById('skipQuestionBtn');
    const filterContainer = document.getElementById('practiceQuestionFilters');
    const resetFilters = document.getElementById('practiceQuestionClearFilters');
    const filterSummary = document.getElementById('practiceQuestionFilterSummary');
    let filters = {};
    const selects = new Map();
    for (const { field, label: text } of QUESTION_FILTER_FIELDS) {
        const label = document.createElement('label');
        label.className = 'field';
        const caption = document.createElement('span');
        caption.textContent = text;
        const select = document.createElement('select');
        select.id = `practiceQuestionFilter-${field}`;
        select.addEventListener('change', () => {
            filters[field] = select.value;
            lastIndex = -1;
            track.scrollLeft = 0;
            render();
        });
        label.append(caption, select);
        filterContainer.append(label);
        selects.set(field, select);
    }
    resetFilters.addEventListener('click', () => {
        filters = {};
        lastIndex = -1;
        track.scrollLeft = 0;
        render();
    });
    let lastIndex = -1;
    let lastAttempt = null;
    function render() {
        root.hidden = !isVisible();
        skip.hidden = root.hidden;
        if (root.hidden) { lastIndex = -1; return; }
        const quiz = getAttempt();
        if (lastAttempt !== quiz) filters = {};
        for (const { field } of QUESTION_FILTER_FIELDS) {
            const select = selects.get(field);
            const values = practiceQuestionFilterOptions(quiz.questions, field);
            const signature = JSON.stringify(values);
            if (select.dataset.options !== signature) {
                select.replaceChildren();
                const all = document.createElement('option');
                all.value = '';
                all.textContent = 'All';
                select.append(all);
                for (const value of values) {
                    const option = document.createElement('option');
                    option.value = value;
                    option.textContent = value;
                    select.append(option);
                }
                select.dataset.options = signature;
            }
            select.value = filters[field] || '';
            select.disabled = !values.length;
        }
        resetFilters.disabled = !Object.values(filters).some(Boolean);
        const current = getIndex();
        const visibleIndices = filteredPracticeQuestionIndices(quiz.questions, filters);
        const focusIndex = visibleIndices.includes(current) ? current : visibleIndices[0];
        filterSummary.textContent = `${visibleIndices.length} of ${quiz.questions.length} question numbers shown.${visibleIndices.includes(current) ? '' : ` Current question ${current + 1} is outside these filters.`}`;
        const busy = isBusy();
        skip.disabled = busy || quiz.questions.length < 2;
        skip.title = quiz.questions.length < 2 ? 'This attempt has only one question.' : 'Move on without checking this answer. Your draft is kept.';
        const focused = track.contains(document.activeElement);
        const scrollLeft = track.scrollLeft;
        const buttons = visibleIndices.map(index => {
            const state = practiceQuestionState(quiz, index, isAnswered);
            const button = document.createElement('button');
            button.type = 'button';
            button.className = `practice-question-number question-${state}${index === current ? ' is-current' : ''}`;
            button.textContent = String(index + 1);
            button.dataset.practiceQuestion = String(index);
            button.setAttribute('aria-label', `Question ${index + 1}: ${QUESTION_STATES[state]}${index === current ? ', current question' : ''}`);
            button.title = `Question ${index + 1}: ${QUESTION_STATES[state]}`;
            button.tabIndex = index === focusIndex ? 0 : -1;
            if (index === current) button.setAttribute('aria-current', 'step');
            button.disabled = busy;
            return button;
        });
        track.replaceChildren(...buttons);
        if (!buttons.length) {
            const message = document.createElement('span');
            message.className = 'practice-question-empty';
            message.textContent = 'No questions match. Change or clear the filters.';
            track.append(message);
        }
        track.scrollLeft = scrollLeft;
        const currentButton = buttons.find(button => Number(button.dataset.practiceQuestion) === focusIndex);
        if (focused && !busy) currentButton?.focus({ preventScroll: true });
        if (current !== lastIndex || lastAttempt !== quiz || focused) {
            const button = currentButton;
            if (button) {
                const left = button.offsetLeft - track.offsetLeft;
                if (left < track.scrollLeft) track.scrollLeft = left;
                else if (left + button.offsetWidth > track.scrollLeft + track.clientWidth) track.scrollLeft = left + button.offsetWidth - track.clientWidth;
            }
        }
        previous.disabled = next.disabled = visibleIndices.length < 2;
        lastIndex = current;
        lastAttempt = quiz;
    }
    track.addEventListener('click', event => {
        const button = event.target.closest('[data-practice-question]');
        if (button && isVisible() && !isBusy()) onJump(Number(button.dataset.practiceQuestion));
    });
    track.addEventListener('keydown', event => {
        if (!isVisible() || isBusy()) return;
        const buttons = [...track.querySelectorAll('[data-practice-question]')];
        const focused = buttons.indexOf(document.activeElement);
        if (focused < 0 || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const index = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : Math.max(0, Math.min(buttons.length - 1, focused + (event.key === 'ArrowRight' ? 1 : -1)));
        buttons[index].focus({ preventScroll: true });
        const button = buttons[index];
        const left = button.offsetLeft - track.offsetLeft;
        if (left < track.scrollLeft) track.scrollLeft = left;
        else if (left + button.offsetWidth > track.scrollLeft + track.clientWidth) track.scrollLeft = left + button.offsetWidth - track.clientWidth;
    });
    previous.addEventListener('click', () => track.scrollBy({ left: -Math.max(120, track.clientWidth * .75), behavior: 'smooth' }));
    next.addEventListener('click', () => track.scrollBy({ left: Math.max(120, track.clientWidth * .75), behavior: 'smooth' }));
    new MutationObserver(render).observe(document.getElementById('quizView'), { attributes: true, attributeFilter: ['hidden'] });
    render();
    return { render };
}
