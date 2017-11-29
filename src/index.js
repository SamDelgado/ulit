const ELEMENT_NODE = 1;
const TEXT_NODE = 3;
const COMMENT_NODE = 8;
const templateCache = new Map();
const walkPath = [];

function walkDOM(parent, element, fn) {
  fn(parent, element);
  if (element.childNodes.length > 0) {
    const cloneNodes = [].slice.call(element.childNodes, 0);
    cloneNodes.forEach((child, i) => {
      walkPath.push(i);
      walkDOM(element, child, fn);
      walkPath.pop();
    });
  }
}

function followPath(parent, pointer) {
  const cPath = pointer.slice(0);
  let element;
  if (parent != null) {
    while(cPath.length > 0) {
      const raw = cPath.unshift();
      const num = parseInt(raw);
      if (num !== NaN) {
        if (element == null) {
          element = parent.childNodes[num];
        } else {
          element = element.childNodes[num];
        }
      } else {
        element = [element, raw];
      }
    }
  }
  return element;
}

function templateSetup(parts) {
  return function(parent, element) {
    const nodeType = element.nodeType;
    if (nodeType === TEXT_NODE) {
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
            parts.push({
              id: Symbol(),
              path: walkPath.concat(cursor),
              start: null,
              end: null,
              dispose: null
            });
            cursor++;
          }
        });
        nodes.forEach(node => {
          parent.insertBefore(node, element);
        });
        parent.removeChild(element);
      }
    } else if (nodeType === ELEMENT_NODE) {
      [].forEach.call(element.attributes, attr => {
        if (attr.nodeValue === "{{}}") {
          parts.push({
            id: Symbol(),
            path: walkPath.concat(attr.nodeName),
            start: null,
            end: null,
            dispose: null
          });
        }
      });
    }
  }
}

function updateAttribute(element, name, value) {
  try {
    element[name] = value == null ? "" : value;
  } catch (_) {} // eslint-disable-line
  if (typeof expr !== "function") {
    if (value == null) {
      element.removeAttribute(name);
    } else {
      element.setAttribute(name, value);
    }
  }
}

function updateTextNode(part, value) {
  const element = part.start;
  const parent = element.parentNode;
  if (element.nodeType === COMMENT_NODE && typeof value === "string") {
    const newNode = document.createTextNode(value);
    parent.replaceChild(newNode, element);
    part.start = part.end = newNode;
  } else if (element.nodeType === TEXT_NODE && element.nodeValue !== value) {
    element.nodeValue = value;
  }
}

function updateNode(part, value) {
  const element = part.start;
  const parent = element.parentNode;
  parent.replaceChild(value, element);
  part.start = part.end = value;
}

function flushPart(part) {
  if (part.start !== part.end || part.end != null) {
    const parent = part.start.parentNode;
    let lastNode = part.end;
    while (lastNode) {
      const nextNode = lastNode.previousSibling;
      parent.removeChild(lastNode);
      if (nextNode !== part.start) {
        lastNode = nextNode;
      } else {
        lastNode = null;
      }
    }
  }
  return part.start;
}

function updateArray(part, value) {
  // TODO: add logic for rendering arrays...

}

export function render(template, target = null, part = null) {
  const parent = target != null ? target.parentNode : document.body;
  let instance =
    target.__template ||
    (parent &&
      parent.childNodes &&
      parent.childNodes.length > 0 &&
      parent.childNodes[0].__template)
      ? parent.childNodes[0].__template
      : null;
  if (instance) {
    instance.update(template.values);
    return;
  }
  if (target == null) {
    template.update();
    if (parent.childNodes.length > 0) {
      while (parent.hasChildNodes) {
        parent.removeChild(parent.lastChild);
      }
    }
    parent.appendChild(template.fragment.content);
    parent.childNodes[0].__template = template;
  } else if (target.nodeType === COMMENT_NODE && target === part.end) {
    template.update();
    template.fragment.content.__template = template;
    part.start = template.fragment.content.firstChild;
    part.end = template.fragment.content.lastChild;
    parent.replaceChild(template.fragment.content, target);
  }
}

function set(part, value) {
  const target = part.start;
  if (Array.isArray(target)) {
    const element = target[0];
    const name = target[1];
    updateAttribute(element, name, value);
  } else {
    if (typeof value === "string") {
      updateTextNode(part, value);
    } else if (value.nodeType === ELEMENT_NODE && target !== value) {
      updateNode(part, value);
    } else if (value.values && value.update) {
      render(value, target, part);
    } else if (Array.isArray(value)) {
      updateArray(part, value);
    } else if (value.then) {
      value.then(promised => {
        set(part, promised);
      });
    }
  }
}

function isDirective(target, expression) {
  return (
    typeof expression === "function" &&
    ((Array.isArray(target) && !target[1].startsWith("on")) ||
      !Array.isArray(target))
  );
}

function TemplateResult(template, parts, exprs) {
  let disposed = false;
  let initialized = false;
  const result = {
    template,
    fragment: null,
    dispose() {
      disposed = true;
      parts.forEach(part => typeof part.dispose === "function" ? part.dispose() : null);
    },
    update(values) {
      if (values == null) {
        values = exprs;
      } else {
        exprs = values;
      }
      if (!initialized) {
        result.fragment = document.importNode(template, true);
        parts.forEach(part => {
          part.start = followPath(result.fragment.content, part.path);
        });
        initialized = true;
      }
      parts.forEach((part, i) => {
        const target = part.start;
        const expression = values[i];
        if (isDirective(target, expression)) {
          expression(newValue => {
            set(part, newValue);
          },
          dispose => {
            part.dispose = dispose;
          },
          part.id);
        } else {
          set(part, expression);
        }
      });
    } 
  };
  initialized = false;
  return result;
}

export function html(strs, ...exprs) {
  const html = strs.join("{{}}");
  let { template, parts } = templateCache.get(strs) || { template: null, parts: [] };
  if (template == null) {
    template = document.createElement("template");
    template.innerHTML = html;
    const setupFn = templateSetup(parts);
    console.log(parts);
    [].forEach.call(template.content.children, (child, i) => {
      walkPath.push(i);
      walkDOM(template.content, child, setupFn);
      while(walkPath.length > 0) {
        walkPath.pop();
      }
    });
    templateCache.set(strs, { template, parts });
  }
  return TemplateResult(template, parts, exprs);
}
