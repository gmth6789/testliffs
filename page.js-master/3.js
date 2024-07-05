var isarray =
  Array.isArray ||
  function (arr) {
    return Object.prototype.toString.call(arr) == "[object Array]";
  };

var pathToRegexp_1 = pathToRegexp;
var parse_1 = parse;
var compile_1 = compile;
var tokensToFunction_1 = tokensToFunction;
var tokensToRegExp_1 = tokensToRegExp;

var PATH_REGEXP = new RegExp(
  [
    "(\\\\.)",

    "([\\/.])?(?:(?:\\:(\\w+)(?:\\(((?:\\\\.|[^()])+)\\))?|\\(((?:\\\\.|[^()])+)\\))([+*?])?|(\\*))",
  ].join("|"),
  "g"
);

function parse(str) {
  var tokens = [];
  var key = 0;
  var index = 0;
  var path = "";
  var res;

  while ((res = PATH_REGEXP.exec(str)) != null) {
    var m = res[0];
    var escaped = res[1];
    var offset = res.index;
    path += str.slice(index, offset);
    index = offset + m.length;

    // Ignore already escaped sequences.
    if (escaped) {
      path += escaped[1];
      continue;
    }

    // Push the current path onto the tokens.
    if (path) {
      tokens.push(path);
      path = "";
    }

    var prefix = res[2];
    var name = res[3];
    var capture = res[4];
    var group = res[5];
    var suffix = res[6];
    var asterisk = res[7];

    var repeat = suffix === "+" || suffix === "*";
    var optional = suffix === "?" || suffix === "*";
    var delimiter = prefix || "/";
    var pattern =
      capture || group || (asterisk ? ".*" : "[^" + delimiter + "]+?");

    tokens.push({
      name: name || key++,
      prefix: prefix || "",
      delimiter: delimiter,
      optional: optional,
      repeat: repeat,
      pattern: escapeGroup(pattern),
    });
  }

  // Match any characters still remaining.
  if (index < str.length) {
    path += str.substr(index);
  }

  // If the path exists, push it onto the end.
  if (path) {
    tokens.push(path);
  }

  return tokens;
}

function compile(str) {
  return tokensToFunction(parse(str));
}

function tokensToFunction(tokens) {
  var matches = new Array(tokens.length);

  // Compile all the patterns before compilation.
  for (var i = 0; i < tokens.length; i++) {
    if (typeof tokens[i] === "object") {
      matches[i] = new RegExp("^" + tokens[i].pattern + "$");
    }
  }

  return function (obj) {
    var path = "";
    var data = obj || {};

    for (var i = 0; i < tokens.length; i++) {
      var token = tokens[i];

      if (typeof token === "string") {
        path += token;

        continue;
      }

      var value = data[token.name];
      var segment;

      if (value == null) {
        if (token.optional) {
          continue;
        } else {
          throw new TypeError('Expected "' + token.name + '" to be defined');
        }
      }

      if (isarray(value)) {
        if (!token.repeat) {
          throw new TypeError(
            'Expected "' +
              token.name +
              '" to not repeat, but received "' +
              value +
              '"'
          );
        }

        if (value.length === 0) {
          if (token.optional) {
            continue;
          } else {
            throw new TypeError(
              'Expected "' + token.name + '" to not be empty'
            );
          }
        }

        for (var j = 0; j < value.length; j++) {
          segment = encodeURIComponent(value[j]);

          if (!matches[i].test(segment)) {
            throw new TypeError(
              'Expected all "' +
                token.name +
                '" to match "' +
                token.pattern +
                '", but received "' +
                segment +
                '"'
            );
          }

          path += (j === 0 ? token.prefix : token.delimiter) + segment;
        }

        continue;
      }

      segment = encodeURIComponent(value);

      if (!matches[i].test(segment)) {
        throw new TypeError(
          'Expected "' +
            token.name +
            '" to match "' +
            token.pattern +
            '", but received "' +
            segment +
            '"'
        );
      }

      path += token.prefix + segment;
    }

    return path;
  };
}

function escapeString(str) {
  return str.replace(/([.+*?=^!:${}()[\]|\/])/g, "\\$1");
}

function escapeGroup(group) {
  return group.replace(/([=!:$\/()])/g, "\\$1");
}

function attachKeys(re, keys) {
  re.keys = keys;
  return re;
}

function flags(options) {
  return options.sensitive ? "" : "i";
}

function regexpToRegexp(path, keys) {
  var groups = path.source.match(/\((?!\?)/g);

  if (groups) {
    for (var i = 0; i < groups.length; i++) {
      keys.push({
        name: i,
        prefix: null,
        delimiter: null,
        optional: false,
        repeat: false,
        pattern: null,
      });
    }
  }

  return attachKeys(path, keys);
}

function arrayToRegexp(path, keys, options) {
  var parts = [];

  for (var i = 0; i < path.length; i++) {
    parts.push(pathToRegexp(path[i], keys, options).source);
  }

  var regexp = new RegExp("(?:" + parts.join("|") + ")", flags(options));

  return attachKeys(regexp, keys);
}

function stringToRegexp(path, keys, options) {
  var tokens = parse(path);
  var re = tokensToRegExp(tokens, options);

  // Attach keys back to the regexp.
  for (var i = 0; i < tokens.length; i++) {
    if (typeof tokens[i] !== "string") {
      keys.push(tokens[i]);
    }
  }

  return attachKeys(re, keys);
}

function tokensToRegExp(tokens, options) {
  options = options || {};

  var strict = options.strict;
  var end = options.end !== false;
  var route = "";
  var lastToken = tokens[tokens.length - 1];
  var endsWithSlash = typeof lastToken === "string" && /\/$/.test(lastToken);

  // Iterate over the tokens and create our regexp string.
  for (var i = 0; i < tokens.length; i++) {
    var token = tokens[i];

    if (typeof token === "string") {
      route += escapeString(token);
    } else {
      var prefix = escapeString(token.prefix);
      var capture = token.pattern;

      if (token.repeat) {
        capture += "(?:" + prefix + capture + ")*";
      }

      if (token.optional) {
        if (prefix) {
          capture = "(?:" + prefix + "(" + capture + "))?";
        } else {
          capture = "(" + capture + ")?";
        }
      } else {
        capture = prefix + "(" + capture + ")";
      }

      route += capture;
    }
  }

  if (!strict) {
    route = (endsWithSlash ? route.slice(0, -2) : route) + "(?:\\/(?=$))?";
  }

  if (end) {
    route += "$";
  } else {
    route += strict && endsWithSlash ? "" : "(?=\\/|$)";
  }

  return new RegExp("^" + route, flags(options));
}

function pathToRegexp(path, keys, options) {
  keys = keys || [];

  if (!isarray(keys)) {
    options = keys;
    keys = [];
  } else if (!options) {
    options = {};
  }

  if (path instanceof RegExp) {
    return regexpToRegexp(path, keys, options);
  }

  if (isarray(path)) {
    return arrayToRegexp(path, keys, options);
  }

  return stringToRegexp(path, keys, options);
}

pathToRegexp_1.parse = parse_1;
pathToRegexp_1.compile = compile_1;
pathToRegexp_1.tokensToFunction = tokensToFunction_1;
pathToRegexp_1.tokensToRegExp = tokensToRegExp_1;

var hasDocument = "undefined" !== typeof document;
var hasWindow = "undefined" !== typeof window;
var hasHistory = "undefined" !== typeof history;
var hasProcess = typeof process !== "undefined";

var clickEvent = hasDocument && document.ontouchstart ? "touchstart" : "click";

var isLocation = hasWindow && !!(window.history.location || window.location);

function Page() {
  // public things
  this.callbacks = [];
  this.exits = [];
  this.current = "";
  this.len = 0;

  // private things
  this._decodeURLComponents = true;
  this._base = "";
  this._strict = false;
  this._running = false;
  this._hashbang = false;

  // bound functions
  this.clickHandler = this.clickHandler.bind(this);
  this._onpopstate = this._onpopstate.bind(this);
}

Page.prototype.configure = function (options) {
  var opts = options || {};

  this._window = opts.window || (hasWindow && window);
  this._decodeURLComponents = opts.decodeURLComponents !== false;
  this._popstate = opts.popstate !== false && hasWindow;
  this._click = opts.click !== false && hasDocument;
  this._hashbang = !!opts.hashbang;

  var _window = this._window;
  if (this._popstate) {
    _window.addEventListener("popstate", this._onpopstate, false);
  } else if (hasWindow) {
    _window.removeEventListener("popstate", this._onpopstate, false);
  }

  if (this._click) {
    _window.document.addEventListener(clickEvent, this.clickHandler, false);
  } else if (hasDocument) {
    _window.document.removeEventListener(clickEvent, this.clickHandler, false);
  }

  if (this._hashbang && hasWindow && !hasHistory) {
    _window.addEventListener("hashchange", this._onpopstate, false);
  } else if (hasWindow) {
    _window.removeEventListener("hashchange", this._onpopstate, false);
  }
};

Page.prototype.base = function (path) {
  if (0 === arguments.length) return this._base;
  this._base = path;
};

Page.prototype._getBase = function () {
  var base = this._base;
  if (!!base) return base;
  var loc = hasWindow && this._window && this._window.location;

  if (hasWindow && this._hashbang && loc && loc.protocol === "file:") {
    base = loc.pathname;
  }

  return base;
};

Page.prototype.strict = function (enable) {
  if (0 === arguments.length) return this._strict;
  this._strict = enable;
};

Page.prototype.start = function (options) {
  var opts = options || {};
  this.configure(opts);

  if (false === opts.dispatch) return;
  this._running = true;

  var url;
  if (isLocation) {
    var window = this._window;
    var loc = window.location;

    if (this._hashbang && ~loc.hash.indexOf("#!")) {
      url = loc.hash.substr(2) + loc.search;
    } else if (this._hashbang) {
      url = loc.search + loc.hash;
    } else {
      url = loc.pathname + loc.search + loc.hash;
    }
  }

  this.replace(url, null, true, opts.dispatch);
};

Page.prototype.stop = function () {
  if (!this._running) return;
  this.current = "";
  this.len = 0;
  this._running = false;

  var window = this._window;
  this._click &&
    window.document.removeEventListener(clickEvent, this.clickHandler, false);
  hasWindow && window.removeEventListener("popstate", this._onpopstate, false);
  hasWindow &&
    window.removeEventListener("hashchange", this._onpopstate, false);
};

Page.prototype.show = function (path, state, dispatch, push) {
  var ctx = new Context(path, state, this),
    prev = this.prevContext;
  this.prevContext = ctx;
  this.current = ctx.path;
  if (false !== dispatch) this.dispatch(ctx, prev);
  if (false !== ctx.handled && false !== push) ctx.pushState();
  return ctx;
};

Page.prototype.back = function (path, state) {
  var page = this;
  if (this.len > 0) {
    var window = this._window;

    hasHistory && window.history.back();
    this.len--;
  } else if (path) {
    setTimeout(function () {
      page.show(path, state);
    });
  } else {
    setTimeout(function () {
      page.show(page._getBase(), state);
    });
  }
};

Page.prototype.redirect = function (from, to) {
  var inst = this;

  // Define route from a path to another
  if ("string" === typeof from && "string" === typeof to) {
    page.call(this, from, function (e) {
      setTimeout(function () {
        inst.replace(/** @type {!string} */ (to));
      }, 0);
    });
  }

  // Wait for the push state and replace it with another
  if ("string" === typeof from && "undefined" === typeof to) {
    setTimeout(function () {
      inst.replace(from);
    }, 0);
  }
};

Page.prototype.replace = function (path, state, init, dispatch) {
  var ctx = new Context(path, state, this),
    prev = this.prevContext;
  this.prevContext = ctx;
  this.current = ctx.path;
  ctx.init = init;
  ctx.save(); // save before dispatching, which may redirect
  if (false !== dispatch) this.dispatch(ctx, prev);
  return ctx;
};

Page.prototype.dispatch = function (ctx, prev) {
  var i = 0,
    j = 0,
    page = this;

  function nextExit() {
    var fn = page.exits[j++];
    if (!fn) return nextEnter();
    fn(prev, nextExit);
  }

  function nextEnter() {
    var fn = page.callbacks[i++];

    if (ctx.path !== page.current) {
      ctx.handled = false;
      return;
    }
    if (!fn) return unhandled.call(page, ctx);
    fn(ctx, nextEnter);
  }

  if (prev) {
    nextExit();
  } else {
    nextEnter();
  }
};

Page.prototype.exit = function (path, fn) {
  if (typeof path === "function") {
    return this.exit("*", path);
  }

  var route = new Route(path, null, this);
  for (var i = 1; i < arguments.length; ++i) {
    this.exits.push(route.middleware(arguments[i]));
  }
};

Page.prototype.clickHandler = function (e) {
  if (1 !== this._which(e)) return;

  if (e.metaKey || e.ctrlKey || e.shiftKey) return;
  if (e.defaultPrevented) return;

  var el = e.target;
  var eventPath = e.path || (e.composedPath ? e.composedPath() : null);

  if (eventPath) {
    for (var i = 0; i < eventPath.length; i++) {
      if (!eventPath[i].nodeName) continue;
      if (eventPath[i].nodeName.toUpperCase() !== "A") continue;
      if (!eventPath[i].href) continue;

      el = eventPath[i];
      break;
    }
  }

  while (el && "A" !== el.nodeName.toUpperCase()) el = el.parentNode;
  if (!el || "A" !== el.nodeName.toUpperCase()) return;

  var svg =
    typeof el.href === "object" &&
    el.href.constructor.name === "SVGAnimatedString";

  if (el.hasAttribute("download") || el.getAttribute("rel") === "external")
    return;

  var link = el.getAttribute("href");
  if (!this._hashbang && this._samePath(el) && (el.hash || "#" === link))
    return;

  if (link && link.indexOf("mailto:") > -1) return;

  if (svg ? el.target.baseVal : el.target) return;

  if (!svg && !this.sameOrigin(el.href)) return;

  var path = svg ? el.href.baseVal : el.pathname + el.search + (el.hash || "");

  path = path[0] !== "/" ? "/" + path : path;

  if (hasProcess && path.match(/^\/[a-zA-Z]:\//)) {
    path = path.replace(/^\/[a-zA-Z]:\//, "/");
  }

  var orig = path;
  var pageBase = this._getBase();

  if (path.indexOf(pageBase) === 0) {
    path = path.substr(pageBase.length);
  }

  if (this._hashbang) path = path.replace("#!", "");

  if (
    pageBase &&
    orig === path &&
    (!isLocation || this._window.location.protocol !== "file:")
  ) {
    return;
  }

  e.preventDefault();
  this.show(orig);
};

Page.prototype._onpopstate = (function () {
  var loaded = false;
  if (!hasWindow) {
    return function () {};
  }
  if (hasDocument && document.readyState === "complete") {
    loaded = true;
  } else {
    window.addEventListener("load", function () {
      setTimeout(function () {
        loaded = true;
      }, 0);
    });
  }
  return function onpopstate(e) {
    if (!loaded) return;
    var page = this;
    if (e.state) {
      var path = e.state.path;
      page.replace(path, e.state);
    } else if (isLocation) {
      var loc = page._window.location;
      page.show(
        loc.pathname + loc.search + loc.hash,
        undefined,
        undefined,
        false
      );
    }
  };
})();

Page.prototype._which = function (e) {
  e = e || (hasWindow && this._window.event);
  return null == e.which ? e.button : e.which;
};

Page.prototype._toURL = function (href) {
  var window = this._window;
  if (typeof URL === "function" && isLocation) {
    return new URL(href, window.location.toString());
  } else if (hasDocument) {
    var anc = window.document.createElement("a");
    anc.href = href;
    return anc;
  }
};

Page.prototype.sameOrigin = function (href) {
  if (!href || !isLocation) return false;

  var url = this._toURL(href);
  var window = this._window;

  var loc = window.location;

  return (
    loc.protocol === url.protocol &&
    loc.hostname === url.hostname &&
    (loc.port === url.port ||
      (loc.port === "" && (url.port == 80 || url.port == 443)))
  ); // jshint ignore:line
};

Page.prototype._samePath = function (url) {
  if (!isLocation) return false;
  var window = this._window;
  var loc = window.location;
  return url.pathname === loc.pathname && url.search === loc.search;
};

Page.prototype._decodeURLEncodedURIComponent = function (val) {
  if (typeof val !== "string") {
    return val;
  }
  return this._decodeURLComponents
    ? decodeURIComponent(val.replace(/\+/g, " "))
    : val;
};

function createPage() {
  var pageInstance = new Page();

  function pageFn(/* args */) {
    return page.apply(pageInstance, arguments);
  }

  // Copy all of the things over. In 2.0 maybe we use setPrototypeOf
  pageFn.callbacks = pageInstance.callbacks;
  pageFn.exits = pageInstance.exits;
  pageFn.base = pageInstance.base.bind(pageInstance);
  pageFn.strict = pageInstance.strict.bind(pageInstance);
  pageFn.start = pageInstance.start.bind(pageInstance);
  pageFn.stop = pageInstance.stop.bind(pageInstance);
  pageFn.show = pageInstance.show.bind(pageInstance);
  pageFn.back = pageInstance.back.bind(pageInstance);
  pageFn.redirect = pageInstance.redirect.bind(pageInstance);
  pageFn.replace = pageInstance.replace.bind(pageInstance);
  pageFn.dispatch = pageInstance.dispatch.bind(pageInstance);
  pageFn.exit = pageInstance.exit.bind(pageInstance);
  pageFn.configure = pageInstance.configure.bind(pageInstance);
  pageFn.sameOrigin = pageInstance.sameOrigin.bind(pageInstance);
  pageFn.clickHandler = pageInstance.clickHandler.bind(pageInstance);

  pageFn.create = createPage;

  Object.defineProperty(pageFn, "len", {
    get: function () {
      return pageInstance.len;
    },
    set: function (val) {
      pageInstance.len = val;
    },
  });

  Object.defineProperty(pageFn, "current", {
    get: function () {
      return pageInstance.current;
    },
    set: function (val) {
      pageInstance.current = val;
    },
  });

  // In 2.0 these can be named exports
  pageFn.Context = Context;
  pageFn.Route = Route;

  return pageFn;
}

function page(path, fn) {
  // <callback>
  if ("function" === typeof path) {
    return page.call(this, "*", path);
  }

  // route <path> to <callback ...>
  if ("function" === typeof fn) {
    var route = new Route(/** @type {string} */ (path), null, this);
    for (var i = 1; i < arguments.length; ++i) {
      this.callbacks.push(route.middleware(arguments[i]));
    }
    // show <path> with [state]
  } else if ("string" === typeof path) {
    this["string" === typeof fn ? "redirect" : "show"](path, fn);
    // start [options]
  } else {
    this.start(path);
  }
}

function unhandled(ctx) {
  if (ctx.handled) return;
  var current;
  var page = this;
  var window = page._window;

  if (page._hashbang) {
    current =
      isLocation && this._getBase() + window.location.hash.replace("#!", "");
  } else {
    current = isLocation && window.location.pathname + window.location.search;
  }

  if (current === ctx.canonicalPath) return;
  page.stop();
  ctx.handled = false;
  isLocation && (window.location.href = ctx.canonicalPath);
}

function escapeRegExp(s) {
  return s.replace(/([.+*?=^!:${}()[\]|/\\])/g, "\\$1");
}

function Context(path, state, pageInstance) {
  var _page = (this.page = pageInstance || page);
  var window = _page._window;
  var hashbang = _page._hashbang;

  var pageBase = _page._getBase();
  if ("/" === path[0] && 0 !== path.indexOf(pageBase))
    path = pageBase + (hashbang ? "#!" : "") + path;
  var i = path.indexOf("?");

  this.canonicalPath = path;
  var re = new RegExp("^" + escapeRegExp(pageBase));
  this.path = path.replace(re, "") || "/";
  if (hashbang) this.path = this.path.replace("#!", "") || "/";

  this.title = hasDocument && window.document.title;
  this.state = state || {};
  this.state.path = path;
  this.querystring = ~i
    ? _page._decodeURLEncodedURIComponent(path.slice(i + 1))
    : "";
  this.pathname = _page._decodeURLEncodedURIComponent(
    ~i ? path.slice(0, i) : path
  );
  this.params = {};

  // fragment
  this.hash = "";
  if (!hashbang) {
    if (!~this.path.indexOf("#")) return;
    var parts = this.path.split("#");
    this.path = this.pathname = parts[0];
    this.hash = _page._decodeURLEncodedURIComponent(parts[1]) || "";
    this.querystring = this.querystring.split("#")[0];
  }
}

Context.prototype.pushState = function () {
  var page = this.page;
  var window = page._window;
  var hashbang = page._hashbang;

  page.len++;
  if (hasHistory) {
    window.history.pushState(
      this.state,
      this.title,
      hashbang && this.path !== "/" ? "#!" + this.path : this.canonicalPath
    );
  }
};

Context.prototype.save = function () {
  var page = this.page;
  if (hasHistory) {
    page._window.history.replaceState(
      this.state,
      this.title,
      page._hashbang && this.path !== "/"
        ? "#!" + this.path
        : this.canonicalPath
    );
  }
};

function Route(path, options, page) {
  var _page = (this.page = page || globalPage);
  var opts = options || {};
  opts.strict = opts.strict || _page._strict;
  this.path = path === "*" ? "(.*)" : path;
  this.method = "GET";
  this.regexp = pathToRegexp_1(this.path, (this.keys = []), opts);
}

Route.prototype.middleware = function (fn) {
  var self = this;
  return function (ctx, next) {
    if (self.match(ctx.path, ctx.params)) {
      ctx.routePath = self.path;
      return fn(ctx, next);
    }
    next();
  };
};

Route.prototype.match = function (path, params) {
  var keys = this.keys,
    qsIndex = path.indexOf("?"),
    pathname = ~qsIndex ? path.slice(0, qsIndex) : path,
    m = this.regexp.exec(decodeURIComponent(pathname));

  if (!m) return false;

  delete params[0];

  for (var i = 1, len = m.length; i < len; ++i) {
    var key = keys[i - 1];
    var val = this.page._decodeURLEncodedURIComponent(m[i]);
    if (val !== undefined || !hasOwnProperty.call(params, key.name)) {
      params[key.name] = val;
    }
  }

  return true;
};

var globalPage = createPage();
var page_js = globalPage;
var default_1 = globalPage;

page_js.default = default_1;

export default page_js;
