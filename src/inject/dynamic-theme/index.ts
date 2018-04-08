import {iterateCSSRules, iterateCSSDeclarations} from './css-rules';
import {getModifiableCSSDeclaration, getModifiedUserAgentStyle, ModifiableCSSDeclaration, ModifiableCSSRule} from './modify-css';
import {removeStyle} from '../style';
import {FilterConfig} from '../../definitions';

const cache = new WeakMap<CSSStyleRule, ModifiableCSSRule>();
let asyncCounter = 0;

function createTheme(filter: FilterConfig) {
    let style = document.getElementById('dark-reader-style') as HTMLStyleElement;
    if (!style) {
        style = document.createElement('style');
        style.id = 'dark-reader-style';
        document.head.appendChild(style);
    }

    const rules: ModifiableCSSRule[] = [];

    iterateCSSRules((r) => {
        if (cache.has(r)) {
            const rule = cache.get(r);
            if (rule) {
                rules.push(rule);
            }
            return;
        }

        const declarations: ModifiableCSSDeclaration[] = [];
        iterateCSSDeclarations(r, (property, value) => {
            const declaration = getModifiableCSSDeclaration(property, value, r);
            if (declaration) {
                declarations.push(declaration);
            }
        });

        let rule: ModifiableCSSRule = null;
        if (declarations.length > 0) {
            rule = {selector: r.selectorText, declarations};
            if (r.parentRule instanceof CSSMediaRule) {
                rule.media = (r.parentRule as CSSMediaRule).media.mediaText;
            }
            rules.push(rule);
        }
        cache.set(r, rule);
    });

    const lines: string[] = [];
    lines.push(getModifiedUserAgentStyle(filter));
    rules.forEach(({selector, declarations, media}) => {
        if (media) {
            lines.push(`@media ${media} {`);
        }
        lines.push(`${selector} {`);
        declarations.forEach(({property, value}) => {
            if (typeof value === 'function') {
                const modified = value(filter);
                if (modified instanceof Promise) {
                    const n = ++asyncCounter;
                    lines.push(`    /* #${n} */`);
                    modified.then((asyncValue) => {
                        style.textContent = style.textContent
                            .replace(`/* #${n} */`, `${property}: ${asyncValue} !important;`);
                    });
                } else {
                    lines.push(`    ${property}: ${modified} !important;`);
                }
            } else {
                lines.push(`    ${property}: ${value} !important;`);
            }
        });
        lines.push('}');
        if (media) {
            lines.push('}')
        }
    });

    style.textContent = lines.join('\n');
    document.head.insertBefore(style, null);
}

let styleChangeObserver: MutationObserver = null;
const linksSubscriptions = new Map<Element, () => void>();

function watchForLinksLoading(onLoad: () => void) {
    linksSubscriptions.forEach((listener, link) => link.removeEventListener('load', listener));
    linksSubscriptions.clear();
    const links = Array.from(document.styleSheets).filter((s) => s.ownerNode instanceof HTMLLinkElement).map((s) => s.ownerNode) as HTMLLinkElement[];
    links.forEach((link) => {
        link.addEventListener('load', onLoad);
        linksSubscriptions.set(link, onLoad);
        if (link.parentElement !== document.head) {
            document.head.insertBefore(link, document.getElementById('dark-reader-style'));
        }
    });
}

function createThemeAndWatchForUpdates(filter: FilterConfig) {
    createTheme(filter);
    watchForLinksLoading(() => createTheme(filter));
    if (styleChangeObserver) {
        styleChangeObserver.disconnect();
    }
    styleChangeObserver = new MutationObserver((mutations) => {
        const styleMutations = mutations.filter((m) => {
            return Array.from(m.addedNodes)
                .concat(Array.from(m.removedNodes))
                .some((n: Element) => {
                    return ((
                        (n instanceof HTMLStyleElement) ||
                        (n instanceof HTMLLinkElement && n.rel === 'stylesheet')
                    ) && (n.id !== 'dark-reader-style'));
                });
        });
        if (styleMutations.length > 0) {
            createTheme(filter);
            watchForLinksLoading(() => createTheme(filter));
        }
    });
    styleChangeObserver.observe(document.head, {childList: true});
}

export function createOrUpdateDynamicTheme(filter: FilterConfig) {
    if (document.head) {
        createThemeAndWatchForUpdates(filter);
    } else {
        const headObserver = new MutationObserver(() => {
            if (document.head) {
                headObserver.disconnect();
                createThemeAndWatchForUpdates(filter);
            }
        });
        headObserver.observe(document, {childList: true, subtree: true});
    }
}

export function removeDynamicTheme() {
    removeStyle();
    if (styleChangeObserver) {
        styleChangeObserver.disconnect();
        styleChangeObserver = null;
    }
}