/* @flow */
const SVG_NS = "https://www.w3.org/2000/svg";
const ELEMENT_NODE = 1;
const TEXT_NODE = 3;
const COMMENT_NODE = 8;
const DOCUMENT_FRAGMENT = 11;
const templateCache = new Map();
const idCache = new Map();
const keyMapCache = new Map();
const walkPath = [];

function invariant<T>(x: ?T): T {
  if (!x) {
    throw new RangeError(1);
  }
  return x;
}

type WalkFn = (parent: Node, element: ?Node) => void;

/**
 * This function walks a html document and executes the supplied function
 * on each node.
 * @param {HTMLElement} parent
 * @param {?Node} element
 * @param {WalkFn} fn
 */
function walkDOM(parent: HTMLElement, element: ?Node, fn: WalkFn) {
  element && fn(parent, element);
  element || (element = parent);
  if (element && element.childNodes.length > 0) {
    if (element == null) {
      throw new RangeError(2);
    }
    [].forEach.call(element.childNodes, (child, index) => {
      walkPath.push(index);
      walkDOM(((element: any): HTMLElement), child, fn);
      walkPath.pop();
    });
  }
}

function followDOMPath(
  node: ?Node,
  pointer: Array<string | number>
): Array<any> | ?Node {
  if (
    pointer.length === 0 ||
    node == null ||
    (node && (node.nodeType === TEXT_NODE || node.nodeType === COMMENT_NODE))
  ) {
    return node;
  }
  const cPath = pointer.slice(0);
  const curr = cPath.shift();
  const num = parseInt(curr);
  if (typeof curr === "string") {
    return [node, curr];
  } else if (!isNaN(num)) {
    const el: ?Node =
      node &&
      node.childNodes &&
      node.childNodes.length < num &&
      node.childNodes[num]
        ? node.childNodes[num]
        : null;
    if (!el) {
      console.log(node, node.childNodes, node.childNodes.length);
    }
    return followDOMPath(el, cPath);
  } else {
    throw new RangeError("part path not found");
  }
}

function isNode(x: any): boolean {
  if (
    x &&
    x.nodeType &&
    x.removeAttribute &&
    x.removeAttributeNS &&
    x.setAttribute &&
    x.setAttributeNS
  ) {
    return true;
  } else {
    return false;
  }
}

function isPart(x: any): boolean {
  if (x.id != null && Array.isArray(x.path) && !x.nodeType) {
    return true;
  } else {
    return false;
  }
}

type PartEdge = "start" | "end";
function findPartEdge(part: Part, edge: PartEdge): Node {
  let cur: ?Node | Part | string = part && part[edge];
  while (cur != null) {
    if (isPart(cur)) {
      // $FlowFixMe
      cur = cur[edge];
    } else if (isNode(cur)) {
      return cur;
    }
  }
  throw new RangeError();
}

function removeAttribute(part, element, name) {
  if (element == null) throw new RangeError();
  if (part.isSVG) {
    element.removeAttributeNS(SVG_NS, name);
  } else {
    element.removeAttribute(name);
  }
}

function setAttribute(part, element, name, value) {
  if (element == null) throw new RangeError();
  if (part.isSVG) {
    element.setAttributeNS(SVG_NS, name, value);
  } else {
    element.setAttribute(name, value);
  }
}

function updateAttribute(part: Part, value: any) {
  const element: ?HTMLElement = findPartEdge(part, "start");
  const name = typeof part.end === "string" ? part.end : "";
  try {
    element[name] = value == null ? "" : value;
  } catch (_) {} // eslint-disable-line
  if (typeof value !== "function" && isNode(element)) {
    if (value == null) {
      removeAttribute(part, element, name);
    } else {
      setAttribute(part, element, name, value);
    }
  }
}

function updateNode(part: Part, value: any) {
  const element: ?HTMLElement = findPartEdge(part, "start");
  const parent = element && element.parentNode;
  if (!parent) throw new RangeError(6);
  if (element !== value) {
    const isFrag = value.nodeType === DOCUMENT_FRAGMENT;
    const newStart = isFrag ? value.firstChild : value;
    const newEnd = isFrag ? value.lastChild : value;
    parent.replaceChild(value, flushPart(part));
    part.start = newStart;
    part.end = newEnd;
  }
}

function updateTextNode(part: Part, value: any) {
  const element = findPartEdge(part, "start");
  const parent = element && element.parentNode;
  if (part.start !== part.end) {
    flushPart(part);
  }
  if (element == null) throw new RangeError();
  if (element.nodeType === TEXT_NODE && element.nodeValue !== value) {
    element.nodeValue = value;
  } else {
    const newNode = document.createTextNode(value);
    if (!parent) throw new RangeError(7);
    parent.replaceChild(newNode, element);
    part.start = part.end = newNode;
  }
}

function isTemplate(x: any): boolean {
  return x && x.values && x.parts && x.update;
}

function defaultKeyFn(item: any, index: number): string | number {
  return index;
}

function defaultTemplateFn(item: any): TemplateResult {
  return html`${item}`;
}

type PartDispose = (part: Part) => void;
type PartUpdate = (value: ?PartValue) => void;
type PartDisposeHandler = (handler: PartDispose) => void;

type Part = {
  id: any,
  path: Array<string | number>,
  start: ?Node | Part,
  end: ?Node | Part | string,
  isSVG: ?boolean,
  update: PartUpdate,
  addDisposer: PartDisposeHandler,
  removeDisposer: (handler: PartDispose) => void
};

function createPart(
  path: Array<string | number>,
  isSVG?: boolean = false,
  id?: any = Symbol(),
  start?: ?Node = null,
  end?: ?Node | string = null
): Part {
  const disposers = [];
  const part: Part = {
    id,
    path,
    start,
    end,
    isSVG,
    update(value: ?PartValue) {
      if (value == null) return;
      set(part, value);
    },
    addDisposer(handler: PartDispose) {
      if (typeof handler === "function" && disposers.indexOf(handler) === -1) {
        disposers.push(handler);
      }
    },
    removeDisposer(handler: PartDispose) {
      const index = disposers.indexOf(handler);
      if (index > -1) {
        disposers.splice(index, 1);
      }
    }
  };
  return part;
}

function findParentNode(part: ?Node | Part): ?Node {
  if (isPart(part)) {
    const start = invariant(findPartEdge(part, "start"));
    return start && start.parentNode;
  } else if (isNode(part)) {
    const parent = part && part.parentNode;
    if ((part && !isNode(part)) || (parent && !isNode(parent))) {
      throw new RangeError(8);
    }
    return parent;
  }
}

type PulledPart = {
  part: Part,
  fragment: DocumentFragment
};

export function pullPart(part: Part): PulledPart {
  const fragment = document.createDocumentFragment();
  const stack = [];
  let cur = findPartEdge(part, "end");
  const parent = cur && cur.parentNode;
  if (parent == null) throw new RangeError(9);
  while (cur !== part.start && cur != null) {
    const next = cur.previousSibling;
    stack.push(parent.removeChild(cur));
    cur = next;
  }
  while (stack.length > 0) {
    fragment.appendChild(stack.pop());
  }
  return { part, fragment };
}

type Directive = Part => void;

type PartValue =
  | number
  | string
  | HTMLElement
  | DocumentFragment
  | Promise<PartValue>
  | Directive
  | Array<PartValue>
  | TemplateResult;

export function repeat(
  items: Array<any>,
  keyFn: typeof defaultKeyFn = defaultKeyFn,
  templateFn: typeof defaultTemplateFn = defaultTemplateFn
): Directive {
  return (part: Part) => {
    const target = invariant(findPartEdge(part, "start"));
    const parent = invariant(findParentNode(part));
    const id = part.id;
    const isSVG = part.isSVG;
    const normalized = items.map(item => {
      if (isTemplate(item)) {
        return item;
      }
      return templateFn(item);
    });
    const keys = items.map((item, index) => keyFn(item, index));
    const cacheEntry = keyMapCache.get(id);
    let map: { [any]: Part } = {};
    let list: Array<number | string> = [];
    if (cacheEntry && cacheEntry.map && cacheEntry.list) {
      map = cacheEntry.map;
      list = cacheEntry.list;
    }
    let i = 0;
    if (!map && target && target.nodeType === COMMENT_NODE) {
      const fragment = document.createDocumentFragment();
      let len = keys.length;
      for (; i < len; i++) {
        const key = keys[i];
        const node = document.createComment("{{}}");
        let newPart: Part = createPart(
          [0, 0],
          isSVG || false,
          Symbol(),
          node,
          node
        );
        if (i === 0) {
          part.start = newPart;
        } else if (i === len) {
          part.end = newPart;
        }
        list.push(key);
        map[key] = newPart;
        fragment.appendChild(node);
        render(normalized[i], newPart);
      }
      keyMapCache.set(id, { map, list });
      // TODO: figure out why parent is nullish here...
      parent && parent.replaceChild(fragment, target);
      return;
    }
    const normLen = normalized.length;
    const oldLen = list && list.length;
    const maxLen = Math.max(normLen, oldLen || 0);
    Object.keys(map).forEach(key => {
      if (keys.indexOf(key) === -1) {
        const partToRemove = map[key];
        pullPart(partToRemove);
        list.splice(list.indexOf(partToRemove), 1);
        delete map[key];
      }
    });
    for (i = 0; i < maxLen; i++) {
      const newKey = keys[i];
      const newTemplate = normalized[i];
      const oldKey = list[i];
      const oldPart = map[oldKey];
      const newKeyIndexOldList = list.indexOf(newKey);
      if (oldKey === newKey) {
        oldPart.update(newTemplate);
      } else if (newKeyIndexOldList > -1 && parent != null) {
        const p = map[newKey];
        const move = pullPart(p);
        p.update(newTemplate);
        const el = invariant(findPartEdge(map[list[i]], "start"));
        parent.insertBefore(move.fragment, el);
        list.splice(newKeyIndexOldList, 1);
        list.splice(i, 0, move.part);
      } else {
        const fragment = document.createDocumentFragment();
        const node = document.createComment("{{}}");
        fragment.appendChild(node);
        const newPart = createPart([0], false, Symbol(), node, node);
        render(newTemplate, newPart);
        // TODO: finish logic here to correctly update array/iterable/repeat...
        parent && parent.insertBefore(fragment, findPartEdge(map[list[i]], "start"));
        list.splice(i, 0, newPart);
      }
      parent.removeChild(list[i])
    }
  };
}

function updateArray(part: Part, value: Array<PartValue>) {
  repeat(value)(part);
}

function isPromise(x: any): boolean {
  if (x && typeof x.then === "function") {
    return true;
  } else {
    return false;
  }
}

function set(part: Part, value: PartValue) {
  if (typeof part.end === "string") {
    updateAttribute(part, value);
  } else {
    if (
      typeof value !== "string" &&
      !Array.isArray(value) && // $FlowFixMe
      typeof value[Symbol.iterator] === "function"
    ) {
      // $FlowFixMe
      value = Array.from(value);
    }
    if (isPromise(value)) {
      value.then(promised => {
        set(part, promised);
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

function isSVGChild(node: ?Node): boolean {
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

function templateSetup(parts: Array<Part>): WalkFn {
  return function(parent, element) {
    const nodeType = element && element.nodeType;
    if (nodeType === TEXT_NODE) {
      const isSVG = isSVGChild(element);
      const text = element && element.nodeValue;
      const split = text && text.split("{{}}");
      const end: ?number = split != null ? split.length - 1 : null; 
      const nodes = [];
      let cursor = 0;
      if (split && split.length > 0 && end) {
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
            parts.push(createPart(adjustedPath, isSVG));
            cursor++;
          }
        });
        nodes.forEach(node => {
          parent.insertBefore(node, element);
        });
        if (parent == null && parent.childNodes.indexOf(element) > -1) 
          throw new RangeError();
        parent.removeChild(element);
      }
    } else if (nodeType === ELEMENT_NODE) {
      const isSVG = isSVGChild(element);
      [].forEach.call(element.attributes, attr => {
        if (attr.nodeValue === "{{}}") {
          parts.push(createPart(walkPath.concat(attr.nodeName), isSVG));
        }
      });
    }
  };
}

function getChildTemplate(target: ?HTMLElement): ?TemplateResult {
  if (target == null) return;
  if (
    target.childNodes &&
    target.childNodes.length > 0 &&
    target.childNodes[0].__template
  ) {
    return target.childNodes[0].__template;
  }
}

export function render(
  template: TemplateResult,
  target?: ?HTMLElement | Part = document.body
): void {
  const part = target.nodeType == null ? target : null;
  const instance: TemplateResult =
    target.__template ||
    (part && part.start && part.start.__template) ||
    getChildTemplate(target);
  if (instance) {
    if (instance.key === template.key) {
      instance.update(template.values);
    } else {
      instance.dispose();
      const fragment = document.createDocumentFragment();
      const comment = document.createComment("{{}}");
      fragment.appendChild(comment);
      render(template, comment);
      template.start = fragment.content.firstChild;
      template.end = fragment.content.lastChild;
      template.start.__template = template;
      findParentNode(instance.start).replaceChild(fragment, instance.start);
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
    template.start = template.fragment.content.firstChild;
    template.end = template.fragment.content.lastChild;
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

function isDirective(part: Part, expression: any) {
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

function isPartComment(node: ?HTMLElement): boolean {
  if (node && node.nodeType === COMMENT_NODE && node.nodeValue === "{{}}") {
    return true;
  } else {
    return false;
  }
}

export function flushPart(part: Part): Node {
  const start = findPartEdge(part, "start");
  const parent = findParentNode(start);
  const end = findPartEdge(part, "end");
  if (start !== end) {
    let curr = end;
    while (curr !== start && curr != null) {
      const nextNode = curr.previousSibling;
      parent && parent.removeChild(curr);
      curr = nextNode;
    }
  }
  if (start == null || isPart(start)) throw new RangeError();
  return start;
}

type TemplateResult = {
  key: string,
  fragment: ?DocumentFragment,
  start: ?HTMLElement | Part,
  end: ?HTMLElement | Part,
  values: Array<PartValue>,
  parts: Array<Part>,
  dispose: () => void,
  update: (values: Array<PartValue>) => void
};

function createTemplateResult(
  key: string,
  template: HTMLElement,
  parts: Array<Part>,
  exprs: Array<PartValue>
): TemplateResult {
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
          dispose => typeof dispose === "function" && dispose(part)
        )
      );
      result.start = result.end = flushPart(result);
    },
    update(values) {
      if (values != null && Array.isArray(values)) {
        result.values = values;
      }
      if (!result.fragment) {
        const t: HTMLTemplateElement = 
          ((document.importNode(template, true): any): HTMLTemplateElement);
        const frag = t.content;
        result.fragment = frag;
        //result.fragment = ((document.importNode(template, true): any): HTMLTemplateElement).content;
        const templateStart: ?Node | Part = frag.firstChild;
        const templateEnd: ?Node | Part | string = frag.lastChild;
        result.start = isPartComment(templateStart)
          ? result.parts[0]
          : templateStart;
        result.end = isPartComment(templateEnd)
          ? parts[parts.length - 1]
          : templateEnd;
        parts.forEach(part => {
          const target = followDOMPath(
            result && result.fragment && result.fragment.content,
            part.path
          );
          if (Array.isArray(target)) {
            part.start = target[0];
            part.end = target[1];
          } else {
            part.start = target;
            part.end = target;
          }
        });
      }
      parts.forEach((part, i) => {
        const newVal: PartValue = result.values[i];
        if (isDirective(part, newVal)) {
          const fn: Directive = ((newVal: any): Directive);
          fn(part);
        } else {
          part.update(newVal);
        }
      });
    }
  };
  return result;
}

function parseSerializedParts(value: string): Array<?Part> {
  if (value.startsWith("{{parts:") && value.endsWith("}}")) {
    return JSON.parse(value.split("{{parts:")[1].slice(0, -2));
  } else {
    return [];
  }
}

function isFirstChildSerializedParts(parent: DocumentFragment): boolean {
  const child = parent.firstChild;
  return child &&
    child.nodeType === COMMENT_NODE &&
    child.nodeValue.startsWith("{{parts:") &&
    child.nodeValue.endsWith("}}")
    ? true
    : false;
}

type DeserializedTemplate = {
  template: HTMLElement,
  parts: Array<Part>
};

function checkForSerialized(id: string): ?DeserializedTemplate {
  const template: ?HTMLTemplateElement = ((document.getElementById(
    `template-${id}`
  ): any): ?HTMLTemplateElement);
  if (template == null) return;
  const frag = template.content;
  if (frag == null) return;
  const first = frag.firstChild;
  if (first == null) return;
  const parts = isFirstChildSerializedParts(frag)
    ? parseSerializedParts(frag.removeChild(first).nodeValue)
    : [];
  const result: DeserializedTemplate = { template, parts };
  template && !templateCache.has(id) && templateCache.set(id, result);
  return result;
}

function generateId(str: string): string {
  let id = 0;
  if (str.length > 0) {
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      id = (id << 5) - id + char;
      id = id & id;
    }
  }
  return id.toString();
}

export function html(
  strs: Array<string>,
  ...exprs: Array<PartValue>
): TemplateResult {
  const staticMarkUp = strs.toString();
  const id = idCache.get(staticMarkUp) || generateId(staticMarkUp);
  const cacheEntry = templateCache.get(id);
  let { template, parts } = cacheEntry || checkForSerialized(id) || { template: null, parts: []};
  if (template == null) {
    template = document.createElement("template");
    template.innerHTML = strs.join("{{}}");
    walkDOM(template.content, null, templateSetup(parts));
    templateCache.set(id, { template, parts });
  }
  return createTemplateResult(strs.toString(), template, parts, exprs);
}

export function until(
  promise: Promise<PartValue>,
  defaultContent: PartValue
): Directive {
  return function(part: Part) {
    part.update(defaultContent);
    promise.then(value => part.update(value));
  };
}
