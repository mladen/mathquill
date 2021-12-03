/*************************************************
 * Abstract classes of math blocks and commands.
 ************************************************/

/**
 * Math tree node base class.
 * Some math-tree-specific extensions to Node.
 * Both MathBlock's and MathCommand's descend from it.
 */
class MathElement extends Node {
  finalizeInsert (options, cursor) { // `cursor` param is only for
      // SupSub::contactWeld, and is deliberately only passed in by writeLatex,
      // see ea7307eb4fac77c149a11ffdf9a831df85247693
    var self = this;
    self.postOrder(function (node) { node.finalizeTree(options) });
    self.postOrder(function (node) { node.contactWeld(cursor) });

    // note: this order is important.
    // empty elements need the empty box provided by blur to
    // be present in order for their dimensions to be measured
    // correctly by 'reflow' handlers.
    self.postOrder(function (node) { node.blur(); });

    self.postOrder(function (node) { node.reflow(); });
    if (self[R].siblingCreated) self[R].siblingCreated(options, L);
    if (self[L].siblingCreated) self[L].siblingCreated(options, R);
    self.bubble(function (node) { node.reflow(); });
  };
  // If the maxDepth option is set, make sure
  // deeply nested content is truncated. Just return
  // false if the cursor is already too deep.
  prepareInsertionAt (cursor) {
    var maxDepth = cursor.options.maxDepth;
    if (maxDepth !== undefined) {
      var cursorDepth = cursor.depth();
      if (cursorDepth > maxDepth) {
        return false;
      }
      this.removeNodesDeeperThan(maxDepth-cursorDepth);
    }
    return true;
  };
  // Remove nodes that are more than `cutoff`
  // blocks deep from this node.
  removeNodesDeeperThan (cutoff) {
    var depth = 0;
    var queue = [[this, depth]];
    var current;

    // Do a breadth-first search of this node's descendants
    // down to cutoff, removing anything deeper.
    while (queue.length) {
      current = queue.shift();
      current[0].children().each(function (child) {
        var i = (child instanceof MathBlock) ? 1 : 0;
        depth = current[1]+i;

        if (depth <= cutoff) {
          queue.push([child, depth]);
        } else {
          (i ? child.children() : child).remove();
        }
      });
    }
  };
}

/**
 * Commands and operators, like subscripts, exponents, or fractions.
 * Descendant commands are organized into blocks.
 */
class MathCommand extends MathElement {
  constructor (ctrlSeq, htmlTemplate, textTemplate) {
    this.init(ctrlSeq, htmlTemplate, textTemplate);
  };

  init (ctrlSeq, htmlTemplate, textTemplate) {
    super.init();

    var cmd = this;

    if (!cmd.ctrlSeq) cmd.ctrlSeq = ctrlSeq;
    if (htmlTemplate) cmd.htmlTemplate = htmlTemplate;
    if (textTemplate) cmd.textTemplate = textTemplate;
  }

  // obvious methods
  replaces (replacedFragment) {
    replacedFragment.disown();
    this.replacedFragment = replacedFragment;
  };
  isEmpty () {
    return this.foldChildren(true, function(isEmpty, child) {
      return isEmpty && child.isEmpty();
    });
  };

  parser () {
    var block = latexMathParser.block;
    var self = this;

    return block.times(self.numBlocks()).map(function(blocks) {
      self.blocks = blocks;

      for (var i = 0; i < blocks.length; i += 1) {
        blocks[i].adopt(self, self.ends[R], 0);
      }

      return self;
    });
  };

  // createLeftOf(cursor) and the methods it calls
  createLeftOf (cursor) {
    var cmd = this;
    var replacedFragment = cmd.replacedFragment;

    cmd.createBlocks();
    super.createLeftOf(cursor);
    if (replacedFragment) {
      replacedFragment.adopt(cmd.ends[L], 0, 0);
      replacedFragment.jQ.appendTo(cmd.ends[L].jQ);
      cmd.placeCursor(cursor);
      cmd.prepareInsertionAt(cursor);
    }
    cmd.finalizeInsert(cursor.options);
    cmd.placeCursor(cursor);
  };
  createBlocks () {
    var cmd = this,
      numBlocks = cmd.numBlocks(),
      blocks = cmd.blocks = Array(numBlocks);

    for (var i = 0; i < numBlocks; i += 1) {
      var newBlock = blocks[i] = new MathBlock();
      newBlock.adopt(cmd, cmd.ends[R], 0);
    }
  };
  placeCursor (cursor) {
    //insert the cursor at the right end of the first empty child, searching
    //left-to-right, or if none empty, the right end child
    cursor.insAtRightEnd(this.foldChildren(this.ends[L], function(leftward, child) {
      return leftward.isEmpty() ? leftward : child;
    }));
  };

  // editability methods: called by the cursor for editing, cursor movements,
  // and selection of the MathQuill tree, these all take in a direction and
  // the cursor
  moveTowards (dir, cursor, updown) {
    var updownInto = updown && this[updown+'Into'];
    cursor.insAtDirEnd(-dir, updownInto || this.ends[-dir]);
    aria.queueDirEndOf(-dir).queue(cursor.parent, true);
  };
  deleteTowards (dir, cursor) {
    if (this.isEmpty()) cursor[dir] = this.remove()[dir];
    else this.moveTowards(dir, cursor, null);
  };
  selectTowards (dir, cursor) {
    cursor[-dir] = this;
    cursor[dir] = this[dir];
  };
  selectChildren () {
    return new Selection(this, this);
  };
  unselectInto (dir, cursor) {
    cursor.insAtDirEnd(-dir, cursor.anticursor.ancestors[this.id]);
  };
  seek (pageX, cursor) {
    function getBounds(node) {
      var bounds = {}
      bounds[L] = node.jQ.offset().left;
      bounds[R] = bounds[L] + node.jQ.outerWidth();
      return bounds;
    }

    var cmd = this;
    var cmdBounds = getBounds(cmd);

    if (pageX < cmdBounds[L]) return cursor.insLeftOf(cmd);
    if (pageX > cmdBounds[R]) return cursor.insRightOf(cmd);

    var leftLeftBound = cmdBounds[L];
    cmd.eachChild(function(block) {
      var blockBounds = getBounds(block);
      if (pageX < blockBounds[L]) {
        // closer to this block's left bound, or the bound left of that?
        if (pageX - leftLeftBound < blockBounds[L] - pageX) {
          if (block[L]) cursor.insAtRightEnd(block[L]);
          else cursor.insLeftOf(cmd);
        }
        else cursor.insAtLeftEnd(block);
        return false;
      }
      else if (pageX > blockBounds[R]) {
        if (block[R]) leftLeftBound = blockBounds[R]; // continue to next block
        else { // last (rightmost) block
          // closer to this block's right bound, or the cmd's right bound?
          if (cmdBounds[R] - pageX < pageX - blockBounds[R]) {
            cursor.insRightOf(cmd);
          }
          else cursor.insAtRightEnd(block);
        }
      }
      else {
        block.seek(pageX, cursor);
        return false;
      }
    });
  }

  // methods involved in creating and cross-linking with HTML DOM nodes
  /*
    They all expect an .htmlTemplate like
      '<span>&0</span>'
    or
      '<span><span>&0</span><span>&1</span></span>'

    See html.test.js for more examples.

    Requirements:
    - For each block of the command, there must be exactly one "block content
      marker" of the form '&<number>' where <number> is the 0-based index of the
      block. (Like the LaTeX \newcommand syntax, but with a 0-based rather than
      1-based index, because JavaScript because C because Dijkstra.)
    - The block content marker must be the sole contents of the containing
      element, there can't even be surrounding whitespace, or else we can't
      guarantee sticking to within the bounds of the block content marker when
      mucking with the HTML DOM.
    - The HTML not only must be well-formed HTML (of course), but also must
      conform to the XHTML requirements on tags, specifically all tags must
      either be self-closing (like '<br/>') or come in matching pairs.
      Close tags are never optional.

    Note that &<number> isn't well-formed HTML; if you wanted a literal '&123',
    your HTML template would have to have '&amp;123'.
  */
  numBlocks () {
    var matches = this.htmlTemplate.match(/&\d+/g);
    return matches ? matches.length : 0;
  };
  html () {
    // Render the entire math subtree rooted at this command, as HTML.
    // Expects .createBlocks() to have been called already, since it uses the
    // .blocks array of child blocks.
    //
    // See html.test.js for example templates and intended outputs.
    //
    // Given an .htmlTemplate as described above,
    // - insert the mathquill-command-id attribute into all top-level tags,
    //   which will be used to set this.jQ in .jQize().
    //   This is straightforward:
    //     * tokenize into tags and non-tags
    //     * loop through top-level tokens:
    //         * add #cmdId attribute macro to top-level self-closing tags
    //         * else add #cmdId attribute macro to top-level open tags
    //             * skip the matching top-level close tag and all tag pairs
    //               in between
    // - for each block content marker,
    //     + replace it with the contents of the corresponding block,
    //       rendered as HTML
    //     + insert the mathquill-block-id attribute into the containing tag
    //   This is even easier, a quick regex replace, since block tags cannot
    //   contain anything besides the block content marker.
    //
    // Two notes:
    // - The outermost loop through top-level tokens should never encounter any
    //   top-level close tags, because we should have first encountered a
    //   matching top-level open tag, all inner tags should have appeared in
    //   matching pairs and been skipped, and then we should have skipped the
    //   close tag in question.
    // - All open tags should have matching close tags, which means our inner
    //   loop should always encounter a close tag and drop nesting to 0. If
    //   a close tag is missing, the loop will continue until i >= tokens.length
    //   and token becomes undefined. This will not infinite loop, even in
    //   production without pray(), because it will then TypeError on .slice().

    var cmd = this;
    var blocks = cmd.blocks;
    var cmdId = ' mathquill-command-id=' + cmd.id;
    var tokens = cmd.htmlTemplate.match(/<[^<>]+>|[^<>]+/g);

    pray('no unmatched angle brackets', tokens.join('') === this.htmlTemplate);

    // add cmdId and aria-hidden (for screen reader users) to all top-level tags
    // Note: with the RegExp search/replace approach, it's possible that an element which is both a command and block may contain redundant aria-hidden attributes.
    // In practice this doesn't appear to cause problems for screen readers.
    for (var i = 0, token = tokens[0]; token; i += 1, token = tokens[i]) {
      // top-level self-closing tags
      if (token.slice(-2) === '/>') {
        tokens[i] = token.slice(0,-2) + cmdId + ' aria-hidden="true"/>';
      }
      // top-level open tags
      else if (token.charAt(0) === '<') {
        pray('not an unmatched top-level close tag', token.charAt(1) !== '/');

        tokens[i] = token.slice(0,-1) + cmdId + ' aria-hidden="true">';

        // skip matching top-level close tag and all tag pairs in between
        var nesting = 1;
        do {
          i += 1, token = tokens[i];
          pray('no missing close tags', token);
          // close tags
          if (token.slice(0,2) === '</') {
            nesting -= 1;
          }
          // non-self-closing open tags
          else if (token.charAt(0) === '<' && token.slice(-2) !== '/>') {
            nesting += 1;
          }
        } while (nesting > 0);
      }
    }
    return tokens.join('').replace(/>&(\d+)/g, function($0, $1) {
      return ' mathquill-block-id=' + blocks[$1].id + ' aria-hidden="true">' + blocks[$1].join('html');
    });
  };

  // methods to export a string representation of the math tree
  latex () {
    return this.foldChildren(this.ctrlSeq, function(latex, child) {
      return latex + '{' + (child.latex() || ' ') + '}';
    });
  };
  static _todoMoveIntoConstructor = MathCommand.prototype.textTemplate = [''];
  text () {
    var cmd = this, i = 0;
    return cmd.foldChildren(cmd.textTemplate[i], function(text, child) {
      i += 1;
      var child_text = child.text();
      if (text && cmd.textTemplate[i] === '('
          && child_text[0] === '(' && child_text.slice(-1) === ')')
        return text + child_text.slice(1, -1) + cmd.textTemplate[i];
      return text + child_text + (cmd.textTemplate[i] || '');
    });
  };
  static _todoMoveIntoConstructor = MathCommand.prototype.mathspeakTemplate = [''];
  mathspeak () {
    var cmd = this, i = 0;
    return cmd.foldChildren(cmd.mathspeakTemplate[i] || 'Start'+cmd.ctrlSeq+' ', function(speech, block) {
      i += 1;
      return speech + ' ' + block.mathspeak() + ' ' + (cmd.mathspeakTemplate[i]+' ' || 'End'+cmd.ctrlSeq+' ');
    });
  };
};

/**
 * Lightweight command without blocks or children.
 */
class Symbol extends MathCommand {
  constructor (ctrlSeq, html, text, mathspeak) {
    this.init(ctrlSeq, html, text, mathspeak);
  }

  init (ctrlSeq, html, text, mathspeak) {
    if (!text && !!ctrlSeq) text = ctrlSeq.replace(/^\\/, '');

    this.mathspeakName = mathspeak || text;
    super.init(ctrlSeq, html, [ text ]);
  };

  parser () { return Parser.succeed(this); };
  numBlocks () { return 0; };

  replaces (replacedFragment) {
    replacedFragment.remove();
  };
  createBlocks () {};

  moveTowards (dir, cursor) {
    cursor.jQ.insDirOf(dir, this.jQ);
    cursor[-dir] = this;
    cursor[dir] = this[dir];
    aria.queue(this);
  };
  deleteTowards (dir, cursor) {
    cursor[dir] = this.remove()[dir];
  };
  seek (pageX, cursor) {
    // insert at whichever side the click was closer to
    if (pageX - this.jQ.offset().left < this.jQ.outerWidth()/2)
      cursor.insLeftOf(this);
    else
      cursor.insRightOf(this);
  };

  latex (){ return this.ctrlSeq; };
  text (){ return this.textTemplate.join(''); };
  mathspeak (){ return this.mathspeakName; };
  placeCursor () {};
  isEmpty (){ return true; };
};
class VanillaSymbol extends Symbol {
  constructor (ch, html, mathspeak) {
    this.init(ch, html, mathspeak);
  }
  init (ch, html, mathspeak) {
    super.init(ch, '<span>'+(html || ch)+'</span>', undefined, mathspeak);
  };
}
function bindVanillaSymbol (ch, html, mathspeak) {
  return () => new VanillaSymbol(ch, html, mathspeak);
}

class BinaryOperator extends Symbol {
  constructor (ctrlSeq, html, text, mathspeak) {
    this.init(ctrlSeq, html, text, mathspeak);
  }
  init (ctrlSeq, html, text, mathspeak) {
    super.init(ctrlSeq, '<span class="mq-binary-operator">'+html+'</span>', text, mathspeak);
  };
};
function bindBinaryOperator (ctrlSeq, html, text, mathspeak) {
  return () => new BinaryOperator(ctrlSeq, html, text, mathspeak);
}

/**
 * Children and parent of MathCommand's. Basically partitions all the
 * symbols and operators that descend (in the Math DOM tree) from
 * ancestor operators.
 */
class MathBlock extends MathElement {
  join (methodName) {
    return this.foldChildren('', function(fold, child) {
      return fold + child[methodName]();
    });
  };
  html () { return this.join('html'); };
  latex () { return this.join('latex'); };
  text () {
    return (this.ends[L] === this.ends[R] && this.ends[L] !== 0) ?
      this.ends[L].text() :
      this.join('text')
    ;
  };
  mathspeak () {
    var tempOp = '';
    var autoOps = {};
    if (this.controller) autoOps = this.controller.options.autoOperatorNames;
    return this.foldChildren([], function(speechArray, cmd) {
      if (cmd.isPartOfOperator) {
        tempOp += cmd.mathspeak();
      } else {
        if(tempOp!=='') {
          if(autoOps !== {} && autoOps._maxLength > 0) {
            var x = autoOps[tempOp.toLowerCase()];
            if(typeof x === 'string') tempOp = x;
          }
          speechArray.push(tempOp+' ');
          tempOp = '';
        }
        var mathspeakText = cmd.mathspeak();
        var cmdText = cmd.ctrlSeq;
        if (
          isNaN(cmdText) &&
          cmdText !== '.' &&
          (!cmd.parent || !cmd.parent.parent || !cmd.parent.parent.isTextBlock())
        ) {
          mathspeakText = ' ' + mathspeakText + ' ';
        }
        speechArray.push(mathspeakText);
      }
      return speechArray;
    })
    .join('')
    .replace(/ +(?= )/g,'')
    // For Apple devices in particular, split out digits after a decimal point so they aren't read aloud as whole words.
    // Not doing so makes 123.456 potentially spoken as "one hundred twenty-three point four hundred fifty-six."
    // Instead, add spaces so it is spoken as "one hundred twenty-three point four five six."
    .replace(/(\.)([0-9]+)/g, function(match, p1, p2) {
      return p1 + p2.split('').join(' ').trim();
    });
  };

  static _todoMoveIntoConstructor = MathBlock.prototype.ariaLabel = 'block';

  keystroke (key, e, ctrlr) {
    if (ctrlr.options.spaceBehavesLikeTab
        && (key === 'Spacebar' || key === 'Shift-Spacebar')) {
      e.preventDefault();
      ctrlr.escapeDir(key === 'Shift-Spacebar' ? L : R, key, e);
      return;
    }
    return super.keystroke.apply(this, arguments);
  };

  // editability methods: called by the cursor for editing, cursor movements,
  // and selection of the MathQuill tree, these all take in a direction and
  // the cursor
  moveOutOf (dir, cursor, updown) {
    var updownInto = updown && this.parent[updown+'Into'];
    if (!updownInto && this[dir]) {
      cursor.insAtDirEnd(-dir, this[dir]);
      aria.queueDirEndOf(-dir).queue(cursor.parent, true);
    }
    else {
      cursor.insDirOf(dir, this.parent);
      aria.queueDirOf(dir).queue(this.parent);
    }
  };
  selectOutOf (dir, cursor) {
    cursor.insDirOf(dir, this.parent);
  };
  deleteOutOf (dir, cursor) {
    cursor.unwrapGramp();
  };
  seek (pageX, cursor) {
    var node = this.ends[R];
    if (!node || node.jQ.offset().left + node.jQ.outerWidth() < pageX) {
      return cursor.insAtRightEnd(this);
    }
    if (pageX < this.ends[L].jQ.offset().left) return cursor.insAtLeftEnd(this);
    while (pageX < node.jQ.offset().left) node = node[L];
    return node.seek(pageX, cursor);
  };
  chToCmd (ch, options) {
    var cons;
    // exclude f because it gets a dedicated command with more spacing
    if (ch.match(/^[a-eg-zA-Z]$/))
      return new Letter(ch);
    else if (/^\d$/.test(ch))
      return new Digit(ch);
    else if (options && options.typingSlashWritesDivisionSymbol && ch === '/')
      return LatexCmds['÷'](ch);
    else if (options && options.typingAsteriskWritesTimesSymbol && ch === '*')
      return LatexCmds['×'](ch);
    else if (options && options.typingPercentWritesPercentOf && ch === '%')
      return LatexCmds.percentof(ch);
    else if (cons = CharCmds[ch] || LatexCmds[ch]) {
      if (cons.constructor) {
        return new cons(ch);
      } else {
        return cons(ch);
      }
    }
    else
      return new VanillaSymbol(ch);
  };
  write (cursor, ch) {
    var cmd = this.chToCmd(ch, cursor.options);
    if (cursor.selection) cmd.replaces(cursor.replaceSelection());
    if (!cursor.isTooDeep()) {
      cmd.createLeftOf(cursor.show());
      // special-case the slash so that fractions are voiced while typing
      if (ch === '/') {
        aria.alert('over');
      } else {
        aria.alert(cmd.mathspeak({ createdLeftOf: cursor }));
      }
    }
  };

  writeLatex (cursor, latex) {

    var all = Parser.all;
    var eof = Parser.eof;

    var block = latexMathParser.skip(eof).or(all.result(false)).parse(latex);

    if (block && !block.isEmpty() && block.prepareInsertionAt(cursor)) {
      block.children().adopt(cursor.parent, cursor[L], cursor[R]);
      var jQ = block.jQize();
      jQ.insertBefore(cursor.jQ);
      cursor[L] = block.ends[R];
      block.finalizeInsert(cursor.options, cursor);
      if (block.ends[R][R].siblingCreated) block.ends[R][R].siblingCreated(cursor.options, L);
      if (block.ends[L][L].siblingCreated) block.ends[L][L].siblingCreated(cursor.options, R);
      cursor.parent.bubble(function (node) { node.reflow(); });
    }
  };

  focus () {
    this.jQ.addClass('mq-hasCursor');
    this.jQ.removeClass('mq-empty');

    return this;
  };
  blur () {
    this.jQ.removeClass('mq-hasCursor');
    if (this.isEmpty()) {
      this.jQ.addClass('mq-empty');
      if (this.isEmptyParens()) {
        this.jQ.addClass('mq-empty-parens');
      } else if (this.isEmptySquareBrackets()) {
        this.jQ.addClass('mq-empty-square-brackets');
      }
    }
    return this;
  };
}

Options.prototype.mouseEvents = true;
API.StaticMath = function(APIClasses) {
  return class StaticMath extends APIClasses.AbstractMathQuill {
    static RootBlock = MathBlock;

    __mathquillify (opts, interfaceVersion) {
      this.config(opts);
      super.__mathquillify('mq-math-mode');
      if (this.__options.mouseEvents) {
        this.__controller.delegateMouseEvents();
        this.__controller.staticMathTextareaEvents();
      }
      return this;
    };
    constructor (el) {
      super(el);
      var innerFields = this.innerFields = [];
      this.__controller.root.postOrder(function (node) {
        node.registerInnerField(innerFields, APIClasses.InnerMathField);
      });
    };
    latex () {
      var returned = super.latex.apply(this, arguments);
      if (arguments.length > 0) {
        var innerFields = this.innerFields = [];
        this.__controller.root.postOrder(function (node) {
          node.registerInnerField(innerFields, APIClasses.InnerMathField);
        });
        // Force an ARIA label update to remain in sync with the new LaTeX value.
        this.__controller.updateMathspeak();
      }
      return returned;
    };
    setAriaLabel (ariaLabel) {
      this.__controller.setAriaLabel(ariaLabel);
      return this;
    };
    getAriaLabel () {
      return this.__controller.getAriaLabel();
    };
  };
};

class RootMathBlock extends MathBlock {}
RootBlockMixin(RootMathBlock.prototype); // adds methods to RootMathBlock

API.MathField = function(APIClasses) {
  return class MathField extends APIClasses.EditableField {
    static RootBlock = RootMathBlock;

    __mathquillify (opts, interfaceVersion) {
      this.config(opts);
      if (interfaceVersion > 1) this.__controller.root.reflow = noop;
      super.__mathquillify('mq-editable-field mq-math-mode');
      delete this.__controller.root.reflow;
      return this;
    };
  };
};

API.InnerMathField = function(APIClasses) {
  return class extends APIClasses.MathField {
    makeStatic () {
      this.__controller.editable = false;
      this.__controller.root.blur();
      this.__controller.unbindEditablesEvents();
      this.__controller.container.removeClass('mq-editable-field');
    };
    makeEditable () {
      this.__controller.editable = true;
      this.__controller.editablesTextareaEvents();
      this.__controller.cursor.insAtRightEnd(this.__controller.root);
      this.__controller.container.addClass('mq-editable-field');
    };
  };
};
