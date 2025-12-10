(() => {
  // Define the Unsound CodeMirror mode
  CodeMirror.defineMode("unsound", function(_config) {
    // Keywords from core, meso, thermo
    const keywords = new Set([
      "let", "in", "if", "then", "else",
      "true", "false", "null",
      "do", "return", "import", "from"
    ]);

    // Operators from meso
    const operators = /^(===|!==|==|!=|<=|>=|&&|\|\||=>|[+\-*\/%<>!=])/;

    function nextUntilUnescaped(stream, end) {
      let escaped = false;
      let next;
      while ((next = stream.next()) != null) {
        if (next === end && !escaped) {
          return false;
        }
        escaped = !escaped && next === "\\";
      }
      return escaped;
    }

    return {
      startState: function() {
        return {
          tokenize: null
        };
      },

      token: function(stream, state) {
        if (state.tokenize) {
          return state.tokenize(stream, state);
        }

        if (stream.eatSpace()) {
          return null;
        }

        const ch = stream.next();

        // Comments
        if (ch === "/" && stream.eat("/")) {
          stream.skipToEnd();
          return "comment";
        }

        // Strings
        if (ch === "\"") {
          nextUntilUnescaped(stream, "\"");
          return "string";
        }

        // Dollar-prefixed identifiers ($parse, $compile, etc.)
        if (ch === "$") {
          stream.eatWhile(/[\w]/);
          return "builtin";
        }

        // Numbers
        if (/\d/.test(ch)) {
          stream.eatWhile(/[\d]/);
          if (stream.eat(".")) {
            stream.eatWhile(/[\d]/);
          }
          return "number";
        }

        // Operators (need to back up and try matching)
        stream.backUp(1);
        if (stream.match(operators)) {
          return "operator";
        }
        stream.next(); // re-consume the character

        // Identifiers and keywords
        if (/[a-zA-Z_]/.test(ch)) {
          stream.eatWhile(/[\w]/);
          const word = stream.current();
          if (keywords.has(word)) {
            return "keyword";
          }
          return "variable";
        }

        // Punctuation
        if (/[{}()\[\];,.]/.test(ch)) {
          return "punctuation";
        }

        return null;
      },

      lineComment: '//',
    };
  });

  // Also register as "us" for convenience
  CodeMirror.defineMIME("text/x-unsound", "unsound");

  const MODE_MAP = {
    typescript: 'text/typescript',
    us: 'unsound',
  };

  window.createCodeMirror = (node, mode) => {
    // Map mode.
    mode = MODE_MAP[mode] || mode;

    // Configure codemirror.
    CodeMirror((newNode) => {
      node.parentNode.replaceChild(newNode, node);
      newNode.dataset["readonly"] = "readonly";
      newNode.dataset["language"] = mode;
    }, {
      value: node.innerText.trim(),
      mode: mode,
      readOnly: true,
    });
  };

  // Convert all code blocks with language classes to CodeMirror
  document.querySelectorAll('pre code').forEach((node) => {
    // Auto-detect mode.
    const prefix = 'language-';
    let mode;
    node.classList.forEach((c) => {
      if(c.startsWith(prefix)){
        mode = c.substring(prefix.length);
      }
    });
    if(!mode){
      return;
    }
    window.createCodeMirror(node.parentNode, mode);
  });

  // Convert textareas with data-language to CodeMirror
  document.querySelectorAll('textarea.code').forEach((node) => {
    const mode = node.dataset.language;
    if(!mode){
      return;
    }

    // Random issue: if the textarea appears in markdown, newlines
    // are turned into <p>.
    node.value = node.value.replace(/<\/?p>+/gi, '\n').replace(/\n\n+/g, '\n\n');

    const cm = CodeMirror.fromTextArea(node, {
      mode: MODE_MAP[mode] || mode,
    });
    cm.display.wrapper.dataset["language"] = mode;

    // Reflect changes back into the textarea so we can read
    // the updated value.
    cm.on('change', () => {
      cm.save();
    });
    node.cm = cm;
  });
})();
