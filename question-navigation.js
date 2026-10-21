export const QUESTION_STATES = {
    unanswered: 'Not answered', answered: 'Answered, not checked', correct: 'Correct', wrong: 'Incorrect', ungraded: 'Checked, ungraded'
};

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
    let lastIndex = -1;
    let lastAttempt = null;
    function render() {
        root.hidden = !isVisible();
        if (root.hidden) { lastIndex = -1; return; }
        const quiz = getAttempt();
        const current = getIndex();
        const busy = isBusy();
        const focused = track.contains(document.activeElement);
        const scrollLeft = track.scrollLeft;
        const buttons = quiz.questions.map((question, index) => {
            const state = practiceQuestionState(quiz, index, isAnswered);
            const button = document.createElement('button');
            button.type = 'button';
            button.className = `practice-question-number question-${state}${index === current ? ' is-current' : ''}`;
            button.textContent = String(index + 1);
            button.dataset.practiceQuestion = String(index);
            button.setAttribute('aria-label', `Question ${index + 1}: ${QUESTION_STATES[state]}${index === current ? ', current question' : ''}`);
            button.title = `Question ${index + 1}: ${QUESTION_STATES[state]}`;
            button.tabIndex = index === current ? 0 : -1;
            if (index === current) button.setAttribute('aria-current', 'step');
            button.disabled = busy;
            return button;
        });
        track.replaceChildren(...buttons);
        track.scrollLeft = scrollLeft;
        if (focused && !busy) buttons[current]?.focus({ preventScroll: true });
        if (current !== lastIndex || lastAttempt !== quiz || focused) {
            const button = buttons[current];
            if (button) {
                const left = button.offsetLeft - track.offsetLeft;
                if (left < track.scrollLeft) track.scrollLeft = left;
                else if (left + button.offsetWidth > track.scrollLeft + track.clientWidth) track.scrollLeft = left + button.offsetWidth - track.clientWidth;
            }
        }
        previous.disabled = next.disabled = quiz.questions.length < 2;
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
