import { initializeTours, maybePromptGuidedTour } from './tours.js';
import { auth, db } from './firebase.js';
import { doc, getDoc } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { onAuthStateChanged, signInWithEmailAndPassword, signOut } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';

const form = document.getElementById('loginForm');
const button = document.getElementById('verifyBtn');
const status = document.getElementById('loginStatus');
const errorBox = document.getElementById('loginError');
const passwordInput = document.getElementById('passwordInput');
const togglePasswordBtn = document.getElementById('togglePasswordBtn');
let generation = 0;
initializeTours('login');

function showError(message) {
    errorBox.textContent = message;
    errorBox.hidden = !message;
}

function destinationUrl() {
    const next = new URLSearchParams(window.location.search).get('next') || 'index.html';
    return /^(index|submissions|submission)\.html(?:\?[^#]*)?$/.test(next) ? next : 'index.html';
}

onAuthStateChanged(auth, async user => {
    const currentGeneration = ++generation;
    if (!user) {
        button.disabled = false;
        status.textContent = 'Sign in with your student email and password';
        maybePromptGuidedTour('login');
        return;
    }
    button.disabled = true;
    status.textContent = 'Loading student profile...';
    try {
        const snap = await getDoc(doc(db, 'studentProfiles', user.uid));
        if (generation !== currentGeneration) return;
        const profile = snap.exists() ? snap.data() : null;
        if (!profile || profile.active !== true || profile.authUid !== user.uid
            || !profile.sectionId || !profile.admissionNo
            || profile.studentKey !== `${profile.sectionId}_${profile.admissionNo}`) {
            throw new Error('Your student profile is unavailable or inactive. Contact your school administrator.');
        }
        window.location.replace(destinationUrl());
    } catch (error) {
        if (generation !== currentGeneration) return;
        try { await signOut(auth); } catch { /* Keep the form available if sign-out fails. */ }
        showError(error.message || 'Unable to load student profile.');
        status.textContent = 'Sign in failed';
        button.disabled = false;
    }
});

form.addEventListener('submit', async event => {
    event.preventDefault();
    showError('');
    button.disabled = true;
    status.textContent = 'Signing in...';
    try {
        await signInWithEmailAndPassword(auth,
            document.getElementById('emailInput').value.trim().toLowerCase(),
            passwordInput.value);
        passwordInput.value = '';
    } catch (error) {
        showError(['auth/invalid-credential', 'auth/user-not-found', 'auth/wrong-password'].includes(error.code)
            ? 'Email or password is incorrect.' : error.code === 'auth/too-many-requests'
                ? 'Too many attempts. Please try again later.' : error.message || 'Unable to sign in.');
        status.textContent = 'Sign in failed';
        button.disabled = false;
    }
});

togglePasswordBtn.addEventListener('click', () => {
    const shouldShow = passwordInput.type === 'password';
    passwordInput.type = shouldShow ? 'text' : 'password';
    togglePasswordBtn.textContent = shouldShow ? 'Hide' : 'Show';
    togglePasswordBtn.setAttribute('aria-pressed', String(shouldShow));
});
