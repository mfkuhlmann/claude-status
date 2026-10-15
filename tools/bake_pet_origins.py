#!/usr/bin/env python3
"""Bake CSS transform-origin into clawd-pet SVGs so Qt draws them correctly.

Qt's VectorImage applies CSS `transform-origin` wrongly on groups, and badly
on animated groups nested in other animated groups: a rotating arm flies off
the character. This rewrites every animated element that has a pivot as

    <g transform="translate(ox oy)">        move to the pivot
      <g class="...">                       the animation runs around 0 0
        <g transform="translate(-ox -oy)">  move back
          element

and drops `transform-origin` from the CSS. Browsers render the result the same
way as the original.

    python3 tools/bake_pet_origins.py package/contents/pets/clawd-*.svg

Handles what clawd-pet uses: plain `.class` rules, inline `style` origins and
pixel origins.
"""

import re
import sys
import xml.etree.ElementTree as ET

SVG = "http://www.w3.org/2000/svg"
ET.register_namespace("", SVG)

RULE = re.compile(r"\.([A-Za-z0-9_-]+)\s*\{([^{}]*)\}")
ORIGIN = re.compile(r"transform-origin\s*:\s*(-?[\d.]+)px\s+(-?[\d.]+)px\s*;?")


def css_classes(style_text):
    """{class: (origin or None, animated)} following the cascade (later rules win)."""
    info = {}
    for name, body in RULE.findall(re.sub(r"/\*.*?\*/", "", style_text, flags=re.S)):
        origin, animated = info.get(name, (None, False))
        m = ORIGIN.search(body)
        if m:
            origin = (float(m.group(1)), float(m.group(2)))
        if re.search(r"\banimation\s*:", body):
            animated = True
        info[name] = (origin, animated)
    return info


def fmt(v):
    return f"{v:g}"


def bake(text):
    root = ET.fromstring(text, parser=ET.XMLParser(target=ET.TreeBuilder(insert_comments=True)))
    style = root.find(f".//{{{SVG}}}style")
    if style is None or not style.text:
        return text, 0
    info = css_classes(style.text)
    parents = {child: parent for parent in root.iter() for child in parent}
    baked = 0
    for el in list(root.iter()):
        classes = (el.get("class") or "").split()
        if not classes or el is root:
            continue
        origin, animated = None, False
        for c in classes:              # class order doesn't matter; rule order does
            o, a = info.get(c, (None, False))
            animated = animated or a
        for name, (o, _a) in info.items():   # last rule in the stylesheet wins
            if name in classes and o is not None:
                origin = o
        inline = ORIGIN.search(el.get("style") or "")   # style="transform-origin: …" beats the stylesheet
        if inline:
            origin = (float(inline.group(1)), float(inline.group(2)))
        if origin is None or not animated:
            continue
        if inline:
            rest = ORIGIN.sub("", el.get("style")).strip().strip(";").strip()
            if rest:
                el.set("style", rest)
            else:
                del el.attrib["style"]
        ox, oy = origin
        parent = parents[el]
        index = list(parent).index(el)
        outer = ET.Element(f"{{{SVG}}}g", {"transform": f"translate({fmt(ox)} {fmt(oy)})"})
        middle = ET.SubElement(outer, f"{{{SVG}}}g", {"class": " ".join(classes)})
        inner = ET.SubElement(middle, f"{{{SVG}}}g", {"transform": f"translate({fmt(-ox)} {fmt(-oy)})"})
        del el.attrib["class"]
        parent.remove(el)
        inner.append(el)
        parent.insert(index, outer)
        parents[outer] = parent
        baked += 1
    style.text = ORIGIN.sub("", style.text)
    out = ET.tostring(root, encoding="unicode")
    return out + "\n", baked


def main(paths):
    for path in paths:
        with open(path, encoding="utf-8") as f:
            text = f.read()
        out, n = bake(text)
        if n:
            with open(path, "w", encoding="utf-8") as f:
                f.write(out)
        print(f"{path}: {n} animated part(s) re-pivoted")


if __name__ == "__main__":
    main(sys.argv[1:])
