const SVG_NS = "https://www.w3.org/2000/svg";
const ELEMENT_NODE = 1;
const TEXT_NODE = 3;
const COMMENT_NODE = 8;
const templateCache = new Map();
const idCache = new Map();
const keyMapCache = new Map();
const walkPath = [];

function walkDOM(parent, element, fn) {
  element && fn(parent, element);
  element || (element = parent);
  if (element.childNodes.length > 0) {
    [].forEach.call(element.childNodes, (child, index) => {
      walkPath.push(index);
      walkDOM(element, child, fn);
      walkPath.pop();
    });
  }
}

function followPath(node, pointer) {
  if (pointer.length === 0) {
    return node;
  }
  const cPath = pointer.slice(0);
  const curr = cPath.shift();
  const num = parseInt(curr);
  if (typeof curr === "string") {
    return [node, curr];
  } else if (!isNaN(num)) {
    return followPath(node.childNodes[num], cPath);
  } else {
    throw new RangeError("part path not found");
  }
}

function updateAttribute(part, value) {
  const element = part.start;
  const name = part.end;
  try {
    element[name] = value == null ? "" : value;
  } catch (_) {} // eslint-disable-line
  if (typeof expr !== "function") {
    if (value == null) {
      if (part.isSVG) {
        element.removeAttributeNS(SVG_NS, name);
      } else {
        element.removeAttribute(name);
      }
    } else {
      if (part.isSVG) {
        element.setAttributeNS(SVG_NS, name, value);
      } else {
        element.setAttribute(name, value);
      }
    }
  }
}

function updateNode(part, value) {
  const element = part.start;
  const parent = element.parentNode;
  if (element !== value) {
    parent.replaceChild(value, flushPart(part));
    part.start = part.end = value;
  }
}

function updateTextNode(part, value) {
  const element = part.start;
  const parent = element.parentNode;
  if (part.start !== part.end) {
    flushPart(part);
  }
  if (element.nodeType === TEXT_NODE && element.nodeValue !== value) {
    element.nodeValue = value;
  } else if (element.nodeType !== TEXT_NODE) {
    const newNode = document.createTextNode(value);
    parent.replaceChild(newNode, element);
    part.start = part.end = newNode;
  }
}

function isTemplate(obj) {
  return obj && obj.values && obj.parts && obj.update;
}

function defaultKeyFn(item, index) {
  return index;
}

function defaultTemplateFn(item) {
  return html`${item}`;
}

export function repeat(
  items,
  keyFn = defaultKeyFn,
  templateFn = defaultTemplateFn
) {
  return part => {
    const parent = part.start.parentNode;
    let init = false;
    const id = part.id;
    const map = keyMapCache.get(id);

    /* old code...
    const id = part.id;
    const keyMapPair = keyMapCache.get(id);
    if (!keyMapPair) {
      let templates;
      let newKeyMap;
      items.forEach(item => {
        const key = keyFn(item);
        const template = templateFn(item, key);
        templates.push(template);
        newKeyMap.push({ key, template });
      });
      keyMapCache.set(id, newKeyMap);
      part.update(templates);
    } else {
      const newMap = items.map(keyFn);
    */
      // TODO: do key comparisons here to efficiently add/move/remove dom nodes
      /* new code...
      const parent = part.start.parentNode;
      let init = false;
      const meta = part.meta.array || (init = true && []);
      const normalized = value.map(entry => {
        if (isTemplate(entry)) {
          return entry;
        }
        return defaultTemplateFn(value);
      });
      const normLen = normalized.length;
      const metaLen = meta.length;
      const maxLen = Math.max(normLen, metaLen);
      if (init) {
        const nodes = [];
        normalized.map(template => {
          nodes.push([document.createComment("{{}}"), template]);
        });
        nodes.forEach(entry => {
          parent.insertBefore(entry[0], part.start);
          render(entry[1], entry[0]);
        });
        parent.removeChild(part.start);
        part.start = nodes[0][1].start;
        part.end = nodes[normLen - 1][1].end;
      } else {
        let i = 0;
        for (; i < maxLen; i++) {
          if (i < normLen && i < metaLen) {
            meta[i].update(normalized[i].values);
          } else if (i < normLen && i > metaLen) {
            // add
            meta[i] = normalized[i];
            meta[i].update();
          } else if (i > normLen && i < metaLen) {
            // remove

          }
        }
      }
    }*/
  };
}
// saving bytes by sharing code for repeat and updateArray(),
// defaultKeyFn and defaultTemplateFn === updateArray()
function updateArray(part, value) {
  repeat(value)(part);
}

function set(part, value, oldValue) {
  if (typeof part.end === "string") {
    updateAttribute(part, value, oldValue);
  } else {
    if (
      typeof value !== "string" &&
      !Array.isArray(value) &&
      typeof value[Symbol.iterator] === "function"
    ) {
      value = Array.from(value);
    }
    if (value.then) {
      value.then(promised => {
        set(part, promised, oldValue);
      });
    } else if (isTemplate(value)) {
      render(value, part);
    } else if (value.nodeType) {
      updateNode(part, value);
    } else if (Array.isArray(value)) {
      updateArray(part, value);
    } else {
      updateTextNode(part, value);
    }
  }
}

function Part(path, isSVG = false, id = Symbol(), start = null, end = null) {
  const disposers = [];
  const part = {
    id,
    path,
    start,
    end,
    isSVG,
    update(newValue) {
      set(part, newValue);
    },
    addDisposer(handler) {
      if (typeof handler === "function" && disposers.indexOf(handler) === -1) {
        disposers.push(handler);
      }
    },
    removeDisposer(handler) {
      const index = disposers.indexOf(handler);
      if (index > -1) {
        disposers.splice(index, 1);
      }
    }
  };
  return part;
}

function isSVGChild(node) {
  let result = false;
  let cur = node;
  while (cur != null) {
    if (cur.nodeName === "SVG") {
      return true;
    } else {
      cur = cur.parentNode;
    }
  }
  return result;
}

function templateSetup(parts) {
  return function(parent, element) {
    const nodeType = element.nodeType;
    if (nodeType === TEXT_NODE) {
      const isSVG = isSVGChild(element);
      const text = element.nodeValue;
      const split = text.split("{{}}");
      const end = split.length - 1;
      const nodes = [];
      let cursor = 0;
      if (split.length > 0) {
        split.forEach((node, i) => {
          if (node !== "") {
            nodes.push(document.createTextNode(node));
            cursor++;
          }
          if (i < end) {
            nodes.push(document.createComment("{{}}"));
            const adjustedPath = walkPath.slice(0);
            const len = adjustedPath.length - 1;
            adjustedPath[len] += cursor;
            parts.push(Part(adjustedPath, isSVG));
            cursor++;
          }
        });
        nodes.forEach(node => {
          parent.insertBefore(node, element);
        });
        parent.removeChild(element);
      }
    } else if (nodeType === ELEMENT_NODE) {
      const isSVG = isSVGChild(element);
      [].forEach.call(element.attributes, attr => {
        if (attr.nodeValue === "{{}}") {
          parts.push(Part(walkPath.concat(attr.nodeName), isSVG));
        }
      });
    }
  };
}

function getChildTemplate(target) {
  if (
    target.childNodes &&
    target.childNodes.length > 0 &&
    target.childNodes[0].__template
  ) {
    return target.childNodes[0].__template;
  }
}

export function render(template, target = document.body) {
  const part = target.nodeType == null ? target : null;
  const instance =
    target.__template ||
    (part && part.start && part.start.__template) ||
    getChildTemplate(target);
  if (instance) {
    if (instance.key === template.key) {
      instance.update(template.values);
    } else {
      // TODO: handle case where new template is being rendered to this target...
      instance.dispose();
    }
    return;
  }
  template.update();
  if (part == null) {
    if (target.childNodes.length > 0) {
      while (target.hasChildNodes) {
        target.removeChild(target.lastChild);
      }
    }
    target.appendChild(template.fragment.content);
    target.childNodes[0].__template = template;
  } else {
    const start = part.start;
    const parent = start.parentNode;
    part.start = template.fragment.content.firstChild;
    part.end = template.fragment.content.lastChild;
    parent.replaceChild(template.fragment.content, start);
    part.start.__template = template;
  }
}

function isDirective(part, expression) {
  const end = part.end;
  if (typeof expression === "function") {
    if (typeof end !== "string") {
      return true;
    } else if (end.startsWith("on")) {
      return false;
    } else {
      return true;
    }
  } else {
    return false;
  }
}

function isPartComment(node) {
  if (node.nodeType === COMMENT_NODE && node.nodeValue === "{{}}") {
    return true;
  } else {
    return false;
  }
}

function flushPart(part) {
  const start = part.start;
  const parent = start.parentNode;
  const end = part.end;
  if (start === end) {
    return start;
  }
  let curr = end != null ? end.previousSibling : null;
  while (curr != null && curr !== start) {
    const nextNode = curr.previousSibling;
    parent.removeChild(curr);
    curr = nextNode;
  }
  return start;
}

function TemplateResult(key, template, parts, exprs) {
  const result = {
    key,
    fragment: null,
    start: null,
    end: null,
    values: exprs,
    parts,
    dispose() {
      parts.forEach(part =>
        part.disposers.forEach(
          dispose => typeof dispose === "function" && dispose()
        )
      );
      result.start = result.end = flushPart(result);
    },
    update(values) {
      const lastValues = result.values;
      if (values != null) {
        result.values = values;
      }
      if (!result.fragment) {
        result.fragment = document.importNode(template, true);
        const templateStart = result.fragment.content.firstChild;
        const templateEnd = result.fragment.content.lastChild;
        result.start = isPartComment(templateStart) ? parts[0] : templateStart;
        result.end = isPartComment(templateEnd)
          ? parts[parts.length - 1]
          : templateEnd;
        parts.forEach(part => {
          const target = followPath(result.fragment.content, part.path);
          if (Array.isArray(target)) {
            part.start = target[0];
            part.end = target[1];
          } else {
            part.start = target;
          }
          part.update = newValue => set(part, newValue);
        });
      }
      parts.forEach((part, i) => {
        const oldVal = lastValues[i];
        const newVal = result.values[i];
        if (isDirective(part, newVal)) {
          newVal(part);
        } else {
          set(part, newVal, oldVal);
        }
      });
    }
  };
  return result;
}

function parseSerializedParts(value) {
  if (value.startsWith("{{ps:") && value.endsWith("}}")) {
    return JSON.parse(value.split("{{ps:")[1].slice(0, -2));
  } else {
    return [];
  }
}

function isFirstChildSerializedParts(parent) {
  const child = parent.firstChild;
  return (
    child.nodeType === COMMENT_NODE &&
    child.nodeValue.startsWith("{{parts:") &&
    child.nodeValue.endsWith("}}")
  );
}

function checkForSerialized(hash) {
  const template = document.getElementById(`template-${hash}`);
  // <!--{{parts:[[0,1,1],...]}}-->
  const parts =
    template != null && isFirstChildSerializedParts(template.content)
      ? parseSerializedParts(
          template.content.removeChild(template.content.firstChild).nodeValue
        )
      : [];
  const result = { template, parts };
  template && !templateCache.has(hash) && templateCache.set(hash, result);
  return result;
}

function generateId(strs) {
  const templateStr = strs.toString();
  let hash = 0;
  if (templateStr.length === 0) {
    return hash;
  }
  for (let i = 0; i < templateStr.length; i++) {
    const char = templateStr.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return hash;
}

export function html(strs, ...exprs) {
  const id = idCache.get(strs) || generateId(strs);
  let { template, parts } = templateCache.get(id) || checkForSerialized(id);
  if (template == null) {
    template = document.createElement("template");
    template.innerHTML = strs.join("{{}}");
    walkDOM(template.content, null, templateSetup(parts));
    templateCache.set(id, { template, parts });
  }
  return TemplateResult(strs, template, parts, exprs);
}

export function until(promise, defaultContent) {
  return ({ update }) => {
    update(defaultContent);
    return promise;
  };
}

function pullPart(part) {
  const frag = document.createDocumentFragment();
  const stack = [];
  const parent = part.start.parentNode;
  let cur = part.end;
  while (cur != null) {
    const next = cur.previousSibling;
    stack.push(parent.removeChild(cur));
    if (cur === part.start) {
      cur = null;
    } else {
      cur = next;
    }
  }
  while (stack.length > 0) {
    frag.appendChild(stack.pop());
  }
  return frag;
}
