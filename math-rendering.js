// Render stored math tokens, delimited LaTeX, and bare command expressions.
export function renderMath(root) {
    if (!root || !window.katex) return;
    root.querySelectorAll('.math-token').forEach(token => {
        const latex = token.dataset.latex;
        if (latex) window.katex.render(latex, token, { throwOnError: false, trust: false });
    });
    if (window.renderMathInElement) {
        window.renderMathInElement(root, {
            delimiters: [
                { left: '$$', right: '$$', display: true },
                { left: '\\[', right: '\\]', display: true },
                { left: '\\(', right: '\\)', display: false },
                { left: '$', right: '$', display: false }
            ],
            ignoredClasses: ['katex', 'math-token'],
            throwOnError: false, trust: false
        });
    }
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) {
        const node = walker.currentNode;
        if (!node.parentElement.closest('.katex, .math-token, script, style, pre, code, textarea, input, select, option, [contenteditable]')) nodes.push(node);
    }
    for (const node of nodes) {
        const parts = splitBareMath(node.textContent);
        if (!parts.some(part => part.math)) continue;
        const fragment = document.createDocumentFragment();
        for (const part of parts) {
            if (!part.math) { fragment.append(document.createTextNode(part.text)); continue; }
            const span = document.createElement('span');
            try {
                window.katex.render(part.text, span, { throwOnError: true, trust: false });
                fragment.append(span);
            } catch { fragment.append(document.createTextNode(part.text)); }
        }
        node.replaceWith(fragment);
    }
}

export function splitBareMath(text) {
    // Balanced brace groups are consumed whole, including nested fractions.
    const start = /\\(?:sum|prod|frac|dfrac|tfrac|sqrt|int|lim|sin|cos|tan|log|ln|alpha|beta|gamma|theta|pi|times|div|cdot|infty)(?![a-zA-Z])/g;
    const parts = [];
    let cursor = 0;
    for (let match; (match = start.exec(text));) {
        if (match.index < cursor) continue;
        let end = match.index;
        while (end < text.length) {
            const rest = text.slice(end);
            const token = /^(?:\\[a-zA-Z]+(?![a-zA-Z])|[_^=+*/()\[\]<>−-]|\d+(?:\.\d+)?|[a-zA-Z](?![a-zA-Z])|\s+)/.exec(rest);
            if (rest[0] === '{') {
                let depth = 0, next = end;
                for (; next < text.length; next++) {
                    if (text[next] === '{' && text[next - 1] !== '\\') depth++;
                    if (text[next] === '}' && text[next - 1] !== '\\' && --depth === 0) { next++; break; }
                }
                if (depth) break;
                end = next;
            } else if (token) end += token[0].length;
            else break;
        }
        const expression = text.slice(match.index, end).trimEnd();
        if (!expression) continue;
        if (match.index > cursor) parts.push({ text: text.slice(cursor, match.index), math: false });
        parts.push({ text: expression, math: true });
        cursor = match.index + expression.length;
        start.lastIndex = cursor;
    }
    if (cursor < text.length) parts.push({ text: text.slice(cursor), math: false });
    return parts;
}
