/**
 * Which `if (...)` conditions actually enclose a point in a source file.
 *
 * Written because the assertion it replaces could not fail. To check that a
 * machine-wide write sat behind the DATA_DIR gate,
 * mitm-machine-wide-trust-is-gated.test.js did this:
 *
 *   const chain = manager.slice(manager.indexOf("NODE_EXTRA_CA_CERTS is left alone"));
 *   expect(chain).toContain("setLinuxNodeExtraCaCerts(");
 *
 * which only says the call appears somewhere AFTER the gate in the file -- true
 * of every line below it, gated or not. The Linux write was a separate, ungated
 * `if (IS_LINUX)` the whole time, and that test's own comment asserted in prose
 * that "macOS, Windows and Linux share one if/else chain" while the code did not.
 * Text order is not control flow, so this walks the braces instead.
 *
 * Deliberately a small reader rather than a parser. The one thing it must get
 * right is the brace count, so `blankLiterals` understands template literals and
 * their `${...}` substitutions -- an earlier version did not, a `"` inside a
 * backtick string sent the string scanner across the template's end, and the
 * count drifted by 7 over manager.js. A helper that miscounts braces reports
 * things as gated that are not, which is the failure it exists to prevent, so
 * its test asserts the blanked source still balances.
 *
 * Regex literals have to be lexed for the same reason. manager.js line 30 is
 *   return `'${String(str).replace(/'/g, "'\\''")}'`;
 * where the `/'/g` inside a substitution looks like the start of a quoted
 * string. Reading it as one desynchronised the scanner and blanked the entire
 * rest of the file. Whatever this still cannot lex, that balance assertion
 * catches -- it is the only reason to trust anything below.
 */

/**
 * Replace comment and string bodies with spaces, preserving every offset and
 * newline. Template substitutions stay as code, so their braces still balance.
 */
function blankLiterals(src) {
  const out = src.split("");
  const blankAt = (k) => { if (k < out.length && out[k] !== "\n") out[k] = " "; };
  const blankRange = (from, to) => { for (let k = from; k < to; k++) blankAt(k); };

  const stack = []; // "tmpl" = inside template text, {subst} = inside ${ }
  let i = 0;
  while (i < src.length) {
    const top = stack[stack.length - 1];

    if (top === "tmpl") {
      if (src[i] === "\\") { blankAt(i); blankAt(i + 1); i += 2; continue; }
      if (src[i] === "`") { blankAt(i); stack.pop(); i++; continue; }
      if (src[i] === "$" && src[i + 1] === "{") { stack.push({ depth: 0 }); i += 2; continue; }
      blankAt(i); i++; continue;
    }

    const two = src.slice(i, i + 2);
    if (two === "//") {
      const e = src.indexOf("\n", i);
      const end = e < 0 ? src.length : e;
      blankRange(i, end); i = end; continue;
    }
    if (two === "/*") {
      const e = src.indexOf("*/", i + 2);
      const end = e < 0 ? src.length : e + 2;
      blankRange(i, end); i = end; continue;
    }
    if (src[i] === '"' || src[i] === "'") {
      const quote = src[i];
      let j = i + 1;
      while (j < src.length && src[j] !== quote) j += src[j] === "\\" ? 2 : 1;
      blankRange(i, Math.min(j + 1, src.length)); i = j + 1; continue;
    }
    if (src[i] === "`") { blankAt(i); stack.push("tmpl"); i++; continue; }
    if (src[i] === "/" && regexStartsHere(out, i)) {
      let j = i + 1, inClass = false;
      while (j < src.length) {
        if (src[j] === "\\") { j += 2; continue; }
        if (src[j] === "[") inClass = true;
        else if (src[j] === "]") inClass = false;
        else if (src[j] === "/" && !inClass) break;
        else if (src[j] === "\n") break; // unterminated: not a regex after all
        j++;
      }
      if (src[j] === "/") { blankRange(i, j + 1); i = j + 1; continue; }
    }

    // Inside ${ }: track nesting so the closing brace returns us to template text.
    if (top && typeof top === "object") {
      if (src[i] === "{") { top.depth++; i++; continue; }
      if (src[i] === "}") {
        if (top.depth === 0) stack.pop();
        else top.depth--;
        i++; continue;
      }
    }
    i++;
  }
  return out.join("");
}

/**
 * Does a `/` at `i` begin a regex literal rather than a division?
 *
 * Decided from the last significant character already scanned, which is the
 * standard heuristic: after a value (identifier, number, `)`, `]`) a slash
 * divides; after an operator, a comma, an opening bracket or a keyword it opens
 * a regex. `)` is read as division, so `if (x) /re/.test(y)` would be misread --
 * nothing in this codebase writes that, and the brace-balance assertion would
 * notice if it did.
 */
const REGEX_OK_AFTER_KEYWORD = /\b(return|typeof|instanceof|in|of|new|delete|void|case|do|else|yield|await)$/;

function regexStartsHere(out, i) {
  let k = i - 1;
  while (k >= 0 && /\s/.test(out[k])) k--;
  if (k < 0) return true;
  const prev = out[k];
  if (/[\w$)\]]/.test(prev)) {
    return REGEX_OK_AFTER_KEYWORD.test(out.slice(Math.max(0, k - 11), k + 1).join(""));
  }
  return true;
}

/** Index of the `(` matching the `)` at `close`, or -1. */
function matchParenBack(code, close) {
  let depth = 0;
  for (let i = close; i >= 0; i--) {
    if (code[i] === ")") depth++;
    else if (code[i] === "(") { if (--depth === 0) return i; }
  }
  return -1;
}

/** Index of the `{` matching the `}` at `close`, or -1. */
function matchBraceBack(code, close) {
  let depth = 0;
  for (let i = close; i >= 0; i--) {
    if (code[i] === "}") depth++;
    else if (code[i] === "{") { if (--depth === 0) return i; }
  }
  return -1;
}

/** Skip whitespace backwards from `i`. */
const skipBack = (code, i) => { while (i >= 0 && /\s/.test(code[i])) i--; return i; };

/**
 * If the block opening at `brace` is an `else` or `else if` branch, the `{` of
 * the branch it hangs off. Otherwise -1.
 */
function previousBranchBrace(code, brace) {
  let i = skipBack(code, brace - 1);

  if (code[i] === ")") {
    const open = matchParenBack(code, i);
    if (open < 0) return -1;
    i = skipBack(code, open - 1);
    if (!/\bif$/.test(code.slice(Math.max(0, i - 1), i + 1))) return -1;
    i = skipBack(code, i - 2); // past "if"
  }
  if (!/\belse$/.test(code.slice(Math.max(0, i - 3), i + 1))) return -1;

  i = skipBack(code, i - 4); // past "else"
  return code[i] === "}" ? matchBraceBack(code, i) : -1;
}

/**
 * Every condition governing the block opening at `brace`, including the head of
 * the if/else chain it belongs to -- an `else if` branch runs only because the
 * head's condition was false, so the head governs it.
 */
function chainConditions(code, src, brace, seen = new Set()) {
  if (seen.has(brace) || brace < 0) return [];
  seen.add(brace);

  const conditions = [];
  const close = skipBack(code, brace - 1);
  if (code[close] === ")") {
    const open = matchParenBack(code, close);
    if (open >= 0) {
      const kw = code.slice(Math.max(0, skipBack(code, open - 1) - 6), skipBack(code, open - 1) + 1);
      if (/\b(if|while|for|switch)$/.test(kw)) conditions.push(src.slice(open, close + 1));
    }
  }

  const prev = previousBranchBrace(code, brace);
  if (prev >= 0) conditions.push(...chainConditions(code, src, prev, seen));
  return conditions;
}

/**
 * The conditions of every block enclosing `index`, branch chains included.
 * `[]` means nothing conditional encloses it.
 */
function enclosingConditions(src, index) {
  const code = blankLiterals(src);
  const found = [];
  let depth = 0;
  for (let i = index - 1; i >= 0; i--) {
    if (code[i] === "}") depth++;
    else if (code[i] === "{") {
      if (depth > 0) { depth--; continue; }
      found.push(...chainConditions(code, src, i));
    }
  }
  return found;
}

/** Is the first occurrence of `call` inside a block guarded by `guard`? */
function isGuardedBy(src, call, guard) {
  const index = src.indexOf(call);
  if (index < 0) return { found: false, guarded: false, conditions: [] };
  const conditions = enclosingConditions(src, index);
  return { found: true, guarded: conditions.some((c) => c.includes(guard)), conditions };
}

/**
 * Is `call` preceded, inside `fnName`, by an early return guarded on `guard`?
 *
 * The other shape a gate takes. `uninstallCert` does not wrap its teardown in a
 * block; it returns first. A return inside `if (!GATE)` dominates everything
 * after it in the same function, which is as strong as enclosing it.
 */
function isGuardedByEarlyReturn(src, fnName, call, guard) {
  const code = blankLiterals(src);
  const fnStart = code.search(new RegExp(`(async )?function ${fnName}\\s*\\(`));
  if (fnStart < 0) return { found: false, guarded: false };

  const bodyStart = code.indexOf("{", fnStart);
  let depth = 0, bodyEnd = bodyStart;
  for (let i = bodyStart; i < code.length; i++) {
    if (code[i] === "{") depth++;
    else if (code[i] === "}" && --depth === 0) { bodyEnd = i; break; }
  }

  const body = code.slice(bodyStart, bodyEnd);
  const callAt = body.indexOf(call);
  if (callAt < 0) return { found: false, guarded: false };

  // A `return` inside a block whose chain mentions `guard`, before the call.
  const before = body.slice(0, callAt);
  for (const m of [...before.matchAll(/\breturn\b/g)]) {
    const conditions = enclosingConditions(src, bodyStart + m.index);
    if (conditions.some((c) => c.includes(guard))) return { found: true, guarded: true };
  }
  return { found: true, guarded: false };
}

export { blankLiterals, enclosingConditions, isGuardedBy, isGuardedByEarlyReturn };
